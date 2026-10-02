// @pure
/**
 * Friendship with the valley's six villagers, and their little daily requests.
 *
 *  - **Hearts** (0–10, `HEART` points each): the first chat of the day with someone (+`PTS.talk`), one gift a day each
 *    from your basket (loved / liked / neutral / disliked, `tierOf`), and finishing their requests (+`PTS.request`).
 *    What they think of a gift is learned the first time you give it (`known`), so the gift picker can say so.
 *  - **Requests**: each real day 1–3 villagers post one small request on the noticeboard, deterministic per date and
 *    season (`requestsFor`): bring some of a forageable in season, catch a fish (sometimes before dusk, or anything
 *    after dark), visit a far nook at the right hour, or something your agents do (answer one who needs you, ship a
 *    commit, a green test run, a finished task). Progress is tracked here; when it's done you tell them (`deliver`),
 *    which pays bits and hearts. Unfinished requests lapse at midnight.
 *  - **Milestones** (`MILESTONES`): at 2 hearts a letter, at 4 a warmer set of lines, at 6 their own decor piece in the
 *    General store (model/shop.ts `friend`), at 8 a recipe letter, at 10 a keepsake for your yard and a last letter.
 *
 * Pure: no DOM, no three; the clock, the store, the basket and the purse are injected. Days are local (`dayKey`).
 */
import type { Season, ValleyEventKind } from './types.ts';
import { dayKey } from './almanac.ts';
import { FISHES, collectDef, forageFor, hashKey, isNight, rand } from './collection.ts';
import { sellPrice } from './shop.ts';

export const FRIEND_IDS = Object.freeze(['villager:posy', 'villager:bram', 'villager:hazel', 'villager:marigold', 'villager:fern', 'villager:nimbus'] as const);
export type FriendId = (typeof FRIEND_IDS)[number];
export type Tier = 'love' | 'like' | 'neutral' | 'dislike';

export interface FriendDef {
  id: FriendId;
  /** "Posy", "Mayor Marigold" */
  name: string;
  /** first name for short copy ("Marigold") */
  short: string;
  title: string;
  /** css colours: body, and a darker shade (HUD portraits) */
  color: string;
  dark: string;
  glyph: string;
  loves: readonly string[];
  likes: readonly string[];
  dislikes: readonly string[];
  /** their decor piece in the General store (unlocked at 6 hearts) and their 10-heart keepsake (model/shop.ts ids) */
  decor: string;
  keepsake: string;
}

const FD = (o: FriendDef): FriendDef => Object.freeze(o);
/** The cast as the model knows it (scene/villagers/cast.ts has the looks and routines; the ids match). */
export const FRIENDS: readonly FriendDef[] = Object.freeze([
  FD({ id: 'villager:posy', name: 'Posy', short: 'Posy', title: 'Postmaster', color: '#3d9fa8', dark: '#2b7d86', glyph: '✉',
    loves: ['violet', 'berries', 'shell'], likes: ['mapleleaf', 'holly', 'feather', 'boot', 'bluegill'], dislikes: ['eel', 'catfish'],
    decor: 'postbox', keepsake: 'keep-posy' }),
  FD({ id: 'villager:bram', name: 'Bram', short: 'Bram', title: 'Shipping clerk', color: '#e6c547', dark: '#bf9e2c', glyph: '▣',
    loves: ['salmon', 'pike', 'carp', 'stormbass'], likes: ['trout', 'perch', 'catfish', 'holly', 'eel'], dislikes: ['minnow', 'violet'],
    decor: 'crates', keepsake: 'keep-bram' }),
  FD({ id: 'villager:hazel', name: 'Hazel', short: 'Hazel', title: 'Miller', color: '#d9c08a', dark: '#b39a66', glyph: '✣',
    loves: ['hazelnut', 'acorn', 'chanterelle'], likes: ['berries', 'wildleek', 'morel', 'perch'], dislikes: ['boot', 'eel', 'pinecone'],
    decor: 'millstone', keepsake: 'keep-hazel' }),
  FD({ id: 'villager:marigold', name: 'Mayor Marigold', short: 'Marigold', title: 'Mayor', color: '#9b5a8c', dark: '#7a4470', glyph: '★',
    loves: ['koi', 'chanterelle', 'mapleleaf', 'char'], likes: ['hazelnut', 'holly', 'carp', 'trout', 'salmon'], dislikes: ['boot', 'minnow', 'skipstone'],
    decor: 'prizepumpkin', keepsake: 'keep-marigold' }),
  FD({ id: 'villager:fern', name: 'Fern', short: 'Fern', title: 'Ranger', color: '#5d8f45', dark: '#46702f', glyph: '⌖',
    loves: ['feather', 'pinecone', 'morel', 'trout'], likes: ['acorn', 'wildleek', 'skipstone', 'mapleleaf', 'holly'], dislikes: ['koi', 'boot'],
    decor: 'tent', keepsake: 'keep-fern' }),
  FD({ id: 'villager:nimbus', name: 'Nimbus', short: 'Nimbus', title: 'Weather-watcher', color: '#6fb7e0', dark: '#4d93bd', glyph: '☂',
    loves: ['crystal', 'bottle', 'stormbass', 'char'], likes: ['pinecone', 'feather', 'shell', 'eel'], dislikes: ['wildleek', 'morel'],
    decor: 'vane', keepsake: 'keep-nimbus' }),
] as FriendDef[]);
const BY_ID = new Map<string, FriendDef>(FRIENDS.map((f) => [f.id, f]));
/** 'villager:posy' or just 'posy' */
export const friendDef = (id: string): FriendDef | undefined => BY_ID.get(id) ?? BY_ID.get(`villager:${id}`);

