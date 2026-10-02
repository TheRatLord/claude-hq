/**
 * Builders for the summit trail's pieces, in world space (the trail system) or around a local origin (the gallery):
 * the trailhead signpost, log steps and rope railings along the cut tread, the wooden staircase, the rope bridge, the
 * halfway bench, cairns, and the summit lookout (platform, bench, coin-op viewer, flag, windswept pine, the summit
 * cairn). Static parts go into a Kit (baked to one solid + one glow mesh by the caller); the moving bits (the viewer's
 * head, the flag) are separate meshes, and the stones visitors leave are one InstancedMesh.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import type { TrailAnchors, TrailPt } from '../../world/trail.ts';
import { TRAIL_HW } from '../../world/trail.ts';
import { PAL, toon } from '../toon.ts';
import { Kit, canvasTex, fitText, FONT, HAND, woodPanel } from '../structures/kit.ts';
import { bench } from '../structures/props.ts';
import { deckAt, flightOf, spanOf, treadTop } from './decks.ts';

export type Ground = (x: number, z: number) => number;
/** a solid for the player: [x, z, r] circle or [x, z, w, d, yaw] rect */
export type Solid = readonly [number, number, number] | readonly [number, number, number, number, number];

const ROPE = 0xc9a66b, ROPE_DARK = 0x9a7a48, VIEWER = 0x3f8f7a, VIEWER_DARK = 0x2c6656, BRASS = 0xd8b04a, FLAG = 0xd97757;

/** Placement in a summit-local frame (front +z = the valley side). */
const summitXf = (s: TrailAnchors['summit']) => ({ x: s.x, y: s.y, z: s.z, ry: s.yaw });
/** local → world for the summit frame */
export function summitWorld(s: TrailAnchors['summit'], lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return { x: s.x + lx * c + lz * sn, z: s.z - lx * sn + lz * c };
}

/** Where the lookout's pieces stand, summit-local (x right, z toward the valley; deck top at y = deck). */
export const SUMMIT = Object.freeze({
  bench: { x: -0.2, z: -0.75 },
  viewer: { x: 1.25, z: 1.15 },
  /** the viewer head's pivot above the deck */
  viewerH: 1.18,
  flag: { x: -1.95, z: -1.55 },
  flagH: 4.4,
  lamp: { x: 1.95, z: -1.55 },
  pine: { x: 4.2, z: -2.4 },
  cairn: { x: 1.4, z: -3.1 },
});

// ---------------------------------------------------------------------------------------------
// Trailhead

export function trailheadKit(k: Kit, a: TrailAnchors['trailhead']): void {
  k.part('trailhead', () => k.at({ x: a.x, y: a.y, z: a.z, ry: a.yaw }, () => {
    k.cyl(0.32, 0.26, PAL.stone, { y: 0.1 }, 7);
    k.surf(['logs', { axis: 'y' }], () => k.cyl(0.1, 2.7, PAL.woodDark, { y: 1.35 }, 7));
    k.surf(['shingle', { scale: 0.4 }], () => k.cone(0.2, 0.28, PAL.roofGreen, { y: 2.82, ry: Math.PI / 4 }, 4));
    // the two arrow boards (lettering: the sign mesh) and their backs
    k.surf(['planks', { axis: 'x' }], () => {
      k.box(1.36, 0.36, 0.06, PAL.woodLight, { x: -0.52, y: 2.2, z: 0.08, rz: -0.04 });
      k.prism([[0, -0.18], [-0.24, 0], [0, 0.18]], 0.06, PAL.woodLight, { x: -1.2, y: 2.25, z: 0.08, rz: -0.04 });
      k.box(1.1, 0.3, 0.06, PAL.plank, { x: 0.42, y: 1.7, z: 0.08, rz: 0.03 });
      k.prism([[0, -0.15], [0.22, 0], [0, 0.15]], 0.06, PAL.plank, { x: 0.97, y: 1.68, z: 0.08, rz: 0.03 });
    });
    // a lantern on a little arm (lights the start after dark)
    k.box(0.5, 0.05, 0.05, PAL.ink, { x: 0.25, y: 2.55, z: -0.02 });
    k.at({ x: 0.45, y: 2.3, z: -0.02 }, () => {
      k.cyl(0.08, 0.05, PAL.ink, { y: 0.17 }, 4);
      k.emit({ radius: 5, intensity: 0.55 }, () => k.cyl(0.07, 0.2, PAL.lampGlow, { y: 0.04, ry: Math.PI / 4 }, 4, 0.08, 'glow'));
      k.cyl(0.11, 0.05, PAL.ink, { y: -0.08 }, 4);
    });
    // a walking-stick bin: three sticks in a little crate
    k.at({ x: 0.55, z: -0.45 }, () => {
      k.surf(['planks', { axis: 'h' }], () => k.box(0.36, 0.34, 0.3, PAL.wood, { y: 0.17 }));
      for (let i = 0; i < 3; i++) k.rod(-0.1 + i * 0.1, 0.2, 0, -0.14 + i * 0.13, 1.25, 0.04 * (i - 1), 0.022, i === 1 ? PAL.woodLight : PAL.trunk, 5);
    });
  }));
}

