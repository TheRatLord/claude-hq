// @pure
/**
 * The photo album (photo mode → album, docs/valley/album.md): what a saved photo knows about itself, how the album
 * keeps its size in check, and the words the album writes (captions, places, times of day). Pure: the images live in
 * IndexedDB (farm/albumstore.ts), the pixels are made in farm/photolab.ts, photo mode is farm/photo.ts, the panel
 * hud/album.ts, the farmhouse photo wall scene/interior/photowall.ts.
 *
 *  - `PhotoMeta`: one photo's record (date, place, time of day, weather, season, who is in it, caption, favourite,
 *    the filter and frame it was taken with). `sanitizeMeta` turns anything from storage into a valid record or null.
 *  - Limits: at most `ALBUM_CAP` photos; a new one past the cap prunes the oldest non-favourites (`pruneFor`);
 *    favourites are capped too (`FAV_CAP`) so the album can always make room.
 *  - Words: `timeOfDay`, `weatherWord`, `nearestPlace`, `whoLine`, `autoCaption`, `sanitizeCaption`, `photoFileName`.
 *  - Framing maths: `cropRect` (polaroid square, postcard 3:2), `fitSize` (the 1600 px cap, thumbnails).
 *  - Photo-mode preferences (filter, frame, grid, name tags, timer, also-download): `sanitizePhotoPrefs`.
 */
import type { Season, WeatherKind } from './types.ts';

export const ALBUM_CAP = 120;
/** favourites can't fill the whole album (a new photo must always find room) */
export const FAV_CAP = 60;
/** the farmhouse photo wall shows this many favourites */
export const WALL_SLOTS = 8;
/** stored full-size image: longest edge in px */
export const MAX_EDGE = 1600;
/** stored thumbnail: longest edge in px */
export const THUMB_EDGE = 360;
export const CAPTION_MAX = 80;
/** subjects kept per photo */
export const WHO_MAX = 8;

export type FilterId = 'none' | 'warm' | 'sepia' | 'mono' | 'dreamy' | 'tilt';
export const FILTERS: readonly { id: FilterId; name: string; blurb: string }[] = Object.freeze([
  { id: 'none', name: 'Natural', blurb: 'the valley as it is' },
  { id: 'warm', name: 'Warm film', blurb: 'golden, a little grain, soft corners' },
  { id: 'sepia', name: 'Sepia', blurb: 'an old family album' },
  { id: 'mono', name: 'Black & white', blurb: 'crisp silver gelatin' },
  { id: 'dreamy', name: 'Dreamy', blurb: 'a soft glow round the light' },
  { id: 'tilt', name: 'Tilt-shift', blurb: 'focus on the crosshair, a toy-town blur round it' },
]);
export type FrameId = 'none' | 'polaroid' | 'postcard';
export const FRAMES: readonly { id: FrameId; name: string }[] = Object.freeze([
  { id: 'none', name: 'No frame' },
  { id: 'polaroid', name: 'Polaroid' },
  { id: 'postcard', name: 'Postcard' },
]);
export const TIMERS = [0, 3, 10] as const;
export type TimerSecs = (typeof TIMERS)[number];

export type SubjectKind = 'farmer' | 'helper' | 'villager' | 'pet';
export interface PhotoSubject {
  kind: SubjectKind;
  id: string;
  name: string;
}

export interface PhotoMeta {
  id: string;
  /** when it was taken (ms) */
  at: number;
  /** game hour 0..24 at the time (photo mode can scrub the clock) */
  hour: number;
  season: Season;
  weather: WeatherKind;
  /** where: "the windmill", "the farmhouse (inside)", "Ada's field", "out in the valley" */
  place: string;
  who: PhotoSubject[];
  caption: string;
  fav: boolean;
  /** when it was favourited (the wall shows the latest first); 0 when not */
  favAt: number;
  filter: FilterId;
  frame: FrameId;
  /** stored image size (px) */
  w: number;
  h: number;
}

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const WEATHERS: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];
const KINDS: readonly SubjectKind[] = ['farmer', 'helper', 'villager', 'pet'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

/** control characters, zero-widths, line / paragraph separators and bidi overrides */
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\ufeff]', 'g');
/** Captions: printable, single-spaced, trimmed, at most CAPTION_MAX characters. */
export function sanitizeCaption(s: unknown): string {
  if (typeof s !== 'string') return '';
  const clean = s.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, CAPTION_MAX).join('').trim();
}

