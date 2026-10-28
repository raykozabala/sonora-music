(function () {
  'use strict';

  const Sonora = window.Sonora = window.Sonora || {};
  Sonora.Pages = Sonora.Pages || {};

  /* ── Utilidades ─────────────────────────────────────────────────────── */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.floor(Number(sec) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** Duración larga legible: "1 h 32 min" (para audios/videos de horas) */
  function formatLongDuration(sec) {
    const total = Math.floor(Number(sec) || 0);
    if (total <= 0) return '';
    const h = Math.floor(total / 3600);
    const m = Math.round((total % 3600) / 60);
    if (h > 0) return h + ' h' + (m > 0 ? ' ' + m + ' min' : '');
    return m + ' min';
  }

  function formatViews(n) {
    const num = Number(n) || 0;
    if (num >= 1e9) return (num / 1e9).toFixed(1).replace('.0', '') + ' mil M';
    if (num >= 1e6) return (num / 1e6).toFixed(1).replace('.0', '') + ' M';
    if (num >= 1e3) return (num / 1e3).toFixed(1).replace('.0', '') + ' mil';
    return num > 0 ? String(num) : '';
  }

  function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (!b) return '';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function generateArtwork(id, title) {
    const numId = typeof id === 'number' ? id : (typeof id === 'string' ? (parseInt(id, 10) || id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) : 1);
    const hue = Math.abs(numId * 47) % 360;
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},70%,50%)"/><stop offset="100%" stop-color="hsl(${(hue+60)%360},70%,40%)"/></linearGradient></defs><rect fill="url(#g)" width="200" height="200" rx="12"/><text x="100" y="100" text-anchor="middle" dy=".35em" fill="white" font-size="14" font-family="sans-serif">${title ? title.substring(0, 15) : '♪'}</text></svg>`)}`;
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

  function toast(message, type) {
    if (Sonora.Store) Sonora.Store.emit('toast', { message: message, type: type || 'info' });
  }

  /* ── Catálogos ──────────────────────────────────────────────────────── */
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

  const VIDEO_CATEGORIES = [
    { name: 'Música en vivo', query: 'live concert full show 4k', gradient: 'linear-gradient(135deg, #E91E63, #880E4F)', icon: '🎤' },
    { name: 'Conciertos completos', query: 'full concert live 4k', gradient: 'linear-gradient(135deg, #FF5722, #BF360C)', icon: '🎸' },
    { name: 'Mixes épicos', query: 'epic orchestral music mix 2 hours', gradient: 'linear-gradient(135deg, #FF9800, #E65100)', icon: '🎼' },
    { name: 'Documentales', query: 'documentary full episode hd', gradient: 'linear-gradient(135deg, #3F51B5, #1A237E)', icon: '🎬' },
    { name: 'Películas clásicas', query: 'classic movie full hd', gradient: 'linear-gradient(135deg, #607D8B, #263238)', icon: '🍿' },
    { name: 'Videojuegos', query: 'gameplay walkthrough no commentary', gradient: 'linear-gradient(135deg, #9C27B0, #4A148C)', icon: '🎮' },
    { name: 'Aprender', query: 'tutorial completo español', gradient: 'linear-gradient(135deg, #00BCD4, #006064)', icon: '📚' },
    { name: 'Naturaleza 4K', query: '4k nature relaxation film', gradient: 'linear-gradient(135deg, #4CAF50, #1B5E20)', icon: '🌿' },
    { name: 'Deportes', query: 'best sports highlights', gradient: 'linear-gradient(135deg, #009688, #004D40)', icon: '⚽' },
    { name: 'Podcasts', query: 'podcast completo español', gradient: 'linear-gradient(135deg, #795548, #3E2723)', icon: '🎙️' }
  ];

  const STORAGE_KEY = 'sonora_search_history';
  const MODE_KEY = 'sonora_search_mode';

  /* ── Estado ─────────────────────────────────────────────────────────── */
  let rootElement = null;
  let searchInput = null;
  let clearBtn = null;
  let historyContainer = null;
  let contentContainer = null;
  let debounceTimeout = null;
  let currentExternalResults = [];
  let currentFilter = 'all'; // 'all' | 'youtube' | 'soundcloud'
  let contentFilters = { covers: false, noCover: false, spanish: false };
  let durationFilter = 'any'; // 'any' | 'short' | 'mid' | 'long'
  let activeModalTrack = null;

  let searchMode = 'music'; // 'music' | 'video'
  try {
    const savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode === 'video' || savedMode === 'music') searchMode = savedMode;
  } catch (e) {}

  // Cancelación de búsquedas: sólo la última petición puede pintar resultados.
  let searchController = null;
  let searchToken = 0;

  const COVER_WORDS = ['cover', 'covers', 'versión', 'version', 'tribute', 'reimagined', 'rendition', 'karaoke', 'instrumental', 'remix', 'fanmade', 'fan made'];
  const SPANISH_WORDS = ['español', 'espanol', 'esp.', 'latino', 'latina', 'castellano', 'subtitulado', 'sub español', 'traducida', 'traducido', 'en español'];

  function hasAnyWord(title, artist, words) {
    const hay = ((title || '') + ' ' + (artist || '')).toLowerCase();
    for (let i = 0; i < words.length; i++) {
      if (hay.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  function isCoverResult(r) { return hasAnyWord(r.title, r.artist, COVER_WORDS); }
  function isSpanishResult(r) { return hasAnyWord(r.title || '', r.artist || '', SPANISH_WORDS); }

  function applyDurationFilter(list) {
    return (list || []).filter(r => {
      const d = Number(r.duration) || 0;
      if (durationFilter === 'short' && !(d > 0 && d <= 300)) return false;
      if (durationFilter === 'mid' && !(d > 300 && d <= 1200)) return false;
      if (durationFilter === 'long' && !(d > 1200)) return false;
      return true;
    });
  }

  /** Aplica los filtros de contenido/duración elegidos por el usuario. */
  function applyContentFilters(list) {
    return applyDurationFilter((list || []).filter(r => {
      if (contentFilters.covers && !isCoverResult(r)) return false;
      if (contentFilters.noCover && isCoverResult(r)) return false;
      if (contentFilters.spanish && !isSpanishResult(r)) return false;
      return true;
    }));
  }

  function hasActiveContentFilters() {
    return !!(contentFilters.covers || contentFilters.noCover || contentFilters.spanish) || durationFilter !== 'any';
  }

  /* ── Historial ──────────────────────────────────────────────────────── */
  function getSearchHistory() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) { return []; }
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
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
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

  function getRenderUrl() {
    return (Sonora.Store && Sonora.Store.get('serverRenderUrl')) || 'https://sonora-music-b1ee.onrender.com';
  }

  /* ── Renderers ──────────────────────────────────────────────────────── */
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

  function renderModeToggle() {
    return `
      <div class="search-mode-toggle" role="tablist" aria-label="Tipo de búsqueda">
        <button type="button" role="tab" aria-selected="${searchMode === 'music'}" class="search-mode-btn ${searchMode === 'music' ? 'active' : ''}" data-search-mode="music">
          <span class="search-mode-emoji">🎵</span> Música
        </button>
        <button type="button" role="tab" aria-selected="${searchMode === 'video'}" class="search-mode-btn ${searchMode === 'video' ? 'active' : ''}" data-search-mode="video">
          <span class="search-mode-emoji">🎬</span> Videos
        </button>
      </div>
    `;
  }

  function renderGenreGrid() {
    const list = searchMode === 'video' ? VIDEO_CATEGORIES : GENRES;
    const title = searchMode === 'video' ? 'Explorar videos' : 'Explorar por género';
    const subtitle = searchMode === 'video' ? 'YouTube' : 'YouTube Music';

    return `
      <div class="genre-section">
        <div class="genre-section__head">
          <h2 class="search-section-title">${title}</h2>
          <span class="genre-section__tag">${subtitle}</span>
        </div>
        <div class="genre-grid">
          ${list.map(g => `
            <div class="genre-card" style="background: ${g.gradient};" data-action="select-genre" data-genre="${escapeHtml(g.name)}" data-genre-query="${escapeHtml(g.query)}">
              <span class="genre-card__name">${escapeHtml(g.name)}</span>
              <span class="genre-card__icon">${g.icon}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderDurationSelect() {
    return `
      <select id="search-duration-select" class="search-duration-select" title="Filtrar por duración">
        <option value="any" ${durationFilter === 'any' ? 'selected' : ''}>⏱️ Cualquier duración</option>
        <option value="short" ${durationFilter === 'short' ? 'selected' : ''}>≤ 5 min</option>
        <option value="mid" ${durationFilter === 'mid' ? 'selected' : ''}>5 – 20 min</option>
        <option value="long" ${durationFilter === 'long' ? 'selected' : ''}>+ 20 min (largos)</option>
      </select>
    `;
  }

  function renderFilterPills() {
    if (searchMode === 'video') {
      return `
        <div class="search-filter-pills">
          <button type="button" class="filter-pill ${durationFilter === 'any' ? 'active' : ''}" data-duration-quick="any">🌐 Todos</button>
          <button type="button" class="filter-pill ${durationFilter === 'short' ? 'active' : ''}" data-duration-quick="short">⚡ Cortos</button>
          <button type="button" class="filter-pill ${durationFilter === 'mid' ? 'active' : ''}" data-duration-quick="mid">🎬 Medios</button>
          <button type="button" class="filter-pill ${durationFilter === 'long' ? 'active' : ''}" data-duration-quick="long">⏳ Largos (+20 min)</button>
        </div>
      `;
    }

    return `
      <div class="search-filter-pills">
        <button type="button" class="filter-pill ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">🌐 Todo</button>
        <button type="button" class="filter-pill ${currentFilter === 'youtube' ? 'active' : ''}" data-filter="youtube">🔴 YouTube</button>
        <button type="button" class="filter-pill ${currentFilter === 'soundcloud' ? 'active' : ''}" data-filter="soundcloud">🟠 SoundCloud</button>
      </div>
      <div class="search-filter-pills" style="padding-top:0;">
        <button type="button" class="filter-pill ${contentFilters.covers ? 'active' : ''}" data-cfilter="covers">🎤 Covers</button>
        <button type="button" class="filter-pill ${contentFilters.noCover ? 'active' : ''}" data-cfilter="noCover">🎧 Sin covers</button>
        <button type="button" class="filter-pill ${contentFilters.spanish ? 'active' : ''}" data-cfilter="spanish">🇪🇸 Español</button>
        ${renderDurationSelect()}
        ${hasActiveContentFilters() ? `<button type="button" class="filter-pill" data-cfilter="clear">✕ Quitar filtros</button>` : ''}
      </div>
    `;
  }

  function reRenderResults() {
    if (!contentContainer) return;
    const query = ((searchInput && searchInput.value) || '').trim();
    contentContainer.innerHTML = renderSearchResults(currentExternalResults, query);
  }

  function findResultByKey(key) {
    if (key === null || key === undefined) return null;
    return currentExternalResults.find(function (r) {
      return String(r.id) === String(key) || (r.videoId && String(r.videoId) === String(key));
    }) || null;
  }

  function renderMusicCard(item, key) {
    const isYT = item.platform === 'youtube';
    const platformLabel = isYT ? 'YouTube' : (item.platform === 'soundcloud' ? 'SoundCloud' : 'Online');
    const platformColor = isYT ? '#FF0000' : '#FF5500';
    const dur = item.durationText || formatTime(item.duration);
    const longSec = Number(item.duration) || 0;
    const isLong = longSec >= 1200;

    return `
      <div class="external-track-card" data-key="${escapeHtml(key)}">
        <div class="external-track-art-wrap">
          <img src="${escapeHtml(item.thumbnail || generateArtwork(key, item.title))}" alt="" class="external-track-art" loading="lazy" onerror="this.onerror=null;this.src=''" />
          <span class="external-track-duration">${escapeHtml(dur)}</span>
        </div>
        <div class="external-track-info">
          <div class="external-track-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="external-track-meta">
            <span class="platform-badge" style="background: ${platformColor};">${platformLabel}</span>
            <span class="external-track-artist">${escapeHtml(item.artist || 'Artista')}</span>
            ${isLong ? `<span class="external-track-long" title="Contenido largo">⏱️ ${escapeHtml(formatLongDuration(longSec))}</span>` : ''}
          </div>
          <div class="external-track-actions">
            <button type="button" class="btn-action-download" data-action="open-download-modal" data-key="${escapeHtml(key)}">
              ⬇️ Formatos
            </button>
            <button type="button" class="btn-action-play" data-action="play-external" data-key="${escapeHtml(key)}">
              ▶️ Escuchar
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderVideoCard(item, key) {
    const dur = item.durationText || formatTime(item.duration);
    const views = formatViews(item.views);
    const metaParts = [item.artist || item.channel || 'YouTube'];
    if (views) metaParts.push(views + ' vistas');
    if (item.ago) metaParts.push(item.ago);
    const isLong = (Number(item.duration) || 0) >= 1200;

    return `
      <div class="video-result-card" data-key="${escapeHtml(key)}">
        <div class="video-result-thumb" data-action="play-video-result" data-key="${escapeHtml(key)}">
          <img src="${escapeHtml(item.thumbnail || generateArtwork(key, item.title))}" alt="" loading="lazy" onerror="this.onerror=null;this.src=''" />
          <span class="video-result-duration">${escapeHtml(dur)}</span>
          <span class="video-result-play" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          </span>
        </div>
        <div class="video-result-info">
          <div class="video-result-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="video-result-meta">${metaParts.map(escapeHtml).join(' · ')}</div>
          <div class="video-result-badges">
            <span class="platform-badge" style="background:#FF0000;">YouTube</span>
            ${isLong ? `<span class="external-track-long">⏳ ${escapeHtml(formatLongDuration(item.duration))}</span>` : ''}
          </div>
          <div class="video-result-actions">
            <button type="button" class="btn-action-play" data-action="play-video-result" data-key="${escapeHtml(key)}">▶️ Ver</button>
            <button type="button" class="btn-action-download" data-action="open-video-modal" data-key="${escapeHtml(key)}">⬇️ Descargar</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderSearchResults(results, query) {
    const total = (results || []).length;
    let filtered = (results || []).slice();

    if (searchMode === 'music') {
      filtered = filtered.filter(r => {
        if (currentFilter === 'youtube' && r.platform !== 'youtube') return false;
        if (currentFilter === 'soundcloud' && r.platform !== 'soundcloud') return false;
        return true;
      });
      filtered = applyContentFilters(filtered);
    } else {
      filtered = applyDurationFilter(filtered);
    }

    if (!filtered || filtered.length === 0) {
      const hasFilters = searchMode === 'video' ? durationFilter !== 'any' : hasActiveContentFilters();
      const filtMsg = hasFilters && total > 0
        ? 'Ningún resultado con esos filtros. Prueba a quitarlos.'
        : `No pudimos encontrar nada para "${escapeHtml(query)}". Intenta con otra palabra clave o pega un enlace de YouTube.`;
      return `
        ${renderFilterPills()}
        <div class="search-empty-state">
          <div class="search-empty-icon">🔍</div>
          <h3 class="search-empty-title">${hasFilters && total > 0 ? 'Sin resultados con esos filtros' : 'Sin resultados online'}</h3>
          <p class="search-empty-desc">${filtMsg}</p>
        </div>
      `;
    }

    const cards = filtered.map(function (item, idx) {
      // La clave es el id real del resultado, NO la posición dentro del array
      // filtrado. Antes se usaba el índice y con filtros activos se
      // reproducía/descargaba otra canción distinta.
      const key = item.id || item.videoId || ('idx_' + idx);
      return searchMode === 'video' ? renderVideoCard(item, key) : renderMusicCard(item, key);
    }).join('');

    return `
      ${renderFilterPills()}
      <div class="results-group">
        <div class="results-group__head">
          <h2 class="search-section-title">${searchMode === 'video' ? 'Videos' : 'Resultados'} (${filtered.length}${filtered.length !== total ? ' de ' + total : ''})</h2>
          <span class="results-group__tag">${searchMode === 'video' ? 'YouTube' : 'YouTube & SoundCloud'}</span>
        </div>
        <div class="${searchMode === 'video' ? 'video-results-list' : 'tracks-list-external'}">
          ${cards}
        </div>
      </div>
    `;
  }

  /* ── Modal de audio (MP3/MP4) ───────────────────────────────────────── */
  function renderFormatModal(track) {
    if (!track) return '';
    const isYT = track.platform === 'youtube';
    const dur = track.durationText || formatTime(track.duration);

    return `
      <div id="format-modal-backdrop" class="modal-backdrop">
        <div class="format-modal-sheet">
          <div class="format-modal-handle"></div>
          <div class="format-modal-header">
            <img src="${escapeHtml(track.thumbnail || '')}" class="format-modal-thumb" alt="" onerror="this.onerror=null;this.src=''" />
            <div class="format-modal-info">
              <div class="format-modal-title">${escapeHtml(track.title)}</div>
              <div class="format-modal-artist">${escapeHtml(track.artist || '')} • ${escapeHtml(dur)}</div>
              <span class="platform-badge" style="background:${isYT ? '#FF0000' : '#FF5500'}; display:inline-block; margin-top:4px;">${isYT ? 'YouTube Music' : 'SoundCloud'}</span>
            </div>
            <button id="btn-close-format-modal" class="modal-close-btn" aria-label="Cerrar">&times;</button>
          </div>

          <div class="format-tabs-selector">
            <button type="button" class="fmt-tab-btn active" data-fmt-tab="mp3">🎵 Audio MP3</button>
            <button type="button" class="fmt-tab-btn" data-fmt-tab="mp4">🎬 Video MP4</button>
          </div>

          <div id="fmt-pane-mp3" class="fmt-pane">
            <div class="quality-options-list">
              <label class="quality-option active">
                <input type="radio" name="audio-quality" value="320k" checked />
                <div class="quality-info">
                  <div class="quality-label">Alta Calidad (320 kbps)</div>
                  <div class="quality-sub">Máxima fidelidad de audio</div>
                </div>
                <span class="quality-badge">Recomendado</span>
              </label>
              <label class="quality-option">
                <input type="radio" name="audio-quality" value="192k" />
                <div class="quality-info">
                  <div class="quality-label">Calidad Estándar (192 kbps)</div>
                  <div class="quality-sub">Fidelidad equilibrada</div>
                </div>
              </label>
              <label class="quality-option">
                <input type="radio" name="audio-quality" value="128k" />
                <div class="quality-info">
                  <div class="quality-label">Ahorro de Espacio (128 kbps)</div>
                  <div class="quality-sub">Descarga más rápida</div>
                </div>
              </label>
            </div>
          </div>

          <div id="fmt-pane-mp4" class="fmt-pane hidden">
            <div class="quality-options-list">
              <label class="quality-option">
                <input type="radio" name="video-quality" value="1080p" />
                <div class="quality-info">
                  <div class="quality-label">Full HD 1080p</div>
                  <div class="quality-sub">Máxima nitidez • se guarda como video</div>
                </div>
              </label>
              <label class="quality-option active">
                <input type="radio" name="video-quality" value="720p" checked />
                <div class="quality-info">
                  <div class="quality-label">HD 720p</div>
                  <div class="quality-sub">Excelente calidad visual • se guarda como video</div>
                </div>
                <span class="quality-badge">Recomendado</span>
              </label>
              <label class="quality-option">
                <input type="radio" name="video-quality" value="360p" />
                <div class="quality-info">
                  <div class="quality-label">Móvil Rápido 360p</div>
                  <div class="quality-sub">Menor consumo de datos</div>
                </div>
              </label>
            </div>
          </div>

          <div class="format-modal-actions">
            ${isYT ? `<button type="button" id="btn-watch-as-video" class="btn-modal-action btn-watch-video">
              🎬 Ver como video en Sonora
              <span class="btn-action-sub">Reproductor de video con velocidad, subtítulos, bucle y pantalla completa</span>
            </button>` : ''}

            <button type="button" id="btn-both-download" class="btn-modal-action btn-both-dl">
              ⚡ Descargar en Ambos (Dispositivo + Sonora Offline)
              <span class="btn-action-sub">Guarda el archivo en Descargas y también dentro de Sonora</span>
            </button>

            <button type="button" id="btn-device-download" class="btn-modal-action btn-device-dl">
              📱 Descargar al Dispositivo
              <span class="btn-action-sub">Guardar archivo en Descargas del teléfono</span>
            </button>

            <button type="button" id="btn-save-to-sonora" class="btn-modal-action btn-sonora-save">
              📥 Guardar en Sonora (Modo Offline)
              <span class="btn-action-sub">Añadir a tu biblioteca para escuchar sin internet</span>
            </button>

            <button type="button" id="btn-listen-now" class="btn-modal-action btn-listen-now">
              ▶️ Escuchar Ahora en Sonora
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /* ── Modal de video ─────────────────────────────────────────────────── */
  function renderVideoModal(video) {
    if (!video) return '';
    const dur = video.durationText || formatTime(video.duration);

    return `
      <div id="format-modal-backdrop" class="modal-backdrop">
        <div class="format-modal-sheet video-modal-sheet">
          <div class="format-modal-handle"></div>
          <div class="video-modal-preview">
            <img src="${escapeHtml(video.thumbnail || '')}" alt="" onerror="this.onerror=null;this.src=''" />
            <span class="video-result-duration">${escapeHtml(dur)}</span>
            <span class="video-modal-preview-badge">VIDEO</span>
          </div>
          <div class="format-modal-header video-modal-header">
            <div class="format-modal-info">
              <div class="format-modal-title">${escapeHtml(video.title)}</div>
              <div class="format-modal-artist">${escapeHtml(video.artist || video.channel || 'YouTube')} • ${escapeHtml(dur)}</div>
            </div>
            <button id="btn-close-format-modal" class="modal-close-btn" aria-label="Cerrar">&times;</button>
          </div>

          <div class="video-modal-section-title">Calidad del video</div>
          <div id="video-quality-list" class="quality-options-list">
            <div class="video-quality-loading">Consultando calidades disponibles…</div>
          </div>

          <div class="format-modal-actions">
            <button type="button" id="btn-video-play" class="btn-modal-action btn-watch-video">
              ▶️ Reproducir ahora
              <span class="btn-action-sub">Con velocidad, subtítulos, bucle y pantalla completa</span>
            </button>
            <button type="button" id="btn-video-save-sonora" class="btn-modal-action btn-sonora-save">
              📥 Guardar en Sonora (Offline)
              <span class="btn-action-sub">Se descarga completo para verlo sin internet</span>
            </button>
            <button type="button" id="btn-video-device" class="btn-modal-action btn-device-dl">
              📱 Descargar al Dispositivo
              <span class="btn-action-sub">Guardar el MP4 en Descargas del teléfono</span>
            </button>
            <button type="button" id="btn-video-both" class="btn-modal-action btn-both-dl">
              ⚡ Descargar en Ambos
              <span class="btn-action-sub">Offline en Sonora + archivo en Descargas</span>
            </button>
            <button type="button" id="btn-video-audio" class="btn-modal-action btn-listen-now">
              🎵 Descargar solo audio (MP3)
              <span class="btn-action-sub">Convierte el video en música para escucharla en Sonora</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function selectedVideoQuality(container) {
    const radio = container.querySelector('input[name="video-quality-dyn"]:checked') ||
      container.querySelector('input[name="video-quality"]:checked');
    return radio ? radio.value : '720p';
  }

  function runDownload(track, format, quality, mode) {
    if (!Sonora.Download) {
      toast('El gestor de descargas no está disponible', 'error');
      return;
    }
    // Los MP4 SIEMPRE van al gestor de video (antes se guardaba audio por error).
    if (format === 'mp4') {
      return Sonora.Download.startVideoDownload(track, quality, mode);
    }
    return Sonora.Download.startDownload(track, format, quality, mode);
  }

  /* ── Página ─────────────────────────────────────────────────────────── */
  Sonora.Pages.Search = {
    render() {
      return `
        <div class="page page-search">
          <style>
            .page-search {
              padding-bottom: 120px;
              padding-left: 0;
              padding-right: 0;
              min-height: 100vh;
              color: var(--color-text-primary);
              background: var(--color-background);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            .search-header-sticky {
              position: sticky;
              top: 0;
              z-index: 100;
              background: var(--color-surface-elevated);
              backdrop-filter: blur(16px);
              -webkit-backdrop-filter: blur(16px);
              padding: 10px 16px 10px;
              box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            }

            /* Selector Música / Videos */
            .search-mode-toggle {
              display: flex;
              gap: 6px;
              background: rgba(255,255,255,0.06);
              border: 1px solid rgba(255,255,255,0.08);
              border-radius: 14px;
              padding: 4px;
              margin-bottom: 10px;
            }
            .search-mode-btn {
              flex: 1 1 0;
              min-width: 0;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              background: transparent;
              border: none;
              color: var(--color-text-secondary);
              font-size: 13px;
              font-weight: 700;
              padding: 9px 8px;
              border-radius: 10px;
              cursor: pointer;
              transition: background 0.2s, color 0.2s, box-shadow 0.2s;
              white-space: nowrap;
            }
            .search-mode-btn.active {
              background: var(--color-primary, #FF4757);
              color: #fff;
              box-shadow: 0 4px 14px rgba(255,71,87,0.4);
            }
            .search-mode-emoji { font-size: 15px; line-height: 1; }

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
              flex: 0 0 auto;
            }
            .search-bar__input {
              flex: 1 1 auto;
              min-width: 0;
              width: 100%;
              background: transparent;
              border: none;
              outline: none;
              color: var(--color-text-primary);
              font-size: 15px;
              font-weight: 500;
              height: 100%;
              text-overflow: ellipsis;
            }
            .search-bar__input::placeholder {
              color: var(--color-text-secondary);
              opacity: 0.85;
            }
            .search-bar__input:focus,
            .search-bar__input:focus-visible {
              outline: none;
              box-shadow: none;
            }
            .search-bar__clear {
              background: rgba(255, 255, 255, 0.15);
              border: none;
              color: var(--color-text-primary);
              width: 24px;
              height: 24px;
              min-width: 24px;
              min-height: 24px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 14px;
              cursor: pointer;
              flex: 0 0 auto;
            }
            .search-bar__clear.hidden { display: none; }

            /* Pastillas de filtro */
            .search-filter-pills {
              display: flex;
              gap: 8px;
              padding: 10px 16px 12px;
              overflow-x: auto;
              overflow-y: hidden;
              scrollbar-width: none;
              -webkit-overflow-scrolling: touch;
            }
            .search-filter-pills::-webkit-scrollbar { display: none; }
            .filter-pill {
              flex: 0 0 auto;
              min-width: 0;
              min-height: 36px;
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
              color: #fff;
            }
            .search-duration-select {
              flex: 0 0 auto;
              background: var(--color-surface-elevated);
              color: var(--color-text-primary);
              border: 1px solid var(--color-card-border, rgba(255,255,255,0.08));
              border-radius: 20px;
              padding: 6px 12px;
              font-size: 12px;
              font-weight: 600;
              white-space: nowrap;
            }

            /* Enlace directo */
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
              gap: 10px;
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
              min-width: 0;
              min-height: 0;
              padding: 4px 6px;
            }

            /* Historial */
            .search-history-wrapper { padding: 8px 16px 12px; }
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
              min-width: 0;
              min-height: 0;
              padding: 4px;
            }
            .search-chips-row { display: flex; flex-wrap: wrap; gap: 8px; }
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
              min-width: 0;
              min-height: 0;
            }

            /* Géneros / categorías */
            .genre-section { padding: 8px 16px; }
            .genre-section__head {
              display: flex;
              justify-content: space-between;
              align-items: baseline;
              gap: 12px;
              margin: 16px 0 12px;
            }
            .search-section-title {
              font-size: 17px;
              font-weight: 700;
              color: var(--color-text-primary);
              margin: 0;
              min-width: 0;
            }
            .genre-section__tag {
              font-size: 12px;
              color: var(--color-primary, #FF4757);
              font-weight: 600;
              flex: 0 0 auto;
            }
            .genre-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
            }
            .genre-card {
              height: 84px;
              min-width: 0;
              border-radius: 12px;
              padding: 12px;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              cursor: pointer;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              transition: transform 0.18s ease, box-shadow 0.18s ease;
              overflow: hidden;
            }
            .genre-card:active { transform: scale(0.97); }
            .genre-card__name {
              font-size: 14px;
              font-weight: 700;
              color: #fff;
              min-width: 0;
              max-width: 100%;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              line-height: 1.2;
            }
            .genre-card__icon {
              font-size: 24px;
              align-self: flex-end;
              line-height: 1;
            }

            /* Tarjetas de audio */
            .tracks-list-external {
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            .results-group { padding: 0 16px; }
            .results-group__head {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 10px;
              margin-bottom: 12px;
            }
            .results-group__tag {
              font-size: 11px;
              color: #aaa;
              font-weight: 600;
              flex: 0 0 auto;
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
              animation: trackIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
              transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
            }
            .external-track-art-wrap {
              width: 80px;
              height: 80px;
              border-radius: 8px;
              overflow: hidden;
              position: relative;
              background: var(--color-surface-elevated);
              flex: 0 0 80px;
            }
            .external-track-art {
              width: 100%;
              height: 100%;
              object-fit: cover;
              transition: transform 0.28s ease;
            }
            .external-track-duration {
              position: absolute;
              bottom: 4px;
              right: 4px;
              background: rgba(0,0,0,0.8);
              color: #fff;
              font-size: 10px;
              font-weight: 700;
              padding: 1px 5px;
              border-radius: 4px;
              line-height: 1.5;
              max-width: calc(100% - 8px);
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .external-track-info { flex: 1 1 auto; min-width: 0; }
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
              flex-wrap: wrap;
              gap: 6px;
              margin: 4px 0 8px;
            }
            .platform-badge {
              font-size: 10px;
              font-weight: 700;
              padding: 2px 6px;
              border-radius: 4px;
              color: #fff;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              flex: 0 0 auto;
            }
            .external-track-artist {
              font-size: 12px;
              color: var(--color-text-secondary);
              min-width: 0;
              max-width: 100%;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .external-track-long {
              font-size: 10px;
              font-weight: 700;
              color: #ffb74d;
              background: rgba(255, 152, 0, 0.14);
              border: 1px solid rgba(255, 152, 0, 0.35);
              border-radius: 6px;
              padding: 1px 6px;
              white-space: nowrap;
              flex: 0 0 auto;
            }
            .external-track-actions {
              display: flex;
              gap: 8px;
              flex-wrap: wrap;
              justify-content: flex-end;
            }
            .btn-action-download {
              background: var(--color-primary, #FF4757);
              color: #fff;
              border: none;
              border-radius: 18px;
              padding: 6px 12px;
              font-size: 11px;
              font-weight: 700;
              cursor: pointer;
              min-width: 0;
              min-height: 32px;
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
              min-width: 0;
              min-height: 32px;
            }

            /* Tarjetas de video */
            .video-results-list {
              display: flex;
              flex-direction: column;
              gap: 14px;
            }
            .video-result-card {
              display: flex;
              gap: 12px;
              background: var(--color-surface);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.07));
              border-radius: 14px;
              padding: 10px;
              box-shadow: 0 4px 16px rgba(0,0,0,0.3);
              animation: trackIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            .video-result-thumb {
              position: relative;
              width: 132px;
              height: 76px;
              flex: 0 0 132px;
              border-radius: 9px;
              overflow: hidden;
              background: #000;
              cursor: pointer;
            }
            .video-result-thumb img {
              width: 100%;
              height: 100%;
              object-fit: cover;
              transition: transform 0.25s ease;
            }
            .video-result-card:hover .video-result-thumb img { transform: scale(1.06); }
            .video-result-duration {
              position: absolute;
              bottom: 4px;
              right: 4px;
              background: rgba(0,0,0,0.82);
              color: #fff;
              font-size: 10px;
              font-weight: 700;
              padding: 1px 5px;
              border-radius: 4px;
              line-height: 1.5;
              max-width: calc(100% - 8px);
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .video-result-play {
              position: absolute;
              inset: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #fff;
              background: rgba(0,0,0,0.25);
              opacity: 0;
              transition: opacity 0.2s;
            }
            .video-result-card:hover .video-result-play { opacity: 1; }
            .video-result-info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
            .video-result-title {
              font-size: 14px;
              font-weight: 700;
              line-height: 1.3;
              color: var(--color-text-primary);
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            }
            .video-result-meta {
              font-size: 11.5px;
              color: var(--color-text-secondary);
              margin-top: 3px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .video-result-badges {
              display: flex;
              align-items: center;
              gap: 6px;
              flex-wrap: wrap;
              margin-top: 5px;
            }
            .video-result-actions {
              display: flex;
              gap: 8px;
              margin-top: auto;
              padding-top: 7px;
            }

            /* Estado vacío */
            .search-empty-state { padding: 40px 20px; text-align: center; }
            .search-empty-icon { font-size: 40px; margin-bottom: 8px; }
            .search-empty-title {
              font-size: 16px;
              font-weight: 700;
              color: var(--color-text-primary);
              margin-bottom: 4px;
            }
            .search-empty-desc { font-size: 13px; color: var(--color-text-secondary); }

            /* Cargando */
            .search-loading { padding: 44px 20px; text-align: center; }
            .search-loading__icon {
              font-size: 32px;
              margin-bottom: 12px;
              animation: pulseGlow 1.2s infinite;
            }
            .search-loading__title {
              font-size: 15px;
              font-weight: 700;
              color: var(--color-text-primary);
            }
            .search-loading__sub {
              font-size: 12px;
              color: var(--color-text-secondary);
              margin-top: 4px;
            }

            /* Modal */
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
              max-height: 88vh;
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
              flex: 0 0 60px;
            }
            .format-modal-info { flex: 1 1 auto; min-width: 0; }
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
              min-width: 28px;
              min-height: 28px;
              border-radius: 50%;
              font-size: 18px;
              cursor: pointer;
              flex: 0 0 28px;
            }

            /* Modal de video */
            .video-modal-preview {
              position: relative;
              width: 100%;
              aspect-ratio: 16 / 9;
              border-radius: 12px;
              overflow: hidden;
              background: #000;
              margin-bottom: 12px;
            }
            .video-modal-preview img { width: 100%; height: 100%; object-fit: cover; }
            .video-modal-preview-badge {
              position: absolute;
              top: 8px;
              left: 8px;
              background: #FF0000;
              color: #fff;
              font-size: 10px;
              font-weight: 800;
              letter-spacing: 0.5px;
              padding: 3px 7px;
              border-radius: 5px;
            }
            .video-modal-header { padding-bottom: 10px; }
            .video-modal-section-title {
              font-size: 12px;
              font-weight: 700;
              color: var(--color-text-secondary);
              text-transform: uppercase;
              letter-spacing: 0.6px;
              margin: 14px 0 8px;
            }
            .video-quality-loading {
              padding: 14px;
              text-align: center;
              color: var(--color-text-secondary);
              font-size: 12px;
              background: rgba(255,255,255,0.03);
              border-radius: 10px;
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
              color: #fff;
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
            .quality-option input { flex: 0 0 auto; }
            .quality-info { flex: 1 1 auto; min-width: 0; }
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
              flex: 0 0 auto;
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
              min-height: 44px;
            }
            .btn-action-sub { font-size: 11px; font-weight: 400; opacity: 0.85; }
            .btn-both-dl {
              background: linear-gradient(135deg, #FF4757 0%, #FF6B35 50%, #FFA502 100%);
              color: #fff;
              box-shadow: 0 4px 18px rgba(255, 71, 87, 0.45);
              border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .btn-device-dl { background: #2ed573; color: #06210f; }
            .btn-sonora-save { background: var(--color-primary, #FF4757); color: #fff; }
            .btn-watch-video { background: #FF0000; color: #fff; }
            .btn-listen-now {
              background: rgba(255,255,255,0.12);
              border: 1px solid rgba(255,255,255,0.15);
              color: var(--color-text-primary);
              text-align: center;
              align-items: center;
            }

            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            @keyframes trackIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

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
            .external-track-card:hover .external-track-art { transform: scale(1.07); }
            .genre-card:hover { box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); }

            @media (min-width: 560px) { .genre-grid { grid-template-columns: 1fr 1fr 1fr; } }
            @media (min-width: 860px) { .genre-grid { grid-template-columns: repeat(4, 1fr); } }
            @media (max-width: 370px) {
              .external-track-card { gap: 8px; padding: 8px; }
              .external-track-art-wrap { width: 64px; height: 64px; flex-basis: 64px; }
              .external-track-title { font-size: 13px; }
              .video-result-thumb { width: 104px; height: 60px; flex-basis: 104px; }
              .video-result-title { font-size: 13px; }
            }
          </style>

          <div class="search-header-sticky">
            ${renderModeToggle()}
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
                placeholder="${searchMode === 'video' ? 'Busca videos en YouTube…' : 'Busca canciones, artistas o enlaces…'}"
                autocomplete="off"
                autocapitalize="none"
                enterkeyhint="search"
              />
              <button class="search-bar__clear hidden" id="search-clear" aria-label="Limpiar búsqueda">&times;</button>
            </div>
          </div>

          <div class="direct-url-box">
            <div class="direct-url-toggle" id="btn-toggle-direct-url">
              <span>🔗 Pegar enlace directo (YouTube / SoundCloud)</span>
              <button type="button" id="btn-direct-toggle-label">Abrir</button>
            </div>
            <div id="direct-url-pane" class="hidden" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
              <div style="display:flex; gap:8px;">
                <input type="url" id="direct-url-input" placeholder="https://www.youtube.com/watch?v=..." style="flex:1; min-width:0; background:var(--color-surface); border:1px solid rgba(255,255,255,0.2); border-radius:8px; padding:8px 12px; font-size:12px; color:var(--color-text-primary);" />
                <button type="button" id="btn-direct-resolve" style="background:var(--color-primary, #FF4757); color:#fff; border:none; border-radius:8px; padding:0 14px; font-size:12px; font-weight:700; cursor:pointer; min-width:0;">Buscar</button>
              </div>
            </div>
          </div>

          <div id="search-history-container">
            ${renderHistoryChips()}
          </div>

          <div id="search-content">
            ${renderGenreGrid()}
          </div>

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

      const onInput = () => {
        const query = (searchInput.value || '').trim();
        if (clearBtn) {
          if (query.length > 0) clearBtn.classList.remove('hidden');
          else clearBtn.classList.add('hidden');
        }

        if (debounceTimeout) clearTimeout(debounceTimeout);

        if (!query) {
          cancelActiveSearch();
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

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = (searchInput.value || '').trim();
          if (query) {
            addSearchHistory(query);
            if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
            searchInput.blur();
            if (debounceTimeout) clearTimeout(debounceTimeout);
            executeOnlineSearch(query);
          }
        }
      });

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          cancelActiveSearch();
          searchInput.value = '';
          clearBtn.classList.add('hidden');
          if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
          contentContainer.innerHTML = renderGenreGrid();
          currentExternalResults = [];
          contentFilters = { covers: false, noCover: false, spanish: false };
          durationFilter = 'any';
          searchInput.focus();
        });
      }

      rootElement.addEventListener('change', (e) => {
        const sel = e.target && e.target.closest ? e.target.closest('#search-duration-select') : null;
        if (!sel) return;
        durationFilter = sel.value || 'any';
        reRenderResults();
      });

      // Enlace directo
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
            toast('Pega un enlace de YouTube o SoundCloud', 'warning');
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

            if (isYT) {
              // En modo video (o si el enlace es de YouTube) abrimos la ficha de
              // video con calidades reales del servidor.
              const video = {
                id: ytVideoId ? ('ytv_' + ytVideoId) : ('ytv_' + Date.now()),
                videoId: ytVideoId,
                kind: 'video',
                title: 'Video de YouTube',
                artist: 'YouTube',
                thumbnail: ytVideoId ? ('https://i.ytimg.com/vi/' + ytVideoId + '/hqdefault.jpg') : '',
                platform: 'youtube',
                url: normalizedUrl,
                duration: 0,
                durationText: ''
              };
              await enrichVideoFromServer(video);
              openVideoModal(video);
            } else {
              let data = null;
              try {
                const resp = await fetch('https://soundcloud.com/oembed?url=' + encodeURIComponent(normalizedUrl) + '&format=json');
                if (resp.ok) data = await resp.json();
              } catch (fetchErr) {}
              const trackObj = {
                id: 'ext_' + Date.now(),
                title: (data && data.title) ? data.title : 'Pista de SoundCloud',
                artist: (data && data.author_name) ? data.author_name : 'SoundCloud',
                thumbnail: (data && data.thumbnail_url) ? data.thumbnail_url : '',
                platform: 'soundcloud',
                url: normalizedUrl,
                duration: 210,
                durationText: '3:30'
              };
              openFormatModal(trackObj);
            }
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            directResolveBtn.disabled = false;
            directResolveBtn.textContent = 'Buscar';
          }
        });
      }

      // Delegación de clics
      rootElement.addEventListener('click', async (e) => {
        try {
          const target = e.target;
          if (!target) return;

          const removeChipBtn = target.closest('[data-action="remove-chip"]');
          if (removeChipBtn) {
            e.stopPropagation();
            removeSearchHistory(removeChipBtn.getAttribute('data-query'));
            if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
            return;
          }

          const clearAllBtn = target.closest('[data-action="clear-all-history"]');
          if (clearAllBtn) {
            clearAllSearchHistory();
            if (historyContainer) historyContainer.innerHTML = renderHistoryChips();
            return;
          }

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

          // Cambio de modo Música / Videos
          const modeBtn = target.closest('[data-search-mode]');
          if (modeBtn) {
            const nextMode = modeBtn.getAttribute('data-search-mode');
            if (nextMode && nextMode !== searchMode) {
              searchMode = nextMode;
              try { localStorage.setItem(MODE_KEY, searchMode); } catch (err) {}
              $$('[data-search-mode]', rootElement).forEach(function (btn) {
                btn.classList.toggle('active', btn.getAttribute('data-search-mode') === searchMode);
                btn.setAttribute('aria-selected', btn.getAttribute('data-search-mode') === searchMode ? 'true' : 'false');
              });
              if (searchInput) {
                searchInput.placeholder = searchMode === 'video'
                  ? 'Busca videos en YouTube…'
                  : 'Busca canciones, artistas o enlaces…';
              }
              const query = ((searchInput && searchInput.value) || '').trim();
              if (query) {
                await executeOnlineSearch(query);
              } else {
                currentExternalResults = [];
                contentContainer.innerHTML = renderGenreGrid();
              }
            }
            return;
          }

          const filterPill = target.closest('[data-filter]');
          if (filterPill) {
            currentFilter = filterPill.getAttribute('data-filter');
            reRenderResults();
            return;
          }

          const quickDuration = target.closest('[data-duration-quick]');
          if (quickDuration) {
            durationFilter = quickDuration.getAttribute('data-duration-quick') || 'any';
            reRenderResults();
            return;
          }

          const cFilterBtn = target.closest('[data-cfilter]');
          if (cFilterBtn) {
            const key = cFilterBtn.getAttribute('data-cfilter');
            if (key === 'clear') {
              contentFilters = { covers: false, noCover: false, spanish: false };
              durationFilter = 'any';
            } else if (key === 'covers') {
              contentFilters.covers = !contentFilters.covers;
              if (contentFilters.covers) contentFilters.noCover = false;
            } else if (key === 'noCover') {
              contentFilters.noCover = !contentFilters.noCover;
              if (contentFilters.noCover) contentFilters.covers = false;
            } else if (key === 'spanish') {
              contentFilters.spanish = !contentFilters.spanish;
            }
            reRenderResults();
            return;
          }

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

          // Descargar / formatos (audio)
          const dlBtn = target.closest('[data-action="open-download-modal"]');
          if (dlBtn) {
            const item = findResultByKey(dlBtn.getAttribute('data-key'));
            if (item) openFormatModal(item);
            return;
          }

          // Ver video
          const playVideoBtn = target.closest('[data-action="play-video-result"]');
          if (playVideoBtn) {
            const item = findResultByKey(playVideoBtn.getAttribute('data-key'));
            if (item) playExternalTrack(item);
            return;
          }

          // Modal de video
          const videoModalBtn = target.closest('[data-action="open-video-modal"]');
          if (videoModalBtn) {
            const item = findResultByKey(videoModalBtn.getAttribute('data-key'));
            if (item) openVideoModal(item);
            return;
          }

          // Escuchar audio
          const playBtn = target.closest('[data-action="play-external"]');
          if (playBtn) {
            const item = findResultByKey(playBtn.getAttribute('data-key'));
            if (item) playExternalTrack(item);
            return;
          }
        } catch (err) {
          console.error('[Search] Click error:', err);
        }
      });

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
      cancelActiveSearch();
      rootElement = null;
      searchInput = null;
      clearBtn = null;
      historyContainer = null;
      contentContainer = null;
      currentExternalResults = [];
      closeFormatModal();
    }
  };

  function cancelActiveSearch() {
    if (searchController) {
      try { searchController.abort(); } catch (e) {}
      searchController = null;
    }
    searchToken++;
  }

  /* ── Búsqueda online ────────────────────────────────────────────────── */
  async function executeOnlineSearch(rawQuery) {
    const q = String(rawQuery || '').trim();
    if (!q) return;

    // Cancela la petición anterior: una respuesta vieja ya no puede pisar
    // los resultados de la búsqueda nueva.
    if (searchController) {
      try { searchController.abort(); } catch (e) {}
    }
    const controller = new AbortController();
    searchController = controller;
    const token = ++searchToken;

    if (contentContainer) {
      contentContainer.innerHTML = `
        ${renderFilterPills()}
        <div class="search-loading">
          <div class="search-loading__icon">${searchMode === 'video' ? '🎬' : '🌐'}</div>
          <div class="search-loading__title">${searchMode === 'video' ? 'Buscando videos en YouTube…' : 'Buscando en YouTube y SoundCloud…'}</div>
          <div class="search-loading__sub">Conectando con los servidores de Sonora</div>
        </div>
      `;
    }

    const modeParam = searchMode === 'video' ? '&mode=video' : '';
    const serverBase = getServerBaseUrl();
    let results = [];

    async function tryServer(base) {
      if (!base) return [];
      const url = String(base).replace(/\/+$/, '') + '/api/search/external?q=' + encodeURIComponent(q) + '&limit=60' + modeParam;
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    }

    try {
      results = await tryServer(serverBase);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('[Search] Servidor activo falló:', err && err.message);
    }

    if ((!results || results.length === 0) && !controller.signal.aborted) {
      const renderUrl = getRenderUrl();
      if (renderUrl && String(renderUrl).replace(/\/+$/, '') !== String(serverBase).replace(/\/+$/, '')) {
        try {
          results = await tryServer(renderUrl);
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          console.warn('[Search] Servidor Render falló:', err && err.message);
        }
      }
    }

    // Si llegó otra búsqueda mientras tanto, descartamos esta respuesta.
    if (controller.signal.aborted || token !== searchToken) return;

    currentExternalResults = (results || []).map(function (r) {
      return Object.assign({}, r, {
        kind: searchMode === 'video' ? 'video' : (r.kind || 'audio')
      });
    });

    if (contentContainer) {
      contentContainer.innerHTML = renderSearchResults(currentExternalResults, q);
    }
  }

  /* ── Enriquecer metadatos de video ──────────────────────────────────── */
  async function enrichVideoFromServer(video) {
    if (!video || !video.url) return video;
    try {
      const base = getServerBaseUrl();
      const resp = await fetch(base.replace(/\/+$/, '') + '/api/video/info?url=' + encodeURIComponent(video.url));
      if (!resp.ok) return video;
      const info = await resp.json();
      if (!info || info.error) return video;
      video.title = info.title || video.title;
      video.artist = info.author || video.artist;
      video.channel = info.author || video.channel;
      video.duration = info.duration || video.duration;
      video.durationText = info.durationText || video.durationText;
      video.thumbnail = info.thumbnail || video.thumbnail;
      video.views = info.viewCount || video.views;
      video.qualities = info.qualities || [];
      video.subtitles = info.subtitles || [];
    } catch (e) {
      console.warn('[Search] No se pudo obtener info del video:', e && e.message);
    }
    return video;
  }

  /* ── Modal de audio ─────────────────────────────────────────────────── */
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
    const btnWatchVideo = $('#btn-watch-as-video', modalContainer);

    let activeFormat = 'mp3';

    const close = () => closeFormatModal();
    if (closeBtn) closeBtn.onclick = close;
    if (backdrop) {
      backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
    }

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

    function quality() {
      const radio = activeFormat === 'mp3'
        ? modalContainer.querySelector('input[name="audio-quality"]:checked')
        : modalContainer.querySelector('input[name="video-quality"]:checked');
      return radio ? radio.value : (activeFormat === 'mp3' ? '320k' : '720p');
    }

    if (btnBothDl) {
      btnBothDl.onclick = () => { runDownload(track, activeFormat, quality(), 'both'); close(); };
    }
    if (btnDeviceDl) {
      btnDeviceDl.onclick = () => { runDownload(track, activeFormat, quality(), 'device'); close(); };
    }
    if (btnSaveSonora) {
      btnSaveSonora.onclick = () => { runDownload(track, activeFormat, quality(), 'sonora'); close(); };
    }
    if (btnListenNow) {
      btnListenNow.onclick = () => { playExternalTrack(track); close(); };
    }
    if (btnWatchVideo) {
      btnWatchVideo.onclick = () => {
        close();
        if (!track.videoId && track.url) {
          const m = String(track.url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
          if (m) track.videoId = m[1];
        }
        openVideoModal(Object.assign({}, track, { kind: 'video' }));
      };
    }
  }

  /* ── Modal de video ─────────────────────────────────────────────────── */
  async function openVideoModal(video) {
    activeModalTrack = video;
    const modalContainer = $('#format-modal-container');
    if (!modalContainer) return;

    if (!video.url && video.videoId) {
      video.url = 'https://www.youtube.com/watch?v=' + video.videoId;
    }

    modalContainer.innerHTML = renderVideoModal(video);

    const backdrop = $('#format-modal-backdrop', modalContainer);
    const closeBtn = $('#btn-close-format-modal', modalContainer);
    const qualityList = $('#video-quality-list', modalContainer);
    const btnPlay = $('#btn-video-play', modalContainer);
    const btnSonora = $('#btn-video-save-sonora', modalContainer);
    const btnDevice = $('#btn-video-device', modalContainer);
    const btnBoth = $('#btn-video-both', modalContainer);
    const btnAudio = $('#btn-video-audio', modalContainer);

    const close = () => closeFormatModal();
    if (closeBtn) closeBtn.onclick = close;
    if (backdrop) {
      backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
    }

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

    // Calidades: se pintan al instante (lista estándar) y se refinan en
    // segundo plano con las reales del servidor. Antes el modal se quedaba
    // vacío mientras yt-dlp tardaba en responder.
    function renderQualityOptions(quals) {
      if (!qualityList) return;
      const preferred = [2160, 1440, 1080, 720, 480, 360];
      const byHeight = {};
      (quals || []).forEach(function (q) {
        if (q && q.height) byHeight[q.height] = q;
      });
      let list = preferred.filter(function (h) { return byHeight[h]; });
      if (!list.length) list = preferred;

      const prev = qualityList.querySelector('input[name="video-quality-dyn"]:checked');
      let keep = prev ? prev.value : '720p';
      if (list.indexOf(parseInt(keep, 10)) === -1) keep = '720p';

      qualityList.innerHTML = list.map(function (h) {
        const q = byHeight[h] || {};
        const size = q.size ? formatBytes(q.size) : '';
        const label = h + 'p';
        const checked = label === keep;
        return `
          <label class="quality-option ${checked ? 'active' : ''}">
            <input type="radio" name="video-quality-dyn" value="${label}" ${checked ? 'checked' : ''} />
            <div class="quality-info">
              <div class="quality-label">${h >= 2160 ? '4K' : (h >= 1440 ? '2K' : (h >= 1080 ? 'Full HD' : (h >= 720 ? 'HD' : 'Móvil')))} ${label}</div>
              <div class="quality-sub">${size ? 'Peso aproximado: ' + size : 'Calidad disponible en YouTube'}</div>
            </div>
            ${h === 720 ? '<span class="quality-badge">Recomendado</span>' : ''}
          </label>
        `;
      }).join('');
    }

    renderQualityOptions(video.qualities || []);

    // Enriquecimiento en segundo plano (máximo 20 s).
    (async function () {
      try {
        const enriched = await Promise.race([
          enrichVideoFromServer(video),
          new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 20000); })
        ]);
        if (!enriched || !modalContainer.isConnected) return;

        const titleEl = $('.format-modal-title', modalContainer);
        const artistEl = $('.format-modal-artist', modalContainer);
        const thumbEl = $('.video-modal-preview img', modalContainer);
        const durEl = $('.video-modal-preview .video-result-duration', modalContainer);
        if (titleEl) titleEl.textContent = video.title || 'Video de YouTube';
        if (artistEl) artistEl.textContent = (video.artist || video.channel || 'YouTube') + ' • ' + (video.durationText || formatTime(video.duration));
        if (thumbEl && video.thumbnail) thumbEl.src = video.thumbnail;
        if (durEl) durEl.textContent = video.durationText || formatTime(video.duration);

        if (Array.isArray(enriched.qualities) && enriched.qualities.length) {
          renderQualityOptions(enriched.qualities);
        }
      } catch (err) {
        console.warn('[Search] calidades no disponibles:', err && err.message);
      }
    })();

    if (btnPlay) {
      btnPlay.onclick = () => {
        close();
        playExternalTrack(Object.assign({}, video, { kind: 'video' }));
      };
    }
    if (btnSonora) {
      btnSonora.onclick = () => { runDownload(video, 'mp4', selectedVideoQuality(modalContainer), 'sonora'); close(); };
    }
    if (btnDevice) {
      btnDevice.onclick = () => { runDownload(video, 'mp4', selectedVideoQuality(modalContainer), 'device'); close(); };
    }
    if (btnBoth) {
      btnBoth.onclick = () => { runDownload(video, 'mp4', selectedVideoQuality(modalContainer), 'both'); close(); };
    }
    if (btnAudio) {
      btnAudio.onclick = () => { runDownload(video, 'mp3', '320k', 'both'); close(); };
    }
  }

  function closeFormatModal() {
    activeModalTrack = null;
    const modalContainer = $('#format-modal-container');
    if (modalContainer) modalContainer.innerHTML = '';
  }

  /* ── Reproducción ───────────────────────────────────────────────────── */
  function playExternalTrack(track) {
    if (!track) return;

    // Videos -> reproductor de video de Sonora
    if (track.kind === 'video' || searchMode === 'video') {
      if (Sonora.VideoPlayer && typeof Sonora.VideoPlayer.open === 'function') {
        Sonora.VideoPlayer.open(track, { quality: track.quality || '720p' });
      } else {
        toast('El reproductor de video aún no está disponible', 'error');
      }
      return;
    }

    const serverBase = getServerBaseUrl();

    const trackObj = {
      id: track.id || ('ext_' + Date.now()),
      title: track.title,
      artist: track.artist,
      album: track.platform === 'youtube' ? 'YouTube Music' : 'SoundCloud',
      duration: track.duration || 215,
      artworkUrl: track.thumbnail,
      thumbnail: track.thumbnail,
      sourceUrl: track.url,
      videoId: track.videoId || '',
      streamUrl: track.url ? (serverBase.replace(/\/+$/, '') + '/api/stream/external?url=' + encodeURIComponent(track.url)) : '',
      platform: track.platform
    };

    if (Sonora.Player && typeof Sonora.Player.play === 'function') {
      Sonora.Player.play(trackObj);
      toast(`Reproduciendo "${track.title}"`, 'info');
    }
  }

})();
