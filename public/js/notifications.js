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
    return _container;
  }

  function createToast(message, type, duration) {
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + (type || 'info');
    var icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    toast.innerHTML =
      '<span class="toast__icon">' + (icons[type] || icons.info) + '</span>' +
      '<span class="toast__message">' + message + '</span>' +
      '<button class="toast__close btn--icon" aria-label="Cerrar">✕</button>';

    toast.querySelector('.toast__close').addEventListener('click', function () {
      removeToast(toast);
    });

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
     * Show a browser push notification
     */
    push: function (title, options) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        var notif = new Notification(title, Object.assign({
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-72.png',
          vibrate: [200, 100, 200]
        }, options || {}));
        notif.onclick = function () { window.focus(); notif.close(); };
      } catch (e) { console.warn('[Notifications] Push error:', e); }
    },

    /**
     * Initialize — listen for toast events from Store
     */
    init: function () {
      _container = document.getElementById('toast-container');
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