/** points per heart, and the most hearts anyone can have */
export const HEART = 100;
export const MAX_HEARTS = 10;
const MAX_PTS = HEART * MAX_HEARTS;
/** friendship points: the day's first chat, a gift by how much they like it, a finished request */
export const PTS = Object.freeze({ talk: 20, love: 80, like: 45, neutral: 20, dislike: -25, request: 60 });

export function tierOf(f: FriendDef, item: string): Tier {
  if (f.loves.includes(item)) return 'love';
  if (f.likes.includes(item)) return 'like';
  if (f.dislikes.includes(item)) return 'dislike';
  return 'neutral';
}
export const heartsOf = (pts: number): number => Math.max(0, Math.min(MAX_HEARTS, Math.floor(pts / HEART)));

// ---------------------------------------------------------------------------------------------
// Milestones

export type Unlock = 'letter' | 'lines' | 'decor' | 'recipe' | 'keepsake';
export const MILESTONES: readonly { hearts: number; unlock: Unlock; label: string }[] = Object.freeze([
  { hearts: 2, unlock: 'letter', label: 'a letter' },
  { hearts: 4, unlock: 'lines', label: 'new things to talk about' },
  { hearts: 6, unlock: 'decor', label: 'their own piece in the General store' },
  { hearts: 8, unlock: 'recipe', label: 'a recipe' },
  { hearts: 10, unlock: 'keepsake', label: 'a keepsake for your yard' },
]);

/** The letters a friendship brings (2 hearts: a note, 8: a recipe, 10: with the keepsake). Warm, short, signed. */
const LETTERS: Readonly<Record<FriendId, Readonly<Record<'letter' | 'recipe' | 'keepsake', { title: string; body: string }>>>> = {
  'villager:posy': {
    letter: { title: 'A note from Posy', body: 'I don\'t usually deliver my own letters, but I made an exception.\n\nThank you for stopping by the mailbox to chat. Most folk only come for the post! I pressed a violet in here for you. Mind it doesn\'t fall out.\n\nYours, by first-class pigeon,\nPosy' },
    recipe: { title: 'Posy\'s violet shortbread', body: 'You asked what I nibble on the rounds. Here it is, and don\'t tell Bram, he thinks I buy them.\n\n- 2 cups flour (Hazel\'s, nothing else will do)\n- 1 cup butter, soft\n- half a cup of sugar, ground with a handful of violets\n\nRub it together, press it flat, prick it with a fork, bake till pale gold. Eat one warm, post the rest.\n\nPosy' },
    keepsake: { title: 'Something for your yard, from Posy', body: 'I had Bram paint this for me (don\'t laugh, he\'s rather good). It\'s me at the mailbox, so the yard always has a postmaster in it.\n\nYou\'re my favourite letter of the day, you know. Every day.\n\nLove,\nPosy' },
  },
  'villager:bram': {
    letter: { title: 'Bram, from the shipping bin', body: 'Short note, I\'m no letter-writer.\n\nThe ledger balances better with you about. Don\'t know how that works, but there it is. Drop by the bin whenever you like.\n\nBram\n(shipping clerk)' },
    recipe: { title: 'Bram\'s fish stew for a cold shift', body: 'Feeds one clerk, or two farmers.\n\n- one good fish, the bigger the better, cut in chunks\n- a leek, an onion, two potatoes\n- water, salt, a knob of butter, black pepper\n\nSweat the leek and onion, add potatoes and water, simmer till soft. Fish in for the last ten minutes. Eat it out of the pot by the bin. Plates are for festivals.\n\nBram' },
    keepsake: { title: 'For you. Bram.', body: 'Posy said you\'d like a picture. So there\'s a picture. It\'s me, with the ledger.\n\nTen out of ten, as a friend. I checked the sums twice.\n\nBram' },
  },
  'villager:hazel': {
    letter: { title: 'Flour and thanks, from Hazel', body: 'The sails were singing this morning and I thought of you, which is a nice thing to think of while sweeping.\n\nCome up to the mill any time. Mind the flour, it gets everywhere, and I mean everywhere.\n\nHazel' },
    recipe: { title: 'Hazel\'s hazelnut loaf', body: 'Yes, I know. The Mayor will never let it go.\n\n- 3 cups of my best wholemeal\n- a cup of hazelnuts, toasted and roughly chopped\n- a spoon of honey from the orchard stand, yeast, salt, warm water\n\nKnead till it\'s smooth as a millstone, let it rise by the warm stove, fold in the nuts, bake hot. Tap the bottom: it should sound hollow, like a good barn.\n\nHazel' },
    keepsake: { title: 'From the mill, with love', body: 'A little portrait, so there\'s a miller watching over your yard. Fern swears it looks just like me. Fern has never once seen me without flour on my nose.\n\nThank you for every visit.\n\nHazel' },
  },
  'villager:marigold': {
    letter: { title: 'From the desk of Mayor Marigold', body: 'Dear valued resident,\n\nIt has come to the attention of the Mayor\'s office (me) that you are a delight. This has been minuted.\n\nKeep up the good work, and do come and admire the noticeboard.\n\nMayor Marigold' },
    recipe: { title: 'The Mayor\'s prize pumpkin soup', body: 'An official recipe of the valley. Do not reproduce without a ribbon.\n\n- one pumpkin (a prize one, ideally; any will do in a pinch)\n- an onion, two cloves of garlic, a pinch of nutmeg\n- stock, cream, a little pride\n\nRoast the pumpkin, soften the onion, simmer everything, blend it smooth. Serve in the hollowed-out pumpkin for full ceremony.\n\nMayor Marigold' },
    keepsake: { title: 'An official portrait for your yard', body: 'Every proper garden needs a portrait of its mayor. This one is yours.\n\nBetween us, and not for the minutes: you\'re the best friend the valley\'s had in years. There. It\'s said.\n\nMarigold' },
  },
  'villager:fern': {
    letter: { title: 'Fern, from the trail', body: 'Writing this by the campfire, so forgive the smudges.\n\nThe owls were out by the stones last night. I thought you\'d want to know. Most people wouldn\'t. That\'s why I\'m telling you.\n\nFern' },
    recipe: { title: 'Fern\'s campfire bannock', body: 'Trail bread. Never fails, never needs an oven.\n\n- a cup of flour, a pinch of salt, a spoon of baking powder\n- water till it\'s a soft dough\n- a handful of whatever berries the meadow\'s giving\n\nWrap it round a green stick, toast it over the embers, turning slowly while you tell a story. It\'s done when the story is.\n\nFern' },
    keepsake: { title: 'For the yard. From Fern.', body: 'Hazel made me sit for this. Took forever. I kept looking at the birds.\n\nYou\'ve walked every trail I asked you to, and a few I didn\'t. You\'d make a good ranger.\n\nFern' },
  },
  'villager:nimbus': {
    letter: { title: 'Nimbus\'s forecast, for you only', body: 'Personal forecast: warm spells, increasing. Visibility excellent. A strong chance of good company.\n\nCome up to the knoll one night; the stars are better with two.\n\nNimbus' },
    recipe: { title: 'Nimbus\'s storm-watch cocoa', body: 'For long nights at the telescope.\n\n- a mug of milk, warmed slow (never boiled, it sulks)\n- two spoons of cocoa, one of sugar\n- a pinch of salt, a pinch of cinnamon, and a cold night\n\nWhisk till frothy, wrap your hands round it, watch the sky. If the pinecones close up, add a second mug.\n\nNimbus' },
    keepsake: { title: 'A clear-sky portrait', body: 'I commissioned this on a cloudless day, which is very rare and therefore lucky.\n\nForecast for our friendship: fair, settled, set to last. I\'m never wrong about that sort of thing.\n\nNimbus' },
  },
};
export function milestoneLetter(id: FriendId, unlock: 'letter' | 'recipe' | 'keepsake'): { title: string; body: string } {
  return LETTERS[id][unlock];
}

