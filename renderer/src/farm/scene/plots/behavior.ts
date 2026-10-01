// @pure
/**
 * What a pen animal decides to do next (pure; the Herd acts it out). Each species has a weighted menu of activities
 * that shifts with the field's mood (sleepy at night / when resting, lively when thriving). An activity may need the
 * animal to go somewhere first (`dest`) and may need it lying down (`LYING`): the Herd walks there, then lies down or
 * gets up through the staged transitions in gait.ts before the activity starts.
 */

export type BeastKey = 'cow' | 'sheep' | 'pig' | 'chicken';

export type Act =
  | 'idle'     // stand, shift weight, blink
  | 'look'     // look around (saccades), ears perk
  | 'wander'   // walk somewhere
  | 'graze'    // head down eating (cow / sheep chew; hens peck in bursts; pigs nibble)
  | 'root'     // pig: snout pushes through the dirt
  | 'drink'    // head down at a trough
  | 'scratch'  // rub a flank against a fence post
  | 'shake'    // sheep wool shake, pig wiggle, hen fluff
  | 'call'     // moo / baa / oink / cluck with the mouth open
  | 'rest'     // lying awake (cud chewing)
  | 'sleep'    // lying asleep (Zzz)
  | 'roll'     // pig: roll in the mud
  | 'dust'     // hen: dust bath
  | 'stretch'  // hen: wing + leg stretch
  | 'chase'    // hen: chase a flock mate
  | 'brood';   // hen: sit on a nest (may lay an egg)

export type Dest = 'none' | 'wander' | 'flock' | 'post' | 'mud' | 'bed' | 'nest' | 'lure';

export interface Plan { act: Act; dur: number; dest: Dest }

export interface Mood {
  /** 0..1 night / resting field */
  sleepy: number;
  /** 0..1 thriving / vigorous field */
  lively: number;
  /** 0..1 how muddy the animal is */
  dirt: number;
  hasMud: boolean;
  hasNests: boolean;
  hasPosts: boolean;
}

/** activities performed lying (or sitting) down */
export const LYING: ReadonlySet<Act> = new Set<Act>(['rest', 'sleep', 'roll', 'dust', 'brood']);

/** where each activity happens */
export const DEST: Record<Act, Dest> = {
  idle: 'none', look: 'none', wander: 'wander', graze: 'none', root: 'none', drink: 'lure', scratch: 'post', shake: 'none', call: 'none',
  rest: 'none', sleep: 'bed', roll: 'mud', dust: 'none', stretch: 'none', chase: 'none', brood: 'nest',
};

/** [min, max] seconds */
const DUR: Record<Act, [number, number]> = {
  idle: [2, 5], look: [2.5, 5], wander: [14, 14], graze: [5, 12], root: [4, 9], drink: [4, 7], scratch: [4, 7], shake: [1.4, 1.4],
  call: [1.6, 1.6], rest: [10, 22], sleep: [14, 30], roll: [5, 9], dust: [5, 8], stretch: [1.8, 1.8], chase: [2.2, 3.4], brood: [8, 16],
};

type Menu = Partial<Record<Act, number>>;
const MENU: Record<BeastKey, Menu> = {
  cow: { graze: 5, wander: 2.4, idle: 1.4, look: 1.2, drink: 0.7, scratch: 0.7, call: 0.5, rest: 1.1 },
  sheep: { graze: 5, wander: 2.2, idle: 1, look: 1.2, drink: 0.5, scratch: 0.35, shake: 0.6, call: 0.8, rest: 1 },
  pig: { root: 4, graze: 1, wander: 2.6, idle: 1, look: 0.8, drink: 0.6, scratch: 0.8, shake: 0.5, call: 0.6, roll: 1.4, rest: 1.2 },
  chicken: { graze: 6, wander: 2.8, idle: 0.8, look: 1.4, dust: 0.6, stretch: 0.5, chase: 0.45, shake: 0.4, call: 0.5, brood: 0.45 },
};

const ACTS: Record<BeastKey, Act[]> = {
  cow: [...Object.keys(MENU.cow) as Act[], 'sleep'], sheep: [...Object.keys(MENU.sheep) as Act[], 'sleep'],
  pig: [...Object.keys(MENU.pig) as Act[], 'sleep'], chicken: [...Object.keys(MENU.chicken) as Act[], 'sleep'],
};

/** Pick the next activity. `rnd` is a 0..1 generator (seeded by the Herd so every window agrees). */
export function choose(sp: BeastKey, m: Mood, rnd: () => number): Plan {
  const menu = MENU[sp];
  let total = 0;
  const w = (a: Act): number => {
    let k = a === 'sleep' ? 1 : menu[a] ?? 0;
    if (!k) return 0;
    if (a === 'roll' && !m.hasMud) return 0;
    if (a === 'brood' && !m.hasNests) return 0;
    if (a === 'scratch' && !m.hasPosts) return 0;
    if (m.sleepy > 0.5) {
      if (a === 'sleep' || a === 'rest') k = (a === 'sleep' ? 14 : 3) * m.sleepy;
      else {
        k *= 1 - 0.85 * m.sleepy;
        if (a === 'wander' || a === 'chase' || a === 'call' || a === 'dust' || a === 'roll') k *= 0.3;
      }
    } else if (a === 'sleep') k = 0;
    if (a === 'wander' || a === 'chase' || a === 'call') k *= 0.7 + m.lively * 0.6;
    if (a === 'shake' && sp === 'pig') k += m.dirt * 3;
    if (a === 'roll') k *= 1 - m.dirt * 0.7;
    return k;
  };
  const acts = ACTS[sp];
  for (const a of acts) total += w(a);
  let r = rnd() * total;
  let pick: Act = 'idle';
  for (const a of acts) { r -= w(a); if (r <= 0) { pick = a; break; } }
  const [lo, hi] = DUR[pick];
  let dest = DEST[pick];
  if (pick === 'wander' && (sp === 'sheep' || sp === 'chicken') && rnd() < 0.5) dest = 'flock';
  return { act: pick, dur: lo + (hi - lo) * rnd(), dest };
}

/** The posture change an activity needs first, if any. */
export function transitionFor(lying: boolean, act: Act): 'down' | 'up' | null {
  const want = LYING.has(act);
  if (want && !lying) return 'down';
  if (!want && lying) return 'up';
  return null;
}

/** Can the player's presence interrupt this activity (curious approach)? Lying / busy animals keep at it. */
export function interruptible(act: Act): boolean {
  return act === 'idle' || act === 'look' || act === 'graze' || act === 'root' || act === 'wander';
}
