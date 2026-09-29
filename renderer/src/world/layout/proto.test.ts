// P1 "read the room at a glance" from the proto spawn pose: every desk agent's eyes clear the monitors and the
// other seated agents, and chair backs stay below the seated head (M1 review fix r1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, DESK, deskLocal } from './proto.ts';
import type { Furniture, Vec3 } from './schema.ts';

const EYE_H = 1.2; // player eye height (player/tuning.ts)
const SEAT = 0.32; // chair seat (brain/tuning.ts seatY)
// Seated Clawd (chars/rig): body 0.72 w × 0.46 d, bottom at legs 0.16 + seat lift 0.17, eyes 0.68 m, ±0.145 m apart.
const BODY = { hw: 0.36, hd: 0.23, y0: 0.33, y1: 0.87 };
const EYES_Y = [0.62, 0.68, 0.74], EYES_X = [-0.2, -0.1, 0, 0.1, 0.2], FACE_Z = 0.24;

const desks = layout.furniture.filter((f) => f.type === 'desk');
const seats = layout.slots.filter((s) => s.tag === 'desk');
const toWorld = (f: Furniture, lx: number, lz: number) => ({ x: f.pos.x + lx * Math.cos(f.yaw) + lz * Math.sin(f.yaw), z: f.pos.z - lx * Math.sin(f.yaw) + lz * Math.cos(f.yaw) });