/** The lettering on the trailhead's two boards (one small canvas mesh). */
export function trailheadSign(a: TrailAnchors['trailhead'], length: number, climb: number): THREE.Mesh {
  const W = 512, H = 256;
  const c = canvasTex(W, H);
  const g = c.g;
  woodPanel(g, W, H / 2, '#e2bd84', 7);
  g.fillStyle = '#4a2e18'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, 'Summit Lookout ▴', W / 2 + 10, H / 4 - 12, W - 60, 46, HAND);
  g.font = `600 26px ${FONT}`; g.fillStyle = '#6a4426';
  g.fillText(`${Math.round(length)} m · ${Math.round(climb)} m up · rope bridge`, W / 2 + 10, H / 4 + 30);
  g.save(); g.translate(0, H / 2);
  woodPanel(g, W, H / 2, '#c99a64', 12);
  g.fillStyle = '#3a2414'; g.textAlign = 'center';
  fitText(g, 'The square ▾', W / 2 - 10, H / 4 + 2, W - 70, 40, FONT);
  g.restore();
  c.tex.needsUpdate = true;
  const mat = new THREE.MeshToonMaterial({ map: c.tex, gradientMap: (toon() as THREE.MeshToonMaterial).gradientMap, color: 0xffffff });
  const geo = new THREE.BufferGeometry();
  // two quads just in front of the boards (post-local), uv halves of the canvas
  const quad = (cx: number, cy: number, w: number, h: number, rz: number, v0: number, v1: number) => {
    const out: number[] = [], uv: number[] = [];
    const cs = Math.cos(rz), sn = Math.sin(rz);
    const P = (x: number, y: number) => [cx + x * cs - y * sn, cy + x * sn + y * cs, 0.115];
    const tl = P(-w / 2, h / 2), tr = P(w / 2, h / 2), bl = P(-w / 2, -h / 2), br = P(w / 2, -h / 2);
    out.push(...bl, ...br, ...tr, ...bl, ...tr, ...tl);
    uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
    return { out, uv };
  };
  const q1 = quad(-0.52, 2.2, 1.3, 0.32, -0.04, 0.5, 1), q2 = quad(0.42, 1.7, 1.06, 0.27, 0.03, 0, 0.5);
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...q1.out, ...q2.out], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([...q1.uv, ...q2.uv], 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.name = 'trail:sign';
  m.position.set(a.x, a.y, a.z);
  m.rotation.y = a.yaw;
  m.castShadow = false;
  return m;
}

// ---------------------------------------------------------------------------------------------
// The tread: log steps on the steeper legs, rope railings where the outer side drops away

