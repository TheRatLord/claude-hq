// @pure
/**
 * Prop-kit colour tokens (§7.5 3-colour rule, §5.5 value map). Every kit colour comes from `shared/palette.ts`; the
 * few material tokens the palette lacks (brass, kraft, cork, steel oat, stone, linen, fabric teal, dark oak) are
 * derived here from palette tokens and documented with their L*. Proposed for `palette.ts` (LEAD) in the ENV M1.75
 * summary. Owner: ENV.
 */
import { CORE, ENV, MISC, STATUS, WORKSPACE } from '../../../../../shared/palette.ts';

/** Widen the palette's literal colour types to `string` (tokens are compared / assigned as plain colours). */
const widen = <O extends Record<string, unknown>>(o: O): { [K in keyof O]: O[K] extends string ? string : O[K] } => o as { [K in keyof O]: O[K] extends string ? string : O[K] };

export const T = Object.freeze(widen({
  // woods
  oak: ENV.oak, // L* 66: desks, shelves
  oakDark: '#A57C52', // L* 56: stair treads, trims
  walnut: ENV.walnut, // L* 40: counters, shelves, feet
  walnutDark: '#5E3E2B', // L* 30: shelf backs, crown shadows
  // metals / inks
  ink: CORE.ink,
  ink2: '#56514B', // L* 35 iron: legs, frames, bases (CORE.ink2 lifted one step so metalwork never drops under the p10 luma floor)
  brass: '#B8904F', // L* 62: knobs, toe caps, foot rails, telescope (accent ≤ 15%)
  steel: '#8C8A84', // L* 57: radiator, filing steel shade
  steelOat: '#B9B2A5', // L* 73: filing cabinets, cooler bodies
  // papers / fabrics
  trim: MISC.trim, // cream trim, piping, page blocks
  linen: '#E9DCC0', // lamp shades (day), throws
  kraft: '#B89770', // cardboard
  cork: '#B08A62',
  whiteboard: MISC.whiteboard,
  sage: ENV.sage,
  sofa: MISC.pitSofa, // L* 61 sage fabric (Pit sofas, §5.5)
  sofaDeep: '#5F7C6A', // sofa plinth / shadowed fabric
  fabricTeal: '#4E7C78', // L* 48 chair fabric
  fabricTealDeep: ENV.tealDeep,
  moss: ENV.moss,
  teal: ENV.teal,
  tealDeep: ENV.tealDeep,
  butter: ENV.butter,
  rose: ENV.rose,
  lavender: ENV.lavender,
  oat: CORE.oat,
  sand: CORE.sand,
  // foliage
  leafDark: '#4E6B4B',
  leaf: ENV.moss,
  leafLight: ENV.sage,
  // stone / fire (hearth)
  stone: '#A79E92', // L* 65 hearth stones (low chroma)
  stoneDark: '#6E665E',
  ember: '#E0843C', // emissive flame core (lamp colour, never a status colour)
  flame: '#F4B85A',
  // glass-ish solids
  bottle: '#8FB9C9',
  screenOff: '#2A2D33',
  status: STATUS,
}));
/** Book spine tokens (secondary group of a shelf): muted jewels + papers, never clay. */
export const SPINES: readonly string[] = Object.freeze([WORKSPACE[2].hex, ENV.butter, MISC.trim, ENV.teal, WORKSPACE[5].hex, ENV.sage, '#8A6A4C', WORKSPACE[3].hex, WORKSPACE[1].hex, ENV.lavender]);
/** Sticky-note / marker tokens. */
export const NOTES: readonly string[] = Object.freeze([ENV.butter, ENV.rose, ENV.sage, ENV.lavender]);
/** Flower tokens (plants' accent). */
export const FLOWERS: readonly string[] = Object.freeze([ENV.rose, ENV.butter, ENV.lavender, MISC.trim]);
