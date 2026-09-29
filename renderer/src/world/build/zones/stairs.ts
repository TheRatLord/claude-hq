/**
 * Stairs + slide surroundings (M2 breadth; the stairs and the slide themselves are architecture.ts): a piped crash
 * mat at the slide exit ("slide home" to E2), a butter pennant gate over the slide mouth on the mezzanine, a cosy
 * under-stair nook in the open-riser void north of the ENG glazing (cubbies, a crate of odds and ends, a cat cushion,
 * a fern — only where the ramp is ≥ 2.1 m up, so walkers on the treads never meet them and the ENG glass stays in
 * view from the Pit), and a potted fern on the stair landing. Owner: ENV.
 */
import { W } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { T } from '../kit/tokens.ts';

const PI = Math.PI;
const MY = 2.9;

export function dressStairs(layout: HqLayout, k: DressKit) {
  const slide = layout.slide, stairs = layout.stairs;
  if (slide?.exit) {
    // crash mat just past the exit, long side along the exit heading (flat: never a nav obstacle)
    const e = slide.exit, yaw = (slide.exitYaw ?? 0) + PI; // exitYaw is camera-style; prop yaw = heading
    const hx = Math.sin(yaw), hz = Math.cos(yaw);
    k.put('crashMat', { w: 0.95, d: 1.3, h: 0.05 }, { x: e.x + hx * 0.3, y: 0, z: e.z + hz * 0.3, yaw }, 'slideMat', 0.1);
  }
  if (slide?.mouth) k.put('slideGate', { w: 1.1, h: 0.95 }, { x: slide.mouth.x, y: MY, z: slide.mouth.z - 0.08, yaw: 0 }, 'slideGate', 0);
  if (stairs) {
    // under-stair nook (plan x26.3–28, z9.5–11.2: north of the ENG glass at z11.3; the ramp is 2.2–2.9 m up here)
    k.put('cubbies', { w: 1.5, h: 0.9, d: 0.36, cols: 3, rows: 2 }, W(27.72, 10.3, 0, -PI / 2), 'stairCubbies', 0.2);
    k.put('crate', { w: 0.5, h: 0.34, d: 0.4 }, W(26.95, 9.85, 0, 0.25), 'stairCrate', 0.2);
    k.put('box', { w: 0.36, h: 0.26, d: 0.3 }, W(26.97, 9.84, 0.34, -0.2), 'stairBox', 0);
    k.put('cushion', { kind: 'floor', w: 0.5, colors: { body: T.lavender } }, W(27.1, 10.6, 0, 0.5), 'stairCatBed', 0);
    k.put('plant', { kind: 'fern', h: 0.8 }, W(26.72, 11.02), 'stairFern', 0.15);
  }
  // stair landing (mezzanine level): a fern in the NE corner, off the landing → mezzanine walk
  k.put('plant', { kind: 'fern', h: 0.75 }, W(27.68, 7.3, MY), 'landingFern', 0.15);
}
