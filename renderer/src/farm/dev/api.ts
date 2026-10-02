/**
 * `window.__valley`: the agent-drivable dev API. Everything a developer (or a coding agent through Playwright /
 * scripts/shoot.ts) needs to put the game in a known state and inspect it, without clicking through UI.
 *
 *   __valley.ready                        true once the first frame rendered with the world loaded
 *   __valley.state()                      ValleyState as plain JSON (farmers, plots, letters, gauges, sky)
 *   __valley.teleport(x, z, yaw?, pitch?) move the player (yaw 0 faces north / −z)
 *   __valley.pose(name)                   named viewpoints (see POSES)
 *   __valley.cam(x, y, z, yaw, pitch)     free camera (detached from the player); cam(null) re-attaches
 *   __valley.goTo(id)                     stand in front of a farmer / helper / plot / structure / villager id ('villager:posy' or 'posy')
 *   __valley.villagers()                  the villager pins, and __valley.villager(id) → what one is doing
 *   __valley.setHour(h|null)  setWeather(kind|null, intensity?)  setSeason(s|null)  festival(id|null)
 *   __valley.atmo({ wet, snow, rainbow, mist, rays, frost } | null)   force weather moments (puddles, lying snow, …)
 *   __valley.timeScale(k)                 animation speed (0 freezes animation)
 *   __valley.perf()                       fps, draw calls, triangles, per-system ms
 *   __valley.systems()                    system names
 *   __valley.debug(flag, on?)             toggle ctx.debug flags (e.g. 'labels', 'colliders', 'nav')
 *   __valley.force(id, patch)             demo backend: patch an entity (status, activity…)  (demo only)
 *   __valley.scenario(name, seed?)        demo backend: reset to a scenario             (demo only)
 *   __valley.forage(day?)  forageGo(i)  fish(step?)  collect(n)   pastimes (scene/forage): today's finds, walk up, cast at the dock, fill the book
 *   __valley.wildlife(id?, 'here'|'spook') wild visitors (deer fox heron owl hedgehog geese): list, or bring one out and stand in view
 *   __valley.coins(n)  buy(id, free?)  sell()  yard(step?)  furnish()   the economy (model/wallet.ts, scene/yard): add bits,
 *                                         buy decor, sell the basket, stand in the yard / at the store, a furnished demo yard
 *   __valley.hearts(id?, n?)  requests(step?)  gift(id, item)   friendship (model/friends.ts): set a villager's hearts (milestones
 *                                         fire), today's requests (requests('ready') completes them, requests('YYYY-MM-DD') rolls that
 *                                         day's set), give a gift (stashed first if the basket lacks it)
 *   __valley.inside(view?)                go into the farmhouse (instant) and stand at a viewpoint: door room hearth shelf desk bed tank window; inside(false) leaves
 *   __valley.interact()                   use whatever is under the crosshair
 *   __valley.focused()                    { id, kind, verb, label } under the crosshair
 *   __valley.audit(opts?)                 placement audit (floating / sunk / overlap …, dev/placement.ts; async)
 *   __valley.auditShow(keys, focus, view) highlight items + frame the free camera on a finding; auditClear()
 */
import * as THREE from 'three';
import type { Engine } from '../scene/engine.ts';
import type { Controller } from '../player/controller.ts';
import type { Valley } from '../model/valley.ts';
import type { Season, WeatherKind } from '../model/types.ts';
import type { FarmerLocator, IndoorSpace, StructureSpots, VillagersService } from '../scene/context.ts';
import type { ForageDebug } from '../scene/forage/forage.ts';
import type { CollectionService } from '../model/collection.ts';
import type { WildlifeService } from '../scene/life/wildlife.ts';
import type { WildId } from '../scene/life/wild.ts';
import type { WalletService } from '../model/wallet.ts';
import type { FriendsService } from '../model/friends.ts';
import type { YardService } from '../scene/yard/yard.ts';
import { SITES, STRUCTURES, heightAt, siteToWorld, structure } from '../world/map.ts';
import type { StructureId } from '../world/map.ts';

