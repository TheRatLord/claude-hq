/**
 * The ordered system list. Order matters only where a system reads what another publishes in the same frame:
 * sky first (lighting, wind), post last. Each package owns its own file(s); nobody needs to edit this list.
 */
import type { SystemFactory } from './context.ts';
import { skySystem } from './sky/sky.ts';
import { terrainSystem } from './terrain/terrain.ts';
import { waterSystem } from './terrain/water.ts';
import { floraSystem } from './flora/flora.ts';
import { structuresSystem } from './structures/structures.ts';
import { plotsSystem } from './plots/plots.ts';
import { farmersSystem } from './farmers/farmers.ts';
import { lifeSystem } from './life/life.ts';
import { weatherSystem } from './weather/weather.ts';
import { audioSystem } from '../audio/audio.ts';
import { postSystem } from './post/post.ts';

export const SYSTEMS: readonly SystemFactory[] = [
  skySystem,
  terrainSystem,
  waterSystem,
  floraSystem,
  structuresSystem,
  plotsSystem,
  farmersSystem,
  lifeSystem,
  weatherSystem,
  audioSystem,
  postSystem,
];
