import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActors } from './actors.ts';
import { createDirector } from './brain/director.ts';
import { testLayout, testNav, ent, must, fakeStore, stubRig } from './brain/testkit.ts';
import type { Actor, ActorFx, ActorFactories, Actors, ActorsCtx } from './actors.ts';
import type { Animator } from './anim/animator.ts';
import type { CharHandle } from './render/charBatch.ts';
import type { Entity, Status, WorldMsg } from '../../../shared/protocol.ts';
import type { Vec3 } from '../world/layout/schema.ts';

const NOW = 5 * 3600_000;

const STATUS_CYCLE: Status[] = ['idle', 'working', 'blocked', 'done'];
const WORLD: WorldMsg = { t: 'world', entities: [], workspaces: [], focusedPaneId: null };
/** the ctx the tests drive: the player is always present here (`update` accepts none) */
interface HarnessCtx extends ActorsCtx { player: { pos: Vec3; level?: number } }

function harness(entities: Entity[]) {
  const store = fakeStore(entities);
  const layout = testLayout();
  const director = createDirector(layout, testNav());
  const calls: { react: [string, string][]; bursts: string[]; removed: number; registered: number } = { react: [], bursts: [], removed: 0, registered: 0 };
  const factories: ActorFactories = {
    createRig: stubRig,
    createAnimator: (_rig, o) => {
      const an: Animator & { action: string | null; speed: number } = {
        action: null, speed: 0,
        setLocomotion(s) { an.speed = s; }, setAction(id) { an.action = id; }, react(r) { calls.react.push([o.seedKey ?? '', r]); },
        setFace() {}, setGait() {}, lookAt() {}, setEnergy() {}, setTraits() {}, update() {},
        traits: {}, debug: { action: null, face: null, reactions: [], speed: 0 },
      };
      return an;
    },
  };
  const handle: CharHandle = { setVisible() {}, setLod() {}, setOutline() {}, remove() { calls.removed++; } };
  const charBatch = { register: () => { calls.registered++; return handle; } };
  const noop = () => {};
  const fx: ActorFx = { bubble: noop, ring: noop, plate: noop, glyph: noop, dust: noop, placard: noop, forget: noop, burst: (k) => { calls.bursts.push(k); } };
  const actors = createActors({ store, layout, director, charBatch, fx, factories });
  const ctx: HarnessCtx = { dt: 1 / 60, time: 0, now: NOW, player: { pos: { x: 0, y: 0, z: 4 } }, camera: null };
  const step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { ctx.time += dt; ctx.now += dt * 1000; ctx.dt = dt; actors.update(ctx); } };
  return { store, actors, director, calls, step, ctx };
}

const walkers = (actors: Actors) => actors.list().filter((a) => a.moving).map((a) => a.id);

test('cold start: everyone is placed at its slot, nobody walks in, dissolveIn only', () => {
  const es = Array.from({ length: 12 }, (_, i) => ent({ i, status: STATUS_CYCLE[i % 4], statusSince: NOW - 60_000, workspace: { slot: i % 3 }, tab: { index: i % 2 }, paneIndex: Math.floor(i / 6) }));
  const h = harness(es);
  h.store.emit('world', WORLD);
  h.step(1);
  assert.equal(h.actors.count(), 12);
  assert.deepEqual(walkers(h.actors), []);
  const kinds = new Set(h.calls.react.map(([, r]) => r));
  assert.deepEqual([...kinds], ['dissolveIn']);
  // Blocked for 60 s → already in the queue; done for 60 s → already on the sofa.
  const q = h.actors.list().filter((a) => must(must(a.intent).slot).tag === 'queue');
  assert.equal(q.length, 3);
  for (const a of h.actors.list()) {
    const s = must(must(a.intent).slot);
    if (s.pose !== 'stand' || s.tag === 'queue') assert.ok(Math.hypot(a.pos.x - s.pos.x, a.pos.z - s.pos.z) < 1e-6, a.id);
  }
});

