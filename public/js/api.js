/**
 * Sonora Music — API Client
 * Dual-server connection (Local PC + Render)
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var _mode = 'local'; // 'local' | 'render' | 'off' (Default to Local PC server on same Wi-Fi)
  var _localUrl = 'http://192.168.1.132:3000';
  var _renderUrl = 'https://sonora-music-b1ee.onrender.com';
  // Render (plan gratuito) hiberna: la primera petición puede tardar ~50 s.
  // Con 6 s la app se daba por "desconectada" teniendo el servidor bien.
  var _timeout = 20000;

  // Si la app se está viendo servida por el propio servidor (navegador en la PC
  // o en el celular vía http://IP:3000), usamos ese mismo origen como servidor
  // local. Así funciona sin configurar nada, aunque la IP de la red cambie.
  try {
    if (typeof window !== 'undefined' && window.location &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
      _localUrl = window.location.origin;
    }
  } catch (e) { /* entorno sin window (WebView file://) */ }

  function getBaseUrl() {
    if (_mode === 'local') return _localUrl;
    if (_mode === 'render') return _renderUrl;
    return _localUrl;
  }

  function fetchWithTimeout(url, options, timeout) {
    return new Promise(function (resolve, reject) {
      var controller = new AbortController();
      var timer = setTimeout(function () {
        controller.abort();
        reject(new Error('Request timeout'));
      }, timeout || _timeout);

      var fetchOpts = Object.assign({}, options || {}, { signal: controller.signal });

      fetch(url, fetchOpts)
        .then(function (resp) { clearTimeout(timer); resolve(resp); })
        .catch(function (err) { clearTimeout(timer); reject(err); });
    });
  }

  Sonora.API = {
    /**
     * Set connection mode
     */
    setMode: function (mode) {
      _mode = mode || 'off';
      Sonora.Store.set('serverMode', _mode);
      console.log('[API] Mode set to:', _mode);
    },

    /**
     * Get current mode
     */
    getMode: function () {
      return _mode;
    },

    /**
     * Set local server URL
     */
    setLocalUrl: function (url) {
      _localUrl = url;
      Sonora.Store.set('serverLocalUrl', _localUrl);
    },

    /**
     * Set Render server URL
     */
    setRenderUrl: function (url) {
      _renderUrl = url;
      Sonora.Store.set('serverRenderUrl', _renderUrl);
    },

    /**
     * Get local server URL
     */
    getLocalUrl: function () { return _localUrl; },

    /**
     * Get render server URL
     */
    getRenderUrl: function () { return _renderUrl; },

    /**
     * Get currently active server URL
     */
    getActiveUrl: function () {
      return getBaseUrl();
    },

    /**
     * Get related music recommendations for continuous autoplay
     */
    getRecommendations: function (artist, title) {
      var base = this.getActiveUrl();
      var url = base + '/api/recommendations?artist=' + encodeURIComponent(artist || '') + '&title=' + encodeURIComponent(title || '');
      return fetchWithTimeout(url, {}, 6000)
        .then(function (res) {
          if (!res.ok) return [];
          return res.json();
        })
        .catch(function () { return []; });
    },

    /**
     * Collaborative Playlists API
     */
    getCollaborativePlaylist: function (code) {
      var base = this.getActiveUrl();
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code), {}, 8000)
        .then(function (res) {
          if (!res.ok) throw new Error('Playlist no encontrada');
          return res.json();
        });
    },

    addTrackToCollaborative: function (code, track, playlistName) {
      var base = this.getActiveUrl();
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code) + '/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, track, { playlistName: playlistName }))
      }, 8000).then(function (res) {
        if (!res.ok) throw new Error('Error al sincronizar');
        return res.json();
      });
    },

    /** Crear/actualizar una playlist colaborativa completa en el servidor */
    saveCollaborativePlaylist: function (code, data) {
      var base = this.getActiveUrl();
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      }, 10000).then(function (res) {
        if (!res.ok) throw new Error('Error al guardar la playlist colaborativa');
        return res.json();
      });
    },

    /** Eliminar una playlist colaborativa del servidor */
    deleteCollaborativePlaylist: function (code) {
      var base = this.getActiveUrl();
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code), {
        method: 'DELETE'
      }, 8000).then(function (res) {
        if (!res.ok) throw new Error('Error al eliminar');
        return res.json();
      });
    },

    /** Quitar una canción concreta de una playlist colaborativa */
    removeTrackFromCollaborative: function (code, trackId) {
      var base = this.getActiveUrl();
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code) + '/tracks/' + encodeURIComponent(trackId), {
        method: 'DELETE'
      }, 8000).then(function (res) {
        if (!res.ok) throw new Error('Error al quitar la canción');
        return res.json();
      });
    },

    /**
     * GET request to API
     */
    get: function (endpoint) {
      var base = getBaseUrl();
      if (!base) return Promise.reject(new Error('No server configured'));
      var url = base + '/api' + endpoint;
      return fetchWithTimeout(url)
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.json();
        })
        .catch(function (err) {
          console.warn('[API] GET error:', endpoint, err.message);
          throw err;
        });
    },

    /**
     * POST request to API
     */
    post: function (endpoint, data) {
      var base = getBaseUrl();
      if (!base) return Promise.reject(new Error('No server configured'));
      var url = base + '/api' + endpoint;
      return fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      })
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.json();
        })
        .catch(function (err) {
          console.warn('[API] POST error:', endpoint, err.message);
          throw err;
        });
    },

    /**
     * PUT request to API
     */
    put: function (endpoint, data) {
      var base = getBaseUrl();
      if (!base) return Promise.reject(new Error('No server configured'));
      var url = base + '/api' + endpoint;
      return fetchWithTimeout(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      })
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.json();
        });
    },

    /**
     * DELETE request to API
     */
    del: function (endpoint) {
      var base = getBaseUrl();
      if (!base) return Promise.reject(new Error('No server configured'));
      var url = base + '/api' + endpoint;
      return fetchWithTimeout(url, { method: 'DELETE' })
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.json();
        });
    },

    /**
     * Get streaming URL for a track
     */
    streamUrl: function (trackId) {
      var base = getBaseUrl();
      if (!base) return null;
      return base + '/api/stream/' + trackId;
    },

    /**
     * Download a track's audio file as blob
     */
    downloadTrack: function (trackId) {
      var base = getBaseUrl();
      if (!base) return Promise.reject(new Error('No server configured'));
      var url = base + '/api/stream/' + trackId;
      return fetchWithTimeout(url, {}, 60000) // 60s timeout for downloads
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.blob();
        });
    },

    /**
     * Test connection to a specific server mode
     * Returns { ok: boolean, latency: number, server: string }
     */
    testConnection: function (mode, timeout) {
      var url = mode === 'local' ? _localUrl : _renderUrl;
      var start = Date.now();
      var t = timeout || 8000;

      return fetchWithTimeout(url + '/api/health', {}, t)
        .then(function (resp) {
          var latency = Date.now() - start;
          if (resp.ok) {
            return resp.json().then(function (data) {
              return { ok: true, latency: latency, server: mode, data: data };
            }).catch(function () {
              return { ok: true, latency: latency, server: mode, data: { status: 'ok' } };
            });
          }
          // Fallback to pinging root URL (especially for Render servers)
          return fetchWithTimeout(url + '/', {}, t).then(function (r2) {
            if (r2.ok) {
              return { ok: true, latency: Date.now() - start, server: mode, data: { status: 'ok', server: 'render' } };
            }
            return { ok: false, latency: latency, server: mode, error: 'HTTP ' + resp.status };
          });
        })
        .catch(function (err) {
          // Retry on root URL before failing
          return fetchWithTimeout(url + '/', {}, 8000)
            .then(function (r2) {
              if (r2.ok) {
                return { ok: true, latency: Date.now() - start, server: mode, data: { status: 'ok', server: 'render' } };
              }
              return { ok: false, latency: Date.now() - start, server: mode, error: err.message };
            })
            .catch(function () {
              return { ok: false, latency: Date.now() - start, server: mode, error: err.message };
            });
        });
    },

    /**
     * Auto-detect available server
     * Tries local first, then render, then offline
     */
    autoDetect: function () {
      return Sonora.API.testConnection('local', 6000).then(function (localResult) {
        if (localResult.ok) {
          Sonora.API.setMode('local');
          return { mode: 'local', result: localResult };
        }
        // La nube puede estar despertando: damos dos oportunidades con margen
        // amplio antes de darnos por vencidos.
        return Sonora.API.testConnection('render', 25000).then(function (r1) {
          if (r1.ok) {
            Sonora.API.setMode('render');
            return { mode: 'render', result: r1 };
          }
          return Sonora.API.testConnection('render', 30000).then(function (r2) {
            if (r2.ok || _renderUrl) {
              // Aunque el sondeo falle, si hay URL de nube la dejamos activa:
              // la propia búsqueda/canción la despertará. Antes se ponía "off"
              // y la app quedaba desconectada teniendo servidor.
              Sonora.API.setMode('render');
              return { mode: 'render', result: r2 };
            }
            Sonora.API.setMode('off');
            return { mode: 'off', result: null };
          });
        });
      }).catch(function () {
        Sonora.API.setMode(_renderUrl ? 'render' : 'off');
        return { mode: _renderUrl ? 'render' : 'off', result: null };
      });
    },

    /**
     * Sync local data with server
     */
    syncWithServer: function () {
      if (_mode === 'off') return Promise.resolve();

      return Sonora.API.get('/tracks').then(function (serverTracks) {
        if (!serverTracks || !serverTracks.length) return;
        return Sonora.DB.tracks.addMany(serverTracks);
      }).catch(function (err) {
        console.warn('[API] Sync failed:', err.message);
      });
    },

    /**
     * Initialize API with saved settings
     */
    init: function () {
      return Promise.all([
        Sonora.DB.settings.get('serverMode'),
        Sonora.DB.settings.get('serverLocalUrl'),
        Sonora.DB.settings.get('serverRenderUrl')
      ]).then(function (values) {
        if (values[0]) _mode = values[0];
        // El origen propio (si la app la sirve el servidor) tiene prioridad.
        var selfOrigin = null;
        try {
          if (window.location && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
            selfOrigin = window.location.origin;
          }
        } catch (e) {}
        if (values[1]) _localUrl = values[1];
        if (selfOrigin) _localUrl = selfOrigin;
        if (values[2]) _renderUrl = values[2];

        // Auto-detect server: try local PC first, then render
        return Sonora.API.autoDetect().then(function (det) {
          console.log('[API] Auto-detected server mode:', det.mode, 'URL:', getBaseUrl());
          Sonora.Store.set('serverMode', _mode);
          Sonora.Store.set('serverLocalUrl', _localUrl);
          Sonora.Store.set('serverRenderUrl', _renderUrl);
          Sonora.Store.set('activeServerUrl', getBaseUrl());

          var dot = document.getElementById('server-dot');
          if (dot) {
            dot.className = 'server-dot ' + (_mode === 'local' ? 'connected-local' : (_mode === 'render' ? 'connected-render' : 'disconnected'));
          }
        });
      }).catch(function (err) {
        console.warn('[API] Init fallback to local:', err);
        Sonora.API.setMode('local');
      });
    }
  };
})();
