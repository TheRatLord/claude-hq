/**
 * The frozen pond (winter, scene/seasons): its own mesh and material over the water (the water shader's own winter
 * tint stays underneath), so the land package's water look is untouched. One draw: the ice sheet (pale, glassy toward
 * the middle, milky at the edges, long cracks, old skate scratches and a dusting of snow that follows the lying-snow
 * trace), the snowbanks drifted round the shore and a rime of frost on the dock's planks.
 *
 * Your own skating carves into a small scratch map (R8, 256², ≈ 10 cm a texel) over the pond, uploaded at most a few
 * times a second; it lasts until the ice thaws.
 */
import * as THREE from 'three';
import type { Lighting } from '../context.ts';
import { POND, STRUCTURES, WORLD, heightAt } from '../../world/map.ts';
import { DOCK, dockStart } from '../structures/leisure.ts';

/** the scratch map's square over the pond: x0, z0, size (m) */
export const SCRATCH_BOX = Object.freeze({ x0: POND.x - 13, z0: POND.z - 13, size: 26 });
const SN = 256;

/** water depth, metres (≤ 0 on land) */
const depthAt = (x: number, z: number) => WORLD.water - heightAt(x, z);
/** the ice: the pond's water, not the river */
export function onIce(x: number, z: number): boolean {
  return Math.hypot(x - POND.x, z - POND.z) < POND.r + 3.5 && depthAt(x, z) > 0.02;
}

const dock = STRUCTURES.find((s) => s.id === 'dock')!;
/** dock-local → world */
export function dockToWorld(lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(dock.yaw), s = Math.sin(dock.yaw);
  return { x: dock.x + lx * c + lz * s, z: dock.z - lx * s + lz * c };
}
export function worldToDock(x: number, z: number): { x: number; z: number } {
  const c = Math.cos(dock.yaw), s = Math.sin(dock.yaw), dx = x - dock.x, dz = z - dock.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
/** the dock's deck: local z range and height (world) */
export const DECK = (() => {
  const water = WORLD.water - dock.y;
  const z0 = dockStart({ deckY: water + 0.75, water, ground: (lz) => { const w = dockToWorld(0, lz); return heightAt(w.x, w.z) - dock.y; } });
  return Object.freeze({ z0, z1: DOCK.z1, w: DOCK.w, y: WORLD.water + 0.75 });
})();

function buildIceGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], kind: number[] = [], edge: number[] = [], nrm: number[] = [];
  const push = (x: number, y: number, z: number, k: number, e: number, n: THREE.Vector3) => { pos.push(x, y, z); kind.push(k); edge.push(e); nrm.push(n.x, n.y, n.z); };
  const UP = new THREE.Vector3(0, 1, 0);
  // the sheet: a grid over the pond, every cell that touches open water
  const R = POND.r + 3.5, cell = 0.5, n = Math.ceil((2 * R) / cell);
  const y = WORLD.water + 0.025;
  const ed = (x: number, z: number) => Math.max(0, Math.min(1, depthAt(x, z) / 0.9));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = POND.x - R + i * cell, z0 = POND.z - R + j * cell, x1 = x0 + cell, z1 = z0 + cell;
    if (Math.max(depthAt(x0, z0), depthAt(x1, z0), depthAt(x0, z1), depthAt(x1, z1)) <= 0) continue;
    if (Math.hypot((x0 + x1) / 2 - POND.x, (z0 + z1) / 2 - POND.z) > R) continue;
    const q: [number, number][] = [[x0, z0], [x0, z1], [x1, z0], [x1, z0], [x0, z1], [x1, z1]];
    for (const [x, z] of q) push(x, y, z, 0, ed(x, z), UP);
  }
  // snowbanks drifted round the shore: low lumpy mounds on the waterline
  const lump = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const lp = lump.attributes.position;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), nn = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const steps = Math.round((2 * Math.PI * POND.r) / 0.55);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 + rnd() * 0.04;
    const dx = Math.cos(a), dz = Math.sin(a);
    // walk out from the middle to the waterline
    let r = 3;
    while (r < POND.r + 5 && depthAt(POND.x + dx * r, POND.z + dz * r) > 0.04) r += 0.1;
    const x = POND.x + dx * (r - 0.15), z = POND.z + dz * (r - 0.15);
    const w = worldToDock(x, z);
    if (Math.abs(w.x) < DECK.w / 2 + 0.6 && w.z > DECK.z0 - 0.5 && w.z < DECK.z1 + 0.3) continue;
    if (rnd() < 0.18) continue;
    q.setFromAxisAngle(UP, -a + (rnd() - 0.5) * 0.4);
    s.set(0.35 + rnd() * 0.35, 0.12 + rnd() * 0.16, 0.5 + rnd() * 0.5);
    m.compose(v.set(x, WORLD.water - 0.04, z), q, s);
    nm.getNormalMatrix(m);
    for (let k = 0; k < lp.count; k++) {
      v.fromBufferAttribute(lp, k);
      if (v.y < -0.2) v.y = -0.2 - (v.y + 0.2) * 0.1; // flat-ish bottom
      v.applyMatrix4(m);
      push(v.x, v.y, v.z, 1, 0, UP);
    }
  }
  lump.dispose();
  // a rime of frost on the dock's planks (a hair above them)
  const dy = DECK.y + 0.006, hw = DECK.w / 2;
  const corners: [number, number][] = [[-hw, DECK.z0], [-hw, DECK.z1], [hw, DECK.z0], [hw, DECK.z0], [-hw, DECK.z1], [hw, DECK.z1]];
  for (const [lx, lz] of corners) { const w = dockToWorld(lx, lz); push(w.x, dy, w.z, 2, 0, UP); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  // flat facet normals for the snowbanks (the toon bands read their facets)
  const P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute, K = g.attributes.aKind as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < P.count; t += 3) {
    if (K.getX(t) !== 1) continue;
    a.fromBufferAttribute(P, t); b.fromBufferAttribute(P, t + 1); c.fromBufferAttribute(P, t + 2);
    nn.subVectors(c, b).cross(v.subVectors(a, b)).normalize();
    for (let k = 0; k < 3; k++) N.setXYZ(t + k, nn.x, nn.y, nn.z);
  }
  g.computeBoundingSphere();
  return g;
}

