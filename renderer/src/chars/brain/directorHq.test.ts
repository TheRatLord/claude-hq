// Full-office director + capacity (§6.4, §6.4.4, §6.5). Owner: BRN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../../world/layout/hq.ts';
import { createNav } from '../../world/nav/index.ts';
import { createDirector } from './director.ts';
import { allocateHomes, allocatePins, spiral, SPIRAL_PITCH } from './capacity.ts';
import { createPhaseTracker, PRIORS_S } from './phase.ts';
import { mulberry32 } from '../../../../shared/identity.ts';
import { ent, must } from './testkit.ts';
import type { Entity, Status } from '../../../../shared/protocol.ts';
import type { PhaseTracker } from './phase.ts';
import type { BrainEnv } from './brain.ts';
import type { Nav } from '../../world/nav/index.ts';

const nav = createNav(layout);
const NOW = 50 * 3600_000;
const director = createDirector(layout, nav);
const plan = director.plan;
const STATUSES: Status[] = ['idle', 'working', 'blocked', 'done', 'unknown'];

/** N entities in a seeded status mix; `force` makes a block of them blocked / done / shells. */
function mix(N: number, seed: number, force: 'blocked' | 'done' | 'shell' | null = null): Entity[] {
  const r = mulberry32(seed);
  const wsN = 1 + Math.floor(r() * Math.min(9, Math.max(1, N / 3)));
  const out: Entity[] = [];
  for (let i = 0; i < N; i++) {
    const ws = Math.floor(r() * wsN);
    const shell = force === 'shell' ? true : r() < 0.2;
    let status = STATUSES[Math.floor(r() * STATUSES.length)];
    if (force === 'blocked') status = 'blocked';
    if (force === 'done') status = 'done';
    out.push(ent({
      i: 1000 + i, kind: shell ? 'shell' : 'claude', status: shell ? 'unknown' : status,
      statusSince: NOW - Math.floor(r() * 600_000) - (status === 'blocked' ? 11_000 : 0),
      ack: status === 'done' && r() < 0.2 ? { at: 1, by: 'hq' } : null,
      workspace: { id: `w${ws}`, slot: ws, colorIndex: ws % 8 }, tab: { index: Math.floor(r() * 3) }, paneIndex: Math.floor(r() * 3),
    }));
  }
  return out;
}

function check(ents: Entity[], label: string) {
  const { home } = allocateHomes(ents, plan);
  const { pins } = allocatePins(ents, plan, NOW, 10_000);
  for (const e of ents) assert.ok(home.get(e.id), `${label}: ${e.id} (${e.kind}) has a home`);
  const homes = [...home.values()].map((s) => s.id);
  assert.equal(new Set(homes).size, homes.length, `${label}: no home double-booked`);
  const pinIds = [...pins.values()].map((s) => s.id);
  assert.equal(new Set(pinIds).size, pinIds.length, `${label}: no pin double-booked`);
  for (const p of pinIds) assert.ok(!homes.includes(p), `${label}: pin ${p} is nobody's home`);
  // deterministic: same input (any order) → same output
  const again = allocateHomes([...ents].reverse(), plan);
  for (const [id, s] of home) assert.equal(must(again.home.get(id)).id, s.id, `${label}: ${id} deterministic`);
  return { home, pins };
}

test('§6.4.4: N ∈ {1, 12, 40, 60} × 200 seeded mixes (incl. 60 blocked / 60 done / 60 shells): one home each, no double booking, deterministic', () => {
  let k = 0;
  for (const N of [1, 12, 40, 60]) {
    for (let s = 0; s < 50; s++) check(mix(N, 7 + s * 13 + N), `N${N}/s${s}`), k++;
  }
  for (const f of ['blocked', 'done', 'shell'] as const) check(mix(60, 99, f), `60 ${f}`), k++;
  assert.ok(k >= 200);
  // 60 blocked: 10 lane + 6 rug pinned, the rest wait at their desks ("queue full")
  const bl = mix(60, 99, 'blocked');
  const p = allocatePins(bl, plan, NOW, 10_000);
  assert.equal(p.pins.size, 16);
  assert.equal(p.queueFull.length, bl.filter((e) => e.kind !== 'shell').length - 16);
  // 60 done (unacked): Pit seats 24 → Pit floor spiral → atrium spiral
  const dn = mix(60, 99, 'done').map((e) => ({ ...e, ack: null }));
  const pd = allocatePins(dn, plan, NOW, 10_000);
  const doneN = dn.filter((e) => e.kind !== 'shell').length;
  assert.equal(pd.pins.size, Math.min(doneN, 24 + plan.pitSpiral.length + plan.atriumSpiral.length));
});

