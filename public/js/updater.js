/**
 * Sonora Music — Updater Module
 * Handles auto-update checking, version comparison, and update notifications
 * across Android (APK), macOS (DMG/App), and Web (PWA/ServiceWorker).
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var CURRENT_VERSION = '7.19.0';
  // Las releases reales (APK/DMG) se publican en este repositorio.
  var GITHUB_REPO = 'raykozabala/sonora-music';
  var RELEASE_BASE = 'https://github.com/' + GITHUB_REPO + '/releases';
  var CHECK_INTERVAL_MS = 15 * 60 * 1000;   // comprobación periódica
  var FOCUS_MIN_GAP_MS = 5 * 60 * 1000;     // al volver a la app
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

  function normalizeVersion(v) {
    return String(v || '').replace(/^[^\d]*/, '').split('-')[0];
  }

  function versionFromAsset(nameOrUrl) {
    var text = '';
    try { text = decodeURIComponent(String(nameOrUrl || '')); } catch (e) { text = String(nameOrUrl || ''); }
    var m = text.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : '';
  }

  function releaseAssetUrls(version) {
    var base = RELEASE_BASE + '/download/v' + version + '/';
    return {
      apk: base + 'SonoraMusic_v' + version + '.apk',
      dmg: base + 'Sonora.Music_' + version + '_aarch64.dmg'
    };
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

  function mediaBase() {
    try {
      if (Sonora.API && typeof Sonora.API.getMediaBase === 'function') {
        return String(Sonora.API.getMediaBase() || '').replace(/\/+$/, '');
      }
    } catch (e) {}
    return '';
  }

  /**
   * Abre una descarga. En Android usa el DownloadManager nativo (la app ya
   * tiene puente JS); así el APK se guarda y se puede instalar desde la
   * notificación sin depender de window.open, que el WebView puede bloquear.
   */
  function openDownload(url, version, kind) {
    if (!url) return false;
    var platform = detectPlatform();

    if (platform === 'android' && window.SonoraNative &&
        typeof window.SonoraNative.downloadFile === 'function') {
      var filename = kind === 'dmg'
        ? ('Sonora Music ' + version + '_aarch64.dmg')
        : ('SonoraMusic_v' + version + '.apk');
      var mime = kind === 'dmg'
        ? 'application/x-apple-diskimage'
        : 'application/vnd.android.package-archive';
      try {
        var started = window.SonoraNative.downloadFile(url, filename, mime);
        if (started) {
          if (Sonora.Store) {
            Sonora.Store.emit('toast', {
              message: 'Descargando Sonora v' + version + '. Cuando termine, toca la notificación para instalarla.',
              type: 'info'
            });
          }
          return true;
        }
      } catch (e) {
        console.warn('[Updater] Native download failed:', e.message);
      }
    }

    try {
      var a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { a.remove(); } catch (e) {} }, 1000);
      return true;
    } catch (e) {
      try { window.open(url, '_blank'); return true; } catch (e2) {}
    }
    return false;
  }

  function showUpdateBanner(info) {
    var existing = document.getElementById('sonora-update-banner');
    if (existing) existing.remove();

    var platform = detectPlatform();
    var version = info.version;
    var kind = '';
    var actionUrl = info.releaseUrl || info.htmlUrl || RELEASE_BASE;
    var actionText = 'Ver release';

    if (platform === 'mac' && info.dmgUrl) {
      actionUrl = info.dmgUrl;
      actionText = 'Descargar v' + version + ' (.dmg)';
      kind = 'dmg';
    } else if (platform === 'android' && info.apkUrl) {
      actionUrl = info.apkUrl;
      actionText = 'Descargar v' + version + ' (.apk)';
      kind = 'apk';
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
          <div class="update-banner__title">¡Nueva versión Sonora <strong>v${escapeHtml(version)}</strong> disponible!</div>
          <div class="update-banner__sub">Estás en v${escapeHtml(CURRENT_VERSION)} · ${escapeHtml(info.releaseName || 'Mejoras y nuevas funciones')}</div>
        </div>
        <div class="update-banner__actions">
          <button type="button" class="btn-update-action" id="btn-update-banner-action">${escapeHtml(actionText)}</button>
          <button type="button" class="btn-update-dismiss" id="btn-update-banner-dismiss" aria-label="Cerrar">✕</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

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
        openDownload(actionUrl, version, kind);
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

  function normalizeAssets(payload, version) {
    var assets = payload && payload.assets ? payload.assets : {};
    var apkUrl = assets.apk || '';
    var dmgUrl = assets.dmg || '';

    // Regla de oro: un enlace solo es válido si su nombre corresponde a la
    // versión anunciada. Así nunca se descarga una versión anterior.
    if (apkUrl && versionFromAsset(apkUrl) !== version) apkUrl = '';
    if (dmgUrl && versionFromAsset(dmgUrl) !== version) dmgUrl = '';

    if (!apkUrl || !dmgUrl) {
      var built = releaseAssetUrls(version);
      if (!apkUrl) apkUrl = built.apk;
      if (!dmgUrl) dmgUrl = built.dmg;
    }

    return { apkUrl: apkUrl, dmgUrl: dmgUrl };
  }

  async function fetchJson(url, timeoutMs) {
    var controller = null;
    var timer = null;
    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timer = setTimeout(function () { controller.abort(); }, timeoutMs || 8000);
      }
      var resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
      if (!resp.ok) return { ok: false, status: resp.status };
      return { ok: true, data: await resp.json() };
    } catch (e) {
      return { ok: false, error: e };
    } finally {
      if (timer) clearTimeout(timer);
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
        htmlUrl: RELEASE_BASE,
        releaseUrl: RELEASE_BASE,
        downloadUrl: RELEASE_BASE,
        apkUrl: '',
        dmgUrl: '',
        checked: false
      };

      var checkedAny = false;
      var remoteVersion = '';
      var remotePayload = null;

      // 1. Manifiesto del servidor de Sonora: fuente principal. Devuelve la
      //    versión y los enlaces de ESA misma versión, sin límite de GitHub.
      var base = mediaBase();
      if (base) {
        var manifest = await fetchJson(base + '/api/app/latest', 8000);
        if (manifest.ok && manifest.data && manifest.data.version) {
          checkedAny = true;
          remotePayload = manifest.data;
          remoteVersion = normalizeVersion(manifest.data.version);
        }
      }

      // 2. GitHub como respaldo si el servidor no responde.
      if (!remoteVersion) {
        var gh = await fetchJson('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', 8000);
        if (gh.ok && gh.data) {
          checkedAny = true;
          var tag = normalizeVersion(gh.data.tag_name || gh.data.name || '');
          if (tag) {
            var ghAssets = {};
            if (Array.isArray(gh.data.assets)) {
              gh.data.assets.forEach(function (asset) {
                if (versionFromAsset(asset.name) !== tag) return;
                if (/\.apk$/i.test(asset.name)) ghAssets.apk = asset.browser_download_url;
                if (/\.dmg$/i.test(asset.name)) ghAssets.dmg = asset.browser_download_url;
              });
            }
            remotePayload = {
              version: tag,
              releaseName: gh.data.name || ('Versión ' + tag),
              releaseUrl: gh.data.html_url || (RELEASE_BASE + '/tag/v' + tag),
              notes: gh.data.body || '',
              assets: ghAssets
            };
            remoteVersion = tag;
          }
        }
      }

      // 3. /api/health: detecta un servidor más nuevo que la última release.
      if (base) {
        var health = await fetchJson(base + '/api/health', 6000);
        if (health.ok && health.data && health.data.version) {
          checkedAny = true;
          var hv = normalizeVersion(health.data.version);
          if (hv && (!remoteVersion || isNewerVersion(hv, remoteVersion))) {
            remoteVersion = hv;
            remotePayload = {
              version: hv,
              releaseName: 'Nueva versión publicada en el servidor de Sonora',
              releaseUrl: RELEASE_BASE + '/tag/v' + hv,
              notes: '',
              assets: {}
            };
          }
        }
      }

      if (remoteVersion) {
        info.version = remoteVersion;
        info.releaseName = (remotePayload && remotePayload.releaseName) || ('Versión ' + remoteVersion);
        info.releaseNotes = (remotePayload && remotePayload.notes) || '';
        info.releaseUrl = (remotePayload && remotePayload.releaseUrl) || (RELEASE_BASE + '/tag/v' + remoteVersion);
        info.htmlUrl = info.releaseUrl;
        info.downloadUrl = info.releaseUrl;

        var assets = normalizeAssets(remotePayload, remoteVersion);
        info.apkUrl = assets.apkUrl;
        info.dmgUrl = assets.dmgUrl;
        info.hasUpdate = isNewerVersion(remoteVersion, CURRENT_VERSION);
        info.checked = true;
      }

      // 4. Comprobación de Service Worker para la Web.
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

      function autoCheck() {
        Sonora.Updater.check(false);
      }

      // Comprobar pronto tras abrir la app...
      setTimeout(autoCheck, 3000);

      // ...cada 15 minutos...
      setInterval(autoCheck, CHECK_INTERVAL_MS);

      // ...y al volver a la app, recuperar red o enfocar la ventana.
      function checkOnReturn() {
        if (Date.now() - _lastCheckTime < FOCUS_MIN_GAP_MS) return;
        autoCheck();
      }
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') checkOnReturn();
      });
      window.addEventListener('online', checkOnReturn);
      window.addEventListener('focus', checkOnReturn);
    }
  };

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Sonora.Updater.init);
  } else {
    Sonora.Updater.init();
  }
})();
