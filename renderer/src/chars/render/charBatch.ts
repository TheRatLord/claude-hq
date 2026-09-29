/**
 * charBatch (DESIGN §5.4, §6.2): one InstancedMesh per part type + one hull InstancedMesh per hulled type, for every
 * character. Rigs are pure-math trees; each frame `write()` packs the world matrices and colours of every visible part
 * of every visible actor into the type buffers (hidden parts are simply not written) and sets `mesh.count`, so a type
 * with no visible instance costs no draw. All meshes are `frustumCulled = false`; culling is per actor in JS (bounding
 * sphere vs the camera frustum, expanded for shadows that can land in view).
 *
 * Hulls (§5.1): back-face ink shells drawn after the parts, never in the shadow pass, width distance-scaled in screen
 * space (3.2 px at 1.5 m → 1.2 px at 18 m). If the RND hull material extrudes in its vertex shader
 * (`material.userData.screenSpaceHull`), hull instances get the part matrix; otherwise charBatch widens the hull per
 * axis in JS by the same pixel width. Glints (§6.1) are placed per frame toward the key light in screen space with a
 * radius of max(0.018 m, 2.5 px). Owner: CHR.
 */
import * as THREE from 'three';
import { CORE, MISC, BODY, KIND_BODY, workspaceColor, STATUS } from '../../../../shared/palette.ts';
import { getMaterial, materialData } from '../../render/materials/index.ts';
import { geometryFor, extentOf, partDef, PART_TYPES, LO_TYPES, hasLo, trisOf, type PartType } from './geometry.ts';
import { hqStatSection } from '../../core/debug.ts';
import { KEY_DIR as RND_KEY_DIR } from '../../render/lightMath.ts';
import { setViewer } from '../anim/viewer.ts';
import { nodeData, type RigPart } from '../rig/build.ts';
import type { Rig } from '../rig/clawd.ts';
import type { Personality } from '../anim/personality.ts';

/** State-driven outline (§6.7): `width` is a multiple of the base hull px; `pulse` Hz breathes width + colour. */
export interface OutlineSpec { color: string; width: number; pulse?: number }

export interface CharHandle {
  setVisible(v: boolean): void;
  /** 0 full · 1 no face micro-parts · 2 no hull · 3 hidden */
  setLod(level: number): void;
  /** `pulse` defaults to 1.1 Hz for the blocked outline colour */
  setOutline(o: OutlineSpec | null): void;
  remove(): void;
}

export interface RegisterOpts { kind: string; colorIndex?: number; cycle?: number }

export interface CharBatchStats {
  draws: number;
  shadowDraws: number;
  instances: number;
  visibleActors: number;
  smeared: number;
  replayed: number;
  tris: number;
  shadowTris: number;
  farActors: number;
}

export interface CharBatch {
  register(rig: Rig, o: RegisterOpts): CharHandle;
  /** once per frame after animators (§8.1 step 4) */
  write(): void;
  /** registered rigs */
  count(): number;
  stats(): CharBatchStats;
  /** the batch root (added to the scene or the CharPass) */
  group: THREE.Group;
  dispose(): void;
}

export interface CharBatchOptions {
  scene: THREE.Object3D;
  camera?: THREE.Camera | null;
  layers?: { chars?: number; hulls?: number };
  quality?: { tier: string } | null;
  viewportHeight?: (() => number) | null;
  keyDir?: THREE.Vector3;
  /** [CHR M3.5] a portrait-atlas batch (portraitBatch.ts): full detail at any distance (no far LOD, face micro-parts
   * always on, hulls always), no smears, no `__hq.stats().chars` section and it never moves the viewer */
  portrait?: boolean;
}

/** A mesh with its per-instance colour attribute guaranteed (three types it nullable). */
type CharMesh = THREE.InstancedMesh & { instanceColor: THREE.InstancedBufferAttribute };

/** One instanced batch per part type (and LOD): the part mesh + its optional hull mesh. */
interface Batch {
  type: PartType;
  lo: boolean;
  mesh: CharMesh;
  hull: CharMesh | null;
  cap: number;
  /** instances written this frame (parts / hulls) */
  n: number;
  hn: number;
  /** n / hn before the actor being written (LOD cache capture) */
  n0: number;
  hn0: number;
  ext: THREE.Vector3;
  cast: boolean;
  tris: number;
}

interface PartColor { c: THREE.Color; h: THREE.Color }

interface Outline { color: THREE.Color; width: number; cur: THREE.Color; pulse: number }

/**
 * The LOD instance cache of one actor: `recs` is a flat record list, four slots per range written this frame
 * [batch, isHull, offset (instances into mats/cols), count], `nr` its used length.
 */
interface InstanceCache {
  recs: (Batch | boolean | number)[];
  nr: number;
  mats: Float32Array;
  cols: Float32Array;
  root: Float32Array;
  serial: number | undefined;
  version: number;
  lod: number;
  outline: Outline | null;
  hull: boolean;
  far: boolean;
}

/** A registered rig. */
interface Entry {
  rig: Rig;
  o: RegisterOpts;
  cols: PartColor[] | null;
  version: number;
  visible: boolean;
  lod: number;
  outline: Outline | null;
  prev: Float32Array;
  stamp: Int32Array;
  far: boolean;
  cache?: InstanceCache | null;
}

/** Pre-sized list of the visible part indices of one actor (grown only on demand). */
interface PartList { a: Int32Array; n: number }

/** Studio key direction (toward the light): elevation 60°, plan azimuth 200° (§5.0). */
export const KEY_DIR = new THREE.Vector3(...RND_KEY_DIR).normalize();