// ---------------------------------------------------------------------------------------------
// Requests

export type ReqKind = 'bring' | 'catch' | 'visit' | 'agent';
/** when a catch / visit counts */
export type ReqWhen = 'any' | 'night' | 'dawn' | 'day' | 'dusk' | 'beforeDusk';
/** agent work a request asks for (ValleyEvent kinds: unblocked, ship, celebrate, finished) */
export type AgentGoal = 'answer' | 'ship' | 'tests' | 'finished';
/** places a visit can ask for (world/map.ts structure ids) */
export type VisitPlace = 'stones' | 'lookout' | 'swingtree' | 'orchard' | 'hotspring' | 'haymeadow' | 'waterfall';

export const PLACE_NAME: Readonly<Record<VisitPlace, string>> = Object.freeze({
  stones: 'the standing stones', lookout: 'the stargazers\' knoll', swingtree: 'the swing tree', orchard: 'the orchard',
  hotspring: 'the hot spring', haymeadow: 'the hay meadow', waterfall: 'the waterfall',
});
const GOAL: Readonly<Record<AgentGoal, { event: ValleyEventKind; text: string }>> = Object.freeze({
  answer: { event: 'unblocked', text: 'Answer a farmer who needs you' },
  ship: { event: 'ship', text: 'Ship a commit' },
  tests: { event: 'celebrate', text: 'Get a green test run' },
  finished: { event: 'finished', text: 'See a farmer finish a task' },
});
const WHEN_TEXT: Readonly<Record<ReqWhen, string>> = Object.freeze({ any: '', night: ' after dark', dawn: ' at dawn', day: ' by daylight', dusk: ' at dusk', beforeDusk: ' before dusk' });

export interface Request {
  /** `YYYY-MM-DD:villager:id` */
  id: string;
  who: FriendId;
  kind: ReqKind;
  /** bring: collectible id; catch: fish id or 'any' */
  item?: string;
  place?: VisitPlace;
  goal?: AgentGoal;
  when: ReqWhen;
  /** how many */
  n: number;
  /** progress for catch / visit / agent (bring counts the basket) */
  have: number;
  /** bits paid when delivered */
  reward: number;
  state: 'open' | 'ready' | 'done';
  /** they've told you about it (talking to them) */
  asked?: boolean;
}

/** Is the local hour inside a request's window? */
export function inWindow(w: ReqWhen, hour: number): boolean {
  switch (w) {
    case 'any': return true;
    case 'night': return isNight(hour);
    case 'dawn': return hour >= 4.5 && hour < 9;
    case 'day': return hour >= 7 && hour < 19;
    case 'dusk': return hour >= 17 && hour < 21.5;
    case 'beforeDusk': return hour >= 4 && hour < 18;
  }
}