test('reconnect with the same world: no exodus, no re-hire; re-key moves the actor', () => {
  const es = Array.from({ length: 6 }, (_, i) => ent({ i: 10 + i, status: 'working', statusSince: NOW - 1000, workspace: { slot: i % 3 } }));
  const h = harness(es);
  h.store.emit('world', WORLD);
  h.step(2);
  const before = new Map(h.actors.list().map((a) => [a.id, a]));
  // WS reconnect: a new world with fresh (equal) entity objects.
  h.store.entities = new Map(es.map((e) => [e.id, { ...e }]));
  h.store.emit('world', WORLD);
  h.step(30);
  assert.equal(h.calls.removed, 0);
  assert.equal(h.calls.registered, 6);
  for (const a of h.actors.list()) assert.equal(before.get(a.id), a);
  // herdr restart with re-keyed ids.
  const old = es[0], nu = { ...old, id: 'w9:p1' };
  const actor = must(h.actors.get(old.id));
  const pos = { ...actor.pos };
  h.store.emit('gone', { t: 'gone', id: old.id, reason: 'rekeyed', newId: nu.id });
  h.store.entities.delete(old.id);
  h.step(3); // the new entity arrives a few frames later
  h.store.entities.set(nu.id, nu);
  h.step(30);
  assert.equal(h.actors.get(nu.id), actor);
  assert.equal(h.actors.get(old.id), null);
  assert.deepEqual({ x: actor.pos.x, z: actor.pos.z }, { x: pos.x, z: pos.z });
  assert.equal(h.calls.removed, 0);
  assert.ok(!h.calls.react.some(([, r]) => r === 'leave' || r === 'arrive'));
});

test('post-boot arrival: a parcel crate at the hiring anchor, unwrap + wave, then the walk; a closed pane waves goodbye at the front door (§6.4.3)', () => {
  const h = harness([ent({ i: 30 })]);
  h.store.emit('world', WORLD);
  h.step(1);
  assert.deepEqual(h.actors.crates(), [], 'boot: no crate, no parade');
  const e = ent({ i: 31, status: 'idle', statusSince: NOW });
  h.store.entities.set(e.id, e);
  h.store.emit('event', { t: 'event', id: e.id, kind: 'arrived' });
  h.step(30); // 0.5 s
  const a = must(h.actors.get(e.id));
  assert.equal(h.actors.crates().length, 1, 'the crate is on stage at 0.5 s');
  assert.ok(a.inCrate && a.crateStage === 0 && !a.moving, 'hidden in the crate');
  h.step(60); // 1.5 s: unwrapped
  assert.equal(a.crateStage, 1);
  h.step(30); // 2 s: the crate still stands open round it, waving
  assert.equal(h.actors.crates().length, 1, 'the crate is on stage at 2 s');
  assert.ok(a.crateStage >= 1 && !a.moving);
  h.step(60); // 3 s: off to its slot
  assert.ok(a.moving, 'walking to its slot after the unwrap');
  h.step(60 * 20);
  assert.equal(a.moving, false);
  assert.equal(h.actors.crates().length, 0, 'the crate is gone');
  assert.ok(h.calls.react.some(([s, r]) => s === e.seedKey && r === 'wave'));
  assert.equal(h.actors.metrics().verbs.crates, 1);
  // closed: it walks to the front door, turns, waves goodbye, then dissolves (poof) — never a poof in place
  const before = { ...a.pos };
  h.store.entities.delete(e.id);
  h.store.emit('gone', { t: 'gone', id: e.id, reason: 'closed' });
  h.step(20);
  assert.ok(h.actors.get(e.id), 'still here: on its way out');
  assert.ok(!h.calls.bursts.includes('poof'));
  h.step(60 * 20);
  assert.equal(h.actors.get(e.id), null);
  assert.ok(h.calls.bursts.includes('poof'));
  assert.ok(Math.hypot(a.pos.x - before.x, a.pos.z - before.z) > 1, 'it walked to the door first');
  assert.equal(h.actors.metrics().verbs.departures, 1);
});

test('status change: working → blocked stands on the chair, then walks to the queue', () => {
  const e = ent({ i: 40, status: 'working', statusSince: NOW - 5000 });
  const n = ent({ i: 41, status: 'idle', statusSince: NOW - 5000, workspace: { slot: 0 }, tab: { index: 1 } });
  const h = harness([e, n]);
  h.store.emit('world', WORLD);
  h.step(1);
  const a = must(h.actors.get(e.id));
  const bl = ent({ ...e, status: 'blocked', statusSince: h.ctx.now, prompt: { question: 'ok?' } });
  h.store.entities.set(e.id, bl);
  h.store.emit('event', { t: 'event', id: e.id, kind: 'blocked' });
  h.step(60 * 2);
  assert.equal(must(a.intent).stand, true);
  assert.ok(a.pos.y > 0.2, 'up on the chair');
  assert.ok(h.calls.react.some(([s, r]) => s === e.seedKey && r === 'startle'));
  h.step(60 * 10);
  assert.equal(must(must(a.intent).slot).tag, 'queue');
  h.step(60 * 10);
  assert.equal(a.moving, false);
  assert.ok(Math.hypot(a.pos.x - must(must(a.intent).slot).pos.x, a.pos.z - must(must(a.intent).slot).pos.z) < 0.05);
});

