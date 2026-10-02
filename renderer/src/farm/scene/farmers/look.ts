// @pure
/**
 * A farmer's appearance, derived deterministically from its seed + kind / vendor + model tier (no three): every window
 * dresses the same farmer the same way. The mascot itself is fixed by the agent CLI (`mascotOf` in model/mascots.ts:
 * Clawd for Claude, the Codex cloud, the Gemini sparkle, the Aider parrot, the goose, …, the sprout-bot for any other
 * agent); only the tiny farm dressing and the personality vary. Colours are 0xRRGGBB numbers; the rig turns them into
 * instance palettes.
 */
import { hash32, mulberry32 } from '../../../../../shared/identity.ts';
import type { FarmerView } from '../../model/types.ts';
import { KIND_COLORS } from './mascots.ts';
import { ART, mascotOf } from '../../model/mascots.ts';
import type { HatName, RoleHatName, WearName } from './mascots.ts';
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
  /** a sparkle on Clawd's body (unused by agents since every vendor has its own mascot; kept for villagers / old looks) */
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
  likes: readonly LikeKind[];
  /** 0..1 how often an idle outing (a stroll, a pet, a visit) wins over sitting on */
  restless: number;
  /** villagers only (scene/villagers): a role hat drawn instead of the tier hat, and one piece of wear on the body */
  roleHat?: RoleHatName;
  wear?: WearName;
  /** wear colour and its trim (0xRRGGBB) */
  wearColor?: number;
  wearTrim?: number;
}

/** Hat by model tier: opus = straw hat, sonnet = flat cap, haiku = bandana, anything else = beanie. */
export const hatFor = (tier: FarmerView['tier']): Hat => (tier === 'opus' ? 'straw' : tier === 'sonnet' ? 'cap' : tier === 'haiku' ? 'bandana' : 'beanie');

const LIKES = ['fire', 'fish', 'well', 'board', 'porch', 'meadow'] as const;
/** the leisure nooks, mixed into each farmer's likes with a separate stream (the first draws keep every look stable) */
const NOOK_LIKES = ['checkers', 'blanket', 'lookout', 'soak'] as const;
export type LikeKind = (typeof LIKES)[number] | (typeof NOOK_LIKES)[number] | 'bench';

/** Body colours of a mascot: Clawd / Codex from KIND_COLORS, the art mascots from their art. */
export function bodyColors(body: Body): { body: number; dark: number; glyph: number } {
  return body === 'clawd' ? KIND_COLORS.claude : body === 'codex' ? KIND_COLORS.codex : ART[body].colors;
}

export function lookFor(f: Pick<FarmerView, 'seed' | 'tier' | 'kind'> & { vendor?: string | null }, scarf: number): Look {
  const r = mulberry32(hash32(`look:${f.seed}`));
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
  const body = mascotOf(f.kind, f.vendor);
  const kc = bodyColors(body);
  const hat = hatFor(f.tier);
  const hatColor = hat === 'straw' ? 0xecca6e : hat === 'cap' ? pick([0x5a6b4a, 0x6e5a48, 0x4a5a78, 0x8a4a3a]) : hat === 'bandana' ? pick([0xd9453b, 0x3f78c8, 0x5cae4f]) : pick([0xd9534f, 0x5b8fd6, 0x7fb069, 0xf0a04b, 0x9a6ad0]);
  const hatBand = hat === 'straw' ? scarf : hat === 'beanie' ? 0xf6f1e6 : 0xf4efe3;
  const likes: LikeKind[] = [...LIKES];
  for (let i = likes.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [likes[i], likes[j]] = [likes[j], likes[i]]; }
  const r2 = mulberry32(hash32(`likes:${f.seed}`));
  for (const n of NOOK_LIKES) likes.splice(Math.floor(r2() * (likes.length + 1)), 0, n);
  const restless = r2();
  return {
    kind: f.kind, body, color: kc.body, dark: kc.dark, glyph: kc.glyph, star: false,
    scarf, hat, hatColor, hatBand,
    tempo: 1.75 + r() * 0.45, bounce: 0.8 + r() * 0.45, fidget: 0.6 + r() * 0.8, chatty: r(),
    blinkEvery: 2.6 + r() * 2.4, doubleBlink: 0.1 + r() * 0.25,
    scale: 0.95 + r() * 0.1, likes, restless,
  };
}
