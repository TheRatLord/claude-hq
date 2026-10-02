// @pure
/**
 * The valley's little economy, the catalogue half: what Bram pays for the player's finds (forage, fish, junk) and what
 * the General store sells for the player's yard (decor and cosmetics), with prices that scale with how many you
 * already own and stock gated by the Almanac rank or the season.
 *
 * The coin is the **bit** (a little copper coin stamped with a sprout): you earn bits by selling what you find and,
 * a few a day, from your agents' real work (model/wallet.ts). Pure: no DOM, no three.
 */
import type { Season } from './types.ts';
import { collectDef } from './collection.ts';

export const COIN = Object.freeze({ one: 'bit', many: 'bits' });
export const coins = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? COIN.one : COIN.many}`;

// ---------------------------------------------------------------------------------------------
// What Bram pays

/** Sell price of one collectible (forage by rarity, fish by size and rarity, junk is junk — mostly). 0 = unknown id. */
export function sellPrice(id: string): number {
  const d = collectDef(id);
  if (!d) return 0;
  if (d.kind === 'forage') return d.rare ? 45 : Math.round(24 / Math.max(1, d.weight));
  if (d.junk) return d.rare ? 40 : 2;
  const base = Math.round((d.cm[0] + d.cm[1]) / 6 + 4);
  return d.rare ? Math.round(base * 2.5) : base;
}

// ---------------------------------------------------------------------------------------------
// What the General store sells

export interface DecorDef {
  id: string;
  name: string;
  /** flavour in the valley's voice (the shop's detail line) */
  blurb: string;
  /** price of the first one; each extra copy costs more (`priceOf`) */
  price: number;
  /** how many one yard can hold */
  max: number;
  /** stocked from this Almanac rank (index into RANKS) */
  rank?: number;
  /** only stocked in these seasons (owned pieces stay all year) */
  seasons?: readonly Season[];
  /** lights up after dark (a real local light) */
  glow?: boolean;
  /** restyles you can cycle through (hat, colours); the first is the default */
  styles?: readonly string[];
  /** css colour for the HUD icon swatch */
  color: string;
  /** a villager's own piece: stocked once you're this good friends (model/friends.ts) */
  friend?: { id: string; hearts: number };
  /** a gift (a 10-heart keepsake): never on the shelves */
  keepsake?: boolean;
  /** a one-off present (the first-run welcome, model/onboarding.ts): never on the shelves, never sold */
  gift?: boolean;
  /** sold only by the travelling merchant (model/visitors.ts): never on the General store's shelves */
  visitor?: boolean;
}

const D = (id: string, name: string, price: number, max: number, color: string, blurb: string, o: Partial<DecorDef> = {}): DecorDef =>
  Object.freeze({ id, name, price, max, color, blurb, ...o });

/** The catalogue, in shop order (cheap and cheerful first). Ids are stable (they are the save keys). */
export const DECOR: readonly DecorDef[] = Object.freeze([
  D('planter', 'Flower planter', 40, 6, '#e0704a', 'A half barrel of whatever is blooming this season. Hazel swears by eggshells.',
    { styles: ['Warm mix', 'Cool mix', 'Sunflowers'] }),
  D('flamingo', 'Pink flamingo', 35, 4, '#f08aa8', 'Plastic, proud and absolutely nothing to do with the valley. Fern pretends not to see it.'),
  D('gnome', 'Garden gnome', 60, 3, '#d9453b', 'Keeps an eye on the yard while you check on the agents. Reports to nobody.',
    { styles: ['Red hat', 'Blue hat', 'Green hat'] }),
  D('birdhouse', 'Birdhouse', 70, 2, '#5a8fd6', 'A blue tit moved in the day it went up. Rent is one song a morning.'),
  D('chime', 'Wind chime', 80, 2, '#9aa4ad', 'Five copper tubes that tell you which way the wind is going, gently.'),
  D('petbed', "Biscuit's bed", 90, 1, '#c95f4a', 'A plump tartan cushion with a chew bone. Biscuit approves (Biscuit approves of everything).'),
  D('bench', 'Garden bench', 110, 2, '#cf9c63', 'Somewhere to sit and watch the commits roll in.'),
  D('birdbath', 'Bird bath', 120, 1, '#b7b0a3', 'Stone basin, fresh water, a queue of sparrows by eight in the morning.'),
  D('scarecrow', 'Yard scarecrow', 130, 2, '#e3c86a', 'Not for crows: for style. Change the hat whenever the mood takes you.',
    { styles: ['Straw hat', 'Top hat', 'Witch hat'] }),
  D('pumpkin', "Jack-o'-lantern", 45, 4, '#e8812f', 'Carved by Bram, who will not say how many he spoiled first. Lit at dusk.',
    { seasons: ['autumn'], glow: true }),
  D('snowman', 'Snowman', 50, 3, '#f4f6fa', 'Coal eyes, a carrot nose and a scarf Posy knitted. Lasts till spring, somehow.',
    { seasons: ['winter'] }),
  D('sapling', 'Blossom sapling', 75, 2, '#f6b8cc', 'A little cherry in a tub. It blossoms whatever the calendar says.',
    { seasons: ['spring'] }),
  D('parasol', 'Parasol & deckchair', 95, 2, '#4fb3c8', 'Stripes, shade and a cold drink. Summer, sorted.',
    { seasons: ['summer'] }),
  D('lamppost', 'Lamp post', 150, 4, '#ffc566', 'A proper iron lamp post, lit at dusk. Moths not included.',
    { rank: 2, glow: true }),
  D('lights', 'Fairy-light arch', 220, 2, '#ffd27a', 'A wooden arch strung with warm bulbs. The yard\'s best feature after dark.',
    { rank: 3, glow: true }),
  D('topiary', 'Clawd topiary', 300, 2, '#5fa64a', 'A box hedge clipped into the shape of a certain orange crab. Green, though.',
    { rank: 4 }),
  D('goldgnome', 'Golden gnome', 900, 1, '#f2c33a', 'For the valley that has everything. Polished every Sunday.',
    { rank: 7 }),
  // the villagers' own pieces, stocked once you are good friends (6 hearts, model/friends.ts)
  D('postbox', 'Posy\'s pillar box', 140, 1, '#d9453b', 'A little red post box of your own. Posy empties it on her rounds, and leaves a violet when there\'s nothing in it.',
    { friend: { id: 'villager:posy', hearts: 6 } }),
  D('crates', 'Bram\'s crate stack', 120, 2, '#c8955a', 'Three shipping crates, stencilled and stacked just so. Bram checked the corners with a set square.',
    { friend: { id: 'villager:bram', hearts: 6 } }),
  D('millstone', 'Millstone table', 160, 1, '#b7b0a3', 'An old millstone from the windmill, retired onto a stump. Hazel says it ground flour for forty years and deserves a sit down.',
    { friend: { id: 'villager:hazel', hearts: 6 } }),
  D('prizepumpkin', 'Prize pumpkin', 180, 1, '#e8812f', 'A giant pumpkin wearing the Mayor\'s own first-prize rosette. Do not carve. The Mayor will know.',
    { friend: { id: 'villager:marigold', hearts: 6 } }),
  D('tent', 'Ranger\'s pup tent', 150, 1, '#8a7a48', 'Fern\'s spare canvas tent, pitched for stargazing in your own back yard. The bedroll is still warm, somehow.',
    { friend: { id: 'villager:fern', hearts: 6 } }),
  D('vane', 'Weather vane', 170, 1, '#f2c230', 'A brass cockerel on a pole that always points where the wind is going. Nimbus calibrated it personally.',
    { friend: { id: 'villager:nimbus', hearts: 6 } }),
  // 10-heart keepsakes: a portrait on an easel, given (never sold)
  ...([['posy', 'Posy', '#3d9fa8'], ['bram', 'Bram', '#e6c547'], ['hazel', 'Hazel', '#d9c08a'], ['marigold', 'Mayor Marigold', '#9b5a8c'], ['fern', 'Fern', '#5d8f45'], ['nimbus', 'Nimbus', '#6fb7e0']] as const)
    .map(([id, name, color]) => D(`keep-${id}`, `Portrait of ${name}`, 500, 1, color, `A keepsake from ${name}, painted on a little easel: a best friend's face to keep your yard company.`,
      { keepsake: true, friend: { id: `villager:${id}`, hearts: 10 } })),
  // the first-run welcome's present (model/onboarding.ts WELCOME_DECOR)
  D('welcome', 'Welcome sign', 60, 1, '#3d9fa8', 'Posy\'s hand-painted welcome: a little teal envelope on a post, with a box of flowers. Every new farm gets one; nobody can buy one.',
    { gift: true }),
  // the stamp book's trophies (model/stamps.ts TROPHIES: 10 stamps, 25, every one), given into the yard
  D('trophy-bronze', 'Bronze stamp cup', 120, 1, '#c07a3a', 'A little bronze cup for ten stamps in the book. Bram polished it with his sleeve before handing it over.',
    { gift: true }),
  D('trophy-silver', 'Silver stamp cup', 240, 1, '#c8d0d8', 'A silver cup for twenty-five stamps, engraved by Hazel with a very steady hand.',
    { gift: true }),
  D('trophy-gold', 'Golden stamp cup', 600, 1, '#f2c33a', 'The golden cup, for a stamp book with every page inked. The Mayor made a speech. It was long.',
    { gift: true }),
  // the hidden chest in the grotto behind the waterfall (scene/grotto): one per valley, for whoever is curious enough
  D('geode', 'Grotto geode lamp', 400, 1, '#9a7cf0', 'A split geode on a stump of driftwood, its crystals still glowing faintly. Left in a chest behind the falls by an explorer who signed their journal "R."',
    { gift: true, glow: true }),
  // rare pieces from Barnaby Pell's travelling cart (model/visitors.ts STOCK): never on the General store's shelves
  D('starlamp', 'Star-glass lantern', 240, 1, '#6a8ad8', 'A brass lantern glazed in coloured glass, from a lighthouse keeper who retired inland. Lit at dusk.',
    { visitor: true, glow: true }),
  D('sundial', 'Brass sundial', 210, 1, '#5f9a7a', 'A green-bronze sundial on a stone column. Accurate to the nearest pleasant afternoon.',
    { visitor: true }),
  D('moonflower', 'Moonflowers', 170, 2, '#e8ecff', 'A stone pot of white moonflowers grown from the travelling merchant\'s seeds. They open at dusk and glow all night.',
    { visitor: true, glow: true }),
  D('whirligig', 'Whirligig', 150, 1, '#e0574a', 'A painted wind toy on a pole: a little farmer pumping a well, faster the harder it blows.',
    { visitor: true }),
] as DecorDef[]);

const BY_ID = new Map(DECOR.map((d) => [d.id, d]));
export const decorDef = (id: string): DecorDef | undefined => BY_ID.get(id);

/** Price of the next copy when you already own `owned` of them: +35% per copy, rounded to a friendly 5. */
export function priceOf(d: DecorDef, owned: number): number {
  const p = d.price * (1 + 0.35 * Math.max(0, owned));
  return Math.max(5, Math.round(p / 5) * 5);
}

export type Locked = 'rank' | 'season' | 'max' | 'friend' | 'keepsake' | null;

/** Why a decor item can't be bought right now (null = in stock). `hearts` = a villager's hearts (model/friends.ts). */
export function lockOf(d: DecorDef, o: { rank: number; season: Season; owned: number; hearts?: (id: string) => number }): Locked {
  if (o.owned >= d.max) return 'max';
  if (d.keepsake || d.gift || d.visitor) return 'keepsake';
  if (d.friend && (o.hearts?.(d.friend.id) ?? 0) < d.friend.hearts) return 'friend';
  if (d.rank !== undefined && o.rank < d.rank) return 'rank';
  if (d.seasons && !d.seasons.includes(o.season)) return 'season';
  return null;
}
