/**
 * The grotto seen from the valley side (world space): flat wet stepping slabs along the ledge from the pool's west
 * shore to behind the falls, mossy boulders where it starts, and the cave mouth in the back of the alcove (a rough
 * rock arch over a dark throat that swallows the light, a faint crystal glow deep inside). One merged solid mesh, the
 * glow card and a drift of spray: three draws, and only when you are near (the system hides them from afar).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint } from '../toon.ts';
import { blob } from '../sculpt.ts';
import { partName, recordParts } from '../parts.ts';
import { heightAt } from '../../world/map.ts';
import { LEDGE, MOUTH } from '../../world/grotto.ts';
import { buildFall } from '../terrain/water.ts';

const rnd = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const clean = (g: THREE.BufferGeometry) => {
  const f = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'color') f.deleteAttribute(k);
  f.computeVertexNormals();
  return f;
};

/** the mouth's opening (world): centre x, sill z, width, height */
export const OPENING = Object.freeze({ x: MOUTH.x, z: MOUTH.z + 0.15, y: MOUTH.y, w: 2.0, h: 2.45 });

/** A slab: a low irregular prism (top at y). */
function slab(x: number, y: number, z: number, r: number, yaw: number, color: number, rand: () => number): THREE.BufferGeometry {
  const n = 6 + Math.floor(rand() * 2), th = 0.16;
  const shape = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (0.78 + rand() * 0.3);
    if (i) shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8); else shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2).translate(0, y - th - 0.03 + 0.02, 0).rotateY(yaw).translate(x, 0, z);
  const f = clean(g);
  // painted per face: wet blue-grey tops, darker sides, a mossy fleck now and then
  const p = f.attributes.position, nrm = f.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const top = nrm.getY(i) > 0.6;
    c.setHex(top ? color : 0x4a4852);
    if (top && rand() < 0.12) c.setHex(0x557a44);
    for (let k = 0; k < 3; k++) c.toArray(col, (i + k) * 3);
  }
  f.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return f;
}

/** The ledge's slabs, the boulders and the mouth's arch + throat (one geometry, vertex coloured). */
export function buildOutside(): THREE.BufferGeometry {
  const r = rnd(41);
  const parts: THREE.BufferGeometry[] = [];
  // stepping slabs along the ledge, close-set, wetter (bluer) toward the falls
  let along = 0;
  for (let i = 0; i + 1 < LEDGE.length; i++) {
    const a = LEDGE[i], b = LEDGE[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    for (let s = i === 0 ? 0.3 : 0; s < l - (i + 2 === LEDGE.length ? 0.6 : 0); s += 0.62) {
      const t = s / l, side = ((Math.floor((along + s) / 0.62)) % 2 ? 1 : -1) * (0.12 + r() * 0.22);
      const x = a.x + dx * t + (-dz / l) * side, z = a.z + dz * t + (dx / l) * side;
      const wet = Math.min(1, Math.max(0, (-z - 104) / 5));
      const col = new THREE.Color(0x8c8880).lerp(new THREE.Color(0x5c6676), wet).getHex();
      parts.push(partName(slab(x, heightAt(x, z), z, 0.36 + r() * 0.12, r() * 3, col, r), 'slab'));
    }
    along += l;
  }
  // a few mossy boulders where the ledge leaves the shore (and that hint something is up there)
  for (const [x, z, s] of [[-34.2, -98.8, 0.55], [-33.9, -101.4, 0.45], [-31.0, -95.6, 0.35]] as const) {
    const y = heightAt(x, z);
    parts.push(partName(blob([x, y + s * 0.35, z], [s, s * 0.75, s * 0.85], { paint: (f) => (f.ny > 0.5 ? 0x5e8a46 : 0x7a766e), sides: 8, rings: 4 }), 'boulder'));
  }
  // the mouth: a rough arch of rock lumps round the opening, bedded into the cut
  const O = OPENING;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (i / 10);
    const x = O.x + Math.cos(a) * (O.w / 2 + 0.35), y = O.y + Math.sin(a) * O.h * 0.92 + (i === 0 || i === 10 ? -0.1 : 0.12);
    const s = 0.42 + r() * 0.2 + (i === 0 || i === 10 ? 0.15 : 0);
    parts.push(partName(blob([x, y, O.z - 0.15], [s, s * 0.9, 0.5], { paint: (f) => (f.ny > 0.55 ? 0x5a7a46 : f.nz > 0.3 ? 0x6e6a70 : 0x58545e), sides: 7, rings: 4 }), 'arch'));
  }
  // the throat: a short tunnel into the rock, its walls darkening to black
  {
    const pos: number[] = [], col: number[] = [];
    const R = 8, L = 6;
    const ring = (j: number, i: number): [number, number, number] => {
      const a = Math.PI * (i / R), d = j / L;
      return [O.x + Math.cos(a) * (O.w / 2 - 0.05) * (1 - d * 0.15), O.y - 0.02 + Math.sin(a) * O.h * (1 - d * 0.18), O.z - d * 2.6];
    };
    const shade = (j: number) => { const k = Math.min(1, j / L); return new THREE.Color(0x3a3644).lerp(new THREE.Color(0x07060a), Math.pow(k, 0.6)); };
    for (let j = 0; j < L; j++) for (let i = 0; i < R; i++) {
      const A = ring(j, i), B = ring(j, i + 1), C = ring(j + 1, i), D = ring(j + 1, i + 1);
      for (const [p, jj] of [[A, j], [C, j + 1], [B, j], [B, j], [C, j + 1], [D, j + 1]] as const) { pos.push(...p); col.push(...shade(jj).toArray()); }
    }
    // the floor of the throat and the dark end
    const fl = (j: number, s: number): [number, number, number] => [O.x + s * (O.w / 2 - 0.05) * (1 - (j / L) * 0.15), O.y - 0.01, O.z - (j / L) * 2.6];
    for (let j = 0; j < L; j++) {
      const A = fl(j, -1), B = fl(j, 1), C = fl(j + 1, -1), D = fl(j + 1, 1);
      for (const [p, jj] of [[A, j], [B, j], [C, j + 1], [B, j], [D, j + 1], [C, j + 1]] as const) { pos.push(...p); col.push(...shade(jj).toArray()); }
    }
    const end = ring(L, 0)[2] - 0.01;
    const ew = O.w / 2, eh = O.h * 0.86;   // just over the last ring: the cap must not poke out of the cliff
    const E = [[O.x - ew, O.y - 0.1, end], [O.x + ew, O.y - 0.1, end], [O.x + ew, O.y + eh, end], [O.x - ew, O.y + eh, end]];
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...E[k]); col.push(0.02, 0.018, 0.03); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    parts.push(partName(g, 'throat'));
  }
  const merged = mergeGeometries(parts.map((p) => clean(p.attributes.color ? p : paint(p, 0x777777))))!;
  recordParts(merged, parts);
  merged.computeBoundingSphere();
  return merged;
}

