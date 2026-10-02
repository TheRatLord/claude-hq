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
