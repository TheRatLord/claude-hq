/**
 * Structures toolkit: a tiny "geometry builder" that accumulates primitives with transforms and vertex colours and
 * merges them into one faceted mesh per material kind, plus canvas-texture helpers for plaques and signs.
 *
 * Kinds: 'solid' (toon, vertex coloured) and 'glow' (unlit, vertex coloured; windows, lamp heads, lantern glass —
 * dim by day, bright at night). Meshes a Kit emits are tagged `userData.bake = kind`; the structures system bakes
 * every tagged mesh of every structure into a few per-cluster meshes (a handful of draw calls for the whole package).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAL } from '../toon.ts';
import { SURF, chainShader, surfaceMaterial, tagSurface, tagSurfaceBy } from '../surface/index.ts';
import type { SurfAxis, SurfName, TagOpts } from '../surface/index.ts';

export type BakeKind = 'solid' | 'glow';

/**
 * Surfaces (hand-painted detail, see scene/surface). Every solid part carries a `surface` tag and a pattern frame
 * (`surfQ`, the part's rotation): patterns are painted in the part's own local space, so boards follow a rotated
 * roof slab or a leaning beam, and stay put when the structure is yawed and baked into world-space cluster meshes.
 *
 * What a part gets: the innermost `k.surf(spec, fn)` scope, else an automatic pick from its paint colour and shape
 * (`autoSurface`): wood → planks (boards along its longest side) or, for slender parts, `logs` grain along the
 * part; bark/trunk → logs with bark; stone → fieldstone (rock when small); metals → metal; hay, cloth, plaster, snow.
 * Axis `'long'` = the part's longest local dimension (a cylinder's own axis for planks: barrel staves).
 */
export type KitAxis = SurfAxis | 'long';
export type KitTag = Omit<TagOpts, 'axis'> & { axis?: KitAxis };
export type SurfSpec = SurfName | readonly [SurfName, KitTag];

/** Transform shorthand: position, Euler rotation (XYZ order, radians), scale (uniform or per axis). */
export interface Xf { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; s?: number | readonly [number, number, number] }

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function xfMatrix(t: Xf | undefined, out = new THREE.Matrix4()): THREE.Matrix4 {
  if (!t) return out.identity();
  _e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  const s = t.s ?? 1;
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return out.compose(_p, _q, _s);
}

/** Deterministic PRNG. */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

/** Accumulates primitives; `build()` merges them into one mesh per kind. */
export class Kit {
  private parts: Record<BakeKind, THREE.BufferGeometry[]> = { solid: [], glow: [] };
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  readonly r: () => number;
  /** default lightness jitter per part (hand-painted variety) */
  jitter = 0.035;
  constructor(seed = 1) { this.r = rng(seed); }

  push(t: Xf): this { this.stack.push(this.top().clone().multiply(xfMatrix(t, _m))); return this; }
  pop(): this { if (this.stack.length > 1) this.stack.pop(); return this; }
  /** run fn inside a local transform */
  at(t: Xf, fn: () => void): this { this.push(t); try { fn(); } finally { this.pop(); } return this; }
  private top(): THREE.Matrix4 { return this.stack[this.stack.length - 1]; }

