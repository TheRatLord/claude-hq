/**
 * Greybox builder (§7): the M1 proto room and, from M1.5, the full office (`buildHq`, `?greybox` = flat colours +
 * density overlay). Builds the room from the layout with the
 * toy proportions and flat §5.5 value-map colours, everything through `getMaterial`:
 * - architecture (floor, walls with wainscot pattern + top cap + baseboards, ceiling, window frames, glass, sky)
 *   merged per material → a handful of draws, never casts;
 * - furniture as one InstancedMesh per part shape (instanceColor carries the colour + ±4% jitter), bevelled with
 *   RoundedBoxGeometry; chairs / desks / sofa / plants / big props are shadow CASTERS (§5.2);
 * - lamps (bulbs are the only emissive, 1.8), monitors (unlit screens ≤ 0.95 with scrolling code), a wall clock
 *   with real hands, posters, sticky notes, plants that sway.
 * ENV replaces this with the prop kit (§7.5) in M1.75; the return shape is `buildWorld`'s (§5.4).
 * Owner: LVL (greybox.ts), built by RND for M1.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial, applyDepthMaterial, PATTERN } from '../../render/materials/index.ts';
import type { MaterialKind, MaterialOpts } from '../../render/materials/index.ts';
import { markCaster } from '../../render/layers.ts';
import { registerDeskScreens } from '../../render/deskScreens.ts'; // [RND fix r1] monitors show the owner's status
import { CORE, ENV, MISC, STATUS, WORKSPACE } from '../../../../shared/palette.ts';
import { PROTO_COLORS, DESK, deskLocal } from '../layout/proto.ts';
import { emptyPatches } from '../layout/density.ts';
import { cellAt } from '../layout/vis.ts';
import { createNav } from '../nav/index.ts';
import { isHqLayout } from '../layout/schema.ts';
import type { Layout, HqLayout, Furniture, Bay, Wall, WallOpening, Rect, Circle } from '../layout/schema.ts';
import type { Ctx } from '../../core/ctx.ts';
import type { BayInfo } from '../../chars/brain/directorHq.ts';

interface Vec { x: number; y: number; z: number }
type Span = [number, number];
type CellOf = (x: number, y: number, z: number) => string | null;
/** The ctx fields the greybox reads / writes (the real `Ctx` satisfies it; tests pass a scene only). */
export type GreyCtx = Pick<Ctx, 'scene'> & Partial<Pick<Ctx, 'camera' | 'params' | 'envSkip' | 'director' | 'visibleCells'>>;
/** What `update(c)` may be handed. */
export type WorldUpdateCtx = Partial<Pick<Ctx, 'director' | 'camera' | 'time' | 'dt'>>;
/** A named world anchor (§5.4); the kit world adds `size` / `cell` for the hire crate. */
export interface WorldAnchor { pos: THREE.Vector3; yaw: number; size?: readonly number[]; cell?: string }
/** The §5.4 world build result (greybox and kit worlds share it). */
export interface WorldBuild {
  cells: Map<string, THREE.Object3D | undefined>;
  anchors: Record<string, WorldAnchor>;
  root: THREE.Group;
  stats: () => Record<string, unknown>;
  update: (c?: WorldUpdateCtx) => void;
  dispose: () => void;
}
/** A desk monitor a prop reports (world pose of the glass). */
interface GreyScreen { p: Vec; yaw: number; n: number; anchor: string }
/** Mutable state the furniture builders share. */
interface ProtoState { root: THREE.Group; dynamic: THREE.Object3D[]; screens: GreyScreen[]; deskN: number; C?: typeof PROTO_COLORS; bushGeos?: THREE.BufferGeometry[] }
/** `kit.def` options: draw kind, shadow caster flag, small-prop draw distance, plus material options. */
type KitDef = MaterialOpts & { kind?: MaterialKind; caster?: boolean; far?: number | null };
/** `kit.add` options: euler tilts, non-uniform scale, colour jitter. */
interface KitAdd { rx?: number; rz?: number; s?: readonly [number, number, number]; j?: number }
interface KitItem { m: THREE.Matrix4; c: THREE.Color; cell: string | null; x: number; z: number }
interface KitPart { geo: THREE.BufferGeometry; kind: MaterialKind; opts: MaterialOpts; caster: boolean; far: number | null; items: KitItem[]; mesh?: THREE.InstancedMesh; shown?: number }
interface Kit {
  def: (name: string, geo: THREE.BufferGeometry, o?: KitDef) => void;
  add: (name: string, p: Vec | [number, number, number], yaw: number, color: string, o?: KitAdd) => void;
  build: () => number;
  cull: (visible: ReadonlySet<string> | null, cam: { x: number; z: number } | null) => { shown: number; total: number };
  meshOf: (name: string) => THREE.InstancedMesh | undefined;
}
const isPattern = (p: string): p is keyof typeof PATTERN => p in PATTERN;
const ctx2d = (cv: HTMLCanvasElement): CanvasRenderingContext2D => {
  const g = cv.getContext('2d');
  if (!g) throw new Error('greybox: 2d canvas unavailable');
  return g;
};
/** Merge (non-indexed) geometries into one; the inputs must be non-empty and attribute-compatible. */
const mergeAll = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const g = mergeGeometries(geos.map((q) => (q.index ? q.toNonIndexed() : q)), false);
  if (!g) throw new Error('greybox: geometry merge failed');
  return g;
};

const C = PROTO_COLORS;
/**
 * Bevelled box. [LVL fix r1] Triangle diet (§5.3 ≤ 500k visible): a 2-segment bevel is 300 triangles, invisible on
 * parts a few cm across. Parts under ~15 cm (or thinner than 2.5 cm, or with a ~1 cm bevel: wall skins) are plain boxes
 * (12 tris); parts under 10 cm, or
 * with a bevel under 4 cm (wall skins, frames, caps, desk parts), get a 1-segment chamfer (108 tris).
 */
const rbox = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.18, seg = 2): THREE.BufferGeometry => {
  const mn = Math.min(w, h, d), mx = Math.max(w, h, d);
  const rr = Math.min(r, mn / 2 - 1e-4);
  if (mx < 0.15 || mn < 0.025 || rr < 0.012) return new THREE.BoxGeometry(w, h, d); // (1 cm wall-skin bevels too)
  return new RoundedBoxGeometry(w, h, d, mn < 0.1 || rr < 0.04 ? 1 : seg, rr);
};
const cyl = (rt: number, rb: number, h: number, seg = 20): THREE.CylinderGeometry => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();
const jitter = (hex: string, amt: number, seed: number): THREE.Color => {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
  const r = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; const f = (r - Math.floor(r)) * 2 - 1;
  return c.setHSL(hsl.h, hsl.s, Math.min(0.95, Math.max(0, hsl.l * (1 + f * amt))));
};

/**
 * Collects instances per part, then builds one InstancedMesh each.
 * [LVL fix r1] Culling (§5.3): every instance carries its vis cell (`cellOf(x, y, z)`, hq) and a part may carry a draw
 * distance (`far`, m: small story props). `cull(visible, cam)` compacts each part's instance buffer to the instances in
 * visible cells (and within `far` of the camera), sets `count` and re-fits the bounding sphere, so three's frustum test
 * then skips whole parts that are out of view. Called only when the camera's cell changes or it has moved > 1.5 m
 * (a few thousand matrix copies), never per frame.
 */
function createKit(root: THREE.Group, cellOf: CellOf = () => null, skip: ReadonlySet<string> | null = null): Kit {
  const parts = new Map<string, KitPart>();
  let seed = 1;
  const def = (name: string, geo: THREE.BufferGeometry, { kind = 'toonProp', caster = false, far = null, ...opts }: KitDef = {}): void => { parts.set(name, { geo, kind, opts, caster, far, items: [] }); };
  /** `p` = position, `color` = hex. */
  const add = (name: string, p: Vec | [number, number, number], yaw: number, color: string, o: KitAdd = {}): void => {
    const part = parts.get(name);
    if (!part) throw new Error(`kit part ${name}`);
    const [x, y, z] = Array.isArray(p) ? p : [p.x, p.y, p.z];
    const cell = cellOf(x, y, z);
    if (skip && cell !== null && skip.has(cell)) return; // [ENV M1.75, cross-owner] cell dressed by the prop kit (build/index.ts)
    tmpE.set(o.rx ?? 0, yaw, o.rz ?? 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpS.set(...(o.s ?? [1, 1, 1]));
    part.items.push({ m: new THREE.Matrix4().compose(tmpP.set(x, y, z), tmpQ, tmpS), c: jitter(color, o.j ?? 0.04, seed++), cell, x, z });
  };
  const build = (): number => {
    let draws = 0;
    for (const [name, part] of parts) {
      if (!part.items.length) continue;
      const mesh = new THREE.InstancedMesh(part.geo, getMaterial(part.kind, { instanced: true, color: '#FFFFFF', ...part.opts }), part.items.length);
      part.items.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.c); });
      mesh.name = `kit:${name}`;
      mesh.computeBoundingSphere();
      if (part.caster) { markCaster(mesh); applyDepthMaterial(mesh); }
      mesh.receiveShadow = true;
      root.add(mesh);
      part.mesh = mesh; part.shown = part.items.length;
      draws++;
    }
    return draws;
  };
  /** `visible` = cells (null = all). */
  const cull = (visible: ReadonlySet<string> | null, cam: { x: number; z: number } | null): { shown: number; total: number } => {
    let shown = 0, total = 0;
    for (const part of parts.values()) {
      const mesh = part.mesh;
      if (!mesh || mesh.name === 'kit:hand') continue;
      const far2 = part.far && cam ? part.far * part.far : Infinity;
      const farCam = far2 !== Infinity ? cam : null;
      let n = 0;
      for (const it of part.items) {
        if (visible && it.cell && !visible.has(it.cell)) continue;
        if (farCam && (it.x - farCam.x) ** 2 + (it.z - farCam.z) ** 2 > far2) continue;
        mesh.setMatrixAt(n, it.m); mesh.setColorAt(n, it.c); n++;
      }
      total += part.items.length; shown += n;
      if (n === part.shown && n === part.items.length) continue;
      part.shown = n;
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (n) mesh.computeBoundingSphere();
    }
    return { shown, total };
  };
  const meshOf = (name: string): THREE.InstancedMesh | undefined => parts.get(name)?.mesh;
  return { def, add, build, cull, meshOf };
}

/** Local → world helper for a piece of furniture. */
const place = (f: { yaw: number; pos: Vec }) => {
  const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw);
  // three rotation.y: local (lx, lz) → world (lx·cos + lz·sin, −lx·sin + lz·cos)
  return (lx: number, ly: number, lz: number): Vec => ({ x: f.pos.x + lx * cs + lz * sn, y: f.pos.y + ly, z: f.pos.z - lx * sn + lz * cs });
};

