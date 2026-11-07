/**
 * Sonora Music — Main Application Controller
 * Ties everything together: routing, pages, player UI, initialization
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  /* ── Helpers ── */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return [].slice.call((ctx || document).querySelectorAll(sel)); }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function generateArtwork(id, title) {
    // Los ids pueden ser texto ("yt_...", "device_..."): antes "id * 47" daba
    // NaN, el color hsl era inválido y la carátula salía NEGRA.
    var _seed = String(id == null ? '' : id);
    var _hash = 0;
    for (var _i = 0; _i < _seed.length; _i++) { _hash = (_hash * 31 + _seed.charCodeAt(_i)) % 100000; }
    var hue = (_hash * 47) % 360;
    var label = title ? title.substring(0, 12) : '♪';
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="hsl(' + hue + ',70%,50%)"/>' +
      '<stop offset="100%" stop-color="hsl(' + ((hue + 60) % 360) + ',70%,40%)"/>' +
      '</linearGradient></defs>' +
      '<rect fill="url(#g)" width="200" height="200" rx="16"/>' +
      '<text x="100" y="105" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif" font-weight="600">' + label + '</text>' +
      '</svg>'
    );
  }

  /* ── Page lifecycle ── */
  var _currentPage = null;
  var _currentPageName = '';

  var PAGES = {
    home: function () { return Sonora.Pages && Sonora.Pages.Home; },
    search: function () { return Sonora.Pages && Sonora.Pages.Search; },
    library: function () { return Sonora.Pages && Sonora.Pages.Library; },
    playlists: function () { return Sonora.Pages && (Sonora.Pages.Playlists || Sonora.Pages.Playlist); },
    discover: function () { return Sonora.Pages && Sonora.Pages.Discover; },
    profile: function () { return Sonora.Pages && Sonora.Pages.Profile; },
    settings: function () { return Sonora.Pages && Sonora.Pages.Settings; }
  };

  function loadPage(pageName, params) {
    try {
      var mainContent = $('#main-content');
      if (!mainContent) return;

      var pageGetter = PAGES[pageName];
      if (!pageGetter) {
        pageName = 'home';
        pageGetter = PAGES.home;
      }

      var page = pageGetter();
      if (!page) {
        console.warn('[App] Page module not found:', pageName);
        mainContent.innerHTML = '<div class="page empty-state"><h2>Página no disponible</h2></div>';
        return;
      }

      // Destroy previous page
      if (_currentPage && _currentPage.destroy) {
        try { _currentPage.destroy(); } catch (e) { console.warn('[App] Page destroy error:', e); }
      }

      // Render new page
      var html = '';
      try {
        html = page.render ? page.render(params) : '<div class="page">Cargando...</div>';
      } catch (e) {
        console.error('[App] Page render error:', e);
        html = '<div class="page empty-state"><h2>Error al cargar</h2><p>' + e.message + '</p></div>';
      }

      mainContent.innerHTML = html;
      mainContent.scrollTop = 0;

      // Animate in
      var pageEl = mainContent.firstElementChild;
      if (pageEl) {
        pageEl.classList.add('page-enter');
        requestAnimationFrame(function () {
          pageEl.classList.add('page-enter-active');
        });
      }

      // Init new page
      _currentPage = page;
      _currentPageName = pageName;
      if (page.init) {
        try { page.init(params); } catch (e) { console.error('[App] Page init error:', e); }
      }

      // Update store
      Sonora.Store.set('currentPage', pageName);

      // Update nav
      updateNav(pageName);

      // Update header
      updateHeader(pageName);

    } catch (e) {
      console.error('[App] loadPage error:', e);
    }
  }

  function updateNav(pageName) {
    $$('#bottom-nav .nav-item').forEach(function (btn) {
      var p = btn.getAttribute('data-page');
      btn.classList.toggle('active', p === pageName);
    });
  }

  function updateHeader(pageName) {
    var backBtn = $('#header-back');
    var title = $('#header-title');
    var titles = {
      home: 'Sonora Music',
      search: 'Buscar',
      library: 'Biblioteca',
      playlists: 'Mis Listas',
      discover: 'Descubrir',
      profile: 'Perfil',
      settings: 'Ajustes'
    };

    if (title) {
      var isHome = pageName === 'home';
      title.innerHTML = isHome
        ? '<svg class="header-logo" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="var(--color-primary)" opacity="0.2"/><path d="M9 18c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3-1.3 3-3 3zm9-12v12c0 .6-.4 1-1 1s-1-.4-1-1V8l-7 2V7l9-3v2z" fill="var(--color-primary)"/></svg> Sonora Music'
        : (titles[pageName] || 'Sonora Music');
    }

    if (backBtn) {
      var showBack = pageName === 'profile' || pageName === 'settings';
      backBtn.classList.toggle('hidden', !showBack);
    }
  }

  /* ── Mini Player UI updates ── */
  function updateMiniPlayer() {
    var track = Sonora.Player.getCurrentTrack();
    var miniPlayer = $('#mini-player');
    if (!miniPlayer) return;

    if (!track) {
      miniPlayer.classList.add('hidden');
      return;
    }

    miniPlayer.classList.remove('hidden');
    Sonora.Store.set('miniPlayerVisible', true);

    var art = $('#mini-artwork');
    var titleEl = $('#mini-title');
    var artistEl = $('#mini-artist');
    var playIcon = $('#mini-play-icon');

    if (art) art.src = track.artworkUrl || generateArtwork(track.id, track.title);
    if (titleEl) titleEl.textContent = track.title || '—';
    if (artistEl) artistEl.textContent = track.artist || '—';

    var isPlaying = Sonora.Player.isPlaying();
    if (playIcon) {
      playIcon.setAttribute('d', isPlaying
        ? 'M6 4h4v16H6zM14 4h4v16h-4z'   // pause
        : 'M8 5v14l11-7z'                  // play
      );
    }
  }

  function updateMiniProgress() {
    var prog = Sonora.Player.getProgress();
    var fill = $('#mini-progress-fill');
    if (fill && prog) {
      fill.style.width = (prog.percent * 100) + '%';
    }
  }

  /* ── Full Player UI updates ── */
  function updateFullPlayer() {
    var track = Sonora.Player.getCurrentTrack();
    if (!track) return;

    var artImg = $('#player-artwork-img');
    var titleEl = $('#player-title');
    var artistEl = $('#player-artist');
    var playIcon = $('#player-play-icon');
    var sourceEl = $('#player-source');
    var bgBlur = $('#player-bg-blur');

    if (artImg) artImg.src = track.artworkUrl || generateArtwork(track.id, track.title);
    if (titleEl) titleEl.textContent = track.title || '—';
    if (artistEl) artistEl.textContent = track.artist || '—';
    if (sourceEl) sourceEl.textContent = track.album || 'Sonora Music';

    var isPlaying = Sonora.Player.isPlaying();
    if (playIcon) {
      playIcon.setAttribute('d', isPlaying
        ? 'M6 4h4v16H6zM14 4h4v16h-4z'
        : 'M8 5v14l11-7z'
      );
    }

    // Update artwork wrapper for spinning animation
    var wrapper = $('#player-artwork-wrapper');
    if (wrapper) wrapper.classList.toggle('playing', isPlaying);

    // Background blur
    if (bgBlur) {
      var artUrl = track.artworkUrl || generateArtwork(track.id, track.title);
      bgBlur.style.backgroundImage = 'url("' + artUrl + '")';
    }

    // Shuffle button
    var shuffleBtn = $('#player-shuffle');
    if (shuffleBtn) shuffleBtn.classList.toggle('active', Sonora.Player.isShuffled());

    // Repeat button
    var repeatBtn = $('#player-repeat');
    var repeatBadge = $('#repeat-badge');
    var mode = Sonora.Player.getRepeatMode();
    if (repeatBtn) repeatBtn.classList.toggle('active', mode !== 'off');
    if (repeatBadge) {
      repeatBadge.classList.toggle('hidden', mode !== 'one');
    }

    // Dynamic color
    if (track.artworkUrl) {
      Sonora.Themes.applyArtworkColor(track.artworkUrl);
    }

    // Si el panel de letras está abierto, refresca cabecera y disco girando
    var lyrPanel = $('#lyrics-panel');
    if (lyrPanel && !lyrPanel.classList.contains('hidden')) {
      updateLyricsHeader(track);
      if (track.artworkUrl) {
        try { Sonora.Themes.applyArtworkColor(track.artworkUrl); } catch (e) {}
      }
    }
  }

  function updateFullProgress() {
    var prog = Sonora.Player.getProgress();
    if (!prog) return;

    var fill = $('#player-progress-fill');
    var thumb = $('#player-progress-thumb');
    var currentTime = $('#player-current-time');
    var duration = $('#player-duration');

    var pct = prog.percent * 100;
    if (fill) fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
    if (currentTime) currentTime.textContent = formatTime(prog.current);
    if (duration) duration.textContent = formatTime(prog.duration);
  }

  /* ── Full Player show/hide ── */
  function showFullPlayer() {
    var fp = $('#full-player');
    if (fp) {
      fp.classList.remove('hidden');
      fp.classList.add('player-visible');
      Sonora.Store.set('fullPlayerVisible', true);
      updateFullPlayer();
      updateFullProgress();

      // Start visualizer
      try {
        var canvas = $('#visualizer-canvas');
        if (canvas && Sonora.Visualizer) {
          Sonora.Visualizer.init(canvas);
          Sonora.Visualizer.start();
        }
      } catch (e) { console.warn('[App] Visualizer error:', e); }
    }
  }

  function hideFullPlayer() {
    var fp = $('#full-player');
    if (fp) {
      fp.classList.add('hidden');
      fp.classList.remove('player-visible');
      Sonora.Store.set('fullPlayerVisible', false);

      // Stop visualizer
      try {
        if (Sonora.Visualizer) Sonora.Visualizer.stop();
      } catch (e) {}
    }
  }

  /* ── Queue Panel (Reordering & Delete) ── */
  function showQueuePanel() {
    var panel = $('#queue-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    function renderQueue() {
      var queue = Sonora.Player.getQueue();
      var currentIdx = Sonora.Player.getQueueIndex();
      var listEl = $('#queue-list');
      if (!listEl) return;

      if (!queue || queue.length === 0) {
        listEl.innerHTML = '<div class="empty-state" style="padding: 40px 20px; text-align: center;"><p style="font-size: 32px; margin-bottom: 8px;">🎵</p><p style="color: var(--color-text-secondary);">La cola de reproducción está vacía</p></div>';
        return;
      }

      var html = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:0 4px;">' +
        '<span style="font-size:12px; font-weight:700; color: var(--color-text-secondary); text-transform:uppercase;">' + queue.length + ' canciones</span>' +
        '<button id="btn-clear-queue" type="button" style="background:none; border:none; color:var(--color-primary, #FF4757); font-size:12px; font-weight:600; cursor:pointer;">Vaciar cola</button>' +
        '</div>';

      html += queue.map(function (track, i) {
        var isCurrent = i === currentIdx;
        var canMoveUp = i > 0;
        var canMoveDown = i < queue.length - 1;
        return '<div class="track-item queue-item' + (isCurrent ? ' track-item--active' : '') + '" data-queue-idx="' + i + '" draggable="true" style="display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:10px; margin-bottom:6px; background: ' + (isCurrent ? 'rgba(var(--color-primary-rgb), 0.15)' : 'var(--color-card-bg)') + '; border: 1px solid ' + (isCurrent ? 'rgba(var(--color-primary-rgb), 0.3)' : 'transparent') + '; cursor:default; transition:all 0.15s ease;">' +
          '<span class="queue-drag-handle" title="Arrastrar para reordenar" style="font-size:14px; color:rgba(255,255,255,0.4); cursor:grab; padding:4px 2px; user-select:none;">⠿</span>' +
          '<span style="font-size:11px; font-weight:700; color: var(--color-text-secondary); width:16px; text-align:center;">' + (i + 1) + '</span>' +
          '<img class="track-item__artwork" src="' + (track.artworkUrl || generateArtwork(track.id, track.title)) + '" alt="" width="42" height="42" style="border-radius:6px; object-fit:cover; flex-shrink:0;">' +
          '<div class="track-item__info" style="flex:1; min-width:0; cursor:pointer;" data-action="play-queue-track">' +
            '<span class="track-item__title" style="display:block; font-size:13px; font-weight:600; color: var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + (track.title || '') + '</span>' +
            '<span class="track-item__artist" style="display:block; font-size:11px; color: var(--color-text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + (track.artist || '') + '</span>' +
          '</div>' +
          '<div class="queue-reorder-controls" style="display:flex; align-items:center; gap:4px; flex-shrink:0;">' +
            '<button type="button" class="btn--queue-up" data-queue-up="' + i + '" ' + (!canMoveUp ? 'disabled style="opacity:0.25; cursor:default;' : 'style="cursor:pointer;') + ' background: var(--color-card-bg); border:none; color: var(--color-text-primary); width:28px; height:28px; border-radius:6px; font-size:12px; display:flex; align-items:center; justify-content:center;" title="Mover arriba">▲</button>' +
            '<button type="button" class="btn--queue-down" data-queue-down="' + i + '" ' + (!canMoveDown ? 'disabled style="opacity:0.25; cursor:default;' : 'style="cursor:pointer;') + ' background: var(--color-card-bg); border:none; color: var(--color-text-primary); width:28px; height:28px; border-radius:6px; font-size:12px; display:flex; align-items:center; justify-content:center;" title="Mover abajo">▼</button>' +
            '<button type="button" class="btn--queue-remove" data-queue-remove="' + i + '" title="Quitar de la cola" style="background:rgba(var(--color-primary-rgb),0.12); border:none; color: var(--color-primary); width:28px; height:28px; border-radius:6px; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; cursor:pointer;">✕</button>' +
          '</div>' +
        '</div>';
      }).join('');

      listEl.innerHTML = html;

      // Wire HTML5 Drag-and-Drop on Queue Items
      var draggedIdx = null;
      var items = listEl.querySelectorAll('.queue-item');
      items.forEach(function (el) {
        el.addEventListener('dragstart', function (e) {
          draggedIdx = parseInt(el.getAttribute('data-queue-idx'), 10);
          el.style.opacity = '0.4';
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(draggedIdx));
        });

        el.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          el.style.borderColor = 'var(--color-primary, #FF4757)';
          el.style.background = 'rgba(255, 71, 87, 0.12)';
        });

        el.addEventListener('dragleave', function () {
          el.style.borderColor = 'transparent';
          el.style.background = '';
        });

        el.addEventListener('drop', function (e) {
          e.preventDefault();
          el.style.borderColor = 'transparent';
          el.style.background = '';
          var targetIdx = parseInt(el.getAttribute('data-queue-idx'), 10);
          var fromIdx = draggedIdx !== null ? draggedIdx : parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(fromIdx) && !isNaN(targetIdx) && fromIdx !== targetIdx && Sonora.Player && Sonora.Player.moveInQueue) {
            Sonora.Player.moveInQueue(fromIdx, targetIdx);
            renderQueue();
          }
        });

        el.addEventListener('dragend', function () {
          el.style.opacity = '1';
          items.forEach(function (it) {
            it.style.borderColor = 'transparent';
            it.style.background = '';
          });
        });
      });

      var clearBtn = $('#btn-clear-queue', listEl);
      if (clearBtn) {
        clearBtn.onclick = function () {
          Sonora.Player.clearQueue();
          renderQueue();
        };
      }
    }

    renderQueue();

    var listEl = $('#queue-list');
    if (!listEl) return;

    listEl.onclick = function (e) {
      var upBtn = e.target.closest('[data-queue-up]');
      if (upBtn) {
        var idx = parseInt(upBtn.getAttribute('data-queue-up'));
        if (idx > 0 && Sonora.Player.moveInQueue) {
          Sonora.Player.moveInQueue(idx, idx - 1);
          renderQueue();
        }
        return;
      }

      var downBtn = e.target.closest('[data-queue-down]');
      if (downBtn) {
        var idx2 = parseInt(downBtn.getAttribute('data-queue-down'));
        var queue = Sonora.Player.getQueue();
        if (idx2 < queue.length - 1 && Sonora.Player.moveInQueue) {
          Sonora.Player.moveInQueue(idx2, idx2 + 1);
          renderQueue();
        }
        return;
      }

      var removeBtn = e.target.closest('[data-queue-remove]');
      if (removeBtn) {
        var idx3 = parseInt(removeBtn.getAttribute('data-queue-remove'));
        if (!isNaN(idx3) && Sonora.Player.removeFromQueue) {
          Sonora.Player.removeFromQueue(idx3);
          renderQueue();
        }
        return;
      }

      var playArea = e.target.closest('[data-action="play-queue-track"]');
      if (playArea) {
        var row = playArea.closest('.queue-item');
        if (row) {
          var rowIdx = parseInt(row.getAttribute('data-queue-idx'));
          var currentQueue = Sonora.Player.getQueue();
          if (!isNaN(rowIdx) && currentQueue[rowIdx]) {
            Sonora.Player.setQueue(currentQueue, rowIdx);
            renderQueue();
          }
        }
      }
    };
  }

  /* ── Synced Lyrics Parser & Floating Notes Fallback ── */
  var _lyricsUnsub = null;
  var _syncedLines = [];

  function parseLrc(lrcText) {
    if (Sonora.Lyrics && typeof Sonora.Lyrics.parse === 'function') {
      return Sonora.Lyrics.parse(lrcText);
    }
    return [];
  }

  function renderFloatingNotesAnimation() {
    return '<div class="no-lyrics-visual" style="text-align: center; padding: 40px 20px; position: relative; overflow: hidden; min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center;">' +
      '<style>' +
        '@keyframes floatNote1 { 0% { transform: translateY(20px) rotate(0deg); opacity: 0; } 50% { opacity: 0.8; } 100% { transform: translateY(-80px) rotate(20deg); opacity: 0; } }' +
        '@keyframes floatNote2 { 0% { transform: translateY(30px) rotate(0deg); opacity: 0; } 50% { opacity: 0.9; } 100% { transform: translateY(-90px) rotate(-25deg); opacity: 0; } }' +
        '@keyframes pulseGlow { 0%, 100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.15); opacity: 0.95; } }' +
        '.note-anim { position: absolute; font-size: 28px; animation-duration: 3s; animation-iteration-count: infinite; animation-timing-function: ease-in-out; }' +
      '</style>' +
      '<div style="width: 110px; height: 110px; border-radius: 50%; background: radial-gradient(circle, rgba(255, 71, 87, 0.45) 0%, rgba(255, 107, 53, 0.1) 70%, transparent 100%); display: flex; align-items: center; justify-content: center; position: relative; animation: pulseGlow 2.5s infinite;">' +
        '<span style="font-size: 46px; filter: drop-shadow(0 0 16px rgba(255,71,87,0.7));">🎶</span>' +
        '<span class="note-anim" style="top: 0; left: 10px; animation-name: floatNote1; animation-delay: 0.2s;">🎵</span>' +
        '<span class="note-anim" style="top: 15px; right: 10px; animation-name: floatNote2; animation-delay: 1.1s;">🎼</span>' +
        '<span class="note-anim" style="bottom: 10px; left: 20px; animation-name: floatNote1; animation-delay: 1.8s;">✨</span>' +
        '<span class="note-anim" style="bottom: 5px; right: 15px; animation-name: floatNote2; animation-delay: 2.3s;">🎸</span>' +
      '</div>' +
      '<div style="font-size: 17px; font-weight: 700; color: var(--color-text-primary); margin-top: 24px;">Sintiendo el ritmo 🎶</div>' +
      '<div style="font-size: 13px; color: var(--color-text-secondary); margin-top: 6px; max-width: 280px;">No hay letra sincronizada disponible para esta canción. Disfruta de la música en alta fidelidad.</div>' +
    '</div>';
  }

  function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function lyricsArtUrl(track) {
    if (!track) return '';
    return track.artworkUrl || generateArtwork(track.id || 0, track.title);
  }

  /* ── Cabecera del panel de letras: disco con la portada + título ── */
  function updateLyricsHeader(track) {
    var discImg = $('#lyrics-disc-img');
    var disc = $('#lyrics-disc');
    var titleEl = $('#lyrics-track-title');
    var artistEl = $('#lyrics-track-artist');
    var bgBlur = $('#lyrics-bg-blur');

    if (!track) {
      if (titleEl) titleEl.textContent = 'Letra';
      if (artistEl) artistEl.textContent = '';
      return;
    }

    var art = lyricsArtUrl(track);
    if (discImg) discImg.src = art;
    if (bgBlur) bgBlur.style.backgroundImage = 'url("' + art + '")';
    if (titleEl) titleEl.textContent = track.title || 'Letra';
    if (artistEl) artistEl.textContent = track.artist || '';
    if (disc) disc.classList.toggle('spinning', !!(Sonora.Player && Sonora.Player.isPlaying && Sonora.Player.isPlaying()));
  }

  /* ── Lyrics Panel ── */
  var _lyricsRenderSeq = 0;
  var _lyricsReloadTimer = null;

  function lyricsLoadingHtml() {
    return '<div style="text-align: center; padding: 48px 20px; color: var(--color-text-secondary);">' +
      '<div style="font-size: 32px; margin-bottom: 12px; animation: pulseGlow 1.5s infinite;">🔍</div>' +
      '<p>Buscando letra…</p>' +
      '<p style="font-size:12px;opacity:.65;margin-top:6px;">Sincronizada con la voz, no con la duración</p>' +
      '</div>';
  }

  async function showLyricsPanel(force) {
    var panel = $('#lyrics-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    var track = Sonora.Player.getCurrentTrack();
    var content = $('#lyrics-content');
    if (!content) return;

    updateLyricsHeader(track);
    if (track && track.artworkUrl) {
      try { Sonora.Themes.applyArtworkColor(track.artworkUrl); } catch (e) {}
    }

    // Cancela la sincronización y las peticiones de la canción anterior.
    if (_lyricsUnsub && typeof _lyricsUnsub.destroy === 'function') {
      try { _lyricsUnsub.destroy(); } catch (e) {}
    }
    _lyricsUnsub = null;

    var seq = ++_lyricsRenderSeq;

    if (!track) {
      content.innerHTML = renderFloatingNotesAnimation();
      return;
    }

    var hasRendered = false;

    function speakerTime() {
      try {
        if (Sonora.Player && typeof Sonora.Player.getCurrentTime === 'function') {
          return Number(Sonora.Player.getCurrentTime()) || 0;
        }
        var progress = Sonora.Player && Sonora.Player.getProgress
          ? Sonora.Player.getProgress() : null;
        return progress ? Number(progress.current) || 0 : 0;
      } catch (e) {
        return 0;
      }
    }

    function renderSynced(lines) {
      if (seq !== _lyricsRenderSeq || !lines || !lines.length) return;
      hasRendered = true;
      _syncedLines = lines;

      // Si veníamos de una letra plana o de otra versión, detener el bucle
      // anterior antes de crear el nuevo.
      if (_lyricsUnsub && typeof _lyricsUnsub.destroy === 'function') {
        try { _lyricsUnsub.destroy(); } catch (e) {}
      }
      _lyricsUnsub = null;

      var lineEls = Sonora.Lyrics.renderLines(content, lines, {
        lineClass: 'lyrics-line',
        idPrefix: 'lyric-line-',
        tail: true,
        wordSync: true
      });

      content.onclick = function (event) {
        var lineEl = event.target.closest('.lyrics-line');
        if (!lineEl) return;
        var seekTime = parseFloat(lineEl.getAttribute('data-time'));
        if (!isNaN(seekTime) && Sonora.Player && Sonora.Player.seek) {
          Sonora.Player.seek(seekTime);
        }
      };

      var syncBtn = $('#lyrics-sync');

      _lyricsUnsub = Sonora.Lyrics.createSync({
        container: content,
        scrollTarget: content,
        lines: lines,
        lineEls: lineEls,
        offset: Sonora.Lyrics.getOffset(track),
        autoScroll: true,
        getTime: speakerTime,
        onActive: function () {},
        onUserScroll: function () {
          if (syncBtn) syncBtn.classList.remove('hidden');
        }
      });

      if (syncBtn) {
        syncBtn.onclick = function () {
          if (_lyricsUnsub && typeof _lyricsUnsub.recenter === 'function') {
            _lyricsUnsub.recenter();
          }
          syncBtn.classList.add('hidden');
        };
        syncBtn.classList.add('hidden');
      }
    }

    function renderPlain(text) {
      if (seq !== _lyricsRenderSeq || !text) return;
      var lines = Sonora.Lyrics.plainLines(text);
      if (!lines.length) return;
      hasRendered = true;

      if (_lyricsUnsub && typeof _lyricsUnsub.destroy === 'function') {
        try { _lyricsUnsub.destroy(); } catch (e) {}
      }
      _lyricsUnsub = null;
      content.onclick = null;

      content.innerHTML =
        '<div style="text-align:center;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary);padding:6px 0 14px;">' +
          'Letra sin sincronizar · buscando versión sincronizada…' +
        '</div>' +
        '<div class="lyrics-text" style="font-size:16px;line-height:1.8;color:var(--color-text-primary);padding:0 8px 24px;white-space:pre-line;">' +
          lines.map(function (line) { return escHtml(line); }).join('\n') +
        '</div>';
    }

    function render(result) {
      if (seq !== _lyricsRenderSeq || !result) return;
      if (result.syncedLyrics) {
        var lines = Sonora.Lyrics.parse(result.syncedLyrics);
        if (lines.length) { renderSynced(lines); return; }
      }
      if (result.plainLyrics) renderPlain(result.plainLyrics);
    }

    content.innerHTML = lyricsLoadingHtml();

    try {
      var result = await Sonora.Lyrics.resolve(track, {
        force: !!force,
        onPartial: function (partial) {
          if (seq !== _lyricsRenderSeq) return;
          render(partial);
        }
      });
      if (seq !== _lyricsRenderSeq) return;
      if (result) render(result);
      if (!hasRendered) content.innerHTML = renderFloatingNotesAnimation();
    } catch (e) {
      console.warn('[Lyrics] No se pudo cargar la letra:', e);
      if (!hasRendered) content.innerHTML = renderFloatingNotesAnimation();
    }
  }

  /* ── Menú de opciones de la letra (botón 3 puntos) ── */
  function buildLyricsLrc() {
    var track = Sonora.Player.getCurrentTrack();
    if (!track) return '';
    if (track.syncedLyrics && /\d{2}:\d{2}/.test(track.syncedLyrics)) return track.syncedLyrics;
    if (_syncedLines && _syncedLines.length) {
      return _syncedLines.map(function (l) {
        var m = Math.floor(l.time / 60);
        var s = Math.floor(l.time % 60);
        var mm = (m < 10 ? '0' : '') + m;
        var ss = (s < 10 ? '0' : '') + s;
        return '[' + mm + ':' + ss + '.00]' + l.text;
      }).join('\n');
    }
    return track.lyrics || '';
  }

  function buildLyricsPlain() {
    var track = Sonora.Player.getCurrentTrack();
    if (!track) return '';
    if (track.lyrics) return track.lyrics;
    if (track.syncedLyrics) {
      return track.syncedLyrics
        .split('\n')
        .map(function (l) { return l.replace(/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s?/, ''); })
        .filter(function (l) { return l.trim().length > 0; })
        .join('\n');
    }
    return '';
  }

  async function downloadLyricsFile(kind) {
    var track = Sonora.Player.getCurrentTrack();
    if (!track) return;
    var content = kind === 'lrc' ? buildLyricsLrc() : buildLyricsPlain();
    if (!content) {
      Sonora.Store.emit('toast', { message: 'Todavía no hay letra para descargar', type: 'warning' });
      return;
    }
    var base = Sonora.Download && Sonora.Download.safeFileName
      ? Sonora.Download.safeFileName(track.artist, track.title, kind)
      : ((track.artist || 'Sonora') + ' - ' + (track.title || 'Cancion') + '.' + kind);
    var mime = kind === 'lrc' ? 'text/plain' : 'text/plain';
    var ok = false;
    if (Sonora.Download && typeof Sonora.Download.saveTextFile === 'function') {
      ok = await Sonora.Download.saveTextFile(content, base, mime);
    }
    Sonora.Store.emit('toast', {
      message: ok ? ('Letra guardada: ' + base) : 'No se pudo guardar la letra',
      type: ok ? 'success' : 'error'
    });
  }

  function saveLyricsForCurrentTrack(text) {
    var track = Sonora.Player.getCurrentTrack();
    if (!track) return Promise.resolve(false);

    var isSynced = /\[\d{2}:\d{2}/.test(text);
    if (isSynced) {
      track.syncedLyrics = text;
    } else {
      track.lyrics = text;
      track.syncedLyrics = null;
    }
    track.lyricsEdited = 1;
    track._lyricsEngine = Sonora.Lyrics ? Sonora.Lyrics.ENGINE_VERSION : 2;

    _syncedLines = isSynced ? parseLrc(text) : [];

    if (track.id === undefined || !Sonora.DB || !Sonora.DB.tracks) return Promise.resolve(true);

    return Sonora.DB.tracks.getById(track.id).then(function (dbTrack) {
      var record = dbTrack || {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album || '',
        duration: track.duration || 0,
        artworkUrl: track.artworkUrl || '',
        filePath: track.filePath || null,
        streamUrl: track.streamUrl || null,
        sourceUrl: track.sourceUrl || null,
        platform: track.platform || 'local'
      };
      if (isSynced) {
        record.syncedLyrics = text;
      } else {
        record.lyrics = text;
        record.syncedLyrics = '';
      }
      record.lyricsEdited = 1;
      return Sonora.DB.tracks.update(record).then(function () { return true; });
    }).catch(function () { return false; });
  }

  function openLyricsEditor() {
    var track = Sonora.Player.getCurrentTrack();
    if (!track) return;
    var current = buildLyricsLrc() || '';

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal__backdrop"></div>' +
      '<div class="modal__content" style="max-width: 420px; width: calc(100% - 32px); border-radius: 20px; padding: 18px; background: var(--color-surface); border: 1px solid var(--color-divider);">' +
        '<h3 style="font-size: 16px; margin: 0 0 4px; text-align: center; color: var(--color-text-primary);">Editar letra</h3>' +
        '<p style="font-size: 11px; color: var(--color-text-secondary); text-align: center; margin: 0 0 12px;">' +
          'Usa <b>[mm:ss.xx]</b> al inicio de cada línea para sincronizarla. Si escribes texto normal, se guardará como letra sin sincronizar.' +
        '</p>' +
        '<textarea id="lyrics-editor-text" spellcheck="false" style="width: 100%; height: 42vh; min-height: 220px; resize: vertical; box-sizing: border-box; background: var(--color-background); color: var(--color-text-primary); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 12px; font-family: ui-monospace, Menlo, monospace; font-size: 13px; line-height: 1.6;">' + escHtml(current) + '</textarea>' +
        '<div style="display: flex; gap: 8px; margin-top: 14px;">' +
          '<button id="lyrics-editor-cancel" class="btn" style="flex: 1; background: var(--color-surface-elevated); border: 1px solid var(--color-divider); color: var(--color-text-primary); padding: 11px; border-radius: 12px; cursor: pointer;">Cancelar</button>' +
          '<button id="lyrics-editor-save" class="btn" style="flex: 1.4; background: var(--artwork-color, var(--color-primary)); border: none; color: var(--color-on-primary); font-weight: 700; padding: 11px; border-radius: 12px; cursor: pointer;">Guardar letra</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var close = function () { if (modal.parentElement) modal.parentElement.removeChild(modal); };
    modal.querySelector('.modal__backdrop').onclick = close;
    var cancelBtn = modal.querySelector('#lyrics-editor-cancel');
    if (cancelBtn) cancelBtn.onclick = close;
    var saveBtn = modal.querySelector('#lyrics-editor-save');
    if (saveBtn) {
      saveBtn.onclick = async function () {
        var ta = modal.querySelector('#lyrics-editor-text');
        var text = ta ? ta.value.trim() : '';
        saveBtn.disabled = true;
        saveBtn.textContent = 'Guardando...';
        var ok = await saveLyricsForCurrentTrack(text);
        close();
        Sonora.Store.emit('toast', {
          message: ok ? 'Letra guardada' : 'No se pudo guardar la letra',
          type: ok ? 'success' : 'error'
        });
        showLyricsPanel();
      };
    }
  }

  function resetLyricsForCurrentTrack() {
    var track = Sonora.Player.getCurrentTrack();
    if (!track) return Promise.resolve(false);
    track.lyricsEdited = 0;
    _syncedLines = [];
    if (Sonora.Lyrics && typeof Sonora.Lyrics.forget === 'function') {
      return Sonora.Lyrics.forget(track);
    }
    track.syncedLyrics = null;
    track.lyrics = null;
    if (track.id === undefined || !Sonora.DB || !Sonora.DB.tracks) return Promise.resolve(true);
    return Sonora.DB.tracks.getById(track.id).then(function (dbTrack) {
      if (!dbTrack) return true;
      dbTrack.syncedLyrics = '';
      dbTrack.lyrics = '';
      dbTrack.lyricsEdited = 0;
      return Sonora.DB.tracks.update(dbTrack).then(function () { return true; });
    }).catch(function () { return false; });
  }

  function openLyricsMenu() {
    var track = Sonora.Player.getCurrentTrack();
    if (!track) {
      Sonora.Store.emit('toast', { message: 'Reproduce una canción para usar las opciones de letra', type: 'info' });
      return;
    }

    var currentOffset = Sonora.Lyrics ? Sonora.Lyrics.getOffset(track) : 0;
    var offsetText = (currentOffset > 0 ? '+' : '') + currentOffset.toFixed(1) + ' s';

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal__backdrop"></div>' +
      '<div class="modal__content" style="max-width: 340px; border-radius: 20px; padding: 18px; background: var(--color-surface); border: 1px solid var(--color-divider);">' +
        '<h3 style="font-size: 16px; margin: 0 0 14px; text-align: center; color: var(--color-text-primary);">Opciones de letra</h3>' +
        '<div style="display: flex; flex-direction: column; gap: 9px;">' +
          '<button data-lyr-action="edit" class="btn" style="' + lyricsMenuBtnStyle + '">✏️ Editar letra</button>' +
          '<button data-lyr-action="dl-lrc" class="btn" style="' + lyricsMenuBtnStyle + '">🎵 Descargar letra (.lrc)</button>' +
          '<button data-lyr-action="dl-txt" class="btn" style="' + lyricsMenuBtnStyle + '">📄 Descargar letra (.txt)</button>' +
          '<button data-lyr-action="reset" class="btn" style="' + lyricsMenuBtnStyle + '">🔄 Restablecer y buscar de nuevo</button>' +
        '</div>' +
        '<div style="margin-top:14px;padding:12px;border-radius:14px;background:var(--color-surface-elevated);border:1px solid var(--color-divider);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
            '<span style="font-size:12px;font-weight:700;color:var(--color-text-primary);">Ajuste de sincronización</span>' +
            '<span id="lyrics-offset-value" style="font-size:12px;font-weight:800;color:var(--color-primary);">' + offsetText + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:5px;">' +
            '<button data-lyr-offset="-0.5" class="btn" style="flex:1;padding:8px 0;border-radius:10px;background:var(--color-background);border:1px solid var(--color-divider);color:var(--color-text-primary);font-size:12px;cursor:pointer;">−0.5s</button>' +
            '<button data-lyr-offset="-0.1" class="btn" style="flex:1;padding:8px 0;border-radius:10px;background:var(--color-background);border:1px solid var(--color-divider);color:var(--color-text-primary);font-size:12px;cursor:pointer;">−0.1s</button>' +
            '<button data-lyr-offset="0" data-lyr-offset-reset="1" class="btn" style="flex:1;padding:8px 0;border-radius:10px;background:var(--color-background);border:1px solid var(--color-divider);color:var(--color-text-primary);font-size:12px;cursor:pointer;">0</button>' +
            '<button data-lyr-offset="0.1" class="btn" style="flex:1;padding:8px 0;border-radius:10px;background:var(--color-background);border:1px solid var(--color-divider);color:var(--color-text-primary);font-size:12px;cursor:pointer;">+0.1s</button>' +
            '<button data-lyr-offset="0.5" class="btn" style="flex:1;padding:8px 0;border-radius:10px;background:var(--color-background);border:1px solid var(--color-divider);color:var(--color-text-primary);font-size:12px;cursor:pointer;">+0.5s</button>' +
          '</div>' +
          '<p style="font-size:10.5px;line-height:1.45;color:var(--color-text-secondary);margin:8px 0 0;">' +
            'Si la letra va adelantada a la voz, usa los valores negativos. Si va atrasada, usa los positivos. Se guarda por canción.' +
          '</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var close = function () { if (modal.parentElement) modal.parentElement.removeChild(modal); };
    modal.querySelector('.modal__backdrop').onclick = close;

    modal.addEventListener('click', function (e) {
      var offsetBtn = e.target.closest('[data-lyr-offset]');
      if (offsetBtn) {
        var value = parseFloat(offsetBtn.getAttribute('data-lyr-offset')) || 0;
        var isReset = offsetBtn.getAttribute('data-lyr-offset-reset') === '1';
        var next = isReset ? 0 : (Sonora.Lyrics.getOffset(track) + value);
        next = Sonora.Lyrics.setOffset(track, next);

        var label = modal.querySelector('#lyrics-offset-value');
        if (label) label.textContent = (next > 0 ? '+' : '') + next.toFixed(1) + ' s';
        if (_lyricsUnsub && typeof _lyricsUnsub.setOffset === 'function') {
          _lyricsUnsub.setOffset(next);
        }
        return;
      }

      var btn = e.target.closest('[data-lyr-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-lyr-action');
      if (action === 'edit') {
        close();
        openLyricsEditor();
      } else if (action === 'dl-lrc' || action === 'dl-txt') {
        close();
        downloadLyricsFile(action === 'dl-lrc' ? 'lrc' : 'txt');
      } else if (action === 'reset') {
        close();
        resetLyricsForCurrentTrack().then(function () {
          Sonora.Store.emit('toast', { message: 'Buscando la letra original…', type: 'info' });
          showLyricsPanel(true);
        });
      }
    });
  }

  var lyricsMenuBtnStyle = 'background: var(--color-surface-elevated); border: 1px solid var(--color-divider); color: var(--color-text-primary); padding: 12px; border-radius: 12px; text-align: left; display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 14px;';

  /* ── Sleep Timer ── */
  function showSleepTimer() {
    var modal = $('#sleep-timer-modal');
    if (modal) modal.classList.remove('hidden');
  }

  /* ── Playback sheet: velocidad + visualizador ── */
  function savePlaybackSetting(key, value) {
    try {
      if (Sonora.DB && Sonora.DB.settings && typeof Sonora.DB.settings.set === 'function') {
        Sonora.DB.settings.set(key, value);
      }
    } catch (e) {}
    try { localStorage.setItem('sonora_' + key, JSON.stringify(value)); } catch (e) {}
  }

  function speedLabel(v) {
    var n = Number(v) || 1;
    return (Math.round(n * 100) / 100) + '×';
  }

  function refreshPlaybackUI() {
    var speed = (Sonora.Player && Sonora.Player.getSpeed) ? Sonora.Player.getSpeed() : 1;
    var label = $('#player-speed-label');
    if (label) label.textContent = speedLabel(speed);
    var pill = $('#player-speed');
    if (pill) pill.classList.toggle('active', Math.abs(speed - 1) > 0.001);

    $$('#playback-speed-chips .playback-chip').forEach(function (chip) {
      var v = parseFloat(chip.getAttribute('data-speed'));
      chip.classList.toggle('active', Math.abs(v - speed) < 0.001);
    });

    var viz = (Sonora.Visualizer && Sonora.Visualizer.getType) ? Sonora.Visualizer.getType() : 'wave';
    $$('#playback-viz-chips .playback-chip').forEach(function (chip) {
      chip.classList.toggle('active', chip.getAttribute('data-viz') === viz);
    });
    var vizBtn = $('#player-visualizer-toggle');
    if (vizBtn) vizBtn.classList.toggle('active', viz !== 'none');
  }

  function showPlaybackSheet() {
    var sheet = $('#playback-sheet');
    if (!sheet) return;
    refreshPlaybackUI();
    sheet.classList.remove('hidden');
  }

  function hidePlaybackSheet() {
    var sheet = $('#playback-sheet');
    if (sheet) sheet.classList.add('hidden');
  }

  function bindPlaybackSheet() {
    var sheet = $('#playback-sheet');
    if (!sheet) return;

    var closeBtn = $('#playback-sheet-close');
    if (closeBtn) closeBtn.addEventListener('click', hidePlaybackSheet);
    var backdrop = sheet.querySelector('.modal__backdrop');
    if (backdrop) backdrop.addEventListener('click', hidePlaybackSheet);

    $$('#playback-speed-chips .playback-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var v = parseFloat(chip.getAttribute('data-speed')) || 1;
        if (Sonora.Player && Sonora.Player.setSpeed) Sonora.Player.setSpeed(v);
        savePlaybackSetting('playback_speed', v);
        refreshPlaybackUI();
        Sonora.Store.emit('toast', { message: 'Velocidad: ' + speedLabel(v), type: 'info' });
      });
    });

    $$('#playback-viz-chips .playback-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var type = chip.getAttribute('data-viz') || 'wave';
        if (Sonora.Visualizer && Sonora.Visualizer.setType) Sonora.Visualizer.setType(type);
        savePlaybackSetting('visualizer_type', type);
        refreshPlaybackUI();
        var names = { none: 'Apagado', wave: 'Onda', circular: 'Círculo', particle: 'Partículas', bar: 'Barras' };
        Sonora.Store.emit('toast', { message: 'Visualizador: ' + (names[type] || type), type: 'info' });
      });
    });
  }

  function restorePlaybackPreferences() {
    try {
      Sonora.DB.settings.get('playback_speed').then(function (v) {
        var n = Number(v);
        if (n >= 0.5 && n <= 2 && Sonora.Player && Sonora.Player.setSpeed) Sonora.Player.setSpeed(n);
        refreshPlaybackUI();
      }).catch(function () {});

      Sonora.DB.settings.get('visualizer_type').then(function (type) {
        if (type && Sonora.Visualizer && Sonora.Visualizer.setType) Sonora.Visualizer.setType(type);
        refreshPlaybackUI();
      }).catch(function () {});
    } catch (e) {}
  }

  /* ── Server status indicator ──
     🔵 local · 🚀 northflank · 🟢 nube (Render) · 🟡 conectado pero lento · 🔴 sin conexión */
  function updateServerStatus() {
    var dot = $('#server-dot');
    if (!dot) return;
    var mode = Sonora.Store.get('serverMode') || 'off';
    var latency = Sonora.Store.get('serverLatency') || 0;
    dot.className = 'server-dot';
    dot.title = 'Sin conexión con el servidor';
    if (mode === 'device') {
      dot.classList.add('server-dot--device');
      dot.title = 'Modo Dispositivo · solo música local';
      return;
    }
    if (mode === 'local' || mode === 'render' || mode === 'northflank') {
      var who = mode === 'local' ? 'Servidor local' : (mode === 'northflank' ? 'Servidor Northflank' : 'Servidor en la nube');
      if (latency > 1000) {
        // 🟠 Conectado pero muy lento
        dot.classList.add('server-dot--slow');
        dot.title = who + ' · lento (' + latency + ' ms)';
      } else if (latency > 0) {
        // 🟢 Conectado
        dot.classList.add(mode === 'northflank' ? 'server-dot--northflank' : 'server-dot--connected');
        dot.title = who + ' · ' + latency + ' ms';
      } else {
        // 🔴 Elegido pero sin respuesta
        dot.classList.add('server-dot--offline');
        dot.title = who + ' · sin respuesta';
      }
    } else {
      // 🔴 Sin servidor
      dot.classList.add('server-dot--offline');
    }
  }

  /** Mide la latencia del servidor activo y pinta el punto en consecuencia */
  function probeServerStatus() {
    var mode = Sonora.Store.get('serverMode') || 'off';
    if (mode !== 'local' && mode !== 'render' && mode !== 'northflank') { updateServerStatus(); return; }
    if (!(Sonora.API && typeof Sonora.API.testConnection === 'function')) { updateServerStatus(); return; }
    var t0 = Date.now();
    Sonora.API.testConnection(mode, mode === 'render' ? 22000 : 9000).then(function (res) {
      var ms = (res && res.latency) ? res.latency : (Date.now() - t0);
      var ok = !!(res && (res.success || res.status === 200 || res.ok));
      // Si no responde NO borramos el servidor elegido (antes se ponía en
      // "off" y la app se quedaba sin servidor para siempre): sólo lo
      // marcamos en rojo y se reintenta en la siguiente comprobación.
      Sonora.Store.set('serverLatency', ok ? Math.max(ms, 1) : 0);
      updateServerStatus();
    }).catch(function () {
      Sonora.Store.set('serverLatency', 0);
      updateServerStatus();
    });
  }

  /* ── Progress bar scrubbing ── */
  function initProgressBarScrub() {
    var bar = $('#player-progress-bar');
    if (!bar) return;
    var isDragging = false;

    function scrub(e) {
      var rect = bar.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      Sonora.Player.seekPercent(pct);
    }

    bar.addEventListener('mousedown', function (e) { isDragging = true; scrub(e); });
    bar.addEventListener('touchstart', function (e) { isDragging = true; scrub(e); }, { passive: true });

    document.addEventListener('mousemove', function (e) { if (isDragging) scrub(e); });
    document.addEventListener('touchmove', function (e) { if (isDragging) scrub(e); }, { passive: true });

    document.addEventListener('mouseup', function () { isDragging = false; });
    document.addEventListener('touchend', function () { isDragging = false; });
  }

  /* ── Bind all UI events ── */
  function bindEvents() {
    // Bottom nav
    $$('#bottom-nav .nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var page = btn.getAttribute('data-page');
        if (page) Sonora.Router.navigate('/' + (page === 'home' ? '' : page));
      });
    });

    // Header buttons
    var backBtn = $('#header-back');
    if (backBtn) backBtn.addEventListener('click', function () { Sonora.Router.back(); });

    var profileBtn = $('#header-profile-btn');
    if (profileBtn) profileBtn.addEventListener('click', function () { Sonora.Router.navigate('/profile'); });

    var serverBtn = $('#header-server-status');
    if (serverBtn) serverBtn.addEventListener('click', function () { Sonora.Router.navigate('/settings'); });

    var dlBtn = $('#header-downloads-btn');
    if (dlBtn) dlBtn.addEventListener('click', function () {
      if (Sonora.Download && typeof Sonora.Download.openDownloadsModal === 'function') {
        Sonora.Download.openDownloadsModal();
      }
    });

    // Mini player
    var miniContent = $('#mini-player-content');
    if (miniContent) miniContent.addEventListener('click', function (e) {
      if (e.target.closest('.btn--icon')) return; // Don't open full player on button clicks
      showFullPlayer();
    });

    var miniPlayBtn = $('#mini-play-btn');
    if (miniPlayBtn) miniPlayBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      Sonora.Player.toggle();
    });

    var miniNextBtn = $('#mini-next-btn');
    if (miniNextBtn) miniNextBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      Sonora.Player.next();
    });

    // Full player controls
    var playerClose = $('#player-close');
    if (playerClose) playerClose.addEventListener('click', hideFullPlayer);

    var playerPlay = $('#player-play');
    if (playerPlay) playerPlay.addEventListener('click', function () { Sonora.Player.toggle(); });

    var playerPrev = $('#player-prev');
    if (playerPrev) playerPrev.addEventListener('click', function () { Sonora.Player.previous(); });

    var playerNext = $('#player-next');
    if (playerNext) playerNext.addEventListener('click', function () { Sonora.Player.next(); });

    var playerShuffle = $('#player-shuffle');
    if (playerShuffle) playerShuffle.addEventListener('click', function () {
      Sonora.Player.toggleShuffle();
      playerShuffle.classList.toggle('active', Sonora.Player.isShuffled());
    });

    var playerRepeat = $('#player-repeat');
    if (playerRepeat) playerRepeat.addEventListener('click', function () {
      Sonora.Player.cycleRepeat();
      var mode = Sonora.Player.getRepeatMode();
      playerRepeat.classList.toggle('active', mode !== 'off');
      var badge = $('#repeat-badge');
      if (badge) badge.classList.toggle('hidden', mode !== 'one');
      Sonora.Store.emit('toast', { message: 'Repetir: ' + (mode === 'off' ? 'Desactivado' : mode === 'all' ? 'Todo' : 'Una'), type: 'info' });
    });

    // Volume
    var volumeSlider = $('#player-volume');
    if (volumeSlider) volumeSlider.addEventListener('input', function () {
      Sonora.Player.setVolume(parseInt(volumeSlider.value) / 100);
    });

    // Velocidad + visualizador: una sola hoja para ambos
    var vizToggle = $('#player-visualizer-toggle');
    var speedBtn = $('#player-speed');
    if (vizToggle) vizToggle.addEventListener('click', showPlaybackSheet);
    if (speedBtn) speedBtn.addEventListener('click', showPlaybackSheet);
    bindPlaybackSheet();
    refreshPlaybackUI();

    // Extras
    var lyricsBtn = $('#player-lyrics');
    if (lyricsBtn) lyricsBtn.addEventListener('click', function () { showLyricsPanel(false); });

    var queueBtn = $('#player-queue');
    if (queueBtn) queueBtn.addEventListener('click', showQueuePanel);

    var sleepBtn = $('#player-sleep');
    if (sleepBtn) sleepBtn.addEventListener('click', showSleepTimer);

    var downloadBtn = $('#player-download');
    if (downloadBtn) downloadBtn.addEventListener('click', function () {
      var track = Sonora.Player.getCurrentTrack();
      if (track) Sonora.Download.downloadTrack(track);
    });

    function shareCurrentTrack() {
      var track = Sonora.Player.getCurrentTrack();
      if (!track) return;
      var title = track.title || 'Canción';
      var artist = track.artist || 'Artista desconocido';
      var text = '🎧 Escuchando "' + title + '" de ' + artist + ' en Sonora Music.';
      if (Sonora.Share && typeof Sonora.Share.shareText === 'function') {
        Sonora.Share.shareText(title, text);
      } else if (navigator.share) {
        navigator.share({ title: title, text: text }).catch(function () {});
      } else {
        Sonora.Store.emit('toast', { message: 'Compartir no está disponible', type: 'warning' });
      }
    }

    function openInLarkPlayer() {
      var track = Sonora.Player.getCurrentTrack();
      var title = track ? (track.title || '') : '';
      var artist = track ? (track.artist || '') : '';
      if (window.SonoraNative && typeof window.SonoraNative.openInLarkPlayer === 'function') {
        var success = window.SonoraNative.openInLarkPlayer(title, artist);
        if (success) {
          Sonora.Store.emit('toast', { message: 'Abriendo en Lark Player...', type: 'info' });
        } else {
          Sonora.Store.emit('toast', { message: 'Iniciando reproductor de música...', type: 'info' });
        }
      } else {
        Sonora.Store.emit('toast', { message: 'Lark Player disponible en la app Android', type: 'info' });
      }
    }

    // Player Options Menu (3-dots)
    var playerMenuBtn = $('#player-menu');
    if (playerMenuBtn) {
      playerMenuBtn.addEventListener('click', function () {
        var track = Sonora.Player.getCurrentTrack();
        if (!track) return;
        var autoplayState = Sonora.Player.isAutoplay ? Sonora.Player.isAutoplay() : true;
        var itemStyle = 'background: var(--color-surface-elevated); border: 1px solid var(--color-divider); color: var(--color-text-primary); padding: 12px; border-radius: 12px; text-align: left; display: flex; align-items: center; gap: 10px; cursor: pointer; width: 100%; font-size: 13.5px;';
        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = '<div class="modal__backdrop"></div>' +
          '<div class="modal__content" style="max-width: 320px; border-radius: 20px; padding: 20px; background: var(--color-surface); border: 1px solid var(--color-divider);">' +
            '<h3 style="font-size: 17px; margin-bottom: 16px; text-align: center; color: var(--color-text-primary);">Opciones de reproducción</h3>' +
            '<div style="display: flex; flex-direction: column; gap: 10px;">' +
              '<button id="opt-open-lark" class="btn" style="' + itemStyle + '">🎵 Abrir en Lark Player</button>' +
              '<button id="opt-share" class="btn" style="' + itemStyle + '">📤 Compartir canción</button>' +
              '<button id="opt-toggle-autoplay" class="btn" style="' + itemStyle + '">📻 Modo Radio: ' + (autoplayState ? 'Activado ✓' : 'Desactivado') + '</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(modal);

        var close = function () {
          if (modal.parentElement) modal.parentElement.removeChild(modal);
        };
        modal.querySelector('.modal__backdrop').onclick = close;

        var optLark = modal.querySelector('#opt-open-lark');
        if (optLark) optLark.onclick = function () { close(); openInLarkPlayer(); };

        var optShare = modal.querySelector('#opt-share');
        if (optShare) optShare.onclick = function () { close(); shareCurrentTrack(); };

        var optAuto = modal.querySelector('#opt-toggle-autoplay');
        if (optAuto) optAuto.onclick = function () {
          var newState = !autoplayState;
          if (Sonora.Player.setAutoplay) Sonora.Player.setAutoplay(newState);
          Sonora.Store.emit('toast', { message: 'Modo Radio: ' + (newState ? 'Activado (canciones similares automáticas)' : 'Desactivado'), type: 'info' });
          close();
        };
      });
    }

    // Panel close buttons
    var queueClose = $('#queue-close');
    if (queueClose) queueClose.addEventListener('click', function () { $('#queue-panel').classList.add('hidden'); });

    var lyricsMenuBtn = $('#lyrics-menu-btn');
    if (lyricsMenuBtn) lyricsMenuBtn.addEventListener('click', openLyricsMenu);

    var lyricsClose = $('#lyrics-close');
    if (lyricsClose) lyricsClose.addEventListener('click', function () {
      $('#lyrics-panel').classList.add('hidden');
      var syncBtn = $('#lyrics-sync');
      if (syncBtn) syncBtn.classList.add('hidden');
      var disc = $('#lyrics-disc');
      if (disc) disc.classList.remove('spinning');
      var lyricsContent = $('#lyrics-content');
      if (lyricsContent) lyricsContent.onscroll = null;
      // Cancela la sincronización activa para no dejar un bucle de RAF vivo.
      _lyricsRenderSeq++;
      if (_lyricsUnsub) {
        try {
          if (typeof _lyricsUnsub.destroy === 'function') _lyricsUnsub.destroy();
          else _lyricsUnsub();
        } catch (e) {}
        _lyricsUnsub = null;
      }
    });

    // Sleep timer options
    var sleepOptions = $('#sleep-timer-options');
    if (sleepOptions) sleepOptions.addEventListener('click', function (e) {
      var btn = e.target.closest('.modal__option');
      if (!btn) return;
      var raw = btn.getAttribute('data-minutes');
      var isEndOfTrack = (raw === 'end_track');
      var minutes = isEndOfTrack ? 'end_track' : (parseInt(raw, 10) || 0);
      Sonora.Player.setSleepTimer(minutes);
      $('#sleep-timer-modal').classList.add('hidden');
      if (isEndOfTrack) {
        Sonora.Store.emit('toast', { message: 'Se pausará al terminar esta canción', type: 'info' });
      } else if (minutes > 0) {
        Sonora.Store.emit('toast', { message: 'Temporizador: ' + minutes + ' minutos', type: 'info' });
      } else {
        Sonora.Store.emit('toast', { message: 'Temporizador desactivado', type: 'info' });
      }
    });

    // Modal backdrop close
    $$('.modal__backdrop').forEach(function (backdrop) {
      backdrop.addEventListener('click', function () {
        backdrop.parentElement.classList.add('hidden');
      });
    });

    // Progress bar scrubbing
    initProgressBarScrub();

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.code) {
        case 'Space': e.preventDefault(); Sonora.Player.toggle(); break;
        case 'ArrowRight': Sonora.Player.next(); break;
        case 'ArrowLeft': Sonora.Player.previous(); break;
        case 'ArrowUp': e.preventDefault(); Sonora.Player.setVolume(Math.min(1, (Sonora.Player.getVolume() || 0.8) + 0.05)); break;
        case 'ArrowDown': e.preventDefault(); Sonora.Player.setVolume(Math.max(0, (Sonora.Player.getVolume() || 0.8) - 0.05)); break;
      }
    });
  }

  /* ── Subscribe to store updates ── */
  function bindStoreSubscriptions() {
    Sonora.Store.subscribe('currentTrack', function () {
      updateMiniPlayer();
      updateFullPlayer();

      // Si el panel de letras está abierto, recargar la letra de la nueva
      // canción automáticamente. Antes se quedaba con la letra anterior.
      var lyricsPanel = $('#lyrics-panel');
      if (lyricsPanel && !lyricsPanel.classList.contains('hidden')) {
        if (_lyricsReloadTimer) clearTimeout(_lyricsReloadTimer);
        _lyricsReloadTimer = setTimeout(function () {
          if (Sonora.Player.getCurrentTrack()) showLyricsPanel(false);
        }, 80);
      }
    });

    Sonora.Store.subscribe('isPlaying', function () {
      updateMiniPlayer();
      updateFullPlayer();
    });

    Sonora.Store.subscribe('progress', function () {
      updateMiniProgress();
      if (Sonora.Store.get('fullPlayerVisible')) {
        updateFullProgress();
      }
    });

    Sonora.Store.subscribe('serverMode', updateServerStatus);
    Sonora.Store.subscribe('serverLatency', updateServerStatus);
    // Comprobación periódica del servidor (pinta el punto azul/verde/amarillo/rojo)
    probeServerStatus();
    setInterval(probeServerStatus, 60000);

    Sonora.Store.on('trackChanged', function () {
      updateMiniPlayer();
      if (Sonora.Store.get('fullPlayerVisible')) {
        updateFullPlayer();
        showQueuePanel; // refresh queue if open
      }
    });
  }

  /* ── Setup routes ── */
  function setupRoutes() {
    Sonora.Router
      .on('/', function () { loadPage('home'); })
      .on('/home', function () { loadPage('home'); })
      .on('/search', function () { loadPage('search'); })
      .on('/library', function () { loadPage('library'); })
      .on('/playlists', function () { loadPage('playlists'); })
      // Enlace compartido de playlist colaborativa: abre la app y se une sola.
      .on('/playlists/join', function (params) {
        loadPage('playlists');
        setTimeout(function () {
          var code = (params && params.code) || '';
          var P = Sonora.Pages && (Sonora.Pages.Playlists || Sonora.Pages.Playlist);
          if (code && P && typeof P.joinByCode === 'function') P.joinByCode(code);
        }, 350);
      })
      .on('/playlist/join', function (params) {
        loadPage('playlists');
        setTimeout(function () {
          var code = (params && params.code) || '';
          var P = Sonora.Pages && (Sonora.Pages.Playlists || Sonora.Pages.Playlist);
          if (code && P && typeof P.joinByCode === 'function') P.joinByCode(code);
        }, 350);
      })
      .on('/playlist/:id', function (params) { loadPage('playlists', params); })
      // La app navega a /playlists/<id> (plural): sin esta ruta el detalle de
      // una playlist no se abría nunca y volvía al inicio.
      .on('/playlists/:id', function (params) { loadPage('playlists', params); })
      .on('/discover', function () { loadPage('discover'); })
      .on('/profile', function () { loadPage('profile'); })
      .on('/settings', function () { loadPage('settings'); })
      .on('/album/:id', function (params) { loadPage('library', { albumId: params.id }); })
      .on('/artist/:id', function (params) { loadPage('library', { artistId: params.id }); });
  }

  /* ── Generate PWA icons dynamically ── */
  function generateIcons() {
    var sizes = [72, 96, 128, 144, 152, 192, 384, 512];
    sizes.forEach(function (size) {
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');

      // Background gradient
      var grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#FF3E2E');
      grad.addColorStop(0.5, '#FF4757');
      grad.addColorStop(1, '#FF6B35');
      ctx.fillStyle = grad;

      // Rounded rect
      var r = size * 0.18;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(size - r, 0);
      ctx.quadraticCurveTo(size, 0, size, r);
      ctx.lineTo(size, size - r);
      ctx.quadraticCurveTo(size, size, size - r, size);
      ctx.lineTo(r, size);
      ctx.quadraticCurveTo(0, size, 0, size - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      ctx.fill();

      // Music note icon
      ctx.fillStyle = 'white';
      var s = size * 0.22;
      var cx = size * 0.42;
      var cy = size * 0.65;

      // Note head (ellipse)
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 0.42, s * 0.32, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Stem
      ctx.fillRect(cx + s * 0.35, cy - s * 1.7, s * 0.12, s * 1.75);

      // Flag
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.47, cy - s * 1.7);
      ctx.quadraticCurveTo(cx + s * 1.1, cy - s * 1.3, cx + s * 0.9, cy - s * 0.6);
      ctx.quadraticCurveTo(cx + s * 1.0, cy - s * 1.1, cx + s * 0.47, cy - s * 1.2);
      ctx.closePath();
      ctx.fill();

      // Try to save as file via link (won't work in all contexts but the icons are generated)
      try {
        canvas.toBlob(function (blob) {
          // Icons are generated dynamically - for PWA they need to be static files
          // This is a fallback; the real icons should be placed in /icons/
        }, 'image/png');
      } catch (e) {}
    });
  }

  /* ── Create SVG icon files ── */
  function createFallbackIcons() {
    // Create a simple SVG icon for use when PNG icons aren't available
    var svgIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#FF3E2E"/><stop offset="50%" stop-color="#FF4757"/><stop offset="100%" stop-color="#FF6B35"/>' +
      '</linearGradient></defs>' +
      '<rect fill="url(#bg)" width="512" height="512" rx="92"/>' +
      '<path d="M200 380c-33 0-60-27-60-60s27-60 60-60 60 27 60 60-27 60-60 60zm160-260v240c0 8.8-7.2 16-16 16s-16-7.2-16-16V156l-128 36v-48l160-48v24z" fill="white"/>' +
      '</svg>';

    // Set as favicon
    var link = document.querySelector('link[rel="icon"]');
    if (link) {
      link.href = 'data:image/svg+xml,' + encodeURIComponent(svgIcon);
    }
    var appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleLink) {
      appleLink.href = 'data:image/svg+xml,' + encodeURIComponent(svgIcon);
    }
  }

  /* ══════════════════════════════════════════════
     MAIN INITIALIZATION
     ══════════════════════════════════════════════ */
  function boot() {
    console.log('🎵 Sonora Music v7.17.1 — Booting...');

    var splashScreen = $('#splash-screen');

    // Step 1: Init Store
    try { Sonora.Store.init(); } catch (e) { console.error('Store init failed:', e); }

    // Step 2: Init DB (async)
    Sonora.DB.init()
      .then(function () {
        console.log('[App] DB ready');

        // Step 3: Init modules in parallel
        var inits = [];
        if (Sonora.Themes && Sonora.Themes.init) inits.push(Sonora.Themes.init());

        // Aplica el modo guardado de inmediato (sin probar la red): la app ya
        // sabe si debe mostrar Modo Dispositivo, Local, Render o Northflank.
        if (Sonora.DB && Sonora.DB.settings) {
          inits.push(Sonora.DB.settings.get('serverMode').then(function (m) {
            if (m && Sonora.API && Sonora.API.setMode) Sonora.API.setMode(m);
          }).catch(function () {}));
        }

        // Idioma guardado (Español / English)
        if (Sonora.i18n && Sonora.DB && Sonora.DB.settings) {
          inits.push(Sonora.DB.settings.get('language').then(function (lang) {
            Sonora.i18n.setLang(lang || 'es');
          }).catch(function () { Sonora.i18n.setLang('es'); }));
        }

        // Candado de las canciones del teléfono (biblioteca y playlists)
        if (Sonora.DeviceLock && typeof Sonora.DeviceLock.refresh === 'function') {
          inits.push(Sonora.DeviceLock.refresh());
        }

        return Promise.all(inits);
      })
      .then(function () {
        console.log('[App] Modules initialized');

        // Step 4: Init player
        if (Sonora.Player && Sonora.Player.init) {
          try { Sonora.Player.init(); } catch (e) { console.warn('Player init:', e); }
        }
        restorePlaybackPreferences();

        // Step 5: Init notifications
        if (Sonora.Notifications && Sonora.Notifications.init) {
          try { Sonora.Notifications.init(); } catch (e) { console.warn('Notif init:', e); }
        }

        // Step 6: Setup routes and events
        setupRoutes();
        bindEvents();
        bindStoreSubscriptions();

        // Step 6b: Leer la música del teléfono en segundo plano (así las
        // playlists ya pueden incluir archivos del dispositivo).
        setTimeout(function () {
          try {
            if (Sonora.Pages && Sonora.Pages.Library &&
                typeof Sonora.Pages.Library.preloadDeviceTracks === 'function') {
              Sonora.Pages.Library.preloadDeviceTracks();
            }
          } catch (e) { /* noop */ }
        }, 2500);

        // Step 7: Show app, hide splash
        var app = $('#app');
        if (app) app.classList.remove('app-hidden');

        if (splashScreen) {
          setTimeout(function () {
            splashScreen.classList.add('hidden');
            setTimeout(function () {
              if (splashScreen.parentNode) splashScreen.parentNode.removeChild(splashScreen);
            }, 700);
          }, 250);
        }

        // Step 8: Start router
        Sonora.Router.start();

        // Step 9: Probar servidores en segundo plano. Render puede tardar
        // hasta 25 s en despertar; la app ya es usable mientras tanto.
        if (Sonora.API && Sonora.API.init) {
          Sonora.API.init().then(function () {
            updateServerStatus();
          }).catch(function () {
            updateServerStatus();
          });
        } else {
          updateServerStatus();
        }

        // Step 10: Create fallback icons
        createFallbackIcons();

        // Step 11: Register Service Worker
        registerSW();

        console.log('🎵 Sonora Music v7.17.1 — Ready!');
      })
      .catch(function (err) {
        console.error('[App] Boot error:', err);
        // Still show the app even if something fails
        var app = $('#app');
        if (app) app.classList.remove('app-hidden');
        if (splashScreen) splashScreen.classList.add('hidden');

        // Try to show home page anyway
        setupRoutes();
        bindEvents();
        Sonora.Router.start();
      });
  }

  /* ── Service Worker registration ── */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // En file:// (APK) y tauri:// no hay Service Worker; en web usamos una
    // ruta relativa para que también funcione si la app se sirve en un subpath.
    if (!/^https?:$/.test(window.location.protocol)) return;
    var swUrl;
    try { swUrl = new URL('sw.js', document.baseURI).href; }
    catch (e) { swUrl = 'sw.js'; }
    navigator.serviceWorker.register(swUrl)
      .then(function (reg) {
        console.log('[App] Service Worker registered', reg.scope);
        reg.onupdatefound = function () {
          var installingWorker = reg.installing;
          if (installingWorker) {
            installingWorker.onstatechange = function () {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                Sonora.Store.emit('toast', { message: 'Nueva versión disponible. Recarga la página.', type: 'info' });
              }
            };
          }
        };
      })
      .catch(function (err) {
        console.warn('[App] SW registration failed:', err);
      });
  }

  /* ── Global error handler — prevent crashes ── */
  window.addEventListener('error', function (e) {
    console.error('[App] Uncaught error:', e.error || e.message);
    // Don't crash the app
    return true;
  });

  window.addEventListener('unhandledrejection', function (e) {
    console.warn('[App] Unhandled promise rejection:', e.reason);
    e.preventDefault();
  });

  /* ── Start the app ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
