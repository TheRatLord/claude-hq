import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirector, assignDesks, podsOf, detour } from './director.ts';
import { testLayout, testNav, ent, must } from './testkit.ts';
import type { Director } from './director.ts';
import type { Layout } from '../../world/layout/schema.ts';
import type { Entity } from '../../../../shared/protocol.ts';
import { createDirector as _cd, cameraSpots } from './director.ts';
import { layout as proto } from '../../world/layout/proto.ts';
import { createNav } from '../../world/nav/index.ts';

const deskMap = (d: Director, ids: string[]) => ids.map((id) => d.slotFor(id)?.id ?? null);
const podOfDesk = (layout: Layout, slotId: string) => layout.slots.find((s) => s.id === slotId)?.pod;

test('pods: layout pod field, else 3 contiguous groups', () => {
  const L = testLayout();
  assert.deepEqual(podsOf(L.slots.filter((s) => s.tag === 'desk')).map((p) => p.length), [4, 4, 4]);
  const L2 = testLayout({ pods: false });
  assert.deepEqual(podsOf(L2.slots.filter((s) => s.tag === 'desk')).map((p) => p.length), [4, 4, 4]);
});

test('desk rule (D7): pod = workspace.slot mod 3, first free in pod, else any free desk', () => {
  const L = testLayout();
  const d = createDirector(L, testNav());
  const ents = new Map<string, Entity>();
  // workspace slot 1 has 6 panes → 4 in pod 1, 2 overflow elsewhere; slot 3 → pod 0.
  for (let i = 0; i < 6; i++) { const e = ent({ i, workspace: { slot: 1, colorIndex: 1 }, tab: { index: i }, paneIndex: 0 }); ents.set(e.id, e); }
  const e3 = ent({ i: 50, workspace: { slot: 3 } }); ents.set(e3.id, e3);
  d.update(ents, 0);
  const pods = [...ents.keys()].slice(0, 6).map((id) => podOfDesk(L, must(d.slotFor(id)).id));
  assert.equal(pods.filter((p) => p === 1).length, 4);
  assert.equal(podOfDesk(L, must(d.slotFor(e3.id)).id), 0);
  const all = [...ents.keys()].map((id) => must(d.slotFor(id)).id);
  assert.equal(new Set(all).size, all.length, 'no double booking');
});

test('two windows (any insertion order, fresh directors) get the same desks', () => {
  const L = testLayout();
  const ents = new Map<string, Entity>();
  for (let i = 0; i < 12; i++) { const e = ent({ i, workspace: { slot: i % 4 }, tab: { index: i % 3 }, paneIndex: i % 2 }); ents.set(e.id, e); }
  const d1 = createDirector(L, testNav());
  const d2 = createDirector(L, testNav());
  d1.update(ents, 0);
  d2.update(new Map([...ents].reverse()), 0);
  const ids = [...ents.keys()];
  assert.deepEqual(deskMap(d1, ids), deskMap(d2, ids));
  assert.ok(deskMap(d1, ids).every(Boolean));
});

test('churn: panes leaving/arriving never move the others; re-key keeps the desk', () => {
  const L = testLayout();
  const d = createDirector(L, testNav());
  const ents = new Map<string, Entity>();
  for (let i = 0; i < 9; i++) { const e = ent({ i, workspace: { slot: i % 3 }, tab: { index: Math.floor(i / 3) } }); ents.set(e.id, e); }
  d.update(ents, 0);
  const before = new Map([...ents.keys()].map((id) => [id, must(d.slotFor(id)).id]));
  let rnd = 7;
  for (let k = 0; k < 200; k++) {
    rnd = (rnd * 16807) % 2147483647;
    const id = `d1:p${100 + (rnd % 5)}`;
    if (ents.has(id)) { ents.delete(id); d.forget(id); } else ents.set(id, ent({ i: 100 + (rnd % 5), workspace: { slot: rnd % 3 }, tab: { index: rnd % 4 } }));
    d.update(ents, k * 100);
    for (const [oid, desk] of before) assert.equal(must(d.slotFor(oid)).id, desk, `${oid} moved at step ${k}`);
  }
  // Re-key: new id, same pane → same desk.
  const old = 'd1:p4';
  const desk = must(d.slotFor(old)).id;
  const e = { ...must(ents.get(old)), id: 'd1:p999' };
  d.rekey(old, e.id);
  ents.delete(old); ents.set(e.id, e);
  d.update(ents, 99_999);
  assert.equal(must(d.slotFor(e.id)).id, desk);
});

