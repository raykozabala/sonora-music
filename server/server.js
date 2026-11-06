/**
 * Sonora Music Server v7.17.0
 * Triple-mode backend server (Local PC, Render.com & Northflank compatible)
 * Express.js + SQLite (better-sqlite3) + Multer + Audio Streaming (HTTP 206)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const multer = require('multer');
const { spawn, execSync } = require('child_process');

// Determine Server Mode & Environment
const PORT = process.env.PORT || 3000;
const SERVER_MODE = (process.env.SERVER_MODE || (process.env.RENDER ? 'render' : (process.env.NORTHFLANK ? 'northflank' : 'local'))).toLowerCase();
const isRender = SERVER_MODE === 'render';
const isNorthflank = SERVER_MODE === 'northflank';

// Paths
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const publicDir = process.env.PUBLIC_DIR ? path.resolve(process.env.PUBLIC_DIR) : (fs.existsSync(path.resolve(__dirname, 'public')) ? path.resolve(__dirname, 'public') : path.resolve(__dirname, '../public'));
const musicDir = process.env.MUSIC_DIR ? path.resolve(process.env.MUSIC_DIR) : path.resolve(dataDir, 'music');
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(dataDir, 'sonora.db');

// Ensure directories exist
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
  }
} catch (err) {
  console.error('[Startup] Failed to create directories:', err);
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
      server: isNorthflank ? 'northflank' : (isRender ? 'render' : 'local'),
      uptime: Math.floor(process.uptime()),
      version: '7.17.0',
      mode: SERVER_MODE,
      connected: true
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

// Deno es el runtime de JavaScript que yt-dlp usa para resolver los desafíos
// de YouTube (nsig / PO token). Sin él, en servidores como Render la
// extracción falla con "Requested format is not available".
const DENO_BIN = findBinary('deno');

/** Ejecuta un comando corto y devuelve la salida, o '' si falla. */
function safeExec(cmd, timeoutMs) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: timeoutMs || 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return '';
  }
}

/**
 * Cookies de YouTube.
 * Cuando la IP del servidor está marcada por YouTube ("Sign in to confirm
 * you're not a bot", habitual en Render) hacen falta cookies de una sesión.
 * Se pueden subir como Secret File o pasar en base64 por variable de entorno.
 */
const COOKIES_CANDIDATES = [
  process.env.YTDLP_COOKIES_FILE,
  '/etc/secrets/youtube-cookies.txt',
  '/etc/secrets/cookies.txt',
  '/tmp/sonora-cookies.txt',
  path.join(__dirname, 'cookies.txt'),
  path.join(process.cwd(), 'cookies.txt')
].filter(Boolean);

if (process.env.YTDLP_COOKIES_B64) {
  try {
    const decoded = Buffer.from(String(process.env.YTDLP_COOKIES_B64).trim(), 'base64');
    if (decoded.length > 50) {
      fs.writeFileSync('/tmp/sonora-cookies.txt', decoded);
      const looksValid = decoded.toString('utf8').indexOf('youtube.com') !== -1;
      console.log('[Cookies] base64 -> ' + decoded.length + ' bytes, válido=' + looksValid);
      if (!looksValid) {
        console.error('[Cookies] ⚠️ YTDLP_COOKIES_B64 no parece un cookies.txt válido');
      }
    } else {
      console.error('[Cookies] ⚠️ YTDLP_COOKIES_B64 demasiado corto: ' + decoded.length + ' bytes');
    }
  } catch (e) {
    console.warn('[Cookies] YTDLP_COOKIES_B64 no se pudo decodificar:', e.message);
  }
}

// yt-dlp reescribe el archivo de cookies, así que trabajamos sobre una copia
// escribible: los Secret Files de Render son de solo lectura.
const WRITABLE_COOKIES = '/tmp/sonora-cookies-rw.txt';
let COOKIES_PATH = null;

(function prepareCookies() {
  try {
    let src = null;
    for (const candidate of COOKIES_CANDIDATES) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).size > 50) { src = candidate; break; }
      } catch (e) {}
    }
    if (!src) {
      console.warn('[Cookies] sin cookies: YouTube puede bloquear las descargas desde este servidor');
      return;
    }
    if (path.resolve(src) !== path.resolve(WRITABLE_COOKIES)) {
      fs.copyFileSync(src, WRITABLE_COOKIES);
      try { fs.chmodSync(WRITABLE_COOKIES, 0o600); } catch (e) {}
    }
    COOKIES_PATH = WRITABLE_COOKIES;
    console.log('[Cookies] listas | origen=' + src + ' | copia=' + WRITABLE_COOKIES);
  } catch (e) {
    console.warn('[Cookies] error preparando las cookies:', e.message);
    COOKIES_PATH = null;
  }
})();

/** Añade las cookies a los argumentos de yt-dlp si están disponibles. */
function withCookies(args) {
  const base = COOKIES_PATH ? ['--cookies', COOKIES_PATH].concat(args) : args.slice();
  // Proxy opcional (http://usuario:clave@host:puerto). Sirve para salir por
  // una IP residencial cuando YouTube bloquea la IP del servidor.
  if (process.env.YTDLP_PROXY) {
    return ['--proxy', process.env.YTDLP_PROXY].concat(base);
  }
  return base;
}

/** Clientes de YouTube a probar, del más compatible al más específico. */
const YT_CLIENT_FALLBACKS = [null, 'tv_embedded', 'android_vr'];
const YT_FALLBACK_ERROR = /sign in to confirm|not a bot|requested format|no video formats|unable to extract|player response|403|410/i;

(function logJsRuntimeStatus() {
  const deno = safeExec('"' + DENO_BIN + '" --version');
  if (deno) console.log('[JS] deno disponible: ' + deno.split('\n')[0]);
  else console.warn('[JS] SIN deno: yt-dlp no podrá resolver los desafíos de YouTube');
})();

/**
 * GET /api/system
 * Diagnóstico de binarios y cookies (sin exponer el contenido de las cookies).
 */
app.get('/api/system', (req, res) => {
  const ytdlpVersion = safeExec('"' + YTDLP_BIN + '" --version');
  const ffmpegRaw = safeExec('"' + FFMPEG_BIN + '" -version');
  const denoRaw = safeExec('"' + DENO_BIN + '" --version');
  let cookies = { available: false, path: null };
  if (COOKIES_PATH) {
    try {
      const buf = fs.readFileSync(COOKIES_PATH);
      const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
      cookies = {
        available: true,
        path: COOKIES_PATH,
        size: buf.length,
        sha256: sha,
        valid: buf.toString('utf8').indexOf('youtube.com') !== -1
      };
    } catch (e) {
      cookies = { available: false, path: COOKIES_PATH, error: e.message };
    }
  }
  res.json({
    status: 'ok',
    mode: SERVER_MODE,
    node: process.version,
    platform: process.platform,
    version: '7.17.0',
    ytdlp: { path: YTDLP_BIN, available: !!ytdlpVersion, version: ytdlpVersion || null },
    ffmpeg: { path: FFMPEG_BIN, available: !!ffmpegRaw, version: ffmpegRaw ? ffmpegRaw.split('\n')[0] : null },
    deno: { path: DENO_BIN, available: !!denoRaw, version: denoRaw ? denoRaw.split('\n')[0] : null },
    cookies: cookies
  });
});

/**
 * GET /api/ytdiag?id=VIDEO_ID
 * Prueba varios "player clients" de YouTube y devuelve cuáles funcionan.
 * Sirve para diagnosticar bloqueos desde Render.
 */
