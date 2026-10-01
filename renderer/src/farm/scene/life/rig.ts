/**
 * Tiny vertex rigs for critters. A model is merged into ONE geometry whose vertices carry `aPart` (which rigid part
 * they belong to) and `aMask` (how much a per-instance tint applies: 0..1 the main tint, 1..2 the second tint). The
 * toon material gets generated vertex code that moves each part by its ops (rotate about a pivot, uniform scale,
 * stretch along an axis, translate) driven by animation channels, then by its parent's ops, and so on up the chain:
 * a wing tip folds on the wing, which flaps on the body. A whole flock is one InstancedMesh = one draw call.
 *
 * Channels: 12 floats per instance (`animA`, `animB`, `animC` vec4). Instanced meshes read them from instanced
 * attributes; single meshes (gallery) from material uniforms (`rig.animA/animB/animC`).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../toon.ts';

export type V3 = readonly [number, number, number];
export interface RigOp {
  /** rotation axis (unit), or 'scale' for uniform scale about the pivot by (1 + value) */
  axis: V3 | 'scale';
  /** 'move': translate along `axis` by value; 'stretch': scale along `axis` by (1 + value) about the pivot */
  mode?: 'rot' | 'move' | 'stretch';
  /** animation channel 0..11 */
  ch: number;
  gain?: number;
  bias?: number;
  /** rotate about this point instead of the part's pivot (e.g. ears twitch at their base, then follow the head) */
  pivot?: V3;
}
export interface RigPart { id: number; pivot: V3; ops: RigOp[]; /** part id whose motion this part rides on */ parent?: number }
export interface RigSpec { name: string; parts: RigPart[] }

// ---------------------------------------------------------------------------------------------
// Geometry assembly

export interface PieceOpts {
  at?: V3;
  rot?: V3;
  scale?: V3 | number;
  part?: number;
  /** 0..1 how much the instance tint applies */
  mask?: number;
}
export interface Piece { g: THREE.BufferGeometry; color: number; o: PieceOpts }

