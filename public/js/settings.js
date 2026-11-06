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

  // Presets del ecualizador (espejo de player.js, por si aún no está listo).
  const EQ_PRESETS_GAINS = {
    flat: [0, 0, 0, 0, 0],
    bass: [9, 6, 1, -1, -2],
    voice: [-3, 2, 4, 4, 1],
    rock: [5, 3, -1, 3, 5],
    electro: [7, 4, 0, 3, 6],
    party: [10, 7, 2, 4, 8],
    lofi: [4, 0, -3, -2, -6]
  };

  function getEqPresetGains(key) {
    try {
      if (Sonora.Player && typeof Sonora.Player.getEQPresets === 'function') {
        const list = Sonora.Player.getEQPresets() || [];
        const found = list.find(p => p.key === key);
        if (found && Array.isArray(found.gains)) return found.gains.slice();
      }
    } catch (e) {}
    return EQ_PRESETS_GAINS[key] ? EQ_PRESETS_GAINS[key].slice() : null;
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
            .server-mode-indicator.mode-northflank {
              background: rgba(108, 92, 231, 0.18);
              color: #a29bfe;
              border-color: rgba(108, 92, 231, 0.4);
            }
            .server-mode-indicator.mode-off {
              background: rgba(255, 82, 82, 0.15);
              color: #FF5252;
              border-color: rgba(255, 82, 82, 0.3);
            }
            .server-mode-indicator.mode-device {
              background: rgba(var(--color-primary-rgb, 255, 71, 87), 0.15);
              color: var(--color-primary, #FF4757);
              border-color: rgba(var(--color-primary-rgb, 255, 71, 87), 0.35);
            }
            /* Server Cards */
            .server-cards-grid {
              display: grid;
              grid-template-columns: 1fr;
              gap: 14px;
            }
            @media (min-width: 680px) {
              .server-cards-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
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
              min-width: 0;
              cursor: pointer;
              transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
            }
            .server-card:focus-visible {
              outline: 2px solid var(--color-primary, #FF4757);
              outline-offset: 2px;
            }
            .server-card.active-server {
              border-color: var(--color-primary, #FF4757);
              box-shadow: 0 4px 18px rgba(var(--color-primary-rgb, 255, 71, 87), 0.2);
            }
            .server-card__top {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              flex-wrap: wrap;
            }
            .server-card__identity {
              display: flex;
              align-items: center;
              gap: 10px;
              min-width: 0;
              flex: 1 1 auto;
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
              flex-shrink: 0;
            }
            body.light .server-icon {
              background: rgba(0, 0, 0, 0.06);
            }
            .server-card__title-box {
              display: flex;
              flex-direction: column;
              min-width: 0;
            }
            .server-card__name {
              font-size: 14px;
              font-weight: 700;
              display: flex;
              align-items: center;
              gap: 6px;
              min-width: 0;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .server-card__hint {
              margin: 0;
              font-size: 11.5px;
              line-height: 1.45;
              color: var(--color-text-secondary, #A0A5BA);
            }
            /* Selección tipo radio: solo una fuente activa */
            .server-radio {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              border: 2px solid var(--color-divider, rgba(255, 255, 255, 0.2));
              flex-shrink: 0;
              position: relative;
              transition: border-color 0.2s ease;
            }
            .server-card.active-server .server-radio {
              border-color: var(--color-primary, #FF4757);
            }
            .server-card.active-server .server-radio::after {
              content: "";
              position: absolute;
              inset: 3px;
              border-radius: 50%;
              background: var(--color-primary, #FF4757);
            }
            .status-dot {
              width: 10px;
              height: 10px;
              border-radius: 50%;
              background: #757575;
              display: inline-block;
              flex-shrink: 0;
              transition: background .2s ease, box-shadow .2s ease;
            }
            /* 🟢 Conectado */
            .status-dot.local {
              background: #22C55E;
              box-shadow: 0 0 9px rgba(34, 197, 94, 0.95);
            }
            /* 🟢 Servidor en la nube (Render) conectado */
            .status-dot.render {
              background: #22C55E;
              box-shadow: 0 0 9px rgba(34, 197, 94, 0.95);
            }
            /* 🚀 Servidor Northflank conectado */
            .status-dot.northflank {
              background: #a29bfe;
              box-shadow: 0 0 9px rgba(162, 155, 254, 0.95);
            }
            /* 🟠 Conectado pero muy lento (> 1 s) */
            .status-dot.slow {
              background: #FB8C00;
              box-shadow: 0 0 9px rgba(251, 140, 0, 0.95);
            }
            .status-dot.connected {
              background: #22C55E;
              box-shadow: 0 0 8px #22C55E;
            }
            .status-dot.testing {
              background: #FFC107;
              box-shadow: 0 0 8px #FFC107;
            }
            /* 🔴 Desconectado */
            .status-dot.disconnected {
              background: #FF5252;
              box-shadow: 0 0 8px rgba(255, 82, 82, 0.7);
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
            .server-token-box {
              display: flex;
              flex-direction: column;
              gap: 4px;
            }
            .server-token-label {
              font-size: 11px;
              color: var(--color-text-secondary, #A0A5BA);
              display: flex;
              align-items: center;
              gap: 4px;
            }
            .server-token-input {
              width: 100%;
              background: var(--color-surface, #1a1a2e);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.1));
              color: var(--color-text-primary, #ffffff);
              padding: 8px 12px;
              border-radius: var(--radius-sm, 10px);
              font-size: 11px;
              font-family: monospace;
              box-sizing: border-box;
              outline: none;
            }
            .server-token-input:focus {
              border-color: #a29bfe;
            }
            .server-card__bottom {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              flex-wrap: wrap;
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
              white-space: nowrap;
              transition: transform 0.15s ease, opacity 0.15s ease;
            }
            .btn-pill:active {
              transform: scale(0.96);
            }
            .btn-pill--primary {
              background: linear-gradient(135deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
              color: var(--color-on-primary, #fff);
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
              color: var(--color-text-primary);
              font-size: 18px;
              box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
              border: 2px solid transparent;
              transition: transform 0.2s ease, border-color 0.2s ease;
            }
            .theme-circle-item.active .theme-circle {
              border-color: var(--color-text-primary);
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
              flex-wrap: wrap;
              background: var(--color-surface-elevated, #22253d);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: var(--radius-md, 12px);
              padding: 3px;
              gap: 3px;
              width: 100%;
              box-sizing: border-box;
            }
            .segmented-btn {
              flex: 1 1 auto;
              background: transparent;
              border: none;
              color: var(--color-text-secondary, #A0A5BA);
              padding: 9px 8px;
              font-size: 12.5px;
              font-weight: 600;
              line-height: 1.2;
              border-radius: var(--radius-sm, 9px);
              cursor: pointer;
              transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease;
              text-align: center;
              white-space: nowrap;
            }
            .segmented-btn.active {
              background: var(--color-primary, #FF4757);
              color: var(--color-text-primary);
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
              background: var(--color-surface);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.15));
              color: var(--color-text-primary);
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
            @media (max-width: 420px) {
              .server-card__bottom {
                justify-content: flex-start;
              }
              .server-card__name {
                white-space: normal;
              }
            }
            @media (max-height: 520px) and (orientation: landscape) and (max-width: 1023px) {
              .page-settings {
                padding-bottom: 110px;
              }
              .server-cards-grid {
                grid-template-columns: 1fr;
              }
              .server-card {
                padding: 12px;
                gap: 10px;
              }
            }
          </style>

          <h1 class="settings-main-title">Ajustes</h1>

          <!-- SECTION 1: SERVIDOR (PROMINENT AT THE TOP) -->
          <section class="settings-section settings-section--featured">
            <div class="settings-section__header">
              <h2 class="settings-section__title">
                🌐 Fuente de música
              </h2>
              <span class="server-mode-indicator mode-off" id="server-mode-badge">
                <span class="status-dot disconnected" id="overall-status-dot"></span>
                <span id="server-mode-text">Desconectado</span>
              </span>
            </div>

            <div class="server-cards-grid" role="radiogroup" aria-label="Fuente de música">
              <!-- Este dispositivo -->
              <div class="server-card" id="card-server-device" data-mode="device" role="radio" tabindex="0" aria-checked="false">
                <div class="server-card__top">
                  <div class="server-card__identity">
                    <div class="server-icon">📱</div>
                    <div class="server-card__title-box">
                      <span class="server-card__name">
                        Este dispositivo
                        <span class="status-dot connected" id="device-status-dot"></span>
                      </span>
                      <span class="server-card__subtitle">Música local, sin servidor</span>
                    </div>
                  </div>
                  <span class="server-radio" aria-hidden="true"></span>
                </div>
                <p class="server-card__hint">Playlists, favoritos, historial y descargas funcionan sin internet. YouTube necesita un servidor.</p>
              </div>

              <!-- Servidor Local -->
              <div class="server-card" id="card-server-local" data-mode="local" role="radio" tabindex="0" aria-checked="false">
                <div class="server-card__top">
                  <div class="server-card__identity">
                    <div class="server-icon">💻</div>
                    <div class="server-card__title-box">
                      <span class="server-card__name">
                        Servidor Local
                        <span class="status-dot disconnected" id="local-status-dot"></span>
                      </span>
                      <span class="server-card__subtitle">Tu computadora en la misma Wi-Fi</span>
                    </div>
                  </div>
                  <span class="server-radio" aria-hidden="true"></span>
                </div>

                <input type="url" id="input-server-local-url" class="server-url-input"
                       value="" placeholder="http://192.168.1.10:3000" spellcheck="false" />

                <div class="server-card__bottom">
                  <button class="btn-pill btn-pill--secondary" id="btn-test-local">Probar</button>
                  <span class="server-latency-tag" id="latency-local-text">Sin probar</span>
                </div>
              </div>

              <!-- Servidor Render -->
              <div class="server-card" id="card-server-render" data-mode="render" role="radio" tabindex="0" aria-checked="false">
                <div class="server-card__top">
                  <div class="server-card__identity">
                    <div class="server-icon">☁️</div>
                    <div class="server-card__title-box">
                      <span class="server-card__name">
                        Servidor Render
                        <span class="status-dot disconnected" id="render-status-dot"></span>
                      </span>
                      <span class="server-card__subtitle">Nube · puede tardar en despertar</span>
                    </div>
                  </div>
                  <span class="server-radio" aria-hidden="true"></span>
                </div>

                <input type="url" id="input-server-render-url" class="server-url-input"
                       value="" placeholder="https://tu-servidor.onrender.com" spellcheck="false" />

                <div class="server-card__bottom">
                  <button class="btn-pill btn-pill--secondary" id="btn-test-render">Probar</button>
                  <span class="server-latency-tag" id="latency-render-text">Sin probar</span>
                </div>
              </div>

              <!-- Servidor Northflank -->
              <div class="server-card" id="card-server-northflank" data-mode="northflank" role="radio" tabindex="0" aria-checked="false">
                <div class="server-card__top">
                  <div class="server-card__identity">
                    <div class="server-icon">🚀</div>
                    <div class="server-card__title-box">
                      <span class="server-card__name">
                        Servidor Northflank
                        <span class="status-dot disconnected" id="northflank-status-dot"></span>
                      </span>
                      <span class="server-card__subtitle">Nube siempre activa</span>
                    </div>
                  </div>
                  <span class="server-radio" aria-hidden="true"></span>
                </div>

                <input type="url" id="input-server-northflank-url" class="server-url-input"
                       value="" placeholder="https://tu-servidor.code.run" spellcheck="false" />

                <div class="server-card__bottom">
                  <button class="btn-pill btn-pill--secondary" id="btn-test-northflank">Probar</button>
                  <span class="server-latency-tag" id="latency-northflank-text">Sin probar</span>
                </div>
              </div>
            </div>
          </section>

          <!-- SECTION 2: APARIENCIA -->
          <section class="settings-section">
            <h2 class="settings-section__title">🎨 <span data-i18n="settings.section.appearance">Apariencia</span></h2>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title" data-i18n="settings.theme">Tema de colores</span>
                <span class="setting-label-sub" data-i18n="settings.theme.sub">Selecciona el color de acento principal</span>
              </div>
              <div class="theme-circles-grid" id="theme-circles-container">
                <!-- Rendered dynamically -->
              </div>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title" data-i18n="settings.screen">Modo de pantalla</span>
                <span class="setting-label-sub" data-i18n="settings.screen.sub">Claro, oscuro o según el sistema</span>
              </div>
              <div class="segmented-control" id="control-dark-mode">
                <button class="segmented-btn" data-mode="light">☀️ <span data-i18n="settings.mode.light">Claro</span></button>
                <button class="segmented-btn active" data-mode="dark">🌙 <span data-i18n="settings.mode.dark">Oscuro</span></button>
                <button class="segmented-btn" data-mode="system">⚙️ <span data-i18n="settings.mode.system">Sistema</span></button>
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
            <h2 class="settings-section__title">🎵 <span data-i18n="settings.section.playback">Reproducción</span></h2>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title" data-i18n="settings.crossfade">Crossfade (Fundido entre canciones)</span>
                <span class="setting-label-sub" id="crossfade-value-label">0 segundos (Desactivado)</span>
              </div>
              <div class="segmented-control" id="control-crossfade">
                <button class="segmented-btn active" data-crossfade="0">0s</button>
                <button class="segmented-btn" data-crossfade="2">2s</button>
                <button class="segmented-btn" data-crossfade="5">5s</button>
                <button class="segmented-btn" data-crossfade="10">10s</button>
              </div>
            </div>

            <!-- Ecualizador de 5 bandas + presets (incluye Bass Boost y Fiesta) -->
            <div class="setting-item-row" style="flex-direction:column; align-items:stretch; gap:8px;">
              <div class="setting-label-box" style="display:flex; justify-content:space-between; align-items:baseline; width:100%;">
                <span class="setting-label-title">🎚️ Ecualizador</span>
                <span class="setting-label-sub" id="eq-preset-label" style="margin:0;">Plano</span>
              </div>

              <div class="segmented-control" id="control-eq-preset" style="flex-wrap:wrap; gap:6px;">
                <button class="segmented-btn active" data-eq-preset="flat">Plano</button>
                <button class="segmented-btn" data-eq-preset="bass">🔊 Bass Boost</button>
                <button class="segmented-btn" data-eq-preset="voice">🎙️ Voz</button>
                <button class="segmented-btn" data-eq-preset="rock">🎸 Rock</button>
                <button class="segmented-btn" data-eq-preset="electro">🎧 Electrónica</button>
                <button class="segmented-btn" data-eq-preset="party">🎉 Fiesta</button>
                <button class="segmented-btn" data-eq-preset="lofi">🌙 Suave</button>
              </div>

              <div id="eq-sliders" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                <div class="eq-band" style="display:grid; grid-template-columns:62px 1fr 54px; align-items:center; gap:10px;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--color-text-secondary);">60 Hz</span>
                  <input type="range" min="-12" max="12" step="1" value="0" data-eq-band="0" style="width:100%;accent-color:var(--color-primary,#FF4757);" />
                  <span class="eq-band-value" style="font-size:11.5px;font-weight:800;text-align:right;color:var(--color-text-primary);">0 dB</span>
                </div>
                <div class="eq-band" style="display:grid; grid-template-columns:62px 1fr 54px; align-items:center; gap:10px;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--color-text-secondary);">230 Hz</span>
                  <input type="range" min="-12" max="12" step="1" value="0" data-eq-band="1" style="width:100%;accent-color:var(--color-primary,#FF4757);" />
                  <span class="eq-band-value" style="font-size:11.5px;font-weight:800;text-align:right;color:var(--color-text-primary);">0 dB</span>
                </div>
                <div class="eq-band" style="display:grid; grid-template-columns:62px 1fr 54px; align-items:center; gap:10px;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--color-text-secondary);">910 Hz</span>
                  <input type="range" min="-12" max="12" step="1" value="0" data-eq-band="2" style="width:100%;accent-color:var(--color-primary,#FF4757);" />
                  <span class="eq-band-value" style="font-size:11.5px;font-weight:800;text-align:right;color:var(--color-text-primary);">0 dB</span>
                </div>
                <div class="eq-band" style="display:grid; grid-template-columns:62px 1fr 54px; align-items:center; gap:10px;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--color-text-secondary);">3.6 kHz</span>
                  <input type="range" min="-12" max="12" step="1" value="0" data-eq-band="3" style="width:100%;accent-color:var(--color-primary,#FF4757);" />
                  <span class="eq-band-value" style="font-size:11.5px;font-weight:800;text-align:right;color:var(--color-text-primary);">0 dB</span>
                </div>
                <div class="eq-band" style="display:grid; grid-template-columns:62px 1fr 54px; align-items:center; gap:10px;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--color-text-secondary);">14 kHz</span>
                  <input type="range" min="-12" max="12" step="1" value="0" data-eq-band="4" style="width:100%;accent-color:var(--color-primary,#FF4757);" />
                  <span class="eq-band-value" style="font-size:11.5px;font-weight:800;text-align:right;color:var(--color-text-primary);">0 dB</span>
                </div>
              </div>

              <button class="btn-pill btn-pill--secondary" id="btn-eq-reset" style="align-self:flex-start; margin-top:12px;">
                Restablecer ecualizador
              </button>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title" data-i18n="settings.speed">Velocidad de reproducción</span>
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
                <span class="setting-label-title" data-i18n="settings.quality">Calidad de audio</span>
                <span class="setting-label-sub" data-i18n="settings.quality.sub">Streaming y compresión sonora</span>
              </div>
              <div class="segmented-control" id="control-audio-quality">
                <button class="segmented-btn" data-quality="low">Baja (96 kbps)</button>
                <button class="segmented-btn active" data-quality="normal">Normal (160 kbps)</button>
                <button class="segmented-btn" data-quality="high">Alta (320 kbps)</button>
              </div>
            </div>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title" data-i18n="settings.sleep">Temporizador de sueño</span>
                <span class="setting-label-sub" data-i18n="settings.sleep.sub">Pausar la reproducción automáticamente</span>
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
            <h2 class="settings-section__title">💾 <span data-i18n="settings.section.downloads">Descargas y Almacenamiento</span></h2>

            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title" data-i18n="settings.storage">Espacio utilizado</span>
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
            <h2 class="settings-section__title">🌍 <span data-i18n="settings.section.language">Idioma</span></h2>
            <div class="setting-item-row">
              <div class="setting-label-box">
                <span class="setting-label-title" data-i18n="settings.language">Idioma de la interfaz</span>
                <span class="setting-label-sub" data-i18n="settings.language.sub">Selecciona el idioma de Sonora Music</span>
              </div>
              <div class="segmented-control" id="control-language">
                <button class="segmented-btn active" data-lang="es">🇪🇸 Español</button>
                <button class="segmented-btn" data-lang="en">🇺🇸 English</button>
              </div>
            </div>
          </section>

          <!-- SECTION 6: NOTIFICACIONES -->
          <section class="settings-section">
            <h2 class="settings-section__title">🔔 <span data-i18n="settings.section.notifications">Notificaciones</span></h2>

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

            <div class="setting-item-row setting-item-row--inline">
              <div class="setting-label-box">
                <span class="setting-label-title">Letras guardadas</span>
                <span class="setting-label-sub">Borrar la caché de letras (se vuelven a buscar)</span>
              </div>
              <button class="btn-pill btn-pill--secondary" id="btn-clear-lyrics-cache">
                Borrar letras
              </button>
            </div>

            <div class="setting-item-row setting-item-row--inline">
              <div class="setting-label-box">
                <span class="setting-label-title">Caché de la aplicación</span>
                <span class="setting-label-sub">Liberar archivos temporales sin borrar tu música</span>
              </div>
              <button class="btn-pill btn-pill--secondary" id="btn-clear-app-cache">
                Limpiar caché
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
              <div style="display:flex;align-items:center;gap:10px;margin:6px 0;flex-wrap:wrap;justify-content:center;">
                <span class="about-version-badge">v7.17.0 (Build 2026)</span>
                <button id="btn-check-updates" class="btn-update-action" style="padding:4px 12px;font-size:11px;" title="Buscar nuevas versiones">
                  🔄 Buscar actualizaciones
                </button>
              </div>

              <div class="about-stats-summary" id="about-stats-summary">
                <span id="about-tracks-count">🎵 0 pistas</span> •
                <span id="about-playlists-count">📁 0 playlists</span> •
                <span id="about-time-count">⏱️ 0 min</span>
              </div>

              <p style="font-size:12px;color:var(--color-text-secondary);max-width:380px;margin:4px 0 0 0;">
                Tu reproductor de música de alta fidelidad, diseñado con amor para una experiencia sonora pura y sin interrupciones.
              </p>

              <div class="about-links">
                <a href="https://github.com/raykozabala/sonora-music-server" target="_blank" rel="noopener noreferrer" class="about-link">GitHub</a>
                <span style="color:var(--color-divider);">•</span>
                <a href="https://sonora-music-b1ee.onrender.com" target="_blank" rel="noopener noreferrer" id="link-about-web" class="about-link">Sitio Web</a>
                <span style="color:var(--color-divider);">•</span>
                <a href="https://github.com/raykozabala/sonora-music-server/issues" target="_blank" rel="noopener noreferrer" id="link-about-feedback" class="about-link">Sugerencias</a>
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
     * Handles Local, Render & Northflank servers, URLs, toggles, test latency, and state sync
     */
    async initServerSection() {
      const inputLocal = $('#input-server-local-url');
      const inputRender = $('#input-server-render-url');
      const inputNorthflank = $('#input-server-northflank-url');
      const btnTestLocal = $('#btn-test-local');
      const btnTestRender = $('#btn-test-render');
      const btnTestNorthflank = $('#btn-test-northflank');
      const latencyLocal = $('#latency-local-text');
      const latencyRender = $('#latency-render-text');
      const latencyNorthflank = $('#latency-northflank-text');
      const dotDevice = $('#device-status-dot');
      const dotLocal = $('#local-status-dot');
      const dotRender = $('#render-status-dot');
      const dotNorthflank = $('#northflank-status-dot');
      const modeBadge = $('#server-mode-badge');
      const modeText = $('#server-mode-text');
      const overallDot = $('#overall-status-dot');
      const cardDevice = $('#card-server-device');
      const cardLocal = $('#card-server-local');
      const cardRender = $('#card-server-render');
      const cardNorthflank = $('#card-server-northflank');
      const cards = [
        { mode: 'device', el: cardDevice },
        { mode: 'local', el: cardLocal },
        { mode: 'render', el: cardRender },
        { mode: 'northflank', el: cardNorthflank }
      ];

      // Load saved settings
      let localUrl = await getSetting('server_local_url', '');
      let renderUrl = await getSetting('server_render_url', 'https://sonora-music-b1ee.onrender.com');
      let northflankUrl = await getSetting('server_northflank_url', '');
      let serverMode = await getSetting('server_mode', 'device'); // 'device' | 'local' | 'render' | 'northflank'

      if (inputLocal) inputLocal.value = localUrl;
      if (inputRender) inputRender.value = renderUrl;
      if (inputNorthflank) inputNorthflank.value = northflankUrl;

      // Update card selection based on mode
      const paintCards = (mode) => {
        cards.forEach(({ mode: m, el }) => {
          if (!el) return;
          const active = m === mode;
          el.classList.toggle('active-server', active);
          el.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      };
      paintCards(serverMode);

      // Update UI Mode display
      const updateModeUI = (mode) => {
        paintCards(mode);
        if (!modeBadge || !modeText || !overallDot) return;
        modeBadge.className = 'server-mode-indicator mode-' + mode;

        if (mode === 'device') {
          modeText.textContent = 'Este dispositivo';
        } else if (mode === 'local') {
          modeText.textContent = 'Servidor Local';
        } else if (mode === 'northflank') {
          modeText.textContent = 'Servidor Northflank';
        } else if (mode === 'render') {
          modeText.textContent = 'Servidor Render';
        } else {
          modeText.textContent = 'Sin conexión';
        }
        refreshOverallBadge();
      };

      // Colorea el punto según el estado real de la conexión:
      // 🟢 verde = conectado · 🟠 naranja = muy lento (> 1 s) · 🔴 rojo = sin conexión
      const dotClassFor = (type, latencyMs) => {
        if (latencyMs > 1000) return 'slow';
        return 'connected';
      };
      const dotEmojiFor = (cls) => (cls === 'slow' ? '🟠' : (cls === 'connected' ? '🟢' : '🔴'));

      // Último estado conocido de cada servidor ('connected' | 'slow' | 'off')
      const probeState = { local: null, northflank: null, render: null };

      // Aplica el color y el texto del badge superior según el modo activo.
      const refreshOverallBadge = () => {
        if (!overallDot) return;
        let st = null;
        if (serverMode === 'device') {
          // Modo Dispositivo: siempre disponible, sin red.
          overallDot.className = 'status-dot connected';
          return;
        } else if (serverMode === 'local') {
          st = probeState.local;
        } else if (serverMode === 'northflank') {
          st = probeState.northflank;
        } else if (serverMode === 'render') {
          st = probeState.render;
        } else {
          // Sin servidor elegido mostramos el mejor resultado disponible.
          const vals = [probeState.local, probeState.northflank, probeState.render].filter(Boolean);
          if (vals.indexOf('connected') !== -1) st = 'connected';
          else if (vals.indexOf('slow') !== -1) st = 'slow';
          else st = 'off';
        }
        const cls = (st === 'connected') ? 'connected' : (st === 'slow' ? 'slow' : 'disconnected');
        overallDot.className = 'status-dot ' + cls;
      };

      // Comprobación automática al abrir Ajustes (sin pulsar nada)
      const autoColorDot = async (type, dot, latencyEl) => {
        if (!dot) return;
        try {
          dot.className = 'status-dot testing';
          if (latencyEl) latencyEl.textContent = '…';
          let ok = false, ms = 0;
          if (Sonora.API && typeof Sonora.API.testConnection === 'function') {
            const t0 = Date.now();
            const res = await Sonora.API.testConnection(type, type === 'render' ? 22000 : (type === 'local' ? 5000 : 9000));
            ms = (res && res.latency) ? res.latency : (Date.now() - t0);
            ok = !!(res && (res.success || res.status === 200 || res.ok));
          }
          if (ok) {
            const cls = dotClassFor(type, ms);
            dot.className = 'status-dot ' + cls;
            probeState[type] = cls;
            if (latencyEl) latencyEl.textContent = dotEmojiFor(cls) + ' ' + ms + ' ms' + (cls === 'slow' ? ' (lento)' : '');
          } else {
            dot.className = 'status-dot disconnected';
            probeState[type] = 'off';
            if (latencyEl) latencyEl.textContent = '🔴 Inaccesible';
          }
        } catch (e) {
          dot.className = 'status-dot disconnected';
          probeState[type] = 'off';
          if (latencyEl) latencyEl.textContent = '🔴 Inaccesible';
        }
        refreshOverallBadge();
      };
      // Solo sondeamos la fuente activa: Render puede tardar 25 s en despertar
      // y no tiene sentido bloquear Ajustes probando servidores que no se usan.
      if (serverMode === 'local') autoColorDot('local', dotLocal, latencyLocal);
      else if (serverMode === 'northflank') autoColorDot('northflank', dotNorthflank, latencyNorthflank);
      else if (serverMode === 'render') autoColorDot('render', dotRender, latencyRender);

      updateModeUI(serverMode);

      // Synchronization function
      const syncServerMode = async (newMode) => {
        if (!newMode || newMode === serverMode) return;
        serverMode = newMode;
        updateModeUI(newMode);
        await setSetting('server_mode', newMode);
        await setSetting('serverMode', newMode);

        if (Sonora.API && typeof Sonora.API.setMode === 'function') {
          try { Sonora.API.setMode(newMode); } catch (e) {}
        }
        if (Sonora.Store) {
          Sonora.Store.set('serverMode', newMode);
        }

        if (newMode === 'device') {
          showToast('Modo Dispositivo: música local sin servidor');
          return;
        }

        // Test de inmediato para actualizar el indicador activo
        if (newMode === 'local') autoColorDot('local', dotLocal, latencyLocal);
        else if (newMode === 'northflank') autoColorDot('northflank', dotNorthflank, latencyNorthflank);
        else if (newMode === 'render') autoColorDot('render', dotRender, latencyRender);
      };

      // Selección de fuente: una sola tarjeta activa (radio).
      cards.forEach(({ mode, el }) => {
        if (!el) return;
        const choose = () => { syncServerMode(mode); };
        addTrackedListener(el, 'click', (e) => {
          // Los controles internos (input, botones de probar) no cambian la fuente.
          if (e.target.closest('input, button')) return;
          choose();
        });
        addTrackedListener(el, 'keydown', (e) => {
          if (e.target !== el) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            choose();
          }
        });
      });

      // URL input changes
      if (inputLocal) {
        addTrackedListener(inputLocal, 'change', async (e) => {
          const val = e.target.value.trim();
          await setSetting('server_local_url', val);
          await setSetting('serverLocalUrl', val);
          if (Sonora.API && typeof Sonora.API.setLocalUrl === 'function') {
            Sonora.API.setLocalUrl(val);
          }
          if (Sonora.Store) Sonora.Store.set('serverLocalUrl', val);
          showToast('URL local guardada');
          autoColorDot('local', dotLocal, latencyLocal);
        });
      }

      if (inputNorthflank) {
        addTrackedListener(inputNorthflank, 'change', async (e) => {
          const val = e.target.value.trim();
          await setSetting('server_northflank_url', val);
          await setSetting('serverNorthflankUrl', val);
          if (Sonora.API && typeof Sonora.API.setNorthflankUrl === 'function') {
            Sonora.API.setNorthflankUrl(val);
          }
          if (Sonora.Store) Sonora.Store.set('serverNorthflankUrl', val);
          showToast('URL Northflank guardada');
          autoColorDot('northflank', dotNorthflank, latencyNorthflank);
        });
      }

      if (inputRender) {
        addTrackedListener(inputRender, 'change', async (e) => {
          const val = e.target.value.trim();
          await setSetting('server_render_url', val);
          await setSetting('serverRenderUrl', val);
          if (Sonora.API && typeof Sonora.API.setRenderUrl === 'function') {
            Sonora.API.setRenderUrl(val);
          }
          if (Sonora.Store) Sonora.Store.set('serverRenderUrl', val);
          showToast('URL Render guardada');
          autoColorDot('render', dotRender, latencyRender);
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
            const res = await Sonora.API.testConnection(type, type === 'render' ? 25000 : (type === 'local' ? 5000 : 9000));
            latencyMs = res && res.latency ? res.latency : (Date.now() - startTime);
            success = !!(res && (res.success || res.status === 200 || res.ok));
          } else {
            // Fetch ping test to URL
            const url = urlInput ? urlInput.value.trim() : '';
            if (url) {
              const healthUrl = url.replace(/\/+$/, '') + '/api/health';
              const ctrl = new AbortController();
              const tid = setTimeout(() => ctrl.abort(), type === 'render' ? 20000 : 5000);
              const resp = await fetch(healthUrl, { signal: ctrl.signal });
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
          const cls = dotClassFor(type, latencyMs);
          dot.className = 'status-dot ' + cls;
          probeState[type] = cls;
          refreshOverallBadge();
          latencyEl.textContent = dotEmojiFor(cls) + ' ' + latencyMs + ' ms' + (cls === 'slow' ? ' (lento)' : '');
          showToast(cls === 'slow'
            ? `Conectado pero lento: ${latencyMs} ms`
            : `Conexión exitosa (${latencyMs} ms)`, cls === 'slow' ? 'warning' : 'success');
        } else {
          dot.className = 'status-dot disconnected';
          probeState[type] = 'off';
          refreshOverallBadge();
          latencyEl.textContent = `🔴 Inaccesible`;
          showToast(`No se pudo conectar al servidor ${type}`, 'error');
        }
      };

      if (btnTestLocal) {
        addTrackedListener(btnTestLocal, 'click', () => {
          testServer('local', btnTestLocal, dotLocal, latencyLocal, inputLocal);
        });
      }

      if (btnTestNorthflank) {
        addTrackedListener(btnTestNorthflank, 'click', () => {
          testServer('northflank', btnTestNorthflank, dotNorthflank, latencyNorthflank, inputNorthflank);
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
      const currentMode = await getSetting('darkMode', 'dark');
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
          await setSetting('darkMode', selected);
          showToast(`Modo cambiado: ${btn.textContent.trim()}`);
        });
      });

      // 3. Font size (small, medium, large)
      const currentFontSize = await getSetting('fontSize', 'medium');
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
          await setSetting('fontSize', size);
          showToast(`Tamaño de fuente: ${btn.textContent.trim()}`);
        });
      });

      // 4. Custom Background
      const bgInput = $('#custom-bg-input');
      const bgPreview = $('#bg-preview-thumbnail');
      const btnRemoveBg = $('#btn-remove-custom-bg');
      const currentBg = await getSetting('customBg', null);

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

          showToast('Preparando la imagen…');

          const reader = new FileReader();
          reader.onload = (event) => {
            const original = event.target.result;
            // Reducimos la foto (1600 px) para que no ocupe megas de más.
            const img = new Image();
            img.onload = async () => {
              let dataUrl = original;
              try {
                const max = 1600;
                const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
                const cw = Math.max(1, Math.round((img.width || max) * scale));
                const ch = Math.max(1, Math.round((img.height || max) * scale));
                const canvas = document.createElement('canvas');
                canvas.width = cw;
                canvas.height = ch;
                canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
                dataUrl = canvas.toDataURL('image/jpeg', 0.85);
              } catch (err) { /* nos quedamos con la original */ }

              updateBgUI(dataUrl);
              if (Sonora.Themes && typeof Sonora.Themes.setCustomBg === 'function') {
                Sonora.Themes.setCustomBg(dataUrl);
              }
              await setSetting('customBg', dataUrl);
              showToast('Fondo personalizado aplicado');
            };
            img.onerror = async () => {
              updateBgUI(original);
              if (Sonora.Themes && typeof Sonora.Themes.setCustomBg === 'function') {
                Sonora.Themes.setCustomBg(original);
              }
              await setSetting('customBg', original);
              showToast('Fondo personalizado aplicado');
            };
            img.src = original;
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
          await setSetting('customBg', null);
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

      // Aplica el fundido en segundos (el reproductor trabaja en milisegundos).
      const applyCrossfade = async (sec, silent) => {
        sec = Number(sec) || 0;
        updateCrossfadeLabel(sec);
        crossfadeBtns.forEach(b => b.classList.toggle('active', Number(b.getAttribute('data-crossfade')) === sec));
        if (Sonora.Player && typeof Sonora.Player.setCrossfade === 'function') {
          Sonora.Player.setCrossfade(sec * 1000);
        }
        await setSetting('playback_crossfade', sec);
        if (!silent) showToast(sec === 0 ? 'Crossfade desactivado' : `Crossfade: ${sec}s`);
      };

      updateCrossfadeLabel(savedCrossfade);
      crossfadeBtns.forEach(btn => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-crossfade')) === Number(savedCrossfade));
        addTrackedListener(btn, 'click', () => applyCrossfade(btn.getAttribute('data-crossfade')));
      });

      // 1b. Ecualizador (5 bandas + presets: Bass Boost, Voz, Rock, Electrónica, Fiesta…)
      const EQ_PRESET_NAMES = {
        flat: 'Plano', bass: 'Bass Boost', voice: 'Voz', rock: 'Rock',
        electro: 'Electrónica', party: 'Fiesta 🎉', lofi: 'Suave', custom: 'Personalizado'
      };
      const eqPresetBtns = $$('#control-eq-preset .segmented-btn');
      const eqSliders = $$('#eq-sliders input[data-eq-band]');
      const eqPresetLabel = $('#eq-preset-label');

      const markEqPreset = (key) => {
        eqPresetBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-eq-preset') === key));
        if (eqPresetLabel) eqPresetLabel.textContent = EQ_PRESET_NAMES[key] || 'Personalizado';
      };

      const refreshEqSliders = () => {
        for (let i = 0; i < eqSliders.length; i++) {
          const g = Number(eqSliders[i].value) || 0;
          const out = eqSliders[i].parentElement.querySelector('.eq-band-value');
          if (out) out.textContent = (g > 0 ? '+' : '') + g + ' dB';
        }
      };

      const applyEq = async (gains, presetKey, silent) => {
        const arr = [];
        for (let i = 0; i < 5; i++) {
          const g = Math.max(-12, Math.min(12, Number(gains && gains[i]) || 0));
          arr.push(g);
          if (Sonora.Player && typeof Sonora.Player.setEQ === 'function') Sonora.Player.setEQ(i, g);
          if (eqSliders[i]) eqSliders[i].value = g;
        }
        refreshEqSliders();
        markEqPreset(presetKey || 'custom');
        await setSetting('eqGains', arr);
        await setSetting('eqPreset', presetKey || 'custom');

        // El preset "Fiesta" además activa un fundido de 5 s entre canciones.
        if (presetKey === 'party') {
          await applyCrossfade(5, true);
          if (!silent) showToast('🎉 Modo fiesta: graves realzados + fundido de 5s');
        } else if (!silent) {
          showToast(`Ecualizador: ${EQ_PRESET_NAMES[presetKey] || 'Personalizado'}`);
        }
      };

      const savedEqPreset = await getSetting('eqPreset', 'flat');
      let savedEqGains = await getSetting('eqGains', null);
      if (!Array.isArray(savedEqGains)) savedEqGains = null;

      if (savedEqGains) {
        for (let i = 0; i < eqSliders.length && i < savedEqGains.length; i++) {
          eqSliders[i].value = Math.max(-12, Math.min(12, Number(savedEqGains[i]) || 0));
        }
      } else {
        const preset = getEqPresetGains(savedEqPreset);
        for (let i = 0; i < eqSliders.length && preset && i < preset.length; i++) {
          eqSliders[i].value = preset[i];
        }
      }
      refreshEqSliders();
      markEqPreset(savedEqPreset);
      // Se aplica al reproductor sin volver a guardar ni avisar.
      for (let i = 0; i < eqSliders.length; i++) {
        if (Sonora.Player && typeof Sonora.Player.setEQ === 'function') {
          Sonora.Player.setEQ(i, Number(eqSliders[i].value) || 0);
        }
      }

      eqPresetBtns.forEach(btn => {
        addTrackedListener(btn, 'click', () => {
          const key = btn.getAttribute('data-eq-preset');
          const gains = getEqPresetGains(key);
          if (gains) applyEq(gains, key);
        });
      });

      eqSliders.forEach(slider => {
        addTrackedListener(slider, 'input', () => {
          const i = Number(slider.getAttribute('data-eq-band'));
          const g = Number(slider.value) || 0;
          if (Sonora.Player && typeof Sonora.Player.setEQ === 'function') Sonora.Player.setEQ(i, g);
          const out = slider.parentElement.querySelector('.eq-band-value');
          if (out) out.textContent = (g > 0 ? '+' : '') + g + ' dB';
          markEqPreset('custom');
        });
        addTrackedListener(slider, 'change', () => {
          const gains = eqSliders.map(s => Number(s.value) || 0);
          setSetting('eqGains', gains);
          setSetting('eqPreset', 'custom');
        });
      });

      const eqResetBtn = $('#btn-eq-reset');
      if (eqResetBtn) {
        addTrackedListener(eqResetBtn, 'click', () => applyEq([0, 0, 0, 0, 0], 'flat'));
      }

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
          // Alias que ya usaba la base de datos; el reproductor lee
          // sonora_audio_quality en localStorage al resolver cada pista.
          await setSetting('audioQuality', q);
          showToast(`Calidad de audio: ${btn.textContent.trim()} (se aplica a la próxima canción)`);
        });
      });

      // 4. Sleep timer presets
      const timerBtns = $$('#control-sleep-timer .segmented-btn');
      const savedTimer = await getSetting('sleep_timer', '0');
      const savedTimerEnd = Number(await getSetting('sleep_timer_end', 0)) || 0;
      const markTimerActive = (val) => {
        timerBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-timer') === String(val)));
      };

      // Refleja el estado REAL: si el tiempo ya venció, no lo pintamos activo.
      let activeTimer = '0';
      if (savedTimer === 'end_track') {
        activeTimer = 'end_track';
      } else if (Number(savedTimer) > 0 && savedTimerEnd > Date.now()) {
        activeTimer = String(savedTimer);
      } else if (Number(savedTimer) > 0 && !savedTimerEnd) {
        // Compatibilidad con versiones anteriores sin fecha de fin: se
        // reprograma la duración elegida en lugar de mostrar algo falso.
        Sonora.Player.setSleepTimer(Number(savedTimer), true);
        activeTimer = String(savedTimer);
      }
      markTimerActive(activeTimer);

      timerBtns.forEach(btn => {
        addTrackedListener(btn, 'click', async () => {
          const val = btn.getAttribute('data-timer');
          if (Sonora.Player && typeof Sonora.Player.setSleepTimer === 'function') {
            Sonora.Player.setSleepTimer(val === 'end_track' ? 'end_track' : Number(val));
          }
          markTimerActive(val);
          await setSetting('sleep_timer', val);
          await setSetting('sleep_timer_end', val === '0' || val === 'end_track'
            ? 0
            : Date.now() + (Number(val) * 60 * 1000));
          if (val === '0') showToast('Temporizador desactivado');
          else if (val === 'end_track') showToast('Se pausará al terminar esta canción');
          else showToast(`Temporizador programado: ${btn.textContent.trim()}`);
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

      const readDownloadRecords = async () => {
        // Usamos los registros completos (id + trackId + tamaño). Antes se
        // listaban solo pistas que seguían existiendo en la biblioteca; si la
        // pista había desaparecido, la descarga quedaba invisible e imposible
        // de borrar desde Ajustes.
        try {
          if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.getRecords === 'function') {
            return await Sonora.DB.downloads.getRecords();
          }
        } catch (e) {}
        try {
          if (Sonora.Download && typeof Sonora.Download.getDownloadedTracks === 'function') {
            const tracks = await Sonora.Download.getDownloadedTracks();
            return (tracks || []).map(t => ({ trackId: t.id, size: t.fileSize || 0, track: t }));
          }
        } catch (e) {}
        return [];
      };

      const renderDownloadsUI = async () => {
        let bytesUsed = 0;
        let items = [];

        try {
          const records = await readDownloadRecords();
          items = await Promise.all((records || []).map(async (rec) => {
            let track = rec.track || null;
            if (!track && Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.getById === 'function') {
              try { track = await Sonora.DB.tracks.getById(rec.trackId); } catch (e) {}
            }
            bytesUsed += Number(rec.size) || Number(track && track.fileSize) || 0;
            return { rec, track };
          }));
          if (!bytesUsed && Sonora.Download && typeof Sonora.Download.getStorageUsed === 'function') {
            bytesUsed = (await Sonora.Download.getStorageUsed()) || 0;
          }
        } catch (e) {
          console.warn('[Settings] Error reading downloads', e);
        }

        if (storageLabel) storageLabel.textContent = `${formatBytes(bytesUsed)} usados`;

        // Estimate percent against 2GB hypothetical cache quota
        const pct = Math.min(100, Math.max(3, Math.round((bytesUsed / (2 * 1024 * 1024 * 1024)) * 100)));
        if (storageBar) storageBar.style.width = pct + '%';

        if (!listEl) return;

        if (items.length === 0) {
          listEl.innerHTML = `
            <div style="font-size:12px;color:var(--color-text-secondary);padding:6px 0;">
              No hay pistas descargadas para uso offline.
            </div>
          `;
          return;
        }

        listEl.innerHTML = items.map(({ rec, track }) => {
          const id = rec.trackId != null ? rec.trackId : String(rec.id || '').replace(/^dl_/, '');
          const title = (track && track.title) || 'Descarga';
          const artist = (track && track.artist) || 'Pista no encontrada';
          const artwork = (track && track.artworkUrl) || generateArtwork(id, title);
          const sizeStr = rec.size ? formatBytes(rec.size) : ((track && track.fileSize) ? formatBytes(track.fileSize) : '—');
          return `
            <div class="download-track-item">
              <img src="${artwork}" class="download-track-img" alt="" />
              <div class="download-track-info">
                <div class="download-track-name">${escapeHtml(title)}</div>
                <div class="download-track-artist">${escapeHtml(artist)} • ${sizeStr}</div>
              </div>
              <button class="btn-delete-download" data-track-id="${escapeHtml(id)}" data-record-id="${escapeHtml(rec.id || '')}" title="Eliminar descarga">
                🗑️
              </button>
            </div>
          `;
        }).join('');

        // Bind single download delete
        $$('.btn-delete-download', listEl).forEach(btn => {
          addTrackedListener(btn, 'click', async () => {
            const trackId = btn.getAttribute('data-track-id');
            const recordId = btn.getAttribute('data-record-id');
            btn.disabled = true;
            try {
              if (Sonora.Download && typeof Sonora.Download.deleteDownload === 'function') {
                await Sonora.Download.deleteDownload(trackId);
              }
              // Borrado directo por id de registro: cubre descargas cuyo track
              // ya no existe o cuyo id no es numérico.
              if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.delete === 'function') {
                await Sonora.DB.downloads.delete(recordId || trackId);
              }
              if (Sonora.Store) {
                try { Sonora.Store.emit('downloadsChanged', { deleted: trackId }); } catch (e) {}
              }
              showToast('Descarga eliminada');
              await renderDownloadsUI();
            } catch (err) {
              console.error('[Settings] Delete download error', err);
              btn.disabled = false;
              showToast('No se pudo eliminar la descarga');
            }
          });
        });
      };

      await renderDownloadsUI();

      if (btnClearAll) {
        addTrackedListener(btnClearAll, 'click', async () => {
          const confirmed = window.confirm('¿Deseas eliminar todas las canciones y videos descargados de tu dispositivo?');
          if (!confirmed) return;

          btnClearAll.disabled = true;
          try {
            if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.clearAll === 'function') {
              await Sonora.DB.downloads.clearAll();
            } else if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.clear === 'function') {
              await Sonora.DB.downloads.clear();
            }
            if (Sonora.DB && Sonora.DB.videos && typeof Sonora.DB.videos.clearAll === 'function') {
              await Sonora.DB.videos.clearAll();
            }
            if (Sonora.Store) {
              try { Sonora.Store.emit('downloadsChanged', { cleared: true }); } catch (e) {}
            }
            showToast('Todas las descargas han sido eliminadas');
            await renderDownloadsUI();
          } catch (err) {
            console.error('[Settings] Clear downloads failed', err);
            showToast('No se pudieron borrar todas las descargas');
          } finally {
            btnClearAll.disabled = false;
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

      // Aplica el idioma guardado a toda la interfaz
      if (Sonora.i18n && typeof Sonora.i18n.setLang === 'function') {
        Sonora.i18n.setLang(savedLang);
      }

      langBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === savedLang);
        addTrackedListener(btn, 'click', async () => {
          langBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const lang = btn.getAttribute('data-lang');
          await setSetting('language', lang);
          if (Sonora.i18n && typeof Sonora.i18n.setLang === 'function') {
            Sonora.i18n.setLang(lang);
          }
          if (Sonora.Store) Sonora.Store.set('language', lang);
          showToast(lang === 'en' ? 'Language set to English' : 'Idioma establecido: Español');
        });
      });
    },

    /**
     * SECTION 6: Notifications Logic
     */
    async initNotificationsSection() {
      const toggleUpdates = $('#notify-updates');
      if (!toggleUpdates) return;

      const isUpdatesOn = await getSetting('notify_updates', true);
      toggleUpdates.checked = isUpdatesOn !== false;
      addTrackedListener(toggleUpdates, 'change', async () => {
        await setSetting('notify_updates', toggleUpdates.checked);
        showToast(toggleUpdates.checked
          ? 'Avisos de actualizaciones activados'
          : 'Avisos de actualizaciones desactivados');
      });
    },

    /**
     * SECTION 7: Privacy & Reset Logic
     */
    async initPrivacySection() {
      const btnClearHistory = $('#btn-clear-history');
      const btnClearSearch = $('#btn-clear-search-history');
      const btnClearLyrics = $('#btn-clear-lyrics-cache');
      const btnClearCache = $('#btn-clear-app-cache');
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

      if (btnClearLyrics) {
        addTrackedListener(btnClearLyrics, 'click', async () => {
          const ok = window.confirm('¿Borrar las letras guardadas? Se volverán a buscar cuando reproduzcas cada canción. Tus letras editadas se conservan.');
          if (!ok) return;
          btnClearLyrics.disabled = true;
          try {
            if (Sonora.Lyrics && typeof Sonora.Lyrics.clearCache === 'function') {
              await Sonora.Lyrics.clearCache();
            } else if (Sonora.DB && Sonora.DB.lyrics && typeof Sonora.DB.lyrics.clear === 'function') {
              await Sonora.DB.lyrics.clear();
            }
            showToast('Letras guardadas borradas');
          } catch (e) {
            console.error('[Settings] Error clearing lyrics cache', e);
            showToast('No se pudieron borrar las letras');
          } finally {
            btnClearLyrics.disabled = false;
          }
        });
      }

      if (btnClearCache) {
        addTrackedListener(btnClearCache, 'click', async () => {
          const ok = window.confirm('¿Limpiar la caché de la aplicación? No se borrarán tus canciones, playlists ni descargas.');
          if (!ok) return;
          btnClearCache.disabled = true;
          try {
            if (window.caches && typeof caches.keys === 'function') {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            }
            showToast('Caché de la aplicación limpiada');
          } catch (e) {
            console.error('[Settings] Error clearing app cache', e);
            showToast('No se pudo limpiar la caché');
          } finally {
            btnClearCache.disabled = false;
          }
        });
      }

      if (btnResetAll) {
        addTrackedListener(btnResetAll, 'click', async () => {
          const step1 = window.confirm('⚠️ ADVERTENCIA: ¿Estás seguro de que deseas restablecer TODOS los datos de Sonora Music?\nSe borrarán tus playlists, historial, descargas y configuraciones.');
          if (!step1) return;

          const step2 = window.confirm('⚠️ Confirmación final: ¿Realmente deseas restablecer la aplicación a su estado de fábrica?\n\nEsta acción no se puede deshacer.');
          if (!step2) return;

          btnResetAll.disabled = true;
          btnResetAll.textContent = 'Borrando…';

          try {
            // 1) Detener reproducción y liberar blobs/descargas en memoria.
            try { if (Sonora.Player && typeof Sonora.Player.stop === 'function') Sonora.Player.stop(); } catch (e) {}

            // 2) Cerrar la base y esperar a que IndexedDB la borre de verdad.
            //    Antes se llamaba deleteDatabase con la conexión abierta, así
            //    que el borrado quedaba bloqueado y parecía que el botón no hacía nada.
            if (Sonora.DB && typeof Sonora.DB.reset === 'function') {
              await Sonora.DB.reset();
            } else {
              await new Promise((resolve) => {
                const req = indexedDB.deleteDatabase('SonoraMusic');
                req.onsuccess = resolve;
                req.onerror = resolve;
                req.onblocked = resolve;
              });
            }

            // 3) Otras bases de Sonora que hayan podido quedar de versiones anteriores.
            if (window.indexedDB && typeof indexedDB.databases === 'function') {
              try {
                const dbs = await indexedDB.databases();
                for (const db of dbs) {
                  if (db.name && db.name.toLowerCase().includes('sonora') && db.name !== 'SonoraMusic') {
                    await new Promise((resolve) => {
                      const req = indexedDB.deleteDatabase(db.name);
                      req.onsuccess = resolve;
                      req.onerror = resolve;
                      req.onblocked = resolve;
                    });
                  }
                }
              } catch (e) {}
            }

            // 4) Preferencias y sesión.
            try { localStorage.clear(); } catch (e) {}
            try { sessionStorage.clear(); } catch (e) {}

            // 5) Caché del service worker (la app se quedaba con assets viejos).
            if (window.caches && typeof caches.keys === 'function') {
              try {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
              } catch (e) {}
            }
            if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
              try {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
              } catch (e) {}
            }

            alert('Sonora Music ha sido restablecida. La aplicación se recargará ahora.');
            setTimeout(() => {
              try { window.location.reload(); } catch (e) { window.location.href = window.location.pathname; }
            }, 250);
          } catch (err) {
            console.error('[Settings] Reset failed', err);
            btnResetAll.disabled = false;
            btnResetAll.textContent = '⚠️ Borrar todos los datos';
            alert('Se produjo un error al restablecer algunos datos. Cierra y vuelve a abrir la app e inténtalo de nuevo.');
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
      const btnCheckUpdates = $('#btn-check-updates');

      if (btnCheckUpdates) {
        addTrackedListener(btnCheckUpdates, 'click', async () => {
          btnCheckUpdates.disabled = true;
          btnCheckUpdates.textContent = '⏳ Comprobando...';
          try {
            if (Sonora.Updater && Sonora.Updater.check) {
              await Sonora.Updater.check(true);
            }
          } finally {
            btnCheckUpdates.disabled = false;
            btnCheckUpdates.textContent = '🔄 Buscar actualizaciones';
          }
        });
      }

      // Los enlaces de "Acerca de" apuntan a URLs reales (GitHub, web y
      // sugerencias). Antes eran botones que solo mostraban un toast falso.
      if (linkWeb && !linkWeb.getAttribute('href')) {
        linkWeb.setAttribute('href', 'https://sonora-music-b1ee.onrender.com');
      }
      if (linkFb && !linkFb.getAttribute('href')) {
        linkFb.setAttribute('href', 'https://github.com/raykozabala/sonora-music-server/issues');
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
