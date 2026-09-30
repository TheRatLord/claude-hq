/**
 * Rain splash ripples near the player: expanding rings on the ground and water (one instanced draw). Each ripple
 * lives ~0.7 s, then respawns at a new random spot (biased ahead of the player) on the real surface height.
 */
import * as THREE from 'three';
import { WORLD, heightAt } from '../../world/map.ts';
import type { SceneCtx } from '../context.ts';

const vert = /* glsl */`
attribute vec2 aCorner;
attribute vec4 aRip; // x, y, z, start time
uniform float uTime, uLife, uSize;
varying vec2 vUv;
varying float vAge;
void main() {
  vAge = (uTime - aRip.w) / uLife;
  vUv = aCorner;
  float s = uSize * (0.35 + 0.65 * sqrt(clamp(vAge, 0.0, 1.0)));
  vec3 p = aRip.xyz + vec3(aCorner.x * s, 0.0, aCorner.y * s);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const frag = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vAge;
void main() {
  if (vAge < 0.0 || vAge > 1.0) discard;
  float r = length(vUv);
  float ring = smoothstep(0.8, 0.9, r) * smoothstep(1.0, 0.93, r);
  float inner = smoothstep(0.45, 0.52, r) * smoothstep(0.6, 0.53, r) * (1.0 - vAge);
  float a = (ring + inner * 0.6) * (1.0 - vAge) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export interface Ripples {
  mesh: THREE.Mesh;
  update(time: number, amount: number, color: THREE.Color): void;
}

export function createRipples(ctx: SceneCtx, max = 140): Ripples {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  const data = new Float32Array(max * 4);
  for (let i = 0; i < max; i++) data[i * 4 + 3] = -100;
  const attr = new THREE.InstancedBufferAttribute(data, 4);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aRip', attr);
  geo.instanceCount = max;
  const LIFE = 0.75;
  const u = { uTime: { value: 0 }, uLife: { value: LIFE }, uSize: { value: 0.17 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.5 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'weather-ripples';
  mesh.renderOrder = 5;
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const surface = (x: number, z: number): number | null => {
    const walk = ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
    const w = walk?.(x, z);
    if (w !== undefined && w !== null) return w;
    if (ctx.colliders.blocked(x, z, 0.05)) return null; // inside a building footprint
    const h = heightAt(x, z);
    return Math.max(h, WORLD.water);
  };
  return {
    mesh,
    update(time, amount, color) {
      mesh.visible = amount > 0.02;
      if (!mesh.visible) return;
      u.uTime.value = time;
      u.uColor.value.copy(color);
      u.uOpacity.value = 0.32 * Math.min(1, amount * 1.4);
      const p = ctx.player.pos, yaw = ctx.player.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let dirty = false;
      const active = Math.round(max * Math.min(1, amount));
      for (let i = 0; i < max; i++) {
        const o = i * 4;
        if (time - data[o + 3] < LIFE) continue;
        if (i >= active) { data[o + 3] = -100; continue; }
        // respawn somewhere within ~11 m, mostly in view
        const ang = (rnd() - 0.5) * 2.4, dist = 1.2 + Math.sqrt(rnd()) * 10;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const x = p.x + (fx * ca - fz * sa) * dist, z = p.z + (fx * sa + fz * ca) * dist;
        const y = surface(x, z);
        if (y === null) { data[o + 3] = time + rnd() * 0.3; data[o + 1] = -1000; continue; }
        data[o] = x; data[o + 1] = y + 0.02; data[o + 2] = z; data[o + 3] = time + rnd() * 0.25;
        dirty = true;
      }
      if (dirty) attr.needsUpdate = true;
    },
  };
}