/** Log steps and rope railings along the cut tread. Returns the solids (railing spans and posts). */
export function treadKit(k: Kit, pts: readonly TrailPt[], ground: Ground, landings: readonly { x: number; z: number; r: number }[]): Solid[] {
  const solids: Solid[] = [];
  const nearLanding = (x: number, z: number, m: number) => landings.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + m);
  // walk the cut tread by arc length
  let acc = 0, nextLog = 0.6;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    if (p.kind === 'cut' && Math.abs(p.grade) > 0.27) {
      nextLog = Math.max(nextLog, acc);
      for (; nextLog < acc + l; nextLog += 1.25 + (Math.abs(p.grade) > 0.4 ? -0.15 : 0.1)) {
        const t = (nextLog - acc) / l, x = p.x + dx * t, z = p.z + dz * t;
        if (nearLanding(x, z, 0.2)) continue;
        const y = ground(x, z);
        k.part('logStep', () => k.at({ x, y, z, ry: Math.atan2(ux, uz) }, () => {
          k.surf(['bark', { axis: 'x', scale: 0.6 }], () => k.cyl(0.095, 1.3, PAL.trunk, { y: 0.05, rz: Math.PI / 2 }, 6));
          k.surf(['logs', { axis: 'x' }], () => { k.cyl(0.085, 0.02, PAL.woodLight, { x: 0.655, y: 0.05, rz: Math.PI / 2 }, 6); k.cyl(0.085, 0.02, PAL.woodLight, { x: -0.655, y: 0.05, rz: Math.PI / 2 }, 6); });
          for (const sx of [-0.45, 0.45]) k.cyl(0.03, 0.22, PAL.woodDark, { x: sx, y: 0.09, z: 0.12 }, 5);
        }));
      }
    } else nextLog = Math.max(nextLog, acc + l + 0.6);
    acc += l;
  }
  // rope railings: runs of tread whose outer side falls away more than ~1.4 m within 2.5 m
  interface Post { x: number; z: number; y: number }
  const runs: Post[][] = [];
  let run: Post[] = [];
  let since = 99;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    const end = () => { if (run.length >= 2) runs.push(run); run = []; since = 99; };
    if (p.kind !== 'cut') { end(); continue; }
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    // the outer side: whichever side is lower 2.5 m out
    const yl = ground(p.x + nx * 2.5, p.z + nz * 2.5), yr = ground(p.x - nx * 2.5, p.z - nz * 2.5);
    const side = yl < yr ? 1 : -1, drop = p.y - Math.min(yl, yr);
    if (drop < 1.4 || nearLanding(p.x, p.z, 1.2)) { end(); continue; }
    since += l;
    if (since >= 2.2 || !run.length) {
      const x = p.x + nx * side * (TRAIL_HW - 0.3), z = p.z + nz * side * (TRAIL_HW - 0.3);
      run.push({ x, z, y: ground(x, z) });
      since = 0;
    }
  }
  if (run.length >= 2) runs.push(run);
  for (const r of runs) {
    k.part('railing', () => {
      for (const p of r) {
        const lo = p.y - 0.12, len = p.y + 0.95 - lo;
        k.surf(['logs', { axis: 'y' }], () => k.cyl(0.06, len, PAL.woodDark, { x: p.x, y: lo + len / 2, z: p.z }, 6));
        k.cyl(0.075, 0.05, PAL.wood, { x: p.x, y: p.y + 0.97, z: p.z }, 6);
        solids.push([p.x, p.z, 0.1]);
      }
      for (let j = 0; j + 1 < r.length; j++) {
        const a = r[j], b = r[j + 1];
        // a sagging rope in two pieces, and a lower one
        for (const h of [0.86, 0.48]) {
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (a.y + b.y) / 2 + h - 0.09;
          k.rod(a.x, a.y + h, a.z, mx, my, mz, 0.022, ROPE, 4);
          k.rod(mx, my, mz, b.x, b.y + h, b.z, 0.022, ROPE, 4);
        }
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        solids.push([(a.x + b.x) / 2, (a.z + b.z) / 2, L, 0.12, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2]);
      }
    });
  }
  return solids;
}

// ---------------------------------------------------------------------------------------------
// Wooden staircase

