import test from 'node:test';
import assert from 'node:assert/strict';
import { softStep } from './soft.ts';
import type { BumpEvent, Contact } from './soft.ts';
import { TUNING as T } from './tuning.ts';

const O = { radius: T.radius, ...T.soft };
const R = T.radius + T.soft.actorRadius;

/** Walk straight at `speed` along -z into an actor at the origin; returns the per-frame trace. */
function walkInto({ seconds = 1, speed = T.walk, dt = 1 / 60, startZ = 2, blocked = null, actorX = 0 }: { seconds?: number; speed?: number; dt?: number; startZ?: number; blocked?: ((x: number, z: number) => boolean) | null; actorX?: number } = {}) {
  const pos = { x: 0, y: 0, z: startZ }, contacts = new Map<string, Contact>();
  const actor = { id: 'd3:p5', pos: { x: actorX, y: 0, z: 0 } };
  const frames: { t: number; z: number; x: number; d: number }[] = [], events: (BumpEvent & { t: number })[] = [];
  let mul = 1;
  for (let i = 0, t = 0; t < seconds; i++, t += dt) {
    const vel = { x: 0, z: -speed * mul };
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    const r = softStep(pos, vel, [actor], contacts, dt, O, blocked, i + 1);
    mul = r.speedMul;
    for (const e of r.events) events.push({ ...e, t: t + dt });
    frames.push({ t: t + dt, z: pos.z, x: pos.x, d: Math.hypot(pos.x - actor.pos.x, pos.z - actor.pos.z) });
  }
  return { frames, events, contacts };
}

test('soft collider blocks head-on, then lets the player squeeze through after pushThroughS', () => {
  const { frames, events } = walkInto({ seconds: 1.4 });
  const hit = events.find((e) => e.phase === 'hit'), thr = events.find((e) => e.phase === 'through');
  assert.ok(hit && thr, 'hit and through events');
  assert.equal(hit.id, 'd3:p5');
  const held = thr.t - hit.t;
  assert.ok(Math.abs(held - T.soft.pushThroughS) < 1 / 30, `held ${held.toFixed(3)} s`);
  // while blocked the player never gets inside the combined radius
  for (const f of frames) if (f.t > hit.t && f.t < thr.t) assert.ok(f.d >= R - 1e-9, `d ${f.d} at ${f.t}`);
  // afterwards they pass (slowed) and come out the other side
  const last = frames.at(-1);
  assert.ok(last, 'frames');
  assert.ok(last.z < -R, `came out the far side: z ${last.z}`);
});

test('the reviewer case: 0.4 s into the actor no longer moves the camera 1.7 m', () => {
  const { frames } = walkInto({ seconds: 0.4, startZ: 1.0 });
  const last = frames.at(-1);
  assert.ok(last, 'frames');
  assert.ok(last.z >= R - 1e-9 - T.walk * T.soft.throughSpeedMul * 0.1, `z ${last.z}`);
});

test('an off-centre approach slides around the actor instead of stopping dead', () => {
  const pos = { x: 0.2, y: 0, z: 1 }, contacts = new Map();
  const actor = { id: 'a', pos: { x: 0, y: 0, z: 0 } };
  for (let i = 1; i <= 30; i++) {
    const vel = { x: 0, z: -T.walk };
    pos.z += vel.z / 60;
    softStep(pos, vel, [actor], contacts, 1 / 60, O, null, i);
    if (Math.hypot(pos.x, pos.z) < R - 1e-9) assert.fail('penetrated while blocked');
  }
  assert.ok(pos.x > 0.3, `slid sideways: x ${pos.x}`);
});

test('contact re-arms after leaving; actors on another floor and vanished actors are ignored', () => {
  const contacts = new Map();
  const pos = { x: 0, y: 0, z: 0.3 }, vel = { x: 0, z: 0 };
  let r = softStep(pos, vel, [{ id: 'a', pos: { x: 0, y: 0, z: 0 } }], contacts, 1 / 60, O, null, 1);
  assert.equal(r.events[0].phase, 'hit');
  pos.z = 3;
  softStep(pos, vel, [{ id: 'a', pos: { x: 0, y: 0, z: 0 } }], contacts, 1 / 60, O, null, 2);
  assert.equal(contacts.size, 0, 're-armed');
  const up = { x: 0, y: 2.9, z: 0.1 };
  r = softStep(up, vel, [{ id: 'b', pos: { x: 0, y: 0, z: 0 } }], contacts, 1 / 60, O, null, 3);
  assert.equal(r.events.length, 0);
  assert.equal(up.z, 0.1, 'mezzanine player not pushed by a ground-floor actor');
  softStep({ x: 0, y: 0, z: 0.2 }, vel, [{ id: 'c', pos: { x: 0, y: 0, z: 0 } }], contacts, 1 / 60, O, null, 4);
  softStep({ x: 0, y: 0, z: 0.2 }, vel, [], contacts, 1 / 60, O, null, 5);
  assert.equal(contacts.size, 0, 'vanished actor forgotten');
});

test('push-out never shoves the player into a wall', () => {
  const wall = (_x: number, z: number) => z > 0.5; // wall behind the player
  const pos = { x: 0, y: 0, z: 0.45 }, vel = { x: 0, z: 0 };
  softStep(pos, vel, [{ id: 'a', pos: { x: 0, y: 0, z: 0 } }], new Map(), 1 / 60, O, wall, 1);
  assert.ok(pos.z <= 0.5, `z ${pos.z}`);
});

test('an actor with its back to a wall stays solid: no push-through into its head', () => {
  const wall = (_x: number, z: number) => z < -0.3; // wall right behind the actor (like the proto window queue)
  const { frames, events } = walkInto({ seconds: 2, blocked: wall });
  assert.equal(events.filter((e) => e.phase === 'through').length, 0);
  const last = frames.at(-1);
  assert.ok(last, 'frames');
  assert.ok(last.d >= R - 1e-9, `d ${last.d}`);
});

test('stopping halfway through eases the player back out', () => {
  const contacts = new Map([['a', { t: 1, through: true, seen: 0 }]]);
  const pos = { x: 0, y: 0, z: 0.15 }, vel = { x: 0, z: 0 };
  for (let i = 1; i <= 60; i++) softStep(pos, vel, [{ id: 'a', pos: { x: 0, y: 0, z: 0 } }], contacts, 1 / 60, O, null, i);
  assert.ok(Math.hypot(pos.x, pos.z) > R - 0.03, `eased out to ${pos.z.toFixed(3)} in 1 s`);
});
