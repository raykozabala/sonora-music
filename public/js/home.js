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

  // Internal module state for cleanup
  let rootElement = null;
  let clickHandler = null;
  let scrollDebounceTimer = null;
  let skeletonTimeout = null;

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      return { text: 'Buenos días' };
    } else if (hour >= 12 && hour < 20) {
      return { text: 'Buenas tardes' };
    } else {
      return { text: 'Buenas noches' };
    }
  }

  function getUserName() {
    try {
      if (Sonora.Store && typeof Sonora.Store.get === 'function') {
        const user = Sonora.Store.get('user');
        if (user && user.name) return user.name;
      }
    } catch (e) {
      console.warn('[Home] Could not get user name:', e);
    }
    return 'Melómano';
  }

  function renderSkeleton() {
    return `
      <div class="home-skeleton" aria-hidden="true">
        <div class="skeleton-banner skeleton-pulse"></div>
        <div class="skeleton-section">
          <div class="skeleton-title skeleton-pulse"></div>
          <div class="skeleton-scroll">
            <div class="skeleton-card skeleton-pulse"></div>
            <div class="skeleton-card skeleton-pulse"></div>
            <div class="skeleton-card skeleton-pulse"></div>
          </div>
        </div>
        <div class="skeleton-section">
          <div class="skeleton-title skeleton-pulse"></div>
          <div class="skeleton-scroll">
            <div class="skeleton-mix-card skeleton-pulse"></div>
            <div class="skeleton-mix-card skeleton-pulse"></div>
          </div>
        </div>
        <div class="skeleton-section">
          <div class="skeleton-title skeleton-pulse"></div>
          <div class="skeleton-scroll">
            <div class="skeleton-circle skeleton-pulse"></div>
            <div class="skeleton-circle skeleton-pulse"></div>
            <div class="skeleton-circle skeleton-pulse"></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderEmptyState() {
    return `
      <div class="home-empty-state" style="padding: 40px 20px; text-align: center;">
        <div class="empty-icon-wrap" style="width: 72px; height: 72px; margin: 0 auto 16px; border-radius: 50%; background: rgba(255, 71, 87, 0.12); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255, 71, 87, 0.25);">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary, #FF4757)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
        <h3 class="empty-title" style="font-size: 22px; font-weight: 800; color: #ffffff; margin-bottom: 8px; letter-spacing: -0.3px;">Tu música en un solo lugar</h3>
        <p class="empty-desc" style="color: #9e9ea7; max-width: 320px; margin: 0 auto 24px; font-size: 14px; line-height: 1.5;">
          Busca canciones y artistas en YouTube y SoundCloud. Reproduce al instante y descarga con portada y letras.
        </p>
        <button class="btn btn--primary" data-action="go-search" style="background: var(--color-primary, #FF4757); color: #fff; border: none; border-radius: 24px; padding: 13px 32px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 18px rgba(255,71,87,0.45); margin-bottom: 32px;">
          Explorar y buscar música
        </button>

        <div style="text-align: left; max-width: 440px; margin: 0 auto;">
          <div style="font-size: 12px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 12px;">Artistas sugeridos</div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <button class="quick-suggest-chip" data-quick-search="Nirvana" style="background: #1e1e2a; border: 1px solid rgba(255,255,255,0.08); color: #ffffff; border-radius: 20px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Nirvana</button>
            <button class="quick-suggest-chip" data-quick-search="Soda Stereo" style="background: #1e1e2a; border: 1px solid rgba(255,255,255,0.08); color: #ffffff; border-radius: 20px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Soda Stereo</button>
            <button class="quick-suggest-chip" data-quick-search="Queen" style="background: #1e1e2a; border: 1px solid rgba(255,255,255,0.08); color: #ffffff; border-radius: 20px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Queen</button>
            <button class="quick-suggest-chip" data-quick-search="Daft Punk" style="background: #1e1e2a; border: 1px solid rgba(255,255,255,0.08); color: #ffffff; border-radius: 20px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Daft Punk</button>
            <button class="quick-suggest-chip" data-quick-search="Arctic Monkeys" style="background: #1e1e2a; border: 1px solid rgba(255,255,255,0.08); color: #ffffff; border-radius: 20px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Arctic Monkeys</button>
            <button class="quick-suggest-chip" data-quick-search="Pink Floyd" style="background: #1e1e2a; border: 1px solid rgba(255,255,255,0.08); color: #ffffff; border-radius: 20px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Pink Floyd</button>
            <button class="quick-suggest-chip" data-quick-search="Bad Bunny" style="background: #1e1e2a; border: 1px solid rgba(255,255,255,0.08); color: #ffffff; border-radius: 20px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Bad Bunny</button>
            <button class="quick-suggest-chip" data-quick-search="Rosalía" style="background: #1e1e2a; border: 1px solid rgba(255,255,255,0.08); color: #ffffff; border-radius: 20px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;">Rosalía</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderMosaic(artworks, defaultTitle) {
    const arts = (artworks && artworks.length >= 4)
      ? artworks.slice(0, 4)
      : [
          artworks && artworks[0] ? artworks[0] : generateArtwork(1, defaultTitle),
          artworks && artworks[1] ? artworks[1] : generateArtwork(2, defaultTitle),
          artworks && artworks[2] ? artworks[2] : generateArtwork(3, defaultTitle),
          artworks && artworks[3] ? artworks[3] : generateArtwork(4, defaultTitle)
        ];

    return `
      <div class="mix-mosaic">
        <img class="mosaic-tile" src="${escapeHtml(arts[0])}" alt="" loading="lazy" />
        <img class="mosaic-tile" src="${escapeHtml(arts[1])}" alt="" loading="lazy" />
        <img class="mosaic-tile" src="${escapeHtml(arts[2])}" alt="" loading="lazy" />
        <img class="mosaic-tile" src="${escapeHtml(arts[3])}" alt="" loading="lazy" />
      </div>
    `;
  }

  Sonora.Pages.Home = {
    render() {
      const greeting = getGreeting();
      const userName = escapeHtml(getUserName());

      return `
        <div class="page page-home">
          <!-- Embedded Styles for Home View -->
          <style>
            .page-home {
              padding-bottom: 96px;
              min-height: 100vh;
              color: var(--text-color, #ffffff);
              background: var(--bg-color, #121212);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              user-select: none;
              -webkit-user-select: none;
            }
            .greeting-banner {
              padding: 24px 20px 20px;
              background: linear-gradient(180deg, rgba(255, 71, 87, 0.22) 0%, rgba(18, 18, 18, 0) 100%);
              position: relative;
            }
            .greeting-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 8px;
            }
            .greeting-text {
              font-size: 26px;
              font-weight: 800;
              letter-spacing: -0.5px;
              margin: 0;
              line-height: 1.2;
              color: #ffffff;
            }
            .greeting-sub {
              font-size: 14px;
              color: rgba(255, 255, 255, 0.7);
              margin: 4px 0 0 0;
            }
            .greeting-avatar {
              width: 42px;
              height: 42px;
              border-radius: 50%;
              background: linear-gradient(135deg, #FF4757, #FF6B35);
              display: flex;
              align-items: center;
              justify-content: center;
              color: #ffffff;
              font-weight: 700;
              font-size: 16px;
              box-shadow: 0 4px 12px rgba(255, 71, 87, 0.35);
              flex-shrink: 0;
            }
            .section {
              margin-top: 24px;
              position: relative;
            }
            .section__header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 0 20px 12px;
            }
            .section__title {
              font-size: 19px;
              font-weight: 700;
              margin: 0;
              color: #ffffff;
              letter-spacing: -0.3px;
            }
            .section__more {
              font-size: 13px;
              font-weight: 600;
              color: var(--primary, #FF4757);
              background: none;
              border: none;
              cursor: pointer;
              padding: 4px 8px;
              border-radius: 12px;
            }
            .section__more:active {
              opacity: 0.7;
            }
            .section__scroll {
              display: flex;
              overflow-x: auto;
              overflow-y: hidden;
              padding: 4px 20px 14px;
              gap: 14px;
              scroll-snap-type: x mandatory;
              -webkit-overflow-scrolling: touch;
              scrollbar-width: none;
            }
            .section__scroll::-webkit-scrollbar {
              display: none;
            }
            .recent-card {
              flex: 0 0 130px;
              width: 130px;
              height: 180px;
              display: flex;
              flex-direction: column;
              cursor: pointer;
              scroll-snap-align: start;
              transition: transform 0.15s ease;
            }
            .recent-card:active {
              transform: scale(0.96);
            }
            .recent-artwork-wrap {
              width: 130px;
              height: 130px;
              border-radius: 12px;
              overflow: hidden;
              position: relative;
              box-shadow: 0 4px 14px rgba(0,0,0,0.4);
              background: #202028;
            }
            .recent-artwork {
              width: 100%;
              height: 100%;
              object-fit: cover;
              display: block;
            }
            .recent-play-badge {
              position: absolute;
              bottom: 8px;
              right: 8px;
              width: 32px;
              height: 32px;
              border-radius: 50%;
              background: var(--primary, #FF4757);
              display: flex;
              align-items: center;
              justify-content: center;
              color: #fff;
              box-shadow: 0 4px 8px rgba(0,0,0,0.3);
              opacity: 0.92;
            }
            .recent-title {
              font-size: 14px;
              font-weight: 600;
              color: #fff;
              margin: 8px 0 2px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .recent-artist {
              font-size: 12px;
              color: #8e8e93;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .mix-card {
              flex: 0 0 180px;
              width: 180px;
              cursor: pointer;
              scroll-snap-align: start;
              transition: transform 0.15s ease;
            }
            .mix-card:active {
              transform: scale(0.96);
            }
            .mix-card__art-wrap {
              width: 180px;
              height: 180px;
              border-radius: 12px;
              overflow: hidden;
              position: relative;
              box-shadow: 0 6px 16px rgba(0,0,0,0.5);
              background: #1c1c24;
            }
            .mix-mosaic {
              display: grid;
              grid-template-columns: 1fr 1fr;
              grid-template-rows: 1fr 1fr;
              width: 100%;
              height: 100%;
            }
            .mosaic-tile {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .mix-overlay-badge {
              position: absolute;
              bottom: 10px;
              left: 10px;
              background: rgba(18, 18, 18, 0.85);
              backdrop-filter: blur(8px);
              padding: 4px 10px;
              border-radius: 20px;
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.5px;
              text-transform: uppercase;
              color: #ffffff;
            }
            .mix-title {
              font-size: 15px;
              font-weight: 700;
              color: #ffffff;
              margin: 10px 0 3px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .mix-desc {
              font-size: 12px;
              color: #8e8e93;
              line-height: 1.3;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            }
            .played-card {
              flex: 0 0 140px;
              width: 140px;
              cursor: pointer;
              scroll-snap-align: start;
              transition: transform 0.15s ease;
            }
            .played-card:active {
              transform: scale(0.96);
            }
            .played-artwork-wrap {
              width: 140px;
              height: 140px;
              border-radius: 12px;
              overflow: hidden;
              position: relative;
              box-shadow: 0 4px 14px rgba(0,0,0,0.4);
              background: #202028;
            }
            .played-artwork {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .played-count-badge {
              position: absolute;
              top: 8px;
              right: 8px;
              background: rgba(0, 0, 0, 0.75);
              backdrop-filter: blur(4px);
              padding: 2px 7px;
              border-radius: 10px;
              font-size: 11px;
              font-weight: 600;
              color: #fff;
              display: flex;
              align-items: center;
              gap: 3px;
            }
            .artist-card {
              flex: 0 0 96px;
              width: 96px;
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              cursor: pointer;
              scroll-snap-align: start;
              transition: transform 0.15s ease;
            }
            .artist-card:active {
              transform: scale(0.95);
            }
            .artist-avatar-wrap {
              width: 88px;
              height: 88px;
              border-radius: 50%;
              overflow: hidden;
              box-shadow: 0 4px 14px rgba(0,0,0,0.45);
              background: #252530;
              border: 2px solid rgba(255, 71, 87, 0.2);
            }
            .artist-avatar {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .artist-name {
              font-size: 13px;
              font-weight: 600;
              color: #fff;
              margin-top: 8px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              width: 100%;
            }
            .artist-sub {
              font-size: 11px;
              color: #8e8e93;
            }
            /* Skeletons */
            .skeleton-pulse {
              animation: pulse 1.5s infinite ease-in-out;
              background: linear-gradient(90deg, #1c1c24 25%, #2a2a38 50%, #1c1c24 75%);
              background-size: 200% 100%;
            }
            @keyframes pulse {
              0% { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
            .skeleton-banner {
              height: 80px;
              margin: 20px;
              border-radius: 16px;
            }
            .skeleton-section {
              margin: 24px 20px 0;
            }
            .skeleton-title {
              width: 140px;
              height: 20px;
              border-radius: 4px;
              margin-bottom: 14px;
            }
            .skeleton-scroll {
              display: flex;
              gap: 14px;
              overflow: hidden;
            }
            .skeleton-card {
              flex: 0 0 130px;
              height: 170px;
              border-radius: 12px;
            }
            .skeleton-mix-card {
              flex: 0 0 180px;
              height: 210px;
              border-radius: 12px;
            }
            .skeleton-circle {
              flex: 0 0 88px;
              height: 88px;
              border-radius: 50%;
            }
            /* Empty State */
            .home-empty-state {
              padding: 60px 24px;
              text-align: center;
              display: flex;
              flex-direction: column;
              align-items: center;
            }
            .empty-icon {
              font-size: 54px;
              margin-bottom: 16px;
            }
            .empty-title {
              font-size: 20px;
              font-weight: 700;
              margin: 0 0 8px;
              color: #ffffff;
            }
            .empty-desc {
              font-size: 14px;
              color: #8e8e93;
              max-width: 280px;
              line-height: 1.4;
              margin: 0 0 24px;
            }
            .btn--primary {
              background: var(--primary, #FF4757);
              color: #ffffff;
              border: none;
              border-radius: 24px;
              padding: 12px 24px;
              font-size: 15px;
              font-weight: 600;
              display: inline-flex;
              align-items: center;
              gap: 8px;
              cursor: pointer;
              box-shadow: 0 4px 16px rgba(255, 71, 87, 0.4);
            }
            .btn--primary:active {
              transform: scale(0.97);
            }

            /* ══════════ Diseño del inicio ══════════ */
            @keyframes cardIn {
              from { opacity: 0; transform: translateY(14px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            @keyframes heroGlow {
              0%, 100% { opacity: 0.55; transform: scale(1); }
              50%      { opacity: 0.95; transform: scale(1.06); }
            }

            /* Cabecera de bienvenida con los colores de la portada */
            .greeting-banner {
              padding: 26px 20px 22px;
              overflow: hidden;
              background:
                radial-gradient(120% 100% at 100% 0%,
                  rgba(var(--artwork-rgb, 255, 71, 87), 0.42), transparent 62%),
                linear-gradient(180deg,
                  rgba(var(--artwork-rgb, 255, 71, 87), 0.24) 0%,
                  rgba(18, 18, 18, 0) 100%);
              transition: background-image 0.6s ease;
              animation: cardIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            .greeting-banner::after {
              content: '';
              position: absolute;
              width: 180px;
              height: 180px;
              right: -70px;
              top: -80px;
              border-radius: 50%;
              background: radial-gradient(circle,
                rgba(var(--artwork-rgb, 255, 71, 87), 0.5), transparent 68%);
              animation: heroGlow 5.5s ease-in-out infinite;
              pointer-events: none;
            }
            .greeting-avatar {
              background: linear-gradient(135deg,
                var(--artwork-color, #FF4757), var(--artwork-color-2, #FF6B35));
              box-shadow: 0 4px 14px rgba(var(--artwork-rgb, 255, 71, 87), 0.45);
            }

            /* Título de sección con acento de color */
            .section__title {
              position: relative;
              padding-left: 12px;
            }
            .section__title::before {
              content: '';
              position: absolute;
              left: 0;
              top: 50%;
              transform: translateY(-50%);
              width: 4px;
              height: 17px;
              border-radius: 3px;
              background: linear-gradient(180deg,
                var(--artwork-color, #FF4757), var(--artwork-color-2, #FF6B35));
            }

            /* Entrada escalonada + elevación al pasar el dedo */
            .section__scroll > * {
              animation: cardIn 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            .section__scroll > *:nth-child(1) { animation-delay: 0.02s; }
            .section__scroll > *:nth-child(2) { animation-delay: 0.06s; }
            .section__scroll > *:nth-child(3) { animation-delay: 0.10s; }
            .section__scroll > *:nth-child(4) { animation-delay: 0.14s; }
            .section__scroll > *:nth-child(5) { animation-delay: 0.18s; }

            .recent-card, .played-card, .mix-card, .artist-card {
              transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
            }
            .recent-card:hover, .played-card:hover,
            .mix-card:hover, .artist-card:hover {
              transform: translateY(-4px);
            }
            .recent-artwork, .played-artwork, .artist-avatar, .mix-card__art-wrap {
              transition: transform 0.35s ease;
            }
            .recent-card:hover .recent-artwork,
            .played-card:hover .played-artwork,
            .artist-card:hover .artist-avatar {
              transform: scale(1.07);
            }

            /* Chips de sugerencias rápidas (estaban sin estilo) */
            .quick-suggest-chip {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 9px 14px;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.1);
              color: #ffffff;
              font-size: 12.5px;
              font-weight: 600;
              cursor: pointer;
              white-space: nowrap;
              transition: background 0.18s ease, border-color 0.18s ease, transform 0.15s ease;
            }
            .quick-suggest-chip:hover {
              background: rgba(var(--artwork-rgb, 255, 71, 87), 0.22);
              border-color: rgba(var(--artwork-rgb, 255, 71, 87), 0.5);
            }
            .quick-suggest-chip:active { transform: scale(0.95); }

            /* Responsive: las tarjetas tenían ancho fijo en px */
            @media (max-width: 380px) {
              .recent-card { flex: 0 0 112px; width: 112px; height: 162px; }
              .recent-artwork-wrap { width: 112px; height: 112px; }
              .mix-card { flex: 0 0 152px; width: 152px; }
              .played-card { flex: 0 0 118px; width: 118px; }
            }
            @media (min-width: 700px) {
              .recent-card { flex: 0 0 152px; width: 152px; height: 208px; }
              .recent-artwork-wrap { width: 152px; height: 152px; }
              .mix-card { flex: 0 0 208px; width: 208px; }
            }
          </style>

          <!-- Greeting Banner -->
          <header class="greeting-banner">
            <div class="greeting-header">
              <div>
                <h1 class="greeting-text">${greeting.text}, ${userName} ${greeting.icon}</h1>
                <p class="greeting-sub">Tu música personalizada de hoy</p>
              </div>
              <div class="greeting-avatar" title="${userName}">
                ${userName.charAt(0).toUpperCase()}
              </div>
            </div>
          </header>

          <!-- Dynamic Content Container -->
          <div id="home-dynamic-content">
            ${renderSkeleton()}
          </div>
        </div>
      `;
    },

    async init() {
      rootElement = $('.page-home');
      if (!rootElement) return;

      const dynamicContainer = $('#home-dynamic-content', rootElement);
      if (!dynamicContainer) return;

      // Bind delegated click events
      clickHandler = async (e) => {
        try {
          const target = e.target;
          if (!target) return;

          // 0. Go Search
          const goSearchBtn = target.closest('[data-action="go-search"]');
          if (goSearchBtn) {
            if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
              Sonora.Router.navigate('search');
            }
            return;
          }

          // 0.1 Quick search chip
          const quickSearchBtn = target.closest('[data-quick-search]');
          if (quickSearchBtn) {
            const query = quickSearchBtn.getAttribute('data-quick-search');
            if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
              Sonora.Router.navigate('search?q=' + encodeURIComponent(query));
            }
            return;
          }

          // 0.2 External recommendation card click (e.g., Nirvana recommendations)
          const extRecCard = target.closest('[data-external-rec]');
          if (extRecCard && !target.closest('.section__more')) {
            try {
              const trackData = JSON.parse(extRecCard.getAttribute('data-external-rec'));
              if (trackData && Sonora.Player && typeof Sonora.Player.play === 'function') {
                const serverBase = (Sonora.API && typeof Sonora.API.getActiveUrl === 'function') ? Sonora.API.getActiveUrl() : 'http://192.168.1.132:3000';
                const trackObj = {
                  id: trackData.id || ('ext_' + Date.now()),
                  title: trackData.title,
                  artist: trackData.artist,
                  album: 'YouTube Music',
                  duration: trackData.duration || 215,
                  artworkUrl: trackData.thumbnail,
                  sourceUrl: trackData.url,
                  streamUrl: `${serverBase}/api/stream/external?url=${encodeURIComponent(trackData.url)}`,
                  platform: 'youtube'
                };
                Sonora.Player.play(trackObj);
                if (Sonora.Store) {
                  Sonora.Store.emit('toast', { message: `Reproduciendo "${trackData.title}" (${trackData.artist})`, type: 'info' });
                }
              }
            } catch (err) {
              console.error('[Home] Error playing recommended track:', err);
            }
            return;
          }

          // 0.3 Play artist mix
          const playArtistMixBtn = target.closest('[data-action="play-artist-mix"]');
          if (playArtistMixBtn) {
            const cache = window._sonora_home_data || {};
            const recs = cache.artistRecommendations || [];
            if (recs.length > 0 && Sonora.Player) {
              const serverBase = (Sonora.API && typeof Sonora.API.getActiveUrl === 'function') ? Sonora.API.getActiveUrl() : 'http://192.168.1.132:3000';
              const queue = recs.map((r, i) => ({
                id: r.id || ('ext_' + Date.now() + '_' + i),
                title: r.title,
                artist: r.artist,
                album: 'YouTube Music',
                duration: r.duration || 215,
                artworkUrl: r.thumbnail,
                sourceUrl: r.url,
                streamUrl: `${serverBase}/api/stream/external?url=${encodeURIComponent(r.url)}`,
                platform: 'youtube'
              }));
              Sonora.Player.setQueue(queue, 0);
            }
            return;
          }

          // 1. Play track from recent or most played card
          const trackCard = target.closest('[data-track-id]');
          if (trackCard && !target.closest('.section__more')) {
            const trackId = trackCard.getAttribute('data-track-id');
            const trackContext = trackCard.getAttribute('data-context') || 'recent';
            await handleTrackCardClick(trackId, trackContext);
            return;
          }

          // 2. Play mix
          const mixCard = target.closest('[data-mix-id]');
          if (mixCard && !target.closest('.section__more')) {
            const mixId = mixCard.getAttribute('data-mix-id');
            await handleMixCardClick(mixId);
            return;
          }

          // 3. View artist
          const artistCard = target.closest('[data-artist-id]');
          if (artistCard && !target.closest('.section__more')) {
            const artistId = artistCard.getAttribute('data-artist-id');
            if (Sonora.Store && typeof Sonora.Store.set === 'function') {
              Sonora.Store.set('library_active_tab', 'artistas');
              Sonora.Store.set('library_selected_artist', artistId);
            }
            if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
              Sonora.Router.navigate('/library');
            }
            return;
          }

          // 4. "Ver todo" navigation
          const moreBtn = target.closest('[data-navigate]');
          if (moreBtn) {
            const route = moreBtn.getAttribute('data-navigate') || '';
            if (route.includes('recientes')) {
              if (Sonora.Store && typeof Sonora.Store.set === 'function') {
                Sonora.Store.set('library_active_tab', 'canciones');
                Sonora.Store.set('library_sort', 'recent');
              }
              if (Sonora.Router && typeof Sonora.Router.navigate === 'function') Sonora.Router.navigate('/library');
              return;
            } else if (route.includes('sort=popular')) {
              if (Sonora.Store && typeof Sonora.Store.set === 'function') {
                Sonora.Store.set('library_active_tab', 'canciones');
                Sonora.Store.set('library_sort', 'popular');
              }
              if (Sonora.Router && typeof Sonora.Router.navigate === 'function') Sonora.Router.navigate('/library');
              return;
            } else if (route.includes('artistas')) {
              if (Sonora.Store && typeof Sonora.Store.set === 'function') {
                Sonora.Store.set('library_active_tab', 'artistas');
              }
              if (Sonora.Router && typeof Sonora.Router.navigate === 'function') Sonora.Router.navigate('/library');
              return;
            }
            const cleanRoute = route.startsWith('/') ? route : '/' + route;
            if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
              Sonora.Router.navigate(cleanRoute);
            }
            return;
          }

          // 5. Sync button in empty state
          const syncBtn = target.closest('#home-sync-btn');
          if (syncBtn) {
            syncBtn.disabled = true;
            syncBtn.textContent = 'Sincronizando...';
            try {
              if (Sonora.API && typeof Sonora.API.get === 'function') {
                await Sonora.API.get('/sync');
              } else if (Sonora.Store && typeof Sonora.Store.emit === 'function') {
                Sonora.Store.emit('sync:request');
              }
            } catch (err) {
              console.warn('[Home] Sync error:', err);
            }
            // Reload home view
            setTimeout(() => {
              if (Sonora.Pages.Home && typeof Sonora.Pages.Home.init === 'function') {
                Sonora.Pages.Home.init();
              }
            }, 800);
            return;
          }
        } catch (err) {
          console.error('[Home] Error handling click:', err);
        }
      };

      rootElement.addEventListener('click', clickHandler);

      // Load data from Sonora.DB
      try {
        let historyTracks = [];
        let dailyMixes = [];
        let personalMixes = [];
        let mostPlayedTracks = [];
        let favoriteArtists = [];
        let allTracks = [];

        // Check if Sonora.DB is ready
        if (Sonora.DB) {
          // Tracks
          if (Sonora.DB.tracks && typeof Sonora.DB.tracks.getAll === 'function') {
            allTracks = (await Sonora.DB.tracks.getAll()) || [];
          }

          // History / Recent
          if (Sonora.DB.history && typeof Sonora.DB.history.getRecent === 'function') {
            const historyItems = (await Sonora.DB.history.getRecent(20)) || [];
            // Map history items to full track objects if needed
            historyTracks = historyItems.map(item => {
              if (item.title) return item; // It's already a track
              if (item.track) return item.track;
              if (item.trackId && allTracks.length > 0) {
                return allTracks.find(t => t.id === item.trackId);
              }
              return item;
            }).filter(Boolean);
          }
          if (historyTracks.length === 0 && Sonora.DB.tracks && typeof Sonora.DB.tracks.getRecent === 'function') {
            historyTracks = (await Sonora.DB.tracks.getRecent(20)) || [];
          }
          if (historyTracks.length === 0 && allTracks.length > 0) {
            historyTracks = allTracks.slice(0, 15);
          }

          // Mixes
          if (Sonora.DB.mixes && typeof Sonora.DB.mixes.getAll === 'function') {
            const allMixes = (await Sonora.DB.mixes.getAll()) || [];
            dailyMixes = allMixes.filter(m => m.type === 'daily');
            personalMixes = allMixes.filter(m => m.type === 'personal');
          }

          // If mixes are not populated in DB, synthesize rich mixes from tracks
          if (dailyMixes.length === 0 && allTracks.length > 0) {
            dailyMixes = createFallbackMixes(allTracks, 'daily');
          }
          if (personalMixes.length === 0 && allTracks.length > 0) {
            personalMixes = createFallbackMixes(allTracks, 'personal');
          }

          // Most played
          if (Sonora.DB.tracks && typeof Sonora.DB.tracks.getMostPlayed === 'function') {
            mostPlayedTracks = (await Sonora.DB.tracks.getMostPlayed(15)) || [];
          } else if (allTracks.length > 0) {
            mostPlayedTracks = [...allTracks].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 15);
          }

          // Artists
          if (Sonora.DB.artists && typeof Sonora.DB.artists.getAll === 'function') {
            favoriteArtists = (await Sonora.DB.artists.getAll()) || [];
            favoriteArtists = favoriteArtists.slice(0, 10);
          }
          // If no artists in table, extract unique artists from allTracks
          if (favoriteArtists.length === 0 && allTracks.length > 0) {
            const artistMap = new Map();
            allTracks.forEach(t => {
              if (t.artist && !artistMap.has(t.artist)) {
                artistMap.set(t.artist, {
                  id: t.artistId || t.artist,
                  name: t.artist,
                  imageUrl: t.artworkUrl || null,
                  trackCount: 1
                });
              } else if (t.artist && artistMap.has(t.artist)) {
                artistMap.get(t.artist).trackCount++;
              }
            });
            favoriteArtists = Array.from(artistMap.values()).slice(0, 10);
          }
        }

        // Personal Artist Affinity (e.g. Nirvana)
        let topArtist = null;
        let artistRecommendations = [];
        try {
          const userArtists = JSON.parse(localStorage.getItem('sonora_user_artists') || '{}');
          const artistKeys = Object.keys(userArtists);
          if (artistKeys.length > 0) {
            artistKeys.sort((a, b) => userArtists[b] - userArtists[a]);
            topArtist = artistKeys[0];
          } else {
            topArtist = localStorage.getItem('sonora_last_artist') || null;
          }

          if (topArtist && Sonora.API && typeof Sonora.API.getRecommendations === 'function') {
            artistRecommendations = await Sonora.API.getRecommendations(topArtist, '');
          }
        } catch (e) {
          console.warn('[Home] Recommendation fetch error:', e);
        }

        // Cache loaded tracks on window for quick playback queueing
        window._sonora_home_data = {
          historyTracks,
          dailyMixes,
          personalMixes,
          mostPlayedTracks,
          favoriteArtists,
          allTracks,
          topArtist,
          artistRecommendations
        };

        const isEmpty = allTracks.length === 0 &&
                        historyTracks.length === 0 &&
                        dailyMixes.length === 0 &&
                        mostPlayedTracks.length === 0 &&
                        favoriteArtists.length === 0 &&
                        artistRecommendations.length === 0;

        if (isEmpty) {
          // Requirement: show skeleton loading for 1s then show "Conecta al servidor para cargar música"
          skeletonTimeout = setTimeout(() => {
            if (dynamicContainer) {
              dynamicContainer.innerHTML = renderEmptyState();
            }
          }, 1000);
        } else {
          // Render all populated sections
          dynamicContainer.innerHTML = renderHomeSections({
            historyTracks,
            dailyMixes,
            personalMixes,
            mostPlayedTracks,
            favoriteArtists,
            allTracks,
            topArtist,
            artistRecommendations
          });
        }
      } catch (err) {
        console.error('[Home] Failed to load home data:', err);
        if (dynamicContainer) {
          dynamicContainer.innerHTML = renderEmptyState();
        }
      }
    },

    destroy() {
      try {
        if (rootElement && clickHandler) {
          rootElement.removeEventListener('click', clickHandler);
          clickHandler = null;
        }
        if (skeletonTimeout) {
          clearTimeout(skeletonTimeout);
          skeletonTimeout = null;
        }
        if (scrollDebounceTimer) {
          clearTimeout(scrollDebounceTimer);
          scrollDebounceTimer = null;
        }
        rootElement = null;
      } catch (e) {
        console.warn('[Home] Cleanup error:', e);
      }
    }
  };

  // Helper: Build HTML for all home sections
  function renderHomeSections(data) {
    const {
      historyTracks,
      dailyMixes,
      personalMixes,
      mostPlayedTracks,
      favoriteArtists,
      allTracks,
      topArtist,
      artistRecommendations
    } = data;

    let html = '';

    // 1. Recientes (Recent)
    if (historyTracks && historyTracks.length > 0) {
      html += `
        <section class="section">
          <div class="section__header">
            <h2 class="section__title">Recientes</h2>
            <button class="section__more" data-navigate="library?tab=recientes">Ver todo</button>
          </div>
          <div class="section__scroll">
            ${historyTracks.map((track, idx) => `
              <div class="recent-card" data-track-id="${escapeHtml(track.id)}" data-context="recent" data-idx="${idx}">
                <div class="recent-artwork-wrap">
                  <img class="recent-artwork" src="${escapeHtml(track.artworkUrl || generateArtwork(track.id, track.title))}" alt="${escapeHtml(track.title)}" loading="lazy" />
                  <div class="recent-play-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                </div>
                <div class="recent-title">${escapeHtml(track.title)}</div>
                <div class="recent-artist">${escapeHtml(track.artist || 'Artista desconocido')}</div>
              </div>
            `).join('')}
          </div>
        </section>
      `;
    }

    // 1.5 Basado en lo que escuchas (Recomendaciones de tu artista preferido, e.g. Nirvana)
    if (artistRecommendations && artistRecommendations.length > 0) {
      html += `
        <section class="section">
          <div class="section__header" style="align-items: flex-start;">
            <div>
              <h2 class="section__title" style="margin-bottom: 2px;">Basado en lo que escuchas: ${escapeHtml(topArtist || 'Tus gustos')}</h2>
              <span style="font-size: 12px; color: var(--color-primary, #FF4757); font-weight: 600;">Recomendado para ti</span>
            </div>
            <button class="section__more" data-action="play-artist-mix" data-artist="${escapeHtml(topArtist || '')}">Reproducir Mix</button>
          </div>
          <div class="section__scroll">
            ${artistRecommendations.map((track, idx) => `
              <div class="recent-card" data-external-rec='${escapeHtml(JSON.stringify(track))}'>
                <div class="recent-artwork-wrap">
                  <img class="recent-artwork" src="${escapeHtml(track.thumbnail || generateArtwork(idx, track.title))}" alt="${escapeHtml(track.title)}" loading="lazy" />
                  <div class="recent-play-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                </div>
                <div class="recent-title">${escapeHtml(track.title)}</div>
                <div class="recent-artist">${escapeHtml(track.artist || topArtist || 'YouTube Music')}</div>
              </div>
            `).join('')}
          </div>
        </section>
      `;
    }

    // 2. Daily Mixes (up to 5)
    if (dailyMixes && dailyMixes.length > 0) {
      const displayMixes = dailyMixes.slice(0, 5);
      html += `
        <section class="section">
          <div class="section__header">
            <h2 class="section__title">Daily Mixes</h2>
            <button class="section__more" data-navigate="discover">Ver todo</button>
          </div>
          <div class="section__scroll">
            ${displayMixes.map((mix, idx) => {
              const mosaicArts = getMixArtworks(mix, allTracks);
              return `
                <div class="mix-card" data-mix-id="${escapeHtml(mix.id)}" data-mix-type="daily">
                  <div class="mix-card__art-wrap">
                    ${renderMosaic(mosaicArts, mix.name)}
                    <div class="mix-overlay-badge">Mix ${idx + 1}</div>
                  </div>
                  <div class="mix-title">${escapeHtml(mix.name)}</div>
                  <div class="mix-desc">${escapeHtml(mix.description || 'Basado en tu actividad reciente')}</div>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }

    // 3. Hecho para ti (Made For You: Discover Weekly, Release Radar, Your Mix)
    if (personalMixes && personalMixes.length > 0) {
      html += `
        <section class="section">
          <div class="section__header">
            <h2 class="section__title">Hecho para ti</h2>
            <button class="section__more" data-navigate="discover">Ver todo</button>
          </div>
          <div class="section__scroll">
            ${personalMixes.map(mix => {
              const mosaicArts = getMixArtworks(mix, allTracks);
              return `
                <div class="mix-card" data-mix-id="${escapeHtml(mix.id)}" data-mix-type="personal">
                  <div class="mix-card__art-wrap">
                    ${renderMosaic(mosaicArts, mix.name)}
                    <div class="mix-overlay-badge">Para Ti</div>
                  </div>
                  <div class="mix-title">${escapeHtml(mix.name)}</div>
                  <div class="mix-desc">${escapeHtml(mix.description || 'Canciones seleccionadas especialmente')}</div>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }

    // 4. Más escuchadas (Most Played)
    if (mostPlayedTracks && mostPlayedTracks.length > 0) {
      html += `
        <section class="section">
          <div class="section__header">
            <h2 class="section__title">Más escuchadas</h2>
            <button class="section__more" data-navigate="library?tab=canciones&sort=popular">Ver todo</button>
          </div>
          <div class="section__scroll">
            ${mostPlayedTracks.map((track, idx) => `
              <div class="played-card" data-track-id="${escapeHtml(track.id)}" data-context="popular" data-idx="${idx}">
                <div class="played-artwork-wrap">
                  <img class="played-artwork" src="${escapeHtml(track.artworkUrl || generateArtwork(track.id, track.title))}" alt="${escapeHtml(track.title)}" loading="lazy" />
                  <div class="played-count-badge">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    ${track.playCount || 0}
                  </div>
                </div>
                <div class="recent-title">${escapeHtml(track.title)}</div>
                <div class="recent-artist">${escapeHtml(track.artist || 'Artista desconocido')}</div>
              </div>
            `).join('')}
          </div>
        </section>
      `;
    }

    // 5. Artistas que te gustan (Artists You Like)
    if (favoriteArtists && favoriteArtists.length > 0) {
      html += `
        <section class="section">
          <div class="section__header">
            <h2 class="section__title">Artistas que te gustan</h2>
            <button class="section__more" data-navigate="library?tab=artistas">Ver todo</button>
          </div>
          <div class="section__scroll">
            ${favoriteArtists.map(artist => `
              <div class="artist-card" data-artist-id="${escapeHtml(artist.id || artist.name)}">
                <div class="artist-avatar-wrap">
                  <img class="artist-avatar" src="${escapeHtml(artist.imageUrl || generateArtwork(artist.id || artist.name, artist.name))}" alt="${escapeHtml(artist.name)}" loading="lazy" />
                </div>
                <div class="artist-name">${escapeHtml(artist.name)}</div>
                <div class="artist-sub">${artist.trackCount ? artist.trackCount + ' canciones' : 'Artista'}</div>
              </div>
            `).join('')}
          </div>
        </section>
      `;
    }

    return html;
  }

  // Helper to extract 4 artworks from a mix's trackIds or tracks
  function getMixArtworks(mix, allTracks) {
    const arts = [];
    if (mix.artworkUrl) {
      arts.push(mix.artworkUrl);
    }
    if (mix.trackIds && mix.trackIds.length > 0 && allTracks && allTracks.length > 0) {
      for (const tid of mix.trackIds) {
        const found = allTracks.find(t => t.id === tid);
        if (found) {
          arts.push(found.artworkUrl || generateArtwork(found.id, found.title));
        }
        if (arts.length >= 4) break;
      }
    }
    while (arts.length < 4) {
      arts.push(generateArtwork(mix.id + '-' + arts.length, mix.name));
    }
    return arts;
  }

  // Create fallback mixes if database is fresh
  function createFallbackMixes(tracks, type) {
    if (!tracks || tracks.length === 0) return [];

    if (type === 'daily') {
      const genres = [...new Set(tracks.map(t => t.genre).filter(Boolean))];
      const mixes = [];
      const mixCount = Math.min(5, Math.max(2, genres.length));

      for (let i = 0; i < mixCount; i++) {
        const genre = genres[i] || 'Variado';
        const mixTracks = tracks.filter(t => t.genre === genre);
        const selected = mixTracks.length > 0 ? mixTracks : tracks.slice(i * 3, i * 3 + 8);
        const topArtists = [...new Set(selected.map(t => t.artist).filter(Boolean))].slice(0, 3).join(', ');

        mixes.push({
          id: 'daily-mix-' + (i + 1),
          name: `Daily Mix ${i + 1}`,
          description: topArtists ? `${topArtists} y más` : `Lo mejor de ${genre}`,
          type: 'daily',
          genre: genre,
          trackIds: selected.map(t => t.id)
        });
      }
      return mixes;
    } else {
      // Personal mixes: Discover Weekly, Release Radar, Your Mix
      return [
        {
          id: 'personal-discover',
          name: 'Descubrimiento Semanal',
          description: 'Tu selección personalizada con nuevas recomendaciones cada semana.',
          type: 'personal',
          trackIds: tracks.slice(0, 15).map(t => t.id)
        },
        {
          id: 'personal-radar',
          name: 'Radar de Novedades',
          description: 'No te pierdas los lanzamientos más recientes de tus artistas seguidos.',
          type: 'personal',
          trackIds: tracks.slice().reverse().slice(0, 15).map(t => t.id)
        },
        {
          id: 'personal-mix',
          name: 'Tu Mix Especial',
          description: 'Una mezcla única basada en tus canciones y artistas preferidos.',
          type: 'personal',
          trackIds: tracks.slice().sort(() => 0.5 - Math.random()).slice(0, 15).map(t => t.id)
        }
      ];
    }
  }

  // Action handlers
  async function handleTrackCardClick(trackId, context) {
    try {
      const cache = window._sonora_home_data || {};
      let queue = [];
      let startIdx = 0;

      if (context === 'recent') {
        queue = cache.historyTracks || [];
      } else if (context === 'popular') {
        queue = cache.mostPlayedTracks || [];
      } else {
        queue = cache.allTracks || [];
      }

      startIdx = queue.findIndex(t => String(t.id) === String(trackId));
      if (startIdx === -1) {
        // Fetch track directly from DB
        let track = null;
        if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.getById === 'function') {
          track = await Sonora.DB.tracks.getById(trackId);
        }
        if (track) {
          queue = [track];
          startIdx = 0;
        }
      }

      if (Sonora.Player && queue.length > 0) {
        if (typeof Sonora.Player.setQueue === 'function') {
          Sonora.Player.setQueue(queue, Math.max(0, startIdx));
        } else if (typeof Sonora.Player.play === 'function') {
          Sonora.Player.play(queue[Math.max(0, startIdx)]);
        }
      }
    } catch (e) {
      console.error('[Home] Failed to play track:', e);
    }
  }

  async function handleMixCardClick(mixId) {
    try {
      const cache = window._sonora_home_data || {};
      let mix = null;

      const allMixes = [...(cache.dailyMixes || []), ...(cache.personalMixes || [])];
      mix = allMixes.find(m => String(m.id) === String(mixId));

      if (!mix && Sonora.DB && Sonora.DB.mixes && typeof Sonora.DB.mixes.getById === 'function') {
        mix = await Sonora.DB.mixes.getById(mixId);
      }

      if (!mix) return;

      let tracksToPlay = [];
      if (mix.trackIds && mix.trackIds.length > 0) {
        const all = cache.allTracks || (Sonora.DB && Sonora.DB.tracks ? await Sonora.DB.tracks.getAll() : []);
        tracksToPlay = mix.trackIds.map(tid => all.find(t => String(t.id) === String(tid))).filter(Boolean);
      }

      if (tracksToPlay.length === 0 && cache.allTracks && cache.allTracks.length > 0) {
        tracksToPlay = cache.allTracks.slice(0, 20);
      }

      if (tracksToPlay.length > 0 && Sonora.Player) {
        if (typeof Sonora.Player.setQueue === 'function') {
          Sonora.Player.setQueue(tracksToPlay, 0);
        } else if (typeof Sonora.Player.play === 'function') {
          Sonora.Player.play(tracksToPlay[0]);
        }
      }
    } catch (e) {
      console.error('[Home] Failed to play mix:', e);
    }
  }

})();
