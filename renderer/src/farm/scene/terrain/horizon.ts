/**
 * The far horizon: two layered silhouette ranges in a ring well beyond the terrain tiles (650 m and 750 m), one mesh,
 * one draw call. Unlit flat bands tinted from the live fog colour (so dawn, dusk, night and weather carry them for
 * free): the nearer range a darker blue-green forest ridge, the farther a paler jagged range with faint snow light,
 * both fading into the haze at their feet. They only show from up high (the lookout, photo-mode flights) and in the
 * odd gap between the rim peaks; from the valley floor the rim fills the sky as before.
 */
import * as THREE from 'three';
import { fbm } from '../../world/noise.ts';

const VERT = /* glsl */ `
attribute float aLayer;
attribute float aTop;
varying float vLayer;
varying float vTop;
varying float vY;
void main() {
  vLayer = aLayer; vTop = aTop; vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 fogColor;
varying float vLayer;
varying float vTop;
varying float vY;
void main() {
  // near ridge: a deeper, cooler, slightly green haze; far range: paler, with snow light near its crests
  vec3 nearC = fogColor * vec3(0.74, 0.80, 0.86);
  vec3 farC = fogColor * vec3(0.86, 0.90, 0.95);
  vec3 col = mix(nearC, farC, vLayer);
  col = mix(col, fogColor * 1.06 + vec3(0.02), vLayer * smoothstep(0.72, 0.95, vTop) * 0.7);
  // feet dissolve into the haze
  col = mix(fogColor, col, smoothstep(10.0, 110.0, vY));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Build the ring mesh. */
export function buildHorizon(): THREE.Mesh {
  const pos: number[] = [], layer: number[] = [], top: number[] = [];
  const layers = [
    { r: 650, n: 240, base: -40, lo: 55, hi: 150, f: 2.6, seed: 3 },
    { r: 760, n: 280, base: -40, lo: 80, hi: 230, f: 3.4, seed: 11 },
  ];
  layers.forEach((L, li) => {
    const peak = (i: number) => {
      const a = (i / L.n) * Math.PI * 2;
      const cx = Math.cos(a) * L.f, cz = Math.sin(a) * L.f;
      // broad massifs (low octave) carrying ridged crests: a few tall summits, saddles between, no comb of teeth
      const mass = 0.5 + 0.5 * fbm(cx * 0.45 - L.seed, cz * 0.45 + 2, 2);
      const ridge = 1 - Math.abs(fbm(cx + L.seed, cz - L.seed, 3));
      const t = Math.min(1, Math.max(0, mass * 0.75 + (ridge * ridge - 0.45) * 0.55));
      return { a, h: L.lo + (L.hi - L.lo) * t, t };
    };
    for (let i = 0; i < L.n; i++) {
      const p0 = peak(i), p1 = peak((i + 1) % L.n);
      const x0 = Math.cos(p0.a) * L.r, z0 = Math.sin(p0.a) * L.r, x1 = Math.cos(p1.a) * L.r, z1 = Math.sin(p1.a) * L.r;
      // facing the centre: (bottom0, top0, top1), (bottom0, top1, bottom1) wound toward the origin
      const quad = [[x0, L.base, z0, 0], [x1, p1.h, z1, p1.t], [x0, p0.h, z0, p0.t], [x0, L.base, z0, 0], [x1, L.base, z1, 0], [x1, p1.h, z1, p1.t]];
      for (const [x, y, z, t] of quad) { pos.push(x, y, z); layer.push(li); top.push(t); }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
  });
  const m = new THREE.Mesh(g, mat);
  m.name = 'terrain:horizon'; // 'terrain:' = not a placed item (placement audit)
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  return m;
}