/** Slab test of segment o→o+d·t, t∈[0,1], against a box yawed by `yaw` around (cx, cz). */
function hits(o: Vec3, d: Vec3, cx: number, cz: number, yaw: number, hw: number, hd: number, y0: number, y1: number): boolean {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const lx = o.x - cx, lz = o.z - cz;
  const ox = lx * c - lz * s, oz = lx * s + lz * c, dx = d.x * c - d.z * s, dz = d.x * s + d.z * c;
  let t0 = 0, t1 = 0.995;
  for (const [p, v, lo, hi] of [[ox, dx, -hw, hw], [o.y, d.y, y0, y1], [oz, dz, -hd, hd]] as const) {
    if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let a = (lo - p) / v, b = (hi - p) / v;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

function eyeVisibility(eye: Vec3) {
  const monitors = desks.map((f) => { const { monitor: m } = deskLocal(f); return { ...toWorld(f, m.x, m.z), yaw: f.yaw + m.twist, m }; });
  return seats.map((s) => {
    const tx = eye.x - s.pos.x, tz = eye.z - s.pos.z, L = Math.hypot(tx, tz);
    let vis = 0, n = 0;
    for (const u of EYES_X) for (const y of EYES_Y) {
      const q = { x: s.pos.x + (tx / L) * FACE_Z - (tz / L) * u, y, z: s.pos.z + (tz / L) * FACE_Z + (tx / L) * u };
      const d = { x: q.x - eye.x, y: q.y - eye.y, z: q.z - eye.z };
      const blocked = seats.some((o) => o !== s && hits(eye, d, o.pos.x, o.pos.z, o.yaw, BODY.hw, BODY.hd, BODY.y0, BODY.y1))
        || monitors.some((m) => hits(eye, d, m.x, m.z, m.yaw, m.m.w / 2, 0.03, m.m.y - m.m.h / 2, m.m.y + m.m.h / 2));
      n++; if (!blocked) vis++;
    }
    return { id: s.id, vis: vis / n };
  });
}

test('proto P1: from spawn every desk agent shows its eyes (≥ 60% of the eye band, mean ≥ 85%)', () => {
  const eye = { x: layout.spawn[0], y: EYE_H, z: layout.spawn[2] };
  const v = eyeVisibility(eye);
  const mean = v.reduce((a, b) => a + b.vis, 0) / v.length;
  for (const r of v) assert.ok(r.vis >= 0.6, `${r.id} eyes ${Math.round(r.vis * 100)}% visible from spawn`);
  assert.ok(mean >= 0.85, `mean eye visibility ${mean.toFixed(2)}`);
});

test('proto P1: monitor tops stay below the seated eye line seen from the player eye (review: were 0.95 m)', () => {
  for (const f of desks) {
    const { monitor: m, agentX } = deskLocal(f);
    assert.ok(m.y + m.h / 2 <= 0.78, `${f.id}: monitor top ${(m.y + m.h / 2).toFixed(2)} m`);
    assert.ok(Math.abs(m.x) + m.w / 2 <= DESK.w / 2 && Math.abs(agentX) < DESK.w / 2, `${f.id}: monitor/agent on the desk`);
  }
});

test('proto: chair backs are capped at seat + 0.2 m', () => {
  assert.ok(DESK.chairBack <= SEAT + 0.2 + 1e-9);
});

test('proto: seated body clears the chair back at rest and leaning back (lounge), and the desk edge (review r3)', () => {
  const chairs = layout.furniture.filter((f) => f.type === 'chair');
  const bk = DESK.back;
  const backY0 = DESK.chairBack - 0.005 - bk.h; // bottom of the back panel
  for (const s of seats) {
    const c = chairs.find((f) => Math.abs(f.pos.x - s.pos.x) < 1e-6 && Math.abs(f.pos.z - s.pos.z) < 0.3);
    const desk = desks.find((d) => d.id === s.anchor);
    assert.ok(c && desk, `${s.id}: chair + desk`);
    const fz = -Math.cos(s.yaw); // facing (world z; the pods face ±z)
    const fwd = (c.pos.z - s.pos.z) * -fz; // chair centre → slot, along the facing (> 0: slot ahead of the chair)
    assert.ok(Math.abs(fwd - DESK.sitForward) < 1e-6, `${s.id}: sits ${fwd.toFixed(3)} m ahead of the chair centre`);
    // backrest front face (chair-local distance behind the slot) at height y: reclined, so the bottom edge is closest
    const backFront = (y: number) => fwd + bk.z - bk.t / 2 + (y - backY0 - bk.h / 2) * Math.tan(bk.recline);
    // body back face at height y (above the floor); lean = pitch back about the body bottom, shift = hipZ back
    const bodyBack = (y: number, lean: number, shift: number) => { const h = y - BODY.y0; return BODY.hd * Math.cos(lean) + h * Math.sin(lean) + shift; };
    for (let y = backY0; y <= DESK.chairBack; y += 0.01) {
      const rest = backFront(y) - bodyBack(y, 0, 0), lounge = backFront(y) - bodyBack(y, 0.33, 0.04);
      assert.ok(rest >= 0.06, `${s.id}: rest gap ${rest.toFixed(3)} m at y ${y.toFixed(2)}`);
      assert.ok(lounge >= 0, `${s.id}: lounge gap ${lounge.toFixed(3)} m at y ${y.toFixed(2)}`);
    }
    const deskEdge = Math.abs(desk.pos.z - s.pos.z) - DESK.d / 2;
    assert.ok(deskEdge - BODY.hd >= 0.01, `${s.id}: body front ${(deskEdge - BODY.hd).toFixed(3)} m from the desk edge`);
  }
});

test('proto: desk slots sit behind their desk, pods stay inside the room', () => {
  const b = layout.bounds;
  for (const s of seats) {
    const f = desks.find((d) => d.id === s.anchor);
    assert.ok(f, `${s.id} anchor`);
    assert.ok(Math.abs(s.pos.x - f.pos.x) <= DESK.w / 2, `${s.id} beside its desk`);
    assert.ok(s.pos.x - 0.4 > b.minX && s.pos.x + 0.4 < b.maxX, `${s.id} inside the room`);
  }
});

// ---- LVL fix r2 (M1 sign-off) ----------------------------------------------------------------------------------
test('proto queue: spots ≥ 1.0 m apart (0.72 m bodies + a waving arm), each facing the spot ahead / the counter', () => {
  const q = layout.slots.filter((s) => s.tag === 'queue').sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(q.length, 3);
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1].pos, b = q[i].pos;
    assert.ok(Math.hypot(b.x - a.x, b.z - a.z) >= 1.0, `queue ${i - 1}→${i}`);
    const fx = -Math.sin(q[i].yaw), fz = -Math.cos(q[i].yaw), dx = a.x - b.x, dz = a.z - b.z, n = Math.hypot(dx, dz);
    assert.ok((fx * dx + fz * dz) / n > 0.99, `queue ${i} faces the spot ahead`);
  }
  const ctr = layout.furniture.find((f) => f.id === 'counter0');
  assert.ok(ctr);
  assert.ok(-Math.sin(q[0].yaw) * (ctr.pos.x - q[0].pos.x) > 0, 'head faces the counter');
});

test('proto poses: every review camera except the pod close-up stands ≥ 1.5 m from every seat', async () => {
  const { POSES } = await import('../../debug/poses.ts');
  const sitters = layout.slots.filter((s) => s.pose === 'sit');
  for (const [name, p] of Object.entries(POSES)) {
    if (p.layout !== 'proto' || name === 'protoDesks') continue;
    const near = Math.min(...sitters.map((s) => Math.hypot(s.pos.x - p.pose[0], s.pos.z - p.pose[2])));
    assert.ok(near >= 1.5, `${name}: ${near.toFixed(2)} m from a seat`);
  }
});

test('proto pendants: warm pools over the desks at night (gain ≥ 0.2)', () => {
  const pend = layout.lamps.filter((l) => l.kind === 'pendant');
  assert.equal(pend.length, 3);
  assert.ok(pend.every((l) => l.gain >= 0.2));
});