test('bays: BAY_ORDER by workspace.slot, desks in (tab, pane) order, annex for > 6, slot ≥ 6 → a free bay', () => {
  const es: Entity[] = [];
  // ws0 (slot 0) has 8 agents → E3 + annex; ws1 slot 1 → E2; ws7 slot 7 → the first free bay (E1, [BRN fix r2])
  for (let i = 0; i < 8; i++) es.push(ent({ i: 2000 + i, workspace: { id: 'a', slot: 0 }, tab: { index: i >> 1 }, paneIndex: i & 1 }));
  for (let i = 0; i < 3; i++) es.push(ent({ i: 2100 + i, workspace: { id: 'b', slot: 1 }, tab: { index: 0 }, paneIndex: i }));
  es.push(ent({ i: 2200, workspace: { id: 'c', slot: 7 } }));
  es.push(ent({ i: 2300, kind: 'shell', status: 'unknown', workspace: { id: 'b', slot: 1 } }));
  const { home, bayOf, wsBays } = allocateHomes(es, plan);
  assert.equal(must(wsBays.get('a'))[0], 'E3');
  assert.equal(must(wsBays.get('a')).length, 2, 'annex');
  assert.notEqual(must(wsBays.get('a'))[1], 'E2', 'the annex never takes an owned bay');
  assert.equal(must(wsBays.get('b'))[0], 'E2');
  assert.equal(must(home.get('d1:p2000')).id, layout.bays[0].desks[0], 'first tab, first pane → first desk');
  assert.equal(bayOf.get('d1:p2100'), 'E2');
  assert.equal(bayOf.get('d1:p2200'), 'E1', 'slot 7: the first free bay in BAY_ORDER');
  assert.notEqual(must(wsBays.get('a'))[1], 'E1', 'the annex never takes a bay a whole workspace holds');
  assert.equal(must(home.get('d1:p2300')).tag, 'shellBench');
  // sticky: a pane leaving never moves the others
  const prev = new Map([...home].map(([k, v]) => [k, v.id]));
  const fewer = es.filter((e) => e.id !== 'd1:p2001');
  const h2 = allocateHomes(fewer, plan, prev).home;
  for (const e of fewer) assert.equal(must(h2.get(e.id)).id, prev.get(e.id), `${e.id} stays`);
});

test('bays after churn (review r2): live slots {7, 17, 21} and 6 free bays → 3 bays, no overflow; sticky; a returning workspace', () => {
  const es = [7, 17, 21].flatMap((slot) => [0, 1].map((k) => ent({ i: 3000 + slot * 10 + k, workspace: { id: `s${slot}`, slot }, tab: { index: 0 }, paneIndex: k })));
  const r = allocateHomes(es, plan);
  assert.equal(new Set(r.bayOf.values()).size, 3, JSON.stringify(Object.fromEntries(r.bayOf)));
  assert.equal(r.overflowUsed, 0);
  assert.deepEqual([...r.wsBays.values()].map((b) => b[0]), ['E3', 'E2', 'E1'], 'slot order, E bays first');
  // sticky: slot 5 arrives (its own bay W1 is free: takes it) and slot 0 returns while s7 holds E3 → the nearest free bay
  const prev = new Map([...r.home].map(([k, v]) => [k, v.id]));
  const more = [...es, ent({ i: 3500, workspace: { id: 's5', slot: 5 } }), ent({ i: 3600, workspace: { id: 's0', slot: 0 } })];
  const r2 = allocateHomes(more, plan, prev, r.wsState);
  for (const e of es) assert.equal(must(r2.home.get(e.id)).id, prev.get(e.id), `${e.id} keeps its desk`);
  assert.equal(r2.bayOf.get('d1:p3500'), 'W1');
  assert.ok(['W3', 'W2'].includes(must(r2.bayOf.get('d1:p3600'))), `returning slot 0 → ${r2.bayOf.get('d1:p3600')}`);
  assert.equal(r2.overflowUsed, 0);
  // once its bay frees up (s7 leaves for good), the returning workspace's bay is its own again on the next churn
  const r3 = allocateHomes(more.filter((e) => e.workspace.id !== 's7'), plan, new Map(), null);
  assert.equal(r3.bayOf.get('d1:p3600'), 'E3');
  // seven live workspaces: the seventh overflows to the mezzanine hot desks
  const seven = [0, 1, 2, 3, 4, 5, 9].map((slot) => ent({ i: 3700 + slot, workspace: { id: `h${slot}`, slot } }));
  const r4 = allocateHomes(seven, plan);
  assert.equal(must(r4.home.get('d1:p3709')).tag, 'hotdesk');
  assert.equal(r4.overflowUsed, 1);
});