export function stairsKit(k: Kit, st: TrailAnchors['stairs'], ground: Ground): Solid[] {
  const f = flightOf(st);
  const solids: Solid[] = [];
  const yaw = Math.atan2(f.ux, f.uz); // local +z = up the flight
  const W = (u: number, v: number) => ({ x: f.ax + f.ux * u - f.uz * v, z: f.az + f.uz * u + f.ux * v });
  const depth = f.run / f.n;
  k.part('stairs', () => {
    // treads
    k.surf(['planks', { axis: 'x', scale: 0.8 }], () => {
      for (let i = 0; i < f.n; i++) {
        const u = (i + 0.5) * depth, p = W(u, 0), top = treadTop(f, i);
        k.box(st.width, 0.06, depth + 0.04, i % 2 ? PAL.plank : PAL.woodLight, { x: p.x, y: top - 0.03, z: p.z, ry: yaw });
      }
    });
    // stringers along both sides (under the tread ends), posts down to the ground where it falls away, handrails
    for (const v of [-st.width / 2 - 0.04, st.width / 2 + 0.04]) {
      const a = W(0, v), b = W(f.run, v);
      k.beam(a.x, f.ay - 0.12, a.z, b.x, f.ay + f.rise - 0.12, b.z, 0.08, PAL.woodDark, undefined, 0.24);
      const posts = Math.max(2, Math.round(f.run / 1.7) + 1);
      let prev: { x: number; y: number; z: number } | null = null;
      for (let j = 0; j < posts; j++) {
        const u = Math.min(f.run - 0.1, 0.1 + (j / (posts - 1)) * (f.run - 0.2)), p = W(u, v);
        const top = treadTop(f, Math.min(f.n - 1, Math.floor((u / f.run) * f.n)));
        const g = ground(p.x, p.z);
        if (top - 0.3 - g > 0.15) k.surf(['logs', { axis: 'y' }], () => k.box(0.12, top - 0.3 - g + 0.1, 0.12, PAL.woodDark, { x: p.x, y: (g + top - 0.3) / 2 - 0.05, z: p.z, ry: yaw }));
        k.box(0.08, 0.98, 0.08, PAL.wood, { x: p.x, y: top + 0.46, z: p.z, ry: yaw });
        const rail = { x: p.x, y: top + 0.92, z: p.z };
        if (prev) k.beam(prev.x, prev.y, prev.z, rail.x, rail.y, rail.z, 0.07, PAL.woodLight, undefined, 0.05);
        prev = rail;
      }
      // (stopping short of the top so you can turn off the last tread onto the knob)
      const m = W((0.4 + f.run - 0.8) / 2, v + Math.sign(v) * 0.05);
      solids.push([m.x, m.z, 0.14, f.run - 1.2, yaw]);
    }
  });
  return solids;
}

// ---------------------------------------------------------------------------------------------
// Rope bridge

export function bridgeKit(k: Kit, br: TrailAnchors['bridge'], ground: Ground): Solid[] {
  const s = spanOf(br);
  const solids: Solid[] = [];
  const yaw = Math.atan2(s.ux, s.uz);
  const W = (u: number, v: number) => ({ x: s.ax + s.ux * u - s.uz * v, z: s.az + s.uz * u + s.ux * v });
  const hw = s.width / 2;
  k.part('ropeBridge', () => {
    // planks, each hung at the deck curve (a little uneven), on two cables
    const n = Math.round(s.len / 0.27);
    k.surf(['planks', { axis: 'x', scale: 0.7 }], () => {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, p = W(t * s.len, (k.r() - 0.5) * 0.04);
        k.box(s.width + (k.r() - 0.5) * 0.08, 0.05, 0.21, i % 3 ? PAL.plank : PAL.woodLight, { x: p.x, y: deckAt(s, t) - 0.025, z: p.z, ry: yaw + (k.r() - 0.5) * 0.06 });
      }
    });
    const SEG = 10;
    const curve = (v: number, dy: number, sagK: number) => {
      for (let i = 0; i < SEG; i++) {
        const t0 = i / SEG, t1 = (i + 1) / SEG, a = W(t0 * s.len, v), b = W(t1 * s.len, v);
        const y0 = deckAt(s, t0) + dy + (sagK - 1) * -s.sag * 4 * t0 * (1 - t0), y1 = deckAt(s, t1) + dy + (sagK - 1) * -s.sag * 4 * t1 * (1 - t1);
        k.rod(a.x, y0, a.z, b.x, y1, b.z, dy > 0 ? 0.03 : 0.035, dy > 0 ? ROPE : ROPE_DARK, 4);
      }
    };
    for (const v of [-hw + 0.08, hw - 0.08]) curve(v, -0.07, 1);
    for (const v of [-hw - 0.02, hw + 0.02]) curve(v, 0.98, 0.7);
    // suspenders: hand rope down to the deck edge
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      for (const v of [-hw, hw]) {
        const p = W(t * s.len, v), d = deckAt(s, t);
        k.rod(p.x, d - 0.04, p.z, p.x, d + 0.98 + 0.3 * s.sag * 4 * t * (1 - t), p.z, 0.014, ROPE, 3);
      }
    }
    // end posts (two pairs) with anchor ropes to stakes behind them
    for (const [u, back] of [[-0.15, -1], [s.len + 0.15, 1]] as const) {
      const y = u < 0 ? s.ay : s.by;
      for (const v of [-hw - 0.08, hw + 0.08]) {
        const p = W(u, v), g = ground(p.x, p.z);
        k.surf(['logs', { axis: 'y' }], () => k.cyl(0.11, y + 1.35 - g, PAL.woodDark, { x: p.x, y: (g + y + 1.35) / 2 - 0.05, z: p.z }, 7));
        k.cyl(0.13, 0.08, PAL.wood, { x: p.x, y: y + 1.32, z: p.z }, 7);
        const st = W(u + back * 1.1, v * 1.25), sg = ground(st.x, st.z);
        k.rod(p.x, y + 1.0, p.z, st.x, sg + 0.18, st.z, 0.025, ROPE_DARK, 4);
        k.cyl(0.05, 0.36, PAL.woodDark, { x: st.x, y: sg + 0.1, z: st.z, rz: 0.2 * back }, 5);
        solids.push([p.x, p.z, 0.16]);
      }
    }
    // the bridge's sides keep you on it
    for (const v of [-hw - 0.06, hw + 0.06]) { const m = W(s.len / 2, v); solids.push([m.x, m.z, 0.1, s.len + 0.1, yaw]); }
  });
  return solids;
}

