/**
 * Client platform (§8.2.2). The browser runs on the user's client (maybe a Mac over `ssh -L`), not on the box.
 * `platform.mac` = setting `platform` ('mac'|'other') or auto-detected from the userAgent.
 * Owner: UI.
 */

import type { Settings } from '../core/settings.ts';

/** The part of the settings the platform reads (typed `get` by key; `onChange` gets the changed keys). */
export type SettingsReader = Pick<Settings, 'get' | 'onChange'>;

export interface Platform {
  mac: boolean;
  /** Primary modifier held (Ctrl on Linux/Windows, Cmd on macOS). */
  primary(e: { metaKey: boolean; ctrlKey: boolean }): boolean;
  /** Display name of the primary modifier. */
  readonly primaryLabel: string;
  readonly leaderLabel: string;
}

export function detectMac(nav: { userAgentData?: { platform?: string }; platform?: string } = typeof navigator !== 'undefined' ? navigator : {}): boolean {
  // case-insensitive: Chrome's userAgentData.platform is 'macOS' (lower-case m), navigator.platform is 'MacIntel'
  return /mac/i.test(nav.userAgentData?.platform || nav.platform || '');
}

export function createPlatform(settings: SettingsReader): Platform {
  const p: Platform = {
    mac: false,
    primary: (e) => (p.mac ? e.metaKey : e.ctrlKey),
    get primaryLabel() { return p.mac ? '⌘' : 'Ctrl'; },
    get leaderLabel() {
      const s = settings.get('leaderKey') || 'Ctrl+`';
      return p.mac ? s.replace('Ctrl+', '⌃') : s;
    },
  };
  const apply = () => {
    const s = settings.get('platform');
    p.mac = s === 'mac' ? true : s === 'other' ? false : detectMac();
  };
  apply();
  settings.onChange((c) => { if ('platform' in c) apply(); });
  return p;
}
