// @pure
/**
 * A farmer's appearance, derived deterministically from its seed + model (no three): every window dresses the same
 * farmer the same way. Colours are 0xRRGGBB numbers; the rig turns them into instance palettes.
 */
import { hash32, mulberry32 } from '../../../../../shared/identity.ts';
import type { FarmerView } from '../../model/types.ts';

export const HAIR_STYLES = ['tuft', 'bob', 'spiky', 'bun'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
/** Headwear by model: opus = straw hat, sonnet = flat cap, haiku = bandana, other = beanie; codex = goggles, gemini = star beret. */
export const HATS = ['straw', 'cap', 'bandana', 'beanie', 'goggles', 'beret'] as const;
export type Hat = (typeof HATS)[number];

export interface Look {
  skin: number;
  /** slightly deeper skin for hands / ears, and the cheek blush */
  blush: number;
  hair: number;
  hairStyle: HairStyle;
  shirt: number;
  overalls: number;
  boots: number;
  /** scarf / bandana: the workspace colour */
  scarf: number;
  hat: Hat;
  hatColor: number;
  hatBand: number;
  /** personality: gait tempo (Hz of steps at walk), bounce height, fidget rate, how chatty */
  tempo: number;
  bounce: number;
  fidget: number;
  chatty: number;
  /** 0.94..1.06 overall scale, so a crowd is not identical */
  scale: number;
  /** favourite leisure kinds, most preferred first */
  likes: readonly ('fire' | 'fish' | 'bench' | 'well' | 'board' | 'porch' | 'meadow')[];
}

export const SKINS = [0xf6d2b4, 0xf2c6a0, 0xe7b48a, 0xd9a27a, 0xc08a5e, 0xa46f4a, 0x8a5a3c, 0x6e4630] as const;
export const HAIRS = [0x2b2420, 0x4a2f22, 0x6e4228, 0x9a5a2e, 0xc98a3e, 0xe6c46a, 0xb8412e, 0x8a8a8a, 0xf0ece0, 0x3a3f5a] as const;
export const SHIRTS = [0xf4efe3, 0xe07a5f, 0x81b29a, 0xf2cc8f, 0x9ec5e8, 0xf4a6c1, 0xc9b6e4, 0xe9d8a6, 0xa8d5a2, 0xf6bd60] as const;
export const OVERALLS = [0x3f6fb5, 0x4a7fc0, 0x6b8e4e, 0x8a5a3a, 0xb8483a, 0x5f6b7a, 0x7a5aa0, 0xc07a3a] as const;

const LIKES = ['fire', 'fish', 'well', 'board', 'porch', 'meadow'] as const;

export function lookFor(f: Pick<FarmerView, 'seed' | 'tier' | 'kind'>, scarf: number): Look {
  const r = mulberry32(hash32(`look:${f.seed}`));
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
  const skin = pick(SKINS);
  const hair = pick(HAIRS);
  const hairStyle = pick(HAIR_STYLES);
  let shirt: number = pick(SHIRTS);
  let overalls: number = pick(OVERALLS);
  let hat: Hat = f.tier === 'opus' ? 'straw' : f.tier === 'sonnet' ? 'cap' : f.tier === 'haiku' ? 'bandana' : 'beanie';
  let hatColor = hat === 'straw' ? 0xe8c872 : hat === 'cap' ? pick([0x5a6b4a, 0x6e5a48, 0x4a5a78, 0x8a4a3a]) : hat === 'bandana' ? scarf : pick([0xd9534f, 0x5b8fd6, 0x7fb069, 0xf0a04b]);
  let hatBand = hat === 'straw' ? scarf : 0xf4efe3;
  if (f.kind === 'codex') { overalls = 0x2f9c95; shirt = pick([0xf4efe3, 0xe9d8a6, 0xf2cc8f]); hat = 'goggles'; hatColor = 0x3a3a44; hatBand = 0x8fe3ff; }
  else if (f.kind === 'gemini') { overalls = 0x4b4fa8; shirt = pick([0xc9b6e4, 0x9ec5e8, 0xf4efe3]); hat = 'beret'; hatColor = 0x5a5fd0; hatBand = 0xffd86a; }
  // never let shirt and overalls match closely
  if (shirt === overalls) shirt = 0xf4efe3;
  const likes = [...LIKES];
  for (let i = likes.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [likes[i], likes[j]] = [likes[j], likes[i]]; }
  return {
    skin, blush: 0xf08a8a, hair, hairStyle, shirt, overalls, boots: pick([0x5a3a26, 0x4a3a30, 0x6e4a2a]), scarf, hat, hatColor, hatBand,
    tempo: 1.7 + r() * 0.5, bounce: 0.7 + r() * 0.6, fidget: 0.6 + r() * 0.8, chatty: r(), scale: 0.94 + r() * 0.12, likes,
  };
}