test('walkers sidestep the player instead of walking through the camera (local avoidance)', () => {
  const e = ent({ i: 50, status: 'blocked', statusSince: NOW - 9_500, prompt: { question: 'ok?' } });
  const h = harness([e]);
  h.store.emit('world', WORLD);
  h.step(1);
  const a = must(h.actors.get(e.id));
  h.ctx.player.pos = { x: 50, y: 0, z: 50 }; // out of the way until the walk starts
  let guard = 0;
  const segLeft = () => { const q = a.path[a.pathI]; return q ? Math.hypot(q.x - a.pos.x, q.z - a.pos.z) : 0; };
  while (!(a.moving && segLeft() > 2.5) && guard++ < 1200) h.step(1);
  assert.ok(a.moving, 'walking a long leg to the queue');
  // Stand the player on the walking line, 1.6 m ahead of the walker.
  const p = a.path[a.pathI];
  const dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.hypot(dx, dz);
  const k = Math.min(1.6, d * 0.6) / d;
  h.ctx.player.pos = { x: a.pos.x + dx * k, y: 0, z: a.pos.z + dz * k };
  let minD = Infinity;
  const stillMoving = () => a.moving !== false; // (a call, so the narrowing of the assert above does not apply)
  for (let i = 0; i < 60 * 12 && stillMoving() || i < 5; i++) {
    h.step(1);
    minD = Math.min(minD, Math.hypot(a.pos.x - h.ctx.player.pos.x, a.pos.z - h.ctx.player.pos.z));
  }
  assert.ok(minD > 0.9, `kept out of the player's circle (closest ${minD.toFixed(2)} m)`);
  assert.ok(Math.hypot(a.pos.x - must(must(a.intent).slot).pos.x, a.pos.z - must(must(a.intent).slot).pos.z) < 0.05, 'still arrives');
});

test('a walker starting next to the player never walks into them (holds, routes away; review r3 tr_done)', () => {
  for (let k = 0; k < 8; k++) {
    const e = ent({ i: 60, status: 'working', statusSince: NOW - 60_000 });
    const h = harness([e]);
    h.store.emit('world', WORLD);
    h.step(1);
    const a = must(h.actors.get(e.id));
    const home = must(h.director.slotFor(e.id));
    // Stand the player 1.1–1.5 m from the chair, all around it (behind the chair = the step-out side).
    const ang = (k / 8) * Math.PI * 2, r = 1.1 + (k % 3) * 0.2;
    h.ctx.player.pos = { x: home.pos.x + Math.sin(ang) * r, y: 0, z: home.pos.z + Math.cos(ang) * r };
    h.store.entities.set(e.id, { ...e, status: 'done', statusSince: h.ctx.now });
    const d0 = Math.hypot(a.pos.x - h.ctx.player.pos.x, a.pos.z - h.ctx.player.pos.z);
    let minD = Infinity;
    for (let i = 0; i < 60 * 12; i++) {
      h.step(1);
      minD = Math.min(minD, Math.hypot(a.pos.x - h.ctx.player.pos.x, a.pos.z - h.ctx.player.pos.z));
    }
    assert.ok(minD >= Math.min(0.95, d0 - 0.05), `angle ${k}: closest ${minD.toFixed(2)} m (started ${d0.toFixed(2)})`);
    // The player steps away: off to the sofa it goes.
    h.ctx.player.pos = { x: 50, y: 0, z: 50 };
    h.step(60 * 12);
    assert.equal(must(must(a.intent).slot).tag, 'sofa', `angle ${k}`);
    assert.ok(a.arrived && a.settledAt === must(must(a.intent).slot).id, `angle ${k}: reached the sofa`);
  }
});

