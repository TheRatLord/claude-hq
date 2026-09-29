/**
 * `buildWorld(layout, ctx) → {cells, anchors, update(ctx), dispose()}` (§5.4).
 * M1.75 (ENV): the full office architecture (architecture.ts: value map, trims, AO floors, glazing) + the prop kit
 * dressing of the hero zones (Atrium + Pit, the E bays with E2 as the hero bay). The other zones keep the LVL greybox
 * furniture until M2 breadth: greybox.ts is asked (`ctx.envSkip`) to skip its architecture and every furniture /
 * lamp / rope instance in the dressed cells. `?greybox` and the proto room stay pure greybox.
 * Kit geometry is merged per vis cell × material class (kit/index.ts); cells outside the camera cell's visible set
 * are hidden, small story props are drawn within 14 m. `__hq.stats().props` = per-cell prop counts (§7.1 density).
 * Owner: ENV.
 */
import * as THREE from 'three';
import { buildGreybox } from './greybox.ts';
import type { WorldBuild, WorldAnchor } from './greybox.ts';
import { buildArchitecture } from './architecture.ts';
import { createBaker } from './kit/index.ts';
import { dressAll } from './dress.ts';
import { createChunkOcclusion } from './occlusion.ts'; // [ENV fix m2 r1] per-chunk wall occlusion
import { createBayNeon } from './zones/neon.ts'; // [ENV M2 breadth W/STR] rollup neon
import { createMovingDay } from './zones/movingDay.ts'; // [ENV M2 breadth W/STR] amenity moving day
import { createLabLight } from './labLight.ts'; // [ENV M2 breadth LAB/ENG] live TEST light
import { getMaterial, applyDepthMaterial } from '../../render/materials/index.ts';
import { U } from '../../render/uniforms.ts'; // [ENV fix m3 r1] read-only: uNight / uGolden tint the window scenery
import { registerDeskScreens } from '../../render/deskScreens.ts';
import { hqStatSection } from '../../core/debug.ts';
import { cellAt } from '../layout/vis.ts';
import { DESK } from '../layout/proto.ts';
import { STATUS } from '../../../../shared/palette.ts';
import { isHqLayout } from '../layout/schema.ts';
import type { Layout, HqLayout } from '../layout/schema.ts';
import type { Ctx } from '../../core/ctx.ts';
import type { Baker } from './kit/index.ts';
import type { AoFootprint } from './architecture.ts';
import type { DressKit } from './zones/common.ts';

/** A three material as one object, or null for a multi-material mesh. */
const singleMat = (m: THREE.Material | THREE.Material[]): THREE.Material | null => (Array.isArray(m) ? null : m);
/** The material's emissive colour as a hex int (0 when it has none). */
const emissiveHex = (m: THREE.Material | null): number => (m && 'emissive' in m && m.emissive instanceof THREE.Color ? m.emissive.getHex() : 0);
/** An object's geometry (meshes, lines, points), if it has one. */
const geometryOf = (o: THREE.Object3D): THREE.BufferGeometry | null => ('geometry' in o && o.geometry instanceof THREE.BufferGeometry ? o.geometry : null);
/** What `stats().env.lod` reports about the last LOD pass. */
interface LodStat { near: string[]; farRuns: number; culled: string[]; farTris?: number; capped?: string[]; outdoor?: string[] }

export { dressObstacles, HIRE_CRATE } from './dress.ts';
import { HIRE_CRATE } from './dress.ts';

/** What the world is dressed as (review-shots enforces the M1.75 art gates once this is not 'greybox'). */
export const WORLD_ART = 'kit';
/** Cells dressed from the prop kit (M1.75 hero zones). */
export const DRESSED = Object.freeze(['ATR', 'PIT', 'E1', 'E2', 'E3', 'LIB', 'MAIL', 'ARC', 'W1', 'W2', 'W3', 'STR', 'LAB', 'ENG', 'CAF', 'NAP', 'MEZ', 'LOB', 'PLZ', 'NAL', 'WAR']); // [ENV M2 breadth] + LIB/MAIL/ARC; [INT M2] + NAL/WAR (zones/alley.ts, zones/war.ts)

const OX = 20.5, OZ = 14;
/** [ENV fix r1] perf: kit groups whose bounds are farther than this draw their low-detail copy (§5.3 tris budget). */
const LOD_M = 5.5;
/** [ENV M3.5 tris] far chunks farther than this (box distance) drop their 10–22 cm far parts (kit FAR2_MIN_R). */
const FAR2_M = 9.5;
/**
 * [ENV fix m2 r1] Kit draw chunks: vis cells merged into one draw group per material class. Sized so a chunk is one
 * room-ish block the frustum / shadow box / LOD can drop as a whole, while the chunks in view from a hero pose stay
 * few (draw budget §5.3).
 */
