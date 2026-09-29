import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from './synth.ts';
import { voiceProfile, phrasePlan, planLength, PHRASES, VOWELS } from './voice.ts';
import {
  createLimiter, sliderGain, categoryGain, masterGain, zoneTone, occlusion, typingRate, humFor, hourHush, CATEGORIES, DEFAULT_LEVELS,
  bellGain, lanternLevel, LANTERN_STEPS, MIX_TARGETS,
} from './mix.ts';
import { DEFAULT_SETTINGS } from '../../../shared/protocol.ts';
import { readFileSync, readdirSync } from 'node:fs';

const SR = 48000;

test('[AUD] every banked one-shot renders: finite, non-silent, peak-normalised ≤ 0.95, no DC tail', () => {
  const bufs: Record<string, S.Samples> = {
    ...Object.fromEntries(S.SURFACES.flatMap((s) => [[`step:${s}`, S.renderStep(s, 1, SR)], [`land:${s}`, S.renderStep(s, 0, SR, true)]])),
    key: S.renderKey(0, SR), space: S.renderKey(5, SR),
    done: S.renderDoneChime(SR), blocked: S.renderBlockedChime(SR), bell: S.renderDeskBell(SR), allClear: S.renderAllClear(SR),
    ...Object.fromEntries(['testPass', 'testFail', 'error', 'commit', 'stamp', 'pop', 'bubble', 'whoosh', 'squeak', 'chute', 'sit', 'boop',
      'purr', 'meow', 'catHiss', 'catLand', 'pssht', 'ding', 'serve', 'bonk', 'crumbs'].map((n) => [n, S.renderFoley(n, SR)])),
    pink: S.renderPinkLoop(SR),
  };
  for (const [k, b] of Object.entries(bufs)) {
    assert.ok(b.every(Number.isFinite), `${k} finite`);
    const pk = S.peak(b);
    assert.ok(pk > 0.3 && pk <= 0.951, `${k} peak ${pk}`);
    if (k !== 'pink') assert.ok(Math.abs(b[b.length - 1]) < 1e-3, `${k} ends at silence (no click)`);
  }
  // durations: steps are short (they must never smear into the next step at sprint 2.6 Hz)
  assert.ok(bufs['step:tile'].length / SR <= 0.3);
  assert.ok(bufs.done.length / SR < 2 && bufs.blocked.length / SR < 2);
});

test('[AUD] footsteps: surfaces are audibly different (spectral centroid ordering: carpet < wood < tile)', () => {
  // brightness ≈ RMS frequency from the first-difference energy ratio
  const zcr = (b: S.Samples) => { let d = 0, e = 0; for (let i = 1; i < b.length; i++) { d += (b[i] - b[i - 1]) ** 2; e += b[i] * b[i]; } return Math.sqrt(d / e) * SR / (2 * Math.PI); };
  const avg = (s: string) => [0, 1, 2, 3].reduce((a, v) => a + zcr(S.renderStep(s, v, SR)), 0) / 4;
  const carpet = avg('carpet'), wood = avg('wood'), tile = avg('tile'), metal = avg('metal');
  assert.ok(carpet < wood && wood < tile, `carpet ${carpet} < wood ${wood} < tile ${tile}`);
  assert.ok(metal > wood, `metal ${metal} rings above wood`);
  // variants differ (no machine-gun repetition)
  const a = S.renderStep('tile', 0, SR), b = S.renderStep('tile', 1, SR);
  let diff = 0; for (let i = 0; i < 2000; i++) diff += Math.abs(a[i] - b[i]);
  assert.ok(diff > 1);
});

test('[AUD] pink loop is seamless (the wrap step is no larger than typical sample steps)', () => {
  const p = S.renderPinkLoop(SR, 2);
  let mean = 0; for (let i = 1; i < p.length; i++) mean += Math.abs(p[i] - p[i - 1]);
  mean /= p.length;
  assert.ok(Math.abs(p[0] - p[p.length - 1]) < mean * 6, 'no click at the loop point');
});