/** Canvas text texture for signs (system font stack, ART §3.4). */
function signTexture(text: string, { w = 512, h = 128, bg = CORE.ink2, fg = MISC.trim, accent = STATUS.blocked }: { w?: number; h?: number; bg?: string; fg?: string; accent?: string } = {}): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = ctx2d(cv);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = accent; g.beginPath(); g.arc(h * 0.5, h * 0.5, h * 0.22, 0, Math.PI * 2); g.fill();
  g.fillStyle = fg;
  g.font = `800 ${Math.round(h * 0.46)}px ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Ubuntu", "Cantarell", "DejaVu Sans", system-ui, sans-serif`;
  g.textBaseline = 'middle';
  g.fillText(text, h * 0.95, h * 0.54);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildGreybox(layout: Layout, ctx: GreyCtx): WorldBuild {
  if (layout.id !== 'proto' && isHqLayout(layout)) return buildHq(layout, ctx);
  const root = new THREE.Group();
  root.name = `world:${layout.id}`;
  const b = layout.bounds;
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ, H = layout.height;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const dynamic: THREE.Object3D[] = [];

  // ---------------------------------------------------------------- architecture (merged per material)
  const arch = new Map<string, THREE.BufferGeometry[]>(); // material key → geometries
  const addArch = (key: string, geo: THREE.BufferGeometry): void => { const list = arch.get(key) ?? []; arch.set(key, list); list.push(geo); };
  const archMat: Record<string, THREE.Material> = {
    floor: getMaterial('toonEnv', { color: C.floor, pattern: 'felt' }),
    wall: getMaterial('toonEnv', { color: C.wall, pattern: 'wainscot' }),
    cap: getMaterial('toonEnv', { color: C.trim }),
    ceiling: getMaterial('toonEnv', { color: C.ceiling, pattern: 'plaster' }),
    base: getMaterial('toonEnv', { color: ENV.walnut, pattern: 'wood' }),
    frame: getMaterial('toonEnv', { color: ENV.oak, pattern: 'wood' }),
    beam: getMaterial('toonEnv', { color: '#B7A994' }),
  };
  addArch('floor', new THREE.PlaneGeometry(W, D, 1, 1).rotateX(-Math.PI / 2).translate(cx, 0, cz));
  addArch('ceiling', new THREE.PlaneGeometry(W, D, 1, 1).rotateX(Math.PI / 2).translate(cx, H, cz));
  // ceiling beams across x (soft toy rhythm)
  for (let z = b.minZ + 1.5; z < b.maxZ - 0.5; z += 3) addArch('beam', rbox(W - 0.1, 0.16, 0.22, 0.04).translate(cx, H - 0.08, z));

  const T = 0.22;
  const box = (key: string, len: number, h: number, px: number, py: number, pz: number, yaw: number, depth = T, r = 0.03): void => {
    const g = rbox(len, h, depth, r).rotateY(yaw).translate(px, py, pz);
    addArch(key, g);
  };
  const windows: { op: WallOpening; ox: number; oz: number; nx: number; nz: number; yaw: number; ux: number; uz: number }[] = [];
  for (const wall of layout.walls) {
    const [ax, az] = wall.a, [bx, bz] = wall.b;
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const nx = -uz, nz = ux; // inward
    const yaw = Math.atan2(-uz, ux);
    const at = (s: number, off = 0): [number, number] => [ax + ux * s + nx * off, az + uz * s + nz * off];
    const ops = [...(wall.openings || [])].sort((p, q) => p.at - q.at);
    let s0 = -T / 2;
    const seg = (s1: number, s2: number, y0: number, y1: number): void => { if (s2 - s1 < 0.01) return; const [x, z] = at((s1 + s2) / 2, -T / 2 + 0.001); box('wall', s2 - s1, y1 - y0, x, (y0 + y1) / 2, z, yaw); };
    for (const op of ops) {
      seg(s0, op.at, 0, wall.h);
      const top = op.sill + op.h;
      if (op.sill > 0) seg(op.at, op.at + op.w, 0, op.sill);
      if (top < wall.h) seg(op.at, op.at + op.w, top, wall.h);
      const [ox, oz] = at(op.at + op.w / 2);
      if (op.kind === 'window') windows.push({ op, ox, oz, nx, nz, yaw, ux, uz });
      if (op.kind === 'door') {
        // frame + a closed door leaf with a porthole (the corridor beyond arrives with hq.ts)
        const [fx, fz] = at(op.at + op.w / 2, -0.02);
        box('frame', op.w + 0.16, 0.1, fx, top + 0.05, fz, yaw, T + 0.06);
        for (const e of [-1, 1]) { const [px, pz] = at(op.at + op.w / 2 + e * (op.w / 2 + 0.04), -0.02); box('frame', 0.08, top, px, top / 2, pz, yaw, T + 0.06); }
        const [dx, dz] = at(op.at + op.w / 2, -0.06);
        box('door', op.w - 0.04, top - 0.02, dx, top / 2, dz, yaw, 0.06, 0.02);
      }
      s0 = op.at + op.w;
    }
    seg(s0, len + T / 2, 0, wall.h);
    // top cap (diorama cut) + baseboard along the inner face
    const [mx, mz] = at(len / 2, -T / 2);
    box('cap', len + T, 0.04, mx, wall.h + 0.02, mz, yaw, T + 0.02, 0.01);
    let bs = -T / 2;
    for (const op of [...ops.filter((o) => o.kind === 'door'), { at: len + T / 2, w: 0 }]) {
      if (op.at - bs > 0.05) { const [bx2, bz2] = at((bs + op.at) / 2, 0.012); box('base', op.at - bs, 0.1, bx2, 0.05, bz2, yaw, 0.03, 0.01); }
      bs = op.at + op.w;
    }
  }
  archMat.door = getMaterial('toonEnv', { color: ENV.tealDeep });

  // windows: frame, mullions matching the gobo (3 panes, 1 transom), sill, glass, sky card
  const glassMat = getMaterial('glass', { color: '#DDEBF2', reflect: 'exterior' });
  const skyMat = getMaterial('sky');
  for (const w of windows) {
    const { op, ox, oz, nx, nz, yaw } = w;
    const cy = op.sill + op.h / 2;
    const fr = (len: number, h: number, u: number, v: number, depth = 0.1): void => { const g = rbox(len, h, depth, 0.02).rotateY(yaw); g.translate(ox + w.ux * u - nx * 0.11, cy + v, oz + w.uz * u - nz * 0.11); addArch('frame', g); };
    fr(op.w + 0.12, 0.08, 0, op.h / 2 + 0.02); fr(op.w + 0.12, 0.08, 0, -op.h / 2 - 0.02);
    fr(0.08, op.h, -op.w / 2 - 0.02, 0); fr(0.08, op.h, op.w / 2 + 0.02, 0);
    fr(0.05, op.h, -op.w / 6, 0, 0.06); fr(0.05, op.h, op.w / 6, 0, 0.06); fr(op.w, 0.05, 0, 0, 0.06);
    // sill ledge inside
    const sill = rbox(op.w + 0.3, 0.05, 0.22, 0.02).rotateY(yaw).translate(ox + nx * 0.02, op.sill + 0.025, oz + nz * 0.02);
    addArch('cap', sill);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(op.w, op.h).rotateY(yaw), glassMat);
    glass.position.set(ox - nx * 0.11, cy, oz - nz * 0.11);
    glass.lookAt(glass.position.x + nx, cy, glass.position.z + nz);
    glass.geometry = new THREE.PlaneGeometry(op.w, op.h);
    root.add(glass);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(op.w + 9, op.h + 6), skyMat);
    sky.position.set(ox - nx * 2.2, cy, oz - nz * 2.2);
    sky.lookAt(ox, cy, oz);
    root.add(sky);
  }
  for (const [key, geos] of arch) {
    const g = mergeAll(geos);
    const mesh = new THREE.Mesh(g, archMat[key] ?? archMat.wall);
    mesh.name = `arch:${key}`;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // ---------------------------------------------------------------- furniture kit (instanced)
  const kit = createKit(root);
  defineProtoKit(kit);

  const screens: GreyScreen[] = [];
  const st: ProtoState = { root, dynamic, screens, deskN: 0 };
  for (const f of layout.furniture) addProtoProp(kit, f, st);

  // posters (Bauhaus shapes in palette tokens) + wall clock on the east wall
  const posters: { x: number; z: number; yaw: number; shapes: [string, 'dot' | 'sq', number, number][] }[] = [
    { x: -2.3, z: b.maxZ - 0.13, yaw: Math.PI, shapes: [[ENV.butter, 'dot', 0, 0.1], [WORKSPACE[2].hex, 'sq', -0.12, -0.18], [CORE.clayDeep, 'sq', 0.14, -0.2]] },
    { x: 2.3, z: b.maxZ - 0.13, yaw: Math.PI, shapes: [[ENV.teal, 'dot', 0.08, -0.12], [ENV.butter, 'sq', -0.1, 0.16], [WORKSPACE[4].hex, 'dot', -0.12, -0.16]] },
    { x: b.maxX - 0.13, z: -3.2, yaw: -Math.PI / 2, shapes: [[CORE.clay, 'dot', 0, 0.12], [ENV.sage, 'sq', 0, -0.18]] },
  ];
  for (const p of posters) {
    const f = { pos: { x: p.x, y: 1.5, z: p.z }, yaw: p.yaw };
    const L = place(f);
    kit.add('posterFrame', L(0, 0, 0), p.yaw, CORE.ink2);
    kit.add('boardFace', L(0, 0, 0.012), p.yaw, MISC.whiteboard, { s: [0.34, 0.9, 1], j: 0 });
    for (const [c, kind, u, v] of p.shapes) {
      if (kind === 'dot') kit.add('posterDot', L(u, v, 0.022), p.yaw, c, { rx: Math.PI / 2, j: 0 });
      else kit.add('posterShape', L(u, v, 0.022), p.yaw + 0, c, { rz: 0.3, j: 0 });
    }
  }
  const clockF = { pos: { x: b.maxX - 0.13, y: 2.05, z: 3.1 }, yaw: -Math.PI / 2 };
  const CL = place(clockF);
  kit.add('clockFace', CL(0, 0, 0.02), clockF.yaw, MISC.trim, { rx: Math.PI / 2, j: 0 });
  kit.add('clockRim', CL(0, 0, 0.03), clockF.yaw, ENV.walnut, { j: 0 });
  // clock hands: instances of one 'hand' part, re-posed once a second in update()
  const handSpec: [number, number, string][] = [[0.14, 0.022, CORE.ink], [0.2, 0.014, CORE.ink], [0.2, 0.006, STATUS.blocked]];
  const handBase = handSpec.map(([len, wid, col], i) => {
    const p = CL(0, -0.02, 0.05 + i * 0.006);
    kit.add('hand', [p.x, p.y, p.z], clockF.yaw, col, { s: [wid, len, 1], j: 0 });
    return { p, len, wid };
  });
  // monitors: one InstancedMesh of screens (unlit, ≤ 0.95, scrolling code)
  const scr = new THREE.InstancedMesh(new THREE.PlaneGeometry(DESK.monitor.w - 0.05, DESK.monitor.h - 0.045), getMaterial('screen', { color: '#2A2D33', emissive: 0.9, code: 1, instanced: true }), screens.length);
  screens.forEach((s, i) => {
    tmpE.set(-0.1, s.yaw, 0, 'YXZ'); tmpQ.setFromEuler(tmpE);
    scr.setMatrixAt(i, tmpM.compose(tmpP.set(s.p.x, s.p.y, s.p.z), tmpQ, tmpS.set(1, 1, 1)));
    scr.setColorAt(i, new THREE.Color(STATUS.working));
  });
  scr.name = 'kit:screens';
  registerDeskScreens(scr, screens.map((s) => s.anchor)); // [RND fix r1] status-driven screen modes (deskScreens.ts)
  root.add(scr);

  // pendant lamps over each pod (cord + shade + bulb)
  for (const l of layout.lamps ?? []) {
    if (l.kind !== 'pendant') continue;
    kit.add('lampArm', [l.pos.x, (H + l.pos.y + 0.1) / 2 + 0.05, l.pos.z], 0, CORE.ink2, { s: [0.7, (H - l.pos.y - 0.1) / 0.34, 0.7], j: 0 });
    // [LVL fix r2] linen, not butter: by day the drums were the most saturated large shapes in the spawn frame
    // (agents must stay the most saturated things in any frame); after dark the emissive still glows warm
    kit.add('drumShade', [l.pos.x, l.pos.y + 0.1, l.pos.z], 0, '#E9DCC0', { s: [1.1, 0.8, 1.1] });
    kit.add('bulb', [l.pos.x, l.pos.y, l.pos.z], 0, '#CFC3AE', { j: 0 });
  }
  const kitDraws = kit.build();
  const handMesh = kit.meshOf('hand');

  ctx.scene.add(root);
  const cells = new Map<string, THREE.Object3D>(layout.visCells.map((c) => [c.id, root]));
  const anchors = Object.fromEntries((layout.anchors ?? []).map((a) => [a.id, { pos: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), yaw: 0 }]));
  let lastSec = -1;
  return {
    cells,
    anchors,
    root,
    stats: () => ({ kitDraws, children: root.children.length }),
    update() {
      if (!handMesh) return;
      const d = new Date();
      const sec = d.getSeconds();
      if (sec === lastSec) return;
      lastSec = sec;
      const hr = (d.getHours() % 12) + d.getMinutes() / 60, mn = d.getMinutes() + sec / 60;
      // hands spin in the wall plane (local z = wall normal)
      const ang = [-(hr / 12) * Math.PI * 2, -(mn / 60) * Math.PI * 2, -(sec / 60) * Math.PI * 2];
      handBase.forEach((h, i) => {
        tmpE.set(0, clockF.yaw, ang[i], 'YXZ'); tmpQ.setFromEuler(tmpE);
        handMesh.setMatrixAt(i, tmpM.compose(tmpP.set(h.p.x, h.p.y + 0.02, h.p.z), tmpQ, tmpS.set(h.wid, h.len, 1)));
      });
      handMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { ctx.scene.remove(root); },
  };
}


// ==================================================================================================== full office (hq)
/** §5.5 value map per zone: floor [colour, pattern], wall [colour, pattern], ceiling colour. `?greybox` drops patterns. */
const ZONE_STYLE: Record<string, { floor: [string, string]; wall: [string, string]; ceil: string }> = {
  LOB: { floor: ['#7D6450', 'planks'], wall: [ENV.wallCream, 'plaster'], ceil: '#B9B1A6' },
  ATR: { floor: ['#857C72', 'none'], wall: ['#D2C8BA', 'plaster'], ceil: '#B3AB9F' },
  PIT: { floor: ['#8A8279', 'none'], wall: ['#D2C8BA', 'plaster'], ceil: '#B3AB9F' },
  LIB: { floor: ['#6E5543', 'planks'], wall: ['#C2B39E', 'plaster'], ceil: '#978C7E' },
  MEZ: { floor: ['#3E4A63', 'felt'], wall: ['#B7AC9E', 'plaster'], ceil: '#2E3548' },
  NAL: { floor: ['#76604C', 'planks'], wall: ['#C7BDAF', 'plaster'], ceil: '#A8A096' },
  STR: { floor: [MISC.strPavers, 'cobble'], wall: [MISC.strBrick, 'brick'], ceil: '#4E5550' },
  BAY: { floor: [MISC.bayCarpet, 'felt'], wall: ['#D6CCBF', 'wainscot'], ceil: '#B5AEA4' },
  PLZ: { floor: ['#66706A', 'cobble'], wall: [MISC.strBrick, 'brick'], ceil: '#5A625D' },
  WAR: { floor: ['#7C7266', 'planks'], wall: ['#C7BDAF', 'plaster'], ceil: '#A8A096' },
  LAB: { floor: ['#6F8483', 'tile'], wall: ['#DCD8CD', 'tile'], ceil: '#BDB8AE' },
  MAIL: { floor: ['#7C7266', 'planks'], wall: ['#C9BBA5', 'plaster'], ceil: '#A8A096' },
  ARC: { floor: ['#76705F', 'planks'], wall: ['#C3BCAD', 'plaster'], ceil: '#A39C90' },
  ENG: { floor: ['#5E615F', 'tile'], wall: ['#8E8F8A', 'none'], ceil: '#4B4D4B' },
  CAF: { floor: [MISC.cafTerrazzo, 'terrazzo'], wall: [ENV.wallCream, 'wainscot'], ceil: '#B5AEA4' },
  NAP: { floor: ['#6F7C8A', 'felt'], wall: ['#BDB3C9', 'plaster'], ceil: '#9A93A8' },
  OUT: { floor: ['#857C72', 'none'], wall: ['#B9AE9F', 'plaster'], ceil: '#B3AB9F' },
};
const styleOf = (zone: string | null | undefined) => ZONE_STYLE[/^[EW]\d$/.test(zone ?? '') ? 'BAY' : (zone ?? '')] ?? ZONE_STYLE.OUT;
/** Furniture colours by type (value map: props darker than walls, lighter than floors where people stand). */
const TYPE_COLOR: Record<string, string> = {
  piano: CORE.ink2, recordPlayer: ENV.walnut, guitar: ENV.oak, treadmill: '#6B6760', dumbbells: '#57534D', planterBox: ENV.walnut,
  sunLamp: CORE.ink2, gameTable: ENV.oak, easel: ENV.oak, hammock: ENV.sage, ramColumn: CORE.ink2, fishTank: '#7FB0BC', bench: ENV.walnut,
  armchair: MISC.pitSofa, readingTable: ENV.walnut, ladder: ENV.oak, globe: ENV.teal, roundTable: ENV.walnut, stool: ENV.walnut,
  telescope: '#B08A4A', hotDesk: ENV.oak, bookCart: ENV.walnut, streetLamp: CORE.ink2, phoneBooth: '#4E6E6E', signpost: ENV.walnut,
  meetingTable: ENV.oak, labBench: '#9FB3B2', fumeHood: '#4A4D52', pigeonholes: ENV.oak, sortingTable: ENV.oak, outboxChute: '#8C6D4E',
  capsuleTube: '#9DB7C2', parcelStack: '#B08A62', drawerWall: '#8E8F8A', microfiche: '#5E615F', vaultDoor: '#8E8F8A', filingCabinet: '#8E8F8A',
  rackWall: CORE.ink, shellBench: '#6B6E70', cardTable: '#2F5E3A', hamsterWheel: '#B08A4A', espressoBar: ENV.walnut, cafeTable: ENV.oak,
  arcade: '#3A3F5C', pingPong: '#2F6A5A', foosball: ENV.walnut, bunk: ENV.oak, hearth: '#7A6E64', mapChest: ENV.walnut, crates: '#B08A62',
  planter: '#8C7A66', starChart: '#2E3548', testLight: CORE.ink2, beanbag: ENV.teal, stanchion: '#B08A4A', coffeeTable: ENV.walnut,
};
const BEANBAG: string[] = [ENV.teal, ENV.rose, ENV.butter, ENV.lavender, ENV.sage];