app.get('/api/ytdiag', async (req, res) => {
  const id = String(req.query.id || 'kXYiU_JCYtU').replace(/[^A-Za-z0-9_-]/g, '');
  const videoUrl = 'https://www.youtube.com/watch?v=' + id;
  const clients = ['default', 'android_vr', 'tv_embedded', 'mweb', 'web_safari'];
  const results = {};
  // Se prueba con cookies (si existen) y sin ellas: así se distingue un
  // bloqueo por IP de unas cookies caducadas.
  const modes = COOKIES_PATH ? ['cookies', 'nocookies'] : ['nocookies'];
  for (const mode of modes) {
    results[mode] = {};
    for (const client of clients) {
      const args = ['--no-playlist', '--no-warnings', '--quiet', '-f', 'bestaudio[ext=m4a]/bestaudio/best', '--get-url'];
      if (client !== 'default') args.push('--extractor-args', 'youtube:player_client=' + client);
      args.push(videoUrl);
      try {
        const { stdout } = await runYtDlp(args, 45000, mode === 'nocookies');
        const direct = stdout.trim().split(/\r?\n/)[0] || '';
        results[mode][client] = {
          ok: !!direct,
          host: (direct.match(/^https?:\/\/([^/]+)/) || [])[1] || null
        };
      } catch (e) {
        results[mode][client] = { ok: false, error: String(e.message).slice(0, 160) };
      }
    }
  }
  res.json({ id: id, mode: SERVER_MODE, proxy: !!process.env.YTDLP_PROXY, results: results });
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

/* ──────────────────────────────────────────────────────────────────────────
   LETRAS — resolución multi-proveedor con coincidencia estricta
   ──────────────────────────────────────────────────────────────────────────
   Reglas:
   - Nunca elegir una canción solo por artista.
   - La duración forma parte de la clave de caché.
   - Se rechaza cualquier candidato cuyo título no coincida o cuya duración
     se aleje demasiado (evita versiones en vivo, covers y canciones distintas).
   - Se lanzan todas las fuentes en paralelo y gana la primera letra
     sincronizada válida.
   ────────────────────────────────────────────────────────────────────────── */

const _lyricsCache = new Map();
const LYRICS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const LYRICS_CACHE_MAX = 3000;

const NETEASE_COOKIE = 'NMTID=00OAVK3xqDG726ITU6jopU6jF2yMk0AAAGCO8l1BA; JSESSIONID-WYYY=8KQo11YK2GZP45RMlz8Kn80vHZ9%2FGvwzRKQXXy0iQoFKycWdBlQjbfT0MJrFa6hwRfmpfBYKeHliUPH287JC3hNW99WQjrh9b9RmKT%2Fg1Exc2VwHZcsqi7ITxQgfEiee50po28x5xTTZXKoP%2FRMctN2jpDeg57kdZrXz%2FD%2FWghb%5C4DuZ%3A1659124633932; _iuqxldmzr_=32; _ntes_nnid=0db6667097883aa9596ecfe7f188c3ec,1659122833973; _ntes_nuid=0db6667097883aa9596ecfe7f188c3ec; WNMCID=xygast.1659122837568.01.0; WEVNSM=1.0.0';

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lyrics_cache (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
} catch (err) {
  console.warn('[Lyrics] No se pudo crear la caché persistente:', err.message);
}

function lyricsCacheGet(key) {
  if (_lyricsCache.has(key)) return _lyricsCache.get(key);

  try {
    const row = db.prepare('SELECT payload, updated_at FROM lyrics_cache WHERE key = ?').get(key);
    if (row && row.payload && (Date.now() - Number(row.updated_at || 0)) < LYRICS_CACHE_TTL) {
      const parsed = JSON.parse(row.payload);
      _lyricsCache.set(key, parsed);
      return parsed;
    }
  } catch (err) {}

  return null;
}

function lyricsCacheSet(key, payload) {
  _lyricsCache.set(key, payload);
  if (_lyricsCache.size > LYRICS_CACHE_MAX) {
    const first = _lyricsCache.keys().next();
    if (!first.done) _lyricsCache.delete(first.value);
  }

  try {
    db.prepare('INSERT OR REPLACE INTO lyrics_cache (key, payload, updated_at) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(payload), Date.now());
  } catch (err) {}
}

function lyricsSafeString(value) {
  return value === null || value === undefined ? '' : String(value);
}

function lyricsSqueeze(value) {
  return lyricsSafeString(value).replace(/\s+/g, ' ').trim();
}

function lyricsLower(value) {
  try {
    return lyricsSqueeze(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[’'`´]/g, "'");
  } catch (err) {
    return lyricsSqueeze(value).toLowerCase();
  }
}

function lyricsWords(value) {
  return lyricsLower(value)
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function lyricsCleanTitle(value) {
  let text = lyricsSqueeze(value);
  if (!text) return '';

  const noise = /[\(\[\{][^\)\]\}]*(?:official|oficial|lyric|letra|video|audio|visualizer|visualiser|remaster|remastered|hd|hq|4k|8k|en\s*vivo|live|concert|cover|karaoke|instrumental|sped\s*up|slowed|reverb|nightcore|sub(?:titulad[oa]s?)?|traducci[oó]n|espa[nñ]ol|english|ingl[eé]s)[^\)\]\}]*[\)\]\}]/gi;

  text = text.replace(/\s*\|\s*(?:official|oficial|video|audio|lyrics?|letra).*$/i, '');
  text = text.replace(noise, ' ');
  text = text.replace(/\b(?:official\s*(?:music\s*)?video|official\s*audio|lyric\s*video|visualizer|visualiser|letra|subtitulad[oa]s?|en\s*vivo)\b/gi, ' ');
  text = text.replace(/\s*[-–—]\s*(?:official|oficial|lyric|letra|audio|video)\b.*$/i, ' ');
  text = text.replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.*$/i, ' ');
  text = text.replace(/\s*[-–—]\s*topic\s*$/i, ' ');

  return lyricsSqueeze(text);
}

function lyricsCleanArtist(value) {
  let text = lyricsSqueeze(value);
  if (!text) return '';
  text = text.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');
  text = text.replace(/\s*[-–—]\s*topic\s*$/i, ' ');
  text = text.replace(/\bvevo\b/gi, ' ');
  text = text.replace(/\bofficial\b/gi, ' ');
  return lyricsSqueeze(text);
}

const LYRICS_GENERIC_ARTISTS = new Set([
  '', 'youtube', 'youtube music', 'sonora', 'sonora music', 'topic', 'vevo',
  'unknown', 'unknown artist', 'various artists', 'desconocido', 'artista desconocido'
]);

function lyricsIsGenericArtist(value) {
  return LYRICS_GENERIC_ARTISTS.has(lyricsLower(value));
}

// Palabras que identifican una versión distinta de la misma canción.
// Si la pista es "Song (Live)", no se debe usar la letra del estudio.
const LYRICS_VERSION_WORDS_RE = /\b(live|en vivo|remix|cover|karaoke|instrumental|acoustic|demo|sped up|slowed|nightcore|reverb)\b/gi;

function lyricsVersionWords(value) {
  const text = lyricsLower(value);
  const out = [];
  let match;
  LYRICS_VERSION_WORDS_RE.lastIndex = 0;
  while ((match = LYRICS_VERSION_WORDS_RE.exec(text)) !== null) out.push(match[1]);
  return out;
}

function lyricsHasVersionMismatch(candidateTitle, requestedVersions) {
  const candidateVersions = lyricsVersionWords(candidateTitle);
  const requested = requestedVersions || [];

  for (const word of candidateVersions) {
    if (!requested.includes(word)) return true;
  }
  for (const word of requested) {
    if (!candidateVersions.includes(word)) return true;
  }

  return false;
}

