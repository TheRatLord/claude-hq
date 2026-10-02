/**
 * Fern's Field Notebook, wired (model/guide.ts is the pure notebook; hud/guide.ts draws it; docs/valley/guide.md).
 * main.ts creates it here and this file feeds it about once a second:
 *
 *  - a `GuideWorld` snapshot read off the live services (the Collections book, friendship, the wallet, the stamp
 *    book's counters, the barn's chores, the grotto, your pet, the cairn, the album, the welcome tour's chips): a page
 *    is found when they say you have done it. Nothing is copied: the notebook keeps only a small `seen` set for what
 *    nobody else remembers, ticked here from real state (aboard the rowboat, on the ice, rolling a snowball, inside the
 *    farmhouse / barn, at the valley viewer, seated at a gathering) and by the HUD (the Gazette, the lantern, a wave);
 *  - Fern's nudges: where you stand (the dock, the pond's edge, the barn door, the campfire, the trailhead, the
 *    foundlings' basket) against what you've never tried → `onboarding.want(id)` (one-time tips with the tour's cadence);
 *  - the "what's new" letter, settled once on load (never for a first-run profile).
 *
 * Service 'guide' (`GuideHandle`): the villagers ask it for rumours, the HUD reads it, `__valley.guide()` drives it.
 */
import type { HeartsData } from './model/hearts.ts';
import { createGuide, nudgesFor, NEAR_FAR, type GuideService, type GuideWorld, type Near, type NudgeId, type SeenId } from './model/guide.ts';
import type { Valley } from './model/valley.ts';
import type { CollectionService } from './model/collection.ts';
import type { WalletService } from './model/wallet.ts';
import type { FriendsService } from './model/friends.ts';
import type { StampsService } from './model/stamps.ts';
import type { OnboardingService } from './model/onboarding.ts';
import type { BarnService } from './model/barn.ts';
import type { CompanionService } from './model/pet.ts';
import type { Engine } from './scene/engine.ts';
import type { Controller } from './player/controller.ts';
import type { IndoorSpace } from './scene/context.ts';
import type { GatherService } from './scene/gather/gather.ts';
import type { TrailService } from './scene/trail/trail.ts';
import type { GrottoHandle } from './scene/grotto/grotto.ts';
import type { SeasonsService } from './scene/seasons/seasons.ts';
import type { ProjectsService } from './model/projects.ts';
import { dayKey } from './model/almanac.ts';
import type { VisitorsData } from './model/visitors.ts';
import { POND, TRAIL, structure } from './world/map.ts';
import { localJson } from './storage.ts';
import { ORCHARD_GATE } from './world/orchard.ts';

export const GUIDE_KEY = 'claude-valley.guide.v1';

export interface GuideDeps {
  engine: Engine;
  controller: Controller;
  valley: Valley;
  collection: CollectionService;
  wallet: WalletService;
  friends: FriendsService;
  stamps: StampsService;
  onboarding: OnboardingService;
  /** photos in the album (created after the notebook) */
  photos: () => number;
  /** the bound keys' labels ({ use: 'E', notebook: 'O', … }) for the letter */
  keys: () => Readonly<Record<string, string>>;
  /** the profile had met Posy before this load (a first-run profile never gets the "what's new" letter) */
  welcomed: boolean;
}

export interface GuideHandle extends GuideService {
  /** the nudges that apply where you stand right now */
  nudges(): NudgeId[];
  /** dev: `dev()` state; 'see' id; 'news' (post a letter as if your last visit was before the latest releases); 'reset' */
  dev(cmd?: string, a?: string): unknown;
}

