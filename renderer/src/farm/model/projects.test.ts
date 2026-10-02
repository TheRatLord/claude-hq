import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAMPIONS, ITEM_GROUPS, PROJECTS, PROJECT_IDS, WORK_KINDS, countWork, createProjects, emptyProjects, fitting, groupItems, inGroup,
  needsOf, parseProjects, projectDef, projectLetter, projectsView, statusOf,
} from './projects.ts';
import type { ProjectsData, ProjectsWorld } from './projects.ts';
import { CATALOG, collectDef } from './collection.ts';
import { HEART, FRIEND_IDS } from './friends.ts';

const T0 = new Date(2026, 9, 2, 12).getTime();
const DAY = 86_400_000;
const port = (v: unknown = null) => { let saved: unknown = v; return { load: () => saved, save: (d: unknown) => { saved = JSON.parse(JSON.stringify(d)); }, get saved() { return saved; } }; };
const hearts = (n: number): ProjectsWorld['friends'] => ({ pts: Object.fromEntries(FRIEND_IDS.map((f) => [f, n * HEART])) });

/** a purse and a basket the board can spend from */
function pockets(coins = 0, basket: Record<string, number> = {}) {
  const p = { coins, basket: { ...basket } };
  return {
    p,
    ports: {
      spend: (c: number) => { if (c > p.coins) return false; p.coins -= c; return true; },
      take: (id: string, n: number) => { const have = p.basket[id] ?? 0; const got = Math.min(have, n); p.basket[id] = have - got; return got; },
      stash: (id: string, n: number) => { p.basket[id] = (p.basket[id] ?? 0) + n; },
    },
  };
}

test('projects: six of them, unique ids, a tree that ends at the halt, every need sensible', () => {
  assert.equal(PROJECTS.length, 6);
  assert.deepEqual(PROJECTS.map((p) => p.id), [...PROJECT_IDS]);
  for (const p of PROJECTS) {
    assert.ok(p.title.length > 8 && p.blurb.length > 60 && p.done.length > 30 && p.unlock.length > 10 && p.where.length > 10, p.id);
    assert.ok(p.bits > 0 && p.items.length > 0 && Object.keys(p.work).length > 0 && p.hearts > 0, `${p.id} needs a mix`);
    for (const a of p.after) assert.ok(PROJECTS.findIndex((x) => x.id === a) < PROJECTS.indexOf(p), `${p.id} waits for an earlier project`);
    for (const it of p.items) assert.ok(groupItems(it.group).length > 0, `${p.id}: ${it.group} accepts something`);
  }
  const m = emptyProjects();
  assert.deepEqual(PROJECTS.filter((p) => statusOf(m, p) === 'open').map((p) => p.id), ['lanterns', 'footbridge', 'glasshouse']);
  assert.equal(statusOf(m, projectDef('halt')!), 'locked');
  assert.ok(CHAMPIONS.length >= 5, 'most villagers champion one');
});

test('projects: item groups take the right finds (never barn produce or junk as fish)', () => {
  assert.ok(inGroup('forage', collectDef('morel')));
  assert.ok(!inGroup('forage', collectDef('egg')), 'barn produce is not forage');
  assert.ok(inGroup('fish', collectDef('carp')) && !inGroup('fish', collectDef('boot')));
  assert.ok(inGroup('boot', collectDef('boot')) && !inGroup('boot', collectDef('bottle')));
  assert.ok(inGroup('rare', collectDef('koi')) && !inGroup('rare', collectDef('minnow')) && !inGroup('rare', collectDef('bottle')));
  for (const g of ITEM_GROUPS) for (const id of groupItems(g)) assert.ok(CATALOG.some((d) => d.id === id));
  assert.deepEqual(fitting('fish', { carp: 1, minnow: 3, morel: 2, boot: 1 }).map((f) => f.id), ['minnow', 'carp']);
});

