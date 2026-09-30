/**
 * Chibi farmer geometry, built once and instanced across every farmer. Each part carries two extra vertex
 * attributes the rig material reads:
 *   slot   — 0 keeps the baked vertex colour; 1..4 take the instance palette colour A..D (× the vertex colour as shade)
 *   vgroup — 0 always drawn; k > 0 drawn only when the instance selects group k (hair styles, hats, props)
 * so one InstancedMesh draws every hair style / hat / prop variant in a single call.
 *
 * Model faces +z; its left is +x. Pivots: legs at the hip joint, torso at the hips, arms at the shoulder, head at the
 * neck, props at the hand (arm axis is −y).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HAIR_STYLES, HATS } from './look.ts';
import { PROPS } from './pose.ts';

export const DIM = {
  legLen: 0.3,
  hipX: 0.09,
  torsoH: 0.36,
  shoulderX: 0.19,
  shoulderY: 0.29,
  armLen: 0.285,
  headR: 0.27,
  headY: 0.25,
} as const;

/** Instance palette slots. */
export const SLOT = { fixed: 0, A: 1, B: 2, C: 3, D: 4 } as const;

/** vgroup ids: hair styles 1..4, hats 10..15, props 20.. */
export const HAIR_GROUP = (s: (typeof HAIR_STYLES)[number]) => 1 + HAIR_STYLES.indexOf(s);
export const HAT_GROUP = (h: (typeof HATS)[number]) => 10 + HATS.indexOf(h);
export const PROP_GROUP = (p: (typeof PROPS)[number]) => 20 + PROPS.indexOf(p);

interface Part { g: THREE.BufferGeometry; slot: number; color: number; group: number }
const parts: Part[] = [];
const P = (g: THREE.BufferGeometry, slotOrColor: { slot: number; shade?: number } | number, group = 0): void => {
  if (typeof slotOrColor === 'number') parts.push({ g, slot: 0, color: slotOrColor, group });
  else {
    const s = slotOrColor.shade ?? 1;
    parts.push({ g, slot: slotOrColor.slot, color: new THREE.Color(s, s, s).getHex(), group });
  }
};

function finish(list: Part[]): THREE.BufferGeometry {
  const gs = list.map(({ g, slot, color, group }) => {
    let f = g.index ? g.toNonIndexed() : g.clone();
    f.deleteAttribute('uv');
    f.computeVertexNormals();
    const n = f.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3), sl = new Float32Array(n), vg = new Float32Array(n);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; sl[i] = slot; vg[i] = group; }
    f.setAttribute('color', new THREE.BufferAttribute(col, 3));
    f.setAttribute('slot', new THREE.BufferAttribute(sl, 1));
    f.setAttribute('vgroup', new THREE.BufferAttribute(vg, 1));
    for (const k of Object.keys(f.attributes)) if (!['position', 'normal', 'color', 'slot', 'vgroup'].includes(k)) f.deleteAttribute(k);
    return f;
  });
  const m = mergeGeometries(gs, false);
  if (!m) throw new Error('farmer geometry merge failed');
  m.computeBoundingSphere();
  return m;
}
const take = (): Part[] => parts.splice(0, parts.length);

// small builders --------------------------------------------------------------------------------------------------
const sph = (r: number, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt: number, rb: number, h: number, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const at = <G extends THREE.BufferGeometry>(g: G, x: number, y: number, z: number): G => { g.translate(x, y, z); return g; };
const sc = <G extends THREE.BufferGeometry>(g: G, x: number, y: number, z: number): G => { g.scale(x, y, z); return g; };
const rx = <G extends THREE.BufferGeometry>(g: G, a: number): G => { g.rotateX(a); return g; };
const ry = <G extends THREE.BufferGeometry>(g: G, a: number): G => { g.rotateY(a); return g; };
const rz = <G extends THREE.BufferGeometry>(g: G, a: number): G => { g.rotateZ(a); return g; };
const shell = (r: number, theta: number, w = 12, h = 6) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, theta);

// parts -----------------------------------------------------------------------------------------------------------

