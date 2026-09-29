// ENV fix r1: dressing props in the nav grid (§6.6), kit contracts the reviewers checked by eye. Owner: ENV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../layout/hq.ts';
import { createNav } from '../nav/index.ts';
import { dressAll, dressObstacles } from './dress.ts';
import { KIT } from './kit/registry.ts';
import { rngOf } from './kit/core.ts';
import * as THREE from 'three';
import type { Footprint, Item, KitParams, Pose } from './kit/core.ts';

/** Non-null (a failed lookup fails the test with `what`). */
const need = <T>(v: T | null | undefined, what: string): T => {
  assert.ok(v !== null && v !== undefined, what);
  return v;
};
/** A geometry's bounding box (computed on demand). */
const bbox = (g: THREE.BufferGeometry): THREE.Box3 => {
  g.computeBoundingBox();
  return need(g.boundingBox, 'geometry has no bounding box');
};
interface PlacedProp { name: string; params: KitParams; pose: Pose; seed: string; item: Item }

const obstacles = dressObstacles(layout);
const nav = createNav(layout, { obstacles });
const bare = createNav(layout);

/** Every placement the dressers make, with its built item (a recording dry run). */
const placed: PlacedProp[] = [];
dressAll(layout, {
  swap: null,
  put(name, params, pose, seed) {
    const item = need(KIT[name], name)(params ?? {}, rngOf(seed ?? name));
    placed.push({ name, params: params ?? {}, pose, seed: String(seed), item });
    return { item, m: null };
  },
});
const SEATS = new Set(['treadmill', 'beanbag', 'deskChair', 'stool', 'sofa', 'armchair', 'bench', 'hammock', 'libChair']);
const FLAT = new Set(['rug', 'dais', 'yogaMat', 'roombaDock', 'stoop', 'arrivalsPad']); // [ENV M2] yoga mats: flat, the W2 lie slots are on them [ENV M2 LOB/OUT] Dusty's dock pad, the entrance stoop (outside) [ENV M3.5] the flat arrivals inlay
for (const n of ['bistroChair', 'rtChair', 'bunk']) SEATS.add(n); FLAT.add('crashMat'); // [ENV M2 breadth CAF/NAP/MEZ] slot seats, lie bunks; the slide-exit mat
const size = (fp: Footprint): number => ('r' in fp ? 2 * fp.r : Math.min(fp.w, fp.d));
const ground = placed.filter((p) => Math.abs((p.pose.y ?? 0) - layout.floorY(p.pose.x, p.pose.z, 0)) < 0.06 && !(p.name === 'lamp' && p.params.kind === 'pendant'));

test('every non-seat floor prop ≥ 0.2 m has its centre blocked in the raw nav grid (the player / agents collide with it)', () => {
  const props = ground.filter((p) => !SEATS.has(p.name) && !FLAT.has(p.name) && size(p.item.footprint) >= 0.2);
  assert.ok(props.length >= 40, `only ${props.length} floor props found`);
  const open = props.filter((p) => nav.walkable(p.pose.x, p.pose.z, 0));
  assert.deepEqual(open.map((p) => `${p.seed} (${p.name})`), []);
  // the ones the reviewers walked through by name
  for (const id of ['pitPlant64', 'pitPlant116', 'pitPlant244', 'pitPlant296', 'pitTable90', 'pitTable270', 'atrTree', 'atrMonstera', 'atrCooler', 'atrBin']) {
    const p = need(placed.find((q) => q.seed === id), id);
    assert.equal(nav.walkable(p.pose.x, p.pose.z, 0), false, `${id} walkable`);
  }
  // E-bay extras (coat racks, cooler, plants, bin, box, the arc lamp)
  const extras = placed.filter((p) => /^E\d:(coatRack|waterCooler|plant|bin|box|lamp):/.test(p.seed));
  assert.ok(extras.length >= 9, `E extras ${extras.length}`);
  for (const p of extras) assert.equal(nav.walkable(p.pose.x, p.pose.z, 0), false, `${p.seed} walkable`);
});

