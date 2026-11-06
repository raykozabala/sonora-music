/**
 * Sonora Music — Motor único de letras
 *
 * Objetivos:
 *  - Una sola implementación para el panel de letras y la pantalla completa.
 *  - Sincronización real usando SOLO timestamps LRC (nunca inventar tiempos
 *    a partir de la duración de la canción).
 *  - Coincidencia estricta por título + artista + duración para no mostrar
 *    la letra de otra canción o de otra versión.
 *  - Respuesta rápida: caché en memoria + IndexedDB, proveedores en paralelo
 *    y primera letra sincronizada válida gana.
 *  - Reintentos ante 503/429 (LRCLIB suele responder ServerOverloaded).
 *  - Offset de sincronización por canción, persistido en localStorage.
 *  - Soporte de letras con timestamps por palabra (formato LRC enriquecido).
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var ENGINE_VERSION = 3;
  var MEMORY = Object.create(null);
  var SEQUENCES = Object.create(null);
  var UPGRADE_TRIED = Object.create(null);
  var OFFSET_PREFIX = 'sonora_lyrics_offset::';

  var LRCLIB_GET = 'https://lrclib.net/api/get';
  var LRCLIB_SEARCH = 'https://lrclib.net/api/search';
  var LYRICS_PLUS = 'https://lyricsplus.prjktla.my.id/v2/lyrics/get';
  var LYRICS_OVH = 'https://api.lyrics.ovh/v1';

  var UNKNOWN_ARTISTS = {
    '': 1, 'youtube': 1, 'youtube music': 1, 'sonora': 1, 'sonora music': 1,
    'topic': 1, 'vevo': 1, 'unknown': 1, 'unknown artist': 1,
    'various artists': 1, 'desconocido': 1, 'artista desconocido': 1
  };

  /* ────────────────────────────────────────────────────────────
     Utilidades de texto
     ──────────────────────────────────────────────────────────── */

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function squeeze(value) {
    return safeString(value).replace(/\s+/g, ' ').trim();
  }

  function stripAccents(value) {
    var text = safeString(value);
    try {
      return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {
      return text;
    }
  }

  function lower(value) {
    return stripAccents(value)
      .toLowerCase()
      .replace(/[’'`´]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function words(value) {
    return lower(value)
      .replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ')
      .split(' ')
      .filter(Boolean);
  }

  function escapeHtml(value) {
    return safeString(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function encode(value) {
    return encodeURIComponent(safeString(value));
  }

  // Ruido habitual en títulos de YouTube/Spotify.
  var TITLE_NOISE = /[\(\[\{][^\)\]\}]*(?:official|oficial|lyric|letra|video|audio|visualizer|visualiser|remaster|remastered|hd|hq|4k|8k|en\s*vivo|live|concert|cover|karaoke|instrumental|sped\s*up|slowed|reverb|nightcore|sub(?:titulad[oa]s?)?|traducci[oó]n|espa[nñ]ol|english|ingl[eé]s)[^\)\]\}]*[\)\]\}]/gi;

  function cleanTitle(value) {
    var text = squeeze(value);
    if (!text) return '';

    // "Artista - Canción" pegado en el título.
    text = text.replace(/\s*\|\s*(?:official|oficial|video|audio|lyrics?|letra).*$/i, '');
    text = text.replace(TITLE_NOISE, ' ');
    text = text.replace(/\b(?:official\s*(?:music\s*)?video|official\s*audio|lyric\s*video|visualizer|visualiser|letra|subtitulad[oa]s?|en\s*vivo)\b/gi, ' ');
    text = text.replace(/\s*[-–—]\s*(?:official|oficial|lyric|letra|audio|video)\b.*$/i, ' ');
    text = text.replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.*$/i, ' ');
    text = text.replace(/\s*[-–—]\s*topic\s*$/i, ' ');

    return squeeze(text);
  }

  function cleanArtist(value) {
    var text = squeeze(value);
    if (!text) return '';
    text = text.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');
    text = text.replace(/\s*[-–—]\s*topic\s*$/i, ' ');
    text = text.replace(/\bvevo\b/gi, ' ');
    text = text.replace(/\bofficial\b/gi, ' ');
    return squeeze(text);
  }

  // Palabras que identifican una versión distinta de la misma canción.
  // Si la pista es "Song (Live)", no se debe usar la letra del estudio.
  var VERSION_WORDS_RE = /\b(live|en vivo|remix|cover|karaoke|instrumental|acoustic|demo|sped up|slowed|nightcore|reverb)\b/gi;

  function versionWords(value) {
    var text = lower(value);
    var out = [];
    var match;
    VERSION_WORDS_RE.lastIndex = 0;
    while ((match = VERSION_WORDS_RE.exec(text)) !== null) out.push(match[1]);
    return out;
  }

  function hasVersionMismatch(candidateTitle, requestedVersions) {
    var candidateVersions = versionWords(candidateTitle);
    var requested = requestedVersions || [];

    for (var i = 0; i < candidateVersions.length; i++) {
      if (requested.indexOf(candidateVersions[i]) === -1) return true;
    }
    for (var j = 0; j < requested.length; j++) {
      if (candidateVersions.indexOf(requested[j]) === -1) return true;
    }

    return false;
  }

  function titleSimilarity(a, b) {
    var left = lower(a);
    var right = lower(b);
    if (!left || !right) return 0;
    if (left === right) return 1;

    var leftWords = words(left);
    var rightWords = words(right);
    if (!leftWords.length || !rightWords.length) return 0;

    var smaller = leftWords.length <= rightWords.length ? leftWords : rightWords;
    var bigger = leftWords.length <= rightWords.length ? rightWords : leftWords;
    var map = Object.create(null);
    bigger.forEach(function (word) { map[word] = (map[word] || 0) + 1; });

    var hits = 0;
    smaller.forEach(function (word) {
      if (map[word]) { map[word]--; hits++; }
    });

    var containment = hits / smaller.length;
    var prefix = (left.indexOf(right) === 0 || right.indexOf(left) === 0) ? 0.97 : 0;
    var compactLeft = leftWords.join('');
    var compactRight = rightWords.join('');
    var compact = (compactLeft.indexOf(compactRight) !== -1 || compactRight.indexOf(compactLeft) !== -1) ? 0.92 : 0;

    return Math.max(containment, prefix, compact);
  }

  function artistSimilarity(a, b) {
    var left = lower(a);
    var right = lower(b);
    if (!left || !right) return 0.6;
    if (left === right) return 1;

    var leftWords = words(left);
    var rightWords = words(right);
    if (!leftWords.length || !rightWords.length) return 0.6;

    var smaller = leftWords.length <= rightWords.length ? leftWords : rightWords;
    var bigger = leftWords.length <= rightWords.length ? rightWords : leftWords;
    var map = Object.create(null);
    bigger.forEach(function (word) { map[word] = (map[word] || 0) + 1; });

    var hits = 0;
    smaller.forEach(function (word) {
      if (map[word]) { map[word]--; hits++; }
    });

    return hits / smaller.length;
  }

  /* ────────────────────────────────────────────────────────────
     Preparación de la pista
     ──────────────────────────────────────────────────────────── */

  function genericArtist(value) {
    return !!UNKNOWN_ARTISTS[lower(value)];
  }

  function splitArtistTitle(rawTitle, rawArtist) {
    var title = squeeze(rawTitle);
    var artist = squeeze(rawArtist);

    // Títulos tipo "Artista - Canción" con artista ausente o genérico.
    var parts = title.split(/\s+[-–—]\s+/);
    if (parts.length >= 2 && (genericArtist(artist) || !artist)) {
      var maybeArtist = parts[0].trim();
      if (maybeArtist.length <= 60) {
        artist = maybeArtist;
        title = parts.slice(1).join(' - ').trim();
      }
    }

    // Si el título empieza por el artista, quitarlo.
    if (artist && lower(title).indexOf(lower(artist) + ' - ') === 0) {
      title = title.slice(artist.length + 3).trim();
    }

    // "Artista - Topic" -> "Artista".
    artist = artist.replace(/\s*[-–—]\s*topic\s*$/i, '').trim();

    return { title: title, artist: artist };
  }

  function getDuration(track) {
    var duration = Number(track && track.duration) || 0;
    if (duration > 5) return duration;

    // Si la pista no trae duración, usar la del audio cargado.
    try {
      if (Sonora.Player && typeof Sonora.Player.getProgress === 'function') {
        var progress = Sonora.Player.getProgress();
        if (progress && progress.duration > 5) return Number(progress.duration);
      }
    } catch (e) {}

    return duration > 0 ? duration : 0;
  }

  function cacheKey(track, title, artist) {
    var id = track && track.id !== null && track.id !== undefined ? String(track.id) : '';
    if (id && id !== 'undefined' && id !== 'null') return 'lyr::' + id;
    return 'lyr::' + lower(artist) + '::' + lower(title);
  }

  function prepare(track) {
    var split = splitArtistTitle(track && track.title, track && track.artist);
    var title = cleanTitle(split.title) || split.title || '';
    var artist = cleanArtist(split.artist) || split.artist || '';

    return {
      title: title,
      artist: artist,
      duration: getDuration(track),
      // Palabras de versión del título original (live, remix, cover...).
      versions: versionWords(track && track.title),
      key: cacheKey(track, title, artist)
    };
  }

  /* ────────────────────────────────────────────────────────────
     Caché
     ──────────────────────────────────────────────────────────── */

  function resultFromRecord(record, source) {
    return {
      syncedLyrics: record.syncedLyrics || null,
      plainLyrics: record.plainLyrics || null,
      matchedTitle: record.title || '',
      matchedArtist: record.artist || '',
      matchedDuration: Number(record.duration) || 0,
      source: source || record.source || 'cache',
      score: Number(record.score) || 0,
      cached: true
    };
  }

  function recordMatches(record, prep) {
    if (!record) return false;
    var title = record.title || record.matchedTitle || '';
    var artist = record.artist || record.matchedArtist || '';
    var duration = Number(record.duration || record.matchedDuration || 0);

    if (title) {
      var titleScore = titleSimilarity(prep.title, title);
      if (titleScore < 0.6) return false;

      // Nunca reutilizar la letra de una versión distinta.
      if (hasVersionMismatch(title, prep.versions)) return false;

      var genericRequested = genericArtist(prep.artist);

      if (!genericRequested && prep.artist) {
        // La caché de una canción de otro artista no se debe reutilizar.
        if (!artist) return false;
        if (title && lower(artist).indexOf(lower(title)) !== -1) return false;
        if (artistSimilarity(prep.artist, artist) < 0.45) return false;
      } else if (prep.duration > 0) {
        if (!(duration > 0 && Math.abs(duration - prep.duration) <= 5)) return false;
      }

      if (duration > 0 && prep.duration > 0) {
        var diff = Math.abs(duration - prep.duration);
        if (diff > 12 && titleScore < 0.97) return false;
      }
    }

    return !!(record.syncedLyrics || record.plainLyrics);
  }

  function readCached(track, prep) {
    var out = { trusted: null, legacy: null };

    var memory = MEMORY[prep.key];
    if (memory && Number(memory.engine) >= ENGINE_VERSION && recordMatches(memory, prep)) {
      out.trusted = resultFromRecord(memory, 'memory');
      return Promise.resolve(out);
    }

    var edited = !!(track && (track.lyricsEdited || track._lyricsEdited));
    var engine = Number(track && track._lyricsEngine) || 0;

    if (track && (track.syncedLyrics || track.lyrics)) {
      var inline = {
        syncedLyrics: track.syncedLyrics || null,
        plainLyrics: track.lyrics || null,
        matchedTitle: track.title || '',
        matchedArtist: track.artist || '',
        matchedDuration: Number(track.duration) || 0,
        source: edited ? 'user' : 'track',
        score: 0,
        cached: true
      };
      if (edited || engine >= ENGINE_VERSION) out.trusted = inline;
      else out.legacy = inline;
    }

    if (out.trusted) return Promise.resolve(out);

    var db = Sonora.DB;
    if (!db) return Promise.resolve(out);

    var lyricsStore = db.lyrics && typeof db.lyrics.get === 'function'
      ? db.lyrics.get(prep.key).catch(function () { return null; })
      : Promise.resolve(null);

    return lyricsStore.then(function (record) {
      if (record && Number(record.engine) >= ENGINE_VERSION && recordMatches(record, prep)) {
        out.trusted = resultFromRecord(record, 'db');
        return out;
      }

      if (db.tracks && typeof db.tracks.getById === 'function' && track && track.id !== undefined && track.id !== null) {
        return db.tracks.getById(track.id).catch(function () { return null; }).then(function (dbTrack) {
          if (!dbTrack || (!dbTrack.syncedLyrics && !dbTrack.lyrics)) return out;
          var result = {
            syncedLyrics: dbTrack.syncedLyrics || null,
            plainLyrics: dbTrack.lyrics || null,
            matchedTitle: dbTrack.title || track.title || '',
            matchedArtist: dbTrack.artist || track.artist || '',
            matchedDuration: Number(dbTrack.duration) || Number(track.duration) || 0,
            source: dbTrack.lyricsEdited ? 'user' : 'db',
            score: 0,
            cached: true
          };
          if (dbTrack.lyricsEdited || Number(dbTrack.lyricsEngine) >= ENGINE_VERSION) {
            out.trusted = result;
          } else if (!out.legacy) {
            out.legacy = result;
          }
          return out;
        });
      }

      return out;
    }).catch(function () { return out; });
  }

  function storeRecord(track, result) {
    if (!track || !result) return;

    var prep = prepare(track);
    var record = {
      key: prep.key,
      engine: ENGINE_VERSION,
      title: result.matchedTitle || prep.title,
      artist: result.matchedArtist || prep.artist,
      duration: Number(result.matchedDuration || result.duration || prep.duration) || 0,
      syncedLyrics: result.syncedLyrics || '',
      plainLyrics: result.plainLyrics || '',
      source: result.source || '',
      score: Number(result.score) || 0,
      savedAt: new Date().toISOString()
    };

    if (!record.syncedLyrics && !record.plainLyrics) return;

    MEMORY[prep.key] = record;

    // Nunca pisar una letra editada manualmente por el usuario.
    if (!track.lyricsEdited) {
      if (record.syncedLyrics) track.syncedLyrics = record.syncedLyrics;
      if (record.plainLyrics) track.lyrics = record.plainLyrics;
      track._lyricsEngine = ENGINE_VERSION;
    }

    var db = Sonora.DB;
    if (!db) return;

    if (db.lyrics && typeof db.lyrics.set === 'function') {
      try { db.lyrics.set(record); } catch (e) {}
    }

    if (db.tracks && track.id !== undefined && track.id !== null && typeof db.tracks.getById === 'function') {
      db.tracks.getById(track.id).then(function (dbTrack) {
        if (!dbTrack || dbTrack.lyricsEdited) return;
        dbTrack.syncedLyrics = record.syncedLyrics || dbTrack.syncedLyrics || '';
        dbTrack.lyrics = record.plainLyrics || dbTrack.lyrics || '';
        dbTrack.lyricsEngine = ENGINE_VERSION;
        if (typeof db.tracks.update === 'function') db.tracks.update(dbTrack);
      }).catch(function () {});
    }
  }

  /**
   * Borra todas las letras guardadas (memoria, IndexedDB y campos guardados en
   * las pistas) sin tocar las letras editadas por el usuario ni los offsets.
   */
  function clearCache() {
    Object.keys(MEMORY).forEach(function (k) { delete MEMORY[k]; });
    Object.keys(SEQUENCES).forEach(function (k) { delete SEQUENCES[k]; });
    Object.keys(UPGRADE_TRIED).forEach(function (k) { delete UPGRADE_TRIED[k]; });

    var db = Sonora.DB;
    if (!db) return Promise.resolve(true);

    var jobs = [];
    if (db.lyrics && typeof db.lyrics.clear === 'function') {
      jobs.push(db.lyrics.clear().catch(function () {}));
    }

    if (db.tracks && typeof db.tracks.getAll === 'function' && typeof db.tracks.update === 'function') {
      jobs.push(db.tracks.getAll().then(function (tracks) {
        var pending = [];
        (tracks || []).forEach(function (t) {
          if (!t || t.lyricsEdited) return;
          if (!t.syncedLyrics && !t.lyrics && !t.lyricsEngine) return;
          t.syncedLyrics = '';
          t.lyrics = '';
          t.lyricsEngine = 0;
          pending.push(db.tracks.update(t).catch(function () {}));
        });
        return Promise.all(pending);
      }).catch(function () {}));
    }

    return Promise.all(jobs).then(function () { return true; }).catch(function () { return false; });
  }

  function forget(track) {
    if (!track) return Promise.resolve(false);
    var prep = prepare(track);

    delete MEMORY[prep.key];
    delete SEQUENCES[prep.key];
    delete UPGRADE_TRIED[prep.key];

    track.syncedLyrics = null;
    track.lyrics = null;
    track._lyricsEngine = 0;

    var db = Sonora.DB;
    if (!db) return Promise.resolve(true);

    var jobs = [];
    if (db.lyrics && typeof db.lyrics.delete === 'function') {
      jobs.push(db.lyrics.delete(prep.key).catch(function () {}));
    }
    if (db.tracks && track.id !== undefined && track.id !== null && typeof db.tracks.getById === 'function') {
      jobs.push(db.tracks.getById(track.id).then(function (dbTrack) {
        if (!dbTrack) return;
        dbTrack.syncedLyrics = '';
        dbTrack.lyrics = '';
        dbTrack.lyricsEdited = 0;
        dbTrack.lyricsEngine = 0;
        if (typeof db.tracks.update === 'function') return db.tracks.update(dbTrack);
      }).catch(function () {}));
    }

    return Promise.all(jobs).then(function () { return true; });
  }

  /* ────────────────────────────────────────────────────────────
     Red
     ──────────────────────────────────────────────────────────── */

  function fetchResponse(url, timeoutMs) {
    return new Promise(function (resolve) {
      var finished = false;
      var controller = null;

      try {
        if (typeof AbortController !== 'undefined') controller = new AbortController();
      } catch (e) { controller = null; }

      var timer = setTimeout(function () {
        if (finished) return;
        finished = true;
        try { if (controller) controller.abort(); } catch (e) {}
        resolve(null);
      }, timeoutMs || 4000);

      var options = { cache: 'no-store' };
      if (controller) options.signal = controller.signal;
      fetch(url, options).then(function (response) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(response);
      }).catch(function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  async function getJson(url, timeoutMs, retries) {
    var attempts = typeof retries === 'number' ? retries : 1;

    for (var attempt = 0; attempt <= attempts; attempt++) {
      var response = await fetchResponse(url, timeoutMs || 4000);
      if (!response) {
        if (attempt < attempts) { await sleep(250 * (attempt + 1)); continue; }
        return null;
      }

      if (response.status === 429 || response.status === 503) {
        if (attempt < attempts) {
          var retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
          await sleep(Math.min(2500, (retryAfter > 0 ? retryAfter * 1000 : 700) + attempt * 150));
          continue;
        }
        return null;
      }

      if (!response.ok) return null;

      try { return await response.json(); } catch (e) { return null; }
    }

    return null;
  }

  /* ────────────────────────────────────────────────────────────
     LRC
     ──────────────────────────────────────────────────────────── */

  var CREDIT_RE = /^\s*(?:作词|作曲|制作|编曲|录音|混音|母带|吉他|贝斯|鼓|键盘|和声|策划|出品|监制|发行|词|曲|演唱|原唱|lyrics?\s*by|composed\s*by|written\s*by|produced\s*by|arranged\s*by|music\s*by|songwriters?)\s*[:：]/i;

  function isCreditLine(text) {
    return CREDIT_RE.test(safeString(text));
  }

  function parseTimeTag(minutes, seconds, fraction) {
    var time = (parseInt(minutes, 10) || 0) * 60 + (parseInt(seconds, 10) || 0);
    if (fraction) {
      var digits = String(fraction);
      if (digits.length === 2) time += (parseInt(digits, 10) || 0) / 100;
      else if (digits.length === 1) time += (parseInt(digits, 10) || 0) / 10;
      else time += (parseInt(digits, 10) || 0) / 1000;
    }
    return time;
  }

  function parse(lrcText) {
    var text = safeString(lrcText).replace(/\r/g, '');
    if (!text) return [];

    var globalOffset = 0;
    var offsetMatch = text.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offsetMatch) globalOffset = (parseInt(offsetMatch[1], 10) || 0) / 1000;

    var output = [];
    var rawLines = text.split('\n');
    var timePattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    var wordPattern = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

    for (var i = 0; i < rawLines.length; i++) {
      var rawLine = rawLines[i];
      if (!rawLine || rawLine.indexOf('[') === -1) continue;

      // Ignorar metadatos puros: [ti:...], [ar:...], etc.
      var metaOnly = rawLine.match(/^\s*\[(ti|ar|al|by|re|ve|length|offset|kana|language)\s*:[^\]]*\]\s*$/i);
      if (metaOnly) continue;

      var times = [];
      var match;
      var contentStart = 0;
      timePattern.lastIndex = 0;

      while ((match = timePattern.exec(rawLine)) !== null) {
        // Los timestamps deben ser un prefijo de la línea (o consecutivos).
        if (match.index > contentStart && rawLine.slice(contentStart, match.index).trim() !== '') break;
        times.push(parseTimeTag(match[1], match[2], match[3]));
        contentStart = timePattern.lastIndex;
      }

      if (!times.length) continue;

      var body = rawLine.slice(contentStart);
      var wordList = [];
      var wordMatch;
      var tags = [];
      wordPattern.lastIndex = 0;

      while ((wordMatch = wordPattern.exec(body)) !== null) {
        tags.push({
          start: wordMatch.index,
          end: wordPattern.lastIndex,
          time: parseTimeTag(wordMatch[1], wordMatch[2], wordMatch[3])
        });
      }

      if (tags.length) {
        for (var t = 0; t < tags.length; t++) {
          var from = tags[t].end;
          var to = t + 1 < tags.length ? tags[t + 1].start : body.length;
          var wordText = body.slice(from, to);
          if (!wordText) continue;
          wordList.push({
            time: tags[t].time,
            duration: t + 1 < tags.length ? Math.max(0, tags[t + 1].time - tags[t].time) : 0,
            text: wordText
          });
        }
      }

      var content = body.replace(wordPattern, '').replace(/\s+/g, ' ').trim();
      if (!content) continue;
      if (isCreditLine(content)) continue;

      for (var k = 0; k < times.length; k++) {
        output.push({
          time: times[k] + globalOffset,
          text: content,
          words: wordList.length ? wordList.slice() : null
        });
      }
    }

    output.sort(function (a, b) { return a.time - b.time; });

    // Quitar duplicados exactos (algunas fuentes repiten la misma línea).
    var deduped = [];
    for (var d = 0; d < output.length; d++) {
      var prev = deduped[deduped.length - 1];
      if (prev && Math.abs(prev.time - output[d].time) < 0.001 && prev.text === output[d].text) continue;
      deduped.push(output[d]);
    }

    return deduped;
  }

  function plainLines(text) {
    return safeString(text)
      .replace(/\r/g, '')
      .split('\n')
      .map(function (line) { return line.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim(); })
      .filter(function (line) { return line.length > 0 && !isCreditLine(line); });
  }

  function plainFromSynced(lrcText) {
    var list = plainLines(lrcText);
    return list.length ? list.join('\n') : null;
  }

  function formatLrcTime(seconds) {
    var safe = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(safe / 60);
    var rest = safe - minutes * 60;
    return (minutes < 10 ? '0' : '') + minutes + ':' + (rest < 10 ? '0' : '') + rest.toFixed(2);
  }

  function parseDurationText(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    var text = squeeze(value);
    if (!text) return 0;
    var parts = text.split(':').map(function (part) { return parseFloat(part); });
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    var direct = parseFloat(text);
    return isFinite(direct) ? direct : 0;
  }

  /* ────────────────────────────────────────────────────────────
     Proveedores
     ──────────────────────────────────────────────────────────── */

  function scoreCandidate(candidate, prep) {
    var title = candidate.trackName || candidate.title || '';
    var artist = candidate.artistName || candidate.artist || '';
    var duration = Number(candidate.duration) || 0;
    var genericRequested = genericArtist(prep.artist);
    var hasArtist = !!squeeze(artist);

    var titleScore = titleSimilarity(prep.title, title);
    var artistScore = (!genericRequested && prep.artist && hasArtist)
      ? artistSimilarity(prep.artist, artist)
      : 0.6;

    // Fuentes que etiquetan el artista como "Título - Artista" (p. ej.
    // "Bohemian Rhapsody - Queen"). No es el artista real.
    if (hasArtist && title && lower(artist).indexOf(lower(title)) !== -1) {
      artistScore = Math.min(artistScore, 0.3);
    }

    var durationDiff = (prep.duration > 0 && duration > 0) ? Math.abs(prep.duration - duration) : null;

    var score = titleScore * 70 + artistScore * 20;
    if (durationDiff !== null) score += Math.max(0, 10 - Math.min(10, durationDiff / 2));
    if (candidate.syncedLyrics) {
      score += 8;
      // Las letras con timestamps por palabra son más precisas.
      if (/<\d{1,3}:\d{2}/.test(candidate.syncedLyrics)) score += 6;
    } else if (candidate.plainLyrics) {
      score += 2;
    }

    var ok = true;
    if (!candidate.syncedLyrics && !candidate.plainLyrics) ok = false;
    if (titleScore < 0.58) ok = false;

    // Una versión distinta (live, remix, cover, karaoke...) tiene otra letra
    // y otro tiempo: no se debe usar para esta pista.
    if (hasVersionMismatch(title, prep.versions)) ok = false;

    // Fuentes que no distinguen versiones (lyrics.ovh) no sirven para pistas
    // que piden explícitamente una versión concreta.
    if (candidate.versionAgnostic && prep.versions && prep.versions.length) ok = false;

    // El artista tiene que coincidir. Si la fuente no lo trae o el artista de
    // la pista es genérico, solo se acepta con una duración muy compatible.
    if (!genericRequested && hasArtist) {
      if (artistScore < 0.45) ok = false;
    } else {
      var durationConfirmed = prep.duration > 0 && duration > 0 && Math.abs(prep.duration - duration) <= 5;
      if (!durationConfirmed) ok = false;
    }

    if (durationDiff !== null && durationDiff > 12 && (titleScore < 0.97 || (prep.versions && prep.versions.length))) ok = false;

    // Si la fuente no devolvió título/artista, solo se acepta cuando la
    // duración confirma que es la misma canción. Evita letras de otra pista.
    if (candidate.metadataMissing) {
      var metaDurationConfirmed = prep.duration > 0 && duration > 0 && Math.abs(prep.duration - duration) <= 5;
      if (!metaDurationConfirmed) ok = false;
      else score -= 25;
    }

    return {
      ok: ok,
      score: score,
      titleScore: titleScore,
      artistScore: artistScore,
      durationDiff: durationDiff
    };
  }

  /**
   * Cabeceras de créditos entregadas como primera línea por QQ Music:
   * "Título - Artista", nombre del artista, listas de compositores o líneas
   * con duración casi nula. Nunca deben mostrarse como letra.
   */
  function looksLikeLeadingCredit(text, lineDurationMs, effectiveTitle, effectiveArtist) {
    var low = lower(text);
    if (!low) return true;

    var titleLow = lower(effectiveTitle);
    var artistLow = lower(effectiveArtist);

    if (artistLow && low === artistLow) return true;
    if (titleLow && low === titleLow) return true;

    if (titleLow && artistLow
      && low.indexOf(titleLow) !== -1
      && low.indexOf(artistLow) !== -1
      && text.length <= safeString(effectiveTitle).length + safeString(effectiveArtist).length + 30) {
      return true;
    }

    var slashParts = text.split('/').map(function (part) { return part.trim(); }).filter(Boolean);
    if (slashParts.length >= 2) {
      var personLike = slashParts.every(function (part) {
        // "Jack Antonoff", "Taylor Swift", "Max Martin", "DR"
        var pieces = part.split(/\s+/).filter(Boolean);
        if (!pieces.length || pieces.length > 4) return false;
        return pieces.every(function (piece) {
          return /^[A-ZÀ-Þ][a-zà-ÿ'’.\-]*$/.test(piece) || /^[A-Z]{2,4}$/.test(piece);
        });
      });
      if (personLike) return true;

      if (slashParts.length >= 3) {
        var nameLike = slashParts.filter(function (part) {
          return /^[A-Za-zÀ-ÿ'".\- ]{3,}$/.test(part);
        }).length;
        if (nameLike >= Math.max(2, slashParts.length - 1)) return true;
      }
    }

    var numericDuration = Number(lineDurationMs);
    if (numericDuration > 0 && numericDuration < 200) return true;

    return false;
  }

  function lyricsPlusToResult(data, prep) {
    if (!data || !Array.isArray(data.lyrics) || !data.lyrics.length) return null;

    var meta = data.metadata || {};
    var metaTitle = squeeze(meta.title);
    var metaArtist = squeeze(meta.artist);
    if (lower(metaTitle) === 'none') metaTitle = '';
    if (lower(metaArtist) === 'none') metaArtist = '';
    var title = metaTitle || prep.title;
    var artist = metaArtist || prep.artist;
    var duration = parseDurationText(meta.totalDuration);
    var metadataMissing = !metaTitle || !metaArtist;
    var lines = [];
    var leading = true;

    for (var i = 0; i < data.lyrics.length; i++) {
      var item = data.lyrics[i];
      if (!item) continue;

      var time = Number(item.time);
      if (!isFinite(time) || time < 0) continue;

      var text = squeeze(item.text);
      if (!text || isCreditLine(text)) continue;

      if (leading) {
        if (looksLikeLeadingCredit(text, item.duration, title, artist)) continue;
        leading = false;
      }

      var wordList = null;
      if (Array.isArray(item.syllabus) && item.syllabus.length) {
        wordList = [];
        for (var w = 0; w < item.syllabus.length; w++) {
          var syllable = item.syllabus[w];
          if (!syllable) continue;
          var wordTime = Number(syllable.time);
          if (!isFinite(wordTime)) continue;
          var wordText = safeString(syllable.text);
          if (!wordText) continue;
          wordList.push({
            time: wordTime / 1000,
            duration: (Number(syllable.duration) || 0) / 1000,
            text: wordText
          });
        }
        if (!wordList.length) wordList = null;
      }

      lines.push({
        time: time / 1000,
        text: text,
        words: wordList
      });
    }

    if (!lines.length) return null;
    lines.sort(function (a, b) { return a.time - b.time; });

    var lrc = lines.map(function (line) {
      var head = '[' + formatLrcTime(line.time) + ']';
      var body = line.text;
      if (line.words && line.words.length) {
        body = line.words.map(function (word) {
          return '<' + formatLrcTime(word.time) + '>' + word.text;
        }).join('');
      }
      return head + body;
    }).join('\n');

    return {
      syncedLyrics: lrc,
      plainLyrics: lines.map(function (line) { return line.text; }).join('\n'),
      trackName: title || prep.title,
      artistName: artist || prep.artist,
      duration: duration,
      metadataMissing: metadataMissing,
      source: 'lyricsplus'
    };
  }

  function pickBestCandidate(list, prep) {
    if (!Array.isArray(list) || !list.length) return null;
    var best = null;
    var bestScore = -1;

    for (var i = 0; i < list.length; i++) {
      var candidate = list[i];
      if (!candidate) continue;
      var scored = scoreCandidate({
        syncedLyrics: candidate.syncedLyrics,
        plainLyrics: candidate.plainLyrics,
        trackName: candidate.trackName,
        artistName: candidate.artistName,
        duration: candidate.duration
      }, prep);
      if (!scored.ok) continue;
      if (scored.score > bestScore) {
        bestScore = scored.score;
        best = candidate;
      }
    }

    return best;
  }

  function serverBaseUrl() {
    try {
      if (Sonora.API && typeof Sonora.API.getMediaBase === 'function') {
        return Sonora.API.getMediaBase() || '';
      }
      if (Sonora.API && typeof Sonora.API.getActiveUrl === 'function') {
        return Sonora.API.getActiveUrl() || '';
      }
    } catch (e) {}
    return '';
  }

  function notify(options, result, source) {
    if (!result || !options || typeof options.onPartial !== 'function') return;
    try { options.onPartial(result, source || result.source); } catch (e) {}
  }

  async function requestLyricsPlus(prep) {
    var url = LYRICS_PLUS
      + '?title=' + encode(prep.title)
      + '&artist=' + encode(prep.artist)
      + '&duration=' + Math.round(prep.duration || 0);
    var data = await getJson(url, 6000, 1);
    return lyricsPlusToResult(data, prep);
  }

  async function requestLrclibExact(prep) {
    if (!prep.title) return null;
    var params = '?track_name=' + encode(prep.title);
    if (prep.artist) params += '&artist_name=' + encode(prep.artist);
    if (prep.duration > 0) params += '&duration=' + Math.round(prep.duration);

    var data = await getJson(LRCLIB_GET + params, 4500, 1);
    if (!data || !data.trackName || data.statusCode) return null;
    if (!data.syncedLyrics && !data.plainLyrics) return null;

    return {
      syncedLyrics: data.syncedLyrics || null,
      plainLyrics: data.plainLyrics || null,
      trackName: data.trackName,
      artistName: data.artistName,
      duration: Number(data.duration) || 0,
      source: 'lrclib'
    };
  }

  async function requestLrclibSearch(prep) {
    if (!prep.title) return null;
    var query = (prep.artist ? prep.artist + ' ' : '') + prep.title;
    var data = await getJson(LRCLIB_SEARCH + '?q=' + encode(query), 4000, 1);

    if (!Array.isArray(data) || !data.length) {
      data = await getJson(LRCLIB_SEARCH + '?track_name=' + encode(prep.title), 4000, 0);
    }

    return pickBestCandidate(data, prep);
  }

  async function requestLyricsOvh(prep) {
    if (!prep.title || !prep.artist) return null;
    var data = await getJson(LYRICS_OVH + '/' + encode(prep.artist) + '/' + encode(prep.title), 3500, 0);
    if (!data || !data.lyrics) return null;

    return {
      syncedLyrics: null,
      plainLyrics: safeString(data.lyrics).trim(),
      trackName: prep.title,
      artistName: prep.artist,
      duration: prep.duration,
      // lyrics.ovh no distingue versiones: sólo se usa cuando la pista pedida
      // no declara live/remix/cover/etc.
      versionAgnostic: true,
      source: 'lyricsovh'
    };
  }

  async function requestServer(prep) {
    var base = serverBaseUrl();
    if (!base) return null;

    var query = '/api/lyrics?artist=' + encode(prep.artist) + '&title=' + encode(prep.title);
    if (prep.duration > 0) query += '&duration=' + Math.round(prep.duration);

    var data = await getJson(base.replace(/\/+$/, '') + query, 4500, 1);
    if (!data || (!data.syncedLyrics && !data.plainLyrics)) return null;

    // Los servidores antiguos devolvían letras sin metadatos, a veces de otra
    // canción. Sin metadatos de coincidencia no se acepta nada.
    var hasMetadata = !!(data.matchedTitle || data.matchedArtist || data.matchedDuration || data.matchScore || data.score);
    if (!hasMetadata) return null;

    return {
      syncedLyrics: data.syncedLyrics || null,
      plainLyrics: data.plainLyrics || null,
      trackName: data.matchedTitle || prep.title,
      artistName: data.matchedArtist || prep.artist,
      duration: Number(data.matchedDuration || data.duration || 0),
      source: data.source || 'server'
    };
  }

  function toResult(candidate, prep, fallbackSource) {
    if (!candidate) return null;

    var scored = scoreCandidate(candidate, prep);
    if (!scored.ok) return null;

    return {
      syncedLyrics: candidate.syncedLyrics || null,
      plainLyrics: candidate.plainLyrics || plainFromSynced(candidate.syncedLyrics),
      matchedTitle: candidate.trackName || candidate.title || prep.title,
      matchedArtist: candidate.artistName || candidate.artist || prep.artist,
      matchedDuration: Number(candidate.duration) || 0,
      source: candidate.source || fallbackSource || '',
      score: scored.score,
      cached: false
    };
  }

  function hasWordTimings(lrc) {
    return /<\d{1,3}:\d{2}/.test(lrc || '');
  }

  /**
   * Mejora en segundo plano una letra que solo tiene tiempos por línea a otra
   * con tiempos por palabra (LyricsPlus). Se hace una sola vez por pista y
   * sesión, y solo si la vista sigue mostrando esa misma pista.
   */
  function upgradeToWordLevel(track, prep, options, alive, minScore) {
    if (UPGRADE_TRIED[prep.key]) return;
    UPGRADE_TRIED[prep.key] = true;

    setTimeout(function () {
      if (!alive()) return;

      var current = MEMORY[prep.key];
      if (current && hasWordTimings(current.syncedLyrics)) return;

      requestLyricsPlus(prep).then(function (candidate) {
        if (!alive() || !candidate) return;

        var result = toResult(candidate, prep, 'lyricsplus');
        if (!result || !result.syncedLyrics || !hasWordTimings(result.syncedLyrics)) return;
        if (Number(result.score) < (Number(minScore) || 0) - 8) return;

        // Otra ruta pudo haber mejorado la letra mientras esta petición
        // estaba en vuelo; evitar repintar dos veces lo mismo.
        var latest = MEMORY[prep.key];
        if (latest && hasWordTimings(latest.syncedLyrics)) return;

        storeRecord(track, result);
        notify(options, result, result.source);
      }).catch(function () {});
    }, 850);
  }

  function networkResolve(track, prep, options, alive, cache) {
    return new Promise(function (resolve) {
      var settled = false;
      var bestPlain = null;
      var bestSynced = null;
      var syncedGraceTimer = null;
      var safetyTimer = null;
      var upgradeUntil = 0;
      var upgraded = false;
      var finalResult = null;

      function finish(result) {
        if (settled) return;
        settled = true;
        if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
        if (syncedGraceTimer) { clearTimeout(syncedGraceTimer); syncedGraceTimer = null; }
        if (!alive()) return;
        var final = result || bestSynced || bestPlain || null;
        finalResult = final;
        if (final) storeRecord(track, final);
        resolve(final);

        // Si mostramos una letra sincronizada solo por línea, seguimos
        // escuchando unos segundos por si llega una versión con tiempos por
        // palabra. La vista se actualiza en cuanto aparece.
        if (final && final.syncedLyrics && !hasWordTimings(final.syncedLyrics)) {
          upgradeUntil = Date.now() + 3500;
          upgradeToWordLevel(track, prep, options, alive, final.score);
        }
      }

      function consider(candidate, source) {
        if (!alive() || !candidate) return;

        var result = toResult(candidate, prep, source);
        if (!result) return;

        if (settled) {
          // Ventana de mejora: solo se acepta una versión mejor (palabra por
          // palabra) y de puntuación similar, para no cambiar a otra canción.
          if (!upgradeUntil || upgraded || Date.now() > upgradeUntil) return;
          if (!result.syncedLyrics || !hasWordTimings(result.syncedLyrics)) return;
          if (result.score < (Number(finalResult && finalResult.score) || 0) - 8) return;

          upgraded = true;
          storeRecord(track, result);
          notify(options, result, result.source);
          return;
        }

        if (result.syncedLyrics) {
          // Las letras con timestamps por palabra son la mejor opción. Si la
          // primera que llega es solo por línea, se muestra de inmediato y
          // luego se intenta mejorar en segundo plano.
          if (hasWordTimings(result.syncedLyrics) || !bestSynced) {
            bestSynced = result;
          }

          if (hasWordTimings(result.syncedLyrics)) {
            finish(result);
            return;
          }

          if (!syncedGraceTimer) {
            // Espera breve por si LyricsPlus (palabra por palabra) responde
            // casi al mismo tiempo; 650 ms no se nota en la interfaz.
            syncedGraceTimer = setTimeout(function () {
              finish(bestSynced);
            }, 650);
          }
          return;
        }

        if (result.plainLyrics && !bestPlain) {
          bestPlain = result;
          notify(options, result, source);
        }
      }

      var tasks = [
        requestLyricsPlus(prep).then(function (c) { consider(c, 'lyricsplus'); }),
        requestLrclibExact(prep).then(function (c) { consider(c, 'lrclib'); }),
        requestLrclibSearch(prep).then(function (c) { consider(c, 'lrclib-search'); }),
        requestLyricsOvh(prep).then(function (c) { consider(c, 'lyricsovh'); }),
        requestServer(prep).then(function (c) { consider(c, 'server'); })
      ];

      // Ninguna pista debe quedarse cargando para siempre.
      safetyTimer = setTimeout(function () {
        finish(bestSynced || bestPlain || (cache && cache.trusted) || null);
      }, 6500);

      var remaining = tasks.length;
      tasks.forEach(function (task) {
        task.then(function () {
          remaining--;
          if (remaining <= 0) finish(bestSynced || bestPlain);
        }).catch(function () {
          remaining--;
          if (remaining <= 0) finish(bestSynced || bestPlain);
        });
      });
    });
  }

  /**
   * Si solo había letra plana, seguir buscando en segundo plano una versión
   * sincronizada. Cuando aparece, se avisa con onPartial para que la vista
   * cambie de plana a sincronizada sin volver a pulsar nada.
   */
  function lateSyncUpgrade(track, prep, options, alive) {
    setTimeout(function () {
      if (!alive()) return;

      var settled = false;

      function accept(candidate, source) {
        if (settled || !alive() || !candidate || !candidate.syncedLyrics) return;

        var result = toResult(candidate, prep, source);
        if (!result || !result.syncedLyrics) return;

        settled = true;
        storeRecord(track, result);
        notify(options, result, result.source);
      }

      var tasks = [
        requestLyricsPlus(prep).then(function (c) { accept(c, 'lyricsplus'); }),
        requestLrclibExact(prep).then(function (c) { accept(c, 'lrclib'); }),
        requestLrclibSearch(prep).then(function (c) { accept(c, 'lrclib-search'); })
      ];

      Promise.all(tasks.map(function (task) {
        return task.catch(function () { return null; });
      }));
    }, 700);
  }

  /**
   * Resuelve la letra de una pista.
   *
   * @param {Object} track
   * @param {Object} [options]
   * @param {boolean} [options.force] Ignora la caché sincronizada y vuelve a buscar.
   * @param {Function} [options.onPartial] Se llama en cuanto hay una letra
   *        (plana o sincronizada) para pintarla sin esperar al resto.
   * @returns {Promise<Object|null>}
   */
  function resolve(track, options) {
    options = options || {};
    if (!track) return Promise.resolve(null);

    var prep = prepare(track);
    var token = (SEQUENCES[prep.key] || 0) + 1;
    SEQUENCES[prep.key] = token;

    function alive() { return SEQUENCES[prep.key] === token; }

    return readCached(track, prep).then(function (cache) {
      if (!alive()) return null;

      if (cache.trusted) notify(options, cache.trusted, cache.trusted.source);

      // Una letra editada por el usuario siempre manda: no se vuelve a buscar
      // ni se reemplaza por una versión automática. Para descartarla existe
      // "Restablecer y buscar de nuevo".
      if (cache.trusted && cache.trusted.source === 'user') {
        return cache.trusted;
      }

      if (cache.trusted && cache.trusted.syncedLyrics && !options.force) {
        // Si la letra guardada solo tiene tiempos por línea, intentar en
        // segundo plano la versión con tiempos por palabra sin bloquear.
        if (!hasWordTimings(cache.trusted.syncedLyrics)) {
          upgradeToWordLevel(track, prep, options, alive, cache.trusted.score);
        }
        return cache.trusted;
      }

      // Si no hay resultado nuevo, es preferible no mostrar nada antes que
      // reutilizar una letra antigua sin metadatos que podría ser de otra
      // canción. La caché antigua queda como "legacy" y no se pinta.
      return networkResolve(track, prep, options, alive, cache).then(function (result) {
        if (!alive()) return null;

        var final = result || cache.trusted || null;

        // Si solo se encontró letra plana, seguir buscando en segundo plano
        // una versión con timestamps reales y actualizar la vista al llegar.
        if (final && !final.syncedLyrics) {
          lateSyncUpgrade(track, prep, options, alive);
        }

        return final;
      });
    });
  }

  /* ────────────────────────────────────────────────────────────
     Render + sincronización
     ──────────────────────────────────────────────────────────── */

  function renderLines(container, lines, options) {
    options = options || {};
    if (!container) return [];
    if (!Array.isArray(lines)) lines = [];

    var lineClass = options.lineClass || 'lyrics-line';
    var idPrefix = options.idPrefix || 'lyric-line-';
    var wordSync = options.wordSync !== false;

    var html = lines.map(function (line, index) {
      var inner;

      if (wordSync && line.words && line.words.length) {
        inner = line.words.map(function (word, wordIndex) {
          return '<span class="lyr-word" data-w="' + wordIndex
            + '" data-t="' + word.time + '">'
            + escapeHtml(word.text) + '</span>';
        }).join('');
      } else {
        inner = escapeHtml(line.text || '♪');
      }

      return '<div class="' + lineClass + '" id="' + idPrefix + index
        + '" data-idx="' + index + '" data-time="' + line.time + '">'
        + inner + '</div>';
    }).join('');

    container.innerHTML = html + (options.tail ? '<div class="lyrics-tail-space"></div>' : '');

    return container.querySelectorAll('.' + lineClass);
  }

  function findActiveIndex(lines, time) {
    var low = 0;
    var high = lines.length - 1;
    var answer = -1;

    while (low <= high) {
      var middle = (low + high) >> 1;
      if (lines[middle].time <= time + 0.06) {
        answer = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return answer;
  }

  function findActiveWord(wordList, time) {
    var low = 0;
    var high = wordList.length - 1;
    var answer = -1;

    while (low <= high) {
      var middle = (low + high) >> 1;
      if (wordList[middle].time <= time + 0.02) {
        answer = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return answer;
  }

  function createSync(options) {
    options = options || {};

    var container = options.container || null;
    var scrollTarget = options.scrollTarget || container;
    var lines = options.lines || [];
    var lineEls = options.lineEls || [];
    var offset = Number(options.offset) || 0;
    var autoScroll = options.autoScroll !== false;
    var onActive = typeof options.onActive === 'function' ? options.onActive : function () {};
    var onUserScroll = typeof options.onUserScroll === 'function' ? options.onUserScroll : function () {};

    var rafId = null;
    var fallbackTimer = null;
    var lastTick = 0;
    var destroyed = false;
    var activeIndex = -1;
    var activeWord = -1;
    var programmaticUntil = 0;

    function getTime() {
      if (typeof options.getTime === 'function') {
        try { return Number(options.getTime()) || 0; } catch (e) { return 0; }
      }

      if (Sonora.Player && typeof Sonora.Player.getCurrentTime === 'function') {
        return Number(Sonora.Player.getCurrentTime()) || 0;
      }

      if (Sonora.Player && typeof Sonora.Player.getProgress === 'function') {
        var progress = Sonora.Player.getProgress();
        return progress ? Number(progress.current) || 0 : 0;
      }

      return 0;
    }

    function scrollToLine(element, smooth) {
      if (!element || !scrollTarget) return;

      var containerRect = scrollTarget.getBoundingClientRect();
      var lineRect = element.getBoundingClientRect();
      var delta = (lineRect.top - containerRect.top)
        + (lineRect.height / 2)
        - (scrollTarget.clientHeight / 2);
      var target = Math.max(0, scrollTarget.scrollTop + delta);

      programmaticUntil = Date.now() + (smooth ? 900 : 150);

      try {
        scrollTarget.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
      } catch (e) {
        scrollTarget.scrollTop = target;
      }
    }

    function paintWords(index, time) {
      if (index < 0 || !lineEls[index]) return;
      var line = lines[index];
      if (!line || !line.words || !line.words.length) return;

      var wordIndex = findActiveWord(line.words, time);
      if (wordIndex === activeWord) return;
      activeWord = wordIndex;

      var wordEls = lineEls[index].querySelectorAll('.lyr-word');
      for (var i = 0; i < wordEls.length; i++) {
        wordEls[i].classList.toggle('sung', i <= wordIndex);
      }
    }

    function update() {
      var time = getTime() + offset;
      var index = findActiveIndex(lines, time);

      if (index !== activeIndex) {
        // Al retroceder o saltar de línea (seek), borrar el resaltado por
        // palabra de las líneas que quedaron "cantadas" más adelante.
        var jumped = index < activeIndex || index > activeIndex + 1;
        if (jumped && container && container.querySelectorAll) {
          var sungEls = container.querySelectorAll('.lyr-word.sung');
          for (var s = 0; s < sungEls.length; s++) sungEls[s].classList.remove('sung');
        }

        activeIndex = index;
        activeWord = -1;

        for (var i = 0; i < lineEls.length; i++) {
          if (lineEls[i]) lineEls[i].classList.toggle('active', i === index);
        }

        if (index >= 0) {
          var line = lines[index];
          if (line.words && line.words.length) {
            var wordsEls = lineEls[index].querySelectorAll('.lyr-word');
            for (var w = 0; w < wordsEls.length; w++) wordsEls[w].classList.remove('sung');
          }

          if (autoScroll) scrollToLine(lineEls[index], true);
          try { onActive(index, line); } catch (e) {}
        }
      }

      if (index >= 0) paintWords(index, time);
    }

    function tick() {
      if (destroyed) return;
      lastTick = Date.now();
      update();
      rafId = requestAnimationFrame(tick);
    }

    function handleScroll() {
      if (destroyed) return;
      if (Date.now() < programmaticUntil) return;
      if (autoScroll) {
        autoScroll = false;
        try { onUserScroll(); } catch (e) {}
      }
    }

    if (scrollTarget && scrollTarget.addEventListener) {
      scrollTarget.addEventListener('scroll', handleScroll, { passive: true });
    }

    // Primer pintado inmediato y arranque del bucle de tiempo real.
    var initial = findActiveIndex(lines, getTime() + offset);
    if (initial >= 0) {
      activeIndex = initial;
      for (var j = 0; j < lineEls.length; j++) {
        if (lineEls[j]) lineEls[j].classList.toggle('active', j === initial);
      }
      paintWords(initial, getTime() + offset);
      scrollToLine(lineEls[initial], false);
    }

    tick();

    // Respaldo: algunos WebView o pestañas en segundo plano congelan
    // requestAnimationFrame. Sin esto, la letra dejaría de avanzar.
    fallbackTimer = setInterval(function () {
      if (destroyed) return;
      if (Date.now() - lastTick > 200) {
        lastTick = Date.now();
        update();
      }
    }, 250);

    return {
      setOffset: function (value) {
        offset = Number(value) || 0;
        activeIndex = -2; // fuerza repintado en el siguiente frame
        activeWord = -1;
      },
      setAutoScroll: function (value) {
        autoScroll = !!value;
      },
      isAutoScroll: function () { return autoScroll; },
      recenter: function () {
        autoScroll = true;
        if (activeIndex >= 0) scrollToLine(lineEls[activeIndex], true);
        else if (lineEls.length) scrollToLine(lineEls[0], true);
      },
      setLines: function (newLines, newElements) {
        lines = newLines || [];
        lineEls = newElements || [];
        activeIndex = -1;
        activeWord = -1;
      },
      getActiveIndex: function () { return activeIndex; },
      destroy: function () {
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (fallbackTimer) clearInterval(fallbackTimer);
        fallbackTimer = null;
        if (scrollTarget && scrollTarget.removeEventListener) {
          scrollTarget.removeEventListener('scroll', handleScroll);
        }
      }
    };
  }

  /* ────────────────────────────────────────────────────────────
     Offset por canción
     ──────────────────────────────────────────────────────────── */

  function offsetKey(track) {
    var prep = prepare(track);
    var id = track && track.id !== null && track.id !== undefined ? String(track.id) : '';
    return OFFSET_PREFIX + (id || (lower(prep.artist) + '::' + lower(prep.title)));
  }

  function getOffset(track) {
    try {
      var value = parseFloat(localStorage.getItem(offsetKey(track)));
      if (!isFinite(value)) return 0;
      return Math.max(-5, Math.min(5, value));
    } catch (e) {
      return 0;
    }
  }

  function setOffset(track, value) {
    var offset = Math.max(-5, Math.min(5, Number(value) || 0));
    try { localStorage.setItem(offsetKey(track), String(offset)); } catch (e) {}

    try {
      if (Sonora.Store && typeof Sonora.Store.emit === 'function') {
        Sonora.Store.emit('lyricsOffsetChanged', { offset: offset, track: track });
      }
    } catch (e) {}

    return offset;
  }

  /* ────────────────────────────────────────────────────────────
     API pública
     ──────────────────────────────────────────────────────────── */

  Sonora.Lyrics = {
    ENGINE_VERSION: ENGINE_VERSION,
    parse: parse,
    parseLrc: parse,
    plainLines: plainLines,
    plainFromSynced: plainFromSynced,
    prepare: prepare,
    resolve: resolve,
    forget: forget,
    clearCache: clearCache,
    store: storeRecord,
    getOffset: getOffset,
    setOffset: setOffset,
    adjustOffset: function (track, delta) {
      return setOffset(track, getOffset(track) + (Number(delta) || 0));
    },
    renderLines: renderLines,
    createSync: createSync,
    titleSimilarity: titleSimilarity,
    artistSimilarity: artistSimilarity
  };
})();
