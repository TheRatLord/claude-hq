/**
 * Long-idle dust ladder (§6.4.1, §6.7 "Dust, cobweb, still here? sign": idle ≥ 1 h / 3 h / 6 h):
 *  1 → dust motes drifting down around the agent; 2 → + a cobweb in the corner between head and chair back;
 *  3 → + a hand-lettered "still here?" card on a stick beside it. `fx.dust(id, level)` sets it (brain intent.dust).
 * Owner: FX.
 */
import { SHAPES } from './draw.ts';
import { QV, type QuadBatch } from './quads.ts'; // [FX fix m2-r1] staged quads (no boxed float arguments)
import type { Tiles } from './tiles.ts';
import type { Particles } from './particles.ts';
import type { FxFrame, FxState } from './types.ts';

export function createDust({ tiles, sprite, particles }: { tiles: Tiles; sprite: QuadBatch; particles: Particles }) {
  let shown = 0;
  const at = { x: 0, y: 0, z: 0 }; // [FX fix m2-r1] reused burst position
  return {
    begin() { shown = 0; },
    draw(S: FxState, F: FxFrame) {
      const lvl = S.dust | 0;
      if (!lvl || S.dist > 20) return;
      shown++;
      S.dAcc = (S.dAcc ?? 0) + F.dt / (lvl === 1 ? 0.7 : 0.4);
      if (S.dAcc >= 1) { S.dAcc = 0; at.x = S.x; at.y = (S.headY ?? S.top) + 0.1; at.z = S.z; particles.burst('mote', at); }
      if (lvl >= 2) {
        // cobweb over the upper corner of the body (a camera-facing sprite offset to the side)
        const tl = tiles.shape('cobweb');
        const s = 0.2;
        const ox = 0.3;
        (QV[0] = S.x + F.R.x * ox, QV[1] = (S.headY ?? S.top) + 0.06 + F.R.y * ox, QV[2] = S.z + F.R.z * ox, QV[3] = F.R.x * s, QV[4] = F.R.y * s, QV[5] = F.R.z * s, QV[6] = F.U.x * s, QV[7] = F.U.y * s, QV[8] = F.U.z * s, QV[9] = tl.u0, QV[10] = tl.v0, QV[11] = tl.u1, QV[12] = tl.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = 0.75 * S.fade, sprite.pushQ());
      }
      if (lvl >= 3) {
        // "still here?" card on a stick, standing on the floor beside the agent, turned to the camera (yaw only)
        const tl = tiles.shape('stillHere');
        const w = 0.32, h = w * (SHAPES.stillHere.h / SHAPES.stillHere.w);
        const rl = Math.hypot(F.R.x, F.R.z) || 1, rx = F.R.x / rl, rz = F.R.z / rl;
        const side = 0.62;
        (QV[0] = S.x + rx * side, QV[1] = S.floorY + h, QV[2] = S.z + rz * side, QV[3] = rx * w, QV[4] = 0, QV[5] = rz * w, QV[6] = 0, QV[7] = h, QV[8] = 0, QV[9] = tl.u0, QV[10] = tl.v0, QV[11] = tl.u1, QV[12] = tl.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.fade, sprite.pushQ());
      }
    },
    stats: () => ({ dusty: shown }),
  };
}

export type Dust = ReturnType<typeof createDust>;
