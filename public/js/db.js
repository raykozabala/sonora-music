/**
 * Sonora Music — IndexedDB Database Layer
 * Complete local database with demo data
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var DB_NAME = 'SonoraMusic';
  var DB_VERSION = 4;
  var _db = null;

  /* ── helpers ── */
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (_db) { resolve(_db); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        var stores = ['tracks', 'albums', 'artists', 'playlists', 'mixes', 'history', 'downloads', 'settings'];
        stores.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            var s = db.createObjectStore(name, { keyPath: name === 'history' ? 'id' : (name === 'settings' ? 'key' : 'id'), autoIncrement: name === 'history' });
            if (name === 'tracks') {
              s.createIndex('genre', 'genre', { unique: false });
              s.createIndex('artistId', 'artistId', { unique: false });
              s.createIndex('albumId', 'albumId', { unique: false });
              s.createIndex('isFavorite', 'isFavorite', { unique: false });
              s.createIndex('playCount', 'playCount', { unique: false });
              s.createIndex('dateAdded', 'dateAdded', { unique: false });
              s.createIndex('title', 'title', { unique: false });
            }
            if (name === 'history') {
              s.createIndex('trackId', 'trackId', { unique: false });
              s.createIndex('playedAt', 'playedAt', { unique: false });
            }
            if (name === 'mixes') {
              s.createIndex('type', 'type', { unique: false });
            }
          }
        });
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
    });
  }

  function tx(store, mode) {
    return _db.transaction(store, mode || 'readonly').objectStore(store);
  }

  function reqP(idbReq) {
    return new Promise(function (resolve, reject) {
      idbReq.onsuccess = function () { resolve(idbReq.result); };
      idbReq.onerror = function () { reject(idbReq.error); };
    });
  }

  function getAllFromStore(storeName) {
    return reqP(tx(storeName).getAll());
  }

  /**
   * Las claves de IndexedDB pueden guardarse como número (ids del servidor) o
   * como texto (ids externos "yt_...", "ext_...", "device_...") y, además,
   * cualquier id que llega desde la ruta (#/playlists/12) es SIEMPRE texto.
   * Antes esto hacía que una playlist recién creada saliera como "no
   * encontrada": se buscaba "12" cuando estaba guardada como 12.
   */
  function idVariant(id) {
    if (typeof id === 'number') return id;
    var s = String(id == null ? '' : id).trim();
    if (s !== '' && /^-?\d+$/.test(s)) return Number(s);
    return s;
  }

  function getByIdFromStore(storeName, id) {
    var key = idVariant(id);
    return reqP(tx(storeName).get(key)).then(function (found) {
      if (found !== undefined && found !== null) return found;
      // Segundo intento con el tipo contrario (número ↔ texto).
      var alt = (typeof key === 'number')
        ? String(key)
        : (/^-?\d+$/.test(String(key)) ? Number(key) : null);
      if (alt === null || alt === key) return found;
      return reqP(tx(storeName).get(alt));
    });
  }

  function putToStore(storeName, item) {
    return reqP(tx(storeName, 'readwrite').put(item));
  }

  /** "darkMode" ↔ "dark_mode" (para no duplicar preferencias). */
  function alternateSettingKey(key) {
    var k = String(key || '');
    if (k.indexOf('_') !== -1) {
      return k.replace(/_([a-z0-9])/g, function (m, c) { return c.toUpperCase(); });
    }
    return k.replace(/([A-Z])/g, function (m, c) { return '_' + c.toLowerCase(); });
  }

  function addToStore(storeName, item) {
    return reqP(tx(storeName, 'readwrite').add(item));
  }

  function deleteFromStore(storeName, id) {
    return reqP(tx(storeName, 'readwrite').delete(idVariant(id)));
  }

  function getAllByIndex(storeName, indexName, value) {
    return reqP(tx(storeName).index(indexName).getAll(value));
  }

  /* ── Demo Data ── */
  function generateDemoData() {
    var now = new Date().toISOString();

    // ── Artists ──
    var artists = [
      { id: 1, name: 'Luna Morena', imageUrl: '', bio: 'Artista pop latina con ritmos cálidos y letras emotivas.', trackCount: 10, albumCount: 2 },
      { id: 2, name: 'Cielo Rojo', imageUrl: '', bio: 'Banda de rock alternativo con energía pura.', trackCount: 10, albumCount: 2 },
      { id: 3, name: 'Mar de Fuego', imageUrl: '', bio: 'Productora electrónica con sonidos futuristas.', trackCount: 10, albumCount: 2 },
      { id: 4, name: 'Alma Libre', imageUrl: '', bio: 'Indie folk con toques acústicos y poéticos.', trackCount: 5, albumCount: 1 },
      { id: 5, name: 'Noche Eterna', imageUrl: '', bio: 'Metal progresivo con intensidad y técnica.', trackCount: 5, albumCount: 1 },
      { id: 6, name: 'Río Dorado', imageUrl: '', bio: 'Jazz contemporáneo con fusión latina.', trackCount: 5, albumCount: 1 },
      { id: 7, name: 'Viento Sur', imageUrl: '', bio: 'Reggaetón y urbano con flow tropical.', trackCount: 5, albumCount: 1 },
      { id: 8, name: 'Eclipse', imageUrl: '', bio: 'R&B moderno con voces sedosas.', trackCount: 5, albumCount: 1 },
      { id: 9, name: 'Horizonte', imageUrl: '', bio: 'Hip-hop lírico con beats contundentes.', trackCount: 5, albumCount: 1 },
      { id: 10, name: 'Cristal', imageUrl: '', bio: 'Ambient y clásica contemporánea.', trackCount: 5, albumCount: 1 }
    ];

    // ── Albums ──
    var albums = [
      { id: 1, title: 'Amanecer', artist: 'Luna Morena', artistId: 1, artworkUrl: '', year: 2024, genre: 'Pop', trackCount: 5 },
      { id: 2, title: 'Estrellas', artist: 'Luna Morena', artistId: 1, artworkUrl: '', year: 2023, genre: 'Pop', trackCount: 5 },
      { id: 3, title: 'Rebelión', artist: 'Cielo Rojo', artistId: 2, artworkUrl: '', year: 2024, genre: 'Rock', trackCount: 5 },
      { id: 4, title: 'Cenizas', artist: 'Cielo Rojo', artistId: 2, artworkUrl: '', year: 2023, genre: 'Rock', trackCount: 5 },
      { id: 5, title: 'Voltaje', artist: 'Mar de Fuego', artistId: 3, artworkUrl: '', year: 2024, genre: 'Electrónica', trackCount: 5 },
      { id: 6, title: 'Circuito', artist: 'Mar de Fuego', artistId: 3, artworkUrl: '', year: 2023, genre: 'Electrónica', trackCount: 5 },
      { id: 7, title: 'Caminos', artist: 'Alma Libre', artistId: 4, artworkUrl: '', year: 2024, genre: 'Indie', trackCount: 5 },
      { id: 8, title: 'Abismo', artist: 'Noche Eterna', artistId: 5, artworkUrl: '', year: 2024, genre: 'Metal', trackCount: 5 },
      { id: 9, title: 'Terciopelo', artist: 'Río Dorado', artistId: 6, artworkUrl: '', year: 2024, genre: 'Jazz', trackCount: 5 },
      { id: 10, title: 'Fuego', artist: 'Viento Sur', artistId: 7, artworkUrl: '', year: 2024, genre: 'Reggaetón', trackCount: 5 },
      { id: 11, title: 'Sombras', artist: 'Eclipse', artistId: 8, artworkUrl: '', year: 2024, genre: 'R&B', trackCount: 5 },
      { id: 12, title: 'Asfalto', artist: 'Horizonte', artistId: 9, artworkUrl: '', year: 2024, genre: 'Hip-Hop', trackCount: 5 }
    ];

    // ── Tracks (60 total, 5 per album) ──
    var trackData = [
      // Album 1 - Amanecer (Pop)
      [1, 'Despertar Dorado', 'Luna Morena', 'Amanecer', 1, 1, 215, 'Pop', 2024, 1, 'Letra de Despertar Dorado\nCada mañana es un nuevo comienzo\nEl sol me dice que puedo volar...'],
      [2, 'Bailando en la Lluvia', 'Luna Morena', 'Amanecer', 1, 1, 198, 'Pop', 2024, 2, ''],
      [3, 'Corazón de Cristal', 'Luna Morena', 'Amanecer', 1, 1, 243, 'Pop', 2024, 3, 'Mi corazón es de cristal\nFrágil pero hermoso...'],
      [4, 'Mariposas', 'Luna Morena', 'Amanecer', 1, 1, 187, 'Pop', 2024, 4, ''],
      [5, 'Último Suspiro', 'Luna Morena', 'Amanecer', 1, 1, 269, 'Pop', 2024, 5, ''],
      // Album 2 - Estrellas (Pop)
      [6, 'Galaxias', 'Luna Morena', 'Estrellas', 2, 1, 234, 'Pop', 2023, 1, ''],
      [7, 'Noches de Plata', 'Luna Morena', 'Estrellas', 2, 1, 201, 'Pop', 2023, 2, ''],
      [8, 'Constelaciones', 'Luna Morena', 'Estrellas', 2, 1, 256, 'Pop', 2023, 3, ''],
      [9, 'Luz de Luna', 'Luna Morena', 'Estrellas', 2, 1, 189, 'Pop', 2023, 4, ''],
      [10, 'Infinito', 'Luna Morena', 'Estrellas', 2, 1, 278, 'Pop', 2023, 5, ''],
      // Album 3 - Rebelión (Rock)
      [11, 'Grito de Guerra', 'Cielo Rojo', 'Rebelión', 3, 2, 245, 'Rock', 2024, 1, ''],
      [12, 'Fuego Interior', 'Cielo Rojo', 'Rebelión', 3, 2, 267, 'Rock', 2024, 2, ''],
      [13, 'Sin Cadenas', 'Cielo Rojo', 'Rebelión', 3, 2, 198, 'Rock', 2024, 3, ''],
      [14, 'Revolución', 'Cielo Rojo', 'Rebelión', 3, 2, 302, 'Rock', 2024, 4, ''],
      [15, 'Última Frontera', 'Cielo Rojo', 'Rebelión', 3, 2, 285, 'Rock', 2024, 5, ''],
      // Album 4 - Cenizas (Rock)
      [16, 'Entre las Llamas', 'Cielo Rojo', 'Cenizas', 4, 2, 233, 'Rock', 2023, 1, ''],
      [17, 'Cicatrices', 'Cielo Rojo', 'Cenizas', 4, 2, 219, 'Rock', 2023, 2, ''],
      [18, 'Tormenta', 'Cielo Rojo', 'Cenizas', 4, 2, 248, 'Rock', 2023, 3, ''],
      [19, 'Renacer', 'Cielo Rojo', 'Cenizas', 4, 2, 275, 'Rock', 2023, 4, ''],
      [20, 'Polvo y Viento', 'Cielo Rojo', 'Cenizas', 4, 2, 196, 'Rock', 2023, 5, ''],
      // Album 5 - Voltaje (Electrónica)
      [21, 'Pulso Neón', 'Mar de Fuego', 'Voltaje', 5, 3, 312, 'Electrónica', 2024, 1, ''],
      [22, 'Ondas Digitales', 'Mar de Fuego', 'Voltaje', 5, 3, 287, 'Electrónica', 2024, 2, ''],
      [23, 'Synth Dreams', 'Mar de Fuego', 'Voltaje', 5, 3, 265, 'Electrónica', 2024, 3, ''],
      [24, 'Frecuencia Zero', 'Mar de Fuego', 'Voltaje', 5, 3, 298, 'Electrónica', 2024, 4, ''],
      [25, 'Circuito Cerrado', 'Mar de Fuego', 'Voltaje', 5, 3, 245, 'Electrónica', 2024, 5, ''],
      // Album 6 - Circuito (Electrónica)
      [26, 'Binary Code', 'Mar de Fuego', 'Circuito', 6, 3, 276, 'Electrónica', 2023, 1, ''],
      [27, 'Láser', 'Mar de Fuego', 'Circuito', 6, 3, 234, 'Electrónica', 2023, 2, ''],
      [28, 'Drop Zone', 'Mar de Fuego', 'Circuito', 6, 3, 301, 'Electrónica', 2023, 3, ''],
      [29, 'Glitch', 'Mar de Fuego', 'Circuito', 6, 3, 198, 'Electrónica', 2023, 4, ''],
      [30, 'Afterglow', 'Mar de Fuego', 'Circuito', 6, 3, 256, 'Electrónica', 2023, 5, ''],
      // Album 7 - Caminos (Indie)
      [31, 'Sendero', 'Alma Libre', 'Caminos', 7, 4, 223, 'Indie', 2024, 1, ''],
      [32, 'Hojas al Viento', 'Alma Libre', 'Caminos', 7, 4, 198, 'Indie', 2024, 2, ''],
      [33, 'Café y Lluvia', 'Alma Libre', 'Caminos', 7, 4, 245, 'Indie', 2024, 3, ''],
      [34, 'Atardecer', 'Alma Libre', 'Caminos', 7, 4, 267, 'Indie', 2024, 4, ''],
      [35, 'Mapa de Sueños', 'Alma Libre', 'Caminos', 7, 4, 212, 'Indie', 2024, 5, ''],
      // Album 8 - Abismo (Metal)
      [36, 'Descenso', 'Noche Eterna', 'Abismo', 8, 5, 298, 'Metal', 2024, 1, ''],
      [37, 'Furia Oscura', 'Noche Eterna', 'Abismo', 8, 5, 315, 'Metal', 2024, 2, ''],
      [38, 'Acero y Sangre', 'Noche Eterna', 'Abismo', 8, 5, 276, 'Metal', 2024, 3, ''],
      [39, 'Caos', 'Noche Eterna', 'Abismo', 8, 5, 287, 'Metal', 2024, 4, ''],
      [40, 'Resurrección', 'Noche Eterna', 'Abismo', 8, 5, 342, 'Metal', 2024, 5, ''],
      // Album 9 - Terciopelo (Jazz)
      [41, 'Medianoche Suave', 'Río Dorado', 'Terciopelo', 9, 6, 289, 'Jazz', 2024, 1, ''],
      [42, 'Saxofón Dorado', 'Río Dorado', 'Terciopelo', 9, 6, 256, 'Jazz', 2024, 2, ''],
      [43, 'Blues del Alma', 'Río Dorado', 'Terciopelo', 9, 6, 312, 'Jazz', 2024, 3, ''],
      [44, 'Improvisación', 'Río Dorado', 'Terciopelo', 9, 6, 345, 'Jazz', 2024, 4, ''],
      [45, 'Swing Nocturno', 'Río Dorado', 'Terciopelo', 9, 6, 267, 'Jazz', 2024, 5, ''],
      // Album 10 - Fuego (Reggaetón)
      [46, 'Perreo Espacial', 'Viento Sur', 'Fuego', 10, 7, 198, 'Reggaetón', 2024, 1, ''],
      [47, 'Dembow Lunar', 'Viento Sur', 'Fuego', 10, 7, 212, 'Reggaetón', 2024, 2, ''],
      [48, 'Caliente', 'Viento Sur', 'Fuego', 10, 7, 187, 'Reggaetón', 2024, 3, ''],
      [49, 'Ritmo Salvaje', 'Viento Sur', 'Fuego', 10, 7, 205, 'Reggaetón', 2024, 4, ''],
      [50, 'La Noche Es Nuestra', 'Viento Sur', 'Fuego', 10, 7, 234, 'Reggaetón', 2024, 5, ''],
      // Album 11 - Sombras (R&B)
      [51, 'Terciopelo Negro', 'Eclipse', 'Sombras', 11, 8, 245, 'R&B', 2024, 1, ''],
      [52, 'Susurros', 'Eclipse', 'Sombras', 11, 8, 223, 'R&B', 2024, 2, ''],
      [53, 'Piel de Seda', 'Eclipse', 'Sombras', 11, 8, 267, 'R&B', 2024, 3, ''],
      [54, 'Vulnerable', 'Eclipse', 'Sombras', 11, 8, 198, 'R&B', 2024, 4, ''],
      [55, 'Eternamente', 'Eclipse', 'Sombras', 11, 8, 289, 'R&B', 2024, 5, ''],
      // Album 12 - Asfalto (Hip-Hop)
      [56, 'Calle Real', 'Horizonte', 'Asfalto', 12, 9, 215, 'Hip-Hop', 2024, 1, ''],
      [57, 'Barrio Alto', 'Horizonte', 'Asfalto', 12, 9, 198, 'Hip-Hop', 2024, 2, ''],
      [58, 'Flow Infinito', 'Horizonte', 'Asfalto', 12, 9, 234, 'Hip-Hop', 2024, 3, ''],
      [59, 'Rimas de Acero', 'Horizonte', 'Asfalto', 12, 9, 256, 'Hip-Hop', 2024, 4, ''],
      [60, 'Legado', 'Horizonte', 'Asfalto', 12, 9, 278, 'Hip-Hop', 2024, 5, '']
    ];

    // Start completely clean without fake tracks as requested
    var tracks = [];
    var artists = [];
    var albums = [];
    var mixes = [];

    // Optional demo playlist that can be deleted/uninstalled anytime
    var playlists = [
      { id: 1, name: 'Canciones de Prueba (Demo)', description: 'Lista de prueba opcional. Puedes borrarla cuando desees.', artworkUrl: '', trackIds: [], createdAt: now, updatedAt: now, isCollaborative: 0 }
    ];

    return { artists: artists, albums: albums, tracks: tracks, mixes: mixes, playlists: playlists };
  }

  function seedIfEmpty() {
    return getAllFromStore('settings').then(function (existingSettings) {
      if (existingSettings && existingSettings.length > 0) {
        return;
      }
      console.log('[DB] Initializing clean user database...');
      var data = generateDemoData();

      var storesToSeed = [
        { name: 'artists', items: data.artists },
        { name: 'albums', items: data.albums },
        { name: 'tracks', items: data.tracks },
        { name: 'mixes', items: data.mixes },
        { name: 'playlists', items: data.playlists }
      ];

      var seedPromises = storesToSeed.map(function (storeInfo) {
        return new Promise(function (resolve, reject) {
          var txn = _db.transaction(storeInfo.name, 'readwrite');
          var store = txn.objectStore(storeInfo.name);
          storeInfo.items.forEach(function (item) { store.put(item); });
          txn.oncomplete = resolve;
          txn.onerror = function () { reject(txn.error); };
        });
      });

      // Seed default settings
      seedPromises.push(new Promise(function (resolve, reject) {
        var txn = _db.transaction('settings', 'readwrite');
        var store = txn.objectStore('settings');
        store.put({ key: 'username', value: 'Usuario' });
        store.put({ key: 'bio', value: '🎵 Amante de la música' });
        store.put({ key: 'avatar', value: '' });
        store.put({ key: 'theme', value: 'coral' });
        store.put({ key: 'darkMode', value: 'dark' });
        store.put({ key: 'fontSize', value: 'medium' });
        store.put({ key: 'language', value: 'es' });
        store.put({ key: 'serverMode', value: 'off' });
        store.put({ key: 'serverLocalUrl', value: 'http://192.168.1.132:3000' });
        store.put({ key: 'serverRenderUrl', value: 'https://sonora-music-b1ee.onrender.com' });
        store.put({ key: 'crossfade', value: 0 });
        store.put({ key: 'playbackSpeed', value: 1.0 });
        store.put({ key: 'audioQuality', value: 'normal' });
        store.put({ key: 'notifNewSongs', value: true });
        store.put({ key: 'notifRecommendations', value: true });
        store.put({ key: 'notifUpdates', value: true });
        txn.oncomplete = resolve;
        txn.onerror = function () { reject(txn.error); };
      }));

      return Promise.all(seedPromises).then(function () {
        console.log('[DB] Demo data seeded successfully');
      });
    });
  }

  function migrateToV72() {
    return getAllFromStore('settings').then(function(settings) {
      var hasCleanFlag = settings && settings.some(function(s) { return s.key === 'sonora_v72_clean'; });
      if (hasCleanFlag) return;

      var txn = _db.transaction(['tracks', 'albums', 'artists', 'settings'], 'readwrite');
      var trackStore = txn.objectStore('tracks');
      for (var id = 1; id <= 60; id++) {
        trackStore.delete(id);
      }
      var albumStore = txn.objectStore('albums');
      for (var aid = 1; aid <= 12; aid++) {
        albumStore.delete(aid);
      }
      var artistStore = txn.objectStore('artists');
      for (var arid = 1; arid <= 10; arid++) {
        artistStore.delete(arid);
      }
      var setStore = txn.objectStore('settings');
      setStore.put({ key: 'sonora_v72_clean', value: true });
    }).catch(function(e){ console.warn('[DB] Clean migration:', e); });
  }

  /* ── Public API ── */
  Sonora.DB = {
    init: function () {
      return openDB().then(function () {
        return seedIfEmpty().then(function() {
          return migrateToV72();
        });
      }).catch(function (err) {
        console.error('[DB] Init error:', err);
      });
    },

    tracks: {
      getAll: function () { return getAllFromStore('tracks').catch(function () { return []; }); },
      getById: function (id) { return getByIdFromStore('tracks', id).catch(function () { return null; }); },
      add: function (track) { return putToStore('tracks', track); },
      addMany: function (tracks) {
        return new Promise(function (resolve, reject) {
          var txn = _db.transaction('tracks', 'readwrite');
          var store = txn.objectStore('tracks');
          tracks.forEach(function (t) { store.put(t); });
          txn.oncomplete = resolve;
          txn.onerror = function () { reject(txn.error); };
        });
      },
      update: function (track) { return putToStore('tracks', track); },
      delete: function (id) { return deleteFromStore('tracks', id); },
      search: function (query) {
        var q = (query || '').toLowerCase();
        if (!q) return Promise.resolve([]);
        return getAllFromStore('tracks').then(function (all) {
          return all.filter(function (t) {
            return t.title.toLowerCase().indexOf(q) !== -1 ||
                   t.artist.toLowerCase().indexOf(q) !== -1 ||
                   t.album.toLowerCase().indexOf(q) !== -1 ||
                   (t.genre && t.genre.toLowerCase().indexOf(q) !== -1);
          });
        });
      },
      getByGenre: function (genre) {
        return getAllFromStore('tracks').then(function (all) {
          return all.filter(function (t) {
            return t.genre && t.genre.toLowerCase() === genre.toLowerCase();
          });
        });
      },
      getByArtist: function (artistId) {
        return getAllByIndex('tracks', 'artistId', Number(artistId)).catch(function () { return []; });
      },
      getByAlbum: function (albumId) {
        return getAllByIndex('tracks', 'albumId', Number(albumId)).catch(function () { return []; });
      },
      getFavorites: function () {
        return getAllFromStore('tracks').then(function (all) {
          return all.filter(function (t) { return t.isFavorite; });
        });
      },
      getMostPlayed: function (limit) {
        return getAllFromStore('tracks').then(function (all) {
          all.sort(function (a, b) { return (b.playCount || 0) - (a.playCount || 0); });
          return all.slice(0, limit || 10);
        });
      },
      getRecent: function (limit) {
        return getAllFromStore('tracks').then(function (all) {
          return all.filter(function (t) { return t.lastPlayed; })
            .sort(function (a, b) { return new Date(b.lastPlayed) - new Date(a.lastPlayed); })
            .slice(0, limit || 10);
        });
      },
      toggleFavorite: function (trackId) {
        return getByIdFromStore('tracks', trackId).then(function (track) {
          if (!track) return false;
          track.isFavorite = track.isFavorite ? 0 : 1;
          return putToStore('tracks', track).then(function () { return !!track.isFavorite; });
        });
      },
      incrementPlayCount: function (trackId) {
        return getByIdFromStore('tracks', trackId).then(function (track) {
          if (!track) return;
          track.playCount = (track.playCount || 0) + 1;
          track.lastPlayed = new Date().toISOString();
          return putToStore('tracks', track);
        });
      }
    },

    albums: {
      getAll: function () { return getAllFromStore('albums').catch(function () { return []; }); },
      getById: function (id) { return getByIdFromStore('albums', id).catch(function () { return null; }); }
    },

    artists: {
      getAll: function () { return getAllFromStore('artists').catch(function () { return []; }); },
      getById: function (id) { return getByIdFromStore('artists', id).catch(function () { return null; }); }
    },

    playlists: {
      getAll: function () { return getAllFromStore('playlists').catch(function () { return []; }); },
      getById: function (id) { return getByIdFromStore('playlists', id).catch(function () { return null; }); },
      create: function (playlist) {
        playlist.createdAt = playlist.createdAt || new Date().toISOString();
        playlist.updatedAt = playlist.createdAt;
        playlist.trackIds = playlist.trackIds || [];
        playlist.isCollaborative = playlist.isCollaborative || 0;
        // Auto-increment ID
        return getAllFromStore('playlists').then(function (all) {
          var maxId = all.reduce(function (max, p) { return Math.max(max, p.id || 0); }, 0);
          playlist.id = maxId + 1;
          return putToStore('playlists', playlist).then(function () { return playlist; });
        });
      },
      update: function (playlist) {
        playlist.updatedAt = new Date().toISOString();
        return putToStore('playlists', playlist);
      },
      delete: function (id) {
        // Los ids de playlist son numéricos, pero los de canciones pueden ser
        // texto ("it_...", "dev_..."): comparamos siempre como texto.
        return getAllFromStore('playlists').then(function (all) {
          var match = (all || []).filter(function (p) { return String(p.id) === String(id); });
          if (match.length === 0) return deleteFromStore('playlists', Number(id));
          return Promise.all(match.map(function (p) { return deleteFromStore('playlists', p.id); }));
        }).catch(function () { return deleteFromStore('playlists', Number(id)); });
      },
      addTrack: function (playlistId, trackId) {
        return getAllFromStore('playlists').then(function (all) {
          var pl = (all || []).find(function (p) { return String(p.id) === String(playlistId); });
          if (!pl) return;
          var ids = pl.trackIds || [];
          if (!ids.some(function (id) { return String(id) === String(trackId); })) ids.push(trackId);
          pl.trackIds = ids;
          pl.updatedAt = new Date().toISOString();
          return putToStore('playlists', pl);
        });
      },
      removeTrack: function (playlistId, trackId) {
        return getAllFromStore('playlists').then(function (all) {
          var pl = (all || []).find(function (p) { return String(p.id) === String(playlistId); });
          if (!pl) return;
          pl.trackIds = (pl.trackIds || []).filter(function (id) { return String(id) !== String(trackId); });
          pl.updatedAt = new Date().toISOString();
          return putToStore('playlists', pl);
        });
      },
      reorderTracks: function (playlistId, trackIds) {
        return getAllFromStore('playlists').then(function (all) {
          var pl = (all || []).find(function (p) { return String(p.id) === String(playlistId); });
          if (!pl) return;
          pl.trackIds = trackIds;
          pl.updatedAt = new Date().toISOString();
          return putToStore('playlists', pl);
        });
      }
    },

    mixes: {
      getAll: function () { return getAllFromStore('mixes').catch(function () { return []; }); },
      getById: function (id) { return getByIdFromStore('mixes', id).catch(function () { return null; }); },
      getByType: function (type) {
        return getAllFromStore('mixes').then(function (all) {
          return all.filter(function (m) { return m.type === type; });
        });
      }
    },

    history: {
      /**
       * Registra una reproducción. Acepta tanto un id como el objeto
       * { trackId, track, playedAt } que envía el reproductor.
       * Antes se hacía Number(trackId): con los objetos daba NaN y con los
       * ids externos ("yt_...") también, así que el historial quedaba vacío.
       */
      add: function (entry) {
        var trackId = entry;
        var snapshot = null;
        if (entry && typeof entry === 'object') {
          trackId = (entry.trackId !== undefined && entry.trackId !== null)
            ? entry.trackId
            : (entry.track && entry.track.id);
          snapshot = entry.track || null;
        }
        if (trackId === undefined || trackId === null) return Promise.resolve();
        if (typeof trackId === 'number' && isNaN(trackId)) return Promise.resolve();

        return addToStore('history', {
          trackId: String(trackId),
          track: snapshot,
          playedAt: new Date().toISOString()
        }).catch(function (e) {
          console.error('[DB] History add error:', e);
        });
      },
      getAll: function () {
        return getAllFromStore('history').catch(function () { return []; });
      },
      getRecent: function (limit) {
        return getAllFromStore('history').then(function (all) {
          all.sort(function (a, b) { return new Date(b.playedAt) - new Date(a.playedAt); });
          return all.slice(0, limit || 20);
        }).then(function (recent) {
          var promises = recent.map(function (h) {
            // Si guardamos la copia de la canción, la usamos directamente
            // (así también aparecen las de YouTube/SoundCloud).
            if (h.track && h.track.title) {
              var copy = h.track;
              copy._playedAt = h.playedAt;
              return Promise.resolve(copy);
            }
            return getByIdFromStore('tracks', h.trackId).then(function (track) {
              if (track) track._playedAt = h.playedAt;
              return track || null;
            }).catch(function () { return null; });
          });
          return Promise.all(promises).then(function (tracks) {
            return tracks.filter(function (t) { return t !== null && t !== undefined; });
          });
        }).catch(function () { return []; });
      },
      getCount: function () {
        return getAllFromStore('history').then(function (all) { return all.length; }).catch(function () { return 0; });
      },
      clear: function () {
        return new Promise(function (resolve, reject) {
          var txn = _db.transaction('history', 'readwrite');
          txn.objectStore('history').clear();
          txn.oncomplete = resolve;
          txn.onerror = function () { reject(txn.error); };
        });
      }
    },

    downloads: {
      save: function (trackId, blob) {
        return putToStore('downloads', { id: 'dl_' + trackId, trackId: trackId, blob: blob, savedAt: new Date().toISOString() }).then(function () {
          var numeric = Number(trackId);
          if (isNaN(numeric)) return; // IDs de YouTube (yt_...) no son numéricos
          return getByIdFromStore('tracks', numeric).then(function (track) {
            if (track) { track.isDownloaded = 1; return putToStore('tracks', track); }
          });
        });
      },
      get: function (trackId) {
        return getByIdFromStore('downloads', 'dl_' + trackId).then(function (dl) {
          return dl ? dl.blob : null;
        }).catch(function () { return null; });
      },
      getAll: function () {
        return getAllFromStore('downloads').then(function (all) {
          return all.map(function (d) { return d.trackId; });
        });
      },
      delete: function (trackId) {
        return deleteFromStore('downloads', 'dl_' + trackId).then(function () {
          var numeric = Number(trackId);
          if (isNaN(numeric)) return;
          return getByIdFromStore('tracks', numeric).then(function (track) {
            if (track) { track.isDownloaded = 0; return putToStore('tracks', track); }
          });
        });
      },
      getStorageUsed: function () {
        return getAllFromStore('downloads').then(function (all) {
          return all.reduce(function (total, d) { return total + (d.blob ? d.blob.size || 0 : 0); }, 0);
        });
      },
      clearAll: function () {
        return new Promise(function (resolve, reject) {
          var txn = _db.transaction('downloads', 'readwrite');
          txn.objectStore('downloads').clear();
          txn.oncomplete = function () {
            // Reset all tracks' isDownloaded flag
            getAllFromStore('tracks').then(function (tracks) {
              var txn2 = _db.transaction('tracks', 'readwrite');
              var store = txn2.objectStore('tracks');
              tracks.forEach(function (t) { t.isDownloaded = 0; store.put(t); });
              txn2.oncomplete = resolve;
            });
          };
          txn.onerror = function () { reject(txn.error); };
        });
      }
    },

    settings: {
      /*
       * Las distintas páginas guardaban las mismas preferencias con nombres
       * diferentes ("darkMode" vs "dark_mode", "fontSize" vs "font_size"...),
       * así que al reiniciar la app no se recuperaban. Ahora se aceptan las dos
       * formas y siempre se escribe la canónica (la que se pidió).
       */
      get: function (key) {
        return getByIdFromStore('settings', key).then(function (s) {
          if (s) return s.value;
          var alt = alternateSettingKey(key);
          if (alt === key) return null;
          return getByIdFromStore('settings', alt).then(function (s2) {
            return s2 ? s2.value : null;
          });
        }).catch(function () { return null; });
      },
      set: function (key, value) {
        return putToStore('settings', { key: key, value: value });
      },
      getAll: function () {
        return getAllFromStore('settings').then(function (all) {
          var obj = {};
          all.forEach(function (s) { obj[s.key] = s.value; });
          return obj;
        });
      }
    },

    // Reset everything
    reset: function () {
      return new Promise(function (resolve) {
        _db.close();
        _db = null;
        var req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { resolve(); };
      });
    }
  };
})();