test('overflow spirals: body pitch (≥ 0.92 m), never in a keep-clear rect or the queue lane, on open floor', () => {
  const all = [plan.cushions, plan.engSpiral, plan.pitSpiral, plan.atriumSpiral];
  for (const list of all) {
    assert.ok(list.length >= 12, `${list[0]?.tag}: ${list.length} spots`);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      assert.ok(Math.hypot(list[i].pos.x - list[j].pos.x, list[i].pos.z - list[j].pos.z) >= 0.72 + 0.2, `${list[i].id}/${list[j].id}`);
    }
    for (const s of list) {
      for (const k of layout.keepClear.filter((q) => !q.headSlotOnly)) assert.ok(!(s.pos.x >= k.x0 && s.pos.x <= k.x1 && s.pos.z >= k.z0 && s.pos.z <= k.z1), `${s.id} in ${k.id}`);
      assert.ok(nav.walkable(s.pos.x, s.pos.z, s.level), `${s.id} on open floor`);
    }
  }
  const pts = spiral({ x: 0, z: 0 }, 20, () => true);
  assert.equal(pts.length, 20);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) >= SPIRAL_PITCH - 1e-6);
});

test('a full queue (10 + 6) standing still leaves every bay desk a route to the entrance and the Pit (§7.1 nav invariant)', () => {
  const obstacles = [...plan.queue, ...plan.queueOverflow].map((s) => ({ x: s.pos.x, z: s.pos.z, r: 0.32, level: 0 }));
  const blockedNav = createNav(layout, { obstacles });
  const ent0 = layout.points.entrance, pit = layout.points.pitSouthGap;
  for (const b of layout.bays) {
    for (const id of b.desks) {
      const s = must(layout.slots.find((q) => q.id === id));
      const ap = director.approach(s);
      assert.ok(blockedNav.route(ap, { x: ent0.x, z: ent0.z, level: 0 }, { owner: b.id }), `${id} → entrance`);
      assert.ok(blockedNav.route(ap, { x: pit.x, z: pit.z, level: 0 }, { owner: b.id }), `${id} → Pit`);
    }
  }
});

test('director: stations reserve without double booking; routes change level through the stairs / slide; path lengths', () => {
  const d = createDirector(layout, nav);
  const es = new Map();
  for (let i = 0; i < 12; i++) { const e = ent({ i: 3000 + i, status: 'working', workspace: { id: `w${i % 3}`, slot: i % 3 }, tab: { index: 0 }, paneIndex: i >> 2 }); es.set(e.id, e); }
  d.update(es, NOW);
  const ids = [...es.keys()];
  const got = ids.flatMap((id) => { const s = d.reserveStation(id, 'lab'); return s ? [s] : []; });
  assert.equal(got.length, 4, 'the Lab has 4 benches');
  assert.equal(new Set(got.map((s) => s.id)).size, 4);
  for (const id of ids) d.unclaim(id);
  // E-bay → Library / Lab ≈ ≤ 12 s at 2.0 m/s (§11 M1.5; the octile grid metric runs ≈ 5–10 % over walktimes' pulled paths)
  for (const id of ids) {
    assert.ok(d.travelS(id, 'library') <= 13.5, `${id} library ${d.travelS(id, 'library')}`);
    assert.ok(d.travelS(id, 'lab') <= 13.5, `${id} lab ${d.travelS(id, 'lab')}`);
    assert.ok(Number.isFinite(d.travelS(id, 'roundtable')), 'mezzanine reachable');
  }
  // up to the Round Table: the route climbs the stairs; back down via the slide when asked
  const id = ids[0], home = must(d.slotFor(id)), rt = must(layout.slots.find((s) => s.tag === 'station:roundtable'));
  const up = must(d.route(d.approach(home), d.approach(rt), { actorId: id }));
  assert.ok(up.some((p) => p.portal === 'stairs') && up.at(-1)?.level === 1, 'stairs up');
  const down = must(d.route(d.approach(rt), d.approach(home), { actorId: id, via: 'slide' }));
  assert.ok(down.some((p) => p.portal === 'slide') && down.at(-1)?.level === 0, 'slide down');
  const stairsDown = must(d.route(d.approach(rt), d.approach(home), { actorId: id, via: 'stairs' }));
  assert.ok(stairsDown.some((p) => p.portal === 'stairs') && !stairsDown.some((p) => p.portal === 'slide'), 'stairs down');
  // private back doors: the owner's route to the atrium is shorter than a stranger's
  const eHome = must(d.approach(d.slotFor(id))), pitGap = { ...layout.points.pitSouthGap, level: 0 };
  assert.ok(d.pathLen(eHome, pitGap, id) < d.pathLen(eHome, pitGap, null) - 2, 'back door');
});

