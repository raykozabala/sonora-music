/**
 * Sonora Music — Reproductor de Video
 * Reproductor propio (proxy del servidor) con respaldo en el iframe de YouTube.
 * Funciones: play/pausa, seek, volumen, velocidad, calidad, subtítulos, bucle,
 * PiP, mini-reproductor, pantalla completa vertical/horizontal y modo offline.
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var POS_PREFIX = 'sonora_video_pos_';
  var VOL_KEY = 'sonora_video_volume';

  var st = {
    video: null,
    opts: {},
    overlay: null,
    stage: null,
    videoEl: null,
    audioEl: null,
    split: false,
    miniEl: null,
    quality: '720p',
    blobUrl: null,
    audioBlobUrl: null,
    subUrls: [],
    iframeMode: false,
    retried: false,
    hideTimer: null,
    saveTimer: null,
    seeking: false,
    panel: null,
    keyHandler: null,
    mini: false,
    closed: false
  };

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function getServerBase() {
    if (Sonora.API && typeof Sonora.API.getActiveUrl === 'function') {
      return String(Sonora.API.getActiveUrl()).replace(/\/+$/, '');
    }
    try {
      if (window.location && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
        return window.location.origin;
      }
    } catch (e) {}
    return 'http://192.168.1.132:3000';
  }

  function formatTime(sec) {
    var total = Math.floor(Number(sec) || 0);
    if (!isFinite(total) || total < 0) total = 0;
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = Math.floor(total % 60);
    if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
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

  function extractYouTubeId(url) {
    if (!url) return '';
    var m = String(url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
    return m ? m[1] : '';
  }

  function targetUrl(video) {
    if (!video) return '';
    if (video.url) return video.url;
    if (video.sourceUrl) return video.sourceUrl;
    if (video.videoId) return 'https://www.youtube.com/watch?v=' + video.videoId;
    return '';
  }

  function streamUrl(video, quality, mode) {
    return getServerBase() + '/api/video/stream?url=' + encodeURIComponent(targetUrl(video)) +
      '&quality=' + encodeURIComponent(quality || '720p') +
      (mode ? '&mode=' + encodeURIComponent(mode) : '');
  }

  function savePosition() {
    if (!st.video || !st.videoEl) return;
    try {
      var t = st.videoEl.currentTime || 0;
      var d = st.videoEl.duration || 0;
      if (t > 3 && (!d || t < d - 8)) {
        localStorage.setItem(POS_PREFIX + (st.video.id || st.video.videoId || 'video'), String(Math.floor(t)));
      } else {
        localStorage.removeItem(POS_PREFIX + (st.video.id || st.video.videoId || 'video'));
      }
    } catch (e) {}
  }

  function savedPosition() {
    try {
      var raw = localStorage.getItem(POS_PREFIX + (st.video.id || st.video.videoId || 'video'));
      return raw ? Number(raw) || 0 : 0;
    } catch (e) { return 0; }
  }

  function toast(message, type) {
    if (Sonora.Store) Sonora.Store.emit('toast', { message: message, type: type || 'info' });
  }

  /* ── Construcción de la interfaz ────────────────────────────────────── */
  function buildOverlay() {
    var video = st.video;
    var overlay = document.createElement('div');
    overlay.id = 'svp-overlay';
    overlay.className = 'svp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Reproductor de video');

    overlay.innerHTML = `
      <div class="svp-topbar">
        <button type="button" class="svp-btn svp-close" aria-label="Cerrar video">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="svp-titles">
          <div class="svp-title">${escapeHtml(video.title || 'Video')}</div>
          <div class="svp-subtitle">${escapeHtml(video.artist || video.channel || 'YouTube')}${video.durationText ? ' • ' + escapeHtml(video.durationText) : ''}</div>
        </div>
        <button type="button" class="svp-btn svp-mini-btn" aria-label="Minimizar video" title="Minimizar">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="9" y1="19" x2="9" y2="21"/></svg>
        </button>
      </div>

      <div class="svp-stage" id="svp-stage">
        <video id="svp-video" class="svp-video" playsinline webkit-playsinline preload="metadata" crossorigin="anonymous"></video>
        <audio id="svp-audio" class="svp-audio" preload="auto" crossorigin="anonymous"></audio>
        <div class="svp-spinner hidden" id="svp-spinner"></div>
        <div class="svp-spinner-text hidden" id="svp-spinner-text">Preparando el video…</div>
        <button type="button" class="svp-bigplay hidden" id="svp-bigplay" aria-label="Reproducir">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        </button>
        <div class="svp-message hidden" id="svp-message">
          <div class="svp-message__icon">⚠️</div>
          <div class="svp-message__title">No se pudo reproducir con el proxy de Sonora</div>
          <div class="svp-message__sub">Puedes intentarlo de nuevo o usar el reproductor de YouTube.</div>
          <div class="svp-message__actions">
            <button type="button" class="svp-msg-btn" id="svp-retry">Reintentar</button>
            <button type="button" class="svp-msg-btn svp-msg-btn--yt" id="svp-use-iframe">Usar YouTube</button>
          </div>
        </div>
      </div>

      <div class="svp-controls" id="svp-controls">
        <div class="svp-progress-row">
          <span class="svp-time" id="svp-current">0:00</span>
          <div class="svp-progress-wrap">
            <div class="svp-buffered" id="svp-buffered"></div>
            <input type="range" class="svp-seek" id="svp-seek" min="0" max="1000" step="1" value="0" aria-label="Progreso del video" />
          </div>
          <span class="svp-time" id="svp-duration">0:00</span>
        </div>

        <div class="svp-buttons-row">
          <button type="button" class="svp-btn" id="svp-back10" title="-10 s" aria-label="Retroceder 10 segundos">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
          </button>
          <button type="button" class="svp-btn svp-play" id="svp-play" title="Reproducir / Pausa" aria-label="Reproducir">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" id="svp-play-icon"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          </button>
          <button type="button" class="svp-btn" id="svp-fwd10" title="+10 s" aria-label="Avanzar 10 segundos">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
          </button>

          <div class="svp-volume">
            <button type="button" class="svp-btn" id="svp-mute" title="Silenciar" aria-label="Silenciar">
              <span id="svp-volume-icon">🔊</span>
            </button>
            <input type="range" class="svp-volume-range" id="svp-volume" min="0" max="1" step="0.05" value="1" aria-label="Volumen" />
          </div>

          <div class="svp-spacer"></div>

          <button type="button" class="svp-btn svp-text-btn" id="svp-speed-btn" title="Velocidad">1×</button>
          <button type="button" class="svp-btn svp-text-btn" id="svp-quality-btn" title="Calidad">720p</button>
          <button type="button" class="svp-btn svp-text-btn" id="svp-subs-btn" title="Subtítulos">CC</button>
          <button type="button" class="svp-btn" id="svp-loop-btn" title="Repetir" aria-label="Repetir">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          </button>
          <button type="button" class="svp-btn" id="svp-pip-btn" title="Picture-in-Picture" aria-label="Picture-in-Picture">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="12" width="8" height="6" rx="1"/></svg>
          </button>
          <button type="button" class="svp-btn" id="svp-full-btn" title="Pantalla completa" aria-label="Pantalla completa">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
        </div>
      </div>

      <div class="svp-panel hidden" id="svp-panel"></div>
    `;

    document.body.appendChild(overlay);
    st.overlay = overlay;
    st.stage = overlay.querySelector('#svp-stage');
    st.videoEl = overlay.querySelector('#svp-video');
    st.audioEl = overlay.querySelector('#svp-audio');
    st.panel = overlay.querySelector('#svp-panel');

    bindEvents();
  }

  function bindEvents() {
    var overlay = st.overlay;
    var v = st.videoEl;

    overlay.querySelector('.svp-close').addEventListener('click', function () { close(); });
    overlay.querySelector('.svp-mini-btn').addEventListener('click', function () { minimize(); });

    overlay.querySelector('#svp-play').addEventListener('click', togglePlay);
    overlay.querySelector('#svp-bigplay').addEventListener('click', function () {
      hideMessage();
      togglePlay(true);
    });
    overlay.querySelector('#svp-back10').addEventListener('click', function () { seekBy(-10); });
    overlay.querySelector('#svp-fwd10').addEventListener('click', function () { seekBy(10); });

    overlay.querySelector('#svp-mute').addEventListener('click', toggleMute);
    overlay.querySelector('#svp-volume').addEventListener('input', function (e) {
      var val = Number(e.target.value);
      var media = audioMedia();
      if (media) {
        media.volume = val;
        media.muted = val === 0;
      }
      if (st.videoEl) st.videoEl.muted = st.split ? true : val === 0;
      updateVolumeIcon();
      try { localStorage.setItem(VOL_KEY, String(val)); } catch (err) {}
    });

    overlay.querySelector('#svp-speed-btn').addEventListener('click', function () { showPanel('speed'); });
    overlay.querySelector('#svp-quality-btn').addEventListener('click', function () { showPanel('quality'); });
    overlay.querySelector('#svp-subs-btn').addEventListener('click', function () { showPanel('subs'); });
    overlay.querySelector('#svp-loop-btn').addEventListener('click', toggleLoop);
    overlay.querySelector('#svp-pip-btn').addEventListener('click', togglePiP);
    overlay.querySelector('#svp-full-btn').addEventListener('click', function () { toggleFullscreen(); });

    overlay.querySelector('#svp-retry').addEventListener('click', function () {
      hideMessage();
      st.retried = false;
      loadSource();
    });
    overlay.querySelector('#svp-use-iframe').addEventListener('click', function () {
      hideMessage();
      useYouTubeIframe();
    });

    // Seek
    var seek = overlay.querySelector('#svp-seek');
    seek.addEventListener('input', function (e) {
      st.seeking = true;
      var d = v.duration || 0;
      if (d > 0) {
        var t = (Number(e.target.value) / 1000) * d;
        overlay.querySelector('#svp-current').textContent = formatTime(t);
      }
    });
    seek.addEventListener('change', function (e) {
      var d = v.duration || 0;
      if (d > 0) {
        var t = (Number(e.target.value) / 1000) * d;
        try { v.currentTime = t; } catch (err) {}
        if (st.split && st.audioEl) { try { st.audioEl.currentTime = t; } catch (err) {} }
      }
      st.seeking = false;
    });

    // Video events
    v.addEventListener('loadedmetadata', onLoadedMetadata);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('progress', onProgress);
    v.addEventListener('play', function () {
      setPlayingUI(true);
      scheduleHide();
      if (st.split && st.audioEl) {
        var ap = st.audioEl.play();
        if (ap && ap.catch) ap.catch(function () {});
      }
    });
    v.addEventListener('pause', function () {
      setPlayingUI(false);
      showControls();
      if (st.split && st.audioEl) { try { st.audioEl.pause(); } catch (e) {} }
    });
    v.addEventListener('seeking', function () {
      if (st.split && st.audioEl) {
        try { st.audioEl.currentTime = v.currentTime; } catch (e) {}
      }
    });
    v.addEventListener('seeked', function () {
      if (st.split && st.audioEl) {
        try { st.audioEl.currentTime = v.currentTime; } catch (e) {}
      }
    });
    v.addEventListener('ratechange', function () {
      if (st.split && st.audioEl) { try { st.audioEl.playbackRate = v.playbackRate; } catch (e) {} }
    });
    v.addEventListener('waiting', function () { showSpinner(true); });
    v.addEventListener('playing', function () { showSpinner(false); hideMessage(); });
    v.addEventListener('canplay', function () { showSpinner(false); });
    v.addEventListener('ended', function () {
      setPlayingUI(false);
      showControls();
      savePosition();
    });
    v.addEventListener('error', onVideoError);
    v.addEventListener('click', function () { togglePlay(); });
    if (st.audioEl) {
      st.audioEl.addEventListener('error', function () {
        if (st.closed || st.iframeMode) return;
        if (!st.audioRetried) {
          st.audioRetried = true;
          setTimeout(function () {
            if (!st.closed && st.split) loadSource(st.videoEl ? st.videoEl.currentTime : 0);
          }, 500);
        } else {
          toast('El audio no está disponible: usando el reproductor de YouTube', 'warning');
          useYouTubeIframe();
        }
      });
    }

    // Ocultar controles automáticamente
    overlay.addEventListener('mousemove', showControls);
    overlay.addEventListener('touchstart', showControls, { passive: true });
    overlay.addEventListener('click', function (e) {
      if (e.target === st.stage || e.target === v) showControls();
    });

    // Atajos de teclado
    st.keyHandler = function (e) {
      if (!st.overlay || st.mini) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, (audioMedia() && audioMedia().volume || 0) + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, (audioMedia() && audioMedia().volume || 0) - 0.1));
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'Escape':
          if (document.fullscreenElement) exitFullscreen();
          else close();
          break;
      }
    };
    document.addEventListener('keydown', st.keyHandler);

    // Posición guardada
    st.saveTimer = setInterval(savePosition, 5000);

    // Volumen recordado
    try {
      var savedVol = localStorage.getItem(VOL_KEY);
      if (savedVol !== null) {
        var vol = Math.max(0, Math.min(1, Number(savedVol)));
        v.volume = vol;
        if (st.audioEl) st.audioEl.volume = vol;
        overlay.querySelector('#svp-volume').value = vol;
      }
    } catch (e) {}
    updateVolumeIcon();
  }

  /* ── Carga de la fuente ─────────────────────────────────────────────── */
  function loadSource(seekTo) {
    var v = st.videoEl;
    var a = st.audioEl;
    if (!v) return;

    if (st.blobUrl) {
      try { URL.revokeObjectURL(st.blobUrl); } catch (e) {}
      st.blobUrl = null;
    }

    showSpinner(true);
    hideMessage();
    setPlayingUI(false);

    var startAt = typeof seekTo === 'number' ? seekTo : savedPosition();
    v._pendingSeek = startAt > 0 ? startAt : 0;

    if (st.opts && st.opts.blob) {
      // Offline: el MP4 ya trae imagen y sonido.
      st.split = false;
      if (a) {
        try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) {}
        a.classList.add('hidden');
      }
      v.muted = false;
      st.blobUrl = URL.createObjectURL(st.opts.blob);
      v.src = st.blobUrl;
      var qBtn = st.overlay.querySelector('#svp-quality-btn');
      if (qBtn) { qBtn.textContent = 'Offline'; qBtn.disabled = true; }
    } else {
      // Online: pista de vídeo + pista de audio DASH sincronizadas.
      // YouTube ya no entrega MP4 progresivos (403), pero estas sí.
      st.split = true;
      v.muted = true;
      v.src = streamUrl(st.video, st.quality, 'video');
      if (a) {
        a.classList.remove('hidden');
        a.src = streamUrl(st.video, st.quality, 'audio');
        try {
          var savedVol = localStorage.getItem(VOL_KEY);
          var vol = savedVol !== null ? Math.max(0, Math.min(1, Number(savedVol))) : 1;
          a.volume = isFinite(vol) ? vol : 1;
          a.muted = false;
        } catch (e) { a.volume = 1; }
        a.load();
      }
      var qb = st.overlay.querySelector('#svp-quality-btn');
      if (qb) { qb.textContent = st.quality; qb.disabled = false; }
    }

    v.load();
    var playPromise = v.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function () {
        // Autoplay bloqueado: mostramos el botón grande.
        showSpinner(false);
        var big = st.overlay && st.overlay.querySelector('#svp-bigplay');
        if (big) big.classList.remove('hidden');
      });
    }
    if (st.split && a) {
      var ap = a.play();
      if (ap && ap.catch) ap.catch(function () {});
    }

    // Subtítulos (guardados si es offline, descargados si es online)
    loadSubtitles('es', true);
  }

  /** Elemento que lleva el sonido (audio DASH o el propio vídeo). */
  function audioMedia() {
    return (st.split && st.audioEl) ? st.audioEl : st.videoEl;
  }

  function onLoadedMetadata() {
    var v = st.videoEl;
    var a = st.audioEl;
    var d = v.duration || 0;
    var durEl = st.overlay.querySelector('#svp-duration');
    if (durEl) durEl.textContent = formatTime(d);

    if (v._pendingSeek && v._pendingSeek > 3 && (!d || v._pendingSeek < d - 5)) {
      try { v.currentTime = v._pendingSeek; } catch (e) {}
      if (st.split && a) { try { a.currentTime = v._pendingSeek; } catch (e) {} }
    }
    v._pendingSeek = 0;

    var qBtn = st.overlay.querySelector('#svp-quality-btn');
    if (qBtn && st.quality) qBtn.textContent = st.opts.blob ? 'Offline' : st.quality;

    showSpinner(false);
    setPlayingUI(!v.paused);
  }

  function onTimeUpdate() {
    var v = st.videoEl;
    if (!v || !st.overlay) return;
    var d = v.duration || 0;
    var t = v.currentTime || 0;

    // Mantiene el audio DASH pegado al vídeo (deriva máxima 0,35 s).
    if (st.split && st.audioEl) {
      var a = st.audioEl;
      if (!v.paused && a.paused && a.readyState >= 2) {
        var rp = a.play();
        if (rp && rp.catch) rp.catch(function () {});
      }
      var drift = (a.currentTime || 0) - t;
      if (!v.paused && Math.abs(drift) > 0.35) {
        try { a.currentTime = t; } catch (e) {}
      }
    }

    var currentEl = st.overlay.querySelector('#svp-current');
    var durEl = st.overlay.querySelector('#svp-duration');
    if (currentEl) currentEl.textContent = formatTime(t);
    if (durEl && d) durEl.textContent = formatTime(d);

    if (!st.seeking) {
      var seek = st.overlay.querySelector('#svp-seek');
      if (seek && d > 0) seek.value = String(Math.round((t / d) * 1000));
    }
    updateBuffered();
  }

  function onProgress() {
    updateBuffered();
  }

  function updateBuffered() {
    var v = st.videoEl;
    var bar = st.overlay && st.overlay.querySelector('#svp-buffered');
    if (!v || !bar) return;
    var d = v.duration || 0;
    if (!d || !v.buffered || !v.buffered.length) return;
    var end = v.buffered.end(v.buffered.length - 1);
    bar.style.width = Math.min(100, (end / d) * 100) + '%';
  }

  function onVideoError() {
    var v = st.videoEl;
    if (!v || st.closed) return;
    showSpinner(false);

    // Un reintento con la misma calidad: el servidor renueva la URL del CDN
    // (las URLs caducan y devuelven 403). Después, al reproductor de YouTube.
    if (!st.opts.blob && !st.retried) {
      st.retried = true;
      toast('Reintentando el vídeo…', 'info');
      setTimeout(function () {
        if (!st.closed) loadSource(st.videoEl ? st.videoEl.currentTime : 0);
      }, 600);
      return;
    }

    if (!st.opts.blob && st.video) {
      toast('El proxy de Sonora no pudo con el vídeo: usando YouTube', 'warning');
      useYouTubeIframe();
      return;
    }

    showMessage();
  }

  /* ── Controles ──────────────────────────────────────────────────────── */
  function togglePlay(force) {
    var v = st.videoEl;
    var a = audioMedia();
    if (!v) return;
    hideMessage();
    if (force === true || v.paused) {
      var p = v.play();
      if (p && p.catch) p.catch(function () { showMessage(); });
      if (st.split && a) {
        var ap = a.play();
        if (ap && ap.catch) ap.catch(function () {});
      }
    } else {
      v.pause();
      if (st.split && a) { try { a.pause(); } catch (e) {} }
    }
  }

  function seekBy(delta) {
    var v = st.videoEl;
    if (!v) return;
    var d = v.duration || 0;
    var t = Math.max(0, Math.min(d || Infinity, (v.currentTime || 0) + delta));
    try { v.currentTime = t; } catch (e) {}
    if (st.split && st.audioEl) { try { st.audioEl.currentTime = t; } catch (e) {} }
    showControls();
  }

  function setVolume(val) {
    var media = audioMedia();
    if (!media) return;
    media.volume = Math.max(0, Math.min(1, val));
    media.muted = media.volume === 0;
    if (st.split && st.videoEl) st.videoEl.muted = true;
    var range = st.overlay && st.overlay.querySelector('#svp-volume');
    if (range) range.value = String(media.volume);
    updateVolumeIcon();
  }

  function toggleMute() {
    var media = audioMedia();
    if (!media) return;
    media.muted = !media.muted;
    if (!media.muted && media.volume === 0) media.volume = 0.8;
    updateVolumeIcon();
  }

  function updateVolumeIcon() {
    var media = audioMedia();
    var icon = st.overlay && st.overlay.querySelector('#svp-volume-icon');
    if (!icon || !media) return;
    if (media.muted || media.volume === 0) icon.textContent = '🔇';
    else if (media.volume < 0.4) icon.textContent = '🔉';
    else icon.textContent = '🔊';
  }

  function setPlayingUI(playing) {
    var btn = st.overlay && st.overlay.querySelector('#svp-play');
    if (!btn) return;
    btn.innerHTML = playing
      ? '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
      : '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
    btn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    var big = st.overlay.querySelector('#svp-bigplay');
    if (big && playing) big.classList.add('hidden');
  }

  function showSpinner(show) {
    var el = st.overlay && st.overlay.querySelector('#svp-spinner');
    var label = st.overlay && st.overlay.querySelector('#svp-spinner-text');
    if (el) el.classList.toggle('hidden', !show);
    if (label) label.classList.toggle('hidden', !show);
  }

  function showMessage() {
    var el = st.overlay && st.overlay.querySelector('#svp-message');
    if (el) el.classList.remove('hidden');
    showSpinner(false);
  }

  function hideMessage() {
    var el = st.overlay && st.overlay.querySelector('#svp-message');
    if (el) el.classList.add('hidden');
  }

  function toggleLoop() {
    var v = st.videoEl;
    if (!v) return;
    v.loop = !v.loop;
    if (st.split && st.audioEl) st.audioEl.loop = v.loop;
    var btn = st.overlay && st.overlay.querySelector('#svp-loop-btn');
    if (btn) btn.classList.toggle('active', v.loop);
    toast(v.loop ? '🔁 Bucle activado' : 'Bucle desactivado', 'info');
  }

  function toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      exitFullscreen();
    } else {
      enterFullscreen('landscape');
    }
  }

  function enterFullscreen(orientation) {
    var el = st.overlay;
    if (!el) return;
    var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      try {
        var p = req.call(el);
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    // Bloqueo de orientación (Android/Chrome). Si falla, no pasa nada.
    try {
      if (orientation && screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock(orientation).catch(function () {});
      }
    } catch (e) {}
    el.classList.toggle('svp-force-landscape', orientation === 'landscape');
    el.classList.toggle('svp-force-portrait', orientation === 'portrait');
    showControls();
  }

  function exitFullscreen() {
    try {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) {}
    try {
      if (screen.orientation && typeof screen.orientation.unlock === 'function') screen.orientation.unlock();
    } catch (e) {}
    if (st.overlay) {
      st.overlay.classList.remove('svp-force-landscape', 'svp-force-portrait');
    }
  }

  function togglePiP() {
    var v = st.videoEl;
    if (!v) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(function () {});
      return;
    }
    if (document.pictureInPictureEnabled && v.requestPictureInPicture) {
      v.requestPictureInPicture().catch(function () {
        toast('Tu navegador no permite Picture-in-Picture aquí', 'warning');
      });
      return;
    }
    if (v.webkitSetPresentationMode) {
      try { v.webkitSetPresentationMode('picture-in-picture'); } catch (e) {}
      return;
    }
    toast('Picture-in-Picture no está disponible en este dispositivo', 'warning');
  }

  function showControls() {
    if (!st.overlay) return;
    st.overlay.classList.remove('svp-controls-hidden');
    if (st.hideTimer) clearTimeout(st.hideTimer);
    scheduleHide();
  }

  function scheduleHide() {
    if (!st.overlay) return;
    if (st.hideTimer) clearTimeout(st.hideTimer);
    var v = st.videoEl;
    if (!v || v.paused || st.mini) return;
    st.hideTimer = setTimeout(function () {
      if (st.overlay && st.videoEl && !st.videoEl.paused && !st.mini) {
        st.overlay.classList.add('svp-controls-hidden');
      }
    }, 3200);
  }

  /* ── Panel de ajustes ───────────────────────────────────────────────── */
  function showPanel(type) {
    if (!st.panel || !st.overlay) return;
    var v = st.videoEl;

    if (st.panel.dataset.type === type && !st.panel.classList.contains('hidden')) {
      st.panel.classList.add('hidden');
      st.panel.dataset.type = '';
      return;
    }
    st.panel.dataset.type = type;

    var html = '';

    if (type === 'speed') {
      var speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
      html = '<div class="svp-panel-title">Velocidad de reproducción</div><div class="svp-panel-list">' +
        speeds.map(function (s) {
          var active = Math.abs((v.playbackRate || 1) - s) < 0.01;
          return '<button type="button" class="svp-panel-item ' + (active ? 'active' : '') + '" data-speed="' + s + '">' +
            (s === 1 ? 'Normal (1×)' : s + '×') + (active ? ' ✓' : '') + '</button>';
        }).join('') + '</div>';
    } else if (type === 'quality') {
      if (st.opts.blob) {
        html = '<div class="svp-panel-title">Calidad</div><div class="svp-panel-note">Reproduciendo el archivo descargado (offline). La calidad es la del video guardado.</div>';
      } else {
        var heights = [2160, 1440, 1080, 720, 480, 360];
        var available = {};
        (st.video.qualities || []).forEach(function (q) { if (q && q.height) available[q.height] = q; });
        html = '<div class="svp-panel-title">Calidad del video</div><div class="svp-panel-list">' +
          heights.map(function (h) {
            var active = String(st.quality) === (h + 'p');
            var size = available[h] && available[h].size ? ' • ' + formatBytes(available[h].size) : '';
            return '<button type="button" class="svp-panel-item ' + (active ? 'active' : '') + '" data-quality="' + h + 'p">' +
              h + 'p' + size + (active ? ' ✓' : '') + '</button>';
          }).join('') + '</div>';
      }
    } else if (type === 'subs') {
      html = '<div class="svp-panel-title">Subtítulos</div><div class="svp-panel-list">' +
        '<button type="button" class="svp-panel-item" data-sub="off">Desactivados</button>' +
        '<button type="button" class="svp-panel-item" data-sub="es">Español</button>' +
        '<button type="button" class="svp-panel-item" data-sub="en">Inglés</button>' +
        '</div>' +
        '<div class="svp-panel-title" style="margin-top:14px;">Pantalla completa</div>' +
        '<div class="svp-panel-list svp-panel-row">' +
        '<button type="button" class="svp-panel-item" data-orient="landscape">⛶ Horizontal</button>' +
        '<button type="button" class="svp-panel-item" data-orient="portrait">▯ Vertical</button>' +
        '</div>';
    }

    st.panel.innerHTML = html;
    st.panel.classList.remove('hidden');

    st.panel.querySelectorAll('[data-speed]').forEach(function (btn) {
      btn.onclick = function () {
        var speed = Number(btn.getAttribute('data-speed'));
        if (v) v.playbackRate = speed;
        if (st.split && st.audioEl) { try { st.audioEl.playbackRate = speed; } catch (e) {} }
        var label = st.overlay.querySelector('#svp-speed-btn');
        if (label) label.textContent = speed + '×';
        st.panel.classList.add('hidden');
        toast('Velocidad ' + speed + '×', 'info');
      };
    });

    st.panel.querySelectorAll('[data-quality]').forEach(function (btn) {
      btn.onclick = function () {
        var q = btn.getAttribute('data-quality');
        st.panel.classList.add('hidden');
        changeQuality(q);
      };
    });

    st.panel.querySelectorAll('[data-sub]').forEach(function (btn) {
      btn.onclick = function () {
        var lang = btn.getAttribute('data-sub');
        st.panel.classList.add('hidden');
        if (lang === 'off') disableSubtitles();
        else loadSubtitles(lang, false);
      };
    });

    st.panel.querySelectorAll('[data-orient]').forEach(function (btn) {
      btn.onclick = function () {
        var orient = btn.getAttribute('data-orient');
        st.panel.classList.add('hidden');
        enterFullscreen(orient);
      };
    });
  }

  function formatBytes(bytes) {
    var b = Number(bytes) || 0;
    if (!b) return '';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(0) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function changeQuality(quality) {
    var v = st.videoEl;
    if (!v || st.opts.blob) return;
    if (String(quality) === String(st.quality)) return;
    var t = v.currentTime || 0;
    var wasPlaying = !v.paused;
    st.quality = quality;
    var qBtn = st.overlay && st.overlay.querySelector('#svp-quality-btn');
    if (qBtn) qBtn.textContent = quality;
    toast('Calidad: ' + quality, 'info');
    loadSource(t);
    if (!wasPlaying) {
      var once = function () {
        v.removeEventListener('loadedmetadata', once);
        try { v.pause(); } catch (e) {}
      };
      v.addEventListener('loadedmetadata', once);
    }
  }

  /* ── Subtítulos ─────────────────────────────────────────────────────── */
  async function loadSubtitles(lang, silent) {
    if (!st.videoEl || !st.video) return;
    try {
      var text = null;

      // 1. Subtítulos guardados junto al video (offline).
      if (Array.isArray(st.video.subtitles) && st.video.subtitles.length) {
        var found = st.video.subtitles.filter(function (s) { return s && s.lang === lang; })[0] ||
          st.video.subtitles[0];
        if (found && found.vtt) text = found.vtt;
      }

      // 2. Si no hay guardados, los pedimos al servidor (sólo online).
      if (!text) {
        if (st.opts.blob) throw new Error('Sin subtítulos guardados');
        var url = getServerBase() + '/api/video/subtitles?url=' + encodeURIComponent(targetUrl(st.video)) +
          '&lang=' + encodeURIComponent(lang) + '&auto=1';
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        text = await resp.text();
      }

      if (!text || text.indexOf('WEBVTT') === -1) throw new Error('Sin subtítulos');

      disableSubtitles();

      var blob = new Blob([text], { type: 'text/vtt' });
      var blobUrl = URL.createObjectURL(blob);
      st.subUrls.push(blobUrl);

      var track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = lang === 'en' ? 'English' : 'Español';
      track.srclang = lang;
      track.src = blobUrl;
      track.default = true;
      st.videoEl.appendChild(track);

      setTimeout(function () {
        if (!st.videoEl) return;
        for (var i = 0; i < st.videoEl.textTracks.length; i++) {
          st.videoEl.textTracks[i].mode = (st.videoEl.textTracks[i].language === lang) ? 'showing' : 'disabled';
        }
        var btn = st.overlay && st.overlay.querySelector('#svp-subs-btn');
        if (btn) btn.classList.add('active');
      }, 250);

      if (!silent) toast('Subtítulos en ' + (lang === 'en' ? 'inglés' : 'español'), 'info');
    } catch (e) {
      if (!silent) toast('No hay subtítulos disponibles para este video', 'warning');
    }
  }

  function disableSubtitles() {
    if (st.videoEl) {
      for (var i = 0; i < st.videoEl.textTracks.length; i++) {
        st.videoEl.textTracks[i].mode = 'disabled';
      }
      var tracks = st.videoEl.querySelectorAll('track');
      tracks.forEach(function (t) { if (t.parentNode) t.parentNode.removeChild(t); });
    }
    st.subUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    st.subUrls = [];
    var btn = st.overlay && st.overlay.querySelector('#svp-subs-btn');
    if (btn) btn.classList.remove('active');
  }

  /* ── Respaldo con iframe de YouTube ─────────────────────────────────── */
  function useYouTubeIframe() {
    if (!st.video || !st.stage) return;
    var id = st.video.videoId || extractYouTubeId(targetUrl(st.video));
    if (!id) {
      toast('No se pudo identificar el video de YouTube', 'error');
      return;
    }
    st.iframeMode = true;
    if (st.videoEl) {
      try { st.videoEl.pause(); } catch (e) {}
      st.videoEl.classList.add('hidden');
    }
    if (st.audioEl) {
      try { st.audioEl.pause(); } catch (e) {}
      st.audioEl.classList.add('hidden');
    }
    var old = st.stage.querySelector('.svp-iframe-wrap');
    if (old) old.remove();

    var wrap = document.createElement('div');
    wrap.className = 'svp-iframe-wrap';
    wrap.innerHTML = '<iframe src="https://www.youtube.com/embed/' + id +
      '?autoplay=1&rel=0&modestbranding=1&playsinline=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    st.stage.appendChild(wrap);

    var controls = st.overlay.querySelector('#svp-controls');
    if (controls) controls.classList.add('hidden');
    var qBtn = st.overlay.querySelector('#svp-quality-btn');
    if (qBtn) qBtn.textContent = 'YouTube';
    toast('Reproduciendo con el reproductor de YouTube', 'info');
  }

  /* ── Mini reproductor ───────────────────────────────────────────────── */
  function minimize() {
    if (!st.overlay || !st.videoEl || st.iframeMode) return;
    st.mini = true;
    st.overlay.classList.add('hidden');
    if (st.hideTimer) clearTimeout(st.hideTimer);

    var mini = document.createElement('div');
    mini.id = 'svp-mini';
    mini.className = 'svp-mini';
    mini.innerHTML = `
      <div class="svp-mini-video"></div>
      <div class="svp-mini-bar">
        <span class="svp-mini-title">${escapeHtml(st.video.title || 'Video')}</span>
        <button type="button" class="svp-mini-expand" aria-label="Ampliar">⛶</button>
        <button type="button" class="svp-mini-close" aria-label="Cerrar">×</button>
      </div>
    `;
    document.body.appendChild(mini);
    st.miniEl = mini;

    mini.querySelector('.svp-mini-video').appendChild(st.videoEl);
    st.videoEl.classList.remove('hidden');

    mini.querySelector('.svp-mini-expand').addEventListener('click', restore);
    mini.querySelector('.svp-mini-close').addEventListener('click', function () { close(); });
    mini.querySelector('.svp-mini-video').addEventListener('dblclick', restore);
  }

  function restore() {
    if (!st.overlay || !st.videoEl) return;
    st.mini = false;
    if (st.miniEl) {
      st.miniEl.remove();
      st.miniEl = null;
    }
    st.stage.appendChild(st.videoEl);
    st.videoEl.classList.remove('hidden');
    st.overlay.classList.remove('hidden');
    showControls();
  }

  /* ── Abrir / cerrar ─────────────────────────────────────────────────── */
  async function open(video, opts) {
    if (!video) return;
    if (st.overlay) close();

    st.closed = false;
    st.video = Object.assign({}, video);
    st.opts = opts || {};
    st.quality = st.opts.quality || video.quality || '720p';
    st.iframeMode = false;
    st.retried = false;
    st.audioRetried = false;
    st.split = false;
    st.mini = false;
    st.subUrls = [];
    st.blobUrl = null;

    if (!targetUrl(st.video) && st.video.videoId) {
      st.video.url = 'https://www.youtube.com/watch?v=' + st.video.videoId;
    }

    // Pausa la música para que no se mezcle con el video.
    try {
      if (Sonora.Player && typeof Sonora.Player.isPlaying === 'function' && Sonora.Player.isPlaying()) {
        if (typeof Sonora.Player.pause === 'function') Sonora.Player.pause();
      }
    } catch (e) {}

    buildOverlay();

    // Si no nos pasan el blob, intentamos recuperarlo de IndexedDB (offline).
    if (!st.opts.blob && st.video.id && Sonora.DB && Sonora.DB.videos && typeof Sonora.DB.videos.getFile === 'function') {
      try {
        var blob = await Sonora.DB.videos.getFile(st.video.id);
        if (blob) st.opts.blob = blob;
      } catch (e) {}
    }

    if (!st.overlay || st.closed) return;
    loadSource();
  }

  function close() {
    if (st.closed && !st.overlay) return;
    st.closed = true;

    savePosition();

    if (st.hideTimer) { clearTimeout(st.hideTimer); st.hideTimer = null; }
    if (st.saveTimer) { clearInterval(st.saveTimer); st.saveTimer = null; }
    if (st.keyHandler) { document.removeEventListener('keydown', st.keyHandler); st.keyHandler = null; }

    if (st.videoEl) {
      try { st.videoEl.pause(); } catch (e) {}
      try { st.videoEl.removeAttribute('src'); st.videoEl.load(); } catch (e) {}
    }
    if (st.audioEl) {
      try { st.audioEl.pause(); } catch (e) {}
      try { st.audioEl.removeAttribute('src'); st.audioEl.load(); } catch (e) {}
    }

    st.subUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    st.subUrls = [];

    if (st.blobUrl) { try { URL.revokeObjectURL(st.blobUrl); } catch (e) {} st.blobUrl = null; }

    if (st.miniEl) { st.miniEl.remove(); st.miniEl = null; }
    if (st.overlay) { st.overlay.remove(); st.overlay = null; }

    st.stage = null;
    st.videoEl = null;
    st.audioEl = null;
    st.panel = null;
    st.video = null;
    st.opts = {};
    st.mini = false;
    st.split = false;
    st.iframeMode = false;
  }

  Sonora.VideoPlayer = {
    open: open,
    close: close,
    isOpen: function () { return !!(st.overlay && !st.closed); },
    isMinimized: function () { return !!st.mini; },
    getCurrentVideo: function () { return st.video ? Object.assign({}, st.video) : null; },
    getVideoElement: function () { return st.videoEl; }
  };

})();