// [ENV fix m2 r3b] §5.3 tris: one chunk per W bay (was one 'WB' for all three: from the street the two far bays and
// all three desk sets drew at full detail with the nearest one, ≈ 110k tris); likewise E3 is its own chunk (was EB2 with
// E2: the street pose drew E2's full detail for E3's storefront beside the eye)
const CHUNK: Readonly<Record<string, string>> = { W1: 'WB1', W2: 'WB2', W3: 'WB3', NAL: 'NAL', STR: 'STR', E1: 'EB1', E2: 'EB2', E3: 'EB3', LOB: 'LOB', ATR: 'ATR', PIT: 'ATR',
  LIB: 'LIB', MEZ: 'MEZ', PLZ: 'SO', WAR: 'SO', LAB: 'SO', MAIL: 'NE', ARC: 'NE', ENG: 'ENG', CAF: 'CAF', NAP: 'CAF', OUT: 'OUT' };
const GLOW_CLS = new Set(['bulb', 'shade', 'flame']);
/** [ENV fix m2 r2] the garden trees' draw group (zones/exterior.ts): one smooth foliage mesh, no far twin, shown with OUT. */
const TREES = 'K~trees', TREES_PLAN = 'K~treesPlan'; // TREES_PLAN: the side-lawn trees beyond the sky cards, plan view only
/** [ENV fix m2 r3] the west garden (hills + trees outside the W bays / War Room).
 *  [ENV fix m2 r3b] §5.3 tris (review m2 r3: 324k env at the street pose): drawn only while some sample of it has a
 *  line of sight from the eye through a window (occlusion.ts, chunk key TREES_W), at full detail only within LOD_M of
 *  that line of sight (inside a W bay / the War Room), else as its low twin `K~treesWLo` (zones/exterior.ts); the
 *  plan view draws the full one. */
const TREES_W = 'K~treesW', TREES_W_LO = 'K~treesWLo';
/** [ENV fix m2 r3] the south façade dressing (sign, awning, lanterns, window boxes): drawn only from outside / the plan. */
const FACADE = 'K~facade';
/** Far-LOD buffer order: neighbours that are often near together sit next to each other (fewer far runs). */
const CHUNK_ORDER = ['NAL', 'WB1', 'WB2', 'WB3', 'amen:W1', 'amen:W2', 'amen:W3', 'desk:W3', 'desk:W2', 'desk:W1', 'STR', 'SO', 'OUT', 'LOB', 'ATR', 'EB3', 'EB2', 'EB1', 'LIB', 'MEZ', 'NE', 'ENG', 'CAF'];
/** [ENV fix m2 r1] W-bay swap sets (§7.2): `desk:<bay>` shows while a workspace holds the bay, `amen:<bay>` otherwise;
 *  both ride their bay's WB<n> chunk's LOD (near / far with it). */
const SWAP = /^(desk|amen):(W\d)$/;
/** At most this many chunks draw at full detail at once (draw budget: 4 classes each + their shadow draws). */
const MAX_NEAR = 3;

/** The kit's vis cell of a world point (the mezzanine above y 2.85). */
const kitCellOf = (layout: HqLayout) => (x: number, y: number, z: number): string => {
  const b = layout.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return 'OUT';
  return (y > 2.85 && layout.plan.onMezz(x + OX, z + OZ) ? 'MEZ' : layout.zoneAt(x, z, 0)) ?? 'OUT';
};

