/**
 * The plots system: one Field per PlotView (workspace) at its site, wild meadow on every free site, and the shared
 * batches / effects they draw into. Publishes the 'plots' service (see PlotsService).
 */
import * as THREE from 'three';
import type { PlotStage, Season } from '../../model/types.ts';
import { SITES, heightAt, inSite, structure } from '../../world/map.ts';
import type { Site } from '../../world/map.ts';
import type { AudioService, FarmerLocator, LightsService, SystemFactory } from '../context.ts';
import { TextAtlas } from './atlas.ts';
import { Batches } from './batch.ts';
import { Field } from './field.ts';
import type { FieldEnv } from './field.ts';
import { Fx } from './fx.ts';
import { cropMaterial, cropUniforms } from './materials.ts';
import { Meadow } from './meadow.ts';

/** Service 'plots': what other packages (farmers, life, hud) may ask about fields. */
export interface PlotsService {
  /** the field for a plot id (workspace id): its site, stage and how built it is (0 meadow … 1 fenced + planted) */
  field(plotId: string): { site: Site; stage: PlotStage; built: number } | null;
  /** animals of a plot with their world feet positions (empty for crop fields) */
  animalsNear(plotId: string): { id: string; name: string; species: string; pos: THREE.Vector3; sleeping: boolean; mode: string }[];
  /** an idle farmer pets one of its field's animals (hearts, the animal's sound, it stops to enjoy it) */
  petAnimal(plotId: string, animalId: string): void;
  /** ground height a character should stand on at (x, z): terrain, or the top of tilled soil inside a field */
  soilHeight(x: number, z: number): number;
  /** world position of a helper's scarecrow head (for markers / camera focus) */
  helperPos(id: string): THREE.Vector3 | null;
  /** is (x, z) inside any field's fence (with margin)? */
  inField(x: number, z: number, margin?: number): string | null;
}

