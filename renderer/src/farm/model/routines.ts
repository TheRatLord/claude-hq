// @pure
/**
 * The villagers' days (docs/valley/villagers.md). Each villager follows a believable day on the real clock: up and
 * about at home in the morning, their work spot (the mailbox, the shipping bin, the windmill, the noticeboard, the
 * signpost, the knoll), lunch somewhere sociable, an afternoon pastime, the evening at a gathering place, and home to
 * bed at night with their window going dark. Weather, seasons, festivals, Sundays and the restored Valley Projects
 * shift the plan: rain moves picnics under a roof, the restored glasshouse becomes Posy's afternoons, the
 * observatory Nimbus's nights, a festival pulls everyone to the square in the afternoon.
 *
 * Pure and cheap: a plan is a short list of `RoutineEntry`s built from a `RoutineCond` (the scene caches it per
 * condition key and asks `routineAt` 4 times a second). Places are symbolic keys (`PlaceKey`); the scene's cast
 * (scene/villagers/cast.ts) says where each villager stands at each key. The same plan answers "where is Fern?"
 * for the map and "Fern is usually at the glasshouse in the afternoon" for Fern's notebook.
 */
import type { Season, WeatherKind } from './types.ts';

/** What kind of part of the day an entry is (the gatherings read 'evening'; 'home' / 'sleep' are indoors). */
export type RoutineKind = 'morning' | 'work' | 'lunch' | 'pastime' | 'evening' | 'home' | 'sleep' | 'round' | 'shelter';

/** Where (symbolic: each villager's cast entry places them at the key). */
export const PLACES = Object.freeze({
  porch: { name: 'the farmhouse porch' },
  yard: { name: 'the farmhouse yard' },
  farmhouse: { name: 'the farmhouse', indoors: true },
  mailbox: { name: 'the mailbox' },
  bin: { name: 'the shipping bin' },
  shedDoor: { name: 'the toolshed' },
  toolshed: { name: 'the toolshed', indoors: true },
  mill: { name: 'the windmill' },
  sails: { name: 'under the windmill sails' },
  windmill: { name: 'the windmill', indoors: true },
  loft: { name: 'the windmill loft', indoors: true },
  noticeboard: { name: 'the noticeboard' },
  board: { name: 'the projects board' },
  square: { name: 'the square' },
  festival: { name: 'the festival on the square' },
  signpost: { name: 'the signpost' },
  campfire: { name: 'the campfire' },
  campbed: { name: 'a bedroll by the campfire' },
  knoll: { name: 'the stargazers\' knoll' },
  dock: { name: 'the dock' },
  bridge: { name: 'the big bridge' },
  picnic: { name: 'the picnic spot' },
  pergola: { name: 'the pergola' },
  well: { name: 'the well' },
  orchard: { name: 'the honey stand' },
  hotspring: { name: 'the hot spring' },
  stones: { name: 'the standing stones' },
  falls: { name: 'the waterfall pool' },
  ridge: { name: 'the east ridge' },
  meadow: { name: 'the east meadow' },
  pond: { name: 'the pond' },
  glasshouse: { name: 'the glasshouse' },
  observatory: { name: 'the observatory' },
  millwheel: { name: 'the old river mill' },
  halt: { name: 'the train halt' },
  shelter: { name: 'shelter', indoors: true },
} as const satisfies Record<string, { name: string; indoors?: boolean }>);
export type PlaceKey = keyof typeof PLACES;
export const PLACE_KEYS = Object.freeze(Object.keys(PLACES) as PlaceKey[]);
export const placeName = (k: PlaceKey): string => PLACES[k].name;
export const placeIndoors = (k: PlaceKey): boolean => 'indoors' in PLACES[k] && !!(PLACES[k] as { indoors?: boolean }).indoors;

