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
import { toon } from '../toon.ts';

export type BakeKind = 'solid' | 'glow';

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

  /** Add any geometry (consumed). */
  add(geo: THREE.BufferGeometry, color: number, t?: Xf, kind: BakeKind = 'solid', jitter = this.jitter): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g.applyMatrix4(xfMatrix(t, _m).premultiply(this.top()));
    _c.setHex(color);
    if (jitter) { const d = (this.r() - 0.5) * 2 * jitter; _c.offsetHSL(0, 0, d); }
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts[kind].push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number, t?: Xf, kind?: BakeKind): this { return this.add(new THREE.BoxGeometry(w, h, d), color, t, kind); }
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
    g.applyMatrix4(m);
    return this.add(g, color, undefined, kind);
  }
  /** round beam (rope, pipe) from a to b */
  rod(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color: number, seg = 5, kind?: BakeKind): this {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    const len = _d.subVectors(_b, _a).length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _d.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(_a.add(_b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    return this.add(g, color, undefined, kind);
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

export const solidMat = (): THREE.MeshToonMaterial => toon(0xffffff, { vertexColors: true });

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
