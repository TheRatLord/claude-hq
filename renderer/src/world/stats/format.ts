// @pure
/**
 * Stat formatting + mapping helpers shared by every diegetic stats object (§7.4) and the crosshair tooltip.
 * Units: every "GB" on a plaque is 1024³ bytes, so the numbers match `free -h` ("Gi") and `df -h` ("G") as printed
 * (§11 M3 exit: within 5%). Owner: STAT.
 */
import { aliasOf } from '../../ui/aliases.ts'; // [UI M3.5, cross-owner STAT] renames on every surface
import type { Identity, Stats } from '../../../../shared/protocol.ts';

/** The entity fields the boards read (an `Entity` fits; the tests pass partial rows). */
export interface NamedEntity { id?: string; name?: string; kind?: string; status?: string; statusSince?: number; ack?: unknown; identity?: Identity }
/** A row entity the label helpers can key by id. */
export type IdEntity = NamedEntity & { id: string };

export const GiB = 1024 ** 3;

/** Clamp to [0, 1]. */
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 5.07 → "5.1", 12.4 → "12", 0 → "0". One decimal below 10, integers above. */
export function num(v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return '--';
  const d = digits ?? (Math.abs(v) < 10 ? 1 : 0);
  return v.toFixed(d);
}

/** bytes → "5.1" (GiB, `free -h` style). */
export const gib = (b: number | null | undefined, digits?: number) => num((b ?? 0) / GiB, digits);

