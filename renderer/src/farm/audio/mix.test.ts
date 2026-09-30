import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambientLevels, busGains, createPolyphony, createRateLimiter, cricketPeriod, emptyLevels, logRate, spatial, taper } from './mix.ts';
import type { AmbientIn } from './mix.ts';
import { planVoice, timbreOf } from './voicePlan.ts';
import { barSeconds, inScale, planBar } from './musicPlan.ts';

test('spatial: close is loud and centred, far is quiet and dull, sides pan', () => {
  const near = spatial(0.5, 0, 0, 1, 0);
  assert.equal(near.gain, 1);
  assert.ok(Math.abs(near.pan) < 0.3);
  const far = spatial(60, 0, 0, 1, 0, { max: 70 });
  assert.ok(far.gain < 0.08 && far.gain >= 0);
  assert.ok(far.cutoff < 4000);
  assert.equal(spatial(100, 0, 0, 1, 0, { max: 70 }).gain, 0);
  assert.ok(spatial(10, 0, 0, 1, 0).pan > 0.7, 'right of listener pans right');
  assert.ok(spatial(-10, 0, 0, 1, 0).pan < -0.7);
  assert.ok(Math.abs(spatial(0, 0, -10, 1, 0).pan) < 1e-9, 'straight ahead is centred');
  const out = { gain: 0, pan: 0, cutoff: 0 };
  assert.equal(spatial(5, 1, 5, 0, 1, {}, out), out, 'writes into out');
  for (let d = 0; d < 200; d += 7) { const s = spatial(d, 2, d / 3, 0.6, 0.8); assert.ok(Number.isFinite(s.gain + s.pan + s.cutoff)); }
});

test('bus gains follow the sliders with a square taper; mute silences master only', () => {
  const g = busGains({ volumeMaster: 0.5, volumeSfx: 1, volumeAmbient: 0, volumeNotify: 0.9, volumeVoices: 0.7, audioMuted: false });
  assert.equal(g.master, 0.25);
  assert.equal(g.sfx, 1);
  assert.equal(g.ambient, 0);
  assert.equal(busGains({ audioMuted: true }).master, 0);
  assert.ok(busGains({}).ambient > 0, 'defaults when the settings service is missing');
  assert.equal(taper(Number.NaN), 0);
  assert.equal(taper(3), 1);
});

test('rate limiter coalesces bursts per name', () => {
  const rl = createRateLimiter({ alert: 4 });
  assert.ok(rl.allow('alert', 10));
  assert.ok(!rl.allow('alert', 12));
  assert.ok(rl.allow('pop', 12));
  assert.ok(rl.allow('alert', 14.1));
  assert.ok(!rl.allow('pop', 12.01));
  assert.equal(rl.since('never', 1), Infinity);
});

test('polyphony caps concurrent one-shots, priority steals', () => {
  const p = createPolyphony(3);
  assert.ok(p.admit(0, 1, false) && p.admit(0, 2, false) && p.admit(0, 3, false));
  assert.ok(!p.admit(0.5, 2, false));
  assert.ok(p.admit(0.5, 2, true));
  assert.equal(p.active(0.5), 3);
  assert.ok(p.admit(2.5, 3, false), 'slots free up as sounds end');
});

const base: AmbientIn = { hour: 12, daylight: 1, season: 'summer', weather: 'clear', intensity: 0, wind: 2, cpu: 0.3, altitude: 0, dRiver: 200, dPond: 200, dWaterfall: 300, dFire: 200, dWindmill: 200, dBees: Infinity };

