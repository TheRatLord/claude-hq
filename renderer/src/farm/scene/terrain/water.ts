/**
 * Stylised toon water for the river and the pond (one mesh, one shader), the waterfall on the north cliff (a falling
 * sheet with scrolling foam bands, splash foam in the pool, drifting mist sprites) and the shore plants (lily pads,
 * reeds, cattails; see shore.ts).
 *
 * A DataTexture baked once over the world carries, per texel: water depth (R), distance to the shore (G) and the
 * river flow vector (BA). The shader turns them into depth colour, shoreline foam lines that lap toward the bank,
 * foam rings around mid-stream rocks, flow-mapped ripples that run downstream, sun sparkles, sky reflection,
 * night darkening and winter ice on the pond.
 */
import * as THREE from 'three';
import type { SceneCtx, SystemFactory } from '../context.ts';
import type { Season } from '../../model/types.ts';
import { POND, RIVER, RIVER_HALF_WIDTH, WORLD, heightAt, structure } from '../../world/map.ts';
import { WATER_STONES } from './features.ts';
import { buildShore } from './shore.ts';

const HALF = WORLD.half;
const TEX = 512;

/** Nearest river point: distance, unit tangent and arc fraction. */
const LENS = RIVER.slice(1).map((b, i) => Math.hypot(b.x - RIVER[i].x, b.z - RIVER[i].z));
const TOTAL = LENS.reduce((a, b) => a + b, 0);
const near = { d: 0, tx: 0, tz: 1, t: 0, side: 1 };
function riverNearest(x: number, z: number): { d: number; tx: number; tz: number; t: number; side: number } {
  let best = Infinity, tx = 0, tz = 1, at = 0, acc = 0, side = 1;
  const lens = LENS, total = TOTAL;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l = lens[i];
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (l * l)));
    const ex = a.x + dx * t - x, ez = a.z + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) { best = d; tx = dx / l; tz = dz / l; at = (acc + t * l) / total; side = (x - a.x) * dz - (z - a.z) * dx >= 0 ? 1 : -1; }
    acc += l;
  }
  near.d = Math.sqrt(best); near.tx = tx; near.tz = tz; near.t = at; near.side = side;
  return near;
}

/** Wavelength (m) of the baked along-river coordinate (stored as cos/sin so it wraps seamlessly). */
const ALONG_L = 24;
/** Across-river coordinate range stored in the lane texture (± m). */
const ACROSS_R = 16;

const makeTex = (data: Uint8Array): THREE.DataTexture => {
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
};

/**
 * Bake over the world square: `data` = water depth / distance to the shore / river flow vector; `lanes` = the river's
 * own coordinates (cos, sin of the along-river distance, across-river offset, river weight) for flow-aligned streaks.
 */