test('pins: queue after 10 s blocked ordered by statusSince, sofa for unacked done; pins evict chill claims', () => {
  const L = testLayout();
  const d = createDirector(L, testNav());
  const ents = new Map<string, Entity>();
  const b1 = ent({ i: 1, status: 'blocked', statusSince: 5_000 });
  const b2 = ent({ i: 2, status: 'blocked', statusSince: 1_000 });
  const b3 = ent({ i: 3, status: 'blocked', statusSince: 19_000 }); // < 10 s at now=25 s
  const dn = ent({ i: 4, status: 'idle', statusSince: 0 });
  const ack = ent({ i: 5, status: 'done', statusSince: 0, ack: { at: 1, by: 'hq' } });
  const idle = ent({ i: 6 });
  for (const e of [b1, b2, b3, dn, ack, idle]) ents.set(e.id, e);
  d.update(ents, 0);
  assert.equal(must(d.claim(idle.id, 'sofa')).id, 'slot:sofa:0');
  ents.set(dn.id, { ...dn, status: 'done' });
  d.update(ents, 25_000);
  assert.equal(must(d.pinFor(b2.id)).id, 'slot:queue:0');
  assert.equal(must(d.pinFor(b1.id)).id, 'slot:queue:1');
  assert.equal(d.pinFor(b3.id), null);
  assert.equal(must(d.pinFor(dn.id)).id, 'slot:sofa:0');
  assert.equal(d.pinFor(ack.id), null);
  assert.equal(d.holds(idle.id, 'slot:sofa:0'), false, 'evicted by the done pin');
  assert.equal(d.holds(dn.id, 'slot:sofa:0'), true);
  assert.ok(d.chillTags.includes('window'), 'window spots come from wall openings');
});

test('full determinism: assignDesks is a pure function of the entity set', () => {
  const L = testLayout();
  const pods = podsOf(L.slots.filter((s) => s.tag === 'desk'));
  const ents = Array.from({ length: 20 }, (_, i) => ent({ i: 200 + i, workspace: { slot: i % 5 }, paneIndex: i % 3 }));
  const a = assignDesks(ents, pods), b = assignDesks([...ents].reverse(), pods);
  assert.equal(a.size, 12, '12 desks, 8 without');
  for (const [k, v] of a) assert.equal(must(b.get(k)).id, v.id);
});

test('detour: routes around a solid footprint', () => {
  const box = { x0: -1, x1: 1, z0: -0.5, z1: 0.5 };
  const pts = detour([{ x: -2, z: 0 }, { x: 2, z: 0 }], [box]);
  assert.ok(pts.length > 2);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    for (let k = 0; k <= 20; k++) {
      const x = p.x + (q.x - p.x) * (k / 20), z = p.z + (q.z - p.z) * (k / 20);
      assert.ok(!(x > box.x0 + 1e-3 && x < box.x1 - 1e-3 && z > box.z0 + 1e-3 && z < box.z1 - 1e-3), `inside at ${x},${z}`);
    }
  }
});

