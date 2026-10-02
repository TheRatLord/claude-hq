// @pure
/**
 * The visitors' looks and voices (model/visitors.ts has who comes when). They are Clawds like the villagers (the
 * mascot is sacred): a body colour no agent kind uses, a role hat and one piece of wear from the shared villager
 * dressing (scene/farmers/mascots.ts), so they read as townsfolk, but strangers: Barnaby in a wide-brimmed hat and a
 * travelling cloak, Odile in a red beret and a paint-spattered smock, Ned in a red post cap with a parcel satchel.
 */
import type { Look } from '../farmers/look.ts';
import type { RoleHatName, WearName } from '../farmers/mascots.ts';
import type { VisitorId } from '../../model/visitors.ts';

export interface VisitorLook {
  color: number; dark: number; scarf: number;
  hat: RoleHatName; hatColor: number; hatBand: number;
  wear: WearName; wearColor: number; wearTrim: number;
  tempo: number; bounce: number;
  /** the map pin's colour (css) and glyph */
  pin: string; glyph: string;
}

export const LOOKS: Readonly<Record<VisitorId, VisitorLook>> = {
  merchant: {
    color: 0x6a7a9a, dark: 0x4f5c78, scarf: 0xf2c33a, hat: 'ranger', hatColor: 0x3a2e3a, hatBand: 0xc9962a,
    wear: 'cape', wearColor: 0x6a3a6e, wearTrim: 0xc9962a, tempo: 1.8, bounce: 0.85, pin: '#6a3a6e', glyph: '⚖',
  },
  painter: {
    color: 0xd88aa0, dark: 0xb86a82, scarf: 0x3f78c8, hat: 'millcap', hatColor: 0xc8303a, hatBand: 0x8a2028,
    wear: 'smock', wearColor: 0xf4ecdc, wearTrim: 0x3f78c8, tempo: 2.0, bounce: 1.05, pin: '#c8303a', glyph: '✎',
  },
  postie: {
    color: 0xa8a0c8, dark: 0x8680a8, scarf: 0xd9453b, hat: 'postcap', hatColor: 0xc0392b, hatBand: 0x7a1f18,
    wear: 'satchel', wearColor: 0x7a5232, wearTrim: 0x4a3220, tempo: 2.15, bounce: 1.1, pin: '#c0392b', glyph: '✉',
  },
};

export function visitorLook(id: VisitorId): Look {
  const v = LOOKS[id];
  return {
    kind: 'claude', body: 'clawd', color: v.color, dark: v.dark, glyph: 0x1c1614, star: false, scarf: v.scarf,
    hat: 'cap', hatColor: v.hatColor, hatBand: v.hatBand, tempo: v.tempo, bounce: v.bounce, fidget: 1, chatty: 0.7,
    blinkEvery: 3.4, doubleBlink: 0.25, scale: id === 'merchant' ? 1.04 : 0.98, likes: [], restless: 0,
    roleHat: v.hat, wear: v.wear, wearColor: v.wearColor, wearTrim: v.wearTrim,
  };
}

/** Barnaby: theatrical, fond of a provenance, scrupulously no-haggle. */
export const MERCHANT_LINES: readonly string[] = [
  'Barnaby Pell, purveyor of curiosities! Every item has a story, and every price is fair. No haggling: I\'m too old and the prices too honest.',
  'Over the pass since dawn. The cart squeaks, the knees creak, but the wares are splendid.',
  'That sundial once told the time for a duke. The duke was always late anyway.',
  'Rare things, rarer than rare. Don\'t tell the General store; they get jealous.',
  'Your farmers work hard, I see. I always say: an honest field deserves an honest lantern.',
  'I come Wednesdays and Saturdays, and whenever there\'s a festival. A merchant follows the bunting.',
  'One of each per visit, friend. If I sold you two moonflowers, what would I tell the moon?',
];
export const MERCHANT_RAIN = 'Rain? Pah. The hood\'s waxed canvas, and so am I, more or less. Browse away!';
export const MERCHANT_NIGHT = 'Packing up soon, friend. The pass is no place for a cart after dark.';
export const MERCHANT_BYE = 'Off over the pass! Back on my day. Mind the lantern, it\'s the good one.';

/** Odile: dreamy, precise about light. */
export const PAINTER_LINES: readonly string[] = [
  'Shh, the light is doing something wonderful on the water. Oh. It stopped. Hello!',
  'I paint one place, one day, then move on. The valley never sits still long enough for a second sitting.',
  'Your fields make such tidy stripes from up here. Very good for perspective.',
  'When it\'s finished, you may have it, if you like. For the farmhouse wall. Every wall deserves a window.',
  'Rain ruins a wet canvas, so I only come on fair days. The sky and I have an understanding.',
];
export const PAINTER_DONE = 'There! Finished. Dry enough to carry, if you\'d like it for the farmhouse.';
export const PAINTER_SOLD = 'It\'s yours: Barnaby helped me hang it over the fish tank. Well, he watched.';

/** Ned: brisk, cheerful, always slightly late for the train. */
export const POSTIE_LINES: readonly string[] = [
  'Parcel post, off the morning train! It\'s in your mailbox, can\'t stop, the train won\'t wait. Well, it does. But it sighs.',
  'Ned Hobbs, parcel post! Since the halt reopened I\'ve had the best round on the line.',
  'Lovely valley. Steep, mind. My satchel weighs more going downhill, I swear.',
];
