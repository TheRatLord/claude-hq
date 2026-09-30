/**
 * Ambient life: birds, carrier pigeons (network), crows over struggling fields, butterflies, dragonflies, fireflies,
 * fish, frogs, rabbits, squirrels, and the village pets Biscuit and Mochi. Everything is scheduled by the sky
 * (`schedule.ts`) and drawn instanced: ~20 draw calls in total.
 */
import type { SystemFactory } from '../context.ts';
import { activity } from './schedule.ts';
import type { LifeClock } from './schedule.ts';
import { Fx } from './util.ts';
import { createBirds } from './birds.ts';
import { createCritters } from './critters.ts';
import { createPets } from './pets.ts';

export const lifeSystem: SystemFactory = (ctx) => {
  const fx = new Fx(ctx);
  const parts = [
    { name: 'birds', sys: createBirds(ctx, fx) },
    { name: 'critters', sys: createCritters(ctx, fx) },
    { name: 'pets', sys: createPets(ctx, fx) },
  ];
  const clock: LifeClock = { hour: 12, daylight: 1, night: 0, weather: 'clear', intensity: 0, season: 'summer' };
  const failed = new Set<string>();
  let act = activity(clock);
  let actIn = 0;
  return {
    name: 'life',
    update(f) {
      actIn -= f.dt;
      if (actIn <= 0) {
        actIn = 0.5;
        const sky = ctx.valley.sky;
        clock.hour = sky.hour; clock.daylight = sky.daylight; clock.season = sky.season;
        clock.night = Math.max(ctx.lighting.night, 1 - sky.daylight);
        clock.weather = sky.weather.kind; clock.intensity = sky.weather.intensity;
        act = activity(clock);
      }
      fx.begin();
      for (const p of parts) {
        try { p.sys.update(f, act); } catch (e) {
          if (!failed.has(p.name)) { failed.add(p.name); console.error(`[life] ${p.name} threw`, e); }
        }
      }
      fx.end(f.dt);
    },
    stats() {
      const out: Record<string, number | string> = {};
      for (const p of parts) Object.assign(out, p.sys.stats());
      return out;
    },
    dispose() {
      for (const p of parts) p.sys.dispose();
      fx.dispose();
    },
  };
};