const WHITE = '#ffffff';
const TAU = Math.PI * 2;
/** Part types that smear (noodle arms, hands, bodies, props) and the screen speed (px/frame) where smearing starts. */
const SMEAR = new Set(['limb', 'sphere', 'body', 'rbox', 'cyl']);
const SMEAR_PX = 14;
const HULL_TIER_DIST: Record<string, number> = { low: 10, medium: 18, high: Infinity, photo: Infinity };
/**
 * [CHR m2 fix r3] Far hull LOD (§5.3): beyond FAR_LOD.in m (view distance to the actor's centre) or in a top-down view the
 * actor draws the low-poly geometry variants (geometry.ts LO) for its parts and hulls, in the main and the shadow pass.
 * FAR_LOD.out < FAR_LOD.in is the hysteresis so an actor pacing at the threshold never flickers between the two.
 */
// `?charlod=off` (debug A/B for perf / review): full detail at any distance
// [CHR fix m3-r1] (code review: crowd40 at spawn drew 153 calls and 370k character tris, the far LOD only kicking in at
// plan) the far LOD now starts at 10 m (out at 9), the §5.3 LOD row's reduced-rate band: a Clawd is ≤ 90 px tall there
// and the low-poly shells keep its silhouette. Far actors also drop their thin-part hulls (FAR_NO_HULL) and parts under
// FAR_MICRO_PX on screen (lanyard emblems, buttons, eye-bags…).
export const FAR_LOD = { in: 10, out: 9, on: !/[?&]charlod=off\b/.test(globalThis.location?.search ?? '') };
/**
 * [CHR fix m3-r1] Far actors outline only their volumes (body block, Shelly's head / torso, hats): a 1–2 px ink hull
 * around a 3 px noodle arm or mitten doubles its weight at that size (§5.1: "distant agents are never heavy
 * black specks"), and each of these far hull batches was one more draw whenever near and far actors mix.
 */
export const FAR_NO_HULL = new Set(['limb', 'sphere']);
/** [CHR fix m3-r1] Far actors skip parts whose largest world extent covers fewer pixels than this (micro-parts, §5.3). */
export const FAR_MICRO_PX = 1.6;
/** [CHR fix m3-r1] Near actors draw a part's low-poly variant when its largest extent is under this many pixels. */
export const SMALL_LO_PX = 18;
/** Top-down: the camera looks down steeper than ~58° from at least this high above the actor (plan / overview cams). */
const TOPDOWN_FWD_Y = -0.85, TOPDOWN_H = 6;

/**
 * Update world matrices of `n` and its visible descendants only (three's updateMatrixWorld walks hidden subtrees
 * too; a Clawd rig carries ~250 mostly hidden prop/gear/mini nodes) and stamp them visible for this frame.
 */
function updateVisible(n: THREE.Object3D, parentWorld: THREE.Matrix4 | null, frame: number, out: PartList): void {
  if (n.matrixAutoUpdate) n.updateMatrix();
  if (parentWorld) n.matrixWorld.multiplyMatrices(parentWorld, n.matrix); else n.matrixWorld.copy(n.matrix);
  n.matrixWorldNeedsUpdate = false;
  const ud = nodeData(n);
  ud.vis = frame;
  const pi = ud.pi; // indices of the rig parts this node carries (set by charBatch.resolve)
  // [CHR m2 r2 alloc] `out` is a pre-sized {a:Int32Array, n} list (no per-frame array growth)
  if (pi) { let a = out.a; if (out.n + pi.length > a.length) { const g = new Int32Array(Math.max(a.length * 2, out.n + pi.length)); g.set(a); out.a = a = g; } for (let k = 0; k < pi.length; k++) a[out.n++] = pi[k]; }
  const ch = n.children;
  for (let i = 0; i < ch.length; i++) if (ch[i].visible) updateVisible(ch[i], n.matrixWorld, frame, out);
}

/**
 * [CHR m2 r2 alloc] One persistent update range per instance attribute, re-sized in place each frame (setRange). three's
 * addUpdateRange pushes a new {start, count} into an array the renderer empties after every upload (length = 0 drops
 * the backing store), ~100 B per attribute per frame; clearing is made a no-op so the one range object survives.
 */
function fixedRange(a: THREE.BufferAttribute): void {
  a.updateRanges = [{ start: 0, count: 0 }];
  a.clearUpdateRanges = noop;
}
function noop() {}
/** Upload [0, count) of `a` this frame. */
function setRange(a: THREE.BufferAttribute, count: number): void {
  const r = a.updateRanges;
  if (r.length !== 1) { r.length = 0; r.push({ start: 0, count }); } else { r[0].start = 0; r[0].count = count; }
  a.needsUpdate = true;
}

/** Mix two colours in sRGB (perceptual, as ART §4.1 means "ink mixed 20% with the part colour"). */
const _a = { r: 0, g: 0, b: 0 }, _b = { r: 0, g: 0, b: 0 };
function mixSrgb(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  a.getRGB(_a, THREE.SRGBColorSpace); b.getRGB(_b, THREE.SRGBColorSpace);
  return new THREE.Color().setRGB(_a.r + (_b.r - _a.r) * t, _a.g + (_b.g - _a.g) * t, _a.b + (_b.b - _a.b) * t, THREE.SRGBColorSpace);
}

/** Hull width in px at view distance d (§5.1). */
export const hullPx = (d: number): number => Math.min(3.2, Math.max(1.2, 3.2 + (1.2 - 3.2) * ((d - 1.5) / 16.5)));

