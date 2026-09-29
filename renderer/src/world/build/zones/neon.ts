/**
 * Rollup neon (§7.1 STR "street lamps in rollup colour", BAY "rollup neon visible" through the E glazing): a bent-tube
 * neon of the pixel Clawd mascot in every bay's storefront display window, inside the E2 / E3 atrium glazing, and a
 * small blade one on every street lamp post. The mascot is always Clawd terracotta (filled neon + halo); the bay's
 * rollup status (blocked > working > done > idle) is the status bar tube under its feet; an amenity bay (no workspace)
 * shows an unlit bar. Blocked pulses (the only animated status colour, §2.3). [STAT fix m3 r1] 3 instanced draws on
 * existing programs (screen ×2, sprite): the tubes are the screen material's status strip (uv.y 0.95, uStripOn 1),
 * i.e. instance colour × uAccentGain like the monitor strips.
 * Built in the renderer only (dress.ts' node dry run never sees it). Owner: ENV.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial } from '../../../render/materials/index.ts';
import { STATUS, CORE } from '../../../../../shared/palette.ts';
import type { Layout, Bay } from '../../layout/schema.ts';
import type { Ctx } from '../../../core/ctx.ts';

const RANK: Readonly<Record<string, number>> = { blocked: 4, working: 3, done: 2, idle: 1 };
const OFF = new THREE.Color('#E6DCC8').multiplyScalar(0.12); // [STAT fix m3 r1] amenity bay: the status bar is an unlit tube
const CLAY = new THREE.Color(CORE.clay);

// [STAT fix m3 r1 art, cross-owner edit in ENV's file: the neon was assigned to STAT's pixel-Clawd homage (§11.5)]
// The old sign was a thin outline of the bitmap with a notched hem (it read as a Pac-Man ghost) that flipped red / blue
// with the bay rollup and no legend. Now: the real 13 × 9 pixel mascot (PIXEL_CLAWD in stats/dotfont.ts: body, side
// arm nubs, 4 separate legs) as a FILLED neon, i.e. a bright outer tube + a dim clay inner fill + 2 ink eye cut-outs,
// always Clawd terracotta, with a soft bloom halo behind it. The bay rollup status moved OFF the mascot onto a short
// status bar tube under its feet (the §6.7 "status strip" vocabulary: a bar in state colour = status), so the mascot
// keeps its identity colour and the state has a consistent meaning. 3 draws (tube+fill, status bars, halo), no new
// program (screen ×2, sprite).

/** The silhouette on the 13 × 9 pixel grid (y up, feet at 0): legs at x 2, 4, 8, 10; arm nubs at y 4–6. */
const OUTLINE: readonly (readonly [number, number])[] = [[2, 0], [3, 0], [3, 2], [4, 2], [4, 0], [5, 0], [5, 2], [8, 2], [8, 0], [9, 0], [9, 2], [10, 2], [10, 0], [11, 0],
  [11, 4], [13, 4], [13, 6], [11, 6], [11, 9], [2, 9], [2, 6], [0, 6], [0, 4], [2, 4]];
const EYES: readonly (readonly [number, number])[] = [[4, 6], [8, 6]];
const GX = 6.5, GY = 4.5;
const U = 0.036; // m per mascot pixel: 0.47 × 0.32 m at scale 1
/** uv for the screen program: y 0.95 = the accent strip (instance colour × uAccentGain), else the body (map texel). */
const setUv = (g: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry => { g.deleteAttribute('uv'); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2).map((_, i) => (i % 2 ? v : u)), 2)); return g; };
const flip = (g: THREE.BufferGeometry): THREE.BufferGeometry => { const q = g.clone(); q.scale(1, 1, -1); const idx = q.index?.array; if (idx) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } return q; };
const toM = ([x, y]: readonly [number, number]) => new THREE.Vector3((x - GX) * U, (y - GY) * U, 0);
function tubeOf(pts: readonly (readonly [number, number])[], r: number, closed: boolean): THREE.TubeGeometry {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const first = pts[0];
  const all = closed && first ? [...pts, first] : pts;
  for (let i = 0; i < all.length - 1; i++) path.add(new THREE.LineCurve3(toM(all[i]), toM(all[i + 1])));
  return new THREE.TubeGeometry(path, (all.length - 1) * 2, r, 5, false);
}
function quad(x0: number, y0: number, x1: number, y1: number, z: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry((x1 - x0) * U, (y1 - y0) * U);
  g.translate(((x0 + x1) / 2 - GX) * U, ((y0 + y1) / 2 - GY) * U, z);
  return g;
}