type Draft = Pick<Request, 'kind' | 'when' | 'n'> & Partial<Pick<Request, 'item' | 'place' | 'goal'>>;
type Tmpl = (season: Season, r: () => number) => Draft | null;

const inSeason = (id: string, s: Season): boolean => !!collectDef(id)?.seasons.includes(s);
/** bring some of the first of `ids` that grows this season (rares: just one) */
const bring = (ids: readonly string[], lo: number, hi: number): Tmpl => (s, r) => {
  const ok = ids.filter((id) => inSeason(id, s) && collectDef(id)?.kind === 'forage' && forageFor(s).some((f) => f.id === id));
  if (!ok.length) return null;
  const id = ok[Math.floor(r() * ok.length)];
  return { kind: 'bring', item: id, n: collectDef(id)?.rare ? 1 : lo + Math.floor(r() * (hi - lo + 1)), when: 'any' };
};
/** catch one of `ids` that bites this season in any weather (`when` must suit when it bites) */
const catchOne = (ids: readonly string[], when: ReqWhen = 'any'): Tmpl => (s, r) => {
  const ok = ids.filter((id) => {
    const d = FISHES.find((f) => f.id === id);
    if (!d || d.junk || !d.seasons.includes(s) || d.weather !== 'any') return false;
    if (when === 'beforeDusk' || when === 'day') return d.time === 'day' || d.time === 'any';
    if (when === 'night') return d.time === 'night' || d.time === 'any';
    return true;
  });
  if (!ok.length) return null;
  return { kind: 'catch', item: ok[Math.floor(r() * ok.length)], n: 1, when };
};
const catchAny = (n: number, when: ReqWhen): Tmpl => () => ({ kind: 'catch', item: 'any', n, when });
const visit = (place: VisitPlace, when: ReqWhen): Tmpl => () => ({ kind: 'visit', place, n: 1, when });
const agent = (goal: AgentGoal): Tmpl => () => ({ kind: 'agent', goal, n: 1, when: 'any' });

/** What each villager tends to ask for (filtered by season; one is picked per request day). */
const POOLS: Readonly<Record<FriendId, readonly Tmpl[]>> = {
  'villager:posy': [bring(['violet', 'berries', 'shell', 'mapleleaf', 'holly'], 2, 4), agent('answer'), visit('orchard', 'day')],
  'villager:bram': [catchOne(['salmon', 'pike', 'carp', 'trout']), catchOne(['perch', 'bluegill', 'carp'], 'beforeDusk'), agent('ship'), agent('ship')],
  'villager:hazel': [bring(['hazelnut', 'acorn', 'chanterelle', 'wildleek', 'morel', 'berries', 'pinecone', 'holly'], 2, 4), agent('tests'), visit('haymeadow', 'any')],
  'villager:marigold': [agent('finished'), bring(['mapleleaf', 'holly', 'violet', 'berries', 'chanterelle'], 2, 3), visit('hotspring', 'dusk')],
  'villager:fern': [visit('stones', 'night'), visit('swingtree', 'any'), bring(['feather', 'pinecone', 'morel', 'acorn', 'skipstone'], 2, 3), catchOne(['trout', 'perch'])],
  'villager:nimbus': [visit('lookout', 'night'), catchAny(1, 'night'), bring(['crystal', 'pinecone', 'feather', 'shell'], 2, 3)],
};

/** bits a finished request pays */
function rewardOf(d: Draft): number {
  const r5 = (v: number) => Math.max(10, Math.round(v / 5) * 5);
  switch (d.kind) {
    case 'bring': return r5(sellPrice(d.item ?? '') * d.n * 1.6 + 15);
    case 'catch': return r5(d.item === 'any' ? 30 : sellPrice(d.item ?? '') * 1.5 + 20);
    case 'visit': return d.when === 'any' ? 25 : 35;
    case 'agent': return 30;
  }
}

