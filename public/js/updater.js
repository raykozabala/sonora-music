/**
 * Sonora Music — Updater Module
 * Handles auto-update checking, version comparison, and update notifications
 * across Android (APK), macOS (DMG/App), and Web (PWA/ServiceWorker).
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var CURRENT_VERSION = '7.17.3';
  var GITHUB_REPO = 'raykozabala/sonora-music-server';
  var _lastCheckTime = 0;
  var _updateInfo = null;

  function parseSemver(v) {
    if (!v) return [0, 0, 0];
    var clean = String(v).replace(/^[^\d]*/, '').split('-')[0];
    var parts = clean.split('.').map(function (n) { return parseInt(n, 10) || 0; });
    while (parts.length < 3) parts.push(0);
    return parts;
  }

  function isNewerVersion(remote, local) {
    var r = parseSemver(remote);
    var l = parseSemver(local);
    for (var i = 0; i < 3; i++) {
      if (r[i] > l[i]) return true;
      if (r[i] < l[i]) return false;
    }
    return false;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updatesEnabled() {
    try {
      var raw = localStorage.getItem('sonora_notify_updates');
      if (raw !== null) return JSON.parse(raw) !== false;
    } catch (e) {}
    return true;
  }

  function detectPlatform() {
    if (typeof window !== 'undefined') {
      if (window.__TAURI__ || window.__TAURI_INTERNALS__) return 'mac';
      var ua = navigator.userAgent || '';
      if (/Android/i.test(ua)) return 'android';
      if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
      if (/Windows/i.test(ua)) return 'windows';
      if (/Linux/i.test(ua)) return 'linux';
    }
    return 'web';
  }

  function showUpdateBanner(info) {
    var existing = document.getElementById('sonora-update-banner');
    if (existing) existing.remove();

    var platform = detectPlatform();
    var actionText = 'Descargar';
    var actionUrl = info.downloadUrl || info.htmlUrl;

    if (platform === 'mac' && info.dmgUrl) {
      actionUrl = info.dmgUrl;
      actionText = 'Descargar .dmg';
    } else if (platform === 'android' && info.apkUrl) {
      actionUrl = info.apkUrl;
      actionText = 'Descargar .apk';
    } else if (platform === 'web') {
      actionText = 'Actualizar web';
    }

    var banner = document.createElement('div');
    banner.id = 'sonora-update-banner';
    banner.className = 'sonora-update-banner';
    banner.innerHTML = `
      <div class="update-banner__content">
        <div class="update-banner__icon">🚀</div>
        <div class="update-banner__info">
          <div class="update-banner__title">¡Nueva versión Sonora <strong>v${escapeHtml(info.version)}</strong> disponible!</div>
          <div class="update-banner__sub">Estás en v${escapeHtml(CURRENT_VERSION)} · ${escapeHtml(info.releaseName || 'Mejoras y nuevas funciones')}</div>
        </div>
        <div class="update-banner__actions">
          <button type="button" class="btn-update-action" id="btn-update-banner-action">${actionText}</button>
          <button type="button" class="btn-update-dismiss" id="btn-update-banner-dismiss" aria-label="Cerrar">✕</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // Animación de entrada
    requestAnimationFrame(function () {
      banner.classList.add('visible');
    });

    var actionBtn = document.getElementById('btn-update-banner-action');
    if (actionBtn) {
      actionBtn.onclick = function () {
        if (platform === 'web' && navigator.serviceWorker) {
          navigator.serviceWorker.getRegistration().then(function (reg) {
            if (reg) reg.update();
            window.location.reload();
          }).catch(function () {
            window.location.reload();
          });
          return;
        }
        if (actionUrl) window.open(actionUrl, '_blank');
      };
    }

    var dismissBtn = document.getElementById('btn-update-banner-dismiss');
    if (dismissBtn) {
      dismissBtn.onclick = function () {
        banner.classList.remove('visible');
        setTimeout(function () { banner.remove(); }, 400);
      };
    }
  }

  Sonora.Updater = {
    getCurrentVersion: function () {
      return CURRENT_VERSION;
    },

    getLastCheckTime: function () {
      return _lastCheckTime;
    },

    getUpdateInfo: function () {
      return _updateInfo;
    },

    check: async function (isManual) {
      // Aviso automático desactivado por el usuario. Una comprobación manual
      // siempre se ejecuta (el usuario la pidió explícitamente).
      if (!isManual && !updatesEnabled()) {
        return { hasUpdate: false, skipped: true, version: CURRENT_VERSION, currentVersion: CURRENT_VERSION };
      }

      _lastCheckTime = Date.now();
      try {
        localStorage.setItem('sonora_last_update_check', String(_lastCheckTime));
      } catch (e) {}

      var info = {
        hasUpdate: false,
        version: CURRENT_VERSION,
        currentVersion: CURRENT_VERSION,
        releaseName: '',
        releaseNotes: '',
        htmlUrl: 'https://github.com/' + GITHUB_REPO + '/releases',
        downloadUrl: 'https://github.com/' + GITHUB_REPO + '/releases',
        apkUrl: '',
        dmgUrl: '',
        checked: false
      };

      var checkedAny = false;
      var noReleases = false;

      try {
        var resp = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
          cache: 'no-store'
        });

        if (resp.ok) {
          checkedAny = true;
          var data = await resp.json();
          var tag = (data.tag_name || data.name || '').replace(/^[^\d]*/, '');
          if (tag) {
            info.version = tag;
            info.releaseName = data.name || ('Versión ' + tag);
            info.releaseNotes = data.body || '';
            info.htmlUrl = data.html_url || info.htmlUrl;

            // Buscar assets (.apk o .dmg)
            if (Array.isArray(data.assets)) {
              data.assets.forEach(function (asset) {
                if (/\.apk$/i.test(asset.name)) info.apkUrl = asset.browser_download_url;
                if (/\.dmg$/i.test(asset.name)) info.dmgUrl = asset.browser_download_url;
              });
            }
          }
        } else if (resp.status === 404) {
          // El repositorio no tiene releases publicados. No es un fallo de
          // red, pero tampoco permite afirmar que la app esté al día.
          noReleases = true;
        }
      } catch (err) {
        console.warn('[Updater] GitHub releases check failed:', err.message);
      }

      // 2. Servidor de Sonora: /api/health publica la versión desplegada.
      // Esto sí detecta versiones nuevas cuando no hay releases en GitHub.
      if (!info.hasUpdate) {
        try {
          var mediaBase = (Sonora.API && typeof Sonora.API.getMediaBase === 'function')
            ? Sonora.API.getMediaBase() : '';
          if (mediaBase) {
            var healthResp = await fetch(mediaBase.replace(/\/+$/, '') + '/api/health', { cache: 'no-store' });
            if (healthResp.ok) {
              checkedAny = true;
              var health = await healthResp.json();
              var serverVersion = (health && health.version) || '';
              if (serverVersion && isNewerVersion(serverVersion, CURRENT_VERSION)) {
                info.hasUpdate = true;
                info.version = serverVersion;
                info.releaseName = 'Nueva versión publicada en el servidor de Sonora';
                info.htmlUrl = mediaBase;
                info.downloadUrl = mediaBase;
              }
            }
          }
        } catch (e) {
          console.warn('[Updater] Server version check failed:', e.message);
        }
      }

      // 3. Comprobación de Service Worker para la Web
      if (!info.hasUpdate && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          var reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            reg.update().catch(function () {});
            if (reg.waiting) {
              info.hasUpdate = true;
              info.releaseName = 'Actualización web lista';
            }
          }
        } catch (e) {}
      }

      _updateInfo = info;

      if (info.hasUpdate) {
        if (isManual || updatesEnabled()) showUpdateBanner(info);
        try {
          if (Sonora.Notifications && typeof Sonora.Notifications.push === 'function') {
            Sonora.Notifications.push('Sonora Music v' + info.version, {
              body: 'Hay una nueva versión disponible.',
              category: 'updates',
              tag: 'sonora-update'
            });
          }
        } catch (e) {}
        if (Sonora.Store) Sonora.Store.emit('updateAvailable', info);
        return info;
      }

      if (isManual && Sonora.Store) {
        var msg;
        var type;
        if (checkedAny) {
          msg = 'Sonora Music está al día (v' + CURRENT_VERSION + ')';
          type = 'success';
        } else if (noReleases) {
          msg = 'No hay versiones publicadas todavía; no se pudo verificar una más reciente.';
          type = 'warning';
        } else {
          msg = 'No se pudo comprobar si hay actualizaciones. Revisa tu conexión.';
          type = 'error';
        }
        Sonora.Store.emit('toast', { message: msg, type: type });
      }
      return info;
    },

    init: function () {
      try {
        var savedTime = localStorage.getItem('sonora_last_update_check');
        if (savedTime) _lastCheckTime = parseInt(savedTime, 10) || 0;
      } catch (e) {}

      // Auto-comprobar después de 6 segundos de iniciar la app
      setTimeout(function () {
        Sonora.Updater.check(false);
      }, 6000);

      // Comprobar periódicamente cada 6 horas
      setInterval(function () {
        Sonora.Updater.check(false);
      }, 6 * 60 * 60 * 1000);
    }
  };

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Sonora.Updater.init);
  } else {
    Sonora.Updater.init();
  }
})();
