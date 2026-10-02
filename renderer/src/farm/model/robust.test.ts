/**
 * Robustness: every browser-local store (`claude-valley.*.v1`) must load whatever is in localStorage — garbage, an old
 * or future version, the right shape with wrong types, absurd numbers, unknown ids — without throwing, and the service
 * built on it must keep working (views, the day's actions, saving). Each store is filled for real first, then every
 * path of the saved JSON is mutated in turn (deterministically) and reloaded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { almanacView, demoAlmanac, parseAlmanac, recapDue, recordHarvest } from './almanac.ts';
import { createCollection } from './collection.ts';
import { createWallet } from './wallet.ts';
import { createFriends } from './friends.ts';
import { createOnboarding } from './onboarding.ts';
import { createStamps } from './stamps.ts';
import { createPetModel } from './pet.ts';
import { createTimeline, demoDay, keyMoments, rollDay, summarize } from './timeline.ts';
import { composeIssue, createGazette, demoInput, gatherFacts } from './gazette.ts';

const NOW = new Date(2026, 9, 2, 14, 0).getTime();
const now = () => NOW;
const BAD: unknown[] = [null, 'x', '', -1, 0, 1e308, -1e308, 2 ** 53 + 2, 0.5, true, [], {}, [null], { v: 1 }, '2026-13-45', '9999-99-99', '__proto__'];
const GARBAGE: unknown[] = [null, undefined, 'not json', 42, true, [], {}, [1, 2], { v: 0 }, { v: 2 }, { v: '1' }, { v: 1 }, { v: 1, __proto__: { polluted: 1 } }];

/** every [path, mutated copy] of `root`: each leaf / object / array replaced by each BAD value, plus extra array junk */
function* mutations(root: unknown): Generator<[string, unknown]> {
  const paths: (string | number)[][] = [];
  const walk = (v: unknown, p: (string | number)[]) => {
    paths.push(p);
    if (Array.isArray(v)) v.slice(0, 4).forEach((x, i) => walk(x, [...p, i]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...p, k]);
  };
  walk(root, []);
  for (const p of paths) {
    if (!p.length) continue;
    for (const bad of BAD) {
      const copy = structuredClone(root) as Record<string | number, unknown>;
      let o = copy;
      for (const k of p.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
      o[p.at(-1)!] = structuredClone(bad);
      yield [`${p.join('.')}=${JSON.stringify(bad)}`, copy];
    }
  }
}

/** a store port over a value; records what is saved (must stay JSON-serialisable) */
const port = (v: unknown) => { let saved: unknown = v; return { load: () => saved, save: (d: unknown) => { saved = JSON.parse(JSON.stringify(d)); }, get saved() { return saved; } }; };

function finite(o: unknown, where: string): void {
  // every number a view hands to the HUD must be finite (NaN / Infinity end up as "NaN bits" or broken widths)
  const seen = new Set<unknown>();
  const walk = (v: unknown, p: string) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${where}: ${p} = ${v}`);
    else if (v && typeof v === 'object' && !seen.has(v)) { seen.add(v); for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`); }
  };
  walk(o, '');
}

function fuzz(name: string, sample: unknown, use: (load: unknown) => unknown): void {
  let n = 0;
  for (const g of GARBAGE) { assert.doesNotThrow(() => finite(use(g), `${name} garbage ${JSON.stringify(g)}`), `${name}: garbage ${JSON.stringify(g)}`); n++; }
  for (const [what, v] of mutations(sample)) {
    try { finite(use(v), `${name} ${what}`); } catch (e) { assert.fail(`${name}: ${what}: ${(e as Error).stack}`); }
    n++;
  }
  assert.ok(n > 20, `${name}: ${n} cases`);
}

test('robust: the almanac loads any stored value', () => {
  const sample = JSON.parse(JSON.stringify({ ...demoAlmanac(NOW), recap: '2026-10-01' }));
  fuzz('almanac', sample, (raw) => {
    const d = parseAlmanac(raw);
    if (!d) return null;
    recordHarvest(d, 'commit', NOW);
    recapDue(d, NOW);
    return almanacView(d, NOW);
  });
});

test('robust: the timeline loads any stored value', () => {
  const day = demoDay({ id: 'a', tag: 'app', name: 'flint' }, NOW);
  const sample = JSON.parse(JSON.stringify({ v: 1, day: '2026-10-02', farmers: { a: day }, past: [rollDay({ day: '2026-10-01', farmers: { a: day } })] }));
  fuzz('timeline', sample, (raw) => {
    const tl = createTimeline(port(raw), { now: NOW });
    tl.observe([{ id: 'a', tag: 'app', name: 'flint', job: 'plant', needsYou: false }], NOW + 1000);
    tl.mark('a', 'ship', NOW + 2000, 'x');
    tl.flush();
    const fd = tl.view.farmers.get('a');
    return { s: summarize(fd), m: keyMoments(fd).length };
  });
});