export const piece = (g: THREE.BufferGeometry, color: number, o: PieceOpts = {}): Piece => ({ g, color, o });

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Merge pieces into one flat-shaded, vertex-coloured geometry with `aPart` and `aMask` attributes. */
export function assemble(pieces: Piece[]): THREE.BufferGeometry {
  const gs = pieces.map(({ g, color, o }) => {
    const n = (g.index ? g.toNonIndexed() : g.clone());
    for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
    const sc = o.scale ?? 1;
    _s.set(...(typeof sc === 'number' ? [sc, sc, sc] as const : sc));
    _e.set(...(o.rot ?? [0, 0, 0] as const));
    _p.set(...(o.at ?? [0, 0, 0] as const));
    n.applyMatrix4(_m.compose(_p, _q.setFromEuler(_e), _s));
    const cnt = n.attributes.position.count;
    const col = new Float32Array(cnt * 3), part = new Float32Array(cnt), mask = new Float32Array(cnt);
    _c.setHex(color);
    for (let i = 0; i < cnt; i++) {
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      part[i] = o.part ?? 0; mask[i] = o.mask ?? 0;
    }
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    n.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    n.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
    g.dispose();
    return n;
  });
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  if (!out) throw new Error('assemble: merge failed');
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

/** A flat polygon (XZ plane, y = 0) from outline points, double-sided later via material. */
export function flatPoly(pts: readonly (readonly [number, number])[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) pos.push(pts[0][0], 0, pts[0][1], pts[i][0], 0, pts[i][1], pts[i + 1][0], 0, pts[i + 1][1]);
  // back face so it lights from both sides with a single-sided material
  for (let i = 1; i < pts.length - 1; i++) pos.push(pts[0][0], 0, pts[0][1], pts[i + 1][0], 0, pts[i + 1][1], pts[i][0], 0, pts[i][1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Material

const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const vec = (v: V3) => `vec3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;

function partFn(p: RigPart): string {
  const lines = [`void rigP${p.id}(inout vec3 p, inout vec3 n) {`, `  vec3 q = p - ${vec(p.pivot)};`];
  for (const op of p.ops) {
    const v = `(rigCh(${op.ch}) * ${f(op.gain ?? 1)} + ${f(op.bias ?? 0)})`;
    if (op.axis === 'scale') { lines.push(`  q *= max(0.0, 1.0 + ${v});`); continue; }
    const ax = vec(op.axis);
    if (op.mode === 'move') { lines.push(`  q += ${ax} * ${v};`); continue; }
    if (op.mode === 'stretch') { lines.push(`  q += ${ax} * dot(q, ${ax}) * ${v};`); continue; }
    if (op.pivot) {
      const d = vec([op.pivot[0] - p.pivot[0], op.pivot[1] - p.pivot[1], op.pivot[2] - p.pivot[2]]);
      lines.push(`  { mat3 r = rigRot(${ax}, ${v}); q = r * (q - ${d}) + ${d}; n = r * n; }`);
    } else lines.push(`  { mat3 r = rigRot(${ax}, ${v}); q = r * q; n = r * n; }`);
  }
  lines.push(`  p = q + ${vec(p.pivot)};`, '}');
  return lines.join('\n');
}

function rigGlsl(spec: RigSpec): string {
  const byId = new Map(spec.parts.map((p) => [p.id, p]));
  const fns = spec.parts.map(partFn);
  const cases: string[] = [];
  for (const p of spec.parts) {
    const chain: number[] = [];
    for (let c: RigPart | undefined = p; c; c = c.parent !== undefined ? byId.get(c.parent) : undefined) {
      if (chain.includes(c.id)) throw new Error(`rig ${spec.name}: parent cycle at ${c.id}`);
      chain.push(c.id);
    }
    cases.push(`  ${cases.length ? 'else ' : ''}if (id == ${p.id}) { ${chain.map((c) => `rigP${c}(p, n);`).join(' ')} }`);
  }
  return `${fns.join('\n')}
void rigApply(inout vec3 p, inout vec3 n) {
  int id = int(aPart + 0.5);
${cases.join('\n')}
}`;
}

export interface RigMaterial extends THREE.MeshToonMaterial {
  userData: { animA: THREE.Vector4; animB: THREE.Vector4; animC: THREE.Vector4; tint: THREE.Color; tint2: THREE.Color; rig: RigSpec };
}

/**
 * Toon material with the rig for `spec`. `instanced`: channels + tint come from per-instance attributes
 * (`iAnimA`, `iAnimB`, `iTint`) instead of uniforms.
 */
export function rigMaterial(spec: RigSpec, o: { instanced: boolean; side?: THREE.Side; emissive?: number } = { instanced: false }): RigMaterial {
  const base = toon(0xffffff, { vertexColors: true, shared: false, side: o.side, emissive: o.emissive });
  const m = base as RigMaterial;
  m.userData = { animA: new THREE.Vector4(), animB: new THREE.Vector4(), animC: new THREE.Vector4(), tint: new THREE.Color(1, 1, 1), tint2: new THREE.Color(1, 1, 1), rig: spec };
  const key = `rig:${spec.name}:${o.instanced ? 'i' : 'u'}`;
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (sh) => {
    const decl = o.instanced
      ? 'attribute vec4 iAnimA;\nattribute vec4 iAnimB;\nattribute vec4 iAnimC;\nattribute vec3 iTint;\nattribute vec3 iTint2;\n#define RIG_A iAnimA\n#define RIG_B iAnimB\n#define RIG_C iAnimC\n#define RIG_TINT iTint\n#define RIG_TINT2 iTint2\n'
      : 'uniform vec4 rigAnimA;\nuniform vec4 rigAnimB;\nuniform vec4 rigAnimC;\nuniform vec3 rigTint;\nuniform vec3 rigTint2;\n#define RIG_A rigAnimA\n#define RIG_B rigAnimB\n#define RIG_C rigAnimC\n#define RIG_TINT rigTint\n#define RIG_TINT2 rigTint2\n';
    if (!o.instanced) {
      sh.uniforms.rigAnimA = { value: m.userData.animA };
      sh.uniforms.rigAnimB = { value: m.userData.animB };
      sh.uniforms.rigAnimC = { value: m.userData.animC };
      sh.uniforms.rigTint = { value: m.userData.tint };
      sh.uniforms.rigTint2 = { value: m.userData.tint2 };
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPart;
attribute float aMask;
${decl}
float rigCh(int c) { return c < 4 ? RIG_A[c] : c < 8 ? RIG_B[c - 4] : RIG_C[c - 8]; }
mat3 rigRot(vec3 a, float t) {
  float c = cos(t), s = sin(t), k = 1.0 - c;
  return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
              a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
              a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
}
${rigGlsl(spec)}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_COLOR
  vColor.rgb = aMask <= 1.0 ? mix(vColor.rgb, vColor.rgb * RIG_TINT, aMask) : mix(vColor.rgb, vColor.rgb * RIG_TINT2, aMask - 1.0);
#endif`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vec3 rigPos = position;
rigApply(rigPos, objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = rigPos;`);
  };
  return m;
}

/** Per-instance rig attributes for an InstancedMesh of `count`. */
export function instanceRig(g: THREE.BufferGeometry, count: number): { a: THREE.InstancedBufferAttribute; b: THREE.InstancedBufferAttribute; c: THREE.InstancedBufferAttribute; tint: THREE.InstancedBufferAttribute; tint2: THREE.InstancedBufferAttribute } {
  const mk = (n: number, fill = 0) => { const v = new THREE.InstancedBufferAttribute(new Float32Array(count * n).fill(fill), n); v.setUsage(THREE.DynamicDrawUsage); return v; };
  const a = mk(4), b = mk(4), c = mk(4), tint = mk(3, 1), tint2 = mk(3, 1);
  g.setAttribute('iAnimA', a);
  g.setAttribute('iAnimB', b);
  g.setAttribute('iAnimC', c);
  g.setAttribute('iTint', tint);
  g.setAttribute('iTint2', tint2);
  return { a, b, c, tint, tint2 };
}

/**
 * A pool of rigged instances written fresh every frame: `begin()`, then `put(...)` for each visible critter, then
 * `end()`. Invisible critters are simply not put (the draw count shrinks). Zero allocation per frame.
 */
export class RigPool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly c: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly tint2: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  readonly max: number;
  constructor(geo: THREE.BufferGeometry, spec: RigSpec, max: number, o: { side?: THREE.Side; emissive?: number } = {}) {
    this.max = max;
    const r = instanceRig(geo, max);
    this.a = r.a; this.b = r.b; this.c = r.c; this.tint = r.tint; this.tint2 = r.tint2;
    this.mesh = new THREE.InstancedMesh(geo, rigMaterial(spec, { instanced: true, side: o.side, emissive: o.emissive }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = `life:${spec.name}`;
  }
  begin(): void { this.n = 0; }
  get size(): number { return this.n; }
  /** yaw (y), pitch (x), roll (z) in YXZ order; returns the slot or -1 when full */
  put(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, sx: number, sy: number, sz: number,
    a0 = 0, a1 = 0, a2 = 0, a3 = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0): number {
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.e.set(pitch, yaw, roll);
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(sx, sy, sz));
    this.mesh.setMatrixAt(i, this.m);
    this.a.setXYZW(i, a0, a1, a2, a3);
    this.b.setXYZW(i, b0, b1, b2, b3);
    this.c.setXYZW(i, 0, 0, 0, 0);
    return i;
  }
  /** channels 8..11 of a slot returned by `put` */
  chC(i: number, c0: number, c1 = 0, c2 = 0, c3 = 0): void { if (i >= 0) this.c.setXYZW(i, c0, c1, c2, c3); }
  tintAt(i: number, r: number, g: number, b: number): void { if (i >= 0) this.tint.setXYZ(i, r, g, b); }
  tint2At(i: number, r: number, g: number, b: number): void { if (i >= 0) this.tint2.setXYZ(i, r, g, b); }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.a.needsUpdate = true; this.b.needsUpdate = true; this.c.needsUpdate = true; this.tint.needsUpdate = true; this.tint2.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
