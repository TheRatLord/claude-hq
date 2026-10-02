/**
 * Models for the player's pastimes: the season's forageables (sculpted, low-poly, base at y = 0, about palm-sized and
 * a little exaggerated so they read from eye height), the catch (one parametric fish per species, plus the junk),
 * the fishing rod, the bobber and the glint star. Every geometry is non-indexed with position / normal / colour, so a
 * kind merges into one mesh and instances in one draw.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint } from '../toon.ts';
import { blob, loft } from '../sculpt.ts';
import type { Face, Ring } from '../sculpt.ts';
import { partName, recordParts } from '../parts.ts';
import { collectDef } from '../../model/collection.ts';
import type { FishDef } from '../../model/collection.ts';

type V3 = readonly [number, number, number];
const C = (hex: number | string) => new THREE.Color(hex).getHex();

/** a three primitive, flat-shaded and painted one colour */
function prim(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(f.attributes)) if (k !== 'position') f.deleteAttribute(k);
  f.computeVertexNormals();
  return paint(f, color);
}

/** merge parts (all position / normal / colour), keeping named parts for the placement audit */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') p.deleteAttribute(k);
  const g = mergeGeometries(parts)!;
  recordParts(g, parts);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** turn a geometry about y, then move it */
const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0) => g.rotateY(yaw).translate(x, y, z);

/**
 * A leaf lying along +z from the origin: `len` long, `wid` wide, arching up `lift` and drooping at the tip. `pitch`
 * raises it from the ground (radians), then it turns by `yaw`. `edge(t)` scales the width along the leaf (spiky holly).
 */
function leaf(len: number, wid: number, o: { pitch?: number; yaw?: number; lift?: number; base: number; tip: number; edge?: (t: number) => number; thick?: number; sides?: number }): THREE.BufferGeometry {
  const rings: Ring[] = [];
  const K = 6;
  for (let i = 0; i <= K; i++) {
    const t = i / K;
    const w = wid * Math.sin(Math.PI * Math.min(0.97, 0.06 + t * 0.94)) ** 0.8 * (o.edge ? o.edge(t) : 1);
    rings.push({ p: [0, (o.lift ?? 0) * Math.sin(Math.PI * t * 0.8), t * len], r: [Math.max(0.002, w), o.thick ?? 0.006], e: 2 });
  }
  const g = loft(rings, { sides: o.sides ?? 6, sub: 1, paint: (f) => mix(o.base, o.tip, f.t) });
  g.rotateX(-(o.pitch ?? 0));
  g.rotateY(o.yaw ?? 0);
  return g;
}
const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t))).getHex();

/** a vertical stalk from y0 to y1 with a little lean */
function stalk(x: number, z: number, y0: number, y1: number, r: number, color: number, lean: V3 = [0, 0, 0]): THREE.BufferGeometry {
  return loft([
    { p: [x, y0, z], r }, { p: [x + lean[0] * 0.5, (y0 + y1) / 2, z + lean[2] * 0.5], r: r * 0.9 }, { p: [x + lean[0], y1, z + lean[2]], r: r * 0.8 },
  ], { sides: 5, sub: 1, caps: ['flat', 'flat'], paint: color });
}

const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------------------------------------- forage

function morel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const one = (x: number, z: number, s: number, lean: number) => {
    parts.push(partName(stalk(x, z, 0, 0.07 * s, 0.026 * s, C(0xf1e6cc)), 'stem'));
    const pits = (f: Face) => ((Math.floor(f.t * 7) + Math.floor((f.a / (Math.PI * 2)) * 9 + f.t * 2)) % 2 ? C(0x6e4a2a) : C(0xb8925e));
    parts.push(partName(loft([
      { p: [x, 0.06 * s, z], r: 0.03 * s }, { p: [x + lean * 0.3, 0.1 * s, z], r: 0.046 * s }, { p: [x + lean * 0.6, 0.16 * s, z], r: 0.04 * s },
      { p: [x + lean, 0.21 * s, z], r: 0.02 * s },
    ], { sides: 9, sub: 2, caps: ['flat', 'pole'], round: 0.9, paint: pits, bump: (a, t) => 1 + 0.08 * Math.cos(a * 9 + t * 12) }), 'cap'));
  };
  one(0, 0, 1.35, 0.01);
  one(0.09, 0.05, 1.0, -0.012);
  one(-0.06, 0.07, 0.8, 0.015);
  return merge(parts);
}

function wildleek(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bunch = (x: number, z: number, s: number, yaw0: number) => {
    for (let i = 0; i < 3; i++) {
      const yaw = yaw0 + (i / 3) * Math.PI * 2;
      parts.push(partName(stalk(x, z, 0, 0.06 * s, 0.012 * s, C(0xb8506a), [Math.sin(yaw) * 0.01, 0, Math.cos(yaw) * 0.01]), 'stem'));
      parts.push(partName(place(leaf(0.26 * s, 0.05 * s, { pitch: 0.95, yaw, lift: 0.03 * s, base: C(0x4f9a3f), tip: C(0x8fd06a) }), x + Math.sin(yaw) * 0.01, 0.05 * s, z + Math.cos(yaw) * 0.01), 'leaf'));
    }
  };
  bunch(0, 0, 1.2, 0.3);
  bunch(0.11, -0.04, 0.9, 1.4);
  return merge(parts);
}

