/**
 * Ground colouring shared by the terrain mesh and anything that wants to match it (grass tufts take their tint from
 * here so they melt into the ground). Colours are linear RGB (THREE.Color from sRGB hex).
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PATHS, POND, RIVER, WORLD, distToPolyline, heightAt, pathAt } from '../../world/map.ts';
import { fbm, hash2 } from '../../world/noise.ts';

const C = (hex: number) => new THREE.Color(hex);
export const GROUND = Object.freeze({
  grassA: C(0x8cc453), grassB: C(0x57953a), meadow: C(0xa6cf5c), lush: C(0x4e9844), dry: C(0xc6bd62), alpine: C(0xa2b067),
  dirt: C(0xb08254), dirtDark: C(0x8a6040), dirtLight: C(0xc9a06c), edge: C(0x7c8e45),
  sand: C(0xe3cd92), wetSand: C(0xb9a47c), pebble: C(0xa39b8e), bed: C(0x8d8a66), bedDeep: C(0x55705f),
  rock: C(0x9c9486), rockWarm: C(0xb0a08a), rockDark: C(0x6c665f), rockCool: C(0x8a8b8e), moss: C(0x6f8f45),
  snow: C(0xf2f6fb), snowShade: C(0xdbe6f2), frost: C(0xe9eff4), mud: C(0xa89684),
  springTint: C(0x92d86a), autumnTint: C(0xc9a24e), autumnRust: C(0xc07a40),
});

/** Per-point inputs that are expensive to sample (cached per terrain vertex so a season change only recolours). */
export interface GroundSample { x: number; z: number; h: number; path: number; wet: number }

export function sampleGround(x: number, z: number, h = heightAt(x, z)): GroundSample {
  const dw = Math.min(distToPolyline(x, z, RIVER) - 3.6, Math.hypot(x - POND.x, z - POND.z) - POND.r);
  return { x, z, h, path: pathAt(x, z), wet: dw };
}

const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const tmp = new THREE.Color();

/** Snow line (height above which flat ground is white) by season. */
export const snowLine = (season: Season): number => (season === 'winter' ? 13 : season === 'spring' ? 46 : season === 'autumn' ? 48 : 56);

/**
 * Colour of flat (non-cliff) ground. `out` is written and returned. `part` splits paths out: 'grass' = the ground
 * without path dirt (keeps the worn fringe), 'dirt' = the path's dirt at this point (the terrain shader paints the
 * edge between them), 'all' = the soft blend (fallback without surfaces).
 */
export function groundColor(s: GroundSample, season: Season, out: THREE.Color, part: 'all' | 'grass' | 'dirt' = 'all'): THREE.Color {
  const { x, z, h } = s;
  const n1 = fbm(x / 26, z / 26, 3), n2 = fbm(x / 60 + 3.1, z / 60 - 7.7, 3), n3 = fbm(x / 7 - 1.3, z / 7 + 4.4, 2);
  // grass: two greens by low-frequency noise, meadow patches, fine mottling
  out.copy(GROUND.grassB).lerp(GROUND.grassA, ss(-0.5, 0.5, n1 + n3 * 0.45));
  out.lerp(GROUND.meadow, ss(0.2, 0.55, n2) * 0.75);
  // lush and dark near water, drier and yellower up the slopes and on ridges
  out.lerp(GROUND.lush, ss(9, 1.5, s.wet) * 0.6);
  const dry = ss(3.5, 9, h) * 0.55 + ss(0.15, 0.55, n2 * -1 + n3 * 0.3) * 0.25;
  out.lerp(GROUND.dry, Math.min(0.55, dry));
  out.lerp(GROUND.alpine, ss(16, 30, h) * 0.7);

  // seasons on the grass
  if (season === 'spring') out.lerp(GROUND.springTint, 0.22 + 0.1 * n1);
  else if (season === 'autumn') { out.lerp(GROUND.autumnTint, 0.2 + 0.1 * n2); out.lerp(GROUND.autumnRust, ss(0.35, 0.7, n3) * 0.2); }
  else if (season === 'winter') { const g = (out.r + out.g + out.b) / 3; out.lerp(tmp.setRGB(g, g, g * 1.05), 0.5).lerp(GROUND.frost, 0.6 + 0.32 * ss(-0.3, 0.5, n1 + n3 * 0.5)); }

  // banks: wet sand ring and pebbles at the waterline, riverbed below it
  const above = h - WORLD.water;
  // a little sandy beach on the pond's sunny south-east shore
  const px = x - POND.x, pz = z - POND.z, pd = Math.hypot(px, pz);
  if (pd < POND.r + 9 && pd > 1) {
    const sector = ss(0.2, 0.6, (px * 0.26 + pz * 0.97) / pd) * ss(POND.r + 9, POND.r + 5, pd + n3 * 1.5) * (0.85 + 0.15 * n3);
    if (sector > 0 && above > -0.05) out.lerp(tmp.copy(GROUND.sand).lerp(GROUND.snow, season === 'winter' ? 0.5 : 0), Math.min(1, sector * 1.3));
  }
  if (above < 0.7) {
    const sand = tmp.copy(GROUND.sand).lerp(GROUND.wetSand, ss(0.35, -0.05, above));
    if (hash2(x * 2.3, z * 2.3) > 0.72) sand.lerp(GROUND.pebble, 0.6);
    out.lerp(sand, ss(0.7, 0.3, above));
    if (above < -0.05) out.copy(GROUND.bed).lerp(GROUND.bedDeep, ss(-0.1, -1.3, above));
  }

  // soft dirt paths with a worn grassy fringe and darker ruts
  const p = part === 'dirt' ? 1 : s.path;
  if (p > 0.02) {
    out.lerp(GROUND.edge, ss(0.02, 0.3, p) * 0.35 * (part === 'grass' ? 1 : 1 - ss(0.3, 0.6, p)));
    if (part !== 'grass') {
      const d = tmp.copy(GROUND.dirt).lerp(GROUND.dirtLight, ss(-0.3, 0.5, n3)).lerp(GROUND.dirtDark, ss(0.45, 0.9, fbm(x / 3, z / 3, 2)) * 0.5);
      if (season === 'winter') d.lerp(GROUND.mud, 0.55).lerp(GROUND.snowShade, ss(0.1, 0.8, fbm(x / 5, z / 5, 2)) * 0.6);
      out.lerp(d, part === 'dirt' ? 1 : ss(0.22, 0.62, p + n3 * 0.12));
    }
  }

  // snow on high flat ground (seasonal snow line)
  const line = snowLine(season) + n1 * 4;
  if (h > line - 3) out.lerp(GROUND.snow, ss(line - 3, line + 2, h));
  return out;
}

