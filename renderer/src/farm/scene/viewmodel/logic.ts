// @pure
/**
 * The first-person paws' brain (scene/viewmodel): which item each paw holds, which two-handed mode they are in, which
 * paw a gesture uses, the lantern's automatic / manual state, and the gesture player (one at a time, a queue of one,
 * cooldowns). No three, no DOM: tested in logic.test.ts. viewmodel.ts turns the answers into poses.
 *
 * Priority (two-handed modes take both paws; the lantern is put away for them):
 *   telescope (the summit viewer) > oars (rowing) > push (rolling a snowball) > carry (yard decor) > skate (arms swing)
 *   one-handed: right = rod (fishing) > barn chore (hay / grain / brush) > basket (a find just went in, when the lantern
 *   has the left paw); left = lantern (lit) > basket
 */
import type { HandGesture, HandItem, InteractKind } from '../context.ts';

export type HandMode = 'free' | 'skate' | 'carry' | 'push' | 'oars' | 'telescope';
export type Side = 'left' | 'right' | 'both';
export type LanternMode = 'auto' | 'on' | 'off';

export interface HandsInput {
  /** Settings → Interface → Show hands */
  enabled: boolean;
  /** photo mode (the camera flies free) */
  photo: boolean;
  /** a menu / panel has the input (player.frozen) */
  menu: boolean;
  /** looking through the summit viewer */
  viewing: boolean;
  rowing: boolean;
  skating: boolean;
  /** rolling a snowball (scene/seasons) */
  rolling: boolean;
  /** carrying a yard decor piece (scene/yard) */
  decor: boolean;
  /** forage claimed the rod this frame */
  fishing: boolean;
  /** what the barn chores put in your paw */
  chore: 'hay' | 'grain' | 'brush' | null;
  /** the lantern is lit (`lanternLit`) */
  lantern: boolean;
  /** a find went into the basket a moment ago */
  basket: boolean;
}

export interface HandsOut {
  /** draw the paws at all */
  show: boolean;
  mode: HandMode;
  left: HandItem;
  right: HandItem;
}

export const emptyInput = (): HandsInput => ({
  enabled: true, photo: false, menu: false, viewing: false, rowing: false, skating: false, rolling: false, decor: false,
  fishing: false, chore: null, lantern: false, basket: false,
});
export const emptyOut = (): HandsOut => ({ show: false, mode: 'free', left: 'none', right: 'none' });

/** Which mode and items, written into `out` (no allocation). */
export function resolveHands(i: HandsInput, out: HandsOut): HandsOut {
  out.show = i.enabled && !i.photo && !i.menu;
  out.mode = i.viewing ? 'telescope' : i.rowing ? 'oars' : i.rolling ? 'push' : i.decor ? 'carry' : i.skating ? 'skate' : 'free';
  out.left = 'none'; out.right = 'none';
  if (out.mode !== 'free' && out.mode !== 'skate') return out;
  out.right = i.fishing ? 'rod' : i.chore ?? 'none';
  out.left = i.lantern ? 'lantern' : 'none';
  if (i.basket) {
    if (out.left === 'none') out.left = 'basket';
    else if (out.right === 'none') out.right = 'basket';
  }
  return out;
}

/** The lantern shows (and lights) only on a free paw: put away while both paws are busy */
export const lanternShown = (o: HandsOut): boolean => o.show && o.left === 'lantern';

/** Is this paw free for a gesture? */
const free = (o: HandsOut, s: 'left' | 'right') => (s === 'left' ? o.left : o.right) === 'none';

/** Which paw(s) a gesture uses, or null when none is free (two-handed modes keep both busy). */
export function gestureSide(o: HandsOut, g: HandGesture): Side | null {
  if (!o.show || (o.mode !== 'free' && o.mode !== 'skate')) return null;
  const l = free(o, 'left'), r = free(o, 'right');
  if (g === 'shield' || g === 'cheer') return l && r ? 'both' : r ? 'right' : l ? 'left' : null;
  return r ? 'right' : l ? 'left' : null;
}