export const plotsSystem: SystemFactory = (ctx) => {
  const root = new THREE.Group();
  root.name = 'plots';
  ctx.scene.add(root);
  const batches = new Batches();
  root.add(batches.group);
  const fx = new Fx(batches);
  const atlas = new TextAtlas();
  const weedU = cropUniforms(0.22);
  const weedMat = cropMaterial(weedU, { side: THREE.DoubleSide });
  let season: Season = ctx.valley.sky.season;
  let meadow = new Meadow(SITES, season, weedMat);
  root.add(meadow.group);
  const fields = new Map<string, Field>();
  let closing: Field[] = [];
  const barn = structure('barn'), bin = structure('shippingBin');
  const hooks = { interact: ctx.interact, colliders: ctx.colliders, ui: ctx.ui, agents: ctx.agents, lights: ctx.services.get('lights') as LightsService | undefined };
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const sndPos = new THREE.Vector3();
  const covers = new Float32Array(SITES.length);
  // farmer feet for crop parting, refreshed ~7× a second (the locator hands out clones: not every frame)
  const feet = new Map<string, THREE.Vector3>();
  let feetT = 0;
  const refreshFeet = () => {
    const loc = ctx.services.get('farmers') as FarmerLocator | undefined;
    for (const id of feet.keys()) if (!ctx.valley.farmers.has(id)) feet.delete(id);
    if (!loc) return;
    for (const id of ctx.valley.farmers.keys()) {
      const p = loc.position(id);
      if (!p) { feet.delete(id); continue; }
      const v = feet.get(id);
      if (v) v.copy(p); else feet.set(id, p);
    }
  };

  const env: FieldEnv = {
    time: 0, dt: 0, now: 0, season, night: 0, sunDir: ctx.lighting.sunDir, wind: ctx.lighting.wind, camQuat: ctx.camera.quaternion,
    player: { x: 0, y: 0, z: 0, speed: 0 }, batches, fx, atlas, weedMat,
    farmer: (id) => ctx.valley.farmers.get(id), helper: (id) => ctx.valley.helpers.get(id),
    sound: (name, x, y, z, volume) => { try { audio()?.play(name, { pos: sndPos.set(x, y, z), volume }); } catch { /* audio is optional */ } },
    barn: { x: 0, z: 0 },
    farmerPos: (id, out) => { const p = feet.get(id); if (!p) return false; out.copy(p); return true; },
    // a push cart (git.ts) reached the bin: its lid pops (structures publishes 'shippingBin')
    shipped: () => { try { (ctx.services.get('shippingBin') as { ship?(): void } | undefined)?.ship?.(); } catch { /* optional */ } },
  };

  const barnLocal = (site: Site, to: { x: number; z: number } = barn) => {
    const dx = to.x - site.gate.x, dz = to.z - site.gate.z, l = Math.hypot(dx, dz) || 1;
    const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
    const x = dx / l, z = dz / l;
    return { x: x * c - z * s, z: x * s + z * c };
  };

  const rebuild = () => {
    for (const f of [...fields.values(), ...closing]) f.dispose(atlas);
    fields.clear(); closing = [];
    meadow.dispose();
    meadow = new Meadow(SITES, season, weedMat);
    root.add(meadow.group);
  };

  const onEvent = ctx.onValley((e) => {
    const p = ctx.valley.plots.get(e.id);
    const s = p && SITES[p.site];
    if (!s) return;
    if (e.kind === 'plot-opened') env.sound('hoe', s.x, s.y + 1, s.z);
    if (e.kind === 'plot-closed') env.sound('sparkle', s.gate.x, s.y + 1, s.gate.z);
  });

  const service: PlotsService = {
    field(id) {
      const f = fields.get(id);
      const p = ctx.valley.plots.get(id);
      if (!f || !p) return null;
      return { site: f.site, stage: p.stage, built: f.cover() };
    },
    animalsNear(id) {
      const f = fields.get(id);
      if (!f) return [];
      return f.animals().filter((a) => a.appear > 0.5 && a.mode !== 'gone').map((a) => ({
        id: a.id, name: a.name, species: a.sp.key, pos: f.world(a.x, 0, a.z, new THREE.Vector3()), sleeping: a.sleepK > 0.5, mode: `${a.mode}/${a.stage}${a.lying ? '/lying' : ''}`,
      }));
    },
    petAnimal(plotId, animalId) {
      fields.get(plotId)?.petAnimal(animalId);
    },
    soilHeight(x, z) {
      const h = heightAt(x, z);
      for (const f of fields.values()) if (f.cover() > 0.5 && inSite(f.site, x, z, -0.8)) return Math.max(h, f.site.y + 0.12);
      return h;
    },
    helperPos(id) {
      const h = ctx.valley.helpers.get(id);
      const p = h && ctx.valley.plots.get(h.plotId);
      if (!h || !p) return null;
      const f = fields.get(p.id);
      if (!f) return null;
      const s = f.site, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const lx = s.w / 2 - 1.3, lz = -s.d / 2 + 2.2 + (h.spot % 5) * 2.4;
      return new THREE.Vector3(s.x + lx * c + lz * sn, s.y + 1.9, s.z - lx * sn + lz * c);
    },
    inField(x, z, margin = 0) {
      for (const [id, f] of fields) if (inSite(f.site, x, z, margin)) return id;
      return null;
    },
  };
  ctx.services.set('plots', service);

  return {
    name: 'plots',
    update(f) {
      const sky = ctx.valley.sky;
      if (sky.season !== season) { season = sky.season; env.season = season; rebuild(); }
      env.time = f.time; env.dt = f.dt; env.now = f.now; env.night = ctx.lighting.night;
      env.sunDir = ctx.lighting.sunDir; env.wind = ctx.lighting.wind; env.camQuat = ctx.camera.quaternion;
      const pl = env.player!;
      pl.x = ctx.player.pos.x; pl.y = ctx.player.pos.y; pl.z = ctx.player.pos.z; pl.speed = ctx.player.speed;
      fx.camQuat = ctx.camera.quaternion;
      if ((feetT -= f.dt) <= 0) { feetT = 0.14; refreshFeet(); }
      weedU.uTime.value = f.time;
      (weedU.uWind.value as THREE.Vector2).set(ctx.lighting.wind.x * 0.5, ctx.lighting.wind.z * 0.5);
      weedU.uSnow.value = season === 'winter' ? 0.6 : 0;
      weedU.uDry.value = season === 'autumn' ? 0.35 : 0;

      batches.begin();
      covers.fill(0);
      for (const plot of ctx.valley.plots.values()) {
        let field = fields.get(plot.id);
        if (!field) {
          const site = SITES[plot.site];
          if (!site) continue;
          // a new workspace reclaims a site: whatever still stands there dissolves right away
          for (const [id, other] of fields) if (other.site.index === site.index) { other.close(); closing.push(other); fields.delete(id); }
          field = new Field(site, plot, season, { fresh: plot.stage === 'tilling', hooks, barnLocal: barnLocal(site), binLocal: barnLocal(site, bin) });
          root.add(field.root);
          fields.set(plot.id, field);
        }
        field.update(env, plot);
        covers[field.site.index] = Math.max(covers[field.site.index], field.cover());
      }
      for (const [id, field] of fields) if (!ctx.valley.plots.has(id)) { field.close(); closing.push(field); fields.delete(id); }
      closing = closing.filter((field) => {
        field.update(env, null);
        covers[field.site.index] = Math.max(covers[field.site.index], field.cover());
        if (field.done) { field.dispose(atlas); return false; }
        return true;
      });
      for (let i = 0; i < SITES.length; i++) meadow.setCover(i, covers[i]);
      meadow.update(f.dt, batches, atlas, season, f.time, ctx.camera);
      fx.update(f.dt);
      batches.end();
    },
    dispose() {
      onEvent();
      for (const fld of [...fields.values(), ...closing]) fld.dispose(atlas);
      meadow.dispose();
      batches.dispose();
      root.removeFromParent();
      ctx.services.delete('plots');
    },
    stats() {
      let crops = 0;
      for (const fl of fields.values()) crops += fl.stats().crops;
      return { fields: fields.size, closing: closing.length, crops, particles: fx.count(), ...batches.stats() };
    },
  };
};