/** Any stored value → a valid record, or null (no id, or nothing like a photo). */
export function sanitizeMeta(raw: unknown): PhotoMeta | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 64);
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const at = fin(raw.at, 0);
  if (at <= 0) return null;
  const who: PhotoSubject[] = [];
  if (Array.isArray(raw.who)) {
    for (const s of raw.who) {
      if (!isObj(s) || who.length >= WHO_MAX) continue;
      const sid = str(s.id, 120), name = sanitizeCaption(str(s.name, 60));
      if (sid && name) who.push({ kind: oneOf(s.kind, KINDS, 'farmer'), id: sid, name });
    }
  }
  const fav = raw.fav === true;
  return {
    id, at,
    hour: Math.min(24, Math.max(0, fin(raw.hour, 12))),
    season: oneOf(raw.season, SEASONS, 'summer'),
    weather: oneOf(raw.weather, WEATHERS, 'clear'),
    place: sanitizeCaption(str(raw.place, 80)) || 'the valley',
    who,
    caption: sanitizeCaption(raw.caption),
    fav,
    favAt: fav ? Math.max(0, fin(raw.favAt, at)) : 0,
    filter: oneOf(raw.filter, FILTERS.map((f) => f.id), 'none'),
    frame: oneOf(raw.frame, FRAMES.map((f) => f.id), 'none'),
    w: Math.max(1, Math.min(8192, Math.round(fin(raw.w, 1)))),
    h: Math.max(1, Math.min(8192, Math.round(fin(raw.h, 1)))),
  };
}

/** A fresh id: time-ordered, unique enough per browser (the random part comes from the caller: Math.random). */
export function photoId(at: number, rnd: number): string {
  return `p${Math.max(0, Math.floor(at)).toString(36)}-${Math.floor(Math.abs(rnd) * 36 ** 4).toString(36).padStart(4, '0')}`;
}