test('phase tracker (§6.5): interjections never trigger, dominance at ≥ 60 %, the 2× rule, cooldown', () => {
  const tr = createPhaseTracker();
  let now = 1e6;
  const feed = (cls: Parameters<PhaseTracker['sample']>[0], s: number) => { for (let i = 0; i < s; i++) { now += 1000; tr.sample(cls, now); } };
  feed('edit', 30);
  feed('read', 3);
  assert.equal(tr.key(), null, 'a 3 s Read inside edits');
  feed('read', 30);
  assert.equal(tr.key(), 'read');
  // [BRN fix m2-r1] walk budget: a fresh actor (< minWorkS worked) settles in before any trip
  assert.ok(!tr.worthTrip(5, now), 'walk budget: nothing banked');
  tr.account(120, false);
  assert.ok(tr.worthTrip(5, now), 'E 45 s − elapsed ≫ 2 × 5 s');
  assert.ok(!tr.worthTrip(20, now), '2 × 20 s > remaining');
  tr.visitEnded(now);
  assert.ok(!tr.worthTrip(1, now + 1000), 'cooldown');
  assert.ok(tr.worthTrip(1, now + 1000, true), 'chaining skips the cooldown');
  feed('edit', 40);
  assert.equal(tr.key(), null, 'phase ends when its share stays < 40 % for 10 s');
  assert.notEqual(tr.expectS('read'), PRIORS_S.read, 'EMA learns from the completed phase');
  // the budget is a share: after walking a lot while working, even a worthwhile trip waits
  const t2 = createPhaseTracker();
  let n2 = 1e6;
  for (let i = 0; i < 40; i++) { n2 += 1000; t2.sample('read', n2); }
  t2.account(100, false);
  assert.ok(t2.worthTrip(2, n2), 'budget ok: 0 + 4 ≤ 0.3 × (100 + remaining)');
  t2.account(60, true);
  assert.ok(!t2.worthTrip(2, n2), 'budget spent: 60 + 4 > 0.3 × (160 + remaining)');
});

test('help queue is sticky: a newcomer with an older statusSince joins at the back (no two actors on queue:0)', () => {
  const d = createDirector(layout, nav);
  const flint = ent({ i: 1, status: 'blocked', statusSince: NOW - 20_000, workspace: { id: 'w0', slot: 0 } });
  const idle = ent({ i: 2, status: 'working', statusSince: NOW - 90_000, workspace: { id: 'w1', slot: 1 } });
  const ents = new Map([[flint.id, flint], [idle.id, idle]]);
  d.update(ents, NOW);
  const q0 = d.pinFor(flint.id);
  assert.equal(q0?.tag, 'queue');
  // forced blocked with an old statusSince (debug force / re-seeded since): must not cut in front of flint
  ents.set(idle.id, { ...idle, status: 'blocked', statusSince: NOW - 60_000 });
  d.update(ents, NOW + 1000);
  assert.equal(d.pinFor(flint.id)?.id, q0.id, 'flint keeps its place');
  const q1 = d.pinFor(idle.id);
  assert.ok(q1 && q1.id !== q0.id, `newcomer gets the next index (${q1?.id})`);
  // the head is served: everyone moves up
  ents.set(flint.id, { ...flint, status: 'working', statusSince: NOW + 2000 });
  d.update(ents, NOW + 3000);
  assert.equal(d.pinFor(idle.id)?.id, q0.id);
  // a cold start (a second window) orders by statusSince alone
  const pins = allocatePins([...ents.values()], plan, NOW + 3000, 10_000);
  assert.equal(pins.pins.get(idle.id)?.id, q0.id);
});