function violet(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const yaw = i * 1.05 + 0.2;
    parts.push(partName(place(leaf(0.11, 0.075, { pitch: 0.35, yaw, lift: 0.01, base: C(0x3f7f3a), tip: C(0x6cb24f), thick: 0.005 }), 0, 0.012, 0), 'leaf'));
  }
  const flower = (x: number, z: number, h: number) => {
    parts.push(partName(stalk(0, 0, 0.01, h, 0.006, C(0x4f8a3a), [x, 0, z]), 'stem'));
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      const lower = p === 0 || p === 4;
      parts.push(partName(blob([x + Math.sin(a) * 0.022, h + Math.cos(a) * 0.016, z + 0.012], [0.017, lower ? 0.022 : 0.018, 0.006], { paint: lower ? C(0x7a4fbf) : C(0x9a6ad8), sides: 6, rings: 3 }), 'petal'));
    }
    parts.push(partName(blob([x, h, z + 0.018], [0.007, 0.007, 0.005], { paint: C(0xf6d23a), sides: 5, rings: 2 }), 'eye'));
  };
  flower(0.0, 0.03, 0.13);
  flower(0.06, -0.03, 0.105);
  flower(-0.055, -0.01, 0.115);
  return merge(parts);
}

function berries(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const yaw = i * 2.1 + 2.6;
    const lx = Math.sin(yaw) * 0.03, lz = Math.cos(yaw) * 0.03 - 0.03;
    parts.push(partName(stalk(0, -0.03, 0, 0.035, 0.006, C(0x5c8a3a), [lx, 0, lz + 0.03]), 'stem'));
    for (let k = -1; k <= 1; k++) parts.push(partName(place(leaf(0.07, 0.045, { pitch: 0.12, yaw: yaw + k * 0.75, base: C(0x3f8a3a), tip: C(0x7cc25a), thick: 0.005 }), lx, 0.035, lz), 'leaf'));
  }
  const berry = (x: number, z: number, s: number, lean: number) => {
    const seeds = (f: Face) => (hash(f.x * 700 + f.z * 300, f.y * 900) > 0.86 ? C(0xf6d86a) : C(0xe0303f));
    parts.push(partName(loft([
      { p: [x, 0.05 * s, z], r: 0.026 * s }, { p: [x + lean * 0.4, 0.032 * s, z], r: 0.03 * s }, { p: [x + lean, 0.006, z], r: 0.007 * s },
    ], { sides: 8, sub: 2, caps: ['flat', 'pole'], paint: seeds }), 'berry'));
    parts.push(partName(blob([x, 0.053 * s, z], [0.024 * s, 0.006, 0.024 * s], { paint: C(0x4f9a3f), sides: 6, rings: 2, bump: (a) => 1 + 0.3 * Math.cos(a * 5) }), 'calyx'));
  };
  berry(0.06, 0.06, 1.3, 0.01);
  berry(-0.06, 0.05, 1.15, -0.01);
  berry(0.0, 0.1, 1.2, 0.0);
  berry(0.1, -0.01, 1.0, 0.01);
  return merge(parts);
}

function feather(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const L = 0.44;
  const rings: Ring[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const w = 0.055 * Math.sin(Math.PI * (0.12 + t * 0.86)) ** 0.6 * (t < 0.15 ? t / 0.15 : 1);
    rings.push({ p: [0.012 * Math.sin(t * 3), 0.012 + 0.025 * Math.sin(Math.PI * t), t * L], r: [Math.max(0.003, w), 0.004] });
  }
  const bars = (f: Face) => {
    if (f.t < 0.12) return C(0xe8eef4);
    if (f.t > 0.9) return C(0x1f2a3a);
    return Math.floor(f.t * 13) % 3 === 0 ? C(0x1f2a3a) : Math.abs(f.x) > 0.03 ? C(0x7fb8f0) : C(0x3f78c8);
  };
  parts.push(partName(loft(rings, { sides: 6, sub: 2, paint: bars }), 'vane'));
  parts.push(partName(loft([{ p: [0, 0.004, -0.06], r: 0.004 }, { p: [0, 0.012, 0.0], r: 0.005 }, { p: [0.01, 0.035, L * 0.6], r: 0.003 }], { sides: 4, sub: 2, paint: C(0xf2ece0) }), 'quill'));
  const g = merge(parts);
  return g.translate(0, 0, -L * 0.4);
}

