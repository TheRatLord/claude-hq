/**
 * Path dressing and field boundaries: pebbles scattered along the dirt path edges, kerb stones edging the roads where
 * they leave the square, and old dry-stone walls (mossy, snow-capped in winter): a few wandering across the meadows,
 * more following the farm tracks a couple of metres off the road. Static: three draw calls.
 */
import * as THREE from 'three';
import { seeded } from '../../../core/rng.ts';
import type { Season } from '../../model/types.ts';
import { PATHS, WORLD, clearance, heightAt, pathAt, slopeAt } from '../../world/map.ts';
import { fbm } from '../../world/noise.ts';
import { SURF, surfaceMaterial } from '../surface/index.ts';
import { merge } from '../flora/geom.ts';
import { rockGeometry } from './rocks.ts';
import { GROUND } from './ground.ts';
import { OUTCROPS } from './features.ts';
import { partName } from '../parts.ts';

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
        // the lowest ground round it: in a hollow the 1.25 m terrain mesh runs below heightAt and a pebble would hover
        const y = Math.min(heightAt(x, z), heightAt(x + 0.6, z), heightAt(x - 0.6, z), heightAt(x, z + 0.6), heightAt(x, z - 0.6));
        out.push({ x, y: y - 0.02, z, s: 0.06 + r() * 0.1, yaw: r() * 6.28 });
      }
    }
  }
  return out;
}

/** Kerb stones along both edges of each road for its first few metres out of the square. */
function kerbs(): Peb[] {
  const r = seeded('land:kerbs');
  const out: Peb[] = [];
  for (const p of PATHS) {
    for (let i = 0; i < p.points.length - 1; i++) {
      const a = p.points[i], b = p.points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      for (let d = 0; d < l; d += 0.62) {
        const cx = a.x + (dx * d) / l, cz = a.z + (dz * d) / l, hd = Math.hypot(cx - HUB.x, cz - HUB.z);
        if (hd < 10.2 || hd > 15.5 - r() * 2) continue;
        for (const side of [-1, 1]) {
          const off = p.width / 2 + 0.1;
          const x = cx - (dz / l) * off * side, z = cz + (dx / l) * off * side;
          // only where this edge is a real edge (not inside another road or the square) and the ground is dry
          if (pathAt(x, z) > 0.75 || Math.hypot(x - HUB.x, z - HUB.z) < 10.2 || clearance(x, z) < -0.4 - p.width / 2) continue;
          if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 0.72)) continue;
          const hs = [heightAt(x, z), heightAt(x + 0.3, z), heightAt(x - 0.3, z), heightAt(x, z + 0.3), heightAt(x, z - 0.3)];
          const y = Math.min(...hs);
          if (Math.max(...hs) - y > 0.09) continue; // a kink in the ground (pad edge): the terrain mesh cuts the chord
          out.push({ x, y: y + 0.03, z, s: 0.19 + r() * 0.04, yaw: Math.atan2(dx, dz) + (r() - 0.5) * 0.25 });
        }
      }
    }
  }
  return out;
}

/** Old dry-stone walls: short wandering runs in open meadow, and runs following the farm tracks. */
function walls(): { x: number; z: number; y: number }[][] {
  // (a run breaks off rather than marching through a boulder: outcrops only keep clear of `clearance`, not of walls)
  const rocky = (x: number, z: number) => OUTCROPS.some((o) => Math.abs(o.x - x) < 6 && Math.hypot(o.x - x, o.z - z) < o.r * 1.4 + 0.8);
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
      if (clearance(x, z) < 1.6 || slopeAt(x, z) > 0.25 || heightAt(x, z) < WORLD.water + 0.6 || rocky(x, z)) { ok = false; break; }
      run.push({ x, z, y: heightAt(x, z) });
      h += fbm(x / 9, z / 9) * 0.08;
      x += Math.sin(h) * 0.5; z += Math.cos(h) * 0.5;
    }
    if (!ok || run.length < 16) continue;
    if (runs.some((o) => o.some((p) => Math.hypot(p.x - run[0].x, p.z - run[0].z) < 25))) continue;
    runs.push(run);
  }
  // field walls along the tracks: parallel to a road, a couple of metres off its edge, broken where anything's in the way
  const rp = seeded('land:track-walls');
  for (let tries = 0, added = 0; tries < 300 && added < 9; tries++) {
    const p = PATHS[Math.floor(rp() * PATHS.length)];
    if (p.width < 2) continue;
    const pts = p.points, i0 = Math.floor(rp() * (pts.length - 1)), side = rp() < 0.5 ? -1 : 1, off = p.width / 2 + 2.6;
    const len = 9 + rp() * 10;
    const run: { x: number; z: number; y: number }[] = [];
    let ok = true;
    for (let i = i0, acc = 0; i < pts.length - 1 && acc < len; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      for (let t = i === i0 ? rp() * l * 0.5 : 0; t < l && acc < len; t += 0.5, acc += 0.5) {
        const x = a.x + (dx * t) / l - (dz / l) * off * side, z = a.z + (dz * t) / l + (dx / l) * off * side;
        const R = Math.hypot(x, z * 1.05);
        if (R < 26 || R > 86 || clearance(x, z) < 1.5 || slopeAt(x, z) > 0.22 || heightAt(x, z) < WORLD.water + 0.6 || rocky(x, z)) { ok = false; break; }
        run.push({ x, z, y: heightAt(x, z) });
      }
      if (!ok) break;
    }
    if (!ok || run.length < 16) continue;
    if (runs.some((o) => o.some((q) => run.some((w) => Math.hypot(q.x - w.x, q.z - w.z) < 8)))) continue;
    runs.push(run);
    added++;
  }
  return runs;
}

function wallGeometry(runs: { x: number; z: number; y: number }[][], season: Season): THREE.BufferGeometry {
  const r = seeded('land:wall-stones');
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (const [ri, run] of runs.entries()) {
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
        parts.push(partName(g, `wall#${ri}`));
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
  const kb = kerbs();
  const kerbGeo = (se: Season) => rockGeometry({ seed: 33, season: se, detail: 0, flat: 0.42, warm: 0.35, stretch: 1.5 });
  const km = new THREE.InstancedMesh(kerbGeo(season), mat, Math.max(1, kb.length));
  kb.forEach((p, i) => km.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw + Math.PI / 2), s.set(p.s * 1.25, p.s, p.s))));
  km.count = kb.length;
  km.computeBoundingSphere();
  km.receiveShadow = true;
  km.name = 'kerb-stones';
  group.add(pm, wm, km);
  return {
    group,
    setSeason(se) {
      const a = pm.geometry, b = wm.geometry, c = km.geometry;
      pm.geometry = rockGeometry({ seed: 21, season: se, detail: 0, flat: 0.5, warm: 0.6 });
      wm.geometry = wallGeometry(runs, se);
      km.geometry = kerbGeo(se);
      a.dispose(); b.dispose(); c.dispose();
    },
    dispose() { pm.geometry.dispose(); wm.geometry.dispose(); km.geometry.dispose(); },
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