test('projects: paying bits and handing in items, capped at the need and the purse', () => {
  const k = pockets(100, { carp: 1, minnow: 2, morel: 3 });
  const st = port();
  const b = createProjects(st, k.ports, () => T0);
  const r1 = b.pay('footbridge', 30);
  assert.deepEqual(r1, { ok: true, n: 30 });
  assert.equal(k.p.coins, 70);
  assert.deepEqual(b.pay('footbridge'), { ok: false, reason: 'short' }, 'all 90 left is more than the purse: nothing taken');
  assert.equal(k.p.coins, 70);
  assert.deepEqual(b.pay('footbridge', 70), { ok: true, n: 70 });
  k.p.coins = 500;
  assert.deepEqual(b.pay('footbridge'), { ok: true, n: 20 }, 'only what is still needed');
  assert.deepEqual(b.pay('footbridge', 5), { ok: false, reason: 'full' });
  assert.deepEqual(b.give('footbridge', 'fish', 'morel'), { ok: false, reason: 'item' }, 'a mushroom is not a fish');
  assert.deepEqual(b.give('footbridge', 'fish', 'carp'), { ok: true, n: 1 });
  assert.deepEqual(b.give('footbridge', 'fish', 'carp'), { ok: false, reason: 'short' }, 'none left in the basket');
  assert.deepEqual(b.give('footbridge', 'fish', 'minnow', 5), { ok: true, n: 1 }, 'only one more fish needed');
  assert.equal(k.p.basket.minnow, 1);
  assert.deepEqual(b.give('footbridge', 'forage', 'morel'), { ok: false, reason: 'item' }, 'the footbridge wants no forage');
  assert.deepEqual(b.pay('halt', 10), { ok: false, reason: 'locked' });
  const saved = st.saved as ProjectsData;
  assert.equal(saved.p.footbridge?.bits, 120);
  assert.equal(saved.p.footbridge?.items.fish, 2);
  assert.deepEqual(saved.total, { bits: 120, items: 2 });
});

test('projects: real work counts toward open projects only, never in a demo valley', () => {
  const m = emptyProjects();
  assert.deepEqual(countWork(m, 'ship', true), [], 'a demo valley never counts');
  assert.deepEqual(countWork(m, 'ship', false), ['footbridge'], 'the mill needs commits too, but is still locked');
  for (let i = 0; i < 10; i++) countWork(m, 'ship', false);
  assert.equal(m.p.footbridge?.work.ship, 5, 'capped at the need');
  const b = createProjects(port(), {}, () => T0);
  b.event('celebrate', false);
  b.event('unblocked', false);
  b.event('oops', false);
  b.event('ship', true);
  assert.equal(b.data().p.glasshouse?.work.tests, 1);
  assert.equal(b.data().p.lanterns?.work.unblocked, 1);
  assert.equal(b.data().p.footbridge, undefined, 'the demo commit did not count');
});

test('projects: completing when every need is met, friendship read live; the next tier opens', () => {
  const k = pockets(10_000, { morel: 10, carp: 10 });
  let t = T0;
  const b = createProjects(port(), k.ports, () => t);
  const changes: string[] = [];
  b.onChange((c) => changes.push(c.kind === 'complete' || c.kind === 'unveil' ? `${c.kind}:${c.id}` : c.kind));
  b.pay('lanterns'); b.give('lanterns', 'forage', 'morel', 3);
  b.event('unblocked', false); b.event('unblocked', false);
  assert.deepEqual(b.check({ friends: hearts(1) }), [], 'Fern needs ♥2');
  assert.ok(b.view({ friends: hearts(1), coins: 0, basket: {} }).entries[0].needs.some((n) => n.kind === 'hearts' && n.have === 1));
  t += 1000;
  assert.deepEqual(b.check({ friends: hearts(2) }), ['lanterns']);
  assert.ok(changes.includes('complete:lanterns'));
  assert.equal(statusOf(b.data() as ProjectsData, projectDef('observatory')!), 'open', 'the observatory opens after the lanterns');
  assert.deepEqual(b.check({ friends: hearts(9) }), [], 'nothing else is ready');
  const v = b.view({ friends: hearts(0), coins: 0, basket: {} });
  const lan = v.entries.find((e) => e.def.id === 'lanterns')!;
  assert.equal(lan.status, 'done');
  assert.equal(lan.pending, true, 'not seen yet');
  assert.ok(lan.needs.every((n) => n.have >= n.need), 'a done project shows every need met, even if the hearts fell since');
  assert.equal(b.unveil('lanterns'), true);
  assert.equal(b.unveil('lanterns'), false, 'unveiled once');
  assert.equal(b.view().entries[0].pending, false);
  assert.ok(changes.includes('unveil:lanterns'));
});