function lyricsSplitArtistTitle(rawTitle, rawArtist) {
  let title = lyricsSqueeze(rawTitle);
  let artist = lyricsSqueeze(rawArtist);

  const generic = !artist || ['youtube', 'youtube music', 'sonora', 'sonora music', 'topic', 'vevo', 'unknown', 'unknown artist', 'various artists', 'desconocido'].includes(lyricsLower(artist));
  const parts = title.split(/\s+[-–—]\s+/);

  if (parts.length >= 2 && generic) {
    const maybeArtist = parts[0].trim();
    if (maybeArtist.length <= 60) {
      artist = maybeArtist;
      title = parts.slice(1).join(' - ').trim();
    }
  }

  if (artist && lyricsLower(title).indexOf(lyricsLower(artist) + ' - ') === 0) {
    title = title.slice(artist.length + 3).trim();
  }

  artist = artist.replace(/\s*[-–—]\s*topic\s*$/i, '').trim();
  return { title, artist };
}

function lyricsTitleSimilarity(a, b) {
  const left = lyricsLower(a);
  const right = lyricsLower(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftWords = lyricsWords(left);
  const rightWords = lyricsWords(right);
  if (!leftWords.length || !rightWords.length) return 0;

  const smaller = leftWords.length <= rightWords.length ? leftWords : rightWords;
  const bigger = leftWords.length <= rightWords.length ? rightWords : leftWords;
  const map = new Map();
  bigger.forEach(word => map.set(word, (map.get(word) || 0) + 1));

  let hits = 0;
  smaller.forEach(word => {
    const count = map.get(word) || 0;
    if (count > 0) { map.set(word, count - 1); hits++; }
  });

  const containment = hits / smaller.length;
  const prefix = (left.indexOf(right) === 0 || right.indexOf(left) === 0) ? 0.97 : 0;
  const compactLeft = leftWords.join('');
  const compactRight = rightWords.join('');
  const compact = (compactLeft.indexOf(compactRight) !== -1 || compactRight.indexOf(compactLeft) !== -1) ? 0.92 : 0;

  return Math.max(containment, prefix, compact);
}

function lyricsArtistSimilarity(a, b) {
  const left = lyricsLower(a);
  const right = lyricsLower(b);
  if (!left || !right) return 0.6;
  if (left === right) return 1;

  const leftWords = lyricsWords(left);
  const rightWords = lyricsWords(right);
  if (!leftWords.length || !rightWords.length) return 0.6;

  const smaller = leftWords.length <= rightWords.length ? leftWords : rightWords;
  const bigger = leftWords.length <= rightWords.length ? rightWords : leftWords;
  const map = new Map();
  bigger.forEach(word => map.set(word, (map.get(word) || 0) + 1));

  let hits = 0;
  smaller.forEach(word => {
    const count = map.get(word) || 0;
    if (count > 0) { map.set(word, count - 1); hits++; }
  });

  return hits / smaller.length;
}

function lyricsScore(candidate, info) {
  const title = candidate.title || '';
  const artist = candidate.artist || '';
  const duration = Number(candidate.duration) || 0;
  const genericRequested = lyricsIsGenericArtist(info.artist);
  const hasArtist = !!lyricsSqueeze(artist);

  const titleScore = lyricsTitleSimilarity(info.title, title);
  const artistScore = (!genericRequested && info.artist && hasArtist)
    ? lyricsArtistSimilarity(info.artist, artist)
    : 0.6;
  const normalizedArtistScore = (hasArtist && title && lyricsLower(artist).includes(lyricsLower(title)))
    ? Math.min(artistScore, 0.3)
    : artistScore;
  const durationDiff = (info.duration > 0 && duration > 0) ? Math.abs(info.duration - duration) : null;

  let score = normalizedArtistScore * 20 + titleScore * 70;
  if (durationDiff !== null) score += Math.max(0, 10 - Math.min(10, durationDiff / 2));
  if (candidate.syncedLyrics) {
    score += 8;
    // Preferir letras con timestamps por palabra.
    if (/<\d{1,3}:\d{2}/.test(candidate.syncedLyrics)) score += 6;
  } else if (candidate.plainLyrics) {
    score += 2;
  }

  let ok = true;
  if (!candidate.syncedLyrics && !candidate.plainLyrics) ok = false;
  if (titleScore < 0.58) ok = false;

  // Una versión distinta (live, remix, cover, karaoke...) tiene otra letra y
  // otro tiempo: no se debe usar para esta pista.
  if (lyricsHasVersionMismatch(title, info.versions)) ok = false;

  // Fuentes que no distinguen versiones (lyrics.ovh) no sirven para pistas
  // que piden explícitamente una versión concreta.
  if (candidate.versionAgnostic && Array.isArray(info.versions) && info.versions.length) ok = false;

  // El artista debe coincidir. Si la fuente no lo trae o el artista de la
  // pista es genérico, solo se acepta con duración muy compatible.
  if (!genericRequested && hasArtist) {
    if (normalizedArtistScore < 0.45) ok = false;
  } else {
    const durationConfirmed = info.duration > 0 && duration > 0 && Math.abs(info.duration - duration) <= 5;
    if (!durationConfirmed) ok = false;
  }

  if (durationDiff !== null && durationDiff > 12 && (titleScore < 0.97 || (Array.isArray(info.versions) && info.versions.length))) ok = false;

  // Sin título/artista de la fuente solo se acepta si la duración confirma
  // que se trata de la misma canción.
  if (candidate.metadataMissing) {
    const metaDurationConfirmed = info.duration > 0 && duration > 0 && Math.abs(info.duration - duration) <= 5;
    if (!metaDurationConfirmed) ok = false;
    else score -= 25;
  }

  return { ok, score, titleScore, artistScore: normalizedArtistScore, durationDiff };
}

const LYRICS_CREDIT_RE = /^\s*(?:作词|作曲|制作|编曲|录音|混音|母带|吉他|贝斯|鼓|键盘|和声|策划|出品|监制|发行|词|曲|演唱|原唱|lyrics?\s*by|composed\s*by|written\s*by|produced\s*by|arranged\s*by|music\s*by|songwriters?)\s*[:：]/i;

function lyricsIsCredit(text) {
  return LYRICS_CREDIT_RE.test(lyricsSafeString(text));
}

function lyricsFormatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes < 10 ? '0' : ''}${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(2)}`;
}

function lyricsParseDuration(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  const text = lyricsSqueeze(value);
  if (!text) return 0;
  const parts = text.split(':').map(part => parseFloat(part));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  const direct = parseFloat(text);
  return isFinite(direct) ? direct : 0;
}

function lyricsPlainFromLrc(lrc) {
  return lyricsSafeString(lrc)
    .split('\n')
    .map(line => line.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim())
    .filter(line => line.length > 0 && !lyricsIsCredit(line))
    .join('\n');
}

async function lyricsFetchJson(url, timeoutMs = 4000, retries = 1, extraHeaders = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: Object.assign({
          'User-Agent': 'SonoraMusic/7.17.0 (https://sonora-music.app)',
          'Accept': 'application/json'
        }, extraHeaders),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.status === 429 || response.status === 503) {
        if (attempt < retries) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
          await new Promise(resolve => setTimeout(resolve, Math.min(2500, (retryAfter > 0 ? retryAfter * 1000 : 700) + attempt * 150)));
          continue;
        }
        return null;
      }

      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }

  return null;
}

/**
 * Detecta cabeceras de créditos que algunas fuentes (QQ Music) entregan como
 * si fueran la primera línea de la letra: "Título - Artista", el nombre del
 * artista, listas de compositores separadas por "/" o líneas muy cortas.
 */
function lyricsLooksLikeLeadingCredit(text, lineDurationMs, effectiveTitle, effectiveArtist) {
  const low = lyricsLower(text);
  if (!low) return true;

  const titleLow = lyricsLower(effectiveTitle);
  const artistLow = lyricsLower(effectiveArtist);

  if (artistLow && low === artistLow) return true;
  if (titleLow && low === titleLow) return true;

  if (titleLow && artistLow
    && low.includes(titleLow)
    && low.includes(artistLow)
    && text.length <= String(effectiveTitle).length + String(effectiveArtist).length + 30) {
    return true;
  }

  // Líneas tipo "Nombre/Apellido/Nombre/Apellido" (compositores).
  const slashParts = text.split('/').map(part => part.trim()).filter(Boolean);
  if (slashParts.length >= 2) {
    const personLike = slashParts.every(part => {
      const pieces = part.split(/\s+/).filter(Boolean);
      if (!pieces.length || pieces.length > 4) return false;
      return pieces.every(piece =>
        /^[A-ZÀ-Þ][a-zà-ÿ'’.\-]*$/.test(piece) || /^[A-Z]{2,4}$/.test(piece)
      );
    });
    if (personLike) return true;

    if (slashParts.length >= 3) {
      const nameLike = slashParts.filter(part => /^[A-Za-zÀ-ÿ'".\- ]{3,}$/.test(part)).length;
      if (nameLike >= Math.max(2, slashParts.length - 1)) return true;
    }
  }

  // Créditos con duración casi nula (p. ej. 36–90 ms).
  const numericDuration = Number(lineDurationMs);
  if (numericDuration > 0 && numericDuration < 200) return true;

  return false;
}

async function lyricsFromLyricsPlus(artist, title, duration) {
  const url = `https://lyricsplus.prjktla.my.id/v2/lyrics/get?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&duration=${Math.round(duration || 0)}`;
  const data = await lyricsFetchJson(url, 5000, 1);
  if (!data || !Array.isArray(data.lyrics) || !data.lyrics.length) return null;

  const meta = data.metadata || {};
  let metaTitle = lyricsCleanTitle(meta.title);
  let metaArtist = lyricsCleanArtist(meta.artist);
  if (lyricsLower(metaTitle) === 'none') metaTitle = '';
  if (lyricsLower(metaArtist) === 'none') metaArtist = '';
  const effectiveTitle = metaTitle || title;
  const effectiveArtist = metaArtist || artist;
  const metadataMissing = !metaTitle || !metaArtist;
  const lines = [];
  let leading = true;

  for (const item of data.lyrics) {
    if (!item) continue;
    const time = Number(item.time);
    if (!isFinite(time) || time < 0) continue;

    const text = lyricsSqueeze(item.text);
    if (!text || lyricsIsCredit(text)) continue;

    if (leading) {
      if (lyricsLooksLikeLeadingCredit(text, item.duration, effectiveTitle, effectiveArtist)) continue;
      leading = false;
    }

    let wordList = null;
    if (Array.isArray(item.syllabus) && item.syllabus.length) {
      wordList = [];
      for (const syllable of item.syllabus) {
        if (!syllable) continue;
        const wordTime = Number(syllable.time);
        if (!isFinite(wordTime)) continue;
        const wordText = lyricsSafeString(syllable.text);
        if (!wordText) continue;
        wordList.push({
          time: wordTime / 1000,
          duration: (Number(syllable.duration) || 0) / 1000,
          text: wordText
        });
      }
      if (!wordList.length) wordList = null;
    }

    lines.push({ time: time / 1000, text, words: wordList });
  }

  if (!lines.length) return null;
  lines.sort((a, b) => a.time - b.time);

  const syncedLyrics = lines.map(line => {
    const head = `[${lyricsFormatTime(line.time)}]`;
    const body = line.words && line.words.length
      ? line.words.map(word => `<${lyricsFormatTime(word.time)}>${word.text}`).join('')
      : line.text;
    return head + body;
  }).join('\n');

  return {
    syncedLyrics,
    plainLyrics: lines.map(line => line.text).join('\n'),
    title: effectiveTitle,
    artist: effectiveArtist,
    duration: lyricsParseDuration(meta.totalDuration),
    metadataMissing,
    source: 'lyricsplus'
  };
}