function shell(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const one = (x: number, z: number, s: number, yaw: number) => {
    const g = new THREE.SphereGeometry(0.08 * s, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vz = p.getZ(i), a = Math.atan2(vz, vx);
      const k = 1 + 0.07 * Math.cos(a * 11);
      p.setXYZ(i, vx * k, p.getY(i) * 0.45 * (1 + 0.05 * Math.cos(a * 11)), vz * k * 0.9 + (0.08 * s - Math.hypot(vx, vz)) * 0.25);
    }
    const f = g.toNonIndexed();
    f.deleteAttribute('uv');
    f.computeVertexNormals();
    const col = new Float32Array(f.attributes.position.count * 3), c = new THREE.Color();
    const fp = f.attributes.position;
    for (let i = 0; i < fp.count; i += 3) {
      const cx = (fp.getX(i) + fp.getX(i + 1) + fp.getX(i + 2)) / 3, cz = (fp.getZ(i) + fp.getZ(i + 1) + fp.getZ(i + 2)) / 3;
      const a = Math.atan2(cz, cx), d = Math.hypot(cx, cz) / (0.08 * s);
      c.set(Math.floor((a + Math.PI) / (Math.PI * 2) * 11 + 0.5) % 2 ? 0xf0dccb : 0xd8a898).lerp(new THREE.Color(0xfff6ec), Math.max(0, 0.6 - d));
      for (let j = 0; j < 3; j++) { col[(i + j) * 3] = c.r; col[(i + j) * 3 + 1] = c.g; col[(i + j) * 3 + 2] = c.b; }
    }
    f.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(partName(place(f, x, -0.002, z, yaw), 'shell'));
    parts.push(partName(place(prim(new THREE.BoxGeometry(0.05 * s, 0.012 * s, 0.025 * s), C(0xd8b8a0)), 0, 0.006 * s, -0.08 * s * 0.9).rotateY(yaw).translate(x, 0, z), 'hinge'));
  };
  one(0, 0, 1.25, 0.2);
  one(0.13, 0.06, 0.75, -1.1);
  return merge(parts);
}

function skipstone(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const speck = (f: Face) => (hash(f.x * 90, f.z * 90) > 0.82 ? C(0xc8d0d8) : f.ny > 0.6 ? C(0x9aa6b2) : C(0x7d8894));
  parts.push(partName(blob([0, 0.022, 0], [0.1, 0.024, 0.085], { paint: speck, sides: 12, rings: 4 }), 'stone'));
  parts.push(partName(blob([0.13, 0.014, 0.05], [0.04, 0.016, 0.035], { paint: C(0xb7b0a3), sides: 8, rings: 3 }), 'pebble'));
  parts.push(partName(blob([-0.1, 0.012, 0.08], [0.03, 0.014, 0.028], { paint: C(0x8c8476), sides: 8, rings: 3 }), 'pebble'));
  return merge(parts);
}

function chanterelle(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const one = (x: number, z: number, s: number) => {
    const gill = (f: Face) => (f.ny < -0.1 ? C(0xf6c45a) : f.t > 0.75 ? C(0xe8902a) : C(0xf2a83a));
    parts.push(partName(loft([
      { p: [x, 0, z], r: 0.017 * s }, { p: [x, 0.05 * s, z], r: 0.02 * s }, { p: [x, 0.095 * s, z], r: 0.052 * s }, { p: [x, 0.112 * s, z], r: 0.07 * s },
      { p: [x, 0.106 * s, z], r: 0.05 * s }, { p: [x, 0.095 * s, z], r: 0.02 * s },
    ], { sides: 11, sub: 2, caps: ['flat', 'pole'], round: 0.3, paint: gill, bump: (a, t) => 1 + (t > 0.5 ? 0.12 * Math.cos(a * 5) : 0) }), 'mushroom'));
  };
  one(0, 0, 1.45);
  one(0.1, 0.04, 1.05);
  one(-0.05, 0.09, 0.85);
  return merge(parts);
}

function acorn(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const one = (x: number, z: number, s: number, yaw: number) => {
    const nut = loft([
      { p: [0, 0, -0.035 * s], r: 0.028 * s }, { p: [0, 0, 0.0], r: 0.031 * s }, { p: [0, 0, 0.035 * s], r: 0.02 * s }, { p: [0, 0, 0.05 * s], r: 0.004 * s },
    ], { sides: 9, sub: 2, caps: ['flat', 'pole'], paint: (f) => (f.t > 0.85 ? C(0x6e4a2a) : f.ny > 0.5 ? C(0xc89a5a) : C(0xa8763f)) });
    const cup = loft([{ p: [0, 0, -0.05 * s], r: 0.012 * s }, { p: [0, 0, -0.042 * s], r: 0.03 * s }, { p: [0, 0, -0.02 * s], r: 0.035 * s }],
      { sides: 9, sub: 2, caps: ['pole', 'flat'], paint: (f) => ((Math.floor(f.a * 2.2) + Math.floor(f.t * 4)) % 2 ? C(0x7a5534) : C(0x9a7046)), bump: (a, t) => 1 + 0.08 * Math.cos(a * 9 + t * 8) });
    const stem = loft([{ p: [0, 0, -0.05 * s], r: 0.005 * s }, { p: [0.004, 0.006, -0.068 * s], r: 0.004 * s }], { sides: 4, sub: 1, paint: C(0x5e3f28) });
    for (const [g, n] of [[nut, 'nut'], [cup, 'cup'], [stem, 'stalk']] as const) parts.push(partName(place(g, 0, 0.03 * s, 0, yaw).translate(x, 0, z), n));
  };
  one(0, 0, 1.6, 0.4);
  one(0.1, 0.05, 1.3, 2.3);
  parts.push(partName(place(leaf(0.16, 0.07, { pitch: 0.05, yaw: -0.8, lift: 0.01, base: C(0x8a7a3a), tip: C(0xd8a040), edge: (t) => 1 + 0.25 * Math.sin(t * Math.PI * 6) }), -0.06, 0.008, -0.03), 'leaf'));
  return merge(parts);
}

