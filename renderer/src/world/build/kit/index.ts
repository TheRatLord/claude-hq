/**
 * Prop kit registry + baker (§7.5). `KIT[name](params, rng) → Item`; `createBaker({cellOf})` places items (seeded,
 * baked, per vis cell) and `finish()` merges them into ≤ 9 meshes per cell (material classes below), all on existing
 * programs: toonProp INSTANCED+VCOL (count-1 instanced meshes, identity matrix, white instance colour) with the
 * wood / fabric / none patterns as uniforms, and foliage VCOL+SWAY. Owner: ENV.
 */
import * as THREE from 'three';
import { getMaterial, applyDepthMaterial } from '../../../render/materials/index.ts';
import { markCaster, LAYERS } from '../../../render/layers.ts';
import { bakePart, mergeBaked, rngOf, trisOf, withDetail } from './core.ts';
import type { Item, KitParams, Part, Pose, V3 } from './core.ts';

export type { Pose };
import { KIT, KIT_SHEET, SIGNATURE } from './registry.ts';

export { KIT, KIT_SHEET, SIGNATURE };

/** A material class: its material factory, shadow casting, far-draw distance and mesh kind. */
interface ClassDef { cast: boolean; far?: number; plainMesh?: boolean; mat: () => THREE.Material }
/** Material classes → material factory + casting. */
const CLASS: Record<string, ClassDef> = {
  wood: { cast: true, mat: () => getMaterial('toonProp', { instanced: true, vertexColors: true, color: '#FFFFFF', pattern: 'wood' }) },
  fabric: { cast: true, mat: () => getMaterial('toonProp', { instanced: true, vertexColors: true, color: '#FFFFFF', pattern: 'fabric' }) },
  plain: { cast: true, mat: () => getMaterial('toonProp', { instanced: true, vertexColors: true, color: '#FFFFFF' }) },
  flat: { cast: false, mat: () => getMaterial('toonProp', { instanced: true, vertexColors: true, color: '#FFFFFF' }) },
  small: { cast: false, far: 12, mat: () => getMaterial('toonProp', { instanced: true, vertexColors: true, color: '#FFFFFF' }) },
  foliage: { cast: true, plainMesh: true, mat: () => getMaterial('foliage', { vertexColors: true, color: '#FFFFFF' }) },
  // §5.0 bulbs 1.8 (×0.6 by day); fabric shades glow only after dark (RND fix r1 values)
  bulb: { cast: false, mat: () => getMaterial('toonProp', { instanced: true, vertexColors: true, color: '#FFFFFF', emissive: '#FFE2B0', emissiveIntensity: 1.8, emissiveDay: 0.6 }) },
  shade: { cast: false, mat: () => getMaterial('toonProp', { instanced: true, vertexColors: true, color: '#FFFFFF', pattern: 'fabric', emissive: '#FFD39A', emissiveIntensity: 0.8, emissiveDay: 0 }) },
  flame: { cast: false, plainMesh: true, mat: () => getMaterial('foliage', { vertexColors: true, color: '#FFFFFF', emissive: '#E0843C', emissiveIntensity: 1.1, emissiveDay: 0.8 }) },
};

/** Material class of a part: small props merge into the distance-culled class, non-casting plain parts into `flat`. */
const classOf = (item: Pick<Item, 'small'>, p: Part): string => {
  const cls = p.mat;
  if (item.small && (cls === 'plain' || cls === 'wood' || cls === 'fabric')) return 'small';
  if (cls === 'plain' && (!p.cast || tiny(p.geometry))) return 'flat'; // [ENV fix r1] perf: < 4 cm parts cast no shadow
  return cls;
};
/** Bounding-sphere radius of a geometry (computed on first use). */
const radiusOf = (g: THREE.BufferGeometry): number => { if (!g.boundingSphere) g.computeBoundingSphere(); return g.boundingSphere?.radius ?? 0; };
/** Index count of a baked geometry (every baked / merged geometry is indexed). */
const indexCount = (g: THREE.BufferGeometry): number => g.index?.count ?? 0;
/** A part too small to cast a visible shadow (knobs, casters, pins): bounding radius under 4 cm. */
const tiny = (g: THREE.BufferGeometry) => radiusOf(g) < 0.04;
const tE = new THREE.Euler(), tQ = new THREE.Quaternion(), tS = new THREE.Vector3(), tP = new THREE.Vector3();
/** Pose → matrix. pose = {x, y, z, yaw, rx?, rz?, s?} (yaw = prop-front yaw: local +z faces `yaw`). */
export const poseMatrix = (pose: Pose) => {
  tE.set(pose.rx ?? 0, pose.yaw ?? 0, pose.rz ?? 0, 'YXZ');
  const s = pose.s ?? 1;
  return new THREE.Matrix4().compose(tP.set(pose.x, pose.y ?? 0, pose.z), tQ.setFromEuler(tE), tS.set(s, s, s));
};
/** Local point → world with a placement matrix. */
export const toWorld = (m: THREE.Matrix4, [x, y, z]: V3) => new THREE.Vector3(x, y, z).applyMatrix4(m);

