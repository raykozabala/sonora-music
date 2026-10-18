/**
 * Sonora Music — Download Manager & Task Queue
 * Handles native device downloads, offline IndexedDB storage, and active task progress
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var _activeDownloads = {}; // id -> { id, title, artist, progress, speed, eta, format, quality, mode, startTime }
  var _completedHistory = [];
  var _modalRefreshTimer = null;

  // Cola de "descargar playlist completa"
  // { name, mode, total, done, failed, skipped, running, cancelled, current }
  var _playlistBatch = null;
  var _batchHideTimer = null;

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Tarjeta flotante con el progreso del lote (visible en cualquier página). */
  function renderBatchCard() {
    var b = _playlistBatch;
    var el = document.getElementById('sonora-dl-batch-card');

    if (!b) {
      if (el) { el.style.display = 'none'; el.innerHTML = ''; }
      return;
    }

    if (!el) {
      el = document.createElement('div');
      el.id = 'sonora-dl-batch-card';
      el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:100px;z-index:9998;width:min(92vw,460px);display:none;';
      document.body.appendChild(el);
    }

    var pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
    var heading = b.running ? '⬇️ Descargando playlist' : (b.cancelled ? '⏹ Descarga cancelada' : '✅ Playlist descargada');
    el.innerHTML = `
      <div style="background:var(--color-surface, #1c1c1e);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,0.45);display:flex;gap:12px;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:800;color:var(--color-text-primary, #fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${heading} · ${escHtml(b.name)}
          </div>
          <div style="font-size:11.5px;color:var(--color-text-secondary, #aaa);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${b.done}/${b.total}${b.current ? ' • ' + escHtml(b.current.title) : ''}${b.failed ? ' • ' + b.failed + ' fallaron' : ''}${b.skipped ? ' • ' + b.skipped + ' ya estaban' : ''}
          </div>
          <div style="height:5px;background:rgba(255,255,255,0.12);border-radius:3px;overflow:hidden;margin-top:8px;">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#FF6B35,#FF4757);transition:width 0.3s ease;"></div>
          </div>
        </div>
        <button type="button" id="sonora-dl-batch-btn"
                style="flex-shrink:0;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:var(--color-text-primary, #fff);border-radius:12px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;">
          ${b.running ? 'Detener' : 'OK'}
        </button>
      </div>`;
    el.style.display = 'block';

    var btn = document.getElementById('sonora-dl-batch-btn');
    if (btn) {
      btn.onclick = function () {
        if (b.running) {
          Sonora.Download.cancelPlaylistDownload();
        } else {
          _playlistBatch = null;
          emitBatch();
        }
      };
    }

    if (!b.running) {
      if (_batchHideTimer) clearTimeout(_batchHideTimer);
      _batchHideTimer = setTimeout(function () {
        if (_playlistBatch && !_playlistBatch.running) {
          _playlistBatch = null;
          renderBatchCard();
        }
      }, 7000);
    }
  }

  function emitBatch() {
    try { renderBatchCard(); } catch (e) {}
    try {
      if (Sonora.Store && typeof Sonora.Store.emit === 'function') {
        Sonora.Store.emit('playlistDownload', _playlistBatch ? JSON.parse(JSON.stringify(_playlistBatch)) : null);
      }
    } catch (e) {}
  }

  function loadHistory() {
    try {
      var saved = localStorage.getItem('sonora_download_history');
      if (saved) _completedHistory = JSON.parse(saved);
    } catch (e) {
      _completedHistory = [];
    }
  }

  function saveHistory() {
    try {
      if (_completedHistory.length > 50) _completedHistory = _completedHistory.slice(0, 50);
      localStorage.setItem('sonora_download_history', JSON.stringify(_completedHistory));
    } catch (e) {}
  }

  loadHistory();

  function updateBadge() {
    var count = Object.keys(_activeDownloads).length;
    var badges = document.querySelectorAll('.downloads-badge');
    badges.forEach(function (b) {
      if (count > 0) {
        b.textContent = count;
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    });

    if (Sonora.Store) {
      Sonora.Store.set('activeDownloadsCount', count);
      Sonora.Store.emit('downloadsChanged', {
        active: Object.values(_activeDownloads),
        completed: _completedHistory
      });
    }
  }

  // -------------------------------------------------------------------------
  // Utilidades de descarga
  // -------------------------------------------------------------------------
  function formatBytes(bytes) {
    if (!bytes || bytes < 1) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function buildTargetUrl(track, title, artist) {
    var targetUrl = track.url || track.sourceUrl || '';
    if (!targetUrl && track.videoId) targetUrl = 'https://www.youtube.com/watch?v=' + track.videoId;
    if (!targetUrl && typeof track.id === 'string' && track.id.indexOf('yt_') === 0) {
      targetUrl = 'https://www.youtube.com/watch?v=' + track.id.replace('yt_', '');
    }
    if (!targetUrl) {
      targetUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(artist + ' ' + title);
    }
    return targetUrl;
  }

  function buildDownloadUrl(base, targetUrl, format, quality, title, artist) {
    return String(base).replace(/\/+$/, '') + '/api/download/external?url=' + encodeURIComponent(targetUrl) +
      '&format=' + encodeURIComponent(format) +
      '&quality=' + encodeURIComponent(quality) +
      '&title=' + encodeURIComponent(title) +
      '&artist=' + encodeURIComponent(artist);
  }

  // Servidores a probar, en orden: el activo, luego local y Render.
  function getCandidateServers() {
    var list = [];
    var active = (Sonora.API && Sonora.API.getActiveUrl) ? Sonora.API.getActiveUrl() : null;
    var local = (Sonora.API && Sonora.API.getLocalUrl) ? Sonora.API.getLocalUrl() : null;
    var render = (Sonora.API && Sonora.API.getRenderUrl) ? Sonora.API.getRenderUrl() : null;
    [active, local, render].forEach(function (u) {
      if (u && list.indexOf(u) === -1) list.push(u);
    });
    if (!list.length) list.push('http://192.168.1.132:3000');
    return list;
  }

  /**
   * Nombre de archivo legible y seguro: quita acentos y caracteres que Android
   * no admite. Sin esto el gestor de descargas mostraba nombres rotos.
   */
  function safeFileName(artist, title, format) {
    function clean(s) {
      var out = String(s == null ? '' : s);
      try {
        if (out.normalize) out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      } catch (e) {}
      return out
        .replace(/[\u2018\u2019\u201C\u201D]/g, '')
        .replace(/[/\\:*?"<>|#%\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    var a = clean(artist) || 'Sonora Music';
    var t = clean(title) || 'Cancion';
    var name = a + ' - ' + t;
    if (name.length > 110) name = name.substring(0, 110).trim();
    return name + '.' + format;
  }

  /**
   * Escribe en la carpeta Descargas del teléfono un blob que YA tenemos.
   * Es la vía fiable: no depende de que el servidor responda rápido, funciona
   * con los datos ya bajados y el archivo aparece al instante.
   */
  function saveBlobToDevice(blob, filename, mime, taskId) {
    return new Promise(function (resolve) {
      var native = window.SonoraNative;
      if (!native || typeof native.startSaveToDownloads !== 'function') return resolve(false);

      var started = '';
      try { started = native.startSaveToDownloads(filename, mime); } catch (e) { started = ''; }
      if (!started) return resolve(false);

      var CHUNK = 192 * 1024;
      var offset = 0;

      function fail() {
        try { native.abortSaveToDownloads(); } catch (e) {}
        resolve(false);
      }

      function pump() {
        if (offset >= blob.size) {
          try { return resolve(!!native.finishSaveToDownloads() || true); } catch (e) { return resolve(false); }
        }
        var slice = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
        var reader = new FileReader();
        reader.onload = function () {
          var b64 = String(reader.result || '').split(',')[1] || '';
          var ok = false;
          try { ok = native.appendSaveChunk(b64); } catch (e) { ok = false; }
          if (!ok) return fail();
          offset += CHUNK;
          var t = _activeDownloads[taskId];
          if (t) {
            t.phase = 'saving';
            t.speed = 'Guardando en el teléfono…';
            t.progress = Math.min(99, Math.round((offset / blob.size) * 100));
            updateBadge();
          }
          setTimeout(pump, 0);
        };
        reader.onerror = fail;
        reader.readAsDataURL(slice);
      }
      pump();
    });
  }

  /** Primer servidor que responda, para no lanzar descargas condenadas. */
  function pickReachableServer() {
    var servers = getCandidateServers();
    var i = 0;
    function next() {
      if (i >= servers.length) return Promise.resolve(null);
      var base = servers[i++];
      return fetch(base.replace(/\/+$/, '') + '/api/health', { method: 'GET' })
        .then(function (r) { return r.ok ? base : next(); })
        .catch(function () { return next(); });
    }
    return next();
  }

  /**
   * Descarga un blob reportando progreso REAL (bytes y Content-Length).
   */
  function fetchBlobWithProgress(url, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.timeout = 600000; // 10 min

      xhr.onprogress = function (e) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          ratio: e.total > 0 ? (e.loaded / e.total) : 0,
          indeterminate: !e.lengthComputable || e.total === 0
        });
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          reject(new Error('Servidor respondió HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { reject(new Error('Error de red')); };
      xhr.ontimeout = function () { reject(new Error('Tiempo de espera agotado')); };
      xhr.send();
    });
  }

  Sonora.Download = {
    /**
     * Guarda un archivo de texto (p. ej. la letra) en el teléfono.
     * En Android usa el mismo puente nativo que las descargas (carpeta
     * Descargas) y en web cae a una descarga normal del navegador.
     */
    saveTextFile: async function (text, filename, mime) {
      mime = mime || 'text/plain';
      var blob = new Blob([text], { type: mime + ';charset=utf-8' });
      try {
        var ok = await saveBlobToDevice(blob, filename, mime, 'txt_' + Date.now());
        if (ok) return true;
      } catch (e) {}
      try {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          if (a.parentElement) a.parentElement.removeChild(a);
          URL.revokeObjectURL(url);
        }, 4000);
        return true;
      } catch (e2) {
        return false;
      }
    },

    safeFileName: safeFileName,

    /**
     * Descarga real de una canción:
     *  - Copia offline dentro de la app (IndexedDB) para reproducir sin internet
     *  - Archivo real en el teléfono vía el gestor de descargas de Android
     * Muestra progreso REAL: bytes, velocidad y tiempo restante.
     */
    startDownload: async function (track, format, quality, mode) {
      if (!track) return;
      format = (format || 'mp3').toLowerCase();
      quality = quality || (format === 'mp3' ? '320k' : '720p');
      mode = mode || 'both';

      var taskId = 'dl_' + (track.id || Date.now());
      var title = track.title || 'Canción';
      var artist = track.artist || 'Sonora Music';
      var filename = safeFileName(artist, title, format);
      var targetUrl = buildTargetUrl(track, title, artist);
      var mime = format === 'mp4' ? 'video/mp4' : 'audio/mpeg';
      var servers = getCandidateServers();

      _activeDownloads[taskId] = {
        id: taskId,
        trackId: track.id,
        title: title,
        artist: artist,
        format: format,
        quality: quality,
        mode: mode,
        progress: 0,
        phase: 'preparing',
        speed: 'Preparando…',
        eta: '--',
        startTime: Date.now(),
        bytes: 0,
        total: 0
      };
      updateBadge();

      if (Sonora.Store) {
        Sonora.Store.emit('toast', { message: '⚡ Preparando "' + title + '"...', type: 'info' });
      }

      function updateTask(progress) {
        var t = _activeDownloads[taskId];
        if (!t) return;
        t.bytes = progress.loaded;
        if (progress.indeterminate) {
          t.phase = 'preparing';
          t.speed = 'Preparando…';
          t.eta = '--';
        } else {
          t.phase = 'downloading';
          t.total = progress.total;
          t.progress = Math.max(1, Math.min(99, Math.round(progress.ratio * 100)));
          var elapsed = Math.max(0.5, (Date.now() - t.startTime) / 1000);
          var bps = progress.loaded / elapsed;
          t.speed = formatBytes(bps) + '/s';
          t.eta = bps > 0 ? Math.max(0, Math.round((progress.total - progress.loaded) / bps)) + 's' : '--';
        }
        updateBadge();
      }

      var blob = null;
      var usedServer = null;
      var lastError = null;
      var savedToDevice = false;

      // 1) Copia offline dentro de la app (blob en IndexedDB)
      if (mode === 'sonora' || mode === 'both') {
        for (var i = 0; i < servers.length; i++) {
          try {
            blob = await fetchBlobWithProgress(
              buildDownloadUrl(servers[i], targetUrl, format, quality, title, artist),
              updateTask
            );
            usedServer = servers[i];
            break;
          } catch (err) {
            lastError = err;
            console.warn('[Download] servidor ' + servers[i] + ' falló:', err.message);
          }
        }
        if (!blob) {
          delete _activeDownloads[taskId];
          updateBadge();
          if (Sonora.Store) {
            Sonora.Store.emit('toast', {
              message: '✗ No se pudo descargar "' + title + '": ' +
                (lastError ? lastError.message : 'sin conexión con el servidor'),
              type: 'error'
            });
          }
          return;
        }
      }

      // 2) Archivo real en el teléfono
      //   2a) Lo normal: escribir en Descargas el blob que YA tenemos. Es
      //       inmediato, no depende del servidor y evita que Android deje la
      //       descarga "en espera para reintentar" con 0 B y nombre roto.
      if (mode === 'device' || mode === 'both') {
        if (blob) {
          savedToDevice = await saveBlobToDevice(blob, filename, mime, taskId);
        }

        if (!savedToDevice) {
          // 2b) Sin blob (modo "solo teléfono"): usar el gestor de Android,
          //     pero sólo con un servidor que responda de verdad.
          var deviceServer = usedServer || await pickReachableServer();
          if (deviceServer) {
            var deviceUrl = buildDownloadUrl(deviceServer, targetUrl, format, quality, title, artist);
            try {
              if (window.SonoraNative && typeof window.SonoraNative.downloadFile === 'function') {
                savedToDevice = !!window.SonoraNative.downloadFile(deviceUrl, filename, mime);
              } else {
                var a = document.createElement('a');
                a.href = deviceUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                savedToDevice = true;
              }
            } catch (e) {
              console.warn('[Download] device download error:', e);
            }
          } else if (Sonora.Store) {
            Sonora.Store.emit('toast', {
              message: '⚠ No hay ningún servidor disponible para guardar en el teléfono',
              type: 'warning'
            });
          }
        }
      }

      // 3) Guardar en la biblioteca + letras
      try {
        var syncedLyrics = '';
        var plainLyrics = '';
        try {
          var cleanSearchArtist = artist.replace(/\(.*?\)|\{.*?\}|\[.*?\]/g, '').trim();
          var cleanSearchTitle = title.replace(/\(.*?\)|\{.*?\}|\[.*?\]/g, '').trim();
          var lyricsBase = usedServer || servers[0] || '';
          var lyricsEndpoint = lyricsBase
            ? (lyricsBase.replace(/\/+$/, '') + '/api/lyrics?artist=' + encodeURIComponent(cleanSearchArtist) + '&title=' + encodeURIComponent(cleanSearchTitle))
            : ('https://lrclib.net/api/get?artist_name=' + encodeURIComponent(cleanSearchArtist) + '&track_name=' + encodeURIComponent(cleanSearchTitle));
          var lrcResp = await fetch(lyricsEndpoint);
          if (lrcResp.ok) {
            var lrcData = await lrcResp.json();
            syncedLyrics = lrcData.syncedLyrics || '';
            plainLyrics = lrcData.plainLyrics || '';
          }
        } catch (lrcErr) {}

        var trackId = track.id || ('dl_' + Date.now());
        var newTrack = {
          id: trackId,
          title: title,
          artist: artist,
          album: track.album || (track.platform === 'youtube' ? 'YouTube Music' : 'Sonora Music'),
          albumId: track.albumId || 1,
          artistId: track.artistId || 1,
          duration: track.duration || 215,
          artworkUrl: track.thumbnail || track.artworkUrl || '',
          sourceUrl: targetUrl,
          streamUrl: (usedServer || servers[0]) + '/api/stream/external?url=' + encodeURIComponent(targetUrl),
          filePath: '',
          isFavorite: 0,
          playCount: 1,
          lastPlayed: new Date().toISOString(),
          dateAdded: new Date().toISOString(),
          genre: track.genre || 'Descargas',
          year: new Date().getFullYear(),
          trackNumber: 1,
          lyrics: plainLyrics,
          syncedLyrics: syncedLyrics,
          isDownloaded: 1
        };

        if (Sonora.DB && Sonora.DB.tracks) {
          await Sonora.DB.tracks.add(newTrack).catch(function () {});
        }
        if (blob && Sonora.DB && Sonora.DB.downloads && Sonora.DB.downloads.save) {
          await Sonora.DB.downloads.save(trackId, blob);
        }

        if (_activeDownloads[taskId]) {
          _activeDownloads[taskId].progress = 100;
          _activeDownloads[taskId].phase = 'done';
        }

        _completedHistory.unshift({
          id: taskId,
          trackId: trackId,
          title: title,
          artist: artist,
          format: format,
          quality: quality,
          filename: filename,
          timestamp: Date.now(),
          size: blob ? blob.size : 0,
          deviceSaved: !!savedToDevice,
          artworkUrl: track.thumbnail || track.artworkUrl || ''
        });
        saveHistory();

        delete _activeDownloads[taskId];
        updateBadge();

        if (Sonora.Store) {
          Sonora.Store.emit('toast', {
            message: '✓ "' + title + '" lista (' + format.toUpperCase() +
              (savedToDevice ? ' · guardada en Descargas' : ' · guardada en Sonora') + ')',
            type: 'success'
          });
        }
        if (Sonora.Store) {
          Sonora.Store.emit('downloadsChanged', { active: [], completed: _completedHistory });
        }
      } catch (err) {
        delete _activeDownloads[taskId];
        updateBadge();
        console.error('[Download] Task error:', err);
      }
    },

    getActiveDownloads: function () {
      return Object.values(_activeDownloads);
    },

    /**
     * Descarga TODA una playlist, una canción detrás de otra (cola secuencial
     * para no saturar el servidor). Informa del progreso del lote mediante el
     * evento 'playlistDownload' del Store.
     * @param {Array} tracks  Canciones de la playlist
     * @param {string} name   Nombre de la playlist (para los mensajes)
     * @param {string} mode   'sonora' (offline en la app), 'device' o 'both'
     */
    downloadPlaylist: async function (tracks, name, mode) {
      var list = (tracks || []).filter(function (t) { return t && !t.isDeviceTrack; });
      mode = mode || 'sonora';
      name = name || 'Playlist';

      if (_playlistBatch && _playlistBatch.running) {
        if (Sonora.Store) {
          Sonora.Store.emit('toast', { message: '⚠ Ya hay una descarga de playlist en curso', type: 'warning' });
        }
        return _playlistBatch;
      }

      if (!list.length) {
        if (Sonora.Store) {
          Sonora.Store.emit('toast', {
            message: 'ℹ Esta playlist no tiene canciones de Sonora que descargar',
            type: 'info'
          });
        }
        return null;
      }

      _playlistBatch = {
        name: name,
        mode: mode,
        total: list.length,
        done: 0,
        failed: 0,
        skipped: 0,
        running: true,
        cancelled: false,
        current: null,
        startedAt: Date.now()
      };
      emitBatch();

      if (Sonora.Store) {
        Sonora.Store.emit('toast', {
          message: '⬇️ Descargando "' + name + '" (' + list.length + ' canciones)…',
          type: 'info'
        });
      }

      var arr = list;
      for (var i = 0; i < arr.length; i++) {
        if (!_playlistBatch.running) break;

        var tr = arr[i];
        _playlistBatch.current = { title: tr.title || 'Canción', artist: tr.artist || '', index: i + 1 };
        emitBatch();

        // Si ya está descargada offline, la saltamos sin volver a bajarla.
        var already = false;
        try { already = await Sonora.Download.isDownloaded(tr.id); } catch (e) { already = false; }

        if (already) {
          _playlistBatch.skipped++;
          _playlistBatch.done++;
          emitBatch();
          continue;
        }

        var before = _completedHistory.length;
        try {
          await Sonora.Download.startDownload(tr, 'mp3', '320k', mode);
        } catch (e) {
          console.warn('[Download] fallo en la cola de la playlist:', e && e.message);
        }
        // startDownload no lanza al fallar: comparamos el historial para saberlo.
        if (_completedHistory.length > before) _playlistBatch.done++;
        else _playlistBatch.failed++;
        emitBatch();
      }

      var batch = _playlistBatch;
      batch.running = false;
      batch.current = null;
      emitBatch();

      if (Sonora.Store) {
        if (batch.cancelled) {
          Sonora.Store.emit('toast', {
            message: '⏹ Descarga de "' + name + '" cancelada (' + batch.done + '/' + batch.total + ')',
            type: 'warning'
          });
        } else {
          Sonora.Store.emit('toast', {
            message: '✓ Playlist "' + name + '" lista: ' + batch.done + ' de ' + batch.total +
              (batch.failed ? ' (' + batch.failed + ' fallaron)' : ''),
            type: 'success'
          });
        }
      }
      return batch;
    },

    getPlaylistBatch: function () {
      return _playlistBatch;
    },

    cancelPlaylistDownload: function () {
      if (_playlistBatch && _playlistBatch.running) {
        _playlistBatch.running = false;
        _playlistBatch.cancelled = true;
        emitBatch();
      }
    },

    getCompletedHistory: function () {
      return _completedHistory;
    },

    clearHistory: function () {
      _completedHistory = [];
      saveHistory();
      updateBadge();
    },

    /**
     * Open Download Manager modal dialog
     */
    openDownloadsModal: function () {
      var modal = document.getElementById('downloads-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'downloads-modal';
        modal.className = 'modal-downloads-overlay';
        document.body.appendChild(modal);
      }

      function renderModal() {
        var activeList = Object.values(_activeDownloads);
        var historyList = _completedHistory;

        modal.innerHTML = `
        <div class="modal-downloads-card">
          <div class="modal-downloads-header">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:20px;">📥</span>
              <h3 style="margin:0; font-size:18px; font-weight:800; color:#fff;">Gestor de Descargas</h3>
            </div>
            <button type="button" class="btn-close-modal" id="btn-close-downloads">&times;</button>
          </div>

          <div class="modal-downloads-body">
            <!-- Descargas en curso -->
            <div style="margin-bottom:20px;">
              <div style="font-size:12px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">
                Descargas en curso (${activeList.length})
              </div>
              ${activeList.length === 0 ? `
                <div style="padding:14px; text-align:center; background:rgba(255,255,255,0.03); border-radius:10px; color:#777; font-size:13px;">
                  No hay descargas activas en este momento.
                </div>
              ` : `
                <div style="display:flex; flex-direction:column; gap:10px;">
                  ${activeList.map(function (item) {
                    var preparing = item.phase === 'preparing';
                    var label = preparing ? 'Preparando…' : (item.progress + '%');
                    var barStyle = preparing
                      ? 'width:35%; animation: sonora-dl-pulse 1.1s ease-in-out infinite;'
                      : 'width:' + item.progress + '%; transition:width 0.3s ease;';
                    var detail = preparing
                      ? 'Convirtiendo en el servidor…'
                      : (item.phase === 'saving'
                        ? 'Guardando en el teléfono…'
                        : (item.speed + ' • Restante: ' + item.eta +
                           (item.total ? ' • ' + formatBytes(item.bytes) + ' de ' + formatBytes(item.total) : '')));
                    return `
                    <div style="background:var(--color-surface); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
                        <span style="font-weight:700; font-size:14px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">
                          ${item.title}
                        </span>
                        <span style="font-size:12px; font-weight:700; color:var(--color-primary, #FF4757);">${label}</span>
                      </div>
                      <div style="font-size:11px; color:#888; margin-bottom:8px;">
                        ${item.artist} • ${item.format.toUpperCase()} (${item.quality}) • ${detail}
                      </div>
                      <div style="height:5px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                        <div style="height:100%; ${barStyle} background:linear-gradient(90deg, #FF6B35, #FF4757);"></div>
                      </div>
                    </div>`;
                  }).join('')}
                </div>
              `}
            </div>

            <!-- Historial -->
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:12px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.8px;">
                  Historial de descargas (${historyList.length})
                </span>
                ${historyList.length > 0 ? `
                  <button type="button" id="btn-clear-dl-history" style="background:none; border:none; color:#FF5252; font-size:11px; font-weight:600; cursor:pointer;">
                    Limpiar historial
                  </button>
                ` : ''}
              </div>

              ${historyList.length === 0 ? `
                <div style="padding:18px; text-align:center; background:rgba(255,255,255,0.03); border-radius:10px; color:#777; font-size:13px;">
                  Aún no has completado descargas.
                </div>
              ` : `
                <div style="display:flex; flex-direction:column; gap:8px; max-height:240px; overflow-y:auto;">
                  ${historyList.map(function (item) { return `
                    <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); border-radius:10px; padding:10px 12px;">
                      <div style="min-width:0; flex:1;">
                        <div style="font-weight:600; font-size:13px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                          ${item.title}
                        </div>
                        <div style="font-size:11px; color:#888;">
                          ${item.artist} • ${item.format.toUpperCase()}${item.size ? ' • ' + formatBytes(item.size) : ''}
                        </div>
                      </div>
                      <div style="display:flex; gap:6px; flex-shrink:0; margin-left:10px;">
                        <button type="button" class="btn-dl-play" data-track-id="${item.trackId}" style="background:var(--color-primary, #FF4757); border:none; color:#fff; border-radius:14px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">
                          ▶ Sonora
                        </button>
                        <button type="button" class="btn-dl-lark" data-title="${encodeURIComponent(item.title)}" data-artist="${encodeURIComponent(item.artist)}" style="background:var(--color-surface-elevated); border:1px solid rgba(255,255,255,0.1); color:#4fc3f7; border-radius:14px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">
                          📱 Abrir con
                        </button>
                      </div>
                    </div>`;
                  }).join('')}
                </div>
              `}
            </div>
          </div>
        </div>
      `;

        // Bind close
        var closeBtn = modal.querySelector('#btn-close-downloads');
        if (closeBtn) {
          closeBtn.onclick = function () { modal.classList.remove('visible'); };
        }
        modal.onclick = function (e) {
          if (e.target === modal) modal.classList.remove('visible');
        };

        // Bind clear history
        var clearBtn = modal.querySelector('#btn-clear-dl-history');
        if (clearBtn) {
          clearBtn.onclick = function () {
            Sonora.Download.clearHistory();
            renderModal();
          };
        }

        // Play in Sonora
        modal.querySelectorAll('.btn-dl-play').forEach(function (btn) {
          btn.onclick = async function () {
            var tid = btn.getAttribute('data-track-id');
            if (Sonora.DB && Sonora.DB.tracks) {
              var tr = await Sonora.DB.tracks.getById(tid);
              if (tr && Sonora.Player) {
                modal.classList.remove('visible');
                Sonora.Player.play(tr);
              }
            }
          };
        });

        // Abrir con reproductor externo (Lark / selector del sistema)
        modal.querySelectorAll('.btn-dl-lark').forEach(function (btn) {
          btn.onclick = function () {
            var tTitle = decodeURIComponent(btn.getAttribute('data-title') || '');
            var tArtist = decodeURIComponent(btn.getAttribute('data-artist') || '');
            if (window.SonoraNative && typeof window.SonoraNative.openInLarkPlayer === 'function') {
              window.SonoraNative.openInLarkPlayer(tTitle, tArtist);
            } else {
              alert('Esta opción abre la canción en un reproductor del teléfono (Lark Player, etc.). Solo está disponible en la app Android.');
            }
          };
        });
      }

      renderModal();
      modal.classList.add('visible');

      // Refresco en vivo mientras hay descargas activas
      if (_modalRefreshTimer) clearInterval(_modalRefreshTimer);
      _modalRefreshTimer = setInterval(function () {
        if (!modal.classList.contains('visible')) {
          clearInterval(_modalRefreshTimer);
          _modalRefreshTimer = null;
          return;
        }
        if (Object.keys(_activeDownloads).length === 0) return;
        var body = modal.querySelector('.modal-downloads-body');
        var prevScroll = body ? body.scrollTop : 0;
        renderModal();
        var newBody = modal.querySelector('.modal-downloads-body');
        if (newBody) newBody.scrollTop = prevScroll;
      }, 700);
    },

    isDownloaded: function (trackId) {
      if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.get === 'function') {
        return Sonora.DB.downloads.get(trackId).then(function (blob) {
          return blob !== null && blob !== undefined;
        }).catch(function () { return false; });
      }
      return Promise.resolve(false);
    },

    deleteDownload: function (trackId) {
      if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.delete === 'function') {
        return Sonora.DB.downloads.delete(trackId).then(function () {
          if (Sonora.Store) {
            Sonora.Store.emit('toast', { message: 'Descarga eliminada', type: 'info' });
            Sonora.Store.emit('downloadsChanged', { active: Object.values(_activeDownloads), completed: _completedHistory });
          }
        });
      }
      return Promise.resolve();
    },

    /**
     * Compatibilidad: descarga rápida de una canción (MP3 320k, copia offline + teléfono)
     */
    downloadTrack: function (track, opts) {
      opts = opts || {};
      return Sonora.Download.startDownload(
        track,
        opts.format || 'mp3',
        opts.quality || (opts.format === 'mp4' ? '720p' : '320k'),
        opts.mode || 'both'
      );
    },

    /**
     * Espacio total usado por las descargas offline (bytes)
     */
    getStorageUsed: function () {
      if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.getStorageUsed === 'function') {
        return Sonora.DB.downloads.getStorageUsed().catch(function () { return 0; });
      }
      return Promise.resolve(0);
    },

    /**
     * Lista de pistas descargadas (para reproducción offline)
     */
    getDownloadedTracks: function () {
      if (!Sonora.DB || !Sonora.DB.downloads || typeof Sonora.DB.downloads.getAll !== 'function') {
        return Promise.resolve([]);
      }
      return Sonora.DB.downloads.getAll().then(function (ids) {
        if (!ids || !ids.length) return [];
        return Promise.all(ids.map(function (id) {
          var key = (typeof id === 'number' && isNaN(id)) ? null : id;
          if (key === null) return null;
          return Sonora.DB.tracks.getById(key).then(function (t) { return t || null; }).catch(function () { return null; });
        }));
      }).then(function (tracks) {
        return tracks.filter(function (t) { return !!t; });
      }).catch(function () { return []; });
    }
  };
})();
