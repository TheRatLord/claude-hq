/**
 * Models for the seasonal pastimes (system `seasons`; the gallery builds through these too, assets.ts): the rowboat
 * (a lofted clinker-ish hull, thwarts, oarlocks, a bow lantern), its oars, snowballs, a snowman's decorations, the
 * frozen pond (ice sheet + snowbanks + the iced dock, one mesh: ice.ts draws it) and the wake rings.
 */
import * as THREE from 'three';
import { Kit, solidMat } from '../structures/kit.ts';
import { PAL, facet } from '../toon.ts';
import { BOAT } from './physics.ts';
import type { Snowman } from './snowman.ts';
import { ballHeights } from './snowman.ts';

// ---------------------------------------------------------------------------------------------
// The rowboat (built facing +z, origin on the waterline at the middle)

const L = BOAT.len;
/** hull half-width, gunwale height and keel height along the boat (t 0 = stern … 1 = bow) */
function section(t: number): { w: number; g: number; k: number } {
  if (t <= 0.42) {
    const s = (0.42 - t) / 0.42;
    return { w: 0.6 - 0.18 * s * s, g: 0.3 + 0.05 * s * s, k: -0.22 + 0.08 * s * s };
  }
  const u = (t - 0.42) / 0.58;
  return { w: 0.6 * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.4))), g: 0.3 + 0.17 * u * u, k: -0.22 + 0.3 * Math.pow(u, 2.2) };
}
const S = 14, J = 8, E = 3;