test('dressing obstacles keep every standing slot walkable and every desk / Pit seat routable from the spawn', () => {
  const spawn = { x: layout.spawn[0], z: layout.spawn[2], level: 0 };
  for (const s of layout.slots) {
    const opts = { queue: /^queue/.test(s.tag), owner: s.bay ?? null };
    if (s.pose === 'stand') assert.ok(nav.walkable(s.pos.x, s.pos.z, s.level, opts), `${s.id} blocked by a dressing prop`);
  }
  for (const s of layout.slots.filter((q) => /^(desk|sofa|pitStep|beanbag|pingpong|arcade|coffee|fish)/.test(q.tag))) {
    const to = { x: s.pos.x, z: s.pos.z, level: s.level };
    const a = bare.route(spawn, to, { owner: s.bay ?? '*' }), b = nav.route(spawn, to, { owner: s.bay ?? '*' });
    assert.ok(b, `${s.id} unreachable with dressing obstacles`);
    assert.ok(!a || b.length <= a.length * 1.25 + 1, `${s.id}: ${a ? a.length.toFixed(1) : 'none'} → ${b.length.toFixed(1)} m`);
  }
});

test('ping-pong table is built at the layout height (BRN toy scale), not a hardcoded 0.76', () => {
  const f = need(layout.furniture.find((q) => q.type === 'pingPong'), 'pingPong furniture');
  const p = need(placed.find((q) => q.name === 'pingPong'), 'pingPong placed');
  assert.equal(p.params.h, f.size[1]);
  const box = { max: -1 };
  for (const part of p.item.parts.slice(0, 1)) { part.geometry.computeBoundingBox(); box.max = bbox(part.geometry).max.y; }
  assert.ok(Math.abs(box.max - f.size[1]) < 0.01, `table top ${box.max}`);
});

test('Pit sofas are low-back loungers (top of back ≤ seat + 0.2) and there is no static Big Board housing', () => {
  const sofas = placed.filter((p) => p.name === 'sofa' && layout.furniture.find((f) => f.id === p.seed)?.zone === 'PIT');
  assert.equal(sofas.length, 6);
  for (const s of sofas) {
    let top = 0;
    for (const part of s.item.parts) { part.geometry.computeBoundingBox(); top = Math.max(top, bbox(part.geometry).max.y); }
    assert.ok(typeof s.item.anchors.seat === 'number' && top <= s.item.anchors.seat + 0.2, `${s.seed} back top ${top.toFixed(3)}`);
  }
  assert.equal(placed.filter((p) => p.name === 'bigBoard').length, 0);
});