async function lyricsFromLrclibExact(artist, title, duration) {
  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set('artist_name', artist);
  if (duration > 0) params.set('duration', String(Math.round(duration)));

  const data = await lyricsFetchJson(`https://lrclib.net/api/get?${params.toString()}`, 4000, 1);
  if (!data || data.statusCode || !data.trackName) return null;
  if (!data.syncedLyrics && !data.plainLyrics) return null;

  return {
    syncedLyrics: data.syncedLyrics || null,
    plainLyrics: data.plainLyrics || null,
    title: data.trackName,
    artist: data.artistName || artist,
    duration: Number(data.duration) || duration,
    source: 'lrclib'
  };
}

async function lyricsFromLrclibSearch(artist, title, duration) {
  const query = [artist, title].filter(Boolean).join(' ');
  let list = await lyricsFetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, 4000, 1);

  if (!Array.isArray(list) || !list.length) {
    list = await lyricsFetchJson(`https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}`, 4000, 0);
  }
  if (!Array.isArray(list) || !list.length) return null;

  const info = { title, artist, duration };
  let best = null;
  let bestScore = -1;

  for (const item of list) {
    if (!item) continue;
    const candidate = {
      syncedLyrics: item.syncedLyrics || null,
      plainLyrics: item.plainLyrics || null,
      title: item.trackName || '',
      artist: item.artistName || '',
      duration: Number(item.duration) || 0,
      source: 'lrclib-search'
    };
    const scored = lyricsScore(candidate, info);
    if (!scored.ok) continue;
    if (scored.score > bestScore) {
      bestScore = scored.score;
      best = candidate;
    }
  }

  return best;
}

async function lyricsFromNetEase(artist, title, duration) {
  const query = [artist, title].filter(Boolean).join(' ');
  const searchUrl = `https://music.163.com/api/search/pc?${new URLSearchParams({
    limit: '10',
    type: '1',
    offset: '0',
    s: query
  }).toString()}`;

  const data = await lyricsFetchJson(searchUrl, 4000, 1, {
    'Cookie': NETEASE_COOKIE,
    'Referer': 'https://music.163.com/'
  });

  const songs = data && data.result && Array.isArray(data.result.songs) ? data.result.songs : [];
  if (!songs.length) return null;

  const info = { title, artist, duration };
  let best = null;
  let bestScore = -1;

  for (const song of songs) {
    if (!song) continue;
    const songArtists = Array.isArray(song.artists) ? song.artists.map(a => a && a.name).filter(Boolean).join(', ') : '';
    const candidate = {
      title: song.name || '',
      artist: songArtists,
      duration: (Number(song.duration) || 0) / 1000
    };
    const scored = lyricsScore(candidate, info);
    if (!scored.ok) continue;
    if (scored.score > bestScore) {
      bestScore = scored.score;
      best = song;
    }
  }

  if (!best) return null;

  const lyricUrl = `https://music.163.com/api/song/lyric?id=${best.id}&lv=1&kv=1&tv=-1`;
  const lyricData = await lyricsFetchJson(lyricUrl, 4000, 0, {
    'Cookie': NETEASE_COOKIE,
    'Referer': 'https://music.163.com/'
  });

  const lrc = lyricData && lyricData.lrc && lyricData.lrc.lyric ? lyricData.lrc.lyric : '';
  if (!lrc || lrc.indexOf('[') === -1) return null;

  return {
    syncedLyrics: lrc,
    plainLyrics: lyricsPlainFromLrc(lrc),
    title: best.name || title,
    artist: (Array.isArray(best.artists) ? best.artists.map(a => a && a.name).filter(Boolean).join(', ') : artist),
    duration: (Number(best.duration) || 0) / 1000,
    source: 'netease'
  };
}