/** one shell of the hull between cross-section rows j0..j1 (scale: inner shell is a little smaller / higher) */
function shell(j0: number, j1: number, scale: number, lift: number, inward: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const vtx = (i: number, j: number): [number, number, number] => {
    const t = i / S, sc = section(t), a = (j / J) * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const x = sc.w * scale * Math.sign(ca) * Math.pow(Math.abs(ca), 2 / E);
    const y = sc.g - (sc.g - (sc.k + lift)) * Math.pow(sa, 2 / E);
    return [x, y, -L / 2 + t * L];
  };
  for (let i = 0; i < S; i++) for (let j = j0; j < j1; j++) {
    const a = vtx(i, j), b = vtx(i + 1, j), c = vtx(i + 1, j + 1), d = vtx(i, j + 1);
    if (inward) pos.push(...a, ...c, ...b, ...a, ...d, ...c);
    else pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
/** the rim along both gunwales (outer → inner), and the transom at the stern */
function rimAndTransom(inner: number, lift: number): { rim: THREE.BufferGeometry; transom: THREE.BufferGeometry } {
  const at = (i: number, j: number, scale: number, l: number): [number, number, number] => {
    const t = i / S, sc = section(t), a = (j / J) * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    return [sc.w * scale * Math.sign(ca) * Math.pow(Math.abs(ca), 2 / E), sc.g - (sc.g - (sc.k + l)) * Math.pow(sa, 2 / E), -L / 2 + t * L];
  };
  const rim: number[] = [];
  for (let i = 0; i < S; i++) for (const j of [0, J]) {
    const o0 = at(i, j, 1, 0), o1 = at(i + 1, j, 1, 0), i0 = at(i, j, inner, lift), i1 = at(i + 1, j, inner, lift);
    for (const v of [o0, o1, i0, i1]) v[1] += 0.02;
    if (j === 0) rim.push(...o0, ...i1, ...o1, ...o0, ...i0, ...i1); else rim.push(...o0, ...o1, ...i1, ...o0, ...i1, ...i0);
  }
  const tr: number[] = [];
  const top = section(0).g;
  // outer face (−z) and inner face (+z): fans across the U of the stern section
  for (const [scale, l, flip] of [[1, 0, false], [inner, lift, true]] as const) {
    const c: [number, number, number] = [0, top * 0.6 + (section(0).k + l) * 0.4, -L / 2 + (flip ? 0.03 : 0)];
    for (let j = 0; j < J; j++) {
      const a = at(0, j, scale, l), b = at(0, j + 1, scale, l);
      a[2] = b[2] = c[2];
      if (flip) tr.push(...c, ...a, ...b); else tr.push(...c, ...b, ...a);
    }
    const a = at(0, J, scale, l), b = at(0, 0, scale, l);
    a[2] = b[2] = c[2];
    if (flip) tr.push(...c, ...a, ...b); else tr.push(...c, ...b, ...a);
  }
  const mk = (p: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return g; };
  return { rim: mk(rim), transom: mk(tr) };
}

/** Where things sit in the boat (boat-local, origin on the waterline mid-ships, facing +z). */
export const BOAT_SPOTS = Object.freeze({
  /** the rower's seat (eye goes ~0.85 above it) */
  seat: new THREE.Vector3(0, 0.12, -0.35),
  /** the bow thwart: your pet sits here */
  bow: new THREE.Vector3(0, 0.16, 0.78),
  /** oarlocks (port +x, starboard −x) */
  lockL: new THREE.Vector3(0.6, 0.36, 0.05),
  lockR: new THREE.Vector3(-0.6, 0.36, 0.05),
  /** the bow lantern's flame */
  lantern: new THREE.Vector3(0.3, 0.94, 1.0),
});

export const HULL_PAINT = 0x4f93b0, HULL_STRIPE = 0xf3ead6, HULL_KEEL = 0xb8483a;

/** The rowboat: hull, thwarts, floorboards, oarlocks, rope, bow lantern (solid mesh + a lantern glow mesh). */
export function buildBoat(seed = 7, night = 0): THREE.Group {
  const root = new THREE.Group();
  root.name = 'rowboat';
  const k = new Kit(seed);
  k.part('hull', () => {
    k.add(shell(0, 1, 1, 0, false), HULL_STRIPE);
    k.add(shell(J - 1, J, 1, 0, false), HULL_STRIPE);
    k.add(shell(1, 3, 1, 0, false), HULL_PAINT);
    k.add(shell(J - 3, J - 1, 1, 0, false), HULL_PAINT);
    k.add(shell(3, J - 3, 1, 0, false), HULL_KEEL);
    k.surf(['planks', { axis: 'z' }], () => k.add(shell(0, J, 0.9, 0.07, true), PAL.plank));
    const { rim, transom } = rimAndTransom(0.9, 0.07);
    k.add(rim, PAL.woodLight);
    k.add(transom, HULL_STRIPE);
  });
  // thwarts (seats), floorboards, a little stern bench
  const thwart = (z: number, y: number) => { const t = (z + L / 2) / L, w = section(t).w * 0.9 * 2 - 0.04; k.box(w, 0.06, 0.26, PAL.woodLight, { y, z }); };
  k.part('thwarts', () => { thwart(-0.35, 0.1); thwart(0.78, 0.14); thwart(-1.22, 0.16); });
  k.part('floor', () => k.surf(['planks', { axis: 'z' }], () => k.box(0.46, 0.04, 2.3, PAL.wood, { y: -0.11, z: -0.05 })));
  // oarlocks: a post and a crescent on each gunwale
  for (const s of [-1, 1]) k.part('oarlock', () => {
    k.cyl(0.03, 0.12, PAL.metalDark, { x: s * 0.6, y: 0.36, z: 0.05 }, 6);
    k.add(new THREE.TorusGeometry(0.06, 0.012, 4, 8, Math.PI), PAL.metalDark, { x: s * 0.6, y: 0.42, z: 0.05, ry: Math.PI / 2 });
  });
  // a coil of rope in the stern, the painter tied off at the bow ring
  k.part('rope', () => {
    k.add(new THREE.TorusGeometry(0.13, 0.03, 5, 12), PAL.cloth, { x: 0.1, y: -0.06, z: -1.0, rx: Math.PI / 2 });
    k.add(new THREE.TorusGeometry(0.09, 0.025, 5, 10), PAL.cloth, { x: 0.12, y: -0.02, z: -1.0, rx: Math.PI / 2 });
    k.add(new THREE.TorusGeometry(0.04, 0.012, 4, 8), PAL.metalDark, { y: 0.4, z: 1.47 });
  });
  // bow lantern on a crooked little pole
  k.part('lantern', () => {
    k.cyl(0.025, 0.55, PAL.woodDark, { x: 0.3, y: 0.62, z: 1.0 }, 5);
    k.box(0.16, 0.03, 0.16, PAL.ink, { x: 0.3, y: 0.86, z: 1.0 });
    k.cone(0.12, 0.1, PAL.ink, { x: 0.3, y: 1.06, z: 1.0 }, 4);
    k.cyl(0.02, 0.05, PAL.ink, { x: 0.3, y: 1.13, z: 1.0 }, 4);
    k.emit(false, () => k.box(0.12, 0.15, 0.12, PAL.lampGlow, { x: 0.3, y: 0.94, z: 1.0 }, 'glow'));
  });
  k.build(root, night);
  for (const m of root.children) { m.castShadow = true; m.receiveShadow = true; }
  return root;
}

/** One oar along +x from its pivot (the oarlock): grip, loom, shaft and a broad blade. */
export function oarGeometry(): THREE.BufferGeometry {
  const k = new Kit(3);
  k.cyl(0.028, 0.18, PAL.woodDark, { x: -0.5, rz: Math.PI / 2 }, 6);
  k.cyl(0.032, 1.9, PAL.woodLight, { x: 0.5, rz: Math.PI / 2 }, 6);
  k.box(0.08, 0.12, 0.012, PAL.metalDark, { x: 0.0 });
  k.box(0.55, 0.018, 0.17, PAL.woodLight, { x: 1.62 });
  k.box(0.1, 0.02, 0.17, HULL_PAINT, { x: 1.86 });
  const g = k.geometry() ?? new THREE.BufferGeometry();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Snow

/** a snowball (unit radius, faceted) */
export function snowballGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  // a little lumpy, hand-packed
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.05 * Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 5.7 - x * 2.1);
    p.setXYZ(i, x * n, y * n * 0.96, z * n);
  }
  return facet(g);
}

const SCARF: Readonly<Record<string, number>> = { red: 0xd9453b, blue: 0x3f78c8, green: 0x4f9a52 };
const COAL = 0x2b2622, PINECONE = 0x8a5a32, CARROT = 0xef7f2a, TWIG = 0x6e4a2a;

