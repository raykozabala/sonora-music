/**
 * Sonora Music Server v7.6.2
 * Dual-mode backend server (Local PC & Render.com compatible)
 * Express.js + SQLite (better-sqlite3) + Multer + Audio Streaming (HTTP 206)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const multer = require('multer');
const { spawn, execSync } = require('child_process');

// Determine Server Mode & Environment
const PORT = process.env.PORT || 3000;
const SERVER_MODE = (process.env.SERVER_MODE || (process.env.RENDER ? 'render' : 'local')).toLowerCase();
const isRender = SERVER_MODE === 'render';

// Paths
const publicDir = path.resolve(__dirname, '../public');
const musicDir = path.resolve(__dirname, '../music');
const dbPath = path.resolve(__dirname, 'sonora.db');

// Ensure directories exist
try {
  if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
  }
} catch (err) {
  console.error('[Startup] Failed to create music directory:', err);
}

// ---------------------------------------------------------------------------
// Database Initialization
// ---------------------------------------------------------------------------
let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (err) {
  console.warn('[Database] better-sqlite3 native driver load issue:', err.message);
  // Fallback in-memory/file emulator in case native compilation is unavailable
  class MockStatement {
    constructor(action) { this.action = action; }
    run(...args) { return this.action('run', args); }
    get(...args) { return this.action('get', args); }
    all(...args) { return this.action('all', args); }
  }
  class MockDb {
    constructor() {
      this.tables = {
        tracks: [],
        albums: [],
        artists: [],
        playlists: [],
        mixes: [],
        users: [],
        history: []
      };
      this.autoIds = { playlists: 1, users: 1, history: 1 };
    }
    pragma() {}
    exec() {}
    prepare(sql) {
      const lower = sql.toLowerCase().trim();
      return new MockStatement((type, args) => {
        if (lower.includes('count(*)')) {
          if (lower.includes('from tracks')) return { count: this.tables.tracks.length };
          if (lower.includes('from history')) return { count: this.tables.history.length };
          return { count: 0 };
        }
        if (lower.startsWith('select * from tracks where id =')) {
          const id = Number(args[0]);
          return this.tables.tracks.find(t => t.id === id) || null;
        }
        if (lower.startsWith('select * from tracks')) {
          return [...this.tables.tracks];
        }
        if (lower.startsWith('select * from albums where id =')) {
          const id = Number(args[0]);
          return this.tables.albums.find(a => a.id === id) || null;
        }
        if (lower.startsWith('select * from albums')) {
          return [...this.tables.albums];
        }
        if (lower.startsWith('select * from artists where id =')) {
          const id = Number(args[0]);
          return this.tables.artists.find(a => a.id === id) || null;
        }
        if (lower.startsWith('select * from artists')) {
          return [...this.tables.artists];
        }
        if (lower.startsWith('select * from playlists where id =')) {
          const id = Number(args[0]);
          return this.tables.playlists.find(p => p.id === id) || null;
        }
        if (lower.startsWith('select * from playlists')) {
          return [...this.tables.playlists];
        }
        if (lower.startsWith('select * from mixes where id =')) {
          const id = Number(args[0]);
          return this.tables.mixes.find(m => m.id === id) || null;
        }
        if (lower.startsWith('select * from mixes')) {
          return [...this.tables.mixes];
        }
        if (lower.startsWith('select * from users where id =')) {
          const id = Number(args[0]);
          return this.tables.users.find(u => u.id === id) || null;
        }
        if (lower.startsWith('insert into playlists')) {
          const id = this.autoIds.playlists++;
          const pl = { id, name: args[0], description: args[1], artwork_url: args[2], track_ids: '[]', created_at: args[3], updated_at: args[4], is_collaborative: 0, owner_id: 1 };
          this.tables.playlists.push(pl);
          return { lastInsertRowid: id };
        }
        return type === 'all' ? [] : null;
      });
    }
    transaction(fn) {
      return fn;
    }
  }
  db = new MockDb();
}

// Create Tables
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      album_id INTEGER,
      artist_id INTEGER,
      duration REAL DEFAULT 0,
      artwork_url TEXT,
      source_url TEXT,
      file_path TEXT,
      is_favorite INTEGER DEFAULT 0,
      play_count INTEGER DEFAULT 0,
      last_played TEXT,
      date_added TEXT,
      genre TEXT,
      year INTEGER,
      track_number INTEGER,
      lyrics TEXT
    );

    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      artist_id INTEGER,
      artwork_url TEXT,
      year INTEGER,
      genre TEXT,
      track_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT,
      bio TEXT,
      track_count INTEGER DEFAULT 0,
      album_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      artwork_url TEXT,
      track_ids TEXT DEFAULT '[]',
      created_at TEXT,
      updated_at TEXT,
      is_collaborative INTEGER DEFAULT 0,
      owner_id INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS mixes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      artwork_url TEXT,
      track_ids TEXT DEFAULT '[]',
      type TEXT,
      genre TEXT,
      mood TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      avatar_url TEXT,
      bio TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1,
      track_id INTEGER,
      played_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count);
    CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id);
  `);
} catch (err) {
  console.error('[Database] Error creating tables:', err);
}

// ---------------------------------------------------------------------------
// Helpers for Data Formatting (Snake_case to CamelCase Compatibility)
// ---------------------------------------------------------------------------
function formatTrack(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album || '',
    album_id: row.album_id,
    albumId: row.album_id,
    artist_id: row.artist_id,
    artistId: row.artist_id,
    duration: Number(row.duration || 0),
    artwork_url: row.artwork_url || '',
    artworkUrl: row.artwork_url || '',
    source_url: row.source_url || `/api/stream/${row.id}`,
    sourceUrl: row.source_url || `/api/stream/${row.id}`,
    file_path: row.file_path || '',
    filePath: row.file_path || '',
    is_favorite: row.is_favorite ? 1 : 0,
    isFavorite: Boolean(row.is_favorite),
    play_count: Number(row.play_count || 0),
    playCount: Number(row.play_count || 0),
    last_played: row.last_played || '',
    lastPlayed: row.last_played || '',
    date_added: row.date_added || '',
    dateAdded: row.date_added || '',
    genre: row.genre || '',
    year: Number(row.year || 0),
    track_number: Number(row.track_number || 1),
    trackNumber: Number(row.track_number || 1),
    lyrics: row.lyrics || '',
    isDownloaded: false
  };
}

function formatAlbum(row, tracks = []) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    artist_id: row.artist_id,
    artistId: row.artist_id,
    artwork_url: row.artwork_url || '',
    artworkUrl: row.artwork_url || '',
    year: Number(row.year || 0),
    genre: row.genre || '',
    track_count: row.track_count !== undefined ? Number(row.track_count) : tracks.length,
    trackCount: row.track_count !== undefined ? Number(row.track_count) : tracks.length,
    tracks: tracks || []
  };
}

function formatArtist(row, albums = [], tracks = []) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    image_url: row.image_url || '',
    imageUrl: row.image_url || '',
    bio: row.bio || '',
    track_count: row.track_count !== undefined ? Number(row.track_count) : tracks.length,
    trackCount: row.track_count !== undefined ? Number(row.track_count) : tracks.length,
    album_count: row.album_count !== undefined ? Number(row.album_count) : albums.length,
    albumCount: row.album_count !== undefined ? Number(row.album_count) : albums.length,
    albums: albums || [],
    tracks: tracks || []
  };
}

function formatPlaylist(row, tracks = []) {
  if (!row) return null;
  let trackIds = [];
  try {
    trackIds = typeof row.track_ids === 'string' ? JSON.parse(row.track_ids) : (row.track_ids || []);
  } catch (e) {
    trackIds = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    artwork_url: row.artwork_url || '',
    artworkUrl: row.artwork_url || '',
    track_ids: trackIds,
    trackIds: trackIds,
    created_at: row.created_at || '',
    createdAt: row.created_at || '',
    updated_at: row.updated_at || '',
    updatedAt: row.updated_at || '',
    is_collaborative: row.is_collaborative ? 1 : 0,
    isCollaborative: Boolean(row.is_collaborative),
    owner_id: row.owner_id || 1,
    tracks: tracks || []
  };
}

function formatMix(row, tracks = []) {
  if (!row) return null;
  let trackIds = [];
  try {
    trackIds = typeof row.track_ids === 'string' ? JSON.parse(row.track_ids) : (row.track_ids || []);
  } catch (e) {
    trackIds = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    artwork_url: row.artwork_url || '',
    artworkUrl: row.artwork_url || '',
    track_ids: trackIds,
    trackIds: trackIds,
    type: row.type || '',
    genre: row.genre || '',
    mood: row.mood || '',
    tracks: tracks || []
  };
}

// ---------------------------------------------------------------------------
// Seed Data (10 Artists, 12 Albums, 60 Tracks, 9 Mixes, Default User & Playlists)
// ---------------------------------------------------------------------------
function seedDatabase() {
  try {
    const trackCountRow = db.prepare('SELECT COUNT(*) as count FROM tracks').get();
    if (trackCountRow && trackCountRow.count > 0) {
      console.log(`[Seed] Database already contains ${trackCountRow.count} tracks. Skipping seed.`);
      return;
    }

    console.log('[Seed] Seeding initial database records...');
    const now = new Date().toISOString();

    const artists = [
      { id: 1, name: 'Luna Morena', imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', bio: 'Artista pop latina con ritmos cálidos, melodías luminosas y letras emotivas.', trackCount: 10, albumCount: 2 },
      { id: 2, name: 'Cielo Rojo', imageUrl: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=400&q=80', bio: 'Banda de rock alternativo conocida por sus guitarras poderosas y energía visceral.', trackCount: 10, albumCount: 2 },
      { id: 3, name: 'Mar de Fuego', imageUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=400&q=80', bio: 'Productora electrónica pionera en texturas futuristas y sintetizadores analógicos.', trackCount: 10, albumCount: 2 },
      { id: 4, name: 'Alma Libre', imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80', bio: 'Proyecto indie folk con composiciones íntimas, guitarras acústicas y poéticas reflexiones.', trackCount: 5, albumCount: 1 },
      { id: 5, name: 'Noche Eterna', imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=400&q=80', bio: 'Banda de metal progresivo con tempos dinámicos y atmósferas épicas y oscuras.', trackCount: 5, albumCount: 1 },
      { id: 6, name: 'Río Dorado', imageUrl: 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=400&q=80', bio: 'Ensamble de jazz contemporáneo que fusiona cadencias latinas y vientos elegantes.', trackCount: 5, albumCount: 1 },
      { id: 7, name: 'Viento Sur', imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=400&q=80', bio: 'Referente de reggaetón y ritmos urbanos con un flow tropical contagioso.', trackCount: 5, albumCount: 1 },
      { id: 8, name: 'Eclipse', imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=400&q=80', bio: 'Dúo de R&B moderno con armonías vocales sedosas y bajos profundos.', trackCount: 5, albumCount: 1 },
      { id: 9, name: 'Horizonte', imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=400&q=80', bio: 'Agrupación de hip-hop lírico con producciones contundentes y mensajes sociales.', trackCount: 5, albumCount: 1 },
      { id: 10, name: 'Cristal', imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=400&q=80', bio: 'Compositora de música clásica moderna, paisajes sonoros y música ambient envolvente.', trackCount: 0, albumCount: 0 }
    ];

    const albums = [
      { id: 1, title: 'Amanecer', artist: 'Luna Morena', artist_id: 1, artwork_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'Pop', track_count: 5 },
      { id: 2, title: 'Estrellas', artist: 'Luna Morena', artist_id: 1, artwork_url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=400&q=80', year: 2023, genre: 'Pop', track_count: 5 },
      { id: 3, title: 'Rebelión', artist: 'Cielo Rojo', artist_id: 2, artwork_url: 'https://images.unsplash.com/photo-1464375117522-1311d6a5b81f?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'Rock', track_count: 5 },
      { id: 4, title: 'Cenizas', artist: 'Cielo Rojo', artist_id: 2, artwork_url: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=400&q=80', year: 2023, genre: 'Rock', track_count: 5 },
      { id: 5, title: 'Voltaje', artist: 'Mar de Fuego', artist_id: 3, artwork_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'Electrónica', track_count: 5 },
      { id: 6, title: 'Circuito', artist: 'Mar de Fuego', artist_id: 3, artwork_url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=400&q=80', year: 2023, genre: 'Electrónica', track_count: 5 },
      { id: 7, title: 'Caminos', artist: 'Alma Libre', artist_id: 4, artwork_url: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'Indie', track_count: 5 },
      { id: 8, title: 'Abismo', artist: 'Noche Eterna', artist_id: 5, artwork_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'Metal', track_count: 5 },
      { id: 9, title: 'Terciopelo', artist: 'Río Dorado', artist_id: 6, artwork_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'Jazz', track_count: 5 },
      { id: 10, title: 'Fuego', artist: 'Viento Sur', artist_id: 7, artwork_url: 'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'Reggaetón', track_count: 5 },
      { id: 11, title: 'Sombras', artist: 'Eclipse', artist_id: 8, artwork_url: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'R&B', track_count: 5 },
      { id: 12, title: 'Asfalto', artist: 'Horizonte', artist_id: 9, artwork_url: 'https://images.unsplash.com/photo-1483412033650-1015ddeb83d1?auto=format&fit=crop&w=400&q=80', year: 2024, genre: 'Hip-Hop', track_count: 5 }
    ];

    const rawTracks = [
      // Album 1 - Amanecer (Pop)
      [1, 'Despertar Dorado', 'Luna Morena', 'Amanecer', 1, 1, 215, 'Pop', 2024, 1, 'Cada mañana es un nuevo comienzo\nEl sol me dice que puedo volar\nDespierto y siento que todo es posible\nBajo la luz dorada del mar.'],
      [2, 'Bailando en la Lluvia', 'Luna Morena', 'Amanecer', 1, 1, 198, 'Pop', 2024, 2, 'Las gotas caen sobre la ciudad\nBailamos sin pensar en el después\nEl agua limpia toda la ansiedad\nY me encuentro otra vez a tus pies.'],
      [3, 'Corazón de Cristal', 'Luna Morena', 'Amanecer', 1, 1, 243, 'Pop', 2024, 3, 'Mi corazón es de cristal\nFrágil pero lleno de resplandor\nSi lo cuidas no tendrá final\nEste secreto lleno de amor.'],
      [4, 'Mariposas', 'Luna Morena', 'Amanecer', 1, 1, 187, 'Pop', 2024, 4, 'Siento el aleteo en el interior\nColores vivos en la habitación\nUn impulso que vence al temor\nY transforma mi respiración.'],
      [5, 'Último Suspiro', 'Luna Morena', 'Amanecer', 1, 1, 269, 'Pop', 2024, 5, 'Antes de que caiga el telón\nTe guardo en cada pulsación\nUn suspiro que viaja en el viento\nLlevando todo este sentimiento.'],

      // Album 2 - Estrellas (Pop)
      [6, 'Galaxias', 'Luna Morena', 'Estrellas', 2, 1, 234, 'Pop', 2023, 1, 'Cruzando órbitas en la noche\nMil luces que guían la dirección\nNo hay distancia que nos trasnocha\nCuando late fuerte el corazón.'],
      [7, 'Noches de Plata', 'Luna Morena', 'Estrellas', 2, 1, 201, 'Pop', 2023, 2, 'Bajo el manto plateado de la luna\nCaminamos descalzos por la arena\nNo hay riqueza ni mejor fortuna\nQue olvidar juntos cualquier pena.'],
      [8, 'Constelaciones', 'Luna Morena', 'Estrellas', 2, 1, 256, 'Pop', 2023, 3, 'Dibujando mapas en el cielo oscuro\nUniendo puntos de puro fulgor\nUn camino directo hacia el futuro\nGuiados por la estrella del amor.'],
      [9, 'Luz de Luna', 'Luna Morena', 'Estrellas', 2, 1, 189, 'Pop', 2023, 4, 'Suave destello que acaricia el mar\nSilencios que invitan a soñar\nLa noche es calma y claridad\nEn medio de esta inmensidad.'],
      [10, 'Infinito', 'Luna Morena', 'Estrellas', 2, 1, 278, 'Pop', 2023, 5, 'Más allá del tiempo y la razón\nEterno como la canción\nUn horizonte que nunca termina\nY una chispa que nos ilumina.'],

      // Album 3 - Rebelión (Rock)
      [11, 'Grito de Guerra', 'Cielo Rojo', 'Rebelión', 3, 2, 245, 'Rock', 2024, 1, 'Rompiendo el silencio que nos encierra\nUn rugido que despierta a la tierra\nNo agachamos la cabeza ante el dolor\nLuchamos con pasión y con honor.'],
      [12, 'Fuego Interior', 'Cielo Rojo', 'Rebelión', 3, 2, 267, 'Rock', 2024, 2, 'Hay una llama que no se extingue\nEn el pecho arde la verdad\nLa hipocresía se desvanece\nY nace la auténtica libertad.'],
      [13, 'Sin Cadenas', 'Cielo Rojo', 'Rebelión', 3, 2, 198, 'Rock', 2024, 3, 'Cortamos los lazos del pasado\nEl destino hoy está forjado\nSin miedo a la tempestad\nAbrazo mi propia voluntad.'],
      [14, 'Revolución', 'Cielo Rojo', 'Rebelión', 3, 2, 300, 'Rock', 2024, 4, 'En cada acorde un manifiesto\nDesafiando al poder impuesto\nEl futuro se escribe aquí\nLa voz que nunca va a sucumbir.'],
      [15, 'Última Frontera', 'Cielo Rojo', 'Rebelión', 3, 2, 285, 'Rock', 2024, 5, 'Al borde del precipicio final\nDonde todo vuelve a empezar\nNo hay barrera ni final fatal\nPara quien se atreve a saltar.'],

      // Album 4 - Cenizas (Rock)
      [16, 'Entre las Llamas', 'Cielo Rojo', 'Cenizas', 4, 2, 233, 'Rock', 2023, 1, 'Caminando sobre brasas ardientes\nMiradas firmes y valientes\nEl calor templa la decisión\nDe renacer con convicción.'],
      [17, 'Cicatrices', 'Cielo Rojo', 'Cenizas', 4, 2, 219, 'Rock', 2023, 2, 'Marcas de batallas superadas\nHeridas que ya están cerradas\nRecuerdos de días sin sol\nQue me enseñaron el control.'],
      [18, 'Tormenta', 'Cielo Rojo', 'Cenizas', 4, 2, 248, 'Rock', 2023, 3, 'El cielo ruge con electricidad\nRelámpagos sobre la oscuridad\nLa furia del viento anunciando\nQue la calma ya está llegando.'],
      [19, 'Renacer', 'Cielo Rojo', 'Cenizas', 4, 2, 275, 'Rock', 2023, 4, 'Del polvo y del carbón marchito\nSurge un vuelo infinito\nAve fénix de hierro y pasión\nCon alma nueva en el corazón.'],
      [20, 'Polvo y Viento', 'Cielo Rojo', 'Cenizas', 4, 2, 196, 'Rock', 2023, 5, 'Lo material se va con la brisa\nQueda el recuerdo y una sonrisa\nCaminando hacia el horizonte\nMás allá del viejo monte.'],

      // Album 5 - Voltaje (Electrónica)
      [21, 'Pulso Neón', 'Mar de Fuego', 'Voltaje', 5, 3, 290, 'Electrónica', 2024, 1, 'Líneas de luz en la oscuridad\nFrecuencias de pura velocidad\nEl sintetizador nos envuelve\nY la noche nunca se resuelve.'],
      [22, 'Ondas Digitales', 'Mar de Fuego', 'Voltaje', 5, 3, 287, 'Electrónica', 2024, 2, 'Modulando el espacio sonoro\nFiltros que brillan como oro\nEl beat golpea en sincronicidad\nEn una perfecta eternidad.'],
      [23, 'Synth Dreams', 'Mar de Fuego', 'Voltaje', 5, 3, 265, 'Electrónica', 2024, 3, 'Arpegios que flotan en el éter\nBajos que no tienen frontera\nUn viaje de ensueño estelar\nDonde todo vuelve a vibrar.'],
      [24, 'Frecuencia Zero', 'Mar de Fuego', 'Voltaje', 5, 3, 298, 'Electrónica', 2024, 4, 'En el punto de máxima tensión\nSe detiene la respiración\nExplosión de sonido y color\nEnergía en su mayor furor.'],
      [25, 'Circuito Cerrado', 'Mar de Fuego', 'Voltaje', 5, 3, 245, 'Electrónica', 2024, 5, 'Flujo constante de corriente\nConectando mente con mente\nUn bucle sin principio ni fin\nEn el laberinto de marfil.'],

      // Album 6 - Circuito (Electrónica)
      [26, 'Binary Code', 'Mar de Fuego', 'Circuito', 6, 3, 276, 'Electrónica', 2023, 1, 'Ceros y unos en armonía\nCalculando la nueva melodía\nLa máquina siente vibrar\nEl pulso del software al andar.'],
      [27, 'Láser', 'Mar de Fuego', 'Circuito', 6, 3, 234, 'Electrónica', 2023, 2, 'Rayos cortando la niebla espesa\nEl ritmo nunca cesa\nColores que queman la piel\nCon un sabor dulce a miel.'],
      [28, 'Drop Zone', 'Mar de Fuego', 'Circuito', 6, 3, 295, 'Electrónica', 2023, 3, 'La subida que acelera los latidos\nUniendo todos los sentidos\nY cuando cae el compás central\nEl impacto es colosal.'],
      [29, 'Glitch', 'Mar de Fuego', 'Circuito', 6, 3, 198, 'Electrónica', 2023, 4, 'Errores perfectos en el compás\nFragmentos que van hacia atrás\nLa belleza de la imperfección\nEn esta digital canción.'],
      [30, 'Afterglow', 'Mar de Fuego', 'Circuito', 6, 3, 256, 'Electrónica', 2023, 5, 'La luz tenue tras el amanecer\nEl club empieza a decrecer\nQueda el eco en la memoria\nDe una noche llena de gloria.'],

      // Album 7 - Caminos (Indie)
      [31, 'Sendero', 'Alma Libre', 'Caminos', 7, 4, 223, 'Indie', 2024, 1, 'Paso a paso entre la hierba mojada\nUna guitarra suavemente afinada\nNo hay prisa por llegar al final\nEl camino es lo fundamental.'],
      [32, 'Hojas al Viento', 'Alma Libre', 'Caminos', 7, 4, 198, 'Indie', 2024, 2, 'El otoño danza a mi alrededor\nDejando atrás el viejo dolor\nHojas doradas que van a volar\nPara enseñarme a soltar.'],
      [33, 'Café y Lluvia', 'Alma Libre', 'Caminos', 7, 4, 245, 'Indie', 2024, 3, 'Vapor cálido en la taza pequeña\nMientras la tarde sola sueña\nLas gotas golpean el cristal\nUn momento dulce y especial.'],
      [34, 'Atardecer', 'Alma Libre', 'Caminos', 7, 4, 267, 'Indie', 2024, 4, 'El cielo se tiñe de violeta y naranja\nLa luz del día despacio se cansa\nUn acorde mayor que se apaga en paz\nY la calma que no pide más.'],
      [35, 'Mapa de Sueños', 'Alma Libre', 'Caminos', 7, 4, 212, 'Indie', 2024, 5, 'Trazando rutas con lapicera\nCaminos que van hacia donde quiera\nSin ataduras ni gravedad\nCon la brújula de la verdad.'],

      // Album 8 - Abismo (Metal)
      [36, 'Descenso', 'Noche Eterna', 'Abismo', 8, 5, 298, 'Metal', 2024, 1, 'Caída libre en la fosa sombría\nDonde no llega la luz del día\nBaterías de doble pedal estallando\nY las sombras nos van rodeando.'],
      [37, 'Furia Oscura', 'Noche Eterna', 'Abismo', 8, 5, 300, 'Metal', 2024, 2, 'Riffs pesados y distorsión\nDesatando la rebelión\nLa fuerza oculta que despierta ya\nNada en este mundo la detendrá.'],
      [38, 'Acero y Sangre', 'Noche Eterna', 'Abismo', 8, 5, 276, 'Metal', 2024, 3, 'Forjados en el fuego del dolor\nGuerreros de hierro y valor\nNo hay derrota que pueda vencer\nAl espíritu que va a crecer.'],
      [39, 'Caos', 'Noche Eterna', 'Abismo', 8, 5, 287, 'Metal', 2024, 4, 'Torbellino de ruido y pasión\nDestrucción para la creación\nEn medio de la tempestad total\nEncuentro mi calma primordial.'],
      [40, 'Resurrección', 'Noche Eterna', 'Abismo', 8, 5, 300, 'Metal', 2024, 5, 'Desde las profundidades del abismo\nMe libero del espejismo\nUna luz intensa en el final\nVictoria sobre el vendaval.'],

      // Album 9 - Terciopelo (Jazz)
      [41, 'Medianoche Suave', 'Río Dorado', 'Terciopelo', 9, 6, 289, 'Jazz', 2024, 1, 'Acordes menores en el piano de cola\nLa ciudad de noche nunca está sola\nEl contrabajo marca el compás\nY el humo del bar queda atrás.'],
      [42, 'Saxofón Dorado', 'Río Dorado', 'Terciopelo', 9, 6, 256, 'Jazz', 2024, 2, 'Notas doradas que flotan con gracia\nCurando cualquier distancia o falacia\nMelodía dulce que sabe abrazar\nY el alma entera hacer suspirar.'],
      [43, 'Blues del Alma', 'Río Dorado', 'Terciopelo', 9, 6, 295, 'Jazz', 2024, 3, 'Un lamento que se vuelve deleite\nDeslizando notas como aceite\nSiete acordes para sanar\nY el corazón serenar.'],
      [44, 'Improvisación', 'Río Dorado', 'Terciopelo', 9, 6, 298, 'Jazz', 2024, 4, 'Sin partitura ni dirección\nPura y espontánea creación\nConversación entre cuerda y metal\nEn este instante sin igual.'],
      [45, 'Swing Nocturno', 'Río Dorado', 'Terciopelo', 9, 6, 267, 'Jazz', 2024, 5, 'Ritmo sincopado que invita a mover\nLos pies sin tener que entender\nElegancia en cada rincón\nDe esta elegante estación.'],

      // Album 10 - Fuego (Reggaetón)
      [46, 'Perreo Espacial', 'Viento Sur', 'Fuego', 10, 7, 198, 'Reggaetón', 2024, 1, 'Bajo que retumba hasta Saturno\nEn la discoteca no hay turno\nBaila pegado sin timidez\nQue la vida se vive una vez.'],
      [47, 'Dembow Lunar', 'Viento Sur', 'Fuego', 10, 7, 212, 'Reggaetón', 2024, 2, 'Ritmo pesado de la mata\nEsa mirada que arrebata\nMoviendo la cintura sin parar\nHasta que salga el sol en el mar.'],
      [48, 'Caliente', 'Viento Sur', 'Fuego', 10, 7, 187, 'Reggaetón', 2024, 3, 'La temperatura sube de nivel\nSudor y perfume en la piel\nEl party está en su mejor momento\nSigue la vibra del movimiento.'],
      [49, 'Ritmo Salvaje', 'Viento Sur', 'Fuego', 10, 7, 205, 'Reggaetón', 2024, 4, 'Flow caribeño que quema candela\nLa noche entera te desvela\nNadie se queda sentado aquí\nEsto fue hecho para ti.'],
      [50, 'La Noche Es Nuestra', 'Viento Sur', 'Fuego', 10, 7, 234, 'Reggaetón', 2024, 5, 'Las luces bajan, sube la presión\nTodo el mundo en la misma dirección\nBailando hasta que amanezca\nY la buena energía crezca.'],

      // Album 11 - Sombras (R&B)
      [51, 'Terciopelo Negro', 'Eclipse', 'Sombras', 11, 8, 245, 'R&B', 2024, 1, 'Luces tenues en la penumbra\nTu voz sedosa que me alumbra\nUn roce suave que estremece\nY la pasión que florece.'],
      [52, 'Susurros', 'Eclipse', 'Sombras', 11, 8, 223, 'R&B', 2024, 2, 'Palabras dichas al oído\nSecretos que no hacen ruido\nEntre sábanas de satén\nNos sentimos tan bien.'],
      [53, 'Piel de Seda', 'Eclipse', 'Sombras', 11, 8, 267, 'R&B', 2024, 3, 'Tacto delicado en la noche callada\nMirada profunda y enamorada\nEl compás late lento y profundo\nOlvidando el resto del mundo.'],
      [54, 'Vulnerable', 'Eclipse', 'Sombras', 11, 8, 198, 'R&B', 2024, 4, 'Sin defensas ni disfraz\nAquí encuentro mi verdadera paz\nMostrando el alma sin temor\nEnvuelta en este dulce amor.'],
      [55, 'Eternamente', 'Eclipse', 'Sombras', 11, 8, 289, 'R&B', 2024, 5, 'Más allá de lo evidente\nGrabado en mi mente\nUna melodía que no morirá\nY que siempre sonará.'],

      // Album 12 - Asfalto (Hip-Hop)
      [56, 'Calle Real', 'Horizonte', 'Asfalto', 12, 9, 215, 'Hip-Hop', 2024, 1, 'Micrófono en mano y tinta en el papel\nRelatando historias del día cruel\nCrónicas nacidas en la acera\nDonde la verdad es la que impera.'],
      [57, 'Barrio Alto', 'Horizonte', 'Asfalto', 12, 9, 198, 'Hip-Hop', 2024, 2, 'Desde los techos miro la ciudad\nCon respeto y autenticidad\nCaminando con la frente en alto\nDejando huella en el asfalto.'],
      [58, 'Flow Infinito', 'Horizonte', 'Asfalto', 12, 9, 234, 'Hip-Hop', 2024, 3, 'Métrica precisa sin vacilación\nCada barra con dedicación\nEl beat golpea en el pecho directo\nUn mensaje puro y correcto.'],
      [59, 'Rimas de Acero', 'Horizonte', 'Asfalto', 12, 9, 256, 'Hip-Hop', 2024, 4, 'Palabras fuertes como metal pesado\nPor la experiencia han sido forjados\nResistencia ante la adversidad\nCon pura creatividad.'],
      [60, 'Legado', 'Horizonte', 'Asfalto', 12, 9, 278, 'Hip-Hop', 2024, 5, 'Para los que estuvieron y los que vendrán\nEstas rimas nunca se borrarán\nLa voz del barrio en la memoria\nEscribiendo nuestra propia historia.']
    ];

    const mixes = [
      { id: 1, name: 'Daily Mix 1', description: 'Pop y Ritmos Latinos', artwork_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([1, 2, 3, 6, 7, 8, 46, 47, 51, 52]), type: 'daily', genre: 'Pop', mood: 'Upbeat' },
      { id: 2, name: 'Daily Mix 2', description: 'Rock y Metal Intenso', artwork_url: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([11, 12, 13, 14, 16, 17, 36, 37, 38, 39]), type: 'daily', genre: 'Rock', mood: 'Energetic' },
      { id: 3, name: 'Daily Mix 3', description: 'Electrónica y Synthwaves', artwork_url: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]), type: 'daily', genre: 'Electrónica', mood: 'Electronic' },
      { id: 4, name: 'Daily Mix 4', description: 'Urbano y Reggaetón Fiesta', artwork_url: 'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([46, 47, 48, 49, 50, 56, 57, 58, 59, 60]), type: 'daily', genre: 'Reggaetón', mood: 'Party' },
      { id: 5, name: 'Daily Mix 5', description: 'Jazz, R&B e Indie Vibes', artwork_url: 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([31, 32, 33, 41, 42, 43, 51, 52, 53, 34]), type: 'daily', genre: 'Jazz', mood: 'Relax' },
      { id: 6, name: 'Discover Weekly', description: 'Tu selección semanal de nuevos descubrimientos musicales.', artwork_url: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([3, 12, 23, 34, 42, 48, 55, 58, 7, 19, 25, 32]), type: 'personal', genre: 'Variado', mood: 'Discovery' },
      { id: 7, name: 'Release Radar', description: 'Todos los lanzamientos recientes de tus artistas favoritos.', artwork_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([1, 11, 21, 31, 36, 41, 46, 51, 56, 5, 15, 45]), type: 'personal', genre: 'Novedades', mood: 'New' },
      { id: 8, name: 'Your Mix', description: 'Una mezcla infinita basada en tus canciones más reproducidas.', artwork_url: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([2, 8, 15, 22, 33, 44, 49, 54, 59, 4, 18, 29]), type: 'personal', genre: 'Favoritos', mood: 'Mix' },
      { id: 9, name: 'Chill Mix', description: 'Música tranquila y relajante para desconectar y concentrarse.', artwork_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([9, 10, 31, 32, 33, 41, 42, 43, 53, 55, 35, 45]), type: 'personal', genre: 'Chillout', mood: 'Chill' }
    ];

    const playlists = [
      { id: 1, name: 'Favoritas del Momento', description: 'Mis canciones favoritas y más escuchadas.', artwork_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([1, 2, 3, 4, 5]), created_at: now, updated_at: now, is_collaborative: 0, owner_id: 1 },
      { id: 2, name: 'Para Entrenar', description: 'Energía pura, rock y beats para el gimnasio.', artwork_url: 'https://images.unsplash.com/photo-1464375117522-1311d6a5b81f?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([11, 12, 13, 36, 37, 46, 47, 56, 57, 14]), created_at: now, updated_at: now, is_collaborative: 0, owner_id: 1 },
      { id: 3, name: 'Sesión Acústica e Indie', description: 'Vibras acústicas y tranquilas para tardes de relax.', artwork_url: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=400&q=80', track_ids: JSON.stringify([31, 32, 33, 41, 42, 51, 52, 9, 10, 34]), created_at: now, updated_at: now, is_collaborative: 0, owner_id: 1 }
    ];

    // Seed transaction
    const insertArtist = db.prepare(`
      INSERT OR REPLACE INTO artists (id, name, image_url, bio, track_count, album_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertAlbum = db.prepare(`
      INSERT OR REPLACE INTO albums (id, title, artist, artist_id, artwork_url, year, genre, track_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTrack = db.prepare(`
      INSERT OR REPLACE INTO tracks (
        id, title, artist, album, album_id, artist_id, duration, artwork_url, 
        source_url, file_path, is_favorite, play_count, last_played, date_added, 
        genre, year, track_number, lyrics
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMix = db.prepare(`
      INSERT OR REPLACE INTO mixes (id, name, description, artwork_url, track_ids, type, genre, mood)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPlaylist = db.prepare(`
      INSERT OR REPLACE INTO playlists (id, name, description, artwork_url, track_ids, created_at, updated_at, is_collaborative, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, username, email, password_hash, avatar_url, bio, created_at)
      VALUES (1, 'sonora_user', 'demo@sonoramusic.com', 'demo_hash_123', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80', 'Amante de la música y explorador de sonidos.', ?)
    `);

    const runSeed = db.transaction(() => {
      // Insert Artists
      for (const a of artists) {
        insertArtist.run(a.id, a.name, a.imageUrl, a.bio, a.trackCount, a.albumCount);
      }
      // Insert Albums
      for (const alb of albums) {
        insertAlbum.run(alb.id, alb.title, alb.artist, alb.artist_id, alb.artwork_url, alb.year, alb.genre, alb.track_count);
      }
      // Insert Tracks
      for (const t of rawTracks) {
        const id = t[0];
        const albumObj = albums.find(a => a.id === t[4]);
        const artworkUrl = albumObj ? albumObj.artwork_url : 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=400&q=80';
        const filePath = path.join(musicDir, `track_${id}.mp3`);
        const sourceUrl = `/api/stream/${id}`;
        const isFav = id <= 5 ? 1 : 0;
        const playCount = Math.floor(Math.random() * 80) + 10;
        const lastPlayed = id <= 10 ? now : '';
        const lyrics = t[10] || '';

        insertTrack.run(
          id, t[1], t[2], t[3], t[4], t[5], t[6], artworkUrl,
          sourceUrl, filePath, isFav, playCount, lastPlayed, now,
          t[7], t[8], t[9], lyrics
        );
      }
      // Insert Mixes
      for (const m of mixes) {
        insertMix.run(m.id, m.name, m.description, m.artwork_url, m.track_ids, m.type, m.genre, m.mood);
      }
      // Insert Playlists
      for (const p of playlists) {
        insertPlaylist.run(p.id, p.name, p.description, p.artwork_url, p.track_ids, p.created_at, p.updated_at, p.is_collaborative, p.owner_id);
      }
      // Insert Default User
      insertUser.run(now);
    });

    runSeed();
    console.log('[Seed] Database successfully seeded with 10 artists, 12 albums, 60 tracks, 9 mixes, and default playlists!');
  } catch (err) {
    console.error('[Seed] Error seeding database:', err);
  }
}

// Execute initial seed
seedDatabase();

// ---------------------------------------------------------------------------
// Multer Configuration (File Upload Support)
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, musicDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});
const upload = multer({ storage });

// ---------------------------------------------------------------------------
// Express Application & Global Middlewares
// ---------------------------------------------------------------------------
const app = express();

// CORS (Allow all origins for local dev and Render)
app.use(cors());

// Request Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logger with Timestamp
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

// ---------------------------------------------------------------------------
// API Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/health
 * Server health check and mode status
 */
