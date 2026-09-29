// social.ts: the office's multi-actor scenes (rallies + audience, high-fives on done, the Pit wave, Board huddles,
// coffee invites) cast only free idle agents, end with the scene, and keep the rally on one shared clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocial } from './social.ts';
import { SOCIAL } from './tuning.ts';
import { ent, must } from './testkit.ts';
import type { Furniture, Pose, Slot } from '../../world/layout/schema.ts';
import type { Gig, Lite, SocialDirector, SocialLayout } from './social.ts';
import type { BrainEnv } from './brain.ts';
import type { Entity } from '../../../../shared/protocol.ts';

const slot = (id: string, tag: string, x: number, z: number, yaw: number, pose: Pose = 'stand'): Slot => ({ id, tag, pos: { x, y: 0, z }, yaw, pose, level: 0 });
function office() {
  const layout: SocialLayout & { slots: Slot[] } = {
    slots: [slot('slot:pingpong:0', 'pingpong', 4.5, -4.55, Math.PI), slot('slot:pingpong:1', 'pingpong', 4.5, -2.25, 0),
      slot('slot:desk:A', 'desk', -8, 0, Math.PI / 2, 'sit'), slot('slot:coffee:0', 'coffee', 6.4, 8.25, 0)],
    furniture: [{ id: 'pingPong', type: 'pingPong', pos: { x: 4.5, y: 0, z: -3.4 }, yaw: 0, size: [0.85, 0.5, 1.5], solid: true }],
    points: { pitCenter: { x: 0, y: -0.45, z: 0 }, bigBoard: { x: 0, y: 4, z: 0 } },
    keepClear: [{ id: 'corridor', x0: -2, z0: 4.3, x1: 2, z1: 9 }],
    spawn: [0, 0, 12.5],
  };
  const holds = new Map<string, string>();
  const director: SocialDirector = {
    isHq: true, walkable: () => true,
    slotFor: (id: string) => (id === 'done1' ? layout.slots[2] : null),
    holds: (id: string, sid: string) => holds.get(sid) === id,
  };
  return { layout, director, holds, social: createSocial({ layout, director }) };
}
/** A cast member as the scenes read it (the fields social.ts reads; actors.ts fills the rest, so this is the fixture boundary). */
const lite = (id: string, x: number, z: number, o: Partial<Lite> = {}): Lite => ({ id, pos: { x, y: 0, z }, level: 0, moving: false, settledAt: null, bstatus: 'idle', phase: 'idleDesk', free: true, idleMs: 120_000, declined: 0, ...o } as Lite);

test('rally: two idle players at the table share one clock; the ball crosses; a miss scores a point and pokes the winner', () => {
  const { social } = office();
  const a = lite('a', 4.5, -4.55, { settledAt: 'slot:pingpong:0', free: false });
  const b = lite('b', 4.5, -2.25, { settledAt: 'slot:pingpong:1', free: false });
  let t = 10;
  const pokes: [string, string][] = [];
  const zs: number[] = [];
  for (let i = 0; i < 60 * 30; i++, t += 1 / 60) {
    social.update(t, [a, b]);
    social.pullPokes(t, (id, r) => pokes.push([id, r]));
    const ua = social.syncFor('a'), ub = social.syncFor('b');
    assert.ok(ua !== null && ub !== null, 'both players swing on the rally clock');
    if (social.ball.visible) zs.push(social.ball.z);
    assert.equal(social.rallyFor('a'), social.ball);
    assert.equal(social.rallyFor('x'), null);
  }
  const c = social.counts();
  assert.ok(c.rallies === 1 && c.rallyHits >= 15, JSON.stringify(c));
  assert.ok(c.points >= 1, 'somebody missed within 30 s');
  assert.ok(Math.min(...zs) < -3.9 && Math.max(...zs) > -2.9, 'the ball reaches both ends');
  assert.ok(pokes.some(([, r]) => r === 'hop'), 'the winner hops');
  // a player leaves (status change): the rally stops, nobody swings on the shared clock any more
  b.bstatus = 'working';
  social.update(t, [a, b]);
  assert.equal(social.syncFor('a'), null);
  assert.equal(social.counts().rally, null);
});