/** One leg (hangs down from the hip joint): overall leg (A) and a chunky boot (B). */
export function legGeometry(): THREE.BufferGeometry {
  P(at(cyl(0.07, 0.065, 0.2, 7), 0, -0.1, 0), { slot: SLOT.A });
  P(at(sc(sph(0.085, 8, 5), 1, 0.62, 1.35), 0, -0.25, 0.03), { slot: SLOT.B });
  P(at(cyl(0.072, 0.072, 0.03, 7), 0, -0.2, 0), { slot: SLOT.A, shade: 0.8 }); // rolled cuff
  return finish(take());
}

/** Torso from the hips: overalls (B) over a shirt (A), bib + straps, a scarf (C) at the neck. */
export function torsoGeometry(): THREE.BufferGeometry {
  const H = DIM.torsoH;
  P(at(cyl(0.18, 0.2, 0.2, 9), 0, 0.1, 0), { slot: SLOT.B }); // overall trousers
  P(at(cyl(0.155, 0.18, 0.18, 9), 0, 0.27, 0), { slot: SLOT.A }); // shirt
  P(at(sc(sph(0.16, 9, 5), 1, 0.45, 1), 0, H - 0.005, 0), { slot: SLOT.A }); // shoulders, rounded
  P(at(box(0.2, 0.15, 0.04), 0, 0.25, 0.155), { slot: SLOT.B }); // bib
  P(at(box(0.07, 0.05, 0.015), 0, 0.26, 0.18), { slot: SLOT.B, shade: 0.85 }); // bib pocket
  for (const s of [-1, 1]) {
    P(at(rz(box(0.035, 0.2, 0.03), s * 0.08), s * 0.085, 0.33, 0.13), { slot: SLOT.B }); // strap front
    P(at(rz(box(0.035, 0.24, 0.03), -s * 0.1), s * 0.085, 0.27, -0.15), { slot: SLOT.B }); // strap back
    P(at(sph(0.018, 5, 4), s * 0.08, 0.31, 0.18), 0xf2c33a); // buttons
  }
  // scarf / neckerchief in the workspace colour
  P(at(new THREE.TorusGeometry(0.1, 0.035, 5, 10).rotateX(Math.PI / 2), 0, H + 0.01, 0), { slot: SLOT.C });
  P(at(rx(new THREE.ConeGeometry(0.06, 0.11, 4), Math.PI), 0.03, H - 0.05, 0.1), { slot: SLOT.C, shade: 0.9 });
  P(at(sph(0.035, 6, 4), 0.02, H - 0.005, 0.105), { slot: SLOT.C, shade: 0.85 }); // knot
  P(at(cyl(0.05, 0.06, 0.06, 7), 0, H + 0.02, 0), { slot: SLOT.D }); // neck
  return finish(take());
}

/** One arm, hanging from the shoulder: short sleeve (A), forearm and mitten hand (B = skin). */
export function armGeometry(): THREE.BufferGeometry {
  P(at(sph(0.062, 7, 5), 0, -0.01, 0), { slot: SLOT.A }); // shoulder puff
  P(at(cyl(0.058, 0.052, 0.1, 7), 0, -0.06, 0), { slot: SLOT.A });
  P(at(cyl(0.042, 0.04, 0.16, 7), 0, -0.17, 0), { slot: SLOT.B });
  P(at(sc(sph(0.064, 7, 5), 1, 1.05, 0.9), 0, -DIM.armLen + 0.01, 0), { slot: SLOT.B });
  return finish(take());
}

/**
 * Head from the neck: skin (A) ball with ears and nose, hair styles (B) and hats (C, band D) as variant groups.
 * The face (eyes, mouth, cheeks) is a separate textured patch so expressions come from an atlas.
 */
