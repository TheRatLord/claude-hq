/**
 * The ordered system list. Order matters only where a system reads what another publishes in the same frame:
 * sky first (lighting, wind), then lights (the 'lights' service must exist before structures/plots
 * register emitters; it reads their state one frame late, which is invisible), post last. Each package owns its own file(s); nobody needs to edit this list.
 */
import type { SystemFactory } from './context.ts';
import { skySystem } from './sky/sky.ts';
import { lightsSystem } from './lights/lights.ts';
import { terrainSystem } from './terrain/terrain.ts';
import { waterSystem } from './terrain/water.ts';
import { floraSystem } from './flora/flora.ts';
import { structuresSystem } from './structures/structures.ts';
import { plotsSystem } from './plots/plots.ts';
import { farmersSystem } from './farmers/farmers.ts';
import { villagersSystem } from './villagers/villagers.ts';
import { gatherSystem } from './gather/gather.ts';
import { lifeSystem } from './life/life.ts';
import { forageSystem } from './forage/forage.ts';
import { trailSystem } from './trail/trail.ts';
import { yardSystem } from './yard/yard.ts';
import { weatherSystem } from './weather/weather.ts';
import { interiorSystem } from './interior/interior.ts';
import { seasonsSystem } from './seasons/seasons.ts';
import { audioSystem } from '../audio/audio.ts';
import { postSystem } from './post/post.ts';

export const SYSTEMS: readonly SystemFactory[] = [
  skySystem,
  lightsSystem,
  terrainSystem,
  waterSystem,
  floraSystem,
  structuresSystem,
  plotsSystem,
  farmersSystem,
  villagersSystem,
  gatherSystem,
  lifeSystem,
  forageSystem,
  trailSystem,
  yardSystem,
  seasonsSystem,
  weatherSystem,
  interiorSystem,
  audioSystem,
  postSystem,
];
