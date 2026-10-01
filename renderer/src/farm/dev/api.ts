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
 *   __valley.setHour(h|null)  setWeather(kind|null, intensity?)  setSeason(s|null)
 *   __valley.timeScale(k)                 animation speed (0 freezes animation)
 *   __valley.perf()                       fps, draw calls, triangles, per-system ms
 *   __valley.systems()                    system names
 *   __valley.debug(flag, on?)             toggle ctx.debug flags (e.g. 'labels', 'colliders', 'nav')
 *   __valley.force(id, patch)             demo backend: patch an entity (status, activity…)  (demo only)
 *   __valley.scenario(name, seed?)        demo backend: reset to a scenario             (demo only)
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
import type { FarmerLocator, VillagersService } from '../scene/context.ts';
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
  east: [30, 2, -1.57, -0.05],
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
      const dx = from.x - t.x, dz = from.z - t.z, l = Math.hypot(dx, dz) || 1;
      const px = t.x + (dx / l) * dist, pz = t.z + (dz / l) * dist;
      api.teleport(px, pz, Math.atan2(-(t.x - px), -(t.z - pz)), -0.18);
    },
    setHour: (h: number | null) => valley.setSky({ hour: h }),
    setWeather: (w: WeatherKind | null, intensity?: number) => valley.setSky({ weather: w, intensity: intensity ?? null }),
    setSeason: (s: Season | null) => valley.setSky({ season: s }),
    timeScale: (k: number) => engine.setTimeScale(k),
    perf: () => engine.perf(),
    systems: () => engine.systems().map((s) => s.name),
    debug(flag: string, on?: boolean) { ctx.debug[flag] = on ?? !ctx.debug[flag]; return ctx.debug[flag]; },
    force: (id: string, patch: Record<string, unknown>) => d.demoForce?.(id, patch),
    scenario: (name: string, seed?: number) => d.demoScenario?.(name, seed),
    interact() { ctx.interact.focused()?.use(); },
    villagers: () => (ctx.services.get('villagers') as VillagersService | undefined)?.list().map((p) => ({ ...p })) ?? [],
    villager: (id: string) => (ctx.services.get('villagers') as VillagersService | undefined)?.debug(id.startsWith('villager:') ? id : `villager:${id}`) ?? null,
    focused() { const f = ctx.interact.focused(); return f ? { id: f.id, kind: f.kind, verb: f.verb, label: f.label() } : null; },
    look: (x: number, y: number, z: number) => controller.lookAt(x, y, z),
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