/** Mascot: outer tube (strip uv) + inner fill both faces (body uv 0.25 → clay texel) + ink eyes both faces (uv 0.75). */
function mascotGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape(OUTLINE.map(([x, y]) => new THREE.Vector2((x - GX) * U, (y - GY) * U)));
  const front = new THREE.ShapeGeometry(shape); front.translate(0, 0, 0.002);
  const back = flip(new THREE.ShapeGeometry(shape)); back.translate(0, 0, -0.002);
  const eyes: THREE.BufferGeometry[] = [];
  for (const [x, y] of EYES) {
    eyes.push(quad(x + 0.05, y + 0.05, x + 0.95, y + 0.95, 0.005));
    eyes.push(flip(quad(x + 0.05, y + 0.05, x + 0.95, y + 0.95, -0.005)));
  }
  const parts = [setUv(tubeOf(OUTLINE, 0.011, true), 0.95, 0.95), setUv(front, 0.25, 0.5), setUv(back, 0.25, 0.5), ...eyes.map((e) => setUv(e, 0.75, 0.5))];
  const merged = mergeGeometries(parts.map((q) => (q.index ? q.toNonIndexed() : q)), false);
  if (!merged) throw new Error('mascotGeometry: merge failed');
  return merged;
}
/** The rollup status bar: one tube under the feet (strip uv). */
function barGeometry(): THREE.BufferGeometry {
  return setUv(tubeOf([[3, -1.1], [10, -1.1]], 0.014, false), 0.95, 0.95);
}
/** Halo: a quad ~2.1× the mascot with a soft radial alpha map (built once). */
function haloTexture(): THREE.DataTexture {
  const n = 32, d = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * 2 - 1, y = (j + 0.5) / n * 2 - 1;
    const r = Math.hypot(x, y);
    const a = Math.min(1, Math.max(0, (1 - r) / 0.6)) ** 1.6; // flat core (hidden behind the fill), soft rim beyond
    d.set([255, 255, 255, Math.round(a * 255)], (j * n + i) * 4);
  }
  const t = new THREE.DataTexture(d, n, n);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

interface Spot { bay: string; x: number; y: number; z: number; yaw: number; s: number }
export interface BayNeon { mesh: THREE.Group; update: (c?: { time?: number }) => void }