export interface RoutineEntry {
  /** local hour this entry starts (0..24, cyclic across midnight) */
  from: number;
  kind: RoutineKind;
  place: PlaceKey;
  /** a round: the stops walked in turn (`place` is the first) */
  stops?: readonly PlaceKey[];
  /** what they're doing there, in a few words ("sorting the post") */
  doing: string;
}

/** What shifts a day. */
export interface RoutineCond {
  /** 0 = Sunday … 6 = Saturday */
  dow: number;
  season: Season;
  weather: WeatherKind;
  intensity: number;
  /** the active festival id, or null */
  festival: string | null;
  /** restored Valley Projects (ids: 'glasshouse', 'millwheel', 'observatory', 'halt', …) */
  restored: ReadonlySet<string> | readonly string[];
}

export const fairCond = (o: Partial<RoutineCond> = {}): RoutineCond => ({ dow: 3, season: 'summer', weather: 'clear', intensity: 0, festival: null, restored: [], ...o });

const has = (s: RoutineCond['restored'], id: string): boolean => (Array.isArray(s) ? (s as readonly string[]).includes(id) : (s as ReadonlySet<string>).has(id));
/** rain or snow enough to want a roof for a picnic or a stroll (not yet enough to shelter) */
export const wet = (c: Pick<RoutineCond, 'weather' | 'intensity'>): boolean => c.weather === 'storm' || ((c.weather === 'rain' || c.weather === 'snow') && c.intensity > 0.3);
/** bad enough weather to send villagers under a roof */
export const stormy = (kind: WeatherKind, intensity: number): boolean => kind === 'storm' || ((kind === 'rain' || kind === 'snow') && intensity > 0.8);

const E = (from: number, kind: RoutineKind, place: PlaceKey, doing: string, stops?: readonly PlaceKey[]): RoutineEntry =>
  (stops ? { from, kind, place, doing, stops } : { from, kind, place, doing });

/**
 * Put `e` in from `e.from` to `to`, then carry on with whatever the plan said at `to`. Entries inside the window go.
 * (Windows never cross midnight here.)
 */
export function overlay(plan: readonly RoutineEntry[], e: RoutineEntry, to: number): RoutineEntry[] {
  const sorted = [...plan].sort((a, b) => a.from - b.from);
  let resume = sorted[sorted.length - 1];
  for (const x of sorted) if (x.from <= to) resume = x;
  const out = sorted.filter((x) => x.from < e.from || x.from >= to);
  out.push(e);
  if (!out.some((x) => x.from === to)) out.push({ ...resume, from: to });
  return out.sort((a, b) => a.from - b.from);
}

export type VillagerKey = 'posy' | 'bram' | 'hazel' | 'marigold' | 'fern' | 'nimbus';
export const VILLAGER_KEYS: readonly VillagerKey[] = Object.freeze(['posy', 'bram', 'hazel', 'marigold', 'fern', 'nimbus']);
const keyOfId = (id: string): VillagerKey | null => { const k = id.replace(/^villager:/, ''); return (VILLAGER_KEYS as readonly string[]).includes(k) ? k as VillagerKey : null; };

