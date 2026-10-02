import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SFX } from '../scene/context.ts';
import { SFX_RECIPES, busOf, sendOf } from './sfx.ts';
import { LOOP_KINDS } from './loops.ts';
import { BED_SCALE } from './ambience.ts';
import { BIRD_SEASON, ambientLevels } from './mix.ts';
import type { AmbientIn } from './mix.ts';
import { musicScene } from './musicPlan.ts';
import { CAPTION_MIN_GAIN, SOUND_CAPTIONS, soundCaption } from './captions.ts';

const base = (o: Partial<AmbientIn> = {}): AmbientIn => ({
  hour: 12, daylight: 1, season: 'summer', weather: 'clear', intensity: 0, wind: 3, cpu: 0.4, altitude: 0,
  dRiver: 300, dPond: 300, dWaterfall: 300, dFire: 300, dWindmill: 300, dBees: Infinity, dHerd: Infinity, dHub: 40, ...o,
});

test('every sound name has a recipe, a bus and a send; the new ones are routed where they belong', () => {
  for (const n of SFX) {
    assert.equal(typeof SFX_RECIPES[n], 'function', n);
    assert.ok(['sfx', 'notify', 'voice', 'ambient'].includes(busOf(n)), n);
    const s = sendOf(n);
    assert.ok(s >= 0 && s <= 1, n);
  }
  assert.equal(busOf('focus'), 'notify', 'the focus queue step is an alert-family cue (its own slider)');
  assert.equal(busOf('train'), 'ambient', 'the distant train is part of the valley (muffled indoors, hushed when hidden)');
  for (const n of ['rustle', 'thump', 'press', 'cart', 'brush', 'scope', 'shutter'] as const) assert.equal(busOf(n), 'sfx', n);
  assert.equal(sendOf('shutter'), 0, 'UI-like sounds stay dry');
  assert.ok(sendOf('train') >= 0.3, 'the whistle rings out across the valley');
});

test('every loop kind has a bed level', () => {
  for (const k of LOOP_KINDS) assert.ok(BED_SCALE[k] > 0 && BED_SCALE[k] <= 2, k);
});

test('seasons: spring birdsong is the densest, winter the sparsest; the spring dawn chorus swells', () => {
  const at = (season: AmbientIn['season'], hour = 12) => ambientLevels(base({ season, hour, daylight: hour === 12 ? 1 : 0.35 })).birds;
  assert.ok(at('spring') > at('summer') && at('summer') > at('autumn') && at('autumn') > at('winter'));
  assert.ok(at('winter') > 0, 'a few hardy winter birds');
  assert.ok(at('spring', 6.6) > at('summer', 6.6) * 1.15, 'spring dawn chorus');
  assert.ok(BIRD_SEASON.spring > 1 && BIRD_SEASON.winter < 0.5);
});

test('the snow hush: fresh or lying snow (and fog) soften the valley; a clear summer day does not', () => {
  assert.equal(ambientLevels(base()).hush, 0);
  assert.ok(ambientLevels(base({ season: 'winter', snowCover: 1 })).hush > 0.8);
  assert.ok(ambientLevels(base({ season: 'winter', weather: 'snow', intensity: 0.8 })).hush > 0.7);
  const fog = ambientLevels(base({ weather: 'fog' })).hush;
  assert.ok(fog > 0.2 && fog < 0.5);
  assert.equal(ambientLevels(base({ snowCover: 5 })).hush, 0.85, 'clamped');
});

test('the grotto: inside the rock the open-air beds fall away, the falls rumble on, no hush or glasshouse', () => {
  const outside = ambientLevels(base({ dWaterfall: 6, dGlasshouse: 2, season: 'winter', snowCover: 1 }));
  const inside = ambientLevels(base({ dWaterfall: 6, dGlasshouse: 2, season: 'winter', snowCover: 1, cave: 1 }));
  assert.equal(inside.cave, 1);
  assert.equal(outside.cave, 0);
  assert.ok(inside.birds < outside.birds * 0.2 && inside.wind < outside.wind * 0.2);
  assert.equal(inside.waterfall, outside.waterfall, 'the falls are right there, through the rock');
  assert.equal(inside.glasshouse, 0);
  assert.equal(inside.hush, 0);
});

test('the glasshouse ambience: only beside the restored glasshouse', () => {
  assert.equal(ambientLevels(base()).glasshouse, 0, 'a ruin (no distance) is silent');
  assert.ok(ambientLevels(base({ dGlasshouse: 2 })).glasshouse > 0.95);
  assert.ok(ambientLevels(base({ dGlasshouse: 9 })).glasshouse > 0.05);
  assert.equal(ambientLevels(base({ dGlasshouse: 20 })).glasshouse, 0);
});

test('no music in the grotto (the drips are the music); indoors elsewhere still gets its waltz', () => {
  const m = { hour: 12, season: 'summer' as const, weather: 'clear' as const, intensity: 0, indoors: true, festival: null };
  assert.equal(musicScene({ ...m, cave: true }), null);
  assert.equal(musicScene(m), 'indoors');
});

test('sound captions: only the meaningful ones, only when audible, not more often than their gap', () => {
  const last = new Map<string, number>();
  assert.equal(soundCaption('pop', 1, 0, last), null, 'not every sound is captioned');
  assert.equal(soundCaption('train', CAPTION_MIN_GAIN / 2, 0, last), null, 'too faint to hear');
  assert.equal(soundCaption('train', Number.NaN, 0, last), null);
  const c = soundCaption('train', 0.5, 10, last);
  assert.ok(c && c.sound && c.text);
  assert.equal(soundCaption('train', 0.5, 12, last), null, 'within its gap');
  assert.ok(soundCaption('train', 0.5, 10 + SOUND_CAPTIONS.train.gap, last));
  assert.ok(soundCaption('bite', 1, 12, last), 'separate names do not block each other');
  for (const [k, v] of Object.entries(SOUND_CAPTIONS)) {
    assert.ok((SFX as readonly string[]).includes(k), `${k} is a real sound name`);
    assert.ok(v.gap > 0 && v.sound.length > 2 && v.text.length > 2, k);
  }
});