export function headGeometry(): THREE.BufferGeometry {
  const R = DIM.headR, Y = DIM.headY;
  P(at(sc(sph(R, 12, 9), 1.04, 0.96, 1), 0, Y, 0), { slot: SLOT.A });
  for (const s of [-1, 1]) P(at(sc(sph(0.06, 6, 5), 0.6, 1, 0.8), s * R * 1.0, Y - 0.02, -0.01), { slot: SLOT.A, shade: 0.93 });
  P(at(sc(sph(0.045, 6, 4), 1.1, 0.85, 0.9), 0, Y - 0.045, R * 0.97), { slot: SLOT.A, shade: 0.95 }); // button nose

  // hair styles (B)
  const cap = (r: number, th: number, tilt: number) => at(rx(shell(r, th, 12, 6), -tilt), 0, Y, 0);
  // tuft: short crop + a curl on top
  let g = HAIR_GROUP('tuft');
  P(cap(R + 0.02, 1.45, 0.55), { slot: SLOT.B }, g);
  P(at(rz(new THREE.ConeGeometry(0.06, 0.16, 5), 0.5), -0.04, Y + R + 0.03, 0.06), { slot: SLOT.B }, g);
  P(at(sc(sph(0.1, 7, 5), 1.6, 0.55, 1), 0, Y + R * 0.72, R * 0.62), { slot: SLOT.B }, g); // fringe
  // bob: rounded helmet down to the jaw
  g = HAIR_GROUP('bob');
  P(cap(R + 0.035, 1.95, 0.75), { slot: SLOT.B }, g);
  P(at(sc(sph(0.13, 8, 5), 2.05, 0.55, 1), 0, Y + R * 0.66, R * 0.66), { slot: SLOT.B }, g);
  for (const s of [-1, 1]) P(at(sc(sph(0.09, 6, 5), 0.7, 1.4, 0.9), s * R * 0.92, Y - 0.06, 0.02), { slot: SLOT.B }, g);
  // spiky
  g = HAIR_GROUP('spiky');
  P(cap(R + 0.015, 1.35, 0.5), { slot: SLOT.B }, g);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const tilt = 0.75;
    const cg = new THREE.ConeGeometry(0.07, 0.17, 4);
    cg.translate(0, 0.08, 0);
    cg.rotateX(tilt * Math.cos(a) - 0.25);
    cg.rotateZ(-tilt * Math.sin(a));
    P(at(cg, Math.sin(a) * 0.1, Y + R * 0.82, Math.cos(a) * 0.1 - 0.03), { slot: SLOT.B }, g);
  }
  // bun
  g = HAIR_GROUP('bun');
  P(cap(R + 0.02, 1.6, 0.6), { slot: SLOT.B }, g);
  P(at(sph(0.1, 8, 6), 0, Y + R * 0.8, -R * 0.62), { slot: SLOT.B }, g);
  P(at(sc(sph(0.1, 7, 5), 1.9, 0.5, 1), 0, Y + R * 0.74, R * 0.6), { slot: SLOT.B }, g);

  // hats (C = hat colour, D = band)
  const top = Y + R * 0.62;
  g = HAT_GROUP('straw');
  {
    // tipped back a little so the face stays visible from a standing player's eye height
    const tip = (geo: THREE.BufferGeometry) => { geo.translate(0, -Y, 0); geo.rotateX(-0.22); geo.translate(0, Y, 0); return geo; };
    P(tip(at(cyl(0.42, 0.44, 0.035, 14), 0, top + 0.02, 0)), { slot: SLOT.C }, g);
    P(tip(at(cyl(0.2, 0.25, 0.2, 10), 0, top + 0.13, 0)), { slot: SLOT.C, shade: 0.94 }, g);
    P(tip(at(sc(sph(0.2, 10, 4), 1, 0.35, 1), 0, top + 0.23, 0)), { slot: SLOT.C, shade: 0.94 }, g);
    P(tip(at(cyl(0.255, 0.26, 0.055, 10), 0, top + 0.06, 0)), { slot: SLOT.D }, g);
  }
  g = HAT_GROUP('cap');
  P(at(rx(shell(R + 0.055, 1.3, 12, 5), -0.3), 0, Y + 0.015, 0), { slot: SLOT.C }, g);
  P(at(rx(sc(cyl(0.2, 0.21, 0.03, 10), 1.05, 1, 0.8), 0.18), 0, top - 0.005, R * 0.78), { slot: SLOT.C, shade: 0.8 }, g);
  P(at(sph(0.03, 5, 4), 0, Y + R + 0.04, -0.03), { slot: SLOT.D }, g);
  g = HAT_GROUP('bandana');
  P(at(rx(shell(R + 0.05, 1.3, 12, 5), -0.5), 0, Y, 0), { slot: SLOT.C }, g);
  for (const s of [-1, 1]) P(at(rz(ry(new THREE.ConeGeometry(0.05, 0.14, 4), 0), s * 1.9), s * 0.07, Y + 0.04, -R - 0.02), { slot: SLOT.C, shade: 0.85 }, g);
  P(at(sph(0.045, 5, 4), 0, Y + 0.04, -R - 0.01), { slot: SLOT.C, shade: 0.8 }, g);
  for (let i = 0; i < 5; i++) { const a = -1 + i * 0.5; P(at(sph(0.022, 4, 3), Math.sin(a) * (R + 0.02), Y + R * 0.72 + Math.cos(a * 2) * 0.02, Math.cos(a) * R * 0.55), { slot: SLOT.D }, g); } // polka dots
  g = HAT_GROUP('beanie');
  P(at(rx(shell(R + 0.06, 1.4, 12, 6), -0.3), 0, Y + 0.02, 0), { slot: SLOT.C }, g);
  P(at(rx(cyl(R + 0.065, R + 0.07, 0.08, 12), -0.3), 0, Y + 0.12, -0.035), { slot: SLOT.C, shade: 0.82 }, g);
  P(at(sph(0.075, 7, 5), 0, Y + R + 0.1, -0.06), { slot: SLOT.D }, g);
  g = HAT_GROUP('goggles');
  P(at(rx(new THREE.TorusGeometry(R + 0.012, 0.028, 5, 16), Math.PI / 2 - 0.35), 0, Y + 0.11, -0.01), { slot: SLOT.C }, g);
  for (const s of [-1, 1]) {
    P(at(rx(cyl(0.075, 0.075, 0.06, 10), Math.PI / 2 - 0.45), s * 0.095, Y + 0.155, R * 0.84), { slot: SLOT.C }, g);
    P(at(rx(cyl(0.058, 0.058, 0.065, 10), Math.PI / 2 - 0.45), s * 0.095, Y + 0.155, R * 0.86), { slot: SLOT.D }, g);
  }
  P(cap(R + 0.02, 1.25, 0.6), { slot: SLOT.B }, g); // goggle wearers keep their hair visible
  P(at(rz(new THREE.ConeGeometry(0.06, 0.16, 5), -0.4), 0.05, Y + R + 0.02, 0.0), { slot: SLOT.B }, g);
  g = HAT_GROUP('beret');
  P(at(rz(sc(sph(0.29, 12, 6), 1.08, 0.36, 1.08), 0.22), 0.03, Y + R * 0.78, -0.01), { slot: SLOT.C }, g);
  P(at(cyl(0.012, 0.012, 0.05, 4), 0.1, Y + R + 0.07, 0), { slot: SLOT.C }, g);
  P(at(rx(new THREE.OctahedronGeometry(0.055, 0), 0.2), -0.13, Y + R * 0.65, R * 0.72), { slot: SLOT.D }, g); // star pin
  return finish(take());
}