/** Newest first (ties by id). */
export function sortNewest(list: readonly PhotoMeta[]): PhotoMeta[] {
  return [...list].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

/**
 * Room for `incoming` new photos: the ids to delete (oldest non-favourites first) so the album stays within `cap`.
 * Returns null when even deleting every non-favourite would not make room (only possible with a cap below FAV_CAP).
 */
export function pruneFor(list: readonly PhotoMeta[], incoming = 1, cap = ALBUM_CAP): string[] | null {
  const over = list.length + incoming - cap;
  if (over <= 0) return [];
  const pool = list.filter((p) => !p.fav).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  if (pool.length < over) return null;
  return pool.slice(0, over).map((p) => p.id);
}

/** Can this photo be made a favourite (the favourites cap)? Un-favouriting is always fine. */
export function canFavourite(list: readonly PhotoMeta[], id: string, cap = FAV_CAP): boolean {
  const p = list.find((x) => x.id === id);
  if (!p) return false;
  if (p.fav) return true;
  return list.filter((x) => x.fav).length < cap;
}

/** The farmhouse wall: favourites, the most recently favourited first, at most `n`. */
export function wallPicks(list: readonly PhotoMeta[], n = WALL_SLOTS): PhotoMeta[] {
  return list.filter((p) => p.fav).sort((a, b) => b.favAt - a.favAt || b.at - a.at).slice(0, n);
}

/** A signature of the wall's picks (the scene rebuilds its textures only when this changes). */
export function wallKey(list: readonly PhotoMeta[], n = WALL_SLOTS): string {
  return wallPicks(list, n).map((p) => p.id).join(',');
}

// ---------------------------------------------------------------------------------------------- words

export type DayPart = 'night' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'golden' | 'dusk' | 'evening';
/** The part of the day for a game hour, and how a caption says it. */
export function timeOfDay(hour: number): { id: DayPart; label: string } {
  const h = ((hour % 24) + 24) % 24;
  if (h < 4.5) return { id: 'night', label: 'late at night' };
  if (h < 7) return { id: 'dawn', label: 'at dawn' };
  if (h < 11) return { id: 'morning', label: 'in the morning' };
  if (h < 14) return { id: 'midday', label: 'at midday' };
  if (h < 17) return { id: 'afternoon', label: 'in the afternoon' };
  if (h < 19) return { id: 'golden', label: 'at golden hour' };
  if (h < 20.5) return { id: 'dusk', label: 'at dusk' };
  if (h < 23) return { id: 'evening', label: 'in the evening' };
  return { id: 'night', label: 'late at night' };
}

/** "10:42" for an hour of day. */
export function hourText(hour: number): string {
  const t = Math.floor((((hour % 24) + 24) % 24) * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function weatherWord(kind: WeatherKind): string {
  return { clear: 'clear skies', cloudy: 'clouds', rain: 'rain', storm: 'a storm', fog: 'fog', snow: 'snow' }[kind];
}
const WEATHER_TAG: Record<WeatherKind, string> = { clear: '', cloudy: 'under the clouds', rain: 'in the rain', storm: 'in the storm', fog: 'in the fog', snow: 'in the snow' };

/** A named place with a reach (m): the photo is "at" the nearest one whose reach covers the spot. */
export interface Place { id: string; name: string; x: number; z: number; r: number }
/** The nearest place covering (x, z) (distance measured against each place's reach), else null. */
export function nearestPlace(x: number, z: number, places: readonly Place[]): Place | null {
  let best: Place | null = null, bestK = Infinity;
  for (const p of places) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > p.r) continue;
    const k = d / Math.max(0.1, p.r);
    if (k < bestK) { bestK = k; best = p; }
  }
  return best;
}

/** Friendly names for the landmarks (world/map.ts STRUCTURE_IDS) and how far each one's "here" reaches. */
export const STRUCTURE_PLACES: Readonly<Record<string, { name: string; r: number }>> = Object.freeze({
  farmhouse: { name: 'the farmhouse', r: 16 }, mailbox: { name: 'the mailbox', r: 5 }, shippingBin: { name: 'the shipping bin', r: 5 },
  noticeboard: { name: 'the noticeboard', r: 6 }, well: { name: 'the village well', r: 8 }, waterTower: { name: 'the water tower', r: 10 },
  barn: { name: 'the barn', r: 15 }, silo: { name: 'the silo', r: 9 }, windmill: { name: 'the windmill', r: 16 }, toolshed: { name: 'the toolshed', r: 6 },
  campfire: { name: 'the campfire', r: 10 }, dock: { name: 'the fishing dock', r: 9 }, bridge: { name: 'the old bridge', r: 12 },
  signpost: { name: 'the signpost', r: 4 }, waterfall: { name: 'the waterfall', r: 22 }, pergola: { name: 'the pergola', r: 8 },
  picnic: { name: 'the picnic meadow', r: 9 }, lookout: { name: 'the stargazing deck', r: 10 }, hotspring: { name: 'the hot spring', r: 9 },
  orchard: { name: 'the honey stand', r: 14 }, stones: { name: 'the standing stones', r: 12 }, haymeadow: { name: 'the hay meadow', r: 13 },
  swingtree: { name: 'the swing tree', r: 10 },
});

/** "Ada", "Ada & Posy", "Ada, Posy & Biscuit", "Ada, Posy & 3 more" */
export function whoLine(who: readonly { name: string }[], max = 3): string {
  const n = who.map((w) => w.name);
  if (!n.length) return '';
  if (n.length === 1) return n[0];
  if (n.length <= max) return `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
  return `${n.slice(0, max - 1).join(', ')} & ${n.length - (max - 1)} more`;
}

/** A first caption, from what the camera knew: "Ada & Posy at the windmill, at golden hour". */
export function autoCaption(m: Pick<PhotoMeta, 'who' | 'place' | 'hour' | 'weather'>): string {
  const who = whoLine(m.who);
  const at = /^(inside|in |on |out |by |up |at )/.test(m.place) ? m.place : `at ${m.place}`;
  const tag = WEATHER_TAG[m.weather] || timeOfDay(m.hour).label;
  return sanitizeCaption(who ? `${who} ${at}, ${tag}` : `${at[0].toUpperCase()}${at.slice(1)}, ${tag}`);
}

/** "Fri 2 Oct 2026" */
export function dateLabel(ms: number): string {
  const d = new Date(ms);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${wd} ${d.getDate()} ${mo} ${d.getFullYear()}`;
}

/** claude-valley-20261002-153012-the-windmill.png */
export function photoFileName(m: Pick<PhotoMeta, 'at' | 'place'>, ext = 'png'): string {
  const d = new Date(m.at);
  const p = (n: number) => String(n).padStart(2, '0');
  const slug = m.place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return `claude-valley-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${slug ? `-${slug}` : ''}.${ext}`;
}

// ---------------------------------------------------------------------------------------------- framing

export interface Rect { x: number; y: number; w: number; h: number }
/** The part of a w×h frame a photo keeps: a centred square for a polaroid, 3:2 for a postcard, all of it otherwise. */
export function cropRect(w: number, h: number, frame: FrameId): Rect {
  const aspect = frame === 'polaroid' ? 1 : frame === 'postcard' ? 3 / 2 : w / Math.max(1, h);
  let cw = w, ch = Math.round(w / aspect);
  if (ch > h) { ch = h; cw = Math.round(h * aspect); }
  return { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), w: cw, h: ch };
}

