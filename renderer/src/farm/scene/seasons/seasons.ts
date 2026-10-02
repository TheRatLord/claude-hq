/**
 * Seasonal pastimes (system `seasons`; docs/valley/seasons.md): something to do in every season.
 *
 *   rowboat   spring–autumn: tied at the pond dock; row, fish from it, the pet in the bow (boat.ts)
 *   skating   winter, pond frozen: the ice sheet + snowbanks + iced dock (ice.ts), glide and carve (skate.ts)
 *   snowmen   winter with lying snow: roll, stack three, decorate; they last the day (snow.ts)
 *
 * Pure rules in physics.ts + snowman.ts (seasons.test.ts). Movement goes through the controller's `ride` hook.
 * Service 'seasons' (`SeasonsService`: dev hooks `__valley.boat()`, `skate()`, `snowman()`); 'rowboat' (fishing
 * odds), 'petPerch' (the pet's seat in the bow).
 *
 * Budget: rowboat 3 draws (+1 wake while moving), ice 1 (winter only), snow 3 (winter only, with snowmen / a trail);
 * nothing allocates per frame.
 */
import type { SystemFactory } from '../context.ts';
import { pondIce } from './physics.ts';
import { createIce } from './ice.ts';
import { createShared } from './shared.ts';
import { createBoat } from './boat.ts';
import { createSkate } from './skate.ts';
import { createSnow } from './snow.ts';
import type { Pastime } from './shared.ts';

export interface SeasonsService {
  /** the pond's ice 0..1 (eased) */
  ice(): number;
  boat(cmd?: string, a?: number): unknown;
  skate(cmd?: string, a?: number): unknown;
  snowman(cmd?: string, a?: number): unknown;
}

export const seasonsSystem: SystemFactory = (ctx) => {
  const sky = () => ctx.valley.sky;
  let iceK = pondIce(sky().season, sky().trace, sky().weather.kind);
  const sh = createShared(ctx, () => iceK);
  const ice = createIce();
  ctx.scene.add(ice.mesh);
  ice.setFrozen(iceK);
  const parts: Pastime[] = [];
  const boat = createBoat(sh);
  const skate = createSkate(sh, ice);
  const snow = createSnow(sh);
  parts.push(boat, skate, snow);
  const svc: SeasonsService = {
    ice: () => iceK,
    boat: (c, a) => boat.dev(c, a),
    skate: (c, a) => skate.dev(c, a),
    snowman: (c, a) => snow.dev(c, a),
  };
  ctx.services.set('seasons', svc);

  return {
    name: 'seasons',
    update(f) {
      const target = pondIce(sky().season, sky().trace, sky().weather.kind);
      const was = iceK;
      // freezing and thawing take a little while (a season change from the dev tools snaps in ~2 s)
      iceK += Math.sign(target - iceK) * Math.min(Math.abs(target - iceK), f.dt * 0.6);
      if (was > 0 && iceK === 0) ice.clearScratches();
      ice.setFrozen(iceK);
      if (iceK > 0) ice.update(f.time, ctx.lighting, sky().trace.snow, f.dt);
      for (const p of parts) p.update(f);
    },
    stats: () => Object.assign({ ice: +iceK.toFixed(2) }, ...parts.map((p) => p.stats())),
    dispose() {
      for (const p of parts) p.dispose();
      ctx.scene.remove(ice.mesh);
      ice.dispose();
      if (ctx.services.get('seasons') === svc) ctx.services.delete('seasons');
    },
  };
};