async function lyricsFromOvh(artist, title, duration) {
  if (!artist || !title) return null;
  const data = await lyricsFetchJson(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
    3500,
    0
  );
  if (!data || !data.lyrics) return null;

  return {
    syncedLyrics: null,
    plainLyrics: lyricsSafeString(data.lyrics).trim(),
    title,
    artist,
    duration,
    // lyrics.ovh no distingue versiones: sólo se usa cuando la pista pedida
    // no declara live/remix/cover/etc.
    versionAgnostic: true,
    source: 'lyricsovh'
  };
}

function resolveLyrics(info) {
  return new Promise(resolve => {
    let settled = false;
    let bestPlain = null;
    let bestSynced = null;
    let syncedGraceTimer = null;
    let remaining = 5;

    const found = [];

    const deadline = setTimeout(() => finish(), 7000);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (syncedGraceTimer) clearTimeout(syncedGraceTimer);

      if (bestSynced) found.push(bestSynced);
      if (bestPlain) found.push(bestPlain);
      found.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
      resolve(found);
    }

    function handle(candidate) {
      if (settled) return;

      if (candidate) {
        const scored = lyricsScore(candidate, info);
        if (scored.ok) {
          candidate.score = scored.score;

          if (candidate.syncedLyrics) {
            // Si ya hay timestamps por palabra, es la mejor opción.
            if (/<\d{1,3}:\d{2}/.test(candidate.syncedLyrics)) {
              found.push(candidate);
              finish();
              return;
            }

            if (!bestSynced || candidate.score > bestSynced.score) bestSynced = candidate;
            if (!syncedGraceTimer) {
              syncedGraceTimer = setTimeout(finish, 220);
            }
            remaining--;
            if (remaining <= 0) finish();
            return;
          }

          if (!bestPlain) bestPlain = candidate;
        }
      }

      remaining--;
      if (remaining <= 0) finish();
    }

    const tasks = [
      lyricsFromLyricsPlus(info.artist, info.title, info.duration),
      lyricsFromLrclibExact(info.artist, info.title, info.duration),
      lyricsFromLrclibSearch(info.artist, info.title, info.duration),
      lyricsFromNetEase(info.artist, info.title, info.duration),
      lyricsFromOvh(info.artist, info.title, info.duration)
    ];

    tasks.forEach(task => {
      task.then(handle).catch(() => handle(null));
    });
  });
}

/**
 * GET /api/lyrics
 * Resuelve la letra correcta por título + artista + duración.
 * Devuelve metadatos de la coincidencia para que el cliente pueda validarla.
 */
app.get('/api/lyrics', async (req, res) => {
  try {
    const rawArtist = String(req.query.artist || '').trim();
    const rawTitle = String(req.query.title || '').trim();
    const duration = parseFloat(req.query.duration) || 0;

    if (!rawTitle) {
      return res.status(400).json({ error: 'title is required' });
    }

    const split = lyricsSplitArtistTitle(rawTitle, rawArtist);
    const title = lyricsCleanTitle(split.title);
    const artist = lyricsCleanArtist(split.artist);

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const versions = lyricsVersionWords(rawTitle);
    const versionKey = versions.slice().sort().join(',');
    const cacheKey = `v5::${lyricsLower(artist)}::${lyricsLower(title)}::${duration > 0 ? Math.round(duration) : 0}::${versionKey}`;
    const cached = lyricsCacheGet(cacheKey);
    if (cached) {
      return res.json(Object.assign({}, cached, { cached: true }));
    }

    const found = await resolveLyrics({
      title,
      artist,
      duration,
      versions
    });
    if (!found.length) {
      return res.status(404).json({
        error: 'No se encontró una letra que coincida con la canción',
        found: false
      });
    }

    const best = found[0];
    const payload = {
      syncedLyrics: best.syncedLyrics || null,
      plainLyrics: best.plainLyrics || (best.syncedLyrics ? lyricsPlainFromLrc(best.syncedLyrics) : null),
      matchedTitle: best.title || title,
      matchedArtist: best.artist || artist,
      matchedDuration: Number(best.duration) || duration,
      source: best.source || 'unknown',
      score: Math.round(Number(best.score) || 0),
      cached: false
    };

    if (payload.syncedLyrics || payload.plainLyrics) {
      lyricsCacheSet(cacheKey, payload);
    }

    return res.json(payload);
  } catch (err) {
    console.warn('[Lyrics] API error:', err.message);
    return res.status(500).json({ error: 'Lyrics fetch failed', message: err.message });
  }
});

/**
 * GET /api/stream/external
 * Streams audio live for playback in Sonora with universal MP3 decoding and CORS
 */
app.get('/api/stream/external', async (req, res) => {
  try {
    let targetUrl = req.query.url;
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

    if (!targetUrl) return res.status(400).send('Falta url, id o q');

    // Calidad de audio elegida en Ajustes: 96/160/320 kbps.
    const requestedQuality = String(req.query.quality || '').toLowerCase();
    const audioBitrate = ['96k', '128k', '160k', '192k', '256k', '320k'].includes(requestedQuality)
      ? requestedQuality
      : ({ low: '96k', normal: '160k', high: '320k' }[requestedQuality] || '192k');

    const cacheKey = 'audio|' + String(targetUrl) + '|' + audioBitrate;

    // 1) Resolver la URL directa ANTES de escribir cabeceras. Así, si YouTube
    //    bloquea, el cliente recibe un 502 con explicación en vez de un 200
    //    vacío (que dejaba el reproductor colgado).
    const resolveAudio = async () => {
      const cached = videoCacheGet(cacheKey);
      if (cached) return cached;
      const { stdout } = await runYtDlpWithFallback([
        '--no-playlist', '--no-warnings', '--no-progress',
        '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        '-g', '--', String(targetUrl)
      ], 45000);
      const direct = stdout.trim().split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)[0];
      if (!direct) throw new Error('yt-dlp no devolvió una URL de audio');
      videoCacheSet(cacheKey, direct);
      return direct;
    };

    let direct;
    try {
      direct = await resolveAudio();
    } catch (e) {
      console.warn('[Stream] no se pudo resolver el audio:', e.message);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({
        error: 'No se pudo preparar el audio',
        message: e.message,
        hint: 'YouTube puede estar bloqueando el servidor; revisa /api/system y /api/ytdiag'
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');

    const startTranscode = (sourceUrl) => {
      // ffmpeg lee la URL firmada y devuelve MP3 con el bitrate elegido.
      const ffmpegArgs = [
        '-hide_banner', '-loglevel', 'error',
        '-i', sourceUrl,
        '-vn',
        '-f', 'mp3',
        '-acodec', 'libmp3lame',
        '-b:a', audioBitrate,
        '-ar', '44100',
        'pipe:1'
      ];
      return spawn(FFMPEG_BIN, ffmpegArgs);
    };

    let ffmpegProc = startTranscode(direct);
    let wroteBytes = false;
    let retried = false;

    ffmpegProc.stdout.on('data', (chunk) => {
      wroteBytes = true;
      res.write(chunk);
    });

    ffmpegProc.on('error', (err) => {
      console.error('[Stream] ffmpeg error:', err.message);
      if (!res.headersSent) res.status(500).send('Error en streaming');
      else { try { res.end(); } catch (e) {} }
    });

    ffmpegProc.on('close', (code) => {
      // La URL caducó o YouTube devolvió 403: se extrae de nuevo una vez.
      if (!wroteBytes && !retried) {
        retried = true;
        VIDEO_URL_CACHE.delete(cacheKey);
        resolveAudio().then((fresh) => {
          ffmpegProc = startTranscode(fresh);
          ffmpegProc.stdout.on('data', (chunk) => { wroteBytes = true; res.write(chunk); });
          ffmpegProc.on('close', () => { try { res.end(); } catch (e) {} });
          ffmpegProc.on('error', () => { try { res.end(); } catch (e) {} });
        }).catch((e) => {
          console.warn('[Stream] reintento falló:', e.message);
          try { res.status(502).json({ error: 'No se pudo preparar el audio', message: e.message }); }
          catch (_) { try { res.end(); } catch (e2) {} }
        });
        return;
      }
      if (!wroteBytes) {
        console.warn('[Stream] ffmpeg no produjo audio (código ' + code + ')');
      }
      try { res.end(); } catch (e) {}
    });

    res.on('close', () => {
      try { ffmpegProc.kill('SIGKILL'); } catch (e) {}
    });
  } catch (outerErr) {
    console.error('[Stream] Fatal route error:', outerErr);
    if (!res.headersSent) res.status(500).json({ error: 'Error interno en streaming', message: outerErr.message });
    else { try { res.end(); } catch (e) {} }
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   VIDEO — proxy de video/audio y subtítulos con yt-dlp
   El reproductor propio (public/js/video-player.js) pide dos pistas
   sincronizadas: mode=video y mode=audio. Estas rutas no existían y el
   cliente caía siempre al iframe de YouTube.
   ────────────────────────────────────────────────────────────────────────── */

const VIDEO_URL_CACHE = new Map();
const VIDEO_URL_TTL = 10 * 60 * 1000;

/** Ejecuta yt-dlp y devuelve stdout/stderr con timeout y limpieza. */
function runYtDlp(args, timeoutMs, noCookies) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    let proc;
    try {
      proc = spawn(YTDLP_BIN, noCookies ? args : withCookies(args));
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { proc.kill('SIGKILL'); } catch (e) {}
      reject(new Error('yt-dlp timeout'));
    }, timeoutMs || 20000);

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const lastLine = stderr.trim().split('\n').filter(Boolean).pop() || ('yt-dlp exited with ' + code);
        reject(new Error(lastLine));
      }
    });
  });
}

