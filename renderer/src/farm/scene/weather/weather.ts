/**
 * Weather: rain streaks + ground/water ripples, storms (heavier rain, lightning that lights the valley, distant
 * bolts, thunder), drifting snow, falling leaves (autumn) / petals (spring) in the wind, and glinting motes in the sun
 * on clear days. Intensities come from the eased atmosphere state the sky system maintains, so every change eases in.
 *
 * Weather moments driven by the model's weather trace (`sky.trace`, model/sky.ts): the ground stays wet and puddled
 * for hours after a real shower and lying snow builds through a snowy morning (both drawn on every toon surface by
 * surfaces.ts through the shared `VW` uniform block written here), frost on cold clear nights and mornings, and the
 * rainbow in the first hour after a shower stops while the sun is out.
 *
 * Dev: `__valley.atmo({ wet, snow, frost, rainbow })`, `__valley.debug('rainbow', true)` forces the rainbow,
 * `__valley.debug('lightning', true)` strikes once.
 */
import * as THREE from 'three';
import type { SystemFactory } from '../context.ts';
import { atmoOf, clamp01, ease, smooth } from '../sky/atmo.ts';
import { createField } from './particles.ts';
import { createRipples } from './ripples.ts';
import { createLightning } from './lightning.ts';
import { PAL } from '../toon.ts';
import { VW, setWeatherSurfaceQuality } from './surfaces.ts';
import { sunTimes } from '../../model/sky.ts';
import type { IndoorSpace } from '../context.ts';

const LEAF_COLORS = [PAL.leafAutumn, PAL.leafAutumn2, 0xe8b640, 0xb8562e];
const PETAL_COLORS = [0xf7c6d6, 0xfbe3ea, 0xf09ab8, 0xffffff];