// Code review r2: routeAround built a fresh nav (buildGrid + inflate of the whole office) per 0.25 m player cell and
// searched outside the §5.3 budget (6.8 ms of nav in one frame on crowd40 with the player in the crowd).
test('routeAround: no grid builds after warm-up, ≤ searchesPerFrame searches a frame, PENDING when spent', () => {
  const base = createNav(layout, { searchesPerFrame: 2 });
  const grids = new Set<ReturnType<Nav['gridFor']>>();
  const counting: Nav = { ...base, gridFor: (...a: Parameters<Nav['gridFor']>) => { const g = base.gridFor(...a); grids.add(g); return g; } };
  const d = createDirector(layout, counting);
  const es = [0, 1, 2].map((s) => ent({ i: 4000 + s, workspace: { id: `r${s}`, slot: s } }));
  d.update(new Map(es.map((e) => [e.id, e])), NOW);
  const desk = (e: Entity) => must(d.approach(d.slotFor(e.id)));
  const far = { x: 0, z: 0, level: 0 }; // the Pit: a route that needs a search from every desk
  const player = (k: number) => ({ x: -5.5 + (k % 7) * 0.3, z: -3 + (k % 5) * 0.4 }); // the player wanders the atrium edge
  // warm-up: every (level, owner) scratch grid this test touches
  for (const e of es) { base.frame(); d.routeAround(desk(e), far, player(0), { actorId: e.id }); }
  const g0 = grids.size, s0 = d.aroundStats().scratchGrids;
  let got = 0, pending = 0, t0 = performance.now();
  for (let k = 0; k < 60; k++) {
    base.frame();
    for (const e of es) {
      const q = d.routeAround(desk(e), far, player(k), { actorId: e.id });
      if (q === undefined) pending++; else if (q) got++;
    }
    assert.ok(base.budgetStats().searches <= 2, `frame ${k}: ${base.budgetStats().searches} searches`);
  }
  const ms = performance.now() - t0;
  assert.equal(grids.size, g0, 'no new nav grids after warm-up');
  assert.equal(d.aroundStats().scratchGrids, s0, 'scratch grids reused');
  assert.ok(pending > 0, 'three walkers, two searches a frame: someone waits');
  assert.ok(got > 60, `routes found (${got})`);
  assert.ok(ms / 180 < 3, `≈ ${(ms / 180).toFixed(2)} ms a call`);
  // the route keeps clear of the player
  base.frame();
  const p = player(3), q = d.routeAround(desk(es[0]), far, p, { actorId: es[0].id });
  assert.ok(q && q.length >= 2);
});

test('[BRN fix r3] homes rebuild only when an allocation input changes (no per-frame key string)', () => {
  const d = createDirector(layout, nav);
  const ents = new Map(mix(40, 7).map((e): [string, Entity] => [e.id, e]));
  const builds = () => Number(d.debug().homeBuilds);
  d.update(ents, NOW);
  const b0 = builds();
  const v0 = d.version();
  for (let f = 1; f <= 60; f++) d.update(ents, NOW + f * 16);
  assert.equal(builds(), b0, 'steady-state frames skip the rebuild');
  const [id, e] = [...ents][3];
  ents.set(id, { ...e, status: 'working', activity: { tool: 'Read', cls: 'read', detail: '', since: NOW } }); // a status patch: same seat
  d.update(ents, NOW + 1000);
  assert.equal(builds(), b0, 'a patch outside the allocation inputs keeps the homes');
  assert.equal(d.version(), v0);
  ents.set(id, { ...must(ents.get(id)), paneIndex: 9 });
  d.update(ents, NOW + 1100);
  assert.equal(builds(), b0 + 1, 'a pane move rebuilds once');
  d.update(ents, NOW + 1116);
  assert.equal(builds(), b0 + 1);
  ents.delete(id);
  d.update(ents, NOW + 1200);
  assert.equal(builds(), b0 + 2, 'gone rebuilds');
  assert.equal(d.slotFor(id), null);
  ents.set(id, e);
  d.update(ents, NOW + 1300);
  assert.equal(builds(), b0 + 3, 'add rebuilds');
  ents.set(id, { ...e, kind: e.kind === 'shell' ? 'claude' : 'shell' });
  d.update(ents, NOW + 1400);
  assert.equal(builds(), b0 + 4, 'kind class change rebuilds');
  d.forget(id);
  d.update(ents, NOW + 1500);
  assert.equal(builds(), b0 + 5, 'forget forces a rebuild');
  assert.ok(d.slotFor(id));
});