/** Bytes as GB with a unit that switches to TB ≥ 1000 GiB. */
export function bytesShort(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return '--';
  const g = b / GiB;
  if (g >= 1000) return `${(g / 1024).toFixed(2)} TB`;
  if (g >= 1) return `${num(g)} GB`;
  const m = b / 1024 ** 2;
  if (m >= 1) return `${num(m)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

/** Byte rate → "1.3 MB/s" / "56 KB/s" / "0 B/s". */
export function rate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return '--';
  if (bps >= 1024 ** 3) return `${num(bps / 1024 ** 3)} GB/s`;
  if (bps >= 1024 ** 2) return `${num(bps / 1024 ** 2)} MB/s`;
  if (bps >= 1024) return `${num(bps / 1024)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

/** Percent → "8%" (one decimal under 10 only when asked). */
export const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '--' : `${Math.round(v)}%`);

/** °C → "68°C". */
export const temp = (c: number | null | undefined) => (c == null || !Number.isFinite(c) ? '--' : `${Math.round(c)}°C`);

/** Uptime seconds → {days, text:"7d 16h", hhmm:"16:57"}. */
export function uptime(s: number | null | undefined): { days: number; text: string; hhmm: string } {
  if (s == null || !Number.isFinite(s)) return { days: 0, text: '--', hhmm: '--:--' };
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { days, text: days ? `${days}d ${h}h` : `${h}h ${m}m`, hhmm };
}

/** Level colour ramp for a 0..1 fill (green → amber → red), as palette-ish hex. */
export function levelColor(f: number, { warn = 0.6, crit = 0.85 }: { warn?: number; crit?: number } = {}): string {
  if (f >= crit) return '#EF5A4C';
  if (f >= warn) return '#F4B860';
  return '#7FE3A0';
}

/** Is a value past its critical threshold? (pulse + red, §7.4) */
export const isCrit = (f: number | null | undefined, crit = 0.9) => f != null && f >= crit;

/**
 * Pulse/log mapping for network rates: 0 at ≤ 1 KB/s, 1 at ≥ 100 MB/s (log10).
 */
export function logRate(bps: number): number {
  if (!(bps > 1024)) return 0;
  return clamp01((Math.log10(bps) - 3) / 5);
}

/** RAM figures (`free` semantics: used = total − available; cache = buff/cache). */
export interface MemFigures {
  used: number; cache: number; total: number; usedF: number; cacheF: number; swapF: number; label: string; cacheLabel: string;
}
export function memFigures(mem: Stats['mem']): MemFigures;
export function memFigures(mem: Stats['mem'] | null | undefined): MemFigures | null;
export function memFigures(mem: Stats['mem'] | null | undefined): MemFigures | null {
  if (!mem) return null;
  const total = mem.total || 1;
  return {
    used: mem.used, cache: mem.cache, total,
    usedF: clamp01(mem.used / total), cacheF: clamp01((mem.used + mem.cache) / total),
    swapF: mem.swapTotal ? clamp01(mem.swapUsed / mem.swapTotal) : 0,
    label: `${gib(mem.used, 1)} / ${gib(total, 0)} GB`,
    cacheLabel: `+${gib(mem.cache)} cache`,
  };
}

/** Disk figures per mount, largest first (plaque `/ 195 / 1874 GB`). */
export function diskFigures(disks: (Pick<Stats['disks'][number], 'mount' | 'total' | 'used'> & { fs?: string })[] | null | undefined) {
  return (disks ?? []).filter((d) => d && d.total > 0).map((d) => ({
    mount: d.mount, fs: d.fs, total: d.total, used: d.used, f: clamp01(d.used / d.total),
    label: `${gib(d.used, d.used / GiB < 10 ? 1 : 0)} / ${gib(d.total, 0)} GB`,
  })).sort((a, b) => b.total - a.total);
}

/**
 * Pull a numeric series out of the stats history ring (≤ 300 samples = 5 min at 1 Hz), for sparklines.
 */
export function series<T>(hist: T[] | null | undefined, pick: (s: T) => number | null | undefined, n = 300): number[] {
  const out: number[] = [];
  const a = hist ?? [];
  for (let i = Math.max(0, a.length - n); i < a.length; i++) {
    let v: number | null | undefined = null;
    try { v = pick(a[i]); } catch { v = null; }
    out.push(v == null || !Number.isFinite(v) ? 0 : v);
  }
  return out;
}

/**
 * Agent groups for the Big Board STATES face: blocked / working / done ✓ (unacked) / idle / shells, with names.
 */
export type StateKey = 'blocked' | 'working' | 'done' | 'idle' | 'shell';
export type StateGroups<E> = Record<StateKey, E[]>;
export function stateGroups<E extends NamedEntity>(entities: Iterable<E | null | undefined>): StateGroups<E> {
  const g: StateGroups<E> = { blocked: [], working: [], done: [], idle: [], shell: [] };
  for (const e of entities) {
    if (!e) continue;
    if (e.kind === 'shell') g.shell.push(e);
    else if (e.status === 'blocked') g.blocked.push(e);
    else if (e.status === 'working') g.working.push(e);
    else if (e.status === 'done' && !e.ack) g.done.push(e);
    else g.idle.push(e); // idle, acked done, unknown
  }
  // oldest first in each (blocked: the longest wait leads)
  for (const list of Object.values(g)) list.sort((a, b) => (a.statusSince ?? 0) - (b.statusSince ?? 0) || String(a.name).localeCompare(String(b.name)));
  return g;
}

/**
 * Board labels that tell same-named agents apart: a name held by more than one entity gets " · 2", " · 3"… in stable
 * id order (the first keeps the bare name), the same "tinker · 2" style the demo uses for renamed twins. A suffixed
 * label never collides with another entity's real name (it skips to the next free number).
 * Returns id → label.
 */
export function boardNames<E extends IdEntity>(entities: Iterable<E | null | undefined>): Map<string, string> {
  const list = [...entities].filter((e): e is E => !!e);
  const byName = new Map<string, E[]>();
  for (const e of list) {
    const n = String(aliasOf(e) ?? e.name ?? e.id); // [UI M3.5, cross-owner STAT] HQ-local renames (ui/aliases.ts, Shift+N)
    let a = byName.get(n);
    if (!a) byName.set(n, (a = []));
    a.push(e);
  }
  const taken = new Set(byName.keys());
  const out = new Map<string, string>();
  const cmp = (a: E, b: E) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  for (const [n, a] of byName) {
    a.sort(cmp);
    out.set(a[0].id, n);
    let k = 2;
    for (let i = 1; i < a.length; i++) {
      while (taken.has(`${n} · ${k}`)) k++;
      const lab = `${n} · ${k++}`;
      taken.add(lab);
      out.set(a[i].id, lab);
    }
  }
  return out;
}

/**
 * [STAT fix m3 r2] A STATES row's names with twins MERGED into a multiplicity: two "claude"s in one row read
 * "claude ×2", never "claude • claude · 2" (whose "2" read as another agent next to the • separators). Order = first
 * appearance (the row's oldest-first order); the name is the HQ alias, else herdr name, else id.
 * [STAT fix m3 r3 art] `o.split` = names that appear in MORE than one row: those twins are not merged but each shows
 * its `o.labels` (boardNames) label, so BLOCKED reads "claude · 2" and WORKING "claude", the same label the toast,
 * chevrons and roster use (merging there would put a bare "claude" in both rows: which one needs you?).
 * `entities` is one state row.
 */
export function rowNames(entities: Iterable<IdEntity | null | undefined>, o: { labels?: Map<string, string>; split?: Set<string> } = {}): string[] {
  const counts = new Map<string, number>();
  for (const e of entities) {
    if (!e) continue;
    const n = String(aliasOf(e) ?? e.name ?? e.id);
    const key = o.split?.has(n) ? `\u0000${o.labels?.get(e.id) ?? n}` : n;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([n, c]) => (n[0] === '\u0000' ? n.slice(1) : c > 1 ? `${n} ×${c}` : n));
}

/**
 * [STAT fix m3 r3 art] Every STATES row's names (rowNames per row): twins inside one row merge into "claude ×2"; a name
 * spread over several rows labels each twin with its boardNames label ("claude · 2" under BLOCKED, "claude" under
 * WORKING). `groups` is stateGroups().
 */
export function statesNames<E extends IdEntity>(groups: Partial<StateGroups<E>>): Record<string, string[]> {
  const rowsOf = new Map<string, Set<string>>();
  for (const [k, list] of Object.entries(groups)) {
    for (const e of list) {
      if (!e) continue;
      const n = String(aliasOf(e) ?? e.name ?? e.id);
      let s = rowsOf.get(n);
      if (!s) rowsOf.set(n, (s = new Set()));
      s.add(k);
    }
  }
  const split = new Set([...rowsOf].filter(([, s]) => s.size > 1).map(([n]) => n));
  const labels = split.size ? boardNames(Object.values(groups).flat()) : undefined;
  const out: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(groups)) out[k] = rowNames(list, { labels, split });
  return out;
}