export function buildWorld(layout: Layout, ctx: Ctx): WorldBuild {
  if (!isHqLayout(layout) || ctx.params?.greybox) return buildGreybox(layout, ctx);
  const t0 = performance.now();
  // 1. greybox for the undressed zones' furniture + the sign atlases (no architecture, nothing in dressed cells)
  ctx.envSkip = { arch: true, cells: new Set(DRESSED), types: new Set(['phoneBooth']) }; // [ENV M2 breadth] types: kit-dressed items in undressed cells (zones/phones.ts)
  const grey = buildGreybox(layout, ctx);
  delete ctx.envSkip;

  // 2. the kit dressing (collects floor-AO footprints as it goes); kit draw groups = the arch super-regions
  const cellOf = kitCellOf(layout);
  // [ENV fix m2 r1] perf (review m2 r1: ONE whole-office `K` group per class could never be culled: 1.5M visible tris,
  // 729k casters): kit geometry merges per CHUNK (a few adjacent vis cells) × class, so the camera frustum, the 24 m
  // shadow box and the LOD swap can drop whole rooms; each chunk has a low-detail `~far` twin (FAR_DETAIL, no small
  // parts) shown beyond LOD_M. plain + flat + small share one `base` mesh per chunk (shadow = the casting prefix);
  // the emissive classes (bulb / shade / flame) stay one office-wide group each.
  const baker = createBaker({ cellOf, groupOf: (cell, cls) => (GLOW_CLS.has(cls) ? 'K~glow' : CHUNK[cell] ?? cell), lod: LOD_M, farOrder: CHUNK_ORDER, rangeGroup: 'K~glow', chunkOf: (cell) => CHUNK[cell] ?? cell }); // [ENV M3.5 tris] rangeGroup: glow drawRange culling
  const footprints: AoFootprint[] = [];
  const put: DressKit['put'] = (name, params, pose, seed, aoK = 0) => {
    const r = baker.place(name, params, pose, seed, k.swap ? { group: k.swap } : k.group ? { group: k.group, noFar: true } : undefined); // [ENV fix m2 r1] k.swap: W-bay desk / amenity sets; [ENV fix m2 r2] k.group: an always-near named group (K~trees)
    if (aoK > 0) {
      const fp = r.item.footprint;
      footprints.push('r' in fp ? { x: pose.x, z: pose.z, r: fp.r, k: aoK } : { x: pose.x, z: pose.z, w: fp.w, d: fp.d, yaw: pose.yaw ?? 0, k: aoK });
    }
    return r;
  };
  const k: DressKit = { put, swap: null, group: null };
  dressAll(layout, k);
  const harvested = harvestGreybox(grey.root, baker, cellOf);
  const screens = k.screens ?? [];
  // undressed zones' solid furniture still darkens the floor under it
  const dressed = new Set(DRESSED);
  for (const f of layout.furniture) {
    if ((f.zone && dressed.has(f.zone)) || !f.solid || f.level || f.pos.y > 0.3) continue;
    footprints.push({ x: f.pos.x, z: f.pos.z, w: f.size[0], d: f.size[2], yaw: f.yaw, k: 0.2 });
  }

  // 3. architecture for the whole office
  const archi = buildArchitecture(layout, { footprints });
  const root = new THREE.Group();
  root.name = 'world:env';
  for (const g of archi.groups.values()) root.add(g);
  for (const m of archi.extra) root.add(m);
  const kitGroups = baker.finish();
  for (const g of kitGroups.values()) root.add(g);
  const far = baker.far;
  if (far) root.add(far.group);
  const scenery = createSceneryTint(kitGroups, [TREES, TREES_W, TREES_W_LO, TREES_PLAN]); // [ENV fix m3 r1]

  // 4. desk monitors of the dressed bays (status-driven screens, one InstancedMesh)
  const swapScreens: Record<string, [number, THREE.Matrix4][]> = {};
  let screenMesh: THREE.InstancedMesh | null = null;
  if (screens.length) {
    const scr = new THREE.InstancedMesh(new THREE.PlaneGeometry(DESK.monitor.w - 0.05, DESK.monitor.h - 0.045), getMaterial('screen', { color: '#2A2D33', emissive: 0.9, code: 1, instanced: true }), screens.length);
    const e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), m = new THREE.Matrix4();
    screens.forEach((sc, i) => {
      e.set(sc.rx, sc.yaw, 0, 'YXZ'); q.setFromEuler(e);
      scr.setMatrixAt(i, m.compose(p.set(sc.p.x, sc.p.y, sc.p.z), q, s));
      scr.setColorAt(i, new THREE.Color(STATUS.working));
    });
    scr.name = 'env:screens';
    registerDeskScreens(scr, screens.map((sc) => sc.anchor));
    root.add(scr);
    // [ENV fix m2 r1] W-bay monitors hide with their desk set (§7.2 amenity bays show no dead screens)
    screens.forEach((sc, i) => { const b = /^desk:(W\d):/.exec(sc.anchor)?.[1]; if (b) { const m0 = new THREE.Matrix4(); scr.getMatrixAt(i, m0); (swapScreens[b] ??= []).push([i, m0]); } });
    screenMesh = scr;
  }
  const skyMesh = archi.extra.find((m) => m.name === 'hq:sky') ?? null;
  const extArch = archi.groups.get('EXT') ?? null; // [ENV M3.5 tris]
  const labLight = k.labLight ? createLabLight(k.labLight, ctx) : null; // [ENV M2 breadth LAB/ENG] live TEST light lenses
  if (labLight) root.add(labLight.mesh);
  const neon = createBayNeon(layout, ctx); // [ENV M2 breadth W/STR] storefront / glazing / lamp-post rollup neon (1 draw)
  if (neon) root.add(neon.mesh);
  const moving = createMovingDay(layout, ctx); // [ENV M2 breadth W/STR] crates parade when a bay changes hands (§7.2)
  if (moving) root.add(moving.mesh);
  if (moving) ctx.movingDay = moving; // debug: __hq.ctx.movingDay.trigger('E1', 'W1')
  root.traverse((o) => { if (o !== root) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  ctx.scene.add(root);
  root.updateMatrixWorld(true);

  // 5. culling: arch super-region + kit chunks follow the camera cell's visible set; kit LOD twins beyond LOD_M (the
  //    far twins carry no small parts); three's frustum culling (main + shadow camera) works per chunk mesh
  const visOf = new Map<string, Set<string>>(layout.visCells.map((c) => [c.id, new Set(c.visible ?? layout.visCells.map((q) => q.id))]));
  let visCell: string | null | undefined, lastCam: { x: number; y: number; z: number } | null = null, ceilOn = true;
  const tmpV = new THREE.Vector3();
  /** chunk → bounds of its near meshes (LOD distance) */
  const boxes = new Map<string, THREE.Box3>();
  for (const [c, g] of kitGroups) {
    if (c === 'K~glow' || c === TREES || c === TREES_PLAN || c === TREES_W || c === TREES_W_LO || c === FACADE || SWAP.test(c)) continue; // [ENV fix m2 r2] K~trees: no LOD (always its near mesh)
    const box = new THREE.Box3();
    g.traverse((o) => { const geo = geometryOf(o); if (geo) { geo.computeBoundingBox(); if (geo.boundingBox) box.union(geo.boundingBox); } });
    boxes.set(c, box);
  }
  // [ENV fix m2 r3] perf: the outdoor named groups are one mesh each spanning a whole side of the building, so their
  // bounding spheres swallowed the camera and three never frustum-culled them (K~trees drew 22k tris + casters at
  // spawn with the garden behind the eye): test their boxes against the view frustum here
  // (sliced into 8 boxes along the group's long axis: one 40 m box passes three's plane test from almost anywhere)
  const outBox = new Map<string, THREE.Box3[]>();
  for (const c of [TREES, TREES_W, TREES_W_LO, FACADE]) {
    const g = kitGroups.get(c);
    if (!g) continue;
    const all = new THREE.Box3();
    g.traverse((o) => { const geo = geometryOf(o); if (geo) { geo.computeBoundingBox(); if (geo.boundingBox) all.union(geo.boundingBox); } });
    const ax = all.max.x - all.min.x >= all.max.z - all.min.z ? 'x' : 'z', n = 8, lo = all.min[ax], span = (all.max[ax] - lo) / n || 1;
    const slices = Array.from({ length: n }, () => new THREE.Box3());
    const v = new THREE.Vector3();
    g.traverse((o) => {
      const pos = geometryOf(o)?.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); slices[Math.min(n - 1, Math.max(0, Math.floor((v[ax] - lo) / span)))].expandByPoint(v); }
    });
    outBox.set(c, slices.filter((b) => !b.isEmpty()).map((b) => b.expandByScalar(0.4)));
  }
  const glowMeshes: THREE.Mesh[] = [];
  kitGroups.get('K~glow')?.traverse((o) => { if (o instanceof THREE.Mesh && o.userData.chunkRanges) glowMeshes.push(o); });
  const inFrustum = (c: string): boolean => !outBox.has(c) || (outBox.get(c) ?? []).some((b) => frustum.intersectsBox(b));
  let nearSet = new Set<string>(), lodStat: LodStat = { near: [], farRuns: 0, culled: [] };
  const occ = createChunkOcclusion(layout, CHUNK, { always: ['K~glow'], extra: { OUT: [[layout.bounds.minX, layout.bounds.maxZ + 0.2, layout.bounds.maxX, layout.bounds.maxZ + 6]], [TREES_W]: [[layout.bounds.minX - 5.5, layout.bounds.minZ, layout.bounds.minX - 0.2, layout.bounds.maxZ]] } }); // the south garden; [ENV fix m2 r3b] the west garden (sample grid 1 m, 0.45 / 1.5 m up: in window height)
  const frustum = new THREE.Frustum(), projM = new THREE.Matrix4(), sph = new THREE.Sphere();
  const lastDir = new THREE.Vector3(), dir = new THREE.Vector3();
  // [ENV fix m2 r1] which W-bay set is live: desks while a workspace holds the bay, the amenity set otherwise
  let swapKey: string | null = null, swapVer = -1, swapT = 0;
  const bayHeld = new Set<string>();
  const swapActive = (c: string): boolean => { const m = SWAP.exec(c); return !m || (m[1] === 'desk') === bayHeld.has(m[2]); };
  const readBays = (): boolean => {
    const dir = ctx.director;
    const v = dir?.version?.() ?? 0, now = performance.now();
    if (swapKey !== null && v === swapVer && now - swapT < 1000) return false;
    swapVer = v; swapT = now;
    const st = dir?.bayState?.() ?? {};
    const held = ['W1', 'W2', 'W3'].filter((b) => st[b]?.ws);
    const key = held.join(',');
    if (key === swapKey) return false;
    swapKey = key; bayHeld.clear(); for (const b of held) bayHeld.add(b);
    if (screenMesh) {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const [b, list] of Object.entries(swapScreens)) for (const [i, m0] of list) screenMesh.setMatrixAt(i, bayHeld.has(b) ? m0 : zero);
      screenMesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  };
  const applyVis = (camObj: THREE.Camera): void => {
    const cam = camObj.position;
    const cell = cellAt(layout, cam.x, cam.y, cam.z);
    let dirty = readBays();
    if (cell !== visCell) {
      visCell = cell;
      const set = cell ? visOf.get(cell) ?? null : null;
      const any = (cells: ReadonlySet<string> | undefined): boolean => !cells || !set || [...cells].some((c) => set.has(c));
      for (const [r, g] of archi.groups) if (r !== 'EXT') g.visible = r === 'OUT' || !set || any(archi.regionCells.get(r));
      for (const [c, g] of kitGroups) g.userData.cellVis = !set || c === 'OUT' || c === 'K~glow' || SWAP.test(c) || any(baker.groupCells.get(c));
      dirty = true;
    }
    // [ENV M3.5 tris] the façade trims + striped lawn (architecture.ts EXT): only from outside the building / the plan
    if (extArch) { const b = layout.bounds, out = cam.y > 6.2 || cam.x < b.minX + 0.3 || cam.x > b.maxX - 0.3 || cam.z < b.minZ + 0.3 || cam.z > b.maxZ - 0.4; if (extArch.visible !== out) extArch.visible = out; }
    camObj.getWorldDirection(dir);
    if (dirty || !lastCam || Math.hypot(cam.x - lastCam.x, cam.y - lastCam.y, cam.z - lastCam.z) > 0.25 || dir.dot(lastDir) < 0.9986) {
      lastCam = { x: cam.x, y: cam.y, z: cam.z };
      lastDir.copy(dir);
      tmpV.set(cam.x, cam.y, cam.z);
      // [ENV fix m2 r1] wall occlusion (occlusion.ts): chunks with no clear line of sight from the eye are dropped;
      // for the far LOD the sample points must also be in the (padded) camera frustum — near chunks keep their
      // off-screen parts, which still cast shadows into view
      camObj.updateMatrixWorld();
      frustum.setFromProjectionMatrix(projM.multiplyMatrices(camObj.projectionMatrix, camObj.matrixWorldInverse));
      const seen = cam.y > 6.2 ? null : occ.visible(tmpV);
      const inView = cam.y > 6.2 ? null : occ.visible(tmpV, (x, y, z, pad) => frustum.intersectsSphere(sph.set(sph.center.set(x, y, z), pad)));
      const vis = (c: string): boolean => kitGroups.get(c)?.userData.cellVis !== false && (!seen || seen.has(c));
      // near LOD: the ≤ MAX_NEAR visible chunks within LOD_M of the camera (nearest first) draw their full-detail
      // class meshes (and cast); every other visible chunk in view is drawn by the far runs (one office-wide buffer)
      // (a chunk behind the camera is near only when the eye is (almost) in it: its props cast into view)
      // [ENV fix m3 r1] §5.3 tris: the LOD distance is the line-of-sight distance to the chunk's nearest sample point in
      // view (occlusion.ts nearest(): walls and the mezzanine slab block, the padded frustum must hold the point), not
      // its bounding-box distance: a room behind a wall / below the mezzanine no longer draws at full detail because
      // its box is close (engine pose: CAF + NE 136k; mezz poses: LIB 56k). The eye's own chunk is always near (0).
      const nd = cam.y > 6.2 ? null : occ.nearest(tmpV, LOD_M, (x, y, z, pad) => frustum.intersectsSphere(sph.set(sph.center.set(x, y, z), pad)));
      const near: string[] = !nd ? [] : [...boxes.keys()].filter((c) => nd.has(c) && vis(c)).map((c): [string, number] => [c, nd.get(c) ?? Infinity])
        .sort((a, b) => a[1] - b[1]).slice(0, MAX_NEAR).map(([c]) => c);
      nearSet = new Set(near);
      const host = (c: string): string => { const m = SWAP.exec(c); return m ? `WB${m[2].slice(1)}` : c; }; // the swap sets follow their bay's WB<n> chunk
      // [ENV fix m3 r1] §5.3 tris (review m3 r1: the outdoor foliage cast 70k shadow tris from every pose): the garden
      // groups cast only while the eye is outside the building (the entrance, the plan view); seen through a window
      // from inside, their lawn shadows are a few px of a card 5–15 m away
      const outside = cam.y > 6.2 || cam.x < layout.bounds.minX + 0.3 || cam.x > layout.bounds.maxX - 0.3 || cam.z < layout.bounds.minZ + 0.3 || cam.z > layout.bounds.maxZ - 0.4;
      scenery.setCast(outside);
      // [ENV fix m2 r3b] the west garden: in view through a window at all, and within LOD_M of that line of sight
      const westSeen = !!seen?.has(TREES_W) && inFrustum(TREES_W), westNear = westSeen && (nd?.get(TREES_W) ?? Infinity) < LOD_M;
      scenery.setGlow(cam.y <= 6.2); // the cottages' lit panes: 1 draw, pointless from the plan camera (§5.3 main ≤ 110)
      for (const [c, g] of kitGroups) g.visible = c === 'K~glow' ? true : c === TREES ? vis('OUT') && inFrustum(c) : c === TREES_PLAN ? cam.y > 6.2 : c === TREES_W ? cam.y > 6.2 || (westSeen && westNear) : c === TREES_W_LO ? cam.y <= 6.2 && westSeen && !westNear : c === FACADE ? cam.y > 6.2 || (cam.z > layout.bounds.maxZ - 0.4 && inFrustum(c)) : swapActive(c) && vis(host(c)) && (nearSet.has(host(c)) || !far?.ranges.has(c));
      // [ENV M3.5 tris] the office-wide glow meshes draw only the span of chunks with a line of sight (+ in the vis set)
      for (const gm of glowMeshes) {
        const R: Map<string, [number, number]> = gm.userData.chunkRanges;
        let a = Infinity, b = -Infinity;
        for (const [c, [s0, n]] of R) if (!seen || (seen.has(c) && kitGroups.get(c)?.userData.cellVis !== false) || !boxes.has(c)) { a = Math.min(a, s0); b = Math.max(b, s0 + n); }
        gm.geometry.drawRange.start = a === Infinity ? 0 : a; gm.geometry.drawRange.count = a === Infinity ? 0 : b - a;
        gm.visible = a !== Infinity;
      }
      const drawFar = (c: string): boolean => swapActive(c) && vis(host(c)) && (!inView || inView.has(host(c)));
      // [ENV M3.5 tris] distance cap: far chunks beyond FAR2_M (or all of them from the plan) draw only their big parts
      const capped = (c: string): boolean => { if (cam.y > 6.2) return true; const b = boxes.get(host(c)); return !!b && b.distanceToPoint(tmpV) > FAR2_M; };
      const runs = far ? far.setNear((c) => nearSet.has(host(c)) || !drawFar(c), (c) => !nearSet.has(host(c)) && swapActive(c), capped) : 0;
      lodStat = { near, farRuns: runs, farTris: Math.round(far?.drawnTris ?? 0), capped: far ? far.keys.filter((c) => capped(c) && !nearSet.has(host(c)) && drawFar(c)) : [], culled: [...boxes.keys()].filter((c) => !nearSet.has(c) && !drawFar(c)), outdoor: [...outBox.keys()].filter((c) => kitGroups.get(c)?.visible) };
    }
  };
  // [ENV fix m2 r1] per-cell prop counts (§7.1 density) + `classes`: merged tris per material class (near / far LOD,
  // casting) and mesh count, so the §5.3 triangle budget can be tracked per class
  const propStats = () => ({ ...Object.fromEntries([...baker.counts].map(([c, v]) => [c, { props: v.props, tris: v.tris }])), classes: Object.fromEntries(Object.entries(baker.classStats).map(([c, v]) => [c, { tris: Math.round(v.tris), farTris: Math.round(v.farTris), castTris: Math.round(v.castTris), meshes: v.meshes }])), lod: { ...lodStat, bays: swapKey } });
  hqStatSection('props', propStats);
  const buildMs = Math.round(performance.now() - t0);
  const envDraws = (): number => { let n = 0; root.traverse((o) => { if (o instanceof THREE.Mesh && o.visible && o.parent?.visible !== false) n++; }); return n; };
  const anchors: Record<string, WorldAnchor> = { ...grey.anchors };
  // [ENV M3.5] the Lobby hiring / arrivals crate spot for BRN (pos = floor centre, yaw camera-style = the crate's front)
  anchors['lobby:hireCrate'] = { pos: new THREE.Vector3(HIRE_CRATE.x, HIRE_CRATE.y, HIRE_CRATE.z), yaw: HIRE_CRATE.yaw, size: HIRE_CRATE.size, cell: 'LOB' };
  return {
    cells: new Map(layout.visCells.map((c) => [c.id, kitGroups.get(CHUNK[c.id] ?? c.id) ?? grey.cells.get(c.id)])),
    anchors,
    root,
    stats: () => ({ ...grey.stats(), env: { buildMs, archDraws: archi.stats.draws, archTris: archi.stats.tris, drawsVisible: envDraws(), harvested, lod: lodStat, farTris: Math.round(far?.tris ?? 0), scenery: scenery.stats() }, props: propStats() }),
    update(c) {
      grey.update(c);
      neon?.update(c);
      moving?.update(c);
      labLight?.update(c); // [ENV M2 breadth LAB/ENG]
      scenery.update(); // [ENV fix m3 r1] night / golden window scenery
      const camObj = c?.camera ?? ctx.camera;
      const cam = camObj?.position;
      if (cam) {
        applyVis(camObj);
        const want = cam.y < 6.2;
        if (want !== ceilOn) {
          ceilOn = want; for (const c of archi.ceilings) c.set(want); // [ENV fix m2 r1] draw-range trim
          if (skyMesh) skyMesh.visible = want; // [ENV fix m2 r2] from above the sky cards read as flat bands round the lawn
        }
      }
    },
    dispose() { grey.dispose(); labLight?.dispose(); ctx.scene.remove(root); },
  };
}