// [BRN fix m3-r2] (fun review m3-r2) personal space + the hero Pit: no new seat / spot / Pit place within
// TUNING.personalR of the player; a done agent keeps its Pit seat when another leaves (tinker slid into the seat next to
// the camera after gale's sign-off); the Pit's first seats face pitOverview (the far arc); no casual spot in a view cone.
test('m3-r2 personal space, sticky Pit seats, far arc first, view cones', async () => {
  const { TUNING } = await import('./tuning.ts');
  const { inViewCone } = await import('../../world/nav/grid.ts');
  const d = createDirector(layout, createNav(layout));
  // far arc first: the first 6 Pit places face the pitOverview lens
  const v = must(layout.keepClearViews.find((q) => q.id === 'pitOverview'));
  d.plan.pit.slice(0, 6).forEach((s, k) => {
    const dx = v.x - s.pos.x, dz = v.z - s.pos.z;
    assert.ok((-Math.sin(s.yaw) * dx - Math.cos(s.yaw) * dz) / Math.hypot(dx, dz) > (k < 4 ? 0.4 : 0.1), `${s.id} faces pitOverview`);
  });
  // sticky + personal space: 3 done agents; the player sits down next to the 2nd seat; the first leaves
  const ds = [0, 1, 2].map((k) => ent({ i: 7700 + k, status: 'done', statusSince: NOW - 60_000 + k * 1000, workspace: { id: 'w', slot: 0 } }));
  const m = new Map(ds.map((e) => [e.id, e]));
  d.update(m, NOW);
  const seat = (e: Entity) => d.pinFor(e.id)?.id;
  const before = ds.map(seat);
  assert.deepEqual(before, d.plan.pit.slice(0, 3).map((s) => s.id));
  const s3 = d.plan.pit[3];
  d.setPlayer({ x: s3.pos.x + 0.3, z: s3.pos.z, level: 0 }); // the player at the 4th seat's elbow
  m.delete(ds[0].id);
  d.update(m, NOW + 1000);
  assert.equal(seat(ds[1]), before[1], 'keeps its seat when another leaves');
  assert.equal(seat(ds[2]), before[2]);
  const nu = ent({ i: 7710, status: 'done', statusSince: NOW + 500, workspace: { id: 'w', slot: 0 } });
  m.set(nu.id, nu);
  d.update(m, NOW + 2000);
  assert.equal(seat(nu), before[0], 'a newcomer takes the free far seat');
  const nu2 = ent({ i: 7711, status: 'done', statusSince: NOW + 600, workspace: { id: 'w', slot: 0 } });
  m.set(nu2.id, nu2);
  d.update(m, NOW + 3000);
  assert.notEqual(seat(nu2), s3.id, 'never the seat at the player\'s elbow');
  // casual claims: none within personalR of the player, none in a view cone
  for (const tag of ['pitLounge', 'caf', 'libRead', 'coffee', 'window', 'plant', 'fish']) {
    for (const s of d.spotsOf(tag)) {
      d.setPlayer({ x: s.pos.x, z: s.pos.z + 0.5, level: s.level ?? 0 });
      const near = { x: s.pos.x, z: s.pos.z, level: s.level ?? 0 };
      const got = d.claim('probe', tag, near);
      if (got) {
        assert.ok(Math.hypot(got.pos.x - s.pos.x, got.pos.z - s.pos.z - 0.5) >= TUNING.personalR - 1e-6, `${tag}: ${got.id} at the player's elbow`);
        for (const w of layout.keepClearViews) assert.ok((w.level ?? 0) !== (got.level ?? 0) || !inViewCone(w, got.pos.x, got.pos.z, 2.99), `${tag}: ${got.id} in ${w.id}'s cone`);
      }
      d.unclaim('probe');
    }
  }
  d.setPlayer(null);
});

