/**
 * Foliage sway + distance shrink for (instanced) toon materials. One set of shared uniforms drives every patched
 * material; `syncWind` copies the atmosphere's WindService uniforms into it each frame (or runs its own clock when
 * the service is missing), so the land never depends on another package's shader naming.
 */
import * as THREE from 'three';
import type { SceneCtx, WindService } from '../context.ts';
import { chainShader } from '../surface/index.ts';

export const WIND = {
  uWTime: { value: 0 },
  uWDir: { value: new THREE.Vector2(0.9, 0.35) },
  uWStrength: { value: 1 },
};

let ownTime = 0;
/** Call once per frame (flora does). */
export function syncWind(ctx: SceneCtx | null, dt: number): void {
  const w = ctx?.services.get('wind') as WindService | undefined;
  const u = w?.uniforms;
  const t = u?.uWindTime?.value, d = u?.uWindDir?.value as THREE.Vector2 | undefined, s = u?.uWindStrength?.value;
  if (typeof t === 'number') WIND.uWTime.value = t; else { ownTime += dt; WIND.uWTime.value = ownTime; }
  if (d && typeof d.x === 'number') { const l = Math.hypot(d.x, d.y) || 1; WIND.uWDir.value.set(d.x / l, d.y / l); }
  else if (ctx) { const lw = ctx.lighting.wind, l = Math.hypot(lw.x, lw.z) || 1; WIND.uWDir.value.set(lw.x / l, lw.z / l); }
  const str = typeof s === 'number' ? s : ctx ? Math.min(3, Math.hypot(ctx.lighting.wind.x, ctx.lighting.wind.z) / 2.5 + 0.4) : 1;
  WIND.uWStrength.value += (str - WIND.uWStrength.value) * Math.min(1, dt * 2);
}

export interface SwayOpts {
  /** metres of bend at 1 m height in a moderate wind */
  amount?: number;
  /** grass-like (bend grows with height²) vs tree-like (canopy moves as a block above `pivot`) */
  mode?: 'grass' | 'tree';
  /** height below which nothing moves (tree trunks) */
  pivot?: number;
  /** shrink instances to nothing between 0.7·fade and fade metres from the camera (0 = off) */
  fade?: number;
  /** instance colour paints only white vertices (flower heads), leaving stems green */
  maskTint?: boolean;
}

/** Patch a material (in place, chained after any existing hook) so its vertices sway. Returns the material. */
export function sway<M extends THREE.Material>(m: M, o: SwayOpts = {}): M {
  const amount = (o.amount ?? 0.12).toFixed(4), pivot = (o.pivot ?? 0).toFixed(3), fade = (o.fade ?? 0).toFixed(1);
  const tree = o.mode === 'tree';
  return chainShader(m, (sh) => {
    Object.assign(sh.uniforms, WIND);
    if (o.maskTint) sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
#if defined( USE_INSTANCING_COLOR ) && defined( USE_COLOR )
  vColor.rgb = color * mix(vec3(1.0), instanceColor.rgb, step(2.9, color.r + color.g + color.b));
#endif`);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uWTime; uniform vec2 uWDir; uniform float uWStrength;`)
      .replace('#include <project_vertex>', `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec3 wBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vec3 wBase = vec3(0.0);
#endif
{
  float hh = max(mvPosition.y - wBase.y - ${pivot}, 0.0);
  float ph = dot(wBase.xz, vec2(0.21, 0.17));
  float g = sin(uWTime * 1.7 + ph) * 0.55 + sin(uWTime * 3.1 + ph * 1.9) * 0.25 + sin(uWTime * 0.6 + ph * 0.4) * 0.6;
  float k = ${tree ? `min(hh, 3.0) * 0.35` : `hh * hh`} * ${amount};
  mvPosition.xz += uWDir * k * uWStrength * (0.55 + 0.45 * g);
  mvPosition.xz += vec2(-uWDir.y, uWDir.x) * k * 0.25 * sin(uWTime * 2.3 + ph * 2.7);
  ${o.fade ? `float fd = distance(wBase.xz, cameraPosition.xz);
  float fk = 1.0 - smoothstep(${fade} * 0.7, ${fade}, fd);
  mvPosition.xyz = wBase + (mvPosition.xyz - wBase) * fk;` : ''}
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  }, `sway|${amount}|${pivot}|${fade}|${tree}|${o.maskTint ? 1 : 0}`);
}