// ---------------------------------------------------------------------------------------------
// Cairns, the halfway bench, the windswept pine

export function cairnKit(k: Kit, x: number, y: number, z: number, s: number, seed = 0): void {
  k.part('cairn', () => k.at({ x, y, z, s }, () => {
    const cols = [PAL.stone, 0xc9c2b4, 0xa9a294, 0xb8b0a0];
    let h = 0;
    for (let i = 0; i < 6; i++) {
      const r = 0.32 - i * 0.045, a = seed * 1.7 + i * 2.3;
      k.surf(['rock', { scale: 0.5 }], () => k.blob(r, cols[(i + seed) % 4], { x: Math.cos(a) * 0.03 * i, y: h + r * 0.55, z: Math.sin(a) * 0.03 * i, s: [1.15, 0.62, 1], ry: a }));
      h += r * 1.05;
    }
  }));
}

export function benchKit(k: Kit, b: TrailAnchors['bench']): void {
  bench(k, { x: b.x, y: b.y, z: b.z, ry: b.yaw }, 1.6);
  // a little marker post beside it
  k.part('halfwayPost', () => k.at({ x: b.x, y: b.y, z: b.z, ry: b.yaw }, () => {
    k.surf(['logs', { axis: 'y' }], () => k.cyl(0.07, 0.98, PAL.woodDark, { x: 1.15, y: 0.41, z: -0.1 }, 6));
    k.surf(['planks', { axis: 'x' }], () => k.box(0.42, 0.24, 0.05, PAL.woodLight, { x: 1.15, y: 0.82, z: -0.05 }));
    k.box(0.12, 0.04, 0.01, PAL.roofGreen, { x: 1.15, y: 0.86, z: -0.02 });
  }));
}

/** A lone pine bent by the wind (crown streaming one way), base at (x, y, z). */
export function windsweptPine(k: Kit, x: number, y: number, z: number, lean: number, season: Season): void {
  k.part('windsweptPine', () => k.at({ x, y, z, ry: lean }, () => {
    // trunk: three bent pieces leaning downwind (+x)
    const pts = [[0, 0], [0.25, 1.3], [0.75, 2.4], [1.45, 3.2]] as const;
    k.surf(['bark', { axis: 'y', scale: 0.7 }], () => {
      for (let i = 0; i < 3; i++) k.rod(pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0, 0.2 - i * 0.05, PAL.bark, 7);
      k.cyl(0.26, 0.3, PAL.bark, { y: 0.1 }, 7, 0.2);
      // a root over the rock
      k.rod(0, 0.1, 0, -0.55, -0.05, 0.25, 0.08, PAL.bark, 5);
    });
    const green = season === 'winter' ? 0x3a6a4c : PAL.pine, dark = 0x2f5f40;
    // flat tiers of needles, all streaming downwind (+x), smaller toward the top
    const tiers: [number, number, number, number][] = [[0.6, 1.5, 1.25, 0.32], [1.0, 2.2, 1.1, 0.3], [1.45, 2.85, 0.95, 0.28], [1.85, 3.35, 0.7, 0.26]];
    tiers.forEach(([tx, ty, r, h], i) => {
      k.surf(['leaves', { scale: 0.5 }], () => k.cone(r, h, i % 2 ? dark : green, { x: tx, y: ty, s: [1.5, 1, 0.95] }, 7));
      if (season === 'winter') k.cone(r * 0.75, h * 0.45, PAL.snow, { x: tx + 0.05, y: ty + h * 0.32, s: [1.5, 1, 0.95] }, 7);
    });
    // a bare upwind branch stub
    k.rod(0.1, 1.7, 0, -0.5, 1.95, 0.15, 0.04, PAL.bark, 4);
  }));
}

