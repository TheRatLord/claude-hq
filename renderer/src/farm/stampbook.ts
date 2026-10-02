/**
 * The stamp book's wiring (model/stamps.ts is the pure book; hud/stamps.ts draws it in the Almanac panel). main.ts
 * creates the book here and this file feeds it: about once a second (and shortly after any service's change hook) it
 * builds a `StampWorld` snapshot by reading the live services — the valley state and Almanac, the Collections book,
 * friendship, the wallet / yard, the trail's cairn, the barn's chores, the gatherings, the festival on the square, the atmosphere's
 * rainbow, a meteor-shower night, where the player stands — and asks the book to check it. Valley events (commits,
 * answers) and photo mode's saves are counted as they happen.
 *
 * Persisted per browser profile in `claude-valley.stamps.v1`. A demo valley never earns work stamps (fake agents).
 */
import { createStamps, type StampWorld, type StampsService } from './model/stamps.ts';
import type { Valley } from './model/valley.ts';
import type { CollectionService } from './model/collection.ts';
import type { WalletService } from './model/wallet.ts';
import type { FriendsService } from './model/friends.ts';
import type { Engine } from './scene/engine.ts';
import type { Controller } from './player/controller.ts';
import type { IndoorSpace } from './scene/context.ts';
import type { GatherService } from './scene/gather/gather.ts';
import type { TrailService } from './scene/trail/trail.ts';
import type { BarnService } from './model/barn.ts';
import type { AtmosphereService } from './scene/sky/sky.ts';
import { showerOn } from './scene/sky/meteors.ts';
import { NOOKS, TRAIL, structure } from './world/map.ts';
import { localJson } from './storage.ts';

export const STAMPS_KEY = 'claude-valley.stamps.v1';

/** a nook counts as visited inside its footprint plus this margin (m) */
const NOOK_MARGIN = 3;
/** the festival centrepiece counts within this (m) */
const FESTIVAL_R = 22;
/** close enough to the bandstand to call it attending (m) */
const CONCERT_R = 30;

export interface StampBookDeps {
  engine: Engine;
  controller: Controller;
  valley: Valley;
  collection: CollectionService;
  wallet: WalletService;
  friends: FriendsService;
  /** the world has arrived (the demo flag and the fields are real) */
  ready: () => boolean;
}

export function installStampBook(d: StampBookDeps): StampsService {
  const { engine, controller, valley, collection, wallet, friends } = d;
  const svc = engine.ctx.services;
  const book = createStamps(localJson(STAMPS_KEY), {
    pay: (c, why) => wallet.reward(c, why),
    gift: (id) => { wallet.gift(id); },
  });

  const nooks = NOOKS.map((id) => { const s = structure(id); return { id, x: s.x, z: s.z, r: Math.max(s.size[0], s.size[1]) / 2 + NOOK_MARGIN }; });
  const summit = TRAIL.anchors.summit;

  const world = (): StampWorld => {
    const s = valley.state, p = engine.ctx.player.pos;
    const outdoors = !(svc.get('indoors') as IndoorSpace | undefined)?.active;
    const g = svc.get('gatherings') as GatherService | undefined;
    const gather = g?.active() ?? null;
    const stage = gather?.kind === 'concert' ? g?.stage() ?? null : null;
    const fest = svc.get('festivals') as { active(): string | null; where(): Record<string, [number, number, number]> } | undefined;
    const fc = fest?.active() ? fest.where().center : undefined;
    const rainbow = (svc.get('atmosphere') as AtmosphereService | undefined)?.state().rainbow ?? 0;
    let working = 0;
    for (const f of s.farmers.values()) if (f.status === 'working') working++;
    const near = (x: number, z: number, r: number) => outdoors && Math.hypot(p.x - x, p.z - z) < r;
    return {
      now: Date.now(), demo: s.demo, hour: s.sky.hour, season: s.sky.season, weather: s.sky.weather.kind, snow: s.sky.trace.snow,
      festival: s.sky.festival.active?.id ?? null, outdoors,
      streak: s.almanac.streak, testsToday: s.almanac.today.counts.tests ?? 0, working,
      plots: [...s.plots.values()].map((q) => ({ id: q.id, alive: q.stage !== 'harvest' && q.stage !== 'fallow' })),
      collection: collection.data(), friends: friends.data(), wallet: wallet.data(),
      stones: (svc.get('trail') as TrailService | undefined)?.stones() ?? 0,
      chores: (svc.get('barn') as BarnService | undefined)?.data().total.days ?? 0,
      at: {
        summit: near(summit.x, summit.z, Math.max(summit.w, summit.d) + 2) && p.y > summit.y - 3,
        nook: nooks.find((n) => near(n.x, n.z, n.r))?.id ?? null,
        festival: !!fc && near(fc[0], fc[2], FESTIVAL_R),
        concert: !!stage && near(stage.x, stage.z, CONCERT_R),
        campfire: gather?.kind === 'campfire' && controller.seated,
      },
      sky: {
        rainbow: outdoors && rainbow > 0.4,
        shower: outdoors && !!showerOn(s.sky.dayOfYear) && s.sky.daylight < 0.15 && s.sky.weather.kind === 'clear',
      },
    };
  };

  const check = () => {
    if (!d.ready()) return;
    try { book.check(world()); } catch (err) { console.error('[stamps] check failed', err); }
  };
  let queued = false;
  const soon = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; check(); }, 150); } };
  setInterval(check, 1000);
  collection.onFind(soon);
  collection.onSight(soon);
  friends.onChange(soon);
  wallet.onChange((c) => { if (c.kind !== 'reward' && c.kind !== 'work') soon(); });
  const wallHour = () => { const t = new Date(); return t.getHours() + t.getMinutes() / 60; };
  valley.on((e) => {
    // before the world arrives the demo flag isn't known yet, so a demo's first events would count as real work
    if (!d.ready()) return;
    if (e.kind === 'ship' || e.kind === 'unblocked') book.event(e.kind, { demo: valley.state.demo, hour: wallHour() });
    else if (e.kind === 'celebrate' || e.kind === 'plot-opened') soon();
  });
  return book;
}

/** photo mode's saves count too (installed after the book: main.ts calls this once photo mode exists) */
export function watchPhotos(book: StampsService, photo: { onSave(fn: () => void): () => void }, valley: Valley): void {
  photo.onSave(() => book.event('photo', { demo: valley.state.demo, hour: valley.state.sky.hour }));
}
