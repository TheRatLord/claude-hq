import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HINTS, HINT_GAP_MS, HINT_SETTLE_MS, STEPS, WELCOME_BITS, WELCOME_DECOR, allDone, begin, createOnboarding, dismiss, dueHint, emptyOnboarding,
  finish, nextStep, parseOnboarding, progress, replay, sawHint, settle, shouldWelcome, signal, tipsAllowed,
} from './onboarding.ts';
import type { OnboardingChange, OnboardingData, WelcomeLetter } from './onboarding.ts';
import { DECOR, decorDef, lockOf } from './shop.ts';
import { createWallet, shopView, emptyWallet } from './wallet.ts';

const T0 = new Date(2026, 9, 1, 10).getTime();
const all = (d: OnboardingData) => { for (const s of ['look', 'walk', 'talk', 'terminal', 'answer', 'map', 'ledger', 'forage'] as const) signal(d, s); };

test('onboarding: steps are the tour in order, the pastime last; the welcome decor is a real, unsellable piece', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['look', 'walk', 'talk', 'terminal', 'answer', 'map', 'ledger', 'pastime']);
  assert.ok(STEPS.at(-1)?.extra);
  for (const s of STEPS) assert.ok(s.title && s.how.length > 20 && s.keys.length, s.id);
  const def = decorDef(WELCOME_DECOR);
  assert.ok(def?.gift, 'the welcome piece is a gift');
  assert.equal(lockOf(def!, { rank: 9, season: 'summer', owned: 0 }), 'keepsake');
  assert.ok(!shopView(emptyWallet(), { rank: 9, season: 'summer' }).some((e) => e.def.id === WELCOME_DECOR), 'never on the shelves');
  assert.equal(DECOR.filter((d) => d.gift && !d.id.startsWith('trophy-') && d.id !== 'geode').length, 1, 'the only gift besides the stamp book trophies (model/stamps.ts) and the grotto chest\'s geode lamp (scene/grotto)');
});

test('onboarding: signals only count while the checklist runs; steps tick in any order; next = first open', () => {
  const d = emptyOnboarding();
  assert.equal(signal(d, 'map'), null, 'nothing before the welcome');
  begin(d, T0);
  assert.equal(d.active, true);
  assert.equal(nextStep(d)?.id, 'look');
  assert.equal(signal(d, 'map'), 'map');
  assert.equal(signal(d, 'map'), null, 'a step ticks once');
  assert.equal(nextStep(d)?.id, 'look');
  signal(d, 'look'); signal(d, 'walk');
  assert.equal(nextStep(d)?.id, 'talk');
  assert.deepEqual(progress(d), { done: 3, total: STEPS.length });
});

test('onboarding: any one pastime ticks the pastime step; the others still light their chips', () => {
  const d = emptyOnboarding();
  begin(d, T0);
  assert.equal(signal(d, 'fish'), 'pastime');
  assert.equal(d.steps.pastime, 'done');
  assert.equal(signal(d, 'farmhouse'), 'pastime', 'a new chip is still news');
  assert.equal(signal(d, 'farmhouse'), null);
  assert.deepEqual(d.pastimes, { fish: true, farmhouse: true });
});

test('onboarding: the answer step is skipped only when it is next and nobody needs you; a later answer still ticks it', () => {
  const d = emptyOnboarding();
  begin(d, T0);
  assert.equal(settle(d, { asks: 0 }), false, 'not the current step yet');
  for (const s of ['look', 'walk', 'talk', 'terminal'] as const) signal(d, s);
  assert.equal(settle(d, { asks: 2 }), false, 'someone needs you: do it');
  assert.equal(settle(d, { asks: 0 }), true);
  assert.equal(d.steps.answer, 'skipped');
  assert.equal(nextStep(d)?.id, 'map');
  assert.equal(signal(d, 'answer'), 'answer');
  assert.equal(d.steps.answer, 'done');
});

test('onboarding: finishing pays once per profile (bits, decor, letter); a replay starts clean and pays nothing', () => {
  const d = emptyOnboarding();
  begin(d, T0);
  assert.equal(finish(d, T0), null, 'not done yet');
  all(d);
  assert.ok(allDone(d));
  const r = finish(d, T0 + 1000);
  assert.ok(r);
  assert.equal(r.coins, WELCOME_BITS);
  assert.equal(r.decor, WELCOME_DECOR);
  assert.match(r.letter.body, /bits/);
  assert.equal(d.active, false);
  assert.equal(d.letter?.id, r.letter.id);
  replay(d);
  assert.deepEqual(d.steps, {});
  begin(d, T0 + 5000);
  all(d);
  assert.equal(finish(d, T0 + 6000), null, 'rewarded already');
  assert.equal(d.active, false, 'but the checklist still closes');
});

test('onboarding: skip and dismiss stop the checklist', () => {
  const d = emptyOnboarding();
  begin(d, T0, true);
  assert.equal(d.welcomed, true);
  assert.equal(d.active, false);
  assert.equal(signal(d, 'look'), null);
  const e = emptyOnboarding();
  begin(e, T0);
  dismiss(e);
  assert.equal(e.active, false);
  assert.equal(e.dismissed, true);
});

