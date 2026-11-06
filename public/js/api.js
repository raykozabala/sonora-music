/**
 * Sonora Music — API Client
 * Triple-server connection (Local PC + Render + Northflank)
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var _mode = 'device'; // 'device' | 'local' | 'render' | 'northflank' | 'off'
  var _localUrl = '';
  var _renderUrl = 'https://sonora-music-b1ee.onrender.com';
  var _northflankUrl = '';
  var _northflankToken = '';
  var _timeout = 15000;

  function isLocalHostname(hostname) {
    if (!hostname) return false;
    return hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  }

  // Si la app se está sirviendo desde un servidor local (ej. http://192.168.x.x:3000 o .local),
  // usamos ese mismo origen como servidor local sin romper si se abre desde la nube.
  try {
    if (typeof window !== 'undefined' && window.location &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
        isLocalHostname(window.location.hostname)) {
      _localUrl = window.location.origin;
    }
  } catch (e) { /* entorno sin window (WebView file://) */ }

  function getBaseUrl() {
    if (_mode === 'local') return _localUrl;
    if (_mode === 'render') return _renderUrl;
    if (_mode === 'northflank') return _northflankUrl;
    // 'device' y 'off' no tienen servidor: todo funciona con datos locales.
    return '';
  }

  /**
   * Servidor para playlists colaborativas.
   * Las playlists colaborativas necesitan un servidor compartido, así que en
   * Modo Dispositivo (APK, web local) usamos la nube de Sonora como respaldo.
   * Antes esto devolvía '' y por eso "unirse por código" nunca funcionaba en
   * el teléfono.
   */
  function getCollabBase() {
    var base = getBaseUrl();
    if (base) return base;
    return _renderUrl;
  }

  function getTimeoutForMode(mode) {
    if (mode === 'local') return 5000;
    if (mode === 'northflank') return 10000;
    return 20000; // Render puede hibernar
  }

  function fetchWithTimeout(url, options, timeout) {
    return new Promise(function (resolve, reject) {
      var controller = new AbortController();
      var t = timeout || getTimeoutForMode(_mode) || _timeout;
      var timer = setTimeout(function () {
        controller.abort();
        reject(new Error('Request timeout'));
      }, t);

      var fetchOpts = Object.assign({}, options || {}, { signal: controller.signal });
      if (_mode === 'northflank' && _northflankToken) {
        fetchOpts.headers = Object.assign({}, fetchOpts.headers || {});
        if (!fetchOpts.headers['Authorization']) {
          fetchOpts.headers['Authorization'] = 'Bearer ' + _northflankToken;
        }
      }

      fetch(url, fetchOpts)
        .then(function (resp) { clearTimeout(timer); resolve(resp); })
        .catch(function (err) { clearTimeout(timer); reject(err); });
    });
  }

  function saveSettingPersistent(key, val) {
    if (Sonora.DB && Sonora.DB.settings && typeof Sonora.DB.settings.set === 'function') {
      try { Sonora.DB.settings.set(key, val); } catch (e) {}
    }
    try {
      localStorage.setItem('sonora_' + key, JSON.stringify(val));
    } catch (e) {}
  }

  function updateStatusDotUI(mode) {
    var dot = document.getElementById('server-dot');
    if (dot) {
      dot.className = 'server-dot ' + (
        mode === 'device' ? 'server-dot--device' : (
          mode === 'local' ? 'connected-local' : (
            mode === 'northflank' ? 'connected-northflank' : (
              mode === 'render' ? 'connected-render' : 'disconnected'
            )
          )
        )
      );
      if (mode === 'device') dot.title = 'Modo Dispositivo · solo música local';
      else if (mode === 'local') dot.title = 'Servidor local';
      else if (mode === 'render') dot.title = 'Servidor en la nube';
      else if (mode === 'northflank') dot.title = 'Servidor Northflank';
      else dot.title = 'Sin conexión con el servidor';
    }
  }

  Sonora.API = {
    /**
     * Set connection mode
     */
    setMode: function (mode) {
      // El modelo nuevo no tiene "sin conexión": si no hay servidor,
      // la app vive en Modo Dispositivo con la música local.
      _mode = (!mode || mode === 'off') ? 'device' : mode;
      Sonora.Store.set('serverMode', _mode);
      saveSettingPersistent('serverMode', _mode);
      saveSettingPersistent('server_mode', _mode);
      updateStatusDotUI(_mode);
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
      _localUrl = (url || '').trim();
      Sonora.Store.set('serverLocalUrl', _localUrl);
      saveSettingPersistent('serverLocalUrl', _localUrl);
      saveSettingPersistent('server_local_url', _localUrl);
    },

    /**
     * Set Render server URL
     */
    setRenderUrl: function (url) {
      _renderUrl = (url || '').trim();
      Sonora.Store.set('serverRenderUrl', _renderUrl);
      saveSettingPersistent('serverRenderUrl', _renderUrl);
      saveSettingPersistent('server_render_url', _renderUrl);
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
     * Set Northflank server URL
     */
    setNorthflankUrl: function (url) {
      _northflankUrl = (url || '').trim();
      Sonora.Store.set('serverNorthflankUrl', _northflankUrl);
      saveSettingPersistent('serverNorthflankUrl', _northflankUrl);
      saveSettingPersistent('server_northflank_url', _northflankUrl);
    },

    /**
     * Get Northflank server URL
     */
    getNorthflankUrl: function () { return _northflankUrl; },

    /**
     * Set Northflank API token
     */
    setNorthflankToken: function (token) {
      _northflankToken = (token || '').trim();
      Sonora.Store.set('serverNorthflankToken', _northflankToken);
      saveSettingPersistent('serverNorthflankToken', _northflankToken);
      saveSettingPersistent('server_northflank_token', _northflankToken);
    },

    /**
     * Get Northflank API token
     */
    getNorthflankToken: function () { return _northflankToken; },

    /**
     * Get currently active server URL
     */
    getActiveUrl: function () {
      return getBaseUrl();
    },

    /**
     * URL de la nube de Sonora (Render).
     * Se usa como respaldo para búsquedas, carátulas, videos y letras cuando
     * el usuario está en Modo Dispositivo (APK/Mac) y no hay servidor local.
     */
    getRenderBase: function () {
      return String(_renderUrl || '').trim().replace(/\/+$/, '');
    },

    /**
     * Servidor de medios con respaldo real.
     * getActiveUrl() devuelve '' en Modo Dispositivo; si usáramos eso, las
     * URLs quedaban relativas ("/api/...") y fallaban en file:// (Android) y
     * tauri:// (macOS). Aquí siempre preferimos un servidor absoluto.
     */
    getMediaBase: function () {
      var base = getBaseUrl();
      if (base) return String(base).trim().replace(/\/+$/, '');
      var render = Sonora.API.getRenderBase();
      if (render) return render;
      try {
        if (window.location && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
          return String(window.location.origin).replace(/\/+$/, '');
        }
      } catch (e) {}
      return '';
    },

    /**
     * Construye una URL absoluta de streaming externo.
     * Añade la calidad de audio configurada (96/160/320 kbps).
     */
    externalStreamUrl: function (targetUrl, quality) {
      var base = Sonora.API.getMediaBase();
      if (!base || !targetUrl) return '';
      var q = quality;
      if (!q) {
        try { q = JSON.parse(localStorage.getItem('sonora_audio_quality')); } catch (e) {}
      }
      var bitrate = q === 'low' ? '96k' : (q === 'high' ? '320k' : '160k');
      return base + '/api/stream/external?url=' + encodeURIComponent(targetUrl) +
        '&quality=' + encodeURIComponent(bitrate);
    },

    /**
     * URL del servidor compartido para playlists colaborativas.
     * Siempre devuelve algo (usa la nube de Sonora en Modo Dispositivo).
     */
    getCollabBase: function () {
      return getCollabBase();
    },

    /**
     * Get related music recommendations for continuous autoplay
     */
    getRecommendations: function (artist, title, genre, excludeTitles) {
      // En Modo Dispositivo no hay servidor activo: usamos la nube de Sonora
      // para que Inicio/Discover sigan teniendo recomendaciones reales.
      var base = this.getMediaBase();
      if (!base) return Promise.resolve([]);
      var url = base + '/api/recommendations'
        + '?artist=' + encodeURIComponent(artist || '')
        + '&title=' + encodeURIComponent(title || '')
        + '&genre=' + encodeURIComponent(genre || '')
        + '&exclude=' + encodeURIComponent((excludeTitles || []).join('|'));
      return fetchWithTimeout(url, {}, 12000)
        .then(function (res) {
          if (!res.ok) return [];
          return res.json();
        })
        .then(function (list) {
          if (!Array.isArray(list)) return [];
          return list.map(function (x) {
            if (!x) return null;
            var url2 = x.url || x.sourceUrl || '';
            return {
              id: x.id || ('yt_' + (x.videoId || '')),
              videoId: x.videoId || '',
              title: x.title || 'Pista',
              artist: x.artist || '',
              album: x.platform === 'soundcloud' ? 'SoundCloud' : 'YouTube Music',
              duration: x.duration || 0,
              artworkUrl: x.artworkUrl || x.thumbnail || x.image || '',
              sourceUrl: url2,
              streamUrl: url2 ? Sonora.API.externalStreamUrl(url2) : (x.streamUrl || ''),
              platform: x.platform || 'youtube',
              isRecommendation: 1
            };
          }).filter(function (t) { return t && t.title; });
        })
        .catch(function () { return []; });
    },

    /**
     * Collaborative Playlists API
     */
    getCollaborativePlaylist: function (code) {
      var base = getCollabBase();
      if (!base) return Promise.reject(new Error('No server configured'));
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code), {}, 8000)
        .then(function (res) {
          if (!res.ok) throw new Error('Playlist no encontrada');
          return res.json();
        });
    },

    addTrackToCollaborative: function (code, track, playlistName) {
      var base = getCollabBase();
      if (!base) return Promise.reject(new Error('No server configured'));
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code) + '/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, track, { playlistName: playlistName }))
      }, 8000).then(function (res) {
        if (!res.ok) throw new Error('Error al sincronizar');
        return res.json();
      });
    },

    saveCollaborativePlaylist: function (code, data) {
      var base = getCollabBase();
      if (!base) return Promise.reject(new Error('No server configured'));
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      }, 10000).then(function (res) {
        if (!res.ok) throw new Error('Error al guardar la playlist colaborativa');
        return res.json();
      });
    },

    deleteCollaborativePlaylist: function (code) {
      var base = getCollabBase();
      if (!base) return Promise.reject(new Error('No server configured'));
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code), {
        method: 'DELETE'
      }, 8000).then(function (res) {
        // 404 = ya no existe en el servidor: el resultado deseado se cumplió.
        if (res.status === 404) return { deleted: true, alreadyGone: true };
        if (!res.ok) throw new Error('Error al eliminar (HTTP ' + res.status + ')');
        return res.json();
      });
    },

    removeTrackFromCollaborative: function (code, trackId) {
      var base = getCollabBase();
      if (!base) return Promise.reject(new Error('No server configured'));
      return fetchWithTimeout(base + '/api/playlists/collaborative/' + encodeURIComponent(code) + '/tracks/' + encodeURIComponent(trackId), {
        method: 'DELETE'
      }, 8000).then(function (res) {
        if (res.status === 404) return { removed: true, alreadyGone: true };
        if (!res.ok) throw new Error('Error al quitar la canción (HTTP ' + res.status + ')');
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
      return fetchWithTimeout(url, {}, 60000)
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.blob();
        });
    },

    /**
     * Test connection to a specific server mode
     * Returns { ok: boolean, latency: number, server: string, data?: object, error?: string }
     */
    testConnection: function (mode, timeout) {
      // Modo Dispositivo: no hay red que probar; siempre está disponible.
      if (mode === 'device') {
        return Promise.resolve({ ok: true, latency: 0, server: 'device', local: true });
      }
      var url = mode === 'local' ? _localUrl : (mode === 'northflank' ? _northflankUrl : _renderUrl);
      var start = Date.now();
      var defaultTimeout = mode === 'local' ? 5000 : (mode === 'northflank' ? 9000 : 25000);
      var t = timeout || defaultTimeout;

      if (!url || typeof url !== 'string' || !url.trim()) {
        return Promise.resolve({ ok: false, latency: 0, server: mode, error: 'URL no configurada' });
      }
      url = url.trim().replace(/\/+$/, '');

      var opts = {};
      if (mode === 'northflank' && _northflankToken) {
        opts.headers = { 'Authorization': 'Bearer ' + _northflankToken };
      }

      return fetchWithTimeout(url + '/api/health', opts, t)
        .then(function (resp) {
          var latency = Date.now() - start;
          if (resp.ok) {
            return resp.json().then(function (data) {
              return { ok: true, latency: latency, server: mode, data: data };
            }).catch(function () {
              return { ok: true, latency: latency, server: mode, data: { status: 'ok' } };
            });
          }
          return { ok: false, latency: latency, server: mode, error: 'HTTP ' + resp.status };
        })
        .catch(function (err) {
          return { ok: false, latency: Date.now() - start, server: mode, error: err.message };
        });
    },

    /**
     * Auto-detect available server
     * Tries local first (with retry), then northflank (if configured), then render (if responding)
     */
    autoDetect: function () {
      return Sonora.API.testConnection('local', 4500).then(function (localResult) {
        if (localResult.ok) {
          Sonora.API.setMode('local');
          return { mode: 'local', result: localResult };
        }
        // Segundo intento a local por si la red Wi-Fi tuvo un hipo puntual
        return Sonora.API.testConnection('local', 3000).then(function (localRetry) {
          if (localRetry.ok) {
            Sonora.API.setMode('local');
            return { mode: 'local', result: localRetry };
          }

          // Solo probar Northflank si tiene URL configurada
          var checkNorthflank = (_northflankUrl && _northflankUrl.trim())
            ? Sonora.API.testConnection('northflank', 8000)
            : Promise.resolve({ ok: false });

          return checkNorthflank.then(function (nfResult) {
            if (nfResult.ok) {
              Sonora.API.setMode('northflank');
              return { mode: 'northflank', result: nfResult };
            }

            // Render puede estar dormido, probar con timeout generoso
            return Sonora.API.testConnection('render', 20000).then(function (r1) {
              if (r1.ok) {
                Sonora.API.setMode('render');
                return { mode: 'render', result: r1 };
              }
              // Si no responde ningún servidor, seguimos en Modo Dispositivo:
              // la app conserva música local, playlists, favoritos e historial.
              Sonora.API.setMode('device');
              return { mode: 'device', result: null };
            });
          });
        });
      }).catch(function () {
        Sonora.API.setMode('device');
        return { mode: 'device', result: null };
      });
    },

    /**
     * Sync local data with server
     */
    syncWithServer: function () {
      // En Modo Dispositivo (o sin servidor) no hay nada que sincronizar.
      if (_mode === 'device' || _mode === 'off') return Promise.resolve();

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
        Sonora.DB.settings.get('serverRenderUrl'),
        Sonora.DB.settings.get('serverNorthflankUrl'),
        Sonora.DB.settings.get('serverNorthflankToken')
      ]).then(function (values) {
        var savedMode = values[0];
        if (savedMode) _mode = savedMode;

        // El origen propio tiene prioridad si es un host local / IP privada
        var selfOrigin = null;
        try {
          if (typeof window !== 'undefined' && window.location &&
              (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
              isLocalHostname(window.location.hostname)) {
            selfOrigin = window.location.origin;
          }
        } catch (e) {}

        if (values[1]) _localUrl = values[1];
        if (selfOrigin) _localUrl = selfOrigin;
        if (values[2]) _renderUrl = values[2];
        if (values[3] !== null && values[3] !== undefined) _northflankUrl = values[3];
        if (values[4] !== null && values[4] !== undefined) _northflankToken = values[4];

        Sonora.Store.set('serverMode', _mode);
        Sonora.Store.set('serverLocalUrl', _localUrl);
        Sonora.Store.set('serverRenderUrl', _renderUrl);
        Sonora.Store.set('serverNorthflankUrl', _northflankUrl);
        Sonora.Store.set('serverNorthflankToken', _northflankToken);
        Sonora.Store.set('activeServerUrl', getBaseUrl());
        updateStatusDotUI(_mode);

        // Modo Dispositivo explícito: no se toca la red ni se cambia solo.
        if (_mode === 'device') {
          console.log('[API] Device mode: no server probing');
          return { mode: 'device', result: null };
        }

        // Si el usuario tenía un modo activo guardado ('local', 'northflank', 'render'),
        // probamos ese primero para respetar su configuración manual
        if (savedMode && savedMode !== 'off') {
          return Sonora.API.testConnection(savedMode, savedMode === 'render' ? 20000 : 6000).then(function (testRes) {
            if (testRes.ok) {
              console.log('[API] Kept user saved mode:', savedMode);
              _mode = savedMode;
              Sonora.Store.set('serverMode', _mode);
              Sonora.Store.set('activeServerUrl', getBaseUrl());
              updateStatusDotUI(_mode);
              return { mode: _mode, result: testRes };
            }
            // Si el servidor guardado no responde, ejecutamos auto-detección
            console.log('[API] Saved server mode unreachable, auto-detecting...');
            return Sonora.API.autoDetect();
          });
        }

        // Sin modo guardado: arrancamos en Modo Dispositivo. El usuario puede
        // elegir Local/Render/Northflank desde Ajustes cuando quiera.
        return { mode: _mode, result: null };
      }).then(function () {
        Sonora.Store.set('serverMode', _mode);
        Sonora.Store.set('activeServerUrl', getBaseUrl());
        updateStatusDotUI(_mode);
      }).catch(function (err) {
        console.warn('[API] Init error:', err);
        Sonora.API.setMode('device');
      });
    }
  };
})();
