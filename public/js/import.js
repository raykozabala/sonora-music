/**
 * Sonora Music — Importar desde Spotify y YouTube Music
 *
 * No pide contraseñas ni claves API. Lee la ficha PÚBLICA que Spotify sirve
 * a cualquier visitante (playlist, álbum o artista) y la lista pública de
 * YouTube Music, y después empareja cada canción con su vídeo para poder
 * reproducirla y descargarla dentro de Sonora.
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mediaBase() {
    try {
      if (Sonora.API && typeof Sonora.API.getMediaBase === 'function') {
        var b = Sonora.API.getMediaBase();
        if (b) return String(b).replace(/\/+$/, '');
      }
      if (Sonora.API && typeof Sonora.API.getActiveUrl === 'function') {
        var a = Sonora.API.getActiveUrl();
        if (a) return String(a).replace(/\/+$/, '');
      }
    } catch (e) {}
    return 'https://sonora-music-b1ee.onrender.com';
  }

  function toast(msg, type) {
    if (Sonora.Store) Sonora.Store.emit('toast', { message: msg, type: type || 'info' });
  }

  /** Solo enlaces que realmente son una lista (playlist/álbum/artista). */
  function detectPlaylistLink(url) {
    var raw = String(url || '').trim();
    if (spotifyPlaylistLike(raw)) return 'spotify';
    if (/[?&]list=([A-Za-z0-9_-]{10,})/.test(raw)) return 'youtube';
    return '';
  }

  function spotifyPlaylistLike(raw) {
    return /spotify:(playlist|album|artist|track):[A-Za-z0-9]+/i.test(raw) ||
      /open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?(playlist|album|artist|track)\/[A-Za-z0-9]+/i.test(raw);
  }

  function detectService(url) {
    var raw = String(url || '').trim();
    if (/spotify\.com|spotify:/i.test(raw)) return 'spotify';
    if (/youtube\.com|youtu\.be|music\.youtube/i.test(raw)) return 'youtube';
    return '';
  }

  async function getJson(path) {
    var resp = await fetch(mediaBase() + path, { headers: { 'Accept': 'application/json' } });
    var data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok) {
      var err = new Error((data && data.error) || ('El servidor respondió HTTP ' + resp.status));
      err.code = (data && data.code) || 'http_' + resp.status;
      throw err;
    }
    return data;
  }

  async function postJson(path, body) {
    var resp = await fetch(mediaBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok) {
      var err = new Error((data && data.error) || ('El servidor respondió HTTP ' + resp.status));
      err.code = (data && data.code) || 'http_' + resp.status;
      throw err;
    }
    return data;
  }

  /** Guarda la carátula como data URL para que el mosaico se vea sin red. */
  async function coverDataUrl(url) {
    if (!url || String(url).indexOf('data:') === 0) return url || '';
    try {
      var resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) return '';
      var blob = await resp.blob();
      return await new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { resolve(''); };
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return '';
    }
  }

  function durationText(sec) {
    sec = Number(sec) || 0;
    if (!sec) return '';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function year() { return new Date().getFullYear(); }

  async function findTrack(id) {
    try { return await Sonora.DB.tracks.getById(id); } catch (e) { return null; }
  }

  /**
   * Crea (o reutiliza) la pista de Sonora para un vídeo de YouTube.
   * El id `yt_<videoId>` es el mismo que usa el buscador, así que una canción
   * importada y la misma canción buscada a mano son la misma entrada.
   */
  async function ensureTrack(info, opts) {
    opts = opts || {};
    var videoId = info.videoId || '';
    var id = videoId ? ('yt_' + videoId) : ('imp_' + Math.abs(hashCode((info.artist || '') + ' ' + (info.title || ''))).toString(36));
    var existing = await findTrack(id);
    var thumb = info.thumbnail || (videoId ? 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg' : '');

    if (existing) {
      var changed = false;
      if (!existing.duration && info.duration) { existing.duration = Number(info.duration); changed = true; }
      if (!existing.artworkUrl && thumb) { existing.artworkUrl = thumb; existing.coverSourceUrl = thumb; changed = true; }
      if (changed) { try { await Sonora.DB.tracks.update(existing); } catch (e) {} }
      return existing;
    }

    var track = {
      id: id,
      videoId: videoId,
      title: info.title || 'Canción importada',
      artist: info.artist || 'Artista desconocido',
      album: opts.album || (opts.service === 'spotify' ? 'Importada de Spotify' : 'Importada de YouTube Music'),
      albumId: 1,
      artistId: 1,
      duration: Number(info.duration) || 0,
      durationText: durationText(info.duration),
      artworkUrl: thumb,
      coverSourceUrl: thumb,
      sourceUrl: videoId ? ('https://www.youtube.com/watch?v=' + videoId) : '',
      platform: 'youtube',
      genre: opts.service === 'spotify' ? 'Spotify' : 'YouTube Music',
      year: year(),
      trackNumber: opts.index || 1,
      isFavorite: 0,
      playCount: 0,
      dateAdded: new Date().toISOString(),
      importedFrom: opts.service || '',
      importedPlaylist: opts.playlistName || ''
    };
    try { await Sonora.DB.tracks.add(track); } catch (e) {}
    return track;
  }

  function hashCode(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
    return h;
  }

  async function createPlaylist(data, service) {
    var cover = await coverDataUrl(data.cover || '');
    var playlist = {
      name: data.name || 'Playlist importada',
      description: service === 'spotify'
        ? ('Importada de Spotify · ' + (data.total || data.tracks.length) + ' canciones')
        : ('Importada de YouTube Music · ' + (data.total || data.tracks.length) + ' canciones'),
      artworkUrl: cover || data.cover || '',
      coverSourceUrl: data.cover || '',
      trackIds: [],
      userCreated: 1,
      importedFrom: service,
      importSourceUrl: data.url || '',
      importSourceName: data.author || '',
      importedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    return await Sonora.DB.playlists.create(playlist);
  }

  async function savePlaylist(pl) {
    pl.updatedAt = new Date().toISOString();
    try { await Sonora.DB.playlists.update(pl); } catch (e) {}
  }

  /** Spotify: metadatos + emparejado por lotes con progreso real. */
  async function runSpotify(url, onProgress) {
    var data = await getJson('/api/import/spotify?url=' + encodeURIComponent(url));
    if (!data.tracks || !data.tracks.length) {
      throw new Error('Esa lista de Spotify no tiene canciones visibles.');
    }
    var playlist = await createPlaylist(data, 'spotify');
    var matched = 0;
    var missing = 0;
    var batchSize = 8;

    for (var i = 0; i < data.tracks.length; i += batchSize) {
      var batch = data.tracks.slice(i, i + batchSize);
      var matches = [];
      try {
        var payload = await postJson('/api/import/match', { tracks: batch });
        matches = (payload && payload.matches) || [];
      } catch (e) {
        matches = [];
      }

      for (var j = 0; j < batch.length; j++) {
        var original = batch[j];
        var match = matches[j];
        var info;
        if (match) {
          matched++;
          info = {
            videoId: match.videoId,
            title: original.title,
            artist: original.artist || match.artist,
            duration: match.duration || original.duration,
            thumbnail: match.thumbnail
          };
        } else {
          missing++;
          // Sin coincidencia: se guarda igual y Sonora la busca al reproducir.
          info = {
            videoId: '',
            title: original.title,
            artist: original.artist,
            duration: original.duration,
            thumbnail: data.cover || ''
          };
        }
        var track = await ensureTrack(info, {
          service: 'spotify',
          album: data.name,
          playlistName: playlist.name,
          index: i + j + 1
        });
        if (track && playlist.trackIds.indexOf(track.id) === -1) playlist.trackIds.push(track.id);
      }

      await savePlaylist(playlist);
      if (onProgress) {
        onProgress(Math.min(data.tracks.length, i + batch.length), data.tracks.length, matched, missing);
      }
    }

    // Carátulas locales para el mosaico (las 6 primeras).
    var firstIds = playlist.trackIds.slice(0, 6);
    for (var k = 0; k < firstIds.length; k++) {
      var t = await findTrack(firstIds[k]);
      if (t && t.artworkUrl && String(t.artworkUrl).indexOf('data:') !== 0) {
        var local = await coverDataUrl(t.artworkUrl);
        if (local) {
          t.artworkUrl = local;
          try { await Sonora.DB.tracks.update(t); } catch (e) {}
        }
      }
    }

    await savePlaylist(playlist);
    return { playlist: playlist, matched: matched, missing: missing };
  }

  /** YouTube Music: los vídeos ya vienen con id, no hay que emparejar nada. */
  async function runYouTube(url, onProgress) {
    var data = await getJson('/api/import/youtube?url=' + encodeURIComponent(url));
    if (!data.tracks || !data.tracks.length) {
      throw new Error('Esa playlist de YouTube no tiene canciones públicas.');
    }
    var playlist = await createPlaylist(data, 'youtube');

    for (var i = 0; i < data.tracks.length; i++) {
      var item = data.tracks[i];
      var track = await ensureTrack({
        videoId: item.videoId,
        title: item.title,
        artist: item.artist,
        duration: item.duration,
        thumbnail: item.thumbnail
      }, {
        service: 'youtube',
        album: data.name,
        playlistName: playlist.name,
        index: i + 1
      });
      if (track && playlist.trackIds.indexOf(track.id) === -1) playlist.trackIds.push(track.id);
      if (i % 15 === 0) {
        await savePlaylist(playlist);
        if (onProgress) onProgress(i + 1, data.tracks.length, i + 1, 0);
      }
    }

    var firstIds = playlist.trackIds.slice(0, 6);
    for (var k = 0; k < firstIds.length; k++) {
      var t = await findTrack(firstIds[k]);
      if (t && t.artworkUrl && String(t.artworkUrl).indexOf('data:') !== 0) {
        var local = await coverDataUrl(t.artworkUrl);
        if (local) {
          t.artworkUrl = local;
          try { await Sonora.DB.tracks.update(t); } catch (e) {}
        }
      }
    }

    await savePlaylist(playlist);
    return { playlist: playlist, matched: data.tracks.length, missing: 0 };
  }

  function notify() {
    try { if (Sonora.Store) Sonora.Store.emit('playlistsChanged', {}); } catch (e) {}
  }

  /* ── Interfaz ─────────────────────────────────────────────────────────── */

  var _busy = false;

  function styles() {
    return `
      #sonora-import-overlay {
        position: fixed; inset: 0; z-index: 9500;
        background: rgba(4, 5, 10, .78);
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        display: flex; align-items: center; justify-content: center;
        padding: 18px; animation: sonoraImportFade .18s ease;
      }
      @keyframes sonoraImportFade { from { opacity: 0 } to { opacity: 1 } }
      .sonora-import {
        width: min(560px, 100%); max-height: min(86vh, 760px); overflow: auto;
        background: linear-gradient(180deg, #17181f 0%, #0c0d12 100%);
        border: 1px solid rgba(255,255,255,.09); border-radius: 22px;
        box-shadow: 0 40px 120px rgba(0,0,0,.65);
        color: #fff; font-family: inherit;
      }
      .sonora-import__head {
        padding: 22px 24px 10px; display: flex; align-items: flex-start; gap: 12px;
      }
      .sonora-import__badge {
        width: 46px; height: 46px; border-radius: 14px; flex: 0 0 46px;
        display: grid; place-items: center; font-size: 22px;
        background: linear-gradient(135deg, #1ed760, #0b6b33);
      }
      .sonora-import__badge--yt { background: linear-gradient(135deg, #ff4b4b, #8b0f0f); }
      .sonora-import__title { font-size: 19px; font-weight: 800; letter-spacing: -.01em; }
      .sonora-import__sub { font-size: 12.5px; color: rgba(255,255,255,.56); margin-top: 3px; line-height: 1.45; }
      .sonora-import__close {
        margin-left: auto; border: 0; background: rgba(255,255,255,.08); color: #fff;
        width: 34px; height: 34px; border-radius: 50%; cursor: pointer; font-size: 16px;
      }
      .sonora-import__body { padding: 8px 24px 24px; }
      .sonora-import__tabs { display: flex; gap: 8px; margin: 10px 0 16px; }
      .sonora-import__tab {
        flex: 1; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04);
        color: rgba(255,255,255,.72); border-radius: 12px; padding: 10px 12px;
        font-weight: 700; font-size: 13px; cursor: pointer; transition: .15s;
      }
      .sonora-import__tab.is-active {
        background: #fff; color: #0b0b0f; border-color: #fff;
      }
      .sonora-import__label { font-size: 11px; font-weight: 800; letter-spacing: .08em;
        text-transform: uppercase; color: rgba(255,255,255,.42); margin-bottom: 7px; }
      .sonora-import__row { display: flex; gap: 8px; }
      .sonora-import__input {
        flex: 1; min-width: 0; background: #0a0b10; border: 1px solid rgba(255,255,255,.12);
        border-radius: 12px; padding: 13px 14px; color: #fff; font-size: 14px; outline: none;
      }
      .sonora-import__input:focus { border-color: rgba(30,215,96,.7); box-shadow: 0 0 0 3px rgba(30,215,96,.12); }
      .sonora-import__paste {
        border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06);
        color: #fff; border-radius: 12px; padding: 0 14px; font-weight: 700; cursor: pointer;
      }
      .sonora-import__go {
        margin-top: 12px; width: 100%; border: 0; border-radius: 999px; padding: 14px;
        background: #1ed760; color: #08130b; font-size: 14.5px; font-weight: 900; cursor: pointer;
        transition: transform .12s ease, filter .12s ease;
      }
      .sonora-import__go:active { transform: scale(.985); }
      .sonora-import__go[disabled] { opacity: .55; cursor: default; }
      .sonora-import__hint { margin-top: 14px; font-size: 12px; line-height: 1.6; color: rgba(255,255,255,.45); }
      .sonora-import__hint b { color: rgba(255,255,255,.75); }
      .sonora-import__progress {
        margin-top: 16px; background: rgba(255,255,255,.06); border-radius: 12px; padding: 13px 14px;
        border: 1px solid rgba(255,255,255,.07);
      }
      .sonora-import__bar { height: 7px; border-radius: 99px; background: rgba(255,255,255,.1); overflow: hidden; margin-top: 9px; }
      .sonora-import__bar > i { display: block; height: 100%; width: 0; border-radius: 99px;
        background: linear-gradient(90deg, #1ed760, #8ff0ad); transition: width .25s ease; }
      .sonora-import__status { font-size: 12.5px; color: rgba(255,255,255,.72); line-height: 1.5; }
      .sonora-import__error {
        margin-top: 14px; border-radius: 12px; padding: 12px 14px; font-size: 12.5px; line-height: 1.55;
        background: rgba(255,71,87,.12); border: 1px solid rgba(255,71,87,.35); color: #ffb4ba;
      }
      .sonora-import__done {
        margin-top: 16px; border-radius: 14px; padding: 16px; text-align: center;
        background: rgba(30,215,96,.1); border: 1px solid rgba(30,215,96,.3);
      }
      .sonora-import__done h3 { margin: 0 0 4px; font-size: 16px; }
      .sonora-import__done p { margin: 0 0 12px; font-size: 12.5px; color: rgba(255,255,255,.62); }
      .sonora-import__open {
        border: 0; border-radius: 999px; padding: 10px 22px; background: #fff; color: #0b0b0f;
        font-weight: 800; font-size: 13px; cursor: pointer;
      }
      .sonora-import__examples { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
      .sonora-import__example {
        border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04);
        color: rgba(255,255,255,.62); border-radius: 999px; padding: 6px 11px; font-size: 11px; cursor: pointer;
      }
    `;
  }

  function open(prefill) {
    var existing = $('#sonora-import-overlay');
    if (existing) existing.remove();

    if (!$('#sonora-import-styles')) {
      var st = document.createElement('style');
      st.id = 'sonora-import-styles';
      st.textContent = styles();
      document.head.appendChild(st);
    }

    var overlay = document.createElement('div');
    overlay.id = 'sonora-import-overlay';
    overlay.innerHTML = `
      <div class="sonora-import" role="dialog" aria-modal="true" aria-label="Importar música">
        <div class="sonora-import__head">
          <div class="sonora-import__badge" id="si-badge">🎧</div>
          <div>
            <div class="sonora-import__title">Importar desde otra app</div>
            <div class="sonora-import__sub">
              Trae tus playlists a Sonora y escúchalas aquí, con letra y descarga offline.
            </div>
          </div>
          <button class="sonora-import__close" id="si-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="sonora-import__body">
          <div class="sonora-import__tabs">
            <button class="sonora-import__tab is-active" data-service="spotify" id="si-tab-spotify">Spotify</button>
            <button class="sonora-import__tab" data-service="youtube" id="si-tab-youtube">YouTube Music · experimental</button>
          </div>
          <div class="sonora-import__label">Enlace de la playlist · puedes pegar varias, una por línea</div>
          <div class="sonora-import__row">
            <input class="sonora-import__input" id="si-url" type="url" inputmode="url"
              placeholder="https://open.spotify.com/playlist/..." autocomplete="off" />
            <button class="sonora-import__paste" id="si-paste" title="Pegar">Pegar</button>
          </div>
          <button class="sonora-import__go" id="si-go">Importar playlist</button>
          <div class="sonora-import__examples">
            <button class="sonora-import__example" data-fill="https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M">Ejemplo: Éxitos de Spotify</button>
          </div>
          <div id="si-msg"></div>
          <div class="sonora-import__hint" id="si-hint">
            <b>Sin contraseñas y sin claves API.</b> Sonora lee la ficha pública que Spotify
            muestra a cualquier visitante, así que la playlist debe ser pública. Después busca
            cada canción en YouTube para poder reproducirla y descargarla dentro de Sonora.
            Spotify no permite reproducir su audio en otras apps, por eso no se abre Spotify:
            la canción suena desde Sonora.
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    var service = 'spotify';
    var urlInput = $('#si-url', overlay);
    if (prefill) urlInput.value = prefill;

    function close() { overlay.remove(); }

    $('#si-close', overlay).addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', onEsc);
        return;
      }
      if (e.key === 'Escape') close();
    });

    Array.prototype.forEach.call(overlay.querySelectorAll('.sonora-import__tab'), function (tab) {
      tab.addEventListener('click', function () {
        if (_busy) return;
        service = tab.getAttribute('data-service');
        Array.prototype.forEach.call(overlay.querySelectorAll('.sonora-import__tab'), function (t) {
          t.classList.toggle('is-active', t === tab);
        });
        var badge = $('#si-badge', overlay);
        badge.textContent = service === 'spotify' ? '🎧' : '▶️';
        badge.classList.toggle('sonora-import__badge--yt', service === 'youtube');
        urlInput.placeholder = service === 'spotify'
          ? 'https://open.spotify.com/playlist/...'
          : 'https://music.youtube.com/playlist?list=...';
        $('#si-hint', overlay).innerHTML = service === 'spotify'
          ? '<b>Sin contraseñas y sin claves API.</b> Sonora lee la ficha pública que Spotify muestra a cualquier visitante, así que la playlist debe ser pública. Después busca cada canción en YouTube para poder reproducirla y descargarla dentro de Sonora. Spotify no permite reproducir su audio en otras apps, por eso no se abre Spotify: la canción suena desde Sonora.'
          : '<b>Experimental.</b> Lee playlists públicas de YouTube Music y usa sus mismos vídeos, así que la reproducción es exacta. Las listas privadas de tu cuenta necesitan iniciar sesión y no se pueden leer sin OAuth.';
        hideMessage();
      });
    });

    Array.prototype.forEach.call(overlay.querySelectorAll('[data-fill]'), function (btn) {
      btn.addEventListener('click', function () {
        urlInput.value = btn.getAttribute('data-fill');
        urlInput.focus();
      });
    });

    $('#si-paste', overlay).addEventListener('click', async function () {
      try {
        var text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          var detected = detectService(text);
          if (detected) {
            var tab = overlay.querySelector('[data-service="' + detected + '"]');
            if (tab && !tab.classList.contains('is-active')) tab.click();
          }
          showMessage('Enlace pegado. Pulsa «Importar playlist».', 'ok');
        }
      } catch (e) {
        showMessage('Tu navegador no deja leer el portapapeles. Mantén pulsado el campo y elige Pegar.', 'error');
      }
    });

    function hideMessage() {
      var box = $('#si-msg', overlay);
      if (box) box.innerHTML = '';
    }

    function showMessage(text, kind) {
      var box = $('#si-msg', overlay);
      if (!box) return;
      box.innerHTML = kind === 'error'
        ? '<div class="sonora-import__error">' + esc(text) + '</div>'
        : (kind === 'ok'
          ? '<div class="sonora-import__progress"><div class="sonora-import__status">' + esc(text) + '</div></div>'
          : '');
    }

    function showProgress(done, total, matched, missing, label) {
      var box = $('#si-msg', overlay);
      if (!box) return;
      var pct = total ? Math.round((done / total) * 100) : 0;
      box.innerHTML =
        '<div class="sonora-import__progress">' +
          '<div class="sonora-import__status">' +
            (label || '') + 'Importando ' + done + ' de ' + total + ' canciones' +
            (matched ? ' · ' + matched + ' listas para sonar' : '') +
            (missing ? ' · ' + missing + ' sin vídeo (se buscarán al reproducir)' : '') +
          '</div>' +
          '<div class="sonora-import__bar"><i style="width:' + pct + '%"></i></div>' +
        '</div>';
    }

    function showDone(result) {
      var box = $('#si-msg', overlay);
      if (!box) return;
      var name = esc(result.playlist.name);
      box.innerHTML =
        '<div class="sonora-import__done">' +
          '<h3>✓ Playlist importada</h3>' +
          '<p>' + name + ' · ' + result.playlist.trackIds.length + ' canciones' +
            (result.missing ? ' · ' + result.missing + ' se buscarán al reproducir' : '') + '</p>' +
          '<button class="sonora-import__open" id="si-open-playlist">Abrir en Sonora</button>' +
        '</div>';
      var openBtn = $('#si-open-playlist', overlay);
      if (openBtn) {
        openBtn.addEventListener('click', function () {
          close();
          try { location.hash = '#/playlists/' + result.playlist.id; } catch (e) {}
        });
      }
    }

    /** Extrae todos los enlaces pegados (uno por línea o separados por espacios). */
    function extractLinks(text) {
      var found = [];
      var re = /(https?:\/\/[^\s,;]+|spotify:[a-z]+:[A-Za-z0-9]+)/gi;
      var m;
      while ((m = re.exec(String(text || '')))) {
        var link = m[1].replace(/[).]+$/, '');
        if (detectService(link) && found.indexOf(link) === -1) found.push(link);
      }
      return found;
    }

    async function doImport() {
      if (_busy) return;
      var links = extractLinks(urlInput.value);
      if (!links.length) {
        showMessage('Pega el enlace de una playlist de Spotify o YouTube Music. También puedes pegar varias, una por línea.', 'error');
        return;
      }

      _busy = true;
      var go = $('#si-go', overlay);
      go.disabled = true;
      go.textContent = 'Importando…';
      hideMessage();
      showProgress(0, 0, 0, 0);

      var importedList = [];
      var failedList = [];

      for (var idx = 0; idx < links.length; idx++) {
        var url = links[idx];
        var detected = detectService(url);
        var total = links.length;
        var label = total > 1 ? ('Playlist ' + (idx + 1) + ' de ' + total + ' · ') : '';

        try {
          if (total > 1) {
            var box = $('#si-msg', overlay);
            if (box) box.innerHTML = '<div class="sonora-import__progress"><div class="sonora-import__status">' +
              esc(label + 'leyendo el enlace…') + '</div></div>';
          }
          var result = detected === 'spotify'
            ? await runSpotify(url, function (done, count, matched, missing) {
                showProgress(done, count, matched, missing, label);
              })
            : await runYouTube(url, function (done, count) {
                showProgress(done, count, done, 0, label);
              });
          importedList.push(result);
          notify();
        } catch (e) {
          console.warn('[Import] error', url, e);
          failedList.push({ url: url, message: String((e && e.message) || 'No se pudo importar') });
        }
      }

      _busy = false;
      go.disabled = false;
      go.textContent = 'Importar playlist';

      if (importedList.length === 1 && !failedList.length) {
        showDone(importedList[0]);
        toast('✓ «' + importedList[0].playlist.name + '» importada con ' + importedList[0].playlist.trackIds.length + ' canciones', 'success');
        return;
      }

      var msgBox = $('#si-msg', overlay);
      if (msgBox) {
        var rows = importedList.map(function (r) {
          return '<div class="sonora-import__status">✓ ' + esc(r.playlist.name) + ' · ' + r.playlist.trackIds.length + ' canciones</div>';
        }).concat(failedList.map(function (f) {
          var reason = f.message;
          if (/privad|private/i.test(reason)) reason += ' (usa «Compartir → Copiar enlace»)';
          return '<div class="sonora-import__status" style="color:#ff9aa4;">✕ ' + esc(f.url.slice(0, 48)) + ' — ' + esc(reason) + '</div>';
        })).join('');
        msgBox.innerHTML =
          '<div class="sonora-import__done" style="text-align:left;">' +
            '<h3>' + importedList.length + ' playlist(s) importadas</h3>' +
            rows +
            (importedList.length ? '<button class="sonora-import__open" id="si-open-playlist">Abrir la última</button>' : '') +
          '</div>';
        var openBtn = $('#si-open-playlist', overlay);
        if (openBtn) {
          openBtn.addEventListener('click', function () {
            close();
            location.hash = '#/playlists/' + importedList[importedList.length - 1].playlist.id;
          });
        }
      }
      if (importedList.length) {
        toast('✓ ' + importedList.length + ' playlist(s) importadas' + (failedList.length ? ' · ' + failedList.length + ' fallaron' : ''), failedList.length ? 'warning' : 'success');
      }
    }

    $('#si-go', overlay).addEventListener('click', doImport);
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doImport();
    });
    setTimeout(function () { try { urlInput.focus(); } catch (e) {} }, 80);
  }

  Sonora.Import = {
    open: open,
    detectService: detectService,
    detectPlaylistLink: detectPlaylistLink,
    /**
     * Lista las playlists importadas para que el usuario pueda revisarlas,
     * abrirlas o quitarlas. No hay sesión que cerrar: Sonora nunca guarda
     * contraseñas de Spotify.
     */
    getConnections: async function () {
      var out = { spotify: [], youtube: [] };
      try {
        var all = await Sonora.DB.playlists.getAll();
        (all || []).forEach(function (pl) {
          if (!pl || !pl.importedFrom) return;
          if (out[pl.importedFrom]) out[pl.importedFrom].push(pl);
        });
      } catch (e) {}
      return out;
    },
    removePlaylist: async function (id) {
      try {
        await Sonora.DB.playlists.delete(id);
        notify();
        return true;
      } catch (e) { return false; }
    }
  };
})();
