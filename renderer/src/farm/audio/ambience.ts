/**
 * Ambient beds by time, weather and place. Each frame: measure distances to the valley's sound landmarks, ask
 * `ambientLevels` (pure) for bed levels, then build / fade / retire loop voices and aim the positional ones.
 * Voices are built only while audible and retired after 8 s of silence, so a quiet valley costs almost nothing.
 */
import type { IndoorSpace, SceneCtx } from '../scene/context.ts';
import { HUB_Y, POND, RIVER, RIVER_HALF_WIDTH, SITES, heightAt, structure } from '../world/map.ts';
import { projectSite } from '../world/projects.ts';
import type { XZ } from '../world/map.ts';
import type { AudioEngine, PosChain } from './engine.ts';
import { ambientLevels, emptyLevels } from './mix.ts';
import type { AmbientIn, AmbientLevels, SpatialOpts } from './mix.ts';
import { buildLoop } from './loops.ts';
import type { LoopEnv, LoopKind, LoopVoice } from './loops.ts';

interface P3 { x: number; y: number; z: number }
interface Bed {
  key: string;
  kind: LoopKind;
  level(l: AmbientLevels): number;
  /** gain at level 1 */
  scale: number;
  /** positional source (null: plain stereo bed) */
  pos: P3 | null;
  /** skip the indoor muffle (the rain on the roof is right above you) */
  dry?: boolean;
  opts: SpatialOpts;
  voice: LoopVoice | null;
  chain: PosChain | null;
  quietSince: number;
  cur: number;
}

/** Nearest point on a polyline (writes out, returns the distance). */
export function nearestOnPolyline(x: number, z: number, pts: readonly XZ[], out: XZ): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; out.x = px; out.z = pz; }
  }
  return Math.sqrt(best);
}

/** Gain of each bed at level 1 (shared with the offline mixdown in debug.ts). */
export const BED_SCALE: Readonly<Record<LoopKind, number>> = {
  wind: 0.55, rain: 0.6, roof: 0.75, birds: 1.6, crickets: 0.9, owls: 0.9, river: 0.8, waterfall: 1.1, pond: 0.4, frogs: 0.7,
  fire: 0.6, windmill: 0.55, bees: 0.5, leaves: 0.9, cowbells: 0.7, millwheel: 0.9, cave: 0.8, glasshouse: 0.8,
};

export interface Ambience {
  update(now: number): void;
  readonly levels: AmbientLevels;
  env: LoopEnv;
  stats(): Record<string, number>;
  dispose(): void;
}