/**
 * STATES face layout (pure, canvas px): only the populated states get rows, sized by weight to fill the face (capped
 * so one lonely row doesn't turn into a billboard); the empty states fold into one footer line ("nobody blocked ·
 * idle"). Rows are weighted by state importance × head-count. Returns rows [{key, y, h}] + the fold {y, h, keys} (null when every state is populated).
 * `rows` are the state rows in display order.
 */
export function statesLayout(rows: { key: string; w: number }[], groups: Record<string, readonly unknown[]>, top: number, bottom: number, o: { foldH?: number; maxRowH?: number; crowd?: boolean } = {}) {
  const foldH = o.foldH ?? 60, maxRowH = o.maxRowH ?? 210;
  const on = rows.filter((r) => (groups[r.key]?.length ?? 0) > 0);
  const off = rows.filter((r) => !(groups[r.key]?.length ?? 0));
  const avail = bottom - top - (off.length ? foldH : 0);
  // a row's share grows with its head-count (up to 2×), so 5 working names don't get squeezed next to 1 idle one
  // blocked (P1: who needs you) never drops below 1.5× its base share, even with a single name
  // [STAT fix m3 r1] crowd: false → one-line rows: the plain state weights, no head-count growth (level, even rows)
  const crowd = o.crowd ?? true;
  const wt = on.map((r) => (crowd ? r.w * Math.max(r.key === 'blocked' ? 1.5 : 1, Math.min(2, 1 + (groups[r.key].length - 1) * 0.25)) : r.w));
  const sumW = wt.reduce((s, w) => s + w, 0) || 1;
  const hs = wt.map((w) => Math.min(maxRowH, (avail * w) / sumW));
  const used = hs.reduce((s, h) => s + h, 0);
  let y = top + (avail - used) / 2; // centre the block when the rows hit the cap
  const out = on.map((r, i) => { const row = { key: r.key, y, h: hs[i] }; y += hs[i]; return row; });
  return { rows: out, fold: off.length ? { y: bottom - foldH, h: foldH, keys: off.map((r) => r.key) } : null };
}

export interface WeatherState { heatFor: number; heat: number; fog: number }
/** The stats fields the weather reads (a `Stats` fits). */
export interface WeatherInput { cpu?: { load?: number[]; total?: number }; temps?: { cpu?: number | null }; mem?: { swapTotal: number; swapUsed: number } }

/**
 * Macro-stress weather state machine (§7.4): heat when CPU temp or load ≥ 80% for 30 s; fog when swap > 25%; both
 * ease in/out over 20 s. Pure: call with dt seconds.
 */
export function weatherStep(s: WeatherState, stats: WeatherInput | null | undefined, dt: number, cores = 16): WeatherState {
  const load = stats?.cpu?.load?.[0] ?? 0;
  const hot = (stats?.temps?.cpu ?? 0) >= 80 || (stats?.cpu?.total ?? 0) >= 80 || load / Math.max(1, cores) >= 0.8;
  s.heatFor = hot ? s.heatFor + dt : 0;
  const swapF = stats?.mem?.swapTotal ? stats.mem.swapUsed / stats.mem.swapTotal : 0;
  const heatT = s.heatFor >= 30 ? 1 : 0;
  const fogT = swapF > 0.25 ? 1 : 0;
  const k = dt / 20;
  s.heat += Math.max(-k, Math.min(k, heatT - s.heat));
  s.fog += Math.max(-k, Math.min(k, fogT - s.fog));
  return s;
}