/**
 * The face patch: a slice of sphere over the front of the head with planar UVs (0..1 across the face), textured from
 * the expression atlas. Separate mesh/material; alpha-tested.
 */
export function faceGeometry(): THREE.BufferGeometry {
  const R = DIM.headR * 1.012;
  const g = new THREE.SphereGeometry(R, 16, 12, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.62, 1.3);
  g.scale(1.04, 0.96, 1);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const half = R * 0.84;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, 0.5 + pos.getX(i) / (2 * half), 0.5 + (pos.getY(i) + 0.03) / (2 * half));
  }
  g.translate(0, DIM.headY, 0);
  return g;
}

// props ---------------------------------------------------------------------------------------------------------------

const WOOD = 0xa0703f, WOOD_D = 0x6e4a2a, METAL = 0x9aa4ad, METAL_D = 0x5a646e, STRAW = 0xd9b25a;

/**
 * Every prop in one geometry, each in its own vgroup, authored in hand space (origin = hand centre, arm axis −y,
 * forward +z). Front-held props (crate, letter, book) are authored in torso space by the rig: origin in front of
 * the chest. Slot A = produce colour (basket / crate contents), D = the workspace colour (bindle cloth).
 */
export function propGeometry(): THREE.BufferGeometry {
  let g = PROP_GROUP('hoe');
  P(at(rx(cyl(0.018, 0.018, 1.05, 5), Math.PI / 2), 0, 0, 0.3), WOOD, g);
  P(at(box(0.16, 0.12, 0.02), 0, -0.07, 0.82), METAL_D, g);
  g = PROP_GROUP('trowel');
  P(at(cyl(0.022, 0.022, 0.1, 5), 0, -0.07, 0), WOOD, g);
  P(at(sc(new THREE.ConeGeometry(0.045, 0.14, 4), 1, 1, 0.3), 0, -0.19, 0).rotateY(Math.PI / 4), METAL, g);
  g = PROP_GROUP('can');
  P(at(rz(cyl(0.012, 0.012, 0.14, 4), Math.PI / 2), 0, 0, 0), METAL_D, g); // handle through the fist
  P(at(cyl(0.1, 0.11, 0.2, 9), 0, -0.14, -0.02), 0x5aa9d6, g);
  P(at(rx(cyl(0.018, 0.03, 0.26, 6), -1.0), 0, -0.1, 0.17), 0x5aa9d6, g);
  P(at(rx(cyl(0.045, 0.02, 0.04, 7), -1.0), 0, -0.02, 0.28), 0x4a8fbf, g); // rose
  P(at(cyl(0.102, 0.102, 0.03, 9), 0, -0.1, -0.02), 0x4a8fbf, g);
  g = PROP_GROUP('crate');
  P(at(box(0.44, 0.26, 0.32), 0, 0, 0), WOOD, g);
  for (const y of [-0.08, 0.08]) P(at(box(0.46, 0.035, 0.34), 0, y, 0), WOOD_D, g);
  for (let i = 0; i < 6; i++) P(at(sph(0.06, 6, 5), -0.14 + (i % 3) * 0.14, 0.15, -0.07 + Math.floor(i / 3) * 0.14), { slot: SLOT.A }, g);
  g = PROP_GROUP('basket');
  P(at(cyl(0.16, 0.12, 0.14, 9), 0, -0.27, 0), STRAW, g);
  P(at(cyl(0.165, 0.165, 0.025, 9), 0, -0.2, 0), 0xb8914a, g);
  P(at(new THREE.TorusGeometry(0.14, 0.014, 4, 10, Math.PI), 0, -0.2, 0), 0xb8914a, g);
  for (let i = 0; i < 5; i++) P(at(sph(0.055, 6, 5), Math.cos(i * 1.3) * 0.08, -0.17 + (i === 4 ? 0.04 : 0), Math.sin(i * 1.3) * 0.08), { slot: SLOT.A }, g);
  g = PROP_GROUP('rod');
  P(at(rx(cyl(0.012, 0.02, 1.7, 5), Math.PI / 2 - 0.5), 0, 0.35, 0.75), 0x8a5a3a, g);
  P(at(cyl(0.004, 0.004, 1.1, 3), 0, 0.2, 1.5), 0xeeeeee, g);
  P(at(sph(0.035, 6, 4), 0, -0.36, 1.5), 0xe0404a, g); // bobber
  g = PROP_GROUP('notebook');
  P(at(box(0.18, 0.02, 0.24), 0, -0.02, 0.08), 0x7a4a8a, g);
  P(at(box(0.165, 0.025, 0.225), 0.005, -0.005, 0.08), 0xf6f1e6, g);
  g = PROP_GROUP('magnifier');
  P(at(cyl(0.02, 0.02, 0.12, 5), 0, 0.02, 0), WOOD_D, g);
  P(at(rx(new THREE.TorusGeometry(0.075, 0.018, 5, 12), 0), 0, 0.16, 0), 0xc9a24a, g);
  P(at(rx(cyl(0.07, 0.07, 0.01, 12), Math.PI / 2), 0, 0.16, 0), 0xcfeeff, g);
  g = PROP_GROUP('hammer');
  P(at(rx(cyl(0.018, 0.018, 0.32, 5), Math.PI / 2), 0, 0, 0.1), WOOD, g);
  P(at(box(0.07, 0.16, 0.07), 0, 0, 0.26), METAL_D, g);
  g = PROP_GROUP('saw');
  P(at(box(0.05, 0.1, 0.1), 0, 0, 0), WOOD, g);
  P(at(sc(new THREE.BoxGeometry(0.01, 0.13, 0.5), 1, 1, 1), 0, -0.02, 0.3), METAL, g);
  g = PROP_GROUP('letter');
  P(at(rx(box(0.22, 0.15, 0.012), -0.5), 0, 0, 0), 0xf8f0dc, g);
  P(at(rx(box(0.05, 0.05, 0.014), -0.5), 0.05, 0.01, 0.005), 0xd9453b, g); // wax seal
  g = PROP_GROUP('bindle');
  P(at(rx(cyl(0.015, 0.015, 0.95, 5), Math.PI / 2), 0, 0, -0.3), WOOD, g);
  P(at(sph(0.14, 7, 6), 0, -0.08, -0.72), { slot: SLOT.D }, g);
  P(at(sc(sph(0.045, 5, 4), 1, 0.6, 1), 0, 0.04, -0.72), { slot: SLOT.D, shade: 0.8 }, g);
  g = PROP_GROUP('broom');
  P(at(cyl(0.017, 0.017, 1.0, 5), 0, -0.2, 0), WOOD, g);
  P(at(cyl(0.05, 0.12, 0.22, 7), 0, -0.78, 0), STRAW, g);
  P(at(cyl(0.055, 0.055, 0.03, 7), 0, -0.68, 0), 0xb8483a, g);
  g = PROP_GROUP('brush');
  P(at(box(0.08, 0.04, 0.16), 0, -0.07, 0.02), WOOD, g);
  P(at(box(0.07, 0.04, 0.14), 0, -0.11, 0.02), 0x3a2f28, g);
  g = PROP_GROUP('book');
  for (const s of [-1, 1]) P(at(rz(box(0.15, 0.2, 0.02), s * 0.25), s * 0.075, 0, 0), 0x4f7f4a, g);
  for (const s of [-1, 1]) P(at(rz(box(0.13, 0.18, 0.02), s * 0.25), s * 0.07, 0.003, 0.012), 0xf6f1e6, g);
  g = PROP_GROUP('post');
  P(at(cyl(0.04, 0.04, 0.45, 6), 0, -0.1, 0.1), WOOD_D, g);
  return finish(take());
}