// [BRN fix m3-r2] (fun review m3-r2) the sign-off celebration: after G on a done agent it holds its place facing the
// player until the ack commits, then beams '✓ thanks!' for TUNING.celebS, then its parcel run first steps away from the
// camera; a summoned / attending agent never comes closer than TUNING.attendMinR.
test('m3-r2 sign-off celebration in frame, exit away from the camera; summon stops ≥ attendMinR', async () => {
  const { TUNING: T } = await import('./tuning.ts');
  const { createBrain } = await import('./brain.ts');
  const d = createDirector(layout, createNav(layout));
  const e0 = ent({ i: 7800, status: 'done', statusSince: NOW - 120_000, workspace: { id: 'w', slot: 0 } });
  const m = new Map([[e0.id, e0]]);
  d.update(m, NOW);
  const b = createBrain(e0.id, { director: d, seedKey: e0.seedKey });
  const pin = must(d.pinFor(e0.id));
  const me = { x: pin.pos.x, z: pin.pos.z };
  const pl = { pos: { x: me.x + 2.2, y: 0, z: me.z }, dist: 2.2, inFront: true };
  const E = (t: number, o: Partial<BrainEnv['self']> = {}): BrainEnv => ({ t, self: { pos: { ...me, y: 0 }, yaw: 0, settledAt: pin.id, moving: false, level: 0, ...o }, player: pl, playerLevel: 0, aimed: true,
    neighbours: [], partner: () => null, invite: () => false });
  let i = b.update(e0, NOW, E(0));
  i = b.update(e0, NOW + 100, E(0.1));
  assert.equal(b.verb('highFive', E(0.2)), 'highFive');
  // the ack arrives 0.3 s later; the status commits 1.5 s after that (hysteresis): it stays in its seat, facing the player
  const acked: Entity = { ...e0, ack: { at: NOW + 500, by: 'hq' } };
  let tt = 0.5, t1 = -1, lastCeleb = -1;
  for (; tt < 6; tt += 0.1) {
    i = b.update(acked, NOW + tt * 1000, E(tt));
    if (i.phase !== 'celebrate' && t1 >= 0) break;
    assert.equal(must(i.slot).id, pin.id, `holds its place at ${tt.toFixed(1)} s`);
    assert.ok(i.look && Math.hypot(i.look.x - pl.pos.x, i.look.z - pl.pos.z) < 1e-6, 'faces the player');
    if (b.state.status === 'idle') {
      if (t1 < 0) t1 = tt;
      assert.equal(i.phase, 'celebrate');
      assert.equal(i.bubble?.title, 'thanks!');
      lastCeleb = tt;
    }
  }
  assert.ok(t1 > 0 && t1 < 2.5, `the sign-off committed (${t1})`);
  assert.ok(lastCeleb - t1 >= T.celebS - 0.15, `the beat lasts ~${T.celebS} s (${(lastCeleb - t1).toFixed(1)})`);
  // then the parcel run: its first leg leads away from the player
  i = b.update(acked, NOW + tt * 1000, E(tt, { settledAt: null }));
  assert.equal(i.phase, 'parcelRun');
  const away = must(i.slot).pos;
  assert.ok(Math.hypot(away.x - pl.pos.x, away.z - pl.pos.z) > Math.hypot(me.x - pl.pos.x, me.z - pl.pos.z) + 1.5, 'first steps away from the camera');
  // summon: with the player 1.0 m off mid-walk, it stops at ≥ attendMinR
  const e1 = ent({ i: 7801, status: 'idle', statusSince: NOW - 600_000, workspace: { id: 'w', slot: 0 } });
  m.set(e1.id, e1); d.update(m, NOW);
  const b1 = createBrain(e1.id, { director: d, seedKey: e1.seedKey });
  const p1 = { x: 0, z: 6.5 }, pl1 = { pos: { x: p1.x, y: 0, z: p1.z + 1.0 }, dist: 1.0, inFront: true };
  const E1 = (t: number): BrainEnv => ({ t, self: { pos: { ...p1, y: 0 }, yaw: 0, settledAt: null, moving: true, level: 0 }, player: pl1, playerLevel: 0,
    neighbours: [], partner: () => null, invite: () => false });
  b1.update(e1, NOW, E1(0));
  assert.equal(b1.verb('summon', E1(0.1)), 'come');
  const i1 = b1.update(e1, NOW + 200, E1(0.2));
  assert.ok(Math.hypot(must(i1.slot).pos.x - pl1.pos.x, must(i1.slot).pos.z - pl1.pos.z) >= T.attendMinR - 1e-6, `summon stand ${JSON.stringify(i1.slot?.pos)}`);
});