function hazelnut(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const one = (x: number, z: number, s: number, tilt: number) => {
    const nut = blob([0, 0.035 * s, 0], [0.034 * s, 0.036 * s, 0.032 * s], { paint: (f) => (f.y < 0.012 * s ? C(0xe8d0a0) : f.nx > 0.3 ? C(0xc8905a) : C(0xa8703f)), sides: 9, rings: 4, tilt: Math.PI / 2 });
    const husk = loft([{ p: [0, 0.002, 0], r: 0.012 * s }, { p: [0, 0.02 * s, 0], r: 0.036 * s }, { p: [0, 0.045 * s, 0], r: 0.044 * s }],
      { sides: 10, sub: 2, caps: ['pole', 'open'], paint: (f) => (f.t > 0.6 ? C(0x9aa04a) : C(0x7a8a3a)), bump: (a, t) => 1 + t * 0.22 * Math.abs(Math.cos(a * 5)) });
    // the open husk shows its inside too: a second, inward-facing shell
    const inner = husk.clone();
    const ip = inner.attributes.position;
    for (let i = 0; i < ip.count; i += 3) { const ax = ip.getX(i + 1), ay = ip.getY(i + 1), az = ip.getZ(i + 1); ip.setXYZ(i + 1, ip.getX(i + 2), ip.getY(i + 2), ip.getZ(i + 2)); ip.setXYZ(i + 2, ax, ay, az); }
    inner.scale(0.94, 1, 0.94);
    inner.computeVertexNormals();
    for (const [g, n] of [[nut, 'nut'], [husk, 'husk'], [inner, 'husk']] as const) parts.push(partName(g.rotateZ(tilt).translate(x, 0, z), n));
  };
  one(0, 0, 1.5, 0.15);
  one(0.09, 0.05, 1.25, -0.25);
  one(-0.02, 0.1, 1.1, 0.3);
  return merge(parts);
}

function mapleleaf(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shape = new THREE.Shape();
  const N = 60, R = 0.13;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    // five pointed lobes (the bottom one notched for the stem)
    const lobe = Math.abs(Math.cos(a * 2.5 + Math.PI / 2 * 0));
    let r = R * (0.45 + 0.55 * lobe ** 3) * (1 + 0.12 * Math.abs(Math.sin(a * 12.5)));
    const down = Math.abs(((a - Math.PI * 1.5 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (down < 0.5) r *= 0.35 + down;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) + 0.008 + 0.9 * (x * x) * 1.2 + 0.25 * Math.max(0, -z) * 0.3); }
  const f = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(f.attributes)) if (k !== 'position') f.deleteAttribute(k);
  f.computeVertexNormals();
  const col = new Float32Array(f.attributes.position.count * 3), c = new THREE.Color();
  const fp = f.attributes.position;
  for (let i = 0; i < fp.count; i += 3) {
    const cx = (fp.getX(i) + fp.getX(i + 1) + fp.getX(i + 2)) / 3, cz = (fp.getZ(i) + fp.getZ(i + 1) + fp.getZ(i + 2)) / 3;
    const d = Math.hypot(cx, cz) / R;
    c.set(0xf2b830).lerp(new THREE.Color(0xd8402a), Math.min(1, d * 1.3)).lerp(new THREE.Color(0xa82a2a), Math.max(0, d - 0.8));
    for (let j = 0; j < 3; j++) { col[(i + j) * 3] = c.r; col[(i + j) * 3 + 1] = c.g; col[(i + j) * 3 + 2] = c.b; }
  }
  f.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.push(partName(f, 'leaf'));
  parts.push(partName(loft([{ p: [0, 0.01, 0.02], r: 0.004 }, { p: [0, 0.012, 0.09], r: 0.004 }, { p: [0.01, 0.02, 0.13], r: 0.003 }], { sides: 4, sub: 1, paint: C(0x8a3a2a) }), 'stalk'));
  return merge(parts).rotateY(0.6);
}

function holly(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(loft([{ p: [-0.12, 0.012, -0.02], r: 0.008 }, { p: [0, 0.02, 0], r: 0.009 }, { p: [0.1, 0.018, 0.03], r: 0.007 }], { sides: 5, sub: 2, paint: C(0x5e3f28) }), 'twig'));
  const spikes = (t: number) => 1 + 0.4 * Math.abs(Math.sin(t * Math.PI * 4.5));
  const L: [number, number, number][] = [[-0.08, 2.1, 0.3], [-0.03, -1.2, 0.35], [0.03, 1.9, 0.25], [0.07, -1.5, 0.3], [0.1, 0.2, 0.4]];
  for (const [x, yaw, pitch] of L) parts.push(partName(place(leaf(0.13, 0.045, { pitch, yaw, lift: 0.012, base: C(0x1f5a2f), tip: C(0x3f8f4a), edge: spikes, thick: 0.007 }), x, 0.018, x * 0.3), 'leaf'));
  for (const [x, z] of [[0.0, 0.0], [0.028, 0.012], [0.008, 0.03]] as const) parts.push(partName(blob([x, 0.05, z], [0.022, 0.022, 0.022], { paint: (f) => (f.ny > 0.7 && f.nx < 0 ? C(0xff8a7a) : C(0xd02a2a)), sides: 7, rings: 3 }), 'berry'));
  return merge(parts);
}