/** [ENV fix m2 r1] classes merged into one `base` mesh per draw group: casting `plain` first, then the non-casting
 *  `flat` / `small` parts (the shadow pass draws only the casting range, see finish()). */
const BASE = new Set(['plain', 'flat', 'small']);
/** Non-LOD emissive classes (bulbs, shades, flames): tiny, non-casting, always drawn at full detail. */
const GLOW = new Set(['bulb', 'shade', 'flame']);
/** [ENV fix m2 r1] far-LOD geometry detail (radial segments × this, bevels → chamfers). */
export const FAR_DETAIL = 0.3;
/** Far-LOD twins drop parts smaller than this bounding radius (knobs, pins, notes, keycaps: sub-pixel beyond ~8 m). */
const FAR_MIN_R = 0.1; // [ENV fix m2 r3] was 0.06 (§5.3 tris: 32k far tris of 6–10 cm parts, sub-pixel beyond LOD_M + a few m)
/** Far-LOD run meshes (draws): enough for the runs left between ≤ 3 near chunks. */
const FAR_RUNS = 6;
/**
 * [ENV M3.5 tris] distance cap: a far chunk the caller marks `capped` (build/index.ts: beyond FAR2_M, or the plan view)
 * draws only its far parts at least this big (bounding radius); the 10–22 cm ones (stool rungs, pot saucers, lamp
 * arms, frames…) are 1–3 px there. Merged proxies (far shelf spines, rug fields) are big, so rooms keep their dressing.
 */
export const FAR2_MIN_R = 0.22;
/** A capped chunk's small-part range this short (index count) is drawn anyway when it would otherwise split a run. */
const BRIDGE_MAX = 3 * 1500;

/**
 * `lod`: also bake a low-detail copy (FAR_DETAIL, no small parts) of every non-glow part into `<group>~far` (shown
 * beyond that many metres); `groupOf`: the draw group a cell's class bucket merges into (default = the cell itself)
 */
