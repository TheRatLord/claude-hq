/**
 * Status floor rings per the chroma budget (§6.7) + the blocked beacon ripple (§5.0: 2.5, the only strong bloom).
 * Flat quads in the sprite / hot batches; no per-ring material.
 * Owner: FX.
 */
import * as THREE from 'three';
import { ringStyle } from './rules.ts';
import { RING_R } from './draw.ts';
import { QV, type QuadBatch } from './quads.ts'; // [FX fix m2-r1] staged quads (no boxed float arguments)
import type { Tiles } from './tiles.ts';
import type { FxFrame, FxState } from './types.ts';

/** [FX fix m2-r1] parsed ring colours by hex (Color.set(string) parses with regexes: garbage per ring per frame) */
const COLORS = new Map<string, THREE.Color>();
const colorOf = (hex: string) => { let c = COLORS.get(hex); if (!c) COLORS.set(hex, (c = new THREE.Color(hex))); return c; };
const RIPPLE_PERIOD = 1.4, RIPPLE_MAX = 1.9;

export function createRings({ tiles, sprite, hot }: { tiles: Tiles; sprite: QuadBatch; hot: QuadBatch }) {
  let drawn = 0, beacons = 0;
  /** beacon centres this frame: blocked agents standing together (the queue) share one ripple */
  const bx = new Float32Array(64), bz = new Float32Array(64);
  const q = { acked: false, dist: 0, hovered: false, selected: false }; // [FX fix m2-r1] reused ringStyle query
  return {
    begin() { drawn = 0; beacons = 0; },
    /** `S` reads ring, x, y, z, dist, hovered, selected, acked, phase. */
    draw(S: FxState, F: Pick<FxFrame, 't'>) {
      q.acked = S.acked; q.dist = S.dist; q.hovered = S.hovered; q.selected = S.selected;
      const st = ringStyle(S.ring, q);
      if (!st) return;
      const t = F.t + S.phase;
      const y = S.floorY + 0.012;
      let a = st.alpha, r = RING_R;
      if (st.breathe) { const b = Math.sin(t * Math.PI * 2 * st.breathe); a *= 0.8 + 0.2 * b; r *= 1 + 0.03 * b; }
      if (st.pulse) { const p = 0.5 + 0.5 * Math.sin(t * 5.5); a *= 0.65 + 0.35 * p; r *= 1 + 0.05 * p; }
      const tmp = colorOf(st.color);
      const tl = tiles.shape(st.shape);
      // the ring tile's circle sits at RING_PX of a 128 px half-tile → quad half-size = r · 128 / RING_PX
      const h = r * (128 / 110);
      (QV[0] = S.x, QV[1] = y, QV[2] = S.z, QV[3] = h, QV[4] = 0, QV[5] = 0, QV[6] = 0, QV[7] = 0, QV[8] = -h, QV[9] = tl.u0, QV[10] = tl.v0, QV[11] = tl.u1, QV[12] = tl.v1, QV[13] = tmp.r, QV[14] = tmp.g, QV[15] = tmp.b, QV[16] = a, (st.hot ? hot : sprite).pushQ());
      drawn++;
      let near = false;
      for (let i = 0; i < beacons; i++) if ((bx[i] - S.x) ** 2 + (bz[i] - S.z) ** 2 < 2.2 * 2.2) { near = true; break; }
      if (st.pulse && !near && beacons < 64) {
        bx[beacons] = S.x; bz[beacons] = S.z;
        // beacon: two expanding ripples, so a blocked agent is found from anywhere in the room
        const rt = tiles.shape('ripple');
        beacons++;
        for (let k = 0; k < 2; k++) {
          const u = ((t / RIPPLE_PERIOD) + k * 0.5) % 1;
          const rr = RING_R + (RIPPLE_MAX - RING_R) * (1 - (1 - u) * (1 - u));
          const hh = rr * (128 / 110);
          (QV[0] = S.x, QV[1] = y + 0.002, QV[2] = S.z, QV[3] = hh, QV[4] = 0, QV[5] = 0, QV[6] = 0, QV[7] = 0, QV[8] = -hh, QV[9] = rt.u0, QV[10] = rt.v0, QV[11] = rt.u1, QV[12] = rt.v1, QV[13] = tmp.r, QV[14] = tmp.g, QV[15] = tmp.b, QV[16] = 0.85 * (1 - u) * (1 - u), hot.pushQ());
        }
      }
    },
    stats: () => ({ rings: drawn, beacons }),
  };
}

export type Rings = ReturnType<typeof createRings>;
