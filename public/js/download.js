/**
 * Sonora Music — Download Manager & Task Queue
 * Handles native device downloads, offline IndexedDB storage, and active task progress
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var _activeDownloads = {}; // id -> { id, title, artist, progress, speed, eta, format, quality, mode, startTime }
  var _completedHistory = [];

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

  Sonora.Download = {
    /**
     * Start a download task
     * @param {Object} track Track object
     * @param {string} [format='mp3'] 'mp3' or 'mp4'
     * @param {string} [quality='320k']
     * @param {string} [mode='both'] 'device' | 'sonora' | 'both'
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

      var serverBase = (Sonora.API && typeof Sonora.API.getActiveUrl === 'function')
        ? Sonora.API.getActiveUrl()
        : 'http://192.168.1.132:3000';

      var targetUrl = track.url || track.sourceUrl || '';
      if (!targetUrl && track.videoId) {
        targetUrl = 'https://www.youtube.com/watch?v=' + track.videoId;
      }
      if (!targetUrl && typeof track.id === 'string' && track.id.startsWith('yt_')) {
        targetUrl = 'https://www.youtube.com/watch?v=' + track.id.replace('yt_', '');
      }
      if (!targetUrl) {
        targetUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(artist + ' ' + title);
      }

      var downloadUrl = serverBase + '/api/download/external?url=' + encodeURIComponent(targetUrl) +
        '&format=' + encodeURIComponent(format) +
        '&quality=' + encodeURIComponent(quality) +
        '&title=' + encodeURIComponent(title) +
        '&artist=' + encodeURIComponent(artist);

      // Register in active downloads
      _activeDownloads[taskId] = {
        id: taskId,
        trackId: track.id,
        title: title,
        artist: artist,
        format: format,
        quality: quality,
        mode: mode,
        progress: 5,
        speed: '1.5 MB/s',
        eta: '12s',
        startTime: Date.now()
      };
      updateBadge();

      if (Sonora.Store) {
        Sonora.Store.emit('toast', {
          message: '⚡ Iniciando descarga de "' + title + '"...',
          type: 'info'
        });
      }

      // 1. Native Device Download (Android)
      if (mode === 'device' || mode === 'both') {
        var mime = format === 'mp4' ? 'video/mp4' : 'audio/mpeg';
        if (window.SonoraNative && typeof window.SonoraNative.downloadFile === 'function') {
          window.SonoraNative.downloadFile(downloadUrl, filename, mime);
        } else {
          // Web fallback
          var a = document.createElement('a');
          a.href = downloadUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }

      // Simulated progress animation for visual feedback
      var progressInterval = setInterval(function () {
        if (!_activeDownloads[taskId]) {
          clearInterval(progressInterval);
          return;
        }
        var current = _activeDownloads[taskId].progress;
        if (current < 90) {
          _activeDownloads[taskId].progress += Math.floor(Math.random() * 15) + 8;
          var elapsed = (Date.now() - _activeDownloads[taskId].startTime) / 1000;
          var remaining = Math.max(1, Math.round((100 - current) / 12));
          _activeDownloads[taskId].eta = remaining + 's';
          _activeDownloads[taskId].speed = (Math.random() * 0.8 + 1.2).toFixed(1) + ' MB/s';
          updateBadge();
        }
      }, 500);

      // 2. Offline Sonora Storage (IndexedDB + Synced Lyrics)
      try {
        var syncedLyrics = '';
        var plainLyrics = '';
        try {
          var cleanSearchArtist = artist.replace(/\(.*?\)|\{.*?\}|\[.*?\]/g, '').trim();
          var cleanSearchTitle = title.replace(/\(.*?\)|\{.*?\}|\[.*?\]/g, '').trim();
          var lrcUrl = 'https://lrclib.net/api/get?artist_name=' + encodeURIComponent(cleanSearchArtist) + '&track_name=' + encodeURIComponent(cleanSearchTitle);
          var lrcResp = await fetch(lrcUrl);
          if (lrcResp.ok) {
            var lrcData = await lrcResp.json();
            syncedLyrics = lrcData.syncedLyrics || '';
            plainLyrics = lrcData.plainLyrics || '';
          }
        } catch (lrcErr) {}

        var audioBlob = null;
        if (mode === 'sonora' || mode === 'both') {
          try {
            var streamFetchUrl = serverBase + '/api/stream/external?url=' + encodeURIComponent(targetUrl);
            var blobResp = await fetch(streamFetchUrl);
            if (blobResp.ok) {
              audioBlob = await blobResp.blob();
            }
          } catch (bErr) {
            console.warn('[Download] Audio blob fetch warning:', bErr);
          }
        }

        var newTrack = {
          id: track.id || ('dl_' + Date.now()),
          title: title,
          artist: artist,
          album: track.album || (track.platform === 'youtube' ? 'YouTube Music' : 'Sonora Music'),
          albumId: track.albumId || 1,
          artistId: track.artistId || 1,
          duration: track.duration || 215,
          artworkUrl: track.thumbnail || track.artworkUrl || '',
          sourceUrl: targetUrl,
          streamUrl: `${serverBase}/api/stream/external?url=${encodeURIComponent(targetUrl)}`,
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
        if (Sonora.DB && Sonora.DB.downloads && audioBlob) {
          await Sonora.DB.downloads.save(newTrack.id, audioBlob);
        }

        clearInterval(progressInterval);
        if (_activeDownloads[taskId]) {
          _activeDownloads[taskId].progress = 100;
        }

        // Add to completed history
        var completedItem = {
          id: taskId,
          trackId: newTrack.id,
          title: title,
          artist: artist,
          format: format,
          quality: quality,
          filename: filename,
          timestamp: Date.now(),
          artworkUrl: track.thumbnail || track.artworkUrl || ''
        };
        _completedHistory.unshift(completedItem);
        saveHistory();

        delete _activeDownloads[taskId];
        updateBadge();

        if (Sonora.Store) {
          Sonora.Store.emit('toast', {
            message: '✓ "' + title + '" completada (' + format.toUpperCase() + ')',
            type: 'success'
          });
        }
      } catch (err) {
        clearInterval(progressInterval);
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
            <!-- Active Downloads -->
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
                  ${activeList.map(item => `
                    <div style="background:#1e1e2d; border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
                        <span style="font-weight:700; font-size:14px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">
                          ${item.title}
                        </span>
                        <span style="font-size:12px; font-weight:700; color:var(--color-primary, #FF4757);">${item.progress}%</span>
                      </div>
                      <div style="font-size:11px; color:#888; margin-bottom:8px;">
                        ${item.artist} • ${item.format.toUpperCase()} (${item.quality}) • Velocidad: ${item.speed} • Restante: ${item.eta}
                      </div>
                      <div style="height:5px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                        <div style="height:100%; width:${item.progress}%; background:linear-gradient(90deg, #FF6B35, #FF4757); transition:width 0.3s ease;"></div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>

            <!-- Completed History -->
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
                  ${historyList.map(item => `
                    <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); border-radius:10px; padding:10px 12px;">
                      <div style="min-width:0; flex:1;">
                        <div style="font-weight:600; font-size:13px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                          ${item.title}
                        </div>
                        <div style="font-size:11px; color:#888;">
                          ${item.artist} • ${item.format.toUpperCase()}
                        </div>
                      </div>
                      <div style="display:flex; gap:6px; flex-shrink:0; margin-left:10px;">
                        <button type="button" class="btn-dl-play" data-track-id="${item.trackId}" style="background:var(--color-primary, #FF4757); border:none; color:#fff; border-radius:14px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">
                          ▶ Sonora
                        </button>
                        <button type="button" class="btn-dl-lark" data-title="${encodeURIComponent(item.title)}" data-artist="${encodeURIComponent(item.artist)}" style="background:#22253d; border:1px solid rgba(255,255,255,0.1); color:#4fc3f7; border-radius:14px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">
                          📱 Lark
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        </div>
      `;

      modal.classList.add('visible');

      // Bind close
      var closeBtn = modal.querySelector('#btn-close-downloads');
      if (closeBtn) {
        closeBtn.onclick = function () {
          modal.classList.remove('visible');
        };
      }
      modal.onclick = function (e) {
        if (e.target === modal) modal.classList.remove('visible');
      };

      // Bind clear history
      var clearBtn = modal.querySelector('#btn-clear-dl-history');
      if (clearBtn) {
        clearBtn.onclick = function () {
          Sonora.Download.clearHistory();
          Sonora.Download.openDownloadsModal();
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

      // Open in Lark Player
      modal.querySelectorAll('.btn-dl-lark').forEach(function (btn) {
        btn.onclick = function () {
          var tTitle = decodeURIComponent(btn.getAttribute('data-title') || '');
          var tArtist = decodeURIComponent(btn.getAttribute('data-artist') || '');
          if (window.SonoraNative && typeof window.SonoraNative.openInLarkPlayer === 'function') {
            window.SonoraNative.openInLarkPlayer(tTitle, tArtist);
          } else {
            alert('Para abrir con Lark Player, instala Lark Player desde Google Play en tu teléfono Android.');
          }
        };
      });
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
          }
        });
      }
      return Promise.resolve();
    }
  };
})();