/** The day's requests: 1–3 villagers, one request each, deterministic per date + season. */
export function requestsFor(day: string, season: Season): Request[] {
  const r = rand(hashKey(`requests:${day}:${season}`));
  const n = 1 + Math.floor(r() * 3);
  const order = [...FRIEND_IDS].map((id) => ({ id, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.id);
  const out: Request[] = [];
  for (const who of order) {
    if (out.length >= n) break;
    const drafts = POOLS[who].map((t) => t(season, r)).filter((d): d is Draft => !!d);
    if (!drafts.length) continue;
    const d = drafts[Math.floor(r() * drafts.length)];
    out.push({ id: `${day}:${who.slice(9)}:${d.kind}`, who, ...d, have: 0, reward: rewardOf(d), state: 'open' });
  }
  return out;
}

const plural = (n: number, one: string): string => {
  if (n === 1) return one;
  if (/(berries|leeks|strawberries)$/i.test(one)) return one;
  if (/leaf$/.test(one)) return `${one.slice(0, -1)}ves`;
  if (/y$/.test(one) && !/[aeiou]y$/.test(one)) return `${one.slice(0, -1)}ies`;
  if (/(sh|ch|s|x)$/.test(one)) return `${one}es`;
  return `${one}s`;
};
/** "3 chanterelles", "a pike", "a frost crystal" */
export function itemText(id: string, n: number): string {
  const name = (collectDef(id)?.name ?? id).toLowerCase().replace(/^pond /, '');
  if (n === 1) return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
  return `${n} ${plural(n, name)}`;
}

/** Short imperative for the tracker / noticeboard: "Bring Hazel 3 chanterelles", "Visit the standing stones after dark for Fern". */
export function requestText(q: Request): string {
  const f = friendDef(q.who);
  const who = f?.short ?? '';
  switch (q.kind) {
    case 'bring': return `Bring ${who} ${itemText(q.item ?? '', q.n)}`;
    case 'catch': return q.item === 'any' ? `Catch ${q.n === 1 ? 'a fish' : `${q.n} fish`}${WHEN_TEXT[q.when]} for ${who}` : `Catch ${itemText(q.item ?? '', 1)}${WHEN_TEXT[q.when]} for ${who}`;
    case 'visit': return `Visit ${PLACE_NAME[q.place ?? 'stones']}${WHEN_TEXT[q.when]} for ${who}`;
    case 'agent': return `${GOAL[q.goal ?? 'ship'].text}${q.goal === 'answer' ? ',' : ''} for ${who}`;
  }
}

export interface RequestView {
  req: Request;
  friend: FriendDef;
  text: string;
  /** progress: have / n (bring: what's in your basket) */
  have: number;
  n: number;
  ready: boolean;
  done: boolean;
  /** what to do next, one line ("tell Hazel", "2 more in your basket", "after 8 pm") */
  next: string;
}

export function requestView(q: Request, basket: (id: string) => number): RequestView {
  const friend = friendDef(q.who)!;
  const have = Math.min(q.n, q.kind === 'bring' ? basket(q.item ?? '') : q.have);
  const done = q.state === 'done';
  const ready = !done && (q.kind === 'bring' ? have >= q.n : q.state === 'ready');
  let next: string;
  if (done) next = 'done, thank you!';
  else if (ready) next = `tell ${friend.short}`;
  else if (q.kind === 'bring') next = `${have} of ${q.n} in your basket`;
  else if (q.kind === 'visit') next = q.when === 'night' ? 'after 8 pm' : q.when === 'dusk' ? 'between 5 and 9 pm' : q.when === 'day' ? 'by day' : 'any time today';
  else if (q.kind === 'catch') next = q.when === 'night' ? 'after 8 pm, at the pond or river' : q.when === 'beforeDusk' ? 'before 6 pm' : 'at the pond or river';
  else next = 'your farmers, today';
  return { req: q, friend, text: requestText(q), have: done ? q.n : have, n: q.n, ready, done, next };
}

// ---------------------------------------------------------------------------------------------
// The data (persisted)

export interface FriendLetter { id: string; at: number; from: FriendId; title: string; body: string }

export interface FriendsData {
  v: 1;
  /** friendship points per villager (0..HEART * MAX_HEARTS) */
  pts: Record<string, number>;
  /** the last day (YYYY-MM-DD) you chatted / gave a gift, per villager */
  talked: Record<string, string>;
  gifted: Record<string, string>;
  /** what you've learned they think of things, per villager per item */
  known: Record<string, Record<string, Tier>>;
  /** the highest milestone (hearts) already rewarded, per villager */
  got: Record<string, number>;
  /** letters they've sent (the mailbox shows them again after a reload) */
  letters: FriendLetter[];
  /** today's requests */
  req: { day: string; list: Request[] };
  total: { gifts: number; requests: number };
}

export const emptyFriends = (): FriendsData => ({ v: 1, pts: {}, talked: {}, gifted: {}, known: {}, got: {}, letters: [], req: { day: '', list: [] }, total: { gifts: 0, requests: 0 } });

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIERS: readonly Tier[] = ['love', 'like', 'neutral', 'dislike'];
const WHENS: readonly ReqWhen[] = ['any', 'night', 'dawn', 'day', 'dusk', 'beforeDusk'];
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : null);

function parseRequest(raw: unknown): Request | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.id !== 'string' || typeof q.who !== 'string' || !BY_ID.has(q.who)) return null;
  if (!['bring', 'catch', 'visit', 'agent'].includes(q.kind as string)) return null;
  const n = int(q.n, 1, 99), have = int(q.have, 0, 99), reward = int(q.reward, 0, 9999);
  if (!n || have === null || reward === null) return null;
  const when = WHENS.includes(q.when as ReqWhen) ? q.when as ReqWhen : 'any';
  const state = (['open', 'ready', 'done'] as const).find((s) => s === q.state) ?? 'open';
  const out: Request = { id: q.id, who: q.who as FriendId, kind: q.kind as ReqKind, when, n, have, reward, state };
  if (typeof q.item === 'string') out.item = q.item;
  if (typeof q.place === 'string' && q.place in PLACE_NAME) out.place = q.place as VisitPlace;
  if (typeof q.goal === 'string' && q.goal in GOAL) out.goal = q.goal as AgentGoal;
  if (q.asked === true) out.asked = true;
  if (out.kind === 'bring' && !collectDef(out.item ?? '')) return null;
  if (out.kind === 'visit' && !out.place) return null;
  if (out.kind === 'agent' && !out.goal) return null;
  return out;
}

