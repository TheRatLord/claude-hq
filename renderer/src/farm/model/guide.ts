// @pure
/**
 * Fern's Field Notebook: gentle discoverability for everything there is to do in the valley (HUD: hud/guide.ts;
 * wiring: farm/guidebook.ts; docs/valley/guide.md).
 *
 *  - **Pages** (`PAGES`): one per activity, grouped in chapters. A page is *found* when the valley's own services say
 *    you have done it (the Collections book, the stamp book's counters, the barn's chores, the grotto, your pet, the
 *    friendship book…: a `GuideWorld` snapshot read off them) or, for the few things nobody else remembers (you
 *    climbed into the rowboat, stepped onto the ice, opened the Gazette), when the notebook's own small `seen` set
 *    says so. Found pages show the how-to and your progress in that pastime; the rest show a cryptic, seasonal hint in
 *    Fern's voice (secrets never spoiled).
 *  - **Nudges** (`nudgesFor`): world-aware one-time tips ("The rowboat is tied at the dock…") for something you are
 *    standing next to and have never tried. They are onboarding tips (model/onboarding.ts `HINTS`, `nudge: true`):
 *    the same cadence, the same "tips off", never during a tour, a panel, typing or while someone needs you.
 *  - **Rumours** (`rumourFor`): now and then a villager mentions something you have not found yet.
 *  - **What's new** (`FEATURES`, `newsDue`): a letter from Fern listing what was added since your last visit. A
 *    first-run profile never gets it (Posy's welcome does the job).
 *
 * Persisted (browser-local `claude-valley.guide.v1`): only `seen` (signals no other service keeps), `told` (pages
 * already announced with a toast, so a page is announced once ever), `known` (pages you have looked at, so a fresh
 * discovery wears a "new" mark until you do), `news` (the feature version you have heard about) and the last news
 * letter (re-posted to the mailbox on load).
 *
 * Pure: no DOM, no three; the clock and the store are injected.
 */
import type { Season, WeatherKind } from './types.ts';
import type { CollectionData } from './collection.ts';
import { FISHES, FORAGE, SIGHTINGS, hashKey } from './collection.ts';
import type { FriendsData } from './friends.ts';
import { FRIEND_IDS, friendDef, heartsOf } from './friends.ts';
import type { WalletData } from './wallet.ts';
import type { StampsData, Motif } from './stamps.ts';
import type { GrottoData } from './grotto.ts';
import type { ProjectsData } from './projects.ts';
import { PROJECTS } from './projects.ts';
import type { VisitorsData } from './visitors.ts';
import { VISITORS, merchantComes } from './visitors.ts';
import { JOURNAL } from './grotto.ts';
import { FESTIVALS } from './calendar.ts';
import { dayKey } from './almanac.ts';

export const CHAPTERS = Object.freeze(['pastimes', 'seasons', 'village', 'explore', 'home'] as const);
export type Chapter = (typeof CHAPTERS)[number];
export const CHAPTER_NAME: Readonly<Record<Chapter, string>> = Object.freeze({
  pastimes: 'Pastimes', seasons: 'Seasons', village: 'Village life', explore: 'Exploring', home: 'House & barn',
});

/** things only the notebook remembers (each is a real signal: a ride, a room, a panel, a key) */
export const SEEN_IDS = Object.freeze(['rowboat', 'skate', 'snowball', 'farmhouse', 'barn', 'gazette', 'lantern', 'wave', 'viewer', 'gathering', 'notebook'] as const);
export type SeenId = (typeof SEEN_IDS)[number];

/** What the valley looks like right now, as far as the notebook cares (guidebook.ts builds it off the live services). */
export interface GuideWorld {
  season: Season;
  hour: number;
  weather: WeatherKind;
  /** lying snow 0..1 */
  snow: number;
  /** the pond's ice 0..1 */
  ice: number;
  festival: string | null;
  /** the evening / morning gathering on now */
  gathering: 'campfire' | 'concert' | 'market' | null;
  collection: Readonly<CollectionData> | null;
  friends: Readonly<FriendsData> | null;
  wallet: Readonly<WalletData> | null;
  stamps: Readonly<StampsData> | null;
  /** the barn's lifetime chores (model/barn.ts `total`) */
  barn: Readonly<{ days: number; eggs: number; milk: number; feeds: number; brushes: number }> | null;
  grotto: Readonly<GrottoData> | null;
  /** your pet, if adopted (model/pet.ts): its name and lifetime counts (walk in metres) */
  pet: { name: string; walk: number; fetch: number; finds: number; pets: number } | null;
  /** stones on the summit cairn */
  stones: number;
  /** photos in the album */
  photos: number;
  /** the welcome tour's pastime chips (the farmhouse visit counts) */
  toured: { farmhouse?: boolean; forage?: boolean; fish?: boolean };
  /** the notebook's own memory */
  seen: readonly string[];
  /** the Valley Projects board (model/projects.ts; optional: older callers) */
  projects?: Readonly<ProjectsData> | null;
  /** the visitors: who you've met, what you've bought (model/visitors.ts; optional: older callers) */
  visitors?: Readonly<VisitorsData> | null;
  /** today's date key (the merchant's days; optional: older callers) */
  day?: string;
}

export const emptyGuideWorld = (): GuideWorld => ({
  season: 'summer', hour: 12, weather: 'clear', snow: 0, ice: 0, festival: null, gathering: null, collection: null, friends: null, wallet: null,
  stamps: null, barn: null, grotto: null, pet: null, stones: 0, photos: 0, toured: {}, seen: [],
});