function bakeWaterData(): { data: THREE.DataTexture; lanes: THREE.DataTexture } {
  const N = TEX, cell = (2 * HALF) / N;
  const depth = new Float32Array(N * N).fill(-1);
  const fx = new Float32Array(N * N), fz = new Float32Array(N * N);
  const ac = new Float32Array(N * N), as = new Float32Array(N * N), across = new Float32Array(N * N), rw = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = -HALF + (j + 0.5) * cell;
    for (let i = 0; i < N; i++) {
      const x = -HALF + (i + 0.5) * cell;
      const rn = riverNearest(x, z);
      const dp = Math.hypot(x - POND.x, z - POND.z);
      if (rn.d > RIVER_HALF_WIDTH + 10 && dp > POND.r + 8) continue;
      const k = j * N + i;
      depth[k] = WORLD.water - heightAt(x, z);
      if (rn.d < dp - POND.r + RIVER_HALF_WIDTH) {
        // river flow: gentle at the pool, fastest mid-river, a touch slower toward the banks
        const sp = (0.3 + 0.7 * Math.min(1, rn.t / 0.05)) * (1 - 0.35 * Math.min(1, rn.d / (RIVER_HALF_WIDTH + 2)));
        fx[k] = rn.tx * sp; fz[k] = rn.tz * sp;
        const ang = ((rn.t * TOTAL) / ALONG_L) * Math.PI * 2;
        ac[k] = Math.cos(ang); as[k] = Math.sin(ang);
        across[k] = rn.d * rn.side; rw[k] = 1;
      }
    }
  }
  // stones poke out of the water: they count as shore (foam rings)
  for (const s of WATER_STONES) {
    const r = s.r * 0.8;
    const i0 = Math.floor((s.x - r + HALF) / cell), i1 = Math.ceil((s.x + r + HALF) / cell);
    const j0 = Math.floor((s.z - r + HALF) / cell), j1 = Math.ceil((s.z + r + HALF) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const x = -HALF + (i + 0.5) * cell, z = -HALF + (j + 0.5) * cell;
      if (Math.hypot(x - s.x, z - s.z) < r) depth[j * N + i] = Math.min(depth[j * N + i], -0.01);
    }
  }
  // chamfer distance to the nearest non-water texel
  const INF = 1e6, dist = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) dist[k] = depth[k] > 0 ? INF : 0;
  const D1 = 1, D2 = Math.SQRT2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; if (!dist[k]) continue;
    let v = dist[k];
    if (i > 0) v = Math.min(v, dist[k - 1] + D1);
    if (j > 0) { v = Math.min(v, dist[k - N] + D1); if (i > 0) v = Math.min(v, dist[k - N - 1] + D2); if (i < N - 1) v = Math.min(v, dist[k - N + 1] + D2); }
    dist[k] = v;
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const k = j * N + i; if (!dist[k]) continue;
    let v = dist[k];
    if (i < N - 1) v = Math.min(v, dist[k + 1] + D1);
    if (j < N - 1) { v = Math.min(v, dist[k + N] + D1); if (i < N - 1) v = Math.min(v, dist[k + N + 1] + D2); if (i > 0) v = Math.min(v, dist[k + N - 1] + D2); }
    dist[k] = v;
  }
  // soften the flow field so bends turn smoothly (box blur, 2 passes)
  const blur = (a: Float32Array) => {
    const b = new Float32Array(a.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        b[k] = (a[k] * 4 + a[k - 1] + a[k + 1] + a[k - N] + a[k + N]) / 8;
      }
      a.set(b);
    }
  };
  blur(fx); blur(fz); blur(ac); blur(as); blur(rw);
  const lanes = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    const l = Math.hypot(ac[k], as[k]) || 1;
    lanes[k * 4] = Math.round((ac[k] / l * 0.5 + 0.5) * 255);
    lanes[k * 4 + 1] = Math.round((as[k] / l * 0.5 + 0.5) * 255);
    lanes[k * 4 + 2] = Math.round(Math.max(0, Math.min(1, across[k] / (2 * ACROSS_R) + 0.5)) * 255);
    lanes[k * 4 + 3] = Math.round(Math.min(1, rw[k]) * 255);
  }
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    data[k * 4] = Math.round(Math.max(0, Math.min(1, depth[k] / 3)) * 255);
    data[k * 4 + 1] = Math.round(Math.min(1, (dist[k] * cell) / 12) * 255);
    data[k * 4 + 2] = Math.round((fx[k] * 0.5 + 0.5) * 255);
    data[k * 4 + 3] = Math.round((fz[k] * 0.5 + 0.5) * 255);
  }
  return { data: makeTex(data), lanes: makeTex(lanes) };
}

/** Flat water surface covering every cell that dips below the waterline (plus a margin the banks hide). */
function buildSurface(): THREE.BufferGeometry {
  const s = 1.6, x0 = -175, x1 = HALF, z0 = -HALF, z1 = 215;
  const nx = Math.ceil((x1 - x0) / s), nz = Math.ceil((z1 - z0) / s);
  const wet = new Uint8Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * s, z = z0 + j * s;
    const rn = riverNearest(x, z);
    if (rn.d > RIVER_HALF_WIDTH + 9 && Math.hypot(x - POND.x, z - POND.z) > POND.r + 7) continue;
    wet[j * (nx + 1) + i] = heightAt(x, z) < WORLD.water + 0.15 ? 1 : 0;
  }
  const pos: number[] = [], idx: number[] = [];
  const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
  const v = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    if (vid[k] < 0) { vid[k] = pos.length / 3; pos.push(x0 + i * s, 0, z0 + j * s); }
    return vid[k];
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const w = wet[j * (nx + 1) + i] | wet[j * (nx + 1) + i + 1] | wet[(j + 1) * (nx + 1) + i] | wet[(j + 1) * (nx + 1) + i + 1];
    if (!w) continue;
    const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const NOISE_GLSL = /* glsl */ `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm2(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.13 + 7.1) * 0.3 + vnoise(p * 4.7 - 3.3) * 0.1; }
/** value noise periodic in x with integer period P (for the wrapping along-river coordinate) */
float vnp(vec2 p, float P) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, P), x1 = mod(i.x + 1.0, P);
  return mix(mix(h21(vec2(x0, i.y)), h21(vec2(x1, i.y)), u.x), mix(h21(vec2(x0, i.y + 1.0)), h21(vec2(x1, i.y + 1.0)), u.x), u.y);
}
`;

