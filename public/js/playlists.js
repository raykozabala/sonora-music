/**
 * Sonora Music — Playlists Page Module
 * Full CRUD for playlists, track management, and touch drag-and-drop reordering.
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

  // Active event listener cleanup tracker
  let _listeners = [];
  function addTrackedListener(el, event, handler, options) {
    if (!el) return;
    try {
      el.addEventListener(event, handler, options);
      _listeners.push({ el, event, handler, options });
    } catch (e) {
      console.warn('[Playlists] Error attaching listener', e);
    }
  }

  // Toast notification
  function showToast(message, type) {
    try {
      let toast = $('#sonora-playlists-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sonora-playlists-toast';
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

  // Helper to extract playlist ID from router or window hash
  function getCurrentPlaylistId() {
    let id = null;
    try {
      if (Sonora.Router && typeof Sonora.Router.getParam === 'function') {
        id = Sonora.Router.getParam('id');
      }
    } catch (e) {}

    if (!id) {
      try {
        const hash = window.location.hash || '';
        const matchParam = hash.match(/\/playlists?\/([^\/?#]+)/);
        if (matchParam && matchParam[1]) {
          id = decodeURIComponent(matchParam[1]);
        } else {
          const matchQuery = hash.match(/[?&]id=([^&#]+)/);
          if (matchQuery && matchQuery[1]) {
            id = decodeURIComponent(matchQuery[1]);
          }
        }
      } catch (e) {}
    }
    return id;
  }

  // Helper to generate playlist mosaic or artwork HTML
  function renderMosaicHtml(tracks, playlist) {
    if (playlist.artworkUrl && playlist.artworkUrl.trim()) {
      return `<img src="${escapeHtml(playlist.artworkUrl)}" class="playlist-cover-img" alt="${escapeHtml(playlist.name)}" loading="lazy" />`;
    }
    const validTracksWithArt = (tracks || []).filter(t => t && t.artworkUrl);
    if (validTracksWithArt.length >= 4) {
      return `
        <div class="mosaic-grid">
          <img src="${escapeHtml(validTracksWithArt[0].artworkUrl)}" alt="" loading="lazy" />
          <img src="${escapeHtml(validTracksWithArt[1].artworkUrl)}" alt="" loading="lazy" />
          <img src="${escapeHtml(validTracksWithArt[2].artworkUrl)}" alt="" loading="lazy" />
          <img src="${escapeHtml(validTracksWithArt[3].artworkUrl)}" alt="" loading="lazy" />
        </div>
      `;
    } else if (validTracksWithArt.length > 0) {
      return `<img src="${escapeHtml(validTracksWithArt[0].artworkUrl)}" class="playlist-cover-img" alt="${escapeHtml(playlist.name)}" loading="lazy" />`;
    }
    return `<img src="${generateArtwork(playlist.id || 1, playlist.name)}" class="playlist-cover-img" alt="${escapeHtml(playlist.name)}" loading="lazy" />`;
  }

  // Playlists Module Implementation
  const Playlists = {
    /**
     * Render HTML string for the page
     */
    render() {
      const playlistId = getCurrentPlaylistId();
      return `
        <div class="page page-playlists ${playlistId ? 'playlist-detail-view' : 'playlists-main-view'}" id="sonora-playlists-root">
          <style id="sonora-playlists-styles">
            .page-playlists {
              padding: 16px 16px 90px 16px;
              color: var(--color-text-primary, #ffffff);
              min-height: 100vh;
              box-sizing: border-box;
            }
            .playlists-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 20px;
              gap: 12px;
            }
            .playlists-header__title {
              font-size: 24px;
              font-weight: 800;
              margin: 0;
              background: linear-gradient(135deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
            }
            .playlists-header__badge {
              font-size: 13px;
              color: var(--color-text-secondary, #A0A5BA);
              background: var(--color-card-bg, rgba(255,255,255,0.06));
              padding: 4px 10px;
              border-radius: 20px;
              border: 1px solid var(--color-card-border, rgba(255,255,255,0.08));
            }
            .playlists-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 14px;
            }
            @media (min-width: 768px) {
              .playlists-grid {
                grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                gap: 20px;
              }
            }
            .playlist-card {
              background: var(--color-surface, #1a1a2e);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: var(--radius-md, 14px);
              overflow: hidden;
              cursor: pointer;
              transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
              display: flex;
              flex-direction: column;
              position: relative;
            }
            .playlist-card:active {
              transform: scale(0.98);
            }
            .playlist-card:hover {
              border-color: rgba(var(--color-primary-rgb, 255, 71, 87), 0.5);
              box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
            }
            .playlist-card__artwork-wrapper {
              position: relative;
              width: 100%;
              padding-top: 100%;
              background: var(--color-surface-elevated, #22253d);
              overflow: hidden;
            }
            .playlist-card__artwork-inner {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
            }
            .playlist-card__artwork-inner img.playlist-cover-img {
              width: 100%;
              height: 100%;
              object-fit: cover;
              display: block;
            }
            .mosaic-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              grid-template-rows: 1fr 1fr;
              width: 100%;
              height: 100%;
            }
            .mosaic-grid img {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .playlist-card__badge-collab {
              position: absolute;
              top: 8px;
              right: 8px;
              background: rgba(0, 0, 0, 0.7);
              backdrop-filter: blur(8px);
              -webkit-backdrop-filter: blur(8px);
              color: var(--color-primary, #FF4757);
              padding: 3px 7px;
              border-radius: 8px;
              font-size: 11px;
              font-weight: 700;
              display: flex;
              align-items: center;
              gap: 4px;
              border: 1px solid rgba(255, 255, 255, 0.15);
            }
            .playlist-card__info {
              padding: 10px 12px;
              display: flex;
              flex-direction: column;
              gap: 3px;
            }
            .playlist-card__title {
              font-size: 14px;
              font-weight: 700;
              color: var(--color-text-primary, #ffffff);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .playlist-card__meta {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
            }
            /* Floating Action Button */
            .fab-create-playlist {
              position: fixed;
              bottom: calc(var(--bottom-nav-height, 64px) + 20px);
              right: 20px;
              width: 56px;
              height: 56px;
              border-radius: 50%;
              background: linear-gradient(135deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
              color: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 28px;
              border: none;
              box-shadow: 0 6px 22px rgba(var(--color-primary-rgb, 255, 71, 87), 0.45);
              cursor: pointer;
              z-index: 80;
              transition: transform 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28), box-shadow 0.2s ease;
            }
            .fab-create-playlist:active {
              transform: scale(0.92);
            }
            /* Playlist Detail Styles */
            .detail-nav {
              display: flex;
              align-items: center;
              gap: 12px;
              margin-bottom: 16px;
            }
            .btn-back {
              background: var(--color-surface, #1a1a2e);
              border: 1px solid var(--color-card-border, rgba(255,255,255,0.1));
              color: var(--color-text-primary, #ffffff);
              width: 40px;
              height: 40px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 18px;
              cursor: pointer;
            }
            .detail-header {
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              gap: 14px;
              margin-bottom: 24px;
            }
            @media (min-width: 600px) {
              .detail-header {
                flex-direction: row;
                text-align: left;
                align-items: flex-end;
              }
            }
            .detail-cover {
              width: 170px;
              height: 170px;
              border-radius: var(--radius-lg, 16px);
              overflow: hidden;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
              background: var(--color-surface-elevated, #22253d);
              flex-shrink: 0;
              position: relative;
            }
            .detail-cover img {
              width: 100%;
              height: 100%;
              object-fit: cover;
              display: block;
            }
            .detail-meta-block {
              display: flex;
              flex-direction: column;
              gap: 6px;
              width: 100%;
            }
            .detail-title {
              font-size: 22px;
              font-weight: 800;
              margin: 0;
              color: var(--color-text-primary, #ffffff);
            }
            .detail-desc {
              font-size: 13px;
              color: var(--color-text-secondary, #A0A5BA);
              margin: 0;
              line-height: 1.4;
            }
            .detail-stats {
              font-size: 12px;
              color: var(--color-text-disabled, #7d849b);
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              flex-wrap: wrap;
            }
            @media (min-width: 600px) {
              .detail-stats {
                justify-content: flex-start;
              }
            }
            /* Lark Player Action Pills */
            .lark-action-pills {
              display: flex;
              gap: 12px;
              margin: 18px 0 16px;
              width: 100%;
            }
            .lark-pill-btn {
              flex: 1;
              height: 48px;
              border-radius: 24px;
              background: #1e202f;
              border: 1px solid rgba(255, 255, 255, 0.08);
              color: #4fc3f7;
              font-size: 15px;
              font-weight: 700;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              cursor: pointer;
              transition: transform 0.15s ease, background 0.15s ease;
            }
            .lark-pill-btn:active {
              transform: scale(0.97);
              background: #25283c;
            }
            .badge-letras {
              display: inline-block;
              font-size: 9px;
              font-weight: 800;
              letter-spacing: 0.5px;
              color: #b0b5c8;
              border: 1px solid rgba(255, 255, 255, 0.35);
              padding: 1px 4px;
              border-radius: 4px;
              line-height: 1;
              flex-shrink: 0;
            }
            /* Action Buttons */
            .detail-actions {
              display: flex;
              align-items: center;
              gap: 8px;
              flex-wrap: wrap;
              margin-bottom: 20px;
            }
            .btn-action {
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
            .btn-action:active {
              transform: scale(0.96);
            }
            .btn-action--primary {
              background: linear-gradient(135deg, var(--color-primary, #FF4757), var(--color-secondary, #FF6B35));
              color: #ffffff;
              box-shadow: 0 4px 14px rgba(var(--color-primary-rgb, 255, 71, 87), 0.35);
            }
            .btn-action--secondary {
              background: var(--color-card-bg, rgba(255, 255, 255, 0.08));
              color: var(--color-text-primary, #ffffff);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.1));
            }
            .btn-action--danger {
              background: rgba(255, 71, 87, 0.15);
              color: #FF5252;
              border: 1px solid rgba(255, 82, 82, 0.3);
            }
            /* Track List */
            .tracklist-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 12px;
            }
            .tracklist-title {
              font-size: 16px;
              font-weight: 700;
              margin: 0;
            }
            .playlist-tracks-container {
              display: flex;
              flex-direction: column;
              gap: 6px;
            }
            .playlist-track-item {
              display: flex;
              align-items: center;
              gap: 10px;
              padding: 8px 10px;
              border-radius: var(--radius-sm, 10px);
              background: var(--color-card-bg, rgba(255, 255, 255, 0.03));
              border: 1px solid transparent;
              transition: background 0.15s ease, transform 0.15s ease;
              user-select: none;
              -webkit-user-select: none;
              touch-action: pan-y;
            }
            .playlist-track-item:hover {
              background: var(--color-card-bg, rgba(255, 255, 255, 0.07));
            }
            .playlist-track-item.is-dragging {
              opacity: 0.5;
              border-color: var(--color-primary, #FF4757);
              transform: scale(0.98);
              background: var(--color-surface-elevated, #22253d);
            }
            .drag-handle {
              cursor: grab;
              color: var(--color-text-disabled, #7d849b);
              padding: 6px;
              font-size: 18px;
              line-height: 1;
              touch-action: none;
            }
            .drag-handle:active {
              cursor: grabbing;
              color: var(--color-primary, #FF4757);
            }
            .track-cover-thumb {
              width: 44px;
              height: 44px;
              border-radius: 6px;
              object-fit: cover;
              flex-shrink: 0;
              background: var(--color-surface-elevated, #22253d);
            }
            .track-info-col {
              flex: 1;
              min-width: 0;
              display: flex;
              flex-direction: column;
              gap: 2px;
            }
            .track-title {
              font-size: 14px;
              font-weight: 600;
              color: var(--color-text-primary, #ffffff);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .track-artist {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .track-duration {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
              font-variant-numeric: tabular-nums;
            }
            .btn-remove-track {
              background: none;
              border: none;
              color: var(--color-text-disabled, #7d849b);
              width: 32px;
              height: 32px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 16px;
              cursor: pointer;
              transition: color 0.15s ease, background 0.15s ease;
            }
            .btn-remove-track:hover {
              color: #FF5252;
              background: rgba(255, 82, 82, 0.15);
            }
            /* Modals */
            .sonora-modal-overlay {
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: rgba(0, 0, 0, 0.75);
              backdrop-filter: blur(8px);
              -webkit-backdrop-filter: blur(8px);
              display: flex;
              align-items: flex-end;
              justify-content: center;
              z-index: 1000;
              opacity: 0;
              pointer-events: none;
              transition: opacity 0.25s ease;
            }
            @media (min-width: 600px) {
              .sonora-modal-overlay {
                align-items: center;
              }
            }
            .sonora-modal-overlay.active {
              opacity: 1;
              pointer-events: auto;
            }
            .sonora-modal-card {
              background: var(--color-surface, #1a1a2e);
              width: 100%;
              max-width: 520px;
              max-height: 85vh;
              border-radius: 20px 20px 0 0;
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.12));
              display: flex;
              flex-direction: column;
              overflow: hidden;
              transform: translateY(30px);
              transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            @media (min-width: 600px) {
              .sonora-modal-card {
                border-radius: 20px;
                transform: translateY(0) scale(0.95);
              }
            }
            .sonora-modal-overlay.active .sonora-modal-card {
              transform: translateY(0) scale(1);
            }
            .modal-header {
              padding: 16px 20px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              border-bottom: 1px solid var(--color-divider, rgba(255,255,255,0.08));
            }
            .modal-header h3 {
              margin: 0;
              font-size: 18px;
              font-weight: 700;
            }
            .btn-close-modal {
              background: none;
              border: none;
              font-size: 20px;
              color: var(--color-text-secondary, #A0A5BA);
              cursor: pointer;
            }
            .modal-body {
              padding: 20px;
              overflow-y: auto;
              display: flex;
              flex-direction: column;
              gap: 16px;
            }
            .form-group {
              display: flex;
              flex-direction: column;
              gap: 6px;
            }
            .form-group label {
              font-size: 13px;
              font-weight: 600;
              color: var(--color-text-secondary, #A0A5BA);
            }
            .form-input, .form-textarea {
              background: var(--color-surface-elevated, #22253d);
              border: 1px solid var(--color-card-border, rgba(255,255,255,0.1));
              color: var(--color-text-primary, #ffffff);
              padding: 12px 14px;
              border-radius: var(--radius-sm, 10px);
              font-size: 14px;
              outline: none;
              box-sizing: border-box;
              font-family: inherit;
            }
            .form-input:focus, .form-textarea:focus {
              border-color: var(--color-primary, #FF4757);
            }
            .toggle-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
            }
            .toggle-label {
              display: flex;
              flex-direction: column;
            }
            .toggle-title {
              font-size: 14px;
              font-weight: 600;
            }
            .toggle-desc {
              font-size: 12px;
              color: var(--color-text-secondary, #A0A5BA);
            }
            /* Switch toggle */
            .switch {
              position: relative;
              display: inline-block;
              width: 48px;
              height: 26px;
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
              background-color: var(--color-surface-elevated, #333a56);
              transition: .3s;
              border-radius: 26px;
            }
            .slider:before {
              position: absolute;
              content: "";
              height: 20px;
              width: 20px;
              left: 3px;
              bottom: 3px;
              background-color: white;
              transition: .3s;
              border-radius: 50%;
            }
            input:checked + .slider {
              background-color: var(--color-primary, #FF4757);
            }
            input:checked + .slider:before {
              transform: translateX(22px);
            }
            .modal-footer {
              padding: 14px 20px;
              display: flex;
              align-items: center;
              justify-content: flex-end;
              gap: 10px;
              border-top: 1px solid var(--color-divider, rgba(255,255,255,0.08));
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
            /* Empty state */
            .empty-state {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              padding: 48px 20px;
              color: var(--color-text-secondary, #A0A5BA);
              gap: 12px;
            }
            .empty-state__icon {
              font-size: 44px;
              opacity: 0.6;
            }
            .empty-state__title {
              font-size: 16px;
              font-weight: 700;
              color: var(--color-text-primary, #ffffff);
              margin: 0;
            }
          </style>

          ${playlistId ? this.renderDetailShell(playlistId) : this.renderMainShell()}
        </div>
      `;
    },

    renderMainShell() {
      return `
        <div class="playlists-main-container">
          <header class="playlists-header" style="flex-wrap: wrap; gap: 10px;">
            <div>
              <h1 class="playlists-header__title">Mis Playlists</h1>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <button id="btn-collab-guide" class="btn-action btn-action--secondary" style="padding: 6px 12px; font-size: 12px; border-radius: 16px;">
                ℹ️ ¿Cómo funciona?
              </button>
              <button id="btn-open-join-code" class="btn-action btn-action--secondary" style="padding: 6px 12px; font-size: 12px; border-radius: 16px;">
                👥 Unirse con código
              </button>
              <span class="playlists-header__badge" id="playlists-count-badge">0 playlists</span>
            </div>
          </header>

          <div class="playlists-grid" id="playlists-grid">
            <div class="empty-state">
              <div class="empty-state__icon">🎵</div>
              <h4 class="empty-state__title">Cargando playlists...</h4>
            </div>
          </div>

          <!-- Floating Action Button to create playlist -->
          <button class="fab-create-playlist" id="btn-fab-create" aria-label="Crear nueva playlist">
            <span>+</span>
          </button>
        </div>

        <!-- Create Playlist Modal -->
        <div class="sonora-modal-overlay" id="modal-create-playlist">
          <div class="sonora-modal-card">
            <div class="modal-header">
              <h3>Crear Playlist</h3>
              <button class="btn-close-modal" id="btn-close-create-modal">&times;</button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label for="create-playlist-name">Nombre de la lista *</label>
                <input type="text" id="create-playlist-name" class="form-input" placeholder="Ej. Favoritas del verano" required />
              </div>
              <div class="form-group">
                <label for="create-playlist-desc">Descripción (opcional)</label>
                <textarea id="create-playlist-desc" class="form-textarea" rows="3" placeholder="Añade una descripción para tu playlist..."></textarea>
              </div>
              <div class="toggle-row">
                <div class="toggle-label">
                  <span class="toggle-title">Playlist colaborativa</span>
                  <span class="toggle-desc">Permite a otros usuarios ver y colaborar</span>
                </div>
                <label class="switch">
                  <input type="checkbox" id="create-playlist-collab" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-action btn-action--secondary" id="btn-cancel-create">Cancelar</button>
              <button class="btn-action btn-action--primary" id="btn-submit-create">Crear</button>
            </div>
          </div>
        </div>

        <!-- Collaborative Guide Modal -->
        <div class="sonora-modal-overlay" id="modal-collab-guide">
          <div class="sonora-modal-card" style="max-width: 480px;">
            <div class="modal-header">
              <h3>Playlists Colaborativas 👥</h3>
              <button class="btn-close-modal" id="btn-close-collab-guide">&times;</button>
            </div>
            <div class="modal-body" style="gap: 16px;">
              <p style="margin:0; font-size:13.5px; color:#bbb; line-height: 1.5;">
                Crea listas de reproducción junto a tus amigos o familia. Cualquier persona con el código puede añadir canciones que se sincronizan en tiempo real.
              </p>
              
              <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; display: flex; gap: 12px; align-items: flex-start;">
                <div style="font-size: 26px;">1️⃣</div>
                <div>
                  <div style="font-size: 14px; font-weight: 700; color: #fff;">Crea o activa la lista</div>
                  <div style="font-size: 12.5px; color: #a0a5ba; margin-top: 2px;">Al crear o editar una playlist, activa el switch <b>"Playlist colaborativa"</b>. Esto generará un código único de 6 caracteres (ej. <code style="background:rgba(255,71,87,0.2); color:#FF4757; padding:2px 6px; border-radius:4px;">SON-4892</code>).</div>
                </div>
              </div>

              <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; display: flex; gap: 12px; align-items: flex-start;">
                <div style="font-size: 26px;">2️⃣</div>
                <div>
                  <div style="font-size: 14px; font-weight: 700; color: #fff;">Comparte el código</div>
                  <div style="font-size: 12.5px; color: #a0a5ba; margin-top: 2px;">Comparte el código con tus amigos por WhatsApp, Telegram o en persona.</div>
                </div>
              </div>

              <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; display: flex; gap: 12px; align-items: flex-start;">
                <div style="font-size: 26px;">3️⃣</div>
                <div>
                  <div style="font-size: 14px; font-weight: 700; color: #fff;">Sincronización en vivo</div>
                  <div style="font-size: 12.5px; color: #a0a5ba; margin-top: 2px;">Tus amigos tocan <b>"Unirse con código"</b> e ingresan el código. Todas las canciones añadidas por cualquier miembro se sincronizan instantáneamente a través del servidor Sonora.</div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-action btn-action--primary" id="btn-collab-guide-ok" style="width: 100%; justify-content: center;">¡Entendido!</button>
            </div>
          </div>
        </div>

        <!-- Join with Code Modal -->
        <div class="sonora-modal-overlay" id="modal-join-code">
          <div class="sonora-modal-card" style="max-width: 400px;">
            <div class="modal-header">
              <h3>Unirse con código 👥</h3>
              <button class="btn-close-modal" id="btn-close-join-code">&times;</button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label for="join-collab-code">Código de la playlist *</label>
                <input type="text" id="join-collab-code" class="form-input" placeholder="Ej. SON-4892" style="text-transform: uppercase; letter-spacing: 2px; font-size: 16px; font-weight: 700; text-align: center;" required />
              </div>
              <p style="margin:0; font-size:12px; color:#8e8e93; text-align:center;">
                Pídele el código a la persona que creó la playlist colaborativa.
              </p>
            </div>
            <div class="modal-footer">
              <button class="btn-action btn-action--secondary" id="btn-cancel-join-code">Cancelar</button>
              <button class="btn-action btn-action--primary" id="btn-submit-join-code">Unirse</button>
            </div>
          </div>
        </div>
      `;
    },

    renderDetailShell(playlistId) {
      return `
        <div class="playlist-detail-container" data-playlist-id="${escapeHtml(playlistId)}">
          <div class="detail-nav">
            <button class="btn-back" id="btn-detail-back" aria-label="Volver">
              &#8592;
            </button>
            <span style="font-weight:700;font-size:15px;">Playlist</span>
          </div>

          <div class="detail-header lark-header" id="detail-header-block" style="text-align:center; display:flex; flex-direction:column; align-items:center;">
            <div class="detail-cover lark-cover" id="detail-cover-container" style="width:180px; height:180px; border-radius:18px; margin-bottom:14px; box-shadow: 0 12px 36px rgba(0,0,0,0.5);">
              <img src="${generateArtwork(playlistId, 'Playlist')}" alt="Cover" style="width:100%; height:100%; object-fit:cover; border-radius:18px;" />
            </div>
            <div class="detail-meta-block lark-meta" style="text-align:center;">
              <h1 class="detail-title lark-title" id="detail-title" style="font-size:22px; font-weight:800; margin:0 0 4px; color:#fff;">Cargando...</h1>
              <p class="detail-desc" id="detail-desc" style="font-size:13px; color:#8e8e93; margin:0 0 6px;"></p>
              <div class="detail-stats lark-stats" id="detail-stats" style="font-size:13px; color:#8e8e93; font-weight:600; display:flex; justify-content:center; align-items:center; gap:6px;">
                <span id="detail-track-count">0 Canciones</span>
                <span id="detail-collab-badge" style="display:none;margin-left:6px;" class="playlist-card__badge-collab">👥 Colaborativa</span>
              </div>
            </div>
          </div>

          <!-- Lark Player Play & Shuffle Pill Buttons -->
          <div class="lark-action-pills">
            <button class="lark-pill-btn" id="btn-play-all">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              <span>Reproducir</span>
            </button>
            <button class="lark-pill-btn" id="btn-shuffle-all">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
              <span>Mezclar todo</span>
            </button>
          </div>

          <div class="detail-actions" id="detail-secondary-actions">
            <button class="btn-action btn-action--secondary" id="btn-open-add-tracks">
              + Añadir canciones
            </button>
            <button class="btn-action btn-action--secondary" id="btn-edit-playlist">
              Editar
            </button>
            <button class="btn-action btn-action--secondary" id="btn-share-playlist">
              Compartir
            </button>
            <button class="btn-action btn-action--danger" id="btn-delete-playlist">
              Eliminar
            </button>
          </div>

          <div class="tracklist-section">
            <div class="tracklist-header">
              <h3 class="tracklist-title">Canciones</h3>
            </div>
            <div class="playlist-tracks-container" id="playlist-tracks-list">
              <div class="empty-state">
                <div class="empty-state__icon">🎶</div>
                <h4 class="empty-state__title">Cargando canciones...</h4>
              </div>
            </div>
          </div>
        </div>

        <!-- Add Tracks Modal -->
        <div class="sonora-modal-overlay" id="modal-add-tracks">
          <div class="sonora-modal-card" style="height:80vh;">
            <div class="modal-header">
              <h3>Añadir Canciones</h3>
              <button class="btn-close-modal" id="btn-close-add-modal">&times;</button>
            </div>
            <div style="padding:12px 20px 0 20px;">
              <input type="text" id="search-tracks-input" class="form-input" placeholder="🔍 Buscar por título o artista..." />
            </div>
            <div class="modal-body" id="add-tracks-list" style="padding-top:10px;">
              <div class="empty-state">
                <div class="empty-state__icon">🎵</div>
                <h4 class="empty-state__title">Cargando biblioteca...</h4>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-action btn-action--primary" id="btn-done-add-tracks">Listo</button>
            </div>
          </div>
        </div>

        <!-- Edit Playlist Modal -->
        <div class="sonora-modal-overlay" id="modal-edit-playlist">
          <div class="sonora-modal-card">
            <div class="modal-header">
              <h3>Editar Playlist</h3>
              <button class="btn-close-modal" id="btn-close-edit-modal">&times;</button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label for="edit-playlist-name">Nombre</label>
                <input type="text" id="edit-playlist-name" class="form-input" required />
              </div>
              <div class="form-group">
                <label for="edit-playlist-desc">Descripción</label>
                <textarea id="edit-playlist-desc" class="form-textarea" rows="3"></textarea>
              </div>
              <div class="toggle-row">
                <div class="toggle-label">
                  <span class="toggle-title">Lista colaborativa</span>
                  <span class="toggle-desc">Permitir colaboración</span>
                </div>
                <label class="switch">
                  <input type="checkbox" id="edit-playlist-collab" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-action btn-action--secondary" id="btn-cancel-edit">Cancelar</button>
              <button class="btn-action btn-action--primary" id="btn-submit-edit">Guardar</button>
            </div>
          </div>
        </div>
      `;
    },

    /**
     * Initialize page events, data fetching, touch drag & drop
     */
    async init() {
      this.destroy(); // Ensure clean slate

      try {
        const playlistId = getCurrentPlaylistId();
        if (playlistId) {
          await this.initDetailView(playlistId);
        } else {
          await this.initMainView();
        }
      } catch (err) {
        console.error('[Playlists] Init failed:', err);
      }
    },

    /**
     * Main view initialization
     */
    async initMainView() {
      const grid = $('#playlists-grid');
      const badge = $('#playlists-count-badge');
      const fab = $('#btn-fab-create');
      const createModal = $('#modal-create-playlist');
      const btnCloseCreate = $('#btn-close-create-modal');
      const btnCancelCreate = $('#btn-cancel-create');
      const btnSubmitCreate = $('#btn-submit-create');

      // Load Playlists & All Tracks for mosaic
      let playlists = [];
      let allTracks = [];
      try {
        if (Sonora.DB && Sonora.DB.playlists) {
          playlists = (await Sonora.DB.playlists.getAll()) || [];
        }
        if (Sonora.DB && Sonora.DB.tracks) {
          allTracks = (await Sonora.DB.tracks.getAll()) || [];
        }
      } catch (e) {
        console.warn('[Playlists] Error loading playlists from DB', e);
      }

      const tracksMap = new Map();
      allTracks.forEach(t => tracksMap.set(t.id, t));

      // Smart Playlists (Lark Player style: Recientemente reproducidas & Mis Favoritos)
      let historyTracks = [];
      let favTracks = [];
      try {
        if (Sonora.DB && Sonora.DB.history) historyTracks = (await Sonora.DB.history.getRecent(50)) || [];
        favTracks = allTracks.filter(t => t.isFavorite);
      } catch(e){}

      const recentIds = historyTracks.map(h => h.trackId || (h.track && h.track.id)).filter(Boolean);
      const recentUnique = Array.from(new Set(recentIds));
      const recentCount = recentUnique.length > 0 ? recentUnique.length : Math.min(15, allTracks.length);

      const smartPlaylists = [
        {
          id: 'recent',
          name: 'Recientemente reproducidas',
          trackIds: recentUnique.slice(0, 4),
          customCount: `${recentCount} ${recentCount === 1 ? 'canción' : 'canciones'}`,
          isSmart: true
        },
        {
          id: 'favorites',
          name: 'Mis Favoritos',
          trackIds: favTracks.slice(0, 4).map(t => t.id),
          customCount: `${favTracks.length} ${favTracks.length === 1 ? 'canción' : 'canciones'}`,
          isSmart: true
        }
      ];

      const allPlaylists = [...smartPlaylists, ...playlists];

      // Render grid
      if (badge) {
        badge.textContent = `${allPlaylists.length} ${allPlaylists.length === 1 ? 'playlist' : 'playlists'}`;
      }

      if (grid) {
        grid.innerHTML = allPlaylists.map(p => {
          const trackIds = Array.isArray(p.trackIds) ? p.trackIds : [];
          const pTracks = trackIds.map(id => tracksMap.get(id)).filter(Boolean);
          const artworkHtml = renderMosaicHtml(pTracks, p);
          const metaText = p.customCount || `${trackIds.length} ${trackIds.length === 1 ? 'canción' : 'canciones'}`;
          return `
            <div class="playlist-card" data-playlist-id="${escapeHtml(p.id)}">
              <div class="playlist-card__artwork-wrapper">
                <div class="playlist-card__artwork-inner">
                  ${artworkHtml}
                </div>
                ${p.isCollaborative ? '<div class="playlist-card__badge-collab">👥 Colab</div>' : ''}
                ${p.isSmart ? '<div class="playlist-card__badge-collab" style="background:rgba(255,71,87,0.85);">⭐ Sonora</div>' : ''}
              </div>
              <div class="playlist-card__info">
                <div class="playlist-card__title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
                <div class="playlist-card__meta">${metaText}</div>
              </div>
            </div>
          `;
        }).join('');

          // Bind card click to navigate
          $$('.playlist-card', grid).forEach(card => {
            addTrackedListener(card, 'click', () => {
              const pId = card.getAttribute('data-playlist-id');
              if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
                Sonora.Router.navigate('/playlists/' + pId);
              } else {
                window.location.hash = '#/playlists/' + pId;
              }
            });
          });
        }

      // Modal open/close handlers
      const openCreateModal = () => {
        if (createModal) {
          const nameInput = $('#create-playlist-name');
          if (nameInput) nameInput.value = '';
          const descInput = $('#create-playlist-desc');
          if (descInput) descInput.value = '';
          const collabInput = $('#create-playlist-collab');
          if (collabInput) collabInput.checked = false;
          createModal.classList.add('active');
          setTimeout(() => nameInput && nameInput.focus(), 150);
        }
      };

      const closeCreateModal = () => {
        if (createModal) createModal.classList.remove('active');
      };

      if (fab) addTrackedListener(fab, 'click', openCreateModal);
      if (btnCloseCreate) addTrackedListener(btnCloseCreate, 'click', closeCreateModal);
      if (btnCancelCreate) addTrackedListener(btnCancelCreate, 'click', closeCreateModal);

      // Create submit handler
      if (btnSubmitCreate) {
        addTrackedListener(btnSubmitCreate, 'click', async () => {
          const nameInput = $('#create-playlist-name');
          const descInput = $('#create-playlist-desc');
          const collabInput = $('#create-playlist-collab');

          const name = nameInput ? nameInput.value.trim() : '';
          const desc = descInput ? descInput.value.trim() : '';
          const isCollab = collabInput ? collabInput.checked : false;

          if (!name) {
            showToast('Por favor introduce un nombre para la playlist', 'error');
            if (nameInput) nameInput.focus();
            return;
          }

          const newPlaylistData = {
            id: 'pl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: name,
            description: desc,
            trackIds: [],
            artworkUrl: '',
            isCollaborative: isCollab,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          try {
            if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.create === 'function') {
              await Sonora.DB.playlists.create(newPlaylistData);
            } else if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.add === 'function') {
              await Sonora.DB.playlists.add(newPlaylistData);
            }
            showToast('Playlist creada correctamente');
            closeCreateModal();
            // Refresh view
            await this.initMainView();
          } catch (err) {
            console.error('[Playlists] Create failed', err);
            showToast('Error al crear la playlist', 'error');
          }
        });
      }

      // Collaborative Guide Modal handlers
      const btnCollabGuide = $('#btn-collab-guide');
      const modalCollabGuide = $('#modal-collab-guide');
      const btnCloseCollabGuide = $('#btn-close-collab-guide');
      const btnCollabGuideOk = $('#btn-collab-guide-ok');

      if (btnCollabGuide && modalCollabGuide) {
        addTrackedListener(btnCollabGuide, 'click', () => {
          modalCollabGuide.classList.add('active');
        });
        if (btnCloseCollabGuide) {
          addTrackedListener(btnCloseCollabGuide, 'click', () => {
            modalCollabGuide.classList.remove('active');
          });
        }
        if (btnCollabGuideOk) {
          addTrackedListener(btnCollabGuideOk, 'click', () => {
            modalCollabGuide.classList.remove('active');
          });
        }
        addTrackedListener(modalCollabGuide, 'click', (e) => {
          if (e.target === modalCollabGuide) modalCollabGuide.classList.remove('active');
        });
      }

      // Join with Code Modal handlers
      const btnOpenJoinCode = $('#btn-open-join-code');
      const modalJoinCode = $('#modal-join-code');
      const btnCloseJoinCode = $('#btn-close-join-code');
      const btnCancelJoinCode = $('#btn-cancel-join-code');
      const btnSubmitJoinCode = $('#btn-submit-join-code');
      const inputJoinCode = $('#join-collab-code');

      if (btnOpenJoinCode && modalJoinCode) {
        addTrackedListener(btnOpenJoinCode, 'click', () => {
          if (inputJoinCode) inputJoinCode.value = '';
          modalJoinCode.classList.add('active');
          if (inputJoinCode) inputJoinCode.focus();
        });
        const closeJoin = () => modalJoinCode.classList.remove('active');
        if (btnCloseJoinCode) addTrackedListener(btnCloseJoinCode, 'click', closeJoin);
        if (btnCancelJoinCode) addTrackedListener(btnCancelJoinCode, 'click', closeJoin);
        addTrackedListener(modalJoinCode, 'click', (e) => {
          if (e.target === modalJoinCode) closeJoin();
        });

        if (btnSubmitJoinCode) {
          addTrackedListener(btnSubmitJoinCode, 'click', async () => {
            const rawCode = inputJoinCode ? inputJoinCode.value.trim().toUpperCase() : '';
            if (!rawCode) {
              showToast('Introduce un código de playlist', 'warning');
              return;
            }

            btnSubmitJoinCode.disabled = true;
            btnSubmitJoinCode.textContent = 'Buscando...';

            try {
              let playlist = null;
              if (Sonora.API && typeof Sonora.API.getCollaborativePlaylist === 'function') {
                playlist = await Sonora.API.getCollaborativePlaylist(rawCode);
              }

              if (playlist) {
                if (Sonora.DB && Sonora.DB.playlists) {
                  if (typeof Sonora.DB.playlists.create === 'function') {
                    await Sonora.DB.playlists.create(playlist);
                  } else if (typeof Sonora.DB.playlists.add === 'function') {
                    await Sonora.DB.playlists.add(playlist);
                  }
                }
                showToast(`¡Te uniste a "${playlist.name}"!`, 'success');
                closeJoin();
                if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
                  Sonora.Router.navigate('/playlists/' + playlist.id);
                } else {
                  window.location.hash = '#/playlists/' + playlist.id;
                }
              } else {
                showToast('No se encontró playlist con el código ' + rawCode, 'error');
              }
            } catch (err) {
              showToast('Error al unirse: ' + err.message, 'error');
            } finally {
              btnSubmitJoinCode.disabled = false;
              btnSubmitJoinCode.textContent = 'Unirse';
            }
          });
        }
      }
    },

    /**
     * Detail view initialization (Track list, drag-and-drop, play, edit, delete, add)
     */
    async initDetailView(playlistId) {
      const btnBack = $('#btn-detail-back');
      if (btnBack) {
        addTrackedListener(btnBack, 'click', () => {
          if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
            Sonora.Router.navigate('/playlists');
          } else {
            window.location.hash = '#/playlists';
          }
        });
      }

      let playlist = null;
      let allTracks = [];
      try {
        if (Sonora.DB && Sonora.DB.tracks) {
          allTracks = (await Sonora.DB.tracks.getAll()) || [];
        }

        if (playlistId === 'recent') {
          let recentHistory = [];
          if (Sonora.DB && Sonora.DB.history) {
            recentHistory = (await Sonora.DB.history.getRecent(50)) || [];
          }
          const recentTrackIds = recentHistory.map(h => h.trackId || (h.track && h.track.id)).filter(Boolean);
          const uniqueIds = Array.from(new Set(recentTrackIds));
          playlist = {
            id: 'recent',
            name: 'Recientemente reproducidas',
            description: 'Historial de tus reproducciones en Sonora',
            trackIds: uniqueIds.length > 0 ? uniqueIds : allTracks.slice(0, 15).map(t => t.id),
            isSmart: true
          };
        } else if (playlistId === 'favorites') {
          const favs = allTracks.filter(t => t.isFavorite);
          playlist = {
            id: 'favorites',
            name: 'Mis Favoritos',
            description: 'Tus canciones favoritas guardadas',
            trackIds: favs.map(t => t.id),
            isSmart: true
          };
        } else if (Sonora.DB && Sonora.DB.playlists) {
          playlist = await Sonora.DB.playlists.getById(playlistId);
        }
      } catch (e) {
        console.warn('[Playlists] Error loading detail', e);
      }

      if (!playlist) {
        const titleEl = $('#detail-title');
        if (titleEl) titleEl.textContent = 'Playlist no encontrada';
        const tracksList = $('#playlist-tracks-list');
        if (tracksList) {
          tracksList.innerHTML = `
            <div class="empty-state">
              <div class="empty-state__icon">⚠️</div>
              <h4 class="empty-state__title">No pudimos encontrar esta playlist</h4>
              <button class="btn-action btn-action--secondary" id="btn-back-to-list">Volver a mis playlists</button>
            </div>
          `;
          const backBtn = $('#btn-back-to-list', tracksList);
          if (backBtn) {
            addTrackedListener(backBtn, 'click', () => {
              if (Sonora.Router) Sonora.Router.navigate('/playlists');
            });
          }
        }
        return;
      }

      const tracksMap = new Map();
      allTracks.forEach(t => tracksMap.set(t.id, t));

      // Update Header info
      const titleEl = $('#detail-title');
      const descEl = $('#detail-desc');
      const trackCountEl = $('#detail-track-count');
      const totalDurEl = $('#detail-total-duration');
      const collabBadge = $('#detail-collab-badge');
      const coverContainer = $('#detail-cover-container');

      if (titleEl) titleEl.textContent = playlist.name || 'Sin título';
      if (descEl) descEl.textContent = playlist.description || '';
      if (collabBadge) collabBadge.style.display = playlist.isCollaborative ? 'inline-flex' : 'none';

      const secActions = $('#detail-secondary-actions');
      if (secActions && playlist.isSmart) {
        const btnDel = $('#btn-delete-playlist', secActions);
        if (btnDel) btnDel.style.display = 'none';
        const btnEdit = $('#btn-edit-playlist', secActions);
        if (btnEdit) btnEdit.style.display = 'none';
      }

      const trackIds = Array.isArray(playlist.trackIds) ? [...playlist.trackIds] : [];
      const currentTracks = trackIds.map(id => tracksMap.get(id)).filter(Boolean);

      let totalDurationSec = 0;
      currentTracks.forEach(t => { totalDurationSec += (t.duration || 0); });

      if (trackCountEl) trackCountEl.textContent = `${currentTracks.length} ${currentTracks.length === 1 ? 'canción' : 'canciones'}`;
      if (totalDurEl) totalDurEl.textContent = formatTime(totalDurationSec);

      if (coverContainer) {
        coverContainer.innerHTML = renderMosaicHtml(currentTracks, playlist);
      }

      // Render Tracks List
      const tracksContainer = $('#playlist-tracks-list');
      const renderTrackList = () => {
        if (!tracksContainer) return;
        if (currentTracks.length === 0) {
          tracksContainer.innerHTML = `
            <div class="empty-state">
              <div class="empty-state__icon">🎵</div>
              <h4 class="empty-state__title">Esta playlist está vacía</h4>
              <p style="margin:0;font-size:13px;">Añade tus canciones favoritas para empezar a escuchar.</p>
              <button class="btn-action btn-action--primary" id="btn-empty-add-tracks" style="margin-top:10px;">
                + Añadir canciones
              </button>
            </div>
          `;
          const emptyAddBtn = $('#btn-empty-add-tracks', tracksContainer);
          if (emptyAddBtn) {
            addTrackedListener(emptyAddBtn, 'click', () => openAddModal());
          }
          return;
        }

        tracksContainer.innerHTML = currentTracks.map((track, idx) => {
          const artwork = track.artworkUrl || generateArtwork(track.id, track.title);
          const hasLyrics = Boolean(track.lyrics || track.syncedLyrics);
          return `
            <div class="playlist-track-item" data-track-id="${escapeHtml(track.id)}" data-index="${idx}" draggable="true">
              <span class="drag-handle" title="Arrastrar para reordenar">☰</span>
              <img src="${artwork}" class="track-cover-thumb" alt="" loading="lazy" />
              <div class="track-info-col" style="cursor:pointer;">
                <div class="track-title">${escapeHtml(track.title || 'Pista')}</div>
                <div class="track-sub-row" style="display:flex; align-items:center; gap:6px; margin-top:3px;">
                  ${hasLyrics ? '<span class="badge-letras">LETRAS</span>' : ''}
                  <span class="track-artist">${escapeHtml(track.artist || 'Artista desconocido')}</span>
                </div>
              </div>
              <span class="track-duration">${formatTime(track.duration || 0)}</span>
              ${playlist.isSmart ? '' : `<button class="btn-remove-track" data-track-id="${escapeHtml(track.id)}" title="Quitar de la lista">&times;</button>`}
            </div>
          `;
        }).join('');

        // Bind Play on Track Click
        $$('.track-info-col', tracksContainer).forEach(col => {
          addTrackedListener(col, 'click', () => {
            const item = col.closest('.playlist-track-item');
            const trackId = item.getAttribute('data-track-id');
            const clickedTrack = tracksMap.get(trackId);
            if (clickedTrack && Sonora.Player) {
              const clickedIdx = currentTracks.findIndex(t => t.id === trackId);
              if (typeof Sonora.Player.setQueue === 'function') {
                Sonora.Player.setQueue(currentTracks, clickedIdx >= 0 ? clickedIdx : 0);
              }
              if (typeof Sonora.Player.play === 'function') {
                Sonora.Player.play(clickedTrack);
              }
            }
          });
        });

        // Bind Remove Track button
        $$('.btn-remove-track', tracksContainer).forEach(btn => {
          addTrackedListener(btn, 'click', async (e) => {
            e.stopPropagation();
            const trackId = btn.getAttribute('data-track-id');
            try {
              // Update playlist
              const updatedTrackIds = playlist.trackIds.filter(id => id !== trackId);
              playlist.trackIds = updatedTrackIds;
              if (Sonora.DB && Sonora.DB.playlists) {
                if (typeof Sonora.DB.playlists.removeTrack === 'function') {
                  await Sonora.DB.playlists.removeTrack(playlist.id, trackId);
                } else if (typeof Sonora.DB.playlists.update === 'function') {
                  await Sonora.DB.playlists.update(playlist.id, { trackIds: updatedTrackIds, updatedAt: new Date().toISOString() });
                }
              }
              showToast('Canción eliminada de la playlist');
              await this.initDetailView(playlist.id);
            } catch (err) {
              console.error('[Playlists] Error removing track', err);
              showToast('Error al eliminar canción', 'error');
            }
          });
        });

        // Setup Drag & Drop Reordering (Touch & Mouse)
        setupDragAndDrop();
      };

      // Drag and Drop Logic
      const setupDragAndDrop = () => {
        const items = $$('.playlist-track-item', tracksContainer);
        let draggedItem = null;
        let startY = 0;
        let isTouching = false;

        // Touch event handlers for mobile reordering (Redmi Note 11 touch UX)
        items.forEach(item => {
          const handle = $('.drag-handle', item);
          if (!handle) return;

          addTrackedListener(handle, 'touchstart', (e) => {
            isTouching = true;
            draggedItem = item;
            draggedItem.classList.add('is-dragging');
            const touch = e.touches[0];
            startY = touch.clientY;
          }, { passive: false });

          addTrackedListener(handle, 'touchmove', (e) => {
            if (!isTouching || !draggedItem) return;
            e.preventDefault(); // Prevent scrolling while dragging handle
            const touch = e.touches[0];
            const currentY = touch.clientY;

            // Find item under touch point
            const targetElement = document.elementFromPoint(touch.clientX, currentY);
            if (!targetElement) return;

            const targetItem = targetElement.closest('.playlist-track-item');
            if (targetItem && targetItem !== draggedItem && targetItem.parentNode === tracksContainer) {
              const rect = targetItem.getBoundingClientRect();
              const next = (currentY - rect.top) / (rect.bottom - rect.top) > 0.5;
              tracksContainer.insertBefore(draggedItem, next ? targetItem.nextSibling : targetItem);
            }
          }, { passive: false });

          const endTouchDrag = async () => {
            if (!isTouching || !draggedItem) return;
            isTouching = false;
            draggedItem.classList.remove('is-dragging');

            // Read new order
            const newDomItems = $$('.playlist-track-item', tracksContainer);
            const newTrackIds = newDomItems.map(el => el.getAttribute('data-track-id')).filter(Boolean);

            // Compare with existing
            const hasChanged = JSON.stringify(newTrackIds) !== JSON.stringify(playlist.trackIds);
            if (hasChanged) {
              playlist.trackIds = newTrackIds;
              try {
                if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.update === 'function') {
                  await Sonora.DB.playlists.update(playlist.id, {
                    trackIds: newTrackIds,
                    updatedAt: new Date().toISOString()
                  });
                }
                showToast('Orden actualizado');
              } catch (err) {
                console.error('[Playlists] Error saving reorder', err);
              }
            }
            draggedItem = null;
          };

          addTrackedListener(handle, 'touchend', endTouchDrag);
          addTrackedListener(handle, 'touchcancel', endTouchDrag);

          // Desktop HTML5 drag support
          addTrackedListener(item, 'dragstart', (e) => {
            draggedItem = item;
            item.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.getAttribute('data-track-id'));
          });

          addTrackedListener(item, 'dragend', async () => {
            item.classList.remove('is-dragging');
            const newDomItems = $$('.playlist-track-item', tracksContainer);
            const newTrackIds = newDomItems.map(el => el.getAttribute('data-track-id')).filter(Boolean);
            if (JSON.stringify(newTrackIds) !== JSON.stringify(playlist.trackIds)) {
              playlist.trackIds = newTrackIds;
              try {
                if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.update === 'function') {
                  await Sonora.DB.playlists.update(playlist.id, {
                    trackIds: newTrackIds,
                    updatedAt: new Date().toISOString()
                  });
                }
                showToast('Orden guardado');
              } catch (e) {}
            }
            draggedItem = null;
          });

          addTrackedListener(item, 'dragover', (e) => {
            e.preventDefault();
            if (!draggedItem || draggedItem === item) return;
            const rect = item.getBoundingClientRect();
            const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
            tracksContainer.insertBefore(draggedItem, next ? item.nextSibling : item);
          });
        });
      };

      // Initial track list render
      renderTrackList();

      // Action buttons: Play All
      const btnPlayAll = $('#btn-play-all');
      if (btnPlayAll) {
        addTrackedListener(btnPlayAll, 'click', () => {
          if (currentTracks.length === 0) {
            showToast('Añade canciones a la playlist para reproducir');
            return;
          }
          if (Sonora.Player) {
            if (typeof Sonora.Player.setQueue === 'function') {
              Sonora.Player.setQueue(currentTracks, 0);
            }
            if (typeof Sonora.Player.play === 'function') {
              Sonora.Player.play(currentTracks[0]);
            }
            showToast('Reproduciendo playlist');
          }
        });
      }

      // Shuffle All
      const btnShuffleAll = $('#btn-shuffle-all');
      if (btnShuffleAll) {
        addTrackedListener(btnShuffleAll, 'click', () => {
          if (currentTracks.length === 0) {
            showToast('Añade canciones para reproducir en aleatorio');
            return;
          }
          if (Sonora.Player) {
            const shuffled = [...currentTracks].sort(() => Math.random() - 0.5);
            if (typeof Sonora.Player.setQueue === 'function') {
              Sonora.Player.setQueue(shuffled, 0);
            }
            if (typeof Sonora.Player.play === 'function') {
              Sonora.Player.play(shuffled[0]);
            }
            showToast('Modo aleatorio activado');
          }
        });
      }

      // Share button
      const btnShare = $('#btn-share-playlist');
      if (btnShare) {
        addTrackedListener(btnShare, 'click', async () => {
          const shareData = {
            title: `Playlist: ${playlist.name}`,
            text: `Escucha "${playlist.name}" en Sonora Music`,
            url: window.location.href
          };
          if (navigator.share) {
            try {
              await navigator.share(shareData);
            } catch (e) {
              console.log('[Share] Cancelled or failed');
            }
          } else {
            try {
              await navigator.clipboard.writeText(window.location.href);
              showToast('Enlace copiado al portapapeles');
            } catch (e) {
              showToast(`Código de playlist: ${playlist.id}`);
            }
          }
        });
      }

      // Delete Playlist
      const btnDelete = $('#btn-delete-playlist');
      if (btnDelete) {
        addTrackedListener(btnDelete, 'click', async () => {
          const confirmed = window.confirm(`¿Estás seguro de que quieres eliminar la playlist "${playlist.name}"?`);
          if (!confirmed) return;
          try {
            if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.delete === 'function') {
              await Sonora.DB.playlists.delete(playlist.id);
            }
            showToast('Playlist eliminada');
            if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
              Sonora.Router.navigate('/playlists');
            } else {
              window.location.hash = '#/playlists';
            }
          } catch (err) {
            console.error('[Playlists] Delete failed', err);
            showToast('Error al eliminar la playlist', 'error');
          }
        });
      }

      // Edit Playlist Modal
      const modalEdit = $('#modal-edit-playlist');
      const btnOpenEdit = $('#btn-edit-playlist');
      const btnCloseEdit = $('#btn-close-edit-modal');
      const btnCancelEdit = $('#btn-cancel-edit');
      const btnSubmitEdit = $('#btn-submit-edit');

      const openEditModal = () => {
        if (modalEdit) {
          const nameIn = $('#edit-playlist-name');
          const descIn = $('#edit-playlist-desc');
          const collabIn = $('#edit-playlist-collab');
          if (nameIn) nameIn.value = playlist.name || '';
          if (descIn) descIn.value = playlist.description || '';
          if (collabIn) collabIn.checked = !!playlist.isCollaborative;
          modalEdit.classList.add('active');
          setTimeout(() => nameIn && nameIn.focus(), 150);
        }
      };

      const closeEditModal = () => {
        if (modalEdit) modalEdit.classList.remove('active');
      };

      if (btnOpenEdit) addTrackedListener(btnOpenEdit, 'click', openEditModal);
      if (btnCloseEdit) addTrackedListener(btnCloseEdit, 'click', closeEditModal);
      if (btnCancelEdit) addTrackedListener(btnCancelEdit, 'click', closeEditModal);

      if (btnSubmitEdit) {
        addTrackedListener(btnSubmitEdit, 'click', async () => {
          const nameIn = $('#edit-playlist-name');
          const descIn = $('#edit-playlist-desc');
          const collabIn = $('#edit-playlist-collab');
          const newName = nameIn ? nameIn.value.trim() : '';
          const newDesc = descIn ? descIn.value.trim() : '';
          const newCollab = collabIn ? collabIn.checked : false;

          if (!newName) {
            showToast('El nombre no puede estar vacío', 'error');
            return;
          }

          playlist.name = newName;
          playlist.description = newDesc;
          playlist.isCollaborative = newCollab;
          playlist.updatedAt = new Date().toISOString();

          try {
            if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.update === 'function') {
              await Sonora.DB.playlists.update(playlist.id, {
                name: newName,
                description: newDesc,
                isCollaborative: newCollab,
                updatedAt: playlist.updatedAt
              });
            }
            showToast('Playlist actualizada');
            closeEditModal();
            await this.initDetailView(playlist.id);
          } catch (err) {
            console.error('[Playlists] Edit failed', err);
            showToast('Error al actualizar la playlist', 'error');
          }
        });
      }

      // Add Tracks Modal
      const modalAdd = $('#modal-add-tracks');
      const btnOpenAdd = $('#btn-open-add-tracks');
      const btnCloseAdd = $('#btn-close-add-modal');
      const btnDoneAdd = $('#btn-done-add-tracks');
      const searchInput = $('#search-tracks-input');
      const addTracksList = $('#add-tracks-list');

      const renderAddTracksList = (filterText) => {
        if (!addTracksList) return;
        const q = (filterText || '').toLowerCase().trim();
        const filtered = allTracks.filter(t => {
          if (!q) return true;
          return (t.title && t.title.toLowerCase().includes(q)) ||
                 (t.artist && t.artist.toLowerCase().includes(q)) ||
                 (t.album && t.album.toLowerCase().includes(q));
        });

        if (filtered.length === 0) {
          addTracksList.innerHTML = `
            <div class="empty-state">
              <div class="empty-state__icon">🔍</div>
              <h4 class="empty-state__title">No se encontraron canciones</h4>
            </div>
          `;
          return;
        }

        addTracksList.innerHTML = filtered.map(t => {
          const inPlaylist = playlist.trackIds && playlist.trackIds.includes(t.id);
          const artwork = t.artworkUrl || generateArtwork(t.id, t.title);
          return `
            <div class="playlist-track-item" style="padding:8px 0;">
              <img src="${artwork}" class="track-cover-thumb" alt="" loading="lazy" />
              <div class="track-info-col">
                <div class="track-title">${escapeHtml(t.title || 'Pista')}</div>
                <div class="track-artist">${escapeHtml(t.artist || 'Artista')} • ${formatTime(t.duration || 0)}</div>
              </div>
              <button class="btn-action ${inPlaylist ? 'btn-action--secondary' : 'btn-action--primary'} btn-toggle-add-track"
                      data-track-id="${escapeHtml(t.id)}"
                      data-in="${inPlaylist ? 'true' : 'false'}"
                      style="font-size:12px;padding:6px 12px;">
                ${inPlaylist ? '✓ Añadido' : '+ Añadir'}
              </button>
            </div>
          `;
        }).join('');

        // Bind toggle add/remove
        $$('.btn-toggle-add-track', addTracksList).forEach(btn => {
          addTrackedListener(btn, 'click', async () => {
            const tId = btn.getAttribute('data-track-id');
            const isIn = btn.getAttribute('data-in') === 'true';

            try {
              if (isIn) {
                playlist.trackIds = playlist.trackIds.filter(id => id !== tId);
                btn.setAttribute('data-in', 'false');
                btn.className = 'btn-action btn-action--primary btn-toggle-add-track';
                btn.textContent = '+ Añadir';
              } else {
                if (!playlist.trackIds.includes(tId)) {
                  playlist.trackIds.push(tId);
                }
                btn.setAttribute('data-in', 'true');
                btn.className = 'btn-action btn-action--secondary btn-toggle-add-track';
                btn.textContent = '✓ Añadido';
              }

              if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.update === 'function') {
                await Sonora.DB.playlists.update(playlist.id, {
                  trackIds: playlist.trackIds,
                  updatedAt: new Date().toISOString()
                });
              }
            } catch (err) {
              console.error('[Playlists] Error toggling track', err);
            }
          });
        });
      };

      const openAddModal = () => {
        if (modalAdd) {
          if (searchInput) searchInput.value = '';
          renderAddTracksList('');
          modalAdd.classList.add('active');
          setTimeout(() => searchInput && searchInput.focus(), 150);
        }
      };

      const closeAddModal = async () => {
        if (modalAdd) modalAdd.classList.remove('active');
        // Refresh detail view after adding tracks
        await this.initDetailView(playlist.id);
      };

      if (btnOpenAdd) addTrackedListener(btnOpenAdd, 'click', openAddModal);
      if (btnCloseAdd) addTrackedListener(btnCloseAdd, 'click', closeAddModal);
      if (btnDoneAdd) addTrackedListener(btnDoneAdd, 'click', closeAddModal);

      if (searchInput) {
        addTrackedListener(searchInput, 'input', (e) => {
          renderAddTracksList(e.target.value);
        });
      }
    },

    /**
     * Cleanup event listeners and DOM elements
     */
    destroy() {
      _listeners.forEach(({ el, event, handler, options }) => {
        try {
          if (el) el.removeEventListener(event, handler, options);
        } catch (e) {}
      });
      _listeners = [];

      // Close and remove any open modal leftovers if existing outside container
      $$('.sonora-modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  };

  // Register page and alias
  Sonora.Pages.Playlists = Playlists;
  Sonora.Pages.Playlist = Playlists;
})();
