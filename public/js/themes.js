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
  var _artColor = null;

  // ── Utilidades de color para el fondo dinámico del reproductor ──
  function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      var h = clamp255(v).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  /** Sube viveza y saturación para que el color no salga apagado. */
  function boost(rgb, amount) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var max = Math.max(r, g, b), avg = (r + g + b) / 3;
    var f = amount || 1.35;
    return [
      clamp255(avg + (r - avg) * f),
      clamp255(avg + (g - avg) * f),
      clamp255(avg + (b - avg) * f)
    ];
  }

  /** Segundo color del degradado: gira ligeramente el tono. */
  function shiftHue(rgb, mix, angle) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    var d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    h = (h + (angle || 28)) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var rr = 0, gg = 0, bb = 0;
    if (h < 60) { rr = c; gg = x; }
    else if (h < 120) { rr = x; gg = c; }
    else if (h < 180) { gg = c; bb = x; }
    else if (h < 240) { gg = x; bb = c; }
    else if (h < 300) { rr = x; bb = c; }
    else { rr = c; bb = x; }
    var out = [(rr + m) * 255, (gg + m) * 255, (bb + m) * 255];
    if (mix) out = out.map(function (v, i) { return clamp255(v * (1 - mix) + rgb[i] * mix); });
    return out;
  }

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

  function hexToRgb(hex) {
    var h = String(hex || '#FF4757').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [
      parseInt(h.substr(0, 2), 16) || 0,
      parseInt(h.substr(2, 2), 16) || 0,
      parseInt(h.substr(4, 2), 16) || 0
    ];
  }

  function mixWith(rgb, target, amount) {
    return rgb.map(function (v, i) { return clamp255(v * (1 - amount) + target[i] * amount); });
  }

  function rgbStr(rgb) { return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')'; }

  /**
   * Tinta TODA la aplicación con el color del tema: el fondo, las tarjetas y
   * la barra superior dejan de ser grises y pasan a combinar con el acento.
   * Con el tema "Sistema" (o con fondo personalizado) se usa el aspecto neutro.
   */
  function applyTintedBackground() {
    var body = document.body;

    // Tema Sistema o fondo propio → colores neutros originales
    if (_currentTheme === 'system' || _customBg) {
      ['--color-background', '--color-surface', '--color-surface-elevated', '--color-surface-glass', '--color-surface-glass-border']
        .forEach(function (p) { body.style.removeProperty(p); });
      return;
    }

    var themeObj = THEMES.find(function (t) { return t.id === _currentTheme; }) || THEMES[2];
    var primary = hexToRgb(themeObj.color);
    var light = body.classList.contains('light');

    // Fondo: apenas un 8-10 % del color del tema (claro = casi blanco / oscuro = casi negro)
    var bg = light ? mixWith(primary, [255, 255, 255], 0.92) : mixWith(primary, [11, 11, 13], 0.92);
    var surface = light ? mixWith(primary, [255, 255, 255], 0.96) : mixWith(primary, [22, 22, 28], 0.90);
    var elevated = light ? mixWith(primary, [255, 255, 255], 0.93) : mixWith(primary, [30, 30, 38], 0.88);

    body.style.setProperty('--color-background', rgbStr(bg));
    body.style.setProperty('--color-surface', rgbStr(surface));
    body.style.setProperty('--color-surface-elevated', rgbStr(elevated));
    // La barra superior se funde con el fondo (antes era un recuadro gris)
    body.style.setProperty('--color-surface-glass', 'rgba(' + bg[0] + ',' + bg[1] + ',' + bg[2] + ',' + (light ? '0.86' : '0.80') + ')');
    body.style.setProperty('--color-surface-glass-border', light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)');
  }

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

    // Tinte del fondo con el color del tema
    applyTintedBackground();

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
        var fallback = { primary: '#FF4757', secondary: '#FF6B35', rgb: '255, 71, 87' };
        if (!imageUrl) { resolve(fallback); return; }
        try {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            try {
              var N = 32;
              var canvas = document.createElement('canvas');
              canvas.width = N;
              canvas.height = N;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, N, N);
              var px = ctx.getImageData(0, 0, N, N).data;

              // Se descartan los píxeles apagados (casi negros, casi blancos y
              // grises): así el fondo coge el COLOR de la portada y no un gris.
              var sumR = 0, sumG = 0, sumB = 0, sumW = 0;
              var best = null, bestScore = -1;
              for (var i = 0; i < px.length; i += 4) {
                var r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
                if (a < 140) continue;
                var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                var sat = mx === 0 ? 0 : (mx - mn) / mx;
                var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                var score = sat * (1 - Math.abs(lum - 0.55) * 1.5);
                if (lum < 0.10 || lum > 0.95) score *= 0.2;
                sumR += r * score; sumG += g * score; sumB += b * score; sumW += score;
                if (score > bestScore) { bestScore = score; best = [r, g, b]; }
              }

              var out = (sumW > 0)
                ? [sumR / sumW, sumG / sumW, sumB / sumW]
                : (best || [255, 71, 87]);

              var vivid = boost(out, 1.4);
              var second = shiftHue(vivid, 0.15, 30);
              resolve({
                primary: rgbToHex(vivid),
                secondary: rgbToHex(second),
                rgb: clamp255(vivid[0]) + ', ' + clamp255(vivid[1]) + ', ' + clamp255(vivid[2])
              });
            } catch (e) {
              resolve(fallback);
            }
          };
          img.onerror = function () { resolve(fallback); };
          img.src = imageUrl;
        } catch (e) { resolve(fallback); }
      });
    },

    /**
     * Apply dynamic color to mini-player, full player and lyrics panel
     */
    applyArtworkColor: function (imageUrl) {
      Sonora.Themes.extractDominantColor(imageUrl).then(function (c) {
        if (!c) return;
        _artColor = c;
        var targets = ['mini-player', 'full-player', 'lyrics-panel', 'queue-panel', 'sleep-timer-modal'];
        targets.forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          el.style.setProperty('--artwork-color', c.primary);
          el.style.setProperty('--artwork-color-2', c.secondary);
          el.style.setProperty('--artwork-rgb', c.rgb);
        });
        var root = document.documentElement;
        root.style.setProperty('--artwork-color', c.primary);
        root.style.setProperty('--artwork-color-2', c.secondary);
        root.style.setProperty('--artwork-rgb', c.rgb);
      });
    },

    /** Último color extraído (lo usan el mini-reproductor y los degradados). */
    getArtworkColor: function () { return _artColor; },

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