test('onboarding: who gets the welcome (first visit, not automated; ?welcome=1 forces, =0 never)', () => {
  const fresh = emptyOnboarding(), seen = emptyOnboarding();
  begin(seen, T0);
  assert.equal(shouldWelcome(fresh, { param: null, automated: false }), true);
  assert.equal(shouldWelcome(seen, { param: null, automated: false }), false);
  assert.equal(shouldWelcome(fresh, { param: null, automated: true }), false, 'tests and shots are left alone');
  assert.equal(shouldWelcome(fresh, { param: '1', automated: true }), true);
  assert.equal(shouldWelcome(seen, { param: '1', automated: false }), true, 'a forced replay');
  assert.equal(shouldWelcome(fresh, { param: '0', automated: false }), false);
  assert.equal(tipsAllowed({ param: null, automated: false }), true);
  assert.equal(tipsAllowed({ param: null, automated: true }), false);
  assert.equal(tipsAllowed({ param: '1', automated: true }), true);
  assert.equal(tipsAllowed({ param: '0', automated: false }), false);
});

test('onboarding tips: once each, one per gap, settle after the welcome, never busy, never when off', () => {
  const d = emptyOnboarding();
  assert.equal(dueHint(d, ['rain'], T0, false), null, 'not before the welcome');
  begin(d, T0);
  assert.equal(dueHint(d, ['rain'], T0 + 1000, false), null, 'settling');
  const t1 = T0 + HINT_SETTLE_MS + 1;
  assert.equal(dueHint(d, ['rain'], t1, true), null, 'busy');
  assert.equal(dueHint(d, ['rain', 'night'], t1, false)?.id, 'rain', 'in order');
  sawHint(d, 'rain', t1);
  assert.equal(dueHint(d, ['rain', 'night'], t1 + 1000, false), null, 'one per gap');
  assert.equal(dueHint(d, ['rain', 'night'], t1 + HINT_GAP_MS, false)?.id, 'night', 'rain is seen');
  d.hints.off = true;
  assert.equal(dueHint(d, ['night'], t1 + HINT_GAP_MS * 3, false), null);
  for (const x of HINTS) assert.ok(x.text && x.sub.length > 20, x.id);
  assert.match(HINTS.find((x) => x.id === 'blocked')!.sub, /Alt\+1/);
  assert.match(HINTS.find((x) => x.id === 'rain')!.sub, /rain/i);
});

test('onboarding: parse is tolerant and keeps what matters', () => {
  assert.equal(parseOnboarding(null), null);
  assert.equal(parseOnboarding({ v: 2 }), null);
  const d = parseOnboarding({ v: 1, welcomed: true, active: true, steps: { look: 'done', nope: 'done', map: 'weird', answer: 'skipped' },
    pastimes: { fish: true, golf: true }, hints: { off: true, seen: ['rain', 'zzz'], last: 5 }, letter: { id: 'x', at: 3, title: 't', body: 'b' } });
  assert.ok(d);
  assert.deepEqual(d.steps, { look: 'done', answer: 'skipped' });
  assert.deepEqual(d.pastimes, { fish: true });
  assert.deepEqual(d.hints, { off: true, seen: ['rain'], last: 5 });
  assert.equal(d.letter?.from, 'villager:posy');
});

test('onboarding service: persists, pays through the ports, queues tips', () => {
  let saved: unknown = null, now = T0;
  const paid: number[] = [], gifts: string[] = [], posts: WelcomeLetter[] = [], changes: OnboardingChange['kind'][] = [];
  const wallet = createWallet(undefined);
  const s = createOnboarding({ load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); } }, {
    now: () => now, autostart: true,
    pay: (c) => { paid.push(c); wallet.reward(c, 'welcome'); }, gift: (id) => { gifts.push(id); wallet.gift(id); }, post: (l) => posts.push(l),
  });
  s.onChange((c) => changes.push(c.kind));
  assert.equal(s.autostart, true);
  s.begin();
  for (const x of ['look', 'walk', 'talk', 'terminal', 'map', 'ledger', 'forage'] as const) s.signal(x);
  s.settle({ asks: 0 });
  assert.deepEqual(paid, [WELCOME_BITS]);
  assert.deepEqual(gifts, [WELCOME_DECOR]);
  assert.equal(posts.length, 1);
  assert.equal(wallet.coins(), WELCOME_BITS);
  assert.ok(wallet.data().pieces.some((p) => p.id === WELCOME_DECOR && p.slot !== null), 'straight into the yard');
  assert.ok(changes.includes('finish'));
  // a reload keeps the state
  const again = createOnboarding({ load: () => saved, save: () => {} }, { now: () => now });
  assert.equal(again.data().rewarded, true);
  assert.equal(again.data().letter?.id, posts[0].id);
  // tips: queued, then shown once the gap has passed
  now += HINT_GAP_MS;
  s.want('night');
  assert.equal(s.nextHint(true), null, 'busy');
  assert.equal(s.nextHint(false)?.id, 'night');
  s.want('night');
  now += HINT_GAP_MS;
  assert.equal(s.nextHint(false), null, 'seen');
  const off = createOnboarding(undefined, { tips: false });
  off.begin();
  off.want('rain');
  now += HINT_GAP_MS;
  assert.equal(off.nextHint(false), null, 'tips not allowed on this load');
});