app.get('/api/health', (req, res) => {
  try {
    res.json({
      status: 'ok',
      server: isRender ? 'render' : 'local',
      uptime: Math.floor(process.uptime()),
      version: '7.6.2'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Binaries for media processing
function findBinary(name) {
  const common = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    path.join(__dirname, name),
    path.join(__dirname, '../bin', name)
  ];
  for (const p of common) {
    try {
      if (fs.existsSync(p)) return p;
    } catch(e){}
  }
  try {
    const res = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (res) return res;
  } catch(e){}
  return name;
}
const YTDLP_BIN = findBinary('yt-dlp');
const FFMPEG_BIN = findBinary('ffmpeg');
// Deno es el runtime que yt-dlp usa para resolver los desafíos de YouTube.
// Sin él la extracción falla con "Requested format is not available".
const DENO_BIN = findBinary('deno');

// ---------------------------------------------------------------------------
// Cookies de YouTube
// Necesarias cuando la IP del servidor está marcada por YouTube
// ("Sign in to confirm you're not a bot"), que es el caso de Render.
// ---------------------------------------------------------------------------
const COOKIES_CANDIDATES = [
  process.env.YTDLP_COOKIES_FILE,
  '/etc/secrets/youtube-cookies.txt',
  '/etc/secrets/cookies.txt',
  '/tmp/sonora-cookies.txt',
  path.join(__dirname, 'cookies.txt'),
  path.join(process.cwd(), 'cookies.txt')
].filter(Boolean);

// Permite pasar las cookies como variable de entorno en base64
if (process.env.YTDLP_COOKIES_B64) {
  try {
    const raw = String(process.env.YTDLP_COOKIES_B64).trim();
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length > 50) {
      fs.writeFileSync('/tmp/sonora-cookies.txt', decoded);
      const txt = decoded.toString('utf8');
      const looksValid = txt.indexOf('youtube.com') !== -1;
      console.log('[Cookies] YTDLP_COOKIES_B64 -> ' + decoded.length + ' bytes, válido=' + looksValid);
      if (!looksValid) {
        console.error('[Cookies] ⚠️ El valor de YTDLP_COOKIES_B64 no parece un cookies.txt válido (¿se cortó al pegar?)');
      }
    } else {
      console.error('[Cookies] ⚠️ YTDLP_COOKIES_B64 demasiado corto: ' + decoded.length + ' bytes');
    }
  } catch (e) {
    console.warn('[Cookies] YTDLP_COOKIES_B64 no se pudo decodificar:', e.message);
  }
}

// yt-dlp necesita ESCRIBIR en el archivo de cookies (renueva tokens de sesión).
// Los Secret Files de Render son de solo lectura, así que trabajamos siempre
// sobre una copia escribible en /tmp.
const WRITABLE_COOKIES = '/tmp/sonora-cookies-rw.txt';
let COOKIES_PATH = null;

function prepareCookies() {
  try {
    let src = null;
    for (const c of COOKIES_CANDIDATES) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).size > 50) { src = c; break; }
      } catch (e) {}
    }

    if (!src) {
      COOKIES_PATH = null;
      console.warn('[Cookies] SIN cookies: YouTube puede bloquear las descargas desde este servidor');
      return;
    }

    if (path.resolve(src) !== path.resolve(WRITABLE_COOKIES)) {
      fs.copyFileSync(src, WRITABLE_COOKIES);
      try { fs.chmodSync(WRITABLE_COOKIES, 0o600); } catch (e) {}
    }
    COOKIES_PATH = WRITABLE_COOKIES;

    let size = 0;
    try { size = fs.statSync(COOKIES_PATH).size; } catch (e) {}
    console.log('[Cookies] listas | origen=' + src + ' | copia escribible=' + COOKIES_PATH + ' (' + size + ' bytes)');
  } catch (e) {
    console.warn('[Cookies] error preparando las cookies:', e.message);
    COOKIES_PATH = null;
  }
}