export interface PageDef {
  id: string;
  chapter: Chapter;
  title: string;
  /** the sketch (drawn with the stamp book's motif drawings, in pencil: hud/guide.ts) */
  motif: Motif;
  /** how to do it; `{use}` `{alt}` `{wave}` `{lantern}` `{notebook}` become the bound keys (`fillKeys`) */
  how: string;
  /** Fern's cryptic hint while you haven't found it (never a spoiler) */
  hint: string;
  /** a secret: the undiscovered page shows only "?" and the hint, no nudges, only Fern ever mentions it */
  secret?: boolean;
  /** when it can be done: a label, and whether that's now */
  when?: { label: string; now(w: GuideWorld): boolean };
  found(w: GuideWorld): boolean;
  /** your progress in this pastime, a short line each (found pages only) */
  notes(w: GuideWorld): string[];
  /** what a villager says about it while you haven't found it (`by`: only these villagers say it) */
  rumour?: string;
  by?: readonly string[];
}

const seen = (w: GuideWorld, id: SeenId) => w.seen.includes(id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const earned = (w: GuideWorld, id: string) => w.stamps?.earned[id] !== undefined;
const n = (w: GuideWorld) => w.stamps?.n ?? { ship: 0, answered: 0, photo: 0, late: 0, row: 0, rowM: 0, eight: 0, snowman: 0 };
const forageKinds = (w: GuideWorld) => FORAGE.filter((d) => w.collection?.found[d.id]).length;
const forageCount = (w: GuideWorld) => FORAGE.reduce((a, d) => a + (w.collection?.found[d.id]?.n ?? 0), 0);
const fishCount = (w: GuideWorld) => FISHES.reduce((a, d) => a + (d.junk ? 0 : w.collection?.found[d.id]?.n ?? 0), 0);
const sightCount = (w: GuideWorld) => SIGHTINGS.filter((d) => w.collection?.seen?.[d.id]).length;
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const NOOK_COUNT = 8, CAIRN = 7;
/** the hillside orchard's finds (model/orchard.ts): any one finds its page */
const ORCHARD_FINDS = ['apple', 'pear', 'plum', 'cherry', 'honey'];

const P = (o: PageDef): PageDef => Object.freeze(o);

/** Every page, in notebook order (by chapter). Ids are stable: they are save keys. */
export const PAGES: readonly PageDef[] = Object.freeze([
  // ---- Pastimes
  P({
    id: 'forage', chapter: 'pastimes', title: 'Foraging', motif: 'mushroom',
    how: 'Anything that glints in the grass is today\'s forage: look at it and press {use}. A fresh batch turns up every morning, different each season. K opens the Collections book.',
    hint: 'The meadows leave little gifts for early risers. Look for a glint by the trees and the water\'s edge…',
    when: { label: 'every day, fresh each morning', now: () => true },
    found: (w) => forageKinds(w) > 0 || !!w.toured.forage,
    notes: (w) => [`${forageKinds(w)} of ${FORAGE.length} kinds in the book`, `${plural(forageCount(w), 'find')} picked in all`],
    rumour: 'Have you been foraging? Things glint in the grass every morning, if you know to look down.',
  }),
  P({
    id: 'fish', chapter: 'pastimes', title: 'Fishing', motif: 'fish',
    how: 'Look at open water by the pond or the river and press {use} to cast. When the bobber dips with a splash, {use} again, quickly! Rain, dusk and night bring different bites.',
    hint: 'Something silver keeps rising at the pond when the light goes golden…',
    when: { label: 'any time; rain and night bring rarer bites', now: () => true },
    found: (w) => FISHES.some((d) => w.collection?.found[d.id]) || !!w.toured.fish,
    notes: (w) => {
      const best = FISHES.filter((d) => !d.junk && w.collection?.found[d.id]?.best).sort((a, b) => (w.collection!.found[b.id].best ?? 0) - (w.collection!.found[a.id].best ?? 0))[0];
      return [`${plural(fishCount(w), 'fish', 'fish')} caught`, ...(best ? [`biggest: a ${best.name.toLowerCase()}, ${w.collection!.found[best.id].best} cm`] : [])];
    },
    rumour: 'The fish are biting at the pond. Look at the water and cast a line, it\'s good for the soul.',
  }),
  P({
    id: 'wildlife', chapter: 'pastimes', title: 'Wild visitors', motif: 'binoculars',
    how: 'Shy creatures wander through now and then. Walk slowly (no sprinting) and keep a little distance and they\'ll stay; every first sighting goes in the field guide (K).',
    hint: 'Something rustles in the hedgerow when you stand very, very still…',
    found: (w) => sightCount(w) > 0,
    notes: (w) => [`${sightCount(w)} of ${SIGHTINGS.length} visitors in the field guide`],
    rumour: 'I saw something in the long grass this morning. Tread softly out there and you might too.',
  }),
  P({
    id: 'sky', chapter: 'pastimes', title: 'Sky watching', motif: 'rainbow',
    how: 'After a sunlit shower, look away from the sun for a rainbow. On meteor-shower nights, find somewhere dark and look up. Nimbus knows the forecast.',
    hint: 'After the rain, Nimbus always looks the other way from the sun. Why?',
    when: { label: 'after showers; clear meteor nights', now: (w) => w.weather === 'rain' || w.hour >= 21 || w.hour < 4 },
    found: (w) => earned(w, 'rainbow') || earned(w, 'meteors'),
    notes: (w) => [earned(w, 'rainbow') ? 'a rainbow seen ✓' : 'no rainbow yet', earned(w, 'meteors') ? 'a meteor shower watched ✓' : 'no meteor shower yet'],
    rumour: 'Keep an eye on the sky after a shower. And on clear nights: some nights the stars fall like rain.',
    by: ['villager:nimbus', 'villager:fern', 'villager:hazel'],
  }),
  P({
    id: 'photo', chapter: 'pastimes', title: 'Photo mode', motif: 'camera',
    how: 'P floats you free as a camera: 1–6 change the look, V the frame, [ ] the time of day, F says cheese, Enter snaps. L opens your album; favourites hang in the farmhouse.',
    hint: 'Some mornings the light is far too good not to keep. Posy says there\'s a way to press it like a flower…',
    found: (w) => n(w).photo > 0 || w.photos > 0,
    notes: (w) => [`${plural(w.photos, 'photo')} in the album`, `${plural(n(w).photo, 'snap')} in all`],
    rumour: 'You should take a picture of the valley some time. P, then Enter, they tell me. I wouldn\'t know, I\'m always in them.',
  }),

  // ---- Seasons
  P({
    id: 'rowboat', chapter: 'seasons', title: 'The rowboat', motif: 'boat',
    how: 'Tied alongside the pond dock from spring to autumn. {use} climbs in; W / S row, A / D turn. Fish from the middle of the pond for rarer bites, and {use} by the dock to step out.',
    hint: 'Something bobs against the dock pilings, spring to autumn, waiting for someone with an afternoon to spare…',
    when: { label: 'spring to autumn', now: (w) => w.season !== 'winter' },
    found: (w) => n(w).row > 0 || seen(w, 'rowboat'),
    notes: (w) => (n(w).row || n(w).rowM ? [`${km(n(w).rowM ?? 0)} rowed on the pond`, ...(n(w).row ? [plural(n(w).row, 'outing')] : [])] : ['not out on the water yet']),
    rumour: 'The little rowboat is tied at the dock, just begging to be taken out. The fish in the middle are bigger, they say.',
  }),
  P({
    id: 'skate', chapter: 'seasons', title: 'Skating', motif: 'skates',
    how: 'When the pond freezes in winter, walk out onto the ice. W pushes a stride, A / D carve, S snowploughs to a stop. Your blades leave their marks; try a figure eight.',
    hint: 'When the pond turns to glass…',
    when: { label: 'winter, when the pond freezes', now: (w) => w.season === 'winter' && w.ice > 0.5 },
    found: (w) => n(w).eight > 0 || seen(w, 'skate'),
    notes: (w) => [n(w).eight ? `${plural(n(w).eight, 'figure eight')} skated` : 'no figure eight yet'],
    rumour: 'When the pond freezes over, it\'s the best skating for miles. Just walk out onto it!',
  }),
  P({
    id: 'snowman', chapter: 'seasons', title: 'Snowmen', motif: 'snowman',
    how: 'When snow is lying, look down at it and press {use} to roll a snowball; it grows as you walk. {use} sets it down; stack three, then {use} on it to add eyes, a nose, a scarf and a hat.',
    hint: 'When the snow lies thick, the valley grows a few new residents. Round ones…',
    when: { label: 'whenever snow is lying', now: (w) => w.snow >= 0.3 },
    found: (w) => n(w).snowman > 0 || seen(w, 'snowball'),
    notes: (w) => [n(w).snowman ? `${plural(n(w).snowman, 'snow friend')} built` : 'no snow friend finished yet'],
    rumour: 'Snow\'s good for more than shovelling, you know. Roll a ball, then another…',
  }),
  P({
    id: 'orchard', chapter: 'seasons', title: 'The hillside orchard', motif: 'apple',
    how: 'Through the gate on the east foothills: look at a fruit tree and press {use} to shake it. Cherries and plums ripen in summer, apples, pears and the last plums in autumn; what falls goes into your basket. {use} on a hive takes its honey every few days, and three apples or pears make cider at the press.',
    hint: 'Up against the eastern hills there\'s a walled garden that hums all summer. Blossom first, then something sweeter…',
    when: { label: 'fruit in summer and autumn, honey spring to autumn', now: (w) => w.season === 'summer' || w.season === 'autumn' },
    found: (w) => ORCHARD_FINDS.some((id) => w.collection?.found[id]),
    notes: (w) => {
      const f = (id: string) => w.collection?.found[id]?.n ?? 0;
      const fruit = f('apple') + f('pear') + f('plum') + f('cherry');
      const kinds = ['apple', 'pear', 'plum', 'cherry'].filter((id) => f(id)).length;
      return [`${plural(fruit, 'fruit', 'fruit')} picked (${kinds} of 4 kinds)`, f('honey') ? `${plural(f('honey'), 'jar')} of honey` : 'no honey yet'];
    },
    rumour: 'Have you been up to the orchard on the east slope? Give a ripe tree a good shake and see what drops.',
  }),
  P({
    id: 'festival', chapter: 'seasons', title: 'Festivals', motif: 'blossom',
    how: 'A few times a year the square dresses up: blossom, lanterns, cake, pumpkins, starlight and fireworks. Walk over while one is on; the noticeboard (B) has the calendar.',
    hint: 'Mayor Marigold keeps a calendar of very important days. Some of them involve cake…',
    when: { label: 'on festival days', now: (w) => !!w.festival },
    found: (w) => (w.stamps?.fests.length ?? 0) > 0,
    notes: (w) => [`${w.stamps?.fests.length ?? 0} of ${FESTIVALS.length} festivals joined`],
    rumour: 'There\'s always a festival coming up. Check the noticeboard, and come to the square when it\'s on!',
    by: ['villager:marigold', 'villager:posy', 'villager:bram'],
  }),

  // ---- Village life
  P({
    id: 'gifts', chapter: 'village', title: 'Gifts & friendship', motif: 'gift',
    how: 'Chat with the villagers once a day ({use}) and give them something from your basket ({alt}). Everyone has favourites; find them out and the hearts add up, with letters at the milestones.',
    hint: 'Everyone in the village has a favourite thing. Hazel\'s is not flour, whatever she says…',
    found: (w) => (w.friends?.total.gifts ?? 0) > 0,
    notes: (w) => {
      const best = [...FRIEND_IDS].sort((a, b) => (w.friends?.pts[b] ?? 0) - (w.friends?.pts[a] ?? 0))[0];
      const h = heartsOf(w.friends?.pts[best] ?? 0);
      return [`${plural(w.friends?.total.gifts ?? 0, 'gift')} given`, ...(h > 0 ? [`closest friend: ${friendDef(best)?.name ?? best} ♥ ${h}`] : [])];
    },
    rumour: 'Got anything in your basket? A little present goes a long way round here.',
  }),
  P({
    id: 'requests', chapter: 'village', title: 'Requests', motif: 'basket',
    how: 'Villagers ask for a little something now and then (a fish at dusk, a flower…). The tracker under the dock lists today\'s; Q keeps it open. Bring it to them and {use}.',
    hint: 'The villagers are too polite to ask twice. Chat to them and listen…',
    found: (w) => (w.friends?.total.requests ?? 0) > 0 || !!w.friends?.req.list.some((r) => r.asked),
    notes: (w) => [`${plural(w.friends?.total.requests ?? 0, 'request')} done`],
    rumour: 'Somebody was saying they could use a hand today. Ask around!',
  }),
  P({
    id: 'gathering', chapter: 'village', title: 'Evenings & markets', motif: 'campfire',
    how: 'Some evenings the village lights a campfire by the pond: find a log and {use} to sit. Some afternoons there\'s a concert at the bandstand, and some mornings a market on the square.',
    hint: 'After dusk, follow the woodsmoke…',
    when: { label: 'some evenings, afternoons and mornings', now: (w) => !!w.gathering },
    found: (w) => earned(w, 'campfire') || earned(w, 'concert') || seen(w, 'gathering') || Object.keys(w.friends?.gathered ?? {}).length > 0,
    notes: (w) => [earned(w, 'campfire') ? 'sat by the campfire ✓' : 'not sat by the fire yet', earned(w, 'concert') ? 'heard a concert ✓' : 'no concert yet'],
    rumour: 'Come down to the campfire some evening. There are marshmallows, and Bram tells the same story every time.',
  }),
  P({
    id: 'pet', chapter: 'village', title: 'A pet of your own', motif: 'paw',
    how: 'Fern minds a basket of foundlings by her signpost: {use} on it to meet them and give one a home. Pets follow you, fetch, dig up finds and sleep by the hearth.',
    hint: 'Fern has been minding a basket by her signpost. It keeps making small noises…',
    found: (w) => !!w.pet,
    notes: (w) => w.pet ? [`${w.pet.name}: ${km(w.pet.walk)} walked together`, `${plural(w.pet.fetch, 'stick')} fetched · ${plural(w.pet.finds, 'find')} dug up`] : [],
    rumour: 'The foundlings in my basket by the signpost would love a home. Come and say hello.',
    by: ['villager:fern', 'villager:posy', 'villager:hazel'],
  }),
  P({
    id: 'gazette', chapter: 'village', title: 'The Valley Gazette', motif: 'letter',
    how: 'G opens today\'s paper: the valley\'s real week in headlines, with Nimbus\'s forecast. A weekly edition comes in the post every Monday.',
    hint: 'Someone has been scribbling about the valley\'s comings and goings. Check the noticeboard…',
    found: (w) => seen(w, 'gazette'),
    notes: () => [],
    rumour: 'Have you read the Gazette? G, or the noticeboard. I\'m in it. Page two.',
    by: ['villager:posy', 'villager:marigold', 'villager:nimbus'],
  }),
  P({
    id: 'projects', chapter: 'village', title: 'Valley projects', motif: 'house',
    how: 'The Mayor\'s board on the west side of the square ({use} to read it) plans six restorations: bits from your purse, finds from foraging and fishing, a friend\'s blessing, and real work from your farmers (commits shipped, tests passed, blocked agents unblocked). Fill a plan and walk over to see the place made new.',
    hint: 'Half the valley is waiting to be mended: a dark path, a broken bridge, a halt nobody stops at. Someone has pinned up a plan…',
    found: (w) => Object.values(w.projects?.p ?? {}).some((q) => q && (q.done || q.bits || Object.keys(q.items).length)),
    notes: (w) => {
      const p = w.projects?.p ?? {};
      const done = PROJECTS.filter((d) => p[d.id]?.done).length;
      const next = PROJECTS.find((d) => !p[d.id]?.done);
      return [`${done} of ${PROJECTS.length} places restored`, ...(next ? [`next up: ${next.name}`] : ['every place mended. The valley thanks you!'])];
    },
    rumour: 'Have you seen the projects board on the square? The Mayor wants the old footbridge mended, and the lantern path lit again.',
    by: ['villager:marigold', 'villager:bram', 'villager:fern'],
  }),
  P({
    id: 'visitors', chapter: 'village', title: 'Comings and goings', motif: 'basket',
    how: 'Barnaby Pell\'s travelling cart comes over the south pass on Wednesdays and Saturdays (and on festival days) and parks east of the square: {use} on him or the cart for rare decor, moonflower seeds, a glimmer lure (rarer fish for the rest of the day) and the odd old map. Odile the painter comes on some fair days; her finished canvas can hang in the farmhouse. Once the halt is restored, Ned brings parcels on the morning train.',
    hint: 'Twice a week a squeaky wheel comes down from the south pass, and somebody starts shouting about curiosities…',
    when: { label: 'Wednesdays & Saturdays, 8:30–17:30 (and festival days)', now: (w) => !!w.day && merchantComes(w.day) && w.hour >= 8.5 && w.hour < 17.5 },
    found: (w) => (w.visitors?.met.length ?? 0) > 0 || (w.visitors?.total.bought ?? 0) > 0,
    notes: (w) => {
      const v = w.visitors;
      if (!v) return [];
      return [
        `met: ${v.met.map((id) => VISITORS[id].short).join(', ') || 'nobody yet'}`,
        ...(v.total.bought ? [`${plural(v.total.bought, 'thing')} bought from visitors`] : []),
        ...(v.paintings.length ? [`${plural(v.paintings.length, 'painting')} for the farmhouse`] : []),
        ...(v.posted.length ? [`${plural(v.posted.length, 'parcel')} off the train`] : []),
      ];
    },
    rumour: 'A travelling merchant comes over the south pass on Wednesdays and Saturdays. Rare things, he says. Fair prices, he says. No haggling, he says, a lot.',
    by: ['villager:bram', 'villager:posy', 'villager:marigold'],
  }),

  // ---- Exploring
  P({
    id: 'summit', chapter: 'explore', title: 'The summit trail', motif: 'mountain',
    how: 'A footpath leaves the south road for the trailhead under the cliffs; switchbacks, a halfway bench and a rope bridge lead to the lookout. {use} on the valley viewer to spy any farmer, and leave a stone on the cairn.',
    hint: 'On a clear day you can see the whole valley from somewhere up on the ridge. The path starts in the south…',
    found: (w) => earned(w, 'summit') || w.stones > 0 || seen(w, 'viewer'),
    notes: (w) => [`${Math.min(w.stones, CAIRN)} of ${CAIRN} stones on the cairn`, ...(seen(w, 'viewer') ? ['looked through the valley viewer ✓'] : [])],
    rumour: 'Climb the summit trail some time. From the lookout you can see every field in the valley.',
  }),
  P({
    id: 'nooks', chapter: 'explore', title: 'Quiet nooks', motif: 'compass',
    how: 'Little places to sit a while are tucked all over the valley: a pergola, a picnic spot, a hot spring, the standing stones, a swing tree… Wander off the roads and find them all.',
    hint: 'There are quiet corners all over the valley made for doing nothing at all…',
    found: (w) => (w.stamps?.nooks.length ?? 0) > 0,
    notes: (w) => [`${Math.min(w.stamps?.nooks.length ?? 0, NOOK_COUNT)} of ${NOOK_COUNT} nooks visited`],
    rumour: 'There\'s a hot spring up in the hills, you know. And a swing tree. Go and get a little lost.',
  }),
  P({
    id: 'lantern', chapter: 'explore', title: 'Lantern & a wave', motif: 'lantern',
    how: '{lantern} lights your lantern (it lights itself after dusk) and puts it away. {wave} waves; villagers wave back.',
    hint: 'Nights are long in the valley, but nobody said you had to walk them in the dark…',
    found: (w) => seen(w, 'lantern') || seen(w, 'wave'),
    notes: (w) => [seen(w, 'lantern') ? 'lantern lit ✓' : 'lantern not tried', seen(w, 'wave') ? 'waved hello ✓' : 'no wave yet'],
    rumour: 'Out after dark? Carry a lantern. And a wave never hurt anyone either.',
    by: ['villager:fern', 'villager:hazel'],
  }),
  P({
    id: 'grotto', chapter: 'explore', title: 'Behind the falls', motif: 'cave', secret: true,
    how: 'A worn ledge climbs from the plunge pool\'s west shore and slips behind the falling water. Inside: glowing crystals, a still pool with eyeless fish, glow-caps, an explorer\'s journal and a chest.',
    hint: 'Old Fern swears the falls are hollow…',
    found: (w) => !!w.grotto?.found,
    notes: (w) => w.grotto ? [`${plural(w.grotto.visits, 'visit')}`, `the journal: ${Math.min(w.grotto.pages, JOURNAL.length)} of ${JOURNAL.length} pages read`, w.grotto.chest ? 'the chest: opened ✓' : 'something is still hidden in there…'] : [],
    rumour: 'Listen to the waterfall some time. Really listen. Does it sound hollow to you?',
    by: ['villager:fern'],
  }),

  // ---- House & barn
  P({
    id: 'farmhouse', chapter: 'home', title: 'The farmhouse', motif: 'house',
    how: '{use} on the front door: a hearth to stoke, the Almanac on the desk, a shelf and fish tank for your Collections, a photo wall and a nap in the bed.',
    hint: 'Someone always leaves the fire in for you, and that front door is never locked…',
    found: (w) => seen(w, 'farmhouse') || !!w.toured.farmhouse,
    notes: () => [],
    rumour: 'Your farmhouse fire\'s lit, you know. Pop inside and warm your paws.',
  }),
  P({
    id: 'barn', chapter: 'home', title: 'Barn chores', motif: 'egg',
    how: '{use} on the big barn door. Grab hay from the pile for Daisy, Pepper and the sheep, a scoop of grain for the hens, then {use} on each animal. Milk Daisy, brush Pepper and collect the eggs; sell them to Bram.',
    hint: 'Someone in the barn lows every morning, quite pointedly, at about breakfast time…',
    when: { label: 'every day', now: () => true },
    found: (w) => (w.barn?.feeds ?? 0) > 0 || seen(w, 'barn'),
    notes: (w) => w.barn ? [`fed ${plural(w.barn.feeds, 'time')}`, `${plural(w.barn.eggs, 'egg')} · ${plural(w.barn.milk, 'pail')} of milk`, `${plural(w.barn.days, 'day')} with everyone fed`] : [],
    rumour: 'The animals in the barn could do with some breakfast. Daisy\'s been lowing all morning.',
    by: ['villager:hazel', 'villager:bram', 'villager:fern', 'villager:marigold'],
  }),
  P({
    id: 'shop', chapter: 'home', title: 'Shop & yard', motif: 'lamp',
    how: 'Sell your finds to Bram at the shipping bin or the General store, then buy decor for the yard behind the farmhouse. I opens your pockets; X picks a piece up to move it.',
    hint: 'The General store gets new stock as the valley prospers. Bram buys almost anything…',
    found: (w) => (w.wallet?.total.sales ?? 0) > 0 || (w.wallet?.total.spent ?? 0) > 0,
    notes: (w) => [`${plural(w.wallet?.pieces.filter((p) => p.slot !== null).length ?? 0, 'piece')} in your yard`, `${plural(w.wallet?.total.sales ?? 0, 'thing')} sold`],
    rumour: 'Bram will buy whatever\'s in your basket. Spend it on something nice for the yard!',
    by: ['villager:bram', 'villager:marigold', 'villager:posy'],
  }),
] as PageDef[]);

const BY_ID = new Map(PAGES.map((p) => [p.id, p]));
export const pageDef = (id: string): PageDef | undefined => BY_ID.get(id);

/** `{use}` → the bound key's label (unknown placeholders stay as they are) */
export function fillKeys(text: string, keys: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => keys[k] ?? m);
}

