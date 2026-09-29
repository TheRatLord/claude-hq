// M1.5 greybox gate (§7.1, §9.3): hq.ts layout + nav invariants. Owner: LVL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, DOORS, KEEP_CLEAR, STATIONS, BAYS, POINTS, PORTALS, ZONES, BAY_ORDER, RAIL_RUN } from './hq.ts';
import { layout as proto } from './proto.ts';
import { createNav } from '../nav/index.ts';
import { POSES } from '../../debug/poses.ts';
import type { Furniture, Rect, Slot, Door } from './schema.ts';
import type { NavPoint } from '../nav/index.ts';

/** Narrow a lookup that must succeed. */
function need<T>(x: T | undefined | null, what = 'value'): T {
  assert.ok(x !== undefined && x !== null, `${what} missing`);
  return x;
}
interface P2 { x: number; z: number }

const nav = createNav(layout);
const spawn = { x: layout.spawn[0], z: layout.spawn[2], level: 0 };
const slotById = new Map(layout.slots.map((s) => [s.id, s]));
const slotOf = (id: string) => need(slotById.get(id), id);
const at = (s: Slot | undefined) => {
  const q = need(s, 'slot');
  return { x: q.pos.x, z: q.pos.z, level: q.level };
};
const W = (px: number, pz: number) => ({ x: px - 20.5, z: pz - 14 });
const segCross = (a: P2, b: P2, c: P2, d: P2) => { // segments ab / cd intersect (x/z)
  const o = (p: P2, q: P2, r: P2) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};
const crossesDoor = (pts: P2[], door: Door) => {
  const h = door.w / 2, c = door.pos;
  const d0 = door.axis === 'x' ? { x: c.x - h, z: c.z } : { x: c.x, z: c.z - h };
  const d1 = door.axis === 'x' ? { x: c.x + h, z: c.z } : { x: c.x, z: c.z + h };
  for (let i = 1; i < pts.length; i++) if (segCross(pts[i - 1], pts[i], d0, d1)) return true;
  return false;
};
const inRect = (r: readonly number[], x: number, z: number) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
const footprint = (f: Furniture): Rect => { // axis-aligned bounds of a (rotated) furniture footprint
  const c = Math.abs(Math.cos(f.yaw ?? 0)), s = Math.abs(Math.sin(f.yaw ?? 0));
  const ex = c * f.size[0] / 2 + s * f.size[2] / 2, ez = s * f.size[0] / 2 + c * f.size[2] / 2;
  return [f.pos.x - ex, f.pos.z - ez, f.pos.x + ex, f.pos.z + ez];
};
/** Pinhole camera at a pose `[x, y(feet), z, yaw, pitch]` (eye 1.2 m, vfov 60°): `ndc(p, aspect)` → {x, y, cf}. */
const camera = ([ex, ey, ez, yaw, pitch]: readonly number[]) => {
  const eye = { x: ex, y: ey + 1.2, z: ez }, t = Math.tan((30 * Math.PI) / 180);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // forward on the ground plane
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // camera right
  const ndc = (p: { x: number; y: number; z: number }, aspect: number) => {
    const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
    const cx = dx * rx + dz * rz, f0 = dx * fx + dz * fz;
    const cy = dy * Math.cos(pitch) - f0 * Math.sin(pitch), cf = f0 * Math.cos(pitch) + dy * Math.sin(pitch);
    return { x: cx / cf / (t * aspect), y: cy / cf / t, cf };
  };
  return { ndc, rx, rz };
};
const overlap = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

