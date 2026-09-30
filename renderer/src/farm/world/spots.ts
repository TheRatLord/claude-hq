// @pure
/**
 * Where things happen inside a plot site, in site-local metres (x across the field, z toward the gate). Shared by
 * the plots package (which leaves these spots clear of crops and props) and the farmers package (which walks there).
 *
 *        back fence (z = −d/2)
 *   ┌──────────────────────────────┐
 *   │  rows / pens / trees           │   work spots: a grid of 8 stations across the field interior
 *   │   w0    w1    w2    w3         │
 *   │   w4    w5    w6    w7         │   bench: hay bale / stump for 'plan' (back-left corner)
 *   │ bench              helper post │   helper post: scarecrow slots along the right edge
 *   └────────────┐ gate ┌───────────┘   ask spot: just inside the gate, facing out (waves at passers-by)
 *                  path                 done spot: beside the gate, basket on the ground
 */
import type { Site, XZ } from './map.ts';
import { siteToWorld } from './map.ts';

export interface Spot extends XZ { /** facing (three rotation.y) */ yaw: number }

const local = (site: Site, lx: number, lz: number, faceYaw: number): Spot => {
  const p = siteToWorld(site, lx, lz);
  return { x: p.x, z: p.z, yaw: site.yaw + faceYaw };
};

/** 8 work stations; farmer `spot` i uses station i % 8 (more farmers than stations share, offset slightly). */
export function workSpot(site: Site, spot: number): Spot {
  const i = spot % 8, lap = Math.floor(spot / 8);
  const col = i % 4, row = Math.floor(i / 4);
  const lx = (col - 1.5) * (site.w / 5) + lap * 0.9;
  const lz = row === 0 ? -site.d * 0.18 : site.d * 0.12;
  return local(site, lx, lz, Math.PI); // facing the back of the field, into the work
}

/** Just inside the gate, facing out toward the path (and the player). */
export function askSpot(site: Site, spot: number): Spot {
  const off = ((spot % 4) - 1.5) * 1.3;
  return local(site, off, site.d / 2 - 1.4, 0);
}

export function doneSpot(site: Site, spot: number): Spot {
  const side = spot % 2 === 0 ? -1 : 1;
  return local(site, side * (2.6 + Math.floor(spot / 2) * 1.1), site.d / 2 - 1.8, 0);
}

/** The thinking bench (hay bale) in the back-left corner. */
export function benchSpot(site: Site, spot = 0): Spot {
  return local(site, -site.w / 2 + 1.8 + (spot % 3) * 1.2, -site.d / 2 + 1.8, 0.4);
}

/** Scarecrow posts for shell helpers along the right edge. */
export function helperSpot(site: Site, spot: number): Spot {
  return local(site, site.w / 2 - 1.3, -site.d / 2 + 2.2 + (spot % 5) * 2.4, -Math.PI / 2);
}

/** Where the plot's sign stands (outside the gate, to the left of the path). */
export function signSpot(site: Site): Spot {
  return local(site, -2.2, site.d / 2 + 1.1, 0);
}

/** Radius around each of the spots above that crops, animals and props must leave clear. */
export const SPOT_CLEAR = 0.9;
