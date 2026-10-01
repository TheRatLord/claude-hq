/**
 * Chunky skinned models for the two pets: faceted pieces merged into ONE geometry bound to a small bone hierarchy
 * (one draw call per pet, correct shadows, a CPU skeleton the pet animator poses every frame). Pieces are rigid on a
 * bone, or blend linearly between two bones along an axis (the dog's barrel bends between hips and chest; tails
 * bend smoothly). Everything is authored in model space, rest pose, facing +z with the feet at y = 0.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../toon.ts';
import type { V3 } from './rig.ts';

export interface BoneDef { name: string; parent: string | null; at: V3 }

export interface SkinPieceOpts {
  at?: V3;
  rot?: V3;
  scale?: V3 | number;
  /** the bone this piece rides on */
  bone: string;
  /** blend toward another bone along a model-space axis between two coordinates (weight 0 → 1) */
  blend?: { to: string; axis: 0 | 1 | 2; from: number; till: number };
}
export interface SkinPiece { g: THREE.BufferGeometry; color: number; o: SkinPieceOpts }
export const sp = (g: THREE.BufferGeometry, color: number, o: SkinPieceOpts): SkinPiece => ({ g, color, o });

export interface SkinnedModel {
  mesh: THREE.SkinnedMesh;
  bones: Record<string, THREE.Bone>;
  /** rest position (model space) of every bone */
  rest: Record<string, THREE.Vector3>;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();
const smooth = (t: number) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

export function buildSkinned(name: string, defs: BoneDef[], pieces: SkinPiece[]): SkinnedModel {
  const index = new Map<string, number>();
  defs.forEach((d, i) => index.set(d.name, i));
  const bones: THREE.Bone[] = [];
  const byName: Record<string, THREE.Bone> = {};
  const rest: Record<string, THREE.Vector3> = {};
  for (const d of defs) {
    const b = new THREE.Bone();
    b.name = d.name;
    const at = new THREE.Vector3(...d.at);
    rest[d.name] = at;
    const par = d.parent ? byName[d.parent] : null;
    if (d.parent && !par) throw new Error(`skin ${name}: bone ${d.name} before its parent ${d.parent}`);
    b.position.copy(at);
    if (par) { b.position.sub(rest[d.parent!]); par.add(b); }
    bones.push(b);
    byName[d.name] = b;
  }
  const gs = pieces.map(({ g, color, o }) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
    const sc = o.scale ?? 1;
    _s.set(...(typeof sc === 'number' ? [sc, sc, sc] as const : sc));
    _e.set(...(o.rot ?? [0, 0, 0] as const));
    _p.set(...(o.at ?? [0, 0, 0] as const));
    n.applyMatrix4(_m.compose(_p, _q.setFromEuler(_e), _s));
    const pos = n.attributes.position;
    const cnt = pos.count;
    const col = new Float32Array(cnt * 3), si = new Uint16Array(cnt * 4), sw = new Float32Array(cnt * 4);
    _c.setHex(color);
    const a = index.get(o.bone);
    if (a === undefined) throw new Error(`skin ${name}: no bone ${o.bone}`);
    const b = o.blend ? index.get(o.blend.to) : undefined;
    if (o.blend && b === undefined) throw new Error(`skin ${name}: no bone ${o.blend.to}`);
    for (let i = 0; i < cnt; i++) {
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      let w = 0;
      if (o.blend && b !== undefined) {
        // per-vertex (coincident corners share a weight, so the surface never tears)
        const v = pos.getComponent(i, o.blend.axis);
        w = smooth((v - o.blend.from) / (o.blend.till - o.blend.from));
      }
      si[i * 4] = a; si[i * 4 + 1] = b ?? 0;
      sw[i * 4] = 1 - w; sw[i * 4 + 1] = w;
    }
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    n.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    n.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.dispose();
    return n;
  });
  const geo = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  if (!geo) throw new Error(`skin ${name}: merge failed`);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = toon(0xffffff, { vertexColors: true, shared: false });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = `life:${name}`;
  const roots = bones.filter((b) => !b.parent);
  for (const r of roots) mesh.add(r);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return { mesh, bones: byName, rest };
}

/** Half ring (an arc opening downwards, "∩") in the XY plane: closed happy eyes. */
export function arc(r: number, tube: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, 3, 6, Math.PI);
}
