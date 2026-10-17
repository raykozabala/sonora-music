/**
 * Sonora Music — Profile Page Module
 * User profile, listening stats, top 3 podium, recent history, and shared playlists.
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

  // Format relative timestamp in Spanish
  function formatRelativeTime(dateInput) {
    if (!dateInput) return 'Reciente';
    try {
      const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
      const now = new Date();
      const diffSec = Math.floor((now - date) / 1000);
      if (isNaN(diffSec) || diffSec < 0) return 'Reciente';
      if (diffSec < 60) return 'Hace un momento';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `Hace ${diffMin} min`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `Hace ${diffHours} h`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return 'Ayer';
      if (diffDays < 7) return `Hace ${diffDays} días`;
      return date.toLocaleDateString();
    } catch (e) {
      return 'Reciente';
    }
  }

  // Format hours and minutes for total listening time
  function formatListeningTime(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return '0 min';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes} min`;
  }

  // Active event listeners cleanup list
  let _listeners = [];
  function addTrackedListener(el, event, handler, options) {
    if (!el) return;
    try {
      el.addEventListener(event, handler, options);
      _listeners.push({ el, event, handler, options });
    } catch (e) {
      console.warn('[Profile] Error attaching listener', e);
    }
  }

  function showToast(message, type) {
    try {
      let toast = $('#sonora-profile-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sonora-profile-toast';
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

  // DB Settings helper
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

  const Profile = {
    /**
     * Render Profile page skeleton and styles
     */
    render() {
      return `
        <div class="page page-profile" id="sonora-profile-root">
          <style id="sonora-profile-styles">
            .page-profile {
              padding: 16px 16px 90px 16px;
              color: var(--color-text-primary, #ffffff);
              min-height: 100vh;
              box-sizing: border-box;
              max-width: 900px;
              margin: 0 auto;
            }
            /* Header section */
            .profile-header-card {
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              background: linear-gradient(180deg, var(--color-surface, #1a1a2e) 0%, rgba(26,26,46,0.5) 100%);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: var(--radius-xl, 24px);
              padding: 28px 20px 22px 20px;
              margin-bottom: 24px;
              position: relative;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
            }
            .profile-avatar-container {
              position: relative;
              width: 104px;
              height: 104px;
              margin-bottom: 14px;
            }
            .profile-avatar-img {
              width: 100%;
              height: 100%;
              border-radius: 50%;
              object-fit: cover;
              box-shadow: 0 6px 20px rgba(var(--color-primary-rgb, 255, 71, 87), 0.35);
              border: 3px solid var(--color-surface-elevated, #22253d);
              background: linear-gradient(135deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
            }
            .profile-avatar-initials {
              width: 100%;
              height: 100%;
              border-radius: 50%;
              background: linear-gradient(135deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 34px;
              font-weight: 800;
              color: #ffffff;
              box-shadow: 0 6px 20px rgba(var(--color-primary-rgb, 255, 71, 87), 0.35);
              border: 3px solid var(--color-surface-elevated, #22253d);
            }
            .profile-avatar-edit-badge {
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: 32px;
              height: 32px;
              border-radius: 50%;
              background: var(--color-primary, #FF4757);
              color: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 14px;
              border: 2px solid var(--color-surface, #1a1a2e);
              cursor: pointer;
              box-shadow: 0 3px 8px rgba(0,0,0,0.3);
              transition: transform 0.15s ease;
            }
            .profile-avatar-edit-badge:active {
              transform: scale(0.9);
            }
            .profile-username {
              font-size: 22px;
              font-weight: 800;
              margin: 0 0 6px 0;
              color: var(--color-text-primary, #ffffff);
            }
            .profile-bio {
              font-size: 13px;
              color: var(--color-text-secondary, #A0A5BA);
              max-width: 440px;
              margin: 0 0 16px 0;
              line-height: 1.45;
            }
            .btn-edit-profile {
              background: var(--color-card-bg, rgba(255, 255, 255, 0.08));
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.12));
              color: var(--color-text-primary, #ffffff);
              padding: 8px 18px;
              border-radius: 20px;
              font-size: 13px;
              font-weight: 600;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              cursor: pointer;
              transition: background 0.15s ease, transform 0.15s ease;
            }
            .btn-edit-profile:active {
              transform: scale(0.96);
            }
            /* Stats Grid */
            .profile-stats-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              margin-bottom: 28px;
            }
            @media (min-width: 600px) {
              .profile-stats-grid {
                grid-template-columns: repeat(4, 1fr);
                gap: 16px;
              }
            }
            .stat-card {
              background: linear-gradient(135deg, rgba(255, 71, 87, 0.12) 0%, rgba(255, 107, 53, 0.06) 100%);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: var(--radius-md, 16px);
              padding: 16px 14px;
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              backdrop-filter: blur(8px);
              position: relative;
              overflow: hidden;
            }
            .stat-card::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 3px;
              background: linear-gradient(90deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
            }
            .stat-card__number {
              font-size: 24px;
              font-weight: 800;
              color: var(--color-text-primary, #ffffff);
              margin-bottom: 4px;
              line-height: 1.1;
            }
            .stat-card__label {
              font-size: 11px;
              font-weight: 600;
              color: var(--color-text-secondary, #A0A5BA);
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            /* Section Titles */
            .profile-section-title {
              font-size: 18px;
              font-weight: 800;
              margin: 0 0 14px 0;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .profile-section-title span.badge {
              font-size: 11px;
              font-weight: 700;
              background: rgba(255, 71, 87, 0.15);
              color: var(--color-primary, #FF4757);
              padding: 2px 8px;
              border-radius: 12px;
            }
            /* Top 3 Podium */
            .podium-container {
              display: flex;
              align-items: flex-end;
              justify-content: center;
              gap: 8px;
              padding: 20px 10px 10px 10px;
              margin-bottom: 30px;
              background: var(--color-surface, #1a1a2e);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: var(--radius-xl, 24px);
              position: relative;
              overflow: hidden;
            }
            .podium-column {
              flex: 1;
              max-width: 130px;
              display: flex;
              flex-direction: column;
              align-items: center;
              cursor: pointer;
              transition: transform 0.2s ease;
            }
            .podium-column:active {
              transform: scale(0.96);
            }
            .podium-artwork-wrap {
              position: relative;
              width: 72px;
              height: 72px;
              margin-bottom: 8px;
            }
            .podium-artwork-wrap.rank-1 {
              width: 88px;
              height: 88px;
            }
            .podium-artwork {
              width: 100%;
              height: 100%;
              border-radius: 14px;
              object-fit: cover;
              box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
            }
            .podium-medal {
              position: absolute;
              bottom: -6px;
              right: -6px;
              width: 26px;
              height: 26px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 12px;
              font-weight: 800;
              color: #ffffff;
              box-shadow: 0 3px 8px rgba(0,0,0,0.3);
            }
            .medal-gold {
              background: linear-gradient(135deg, #FFD700, #FFA000);
              color: #000;
            }
            .medal-silver {
              background: linear-gradient(135deg, #E0E0E0, #9E9E9E);
              color: #000;
            }
            .medal-bronze {
              background: linear-gradient(135deg, #CD7F32, #8D4004);
              color: #fff;
            }
            .podium-info {
              text-align: center;
              margin-bottom: 8px;
              width: 100%;
            }
            .podium-track-title {
              font-size: 12px;
              font-weight: 700;
              color: var(--color-text-primary, #ffffff);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              display: block;
            }
            .podium-track-artist {
              font-size: 11px;
              color: var(--color-text-secondary, #A0A5BA);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              display: block;
            }
            .podium-playcount {
              display: inline-block;
              font-size: 10px;
              font-weight: 700;
              color: var(--color-primary, #FF4757);
              background: rgba(255, 71, 87, 0.12);
              padding: 2px 6px;
              border-radius: 10px;
              margin-top: 2px;
            }
            .podium-pillar {
              width: 100%;
              border-radius: 12px 12px 4px 4px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 20px;
              font-weight: 900;
            }
            .pillar-1 {
              height: 90px;
              background: linear-gradient(180deg, rgba(255, 215, 0, 0.3) 0%, rgba(255, 215, 0, 0.08) 100%);
              border-top: 3px solid #FFD700;
              color: #FFD700;
            }
            .pillar-2 {
              height: 65px;
              background: linear-gradient(180deg, rgba(224, 224, 224, 0.25) 0%, rgba(224, 224, 224, 0.06) 100%);
              border-top: 3px solid #E0E0E0;
              color: #E0E0E0;
            }
            .pillar-3 {
              height: 50px;
              background: linear-gradient(180deg, rgba(205, 127, 50, 0.25) 0%, rgba(205, 127, 50, 0.06) 100%);
              border-top: 3px solid #CD7F32;
              color: #CD7F32;
            }
            /* History Section */
            .history-list {
              display: flex;
              flex-direction: column;
              gap: 8px;
              margin-bottom: 30px;
            }
            .history-item {
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 8px 12px;
              background: var(--color-surface, #1a1a2e);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.06));
              border-radius: var(--radius-sm, 12px);
              cursor: pointer;
              transition: background 0.15s ease, transform 0.15s ease;
            }
            .history-item:active {
              transform: scale(0.98);
            }
            .history-item:hover {
              background: var(--color-card-bg, rgba(255, 255, 255, 0.08));
            }
            .history-cover {
              width: 44px;
              height: 44px;
              border-radius: 8px;
              object-fit: cover;
              flex-shrink: 0;
              background: var(--color-surface-elevated, #22253d);
            }
            .history-info {
              flex: 1;
              min-width: 0;
            }
            .history-title {
              font-size: 14px;
              font-weight: 600;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .history-artist {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .history-time {
              font-size: 11px;
              color: var(--color-text-disabled, #7d849b);
              flex-shrink: 0;
            }
            /* Shared Playlists */
            .shared-playlists-grid {
              display: grid;
              grid-template-columns: 1fr;
              gap: 12px;
              margin-bottom: 24px;
            }
            @media (min-width: 600px) {
              .shared-playlists-grid {
                grid-template-columns: repeat(2, 1fr);
                gap: 14px;
              }
            }
            .shared-playlist-card {
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 12px;
              background: var(--color-surface, #1a1a2e);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: var(--radius-md, 14px);
              cursor: pointer;
              transition: transform 0.15s ease, border-color 0.15s ease;
            }
            .shared-playlist-card:hover {
              border-color: rgba(var(--color-primary-rgb, 255, 71, 87), 0.5);
            }
            .shared-playlist-cover {
              width: 54px;
              height: 54px;
              border-radius: 10px;
              object-fit: cover;
              flex-shrink: 0;
            }
            .shared-playlist-info {
              flex: 1;
              min-width: 0;
            }
            .shared-playlist-name {
              font-size: 14px;
              font-weight: 700;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .shared-playlist-meta {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
              margin-bottom: 4px;
            }
            .shared-code-tag {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px dashed rgba(255, 255, 255, 0.2);
              padding: 2px 8px;
              border-radius: 6px;
              font-size: 11px;
              font-family: monospace;
              color: var(--color-primary, #FF4757);
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

          <!-- Profile Header -->
          <div class="profile-header-card">
            <div class="profile-avatar-container" id="profile-avatar-wrapper">
              <div class="profile-avatar-initials" id="profile-initials">SM</div>
              <div class="profile-avatar-edit-badge" id="btn-avatar-badge" title="Cambiar avatar">📷</div>
            </div>
            <h1 class="profile-username" id="profile-username-text">Cargando...</h1>
            <p class="profile-bio" id="profile-bio-text"></p>
            <button class="btn-edit-profile" id="btn-open-edit-profile">
              ✏️ Editar perfil
            </button>
          </div>

          <!-- Stats 2x2 Grid -->
          <div class="profile-stats-grid">
            <div class="stat-card">
              <span class="stat-card__number" id="stat-tracks-listened">0</span>
              <span class="stat-card__label">Canciones Escuchadas</span>
            </div>
            <div class="stat-card">
              <span class="stat-card__number" id="stat-listening-time">0 min</span>
              <span class="stat-card__label">Tiempo Total</span>
            </div>
            <div class="stat-card">
              <span class="stat-card__number" id="stat-favorites-count">0</span>
              <span class="stat-card__label">Favoritas</span>
            </div>
            <div class="stat-card">
              <span class="stat-card__number" id="stat-playlists-count">0</span>
              <span class="stat-card__label">Playlists</span>
            </div>
          </div>

          <!-- Top 3 Most Played Podium -->
          <div class="profile-section">
            <h2 class="profile-section-title">
              🏆 Top 3 Más Escuchadas
              <span class="badge">Favoritas del mes</span>
            </h2>
            <div class="podium-container" id="profile-podium">
              <!-- Rendered via JS -->
              <div style="padding:30px;text-align:center;color:var(--color-text-secondary);width:100%;">
                Cargando podium...
              </div>
            </div>
          </div>

          <!-- Historial Reciente -->
          <div class="profile-section">
            <h2 class="profile-section-title">
              🕒 Historial Reciente
              <span class="badge" id="history-badge">Últimas 20</span>
            </h2>
            <div class="history-list" id="profile-history-list">
              <div style="padding:20px;text-align:center;color:var(--color-text-secondary);">
                Cargando historial...
              </div>
            </div>
          </div>

          <!-- Mis Listas Compartidas -->
          <div class="profile-section">
            <h2 class="profile-section-title">
              👥 Mis Listas Compartidas
            </h2>
            <div class="shared-playlists-grid" id="profile-shared-playlists">
              <div style="padding:20px;text-align:center;color:var(--color-text-secondary);">
                Cargando listas colaborativas...
              </div>
            </div>
          </div>

          <!-- Edit Profile Modal -->
          <div class="sonora-modal-overlay" id="modal-edit-profile">
            <div class="sonora-modal-card">
              <div class="modal-header">
                <h3>Editar Perfil</h3>
                <button class="btn-close-modal" id="btn-close-profile-modal">&times;</button>
              </div>
              <div class="modal-body">
                <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:10px;">
                  <div style="width:80px;height:80px;position:relative;border-radius:50%;overflow:hidden;background:#22253d;margin-bottom:8px;">
                    <img id="edit-avatar-preview" src="" alt="Avatar" style="width:100%;height:100%;object-fit:cover;display:none;" />
                    <div id="edit-avatar-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:bold;color:#fff;background:linear-gradient(135deg, var(--color-primary), var(--color-secondary));">SM</div>
                  </div>
                  <label for="profile-avatar-file" class="btn-action btn-action--secondary" style="font-size:12px;padding:6px 12px;cursor:pointer;">
                    📁 Cambiar foto
                  </label>
                  <input type="file" id="profile-avatar-file" accept="image/*" style="display:none;" />
                </div>

                <div class="form-group">
                  <label for="edit-profile-name">Nombre de usuario</label>
                  <input type="text" id="edit-profile-name" class="form-input" placeholder="Tu nombre o apodo" />
                </div>
                <div class="form-group">
                  <label for="edit-profile-bio">Biografía</label>
                  <textarea id="edit-profile-bio" class="form-textarea" rows="3" placeholder="Cuéntale a todos sobre tu gusto musical..."></textarea>
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn-action btn-action--secondary" id="btn-cancel-profile">Cancelar</button>
                <button class="btn-action btn-action--primary" id="btn-save-profile">Guardar cambios</button>
              </div>
            </div>
          </div>
        </div>
      `;
    },

    /**
     * Initialize profile page data and bindings
     */
    async init() {
      this.destroy();

      try {
        await Promise.all([
          this.loadProfileHeader(),
          this.loadStats(),
          this.loadTop3Podium(),
          this.loadRecentHistory(),
          this.loadSharedPlaylists()
        ]);
        this.bindEvents();
      } catch (err) {
        console.error('[Profile] Error during init:', err);
      }
    },

    /**
     * Load header info (username, bio, avatar)
     */
    async loadProfileHeader() {
      const username = await getSetting('profile_name', 'Usuario Sonora');
      const bio = await getSetting('profile_bio', 'Amante de la buena música • Sonora Music Lover');
      const avatarUrl = await getSetting('profile_avatar', null);

      const nameEl = $('#profile-username-text');
      const bioEl = $('#profile-bio-text');
      const avatarContainer = $('#profile-avatar-wrapper');

      if (nameEl) nameEl.textContent = username;
      if (bioEl) bioEl.textContent = bio;

      if (avatarContainer) {
        if (avatarUrl) {
          avatarContainer.innerHTML = `
            <img src="${escapeHtml(avatarUrl)}" class="profile-avatar-img" alt="Avatar" />
            <div class="profile-avatar-edit-badge" id="btn-avatar-badge" title="Cambiar avatar">📷</div>
          `;
        } else {
          const initials = (username || 'SM')
            .split(' ')
            .map(w => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase() || 'SM';
          avatarContainer.innerHTML = `
            <div class="profile-avatar-initials" id="profile-initials">${escapeHtml(initials)}</div>
            <div class="profile-avatar-edit-badge" id="btn-avatar-badge" title="Cambiar avatar">📷</div>
          `;
        }
      }
    },

    /**
     * Load stats 2x2 grid
     */
    async loadStats() {
      let historyItems = [];
      let favCount = 0;
      let playlistCount = 0;

      try {
        if (Sonora.DB && Sonora.DB.history && typeof Sonora.DB.history.getRecent === 'function') {
          historyItems = (await Sonora.DB.history.getRecent(1000)) || [];
        } else if (Sonora.DB && Sonora.DB.history && typeof Sonora.DB.history.getAll === 'function') {
          historyItems = (await Sonora.DB.history.getAll()) || [];
        }
      } catch (e) {}

      try {
        if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.getFavorites === 'function') {
          const favs = await Sonora.DB.tracks.getFavorites();
          favCount = (favs || []).length;
        } else if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.getAll === 'function') {
          const all = await Sonora.DB.tracks.getAll();
          favCount = (all || []).filter(t => t.isFavorite).length;
        }
      } catch (e) {}

      try {
        if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.getAll === 'function') {
          const pls = await Sonora.DB.playlists.getAll();
          playlistCount = (pls || []).length;
        }
      } catch (e) {}

      // Calculate total listening time
      let totalSeconds = 0;
      historyItems.forEach(item => {
        const dur = (item.track && item.track.duration) || item.duration || 0;
        totalSeconds += dur;
      });

      const tracksEl = $('#stat-tracks-listened');
      const timeEl = $('#stat-listening-time');
      const favsEl = $('#stat-favorites-count');
      const plsEl = $('#stat-playlists-count');

      if (tracksEl) tracksEl.textContent = historyItems.length;
      if (timeEl) timeEl.textContent = formatListeningTime(totalSeconds);
      if (favsEl) favsEl.textContent = favCount;
      if (plsEl) plsEl.textContent = playlistCount;
    },

    /**
     * Load Top 3 Most Played podium
     */
    async loadTop3Podium() {
      const podiumEl = $('#profile-podium');
      if (!podiumEl) return;

      let topTracks = [];
      try {
        if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.getMostPlayed === 'function') {
          topTracks = (await Sonora.DB.tracks.getMostPlayed(3)) || [];
        }
      } catch (e) {
        console.warn('[Profile] Error calling getMostPlayed', e);
      }

      // Fallback: If empty, try getting tracks with playCount from tracks.getAll()
      if (topTracks.length === 0 && Sonora.DB && Sonora.DB.tracks) {
        try {
          const all = (await Sonora.DB.tracks.getAll()) || [];
          topTracks = all
            .filter(t => (t.playCount || 0) > 0)
            .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
            .slice(0, 3);
        } catch (e) {}
      }

      if (topTracks.length === 0) {
        podiumEl.innerHTML = `
          <div style="padding:24px 10px;text-align:center;width:100%;color:var(--color-text-secondary);">
            <div style="font-size:32px;margin-bottom:6px;">🎵</div>
            <div style="font-size:14px;font-weight:700;color:var(--color-text-primary);">Aún no tienes canciones más reproducidas</div>
            <div style="font-size:12px;margin-top:4px;">¡Escucha música para ver tu podium aquí!</div>
          </div>
        `;
        return;
      }

      // Reorder for podium presentation: [2nd, 1st, 3rd]
      const first = topTracks[0];
      const second = topTracks[1] || null;
      const third = topTracks[2] || null;

      const renderPodiumSpot = (track, rank, pillarClass, medalClass, isRank1) => {
        if (!track) {
          return `
            <div class="podium-column" style="opacity:0.4;">
              <div class="podium-artwork-wrap ${isRank1 ? 'rank-1' : ''}">
                <div class="podium-artwork" style="background:var(--color-surface-elevated);display:flex;align-items:center;justify-content:center;">-</div>
              </div>
              <div class="podium-info">
                <span class="podium-track-title">-</span>
              </div>
              <div class="podium-pillar ${pillarClass}">${rank}</div>
            </div>
          `;
        }

        const artwork = track.artworkUrl || generateArtwork(track.id, track.title);
        const playCount = track.playCount || 1;

        return `
          <div class="podium-column" data-track-id="${escapeHtml(track.id)}" title="Reproducir ${escapeHtml(track.title)}">
            <div class="podium-artwork-wrap ${isRank1 ? 'rank-1' : ''}">
              <img src="${artwork}" class="podium-artwork" alt="" loading="lazy" />
              <div class="podium-medal ${medalClass}">${rank === 1 ? '👑' : rank}</div>
            </div>
            <div class="podium-info">
              <span class="podium-track-title">${escapeHtml(track.title || 'Pista')}</span>
              <span class="podium-track-artist">${escapeHtml(track.artist || 'Artista')}</span>
              <span class="podium-playcount">🔥 ${playCount} reps</span>
            </div>
            <div class="podium-pillar ${pillarClass}">${rank}</div>
          </div>
        `;
      };

      podiumEl.innerHTML = `
        ${renderPodiumSpot(second, 2, 'pillar-2', 'medal-silver', false)}
        ${renderPodiumSpot(first, 1, 'pillar-1', 'medal-gold', true)}
        ${renderPodiumSpot(third, 3, 'pillar-3', 'medal-bronze', false)}
      `;

      // Bind click on podium columns to play
      $$('.podium-column', podiumEl).forEach(col => {
        addTrackedListener(col, 'click', () => {
          const trackId = col.getAttribute('data-track-id');
          if (!trackId) return;
          const clickedTrack = topTracks.find(t => t && t.id === trackId);
          if (clickedTrack && Sonora.Player && typeof Sonora.Player.play === 'function') {
            Sonora.Player.play(clickedTrack);
            showToast(`Reproduciendo: ${clickedTrack.title}`);
          }
        });
      });
    },

    /**
     * Load recent history list (last 20 tracks)
     */
    async loadRecentHistory() {
      const historyListEl = $('#profile-history-list');
      if (!historyListEl) return;

      let historyItems = [];
      try {
        if (Sonora.DB && Sonora.DB.history && typeof Sonora.DB.history.getRecent === 'function') {
          historyItems = (await Sonora.DB.history.getRecent(20)) || [];
        }
      } catch (e) {
        console.warn('[Profile] Error getting history', e);
      }

      if (historyItems.length === 0) {
        historyListEl.innerHTML = `
          <div style="padding:24px 10px;text-align:center;color:var(--color-text-secondary);">
            <div style="font-size:26px;margin-bottom:6px;">🕒</div>
            <div style="font-size:13px;">No hay historial de reproducción reciente</div>
          </div>
        `;
        return;
      }

      historyListEl.innerHTML = historyItems.map(item => {
        const track = item.track || item;
        const artwork = track.artworkUrl || generateArtwork(track.id, track.title);
        const playedAtStr = formatRelativeTime(item.timestamp || item.lastPlayed || item.playedAt);

        return `
          <div class="history-item" data-track-id="${escapeHtml(track.id)}">
            <img src="${artwork}" class="history-cover" alt="" loading="lazy" />
            <div class="history-info">
              <div class="history-title">${escapeHtml(track.title || 'Canción')}</div>
              <div class="history-artist">${escapeHtml(track.artist || 'Artista')} • ${formatTime(track.duration || 0)}</div>
            </div>
            <span class="history-time">${escapeHtml(playedAtStr)}</span>
          </div>
        `;
      }).join('');

      // Bind click to play
      $$('.history-item', historyListEl).forEach((el, idx) => {
        addTrackedListener(el, 'click', () => {
          const item = historyItems[idx];
          const track = item.track || item;
          if (track && Sonora.Player && typeof Sonora.Player.play === 'function') {
            Sonora.Player.play(track);
            showToast(`Reproduciendo: ${track.title}`);
          }
        });
      });
    },

    /**
     * Load shared / collaborative playlists
     */
    async loadSharedPlaylists() {
      const sharedContainer = $('#profile-shared-playlists');
      if (!sharedContainer) return;

      let playlists = [];
      try {
        if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.getAll === 'function') {
          playlists = (await Sonora.DB.playlists.getAll()) || [];
        }
      } catch (e) {}

      const shared = playlists.filter(p => p.isCollaborative);

      if (shared.length === 0) {
        sharedContainer.innerHTML = `
          <div style="padding:20px;text-align:center;color:var(--color-text-secondary);grid-column: 1 / -1;">
            <div style="font-size:26px;margin-bottom:6px;">👥</div>
            <div style="font-size:13px;">No tienes playlists compartidas activas</div>
            <p style="font-size:12px;margin:4px 0 0 0;">Crea una playlist colaborativa para escuchar y compartir con amigos.</p>
          </div>
        `;
        return;
      }

      sharedContainer.innerHTML = shared.map(p => {
        const artwork = p.artworkUrl || generateArtwork(p.id, p.name);
        const shareCode = `SONORA-${String(p.id).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;
        const trackCount = Array.isArray(p.trackIds) ? p.trackIds.length : 0;

        return `
          <div class="shared-playlist-card" data-playlist-id="${escapeHtml(p.id)}">
            <img src="${artwork}" class="shared-playlist-cover" alt="" loading="lazy" />
            <div class="shared-playlist-info">
              <div class="shared-playlist-name">${escapeHtml(p.name)}</div>
              <div class="shared-playlist-meta">${trackCount} canciones • 2 miembros</div>
              <div class="shared-code-tag" title="Toca para copiar código" data-code="${escapeHtml(shareCode)}">
                📋 ${escapeHtml(shareCode)}
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Bind clicks
      $$('.shared-playlist-card', sharedContainer).forEach(card => {
        addTrackedListener(card, 'click', (e) => {
          const codeTag = e.target.closest('.shared-code-tag');
          if (codeTag) {
            e.stopPropagation();
            const code = codeTag.getAttribute('data-code');
            if (navigator.clipboard) {
              navigator.clipboard.writeText(code).then(() => {
                showToast(`Código ${code} copiado al portapapeles`);
              }).catch(() => {
                showToast(`Código: ${code}`);
              });
            } else {
              showToast(`Código: ${code}`);
            }
            return;
          }

          const playlistId = card.getAttribute('data-playlist-id');
          if (playlistId && Sonora.Router && typeof Sonora.Router.navigate === 'function') {
            Sonora.Router.navigate('/playlists/' + playlistId);
          } else {
            window.location.hash = '#/playlists/' + playlistId;
          }
        });
      });
    },

    /**
     * Bind edit profile modal and actions
     */
    bindEvents() {
      const modal = $('#modal-edit-profile');
      const btnOpen = $('#btn-open-edit-profile');
      const btnBadge = $('#btn-avatar-badge');
      const btnClose = $('#btn-close-profile-modal');
      const btnCancel = $('#btn-cancel-profile');
      const btnSave = $('#btn-save-profile');
      const fileInput = $('#profile-avatar-file');
      const previewImg = $('#edit-avatar-preview');
      const previewPlaceholder = $('#edit-avatar-placeholder');

      let currentNewAvatarData = null;

      const openModal = async () => {
        if (!modal) return;
        const username = await getSetting('profile_name', 'Usuario Sonora');
        const bio = await getSetting('profile_bio', 'Amante de la buena música • Sonora Music Lover');
        const avatarUrl = await getSetting('profile_avatar', null);

        const nameIn = $('#edit-profile-name');
        const bioIn = $('#edit-profile-bio');
        if (nameIn) nameIn.value = username;
        if (bioIn) bioIn.value = bio;

        currentNewAvatarData = avatarUrl;
        if (avatarUrl) {
          if (previewImg) {
            previewImg.src = avatarUrl;
            previewImg.style.display = 'block';
          }
          if (previewPlaceholder) previewPlaceholder.style.display = 'none';
        } else {
          if (previewImg) previewImg.style.display = 'none';
          if (previewPlaceholder) {
            previewPlaceholder.style.display = 'flex';
            previewPlaceholder.textContent = (username || 'SM').substring(0, 2).toUpperCase();
          }
        }

        modal.classList.add('active');
        setTimeout(() => nameIn && nameIn.focus(), 150);
      };

      const closeModal = () => {
        if (modal) modal.classList.remove('active');
      };

      if (btnOpen) addTrackedListener(btnOpen, 'click', openModal);
      if (btnBadge) addTrackedListener(btnBadge, 'click', openModal);
      if (btnClose) addTrackedListener(btnClose, 'click', closeModal);
      if (btnCancel) addTrackedListener(btnCancel, 'click', closeModal);

      // Handle avatar file selection
      if (fileInput) {
        addTrackedListener(fileInput, 'change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;

          // Max 3MB
          if (file.size > 3 * 1024 * 1024) {
            showToast('La imagen debe pesar menos de 3MB', 'error');
            return;
          }

          const reader = new FileReader();
          reader.onload = (event) => {
            currentNewAvatarData = event.target.result;
            if (previewImg) {
              previewImg.src = currentNewAvatarData;
              previewImg.style.display = 'block';
            }
            if (previewPlaceholder) previewPlaceholder.style.display = 'none';
          };
          reader.readAsDataURL(file);
        });
      }

      // Save Profile
      if (btnSave) {
        addTrackedListener(btnSave, 'click', async () => {
          const nameIn = $('#edit-profile-name');
          const bioIn = $('#edit-profile-bio');
          const newName = nameIn ? nameIn.value.trim() : '';
          const newBio = bioIn ? bioIn.value.trim() : '';

          if (!newName) {
            showToast('El nombre no puede estar vacío', 'error');
            return;
          }

          try {
            await setSetting('profile_name', newName);
            await setSetting('profile_bio', newBio);
            if (currentNewAvatarData !== undefined) {
              await setSetting('profile_avatar', currentNewAvatarData);
            }
            showToast('Perfil actualizado correctamente');
            closeModal();
            await this.loadProfileHeader();
          } catch (err) {
            console.error('[Profile] Save failed:', err);
            showToast('Error al guardar perfil', 'error');
          }
        });
      }
    },

    /**
     * Cleanup listeners and modals
     */
    destroy() {
      _listeners.forEach(({ el, event, handler, options }) => {
        try {
          if (el) el.removeEventListener(event, handler, options);
        } catch (e) {}
      });
      _listeners = [];

      $$('.sonora-modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  };

  Sonora.Pages.Profile = Profile;
})();