test('rally clock: a player swings through contact (u 0.42) exactly when the ball reaches it', () => {
  const { social } = office();
  const a = lite('a', 4.5, -4.55, { settledAt: 'slot:pingpong:0', free: false });
  const b = lite('b', 4.5, -2.25, { settledAt: 'slot:pingpong:1', free: false });
  let t = 5;
  social.update(t, [a, b]);
  const H = SOCIAL.rallyHalfS;
  t += 0.6 + 2 * H + 1e-3; // serve at +0.6; the server hits again at 2H
  social.update(t, [a, b]);
  const server = must(social.counts().rally).a;
  assert.ok(Math.abs(must(social.syncFor(server)) - 0.42) < 0.01, `server contact phase ${social.syncFor(server)}`);
  t += H; social.update(t, [a, b]);
  const recv = server === 'a' ? 'b' : 'a';
  assert.ok(Math.abs(must(social.syncFor(recv)) - 0.42) < 0.01, `receiver contact phase ${social.syncFor(recv)}`);
});

test('a lone player invites a free idle colleague; busy / fresh-idle / far agents are never cast', () => {
  const { social } = office();
  const lone = lite('lone', 4.5, -4.55, { settledAt: 'slot:pingpong:0', free: false });
  const busy = lite('busy', 3, -3, { bstatus: 'working', free: false });
  const fresh = lite('fresh', 3, -2, { idleMs: 5_000 });
  const far = lite('far', 40, 30);
  const ok = lite('ok', 1, -1);
  let got = null;
  for (let t = 1; t < 200 && !got; t += 0.25) { social.update(t, [lone, busy, fresh, far, ok]); got = social.gigFor('ok'); }
  assert.ok(got, 'the free idle colleague got the invite');
  assert.equal(got.kind, 'claim');
  assert.equal(got.tag, 'pingpong');
  for (const id of ['busy', 'fresh', 'far', 'lone']) assert.equal(social.gigFor(id), null, id);
});

test('honesty: a gig ends the frame its actor stops being idle, and when it declines the claim', () => {
  const { social } = office();
  const a = lite('a', 4.5, -4.55, { settledAt: 'slot:pingpong:0', free: false });
  const c = lite('c', 1, -1);
  let t = 1;
  for (; t < 200 && !social.gigFor('c'); t += 0.25) social.update(t, [a, c]);
  const g = social.gigFor('c');
  assert.ok(g);
  c.bstatus = 'blocked';
  social.update(t, [a, c]);
  assert.equal(social.gigFor('c'), null, 'blocked → the gig is gone');
});

test('high-five on done: the nearest free pod-mate trots to the desk; both high-five on arrival', () => {
  const { social } = office();
  const done = lite('done1', -8, 0, { status: 'done', bstatus: 'done', free: false, settledAt: 'slot:desk:A' });
  const mate = lite('mate', -8, 1.4, { idleMs: 1000 }); // fresh idle is fine for a pod-mate's high-five
  const worker = lite('worker', -8, -1.2, { bstatus: 'working', free: false });
  let t = 50;
  for (; t < 500; t += 10) { social.update(t, [done, mate, worker]); social.signal('finished', 'done1', t); if (social.gigFor('mate')) break; } // (85 % chance)
  const g = social.gigFor('mate');
  assert.equal(g?.kind, 'congrats');
  assert.ok(g);
  assert.equal(social.gigFor('worker'), null, 'working agents are never pulled away');
  assert.ok(Math.hypot(g.x + 8, g.z) < 1.3, 'beside the chair');
  // arrives
  mate.settledAt = `pt:congrats:${g.x.toFixed(2)},${g.z.toFixed(2)}`; mate.pos.x = g.x; mate.pos.z = g.z;
  social.update(t + 1, [done, mate, worker]);
  const pokes: string[] = [];
  social.pullPokes(t + 2, (id, r) => pokes.push(`${id}:${r}`));
  assert.deepEqual(pokes.sort(), ['done1:highFive', 'mate:highFive']);
});

