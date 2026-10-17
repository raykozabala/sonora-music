/**
 * Sonora Music — Settings Page Module
 * Complete configuration for servers, appearance, playback, downloads, language, privacy, and app info.
 */
(function () {
  'use strict';

  const Sonora = window.Sonora = window.Sonora || {};
  Sonora.Pages = Sonora.Pages || {};

  // Utility helpers as specified
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }
  function formatTime(sec) {
    if (isNaN(sec) || sec === null || sec === undefined) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
  function generateArtwork(id, title) {
    let numericId = 0;
    if (typeof id === 'number') {
      numericId = id;
    } else if (typeof id === 'string') {
      for (let i = 0; i < id.length; i++) {
        numericId = (numericId + id.charCodeAt(i) * 31) % 1000;
      }
    }
    const hue = (numericId * 47) % 360;
    return `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="hsl(${hue},70%,50%)"/>
            <stop offset="100%" stop-color="hsl(${(hue + 60) % 360},70%,40%)"/>
          </linearGradient>
        </defs>
        <rect fill="url(#g)" width="200" height="200" rx="12"/>
        <text x="100" y="100" text-anchor="middle" dy=".35em" fill="white" font-size="14" font-family="sans-serif">${title ? title.substring(0, 15) : '♪'}</text>
      </svg>`
    )}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Active listener tracker
  let _listeners = [];
  function addTrackedListener(el, event, handler, options) {
    if (!el) return;
    try {
      el.addEventListener(event, handler, options);
      _listeners.push({ el, event, handler, options });
    } catch (e) {
      console.warn('[Settings] Error attaching listener', e);
    }
  }

  function showToast(message, type) {
    try {
      let toast = $('#sonora-settings-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sonora-settings-toast';
        toast.className = 'sonora-toast';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.className = 'sonora-toast visible ' + (type || 'info');
      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(() => {
        toast.className = 'sonora-toast';
      }, 2600);
    } catch (e) {
      console.log('[Toast]', message);
    }
  }

  // Persistent settings helper
  async function getSetting(key, fallback) {
    try {
      if (Sonora.DB && Sonora.DB.settings && typeof Sonora.DB.settings.get === 'function') {
        const val = await Sonora.DB.settings.get(key);
        if (val !== undefined && val !== null) return val;
      }
    } catch (e) {}
    try {
      if (Sonora.Store && typeof Sonora.Store.get === 'function') {
        const val = Sonora.Store.get(key);
        if (val !== undefined && val !== null) return val;
      }
    } catch (e) {}
    try {
      const ls = localStorage.getItem('sonora_' + key);
      if (ls !== null) return JSON.parse(ls);
    } catch (e) {}
    return fallback;
  }

  async function setSetting(key, val) {
    try {
      if (Sonora.DB && Sonora.DB.settings && typeof Sonora.DB.settings.set === 'function') {
        await Sonora.DB.settings.set(key, val);
      }
    } catch (e) {}
    try {
      if (Sonora.Store && typeof Sonora.Store.set === 'function') {
        Sonora.Store.set(key, val);
      }
    } catch (e) {}
    try {
      localStorage.setItem('sonora_' + key, JSON.stringify(val));
    } catch (e) {}
  }

  // Theme definition palette
  const THEMES_LIST = [
    { id: 'system', name: 'Sistema', color: 'linear-gradient(135deg, #FF4757, #4FC3F7)' },
    { id: 'blue',   name: 'Celeste', color: '#4FC3F7' },
    { id: 'coral',  name: 'Coral',   color: '#FF4757' },
    { id: 'purple', name: 'Morado',  color: '#9C27B0' },
    { id: 'green',  name: 'Verde',   color: '#4CAF50' },
    { id: 'gray',   name: 'Gris',    color: '#607D8B' },
    { id: 'orange', name: 'Naranja', color: '#FF9800' },
    { id: 'pink',   name: 'Rosa',    color: '#E91E63' }
  ];

  const Settings = {
    /**
     * Render full settings page HTML
     */
    render() {
      return `
        <div class="page page-settings" id="sonora-settings-root">
          <style id="sonora-settings-styles">
            .page-settings {
              padding: 16px 16px 90px 16px;
              color: var(--color-text-primary, #ffffff);
              min-height: 100vh;
              box-sizing: border-box;
              max-width: 860px;
              margin: 0 auto;
            }
            .settings-main-title {
              font-size: 26px;
              font-weight: 800;
              margin: 0 0 20px 0;
              background: linear-gradient(135deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
            }
            /* Settings Sections */
            .settings-section {
              background: var(--color-surface, #1a1a2e);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: var(--radius-xl, 20px);
              padding: 20px 18px;
              margin-bottom: 22px;
              box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
            }
            .settings-section--featured {
              border-color: rgba(var(--color-primary-rgb, 255, 71, 87), 0.35);
              background: linear-gradient(180deg, rgba(var(--color-primary-rgb, 255, 71, 87), 0.08) 0%, var(--color-surface, #1a1a2e) 40%);
            }
            .settings-section__header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 16px;
              gap: 10px;
            }
            .settings-section__title {
              font-size: 18px;
              font-weight: 800;
              margin: 0;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .server-mode-indicator {
              font-size: 12px;
              font-weight: 700;
              padding: 4px 12px;
              border-radius: 20px;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              background: rgba(255, 255, 255, 0.08);
              border: 1px solid rgba(255, 255, 255, 0.1);
            }
            .server-mode-indicator.mode-local {
              background: rgba(76, 175, 80, 0.15);
              color: #4CAF50;
              border-color: rgba(76, 175, 80, 0.3);
            }
            .server-mode-indicator.mode-render {
              background: rgba(79, 195, 247, 0.15);
              color: #4FC3F7;
              border-color: rgba(79, 195, 247, 0.3);
            }
            .server-mode-indicator.mode-off {
              background: rgba(255, 82, 82, 0.15);
              color: #FF5252;
              border-color: rgba(255, 82, 82, 0.3);
            }
            /* Server Cards */
            .server-cards-grid {
              display: grid;
              grid-template-columns: 1fr;
              gap: 16px;
            }
            @media (min-width: 680px) {
              .server-cards-grid {
                grid-template-columns: 1fr 1fr;
              }
            }
            .server-card {
              background: var(--color-surface-elevated, #22253d);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.1));
              border-radius: var(--radius-lg, 16px);
              padding: 16px;
              display: flex;
              flex-direction: column;
              gap: 12px;
              transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }
            .server-card.active-server {
              border-color: var(--color-primary, #FF4757);
              box-shadow: 0 4px 18px rgba(var(--color-primary-rgb, 255, 71, 87), 0.2);
            }
            .server-card__top {
              display: flex;
              align-items: center;
              justify-content: space-between;
            }
            .server-card__identity {
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .server-icon {
              width: 36px;
              height: 36px;
              border-radius: 10px;
              background: rgba(255, 255, 255, 0.08);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 18px;
            }
            .server-card__title-box {
              display: flex;
              flex-direction: column;
            }
            .server-card__name {
              font-size: 14px;
              font-weight: 700;
              display: flex;
              align-items: center;
              gap: 6px;
            }
            .status-dot {
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: #757575;
              display: inline-block;
            }
            .status-dot.connected {
              background: #4CAF50;
              box-shadow: 0 0 8px #4CAF50;
            }
            .status-dot.testing {
              background: #FFC107;
              box-shadow: 0 0 8px #FFC107;
            }
            .status-dot.disconnected {
              background: #FF5252;
            }
            .server-card__subtitle {
              font-size: 11px;
              color: var(--color-text-secondary, #A0A5BA);
            }
            .server-url-input {
              width: 100%;
              background: var(--color-surface, #1a1a2e);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.1));
              color: var(--color-text-primary, #ffffff);
              padding: 10px 12px;
              border-radius: var(--radius-sm, 10px);
              font-size: 13px;
              font-family: monospace;
              box-sizing: border-box;
              outline: none;
            }
            .server-url-input:focus {
              border-color: var(--color-primary, #FF4757);
            }
            .server-card__bottom {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding-top: 4px;
            }
            .server-latency-tag {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
              font-family: monospace;
            }
            /* Switches */
            .switch {
              position: relative;
              display: inline-block;
              width: 44px;
              height: 24px;
              flex-shrink: 0;
            }
            .switch input {
              opacity: 0;
              width: 0;
              height: 0;
            }
            .slider {
              position: absolute;
              cursor: pointer;
              top: 0; left: 0; right: 0; bottom: 0;
              background-color: var(--color-surface-elevated, #3a4160);
              transition: .25s ease;
              border-radius: 24px;
            }
            .slider:before {
              position: absolute;
              content: "";
              height: 18px;
              width: 18px;
              left: 3px;
              bottom: 3px;
              background-color: white;
              transition: .25s ease;
              border-radius: 50%;
            }
            input:checked + .slider {
              background-color: var(--color-primary, #FF4757);
            }
            input:checked + .slider:before {
              transform: translateX(20px);
            }
            /* Action Buttons */
            .btn-pill {
              padding: 8px 14px;
              border-radius: 20px;
              font-size: 12px;
              font-weight: 600;
              border: none;
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              transition: transform 0.15s ease, opacity 0.15s ease;
            }
            .btn-pill:active {
              transform: scale(0.96);
            }
            .btn-pill--primary {
              background: linear-gradient(135deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
              color: #ffffff;
            }
            .btn-pill--secondary {
              background: var(--color-card-bg, rgba(255, 255, 255, 0.08));
              color: var(--color-text-primary, #ffffff);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.1));
            }
            .btn-pill--danger {
              background: rgba(255, 82, 82, 0.15);
              color: #FF5252;
              border: 1px solid rgba(255, 82, 82, 0.3);
            }
            /* Theme circle picker */
            .theme-circles-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 12px;
              margin-top: 10px;
            }
            @media (min-width: 600px) {
              .theme-circles-grid {
                grid-template-columns: repeat(8, 1fr);
              }
            }
            .theme-circle-item {
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 6px;
              cursor: pointer;
            }
            .theme-circle {
              width: 44px;
              height: 44px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #ffffff;
              font-size: 18px;
              box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
              border: 2px solid transparent;
              transition: transform 0.2s ease, border-color 0.2s ease;
            }
            .theme-circle-item.active .theme-circle {
              border-color: #ffffff;
              transform: scale(1.1);
            }
            .theme-circle-name {
              font-size: 11px;
              color: var(--color-text-secondary, #A0A5BA);
              font-weight: 600;
            }
            /* Segmented control */
            .segmented-control {
              display: flex;
              background: var(--color-surface-elevated, #22253d);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: var(--radius-md, 12px);
              padding: 3px;
              gap: 3px;
              width: 100%;
              box-sizing: border-box;
            }
            .segmented-btn {
              flex: 1;
              background: transparent;
              border: none;
              color: var(--color-text-secondary, #A0A5BA);
              padding: 9px 8px;
              font-size: 13px;
              font-weight: 600;
              border-radius: var(--radius-sm, 9px);
              cursor: pointer;
              transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease;
              text-align: center;
              white-space: nowrap;
            }
            .segmented-btn.active {
              background: var(--color-primary, #FF4757);
              color: #ffffff;
              box-shadow: 0 2px 8px rgba(var(--color-primary-rgb, 255, 71, 87), 0.35);
            }
            /* Setting item row */
            .setting-item-row {
              display: flex;
              flex-direction: column;
              gap: 8px;
              padding: 12px 0;
              border-bottom: 1px solid var(--color-divider, rgba(255, 255, 255, 0.06));
            }
            .setting-item-row:last-child {
              border-bottom: none;
              padding-bottom: 0;
            }
            .setting-item-row--inline {
              flex-direction: row;
              align-items: center;
              justify-content: space-between;
            }
            .setting-label-box {
              display: flex;
              flex-direction: column;
            }
            .setting-label-title {
              font-size: 14px;
              font-weight: 600;
            }
            .setting-label-sub {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
            }
            /* Background preview thumbnail */
            .custom-bg-preview {
              width: 90px;
              height: 54px;
              border-radius: 8px;
              object-fit: cover;
              border: 1px solid var(--color-card-border, rgba(255,255,255,0.15));
            }
            /* Downloads progress bar */
            .downloads-bar-wrap {
              width: 100%;
              height: 8px;
              background: var(--color-surface-elevated, #22253d);
              border-radius: 4px;
              overflow: hidden;
              margin: 8px 0 14px 0;
            }
            .downloads-bar-fill {
              height: 100%;
              background: linear-gradient(90deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
              width: 12%;
              border-radius: 4px;
            }
            .downloads-list {
              display: flex;
              flex-direction: column;
              gap: 8px;
              max-height: 220px;
              overflow-y: auto;
              margin-bottom: 14px;
            }
            .download-track-item {
              display: flex;
              align-items: center;
              gap: 10px;
              padding: 8px 10px;
              background: var(--color-surface-elevated, #22253d);
              border-radius: var(--radius-sm, 10px);
            }
            .download-track-img {
              width: 38px;
              height: 38px;
              border-radius: 6px;
              object-fit: cover;
            }
            .download-track-info {
              flex: 1;
              min-width: 0;
            }
            .download-track-name {
              font-size: 13px;
              font-weight: 600;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .download-track-artist {
              font-size: 11px;
              color: var(--color-text-secondary, #A0A5BA);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .btn-delete-download {
              background: none;
              border: none;
              color: var(--color-text-disabled, #7d849b);
              font-size: 16px;
              cursor: pointer;
              padding: 6px;
              border-radius: 50%;
            }
            .btn-delete-download:hover {
              color: #FF5252;
            }
            /* About Section */
            .about-box {
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              gap: 12px;
              padding: 10px 0;
            }
            .about-logo-svg {
              width: 72px;
              height: 72px;
              filter: drop-shadow(0 6px 16px rgba(var(--color-primary-rgb, 255, 71, 87), 0.4));
            }
            .about-title {
              font-size: 20px;
              font-weight: 800;
              margin: 0;
            }
            .about-version-badge {
              font-size: 12px;
              color: var(--color-primary, #FF4757);
              background: rgba(var(--color-primary-rgb, 255, 71, 87), 0.12);
              padding: 3px 10px;
              border-radius: 12px;
              font-weight: 700;
            }
            .about-stats-summary {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
              display: flex;
              gap: 12px;
              flex-wrap: wrap;
              justify-content: center;
            }
            .about-links {
              display: flex;
              gap: 12px;
              margin-top: 6px;
            }
            .about-link {
              font-size: 13px;
              color: var(--color-primary, #FF4757);
              text-decoration: none;
              font-weight: 600;
            }
            /* Toast */
            .sonora-toast {
              position: fixed;
              bottom: 84px;
              left: 50%;
              transform: translateX(-50%) translateY(20px);
              background: rgba(26, 26, 46, 0.95);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.15));
              color: #ffffff;
              padding: 10px 20px;
              border-radius: 30px;
              font-size: 13px;
              font-weight: 600;
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
              z-index: 2000;
              opacity: 0;
              pointer-events: none;
              transition: opacity 0.2s ease, transform 0.2s ease;
            }
            .sonora-toast.visible {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
          </style>

          <h1 class="settings-main-title">Ajustes</h1>

          <!-- SECTION 1: SERVIDOR (PROMINENT AT THE TOP) -->
          <section class="settings-section settings-section--featured">
            <div class="settings-section__header">
              <h2 class="settings-section__title">
                🌐 Conexión al Servidor
              </h2>
              <span class="server-mode-indicator mode-off" id="server-mode-badge">
                <span class="status-dot disconnected" id="overall-status-dot"></span>
                <span id="server-mode-text">Desconectado</span>
              </span>
            </div>

            <div class="server-cards-grid">
              <!-- Servidor Local -->
              <div class="server-card" id="card-server-local">
                <div class="server-card__top">
                  <div class="server-card__identity">
                    <div class="server-icon">💻</div>
                    <div class="server-card__title-box">
                      <span class="server-card__name">
                        Servidor Local
                        <span class="status-dot disconnected" id="local-status-dot"></span>
                      </span>
                      <span class="server-card__subtitle">Mi Computadora</span>
                    </div>
                  </div>
                  <label class="switch" title="Activar/desactivar servidor local">
                    <input type="checkbox" id="toggle-server-local" />
                    <span class="slider"></span>
                  </label>
                </div>

                <input type="url" id="input-server-local-url" class="server-url-input"
                       value="http://192.168.1.132:3000" placeholder="http://192.168.1.x:3000" spellcheck="false" />

                <div class="server-card__bottom">
                  <button class="btn-pill btn-pill--secondary" id="btn-test-local">
                    ⚡ Probar conexión
                  </button>
                  <span class="server-latency-tag" id="latency-local-text">Sin probar</span>
                </div>
              </div>

              <!-- Servidor Render -->
              <div class="server-card" id="card-server-render">
                <div class="server-card__top">
                  <div class="server-card__identity">
                    <div class="server-icon">☁️</div>
                    <div class="server-card__title-box">
                      <span class="server-card__name">
                        Servidor Render
                        <span class="status-dot disconnected" id="render-status-dot"></span>
                      </span>
                      <span class="server-card__subtitle">Online (Nube)</span>
                    </div>
                  </div>
                  <label class="switch" title="Activar/desactivar servidor Render">
                    <input type="checkbox" id="toggle-server-render" />
                    <span class="slider"></span>
                  </label>
                </div>

                <input type="url" id="input-server-render-url" class="server-url-input"
                       value="https://sonora-music-b1ee.onrender.com" placeholder="https://sonora-music-b1ee.onrender.com" spellcheck="false" />

                <div class="server-card__bottom">
                  <button class="btn-pill btn-pill--secondary" id="btn-test-render">
                    ⚡ Probar conexión
                  </button>
                  <span class="server-latency-tag" id="latency-render-text">Sin probar</span>
                </div>
              </div>
            </div>
          </section>

          <!-- SECTION 2: APARIENCIA -->
          <section class="settings-section">
            <h2 class="settings-section__title">🎨 Apariencia</h2>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Tema de colores</span>
                <span class="setting-label-sub">Selecciona el color de acento principal</span>
              </div>
              <div class="theme-circles-grid" id="theme-circles-container">
                <!-- Rendered dynamically -->
              </div>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Modo de pantalla</span>
                <span class="setting-label-sub">Claro, oscuro o según el sistema</span>
              </div>
              <div class="segmented-control" id="control-dark-mode">
                <button class="segmented-btn" data-mode="light">☀️ Claro</button>
                <button class="segmented-btn active" data-mode="dark">🌙 Oscuro</button>
                <button class="segmented-btn" data-mode="system">⚙️ Sistema</button>
              </div>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Tamaño de fuente</span>
                <span class="setting-label-sub">Ajusta la legibilidad del texto</span>
              </div>
              <div class="segmented-control" id="control-font-size">
                <button class="segmented-btn" data-size="small">S (Pequeña)</button>
                <button class="segmented-btn active" data-size="medium">M (Normal)</button>
                <button class="segmented-btn" data-size="large">L (Grande)</button>
              </div>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Fondo personalizado</span>
                <span class="setting-label-sub">Usa tu propia foto como fondo difuminado</span>
              </div>
              <div style="display:flex;align-items:center;gap:12px;margin-top:4px;">
                <img id="bg-preview-thumbnail" class="custom-bg-preview" src="" alt="Fondo" style="display:none;" />
                <label for="custom-bg-input" class="btn-pill btn-pill--secondary" style="cursor:pointer;">
                  🖼️ Seleccionar imagen
                </label>
                <input type="file" id="custom-bg-input" accept="image/*" style="display:none;" />
                <button class="btn-pill btn-pill--danger" id="btn-remove-custom-bg" style="display:none;">
                  Eliminar fondo
                </button>
              </div>
            </div>
          </section>

          <!-- SECTION 3: REPRODUCCIÓN -->
          <section class="settings-section">
            <h2 class="settings-section__title">🎵 Reproducción</h2>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Crossfade (Fundido entre canciones)</span>
                <span class="setting-label-sub" id="crossfade-value-label">0 segundos (Desactivado)</span>
              </div>
              <div class="segmented-control" id="control-crossfade">
                <button class="segmented-btn active" data-crossfade="0">0s</button>
                <button class="segmented-btn" data-crossfade="2">2s</button>
                <button class="segmented-btn" data-crossfade="5">5s</button>
                <button class="segmented-btn" data-crossfade="10">10s</button>
              </div>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Velocidad de reproducción</span>
                <span class="setting-label-sub">Modifica el tempo del audio</span>
              </div>
              <div class="segmented-control" id="control-playback-speed">
                <button class="segmented-btn" data-speed="0.5">0.5x</button>
                <button class="segmented-btn" data-speed="0.75">0.75x</button>
                <button class="segmented-btn active" data-speed="1.0">1x</button>
                <button class="segmented-btn" data-speed="1.25">1.25x</button>
                <button class="segmented-btn" data-speed="1.5">1.5x</button>
                <button class="segmented-btn" data-speed="2.0">2x</button>
              </div>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Calidad de audio</span>
                <span class="setting-label-sub">Streaming y compresión sonora</span>
              </div>
              <div class="segmented-control" id="control-audio-quality">
                <button class="segmented-btn" data-quality="low">Baja (96 kbps)</button>
                <button class="segmented-btn active" data-quality="normal">Normal (160 kbps)</button>
                <button class="segmented-btn" data-quality="high">Alta (320 kbps)</button>
              </div>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Temporizador de sueño</span>
                <span class="setting-label-sub">Pausar la reproducción automáticamente</span>
              </div>
              <div class="segmented-control" id="control-sleep-timer" style="flex-wrap:wrap;">
                <button class="segmented-btn active" data-timer="0">Off</button>
                <button class="segmented-btn" data-timer="15">15 min</button>
                <button class="segmented-btn" data-timer="30">30 min</button>
                <button class="segmented-btn" data-timer="45">45 min</button>
                <button class="segmented-btn" data-timer="60">60 min</button>
                <button class="segmented-btn" data-timer="end_track">Fin pista</button>
              </div>
            </div>
          </section>

          <!-- SECTION 4: DESCARGAS -->
          <section class="settings-section">
            <h2 class="settings-section__title">💾 Descargas y Almacenamiento</h2>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Espacio utilizado</span>
                <span class="setting-label-sub" id="storage-used-label">0 B usados</span>
              </div>
              <div class="downloads-bar-wrap">
                <div class="downloads-bar-fill" id="storage-bar-fill"></div>
              </div>
              <div class="downloads-list" id="downloaded-tracks-list">
                <div style="font-size:12px;color:var(--color-text-secondary);padding:6px 0;">
                  No hay pistas descargadas para uso offline.
                </div>
              </div>
              <div style="display:flex;justify-content:flex-end;">
                <button class="btn-pill btn-pill--danger" id="btn-clear-all-downloads">
                  🗑️ Borrar todas las descargas
                </button>
              </div>
            </div>
          </section>

          <!-- SECTION 5: IDIOMA -->
          <section class="settings-section">
            <h2 class="settings-section__title">🌍 Idioma</h2>
            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title">Idioma de la interfaz</span>
                <span class="setting-label-sub">Selecciona el idioma de Sonora Music</span>
              </div>
              <div class="segmented-control" id="control-language">
                <button class="segmented-btn active" data-lang="es">🇪🇸 Español</button>
                <button class="segmented-btn" data-lang="en">🇺🇸 English</button>
              </div>
            </div>
          </section>

          <!-- SECTION 6: NOTIFICACIONES -->
          <section class="settings-section">
            <h2 class="settings-section__title">🔔 Notificaciones</h2>

            <div class="setting-item-row setting-item-row--inline">
              <div class="setting-label-box">
                <span class="setting-label-title">Nuevas canciones</span>
                <span class="setting-label-sub">Avisos de nuevos lanzamientos de tus artistas</span>
              </div>
              <label class="switch">
                <input type="checkbox" id="notify-new-tracks" checked />
                <span class="slider"></span>
              </label>
            </div>

            <div class="setting-item-row setting-item-row--inline">
              <div class="setting-label-box">
                <span class="setting-label-title">Recomendaciones</span>
                <span class="setting-label-sub">Mixes y listas personalizadas para ti</span>
              </div>
              <label class="switch">
                <input type="checkbox" id="notify-recommendations" checked />
                <span class="slider"></span>
              </label>
            </div>

            <div class="setting-item-row setting-item-row--inline">
              <div class="setting-label-box">
                <span class="setting-label-title">Actualizaciones de la app</span>
                <span class="setting-label-sub">Novedades de versiones y mejoras</span>
              </div>
              <label class="switch">
                <input type="checkbox" id="notify-updates" checked />
                <span class="slider"></span>
              </label>
            </div>
          </section>

          <!-- SECTION 7: PRIVACIDAD -->
          <section class="settings-section">
            <h2 class="settings-section__title">🔒 Privacidad y Datos</h2>

            <div class="setting-item-row setting-item-row--inline">
              <div class="setting-label-box">
                <span class="setting-label-title">Historial de reproducción</span>
                <span class="setting-label-sub">Eliminar registros de canciones escuchadas</span>
              </div>
              <button class="btn-pill btn-pill--secondary" id="btn-clear-history">
                Borrar historial
              </button>
            </div>

            <div class="setting-item-row setting-item-row--inline">
              <div class="setting-label-box">
                <span class="setting-label-title">Historial de búsqueda</span>
                <span class="setting-label-sub">Limpiar sugerencias y búsquedas recientes</span>
              </div>
              <button class="btn-pill btn-pill--secondary" id="btn-clear-search-history">
                Borrar búsquedas
              </button>
            </div>

            <div class="setting-item-row setting-item-row--inline" style="margin-top:8px;">
              <div class="setting-label-box">
                <span class="setting-label-title" style="color:#FF5252;">Restablecer aplicación</span>
                <span class="setting-label-sub">Borrar todos los datos locales y configuraciones</span>
              </div>
              <button class="btn-pill btn-pill--danger" id="btn-reset-all-data">
                ⚠️ Borrar todos los datos
              </button>
            </div>
          </section>

          <!-- SECTION 8: ACERCA DE -->
          <section class="settings-section">
            <div class="about-box">
              <svg class="about-logo-svg" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="48" fill="url(#sonoraLogoGrad)" />
                <path d="M30 65V35L48 50L30 65Z" fill="white" />
                <circle cx="62" cy="40" r="5" fill="white" opacity="0.9" />
                <circle cx="70" cy="50" r="4" fill="white" opacity="0.7" />
                <circle cx="64" cy="60" r="5" fill="white" opacity="0.9" />
                <defs>
                  <linearGradient id="sonoraLogoGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#FF4757" />
                    <stop offset="1" stop-color="#FF6B35" />
                  </linearGradient>
                </defs>
              </svg>

              <h3 class="about-title">Sonora Music</h3>
              <span class="about-version-badge">v7.4 Ultimate (Build 2026)</span>

              <div class="about-stats-summary" id="about-stats-summary">
                <span id="about-tracks-count">🎵 0 pistas</span> •
                <span id="about-playlists-count">📁 0 playlists</span> •
                <span id="about-time-count">⏱️ 0 min</span>
              </div>

              <p style="font-size:12px;color:var(--color-text-secondary);max-width:380px;margin:4px 0 0 0;">
                Tu reproductor de música de alta fidelidad, diseñado con amor para una experiencia sonora pura y sin interrupciones.
              </p>

              <div class="about-links">
                <a href="https://github.com" target="_blank" rel="noopener noreferrer" class="about-link">GitHub</a>
                <span style="color:var(--color-divider);">•</span>
                <a href="#" id="link-about-web" class="about-link">Sitio Web</a>
                <span style="color:var(--color-divider);">•</span>
                <a href="#" id="link-about-feedback" class="about-link">Sugerencias</a>
              </div>
            </div>
          </section>
        </div>
      `;
    },

    /**
     * Initialize all settings components and restore states
     */
    async init() {
      this.destroy();

      try {
        await Promise.all([
          this.initServerSection(),
          this.initAppearanceSection(),
          this.initPlaybackSection(),
          this.initDownloadsSection(),
          this.initLanguageSection(),
          this.initNotificationsSection(),
          this.initPrivacySection(),
          this.initAboutSection()
        ]);
      } catch (err) {
        console.error('[Settings] Init failed:', err);
      }
    },

    /**
     * SECTION 1: Server Logic
     * Handles Local & Render servers, URLs, toggles, test latency, and state sync
     */
    async initServerSection() {
      const toggleLocal = $('#toggle-server-local');
      const toggleRender = $('#toggle-server-render');
      const inputLocal = $('#input-server-local-url');
      const inputRender = $('#input-server-render-url');
      const btnTestLocal = $('#btn-test-local');
      const btnTestRender = $('#btn-test-render');
      const latencyLocal = $('#latency-local-text');
      const latencyRender = $('#latency-render-text');
      const dotLocal = $('#local-status-dot');
      const dotRender = $('#render-status-dot');
      const modeBadge = $('#server-mode-badge');
      const modeText = $('#server-mode-text');
      const overallDot = $('#overall-status-dot');
      const cardLocal = $('#card-server-local');
      const cardRender = $('#card-server-render');

      // Load saved settings
      let localUrl = await getSetting('server_local_url', 'http://192.168.1.132:3000');
      let renderUrl = await getSetting('server_render_url', 'https://sonora-music-b1ee.onrender.com');
      let serverMode = await getSetting('server_mode', 'off'); // 'local' | 'render' | 'off'

      if (inputLocal) inputLocal.value = localUrl;
      if (inputRender) inputRender.value = renderUrl;

      // Update toggles based on mode
      const isLocalOn = serverMode === 'local';
      const isRenderOn = serverMode === 'render';

      if (toggleLocal) toggleLocal.checked = isLocalOn;
      if (toggleRender) toggleRender.checked = isRenderOn;

      // Update UI Mode display
      const updateModeUI = (mode) => {
        if (!modeBadge || !modeText || !overallDot) return;
        modeBadge.className = 'server-mode-indicator mode-' + mode;
        overallDot.className = 'status-dot ' + (mode !== 'off' ? 'connected' : 'disconnected');

        if (cardLocal) cardLocal.classList.toggle('active-server', mode === 'local');
        if (cardRender) cardRender.classList.toggle('active-server', mode === 'render');

        if (mode === 'local') {
          modeText.textContent = 'Servidor Local';
        } else if (mode === 'render') {
          modeText.textContent = 'Servidor Render';
        } else {
          modeText.textContent = 'Desconectado';
        }
      };

      updateModeUI(serverMode);

      // Synchronization function
      const syncServerMode = async (newMode) => {
        serverMode = newMode;
        updateModeUI(newMode);
        await setSetting('server_mode', newMode);

        if (Sonora.API && typeof Sonora.API.setMode === 'function') {
          try { Sonora.API.setMode(newMode); } catch (e) {}
        }
        if (Sonora.Store) {
          Sonora.Store.set('serverMode', newMode);
        }
      };

      // Toggle changes logic:
      // When local is ON, use local.
      // When render is ON and local is OFF, use render.
      // When both OFF, offline mode.
      if (toggleLocal) {
        addTrackedListener(toggleLocal, 'change', async () => {
          if (toggleLocal.checked) {
            await syncServerMode('local');
            showToast('Servidor Local activado');
          } else {
            if (toggleRender && toggleRender.checked) {
              await syncServerMode('render');
              showToast('Cambiado a Servidor Render');
            } else {
              await syncServerMode('off');
              showToast('Modo sin conexión');
            }
          }
        });
      }

      if (toggleRender) {
        addTrackedListener(toggleRender, 'change', async () => {
          if (toggleRender.checked) {
            if (toggleLocal && toggleLocal.checked) {
              // Local is currently active, render is standby
              showToast('Servidor Render en espera (Local prioritario)');
            } else {
              await syncServerMode('render');
              showToast('Servidor Render activado');
            }
          } else {
            if (toggleLocal && toggleLocal.checked) {
              await syncServerMode('local');
            } else {
              await syncServerMode('off');
              showToast('Modo sin conexión');
            }
          }
        });
      }

      // URL input changes
      if (inputLocal) {
        addTrackedListener(inputLocal, 'change', async (e) => {
          const val = e.target.value.trim();
          await setSetting('server_local_url', val);
          if (Sonora.API && typeof Sonora.API.setLocalUrl === 'function') {
            Sonora.API.setLocalUrl(val);
          }
          if (Sonora.Store) Sonora.Store.set('serverLocalUrl', val);
          showToast('URL local guardada');
        });
      }

      if (inputRender) {
        addTrackedListener(inputRender, 'change', async (e) => {
          const val = e.target.value.trim();
          await setSetting('server_render_url', val);
          if (Sonora.API && typeof Sonora.API.setRenderUrl === 'function') {
            Sonora.API.setRenderUrl(val);
          }
          if (Sonora.Store) Sonora.Store.set('serverRenderUrl', val);
          showToast('URL Render guardada');
        });
      }

      // Connection test helpers
      const testServer = async (type, btn, dot, latencyEl, urlInput) => {
        if (!btn || !dot || !latencyEl) return;
        const origText = btn.textContent;
        btn.textContent = '⏳ Probando...';
        btn.disabled = true;
        dot.className = 'status-dot testing';
        latencyEl.textContent = 'Probando...';

        const startTime = Date.now();
        let success = false;
        let latencyMs = 0;
        let errMsg = '';

        try {
          if (Sonora.API && typeof Sonora.API.testConnection === 'function') {
            const res = await Sonora.API.testConnection(type);
            latencyMs = res && res.latency ? res.latency : (Date.now() - startTime);
            success = !!(res && (res.success || res.status === 200 || res.ok));
          } else {
            // Fetch ping test to URL
            const url = urlInput ? urlInput.value.trim() : '';
            if (url) {
              const pingUrl = url.replace(/\/+$/, '') + '/api/ping';
              const ctrl = new AbortController();
              const tid = setTimeout(() => ctrl.abort(), 6000);
              const resp = await fetch(pingUrl, { signal: ctrl.signal });
              clearTimeout(tid);
              latencyMs = Date.now() - startTime;
              success = resp.ok;
            }
          }
        } catch (err) {
          errMsg = err.message || 'Error';
          success = false;
        }

        btn.textContent = origText;
        btn.disabled = false;

        if (success) {
          dot.className = 'status-dot connected';
          latencyEl.textContent = `🟢 ${latencyMs} ms`;
          showToast(`Conexión exitosa (${latencyMs} ms)`);
        } else {
          dot.className = 'status-dot disconnected';
          latencyEl.textContent = `🔴 Inaccesible`;
          showToast(`No se pudo conectar al servidor ${type}`, 'error');
        }
      };

      if (btnTestLocal) {
        addTrackedListener(btnTestLocal, 'click', () => {
          testServer('local', btnTestLocal, dotLocal, latencyLocal, inputLocal);
        });
      }

      if (btnTestRender) {
        addTrackedListener(btnTestRender, 'click', () => {
          testServer('render', btnTestRender, dotRender, latencyRender, inputRender);
        });
      }
    },

    /**
     * SECTION 2: Appearance Logic
     * Themes (8 circles), Dark mode (3-way), Font size (S/M/L), Custom background
     */
    async initAppearanceSection() {
      // 1. Theme circles
      const themeContainer = $('#theme-circles-container');
      const currentTheme = await getSetting('theme', 'coral');

      if (themeContainer) {
        themeContainer.innerHTML = THEMES_LIST.map(t => {
          const isActive = t.id === currentTheme;
          return `
            <div class="theme-circle-item ${isActive ? 'active' : ''}" data-theme-id="${t.id}" title="${t.name}">
              <div class="theme-circle" style="background:${t.color};">
                ${isActive ? '✓' : ''}
              </div>
              <span class="theme-circle-name">${t.name}</span>
            </div>
          `;
        }).join('');

        $$('.theme-circle-item', themeContainer).forEach(item => {
          addTrackedListener(item, 'click', async () => {
            const themeId = item.getAttribute('data-theme-id');
            $$('.theme-circle-item', themeContainer).forEach(el => {
              el.classList.remove('active');
              $('.theme-circle', el).textContent = '';
            });
            item.classList.add('active');
            $('.theme-circle', item).textContent = '✓';

            if (Sonora.Themes && typeof Sonora.Themes.setTheme === 'function') {
              Sonora.Themes.setTheme(themeId);
            }
            await setSetting('theme', themeId);
            showToast(`Tema cambiado a ${item.getAttribute('title')}`);
          });
        });
      }

      // 2. Dark mode (3-way segmented control: light, dark, system)
      const currentMode = await getSetting('dark_mode', 'dark');
      const modeButtons = $$('#control-dark-mode .segmented-btn');
      modeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === currentMode);
        addTrackedListener(btn, 'click', async () => {
          modeButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const selected = btn.getAttribute('data-mode');
          if (Sonora.Themes && typeof Sonora.Themes.setDarkMode === 'function') {
            Sonora.Themes.setDarkMode(selected);
          }
          await setSetting('dark_mode', selected);
          showToast(`Modo cambiado: ${btn.textContent.trim()}`);
        });
      });

      // 3. Font size (small, medium, large)
      const currentFontSize = await getSetting('font_size', 'medium');
      const fontButtons = $$('#control-font-size .segmented-btn');
      fontButtons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-size') === currentFontSize);
        addTrackedListener(btn, 'click', async () => {
          fontButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const size = btn.getAttribute('data-size');
          if (Sonora.Themes && typeof Sonora.Themes.setFontSize === 'function') {
            Sonora.Themes.setFontSize(size);
          }
          await setSetting('font_size', size);
          showToast(`Tamaño de fuente: ${btn.textContent.trim()}`);
        });
      });

      // 4. Custom Background
      const bgInput = $('#custom-bg-input');
      const bgPreview = $('#bg-preview-thumbnail');
      const btnRemoveBg = $('#btn-remove-custom-bg');
      const currentBg = await getSetting('custom_bg', null);

      const updateBgUI = (bgUrl) => {
        if (bgUrl && bgPreview) {
          bgPreview.src = bgUrl;
          bgPreview.style.display = 'block';
          if (btnRemoveBg) btnRemoveBg.style.display = 'inline-flex';
        } else {
          if (bgPreview) bgPreview.style.display = 'none';
          if (btnRemoveBg) btnRemoveBg.style.display = 'none';
        }
      };

      updateBgUI(currentBg);

      if (bgInput) {
        addTrackedListener(bgInput, 'change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = async (event) => {
            const dataUrl = event.target.result;
            updateBgUI(dataUrl);
            if (Sonora.Themes && typeof Sonora.Themes.setCustomBg === 'function') {
              Sonora.Themes.setCustomBg(dataUrl);
            }
            await setSetting('custom_bg', dataUrl);
            showToast('Fondo personalizado aplicado');
          };
          reader.readAsDataURL(file);
        });
      }

      if (btnRemoveBg) {
        addTrackedListener(btnRemoveBg, 'click', async () => {
          updateBgUI(null);
          if (Sonora.Themes && typeof Sonora.Themes.setCustomBg === 'function') {
            Sonora.Themes.setCustomBg(null);
          }
          await setSetting('custom_bg', null);
          showToast('Fondo personalizado eliminado');
        });
      }
    },

    /**
     * SECTION 3: Playback Logic
     * Crossfade, Speed, Quality, Sleep timer
     */
    async initPlaybackSection() {
      // 1. Crossfade
      const savedCrossfade = await getSetting('playback_crossfade', 0);
      const crossfadeLabel = $('#crossfade-value-label');
      const crossfadeBtns = $$('#control-crossfade .segmented-btn');

      const updateCrossfadeLabel = (sec) => {
        if (crossfadeLabel) {
          crossfadeLabel.textContent = Number(sec) === 0 ? '0 segundos (Desactivado)' : `${sec} segundos de fundido`;
        }
      };
      updateCrossfadeLabel(savedCrossfade);

      crossfadeBtns.forEach(btn => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-crossfade')) === Number(savedCrossfade));
        addTrackedListener(btn, 'click', async () => {
          crossfadeBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const sec = Number(btn.getAttribute('data-crossfade'));
          updateCrossfadeLabel(sec);
          if (Sonora.Player && typeof Sonora.Player.setCrossfade === 'function') {
            Sonora.Player.setCrossfade(sec);
          }
          await setSetting('playback_crossfade', sec);
          showToast(`Crossfade: ${sec}s`);
        });
      });

      // 2. Playback Speed
      const savedSpeed = await getSetting('playback_speed', 1.0);
      const speedBtns = $$('#control-playback-speed .segmented-btn');
      speedBtns.forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.getAttribute('data-speed')) === parseFloat(savedSpeed));
        addTrackedListener(btn, 'click', async () => {
          speedBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const spd = parseFloat(btn.getAttribute('data-speed'));
          if (Sonora.Player && typeof Sonora.Player.setSpeed === 'function') {
            Sonora.Player.setSpeed(spd);
          }
          await setSetting('playback_speed', spd);
          showToast(`Velocidad: ${spd}x`);
        });
      });

      // 3. Audio Quality
      const savedQuality = await getSetting('audio_quality', 'normal');
      const qualityBtns = $$('#control-audio-quality .segmented-btn');
      qualityBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-quality') === savedQuality);
        addTrackedListener(btn, 'click', async () => {
          qualityBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const q = btn.getAttribute('data-quality');
          await setSetting('audio_quality', q);
          showToast(`Calidad de audio: ${btn.textContent.trim()}`);
        });
      });

      // 4. Sleep timer presets
      const timerBtns = $$('#control-sleep-timer .segmented-btn');
      timerBtns.forEach(btn => {
        addTrackedListener(btn, 'click', async () => {
          timerBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const val = btn.getAttribute('data-timer');
          if (Sonora.Player && typeof Sonora.Player.setSleepTimer === 'function') {
            Sonora.Player.setSleepTimer(val === 'end_track' ? 'end_track' : Number(val));
          }
          await setSetting('sleep_timer', val);
          showToast(val === '0' ? 'Temporizador desactivado' : `Temporizador programado: ${btn.textContent.trim()}`);
        });
      });
    },

    /**
     * SECTION 4: Downloads Logic
     * Storage display, downloaded tracks list, per-track delete, clear all downloads
     */
    async initDownloadsSection() {
      const storageLabel = $('#storage-used-label');
      const storageBar = $('#storage-bar-fill');
      const listEl = $('#downloaded-tracks-list');
      const btnClearAll = $('#btn-clear-all-downloads');

      const renderDownloadsUI = async () => {
        let bytesUsed = 0;
        let downloadedTracks = [];

        try {
          if (Sonora.Download && typeof Sonora.Download.getStorageUsed === 'function') {
            bytesUsed = (await Sonora.Download.getStorageUsed()) || 0;
          }
          if (Sonora.Download && typeof Sonora.Download.getDownloadedTracks === 'function') {
            downloadedTracks = (await Sonora.Download.getDownloadedTracks()) || [];
          } else if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.getAll === 'function') {
            downloadedTracks = (await Sonora.DB.downloads.getAll()) || [];
          }
        } catch (e) {
          console.warn('[Settings] Error reading downloads', e);
        }

        if (storageLabel) storageLabel.textContent = `${formatBytes(bytesUsed)} usados`;

        // Estimate percent against 2GB hypothetical cache quota
        const pct = Math.min(100, Math.max(3, Math.round((bytesUsed / (2 * 1024 * 1024 * 1024)) * 100)));
        if (storageBar) storageBar.style.width = pct + '%';

        if (listEl) {
          if (downloadedTracks.length === 0) {
            listEl.innerHTML = `
              <div style="font-size:12px;color:var(--color-text-secondary);padding:6px 0;">
                No hay pistas descargadas para uso offline.
              </div>
            `;
          } else {
            listEl.innerHTML = downloadedTracks.map(t => {
              const artwork = t.artworkUrl || generateArtwork(t.id, t.title);
              const sizeStr = t.fileSize ? formatBytes(t.fileSize) : '3.5 MB';
              return `
                <div class="download-track-item">
                  <img src="${artwork}" class="download-track-img" alt="" />
                  <div class="download-track-info">
                    <div class="download-track-name">${escapeHtml(t.title || 'Pista')}</div>
                    <div class="download-track-artist">${escapeHtml(t.artist || 'Artista')} • ${sizeStr}</div>
                  </div>
                  <button class="btn-delete-download" data-track-id="${escapeHtml(t.id)}" title="Eliminar descarga">
                    🗑️
                  </button>
                </div>
              `;
            }).join('');

            // Bind single track delete
            $$('.btn-delete-download', listEl).forEach(btn => {
              addTrackedListener(btn, 'click', async () => {
                const id = btn.getAttribute('data-track-id');
                try {
                  if (Sonora.Download && typeof Sonora.Download.deleteDownload === 'function') {
                    await Sonora.Download.deleteDownload(id);
                  } else if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.delete === 'function') {
                    await Sonora.DB.downloads.delete(id);
                  }
                  showToast('Descarga eliminada');
                  await renderDownloadsUI();
                } catch (err) {
                  console.error('[Settings] Delete download error', err);
                }
              });
            });
          }
        }
      };

      await renderDownloadsUI();

      if (btnClearAll) {
        addTrackedListener(btnClearAll, 'click', async () => {
          const confirmed = window.confirm('¿Deseas eliminar todas las canciones descargadas de tu dispositivo?');
          if (!confirmed) return;

          try {
            if (Sonora.Download && typeof Sonora.Download.getDownloadedTracks === 'function') {
              const all = await Sonora.Download.getDownloadedTracks();
              for (const t of all) {
                if (typeof Sonora.Download.deleteDownload === 'function') {
                  await Sonora.Download.deleteDownload(t.id);
                }
              }
            } else if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.clear === 'function') {
              await Sonora.DB.downloads.clear();
            }
            showToast('Todas las descargas han sido eliminadas');
            await renderDownloadsUI();
          } catch (err) {
            console.error('[Settings] Clear downloads failed', err);
          }
        });
      }
    },

    /**
     * SECTION 5: Language Logic
     */
    async initLanguageSection() {
      const savedLang = await getSetting('language', 'es');
      const langBtns = $$('#control-language .segmented-btn');

      langBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === savedLang);
        addTrackedListener(btn, 'click', async () => {
          langBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const lang = btn.getAttribute('data-lang');
          await setSetting('language', lang);
          if (Sonora.Store) Sonora.Store.set('language', lang);
          showToast(`Idioma establecido: ${btn.textContent.trim()}`);
        });
      });
    },

    /**
     * SECTION 6: Notifications Logic
     */
    async initNotificationsSection() {
      const toggleNew = $('#notify-new-tracks');
      const toggleRecs = $('#notify-recommendations');
      const toggleUpdates = $('#notify-updates');

      const isNewOn = await getSetting('notify_new_tracks', true);
      const isRecsOn = await getSetting('notify_recommendations', true);
      const isUpdatesOn = await getSetting('notify_updates', true);

      if (toggleNew) {
        toggleNew.checked = isNewOn;
        addTrackedListener(toggleNew, 'change', async () => {
          await setSetting('notify_new_tracks', toggleNew.checked);
        });
      }

      if (toggleRecs) {
        toggleRecs.checked = isRecsOn;
        addTrackedListener(toggleRecs, 'change', async () => {
          await setSetting('notify_recommendations', toggleRecs.checked);
        });
      }

      if (toggleUpdates) {
        toggleUpdates.checked = isUpdatesOn;
        addTrackedListener(toggleUpdates, 'change', async () => {
          await setSetting('notify_updates', toggleUpdates.checked);
        });
      }
    },

    /**
     * SECTION 7: Privacy & Reset Logic
     */
    async initPrivacySection() {
      const btnClearHistory = $('#btn-clear-history');
      const btnClearSearch = $('#btn-clear-search-history');
      const btnResetAll = $('#btn-reset-all-data');

      if (btnClearHistory) {
        addTrackedListener(btnClearHistory, 'click', async () => {
          const ok = window.confirm('¿Borrar todo el historial de reproducción?');
          if (!ok) return;
          try {
            if (Sonora.DB && Sonora.DB.history && typeof Sonora.DB.history.clear === 'function') {
              await Sonora.DB.history.clear();
            }
            showToast('Historial de reproducción borrado');
          } catch (e) {
            console.error('[Settings] Error clearing history', e);
          }
        });
      }

      if (btnClearSearch) {
        addTrackedListener(btnClearSearch, 'click', async () => {
          const ok = window.confirm('¿Borrar el historial de búsquedas recientes?');
          if (!ok) return;
          try {
            await setSetting('search_history', []);
            showToast('Historial de búsquedas eliminado');
          } catch (e) {}
        });
      }

      if (btnResetAll) {
        addTrackedListener(btnResetAll, 'click', async () => {
          const step1 = window.confirm('⚠️ ADVERTENCIA: ¿Estás seguro de que deseas restablecer TODOS los datos de Sonora Music?\nSe borrarán tus playlists, historial, descargas y configuraciones.');
          if (!step1) return;

          const step2 = window.confirm('⚠️ Confirmación final: ¿Realmente deseas restablecer la aplicación a su estado de fábrica?');
          if (!step2) return;

          try {
            localStorage.clear();
            if (window.indexedDB && indexedDB.databases) {
              const dbs = await indexedDB.databases();
              for (const db of dbs) {
                if (db.name && db.name.toLowerCase().includes('sonora')) {
                  indexedDB.deleteDatabase(db.name);
                }
              }
            }
            alert('Sonora Music ha sido restablecida. La aplicación se recargará ahora.');
            window.location.reload();
          } catch (err) {
            console.error('[Settings] Reset failed', err);
            alert('Se produjo un error al restablecer algunos datos.');
          }
        });
      }
    },

    /**
     * SECTION 8: About & Summary Stats
     */
    async initAboutSection() {
      let trackCount = 0;
      let playlistCount = 0;
      let totalSeconds = 0;

      try {
        if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.getAll === 'function') {
          const tracks = await Sonora.DB.tracks.getAll();
          trackCount = (tracks || []).length;
        }
        if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.getAll === 'function') {
          const pls = await Sonora.DB.playlists.getAll();
          playlistCount = (pls || []).length;
        }
        if (Sonora.DB && Sonora.DB.history && typeof Sonora.DB.history.getRecent === 'function') {
          const hItems = (await Sonora.DB.history.getRecent(1000)) || [];
          hItems.forEach(i => {
            totalSeconds += ((i.track && i.track.duration) || i.duration || 0);
          });
        }
      } catch (e) {}

      const tracksEl = $('#about-tracks-count');
      const plsEl = $('#about-playlists-count');
      const timeEl = $('#about-time-count');

      if (tracksEl) tracksEl.textContent = `🎵 ${trackCount} pistas`;
      if (plsEl) plsEl.textContent = `📁 ${playlistCount} playlists`;
      if (timeEl) {
        const mins = Math.floor(totalSeconds / 60);
        timeEl.textContent = `⏱️ ${mins} min escuchados`;
      }

      const linkWeb = $('#link-about-web');
      const linkFb = $('#link-about-feedback');

      if (linkWeb) {
        addTrackedListener(linkWeb, 'click', (e) => {
          e.preventDefault();
          showToast('Sonora Music v4.0 Web Client');
        });
      }
      if (linkFb) {
        addTrackedListener(linkFb, 'click', (e) => {
          e.preventDefault();
          showToast('¡Gracias por tus sugerencias! Contacta al equipo.');
        });
      }
    },

    /**
     * Destroy & cleanup
     */
    destroy() {
      _listeners.forEach(({ el, event, handler, options }) => {
        try {
          if (el) el.removeEventListener(event, handler, options);
        } catch (e) {}
      });
      _listeners = [];
    }
  };

  Sonora.Pages.Settings = Settings;
})();