// ---------------------------------------------------------------------------------------------
// The summit lookout

export function summitKit(k: Kit, s: TrailAnchors['summit'], ground: Ground, season: Season): Solid[] {
  const solids: Solid[] = [];
  const D = s.deck, hw = s.w / 2, hd = s.d / 2;
  const toW = (lx: number, lz: number) => summitWorld(s, lx, lz);
  const local = (lx: number, lz: number) => ground(toW(lx, lz).x, toW(lx, lz).z) - s.y;
  k.at(summitXf(s), () => {
    k.part('summitDeck', () => {
      // posts at the corners and mid-sides down to the knob, joists, then boards across
      for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1]]) {
        const lx = px * (hw - 0.15), lz = pz * (hd - 0.15), g = local(lx, lz);
        k.surf(['logs', { axis: 'y' }], () => k.box(0.16, D - g + 0.25, 0.16, PAL.woodDark, { x: lx, y: (g + D) / 2 - 0.12, z: lz }));
      }
      for (const lz of [-hd + 0.15, 0, hd - 0.15]) k.box(s.w, 0.12, 0.12, PAL.woodDark, { y: D - 0.12, z: lz });
      k.surf(['planks', { axis: 'z', scale: 0.8 }], () => {
        const n = Math.round(s.w / 0.24);
        for (let i = 0; i < n; i++) k.box(s.w / n - 0.02, 0.06, s.d, i % 3 ? PAL.plank : PAL.woodLight, { x: -hw + (i + 0.5) * (s.w / n), y: D - 0.03 });
      });
      // a step up on the open side (the bridge arrives from local −x)
      k.surf(['planks', { axis: 'z' }], () => k.box(0.4, D * 0.5, 1.4, PAL.wood, { x: -hw - 0.2, y: D * 0.25 - 0.02, z: -0.4 }));
    });
    // railing on the valley side and the far side, posts + two rails
    k.part('summitRail', () => {
      const rail = (ax: number, az: number, bx: number, bz: number) => {
        const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.15));
        for (let i = 0; i <= n; i++) { const t = i / n; k.box(0.09, 1.0, 0.09, PAL.woodDark, { x: ax + (bx - ax) * t, y: D + 0.5, z: az + (bz - az) * t }); }
        k.beam(ax, D + 0.98, az, bx, D + 0.98, bz, 0.1, PAL.woodLight, undefined, 0.07);
        k.beam(ax, D + 0.55, az, bx, D + 0.55, bz, 0.05, PAL.wood, undefined, 0.05);
        const m = toW((ax + bx) / 2, (az + bz) / 2);
        solids.push([m.x, m.z, Math.abs(bx - ax) > 0.01 ? L + 0.1 : 0.14, Math.abs(bx - ax) > 0.01 ? 0.14 : L + 0.1, s.yaw]);
      };
      rail(-hw + 0.05, hd - 0.05, hw - 0.05, hd - 0.05);
      rail(hw - 0.05, hd - 0.05, hw - 0.05, -hd + 0.05);
      rail(hw - 0.05, -hd + 0.05, 0.4, -hd + 0.05);
    });
    // a bench facing the valley
    bench(k, { x: SUMMIT.bench.x, y: D, z: SUMMIT.bench.z }, 1.6);
    { const b = toW(SUMMIT.bench.x, SUMMIT.bench.z - 0.05); solids.push([b.x, b.z, 1.6, 0.5, s.yaw]); }
    // the coin-op viewer's pedestal (its head turns: separate mesh)
    k.part('viewer', () => k.at({ x: SUMMIT.viewer.x, y: D, z: SUMMIT.viewer.z }, () => {
      k.cyl(0.2, 0.08, VIEWER_DARK, { y: 0.04 }, 8);
      k.cyl(0.07, 0.95, VIEWER, { y: 0.5 }, 8, 0.06);
      k.cyl(0.11, 0.1, VIEWER_DARK, { y: 0.98 }, 8);
      // coin box with a brass slot
      k.box(0.18, 0.2, 0.14, VIEWER, { y: 0.78, z: -0.1 });
      k.box(0.08, 0.02, 0.01, BRASS, { y: 0.84, z: -0.175 });
    }));
    { const v = toW(SUMMIT.viewer.x, SUMMIT.viewer.z); solids.push([v.x, v.z, 0.24]); }
    // flag pole (the flag itself waves: separate mesh)
    k.part('flagPole', () => k.at({ x: SUMMIT.flag.x, y: D, z: SUMMIT.flag.z }, () => {
      k.cyl(0.14, 0.12, PAL.stone, { y: 0.06 }, 6);
      k.cyl(0.045, SUMMIT.flagH, PAL.wallWhite, { y: SUMMIT.flagH / 2 }, 6, 0.035);
      k.ball(0.07, BRASS, { y: SUMMIT.flagH + 0.04 });
    }));
    { const f = toW(SUMMIT.flag.x, SUMMIT.flag.z); solids.push([f.x, f.z, 0.12]); }
    // a lantern post on the back corner
    k.part('summitLamp', () => k.at({ x: SUMMIT.lamp.x, y: D, z: SUMMIT.lamp.z }, () => {
      k.surf(['logs', { axis: 'y' }], () => k.box(0.1, 1.9, 0.1, PAL.woodDark, { y: 0.95 }));
      k.box(0.45, 0.06, 0.06, PAL.woodDark, { y: 1.85, x: -0.18 });
      k.at({ x: -0.36, y: 1.58 }, () => {
        k.cyl(0.09, 0.05, PAL.ink, { y: 0.18 }, 4);
        k.emit({ radius: 6, intensity: 0.6 }, () => k.cyl(0.08, 0.22, PAL.lampGlow, { y: 0.04, ry: Math.PI / 4 }, 4, 0.09, 'glow'));
        k.cyl(0.12, 0.05, PAL.ink, { y: -0.09 }, 4);
      });
    }));
    { const l = toW(SUMMIT.lamp.x, SUMMIT.lamp.z); solids.push([l.x, l.z, 0.1]); }
  });
  // the windswept pine and the summit cairn stand on the knob behind
  const pine = toW(SUMMIT.pine.x, SUMMIT.pine.z);
  windsweptPine(k, pine.x, ground(pine.x, pine.z) - 0.08, pine.z, -2.2, season);
  solids.push([pine.x, pine.z, 0.3]);
  const c = toW(SUMMIT.cairn.x, SUMMIT.cairn.z);
  cairnKit(k, c.x, ground(c.x, c.z) - 0.04, c.z, 1.45, 3);
  solids.push([c.x, c.z, 0.55]);
  return solids;
}