/**
 * Ejecuta yt-dlp probando varios "player clients" de YouTube. En Render el
 * cliente por defecto a veces exige PO token; tv_embedded/android_vr suelen
 * pasar. El primer intento mantiene el comportamiento normal.
 */
async function runYtDlpWithFallback(baseArgs, timeoutMs) {
  let lastErr = null;
  for (const client of YT_CLIENT_FALLBACKS) {
    const args = baseArgs.slice();
    if (client) args.push('--extractor-args', 'youtube:player_client=' + client);
    try {
      return await runYtDlp(args, timeoutMs);
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || '');
      if (!YT_FALLBACK_ERROR.test(msg)) throw e;
    }
  }
  throw lastErr || new Error('yt-dlp falló');
}

function videoFormatSpec(mode, quality) {
  const height = Math.max(144, Math.min(2160, parseInt(String(quality).replace('p', ''), 10) || 720));
  if (mode === 'audio') return 'bestaudio[ext=m4a]/bestaudio';
  // El cliente reproduce video (mudo) + audio en elementos separados, así
  // que pedimos una pista de video sola, no un MP4 combinado.
  return 'bestvideo[height<=' + height + '][ext=mp4]/bestvideo[height<=' + height + ']/best[height<=' + height + '][ext=mp4]/best[height<=' + height + ']';
}

function videoCacheGet(key) {
  const rec = VIDEO_URL_CACHE.get(key);
  if (!rec) return null;
  if (Date.now() > rec.expires) {
    VIDEO_URL_CACHE.delete(key);
    return null;
  }
  return rec.url;
}

function videoCacheSet(key, url) {
  // Evita crecer sin límite en servidores de larga vida.
  if (VIDEO_URL_CACHE.size > 200) {
    const oldest = VIDEO_URL_CACHE.keys().next().value;
    if (oldest) VIDEO_URL_CACHE.delete(oldest);
  }
  VIDEO_URL_CACHE.set(key, { url: url, expires: Date.now() + VIDEO_URL_TTL });
}

/** Redirige/proxya una URL directa de googlevideo manteniendo Range. */
function proxyVideoToClient(sourceUrl, req, res, redirectsLeft) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let parsed;
    try { parsed = new URL(sourceUrl); } catch (e) {
      done({ ok: false, status: 400, error: 'URL de medios inválida' });
      return;
    }

    const mod = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': '*/*'
    };
    if (req.headers.range) headers.Range = req.headers.range;
    if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];

    const upstream = mod.get(parsed, { headers }, (pres) => {
      const code = pres.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(code) && pres.headers.location && redirectsLeft > 0) {
        pres.resume();
        const next = new URL(pres.headers.location, sourceUrl).href;
        proxyVideoToClient(next, req, res, redirectsLeft - 1).then(done);
        return;
      }

      if (code === 403 || code === 410) {
        pres.resume();
        done({ ok: false, forbidden: true, status: code, error: 'Medios caducados' });
        return;
      }

      if (code !== 200 && code !== 206) {
        pres.resume();
        done({ ok: false, status: code, error: 'Upstream HTTP ' + code });
        return;
      }

      try {
        res.status(code);
        ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'].forEach((h) => {
          if (pres.headers[h]) res.setHeader(h, pres.headers[h]);
        });
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
        if (!res.getHeader('Accept-Ranges')) res.setHeader('Accept-Ranges', 'bytes');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
      } catch (e) {}

      pres.pipe(res);
      pres.on('end', () => done({ ok: true, status: code }));
      pres.on('error', (err) => {
        try { res.destroy(err); } catch (e) {}
        done({ ok: false, error: err.message });
      });
    });

    upstream.on('error', (err) => done({ ok: false, error: err.message }));
    upstream.setTimeout(30000, () => {
      try { upstream.destroy(new Error('upstream timeout')); } catch (e) {}
      done({ ok: false, error: 'upstream timeout' });
    });
    res.on('close', () => {
      if (!res.writableEnded) {
        try { upstream.destroy(); } catch (e) {}
      }
    });
  });
}

/**
 * GET /api/video/stream?url=...&quality=720p&mode=video|audio
 * Devuelve la pista de video o audio proxificada con soporte de Range,
 * para que el reproductor pueda buscar (seek) sin descargar todo el video.
 */
app.get('/api/video/stream', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Falta el parámetro url' });

  const mode = req.query.mode === 'audio' ? 'audio' : 'video';
  const quality = req.query.quality || '720p';
  const formatSpec = videoFormatSpec(mode, quality);
  const cacheKey = String(targetUrl) + '|' + formatSpec;

  const resolveDirect = async (force) => {
    if (!force) {
      const cached = videoCacheGet(cacheKey);
      if (cached) return cached;
    }
    const { stdout } = await runYtDlpWithFallback([
      '--no-playlist', '--no-warnings', '--no-progress',
      '-f', formatSpec, '-g', '--', String(targetUrl)
    ], 40000);
    const direct = stdout.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (!direct) throw new Error('yt-dlp no devolvió una URL de medios');
    videoCacheSet(cacheKey, direct);
    return direct;
  };

  try {
    let direct = await resolveDirect(false);
    let result = await proxyVideoToClient(direct, req, res, 3);

    // La URL de googlevideo caducó: se invalida y se extrae de nuevo una vez.
    if (!result.ok && result.forbidden) {
      VIDEO_URL_CACHE.delete(cacheKey);
      direct = await resolveDirect(true);
      result = await proxyVideoToClient(direct, req, res, 3);
    }

    if (!result.ok && !res.headersSent) {
      res.status(result.status && result.status >= 400 && result.status < 600 ? result.status : 502)
        .json({ error: result.error || 'No se pudo abrir el medio' });
    }
  } catch (err) {
    console.warn('[Video] stream error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'No se pudo preparar el video', message: err.message });
    else { try { res.end(); } catch (e) {} }
  }
});