export interface Ice {
  mesh: THREE.Mesh;
  /** 0..1: how frozen (fades the whole thing in / out) */
  setFrozen(k: number): void;
  /** carve a scratch from (ax, az) to (bx, bz) (world metres) */
  scratch(ax: number, az: number, bx: number, bz: number, depth?: number): void;
  /** melt every scratch (a thaw) */
  clearScratches(): void;
  update(time: number, L: Lighting, snow: number, dt: number): void;
  dispose(): void;
}

export function createIce(): Ice {
  const data = new Uint8Array(SN * SN);
  const tex = new THREE.DataTexture(data, SN, SN, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  let dirty = false, uploadIn = 0;
  const u = {
    uTime: { value: 0 }, uK: { value: 0 }, uSnow: { value: 0 }, uNight: { value: 0 }, uSun: { value: 2.2 },
    uSky: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
    uScr: { value: tex }, uBox: { value: new THREE.Vector3(SCRATCH_BOX.x0, SCRATCH_BOX.z0, SCRATCH_BOX.size) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...u },
    fog: true,
    transparent: true,
    depthWrite: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      attribute float aKind, aEdge;
      uniform float uSnow, uK;
      varying vec3 vWorld; varying vec3 vN; varying float vKind, vEdge;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        // the snowbanks grow with the lying snow (and sink away as the ice goes)
        if (aKind > 0.5 && aKind < 1.5) p.y = ${WORLD.water.toFixed(3)} - 0.2 + (p.y - ${WORLD.water.toFixed(3)} + 0.2) * (0.35 + 0.65 * uSnow) * uK;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz; vN = normal; vKind = aKind; vEdge = aEdge;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uK, uSnow, uNight, uSun; uniform vec3 uSky, uSunDir, uSunColor, uBox; uniform sampler2D uScr;
      varying vec3 vWorld; varying vec3 vN; varying float vKind, vEdge;
      #include <common>
      #include <fog_pars_fragment>
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
      float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.07 + 5.3) * 0.3 + vnoise(p * 4.3 - 2.1) * 0.15; }
      // distance to the nearest cell edge of a jittered grid (long branching cracks)
      float cracks(vec2 p) {
        vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y)); vec2 o = vec2(h21(i + g), h21(i + g + 3.7));
          float d = length(g + o - f);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        return d2 - d1;
      }
      // old skate scratches: arcs of random circles, a few per 3 m cell
      float arcs(vec2 p) {
        vec2 i = floor(p / 3.0); float m = 0.0;
        for (int k = 0; k < 3; k++) {
          vec2 c = (i + vec2(h21(i + float(k) * 1.7), h21(i + float(k) * 2.9 + 0.4))) * 3.0;
          float r = 1.2 + h21(i + float(k) * 5.1) * 2.6;
          vec2 q = p - c; float a = atan(q.y, q.x);
          float a0 = h21(i + float(k) * 9.3) * 6.2832, span = 0.6 + h21(i + float(k) * 4.4) * 1.6;
          float on = step(abs(mod(a - a0 + 3.1416, 6.2832) - 3.1416), span);
          float w = fwidth(length(q)) * 0.9 + 0.004;
          m = max(m, (1.0 - smoothstep(0.0, w, abs(length(q) - r))) * on * (0.4 + 0.6 * h21(i + float(k))));
        }
        return m;
      }
      void main() {
        vec2 p = vWorld.xz;
        float lit = clamp(uSun / 2.2, 0.25, 1.15);
        vec3 sunTint = mix(vec3(1.0), uSunColor, 0.3) * lit;
        vec3 iceTint = mix(vec3(1.0), uSunColor, 0.2) * (0.55 + 0.45 * lit);
        vec3 col; float alpha;
        if (vKind < 0.5) {
          // the sheet: glassy blue-green in the middle, milky white toward the shore, cloudy patches
          float cl = fbm(p * 0.35);
          col = mix(vec3(0.62, 0.8, 0.88), vec3(0.88, 0.94, 0.98), clamp((1.0 - vEdge) * 0.85 + cl * 0.45, 0.0, 1.0));
          // trapped bubbles in the clear ice
          vec2 bq = p * 3.0; vec2 bi = floor(bq); vec2 bf = fract(bq) - 0.5 - (vec2(h21(bi + 1.1), h21(bi + 2.3)) - 0.5) * 0.6;
          col = mix(col, vec3(0.93, 0.97, 1.0), (1.0 - smoothstep(0.04, 0.07, length(bf))) * step(h21(bi), 0.08) * vEdge * 0.7);
          // cracks
          float cr = cracks(p * 0.21 + vec2(vnoise(p * 0.6), vnoise(p * 0.6 + 4.0)) * 0.35);
          float cw = fwidth(cr) * 1.0 + 0.002;
          float cm = smoothstep(0.35, 0.6, vnoise(p * 0.15 + 9.0));
          col = mix(col, vec3(0.97, 0.99, 1.0), (1.0 - smoothstep(0.0, cw, cr - 0.008)) * 0.7 * cm);
          // old scratches and yours
          float sc = arcs(p) * 0.55;
          vec2 tuv = (p - uBox.xy) / uBox.z;
          if (tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) sc = max(sc, texture2D(uScr, tuv).r);
          col = mix(col, vec3(0.98, 0.99, 1.0), sc * 0.75);
          // a dusting of snow, thicker near the banks, in drifts downwind
          float sn = fbm(p * vec2(0.5, 0.9) + vec2(3.1, 0.0));
          float dust = smoothstep(0.78 - uSnow * 0.3, 0.9 - uSnow * 0.25, sn + (1.0 - vEdge) * 0.3);
          col = mix(col, vec3(0.96, 0.97, 1.0), dust * (0.35 + 0.6 * uSnow));
          // the sky in it (more at grazing angles), and a hard little sun glint
          vec3 v = normalize(cameraPosition - vWorld);
          float fr = pow(1.0 - max(v.y, 0.0), 3.0);
          col = mix(col, uSky * 1.05, fr * 0.35 * (1.0 - dust));
          vec3 hv = normalize(v + uSunDir);
          float spec = pow(max(hv.y, 0.0), 260.0);
          col += uSunColor * step(0.45, spec) * 0.45 * (1.0 - dust) * (1.0 - uNight);
          col = col * iceTint + uSky * 0.12;
          alpha = mix(0.82, 0.96, max(dust, 1.0 - vEdge * 0.6));
        } else if (vKind < 1.5) {
          // snowbanks: three toon bands off the sun
          float nd = dot(normalize(vN), normalize(uSunDir));
          float band = nd > 0.45 ? 1.0 : nd > 0.0 ? 0.86 : 0.72;
          col = mix(vec3(0.72, 0.8, 0.92), vec3(0.97, 0.98, 1.0), band) * sunTint;
          col += vec3(1.0) * step(0.985, h21(floor(p * 18.0) + floor(uTime * 2.0))) * 0.35 * (1.0 - uNight);
          alpha = 1.0;
        } else {
          // the dock: frost feathers creeping along the planks
          float f = fbm(p * vec2(2.2, 6.0));
          float k = smoothstep(0.45, 0.62, f + uSnow * 0.25);
          col = vec3(0.92, 0.96, 1.0) * sunTint;
          col += vec3(1.0) * step(0.992, h21(floor(p * 30.0))) * 0.4;
          alpha = k * 0.85;
        }
        col = mix(col, col * vec3(0.18, 0.25, 0.42), uNight);
        gl_FragColor = vec4(col, alpha * uK);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uScr.value = tex;
  const ux = mat.uniforms as unknown as typeof u;
  const mesh = new THREE.Mesh(buildIceGeometry(), mat);
  mesh.name = 'seasons:ice';
  mesh.renderOrder = 2;
  mesh.receiveShadow = false;
  mesh.visible = false;

  const stamp = (x: number, z: number, v: number) => {
    const i = Math.floor(((x - SCRATCH_BOX.x0) / SCRATCH_BOX.size) * SN), j = Math.floor(((z - SCRATCH_BOX.z0) / SCRATCH_BOX.size) * SN);
    if (i < 0 || j < 0 || i >= SN || j >= SN) return;
    const k = j * SN + i;
    if (data[k] < v) { data[k] = v; dirty = true; }
  };
  return {
    mesh,
    setFrozen(k) { ux.uK.value = k; mesh.visible = k > 0.005; },
    scratch(ax, az, bx, bz, depth = 1) {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / (SCRATCH_BOX.size / SN) * 1.5));
      const v = Math.round(150 + 105 * Math.min(1, depth));
      for (let i = 0; i <= n; i++) { const t = i / n; stamp(ax + (bx - ax) * t, az + (bz - az) * t, v); }
    },
    clearScratches() { data.fill(0); dirty = true; },
    update(time, L, snow, dt) {
      ux.uTime.value = time;
      ux.uSnow.value = snow;
      ux.uNight.value = L.night;
      ux.uSun.value = L.sunIntensity;
      ux.uSky.value.copy(L.skyColor);
      ux.uSunDir.value.copy(L.sunDir);
      ux.uSunColor.value.copy(L.sunColor);
      uploadIn -= dt;
      if (dirty && uploadIn <= 0) { tex.needsUpdate = true; dirty = false; uploadIn = 0.2; }
    },
    dispose() { mesh.geometry.dispose(); mat.dispose(); tex.dispose(); },
  };
}
