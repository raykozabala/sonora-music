/**
 * Sonora Music — Importar desde Spotify y YouTube Music
 *
 * No pide contraseñas ni claves API. Lee la ficha PÚBLICA que Spotify sirve
 * a cualquier visitante (playlist, álbum o artista) y la lista pública de
 * YouTube Music, y después empareja cada canción con su vídeo para poder
 * reproducirla y descargarla dentro de Sonora.
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mediaBase() {
    try {
      if (Sonora.API && typeof Sonora.API.getMediaBase === 'function') {
        var b = Sonora.API.getMediaBase();
        if (b) return String(b).replace(/\/+$/, '');
      }
      if (Sonora.API && typeof Sonora.API.getActiveUrl === 'function') {
        var a = Sonora.API.getActiveUrl();
        if (a) return String(a).replace(/\/+$/, '');
      }
    } catch (e) {}
    return 'https://sonora-music-b1ee.onrender.com';
  }

  function toast(msg, type) {
    if (Sonora.Store) Sonora.Store.emit('toast', { message: msg, type: type || 'info' });
  }

  /** Solo enlaces que realmente son una lista (playlist/álbum/artista). */
  function detectPlaylistLink(url) {
    var raw = String(url || '').trim();
    if (spotifyPlaylistLike(raw)) return 'spotify';
    if (/[?&]list=([A-Za-z0-9_-]{10,})/.test(raw)) return 'youtube';
    return '';
  }

  function spotifyPlaylistLike(raw) {
    return /spotify:(playlist|album|artist|track):[A-Za-z0-9]+/i.test(raw) ||
      /open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?(playlist|album|artist|track)\/[A-Za-z0-9]+/i.test(raw);
  }

  function detectService(url) {
    var raw = String(url || '').trim();
    if (/spotify\.com|spotify:/i.test(raw)) return 'spotify';
    if (/youtube\.com|youtu\.be|music\.youtube/i.test(raw)) return 'youtube';
    return '';
  }

  async function getJson(path) {
    var resp = await fetch(mediaBase() + path, { headers: { 'Accept': 'application/json' } });
    var data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok) {
      var err = new Error((data && data.error) || ('El servidor respondió HTTP ' + resp.status));
      err.code = (data && data.code) || 'http_' + resp.status;
      err.status = resp.status;
      err.retryAfter = Number(data && data.retryAfter) || 0;
      throw err;
    }
    return data;
  }

  /** Reintenta si el servidor pide esperar (429) al actualizar varias listas. */
  async function getJsonRetry(path, attempts) {
    var tries = attempts || 3;
    for (var a = 0; a < tries; a++) {
      try {
        return await getJson(path);
      } catch (e) {
        if (e && e.code === 'http_429' && a < tries - 1) {
          await wait(Math.min((e.retryAfter || 3) * 1000, 8000));
          continue;
        }
        throw e;
      }
    }
    throw new Error('El servidor está ocupado. Inténtalo de nuevo en un minuto.');
  }

  async function postJson(path, body) {
    var resp = await fetch(mediaBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok) {
      var err = new Error((data && data.error) || ('El servidor respondió HTTP ' + resp.status));
      err.code = (data && data.code) || 'http_' + resp.status;
      err.status = resp.status;
      err.retryAfter = Number(data && data.retryAfter) || 0;
      throw err;
    }
    return data;
  }

  /** Guarda la carátula como data URL para que el mosaico se vea sin red. */
  async function coverDataUrl(url) {
    if (!url || String(url).indexOf('data:') === 0) return url || '';
    try {
      var resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) return '';
      var blob = await resp.blob();
      return await new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { resolve(''); };
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return '';
    }
  }

  function durationText(sec) {
    sec = Number(sec) || 0;
    if (!sec) return '';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function year() { return new Date().getFullYear(); }

  async function findTrack(id) {
    try { return await Sonora.DB.tracks.getById(id); } catch (e) { return null; }
  }

  /** Normaliza para comparar títulos aunque cambien acentos o «(feat. …)». */
  function normKey(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function firstArtist(value) {
    return String(value || '')
      .split(/\s*(?:,|&|;|\bfeat\.?\b|\bft\.?\b|\bcon\b|\s+x\s+)\s*/i)[0]
      .trim();
  }

  function trackKey(title, artist) {
    var t = normKey(title);
    var a = normKey(firstArtist(artist));
    return a ? (t + '::' + a) : t;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * Índice de todas las pistas del dispositivo. Sirve para reutilizar una
   * canción ya descargada/favorita en lugar de crear un duplicado cuando la
   * playlist se actualiza. Se construye una sola vez por sincronización.
   */
  async function buildCatalog() {
    var all = [];
    try { all = await Sonora.DB.tracks.getAll(); } catch (e) { all = []; }
    var cat = { all: all || [], byId: {}, bySpotifyId: {}, byVideoId: {}, byKey: {} };
    (cat.all || []).forEach(function (t) {
      if (!t || !t.id) return;
      cat.byId[t.id] = t;
      if (t.spotifyId && !cat.bySpotifyId[t.spotifyId]) cat.bySpotifyId[t.spotifyId] = t;
      if (t.videoId && !cat.byVideoId[t.videoId]) cat.byVideoId[t.videoId] = t;
      var k = trackKey(t.title, t.artist);
      if (k) {
        cat.byKey[k] = cat.byKey[k] || [];
        cat.byKey[k].push(t);
      }
    });
    return cat;
  }

  function remember(catalog, track) {
    if (!catalog || !track || !track.id) return;
    catalog.byId[track.id] = track;
    if (track.spotifyId) catalog.bySpotifyId[track.spotifyId] = track;
    if (track.videoId) catalog.byVideoId[track.videoId] = track;
    var k = trackKey(track.title, track.artist);
    if (k) {
      var bucket = catalog.byKey[k] = catalog.byKey[k] || [];
      if (bucket.indexOf(track) === -1) bucket.push(track);
    }
  }

  /**
   * Crea (o reutiliza) la pista de Sonora para una canción.
   * El id `yt_<videoId>` es el mismo que usa el buscador, así que una canción
   * importada y la misma canción buscada a mano son la misma entrada.
   */
  async function ensureTrack(info, opts) {
    opts = opts || {};
    var videoId = info.videoId || '';
    var spotifyId = info.spotifyId || '';
    var id = videoId
      ? ('yt_' + videoId)
      : ('imp_' + Math.abs(hashCode(spotifyId || ((info.artist || '') + ' ' + (info.title || '')))).toString(36));
    var existing = await findTrack(id);
    var thumb = info.thumbnail || (videoId ? 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg' : '');

    if (existing) {
      var changed = false;
      if (!existing.spotifyId && spotifyId) { existing.spotifyId = spotifyId; changed = true; }
      if (!existing.videoId && videoId) {
        existing.videoId = videoId;
        existing.sourceUrl = 'https://www.youtube.com/watch?v=' + videoId;
        changed = true;
      }
      if (!existing.duration && info.duration) {
        existing.duration = Number(info.duration) || 0;
        existing.durationText = durationText(existing.duration);
        changed = true;
      }
      if (!existing.artworkUrl && thumb) { existing.artworkUrl = thumb; existing.coverSourceUrl = thumb; changed = true; }
      if (changed) { try { await Sonora.DB.tracks.update(existing); } catch (e) {} }
      return existing;
    }

    var track = {
      id: id,
      videoId: videoId,
      spotifyId: spotifyId,
      title: info.title || 'Canción importada',
      artist: info.artist || 'Artista desconocido',
      album: opts.album || (opts.service === 'spotify' ? 'Importada de Spotify' : 'Importada de YouTube Music'),
      albumId: 1,
      artistId: 1,
      duration: Number(info.duration) || 0,
      durationText: durationText(info.duration),
      artworkUrl: thumb,
      coverSourceUrl: thumb,
      sourceUrl: videoId ? ('https://www.youtube.com/watch?v=' + videoId) : '',
      platform: 'youtube',
      genre: opts.service === 'spotify' ? 'Spotify' : 'YouTube Music',
      year: year(),
      trackNumber: opts.index || 1,
      isFavorite: 0,
      playCount: 0,
      dateAdded: new Date().toISOString(),
      importedFrom: opts.service || '',
      importedPlaylist: opts.playlistName || ''
    };
    try { await Sonora.DB.tracks.add(track); } catch (e) {}
    return track;
  }

  function hashCode(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
    return h;
  }

  /** Actualiza metadatos sin tocar descarga, portada local ni favoritos. */
  async function adoptTrack(catalog, track, remote, service) {
    var changed = false;
    if (remote.spotifyId && track.spotifyId !== remote.spotifyId) { track.spotifyId = remote.spotifyId; changed = true; }
    if (remote.title && track.title !== remote.title) { track.title = remote.title; changed = true; }
    if (remote.artist && track.artist !== remote.artist) { track.artist = remote.artist; changed = true; }
    if (!track.duration && remote.duration) {
      track.duration = Number(remote.duration) || 0;
      track.durationText = durationText(track.duration);
      changed = true;
    }
    if (!track.artworkUrl && remote.thumbnail) { track.artworkUrl = remote.thumbnail; changed = true; }
    if (!track.importedFrom) { track.importedFrom = service || ''; changed = true; }
    if (changed) { try { await Sonora.DB.tracks.update(track); } catch (e) {} }
    remember(catalog, track);
    return track;
  }

  /** Añade el vídeo de YouTube que faltaba, conservando el mismo id de pista. */
  async function attachVideo(catalog, track, match) {
    if (!match || !match.videoId) return track;
    var changed = false;
    if (!track.videoId) {
      track.videoId = match.videoId;
      track.sourceUrl = 'https://www.youtube.com/watch?v=' + match.videoId;
      changed = true;
    }
    if (!track.duration && match.duration) {
      track.duration = Number(match.duration) || 0;
      track.durationText = durationText(track.duration);
      changed = true;
    }
    if (!track.artworkUrl && match.thumbnail) { track.artworkUrl = match.thumbnail; changed = true; }
    if (track.platform !== 'youtube') { track.platform = 'youtube'; changed = true; }
    if (changed) { try { await Sonora.DB.tracks.update(track); } catch (e) {} }
    remember(catalog, track);
    return track;
  }

  async function createPlaylist(data, service) {
    var cover = await coverDataUrl(data.cover || '');
    var playlist = {
      name: data.name || 'Playlist importada',
      description: service === 'spotify'
        ? ('Importada de Spotify · ' + (data.total || data.tracks.length) + ' canciones')
        : ('Importada de YouTube Music · ' + (data.total || data.tracks.length) + ' canciones'),
      artworkUrl: cover || data.cover || '',
      coverSourceUrl: data.cover || '',
      trackIds: [],
      userCreated: 1,
      importedFrom: service,
      importSourceUrl: data.url || '',
      importSourceName: data.author || '',
      importedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    return await Sonora.DB.playlists.create(playlist);
  }

  async function savePlaylist(pl) {
    pl.updatedAt = new Date().toISOString();
    try { await Sonora.DB.playlists.update(pl); } catch (e) {}
  }

  /** Empareja por lotes con reintento si el servidor pide esperar (429). */
  async function matchTracks(tracks) {
    if (!tracks || !tracks.length) return [];
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var payload = await postJson('/api/import/match', { tracks: tracks });
        return (payload && payload.matches) || [];
      } catch (e) {
        if (attempt < 2) {
          await wait(e && e.code === 'http_429'
            ? Math.min((e.retryAfter || 3) * 1000, 8000)
            : 500);
        }
      }
    }
    return [];
  }

  /** Guarda las 6 primeras carátulas como data URL para el mosaico sin red. */
  async function cacheFirstCovers(playlist, count) {
    var firstIds = (playlist.trackIds || []).slice(0, count || 6);
    for (var k = 0; k < firstIds.length; k++) {
      var t = await findTrack(firstIds[k]);
      if (t && t.artworkUrl && String(t.artworkUrl).indexOf('data:') !== 0) {
        var local = await coverDataUrl(t.artworkUrl);
        if (local) {
          t.artworkUrl = local;
          try { await Sonora.DB.tracks.update(t); } catch (e) {}
        }
      }
    }
  }

  /**
   * Reconstruye una playlist importada desde su enlace original.
   *
   * - Spotify: reutiliza cada canción por `spotifyId` (y por título+artista
   *   para las importadas antes de 7.19.3), así no se duplica nada.
   * - YouTube Music: reutiliza por `videoId`.
   * - Respeta el orden de la fuente, añade las nuevas y conserva las
   *   descargas, portadas y favoritos de las que ya existían.
   * - Las canciones que ya no están en el origen se quedan al final (no se
   *   borra trabajo del usuario).
   */
  async function syncFromSource(playlist, onProgress, preloaded) {
    var service = playlist.importedFrom;
    var sourceUrl = playlist.importSourceUrl;
    if (!service || !sourceUrl) {
      var err = new Error('Esta playlist no tiene guardado el enlace de Spotify/YouTube.');
      err.code = 'no_source';
      throw err;
    }

    var data = preloaded;
    if (!data) {
      var endpoint = service === 'spotify' ? '/api/import/spotify' : '/api/import/youtube';
      // fresh=1 evita la caché del servidor: al actualizar queremos el estado real.
      data = await getJsonRetry(endpoint + '?fresh=1&url=' + encodeURIComponent(sourceUrl), 3);
    }
    if (!data || !data.tracks || !data.tracks.length) {
      throw new Error('La playlist de origen ya no tiene canciones públicas.');
    }

    var catalog = await buildCatalog();
    var currentIds = (playlist.trackIds || []).slice();
    var currentSet = {};
    var used = {};
    currentIds.forEach(function (id) { currentSet[id] = true; });

    var stats = { total: 0, matched: 0, missing: 0, reused: 0, added: 0, kept: 0 };
    var items = [];

    for (var i = 0; i < data.tracks.length; i++) {
      var remote = data.tracks[i];
      if (!remote || !remote.title) continue;
      stats.total++;

      var found = null;
      if (service === 'spotify') {
        if (remote.spotifyId && catalog.bySpotifyId[remote.spotifyId]) {
          found = catalog.bySpotifyId[remote.spotifyId];
        }
        if (!found) {
          // Compatibilidad con importaciones anteriores: se reconocen por
          // título+artista y se les guarda el spotifyId para la próxima vez.
          var bucket = catalog.byKey[trackKey(remote.title, remote.artist)] || [];
          for (var b = 0; b < bucket.length; b++) {
            if (used[bucket[b].id]) continue;
            // Preferimos una pista que ya estaba en ESTA playlist.
            if (currentSet[bucket[b].id]) { found = bucket[b]; break; }
            if (!found) found = bucket[b];
          }
        }
      } else if (remote.videoId && catalog.byVideoId[remote.videoId]) {
        found = catalog.byVideoId[remote.videoId];
      }

      if (found) {
        used[found.id] = true;
        await adoptTrack(catalog, found, remote, service);
        stats.reused++;
      }
      items.push({ remote: remote, track: found || null });
    }

    // Emparejar solo lo que todavía no tiene vídeo (lo nuevo o lo pendiente).
    var need = [];
    for (var n = 0; n < items.length; n++) {
      if (!items[n].track || !items[n].track.videoId) need.push(n);
    }

    var batchSize = 10;
    for (var start = 0; start < need.length; start += batchSize) {
      var indexes = need.slice(start, start + batchSize);
      var payloadTracks = indexes.map(function (idx) { return items[idx].remote; });
      var matches = await matchTracks(payloadTracks);

      for (var m = 0; m < indexes.length; m++) {
        var item = items[indexes[m]];
        var match = matches[m];

        if (!item.track) {
          // ¿Ese vídeo ya existe en el dispositivo (buscado a mano u otra lista)?
          var byVideo = match && match.videoId ? catalog.byVideoId[match.videoId] : null;
          if (byVideo && !used[byVideo.id]) {
            item.track = await adoptTrack(catalog, byVideo, item.remote, service);
            used[byVideo.id] = true;
            stats.reused++;
          } else {
            item.track = await ensureTrack({
              videoId: match ? match.videoId : '',
              spotifyId: item.remote.spotifyId || '',
              title: item.remote.title,
              artist: item.remote.artist || (match && match.artist) || '',
              duration: (match && match.duration) || item.remote.duration,
              thumbnail: (match && match.thumbnail) || item.remote.thumbnail || (data.cover || '')
            }, {
              service: service,
              album: data.name,
              playlistName: playlist.name,
              index: indexes[m] + 1
            });
            remember(catalog, item.track);
            used[item.track.id] = true;
            stats.added++;
          }
        }

        if (item.track && match && !item.track.videoId) {
          await attachVideo(catalog, item.track, match);
        }
      }

      if (onProgress) {
        var doneSoFar = 0;
        var matchedSoFar = 0;
        for (var d = 0; d < items.length; d++) {
          if (items[d].track && items[d].track.id) {
            doneSoFar++;
            if (items[d].track.videoId) matchedSoFar++;
          }
        }
        onProgress(doneSoFar, stats.total, matchedSoFar, Math.max(0, doneSoFar - matchedSoFar));
      }
    }

    // Recuento real al terminar (algunas pistas pendientes se resolvieron al emparejar).
    stats.matched = 0;
    stats.missing = 0;
    for (var c = 0; c < items.length; c++) {
      if (items[c].track && items[c].track.videoId) stats.matched++;
      else stats.missing++;
    }

    // Orden de la fuente primero; lo que no está en el origen se conserva al final.
    var targetIds = [];
    for (var t = 0; t < items.length; t++) {
      var tr = items[t].track;
      if (tr && tr.id && targetIds.indexOf(tr.id) === -1) targetIds.push(tr.id);
    }
    var extras = currentIds.filter(function (id) { return targetIds.indexOf(id) === -1; });
    stats.kept = extras.length;
    playlist.trackIds = targetIds.concat(extras);

    // Nombre, descripción y portada al día (sin volver a bajar la portada si es la misma).
    if (data.name) playlist.name = data.name;
    playlist.description = service === 'spotify'
      ? ('Importada de Spotify · ' + stats.total + ' canciones · actualizada')
      : ('Importada de YouTube Music · ' + stats.total + ' canciones · actualizada');
    if (data.cover && playlist.coverSourceUrl !== data.cover) {
      var localCover = await coverDataUrl(data.cover);
      playlist.coverSourceUrl = data.cover;
      playlist.artworkUrl = localCover || playlist.artworkUrl || data.cover;
    }
    playlist.lastSyncAt = new Date().toISOString();
    playlist.lastSyncCount = stats.total;
    // En la importación inicial no decimos «+N nuevas»: ya se ve el total.
    playlist.lastSyncAdded = preloaded ? 0 : stats.added;
    playlist.importSourceName = data.author || playlist.importSourceName || '';

    await cacheFirstCovers(playlist, 6);
    await savePlaylist(playlist);

    if (onProgress) onProgress(stats.total, stats.total, stats.matched, stats.missing);

    return {
      playlist: playlist,
      added: stats.added,
      reused: stats.reused,
      kept: stats.kept,
      matched: stats.matched,
      missing: stats.missing,
      total: stats.total
    };
  }

  /** Importación nueva: crea la playlist y delega en el mismo motor de sync. */
  async function runSpotify(url, onProgress) {
    var data = await getJson('/api/import/spotify?url=' + encodeURIComponent(url));
    if (!data.tracks || !data.tracks.length) {
      throw new Error('Esa lista de Spotify no tiene canciones visibles.');
    }
    var playlist = await createPlaylist(data, 'spotify');
    var result = await syncFromSource(playlist, onProgress, data);
    return result;
  }

  async function runYouTube(url, onProgress) {
    var data = await getJson('/api/import/youtube?url=' + encodeURIComponent(url));
    if (!data.tracks || !data.tracks.length) {
      throw new Error('Esa playlist de YouTube no tiene canciones públicas.');
    }
    var playlist = await createPlaylist(data, 'youtube');
    var result = await syncFromSource(playlist, onProgress, data);
    return result;
  }

  function notify() {
    try { if (Sonora.Store) Sonora.Store.emit('playlistsChanged', {}); } catch (e) {}
  }

  /* ── Interfaz ─────────────────────────────────────────────────────────── */

  var _busy = false;

  function styles() {
    return `
      #sonora-import-overlay {
        position: fixed; inset: 0; z-index: 9500;
        background: rgba(4, 5, 10, .78);
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        display: flex; align-items: center; justify-content: center;
        padding: 18px; animation: sonoraImportFade .18s ease;
      }
      @keyframes sonoraImportFade { from { opacity: 0 } to { opacity: 1 } }
      .sonora-import {
        width: min(560px, 100%); max-height: min(86vh, 760px); overflow: auto;
        background: linear-gradient(180deg, #17181f 0%, #0c0d12 100%);
        border: 1px solid rgba(255,255,255,.09); border-radius: 22px;
        box-shadow: 0 40px 120px rgba(0,0,0,.65);
        color: #fff; font-family: inherit;
      }
      .sonora-import__head {
        padding: 22px 24px 10px; display: flex; align-items: flex-start; gap: 12px;
      }
      .sonora-import__badge {
        width: 46px; height: 46px; border-radius: 14px; flex: 0 0 46px;
        display: grid; place-items: center; font-size: 22px;
        background: linear-gradient(135deg, #1ed760, #0b6b33);
      }
      .sonora-import__badge--yt { background: linear-gradient(135deg, #ff4b4b, #8b0f0f); }
      .sonora-import__title { font-size: 19px; font-weight: 800; letter-spacing: -.01em; }
      .sonora-import__sub { font-size: 12.5px; color: rgba(255,255,255,.56); margin-top: 3px; line-height: 1.45; }
      .sonora-import__close {
        margin-left: auto; border: 0; background: rgba(255,255,255,.08); color: #fff;
        width: 34px; height: 34px; border-radius: 50%; cursor: pointer; font-size: 16px;
      }
      .sonora-import__body { padding: 8px 24px 24px; }
      .sonora-import__tabs { display: flex; gap: 8px; margin: 10px 0 16px; }
      .sonora-import__tab {
        flex: 1; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04);
        color: rgba(255,255,255,.72); border-radius: 12px; padding: 10px 12px;
        font-weight: 700; font-size: 13px; cursor: pointer; transition: .15s;
      }
      .sonora-import__tab.is-active {
        background: #fff; color: #0b0b0f; border-color: #fff;
      }
      .sonora-import__label { font-size: 11px; font-weight: 800; letter-spacing: .08em;
        text-transform: uppercase; color: rgba(255,255,255,.42); margin-bottom: 7px; }
      .sonora-import__row { display: flex; gap: 8px; }
      .sonora-import__input {
        flex: 1; min-width: 0; background: #0a0b10; border: 1px solid rgba(255,255,255,.12);
        border-radius: 12px; padding: 13px 14px; color: #fff; font-size: 14px; outline: none;
      }
      .sonora-import__input:focus { border-color: rgba(30,215,96,.7); box-shadow: 0 0 0 3px rgba(30,215,96,.12); }
      .sonora-import__paste {
        border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06);
        color: #fff; border-radius: 12px; padding: 0 14px; font-weight: 700; cursor: pointer;
      }
      .sonora-import__go {
        margin-top: 12px; width: 100%; border: 0; border-radius: 999px; padding: 14px;
        background: #1ed760; color: #08130b; font-size: 14.5px; font-weight: 900; cursor: pointer;
        transition: transform .12s ease, filter .12s ease;
      }
      .sonora-import__go:active { transform: scale(.985); }
      .sonora-import__go[disabled] { opacity: .55; cursor: default; }
      .sonora-import__hint { margin-top: 14px; font-size: 12px; line-height: 1.6; color: rgba(255,255,255,.45); }
      .sonora-import__hint b { color: rgba(255,255,255,.75); }
      .sonora-import__progress {
        margin-top: 16px; background: rgba(255,255,255,.06); border-radius: 12px; padding: 13px 14px;
        border: 1px solid rgba(255,255,255,.07);
      }
      .sonora-import__bar { height: 7px; border-radius: 99px; background: rgba(255,255,255,.1); overflow: hidden; margin-top: 9px; }
      .sonora-import__bar > i { display: block; height: 100%; width: 0; border-radius: 99px;
        background: linear-gradient(90deg, #1ed760, #8ff0ad); transition: width .25s ease; }
      .sonora-import__status { font-size: 12.5px; color: rgba(255,255,255,.72); line-height: 1.5; }
      .sonora-import__error {
        margin-top: 14px; border-radius: 12px; padding: 12px 14px; font-size: 12.5px; line-height: 1.55;
        background: rgba(255,71,87,.12); border: 1px solid rgba(255,71,87,.35); color: #ffb4ba;
      }
      .sonora-import__done {
        margin-top: 16px; border-radius: 14px; padding: 16px; text-align: center;
        background: rgba(30,215,96,.1); border: 1px solid rgba(30,215,96,.3);
      }
      .sonora-import__done h3 { margin: 0 0 4px; font-size: 16px; }
      .sonora-import__done p { margin: 0 0 12px; font-size: 12.5px; color: rgba(255,255,255,.62); }
      .sonora-import__open {
        border: 0; border-radius: 999px; padding: 10px 22px; background: #fff; color: #0b0b0f;
        font-weight: 800; font-size: 13px; cursor: pointer;
      }
      .sonora-import__examples { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
      .sonora-import__example {
        border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04);
        color: rgba(255,255,255,.62); border-radius: 999px; padding: 6px 11px; font-size: 11px; cursor: pointer;
      }
    `;
  }

  function open(prefill) {
    var existing = $('#sonora-import-overlay');
    if (existing) existing.remove();

    if (!$('#sonora-import-styles')) {
      var st = document.createElement('style');
      st.id = 'sonora-import-styles';
      st.textContent = styles();
      document.head.appendChild(st);
    }

    var overlay = document.createElement('div');
    overlay.id = 'sonora-import-overlay';
    overlay.innerHTML = `
      <div class="sonora-import" role="dialog" aria-modal="true" aria-label="Importar música">
        <div class="sonora-import__head">
          <div class="sonora-import__badge" id="si-badge">🎧</div>
          <div>
            <div class="sonora-import__title">Importar desde otra app</div>
            <div class="sonora-import__sub">
              Trae tus playlists a Sonora y escúchalas aquí, con letra y descarga offline.
            </div>
          </div>
          <button class="sonora-import__close" id="si-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="sonora-import__body">
          <div class="sonora-import__tabs">
            <button class="sonora-import__tab is-active" data-service="spotify" id="si-tab-spotify">Spotify</button>
            <button class="sonora-import__tab" data-service="youtube" id="si-tab-youtube">YouTube Music · experimental</button>
          </div>
          <div class="sonora-import__label">Enlace de la playlist · puedes pegar varias, una por línea</div>
          <div class="sonora-import__row">
            <input class="sonora-import__input" id="si-url" type="url" inputmode="url"
              placeholder="https://open.spotify.com/playlist/..." autocomplete="off" />
            <button class="sonora-import__paste" id="si-paste" title="Pegar">Pegar</button>
          </div>
          <button class="sonora-import__go" id="si-go">Importar playlist</button>
          <div class="sonora-import__examples">
            <button class="sonora-import__example" data-fill="https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M">Ejemplo: Éxitos de Spotify</button>
          </div>
          <div id="si-msg"></div>
          <div class="sonora-import__hint" id="si-hint">
            <b>Sin contraseñas y sin claves API.</b> Sonora lee la ficha pública que Spotify
            muestra a cualquier visitante, así que la playlist debe ser pública. Después busca
            cada canción en YouTube para poder reproducirla y descargarla dentro de Sonora.
            Spotify no permite reproducir su audio en otras apps, por eso no se abre Spotify:
            la canción suena desde Sonora.
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    var service = 'spotify';
    var urlInput = $('#si-url', overlay);
    if (prefill) urlInput.value = prefill;

    function close() { overlay.remove(); }

    $('#si-close', overlay).addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', onEsc);
        return;
      }
      if (e.key === 'Escape') close();
    });

    Array.prototype.forEach.call(overlay.querySelectorAll('.sonora-import__tab'), function (tab) {
      tab.addEventListener('click', function () {
        if (_busy) return;
        service = tab.getAttribute('data-service');
        Array.prototype.forEach.call(overlay.querySelectorAll('.sonora-import__tab'), function (t) {
          t.classList.toggle('is-active', t === tab);
        });
        var badge = $('#si-badge', overlay);
        badge.textContent = service === 'spotify' ? '🎧' : '▶️';
        badge.classList.toggle('sonora-import__badge--yt', service === 'youtube');
        urlInput.placeholder = service === 'spotify'
          ? 'https://open.spotify.com/playlist/...'
          : 'https://music.youtube.com/playlist?list=...';
        $('#si-hint', overlay).innerHTML = service === 'spotify'
          ? '<b>Sin contraseñas y sin claves API.</b> Sonora lee la ficha pública que Spotify muestra a cualquier visitante, así que la playlist debe ser pública. Después busca cada canción en YouTube para poder reproducirla y descargarla dentro de Sonora. Spotify no permite reproducir su audio en otras apps, por eso no se abre Spotify: la canción suena desde Sonora.'
          : '<b>Experimental.</b> Lee playlists públicas de YouTube Music y usa sus mismos vídeos, así que la reproducción es exacta. Las listas privadas de tu cuenta necesitan iniciar sesión y no se pueden leer sin OAuth.';
        hideMessage();
      });
    });

    Array.prototype.forEach.call(overlay.querySelectorAll('[data-fill]'), function (btn) {
      btn.addEventListener('click', function () {
        urlInput.value = btn.getAttribute('data-fill');
        urlInput.focus();
      });
    });

    $('#si-paste', overlay).addEventListener('click', async function () {
      try {
        var text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          var detected = detectService(text);
          if (detected) {
            var tab = overlay.querySelector('[data-service="' + detected + '"]');
            if (tab && !tab.classList.contains('is-active')) tab.click();
          }
          showMessage('Enlace pegado. Pulsa «Importar playlist».', 'ok');
        }
      } catch (e) {
        showMessage('Tu navegador no deja leer el portapapeles. Mantén pulsado el campo y elige Pegar.', 'error');
      }
    });

    function hideMessage() {
      var box = $('#si-msg', overlay);
      if (box) box.innerHTML = '';
    }

    function showMessage(text, kind) {
      var box = $('#si-msg', overlay);
      if (!box) return;
      box.innerHTML = kind === 'error'
        ? '<div class="sonora-import__error">' + esc(text) + '</div>'
        : (kind === 'ok'
          ? '<div class="sonora-import__progress"><div class="sonora-import__status">' + esc(text) + '</div></div>'
          : '');
    }

    function showProgress(done, total, matched, missing, label) {
      var box = $('#si-msg', overlay);
      if (!box) return;
      var pct = total ? Math.round((done / total) * 100) : 0;
      box.innerHTML =
        '<div class="sonora-import__progress">' +
          '<div class="sonora-import__status">' +
            (label || '') + 'Importando ' + done + ' de ' + total + ' canciones' +
            (matched ? ' · ' + matched + ' listas para sonar' : '') +
            (missing ? ' · ' + missing + ' sin vídeo (se buscarán al reproducir)' : '') +
          '</div>' +
          '<div class="sonora-import__bar"><i style="width:' + pct + '%"></i></div>' +
        '</div>';
    }

    function showDone(result) {
      var box = $('#si-msg', overlay);
      if (!box) return;
      var name = esc(result.playlist.name);
      box.innerHTML =
        '<div class="sonora-import__done">' +
          '<h3>✓ Playlist importada</h3>' +
          '<p>' + name + ' · ' + result.playlist.trackIds.length + ' canciones' +
            (result.missing ? ' · ' + result.missing + ' se buscarán al reproducir' : '') + '</p>' +
          '<button class="sonora-import__open" id="si-open-playlist">Abrir en Sonora</button>' +
        '</div>';
      var openBtn = $('#si-open-playlist', overlay);
      if (openBtn) {
        openBtn.addEventListener('click', function () {
          close();
          try { location.hash = '#/playlists/' + result.playlist.id; } catch (e) {}
        });
      }
    }

    /** Extrae todos los enlaces pegados (uno por línea o separados por espacios). */
    function extractLinks(text) {
      var found = [];
      var re = /(https?:\/\/[^\s,;]+|spotify:[a-z]+:[A-Za-z0-9]+)/gi;
      var m;
      while ((m = re.exec(String(text || '')))) {
        var link = m[1].replace(/[).]+$/, '');
        if (detectService(link) && found.indexOf(link) === -1) found.push(link);
      }
      return found;
    }

    async function doImport() {
      if (_busy) return;
      var links = extractLinks(urlInput.value);
      if (!links.length) {
        showMessage('Pega el enlace de una playlist de Spotify o YouTube Music. También puedes pegar varias, una por línea.', 'error');
        return;
      }

      _busy = true;
      var go = $('#si-go', overlay);
      go.disabled = true;
      go.textContent = 'Importando…';
      hideMessage();
      showProgress(0, 0, 0, 0);

      var importedList = [];
      var failedList = [];

      for (var idx = 0; idx < links.length; idx++) {
        var url = links[idx];
        var detected = detectService(url);
        var total = links.length;
        var label = total > 1 ? ('Playlist ' + (idx + 1) + ' de ' + total + ' · ') : '';

        try {
          if (total > 1) {
            var box = $('#si-msg', overlay);
            if (box) box.innerHTML = '<div class="sonora-import__progress"><div class="sonora-import__status">' +
              esc(label + 'leyendo el enlace…') + '</div></div>';
          }
          var result = detected === 'spotify'
            ? await runSpotify(url, function (done, count, matched, missing) {
                showProgress(done, count, matched, missing, label);
              })
            : await runYouTube(url, function (done, count) {
                showProgress(done, count, done, 0, label);
              });
          importedList.push(result);
          notify();
        } catch (e) {
          console.warn('[Import] error', url, e);
          failedList.push({ url: url, message: String((e && e.message) || 'No se pudo importar') });
        }
      }

      _busy = false;
      go.disabled = false;
      go.textContent = 'Importar playlist';

      if (importedList.length === 1 && !failedList.length) {
        showDone(importedList[0]);
        toast('✓ «' + importedList[0].playlist.name + '» importada con ' + importedList[0].playlist.trackIds.length + ' canciones', 'success');
        return;
      }

      var msgBox = $('#si-msg', overlay);
      if (msgBox) {
        var rows = importedList.map(function (r) {
          return '<div class="sonora-import__status">✓ ' + esc(r.playlist.name) + ' · ' + r.playlist.trackIds.length + ' canciones</div>';
        }).concat(failedList.map(function (f) {
          var reason = f.message;
          if (/privad|private/i.test(reason)) reason += ' (usa «Compartir → Copiar enlace»)';
          return '<div class="sonora-import__status" style="color:#ff9aa4;">✕ ' + esc(f.url.slice(0, 48)) + ' — ' + esc(reason) + '</div>';
        })).join('');
        msgBox.innerHTML =
          '<div class="sonora-import__done" style="text-align:left;">' +
            '<h3>' + importedList.length + ' playlist(s) importadas</h3>' +
            rows +
            (importedList.length ? '<button class="sonora-import__open" id="si-open-playlist">Abrir la última</button>' : '') +
          '</div>';
        var openBtn = $('#si-open-playlist', overlay);
        if (openBtn) {
          openBtn.addEventListener('click', function () {
            close();
            location.hash = '#/playlists/' + importedList[importedList.length - 1].playlist.id;
          });
        }
      }
      if (importedList.length) {
        toast('✓ ' + importedList.length + ' playlist(s) importadas' + (failedList.length ? ' · ' + failedList.length + ' fallaron' : ''), failedList.length ? 'warning' : 'success');
      }
    }

    $('#si-go', overlay).addEventListener('click', doImport);
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doImport();
    });
    setTimeout(function () { try { urlInput.focus(); } catch (e) {} }, 80);
  }

  Sonora.Import = {
    open: open,
    detectService: detectService,
    detectPlaylistLink: detectPlaylistLink,
    /**
     * Lista las playlists importadas para que el usuario pueda revisarlas,
     * abrirlas o quitarlas. No hay sesión que cerrar: Sonora nunca guarda
     * contraseñas de Spotify.
     */
    getConnections: async function () {
      var out = { spotify: [], youtube: [] };
      try {
        var all = await Sonora.DB.playlists.getAll();
        (all || []).forEach(function (pl) {
          if (!pl || !pl.importedFrom) return;
          if (out[pl.importedFrom]) out[pl.importedFrom].push(pl);
        });
      } catch (e) {}
      return out;
    },
    /**
     * Vuelve a leer el enlace de origen y reconstruye la playlist sin
     * duplicar: reutiliza cada canción por spotifyId (Spotify) o videoId
     * (YouTube Music) y conserva descargas, portadas y favoritos.
     */
    syncPlaylist: async function (id, onProgress) {
      var pl = null;
      try { pl = await Sonora.DB.playlists.getById(id); } catch (e) { pl = null; }
      if (!pl) throw new Error('Esa playlist ya no está en Sonora.');
      if (!pl.importedFrom || !pl.importSourceUrl) {
        var err = new Error('Esta playlist no se importó desde Spotify ni YouTube Music.');
        err.code = 'no_source';
        throw err;
      }
      var result = await syncFromSource(pl, onProgress);
      notify();
      return result;
    },
    /** Actualiza todas las playlists importadas que tengan enlace guardado. */
    syncAll: async function (onProgress, onItem) {
      var all = [];
      try { all = await Sonora.DB.playlists.getAll(); } catch (e) { all = []; }
      var list = (all || []).filter(function (pl) {
        return pl && pl.importedFrom && pl.importSourceUrl;
      });
      var results = [];
      for (var i = 0; i < list.length; i++) {
        if (onItem) onItem(i, list.length, list[i]);
        try {
          var r = await syncFromSource(list[i], null);
          results.push(r);
        } catch (e) {
          results.push({ playlist: list[i], error: String((e && e.message) || 'No se pudo actualizar') });
        }
      }
      notify();
      return results;
    },
    hasSource: function (pl) {
      return !!(pl && pl.importedFrom && pl.importSourceUrl);
    },
    removePlaylist: async function (id) {
      try {
        await Sonora.DB.playlists.delete(id);
        notify();
        return true;
      } catch (e) { return false; }
    }
  };
})();
