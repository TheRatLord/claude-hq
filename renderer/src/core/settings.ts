/**
 * Renderer view of the server-persisted settings (`hello.settings`, `settings.set {patch}`).
 * Local-only overrides (URL params) never get written back.
 */
import { DEFAULT_SETTINGS, SETTINGS_KEYS, R2S } from '../../../shared/protocol.ts';
import type { Settings as WireSettings, ClientMsgOf } from '../../../shared/protocol.ts';

export interface Settings {
  get<K extends keyof WireSettings>(k: K): WireSettings[K];
  all(): WireSettings;
  /** optimistic local apply + `settings.set` */
  set(patch: Partial<WireSettings>): void;
  onChange(fn: (changed: Partial<WireSettings>) => void): () => void;
  /** store calls this on hello */
  _applyServer(values: Partial<WireSettings> | null | undefined): void;
}

const isSettingsKey = (k: string): k is keyof WireSettings => SETTINGS_KEYS.some((s) => s === k);

export function createSettings(net: { send?: (msg: ClientMsgOf<'settings.set'>) => void } = {}): Settings {
  const values: WireSettings = { ...DEFAULT_SETTINGS };
  const fns = new Set<(changed: Partial<WireSettings>) => void>();
  const fire = (changed: Partial<WireSettings>) => { for (const f of fns) { try { f(changed); } catch (e) { console.error(e); } } };
  const apply = (patch: Partial<WireSettings> | null | undefined): Partial<WireSettings> => {
    const changed: Partial<WireSettings> = {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (!isSettingsKey(k) || values[k] === v) continue;
      // Object.assign: `k` is a runtime-checked key, so the write cannot be expressed per key; the patch type is the contract.
      Object.assign(values, { [k]: v });
      Object.assign(changed, { [k]: v });
    }
    if (Object.keys(changed).length) fire(changed);
    return changed;
  };
  return {
    get: (k) => values[k],
    all: () => ({ ...values }),
    set(patch) {
      const changed = apply(patch);
      if (Object.keys(changed).length && net.send) net.send({ t: R2S.SETTINGS_SET, patch: changed });
    },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    _applyServer: (v) => { apply(v); },
  };
}