/** The day plan for a villager ('villager:fern' or 'fern') under these conditions, sorted by start hour. */
export function planFor(id: string, c: RoutineCond): RoutineEntry[] {
  const k = keyOfId(id);
  if (!k) return [];
  const w = wet(c), winter = c.season === 'winter', sunday = c.dow === 0;
  let p: RoutineEntry[];
  switch (k) {
    case 'posy': {
      const pastime = has(c.restored, 'glasshouse') ? E(15.5, 'pastime', 'glasshouse', 'tending the violets')
        : w ? null
        : winter ? E(15.5, 'pastime', 'pond', 'watching the skaters')
        : E(15.5, 'pastime', 'orchard', 'taking the long way round to the honey stand');
      p = [
        E(6, 'morning', 'porch', 'having her tea on the porch'),
        E(7, 'work', 'mailbox', 'sorting the post'),
        E(12, 'lunch', w || winter ? 'pergola' : 'picnic', 'having lunch'),
        E(13, 'work', 'mailbox', 'sorting the post'),
        ...(pastime ? [pastime] : []),
        E(17, 'work', 'mailbox', 'sending off the last post'),
        E(18.5, 'evening', 'yard', 'chatting in the yard'),
        E(22, 'sleep', 'farmhouse', 'asleep'),
      ];
      break;
    }
    case 'bram': {
      const fishing = E(16.5, 'pastime', 'bridge', 'fishing off the bridge');
      p = [
        E(6.5, 'morning', 'shedDoor', 'sweeping out the toolshed'),
        E(7.5, 'work', 'bin', 'minding the shipping bin'),
        E(12.5, 'lunch', 'pergola', 'having lunch'),
        E(13.5, 'work', 'bin', 'minding the shipping bin'),
        // fish bite in the rain, Bram says; only a storm keeps him in
        fishing,
        E(18, 'evening', 'campfire', 'by the campfire'),
        E(21.5, 'sleep', 'toolshed', 'asleep'),
      ];
      // Sundays the bin is shut: fishing all day
      if (sunday) p = p.map((x) => (x.kind === 'work' ? { ...x, kind: 'pastime', place: 'bridge', doing: 'fishing (the bin is shut on Sundays)' } : x));
      break;
    }
    case 'hazel': {
      p = [
        E(5.5, 'work', 'mill', 'milling at the windmill'),
        E(11.75, 'lunch', 'well', 'having lunch'),
        E(12.75, 'work', 'mill', 'milling at the windmill'),
        // every fine afternoon she sits by her grandmother's old river mill, wheel or no wheel
        ...(w ? [] : [E(15, 'pastime', 'millwheel', has(c.restored, 'millwheel') ? 'listening to the river mill turn' : 'sitting by the old river mill')]),
        E(17, 'work', 'mill', 'sweeping up at the windmill'),
        E(18, 'evening', 'sails', 'watching the sails'),
        E(21, 'sleep', 'windmill', 'asleep'),
      ];
      break;
    }
    case 'marigold': {
      const pastime = has(c.restored, 'halt') && !w ? E(15.5, 'pastime', 'halt', 'waiting for the train at the halt')
        : w ? E(15.5, 'pastime', 'pergola', 'playing checkers under the pergola')
        : E(15.5, 'pastime', 'hotspring', 'soaking her feet at the hot spring');
      p = [
        E(7.5, 'morning', 'porch', 'reading the Gazette on the porch'),
        E(8.5, 'work', 'noticeboard', 'tidying the noticeboard'),
        E(12.25, 'lunch', 'square', 'having lunch on the square'),
        E(13.75, 'work', 'board', 'fussing over the projects board'),
        pastime,
        E(17.5, 'evening', 'pergola', 'holding court at the pergola'),
        E(22.5, 'sleep', 'farmhouse', 'asleep'),
      ];
      // Sundays the Mayor is off duty (she says): a picnic
      if (sunday && !w) p = p.map((x) => (x.kind === 'work' ? { ...x, kind: 'pastime', place: 'picnic', doing: 'having a Sunday picnic' } : x));
      break;
    }
    case 'fern': {
      const ROUND: readonly PlaceKey[] = ['stones', 'orchard', 'bridge', 'falls', 'hotspring', 'ridge'];
      const afternoon = has(c.restored, 'glasshouse') ? E(13.5, 'pastime', 'glasshouse', 'pressing flowers in the glasshouse')
        : E(13.5, 'round', 'stones', 'on her rounds', ROUND);
      p = [
        E(6.5, 'work', 'signpost', 'at the signpost'),
        E(9, 'round', 'stones', 'on her rounds', ROUND),
        E(11.5, 'work', 'signpost', 'at the signpost'),
        E(12.5, 'lunch', 'campfire', 'having lunch by the fire'),
        afternoon,
        E(16, 'work', 'signpost', 'at the signpost'),
        E(19, 'evening', 'campfire', 'by the campfire'),
        // a last walk out to the stones with her lantern (not in the wet)
        ...(w ? [] : [E(22, 'pastime', 'stones', 'on her night walk to the stones')]),
        E(23.5, 'sleep', 'campbed', 'asleep under the stars'),
      ];
      break;
    }
    case 'nimbus': {
      p = [
        E(1.5, 'sleep', 'loft', 'asleep (a night owl)'),
        E(10.5, 'lunch', 'dock', 'having breakfast on the dock'),
        E(13, 'round', 'meadow', 'out reading the sky', ['meadow', 'well']),
        E(16.5, 'work', 'knoll', 'taking readings on the knoll'),
        E(19, 'evening', has(c.restored, 'observatory') ? 'observatory' : 'knoll', has(c.restored, 'observatory') ? 'stargazing at the observatory' : 'stargazing on the knoll'),
      ];
      break;
    }
  }
  // a festival: everyone spends part of the afternoon at the square
  if (c.festival) {
    const span: Record<VillagerKey, [number, number]> = { posy: [15.5, 17], bram: [14.5, 16], hazel: [15, 16.5], marigold: [13.75, 16], fern: [14, 15.5], nimbus: [14, 16] };
    const [a, b] = span[k];
    p = overlay(p, E(a, 'pastime', 'festival', 'at the festival'), b);
  }
  return p.sort((a, b) => a.from - b.from);
}