test('robust: the collection loads any stored value', () => {
  const st = port(null);
  const c = createCollection(st, now);
  c.devFill(14);
  c.sight('deer');
  fuzz('collection', st.saved, (raw) => {
    const s = createCollection(port(raw), now);
    s.catch('trout', 31); s.sight('fox');
    const v = s.view('autumn');
    s.picked('2026-10-02');
    return v;
  });
});

test('robust: the wallet loads any stored value', () => {
  const st = port(null);
  const w = createWallet(st, { now });
  w.devCoins(900); w.stash('mushroom', 3); w.buy('bench', { rank: 9, season: 'autumn', autoPlace: true, free: true }); w.buy('gnome', { rank: 9, season: 'autumn', autoPlace: true, free: true });
  w.work('ship');
  fuzz('wallet', st.saved, (raw) => {
    const s = createWallet(port(raw), { now, seed: () => ({}) });
    s.stash('mushroom', 1); s.sellAll(); s.work('ship'); s.reward(5, 'x'); s.spend(1, 'x'); s.gift('gnome');
    const p = s.data().pieces[0];
    if (p) { s.rotate(p.uid, 1); s.restyle(p.uid); s.store(p.uid); s.place(p.uid, 0); }
    return { coins: s.coins(), basket: s.basketCount(), value: s.basketValue(), work: s.workToday(), shop: s.shop({ rank: 3, season: 'autumn' }).length };
  });
});

test('robust: friendship loads any stored value', () => {
  const st = port(null);
  const basket = { count: () => 3, take: (_id: string, n: number) => n, stash: () => {} };
  const f = createFriends(st, { now, basket, season: () => 'autumn' });
  f.devHearts('posy', 4); f.talk('posy'); f.devRequests({ ready: true }); f.devHearts('bram', 10);
  fuzz('friends', st.saved, (raw) => {
    const s = createFriends(port(raw), { now, basket, season: () => 'autumn', pay: () => {}, gift: () => {} });
    const all = s.all().map((v) => ({ id: v.def.id, h: v.hearts }));
    const rq = s.requests().map((q) => ({ n: q.n, have: q.have, reward: q.req.reward }));
    s.talk('posy'); s.give('posy', 'mushroom'); s.deliver('posy'); s.caught('trout', 6); s.visited('pond', 6); s.event('ship');
    return { all, rq };
  });
});

test('robust: onboarding loads any stored value', () => {
  const st = port(null);
  const o = createOnboarding(st, { now });
  o.begin(); o.signal('talk'); o.want('basket'); o.nextHint(false);
  fuzz('onboarding', st.saved, (raw) => {
    const s = createOnboarding(port(raw), { now, autostart: true, tips: true });
    s.signal('forage'); s.settle({ asks: 1 }); s.nextHint(false); s.fold(true);
    return s.data();
  });
});

test('robust: the stamp book loads any stored value', () => {
  const st = port(null);
  const b = createStamps(st, {}, now);
  b.devFill(12); b.event('ship', { demo: false, hour: 10 });
  fuzz('stamps', st.saved, (raw) => {
    const s = createStamps(port(raw), {}, now);
    s.event('photo', { demo: false, hour: 3 });
    const v = s.view();
    return { earned: v.earned, total: v.total, bits: v.bits, entries: v.entries.map((e) => e.progress ?? null) };
  });
});

test('robust: the pet loads any stored value', () => {
  const st = port(null);
  const p = createPetModel(st, { now });
  p.adopt('puppy', 'golden', 'Pip', { fernHearts: 10, coins: 0, free: true }); p.act('pet' as never); p.walked(120);
  fuzz('pet', st.saved, (raw) => {
    const s = createPetModel(port(raw), { now: () => NOW + 86_400_000 * 3 });
    s.tick(); s.act('fetch' as never); s.walked(30); s.rename('Pip 🐶');
    return s.data();
  });
});

test('robust: the gazette loads any stored value', () => {
  const st = port(null);
  const g = createGazette(st, now);
  const facts = gatherFacts(demoInput('weekly', NOW, demoAlmanac(NOW), [{ id: 'a', tag: 'app', name: 'flint' }]));
  g.file(facts);
  g.note({ k: 'gift', at: NOW - 1000, who: 'villager:hazel', item: 'hazelnut', tier: 'love' });
  g.note({ k: 'catch', at: NOW - 2000, item: 'pike', cm: 70 });
  fuzz('gazette', st.saved, (raw) => {
    const s = createGazette(port(raw), now);
    s.note({ k: 'find', at: NOW, item: 'acorn' });
    s.due();
    return s.data().issues.map((i) => composeIssue(i.facts));
  });
});