/**
 * [ENV fix r2] perf (§5.3 ≤ 150 draws; review m175-r2: 187–247 in the hero views): fold the greybox's leftovers in the
 * undressed zones into the kit's merged groups. Every `kit:<part>` InstancedMesh (one draw + one shadow draw per part
 * type, ~34 of them visible from the atrium / Pit / E2) is baked instance by instance (matrix + instance colour → vertex
 * colours) into the kit baker's class buckets of the instance's vis cell, and the per-region bush meshes into the
 * foliage class; the originals are detached. Kept live: `kit:hand` (clock hands, re-posed every second) and the
 * status-driven `kit:screens`. Class from the part's material: pattern wood / fabric, emissive bulb / shade, casting
 * plain vs non-casting flat, and parts under 10 cm (knobs, notes, keycaps, mugs…) into the per-cell 12 m `small` class.
 * No greybox edit: it still builds (and harmlessly culls) its detached meshes.
 */
function harvestGreybox(groot: THREE.Object3D, baker: Baker, cellOf: (x: number, y: number, z: number) => string | null): { parts: number; instances: number; bushes: number } {
  const pat = (name: 'wood' | 'fabric'): number => getMaterial('toonProp', { instanced: true, color: '#FFFFFF', pattern: name }).userData.uniforms.uPattern.value;
  const WOOD = pat('wood'), FABRIC = pat('fabric');
  const out = { parts: 0, instances: 0, bushes: 0 };
  const drop: THREE.Object3D[] = [];
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), p = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion(), nm = new THREE.Matrix3();
  groot.traverse((o) => {
    const mat = o instanceof THREE.Mesh ? singleMat(o.material) : null;
    if (o instanceof THREE.InstancedMesh && mat && /^kit:/.test(o.name) && o.name !== 'kit:hand' && o.name !== 'kit:screens' && mat.userData.hqKind === 'toonProp') {
      const u = mat.userData.uniforms?.uPattern?.value ?? 0;
      const emis = 'emissive' in mat && mat.emissive instanceof THREE.Color && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0;
      const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(src.attributes)) if (k !== 'position' && k !== 'normal') src.deleteAttribute(k);
      if (!src.getAttribute('normal')) src.computeVertexNormals();
      src.computeBoundingSphere();
      const r0 = src.boundingSphere?.radius ?? 0;
      const pos0 = src.getAttribute('position'), nrm0 = src.getAttribute('normal'), n = pos0.count;
      const n0 = o.count;
      for (let i = 0; i < n0; i++) {
        o.getMatrixAt(i, m4);
        if (o.instanceColor) o.getColorAt(i, col); else col.set('#FFFFFF');
        m4.decompose(p, q, sc);
        const cls = emis ? (u === FABRIC ? 'shade' : 'bulb') : u === WOOD ? 'wood' : u === FABRIC ? 'fabric'
          : r0 * Math.max(sc.x, sc.y, sc.z) < 0.1 ? 'small' : o.castShadow ? 'plain' : 'flat';
        const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), c = new Float32Array(n * 3);
        nm.getNormalMatrix(m4);
        const v = new THREE.Vector3();
        for (let j = 0; j < n; j++) {
          v.fromBufferAttribute(nrm0, j);
          const down = v.y < -0.6 ? 0.82 : 1; // same underside darkening as bakePart
          v.applyMatrix3(nm).normalize();
          nrm[j * 3] = v.x; nrm[j * 3 + 1] = v.y; nrm[j * 3 + 2] = v.z;
          v.fromBufferAttribute(pos0, j).applyMatrix4(m4);
          pos[j * 3] = v.x; pos[j * 3 + 1] = v.y; pos[j * 3 + 2] = v.z;
          c[j * 3] = col.r * down; c[j * 3 + 1] = col.g * down; c[j * 3 + 2] = col.b * down;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array([...Array(n).keys()]), 1) : [...Array(n).keys()]);
        baker.addBaked(g, cls, cellOf(p.x, p.y, p.z) ?? 'OUT');
        out.instances++;
      }
      src.dispose();
      out.parts++;
      drop.push(o);
    } else if (o instanceof THREE.Mesh && mat && /^hq:bushes:/.test(o.name) && mat.userData.hqKind === 'foliage') {
      const g = o.geometry.index ? o.geometry : o.geometry.clone();
      if (!g.index) { const n = g.getAttribute('position').count; g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array([...Array(n).keys()]), 1) : [...Array(n).keys()]); }
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
      g.computeBoundingBox();
      const cc = (g.boundingBox ?? new THREE.Box3()).getCenter(new THREE.Vector3());
      baker.addBaked(g, 'foliage', cellOf(cc.x, cc.y, cc.z) ?? 'OUT');
      out.bushes++;
      drop.push(o);
    }
  });
  for (const o of drop) o.parent?.remove(o);
  return out;
}


