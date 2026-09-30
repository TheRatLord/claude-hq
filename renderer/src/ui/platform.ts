/** Client platform detection with the user's explicit settings override. */

import type { Settings } from '../core/settings.ts';

/** The part of the settings the platform reads (typed `get` by key; `onChange` gets the changed keys). */
export type SettingsReader = Pick<Settings, 'get' | 'onChange'>;

export interface Platform {
  mac: boolean;
}

export function detectMac(nav: { userAgentData?: { platform?: string }; platform?: string } = typeof navigator !== 'undefined' ? navigator : {}): boolean {
  // case-insensitive: Chrome's userAgentData.platform is 'macOS' (lower-case m), navigator.platform is 'MacIntel'
  return /mac/i.test(nav.userAgentData?.platform || nav.platform || '');
}

export function createPlatform(settings: SettingsReader): Platform {
  const p: Platform = {
    mac: false,
  };
  const apply = () => {
    const s = settings.get('platform');
    p.mac = s === 'mac' ? true : s === 'other' ? false : detectMac();
  };
  apply();
  settings.onChange((c) => { if ('platform' in c) apply(); });
  return p;
}
