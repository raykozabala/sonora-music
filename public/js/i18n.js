/**
 * Sonora Music — i18n (Español / Inglés)
 *
 * Traduce la interfaz de la app (no las canciones ni los resultados de
 * búsqueda, que siempre se muestran tal cual vienen de la fuente).
 *
 * Uso:
 *   Sonora.i18n.t('nav.home')                 → 'Inicio' | 'Home'
 *   <span data-i18n="nav.home">Inicio</span>  → se traduce al aplicar el idioma
 *   <input data-i18n-placeholder="search.ph">  → placeholder traducido
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var STRINGS = {
    es: {
      'nav.home': 'Inicio',
      'nav.search': 'Buscar',
      'nav.library': 'Biblioteca',
      'nav.playlists': 'Listas',
      'nav.discover': 'Descubrir',

      'settings.title': 'Ajustes',
      'settings.section.servers': 'Servidores y conexión',
      'settings.section.appearance': 'Apariencia',
      'settings.section.playback': 'Reproducción',
      'settings.section.downloads': 'Descargas y Almacenamiento',
      'settings.section.language': 'Idioma',
      'settings.section.notifications': 'Notificaciones',
      'settings.section.about': 'Acerca de',

      'settings.theme': 'Tema de colores',
      'settings.theme.sub': 'Selecciona el color de acento principal',
      'settings.screen': 'Modo de pantalla',
      'settings.screen.sub': 'Claro, oscuro o según el sistema',
      'settings.mode.light': 'Claro',
      'settings.mode.dark': 'Oscuro',
      'settings.mode.system': 'Sistema',
      'settings.font': 'Tamaño de fuente',
      'settings.crossfade': 'Crossfade (Fundido entre canciones)',
      'settings.speed': 'Velocidad de reproducción',
      'settings.quality': 'Calidad de audio',
      'settings.quality.sub': 'Streaming y compresión sonora',
      'settings.sleep': 'Temporizador de sueño',
      'settings.sleep.sub': 'Pausar la reproducción automáticamente',
      'settings.storage': 'Espacio utilizado',
      'settings.clearDownloads': 'Borrar todas las descargas',
      'settings.language': 'Idioma de la interfaz',
      'settings.language.sub': 'Selecciona el idioma de Sonora Music',

      'common.off': 'Off',
      'common.cancel': 'Cancelar',
      'common.save': 'Guardar',
      'common.delete': 'Eliminar',
      'common.share': 'Compartir',
      'common.copy': 'Copiar',
      'common.retry': 'Reintentar'
    },
    en: {
      'nav.home': 'Home',
      'nav.search': 'Search',
      'nav.library': 'Library',
      'nav.playlists': 'Playlists',
      'nav.discover': 'Discover',

      'settings.title': 'Settings',
      'settings.section.servers': 'Servers & connection',
      'settings.section.appearance': 'Appearance',
      'settings.section.playback': 'Playback',
      'settings.section.downloads': 'Downloads & Storage',
      'settings.section.language': 'Language',
      'settings.section.notifications': 'Notifications',
      'settings.section.about': 'About',

      'settings.theme': 'Color theme',
      'settings.theme.sub': 'Pick the main accent color',
      'settings.screen': 'Screen mode',
      'settings.screen.sub': 'Light, dark or follow the system',
      'settings.mode.light': 'Light',
      'settings.mode.dark': 'Dark',
      'settings.mode.system': 'System',
      'settings.font': 'Font size',
      'settings.crossfade': 'Crossfade (fade between songs)',
      'settings.speed': 'Playback speed',
      'settings.quality': 'Audio quality',
      'settings.quality.sub': 'Streaming and audio compression',
      'settings.sleep': 'Sleep timer',
      'settings.sleep.sub': 'Pause playback automatically',
      'settings.storage': 'Storage used',
      'settings.clearDownloads': 'Delete all downloads',
      'settings.language': 'Interface language',
      'settings.language.sub': 'Choose the Sonora Music language',

      'common.off': 'Off',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.delete': 'Delete',
      'common.share': 'Share',
      'common.copy': 'Copy',
      'common.retry': 'Retry'
    }
  };

  var _lang = 'es';

  function t(key, fallback) {
    var table = STRINGS[_lang] || STRINGS.es;
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    var esTable = STRINGS.es;
    if (Object.prototype.hasOwnProperty.call(esTable, key)) return esTable[key];
    return fallback !== undefined ? fallback : key;
  }

  /** Aplica las traducciones a los elementos marcados con data-i18n */
  function apply(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key, el.textContent);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key, el.getAttribute('placeholder') || ''));
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key, el.getAttribute('aria-label') || ''));
    });
    try { document.documentElement.lang = _lang; } catch (e) {}
  }

  function getLang() { return _lang; }

  function setLang(lang) {
    _lang = (lang === 'en') ? 'en' : 'es';
    apply();
    if (Sonora.Store && typeof Sonora.Store.emit === 'function') {
      Sonora.Store.emit('languageChanged', _lang);
    }
    return _lang;
  }

  Sonora.i18n = {
    t: t,
    getLang: getLang,
    setLang: setLang,
    apply: apply,
    strings: STRINGS
  };

  /** Traducción global: window.__t('nav.home') */
  window.__t = t;
})();
