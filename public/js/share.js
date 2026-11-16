/**
 * Sonora Music — Share & Deep Links
 *
 * - Compartir canciones con un enlace real que abre la canción (y su minuto).
 * - Compartir playlists colaborativas con código + enlace.
 * - Hoja de compartir propia (copiar, WhatsApp, Telegram, Correo) que funciona
 *   igual en Android y en la app de macOS (donde navigator.share no existe).
 * - Landings web para quien no tiene la app y apertura de la app nativa.
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};
  var CLOUD_FALLBACK = 'https://sonora-music-b1ee.onrender.com';
  var ANDROID_PACKAGE = 'com.sonoramusic.app';

  /* ── utilidades ─────────────────────────────────────────────── */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toast(message, type) {
    try {
      var el = document.getElementById('sonora-share-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'sonora-share-toast';
        el.className = 'sonora-toast';
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.className = 'sonora-toast visible ' + (type || 'info');
      clearTimeout(el._timeout);
      el._timeout = setTimeout(function () { el.className = 'sonora-toast'; }, 2800);
    } catch (e) {
      console.log('[Share]', message);
    }
  }

  function formatTime(totalSeconds) {
    var secs = Number(totalSeconds);
    if (!isFinite(secs) || secs < 0) secs = 0;
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function platform() {
    try {
      // Solo cuenta como app nativa si existe el puente real. Un navegador en
      // Mac o Android NO debe comportarse como la app instalada.
      if (window.SonoraNative) return 'android';
      if (window.__TAURI__ || window.__TAURI_INTERNALS__) return 'mac';
    } catch (e) {}
    var ua = (navigator.userAgent || '');
    if (/Android/i.test(ua)) return 'android-web';
    return 'web';
  }

  function nativeApp() {
    var p = platform();
    return p === 'android' || p === 'mac';
  }

  /** Dominio de la nube de Sonora (nunca la IP LAN: los enlaces deben salir). */
  function cloudBase() {
    try {
      if (Sonora.API && typeof Sonora.API.getInviteBase === 'function') {
        var base = String(Sonora.API.getInviteBase() || '').replace(/\/+$/, '');
        if (base) return base;
      }
      if (Sonora.API && typeof Sonora.API.getRenderBase === 'function') {
        var render = String(Sonora.API.getRenderBase() || '').replace(/\/+$/, '');
        if (render) return render;
      }
    } catch (e) {}
    return CLOUD_FALLBACK;
  }

  /** Invoca un comando nativo de la app de macOS (Tauri). */
  function tauriInvoke(command, args) {
    try {
      var tauri = window.__TAURI__;
      if (tauri && tauri.core && typeof tauri.core.invoke === 'function') {
        return tauri.core.invoke(command, args || {});
      }
    } catch (e) {}
    return null;
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function copy(text) {
    var value = String(text == null ? '' : text);
    return new Promise(function (resolve) {
      try {
        if (window.SonoraNative && typeof window.SonoraNative.copyToClipboard === 'function') {
          if (window.SonoraNative.copyToClipboard(value)) return resolve(true);
        }
      } catch (e) {}

      try {
        var native = tauriInvoke('copy_to_clipboard', { text: value });
        if (native && typeof native.then === 'function') {
          native
            .then(function () { resolve(true); })
            .catch(function () {
              var tauri = window.__TAURI__;
              if (tauri && tauri.clipboardManager && typeof tauri.clipboardManager.writeText === 'function') {
                return tauri.clipboardManager.writeText(value)
                  .then(function () { resolve(true); })
                  .catch(function () { resolve(fallbackCopy(value)); });
              }
              resolve(fallbackCopy(value));
            });
          return;
        }
      } catch (e) {}

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value)
            .then(function () { resolve(true); })
            .catch(function () { resolve(fallbackCopy(value)); });
          return;
        }
      } catch (e) {}

      resolve(fallbackCopy(value));
    });
  }

  function openExternal(url) {
    if (!url) return false;
    try {
      if (window.SonoraNative && typeof window.SonoraNative.openExternalUrl === 'function') {
        if (window.SonoraNative.openExternalUrl(url)) return true;
      }
    } catch (e) {}

    try {
      var native = tauriInvoke('open_external_url', { url: url });
      if (native && typeof native.then === 'function') {
        native.catch(function () {
          try {
            var tauri = window.__TAURI__;
            if (tauri && tauri.opener && typeof tauri.opener.openUrl === 'function') {
              tauri.opener.openUrl(url);
            }
          } catch (e) {}
        });
        return true;
      }
    } catch (e) {}

    try {
      var win = window.open(url, '_blank', 'noopener');
      if (win) return true;
    } catch (e) {}

    try {
      window.location.href = url;
      return true;
    } catch (e) {}

    return false;
  }

  /* ── enlaces ────────────────────────────────────────────────── */

  function playlistLink(code) {
    var clean = (Sonora.API && Sonora.API.parseCollabCode)
      ? Sonora.API.parseCollabCode(code)
      : String(code || '').trim().toUpperCase();
    return cloudBase() + '/#/playlists/join?code=' + encodeURIComponent(clean);
  }

  function currentSecondsFor(track) {
    try {
      var current = Sonora.Player && Sonora.Player.getCurrentTrack && Sonora.Player.getCurrentTrack();
      if (!current || !track) return 0;
      if (String(current.id) !== String(track.id)) return 0;
      var now = Sonora.Player.getCurrentTime ? Sonora.Player.getCurrentTime() : 0;
      return isFinite(now) && now > 5 ? Math.floor(now) : 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Enlace de una canción. Solo se genera si hay un identificador que exista
   * en otro dispositivo: videoId de YouTube o una URL de origen. Las canciones
   * subidas desde el teléfono (isDeviceTrack) no se pueden compartir así.
   */
  function trackLink(track, position) {
    if (!track || track.isDeviceTrack) return '';
    var params = [];
    if (track.videoId) {
      params.push('yt=' + encodeURIComponent(String(track.videoId)));
    } else if (track.sourceUrl && /^https?:/i.test(String(track.sourceUrl))) {
      params.push('src=' + encodeURIComponent(String(track.sourceUrl)));
    } else {
      return '';
    }

    if (track.title) params.push('title=' + encodeURIComponent(String(track.title).slice(0, 140)));
    if (track.artist) params.push('artist=' + encodeURIComponent(String(track.artist).slice(0, 140)));
    var cover = track.artworkUrl || track.thumbnail || '';
    if (cover && /^https?:/i.test(String(cover))) {
      params.push('cover=' + encodeURIComponent(String(cover).slice(0, 400)));
    }
    var dur = Number(track.duration) || 0;
    if (dur > 0) params.push('dur=' + Math.round(dur));

    var secs = Number(position);
    if (!isFinite(secs) || secs < 0) secs = 0;
    if (secs > 5) params.push('t=' + Math.floor(secs));

    return cloudBase() + '/#/share/track?' + params.join('&');
  }

  function appUrlFor(route) {
    var clean = String(route || '').replace(/^#/, '');
    if (clean.charAt(0) !== '/') clean = '/' + clean;
    return 'sonora://open/#' + clean;
  }

  /* ── hoja de compartir ──────────────────────────────────────── */

  function openShareSheet(opts) {
    opts = opts || {};
    var existing = document.getElementById('sonora-share-sheet');
    if (existing) existing.remove();

    var link = opts.link || '';
    var code = opts.code || '';
    var text = opts.text || '';
    var subject = opts.subject || opts.title || 'Sonora Music';
    var fullMessage = text + (link ? '\n' + link : '') + (code ? '\nCódigo: ' + code : '');

    var actions = [];

    if (platform() === 'android' && window.SonoraNative &&
        typeof window.SonoraNative.shareText === 'function') {
      actions.push({
        icon: '📲',
        label: 'Compartir con apps del teléfono',
        run: function () { window.SonoraNative.shareText(subject, fullMessage); }
      });
    }

    if (link) {
      actions.push({
        icon: '📋',
        label: 'Copiar enlace',
        run: function () {
          copy(link).then(function (ok) {
            toast(ok ? 'Enlace copiado' : 'No se pudo copiar', ok ? 'success' : 'error');
          });
        }
      });
    }

    if (code) {
      actions.push({
        icon: '#️⃣',
        label: 'Copiar solo el código',
        run: function () {
          copy(code).then(function (ok) {
            toast(ok ? 'Código copiado: ' + code : 'No se pudo copiar', ok ? 'success' : 'error');
          });
        }
      });
    }

    actions.push({
      icon: '💬',
      label: 'WhatsApp',
      run: function () {
        openExternal('https://wa.me/?text=' + encodeURIComponent(fullMessage));
      }
    });

    actions.push({
      icon: '✈️',
      label: 'Telegram',
      run: function () {
        openExternal('https://t.me/share/url?url=' + encodeURIComponent(link || '') +
          '&text=' + encodeURIComponent(text || subject));
      }
    });

    actions.push({
      icon: '✉️',
      label: 'Correo',
      run: function () {
        openExternal('mailto:?subject=' + encodeURIComponent(subject) +
          '&body=' + encodeURIComponent(fullMessage));
      }
    });

    if (navigator.share && platform() !== 'android') {
      actions.push({
        icon: '📤',
        label: 'Más opciones…',
        run: function () {
          navigator.share({ title: subject, text: text, url: link || undefined }).catch(function () {});
        }
      });
    }

    if (opts.pending && typeof opts.onRetry === 'function') {
      actions.push({
        icon: '📡',
        label: 'Publicar ahora en Sonora',
        run: function () { opts.onRetry(); }
      });
    }

    // ── construcción del DOM ──
    var overlay = document.createElement('div');
    overlay.id = 'sonora-share-sheet';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(6px);' +
      '-webkit-backdrop-filter:blur(6px);animation:sonoraSheetFade .18s ease;';

    var sheet = document.createElement('div');
    sheet.style.cssText = 'width:100%;max-width:520px;background:var(--color-surface,#1c1c22);' +
      'border-radius:22px 22px 0 0;padding:10px 14px 26px;box-shadow:0 -18px 50px rgba(0,0,0,.6);' +
      'animation:sonoraSheetUp .22s cubic-bezier(.2,.9,.2,1);max-height:82vh;overflow-y:auto;';

    var header = document.createElement('div');
    header.style.cssText = 'padding:10px 6px 14px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:8px;';
    header.innerHTML =
      '<div style="font-size:16px;font-weight:800;color:var(--color-text-primary,#fff);' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(opts.title || 'Compartir') + '</div>' +
      (opts.subtitle ? '<div style="font-size:12px;color:var(--color-text-secondary,#A0A5BA);' +
        'margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        esc(opts.subtitle) + '</div>' : '');
    sheet.appendChild(header);

    if (link) {
      var preview = document.createElement('div');
      preview.style.cssText = 'margin:4px 6px 10px;padding:10px 12px;border-radius:12px;' +
        'background:rgba(255,255,255,.06);font-size:11px;line-height:1.4;color:var(--color-text-secondary,#A0A5BA);' +
        'word-break:break-all;';
      preview.textContent = link;
      sheet.appendChild(preview);
    }

    actions.forEach(function (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;background:transparent;' +
        'border:0;color:var(--color-text-primary,#fff);font-size:15px;font-weight:600;' +
        'padding:14px 10px;border-radius:14px;text-align:left;cursor:pointer;';
      btn.innerHTML = '<span style="font-size:19px;width:24px;text-align:center;">' +
        (action.icon || '') + '</span><span>' + esc(action.label) + '</span>';
      btn.addEventListener('click', function () {
        close();
        setTimeout(function () {
          try { action.run(); } catch (e) { console.warn('[Share] action failed', e); }
        }, 60);
      });
      btn.addEventListener('mouseenter', function () { btn.style.background = 'rgba(255,255,255,.06)'; });
      btn.addEventListener('mouseleave', function () { btn.style.background = 'transparent'; });
      sheet.appendChild(btn);
    });

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.style.cssText = 'width:100%;margin-top:10px;background:rgba(255,255,255,.08);border:0;' +
      'color:var(--color-text-primary,#fff);font-size:15px;font-weight:700;padding:14px;' +
      'border-radius:14px;cursor:pointer;';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', function () { close(); });
    sheet.appendChild(cancel);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    function close() {
      overlay.style.animation = 'sonoraSheetFadeOut .16s ease forwards';
      setTimeout(function () { overlay.remove(); }, 160);
    }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    return close;
  }

  /* ── compartir ──────────────────────────────────────────────── */

  function shareText(title, text) {
    var message = String(text || '');
    try {
      if (window.SonoraNative && typeof window.SonoraNative.shareText === 'function') {
        window.SonoraNative.shareText(title || 'Sonora Music', message);
        return;
      }
    } catch (e) {}

    try {
      if (navigator.share) {
        navigator.share({ title: title || 'Sonora Music', text: message }).catch(function () {});
        return;
      }
    } catch (e) {}

    copy(message).then(function (ok) {
      toast(ok ? 'Mensaje copiado al portapapeles' : 'No se pudo compartir', ok ? 'success' : 'error');
    });
  }

  function shareTrack(track) {
    if (!track) {
      toast('No hay ninguna canción para compartir', 'warning');
      return;
    }

    var title = track.title || 'Canción';
    var artist = track.artist || 'Artista desconocido';
    var position = currentSecondsFor(track);
    var link = trackLink(track, position);

    if (!link) {
      // Canción del teléfono (archivo local): solo texto, sin enlace.
      shareText(title, '🎧 Escuchando "' + title + '" de ' + artist + ' en Sonora Music.');
      return;
    }

    var text = '🎧 Escucha "' + title + '" de ' + artist + ' en Sonora Music.' +
      (position > 5 ? ' (desde ' + formatTime(position) + ')' : '');

    openShareSheet({
      title: 'Compartir canción',
      subtitle: title + ' · ' + artist + (position > 5 ? ' · desde ' + formatTime(position) : ''),
      link: link,
      text: text,
      subject: title + ' — ' + artist
    });
  }

  function sharePlaylist(opts) {
    opts = opts || {};
    var name = opts.name || 'Mi playlist';
    var code = opts.code || '';
    var link = opts.link || (code ? playlistLink(code) : '');
    var text = '🎧 Escucha mi playlist colaborativa "' + name + '" en Sonora Music.' +
      (code ? '\nCódigo para unirte: ' + code : '');

    openShareSheet({
      title: 'Compartir playlist',
      subtitle: code ? 'Código ' + code : name,
      link: link,
      code: code,
      text: text,
      subject: name + ' — Sonora Music',
      pending: !!opts.pending,
      onRetry: opts.onRetry
    });
  }

  function shareCurrentTrack() {
    try {
      var track = Sonora.Player && Sonora.Player.getCurrentTrack && Sonora.Player.getCurrentTrack();
      if (!track) {
        toast('Reproduce una canción para compartirla', 'info');
        return;
      }
      shareTrack(track);
    } catch (e) {}
  }

  /* ── landings y enlaces entrantes ───────────────────────────── */

  function trackFromParams(params) {
    params = params || {};
    var yt = params.yt ? String(params.yt).trim() : '';
    var src = params.src ? String(params.src).trim() : '';
    if (!yt && !/^https?:/i.test(src)) return null;

    var title = params.title ? String(params.title) : 'Canción compartida';
    var artist = params.artist ? String(params.artist) : 'Sonora Music';
    var cover = params.cover ? String(params.cover) : '';
    if (!cover && yt) cover = 'https://i.ytimg.com/vi/' + encodeURIComponent(yt) + '/hqdefault.jpg';

    return {
      id: yt ? 'yt_' + yt : 'shared_' + String(src).replace(/[^a-zA-Z0-9]/g, '').slice(-24),
      videoId: yt || undefined,
      sourceUrl: src || (yt ? 'https://www.youtube.com/watch?v=' + yt : ''),
      title: title,
      artist: artist,
      album: '',
      artworkUrl: cover,
      duration: Number(params.dur) || 0,
      platform: yt ? 'youtube' : 'shared',
      isDeviceTrack: 0,
      isSharedLink: 1
    };
  }

  function seekWhenReady(target) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var duration = 0;
      try {
        duration = Sonora.Player.getProgress().duration || 0;
      } catch (e) {}
      if (isFinite(duration) && duration > target) {
        clearInterval(timer);
        try {
          Sonora.Player.seek(target);
          toast('Reproduciendo desde ' + formatTime(target), 'info');
        } catch (e) {}
        return;
      }
      // Stream sin duración fiable: no se puede saltar, se avisa y se deja sonar.
      if (tries > 40) {
        clearInterval(timer);
      }
    }, 300);
  }

  async function playSharedTrack(params) {
    var track = trackFromParams(params);
    if (!track) return false;

    try {
      if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.add === 'function') {
        try { await Sonora.DB.tracks.add(track); } catch (e) {}
      }
      await Sonora.Player.play(track);
    } catch (e) {
      console.warn('[Share] no se pudo reproducir la canción compartida:', (e && e.message) || e);
      return false;
    }

    var target = parseInt(params && params.t, 10);
    if (isFinite(target) && target > 2) seekWhenReady(target);
    return true;
  }

  function renderTrackLanding(params) {
    var track = trackFromParams(params);
    var main = document.getElementById('main-content');
    if (!main) return;

    var route = '/share/track';
    var query = [];
    ['yt', 'src', 'title', 'artist', 'cover', 'dur', 't'].forEach(function (key) {
      if (params && params[key]) query.push(key + '=' + encodeURIComponent(params[key]));
    });
    if (query.length) route += '?' + query.join('&');

    var title = track ? track.title : 'Canción compartida';
    var artist = track ? track.artist : 'Sonora Music';
    var cover = track && track.artworkUrl ? track.artworkUrl : '';
    var startAt = parseInt(params && params.t, 10);
    var startLabel = (isFinite(startAt) && startAt > 2) ? formatTime(startAt) : '';

    main.innerHTML = `
      <div class="page" style="padding:26px 18px 40px;max-width:560px;margin:0 auto;">
        <div style="text-align:center;color:var(--color-text-secondary,#A0A5BA);font-size:12px;
                    letter-spacing:1.4px;text-transform:uppercase;font-weight:700;margin-bottom:18px;">
          Compartida en Sonora Music
        </div>
        <div style="position:relative;border-radius:20px;overflow:hidden;background:#1c1c22;
                    box-shadow:0 18px 50px rgba(0,0,0,.45);">
          ${cover ? `<img src="${esc(cover)}" alt="" style="display:block;width:100%;aspect-ratio:1/1;object-fit:cover;" />` : ''}
          <div style="padding:18px 18px 22px;">
            <div style="font-size:22px;font-weight:800;line-height:1.25;color:var(--color-text-primary,#fff);">
              ${esc(title)}
            </div>
            <div style="font-size:14px;color:var(--color-text-secondary,#A0A5BA);margin-top:4px;">
              ${esc(artist)}
            </div>
            ${startLabel ? `<div style="font-size:13px;color:var(--color-primary,#FF4757);margin-top:8px;font-weight:700;">
              Empieza en ${esc(startLabel)}
            </div>` : ''}
          </div>
        </div>

        <button type="button" id="share-landing-play"
          style="width:100%;margin-top:20px;padding:16px;border:0;border-radius:16px;cursor:pointer;
                 font-size:16px;font-weight:800;color:#fff;
                 background:linear-gradient(135deg,var(--color-primary,#FF4757),#B3243A);">
          ▶ Reproducir aquí
        </button>

        <button type="button" id="share-landing-open"
          style="width:100%;margin-top:10px;padding:15px;border-radius:16px;cursor:pointer;
                 font-size:15px;font-weight:700;color:var(--color-text-primary,#fff);
                 background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);">
          📱 Abrir en la app de Sonora
        </button>

        <p id="share-landing-hint" style="margin:14px 6px 0;font-size:12px;line-height:1.5;
           color:var(--color-text-secondary,#A0A5BA);text-align:center;">
          Si no tienes Sonora instalada, puedes escucharla aquí mismo. Con la app abrirá
          directamente en esa canción${startLabel ? ' y en ese minuto' : ''}.
        </p>
      </div>
    `;

    var playBtn = document.getElementById('share-landing-play');
    if (playBtn) {
      playBtn.addEventListener('click', async function () {
        playBtn.disabled = true;
        playBtn.textContent = 'Cargando…';
        var ok = await playSharedTrack(params);
        playBtn.disabled = false;
        playBtn.textContent = ok ? '▶ Reproduciendo' : 'No se pudo reproducir';
      });
    }

    var openBtn = document.getElementById('share-landing-open');
    var hint = document.getElementById('share-landing-hint');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        var opened = openExternal(appUrlFor(route));
        if (hint) {
          hint.textContent = opened
            ? 'Abriendo Sonora… Si no se abre, instala la app desde sonora-music.'
            : 'No se pudo abrir la app. Instálala o usa «Reproducir aquí».';
        }
      });
    }
  }

  /**
   * Abre una canción compartida: en la app nativa reproduce directamente
   * (y salta al minuto); en el navegador muestra la ficha con botón.
   */
  function openSharedTrack(params) {
    if (nativeApp()) {
      playSharedTrack(params).then(function (ok) {
        if (!ok) renderTrackLanding(params);
      }).catch(function () { renderTrackLanding(params); });
      return;
    }
    renderTrackLanding(params);
  }

  /**
   * Punto de entrada para los enlaces que llegan del sistema operativo
   * (sonora://open/#/ruta o https://…/#/ruta).
   */
  function openFromUrl(rawUrl) {
    var url = String(rawUrl || '').trim();
    if (!url) return false;

    var route = '';
    var hashIdx = url.indexOf('#');
    if (hashIdx !== -1) route = url.substring(hashIdx + 1);

    if (!route) {
      var match = url.match(/^sonora:\/\/[^\/]*\/?(.*)$/i);
      if (match && match[1]) route = '/' + match[1].replace(/^\/+/, '');
    }
    if (!route) return false;
    if (route.charAt(0) !== '/') route = '/' + route;

    var apply = function () {
      try {
        window.location.hash = '#' + route;
        return true;
      } catch (e) {
        return false;
      }
    };

    if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
      try {
        Sonora.Router.navigate(route);
        return true;
      } catch (e) {}
    }
    return apply();
  }

  /**
   * Arranque de la app de macOS: avisa de que la interfaz ya puede recibir
   * rutas y recoge el enlace que llegó mientras la app se abría.
   */
  function initNativeLinks() {
    var tauri = window.__TAURI__;
    if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return;
    var run = function () {
      var ready = tauriInvoke('mark_ui_ready');
      if (!ready || typeof ready.then !== 'function') return;
      ready
        .then(function () { return tauriInvoke('take_pending_deep_link'); })
        .then(function (url) {
          if (!url) return;
          setTimeout(function () { openFromUrl(url); }, 80);
        })
        .catch(function () {});
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  Sonora.Share = {
    platform: platform,
    isNative: nativeApp,
    copy: copy,
    openExternal: openExternal,
    openShareSheet: openShareSheet,
    shareText: shareText,
    shareTrack: shareTrack,
    shareCurrentTrack: shareCurrentTrack,
    sharePlaylist: sharePlaylist,
    playlistLink: playlistLink,
    trackLink: trackLink,
    appUrlFor: appUrlFor,
    openSharedTrack: openSharedTrack,
    renderTrackLanding: renderTrackLanding,
    playSharedTrack: playSharedTrack,
    openFromUrl: openFromUrl,
    formatTime: formatTime,
    tauriInvoke: tauriInvoke
  };

  initNativeLinks();
})();