test('proto overflow: nobody stands within 1.5 m of a canonical camera; back strip before the front aisle', () => {
  const d = _cd(proto, createNav(proto));
  const cams = cameraSpots(proto);
  assert.ok(cams.length >= 5);
  const ents = new Map<string, Entity>();
  for (let i = 0; i < 33; i++) { const e = ent({ i: 300 + i, workspace: { slot: i % 5 }, tab: { index: i % 4 }, paneIndex: i % 3 }); ents.set(e.id, e); }
  d.update(ents, 0);
  const { floor, lounge } = d.spots();
  for (const s of [...floor, ...lounge, ...[...ents.keys()].map((id) => must(d.slotFor(id))).filter((s) => s.tag !== 'desk')]) {
    for (const c of cams) assert.ok(Math.hypot(s.pos.x - c.x, s.pos.z - c.z) >= 1.5, `${s.id} near camera ${c.x},${c.z}`);
  }
  const homes = [...ents.keys()].map((id) => must(d.slotFor(id)));
  const over = homes.filter((s) => s.tag === 'floor');
  assert.equal(over.length, 21);
  const back = over.filter((s) => s.pos.z < -1.5).length;
  assert.ok(back >= 8, `the back strip is full (${back}/21)`);
  // a small crowd stands at the back: the first clear-sightline spots are all in the back strip
  assert.ok(floor.slice(0, 4).every((s) => s.pos.z < -2.5), 'first overflow spots at the back');
  for (const s of [...floor, ...lounge]) assert.equal(s.pose, 'stand');
  // Bodies never overlap: centre spacing ≥ body width (0.72 m) + 0.2 m between any two standers (review r3).
  const standers = [...floor, ...lounge];
  let minD = Infinity;
  for (let i = 0; i < standers.length; i++) {
    for (let j = i + 1; j < standers.length; j++) minD = Math.min(minD, Math.hypot(standers[i].pos.x - standers[j].pos.x, standers[i].pos.z - standers[j].pos.z));
  }
  assert.ok(minD >= 0.72 + 0.2, `overflow min spacing ${minD.toFixed(2)} m`);
  // The clear-sightline spots: nobody stands within 1.5 m inside a ±35° cone in front of them (faces read, not backs);
  // only the 'any' tier (a crowd beyond the rest) may stand in someone's view.
  const clear = floor.filter((s) => s.view === 'clear'), kept = floor.filter((s) => s.view !== 'any');
  assert.ok(clear.length >= 12 && kept.length >= 15 && floor.length >= 21, `spots: ${clear.length} clear, ${kept.length} kept, ${floor.length}`);
  for (const p of clear) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (const q of [...kept, ...lounge]) {
      if (q === p) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, dd = Math.hypot(dx, dz);
      assert.ok(!(dd < 1.5 && (fx * dx + fz * dz) / dd > Math.cos(35 * Math.PI / 180)), `${q.id} stands in front of ${p.id}`);
    }
    // facing into the room (its middle), never a wall or a neighbour's back
    const tc = Math.hypot(p.pos.x, p.pos.z);
    assert.ok((fx * -p.pos.x + fz * -p.pos.z) / tc > 0.7, `${p.id} faces into the room`);
  }
  // the spawn view's foreground (≤ 4.5 m, inside the frame) is the very last resort: 18 overflow never stand there
  const [sx, , sz, syaw] = proto.spawn;
  const inSpawnFg = (s: { pos: { x: number; z: number } }) => {
    const dx = s.pos.x - sx, dz = s.pos.z - sz, dd = Math.hypot(dx, dz);
    return dd < 4.5 && (-Math.sin(syaw) * dx - Math.cos(syaw) * dz) / dd > 0.62;
  };
  assert.deepEqual(floor.slice(0, 18).filter(inSpawnFg).map((s) => s.id), []);
  // doorway and sofa-seat fronts stay clear of standers
  const ent0 = proto.points.entrance;
  for (const s of [...floor, ...lounge]) {
    assert.ok(Math.hypot(s.pos.x - ent0.x, s.pos.z - ent0.z) >= 1.4, `${s.id} blocks the door`);
    for (const q of proto.slots.filter((x) => x.tag === 'sofa')) {
      assert.ok(Math.hypot(s.pos.x - (q.pos.x - Math.sin(q.yaw) * 0.5), s.pos.z - (q.pos.z - Math.cos(q.yaw) * 0.5)) >= 0.9, `${s.id} blocks ${q.id}`);
    }
  }
  // with the crowd standing, every desk still reaches the help queue on the body-width router (no straight-line fallback)
  const q = must(proto.slots.find((x) => x.tag === 'queue'));
  for (const s of proto.slots.filter((x) => x.tag === 'desk')) {
    const ap = { x: s.pos.x + Math.sin(s.yaw) * 0.6, z: s.pos.z + Math.cos(s.yaw) * 0.6 };
    const r = must(d.route(ap, { x: q.pos.x, z: q.pos.z }));
    for (const st of over) {
      for (let k = 1; k < r.length; k++) {
        const a = r[k - 1], b = r[k], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const t = Math.max(0, Math.min(1, ((st.pos.x - a.x) * (b.x - a.x) + (st.pos.z - a.z) * (b.z - a.z)) / (L * L)));
        const dd = Math.hypot(a.x + (b.x - a.x) * t - st.pos.x, a.z + (b.z - a.z) * t - st.pos.z);
        assert.ok(dd > 0.3, `${s.id} route walks through ${st.id}`);
      }
    }
  }
});