/**
 * GET /api/video/info?url=...
 * Metadatos reales (título, duración, calidades y subtítulos disponibles).
 */
app.get('/api/video/info', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Falta el parámetro url' });
  try {
    const { stdout } = await runYtDlpWithFallback([
      '--dump-single-json', '--no-playlist', '--no-warnings', '--no-progress', '--', String(targetUrl)
    ], 45000);
    const info = JSON.parse(stdout);

    const heights = [];
    (info.formats || []).forEach((f) => {
      if (!f || !f.height || !f.vcodec || f.vcodec === 'none') return;
      if (!heights.includes(f.height)) heights.push(f.height);
    });
    heights.sort((a, b) => b - a);

    const subtitleMap = {};
    [info.subtitles, info.automatic_captions].forEach((group, idx) => {
      if (!group || typeof group !== 'object') return;
      Object.keys(group).forEach((lang) => {
        if (!subtitleMap[lang]) subtitleMap[lang] = { lang: lang, label: lang, auto: idx === 1 };
      });
    });

    res.json({
      title: info.title || '',
      author: info.uploader || info.channel || '',
      duration: Number(info.duration) || 0,
      thumbnail: info.thumbnail || '',
      viewCount: Number(info.view_count) || 0,
      qualities: heights.map((h) => ({ height: h, label: h + 'p', container: 'mp4' })),
      subtitles: Object.values(subtitleMap)
    });
  } catch (err) {
    console.warn('[Video] info error:', err.message);
    res.status(502).json({ error: 'No se pudo obtener la información del video', message: err.message });
  }
});

/** Convierte SRT simple a WebVTT (el elemento <track> exige WEBVTT). */
function srtToVtt(text) {
  const body = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\uFEFF/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + body.replace(/^\d+\s*$/gm, '').trim() + '\n';
}

/**
 * GET /api/video/subtitles?url=...&lang=es&auto=1
 * Descarga subtítulos (manuales o automáticos) y los devuelve como VTT.
 */
app.get('/api/video/subtitles', async (req, res) => {
  const targetUrl = req.query.url;
  const lang = String(req.query.lang || 'es').toLowerCase();
  if (!targetUrl) return res.status(400).json({ error: 'Falta el parámetro url' });
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang)) {
    return res.status(400).json({ error: 'Idioma no válido' });
  }

  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-subs-'));
    const outTemplate = path.join(tmpDir, 'sub');
    await runYtDlpWithFallback([
      '--no-playlist', '--no-warnings', '--no-progress', '--skip-download',
      '--write-subs', '--write-auto-subs',
      '--sub-langs', lang + ',es,en',
      '--sub-format', 'vtt/srt/best',
      '-o', outTemplate,
      '--', String(targetUrl)
    ], 45000);

    const files = fs.readdirSync(tmpDir).filter((f) => /\.(vtt|srt)$/i.test(f));
    if (!files.length) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'Sin subtítulos disponibles' });
    }

    // Preferimos el idioma pedido; si no, español y luego inglés.
    const rank = (f) => {
      const lower = f.toLowerCase();
      if (lower.includes('.' + lang + '.')) return 0;
      if (lower.includes('.es.')) return 1;
      if (lower.includes('.en.')) return 2;
      return 3;
    };
    files.sort((a, b) => rank(a) - rank(b));
    const filePath = path.join(tmpDir, files[0]);
    let text = fs.readFileSync(filePath, 'utf8');
    if (!/^\uFEFF?WEBVTT/.test(text)) text = srtToVtt(text);

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(text);
  } catch (err) {
    console.warn('[Video] subtitles error:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'No se pudieron obtener los subtítulos', message: err.message });
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
});

/**
 * GET /api/download/external
 * Downloads in chosen format (MP3: 320k/192k/128k, MP4: 1080p/720p/360p) with embedded ID3 metadata & thumbnail
 */