function getCookiesFile() {
  return COOKIES_PATH;
}

function withCookies(args) {
  return COOKIES_PATH ? args.concat(['--cookies', COOKIES_PATH]) : args.slice();
}

prepareCookies();

// Los desafíos de YouTube (nsig/PO token) requieren un runtime de JavaScript.
// Deno es el único habilitado por defecto en yt-dlp.
(function logJsRuntimeStatus() {
  const deno = safeExec(`"${DENO_BIN}" --version`);
  if (deno) console.log('[JS] deno disponible: ' + deno.split('\n')[0]);
  else console.warn('[JS] SIN deno: yt-dlp no podrá resolver los desafíos de YouTube (las descargas fallarán)');
})();

// ---------------------------------------------------------------------------
// Helpers: yt-dlp / ffmpeg wrappers robustos
// ---------------------------------------------------------------------------
function safeExec(cmd, timeoutMs) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: timeoutMs || 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return '';
  }
}

// Player clients probados, de más compatible a más específico. Sirve para
// esquivar el bloqueo "Sign in to confirm you're not a bot" en servidores cloud.
// Ojo: android_vr / tv_embedded / mweb son los que suelen pasar en datacenter.
const YT_CLIENT_FALLBACKS = [
  null,             // "default" (web + deno + cookies): verificado OK en Render
  'tv_embedded',    // verificado OK en Render
  'android_vr',
  'web_safari'
];
// Para STREAMING sólo tienen sentido los dos que funcionan desde datacenter;
// probar los demás sólo añade espera (piden PO token y fallan).
const YT_RESOLVE_CLIENTS = [null, 'tv_embedded'];
// Presupuesto por cliente: deno tarda ~40 s en la CPU del plan gratuito de
// Render, y el streaming debe dejar margen para la red de seguridad (plan D).
const YTDLP_CLIENT_TIMEOUT = 45000;

