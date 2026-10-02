// @pure
/**
 * Browser-local preferences: the comfort / accessibility / graphics settings of this machine plus the HUD's view
 * prefs (minimap, toasts, the needs-you strip, the drawer height…). One JSON object in localStorage `valley.hud.prefs`
 * (farm/prefs.ts is the live store; this file is the pure part: the shape, the defaults, sanitising anything that may
 * be in storage, and the small decisions the HUD, the controller and main.ts make from it). Tested in prefs.test.ts.
 *
 * Server settings (`core/settings.ts`: volumes, the terminal, the leader key) roam with the HQ; these stay per browser
 * because they describe this screen, this GPU and this person's comfort.
 */
import type { Status } from '../../../../shared/protocol.ts';
import type { ValleyEventKind } from './types.ts';
import { pickTyped } from '../storage.ts';

/** the rebindable actions (defaults are the original keys: E / F / M / Tab / J, plus the paws: Z waves, T the lantern, and
 *  O for Fern's field notebook) */
export const ACTIONS = Object.freeze(['use', 'alt', 'map', 'ledger', 'mail', 'wave', 'lantern', 'notebook'] as const);
export type Action = (typeof ACTIONS)[number];
export type KeyBindings = Record<Action, string>;
export const DEFAULT_KEYS: Readonly<KeyBindings> = Object.freeze({ use: 'KeyE', alt: 'KeyF', map: 'KeyM', ledger: 'Tab', mail: 'KeyJ', wave: 'KeyZ', lantern: 'KeyT', notebook: 'KeyO' });
export const ACTION_LABEL: Readonly<Record<Action, string>> = Object.freeze({
  use: 'Talk / use', alt: 'Terminal / alt action', map: 'Map', ledger: 'Farm ledger', mail: 'Mailbox', wave: 'Wave', lantern: 'Lantern', notebook: 'Field notebook',
});

/**
 * Keys that already mean something else and cannot be given to an action: walking, the fixed panel keys, photo mode,
 * the dev overlays (event.code → what it does).
 */
export const RESERVED_KEYS: Readonly<Record<string, string>> = Object.freeze({
  KeyW: 'walk', KeyA: 'walk', KeyS: 'walk', KeyD: 'walk', ArrowUp: 'walk', ArrowDown: 'walk', ArrowLeft: 'walk', ArrowRight: 'walk',
  Space: 'hop', ShiftLeft: 'sprint', ShiftRight: 'sprint', Escape: 'menu', Enter: 'confirm',
  KeyB: 'noticeboard', KeyH: 'almanac', KeyK: 'collections', KeyI: 'pockets', KeyQ: 'requests', KeyN: 'minimap', KeyP: 'photo mode', KeyL: 'photo album', KeyG: 'the Gazette',
  KeyC: 'fly down (photo mode)', Slash: 'all keys (?)', F3: 'performance overlay', F4: 'dev overlay', F6: 'dev overlay',
  Digit1: 'answers', Digit2: 'answers', Digit3: 'answers', Digit4: 'answers', Digit5: 'answers', Digit6: 'answers', Digit7: 'answers',
  Digit8: 'answers', Digit9: 'answers', Digit0: 'answers', ControlLeft: 'modifier', ControlRight: 'modifier', AltLeft: 'modifier',
  AltRight: 'modifier', MetaLeft: 'modifier', MetaRight: 'modifier', Backspace: 'typing', CapsLock: 'typing',
});

export type QualityPref = 'low' | 'medium' | 'high';
export type NameplatePref = 'always' | 'near' | 'off';
/** 'system' follows the OS (prefers-reduced-motion) */
export type MotionPref = 'system' | 'on' | 'off';
export type ClockPref = '24h' | '12h';

export interface Prefs {
  // ---- HUD view prefs (the original `valley.hud.prefs`)
  minimap: boolean;
  toasts: boolean;
  hinted: boolean;
  /** the needs-you strip is folded down to its count chip */
  compactStrip: boolean;
  /** terminal drawer height as a fraction of the viewport (0 = default) */
  drawerH: number;
  /** opt-in desktop notifications (needs you / finished) while the window is in the background (notify.ts) */
  notify: boolean;
  /** the open needs-you card tucks itself away to the (pulsing) chip after a while without attention (needs.ts) */
  needsDoze: boolean;
  // ---- controls
  /** mouse look multiplier (1 = the original 0.0022 rad / px) */
  mouseSens: number;
  invertY: boolean;
  /** vertical field of view, degrees */
  fov: number;
  headBob: boolean;
  /** Shift toggles sprint instead of holding it */
  sprintToggle: boolean;
  keys: KeyBindings;
  // ---- graphics
  /** systems size their pools at start: applies on reload (a `?quality=` URL parameter wins) */
  quality: QualityPref;
  /** resolution multiplier on top of the quality's own (0.5–1) */
  renderScale: number;
  shadows: boolean;
  /** rain / snow / leaves / motes amount (0–1) */
  weatherFx: number;
  /** frames per second cap (0 = the display's rate) */
  fpsCap: number;
  /** minutes without input before the valley drops to a slow frame rate (0 = never) */
  idleMin: number;
  // ---- interface
  /** HUD zoom (0.8–1.5) */
  uiScale: number;
  nameplates: NameplatePref;
  /** toast lifetime multiplier (0.5–3) */
  toastK: number;
  clock: ClockPref;
  /** the first-person paws and what they hold (scene/viewmodel) */
  hands: boolean;
  // ---- accessibility
  reducedMotion: MotionPref;
  /** colour-blind-safe status palette, plus a shape on every status mark */
  colorSafe: boolean;
  highContrast: boolean;
  largeText: boolean;
  /** a caption line for the important sound cues */
  captions: boolean;
}

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  minimap: true, toasts: true, hinted: false, compactStrip: false, drawerH: 0, notify: false, needsDoze: true,
  mouseSens: 1, invertY: false, fov: 62, headBob: true, sprintToggle: false, keys: DEFAULT_KEYS,
  quality: 'high', renderScale: 1, shadows: true, weatherFx: 1, fpsCap: 0, idleMin: 10,
  uiScale: 1, nameplates: 'always', toastK: 1, clock: '24h', hands: true,
  reducedMotion: 'system', colorSafe: false, highContrast: false, largeText: false, captions: false,
} satisfies Prefs);

