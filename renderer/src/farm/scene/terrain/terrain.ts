/**
 * Terrain: a chunked, faceted heightfield (flat normals, rich vertex colour) that follows `heightAt` exactly at its
 * vertices. Resolution falls off with distance from the valley centre (fine valley floor, coarser mountain ring,
 * very coarse far peaks), chunk seams are hidden by skirts, and three frustum-culls each chunk. Cliffs are coloured
 * per face by slope with strata bands; the ground colour (grass, meadows, paths, banks, seasons, snow) comes from
 * `ground.ts`. Also draws the rock features: mountain outcrops, river boulders, the ford and bank pebbles.
 */
import * as THREE from 'three';
import type { SceneCtx, SystemFactory } from '../context.ts';
import type { Season } from '../../model/types.ts';
import { WORLD, heightAt, normalAt } from '../../world/map.ts';
import { hash2 } from '../../world/noise.ts';
import { toon } from '../toon.ts';
import { GROUND, groundColor, rockColor, sampleGround } from './ground.ts';
import type { GroundSample } from './ground.ts';
import { BANK_PEBBLES, FORD_STONES, OUTCROPS, RIVER_ROCKS } from './features.ts';
import type { Stone } from './features.ts';
import { rockGeometry } from './rocks.ts';
import { WALL_RUNS, buildPathDecor } from './paths.ts';

interface Chunk {
  mesh: THREE.Mesh;
  n: number;
  /** grid samples (n+1)² */
  samples: GroundSample[];
  /** triangle vertex → grid index */
  vidx: Int32Array;
  /** smoothed (grid-scale) normal y per grid vertex: rock follows the big slopes, not every facet */
  gny: Float32Array;
}