/**
 * Ejecuta yt-dlp (--get-url) con un "player client" concreto.
 * Devuelve { url, error }: url si funcionó, o el motivo del fallo.
 */
function ytdlpResolveWithClient(targetUrl, client) {
  return new Promise((resolve) => {
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--no-check-certificates',
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
      '--get-url'
    ];
    if (client) args.push('--extractor-args', 'youtube:player_client=' + client);

    // Copia única de las cookies por proceso: yt-dlp REESCRIBE el archivo de
    // cookies, así que dos procesos en paralelo se pisarían entre sí.
    let cookieCopy = null;
    if (COOKIES_PATH) {
      try {
        cookieCopy = path.join(os.tmpdir(),
          'sonora-ck-' + process.pid + '-' + Math.random().toString(36).slice(2, 8) + '.txt');
        fs.copyFileSync(COOKIES_PATH, cookieCopy);
        args.push('--cookies', cookieCopy);
      } catch (e) { cookieCopy = null; }
    }

    const finalArgs = args.slice();
    finalArgs.push(targetUrl);

    const proc = spawn(YTDLP_BIN, finalArgs);
    let out = '';
    let err = '';
    let done = false;
    const label = client || 'default';

    const cleanup = () => {
      if (cookieCopy) { try { fs.unlinkSync(cookieCopy); } catch (e) {} }
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill('SIGKILL'); } catch (e) {}
      cleanup();
      console.warn('[yt-dlp] client=' + label + ' timeout (' + Math.round(YTDLP_CLIENT_TIMEOUT / 1000) + 's)');
      resolve({ url: null, error: label + ': tiempo de espera agotado' });
    }, YTDLP_CLIENT_TIMEOUT);

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });

    proc.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve({ url: null, error: label + ': ' + e.message });
    });

    proc.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      const first = out.trim().split('\n').map(s => s.trim()).filter(Boolean)[0];
      if (code === 0 && first && /^https?:\/\//.test(first)) {
        return resolve({ url: first, error: null });
      }
      const msg = err.trim().split('\n').pop() || ('yt-dlp salió con código ' + code);
      console.warn('[yt-dlp] client=' + label + ' falló: ' + msg);
      resolve({ url: null, error: label + ': ' + msg });
    });
  });
}

/**
 * Resuelve la URL directa de audio probando varios "player clients".
 * Se lanzan de 2 en 2: el primero casi siempre es "default", que es el que
 * funciona; el segundo va de reserva por si aquél se atasca.
 */
function ytdlpResolveAudioUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const CONCURRENCY = 2;
    let idx = 0;
    let pending = 0;
    let settled = false;
    const errors = [];

    function launch() {
      while (!settled && pending < CONCURRENCY && idx < YT_RESOLVE_CLIENTS.length) {
        const client = YT_RESOLVE_CLIENTS[idx++];
        pending++;
        ytdlpResolveWithClient(targetUrl, client).then((res) => {
          if (settled) return;
          pending--;
          if (res && res.url) {
            settled = true;
            return resolve(res.url);
          }
          if (res && res.error) errors.push(res.error);
          if (pending === 0 && idx >= YT_RESOLVE_CLIENTS.length) {
            settled = true;
            return reject(new Error('ningún player client funcionó | ' + errors.join(' | ')));
          }
          launch();
        });
      }
    }

    launch();
  });
}

// Caché de URLs de audio ya resueltas. La resolución es lenta (yt-dlp + deno +
// cookies), así que se reutiliza durante 20 min: hace instantáneos los
// "seeks" y las repeticiones que hace el reproductor.
const RESOLVED_URL_CACHE = new Map();
const RESOLVED_URL_TTL = 20 * 60 * 1000;

function getResolvedUrl(key) {
  const e = RESOLVED_URL_CACHE.get(key);
  if (!e) return null;
  if (e.exp <= Date.now()) { RESOLVED_URL_CACHE.delete(key); return null; }
  return e.url;
}

function setResolvedUrl(key, url) {
  if (RESOLVED_URL_CACHE.size > 300) RESOLVED_URL_CACHE.clear();
  RESOLVED_URL_CACHE.set(key, { url: url, exp: Date.now() + RESOLVED_URL_TTL });
}

/**
 * Hace proxy de una URL de audio respetando el header Range (permite "seek").
 */
