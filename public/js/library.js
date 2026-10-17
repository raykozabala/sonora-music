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

  function showToast(message) {
    let toast = $('#library-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'library-toast';
      toast.className = 'library-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2400);
  }

  // Module state
  let rootElement = null;
  let activeTab = 'canciones'; // 'canciones' | 'albumes' | 'artistas' | 'favoritos' | 'descargados'
  let currentSort = 'az'; // 'az' | 'recent' | 'popular'
  let activeTrackForMenu = null;
  let detailViewType = null; // null | 'album' | 'artist'
  let detailViewData = null;

  // Cached data
  let allTracks = [];
  let allAlbums = [];
  let allArtists = [];
  let currentTabTracks = [];
  // Sección "Este dispositivo / Local"
  let deviceTracks = [];
  let deviceNeedsPermission = false;
  let deviceLoading = false;
  let deviceLoadedOnce = false;

  // Tab definitions
  const TABS = [
    { id: 'canciones', label: 'Canciones' },
    { id: 'albumes', label: 'Álbumes' },
    { id: 'artistas', label: 'Artistas' },
    { id: 'favoritos', label: 'Favoritos' },
    { id: 'descargados', label: 'Descargados' },
    { id: 'dispositivo', label: 'Este dispositivo' }
  ];

  // Renderers
  function renderTabsBar() {
    return `
      <div class="library-tabs-nav" role="tablist">
        ${TABS.map(tab => `
          <button
            class="library-tab-btn ${activeTab === tab.id ? 'active' : ''}"
            role="tab"
            aria-selected="${activeTab === tab.id ? 'true' : 'false'}"
            data-tab="${tab.id}"
          >
            ${tab.label}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderSortBar() {
    return `
      <div class="library-sort-bar">
        <span class="sort-label">Ordenar:</span>
        <div class="sort-chips">
          <button class="sort-chip ${currentSort === 'az' ? 'active' : ''}" data-sort="az">A-Z</button>
          <button class="sort-chip ${currentSort === 'recent' ? 'active' : ''}" data-sort="recent">Recientes</button>
          <button class="sort-chip ${currentSort === 'popular' ? 'active' : ''}" data-sort="popular">Más escuchadas</button>
        </div>
      </div>
    `;
  }

  function sortTracks(tracks, sortType) {
    const list = [...tracks];
    if (sortType === 'az') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
    } else if (sortType === 'recent') {
      list.sort((a, b) => {
        const timeA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : (a.dateAdded ? new Date(a.dateAdded).getTime() : 0);
        const timeB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : (b.dateAdded ? new Date(b.dateAdded).getTime() : 0);
        return timeB - timeA;
      });
    } else if (sortType === 'popular') {
      list.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    }
    return list;
  }

  function renderTrackRow(track, idx, context) {
    const isFav = !!track.isFavorite;
    const isDl = !!track.isDownloaded || (Sonora.Download && typeof Sonora.Download.isDownloaded === 'function' && Sonora.Download.isDownloaded(track.id));

    return `
      <div class="lib-track-item" data-action="play-track" data-track-id="${escapeHtml(track.id)}" data-idx="${idx}" data-context="${context}">
        <div class="lib-track-art-wrap">
          <img class="lib-track-art" src="${escapeHtml(track.artworkUrl || generateArtwork(track.id, track.title))}" alt="" loading="lazy" />
          <div class="lib-track-play-badge">▶</div>
        </div>
        <div class="lib-track-info">
          <div class="lib-track-title">${escapeHtml(track.title)}</div>
          <div class="lib-track-meta">
            ${isDl ? '<span class="download-badge" title="Descargado">✓</span>' : ''}
            <span>${escapeHtml(track.artist || 'Artista desconocido')}</span>
            ${track.album ? `<span>• ${escapeHtml(track.album)}</span>` : ''}
          </div>
        </div>
        <div class="lib-track-actions">
          <span class="lib-track-duration">${formatTime(track.duration)}</span>
          <button
            class="btn-icon btn-fav ${isFav ? 'is-fav' : ''}"
            data-action="toggle-fav"
            data-track-id="${escapeHtml(track.id)}"
            aria-label="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFav ? 'var(--primary, #FF4757)' : 'none'}" stroke="${isFav ? 'var(--primary, #FF4757)' : 'currentColor'}" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          <button
            class="btn-icon btn-menu"
            data-action="open-track-menu"
            data-track-id="${escapeHtml(track.id)}"
            aria-label="Más opciones"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderCancionesTab(tracks) {
    if (!tracks || tracks.length === 0) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">🎵</div>
          <h3>Tu biblioteca está vacía</h3>
          <p>Busca tus canciones favoritas en YouTube o SoundCloud para comenzar a escuchar y descargar.</p>
          <button type="button" class="btn btn--primary" data-action="go-search" style="margin-top:16px; background:var(--color-primary, #FF4757); color:#fff; border:none; border-radius:20px; padding:10px 22px; font-weight:700; cursor:pointer;">
            🔍 Buscar música para comenzar
          </button>
        </div>
      `;
    }

    const sorted = sortTracks(tracks, currentSort);
    currentTabTracks = sorted;

    return `
      ${renderSortBar()}
      <div class="lib-tracks-container">
        ${sorted.map((t, idx) => renderTrackRow(t, idx, 'canciones')).join('')}
      </div>
    `;
  }

  function renderAlbumesTab(albums) {
    if (!albums || albums.length === 0) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">💿</div>
          <h3>No tienes álbumes</h3>
          <p>Los álbumes de tu biblioteca se mostrarán aquí.</p>
        </div>
      `;
    }

    return `
      <div class="lib-albums-grid">
        ${albums.map(alb => `
          <div class="lib-album-card" data-action="open-album" data-album-id="${escapeHtml(alb.id || alb.title)}">
            <div class="lib-album-art-wrap">
              <img class="lib-album-art" src="${escapeHtml(alb.artworkUrl || generateArtwork(alb.id || alb.title, alb.title))}" alt="" loading="lazy" />
            </div>
            <div class="lib-album-title">${escapeHtml(alb.title)}</div>
            <div class="lib-album-artist">${escapeHtml(alb.artist || 'Varios artistas')}</div>
            <div class="lib-album-meta">
              ${alb.year ? `<span>${alb.year}</span>` : ''}
              ${alb.trackCount ? `<span>• ${alb.trackCount} canciones</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderArtistasTab(artists) {
    if (!artists || artists.length === 0) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">👥</div>
          <h3>No tienes artistas</h3>
          <p>Explora música y añade artistas a tu colección.</p>
        </div>
      `;
    }

    return `
      <div class="lib-artists-list">
        ${artists.map(art => `
          <div class="lib-artist-item" data-action="open-artist" data-artist-id="${escapeHtml(art.id || art.name)}">
            <div class="lib-artist-avatar-wrap">
              <img class="lib-artist-avatar" src="${escapeHtml(art.imageUrl || generateArtwork(art.id || art.name, art.name))}" alt="" loading="lazy" />
            </div>
            <div class="lib-artist-info">
              <div class="lib-artist-name">${escapeHtml(art.name)}</div>
              <div class="lib-artist-meta">${art.trackCount ? art.trackCount + ' canciones' : 'Artista'} ${art.albumCount ? '• ' + art.albumCount + ' álbumes' : ''}</div>
            </div>
            <div class="lib-artist-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderFavoritosTab(tracks) {
    const favTracks = tracks.filter(t => !!t.isFavorite);
    if (favTracks.length === 0) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">❤️</div>
          <h3>Sin favoritos todavía</h3>
          <p>Toca el corazón en cualquier canción que te guste para guardarla en tus favoritos.</p>
        </div>
      `;
    }

    const sorted = sortTracks(favTracks, currentSort);
    currentTabTracks = sorted;

    return `
      <div class="tab-header-action">
        <button class="btn btn--primary play-all-btn" data-action="play-tab-all">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Reproducir Favoritos (${sorted.length})
        </button>
      </div>
      ${renderSortBar()}
      <div class="lib-tracks-container">
        ${sorted.map((t, idx) => renderTrackRow(t, idx, 'favoritos')).join('')}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // "Este dispositivo / Local": lee los archivos de audio del teléfono (Android)
  // ---------------------------------------------------------------------------
  function deviceBridgeAvailable() {
    return !!(window.SonoraNative && typeof window.SonoraNative.getDeviceMusicFiles === 'function');
  }

  async function loadDeviceTracks() {
    if (!deviceBridgeAvailable()) {
      deviceTracks = [];
      deviceNeedsPermission = false;
      deviceLoadedOnce = true;
      return;
    }
    deviceLoading = true;
    renderCurrentView();
    try {
      const raw = window.SonoraNative.getDeviceMusicFiles();
      const parsed = JSON.parse(raw || '[]');
      if (parsed && parsed.__needsPermission) {
        deviceNeedsPermission = true;
        deviceTracks = [];
      } else {
        deviceNeedsPermission = false;
        deviceTracks = Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.warn('[Library] Error escaneando dispositivo:', e);
      deviceTracks = [];
    } finally {
      deviceLoading = false;
      deviceLoadedOnce = true;
      renderCurrentView();
    }
  }

  // Android nos avisa cuando el usuario concede/niega el permiso de audio
  window.onSonoraPermissionResult = function (granted) {
    deviceNeedsPermission = !granted;
    deviceLoadedOnce = false;
    if (granted) {
      loadDeviceTracks();
    } else {
      renderCurrentView();
    }
  };

  function renderDispositivoTab() {
    if (!deviceBridgeAvailable()) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">📵</div>
          <h3>Solo en la app Android</h3>
          <p>Esta sección lee los MP3, M4A, WAV y FLAC que tengas en el teléfono. Ábrela desde la app instalada en tu Android.</p>
        </div>
      `;
    }

    if (deviceNeedsPermission) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">🔓</div>
          <h3>Falta el permiso</h3>
          <p>Sonora necesita permiso para leer los archivos de audio del teléfono.</p>
          <button type="button" class="btn btn--primary" data-action="request-storage"
                  style="margin-top:16px; background:var(--color-primary, #FF4757); color:#fff; border:none; border-radius:20px; padding:10px 22px; font-weight:700; cursor:pointer;">
            🔓 Conceder permiso
          </button>
        </div>
      `;
    }

    if (deviceLoading) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">⏳</div>
          <h3>Buscando música en el teléfono…</h3>
          <p>Un momento.</p>
        </div>
      `;
    }

    if (!deviceTracks.length) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">📁</div>
          <h3>No se encontró música</h3>
          <p>No hay archivos de audio visibles en el teléfono. Copia música a la memoria y vuelve a escanear.</p>
          <div style="display:flex; gap:10px; justify-content:center; margin-top:16px; flex-wrap:wrap;">
            <button type="button" class="btn btn--primary" data-action="scan-device"
                    style="background:var(--color-primary, #FF4757); color:#fff; border:none; border-radius:20px; padding:10px 22px; font-weight:700; cursor:pointer;">
              🔄 Escanear de nuevo
            </button>
            <button type="button" class="btn" data-action="request-storage"
                    style="background:#25253a; color:#fff; border:1px solid rgba(255,255,255,0.15); border-radius:20px; padding:10px 22px; font-weight:700; cursor:pointer;">
              🔓 Permisos
            </button>
          </div>
        </div>
      `;
    }

    const sorted = sortTracks(deviceTracks, currentSort);
    currentTabTracks = sorted;

    return `
      <div class="tab-header-action">
        <button class="btn btn--primary play-all-btn" data-action="play-tab-all">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Reproducir todo (${sorted.length})
        </button>
        <button type="button" class="btn" data-action="scan-device" title="Escanear de nuevo"
                style="background:#25253a; color:#fff; border:1px solid rgba(255,255,255,0.15); border-radius:20px; padding:8px 14px; font-weight:700; cursor:pointer;">
          🔄
        </button>
        <button type="button" class="btn" data-action="request-storage" title="Permisos"
                style="background:#25253a; color:#fff; border:1px solid rgba(255,255,255,0.15); border-radius:20px; padding:8px 14px; font-weight:700; cursor:pointer;">
          🔓
        </button>
      </div>
      <div class="lib-tracks-container">
        ${sorted.map((t, idx) => renderTrackRow(t, idx, 'device')).join('')}
      </div>
    `;
  }

  function renderDescargadosTab(tracks) {
    const dlTracks = tracks.filter(t => {
      if (t.isDownloaded) return true;
      if (Sonora.Download && typeof Sonora.Download.isDownloaded === 'function') {
        return Sonora.Download.isDownloaded(t.id);
      }
      return false;
    });

    if (dlTracks.length === 0) {
      return `
        <div class="lib-empty-state">
          <div class="empty-icon">💾</div>
          <h3>Sin descargas</h3>
          <p>Descarga canciones desde el buscador para disfrutarlas sin conexión a internet o con Lark Player.</p>
          <button type="button" class="btn btn--primary" data-action="go-search" style="margin-top:16px; background:var(--color-primary, #FF4757); color:#fff; border:none; border-radius:20px; padding:10px 22px; font-weight:700; cursor:pointer;">
            🔍 Buscar canciones para descargar
          </button>
        </div>
      `;
    }

    const sorted = sortTracks(dlTracks, currentSort);
    currentTabTracks = sorted;

    return `
      <div class="tab-header-action">
        <button class="btn btn--primary play-all-btn" data-action="play-tab-all">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Reproducir Descargadas (${sorted.length})
        </button>
      </div>
      ${renderSortBar()}
      <div class="lib-tracks-container">
        ${sorted.map((t, idx) => renderTrackRow(t, idx, 'descargados')).join('')}
      </div>
    `;
  }

  function renderAlbumDetail(album, tracks) {
    const albumTracks = tracks.filter(t =>
      (album.id && (String(t.albumId) === String(album.id) || String(t.album) === String(album.title))) ||
      (t.album && t.album.toLowerCase() === (album.title || '').toLowerCase())
    );
    currentTabTracks = albumTracks;

    return `
      <div class="lib-detail-view">
        <div class="detail-header">
          <button class="btn-back" data-action="close-detail-view">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Volver
          </button>
          <div class="detail-hero">
            <div class="detail-hero-art-wrap">
              <img class="detail-hero-art" src="${escapeHtml(album.artworkUrl || generateArtwork(album.id || album.title, album.title))}" alt="" />
            </div>
            <div class="detail-hero-info">
              <span class="detail-type-badge">ÁLBUM</span>
              <h1 class="detail-title">${escapeHtml(album.title)}</h1>
              <p class="detail-subtitle">${escapeHtml(album.artist || 'Varios artistas')}</p>
              <p class="detail-meta">${album.year ? album.year + ' • ' : ''}${albumTracks.length} canciones</p>
            </div>
          </div>
          <div class="detail-action-buttons">
            <button class="btn btn--primary" data-action="play-tab-all">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Reproducir
            </button>
          </div>
        </div>

        <div class="lib-tracks-container detail-tracks-container">
          ${albumTracks.map((t, idx) => renderTrackRow(t, idx, 'album-detail')).join('')}
        </div>
      </div>
    `;
  }

  function renderArtistDetail(artist, tracks, albums) {
    const artistTracks = tracks.filter(t =>
      (artist.id && (String(t.artistId) === String(artist.id) || String(t.artist) === String(artist.name))) ||
      (t.artist && t.artist.toLowerCase() === (artist.name || '').toLowerCase())
    );
    const artistAlbums = albums.filter(a =>
      (artist.id && String(a.artistId) === String(artist.id)) ||
      (a.artist && a.artist.toLowerCase() === (artist.name || '').toLowerCase())
    );
    currentTabTracks = artistTracks;

    return `
      <div class="lib-detail-view">
        <div class="detail-header">
          <button class="btn-back" data-action="close-detail-view">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Volver
          </button>
          <div class="detail-hero">
            <div class="detail-hero-avatar-wrap">
              <img class="detail-hero-avatar" src="${escapeHtml(artist.imageUrl || generateArtwork(artist.id || artist.name, artist.name))}" alt="" />
            </div>
            <div class="detail-hero-info">
              <span class="detail-type-badge">ARTISTA</span>
              <h1 class="detail-title">${escapeHtml(artist.name)}</h1>
              <p class="detail-meta">${artistTracks.length} canciones • ${artistAlbums.length} álbumes</p>
              ${artist.bio ? `<p class="detail-bio">${escapeHtml(artist.bio)}</p>` : ''}
            </div>
          </div>
          <div class="detail-action-buttons">
            <button class="btn btn--primary" data-action="play-tab-all">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Reproducir Artista
            </button>
          </div>
        </div>

        ${artistAlbums.length > 0 ? `
          <div class="detail-section">
            <h3 class="detail-section-title">Álbumes</h3>
            <div class="lib-albums-grid">
              ${artistAlbums.map(alb => `
                <div class="lib-album-card" data-action="open-album" data-album-id="${escapeHtml(alb.id || alb.title)}">
                  <div class="lib-album-art-wrap">
                    <img class="lib-album-art" src="${escapeHtml(alb.artworkUrl || generateArtwork(alb.id || alb.title, alb.title))}" alt="" loading="lazy" />
                  </div>
                  <div class="lib-album-title">${escapeHtml(alb.title)}</div>
                  <div class="lib-album-meta">${alb.year ? alb.year : ''}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="detail-section">
          <h3 class="detail-section-title">Canciones</h3>
          <div class="lib-tracks-container detail-tracks-container">
            ${artistTracks.map((t, idx) => renderTrackRow(t, idx, 'artist-detail')).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderContextMenuContent(track) {
    if (!track) return '';
    const isDl = !!track.isDownloaded || (Sonora.Download && typeof Sonora.Download.isDownloaded === 'function' && Sonora.Download.isDownloaded(track.id));
    const isFav = !!track.isFavorite;

    return `
      <div class="sheet-backdrop" data-action="close-sheet"></div>
      <div class="sheet-panel">
        <div class="sheet-drag-handle"></div>
        <div class="sheet-track-header">
          <div class="sheet-art-wrap">
            <img class="sheet-art" src="${escapeHtml(track.artworkUrl || generateArtwork(track.id, track.title))}" alt="" />
          </div>
          <div class="sheet-track-info">
            <div class="sheet-track-title">${escapeHtml(track.title)}</div>
            <div class="sheet-track-artist">${escapeHtml(track.artist || 'Artista desconocido')}</div>
            <div class="sheet-track-album">${escapeHtml(track.album || '')}</div>
          </div>
        </div>

        <div class="sheet-menu-list">
          <button class="sheet-menu-item" data-action="sheet-play-next">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            <span>Reproducir a continuación</span>
          </button>
          <button class="sheet-menu-item" data-action="sheet-add-playlist">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span>Añadir a playlist</span>
          </button>
          <button class="sheet-menu-item" data-action="sheet-toggle-fav">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="${isFav ? 'var(--primary, #FF4757)' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span>${isFav ? 'Eliminar de favoritos' : 'Añadir a favoritos'}</span>
          </button>
          <button class="sheet-menu-item" data-action="sheet-toggle-download">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>${isDl ? 'Eliminar descarga' : 'Descargar'}</span>
          </button>
          <button class="sheet-menu-item" data-action="sheet-go-artist">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Ir al artista (${escapeHtml(track.artist || 'Artista')})</span>
          </button>
          <button class="sheet-menu-item" data-action="sheet-go-album">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
            <span>Ir al álbum (${escapeHtml(track.album || 'Álbum')})</span>
          </button>
          <button class="sheet-menu-item" data-action="sheet-share">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            <span>Compartir</span>
          </button>
          <button class="sheet-menu-item sheet-cancel" data-action="close-sheet">
            <span>Cancelar</span>
          </button>
        </div>
      </div>
    `;
  }

  Sonora.Pages.Library = {
    render() {
      return `
        <div class="page page-library">
          <style>
            .page-library {
              padding-bottom: 96px;
              min-height: 100vh;
              color: var(--text-color, #ffffff);
              background: var(--bg-color, #121212);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              user-select: none;
              -webkit-user-select: none;
            }
            .library-header {
              padding: 24px 20px 12px;
              background: linear-gradient(180deg, rgba(255, 71, 87, 0.15) 0%, rgba(18, 18, 18, 0) 100%);
            }
            .library-title {
              font-size: 28px;
              font-weight: 800;
              margin: 0 0 16px;
              color: #ffffff;
              letter-spacing: -0.5px;
            }
            .library-tabs-nav {
              display: flex;
              gap: 8px;
              overflow-x: auto;
              padding-bottom: 8px;
              scrollbar-width: none;
              -webkit-overflow-scrolling: touch;
            }
            .library-tabs-nav::-webkit-scrollbar {
              display: none;
            }
            .library-tab-btn {
              flex: 0 0 auto;
              background: #1e1e28;
              border: 1px solid rgba(255, 255, 255, 0.08);
              color: #8e8e93;
              font-size: 14px;
              font-weight: 600;
              padding: 8px 16px;
              border-radius: 20px;
              cursor: pointer;
              transition: all 0.2s ease;
            }
            .library-tab-btn.active {
              background: var(--primary, #FF4757);
              color: #ffffff;
              border-color: var(--primary, #FF4757);
              box-shadow: 0 4px 12px rgba(255, 71, 87, 0.35);
            }
            .library-sort-bar {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 12px 20px;
              border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            }
            .sort-label {
              font-size: 13px;
              color: #8e8e93;
              font-weight: 600;
            }
            .sort-chips {
              display: flex;
              gap: 8px;
            }
            .sort-chip {
              background: transparent;
              border: 1px solid rgba(255, 255, 255, 0.15);
              color: #8e8e93;
              font-size: 12px;
              font-weight: 600;
              padding: 4px 10px;
              border-radius: 14px;
              cursor: pointer;
            }
            .sort-chip.active {
              background: rgba(255, 71, 87, 0.2);
              border-color: var(--primary, #FF4757);
              color: var(--primary, #FF4757);
            }
            .tab-header-action {
              padding: 16px 20px 0;
            }
            .play-all-btn {
              width: 100%;
              justify-content: center;
            }
            /* Track Item */
            .lib-tracks-container {
              padding: 8px 16px;
              display: flex;
              flex-direction: column;
              gap: 6px;
            }
            .lib-track-item {
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 8px 10px;
              border-radius: 10px;
              background: #181822;
              cursor: pointer;
              transition: background 0.15s ease;
            }
            .lib-track-item:active {
              background: #232332;
            }
            .lib-track-art-wrap {
              width: 48px;
              height: 48px;
              border-radius: 8px;
              overflow: hidden;
              position: relative;
              flex-shrink: 0;
              background: #252535;
            }
            .lib-track-art {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .lib-track-play-badge {
              position: absolute;
              inset: 0;
              background: rgba(0,0,0,0.4);
              display: flex;
              align-items: center;
              justify-content: center;
              color: #fff;
              font-size: 12px;
              opacity: 0;
              transition: opacity 0.15s ease;
            }
            .lib-track-item:hover .lib-track-play-badge {
              opacity: 1;
            }
            .lib-track-info {
              flex: 1;
              min-width: 0;
            }
            .lib-track-title {
              font-size: 15px;
              font-weight: 600;
              color: #ffffff;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .lib-track-meta {
              font-size: 12px;
              color: #8e8e93;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-top: 3px;
              display: flex;
              align-items: center;
              gap: 6px;
            }
            .download-badge {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: #2ed573;
              color: #121212;
              font-size: 10px;
              font-weight: 800;
              line-height: 1;
            }
            .lib-track-actions {
              display: flex;
              align-items: center;
              gap: 8px;
              flex-shrink: 0;
            }
            .lib-track-duration {
              font-size: 12px;
              color: #8e8e93;
            }
            .btn-icon {
              background: none;
              border: none;
              color: #8e8e93;
              cursor: pointer;
              padding: 6px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 50%;
              transition: color 0.15s ease, transform 0.1s ease;
            }
            .btn-icon:active {
              transform: scale(0.85);
            }
            .btn-fav.is-fav {
              color: var(--primary, #FF4757);
            }
            /* Albums Grid */
            .lib-albums-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              padding: 16px 20px;
            }
            .lib-album-card {
              cursor: pointer;
              transition: transform 0.15s ease;
            }
            .lib-album-card:active {
              transform: scale(0.96);
            }
            .lib-album-art-wrap {
              width: 100%;
              aspect-ratio: 1;
              border-radius: 12px;
              overflow: hidden;
              background: #1f1f2c;
              box-shadow: 0 4px 14px rgba(0,0,0,0.35);
            }
            .lib-album-art {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .lib-album-title {
              font-size: 14px;
              font-weight: 700;
              color: #ffffff;
              margin-top: 8px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .lib-album-artist {
              font-size: 12px;
              color: #8e8e93;
              margin-top: 2px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .lib-album-meta {
              font-size: 11px;
              color: #636366;
              margin-top: 2px;
            }
            /* Artists List */
            .lib-artists-list {
              padding: 12px 20px;
              display: flex;
              flex-direction: column;
              gap: 10px;
            }
            .lib-artist-item {
              display: flex;
              align-items: center;
              gap: 16px;
              padding: 10px 12px;
              border-radius: 12px;
              background: #181822;
              cursor: pointer;
              transition: background 0.15s ease;
            }
            .lib-artist-item:active {
              background: #232332;
            }
            .lib-artist-avatar-wrap {
              width: 56px;
              height: 56px;
              border-radius: 50%;
              overflow: hidden;
              background: #252535;
              flex-shrink: 0;
              box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            }
            .lib-artist-avatar {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .lib-artist-info {
              flex: 1;
              min-width: 0;
            }
            .lib-artist-name {
              font-size: 16px;
              font-weight: 700;
              color: #ffffff;
            }
            .lib-artist-meta {
              font-size: 13px;
              color: #8e8e93;
              margin-top: 3px;
            }
            .lib-artist-arrow {
              color: #636366;
            }
            /* Detail View */
            .lib-detail-view {
              animation: fadeIn 0.2s ease;
            }
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(6px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .detail-header {
              padding: 20px 20px 16px;
              background: linear-gradient(180deg, rgba(255, 71, 87, 0.2) 0%, rgba(18, 18, 18, 0) 100%);
            }
            .btn-back {
              background: rgba(255, 255, 255, 0.1);
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
            .detail-hero {
              display: flex;
              gap: 16px;
              align-items: center;
              margin-bottom: 16px;
            }
            .detail-hero-art-wrap {
              width: 110px;
              height: 110px;
              border-radius: 12px;
              overflow: hidden;
              flex-shrink: 0;
              box-shadow: 0 8px 24px rgba(0,0,0,0.5);
              background: #252535;
            }
            .detail-hero-art {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .detail-hero-avatar-wrap {
              width: 100px;
              height: 100px;
              border-radius: 50%;
              overflow: hidden;
              flex-shrink: 0;
              box-shadow: 0 8px 24px rgba(0,0,0,0.5);
              background: #252535;
            }
            .detail-hero-avatar {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .detail-hero-info {
              flex: 1;
              min-width: 0;
            }
            .detail-type-badge {
              font-size: 11px;
              font-weight: 700;
              color: var(--primary, #FF4757);
              letter-spacing: 0.5px;
            }
            .detail-title {
              font-size: 22px;
              font-weight: 800;
              margin: 4px 0 2px;
              color: #ffffff;
              line-height: 1.2;
            }
            .detail-subtitle {
              font-size: 14px;
              color: #ffffff;
              margin: 0 0 4px;
              font-weight: 500;
            }
            .detail-meta {
              font-size: 12px;
              color: #8e8e93;
              margin: 0;
            }
            .detail-bio {
              font-size: 12px;
              color: #a0a0a8;
              margin: 6px 0 0;
              line-height: 1.3;
            }
            .detail-action-buttons {
              display: flex;
              gap: 12px;
            }
            .detail-section {
              padding: 8px 0;
            }
            .detail-section-title {
              font-size: 17px;
              font-weight: 700;
              color: #ffffff;
              padding: 0 20px 8px;
              margin: 8px 0 0;
            }
            /* Empty State */
            .lib-empty-state {
              padding: 60px 24px;
              text-align: center;
            }
            .lib-empty-state .empty-icon {
              font-size: 50px;
              margin-bottom: 12px;
            }
            .lib-empty-state h3 {
              font-size: 19px;
              font-weight: 700;
              margin: 0 0 8px;
              color: #ffffff;
            }
            .lib-empty-state p {
              font-size: 14px;
              color: #8e8e93;
              margin: 0;
            }
            /* Bottom Sheet Overlay */
            .context-sheet-overlay {
              position: fixed;
              inset: 0;
              z-index: 9999;
              display: none;
            }
            .context-sheet-overlay.visible {
              display: block;
            }
            .sheet-backdrop {
              position: absolute;
              inset: 0;
              background: rgba(0, 0, 0, 0.7);
              backdrop-filter: blur(4px);
              -webkit-backdrop-filter: blur(4px);
              animation: sheetFade 0.2s ease;
            }
            .sheet-panel {
              position: absolute;
              bottom: 0;
              left: 0;
              right: 0;
              background: #1c1c28;
              border-radius: 20px 20px 0 0;
              padding: 12px 20px 32px;
              max-height: 85vh;
              overflow-y: auto;
              box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.6);
              animation: sheetSlide 0.25s cubic-bezier(0.1, 0.9, 0.2, 1);
            }
            @keyframes sheetFade {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes sheetSlide {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
            .sheet-drag-handle {
              width: 36px;
              height: 4px;
              background: rgba(255, 255, 255, 0.3);
              border-radius: 2px;
              margin: 4px auto 16px;
            }
            .sheet-track-header {
              display: flex;
              align-items: center;
              gap: 14px;
              padding-bottom: 16px;
              border-bottom: 1px solid rgba(255, 255, 255, 0.1);
              margin-bottom: 8px;
            }
            .sheet-art-wrap {
              width: 52px;
              height: 52px;
              border-radius: 10px;
              overflow: hidden;
              background: #252535;
              flex-shrink: 0;
            }
            .sheet-art {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .sheet-track-info {
              flex: 1;
              min-width: 0;
            }
            .sheet-track-title {
              font-size: 16px;
              font-weight: 700;
              color: #ffffff;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .sheet-track-artist {
              font-size: 13px;
              color: #8e8e93;
              margin-top: 2px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .sheet-track-album {
              font-size: 12px;
              color: #636366;
              margin-top: 1px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .sheet-menu-list {
              display: flex;
              flex-direction: column;
              gap: 2px;
            }
            .sheet-menu-item {
              display: flex;
              align-items: center;
              gap: 14px;
              width: 100%;
              background: none;
              border: none;
              padding: 13px 8px;
              color: #e0e0e0;
              font-size: 15px;
              font-weight: 500;
              cursor: pointer;
              border-radius: 10px;
              text-align: left;
              transition: background 0.15s ease;
            }
            .sheet-menu-item:active {
              background: rgba(255, 255, 255, 0.08);
            }
            .sheet-menu-item svg {
              color: #8e8e93;
              flex-shrink: 0;
            }
            .sheet-menu-item.sheet-cancel {
              color: #8e8e93;
              justify-content: center;
              margin-top: 8px;
              font-weight: 600;
            }
            /* Toast */
            .library-toast {
              position: fixed;
              bottom: 84px;
              left: 50%;
              transform: translateX(-50%) translateY(20px);
              background: rgba(30, 30, 40, 0.95);
              color: #ffffff;
              border: 1px solid rgba(255, 255, 255, 0.15);
              backdrop-filter: blur(8px);
              padding: 10px 20px;
              border-radius: 20px;
              font-size: 13px;
              font-weight: 600;
              box-shadow: 0 4px 16px rgba(0,0,0,0.5);
              z-index: 10000;
              opacity: 0;
              pointer-events: none;
              transition: opacity 0.2s ease, transform 0.2s ease;
            }
            .library-toast.visible {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
          </style>

          <div class="library-header">
            <h1 class="library-title">Tu Biblioteca</h1>
            <div id="library-tabs-container">
              ${renderTabsBar()}
            </div>
          </div>

          <!-- Tab Body Content -->
          <div id="library-tab-content">
            <div class="lib-loading-skeleton" style="padding: 20px; text-align: center; color: #8e8e93;">
              Cargando biblioteca...
            </div>
          </div>

          <!-- Bottom Sheet Overlay -->
          <div id="library-bottom-sheet" class="context-sheet-overlay" role="dialog" aria-modal="true"></div>
        </div>
      `;
    },

    async init() {
      rootElement = $('.page-library');
      if (!rootElement) return;

      const tabsContainer = $('#library-tabs-container', rootElement);
      const tabContent = $('#library-tab-content', rootElement);
      const bottomSheet = $('#library-bottom-sheet', rootElement);

      // Check router parameters, Store state, or hash query for tab / artist / album deep link
      try {
        let tabParam = null;
        let sortParam = null;
        let artistParam = null;
        let albumParam = null;

        if (Sonora.Store && typeof Sonora.Store.get === 'function') {
          tabParam = Sonora.Store.get('library_active_tab') || tabParam;
          sortParam = Sonora.Store.get('library_sort') || sortParam;
          artistParam = Sonora.Store.get('library_selected_artist') || artistParam;
          albumParam = Sonora.Store.get('library_selected_album') || albumParam;
          if (Sonora.Store.set) {
            Sonora.Store.set('library_active_tab', null);
            Sonora.Store.set('library_sort', null);
            Sonora.Store.set('library_selected_artist', null);
            Sonora.Store.set('library_selected_album', null);
          }
        }

        if (Sonora.Router && typeof Sonora.Router.getParam === 'function') {
          tabParam = Sonora.Router.getParam('tab') || tabParam;
          sortParam = Sonora.Router.getParam('sort') || sortParam;
          artistParam = Sonora.Router.getParam('artistId') || artistParam;
          albumParam = Sonora.Router.getParam('albumId') || albumParam;
        }

        // Also check hash string regex (e.g. #/library?tab=artistas)
        const hash = window.location.hash || '';
        const matchTab = hash.match(/[?&]tab=([^&]+)/);
        if (matchTab) tabParam = decodeURIComponent(matchTab[1]);
        const matchSort = hash.match(/[?&]sort=([^&]+)/);
        if (matchSort) sortParam = decodeURIComponent(matchSort[1]);
        const matchArtist = hash.match(/[?&]artistId=([^&]+)/);
        if (matchArtist) artistParam = decodeURIComponent(matchArtist[1]);
        const matchAlbum = hash.match(/[?&]albumId=([^&]+)/);
        if (matchAlbum) albumParam = decodeURIComponent(matchAlbum[1]);

        if (tabParam && TABS.some(t => t.id === tabParam)) {
          activeTab = tabParam;
        }
        if (sortParam) {
          currentSort = sortParam;
        }

        // Load all library data
        await loadLibraryData();

        if (artistParam) {
          const foundArt = allArtists.find(a => String(a.id) === String(artistParam) || a.name === artistParam);
          if (foundArt) {
            activeTab = 'artistas';
            detailViewType = 'artist';
            detailViewData = foundArt;
          }
        } else if (albumParam) {
          const foundAlb = allAlbums.find(a => String(a.id) === String(albumParam) || a.title === albumParam);
          if (foundAlb) {
            activeTab = 'albumes';
            detailViewType = 'album';
            detailViewData = foundAlb;
          }
        }
      } catch (e) {
        console.warn('[Library] Deep link parse error:', e);
        await loadLibraryData();
      }

      // Render tab bar and content
      if (tabsContainer) tabsContainer.innerHTML = renderTabsBar();
      renderCurrentView();

      // Delegated click handler on page-library
      rootElement.addEventListener('click', async (e) => {
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

          // 1. Tab Navigation
          const tabBtn = target.closest('.library-tab-btn');
          if (tabBtn) {
            const newTab = tabBtn.getAttribute('data-tab');
            if (newTab && newTab !== activeTab) {
              activeTab = newTab;
              detailViewType = null;
              detailViewData = null;
              if (tabsContainer) tabsContainer.innerHTML = renderTabsBar();
              renderCurrentView();
            }
            return;
          }

          // 1b. Escanear dispositivo
          const scanBtn = target.closest('[data-action="scan-device"]');
          if (scanBtn) {
            loadDeviceTracks();
            return;
          }

          // 1c. Pedir permiso de audio
          const permBtn = target.closest('[data-action="request-storage"]');
          if (permBtn) {
            if (window.SonoraNative && typeof window.SonoraNative.requestStoragePermission === 'function') {
              window.SonoraNative.requestStoragePermission();
            }
            return;
          }

          // 2. Sort Chip
          const sortChip = target.closest('.sort-chip');
          if (sortChip) {
            const sortType = sortChip.getAttribute('data-sort');
            if (sortType && sortType !== currentSort) {
              currentSort = sortType;
              renderCurrentView();
            }
            return;
          }

          // 3. Close Detail View (Back button)
          const backBtn = target.closest('[data-action="close-detail-view"]');
          if (backBtn) {
            detailViewType = null;
            detailViewData = null;
            renderCurrentView();
            return;
          }

          // 4. Open Album Detail
          const albumCard = target.closest('[data-action="open-album"]');
          if (albumCard) {
            const albumId = albumCard.getAttribute('data-album-id');
            const found = allAlbums.find(a => String(a.id) === String(albumId) || a.title === albumId);
            if (found) {
              detailViewType = 'album';
              detailViewData = found;
              renderCurrentView();
            }
            return;
          }

          // 5. Open Artist Detail
          const artistItem = target.closest('[data-action="open-artist"]');
          if (artistItem) {
            const artistId = artistItem.getAttribute('data-artist-id');
            const found = allArtists.find(a => String(a.id) === String(artistId) || a.name === artistId);
            if (found) {
              detailViewType = 'artist';
              detailViewData = found;
              renderCurrentView();
            }
            return;
          }

          // 6. Play Track Row
          const trackItem = target.closest('[data-action="play-track"]');
          if (trackItem && !target.closest('.btn-icon')) {
            const idx = parseInt(trackItem.getAttribute('data-idx'), 10) || 0;
            const queue = currentTabTracks.length > 0 ? currentTabTracks : allTracks;
            if (Sonora.Player && queue.length > idx) {
              if (typeof Sonora.Player.setQueue === 'function') {
                Sonora.Player.setQueue(queue, idx);
              } else if (typeof Sonora.Player.play === 'function') {
                Sonora.Player.play(queue[idx]);
              }
            }
            return;
          }

          // 7. Play Tab All (e.g. Play all favorites or album)
          const playAllBtn = target.closest('[data-action="play-tab-all"]');
          if (playAllBtn) {
            const queue = currentTabTracks.length > 0 ? currentTabTracks : allTracks;
            if (Sonora.Player && queue.length > 0) {
              if (typeof Sonora.Player.setQueue === 'function') {
                Sonora.Player.setQueue(queue, 0);
              } else if (typeof Sonora.Player.play === 'function') {
                Sonora.Player.play(queue[0]);
              }
            }
            return;
          }

          // 8. Toggle Favorite (Heart button)
          const favBtn = target.closest('[data-action="toggle-fav"]');
          if (favBtn) {
            e.stopPropagation();
            const trackId = favBtn.getAttribute('data-track-id');
            await toggleTrackFavorite(trackId);
            return;
          }

          // 9. Open Track Context Menu (3-dot button)
          const menuBtn = target.closest('[data-action="open-track-menu"]');
          if (menuBtn) {
            e.stopPropagation();
            const trackId = menuBtn.getAttribute('data-track-id');
            const track = allTracks.find(t => String(t.id) === String(trackId));
            if (track && bottomSheet) {
              activeTrackForMenu = track;
              bottomSheet.innerHTML = renderContextMenuContent(track);
              bottomSheet.classList.add('visible');
            }
            return;
          }

          // 10. Close Context Sheet
          const closeSheetBtn = target.closest('[data-action="close-sheet"]');
          if (closeSheetBtn) {
            closeContextMenu();
            return;
          }

          // 11. Context Menu Action: Play Next
          const playNextBtn = target.closest('[data-action="sheet-play-next"]');
          if (playNextBtn && activeTrackForMenu) {
            if (Sonora.Player && typeof Sonora.Player.addToQueue === 'function') {
              Sonora.Player.addToQueue(activeTrackForMenu);
            }
            showToast('Añadida a la cola de reproducción');
            closeContextMenu();
            return;
          }

          // 12. Context Menu Action: Add to Playlist
          const addPlaylistBtn = target.closest('[data-action="sheet-add-playlist"]');
          if (addPlaylistBtn && activeTrackForMenu) {
            await handleAddToPlaylist(activeTrackForMenu);
            closeContextMenu();
            return;
          }

          // 13. Context Menu Action: Toggle Favorite
          const sheetFavBtn = target.closest('[data-action="sheet-toggle-fav"]');
          if (sheetFavBtn && activeTrackForMenu) {
            await toggleTrackFavorite(activeTrackForMenu.id);
            closeContextMenu();
            return;
          }

          // 14. Context Menu Action: Toggle Download
          const sheetDlBtn = target.closest('[data-action="sheet-toggle-download"]');
          if (sheetDlBtn && activeTrackForMenu) {
            await handleToggleDownload(activeTrackForMenu);
            closeContextMenu();
            return;
          }

          // 15. Context Menu Action: Go to Artist
          const goArtistBtn = target.closest('[data-action="sheet-go-artist"]');
          if (goArtistBtn && activeTrackForMenu) {
            const artName = activeTrackForMenu.artist;
            const foundArt = allArtists.find(a => (a.name && a.name.toLowerCase() === (artName || '').toLowerCase()) || String(a.id) === String(activeTrackForMenu.artistId));
            closeContextMenu();
            if (foundArt) {
              activeTab = 'artistas';
              detailViewType = 'artist';
              detailViewData = foundArt;
              if (tabsContainer) tabsContainer.innerHTML = renderTabsBar();
              renderCurrentView();
            }
            return;
          }

          // 16. Context Menu Action: Go to Album
          const goAlbumBtn = target.closest('[data-action="sheet-go-album"]');
          if (goAlbumBtn && activeTrackForMenu) {
            const albName = activeTrackForMenu.album;
            const foundAlb = allAlbums.find(a => (a.title && a.title.toLowerCase() === (albName || '').toLowerCase()) || String(a.id) === String(activeTrackForMenu.albumId));
            closeContextMenu();
            if (foundAlb) {
              activeTab = 'albumes';
              detailViewType = 'album';
              detailViewData = foundAlb;
              if (tabsContainer) tabsContainer.innerHTML = renderTabsBar();
              renderCurrentView();
            }
            return;
          }

          // 17. Context Menu Action: Share
          const shareBtn = target.closest('[data-action="sheet-share"]');
          if (shareBtn && activeTrackForMenu) {
            handleShareTrack(activeTrackForMenu);
            closeContextMenu();
            return;
          }
        } catch (err) {
          console.error('[Library] Click error:', err);
        }
      });
    },

    destroy() {
      try {
        closeContextMenu();
        rootElement = null;
        activeTrackForMenu = null;
        detailViewType = null;
        detailViewData = null;
        allTracks = [];
        allAlbums = [];
        allArtists = [];
        currentTabTracks = [];
      } catch (e) {
        console.warn('[Library] Destroy error:', e);
      }
    }
  };

  // Load all items from DB
  async function loadLibraryData() {
    try {
      if (!Sonora.DB) return;

      // Tracks
      if (Sonora.DB.tracks && typeof Sonora.DB.tracks.getAll === 'function') {
        allTracks = (await Sonora.DB.tracks.getAll()) || [];
      }

      // Albums
      if (Sonora.DB.albums && typeof Sonora.DB.albums.getAll === 'function') {
        allAlbums = (await Sonora.DB.albums.getAll()) || [];
      }
      if (allAlbums.length === 0 && allTracks.length > 0) {
        const albumMap = new Map();
        allTracks.forEach(t => {
          if (t.album && !albumMap.has(t.album)) {
            albumMap.set(t.album, {
              id: t.albumId || t.album,
              title: t.album,
              artist: t.artist,
              artworkUrl: t.artworkUrl,
              year: t.year,
              trackCount: 1
            });
          } else if (t.album && albumMap.has(t.album)) {
            albumMap.get(t.album).trackCount++;
          }
        });
        allAlbums = Array.from(albumMap.values());
      }

      // Artists
      if (Sonora.DB.artists && typeof Sonora.DB.artists.getAll === 'function') {
        allArtists = (await Sonora.DB.artists.getAll()) || [];
      }
      if (allArtists.length === 0 && allTracks.length > 0) {
        const artistMap = new Map();
        allTracks.forEach(t => {
          if (t.artist && !artistMap.has(t.artist)) {
            artistMap.set(t.artist, {
              id: t.artistId || t.artist,
              name: t.artist,
              imageUrl: t.artworkUrl,
              trackCount: 1,
              albumCount: 1
            });
          } else if (t.artist && artistMap.has(t.artist)) {
            artistMap.get(t.artist).trackCount++;
          }
        });
        allArtists = Array.from(artistMap.values());
      }
    } catch (e) {
      console.error('[Library] Data load error:', e);
    }
  }

  function renderCurrentView() {
    const tabContent = $('#library-tab-content', rootElement);
    if (!tabContent) return;

    if (detailViewType === 'album' && detailViewData) {
      tabContent.innerHTML = renderAlbumDetail(detailViewData, allTracks);
      return;
    }

    if (detailViewType === 'artist' && detailViewData) {
      tabContent.innerHTML = renderArtistDetail(detailViewData, allTracks, allAlbums);
      return;
    }

    switch (activeTab) {
      case 'canciones':
        tabContent.innerHTML = renderCancionesTab(allTracks);
        break;
      case 'albumes':
        tabContent.innerHTML = renderAlbumesTab(allAlbums);
        break;
      case 'artistas':
        tabContent.innerHTML = renderArtistasTab(allArtists);
        break;
      case 'favoritos':
        tabContent.innerHTML = renderFavoritosTab(allTracks);
        break;
      case 'descargados':
        tabContent.innerHTML = renderDescargadosTab(allTracks);
        break;
      case 'dispositivo':
        tabContent.innerHTML = renderDispositivoTab();
        if (deviceBridgeAvailable() && !deviceLoadedOnce && !deviceLoading) {
          loadDeviceTracks();
        }
        break;
      default:
        tabContent.innerHTML = renderCancionesTab(allTracks);
    }
  }

  function closeContextMenu() {
    const bottomSheet = $('#library-bottom-sheet', rootElement);
    if (bottomSheet) {
      bottomSheet.classList.remove('visible');
      bottomSheet.innerHTML = '';
    }
    activeTrackForMenu = null;
  }

  async function toggleTrackFavorite(trackId) {
    const track = allTracks.find(t => String(t.id) === String(trackId));
    if (!track) return;

    track.isFavorite = !track.isFavorite;

    try {
      if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.update === 'function') {
        await Sonora.DB.tracks.update(track);
      }
      if (Sonora.Store && typeof Sonora.Store.emit === 'function') {
        Sonora.Store.emit('track:favorite', { trackId: track.id, isFavorite: track.isFavorite });
      }
      showToast(track.isFavorite ? 'Añadida a favoritos' : 'Eliminada de favoritos');
    } catch (e) {
      console.warn('[Library] Failed to persist favorite:', e);
    }

    renderCurrentView();
  }

  async function handleToggleDownload(track) {
    try {
      if (Sonora.Download) {
        if (typeof Sonora.Download.isDownloaded === 'function' && Sonora.Download.isDownloaded(track.id)) {
          // Remove download if API supports it
          if (Sonora.DB && Sonora.DB.downloads && typeof Sonora.DB.downloads.delete === 'function') {
            await Sonora.DB.downloads.delete(track.id);
          }
          track.isDownloaded = false;
          showToast('Descarga eliminada');
        } else if (typeof Sonora.Download.downloadTrack === 'function') {
          showToast('Descargando...');
          await Sonora.Download.downloadTrack(track);
          track.isDownloaded = true;
          showToast('Canción descargada con éxito');
        }
      } else {
        track.isDownloaded = !track.isDownloaded;
        showToast(track.isDownloaded ? 'Descargada' : 'Descarga eliminada');
      }
    } catch (e) {
      console.warn('[Library] Download toggle error:', e);
      showToast('Error al procesar la descarga');
    }
    renderCurrentView();
  }

  async function handleAddToPlaylist(track) {
    let playlists = [];
    try {
      if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.getAll === 'function') {
        playlists = (await Sonora.DB.playlists.getAll()) || [];
      }
    } catch (e) {}

    const playlistName = prompt(
      playlists.length > 0
        ? `Añadir a playlist existente (${playlists.map(p => p.name).join(', ')}) o escribe un nombre nuevo:`
        : 'Nombre de la nueva playlist:'
    );

    if (!playlistName || !playlistName.trim()) return;

    try {
      const cleanName = playlistName.trim();
      let targetPl = playlists.find(p => p.name.toLowerCase() === cleanName.toLowerCase());

      if (!targetPl) {
        // Create new playlist
        const newPl = {
          name: cleanName,
          description: 'Creada desde tu biblioteca',
          trackIds: [track.id],
          createdAt: new Date().toISOString()
        };
        if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.create === 'function') {
          targetPl = await Sonora.DB.playlists.create(newPl);
        }
      } else {
        // Add to existing playlist
        if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.addTrack === 'function') {
          await Sonora.DB.playlists.addTrack(targetPl.id, track.id);
        } else {
          targetPl.trackIds = targetPl.trackIds || [];
          if (!targetPl.trackIds.includes(track.id)) {
            targetPl.trackIds.push(track.id);
            if (Sonora.DB.playlists.update) await Sonora.DB.playlists.update(targetPl);
          }
        }
      }
      showToast(`Añadida a playlist "${cleanName}"`);
    } catch (e) {
      console.error('[Library] Add to playlist error:', e);
      showToast('No se pudo añadir a la playlist');
    }
  }

  function handleShareTrack(track) {
    const shareData = {
      title: track.title,
      text: `Escucha "${track.title}" de ${track.artist || 'Sonora Music'}`,
      url: window.location.href
    };

    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(`${shareData.text} - ${shareData.url}`);
      showToast('Enlace copiado al portapapeles');
    } else {
      showToast('Información de canción lista para compartir');
    }
  }

})();