/** Surface weights the terrain shader paints with (surface library): sand/bank, pebbles, snow (see terrain.ts). */
export interface GroundKinds { sand: number; pebble: number; snow: number }
export function groundKinds(s: GroundSample, season: Season, out: GroundKinds): GroundKinds {
  const { x, z, h } = s;
  const n1 = fbm(x / 26, z / 26, 3), n3 = fbm(x / 7 - 1.3, z / 7 + 4.4, 2);
  const above = h - WORLD.water;
  let sand = above < 0.7 ? ss(0.7, 0.3, above) : 0;
  const px = x - POND.x, pz = z - POND.z, pd = Math.hypot(px, pz);
  if (pd < POND.r + 9 && pd > 1 && above > -0.05) {
    sand = Math.max(sand, Math.min(1, 1.3 * ss(0.2, 0.6, (px * 0.26 + pz * 0.97) / pd) * ss(POND.r + 9, POND.r + 5, pd + n3 * 1.5)));
  }
  if (above < -0.05) sand = Math.max(sand, 0.6); // riverbed: sandy grit under the water
  out.sand = sand;
  // pebbly strip right at the waterline
  out.pebble = sand > 0 ? ss(0.45, 0.15, Math.abs(above - 0.1)) * 0.9 : 0;
  const line = snowLine(season) + n1 * 4;
  const snow = h > line - 3 ? ss(line - 3, line + 2, h) : 0;
  const frost = season === 'winter' ? 0.55 + 0.25 * ss(-0.3, 0.5, n1 + n3 * 0.5) : 0;
  out.snow = Math.max(snow, frost * (1 - s.path * 0.5));
  return out;
}

/** Signed distance (m) across the nearest path's centreline, and how rutted it is (wide cart tracks near the hub). */
export function pathAcross(x: number, z: number): { across: number; rut: number } {
  let best = Infinity, across = 0, width = 0;
  // only the wide cart road carries ruts (branches and junctions would scramble the across coordinate)
  for (const p of PATHS) {
    if (p.width < 2.9) continue;
    const pts = p.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const qx = a.x + dx * t - x, qz = a.z + dz * t - z, d = Math.hypot(qx, qz);
      if (d < best) { best = d; width = p.width; across = Math.sign(dx * (z - a.z) - dz * (x - a.x)) * d; }
    }
  }
  const hub = Math.hypot(x, z + 1);
  const rut = best > width * 0.7 ? 0 : ss(2.3, 2.9, width) * ss(70, 40, hub) * ss(15, 19, hub);
  return { across, rut };
}

/** Cliff rock with strata bands by height; `ny` (face normal y) lets snow settle on ledges. */
export function rockColor(x: number, y: number, z: number, ny: number, season: Season, out: THREE.Color): THREE.Color {
  const warp = fbm(x / 30, z / 30, 2) * 2.5;
  const band = Math.sin(y * 0.85 + warp);
  const band2 = Math.sin(y * 2.3 + warp * 1.7);
  out.copy(GROUND.rock).lerp(GROUND.rockWarm, ss(-0.2, 0.9, fbm(x / 14 + 5, z / 14, 2)) * 0.6);
  out.lerp(GROUND.rockCool, ss(20, 45, y) * 0.5);
  if (band > 0.55) out.lerp(GROUND.rockDark, 0.55);
  else if (band2 > 0.8) out.lerp(GROUND.rockDark, 0.3);
  const line = snowLine(season) + fbm(x / 20, z / 20, 2) * 4;
  if (y > line) out.lerp(GROUND.snowShade, ss(0.45, 0.7, ny) * ss(line, line + 4, y));
  return out;
}
