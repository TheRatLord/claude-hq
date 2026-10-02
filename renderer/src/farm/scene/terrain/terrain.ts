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
import { GROUND, groundColor, groundKinds, pathAcross, rockColor, sampleGround, snowLine } from './ground.ts';
import type { GroundKinds, GroundSample } from './ground.ts';
import { SURF, chainShader, setSurfaceQuality, surfaceMaterial, surfaceQuality, withSurfaces } from '../surface/index.ts';
import { BANK_PEBBLES, FORD_STONES, OUTCROPS, RIVER_ROCKS } from './features.ts';
import type { Stone } from './features.ts';
import { rockGeometry } from './rocks.ts';
import { MEADOW_GLSL, bloomColors } from './meadow.ts';
import { WALL_RUNS, buildPathDecor } from './paths.ts';
import { buildHorizon } from './horizon.ts';

interface Chunk {
  mesh: THREE.Mesh;
  n: number;
  /** grid samples (n+1)² */
  samples: GroundSample[];
  /** triangle vertex → grid index */
  vidx: Int32Array;
  /** smoothed (grid-scale) normal y per grid vertex: rock follows the big slopes, not every facet */
  gny: Float32Array;
  /** far mountain tile (its normals are mostly analytic: rock follows them) */
  far: boolean;
}

