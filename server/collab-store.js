/**
 * Sonora Music — Almacenamiento de playlists colaborativas
 *
 * Dos backends:
 *   - postgres  (Supabase, si DATABASE_URL está definido y responde)
 *   - sqlite    (better-sqlite3 local, fallback si no hay nube o falla al arrancar)
 *
 * Reglas importantes:
 *   - Si Postgres arranca bien, es la fuente de verdad: un fallo posterior
 *     devuelve error (503 en la API), nunca un 404 vacío que parezca que la
 *     playlist se borró.
 *   - Caché write-through en memoria para que las lecturas no paguen latencia.
 *   - Lock por código para que dos peticiones simultáneas del mismo proceso no
 *     se pisen al hacer read-modify-write.
 */

'use strict';

const { Pool } = require('pg');

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS collab_playlists (
    code TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  );
`;

const CREATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS collab_playlists_updated_at_idx
    ON collab_playlists (updated_at DESC);
`;

const UPSERT_SQL = `
  INSERT INTO collab_playlists (code, name, description, tracks, created_at, updated_at)
  VALUES ($1, $2, $3, $4::jsonb, $5, $6)
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    tracks = EXCLUDED.tracks,
    updated_at = EXCLUDED.updated_at
`;

const BACKFILL_SQL = `
  INSERT INTO collab_playlists (code, name, description, tracks, created_at, updated_at)
  VALUES ($1, $2, $3, $4::jsonb, $5, $6)
  ON CONFLICT (code) DO NOTHING
  RETURNING code
`;

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const KEEPALIVE_MS = 6 * 60 * 60 * 1000; // 6 h mientras el proceso esté despierto

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function normalizeTracks(tracks) {
  return Array.isArray(tracks) ? tracks : [];
}

/**
 * Postgres devuelve JSONB ya parseado; SQLite devuelve el JSON como texto.
 * Unificamos los dos casos aquí para no perder canciones al reiniciar.
 */