function pinecone(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const one = (x: number, z: number, s: number, yaw: number) => {
    const scales = (f: Face) => ((Math.floor(f.t * 9) + Math.floor((f.a / (Math.PI * 2)) * 8 + f.t * 4)) % 2 ? C(0x8a5a32) : C(0xb8824a));
    const g = loft([
      { p: [0, 0, -0.07 * s], r: 0.015 * s }, { p: [0, 0, -0.04 * s], r: 0.042 * s }, { p: [0, 0, 0.0], r: 0.046 * s },
      { p: [0, 0, 0.05 * s], r: 0.03 * s }, { p: [0, 0, 0.08 * s], r: 0.008 * s },
    ], { sides: 10, sub: 3, caps: ['flat', 'pole'], paint: scales, bump: (a, t) => 1 + 0.16 * (((Math.floor(t * 18) + Math.floor((a / (Math.PI * 2)) * 8 + t * 4)) % 2) ? 1 : -0.4) });
    parts.push(partName(place(g, 0, 0.042 * s, 0, yaw).translate(x, 0, z), 'cone'));
  };
  one(0, 0, 1.5, 0.5);
  one(0.12, 0.08, 1.1, -0.9);
  return merge(parts);
}

function crystal(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(blob([0, 0.03, 0], [0.12, 0.05, 0.1], { paint: (f) => (f.ny > 0.6 ? C(0xb7b0a3) : C(0x8c8476)), sides: 9, rings: 4 }), 'rock'));
  const P: [number, number, number, number, number][] = [[0, 0, 0.2, 0.035, 0], [0.04, 0.02, 0.14, 0.027, 0.45], [-0.04, 0.015, 0.12, 0.024, -0.5], [0.01, -0.04, 0.1, 0.022, 0.4], [-0.02, 0.05, 0.08, 0.02, -0.35]];
  P.forEach(([x, z, h, r, lean], i) => {
    const body = prim(new THREE.CylinderGeometry(r, r * 1.1, h, 6), C(0x9fd8f0)).translate(0, h / 2, 0);
    const tip = prim(new THREE.ConeGeometry(r, r * 2, 6), C(0xe8f8ff)).translate(0, h + r, 0);
    for (const [g, n] of [[body, 'prism'], [tip, 'prism']] as const) parts.push(partName(g.rotateZ(lean).rotateY(i * 1.3).translate(x, 0.03, z), n));
  });
  return merge(parts);
}

/** the grotto's glow-caps (scene/grotto): a little clump of pale-stemmed mushrooms with sea-green caps on a moss tuft */
function glowcap(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(blob([0, 0.012, 0], [0.11, 0.025, 0.09], { paint: (f) => (f.ny > 0.5 ? C(0x5e8a4a) : C(0x3f6a3a)), sides: 9, rings: 3 }), 'moss'));
  const caps: [number, number, number, number][] = [[0, 0, 0.11, 1], [0.05, 0.03, 0.075, 0.75], [-0.045, 0.025, 0.06, 0.6], [0.02, -0.05, 0.05, 0.5]];
  for (const [x, z, h, s] of caps) {
    parts.push(partName(stalk(x, z, 0.01, h, 0.009 * s + 0.004, C(0xe8f6ee), [x * 0.3, 0, z * 0.3]), 'stem'));
    parts.push(partName(blob([x * 1.3, h, z * 1.3], [0.034 * s + 0.01, 0.022 * s + 0.008, 0.034 * s + 0.01], {
      paint: (f) => (f.ny < -0.2 ? C(0xbff8e0) : (f.t * 7 + f.a) % 2 < 0.25 ? C(0xe8fff4) : C(0x7ff0c8)), sides: 9, rings: 3,
    }), 'cap'));
  }
  return merge(parts);
}