/** Canvas atlas of sign texts (system font stack, ART §3.4): one texture, one draw for every sign in the office. */
function signAtlas() {
  const CW = 1024, CH = 128, COLS = 2, ROWS = 24;
  const cv = document.createElement('canvas'); cv.width = CW * COLS; cv.height = CH * ROWS;
  const g = ctx2d(cv);
  const font = `800 ${Math.round(CH * 0.5)}px ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Ubuntu", "Cantarell", "DejaVu Sans", system-ui, sans-serif`;
  let n = 0;
  const add = (text: string, { bg = CORE.ink2, fg = MISC.trim, dot = null }: { bg?: string; fg?: string; dot?: string | null; back?: boolean } = {}): { u0: number; v0: number; u1: number; v1: number; aspect: number } => {
    const col = n % COLS, row = (n / COLS) | 0; n++;
    if (row >= ROWS) throw new Error('sign atlas full');
    g.font = font;
    const pad = CH * 0.35, dotW = dot ? CH * 0.6 : 0;
    const w = Math.min(CW, Math.ceil(g.measureText(text).width + pad * 2 + dotW));
    const x0 = col * CW, y0 = row * CH;
    g.fillStyle = bg; g.beginPath(); g.roundRect(x0 + 2, y0 + 2, w - 4, CH - 4, CH * 0.22); g.fill();
    if (dot) { g.fillStyle = dot; g.beginPath(); g.arc(x0 + pad + dotW * 0.3, y0 + CH / 2, CH * 0.17, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = fg; g.textBaseline = 'middle';
    g.fillText(text, x0 + pad + dotW, y0 + CH * 0.54);
    return { u0: x0 / cv.width, u1: (x0 + w) / cv.width, v0: 1 - (y0 + CH) / cv.height, v1: 1 - y0 / cv.height, aspect: w / CH };
  };
  const tex = (): THREE.CanvasTexture => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { add, tex };
}

/**
 * Live bay signs (§7.2, [LVL fix r1]): one quad per storefront sign (+ the atrium-side sign of E2/E3), one canvas row
 * each (fixed 6:1 plates, text fitted), one draw. `set(bayState)` takes `director.bayState()`:
 * `{[bayId]: {amenity, name, ws: {label, number, colorIndex}|null}}` and redraws only the rows that changed.
 */
function createBaySigns(layout: Layout, root: THREE.Group): { set: (state?: Record<string, BayInfo>) => void; mesh: THREE.InstancedMesh } {
  const OX = 20.5, H = 128, W = H * 6, A = W / H;
  const spots: { bay: Bay; h: number; p: Vec; yaw: number }[] = [];
  for (const bay of layout.bays ?? []) {
    const east = bay.side === 'E';
    // [ENV M2 breadth STR, cross-owner LVL] the plate sits on the STREET face of the 0.2 m storefront wall (layout's
    // sign.x is the bay-side face: the quad was buried in the lintel, no storefront sign read from the street)
    spots.push({ bay, h: 0.28, p: { ...bay.sign, x: bay.sign.x + (east ? -0.26 : 0.26) }, yaw: bay.signYaw });
    if (east && bay.id !== 'E1') spots.push({ bay, h: 0.3, p: { x: 14 - OX + 0.13, y: 2.65, z: bay.storefront.z }, yaw: Math.PI / 2 });
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H * spots.length;
  const g = ctx2d(cv);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const geos = spots.map((sp, i) => {
    const q = new THREE.PlaneGeometry(sp.h * A, sp.h);
    const uv = q.getAttribute('uv');
    const v0 = 1 - (i + 1) / spots.length, v1 = 1 - i / spots.length;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), uv.getY(k) ? v1 : v0);
    return q.rotateY(sp.yaw).translate(sp.p.x, sp.p.y, sp.p.z);
  });
  const mesh = new THREE.InstancedMesh(mergeAll(geos), getMaterial('screen', { color: '#FFFFFF', emissive: 0.85, instanced: true, strip: null, uniforms: {} }), 1);
  Object.assign(mesh.material, { map: tex });
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.setColorAt(0, new THREE.Color('#FFFFFF'));
  mesh.name = 'hq:baySigns';
  mesh.frustumCulled = false;
  root.add(mesh);
  const font = (px: number): string => `800 ${px}px ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Ubuntu", "Cantarell", "DejaVu Sans", system-ui, sans-serif`;
  const drawn = new Array<string>(spots.length).fill('');
  const draw = (i: number, text: string, col: string, taken: boolean): boolean => {
    const key = `${text}|${col}|${taken}`;
    if (drawn[i] === key) return false;
    drawn[i] = key;
    const y0 = i * H;
    g.clearRect(0, y0, W, H);
    g.fillStyle = taken ? col : CORE.ink2; g.beginPath(); g.roundRect(2, y0 + 2, W - 4, H - 4, H * 0.22); g.fill();
    if (taken) { g.fillStyle = CORE.ink2; g.beginPath(); g.roundRect(10, y0 + 10, W - 20, H - 20, H * 0.16); g.fill(); }
    g.fillStyle = col; g.beginPath(); g.arc(H * 0.5, y0 + H / 2, H * 0.17, 0, Math.PI * 2); g.fill();
    let px = Math.round(H * 0.5);
    g.font = font(px);
    const room = W - H * 0.95 - H * 0.3;
    while (px > 24 && g.measureText(text).width > room) { px -= 4; g.font = font(px); }
    g.fillStyle = MISC.trim; g.textBaseline = 'middle';
    g.fillText(text, H * 0.95, y0 + H * 0.54);
    return true;
  };
  const set = (state: Record<string, BayInfo> = {}): void => {
    let dirty = false;
    spots.forEach((sp, i) => {
      const st = state[sp.bay.id];
      const ws = st?.ws;
      const text = ws ? `${sp.bay.id} · #${ws.number ?? '?'} ${ws.label ?? ''}`.trim() : `${sp.bay.id} · ${sp.bay.amenityName}`;
      dirty = draw(i, text, ws ? WORKSPACE[((ws.colorIndex ?? 0) % WORKSPACE.length + WORKSPACE.length) % WORKSPACE.length].hex : '#8C857A', !!ws) || dirty;
    });
    if (dirty) tex.needsUpdate = true;
  };
  set({});
  return { set, mesh };
}

/**
 * The full office greybox (§7, M1.5): value-map flat colours per zone, walls from `layout.walls` (openings, glass,
 * rails, lintels), floors per zone (Pit rings, ENG platform, mezzanine slab), ceilings (hidden from above), stairs,
 * the slide, the skylight, signs, the furniture kit and lamp fixtures. `?greybox` = flat colours + density overlay.
 */
function buildHq(layout: HqLayout, ctx: GreyCtx): WorldBuild {
  const root = new THREE.Group();
  root.name = `world:${layout.id}`;
  const flat = !!ctx.params?.greybox;
  // [ENV M1.75, cross-owner] build/index.ts asks for no architecture (architecture.ts draws it) and nothing in the cells
  // the prop kit dresses (furniture, lamps, ropes, rods, bushes, screens)
  const envSkip = ctx.envSkip ?? null, skipCells = envSkip?.cells ?? null;
  const OX = 20.5, OZ = 14;
  const pitCircle = ((): Circle => {
    const c = layout.zones.find((z) => z.id === 'PIT')?.circle;
    if (!c) throw new Error('buildHq: layout has no PIT circle');
    return c;
  })();
  const zoneAtW = (x: number, z: number, level = 0) => layout.zoneAt(x, z, level);

  // ------------------------------------------------------------ architecture, merged per material key
  const arch = new Map<string, THREE.BufferGeometry[]>();
  const mats = new Map<string, THREE.Material>();
  const patternOf = (p: string): keyof typeof PATTERN | 0 => { const s = flat ? 'none' : p || 'none'; return isPattern(s) ? s : 0; };
  const matOf = (key: string): THREE.Material => {
    const cached = mats.get(key);
    if (cached) return cached;
    const [kind = '', color = '', pattern = ''] = key.split('|');
    const m = kind === 'glass' ? getMaterial('glass', { color, reflect: 'interior' })
      : kind === 'sky' ? getMaterial('sky')
        : kind === 'vc' ? getMaterial('toonEnv', { color: '#FFFFFF', vertexColors: true, pattern: patternOf(color) }) // key vc|pattern
          : getMaterial('toonEnv', { color, pattern: patternOf(pattern) });
    mats.set(key, m);
    return m;
  };
  // [LVL fix r1] vis cells (§5.3): geometry belongs to the cell its centre is in (the mezzanine above its slab), merged per
  // REGION (a few adjacent cells, `visCells[].region`) × material, so hidden regions drop out and three's frustum test
  // skips regions behind the camera; outside the building (sky cards, ground) = always drawn
  const regionOfCell = new Map(layout.visCells.map((c) => [c.id, c.region]));
  const cellOfGeo = (x: number, y: number, z: number): string | null => {
    const b0 = layout.bounds;
    if (x < b0.minX || x > b0.maxX || z < b0.minZ || z > b0.maxZ) return null;
    const px = x + OX, pz = z + OZ;
    return (y > 2.85 && layout.plan.onMezz(px, pz) ? 'MEZ' : layout.zoneAt(x, z, 0)) ?? null;
  };
  const tmpBox = new THREE.Box3(), tmpC = new THREE.Vector3();
  const addArch = (key: string, geo: THREE.BufferGeometry, group = 'main'): void => {
    if (envSkip?.arch) return; // [ENV M1.75, cross-owner]
    // [LVL fix r1] draw calls: env colours ride in vertex colours (toonEnv|VCOL, §5.4 matrix), so a region merges into
    // one mesh per PATTERN instead of one per colour × pattern (90 → ~30 architecture draws)
    if (key.startsWith('env|')) {
      const [, color, pattern] = key.split('|');
      if (geo.index) geo = geo.toNonIndexed();
      const c = new THREE.Color(color), n = geo.getAttribute('position').count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
      key = `vc|${pattern || 'none'}`;
    }
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (geo.boundingBox) tmpBox.copy(geo.boundingBox).getCenter(tmpC);
    const cell = cellOfGeo(tmpC.x, tmpC.y, tmpC.z);
    const region = (cell === null ? undefined : regionOfCell.get(cell)) ?? 'OUT';
    const k = `${group}@${region}@${key}`;
    const list = arch.get(k) ?? [];
    arch.set(k, list);
    list.push(geo);
  };
  const env = (c: string, p = 'none'): string => `env|${c}|${p}`;
  const flatXZ = (x0: number, z0: number, x1: number, z1: number, y: number, down = false): THREE.BufferGeometry => new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(down ? Math.PI / 2 : -Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);

  // floors
  for (const z of layout.zones) {
    if (z.id === 'PIT' || z.level === 1) continue;
    const [x0, z0, x1, z1] = z.rect;
    const st = styleOf(z.id);
    const y = z.id === 'ENG' ? (z.floor ?? 0) : z.id === 'NAP' ? 0.004 : 0;
    if (z.id === 'ATR') {
      const sh = new THREE.Shape();
      sh.moveTo(x0, -z0); sh.lineTo(x1, -z0); sh.lineTo(x1, -z1); sh.lineTo(x0, -z1); sh.lineTo(x0, -z0);
      const [pcx, pcz, pr] = pitCircle;
      const hole = new THREE.Path(); hole.absarc(pcx, -pcz, pr, 0, Math.PI * 2, true); sh.holes.push(hole);
      addArch(env(st.floor[0], st.floor[1]), new THREE.ShapeGeometry(sh, 48).rotateX(-Math.PI / 2));
    } else addArch(env(st.floor[0], st.floor[1]), flatXZ(x0, z0, x1, z1, y));
    if (z.id === 'ENG') { // platform edge along the atrium glass (+0.25 step)
      addArch(env('#4B4D4B'), rbox(0.2, 0.25, z1 - z0, 0.02).translate(x0 + 0.1, 0.125, (z0 + z1) / 2));
    }
  }
  // the Pit: ring steps, risers, rug disc
  {
    const [pcx, pcz] = pitCircle;
    const P = layout.plan.PIT;
    // [LVL fix r1] the bowl reads as sunken: treads step DOWN in value toward the rug, the risers are ≥ 2 value-map steps
    // darker and face the centre (the old open cylinders faced outward, so the far risers were back-face culled and the
    // rings merged into one flat disc), and every step edge carries a light nosing strip
    const TREAD = ['#8F867C', '#7E766D'];
    const inward = (g: THREE.BufferGeometry): THREE.BufferGeometry => { // flip an open cylinder to face its axis
      const idx = g.index;
      if (idx) for (let i = 0; i < idx.count; i += 3) { const t2 = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t2); }
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
      return g;
    };
    let prevY = 0;
    P.rings.forEach(([r, y], i) => {
      const rin = P.rings[i + 1]?.[0] ?? 0;
      const last = i === P.rings.length - 1;
      const geo = rin ? new THREE.RingGeometry(rin, r - 0.07, 64, 1) : new THREE.CircleGeometry(r - 0.07, 64);
      addArch(env(last ? MISC.pitRug : TREAD[i], last ? 'felt' : 'none'), geo.rotateX(-Math.PI / 2).translate(pcx, y, pcz));
      addArch(env('#4B443D'), inward(new THREE.CylinderGeometry(r, r, prevY - y, 64, 1, true)).translate(pcx, (prevY + y) / 2, pcz));
      // nosing: a light strip on the lip above this riser (on the level above) + a thin band just inside the step
      addArch(env('#D8CBB4'), new THREE.RingGeometry(r, r + 0.07, 64, 1).rotateX(-Math.PI / 2).translate(pcx, prevY + 0.003, pcz));
      addArch(env('#5E564E'), new THREE.RingGeometry(r - 0.07, r, 64, 1).rotateX(-Math.PI / 2).translate(pcx, y + 0.002, pcz));
      prevY = y;
    });
  }
  // mezzanine slab + landing (top = MEZ carpet; body/underside = the Library ceiling)
  const MZ: Rect[] = layout.plan.MEZZ_RECTS.map(([a, b, c, d]): Rect => [a - OX, b - OZ, c - OX, d - OZ]);
  for (const [x0, z0, x1, z1] of MZ) {
    addArch(env(ZONE_STYLE.MEZ.floor[0], ZONE_STYLE.MEZ.floor[1]), flatXZ(x0, z0, x1, z1, 2.901));
    addArch(env(ZONE_STYLE.LIB.ceil, 'plaster'), rbox(x1 - x0, 0.3, z1 - z0, 0.02).translate((x0 + x1) / 2, 2.75, (z0 + z1) / 2));
  }
  // walls: two half-thickness skins, each in the colour of the zone it faces; openings cut spans out
  const glassGeos: THREE.BufferGeometry[] = [];
  const frames: { w: Wall; o: WallOpening; ux: number; uz: number; nx: number; nz: number; yaw: number; at: (s: number, off?: number) => [number, number]; y0: number }[] = [];
  for (const w of layout.walls) {
    const [ax, az] = w.a, [bx, bz] = w.b;
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
    const yaw = Math.atan2(-uz, ux);
    const y0 = w.y0 ?? 0, t = w.t ?? 0.2;
    const at = (s: number, off = 0): [number, number] => [ax + ux * s + nx * off, az + uz * s + nz * off];
    if (w.kind === 'rail') { // glass balustrade: top rail, posts, glass
      const [mx, mz] = at(len / 2);
      // [LVL fix r3] a thin 0.04 m walnut tube (was a 0.06 × 0.09 plank) so the overlook reads over it, not through a band
      addArch(env(ENV.walnut, 'wood'), new THREE.CylinderGeometry(0.02, 0.02, len + 0.04, 8).rotateZ(Math.PI / 2).rotateY(yaw).translate(mx, y0 + w.h - 0.02, mz));
      for (let s = 0; s <= len + 1e-6; s += Math.max(0.3, len / Math.ceil(len / 1.2))) { const [px, pz] = at(s); addArch(env(CORE.ink2), rbox(0.04, w.h - 0.02, 0.04, 0.01).translate(px, y0 + (w.h - 0.02) / 2, pz)); }
      glassGeos.push(new THREE.PlaneGeometry(len, w.h - 0.12).rotateY(yaw).translate(mx, y0 + 0.06 + (w.h - 0.12) / 2, mz));
      continue;
    }
    const ops = [...(w.openings ?? [])].sort((p, q) => p.at - q.at);
    const cuts = [0, len, ...ops.flatMap((o) => [o.at, o.at + o.w])].filter((v) => v >= 0 && v <= len).sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) {
      const s0 = cuts[i], s1 = cuts[i + 1];
      if (s1 - s0 < 0.005) continue;
      const mid = (s0 + s1) / 2;
      // vertical solid spans = [y0, y0 + h] minus the openings covering this interval
      let spans: Span[] = [[y0, y0 + w.h]];
      for (const o of ops) {
        if (o.at > mid || o.at + o.w < mid) continue;
        const c0 = y0 + o.sill, c1 = y0 + o.sill + o.h;
        spans = spans.flatMap(([p, q]): Span[] => {
          if (c1 <= p || c0 >= q) return [[p, q]];
          const cut: Span[] = [[p, c0], [c1, q]];
          return cut.filter(([u, v]) => v - u > 0.005);
        });
        if (['glass', 'window', 'highWindow', 'display'].includes(o.kind)) {
          const [gx, gz] = at(mid);
          glassGeos.push(new THREE.PlaneGeometry(s1 - s0, o.h).rotateY(yaw).translate(gx, c0 + o.h / 2, gz));
        }
        frames.push({ w, o, ux, uz, nx, nz, yaw, at, y0 });
      }
      for (const side of [-1, 1]) {
        const [sx, sz] = at(mid, side * 0.5);
        for (const [p, q] of spans) {
          const lvl = (p + q) / 2 > 2.9 && layout.plan.onMezz(sx + OX, sz + OZ) ? 1 : 0;
          const zone = zoneAtW(sx, sz, lvl) ?? 'OUT';
          const st = styleOf(zone);
          const [cx2, cz2] = at(mid, side * t / 4);
          addArch(env(st.wall[0], st.wall[1]), rbox(s1 - s0 + (i === 0 || i === cuts.length - 2 ? t / 2 : 0.002), q - p, t / 2, 0.01).rotateY(yaw).translate(cx2, (p + q) / 2, cz2));
        }
      }
    }
    // cap (diorama cut) on top
    const [mx, mz] = at(len / 2);
    addArch(env(MISC.trim), rbox(len + t, 0.04, t + 0.02, 0.01).rotateY(yaw).translate(mx, y0 + w.h + 0.02, mz), 'cap');
  }
  // opening frames (jambs + head + sill), deduped per opening
  const seen = new Set<WallOpening>();
  for (const { w, o, yaw, at, y0 } of frames) {
    if (seen.has(o)) continue; seen.add(o);
    if (o.kind === 'lintel' || o.kind === 'opening') continue;
    const dark = o.kind === 'storefront' || o.kind === 'display' || w.kind === 'storefront';
    const col = dark ? '#4A4540' : o.kind === 'glass' ? CORE.ink2 : ENV.oak;
    const c0 = y0 + o.sill, c1 = c0 + o.h, dep = (w.t ?? 0.2) + 0.06;
    for (const e of [o.at, o.at + o.w]) { const [px, pz] = at(e); addArch(env(col, 'wood'), rbox(0.08, o.h, dep, 0.015).rotateY(yaw).translate(px, (c0 + c1) / 2, pz)); }
    const [hx, hz] = at(o.at + o.w / 2);
    addArch(env(col, 'wood'), rbox(o.w + 0.16, 0.08, dep, 0.015).rotateY(yaw).translate(hx, c1 + 0.04, hz));
    if (o.sill > 0.05) addArch(env(MISC.trim), rbox(o.w + 0.2, 0.05, dep + 0.08, 0.015).rotateY(yaw).translate(hx, c0 - 0.025, hz));
  }
  // ceilings (hidden from above, e.g. the `plan` pose); the atrium keeps a 6 × 6 skylight
  for (const z of layout.zones) {
    if (['PIT', 'NAP', 'LIB'].includes(z.id)) continue;
    const [x0, z0, x1, z1] = z.rect;
    const y = z.ceil ?? 2.8;
    const st = styleOf(z.id);
    if (z.id === 'ATR') {
      const [sx0, sz0, sx1, sz1] = layout.skylight.rect;
      const sh = new THREE.Shape();
      sh.moveTo(x0, z0); sh.lineTo(x1, z0); sh.lineTo(x1, z1); sh.lineTo(x0, z1); sh.lineTo(x0, z0);
      const hole = new THREE.Path(); hole.moveTo(sx0, sz0); hole.lineTo(sx0, sz1); hole.lineTo(sx1, sz1); hole.lineTo(sx1, sz0); hole.lineTo(sx0, sz0); sh.holes.push(hole);
      addArch(env(st.ceil, 'plaster'), new THREE.ShapeGeometry(sh).rotateX(Math.PI / 2).translate(0, y, 0), 'ceil');
      // skylight: frame + mullions (glass + sky above)
      const fr = (w2: number, d2: number, px: number, pz: number): void => addArch(env(CORE.ink2), rbox(w2, 0.14, d2, 0.02).translate(px, y - 0.07, pz), 'ceil');
      fr(sx1 - sx0 + 0.2, 0.2, (sx0 + sx1) / 2, sz0); fr(sx1 - sx0 + 0.2, 0.2, (sx0 + sx1) / 2, sz1);
      fr(0.2, sz1 - sz0, sx0, (sz0 + sz1) / 2); fr(0.2, sz1 - sz0, sx1, (sz0 + sz1) / 2);
      fr(0.08, sz1 - sz0, (sx0 + sx1) / 2, (sz0 + sz1) / 2); fr(sx1 - sx0, 0.08, (sx0 + sx1) / 2, (sz0 + sz1) / 2);
      glassGeos.push(flatXZ(sx0, sz0, sx1, sz1, y + 0.05, true));
      addArch('sky', flatXZ(sx0 - 6, sz0 - 6, sx1 + 6, sz1 + 6, y + 4, true), 'ceil');
      continue;
    }
    addArch(env(st.ceil, 'plaster'), flatXZ(x0, z0, x1, z1, y, true), 'ceil');
  }
  // exterior sky cards all round (the sky shader draws the skyline / garden, §7.3), 6 m out
  {
    const b = layout.bounds, pad = 6, H = 12;
    const card = (w2: number, px: number, pz: number, ry: number): void => addArch('sky', new THREE.PlaneGeometry(w2, H).rotateY(ry).translate(px, H / 2 - 2, pz));
    card(b.maxX - b.minX + 2 * pad, (b.minX + b.maxX) / 2, b.minZ - pad, 0);
    card(b.maxX - b.minX + 2 * pad, (b.minX + b.maxX) / 2, b.maxZ + pad, Math.PI);
    card(b.maxZ - b.minZ + 2 * pad, b.minX - pad, (b.minZ + b.maxZ) / 2, Math.PI / 2);
    card(b.maxZ - b.minZ + 2 * pad, b.maxX + pad, (b.minZ + b.maxZ) / 2, -Math.PI / 2);
    // ground outside, BELOW the Pit's bottom step ([LVL fix r1]: at −0.02 it covered the sunken Pit, which then read as
    // one flat olive disc: the steps, risers and rug were all under it)
    addArch(env('#7F8A6E', 'none'), flatXZ(b.minX - pad, b.minZ - pad, b.maxX + pad, b.maxZ + pad, -0.55));
  }
  // stairs: open risers (treads + two stringers + the west rail)
  {
    const S = layout.stairs, n = 17;
    const x0 = S.x0 - OX, x1 = S.x1 - OX, zf = S.zFoot - OZ, zt = S.zTop - OZ, w2 = x1 - x0 - 0.1, run = zf - zt;
    for (let i = 0; i < n; i++) {
      const zc = zf - (i + 0.5) * (run / n), y = S.rise * (i + 1) / n;
      addArch(env(ENV.oak, 'wood'), rbox(w2, 0.05, run / n + 0.02, 0.015).translate((x0 + x1) / 2, y - 0.025, zc));
    }
    const slope = Math.atan2(S.rise, run), L = Math.hypot(S.rise, run);
    for (const x of [x0 + 0.04, x1 - 0.04]) addArch(env(CORE.ink2), rbox(0.06, 0.22, L, 0.02).rotateX(slope).translate(x, S.rise / 2 - 0.1, (zf + zt) / 2));
    addArch(env(ENV.walnut, 'wood'), rbox(0.06, 0.06, L, 0.02).rotateX(slope).translate(x0, S.rise / 2 + 0.95, (zf + zt) / 2));
    for (let i = 0; i <= 6; i++) { const z = zf - (i / 6) * run, y = S.rise * (i / 6); addArch(env(CORE.ink2), rbox(0.04, 0.95, 0.04, 0.01).translate(x0, y + 0.475, z)); }
  }
  // the slide: a tube along the baked helix + the centre pole
  {
    const pts = layout.slide.path.map((p) => new THREE.Vector3(p.x, p.y + 0.3, p.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    addArch(env(ENV.butter), new THREE.TubeGeometry(curve, 160, layout.slide.tube, 14, false));
    addArch(env(CORE.ink2), new THREE.CylinderGeometry(0.09, 0.09, 3.3, 12).translate(layout.slide.center.x, 1.65, layout.slide.center.z));
  }

  // ------------------------------------------------------------ signs (one atlas, one draw)
  const atlas = signAtlas();
  const signGeos: THREE.BufferGeometry[] = [];
  /** `yaw` = facing (prop-front yaw) */
  const sign = (text: string, p: Vec, yaw: number, h = 0.26, o: { bg?: string; fg?: string; dot?: string | null; back?: boolean } = {}): void => {
    const r = atlas.add(text, o);
    const quad = (ry: number): THREE.BufferGeometry => {
      const g = new THREE.PlaneGeometry(h * r.aspect, h);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? r.u1 : r.u0, uv.getY(i) ? r.v1 : r.v0);
      return g.rotateY(ry).translate(p.x, p.y, p.z);
    };
    signGeos.push(quad(yaw));
    if (o.back) signGeos.push(quad(yaw + Math.PI)); // hanging signs read from both sides
  };
  const W = (px: number, pz: number, y: number): Vec => ({ x: px - OX, y, z: pz - OZ });
  // bay signs are live (§7.2): `E2 · #2 api` in the workspace colour while a workspace holds the bay, else the amenity
  // name; their own small atlas, redrawn when the director's bay state changes (update())
  const baySigns = createBaySigns(layout, root);
  sign('HELP DESK', W(16.25, 21.0, 3.1), Math.PI, 0.34, { dot: STATUS.blocked, back: true }); // [LVL fix r1] under the lintel
  const counterH = layout.furniture.find((f) => f.id === 'counter0')?.size[1] ?? 0.75;
  sign('NOW SERVING', W(15.3, 20.995, counterH + 0.12), Math.PI, 0.08, { bg: CORE.ink, fg: ENV.butter }); // on the counter's stand
  sign('LIBRARY', W(21, 7.14, 2.45), 0, 0.26);
  sign('ENGINE ROOM', W(27.86, 18.25, 2.05), -Math.PI / 2, 0.24);
  sign('MAILROOM', W(27.86, 7.9, 2.02), -Math.PI / 2, 0.2);
  sign('CAFÉ · ARCADE', W(27.86, 24.5, 2.5), -Math.PI / 2, 0.26);
  sign('LAB', W(14.14, 25.7, 1.95), Math.PI / 2, 0.22);
  sign('LAB', W(7.9, 23.36, 2.0), Math.PI, 0.22);
  sign('WAR ROOM', W(3.2, 23.36, 2.0), Math.PI, 0.22);
  sign('STUDIO STREET', W(6.5, 21.0, 3.05), Math.PI, 0.3, { dot: ENV.butter, back: true });
  sign('READING ALLEY', W(13.86, 1.0, 2.1), -Math.PI / 2, 0.2);
  sign('ARCHIVE', W(32.86, 4.7, 2.0), -Math.PI / 2, 0.2);
  sign('NAP NOOK', W(39.0, 23.14, 2.0), 0, 0.2);
  sign('ROUND TABLE', W(14.14, 3.0, 4.6), Math.PI / 2, 0.26);
  sign('OBSERVATORY', W(27.86, 3.2, 4.6), -Math.PI / 2, 0.26);
  sign('PHONES · MCP', W(11.6, 23.36, 2.3), Math.PI, 0.18);
  // [LVL fix r2] WHEE! is a gantry header over the slide mouth, read on the approach along the mezzanine (and from the
  // atrium below, back face): its bottom edge (y 4.7) sits above the rider's upper frustum at the mount (eye 4.1, 0.92 m
  // away, pitch −0.1 → +24° → 4.52), so the ride's payoff view of the Pit and the Lobby is clear (was y 3.95, mid-frame)
  const WHEE = { x: layout.slide.mouth.x, y: 4.86, z: 7.02 - OZ };
  sign('WHEE!', WHEE, Math.PI, 0.32, { bg: ENV.butter, fg: CORE.ink, back: true });
  // [STAT M3, cross-owner] Big Board faces are live in world/stats/bigBoard.ts (§7.4): placeholder signs removed
  if (signGeos.length) {
    const g = mergeAll(signGeos);
    const signs = new THREE.InstancedMesh(g, getMaterial('screen', { color: '#FFFFFF', emissive: 0.85, instanced: true, strip: null, uniforms: {} }), 1);
    Object.assign(signs.material, { map: atlas.tex() });
    signs.setMatrixAt(0, new THREE.Matrix4());
    signs.setColorAt(0, new THREE.Color('#FFFFFF'));
    signs.name = 'hq:signs';
    signs.frustumCulled = false;
    root.add(signs);
  }

  // ------------------------------------------------------------ furniture (proto kit + hq parts, instanced)
  const kit = createKit(root, cellOfGeo, skipCells);
  defineProtoKit(kit);
  kit.def('box', rbox(1, 1, 1, 0.1, 1), { caster: true }); // [LVL fix r1] 1-segment bevel: 108 tris (was 300)
  kit.def('slab', rbox(1, 1, 1, 0.02), { caster: true });
  kit.def('cyl', cyl(0.5, 0.5, 1, 12));
  kit.def('cylHi', cyl(0.5, 0.5, 1, 32)); // [LVL fix r1] big round things (tables, hearth, flower bed, RAM tube) stay smooth
  kit.def('ball', new THREE.SphereGeometry(0.5, 16, 10), { caster: true });
  kit.def('ballS', new THREE.SphereGeometry(0.5, 8, 6), { far: 20 }); // [LVL fix r1] small knobs, flowers, coals (≤ 15 cm)
  kit.def('boxS', new THREE.BoxGeometry(1, 1, 1)); // [LVL fix r1] small / thin boxes (handles, slats, trims)
  kit.def('torus', new THREE.TorusGeometry(0.5, 0.06, 8, 32), { caster: true });
  // the WHEE! gantry's hanger rods (to the atrium ceiling)
  for (const e of [-0.4, 0.4]) kit.add('cyl', [WHEE.x + e, (WHEE.y + 0.16 + 5.5) / 2, WHEE.z], 0, CORE.ink2, { s: [0.025, 5.5 - WHEE.y - 0.16, 0.025], j: 0 });
  const screens: GreyScreen[] = [];
  const bushGeos: THREE.BufferGeometry[] = [];
  const st: ProtoState = { root, dynamic: [], screens, deskN: 0, bushGeos };
  let seed = 0;
  for (const f of layout.furniture) {
    const fCell = cellOfGeo(f.pos.x, f.pos.y + 0.05, f.pos.z);
    if (skipCells && fCell !== null && skipCells.has(fCell)) continue; // [ENV M1.75, cross-owner]
    if (envSkip?.types?.has(f.type)) continue; // [ENV M2 breadth, cross-owner LVL] kit-dressed types outside the dressed cells (phone booths: build/zones/phones.ts)
    if (skipCells && f.kit) continue; // [LVL fix m175 r2] kit-dressed layout items (`f.kit`, e.g. the lobby rug + medallion: zones/lobby.ts); ?greybox still draws them
    const L = place(f);
    const c = TYPE_COLOR[f.type] ?? '#A89A86';
    const [w, h, d] = f.size;
    /** box in prop-local coords: centre (lx, ly, lz) with ly measured from the prop's floor */
    const small = (a: number, b2: number, c2: number): boolean => Math.max(a, b2, c2) < 0.2 || Math.min(a, b2, c2) < 0.05; // [LVL fix r1] no bevel below that
    const B = (lx: number, ly: number, lz: number, bw: number, bh: number, bd: number, col = c, o: { part?: string; yaw?: number; rx?: number; rz?: number; j?: number } = {}): void => kit.add(o.part ?? (small(bw, bh, bd) ? 'boxS' : 'box'), L(lx, ly, lz), f.yaw + (o.yaw ?? 0), col, { s: [bw, bh, bd], rx: o.rx, rz: o.rz, j: o.j });
    const Cy = (lx: number, ly: number, lz: number, r: number, ch: number, col = c, o: { rz2?: number; rx?: number; rz?: number; j?: number } = {}): void => kit.add(r >= 0.2 ? 'cylHi' : 'cyl', L(lx, ly, lz), f.yaw, col, { s: [2 * r, ch, 2 * (o.rz2 ?? r)], rx: o.rx, rz: o.rz, j: o.j });
    const Ba = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, col = c): void => kit.add(Math.max(sx, sy, sz) <= 0.16 ? 'ballS' : 'ball', L(lx, ly, lz), f.yaw, col, { s: [sx, sy, sz] });
    const legs = (tw: number, td: number, th: number, col = c, r = 0.025): void => { for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) Cy(sx * (tw / 2 - 0.08), th / 2, sz * (td / 2 - 0.08), r, th, col); };
    const table = (col = c, round = false): void => {
      if (round) { Cy(0, h - 0.025, 0, w / 2, 0.05, col); Cy(0, (h - 0.05) / 2, 0, 0.05, h - 0.05, CORE.ink2); Cy(0, 0.015, 0, w * 0.3, 0.03, CORE.ink2); }
      else { B(0, h - 0.03, 0, w, 0.06, d, col, { part: 'slab' }); legs(w, d, h - 0.06); }
    };
    const bushAt = (lx: number, ly: number, lz: number, sc: number): number => bushGeos.push(bushGeometry(L(lx, ly, lz), sc, seed++, sc < 0.6 ? 1 : 2)); // [LVL fix r1] small bushes: detail 1
    switch (f.type) {
      case 'sofa': { // proto sofa scaled to the pit two-seaters
        const sw = w / 2.4, sd = d / 0.85;
        kit.add('sofaBase', L(0, 0.13, 0), f.yaw, MISC.pitSofa, { s: [sw, 1, sd] });
        // [LVL fix r2] cushions under the seat slots (±w/4: ±0.45 on the 1.8 m pit sofas, seats ≥ 0.95 m apart)
        for (const e of [-w / 4, w / 4]) kit.add('sofaCushion', L(e, 0.33, 0.05), f.yaw, MISC.pitSofa, { s: [(w / 2 - 0.12) / 0.76, 1, sd], j: 0.05 });
        kit.add('sofaBack', L(0, 0.48, -0.26), f.yaw, MISC.pitSofa, { s: [sw, 1, 1], rx: -0.1 });
        for (const e of [-1, 1]) kit.add('sofaArm', L(e * (w / 2 - 0.09), 0.21, 0), f.yaw, MISC.pitSofa, { s: [1, 1, sd] });
        kit.add('pillow', L(0, 0.52, -0.14), f.yaw + 0.25, [ENV.rose, ENV.butter, ENV.lavender][seed++ % 3], { rx: -0.2 });
        break;
      }
      case 'counter': {
        const sw = w / 2.0;
        const sh = (h - 0.06) / 0.84;
        kit.add('counterBody', L(0, (h - 0.06) / 2, 0), f.yaw, ENV.walnut, { s: [sw, sh, 1] });
        kit.add('counterTop', L(0, h - 0.03, 0), f.yaw, ENV.oak, { s: [sw, 1, 1] });
        kit.add('counterStripe', L(0, h * 0.68, 0.285), f.yaw, ENV.butter, { s: [sw, 1, 1], j: 0 });
        kit.add('bell', L(0.65, h, 0.12), f.yaw, ENV.butter);
        kit.add('mug', L(-0.9, h + 0.04, -0.12), f.yaw, ENV.rose);
        // [LVL fix r1] no teller-window posts/header any more: the frame hid the E-bay glazing from the spawn (P1); the
        // HELP DESK sign hangs from the z21 lintel instead, and NOW SERVING stands on the counter
        B(0.95, h + 0.11, 0.16, 0.5, 0.22, 0.04, CORE.ink); // NOW SERVING stand at the west end (clear of the E3 sightline)
        break;
      }
      case 'coffeeCart': { // [LVL fix r1] lobby coffee cart / Library tea trolley: cart body, top, machine, cups, awning
        B(0, 0.45, 0, w, 0.8, d, ENV.walnut);
        B(0, h - 0.12, 0, w + 0.06, 0.05, d + 0.06, ENV.oak, { part: 'slab' });
        B(-w * 0.22, h + 0.08, -0.05, 0.36, 0.34, 0.3, '#B8B2A6');
        B(-w * 0.22, h + 0.27, -0.05, 0.2, 0.05, 0.16, CORE.ink2, { part: 'slab' });
        for (let k = 0; k < 3; k++) kit.add('mug', L(w * 0.12 + k * 0.13, h - 0.05, 0.12), f.yaw, [ENV.teal, MISC.trim, ENV.rose][k]);
        for (const e of [-1, 1]) Cy(e * (w / 2 - 0.04), h + 0.35, -d / 2 + 0.04, 0.02, 0.8, CORE.ink2);
        B(0, h + 0.78, 0, w + 0.2, 0.06, d + 0.25, ENV.butter, { part: 'slab', rx: 0.18 });
        for (const e of [-1, 1]) Cy(e * (w / 2 - 0.12), 0.05, d / 2 - 0.1, 0.05, 0.1, CORE.ink2, { rx: Math.PI / 2 });
        break;
      }
      case 'medallion': { // [LVL fix r1] lobby floor medallion: concentric inlay rings + an 8-point star (flat decal)
        const R0 = w / 2;
        // muted inlay tones (value-map floor range): the agents stay the most saturated things in the spawn frame
        const inlay: [number, string][] = [[R0, '#4F4036'], [R0 - 0.08, '#A8835E'], [R0 - 0.16, '#6A5648'], [R0 * 0.55, '#A8835E'], [R0 * 0.55 - 0.05, '#6A5648']];
        inlay.forEach(([r, col], k) => Cy(0, 0.016 + k * 0.002, 0, r, 0.004, col, { j: 0 }));
        for (let k = 0; k < 8; k++) B(0, 0.028, 0, 0.1, 0.004, R0 * (k % 2 ? 0.9 : 1.3), k % 2 ? '#56736F' : '#B08E63', { yaw: (k * Math.PI) / 8, j: 0 });
        Cy(0, 0.03, 0, 0.15, 0.004, CORE.clayDeep, { j: 0 });
        break;
      }
      case 'flowerBox': { // [LVL fix r1] low lobby flower box
        B(0, h / 2, 0, w, h, d, '#8C6D4E');
        for (let k = 0; k < 3; k++) bushAt(0, h - 0.06, (k - 1) * d * 0.3, 0.3);
        for (let k = 0; k < 6; k++) Ba((k % 2 ? 0.1 : -0.1), h + 0.2, (k / 5 - 0.5) * d * 0.8, 0.08, 0.08, 0.08, [ENV.rose, ENV.butter, ENV.lavender][k % 3]);
        break;
      }
      case 'shelf': {
        const sw = w / 1.8;
        for (const e of [-1, 1]) kit.add('shelfSide', L(e * (w / 2 - 0.025), 0.625 * h / 1.25, 0), f.yaw, ENV.walnut, { s: [1, h / 1.25, 1] });
        kit.add('shelfBack', L(0, 0.625 * h / 1.25, -0.185), f.yaw, '#6A452F', { s: [sw, h / 1.25, 1] });
        const nS = Math.max(2, Math.round(h / 0.42));
        for (let k = 0; k < nS; k++) {
          const y = 0.08 + k * ((h - 0.1) / nS);
          kit.add('shelfBoard', L(0, y, 0.02), f.yaw, '#6A452F', { s: [sw, 1, 1] });
          for (let x = -w / 2 + 0.1; x < w / 2 - 0.12;) {
            const v = Math.abs(Math.sin(++seed * 12.9898) * 43758.5453) % 1;
            if (v < 0.1) { x += 0.1; continue; }
            const col = [WORKSPACE[2].hex, ENV.butter, MISC.trim, ENV.teal, WORKSPACE[5].hex, ENV.sage, '#8A6A4C', WORKSPACE[3].hex][Math.floor(v * 8)];
            const hh = Math.min(1.1, (h - 0.1) / nS / 0.3) * (0.75 + v * 0.3);
            kit.add('spine', L(x, y + 0.015 + 0.12 * hh, 0.04), f.yaw, col, { s: [1, hh, 1] });
            x += 0.045 + v * 0.02;
          }
        }
        break;
      }
      case 'rug': case 'mat': case 'queueMat': {
        const col = f.round ? MISC.pitRug : f.color === 'queue' ? '#44605F' : f.color === 'staff' ? '#5E5A52' : f.color === 'entrance' ? '#5B5148' : f.color === 'lobby' ? '#6E5A4C' : MISC.queueMat;
        if (f.round) break; // the Pit floor disc is the rug
        kit.add('rug', L(0, 0.006, 0), f.yaw, col, { s: [w, 1, d], j: 0 });
        break;
      }
      case 'podRug': kit.add('rug', L(0, 0.005, 0), f.yaw, '#5E807B', { s: [w, 1, d], j: 0 }); kit.add('rug', L(0, 0.008, 0), f.yaw, '#6C8D88', { s: [w - 0.2, 1, d - 0.2], j: 0 }); break;
      case 'lampPost': break; // drawn from the lamp anchor
      case 'dais': B(0, h / 2, 0, w, h, d, MISC.queueMat, { part: 'slab' }); break;
      case 'stairs': case 'slide': case 'bigBoard': break; // [STAT M3, cross-owner] the Big Board is STAT's (world/stats/bigBoard.ts): it swivels, so a static box would poke through
      case 'beanbag': Ba(0, 0.2, 0, w, 0.45, d, BEANBAG[seed++ % BEANBAG.length]); break;
      case 'stool': Cy(0, h - 0.03, 0, 0.18, 0.06, ENV.walnut); Cy(0, (h - 0.06) / 2, 0, 0.03, h - 0.06, CORE.ink2); break;
      case 'armchair': B(0, 0.2, 0, w, 0.3, d, c); B(0, 0.5, -d / 2 + 0.1, w, 0.45, 0.18, c); for (const e of [-1, 1]) B(e * (w / 2 - 0.07), 0.38, 0, 0.14, 0.3, d, c); break;
      case 'bench': B(0, h - 0.04, 0, w, 0.08, d, c, { part: 'slab' }); for (const e of [-1, 1]) B(e * (w / 2 - 0.12), (h - 0.08) / 2, 0, 0.08, h - 0.08, d - 0.08, CORE.ink2); break;
      case 'readingTable': case 'gameTable': case 'meetingTable': case 'sortingTable': case 'hotDesk': table(); if (f.type === 'hotDesk') kit.add('keyboard', L(0, h + 0.012, 0.05), f.yaw, MISC.trim); break;
      case 'roundTable': case 'cardTable': case 'cafeTable': table(c, true); if (f.type === 'cardTable') Cy(0, h + 0.005, 0, w / 2 - 0.06, 0.01, '#3C7A4A'); break;
      case 'coffeeTable': table(ENV.walnut); break;
      case 'labBench': B(0, (h - 0.05) / 2, 0, w, h - 0.05, d, '#8FA3A2'); B(0, h - 0.025, 0, w + 0.04, 0.05, d + 0.04, '#DCD8CD', { part: 'slab' }); for (let k = 0; k < 3; k++) Cy(-0.5 + k * 0.4, h + 0.08, 0, 0.05, 0.16, ['#9DB7C2', '#B6C9A0', '#C9B6D6'][k]); break;
      case 'shellBench': B(0, h - 0.03, 0, w, 0.06, d, c, { part: 'slab' }); legs(w, d, h - 0.06, CORE.ink2); kit.add('keyboard', L(0, h + 0.012, 0.12), f.yaw, MISC.trim); { const sd = f.side ?? 1; B(0.3 * sd, h + 0.14, -0.1, 0.36, 0.26, 0.2, '#57534D', { yaw: -0.45 * sd }); } break; // [LVL fix r3] monitor off to one side (f.side, local ±x), angled in: the seated shell's face reads over the bench
      case 'espressoBar': B(0, 0.48, 0, w, 0.96, d, ENV.walnut); B(0, 0.99, 0, w + 0.06, 0.05, d + 0.08, ENV.oak, { part: 'slab' }); B(-1.2, 1.2, -0.1, 0.5, 0.4, 0.35, '#B8B2A6'); B(1.1, 1.08, -0.05, 0.6, 0.14, 0.3, MISC.trim); break;
      case 'piano': B(0, 0.5, 0, w, 0.95, d, CORE.ink2); B(0, 0.72, d / 2 + 0.08, w - 0.1, 0.05, 0.18, MISC.trim, { part: 'slab' }); break;
      case 'recordPlayer': B(0, 0.35, 0, w, 0.7, d, ENV.walnut); Cy(0, 0.72, 0, 0.16, 0.02, CORE.ink); break;
      case 'guitar': Ba(0, 0.3, 0, 0.32, 0.4, 0.1, ENV.oak); B(0, 0.7, 0, 0.05, 0.55, 0.04, ENV.walnut); break;
      case 'treadmill': B(0, 0.08, 0, w, 0.12, d * 0.8, '#57534D'); for (const e of [-1, 1]) B(-w / 2 + 0.1, 0.55, e * (d / 2 - 0.05), 0.05, 1.0, 0.05, CORE.ink2); B(-w / 2 + 0.1, 1.05, 0, 0.1, 0.08, d, CORE.ink2); break;
      case 'dumbbells': B(0, 0.25, 0, w, 0.5, d, '#57534D'); for (let k = 0; k < 4; k++) Ba(-0.35 + k * 0.23, 0.56, 0, 0.14, 0.14, 0.14, CORE.ink2); break;
      case 'yogaMat': kit.add('rug', L(0, 0.01, 0), f.yaw, [ENV.lavender, ENV.sage][seed++ % 2], { s: [w, 1, d], j: 0 }); break;
      case 'planterBox': case 'planter': B(0, h / 2, 0, w, h, d, c); for (let x = -w / 2 + 0.3; x <= w / 2 - 0.2; x += 0.55) bushAt(x, h - 0.05, 0, 0.45); break;
      case 'sunLamp': Cy(0, 0.8, 0, 0.02, 1.6, CORE.ink2); B(0, 1.6, 0.1, 0.35, 0.12, 0.25, ENV.butter); break;
      case 'hangingPlant': Cy(0, 0.45, 0, 0.005, 0.9, CORE.ink2); bushAt(0, -0.2, 0, 0.4); break;
      case 'easel': for (const e of [-1, 1]) B(e * 0.22, 0.7, 0, 0.04, 1.4, 0.04, ENV.oak, { rz: e * 0.12 }); B(0, 0.95, 0.04, 0.55, 0.6, 0.03, MISC.whiteboard); Ba(0.08, 1.0, 0.07, 0.2, 0.16, 0.02, [ENV.butter, ENV.teal, ENV.rose][seed++ % 3]); break;
      case 'hammock': for (const e of [-1, 1]) Cy(e * (w / 2), 0.55, 0, 0.04, 1.1, ENV.walnut); B(0, 0.45, 0, w - 0.2, 0.1, d - 0.1, c); break;
      case 'ramColumn': // [LVL fix r1] a lava-lamp tube (glass-teal body, dark base + cap), not a solid dark pillar (STAT dresses it)
        Cy(0, 1.7, 0, 0.26, 2.9, '#9DB7C2'); B(0, 0.12, 0, 0.7, 0.24, 0.7, CORE.ink2); Cy(0, 3.25, 0, 0.32, 0.3, CORE.ink2); break;
      case 'fishTank': B(0, 0.35, 0, w, 0.7, d, ENV.walnut); B(0, 1.0, 0, w - 0.05, 0.6, d - 0.05, '#7FB0BC'); B(0, 1.32, 0, w, 0.05, d, CORE.ink2, { part: 'slab' }); break;
      case 'stanchion': Cy(0, 0.45, 0, 0.025, 0.9, '#B08A4A'); Cy(0, 0.02, 0, 0.12, 0.04, CORE.ink2); Ba(0, 0.92, 0, 0.07, 0.07, 0.07, '#B08A4A'); break;
      case 'hearth': Cy(0, 0.2, 0, w / 2, 0.4, '#7A6E64'); Cy(0, 0.41, 0, w / 2 - 0.12, 0.04, '#3A302A'); for (let k = 0; k < 5; k++) Ba(Math.cos(k * 1.3) * 0.25, 0.46, Math.sin(k * 1.3) * 0.25, 0.16, 0.1, 0.16, '#C8743C'); break;
      case 'ladder': for (const e of [-1, 1]) B(e * 0.2, h / 2, 0, 0.04, h, 0.04, ENV.oak, { rx: -0.12 }); for (let k = 1; k < 6; k++) B(0, k * h / 6, -0.02 + k * 0.03, 0.4, 0.03, 0.03, ENV.oak); break;
      case 'globe': Cy(0, 0.35, 0, 0.03, 0.7, ENV.walnut); Ba(0, 0.85, 0, 0.4, 0.4, 0.4, ENV.teal); break;
      case 'telescope': for (let k = 0; k < 3; k++) { const a = k * 2.1; B(Math.sin(a) * 0.12, 0.45, Math.cos(a) * 0.12, 0.03, 0.9, 0.03, CORE.ink2, { rx: Math.cos(a) * 0.25, rz: -Math.sin(a) * 0.25 }); } Cy(0, 1.1, -0.05, 0.07, 0.8, '#B08A4A', { rx: -1.0 }); break;
      case 'starChart': B(0, 0, 0, w, h, d, '#2E3548'); for (let k = 0; k < 7; k++) Ba(-0.6 + ((k * 37) % 12) / 10, -0.35 + ((k * 53) % 7) / 10, 0.06, 0.05, 0.05, 0.02, ENV.butter); break;
      case 'bookCart': B(0, 0.45, 0, w, 0.08, d, c, { part: 'slab' }); B(0, 0.12, 0, w, 0.08, d, c, { part: 'slab' }); for (let k = 0; k < 6; k++) B(-0.35 + k * 0.14, 0.62, 0, 0.1, 0.26, 0.3, [WORKSPACE[2].hex, ENV.butter, ENV.teal, MISC.trim][k % 4]); break;
      case 'streetLamp': Cy(0, 1.2, 0, 0.05, 2.4, CORE.ink2); Cy(0, 0.04, 0, 0.18, 0.08, CORE.ink2); break; // lantern from the lamp list
      case 'banner': B(0, 0, 0, w, h, d, WORKSPACE[(layout.bays.find((q) => q.id === f.bay)?.pod ?? 0)].hex, { part: 'slab' }); Cy(0, h / 2 + 0.05, -d / 2, 0.015, 0.1, CORE.ink2); break;
      case 'phoneBooth': B(0, 1.0, -0.15, w, 2.0, 0.08, c); B(0, 1.95, 0, w, 0.1, d, c); for (const e of [-1, 1]) B(e * (w / 2 - 0.03), 1.4, 0, 0.05, 1.1, d, c); B(0, 1.3, -0.08, 0.14, 0.24, 0.06, CORE.ink); break;
      case 'signpost': Cy(0, 1.1, 0, 0.05, 2.2, ENV.walnut); for (let k = 0; k < 3; k++) B(0.25 * (k % 2 ? -1 : 1), 1.5 + k * 0.22, 0, 0.6, 0.14, 0.04, [ENV.butter, ENV.teal, ENV.rose][k], { yaw: k * 0.7 }); break;
      case 'fumeHood': B(0, h / 2, 0, w, h, d, c); B(0, 1.1, d / 2 + 0.01, w - 0.15, 0.6, 0.02, '#8FB9C9'); break;
      case 'testLight': B(0, 0, 0, w, h, d, CORE.ink2); break;
      case 'pigeonholes': B(0, h / 2, 0, w, h, d, c); for (let k = 0; k < 8; k++) B(-1.4 + k * 0.4, 0.5 + (k % 3) * 0.45, d / 2 - 0.05, 0.25, 0.18, 0.1, '#B08A62'); break;
      case 'outboxChute': B(0, h / 2, 0, w, h, d, c); B(0, h - 0.25, d / 2 + 0.01, w * 0.7, 0.2, 0.03, CORE.ink); break;
      case 'capsuleTube': Cy(0, h / 2, 0, w / 2, h, '#9DB7C2'); break;
      case 'parcelStack': B(0, 0.2, 0, 0.7, 0.4, 0.6, c); B(0.05, 0.55, 0, 0.5, 0.3, 0.4, '#C49A70', { yaw: 0.3 }); break;
      case 'drawerWall': B(0, h / 2, 0, w, h, d, c); for (let k = 0; k < 12; k++) B(-w / 2 + 0.35 + k * 0.62, 0.4 + (k % 3) * 0.5, d / 2 + 0.01, 0.4, 0.04, 0.02, CORE.ink2); break;
      case 'microfiche': B(0, 0.35, 0, w, 0.7, d, c); B(0, 0.95, -0.05, 0.7, 0.5, 0.4, '#3A3F48', { rx: -0.2 }); break;
      case 'vaultDoor': Cy(0, 0.8, 0, 0.75, 0.12, '#8E8F8A', { rx: Math.PI / 2 }); Cy(0, 0.8, 0.08, 0.2, 0.06, '#B08A4A', { rx: Math.PI / 2 }); break;
      case 'filingCabinet': case 'mapChest': case 'crates': B(0, h / 2, 0, w, h, d, c); break;
      case 'rackWall': B(0, h / 2, 0, w, h, d, c); for (let k = 0; k < 16; k++) B(-w / 2 + 0.25 + k * (w - 0.5) / 15, h / 2, d / 2 + 0.01, 0.3, h - 0.3, 0.02, '#2E3035'); break;
      case 'hamsterWheel': break; // [STAT M3, cross-owner] the wheel spins: world/stats/hamster.ts builds it (§7.4)
      case 'arcade': B(0, h / 2, 0, w, h, d, c); B(0, 1.15, d / 2 - 0.05, w - 0.15, 0.45, 0.05, '#1F2440', { rx: -0.2 }); B(0, 1.5, d / 2 - 0.02, w - 0.1, 0.16, 0.05, ENV.butter); break;
      // [BRN cross-owner] the net spans the WIDTH at mid-length (the players stand at the two short ends), + a centre line
      case 'pingPong': B(0, h - 0.03, 0, w, 0.05, d, c, { part: 'slab' }); B(0, h + 0.055, 0, w + 0.04, 0.11, 0.015, MISC.trim); B(0, h - 0.003, 0, 0.012, 0.004, d - 0.04, MISC.trim); legs(w, d, h - 0.05, CORE.ink2); break;
      case 'foosball': B(0, 0.6, 0, w, 0.35, d, c); for (let k = 0; k < 4; k++) Cy(-0.4 + k * 0.27, 0.7, 0, 0.015, d + 0.4, '#B8B2A6', { rx: Math.PI / 2 }); for (const e of [-1, 1]) B(e * (w / 2 - 0.1), 0.22, 0, 0.1, 0.44, d - 0.1, CORE.ink2); break;
      case 'bunk': for (const [ex, ez] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B(ex * (w / 2 - 0.04), h / 2, ez * (d / 2 - 0.04), 0.06, h, 0.06, c); for (const y of [0.35, 1.25]) { B(0, y, 0, w - 0.1, 0.1, d - 0.08, ENV.oak, { part: 'slab' }); B(0, y + 0.1, 0, w - 0.2, 0.1, d - 0.16, ['#B9C7D6', '#D6C9B9'][y > 1 ? 1 : 0]); } break;
      default:
        if (addProtoProp(kit, f, st)) break;
        B(0, h / 2, 0, w, h, d, c);
    }
  }
  // queue ropes (burgundy, between the lane stanchions; [LVL fix r2] authored runs from hq.ts, the NE entry stays open)
  {
    const rope = (ax: number, az: number, bx: number, bz: number): void => { const len = Math.hypot(bx - ax, bz - az); kit.add('cyl', [(ax + bx) / 2, 0.82, (az + bz) / 2], Math.atan2(bx - ax, bz - az), '#7A2F3A', { s: [0.03, len, 0.03], rx: Math.PI / 2, j: 0 }); };
    if (layout.queueRopes) for (const r of layout.queueRopes) rope(...r);
    else if (layout.queueLane) {
      const [x0, z0, x1, z1] = layout.queueLane;
      rope(x0, z0, x1, z0); rope(x0, z1, x1 - 1.5, z1); rope(x0, z0, x0, z1); rope(x1, z1, x1, (z0 + z1) / 2 + 0.2);
      rope(x0 + 0.8, (z0 + z1) / 2, x1, (z0 + z1) / 2); // the serpentine divider
    }
  }
  // lamp fixtures from the layout's lamp anchors
  for (const l of layout.lamps) {
    const zc = layout.zoneAt(l.pos.x, l.pos.z, l.pos.y > 3 ? 1 : 0);
    const ceil = l.pos.y > 3 ? 5.5 : (layout.zones.find((z) => z.id === zc)?.ceil ?? 2.8);
    const p = l.pos;
    if (l.kind === 'pendant') {
      const top = zc === 'ATR' || zc === 'PIT' ? 5.5 : ceil;
      kit.add('lampArm', [p.x, (top + p.y + 0.1) / 2 + 0.05, p.z], 0, CORE.ink2, { s: [0.7, (top - p.y - 0.1) / 0.34, 0.7], j: 0 });
      kit.add('drumShade', [p.x, p.y + 0.1, p.z], 0, '#E9DCC0', { s: [1.1, 0.8, 1.1] });
      kit.add('bulb', [p.x, p.y, p.z], 0, '#CFC3AE', { j: 0 });
    } else if (l.kind === 'floor') {
      const fy = layout.floorY(p.x, p.z, p.y > 3 ? 1 : 0);
      kit.add('floorBase', [p.x, fy + 0.02, p.z], 0, CORE.ink2);
      kit.add('pole', [p.x, fy + 0.74, p.z], 0, CORE.ink2);
      kit.add('drumShade', [p.x, fy + 1.48, p.z], 0, '#E9DCC0');
      kit.add('bulb', [p.x, fy + 1.4, p.z], 0, '#CFC3AE', { s: [0.85, 0.85, 0.85], j: 0 });
    } else if (l.kind === 'street') {
      kit.add('ball', [p.x, p.y, p.z], 0, '#F3E3C0', { s: [0.26, 0.3, 0.26], j: 0 });
      kit.add('bulb', [p.x, p.y, p.z], 0, '#CFC3AE', { s: [1.2, 1.2, 1.2], j: 0 });
      kit.add('cyl', [p.x, p.y + 0.2, p.z], 0, CORE.ink2, { s: [0.3, 0.06, 0.3], j: 0 });
    } else if (l.kind === 'desk') {
      kit.add('lampBase', [p.x + 0.5, p.y - 0.42, p.z], 0, CORE.ink2);
      kit.add('lampArm', [p.x + 0.5, p.y - 0.25, p.z + 0.02], 0, CORE.ink2, { rx: 0.25 });
      kit.add('lampShade', [p.x + 0.5, p.y - 0.08, p.z + 0.08], 0, ENV.butter, { rx: 0.5 });
    }
  }
  const kitDraws = kit.build();
  // bushes: merged per region (like the architecture)
  const bushByRegion = new Map<string, THREE.BufferGeometry[]>();
  for (const q of bushGeos) {
    if (!q.boundingBox) q.computeBoundingBox();
    if (q.boundingBox) q.boundingBox.getCenter(tmpC);
    const bc = cellOfGeo(tmpC.x, tmpC.y, tmpC.z);
    const r = (bc === null ? undefined : regionOfCell.get(bc)) ?? 'OUT';
    const list = bushByRegion.get(r) ?? [];
    bushByRegion.set(r, list);
    list.push(q);
  }
  const regionGroups = new Map<string, THREE.Group>();
  const regionGroup = (r: string): THREE.Group => {
    let g = regionGroups.get(r);
    if (!g) { g = new THREE.Group(); g.name = `cell:${r}`; regionGroups.set(r, g); root.add(g); }
    return g;
  };
  for (const [r, geos] of bushByRegion) {
    const m = new THREE.Mesh(mergeAll(geos), getMaterial('foliage', { color: '#FFFFFF', vertexColors: true }));
    m.name = `hq:bushes:${r}`;
    markCaster(m); applyDepthMaterial(m);
    regionGroup(r).add(m);
  }
  // desk monitors: one InstancedMesh of screens, status-driven (deskScreens.ts)
  if (screens.length) {
    const scr = new THREE.InstancedMesh(new THREE.PlaneGeometry(DESK.monitor.w - 0.05, DESK.monitor.h - 0.045), getMaterial('screen', { color: '#2A2D33', emissive: 0.9, code: 1, instanced: true }), screens.length);
    screens.forEach((q, i) => {
      tmpE.set(-0.1, q.yaw, 0, 'YXZ'); tmpQ.setFromEuler(tmpE);
      scr.setMatrixAt(i, tmpM.compose(tmpP.set(q.p.x, q.p.y, q.p.z), tmpQ, tmpS.set(1, 1, 1)));
      scr.setColorAt(i, new THREE.Color(STATUS.working));
    });
    scr.name = 'kit:screens';
    registerDeskScreens(scr, screens.map((q) => q.anchor));
    root.add(scr);
  }

  // ------------------------------------------------------------ merge the architecture
  const ceilings: THREE.Mesh[] = [];
  for (const [k, geos] of arch) {
    const [group = '', region = '', key = ''] = k.split('@');
    const g = mergeAll(geos);
    const mesh = new THREE.Mesh(g, matOf(key));
    mesh.name = `arch:${group}:${region}:${key}`;
    mesh.receiveShadow = key !== 'sky';
    if (group === 'ceil' || group === 'cap') ceilings.push(mesh);
    regionGroup(region).add(mesh);
  }
  if (glassGeos.length && !envSkip?.arch) { // [ENV M1.75, cross-owner] glass: architecture.ts
    const g = new THREE.Mesh(mergeAll(glassGeos), matOf('glass|#DDEBF2'));
    g.name = 'hq:glass';
    root.add(g);
  }

  // ------------------------------------------------------------ `?greybox` density overlay (§7.1, M1.5)
  let density: ReturnType<typeof emptyPatches> = [];
  if (flat) {
    const nav = createNav(layout);
    density = [0, 1].flatMap((level) => emptyPatches(layout, nav, { level }));
    const mat = getMaterial('toonEnv', { color: '#C8483C' }); // debug overlay only
    for (const q of density) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(q.side, q.side).rotateX(-Math.PI / 2), mat);
      m.position.set(q.x, (q.level ? 2.9 : layout.floorY(q.x, q.z, 0)) + 0.03, q.z);
      m.name = 'hq:densityPatch';
      root.add(m);
    }
  }

  root.traverse((m) => { if (m !== root) { m.matrixAutoUpdate = false; m.updateMatrix(); } }); // static world (perf note, M1 review)
  ctx.scene.add(root);
  root.updateMatrixWorld(true);
  // vis cell → its region's group (§5.4 `cells`); the kit's instances are culled per cell by compaction (createKit)
  const cells = new Map<string, THREE.Object3D>(layout.visCells.map((c2) => [c2.id, regionGroup(c2.region)]));
  const visOf = new Map(layout.visCells.map((c2) => [c2.id, new Set(c2.visible ?? layout.visCells.map((q) => q.id))]));
  let visCell: string | null | undefined, visCam: { x: number; z: number } | null = null, visStats: { cell: string | null; regions: number; instances: number; of: number } = { cell: null, regions: 0, instances: 0, of: 0 };
  /** Apply the camera cell's visible set: region groups on/off, kit compaction (+ small-prop draw distance). */
  const applyVis = (cam: THREE.Vector3): void => {
    const cell = cellAt(layout, cam.x, cam.y, cam.z);
    const moved = !visCam || Math.hypot(cam.x - visCam.x, cam.z - visCam.z) > 1.5;
    if (cell === visCell && !moved) return;
    const set = cell ? visOf.get(cell) ?? null : null;
    if (cell !== visCell) {
      let on = 0;
      for (const [r, g] of regionGroups) {
        const vis = r === 'OUT' || !set || layout.visCells.some((c2) => c2.region === r && set.has(c2.id));
        g.visible = vis; on += vis ? 1 : 0;
      }
      visStats.regions = on;
      ctx.visibleCells = set; // actors / stats objects outside the set may skip work (§5.3)
    }
    visCell = cell; visCam = { x: cam.x, z: cam.z };
    const k = kit.cull(set, cam.y > 6.2 ? null : visCam);
    visStats = { ...visStats, cell, instances: k.shown, of: k.total };
  };
  const anchors = Object.fromEntries((layout.anchors ?? []).map((a) => [a.id, { pos: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), yaw: a.yaw ?? 0 }]));
  let ceilOn = true, bayVer = -1, bayT = 0;
  return {
    cells,
    anchors,
    root,
    stats: () => ({ kitDraws, children: root.children.length, vis: visStats, density: density.map((q) => ({ zone: q.zone, side: q.side })) }),
    update(c2?: WorldUpdateCtx) {
      // live bay signs (§7.2): director bay state, on a version bump or once a second (labels arrive with entities)
      const dir = c2?.director ?? ctx.director;
      if (dir?.bayState) {
        const v = dir.version?.() ?? 0, now = performance.now();
        if (v !== bayVer || now - bayT > 1000) { bayVer = v; bayT = now; baySigns.set(dir.bayState()); }
      }
      const cam = c2?.camera?.position ?? ctx.camera?.position;
      if (cam) applyVis(cam);
      // diorama view from above (the `plan` pose): lift the lid
      const camY = cam?.y ?? 0;
      const want = camY < 6.2;
      if (want !== ceilOn) { ceilOn = want; for (const m of ceilings) m.visible = want; }
    },
    dispose() { ctx.scene.remove(root); },
  };
}