/** Tolerant parse of stored data (anything malformed → null; unknown villagers / items are dropped). */
export function parseFriends(raw: unknown): FriendsData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || !o.pts || typeof o.pts !== 'object') return null;
  const d = emptyFriends();
  const each = (src: unknown, fn: (id: string, v: unknown) => void) => {
    if (src && typeof src === 'object') for (const [id, v] of Object.entries(src as Record<string, unknown>)) if (BY_ID.has(id)) fn(id, v);
  };
  each(o.pts, (id, v) => { const n = int(v, 0, MAX_PTS); if (n !== null) d.pts[id] = n; });
  each(o.talked, (id, v) => { if (typeof v === 'string' && DAY_RE.test(v)) d.talked[id] = v; });
  each(o.gifted, (id, v) => { if (typeof v === 'string' && DAY_RE.test(v)) d.gifted[id] = v; });
  each(o.got, (id, v) => { const n = int(v, 0, MAX_HEARTS); if (n) d.got[id] = n; });
  each(o.known, (id, v) => {
    if (!v || typeof v !== 'object') return;
    const k: Record<string, Tier> = {};
    for (const [item, t] of Object.entries(v as Record<string, unknown>)) if (collectDef(item) && TIERS.includes(t as Tier)) k[item] = t as Tier;
    d.known[id] = k;
  });
  if (Array.isArray(o.letters)) for (const l of o.letters.slice(-40)) {
    if (!l || typeof l !== 'object') continue;
    const x = l as Record<string, unknown>;
    if (typeof x.id === 'string' && typeof x.at === 'number' && typeof x.from === 'string' && BY_ID.has(x.from) && typeof x.title === 'string' && typeof x.body === 'string') {
      d.letters.push({ id: x.id, at: x.at, from: x.from as FriendId, title: x.title, body: x.body });
    }
  }
  const rq = o.req as Record<string, unknown> | undefined;
  if (rq && typeof rq.day === 'string' && DAY_RE.test(rq.day) && Array.isArray(rq.list)) {
    d.req = { day: rq.day, list: rq.list.map(parseRequest).filter((q): q is Request => !!q).slice(0, 6) };
  }
  const t = (o.total ?? {}) as Record<string, unknown>;
  d.total = { gifts: int(t.gifts, 0, 1e9) ?? 0, requests: int(t.requests, 0, 1e9) ?? 0 };
  return d;
}

// ---------------------------------------------------------------------------------------------
// Pure operations (mutate `d`)

export const pointsOf = (d: FriendsData, id: string): number => d.pts[id] ?? 0;
export const heartsIn = (d: FriendsData, id: string): number => heartsOf(pointsOf(d, id));

/** Add (or take) friendship points. Returns the hearts before and after. */
export function addPoints(d: FriendsData, id: string, n: number): { before: number; after: number } {
  const before = heartsIn(d, id);
  d.pts[id] = Math.max(0, Math.min(MAX_PTS, pointsOf(d, id) + Math.round(n)));
  return { before, after: heartsIn(d, id) };
}

/** Milestones reached and not yet rewarded (marks them rewarded). */
export function claimMilestones(d: FriendsData, id: string): { hearts: number; unlock: Unlock }[] {
  const h = heartsIn(d, id), got = d.got[id] ?? 0;
  const out = MILESTONES.filter((m) => m.hearts > got && m.hearts <= h).map((m) => ({ hearts: m.hearts, unlock: m.unlock }));
  if (out.length) d.got[id] = out[out.length - 1].hearts;
  return out;
}

/** The day's first chat: points once a day. Returns points gained (0 if already chatted today). */
export function talkTo(d: FriendsData, id: string, nowMs: number): number {
  const day = dayKey(nowMs);
  if (!BY_ID.has(id) || d.talked[id] === day) return 0;
  d.talked[id] = day;
  addPoints(d, id, PTS.talk);
  return PTS.talk;
}

export type GiftResult = { ok: true; tier: Tier; gained: number; first: boolean } | { ok: false; reason: 'unknown' | 'gifted' };

/** Give one item (the caller takes it out of the basket). One gift per villager per day. */
export function giveGift(d: FriendsData, id: string, item: string, nowMs: number): GiftResult {
  const f = BY_ID.get(id);
  if (!f || !collectDef(item)) return { ok: false, reason: 'unknown' };
  const day = dayKey(nowMs);
  if (d.gifted[id] === day) return { ok: false, reason: 'gifted' };
  d.gifted[id] = day;
  const tier = tierOf(f, item);
  const first = !d.known[id]?.[item];
  (d.known[id] ??= {})[item] = tier;
  const gained = PTS[tier];
  addPoints(d, id, gained);
  d.total.gifts++;
  return { ok: true, tier, gained, first };
}

/** Today's requests (a new day brings a new set; yesterday's lapse). Returns true when it rolled over. */
export function ensureDay(d: FriendsData, nowMs: number, season: Season): boolean {
  const day = dayKey(nowMs);
  if (d.req.day === day) return false;
  d.req = { day, list: requestsFor(day, season) };
  return true;
}

/** A bit of progress toward open requests. Returns the requests that just became ready. */
export function progress(d: FriendsData, hit: (q: Request) => boolean): Request[] {
  const out: Request[] = [];
  for (const q of d.req.list) {
    if (q.state !== 'open' || q.kind === 'bring' || !hit(q)) continue;
    q.have = Math.min(q.n, q.have + 1);
    if (q.have >= q.n) { q.state = 'ready'; out.push(q); }
  }
  return out;
}
export const caughtHit = (id: string, hour: number) => (q: Request): boolean => q.kind === 'catch' && (q.item === 'any' || q.item === id) && inWindow(q.when, hour);
export const visitHit = (place: string, hour: number) => (q: Request): boolean => q.kind === 'visit' && q.place === place && inWindow(q.when, hour);
export const eventHit = (kind: ValleyEventKind) => (q: Request): boolean => q.kind === 'agent' && !!q.goal && GOAL[q.goal].event === kind;

