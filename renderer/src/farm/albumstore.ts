/**
 * The photo album's storage (docs/valley/album.md): IndexedDB `claude-valley-album` (store `meta`: the record + its
 * thumbnail Blob; store `image`: the full-size Blob, ≤ 1600 px), browser-local like the rest of the player's progress.
 * Records go through `sanitizeMeta` on load (anything may be in storage). Limits from model/album.ts: a new photo past
 * `ALBUM_CAP` prunes the oldest non-favourites first; a quota error prunes a few more and tries once again.
 *
 * Without IndexedDB (blocked storage, some private windows, an old Electron profile) the album keeps the session's
 * photos in memory (`persistent: false`): the panel says so and photo mode suggests the PNG download.
 *
 * Published as service 'album' (`AlbumWallSource` for the farmhouse photo wall) and handed to the HUD.
 */
import type { AlbumWallSource } from './scene/context.ts';
import { pruneFor, sanitizeCaption, sanitizeMeta, sortNewest, wallKey, wallPicks, canFavourite } from './model/album.ts';
import type { PhotoMeta } from './model/album.ts';

const DB = 'claude-valley-album';
const VERSION = 1;

export type AlbumChange = { kind: 'add' | 'update' | 'remove' | 'load'; id?: string };
export interface AddResult { ok: boolean; pruned: string[]; reason?: 'full' | 'storage' }

export interface AlbumService extends AlbumWallSource {
  /** resolves once the stored album is loaded (or storage turned out to be unavailable) */
  readonly ready: Promise<void>;
  /** false: IndexedDB is unavailable, photos live only until the tab closes */
  readonly persistent: boolean;
  /** bumps on every change */
  readonly version: number;
  /** newest first */
  list(): readonly PhotoMeta[];
  get(id: string): PhotoMeta | null;
  thumb(id: string): Blob | null;
  image(id: string): Promise<Blob | null>;
  add(meta: PhotoMeta, image: Blob, thumb: Blob): Promise<AddResult>;
  /** caption (sanitised) and favourite; false when unknown, or the favourites cap says no */
  update(id: string, patch: { caption?: string; fav?: boolean }): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  onChange(fn: (c: AlbumChange) => void): () => void;
}

interface Row { id: string; meta: PhotoMeta; thumb: Blob | null }

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('aborted')); });

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    let settled = false;
    const finish = (d: IDBDatabase | null) => { if (!settled) { settled = true; res(d); } };
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { finish(null); return; }
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('image')) d.createObjectStore('image');
      };
      r.onsuccess = () => finish(r.result);
      r.onerror = () => { console.warn('[album] IndexedDB unavailable', r.error); finish(null); };
      r.onblocked = () => finish(null);
      setTimeout(() => finish(null), 4000);
    } catch (e) { console.warn('[album] IndexedDB unavailable', e); finish(null); }
  });
}