// ---------------------------------------------------------------------------------------------
// The view

export interface PageView {
  def: PageDef;
  found: boolean;
  /** found and not yet looked at in the notebook */
  fresh: boolean;
  notes: string[];
  /** it can be done right now (in season, on now) */
  now: boolean;
}
export interface GuideView {
  pages: PageView[];
  found: number;
  total: number;
  byChapter: Record<Chapter, { found: number; total: number }>;
}

const safe = <T>(f: () => T, dflt: T): T => { try { return f(); } catch { return dflt; } };
export const isFound = (p: PageDef, w: GuideWorld): boolean => safe(() => p.found(w), false);

export function guideView(w: GuideWorld, known: readonly string[] = []): GuideView {
  const pages = PAGES.map((def) => {
    const found = isFound(def, w);
    return { def, found, fresh: found && !known.includes(def.id), notes: found ? safe(() => def.notes(w), []) : [], now: !!def.when && safe(() => def.when!.now(w), false) };
  });
  const byChapter = Object.fromEntries(CHAPTERS.map((c) => [c, { found: pages.filter((p) => p.def.chapter === c && p.found).length, total: pages.filter((p) => p.def.chapter === c).length }])) as GuideView['byChapter'];
  return { pages, found: pages.filter((p) => p.found).length, total: PAGES.length, byChapter };
}