/** The open request a villager has today, if any (done ones too, so they can say thanks again). */
export const requestOf = (d: FriendsData, id: string): Request | undefined => d.req.list.find((q) => q.who === id);

export type DeliverResult = { req: Request; coins: number; gained: number; take: { id: string; n: number } | null };
/** Hand a ready request over (bring: the caller takes `take` from the basket). Null when nothing is ready. */
export function deliver(d: FriendsData, id: string, basket: (id: string) => number): DeliverResult | null {
  const q = d.req.list.find((x) => x.who === id && x.state !== 'done');
  if (!q) return null;
  if (q.kind === 'bring' ? basket(q.item ?? '') < q.n : q.state !== 'ready') return null;
  q.state = 'done';
  q.have = q.n;
  addPoints(d, id, PTS.request);
  d.total.requests++;
  return { req: q, coins: q.reward, gained: PTS.request, take: q.kind === 'bring' ? { id: q.item ?? '', n: q.n } : null };
}

/** Set a villager's hearts outright (dev). */
export function setHearts(d: FriendsData, id: string, hearts: number): void {
  if (!BY_ID.has(id)) return;
  d.pts[id] = Math.max(0, Math.min(MAX_PTS, Math.round(hearts * HEART)));
}

// ---------------------------------------------------------------------------------------------
// Views

export interface FriendView {
  def: FriendDef;
  points: number;
  hearts: number;
  /** 0..1 toward the next heart (1 at the top) */
  toNext: number;
  talkedToday: boolean;
  giftedToday: boolean;
  known: Readonly<Record<string, Tier>>;
  request: RequestView | null;
  /** the next milestone to look forward to */
  next: { hearts: number; label: string } | null;
}