export interface WaterUniforms {
  uTime: { value: number };
  uSky: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSun: { value: number };
  uNight: { value: number };
  uWinter: { value: number };
  uWet: { value: number };
}

function waterMaterial(data: THREE.Texture, lanes: THREE.Texture, u: WaterUniforms, fall: THREE.Vector2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...u,
      uData: { value: data }, uLanes: { value: lanes }, uHalf: { value: HALF }, uFall: { value: fall },
      uShallow: { value: new THREE.Color(0x7fd9c8) }, uMid: { value: new THREE.Color(0x3fa3c8) }, uDeep: { value: new THREE.Color(0x22598a) },
      uBed: { value: new THREE.Color(0xd9c38c) }, uBank: { value: new THREE.Color(0x2f5a3a) },
      uFoam: { value: new THREE.Color(0xf4fbff) }, uIce: { value: new THREE.Color(0xcfe6f2) },
    },
    fog: true,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uData, uLanes; uniform float uTime, uHalf, uSun, uNight, uWinter, uWet; uniform vec2 uFall;
      uniform vec3 uSky, uSunDir, uSunColor, uShallow, uMid, uDeep, uBed, uBank, uFoam, uIce;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        vec2 p = vWorld.xz;
        vec2 tuv = (p + uHalf) / (2.0 * uHalf);
        vec4 d = texture2D(uData, tuv);
        float depth = d.r * 3.0, shore = d.g * 12.0;
        vec2 flow = d.ba * 2.0 - 1.0;
        float speed = clamp(length(flow) * 1.1, 0.0, 1.0);
        float t = uTime;
        // river coordinates (along wraps every ${ALONG_L} m, seamlessly), for flow-aligned ripples and streaks
        vec4 ln = texture2D(uLanes, tuv);
        float rw = smoothstep(0.5, 0.9, ln.a) * speed;
        float rk = smoothstep(0.15, 0.55, rw);
        float along = atan(ln.g * 2.0 - 1.0, ln.r * 2.0 - 1.0) * (${ALONG_L.toFixed(1)} / 6.2832);
        float across = (ln.b - 0.5) * ${(2 * ACROSS_R).toFixed(1)};
        float mpp = max(length(fwidth(p)), 1e-4);                    // metres per pixel
        float rip = 0.0;
        if (rk < 0.999) {
          // two-phase flow map: ripples ride the current without stretching forever
          float ph0 = fract(t * 0.16), ph1 = fract(t * 0.16 + 0.5), wgt = abs(ph0 * 2.0 - 1.0);
          vec2 drift = vec2(t * 0.05, t * 0.03);
          float ra = fbm2((p - flow * ph0 * 7.0) * 0.42 + drift);
          float rb = fbm2((p - flow * ph1 * 7.0) * 0.42 + drift + 17.3);
          rip = mix(ra, rb, wgt);
        }
        if (rk > 0.001) {
          // in the current: ripples stretched along the flow, scrolling downstream
          float fa = (along - t * 1.5) * 0.25;                         // period 6 cells = ${ALONG_L} m
          float rr = vnp(vec2(fa, across * 0.8), 6.0) * 0.7 + vnoise(p * 1.3 + vec2(t * 0.2, 0.0)) * 0.3;
          rip = mix(rip, rr, rk);
        }
        // depth colour: pale turquoise shallows, blue body, dark deep centre
        vec3 col = mix(uShallow, uMid, smoothstep(0.08, 0.6, depth));
        col = mix(col, uDeep, smoothstep(0.6, 1.25, depth));
        col *= 0.9 + rip * 0.2;
        // the bottom showing through the shallows: warm sand, dappled pebbles, wobbling with the ripples
        float bedK = 1.0 - smoothstep(0.06, 0.8, depth);
        if (bedK > 0.004) {
          vec2 q = p * 1.7 + (rip - 0.5) * 0.5;
          vec2 ci = floor(q), cf = fract(q) - 0.5 - (vec2(h21(ci + 1.3), h21(ci + 5.9)) - 0.5) * 0.4;
          float ph = h21(ci);
          float pr = 0.16 + 0.14 * h21(ci + 9.1);
          float pfw = mpp * 1.7;
          float peb = (1.0 - smoothstep(pr - pfw, pr + pfw, length(cf * vec2(1.0, 1.3)))) * step(ph, 0.55) * (1.0 - smoothstep(0.08, 0.35, pfw));
          vec3 bed = uBed * (0.92 + vnoise(p * 0.6) * 0.16);
          bed = mix(bed, bed * (ph < 0.25 ? vec3(0.72, 0.74, 0.78) : vec3(1.08, 1.03, 0.94)), peb);
          col = mix(col, bed * mix(vec3(1.0), uShallow * 1.25, 0.45), bedK * 0.62);
        }
        // the river: long painted streaks riding the current in lanes across the stream
        float streak = 0.0;
        if (rw > 0.01) {
          float ac = across + sin(along * 0.5236 + across * 1.3) * 0.12;
          float lane = ac / 0.7, li = floor(lane), lf = fract(lane);
          float hl = h21(vec2(li, 3.1));
          float N = 6.0;                                               // dash cells per ${ALONG_L} m: 4 m
          float a = (along - t * 2.0 * (0.8 + 0.4 * hl)) / (${ALONG_L.toFixed(1)} / N) + hl * 5.0;
          float ai = mod(floor(a), N), af = fract(a);
          float hd = h21(vec2(li + 0.37, ai));
          float len = 0.35 + 0.45 * hd;
          float tt = clamp(af / len, 0.0, 1.0);
          float wdt = 0.12 * sin(tt * 3.1416) + 0.015;
          float awf = mpp / 0.7, awa = mpp * N / ${ALONG_L.toFixed(1)};
          float onA = smoothstep(0.0, awa * 1.5, af) * (1.0 - smoothstep(len - awa * 1.5, len, af));
          float dash = (1.0 - smoothstep(wdt - awf, wdt + awf, abs(lf - 0.5 - (hd - 0.5) * 0.4))) * onA * step(hd, 0.62);
          float fade = 1.0 - smoothstep(0.05, 0.3, awf);             // lanes thinner than a few px: gone
          streak = dash * rw * fade * smoothstep(0.4, 1.4, shore) * (hd > 0.3 ? 1.0 : -1.0);
        }
        // toon ripple contour lines
        float fw = max(fwidth(rip), 1e-4);
        float line = 1.0 - smoothstep(0.0, fw * 1.4, abs(rip - 0.56));
        float line2 = 1.0 - smoothstep(0.0, fw * 1.2, abs(rip - 0.34));
        col += (line * 0.16 + line2 * 0.07) * (0.4 + 0.6 * smoothstep(0.2, 1.0, depth));
        // reflections: a soft painted band of the far bank's trees along the shore opposite the viewer, and the
        // sky brightening toward grazing angles (fresnel)
        vec3 V = normalize(cameraPosition - vWorld);
        float reflK = 0.0;
        float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
        {
          float e = 1.0 / 512.0;
          vec2 g = vec2(texture2D(uData, tuv + vec2(e, 0.0)).g, texture2D(uData, tuv + vec2(0.0, e)).g) - d.g;
          vec2 toShore = dot(g, g) > 1e-7 ? -normalize(g) : vec2(0.0);
          vec2 look = normalize(-V.xz + vec2(1e-4, 0.0));
          float farBank = smoothstep(0.1, 0.7, dot(toShore, look));
          float band = 1.0 - smoothstep(1.4, 4.2, shore + (rip - 0.5) * 2.2 + vnoise(p * 0.45) * 1.4);
          vec3 bank = mix(uBank, vec3(0.8, 0.84, 0.88), uWinter * 0.75);
          vec3 skyR = mix(uSky, uSky * 1.15 + vec3(0.06), fr);
          col = mix(col, skyR, 0.1 + fr * 0.6);
          col = mix(col, mix(col, bank, 0.8) * (0.85 + rip * 0.3), band * farBank * (0.35 + 0.4 * fr) * (1.0 - uWet * 0.4));
          reflK = band * farBank;
        }
        // current streaks on top (light ones, a few darker troughs)
        col = mix(col, mix(col, uFoam, 0.7), max(streak, 0.0) * 0.85);
        col *= 1.0 + min(streak, 0.0) * 0.2;
        // foam: a crisp line at the water's edge, bands lapping toward the bank, flecks in the current, the pool
        float fn = vnoise(p * 1.6 - flow * t * 1.8 + vec2(t * 0.15, 0.0));
        float edge = 1.0 - step(0.16 + fn * 0.3 + speed * 0.1, shore);
        float lap = step(0.84, fract(shore * 0.6 + t * 0.35 + fn * 0.3)) * (1.0 - smoothstep(0.6, 1.9 + speed * 0.4, shore));
        float flecks = step(0.74, vnoise((p - flow * t * 2.4) * vec2(1.4, 1.4) + 3.7)) * speed * (1.0 - smoothstep(0.4, 2.8, shore)) * 0.9;
        float fall = distance(p, uFall);
        float pool = 1.0 - smoothstep(1.5, 9.0, fall);
        float churn = step(0.62 - pool * 0.5, vnoise(p * 1.1 + vec2(sin(t * 0.7) * 0.5, -t * 1.3)) * pool + pool * 0.25);
        float ring = step(0.8, fract(fall * 0.35 - t * 0.5 + fn * 0.25)) * (1.0 - smoothstep(4.0, 12.0, fall));
        float foam = max(max(edge, lap), max(flecks, max(churn * step(0.02, pool), ring)));
        col = mix(col, uFoam, foam * 0.92);
        // sun sparkles where the view catches the sun's reflection
        vec3 R = reflect(-uSunDir, vec3(0.0, 1.0, 0.0));
        float glint = pow(max(dot(R, V), 0.0), 6.0);
        float sp = vnoise(p * 3.1 + flow * t * 3.0 + t * 0.4) * vnoise(p * 2.3 - t * 0.55 + 5.1);
        float spark = step(0.74 - glint * 0.2, sp) * (0.25 + glint) * (1.0 - uNight * 0.6) * (1.0 - foam);
        col += spark * uSunColor * 0.9;
        // rain: little rings popping all over the surface
        {
          vec2 q = p * 0.85; vec2 cell = floor(q); vec2 fq = fract(q) - 0.5;
          float hs = h21(cell); float tt = fract(t * 0.8 + hs * 7.0);
          vec2 off = (vec2(h21(cell + 3.1), h21(cell + 7.7)) - 0.5) * 0.5;
          float rr = length(fq - off);
          float drop = (1.0 - smoothstep(0.0, 0.035, abs(rr - tt * 0.42))) * (1.0 - tt) * step(hs, uWet * 0.9);
          col = mix(col, uFoam, drop * 0.55 * (1.0 - uWinter));
        }
        // winter: the still pond ices over, the river grows shelf ice at the banks
        float still = 1.0 - smoothstep(0.03, 0.12, speed);
        float ice = uWinter * max(still * 0.9, 1.0 - step(0.6 + fn * 0.9, shore));
        float crack = 1.0 - smoothstep(0.0, fwidth(rip) * 1.5, abs(fract(rip * 3.0) - 0.5) - 0.44);
        col = mix(col, uIce * (0.92 + rip * 0.12) - crack * 0.08 * still, ice * 0.88);
        // light: sun tint by day, deep blue at night
        float lit = clamp(uSun / 2.2, 0.2, 1.15);
        col *= mix(vec3(1.0), uSunColor, 0.3) * lit;
        col = mix(col, col * vec3(0.16, 0.24, 0.42), uNight);
        float alpha = mix(0.62, 0.94, smoothstep(0.0, 1.3, depth));
        alpha = max(max(alpha, reflK * 0.85), max(foam, ice));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** The waterfall's falling sheet: traced down the cliff face so it never cuts into the rock. */