/**
 * The M1 furniture kit parts (proto room; hq reuses them for desks, chairs, sofas, counters, shelves, plants, lamps).
 * `far` (m, [LVL fix r1]): draw distance of small story parts in the hq (a 4 cm spine at 14 m is ~3 px); the proto room
 * never culls.
 */
function defineProtoKit(kit: Kit): void {
  kit.def('deskTop', rbox(DESK.w, 0.05, DESK.d, 0.02), { caster: true, pattern: 'wood' });
  kit.def('deskLeg', rbox(0.06, DESK.h - 0.05, 0.06, 0.02), { far: 22 });
  kit.def('pedestal', rbox(0.34, 0.4, DESK.d - 0.1, 0.03), { caster: true });
  kit.def('handle', rbox(0.12, 0.02, 0.02, 0.008), { far: 12 });
  kit.def('monitor', rbox(DESK.monitor.w, DESK.monitor.h, 0.06, 0.03)); // chunky toy monitor (proto.ts DESK.monitor)
  kit.def('stand', cyl(0.025, 0.03, 0.1, 10), { far: 18 });
  kit.def('standFoot', rbox(0.18, 0.02, 0.12, 0.01), { far: 16 });
  kit.def('keyboard', rbox(0.36, 0.022, 0.12, 0.01), { far: 16 });
  kit.def('keycaps', rbox(0.32, 0.01, 0.09, 0.004), { far: 12 });
  kit.def('mug', cyl(0.035, 0.03, 0.08, 14), { far: 14 });
  kit.def('note', rbox(0.07, 0.07, 0.004, 0.002), { far: 12 });
  kit.def('book', rbox(0.2, 0.035, 0.14, 0.008), { far: 16 });
  kit.def('seat', rbox(0.46, 0.08, 0.44, 0.04), { caster: true, pattern: 'fabric' });
  kit.def('back', rbox(0.42, DESK.back.h, DESK.back.t, 0.022), { caster: true, pattern: 'fabric' });
  kit.def('chairPost', cyl(0.025, 0.025, 0.24, 8), { far: 22 });
  kit.def('chairBase', cyl(0.2, 0.22, 0.04, 16), { far: 22 });
  kit.def('lampBase', cyl(0.08, 0.09, 0.03, 16), { far: 18 });
  kit.def('lampArm', cyl(0.012, 0.012, 0.34, 8));
  kit.def('lampShade', cyl(0.05, 0.1, 0.1, 18), { far: 20 });
  kit.def('pole', cyl(0.018, 0.018, 1.42, 10));
  // [RND fix r1] lit fabric shades glow after dark (emissive only as the lamps come on, blooms slightly at night) and
  // never cast: a thin shade's soft key shadow read as a dirty smear on the cream wall behind each floor lamp
  kit.def('drumShade', cyl(0.2, 0.24, 0.26, 24), { pattern: 'fabric', emissive: '#FFD39A', emissiveIntensity: 0.8, emissiveDay: 0 });
  kit.def('floorBase', cyl(0.16, 0.18, 0.04, 20));
  kit.def('sofaBase', rbox(2.4, 0.26, 0.85, 0.07), { caster: true, pattern: 'fabric' });
  kit.def('sofaCushion', rbox(0.76, 0.14, 0.66, 0.06), { pattern: 'fabric' });
  kit.def('sofaBack', rbox(2.3, 0.44, 0.2, 0.09), { caster: true, pattern: 'fabric' });
  kit.def('sofaArm', rbox(0.18, 0.42, 0.85, 0.08), { pattern: 'fabric' });
  kit.def('pillow', rbox(0.34, 0.3, 0.1, 0.05), { far: 24 });
  kit.def('tableTop', rbox(0.7, 0.05, 1.2, 0.025), { caster: true, pattern: 'wood' });
  kit.def('tableLeg', cyl(0.025, 0.02, 0.26, 8));
  kit.def('rug', rbox(1, 0.012, 1, 0.006));
  kit.def('counterBody', rbox(2.0, 0.84, 0.56, 0.05), { caster: true, pattern: 'wood' });
  kit.def('counterTop', rbox(2.12, 0.06, 0.66, 0.025), { pattern: 'wood' });
  kit.def('counterStripe', rbox(2.02, 0.06, 0.02, 0.01));
  kit.def('bell', new THREE.SphereGeometry(0.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), { far: 12 });
  kit.def('pot', cyl(0.2, 0.15, 0.32, 18));
  kit.def('potSmall', cyl(0.14, 0.11, 0.22, 16));
  kit.def('shelfSide', rbox(0.05, 1.25, 0.4, 0.015), { caster: true, pattern: 'wood' });
  kit.def('shelfBack', rbox(1.8, 1.25, 0.03, 0.01), { pattern: 'wood' });
  kit.def('shelfBoard', rbox(1.7, 0.03, 0.34, 0.01));
  kit.def('spine', new THREE.BoxGeometry(0.04, 0.24, 0.26)); // [LVL fix r1] 673 spines × 12 tris (was 300 each: 202k); never culled by distance: the shelves' colour reads across the atrium
  kit.def('coolerBody', rbox(0.36, 0.8, 0.36, 0.05), { caster: true });
  kit.def('coolerBottle', cyl(0.14, 0.14, 0.32, 18));
  kit.def('boardFrame', rbox(2.06, 1.06, 0.04, 0.02));
  kit.def('boardFace', rbox(1.96, 0.96, 0.012, 0.005));
  kit.def('posterFrame', rbox(0.74, 0.96, 0.03, 0.012));
  kit.def('posterShape', rbox(0.2, 0.2, 0.01, 0.004), { far: 14 });
  kit.def('posterDot', cyl(0.12, 0.12, 0.01, 24), { far: 14 });
  kit.def('clockFace', cyl(0.24, 0.24, 0.04, 32));
  kit.def('clockRim', new THREE.TorusGeometry(0.24, 0.025, 8, 36));
  kit.def('shelfPlant', new THREE.SphereGeometry(0.12, 16, 12), { far: 20 });
  kit.def('bulb', new THREE.SphereGeometry(0.06, 10, 7), { emissive: '#FFE2B0', emissiveIntensity: 1.8, emissiveDay: 0.6 }); // §5.0 bulbs 1.8 (night; [RND fix r1] ×0.6 by day)
  kit.def('dome', new THREE.SphereGeometry(0.09, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2));
  kit.def('hand', new THREE.BoxGeometry(1, 1, 0.008).translate(0, 0.5, 0));
}

