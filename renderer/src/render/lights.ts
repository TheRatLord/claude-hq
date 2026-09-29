/**
 * §5.0 lighting: the fixed studio key (one DirectionalLight, the only shadow caster; white/1.0 in three so its
 * colour in the shader is exactly the shadow factor — keyCol and gains live in uniforms), sun + sky uniforms from the
 * real clock (`?hour=`), gain sets per phase, lamp pools (lamps.ts) and window gobo rects from the layout.
 * The shadow box (24 m ortho) follows the camera, texel-snapped so shadows never swim. The shadow map itself is
 * rendered once per frame by post.ts (`renderShadows`) with the CASTERS|CHARS mask.
 * Owner: RND.
 */
import * as THREE from 'three';
import { U, MAX_WINDOWS } from './uniforms.ts';
import { LAYERS, MASK } from './layers.ts';
import { createLightingState, lightingInto, KEY_DIR, lin, LAMP_SCALE, goboSkyDirInto, SUN_PATCH, SUN_PATCH_GOLDEN, SUN_PATCH_MORNING, PATCH_CAP, type Phase, type PerPhase, type LightingState } from './lightMath.ts';
import type { Tier } from './quality.ts';
import { createLamps } from './lamps.ts';
import { createZoneGrade } from './zoneGrade.ts';
import { createSunShafts } from './sunShafts.ts';
import { ENV, type Rgb } from '../../../shared/palette.ts';
import { hqStatSection } from '../core/debug.ts';
import type { Ctx } from '../core/ctx.ts';
import type { Layout, WindowRect } from '../world/layout/schema.ts';

/** Write linear rgb into a colour. */
const setRGB = (c: THREE.Color, v: readonly number[]): void => { c.r = v[0]; c.g = v[1]; c.b = v[2]; };

const SHADOW_SIZE: Record<Tier, number> = { low: 0, medium: 1024, high: 2048, photo: 4096 };
const BOX = 24;
const SNAP_M = 1.5; // shadow box step (m), see update()

export interface Lights {
  /** time of day, shadow box, lamp pools (§8.1 step 5) */
  update(ctx: Ctx): void;
  key: THREE.DirectionalLight;
  /** last lighting state (probe.ts reads it) */
  state: LightingState | null;
  readonly lamps: ReturnType<typeof createLamps> | null;
  readonly shafts: ReturnType<typeof createSunShafts>;
  dispose(): void;
}

/** A gobo window candidate: the layout window plus its clip room; the skylight is a horizontal one. */
interface WindowCand extends Omit<WindowRect, 'kind'> {
  kind?: string;
  /** the window's room rect [x0, z0, x1, z1] */
  clip: readonly number[];
  sky?: boolean;
}

interface SkyStops<T> { top: T; horizon: T; away: T }

const SKY: PerPhase<SkyStops<string>> = {
  day: { top: '#6FA8D8', horizon: '#F6DDBF', away: '#F6DDBF' },
  // m175 fix r2: golden = a peach sunward horizon glow over a dusk-rose zenith (the frosted skylight reads peach), and a
  // lilac horizon away from the sun: north / east windows no longer show a flat peach band behind the Clawds standing
  // at them (mezzanine, bays), which failed hueGapCheck at 18 h, and a sky that glows only toward the sun reads as dusk
  golden: { top: '#D9A0A6', horizon: '#FFC48A', away: '#BFB2D9' },
  night: { top: '#141B36', horizon: '#34385E', away: '#34385E' },
};
/** RND fix r1: the morning sky (6–9 h, lightMath morningWeight): pale washed blue over a pale haze, not a second sunset. */
const SKY_MORNING = { top: '#9DC0E0', horizon: '#EAE6DE', away: '#DCE3EC' };
/** m2 fix r2: SKY pre-converted to linear once (was 9 hex parses + arrays per frame). */
const skyLin = (v: SkyStops<string>): SkyStops<Rgb> => ({ top: lin(v.top), horizon: lin(v.horizon), away: lin(v.away) });
const SKY_LIN: PerPhase<SkyStops<Rgb>> = { day: skyLin(SKY.day), golden: skyLin(SKY.golden), night: skyLin(SKY.night) };
const SKY_MORNING_LIN = { top: lin(SKY_MORNING.top), horizon: lin(SKY_MORNING.horizon), away: lin(SKY_MORNING.away) };
const PHASES: readonly Phase[] = ['day', 'golden', 'night'];
const CHANNELS = ['r', 'g', 'b'] as const;
/** Recompute the lighting state only when the clock moves this far (h; 30 s of real clock) or the tier changes. */
const HOUR_EPS = 1 / 120;