// ---------------------------------------------------------------------------------------------
// Nudges (one-time tips for something right in front of you; texts in model/onboarding.ts HINTS)

export type NudgeId = 'boat' | 'skate' | 'snow' | 'barn' | 'campfire' | 'trail' | 'pet' | 'orchard' | 'notebook';
/** how far (m) the player stands from the things a nudge points at, and whether they're outside */
export interface Near { outdoors: boolean; dock: number; pond: number; barn: number; campfire: number; trailhead: number; basket: number; /** the hillside orchard's gate (optional: older callers) */ orchard?: number }
export const NEAR_FAR: Near = Object.freeze({ outdoors: true, dock: 1e9, pond: 1e9, barn: 1e9, campfire: 1e9, trailhead: 1e9, basket: 1e9, orchard: 1e9 });
/** the pond's radius (world/map.ts POND.r) is added by the caller: `pond` is the distance from its edge */
export const NUDGE_R = Object.freeze({ dock: 14, pond: 7, barn: 13, campfire: 26, trailhead: 12, basket: 8, orchard: 12 });
/** pages found before the notebook itself gets a nudge */
export const NOTEBOOK_AFTER = 3;

/** The nudges that apply right now (in priority order). Pure; the caller queues them (onboarding `want`). */
export function nudgesFor(w: GuideWorld, near: Near): NudgeId[] {
  if (!near.outdoors) return [];
  const f = (id: string) => isFound(BY_ID.get(id)!, w);
  const out: NudgeId[] = [];
  const day = w.hour >= 6 && w.hour < 21;
  if (!f('rowboat') && w.season !== 'winter' && day && near.dock < NUDGE_R.dock) out.push('boat');
  if (!f('skate') && w.ice > 0.8 && near.pond < NUDGE_R.pond) out.push('skate');
  if (!f('snowman') && w.snow >= 0.3) out.push('snow');
  if (!f('barn') && near.barn < NUDGE_R.barn) out.push('barn');
  if (!f('gathering') && w.gathering === 'campfire' && near.campfire < NUDGE_R.campfire) out.push('campfire');
  if (!f('summit') && near.trailhead < NUDGE_R.trailhead) out.push('trail');
  if (!f('pet') && near.basket < NUDGE_R.basket) out.push('pet');
  if (!f('orchard') && (w.season === 'summer' || w.season === 'autumn') && (near.orchard ?? 1e9) < NUDGE_R.orchard) out.push('orchard');
  if (!seen(w, 'notebook') && PAGES.filter((p) => isFound(p, w)).length >= NOTEBOOK_AFTER) out.push('notebook');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Villager rumours

/** at most one rumour this often (any villager) */
export const RUMOUR_GAP_MS = 3 * 60_000;

/**
 * What a villager might mention on the n-th chat: an undiscovered page (one that can be done now first), or null. Only
 * on every third chat from the second on (the useful report comes first), never a secret except from those allowed.
 */
export function rumourFor(w: GuideWorld, villager: string, nth: number, day: string): { page: string; text: string } | null {
  if (nth % 3 !== 1) return null;
  const open = PAGES.filter((p) => p.rumour && !isFound(p, w) && (!p.by || p.by.includes(villager)));
  if (!open.length) return null;
  const now = open.filter((p) => !p.when || safe(() => p.when!.now(w), false));
  const pool = now.length ? now : open;
  const p = pool[hashKey(`${villager}|${nth}|${day}`) % pool.length];
  return { page: p.id, text: p.rumour! };
}

// ---------------------------------------------------------------------------------------------
// What's new (a letter from Fern listing what was added since your last visit)

export interface Feature {
  /** the release it came in (increasing) */
  ver: number;
  /** the notebook page it opens, if any */
  page?: string;
  title: string;
  line: string;
}

/** Everything added to the valley, by release. Append; never renumber (versions are save keys). */
export const FEATURES: readonly Feature[] = Object.freeze([
  { ver: 1, page: 'summit', title: 'The summit trail', line: 'a footpath up the cliffs to a lookout, a valley viewer and a cairn.' },
  { ver: 1, page: 'gathering', title: 'Evenings & markets', line: 'campfires by the pond, concerts at the bandstand, market mornings.' },
  { ver: 2, title: 'The stamp book', line: 'long-term goals across the whole valley, in the Almanac (H, then S).' },
  { ver: 2, page: 'pet', title: 'A pet of your own', line: 'foundlings in a basket by Fern\'s signpost, looking for a home.' },
  { ver: 3, page: 'barn', title: 'Barn chores', line: 'the barn is open: hay, grain, milk, eggs and a donkey who likes a brush.' },
  { ver: 3, page: 'rowboat', title: 'The rowboat', line: 'tied at the pond dock from spring to autumn; the middle has the bigger fish.' },
  { ver: 3, page: 'skate', title: 'Skating & snowmen', line: 'skate the frozen pond in winter, and roll snowmen when it settles.' },
  { ver: 4, page: 'gazette', title: 'The Valley Gazette', line: 'a little paper about your real week (G), and a weekly edition in the post.' },
  { ver: 4, title: 'Settings for everyone', line: 'rebind keys, colour-safe status shapes, captions and calmer motion (Esc → Settings).' },
  { ver: 5, page: 'lantern', title: 'Your own paws', line: 'carry a lantern after dark ({lantern}) and wave at the neighbours ({wave}).' },
  { ver: 5, page: 'photo', title: 'A photo album', line: 'photo mode\'s snaps now keep in an album (L), favourites on the farmhouse wall.' },
  { ver: 5, title: 'Git in the fields', line: 'every field shows its branch and uncommitted work at a glance.' },
  { ver: 5, page: 'grotto', title: 'A rumour', line: 'the waterfall has been sounding strangely hollow lately. Make of that what you will.' },
  { ver: 6, title: 'This very notebook', line: 'every pastime in the valley, how to do it, and hints for the ones you haven\'t found ({notebook}).' },
  { ver: 7, page: 'projects', title: 'Valley projects', line: 'the Mayor\'s board on the square: mend the footbridge, light the lantern path, raise a glasshouse and more, together.' },
  { ver: 7, page: 'orchard', title: 'The hillside orchard', line: 'fruit trees, beehives and a cider press behind a stone wall on the east foothills. Shake what\'s ripe!' },
  { ver: 8, page: 'visitors', title: 'Comings and goings', line: 'a travelling merchant\'s cart on Wednesdays and Saturdays, a wandering painter on fair days, and parcels once the halt reopens.' },
] as Feature[]);
export const LATEST = Math.max(...FEATURES.map((f) => f.ver));
/**
 * A profile from before the notebook (welcomed, but no notebook record yet) is assumed to know the releases up to
 * here: it hears about the ones after. (Nobody could have told it about anything newer: the letter didn't exist.)
 */
export const BASELINE = 4;
/** at most this many lines in one letter (the newest releases first if there are more) */
export const NEWS_MAX = 8;

export interface NewsLetter { id: string; at: number; title: string; body: string; ver: number }

/** The features a profile hasn't heard about: newer than `last`, newest release first, capped. */
export function newsSince(last: number): Feature[] {
  return FEATURES.filter((f) => f.ver > last).sort((a, b) => b.ver - a.ver).slice(0, NEWS_MAX);
}

export function newsLetter(items: readonly Feature[], at: number, keys: Readonly<Record<string, string>> = {}): NewsLetter {
  const ver = Math.max(0, ...items.map((f) => f.ver));
  return {
    id: `guide:news:${ver}`, at, ver,
    title: items.length === 1 ? `New in the valley: ${items[0].title.toLowerCase()}` : 'New pages for your notebook',
    body: [
      'Hello again, neighbour! A few things have changed round here since you were last by:',
      items.map((f) => `• ${f.title}: ${fillKeys(f.line, keys)}`).join('\n'),
      `I've written them up in my field notebook (${keys.notebook ?? 'O'}), with how-tos for everything you've tried and a hint or two for what you haven't.`,
      'See you on the trail, Fern',
    ].join('\n\n'),
  };
}

// ---------------------------------------------------------------------------------------------
// Persistence + the live service

export interface GuideData {
  v: 1;
  seen: SeenId[];
  /** pages announced ("a new page in Fern's notebook"), or found before the notebook existed: announced once ever */
  told: string[];
  /** pages you've looked at in the notebook (or found before it existed): the rest of the found ones are "new" */
  known: string[];
  /** the feature release you've heard about (0 = never set) */
  news: number;
  /** the last "what's new" letter (re-posted to the mailbox on load) */
  letter: NewsLetter | null;
}
export const emptyGuide = (): GuideData => ({ v: 1, seen: [], told: [], known: [], news: 0, letter: null });

const SEEN_SET = new Set<string>(SEEN_IDS);
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : 0);