export const POSES: Record<string, [number, number, number, number]> = {
  // x, z, yaw, pitch — yaw 0 = north (−z), π/2 = west, −π/2 = east
  hub: [0, 10, 0, -0.05],
  farmhouse: [0, -6, 0, 0.02],
  square: [8, 12, 0.6, -0.08],
  windmill: [46, -22, -0.9, 0.12],
  pond: [28, 40, -1.9, -0.1],
  barn: [-16, -6, 0.6, 0],
  river: [-44, 12, 1.6, -0.05],
  plots: [0, 24, Math.PI, -0.1],
  east: [40, 16, -1.75, 0.02],
};

export interface DevDeps {
  engine: Engine;
  controller: Controller;
  valley: Valley;
  demoForce?(id: string, patch: Record<string, unknown>): Promise<unknown>;
  demoScenario?(name: string, seed?: number): Promise<unknown>;
}

export function installDevApi(d: DevDeps): void {
  const { engine, controller, valley } = d;
  const ctx = engine.ctx;
  let freeCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;
  engine.onFrame(() => {
    if (!freeCam) return;
    ctx.camera.position.set(freeCam.x, freeCam.y, freeCam.z);
    ctx.camera.rotation.set(freeCam.pitch, freeCam.yaw, 0);
  });
  // the controller writes the camera each frame; free cam re-applies after it (onFrame runs before systems, so we
  // also patch after the player update by re-applying in a late hook)
  engine.add(() => ({ name: 'devcam', update() { if (freeCam) { ctx.camera.position.set(freeCam.x, freeCam.y, freeCam.z); ctx.camera.rotation.set(freeCam.pitch, freeCam.yaw, 0); } } }));

  const toJSON = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x)));
  const locate = (id: string): { x: number; z: number; face?: { x: number; z: number } } | null => {
    const loc = ctx.services.get('farmers') as FarmerLocator | undefined;
    const p = loc?.position(id);
    if (p) {
      // approach a farmer from inside their field toward the gate side, so signs and fences don't block the view
      const f = valley.state.farmers.get(id) ?? valley.state.helpers.get(id);
      const pl = f ? valley.state.plots.get(f.plotId) : undefined;
      const s = pl ? SITES[pl.site] : null;
      return { x: p.x, z: p.z, face: s ? { x: p.x + (s.gate.x - s.x) * 0.3, z: p.z + (s.gate.z - s.z) * 0.3 } : undefined };
    }
    const plot = valley.state.plots.get(id);
    if (plot) { const s = SITES[plot.site]; return { x: s.x, z: s.z, face: s.gate }; }
    // a villager ('villager:posy'): approach from the side they face
    const vp = (ctx.services.get('villagers') as VillagersService | undefined)?.list().find((x) => x.id === id || x.id === `villager:${id}`);
    if (vp) { const d = (ctx.services.get('villagers') as VillagersService).debug(vp.id) as { spot?: { yaw: number } } | null; const yaw = d?.spot?.yaw ?? 0; return { x: vp.x, z: vp.z, face: { x: vp.x + Math.sin(yaw), z: vp.z + Math.cos(yaw) } }; }
    if (STRUCTURES.some((s) => s.id === id)) { const s = structure(id as StructureId); return { x: s.x, z: s.z }; }
    const f = valley.state.farmers.get(id) ?? valley.state.helpers.get(id);
    if (f) { const pl = valley.state.plots.get(f.plotId); if (pl) { const s = SITES[pl.site]; const w = siteToWorld(s, 0, 0); return { x: w.x, z: w.z, face: s.gate }; } }
    return null;
  };

  const api = {
    ready: false,
    state: () => toJSON(valley.state),
    teleport: (x: number, z: number, yaw?: number, pitch?: number) => { freeCam = null; controller.teleport(x, z, yaw, pitch); },
    pose(name: string) {
      const p = POSES[name];
      if (!p) throw new Error(`unknown pose ${name}; have ${Object.keys(POSES).join(', ')}`);
      api.teleport(p[0], p[1], p[2], p[3]);
    },
    cam(x: number | null, y?: number, z?: number, yaw = 0, pitch = 0) {
      freeCam = x === null ? null : { x, y: y ?? heightAt(x, z ?? 0) + 30, z: z ?? 0, yaw, pitch };
    },
    goTo(id: string, dist = 3.6) {
      const t = locate(id);
      if (!t) throw new Error(`nothing called ${id}`);
      const from = t.face ?? { x: t.x + dist, z: t.z };
      const base = Math.atan2(from.x - t.x, from.z - t.z);
      // the thing to aim at, if it is an interactable: approach from the preferred side, or the nearest angle from which
      // the crosshair picks it (and not a mailbox or a sign standing in line: the same scoring as scene/engine.ts pick)
      const target = [...ctx.interact.all()].find((i) => i.id === id || i.id === `villager:${id}`);
      const tp = new THREE.Vector3(), q = new THREE.Vector3(), fwd = new THREE.Vector3();
      const stand = (a: number): void => {
        const px = t.x + Math.sin(a) * dist, pz = t.z + Math.cos(a) * dist;
        api.teleport(px, pz, Math.atan2(-(t.x - px), -(t.z - pz)), -0.18);
        if (!target) return;
        target.pos(tp);
        const e = ctx.player.eye, dx = tp.x - e.x, dy = tp.y - e.y, dz = tp.z - e.z;
        api.teleport(px, pz, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      };
      const picks = (): boolean => {
        if (!target) return true;
        ctx.camera.updateMatrixWorld();
        ctx.camera.getWorldDirection(fwd);
        let best: unknown = null, bestScore = Infinity;
        for (const i of ctx.interact.all()) {
          if (i.enabled && !i.enabled()) continue;
          i.pos(q);
          q.sub(ctx.player.eye);
          const d = q.length(), reach = i.reach ?? 3.2;
          if (d > reach + 0.6) continue;
          const cos = q.divideScalar(d || 1).dot(fwd);
          if (cos < (d < 1.5 ? 0.55 : 0.8)) continue;
          const score = (1 - cos) * 6 + d / reach;
          if (score < bestScore) { bestScore = score; best = i; }
        }
        return best === target;
      };
      for (let k = 0; k <= 12; k++) {
        stand(base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6));
        if (picks()) return;
      }
      stand(base);
    },
    setHour: (h: number | null) => valley.setSky({ hour: h }),
    setWeather: (w: WeatherKind | null, intensity?: number) => valley.setSky({ weather: w, intensity: intensity ?? null }),
    setSeason: (s: Season | null) => valley.setSky({ season: s }),
    /** force a festival (model/calendar.ts id: blossom lantern founders harvest hallowtide starlight newyear), null = the calendar */
    festival: (id: string | null) => valley.setSky({ festival: id }),
    /**
     * weather moments (scene/sky + scene/weather): atmo({ wet, snow }) sets the model's weather trace (puddles, lying
     * snow); atmo({ rainbow, mist, rays, frost }) forces those 0..1 in the scene; atmo(null) follows the weather again;
     * atmo() reads the eased state
     */
    atmo(o?: { wet?: number; snow?: number; rainbow?: number; mist?: number; rays?: number; frost?: number } | null) {
      const at = ctx.services.get('atmosphere') as { force(o: Record<string, number | null>): unknown; state(): unknown } | undefined;
      if (o === null) { valley.setSky({ trace: null }); at?.force({ rainbow: null, banks: null, rays: null, frost: null, wet: null, snow: null }); }
      else if (o) {
        const tr: { wet?: number; snow?: number } = {};
        if (o.wet !== undefined) tr.wet = o.wet;
        if (o.snow !== undefined) tr.snow = o.snow;
        if (Object.keys(tr).length) valley.setSky({ trace: { ...valley.skyOverrides().trace, ...tr } });
        const f: Record<string, number> = {};
        if (o.rainbow !== undefined) f.rainbow = o.rainbow;
        if (o.mist !== undefined) f.banks = o.mist;
        if (o.rays !== undefined) f.rays = o.rays;
        if (o.frost !== undefined) f.frost = o.frost;
        at?.force(f);
      }
      return at?.state() ?? null;
    },
    timeScale: (k: number) => engine.setTimeScale(k),
    perf: () => engine.perf(),
    systems: () => engine.systems().map((s) => s.name),
    debug(flag: string, on?: boolean) { ctx.debug[flag] = on ?? !ctx.debug[flag]; return ctx.debug[flag]; },
    force: (id: string, patch: Record<string, unknown>) => d.demoForce?.(id, patch),
    scenario: (name: string, seed?: number) => d.demoScenario?.(name, seed),
    interact() { ctx.interact.focused()?.use(); },
    /** the farmhouse interior (scene/interior): inside('hearth') stands at a viewpoint, inside(false) steps out to the porch */
    inside(view: string | false = 'door') {
      const home = ctx.services.get('indoors') as IndoorSpace | undefined;
      if (!home) return false;
      if (view === false) { home.leave(true); return true; }
      return home.view?.(view) ?? false;
    },
    villagers: () => (ctx.services.get('villagers') as VillagersService | undefined)?.list().map((p) => ({ ...p })) ?? [],
    villager: (id: string) => (ctx.services.get('villagers') as VillagersService | undefined)?.debug(id.startsWith('villager:') ? id : `villager:${id}`) ?? null,
    focused() { const f = ctx.interact.focused(); return f ? { id: f.id, kind: f.kind, verb: f.verb, label: f.label() } : null; },
    look: (x: number, y: number, z: number) => controller.lookAt(x, y, z),
    /** set the almanac's prosperity (no save): crossing a rank pops its upgrade in and sets off a level-up */
    almanac: (points: number) => valley.setAlmanac(points),
    /** a shooting star where the camera looks */
    meteor: () => (ctx.services.get('meteors') as { launch(c: THREE.Camera): void } | undefined)?.launch(ctx.camera),
    /** a firework show over the south meadow (town upgrades) */
    fireworks: (seconds = 20) => (ctx.services.get('upgrades') as { fireworks(s: number): void } | undefined)?.fireworks(seconds),
    /** today's forageables (scene/forage); forage('2026-10-02') re-rolls another day's batch */
    forage(day?: string) { const f = ctx.services.get('forage') as ForageDebug | undefined; if (day) f?.respawn(day); return f?.items() ?? []; },
    /** stand beside forageable i, looking down at it (then interact() picks it up) */
    forageGo(i = 0, dist = 1.7) {
      const it = api.forage()[i];
      if (!it) throw new Error(`no forageable #${i}`);
      const a = Math.atan2(it.x, it.z), px = it.x - Math.sin(a) * dist, pz = it.z - Math.cos(a) * dist;
      api.teleport(px, pz, Math.atan2(-(it.x - px), -(it.z - pz)), -0.62);
      return it;
    },
    /** walk to the end of the dock facing the pond and cast; fish('bite') makes the fish bite now, fish('hook') reels it in;
     *  fish('demo') does the lot (cast, a bite 1.6 s later, hooked 0.5 s after that) for flipbook shots */
    async fish(step?: 'bite' | 'hook' | 'demo') {
      if (step === 'demo') {
        await api.fish();
        setTimeout(() => { void api.fish('bite'); setTimeout(() => void api.fish('hook'), 500); }, 1600);
        return true;
      }
      const f = ctx.services.get('forage') as ForageDebug | undefined;
      if (step === 'bite') return f?.bite();
      if (step === 'hook') { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); return f?.phase(); }
      const end = (ctx.services.get('structureSpots') as StructureSpots | undefined)?.get('dockEnd');
      if (end) api.teleport(end.x, end.z, end.yaw + Math.PI, -0.32);
      await new Promise((r) => setTimeout(r, 250));
      return f?.cast() ?? false;
    },
    /** mark the first n entries of the Collections book found (shots: panel=collection) */
    collect: (n = 12) => (ctx.services.get('collection') as CollectionService | undefined)?.devFill(n),
    /** wild visitors (scene/life/wildlife.ts): wildlife() lists them; wildlife('deer') brings one out at its habitat and
     *  stands you in view of it; wildlife('owl', 'here') summons it in front of the camera instead; wildlife('deer', 'spook') startles it */
    wildlife(id?: string, mode?: 'here' | 'spook') {
      const w = ctx.services.get('wildlife') as WildlifeService | undefined;
      if (!w) return null;
      if (!id) return w.list();
      if (mode === 'spook') { w.spook(id as WildId); return true; }
      const v = w.summon(id as WildId, mode === 'here');
      if (v) api.teleport(v.x, v.z, v.yaw, v.pitch);
      return v;
    },
    /** add (or take, negative) bits; returns the balance */
    coins(n = 500) { const w = ctx.services.get('wallet') as WalletService | undefined; w?.devCoins(n); return w?.coins() ?? 0; },
    /** friendship (model/friends.ts): hearts(id, n) sets a villager's hearts (milestones fire); hearts() lists everyone's */
    hearts(id?: string, n?: number) {
      const fr = ctx.services.get('friends') as FriendsService | undefined;
      if (!fr) return null;
      if (id && n !== undefined) fr.devHearts(id, n);
      return Object.fromEntries(fr.all().map((v) => [v.def.id, v.hearts]));
    },
    /** today's requests: requests() lists them, requests('ready') completes them (bring: stashes the items), requests('2026-10-03') rolls that day's */
    requests(step?: string) {
      const fr = ctx.services.get('friends') as FriendsService | undefined;
      if (!fr) return null;
      const v = step === 'ready' ? fr.devRequests({ ready: true }) : step && /^\d{4}-\d{2}-\d{2}$/.test(step) ? fr.devRequests({ day: step }) : fr.requests();
      return v.map((q) => ({ id: q.req.id, who: q.friend.short, text: q.text, have: q.have, n: q.n, ready: q.ready, done: q.done, reward: q.req.reward, asked: !!q.req.asked }));
    },
    /** give a villager a gift (the item is stashed first if the basket has none): the reaction plays in the world */
    gift(id: string, item: string) {
      const fr = ctx.services.get('friends') as FriendsService | undefined, w = ctx.services.get('wallet') as WalletService | undefined;
      if (!fr || !w) return null;
      if (!(w.data().basket[item] > 0)) w.stash(item, 1);
      return fr.give(id, item);
    },
    /** buy a decor item at the store's price (free = ignore price, rank and season); it goes on the first free yard spot */
    buy(id: string, free = false) { const w = ctx.services.get('wallet') as WalletService | undefined; return w?.buy(id, { rank: valley.state.almanac.rank, season: valley.state.sky.season, autoPlace: true, free }) ?? null; },
    /** sell the whole basket (as at Bram's) */
    sell: () => (ctx.services.get('wallet') as WalletService | undefined)?.sellAll() ?? null,
    /** stand in your yard ('store': at the General store; 'carry': pick up the first placed piece to move it) */
    yard(step?: 'store' | 'carry') {
      const y = ctx.services.get('yard') as YardService | undefined;
      if (!y) return null;
      freeCam = null;
      if (step === 'store') { y.gotoStore(); return y.store; }
      y.goto();
      if (step === 'carry') { const p = (ctx.services.get('wallet') as WalletService | undefined)?.data().pieces.find((x) => x.slot !== null); if (p) y.carry(p.uid); }
      return y.slots();
    },
    /** a furnished demo yard (free pieces, a few styles and turns): shots of the yard */
    furnish() {
      const w = ctx.services.get('wallet') as WalletService | undefined;
      if (!w) return 0;
      const s = valley.state.sky.season;
      const plan = ['lights', 'planter', 'lamppost', 'bench', 'planter', 'gnome', 'birdbath', 'topiary', 'scarecrow', 'flamingo', 'petbed', 'chime', 'birdhouse', 'lamppost',
        s === 'autumn' ? 'pumpkin' : s === 'winter' ? 'snowman' : s === 'spring' ? 'sapling' : 'parasol'];
      for (const id of plan) {
        const r = w.buy(id, { rank: 9, season: s, autoPlace: true, free: true });
        if (r.ok && (id === 'gnome' || id === 'scarecrow')) w.restyle(r.piece.uid);
        if (r.ok && (id === 'bench' || id === 'gnome')) w.rotate(r.piece.uid, id === 'bench' ? 0 : 1);
      }
      return w.data().pieces.length;
    },
    // placement audit: loaded on demand (three-mesh-bvh stays out of the game bundle's hot path)
    audit: async (o?: import('./placement.ts').AuditOpts) => (await import('./placement.ts')).audit(ctx, valley.state, o),
    async auditShow(keys: string[], focus: import('./placementCore.ts').Box, view = 0) {
      const p = (await import('./placement.ts')).show(ctx, keys, focus, view);
      api.cam(p.x, p.y, p.z, p.yaw, p.pitch);
      return p;
    },
    async auditClear() { (await import('./placement.ts')).clearHighlight(ctx); api.cam(null); },
    three: THREE,
    ctx,
  };
  Object.assign(window, { __valley: api });
}
