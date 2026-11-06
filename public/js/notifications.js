/**
 * Sonora Music — Notifications Manager
 * Toast notifications and push notification helpers
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};
  var _container = null;
  var _toastQueue = [];
  var _maxToasts = 3;

  function getContainer() {
    if (!_container) _container = document.getElementById('toast-container');
    if (_container && !_container.getAttribute('aria-live')) {
      // Los toasts se anuncian a lectores de pantalla sin robar el foco.
      _container.setAttribute('role', 'status');
      _container.setAttribute('aria-live', 'polite');
      _container.setAttribute('aria-atomic', 'false');
    }
    return _container;
  }

  function createToast(message, type, duration) {
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + (type || 'info');
    var icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

    var iconEl = document.createElement('span');
    iconEl.className = 'toast__icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icons[type] || icons.info;

    // textContent (nunca innerHTML): los títulos de YouTube/SoundCloud son
    // externos y antes podían inyectar HTML/scripts en la app.
    var msgEl = document.createElement('span');
    msgEl.className = 'toast__message';
    msgEl.textContent = message == null ? '' : String(message);

    var closeEl = document.createElement('button');
    closeEl.type = 'button';
    closeEl.className = 'toast__close btn--icon';
    closeEl.setAttribute('aria-label', 'Cerrar notificación');
    closeEl.textContent = '✕';
    closeEl.addEventListener('click', function () {
      removeToast(toast);
    });

    toast.appendChild(iconEl);
    toast.appendChild(msgEl);
    toast.appendChild(closeEl);

    return toast;
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('toast--exit');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  function showToast(message, type, duration) {
    try {
      var container = getContainer();
      if (!container) return;

      var toast = createToast(message, type || 'info', duration);
      container.appendChild(toast);

      // Animate in
      requestAnimationFrame(function () { toast.classList.add('toast--visible'); });

      // Auto-remove
      var timeout = duration || 3500;
      setTimeout(function () { removeToast(toast); }, timeout);

      // Limit number of toasts
      var toasts = container.querySelectorAll('.toast');
      if (toasts.length > _maxToasts) {
        removeToast(toasts[0]);
      }
    } catch (e) {
      console.warn('[Notifications] Toast error:', e);
    }
  }

  Sonora.Notifications = {
    /**
     * Show a toast notification
     */
    toast: function (message, type, duration) {
      showToast(message, type, duration);
    },

    success: function (message) { showToast(message, 'success'); },
    error: function (message) { showToast(message, 'error'); },
    warning: function (message) { showToast(message, 'warning'); },
    info: function (message) { showToast(message, 'info'); },

    /**
     * Request browser notification permission
     */
    requestPermission: function () {
      if (!('Notification' in window)) return Promise.resolve('denied');
      if (Notification.permission === 'granted') return Promise.resolve('granted');
      return Notification.requestPermission();
    },

    /**
     * Comprueba la preferencia guardada para una categoría de aviso.
     * Las claves se escriben también en localStorage para poder leerlas
     * de forma síncrona desde este módulo.
     */
    isEnabled: function (category) {
      if (!category) return true;
      var key = category === 'updates' ? 'notify_updates'
        : (category === 'new_tracks' ? 'notify_new_tracks' : null);
      if (!key) return true;
      try {
        var raw = localStorage.getItem('sonora_' + key);
        if (raw !== null) return JSON.parse(raw) !== false;
      } catch (e) {}
      return true;
    },

    /**
     * Show a browser push notification
     * options.category: 'updates' | 'new_tracks' (se respeta Ajustes)
     */
    push: function (title, options) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      options = options || {};
      if (!Sonora.Notifications.isEnabled(options.category)) return;
      try {
        var pushOpts = Object.assign({}, options);
        delete pushOpts.category;
        var notif = new Notification(title, Object.assign({
          icon: new URL('icons/icon-192.png', window.location.href).href,
          badge: new URL('icons/icon-72.png', window.location.href).href,
          vibrate: [200, 100, 200]
        }, pushOpts));
        notif.onclick = function () { window.focus(); notif.close(); };
      } catch (e) { console.warn('[Notifications] Push error:', e); }
    },

    /**
     * Initialize — listen for toast events from Store
     */
    init: function () {
      _container = null;
      getContainer();
      Sonora.Store.on('toast', function (data) {
        if (!data) return;
        if (typeof data === 'string') {
          showToast(data, 'info');
        } else {
          showToast(data.message || '', data.type || 'info', data.duration);
        }
      });
      console.log('[Notifications] Initialized');
    }
  };
})();