/**
 * [ENV fix m3 r1] Window scenery by the hour (review m3 r1 art: "at 22 h the hills and trees stay bright saturated
 * green against a black starry sky, a day card pasted under a night sky"). The outdoor named groups (garden trees, the
 * west hills + trees + cottages, the plan-view side lawns) get their own material instances (same programs:
 * `getMaterial(…, {uniforms})` is a fresh material, not a new program) whose diffuse colour is a multiplier on the baked
 * vertex albedo, driven by RND's shared `uNight` / `uGolden` (read only): white by day, a warm rim at golden hour, dark
 * blue-green silhouettes at night (≈ the sky shader's own hill cards, × 0.35–0.4). Glow parts (the cottages' `shade`
 * panes) keep the shared lamp material, so after dark their windows are the only warm dots on the hills.
 * `setCast(b)`: the groups' foliage / prop meshes cast shadows only while `b` (build/index.ts: eye outside).
 */
export const SCENERY_TINT = Object.freeze({ golden: [1.05, 0.94, 0.82], night: [0.17, 0.25, 0.36] });
function createSceneryTint(kitGroups: Map<string, THREE.Group>, names: string[]) {
  const mats: THREE.Material[] = [], tints: THREE.Color[] = [], casters: THREE.Object3D[] = [];
  for (const n of names) kitGroups.get(n)?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m0 = singleMat(o.material);
    if (!m0?.userData?.hqKind || emissiveHex(m0) !== 0) return;
    const kind: unknown = m0.userData.hqKind;
    if (kind !== 'foliage' && kind !== 'toonProp') return;
    const m = getMaterial(kind, { instanced: o instanceof THREE.InstancedMesh, vertexColors: true, color: '#FFFFFF', pattern: m0.userData.uniforms?.uPattern?.value ?? 0, uniforms: {} });
    o.material = m;
    if (o.customDepthMaterial) applyDepthMaterial(o);
    mats.push(m);
    if ('color' in m && m.color instanceof THREE.Color) tints.push(m.color);
    if (o.castShadow) casters.push(o);
  });
  // the rigid classes cast through the group's position-only caster mesh (kit/index.ts castMesh)
  for (const n of names) kitGroups.get(n)?.traverse((o) => { if (o instanceof THREE.Mesh && /:cast$/.test(o.name) && o.castShadow) casters.push(o); });
  const glow: THREE.Object3D[] = [];
  for (const n of names) kitGroups.get(n)?.traverse((o) => { if (o instanceof THREE.Mesh && emissiveHex(singleMat(o.material)) !== 0) glow.push(o); });
  let key = -1, cast = true, glowOn = true;
  const col: number[] = [1, 1, 1];
  return {
    update() {
      const nt = U.uNight.value, g = U.uGolden.value * (1 - nt);
      const k = Math.round(nt * 200) * 1000 + Math.round(g * 200);
      if (k === key) return;
      key = k;
      for (let i = 0; i < 3; i++) col[i] = (1 + (SCENERY_TINT.golden[i] - 1) * g) * (1 - nt) + SCENERY_TINT.night[i] * nt;
      for (const t of tints) t.setRGB(col[0], col[1], col[2]);
    },
    setCast(b: boolean) { if (b === cast) return; cast = b; for (const o of casters) o.castShadow = b; },
    setGlow(b: boolean) { if (b === glowOn) return; glowOn = b; for (const o of glow) o.visible = b; },
    stats: () => ({ mats: mats.length, casters: casters.length, tint: col.map((v) => +v.toFixed(3)), cast }),
  };
}