app.get('/api/download/external', (req, res) => {
  const targetUrl = req.query.url;
  const format = (req.query.format || 'mp3').toLowerCase();
  const quality = (req.query.quality || (format === 'mp3' ? '320k' : '720p')).toLowerCase();
  const title = (req.query.title || 'Cancion').replace(/[/\\?%*:|"<>]/g, '_').trim();
  const artist = (req.query.artist || 'Sonora').replace(/[/\\?%*:|"<>]/g, '_').trim();

  if (!targetUrl) {
    return res.status(400).send('Falta el parámetro url');
  }

  const filename = `${artist} - ${title}.${format}`;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

  if (format === 'mp3') {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

    const q = ['320k', '192k', '128k'].includes(quality) ? quality : '320k';
    // Embed ID3 metadata (artist, title) and embedded cover thumbnail
    const args = ['-x', '--audio-format', 'mp3', '--audio-quality', q, '--add-metadata', '--embed-thumbnail', '-o', '-', targetUrl];
    const proc = spawn(YTDLP_BIN, withCookies(args));

    proc.stdout.pipe(res);
    proc.stderr.on('data', () => {});
    proc.on('error', err => {
      console.error('[Download] yt-dlp error:', err);
      if (!res.headersSent) res.status(500).send('Error procesando descarga');
    });
    res.on('close', () => proc.kill());
  } else {
    // MP4 Video
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

    let formatSpec = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    if (quality === '1080p') {
      formatSpec = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best';
    } else if (quality === '720p') {
      formatSpec = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best';
    } else if (quality === '360p') {
      formatSpec = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]/best';
    }

    const args = ['-f', formatSpec, '--add-metadata', '-o', '-', targetUrl];
    const proc = spawn(YTDLP_BIN, withCookies(args));

    proc.stdout.pipe(res);
    proc.stderr.on('data', () => {});
    proc.on('error', err => {
      console.error('[Download] yt-dlp error:', err);
      if (!res.headersSent) res.status(500).send('Error procesando descarga');
    });
    res.on('close', () => proc.kill());
  }
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
 * Collaborative Playlists Sync
 * Persistente en SQLite: antes sólo vivía en memoria y las playlists
 * desaparecían cada vez que el servidor se reiniciaba o hibernaba.
 */
const collaborativeStore = new Map();

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collab_playlists (
      code TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      tracks TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
  `);
} catch (err) {
  console.warn('[Collab] No se pudo crear la tabla persistente:', err.message);
}

function collabNormalizeCode(code) {
  return String(code || '').toUpperCase().trim();
}

function collabGet(code) {
  const key = collabNormalizeCode(code);
  if (!key) return null;
  if (collaborativeStore.has(key)) return collaborativeStore.get(key);

  try {
    const row = db.prepare('SELECT * FROM collab_playlists WHERE code = ?').get(key);
    if (!row) return null;
    const pl = {
      code: row.code,
      name: row.name || 'Playlist Colaborativa',
      description: row.description || '',
      tracks: JSON.parse(row.tracks || '[]'),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
    collaborativeStore.set(key, pl);
    return pl;
  } catch (err) {
    return null;
  }
}

function collabSave(pl) {
  const key = collabNormalizeCode(pl.code);
  if (!key) return null;
  pl.code = key;
  collaborativeStore.set(key, pl);
  try {
    db.prepare(`
      INSERT INTO collab_playlists (code, name, description, tracks, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        tracks = excluded.tracks,
        updated_at = excluded.updated_at
    `).run(
      key,
      pl.name || 'Playlist Colaborativa',
      pl.description || '',
      JSON.stringify(pl.tracks || []),
      pl.createdAt || new Date().toISOString(),
      pl.updatedAt || new Date().toISOString()
    );
  } catch (err) {
    console.warn('[Collab] No se pudo guardar:', err.message);
  }
  return pl;
}

app.get('/api/playlists/collaborative/:code', (req, res) => {
  const pl = collabGet(req.params.code);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada con este código' });
  res.json(pl);
});

app.post('/api/playlists/collaborative/:code', (req, res) => {
  const code = collabNormalizeCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'Código inválido' });

  const name = req.body.name || 'Playlist Colaborativa';
  const description = req.body.description || '';
  const tracks = Array.isArray(req.body.tracks) ? req.body.tracks : [];

  let pl = collabGet(code);
  if (!pl) {
    pl = {
      code,
      name,
      description,
      tracks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  } else {
    pl.name = name;
    pl.description = description;
    // La lista enviada es la versión completa y manda sobre la guardada.
    pl.tracks = tracks;
    pl.updatedAt = new Date().toISOString();
  }

  collabSave(pl);
  res.json({ success: true, playlist: pl });
});

app.post('/api/playlists/collaborative/:code/tracks', (req, res) => {
  const code = collabNormalizeCode(req.params.code);
  const track = req.body;
  if (!track || !track.title) return res.status(400).json({ error: 'Track inválido' });

  let pl = collabGet(code);
  if (!pl) {
    pl = {
      code,
      name: req.body.playlistName || 'Playlist Colaborativa',
      description: '',
      tracks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  if (!pl.tracks.some(t => String(t.id) === String(track.id) || t.title === track.title)) {
    pl.tracks.push(track);
  }
  pl.updatedAt = new Date().toISOString();
  collabSave(pl);

  res.json({ success: true, count: pl.tracks.length, playlist: pl });
});

app.delete('/api/playlists/collaborative/:code/tracks/:trackId', (req, res) => {
  const code = collabNormalizeCode(req.params.code);
  const trackId = req.params.trackId;

  const pl = collabGet(code);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  const before = pl.tracks.length;
  pl.tracks = pl.tracks.filter(t => String(t.id) !== String(trackId));
  const removed = before - pl.tracks.length;
  pl.updatedAt = new Date().toISOString();
  collabSave(pl);

  res.json({ success: true, removed, playlist: pl });
});

app.delete('/api/playlists/collaborative/:code', (req, res) => {
  const code = collabNormalizeCode(req.params.code);
  collaborativeStore.delete(code);
  try {
    db.prepare('DELETE FROM collab_playlists WHERE code = ?').run(code);
  } catch (err) {}
  res.json({ success: true, deleted: true });
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
 * POST /api/download/youtube
 * Download YouTube video, convert to MP3, save to server, return download URL
 * Body: { url, title, artist }
 */
app.post('/api/download/youtube', async (req, res) => {
  try {
    const { url, title = 'Cancion', artist = 'Sonora' } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL de YouTube requerida' });
    }

    const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '_').trim();
    const safeArtist = artist.replace(/[/\\?%*:|"<>]/g, '_').trim();
    const filename = `${safeArtist} - ${safeTitle}.mp3`;
    const outputPath = path.join(musicDir, filename);

    console.log(`[Download] Starting YouTube download: ${url}`);
    console.log(`[Download] Output: ${outputPath}`);

    // yt-dlp args: download best audio, convert to MP3 320k, add metadata
    const args = [
      '--no-playlist',
      '--no-progress',
      '--quiet',
      '--no-warnings',
      '-x', '--audio-format', 'mp3', '--audio-quality', '320k',
      '--add-metadata', '--embed-thumbnail',
      '--metadata-from-title', '%(artist)s - %(title)s',
      '-o', outputPath,
      url
    ];

    const proc = spawn(YTDLP_BIN, withCookies(args));

    let stderrOutput = '';
    proc.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[Download] yt-dlp exited with code ${code}: ${stderrOutput}`);
        return res.status(500).json({
          success: false,
          error: 'Error descargando de YouTube',
          details: stderrOutput.slice(-500)
        });
      }

      // Verify file exists
      if (!fs.existsSync(outputPath)) {
        console.error('[Download] Output file not found after conversion');
        return res.status(500).json({
          success: false,
          error: 'El archivo descargado no se encontró'
        });
      }

      const stat = fs.statSync(outputPath);
      const fileSize = stat.size;

      // Build public download URL
      const protocol = req.protocol;
      const host = req.get('host');
      const downloadUrl = `${protocol}://${host}/api/download/file/${encodeURIComponent(filename)}`;

      console.log(`[Download] Complete: ${filename} (${fileSize} bytes)`);

      res.json({
        success: true,
        downloadUrl: downloadUrl,
        title: title,
        artist: artist,
        filename: filename,
        size: fileSize,
        message: 'Descarga completada exitosamente'
      });
    });

    proc.on('error', (err) => {
      console.error('[Download] yt-dlp spawn error:', err.message);
      res.status(500).json({ success: false, error: 'Error iniciando descarga', details: err.message });
    });

  } catch (err) {
    console.error('[Download] Fatal error:', err);
    res.status(500).json({ success: false, error: 'Error interno del servidor', details: err.message });
  }
});

/**
 * GET /api/download/file/:filename
 * Serve downloaded MP3 file from server music directory
 */
app.get('/api/download/file/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(musicDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).set({ 'Content-Range': `bytes */${fileSize}` }).send('Requested Range Not Satisfiable');
        return;
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      const headers = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg',
        'Access-Control-Allow-Origin': '*'
      };

      res.writeHead(206, headers);
      fileStream.pipe(res);
    } else {
      const headers = {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
        'Content-Disposition': `attachment; filename="${filename}"`
      };

      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('[Download File] Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error sirviendo archivo', details: err.message });
    }
  }
});

/**
 * GET /api/downloads
 * List all downloaded MP3 files from server music directory
 */
app.get('/api/downloads', (req, res) => {
  try {
    if (!fs.existsSync(musicDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3'));
    const downloads = files.map(f => {
      const fullPath = path.join(musicDir, f);
      const stat = fs.statSync(fullPath);
      const parts = f.replace('.mp3', '').split(' - ');
      const artist = parts[0] || 'Desconocido';
      const title = parts.slice(1).join(' - ') || f;

      return {
        id: f,
        filename: f,
        title: title,
        artist: artist,
        size: stat.size,
        createdAt: stat.birthtime || stat.mtime,
        url: `${req.protocol}://${req.get('host')}/api/download/file/${encodeURIComponent(f)}`
      };
    });

    res.json(downloads);
  } catch (err) {
    console.error('[Downloads List] Error:', err);
    res.status(500).json({ error: 'Error listando descargas', details: err.message });
  }
});

/**
 * DELETE /api/downloads/:filename
 * Delete a downloaded file from server
 */
app.delete('/api/downloads/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(musicDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'Archivo eliminado' });
  } catch (err) {
    console.error('[Delete Download] Error:', err);
    res.status(500).json({ error: 'Error eliminando archivo', details: err.message });
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

      const ytdlpArgs = [
        '--no-playlist',
        '--no-progress',
        '--quiet',
        '--no-warnings',
        '-f', 'bestaudio/best',
        '-o', '-',
        `ytsearch1:${query}`
      ];
      const proc = spawn(YTDLP_BIN, withCookies(ytdlpArgs));

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
  console.log('🎵 Sonora Music Server v7.17.0');
  console.log(`📡 Mode: ${isNorthflank ? 'Northflank' : (isRender ? 'Render' : 'Local')}`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`📁 Music directory: ${musicDir}`);
  console.log(`💾 Database: ${dbPath}`);
  console.log('----------------------------------------------------');
});

module.exports = { app, server, db };