/** The viewer's head (binocular hood on a yoke); pivot at its origin, looking along +z. */
export function viewerHead(): THREE.Mesh {
  const k = new Kit(5);
  k.box(0.08, 0.16, 0.08, VIEWER_DARK, { y: -0.08 });
  k.at({ y: 0.05 }, () => {
    k.box(0.46, 0.26, 0.3, VIEWER, { z: 0.02 });
    k.box(0.5, 0.06, 0.34, VIEWER_DARK, { y: 0.15, z: 0.02 });
    // the two eyepieces (back) and lenses (front)
    for (const x of [-0.11, 0.11]) {
      k.cyl(0.06, 0.12, VIEWER_DARK, { x, z: -0.18, rx: Math.PI / 2 }, 8);
      k.cyl(0.08, 0.08, BRASS, { x, z: 0.2, rx: Math.PI / 2 }, 8);
      k.cyl(0.055, 0.02, 0x2a4a5a, { x, z: 0.245, rx: Math.PI / 2 }, 8);
    }
    k.box(0.16, 0.05, 0.05, BRASS, { y: -0.16, z: -0.1 });
  });
  const m = k.mesh();
  m.name = 'trail:viewer';
  m.receiveShadow = true;
  return m;
}

/** The summit flag: a swallow-tailed pennant, vertex-animated by the system (`waveFlag`). */
export function flagMesh(): THREE.Mesh {
  const L = 1.25, H = 0.72, NX = 10, NY = 3;
  const g = new THREE.PlaneGeometry(L, H, NX, NY);
  g.translate(L / 2, 0, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    // swallow tail: pull the middle of the free edge in
    if (x > L - 0.01 && Math.abs(y) < H * 0.2) pos.setX(i, L - 0.32);
    // a cream mountain on Claude orange
    const mx = x - 0.45, mt = H * 0.32 - Math.abs(mx) * 1.1;
    c.setHex(y < mt && y > -H * 0.32 && Math.abs(mx) < 0.4 ? 0xf6ead2 : FLAG);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.userData.rest = Float32Array.from(pos.array as Float32Array);
  const m = new THREE.Mesh(g, toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
  m.name = 'trail:flag';
  m.castShadow = true;
  return m;
}

/** Ripple the flag (allocation-free): wind speed 0..~6 m/s. */
export function waveFlag(m: THREE.Mesh, t: number, wind: number): void {
  const pos = m.geometry.attributes.position as THREE.BufferAttribute;
  const rest = m.geometry.userData.rest as Float32Array;
  const a = pos.array as Float32Array;
  const amp = 0.05 + Math.min(1, wind / 6) * 0.1, hz = 4 + Math.min(1, wind / 6) * 5;
  for (let i = 0; i < pos.count; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1];
    const k = x / 1.25;
    a[i * 3 + 2] = Math.sin(t * hz - x * 5 + y * 0.8) * amp * k * (0.6 + 0.4 * k);
    a[i * 3 + 1] = y - k * k * 0.06 * (1 - Math.min(1, wind / 5));
  }
  pos.needsUpdate = true;
}

/** One loose stone of the summit cairn's offerings (InstancedMesh geometry, vertex coloured). */
export function offeringGeometry(): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(0.11, 0); // polyhedra are already non-indexed (toNonIndexed would warn)
  g.scale(1.2, 0.62, 1);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { c.setHex(PAL.stone).offsetHSL(0, 0, ((i / 3) % 3) * 0.02 - 0.02); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Where the n-th offered stone sits round the summit cairn (cairn-local; spirals up its flanks). */
export function offeringSpot(n: number, out: { x: number; y: number; z: number; ry: number }): typeof out {
  const ring = Math.floor(n / 9), i = n % 9;
  const a = i * (Math.PI * 2 / 9) + ring * 0.37;
  const r = Math.max(0.12, 0.62 - ring * 0.13);
  out.x = Math.cos(a) * r; out.z = Math.sin(a) * r; out.y = 0.07 + ring * 0.2; out.ry = a * 1.7;
  return out;
}

/**
 * The viewer's binocular mask: a dark card filling the view (unit half-height, half-width scaled by the caller to the
 * camera's aspect) with two overlapping round windows. Drawn last, over everything, unfogged.
 */
export function binocularMask(): THREE.Mesh {
  const shape = new THREE.Shape();
  const W = 4, H = 1;
  shape.moveTo(-W, -H); shape.lineTo(W, -H); shape.lineTo(W, H); shape.lineTo(-W, H); shape.lineTo(-W, -H);
  // the two windows merge into one figure-eight outline (a single hole, so the overlap stays open)
  const hole = new THREE.Path();
  const r = 0.86, cx = 0.62, N = 40;
  const a0 = Math.acos(cx / r), sweep = 2 * Math.PI - 2 * a0;
  // right lens from the upper crossing, clockwise round its outer side to the lower crossing; then the left lens on
  for (let i = 0; i <= N; i++) { const t = Math.PI - a0 - (i / N) * sweep; if (i === 0) hole.moveTo(cx + r * Math.cos(t), r * Math.sin(t)); else hole.lineTo(cx + r * Math.cos(t), r * Math.sin(t)); }
  for (let i = 1; i < N; i++) { const t = -a0 - (i / N) * sweep; hole.lineTo(-cx + r * Math.cos(t), r * Math.sin(t)); }
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 1);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x0c0a08, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false }));
  m.name = 'trail:viewerMask';
  m.renderOrder = 999;
  m.frustumCulled = false;
  return m;
}