export function installGuide(d: GuideDeps): GuideHandle {
  const { engine, controller, valley, collection, wallet, friends, stamps, onboarding } = d;
  const svc = engine.ctx.services;
  const guide = createGuide(localJson(GUIDE_KEY));
  const dock = structure('dock'), barn = structure('barn'), fire = structure('campfire'), sign = structure('signpost');
  const head = TRAIL.anchors.trailhead;
  // the foundlings' basket sits beside Fern's signpost (scene/life/companion.ts)
  const basket = { x: sign.x + 1.6, z: sign.z + 1.2 };

  const world = (): GuideWorld => {
    const s = valley.state;
    const g = (svc.get('gatherings') as GatherService | undefined)?.active() ?? null;
    const pd = (svc.get('companion') as CompanionService | undefined)?.model.data();
    const grotto = svc.get('grotto') as GrottoHandle | undefined;
    return {
      season: s.sky.season, hour: s.sky.hour, weather: s.sky.weather.kind, snow: s.sky.trace.snow,
      ice: (svc.get('seasons') as SeasonsService | undefined)?.ice() ?? 0,
      festival: s.sky.festival.active?.id ?? null, gathering: g?.kind ?? null,
      collection: collection.data(), friends: friends.data(), wallet: wallet.data(), stamps: stamps.data(),
      barn: (svc.get('barn') as BarnService | undefined)?.data().total ?? null,
      grotto: grotto?.data() ?? null,
      pet: pd?.pet ? { name: pd.pet.name, ...pd.total } : null,
      stones: (svc.get('trail') as TrailService | undefined)?.stones() ?? 0,
      photos: d.photos(), toured: onboarding.data().pastimes, seen: [],
      projects: (svc.get('projects') as ProjectsService | undefined)?.data() ?? null,
      visitors: (svc.get('visitors') as { data(): VisitorsData } | undefined)?.data() ?? null, day: dayKey(Date.now()),
      hearts: (svc.get('hearts') as { data(): HeartsData } | undefined)?.data() ?? null,
      restored: Object.entries((svc.get('projects') as ProjectsService | undefined)?.data().p ?? {}).filter(([, p]) => p?.unveiled).map(([id]) => id),
    };
  };

  /** the few things only the notebook remembers, from real state */
  const watch = () => {
    const s = valley.state;
    const room = (svc.get('indoors') as IndoorSpace | undefined)?.room ?? null;
    if (room === 'farmhouse' || room === 'barn') guide.see(room);
    const sea = svc.get('seasons') as SeasonsService | undefined;
    if (sea) {
      if (s.sky.season !== 'winter' && !guide.data().seen.includes('rowboat') && (sea.boat() as { mode?: string } | null)?.mode === 'aboard') guide.see('rowboat');
      if (sea.ice() > 0 && !guide.data().seen.includes('skate') && (sea.skate() as { on?: boolean } | null)?.on) guide.see('skate');
      if (s.sky.trace.snow > 0.2 && !guide.data().seen.includes('snowball') && (sea.snowman() as { carrying?: number | null } | null)?.carrying) guide.see('snowball');
    }
    if ((svc.get('trail') as TrailService | undefined)?.viewing) guide.see('viewer');
    if (controller.seated && (svc.get('gatherings') as GatherService | undefined)?.active()) guide.see('gathering');
  };

  const near = (): Near => {
    const indoors = (svc.get('indoors') as IndoorSpace | undefined)?.active;
    if (indoors) return { ...NEAR_FAR, outdoors: false };
    const p = engine.ctx.player.pos;
    const dist = (x: number, z: number) => Math.hypot(p.x - x, p.z - z);
    return {
      outdoors: true, dock: dist(dock.x, dock.z), pond: Math.max(0, dist(POND.x, POND.z) - POND.r), barn: dist(barn.x, barn.z),
      campfire: dist(fire.x, fire.z), trailhead: dist(head.x, head.z), basket: dist(basket.x, basket.z),
      orchard: dist(ORCHARD_GATE.x, ORCHARD_GATE.z),
    };
  };

  let lastNudges: NudgeId[] = [];
  const tick = () => {
    try {
      watch();
      guide.update(world());
      lastNudges = nudgesFor(guide.world(), near());
      if (onboarding.tips && !onboarding.data().hints.off) for (const id of lastNudges) onboarding.want(id);
    } catch (err) { console.error('[guide] tick failed', err); }
  };
  setInterval(tick, 1000);
  setTimeout(tick, 300);

  // "what's new": re-post the last letter, then settle this load's (a first-run profile gets Posy's welcome instead)
  const post = (l: { id: string; at: number; title: string; body: string }) => valley.post({ id: l.id, at: l.at, from: 'guide', fromName: 'Fern, the ranger', title: l.title, body: l.body });
  const old = guide.data().letter;
  const fresh = guide.news({ welcomed: d.welcomed, keys: d.keys() });
  if (old && old.id !== fresh?.id) post(old);
  if (fresh) post(fresh);

  return Object.assign(guide, {
    nudges: () => [...lastNudges],
    dev(cmd?: string, a?: string): unknown {
      if (cmd === 'see' && a) guide.see(a as SeenId);
      else if (cmd === 'news') {
        // as if the last visit was before the latest releases (the real letter path)
        const l = (() => { const dd = guide.data() as { news: number }; dd.news = 0; return guide.news({ welcomed: true, keys: d.keys() }); })();
        if (l) post({ ...l, id: `${l.id}:${Date.now()}` });
        return l;
      } else if (cmd === 'reset') guide.devReset();
      tick();
      const v = guide.view();
      return {
        found: v.found, total: v.total, seen: [...guide.data().seen], known: [...guide.data().known], news: guide.data().news, nudges: [...lastNudges],
        pages: v.pages.map((p) => ({ id: p.def.id, found: p.found, fresh: p.fresh, now: p.now, notes: p.notes })),
      };
    },
  });
}