/**
 * Adds one piece of proto-kit furniture; returns false for types it does not know.
 */
function addProtoProp(kit: Kit, f: Furniture, st: ProtoState): boolean {
  const C = st.C ?? PROTO_COLORS;
  const L = place(f);
  switch (f.type) {
    case 'desk': {
      const top = DESK.h;
      kit.add('deskTop', L(0, top - 0.025, 0), f.yaw, C.desk);
      // agent sits on local +z (yaw 0: agent south of desk facing north → desk local +z = toward agent)
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1]]) kit.add('deskLeg', L(sx * (DESK.w / 2 - 0.06), (top - 0.05) / 2, sz * (DESK.d / 2 - 0.06)), f.yaw, C.deskLeg);
      // P1 sightline: low toy monitor in front of an off-centre agent (proto.ts DESK / deskLocal); the pedestal
      // goes under the other end of the desk.
      const { m, monitor: mon, agentX: ax } = deskLocal(f);
      const mx = mon.x, tw = mon.twist;
      kit.add('pedestal', L(m * (DESK.w / 2 - 0.2), top - 0.25, 0), f.yaw, C.desk, { j: 0.06 });
      kit.add('handle', L(m * (DESK.w / 2 - 0.2), top - 0.12, DESK.d / 2 - 0.035), f.yaw, CORE.ink2);
      kit.add('handle', L(m * (DESK.w / 2 - 0.2), top - 0.28, DESK.d / 2 - 0.035), f.yaw, CORE.ink2);
      kit.add('standFoot', L(mx, top + 0.01, mon.z + 0.02), f.yaw + tw, CORE.ink2);
      kit.add('stand', L(mx, top + 0.02, mon.z), f.yaw + tw, CORE.ink2, { s: [1.4, 0.3, 1.4] });
      kit.add('monitor', L(mx, mon.y, mon.z), f.yaw + tw, CORE.ink2, { rx: -0.1 });
      st.screens.push({ p: L(mx + Math.sin(tw) * 0.032, mon.y, mon.z + Math.cos(tw) * 0.032), yaw: f.yaw + tw, n: st.deskN, anchor: f.id });
      kit.add('keyboard', L(ax + m * 0.06, top + 0.011, 0.12), f.yaw + tw * 0.4, MISC.trim);
      kit.add('keycaps', L(ax + m * 0.06, top + 0.026, 0.12), f.yaw + tw * 0.4, '#CFC4B2');
      // story props: mugs, sticky notes, books (seeded per desk)
      const r = (k: number): number => { const v = Math.sin((st.deskN + 1) * 91.7 + k * 13.1) * 43758.5; return v - Math.floor(v); };
      if (r(1) > 0.35) kit.add('mug', L(m * 0.2, top + 0.04, 0.1), f.yaw, [ENV.teal, MISC.trim, ENV.butter, ENV.sage][Math.floor(r(2) * 4)]);
      if (r(3) > 0.3) kit.add('note', L(mx + 0.16 * (r(4) - 0.5), mon.y + DESK.monitor.h / 2 - 0.01, mon.z + 0.035), f.yaw + tw + (r(5) - 0.5) * 0.2, [ENV.butter, ENV.rose, ENV.sage, ENV.lavender][Math.floor(r(6) * 4)]);
      if (r(7) > 0.5) { kit.add('book', L(m * 0.36, top + 0.018, -0.14), f.yaw + 0.2, WORKSPACE[Math.floor(r(8) * 8)].hex); kit.add('book', L(m * 0.36, top + 0.053, -0.14), f.yaw - 0.1, [ENV.sage, ENV.oak, MISC.trim][Math.floor(r(9) * 3)]); }
      st.deskN++;
      break;
    }
    case 'chair': {
      const fabric = [ENV.tealDeep, '#4E6E6E', ENV.moss][st.deskN % 3];
      kit.add('chairBase', L(0, 0.02, 0), f.yaw, '#6B6760');
      kit.add('chairPost', L(0, 0.16, 0), f.yaw, '#8A857C');
      kit.add('seat', L(0, 0.3, 0), f.yaw, fabric);
      // low back: top at ≈ seat + 0.2 (DESK.chairBack) so the seated agent's head and shoulders read from behind;
      // [LVL fix r3] thin, hung off the seat's rear edge and reclined (+rx tips the top away from the sitter) so
      // the seated body clears it (DESK.back / sitForward)
      const bk = DESK.back;
      kit.add('back', L(0, DESK.chairBack - bk.h / 2 - 0.005, bk.z), f.yaw, fabric, { rx: bk.recline });
      kit.add('chairPost', L(0, 0.3, bk.z - 0.005), f.yaw, '#8A857C', { s: [0.8, 0.5, 0.8] }); // strut (same part: no extra draw)
      break;
    }
    case 'deskLamp': {
      kit.add('lampBase', L(0, 0.015, 0), f.yaw, CORE.ink2);
      kit.add('lampArm', L(0, 0.19, 0.02), f.yaw, CORE.ink2, { rx: 0.25 });
      kit.add('lampShade', L(0, 0.36, 0.08), f.yaw, ENV.butter, { rx: 0.5 });
      kit.add('bulb', L(0, 0.33, 0.1), 0, '#CFC3AE', { s: [0.5, 0.5, 0.5], j: 0 });
      break;
    }
    case 'sofa': {
      kit.add('sofaBase', L(0, 0.13, 0), f.yaw, C.sofa);
      for (let i = -1; i <= 1; i++) kit.add('sofaCushion', L(i * 0.76, 0.33, 0.06), f.yaw, C.sofa, { j: 0.05 });
      kit.add('sofaBack', L(0, 0.48, -0.33), f.yaw, C.sofa, { rx: -0.1 });
      kit.add('sofaArm', L(-1.2, 0.21, 0), f.yaw, C.sofa); kit.add('sofaArm', L(1.2, 0.21, 0), f.yaw, C.sofa);
      kit.add('pillow', L(-0.85, 0.52, -0.16), f.yaw + 0.25, ENV.rose, { rx: -0.2 });
      kit.add('pillow', L(0.9, 0.52, -0.16), f.yaw - 0.2, ENV.butter, { rx: -0.2 });
      break;
    }
    case 'coffeeTable': {
      kit.add('tableTop', L(0, 0.3, 0), f.yaw, ENV.walnut);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) kit.add('tableLeg', L(sx * 0.27, 0.14, sz * 0.52), f.yaw, ENV.walnut);
      kit.add('mug', L(0.1, 0.365, -0.25), f.yaw, ENV.teal);
      kit.add('book', L(-0.08, 0.34, 0.25), f.yaw + 0.4, WORKSPACE[3].hex);
      kit.add('book', L(-0.06, 0.375, 0.25), f.yaw + 0.1, ENV.butter);
      break;
    }
    case 'podRug': {
      kit.add('rug', L(0, 0.004, 0), f.yaw, '#587A75', { s: [f.size[0], 1, f.size[2]], j: 0 });
      kit.add('rug', L(0, 0.007, 0), f.yaw, '#6C8D88', { s: [f.size[0] - 0.16, 1, f.size[2] - 0.16], j: 0 });
      kit.add('rug', L(0, 0.010, 0), f.yaw, '#5E807B', { s: [f.size[0] - 0.3, 1, f.size[2] - 0.3], j: 0 });
      break;
    }
    case 'rug': {
      kit.add('rug', L(0, 0.006, 0), f.yaw, C.rug, { s: [f.size[0], 1, f.size[2]], j: 0 });
      kit.add('rug', L(0, 0.009, 0), f.yaw, '#3E706A', { s: [f.size[0] - 0.36, 1, f.size[2] - 0.36], j: 0 });
      kit.add('rug', L(0, 0.012, 0), f.yaw, C.rug, { s: [f.size[0] - 0.5, 1, f.size[2] - 0.5], j: 0 });
      break;
    }
    case 'floorLamp': {
      kit.add('floorBase', L(0, 0.02, 0), f.yaw, CORE.ink2);
      kit.add('pole', L(0, 0.74, 0), f.yaw, CORE.ink2);
      kit.add('drumShade', L(0, 1.48, 0), f.yaw, '#E9DCC0');
      kit.add('bulb', L(0, 1.4, 0), 0, '#CFC3AE', { s: [0.85, 0.85, 0.85], j: 0 });
      break;
    }
    case 'counter': {
      kit.add('counterBody', L(0, 0.42, 0), f.yaw, C.counter);
      kit.add('counterTop', L(0, 0.87, 0), f.yaw, ENV.oak);
      kit.add('counterStripe', L(0, 0.62, 0.285), f.yaw, ENV.butter, { j: 0 });
      kit.add('bell', L(0.55, 0.9, 0.1), f.yaw, ENV.butter);
      kit.add('book', L(-0.5, 0.918, 0.05), f.yaw + 0.3, MISC.trim);
      kit.add('mug', L(-0.72, 0.94, -0.12), f.yaw, ENV.rose);
      // "HELP" lightbox sign on a post above the counter (≤ 0.95, never blooms)
      // (a count-1 InstancedMesh so it shares the monitors' screen program)
      const sign = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.24), getMaterial('screen', { color: '#FFFFFF', emissive: 0.85, instanced: true, strip: null, uniforms: {} }), 1);
      Object.assign(sign.material, { map: signTexture('HELP DESK') });
      const sp = L(0, 1.45, 0.05);
      tmpE.set(0, f.yaw, 0, 'YXZ'); tmpQ.setFromEuler(tmpE);
      sign.setMatrixAt(0, tmpM.compose(tmpP.set(sp.x, sp.y, sp.z), tmpQ, tmpS.set(1, 1, 1)));
      sign.setColorAt(0, new THREE.Color('#FFFFFF'));
      st.root.add(sign);
      break;
    }
    case 'beacon': {
      // dome (non-emissive until FX lights it for blocked agents)
      kit.add('dome', L(0, 0, 0), 0, '#8C3A34', { j: 0 });
      break;
    }
    case 'plant': case 'plantSmall': {
      const small = f.type === 'plantSmall';
      kit.add(small ? 'potSmall' : 'pot', L(0, small ? 0.11 : 0.16, 0), 0, small ? ENV.sage : ENV.walnut);
      if (st.bushGeos) st.bushGeos.push(bushGeometry(L(0, small ? 0.22 : 0.3, 0), (small ? 0.55 : 1.0) * (f.size[1] / (small ? 0.7 : 1.1)) ** 0.5, st.deskN++, 2));
      else st.dynamic.push(bush(st.root, L(0, small ? 0.22 : 0.3, 0), small ? 0.55 : 1.0, st.deskN++));
      break;
    }
    case 'shelf': {
      for (const e of [-0.875, 0.875]) kit.add('shelfSide', L(e, 0.625, 0), f.yaw, ENV.walnut);
      kit.add('shelfBack', L(0, 0.625, -0.185), f.yaw, '#6A452F');
      kit.add('shelfBoard', L(0, 1.235, 0.0), f.yaw, ENV.walnut, { s: [1.06, 1, 1.18] });
      for (let k = 0; k < 3; k++) {
        const y = 0.08 + k * 0.4;
        kit.add('shelfBoard', L(0, y, 0.02), f.yaw, '#6A452F');
        let x = -0.78;
        let s = k * 7;
        while (x < 0.7) {
          const v = Math.abs(Math.sin(++s * 12.9898) * 43758.5453) % 1;
          if (v < 0.12 && x > -0.5) { x += 0.12; continue; }
          const col = [WORKSPACE[2].hex, ENV.butter, MISC.trim, ENV.teal, WORKSPACE[5].hex, ENV.sage, '#8A6A4C', WORKSPACE[3].hex][Math.floor(v * 8)];
          const hh = 0.75 + v * 0.3;
          kit.add('spine', L(x, y + 0.015 + 0.12 * hh, 0.04), f.yaw, col, { s: [1, hh, 1], rz: v > 0.9 ? 0.25 : 0 });
          x += 0.045 + v * 0.02;
        }
      }
      kit.add('shelfPlant', L(0.62, 1.34, 0.02), 0, ENV.moss, { s: [1.2, 0.9, 1.2] });
      kit.add('potSmall', L(0.62, 1.3, 0.02), 0, MISC.trim, { s: [0.6, 0.5, 0.6] });
      break;
    }
    case 'cooler': {
      kit.add('coolerBody', L(0, 0.4, 0), f.yaw, MISC.trim);
      kit.add('coolerBottle', L(0, 0.96, 0), f.yaw, '#8FB9C9', { j: 0 });
      kit.add('handle', L(0.0, 0.62, 0.19), f.yaw, STATUS.working, { j: 0 });
      break;
    }
    case 'whiteboard': {
      kit.add('boardFrame', L(0, 0.55, 0.13), f.yaw, '#9C968C');
      kit.add('boardFace', L(0, 0.55, 0.155), f.yaw, MISC.whiteboard, { j: 0 });
      const notes = [ENV.butter, ENV.rose, ENV.sage, ENV.butter, ENV.lavender, ENV.sage, ENV.rose];
      notes.forEach((c, i) => kit.add('note', L(-0.8 + i * 0.26, 0.55 + ((i * 37) % 3 - 1) * 0.22, 0.165), f.yaw + ((i % 3) - 1) * 0.08, c, { s: [1.5, 1.5, 1] }));
      break;
    }
    default: return false;
  }
  return true;
}