test('proto routes keep a body width from desks, chairs and counters (no scurry through furniture)', () => {
  const d = _cd(proto, createNav(proto));
  const solid = proto.furniture.filter((f) => f.solid || f.type === 'chair');
  const q = must(proto.slots.find((s) => s.tag === 'queue'));
  const clear = (x: number, z: number) => solid.every((f) => {
    const swap = Math.abs(Math.sin(f.yaw)) > 0.7;
    const hx = (swap ? f.size[2] : f.size[0]) / 2 + 0.25, hz = (swap ? f.size[0] : f.size[2]) / 2 + 0.25;
    return !(Math.abs(x - f.pos.x) < hx && Math.abs(z - f.pos.z) < hz);
  });
  for (const s of proto.slots.filter((x) => x.tag === 'desk')) {
    const ap = { x: s.pos.x + Math.sin(s.yaw) * 0.6, z: s.pos.z + Math.cos(s.yaw) * 0.6 };
    const r = must(d.route(ap, { x: q.pos.x, z: q.pos.z }));
    for (let k = 1; k < r.length; k++) {
      const a = r[k - 1], b = r[k], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
      for (let j = 0; j <= n; j++) {
        const x = a.x + ((b.x - a.x) * j) / n, z = a.z + ((b.z - a.z) * j) / n;
        // the first/last 0.45 m may brush the own chair / the counter (step-out, queue spot)
        if (Math.hypot(x - ap.x, z - ap.z) < 0.45 || Math.hypot(x - q.pos.x, z - q.pos.z) < 0.45) continue;
        assert.ok(clear(x, z), `${s.id}: route crosses furniture at ${x.toFixed(2)},${z.toFixed(2)}`);
      }
    }
  }
});

test('routeAround: a route that keeps clear of the player standing in the pod aisle (proto)', () => {
  const d = _cd(proto, createNav(proto));
  const from = { x: -1.95, z: 2.2 }, to = { x: -1.95, z: -2.3 }; // straight up the aisle between pod 0 and pod 1
  const player = { x: -1.95, z: 0.1 };
  const r = d.routeAround(from, to, player);
  assert.ok(r, 'a way around exists (round the pods)');
  const segD = (p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
    return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
  };
  for (let i = 1; i < r.length; i++) assert.ok(segD(player, r[i - 1], r[i]) >= 0.55, `leg ${i} keeps its distance`);
  assert.ok(d.walkable(-1.95, 2.2) && !d.walkable(proto.bounds.minX + 0.1, 0), 'walkable: open floor yes, wall no');
});

test('keep-clear viewpoints are layout data, in sync with the §9.2 review poses (proto + hq)', async () => {
  const { POSES } = await import('../../debug/poses.ts'); // test-only: the brain itself never reads the debug table
  const { layout: hq } = await import('../../world/layout/hq.ts');
  for (const L of [proto, hq]) {
    const views = cameraSpots(L);
    assert.ok(views.some((v) => Math.hypot(v.x - L.spawn[0], v.z - L.spawn[2]) < 0.05), `${L.id}: the spawn is kept clear`);
    for (const [name, p] of Object.entries(POSES)) {
      if (p.layout !== L.id || name === 'plan') continue; // plan = overhead, not a standing viewpoint
      const lvl = p.pose[1] > 1.5 ? 1 : 0;
      assert.ok(views.some((v) => Math.hypot(v.x - p.pose[0], v.z - p.pose[2]) < 0.05 && v.level === lvl && Math.abs(v.yaw - p.pose[3]) < 0.01),
        `${L.id}: review pose ${name} missing from layout.keepClearViews`);
    }
  }
});