const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function buildChunk(x0: number, z0: number, size: number, n: number, mat: THREE.Material, season: Season): Chunk {
  const s = size / n;
  const samples: GroundSample[] = [];
  const edgeKeep = (i: number) => i === 0 || i === n;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      let x = x0 + i * s, z = z0 + j * s;
      // irregular triangulation: jitter interior vertices (seams stay straight)
      if (!edgeKeep(i)) x += (hash2(x * 3.1 + 7, z * 3.1) - 0.5) * s * 0.38;
      if (!edgeKeep(j)) z += (hash2(x * 2.7, z * 2.7 - 11) - 0.5) * s * 0.38;
      samples.push(sampleGround(x, z, heightAt(x, z)));
    }
  }
  const quads = n * n, skirtQuads = n * 4;
  const vcount = quads * 6 + skirtQuads * 12;
  const pos = new Float32Array(vcount * 3);
  const vidx = new Int32Array(vcount);
  let v = 0;
  const put = (gi: number, dy = 0) => {
    const p = samples[gi];
    pos[v * 3] = p.x; pos[v * 3 + 1] = p.h + dy; pos[v * 3 + 2] = p.z;
    vidx[v++] = gi;
  };
  const G = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = G(i, j), b = G(i + 1, j), c = G(i, j + 1), d = G(i + 1, j + 1);
      if (hash2(x0 / s + i, z0 / s + j + 999) < 0.5) { put(a); put(c); put(b); put(b); put(c); put(d); }
      else { put(a); put(c); put(d); put(a); put(d); put(b); }
    }
  }
  // skirts: both windings so they hide seams from either side
  const drop = -Math.max(2, s * 1.5);
  const skirt = (g0: number, g1: number) => {
    put(g0); put(g1); put(g0, drop); put(g1); put(g1, drop); put(g0, drop);
    put(g0); put(g0, drop); put(g1); put(g1); put(g0, drop); put(g1, drop);
  };
  for (let i = 0; i < n; i++) {
    skirt(G(i, 0), G(i + 1, 0));
    skirt(G(i, n), G(i + 1, n));
    skirt(G(0, i), G(0, i + 1));
    skirt(G(n, i), G(n, i + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.name = `terrain:${x0},${z0}`;
  const gny = new Float32Array(samples.length);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const a = samples[G(Math.max(0, i - 1), j)], b = samples[G(Math.min(n, i + 1), j)];
    const c = samples[G(i, Math.max(0, j - 1))], d = samples[G(i, Math.min(n, j + 1))];
    const hx = (b.h - a.h) / Math.max(1e-3, b.x - a.x), hz = (d.h - c.h) / Math.max(1e-3, d.z - c.z);
    gny[G(i, j)] = 1 / Math.hypot(hx, hz, 1);
  }
  const ch: Chunk = { mesh, n, samples, vidx, gny };
  colourChunk(ch, season);
  return ch;
}

const gc = new THREE.Color(), rc = new THREE.Color(), fc = new THREE.Color(), tmpC = new THREE.Color();
function colourChunk(ch: Chunk, season: Season): void {
  const g = ch.mesh.geometry;
  const pos = g.attributes.position.array as Float32Array, nrm = g.attributes.normal.array as Float32Array;
  const col = g.attributes.color.array as Float32Array;
  // ground colour per grid vertex
  const grid = new Float32Array(ch.samples.length * 3);
  ch.samples.forEach((sm, i) => { groundColor(sm, season, gc); grid[i * 3] = gc.r; grid[i * 3 + 1] = gc.g; grid[i * 3 + 2] = gc.b; });
  const tris = ch.vidx.length / 3;
  for (let t = 0; t < tris; t++) {
    const v0 = t * 3;
    const fny = nrm[v0 * 3 + 1];
    const ny = Math.abs(fny) < 0.05 ? fny : fny * 0.3 + (ch.gny[ch.vidx[v0]] + ch.gny[ch.vidx[v0 + 1]] + ch.gny[ch.vidx[v0 + 2]]) * (0.7 / 3);
    const cx = (pos[v0 * 3] + pos[v0 * 3 + 3] + pos[v0 * 3 + 6]) / 3;
    const cy = (pos[v0 * 3 + 1] + pos[v0 * 3 + 4] + pos[v0 * 3 + 7]) / 3;
    const cz = (pos[v0 * 3 + 2] + pos[v0 * 3 + 5] + pos[v0 * 3 + 8]) / 3;
    // cliff rock on steep faces (per face: crisp faceted cliffs), a little lightness jitter per face
    // grass clings to gentle slopes low down; the higher it is, the sooner rock shows through
    // bare rock belongs to the mountains; steep banks down in the valley (pad cuts, the pond) stay earthy
    const high = Math.max(ss(12, 18, cy), ss(62, 84, Math.hypot(cx, cz * 1.05)), ss(-0.5, -1.5, cy - WORLD.water));
    const lim = 0.8 + high * 0.04 - ss(14, 30, cy) * 0.08;
    const rockK = ss(lim, lim - 0.12, ny);
    if (rockK > 0) {
      rockColor(cx, cy, cz, ny, season, rc);
      // low grassy banks show earth, not granite
      if (high < 1) rc.copy(fc.setRGB(grid[ch.vidx[v0] * 3], grid[ch.vidx[v0] * 3 + 1], grid[ch.vidx[v0] * 3 + 2])).multiplyScalar(0.86).lerp(season === 'winter' ? GROUND.mud : GROUND.dirt, 0.22).lerp(rockColor(cx, cy, cz, ny, season, tmpC), high);
    }
    const jit = 1 + (hash2(cx * 5.3 + 1, cz * 5.3 - 3) - 0.5) * 0.07;
    for (let k = 0; k < 3; k++) {
      const vi = v0 + k, gi = ch.vidx[vi];
      fc.setRGB(grid[gi * 3], grid[gi * 3 + 1], grid[gi * 3 + 2]);
      if (rockK > 0) fc.lerp(rc, rockK);
      col[vi * 3] = fc.r * jit; col[vi * 3 + 1] = fc.g * jit; col[vi * 3 + 2] = fc.b * jit;
    }
  }
  g.attributes.color.needsUpdate = true;
}

/** Chunk layout: 50 m chunks over the playable square, 300 m tiles for the far mountains. */
function layout(): { x0: number; z0: number; size: number; n: number }[] {
  const out: { x0: number; z0: number; size: number; n: number }[] = [];
  const H = WORLD.half, C = 50;
  for (let z0 = -H; z0 < H; z0 += C) {
    for (let x0 = -H; x0 < H; x0 += C) {
      const nx = Math.max(x0, Math.min(0, x0 + C)), nz = Math.max(z0, Math.min(0, z0 + C));
      const minR = Math.hypot(nx, nz * 1.05);
      const res = minR < 90 ? 1.25 : minR < 125 ? 2.5 : 5;
      out.push({ x0, z0, size: C, n: Math.round(C / res) });
    }
  }
  const T = H * 2;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    if (!i && !j) continue;
    out.push({ x0: -H + i * T, z0: -H + j * T, size: T, n: 30 });
  }
  return out;
}

interface RockSet { mesh: THREE.InstancedMesh; build(season: Season): THREE.BufferGeometry }

function rockSet(name: string, stones: readonly Stone[], build: (season: Season) => THREE.BufferGeometry, season: Season, place: (s: Stone, m: THREE.Matrix4) => void, cast: boolean): RockSet {
  const mesh = new THREE.InstancedMesh(build(season), toon(0xffffff, { vertexColors: true }), stones.length);
  const m = new THREE.Matrix4();
  stones.forEach((s, i) => { place(s, m); mesh.setMatrixAt(i, m); });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  mesh.name = name;
  return { mesh, build };
}