/** Body colour for a kind with the claude personality shift (hue ±4°, lightness ±5 %). */
export function bodyColorFor(kind: string, pers?: Pick<Personality, 'hue' | 'lightness'> | null): THREE.Color {
  // (kind is free text here: widen the lookup, unknown kinds fall back to pebble)
  const hex = BODY[(KIND_BODY as Record<string, keyof typeof BODY | undefined>)[kind] ?? 'bodyPebble'];
  const c = new THREE.Color(hex);
  if (kind === 'claude' && pers) {
    const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
    c.setHSL(hsl.h + pers.hue / 360, hsl.s, Math.min(1, hsl.l * (1 + pers.lightness * 0.5)));
  }
  return c;
}

export function createCharBatch({ scene, camera = null, layers = {}, quality = null, viewportHeight = null, keyDir = KEY_DIR, portrait = false }: CharBatchOptions): CharBatch {
  const group = new THREE.Group();
  group.name = 'charBatch';
  scene.add(group);

  const litMat = getMaterial('toonChar', { instanced: true, color: WHITE });
  const hullMat = getMaterial('hull', { instanced: true, color: WHITE });
  // RND's hull extrudes in its vertex shader (uHullScale); a plain back-face material needs the JS widening below.
  // (`screenSpaceHull` is a flag the hull material sets on its userData, beyond MaterialUserData's fields)
  const shaderHull = !!((hullMat.userData as { screenSpaceHull?: boolean }).screenSpaceHull || materialData(hullMat).uniforms?.uHullScale);

  const batches = new Map<PartType, Batch>();
  /** Same batches as a plain array: per-frame loops walk it without allocating Map iterators. */
  const batchList: Batch[] = [];
  const makeMesh = (type: PartType, cap: number, hull: boolean, lo = false): CharMesh => {
    const def = partDef(type);
    const mat = hull ? hullMat : def.unlit ? getMaterial(def.unlit, { instanced: true, color: WHITE, ...def.matOpts }) : litMat;
    const colors = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    const m = Object.assign(new THREE.InstancedMesh(geometryFor(type, lo), mat, cap), { instanceColor: colors });
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    fixedRange(m.instanceMatrix); fixedRange(m.instanceColor);
    m.frustumCulled = false;
    m.count = 0;
    m.name = (hull ? `hull:${type}` : `char:${type}`) + (lo ? '~lo' : '');
    const lit = !def.unlit;
    m.castShadow = !hull && lit && type !== 'eye' && CAST.has(type) && (!lo || LO_CAST.has(type));
    m.receiveShadow = !hull && lit;
    m.renderOrder = hull ? 2 : type === 'blob' ? -1 : 0;
    // The material's own layer (RND: CHARS / HULLS / OVERLAY) wins, so meshes re-created on growth are right at once.
    const layer = materialData(mat).hqLayer ?? (hull ? layers.hulls : layers.chars);
    if (layer !== undefined) m.layers.set(layer);
    group.add(m);
    return m;
  };
  const CAST = new Set(['body', 'limb', 'sphere', 'dome', 'cone', 'torus', 'cyl', 'rbox', 'band']);
  // [CHR m2 fix r3] far actors cast only from their volume types (Clawd body, Shelly's rbox head / cyl torso, hats): a
  // 1–3 px limb / ring shadow at > 14 m sits under the body's own shadow (key at 60°), and it keeps the far LOD to +3
  // shadow draws instead of +6 and cuts far shadow triangles by ~2/3 (§5.3 shadow pass ≤ 25).
  const LO_CAST = new Set(['body', 'rbox', 'cyl']);
  /** [CHR m2 fix r3] far (low-poly) batches, one per LO type; same materials, so no extra programs. */
  const loBatches = new Map<PartType, Batch>();
  const batchFor = (type: PartType): Batch => {
    let b = batches.get(type);
    if (!b) {
      b = newBatch(type, false);
      batches.set(type, b);
    }
    return b;
  };
  /** The far batch of a type (its full batch when the type has no low-poly variant). */
  const loBatchFor = (type: PartType): Batch => {
    let b = loBatches.get(type);
    if (!b) {
      b = hasLo(type) ? newBatch(type, true) : batchFor(type);
      loBatches.set(type, b);
    }
    return b;
  };
  const newBatch = (type: PartType, lo: boolean): Batch => {
    const cap = 32;
    const def = partDef(type);
    const hasHull = !def.unlit;
    const b: Batch = {
      type, lo, mesh: makeMesh(type, cap, false, lo), hull: hasHull ? makeMesh(type, cap, true, lo) : null, cap, n: 0, hn: 0,
      n0: 0, hn0: 0, ext: extentOf(type, lo), cast: !def.unlit && CAST.has(type) && (!lo || LO_CAST.has(type)), tris: trisOf(type, lo),
    };
    batchList.push(b);
    return b;
  };
  const grow = (b: Batch, need: number): void => {
    let cap = b.cap;
    while (cap < need) cap *= 2;
    if (cap === b.cap) return;
    for (const k of ['mesh', 'hull'] as const) {
      const old = b[k];
      if (!old) continue;
      const m = makeMesh(b.type, cap, k === 'hull', b.lo);
      m.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, Math.min(old.instanceMatrix.array.length, m.instanceMatrix.array.length)));
      m.instanceColor.array.set(old.instanceColor.array.subarray(0, Math.min(old.instanceColor.array.length, m.instanceColor.array.length))); // [CHR fix r3] colours of this frame's earlier instances survive a mid-frame grow
      group.remove(old); old.dispose();
      b[k] = m;
    }
    b.cap = cap;
  };
  // Pre-create the common types so programs compile at boot, not on the first emote.
  for (const t of PART_TYPES) batchFor(t);
  for (const t of LO_TYPES) loBatchFor(t);

  const entries = new Set<Entry>();
  const tmpC = new THREE.Color();
  const inkC = new THREE.Color(CORE.ink);

  const resolve = (e: Entry): PartColor[] => {
    const { rig, o } = e;
    const body = rig.species === 'shelly' ? new THREE.Color('#E6DCC6') : bodyColorFor(o.kind, rig.pers);
    const deep = o.kind === 'claude' ? new THREE.Color(CORE.clayDeep).lerp(body, 0.35) : body.clone().multiplyScalar(0.8);
    const blush = new THREE.Color('#F0907C').lerp(body, o.kind === 'claude' ? 0.2 : 0.45);
    const ws = new THREE.Color(workspaceColor(o.colorIndex ?? 0));
    const table: Record<string, THREE.Color> = {
      body, bodyDeep: deep, blush, workspace: ws, ink: new THREE.Color(CORE.ink), ink2: new THREE.Color(CORE.ink2),
      paper: new THREE.Color(CORE.paper), trim: new THREE.Color(MISC.trim), phosphor: new THREE.Color(STATUS.shell),
    };
    const hullBase = o.kind === 'codex' ? new THREE.Color(MISC.codexHull) : null;
    const cols = e.cols = rig.parts.map((p): PartColor => {
      const lit = !partDef(p.type).unlit;
      let c = table[p.colorKey] ?? new THREE.Color(p.colorKey.startsWith('#') ? p.colorKey : CORE.ink);
      if (p.colorKey === 'paper' && lit) c = table.trim; // lit "paper" obeys the albedo cap (§5.0)
      c = c.clone();
      if (p.emissive) c.multiplyScalar(p.emissive);
      const h = hullBase && (p.colorKey === 'body' || p.colorKey === 'bodyDeep') ? hullBase.clone() : mixSrgb(inkC, c, 0.2);
      return { c, h };
    });
    // node → part indices, so write() walks only the visible subtrees' parts (most prop/gear/mini parts are hidden)
    for (const p of rig.parts) delete nodeData(p.node).pi;
    rig.parts.forEach((p, i) => { (nodeData(p.node).pi ??= []).push(i); });
    e.version = rig.version;
    return cols;
  };

  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const camPos = new THREE.Vector3();
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), camFwd = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), hm = new THREE.Matrix4();
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), sx = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const gPos = new THREE.Vector3(), gScl = new THREE.Vector3();
  const keyView = new THREE.Vector3();
  let frame = 0, lastSmeared = 0;
  /** Visible part indices of the actor being written ([CHR m2 r2 alloc] typed + count, grown only on demand). */
  const visParts = { a: new Int32Array(512), n: 0 };
  const smearM = new THREE.Matrix4(), smearT = new THREE.Matrix4(), smearOut = new THREE.Matrix4();
  // tris = main-pass character triangles (parts + hulls), shadowTris = the casting parts again in the shadow map,
  // farActors = actors drawn with the far (low-poly) LOD this frame (§5.3; [CHR m2 fix r3])
  const lastStats = { draws: 0, shadowDraws: 0, instances: 0, visibleActors: 0, smeared: 0, replayed: 0, tris: 0, shadowTris: 0, farActors: 0 };

  const push = (b: Batch, matrix: THREE.Matrix4, col: THREE.Color): void => {
    if (b.n >= b.cap) grow(b, b.n + 1);
    matrix.toArray(b.mesh.instanceMatrix.array, b.n * 16);
    col.toArray(b.mesh.instanceColor.array, b.n * 3);
    b.n++;
  };
  const pushHull = (b: Batch & { hull: CharMesh }, matrix: THREE.Matrix4, col: THREE.Color): void => {
    if (b.hn >= b.cap) grow(b, b.hn + 1);
    matrix.toArray(b.hull.instanceMatrix.array, b.hn * 16);
    col.toArray(b.hull.instanceColor.array, b.hn * 3);
    b.hn++;
  };

  // ---- [CHR fix r3] LOD instance cache (§5.3): capture an actor's freshly written ranges, replay them between poses.
  const rootInv = new THREE.Matrix4(), delta = new THREE.Matrix4();
  /** Copy what this actor just wrote (the ranges since b.n0 / b.hn0 in every batch) into its cache. */
  const capture = (e: Entry, wantHull: boolean): void => {
    // [CHR m2 r2 alloc] fixed-shape cache: recs is a flat record list with its own count (nr), copies are plain
    // index loops (no per-frame subarray views, no [false, true] literal, no Map iterators).
    const c: InstanceCache = e.cache ??= { recs: [], nr: 0, mats: new Float32Array(0), cols: new Float32Array(0), root: new Float32Array(16), serial: -1, version: -1, lod: -1, outline: null, hull: false, far: false };
    let nm = 0;
    for (let bi = 0; bi < batchList.length; bi++) { const b = batchList[bi]; nm += (b.n - b.n0) + (b.hn - b.hn0); }
    if (c.mats.length < nm * 16) { c.mats = new Float32Array(nm * 16 * 1.5 | 0); c.cols = new Float32Array(nm * 3 * 1.5 | 0); }
    const recs = c.recs, M = c.mats, C = c.cols;
    let nr = 0, o = 0;
    for (let bi = 0; bi < batchList.length; bi++) {
      const b = batchList[bi];
      for (let h = 0; h < 2; h++) {
        const hull = h === 1;
        const n0 = hull ? b.hn0 : b.n0, n = (hull ? b.hn : b.n) - n0;
        if (n <= 0) continue;
        const m = hull ? b.hull : b.mesh;
        if (!m) continue; // (a hull range only exists for a batch with a hull mesh)
        const sm = m.instanceMatrix.array, sc = m.instanceColor.array;
        for (let k = 0, s = n0 * 16, t = o * 16, e16 = n * 16; k < e16; k++) M[t + k] = sm[s + k];
        for (let k = 0, s = n0 * 3, t = o * 3, e3 = n * 3; k < e3; k++) C[t + k] = sc[s + k];
        recs[nr] = b; recs[nr + 1] = hull; recs[nr + 2] = o; recs[nr + 3] = n; nr += 4;
        o += n;
      }
    }
    c.nr = nr;
    c.root.set(e.rig.root.matrixWorld.elements);
    c.serial = e.rig.poseSerial; c.version = e.rig.version; c.lod = e.lod; c.outline = e.outline; c.hull = wantHull; c.far = e.far;
  };
  /** Write the cached instances, moved by root(now) · root(capture)⁻¹. False = the cache does not fit, re-pose. */
  const replay = (e: Entry, c: InstanceCache): boolean => {
    const root = e.rig.root;
    root.updateMatrix(); root.matrixWorld.copy(root.matrix); // keep the root fresh for aim / fx readers
    const re = root.matrixWorld.elements, ce = c.root;
    let moved = false;
    for (let k = 0; k < 16; k++) if (re[k] !== ce[k]) { moved = true; break; }
    let d: number[] | null = null;
    if (moved) { rootInv.fromArray(ce).invert(); d = delta.multiplyMatrices(root.matrixWorld, rootInv).elements; }
    let hullCol: THREE.Color | null = null;
    if (e.outline?.pulse) {
      const k = 0.5 + 0.5 * Math.sin(W.now * TAU * e.outline.pulse);
      hullCol = e.outline.cur.copy(inkC).lerp(e.outline.color, 0.35 + 0.65 * k);
    }
    const recs = c.recs, M = c.mats, C = c.cols;
    for (let r = 0; r < c.nr; r += 4) {
      // (the flat record list is heterogeneous by design; see InstanceCache)
      const b = recs[r] as Batch, hull = recs[r + 1] as boolean, o = recs[r + 2] as number, n = recs[r + 3] as number;
      const at = hull ? b.hn : b.n;
      if (at + n > b.cap) grow(b, at + n);
      const m = hull ? b.hull : b.mesh;
      if (!m) continue;
      const dst = m.instanceMatrix.array, dc = m.instanceColor.array;
      if (!d) for (let k = 0, s = o * 16, t = at * 16, e16 = n * 16; k < e16; k++) dst[t + k] = M[s + k];
      else {
        // dst = d · src for affine 4×4 (column-major; row 3 of both is 0 0 0 1)
        for (let i = 0; i < n; i++) {
          const s = (o + i) * 16, t = (at + i) * 16;
          for (let col = 0; col < 4; col++) {
            const x = M[s + col * 4], y = M[s + col * 4 + 1], z = M[s + col * 4 + 2], w = M[s + col * 4 + 3];
            dst[t + col * 4] = d[0] * x + d[4] * y + d[8] * z + d[12] * w;
            dst[t + col * 4 + 1] = d[1] * x + d[5] * y + d[9] * z + d[13] * w;
            dst[t + col * 4 + 2] = d[2] * x + d[6] * y + d[10] * z + d[14] * w;
            dst[t + col * 4 + 3] = w;
          }
        }
      }
      if (hull && hullCol) for (let i = 0; i < n; i++) hullCol.toArray(dc, (at + i) * 3);
      else for (let k = 0, s = o * 3, t = at * 3, e3 = n * 3; k < e3; k++) dc[t + k] = C[s + k];
      if (hull) b.hn += n; else b.n += n;
    }
    replayed++;
    return true;
  };
  let replayed = 0;

  /** Per-frame scalars shared by write() and its helpers (fixed double fields; nothing is passed as a double arg). */
  const W = { now: 0, vh: 900, tanHalf: 0.577, hullMax: 18, d: 3, mpp: 0.001, hullW: 0, smeared: 0, ortho: false, topDown: false, farActors: 0 };
  const entryList: Entry[] = [];
  let entriesDirty = true;

  /**
   * Screen-space glint (§6.1): offset toward the key light as seen on screen, clamped inside the eye. Null = faded out.
   * [CHR fix r3] The glint is a flat disc lying in the eye's plane (it foreshortens with the slot instead of floating as
   * a round dot), its radius + offset are clamped to the slot's extent, and it shrinks away as the eye's N·V drops
   * toward 0 (seen from the side it would sit on bare clay).
   */
  function glintMatrix(p: RigPart, glintOf: THREE.Object3D): THREE.Matrix4 | null {
    const eye = glintOf.matrixWorld;
    eye.decompose(gPos, q, gScl);
    v.setFromMatrixColumn(eye, 2).normalize(); v2.subVectors(camPos, gPos).normalize();
    const ndv = v.x * v2.x + v.y * v2.y + v.z * v2.z;
    const fk = Math.min(1, Math.max(0, (ndv - 0.3) / 0.35)), fade = fk * fk * (3 - 2 * fk); // = MathUtils.smoothstep(ndv, 0.3, 0.65)
    if (fade <= 0) return null;
    const rX = v.setFromMatrixColumn(eye, 0); const lenX = rX.length();
    const uY = v2.setFromMatrixColumn(eye, 1); const lenY = uY.length();
    // (dot products spelled out: Vector3.dot returns a boxed double when it is not inlined)
    const rx = (rX.x * camRight.x + rX.y * camRight.y + rX.z * camRight.z) / lenX, ry = (rX.x * camUp.x + rX.y * camUp.y + rX.z * camUp.z) / lenX;
    const ux = (uY.x * camRight.x + uY.y * camRight.y + uY.z * camRight.z) / lenY, uy = (uY.x * camUp.x + uY.y * camUp.y + uY.z * camUp.z) / lenY;
    let lx = keyView.x, ly = keyView.y;
    const ll = Math.sqrt(lx * lx + ly * ly) || 1; lx /= ll; ly /= ll;
    const det = rx * uy - ux * ry || 1;
    let a = (lx * uy - ly * ux) / det, bb = (rx * ly - ry * lx) / det;
    const gRy = nodeData(p.node).glintRy ?? 0.05;
    // Radius in eye-local units: ≥ 2.5 px, never wider than half the slot, shrunk by the N·V fade.
    const rL = Math.min(Math.max(0.018, 2.5 * W.mpp) / lenX, 0.022) * (nodeData(p.node).glintScale ?? 1) * fade;
    if (rL <= 0) return null;
    // Centre on the slot ellipse toward the light, pulled in so the whole disc stays inside the ink
    // (slot half-extents ≈ 0.045 × 1.46·gRy in eye-local units).
    const ex = Math.max(0, Math.min(0.024 * 0.82, 0.042 - rL)), ey = Math.max(0, Math.min(gRy * 0.82, gRy * 1.42 - rL));
    const n = Math.sqrt((a / 0.024) ** 2 + (bb / gRy) ** 2) || 1;
    a = (a / n) * (ex / 0.024); bb = (bb / n) * (ey / gRy);
    v.set(a, bb + (nodeData(p.node).glintCy ?? 0), 0.017).applyMatrix4(eye);
    m4.compose(v, q, sx.set(rL * lenX, rL * lenY, rL * lenX * 0.35));
    return m4;
  }

  /** Stop-motion smear (§6.3) of a fast part, from last frame's position; records this frame's position. */
  function smearMatrix(mat: THREE.Matrix4, i: number, prev: Float32Array, stamp: Int32Array, smear: boolean): THREE.Matrix4 {
    const me = mat.elements, j = i * 3;
    const fresh = stamp[i] === frame - 1;
    stamp[i] = frame;
    if (smear && fresh) {
      const dx = me[12] - prev[j], dy = me[13] - prev[j + 1], dz = me[14] - prev[j + 2];
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz), px = dl / W.mpp;
      if (px > SMEAR_PX && dl < 1) {
        const k = Math.min(1, (px - SMEAR_PX) / 24);
        const al = 1 + 0.6 * k, th = 1 - 0.2 * k;
        const ux = dx / dl, uy = dy / dl, uz = dz / dl;
        // A = th·I + (al − th)·u uᵀ about the part's origin, pulled back along the motion (a trail).
        smearM.set(
          th + (al - th) * ux * ux, (al - th) * ux * uy, (al - th) * ux * uz, 0,
          (al - th) * uy * ux, th + (al - th) * uy * uy, (al - th) * uy * uz, 0,
          (al - th) * uz * ux, (al - th) * uz * uy, th + (al - th) * uz * uz, 0,
          0, 0, 0, 1);
        smearT.makeTranslation(me[12] - dx * 0.35 * k, me[13] - dy * 0.35 * k, me[14] - dz * 0.35 * k).multiply(smearM);
        smearM.makeTranslation(-me[12], -me[13], -me[14]).premultiply(smearT);
        smearOut.multiplyMatrices(smearM, mat);
        prev[j] = me[12]; prev[j + 1] = me[13]; prev[j + 2] = me[14];
        W.smeared++;
        return smearOut;
      } else { prev[j] = me[12]; prev[j + 1] = me[13]; prev[j + 2] = me[14]; }
    } else { prev[j] = me[12]; prev[j + 1] = me[13]; prev[j + 2] = me[14]; }
    return mat;
  }

  /** hm = the hull matrix of a part (JS widening when the hull material does not extrude in its shader). */
  function hullMatrix(b: Batch, mat: THREE.Matrix4): void {
    if (shaderHull) { hm.copy(mat); return; }
    // Widen per axis by 2·w / size so the shell is ~w thick all round.
    const ex = b.ext;
    const ax = v.setFromMatrixColumn(mat, 0).length() * ex.x, ay = v.setFromMatrixColumn(mat, 1).length() * ex.y, az = v.setFromMatrixColumn(mat, 2).length() * ex.z;
    const fx = 1 + (2 * W.hullW) / Math.max(ax, 1e-3), fy = 1 + (2 * W.hullW) / Math.max(ay, 1e-3), fz = 1 + (2 * W.hullW) / Math.max(az, 1e-3);
    // Scale about the geometry's bbox centre (limbs/domes are not centred on their origin).
    const bc = b.mesh.geometry.boundingBox as THREE.Box3; // computed by geometryFor
    const cx = (bc.min.x + bc.max.x) / 2, cy = (bc.min.y + bc.max.y) / 2, cz = (bc.min.z + bc.max.z) / 2;
    hm.makeTranslation(cx, cy, cz).multiply(m4.makeScale(fx, fy, fz)).multiply(m4.makeTranslation(-cx, -cy, -cz));
    hm.premultiply(mat);
  }

  /** = frustum.intersectsSphere(sph), spelled out: Plane.distanceToPoint → Vector3.dot boxed a double per plane. */
  function inFrustum(sph: THREE.Sphere): boolean {
    const c = sph.center, r = sph.radius, pl = frustum.planes;
    for (let i = 0; i < 6; i++) {
      const n = pl[i].normal;
      if (n.x * c.x + n.y * c.y + n.z * c.z + pl[i].constant < -r) return false;
    }
    return true;
  }

  /** Pose-or-replay one visible actor into the batches. */
  function writeActor(e: Entry): void {
    const rig = e.rig, root = rig.root, cam = camera;
    const cols = e.version !== rig.version || !e.cols ? resolve(e) : e.cols;
    // [CHR fix r3] §5.3 LOD row (≥ 10 m: 20 Hz): the animator re-poses lod ≥ 1 rigs on a staggered 20 Hz cadence
    // (`rig.poseSerial`); between poses replay the actor's cached instance data, carried by the root's motion
    // since the capture so walkers still glide every frame. Skips updateVisible + the per-part loop entirely.
    let d = 3;
    if (cam) { const dx = camPos.x - sphere.center.x, dy = camPos.y - sphere.center.y, dz = camPos.z - sphere.center.z; d = Math.sqrt(dx * dx + dy * dy + dz * dz); }
    W.d = d;
    const wantHull = e.lod < 2 && d < W.hullMax;
    // [CHR m2 fix r3] far LOD: view distance with hysteresis, or a top-down / orthographic view from well above
    const far = e.far = !portrait && FAR_LOD.on && (W.ortho || d > (e.far ? FAR_LOD.out : FAR_LOD.in) || (W.topDown && camPos.y - root.position.y > TOPDOWN_H));
    if (far) W.farActors++;
    const c = e.cache;
    if (e.lod >= 1 && c && rig.poseSerial !== undefined && c.serial === rig.poseSerial && c.version === rig.version
      && c.lod === e.lod && c.outline === e.outline && c.hull === wantHull && c.far === far && replay(e, c)) return;
    if (e.lod >= 1) for (let bi = 0; bi < batchList.length; bi++) { const b = batchList[bi]; b.n0 = b.n; b.hn0 = b.hn; }
    visParts.n = 0;
    updateVisible(root, null, frame, visParts); // matrices + visible parts of visible subtrees (hidden props/gear/minis cost 0)
    const mpp = (2 * d * W.tanHalf) / W.vh; // metres per pixel at the actor
    W.mpp = mpp;
    const micro = portrait || (e.lod < 1 && d < 14);
    let hullW = Math.min(3.2, Math.max(1.2, 3.2 + (1.2 - 3.2) * ((d - 1.5) / 16.5))) * (e.outline?.width ?? 1) * mpp; // = hullPx(d)
    let hullCol: THREE.Color | null = null;
    if (e.outline) {
      hullCol = e.outline.color;
      if (e.outline.pulse) {
        // Blocked (§6.7): thick, pulsing red-brown ↔ ink.
        const k = 0.5 + 0.5 * Math.sin(W.now * TAU * e.outline.pulse);
        hullW *= 0.75 + 0.5 * k;
        hullCol = e.outline.cur.copy(inkC).lerp(e.outline.color, 0.35 + 0.65 * k);
      }
    }
    // Stop-motion smears (§6.3): only while the animator flags a fast action; per part, from last frame's position.
    W.hullW = hullW;
    const smear = rig.smear > 0 && !!cam && !portrait;
    if (e.prev.length !== rig.parts.length * 3) { e.prev = new Float32Array(rig.parts.length * 3); e.stamp = new Int32Array(rig.parts.length); }
    const prev = e.prev, stamp = e.stamp;
    const parts = rig.parts;
    const vpa = visParts.a, vpn = visParts.n;
    for (let vi = 0; vi < vpn; vi++) {
      const i = vpa[vi];
      const p = parts[i];
      if (!micro && (p.type === 'glint' || (p.group === 'face' && p.type === 'limb'))) continue;
      let b = far ? loBatchFor(p.type) : batchFor(p.type);
      if (far || (!portrait && hasLo(p.type))) {
        // [CHR fix m3-r1] screen-size LOD: the part's largest world extent (unit extent × its matrix's column scale)
        // against px limits, spelled out inline (a helper returning a double boxes a HeapNumber per call). Far: parts
        // under FAR_MICRO_PX are skipped. Near: parts under SMALL_LO_PX (buttons, knobs, props, noodle segments at a few
        // metres) draw their low-poly variant, which is pixel-identical at that size.
        const me = p.node.matrixWorld.elements, ex = b.ext;
        const s2 = Math.max((me[0] * me[0] + me[1] * me[1] + me[2] * me[2]) * ex.x * ex.x,
          (me[4] * me[4] + me[5] * me[5] + me[6] * me[6]) * ex.y * ex.y, (me[8] * me[8] + me[9] * me[9] + me[10] * me[10]) * ex.z * ex.z);
        if (far) { if (s2 < FAR_MICRO_PX * FAR_MICRO_PX * mpp * mpp) continue; }
        else if (s2 < SMALL_LO_PX * SMALL_LO_PX * mpp * mpp) b = loBatchFor(p.type);
      }
      const col = cols[i];
      let mat: THREE.Matrix4 | null = p.node.matrixWorld;
      if (p.glintOf && cam) {
        mat = glintMatrix(p, p.glintOf);
        if (!mat) continue;
      }
      if (SMEAR.has(p.type)) mat = smearMatrix(mat, i, prev, stamp, smear);
      if (p.tint) { tmpC.copy(p.tint); if (p.emissive) tmpC.multiplyScalar(p.emissive); push(b, mat, tmpC); }
      else push(b, mat, col.c);
      if (p.hull && wantHull && b.hull && !(far && FAR_NO_HULL.has(p.type))) {
        hullMatrix(b, mat);
        pushHull(b as Batch & { hull: CharMesh }, hm, hullCol ?? col.h);
      }
    }
    if (e.lod >= 1) capture(e, wantHull);
    else e.cache = null;
  }

  if (!portrait) hqStatSection('chars', () => lastStats);
  return {
    group,
    register(rig, o) {
      if (rig.species !== 'shelly' && (!rig.accessory || rig.accessory.index !== (o.colorIndex ?? 0) % 8 || rig.accessory.cycle !== (o.cycle ?? 0))) {
        rig.setAccessory(((o.colorIndex ?? 0) % 8 + 8) % 8, o.cycle ?? 0);
      }
      const e: Entry = { rig, o: { ...o }, cols: null, version: -1, visible: true, lod: 0, outline: null, prev: new Float32Array(0), stamp: new Int32Array(0), far: false };
      entries.add(e); entriesDirty = true;
      return {
        setVisible(val) { e.visible = !!val; },
        setLod(level) { e.lod = level | 0; },
        setOutline(ol) {
          e.outline = ol ? {
            color: new THREE.Color(ol.color), width: ol.width ?? 1, cur: new THREE.Color(ol.color),
            pulse: ol.pulse ?? (String(ol.color).toUpperCase() === MISC.blockedOutline.toUpperCase() ? 1.1 : 0),
          } : null;
        },
        remove() { entries.delete(e); entriesDirty = true; },
      };
    },
    write() {
      frame++;
      W.now = performance.now() / 1000;
      W.smeared = 0; W.farActors = 0;
      replayed = 0;
      for (let bi = 0; bi < batchList.length; bi++) { const b = batchList[bi]; b.n = 0; b.hn = 0; }
      const cam = camera;
      W.vh = viewportHeight?.() ?? (globalThis.innerHeight || 900);
      W.tanHalf = 0.577;
      W.ortho = false; W.topDown = false;
      if (cam) {
        cam.updateMatrixWorld();
        projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projScreen);
        camPos.setFromMatrixPosition(cam.matrixWorld);
        cam.matrixWorld.extractBasis(camRight, camUp, camFwd);
        camFwd.negate();
        // (duck-typed like three's own flags: `cam` is any THREE.Camera)
        const ortho = cam as Partial<THREE.OrthographicCamera>, persp = cam as Partial<THREE.PerspectiveCamera>;
        W.ortho = !!ortho.isOrthographicCamera;
        W.topDown = camFwd.y < TOPDOWN_FWD_Y;
        if (persp.isPerspectiveCamera) W.tanHalf = Math.tan(THREE.MathUtils.degToRad(persp.fov as number) / 2);
        keyView.copy(keyDir).transformDirection(cam.matrixWorldInverse);
        if (!portrait) setViewer(camPos, camFwd); // [CHR M3.5] animators turn toward the player (anim/viewer.ts); [CHR fix m3-r3] + heading
      }
      W.hullMax = portrait ? Infinity : HULL_TIER_DIST[quality?.tier ?? 'medium'] ?? 18;
      let visibleActors = 0;
      // [CHR m2 r2 alloc] entries are walked as an array (no Set iterator per frame); the per-actor work lives in
      // writeActor / glintMatrix / smearMatrix / hullMatrix, small enough for TurboFan to inline the three.js math they
      // call (a single huge write() ran out of inlining budget and boxed every double it passed to a call).
      if (entriesDirty) { entryList.length = 0; for (const e of entries) entryList.push(e); entriesDirty = false; }
      for (let ei = 0; ei < entryList.length; ei++) {
        const e = entryList[ei];
        if (!e.visible || e.lod >= 3) continue;
        const root = e.rig.root;
        if (cam) {
          sphere.center.set(root.position.x, root.position.y + 0.45, root.position.z);
          sphere.radius = 0.6 + 1.5; // + shadow reach toward the key (§6.2)
          if (!inFrustum(sphere)) continue;
        }
        visibleActors++;
        writeActor(e);
      }
      const smeared = W.smeared;
      let draws = 0, shadowDraws = 0, instances = 0, tris = 0, shadowTris = 0;
      lastSmeared = smeared;
      for (let bi = 0; bi < batchList.length; bi++) {
        const b = batchList[bi];
        const m = b.mesh;
        m.count = b.n; m.visible = b.n > 0;
        m.castShadow = b.cast; // re-asserted: a layer sweep may flag every toonChar mesh as a caster (§6.2 budget)
        if (b.n) {
          setRange(m.instanceMatrix, b.n * 16); setRange(m.instanceColor, b.n * 3);
          draws++; instances += b.n; tris += b.n * b.tris;
          if (m.castShadow) { shadowDraws++; shadowTris += b.n * b.tris; }
        }
        if (b.hull) {
          const h = b.hull;
          h.count = b.hn; h.visible = b.hn > 0;
          if (b.hn) {
            setRange(h.instanceMatrix, b.hn * 16); setRange(h.instanceColor, b.hn * 3);
            draws++; tris += b.hn * b.tris;
          }
        }
      }
      lastStats.draws = draws; lastStats.shadowDraws = shadowDraws; lastStats.instances = instances;
      lastStats.visibleActors = visibleActors; lastStats.smeared = lastSmeared; lastStats.replayed = replayed;
      lastStats.tris = tris; lastStats.shadowTris = shadowTris; lastStats.farActors = W.farActors;
    },
    count: () => entries.size,
    stats: () => ({ ...lastStats }), // a snapshot (lastStats itself is reused every frame)
    dispose() {
      for (const b of batchList) { group.remove(b.mesh); b.mesh.dispose(); if (b.hull) { group.remove(b.hull); b.hull.dispose(); } }
      batches.clear(); loBatches.clear(); batchList.length = 0; entries.clear(); entryList.length = 0;
      scene.remove(group);
    },
  };
}