function parseTracks(tracks) {
  if (Array.isArray(tracks)) return tracks;
  if (typeof tracks === 'string') {
    try {
      const parsed = JSON.parse(tracks);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

/**
 * pg >= 8.23 trata `sslmode=require` como `verify-full` e ignora el objeto
 * `ssl`. Quitamos esos parámetros y forzamos TLS explícitamente en el Pool,
 * que además es compatible con el cambio de semántica de pg 9.
 */
function sanitizeConnectionString(raw) {
  return String(raw || '')
    .replace(/([?&])sslmode=[^&]*/gi, '$1')
    .replace(/([?&])uselibpqcompat=[^&]*/gi, '$1')
    .replace(/\?&/g, '?')
    .replace(/&&/g, '&')
    .replace(/[?&]$/, '');
}

function rowToPlaylist(row) {
  if (!row) return null;
  const toIso = (v) => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  return {
    code: row.code,
    name: row.name || 'Playlist Colaborativa',
    description: row.description || '',
    tracks: parseTracks(row.tracks),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

class CollabStore {
  constructor() {
    this.backend = 'sqlite';
    this.reason = 'DATABASE_URL no configurada';
    this.pool = null;
    this.sqlite = null;
    this.cache = new Map();
    this.locks = new Map();
    this.initPromise = null;
    this.keepaliveTimer = null;
    this.reconnectTimer = null;
    this.reconnecting = false;
    this.databaseUrl = '';
  }

  /**
   * @param {object} options
   * @param {{get:Function, save:Function, remove:Function, all:Function, ping?:Function}} options.sqlite
   * @param {string} [options.databaseUrl]  por defecto process.env.DATABASE_URL
   */
  init(options = {}) {
    if (this.initPromise) return this.initPromise;
    this.sqlite = options.sqlite || null;
    this.initPromise = this._init(options.databaseUrl || process.env.DATABASE_URL);
    return this.initPromise;
  }

  async _init(databaseUrl) {
    const url = String(databaseUrl || '').trim();
    this.databaseUrl = url;

    if (!url) {
      this.backend = 'sqlite';
      this.reason = 'DATABASE_URL no configurada';
      console.log('[Collab] storage=sqlite (DATABASE_URL no configurada)');
      return this.status();
    }

    try {
      this.pool = await this._connectPostgres(url);
      this.backend = 'postgres';
      this.reason = 'ok';
      console.log('[Collab] storage=postgres listo');

      await this._backfillFromSqlite();
      this._startKeepalive();
      return this.status();
    } catch (err) {
      this.backend = 'sqlite';
      this.reason = err.message;
      console.warn('[Collab] Postgres no disponible, usando SQLite:', err.message);
      this.pool = null;
      this._startReconnect();
      return this.status();
    }
  }

  async _connectPostgres(url) {
    const pool = new Pool({
      connectionString: sanitizeConnectionString(url),
      // Supabase exige TLS. El pooler presenta certificados válidos, pero no
      // dependemos de la cadena de CA del contenedor.
      ssl: { rejectUnauthorized: false },
      max: 3,
      min: 0,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      query_timeout: 12000,
      keepAlive: true,
      application_name: 'sonora-music'
    });

    pool.on('error', (err) => {
      console.warn('[Collab] Error en conexión inactiva de Postgres:', err.message);
    });

    try {
      await pool.query('SELECT 1');
      await pool.query(CREATE_TABLE_SQL);
      await pool.query(CREATE_INDEX_SQL);
      return pool;
    } catch (err) {
      try { await pool.end(); } catch (_) { /* ignore */ }
      throw err;
    }
  }

  /**
   * Si el arranque no pudo conectar (red, Supabase pausado, DNS...), reintenta
   * cada 5 min. Al recuperar Postgres migra lo que se haya escrito en SQLite
   * durante la caída, para no dejar datos huérfanos en el contenedor.
   */
  _startReconnect() {
    if (this.reconnectTimer || !this.databaseUrl) return;
    const interval = Number(process.env.COLLAB_RETRY_MS) > 0
      ? Number(process.env.COLLAB_RETRY_MS)
      : 5 * 60 * 1000;
    this.reconnectTimer = setInterval(async () => {
      if (this.backend === 'postgres' || this.reconnecting) return;
      this.reconnecting = true;
      try {
        const pool = await this._connectPostgres(this.databaseUrl);
        this.pool = pool;
        this.backend = 'postgres';
        this.reason = 'ok';
        this.cache.clear();
        console.log('[Collab] Postgres recuperado; se abandona SQLite');
        await this._backfillFromSqlite();
        this._startKeepalive();
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = null;
      } catch (err) {
        console.warn('[Collab] Reintento de Postgres falló:', err.message);
      } finally {
        this.reconnecting = false;
      }
    }, interval);
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
  }

  /**
   * Migración idempotente: sube a Postgres las filas locales que aún no estén.
   * En Render no hay disco persistente, pero en local sí sirve para conservar
   * las colaborativas creadas antes de conectar Supabase.
   */
  async _backfillFromSqlite() {
    if (!this.pool || !this.sqlite || typeof this.sqlite.all !== 'function') return;
    let rows = [];
    try {
      rows = this.sqlite.all() || [];
    } catch (err) {
      console.warn('[Collab] No se pudo leer SQLite para migrar:', err.message);
      return;
    }
    if (!rows.length) return;

    let migrated = 0;
    for (const row of rows) {
      const pl = rowToPlaylist(row);
      if (!pl || !pl.code) continue;
      try {
        const result = await this.pool.query(BACKFILL_SQL, [
          pl.code,
          pl.name,
          pl.description,
          JSON.stringify(pl.tracks),
          pl.createdAt,
          pl.updatedAt
        ]);
        migrated += result.rowCount || 0;
      } catch (err) {
        console.warn('[Collab] Fila local no migrada (' + pl.code + '):', err.message);
      }
    }
    if (migrated > 0) {
      console.log(`[Collab] Migradas ${migrated} playlists locales a Postgres`);
    }
  }

  _startKeepalive() {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(() => {
      this.ping().catch((err) => {
        console.warn('[Collab] Keepalive falló:', err.message);
      });
    }, KEEPALIVE_MS);
    if (typeof this.keepaliveTimer.unref === 'function') this.keepaliveTimer.unref();
  }

  status() {
    return {
      backend: this.backend,
      ready: this.backend === 'postgres',
      reason: this.reason
    };
  }

  async ready() {
    if (this.initPromise) await this.initPromise;
    return this.status();
  }

  _cacheGet(key) {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return clone(hit.playlist);
  }

  _cacheSet(key, playlist) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), playlist: clone(playlist) });
  }

  _cacheDelete(key) {
    this.cache.delete(key);
  }

  /**
   * Serializa operaciones por código dentro de este proceso.
   */
  async withLock(key, fn) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    this.locks.set(key, tail);
    try {
      await previous.catch(() => {});
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  async get(rawCode) {
    if (this.initPromise) await this.initPromise;
    const key = String(rawCode || '').toUpperCase().trim();
    if (!key) return null;

    const cached = this._cacheGet(key);
    if (cached !== undefined) return cached;

    let playlist = null;
    if (this.backend === 'postgres') {
      const result = await this.pool.query(
        'SELECT code, name, description, tracks, created_at, updated_at FROM collab_playlists WHERE code = $1',
        [key]
      );
      playlist = rowToPlaylist(result.rows[0]);
    } else {
      const adapter = this.sqlite;
      playlist = adapter ? await adapter.get(key) : null;
    }

    if (playlist) this._cacheSet(key, playlist);
    return playlist;
  }

  async save(playlist) {
    if (this.initPromise) await this.initPromise;
    if (!playlist) return null;

    const key = String(playlist.code || '').toUpperCase().trim();
    if (!key) return null;
    playlist.code = key;

    const record = {
      code: key,
      name: playlist.name || 'Playlist Colaborativa',
      description: playlist.description || '',
      tracks: normalizeTracks(playlist.tracks),
      createdAt: playlist.createdAt || new Date().toISOString(),
      updatedAt: playlist.updatedAt || new Date().toISOString()
    };

    if (this.backend === 'postgres') {
      await this.pool.query(UPSERT_SQL, [
        record.code,
        record.name,
        record.description,
        JSON.stringify(record.tracks),
        record.createdAt,
        record.updatedAt
      ]);
    } else if (this.sqlite) {
      await this.sqlite.save(record);
    }

    this._cacheSet(key, record);
    return record;
  }

  async remove(rawCode) {
    if (this.initPromise) await this.initPromise;
    const key = String(rawCode || '').toUpperCase().trim();
    if (!key) return false;

    if (this.backend === 'postgres') {
      await this.pool.query('DELETE FROM collab_playlists WHERE code = $1', [key]);
    } else if (this.sqlite) {
      await this.sqlite.remove(key);
    }

    this._cacheDelete(key);
    return true;
  }

  async ping() {
    if (this.initPromise) await this.initPromise;
    if (this.backend !== 'postgres' || !this.pool) {
      return { ok: true, backend: this.backend };
    }
    const started = Date.now();
    await this.pool.query('SELECT 1');
    return { ok: true, backend: 'postgres', latencyMs: Date.now() - started };
  }
}

const store = new CollabStore();

module.exports = {
  store,
  CollabStore,
  rowToPlaylist
};