/** the hillside orchard's fruit (scene/orchard), sitting on the ground: a body, a stalk and a leaf */
function fruit(color: number, sy: number, s: number, blush?: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = 0.07 * s;
  parts.push(partName(blob([0, r * sy, 0], [r, r * sy, r], { paint: (f) => (blush !== undefined && f.nx < -0.2 && f.ny > -0.3 ? blush : color), sides: 10, rings: 6 }), 'fruit'));
  parts.push(partName(stalk(0, 0, r * sy * 1.9, r * sy * 2.5, 0.006, C(0x6a4424), [0.01, 0, 0]), 'stalk'));
  parts.push(partName(place(leaf(0.06 * s, 0.025 * s, { pitch: 0.3, base: C(0x3f7a2f), tip: C(0x7ab84a) }), 0.005, r * sy * 2.3, 0, 0.8), 'leaf'));
  return merge(parts);
}
const apple = () => fruit(C(0xd8402e), 0.92, 1, C(0xf2a040));
const pear = () => fruit(C(0xd0c454), 1.3, 0.95, C(0xc8a040));
const plum = () => fruit(C(0x6a3a8a), 1.08, 0.85, C(0x9a6ab8));
function cherry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-0.035, 0], [0.035, 0.012]] as const) {
    parts.push(partName(blob([x, 0.035, z], [0.035, 0.034, 0.035], { paint: (f) => (f.nx < -0.3 && f.ny > 0 ? C(0xff7a8a) : C(0xc81a36)), sides: 9, rings: 5 }), 'cherry'));
    parts.push(partName(loft([{ p: [x, 0.065, z], r: 0.004 }, { p: [x * 0.4, 0.12, z * 0.5], r: 0.004 }, { p: [0, 0.15, 0.005], r: 0.003 }], { sides: 4, sub: 2, paint: C(0x5a7a2a) }), 'stalk'));
  }
  parts.push(partName(place(leaf(0.07, 0.03, { pitch: 0.4, base: C(0x3f7a2f), tip: C(0x7ab84a) }), 0, 0.15, 0.005, -0.6), 'leaf'));
  return merge(parts);
}
function honey(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(prim(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 9), C(0xe8a422)).translate(0, 0.05, 0), 'jar'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.056, 0.056, 0.022, 9), C(0xd9453b)).translate(0, 0.11, 0), 'lid'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.051, 0.051, 0.04, 9, 1, true), C(0xf6efe0)).translate(0, 0.055, 0), 'label'));
  return merge(parts);
}
function cider(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(prim(new THREE.CylinderGeometry(0.04, 0.042, 0.14, 8), C(0x5a8a4a)).translate(0, 0.07, 0), 'bottle'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.014, 0.03, 0.06, 7), C(0x5a8a4a)).translate(0, 0.17, 0), 'neck'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 6), C(0xb98a4a)).translate(0, 0.21, 0), 'cork'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.0425, 0.0425, 0.05, 8, 1, true), C(0xe8b04a)).translate(0, 0.07, 0), 'label'));
  return merge(parts);
}

const FORAGE_BUILD: Record<string, () => THREE.BufferGeometry> = {
  morel, wildleek, violet, berries, feather, shell, skipstone, chanterelle, acorn, hazelnut, mapleleaf, holly, pinecone, crystal, glowcap,
  apple, pear, plum, cherry, honey, cider,
};
const forageCache = new Map<string, THREE.BufferGeometry>();
/** a forageable's geometry (cached; base at y = 0) */
export function forageGeometry(id: string): THREE.BufferGeometry {
  let g = forageCache.get(id);
  if (!g) { g = (FORAGE_BUILD[id] ?? skipstone)(); forageCache.set(id, g); }
  return g;
}
/** footprint radius of a forageable (placement spacing) */
export function forageRadius(id: string): number {
  const b = forageGeometry(id).boundingBox!;
  return Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
}

// ------------------------------------------------------------------------------------------------- fish

interface Shape { len: number; depth: number; width: number; head: number; tail: number; dorsal: number; whiskers?: boolean; slender?: boolean; blind?: boolean }
const SHAPES: Record<string, Shape> = {
  minnow: { len: 0.2, depth: 0.045, width: 0.025, head: 0.3, tail: 0.06, dorsal: 0.4 },
  bluegill: { len: 0.24, depth: 0.12, width: 0.04, head: 0.35, tail: 0.08, dorsal: 1.2 },
  carp: { len: 0.42, depth: 0.13, width: 0.075, head: 0.3, tail: 0.11, dorsal: 1.4 },
  perch: { len: 0.3, depth: 0.09, width: 0.045, head: 0.35, tail: 0.08, dorsal: 1.6 },
  trout: { len: 0.4, depth: 0.09, width: 0.05, head: 0.3, tail: 0.1, dorsal: 0.8 },
  salmon: { len: 0.5, depth: 0.12, width: 0.065, head: 0.3, tail: 0.12, dorsal: 0.8 },
  pike: { len: 0.58, depth: 0.08, width: 0.055, head: 0.25, tail: 0.1, dorsal: 0.6, slender: true },
  catfish: { len: 0.45, depth: 0.09, width: 0.08, head: 0.45, tail: 0.09, dorsal: 0.7, whiskers: true },
  eel: { len: 0.7, depth: 0.045, width: 0.04, head: 0.3, tail: 0.04, dorsal: 0.3, slender: true },
  koi: { len: 0.42, depth: 0.12, width: 0.07, head: 0.3, tail: 0.13, dorsal: 1.2, whiskers: true },
  stormbass: { len: 0.42, depth: 0.13, width: 0.07, head: 0.4, tail: 0.1, dorsal: 1.6 },
  char: { len: 0.36, depth: 0.085, width: 0.05, head: 0.3, tail: 0.1, dorsal: 0.8 },
  // the grotto's blind cave fish (scene/grotto): small, translucent pink, no eyes
  cavefish: { len: 0.17, depth: 0.04, width: 0.024, head: 0.32, tail: 0.06, dorsal: 0.5, blind: true },
};