test('ambient beds: day birds, night crickets/owls, rain hushes birds, water near water', () => {
  const day = ambientLevels(base);
  const night = ambientLevels({ ...base, hour: 23, daylight: 0 }, emptyLevels());
  assert.ok(day.birds > 0.4 && day.crickets === 0 && day.owls === 0);
  assert.ok(night.birds < 0.05 && night.crickets > 0.4 && night.owls > 0.4);
  assert.equal(night.mood, 'night');
  const rain = ambientLevels({ ...base, weather: 'rain', intensity: 0.8 });
  assert.ok(rain.rain > 0.7 && rain.birds < day.birds * 0.4);
  assert.equal(rain.mood, 'rain');
  const dawn = ambientLevels({ ...base, hour: 6.6, daylight: 0.5 });
  assert.ok(dawn.birds > ambientLevels({ ...base, hour: 15, daylight: 0.5 }).birds, 'dawn chorus');
  assert.ok(ambientLevels({ ...base, dRiver: 3 }).river > 0.95 && day.river === 0);
  assert.ok(ambientLevels({ ...base, hour: 22, daylight: 0, dPond: 12 }).frogs > 0.4);
  assert.equal(ambientLevels({ ...base, hour: 22, daylight: 0, dPond: 12, season: 'winter' }).frogs, 0);
  assert.ok(ambientLevels({ ...base, hour: 21, daylight: 0.1, dFire: 3 }).fire > 0.8);
  assert.equal(ambientLevels({ ...base, dFire: 3 }).fire, 0, 'campfire is out at noon');
  assert.ok(ambientLevels({ ...base, dWindmill: 4, cpu: 1 }).windmill > ambientLevels({ ...base, dWindmill: 4, cpu: 0 }).windmill);
  assert.ok(ambientLevels({ ...base, dBees: 5 }).bees > 0.5 && day.bees === 0);
  assert.ok(ambientLevels({ ...base, weather: 'storm', intensity: 1 }).wind > day.wind);
  for (const v of Object.values(night)) if (typeof v === 'number') assert.ok(v >= 0 && v <= 1.3);
});

test('log rate + cricket thermometer', () => {
  assert.equal(logRate(0), 0);
  assert.ok(logRate(1e6) > 0.5 && logRate(1e6) < 0.7);
  assert.equal(logRate(1e12), 1);
  assert.ok(cricketPeriod(85) < cricketPeriod(35));
  assert.ok(cricketPeriod(null) > 0.4);
});

test('voice plans: deterministic, per-seed timbre, mood contours', () => {
  assert.deepEqual(planVoice('ann', 'happy', 4, 1), planVoice('ann', 'happy', 4, 1));
  assert.notEqual(timbreOf('ann').base, timbreOf('bob').base);
  const q = planVoice('ann', 'question', 5);
  const last = q.syllables[4];
  assert.ok(last.f1 > last.f0 * 1.2, 'question ends rising');
  const sad = planVoice('ann', 'sad', 5), exc = planVoice('ann', 'excited', 5);
  assert.ok(sad.total > exc.total * 1.4, 'sad is slower than excited');
  assert.ok(sad.syllables[4].f0 < sad.syllables[0].f0, 'sad falls');
  const e = exc.syllables;
  assert.ok((e[0].f0 - e[1].f0) * (e[1].f0 - e[2].f0) < 0, 'excited bounces');
  assert.equal(planVoice('x', 'happy', 99).syllables.length, 12);
  for (const s of planVoice('zed', 'happy', 6).syllables) assert.ok(s.dur > 0.03 && s.f0 > 100 && s.f0 < 700 && s.gain > 0 && s.gain <= 1);
});

test('music: deterministic, in scale, night sparser, breathes', () => {
  assert.deepEqual(planBar(5, 'day', 3), planBar(5, 'day', 3));
  let day = 0, night = 0;
  for (let b = 0; b < 64; b++) {
    const d = planBar(b, 'day'), n = planBar(b, 'night');
    for (const x of [...d.notes, ...n.notes]) {
      if (x.voice === 'pluck' || x.voice === 'bell') assert.ok(inScale(x.midi), `melody note ${x.midi} in scale`);
      assert.ok(x.t >= 0 && x.t < d.barSec + n.barSec && x.dur > 0 && x.vel > 0 && x.vel <= 1);
    }
    day += d.notes.filter((x) => x.voice === 'pluck').length;
    night += n.notes.filter((x) => x.voice === 'bell').length;
  }
  assert.ok(night < day * 0.8, `night ${night} sparser than day ${day}`);
  assert.equal(planBar(14, 'day').notes.filter((x) => x.voice === 'pluck').length, 0);
  assert.ok(barSeconds('night') > barSeconds('day'));
});