function proxyAudioStream(directUrl, req, res, onReject) {
  const lib = directUrl.startsWith('https') ? https : http;
  const headers = {
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.youtube.com/'
  };
  if (req.headers.range) headers['Range'] = req.headers.range;

  const upstream = lib.get(directUrl, { headers }, (up) => {
    const ct = String(up.headers['content-type'] || '');
    const rejected = (up.statusCode && up.statusCode >= 400) || ct.indexOf('text/html') !== -1;
    if (rejected) {
      // El CDN de YouTube devolvió una página de error en lugar del audio.
      console.warn('[Stream] el CDN rechazó la URL: HTTP ' + up.statusCode + ' ' + (ct || 'sin content-type'));
      up.resume();
      if (typeof onReject === 'function') {
        try { onReject(up.statusCode, ct); } catch (e) {}
        return;
      }
      if (!res.headersSent) {
        res.status(502).json({
          error: 'El CDN de YouTube rechazó el audio',
          detail: 'HTTP ' + (up.statusCode || '?') + ' ' + (ct || 'sin content-type')
        });
      }
      return;
    }
    res.status(up.statusCode || 200);
    ['content-type', 'content-length', 'accept-ranges', 'content-range', 'content-encoding'].forEach((h) => {
      if (up.headers[h]) res.setHeader(h, up.headers[h]);
    });
    if (!up.headers['content-type']) res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    up.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('[Stream] upstream error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'No se pudo leer el audio', detail: err.message });
    else res.end();
  });

  upstream.setTimeout(45000, () => { upstream.destroy(new Error('timeout')); });
  req.on('close', () => { try { upstream.destroy(); } catch (e) {} });
}

/** Tipo MIME según la extensión del fichero de audio. */
function audioContentType(filePath) {
  const e = path.extname(String(filePath || '')).toLowerCase();
  if (e === '.m4a' || e === '.mp4' || e === '.aac') return 'audio/mp4';
  if (e === '.webm') return 'audio/webm';
  if (e === '.opus' || e === '.ogg') return 'audio/ogg';
  return 'audio/mpeg';
}

/**
 * Tipo MIME mirando los primeros bytes del fichero. Es más fiable que la
 * extensión: yt-dlp a veces guarda MP4/M4A en un fichero con otro nombre, y
 * Android puede negarse a reproducirlo si el Content-Type no encaja.
 */
function sniffAudioContentType(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (n >= 12) {
      const four = buf.slice(0, 4).toString('latin1');
      if (buf.slice(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
      if (four === 'OggS') return 'audio/ogg';
      if (four === 'fLaC') return 'audio/flac';
      if (four === 'RIFF') return 'audio/wav';
      if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm';
      if (four.slice(0, 3) === 'ID3') return 'audio/mpeg';
      if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg';
    }
  } catch (e) {}
  return audioContentType(filePath);
}

/** Sirve un fichero de audio local respetando Range (permite "seek"). */
function serveAudioFileWithRanges(filePath, req, res) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const contentType = sniffAudioContentType(filePath);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (range) {
    const parts = String(range).replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      res.status(416).set({ 'Content-Range': `bytes */${fileSize}` }).send('Requested Range Not Satisfiable');
      return;
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': (end - start) + 1,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

/**
 * Red de seguridad del streaming (plan D). Cuando YouTube no nos deja
 * proxificar el audio desde una IP de datacenter, generamos el fichero en el
 * servidor — la misma vía que usan las descargas, que sí funciona — y lo
 * servimos desde disco. La primera vez tarda; después sale de la caché.
 * Devuelve true si consiguió servir el audio.
 */
async function serveGeneratedAudio(targetUrl, req, res) {
  try {
    // 1) ¿Ya existe el MP3 de una descarga anterior? (instantáneo)
    const mp3Path = downloadCachePath(targetUrl, 'mp3', '320k');
    const cachedMp3 = getCachedDownload(mp3Path);
    if (cachedMp3) {
      console.log('[Stream] plan D: reutilizando el MP3 ya descargado');
      serveAudioFileWithRanges(cachedMp3, req, res);
      return true;
    }

    // 2) ¿Audio sin transcodificar guardado de antes?
    const key = crypto.createHash('sha1').update('streamaudio|' + String(targetUrl)).digest('hex');
    let cachedAudio = null;
    try {
      const hit = fs.readdirSync(CACHE_DIR).find((f) => f.indexOf(key + '.') === 0);
      if (hit) cachedAudio = getCachedDownload(path.join(CACHE_DIR, hit));
    } catch (e) {}
    if (cachedAudio) {
      console.log('[Stream] plan D: audio ya en caché');
      serveAudioFileWithRanges(cachedAudio, req, res);
      return true;
    }

    // 3) Descargarlo SIN transcodificar (bastante más rápido que convertir a MP3)
    const tmpDir = path.join(os.tmpdir(), 'sonora-stream');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
    const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const args = [
      '--no-playlist', '--no-warnings', '--no-check-certificates',
      '-f', 'bestaudio[ext=m4a]/bestaudio/best'
    ];
    const generated = await ytdlpDownloadToFile(args, targetUrl, tmpDir, stamp);
    if (!generated) return false;

    // Guardamos en caché conservando la extensión (ayuda al Content-Type).
    // OJO: CACHE_DIR sólo lo creaba la ruta de descargas, así que en un
    // contenedor nuevo (Render) esta copia fallaba con ENOENT y el audio se
    // regeneraba en cada petición. Lo creamos aquí también.
    let finalPath = generated;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const ext = path.extname(generated) || '.m4a';
      const cachedPath = path.join(CACHE_DIR, key + ext);
      fs.copyFileSync(generated, cachedPath);
      finalPath = cachedPath;
      console.log('[Stream] plan D: audio guardado en caché (' + path.basename(cachedPath) + ')');
    } catch (copyErr) {
      console.warn('[Stream] plan D: no se pudo cachear: ' + copyErr.message);
    }

    console.log('[Stream] plan D: audio generado en el servidor');
    serveAudioFileWithRanges(finalPath, req, res);
    return true;
  } catch (e) {
    console.warn('[Stream] plan D falló: ' + e.message);
    return false;
  }
}

/**
 * GET /api/system
 * Diagnóstico: modo, versiones y disponibilidad de yt-dlp / ffmpeg
 */
app.get('/api/system', (req, res) => {
  const ytdlpVersion = safeExec(`"${YTDLP_BIN}" --version`);
  const ffmpegRaw = safeExec(`"${FFMPEG_BIN}" -version`);
  const denoRaw = safeExec(`"${DENO_BIN}" --version`);
  res.json({
    status: 'ok',
    mode: isRender ? 'render' : 'local',
    node: process.version,
    platform: process.platform,
    version: '7.6.2',
    ytdlp: {
      path: YTDLP_BIN,
      available: !!ytdlpVersion,
      version: ytdlpVersion || null
    },
    ffmpeg: {
      path: FFMPEG_BIN,
      available: !!ffmpegRaw,
      version: ffmpegRaw ? ffmpegRaw.split('\n')[0] : null
    },
    deno: {
      path: DENO_BIN,
      available: !!denoRaw,
      version: denoRaw ? denoRaw.split('\n')[0] : null
    },
    cookies: (function () {
      const c = getCookiesFile();
      if (!c) return { available: false, path: null };
      let size = 0, sha = null, preview = null, valid = false;
      try {
        const buf = fs.readFileSync(c);
        size = buf.length;
        sha = crypto.createHash('sha256').update(buf).digest('hex');
        preview = buf.toString('utf8', 0, 60).replace(/[\r\n]+/g, ' / ');
        valid = buf.toString('utf8').indexOf('youtube.com') !== -1;
      } catch (e) {}
      return { available: true, path: c, size: size, sha256: sha, preview: preview, valid: valid };
    })()
  });
});

// ---------------------------------------------------------------------------
// Diagnóstico de yt-dlp: qué "player client" de YouTube funciona desde aquí
// ---------------------------------------------------------------------------
function runCapture(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill('SIGKILL'); } catch (e) {}
      reject(new Error('timeout'));
    }, timeoutMs || 45000);

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const first = out.trim().split('\n').map((s) => s.trim()).filter(Boolean)[0];
      if (code === 0 && first) return resolve(first);
      const lines = err.trim().split('\n').filter(Boolean);
      reject(new Error(lines.slice(-1)[0] || ('código ' + code)));
    });
  });
}

app.get('/api/ytdiag', async (req, res) => {
  const id = req.query.id || 'kXYiU_JCYtU';
  const videoUrl = 'https://www.youtube.com/watch?v=' + id;
  const clients = ['default', 'android_vr', 'tv_embedded', 'android', 'mweb', 'web_embedded', 'tv', 'ios', 'web_safari'];
  const results = {};
  for (const c of clients) {
    const args = withCookies(['--no-playlist', '--no-warnings', '--quiet', '--no-check-certificates',
      '-f', 'bestaudio[ext=m4a]/bestaudio/best', '--get-url']);
    if (c !== 'default') args.push('--extractor-args', 'youtube:player_client=' + c);
    args.push(videoUrl);
    try {
      const direct = await runCapture(YTDLP_BIN, args, 45000);
      const host = (direct.match(/^https?:\/\/([^/]+)/) || [])[1] || '?';
      results[c] = { ok: true, host: host, prefix: direct.slice(0, 60) };
    } catch (e) {
      results[c] = { ok: false, error: String(e.message).slice(0, 150) };
    }
  }
  res.json({ id: id, mode: isRender ? 'render' : 'local', clients: results });
});

// ---------------------------------------------------------------------------
// Letras (proxy a LRCLIB: evita CORS y permite cachear)
// ---------------------------------------------------------------------------
const lyricsCache = new Map();

async function fetchLrclib(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'SonoraMusic/7.6.2 (+https://github.com/raykozabala/sonora-music)'
    }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error('LRCLIB HTTP ' + resp.status);
  return resp.json();
}

/**
 * GET /api/lyrics?artist=...&title=...&album=...
 * Devuelve { syncedLyrics, plainLyrics, found }
 */
app.get('/api/lyrics', async (req, res) => {
  const artist = (req.query.artist || '').trim();
  const title = (req.query.title || '').trim();
  const album = (req.query.album || '').trim();

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!title) return res.status(400).json({ error: 'Falta el parámetro title' });

  const cacheKey = (artist + '|' + title + '|' + album).toLowerCase();
  if (lyricsCache.has(cacheKey)) {
    return res.json(lyricsCache.get(cacheKey));
  }

  try {
    const qs = new URLSearchParams();
    if (artist) qs.set('artist_name', artist);
    qs.set('track_name', title);
    if (album) qs.set('album_name', album);

    let data = await fetchLrclib('https://lrclib.net/api/get?' + qs.toString());

    if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
      const search = await fetchLrclib(
        'https://lrclib.net/api/search?q=' + encodeURIComponent((artist + ' ' + title).trim())
      );
      if (Array.isArray(search) && search.length > 0) {
        data = search.find((x) => x && x.syncedLyrics) || search[0];
      }
    }

    const out = {
      syncedLyrics: (data && data.syncedLyrics) || '',
      plainLyrics: (data && data.plainLyrics) || '',
      instrumental: !!(data && data.instrumental),
      found: !!(data && (data.syncedLyrics || data.plainLyrics))
    };

    if (out.found) {
      lyricsCache.set(cacheKey, out);
      if (lyricsCache.size > 400) lyricsCache.clear();
    }
    res.json(out);
  } catch (err) {
    console.warn('[Lyrics] error:', err.message);
    res.status(502).json({ error: 'No se pudo obtener la letra', detail: err.message, found: false });
  }
});


/**
 * GET /api/search/external?q=
 * Live search across YouTube, YouTube Music and SoundCloud
 */
app.get('/api/search/external', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    const results = [];

    // 1. YouTube & YouTube Music search using yt-search
    try {
      const yts = require('yt-search');
      const r = await yts(q);
      if (r && r.videos && r.videos.length > 0) {
        for (const v of r.videos.slice(0, 18)) {
          results.push({
            id: 'yt_' + v.videoId,
            videoId: v.videoId,
            title: v.title,
            artist: v.author ? v.author.name : 'YouTube Music',
            duration: v.seconds || 210,
            durationText: v.timestamp || '3:30',
            thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            platform: 'youtube',
            url: v.url || `https://www.youtube.com/watch?v=${v.videoId}`
          });
        }
      }
    } catch(err) {
      console.warn('[Search] yt-search fallback:', err.message);
    }

    // 2. SoundCloud search
    try {
      const https = require('https');
      const scResults = await new Promise((resolve) => {
        const url = 'https://soundcloud.com/search/sounds?q=' + encodeURIComponent(q);
        const reqSC = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try {
              const regex = /<h2><a href=\"(.*?)\">(.*?)<\/a><\/h2>/g;
              const scList = [];
              let m;
              while ((m = regex.exec(data)) !== null && scList.length < 5) {
                scList.push({
                  id: 'sc_' + scList.length + '_' + Date.now(),
                  title: m[2].replace(/<\/?[^>]+(>|$)/g, ''),
                  artist: 'SoundCloud',
                  duration: 180,
                  durationText: '3:00',
                  thumbnail: 'https://a-v2.sndcdn.com/assets/images/sc-icons/favicon-2cadd14bdb.ico',
                  platform: 'soundcloud',
                  url: 'https://soundcloud.com' + m[1]
                });
              }
              resolve(scList);
            } catch(e) { resolve([]); }
          });
        });
        reqSC.on('error', () => resolve([]));
        reqSC.setTimeout(4000, () => { reqSC.abort(); resolve([]); });
      });
      results.push(...scResults);
    } catch(err) {
      console.warn('[Search] SoundCloud error:', err.message);
    }

    res.json(results);
  } catch (err) {
    console.error('Error in external search:', err);
    res.status(500).json({ error: 'External search failed', message: err.message });
  }
});