/** a thin fin in the y-z plane (x = 0), given as [y, z] points, `t` thick; flat-shaded, both sides */
function fin(pts: readonly (readonly [number, number])[], t: number, color: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  pts.forEach(([y, z], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -t / 2).rotateY(-Math.PI / 2);
  return prim(g, color);
}

function fishBody(d: FishDef): THREE.BufferGeometry {
  const sh = SHAPES[d.id] ?? SHAPES.minnow;
  const [back, belly, acc] = d.look.map((x) => C(x));
  const L = sh.len, D = sh.depth, W = sh.width;
  const prof = sh.slender
    ? [[0, 0.25], [0.1, 0.55], [0.3, 0.9], [0.55, 1], [0.8, 0.95], [0.93, 0.75], [1, 0.3]]
    : [[0, 0.16], [0.12, 0.38], [0.35, 0.92], [0.55, 1], [0.75, 0.88], [0.9, 0.6], [1, 0.22]];
  const rings: Ring[] = prof.map(([t, k]) => ({ p: [0, 0, -L / 2 + t * L], r: [W * Math.max(0.2, k), D * k * 0.55, D * k * 0.45], e: 2.1 }));
  const pattern = (f: Face): number => {
    const up = f.ny;
    if (f.t > 0.97 && d.id !== 'catfish') return mix(back, 0x000000, 0.2);
    switch (d.id) {
      case 'perch': return up > 0.0 && Math.floor(f.t * 9) % 2 === 0 && f.t > 0.2 && f.t < 0.85 ? C(0x2f3a1f) : up > -0.2 ? back : belly;
      case 'trout': return Math.abs(up) < 0.35 ? acc : up > 0 ? (hash(f.t * 30, f.a * 5) > 0.75 ? C(0x2f3a2a) : back) : belly;
      case 'char': return up < -0.3 ? acc : up > 0.1 ? (hash(f.t * 25, f.a * 4) > 0.8 ? C(0xfff4e0) : back) : belly;
      case 'koi': return hash(Math.floor(f.t * 5), Math.floor(f.a * 1.5)) > 0.55 ? C(0xfff4e0) : up < -0.4 ? belly : back;
      case 'bluegill': return f.t > 0.72 && f.t < 0.8 && Math.abs(up) < 0.5 ? acc : up > -0.1 ? (Math.floor(f.t * 7) % 2 ? back : mix(back, 0x1f2f4a, 0.3)) : belly;
      case 'stormbass': return Math.abs(up) < 0.15 && f.t > 0.15 ? acc : up > -0.1 ? back : belly;
      case 'salmon': return up > 0.2 ? (hash(f.t * 30, f.a * 5) > 0.8 ? C(0x2a2a30) : back) : Math.abs(up) < 0.2 ? acc : belly;
      default: return up > 0.15 ? back : up > -0.3 ? mix(back, belly, 0.5) : belly;
    }
  };
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(loft(rings, { sides: 10, sub: 2, paint: pattern, caps: ['pole', 'pole'], round: 0.7 }), 'body'));
  // tail (forked) at -z, dorsal, a pectoral each side
  const tz = -L / 2;
  const T = sh.tail;
  parts.push(partName(fin([[0, tz + 0.01], [T, tz - T * 0.9], [T * 0.25, tz - T * 0.55], [0, tz - T * 0.4], [-T * 0.25, tz - T * 0.55], [-T, tz - T * 0.9]], 0.008, acc), 'tail'));
  const dl = L * 0.32 * Math.min(1.4, sh.dorsal), dz0 = -L * 0.15, dh = D * 0.35 * Math.min(1.5, 0.6 + sh.dorsal * 0.4);
  parts.push(partName(fin([[D * 0.45, dz0 - dl * 0.5], [D * 0.45 + dh, dz0 - dl * 0.3], [D * 0.45 + dh * 0.7, dz0 + dl * 0.5], [D * 0.45, dz0 + dl * 0.6]], 0.006, acc), 'dorsal'));
  for (const sx of [-1, 1]) {
    const pec = fin([[0, 0], [-D * 0.25, -L * 0.12], [D * 0.05, -L * 0.1]], 0.005, acc);
    parts.push(partName(pec.rotateY(sx * 0.6).translate(sx * W * 0.8, -D * 0.12, L * 0.18), 'fin'));
    // eye: white, then a dark pupil a hair further out
    const ex = sx * W * 0.62, ey = D * 0.12, ez = L / 2 - L * sh.head * 0.35;
    if (!sh.blind) {
      parts.push(partName(blob([ex, ey, ez], [0.006, D * 0.11, D * 0.11], { paint: C(0xfff8ec), sides: 7, rings: 3 }), 'eye'));
      parts.push(partName(blob([ex + sx * 0.004, ey, ez + 0.002], [0.004, D * 0.065, D * 0.065], { paint: C(0x1a1a1e), sides: 6, rings: 2 }), 'eye'));
    }
    if (sh.whiskers) parts.push(partName(loft([{ p: [sx * W * 0.4, -D * 0.05, L / 2 - 0.01], r: 0.004 }, { p: [sx * (W * 0.4 + 0.03), -D * 0.2, L / 2 + 0.01], r: 0.003 }, { p: [sx * (W * 0.4 + 0.05), -D * 0.35, L / 2 - 0.01], r: 0.002 }], { sides: 4, sub: 2, paint: acc }), 'whisker'));
  }
  return merge(parts);
}

