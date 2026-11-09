/**
 * Sonora Music — Desktop & Spotify-Style Features Controller
 * - Left Sidebar Quick Playlists (Spotify desktop style)
 * - Persistent Desktop Bottom Player Bar
 * - Modo Pantalla Completa Total (Synced Lyrics + Video/Audio toggle + Idle Mode)
 * - Floating Mini-Player Widget (Vinyl disc, vertical lyrics, horizontal bar)
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};
  Sonora.Desktop = Sonora.Desktop || {};

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function formatTime(sec) {
    if (isNaN(sec) || sec === null || sec === undefined) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────────
     1. LEFT SIDEBAR QUICK PLAYLISTS (Spotify Desktop style)
     ───────────────────────────────────────────────────────────── */
  var Sidebar = {
    init: function () {
      var sidebarScroll = $('#sidebar-playlists-scroll');
      if (!sidebarScroll) return;

      this.render();

      var self = this;
      setTimeout(function () { self.render(); }, 400);
      setTimeout(function () { self.render(); }, 1200);
      setTimeout(function () { self.render(); }, 2500);

      if (Sonora.Store && typeof Sonora.Store.on === 'function') {
        Sonora.Store.on('playlistsChanged', function () { self.render(); });
        Sonora.Store.on('trackFavorited', function () { self.updateFavCount(); });
      }

      var favItem = $('#sidebar-fav-item');
      if (favItem) {
        favItem.onclick = function () {
          window.location.hash = '#/library';
          setTimeout(function () {
            var tabBtn = document.querySelector('.library-tab-btn[data-tab="favoritos"]');
            if (tabBtn) tabBtn.click();
          }, 100);
        };
      }

      var addBtn = $('#sidebar-add-playlist-btn');
      if (addBtn) {
        addBtn.onclick = function () {
          window.location.hash = '#/playlists';
          setTimeout(function () {
            // El FAB real de la página de playlists es #btn-fab-create.
            var btn = document.getElementById('btn-fab-create') ||
              document.getElementById('btn-create-playlist') ||
              document.querySelector('[data-action="create-playlist"]');
            if (btn) {
              btn.click();
            } else {
              var modal = document.getElementById('modal-create-playlist');
              if (modal) modal.classList.add('active');
            }
          }, 260);
        };
      }
    },

    updateFavCount: async function () {
      try {
        if (Sonora.DB && Sonora.DB.tracks) {
          var all = await Sonora.DB.tracks.getAll();
          var favs = (all || []).filter(function (t) { return t.isFavorite; });
          var countEl = $('#sidebar-fav-count');
          if (countEl) countEl.textContent = favs.length + ' canciones';
        }
      } catch (e) {}
    },

    render: async function () {
      var container = $('#sidebar-playlists-scroll');
      if (!container) return;

      // El sidebar se inicializa al cargar el DOM, antes de que boot() termine
      // de abrir IndexedDB. Esperamos a que esté lista en vez de fallar con
      // "Cannot read properties of null (reading 'transaction')".
      if (Sonora.DB && typeof Sonora.DB.whenReady === 'function') {
        try { await Sonora.DB.whenReady(); } catch (e) { return; }
      } else if (!Sonora.DB || !Sonora.DB.playlists) {
        return;
      }

      this.updateFavCount();

      try {
        var playlists = [];
        if (Sonora.DB && Sonora.DB.playlists) {
          playlists = await Sonora.DB.playlists.getAll();
        }
        if (!playlists || !playlists.length) {
          container.innerHTML = `
            <div style="font-size:11px;color:rgba(255,255,255,0.4);padding:8px;line-height:1.4;">
              Crea tu primera lista pulsando el botón <strong>+</strong>
            </div>
          `;
          return;
        }

        container.innerHTML = playlists.map(function (p) {
          var count = (p.trackIds || p.tracks || []).length;
          var cover = p.coverUrl || p.artworkUrl || '';
          return `
            <div class="sidebar-playlist-row" data-playlist-id="${p.id}" title="${escHtml(p.name)}">
              <div class="sidebar-playlist-thumb">
                ${cover ? `<img src="${cover}" alt="${escHtml(p.name)}" />` : `<span>🎵</span>`}
              </div>
              <div class="sidebar-playlist-meta">
                <span class="sidebar-playlist-name">${escHtml(p.name)}</span>
                <span class="sidebar-playlist-info">Playlist · ${count} canciones</span>
              </div>
            </div>
          `;
        }).join('');

        // Bind clicks
        container.querySelectorAll('.sidebar-playlist-row').forEach(function (row) {
          row.onclick = function () {
            var pid = row.getAttribute('data-playlist-id');
            if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
              Sonora.Router.navigate('/playlists/' + pid);
            } else {
              window.location.hash = '#/playlists/' + pid;
            }
          };
        });
      } catch (e) {
        console.warn('[DesktopUI] Sidebar playlists load error:', e);
      }
    }
  };

  /* ─────────────────────────────────────────────────────────────
     2. SPOTIFY-STYLE FULLSCREEN MODE (Lyrics + Video + Idle Mode)
     ───────────────────────────────────────────────────────────── */
  var Fullscreen = {
    isOpen: false,
    isVideoMode: false,
    idleTimer: null,
    currentLyrics: [],
    activeLyricIndex: -1,

    init: function () {
      var self = this;
      var overlay = $('#fullscreen-overlay');
      if (!overlay) return;

      // Exit buttons
      var exitBtn = $('#fs-exit-btn');
      var closeTop = $('#fs-close-top-btn');
      if (exitBtn) exitBtn.onclick = function () { self.close(); };
      if (closeTop) closeTop.onclick = function () { self.close(); };

      // Keyboard listener (Esc closes, F enters/exits fullscreen)
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.isOpen) {
          self.close();
        } else if ((e.key === 'f' || e.key === 'F') && !e.target.matches('input, textarea')) {
          if (self.isOpen) self.close();
          else self.open();
        }
      });

      // Mousemove listener for Idle Mode
      overlay.addEventListener('mousemove', function () {
        self.resetIdleTimer();
      });
      overlay.addEventListener('mousedown', function () {
        self.resetIdleTimer();
      });

      // Video ↔ Music Toggle Button
      var modeToggleBtn = $('#fs-mode-toggle-btn');
      if (modeToggleBtn) {
        modeToggleBtn.onclick = function () {
          self.toggleVideoMode();
        };
      }

      // Playback Controls
      var playBtn = $('#fs-play-btn');
      var prevBtn = $('#fs-prev-btn');
      var nextBtn = $('#fs-next-btn');
      var shuffleBtn = $('#fs-shuffle-btn');
      var repeatBtn = $('#fs-repeat-btn');
      var favBtn = $('#fs-fav-btn');

      if (playBtn) {
        playBtn.onclick = function () {
          if (Sonora.Player) {
            if (typeof Sonora.Player.togglePlay === 'function') Sonora.Player.togglePlay();
            else if (typeof Sonora.Player.toggle === 'function') Sonora.Player.toggle();
            else if (Sonora.Player.isPlaying && Sonora.Player.isPlaying()) Sonora.Player.pause();
            else if (Sonora.Player.resume) Sonora.Player.resume();
          }
        };
      }
      if (prevBtn) prevBtn.onclick = function () { Sonora.Player && Sonora.Player.prev(); };
      if (nextBtn) nextBtn.onclick = function () { Sonora.Player && Sonora.Player.next(); };
      if (shuffleBtn) shuffleBtn.onclick = function () { Sonora.Player && Sonora.Player.toggleShuffle(); };
      if (repeatBtn) {
        repeatBtn.onclick = function () {
          if (Sonora.Player && typeof Sonora.Player.cycleRepeat === 'function') {
            var mode = Sonora.Player.cycleRepeat();
            self.updateRepeatState(mode);
          }
        };
      }
      if (favBtn) favBtn.onclick = function () {
        var track = Sonora.Player && Sonora.Player.getCurrentTrack();
        if (track && Sonora.Player.toggleFavorite) Sonora.Player.toggleFavorite(track);
      };

      // Timeline scrub & drag
      var trackBar = $('#fs-progress-track');
      if (trackBar) {
        var isScrubbing = false;

        var doSeek = function (clientX) {
          var rect = trackBar.getBoundingClientRect();
          var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          var fillEl = $('#fs-progress-fill');
          if (fillEl) fillEl.style.width = (pct * 100) + '%';
          if (Sonora.Player) {
            if (typeof Sonora.Player.seekPercent === 'function') {
              Sonora.Player.seekPercent(pct);
            } else if (typeof Sonora.Player.seek === 'function') {
              var prog = Sonora.Player.getProgress ? Sonora.Player.getProgress() : null;
              var dur = (prog && prog.duration) || 0;
              if (dur > 0) Sonora.Player.seek(pct * dur);
            }
          }
        };

        trackBar.addEventListener('mousedown', function (e) {
          isScrubbing = true;
          doSeek(e.clientX);
          var onMove = function (ev) {
            if (isScrubbing) doSeek(ev.clientX);
          };
          var onUp = function () {
            isScrubbing = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });

        trackBar.addEventListener('touchstart', function (e) {
          if (e.touches && e.touches[0]) {
            isScrubbing = true;
            doSeek(e.touches[0].clientX);
          }
        }, { passive: true });
        trackBar.addEventListener('touchmove', function (e) {
          if (isScrubbing && e.touches && e.touches[0]) {
            doSeek(e.touches[0].clientX);
          }
        }, { passive: true });
        trackBar.addEventListener('touchend', function () {
          isScrubbing = false;
        }, { passive: true });
      }

      // Volume slider
      var volSlider = $('#fs-volume-slider');
      if (volSlider) {
        volSlider.oninput = function (e) {
          var val = parseFloat(e.target.value) / 100;
          if (Sonora.Player && Sonora.Player.setVolume) {
            Sonora.Player.setVolume(val);
          }
        };
      }

      // Subscribe to player state changes
      if (Sonora.Store) {
        Sonora.Store.subscribe('currentTrack', function (track) {
          if (self.isOpen) self.updateTrack(track);
        });
        Sonora.Store.subscribe('isPlaying', function (playing) {
          if (self.isOpen) self.updatePlayState(playing);
        });
        Sonora.Store.subscribe('progress', function (prog) {
          if (self.isOpen) self.updateProgress(prog);
        });
        Sonora.Store.subscribe('shuffle', function (shuf) {
          var btn = $('#fs-shuffle-btn');
          if (btn) btn.style.color = shuf ? 'var(--color-primary, #FF4757)' : 'rgba(255,255,255,0.6)';
        });
        Sonora.Store.subscribe('repeatMode', function (rep) {
          self.updateRepeatState(rep);
        });
        Sonora.Store.on('lyricsOffsetChanged', function (data) {
          if (self.isOpen && self._lyricsSync && data) {
            self._lyricsSync.setOffset(Number(data.offset) || 0);
          }
        });
      }
    },

    updateRepeatState: function (rep) {
      var btn = $('#fs-repeat-btn');
      if (!btn) return;
      var mode = rep || (Sonora.Player && typeof Sonora.Player.getRepeatMode === 'function' ? Sonora.Player.getRepeatMode() : 'off');
      btn.classList.remove('repeat-one', 'repeat-all');

      if (mode === 'one') {
        btn.classList.add('repeat-one');
        btn.style.color = 'var(--color-primary, #FF4757)';
        btn.title = 'Repetir en bucle: Canción actual';
        var badge = btn.querySelector('.fs-repeat-one-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'fs-repeat-one-badge';
          badge.textContent = '1';
          badge.style.cssText = 'position:absolute;font-size:9px;font-weight:900;bottom:1px;right:1px;background:var(--color-primary,#FF4757);color:#fff;border-radius:50%;width:13px;height:13px;display:flex;align-items:center;justify-content:center;line-height:1;';
          btn.style.position = 'relative';
          btn.appendChild(badge);
        }
      } else if (mode === 'all') {
        btn.classList.add('repeat-all');
        btn.style.color = 'var(--color-primary, #FF4757)';
        btn.title = 'Repetir toda la cola';
        var badgeAll = btn.querySelector('.fs-repeat-one-badge');
        if (badgeAll) badgeAll.remove();
      } else {
        btn.style.color = 'rgba(255,255,255,0.6)';
        btn.title = 'Repetición desactivada';
        var badgeOff = btn.querySelector('.fs-repeat-one-badge');
        if (badgeOff) badgeOff.remove();
      }
    },

    open: function () {
      var overlay = $('#fullscreen-overlay');
      if (!overlay) return;

      this.isOpen = true;
      overlay.classList.remove('hidden');
      document.body.classList.add('in-fullscreen-mode');

      // Request browser fullscreen if available
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(function () {});
        }
      } catch (e) {}

      var track = Sonora.Player ? Sonora.Player.getCurrentTrack() : null;
      this.updateTrack(track);
      this.updatePlayState(Sonora.Player ? Sonora.Player.isPlaying() : false);

      // Inmediata sincronización de progreso y barra de tiempo al abrir
      if (Sonora.Player) {
        var prog = null;
        if (typeof Sonora.Player.getProgress === 'function') {
          prog = Sonora.Player.getProgress();
        } else {
          var cur = (Sonora.Player.getCurrentTime ? Sonora.Player.getCurrentTime() : 0);
          var dur = (track && track.duration) || (Sonora.Player.getDuration ? Sonora.Player.getDuration() : 0);
          prog = { current: cur, duration: dur, percent: dur > 0 ? (cur / dur) * 100 : 0 };
        }
        if (prog) this.updateProgress(prog);

        // Sincronización inmediata de botones (Shuffle, Repeat, Favorito, Volumen)
        var isShuf = typeof Sonora.Player.isShuffled === 'function' ? Sonora.Player.isShuffled() : false;
        var shufBtn = $('#fs-shuffle-btn');
        if (shufBtn) shufBtn.style.color = isShuf ? 'var(--color-primary, #FF4757)' : 'rgba(255,255,255,0.6)';

        var repMode = typeof Sonora.Player.getRepeatMode === 'function' ? Sonora.Player.getRepeatMode() : 'off';
        this.updateRepeatState(repMode);

        var favBtn = $('#fs-fav-btn');
        if (favBtn && track) {
          favBtn.style.color = track.isFavorite ? 'var(--color-primary, #FF4757)' : 'rgba(255,255,255,0.6)';
        }

        var vol = typeof Sonora.Player.getVolume === 'function' ? Sonora.Player.getVolume() : 0.8;
        var volSlider = $('#fs-volume-slider');
        if (volSlider) volSlider.value = Math.round(vol * 100);
      }

      this.resetIdleTimer();
    },

    close: function () {
      var overlay = $('#fullscreen-overlay');
      if (!overlay) return;

      this.isOpen = false;
      overlay.classList.add('hidden');
      overlay.classList.remove('is-idle');
      document.body.classList.remove('in-fullscreen-mode');

      // Detener el bucle de sincronización de letras al cerrar.
      this._lyricsSeq = (this._lyricsSeq || 0) + 1;
      this.destroyLyricsSync();

      if (this.idleTimer) clearTimeout(this.idleTimer);

      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(function () {});
        }
      } catch (e) {}
    },

    resetIdleTimer: function () {
      var overlay = $('#fullscreen-overlay');
      if (!overlay) return;

      overlay.classList.remove('is-idle');
      if (this.idleTimer) clearTimeout(this.idleTimer);

      var self = this;
      this.idleTimer = setTimeout(function () {
        if (self.isOpen) {
          overlay.classList.add('is-idle');
        }
      }, 3500);
    },

    toggleVideoMode: function () {
      this.isVideoMode = !this.isVideoMode;
      var label = $('#fs-mode-toggle-label');
      var toggleBtn = $('#fs-mode-toggle-btn');
      var videoContainer = $('#fs-video-container');
      var artworkImg = $('#fs-artwork-img');

      if (toggleBtn) toggleBtn.classList.toggle('active', this.isVideoMode);
      if (label) label.textContent = this.isVideoMode ? 'Modo Música' : 'Modo Video';

      if (this.isVideoMode) {
        if (artworkImg) artworkImg.classList.add('hidden');
        if (videoContainer) {
          videoContainer.classList.remove('hidden');
          this.mountVideoPlayer();
        }
      } else {
        if (artworkImg) artworkImg.classList.remove('hidden');
        if (videoContainer) videoContainer.classList.add('hidden');
      }
    },

    mountVideoPlayer: function () {
      var container = $('#fs-video-container');
      var track = Sonora.Player ? Sonora.Player.getCurrentTrack() : null;
      if (!container || !track) return;

      var vidId = track.videoId || (track.id && String(track.id).startsWith('yt_') ? String(track.id).replace('yt_', '') : '');
      if (vidId) {
        container.innerHTML = `
          <iframe
            src="https://www.youtube-nocookie.com/embed/${vidId}?autoplay=1&enablejsapi=1&playsinline=1"
            title="Video Player"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen>
          </iframe>
        `;
      } else if (track.streamUrl) {
        container.innerHTML = `
          <video src="${track.streamUrl}" controls autoplay playsinline style="width:100%;height:100%;object-fit:contain;"></video>
        `;
      } else {
        container.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff;font-size:14px;">
            🎬 Video no disponible para esta canción
          </div>
        `;
      }
    },

    updateTrack: async function (track) {
      if (!track) return;

      var titleEl = $('#fs-track-title');
      var artistEl = $('#fs-track-artist');
      var artImg = $('#fs-artwork-img');
      var bgAmbient = $('#fs-bg-ambient');
      var favBtn = $('#fs-fav-btn');

      if (titleEl) titleEl.textContent = track.title || 'Sonora Music';
      if (artistEl) artistEl.textContent = track.artist || '';

      var art = track.artworkUrl || '';
      if (artImg) artImg.src = art;
      if (bgAmbient && art) bgAmbient.style.backgroundImage = 'url("' + art + '")';

      if (favBtn) {
        favBtn.style.color = track.isFavorite ? 'var(--color-primary, #FF4757)' : 'rgba(255,255,255,0.6)';
      }

      // Check if track has video
      var toggleBtn = $('#fs-mode-toggle-btn');
      var hasVid = !!(track.videoId || (track.id && String(track.id).startsWith('yt_')));
      if (toggleBtn) {
        toggleBtn.style.display = hasVid ? 'inline-flex' : 'none';
      }

      // Load lyrics
      await this.loadLyrics(track);
    },

    loadLyrics: async function (track) {
      var linesContainer = $('#fs-lyrics-lines');
      if (!linesContainer) return;

      this.destroyLyricsSync();

      var self = this;
      var seq = (this._lyricsSeq || 0) + 1;
      this._lyricsSeq = seq;
      this.currentLyrics = [];
      this.activeLyricIndex = -1;

      if (!track) {
        linesContainer.innerHTML = '<div style="text-align:center;padding:40px 0;color:rgba(255,255,255,0.5);font-size:1.4rem;">No hay una canción reproduciéndose</div>';
        return;
      }

      var hasRendered = false;

      function render(result) {
        if (seq !== self._lyricsSeq || !result) return;

        if (result.syncedLyrics) {
          var lines = Sonora.Lyrics.parse(result.syncedLyrics);
          if (lines.length) {
            self.renderSyncedLyrics(lines, track);
            hasRendered = true;
            return;
          }
        }

        if (result.plainLyrics) {
          self.renderPlainLyrics(result.plainLyrics);
          hasRendered = true;
        }
      }

      linesContainer.innerHTML =
        '<div style="font-size:1.6rem;color:rgba(255,255,255,0.6);animation:sonora-pulse 1s infinite;">Buscando letra…</div>' +
        '<div style="font-size:.9rem;color:rgba(255,255,255,0.35);margin-top:10px;">Sincronizada con la voz, no con la duración</div>';

      try {
        var result = await Sonora.Lyrics.resolve(track, {
          onPartial: function (partial) {
            if (seq === self._lyricsSeq) render(partial);
          }
        });

        if (seq !== self._lyricsSeq) return;
        if (result) render(result);
        if (!hasRendered) self.renderNoLyrics(track);
      } catch (e) {
        console.warn('[Fullscreen] Lyrics error:', e);
        if (seq === self._lyricsSeq && !hasRendered) self.renderNoLyrics(track);
      }
    },

    destroyLyricsSync: function () {
      if (this._lyricsSync && typeof this._lyricsSync.destroy === 'function') {
        try { this._lyricsSync.destroy(); } catch (e) {}
      }
      this._lyricsSync = null;
      this.setLyricsSyncVisible(false);
      if (typeof PiP !== 'undefined' && PiP && typeof PiP.updateLyric === 'function') {
        PiP.updateLyric('', '');
      }
    },

    /** Muestra u oculta el botón "Sincronizar" de la letra a pantalla completa. */
    setLyricsSyncVisible: function (visible) {
      var btn = $('#fs-lyrics-sync');
      if (btn) btn.classList.toggle('hidden', !visible);
    },

    renderSyncedLyrics: function (lines, track) {
      var container = $('#fs-lyrics-lines');
      var scroller = $('#fs-lyrics-scroller');
      if (!container) return;

      this.destroyLyricsSync();
      this.currentLyrics = lines;
      this.activeLyricIndex = -1;

      var lineEls = Sonora.Lyrics.renderLines(container, lines, {
        lineClass: 'fs-lyric-item',
        idPrefix: 'fs-lyric-',
        tail: false,
        wordSync: true
      });

      // Espacio inferior para poder centrar las últimas líneas.
      if (!container.querySelector('.fs-lyrics-tail')) {
        var tail = document.createElement('div');
        tail.className = 'fs-lyrics-tail';
        tail.style.height = '38vh';
        tail.style.flex = '0 0 auto';
        container.appendChild(tail);
      }

      var self = this;
      var syncBtn = $('#fs-lyrics-sync');
      if (syncBtn) {
        syncBtn.classList.add('hidden');
        syncBtn.onclick = function () {
          if (self._lyricsSync && typeof self._lyricsSync.recenter === 'function') {
            self._lyricsSync.recenter();
          }
          syncBtn.classList.add('hidden');
        };
      }

      container.querySelectorAll('.fs-lyric-item').forEach(function (el) {
        el.onclick = function () {
          var time = parseFloat(el.getAttribute('data-time'));
          if (!isNaN(time) && Sonora.Player && Sonora.Player.seek) {
            Sonora.Player.seek(time);
          }
        };
      });

      var getTime = function () {
        if (Sonora.Player && typeof Sonora.Player.getCurrentTime === 'function') {
          return Number(Sonora.Player.getCurrentTime()) || 0;
        }
        var progress = Sonora.Player && Sonora.Player.getProgress
          ? Sonora.Player.getProgress() : null;
        return progress ? Number(progress.current) || 0 : 0;
      };

      this._lyricsSync = Sonora.Lyrics.createSync({
        container: container,
        scrollTarget: scroller || container,
        lines: lines,
        lineEls: lineEls,
        offset: Sonora.Lyrics.getOffset(track),
        autoScroll: true,
        getTime: getTime,
        onUserScroll: function () {
          self.setLyricsSyncVisible(true);
        },
        onActive: function (index) {
          self.activeLyricIndex = index;
          var line = lines[index];
          var next = lines[index + 1];
          var currentText = line ? line.text : '';
          var nextText = next ? next.text : '';
          if (PiP && typeof PiP.updateLyric === 'function') {
            PiP.updateLyric(currentText, nextText);
          }
          if (PiP && PiP.channel) {
            try {
              PiP.channel.postMessage({
                type: 'lyric',
                data: {
                  currentText: currentText,
                  nextText: nextText
                }
              });
            } catch (e) {}
          }
        }
      });
    },

    renderPlainLyrics: function (text) {
      var container = $('#fs-lyrics-lines');
      if (!container) return;

      this.destroyLyricsSync();
      this.currentLyrics = [];
      this.activeLyricIndex = -1;

      var lines = Sonora.Lyrics.plainLines(text);
      container.innerHTML =
        '<div style="text-align:center;margin-bottom:12px;font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:.06em;text-transform:uppercase;">Letra sin sincronizar · buscando versión sincronizada…</div>' +
        lines.map(function (line) {
          return '<div class="fs-lyric-item fs-lyric-plain">' + escHtml(line) + '</div>';
        }).join('');
    },

    renderNoLyrics: function (track) {
      var container = $('#fs-lyrics-lines');
      if (!container) return;

      this.destroyLyricsSync();
      this.currentLyrics = [];
      this.activeLyricIndex = -1;

      container.innerHTML =
        '<div style="text-align:center;padding:40px 0;color:rgba(255,255,255,0.5);">' +
          '<div style="font-size:3rem;margin-bottom:14px;">🎶</div>' +
          '<div style="font-size:1.8rem;font-weight:700;color:#fff;">Sintiendo el ritmo</div>' +
          '<div style="font-size:1.2rem;margin-top:6px;margin-bottom:18px;">No hay letra disponible para esta canción</div>' +
          '<button id="fs-retry-lyrics-btn" class="btn" style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:20px;padding:6px 18px;font-size:12px;font-weight:700;cursor:pointer;">' +
            '🔄 Reintentar búsqueda de letra' +
          '</button>' +
        '</div>';

      var self = this;
      var retryBtn = $('#fs-retry-lyrics-btn');
      if (retryBtn) {
        retryBtn.onclick = function () {
          if (track && Sonora.Lyrics) Sonora.Lyrics.forget(track);
          self.loadLyrics(track);
        };
      }
    },

    parseLrc: function (lrcText) {
      return (Sonora.Lyrics && typeof Sonora.Lyrics.parse === 'function')
        ? Sonora.Lyrics.parse(lrcText)
        : [];
    },

    updatePlayState: function (playing) {
      var icon = $('#fs-play-icon');
      if (icon) {
        icon.setAttribute('d', playing ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z');
      }
    },

    updateProgress: function (prog) {
      if (!prog) return;

      var curEl = $('#fs-time-current');
      var durEl = $('#fs-time-duration');
      var fillEl = $('#fs-progress-fill');

      if (curEl) curEl.textContent = formatTime(prog.current || 0);
      if (durEl) durEl.textContent = formatTime(prog.duration || 0);

      var pctVal = 0;
      if (typeof prog.percent === 'number') {
        pctVal = prog.percent > 1 ? prog.percent : (prog.percent * 100);
      } else if (prog.duration > 0) {
        pctVal = ((prog.current || 0) / prog.duration) * 100;
      }
      if (fillEl) fillEl.style.width = Math.min(100, Math.max(0, pctVal)) + '%';

      // El resaltado y el scroll de la letra los controla Sonora.Lyrics
      // con requestAnimationFrame y los timestamps reales del LRC.
    }
  };

  /* ─────────────────────────────────────────────────────────────
     3. FLOATING PIP MINI-PLAYER (Vinyl Disc, Vertical, Bar)
     ───────────────────────────────────────────────────────────── */
  var PiP = {
    isOpen: false,
    mode: 'bar', // 'disc' | 'vertical' | 'bar'
    isDragging: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    channel: null,

    init: function () {
      var self = this;

      // Broadcast channel para sincronizar con la ventana flotante nativa (pip.html)
      try {
        this.channel = new BroadcastChannel('sonora_playback');
        this.channel.onmessage = function (e) {
          var msg = e.data || {};
          if (!Sonora.Player) return;
          if (msg.action === 'toggle') {
            Sonora.Player.togglePlay();
          } else if (msg.action === 'play') {
            Sonora.Player.play();
          } else if (msg.action === 'pause') {
            Sonora.Player.pause();
          } else if (msg.action === 'prev') {
            if (typeof Sonora.Player.previous === 'function') Sonora.Player.previous();
            else if (typeof Sonora.Player.prev === 'function') Sonora.Player.prev();
          } else if (msg.action === 'next') {
            Sonora.Player.next();
          } else if (msg.action === 'seek' && typeof msg.data === 'number') {
            Sonora.Player.seek(msg.data);
          } else if (msg.action === 'requestState') {
            self.broadcastState();
          }
        };
      } catch (e) {}

      var widget = $('#floating-pip-widget');
      if (!widget) return;

      // Restore position & mode
      try {
        var savedMode = localStorage.getItem('sonora_pip_mode');
        if (savedMode) this.mode = savedMode;
        var savedPos = JSON.parse(localStorage.getItem('sonora_pip_pos') || 'null');
        if (savedPos) {
          widget.style.left = savedPos.x + 'px';
          widget.style.top = savedPos.y + 'px';
          widget.style.right = 'auto';
          widget.style.bottom = 'auto';
        } else {
          widget.style.right = '24px';
          widget.style.bottom = '100px';
        }
      } catch (e) {}

      this.setMode(this.mode);

      // Bind close buttons
      var closeBtns = [$('#pip-close-btn-vert'), $('#pip-close-btn-bar')];
      closeBtns.forEach(function (b) {
        if (b) b.onclick = function () { self.close(); };
      });

      // Bind mode switch buttons
      $$('.pip-mode-btn').forEach(function (btn) {
        btn.onclick = function () {
          var m = btn.getAttribute('data-pip-mode');
          if (m) self.setMode(m);
        };
      });

      // Disc expand button
      var discExpand = $('#pip-disc-expand-btn');
      if (discExpand) {
        discExpand.onclick = function (e) {
          e.stopPropagation();
          self.setMode('bar');
        };
      }

      // Disc click: toggle play/pause with vinyl brake effect
      var vinylDisc = $('#pip-disc-view');
      if (vinylDisc) {
        vinylDisc.onclick = function () {
          var vinyl = $('#pip-vinyl');
          if (Sonora.Player && Sonora.Player.isPlaying && Sonora.Player.isPlaying()) {
            if (vinyl) {
              vinyl.classList.remove('spinning');
              vinyl.classList.add('braking');
            }
            Sonora.Player.pause();
          } else {
            if (vinyl) {
              vinyl.classList.remove('braking');
              vinyl.classList.add('spinning');
            }
            Sonora.Player && Sonora.Player.play();
          }
        };
      }

      // Play/pause controls
      var playBtns = [$('#pip-vert-play'), $('#pip-bar-play')];
      playBtns.forEach(function (b) {
        if (b) b.onclick = function () { Sonora.Player && Sonora.Player.togglePlay(); };
      });

      // Prev/next
      var prevBtns = [$('#pip-vert-prev'), $('#pip-bar-prev')];
      prevBtns.forEach(function (b) {
        if (b) b.onclick = function () { Sonora.Player && Sonora.Player.prev(); };
      });
      var nextBtns = [$('#pip-vert-next'), $('#pip-bar-next')];
      nextBtns.forEach(function (b) {
        if (b) b.onclick = function () { Sonora.Player && Sonora.Player.next(); };
      });

      // Drag support
      this.bindDrag($('#pip-drag-bar-vert'));
      this.bindDrag($('#pip-drag-bar-horiz'));
      this.bindDrag($('#pip-disc-view'));

      // Subscribe to player state
      if (Sonora.Store) {
        Sonora.Store.subscribe('currentTrack', function (t) {
          self.updateTrack(t);
          if (self.channel) self.channel.postMessage({ type: 'track', track: t });
        });
        Sonora.Store.subscribe('isPlaying', function (p) {
          self.updatePlayState(p);
          if (self.channel) self.channel.postMessage({ type: 'playState', isPlaying: p });
        });
        Sonora.Store.subscribe('progress', function (prog) {
          self.updateProgress(prog);
          if (self.channel) self.channel.postMessage({ type: 'progress', progress: prog });
        });
      }
    },

    bindDrag: function (handleEl) {
      if (!handleEl) return;
      var widget = $('#floating-pip-widget');
      var self = this;

      function onMouseDown(e) {
        if (e.target.closest('button')) return;
        self.isDragging = true;
        self.startX = e.clientX;
        self.startY = e.clientY;
        var rect = widget.getBoundingClientRect();
        self.initialX = rect.left;
        self.initialY = rect.top;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }

      function onMouseMove(e) {
        if (!self.isDragging) return;
        var dx = e.clientX - self.startX;
        var dy = e.clientY - self.startY;
        var nx = Math.max(10, Math.min(window.innerWidth - widget.offsetWidth - 10, self.initialX + dx));
        var ny = Math.max(10, Math.min(window.innerHeight - widget.offsetHeight - 10, self.initialY + dy));
        widget.style.left = nx + 'px';
        widget.style.top = ny + 'px';
        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
      }

      function onMouseUp() {
        if (self.isDragging) {
          self.isDragging = false;
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          try {
            var rect = widget.getBoundingClientRect();
            localStorage.setItem('sonora_pip_pos', JSON.stringify({ x: rect.left, y: rect.top }));
          } catch (e) {}
        }
      }

      handleEl.addEventListener('mousedown', onMouseDown);
    },

    setMode: function (mode) {
      var widget = $('#floating-pip-widget');
      if (!widget) return;

      this.mode = mode;
      widget.className = 'pip-widget mode-' + mode;
      if (!this.isOpen) widget.classList.add('hidden');

      try {
        localStorage.setItem('sonora_pip_mode', mode);
      } catch (e) {}
    },

    broadcastState: function () {
      if (!this.channel) return;
      var t = Sonora.Player ? Sonora.Player.getCurrentTrack() : null;
      var p = Sonora.Player ? Sonora.Player.isPlaying() : false;
      var prog = Sonora.Player && typeof Sonora.Player.getProgress === 'function' ? Sonora.Player.getProgress() : null;
      if (t) this.channel.postMessage({ type: 'track', track: t });
      this.channel.postMessage({ type: 'playState', isPlaying: p });
      if (prog) this.channel.postMessage({ type: 'progress', progress: prog });
    },

    open: function () {
      var widget = $('#floating-pip-widget');
      if (widget) {
        this.isOpen = true;
        widget.classList.remove('hidden');
        var track = Sonora.Player ? Sonora.Player.getCurrentTrack() : null;
        this.updateTrack(track);
        this.updatePlayState(Sonora.Player ? Sonora.Player.isPlaying() : false);
      }
      this.broadcastState();
    },

    close: function () {
      var widget = $('#floating-pip-widget');
      if (widget) {
        this.isOpen = false;
        widget.classList.add('hidden');
      }
    },

    toggle: function () {
      // Si estamos en la app de escritorio de macOS (Tauri), invocamos la ventana flotante nativa Always-On-Top
      if (window.__TAURI__ || window.__TAURI_INTERNALS__) {
        try {
          var invoke = (window.__TAURI__.core && window.__TAURI__.core.invoke) || window.__TAURI__.invoke;
          if (typeof invoke === 'function') {
            invoke('toggle_pip_window');
            this.broadcastState();
            return;
          }
        } catch (e) {
          console.warn('[PiP] Tauri toggle failed:', e);
        }
      }

      // En la web / navegador tradicional, abrimos el widget flotante en pantalla
      if (this.isOpen) this.close();
      else this.open();
    },

    updateTrack: function (track) {
      if (!track) return;
      var art = track.artworkUrl || '';

      // La letra pertenece a la canción anterior: no dejamos versos viejos.
      this.updateLyric('', '');

      // Disc artwork
      var vinylImg = $('#pip-vinyl-img');
      if (vinylImg && art) vinylImg.src = art;

      // Vertical artwork + titles
      var vertImg = $('#pip-vert-artwork');
      var vertTitle = $('#pip-vert-title');
      var vertArtist = $('#pip-vert-artist');
      if (vertImg && art) vertImg.src = art;
      if (vertTitle) vertTitle.textContent = track.title || 'Sonora';
      if (vertArtist) vertArtist.textContent = track.artist || '';

      // Bar artwork + titles
      var barImg = $('#pip-bar-artwork');
      var barTitle = $('#pip-bar-title');
      var barArtist = $('#pip-bar-artist');
      if (barImg && art) barImg.src = art;
      if (barTitle) barTitle.textContent = track.title || 'Sonora';
      if (barArtist) barArtist.textContent = track.artist || '';
    },

    /** Letra actual y siguiente, tal y como llegan del motor de letras. */
    updateLyric: function (currentText, nextText) {
      var cur = $('#pip-vert-lyric');
      var nxt = $('#pip-vert-lyric-next');
      if (cur) cur.textContent = currentText || '';
      if (nxt) nxt.textContent = nextText || '';
    },

    updatePlayState: function (playing) {
      var vinyl = $('#pip-vinyl');
      if (vinyl) {
        if (playing) {
          vinyl.classList.remove('braking');
          vinyl.classList.add('spinning');
        } else {
          vinyl.classList.remove('spinning');
          vinyl.classList.add('braking');
        }
      }

      var vertIcon = $('#pip-vert-play-icon');
      var barIcon = $('#pip-bar-play-icon');
      var path = playing ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z';
      if (vertIcon) vertIcon.setAttribute('d', path);
      if (barIcon) barIcon.setAttribute('d', path);
    },

    updateProgress: function (prog) {
      if (!prog) return;
      var pctNum = 0;
      if (typeof prog.percent === 'number') {
        pctNum = prog.percent > 1 ? prog.percent : (prog.percent * 100);
      } else if (prog.duration > 0) {
        pctNum = ((prog.current || 0) / prog.duration) * 100;
      }
      var pct = Math.min(100, Math.max(0, pctNum)) + '%';
      var vertFill = $('#pip-vert-progress-fill');
      var barFill = $('#pip-bar-progress-fill');
      if (vertFill) vertFill.style.width = pct;
      if (barFill) barFill.style.width = pct;
    }
  };

  /* ─────────────────────────────────────────────────────────────
     4. DESKTOP BOTTOM BAR WIRING
     ───────────────────────────────────────────────────────────── */
  var DesktopBar = {
    init: function () {
      var self = this;

      // Wire Desktop Player controls
      var playBtn = $('#desktop-play-btn');
      var prevBtn = $('#desktop-prev-btn');
      var nextBtn = $('#desktop-next-btn');
      var shuffleBtn = $('#desktop-shuffle-btn');
      var repeatBtn = $('#desktop-repeat-btn');
      var likeBtn = $('#desktop-like-btn');
      var lyricsBtn = $('#desktop-lyrics-btn');
      var pipBtn = $('#desktop-pip-btn');
      var fsBtn = $('#desktop-fullscreen-btn');
      var queueBtn = $('#desktop-queue-btn');
      var volSlider = $('#desktop-vol-slider');
      var timelineTrack = $('#desktop-timeline-track');

      if (playBtn) playBtn.onclick = function () { Sonora.Player && Sonora.Player.togglePlay(); };
      if (prevBtn) prevBtn.onclick = function () { Sonora.Player && Sonora.Player.prev(); };
      if (nextBtn) nextBtn.onclick = function () { Sonora.Player && Sonora.Player.next(); };
      if (shuffleBtn) shuffleBtn.onclick = function () { Sonora.Player && Sonora.Player.toggleShuffle(); };
      if (repeatBtn) repeatBtn.onclick = function () { Sonora.Player && Sonora.Player.toggleRepeat(); };
      if (likeBtn) likeBtn.onclick = function () {
        var t = Sonora.Player && Sonora.Player.getCurrentTrack();
        if (t && Sonora.Player.toggleFavorite) Sonora.Player.toggleFavorite(t);
      };

      if (lyricsBtn) lyricsBtn.onclick = function () { Fullscreen.open(); };
      if (fsBtn) fsBtn.onclick = function () { Fullscreen.open(); };
      if (pipBtn) pipBtn.onclick = function () { PiP.toggle(); };
      if (queueBtn) queueBtn.onclick = function () {
        var qPanel = $('#queue-panel');
        if (qPanel) qPanel.classList.toggle('hidden');
      };

      if (timelineTrack) {
        timelineTrack.onclick = function (e) {
          var rect = timelineTrack.getBoundingClientRect();
          var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          var t = Sonora.Player && Sonora.Player.getCurrentTrack();
          var dur = (t && t.duration) || 0;
          if (dur > 0 && Sonora.Player && Sonora.Player.seek) {
            Sonora.Player.seek(pct * dur);
          }
        };
      }

      if (volSlider) {
        volSlider.oninput = function (e) {
          var val = parseFloat(e.target.value) / 100;
          if (Sonora.Player && Sonora.Player.setVolume) {
            Sonora.Player.setVolume(val);
          }
        };
      }

      // Title or art click opens full player / lyrics
      var artEl = $('#desktop-art');
      var titleEl = $('#desktop-title');
      if (artEl) artEl.onclick = function () { Fullscreen.open(); };
      if (titleEl) titleEl.onclick = function () { Fullscreen.open(); };

      // Subscriptions
      if (Sonora.Store) {
        Sonora.Store.subscribe('currentTrack', function (t) { self.updateTrack(t); });
        Sonora.Store.subscribe('isPlaying', function (p) { self.updatePlayState(p); });
        Sonora.Store.subscribe('progress', function (prog) { self.updateProgress(prog); });
        Sonora.Store.subscribe('shuffle', function (shuf) {
          if (shuffleBtn) shuffleBtn.classList.toggle('active', !!shuf);
        });
        Sonora.Store.subscribe('repeatMode', function (rep) {
          if (repeatBtn) repeatBtn.classList.toggle('active', rep !== 'off');
        });
        Sonora.Store.subscribe('volume', function (vol) {
          if (volSlider && vol !== undefined) volSlider.value = Math.round(vol * 100);
        });
      }
    },

    updateTrack: function (t) {
      if (!t) return;
      var art = t.artworkUrl || '';
      var artEl = $('#desktop-art');
      var titleEl = $('#desktop-title');
      var artistEl = $('#desktop-artist');
      var likeBtn = $('#desktop-like-btn');

      if (artEl && art) artEl.src = art;
      if (titleEl) titleEl.textContent = t.title || 'Sonora Music';
      if (artistEl) artistEl.textContent = t.artist || '';
      if (likeBtn) likeBtn.classList.toggle('active', !!t.isFavorite);
    },

    updatePlayState: function (playing) {
      var icon = $('#desktop-play-icon');
      if (icon) {
        icon.setAttribute('d', playing ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z');
      }
    },

    updateProgress: function (prog) {
      if (!prog) return;
      var curEl = $('#desktop-time-current');
      var durEl = $('#desktop-time-duration');
      var fillEl = $('#desktop-timeline-fill');

      if (curEl) curEl.textContent = formatTime(prog.current || 0);
      if (durEl) durEl.textContent = formatTime(prog.duration || 0);
      var pctVal = 0;
      if (typeof prog.percent === 'number') {
        pctVal = prog.percent > 1 ? prog.percent : (prog.percent * 100);
      } else if (prog.duration > 0) {
        pctVal = ((prog.current || 0) / prog.duration) * 100;
      }
      if (fillEl) fillEl.style.width = Math.min(100, Math.max(0, pctVal)) + '%';
    }
  };

  /* ─────────────────────────────────────────────────────────────
     EXPORTS & INIT
     ───────────────────────────────────────────────────────────── */
  Sonora.Desktop = {
    Sidebar: Sidebar,
    Fullscreen: Fullscreen,
    PiP: PiP,
    DesktopBar: DesktopBar,
    openFullscreen: function () { Fullscreen.open(); },
    closeFullscreen: function () { Fullscreen.close(); },
    togglePiP: function () { PiP.toggle(); },

    init: function () {
      Sidebar.init();
      Fullscreen.init();
      PiP.init();
      DesktopBar.init();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Sonora.Desktop.init);
  } else {
    Sonora.Desktop.init();
  }
})();