test('lamp shades are smooth (≥ 32 segments) with a dark cavity; desk chairs have a real back; trees have a clustered crown', () => {
  for (const kind of ['floor', 'floorArc', 'pendant'] as const) {
    const it = need(KIT.lamp, 'lamp')({ kind, shape: 'dome' }, rngOf(kind));
    const shades = it.parts.filter((q) => q.mat === 'shade');
    assert.ok(shades.some((q) => q.color), `${kind}: no cavity`);
    for (const q of shades) {
      const n = q.geometry.getAttribute('position').count, rings = q.geometry instanceof THREE.LatheGeometry ? q.geometry.parameters.points.length : 1;
      // [ENV fix m3 r1] the outer shell (the silhouette) keeps ≥ 32; the dark cavity (q.color) is never a silhouette: ≥ 16
      const min = q.color ? 16 : 32;
      assert.ok(n / rings >= min + 1, `${kind}: ${n / rings - 1} segments`);
    }
  }
  const ch = need(KIT.deskChair, 'deskChair')({}, rngOf('c'));
  const back = need(ch.parts.find((q, i) => i > 0 && q.slot === 'body' && q.mat === 'fabric' && bbox(q.geometry).max.y > 0.45), 'chair back');
  const bb = bbox(back.geometry);
  const bh = bb.max.y - bb.min.y;
  assert.ok(bh >= 0.6 * 0.42 * 0.95, `chair back ${bh.toFixed(3)} m`);
  // [ENV fix r2] an upright office back: 8–12° recline, ≤ 0.9 × the 0.44 m seat, carried by a spine (secondary parts behind the seat)
  const recline = need(ch.backRecline, 'chair backRecline');
  assert.ok(recline >= 8 * Math.PI / 180 && recline <= 12 * Math.PI / 180, `recline ${(recline * 180 / Math.PI).toFixed(1)}°`);
  const bw = bb.max.x - bb.min.x;
  assert.ok(bw <= 0.9 * 0.44, `chair back width ${bw.toFixed(3)} m`);
  assert.ok(ch.parts.some((q) => q.slot === 'secondary' && (bbox(q.geometry).max.y > 0.45 && bbox(q.geometry).min.z > 0.2)), 'no back spine');
  const tree = need(KIT.plant, 'plant')({ kind: 'tree', h: 2.4 }, rngOf('t'));
  const crowns = tree.parts.filter((q) => q.mat === 'foliage');
  assert.ok(crowns.length >= 3 && crowns.length <= 6, `tree crowns ${crowns.length}`);
});

// [ENV fix m2 r2] setNear() used to drop every far segment past FAR_RUNS once no hidden gap was left to bridge
test('far LOD: near chunks that cut the far office into ≥ 7 runs still draw every non-near chunk (no truncation)', async () => {
  const { createBaker } = await import('./kit/index.ts');
  const baker = createBaker({ cellOf: (x) => `c${Math.floor(x)}`, lod: 5 });
  const N = 20;
  for (let i = 0; i < N; i++) baker.place('crate', { w: 0.5, h: 0.4, d: 0.4 }, { x: i + 0.5, z: 0 }, `far${i}`);
  baker.finish();
  const far = need(baker.far, 'far LOD');
  const near = new Set(far.keys.filter((_, i) => i % 2 === 1)); // every other chunk near: 10 separate far segments
  const n = far.setNear((k) => near.has(k), () => false);
  assert.ok(n >= 7, `only ${n} segments`);
  const drawn = far.runs.filter((r) => r.mesh.visible);
  assert.equal(drawn.length, n);
  for (const k of far.keys) {
    const [s0, c] = need(far.ranges.get(k), `range ${k}`);
    const covered = drawn.some((r) => r.start <= s0 && s0 + c <= r.start + r.count);
    const overlaps = drawn.some((r) => r.start < s0 + c && s0 < r.start + r.count);
    if (near.has(k)) assert.ok(!overlaps, `near ${k} also drawn far`);
    else assert.ok(covered, `far ${k} not drawn`);
  }
  // back to few segments: the extra run meshes hide again
  const m = far.setNear((k) => k === far.keys[3]);
  assert.equal(far.runs.filter((r) => r.mesh.visible).length, m);
  assert.ok(far.group.children.length >= n);
});