const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), vp = new THREE.Vector3(), vs = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nv = new THREE.Vector3();
/** Stones sit tilted into the slope (half-way to the ground normal) and sink deeper the steeper it is. */
const placeStone = (sink: number) => (s: Stone, m: THREE.Matrix4) => {
  const n = normalAt(s.x, s.z, Math.max(0.5, s.r * 0.6));
  nv.set(n.x, n.y, n.z).lerp(up, 0.45).normalize();
  q.setFromUnitVectors(up, nv).multiply(q2.setFromAxisAngle(up, s.yaw));
  const steep = 1 - n.y;
  m.compose(vp.set(s.x, s.y - s.r * (sink + steep * 1.4), s.z), q, vs.set(s.r, s.r * s.hy, s.r * (0.8 + hash2(s.x * 3, s.z) * 0.4)));
};

export const terrainSystem: SystemFactory = (ctx: SceneCtx) => {
  let season: Season = ctx.valley.sky.season;
  const mat = toon(0xffffff, { vertexColors: true, shared: false });
  // painterly breakup: world-space value noise gently modulates the vertex colours (no textures)
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLandW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLandW;
float lh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float ln(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), u.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float dist = length(vLandW - cameraPosition);
  float fine = ln(vLandW.xz * 1.7) * 0.6 + ln(vLandW.xz * 4.3 + 11.0) * 0.4;
  float blot = ln(vLandW.xz * 0.23 + 3.0);
  float k = (fine - 0.5) * 0.14 * (1.0 - smoothstep(20.0, 70.0, dist)) + (blot - 0.5) * 0.12;
  diffuseColor.rgb *= 1.0 + k;
}`);
  };
  mat.customProgramCacheKey = () => 'land-terrain';
  const root = new THREE.Group();
  root.name = 'terrain';
  const chunks = layout().map((l) => buildChunk(l.x0, l.z0, l.size, l.n, mat, season));
  for (const c of chunks) { c.mesh.updateMatrix(); root.add(c.mesh); }

  const rocks: RockSet[] = [
    rockSet('outcrops-a', OUTCROPS.filter((_, i) => i % 2 === 0), (se) => rockGeometry({ seed: 31, season: se, detail: 1, flat: 0.8, stretch: 1.3, strata: true, warm: 0.6 }), season, placeStone(0.35), true),
    rockSet('outcrops-b', OUTCROPS.filter((_, i) => i % 2 === 1), (se) => rockGeometry({ seed: 47, season: se, detail: 1, flat: 1.1, strata: true, warm: 0.3, moss: 0.25 }), season, placeStone(0.3), true),
    rockSet('river-rocks', RIVER_ROCKS, (se) => rockGeometry({ seed: 5, season: se, detail: 1, flat: 0.62, moss: 0.5, warm: 0.2 }), season, placeStone(0.05), true),
    rockSet('ford-stones', FORD_STONES, (se) => rockGeometry({ seed: 12, season: se, detail: 1, flat: 0.62, moss: 0.3, warm: 0.7 }), season, placeStone(0.02), true),
    rockSet('pebbles', BANK_PEBBLES, (se) => rockGeometry({ seed: 9, season: se, detail: 0, flat: 0.55, warm: 0.5 }), season, placeStone(0.1), false),
  ];
  for (const r of rocks) root.add(r.mesh);
  const decor = buildPathDecor(season);
  root.add(decor.group);
  ctx.scene.add(root);
  const unCollide = WALL_RUNS.flatMap((run) => run.filter((_, i) => i % 2 === 0).map((p) => ctx.colliders.circle(p.x, p.z, 0.4)));

  return {
    name: 'terrain',
    update() {
      const s = ctx.valley.sky.season;
      if (s === season) return;
      season = s;
      for (const c of chunks) colourChunk(c, season);
      for (const r of rocks) { const old = r.mesh.geometry; r.mesh.geometry = r.build(season); old.dispose(); }
      decor.setSeason(season);
    },
    stats() {
      let tris = 0;
      for (const c of chunks) tris += c.mesh.geometry.attributes.position.count / 3;
      return { chunks: chunks.length, tris };
    },
    dispose() {
      ctx.scene.remove(root);
      for (const u of unCollide) u();
      decor.dispose();
      for (const c of chunks) c.mesh.geometry.dispose();
      for (const r of rocks) r.mesh.geometry.dispose();
      mat.dispose();
    },
  };
};
