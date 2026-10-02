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
import { createGrotto } from './grotto.ts';
import { createOrchard } from './orchard.ts';
import { createGuide, emptyGuideWorld } from './guide.ts';
import { createTimeline, demoDay, keyMoments, rollDay, summarize } from './timeline.ts';
import { composeIssue, createGazette, demoInput, gatherFacts } from './gazette.ts';
import { createRecaps, demoRecaps, recapDiffQuery, recapHeadline, recapLine } from './recap.ts';
import { createProjects } from './projects.ts';
import { createVisitors, stockFor } from './visitors.ts';

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

test('robust: the harvest recaps load any stored value', () => {
  const git = { repo: 'app', branch: 'main', head: 'abc1234', dirty: 1, ahead: 0 };
  const recaps = demoRecaps({ id: 'a', tag: 'app', name: 'flint', title: 'Fix', git }, NOW);
  const o = { id: 'a', tag: 'app', name: 'flint', status: 'working' as const, title: 'Fix', said: 'ok', work: { since: NOW - 60_000, added: 3, removed: 1, files: 1 },
    usage: { day: '2026-10-02', tokens: 10, cost: 0.1 }, todos: [{ content: 'x', status: 'completed' as const }], git, context: 0.2, contextTokens: 10, model: 'Opus' };
  // a recorder with one open stretch and a history, as saved
  const live = createRecaps(port(null), { now: NOW });
  for (const r of recaps) live.put(r);
  live.observe([{ ...o, status: 'idle' }], NOW); live.observe([o], NOW + 1000); live.event('a', 'commit', NOW + 1500, { msg: 'm', sha: 'abc1234' }); live.flush();
  const sample = JSON.parse(JSON.stringify(live.data));
  fuzz('recaps', sample, (raw) => {
    const rc = createRecaps(port(raw), { now: NOW });
    rc.observe([o], NOW + 2000);
    rc.event('a', 'test-pass', NOW + 2500);
    const out = rc.observe([{ ...o, status: 'idle' }], NOW + 20_000 + 60_000);
    rc.observe([{ ...o, status: 'idle' }], NOW + 200_000);
    rc.flush();
    const list = rc.view.farmers.get('a') ?? [];
    return { list, out, copy: list.map((r) => [recapLine(r), recapHeadline(r), recapDiffQuery(r)]) };
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

test('robust: the hillside orchard loads any stored value', () => {
  const st = port(null);
  const o = createOrchard(st, now);
  o.shake(0, 'autumn'); o.shake(7, 'autumn'); o.takeHoney(1, 'summer'); o.pressed();
  fuzz('orchard', st.saved, (raw) => {
    const s = createOrchard(port(raw), () => NOW + 86_400_000 * 4);
    s.shake(0, 'autumn'); s.takeHoney(1, 'summer'); s.honeyIn(2, 'spring'); s.fruitLeft(5, 'summer');
    return s.data();
  });
});

test('robust: the grotto loads any stored value', () => {
  const st = port(null);
  const g = createGrotto(st, now);
  g.visit(); g.openChest(); g.readPage(); g.readPage();
  fuzz('grotto', st.saved, (raw) => {
    const x = createGrotto(port(raw), now);
    x.visit(); x.readPage(); x.openChest();
    return { ...x.data(), found: x.discovered(), open: x.chestOpen };
  });
});

test('robust: Fern\'s notebook loads any stored value', () => {
  const st = port(null);
  const g = createGuide(st, { now });
  g.update(emptyGuideWorld()); g.see('rowboat'); g.see('barn'); g.update(emptyGuideWorld()); g.read('rowboat'); g.news({ welcomed: true, keys: { notebook: 'O' } });
  fuzz('guide', st.saved, (raw) => {
    const s = createGuide(port(raw), { now });
    s.update(emptyGuideWorld()); s.see('skate'); s.update(emptyGuideWorld()); s.read('skate'); s.rumour('villager:fern', 1); s.news({ welcomed: true });
    return { data: s.data(), view: s.view().pages.map((p) => [p.found, p.fresh, p.notes]) };
  });
});

test('robust: the Valley Projects board loads any stored value', () => {
  const purse = { coins: 1000, basket: { trout: 5, morel: 5, boot: 1 } as Record<string, number> };
  const ports = {
    spend: (c: number) => { if (c > purse.coins) return false; purse.coins -= c; return true; },
    take: (id: string, n: number) => { const h = purse.basket[id] ?? 0, g = Math.min(h, n); purse.basket[id] = h - g; return g; },
    stash: (id: string, n: number) => { purse.basket[id] = (purse.basket[id] ?? 0) + n; },
  };
  const st = port(null);
  const b = createProjects(st, ports, now);
  b.pay('lanterns', 30); b.give('footbridge', 'fish', 'trout', 2); b.event('ship', false); b.event('unblocked', false); b.devComplete('glasshouse'); b.unveil('glasshouse'); b.pick();
  fuzz('projects', st.saved, (raw) => {
    const x = createProjects(port(raw), ports, now);
    x.pay('lanterns', 5); x.give('glasshouse', 'forage', 'morel'); x.event('celebrate', false); x.check({ friends: null }); x.unveil('lanterns'); x.pick();
    const v = x.view({ friends: null, coins: purse.coins, basket: purse.basket });
    return { data: x.data(), done: v.done, entries: v.entries.map((e) => [e.status, e.progress, e.ready]) };
  });
});

test('robust: the visitors load any stored value', () => {
  const purse = { coins: 5000 };
  const owned: Record<string, number> = {};
  const deps = {
    spend: (c: number) => { if (c > purse.coins) return false; purse.coins -= c; return true; },
    giftDecor: (id: string) => { owned[id] = (owned[id] ?? 0) + 1; return true; },
    stash: () => {}, coins: () => purse.coins, owned: (id: string) => owned[id] ?? 0, secretKnown: () => false, halt: () => true,
  };
  const day = '2026-10-03';
  const st = port(null);
  const v = createVisitors(st, deps, { now });
  for (const e of stockFor(day)) v.buy(e.def.id, day, true);
  v.buyPainting(day, 'pond', 'autumn', 1); v.arrived('merchant', day); v.met('painter'); v.deliver('2026-10-01', 'autumn', NOW);
  fuzz('visitors', st.saved, (raw) => {
    const x = createVisitors(port(raw), deps, { now });
    const stock = x.stock(day);
    x.buy(stock[0]?.def.id ?? 'lure', day, true); x.buyPainting('2026-10-04', 'barn', 'autumn', 1); x.arrived('postie', day); x.met('merchant'); x.deliver('2026-10-05', 'autumn', NOW);
    return { data: x.data(), stock: stock.map((e) => [e.def.id, e.price, e.lock]), boost: x.fishBoost(day), parcels: x.parcels().length, mapped: x.mapped('grotto') };
  });
});
