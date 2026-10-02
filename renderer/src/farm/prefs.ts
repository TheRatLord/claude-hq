/**
 * The live browser-local preferences store (model/prefs.ts has the shape, defaults and sanitising): one object in
 * localStorage `valley.hud.prefs`, read once, written on every change. main.ts creates it and hands it to the HUD,
 * the controller and the engine wiring; anything that cares subscribes with `onChange`.
 */
import { sanitizePrefs, type Prefs } from './model/prefs.ts';
import { readJson, writeJson } from './storage.ts';

export const PREFS_KEY = 'valley.hud.prefs';

export interface PrefsStore {
  /** the live object (HUD code may mutate fields and then call `save()`) */
  readonly data: Prefs;
  /** persist + notify after direct mutation */
  save(): void;
  /** patch, persist, notify */
  set(patch: Partial<Prefs>): void;
  onChange(fn: (p: Prefs) => void): () => void;
}

export function createPrefsStore(key = PREFS_KEY): PrefsStore {
  const data = sanitizePrefs(readJson(key));
  const fns = new Set<(p: Prefs) => void>();
  const save = () => {
    writeJson(key, data);
    for (const f of fns) { try { f(data); } catch (e) { console.error('[prefs] listener', e); } }
  };
  return {
    data,
    save,
    set(patch) { Object.assign(data, patch); save(); },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
}