/** A rounded blob bush (ART §3.3): merged smooth spheres, vertex-colour gradient moss→sage by height, gentle sway. */
function bush(root: THREE.Group, p: Vec, scale: number, seed: number): THREE.Mesh {
  const m = new THREE.Mesh(bushGeometry({ x: 0, y: 0, z: 0 }, scale, seed), getMaterial('foliage', { color: '#FFFFFF', vertexColors: true }));
  m.position.set(p.x, p.y, p.z);
  markCaster(m);
  applyDepthMaterial(m);
  root.add(m);
  return m;
}

/** Bush geometry at world point p (vertex colours by height above p). hq merges all of them into one mesh. */
function bushGeometry(p: Vec, scale: number, seed: number, detail = 3): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const rnd = (k: number): number => { const v = Math.sin((seed + 1) * 78.233 + k * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(i) * 0.6;
    const rr = 0.16 + rnd(i + 9) * 0.08;
    const g = new THREE.IcosahedronGeometry((0.2 + rnd(i + 3) * 0.08) * scale, detail);
    g.translate(Math.cos(a) * rr * scale, (0.28 + rnd(i + 5) * 0.35) * scale, Math.sin(a) * rr * scale);
    geos.push(g);
  }
  const top = new THREE.IcosahedronGeometry(0.24 * scale, detail).translate(0, 0.62 * scale, 0);
  geos.push(top);
  const g = mergeAll(geos);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const lo = new THREE.Color(ENV.moss), hi = new THREE.Color(ENV.sage), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / (0.9 * scale)));
    c.copy(lo).lerp(hi, t * 0.8);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.translate(p.x, p.y, p.z);
}