function boot(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const leather = (f: Face) => (f.ny > 0.75 ? C(0x8a5a32) : C(0x6e4a2a));
  parts.push(partName(loft([{ p: [0, 0.02, -0.03], r: [0.05, 0.03] }, { p: [0, 0.1, -0.035], r: [0.05, 0.045] }, { p: [0, 0.2, -0.03], r: [0.055, 0.05] }], { sides: 9, sub: 2, caps: ['flat', 'flat'], paint: leather }), 'shaft'));
  parts.push(partName(loft([{ p: [0, 0.045, -0.06], r: [0.05, 0.04] }, { p: [0, 0.045, 0.03], r: [0.048, 0.04] }, { p: [0, 0.035, 0.1], r: [0.04, 0.03] }, { p: [0, 0.03, 0.12], r: [0.02, 0.02] }], { sides: 9, sub: 2, paint: leather }), 'foot'));
  parts.push(partName(prim(new THREE.BoxGeometry(0.1, 0.018, 0.21), C(0x3b2a1e)).translate(0, 0.009, 0.03), 'sole'));
  parts.push(partName(prim(new THREE.TorusGeometry(0.052, 0.008, 4, 10), C(0xa0703f)).rotateX(Math.PI / 2).translate(0, 0.2, -0.03), 'cuff'));
  return merge(parts).translate(0, -0.1, 0).rotateX(0.3);
}

function bottle(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(loft([{ p: [0, 0, -0.1], r: 0.045 }, { p: [0, 0, 0.04], r: 0.046 }, { p: [0, 0, 0.08], r: 0.022 }, { p: [0, 0, 0.12], r: 0.017 }], { sides: 10, sub: 2, caps: ['flat', 'flat'], paint: (f) => (f.t > 0.2 && f.t < 0.5 && f.ny > -0.2 ? C(0xfff2d0) : C(0x6fb890)) }), 'glass'));
  parts.push(partName(loft([{ p: [0, 0, 0.115], r: 0.016 }, { p: [0, 0, 0.145], r: 0.018 }], { sides: 7, sub: 1, caps: ['flat', 'flat'], paint: C(0xb98555) }), 'cork'));
  parts.push(partName(prim(new THREE.TorusGeometry(0.035, 0.004, 3, 10), C(0xd9453b)).translate(0, 0, -0.02), 'ribbon'));
  return merge(parts).rotateX(-0.25);
}

const fishCache = new Map<string, THREE.BufferGeometry>();
/** the catch's geometry, length along z (head +z), centred (cached) */
export function catchGeometry(id: string): THREE.BufferGeometry {
  let g = fishCache.get(id);
  if (g) return g;
  const d = collectDef(id);
  g = id === 'boot' ? boot() : id === 'bottle' ? bottle() : d?.kind === 'fish' ? fishBody(d) : forageGeometry(id);
  fishCache.set(id, g);
  return g;
}

// ------------------------------------------------------------------------------------------------- tackle

/** The rod, along +y from the butt (y = 0) to the tip (y = ROD_LEN). */
export const ROD_LEN = 1.55;
export function rodGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(prim(new THREE.CylinderGeometry(0.008, 0.016, ROD_LEN, 6).translate(0, ROD_LEN / 2, 0), C(0x8a5a32)), 'blank'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.021, 0.021, 0.3, 7).translate(0, 0.17, 0), C(0xd8b47a)), 'cork'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 9).rotateZ(Math.PI / 2).translate(0.035, 0.38, 0), C(0x3f5f7a)), 'reel'));
  parts.push(partName(prim(new THREE.BoxGeometry(0.01, 0.01, 0.04).translate(0.05, 0.38, 0.02), C(0xd8b47a)), 'handle'));
  for (let i = 1; i <= 4; i++) parts.push(partName(prim(new THREE.TorusGeometry(0.01, 0.002, 3, 6).translate(0, 0.4 + i * 0.27, 0.012), C(0xb7b0a3)), 'guide'));
  return merge(parts);
}
export function bobberGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(partName(blob([0, 0, 0], [0.05, 0.05, 0.05], { paint: (f) => (f.y > 0.002 ? C(0xe0403a) : C(0xfaf6ee)), sides: 10, rings: 5, tilt: Math.PI / 2 }), 'float'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 5).translate(0, 0.075, 0), C(0xfaf6ee)), 'stick'));
  parts.push(partName(prim(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 5).translate(0, 0.1, 0), C(0xe0403a)), 'tip'));
  return merge(parts);
}

/** A soft four-point twinkle star in the xy plane (unlit, additive). */
export function glintGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  const arm = (a: number, len: number, w: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    const P = (x: number, y: number) => [x * c - y * s, x * s + y * c, 0];
    pts.push(...P(0, 0), ...P(len, 0), ...P(w, w), ...P(0, 0), ...P(w, -w), ...P(len, 0));
  };
  for (let i = 0; i < 4; i++) arm((i * Math.PI) / 2, i % 2 ? 1 : 1.25, 0.16);
  for (let i = 0; i < 4; i++) arm((i * Math.PI) / 2 + Math.PI / 4, 0.45, 0.1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** A flat ripple ring (xz plane), inner radius 0.8 of outer. */
export function rippleGeometry(): THREE.BufferGeometry {
  return new THREE.RingGeometry(0.8, 1, 24, 1).rotateX(-Math.PI / 2);
}
