/**
 * Path dressing and field boundaries: pebbles scattered along the dirt path edges, and a few old dry-stone walls
 * wandering across the meadows (mossy, snow-capped in winter). Static: two draw calls.
 */
import * as THREE from 'three';
import { seeded } from '../../../core/rng.ts';
import type { Season } from '../../model/types.ts';
import { PATHS, WORLD, clearance, heightAt, slopeAt } from '../../world/map.ts';
import { fbm } from '../../world/noise.ts';
import { SURF, surfaceMaterial } from '../surface/index.ts';
import { merge } from '../flora/geom.ts';
import { rockGeometry } from './rocks.ts';
import { GROUND } from './ground.ts';

interface Peb { x: number; y: number; z: number; s: number; yaw: number }

const HUB = { x: 0, z: -1 };

function pebbles(): Peb[] {
  const r = seeded('land:path-pebbles');
  const out: Peb[] = [];
  for (const p of PATHS) {
    for (let i = 0; i < p.points.length - 1; i++) {
      const a = p.points[i], b = p.points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      for (let d = 0; d < l; d += 0.9) {
        if (r() > 0.4) continue;
        const t = d / l, side = r() < 0.5 ? -1 : 1, off = p.width * (0.38 + r() * 0.3);
        const x = a.x + dx * t - (dz / l) * off * side, z = a.z + dz * t + (dx / l) * off * side;
        if (Math.hypot(x - HUB.x, z - HUB.z) < 17 || clearance(x, z) < -0.6 || heightAt(x, z) < WORLD.water + 0.2) continue;
        out.push({ x, y: heightAt(x, z) - 0.02, z, s: 0.06 + r() * 0.1, yaw: r() * 6.28 });
      }
    }
  }
  return out;
}

/** Old dry-stone walls: short wandering runs in open meadow. */
function walls(): { x: number; z: number; y: number }[][] {
  const r = seeded('land:walls');
  const runs: { x: number; z: number; y: number }[][] = [];
  for (let tries = 0; tries < 400 && runs.length < 9; tries++) {
    const a = r() * Math.PI * 2, d = 38 + r() * 46;
    let x = Math.cos(a) * d, z = Math.sin(a) * d;
    let h = r() * Math.PI * 2;
    const len = 10 + r() * 12;
    const run: { x: number; z: number; y: number }[] = [];
    let ok = true;
    for (let s = 0; s < len; s += 0.5) {
      if (clearance(x, z) < 1.6 || slopeAt(x, z) > 0.25 || heightAt(x, z) < WORLD.water + 0.6) { ok = false; break; }
      run.push({ x, z, y: heightAt(x, z) });
      h += fbm(x / 9, z / 9) * 0.08;
      x += Math.sin(h) * 0.5; z += Math.cos(h) * 0.5;
    }
    if (!ok || run.length < 16) continue;
    if (runs.some((o) => o.some((p) => Math.hypot(p.x - run[0].x, p.z - run[0].z) < 25))) continue;
    runs.push(run);
  }
  return runs;
}

function wallGeometry(runs: { x: number; z: number; y: number }[][], season: Season): THREE.BufferGeometry {
  const r = seeded('land:wall-stones');
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (const run of runs) {
    for (let i = 0; i < run.length; i++) {
      // gaps where the wall has tumbled down
      if (fbm(run[i].x / 5 + 3, run[i].z / 5) > 0.45) continue;
      const p = run[i], q = run[Math.min(run.length - 1, i + 1)], yaw = Math.atan2(q.x - p.x, q.z - p.z);
      const layers = 2 + (r() < 0.5 ? 1 : 0);
      for (let k = 0; k < layers; k++) {
        const w = 0.34 + r() * 0.18, hgt = 0.2 + r() * 0.08;
        const g = new THREE.BoxGeometry(w * (k === layers - 1 ? 0.8 : 1), hgt, 0.45 + r() * 0.1);
        g.rotateY(yaw + (r() - 0.5) * 0.4);
        g.translate(p.x + (r() - 0.5) * 0.08, p.y + hgt / 2 + k * 0.21 - 0.04, p.z + (r() - 0.5) * 0.08);
        const top = k === layers - 1;
        c.copy(GROUND.rock).lerp(GROUND.rockWarm, r()).multiplyScalar(0.85 + r() * 0.2);
        if (top && season !== 'winter' && r() < 0.4) c.lerp(season === 'autumn' ? GROUND.autumnTint : GROUND.moss, 0.55);
        const col = new Float32Array(g.attributes.position.count * 3);
        const n = g.attributes.normal;
        for (let v = 0; v < g.attributes.position.count; v++) {
          const s = top && season === 'winter' && n.getY(v) > 0.5 ? GROUND.snow : c;
          col[v * 3] = s.r; col[v * 3 + 1] = s.g; col[v * 3 + 2] = s.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        parts.push(g);
      }
    }
  }
  return merge(parts);
}

export interface PathDecor { group: THREE.Group; setSeason(s: Season): void; dispose(): void }

export function buildPathDecor(season: Season): PathDecor {
  const group = new THREE.Group();
  group.name = 'path-decor';
  const peb = pebbles();
  const mat = surfaceMaterial({ vertexColors: true, surface: SURF.rock });
  const pm = new THREE.InstancedMesh(rockGeometry({ seed: 21, season, detail: 0, flat: 0.5, warm: 0.6 }), mat, Math.max(1, peb.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  peb.forEach((p, i) => pm.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), s.set(p.s * 1.3, p.s, p.s))));
  pm.count = peb.length;
  pm.computeBoundingSphere();
  pm.receiveShadow = true;
  pm.name = 'path-pebbles';
  const runs = WALL_RUNS;
  const wm = new THREE.Mesh(wallGeometry(runs, season), mat);
  wm.castShadow = true; wm.receiveShadow = true;
  wm.name = 'stone-walls';
  group.add(pm, wm);
  return {
    group,
    setSeason(se) {
      const a = pm.geometry, b = wm.geometry;
      pm.geometry = rockGeometry({ seed: 21, season: se, detail: 0, flat: 0.5, warm: 0.6 });
      wm.geometry = wallGeometry(runs, se);
      a.dispose(); b.dispose();
    },
    dispose() { pm.geometry.dispose(); wm.geometry.dispose(); },
  };
}

/** Wall runs (flora keeps off them; terrain makes them solid). */
export const WALL_RUNS = walls();

/** Distance to the nearest wall stone (Infinity when far from every run). */
export function wallDist(x: number, z: number): number {
  let d = Infinity;
  for (const run of WALL_RUNS) {
    const a = run[0], b = run[run.length - 1];
    if (Math.hypot(x - a.x, z - a.z) > 30 && Math.hypot(x - b.x, z - b.z) > 30) continue;
    for (const p of run) d = Math.min(d, Math.hypot(x - p.x, z - p.z));
  }
  return d;
}