/** Duckling: a fuzzy yellow ball body with a head, beak and dot eyes (all baked colours). Faces +z, feet at 0. */
export function ducklingGeometry(): THREE.BufferGeometry {
  P(at(sc(sph(0.1, 8, 6), 1, 0.85, 1.2), 0, 0.1, 0), 0xffd84a);
  P(at(sph(0.075, 8, 6), 0, 0.22, 0.07), 0xffe16a);
  P(at(sc(new THREE.ConeGeometry(0.035, 0.07, 4), 1.4, 1, 0.6).rotateX(Math.PI / 2), 0, 0.21, 0.16), 0xf08a2a);
  for (const s of [-1, 1]) {
    P(at(sph(0.014, 4, 3), s * 0.04, 0.24, 0.135), 0x22201e);
    P(at(sc(sph(0.045, 5, 4), 0.4, 0.8, 1.2), s * 0.095, 0.11, -0.01), 0xf5c93a); // wings
  }
  P(at(rx(new THREE.ConeGeometry(0.04, 0.08, 4), -1.9), 0, 0.14, -0.13), 0xf5c93a); // tail
  for (const s of [-1, 1]) P(at(box(0.04, 0.012, 0.06), s * 0.04, 0.005, 0.02), 0xf08a2a);
  return finish(take());
}

/** Egg halves for hatching (shell cracks open around a new duckling). */
export function eggGeometry(): THREE.BufferGeometry {
  P(at(sc(new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 1, 1.3, 1), 0, 0.14, 0), 0xf6f1e6);
  P(at(sc(new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 1, 1.5, 1), 0, 0.14, 0), 0xfaf5ea, 1); // top half (group 1)
  for (let i = 0; i < 4; i++) P(at(sph(0.018, 4, 3), Math.cos(i * 1.7) * 0.1, 0.16 + (i % 2) * 0.06, Math.sin(i * 1.7) * 0.1), 0x9ac8e0, 1); // speckles
  return finish(take());
}
