/**
 * Sonora Music — Theme Manager
 * 8 color palettes + dark/light mode + font sizes + custom backgrounds
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var _currentTheme = 'coral';
  var _currentDarkMode = 'dark';
  var _currentFontSize = 'medium';
  var _customBg = null;

  var THEMES = [
    { id: 'system', name: 'Sistema', icon: '⚙️', color: '#607D8B' },
    { id: 'blue', name: 'Celeste', icon: '💙', color: '#4FC3F7' },
    { id: 'coral', name: 'Coral', icon: '🔥', color: '#FF4757' },
    { id: 'purple', name: 'Morado', icon: '💜', color: '#9C27B0' },
    { id: 'green', name: 'Verde', icon: '💚', color: '#4CAF50' },
    { id: 'gray', name: 'Gris', icon: '🩶', color: '#607D8B' },
    { id: 'orange', name: 'Naranja', icon: '🧡', color: '#FF9800' },
    { id: 'pink', name: 'Rosa', icon: '💗', color: '#E91E63' }
  ];

  function applyThemeToDOM() {
    var body = document.body;
    // Remove all theme classes
    THEMES.forEach(function (t) { body.classList.remove('theme-' + t.id); });
    body.classList.add('theme-' + _currentTheme);

    // Dark/light mode
    body.classList.remove('dark', 'light');
    if (_currentDarkMode === 'system') {
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.classList.add(prefersDark ? 'dark' : 'light');
    } else {
      body.classList.add(_currentDarkMode);
    }

    // Font size
    body.classList.remove('font-small', 'font-medium', 'font-large');
    body.classList.add('font-' + _currentFontSize);

    // Custom background
    var app = document.getElementById('app');
    if (app) {
      if (_customBg) {
        app.style.backgroundImage = 'url(' + _customBg + ')';
        app.classList.add('has-custom-bg');
      } else {
        app.style.backgroundImage = '';
        app.classList.remove('has-custom-bg');
      }
    }

    // Update meta theme-color
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var themeObj = THEMES.find(function (t) { return t.id === _currentTheme; });
      meta.setAttribute('content', themeObj ? themeObj.color : '#FF4757');
    }
  }

  Sonora.Themes = {
    /**
     * Set active theme
     */
    setTheme: function (themeId) {
      _currentTheme = themeId || 'coral';
      applyThemeToDOM();
      Sonora.Store.set('theme', _currentTheme);
      Sonora.DB.settings.set('theme', _currentTheme);
    },

    /**
     * Get current theme ID
     */
    getTheme: function () { return _currentTheme; },

    /**
     * Get all available themes
     */
    getThemes: function () { return THEMES.slice(); },

    /**
     * Set dark mode
     */
    setDarkMode: function (mode) {
      _currentDarkMode = mode || 'dark'; // 'dark' | 'light' | 'system'
      applyThemeToDOM();
      Sonora.Store.set('darkMode', _currentDarkMode);
      Sonora.DB.settings.set('darkMode', _currentDarkMode);
    },

    /**
     * Get dark mode
     */
    getDarkMode: function () { return _currentDarkMode; },

    /**
     * Set font size
     */
    setFontSize: function (size) {
      _currentFontSize = size || 'medium'; // 'small' | 'medium' | 'large'
      applyThemeToDOM();
      Sonora.Store.set('fontSize', _currentFontSize);
      Sonora.DB.settings.set('fontSize', _currentFontSize);
    },

    /**
     * Get font size
     */
    getFontSize: function () { return _currentFontSize; },

    /**
     * Set custom background image (data URL or URL)
     */
    setCustomBg: function (imageUrl) {
      _customBg = imageUrl || null;
      applyThemeToDOM();
      Sonora.Store.set('customBg', _customBg);
      // Don't save large data URLs to settings DB
      if (_customBg && _customBg.length < 50000) {
        Sonora.DB.settings.set('customBg', _customBg);
      }
    },

    /**
     * Get custom background
     */
    getCustomBg: function () { return _customBg; },

    /**
     * Remove custom background
     */
    removeCustomBg: function () {
      _customBg = null;
      applyThemeToDOM();
      Sonora.Store.set('customBg', null);
      Sonora.DB.settings.set('customBg', '');
    },

    /**
     * Extract dominant color from an image URL
     * Uses a small canvas to sample the image
     */
    extractDominantColor: function (imageUrl) {
      return new Promise(function (resolve) {
        if (!imageUrl) { resolve('#FF4757'); return; }
        try {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            try {
              var canvas = document.createElement('canvas');
              canvas.width = 1;
              canvas.height = 1;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, 1, 1);
              var data = ctx.getImageData(0, 0, 1, 1).data;
              var hex = '#' + ((1 << 24) + (data[0] << 16) + (data[1] << 8) + data[2]).toString(16).slice(1);
              resolve(hex);
            } catch (e) { resolve('#FF4757'); }
          };
          img.onerror = function () { resolve('#FF4757'); };
          img.src = imageUrl;
        } catch (e) { resolve('#FF4757'); }
      });
    },

    /**
     * Apply dynamic color to mini-player based on artwork
     */
    applyArtworkColor: function (imageUrl) {
      Sonora.Themes.extractDominantColor(imageUrl).then(function (color) {
        var miniPlayer = document.getElementById('mini-player');
        if (miniPlayer) {
          miniPlayer.style.setProperty('--artwork-color', color);
        }
        var fullPlayer = document.getElementById('full-player');
        if (fullPlayer) {
          fullPlayer.style.setProperty('--artwork-color', color);
        }
      });
    },

    /**
     * Initialize themes from saved settings
     */
    init: function () {
      return Promise.all([
        Sonora.DB.settings.get('theme'),
        Sonora.DB.settings.get('darkMode'),
        Sonora.DB.settings.get('fontSize'),
        Sonora.DB.settings.get('customBg')
      ]).then(function (values) {
        _currentTheme = values[0] || 'coral';
        _currentDarkMode = values[1] || 'dark';
        _currentFontSize = values[2] || 'medium';
        _customBg = values[3] || null;
        applyThemeToDOM();
        console.log('[Themes] Initialized - Theme:', _currentTheme, 'Mode:', _currentDarkMode);
      }).catch(function (err) {
        console.warn('[Themes] Init error:', err);
        applyThemeToDOM();
      });

      // Listen for system theme changes
      try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
          if (_currentDarkMode === 'system') applyThemeToDOM();
        });
      } catch (e) { /* old browsers */ }
    }
  };
})();
