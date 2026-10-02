/**
 * Sky + light: the real-clock day/night cycle (hour, season, weather from `ctx.valley.sky`), the sky dome with sun,
 * moon (real phase), stars and rainbow, drifting low-poly clouds, the one shadow-casting key light (sun by day,
 * moonlight by night; its shadow camera follows the player with texel snapping), the hemisphere fill, fog matched to
 * the horizon. Publishes `ctx.lighting` every frame and the 'wind' service. Weather changes ease in.
 * Also decides the light-and-air moments: mist banks (dawn over the water and low ground, burning off by
 * mid-morning, a few mornings a week; all day in fog) and god rays (a low sun through trees and cloud gaps), and
 * publishes the dev service 'atmosphere' (`__valley.atmo(…)` forces any moment).
 */
import * as THREE from 'three';
import type { SystemFactory } from '../context.ts';
import type { WeatherKind } from '../../model/types.ts';
import { atmoOf, clamp01, ease, smooth } from './atmo.ts';
import type { Atmo } from './atmo.ts';
import { arcDir, dayAngle, moonPhase, peakElevation } from './celestial.ts';
import { createMix, samplePalette } from './palette.ts';
import { createDome } from './dome.ts';
import { createClouds } from './clouds.ts';
import { createWind } from './wind.ts';
import { createMeteors, showerOn } from './meteors.ts';
import type { AudioService, IndoorSpace } from '../context.ts';
import { sunTimes } from '../../model/sky.ts';
import { hash32 } from '../../../../../shared/identity.ts';
import { VL_KEY } from '../lights/shader.ts';

/** dev service 'atmosphere': force the weather moments (null = follow the weather) */
export interface AtmosphereService {
  force(o: Partial<Atmo['force']>): Atmo['force'];
  state(): { rainbow: number; banks: number; rays: number; wet: number; snow: number; frost: number; mist: number; sun: number[] };
}

const SHADOW_SPAN = 72;
const NIGHT_DIR = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
const OVERCAST_GREY = new THREE.Color(0x9aa4ae);
const FOG_GREY = new THREE.Color(0xc4cad0);
const SNOW_GREY = new THREE.Color(0xd6dde6);
const STORM_GREY = new THREE.Color(0x4a5260);
/** indoors (the farmhouse): what the open-sky fill turns into under a roof — warm bounce off plaster and planks */
const ROOM_SKY = new THREE.Color(0xd8c4a8), ROOM_GROUND = new THREE.Color(0x8a5a3a);

interface WeatherTarget { overcast: number; rain: number; snow: number; storm: number; fog: number }
const target = (kind: WeatherKind, k: number, clouds: number): WeatherTarget => ({
  overcast: kind === 'clear' ? 0 : clamp01((clouds - 0.15) / 0.6),
  rain: kind === 'rain' || kind === 'storm' ? 0.35 + 0.65 * k : 0,
  snow: kind === 'snow' ? 0.35 + 0.65 * k : 0,
  storm: kind === 'storm' ? 0.5 + 0.5 * k : 0,
  fog: kind === 'fog' ? 0.55 + 0.45 * k : 0,
});

