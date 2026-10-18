(function () {
  'use strict';

  const Sonora = window.Sonora = window.Sonora || {};
  Sonora.Pages = Sonora.Pages || {};

  // Utility helpers
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }
  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  /** Duración larga legible: "1 h 32 min" (para audios de horas) */
  function formatLongDuration(sec) {
    const total = Math.floor(Number(sec) || 0);
    if (total <= 0) return '';
    const h = Math.floor(total / 3600);
    const m = Math.round((total % 3600) / 60);
    if (h > 0) return h + ' h' + (m > 0 ? ' ' + m + ' min' : '');
    return m + ' min';
  }
  function generateArtwork(id, title) {
    const numId = typeof id === 'number' ? id : (typeof id === 'string' ? (parseInt(id, 10) || id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) : 1);
    const hue = Math.abs(numId * 47) % 360;
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},70%,50%)"/><stop offset="100%" stop-color="hsl(${(hue+60)%360},70%,40%)\"/></linearGradient></defs><rect fill=\"url(#g)\" width=\"200\" height=\"200\" rx=\"12\"/><text x=\"100\" y=\"100\" text-anchor=\"middle\" dy=\".35em\" fill=\"white\" font-size=\"14\" font-family=\"sans-serif\">${title ? title.substring(0,15) : '♪'}</text></svg>`)}`;
  }
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const GENRES = [
    { name: 'Rock', query: 'rock en español top hits', gradient: 'linear-gradient(135deg, #E91E63, #880E4F)', icon: '🎸' },
    { name: 'Pop', query: 'pop en español exitos', gradient: 'linear-gradient(135deg, #FF9800, #E65100)', icon: '🎤' },
    { name: 'Electrónica', query: 'electronic dance music edm hits', gradient: 'linear-gradient(135deg, #00BCD4, #006064)', icon: '🎛️' },
    { name: 'Hip-Hop', query: 'hip hop rap hits 2024', gradient: 'linear-gradient(135deg, #9C27B0, #4A148C)', icon: '🎧' },
    { name: 'R&B', query: 'rnb soul greatest hits', gradient: 'linear-gradient(135deg, #3F51B5, #1A237E)', icon: '🎷' },
    { name: 'Jazz', query: 'smooth jazz classics', gradient: 'linear-gradient(135deg, #795548, #3E2723)', icon: '🎺' },
    { name: 'Metal', query: 'heavy metal classics rock', gradient: 'linear-gradient(135deg, #37474F, #212121)', icon: '⚡' },
    { name: 'Reggaetón', query: 'reggaeton exitos urbanos', gradient: 'linear-gradient(135deg, #4CAF50, #1B5E20)', icon: '🔥' },
    { name: 'Indie', query: 'indie rock alternativo', gradient: 'linear-gradient(135deg, #FF5722, #BF360C)', icon: '🌻' },
    { name: 'Clásica', query: 'musica clasica obras maestras', gradient: 'linear-gradient(135deg, #607D8B, #263238)', icon: '🎻' },
    { name: 'Latino', query: 'musica latina exitos', gradient: 'linear-gradient(135deg, #FFC107, #FF8F00)', icon: '💃' },
    { name: 'Ambient', query: 'ambient chillout relaxing music', gradient: 'linear-gradient(135deg, #009688, #004D40)', icon: '🌌' }
  ];

  const STORAGE_KEY = 'sonora_search_history';

  // Module state
  let rootElement = null;
  let searchInput = null;
  let clearBtn = null;
  let historyContainer = null;
  let contentContainer = null;
  let debounceTimeout = null;
  let currentExternalResults = [];
  let currentFilter = 'all'; // 'all' | 'youtube' | 'soundcloud'
  let activeModalTrack = null;

  // History helpers
  function getSearchHistory() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  function addSearchHistory(query) {
    if (!query || !query.trim()) return;
    const clean = query.trim();
    try {
      let history = getSearchHistory();
      history = history.filter(item => item.toLowerCase() !== clean.toLowerCase());
      history.unshift(clean);
      if (history.length > 8) history = history.slice(0, 8);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {}
  }

  function removeSearchHistory(query) {
    try {
      let history = getSearchHistory();
      history = history.filter(item => item !== query);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {}
  }

  function clearAllSearchHistory() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function getServerBaseUrl() {
    if (Sonora.API && typeof Sonora.API.getActiveUrl === 'function') {
      return Sonora.API.getActiveUrl();
    }
    const mode = Sonora.Store ? Sonora.Store.get('serverMode') : 'local';
    if (mode === 'render') {
      return (Sonora.Store && Sonora.Store.get('serverRenderUrl')) || 'https://sonora-music-b1ee.onrender.com';
    }
    return (Sonora.Store && Sonora.Store.get('serverLocalUrl')) || 'http://192.168.1.132:3000';
  }

  // Renderers
  function renderHistoryChips() {
    const history = getSearchHistory();
    if (!history || history.length === 0) return '';

    return `
      <div class="search-history-wrapper">
        <div class="search-history-header">
          <span class="search-history-title">Búsquedas recientes</span>
          <button class="search-history-clear-all" data-action="clear-all-history">Borrar todo</button>
        </div>
        <div class="search-chips-row">
          ${history.map(item => `
            <div class="search-chip" data-query="${escapeHtml(item)}" role="button">
              <span class="chip-label">${escapeHtml(item)}</span>
              <button class="chip-delete" data-action="remove-chip" data-query="${escapeHtml(item)}" aria-label="Eliminar">&times;</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderGenreGrid() {
    return `
      <div class="genre-section">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin: 16px 0 12px;">
          <h2 class="search-section-title" style="margin:0;">Explorar por género</h2>
          <span style="font-size:12px; color:var(--color-primary, #FF4757); font-weight:600;">YouTube Music</span>
        </div>
        <div class="genre-grid">
          ${GENRES.map(g => `
            <div class="genre-card" style="background: ${g.gradient};" data-action="select-genre" data-genre="${escapeHtml(g.name)}" data-genre-query="${escapeHtml(g.query)}">
              <span class="genre-card__name">${escapeHtml(g.name)}</span>
              <span class="genre-card__icon">${g.icon}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderFilterPills() {
    return `
      <div class="search-filter-pills">
        <button type="button" class="filter-pill ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">🌐 Todo</button>
        <button type="button" class="filter-pill ${currentFilter === 'youtube' ? 'active' : ''}" data-filter="youtube">🔴 YouTube</button>
        <button type="button" class="filter-pill ${currentFilter === 'soundcloud' ? 'active' : ''}" data-filter="soundcloud">🟠 SoundCloud</button>
      </div>
    `;
  }

  function renderSearchResults(results, query) {
    let filtered = results;
    if (currentFilter === 'youtube') {
      filtered = results.filter(r => r.platform === 'youtube');
    } else if (currentFilter === 'soundcloud') {
      filtered = results.filter(r => r.platform === 'soundcloud');
    }

    if (!filtered || filtered.length === 0) {
      return `
        ${renderFilterPills()}
        <div class="search-empty-state">
          <div class="search-empty-icon">🔍</div>
          <h3 class="search-empty-title">Sin resultados online</h3>
          <p class="search-empty-desc">No pudimos encontrar nada para "${escapeHtml(query)}". Intenta con otra palabra clave o nombre de artista.</p>
        </div>
      `;
    }

    return `
      ${renderFilterPills()}
      <div class="results-group" style="padding: 0 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
          <h2 class="search-section-title" style="margin:0;">Resultados (${filtered.length})</h2>
          <span style="font-size:11px; color:#aaa; font-weight:600;">YouTube &amp; SoundCloud</span>
        </div>
        <div class="tracks-list-external">
          ${filtered.map((item, idx) => {
            const isYT = item.platform === 'youtube';
            const platformLabel = isYT ? 'YouTube' : 'SoundCloud';
            const platformColor = isYT ? '#FF0000' : '#FF5500';
            const dur = item.durationText || formatTime(item.duration);
            const longSec = Number(item.duration) || 0;
            const isLong = longSec >= 1200; // audios de 20 min o más
            const longLabel = isLong ? formatLongDuration(longSec) : '';

            return `
              <div class="external-track-card" data-idx="${idx}">
                <div class="external-track-art-wrap">
                  <img src="${escapeHtml(item.thumbnail || generateArtwork(idx, item.title))}" alt="" class="external-track-art" loading="lazy" onerror="this.src=''" />
                  <span class="external-track-duration">${dur}</span>
                  ${isLong ? `<span class="external-track-warn" title="Audio muy largo (posible recopilación)">⚠️ ${longLabel}</span>` : ''}
                </div>
                <div class="external-track-info">
                  <div class="external-track-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                  <div class="external-track-meta">
                    <span class="platform-badge" style="background: ${platformColor}; color: var(--color-text-primary);">${platformLabel}</span>
                    <span class="external-track-artist">${escapeHtml(item.artist || 'Artista')}</span>
                  </div>
                  <div class="external-track-actions">
                    <button type="button" class="btn-action-download" data-action="open-download-modal" data-idx="${idx}">
                      ⬇️ Descargar / Formatos
                    </button>
                    <button type="button" class="btn-action-play" data-action="play-external" data-idx="${idx}">
                      ▶️ Escuchar
                    </button>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderFormatModal(track) {
    if (!track) return '';
    const isYT = track.platform === 'youtube';
    const dur = track.durationText || formatTime(track.duration);

    return `
      <div id="format-modal-backdrop" class="modal-backdrop">
        <div class="format-modal-sheet">
          <div class="format-modal-handle"></div>
          <div class="format-modal-header">
            <img src="${escapeHtml(track.thumbnail || '')}" class="format-modal-thumb" alt="" onerror="this.src=''" />
            <div class="format-modal-info">
              <div class="format-modal-title">${escapeHtml(track.title)}</div>
              <div class="format-modal-artist">${escapeHtml(track.artist)} • ${dur}</div>
              <span class="platform-badge" style="background:${isYT ? '#FF0000' : '#FF5500'}; color:var(--color-text-primary); display:inline-block; margin-top:4px;">${isYT ? 'YouTube Music' : 'SoundCloud'}</span>
            </div>
            <button id="btn-close-format-modal" class="modal-close-btn">&times;</button>
          </div>

          <div class="format-tabs-selector">
            <button type="button" class="fmt-tab-btn active" data-fmt-tab="mp3">🎵 Audio MP3</button>
            <button type="button" class="fmt-tab-btn" data-fmt-tab="mp4">🎬 Video MP4</button>
          </div>

          <!-- MP3 Options -->
          <div id="fmt-pane-mp3" class="fmt-pane">
            <div class="quality-options-list">
              <label class="quality-option active">
                <input type="radio" name="audio-quality" value="320k" checked />
                <div class="quality-info">
                  <div class="quality-label">Alta Calidad (320 kbps)</div>
                  <div class="quality-sub">Máxima fidelidad de audio • ~8.5 MB</div>
                </div>
                <span class="quality-badge">Recomendado</span>
              </label>

              <label class="quality-option">
                <input type="radio" name="audio-quality" value="192k" />
                <div class="quality-info">
                  <div class="quality-label">Calidad Estándar (192 kbps)</div>
                  <div class="quality-sub">Fidelidad equilibrada • ~5.2 MB</div>
                </div>
              </label>

              <label class="quality-option">
                <input type="radio" name="audio-quality" value="128k" />
                <div class="quality-info">
                  <div class="quality-label">Ahorro de Espacio (128 kbps)</div>
                  <div class="quality-sub">Descarga súper rápida • ~3.4 MB</div>
                </div>
              </label>
            </div>
          </div>

          <!-- MP4 Options -->
          <div id="fmt-pane-mp4" class="fmt-pane hidden">
            <div class="quality-options-list">
              <label class="quality-option">
                <input type="radio" name="video-quality" value="1080p" />
                <div class="quality-info">
                  <div class="quality-label">Full HD 1080p</div>
                  <div class="quality-sub">Máxima nitidez • ~45 MB</div>
                </div>
              </label>

              <label class="quality-option active">
                <input type="radio" name="video-quality" value="720p" checked />
                <div class="quality-info">
                  <div class="quality-label">HD 720p</div>
                  <div class="quality-sub">Excelente calidad visual • ~25 MB</div>
                </div>
                <span class="quality-badge">Recomendado</span>
              </label>

              <label class="quality-option">
                <input type="radio" name="video-quality" value="360p" />
                <div class="quality-info">
                  <div class="quality-label">Móvil Rápido 360p</div>
                  <div class="quality-sub">Menor consumo de datos • ~12 MB</div>
                </div>
              </label>
            </div>
          </div>

          <!-- Modal Action Buttons -->
          <div class="format-modal-actions">
            <button type="button" id="btn-both-download" class="btn-modal-action btn-both-dl">
              ⚡ Descargar en Ambos (Dispositivo + Sonora Offline)
              <span class="btn-action-sub">Descarga al teléfono con portada y letras para Lark Player y lo guarda en Sonora offline</span>
            </button>

            <button type="button" id="btn-device-download" class="btn-modal-action btn-device-dl">
              📱 Descargar al Dispositivo
              <span class="btn-action-sub">Guardar archivo en Descargas (abrir con Lark Player o cualquier reproductor)</span>
            </button>

            <button type="button" id="btn-save-to-sonora" class="btn-modal-action btn-sonora-save">
              📥 Guardar en Sonora (Modo Offline)
              <span class="btn-action-sub">Añadir a tu biblioteca de Sonora con letras sincronizadas para escuchar sin internet</span>
            </button>

            <button type="button" id="btn-listen-now" class="btn-modal-action btn-listen-now">
              ▶️ Escuchar Ahora en Sonora
            </button>
          </div>
        </div>
      </div>
    `;
  }

  Sonora.Pages.Search = {
    render() {
      return `
        <div class="page page-search">
          <style>
            .page-search {
              padding-bottom: 120px;
              /* Sin esto se sumaba al padding de main.css y el buscador quedaba
                 con 32px de sangrado (desalineado con el resto). */
              padding-left: 0;
              padding-right: 0;
              min-height: 100vh;
              color: var(--text-color, #ffffff);
              background: var(--bg-color, #121212);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            .search-header-sticky {
              position: sticky;
              top: 0;
              z-index: 100;
              background: rgba(18, 18, 18, 0.98);
              backdrop-filter: blur(16px);
              -webkit-backdrop-filter: blur(16px);
              padding: 14px 16px 10px;
              box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            }
            .search-bar {
              position: relative;
              display: flex;
              align-items: center;
              background: var(--color-surface-elevated);
              border-radius: 12px;
              padding: 0 12px;
              height: 48px;
              border: 1px solid rgba(255, 255, 255, 0.1);
              transition: border-color 0.2s, box-shadow 0.2s;
            }
            .search-bar:focus-within {
              border-color: var(--color-primary, #FF4757);
              box-shadow: 0 0 0 2px rgba(255, 71, 87, 0.25);
            }
            .search-bar__icon {
              color: var(--color-text-secondary);
              margin-right: 10px;
              display: flex;
              align-items: center;
            }
            .search-bar__input {
              flex: 1;
              background: transparent;
              border: none;
              outline: none;
              color: var(--color-text-primary);
              font-size: 15px;
              font-weight: 500;
              height: 100%;
            }
            .search-bar__input::placeholder {
              color: var(--color-text-secondary);
            }
            .search-bar__clear {
              background: rgba(255, 255, 255, 0.15);
              border: none;
              color: var(--color-text-primary);
              width: 24px;
              height: 24px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 14px;
              cursor: pointer;
            }
            .search-bar__clear.hidden {
              display: none;
            }

            /* Filter Pills */
            .search-filter-pills {
              display: flex;
              gap: 8px;
              padding: 10px 16px 14px;
              overflow-x: auto;
            }
            .filter-pill {
              background: var(--color-surface-elevated);
              border: 1px solid var(--color-card-border, rgba(255,255,255,0.08));
              color: #b0b0b8;
              font-size: 12px;
              font-weight: 600;
              padding: 6px 14px;
              border-radius: 20px;
              cursor: pointer;
              white-space: nowrap;
              transition: all 0.2s;
            }
            .filter-pill.active {
              background: var(--color-primary, #FF4757);
              border-color: var(--color-primary, #FF4757);
              color: var(--color-text-primary);
            }

            /* Direct URL Downloader Bar */
            .direct-url-box {
              margin: 8px 16px 14px;
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: 12px;
              padding: 10px 14px;
            }
            .direct-url-toggle {
              display: flex;
              align-items: center;
              justify-content: space-between;
              cursor: pointer;
            }
            .direct-url-toggle span {
              font-size: 12px;
              font-weight: 600;
              color: #aaa;
            }
            .direct-url-toggle button {
              background: none;
              border: none;
              color: var(--color-primary, #FF4757);
              font-size: 12px;
              font-weight: 700;
              cursor: pointer;
            }

            /* History */
            .search-history-wrapper {
              padding: 8px 16px 12px;
            }
            .search-history-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 8px;
            }
            .search-history-title {
              font-size: 12px;
              font-weight: 700;
              color: var(--color-text-secondary);
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .search-history-clear-all {
              background: none;
              border: none;
              color: var(--color-primary, #FF4757);
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
            }
            .search-chips-row {
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
            }
            .search-chip {
              background: var(--color-surface-elevated);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
              border-radius: 20px;
              padding: 5px 12px;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              font-size: 12px;
              color: #e0e0e0;
              cursor: pointer;
            }
            .chip-delete {
              background: none;
              border: none;
              color: var(--color-text-secondary);
              font-size: 14px;
              cursor: pointer;
              padding: 0;
            }

            /* Genre Grid */
            .genre-section {
              padding: 8px 16px;
            }
            .search-section-title {
              font-size: 17px;
              font-weight: 700;
              color: var(--color-text-primary);
            }
            .genre-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
            }
            .genre-card {
              height: 84px;
              border-radius: 12px;
              padding: 12px;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              cursor: pointer;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              transition: transform 0.15s ease;
            }
            .genre-card:active {
              transform: scale(0.97);
            }
            .genre-card__name {
              font-size: 15px;
              font-weight: 700;
              color: var(--color-text-primary);
            }
            .genre-card__icon {
              font-size: 24px;
              align-self: flex-end;
            }

            /* External Track Cards */
            .tracks-list-external {
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            .external-track-card {
              display: flex;
              gap: 12px;
              background: var(--color-surface);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.06));
              border-radius: 12px;
              padding: 10px;
              align-items: center;
              box-shadow: 0 4px 14px rgba(0,0,0,0.25);
            }
            .external-track-art-wrap {
              width: 80px;
              height: 80px;
              border-radius: 8px;
              overflow: hidden;
              position: relative;
              background: var(--color-surface-elevated);
              flex-shrink: 0;
            }
            .external-track-art {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .external-track-duration {
              position: absolute;
              bottom: 4px;
              right: 4px;
              background: rgba(0,0,0,0.75);
              color: #fff;
              font-size: 10px;
              font-weight: 700;
              padding: 2px 4px;
              border-radius: 4px;
            }
            /* Aviso de audio muy largo (recopilaciones de 1 h o más) */
            .external-track-warn {
              position: absolute;
              top: 4px;
              left: 4px;
              background: rgba(255, 152, 0, 0.95);
              color: #1a1200;
              font-size: 9.5px;
              font-weight: 800;
              padding: 2px 5px;
              border-radius: 6px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.45);
            }
            .external-track-info {
              flex: 1;
              min-width: 0;
            }
            .external-track-title {
              font-size: 14px;
              font-weight: 700;
              color: var(--color-text-primary);
              line-height: 1.3;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            }
            .external-track-meta {
              display: flex;
              align-items: center;
              gap: 6px;
              margin: 4px 0 8px;
            }
            .platform-badge {
              font-size: 10px;
              font-weight: 700;
              padding: 2px 6px;
              border-radius: 4px;
              text-transform: uppercase;
              letter-spacing: 0.3px;
            }
            .external-track-artist {
              font-size: 12px;
              color: var(--color-text-secondary);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .external-track-actions {
              display: flex;
              gap: 8px;
              flex-wrap: wrap;
              justify-content: flex-end;
            }
            .btn-action-download {
              background: var(--color-primary, #FF4757);
              color: var(--color-text-primary);
              border: none;
              border-radius: 18px;
              padding: 6px 12px;
              font-size: 11px;
              font-weight: 700;
              cursor: pointer;
            }
            .btn-action-play {
              background: rgba(255, 255, 255, 0.1);
              color: var(--color-text-primary);
              border: 1px solid rgba(255, 255, 255, 0.15);
              border-radius: 18px;
              padding: 6px 12px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
            }

            /* Empty state */
            .search-empty-state {
              padding: 40px 20px;
              text-align: center;
            }
            .search-empty-icon {
              font-size: 40px;
              margin-bottom: 8px;
            }
            .search-empty-title {
              font-size: 16px;
              font-weight: 700;
              color: var(--color-text-primary);
              margin-bottom: 4px;
            }
            .search-empty-desc {
              font-size: 13px;
              color: var(--color-text-secondary);
            }

            /* Format Modal Sheet */
            .modal-backdrop {
              position: fixed;
              inset: 0;
              background: rgba(0,0,0,0.75);
              z-index: 500;
              display: flex;
              flex-direction: column;
              justify-content: flex-end;
              animation: fadeIn 0.2s ease;
            }
            .format-modal-sheet {
              background: var(--color-surface);
              border-radius: 20px 20px 0 0;
              padding: 16px 20px 32px;
              max-height: 85vh;
              overflow-y: auto;
              box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
              animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .format-modal-handle {
              width: 36px;
              height: 4px;
              border-radius: 2px;
              background: rgba(255,255,255,0.25);
              margin: 0 auto 14px;
            }
            .format-modal-header {
              display: flex;
              gap: 12px;
              align-items: center;
              position: relative;
              padding-bottom: 14px;
              border-bottom: 1px solid rgba(255,255,255,0.08);
            }
            .format-modal-thumb {
              width: 60px;
              height: 60px;
              border-radius: 8px;
              object-fit: cover;
              background: var(--color-surface-elevated);
              flex-shrink: 0;
            }
            .format-modal-info {
              flex: 1;
              min-width: 0;
            }
            .format-modal-title {
              font-size: 14px;
              font-weight: 700;
              color: var(--color-text-primary);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .format-modal-artist {
              font-size: 12px;
              color: var(--color-text-secondary);
              margin-top: 2px;
            }
            .modal-close-btn {
              background: rgba(255,255,255,0.1);
              border: none;
              color: var(--color-text-primary);
              width: 28px;
              height: 28px;
              border-radius: 50%;
              font-size: 18px;
              cursor: pointer;
            }

            .format-tabs-selector {
              display: flex;
              gap: 8px;
              margin: 16px 0;
              background: var(--color-surface);
              padding: 4px;
              border-radius: 12px;
            }
            .fmt-tab-btn {
              flex: 1;
              background: none;
              border: none;
              color: var(--color-text-secondary);
              font-size: 13px;
              font-weight: 700;
              padding: 10px;
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s;
            }
            .fmt-tab-btn.active {
              background: var(--color-primary, #FF4757);
              color: var(--color-text-primary);
            }

            .quality-options-list {
              display: flex;
              flex-direction: column;
              gap: 8px;
              margin-bottom: 16px;
            }
            .quality-option {
              display: flex;
              align-items: center;
              gap: 12px;
              background: rgba(255,255,255,0.03);
              border: 1px solid var(--color-card-border, rgba(255,255,255,0.08));
              border-radius: 10px;
              padding: 10px 14px;
              cursor: pointer;
              transition: border-color 0.15s;
            }
            .quality-option.active {
              border-color: var(--color-primary, #FF4757);
              background: rgba(255,71,87,0.08);
            }
            .quality-info {
              flex: 1;
            }
            .quality-label {
              font-size: 13px;
              font-weight: 700;
              color: var(--color-text-primary);
            }
            .quality-sub {
              font-size: 11px;
              color: var(--color-text-secondary);
              margin-top: 2px;
            }
            .quality-badge {
              font-size: 10px;
              font-weight: 700;
              background: rgba(76, 175, 80, 0.2);
              color: #4CAF50;
              padding: 3px 6px;
              border-radius: 4px;
            }

            .format-modal-actions {
              display: flex;
              flex-direction: column;
              gap: 10px;
              margin-top: 18px;
            }
            .btn-modal-action {
              border: none;
              border-radius: 12px;
              padding: 12px 16px;
              text-align: left;
              cursor: pointer;
              font-size: 14px;
              font-weight: 700;
              display: flex;
              flex-direction: column;
              gap: 3px;
            }
            .btn-action-sub {
              font-size: 11px;
              font-weight: 400;
              opacity: 0.85;
            }
            .btn-both-dl {
              background: linear-gradient(135deg, #FF4757 0%, #FF6B35 50%, #FFA502 100%);
              color: var(--color-on-primary, #fff);
              box-shadow: 0 4px 18px rgba(255, 71, 87, 0.45);
              border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .btn-both-dl:active {
              transform: scale(0.98);
              opacity: 0.95;
            }
            .btn-device-dl {
              background: #2ed573;
              color: var(--color-text-primary);
            }
            .btn-sonora-save {
              background: var(--color-primary, #FF4757);
              color: var(--color-text-primary);
            }
            .btn-listen-now {
              background: rgba(255,255,255,0.12);
              border: 1px solid rgba(255,255,255,0.15);
              color: var(--color-text-primary);
              text-align: center;
              align-items: center;
            }

            /* ── Pulido y animaciones del buscador ── */
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes trackIn {
              from { opacity: 0; transform: translateY(10px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .external-track-card {
              animation: trackIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
              transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
            }
            .tracks-list-external .external-track-card:nth-child(1) { animation-delay: 0.02s; }
            .tracks-list-external .external-track-card:nth-child(2) { animation-delay: 0.05s; }
            .tracks-list-external .external-track-card:nth-child(3) { animation-delay: 0.08s; }
            .tracks-list-external .external-track-card:nth-child(4) { animation-delay: 0.11s; }
            .tracks-list-external .external-track-card:nth-child(5) { animation-delay: 0.14s; }
            .external-track-card:active { transform: scale(0.985); }
            .external-track-card:hover {
              border-color: rgba(255, 71, 87, 0.45);
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            }
            .external-track-art-wrap { overflow: hidden; }
            .external-track-art-wrap img { transition: transform 0.28s ease; }
            .external-track-card:hover .external-track-art-wrap img { transform: scale(1.07); }
            .genre-card { transition: transform 0.18s ease, box-shadow 0.18s ease; }
            .genre-card:hover { box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); }
            .search-bar { transition: border-color 0.2s ease, box-shadow 0.2s ease; }
            @media (min-width: 560px) { .genre-grid { grid-template-columns: 1fr 1fr 1fr; } }
            @media (min-width: 860px) { .genre-grid { grid-template-columns: repeat(4, 1fr); } }
            @media (max-width: 370px) {
              .external-track-card { gap: 8px; padding: 8px; }
              .external-track-art-wrap { width: 64px; height: 64px; }
              .external-track-title { font-size: 13px; }
            }
          </style>

          <!-- Sticky Search Header -->
          <div class="search-header-sticky">
            <div class="search-bar">
              <span class="search-bar__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </span>
              <input
                type="text"
                class="search-bar__input"
                id="search-input"
                placeholder="Buscar canciones en YouTube y SoundCloud..."
                autocomplete="off"
                autocapitalize="none"
              />
              <button class="search-bar__clear hidden" id="search-clear" aria-label="Limpiar búsqueda">&times;</button>
            </div>
          </div>

          <!-- Direct URL Downloader Toggle -->
          <div class="direct-url-box">
            <div class="direct-url-toggle" id="btn-toggle-direct-url">
              <span>🔗 Pegar enlace directo (YouTube / SoundCloud)</span>
              <button type="button" id="btn-direct-toggle-label">Abrir</button>
            </div>
            <div id="direct-url-pane" class="hidden" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
              <div style="display:flex; gap:8px;">
                <input type="url" id="direct-url-input" placeholder="https://www.youtube.com/watch?v=..." style="flex:1; background:var(--color-surface); border:1px solid rgba(255,255,255,0.2); border-radius:8px; padding:8px 12px; font-size:12px; color:var(--color-text-primary);" />
                <button type="button" id="btn-direct-resolve" style="background:var(--color-primary, #FF4757); color:var(--color-text-primary); border:none; border-radius:8px; padding:0 14px; font-size:12px; font-weight:700; cursor:pointer;">Buscar</button>
              </div>
            </div>
          </div>

          <!-- Search History Chips -->
          <div id="search-history-container">
            ${renderHistoryChips()}
          </div>

          <!-- Dynamic Body Content -->
          <div id="search-content">
            ${renderGenreGrid()}
          </div>

          <!-- Format Modal Container -->
          <div id="format-modal-container"></div>
        </div>
      `;
    },

    init() {
      rootElement = $('.page-search');
      if (!rootElement) return;

      searchInput = $('#search-input', rootElement);
      clearBtn = $('#search-clear', rootElement);
      historyContainer = $('#search-history-container', rootElement);
      contentContainer = $('#search-content', rootElement);

      if (!searchInput || !contentContainer) return;

      // Input event with 350ms debounce for live server search
      const onInput = () => {
        const query = (searchInput.value || '').trim();
        if (clearBtn) {
          if (query.length > 0) clearBtn.classList.remove('hidden');
          else clearBtn.classList.add('hidden');
        }

        if (debounceTimeout) clearTimeout(debounceTimeout);

        if (!query) {
          if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
          contentContainer.innerHTML = renderGenreGrid();
          currentExternalResults = [];
          return;
        }

        debounceTimeout = setTimeout(async () => {
          await executeOnlineSearch(query);
        }, 350);
      };

      searchInput.addEventListener('input', onInput);

      // Search input keydown (Enter saves history)
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = (searchInput.value || '').trim();
          if (query) {
            addSearchHistory(query);
            if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
            searchInput.blur();
          }
        }
      });

      // Clear button
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          searchInput.value = '';
          clearBtn.classList.add('hidden');
          if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
          contentContainer.innerHTML = renderGenreGrid();
          currentExternalResults = [];
          searchInput.focus();
        });
      }

      // Direct URL toggle
      const directToggle = $('#btn-toggle-direct-url', rootElement);
      const directPane = $('#direct-url-pane', rootElement);
      const directToggleLabel = $('#btn-direct-toggle-label', rootElement);
      const directInput = $('#direct-url-input', rootElement);
      const directResolveBtn = $('#btn-direct-resolve', rootElement);

      if (directToggle && directPane && directToggleLabel) {
        directToggle.addEventListener('click', (e) => {
          if (e.target === directResolveBtn || e.target === directInput) return;
          const isHidden = directPane.classList.toggle('hidden');
          directToggleLabel.textContent = isHidden ? 'Abrir' : 'Cerrar';
          if (!isHidden && directInput) directInput.focus();
        });
      }

      if (directResolveBtn && directInput) {
        directResolveBtn.addEventListener('click', async () => {
          const url = (directInput.value || '').trim();
          if (!url) {
            if (Sonora.Store) Sonora.Store.emit('toast', { message: 'Pega un enlace de YouTube o SoundCloud', type: 'warning' });
            return;
          }
          directResolveBtn.disabled = true;
          directResolveBtn.textContent = 'Buscando...';

          try {
            const isYT = url.includes('youtube.com') || url.includes('youtu.be') || url.includes('music.youtube.com');
            const isSC = url.includes('soundcloud.com');
            if (!isYT && !isSC) throw new Error('Solo se admiten enlaces de YouTube, YouTube Music o SoundCloud');

            let normalizedUrl = url;
            let ytVideoId = null;
            if (isYT) {
              const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
              if (match && match[1]) {
                ytVideoId = match[1];
                normalizedUrl = 'https://www.youtube.com/watch?v=' + ytVideoId;
              } else {
                normalizedUrl = url.replace('music.youtube.com', 'www.youtube.com');
              }
            }

            let data = null;
            try {
              const apiUrl = isYT
                ? `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`
                : `https://soundcloud.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`;
              const resp = await fetch(apiUrl);
              if (resp.ok) data = await resp.json();
            } catch (fetchErr) {}

            const trackObj = {
              id: ytVideoId ? ('yt_' + ytVideoId) : ('ext_' + Date.now()),
              videoId: ytVideoId,
              title: (data && data.title) ? data.title : (isYT ? 'Canción de YouTube' : 'Pista de SoundCloud'),
              artist: (data && data.author_name) ? data.author_name : (isYT ? 'YouTube' : 'SoundCloud'),
              thumbnail: (data && data.thumbnail_url) ? data.thumbnail_url : (ytVideoId ? `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg` : ''),
              platform: isYT ? 'youtube' : 'soundcloud',
              url: normalizedUrl,
              duration: 210,
              durationText: '3:30'
            };

            openFormatModal(trackObj);
          } catch (err) {
            if (Sonora.Store) Sonora.Store.emit('toast', { message: err.message, type: 'error' });
          } finally {
            directResolveBtn.disabled = false;
            directResolveBtn.textContent = 'Buscar';
          }
        });
      }

      // Root click delegation
      rootElement.addEventListener('click', async (e) => {
        try {
          const target = e.target;
          if (!target) return;

          // 1. Remove individual chip
          const removeChipBtn = target.closest('[data-action="remove-chip"]');
          if (removeChipBtn) {
            e.stopPropagation();
            const q = removeChipBtn.getAttribute('data-query');
            removeSearchHistory(q);
            if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
            return;
          }

          // 2. Clear all history
          const clearAllBtn = target.closest('[data-action="clear-all-history"]');
          if (clearAllBtn) {
            clearAllSearchHistory();
            if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
            return;
          }

          // 3. Click chip to search
          const chip = target.closest('.search-chip');
          if (chip && !target.closest('.chip-delete')) {
            const query = chip.getAttribute('data-query');
            if (query && searchInput) {
              searchInput.value = query;
              if (clearBtn) clearBtn.classList.remove('hidden');
              await executeOnlineSearch(query);
            }
            return;
          }

          // 4. Click filter pill (Todo | YouTube | SoundCloud)
          const filterPill = target.closest('[data-filter]');
          if (filterPill) {
            currentFilter = filterPill.getAttribute('data-filter');
            const query = (searchInput.value || '').trim();
            if (contentContainer) {
              contentContainer.innerHTML = renderSearchResults(currentExternalResults, query);
            }
            return;
          }

          // 5. Click genre card -> searches YouTube Music for that genre's hits!
          const genreCard = target.closest('[data-action="select-genre"]');
          if (genreCard) {
            const genreQuery = genreCard.getAttribute('data-genre-query') || genreCard.getAttribute('data-genre');
            if (searchInput) {
              searchInput.value = genreQuery;
              if (clearBtn) clearBtn.classList.remove('hidden');
              await executeOnlineSearch(genreQuery);
            }
            return;
          }

          // 6. Click "Descargar / Formatos"
          const dlBtn = target.closest('[data-action="open-download-modal"]');
          if (dlBtn) {
            const idx = parseInt(dlBtn.getAttribute('data-idx'), 10);
            if (!isNaN(idx) && currentExternalResults[idx]) {
              openFormatModal(currentExternalResults[idx]);
            }
            return;
          }

          // 7. Click "Escuchar"
          const playBtn = target.closest('[data-action="play-external"]');
          if (playBtn) {
            const idx = parseInt(playBtn.getAttribute('data-idx'), 10);
            if (!isNaN(idx) && currentExternalResults[idx]) {
              playExternalTrack(currentExternalResults[idx]);
            }
            return;
          }
        } catch (err) {
          console.error('[Search] Click error:', err);
        }
      });

      // Check query parameter from route (e.g. search?q=Nirvana)
      try {
        const queryParam = (Sonora.Router && typeof Sonora.Router.getParam === 'function') ? Sonora.Router.getParam('q') : null;
        if (queryParam && searchInput) {
          searchInput.value = queryParam;
          if (clearBtn) clearBtn.classList.remove('hidden');
          executeOnlineSearch(queryParam);
        }
      } catch (qpErr) {}
    },

    destroy() {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
        debounceTimeout = null;
      }
      rootElement = null;
      searchInput = null;
      clearBtn = null;
      historyContainer = null;
      contentContainer = null;
      currentExternalResults = [];
      closeFormatModal();
    }
  };

  // Perform live search across YouTube and SoundCloud
  async function executeOnlineSearch(rawQuery) {
    const q = rawQuery.trim();
    if (!q) return;

    if (contentContainer) {
      contentContainer.innerHTML = `
        ${renderFilterPills()}
        <div style="padding: 40px 20px; text-align: center; color: #aaa;">
          <div style="font-size: 32px; margin-bottom: 12px; animation: pulseGlow 1.2s infinite;">🌐</div>
          <div style="font-size: 15px; font-weight: 700; color: var(--color-text-primary);">Buscando en YouTube y SoundCloud...</div>
          <div style="font-size: 12px; color: var(--color-text-secondary); margin-top: 4px;">Conectando con servidores de Sonora</div>
        </div>
      `;
    }

    let results = [];
    const serverBase = getServerBaseUrl();

    // 1. Try active server (Local or Render)
    try {
      const resp = await fetch(`${serverBase}/api/search/external?q=${encodeURIComponent(q)}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        results = await resp.json();
      }
    } catch (err) {
      console.warn('[Search] Server external search failed, attempting fallback:', err);
    }

    // 2. Fallback to Render server if local failed
    if (!results || results.length === 0) {
      try {
        const renderUrl = Sonora.Store ? (Sonora.Store.get('serverRenderUrl') || 'https://sonora-music-b1ee.onrender.com') : 'https://sonora-music-b1ee.onrender.com';
        if (serverBase !== renderUrl) {
          const resp = await fetch(`${renderUrl}/api/search/external?q=${encodeURIComponent(q)}`);
          if (resp.ok) {
            results = await resp.json();
          }
        }
      } catch (e) {
        console.warn('[Search] Render fallback failed:', e);
      }
    }

    // 3. Fallback to iTunes API if both servers unreachable
    if (!results || results.length === 0) {
      try {
        const itunesResp = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=15`);
        if (itunesResp.ok) {
          const itunesData = await itunesResp.json();
          results = (itunesData.results || []).map((t, i) => ({
            id: 'it_' + t.trackId,
            title: t.trackName,
            artist: t.artistName,
            thumbnail: (t.artworkUrl100 || '').replace('100x100bb', '500x500bb'),
            platform: 'youtube',
            duration: Math.round(t.trackTimeMillis / 1000),
            durationText: formatTime(Math.round(t.trackTimeMillis / 1000)),
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(t.artistName + ' ' + t.trackName)}`
          }));
        }
      } catch (e) {}
    }

    currentExternalResults = results || [];

    if (contentContainer) {
      contentContainer.innerHTML = renderSearchResults(currentExternalResults, rawQuery);
    }
  }

  // Open Format & Download Modal
  function openFormatModal(track) {
    activeModalTrack = track;
    const modalContainer = $('#format-modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = renderFormatModal(track);

    const backdrop = $('#format-modal-backdrop', modalContainer);
    const closeBtn = $('#btn-close-format-modal', modalContainer);
    const tabMp3 = $('[data-fmt-tab="mp3"]', modalContainer);
    const tabMp4 = $('[data-fmt-tab="mp4"]', modalContainer);
    const paneMp3 = $('#fmt-pane-mp3', modalContainer);
    const paneMp4 = $('#fmt-pane-mp4', modalContainer);
    const btnBothDl = $('#btn-both-download', modalContainer);
    const btnDeviceDl = $('#btn-device-download', modalContainer);
    const btnSaveSonora = $('#btn-save-to-sonora', modalContainer);
    const btnListenNow = $('#btn-listen-now', modalContainer);

    let activeFormat = 'mp3';

    // Close handlers
    const close = () => closeFormatModal();
    if (closeBtn) closeBtn.onclick = close;
    if (backdrop) {
      backdrop.onclick = (e) => {
        if (e.target === backdrop) close();
      };
    }

    // Tab switching (MP3 vs MP4)
    if (tabMp3 && tabMp4 && paneMp3 && paneMp4) {
      tabMp3.onclick = () => {
        activeFormat = 'mp3';
        tabMp3.classList.add('active');
        tabMp4.classList.remove('active');
        paneMp3.classList.remove('hidden');
        paneMp4.classList.add('hidden');
      };
      tabMp4.onclick = () => {
        activeFormat = 'mp4';
        tabMp4.classList.add('active');
        tabMp3.classList.remove('active');
        paneMp4.classList.remove('hidden');
        paneMp3.classList.add('hidden');
      };
    }

    // Radio option styling
    modalContainer.addEventListener('change', (e) => {
      const radio = e.target.closest('input[type="radio"]');
      if (radio) {
        const parent = radio.closest('.quality-options-list');
        if (parent) {
          parent.querySelectorAll('.quality-option').forEach(el => el.classList.remove('active'));
          radio.closest('.quality-option').classList.add('active');
        }
      }
    });

    // 0. Download Both (Device + Sonora Offline) - Combined 1-click
    if (btnBothDl) {
      btnBothDl.onclick = () => {
        const qualityRadio = activeFormat === 'mp3'
          ? modalContainer.querySelector('input[name="audio-quality"]:checked')
          : modalContainer.querySelector('input[name="video-quality"]:checked');
        const quality = qualityRadio ? qualityRadio.value : (activeFormat === 'mp3' ? '320k' : '720p');

        if (Sonora.Download && typeof Sonora.Download.startDownload === 'function') {
          Sonora.Download.startDownload(track, activeFormat, quality, 'both');
        }
        close();
      };
    }

    // 1. Download to Device (Lark Player & system downloads)
    if (btnDeviceDl) {
      btnDeviceDl.onclick = () => {
        const qualityRadio = activeFormat === 'mp3'
          ? modalContainer.querySelector('input[name="audio-quality"]:checked')
          : modalContainer.querySelector('input[name="video-quality"]:checked');
        const quality = qualityRadio ? qualityRadio.value : (activeFormat === 'mp3' ? '320k' : '720p');

        if (Sonora.Download && typeof Sonora.Download.startDownload === 'function') {
          Sonora.Download.startDownload(track, activeFormat, quality, 'device');
        }
        close();
      };
    }

    // 2. Save into Sonora (Offline playback with real audio & synced lyrics)
    if (btnSaveSonora) {
      btnSaveSonora.onclick = () => {
        const qualityRadio = activeFormat === 'mp3'
          ? modalContainer.querySelector('input[name="audio-quality"]:checked')
          : modalContainer.querySelector('input[name="video-quality"]:checked');
        const quality = qualityRadio ? qualityRadio.value : (activeFormat === 'mp3' ? '320k' : '720p');

        if (Sonora.Download && typeof Sonora.Download.startDownload === 'function') {
          Sonora.Download.startDownload(track, activeFormat, quality, 'sonora');
        }
        close();
      };
    }

    // 3. Listen Now
    if (btnListenNow) {
      btnListenNow.onclick = () => {
        playExternalTrack(track);
        close();
      };
    }
  }

  function closeFormatModal() {
    activeModalTrack = null;
    const modalContainer = $('#format-modal-container');
    if (modalContainer) modalContainer.innerHTML = '';
  }

  // Play external track immediately
  function playExternalTrack(track) {
    if (!track) return;
    const serverBase = getServerBaseUrl();

    const trackObj = {
      id: track.id || ('ext_' + Date.now()),
      title: track.title,
      artist: track.artist,
      album: track.platform === 'youtube' ? 'YouTube Music' : 'SoundCloud',
      duration: track.duration || 215,
      artworkUrl: track.thumbnail,
      sourceUrl: track.url,
      streamUrl: `${serverBase}/api/stream/external?url=${encodeURIComponent(track.url)}`,
      platform: track.platform
    };

    if (Sonora.Player && typeof Sonora.Player.play === 'function') {
      Sonora.Player.play(trackObj);
      if (Sonora.Store) {
        Sonora.Store.emit('toast', { message: `Reproduciendo "${track.title}"`, type: 'info' });
      }
    }
  }

})();