export function friendView(d: FriendsData, id: string, nowMs: number, basket: (id: string) => number): FriendView | null {
  const def = BY_ID.get(id);
  if (!def) return null;
  const day = dayKey(nowMs);
  const points = pointsOf(d, id), hearts = heartsOf(points);
  const q = d.req.day === day ? requestOf(d, id) : undefined;
  const nm = MILESTONES.find((m) => m.hearts > hearts);
  return {
    def, points, hearts, toNext: hearts >= MAX_HEARTS ? 1 : (points - hearts * HEART) / HEART,
    talkedToday: d.talked[id] === day, giftedToday: d.gifted[id] === day, known: d.known[id] ?? {},
    request: q ? requestView(q, basket) : null, next: nm ? { hearts: nm.hearts, label: nm.label } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The live service (main.ts creates one; the villagers system, the HUD and the dev API share it)

export interface FriendsStore { load(): unknown; save(d: FriendsData): void }

export type FriendsChange =
  | { kind: 'talk'; who: FriendId; gained: number }
  | { kind: 'gift'; who: FriendId; item: string; tier: Tier; gained: number; first: boolean }
  | { kind: 'heart'; who: FriendId; hearts: number; up: boolean }
  | { kind: 'milestone'; who: FriendId; hearts: number; unlock: Unlock; letter: FriendLetter | null; decor: string | null }
  | { kind: 'ready'; req: Request }
  | { kind: 'delivered'; req: Request; coins: number; gained: number }
  | { kind: 'day'; day: string }
  | { kind: 'dev' };

export interface FriendsPorts {
  now?: () => number;
  season?: () => Season;
  /** the player's basket: how many held, and take some out (returns how many were taken) */
  basket?: { count(id: string): number; take(id: string, n: number): number; stash?(id: string, n: number): void };
  /** pay bits (request rewards) */
  pay?: (coins: number, why: string) => void;
  /** a free decor piece for the yard (the 10-heart keepsake) */
  gift?: (decorId: string) => void;
}

export interface FriendsService {
  readonly version: number;
  data(): Readonly<FriendsData>;
  hearts(id: string): number;
  view(id: string): FriendView | null;
  all(): FriendView[];
  /** today's requests with progress */
  requests(): RequestView[];
  /** the day's first chat counts (+points once a day) */
  talk(id: string): number;
  give(id: string, item: string): GiftResult | { ok: false; reason: 'none' };
  /** hand over a ready request; null if nothing's ready */
  deliver(id: string): DeliverResult | null;
  /** mark a villager's request as told (they've asked you in person) */
  asked(id: string): void;
  /** progress hooks: a catch (fish id, local hour), the player at a place, an agent valley event */
  caught(id: string, hour: number): void;
  visited(place: string, hour: number): void;
  event(kind: ValleyEventKind): void;
  onChange(fn: (c: FriendsChange) => void): () => void;
  devHearts(id: string, hearts: number): void;
  /** dev: complete today's requests ('ready'), or roll a new set for `day` */
  devRequests(o?: { ready?: boolean; day?: string }): RequestView[];
  devReset(): void;
}

export function createFriends(st: FriendsStore | undefined, o: FriendsPorts = {}): FriendsService {
  const now = o.now ?? Date.now;
  const season = o.season ?? (() => 'spring' as Season);
  const count = (id: string) => { try { return o.basket?.count(id) ?? 0; } catch { return 0; } };
  let d: FriendsData;
  try { d = parseFriends(st?.load()) ?? emptyFriends(); } catch { d = emptyFriends(); }
  let version = 0;
  const fns = new Set<(c: FriendsChange) => void>();
  const save = () => { version++; try { st?.save(d); } catch (err) { console.warn('[friends] save failed', err); } };
  const emit = (c: FriendsChange) => { for (const f of [...fns]) { try { f(c); } catch (err) { console.error('[friends] listener threw', err); } } };
  /** today's set exists (emits 'day' when it rolled over) */
  const day = () => { if (ensureDay(d, now(), season())) { save(); emit({ kind: 'day', day: d.req.day }); } };
  /** after points changed: heart up / down, and any milestones they unlocked */
  const settle = (who: FriendId, before: number) => {
    const after = heartsIn(d, who);
    if (after !== before) emit({ kind: 'heart', who, hearts: after, up: after > before });
    for (const m of claimMilestones(d, who)) {
      let letter: FriendLetter | null = null, decor: string | null = null;
      if (m.unlock === 'letter' || m.unlock === 'recipe' || m.unlock === 'keepsake') {
        const l = milestoneLetter(who, m.unlock);
        // a second apart per milestone: the mailbox keys read state by sender + second
        letter = { id: `friend:${who}:${m.hearts}`, at: now() - (MAX_HEARTS - m.hearts) * 1000, from: who, title: l.title, body: l.body };
        if (!d.letters.some((x) => x.id === letter!.id)) d.letters.push(letter);
        if (d.letters.length > 40) d.letters.splice(0, d.letters.length - 40);
      }
      const def = BY_ID.get(who)!;
      if (m.unlock === 'decor') decor = def.decor;
      if (m.unlock === 'keepsake') { decor = def.keepsake; try { o.gift?.(def.keepsake); } catch (err) { console.warn('[friends] keepsake', err); } }
      emit({ kind: 'milestone', who, hearts: m.hearts, unlock: m.unlock, letter, decor });
    }
  };
  const ready = (qs: Request[]) => { if (!qs.length) return; save(); for (const q of qs) emit({ kind: 'ready', req: q }); };
  return {
    get version() { return version; },
    data: () => { day(); return d; },
    hearts: (id) => heartsIn(d, friendDef(id)?.id ?? id),
    view: (id) => { day(); return friendView(d, friendDef(id)?.id ?? id, now(), count); },
    all: () => { day(); return FRIENDS.map((f) => friendView(d, f.id, now(), count)!); },
    requests: () => { day(); return d.req.list.map((q) => requestView(q, count)); },
    talk(id) {
      const f = friendDef(id);
      if (!f) return 0;
      day();
      const before = heartsIn(d, f.id);
      const g = talkTo(d, f.id, now());
      if (!g) return 0;
      save();
      emit({ kind: 'talk', who: f.id, gained: g });
      settle(f.id, before);
      save();
      return g;
    },
    give(id, item) {
      const f = friendDef(id);
      if (!f) return { ok: false, reason: 'unknown' };
      if (count(item) < 1) return { ok: false, reason: 'none' };
      if (d.gifted[f.id] === dayKey(now())) return { ok: false, reason: 'gifted' };
      const took = o.basket?.take(item, 1) ?? 0;
      if (o.basket && took < 1) return { ok: false, reason: 'none' };
      const before = heartsIn(d, f.id);
      const r = giveGift(d, f.id, item, now());
      if (!r.ok) return r;
      save();
      emit({ kind: 'gift', who: f.id, item, tier: r.tier, gained: r.gained, first: r.first });
      settle(f.id, before);
      save();
      return r;
    },
    deliver(id) {
      const f = friendDef(id);
      if (!f) return null;
      day();
      const before = heartsIn(d, f.id);
      const r = deliver(d, f.id, count);
      if (!r) return null;
      if (r.take) o.basket?.take(r.take.id, r.take.n);
      try { o.pay?.(r.coins, `${f.short}'s request`); } catch (err) { console.warn('[friends] pay', err); }
      save();
      emit({ kind: 'delivered', req: r.req, coins: r.coins, gained: r.gained });
      settle(f.id, before);
      save();
      return r;
    },
    asked(id) {
      const q = requestOf(d, friendDef(id)?.id ?? id);
      if (q && !q.asked) { q.asked = true; save(); }
    },
    caught(id, hour) { day(); ready(progress(d, caughtHit(id, hour))); },
    visited(place, hour) { day(); ready(progress(d, visitHit(place, hour))); },
    event(kind) { day(); ready(progress(d, eventHit(kind))); },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devHearts(id, hearts) {
      const f = friendDef(id);
      if (!f) return;
      const before = heartsIn(d, f.id);
      setHearts(d, f.id, hearts);
      save();
      settle(f.id, before);
      save();
    },
    devRequests(x = {}) {
      // another date's set, posted as today's (so it doesn't lapse straight away)
      if (x.day) { d.req = { day: dayKey(now()), list: requestsFor(x.day, season()) }; save(); emit({ kind: 'day', day: x.day }); }
      day();
      if (x.ready) {
        for (const q of d.req.list) {
          if (q.state !== 'open') continue;
          if (q.kind === 'bring') { if (q.item && count(q.item) < q.n) o.basket?.stash?.(q.item, q.n - count(q.item)); }
          else { q.have = q.n; q.state = 'ready'; emit({ kind: 'ready', req: q }); }
        }
        save();
      }
      emit({ kind: 'dev' });
      return d.req.list.map((q) => requestView(q, count));
    },
    devReset() { d = emptyFriends(); save(); emit({ kind: 'dev' }); },
  };
}