function buildFall(): { geo: THREE.BufferGeometry; top: THREE.Vector3; base: THREE.Vector3 } {
  const s = structure('waterfall');
  const cx = s.x;
  // find the lip: walking north from the pool, the first point where the cliff levels off
  let zLip = s.z, yLip = heightAt(cx, zLip);
  for (let z = s.z + 4; z > s.z - 16; z -= 0.25) {
    const h = heightAt(cx, z);
    if (h > yLip) { yLip = h; zLip = z; }
    if (heightAt(cx, z - 1) - h < 0.4 && h > 20) break;
  }
  // front of the rock face at height y (searching from the pool toward the cliff)
  const faceZ = (y: number) => { for (let z = s.z + 8; z > zLip - 2; z -= 0.2) if (heightAt(cx, z) >= y) return z; return zLip; };
  const rows = 26, cols = 7;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const yBot = WORLD.water - 0.2;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const y = yLip + 0.3 + (yBot - yLip - 0.3) * v;
    // pour: arcs out from the lip, then hugs the face a metre or so in front of it
    const arc = Math.sqrt(v) * 2.2;
    let z = Math.max(zLip + arc, faceZ(y) + 1.1);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const w = 6.2 + v * 3.6;
      const x = cx + (u - 0.5) * w;
      const zz = z + Math.cos((u - 0.5) * Math.PI) * 0.6 * (0.3 + v) ;
      pos.push(x, y, Math.max(zz, faceZ(y) + 0.7 + (heightAt(x, zz) > y ? 1 : 0)));
      uv.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const lastRow = rows * (cols + 1) + cols / 2;
  return { geo, top: new THREE.Vector3(cx, yLip, zLip), base: new THREE.Vector3(pos[Math.floor(lastRow) * 3], WORLD.water, pos[Math.floor(lastRow) * 3 + 2]) };
}