export const weatherSystem: SystemFactory = (ctx) => {
  const a = atmoOf(ctx);
  const low = ctx.quality === 'low';
  // before any program compiles (no system renders while the systems are created)
  setWeatherSurfaceQuality(ctx.quality);
  const scale = low ? 0.45 : ctx.quality === 'medium' ? 0.75 : 1;
  const rain = createField('rain', Math.round(14000 * scale), [32, 20, 32], 'rain');
  const snow = createField('snow', Math.round(16000 * scale), [50, 22, 50], 'snow');
  const leaves = createField('leaf', 90, [44, 16, 44], 'leaves');
  const motes = createField('mote', Math.round(320 * scale), [22, 9, 22], 'motes');
  const ripples = createRipples(ctx, low ? 60 : 140);
  const lightning = createLightning(ctx);
  const group = new THREE.Group();
  group.name = 'weather';
  group.add(rain.mesh, snow.mesh, leaves.mesh, motes.mesh, ripples.mesh, lightning.mesh);
  ctx.scene.add(group);

  const cam = new THREE.Vector3(), vel = new THREE.Vector3(), tmpC = new THREE.Color(), rippleC = new THREE.Color();
  let leafSeason = '', firstFrame = true, frostDoy = -1, frostTimes = sunTimes(0);
  const g = a.ground;
  // Settings → Graphics → weather effects (0–1), halved again under reduced motion (Settings → Accessibility)
  const fx = () => ctx.comfort.weatherFx * (ctx.comfort.reducedMotion ? 0.5 : 1);

  const writeSurfaces = (indoor: boolean, rainNow: number, time: number) => {
    const L = ctx.lighting;
    const k = indoor ? 0 : 1;
    VW[0] = g.wet * k; VW[1] = g.snow * k; VW[2] = rainNow * k; VW[3] = time % 600;
    VW[4] = a.zenith.r; VW[5] = a.zenith.g; VW[6] = a.zenith.b; VW[7] = g.frost * k;
    VW[8] = a.horizon.r; VW[9] = a.horizon.g; VW[10] = a.horizon.b; VW[11] = smooth(0.2, 0.85, g.wet);
    VW[12] = L.sunDir.x; VW[13] = L.sunDir.y; VW[14] = L.sunDir.z;
    const glint = Math.min(2.2, L.sunIntensity * 0.55) * (1 - a.overcast * 0.6);
    VW[16] = L.sunColor.r * glint; VW[17] = L.sunColor.g * glint; VW[18] = L.sunColor.b * glint; VW[19] = L.night;
    VW[20] = 0.92; VW[21] = 0.95; VW[22] = 1.0; VW[23] = clamp01(a.daylight * (1 - a.overcast)) * 0.8 + L.night * 0.15;
  };

  return {
    name: 'weather',
    update(f) {
      const dt = f.dt;
      const L = ctx.lighting, sky = ctx.valley.sky;
      ctx.camera.getWorldPosition(cam);
      const wx = L.wind.x, wz = L.wind.z;
      const night = L.night;
      // ambient light level for self-lit particles
      const amb = tmpC.copy(L.skyColor).multiplyScalar(0.55 + 0.45 * (1 - night));

      // --- rain
      const r = a.rain;
      rain.setAmount(r * (0.35 + 0.65 * r) * (1 + a.storm * 0.3) * fx());
      if (rain.mesh.visible) {
        vel.set(wx * 0.45, -13 - a.storm * 3, wz * 0.45);
        rain.step(vel, dt, f.time, cam);
        (rain.u.uVel.value as THREE.Vector3).copy(vel);
        (rain.u.uColor.value as THREE.Color).copy(amb).lerp(L.fogColor, 0.4).multiplyScalar(1.25).addScalar(0.06 * (1 - night));
        rain.u.uOpacity.value = 0.3 + 0.1 * a.storm;
      }
      rippleC.copy(amb).lerp(L.fogColor, 0.5).multiplyScalar(1.4);
      ripples.update(f.time, r, rippleC);

      // --- snow
      const s = a.snow;
      snow.setAmount(s * (0.3 + 0.7 * s) * fx());
      if (snow.mesh.visible) {
        vel.set(wx * 0.55, -1.15, wz * 0.55);
        snow.step(vel, dt, f.time, cam);
        (snow.u.uColor.value as THREE.Color).setRGB(1, 1, 1).lerp(amb, 0.35).multiplyScalar(1.05 - night * 0.45);
        snow.u.uOpacity.value = 0.9;
        snow.u.uSwirl.value = 0.45 + Math.hypot(wx, wz) * 0.08;
      }

      // --- falling leaves / petals
      const season = sky.season;
      if (season !== leafSeason) {
        leafSeason = season;
        const cols = season === 'spring' ? PETAL_COLORS : LEAF_COLORS;
        (['uC0', 'uC1', 'uC2', 'uC3'] as const).forEach((k, i) => (leaves.u[k].value as THREE.Color).setHex(cols[i]));
        leaves.u.uSize.value = season === 'spring' ? 0.06 : 0.1;
      }
      const windy = clamp01((Math.hypot(wx, wz) - 1) / 5);
      const leafAmt = (season === 'autumn' ? 0.35 + 0.65 * windy : season === 'spring' ? 0.2 + 0.4 * windy : 0) * (1 - r * 0.8) * (1 - s);
      leaves.setAmount(leafAmt * fx());
      if (leaves.mesh.visible) {
        vel.set(wx * 0.8, -0.75, wz * 0.8);
        leaves.step(vel, dt, f.time, cam);
        (leaves.u.uSunDir.value as THREE.Vector3).copy(L.sunDir);
        (leaves.u.uSun.value as THREE.Color).copy(L.sunColor).multiplyScalar(L.sunIntensity * 0.22);
        (leaves.u.uAmb.value as THREE.Color).copy(L.skyColor).multiplyScalar(0.4);
      }

      // --- sunbeam motes on clear, dry days (and a few at dusk)
      const moteAmt = clamp01(a.daylight * 1.2) * (1 - a.overcast) * (1 - clamp01(L.wet * 2)) * (1 - a.fog) * (1 - s);
      motes.setAmount(moteAmt * (low ? 0.5 : 1) * fx());
      if (motes.mesh.visible) {
        vel.set(wx * 0.12, 0.05, wz * 0.12);
        motes.step(vel, dt, f.time, cam);
        (motes.u.uColor.value as THREE.Color).copy(L.sunColor).lerp(tmpC.setRGB(1, 0.95, 0.8), 0.5);
        motes.u.uOpacity.value = 0.55 * moteAmt;
      }

      // --- lightning
      if (ctx.debug.lightning) { ctx.debug.lightning = false; lightning.strike(); }
      a.flash = lightning.update(dt, a.storm, cam, ctx.player.yaw) * (low ? 0.7 : 1) * (ctx.comfort.reducedMotion ? 0.3 : 1);

      // --- what the weather left on the ground (model trace: puddles linger, snow builds), eased
      const tr = sky.trace;
      const fo = a.force;
      const gdt = firstFrame || a.snap ? 1000 : dt;
      firstFrame = false;
      const wetT = fo.wet ?? Math.max(tr.wet, r * 0.9);
      g.wet = ease(g.wet, wetT, gdt, wetT > g.wet ? 6 : 25);
      g.snow = ease(g.snow, fo.snow ?? Math.max(tr.snow, s * 0.25), gdt, 12);
      // frost: cold, clear-ish nights and mornings until the sun has been up a while
      const doy = sky.dayOfYear;
      const cold = sky.season === 'winter' ? 1 : doy >= 305 || doy < 75 ? 0.6 : 0;
      if (doy !== frostDoy) { frostDoy = doy; frostTimes = sunTimes(doy); }
      const st = frostTimes, hr = sky.hour;
      const frostHour = hr < st.rise ? 1 : hr < st.rise + 3.2 ? 1 - smooth(st.rise + 0.6, st.rise + 3.2, hr) : smooth(st.set + 0.5, st.set + 3, hr);
      const frostT = fo.frost ?? cold * frostHour * (1 - a.overcast * 0.85) * (1 - clamp01(g.wet * 2.5)) * (1 - r);
      g.frost = ease(g.frost, frostT, gdt, 8);
      const indoor = (ctx.services.get('indoors') as IndoorSpace | undefined)?.active === true;
      writeSurfaces(indoor, r, f.time);

      // --- rainbow: in the first hour after a real shower stops (model trace), with the sun out
      const since = tr.sinceRain;
      const afterRain = since === null ? 0 : 1 - smooth(0.5, 1.2, since);
      const bowT = fo.rainbow ?? (ctx.debug.rainbow ? 1 : afterRain * (1 - smooth(0.05, 0.25, a.rain)) * smooth(0.04, 0.2, a.sunElev) * (1 - a.overcast * 0.75) * (1 - a.fog));
      a.rainbow = ease(a.rainbow, bowT, a.snap ? 1000 : dt, 6);
      a.snap = false;
    },
    stats: () => ({
      rain: rain.geo.instanceCount, snow: snow.geo.instanceCount, leaves: leaves.geo.instanceCount, motes: motes.geo.instanceCount,
      flash: +a.flash.toFixed(2), rainbow: +a.rainbow.toFixed(2),
      wet: +g.wet.toFixed(2), snowCover: +g.snow.toFixed(2), frost: +g.frost.toFixed(2),
    }),
    dispose() {
      VW[0] = VW[1] = VW[2] = VW[7] = 0;
      ctx.scene.remove(group);
      group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    },
  };
};