export const skySystem: SystemFactory = (ctx) => {
  const a = atmoOf(ctx);
  const L = ctx.lighting;
  const renderer = ctx.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is gone in r18x; PCF + radius is the soft path

  const wind = createWind(a);
  ctx.services.set('wind', wind);
  const atmosphere: AtmosphereService = {
    force(o) { Object.assign(a.force, o); a.snap = true; return { ...a.force }; },
    state: () => ({ rainbow: a.rainbow, banks: a.banks, rays: a.rays, wet: a.ground.wet, snow: a.ground.snow, frost: a.ground.frost, mist: a.mist, sun: a.sun.toArray().map((v) => +v.toFixed(3)) }),
  };
  ctx.services.set('atmosphere', atmosphere);
  // dev: GPU cost of the whole frame (scene + post) right now, synced with a 1-px readback: __atmo.bench(30)
  (globalThis as { __atmo?: unknown }).__atmo = {
    service: atmosphere,
    /** GPU ms per frame (timer query; falls back to a synced wall clock) */
    async bench(n = 20): Promise<number> {
      const post = ctx.services.get('post') as { render(): void } | undefined;
      if (!post) return -1;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
      if (!ext) return -1;
      const q = gl.createQuery()!;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      for (let i = 0; i < n; i++) post.render();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 10));
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      }
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      return ns / 1e6 / n;
    },
  };

  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.name = 'key-light';
  key.castShadow = true;
  const sz = ctx.quality === 'low' ? 1024 : 2048;
  key.shadow.mapSize.set(sz, sz);
  const sc = key.shadow.camera;
  sc.left = -SHADOW_SPAN / 2; sc.right = SHADOW_SPAN / 2; sc.top = SHADOW_SPAN / 2; sc.bottom = -SHADOW_SPAN / 2;
  sc.near = 1; sc.far = 320;
  sc.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.035;
  key.shadow.radius = ctx.quality === 'low' ? 1 : 2.5;
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x6a7a3a, 1.3);
  hemi.name = 'hemi-light';
  const dome = createDome();
  const clouds = createClouds();
  ctx.scene.add(key, key.target, hemi, dome.mesh, clouds.mesh);
  ctx.scene.background = null;
  const fog = new THREE.Fog(0xcfe6f0, 40, 420);
  ctx.scene.fog = fog;

  const mix = createMix();
  const meteors = createMeteors();
  ctx.scene.add(meteors.mesh);
  ctx.services.set('meteors', meteors);
  let wishAt = -1e9;
  const sunTmp = { x: 0, y: 0, z: 0 };
  const keyDir = new THREE.Vector3(), nightDir = new THREE.Vector3(), moonLight = new THREE.Vector3();
  const center = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), camPos = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
  let first = true;
  let wet = 0;
  let windAngle = 0;
  let mistDoy = -1, mistDayK = 1, mistTimes = sunTimes(0);

  const greyOf = (c: THREE.Color, grey: THREE.Color, k: number, keepLum = 1) => {
    const lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const gl = grey.r * 0.2126 + grey.g * 0.7152 + grey.b * 0.0722;
    tmpC2.copy(grey).multiplyScalar(((lum / gl) * keepLum) + (1 - keepLum));
    c.lerp(tmpC2, k);
  };

  return {
    name: 'sky',
    update(f) {
      const sky = ctx.valley.sky;
      const w = sky.weather;
      const dt = first ? 1000 : f.dt;
      a.time = f.time;

      // --- eased weather channels
      const t = target(w.kind, w.intensity, w.clouds);
      a.overcast = ease(a.overcast, t.overcast, dt, 7);
      a.rain = ease(a.rain, t.rain, dt, 6);
      a.snow = ease(a.snow, t.snow, dt, 8);
      a.storm = ease(a.storm, t.storm, dt, 6);
      a.fog = ease(a.fog, t.fog, dt, 9);
      a.cover = ease(a.cover, w.clouds, dt, 10);
      // wetness soaks in quickly and dries slowly
      const wetT = Math.max(a.rain, a.snow * 0.5);
      wet = wetT > wet ? ease(wet, wetT, dt, 8) : ease(wet, wetT, dt, 90);
      if (first) wet = wetT;
      a.windSpeed = ease(a.windSpeed, w.wind, dt, 5);
      let dA = w.windDir - windAngle;
      dA = Math.atan2(Math.sin(dA), Math.cos(dA));
      windAngle = first ? w.windDir : windAngle + dA * (1 - Math.exp(-dt / 6));
      a.windDir.set(Math.cos(windAngle), Math.sin(windAngle));
      wind.update(f.time);
      first = false;

      // --- palette + celestial bodies
      samplePalette(sky.hour, sky.dayOfYear, mix);
      const peak = peakElevation(sky.dayOfYear);
      const phi = dayAngle(sky.hour, sky.dayOfYear);
      arcDir(phi, peak, sunTmp);
      a.sun.set(sunTmp.x, sunTmp.y, sunTmp.z);
      a.sunElev = a.sun.y;
      a.moonPhase = moonPhase(f.now || Date.now());
      arcDir(phi - a.moonPhase * Math.PI * 2, peak * 0.92, sunTmp);
      a.moon.set(sunTmp.x, sunTmp.y, sunTmp.z);
      a.daylight = sky.daylight;
      a.night = mix.night;

      // --- weather grading of the palette
      const oc = a.overcast, rn = a.rain, st = a.storm, sn = a.snow, fg = a.fog;
      const gloom = clamp01(oc * 0.55 + rn * 0.3 + st * 0.35);
      for (const c of [mix.zenith, mix.horizon, mix.hemiSky]) greyOf(c, OVERCAST_GREY, oc * 0.92, 1);
      greyOf(mix.zenith, STORM_GREY, st * 0.6, 0.6);
      greyOf(mix.horizon, STORM_GREY, st * 0.4, 0.6);
      const darken = 1 - rn * 0.28 - st * 0.25;
      mix.zenith.multiplyScalar(darken);
      mix.horizon.multiplyScalar(1 - rn * 0.18 - st * 0.2);
      greyOf(mix.horizon, SNOW_GREY, sn * 0.7, 0.75);
      greyOf(mix.zenith, SNOW_GREY, sn * 0.55, 0.75);
      greyOf(mix.horizon, FOG_GREY, fg * 0.85, 0.7);
      greyOf(mix.zenith, FOG_GREY, fg * 0.6, 0.7);
      mix.glow.lerp(mix.horizon, clamp01(oc * 0.8 + fg * 0.6 + sn * 0.5));
      mix.stars *= 1 - clamp01(oc * 1.1 + fg);

      // --- key light: the sun by day, moonlight by night, with a dip at the handover so the direction never pops
      const sunW = smooth(-0.1, 0.04, a.sunElev);
      moonLight.copy(a.moon);
      moonLight.y = Math.max(moonLight.y, 0.36);   // a low moon: shadows at most ~2.5× their caster's height
      moonLight.normalize();
      nightDir.copy(NIGHT_DIR).lerp(moonLight, smooth(0.05, 0.35, a.moon.y) * 0.8).normalize();
      if (sunW >= 0.5) { keyDir.copy(a.sun); keyDir.y = Math.max(keyDir.y, 0.2); keyDir.normalize(); } else keyDir.copy(nightDir);
      const handover = smooth(0, 0.35, Math.abs(sunW - 0.5));
      // under the moon, cast shadows fade out on faces it only grazes (scene/lights/shader.ts vlShadowMix)
      VL_KEY[0] = 1 - sunW;
      const moonBright = 0.55 + 0.45 * Math.sin(a.moonPhase * Math.PI); // fuller moon, brighter night
      let keyI = mix.keyI * handover * (sunW < 0.5 ? moonBright : 1);
      keyI *= 1 - clamp01(oc * 0.62 + rn * 0.18 + st * 0.15 + fg * 0.35 + sn * 0.2);
      let hemiI = mix.hemiI * (1 + oc * 0.12 - st * 0.18);
      // lightning lights the whole valley
      hemiI += a.flash * 3.5;
      key.color.copy(mix.key);
      key.intensity = keyI;
      hemi.color.copy(mix.hemiSky);
      hemi.groundColor.copy(mix.hemiGround);
      if (sky.season === 'winter') hemi.groundColor.lerp(tmpC.setHex(0x9aa6b8), 0.35);
      hemi.intensity = hemiI;
      // under a roof (scene/interior): only the windows' share of the sky reaches in, bounced warm off the room
      const room = ctx.services.get('indoors') as IndoorSpace | undefined;
      if (room?.active) {
        // a room may ask for its own fill (the grotto: a cool trickle from its mouth, rock all round)
        const rl = room.light;
        hemi.intensity = hemiI * (rl ? rl.sky : 0.62);
        hemi.color.lerp(rl ? tmpC.setHex(rl.skyTint) : ROOM_SKY, 0.35);
        hemi.groundColor.lerp(rl ? tmpC.setHex(rl.groundTint) : ROOM_GROUND, 0.6);
        // …and may shut the key light out entirely (deep in rock)
        if (rl?.sun !== undefined) key.intensity = keyI * rl.sun;
      }

      // shadow camera: centred a little ahead of the player, snapped to shadow texels in light space (no shimmer)
      const p = ctx.player.pos;
      center.set(p.x - Math.sin(ctx.player.yaw) * 14, p.y, p.z - Math.cos(ctx.player.yaw) * 14);
      right.crossVectors(Y, keyDir).normalize();
      up.crossVectors(keyDir, right);
      const texel = SHADOW_SPAN / key.shadow.mapSize.x;
      const u = Math.round(center.dot(right) / texel) * texel;
      const v = Math.round(center.dot(up) / texel) * texel;
      const d = center.dot(keyDir);
      center.copy(right).multiplyScalar(u).addScaledVector(up, v).addScaledVector(keyDir, d);
      key.target.position.copy(center);
      key.position.copy(center).addScaledVector(keyDir, 150);
      key.target.updateMatrixWorld();

      // --- fog: horizon-matched, closer in weather
      tmpC.copy(mix.horizon).lerp(mix.glow, 0.12 * sunW).lerp(mix.zenith, 0.12);
      { const l = tmpC.r * 0.2126 + tmpC.g * 0.7152 + tmpC.b * 0.0722; tmpC.lerp(tmpC2.setRGB(l, l, l), 0.28); }
      fog.color.copy(tmpC);
      let near = 45, far = 440;
      near = near * (1 - rn * 0.75 - sn * 0.8 - fg * 0.95) ;
      far = far * (1 - oc * 0.15 - rn * 0.45 - st * 0.1 - sn * 0.5 - fg * 0.84);
      fog.near = Math.max(0, near);
      fog.far = Math.max(60, far);

      // --- dome
      ctx.camera.getWorldPosition(camPos);
      dome.mesh.position.copy(camPos);
      const du = dome.u;
      a.zenith.copy(mix.zenith);
      a.horizon.copy(mix.horizon);
      a.glow.copy(mix.glow);
      du.uZenith.value.copy(mix.zenith);
      du.uHorizon.value.copy(mix.horizon);
      du.uGround.value.copy(fog.color).lerp(mix.hemiGround, 0.25);
      du.uGlow.value.copy(mix.glow);
      du.uSunColor.value.copy(mix.key).lerp(tmpC.setRGB(1, 0.95, 0.85), 0.4);
      du.uSunDir.value.copy(a.sun);
      du.uMoonDir.value.copy(a.moon);
      du.uAntiSun.value.set(-a.sun.x, Math.max(-a.sun.y, -0.36), -a.sun.z).normalize();
      du.uSunVis.value = smooth(-0.2, 0.02, a.sunElev) * (1 - clamp01(oc * 0.7 + fg * 0.8 + sn * 0.5));
      du.uMoonVis.value = (1 - clamp01(oc * 1.2 + fg * 1.2 + sn)) * (0.25 + 0.75 * mix.night);
      du.uMoonPhase.value = a.moonPhase;
      du.uStars.value = mix.stars;
      du.uTime.value = f.time;
      du.uStarAngle.value = (sky.hour / 24) * Math.PI * 2;
      du.uRainbow.value = a.rainbow;
      du.uOvercast.value = clamp01(oc + fg);
      du.uDeck.value = clamp01(oc * 1.05 + sn * 0.3);
      du.uDeckOffset.value.set(a.cloudOffset.x * 0.0022, a.cloudOffset.y * 0.0022);
      du.uDeckLit.value.copy(mix.horizon).lerp(mix.zenith, 0.25).multiplyScalar(1.05 - st * 0.3);
      du.uDeckShade.value.copy(mix.hemiSky).multiplyScalar(0.55 * (1 - st * 0.45) * (1 - mix.night * 0.5)).lerp(mix.zenith, 0.35);
      du.uFlash.value = a.flash;

      // --- shooting stars (clear nights; showers on their real peak nights)
      const starVis = mix.stars * (1 - clamp01(oc * 1.3 + fg * 1.5 + sn + rn));
      const seen = meteors.update(f.dt, ctx.camera, starVis, sky.dayOfYear);
      if (seen && f.time - wishAt > 600) {
        wishAt = f.time;
        const sh = showerOn(sky.dayOfYear);
        (ctx.services.get('audio') as AudioService | undefined)?.play('sparkle', { volume: 0.35 });
        ctx.ui.say(sh ? `The ${sh.name} are falling tonight. Make a wish! ✨` : 'A shooting star! Make a wish. ✨');
      }

      // --- clouds
      a.cloudOffset.x += a.windDir.x * (a.windSpeed * 1.6 + 1.5) * f.dt;
      a.cloudOffset.y += a.windDir.y * (a.windSpeed * 1.6 + 1.5) * f.dt;
      const cu = clouds.u;
      cu.uDrift.value.copy(a.cloudOffset);
      cu.uCam.value.copy(camPos);
      cu.uCover.value = 0.14 + a.cover * 0.86;
      cu.uTime.value = f.time;
      cu.uSunDir.value.copy(sunW >= 0.5 ? a.sun : a.moon);
      const lightK = 0.18 + 0.82 * clamp01(mix.keyI / 3.2);
      cu.uLit.value.copy(mix.key).lerp(tmpC.setRGB(1, 1, 1), 0.55 * sunW).multiplyScalar(lightK * (1 - gloom * 0.55) * 1.15 * (1 - mix.night * 0.75));
      cu.uLit.value.lerp(mix.horizon, 0.15 + oc * 0.25);
      cu.uShade.value.copy(mix.hemiSky).multiplyScalar(0.62 * (1 - gloom * 0.5) * (1 - mix.night * 0.6)).lerp(mix.zenith, 0.3);
      if (mix.night > 0.5) cu.uShade.value.lerp(mix.zenith, 0.4);
      cu.uHorizon.value.copy(mix.horizon);
      cu.uRim.value.copy(mix.glow).multiplyScalar(sunW * (1 - gloom));
      cu.uFlash.value = a.flash;

      // --- publish lighting
      L.sunDir.copy(keyDir);
      L.sunColor.copy(mix.key);
      L.sunIntensity = keyI;
      L.skyColor.copy(mix.hemiSky);
      L.groundColor.copy(hemi.groundColor);
      L.fogColor.copy(fog.color);
      L.fogNear = fog.near;
      L.fogFar = fog.far;
      // lamps come on for gloomy weather too
      L.night = clamp01(Math.max(mix.night, gloom * 0.55 + fg * 0.3));
      L.wet = wet;
      L.wind.x = a.windDir.x * a.windSpeed * a.gust;
      L.wind.z = a.windDir.y * a.windSpeed * a.gust;

      // --- grade for post
      const g = a.grade;
      g.exposure = mix.exposure * (1 + a.flash * 0.6);
      g.gain.copy(mix.gain).lerp(tmpC.setRGB(0.97, 1.0, 1.05), gloom * 0.6);
      g.shadowTint.copy(mix.shade);
      g.saturation = mix.sat * (1 - gloom * 0.28 - fg * 0.2 - sn * 0.12);
      g.contrast = mix.contrast * (1 - fg * 0.08);
      g.vignette = 0.22 + mix.night * 0.12;
      // only true light sources halo: the threshold stays above anything lamp-lit (lit pools peak ≈ 0.8), so lamp glass,
      // window cores, fire and the moon bloom, softly; by day only the sun disk and specular glints reach it
      g.bloomThreshold = 1.4 - mix.night * 0.4;
      g.bloomStrength = (0.5 + mix.bloom * 0.35) * (1 - mix.night * 0.3);
      g.ink.setHex(0x3a2a22).multiplyScalar(1 - mix.night * 0.3);
      g.inkStrength = 0.75 - mix.night * 0.2 - fg * 0.3;
      a.mist = Math.min(2, mix.mist * (sky.season === 'summer' ? 0.6 : 1) * (0.5 + 0.5 * clamp01(wet + fg + oc * 0.5)) + fg * 1.6 + rn * 0.25);
      a.cloudShadow = clamp01(sky.daylight * (1 - oc) * smooth(0.08, 0.35, a.cover) * 0.8);

      // --- mist banks: pooling over the water and low ground at dawn, burning off by mid-morning; all day in fog
      {
        if (sky.dayOfYear !== mistDoy) { mistDoy = sky.dayOfYear; mistTimes = sunTimes(mistDoy); mistDayK = 0.35 + 0.65 * ((hash32(`mist:${mistDoy}`) % 1000) / 1000); }
        const tm = mistTimes, hr = sky.hour;
        const dawn = smooth(tm.rise - 2.5, tm.rise + 0.3, hr) * (1 - smooth(tm.rise + 1.4, tm.rise + 3.6, hr));
        const night = Math.max(1 - smooth(tm.rise - 3, tm.rise - 1.5, hr), smooth(tm.set + 0.8, tm.set + 3, hr)) * 0.35;
        const seasonK = sky.season === 'autumn' ? 1 : sky.season === 'spring' ? 0.85 : sky.season === 'winter' ? 0.7 : 0.55;
        // not every morning: a few days a week, deterministic per date (mistDayK)
        const dayK = mistDayK;
        const damp = 0.55 + 0.45 * clamp01(sky.trace.wet * 1.5);
        const calm = 1 - smooth(3.5, 8, a.windSpeed);
        const base = Math.max(dawn * dayK, night) * seasonK * damp * calm * (1 - rn);
        const bankT = a.force.banks ?? Math.max(base, fg * 0.85);
        a.banks = ease(a.banks, bankT, a.snap ? 1000 : dt, 10);
      }
      // --- god rays: a low sun (golden hour, early morning) through trees and gaps in the clouds; after storms too
      {
        const low = smooth(-0.02, 0.06, a.sunElev) * (1 - smooth(0.22, 0.5, a.sunElev));
        const broken = 0.55 + 0.45 * smooth(0.15, 0.6, a.cover) * (1 - smooth(0.85, 1, a.cover));
        const raysT = a.force.rays ?? low * broken * (1 - fg) * (1 - rn * 0.85) * (1 - clamp01(oc - 0.6) * 2) * (1 - sn * 0.8);
        a.rays = ease(a.rays, raysT, a.snap ? 1000 : dt, 4);
      }
      // no cloud shadows or valley mist drifting through the farmhouse
      if (room?.active) { a.cloudShadow = 0; a.mist = 0; a.banks = 0; a.rays = 0; g.vignette += 0.06; }
    },
    stats: () => ({ hour: +ctx.valley.sky.hour.toFixed(2), moon: +a.moonPhase.toFixed(2), sunI: +key.intensity.toFixed(2), night: +L.night.toFixed(2) }),
    dispose() {
      ctx.scene.remove(key, key.target, hemi, dome.mesh, clouds.mesh);
      key.dispose(); hemi.dispose();
      dome.mesh.geometry.dispose(); (dome.mesh.material as THREE.Material).dispose();
      clouds.mesh.geometry.dispose(); (clouds.mesh.material as THREE.Material).dispose();
      ctx.services.delete('wind');
      ctx.services.delete('atmosphere');
      ctx.services.delete('meteors');
      meteors.dispose();
    },
  };
};