function fallMaterial(u: WaterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: u.uTime, uNight: u.uNight, uSun: u.uSun, uSunColor: u.uSunColor, uWinter: u.uWinter,
      uBody: { value: new THREE.Color(0x7cc6e0) }, uFoam: { value: new THREE.Color(0xf6fcff) } },
    fog: true, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <common>
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uNight, uSun, uWinter; uniform vec3 uBody, uFoam, uSunColor;
      varying vec2 vUv;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        float u = vUv.x, v = vUv.y, t = uTime;
        float streak = vnoise(vec2(u * 13.0, v * 0.9 - t * 0.9));
        float n = vnoise(vec2(u * 7.0 + 3.0, v * 6.0 - t * 3.0));
        float bands = step(0.84, fract(v * 4.5 - t * 1.5 + sin(u * 9.0) * 0.06 + n * 0.35));
        float white = max(step(0.74, streak * 0.8 + n * 0.3), bands);
        white = max(white, step(v, 0.06 + n * 0.05));               // bright lip
        // the sheet: darker glassy lanes between light ribbons running down it
        float lanes = vnoise(vec2(u * 22.0, v * 1.4 - t * 1.2));
        vec3 body = uBody * (0.8 + streak * 0.3) * (lanes < 0.35 ? 0.86 : 1.0) + (lanes > 0.72 ? 0.08 : 0.0);
        vec3 col = mix(body, uFoam, white);
        // where it hits the pool: billowing foam in two toon tones (sunlit puffs over blue-grey shade)
        float base = smoothstep(0.78, 0.9, v + n * 0.12);
        float puff = vnoise(vec2(u * 9.0 + sin(t * 0.8 + v * 6.0) * 0.3, v * 7.0 - t * 2.4)) * 0.7 + n * 0.3;
        vec3 froth = mix(vec3(0.6, 0.76, 0.88), uFoam, smoothstep(0.47, 0.53, puff + (v - 0.9) * 0.8));
        col = mix(col, froth, base);
        white = max(white, base);
        float ragged = 0.08 + vnoise(vec2(v * 6.0 - t * 2.0, u)) * 0.12;
        float a = smoothstep(0.0, ragged, u) * smoothstep(1.0, 1.0 - ragged, u) * (0.82 + white * 0.18);
        col = mix(col, vec3(0.86, 0.94, 1.0), uWinter * 0.35);
        col *= mix(vec3(1.0), uSunColor, 0.25) * clamp(uSun / 2.2, 0.2, 1.1);
        col = mix(col, col * vec3(0.14, 0.2, 0.36), uNight);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** Mist: soft sprites rising and spreading from the plunge pool (one draw, animated on the GPU). */
