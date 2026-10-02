/**
 * Wild visitors, pure (no three, no DOM): when each shy species is about (seasons, hours of the real clock, weather),
 * which spot it uses today (seeded by the date, so every window shows the same valley), and how it reacts to you
 * (`Shy`: calm → alert → flee). The scene half is `wildlife.ts`; the field guide entries are `model/collection.ts`.
 *
 * Shyness rewards patience: a walking player is noticed at `notice` metres (a sprinting one from further, a still one
 * only close up). While it watches you its nerves rise as long as you keep coming (faster when you close in, slower
 * when you only drift), and settle again when you stand still: walk a few steps, stop, wait for the head to go back
 * down, walk again. Sprinting inside its notice range, or getting inside `flee`, sends it off at once.
 */
import type { Season, WeatherKind } from '../../model/types.ts';

export const WILD_IDS = ['deer', 'fox', 'heron', 'owl', 'hedgehog', 'geese'] as const;
export type WildId = (typeof WILD_IDS)[number];

export interface WildSpec {
  id: WildId;
  seasons: readonly Season[];
  /** [from, to) local hours; a window may wrap midnight (from > to) */
  windows: readonly (readonly [number, number])[];
  /** weather it will not come out in */
  avoid: readonly WeatherKind[];
  /** chance (0..1) a given day has no visit at all: the valley keeps a little mystery */
  skip: number;
  /** shyness */
  notice: number;
  flee: number;
  /** how far you can be and still count a sighting (m) */
  sight: number;
}

const ALL: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const WILD: Readonly<Record<WildId, WildSpec>> = Object.freeze({
  // a doe and her fawn graze the edge of the woods at first light and at dusk
  deer: { id: 'deer', seasons: ALL, windows: [[5, 8.5], [17.5, 20.75]], avoid: ['storm'], skip: 0.1, notice: 26, flee: 9, sight: 30 },
  // the fox trots the hedgerows round the fields after dark
  fox: { id: 'fox', seasons: ALL, windows: [[19.5, 5.5]], avoid: ['storm'], skip: 0.1, notice: 19, flee: 6.5, sight: 22 },
  // the heron fishes the river shallows on mornings and late afternoons
  heron: { id: 'heron', seasons: ALL, windows: [[6, 11], [15, 19]], avoid: ['storm'], skip: 0.05, notice: 27, flee: 11, sight: 32 },
  // the owl sits on a standing stone at night (rain keeps it in its tree)
  owl: { id: 'owl', seasons: ALL, windows: [[20, 5.5]], avoid: ['rain', 'storm'], skip: 0.05, notice: 13, flee: 4.5, sight: 20 },
  // the hedgehog snuffles under the orchard on mild evenings; it sleeps all winter
  hedgehog: { id: 'hedgehog', seasons: ['spring', 'summer', 'autumn'], windows: [[18.5, 23.75]], avoid: ['storm', 'snow'], skip: 0.1, notice: 6, flee: 2.6, sight: 9 },
  // greylag geese go over in a long V, south in autumn and home again in spring
  geese: { id: 'geese', seasons: ['autumn', 'spring'], windows: [[7, 9.5], [16.5, 19]], avoid: ['storm', 'fog'], skip: 0, notice: 0, flee: 0, sight: 150 },
});

const inWindow = (h: number, w: readonly [number, number]) => (w[0] <= w[1] ? h >= w[0] && h < w[1] : h >= w[0] || h < w[1]);

/** Is `id` about at this hour / season / weather (ignoring the day's skip roll)? */
export function wildAbout(id: WildId, hour: number, season: Season, weather: WeatherKind): boolean {
  const s = WILD[id];
  return s.seasons.includes(season) && !s.avoid.includes(weather) && s.windows.some((w) => inWindow(hour, w));
}

// ---------------------------------------------------------------------------------------------
// The day's plan (deterministic per date)

