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
      var cleanTitle = title.replace(/[/\\?%*:|"<>]/g, '_').trim();
      var cleanArtist = artist.replace(/[/\\?%*:|"<>]/g, '_').trim();
      var filename = cleanArtist + ' - ' + cleanTitle + '.' + format;
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
        if (!blob && mode === 'sonora') {
          delete _activeDownloads[taskId];
          updateBadge();
          if (Sonora.Store) {
            Sonora.Store.emit('toast', {
              message: '✗ No se pudo descargar "' + title + '": ' + (lastError ? lastError.message : 'error'),
              type: 'error'
            });
          }
          return;
        }
      }

      // 2) Archivo real en el teléfono (Android DownloadManager) o navegador
      var deviceUrl = buildDownloadUrl(usedServer || servers[0], targetUrl, format, quality, title, artist);
      try {
        if (window.SonoraNative && typeof window.SonoraNative.downloadFile === 'function') {
          window.SonoraNative.downloadFile(deviceUrl, filename, mime);
        } else {
          var a = document.createElement('a');
          a.href = deviceUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } catch (e) {
        console.warn('[Download] device download error:', e);
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
          artworkUrl: track.thumbnail || track.artworkUrl || ''
        });
        saveHistory();

        delete _activeDownloads[taskId];
        updateBadge();

        if (Sonora.Store) {
          Sonora.Store.emit('toast', {
            message: '✓ "' + title + '" descargada (' + format.toUpperCase() + ')',
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
                      : (item.speed + ' • Restante: ' + item.eta +
                         (item.total ? ' • ' + formatBytes(item.bytes) + ' de ' + formatBytes(item.total) : ''));
                    return `
                    <div style="background:#1e1e2d; border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
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
                        <button type="button" class="btn-dl-lark" data-title="${encodeURIComponent(item.title)}" data-artist="${encodeURIComponent(item.artist)}" style="background:#22253d; border:1px solid rgba(255,255,255,0.1); color:#4fc3f7; border-radius:14px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">
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