test('a walker never steps inside the player (actor-side soft collider)', () => {
  const e = ent({ i: 70, status: 'blocked', statusSince: NOW - 9_500, prompt: { question: 'ok?' } });
  const h = harness([e]);
  h.store.emit('world', WORLD);
  h.step(1);
  const a = must(h.actors.get(e.id));
  h.ctx.player.pos = { x: 50, y: 0, z: 50 };
  let guard = 0;
  while (!a.moving && guard++ < 1200) h.step(1);
  h.step(20);
  // Teleport the player right onto the walker's next metre (no time to sidestep).
  const p = a.path[a.pathI];
  const dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
  h.ctx.player.pos = { x: a.pos.x + dx / d * 0.7, y: 0, z: a.pos.z + dz / d * 0.7 };
  let minD = Infinity;
  for (let i = 0; i < 60 * 3; i++) { h.step(1); minD = Math.min(minD, Math.hypot(a.pos.x - h.ctx.player.pos.x, a.pos.z - h.ctx.player.pos.z)); }
  assert.ok(minD >= 0.615, `closest ${minD.toFixed(3)} m`);
});

test('[BRN M3.5] bus verbs: Q pat → hearts, R summon → comes over; answered / prompt.sent reach the brain; counted', async () => {
  const { createBus } = await import('../core/bus.ts');
  const es = [ent({ i: 80, status: 'idle', statusSince: NOW - 60_000 }), ent({ i: 81, status: 'working', statusSince: NOW - 60_000, activity: { tool: 'Edit', cls: 'edit', detail: '', since: NOW - 1000 } }),
    ent({ i: 82, status: 'blocked', statusSince: NOW - 60_000, prompt: { question: 'Allow?' } })];
  const h = harness(es);
  const bus = createBus();
  h.ctx.bus = bus;
  h.store.emit('world', WORLD);
  h.step(2);
  const [idle, work, blk] = es.map((e) => must(h.actors.get(e.id)));
  h.ctx.player = { pos: { x: idle.pos.x + 3, y: 0, z: idle.pos.z + 1 }, level: 0 };
  h.step(1);
  bus.emit('verb', { verb: 'pat', id: idle.id });
  assert.ok(h.calls.bursts.includes('hearts'));
  const workSlot = must(must(work.intent).slot).id, blkSlot = must(must(blk.intent).slot).id;
  bus.emit('verb', { verb: 'summon', id: idle.id });
  bus.emit('verb', { verb: 'summon', id: work.id });
  bus.emit('verb', { verb: 'summon', id: blk.id });
  h.step(60 * 4);
  assert.equal(must(must(idle.intent).slot).tag, 'summon');
  assert.equal(must(must(work.intent).slot).id, workSlot);
  assert.equal(must(must(blk.intent).slot).id, blkSlot);
  bus.emit('answered', { id: blk.id, key: '1' });
  bus.emit('prompt.sent', { id: idle.id });
  const v = h.actors.metrics().verbs;
  assert.equal(v.pat, 1); assert.equal(v.summon, 3); assert.equal(v.come, 1); assert.equal(v.refuse, 2);
  assert.equal(v.answered, 1); assert.equal(v.prompted, 1);
});

// [BRN fix m2-fix1] walk-up attention wiring: bus 'aim' (UI) + the player within TUNING.attendR → env.aimed → 'attend'
test('[BRN fix m2-fix1] aim: an aimed idle agent within 2.5 m pauses and turns; farther away (or not aimed) it does not', async () => {
  const { createBus } = await import('../core/bus.ts');
  const es = [ent({ i: 90, status: 'idle', statusSince: NOW - 60_000 }), ent({ i: 91, status: 'idle', statusSince: NOW - 60_000 })];
  const h = harness(es);
  const bus = createBus();
  h.ctx.bus = bus;
  h.store.emit('world', WORLD);
  h.step(2);
  const [a, b] = es.map((e) => must(h.actors.get(e.id)));
  h.ctx.player = { pos: { x: a.pos.x + 1.6, y: 0, z: a.pos.z + 0.6 }, level: 0 };
  bus.emit('aim', { id: a.id });
  h.step(40); // ≥ 0.4 s
  assert.equal(must(a.intent).phase, 'attend');
  assert.ok(h.actors.metrics().verbs.attends >= 1);
  bus.emit('aim', { id: b.id }); // b is out of reach (> 2.5 m)
  h.ctx.player.pos.x = b.pos.x + 4; h.ctx.player.pos.z = b.pos.z;
  h.step(60);
  assert.notEqual(must(b.intent).phase, 'attend');
  h.actors.setAim(null);
  h.step(60 * 4); // 3 s after the aim left: back to its own ladder
  assert.notEqual(must(a.intent).phase, 'attend');
});