test('Pit welcome wave: the seated done agents clap in turn, starting next to the newcomer; sleepers sleep', () => {
  const { social } = office();
  const ring = [0.5, 1.5, 2.5, 3.5, 4.5].map((a, i) => lite(`d${i}`, Math.sin(a) * 2.3, Math.cos(a) * 2.3, { bstatus: 'done', free: false, settledAt: `slot:sofa:${i}`, phase: i === 3 ? 'pitNap' : 'pit' }));
  const nu = lite('new', Math.sin(0.1) * 2.3, Math.cos(0.1) * 2.3, { bstatus: 'done', free: false, settledAt: 'slot:sofa:9' });
  const t = 20;
  social.update(t, [...ring, nu]);
  social.signal('pitArrive', 'new', t);
  const order: string[] = [];
  social.pullPokes(t + 5, (id) => order.push(id));
  assert.deepEqual(order, ['d0', 'd1', 'd2', 'd4']);
});

test('Board huddle: 2–3 free idle agents gather on the Pit rim (off the corridor), looking up at the Board', () => {
  const { social } = office();
  const ids = ['h1', 'h2', 'h3', 'h4'];
  const ls = ids.map((id, i) => lite(id, -6 + i, -6));
  social.update(100, ls);
  assert.deepEqual(social.stage('huddle').length, 3);
  const gs = ids.flatMap((id) => { const g = social.gigFor(id); return g ? [g] : []; });
  assert.equal(gs.length, 3);
  for (const g of gs) {
    assert.ok(Math.abs(Math.hypot(g.x, g.z) - SOCIAL.rimR) < 1e-6);
    assert.ok(!(g.x > -2.3 && g.x < 2.3 && g.z > 4.0), 'never in the spawn corridor');
    assert.equal(must(g.look).y, 4);
  }
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) assert.ok(Math.hypot(gs[i].x - gs[j].x, gs[i].z - gs[j].z) >= 0.99);
});

test('inbox zero: the last blocked agent answered → idle / done agents near the Help Desk applaud, once', () => {
  const { social, layout } = office();
  layout.slots.push(slot('slot:queue:0', 'queue', -4.5, 6.5, 0));
  const s2 = createSocial({ layout, director: { isHq: true, walkable: () => true } });
  const q = lite('q', -4.5, 6.5, { bstatus: 'blocked', free: false });
  const fans = [lite('f1', -3, 5), lite('f2', -2, 4, { bstatus: 'done', free: false }), lite('far', 30, 30), lite('w', -3, 6, { bstatus: 'working', free: false })];
  s2.update(1, [q, ...fans]);
  q.bstatus = 'working';
  s2.update(2, [q, ...fans]);
  const got: string[] = [];
  s2.pullPokes(10, (id, r) => got.push(`${id}:${r}`));
  assert.deepEqual(got.map((x) => x.split(':')[0]).sort(), ['f1', 'f2']);
  s2.update(3, [q, ...fans]);
  s2.pullPokes(20, (id) => got.push(id));
  assert.equal(got.length, 2, 'once per transition');
  void social;
});

