/**
 * The meadow mosaic: mid-scale (5–25 m) patches that break up the open valley floor, shared by the terrain shader
 * (which paints them) and the flora scatter (which plants clover, wildflowers and tall grass in the same places).
 * One value-noise definition in GLSL and TypeScript (the surface library's `sh1` / `svn`), so painted drifts and
 * planted ones line up:
 *
 *   clover  darker, cooler lush drifts (clover beds, white specks near)
 *   sun     sunny, bleached-warm patches
 *   bloom   wildflower drifts: a colour wash from afar, petal specks up close; colour slot per drift (0..2)
 *
 * Seasons: the shader takes the bloom colours per season (`bloomColors`); winter has none.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';

const fract = (v: number) => v - Math.floor(v);
/** `sh1` from surface/glsl.ts (float hash), in float32 like the GPU. */
function sh1(x: number, y: number): number {
  const f = Math.fround;
  let a = fract(f(x * 0.1031)), b = fract(f(y * 0.1031)), c = fract(f(x * 0.1031));
  const d = f(a * f(b + 33.33) + b * f(c + 33.33) + c * f(a + 33.33));
  a = f(a + d); b = f(b + d); c = f(c + d);
  return fract(f(f(a + b) * c));
}
/** `svn` from surface/glsl.ts: smooth value noise, 0..1. */
export function svn(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = sh1(ix, iy), b = sh1(ix + 1, iy), c = sh1(ix, iy + 1), d = sh1(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

const sat = (v: number) => Math.min(1, Math.max(0, v));

export interface MeadowAt { clover: number; sun: number; bloom: number; slot: number }

/** The mosaic at a point (soft 0..1 weights; the shader draws the same edges crisp). */
export function meadowAt(x: number, z: number, out: MeadowAt = { clover: 0, sun: 0, bloom: 0, slot: 0 }): MeadowAt {
  const m1 = svn(x * 0.045 + 13, z * 0.045 + 13) * 0.75 + svn(x * 0.16 - 4, z * 0.16 - 4) * 0.25;
  const m2 = svn(x * 0.06 - 27, z * 0.06 - 27) * 0.7 + svn(x * 0.21 + 8, z * 0.21 + 8) * 0.3;
  out.clover = sat((m1 - 0.64) / 0.05);
  out.sun = sat((0.32 - m1) / 0.05);
  out.bloom = sat((m2 - 0.64) / 0.04);
  out.slot = Math.max(0, Math.min(2, Math.floor(svn(x * 0.021 + 5, z * 0.021 - 9) * 3.6 - 0.3)));
  return out;
}

/**
 * GLSL twin of `meadowAt` (statements; needs the surface library): reads `vec2 mP` (world xz) and `float mEw` (edge
 * AA width), declares `vec4 mdw` = (clover, sun, bloom, slot).
 */
export const MEADOW_GLSL = /* glsl */ `
  float mm1 = svn(mP * 0.045 + 13.0) * 0.75 + svn(mP * 0.16 - 4.0) * 0.25;
  float mm2 = svn(mP * 0.06 - 27.0) * 0.7 + svn(mP * 0.21 + 8.0) * 0.3;
  float mSlot = clamp(floor(svn(mP * 0.021 + vec2(5.0, -9.0)) * 3.6 - 0.3), 0.0, 2.0);
  vec4 mdw = vec4(sst(0.665, mm1, mEw), 1.0 - sst(0.295, mm1, mEw), sst(0.66, mm2, mEw), mSlot);
`;

/** Wildflower drift colours per season (three slots) and how strongly drifts bloom. */
export function bloomColors(season: Season, out: [THREE.Color, THREE.Color, THREE.Color]): number {
  const pal: Record<Season, [number, number, number]> = {
    spring: [0xf6d23a, 0xf4f0f4, 0xd890d8],
    summer: [0xf2c22c, 0xf0eee6, 0xa77ee0],
    autumn: [0xe8a030, 0xb07ad0, 0xe0c060],
    winter: [0xffffff, 0xffffff, 0xffffff],
  };
  pal[season].forEach((h, i) => out[i].set(h));
  return season === 'winter' ? 0 : season === 'autumn' ? 0.55 : 1;
}
