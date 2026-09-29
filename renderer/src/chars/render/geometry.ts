/**
 * Shared unit geometries for every instanced character part type (§6.2). A rig part node's world matrix maps the unit
 * geometry into place (scale = size), so one InstancedMesh per type draws every character. `EXTENT` is each unit
 * geometry's bounding size, used to size hulls per axis. Owner: CHR.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Clawd body block (ART §5.2): 0.72 w × 0.54 h × 0.46 d, r 0.1, origin at the bottom centre. */
export const BODY_W = 0.72, BODY_H = 0.54, BODY_D = 0.46;

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Extrude a 2D shape toward +z with a soft bevel; centred on z so the front face sits at +depth/2. */
function slab(shape: THREE.Shape, depth: number, bevel: number, curveSegments = 10, bevelSegments = 3): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments, curveSegments,
  });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  g.computeVertexNormals();
  return g;
}

function body(seg = 4): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, seg, 0.1);
  // Pillow the faces a touch so the block reads as soft clay, not a CAD box: push each vertex outward along the
  // axis of its dominant face, most at the face centre.
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const hx = BODY_W / 2, hy = BODY_H / 2, hz = BODY_D / 2;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ux = v.x / hx, uy = v.y / hy, uz = v.z / hz;
    const fx = (1 - uy * uy) * (1 - uz * uz), fy = (1 - ux * ux) * (1 - uz * uz), fz = (1 - ux * ux) * (1 - uy * uy);
    v.x += Math.sign(v.x) * 0.018 * fx * Math.abs(ux) ** 6;
    v.y += Math.sign(v.y) * 0.014 * fy * Math.abs(uy) ** 6;
    v.z += Math.sign(v.z) * 0.02 * fz * Math.abs(uz) ** 6;
    p.setXYZ(i, v.x, v.y + hy, v.z);
  }
  // [RND fix r1] RoundedBoxGeometry is non-indexed, so computeVertexNormals() here gave every triangle a flat normal:
  // the toon ramp then stair-stepped along the bevels (review r1 art). Weld first so the normals are smooth.
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-4);
  w.computeVertexNormals();
  return w;
}

/** Capsule hanging from its origin: radius 0.5, spans y ∈ [−2, 0] (scale = [2r, L/2, 2r]). */
function limb(cap = 4, radial = 10): THREE.CapsuleGeometry {
  const g = new THREE.CapsuleGeometry(0.5, 1, cap, radial);
  g.translate(0, -1, 0);
  return g;
}

/** Cylinder r 1, h 1 (centred) with softly rounded rims (lathe). */
function softCyl(rim = 4, radial = 24): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const r = 1, h = 0.5, b = 0.16;
  pts.push(new THREE.Vector2(0, -h));
  for (let i = 0; i <= rim; i++) { const a = -Math.PI / 2 + (i / rim) * (Math.PI / 2); pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, -h + b + Math.sin(a) * b)); }
  for (let i = 0; i <= rim; i++) { const a = (i / rim) * (Math.PI / 2); pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, h - b + Math.sin(a) * b)); }
  pts.push(new THREE.Vector2(0, h));
  const g = new THREE.LatheGeometry(pts, radial);
  return mergeVertices(g, 1e-4);
}

function heartShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.15, -0.3, -0.5, -0.15, -0.5, 0.12);
  s.bezierCurveTo(-0.5, 0.42, -0.1, 0.5, 0, 0.22);
  s.bezierCurveTo(0.1, 0.5, 0.5, 0.42, 0.5, 0.12);
  s.bezierCurveTo(0.5, -0.15, 0.15, -0.3, 0, -0.5);
  return s;
}
function starShape(): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.22 : 0.5;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}
function diamondShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.5); s.lineTo(0.3, 0); s.lineTo(0, -0.5); s.lineTo(-0.3, 0); s.closePath();
  return s;
}
function halfDiscShape(): THREE.Shape {
  // "D" lying flat side up: an open smile.
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.absarc(0, 0, 0.5, Math.PI, 2 * Math.PI, false);
  s.lineTo(-0.5, 0);
  return s;
}
/**
 * [CHR fix r3] Chunky ink arc ("^" happy eye, smile, wobble mouth): a half annulus with round end caps, centreline
 * radius 1, stroke 0.72 + 2 × 0.06 bevel = 0.84 (was a 0.48-thick torus that read as a hairline at room distance).
 * Top of the "n" at y = 1.42; extruded 0.6 deep, centred on z.
 */
