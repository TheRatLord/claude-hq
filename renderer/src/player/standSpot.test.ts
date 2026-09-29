// standSpot (PLY, reviewer m2 carryover [UI] go-there framing): 1.6–2.4 m, 3/4-front, face in view, clutter-penalised.
import test from 'node:test';
import assert from 'node:assert/strict';
import { standSpot, standSpots, ropeClutter, STAND } from './standSpot.ts';
import { layout } from '../world/layout/hq.ts';
import { createNav } from '../world/nav/index.ts';
import { hqDesks, SEATED } from './deskFixture.ts';
import type { HqDesk } from './deskFixture.ts';
import type { StandQuery, StandSpot } from './standSpot.ts';
import type { FollowActor } from './follow.ts';
import { segHitsBody, segHitsPanel } from './standSpot.ts';

const nav = createNav(layout);
// m3 fix r1 (reviewer [code]): the real hq desks — layout desk slot + the screen bays.ts actually places (monitor kit
// anchor: centre, tilt, 0.37 × 0.155 glass) + the seated yaw (the slot's; actors.ts seats the body on it). The old rig
// (proto deskLocal, screen 10 cm too high, no neighbours) passed while the live office framed backs.
const desks = hqDesks(layout);
/** the worker at desk d (seated body yaw = the slot's) and, for a busy bay, a neighbour at every other desk of its bay */
const worker = (d: HqDesk): FollowActor => ({ id: 'w', pos: { ...d.slot.pos }, yaw: d.seatYaw });
const bayOf = (d: HqDesk) => d.desk.zone;
const neighbours = (d: HqDesk): FollowActor[] => desks.filter((q) => q !== d && bayOf(q) === bayOf(d)).map((q, i) => ({ id: `n${i}`, pos: { ...q.slot.pos }, yaw: q.seatYaw }));
const seatedQ = (d: HqDesk, others: FollowActor[]): StandQuery => ({ layout, nav, others, seated: true, faceYaw: d.seatYaw, monitor: d.screen });
const cfOf = (a: FollowActor, s: { x: number; z: number }) => { const fx = -Math.sin(a.yaw ?? 0), fz = -Math.cos(a.yaw ?? 0), dx = s.x - a.pos.x, dz = s.z - a.pos.z, d = Math.hypot(dx, dz); return (dx * fx + dz * fz) / d; };

test('standSpot: an agent standing in the open → 3/4-front within 1.6–2.4 m, looking at it', () => {
  const a = { id: 'a', pos: { x: 0, y: 0, z: 9 }, yaw: 0 }; // atrium→lobby corridor, facing north
  const s = standSpot(a, { layout, nav, others: [] });
  assert.ok(s, 'a spot');
  const d = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
  assert.ok(d >= STAND.minDist - 1e-6 && d <= STAND.maxDist + 1e-6, `distance ${d.toFixed(2)}`);
  const cf = cfOf(a, s);
  assert.ok(cf > 0.3, `in front of its face (cf ${cf.toFixed(2)})`);
  // the view points at the agent (± 20°)
  const want = Math.atan2(-(a.pos.x - s.x), -(a.pos.z - s.z));
  assert.ok(Math.abs(Math.atan2(Math.sin(s.yaw - want), Math.cos(s.yaw - want))) < 0.35, 'looks at the agent');
});

test('standSpot: every ranked spot keeps the 1.6–2.4 m band (never the 0.8 m back view)', () => {
  for (const d of desks) {
    const a = worker(d);
    for (const others of [[], neighbours(d)]) {
      for (const s of standSpots(a, seatedQ(d, others))) {
        const r = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
        assert.ok(r >= 1.6 - 1e-6 && r <= 2.4 + 1e-6, `${d.slot.id}: ${r.toFixed(2)} m`);
      }
    }
  }
});

/** What a stand spot shows of a seated worker: face angle (cf), the screen's face toward the lens, occluders. */
function reads(d: HqDesk, s: StandSpot) {
  const a = worker(d), sc = d.screen;
  const cf = cfOf(a, s);
  const vx = s.x - sc.x, vz = s.z - sc.z, hn = Math.hypot(sc.nx, sc.nz);
  const monDot = (vx * sc.nx + vz * sc.nz) / (Math.hypot(vx, vz) * hn);
  const fx = -Math.sin(d.seatYaw), fz = -Math.cos(d.seatYaw);
  const face = { x: a.pos.x + fx * 0.15, y: SEATED.faceY, z: a.pos.z + fz * 0.15 };
  const e = s.eye;
  const body = segHitsBody(e.x, e.y, e.z, sc.x, sc.y, sc.z, a, d.seatYaw, { halfW: SEATED.halfW, halfD: SEATED.halfD, y0: SEATED.seatY, y1: SEATED.top });
  const faceBehindMon = segHitsPanel(sc, e.x, e.y, e.z, face.x, face.y, face.z);
  return { cf, monDot, body, faceBehindMon };
}