test('hq: 42 × 28 m, every §7.1 zone, 6 bays × 6 desks in BAY_ORDER pods, 10 queue + 6 overflow', () => {
  const b = layout.bounds;
  assert.equal(b.maxX - b.minX, 42); assert.equal(b.maxZ - b.minZ, 28);
  for (const z of ['LOB', 'PIT', 'ATR', 'LIB', 'MEZ', 'NAL', 'STR', 'W1', 'W2', 'W3', 'E1', 'E2', 'E3', 'PLZ', 'WAR', 'LAB', 'MAIL', 'ARC', 'ENG', 'CAF', 'NAP']) assert.ok(ZONES.find((q) => q.id === z), z);
  assert.deepEqual(BAYS.map((q) => q.id), [...BAY_ORDER]);
  assert.deepEqual(layout.pods.map((p) => p.length), [6, 6, 6, 6, 6, 6]);
  for (const [i, pod] of layout.pods.entries()) for (const id of pod) assert.equal(slotOf(id).pod, i);
  assert.equal(layout.slots.filter((s) => s.tag === 'queue').length, 10);
  assert.equal(layout.slots.filter((s) => s.tag === 'queueOverflow').length, 6);
  assert.equal(POINTS.pitSeats.length, 24, 'sofa ring 12 + steps 8 + beanbags 4 (§6.4.4)');
  assert.equal(layout.slots.filter((s) => s.tag === 'shellBench').length, 10);
  assert.equal(layout.slots.filter((s) => s.tag === 'hotdesk').length, 8);
  for (const b of BAYS) assert.ok(b.nap && b.amenitySlots.length >= 2, `${b.id} nap + amenity`);
  const ids = new Set(layout.slots.map((s) => s.id));
  assert.equal(ids.size, layout.slots.length, 'slot ids unique');
});

test('hq: queue head at the teller window, 1.0 m pitch, serpentine; spawn at (20.5, 26.5)', () => {
  const q = [...Array(10)].map((_, i) => slotOf(`slot:queue:${i}`));
  const head = W(16.05, 20.5);
  assert.ok(Math.hypot(q[0].pos.x - head.x, q[0].pos.z - head.z) < 0.25);
  const counter = need(layout.furniture.find((f) => f.id === 'counter0'));
  assert.ok(Math.abs(q[0].pos.x - counter.pos.x) < counter.size[0] / 2 - 0.3, 'head in front of the teller counter');
  for (let i = 1; i < 10; i++) assert.ok(Math.abs(Math.hypot(q[i].pos.x - q[i - 1].pos.x, q[i].pos.z - q[i - 1].pos.z) - 1.0) < 0.05, `pitch ${i}`);
  for (let i = 1; i < 10; i++) { // each spot faces the one ahead
    const want = Math.atan2(-(q[i - 1].pos.x - q[i].pos.x), -(q[i - 1].pos.z - q[i].pos.z));
    assert.ok(Math.abs(Math.atan2(Math.sin(q[i].yaw - want), Math.cos(q[i].yaw - want))) < 0.01, `queue ${i} faces ${i - 1}`);
  }
  assert.deepEqual(layout.spawn.slice(0, 3), [0, 0, 12.5]);
  // every queue spot stands in the lane (a queue-member-only rect), overflow spots outside it
  const inLane = (s: Slot) => layout.queueRects.some((r) => inRect(r, s.pos.x, s.pos.z));
  for (const s of q) assert.ok(inLane(s), `${s.id} in the lane`);
  for (const s of layout.slots.filter((t) => t.tag === 'queueOverflow')) assert.ok(!inLane(s), `${s.id} outside the lane`);
});

test('hq: neighbours never merge: queue ≥ 1.0 m (lane + overflow ≥ 0.95), Pit sofa seats ≥ 0.95 m apart', () => {
  const minGap = (tags: string[]): [number, string] => {
    const ss = layout.slots.filter((s) => tags.includes(s.tag));
    let m = Infinity, pair = '';
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) {
      const d = Math.hypot(ss[i].pos.x - ss[j].pos.x, ss[i].pos.z - ss[j].pos.z);
      if (d < m) { m = d; pair = `${ss[i].id}/${ss[j].id}`; }
    }
    return [m, pair];
  };
  const [q, qp] = minGap(['queue']); assert.ok(q >= 1.0 - 1e-6, `queue ${qp} ${q.toFixed(2)} m`);
  const [o, op] = minGap(['queue', 'queueOverflow']); assert.ok(o >= 0.95 - 1e-6, `queue + overflow ${op} ${o.toFixed(2)} m`);
  const [f, fp] = minGap(['sofa']); assert.ok(f >= 0.95 - 1e-6, `sofa ${fp} ${f.toFixed(2)} m`);
  assert.equal(layout.slots.filter((s) => s.tag === 'sofa').length, 12);
});