/**
 * GET /api/stream/external
 * Streams audio live for playback in Sonora with universal MP3 decoding and CORS
 */
app.get('/api/stream/external', async (req, res) => {
  try {
    let targetUrl = normalizeYtdlpTarget(req.query.url);
    if (!targetUrl && req.query.id) {
      const cleanId = String(req.query.id).replace('yt_', '');
      targetUrl = `https://www.youtube.com/watch?v=${cleanId}`;
    }
    if (!targetUrl && req.query.q) {
      try {
        const yts = require('yt-search');
        const r = await yts(req.query.q);
        if (r && r.videos && r.videos.length > 0) {
          targetUrl = r.videos[0].url;
        }
      } catch (e) {
        console.warn('[Stream] Search by query fallback error:', e.message);
      }
    }

    if (!targetUrl) return res.status(400).json({ error: 'Falta url, id o q' });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

    // Resolvemos la URL directa del audio y hacemos proxy (soporta Range => seek).
    // Plan A: caché. Plan B: yt-dlp. Plan C: Invidious.
    // Plan D (red de seguridad): generar el audio en el servidor y servirlo
    // desde disco, que es la vía de las descargas y sí funciona desde Render.
    if (String(req.query.force || '') === 'file') {
      console.log('[Stream] forzado el plan D (diagnóstico)');
      if (await serveGeneratedAudio(targetUrl, req, res)) return;
      return res.status(502).json({ error: 'El plan D (generar el audio) falló' });
    }

    // En Render (IP de datacenter) YouTube no deja proxificar el audio: la
    // petición al CDN vuelve como página de error y perderíamos 45 s de espera
    // para nada. Ahí la vía fiable es generar el fichero en el servidor —lo
    // mismo que hacen las descargas, ya verificado— y servirlo desde disco.
    // En local el proxy sí funciona y es más rápido (7 s la primera vez), así
    // que se mantiene el camino completo.
    if (SERVER_MODE === 'render') {
      console.log('[Stream] servidor en la nube -> generamos el audio (plan D)');
      if (await serveGeneratedAudio(targetUrl, req, res)) return;
      return res.status(502).json({
        error: 'No se pudo obtener el audio de esta canción',
        detail: 'El servidor no pudo generar el audio'
      });
    }

    let lastResolveError = '';
    let directUrl = getResolvedUrl(targetUrl);
    if (directUrl) {
      console.log('[Stream] URL de audio reutilizada de la caché');
    } else {
      try {
        directUrl = await ytdlpResolveAudioUrl(targetUrl);
        if (directUrl) setResolvedUrl(targetUrl, directUrl);
      } catch (ytErr) {
        lastResolveError = ytErr.message;
        console.warn('[Stream] yt-dlp falló: ' + ytErr.message);
      }
    }
    if (!directUrl) {
      const vid = extractYouTubeId(targetUrl);
      if (vid) {
        try { directUrl = await resolveViaInvidious(vid); } catch (e) {}
      }
    }

    if (!directUrl) {
      if (await serveGeneratedAudio(targetUrl, req, res)) return;
      return res.status(502).json({
        error: 'No se pudo obtener el audio de esta canción',
        detail: lastResolveError || 'YouTube bloqueó la descarga y los servidores alternativos no respondieron'
      });
    }

    console.log('[Stream] proxy ->', directUrl.substring(0, 80) + '...');
    return proxyAudioStream(directUrl, req, res, async (status, ct) => {
      console.warn('[Stream] el CDN rechazó el audio (HTTP ' + status + ' ' + ct + '); paso al plan D');
      if (await serveGeneratedAudio(targetUrl, req, res)) return;
      if (!res.headersSent) {
        res.status(502).json({
          error: 'El CDN de YouTube rechazó el audio',
          detail: 'HTTP ' + (status || '?') + ' ' + (ct || 'sin content-type')
        });
      }
    });
  } catch (outerErr) {
    console.error('[Stream] Fatal route error:', outerErr.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'No se pudo iniciar el streaming',
        detail: outerErr.message
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Descarga real a archivo temporal (yt-dlp + ffmpeg en el servidor)
// ---------------------------------------------------------------------------
function runOnce(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let err = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      const lines = err.trim().split('\n').filter(Boolean);
      reject(new Error(lines.slice(-2).join(' | ') || ('código ' + code)));
    });
  });
}

function findGeneratedFiles(dir, prefix) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .map((f) => {
        const p = path.join(dir, f);
        let size = 0;
        try { size = fs.statSync(p).size; } catch (e) {}
        return { name: f, path: p, size };
      })
      .filter((f) => f.size > 1024)
      .sort((a, b) => b.size - a.size);
  } catch (e) {
    return [];
  }
}

/**
 * Descarga con yt-dlp probando varios player clients hasta lograr el archivo.
 */
async function ytdlpDownloadToFile(baseArgs, targetUrl, tmpDir, stamp) {
  let lastError = '';
  for (let i = 0; i < YT_CLIENT_FALLBACKS.length; i++) {
    const client = YT_CLIENT_FALLBACKS[i];
    const prefix = `sonora_${stamp}_${i}_`;
    const template = path.join(tmpDir, prefix + '%(ext)s');
    const args = withCookies(baseArgs);
    if (client) args.push('--extractor-args', 'youtube:player_client=' + client);
    args.push('-o', template, targetUrl);
    try {
      await runOnce(YTDLP_BIN, args);
      const files = findGeneratedFiles(tmpDir, prefix);
      if (files.length > 0) return files[0].path;
      lastError = 'yt-dlp no generó archivo';
    } catch (e) {
      lastError = e.message;
      console.warn('[Download] client=' + (client || 'default') + ' falló: ' + lastError);
    }
  }
  throw new Error(lastError || 'No se pudo descargar el archivo');
}

// ---------------------------------------------------------------------------
// Plan B: resolver el audio por Invidious cuando YouTube bloquea el servidor
// ---------------------------------------------------------------------------
const INVIDIOUS_INSTANCES = [
  'https://invidious.privacyredirect.com',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.fdn.fr',
  'https://iv.melmac.space'
];

function extractYouTubeId(input) {
  const s = String(input || '');
  let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/^([A-Za-z0-9_-]{11})$/);
  if (m) return m[1];
  return null;
}

/**
 * La app, cuando una canción no trae videoId, manda como respaldo una URL de
 * RESULTADOS de búsqueda de YouTube. yt-dlp no sabe abrir esa URL, así que la
 * convertimos a su búsqueda nativa (ytsearch1:) para que la descarga y el
 * streaming funcionen igualmente.
 */
function normalizeYtdlpTarget(targetUrl) {
  if (!targetUrl) return targetUrl;
  const s = String(targetUrl).trim();

  // https://www.youtube.com/results?search_query=artista+cancion
  const m = s.match(/youtube\.com\/results\?[^#]*?search_query=([^&]+)/i);
  if (m) {
    let q = m[1];
    try { q = decodeURIComponent(q.replace(/\+/g, ' ')); } catch (e) {}
    return 'ytsearch1:' + q;
  }

  // https://music.youtube.com/search?q=artista+cancion
  if (/music\.youtube\.com\/search/i.test(s)) {
    try {
      const q = new URL(s).searchParams.get('q');
      if (q) return 'ytsearch1:' + q;
    } catch (e) {}
  }

  return s;
}

async function resolveViaInvidious(videoId) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(base + '/api/v1/videos/' + videoId, {
        headers: { 'User-Agent': 'SonoraMusic/7.6.2' },
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const data = await r.json();

      const fmts = (data.adaptiveFormats || []).filter(
        (f) => typeof f.type === 'string' && f.type.indexOf('audio/') === 0 && f.url
      );
      if (!fmts.length) continue;

      // Preferimos audio/mp4 (AAC), que es el más compatible
      fmts.sort((a, b) => (/audio\/mp4/.test(b.type) ? 1 : 0) - (/audio\/mp4/.test(a.type) ? 1 : 0));

      let u = fmts[0].url;
      if (u.startsWith('/')) u = base + u;
      if (u.indexOf('/videoplayback') !== -1 && u.indexOf('local=') === -1) u += '&local=true';
      console.log('[Fallback] Invidious OK via ' + base);
      return u;
    } catch (e) {
      console.warn('[Fallback] Invidious ' + base + ' falló: ' + e.message);
    }
  }
  return null;
}

/**
 * Convierte cualquier fuente de audio accesible por URL a un MP3 en disco.
 */
function ffmpegTranscodeToFile(sourceUrl, outPath, title, artist) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-loglevel', 'error',
      '-i', sourceUrl,
      '-vn', '-acodec', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
      '-metadata', 'title=' + (title || ''),
      '-metadata', 'artist=' + (artist || ''),
      outPath
    ];
    const proc = spawn(FFMPEG_BIN, args);
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve(outPath);
      const lines = err.trim().split('\n').filter(Boolean);
      reject(new Error(lines.slice(-2).join(' | ') || ('ffmpeg código ' + code)));
    });
  });
}

// ---------------------------------------------------------------------------
// Caché de descargas (evita reconvertir la misma canción dos veces)
// ---------------------------------------------------------------------------
const CACHE_DIR = path.join(os.tmpdir(), 'sonora-cache');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

function downloadCachePath(targetUrl, format, quality) {
  const key = crypto.createHash('sha1')
    .update(String(targetUrl) + '|' + format + '|' + quality)
    .digest('hex');
  return path.join(CACHE_DIR, key + '.' + (format === 'mp4' ? 'mp4' : 'mp3'));
}

function getCachedDownload(cachePath) {
  try {
    const st = fs.statSync(cachePath);
    if (st.size > 1024 && (Date.now() - st.mtimeMs) < CACHE_TTL) return cachePath;
  } catch (e) {}
  return null;
}

function pruneDownloadCache() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(CACHE_DIR)) {
      const p = path.join(CACHE_DIR, f);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > CACHE_TTL) fs.unlinkSync(p);
      } catch (e) {}
    }
  } catch (e) {}
}

/**
 * GET /api/download/external
 * Descarga real en MP3 (320/192/128k) o MP4 (1080/720/360p) con metadatos.
 * Usa caché en disco y devuelve un error real (502) si algo falla.
 */
