/**
 * Headless behaviour sim (DESIGN §6.5 acceptance, `npm run walktimes -- --sim mixed|trio`): the real demo backend
 * (DemoWorld + WorldModel on a FakeClock) feeds the real actors / brains / director / nav on the hq layout with stub
 * rigs, animators, charBatch and fx; the §9.1 metrics come from the same module `__hq.metrics()` reads.
 * Node only (imports the server's demo); nothing in the renderer bundle imports this file.
 * Owner: BRN.
 */
import { createActors } from '../actors.ts';
import type { Actor, ActorFactories, ActorMetrics, Actors } from '../actors.ts';
import { createDirector } from './director.ts';
import type { Director } from './director.ts';
import { fakeStore, stubRig } from './testkit.ts';
import type { Layout, Vec3 } from '../../world/layout/schema.ts';
import type { Nav } from '../../world/nav/index.ts';
import type { Animator } from '../anim/animator.ts';
import type { CharHandle } from '../render/charBatch.ts';

/** Per-10-minute acceptance (§6.5, §11 M1.5). */
export const SIM_ACCEPT = Object.freeze({
  mixed: { walkWhileWorkingPct: 20, workCallP90: 8, workCallPct: 6, slideRides: 4, stairClimbs: 8, mailArcPer3Min: 1, outingZoneVisits: 1 },
  trio: { slideRides: 1 },
});

/** the acceptance thresholds one scenario is judged by (each optional) */
export interface SimAccept {
  walkWhileWorkingPct?: number; workCallP90?: number; workCallPct?: number; slideRides?: number; stairClimbs?: number;
  mailArcPer3Min?: number; outingZoneVisits?: number;
}
export interface SimPlayer { pos: Vec3; level?: number }
export interface SimOptions {
  layout: Layout;
  nav: Nav;
  scenario?: string;
  minutes?: number;
  seed?: number;
  dt?: number;
  n?: number;
  /** a stand-in the avoidance sees (onFrame may move it; null = nobody in the room) */
  player?: SimPlayer | null;
  onFrame?: (o: { t: number; actors: Actors; director: Director; player: SimPlayer | null }) => void;
  /** the local hour (ctx.hour; null = daytime) */
  hour?: number | null;
}
export interface SimResult { metrics: ActorMetrics; misses: string[]; phases: Record<string, number> }