/** `opts.memory`: never touch IndexedDB (tests, `?album=memory`) */
export function createAlbumStore(opts: { memory?: boolean } = {}): AlbumService {
  let db: IDBDatabase | null = null;
  let persistent = false;
  const rows = new Map<string, Row>();
  const images = new Map<string, Blob>();   // memory mode only
  let sorted: PhotoMeta[] = [];
  let version = 0, wallVersion = 0, lastWall = '';
  const subs = new Set<(c: AlbumChange) => void>();
  const changed = (c: AlbumChange) => {
    sorted = sortNewest([...rows.values()].map((r) => r.meta));
    version++;
    const wk = wallKey(sorted);
    if (wk !== lastWall || c.kind === 'load') { lastWall = wk; wallVersion++; }
    for (const f of [...subs]) { try { f(c); } catch (e) { console.error('[album] listener threw', e); } }
  };

  const ready = (async () => {
    if (opts.memory) return;
    db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction('meta', 'readonly');
      const all = await req(tx.objectStore('meta').getAll() as IDBRequest<unknown[]>);
      for (const raw of all) {
        const o = raw as { id?: unknown; meta?: unknown; thumb?: unknown };
        const meta = sanitizeMeta(o?.meta);
        if (!meta || o.id !== meta.id) continue;
        rows.set(meta.id, { id: meta.id, meta, thumb: o.thumb instanceof Blob ? o.thumb : null });
      }
      persistent = true;
    } catch (e) {
      console.warn('[album] could not read the album; this session keeps photos in memory', e);
      db = null;
    }
    changed({ kind: 'load' });
  })();

  async function del(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    for (const id of ids) { rows.delete(id); images.delete(id); }
    if (!db) return;
    try {
      const tx = db.transaction(['meta', 'image'], 'readwrite');
      for (const id of ids) { tx.objectStore('meta').delete(id); tx.objectStore('image').delete(id); }
      await done(tx);
    } catch (e) { console.warn('[album] delete failed', e); }
  }
  async function put(row: Row, image: Blob | null): Promise<void> {
    if (!db) { if (image) images.set(row.id, image); return; }
    const tx = db.transaction(['meta', 'image'], 'readwrite');
    tx.objectStore('meta').put({ id: row.id, meta: row.meta, thumb: row.thumb });
    if (image) tx.objectStore('image').put(image, row.id);
    await done(tx);
  }

  const svc: AlbumService = {
    ready,
    get persistent() { return persistent; },
    get version() { return version; },
    get wallVersion() { return wallVersion; },
    list: () => sorted,
    get: (id) => rows.get(id)?.meta ?? null,
    thumb: (id) => rows.get(id)?.thumb ?? null,
    async image(id) {
      if (!rows.has(id)) return null;
      if (!db) return images.get(id) ?? null;
      try {
        const b = await req(db.transaction('image', 'readonly').objectStore('image').get(id) as IDBRequest<unknown>);
        return b instanceof Blob ? b : null;
      } catch (e) { console.warn('[album] read failed', e); return null; }
    },
    async add(meta0, image, thumb) {
      await ready;
      const meta = sanitizeMeta(meta0);
      if (!meta) return { ok: false, pruned: [], reason: 'storage' };
      const drop = pruneFor(sorted.filter((p) => p.id !== meta.id));
      if (drop === null) return { ok: false, pruned: [], reason: 'full' };
      await del(drop);
      const row: Row = { id: meta.id, meta, thumb };
      const pruned = [...drop];
      try { await put(row, image); }
      catch (e) {
        // probably the quota: make some room (a few more of the oldest non-favourites) and try once more
        console.warn('[album] save failed, pruning and retrying', e);
        const more = sorted.filter((p) => !p.fav && p.id !== meta.id).sort((a, b) => a.at - b.at).slice(0, 10).map((p) => p.id);
        await del(more); pruned.push(...more);
        try { await put(row, image); }
        catch (e2) { console.warn('[album] save failed', e2); changed({ kind: 'remove' }); return { ok: false, pruned, reason: 'storage' }; }
      }
      rows.set(meta.id, row);
      changed({ kind: 'add', id: meta.id });
      return { ok: true, pruned };
    },
    async update(id, patch) {
      const row = rows.get(id);
      if (!row) return false;
      const meta = { ...row.meta };
      if (patch.caption !== undefined) meta.caption = sanitizeCaption(patch.caption);
      if (patch.fav !== undefined && patch.fav !== meta.fav) {
        if (patch.fav && !canFavourite(sorted, id)) return false;
        meta.fav = patch.fav; meta.favAt = patch.fav ? Date.now() : 0;
      }
      const next = { ...row, meta };
      try { if (db) await put(next, null); } catch (e) { console.warn('[album] update failed', e); return false; }
      rows.set(id, next);
      changed({ kind: 'update', id });
      return true;
    },
    async remove(id) {
      if (!rows.has(id)) return false;
      await del([id]);
      changed({ kind: 'remove', id });
      return true;
    },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    wall(n) {
      return wallPicks(sorted, n).map((m) => ({ id: m.id, caption: m.caption, thumb: rows.get(m.id)?.thumb ?? null }));
    },
  };
  return svc;
}