// ---------------------------------------------------------------------------------------------------------------
// Clock maths (shared with scene/villagers/schedule.ts)

/** deterministic 0..1 from two numbers */
export const hash01 = (a: number, b: number): number => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
/** a stable small number for a string (villager ids) */
export const keyOf = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003; return h; };
/** ± hours of jitter on each day-plan boundary, varying by day */
export const JITTER_H = 0.3;

/** The start hour of entry i on day `day`, jittered (never past its neighbours). */
export function entryStart(day: readonly { from: number }[], i: number, dayOfYear: number, key: number): number {
  const j = (hash01(key + i * 3.17, dayOfYear) - 0.5) * 2 * JITTER_H;
  return (day[i].from + j + 24) % 24;
}

/** Index of the entry active at `hour` (cyclic across midnight; `day` sorted by `from`). */
export function entryAt(day: readonly { from: number }[], hour: number, dayOfYear = 0, key = 0): number {
  const n = day.length;
  if (n === 0) return -1;
  let best = -1, bestAgo = Infinity;
  for (let i = 0; i < n; i++) {
    const ago = (hour - entryStart(day, i, dayOfYear, key) + 48) % 24;
    if (ago < bestAgo) { bestAgo = ago; best = i; }
  }
  return best;
}

/** Hours since the entry began (handles midnight). */
export function hoursInto(day: readonly { from: number }[], entry: number, hour: number, dayOfYear = 0, key = 0): number {
  return (hour - entryStart(day, entry, dayOfYear, key) + 48) % 24;
}

/** Which stop of a round to visit `elapsedH` hours into it (each stop gets an equal share, then the round restarts). */
export function roundStop(stops: number, elapsedH: number, perStopH = 0.6): number {
  if (stops <= 0) return -1;
  return Math.floor(Math.max(0, elapsedH) / perStopH) % stops;
}

export interface RoutineNow {
  /** index into the plan (-1: none) */
  entry: number;
  kind: RoutineKind;
  /** where they are (a round's current stop; 'shelter' in a storm) */
  place: PlaceKey;
  doing: string;
}

/** Where a villager is at `hour`: the plan entry (a round's current stop), or shelter in a storm unless they are
 * asleep indoors already (one who sleeps out shelters too). */