  /** Add any geometry (consumed). `pre` places the geometry inside the part (its pattern frame follows). */
  add(geo: THREE.BufferGeometry, color: number, t?: Xf, kind: BakeKind = 'solid', jitter = this.jitter, pre?: THREE.Matrix4): this {
    const cyl = geo.type === 'CylinderGeometry' || geo.type === 'ConeGeometry';
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'surface') g.deleteAttribute(k);
    const m = xfMatrix(t, _m).premultiply(this.top());
    if (pre) m.multiply(pre);
    if (kind === 'solid') {
      if (!g.attributes.surface) this.tag(g, color, cyl);
      m.decompose(_p, _q, _s);
      const n = g.attributes.position.count, fq = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { fq[i * 4] = _q.x; fq[i * 4 + 1] = _q.y; fq[i * 4 + 2] = _q.z; fq[i * 4 + 3] = _q.w; }
      g.setAttribute('surfQ', new THREE.BufferAttribute(fq, 4));
    } else g.deleteAttribute('surface');
    g.applyMatrix4(m);
    _c.setHex(color);
    if (jitter) { const d = (this.r() - 0.5) * 2 * jitter; _c.offsetHSL(0, 0, d); }
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts[kind].push(g);
    return this;
  }

  private surfStack: (SurfSpec | null)[] = [];
  /** paint every part added inside fn with this surface (null = back to the automatic pick) */
  surf(spec: SurfSpec | null, fn: () => void): this { this.surfStack.push(spec); try { fn(); } finally { this.surfStack.pop(); } return this; }

  /** tag a part (its own local space) from the current scope or its colour */
  private tag(g: THREE.BufferGeometry, color: number, cyl: boolean): void {
    const scoped = this.surfStack.length ? this.surfStack[this.surfStack.length - 1] : null;
    g.computeBoundingBox();
    const bb = g.boundingBox!, size = bb.getSize(_d);
    const spec = scoped ?? autoSurface(color, size, cyl);
    const [name, tg] = typeof spec === 'string' ? [spec, {} as KitTag] : spec;
    let axis = tg.axis;
    if (axis === 'long') axis = cyl ? 'y' : longest(size);
    tagSurface(g, SURF[name], { ...tg, axis });
  }

  box(w: number, h: number, d: number, color: number, t?: Xf, kind?: BakeKind): this { return this.add(new THREE.BoxGeometry(w, h, d), color, t, kind); }
  /**
   * A roof slab (box w × th × len, local y = up out of the roof, z = down the slope): `top` on the upper face and the
   * edges (rows level across the slope), `under` (default: ceiling boards) on the underside.
   */
  slab(w: number, th: number, len: number, color: number, top: SurfSpec, t?: Xf, under: SurfSpec = ['planks', { axis: 'z', variant: 1, strength: 0.7 }]): this {
    const g = new THREE.BoxGeometry(w, th, len).toNonIndexed();
    const spec = (s: SurfSpec): [SurfName, TagOpts] => { const [n, tg] = typeof s === 'string' ? [s, {} as KitTag] : s; return [n, { ...tg, axis: tg.axis === 'long' ? 'z' : tg.axis ?? 'z' }]; };
    const a = spec(top), b = spec(under);
    tagSurfaceBy(g, (n) => (n.y < -0.5 ? b : a));
    return this.add(g, color, t);
  }
  /** cylinder (seg sides) centred on its axis midpoint; rTop defaults to r */
  cyl(r: number, h: number, color: number, t?: Xf, seg = 8, rTop = r, kind?: BakeKind): this {
    return this.add(new THREE.CylinderGeometry(rTop, r, h, seg, 1), color, t, kind);
  }
  cone(r: number, h: number, color: number, t?: Xf, seg = 8, kind?: BakeKind): this { return this.add(new THREE.ConeGeometry(r, h, seg, 1), color, t, kind); }
  ball(r: number, color: number, t?: Xf, detail = 0, kind?: BakeKind): this { return this.add(new THREE.IcosahedronGeometry(r, detail), color, t, kind); }
  /** low-poly sphere with flat bottom-ish look (dodecahedron) */
  blob(r: number, color: number, t?: Xf, kind?: BakeKind): this { return this.add(new THREE.DodecahedronGeometry(r, 0), color, t, kind); }
  /** extrude a 2D profile (x, y) along local z by depth, centred */
  prism(profile: readonly (readonly [number, number])[], depth: number, color: number, t?: Xf, kind?: BakeKind): this {
    const sh = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return this.add(g, color, t, kind);
  }
  /** a square beam from a to b (local coordinates), thickness th (width, height) */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, th: number, color: number, kind?: BakeKind, th2 = th): this {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    const len = _d.subVectors(_b, _a).length();
    const g = new THREE.BoxGeometry(th, len, th2);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _d.normalize());
    const m = new THREE.Matrix4().compose(_a.add(_b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, color, undefined, kind, this.jitter, m);
  }
  /** round beam (rope, pipe) from a to b */
  rod(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color: number, seg = 5, kind?: BakeKind): this {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    const len = _d.subVectors(_b, _a).length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _d.normalize());
    return this.add(g, color, undefined, kind, this.jitter, new THREE.Matrix4().compose(_a.add(_b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  }

  empty(kind: BakeKind = 'solid'): boolean { return this.parts[kind].length === 0; }

  /** merged, faceted geometry for one kind (null if empty) */
  geometry(kind: BakeKind = 'solid'): THREE.BufferGeometry | null {
    const ps = this.parts[kind];
    if (!ps.length) return null;
    const g = ps.length === 1 ? ps[0] : mergeGeometries(ps, false);
    if (!g) return null;
    for (const p of ps) if (p !== g) p.dispose();
    this.parts[kind] = [];
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** emit meshes into `into` (or a new group), tagged for baking */
  build(into: THREE.Object3D = new THREE.Group(), glowNight = 0): THREE.Object3D {
    const s = this.geometry('solid');
    if (s) { const m = new THREE.Mesh(s, solidMat()); m.userData.bake = 'solid'; m.castShadow = true; m.receiveShadow = true; into.add(m); }
    const g = this.geometry('glow');
    if (g) { const m = new THREE.Mesh(g, glowMat(glowNight)); m.userData.bake = 'glow'; into.add(m); }
    return into;
  }

  /** one plain mesh of all kinds merged as solid (for animated parts) */
  mesh(mat?: THREE.Material): THREE.Mesh {
    const g = this.geometry('solid') ?? new THREE.BufferGeometry();
    const m = new THREE.Mesh(g, mat ?? solidMat());
    m.castShadow = true;
    return m;
  }
}

/**
 * The shared solid material: toon + surfaces, with the patterns read in each part's own frame (`surfQ`).
 */
let solid: THREE.MeshToonMaterial | null = null;
const USED: SurfName[] = ['planks', 'logs', 'bark', 'shingle', 'tile', 'brick', 'fieldstone', 'plaster', 'metal', 'fabric', 'hay', 'rock', 'snow', 'thatch'];
export function solidMat(): THREE.MeshToonMaterial {
  if (solid) return solid;
  const m = surfaceMaterial({ vertexColors: true, shared: false, surfaces: USED });
  const d = m as THREE.Material & { defaultAttributeValues?: Record<string, number[]> };
  d.defaultAttributeValues = { ...(d.defaultAttributeValues ?? {}), surfQ: [0, 0, 0, 1] };
  chainShader(m, (sh) => {
    if (!sh.vertexShader.includes('vSurfP')) return;   // surfaces compiled out (quality low)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 surfQ;
vec3 kitQRot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }`)
      .replace('#include <project_vertex>', `{ vec4 iq = vec4(-surfQ.xyz, surfQ.w); vSurfP = kitQRot(iq, vSurfP); vSurfN = kitQRot(iq, vSurfN); }
#include <project_vertex>`);
  }, 'kit-frame');
  solid = m;
  return m;
}

/** Bake helper: move a Kit geometry by `m` and carry its pattern frames along (call instead of applyMatrix4). */
export function bakeInto(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const fq = g.attributes.surfQ as THREE.BufferAttribute | undefined;
  if (fq) {
    m.decompose(_p, _q, _s);
    const q = new THREE.Quaternion();
    for (let i = 0; i < fq.count; i++) {
      q.set(fq.getX(i), fq.getY(i), fq.getZ(i), fq.getW(i)).premultiply(_q);
      fq.setXYZW(i, q.x, q.y, q.z, q.w);
    }
  }
  return g.applyMatrix4(m);
}

const longest = (s: THREE.Vector3): 'x' | 'y' | 'z' => (s.x > s.y * 1.05 && s.x >= s.z ? 'x' : s.z > s.y * 1.05 && s.z > s.x ? 'z' : 'y');

const WOOD = new Set<number>([PAL.wood, PAL.woodDark, PAL.woodLight, PAL.plank, 0x8a5a3a, 0x6e452c, 0x5a3a24, 0x5a3a2c, 0xc99a64, 0xc9a26a, 0xa8844f]);
const BARK = new Set<number>([PAL.trunk, PAL.bark]);
const STONE = new Set<number>([PAL.stone, PAL.rockDark, PAL.rock, 0xa29a8c, 0xa9a294, 0xc4bdb0, 0xc9c2b4, 0xcfc7b6, 0xd9d2c4, 0xb8b0a0, 0x8f887c, 0x9a8f7c, 0xc9bfae, 0xb9ae9b, 0xd6cdbd, 0xa89f8e, 0xc2b49c]);
const METAL = new Set<number>([PAL.metal, PAL.metalDark, PAL.ink, 0x3a3430]);
const HAY = new Set<number>([PAL.hay, 0xd4b458, 0xc9a54a, 0xc9b98a]);
const WHITE = new Set<number>([PAL.wallWhite, PAL.white]);

/** The automatic surface for a part from its paint colour and local size (see the Kit header). */
export function autoSurface(color: number, size: THREE.Vector3, cyl: boolean): SurfSpec {
  const d = [size.x, size.y, size.z].sort((a, b) => b - a);
  const slender = d[0] > 2.6 * d[1];
  const big = d[0];
  if (WOOD.has(color)) return slender ? ['logs', { axis: 'long' }] : ['planks', { axis: 'long' }];
  if (BARK.has(color)) return ['logs', { axis: 'long', variant: 1 }];
  if (STONE.has(color)) return big >= 0.8 ? ['fieldstone', { axis: 'h' }] : 'rock';
  if (METAL.has(color)) return ['metal', { axis: cyl ? 'y' : 'long', strength: big < 0.5 ? 0.5 : 0.8 }];
  if (HAY.has(color)) return 'hay';
  if (color === PAL.cloth || color === 0xf3e6cc) return 'fabric';
  if (color === PAL.wallCream) return ['plaster', { strength: 0.6 }];
  if (color === PAL.rust || color === 0xb86a44) return ['plaster', { strength: 0.7 }];
  if (color === PAL.snow) return 'snow';
  if (WHITE.has(color)) return slender ? ['logs', { axis: 'long', strength: 0.35 }] : ['planks', { axis: 'long', variant: 2, strength: 0.7 }];
  return 'plain';
}

/**
 * Glow material: by day the panes read as cool glass with a hint of their colour, at night they burn warm (> 1 so the
 * bloom catches them). `setGlow` drives the blend; `boost` scales the lit colour (lanterns flicker with it).
 */
const GLOW_NIGHT = new THREE.Color(1.7, 1.45, 1.1);
const GLASS = new THREE.Color(0.32, 0.42, 0.52);
export function setGlow(m: THREE.MeshBasicMaterial, night: number, boost = 1): void {
  const k = Math.min(1, Math.max(0, night));
  const u = m.userData.uGlow as { value: number } | undefined;
  const e = k * k * (3 - 2 * k);
  if (u) u.value = e;
  m.color.copy(GLOW_NIGHT).multiplyScalar(boost * (0.35 + 0.65 * e));
}
export function glowMat(night = 0): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  const uGlow = { value: 0 };
  m.userData.uGlow = uGlow;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = uGlow;
    sh.uniforms.uGlass = { value: GLASS };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform vec3 uGlass;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 lit = diffuseColor.rgb;
          vec3 glass = mix(uGlass, vColor.rgb, 0.22) * (0.85 + 0.3 * vColor.g);
          diffuseColor.rgb = mix(glass, lit, uGlow);
        }`);
  };
  m.customProgramCacheKey = () => 'structures-glow';
  setGlow(m, night);
  return m;
}

// ---------------------------------------------------------------------------------------------
// Canvas textures

export interface CanvasTex { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; w: number; h: number }
export function canvasTex(w: number, h: number): CanvasTex {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, g, tex, w, h };
}

export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
export const HAND = '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Trebuchet MS", system-ui, sans-serif';

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Fit text into maxW by shrinking the font; returns the used size. */
export function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font = FONT, weight = 'bold'): number {
  let s = size;
  g.font = `${weight} ${s}px ${font}`;
  while (s > 8 && g.measureText(text).width > maxW) { s -= 1; g.font = `${weight} ${s}px ${font}`; }
  g.fillText(text, x, y);
  return s;
}

export function ellipsize(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Wooden plank background with grain. */
export function woodPanel(g: CanvasRenderingContext2D, w: number, h: number, base = '#b98555', seed = 3): void {
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.12;
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = r() < 0.5 ? '#6e4a2a' : '#e0b27a';
    g.lineWidth = 1 + r() * 2;
    const y = r() * h;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.7, y + (r() - 0.5) * 8, w, y + (r() - 0.5) * 6); g.stroke();
  }
  g.globalAlpha = 1;
}

/**
 * A plaque: a small canvas-textured quad (front only) that redraws when its text changes. Readable by day and dim
 * at night (lamps and bloom do the rest).
 */
export interface Plaque { mesh: THREE.Mesh; set(lines: PlaqueLines): void; night(n: number): void }
export interface PlaqueLines { title: string; value: string; sub?: string; /** 0..1 bar, omitted = none */ bar?: number | null; accent?: string }
export function plaque(wm: number, hm: number, px = 256): Plaque {
  const W = px, H = Math.round(px * (hm / wm));
  const c = canvasTex(W, H);
  const mat = new THREE.MeshBasicMaterial({ map: c.tex, color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), mat);
  let key = '';
  return {
    mesh,
    set(l) {
      const k = `${l.title}|${l.value}|${l.sub ?? ''}|${l.bar == null ? '' : Math.round(l.bar * 40)}|${l.accent ?? ''}`;
      if (k === key) return;
      key = k;
      const g = c.g;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#5a3a22';
      roundRect(g, 0, 0, W, H, H * 0.14); g.fill();
      g.save(); roundRect(g, 5, 5, W - 10, H - 10, H * 0.11); g.clip();
      woodPanel(g, W, H, '#c99a64', 7);
      g.restore();
      g.strokeStyle = '#e9c46a'; g.lineWidth = 3; roundRect(g, 9, 9, W - 18, H - 18, H * 0.09); g.stroke();
      // nails
      g.fillStyle = '#8a8f96';
      for (const [x, y] of [[16, 16], [W - 16, 16], [16, H - 16], [W - 16, H - 16]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#4a2e1a';
      fitText(g, l.title.toUpperCase(), W / 2, H * 0.22, W - 50, Math.round(H * 0.15));
      g.fillStyle = '#2b2420';
      fitText(g, l.value, W / 2, H * (l.bar == null ? 0.52 : 0.47), W - 40, Math.round(H * 0.3));
      if (l.bar != null) {
        const bx = 30, by = H * 0.66, bw = W - 60, bh = H * 0.08;
        g.fillStyle = '#6e4a2a'; roundRect(g, bx, by, bw, bh, bh / 2); g.fill();
        g.fillStyle = l.accent ?? '#5cae4f'; roundRect(g, bx, by, Math.max(bh, bw * Math.min(1, Math.max(0, l.bar))), bh, bh / 2); g.fill();
      }
      if (l.sub) { g.fillStyle = '#4a2e1a'; fitText(g, l.sub, W / 2, H * 0.84, W - 40, Math.round(H * 0.11), FONT, '600'); }
      c.tex.needsUpdate = true;
    },
    night(n) { const k = 1 - 0.45 * n; mat.color.setRGB(k, k * 0.97, k * 0.92); },
  };
}

/** Radial soft spot texture (light pools, glows). */
let spotTex: THREE.Texture | null = null;
export function softSpot(): THREE.Texture {
  if (spotTex) return spotTex;
  const c = canvasTex(128, 128);
  const gr = c.g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.g.fillStyle = gr;
  c.g.fillRect(0, 0, 128, 128);
  c.tex.needsUpdate = true;
  spotTex = c.tex;
  return c.tex;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** frame-rate independent exponential approach */
export const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt));