test('brain: a gig is played only from the idle branch and drops the moment the status changes', async () => {
  const { layout } = await import('../../world/layout/hq.ts');
  const { createNav } = await import('../../world/nav/index.ts');
  const { createDirector } = await import('./director.ts');
  const { createBrain } = await import('./brain.ts');
  const d = createDirector(layout, createNav(layout));
  const NOW = 10 * 3600_000;
  const e = ent({ id: 'w1:p1', kind: 'claude', name: 'a', seedKey: 'a', status: 'idle', statusSince: NOW - 5 * 60_000, workspace: { id: 'w1', label: 'x', slot: 0, colorIndex: 0, cycle: 0 }, tab: { id: 't', label: 'c', index: 0 }, paneIndex: 0, activity: null, ack: null, prompt: null, process: null });
  d.update(new Map([[e.id, e]]), NOW);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const home = must(d.slotFor(e.id));
  const gig: Gig = { key: 7, kind: 'huddle', x: -3, z: -3, yaw: 0, level: 0, look: { x: 0, y: 4, z: 0 }, until: 99, chat: true, lead: true };
  const env: BrainEnv = { t: 1, self: { pos: { ...home.pos }, yaw: 0, settledAt: home.id, moving: false, level: 0 }, player: null, neighbours: [], partner: () => null, invite: () => false, gig: null };
  b.update(e, NOW, env); // (cold start)
  env.t = 1.5; b.update(e, NOW + 500, env);
  assert.equal(b.state.free, true, 'idle, awake, at its desk: free for a scene');
  env.gig = gig; env.t = 2;
  let i = b.update(e, NOW + 1000, env);
  assert.equal(i.phase, 'gig:huddle');
  assert.ok(Math.hypot(must(i.slot).pos.x + 3, must(i.slot).pos.z + 3) < 1e-9);
  assert.equal(b.state.free, false, 'cast: not free');
  // settled at the rim: looks up at the Board
  env.self.settledAt = must(i.slot).id; env.t = 3;
  i = b.update(e, NOW + 2000, env);
  assert.equal(i.look?.y, 4);
  // a prompt arrives (working while away → immediate): straight back to work, the gig is gone
  const w: Entity = { ...e, status: 'working', statusSince: NOW + 2500, activity: { tool: 'Edit', cls: 'edit', detail: 'a.js', since: NOW + 2500 } };
  env.t = 4;
  i = b.update(w, NOW + 3000, env);
  assert.notEqual(i.phase, 'gig:huddle');
  assert.equal(must(i.slot).id, home.id);
  assert.equal(b.state.gig, 0);
});

// [BRN fix m2-r2] showcase regulars: the dwell floor that keeps the Café / Library / Pit (and one touring room) in use
function showcase() {
  const zoneAt = (x: number, z: number) => (x > 10 ? 'CAF' : x < -10 ? 'LIB' : Math.hypot(x, z) < 4 ? 'PIT' : 'ATR');
  const slots = [
    slot('slot:cafe:0', 'cafe', 14, 0, 0, 'sit'), slot('slot:cafe:1', 'cafe', 16, 3, Math.PI, 'sit'),
    slot('slot:lib:0', 'station:library', -14, 0, 0, 'sit'), slot('slot:sofa:0', 'sofa', 0, 2, Math.PI, 'sit'),
  ];
  const tagOf: Record<string, string[]> = { caf: ['slot:cafe:0', 'slot:cafe:1'], libRead: ['slot:lib:0'], pitLounge: ['slot:sofa:0'] };
  const layout: SocialLayout = {
    slots, furniture: [], points: {}, keepClear: [], spawn: [0, 0, 12.5], zoneAt,
    // the café view looks down −z from (14, 6): cafe:1 faces it head on (it wins the framing), cafe:0 shows its back
    keepClearViews: [{ id: 'cafe', x: 16, z: 8, yaw: 0, level: 0 }],
  };
  const director: SocialDirector = {
    isHq: true, walkable: () => true, slotFor: () => null, holds: () => false,
    spotsOf: (tag: string) => (tagOf[tag] ?? []).map((id) => must(slots.find((s) => s.id === id))),
  };
  return { layout, social: createSocial({ layout, director }) };
}

