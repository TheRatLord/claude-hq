// @pure
/**
 * A farmer's appearance, derived deterministically from its seed + kind + model tier (no three): every window dresses
 * the same farmer the same way. The mascot itself is fixed by kind (Clawd for Claude, a blue-violet starred Clawd for
 * Gemini, a grey Clawd for other agents, the Codex cloud for Codex); only the tiny farm dressing and the personality
 * vary. Colours are 0xRRGGBB numbers; the rig turns them into instance palettes.
 */
import { hash32, mulberry32 } from '../../../../../shared/identity.ts';
import type { FarmerView } from '../../model/types.ts';
import { KIND_COLORS } from './mascots.ts';
import type { HatName } from './mascots.ts';
import type { Body } from './pose.ts';

export type Hat = HatName;

export interface Look {
  kind: FarmerView['kind'];
  body: Body;
  /** main body colour, and the darker one (Codex feet) */
  color: number;
  dark: number;
  /** eye / face glyph colour */
  glyph: number;
  /** Gemini's sparkle on the body */
  star: boolean;
  /** neckerchief: the workspace colour */
  scarf: number;
  hat: Hat;
  hatColor: number;
  hatBand: number;
  /** personality: gait tempo, bounce height, fidget rate, how chatty, blink habits */
  tempo: number;
  bounce: number;
  fidget: number;
  chatty: number;
  /** mean seconds between blinks, and the chance a blink is a double blink */
  blinkEvery: number;
  doubleBlink: number;
  /** 0.95..1.05 overall scale, so a crowd is not identical */
  scale: number;
  /** favourite leisure kinds, most preferred first */
  likes: readonly ('fire' | 'fish' | 'bench' | 'well' | 'board' | 'porch' | 'meadow')[];
}

/** Hat by model tier: opus = straw hat, sonnet = flat cap, haiku = bandana, anything else = beanie. */
export const hatFor = (tier: FarmerView['tier']): Hat => (tier === 'opus' ? 'straw' : tier === 'sonnet' ? 'cap' : tier === 'haiku' ? 'bandana' : 'beanie');

const LIKES = ['fire', 'fish', 'well', 'board', 'porch', 'meadow'] as const;

export function lookFor(f: Pick<FarmerView, 'seed' | 'tier' | 'kind'>, scarf: number): Look {
  const r = mulberry32(hash32(`look:${f.seed}`));
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
  const kc = KIND_COLORS[f.kind] ?? KIND_COLORS.agent;
  const hat = hatFor(f.tier);
  const hatColor = hat === 'straw' ? 0xecca6e : hat === 'cap' ? pick([0x5a6b4a, 0x6e5a48, 0x4a5a78, 0x8a4a3a]) : hat === 'bandana' ? pick([0xd9453b, 0x3f78c8, 0x5cae4f]) : pick([0xd9534f, 0x5b8fd6, 0x7fb069, 0xf0a04b, 0x9a6ad0]);
  const hatBand = hat === 'straw' ? scarf : hat === 'beanie' ? 0xf6f1e6 : 0xf4efe3;
  const likes = [...LIKES];
  for (let i = likes.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [likes[i], likes[j]] = [likes[j], likes[i]]; }
  return {
    kind: f.kind, body: f.kind === 'codex' ? 'codex' : 'clawd', color: kc.body, dark: kc.dark, glyph: kc.glyph, star: f.kind === 'gemini',
    scarf, hat, hatColor, hatBand,
    tempo: 1.75 + r() * 0.45, bounce: 0.8 + r() * 0.45, fidget: 0.6 + r() * 0.8, chatty: r(),
    blinkEvery: 2.6 + r() * 2.4, doubleBlink: 0.1 + r() * 0.25,
    scale: 0.95 + r() * 0.1, likes,
  };
}