test('hq P1: from the spawn every queue + overflow spot (feet to the top of its bubble) is in frame at 16:9 and 1366×768, ≤ 30° off axis', () => {
  const [sx, , sz, yaw] = layout.spawn;
  const { ndc, rx, rz } = camera(layout.spawn);
  const spots = layout.slots.filter((s) => s.tag === 'queue' || s.tag === 'queueOverflow');
  assert.equal(spots.length, 16);
  for (const s of spots) {
    const off = Math.atan2(-(s.pos.x - sx) * Math.cos(yaw) + (s.pos.z - sz) * Math.sin(yaw), -(s.pos.x - sx) * Math.sin(yaw) - (s.pos.z - sz) * Math.cos(yaw));
    assert.ok(Math.abs(off) <= (30 * Math.PI) / 180, `${s.id} ${((off * 180) / Math.PI).toFixed(1)}° off the spawn axis`);
    for (const aspect of [16 / 9, 1366 / 768]) {
      // body (±0.4 m) at the feet, and the alert bubble (±0.6 m wide) 1.6 m above the 0.9 m head
      for (const [dy, half] of [[0, 0.4], [0.9 + 1.6, 0.6]]) for (const e of [-1, 1]) {
        const p = ndc({ x: s.pos.x + rx * half * e, y: dy, z: s.pos.z + rz * half * e }, aspect);
        assert.ok(p.cf > 0 && Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 0.98, `${s.id} (y ${dy}) outside the ${aspect.toFixed(3)} frame: ndc ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
      }
    }
  }
  // the P1 anchors stay in frame too: RAM column and the Big Board
  for (const a of [POINTS.ramColumn, POINTS.bigBoard]) {
    const p = ndc({ x: a.x, y: a === POINTS.bigBoard ? a.y : 1.5, z: a.z }, 16 / 9);
    assert.ok(Math.abs(p.x) <= 0.9 && Math.abs(p.y) <= 0.95, `P1 anchor (${a.x}, ${a.z}) in frame: ndc ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
  }
});

test('hq engine pose: the first 4 shell-bench seats (fill order) are in frame at 16:9 and 1366×768, facing the glass', () => {
  const pose = POSES.engine.pose;
  const { ndc, rx, rz } = camera(pose);
  const seats = [0, 1, 2, 3].map((i) => slotOf(`slot:shellBench:${i}`));
  for (const s of seats) {
    const y0 = layout.floorY(s.pos.x, s.pos.z, 0);
    // faces the atrium glass (west) — and the camera, which looks east
    assert.ok(Math.abs(Math.atan2(Math.sin(s.yaw - Math.PI / 2), Math.cos(s.yaw - Math.PI / 2))) < 0.01, `${s.id} faces west`);
    for (const aspect of [16 / 9, 1366 / 768]) {
      // the seated shell (±0.35 m) from its seat to 0.5 m over its head (≈ 1.3 m)
      for (const dy of [0.45, 1.3]) for (const e of [-1, 1]) {
        const p = ndc({ x: s.pos.x + rx * 0.35 * e, y: y0 + dy, z: s.pos.z + rz * 0.35 * e }, aspect);
        assert.ok(p.cf > 0 && Math.abs(p.x) <= 0.9 && Math.abs(p.y) <= 0.95, `${s.id} outside the engine ${aspect.toFixed(3)} frame: ndc ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
      }
    }
  }
  // …and the pose still looks at the rack wall (its centre face) and the card table
  const rack = need(layout.furniture.find((f) => f.id === 'rackWall'));
  const card = need(layout.furniture.find((f) => f.type === 'cardTable'));
  for (const [f, y] of [[rack, 1.3], [card, 0.75]] as const) {
    const p = ndc({ x: f.pos.x, y, z: f.pos.z }, 16 / 9);
    assert.ok(p.cf > 0 && Math.abs(p.x) <= 0.5 && Math.abs(p.y) <= 0.8, `${f.type} centred: ndc ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
  }
});

test('hq rail overlook (LVL fix r3): from the closest the player gets to the mezzanine rail, looking down (pitch −0.3), the cap is below the frame', () => {
  const rails = layout.walls.filter((w) => w.kind === 'rail');
  assert.ok(rails.length >= 3 && rails.every((w) => w.h <= 0.85), 'rails ≤ 0.85 m');
  // walk south along the rail run (plan x 20.5, from z 5.8: the hot-desk bench is north of it, LVL fix m175 r2) until the player circle touches the rail
  const x = W(20.5, 0).x;
  let z = W(0, 5.8).z;
  while (!nav.collides(x, z + 0.01, 0.28, 1)) z += 0.01;
  const railZ = W(0, 7).z, y = layout.floorY(x, z, 1);
  // [LVL fix m2 r1] rails rasterize without the half-cell slack: the player leans on the glass (was 0.53 m back)
  assert.ok(railZ - z < 0.35, `player reaches ${(railZ - z).toFixed(2)} m from the rail`);
  const { ndc } = camera([x, y, z, Math.PI, -0.3]);
  const cap = ndc({ x, y: y + rails[0].h + 0.022, z: railZ }, 16 / 9);
  assert.ok(cap.y < -1, `rail cap at ndc y ${cap.y.toFixed(2)} (want it below the frame, < −1)`);
});

test('hq rails (LVL fix m2 r1): every balustrade runs on its level\'s open edge (walkable on one side, blocked on the other)', () => {
  for (const w of layout.walls.filter((q) => q.kind === 'rail')) {
    const [ax, az] = w.a, [bx, bz] = w.b, len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue; // the landing→stairs stub
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (const s of [0.25, 0.5, 0.75]) {
      const px = ax + (bx - ax) * s, pz = az + (bz - az) * s;
      const a = nav.walkable(px + nx * 0.15, pz + nz * 0.15, 1), b = nav.walkable(px - nx * 0.15, pz - nz * 0.15, 1);
      assert.ok(a !== b, `rail (${ax.toFixed(1)},${az.toFixed(1)})→(${bx.toFixed(1)},${bz.toFixed(1)}) at ${s}: sides ${a}/${b}`);
    }
  }
});

test('hq mezzToPit pose (LVL fix m2 r1): the rail cap is out of frame (16:9, 1366×768, 4:3); Board and queue in it', () => {
  const pose = POSES.mezzToPit.pose;
  const { ndc } = camera(pose);
  for (const w of layout.walls.filter((q) => q.kind === 'rail')) {
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const p = { x: w.a[0] + (w.b[0] - w.a[0]) * s, y: (w.y0 ?? 0) + w.h + 0.022, z: w.a[1] + (w.b[1] - w.a[1]) * s };
      for (const aspect of [16 / 9, 1366 / 768, 4 / 3]) {
        const q = ndc(p, aspect);
        assert.ok(!(q.cf > 0.05 && Math.abs(q.x) <= 1 && q.y >= -1), `cap point (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) in frame at ndc ${q.x.toFixed(2)}, ${q.y.toFixed(2)}`);
      }
    }
  }
  const board = ndc({ x: POINTS.bigBoard.x, y: POINTS.bigBoard.y, z: POINTS.bigBoard.z }, 16 / 9);
  assert.ok(board.cf > 0 && Math.abs(board.x) < 0.5 && board.y < 0.8 && board.y > -0.2, `Board ndc ${board.x.toFixed(2)}, ${board.y.toFixed(2)}`);
  for (const q of POINTS.queue) {
    const p = ndc({ x: q.x, y: 1.0, z: q.z }, 16 / 9);
    assert.ok(p.cf > 0 && Math.abs(p.x) <= 0.95 && Math.abs(p.y) <= 0.95, `queue slot (${q.x.toFixed(2)}, ${q.z.toFixed(2)}) ndc ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
  }
});

test('hq nav: every slot and every station slot is reachable from spawn (levels, queue members, bay owners)', () => {
  for (const s of layout.slots) {
    const opts = { queue: /^queue/.test(s.tag), owner: s.bay ?? null };
    const r = nav.route(spawn, at(s), opts);
    assert.ok(r, `unreachable ${s.id}`);
    if (s.level === 1) assert.deepEqual(r.portals, ['stairs'], `${s.id} via the stairs`);
  }
  for (const st of STATIONS) assert.ok(st.slots.length >= 2 && st.slots.every((id) => slotById.has(id)), st.id);
});

test('hq nav: slots stand on open floor (raw grid of their level) and never inside a solid footprint', () => {
  for (const s of layout.slots) {
    const opts = { queue: /^queue/.test(s.tag), owner: s.bay ?? null };
    assert.ok(nav.walkable(s.pos.x, s.pos.z, s.level, opts) || s.pose !== 'stand', `${s.id} not walkable`);
    for (const f of layout.furniture) {
      if (!f.solid || (f.level ?? 0) !== s.level || (s.pose !== 'stand' && s.anchor === f.id)) continue; // seats sit in their sofa
      assert.ok(!inRect(footprint(f), s.pos.x, s.pos.z), `${s.id} inside ${f.id}`);
    }
  }
});

test('hq nav: with the full queue (10 lane + 6 overflow) as obstacles, every door is reachable from spawn and every bay desk; spawn → Pit south gap grows ≤ 10%', () => {
  const obstacles = layout.slots.filter((s) => s.tag === 'queue' || s.tag === 'queueOverflow').map((s) => ({ x: s.pos.x, z: s.pos.z, r: 0.36 }));
  const full = createNav(layout, { obstacles });
  const froms: (NavPoint & { owner?: string })[] = [spawn, ...BAYS.flatMap((b) => b.desks.map((id) => ({ ...at(slotOf(id)), owner: b.id })))];
  for (const d of DOORS) {
    for (const ap of d.aprons) {
      if (d.id === 'entrance' && ap.z > layout.bounds.maxZ) continue; // outside
      const to = { x: ap.x, z: ap.z, level: 0 };
      for (const f of froms) assert.ok(full.route(f, to, { owner: f.owner ?? d.private ?? null }), `door ${d.id} apron (${ap.x.toFixed(1)}, ${ap.z.toFixed(1)}) unreachable from (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`);
    }
  }
  const gap = { ...POINTS.pitSouthGap, level: 0 };
  const a = need(nav.route(spawn, gap)).length, b = need(full.route(spawn, gap)).length;
  assert.ok(b <= a * 1.1, `spawn → Pit south gap ${a.toFixed(2)} → ${b.toFixed(2)} m with a full queue`);
});

test('hq nav: private back doors are for owners (and the player) only', () => {
  for (const b of BAYS.filter((q) => q.backDoor)) {
    const door = need(DOORS.find((d) => d.id === b.backDoor));
    const desk = at(slotOf(b.desks[3])); // the column by the back wall
    const beyond = need(door.aprons.find((p) => layout.zoneAt(p.x, p.z) !== b.id));
    const other = nav.route(desk, { ...beyond, level: 0 }, { owner: need(BAYS.find((q) => q.id !== b.id)).id });
    const own = nav.route(desk, { ...beyond, level: 0 }, { owner: b.id });
    assert.ok(other && own, b.id);
    assert.ok(!crossesDoor(other.points, door), `${b.id}: a stranger used the back door`);
    assert.ok(crossesDoor(own.points, door), `${b.id}: the owner did not use its back door`);
    assert.ok(own.length < other.length, `${b.id}: back door is the shortcut`);
    assert.ok(!nav.collides(door.pos.x, door.pos.z, 0.28), `${b.id}: the player fits through`);
  }
});

test('hq nav: the queue lane is roped for everyone but queue members; the player walks around it', () => {
  const [x0, z0, x1, z1] = layout.queueLane;
  const mid = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  assert.equal(nav.walkable(mid.x, mid.z), false);
  assert.equal(nav.walkable(mid.x, mid.z, 0, { queue: true }), true);
  assert.ok(nav.collides(mid.x, mid.z, 0.28));
  const p = nav.route(W(15, 18.2), W(15.5, 22.3));
  assert.ok(p && !p.points.some((q) => layout.queueRects.some((r) => inRect(r, q.x, q.z))), 'non-members route round the lane');
});

test('hq mezzanine rail run (LVL fix m175 r2): no seat, slot or prop in the landing → slide walk; the route keeps ≥ 0.6 m off every seat', () => {
  const run = [RAIL_RUN[0] - 20.5, RAIL_RUN[1] - 14, RAIL_RUN[2] - 20.5, RAIL_RUN[3] - 14];
  const seats = layout.slots.filter((s) => s.level === 1);
  for (const s of seats) {
    assert.ok(!inRect(run, s.pos.x, s.pos.z), `${s.id} in the rail run`);
    assert.ok(s.pos.z <= run[1] - 0.6 || s.tag === 'slide', `${s.id} ${(run[1] - s.pos.z).toFixed(2)} m from the rail run (< 0.6)`);
  }
  for (const f of layout.furniture.filter((q) => (q.level ?? 0) === 1 && q.pos.y < 2.9 + 0.3)) {
    const b = footprint(f);
    assert.ok(b[3] <= run[1] || b[1] >= run[3] || b[2] <= run[0] || b[0] >= run[2], `${f.id} (${f.type}) in the rail run`);
  }
  // stair landing → the slide mouth, and back: the string-pulled path stays ≥ 0.6 m from every hot-desk / stool slot
  const top = { ...POINTS.stairsTop, level: 1 }, mouth = { ...POINTS.slideMouth, z: POINTS.slideMouth.z - 0.5, level: 1 };
  for (const [a, b] of [[top, mouth], [mouth, top]]) {
    const r = nav.route(a, b);
    assert.ok(r, 'landing ↔ slide mouth routable');
    const pts = r.points;
    for (const s of seats.filter((q) => q.tag === 'hotdesk')) {
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i], dx = p1.x - p0.x, dz = p1.z - p0.z, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((s.pos.x - p0.x) * dx + (s.pos.z - p0.z) * dz) / L2));
        const d = Math.hypot(p0.x + t * dx - s.pos.x, p0.z + t * dz - s.pos.z);
        assert.ok(d >= 0.6, `route passes ${d.toFixed(2)} m from ${s.id}`);
      }
    }
  }
});

test('hq nav: stairs are two-way, the slide is one-way', () => {
  const up = need(nav.route(POINTS.slideExit, { ...POINTS.slideMouth, level: 1 }));
  assert.deepEqual(up.portals, ['stairs'], 'nobody climbs the slide');
  const down = need(nav.route({ ...W(15.4, 6.2), level: 1 }, { ...POINTS.slideExit, level: 0 }));
  assert.deepEqual(down.portals, ['slide'], 'mezzanine → atrium by the slide when it is shorter');
  const pitToMezz = nav.route({ ...POINTS.pitSouthGap, level: 0 }, { ...W(24, 4), level: 1 });
  const mezzToLobby = nav.route({ ...W(24, 4), level: 1 }, { ...POINTS.spawn, level: 0 });
  assert.ok(pitToMezz && mezzToLobby);
  assert.ok(need(PORTALS.find((p) => p.id === 'stairs')).twoWay && !need(PORTALS.find((p) => p.id === 'slide')).twoWay);
  // route points carry levels; the stair centreline flips level at half height
  assert.ok(pitToMezz);
  assert.equal(pitToMezz.points[0].level, 0); assert.equal(pitToMezz.points.at(-1)?.level, 1);
});

test('hq: keep-clear rects hold no slot, overflow spot, queue member or prop', () => {
  for (const k of KEEP_CLEAR) {
    for (const s of layout.slots) {
      if (k.headSlotOnly && s.id === 'slot:queue:0') continue;
      assert.ok(!inRect(k.rect, s.pos.x, s.pos.z), `${s.id} in keep-clear ${k.id}`);
    }
    for (const f of layout.furniture) {
      if (['rug', 'mat', 'medallion', 'podRug', 'queueMat', 'dais', 'stairs', 'slide', 'bigBoard', 'banner'].includes(f.type) || (f.level ?? 0) !== 0) continue;
      if (f.pos.y > 1.8) continue; // overhead (signs, lamps)
      if (k.headSlotOnly && f.id === 'counter0') continue; // the approach strip is the counter's front edge
      assert.ok(!overlap(footprint(f), k.rect), `${f.id} (${f.type}) in keep-clear ${k.id}`);
    }
    // nav treats them as walkable
    const cx = (k.rect[0] + k.rect[2]) / 2, cz = (k.rect[1] + k.rect[3]) / 2;
    if (!k.id.startsWith('door:') && !k.headSlotOnly) assert.ok(nav.walkable(cx, cz), `${k.id} walkable`);
  }
});

test('hq floorY: Pit rings, ENG +0.25, stairs ramp, mezzanine only on level 1', () => {
  const y = (px: number, pz: number, l = 0) => layout.floorY(px - 20.5, pz - 14, l);
  assert.equal(y(20.5, 14), -0.45); assert.equal(y(20.5, 14 + 3.1), -0.3); assert.equal(y(20.5, 14 + 3.7), -0.15); assert.equal(y(20.5, 18.5), 0);
  assert.equal(y(35, 15), 0.25);
  assert.ok(Math.abs(y(27, 13) - 1.45) < 1e-9); assert.equal(y(27, 16.5), 0); assert.ok(Math.abs(y(27, 9.5) - 2.9) < 1e-9);
  assert.equal(y(20, 3, 1), 2.9); assert.equal(y(20, 3, 0), 0);
  assert.deepEqual(layout.floorAt(20 - 20.5, 3 - 14, 2.9), { y: 2.9, level: 1 });
  assert.deepEqual(layout.floorAt(20 - 20.5, 3 - 14, 0), { y: 0, level: 0 });
  assert.equal(layout.floorAt(27 - 20.5, 11 - 14, 2.0).level, 1);
});

test('hq: every door-like opening has a DOOR with aprons in two different zones; zoneAt covers the plan', () => {
  for (const d of DOORS) assert.notEqual(d.zones[0], d.zones[1], d.id);
  for (let px = 0.25; px < 42; px += 0.5) for (let pz = 0.25; pz < 28; pz += 0.5) assert.ok(layout.zoneAt(px - 20.5, pz - 14), `${px},${pz}`);
});

test('hq poses: canonical cameras stand on open floor of their level, clear of solid furniture', () => {
  // [LVL m3 fix r2] raised lenses (feet above the floor, m): `serve` leans over the Help Desk counter (eye 2.1 m) so
  // the queue head's whole face clears the counter's front edge
  const RAISED: Record<string, number> = { serve: 0.9 };
  for (const [name, p] of Object.entries(POSES)) {
    if (p.layout !== 'hq' || name === 'plan') continue;
    const [x, y, z] = p.pose;
    const level = y > 1.5 ? 1 : 0;
    assert.ok(!nav.collides(x, z, 0.28, level), `${name} collides`);
    assert.ok(Math.abs(layout.floorY(x, z, level) + (RAISED[name] ?? 0) - y) < 0.35, `${name} feet ${y} vs floor ${layout.floorY(x, z, level)}`);
  }
});

test('proto nav still works through the level-aware grid (one level, doors open)', () => {
  const pn = createNav(proto);
  for (const s of proto.slots) assert.ok(pn.path({ x: proto.spawn[0], z: proto.spawn[2] }, at(s)), s.id);
});

test('hq nav budget (§5.3): tryRoute runs ≤ 2 fresh grid searches per frame, queues the rest, serves them next frame', () => {
  const n = createNav(layout);
  const froms = BAYS.map((b) => at(slotById.get(b.desks[0])));
  const to = { ...POINTS.zone.ENG, level: 0 };
  n.frame();
  const first = froms.map((f) => n.tryRoute(f, to));
  const done = first.filter((r) => r !== undefined).length;
  assert.ok(done >= 1 && done < froms.length, `served ${done} of ${froms.length} in one frame`);
  assert.ok(n.budgetStats().searches <= 2, 'at most 2 searches this frame');
  let frames = 1;
  while (froms.some((f) => n.tryRoute(f, to) === undefined) && frames < 40) { n.frame(); frames++; }
  assert.ok(frames < 40, 'every queued route resolves');
  for (const f of froms) assert.deepEqual(n.tryRoute(f, to)?.length, n.route(f, to)?.length, 'budgeted = unbudgeted route');
  n.frame();
  froms.forEach((f) => n.tryRoute(f, to));
  assert.equal(n.budgetStats().searches, 0, 'repeat requests are cache hits');
});

test('hq vis cells: the authored table covers every sampled line of sight; camera cells', async () => {
  const { sampleVisibility, cellAt } = await import('./vis.ts');
  const sampled = sampleVisibility(layout, { step: 0.75, rays: 360 });
  for (const c of layout.visCells) {
    assert.ok(c.visible.includes(c.id), `${c.id} sees itself`);
    for (const id of sampled[c.id] ?? []) assert.ok(c.visible.includes(id), `${c.id} → ${id} is visible (sampled) but missing from VIS_TABLE`);
  }
  assert.equal(cellAt(layout, 0, 1.2, 12.5), 'LOB');
  assert.equal(cellAt(layout, 0, 4.1, -9), 'MEZ');
  assert.equal(cellAt(layout, 0, 1.2, -9), 'LIB');
  assert.equal(cellAt(layout, 0, 32, 0), null, 'above the roof: everything');
});

test('hq lanes (§7.1 density): rect lanes ≤ 2.0 m across, the atrium ring is an annulus ≤ 2.5 m wide', () => {
  for (const l of layout.lanes) {
    if (l.annulus) { assert.ok(l.annulus[3] - l.annulus[2] <= 2.5, `${l.id} ring width`); continue; }
    const r = need(l.rect), w = Math.abs(r[2] - r[0]), d = Math.abs(r[3] - r[1]);
    assert.ok(Math.min(w, d) <= 2.0 + 1e-9, `${l.id} short side ${Math.min(w, d).toFixed(2)} m`);
  }
});

test('hq camera wells (LVL fix m2 r1): solid for agents, open for the player; no slot inside; the lens stands in one', () => {
  const wells = need(need(layout.levels.find((l) => l.id === 0)).cameraWells);
  const inWell = (x: number, z: number) => wells.some((k) => ('rect' in k ? inRect(k.rect, x, z) : Math.hypot(x - k.circle[0], z - k.circle[1]) <= k.circle[2]));
  for (const s of layout.slots.filter((q) => (q.level ?? 0) === 0)) assert.ok(!inWell(s.pos.x, s.pos.z), `${s.id} in a camera well`);
  for (const name of ['eBayGlass', 'library', 'lab', 'street']) {
    const [x, , z] = POSES[name].pose;
    assert.ok(inWell(x, z), `${name} stands in a well`);
    assert.ok(!nav.walkable(x, z, 0), `${name}: agents can't stand on the lens`);
    assert.ok(nav.walkable(x, z, 0, { owner: '*' }), `${name}: the player can`);
  }
});

test('hq library / lab poses (LVL fix m2 r1): inside views; the station seats are in frame, ≥ 1.5 m from the lens', () => {
  const check = (name: string, ids: string[], facing: boolean) => {
    const pose = POSES[name].pose;
    const { ndc } = camera(pose);
    for (const id of ids) {
      const s = slotOf(id);
      assert.ok(Math.hypot(s.pos.x - pose[0], s.pos.z - pose[2]) >= 1.5, `${id} too near the ${name} lens`);
      for (const aspect of [16 / 9, 1366 / 768]) for (const dy of [0.4, 1.1]) {
        const p = ndc({ x: s.pos.x, y: dy, z: s.pos.z }, aspect);
        assert.ok(p.cf > 0 && Math.abs(p.x) <= 0.95 && Math.abs(p.y) <= 0.95, `${id} outside the ${name} frame: ndc ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
      }
      if (facing) { // the sitter faces the lens (within 60°)
        const toCam = Math.atan2(-(pose[0] - s.pos.x), -(pose[2] - s.pos.z));
        assert.ok(Math.abs(Math.atan2(Math.sin(s.yaw - toCam), Math.cos(s.yaw - toCam))) < Math.PI / 3, `${id} faces the ${name} lens`);
      }
    }
  };
  check('library', ['slot:station:library:2', 'slot:station:library:5'], true);
  check('lab', ['slot:station:lab:0', 'slot:station:lab:1', 'slot:station:lab:2', 'slot:station:lab:3'], false);
});