function arcShape(): THREE.Shape {
  const h = 0.36, ro = 1 + h, ri = 1 - h;
  const s = new THREE.Shape();
  s.moveTo(ro, 0);
  s.absarc(0, 0, ro, 0, Math.PI, false);
  s.absarc(-1, 0, h, Math.PI, 2 * Math.PI, false);
  s.absarc(0, 0, ri, Math.PI, 0, true);
  s.absarc(1, 0, h, Math.PI, 2 * Math.PI, false);
  return s;
}
function bulgedPlane(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 8, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, 0.06 * (1 - (2 * x) ** 2) * (1 - (2 * y) ** 2));
  }
  g.computeVertexNormals();
  return g;
}
function blob(): THREE.CircleGeometry {
  const g = new THREE.CircleGeometry(1, 24);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Instanced part types (rig parts name one of these). */
export type PartType =
  | 'body' | 'sphere' | 'limb' | 'dome' | 'cone' | 'torus' | 'cyl' | 'rbox' | 'eye' | 'arc' | 'band' | 'ring' | 'heart' | 'star'
  | 'diamond' | 'halfdisc' | 'glint' | 'stroke' | 'screen' | 'blob';

/** Part type definition: lit types use toonChar; unlit ones name their material kind (`unlit`). */
export interface PartDef {
  build: () => THREE.BufferGeometry;
  unlit?: 'sprite' | 'screen' | 'blob';
  matOpts?: { color: string; emissive?: number };
}

const DEFS: Record<PartType, PartDef> = {
  body: { build: body },
  sphere: { build: () => new THREE.SphereGeometry(1, 14, 10) },
  limb: { build: limb },
  dome: { build: () => new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2) },
  cone: { build: () => new THREE.ConeGeometry(1, 1, 20, 1).translate(0, 0.5, 0) },
  torus: { build: () => new THREE.TorusGeometry(1, 0.22, 8, 24).rotateX(Math.PI / 2) },
  cyl: { build: softCyl },
  rbox: { build: () => new RoundedBoxGeometry(1, 1, 1, 3, 0.16) },
  eye: { build: () => slab(roundedRectShape(0.074, 0.154, 0.036), 0.03, 0.008, 5) },
  // [CHR fix m3-r1] 8 curve × 2 bevel segments (was 12 × 3: 1.5k tris for a ≤ 0.11 m mouth / eye arc, the densest part
  // per pixel in a crowd); still ≤ 12° per segment on the half-ring at a 1.5 m close-up
  arc: { build: () => slab(arcShape(), 0.6, 0.06, 8, 2) },
  band: { build: () => new THREE.TorusGeometry(1, 0.09, 8, 28, Math.PI) },
  ring: { build: () => new THREE.TorusGeometry(1, 0.24, 8, 24, Math.PI * 1.7) },
  heart: { build: () => slab(heartShape(), 0.3, 0.06) },
  star: { build: () => slab(starShape(), 0.25, 0.05, 4) },
  diamond: { build: () => slab(diamondShape(), 0.3, 0.06, 4) },
  halfdisc: { build: () => slab(halfDiscShape(), 0.25, 0.05) },
  // unlit
  glint: { build: () => new THREE.SphereGeometry(1, 10, 8), unlit: 'sprite' },
  stroke: { build: limb, unlit: 'sprite' },
  screen: { build: bulgedPlane, unlit: 'screen', matOpts: { color: '#16211B', emissive: 0.9 } }, // CRT glass; body ≤ 0.95 (§5.0)
  blob: { build: blob, unlit: 'blob', matOpts: { color: '#1F1E1D' } }, // ink contact shadow (radial in the shader)
};

/**
 * [CHR m2 fix r3] Far hull LOD (§5.3: "hull detail is set per tier; micro-parts drop beyond 14 m"). Beyond 14 m (and in
 * any top-down / orthographic view) a Clawd is ≤ 60 px tall at 1080p, so the dense shells (4-segment rounded body,
 * 24-sided lathes, 1.5k-tri arcs) are pure vertex cost in both the main and the shadow pass. Each entry keeps the same
 * unit bounds, origin and silhouette as its full build (so part matrices and hull widths carry over unchanged) at
 * ~20–35 % of the triangles. Only the types that dominate a crowd's triangle count get a variant (each is one more
 * draw while near and far actors mix); rare or cheap types (emote shapes, bands, domes, strokes) keep their full
 * geometry at any distance.
 */
const LO: Partial<Record<PartType, () => THREE.BufferGeometry>> = {
  body: () => body(2),
  sphere: () => new THREE.SphereGeometry(1, 8, 6),
  limb: () => limb(2, 8),
  // [CHR fix m3-r1] no far torus: hat rings are few (≈ 25 far in crowd40), so sharing the near batch (and its hulls)
  // saves two draws for ≈ 6k triangles
  cyl: () => softCyl(2, 10),
  rbox: () => new RoundedBoxGeometry(1, 1, 1, 1, 0.16),
  eye: () => slab(roundedRectShape(0.074, 0.154, 0.036), 0.03, 0.008, 2, 1),
  arc: () => slab(arcShape(), 0.6, 0.06, 4, 1),
};

// Object.keys widens to string[]; DEFS / LO are keyed exactly by PartType.
export const PART_TYPES = Object.freeze(Object.keys(DEFS) as PartType[]);
/** Part types that have a far (low-poly) variant. */
export const LO_TYPES = Object.freeze(Object.keys(LO) as PartType[]);
export const partDef = (type: PartType): PartDef => DEFS[type];
export const hasLo = (type: PartType): boolean => type in LO;

const cache = new Map<string, THREE.BufferGeometry>();
const extents = new Map<string, THREE.Vector3>();

/** Unit geometry of a part type; `lo` = its far LOD (falls back to the full geometry). */
export function geometryFor(type: PartType, lo = false): THREE.BufferGeometry {
  if (lo && !(type in LO)) lo = false;
  const key = lo ? `${type}~lo` : type;
  let g = cache.get(key);
  if (!g) {
    const d = DEFS[type];
    if (!d) throw new Error(`charBatch: unknown part type ${type}`);
    const buildLo = lo ? LO[type] : undefined; // set: `lo` was cleared above unless the type has a far variant
    g = buildLo ? buildLo() : d.build();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    cache.set(key, g);
    extents.set(key, (g.boundingBox as THREE.Box3).getSize(new THREE.Vector3())); // just computed
  }
  return g;
}
/** Unit bounding size of a part type's geometry. */
export function extentOf(type: PartType, lo = false): THREE.Vector3 {
  if (lo && !(type in LO)) lo = false;
  const key = lo ? `${type}~lo` : type;
  if (!extents.has(key)) geometryFor(type, lo);
  return extents.get(key) as THREE.Vector3; // filled by geometryFor above
}

/** Triangles drawn per instance of a part type (index count / 3). */
export function trisOf(type: PartType, lo = false): number {
  const g = geometryFor(type, lo);
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}