test('regulars: a free idle agent is parked in the empty Café first, from the seat best framed by the café view', () => {
  const { social } = showcase();
  const a = lite('a', 0, 20, { idleMs: 60_000 });
  social.update(10, [a]);
  const g = social.gigFor('a');
  assert.ok(g && g.kind === 'claim' && g.tag === 'caf' && g.regular === 'CAF', JSON.stringify(g));
  assert.deepEqual([must(g.near).x, must(g.near).z], [16, 3], 'starts from the seat facing the lens');
  assert.equal(social.roomEmpty('CAF'), true, '(empty until somebody settles there)');
});

// [BRN fix m2-fix1] the core rooms (the Café's one, the Pit's two) are cast first and outside the share cap
test('regulars: an occupied Café is left alone; the next free agents go to the Pit, the Library, the Pit again', () => {
  const { social } = showcase();
  const inCafe = lite('c', 14, 0, { settledAt: 'slot:cafe:0', free: false, phase: 'chill:caf' });
  const L = [inCafe, lite('a', 0, 20), lite('b', 1, 20), lite('d', 2, 20), lite('e', 3, 20)];
  social.update(10, L);
  const tags = ['a', 'b', 'd', 'e'].map((id) => social.gigFor(id)?.regular ?? null);
  assert.equal(tags.filter((z) => z === 'PIT').length, 2, JSON.stringify(tags));
  assert.ok(tags.includes('LIB') && !tags.includes('CAF'), JSON.stringify(tags));
  assert.equal(social.roomEmpty('CAF'), false);
  // with only two free agents: the Pit's first seat and the Library (the core rooms are not capped by regularShare)
  const { social: s2 } = showcase();
  s2.update(10, [inCafe, lite('a', 0, 20), lite('b', 1, 20)]);
  assert.deepEqual(['a', 'b'].map((id) => s2.gigFor(id)?.regular).sort(), ['LIB', 'PIT']);
});

test('regulars: honest casting — never a working / blocked agent, never a fresh idle one; a status change ends it', () => {
  const { social } = showcase();
  const w = lite('w', 0, 20, { bstatus: 'working', free: false });
  const b = lite('b', 0, 21, { bstatus: 'blocked', free: false });
  const fresh = lite('f', 0, 22, { idleMs: 2_000 });
  social.update(10, [w, b, fresh]);
  for (const id of ['w', 'b', 'f']) assert.equal(social.gigFor(id), null, id);
  const a = lite('a', 0, 20);
  social.update(11, [a]);
  assert.ok(social.gigFor('a'));
  a.bstatus = 'working'; a.free = false;
  social.update(11.5, [a]);
  assert.equal(social.gigFor('a'), null, 'called back to work: the stint ends on the same frame');
});

