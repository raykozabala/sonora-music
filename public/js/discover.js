(function(){
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
  function generateArtwork(id, title) {
    const numId = typeof id === 'number' ? id : (typeof id === 'string' ? (parseInt(id, 10) || id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) : 1);
    const hue = Math.abs(numId * 47) % 360;
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},70%,50%)"/><stop offset="100%" stop-color="hsl(${(hue+60)%360},70%,40%)"/></linearGradient></defs><rect fill="url(#g)" width="200" height="200" rx="12"/><text x="100" y="100" text-anchor="middle" dy=".35em" fill="white" font-size="14" font-family="sans-serif">${title ? title.substring(0,15) : '♪'}</text></svg>`)}`;
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

  // Hero carousel items
  const HERO_ITEMS = [
    {
      id: 'hero-1',
      tag: 'DESTACADO',
      title: 'Descubrimiento Semanal',
      subtitle: 'Tu banda sonora personalizada con los mejores hallazgos y estrenos.',
      buttonText: 'Escuchar ahora',
      gradient: 'linear-gradient(135deg, #FF4757 0%, #FF6B35 100%)'
    },
    {
      id: 'hero-2',
      tag: 'NUEVO',
      title: 'Radar de Novedades',
      subtitle: 'Lo más reciente y fresco de tus artistas favoritos en un solo lugar.',
      buttonText: 'Explorar estrenos',
      gradient: 'linear-gradient(135deg, #4A00E0 0%, #8E2DE2 100%)'
    },
    {
      id: 'hero-3',
      tag: 'EN TENDENCIA',
      title: 'Top Hits Sonora',
      subtitle: 'Las canciones más reproducidas que están marcando el ritmo hoy.',
      buttonText: 'Escuchar el Top',
      gradient: 'linear-gradient(135deg, #00B4DB 0%, #0083B0 100%)'
    }
  ];

  // Genres with exact specified gradients
  const GENRES = [
    { name: 'Rock', color: '#E91E63', gradient: 'linear-gradient(135deg, #E91E63, #880E4F)', icon: '🎸' },
    { name: 'Pop', color: '#FF9800', gradient: 'linear-gradient(135deg, #FF9800, #E65100)', icon: '🎤' },
    { name: 'Electrónica', color: '#00BCD4', gradient: 'linear-gradient(135deg, #00BCD4, #006064)', icon: '🎛️' },
    { name: 'Hip-Hop', color: '#9C27B0', gradient: 'linear-gradient(135deg, #9C27B0, #4A148C)', icon: '🎧' },
    { name: 'R&B', color: '#3F51B5', gradient: 'linear-gradient(135deg, #3F51B5, #1A237E)', icon: '🎷' },
    { name: 'Jazz', color: '#795548', gradient: 'linear-gradient(135deg, #795548, #3E2723)', icon: '🎺' },
    { name: 'Metal', color: '#37474F', gradient: 'linear-gradient(135deg, #37474F, #212121)', icon: '⚡' },
    { name: 'Reggaetón', color: '#4CAF50', gradient: 'linear-gradient(135deg, #4CAF50, #1B5E20)', icon: '🔥' },
    { name: 'Indie', color: '#FF5722', gradient: 'linear-gradient(135deg, #FF5722, #BF360C)', icon: '🌻' },
    { name: 'Clásica', color: '#607D8B', gradient: 'linear-gradient(135deg, #607D8B, #263238)', icon: '🎻' },
    { name: 'Latino', color: '#FFC107', gradient: 'linear-gradient(135deg, #FFC107, #FF8F00)', icon: '💃' },
    { name: 'Ambient', color: '#009688', gradient: 'linear-gradient(135deg, #009688, #004D40)', icon: '🌌' }
  ];

  // Moods
  const MOODS = [
    { id: 'chill', name: 'Chill', emoji: '🧊', gradient: 'linear-gradient(135deg, #4FC3F7, #0288D1)' },
    { id: 'energia', name: 'Energía', emoji: '⚡', gradient: 'linear-gradient(135deg, #FFD54F, #FFA000)' },
    { id: 'motivacion', name: 'Motivación', emoji: '🔥', gradient: 'linear-gradient(135deg, #FF7043, #D84315)' },
    { id: 'relajacion', name: 'Relajación', emoji: '🌊', gradient: 'linear-gradient(135deg, #81C784, #388E3C)' },
    { id: 'fiesta', name: 'Fiesta', emoji: '🎉', gradient: 'linear-gradient(135deg, #BA68C8, #7B1FA2)' },
    { id: 'romantico', name: 'Romántico', emoji: '💕', gradient: 'linear-gradient(135deg, #F06292, #C2185B)' },
    { id: 'workout', name: 'Workout', emoji: '💪', gradient: 'linear-gradient(135deg, #4DB6AC, #00796B)' },
    { id: 'focus', name: 'Focus', emoji: '🎯', gradient: 'linear-gradient(135deg, #7986CB, #303F9F)' }
  ];

  // State
  let rootElement = null;
  let heroTimer = null;
  let currentHeroIndex = 0;
  let activeFilteredView = null; // null | { type: 'genre'|'mood', title, tracks, gradient, icon }
  let allTracks = [];
  let topCharts = [];
  let newReleases = [];

  // Renderers
  function renderHeroBanner() {
    return `
      <div class="discover-hero" id="discover-hero-banner">
        <div class="hero-slides-wrapper" id="hero-slides-track">
          ${HERO_ITEMS.map((item, idx) => `
            <div class="hero-slide ${idx === currentHeroIndex ? 'active' : ''}" style="background: ${item.gradient};" data-slide-idx="${idx}">
              <div class="hero-content">
                <span class="hero-tag">${escapeHtml(item.tag)}</span>
                <h2 class="hero-title">${escapeHtml(item.title)}</h2>
                <p class="hero-sub">${escapeHtml(item.subtitle)}</p>
                <button class="hero-btn" data-action="hero-action" data-slide="${idx}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  ${escapeHtml(item.buttonText)}
                </button>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="hero-dots">
          ${HERO_ITEMS.map((_, idx) => `
            <button class="hero-dot ${idx === currentHeroIndex ? 'active' : ''}" data-action="goto-slide" data-slide="${idx}" aria-label="Slide ${idx + 1}"></button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderGenresSection() {
    return `
      <section class="section discover-section">
        <div class="section__header">
          <h2 class="section__title">Géneros</h2>
          <span class="section__subtitle">Descubre por estilo</span>
        </div>
        <div class="section__scroll genres-scroll">
          ${GENRES.map(g => `
            <div class="discover-genre-card" style="background: ${g.gradient};" data-action="filter-genre" data-genre="${escapeHtml(g.name)}">
              <span class="genre-icon">${g.icon}</span>
              <span class="genre-title">${escapeHtml(g.name)}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderMoodsSection() {
    return `
      <section class="section discover-section">
        <div class="section__header">
          <h2 class="section__title">Estados de ánimo</h2>
          <span class="section__subtitle">Música para cada momento</span>
        </div>
        <div class="moods-grid">
          ${MOODS.map(m => `
            <div class="mood-card" style="background: ${m.gradient};" data-action="filter-mood" data-mood="${escapeHtml(m.name)}" data-mood-id="${m.id}">
              <span class="mood-emoji">${m.emoji}</span>
              <span class="mood-name">${escapeHtml(m.name)}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderTopChartsSection(tracks) {
    if (!tracks || tracks.length === 0) return '';
    return `
      <section class="section discover-section">
        <div class="section__header">
          <h2 class="section__title">Top Charts</h2>
          <span class="section__subtitle">Las 10 más reproducidas</span>
        </div>
        <div class="charts-list">
          ${tracks.slice(0, 10).map((t, idx) => {
            const rank = idx + 1;
            let rankClass = 'rank-default';
            if (rank === 1) rankClass = 'rank-gold';
            else if (rank === 2) rankClass = 'rank-silver';
            else if (rank === 3) rankClass = 'rank-bronze';

            return `
              <div class="chart-item" data-action="play-chart-track" data-idx="${idx}" data-track-id="${escapeHtml(t.id)}">
                <div class="chart-rank ${rankClass}">${rank}</div>
                <div class="chart-art-wrap">
                  <img class="chart-art" src="${escapeHtml(t.artworkUrl || generateArtwork(t.id, t.title))}" alt="" loading="lazy" />
                  <div class="chart-play-icon">▶</div>
                </div>
                <div class="chart-info">
                  <div class="chart-title">${escapeHtml(t.title)}</div>
                  <div class="chart-artist">${escapeHtml(t.artist || 'Artista desconocido')}</div>
                </div>
                <div class="chart-plays">
                  <span class="plays-badge">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    ${t.playCount ? t.playCount.toLocaleString() : '0'}
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderNewReleasesSection(tracks) {
    if (!tracks || tracks.length === 0) return '';
    return `
      <section class="section discover-section">
        <div class="section__header">
          <h2 class="section__title">Nuevos Lanzamientos</h2>
          <span class="section__subtitle">Recién añadidos</span>
        </div>
        <div class="section__scroll releases-scroll">
          ${tracks.slice(0, 10).map((t, idx) => `
            <div class="release-card" data-action="play-release-track" data-idx="${idx}" data-track-id="${escapeHtml(t.id)}">
              <div class="release-art-wrap">
                <img class="release-art" src="${escapeHtml(t.artworkUrl || generateArtwork(t.id, t.title))}" alt="" loading="lazy" />
                <span class="release-badge">NUEVO</span>
              </div>
              <div class="release-title">${escapeHtml(t.title)}</div>
              <div class="release-artist">${escapeHtml(t.artist || 'Artista desconocido')}</div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderFilteredView(filterData) {
    const { title, tracks, gradient, icon, subtitle } = filterData;
    return `
      <div class="discover-filtered-view">
        <div class="filtered-header" style="background: ${gradient || 'linear-gradient(135deg, #FF4757, #FF6B35)'};">
          <button class="filtered-back-btn" data-action="close-filtered-view">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Volver a Descubrir
          </button>
          <div class="filtered-hero-content">
            <span class="filtered-icon">${icon || '🎵'}</span>
            <h1 class="filtered-title">${escapeHtml(title)}</h1>
            <p class="filtered-count">${tracks.length} canciones encontradas ${subtitle ? '• ' + escapeHtml(subtitle) : ''}</p>
          </div>
          ${tracks.length > 0 ? `
            <button class="btn btn--primary filtered-play-btn" data-action="play-filtered-all">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Reproducir Todo
            </button>
          ` : ''}
        </div>

        <div class="filtered-tracks-list">
          ${tracks.length === 0 ? `
            <div class="discover-empty-state">
              <p>No se encontraron canciones para esta selección.</p>
            </div>
          ` : tracks.map((t, idx) => `
            <div class="filtered-track-row" data-action="play-filtered-track" data-idx="${idx}" data-track-id="${escapeHtml(t.id)}">
              <div class="track-row__art-wrap">
                <img class="track-row__art" src="${escapeHtml(t.artworkUrl || generateArtwork(t.id, t.title))}" alt="" loading="lazy" />
                <div class="track-row__play-icon">▶</div>
              </div>
              <div class="track-row__meta">
                <div class="track-row__title">${escapeHtml(t.title)}</div>
                <div class="track-row__subtitle">${escapeHtml(t.artist || 'Artista desconocido')}</div>
              </div>
              <div class="track-row__duration">${formatTime(t.duration)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  Sonora.Pages.Discover = {
    render() {
      return `
        <div class="page page-discover">
          <style>
            .page-discover {
              padding-bottom: 96px;
              min-height: 100vh;
              color: var(--text-color, #ffffff);
              background: var(--bg-color, #121212);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              user-select: none;
              -webkit-user-select: none;
            }
            /* Hero Carousel */
            .discover-hero {
              position: relative;
              padding: 16px 20px 0;
            }
            .hero-slides-wrapper {
              position: relative;
              height: 190px;
              border-radius: 20px;
              overflow: hidden;
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            }
            .hero-slide {
              position: absolute;
              inset: 0;
              padding: 24px 20px;
              display: flex;
              flex-direction: column;
              justify-content: flex-end;
              opacity: 0;
              pointer-events: none;
              transition: opacity 0.45s ease, transform 0.45s ease;
              transform: scale(0.98);
            }
            .hero-slide.active {
              opacity: 1;
              pointer-events: auto;
              transform: scale(1);
            }
            .hero-tag {
              display: inline-block;
              background: rgba(0, 0, 0, 0.35);
              backdrop-filter: blur(6px);
              padding: 3px 10px;
              border-radius: 12px;
              font-size: 10px;
              font-weight: 800;
              letter-spacing: 0.8px;
              text-transform: uppercase;
              color: #ffffff;
              width: fit-content;
              margin-bottom: 8px;
            }
            .hero-title {
              font-size: 22px;
              font-weight: 800;
              margin: 0 0 6px;
              color: #ffffff;
              line-height: 1.2;
              letter-spacing: -0.4px;
            }
            .hero-sub {
              font-size: 13px;
              color: rgba(255, 255, 255, 0.85);
              margin: 0 0 14px;
              line-height: 1.3;
              max-width: 90%;
            }
            .hero-btn {
              background: #ffffff;
              color: #121212;
              border: none;
              padding: 8px 18px;
              border-radius: 20px;
              font-size: 13px;
              font-weight: 700;
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              box-shadow: 0 4px 10px rgba(0,0,0,0.25);
              width: fit-content;
              transition: transform 0.1s ease;
            }
            .hero-btn:active {
              transform: scale(0.96);
            }
            .hero-dots {
              display: flex;
              justify-content: center;
              gap: 8px;
              padding: 12px 0 4px;
            }
            .hero-dot {
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: rgba(255, 255, 255, 0.25);
              border: none;
              cursor: pointer;
              padding: 0;
              transition: all 0.25s ease;
            }
            .hero-dot.active {
              background: var(--primary, #FF4757);
              width: 22px;
              border-radius: 4px;
            }
            /* Discover Sections */
            .discover-section {
              margin-top: 24px;
            }
            .section__header {
              padding: 0 20px 10px;
            }
            .section__title {
              font-size: 20px;
              font-weight: 800;
              margin: 0;
              color: #ffffff;
              letter-spacing: -0.3px;
            }
            .section__subtitle {
              font-size: 12px;
              color: #8e8e93;
              display: block;
              margin-top: 2px;
            }
            .section__scroll {
              display: flex;
              overflow-x: auto;
              padding: 4px 20px 12px;
              gap: 12px;
              scrollbar-width: none;
              -webkit-overflow-scrolling: touch;
            }
            .section__scroll::-webkit-scrollbar {
              display: none;
            }
            /* Genres */
            .discover-genre-card {
              flex: 0 0 120px;
              width: 120px;
              height: 84px;
              border-radius: 12px;
              padding: 10px;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              cursor: pointer;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              transition: transform 0.15s ease;
            }
            .discover-genre-card:active {
              transform: scale(0.96);
            }
            .genre-icon {
              font-size: 22px;
            }
            .genre-title {
              font-size: 14px;
              font-weight: 700;
              color: #ffffff;
            }
            /* Moods Grid */
            .moods-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 10px;
              padding: 0 20px;
            }
            .mood-card {
              height: 74px;
              border-radius: 12px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 4px;
              cursor: pointer;
              box-shadow: 0 4px 10px rgba(0,0,0,0.3);
              transition: transform 0.15s ease;
              text-align: center;
              padding: 6px;
            }
            .mood-card:active {
              transform: scale(0.95);
            }
            .mood-emoji {
              font-size: 24px;
            }
            .mood-name {
              font-size: 12px;
              font-weight: 700;
              color: #ffffff;
              text-shadow: 0 1px 2px rgba(0,0,0,0.4);
            }
            /* Top Charts */
            .charts-list {
              padding: 0 20px;
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .chart-item {
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 8px 10px;
              border-radius: 10px;
              background: #191924;
              cursor: pointer;
              transition: background 0.15s ease;
            }
            .chart-item:active {
              background: #252535;
            }
            .chart-rank {
              font-size: 17px;
              font-weight: 900;
              width: 24px;
              text-align: center;
              flex-shrink: 0;
            }
            .rank-gold { color: #FFD700; text-shadow: 0 0 10px rgba(255, 215, 0, 0.4); }
            .rank-silver { color: #E0E0E0; text-shadow: 0 0 8px rgba(224, 224, 224, 0.4); }
            .rank-bronze { color: #CD7F32; text-shadow: 0 0 8px rgba(205, 127, 50, 0.4); }
            .rank-default { color: #636366; }
            .chart-art-wrap {
              width: 44px;
              height: 44px;
              border-radius: 8px;
              overflow: hidden;
              position: relative;
              flex-shrink: 0;
              background: #282836;
            }
            .chart-art {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .chart-play-icon {
              position: absolute;
              inset: 0;
              background: rgba(0,0,0,0.45);
              display: flex;
              align-items: center;
              justify-content: center;
              color: #fff;
              font-size: 12px;
              opacity: 0;
              transition: opacity 0.15s ease;
            }
            .chart-item:hover .chart-play-icon {
              opacity: 1;
            }
            .chart-info {
              flex: 1;
              min-width: 0;
            }
            .chart-title {
              font-size: 14px;
              font-weight: 600;
              color: #ffffff;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .chart-artist {
              font-size: 12px;
              color: #8e8e93;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-top: 2px;
            }
            .chart-plays {
              flex-shrink: 0;
            }
            .plays-badge {
              font-size: 11px;
              color: #8e8e93;
              background: rgba(255, 255, 255, 0.06);
              padding: 3px 8px;
              border-radius: 12px;
              display: inline-flex;
              align-items: center;
              gap: 4px;
            }
            /* Releases */
            .release-card {
              flex: 0 0 130px;
              width: 130px;
              cursor: pointer;
            }
            .release-card:active {
              transform: scale(0.96);
            }
            .release-art-wrap {
              width: 130px;
              height: 130px;
              border-radius: 12px;
              overflow: hidden;
              position: relative;
              background: #252535;
              box-shadow: 0 4px 12px rgba(0,0,0,0.35);
            }
            .release-art {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .release-badge {
              position: absolute;
              top: 8px;
              left: 8px;
              background: var(--primary, #FF4757);
              color: #ffffff;
              font-size: 9px;
              font-weight: 800;
              padding: 2px 6px;
              border-radius: 4px;
              letter-spacing: 0.5px;
            }
            .release-title {
              font-size: 13px;
              font-weight: 600;
              color: #ffffff;
              margin-top: 6px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .release-artist {
              font-size: 12px;
              color: #8e8e93;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            /* Filtered View */
            .filtered-header {
              padding: 24px 20px 20px;
              position: relative;
              border-radius: 0 0 20px 20px;
              box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            }
            .filtered-back-btn {
              background: rgba(0,0,0,0.3);
              backdrop-filter: blur(8px);
              border: none;
              color: #ffffff;
              font-size: 14px;
              font-weight: 600;
              padding: 6px 14px;
              border-radius: 20px;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              cursor: pointer;
              margin-bottom: 16px;
            }
            .filtered-icon {
              font-size: 38px;
              display: block;
              margin-bottom: 4px;
            }
            .filtered-title {
              font-size: 26px;
              font-weight: 800;
              margin: 0;
              color: #ffffff;
            }
            .filtered-count {
              font-size: 13px;
              color: rgba(255,255,255,0.8);
              margin: 4px 0 16px;
            }
            .filtered-play-btn {
              background: #ffffff;
              color: #121212;
              border: none;
              border-radius: 24px;
              padding: 10px 22px;
              font-size: 14px;
              font-weight: 700;
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              gap: 8px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
            .filtered-tracks-list {
              padding: 16px 20px;
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .filtered-track-row {
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 8px 10px;
              border-radius: 10px;
              background: #1a1a24;
              cursor: pointer;
              transition: background 0.15s ease;
            }
            .filtered-track-row:active {
              background: #252535;
            }
            .discover-empty-state {
              padding: 40px 20px;
              text-align: center;
              color: #8e8e93;
            }
          </style>

          <div id="discover-main-content">
            <!-- Hero Banner -->
            ${renderHeroBanner()}

            <!-- Dynamic Body Sections -->
            <div id="discover-sections-body">
              ${renderGenresSection()}
              ${renderMoodsSection()}
              <div id="discover-dynamic-charts"></div>
              <div id="discover-dynamic-releases"></div>
            </div>
          </div>

          <!-- Filtered sub-view container -->
          <div id="discover-subview-content" style="display: none;"></div>
        </div>
      `;
    },

    async init() {
      rootElement = $('.page-discover');
      if (!rootElement) return;

      currentHeroIndex = 0;
      activeFilteredView = null;

      // Start Hero rotation timer (auto-rotate every 5s)
      startHeroTimer();

      // Load data
      await loadDiscoverData();

      // Render charts & releases
      const chartsContainer = $('#discover-dynamic-charts', rootElement);
      if (chartsContainer) {
        chartsContainer.innerHTML = renderTopChartsSection(topCharts);
      }
      const releasesContainer = $('#discover-dynamic-releases', rootElement);
      if (releasesContainer) {
        releasesContainer.innerHTML = renderNewReleasesSection(newReleases);
      }

      // Delegated click handler
      rootElement.addEventListener('click', async (e) => {
        try {
          const target = e.target;
          if (!target) return;

          // 1. Hero action button
          const heroBtn = target.closest('[data-action="hero-action"]');
          if (heroBtn) {
            const slideIdx = parseInt(heroBtn.getAttribute('data-slide'), 10) || 0;
            handleHeroAction(slideIdx);
            return;
          }

          // 2. Hero dot click
          const dotBtn = target.closest('[data-action="goto-slide"]');
          if (dotBtn) {
            const slideIdx = parseInt(dotBtn.getAttribute('data-slide'), 10) || 0;
            switchHeroSlide(slideIdx);
            resetHeroTimer();
            return;
          }

          // 3. Filter Genre
          const genreCard = target.closest('[data-action="filter-genre"]');
          if (genreCard) {
            const genre = genreCard.getAttribute('data-genre');
            await openGenreView(genre);
            return;
          }

          // 4. Filter Mood
          const moodCard = target.closest('[data-action="filter-mood"]');
          if (moodCard) {
            const mood = moodCard.getAttribute('data-mood');
            const moodId = moodCard.getAttribute('data-mood-id');
            await openMoodView(mood, moodId);
            return;
          }

          // 5. Back from filtered view
          const backBtn = target.closest('[data-action="close-filtered-view"]');
          if (backBtn) {
            closeFilteredView();
            return;
          }

          // 6. Play Chart Track
          const chartItem = target.closest('[data-action="play-chart-track"]');
          if (chartItem) {
            const idx = parseInt(chartItem.getAttribute('data-idx'), 10) || 0;
            if (topCharts && topCharts.length > idx && Sonora.Player) {
              if (typeof Sonora.Player.setQueue === 'function') {
                Sonora.Player.setQueue(topCharts, idx);
              } else if (typeof Sonora.Player.play === 'function') {
                Sonora.Player.play(topCharts[idx]);
              }
            }
            return;
          }

          // 7. Play Release Track
          const releaseCard = target.closest('[data-action="play-release-track"]');
          if (releaseCard) {
            const idx = parseInt(releaseCard.getAttribute('data-idx'), 10) || 0;
            if (newReleases && newReleases.length > idx && Sonora.Player) {
              if (typeof Sonora.Player.setQueue === 'function') {
                Sonora.Player.setQueue(newReleases, idx);
              } else if (typeof Sonora.Player.play === 'function') {
                Sonora.Player.play(newReleases[idx]);
              }
            }
            return;
          }

          // 8. Play Filtered All
          const playFilteredAllBtn = target.closest('[data-action="play-filtered-all"]');
          if (playFilteredAllBtn && activeFilteredView && activeFilteredView.tracks.length > 0) {
            if (Sonora.Player) {
              if (typeof Sonora.Player.setQueue === 'function') {
                Sonora.Player.setQueue(activeFilteredView.tracks, 0);
              } else if (typeof Sonora.Player.play === 'function') {
                Sonora.Player.play(activeFilteredView.tracks[0]);
              }
            }
            return;
          }

          // 9. Play Filtered Track
          const filteredTrack = target.closest('[data-action="play-filtered-track"]');
          if (filteredTrack && activeFilteredView) {
            const idx = parseInt(filteredTrack.getAttribute('data-idx'), 10) || 0;
            if (activeFilteredView.tracks.length > idx && Sonora.Player) {
              if (typeof Sonora.Player.setQueue === 'function') {
                Sonora.Player.setQueue(activeFilteredView.tracks, idx);
              } else if (typeof Sonora.Player.play === 'function') {
                Sonora.Player.play(activeFilteredView.tracks[idx]);
              }
            }
            return;
          }
        } catch (err) {
          console.error('[Discover] Click handling error:', err);
        }
      });
    },

    destroy() {
      try {
        if (heroTimer) {
          clearInterval(heroTimer);
          heroTimer = null;
        }
        rootElement = null;
        activeFilteredView = null;
        allTracks = [];
        topCharts = [];
        newReleases = [];
      } catch (e) {
        console.warn('[Discover] Destroy error:', e);
      }
    }
  };

  function startHeroTimer() {
    if (heroTimer) clearInterval(heroTimer);
    heroTimer = setInterval(() => {
      const nextIdx = (currentHeroIndex + 1) % HERO_ITEMS.length;
      switchHeroSlide(nextIdx);
    }, 5000);
  }

  function resetHeroTimer() {
    startHeroTimer();
  }

  function switchHeroSlide(idx) {
    if (!rootElement) return;
    currentHeroIndex = idx;

    const slides = $$('.hero-slide', rootElement);
    slides.forEach((s, i) => {
      if (i === idx) {
        s.classList.add('active');
      } else {
        s.classList.remove('active');
      }
    });

    const dots = $$('.hero-dot', rootElement);
    dots.forEach((d, i) => {
      if (i === idx) {
        d.classList.add('active');
      } else {
        d.classList.remove('active');
      }
    });
  }

  function handleHeroAction(slideIdx) {
    if (slideIdx === 0) {
      // Descubrimiento Semanal -> Play mixed tracks
      if (allTracks.length > 0 && Sonora.Player) {
        const shuffled = [...allTracks].sort(() => 0.5 - Math.random());
        Sonora.Player.setQueue(shuffled, 0);
      }
    } else if (slideIdx === 1) {
      // Radar de Novedades -> Play new releases
      if (newReleases.length > 0 && Sonora.Player) {
        Sonora.Player.setQueue(newReleases, 0);
      }
    } else if (slideIdx === 2) {
      // Top Charts -> Play top tracks
      if (topCharts.length > 0 && Sonora.Player) {
        Sonora.Player.setQueue(topCharts, 0);
      }
    }
  }

  async function loadDiscoverData() {
    try {
      if (!Sonora.DB) return;

      if (Sonora.DB.tracks && typeof Sonora.DB.tracks.getAll === 'function') {
        allTracks = (await Sonora.DB.tracks.getAll()) || [];
      }

      // Top Charts (10 tracks by play count)
      if (Sonora.DB.tracks && typeof Sonora.DB.tracks.getMostPlayed === 'function') {
        topCharts = (await Sonora.DB.tracks.getMostPlayed(10)) || [];
      } else if (allTracks.length > 0) {
        topCharts = [...allTracks].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 10);
      }

      // New Releases (10 recently added tracks)
      if (Sonora.DB.tracks && typeof Sonora.DB.tracks.getRecent === 'function') {
        newReleases = (await Sonora.DB.tracks.getRecent(10)) || [];
      } else if (allTracks.length > 0) {
        newReleases = allTracks.slice().reverse().slice(0, 10);
      }
    } catch (e) {
      console.error('[Discover] Load data error:', e);
    }
  }

  async function openGenreView(genreName) {
    let tracks = [];
    try {
      if (Sonora.DB && Sonora.DB.tracks) {
        if (typeof Sonora.DB.tracks.getByGenre === 'function') {
          tracks = (await Sonora.DB.tracks.getByGenre(genreName)) || [];
        } else if (typeof Sonora.DB.tracks.getAll === 'function') {
          const all = (await Sonora.DB.tracks.getAll()) || [];
          tracks = all.filter(t => t.genre && t.genre.toLowerCase() === genreName.toLowerCase());
        }
      }
    } catch (e) {
      console.error('[Discover] Genre view error:', e);
    }

    const genreMeta = GENRES.find(g => g.name.toLowerCase() === genreName.toLowerCase()) || {
      name: genreName,
      gradient: 'linear-gradient(135deg, #FF4757, #FF6B35)',
      icon: '🎸'
    };

    activeFilteredView = {
      type: 'genre',
      title: genreMeta.name,
      tracks: tracks,
      gradient: genreMeta.gradient,
      icon: genreMeta.icon,
      subtitle: 'Género'
    };

    showFilteredSubView();
  }

  async function openMoodView(moodName, moodId) {
    let tracks = [];
    try {
      if (allTracks.length === 0 && Sonora.DB && Sonora.DB.tracks) {
        allTracks = (await Sonora.DB.tracks.getAll()) || [];
      }

      const q = (moodName || '').toLowerCase();
      // Filter tracks by mood, genre match, or keyword match
      tracks = allTracks.filter(t => {
        if (t.mood && t.mood.toLowerCase().includes(q)) return true;
        if (t.genre && t.genre.toLowerCase().includes(q)) return true;
        if (t.title && t.title.toLowerCase().includes(q)) return true;
        return false;
      });

      // Fallback: if no direct keyword match, grab a nice subset of tracks
      if (tracks.length === 0 && allTracks.length > 0) {
        tracks = allTracks.slice(0, 15);
      }
    } catch (e) {
      console.error('[Discover] Mood view error:', e);
    }

    const moodMeta = MOODS.find(m => m.id === moodId || m.name.toLowerCase() === moodName.toLowerCase()) || {
      name: moodName,
      emoji: '🎵',
      gradient: 'linear-gradient(135deg, #FF4757, #FF6B35)'
    };

    activeFilteredView = {
      type: 'mood',
      title: moodMeta.name,
      tracks: tracks,
      gradient: moodMeta.gradient,
      icon: moodMeta.emoji,
      subtitle: 'Estado de ánimo'
    };

    showFilteredSubView();
  }

  function showFilteredSubView() {
    const mainContent = $('#discover-main-content', rootElement);
    const subContent = $('#discover-subview-content', rootElement);
    if (!subContent || !mainContent) return;

    subContent.innerHTML = renderFilteredView(activeFilteredView);
    mainContent.style.display = 'none';
    subContent.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeFilteredView() {
    const mainContent = $('#discover-main-content', rootElement);
    const subContent = $('#discover-subview-content', rootElement);
    if (!subContent || !mainContent) return;

    activeFilteredView = null;
    subContent.style.display = 'none';
    subContent.innerHTML = '';
    mainContent.style.display = 'block';
  }

})();