// [ENV M3.5 tris] distance cap: a capped far chunk draws only its big-part range; near chunks draw neither range
test('far LOD distance cap: capped chunks draw only big parts, near chunks nothing, others everything', async () => {
  const { createBaker } = await import('./kit/index.ts');
  const baker = createBaker({ cellOf: (x) => `c${Math.floor(x / 2)}`, lod: 5 });
  for (let i = 0; i < 12; i++) {
    baker.place('shelf', { w: 1.2, h: 1.2 }, { x: i * 2 + 0.5, z: 0 }, `shelf${i}`);
    baker.place('stool', {}, { x: i * 2 + 1.5, z: 0 }, `stool${i}`);
  }
  baker.finish();
  const far = need(baker.far, 'far LOD');
  const near = new Set([far.keys[2], far.keys[7]]), capped = new Set(far.keys.filter((_, i) => i >= 5));
  far.setNear((k) => near.has(k), () => false, (k) => capped.has(k));
  const drawn = far.runs.filter((r) => r.mesh.visible);
  const covered = ([s0, c]: [number, number]): boolean => !c || drawn.some((r) => r.start <= s0 && s0 + c <= r.start + r.count);
  const overlaps = ([s0, c]: [number, number]): boolean => c > 0 && drawn.some((r) => r.start < s0 + c && s0 < r.start + r.count);
  let smallTotal = 0;
  for (const k of far.keys) {
    const big = need(far.ranges.get(k), `big ${k}`), small = need(far.smallRanges.get(k), `small ${k}`);
    smallTotal += small[1];
    if (near.has(k)) { assert.ok(!overlaps(big) && !overlaps(small), `near ${k} drawn far`); continue; }
    assert.ok(covered(big), `far ${k} big parts not drawn`);
    if (!capped.has(k)) assert.ok(covered(small), `uncapped ${k} small parts not drawn`);
  }
  assert.ok(smallTotal > 0, 'stools have small far parts');
  // far shelves keep their books as merged spine proxies (big parts), never an empty case
  const b = need(far.ranges.get(far.keys[0] ?? ''), 'first range')[1];
  assert.ok(b > 0);
});

// [ENV fix m3 r1] §5.3 tris: LOD by line of sight (occlusion.ts nearest()) + the mezzanine slab
test('occlusion: the mezzanine slab hides the library from the mezz and the mezz from the library; LOD distance is by line of sight', async () => {
  const { createChunkOcclusion } = await import('./occlusion.ts');
  const occ = createChunkOcclusion(layout, {});
  const mezz = { x: 6, y: 2.9 + 1.6, z: -10.5 }, lib = { x: 0, y: 1.6, z: -13.15 }, eng = { x: 9, y: 0.25 + 1.6, z: 1.5 };
  assert.ok(!occ.visible(mezz).has('LIB') && occ.visible(mezz).has('MEZ'), 'from the mezz');
  assert.ok(occ.visible(lib).has('LIB') && !occ.visible(lib).has('MEZ'), 'from the library');
  const nm = occ.nearest(mezz, 5.5), nl = occ.nearest(lib, 5.5), ne = occ.nearest(eng, 5.5);
  assert.equal(nm.get('MEZ'), 0); assert.ok(!nm.has('LIB'), 'LIB near from the mezz');
  assert.equal(nl.get('LIB'), 0); assert.ok(!nl.has('MEZ'), 'MEZ near from the library');
  // engine pose: the café and the archive are behind solid walls (their boxes are 4.5 m away)
  assert.equal(ne.get('ENG'), 0); assert.ok(!ne.has('CAF') && !ne.has('ARC') && !ne.has('MAIL'), JSON.stringify([...ne]));
});

test('window scenery: the hill crest helper matches the hill mesh; cottages carry shade-class windows', async () => {
  const { hillCrest } = await import('./kit/finish.ts');
  const p = { w: 9, d: 3.4, h: 2.4 }, it = need(KIT.hill, 'hill')(p, rngOf('hc')), pos = need(it.parts[0], 'hill part').geometry.getAttribute('position');
  let top = 0;
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i)) < 1e-3 && Math.abs(pos.getX(i)) < 0.2) top = Math.max(top, pos.getY(i));
  assert.ok(Math.abs(hillCrest(p, rngOf('hc'), 0) - top) < 0.08, `crest ${hillCrest(p, rngOf('hc'), 0)} vs mesh ${top}`);
  const c = need(KIT.cottage, 'cottage')({ windows: 2 }, rngOf('c'));
  assert.equal(c.parts.filter((q) => q.mat === 'shade').length, 2);
  const cot = placed.filter((q) => q.name === 'cottage');
  assert.ok(cot.length >= 4, 'cottages on the west ridge');
});