// [BRN fix m2-fix1] (art review m2: the Pit sofas were empty with 3 done) the Pit keeps TUNING.pitKeep (2) loungers
test('regulars: done loungers — the Pit keeps two; only a third may be borrowed (for the Café), never a lone one', () => {
  const d = (id: string, x: number) => lite(id, x, 1, { bstatus: 'done', phase: 'pit', free: false, settledAt: `slot:pit:${id}` });
  for (const n of [1, 2]) {
    const { social } = showcase();
    const L = [d('p', 0), d('q', 1)].slice(0, n);
    social.update(10, L);
    assert.equal(L.filter((l) => social.gigFor(l.id)).length, 0, `${n} in the Pit: nobody leaves`);
    assert.equal(social.pitSpare(), false);
  }
  const { social } = showcase();
  const L = [d('p', 0), d('q', 1), d('r', -1)];
  social.update(10, L);
  const cast = L.filter((l) => social.gigFor(l.id));
  assert.equal(cast.length, 1, 'three in the Pit: one may go');
  const g = social.gigFor(cast[0].id);
  assert.ok(g && g.mode === 'done' && g.regular === 'CAF' && g.until - 10 <= SOCIAL.regularDoneS[1] + 1e-6, JSON.stringify(g));
  assert.equal(social.pitSpare(), false, 'and the spare seat is taken: no outing on top');
});
// [BRN fix m2-fix1] cameos (fun review m2: the Café had no Clawd for 24 s, the E2 bay was empty for 15 s)
function mailroom() {
  const zoneAt = (x: number) => (x > 20 ? 'MAIL' : x > 10 ? 'CAF' : 'ATR');
  const slots = [slot('slot:outbox:0', 'outbox', 24, 0, 0), slot('slot:outbox:1', 'outbox', 27, 0, 0), slot('slot:cafe:0', 'cafe', 14, 0, 0, 'sit')];
  const tagOf: Record<string, string[]> = { outbox: ['slot:outbox:0', 'slot:outbox:1'], caf: ['slot:cafe:0'] };
  const layout: SocialLayout = { slots, furniture: [], points: {}, keepClear: [], spawn: [0, 0, 12.5], zoneAt, zones: [{ id: 'MAIL', rect: [20, -4, 30, 4], level: 0 }] };
  const director: SocialDirector = { isHq: true, walkable: () => true, slotFor: () => null, holds: () => false, tagDist: () => 10,
    spotsOf: (tag: string) => (tagOf[tag] ?? []).map((id) => must(slots.find((s) => s.id === id))) };
  return createSocial({ layout, director });
}
test('cameo: the zone the player is in, empty for cameoAfterS, gets one visitor for one of its spots (not the one by the player)', () => {
  const social = mailroom();
  const inCafe = lite('c', 14, 0, { settledAt: 'slot:cafe:0', free: false, phase: 'chill:caf' });
  const a = lite('a', 0, 5), b = lite('b', 1, 5);
  social.update(10, [inCafe, a, b]);
  assert.equal(social.gigFor('a'), null, 'nobody is looking at the Mailroom yet');
  social.setView('MAIL', { x: 23.5, z: 1 }); // right by outbox:0
  social.update(10.5, [inCafe, a, b]);
  assert.equal(social.gigFor('a') ?? social.gigFor('b'), null, `waits ${SOCIAL.cameoAfterS} s first`);
  social.update(10.5 + SOCIAL.cameoAfterS + 0.3, [inCafe, a, b]);
  const cast = ['a', 'b'].flatMap((id) => { const g = social.gigFor(id); return g ? [g] : []; });
  assert.equal(cast.length, 1, 'one visitor');
  assert.equal(cast[0].cameo, 'MAIL');
  assert.equal(cast[0].spotId, 'slot:outbox:1', 'the spot away from the player');
  assert.ok((cast[0].speed ?? 0) >= 2 && cast[0].until > 13, JSON.stringify(cast[0]));
  // somebody settled there: no second cameo
  const v = cast[0] === social.gigFor('a') ? a : b;
  Object.assign(v, { settledAt: 'slot:outbox:1', pos: { x: 27, y: 0, z: 0 } });
  social.update(20, [inCafe, a, b]);
  assert.equal(['a', 'b'].filter((id) => social.gigFor(id)?.cameo).length, 1);
  assert.ok((social.counts().cameos ?? 0) >= 1);
});
test('boot cast: idle agents of unknown idle age start as showcase regulars (the Café first); fresh ones stay at their desks', () => {
  const { social } = showcase();
  const e = (id: string, o: Parameters<typeof ent>[0] = {}) => ent({ id, kind: 'claude', status: 'idle', statusSince: 1_000, statusSinceApprox: true, ...o });
  const n = social.bootCast([e('x'), e('y', { statusSinceApprox: false, statusSince: 9_000 }), e('s', { kind: 'shell' }), e('w', { status: 'working' })], 0, 10_000);
  assert.equal(n, 1);
  assert.equal(social.gigFor('x')?.regular, 'CAF');
  for (const id of ['y', 's', 'w']) assert.equal(social.gigFor(id), null, id);
});