export function hashKey(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WildDay {
  id: WildId;
  /** comes today at all */
  comes: boolean;
  /** pick among the species' candidate spots (index = spot % n) */
  spot: number;
  /** a second spot for later in the day / after being flushed (heron, owl relocate) */
  alt: number;
  /** minutes (−20…20) the visit starts late / early, per window: arrival times wander from day to day */
  shift: readonly number[];
  /** seed for everything else the scene wants (headings, the fawn's mood, routes) */
  seed: number;
}

/** What a species does on a given local day (`YYYY-MM-DD`). */
export function wildDay(day: string, id: WildId): WildDay {
  const r = rand(hashKey(`wild:${day}:${id}`));
  const comes = r() >= WILD[id].skip;
  const spot = Math.floor(r() * 1e6), alt = Math.floor(r() * 1e6);
  const shift = WILD[id].windows.map(() => Math.round((r() - 0.5) * 40));
  return { id, comes, spot, alt, shift, seed: Math.floor(r() * 2 ** 31) };
}

/** Is it visiting now: about + today's roll + the day's shifted window edges. */
export function wildVisiting(plan: WildDay, hour: number, season: Season, weather: WeatherKind): boolean {
  const s = WILD[plan.id];
  if (!plan.comes || !s.seasons.includes(season) || s.avoid.includes(weather)) return false;
  return s.windows.some((w, i) => {
    const k = (plan.shift[i] ?? 0) / 60;
    // shift the arrival only (the end stays put so a late arrival still has a window)
    return inWindow(hour, [(w[0] + k + 24) % 24, w[1]]);
  });
}

/** Geese: one pass every few minutes during a window; returns 0..1 progress of the pass in flight, or −1. */
export function geesePass(plan: WildDay, hour: number, every = 4, dur = 0.45): { k: number; n: number } {
  // minutes since midnight, the passes are on a per-day phase
  const m = hour * 60 + (plan.seed % 97) / 97 * every;
  const n = Math.floor(m / every);
  const k = (m - n * every) / dur;
  return { k: k <= 1 ? k : -1, n };
}

// ---------------------------------------------------------------------------------------------
// Shyness

export type ShyState = 'calm' | 'alert' | 'flee';

export interface ShyOpts { notice: number; flee: number }

/** player speeds (m/s): below `still` you are standing still; above `sprint` you are charging */
export const PACE = Object.freeze({ still: 0.4, sprint: 6 });

export class Shy {
  state: ShyState = 'calm';
  /** seconds in the current state */
  t = 0;
  /** 0 settled … 1 off it goes */
  nerves = 0;
  /** it has settled with you standing there: it tolerates you until you move again */
  settled = false;
  private lastD = -1;

  /** how far away it notices you at this pace */
  static noticeAt(o: ShyOpts, speed: number): number {
    return o.notice * (speed < PACE.still ? 0.45 : speed > PACE.sprint ? 1.6 : 1);
  }

  /**
   * Advance with the player's distance (m) and horizontal speed (m/s). `closing` is computed from the change in
   * distance (m/s toward it). Returns the state.
   */
  step(dt: number, dist: number, speed: number, o: ShyOpts): ShyState {
    this.t += dt;
    const closing = this.lastD < 0 || dt <= 0 ? 0 : (this.lastD - dist) / dt;
    this.lastD = dist;
    const notice = Shy.noticeAt(o, speed);
    switch (this.state) {
      case 'calm':
        this.nerves = Math.max(0, this.nerves - dt * 0.25);
        if (dist < o.flee || (dist < notice && speed > PACE.sprint)) this.go('flee');
        else if (dist < notice && !(this.settled && speed < PACE.still)) { this.settled = false; this.go('alert'); }
        if (dist > o.notice * 1.2) this.settled = false;
        break;
      case 'alert': {
        const moving = speed >= PACE.still;
        // coming straight at it is worst, drifting about less, standing still lets it settle
        const rise = !moving ? -0.45 : closing > 0.5 ? 0.55 + 0.1 * Math.min(4, closing) : 0.12;
        // nearer = jumpier
        const near = 1 + Math.max(0, 1 - (dist - o.flee) / Math.max(1, o.notice - o.flee));
        this.nerves = Math.min(1, Math.max(0, this.nerves + dt * (rise > 0 ? rise * near : rise)));
        if (dist < o.flee || speed > PACE.sprint || this.nerves >= 1) this.go('flee');
        else if (this.t > 2 && this.nerves <= 0 && (dist > o.notice * 1.1 || !moving)) { this.settled = !moving; this.go('calm'); }
        break;
      }
      case 'flee':
        break;
    }
    return this.state;
  }

  /** startle it now (dev / shots) */
  scare(): void { this.go('flee'); this.nerves = 1; }

  /** after a flee the scene decides when it is calm again (out of sight, landed elsewhere) */
  reset(): void { this.go('calm'); this.nerves = 0; this.lastD = -1; this.settled = false; }

  private go(s: ShyState): void { this.state = s; this.t = 0; }
}

// ---------------------------------------------------------------------------------------------
// Sighting

/**
 * Does this frame count toward a sighting: within the species' sight range, inside the view cone (cosine of the
 * angle between the camera's forward and the direction to it), and not running away.
 */
export function sees(dist: number, viewCos: number, state: ShyState, range: number, minCos = 0.8): boolean {
  return dist <= range && viewCos >= minCos && state !== 'flee';
}