test('standSpot: a seated desk worker (real hq desk, empty bay) is framed from the side, face beside its screen', () => {
  let n = 0;
  for (const d of desks) {
    const s = standSpot(worker(d), seatedQ(d, []));
    assert.ok(s, `${d.slot.id}: a spot`);
    n++;
    const r = reads(d, s);
    assert.ok(r.cf >= -0.3, `${d.slot.id}: side view, not the back (cf ${r.cf.toFixed(2)})`);
    assert.ok(r.monDot >= STAND.monMinDot, `${d.slot.id}: the screen faces the lens (${r.monDot.toFixed(2)})`);
    assert.ok(!r.body, `${d.slot.id}: its own body is not between the lens and its screen`);
    assert.ok(!r.faceBehindMon, `${d.slot.id}: the face is not behind its monitor`);
  }
  assert.equal(n, desks.length);
});

test('standSpot: a seated desk worker in a busy bay (every desk taken) is never framed from behind', () => {
  // the live case (reviewer m3-r1 [code]): with neighbours at the pod the old scorer picked dead-back views
  // (cf −0.92 / −1.0, the E2:0 / E3:1 desks) and called every screen hidden (its own desk's 1 m follow box)
  let n = 0, sideish = 0;
  for (const d of desks) {
    const s = standSpot(worker(d), seatedQ(d, neighbours(d)));
    if (!s) continue;
    n++;
    const r = reads(d, s);
    // CHR's walk-up face turn (≤ 25° + eyes) keeps the face readable down to cf ≈ −0.6 (≈ 127° off its facing)
    assert.ok(r.cf >= -0.65, `${d.slot.id}: not the back of its head (cf ${r.cf.toFixed(2)})`);
    if (r.cf >= STAND.cfSeatedMin) sideish++;
    assert.ok(r.monDot >= STAND.monMinDot, `${d.slot.id}: the screen faces the lens (${r.monDot.toFixed(2)})`);
    assert.ok(!r.body, `${d.slot.id}: its own body is not between the lens and its screen`);
    assert.ok(!r.faceBehindMon, `${d.slot.id}: the face is not behind its monitor`);
    assert.ok(s.monitor && s.monitor.inFrame > 0, `${d.slot.id}: its screen is in frame`);
  }
  assert.ok(n >= desks.length * 0.9, `spots for ${n}/${desks.length} desks`);
  assert.ok(sideish >= n * 0.66, `side-3/4 (cf ≥ ${STAND.cfSeatedMin}) for ${sideish}/${n}`);
});

test('standSpot: other actors are never stood in, and a neighbour in front of the face is avoided', () => {
  const a = { id: 'a', pos: { x: 0, y: 0, z: 9 }, yaw: 0 };
  const free = standSpot(a, { layout, nav, others: [] });
  assert.ok(free, 'a free spot');
  // put a neighbour right on the free spot's sightline, 0.8 m in front of the subject
  const k = 0.8 / Math.hypot(free.x - a.pos.x, free.z - a.pos.z);
  const b = { id: 'b', pos: { x: a.pos.x + (free.x - a.pos.x) * k, y: 0, z: a.pos.z + (free.z - a.pos.z) * k } };
  const s = standSpot(a, { layout, nav, others: [b] });
  assert.ok(s);
  assert.ok(Math.hypot(s.x - b.pos.x, s.z - b.pos.z) >= STAND.actorClear, 'not inside the neighbour');
  assert.ok(Math.hypot(s.x - free.x, s.z - free.z) > 0.3, 'moved off the blocked sightline');
});

test('ropeClutter: a rope a step in front of the lens costs, one 2 m off does not', () => {
  const R = { segs: [[-1, -0.5, 1, -0.5]], posts: [] };
  const a = { pos: { x: 0, z: -2.2 } };
  assert.ok(ropeClutter(R, { x: 0, z: 0, yaw: 0 }, a) > 1, 'rope 0.5 m ahead');
  assert.equal(ropeClutter({ segs: [[-1, -2.0, 1, -2.0]], posts: [] }, { x: 0, z: 0, yaw: 0 }, a), 0, 'rope by the subject');
  assert.ok(ropeClutter({ segs: [], posts: [[0.1, -0.4]] }, { x: 0, z: 0, yaw: 0 }, a) > 1.5, 'post at the lens');
});

test('standSpot: at the queue the chosen view has little rope / post clutter', () => {
  const q = layout.points.queue[3];
  const a = { id: 'q', pos: { x: q.x, y: 0.15, z: q.z }, yaw: Math.PI / 2 };
  const s = standSpot(a, { layout, nav, others: [] });
  if (!s) return; // lane fully boxed in: the caller falls back
  assert.ok(s.rope <= 1.0, `rope clutter ${s.rope}`);
});

test('standSpot: no actor → null', () => {
  // @ts-expect-error a missing actor is a runtime case (→ null): the signature stays strict for real callers
  assert.equal(standSpot(null, { layout }), null);
});