test('[AUD] voices: deterministic per identity, distinct between agents, contours carry the emotion', () => {
  const a = voiceProfile('ws1|tab|claude'), a2 = voiceProfile('ws1|tab|claude'), b = voiceProfile('ws2|tab|codex');
  assert.deepEqual(a, a2);
  assert.notDeepEqual(a, b);
  assert.ok(a.base > 350 && a.base < 900, `cute register ${a.base}`);
  assert.ok(voiceProfile('x', 'shell').robot);
  const v = phrasePlan('victory', a, 1);
  assert.ok(v);
  assert.ok(v.length >= 5 && v[v.length - 1].f0 > v[0].f0 * 1.3, 'victory rises');
  const s = phrasePlan('slump', a, 1);
  assert.ok(s);
  assert.ok(s[s.length - 1].f1 < s[0].f0, 'slump falls');
  const st = phrasePlan('startle', a, 1);
  assert.ok(st);
  assert.equal(st.length, 1); assert.ok(st[0].f1 > st[0].f0, 'eep! glides up');
  for (const r of Object.keys(PHRASES)) {
    const p = phrasePlan(r, a, 7);
    assert.ok(p);
    assert.ok(p.length > 0 && planLength(p) < 1.6, `${r} is a short blip (${planLength(p)} s)`);
    for (const syl of p) { assert.ok(syl.vowel in VOWELS); assert.ok(syl.t >= 0 && syl.dur > 0.02); }
  }
  assert.equal(phrasePlan('dissolveIn', a), null, 'cold-start dissolves are silent');
});

test('[AUD] notification limiter: 1 per agent per 10 s, bursts merge into one global chime', () => {
  const L = createLimiter();
  assert.deepEqual(L.check('a', 'blocked', 0), { play: true, global: true });
  assert.deepEqual(L.check('a', 'blocked', 5000), { play: false, global: false });
  assert.deepEqual(L.check('b', 'blocked', 300), { play: true, global: false }, 'burst: b only rings its spatial ding');
  assert.deepEqual(L.check('a', 'done', 400), { play: true, global: false }, 'kinds are independent per agent');
  assert.deepEqual(L.check('a', 'blocked', 10_001), { play: true, global: true });
  L.forget('a');
  assert.equal(L.check('a', 'blocked', 10_002).play, true);
});

test('[AUD] settings: every category has a DEFAULT_SETTINGS key; muted/locked → master 0; slider is perceptual', () => {
  for (const k of [...Object.values(CATEGORIES), 'volumeMaster' as const]) assert.equal(typeof DEFAULT_SETTINGS[k], 'number', k);
  assert.equal(DEFAULT_SETTINGS.audioMuted, false);
  for (const k of Object.keys(DEFAULT_LEVELS) as (keyof typeof DEFAULT_LEVELS)[]) assert.equal(DEFAULT_LEVELS[k], DEFAULT_SETTINGS[k], `${k} fallback matches`);
  const get = (k: keyof typeof DEFAULT_SETTINGS) => ({ ...DEFAULT_SETTINGS })[k];
  assert.equal(masterGain(get, false), 0, 'silent until the first gesture');
  assert.ok(masterGain(get, true) > 0.5);
  assert.equal(masterGain((k) => (k === 'audioMuted' ? true : get(k)), true), 0);
  assert.equal(sliderGain(0.5), 0.25);
  assert.equal(sliderGain(2), 1); assert.equal(sliderGain(NaN), 0);
  assert.ok(categoryGain(() => undefined, 'voices') > 0, 'older backend without the M3 keys still has sound');
});

test('[AUD] rooms: zone tone presets, night hush, occlusion through walls, hum follows CPU', () => {
  assert.ok(zoneTone('LIB').gain < zoneTone('ATR').gain, 'library is hushed');
  assert.deepEqual(zoneTone('E2'), zoneTone('W1'), 'bays share a preset');
  assert.ok(hourHush(23) < hourHush(13));
  assert.equal(occlusion('ATR', 'PIT').gain, 1);
  assert.ok(occlusion('LOB', 'ARC').lp < 2000, 'archive behind walls is muffled');
  assert.ok(occlusion('ATR', 'E2').gain > occlusion('ATR', 'ARC').gain, 'glass muffles less than walls');
  const lo = humFor(5), hi = humFor(95);
  assert.ok(hi.gain > lo.gain * 3 && hi.cutoff > lo.cutoff * 3 && hi.fan > lo.fan);
  assert.deepEqual(humFor(null), humFor(0));
});

test('[AUD] typing follows the visible animation (type / frenzy / bash / laptop-walk), only while working', () => {
  assert.equal(typingRate('type', 'working'), 1);
  assert.ok(typingRate('typeFrenzy', 'working') > typingRate('type', 'working'));
  assert.equal(typingRate('readBook', 'working'), 0);
  assert.equal(typingRate('type', 'idle'), 0);
  assert.equal(typingRate(null, 'working'), 0);
});