/** Tolerant parse (anything malformed → null; unknown ids dropped). */
export function parseGuide(raw: unknown): GuideData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const strs = (v: unknown, ok: (s: string) => boolean) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && ok(x)))] : []);
  const l = o.letter as Record<string, unknown> | null | undefined;
  const letter = l && typeof l === 'object' && typeof l.id === 'string' && typeof l.title === 'string' && typeof l.body === 'string'
    ? { id: l.id, at: num(l.at, 0, 8.64e15), title: l.title, body: l.body, ver: num(l.ver, 0, 1e6) } : null;
  return { v: 1, seen: strs(o.seen, (s) => SEEN_SET.has(s)) as SeenId[], told: strs(o.told, (s) => BY_ID.has(s)), known: strs(o.known, (s) => BY_ID.has(s)), news: num(o.news, 0, 1e6), letter };
}

/**
 * Settle the "what's new" letter on load. `fresh` = no stored notebook record; `welcomed` = this profile has met Posy
 * (a first-run profile hasn't: it gets her welcome, never this letter). Returns the features to write about (empty: no
 * letter) and moves `d.news` to the latest release.
 */
export function newsDue(d: GuideData, o: { fresh: boolean; welcomed: boolean }): Feature[] {
  if (!o.welcomed) { d.news = LATEST; return []; }
  const last = o.fresh || d.news === 0 ? BASELINE : d.news;
  d.news = Math.max(d.news, LATEST);
  return newsSince(last);
}