app.get('/api/download/external', async (req, res) => {
  const targetUrl = normalizeYtdlpTarget(req.query.url);
  const format = (req.query.format || 'mp3').toLowerCase();
  const quality = (req.query.quality || (format === 'mp3' ? '320k' : '720p')).toLowerCase();
  const title = (req.query.title || 'Cancion').replace(/[/\\?%*:|"<>]/g, '_').trim();
  const artist = (req.query.artist || 'Sonora').replace(/[/\\?%*:|"<>]/g, '_').trim();

  if (!targetUrl) return res.status(400).json({ error: 'Falta el parámetro url' });

  const filename = `${artist} - ${title}.${format}`;
  const tmpDir = path.join(os.tmpdir(), 'sonora-downloads');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
  const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  let baseArgs;
  if (format === 'mp3') {
    const q = ['320k', '192k', '128k'].includes(quality) ? quality : '320k';
    baseArgs = [
      '--no-playlist', '--no-warnings', '--no-check-certificates',
      '-x', '--audio-format', 'mp3', '--audio-quality', q,
      '--add-metadata', '--embed-thumbnail'
    ];
  } else {
    let formatSpec = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    if (quality === '1080p') formatSpec = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best';
    else if (quality === '720p') formatSpec = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best';
    else if (quality === '360p') formatSpec = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]/best';
    baseArgs = [
      '--no-playlist', '--no-warnings', '--no-check-certificates',
      '-f', formatSpec, '--merge-output-format', 'mp4', '--add-metadata'
    ];
  }

  // 1) ¿Está ya en caché?
  const cachePath = downloadCachePath(targetUrl, format, quality);
  let filePath = getCachedDownload(cachePath);
  let isCached = !!filePath;

  // 2) Si no, generarlo
  if (!filePath) {
    let generated = null;
    try {
      generated = await ytdlpDownloadToFile(baseArgs, targetUrl, tmpDir, stamp);
    } catch (err) {
      console.warn('[Download] yt-dlp falló: ' + err.message);
      // Plan B: Invidious + ffmpeg (solo audio MP3)
      const vid = extractYouTubeId(targetUrl);
      if (vid && FFMPEG_BIN && format === 'mp3') {
        const src = await resolveViaInvidious(vid);
        if (src) {
          const outPath = path.join(tmpDir, 'sonora_' + stamp + '_fb.mp3');
          try {
            await ffmpegTranscodeToFile(src, outPath, title, artist);
            generated = outPath;
            console.log('[Download] recuperado por plan B (Invidious + ffmpeg)');
          } catch (ffErr) {
            console.error('[Download] plan B falló: ' + ffErr.message);
            return res.status(502).json({
              error: 'No se pudo descargar la canción',
              detail: err.message + ' / ' + ffErr.message
            });
          }
        }
      }
      if (!generated) {
        return res.status(502).json({
          error: 'No se pudo descargar ni convertir la canción',
          detail: err.message
        });
      }
    }

    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.copyFileSync(generated, cachePath);
      fs.unlinkSync(generated);
      filePath = cachePath;
      isCached = true;
    } catch (copyErr) {
      filePath = generated;
    }
    pruneDownloadCache();
  } else {
    console.log('[Download] servido desde caché:', cachePath);
  }

  let size = 0;
  try { size = fs.statSync(filePath).size; } catch (e) {}
  if (!size) return res.status(502).json({ error: 'El archivo generado está vacío' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
  res.setHeader('Content-Type', format === 'mp4' ? 'video/mp4' : 'audio/mpeg');
  res.setHeader('Content-Length', size);
  // El nombre debe ir SIN codificar en "filename" (si no, Android genera
  // nombres rotos del tipo ".mp3"); el nombre con acentos va en filename*.
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

  const cleanup = () => { if (!isCached) { try { fs.unlinkSync(filePath); } catch (e) {} } };
  const stream = fs.createReadStream(filePath);
  stream.on('error', (e) => {
    console.error('[Download] stream error:', e.message);
    cleanup();
    if (!res.headersSent) res.status(500).end();
  });
  stream.on('close', cleanup);
  res.on('close', () => { try { stream.destroy(); } catch (e) {} cleanup(); });
  stream.pipe(res);
});

/**
 * GET /api/recommendations?artist=...&title=...
 * Continuous autoplay / radio recommendations for related tracks
 */
app.get('/api/recommendations', async (req, res) => {
  try {
    const artist = (req.query.artist || '').trim();
    const title = (req.query.title || '').trim();
    const query = artist ? `${artist} top songs` : (title ? `${title} related songs` : 'rock pop hits');

    const yts = require('yt-search');
    const r = await yts(query);
    const items = [];
    if (r && r.videos && r.videos.length > 0) {
      for (const v of r.videos.slice(0, 8)) {
        items.push({
          id: 'yt_' + v.videoId,
          videoId: v.videoId,
          title: v.title,
          artist: v.author ? v.author.name : (artist || 'Música recomendada'),
          duration: v.seconds || 210,
          durationText: v.timestamp || '3:30',
          thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          platform: 'youtube',
          url: v.url || `https://www.youtube.com/watch?v=${v.videoId}`
        });
      }
    }
    res.json(items);
  } catch (err) {
    console.warn('[Recommendations] error:', err.message);
    res.json([]);
  }
});

/**
 * Collaborative Playlists Sync (In-memory + DB shared store)
 */
const collaborativeStore = new Map();

app.get('/api/playlists/collaborative/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase().trim();
  const pl = collaborativeStore.get(code);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada con este código' });
  res.json(pl);
});

app.post('/api/playlists/collaborative/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase().trim();
  const name = req.body.name || 'Playlist Colaborativa';
  const description = req.body.description || '';
  const tracks = req.body.tracks || [];
  let pl = collaborativeStore.get(code);
  if (!pl) {
    pl = { code, name, description, tracks, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  } else {
    pl.name = name;
    pl.description = description;
    if (tracks.length > 0) pl.tracks = tracks;
    pl.updatedAt = new Date().toISOString();
  }
  collaborativeStore.set(code, pl);
  res.json({ success: true, playlist: pl });
});

app.post('/api/playlists/collaborative/:code/tracks', (req, res) => {
  const code = (req.params.code || '').toUpperCase().trim();
  const track = req.body;
  if (!track || !track.title) return res.status(400).json({ error: 'Track inválido' });

  let pl = collaborativeStore.get(code);
  if (!pl) {
    pl = { code: code, name: req.body.playlistName || 'Playlist Colaborativa', tracks: [], updatedAt: new Date().toISOString() };
    collaborativeStore.set(code, pl);
  }

  // Avoid duplicates
  if (!pl.tracks.some(t => t.id === track.id || t.title === track.title)) {
    pl.tracks.push(track);
    pl.updatedAt = new Date().toISOString();
  }

  res.json({ success: true, count: pl.tracks.length, playlist: pl });
});

/**
 * GET /api/tracks/search?q=
 * Search tracks by title, artist, or album
 * (Placed before /api/tracks/:id to avoid conflict)
 */
app.get('/api/tracks/search', (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) {
      return res.json([]);
    }
    const queryTerm = `%${q.trim()}%`;
    const rows = db.prepare(`
      SELECT * FROM tracks 
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
      ORDER BY play_count DESC
    `).all(queryTerm, queryTerm, queryTerm);

    res.json(rows.map(formatTrack));
  } catch (err) {
    console.error('Error searching tracks:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/tracks/genre/:genre
 * Get tracks filtered by genre
 */
app.get('/api/tracks/genre/:genre', (req, res) => {
  try {
    const genre = req.params.genre;
    const rows = db.prepare(`
      SELECT * FROM tracks 
      WHERE LOWER(genre) = LOWER(?)
      ORDER BY play_count DESC
    `).all(genre);

    res.json(rows.map(formatTrack));
  } catch (err) {
    console.error('Error getting tracks by genre:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/tracks
 * List tracks with optional pagination (?page=1&limit=50)
 * Returns array directly for compatibility with Sonora.API client
 */
app.get('/api/tracks', (req, res) => {
  try {
    const hasPage = req.query.page !== undefined;
    const hasLimit = req.query.limit !== undefined;

    const totalRow = db.prepare('SELECT COUNT(*) as count FROM tracks').get();
    const total = totalRow ? totalRow.count : 0;

    let rows;
    if (hasPage || hasLimit) {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
      const offset = (page - 1) * limit;
      const totalPages = Math.ceil(total / limit) || 1;

      rows = db.prepare('SELECT * FROM tracks ORDER BY id ASC LIMIT ? OFFSET ?').all(limit, offset);

      res.set({
        'X-Total-Count': total.toString(),
        'X-Page': page.toString(),
        'X-Limit': limit.toString(),
        'X-Total-Pages': totalPages.toString()
      });
    } else {
      rows = db.prepare('SELECT * FROM tracks ORDER BY id ASC').all();
      res.set({
        'X-Total-Count': total.toString(),
        'X-Page': '1',
        'X-Limit': total.toString(),
        'X-Total-Pages': '1'
      });
    }

    res.json(rows.map(formatTrack));
  } catch (err) {
    console.error('Error fetching tracks:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/tracks/:id
 * Get single track by ID
 */
app.get('/api/tracks/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid track ID' });

    const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: 'Track not found' });
    }
    res.json(formatTrack(row));
  } catch (err) {
    console.error('Error fetching track by ID:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /api/tracks/:id/play
 * Increment track play count and add to history
 */
app.post('/api/tracks/:id/play', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid track ID' });

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE tracks 
      SET play_count = play_count + 1, last_played = ?
      WHERE id = ?
    `).run(now, id);

    const userId = (req.body && req.body.userId) || 1;
    try {
      db.prepare(`
        INSERT INTO history (user_id, track_id, played_at)
        VALUES (?, ?, ?)
      `).run(userId, id, now);
    } catch (hErr) {
      console.warn('History insert warning:', hErr.message);
    }

    const updated = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    res.json({
      success: true,
      playCount: updated.play_count,
      lastPlayed: updated.last_played,
      track: formatTrack(updated)
    });
  } catch (err) {
    console.error('Error recording track play:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/albums
 * List all albums
 */
app.get('/api/albums', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM albums ORDER BY year DESC, title ASC').all();
    res.json(rows.map(a => formatAlbum(a)));
  } catch (err) {
    console.error('Error fetching albums:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/albums/:id
 * Get album with associated tracks
 */
app.get('/api/albums/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid album ID' });

    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id);
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }
    const tracks = db.prepare('SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number ASC').all(id);
    res.json(formatAlbum(album, tracks.map(formatTrack)));
  } catch (err) {
    console.error('Error fetching album:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/artists
 * List all artists
 */
app.get('/api/artists', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM artists ORDER BY name ASC').all();
    res.json(rows.map(a => formatArtist(a)));
  } catch (err) {
    console.error('Error fetching artists:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/artists/:id
 * Get artist with albums and tracks
 */
app.get('/api/artists/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid artist ID' });

    const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id);
    if (!artist) {
      return res.status(404).json({ error: 'Artist not found' });
    }

    const albums = db.prepare('SELECT * FROM albums WHERE artist_id = ? ORDER BY year DESC').all(id);
    const tracks = db.prepare('SELECT * FROM tracks WHERE artist_id = ? ORDER BY album_id ASC, track_number ASC').all(id);

    res.json(formatArtist(artist, albums.map(a => formatAlbum(a)), tracks.map(formatTrack)));
  } catch (err) {
    console.error('Error fetching artist:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/playlists
 * List all playlists
 */
app.get('/api/playlists', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM playlists ORDER BY updated_at DESC, id DESC').all();
    res.json(rows.map(p => formatPlaylist(p)));
  } catch (err) {
    console.error('Error fetching playlists:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/playlists/:id
 * Get playlist with full track details
 */
app.get('/api/playlists/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    let trackIds = [];
    try {
      trackIds = typeof playlist.track_ids === 'string' ? JSON.parse(playlist.track_ids) : (playlist.track_ids || []);
    } catch (e) {
      trackIds = [];
    }

    let tracks = [];
    if (trackIds.length > 0) {
      const placeholders = trackIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM tracks WHERE id IN (${placeholders})`).all(...trackIds);
      const rowMap = new Map();
      rows.forEach(r => rowMap.set(r.id, formatTrack(r)));
      tracks = trackIds.map(tId => rowMap.get(tId)).filter(Boolean);
    }

    res.json(formatPlaylist(playlist, tracks));
  } catch (err) {
    console.error('Error fetching playlist:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /api/playlists
 * Create new playlist { name, description, artworkUrl }
 */
app.post('/api/playlists', (req, res) => {
  try {
    const { name, description, artworkUrl, artwork_url } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }

    const now = new Date().toISOString();
    const artwork = artworkUrl || artwork_url || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80';
    const result = db.prepare(`
      INSERT INTO playlists (name, description, artwork_url, track_ids, created_at, updated_at, is_collaborative, owner_id)
      VALUES (?, ?, ?, '[]', ?, ?, 0, 1)
    `).run(name.trim(), description || '', artwork, now, now);

    const created = db.prepare('SELECT * FROM playlists WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(formatPlaylist(created, []));
  } catch (err) {
    console.error('Error creating playlist:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * PUT /api/playlists/:id
 * Update playlist details or tracks
 */
app.put('/api/playlists/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const name = req.body.name !== undefined ? req.body.name.trim() : playlist.name;
    const description = req.body.description !== undefined ? req.body.description : playlist.description;
    const artworkUrl = req.body.artworkUrl || req.body.artwork_url || playlist.artwork_url;

    let trackIdsStr = playlist.track_ids;
    if (req.body.trackIds !== undefined || req.body.track_ids !== undefined) {
      const ids = req.body.trackIds || req.body.track_ids;
      trackIdsStr = JSON.stringify(Array.isArray(ids) ? ids : []);
    }

    const isCollaborative = req.body.isCollaborative !== undefined ? (req.body.isCollaborative ? 1 : 0) : playlist.is_collaborative;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE playlists 
      SET name = ?, description = ?, artwork_url = ?, track_ids = ?, updated_at = ?, is_collaborative = ?
      WHERE id = ?
    `).run(name, description, artworkUrl, trackIdsStr, now, isCollaborative, id);

    const updated = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    res.json(formatPlaylist(updated));
  } catch (err) {
    console.error('Error updating playlist:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * DELETE /api/playlists/:id
 * Delete playlist
 */
app.delete('/api/playlists/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    res.json({ success: true, message: 'Playlist deleted successfully', id });
  } catch (err) {
    console.error('Error deleting playlist:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /api/playlists/:id/tracks
 * Add track to playlist { trackId }
 */
app.post('/api/playlists/:id/tracks', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const rawTrackId = req.body.trackId !== undefined ? req.body.trackId : req.body.track_id;
    const trackId = parseInt(rawTrackId, 10);
    if (isNaN(trackId)) return res.status(400).json({ error: 'Valid trackId is required' });

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    let trackIds = [];
    try {
      trackIds = typeof playlist.track_ids === 'string' ? JSON.parse(playlist.track_ids) : (playlist.track_ids || []);
    } catch (e) {
      trackIds = [];
    }

    if (!trackIds.includes(trackId)) {
      trackIds.push(trackId);
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE playlists SET track_ids = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(trackIds), now, id);

    const updated = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    res.json(formatPlaylist(updated));
  } catch (err) {
    console.error('Error adding track to playlist:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * DELETE /api/playlists/:id/tracks/:trackId
 * Remove track from playlist
 */
app.delete('/api/playlists/:id/tracks/:trackId', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const trackId = parseInt(req.params.trackId, 10);
    if (isNaN(id) || isNaN(trackId)) return res.status(400).json({ error: 'Invalid parameters' });

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    let trackIds = [];
    try {
      trackIds = typeof playlist.track_ids === 'string' ? JSON.parse(playlist.track_ids) : (playlist.track_ids || []);
    } catch (e) {
      trackIds = [];
    }

    trackIds = trackIds.filter(t => t !== trackId);
    const now = new Date().toISOString();
    db.prepare('UPDATE playlists SET track_ids = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(trackIds), now, id);

    const updated = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    res.json(formatPlaylist(updated));
  } catch (err) {
    console.error('Error removing track from playlist:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/mixes
 * List all mixes
 */
app.get('/api/mixes', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM mixes ORDER BY id ASC').all();
    res.json(rows.map(m => formatMix(m)));
  } catch (err) {
    console.error('Error fetching mixes:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/mixes/:id
 * Get mix with full track details
 */
app.get('/api/mixes/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid mix ID' });

    const mix = db.prepare('SELECT * FROM mixes WHERE id = ?').get(id);
    if (!mix) return res.status(404).json({ error: 'Mix not found' });

    let trackIds = [];
    try {
      trackIds = typeof mix.track_ids === 'string' ? JSON.parse(mix.track_ids) : (mix.track_ids || []);
    } catch (e) {
      trackIds = [];
    }

    let tracks = [];
    if (trackIds.length > 0) {
      const placeholders = trackIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM tracks WHERE id IN (${placeholders})`).all(...trackIds);
      const rowMap = new Map();
      rows.forEach(r => rowMap.set(r.id, formatTrack(r)));
      tracks = trackIds.map(tId => rowMap.get(tId)).filter(Boolean);
    }

    res.json(formatMix(mix, tracks));
  } catch (err) {
    console.error('Error fetching mix:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/charts
 * Get top tracks by play count
 */
app.get('/api/charts', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const rows = db.prepare('SELECT * FROM tracks ORDER BY play_count DESC, id ASC LIMIT ?').all(limit);
    res.json(rows.map(formatTrack));
  } catch (err) {
    console.error('Error fetching charts:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/genres
 * List available genres with track counts
 */
app.get('/api/genres', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT genre, COUNT(*) as track_count 
      FROM tracks 
      WHERE genre IS NOT NULL AND genre != '' 
      GROUP BY genre 
      ORDER BY track_count DESC
    `).all();

    const genres = rows.map(r => ({
      name: r.genre,
      genre: r.genre,
      trackCount: r.track_count
    }));
    res.json(genres);
  } catch (err) {
    console.error('Error fetching genres:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/moods
 * List available moods
 */
app.get('/api/moods', (req, res) => {
  try {
    const moods = [
      { id: 'chill', name: 'Chill & Relax', color: '#4facfe', icon: 'coffee' },
      { id: 'focus', name: 'Enfoque & Trabajo', color: '#43e97b', icon: 'brain' },
      { id: 'energy', name: 'Energía & Gym', color: '#ff5858', icon: 'zap' },
      { id: 'party', name: 'Fiesta & Noche', color: '#f857a6', icon: 'sparkles' },
      { id: 'melancholy', name: 'Melancolía', color: '#667eea', icon: 'cloud-rain' },
      { id: 'discovery', name: 'Descubrimiento', color: '#fa709a', icon: 'compass' }
    ];
    res.json(moods);
  } catch (err) {
    console.error('Error fetching moods:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /api/stream/:id
 * Stream audio file for track ID with HTTP 206 Byte-Range seeking support
 */
app.get('/api/stream/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid track ID' });
    }

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    if (!track) {
      return res.status(404).json({ error: 'Track not found in database', trackId: id });
    }

    // Determine target audio file path
    let targetPath = track.file_path;
    if (!targetPath || !fs.existsSync(targetPath)) {
      const p1 = path.join(musicDir, `track_${id}.mp3`);
      const p2 = path.join(musicDir, `${id}.mp3`);
      if (fs.existsSync(p1)) {
        targetPath = p1;
      } else if (fs.existsSync(p2)) {
        targetPath = p2;
      }
    }

    // If local file doesn't exist on disk, stream live via external search fallback
    if (!targetPath || !fs.existsSync(targetPath)) {
      const query = (track.artist && track.title) ? `${track.artist} - ${track.title}` : (track.title || 'musica');
      console.log(`[Stream] Track ${id} not found locally on disk. Streaming live from search: "${query}"`);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');

      const ytdlpArgs = withCookies([
        '--no-playlist',
        '--no-progress',
        '--quiet',
        '--no-warnings',
        '-f', 'bestaudio/best',
        '-o', '-'
      ]);
      ytdlpArgs.push(`ytsearch1:${query}`);
      const proc = spawn(YTDLP_BIN, ytdlpArgs);

      if (FFMPEG_BIN && fs.existsSync(FFMPEG_BIN)) {
        const ffmpegArgs = ['-i', 'pipe:0', '-vn', '-f', 'mp3', '-acodec', 'libmp3lame', '-b:a', '192k', 'pipe:1'];
        const ffmpegProc = spawn(FFMPEG_BIN, ffmpegArgs);
        proc.stdout.pipe(ffmpegProc.stdin);
        ffmpegProc.stdout.pipe(res);
        proc.on('error', () => {});
        ffmpegProc.on('error', () => {});
        res.on('close', () => {
          try { proc.kill(); } catch (e) {}
          try { ffmpegProc.kill(); } catch (e) {}
        });
      } else {
        proc.stdout.pipe(res);
        proc.on('error', () => {});
        res.on('close', () => {
          try { proc.kill(); } catch (e) {}
        });
      }
      return;
    }

    const stat = fs.statSync(targetPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Byte range request (Seeking support)
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).set({
          'Content-Range': `bytes */${fileSize}`
        }).send('Requested Range Not Satisfiable');
        return;
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(targetPath, { start, end });
      const headers = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg'
      };

      res.writeHead(206, headers);
      fileStream.pipe(res);
    } else {
      // Full file stream
      const headers = {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'audio/mpeg'
      };
      res.writeHead(200, headers);
      fs.createReadStream(targetPath).pipe(res);
    }
  } catch (err) {
    console.error(`Error streaming track ID ${req.params.id}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming error', message: err.message });
    }
  }
});

/**
 * POST /api/upload
 * Upload audio file or artwork into music directory
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({
      success: true,
      filename: req.file.filename,
      filePath: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'File upload failed', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Social Endpoints (Registration, Login, User Profile)
// ---------------------------------------------------------------------------

/**
 * POST /api/users/register
 * Register user
 */
app.post('/api/users/register', (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email) {
      return res.status(400).json({ error: 'Username and email are required' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username.trim(), email.trim());
    if (existing) {
      return res.status(409).json({ error: 'User with this username or email already exists' });
    }

    const now = new Date().toISOString();
    const avatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80';
    const passwordHash = Buffer.from(password || 'default_pass').toString('base64');

    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, avatar_url, bio, created_at)
      VALUES (?, ?, ?, ?, 'Melómano y explorador de Sonora Music', ?)
    `).run(username.trim(), email.trim(), passwordHash, avatar, now);

    const user = db.prepare('SELECT id, username, email, avatar_url, bio, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        createdAt: user.created_at
      },
      token: `sonora_jwt_token_${user.id}_${Date.now()}`
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed', message: err.message });
  }
});

/**
 * POST /api/users/login
 * User login
 */
app.post('/api/users/login', (req, res) => {
  try {
    const { username, email } = req.body;
    const identifier = (username || email || '').trim();
    if (!identifier) {
      return res.status(400).json({ error: 'Username or email is required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      success: true,
      message: 'Logged in successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        createdAt: user.created_at
      },
      token: `sonora_jwt_token_${user.id}_${Date.now()}`
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', message: err.message });
  }
});

/**
 * GET /api/users/:id/profile
 * Get user profile and metadata
 */
app.get('/api/users/:id/profile', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = db.prepare('SELECT id, username, email, avatar_url, bio, created_at FROM users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const playlists = db.prepare('SELECT * FROM playlists WHERE owner_id = ?').all(id);
    const historyRow = db.prepare('SELECT COUNT(*) as count FROM history WHERE user_id = ?').get(id);
    const historyCount = historyRow ? historyRow.count : 0;

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      createdAt: user.created_at,
      playlistsCount: playlists.length,
      historyCount: historyCount,
      playlists: playlists.map(p => formatPlaylist(p))
    });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * PUT /api/users/:id/profile
 * Update user profile
 */
app.put('/api/users/:id/profile', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const username = req.body.username !== undefined ? req.body.username.trim() : user.username;
    const bio = req.body.bio !== undefined ? req.body.bio : user.bio;
    const avatarUrl = req.body.avatarUrl || req.body.avatar_url || user.avatar_url;

    db.prepare('UPDATE users SET username = ?, bio = ?, avatar_url = ? WHERE id = ?')
      .run(username, bio, avatarUrl, id);

    const updated = db.prepare('SELECT id, username, email, avatar_url, bio, created_at FROM users WHERE id = ?').get(id);
    res.json({
      success: true,
      user: {
        id: updated.id,
        username: updated.username,
        email: updated.email,
        avatarUrl: updated.avatar_url,
        bio: updated.bio,
        createdAt: updated.created_at
      }
    });
  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Static Frontend Files & SPA Routing
// ---------------------------------------------------------------------------
app.use(express.static(publicDir));

// Fallback for SPA (non-API GET requests)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send('Sonora Music Server is running.');
  }
});

// 404 Handler for undefined API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `API endpoint ${req.method} ${req.originalUrl} does not exist.`
  });
});

// ---------------------------------------------------------------------------
// Global Error Handler (Never crash)
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Unhandled Server Error:`, err);
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message || 'An unexpected error occurred on the server.'
    });
  }
});

// Process-level crash prevention
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ---------------------------------------------------------------------------
// Server Start & Banner
// ---------------------------------------------------------------------------
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('----------------------------------------------------');
  console.log('🎵 Sonora Music Server v7.6.2');
  console.log(`📡 Mode: ${isRender ? 'Render' : 'Local'}`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`📁 Music directory: ${musicDir}`);
  console.log(`💾 Database: ${dbPath}`);
  console.log('----------------------------------------------------');
});

module.exports = { app, server, db };