/** Scale w×h down (never up) so the longest edge is at most `max`. */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(1, w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Who is in the picture: candidates already projected to the crop (sx, sy in 0..1, depth in m, size = their projected
 * height as a fraction of the frame). Off-frame, behind the camera, too small to recognise or too far go; the rest,
 * biggest first, deduplicated by id, at most WHO_MAX.
 */
export interface SubjectCandidate extends PhotoSubject {
  /** head point over the crop (0..1) */
  sx: number; sy: number;
  /** distance along the view (m) */
  depth: number;
  /** projected height as a fraction of the crop's height (the body runs from sy down to sy + size) */
  size: number;
  /** projected half-width as a fraction of the crop's width (0: a point that hides nobody) */
  hw?: number;
}
/**
 * Drop whoever stands behind someone else: their head point falls inside the screen box of a subject more than a
 * metre nearer the camera (people hiding people; buildings and trees are not known here).
 */
export function unoccluded<T extends SubjectCandidate>(cands: readonly T[]): T[] {
  return cands.filter((c) => !cands.some((o) => o !== c && (o.hw ?? 0) > 0 && o.depth < c.depth - 1
    && Math.abs(c.sx - o.sx) < (o.hw ?? 0) * 0.9 && c.sy > o.sy - 0.01 && c.sy < o.sy + o.size));
}
export function framedSubjects(cands: readonly SubjectCandidate[], max = WHO_MAX): SubjectCandidate[] {
  const seen = new Set<string>();
  return unoccluded(cands)
    .filter((c) => c.depth > 0.3 && c.depth < 70 && c.sx >= -0.02 && c.sx <= 1.02 && c.sy >= -0.05 && c.sy <= 1.05 && c.size >= 0.035)
    .sort((a, b) => b.size - a.size)
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .slice(0, max);
}

/** The subject at the crosshair (closest to the centre within `radius` of the frame), for focus and "say cheese". */
export function focusSubject<T extends { sx: number; sy: number; depth: number }>(cands: readonly T[], radius = 0.16): T | null {
  let best: T | null = null, bestD = radius;
  for (const c of cands) {
    if (c.depth <= 0.3 || c.depth > 45) continue;
    const d = Math.hypot(c.sx - 0.5, (c.sy - 0.5) * 0.75);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------- photo-mode prefs

export interface PhotoPrefs {
  filter: FilterId;
  frame: FrameId;
  grid: boolean;
  /** draw the farmers' / villagers' name tags into the picture (off: nameplates hidden, the default) */
  tags: boolean;
  timer: TimerSecs;
  /** also download a PNG (framed) on every save */
  download: boolean;
}
export const DEFAULT_PHOTO_PREFS: Readonly<PhotoPrefs> = Object.freeze({ filter: 'none', frame: 'none', grid: false, tags: false, timer: 0, download: false });
export function sanitizePhotoPrefs(raw: unknown): PhotoPrefs {
  const r = isObj(raw) ? raw : {};
  return {
    filter: oneOf(r.filter, FILTERS.map((f) => f.id), 'none'),
    frame: oneOf(r.frame, FRAMES.map((f) => f.id), 'none'),
    grid: r.grid === true,
    tags: r.tags === true,
    timer: (TIMERS as readonly number[]).includes(r.timer as number) ? (r.timer as TimerSecs) : 0,
    download: r.download === true,
  };
}
/** the next value in a list (wraps) */
export function cycle<T>(all: readonly T[], cur: T, dir: 1 | -1 = 1): T {
  const i = all.indexOf(cur);
  return all[((i < 0 ? 0 : i + dir) + all.length) % all.length];
}