/** The gesture for using an interactable (null: none; opening a farmer's card needs no paw). */
export function gestureFor(kind: InteractKind, verb: string): HandGesture | null {
  const v = verb.toLowerCase();
  if (/coin/.test(v)) return 'coin';
  if (/^(pet|pat|scratch|cuddle|brush)\b/.test(v)) return 'pat';
  if (/^(pick|collect|grab|take|scoop|gather|harvest|milk|feed|give|gift)\b/.test(v)) return 'grab';
  if (kind === 'villager') return /^(talk|chat|say|greet)/.test(v) ? 'wave' : null;
  if (kind === 'farmer' || kind === 'helper' || kind === 'plot') return null;
  if (kind === 'animal') return 'pat';
  if (/^(read|look|study|admire|watch|peek|cast|reel|hook|climb|step|enter|go|leave|sit|stand|browse|open)\b/.test(v)) return null;
  return 'poke';
}

/** Is the lantern lit? Automatic: after dusk outdoors. `night` = ctx.lighting.night (0 day … 1 night). */
export function lanternLit(mode: LanternMode, night: number, indoors: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && night > 0.55 && !indoors);
}

/** The lantern key: whatever it shows now, the other (a manual choice). */
export const toggleLantern = (mode: LanternMode, lit: boolean): LanternMode => (lit ? 'off' : 'on');

/** A manual choice lasts until the next dusk or dawn, then it is automatic again. */
export function settleLantern(mode: LanternMode, prevNight: number, night: number): LanternMode {
  return mode !== 'auto' && (prevNight < 0.55) !== (night < 0.55) ? 'auto' : mode;
}

/** gesture lengths, seconds */
export const GESTURE_SECS: Readonly<Record<HandGesture, number>> = Object.freeze({
  grab: 0.85, pat: 1.25, wave: 1.45, cheer: 1.35, shield: 1.1, coin: 1.15, poke: 0.5,
});
/** no repeat within (seconds): a storm's flicker or a field of cheering farmers asks once */
export const GESTURE_COOLDOWN: Readonly<Record<HandGesture, number>> = Object.freeze({
  grab: 0, pat: 0, wave: 0.3, cheer: 6, shield: 3, coin: 0.4, poke: 0,
});

export interface GestureState {
  /** the gesture playing, null when none */
  g: HandGesture | null;
  side: Side | null;
  /** seconds into it */
  t: number;
  /** one queued behind it */
  next: HandGesture | null;
  /** last start time per gesture (seconds, the player's clock) */
  last: Record<HandGesture, number>;
}
export const gestureState = (): GestureState => ({
  g: null, side: null, t: 0, next: null, last: { grab: -1e9, pat: -1e9, wave: -1e9, cheer: -1e9, shield: -1e9, coin: -1e9, poke: -1e9 },
});

/**
 * Ask for a gesture at time `now` (seconds). A storm shield cuts in; anything else waits behind the current one (a
 * queue of one, the latest wins); within its cooldown or with no free paw it is dropped. Returns whether it starts or
 * queued.
 */
export function requestGesture(s: GestureState, g: HandGesture, o: HandsOut, now: number): boolean {
  if (now - s.last[g] < GESTURE_COOLDOWN[g]) return false;
  const side = gestureSide(o, g);
  if (!side) return false;
  if (s.g && g !== 'shield') { s.next = g; return true; }
  s.g = g; s.side = side; s.t = 0; s.last[g] = now;
  return true;
}

/** Advance the gesture player by dt; a finished gesture hands over to the queued one (if a paw is free for it). */
export function stepGesture(s: GestureState, o: HandsOut, dt: number, now: number): void {
  if (!s.g) return;
  // the paw it used got busy (picked up the rod, two-handed mode) or the paws went away: stop
  if (!o.show || !sideStillFree(o, s.side)) { s.g = null; s.side = null; s.next = null; return; }
  s.t += dt;
  if (s.t < GESTURE_SECS[s.g]) return;
  s.g = null; s.side = null;
  const n = s.next;
  s.next = null;
  if (n) { s.last[n] = -1e9; requestGesture(s, n, o, now); }
}

function sideStillFree(o: HandsOut, side: Side | null): boolean {
  if (!side || (o.mode !== 'free' && o.mode !== 'skate')) return false;
  if (side === 'both') return free(o, 'left') || free(o, 'right');
  return free(o, side);
}

/** 0..1 progress of the gesture playing (0 when none) */
export const gestureK = (s: GestureState): number => (s.g ? Math.min(1, s.t / GESTURE_SECS[s.g]) : 0);