const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function buildChunk(x0: number, z0: number, size: number, n: number, mat: THREE.Material, season: Season): Chunk {
  const s = size / n;
  const samples: GroundSample[] = [];
  const edgeKeep = (i: number) => i === 0 || i === n;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      let x = x0 + i * s, z = z0 + j * s;
      // irregular triangulation: jitter interior vertices (seams stay straight); calmer on the strata wall, where a
      // crumpled grid would scramble the ledges
      const jk = 0.38 - 0.26 * ss(88, 100, Math.hypot(x, z * 1.05)) * (s < 2 ? 1 : 0);
      if (!edgeKeep(i)) x += (hash2(x * 3.1 + 7, z * 3.1) - 0.5) * s * jk;
      if (!edgeKeep(j)) z += (hash2(x * 2.7, z * 2.7 - 11) - 0.5) * s * jk;
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
  // far mountains: mostly smooth (analytic) normals, so the toon ramp paints a few big lit / shadow planes instead
  // of facet-by-facet crumpled-paper noise; continuous across chunks (from heightAt, not per chunk)
  if (s >= 4.9) {
    const nrm = g.attributes.normal.array as Float32Array;
    const sn = samples.map((p) => normalAt(p.x, p.z, s * 1.5));
    for (let k = 0; k < quads * 6; k++) {
      const q = sn[vidx[k]], i = k * 3;
      const x = nrm[i] * 0.15 + q.x * 0.85, y = nrm[i + 1] * 0.15 + q.y * 0.85, z = nrm[i + 2] * 0.15 + q.z * 0.85;
      const l = Math.hypot(x, y, z) || 1;
      nrm[i] = x / l; nrm[i + 1] = y / l; nrm[i + 2] = z / l;
    }
  }
  else {
    // the strata wall: lean each facet's normal toward the wall's smooth normal, so the toon ramp paints clean lit
    // ledges and shaded risers instead of a facet-by-facet sawtooth
    const nrm = g.attributes.normal.array as Float32Array;
    const wk = samples.map((p) => 0.55 * ss(90, 102, Math.hypot(p.x, p.z * 1.05)));
    if (wk.some((k) => k > 0)) {
      const sn = samples.map((p, i) => (wk[i] > 0 ? normalAt(p.x, p.z, 0.9) : null));
      for (let k = 0; k < quads * 6; k++) {
        const q = sn[vidx[k]], w = wk[vidx[k]], i = k * 3;
        if (!q || !w) continue;
        const x = nrm[i] * (1 - w) + q.x * w, y = nrm[i + 1] * (1 - w) + q.y * w, z = nrm[i + 2] * (1 - w) + q.z * w;
        const l = Math.hypot(x, y, z) || 1;
        nrm[i] = x / l; nrm[i + 1] = y / l; nrm[i + 2] = z / l;
      }
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
  // surface weights for the shader: landA = (path, sand, rock, snow) per season, landB = (across path m, rut, pebbles, cliff turf lip)
  g.setAttribute('landA', new THREE.BufferAttribute(new Float32Array(vcount * 4), 4));
  const landB = new Float32Array(vcount * 4);
  const lip = lipField(samples);
  const across = new Float32Array(samples.length * 2);
  // across is needed just outside the path too (else it interpolates to 0 across the edge triangles: false ruts)
  samples.forEach((sm, i) => { if (sm.path > 0.02 || Math.hypot(sm.x, sm.z + 1) < 72) { const a = pathAcross(sm.x, sm.z); across[i * 2] = a.across; across[i * 2 + 1] = a.rut; } });
  for (let k = 0; k < vcount; k++) { const gi = vidx[k]; landB[k * 4] = across[gi * 2]; landB[k * 4 + 1] = across[gi * 2 + 1]; landB[k * 4 + 3] = lip[gi]; }
  g.setAttribute('landB', new THREE.BufferAttribute(landB, 4));
  // path dirt colour (the vertex colour is the grass without the path: the shader paints a crisp edge between them)
  g.setAttribute('landD', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
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
  const ch: Chunk = { mesh, n, samples, vidx, gny, far: s >= 4.9 };
  colourChunk(ch, season);
  return ch;
}

/**
 * Turf lip along the cliff strata: a steep sample whose ground 1.6 m further uphill is barely higher sits just under
 * a shelf edge. Interpolated over the riser faces and thresholded with noise in the shader, it paints a ragged,
 * crisp turf lip where the shelf's grass rolls over every ledge, with a shadow line under it.
 */
function lipField(samples: GroundSample[]): Float32Array {
  const out = new Float32Array(samples.length);
  samples.forEach((p, i) => {
    if (Math.hypot(p.x, p.z * 1.05) < 82) return;
    const nn = normalAt(p.x, p.z, 0.4);
    const g = Math.hypot(nn.x, nn.z);
    if (nn.y > 0.8 || g < 1e-3) return;
    const ux = -nn.x / g, uz = -nn.z / g;
    const rise = heightAt(p.x + ux * 1.6, p.z + uz * 1.6) - p.h;
    out[i] = ss(2.2, 0.2, rise);
  });
  return out;
}

const gc = new THREE.Color(), rc = new THREE.Color(), fc = new THREE.Color(), tmpC = new THREE.Color();
const kinds: GroundKinds = { sand: 0, pebble: 0, snow: 0 };
function colourChunk(ch: Chunk, season: Season): void {
  const g = ch.mesh.geometry;
  const pos = g.attributes.position.array as Float32Array, nrm = g.attributes.normal.array as Float32Array;
  const col = g.attributes.color.array as Float32Array;
  const la = g.attributes.landA.array as Float32Array, lb = g.attributes.landB.array as Float32Array;
  const ld = g.attributes.landD.array as Float32Array;
  // ground colour + surface weights per grid vertex
  const grid = new Float32Array(ch.samples.length * 3), dgrid = new Float32Array(ch.samples.length * 3);
  const kind = new Float32Array(ch.samples.length * 4);
  ch.samples.forEach((sm, i) => {
    groundColor(sm, season, gc, 'grass'); grid[i * 3] = gc.r; grid[i * 3 + 1] = gc.g; grid[i * 3 + 2] = gc.b;
    groundColor(sm, season, gc, 'dirt'); dgrid[i * 3] = gc.r; dgrid[i * 3 + 1] = gc.g; dgrid[i * 3 + 2] = gc.b;
    groundKinds(sm, season, kinds);
    kind[i * 4] = sm.path; kind[i * 4 + 1] = kinds.sand; kind[i * 4 + 2] = kinds.pebble; kind[i * 4 + 3] = kinds.snow;
  });
  const tris = ch.vidx.length / 3;
  for (let t = 0; t < tris; t++) {
    const v0 = t * 3;
    // true facet normal y (the normal attribute may be smoothed on the mountains)
    const ax = pos[v0 * 3 + 3] - pos[v0 * 3], ay = pos[v0 * 3 + 4] - pos[v0 * 3 + 1], az = pos[v0 * 3 + 5] - pos[v0 * 3 + 2];
    const bx = pos[v0 * 3 + 6] - pos[v0 * 3], by = pos[v0 * 3 + 7] - pos[v0 * 3 + 1], bz = pos[v0 * 3 + 8] - pos[v0 * 3 + 2];
    const fcx = ay * bz - az * by, fcy = az * bx - ax * bz, fcz = ax * by - ay * bx;
    const fny = ch.far ? nrm[v0 * 3 + 1] : fcy / (Math.hypot(fcx, fcy, fcz) || 1);
    const ny0 = Math.abs(fny) < 0.05 ? fny : fny * 0.3 + (ch.gny[ch.vidx[v0]] + ch.gny[ch.vidx[v0 + 1]] + ch.gny[ch.vidx[v0 + 2]]) * (0.7 / 3);
    // a level facet (a strata shelf on the cliff wall) holds grass even where the grid around it is steep
    const ny = fny > 0.8 ? Math.max(ny0, fny + 0.02) : ny0;
    const cx = (pos[v0 * 3] + pos[v0 * 3 + 3] + pos[v0 * 3 + 6]) / 3;
    const cy = (pos[v0 * 3 + 1] + pos[v0 * 3 + 4] + pos[v0 * 3 + 7]) / 3;
    const cz = (pos[v0 * 3 + 2] + pos[v0 * 3 + 5] + pos[v0 * 3 + 8]) / 3;
    // cliff rock on steep faces (per face: crisp faceted cliffs), a little lightness jitter per face
    // grass clings to gentle slopes low down; the higher it is, the sooner rock shows through
    // bare rock belongs to the mountains; steep banks down in the valley (pad cuts, the pond) stay earthy
    const high = Math.max(ss(12, 18, cy), ss(62, 84, Math.hypot(cx, cz * 1.05)), ss(-0.5, -1.5, cy - WORLD.water));
    const lim = 0.8 + high * 0.04 - ss(14, 30, cy) * 0.08;
    const rockK = ss(lim, lim - 0.12, ny);
    // valley banks (not the mountains) blend per vertex from the smoothed slope: a steep grassy mound (the windmill
    // hill) shades into earth softly instead of in crisp dark facets
    const soft = high < 1 && !ch.far;
    if (rockK > 0 || soft) {
      rockColor(cx, cy, cz, ny, season, rc);
      // low grassy banks show earth, not granite
      if (high < 1) rc.copy(fc.setRGB(grid[ch.vidx[v0] * 3], grid[ch.vidx[v0] * 3 + 1], grid[ch.vidx[v0] * 3 + 2])).multiplyScalar(0.86).lerp(season === 'winter' ? GROUND.mud : GROUND.dirt, 0.22).lerp(rockColor(cx, cy, cz, ny, season, tmpC), high);
    }
    // the strata wall: rock colour per vertex (bands follow the ledges, not each facet's centre: no sawtooth)
    const wall = !ch.far && rockK > 0 && high >= 1 && Math.hypot(cx, cz * 1.05) > 92;
    const jit = 1 + (hash2(cx * 5.3 + 1, cz * 5.3 - 3) - 0.5) * (wall ? 0.03 : 0.07);
    for (let k = 0; k < 3; k++) {
      const vi = v0 + k, gi = ch.vidx[vi];
      if (wall) rockColor(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2], ny, season, rc);
      const rk = soft ? rockK * high + ss(lim, lim - 0.16, ch.gny[gi]) * (1 - high) : rockK;
      fc.setRGB(grid[gi * 3], grid[gi * 3 + 1], grid[gi * 3 + 2]);
      if (rk > 0) fc.lerp(rc, rk);
      col[vi * 3] = fc.r * jit; col[vi * 3 + 1] = fc.g * jit; col[vi * 3 + 2] = fc.b * jit;
      fc.setRGB(dgrid[gi * 3], dgrid[gi * 3 + 1], dgrid[gi * 3 + 2]);
      if (rk > 0) fc.lerp(rc, rk);
      ld[vi * 3] = fc.r * jit; ld[vi * 3 + 1] = fc.g * jit; ld[vi * 3 + 2] = fc.b * jit;
      la[vi * 4] = kind[gi * 4]; la[vi * 4 + 1] = kind[gi * 4 + 1]; la[vi * 4 + 2] = soft ? rk * (0.55 + 0.45 * high) : rk; la[vi * 4 + 3] = kind[gi * 4 + 3];
      lb[vi * 4 + 2] = kind[gi * 4 + 2];
    }
  }
  g.attributes.color.needsUpdate = true;
  g.attributes.landA.needsUpdate = true;
  g.attributes.landB.needsUpdate = true;
  g.attributes.landD.needsUpdate = true;
}

/**
 * Chunk layout: 100 m chunks over the playable square (9 draws; 50 m chunks were 36, ~22–30 of them on screen from
 * the hub or the overview, for +9 % triangles: every near chunk now takes the fine grid), 300 m tiles for the far
 * mountains.
 */
function layout(): { x0: number; z0: number; size: number; n: number }[] {
  const out: { x0: number; z0: number; size: number; n: number }[] = [];
  const H = WORLD.half, C = 100;
  for (let z0 = -H; z0 < H; z0 += C) {
    for (let x0 = -H; x0 < H; x0 += C) {
      const nx = Math.max(x0, Math.min(0, x0 + C)), nz = Math.max(z0, Math.min(0, z0 + C));
      const minR = Math.hypot(nx, nz * 1.05);
      // the cliff wall's strata shelves need the fine grid too (a coarse one smears them into crumpled facets)
      const res = minR < 125 ? 1.25 : 2.5;
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
  const mesh = new THREE.InstancedMesh(build(season), surfaceMaterial({ vertexColors: true, surface: SURF.rock }), stones.length);
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

/**
 * Terrain paint: large painterly blotches (always), and — through the surface library — grass strokes and tufts,
 * meadow flowers, packed dirt paths with pebbles and cart ruts near the hub, sandy/pebbly banks, cliff strata and
 * cracks, snow drifts, blended by the per-vertex weights `landA`/`landB`.
 */
const TERRAIN_FRAG = /* glsl */ `
{
  float sPw = surfPw(vSurfP);
  float sDist = length(vViewPosition);
  vec3 c = diffuseColor.rgb;   // the grass (paths split out)
  vec3 dc = vLandD;            // the path's dirt
  vec3 n = normalize(vSurfN);
  SurfIn cl = surfIn(vSurfP, n, 0, 1.0, sPw, sDist, 0.0, 0.0);
  SurfIn g = cl;
  g.uv = vSurfP.xz;
  g.eye = cameraPosition.xz;
  float wR = vLandA.z;
  float edge = (svn(vSurfP.xz * 1.3) - 0.5) * 0.3;
  // ragged, painted path edge: two octaves of breakup, crisp (pixel-wide AA), grass tufts creeping over the dirt
  // and a dark rim just inside it (the path weight changes by ≈ 1 per metre across the edge)
  float pe = vLandA.x + edge;
  if (abs(pe - 0.45) < 0.25) pe += (svn(vSurfP.xz * 4.7 + 2.0) - 0.5) * 0.16 * slod(0.15, sPw);
  float pAA = sPw * 1.3 + 0.006;
  float creep = 0.0;
  if (pe > 0.4 && pe < 0.6 && g.near > 0.0) {
    vec3 tf = stuft(g.uv * 5.5 + 31.0, g.eye * 5.5 + 31.0, 0.5, 0.06, 0.8, sPw * 5.5);
    creep = tf.x * 0.15 * slod(0.05, sPw) * g.near * (1.0 - sst(0.55, pe, 0.02));
  }
  float wP = sst(0.45, pe - creep, pAA);
  float pRim = wP * (1.0 - sst(0.5, pe - creep, pAA)) * slod(0.05, sPw);
  vec3 cb = mix(c, dc, sst(0.45, vLandA.x + edge, 0.1));
  float wSa = sst(0.45, vLandA.y + edge, 0.08);
  float wS = sst(0.4, vLandA.w + edge * 0.6, 0.1);
  vec3 r = c;
  if (wR < 0.99) {
    r = surf_grass(g, c);
    // meadow: sunny blotches and flower specks in drifts across the grass
    float mk = sst(0.58, svn(g.uv * 0.05 + 5.0), 0.04) * (1.0 - wS) * (1.0 - wP) * (1.0 - wSa);
    if (mk > 0.0) {
      vec4 f = sdot(g.uv * 3.2, 0.08, 0.26, g.pw * 3.2);
      vec3 petal = f.y < 0.55 ? mix(vec3(0.92, 0.9, 0.84), vec3(0.95, 0.75, 0.25), step(f.w, 0.35)) : vec3(0.95, 0.72, 0.22);
      r = mix(r, petal * (0.55 + sluma(c)), f.x * slod(0.07, g.pw) * g.near * 0.9 * mk);
    }
    // meadow mosaic (meadow.ts): darker clover drifts, sunny bleached patches and wildflower drifts (a colour wash
    // from afar, petal specks close up); never on paths, banks or snow
    {
      vec2 mP = g.uv;
      float mEw = sPw * 0.12 + 0.004;
      ${MEADOW_GLSL}
      float mOpen = (1.0 - sst(0.14, vLandA.x, 0.08)) * (1.0 - wSa) * (1.0 - wS * 0.85);
#ifdef VW_TOON
      vwTallK = mdw.y * mOpen;   // weather surfaces: no puddles under the rough tall grass
#endif
      if (mOpen > 0.0) {
        float fa = smoothstep(12.0, 70.0, sDist);
        r = mix(r, sgreen(r * vec3(0.88, 0.98, 0.98), -0.3), mdw.x * mOpen);
        r = mix(r, sgreen(r * vec3(1.1, 1.06, 0.84), 0.16), mdw.y * mOpen * 0.9);
        float lcf = slod(0.05, g.pw) * g.near * mdw.x * mOpen;
        if (lcf > 0.0) {
          vec4 cf = sdot(g.uv * 5.0 + 3.0, 0.12, 0.22, g.pw * 5.0);
          r = mix(r, vec3(0.96, 0.93, 0.96) * (0.5 + sluma(c)), cf.x * lcf * 0.8);
        }
        float bk = uBloomK * mdw.z * mOpen;
        if (bk > 0.0) {
          vec3 bc = mdw.w < 0.5 ? uBloomA : (mdw.w < 1.5 ? uBloomB : uBloomC);
          r = mix(r, bc * (0.45 + sluma(c) * 0.9), bk * (0.12 + 0.4 * fa));
          float lbf = slod(0.06, g.pw) * g.near;
          if (lbf > 0.0) {
            vec4 bf = sdot(g.uv * 3.6 + 9.0, 0.14, 0.55, g.pw * 3.6);
            r = mix(r, bc * (0.6 + sluma(c)), bf.x * lbf * bk);
          }
        }
      }
    }
    if (wP > 0.0) {
      vec3 d = sval(surf_dirt(g, dc), -0.16 * pRim);
      float rk = vLandB.y;
      if (rk > 0.01) {
        float a = abs(vLandB.x) + (svn(g.uv * 0.7) - 0.5) * 0.1;
        float rut = 1.0 - sst(0.15, abs(a - 0.62), g.pw);
        float ridge = 1.0 - sst(0.06, abs(a - 0.86), g.pw);
        float mid = 1.0 - sst(0.2, a, g.pw);
        d = sval(d, rk * slod(0.08, g.pw) * (-0.2 * rut + 0.08 * ridge + 0.04 * mid));
      }
      r = mix(r, d, wP);
    }
    if (wSa > 0.0) {
      vec3 sa = surf_sand(g, c);
      float pk = sst(0.45, vLandB.z + edge, 0.1);
      if (pk > 0.0) sa = mix(sa, surf_pebbles(g, c), pk);
      r = mix(r, sa, wSa);
    }
    if (wS > 0.0) r = mix(r, surf_snow(g, r), wS);
  }
#ifdef VW_TOON
  vwPathK = max(wP, wSa * 0.6);   // weather surfaces: puddles gather freely on the tracks, rarely on the grass
#endif
  if (wR > 0.01) r = mix(r, surf_cliff(cl, cb), wR);
  // cliff strata: the shelf's turf rolls over each ledge in ragged tongues (landB.w = nearness to the riser top),
  // with a cool shadow line under the overhang; snow caps in winter (uTurf)
  if (vLandB.w > 0.02 && wR > 0.02) {
    // shorter tongues from afar (a calm band from the top view instead of zigzag noise)
    float tongue = ((svn(vSurfP.xz * 0.85 + 1.7) - 0.5) * 0.36 + (svn(vSurfP.xz * 3.3 + 5.0) - 0.5) * 0.16) * (1.0 - 0.55 * smoothstep(50.0, 130.0, sDist));
    float e = vLandB.w + tongue;
    float aa = sPw * 0.9 + 0.012;
    float turf = sst(0.7, e, aa);
    float under = sst(0.58, e, aa) * (1.0 - turf);
    vec3 tc = uTurf * (0.8 + 0.22 * svn(vSurfP.xz * 2.1 + vSurfP.y * 0.6)) * (1.0 + 0.1 * sst(0.85, e, aa));
    r = sval(r, -0.2 * under * wR);
    r = mix(r, tc, turf * wR);
  }
  // far mountains (80 m+): painted planes — cool atmospheric shadow sides, a warm sunlit side, and snowfields worked
  // out per pixel from height and slope (clean curved edges instead of per-facet patches)
  float farK = smoothstep(80.0, 140.0, sDist) * max(wR, smoothstep(0.6, 0.75, min(c.r, min(c.g, c.b))));
  if (farK > 0.0) {
    float ndl = 0.5;
#if NUM_DIR_LIGHTS > 0
    ndl = dot(n, normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz));
#endif
    float lineY = uSnowLine + sin(vSurfP.x * 0.031 + 1.7) * 3.0 + sin(vSurfP.z * 0.043 - vSurfP.x * 0.02) * 2.5;
    float above = vSurfP.y - lineY;
    float snowK = sst(0.0, above, 0.6 + sPw) * sst(0.74 - clamp(above / 80.0, 0.0, 0.14), n.y + (svn(vSurfP.xz * 0.08) - 0.5) * 0.06, 0.02);
    vec3 rockC = mix(r, vec3(0.34, 0.33, 0.32) * (1.0 + 0.12 * sin(vSurfP.x * 0.02 + vSurfP.z * 0.013)), smoothstep(0.5, 0.7, min(r.r, min(r.g, r.b))));
    vec3 pr = mix(rockC, vec3(0.9, 0.93, 0.97), snowK);
    pr = mix(pr, pr * vec3(0.56, 0.7, 1.06), 1.0 - smoothstep(0.0, 0.3, ndl));
    pr = mix(pr, pr * vec3(1.06, 1.02, 0.93), smoothstep(0.45, 0.85, ndl) * (1.0 - snowK));
    r = mix(r, pr, farK);
  }
  diffuseColor.rgb = mix(cb, r, uSurfStrength * uSurfDef.w);
}
`;

/** Turf on the cliff ledges: mossy green, spring-bright, autumn-gold, snow in winter. */
function turfColor(season: Season, out: THREE.Color): THREE.Color {
  out.copy(GROUND.grassB).lerp(GROUND.moss, 0.35).lerp(GROUND.grassA, 0.25);
  if (season === 'spring') out.lerp(GROUND.springTint, 0.3);
  else if (season === 'autumn') out.lerp(GROUND.autumnTint, 0.32).lerp(GROUND.autumnRust, 0.08);
  else if (season === 'winter') out.copy(GROUND.snow).lerp(GROUND.snowShade, 0.25);
  return out;
}

function terrainMaterial(): THREE.MeshToonMaterial {
  const mat = toon(0xffffff, { vertexColors: true, shared: false });
  // painterly breakup: world-space value noise gently modulates the vertex colours (the surface library adds the rest)
  chainShader(mat, (sh) => {
    const fineK = surfaceQuality() === 'low' ? '0.14' : '0.0';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLandW;\nattribute vec4 landA;\nattribute vec4 landB;\nattribute vec3 landD;\nvarying vec4 vLandA;\nvarying vec4 vLandB;\nvarying vec3 vLandD;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLandA = landA;\nvLandB = landB;\nvLandD = landD;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLandW;
varying vec4 vLandA;
varying vec4 vLandB;
varying vec3 vLandD;
float lh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float ln(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), u.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${surfaceQuality() === 'low' ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vLandD, smoothstep(0.3, 0.55, vLandA.x));' : ''}
{
  float dist = length(vLandW - cameraPosition);
  float fine = ln(vLandW.xz * 1.7) * 0.6 + ln(vLandW.xz * 4.3 + 11.0) * 0.4;
  float blot = ln(vLandW.xz * 0.23 + 3.0);
  float k = (fine - 0.5) * ${fineK} * (1.0 - smoothstep(20.0, 70.0, dist)) + (blot - 0.5) * 0.12;
  diffuseColor.rgb *= 1.0 + k;
}`);
  }, () => `land-terrain:${surfaceQuality() === 'low' ? 'low' : 'hi'}`);
  return withSurfaces(mat, { surfaces: ['grass', 'dirt', 'sand', 'pebbles', 'rock', 'cliff', 'snow'], fragment: TERRAIN_FRAG, fragmentKey: 'terrain' });
}

export const terrainSystem: SystemFactory = (ctx: SceneCtx) => {
  let season: Season = ctx.valley.sky.season;
  setSurfaceQuality(ctx.quality);
  const mat = terrainMaterial();
  // snow line for the far-mountain paint (TERRAIN_FRAG), per season
  const snowU = { value: snowLine(season) };
  const turfU = { value: turfColor(season, new THREE.Color()) };
  const bloomU = { uBloomA: { value: new THREE.Color() }, uBloomB: { value: new THREE.Color() }, uBloomC: { value: new THREE.Color() }, uBloomK: { value: 0 } };
  const setBloom = (se: Season) => { bloomU.uBloomK.value = bloomColors(se, [bloomU.uBloomA.value, bloomU.uBloomB.value, bloomU.uBloomC.value]); };
  setBloom(season);
  chainShader(mat, (sh) => {
    sh.uniforms.uSnowLine = snowU;
    sh.uniforms.uTurf = turfU;
    Object.assign(sh.uniforms, bloomU);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSnowLine, uBloomK;\nuniform vec3 uTurf, uBloomA, uBloomB, uBloomC;');
  }, 'land-snowline');
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
  const horizon = buildHorizon();
  root.add(horizon);
  ctx.scene.add(root);
  const unCollide = WALL_RUNS.flatMap((run) => run.filter((_, i) => i % 2 === 0).map((p) => ctx.colliders.circle(p.x, p.z, 0.4)));

  return {
    name: 'terrain',
    update() {
      const s = ctx.valley.sky.season;
      if (s === season) return;
      season = s;
      snowU.value = snowLine(season);
      turfColor(season, turfU.value);
      setBloom(season);
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
      horizon.geometry.dispose();
      (horizon.material as THREE.Material).dispose();
      mat.dispose();
    },
  };
};