/** numeric ranges (the settings sliders use the same) */
export const RANGES = Object.freeze({
  mouseSens: [0.2, 3], fov: [50, 90], renderScale: [0.5, 1], weatherFx: [0, 1], idleMin: [0, 60], uiScale: [0.8, 1.5], toastK: [0.5, 3], drawerH: [0, 0.96],
} as const satisfies Partial<Record<keyof Prefs, readonly [number, number]>>);
export const FPS_CAPS = Object.freeze([0, 30, 60] as const);
const ENUMS = { quality: ['low', 'medium', 'high'], nameplates: ['always', 'near', 'off'], clock: ['24h', '12h'], reducedMotion: ['system', 'on', 'off'] } as const;

/** Anything in storage (old builds, hand edits, garbage) → a complete, in-range Prefs. */
export function sanitizePrefs(raw: unknown): Prefs {
  const p = pickTyped<Prefs>({ ...DEFAULT_PREFS, keys: { ...DEFAULT_KEYS } }, raw);
  for (const [k, [lo, hi]] of Object.entries(RANGES) as [keyof typeof RANGES, readonly [number, number]][]) p[k] = Math.max(lo, Math.min(hi, p[k]));
  for (const [k, ok] of Object.entries(ENUMS) as [keyof typeof ENUMS, readonly string[]][]) if (!ok.includes(p[k])) (p as unknown as Record<string, unknown>)[k] = DEFAULT_PREFS[k];
  if (!FPS_CAPS.includes(p.fpsCap as (typeof FPS_CAPS)[number])) p.fpsCap = 0;
  p.keys = sanitizeKeys(raw && typeof raw === 'object' ? (raw as { keys?: unknown }).keys : null);
  return p;
}

/** free keys an action falls back to when its default was taken by a binding the player chose (e.g. a new default) */
const SPARE_KEYS = ['KeyR', 'KeyV', 'KeyX', 'KeyY', 'KeyU', 'KeyO', 'KeyF', 'KeyE', 'KeyM', 'KeyJ', 'KeyZ', 'KeyT'];

/**
 * Bindings from storage: unknown actions dropped, reserved / non-string codes fall back to the default. The player's own
 * choices win: an action left on its default whose key a chosen binding took (say a newly added default) moves to a
 * spare key instead of resetting everything; two chosen bindings on one key keep the first.
 */
export function sanitizeKeys(raw: unknown): KeyBindings {
  const out: KeyBindings = { ...DEFAULT_KEYS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const chosen = new Set<Action>();
  for (const a of ACTIONS) {
    const v = (raw as Record<string, unknown>)[a];
    if (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]{1,24}$/.test(v) && !RESERVED_KEYS[v]) { out[a] = v; chosen.add(a); }
  }
  const used = new Set<string>();
  for (const a of ACTIONS) if (chosen.has(a)) { if (used.has(out[a])) { out[a] = DEFAULT_KEYS[a]; chosen.delete(a); } else used.add(out[a]); }
  for (const a of ACTIONS) {
    if (chosen.has(a)) continue;
    const k = !used.has(DEFAULT_KEYS[a]) ? DEFAULT_KEYS[a] : SPARE_KEYS.find((s) => !used.has(s) && !RESERVED_KEYS[s]);
    if (!k) return { ...DEFAULT_KEYS };
    out[a] = k; used.add(k);
  }
  return out;
}

/** What `code` would collide with if given to `action`: another action, a fixed key, or null when it is free. */
export function keyConflict(keys: KeyBindings, action: Action, code: string): { action?: Action; reserved?: string } | null {
  if (RESERVED_KEYS[code]) return { reserved: RESERVED_KEYS[code] };
  for (const a of ACTIONS) if (a !== action && keys[a] === code) return { action: a };
  return null;
}