/** A faint crystal glow deep in the throat (unlit, additive): something in there is shining. */
export function glowCard(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(1.2, 1.1).translate(OPENING.x + 0.2, OPENING.y + 0.75, OPENING.z - 2.35);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d) * (0.18 + 0.06 * sin(uTime * 0.6));
        vec3 c = mix(vec3(0.25, 0.95, 0.85), vec3(0.6, 0.4, 1.0), 0.5 + 0.5 * sin(uTime * 0.13));
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'grotto:glow';
  return mesh;
}

/** Spray drifting across the ledge behind the falls (points, animated on the GPU). */
export function sprayPoints(): THREE.Points {
  const n = 70, r = rnd(3);
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos.set([MOUTH.x - 4.5 + r() * 8, MOUTH.y + 0.2 + r() * 3, MOUTH.z + 1.2 + r() * 3.2], i * 3);
    seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  g.computeBoundingSphere();
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uScale: { value: 380 } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float seed; uniform float uTime, uScale; varying float vA;
      void main() {
        float life = fract(uTime * (0.18 + seed * 0.12) + seed * 9.0);
        vec3 p = position + vec3(sin(seed * 30.0 + uTime * 0.7) * 0.4, -life * 1.2 + 0.6, -life * 0.9);
        vA = smoothstep(0.0, 0.2, life) * (1.0 - smoothstep(0.6, 1.0, life));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(90.0, uScale * (0.05 + seed * 0.06) / max(0.5, -mv.z));
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; varying float vA;
      void main() { float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5)) * vA * 0.22; gl_FragColor = vec4(mix(vec3(0.95, 0.98, 1.0), vec3(0.35, 0.42, 0.58), uNight), a); }`,
  });
  const p = new THREE.Points(g, m);
  p.name = 'grotto:spray';
  p.renderOrder = 3;
  return p;
}

/**
 * The falls seen from behind (from the ledge): the waterfall's own sheet (scene/terrain/water.ts), drawn again a hand's
 * width toward the cliff with only its back faces: streaky, moving, lit through by the day (the valley's glow on the
 * far side), dim and moonlit blue at night. Opaque in the middle, ragged and thin at the edges.
 */
export function curtainBack(): THREE.Mesh {
  const geo = buildFall().geo.clone().translate(0, 0, -0.14);
  geo.computeBoundingSphere();
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDay: { value: 1 } },
    side: THREE.BackSide, transparent: true,
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDay; varying vec2 vUv; varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float u = vUv.x, v = vUv.y, t = uTime;
        float streak = n(vec2(u * 16.0, v * 1.1 - t * 1.3));
        float fine = n(vec2(u * 44.0, v * 3.2 - t * 2.9));
        float lanes = n(vec2(u * 24.0, v * 1.5 - t * 1.1));
        // daylight through falling water: pale glowing blue with brighter ribbons and darker glassy lanes
        vec3 day = mix(vec3(0.24, 0.5, 0.66), vec3(0.78, 0.9, 0.96), smoothstep(0.25, 0.85, streak * 0.75 + fine * 0.3));
        day *= lanes < 0.32 ? 0.78 : 1.0;
        vec3 night = mix(vec3(0.05, 0.08, 0.16), vec3(0.16, 0.22, 0.36), streak);
        vec3 col = mix(night, day, uDay);
        col += step(0.8, streak * 0.7 + fine * 0.4) * mix(0.08, 0.2, uDay);
        // thinner (brighter) toward the middle, churning white where it meets the pool
        col *= 0.85 + 0.3 * (1.0 - abs(u - 0.5) * 2.0);
        col = mix(col, mix(vec3(0.3, 0.38, 0.5), vec3(0.86, 0.93, 0.97), uDay), smoothstep(0.82, 0.95, v + fine * 0.08) * 0.8);
        float ragged = 0.1 + n(vec2(v * 6.0 - t * 2.0, u)) * 0.12;
        float a = smoothstep(0.0, ragged, u) * smoothstep(1.0, 1.0 - ragged, u);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'grotto:curtain';
  mesh.renderOrder = 2;
  return mesh;
}