test('[AUD] ambient life is audible: every amb.* topic/ev the cast emits has a handler + a banked cue', () => {
  const dir = new URL('../world/ambient/', import.meta.url);
  const emitted = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/emit\?\.\('(amb\.\w+)',\s*\{\s*ev:\s*'(\w+)'/g)) emitted.add(`${m[1]}|${m[2]}`);
  }
  assert.ok(emitted.size >= 10, `found the cast's cues (${[...emitted]})`);
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  for (const k of emitted) {
    const [topic, ev] = k.split('|');
    assert.ok(src.includes(`bus.on('${topic}'`), `${topic} subscribed`);
    assert.ok(src.includes(`'${ev}'`), `${k} handled`);
  }
  assert.ok(PHRASES.hi, 'Ada/Bean say hi');
  // the purr is a loop body: one breath, and quiet at both ends (the loop point breathes instead of clicking)
  const p = S.renderFoley('purr', SR);
  assert.ok(p.length / SR > 1.2 && p.length / SR < 2.5);
  assert.ok(Math.abs(p[0]) < 0.05 && Math.abs(p[p.length - 1]) < 1e-3);
});

test('[AUD m3.5] new cues render clean: plane, pat, whistle, lanterns, crate, unwrap, thanks, spawn, slap, inbox zero', () => {
  const bufs: Record<string, S.Samples> = {
    ...Object.fromEntries(['plane', 'pat', 'whistle', 'lanternPop', 'crateClack', 'unwrap', 'thanks', 'spawn', 'slap'].map((n) => [n, S.renderFoley(n, SR)])),
    ...Object.fromEntries([0, 1, 2].map((v) => [`lanternRise:${v}`, S.renderFoley('lanternRise', SR, v)])),
    inboxZero: S.renderInboxZero(SR),
  };
  for (const [k, b] of Object.entries(bufs)) {
    assert.ok(b.every(Number.isFinite), `${k} finite`);
    const pk = S.peak(b);
    assert.ok(pk > 0.3 && pk <= 0.951, `${k} peak ${pk}`);
    assert.ok(Math.abs(b[b.length - 1]) < 1e-3, `${k} ends at silence`);
    assert.ok(b.length / SR < 3, `${k} is a one-shot`);
  }
  // escalated lanterns are different sounds (brighter), not the same buffer louder
  let diff = 0; const a = bufs['lanternRise:0'], c = bufs['lanternRise:2'];
  for (let i = 0; i < 20000; i++) diff += Math.abs(a[i] - c[i]);
  assert.ok(diff > 10);
});

test('[AUD m3.5] Help Desk bell grows with the oldest wait, capped; lantern escalation steps', () => {
  assert.equal(bellGain(0), 0.3);
  assert.ok(bellGain(60) > bellGain(10) && bellGain(240) > bellGain(60));
  assert.ok(Math.abs(bellGain(300) - 0.75) < 1e-9 && bellGain(3600) === bellGain(300), 'capped at 5 min');
  assert.equal(bellGain(NaN), 0.3); assert.equal(bellGain(-5), 0.3);
  assert.deepEqual([0, 59, 60, 179, 180, 900].map(lanternLevel), [0, 0, 1, 1, 2, 2]);
  assert.equal(LANTERN_STEPS.length, 3);
  assert.ok(MIX_TARGETS.peakMax < 1 && MIX_TARGETS.bed[1] < MIX_TARGETS.sfx[1] && MIX_TARGETS.sfx[0] < MIX_TARGETS.notify[0]);
});

test('[AUD m3.5] every M3.5 bus topic is subscribed and every cue it plays is banked', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  for (const t of ['verb', 'prompt.sent', 'answered', 'inbox.zero', 'spawn.sent']) assert.ok(src.includes(`bus.on('${t}'`), `${t} subscribed`);
  for (const v of ['pat', 'summon', 'highFive']) assert.ok(src.includes(`case '${v}'`), `verb ${v}`);
  const eng = readFileSync(new URL('./engine.ts', import.meta.url), 'utf8');
  for (const n of ['whoosh:plane', 'squeak:pat', 'whistle', 'lantern:pop', 'crate:clack', 'crate:unwrap', 'thanks', 'spawn', 'slap', 'inboxZero', 'lantern:rise:']) {
    assert.ok(eng.includes(`'${n}`) || eng.includes(`\`${n}`), `${n} banked`);
    assert.ok(src.includes(n), `${n} played`);
  }
});