export function routineAt(plan: readonly RoutineEntry[], hour: number, c: Pick<RoutineCond, 'weather' | 'intensity'>, dayOfYear = 0, key = 0): RoutineNow {
  const entry = entryAt(plan, hour, dayOfYear, key);
  if (entry < 0) return { entry, kind: 'work', place: 'shelter', doing: '' };
  const e = plan[entry];
  let place = e.place;
  if (e.stops?.length) place = e.stops[roundStop(e.stops.length, hoursInto(plan, entry, hour, dayOfYear, key))];
  const indoorsAsleep = (e.kind === 'sleep' || e.kind === 'home') && placeIndoors(e.place);
  if (!indoorsAsleep && stormy(c.weather, c.intensity)) return { entry, kind: 'shelter', place: 'shelter', doing: 'sheltering from the storm' };
  return { entry, kind: e.kind, place, doing: e.doing };
}

// ---------------------------------------------------------------------------------------------------------------
// Words: where to find folk

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';
export const DAY_PARTS: Readonly<Record<DayPart, readonly [number, number]>> = Object.freeze({ morning: [6, 12], afternoon: [12, 17.5], evening: [17.5, 22], night: [22, 30] });
export const partOf = (hour: number): DayPart => (hour >= 6 && hour < 12 ? 'morning' : hour >= 12 && hour < 17.5 ? 'afternoon' : hour >= 17.5 && hour < 22 ? 'evening' : 'night');

/** The entry that fills most of a part of the day (lunch hours don't count against the afternoon's pastime). */
export function usualEntry(plan: readonly RoutineEntry[], part: DayPart): RoutineEntry | null {
  if (!plan.length) return null;
  const [a, b] = DAY_PARTS[part];
  const share = new Map<RoutineEntry, number>();
  for (let h = a; h < b; h += 0.25) {
    const e = plan[entryAt(plan, h % 24)];
    if (e.kind === 'lunch' && part !== 'morning') continue;
    share.set(e, (share.get(e) ?? 0) + (e.kind === 'pastime' ? 1.6 : 1));
  }
  let best: RoutineEntry | null = null, n = -1;
  for (const [e, s] of share) if (s > n) { n = s; best = e; }
  return best;
}

const PART_WORD: Readonly<Record<DayPart, string>> = { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night' };
const PARTS_WORD: Readonly<Record<DayPart, string>> = { morning: 'mornings', afternoon: 'afternoons', evening: 'evenings', night: 'nights' };
const placePhrase = (e: RoutineEntry): string => {
  if (e.kind === 'sleep' || e.kind === 'home') return `asleep ${e.place === 'campbed' ? 'out by the campfire' : `in ${placeName(e.place)}`}`;
  if (e.kind === 'round') return `on rounds (${e.stops?.slice(0, 3).map((s) => placeName(s).replace(/^the /, '')).join(', ')}…)`;
  if (e.place === 'sails') return 'under the windmill sails';
  return `at ${placeName(e.place)}`;
};

/** "Fern is usually at the glasshouse in the afternoon." */
export function usualSentence(name: string, plan: readonly RoutineEntry[], part: DayPart): string {
  const e = usualEntry(plan, part);
  if (!e) return '';
  return `${name} is usually ${placePhrase(e)} ${PART_WORD[part]}.`;
}

/** One line per part of the day: ["mornings at the mailbox", "afternoons at the glasshouse", …] */
export function usualLines(plan: readonly RoutineEntry[]): string[] {
  const out: string[] = [];
  for (const part of ['morning', 'afternoon', 'evening', 'night'] as const) {
    const e = usualEntry(plan, part);
    if (e) out.push(`${PARTS_WORD[part]} ${placePhrase(e)}`);
  }
  return out;
}

/** "sorting the post at the mailbox" (the map's tooltip, right now) */
export function nowText(now: RoutineNow): string {
  if (now.kind === 'shelter') return 'sheltering from the storm';
  if (now.kind === 'sleep' || now.kind === 'home') return now.doing;
  if (now.place === 'sails' || now.place === 'festival') return now.doing === 'at the festival' ? 'at the festival on the square' : `${now.doing}`;
  return now.doing.includes(placeName(now.place).replace(/^the /, '')) ? now.doing : `${now.doing} at ${placeName(now.place)}`;
}
