/**
 * Captions for the world's meaningful sounds (Settings → Accessibility → captions; the HUD draws them, hud/hud.ts):
 * the valley-event cues are captioned by the HUD itself (model/prefs.ts `captionFor`); these are the sounds other
 * systems play in the world that carry news you would otherwise only hear: the train, the merchant's cart, a fish
 * biting, fireworks, thunder. Pure: audio.ts asks `soundCaption` when it plays one and hands the line to its listeners.
 */

export interface SoundCaption { sound: string; text: string; /** seconds before the same caption may show again */ gap: number }

export const SOUND_CAPTIONS: Readonly<Record<string, SoundCaption>> = Object.freeze({
  train: { sound: 'Train whistle', text: 'far down the line', gap: 8 },
  cart: { sound: 'Cart wheels, harness bells', text: 'the merchant\'s cart on the road', gap: 90 },
  bite: { sound: 'Splash', text: 'a fish is biting!', gap: 2 },
  firework: { sound: 'Fireworks', text: 'over the square', gap: 30 },
  thunder: { sound: 'Thunder', text: 'a storm overhead', gap: 30 },
});

/** Below this (the sound's gain after distance) a sound is too faint to caption. */
export const CAPTION_MIN_GAIN = 0.05;

/**
 * The caption for `name` played at `gain` (after distance; 1 = not positional) at time `now` (s), or null: not a
 * captioned sound, too faint, or shown less than its gap ago. `last` remembers when each was shown (mutated).
 */
export function soundCaption(name: string, gain: number, now: number, last: Map<string, number>): SoundCaption | null {
  const c = SOUND_CAPTIONS[name];
  if (!c || !(gain >= CAPTION_MIN_GAIN)) return null;
  const at = last.get(name);
  if (at !== undefined && now - at < c.gap) return null;
  last.set(name, now);
  return c;
}
