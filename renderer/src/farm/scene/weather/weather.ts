/**
 * Weather: rain streaks + ground/water ripples, storms (heavier rain, lightning that lights the valley, distant
 * bolts, thunder), drifting snow, a rainbow after rain in daylight, falling leaves (autumn) / petals (spring) in the
 * wind, and glinting motes in the sun on clear days. Intensities come from the eased atmosphere state the sky
 * system maintains, so every change eases in.
 *
 * Dev: `__valley.debug('rainbow', true)` forces the rainbow, `__valley.debug('lightning', true)` strikes once.
 */
import * as THREE from 'three';
import type { SystemFactory } from '../context.ts';
import { atmoOf, clamp01, ease, smooth } from '../sky/atmo.ts';
import { createField } from './particles.ts';
import { createRipples } from './ripples.ts';
import { createLightning } from './lightning.ts';
import { PAL } from '../toon.ts';

const LEAF_COLORS = [PAL.leafAutumn, PAL.leafAutumn2, 0xe8b640, 0xb8562e];
const PETAL_COLORS = [0xf7c6d6, 0xfbe3ea, 0xf09ab8, 0xffffff];

export const weatherSystem: SystemFactory = (ctx) => {
  const a = atmoOf(ctx);
  const low = ctx.quality === 'low';
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
  let rainMemory = 0, leafSeason = '';

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
      rain.setAmount(r * (0.35 + 0.65 * r) * (1 + a.storm * 0.3));
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
      snow.setAmount(s * (0.3 + 0.7 * s));
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
      leaves.setAmount(leafAmt);
      if (leaves.mesh.visible) {
        vel.set(wx * 0.8, -0.75, wz * 0.8);
        leaves.step(vel, dt, f.time, cam);
        (leaves.u.uSunDir.value as THREE.Vector3).copy(L.sunDir);
        (leaves.u.uSun.value as THREE.Color).copy(L.sunColor).multiplyScalar(L.sunIntensity * 0.22);
        (leaves.u.uAmb.value as THREE.Color).copy(L.skyColor).multiplyScalar(0.4);
      }

      // --- sunbeam motes on clear, dry days (and a few at dusk)
      const moteAmt = clamp01(a.daylight * 1.2) * (1 - a.overcast) * (1 - clamp01(L.wet * 2)) * (1 - a.fog) * (1 - s);
      motes.setAmount(moteAmt * (low ? 0.5 : 1));
      if (motes.mesh.visible) {
        vel.set(wx * 0.12, 0.05, wz * 0.12);
        motes.step(vel, dt, f.time, cam);
        (motes.u.uColor.value as THREE.Color).copy(L.sunColor).lerp(tmpC.setRGB(1, 0.95, 0.8), 0.5);
        motes.u.uOpacity.value = 0.55 * moteAmt;
      }

      // --- lightning
      if (ctx.debug.lightning) { ctx.debug.lightning = false; lightning.strike(); }
      a.flash = lightning.update(dt, a.storm, cam, ctx.player.yaw) * (low ? 0.7 : 1);

      // --- rainbow: after rain ends, in daylight with the sun out
      if (a.rain > 0.3) rainMemory = 1;
      else rainMemory = Math.max(0, rainMemory - dt / 300);
      const bowT = ctx.debug.rainbow ? 1 : (rainMemory > 0 && a.rain < 0.15 ? 1 : 0) * smooth(0.05, 0.2, a.sunElev) * (1 - a.overcast) * smooth(0.02, 0.2, rainMemory);
      a.rainbow = ease(a.rainbow, bowT, dt, 6);
    },
    stats: () => ({
      rain: rain.geo.instanceCount, snow: snow.geo.instanceCount, leaves: leaves.geo.instanceCount, motes: motes.geo.instanceCount,
      flash: +a.flash.toFixed(2), rainbow: +a.rainbow.toFixed(2),
    }),
    dispose() {
      ctx.scene.remove(group);
      group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    },
  };
};
