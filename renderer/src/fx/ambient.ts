/**
 * Per-actor ambient signals FX derives from the entity each frame (§6.7 rows; derivation in rules.ambientOf):
 *  - rain cloud: blocked > 5 min (a glum grey cloud over the head, drizzle to the floor). Nothing else rains.
 *  - crossed-out paper orbit: struggle.level ≥ 2 while working (1–3 balls circling the head).
 *  - Z's: sleeping (the brain's `sleepy` face: nap phase of the idle ladder, done nap, Shelly doze).
 *  - steam: working streak ≥ 30 min, curling up from the desk mug spot.
 * Owner: FX.
 */
import { SHAPES } from './draw.ts';
import { QV, type QuadBatch } from './quads.ts'; // [FX fix m2-r1] staged quads (no boxed float arguments)
import type { Tiles } from './tiles.ts';
import type { Particles } from './particles.ts';
import type { AmbientFlags, FxFrame, FxState, Vec3Like } from './types.ts';

export function createAmbient({ tiles, sprite, particles }: { tiles: Tiles; sprite: QuadBatch; particles: Particles }) {
  let clouds = 0, orbits = 0;
  // [FX fix m2-r1] reused burst position / options (particles.burst copies them): no literals per drop / Z / puff
  const at = { x: 0, y: 0, z: 0 }, opt = { floor: 0 };
  const pos = (x: number, y: number, z: number) => { at.x = x; at.y = y; at.z = z; return at; };
  return {
    begin() { clouds = 0; orbits = 0; },
    draw(S: FxState, amb: AmbientFlags, F: FxFrame, mug: Vec3Like | null) {
      const t = S.nowT;
      if (amb.rain && S.dist < 30) {
        const tl = tiles.shape('cloud');
        // [FX fix r2] over the (decluttered) card when one shows, else over the head
        const onCard = S.bubble && S.bubbleTopY > S.top;
        // [FX fix m2-r1] screen-capped: ≤ 1.5 × its card's height (a pill gets a small cloud), ≤ 110 px wide at 900 px; up
        // close the fixed 0.68 m cloud was wider than the card (serve: 4 clouds over 4 cards filled the top of the view)
        const wpp = (2 * Math.max(0.3, S.depth ?? S.dist) * (F.fovK ?? 0.577)) / (F.vh || 900), px = (F.vh || 900) / 900;
        const capPx = onCard && S.bubbleTopPx ? Math.min(110 * px, Math.max(40 * px, S.bubbleTopPx * 1.5)) : 110 * px;
        const w = Math.min(0.34, (capPx / 2) * wpp), h = w * (SHAPES.cloud.h / SHAPES.cloud.w);
        const base = onCard ? S.bubbleTopY + h * 0.35 : S.top + 0.35;
        const cy = base + h + Math.sin(t * 1.3 + S.phase) * h * 0.15;
        const cx = (onCard ? S.bubbleTopX ?? S.x : S.x) + Math.sin(t * 0.7 + S.phase) * w * 0.15, cz = onCard ? S.bubbleTopZ ?? S.z : S.z;
        (QV[0] = cx, QV[1] = cy, QV[2] = cz, QV[3] = F.R.x * w, QV[4] = F.R.y * w, QV[5] = F.R.z * w, QV[6] = F.U.x * h, QV[7] = F.U.y * h, QV[8] = F.U.z * h, QV[9] = tl.u0, QV[10] = tl.v0, QV[11] = tl.u1, QV[12] = tl.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.fade, sprite.pushQ());
        clouds++;
        S.rainAcc = (S.rainAcc ?? 0) + F.dt * 16;
        while (S.rainAcc >= 1) {
          S.rainAcc--;
          const a = Math.random() * Math.PI * 2, r = Math.random() * w * 0.7;
          opt.floor = S.floorY + 0.02;
          particles.burst('drop', pos(cx + Math.cos(a) * r, cy - h * 0.4, cz + Math.sin(a) * r * 0.6), opt);
        }
      }
      if (amb.orbit && S.dist < 25) {
        const tl = tiles.shape('paperBall');
        const hy = (S.headY ?? S.top) - 0.05; // [FX fix r3] the head, not the hat / raised hand (S.top)
        for (let i = 0; i < amb.orbit; i++) {
          const a = t * 1.9 + (i / amb.orbit) * Math.PI * 2 + S.phase;
          const x = S.x + Math.cos(a) * 0.5, z = S.z + Math.sin(a) * 0.5, y = hy + Math.sin(a * 2 + i) * 0.07 + 0.1;
          const s = 0.085;
          const c = Math.cos(a * 1.7), sn = Math.sin(a * 1.7);
          (QV[0] = x, QV[1] = y, QV[2] = z, QV[3] = (F.R.x * c + F.U.x * sn) * s, QV[4] = (F.R.y * c + F.U.y * sn) * s, QV[5] = (F.R.z * c + F.U.z * sn) * s, QV[6] = (-F.R.x * sn + F.U.x * c) * s, QV[7] = (-F.R.y * sn + F.U.y * c) * s, QV[8] = (-F.R.z * sn + F.U.z * c) * s, QV[9] = tl.u0, QV[10] = tl.v0, QV[11] = tl.u1, QV[12] = tl.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.fade, sprite.pushQ());
        }
        orbits++;
      }
      if (amb.zzz && S.dist < 20) {
        S.zAcc = (S.zAcc ?? Math.random()) + F.dt / 1.15;
        if (S.zAcc >= 1) { S.zAcc = 0; particles.burst('zzz', pos(S.x + 0.18, S.top + 0.02, S.z)); }
      }
      if (amb.steam && mug && S.dist < 15) {
        S.sAcc = (S.sAcc ?? 0) + F.dt / 0.3;
        if (S.sAcc >= 1) { S.sAcc = 0; particles.burst('steam', mug); }
      }
    },
    stats: () => ({ clouds, orbits }),
  };
}

export type FxAmbient = ReturnType<typeof createAmbient>;
