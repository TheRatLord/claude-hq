/**
 * Browser-local persistence (localStorage) for the valley: one key per feature, JSON values. Keys are either
 * `claude-valley.<feature>.v<N>` (model data: almanac, collection, wallet, friends, onboarding, summit…) or
 * `valley.hud.<thing>` (HUD view prefs). Storage can be blocked (private mode, sandboxed iframes) or full: reads then
 * come back empty and HUD writes are dropped, never thrown.
 */

/** A model store port over one key (model/*: `load` is parsed by the model, `save` failures are caught and logged there). */
export interface LocalJson { load(): unknown; save(data: unknown): void }
export function localJson(key: string): LocalJson {
  return {
    load: () => readJson(key),
    save: (data) => localStorage.setItem(key, JSON.stringify(data)),
  };
}

/** the raw string under `key`, or null (missing or storage blocked) */
export function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
/** set `key` (dropped silently when storage is blocked or full) */
export function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}
/** the parsed JSON under `key`, or null (missing, corrupt or storage blocked) */
export function readJson(key: string): unknown {
  const raw = readLocal(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}
/** store `value` as JSON under `key` (dropped silently when storage is blocked or full) */
export function writeJson(key: string, value: unknown): void {
  writeLocal(key, JSON.stringify(value));
}

/**
 * `def` overlaid with the fields of `raw` that have the same type as in `def` (numbers must be finite). A preference
 * object from an older build, a hand-edited value or plain garbage can only ever fill in known keys with sane types.
 */
export function pickTyped<T extends object>(def: T, raw: unknown): T {
  const out = { ...def };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(def) as (keyof T & string)[]) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    const v = (raw as Record<string, unknown>)[k], d = def[k];
    if (typeof v !== typeof d || (typeof v === 'number' && !Number.isFinite(v))) continue;
    out[k] = v as T[typeof k];
  }
  return out;
}
/** the JSON object under `key` read through `pickTyped(def, …)` */
export function readTyped<T extends object>(key: string, def: T): T { return pickTyped(def, readJson(key)); }
