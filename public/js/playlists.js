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
  // Cuando se elige "Editar" desde la lista, se navega al detalle y se abre
  // automáticamente el panel de edición (nombre + foto).
  let _pendingOpenEdit = false;
  // Playlist recién creada sin canciones → abrir "Añadir canciones" al entrar.
  let _pendingOpenAdd = false;
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

  /* ──────────────────────────────────────────────────────────────
   * Compartir / copiar (funciona en el WebView de Android)
   * ────────────────────────────────────────────────────────────── */
  function copyPlainText(text) {
    return new Promise(function (resolve) {
      try {
        if (window.SonoraNative && typeof window.SonoraNative.copyToClipboard === 'function') {
          if (window.SonoraNative.copyToClipboard(text)) return resolve(true);
        }
      } catch (e) {}
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { resolve(true); }).catch(function () { resolve(false); });
          return;
        }
      } catch (e) {}
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        resolve(!!ok);
      } catch (e) { resolve(false); }
    });
  }

  function shareText(title, text) {
    try {
      if (window.SonoraNative && typeof window.SonoraNative.shareText === 'function') {
        window.SonoraNative.shareText(title || 'Sonora Music', text || '');
        return;
      }
    } catch (e) {}
    try {
      if (navigator.share) {
        navigator.share({ title: title || 'Sonora Music', text: text || '' }).catch(function () {});
        return;
      }
    } catch (e) {}
    // Último recurso: copiar y avisar
    copyPlainText(text || '').then(function (ok) {
      showToast(ok ? 'Contenido copiado al portapapeles' : 'No se pudo compartir', ok ? 'success' : 'error');
    });
  }

  // Se expone para que otras páginas (reproductor, biblioteca...) lo usen.
  Sonora.Share = { shareText: shareText, copy: copyPlainText };

  /** URL del servidor activo (local o nube) */
  function getServerBase() {
    try {
      if (Sonora.API && typeof Sonora.API.getActiveUrl === 'function') return Sonora.API.getActiveUrl();
    } catch (e) {}
    return 'http://192.168.1.132:3000';
  }

  /** Convierte un resultado de búsqueda online en una canción guardable */
  function buildExternalTrack(t, serverBase) {
    var url = t.url || '';
    var platform = t.platform || 'youtube';
    var base = String(t.id || url || (t.title + t.artist)).replace(/[^a-zA-Z0-9]/g, '');
    if (base.length > 36) base = base.slice(0, 36);
    var id = 'ext_' + base;
    return {
      id: id,
      title: t.title || 'Pista',
      artist: t.artist || 'Artista desconocido',
      album: platform === 'soundcloud' ? 'SoundCloud' : 'YouTube Music',
      duration: t.duration || 0,
      artworkUrl: t.thumbnail || '',
      sourceUrl: url,
      streamUrl: serverBase + '/api/stream/external?url=' + encodeURIComponent(url),
      platform: platform,
      addedAt: Date.now()
    };
  }

  /* ──────────────────────────────────────────────────────────────
   * Hoja de acciones reutilizable (long-press en playlists)
   * ────────────────────────────────────────────────────────────── */
  function openActionSheet(opts) {
    var existing = document.getElementById('sonora-action-sheet');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'sonora-action-sheet';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:sonoraSheetFade .18s ease;';

    var sheet = document.createElement('div');
    sheet.style.cssText = 'width:100%;max-width:520px;background:var(--color-surface,#1c1c22);border-radius:22px 22px 0 0;padding:10px 14px 26px;box-shadow:0 -18px 50px rgba(0,0,0,.6);animation:sonoraSheetUp .22s cubic-bezier(.2,.9,.2,1);max-height:82vh;overflow-y:auto;';

    var header = document.createElement('div');
    header.style.cssText = 'padding:10px 6px 14px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:8px;';
    header.innerHTML = '<div style="font-size:16px;font-weight:800;color:var(--color-text-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      escapeHtml(opts.title || '') + '</div>' +
      (opts.subtitle ? '<div style="font-size:12px;color:var(--color-text-secondary,#A0A5BA);margin-top:2px;">' + escapeHtml(opts.subtitle) + '</div>' : '');
    sheet.appendChild(header);

    (opts.actions || []).forEach(function (action) {
      if (!action) return;
      var btn = document.createElement('button');
      var danger = !!action.danger;
      btn.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;background:transparent;border:0;color:' +
        (danger ? '#FF5B6A' : 'var(--color-text-primary,#fff)') +
        ';font-size:15px;font-weight:600;padding:14px 10px;border-radius:14px;text-align:left;cursor:pointer;';
      btn.innerHTML = '<span style="font-size:19px;width:24px;text-align:center;">' + (action.icon || '') + '</span><span>' + escapeHtml(action.label) + '</span>';
      btn.addEventListener('click', function () {
        close();
        try { action.onSelect && action.onSelect(); } catch (e) { console.warn(e); }
      });
      btn.addEventListener('mouseenter', function () { btn.style.background = 'rgba(255,255,255,.06)'; });
      btn.addEventListener('mouseleave', function () { btn.style.background = 'transparent'; });
      sheet.appendChild(btn);
    });

    var cancel = document.createElement('button');
    cancel.style.cssText = 'width:100%;margin-top:10px;background:rgba(255,255,255,.08);border:0;color:var(--color-text-primary,#fff);font-size:15px;font-weight:700;padding:14px;border-radius:14px;cursor:pointer;';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', close);
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

  function confirmDialog(opts) {
    var close = openActionSheet({
      title: opts.title || '¿Seguro?',
      subtitle: opts.message || '',
      actions: [
        { icon: '✓', label: opts.confirmLabel || 'Confirmar', danger: !!opts.danger, onSelect: function () { opts.onConfirm && opts.onConfirm(); } }
      ]
    });
    return close;
  }

  /** Diálogo con un campo de texto (renombrar playlist, etc.) */
  function openInputDialog(opts) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:22px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:sonoraSheetFade .16s ease;';
    var box = document.createElement('div');
    box.style.cssText = 'width:100%;max-width:420px;background:var(--color-surface,#1c1c22);border-radius:20px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);animation:sonoraSheetUp .2s ease;';
    box.innerHTML =
      '<div style="font-size:17px;font-weight:800;color:var(--color-text-primary,#fff);margin-bottom:12px;">' + escapeHtml(opts.title || '') + '</div>';
    var input = document.createElement('input');
    input.type = 'text';
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:13px 14px;border-radius:13px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:var(--color-text-primary,#fff);font-size:15px;outline:none;';
    box.appendChild(input);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;margin-top:16px;';
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.style.cssText = 'flex:1;padding:13px;border-radius:13px;border:0;background:rgba(255,255,255,.08);color:var(--color-text-primary,#fff);font-size:15px;font-weight:700;cursor:pointer;';
    var okBtn = document.createElement('button');
    okBtn.textContent = opts.confirmLabel || 'Guardar';
    okBtn.style.cssText = 'flex:1;padding:13px;border-radius:13px;border:0;background:linear-gradient(135deg,var(--color-primary,#FF4757),var(--color-secondary,#FF6B35));color:#fff;font-size:15px;font-weight:800;cursor:pointer;';
    row.appendChild(cancelBtn);
    row.appendChild(okBtn);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    okBtn.addEventListener('click', function () {
      var val = (input.value || '').trim();
      if (!val && opts.required) { showToast('Escribe un nombre', 'error'); return; }
      close();
      opts.onConfirm && opts.onConfirm(val);
    });
    setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 60);
  }

  function navigateDetail(id) {
    if (Sonora.Router && typeof Sonora.Router.navigate === 'function') {
      Sonora.Router.navigate('/playlists/' + id);
    } else {
      window.location.hash = '#/playlists/' + id;
    }
  }

  function buildJoinLink(code) {
    return 'https://sonora-music-b1ee.onrender.com/#/playlists/join?code=' + encodeURIComponent(code);
  }

  /** Compartir una playlist (código de invitación si es colaborativa) */
  function sharePlaylist(pl) {
    var isCollab = !!(pl.isCollaborative || pl.code);
    if (isCollab && pl.code) {
      var link = buildJoinLink(pl.code);
      var text = '🎧 Escucha mi playlist colaborativa "' + pl.name + '" en Sonora Music.\n' +
                 'Código para unirte: ' + pl.code + '\n' + link;
      openActionSheet({
        title: 'Compartir playlist',
        subtitle: 'Código ' + pl.code,
        actions: [
          { icon: '📤', label: 'Compartir con…', onSelect: function () { shareText('Sonora Music', text); } },
          { icon: '📋', label: 'Copiar código', onSelect: function () { copyPlainText(pl.code).then(function (ok) { showToast(ok ? 'Código copiado: ' + pl.code : 'No se pudo copiar', ok ? 'success' : 'error'); }); } },
          { icon: '🔗', label: 'Copiar enlace de invitación', onSelect: function () { copyPlainText(link).then(function (ok) { showToast(ok ? 'Enlace copiado' : 'No se pudo copiar', ok ? 'success' : 'error'); }); } }
        ]
      });
    } else {
      shareText('Sonora Music', '🎧 Escucha mi playlist "' + pl.name + '" en Sonora Music.');
    }
  }

  /** Código de invitación para playlists colaborativas: SON-XXXX */
  function genCollabCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for (var i = 0; i < 4; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'SON-' + out;
  }

  /** Sube la playlist colaborativa al servidor (para que otros se unan con el código) */
  async function syncCollabPlaylistToServer(pl) {
    if (!pl || !pl.code) return;
    if (!(Sonora.API && typeof Sonora.API.saveCollaborativePlaylist === 'function')) return;
    var tracks = [];
    try {
      for (var i = 0; i < (pl.trackIds || []).length; i++) {
        if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.getById === 'function') {
          var t = await Sonora.DB.tracks.getById(pl.trackIds[i]);
          if (t) tracks.push(t);
        }
      }
    } catch (e) {}
    return Sonora.API.saveCollaborativePlaylist(pl.code, {
      name: pl.name,
      description: pl.description || '',
      tracks: tracks
    }).catch(function (e) { console.warn('[Playlists] sync collab falló:', e && e.message); });
  }

  /** Une una playlist colaborativa por su código y la guarda en local. */
  async function joinCollaborativeByCode(rawCode) {
    var code = String(rawCode || '').trim().toUpperCase();
    if (!code) throw new Error('Introduce un código de playlist');

    var remote = null;
    if (Sonora.API && typeof Sonora.API.getCollaborativePlaylist === 'function') {
      remote = await Sonora.API.getCollaborativePlaylist(code);
    }
    if (!remote) throw new Error('No se encontró ninguna playlist con el código ' + code);

    // Guardamos las canciones del servidor en la base local para poder
    // reproducirlas aunque el código lo compartió otra persona.
    var trackIds = [];
    var remoteTracks = Array.isArray(remote.tracks) ? remote.tracks : [];
    for (var i = 0; i < remoteTracks.length; i++) {
      var t = remoteTracks[i];
      if (!t || t.id === undefined || t.id === null) continue;
      try {
        if (Sonora.DB && Sonora.DB.tracks && typeof Sonora.DB.tracks.getById === 'function') {
          var existing = await Sonora.DB.tracks.getById(t.id);
          if (!existing) await Sonora.DB.tracks.add(t);
          else await Sonora.DB.tracks.update(t);
        }
      } catch (e) { /* seguimos */ }
      trackIds.push(t.id);
    }

    // Si ya la teníamos unida, la actualizamos en vez de duplicarla.
    var localPl = null;
    try {
      var all = await Sonora.DB.playlists.getAll();
      localPl = (all || []).find(function (p) { return String(p.code || '').toUpperCase() === code; });
    } catch (e) {}

    if (localPl) {
      localPl.name = remote.name || localPl.name;
      localPl.description = remote.description || localPl.description || '';
      localPl.trackIds = trackIds.length ? trackIds : (localPl.trackIds || []);
      localPl.isCollaborative = 1;
      localPl.code = code;
      localPl.joined = 1;
      await Sonora.DB.playlists.update(localPl);
    } else {
      localPl = await Sonora.DB.playlists.create({
        name: remote.name || ('Playlist ' + code),
        description: remote.description || 'Playlist colaborativa',
        trackIds: trackIds,
        artworkUrl: '',
        isCollaborative: 1,
        joined: 1,
        userCreated: 0,
        code: code,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    return localPl;
  }

  /**
   * Abre el selector de fotos del teléfono y devuelve la imagen ya reducida
   * como data URL (para no llenar la base de datos con fotos enormes).
   */
  function pickImageAsDataUrl(maxSize, onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) { input.remove(); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var max = maxSize || 512;
            var scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
            var cw = Math.max(1, Math.round((img.width || max) * scale));
            var ch = Math.max(1, Math.round((img.height || max) * scale));
            var canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, cw, ch);
            onDone(canvas.toDataURL('image/jpeg', 0.85));
          } catch (e) {
            onDone(reader.result);
          }
          input.remove();
        };
        img.onerror = function () { onDone(reader.result); input.remove(); };
        img.src = reader.result;
      };
      reader.onerror = function () { input.remove(); };
      reader.readAsDataURL(file);
    });

    input.click();
  }

  /** Muestra el código de una playlist colaborativa con opciones de copiar. */
  function showPlaylistCode(pl) {
    var code = String(pl.code || '').toUpperCase();
    if (!code) {
      showToast('Esta playlist no es colaborativa', 'info');
      return;
    }
    var link = buildJoinLink(code);
    openActionSheet({
      title: '🔑 Código: ' + code,
      subtitle: pl.name,
      actions: [
        { icon: '📋', label: 'Copiar solo el código', onSelect: function () {
            copyPlainText(code).then(function (ok) {
              showToast(ok ? 'Código copiado: ' + code : 'No se pudo copiar', ok ? 'success' : 'error');
            });
          } },
        { icon: '🔗', label: 'Copiar enlace de invitación', onSelect: function () {
            copyPlainText(link).then(function (ok) {
              showToast(ok ? 'Enlace copiado' : 'No se pudo copiar', ok ? 'success' : 'error');
            });
          } },
        { icon: '📤', label: 'Compartir invitación', onSelect: function () { sharePlaylist(pl); } }
      ]
    });
  }

  function showPlaylistInfo(pl) {    var isCollab = !!(pl.isCollaborative || pl.code);
    openActionSheet({
      title: pl.name,
      subtitle: 'Información de la playlist',
      actions: [
        { icon: '🎵', label: (pl.trackIds || []).length + ' canciones' },
        { icon: '👥', label: isCollab ? 'Colaborativa' : 'Privada' },
        pl.code ? { icon: '#️⃣', label: 'Código: ' + pl.code } : null,
        { icon: '🗓️', label: 'Creada: ' + (pl.createdAt ? new Date(pl.createdAt).toLocaleDateString() : '—') }
      ].filter(Boolean)
    });
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
              color: var(--color-on-primary, #fff);
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
              background: var(--color-surface);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.08));
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
              background: var(--color-surface-elevated);
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
              color: var(--color-on-primary, #fff);
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
              background: var(--color-surface);
              border: 1px solid var(--color-card-border, rgba(255, 255, 255, 0.15));
              color: var(--color-text-primary);
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

            /* ══════════ Pulido de playlists ══════════ */
            @keyframes cardIn {
              from { opacity: 0; transform: translateY(14px) scale(0.98); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes fabFloat {
              0%, 100% { transform: translateY(0); }
              50%      { transform: translateY(-4px); }
            }

            .playlists-grid .playlist-card {
              animation: cardIn 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            .playlists-grid .playlist-card:nth-child(1) { animation-delay: 0.03s; }
            .playlists-grid .playlist-card:nth-child(2) { animation-delay: 0.07s; }
            .playlists-grid .playlist-card:nth-child(3) { animation-delay: 0.11s; }
            .playlists-grid .playlist-card:nth-child(4) { animation-delay: 0.15s; }
            .playlists-grid .playlist-card:nth-child(5) { animation-delay: 0.19s; }

            .playlist-card:hover { transform: translateY(-3px); }
            .playlist-cover-img, .mosaic-grid { transition: transform 0.35s ease; }
            .playlist-card:hover .playlist-cover-img,
            .playlist-card:hover .mosaic-grid { transform: scale(1.05); }

            /* El FAB quedaba DEBAJO del mini-reproductor (z 80 < 190) */
            .fab-create-playlist {
              z-index: 250;
            }

            .playlist-track-item {
              animation: cardIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
            }

            /* El distintivo "Colaborativa" era absolute y sin padre posicionado:
               se iba a la esquina de toda la página. */
            .detail-stats { position: relative; }

            .detail-desc {
              display: -webkit-box;
              -webkit-line-clamp: 3;
              -webkit-box-orient: vertical;
              overflow: hidden;
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
              
              <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--color-card-border, rgba(255,255,255,0.08)); border-radius: 14px; padding: 14px; display: flex; gap: 12px; align-items: flex-start;">
                <div style="font-size: 26px;">1️⃣</div>
                <div>
                  <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary);">Crea o activa la lista</div>
                  <div style="font-size: 12.5px; color: var(--color-text-secondary); margin-top: 2px;">Al crear o editar una playlist, activa el switch <b>"Playlist colaborativa"</b>. Esto generará un código único de 6 caracteres (ej. <code style="background:rgba(255,71,87,0.2); color:#FF4757; padding:2px 6px; border-radius:4px;">SON-4892</code>).</div>
                </div>
              </div>

              <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--color-card-border, rgba(255,255,255,0.08)); border-radius: 14px; padding: 14px; display: flex; gap: 12px; align-items: flex-start;">
                <div style="font-size: 26px;">2️⃣</div>
                <div>
                  <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary);">Comparte el código</div>
                  <div style="font-size: 12.5px; color: var(--color-text-secondary); margin-top: 2px;">Comparte el código con tus amigos por WhatsApp, Telegram o en persona.</div>
                </div>
              </div>

              <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--color-card-border, rgba(255,255,255,0.08)); border-radius: 14px; padding: 14px; display: flex; gap: 12px; align-items: flex-start;">
                <div style="font-size: 26px;">3️⃣</div>
                <div>
                  <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary);">Sincronización en vivo</div>
                  <div style="font-size: 12.5px; color: var(--color-text-secondary); margin-top: 2px;">Tus amigos tocan <b>"Unirse con código"</b> e ingresan el código. Todas las canciones añadidas por cualquier miembro se sincronizan instantáneamente a través del servidor Sonora.</div>
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
              <p style="margin:0; font-size:12px; color:var(--color-text-secondary); text-align:center;">
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
              <h1 class="detail-title lark-title" id="detail-title" style="font-size:22px; font-weight:800; margin:0 0 4px; color:var(--color-text-primary);">Cargando...</h1>
              <p class="detail-desc" id="detail-desc" style="font-size:13px; color:var(--color-text-secondary); margin:0 0 6px;"></p>
              <div class="detail-stats lark-stats" id="detail-stats" style="font-size:13px; color:var(--color-text-secondary); font-weight:600; display:flex; justify-content:center; align-items:center; gap:6px;">
                <span id="detail-track-count">0 Canciones</span>
                <span id="detail-collab-badge" style="display:none;margin-left:6px;" class="playlist-card__badge-collab">👥 Colaborativa</span>
              </div>
              <!-- Código de la playlist colaborativa (para que otros se unan) -->
              <div id="detail-collab-code" style="display:none;"></div>
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
            <div style="padding:12px 20px 0 20px; display:flex; gap:8px; align-items:center;">
              <input type="text" id="search-tracks-input" class="form-input" placeholder="🔍 Buscar por título o artista..." style="flex:1; min-width:0;" />
              <button type="button" class="btn-action btn-action--primary" id="btn-toggle-device-lock"
                      title="Mostrar u ocultar las canciones del teléfono"
                      style="flex-shrink:0; font-size:12px; padding:9px 12px; white-space:nowrap;">
                📱 Con teléfono
              </button>
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
                <label>Foto de la playlist</label>
                <div style="display:flex;align-items:center;gap:14px;">
                  <img id="edit-playlist-art-preview" alt="Portada"
                       src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
                       style="width:86px;height:86px;border-radius:16px;object-fit:cover;background:var(--color-surface-elevated);box-shadow:0 6px 18px rgba(0,0,0,.35);" />
                  <div style="display:flex;flex-direction:column;gap:8px;">
                    <button type="button" class="btn-action btn-action--secondary" id="btn-pick-playlist-art">🖼️ Elegir foto</button>
                    <button type="button" class="btn-action btn-action--secondary" id="btn-clear-playlist-art">Quitar foto</button>
                  </div>
                </div>
              </div>
              <div class="form-group" id="edit-playlist-code-group" style="display:none;">
                <label>Código para invitar (playlist colaborativa)</label>
                <div style="display:flex;gap:8px;align-items:center;">
                  <input type="text" id="edit-playlist-code" class="form-input" readonly />
                  <button type="button" class="btn-action btn-action--secondary" id="btn-copy-edit-code">Copiar</button>
                </div>
              </div>
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
     * Une una playlist colaborativa por código.
     * Se usa cuando alguien abre un enlace compartido (#/playlists/join?code=...)
     */
    async joinByCode(code) {
      try {
        const pl = await joinCollaborativeByCode(code);
        showToast(`¡Te uniste a "${pl.name}"!`, 'success');
        navigateDetail(pl.id);
        return pl;
      } catch (err) {
        showToast('No se pudo unir: ' + (err && err.message ? err.message : 'código no válido'), 'error');
        if (Sonora.Router) Sonora.Router.navigate('/playlists');
        return null;
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
      // Los ids pueden ser número o texto ("it_...", "ext_..."): normalizamos
      allTracks.forEach(t => tracksMap.set(String(t.id), t));

      // ─────────────────────────────────────────────────────────────
      // Sólo se muestran las playlists del usuario. Las listas "smart"
      // (Recientemente reproducidas / Mis Favoritos) ya viven en Biblioteca,
      // y las semillas antiguas del servidor ("Favoritas para el gym",
      // "Chill Vibes", etc.) se eliminan de una vez.
      // ─────────────────────────────────────────────────────────────
      const LEGACY_NAMES = [
        'mis favoritos', 'mis favoritas', 'favoritas del momento',
        'favoritas para el gym', 'para entrenar', 'chill vibes',
        'recientemente escuchado', 'recientemente escuchadas',
        'recientemente reproducidas', 'sesion acustica e indie',
        'sesion acustica'
      ];
      const normalizeName = (s) => String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const userPlaylists = [];
      for (const p of playlists) {
        const isUserOwned = !!(p.userCreated || p.isCollaborative || p.code || p.joined);
        const isLegacy = LEGACY_NAMES.includes(normalizeName(p.name)) || !!p.isSmart || !!p.isSeed;
        if (isUserOwned || !isLegacy) {
          userPlaylists.push(p);
        } else {
          try { await Sonora.DB.playlists.delete(p.id); } catch (e) {}
          console.info('[Playlists] Eliminada playlist que no creó el usuario:', p.name);
        }
      }

      const allPlaylists = userPlaylists;

      // Menú de acciones de una playlist (pulsación larga o botón ⋯)
      const openPlaylistActions = (pl) => {
        const isCollab = !!(pl.isCollaborative || pl.code);
        const count = (pl.trackIds || []).length;
        openActionSheet({
          title: pl.name,
          subtitle: `${count} ${count === 1 ? 'canción' : 'canciones'}${isCollab ? ' · Colaborativa' : ''}`,
          actions: [
            { icon: '▶️', label: 'Reproducir', onSelect: () => navigateDetail(pl.id) },
            isCollab ? {
              icon: '🔑',
              label: 'Ver y copiar código: ' + String(pl.code || '').toUpperCase(),
              onSelect: () => showPlaylistCode(pl)
            } : null,
            {
              icon: '✏️',
              label: 'Editar (nombre y foto)',
              onSelect: () => {
                _pendingOpenEdit = true;
                navigateDetail(pl.id);
              }
            },
            { icon: '📤', label: isCollab ? 'Compartir e invitar' : 'Compartir', onSelect: () => sharePlaylist(pl) },
            { icon: 'ℹ️', label: 'Información', onSelect: () => showPlaylistInfo(pl) },
            { icon: '🗑️', label: 'Eliminar playlist', danger: true, onSelect: () => confirmDialog({
                title: 'Eliminar playlist',
                message: `¿Estás segura de que quieres eliminar "${pl.name}"? Esta acción no se puede deshacer.`,
                confirmLabel: 'Sí, eliminar',
                danger: true,
                onConfirm: async () => {
                  try {
                    await Sonora.DB.playlists.delete(pl.id);
                    if (pl.code && Sonora.API && typeof Sonora.API.deleteCollaborativePlaylist === 'function') {
                      Sonora.API.deleteCollaborativePlaylist(pl.code).catch(() => {});
                    }
                    showToast('Playlist eliminada');
                    await this.initMainView();
                  } catch (e) { showToast('No se pudo eliminar', 'error'); }
                }
              }) }
          ]
        });
      };

      // Render grid
      if (badge) {
        badge.textContent = `${allPlaylists.length} ${allPlaylists.length === 1 ? 'playlist' : 'playlists'}`;
      }

      if (grid) {
        if (allPlaylists.length === 0) {
          grid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--color-text-secondary,#A0A5BA);">
              <div style="font-size:46px;margin-bottom:10px;">🎵</div>
              <div style="font-size:15px;font-weight:700;color:var(--color-text-primary,#fff);">Aún no tienes playlists</div>
              <div style="font-size:13px;margin-top:6px;">Pulsa el botón ＋ para crear la primera.</div>
            </div>`;
        } else {
          grid.innerHTML = allPlaylists.map(p => {
            const trackIds = Array.isArray(p.trackIds) ? p.trackIds : [];
            const pTracks = trackIds.map(id => tracksMap.get(String(id))).filter(Boolean);
            const artworkHtml = renderMosaicHtml(pTracks, p);
            const metaText = p.customCount || `${trackIds.length} ${trackIds.length === 1 ? 'canción' : 'canciones'}`;
            return `
              <div class="playlist-card" data-playlist-id="${escapeHtml(p.id)}">
                <div class="playlist-card__artwork-wrapper">
                  <div class="playlist-card__artwork-inner">
                    ${artworkHtml}
                  </div>
                  ${(p.isCollaborative || p.code) ? '<div class="playlist-card__badge-collab">👥 Colaborativa</div>' : ''}
                </div>
                <div class="playlist-card__info">
                  <div class="playlist-card__title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
                  <div class="playlist-card__meta">${metaText}</div>
                  ${p.code ? `<div class="playlist-card__code" title="Código para unirse">#️⃣ ${escapeHtml(p.code)}</div>` : ''}
                  <button type="button" class="playlist-card__more" data-playlist-id="${escapeHtml(p.id)}"
                          aria-label="Opciones de la playlist"
                          style="position:absolute;top:8px;right:8px;width:34px;height:34px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;line-height:1;cursor:pointer;background:rgba(0,0,0,.45);color:#fff;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:3;">⋯</button>
                </div>
              </div>
            `;
          }).join('');

          // Toque normal → abrir detalle. Pulsación larga → menú de acciones.
          $$('.playlist-card', grid).forEach(card => {
            const pid = card.getAttribute('data-playlist-id');
            let longPressTimer = null;
            let didLongPress = false;

            const startPress = () => {
              didLongPress = false;
              card.classList.add('playlist-card--holding');
              longPressTimer = setTimeout(() => {
                didLongPress = true;
                card.classList.remove('playlist-card--holding');
                try { if (navigator.vibrate) navigator.vibrate(35); } catch (e) {}
                const pl = allPlaylists.find(x => String(x.id) === String(pid));
                if (pl) openPlaylistActions(pl);
              }, 480);
            };
            const cancelPress = () => {
              if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
              card.classList.remove('playlist-card--holding');
            };

            card.addEventListener('pointerdown', startPress);
            card.addEventListener('pointerup', cancelPress);
            card.addEventListener('pointerleave', cancelPress);
            card.addEventListener('pointercancel', cancelPress);
            card.addEventListener('contextmenu', (e) => e.preventDefault());

            addTrackedListener(card, 'click', (e) => {
              if (didLongPress) { didLongPress = false; e.preventDefault(); e.stopPropagation(); return; }
              navigateDetail(pid);
            });

            // Botón ⋯ → mismas acciones que la pulsación larga
            const moreBtn = $('.playlist-card__more', card);
            if (moreBtn) {
              addTrackedListener(moreBtn, 'click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                card.classList.remove('playlist-card--holding');
                const pl = allPlaylists.find(x => String(x.id) === String(pid));
                if (pl) openPlaylistActions(pl);
              });
            }
          });
        }
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
            name: name,
            description: desc,
            trackIds: [],
            artworkUrl: '',
            isCollaborative: isCollab ? 1 : 0,
            userCreated: 1,
            code: isCollab ? genCollabCode() : '',
            ownerId: (Sonora.Store && Sonora.Store.get && Sonora.Store.get('currentUser') && Sonora.Store.get('currentUser').id) || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          try {
            let created = null;
            if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.create === 'function') {
              created = await Sonora.DB.playlists.create(newPlaylistData);
            } else if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.add === 'function') {
              await Sonora.DB.playlists.add(newPlaylistData);
              created = newPlaylistData;
            }
            // Si es colaborativa, la registramos en el servidor para que otros
            // puedan unirse con el código.
            if (isCollab && created) {
              syncCollabPlaylistToServer(created);
            }
            showToast(isCollab
              ? 'Playlist colaborativa creada · código ' + (created && created.code || '')
              : 'Playlist creada correctamente');
            closeCreateModal();
            // Entramos directo a la playlist nueva y abrimos el buscador para
            // añadir canciones de la biblioteca enseguida.
            if (created && created.id !== undefined) {
              _pendingOpenAdd = true;
              navigateDetail(created.id);
            } else {
              await this.initMainView();
            }
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
              const localPl = await joinCollaborativeByCode(rawCode);
              showToast(`¡Te uniste a "${localPl.name}"!`, 'success');
              closeJoin();
              navigateDetail(localPl.id);
            } catch (err) {
              showToast('No se pudo unir: ' + (err && err.message ? err.message : 'código no válido'), 'error');
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
          const recentTrackIds = recentHistory
            .map(h => h && (h.trackId || (h.track && h.track.id) || h.id))
            .filter(Boolean);
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
          // Red de seguridad: si no aparece por id exacto, buscamos comparando
          // como texto (por si la clave se guardó con otro tipo).
          if (!playlist && typeof Sonora.DB.playlists.getAll === 'function') {
            const list = (await Sonora.DB.playlists.getAll()) || [];
            playlist = list.find(p => p && String(p.id) === String(playlistId)) || null;
          }
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
      allTracks.forEach(t => tracksMap.set(String(t.id), t));

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

      // Código visible debajo del nombre (para unirse a la playlist colaborativa)
      const codeEl = document.getElementById('detail-collab-code');
      if (codeEl) {
        if ((playlist.isCollaborative || playlist.code) && playlist.code) {
          codeEl.style.display = 'inline-flex';
          codeEl.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:7px 14px;border-radius:999px;background:rgba(var(--color-primary-rgb,255,71,87),0.16);border:1px solid rgba(var(--color-primary-rgb,255,71,87),0.45);font-size:13px;font-weight:700;color:var(--color-text-primary,#fff);cursor:pointer;';
          codeEl.innerHTML = '🔑 Código: ' + escapeHtml(playlist.code) + ' · toca para copiar';
          codeEl.onclick = () => {
            copyPlainText(playlist.code).then(ok => showToast(ok ? 'Código copiado: ' + playlist.code : 'No se pudo copiar', ok ? 'success' : 'error'));
          };
        } else {
          codeEl.style.display = 'none';
        }
      }

      const secActions = $('#detail-secondary-actions');
      if (secActions && playlist.isSmart) {
        const btnDel = $('#btn-delete-playlist', secActions);
        if (btnDel) btnDel.style.display = 'none';
        const btnEdit = $('#btn-edit-playlist', secActions);
        if (btnEdit) btnEdit.style.display = 'none';
      }

      const trackIds = Array.isArray(playlist.trackIds) ? [...playlist.trackIds] : [];
      const currentTracks = trackIds.map(id => tracksMap.get(String(id))).filter(Boolean);

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
            const clickedTrack = tracksMap.get(String(trackId));
            if (clickedTrack && Sonora.Player) {
              const clickedIdx = currentTracks.findIndex(t => String(t.id) === String(trackId));
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
              // Update playlist (comparando como texto: los ids pueden ser
              // números o cadenas según el origen de la canción)
              const updatedTrackIds = (playlist.trackIds || []).filter(id => String(id) !== String(trackId));
              playlist.trackIds = updatedTrackIds;
              if (Sonora.DB && Sonora.DB.playlists) {
                if (typeof Sonora.DB.playlists.removeTrack === 'function') {
                  await Sonora.DB.playlists.removeTrack(playlist.id, trackId);
                } else if (typeof Sonora.DB.playlists.update === 'function') {
                  await Sonora.DB.playlists.update(Object.assign({}, playlist, { trackIds: updatedTrackIds, updatedAt: new Date().toISOString() }));
                }
              }
              // Si es colaborativa, quitarla también en el servidor
              if ((playlist.isCollaborative || playlist.code) && playlist.code && Sonora.API && typeof Sonora.API.removeTrackFromCollaborative === 'function') {
                Sonora.API.removeTrackFromCollaborative(playlist.code, trackId).catch(() => {});
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
                  await Sonora.DB.playlists.update(Object.assign({}, playlist, {
                    trackIds: newTrackIds,
                    updatedAt: new Date().toISOString()
                  }));
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
                  await Sonora.DB.playlists.update(Object.assign({}, playlist, {
                    trackIds: newTrackIds,
                    updatedAt: new Date().toISOString()
                  }));
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
        addTrackedListener(btnShare, 'click', () => {
          sharePlaylist(playlist);
        });
      }

      // Delete Playlist
      const btnDelete = $('#btn-delete-playlist');
      if (btnDelete) {
        addTrackedListener(btnDelete, 'click', () => {
          confirmDialog({
            title: 'Eliminar playlist',
            message: `¿Estás seguro de que quieres eliminar "${playlist.name}"? Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
            onConfirm: async () => {
              try {
                if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.delete === 'function') {
                  await Sonora.DB.playlists.delete(playlist.id);
                }
                if (playlist.code && Sonora.API && typeof Sonora.API.deleteCollaborativePlaylist === 'function') {
                  Sonora.API.deleteCollaborativePlaylist(playlist.code).catch(() => {});
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
            }
          });
        });
      }

      // Edit Playlist Modal
      const modalEdit = $('#modal-edit-playlist');
      const btnOpenEdit = $('#btn-edit-playlist');
      const btnCloseEdit = $('#btn-close-edit-modal');
      const btnCancelEdit = $('#btn-cancel-edit');
      const btnSubmitEdit = $('#btn-submit-edit');

      // Foto pendiente (se aplica al guardar)
      let pendingArtwork = playlist.artworkUrl || '';
      const artPreview = $('#edit-playlist-art-preview');
      const setArtPreview = (url) => {
        if (!artPreview) return;
        artPreview.src = (url && url.trim()) ? url : generateArtwork(playlist.id || 1, playlist.name || 'Playlist');
      };
      setArtPreview(pendingArtwork);

      const openEditModal = () => {
        if (modalEdit) {
          const nameIn = $('#edit-playlist-name');
          const descIn = $('#edit-playlist-desc');
          const collabIn = $('#edit-playlist-collab');
          if (nameIn) nameIn.value = playlist.name || '';
          if (descIn) descIn.value = playlist.description || '';
          if (collabIn) collabIn.checked = !!playlist.isCollaborative;

          // Código de invitación visible (si ya es colaborativa)
          pendingArtwork = playlist.artworkUrl || '';
          setArtPreview(pendingArtwork);
          const codeGroup = $('#edit-playlist-code-group');
          const codeInput = $('#edit-playlist-code');
          if (codeGroup && codeInput) {
            if (playlist.code) {
              codeGroup.style.display = 'block';
              codeInput.value = playlist.code;
            } else {
              codeGroup.style.display = 'none';
              codeInput.value = '';
            }
          }

          modalEdit.classList.add('active');
          setTimeout(() => nameIn && nameIn.focus(), 150);
        }
      };

      const btnPickArt = $('#btn-pick-playlist-art');
      const btnClearArt = $('#btn-clear-playlist-art');
      const btnCopyEditCode = $('#btn-copy-edit-code');
      if (btnPickArt) addTrackedListener(btnPickArt, 'click', () => {
        pickImageAsDataUrl(640, (dataUrl) => {
          pendingArtwork = dataUrl;
          setArtPreview(dataUrl);
        });
      });
      if (btnClearArt) addTrackedListener(btnClearArt, 'click', () => {
        pendingArtwork = '';
        setArtPreview('');
        showToast('Foto quitada · no olvides guardar', 'info');
      });
      if (btnCopyEditCode) addTrackedListener(btnCopyEditCode, 'click', () => {
        const codeInput = $('#edit-playlist-code');
        copyPlainText(codeInput ? codeInput.value : '').then((ok) => {
          showToast(ok ? 'Código copiado' : 'No se pudo copiar', ok ? 'success' : 'error');
        });
      });

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
          playlist.isCollaborative = newCollab ? 1 : 0;
          playlist.userCreated = playlist.userCreated || 1;
          // Foto elegida por el usuario ('' = sin foto propia).
          if (pendingArtwork !== undefined && pendingArtwork !== null) {
            playlist.artworkUrl = String(pendingArtwork).trim();
          }
          // Si se activa la colaboración y aún no tiene código, se genera uno.
          if (newCollab && !playlist.code) {
            playlist.code = genCollabCode();
          }
          if (!newCollab) {
            // Al desactivarla se quita el código para no compartir de más.
            playlist.code = '';
          }
          playlist.updatedAt = new Date().toISOString();

          try {
            if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.update === 'function') {
              await Sonora.DB.playlists.update(playlist);
            }
            if (playlist.code) syncCollabPlaylistToServer(playlist);
            showToast(playlist.code ? 'Playlist actualizada · código ' + playlist.code : 'Playlist actualizada');
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

      // Estado de la búsqueda online dentro del modal "Añadir canciones"
      let _onlineResults = [];
      let _searchSeq = 0;
      let _debounceTimer = null;

      const isTrackInPlaylist = (id) => (playlist.trackIds || []).some(x => String(x) === String(id));

      const trackRowHtml = (t, online) => {
        const added = isTrackInPlaylist(t.id);
        const artwork = t.artworkUrl || t.thumbnail || generateArtwork(t.id || t.title || 'x', t.title || '');
        const tag = online
          ? `<span style="font-size:9.5px;font-weight:800;padding:2px 6px;border-radius:8px;background:${t.platform === 'soundcloud' ? '#ff5500' : '#ff0033'};color:var(--color-text-primary);margin-left:6px;vertical-align:middle;">${t.platform === 'soundcloud' ? 'SoundCloud' : 'YouTube'}</span>`
          : '';
        const dur = t.duration ? formatTime(t.duration) : (t.durationText || '');
        return `
          <div class="playlist-track-item" style="padding:8px 0;">
            <img src="${escapeHtml(artwork)}" class="track-cover-thumb" alt="" loading="lazy" />
            <div class="track-info-col" style="min-width:0;flex:1;">
              <div class="track-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.title || 'Pista')}${tag}</div>
              <div class="track-artist" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.artist || 'Artista')}${dur ? ' • ' + dur : ''}</div>
            </div>
            <button class="btn-action ${added ? 'btn-action--secondary' : 'btn-action--primary'} btn-toggle-add-track"
                    data-track-id="${escapeHtml(t.id)}"
                    data-online="${online ? '1' : '0'}"
                    data-in="${added ? 'true' : 'false'}"
                    style="font-size:12px;padding:6px 12px;flex-shrink:0;">
              ${added ? '✓ Añadido' : '+ Añadir'}
            </button>
          </div>
        `;
      };

      const renderAddTracksList = (filterText) => {
        if (!addTracksList) return;
        const q = (filterText || '').toLowerCase().trim();
        const match = (t) => {
          if (!q) return true;
          return (t.title && t.title.toLowerCase().includes(q)) ||
                 (t.artist && t.artist.toLowerCase().includes(q)) ||
                 (t.album && t.album.toLowerCase().includes(q));
        };

        // El candado (🔒) oculta las canciones del teléfono en este selector,
        // así se pueden elegir con libertad las canciones de Sonora.
        const locked = !!(Sonora.DeviceLock && Sonora.DeviceLock.isLocked());
        const local = allTracks.filter(t => t && !t.isDeviceTrack && match(t));
        const device = locked ? [] : allTracks.filter(t => t && t.isDeviceTrack && match(t));

        let html = '';

        if (local.length > 0) {
          html += `<div class="add-tracks-section-label">En Sonora (${local.length})</div>`;
          html += local.slice(0, 120).map(t => trackRowHtml(t, false)).join('');
        } else if (!q) {
          html += `
            <div class="empty-state">
              <div class="empty-state__icon">🎵</div>
              <h4 class="empty-state__title">Tu biblioteca de Sonora está vacía</h4>
              <p style="margin:0;font-size:13px;color:var(--color-text-secondary);">Escribe arriba para buscar en YouTube y SoundCloud y añadir cualquier canción.</p>
            </div>`;
        }

        if (device.length > 0) {
          html += `<div class="add-tracks-section-label">📱 En tu teléfono (${device.length})</div>`;
          html += device.slice(0, 120).map(t => trackRowHtml(t, false)).join('');
        } else if (locked && !q) {
          html += `<div style="padding:12px 4px 4px;font-size:12px;color:var(--color-text-secondary);text-align:center;">🔒 Las canciones de tu teléfono están ocultas. Pulsa el candado para incluirlas.</div>`;
        }

        if (_onlineResults.length > 0) {
          html += `<div class="add-tracks-section-label">En internet (${_onlineResults.length})</div>`;
          html += _onlineResults.map(t => trackRowHtml(t, true)).join('');
        } else if (q.length >= 2) {
          html += `<div style="padding:18px;text-align:center;color:var(--color-text-secondary);font-size:13px;">🔎 Buscando en internet…</div>`;
        }

        if (!html) {
          html += `
            <div class="empty-state">
              <div class="empty-state__icon">🔍</div>
              <h4 class="empty-state__title">No se encontraron canciones</h4>
            </div>`;
        }

        addTracksList.innerHTML = html;
        bindToggleButtons();
      };

      // Candado de las canciones del teléfono dentro de este panel
      const toggleDeviceLockBtn = $('#btn-toggle-device-lock');
      const refreshDeviceLockButton = () => {
        if (!toggleDeviceLockBtn) return;
        const locked = !!(Sonora.DeviceLock && Sonora.DeviceLock.isLocked());
        toggleDeviceLockBtn.textContent = locked ? '🔒 Sin teléfono' : '📱 Con teléfono';
        toggleDeviceLockBtn.className = 'btn-action ' + (locked ? 'btn-action--secondary' : 'btn-action--primary');
        toggleDeviceLockBtn.title = locked
          ? 'Ahora sólo se muestran las canciones de Sonora (pulsa para incluir las del teléfono)'
          : 'Se muestran también las canciones del teléfono (pulsa para ocultarlas)';
      };
      if (toggleDeviceLockBtn) {
        addTrackedListener(toggleDeviceLockBtn, 'click', () => {
          if (Sonora.DeviceLock) Sonora.DeviceLock.set(!Sonora.DeviceLock.isLocked());
          refreshDeviceLockButton();
          renderAddTracksList(searchInput ? searchInput.value : '');
        });
      }

      const bindToggleButtons = () => {
        $$('.btn-toggle-add-track', addTracksList).forEach(btn => {
          addTrackedListener(btn, 'click', async () => {
            const tId = btn.getAttribute('data-track-id');
            const online = btn.getAttribute('data-online') === '1';
            const isIn = btn.getAttribute('data-in') === 'true';

            try {
              if (isIn) {
                playlist.trackIds = (playlist.trackIds || []).filter(id => String(id) !== String(tId));
                btn.setAttribute('data-in', 'false');
                btn.className = 'btn-action btn-action--primary btn-toggle-add-track';
                btn.textContent = '+ Añadir';
              } else {
                // Si viene de internet, la guardamos en la base local para que
                // se pueda reproducir y forme parte de la playlist.
                if (online) {
                  const raw = _onlineResults.find(x => String(x.id) === String(tId));
                  if (raw) {
                    const trackObj = buildExternalTrack(raw, getServerBase());
                    try {
                      const existing = await Sonora.DB.tracks.getById(trackObj.id);
                      if (existing) await Sonora.DB.tracks.update(Object.assign({}, existing, trackObj));
                      else await Sonora.DB.tracks.add(trackObj);
                    } catch (e) { console.warn('[Playlists] No se pudo guardar la canción', e); }
                  }
                }
                playlist.trackIds = playlist.trackIds || [];
                if (!playlist.trackIds.some(x => String(x) === String(tId))) {
                  playlist.trackIds.push(tId);
                }
                btn.setAttribute('data-in', 'true');
                btn.className = 'btn-action btn-action--secondary btn-toggle-add-track';
                btn.textContent = '✓ Añadido';
              }

              if (Sonora.DB && Sonora.DB.playlists && typeof Sonora.DB.playlists.update === 'function') {
                await Sonora.DB.playlists.update(Object.assign({}, playlist, {
                  trackIds: playlist.trackIds,
                  userCreated: playlist.userCreated || 1,
                  updatedAt: new Date().toISOString()
                }));
              }
              // Las colaborativas se sincronizan con el servidor al instante
              if (playlist.code) syncCollabPlaylistToServer(playlist);
            } catch (err) {
              console.error('[Playlists] Error toggling track', err);
              showToast('No se pudo añadir la canción', 'error');
            }
          });
        });
      };

      const searchOnlineTracks = (query) => {
        const seq = ++_searchSeq;
        const clean = (query || '').trim();
        if (clean.length < 2) { _onlineResults = []; return; }
        const serverBase = getServerBase();
        fetch(serverBase + '/api/search/external?q=' + encodeURIComponent(clean), { headers: { 'Accept': 'application/json' } })
          .then(r => r.ok ? r.json() : [])
          .then(list => {
            if (seq !== _searchSeq) return;
            _onlineResults = (list || []).slice(0, 12);
            renderAddTracksList(searchInput ? searchInput.value : '');
          })
          .catch(() => { if (seq === _searchSeq) _onlineResults = []; });
      };

      const openAddModal = () => {
        if (modalAdd) {
          if (searchInput) searchInput.value = '';
          _onlineResults = [];
          // Aseguramos que el candado esté cargado antes de pintar la lista.
          const render = () => { refreshDeviceLockButton(); renderAddTracksList(''); };
          const lockReady = (Sonora.DeviceLock && Sonora.DeviceLock.refresh)
            ? Sonora.DeviceLock.refresh() : Promise.resolve();
          Promise.resolve(lockReady).then(render).catch(render);
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
          const val = e.target.value;
          renderAddTracksList(val);
          if (_debounceTimer) clearTimeout(_debounceTimer);
          _debounceTimer = setTimeout(() => searchOnlineTracks(val), 550);
        });
      }

      // Al elegir "Editar" desde la lista se abre el panel automáticamente.
      if (_pendingOpenEdit) {
        _pendingOpenEdit = false;
        setTimeout(() => { try { openEditModal(); } catch (e) {} }, 240);
      }

      // Playlist recién creada → invitamos a añadir canciones de la biblioteca.
      if (_pendingOpenAdd && !(playlist.trackIds || []).length) {
        _pendingOpenAdd = false;
        setTimeout(() => { try { openAddModal(); } catch (e) {} }, 380);
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