/** Rebind one action; a conflicting key is refused (the bindings come back unchanged with the reason). */
export function rebind(keys: KeyBindings, action: Action, code: string): { keys: KeyBindings; conflict: ReturnType<typeof keyConflict> } {
  const conflict = keyConflict(keys, action, code);
  return conflict ? { keys, conflict } : { keys: { ...keys, [action]: code }, conflict: null };
}

/** A short label for a KeyboardEvent.code: 'KeyE' → 'E', 'Digit4' → '4', 'Tab' → 'Tab', 'Semicolon' → ';'. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
    Minus: '-', Equal: '=', Backquote: '`', Tab: 'Tab', Space: 'Space', Enter: 'Enter', Delete: 'Del', Insert: 'Ins',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  };
  return named[code] ?? code;
}

/** The clock in the chosen format: 24 h '09:30', 12 h '9:30 am'. */
export function clockText(hour: number, fmt: ClockPref = '24h'): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = String(Math.floor((hour - Math.floor(hour)) * 60)).padStart(2, '0');
  if (fmt === '12h') return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
  return `${String(h).padStart(2, '0')}:${m}`;
}

/** Reduced motion is on when asked for, or when following the system and the OS (or the old roaming setting) asks. */
export function reducedMotion(pref: MotionPref, system: boolean, legacy = false): boolean {
  return pref === 'on' || (pref === 'system' && (system || legacy));
}

/** idle throttle: the frame rate while nobody has touched the valley for `idleMin` minutes */
export const IDLE_FPS = 15;
/** The frame cap to run at: the user's cap, or the idle rate once input has been quiet long enough (null = uncapped). */
export function effectiveFpsCap(p: Pick<Prefs, 'fpsCap' | 'idleMin'>, quietMs: number): number | null {
  if (p.idleMin > 0 && quietMs >= p.idleMin * 60_000) return IDLE_FPS;
  return p.fpsCap > 0 ? p.fpsCap : null;
}

/** metres within which 'near' nameplates show */
export const NEAR_M = 14;
export function nameplateShown(pref: NameplatePref, dist: number): boolean {
  return pref === 'always' || (pref === 'near' && dist <= NEAR_M);
}

/** The HUD zoom: UI scale, a little more for large text. */
export function uiZoom(p: Pick<Prefs, 'uiScale' | 'largeText'>): number {
  return Math.round(p.uiScale * (p.largeText ? 1.15 : 1) * 100) / 100;
}

/** Status palettes: the valley's warm one, and a colour-blind-safe one (Okabe–Ito: orange / bluish green / blue / grey). */
export const STATUS_PALETTE: Readonly<Record<'warm' | 'safe', Readonly<Record<Status, string>>>> = Object.freeze({
  warm: Object.freeze({ blocked: '#f0a72c', working: '#5fae45', done: '#3f95d8', idle: '#b09a78', unknown: '#8d8580' }),
  safe: Object.freeze({ blocked: '#e69f00', working: '#009e73', done: '#0072b2', idle: '#9a9a9a', unknown: '#6f6f6f' }),
});
export function statusColor(st: Status, safe: boolean): string { return STATUS_PALETTE[safe ? 'safe' : 'warm'][st] ?? '#999'; }
/**
 * The shape that goes with each status wherever it shows (map pins, minimap, list dots, pills, nameplates), so status
 * never rests on colour alone: needs-you a triangle with "!", working a circle, done a square with "✓", idle a diamond.
 */
export type StatusShape = 'triangle' | 'circle' | 'square' | 'diamond';
export const STATUS_SHAPE: Readonly<Record<Status, StatusShape>> = Object.freeze({ blocked: 'triangle', working: 'circle', done: 'square', idle: 'diamond', unknown: 'diamond' });
export const STATUS_GLYPH: Readonly<Record<Status, string>> = Object.freeze({ blocked: '▲', working: '●', done: '■', idle: '◆', unknown: '◇' });

/**
 * A caption for an important sound cue (Settings → Accessibility → captions): what the audio layer plays for this valley
 * event (audio/audio.ts: the alert anywhere for needs-you, the done chime, the far cheer / oops, the fanfare), or null
 * for events that make no sound worth reading.
 */
export function captionFor(kind: ValleyEventKind, who: string, detail?: string): { sound: string; text: string; key: string } | null {
  switch (kind) {
    case 'blocked': return { sound: 'Alert bell', text: `${who} needs you`, key: 'blocked' };
    case 'finished': return { sound: 'Done chime', text: `${who} finished`, key: 'finished' };
    case 'celebrate': return { sound: 'Cheer', text: `${who}: tests pass`, key: 'celebrate' };
    case 'oops': return { sound: 'Oops', text: `${who} hit a snag`, key: 'oops' };
    case 'level-up': return { sound: 'Fanfare', text: detail ? `the valley is now ${detail}` : 'the valley grew', key: 'level-up' };
    case 'plot-opened': return { sound: 'Hoe and sparkle', text: 'a new field was tilled', key: 'plot' };
    default: return null;
  }
}