export async function runSim({ layout, nav, scenario = 'mixed', minutes = 10, seed = 1, dt = 1 / 15, n = 12, onFrame, player = null, hour = null }: SimOptions): Promise<SimResult> {
  const { FakeClock } = await import('../../../../server/clock.ts');
  const { createDemo } = await import('../../../../server/demo/world.ts');
  const { WorldModel } = await import('../../../../server/world/model.ts');
  const { BlockedEnricher } = await import('../../../../server/world/blocked.ts');

  const clock = new FakeClock();
  const { source, enrichers } = createDemo({ clock, n, seed, scenario });
  const model = new WorldModel({ source, enrichers: [...enrichers, new BlockedEnricher({ clock })], clock, demo: true });
  if (scenario === 'longIdle') source.seedSince(model.since);

  // a minimal renderer store (§3.4 semantics: entity replace, gone, event)
  const store = fakeStore();
  let live = false;
  model.on('msg', (m) => {
    if (!live) return;
    if (m.t === 'entity') store.entities.set(m.entity.id, m.entity);
    else if (m.t === 'gone') { store.entities.delete(m.id); store.emit('gone', m); }
    else if (m.t === 'event') store.emit('event', m);
  });
  source.start();
  const pump = async (ms: number, step = 250) => { for (let k = 0; k < ms; k += step) { clock.advance(step); for (let i = 0; i < 4; i++) await null; } };
  await pump(1500);
  live = true;
  for (const e of model.entities.values()) store.entities.set(e.id, e);
  store.emit('world', { t: 'world', entities: [...model.entities.values()], workspaces: [], focusedPaneId: null });

  const director = createDirector(layout, nav);
  const factories: ActorFactories = {
    createRig: stubRig,
    createAnimator: (): Animator => ({
      setLocomotion() {}, setAction() {}, react() {}, setFace() {}, lookAt() {}, setEnergy() {}, setGait() {}, setTraits() {}, update() {},
      traits: {}, debug: { action: null, face: null, reactions: [], speed: 0 },
    }),
  };
  const handle: CharHandle = { setVisible() {}, setLod() {}, setOutline() {}, remove() {} };
  const charBatch = { register: () => handle };
  const noop = () => {};
  const fx = { bubble: noop, ring: noop, plate: noop, glyph: noop, dust: noop, placard: noop, forget: noop, burst: noop };
  const actors = createActors({ store, layout, director, charBatch, fx, factories });

  const t0 = clock.now();
  const ctx = { dt, time: 0, now: t0, player, camera: null, hour }; // ([BRN fix m3-r2] hour: the night hearth)
  const frames = Math.round((minutes * 60) / dt);
  const phases: Record<string, number> = {};
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += dt * 1000;
    if (acc >= 250) { await pump(acc, acc); acc = 0; } // backend timers + promise continuations, 4 Hz
    ctx.time = (f + 1) * dt;
    ctx.now = t0 + ctx.time * 1000;
    ctx.dt = dt;
    actors.update(ctx);
    if (f % 15 === 0) for (const a of actors.list()) { const p = a.intent?.phase ?? a.mode; phases[p] = (phases[p] ?? 0) + 1; }
    onFrame?.({ t: ctx.time, actors, director, player });
  }
  const metrics = actors.metrics();
  model.close();
  await source.close();

  const misses: string[] = [];
  const k = minutes / 10;
  const table: Readonly<Record<string, SimAccept | undefined>> = SIM_ACCEPT;
  const A = table[scenario];
  if (A?.walkWhileWorkingPct !== undefined && metrics.walkWhileWorkingPct > A.walkWhileWorkingPct) misses.push(`walkWhileWorkingPct ${metrics.walkWhileWorkingPct.toFixed(1)} > ${A.walkWhileWorkingPct}`);
  if (A?.workCallP90 !== undefined && metrics.workCallS.p90 > A.workCallP90) misses.push(`workCallS.p90 ${metrics.workCallS.p90.toFixed(1)} s > ${A.workCallP90}`);
  if (A?.workCallPct !== undefined && metrics.workCallPct > A.workCallPct) misses.push(`workCallPct ${metrics.workCallPct.toFixed(1)} > ${A.workCallPct}`);
  if (A?.slideRides !== undefined && metrics.slideRides < A.slideRides * k) misses.push(`slideRides ${metrics.slideRides} < ${A.slideRides * k}`);
  if (A?.stairClimbs !== undefined && metrics.stairClimbs < A.stairClimbs * k) misses.push(`stairClimbs ${metrics.stairClimbs} < ${A.stairClimbs * k}`);
  if (A?.mailArcPer3Min !== undefined) {
    for (const z of ['MAIL', 'ARC']) {
      const v = metrics.zoneVisits[z] ?? 0;
      if (v < Math.floor(minutes / 3) * A.mailArcPer3Min) misses.push(`${z} visits ${v} < ${Math.floor(minutes / 3)} (1 per 3 min)`);
    }
  }
  if (A?.outingZoneVisits !== undefined) { // [BRN fix r2] the far ground floor is used (CAF, NAP, a W amenity bay)
    for (const z of ['CAF', 'NAP']) if ((metrics.zoneVisits[z] ?? 0) < A.outingZoneVisits * k) misses.push(`${z} visits ${metrics.zoneVisits[z] ?? 0} < ${A.outingZoneVisits * k}`);
    const w = ['W1', 'W2', 'W3'].reduce((a, z) => a + (metrics.zoneVisits[z] ?? 0), 0);
    if (w < A.outingZoneVisits * k) misses.push(`W-bay visits ${w} < ${A.outingZoneVisits * k}`);
  }
  return { metrics, misses, phases };
}