export interface GuideStore { load(): unknown; save(d: GuideData): void }

export type GuideChange =
  | { kind: 'found'; pages: PageDef[] }
  | { kind: 'seen'; id: SeenId }
  | { kind: 'read'; page: string }
  | { kind: 'news'; letter: NewsLetter }
  | { kind: 'reset' };

export interface GuideService {
  readonly version: number;
  data(): Readonly<GuideData>;
  /** the last world snapshot's view */
  view(): GuideView;
  /** a real signal for something only the notebook remembers */
  see(id: SeenId): void;
  /** a fresh world snapshot (≈ 1 Hz): returns the pages found since the last one */
  update(w: GuideWorld): PageDef[];
  /** the last world snapshot */
  world(): GuideWorld;
  /** the player looked at a page in the notebook */
  read(page: string): void;
  /** a villager's rumour for the n-th chat (rate-limited across the village), or null */
  rumour(villager: string, nth: number): string | null;
  /** settle the "what's new" letter (once, on load) */
  news(o: { welcomed: boolean; keys?: Readonly<Record<string, string>> }): NewsLetter | null;
  onChange(fn: (c: GuideChange) => void): () => void;
  /** dev: forget everything */
  devReset(): void;
}

export function createGuide(st: GuideStore | undefined, o: { now?: () => number } = {}): GuideService {
  const now = o.now ?? Date.now;
  let stored: GuideData | null = null;
  try { stored = parseGuide(st?.load()); } catch { stored = null; }
  const fresh = !stored;
  let d = stored ?? emptyGuide();
  let version = 0, w: GuideWorld = { ...emptyGuideWorld(), seen: d.seen };
  let primed = false;
  let rumourAt = -Infinity;
  const fns = new Set<(c: GuideChange) => void>();
  const save = () => { try { st?.save(d); } catch (err) { console.warn('[guide] save failed', err); } };
  const changed = (c: GuideChange) => {
    version++;
    save();
    for (const f of [...fns]) { try { f(c); } catch (err) { console.error('[guide] listener threw', err); } }
  };
  return {
    get version() { return version; },
    data: () => d,
    view: () => guideView(w, d.known),
    world: () => w,
    see(id) {
      if (!SEEN_SET.has(id) || d.seen.includes(id)) return;
      d.seen.push(id);
      w = { ...w, seen: d.seen };
      changed({ kind: 'seen', id });
    },
    update(next) {
      w = { ...next, seen: d.seen };
      const ids = PAGES.filter((p) => isFound(p, w)).map((p) => p.id);
      if (!primed) {
        primed = true;
        // a profile from before the notebook: what it has already done is old news (no burst of "new page" toasts)
        if (fresh) {
          for (const id of ids) { if (!d.told.includes(id)) d.told.push(id); if (!d.known.includes(id)) d.known.push(id); }
          version++; save();
          return [];
        }
      }
      // announced once ever (a service that turns up late can't make an old page "new" again)
      const added = ids.filter((id) => !d.told.includes(id));
      if (!added.length) return [];
      d.told.push(...added);
      const pages = added.map((id) => BY_ID.get(id)!);
      changed({ kind: 'found', pages });
      return pages;
    },
    read(page) {
      if (!BY_ID.has(page) || d.known.includes(page) || !isFound(BY_ID.get(page)!, w)) return;
      d.known.push(page);
      changed({ kind: 'read', page });
    },
    rumour(villager, nth) {
      const t = now();
      if (t - rumourAt < RUMOUR_GAP_MS) return null;
      const r = rumourFor(w, villager, nth, dayKey(t));
      if (r) rumourAt = t;
      return r?.text ?? null;
    },
    news(x) {
      const items = newsDue(d, { fresh, welcomed: x.welcomed });
      if (!items.length) { version++; save(); return null; }
      d.letter = newsLetter(items, now(), x.keys);
      changed({ kind: 'news', letter: d.letter });
      return d.letter;
    },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devReset() { d = emptyGuide(); primed = true; w = { ...w, seen: d.seen }; changed({ kind: 'reset' }); },
  };
}