export function createBayNeon(layout: Layout, ctx: Pick<Ctx, 'store' | 'director'>): BayNeon | null {
  const allBays = layout.bays;
  if (!allBays?.length) return null;
  const spots: Spot[] = [];
  const disp = (b: Bay): number | null => { // the display window nearest the storefront door's north side, on the street wall
    const w = layout.walls.find((q) => q.kind === 'storefront' && Math.abs(q.a[0] - (b.side === 'W' ? b.rect[2] : b.rect[0])) < 0.05);
    if (!w) return null;
    const z0 = Math.min(w.a[1], w.b[1]);
    const ds = (w.openings ?? []).filter((o) => o.kind === 'display').map((o) => z0 + o.at + o.w / 2).filter((z) => z > b.rect[1] && z < b.rect[3]);
    return ds.sort((a, c) => Math.abs(a - b.storefront.z) - Math.abs(c - b.storefront.z))[0] ?? null;
  };
  for (const b of allBays) {
    const west = b.side === 'W';
    const z = disp(b);
    // in the display window, bay side of the glass, facing the street
    if (z !== null) spots.push({ bay: b.id, x: (west ? b.rect[2] - 0.17 : b.rect[0] + 0.17), y: 1.28, z, yaw: west ? Math.PI / 2 : -Math.PI / 2, s: 1 });
    // inside the atrium glazing (E2 / E3), high, facing the atrium (the spawn / Pit views)
    // [STAT fix m3 r1] 2.2 → 2.25 m, scale 1.15 → 1: mascot + status bar fit the clear pane between the transom and the head frame (eBayGlass)
    if (!west && b.id !== 'E1') spots.push({ bay: b.id, x: b.rect[2] - 0.16, y: 2.25, z: b.rect[1] + (b.id === 'E2' ? 1.95 : 1.2), yaw: Math.PI / 2, s: 1 });
  }
  // blade neons on the street lamp posts (the bay on that side, nearest along z), readable up and down the street
  for (const l of layout.lamps ?? []) {
    if (l.kind !== 'street') continue;
    const west = l.pos.x < -14;
    const bays = allBays.filter((q) => q.side === (west ? 'W' : 'E'));
    const bay = bays.sort((a, c) => Math.abs(a.storefront.z - l.pos.z) - Math.abs(c.storefront.z - l.pos.z))[0];
    // [STAT fix m3 r1] 1.95 → 1.6 m and a touch bigger: the old blade hung behind the post's banner in the street pose
    if (bay) spots.push({ bay: bay.id, x: l.pos.x + (west ? 0.2 : -0.2), y: 1.6, z: l.pos.z, yaw: 0, s: 0.8 });
  }
  // [STAT fix m3 r1] three instanced layers per spot: A the mascot (tube = instance colour × accent gain, always clay;
  // fill + eyes = the body sampling a 2-texel map: clay / ink at uIntensity 0.38), B the rollup status bar, C the halo
  const lin = (c: THREE.Color): number[] => [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, v) * 255));
  const bodyTex = new THREE.DataTexture(new Uint8Array([...lin(CLAY), 255, ...lin(new THREE.Color(CORE.ink)), 255]), 2, 1);
  bodyTex.magFilter = THREE.NearestFilter; bodyTex.minFilter = THREE.NearestFilter; bodyTex.needsUpdate = true;
  const matA = getMaterial('screen', { color: '#FFFFFF', emissive: 0.38, instanced: true, uniforms: { uStripOn: { value: 1 } } });
  Object.assign(matA, { map: bodyTex });
  const mesh = new THREE.InstancedMesh(mascotGeometry(), matA, spots.length);
  const bars = new THREE.InstancedMesh(barGeometry(), getMaterial('screen', { color: '#FFFFFF', emissive: 1.0, instanced: true, uniforms: { uStripOn: { value: 1 } } }), spots.length);
  const matC = getMaterial('sprite', { color: '#FFFFFF', emissiveIntensity: 1.25, instanced: true, uniforms: {} });
  Object.assign(matC, { map: haloTexture(), opacity: 0.5 });
  const haloGeo = new THREE.PlaneGeometry(13 * U * 2.1, 11 * U * 2.2); haloGeo.translate(0, 0, -0.03);
  const halo = new THREE.InstancedMesh(haloGeo, matC, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  spots.forEach((s, i) => {
    e.set(0, s.yaw, 0); q.setFromEuler(e);
    m.compose(p.set(s.x, s.y, s.z), q, sc.set(s.s, s.s, s.s));
    for (const x of [mesh, bars, halo]) x.setMatrixAt(i, m);
    mesh.setColorAt(i, CLAY); halo.setColorAt(i, CLAY); bars.setColorAt(i, OFF);
  });
  const group = new THREE.Group();
  const layers: [THREE.InstancedMesh, string][] = [[mesh, 'mascot'], [bars, 'status'], [halo, 'halo']];
  for (const [x, n] of layers) { x.instanceMatrix.needsUpdate = true; x.computeBoundingSphere(); x.name = `env:bayNeon:${n}`; group.add(x); }
  group.name = 'env:bayNeon';
  const cols: Record<string, THREE.Color> = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, new THREE.Color(v)]));
  const tmp = new THREE.Color();
  /** bay → rollup status | null (amenity) */
  let roll = new Map<string, string | null>(), lastT = -1;
  const rollup = (): Map<string, string | null> => {
    const out = new Map<string, string | null>();
    const dir = ctx.director, ents = ctx.store?.entities;
    const state = dir?.bayState?.() ?? {};
    for (const b of allBays) out.set(b.id, state[b.id]?.ws ? 'idle' : null);
    if (ents && dir?.bayOf) {
      for (const en of ents.values()) {
        const bay = dir.bayOf(en.id);
        if (!bay || !out.has(bay)) continue;
        const st = en.status === 'done' && en.ack ? 'idle' : en.status;
        if ((RANK[st] ?? 0) > (RANK[out.get(bay) ?? ''] ?? 0)) out.set(bay, st);
      }
    }
    return out;
  };
  return {
    mesh: group,
    update(c?: { time?: number }) {
      const t = c?.time ?? performance.now() / 1000;
      if (t - lastT > 0.5 || lastT < 0) { roll = rollup(); lastT = t; }
      const pulse = 0.72 + 0.28 * Math.sin(t * Math.PI * 3); // 1.5 Hz
      let dirty = false;
      spots.forEach((s, i) => {
        const st = roll.get(s.bay);
        if (!st) tmp.copy(OFF);
        else tmp.copy(cols[st] ?? cols.idle).multiplyScalar(st === 'blocked' ? pulse : st === 'idle' ? 0.6 : 1);
        bars.getColorAt(i, cA);
        if (!cA.equals(tmp)) { bars.setColorAt(i, tmp); dirty = true; }
      });
      if (dirty && bars.instanceColor) bars.instanceColor.needsUpdate = true;
    },
  };
}
const cA = new THREE.Color();