export interface BakerOptions {
  cellOf?: (x: number, y: number, z: number) => string | null | undefined;
  groupOf?: (cell: string, cls: string) => string;
  lod?: number;
  /** [ENV M3.5 tris] the office-wide glow group whose class buffers are laid out chunk by chunk in `farOrder` */
  rangeGroup?: string;
  chunkOf?: (cell: string) => string;
  farOrder?: string[];
}
/** Per-placement options of `place`. */
export interface PlaceOpts { cell?: string; jitter?: number; group?: string; noFar?: boolean }
interface ClassStat { tris: number; farTris: number; castTris: number; meshes: number }
/** A run of the far-LOD buffer (a drawn segment or a gap). */
interface Seg { gap?: boolean; k?: string; hidden?: boolean; s0: number; n: number }
/** The far-LOD buffer (see buildFar). */
export interface FarLod {
  group: THREE.Group;
  keys: string[];
  ranges: Map<string, [number, number]>;
  smallRanges: Map<string, [number, number]>;
  setNear: (skip: (key: string) => boolean, hidden?: (key: string) => boolean, capped?: (key: string) => boolean) => number;
  runs: { mesh: THREE.InstancedMesh; start: number; count: number }[];
  tris: number;
  readonly drawnTris: number;
}
export interface Baker {
  place: (name: string, params: KitParams | null | undefined, pose: Pose, seed?: string | number, po?: PlaceOpts) => { item: Item; m: THREE.Matrix4; cell: string };
  addBaked: (geo: THREE.BufferGeometry, cls: string, cell: string) => void;
  finish: () => Map<string, THREE.Group>;
  counts: Map<string, { props: number; tris: number; byType: Record<string, number> }>;
  classStats: Record<string, ClassStat>;
  groupCells: Map<string, Set<string>>;
  readonly far: FarLod | null;
  readonly size: number;
}
export function createBaker(o: BakerOptions = {}): Baker {
  const cellOf = o.cellOf ?? (() => 'all');
  const groupOf = o.groupOf ?? ((cell: string) => cell);
  /** draw group → the vis cells merged into it */
  const groupCells = new Map<string, Set<string>>();
  /** draw group → material class → baked geometries */
  const buckets = new Map<string, Map<string, THREE.BufferGeometry[]>>();
  const counts = new Map<string, { props: number; tris: number; byType: Record<string, number> }>();
  /** [ENV fix m2 r1] material class → {tris (near detail), farTris, meshes} (filled by finish(); __hq.stats().props.classes) */
  const classStats: Record<string, ClassStat> = {};
  let seq = 0;
  const push = (key: string, cls: string, cell: string, g: THREE.BufferGeometry) => {
    const cells = groupCells.get(key) ?? new Set<string>();
    groupCells.set(key, cells);
    cells.add(cell);
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = new Map()));
    let list = bucket.get(cls);
    if (!list) bucket.set(cls, (list = []));
    if (key === o.rangeGroup) g.userData.chunk = o.chunkOf?.(cell) ?? cell; // [ENV M3.5 tris] range-culled group
    list.push(g);
  };
  /** chunk → far-LOD geometries (one class: plain toonProp), split at FAR2_MIN_R ([ENV M3.5 tris] the distance cap
   *  drops `small`) */
  const farBuckets = new Map<string, { big: THREE.BufferGeometry[]; small: THREE.BufferGeometry[] }>();
  const pushFar = (key: string, cell: string, g: THREE.BufferGeometry, r: number) => {
    const cells = groupCells.get(key) ?? new Set<string>();
    groupCells.set(key, cells);
    cells.add(cell);
    let fb = farBuckets.get(key);
    if (!fb) farBuckets.set(key, (fb = { big: [], small: [] }));
    fb[r >= FAR2_MIN_R ? 'big' : 'small'].push(g);
  };
  /**
   * Place a kit item. Returns {item, m (Matrix4), cell}. `seed` defaults to a running counter.
   */
  function place(name: string, params: KitParams | null | undefined, pose: Pose, seed?: string | number, po: PlaceOpts = {}) {
    const build = KIT[name];
    if (!build) throw new Error(`kit: no builder ${name}`);
    const sd = seed ?? `${name}:${seq++}`;
    const rng = rngOf(sd);
    const item = build(params ?? {}, rng);
    const far = o.lod && !po.noFar ? withDetail(FAR_DETAIL, () => build(params ?? {}, rngOf(sd))) : null; // [ENV fix m2 r2] po.noFar: always-near groups (K~trees)
    const m = poseMatrix(pose);
    const cell = po.cell ?? cellOf(pose.x, pose.y ?? 0, pose.z) ?? 'OUT';
    const jit = 1 + (rng() * 2 - 1) * (po.jitter ?? 0.04);
    const colors = { ...item.colors, ...(params?.colors ?? {}) };
    const bake = (p: Part, cls: string, key: string) => push(key, cls, cell, bakePart(p, colors, jit, m, { contact: !params?.noContact }));
    // [ENV fix m2 r1] `po.group`: a named draw group for every class (the W bays' swappable desk / amenity sets)
    // [ENV fix m2 r3] a builder may return a reduced far twin (rugs: border + field only): then each far part is
    // classified by itself instead of by its index-matched near part
    if (far) {
      const same = far.parts.length === item.parts.length;
      far.parts.forEach((p, i) => {
        const cls = classOf(item, same ? item.parts[i] : p);
        const r = radiusOf(p.geometry) * (pose.s ?? 1);
        if (cls !== 'small' && !GLOW.has(cls) && r >= FAR_MIN_R) pushFar(po.group ?? groupOf(cell, 'plain'), cell, bakePart(p, colors, jit, m, { contact: !params?.noContact }), r);
      });
    }
    // (a named group folds fabric into plain: one draw + one shadow draw less per swap set; the pattern is subtle)
    for (const p of item.parts) { let cls = classOf(item, p); if (po.group && cls === 'fabric') cls = 'plain'; bake(p, cls, po.group ?? groupOf(cell, cls)); }
    const c = counts.get(cell) ?? { props: 0, tris: 0, byType: {} };
    c.props++; c.tris += trisOf(item); c.byType[name] = (c.byType[name] ?? 0) + 1;
    counts.set(cell, c);
    return { item, m, cell };
  }
  /**
   * [ENV fix r2] Add an already-baked world-space geometry (position / normal / color, indexed) to a class bucket of the
   * draw group of `cell` (and, unless small or glowing, to its `~far` twin). Used to fold the greybox's per-part
   * InstancedMeshes and bush meshes of the undressed zones into the kit's merged groups (draw budget).
   */
  function addBaked(geo: THREE.BufferGeometry, cls: string, cell: string) {
    const key = groupOf(cell, cls);
    push(key, cls, cell, geo);
    if (o.lod && cls !== 'small' && !GLOW.has(cls) && radiusOf(geo) >= FAR_MIN_R) pushFar(groupOf(cell, 'plain'), cell, geo.clone(), radiusOf(geo));
  }
  /**
   * Merge everything into per-group Groups (one child per material class; plain + flat + small share one `base`
   * mesh whose shadow pass draws only the casting range). Frees the baked geometries.
   */
  function finish(): Map<string, THREE.Group> {
    const groups = new Map<string, THREE.Group>();
    for (const [key, bucket] of buckets) {
      const grp = new THREE.Group();
      grp.name = `kit:${key}`;
      const far = false;
      /** [cls, geos, casting index count] */
      const jobs: [string, THREE.BufferGeometry[], number][] = [];
      const base: THREE.BufferGeometry[] = [], nCast: THREE.BufferGeometry[] = [];
      for (const cls of ['plain', 'flat', 'small']) for (const g of bucket.get(cls) ?? []) { base.push(g); if (cls === 'plain') nCast.push(g); }
      if (base.length) jobs.push(['base', base, nCast.reduce((n, g) => n + indexCount(g), 0)]);
      for (const [cls, geos] of bucket) if (!BASE.has(cls)) jobs.push([cls, geos, -1]);
      /** casting index prefixes of the rigid classes */
      const casts: [THREE.BufferGeometry, number][] = [];
      // [ENV M3.5 tris] `o.rangeGroup` (the office-wide glow group): each class buffer is laid out chunk by chunk in
      // `o.farOrder`, and mesh.userData.chunkRanges = chunk → [start, count] (index), so build/index.ts can trim its
      // drawRange to the span of the chunks in sight (same one draw per class; the lamps behind walls cost nothing)
      const ranged = key === o.rangeGroup;
      const ord = ranged ? new Map((o.farOrder ?? []).map((c, i): [string, number] => [c, i])) : null;
      for (const [cls, geos, castN] of jobs) {
        let chunkRanges: Map<string, [number, number]> | null = null;
        if (ranged && ord) {
          geos.sort((a, b) => (ord.get(a.userData.chunk) ?? 1e9) - (ord.get(b.userData.chunk) ?? 1e9));
          const ranges = new Map<string, [number, number]>();
          chunkRanges = ranges;
          let at0 = 0;
          for (const q of geos) { const c: string = q.userData.chunk, r = ranges.get(c) ?? [at0, 0]; r[1] += indexCount(q); ranges.set(c, r); at0 += indexCount(q); }
        }
        const g = mergeBaked(geos);
        for (const q of geos) q.dispose();
        if (!g) continue;
        const def = CLASS[cls === 'base' ? 'plain' : cls];
        let mesh: THREE.Mesh | THREE.InstancedMesh;
        if (def.plainMesh) mesh = new THREE.Mesh(g, def.mat());
        else {
          const im = new THREE.InstancedMesh(g, def.mat(), 1);
          im.setMatrixAt(0, new THREE.Matrix4());
          im.setColorAt(0, new THREE.Color('#FFFFFF'));
          im.computeBoundingSphere();
          mesh = im;
        }
        mesh.name = `kit:${key}:${cls}`;
        mesh.receiveShadow = true;
        if (chunkRanges) mesh.userData.chunkRanges = chunkRanges;
        const cast = cls === 'base' ? castN > 0 : def.cast;
        if (cast && def.plainMesh) { markCaster(mesh); applyDepthMaterial(mesh); } // foliage: its own (swaying) depth program
        else if (cast) casts.push([g, cls === 'base' ? castN : indexCount(g)]);
        const t = indexCount(g) / 3, st = (classStats[cls] ??= { tris: 0, farTris: 0, castTris: 0, meshes: 0 });
        st[far ? 'farTris' : 'tris'] += t; st.meshes++;
        if (cast && !far) st.castTris += cls === 'base' ? castN / 3 : t;
        grp.add(mesh);
      }
      const caster = castMesh(casts, key);
      if (caster) grp.add(caster);
      groups.set(key, grp);
    }
    buckets.clear();
    farLod = buildFar(o.farOrder ?? [...farBuckets.keys()]);
    return groups;
  }
  /**
   * [ENV fix m2 r1] One shadow-only mesh per draw group: the casting parts of base + wood + fabric merged (positions
   * only) so a chunk costs one shadow draw instead of three (§5.3 shadow ≤ 25 at the street). It lives on the CASTERS
   * layer alone (no hq material, so post.ts's layer sweep leaves it there), so the main passes never draw it; the
   * shadow pass draws it with the shared instanced depth material, like every other kit caster.
   */
  function castMesh(casts: [THREE.BufferGeometry, number][], key: string) {
    const n = casts.reduce((a, [, c]) => a + c, 0);
    if (!n) return null;
    let nv = 0;
    for (const [g] of casts) nv += g.attributes.position.count;
    const pos = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    let v0 = 0, i0 = 0;
    for (const [g, c] of casts) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { pos[(v0 + i) * 3] = p.getX(i); pos[(v0 + i) * 3 + 1] = p.getY(i); pos[(v0 + i) * 3 + 2] = p.getZ(i); }
      const ix = g.index?.array ?? [];
      for (let i = 0; i < c; i++) idx[i0 + i] = ix[i] + v0;
      v0 += p.count; i0 += c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.InstancedMesh(g, castMat ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.setColorAt(0, new THREE.Color('#FFFFFF'));
    mesh.computeBoundingSphere();
    mesh.name = `kit:${key}:cast`;
    mesh.castShadow = true;
    mesh.layers.set(LAYERS.CASTERS);
    return mesh;
  }
  let castMat: THREE.MeshBasicMaterial | null = null;
  /**
   * [ENV fix m2 r1] The far LOD: every chunk's low-detail geometry in ONE office-wide buffer (plain toonProp, no
   * pattern, non-casting), laid out in `order`, drawn as ≤ FAR_RUNS meshes that share it, each drawing one contiguous
   * run of far chunks (geometry.drawRange set in onBeforeRender). `setNear(set)` = the chunks drawn by their near
   * meshes instead (and hidden ones); the far runs cover the rest. So the far office costs ≤ FAR_RUNS draws
   * (more only when the near chunks alone cut it into more runs: [ENV fix m2 r2] the pool then grows, nothing is
   * dropped). Returns {group, keys, ranges, setNear, runs: [{mesh, start, count}], tris}.
   */
  function buildFar(order: string[]): FarLod | null {
    const keys = [...order.filter((k) => farBuckets.has(k)), ...[...farBuckets.keys()].filter((k) => !order.includes(k))];
    if (!keys.length) return null;
    // [ENV M3.5 tris] buffer = every chunk's big parts (in `order`), then every chunk's small parts (same order): a
    // capped chunk draws only its big range, and a run may flow from the last big range into the first small one
    const ranges = new Map<string, [number, number]>(), smallRanges = new Map<string, [number, number]>();
    const all: THREE.BufferGeometry[] = [];
    let at0 = 0;
    for (const [part0, map] of [['big', ranges], ['small', smallRanges]] as const) for (const k of keys) {
      const geos = farBuckets.get(k)?.[part0] ?? [];
      const n = geos.reduce((a, g) => a + indexCount(g), 0);
      map.set(k, [at0, n]); at0 += n;
      all.push(...geos);
    }
    const g = mergeBaked(all);
    for (const q of all) q.dispose();
    farBuckets.clear();
    if (!g) return null;
    const grp = new THREE.Group();
    grp.name = 'kit:~far';
    const runs: { mesh: THREE.InstancedMesh; start: number; count: number }[] = [];
    const addRun = (i: number) => {
      const mesh = new THREE.InstancedMesh(g, CLASS.plain.mat(), 1);
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.setColorAt(0, new THREE.Color('#FFFFFF'));
      mesh.computeBoundingSphere();
      mesh.name = `kit:~far:run${i}`;
      mesh.receiveShadow = true;
      mesh.visible = false;
      const run = { mesh, start: 0, count: 0 };
      mesh.onBeforeRender = () => { g.drawRange.start = run.start; g.drawRange.count = run.count; };
      mesh.onAfterRender = () => { g.drawRange.start = 0; g.drawRange.count = Infinity; };
      runs.push(run);
      grp.add(mesh);
      return run;
    };
    for (let i = 0; i < FAR_RUNS; i++) addRun(i);
    const st = (classStats.far ??= { tris: 0, farTris: 0, castTris: 0, meshes: 0 });
    st.farTris += indexCount(g) / 3; st.meshes += FAR_RUNS;
    let drawnTris = 0;
    /**
     * `skip`: chunks not drawn by the far LOD (near or hidden); `hidden`: skipped because culled (bridgeable), not
     * near; `capped`: [ENV M3.5 tris] drawn, but only its big parts (distance cap).
     */
    const setNear = (skip: (key: string) => boolean, hidden: (key: string) => boolean = () => false, capped: (key: string) => boolean = () => false) => {
      // maximal runs over the buffer's entries (big ranges, then small ranges); empty ranges never split a run
      let segs: Seg[] = [];
      let cur: Seg | null = null;
      const entry = (k: string, s0: number, n: number, draw: boolean, bridge: boolean) => {
        if (!n) return;
        if (!draw) { cur = null; segs.push({ gap: true, k, hidden: bridge, s0, n }); return; }
        if (!cur) { cur = { s0, n }; segs.push(cur); } else cur.n = s0 + n - cur.s0;
      };
      for (const k of keys) { const [s0, n] = ranges.get(k) ?? [0, 0], sk = skip(k); entry(k, s0, n, !sk, sk && hidden(k)); }
      for (const k of keys) { const [s0, n] = smallRanges.get(k) ?? [0, 0], sk = skip(k), cap = !sk && capped(k); entry(k, s0, n, !sk && !cap, cap || (sk && hidden(k))); }
      const bridge = (i: number) => { const a = segs[i - 1], b = segs[i + 1]; a.n = b.s0 + b.n - a.s0; segs.splice(i, 2); };
      const between = (q: Seg, j: number) => q.gap && q.hidden && j > 0 && j < segs.length - 1 && !segs[j - 1].gap && !segs[j + 1].gap;
      // a short capped / culled range between two runs is cheaper drawn than as one more draw
      for (let i = segs.findIndex((q, j) => between(q, j) && q.n <= BRIDGE_MAX); i >= 0; i = segs.findIndex((q, j) => between(q, j) && q.n <= BRIDGE_MAX)) bridge(i);
      // bridge hidden gaps (drawing a culled chunk is harmless, overlapping a near one is not) until runs fit
      const count = () => segs.filter((q) => !q.gap).length;
      while (count() > FAR_RUNS) {
        const i = segs.findIndex(between);
        if (i < 0) break;
        bridge(i);
      }
      segs = segs.filter((q) => !q.gap);
      // [ENV fix m2 r2] never truncate: when the near chunks alone split the far office into more than FAR_RUNS runs
      // (no hidden gap left to bridge), the pool grows by one run mesh per extra segment (a far range may not be
      // bridged across a near chunk: its low-detail twin would z-fight the full-detail meshes). Rare by construction
      // (≤ MAX_NEAR near chunks → ≤ 4 runs in today's order), so an extra draw beats a chunk vanishing from the frame.
      while (runs.length < segs.length) addRun(runs.length);
      if (segs.length > st.meshes) st.meshes = segs.length;
      runs.forEach((r, i) => { const q = segs[i]; r.mesh.visible = !!q; if (q) { r.start = q.s0; r.count = q.n; } });
      drawnTris = segs.reduce((a, q) => a + q.n / 3, 0);
      return segs.length;
    };
    return { group: grp, keys, ranges, smallRanges, setNear, runs, tris: indexCount(g) / 3, get drawnTris() { return drawnTris; } };
  }
  let farLod: FarLod | null = null;
  return { place, addBaked, finish, counts, classStats, groupCells, get far() { return farLod; }, get size() { return seq; } };
}