export function createAmbience(ctx: SceneCtx, eng: AudioEngine, playThunder: () => void, externalThunderSince: () => number, indoor: () => number = () => 0, roof: () => number = () => 1): Ambience {
  const wf = structure('waterfall'), fire = structure('campfire'), mill = structure('windmill');
  const env: LoopEnv = {
    cpu: () => ctx.valley.gauges?.cpu ?? 0.3,
    tempC: () => ctx.valley.gauges?.tempC ?? null,
    send: null,
    season: () => ctx.valley.sky.season,
  };
  const gh = projectSite('glasshouse');
  const ghP: P3 = { x: gh.x, y: heightAt(gh.x, gh.z) + 1.2, z: gh.z };
  /** the Valley Projects model (scene/projects publishes 'projects'): is the glasshouse restored? */
  const restored = (id: string): boolean => {
    const m = ctx.services.get('projects') as { data(): { p: Record<string, { done?: boolean; unveiled?: boolean } | undefined> } } | undefined;
    try { const p = m?.data().p[id]; return !!(p?.done && p.unveiled); } catch { return false; }
  };
  const riverP: P3 = { x: 0, y: -0.8, z: 0 }, pondP: P3 = { x: POND.x, y: -0.8, z: POND.z };
  const bees: P3[] = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  const beeD = [Infinity, Infinity];
  const herd: P3 = { x: 0, y: 0, z: 0 };
  const B = (key: string, kind: LoopKind, scale: number, level: Bed['level'], pos: P3 | null = null, opts: SpatialOpts = {}): Bed =>
    ({ key, kind, scale, level, pos, opts, voice: null, chain: null, quietSince: 0, cur: 0 });
  const beds: Bed[] = [
    B('wind', 'wind', BED_SCALE.wind, (l) => l.wind),
    B('rain', 'rain', BED_SCALE.rain, (l) => l.rain),
    // indoors: the rain drums on the roof instead (louder on the barn's tin than the farmhouse shingles)
    { ...B('roof', 'roof', BED_SCALE.roof, (l) => l.rain * indoor() * roof()), dry: true },
    B('birds', 'birds', BED_SCALE.birds, (l) => l.birds),
    B('crickets', 'crickets', BED_SCALE.crickets, (l) => l.crickets),
    B('owls', 'owls', BED_SCALE.owls, (l) => l.owls),
    B('river', 'river', BED_SCALE.river, (l) => l.river, riverP, { max: 90 }),
    B('waterfall', 'waterfall', BED_SCALE.waterfall, (l) => l.waterfall, { x: wf.x, y: wf.y + 3, z: wf.z }, { max: 160 }),
    B('pond', 'pond', BED_SCALE.pond, (l) => l.pond, pondP, { max: 60 }),
    B('frogs', 'frogs', BED_SCALE.frogs, (l) => l.frogs, pondP, { max: 90 }),
    B('fire', 'fire', BED_SCALE.fire, (l) => l.fire, { x: fire.x, y: fire.y + 0.4, z: fire.z }, { max: 45 }),
    B('windmill', 'windmill', BED_SCALE.windmill, (l) => l.windmill, { x: mill.x, y: mill.y + 7, z: mill.z }, { max: 70 }),
    B('bees0', 'bees', BED_SCALE.bees, (l) => l.bees * (beeD[0] <= beeD[1] ? 1 : 0.6), bees[0], { max: 40 }),
    B('bees1', 'bees', BED_SCALE.bees, (l) => (Number.isFinite(beeD[1]) ? l.bees * 0.6 : 0), bees[1], { max: 40 }),
    B('leaves', 'leaves', BED_SCALE.leaves, (l) => l.leaves),
    B('cowbells', 'cowbells', BED_SCALE.cowbells, (l) => l.cowbells, herd, { ref: 4, max: 80 }),
    // the grotto's room tone stays dry (the indoor muffle is for what comes through the rock)
    { ...B('cave', 'cave', BED_SCALE.cave, (l) => l.cave), dry: true },
    B('glasshouse', 'glasshouse', BED_SCALE.glasshouse, (l) => l.glasshouse, ghP, { ref: 4, max: 24 }),
  ];
  const levels = emptyLevels();
  const inp: AmbientIn = { hour: 12, daylight: 1, season: 'summer', weather: 'clear', intensity: 0, wind: 2, cpu: 0.3, altitude: 0, dRiver: 1e9, dPond: 1e9, dWaterfall: 1e9, dFire: 1e9, dWindmill: 1e9, dBees: Infinity, dHerd: Infinity, dHub: 0, cave: 0, dGlasshouse: Infinity, snowCover: 0 };
  const near: XZ = { x: 0, z: 0 };
  let nextThunder = 0, lastAim = 0, ghCheck = -1e9, ghOn = false;

  const measure = () => {
    const L = eng.listener;
    const sky = ctx.valley.sky;
    inp.hour = sky.hour; inp.daylight = sky.daylight; inp.season = sky.season;
    inp.weather = sky.weather.kind; inp.intensity = sky.weather.intensity; inp.wind = sky.weather.wind;
    inp.cpu = ctx.valley.gauges?.cpu ?? 0.3;
    inp.altitude = Math.max(0, ctx.player.pos.y - HUB_Y);
    inp.dRiver = Math.max(0, nearestOnPolyline(L.x, L.z, RIVER, near) - RIVER_HALF_WIDTH);
    riverP.x = near.x; riverP.z = near.z;
    const dp = Math.hypot(L.x - POND.x, L.z - POND.z);
    inp.dPond = Math.max(0, dp - POND.r);
    if (dp > 1e-3) { pondP.x = POND.x + ((L.x - POND.x) / dp) * Math.min(dp, POND.r * 0.8); pondP.z = POND.z + ((L.z - POND.z) / dp) * Math.min(dp, POND.r * 0.8); }
    inp.dWaterfall = Math.hypot(L.x - wf.x, L.z - wf.z);
    inp.dFire = Math.hypot(L.x - fire.x, L.z - fire.z);
    inp.dWindmill = Math.hypot(L.x - mill.x, L.z - mill.z);
    // nearest two living bee plots
    beeD[0] = beeD[1] = Infinity;
    for (const p of ctx.valley.plots.values()) {
      if (p.kind !== 'bees' || p.stage === 'harvest' || p.stage === 'fallow') continue;
      const s = SITES[p.site];
      if (!s) continue;
      const d = Math.hypot(L.x - s.x, L.z - s.z);
      if (d < beeD[0]) { beeD[1] = beeD[0]; bees[1].x = bees[0].x; bees[1].z = bees[0].z; bees[1].y = bees[0].y; beeD[0] = d; bees[0].x = s.x; bees[0].z = s.z; bees[0].y = s.y + 1; }
      else if (d < beeD[1]) { beeD[1] = d; bees[1].x = s.x; bees[1].z = s.z; bees[1].y = s.y + 1; }
    }
    inp.dBees = beeD[0];
    // the nearest grazing herd (cows / sheep) for the bells
    inp.dHerd = Infinity;
    for (const p of ctx.valley.plots.values()) {
      if ((p.kind !== 'cows' && p.kind !== 'sheep') || p.stage === 'harvest' || p.stage === 'fallow') continue;
      const s = SITES[p.site];
      if (!s) continue;
      const d = Math.hypot(L.x - s.x, L.z - s.z);
      if (d < inp.dHerd) { inp.dHerd = d; herd.x = s.x; herd.y = s.y + 1.2; herd.z = s.z; }
    }
    inp.dHub = Math.hypot(L.x, L.z + 2);
    const room = ctx.services.get('indoors') as IndoorSpace | undefined;
    inp.cave = room?.active && room.room === 'grotto' ? indoor() : 0;
    inp.snowCover = (sky as { trace?: { snow: number } }).trace?.snow ?? 0;
    const dg = Math.hypot(L.x - ghP.x, L.z - ghP.z);
    inp.dGlasshouse = dg < 30 && ghOn ? dg : Infinity;
  };

  return {
    levels,
    env,
    update(now) {
      const ac = eng.ac, amb = eng.bus('ambient'), dry = eng.dry();
      if (!ac || !amb || !dry) return;
      env.send = eng.send;
      if (now - ghCheck > 2) { ghCheck = now; ghOn = restored('glasshouse'); }
      measure();
      ambientLevels(inp, levels);
      eng.setHush(levels.hush);
      eng.setCave(levels.cave);
      const aimNow = now - lastAim > 0.066;
      if (aimNow) lastAim = now;
      for (const b of beds) {
        const lv = Math.max(0, b.level(levels));
        if (lv > 0.004) b.quietSince = now;
        if (!b.voice) {
          if (lv <= 0.004) continue;
          b.voice = buildLoop(b.kind, ac, env);
          if (b.pos) { b.chain = eng.chain(amb); b.voice.out.connect(b.chain.input); b.chain.input.gain.value = 1; }
          else b.voice.out.connect(b.dry ? dry : amb);
        } else if (now - b.quietSince > 8) {
          b.voice.stop();
          const ch = b.chain;
          if (ch) setTimeout(() => { ch.input.disconnect(); ch.pan.disconnect(); ch.lp.disconnect(); }, 800);
          b.voice = null; b.chain = null; b.cur = 0;
          continue;
        }
        if (Math.abs(lv - b.cur) > 0.003 || (lv === 0 && b.cur !== 0)) {
          b.cur = lv;
          b.voice.out.gain.setTargetAtTime(lv * b.scale, now, 0.5);
        }
        if (b.chain && b.pos && aimNow) eng.aim(b.chain, b.pos.x, b.pos.y, b.pos.z, 1, b.opts, false, 0.15);
        b.voice.tick(now, 0.3, lv);
      }
      // distant thunder in storms, unless the weather system is already voicing its own lightning
      if (levels.storm > 0.3 && now > nextThunder && externalThunderSince() > 120) {
        if (nextThunder > 0) playThunder();
        nextThunder = now + 22 + Math.random() * 48;
      }
    },
    stats() {
      const o: Record<string, number> = {};
      for (const b of beds) if (b.voice) o[b.key] = Math.round(b.cur * 100) / 100;
      return o;
    },
    dispose() { for (const b of beds) { b.voice?.stop(); b.voice = null; } },
  };
}