/** Every snowman's decorations merged into one mesh (rebuilt when one changes). `ground(x, z)` = terrain height. */
export function snowmenDecor(list: readonly Snowman[], ground: (x: number, z: number) => number): THREE.Mesh {
  const k = new Kit(11);
  k.jitter = 0.02;
  const hs: number[] = [];
  for (const sm of list) {
    if (sm.balls.length < 1) continue;
    const gy = ground(sm.x, sm.z);
    ballHeights(sm.balls, hs);
    k.at({ x: sm.x, y: gy, z: sm.z, ry: sm.yaw }, () => decorOne(k, sm, hs));
  }
  return k.mesh(solidMat());
}

/** the decorations of one snowman, in its local frame (feet at the origin, facing +z) */
export function decorOne(k: Kit, sm: Snowman, hs: readonly number[]): void {
  const n = sm.balls.length, d = sm.decor;
  const head = n >= 3 ? 2 : -1, mid = n >= 2 ? 1 : -1;
  if (head >= 0) {
    const r = sm.balls[head], y = hs[head];
    k.part('face', () => {
      if (d.eyes) for (const s of [-1, 1]) {
        if (d.eyes === 'pinecone') k.cone(0.045, 0.1, PINECONE, { x: s * r * 0.34, y: y + r * 0.22, z: r * 0.9, rx: Math.PI / 2 }, 5);
        else k.ball(0.04, COAL, { x: s * r * 0.34, y: y + r * 0.22, z: r * 0.92 });
      }
      if (d.nose) k.cone(0.045, 0.24 + r * 0.25, CARROT, { y: y + r * 0.02, z: r + 0.08, rx: Math.PI / 2 }, 6);
      if (d.eyes) for (let i = 0; i < 5; i++) { const a = -0.55 + i * 0.275; k.ball(0.022, COAL, { x: Math.sin(a) * r * 0.5, y: y - r * 0.32 - Math.cos(a) * 0.04, z: Math.cos(a) * r * 0.86 }); }
    });
    if (d.topper === 'hat') k.part('hat', () => {
      k.cyl(r * 0.85, 0.035, COAL, { y: y + r * 0.86 }, 10);
      k.cyl(r * 0.55, r * 0.75, COAL, { y: y + r * 0.86 + r * 0.38 }, 10);
      k.cyl(r * 0.57, 0.06, 0xb8483a, { y: y + r * 0.95 }, 10);
    });
    else if (d.topper === 'holly') k.part('holly', () => {
      for (const s of [-1, 1]) k.box(0.16, 0.015, 0.07, 0x2f7a3f, { x: s * 0.07, y: y + r * 0.97, z: 0.02, ry: s * 0.5, rz: s * 0.25 });
      for (const [x, z] of [[0, 0.04], [0.035, -0.01], [-0.03, -0.02]]) k.ball(0.026, 0xd0283a, { x, y: y + r * 1.0, z });
    });
  }
  if (mid >= 0) {
    const r = sm.balls[mid], y = hs[mid];
    if (d.buttons) k.part('buttons', () => { for (const t of [0.35, 0, -0.35]) k.ball(0.035, COAL, { y: y + r * t, z: r * Math.cos(Math.asin(t)) * 0.97 }); });
    if (d.arms) k.part('arms', () => {
      for (const s of [-1, 1]) {
        const x0 = s * r * 0.85, y0 = y + r * 0.25, x1 = s * (r + 0.55), y1 = y + r * 0.25 + 0.38;
        k.rod(x0, y0, 0, x1, y1, 0.05, 0.022, TWIG);
        k.rod(x1 - s * 0.16, y1 - 0.11, 0.035, x1 - s * 0.02, y1 + 0.03, 0.12, 0.014, TWIG);
        k.rod(x1, y1, 0.05, x1 + s * 0.12, y1 + 0.06, 0.05, 0.012, TWIG);
      }
    });
    if (d.scarf && head >= 0) k.part('scarf', () => {
      const c = SCARF[d.scarf!] ?? SCARF.red, yn = y + r * 0.78, rr = sm.balls[head] * 0.82;
      k.add(new THREE.TorusGeometry(rr, 0.06, 5, 12), c, { y: yn, rx: Math.PI / 2, s: [1, 1, 0.9] });
      k.box(0.13, r * 0.9, 0.035, c, { x: rr * 0.55, y: yn - r * 0.42, z: rr * 0.78, rz: -0.12, ry: 0.4 });
      k.box(0.13, 0.03, 0.04, 0xf3ead6, { x: rr * 0.62, y: yn - r * 0.62, z: rr * 0.8, rz: -0.12, ry: 0.4 });
    });
  }
}

/** a flattened disc of packed, scraped snow (the trail a rolled ball leaves) */
export function trailGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2);
}

/** a wake ring on the water */
export function wakeGeometry(): THREE.BufferGeometry {
  return new THREE.RingGeometry(0.82, 1, 28, 1).rotateX(-Math.PI / 2);
}