function buildMist(base: THREE.Vector3, u: WaterUniforms): THREE.Points {
  const n = 34;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = base.x; pos[i * 3 + 1] = base.y; pos[i * 3 + 2] = base.z; seed[i] = (i * 0.6180339) % 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(base.clone().setY(base.y + 5), 16);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime, uNight: u.uNight, uScale: { value: 900 } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float seed; uniform float uTime, uScale; varying float vA;
      void main() {
        float life = fract(uTime * (0.12 + seed * 0.08) + seed * 7.13);
        float ang = seed * 43.0;
        vec3 p = position + vec3(cos(ang) * 1.3, 0.0, sin(ang) * 0.5 + 0.9) * (1.5 + life * 6.0 * (0.4 + fract(seed * 13.7)));
        p.y += life * (1.2 + fract(seed * 5.3) * 2.8);
        vA = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.5, 1.0, life));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(220.0, uScale * (1.0 + life * 2.0) / max(1.0, -mv.z));
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r = length(c);
        float a = smoothstep(0.5, 0.1, r) * vA * 0.14;
        gl_FragColor = vec4(mix(vec3(0.95, 0.98, 1.0), vec3(0.35, 0.42, 0.58), uNight), a);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.renderOrder = 2;
  return pts;
}

export const waterSystem: SystemFactory = (ctx: SceneCtx) => {
  const L = ctx.lighting;
  const u: WaterUniforms = {
    uTime: { value: 0 }, uSky: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) }, uSun: { value: 2.2 }, uNight: { value: 0 }, uWinter: { value: 0 }, uWet: { value: 0 },
  };
  const root = new THREE.Group();
  root.name = 'water';
  const { data, lanes } = bakeWaterData();
  const fall = buildFall();
  const surface = new THREE.Mesh(buildSurface(), waterMaterial(data, lanes, u, new THREE.Vector2(fall.base.x, fall.base.z)));
  surface.position.y = WORLD.water;
  surface.renderOrder = 1;
  surface.receiveShadow = false;
  const sheet = new THREE.Mesh(fall.geo, fallMaterial(u));
  sheet.renderOrder = 2;
  const mist = buildMist(fall.base, u);
  root.add(surface, sheet, mist);

  let season: Season = ctx.valley.sky.season;
  let shore = buildShore(season);
  root.add(shore.group);
  ctx.scene.add(root);

  return {
    name: 'water',
    update(f) {
      u.uTime.value = f.time;
      u.uSky.value.copy(L.skyColor);
      u.uSunDir.value.copy(L.sunDir);
      u.uSunColor.value.copy(L.sunColor);
      u.uSun.value = L.sunIntensity;
      u.uNight.value = L.night;
      u.uWet.value = L.wet;
      const s = ctx.valley.sky.season;
      u.uWinter.value += ((s === 'winter' ? 1 : 0) - u.uWinter.value) * Math.min(1, f.dt * 2);
      if (s !== season) {
        season = s;
        root.remove(shore.group);
        shore.dispose();
        shore = buildShore(season);
        root.add(shore.group);
      }
      shore.update(f.time);
    },
    dispose() {
      ctx.scene.remove(root);
      surface.geometry.dispose(); (surface.material as THREE.Material).dispose();
      sheet.geometry.dispose(); (sheet.material as THREE.Material).dispose();
      mist.geometry.dispose(); (mist.material as THREE.Material).dispose();
      data.dispose(); lanes.dispose();
      shore.dispose();
    },
  };
};