export function createLights(scene: THREE.Scene, o: { layout?: Layout | null } = {}): Lights {
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.name = 'studioKey';
  key.layers.enableAll(); // collected by every pass (RenderPass and CharPass use different camera masks)
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 2.5;
  const cam = key.shadow.camera;
  cam.left = -BOX / 2; cam.right = BOX / 2; cam.top = BOX / 2; cam.bottom = -BOX / 2;
  cam.near = 0.5; cam.far = 60;
  cam.layers.mask = MASK.shadow;
  scene.add(key, key.target);
  scene.background = new THREE.Color(ENV.skyHorizon).multiplyScalar(0.3);

  let layout: Layout | null = o.layout ?? null;
  let lamps = layout ? createLamps(layout) : null;
  let tier: Tier | null = null;
  const grade = createZoneGrade();
  const skyTmp = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  const dirV = new THREE.Vector3(...KEY_DIR);
  const lsBasis = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), dirV.clone().negate(), new THREE.Vector3(0, 1, 0));
  const lsInv = lsBasis.clone().invert();
  const tmp = new THREE.Vector3();
  // m2 fix r2 (perf): one lighting state, rewritten in place (lightMath.lightingInto) only when the hour moves
  const Lstate = createLightingState();
  const goboDir: Rgb = [0, 0, 0];
  const goboArr: Rgb = [0, 0, 0];
  let litHour = NaN, litTier: Tier | null = null;

  // ---- window gobo (§5.6): per vis cell, the ≤ 4 (Medium) / ≤ 8 (High) windows the sun can shine through, nearest
  // the camera first, each clipped to its own room so a beam never crosses an interior wall. The atrium skylight is a
  // horizontal window (normal −y). Re-picked 4×/s (cheap: ~40 candidates).
  let winCands: WindowCand[] = [];
  const buildWindowCands = (l: Layout | null) => {
    const zoneRect = (id: string | null | undefined) => l?.zones?.find((z) => z.id === id)?.rect ?? null;
    const cands: WindowCand[] = [];
    for (const w of l?.windows ?? []) {
      const r = zoneRect(w.zone);
      if (!r) continue;
      cands.push({ ...w, clip: r });
    }
    const sk = l?.skylight;
    if (sk) {
      const [x0, z0, x1, z1] = sk.rect;
      const atr = zoneRect('ATR') ?? [x0 - 7, z0 - 7, x1 + 7, z1 + 7];
      cands.push({ center: { x: (x0 + x1) / 2, y: sk.y, z: (z0 + z1) / 2 }, normal: { x: 0, y: -1, z: 0 }, w: x1 - x0, h: z1 - z0, zone: 'ATR', kind: 'skylight', clip: atr, sky: true });
    }
    winCands = cands;
  };
  buildWindowCands(layout);
  let winClock = -1, winKey = '';
  /** the gobo's lit apertures this tick (sun shafts follow them) */
  let chosen: WindowCand[] = [];
  const shafts = createSunShafts(scene); // RND fix r1: golden / morning light shafts under the skylight and lit windows
  const pickWindows = (ctx: Ctx, sunDir: readonly number[], max: number) => {
    const cam = ctx.camera.position;
    const cell = layout?.visCells?.find((c) => c.id === ctx.camZone);
    const vis = cell ? new Set<string | null | undefined>(cell.visible) : null; // (a window may have no zone)
    const lit = winCands.filter((w) => (sunDir[0] * w.normal.x + sunDir[1] * w.normal.y + sunDir[2] * w.normal.z) < -0.05
      && (!vis || vis.has(w.zone) || (w.sky && (vis.has('ATR') || vis.has('PIT')))));
    const d2 = (w: WindowCand) => (w.center.x - cam.x) ** 2 + (w.center.z - cam.z) ** 2 - (w.sky ? 400 : 0); // the skylight always wins a slot
    lit.sort((a, b) => d2(a) - d2(b));
    const ws = sunDir[1] > 0.02 ? lit.slice(0, max) : [];
    chosen = ws;
    const key = ws.map((w) => `${w.center.x},${w.center.z}`).join('|');
    if (key === winKey) return;
    winKey = key;
    U.uWinCount.value = ws.length;
    ws.forEach((w, i) => {
      U.uWinA.value[i].set(w.center.x, w.center.y, w.center.z, w.w / 2);
      U.uWinB.value[i].set(w.normal.x, w.normal.y, w.normal.z, w.h / 2);
      const [x0, z0, x1, z1] = w.clip;
      U.uWinC.value[i].set(Math.min(x0, x1) - 0.05, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, Math.max(z0, z1) + 0.05);
    });
  };

  // m2 fix r3: `__hq.stats().lamps` = pool anchors (layout + adopted fixtures) and the slots in use
  hqStatSection('lamps', () => lamps?.stats?.() ?? null);
  Object.assign(globalThis, { __hqLamps: () => lamps }); // debug handle (devtools / review): __hqLamps().fixtures()
  const self: Lights = {
    key,
    state: null,
    get lamps() { return lamps; },
    update(ctx: Ctx) {
      if (ctx.layout && ctx.layout !== layout) { layout = ctx.layout; lamps = createLamps(layout); buildWindowCands(layout); winKey = '?'; }
      // quality → shadow map size (low: blob shadows only)
      const t = ctx.quality?.tier ?? 'medium';
      if (t !== tier) {
        tier = t;
        const size = SHADOW_SIZE[t] ?? 1024;
        key.castShadow = size > 0;
        if (size > 0 && key.shadow.mapSize.x !== size) {
          key.shadow.mapSize.set(size, size);
          key.shadow.map?.dispose(); key.shadow.map = null;
        }
        U.uGobo.value = t === 'low' ? 0 : 1;
      }
      const hour = ctx.hour ?? 13;
      const L = Lstate;
      const w = L.weights;
      if (!(Math.abs(hour - litHour) <= HOUR_EPS) || tier !== litTier) {
        litHour = hour; litTier = tier;
        lightingInto(L, hour);
        self.state = L;
        // kPts (night ≤ 0.12) is the budget of the ≤ 2 pooled point lights; until those land (M2, BRN/FX blocked lamp)
        // it is spent as a uniform practical fill so the character gain sum still reaches the §5.0 total (1.0)
        // (the night pool boost is env-only: characters keep 100% pools, so clay never blows out beside a lamp)
        // RND fix r2: .z = the characters' softened hour exposure (lightMath charExposure; toon.ts HQ_CHAR only,
        // props take the env exposure through uEnvTint)
        U.uGainChar.value.set(L.char.kKey, L.char.kAmb + L.char.kPts, L.charExposure, Math.min(1, L.lampScale));
        U.uGainEnv.value.set(L.env.kKey, L.env.kAmb, L.env.kSun, L.lampScale);
        U.uLampPhase.value = Math.min(1, Math.max(0, (L.lampScale - LAMP_SCALE.day) / (LAMP_SCALE.night - LAMP_SCALE.day)));
        setRGB(U.uKeyCol.value, L.keyCol);
        setRGB(U.uSky.value, L.sky);
        setRGB(U.uGround.value, L.ground);
        setRGB(U.uEnvGround.value, L.envGround);
        setRGB(U.uEnvSky.value, L.envSky);
        setRGB(U.uShadowTint.value, L.shadowTint);
        setRGB(U.uEnvTint.value, L.envTint);
        U.uEnvTint.value.multiplyScalar(L.exposure); // RND fix r1: hour exposure of env / prop base light (lightMath EXPOSURE_KEYS)
        U.uSunDir.value.fromArray(L.sunDir);
        U.uGoboSkyDir.value.fromArray(goboSkyDirInto(goboDir, L.sunDir));
        // the golden patch boost is the evening's; the morning sun lays paler, moderate patches (RND fix r1)
        const eve = w.golden * (1 - L.morning);
        U.uSunPatch.value = SUN_PATCH + (SUN_PATCH_GOLDEN - SUN_PATCH) * eve + (SUN_PATCH_MORNING - SUN_PATCH) * w.golden * L.morning;
        U.uPatchCap.value.set(PATCH_CAP.day + (PATCH_CAP.golden - PATCH_CAP.day) * eve, PATCH_CAP.dayLift + (PATCH_CAP.goldenLift - PATCH_CAP.dayLift) * eve);
        setRGB(U.uSunCol.value, L.sunCol);
        // sky gradient (linear), blended by phase weights
        skyTmp[0].setRGB(0, 0, 0); skyTmp[1].setRGB(0, 0, 0); skyTmp[2].setRGB(0, 0, 0);
        for (const p of PHASES) {
          const k = w[p], S = SKY_LIN[p], a = S.top, b = S.horizon, c = S.away;
          skyTmp[0].r += a[0] * k; skyTmp[0].g += a[1] * k; skyTmp[0].b += a[2] * k;
          skyTmp[1].r += b[0] * k; skyTmp[1].g += b[1] * k; skyTmp[1].b += b[2] * k;
          skyTmp[2].r += c[0] * k; skyTmp[2].g += c[1] * k; skyTmp[2].b += c[2] * k;
        }
        if (L.morning > 0) {
          const m = L.morning, S = SKY_MORNING_LIN;
          for (let i = 0; i < 3; i++) {
            const t = CHANNELS[i];
            skyTmp[0][t] += (S.top[i] - skyTmp[0][t]) * m; skyTmp[1][t] += (S.horizon[i] - skyTmp[1][t]) * m; skyTmp[2][t] += (S.away[i] - skyTmp[2][t]) * m;
          }
        }
        U.uSkyHorizonAway.value.copy(skyTmp[2]);
        U.uSkyTop.value.copy(skyTmp[0]);
        U.uSkyHorizon.value.copy(skyTmp[1]);
        U.uNight.value = w.night;
        U.uGolden.value = w.golden * (1 - L.morning); // evening only: the morning windows / scenery stay pale (RND fix r1)
      }
      winClock -= ctx.rawDt ?? 0.016;
      if (winClock <= 0) {
        winClock = 0.25;
        pickWindows(ctx, L.sunDir, tier === 'high' || tier === 'photo' ? MAX_WINDOWS : 4);
        shafts.update({ windows: chosen, sunDir: L.sunDir, skyDir: U.uGoboSkyDir.value.toArray(goboArr), evening: w.golden * (1 - L.morning), morning: L.morning, on: tier !== 'low' });
      }
      U.uTime.value = ctx.time ?? 0;
      // fix r1: grazing views up through the skylight (spawn) miss the 18 m sky plane above it and saw the constant
      // beige clear colour, a flat pale slab even at 22 h. The clear colour follows the sky's zenith instead
      // (sky.ts darkens the zenith to 0.5 × top at night). Per frame (cheap, no allocation): debug sheets swap it
      if (scene.background instanceof THREE.Color) scene.background.copy(skyTmp[0]).multiplyScalar(1 - 0.5 * w.night);
      grade.setLayout(layout);
      grade.update(ctx, w.night);

      // shadow box follows the camera focus (a few metres ahead), snapped to shadow texels in light space
      const c = ctx.camera;
      c.getWorldDirection(tmp);
      tmp.y = 0; tmp.normalize().multiplyScalar(4).add(c.position); tmp.y = 0;
      // m2 fix r1: snapped to 64-texel steps (1.5 m at 1024²), not 1 texel. The env casters live in a cached static
      // shadow layer (post.ts createShadowCache) that re-renders only when this box moves, so walking re-bakes it a
      // couple of times a second instead of every frame; a whole-texel step keeps the snap swim-free as before
      const texel = BOX / Math.max(1, key.shadow.mapSize.x);
      const step = texel * Math.max(1, Math.round(SNAP_M / texel));
      tmp.applyMatrix4(lsInv);
      tmp.x = Math.round(tmp.x / step) * step; tmp.y = Math.round(tmp.y / step) * step; tmp.z = Math.round(tmp.z / step) * step; // (depth too: the key must not move between steps)
      tmp.applyMatrix4(lsBasis);
      key.target.position.copy(tmp);
      key.position.copy(tmp).addScaledVector(dirV, 30);
      key.target.updateMatrixWorld();
      key.updateMatrixWorld();

      lamps?.update(ctx);
    },
    dispose() { scene.remove(key, key.target); key.dispose(); shafts.dispose(); },
    get shafts() { return shafts; },
  };
  return self;
}

export { LAYERS };