test('projects: the view counts what you could give now, and progress', () => {
  const m = emptyProjects();
  const v0 = projectsView(m, { friends: null, coins: 0, basket: {} });
  assert.equal(v0.canGive, 0);
  assert.equal(v0.done, 0);
  assert.equal(v0.total, 6);
  const v1 = projectsView(m, { friends: null, coins: 5, basket: {} });
  assert.equal(v1.canGive, 3, 'bits fit every open project');
  const v2 = projectsView(m, { friends: null, coins: 0, basket: { carp: 1 } });
  assert.equal(v2.canGive, 1, 'a fish only fits the footbridge');
  m.p.footbridge = { bits: 60, items: {}, work: {}, done: 0, unveiled: 0 };
  const e = projectsView(m, null).entries.find((x) => x.def.id === 'footbridge')!;
  assert.ok(e.progress > 0.1 && e.progress < 0.2, String(e.progress));
  assert.equal(needsOf(projectDef('millwheel')!, m.p.footbridge, null).length, 6, 'bits, fish, boot, ship, finished, hearts');
});

test('projects: the glasshouse violet, once a day once restored', () => {
  const k = pockets();
  let t = T0;
  const b = createProjects(port(), k.ports, () => t);
  assert.equal(b.pick(), false, 'no glasshouse yet');
  b.devComplete('glasshouse');
  assert.equal(b.pick(), true);
  assert.equal(k.p.basket.violet, 1);
  assert.equal(b.picked(), true);
  assert.equal(b.pick(), false, 'once a day');
  t += DAY;
  assert.equal(b.picked(), false);
  assert.equal(b.pick(), true);
  assert.equal(k.p.basket.violet, 2);
});

test('projects: dev complete / reset, letters, persistence round trip and tolerant parsing', () => {
  const st = port();
  const b = createProjects(st, {}, () => T0);
  b.devComplete('footbridge', true);
  b.devComplete('millwheel');
  const again = createProjects(port(st.saved), {}, () => T0);
  assert.equal(again.data().p.footbridge?.done, T0);
  assert.equal(again.data().p.footbridge?.unveiled, T0);
  assert.equal(again.data().p.millwheel?.unveiled, 0);
  assert.equal(again.view().done, 2);
  const l = projectLetter(projectDef('millwheel')!, T0);
  assert.equal(l.from, 'villager:hazel');
  assert.ok(l.body.includes('wheel') && l.title.includes('restored'));
  b.devReset('millwheel');
  assert.equal(b.data().p.millwheel, undefined);
  b.devReset();
  assert.deepEqual(b.data(), emptyProjects());
  for (const raw of [null, 'x', 42, [], {}, { v: 2 }]) assert.equal(parseProjects(raw), null);
  const odd = parseProjects({ v: 1, p: { footbridge: { bits: 1e12, items: { fish: 99, rare: 3 }, work: { ship: -4, tests: 5 }, done: 'x', unveiled: 5 }, nope: { bits: 4 } }, picked: 'today', total: { bits: NaN } })!;
  assert.equal(odd.p.footbridge?.bits, 120, 'capped at the need');
  assert.deepEqual(odd.p.footbridge?.items, { fish: 2 }, 'only groups it needs');
  assert.deepEqual(odd.p.footbridge?.work, {}, 'negative dropped, unneeded kind dropped');
  assert.equal(odd.p.footbridge?.unveiled, 0, 'not unveiled before done');
  assert.equal(odd.picked, '');
  assert.equal((odd.p as Record<string, unknown>).nope, undefined);
  assert.deepEqual(odd.total, { bits: 0, items: 0 });
  for (const k of WORK_KINDS) assert.ok(typeof k === 'string');
});
