/**
 * Valley lights: the local-light engine for night, dusk and storms (service 'lights').
 *
 * Packages register `LightEmitter`s (lamp posts, lanterns, windows, the campfire, scarecrow lanterns). Every frame this
 * system keeps the ones whose sphere of influence touches the view frustum, packs the nearest few into a fixed pool of
 * three.js PointLights (omni emitters) and SpotLights (window spill), and lets three's light plumbing deliver them to
 * every toon material; `shader.ts` evaluates them as banded, painted warm pools. The pool size is fixed per quality,
 * so the program defines never change (no recompiles); unused slots get distance 0 and the shader loops stop there.
 *
 * Timing: emitters fade in with `ctx.lighting.night` (which already includes rain/storm/fog gloom), eased so dusk is a
 * slow glow-up; lanterns and fires flicker (a few incommensurate sines per emitter, no allocation). Distant lights fade
 * out before they would be dropped from the pool, so swaps do not pop.
 */
import * as THREE from 'three';
import type { LightEmitter, LightOccluder, LightsService, SystemFactory } from '../context.ts';
import { VL_OCC, VL_OCC_SLOTS } from './shader.ts';

/** pool sizes per quality: [points, spots, fade-out distance m] */
const POOL = { low: [6, 4, 40], medium: [8, 6, 55], high: [10, 8, 65] } as const;

interface Slot<L extends THREE.Light> { light: L; e: LightEmitter | null }
interface Live { e: LightEmitter; seed: number }

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** subtle candle flicker in about [-1, 1] */
export function flickerAt(t: number, seed: number): number {
  return Math.sin(t * 9.1 + seed) * 0.45 + Math.sin(t * 15.7 + seed * 2.3) * 0.3 + Math.sin(t * 3.3 + seed * 0.7) * 0.25;
}

export const lightsSystem: SystemFactory = (ctx) => {
  const [NP, NS, FAR] = POOL[ctx.quality];
  const group = new THREE.Group();
  group.name = 'valley-lights';
  const points: Slot<THREE.PointLight>[] = [];
  const spots: Slot<THREE.SpotLight>[] = [];
  for (let i = 0; i < NP; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 0, 1);
    l.castShadow = false;
    l.matrixAutoUpdate = false;
    group.add(l);
    points.push({ light: l, e: null });
  }
  for (let i = 0; i < NS; i++) {
    const l = new THREE.SpotLight(0xffffff, 0, 0, 1, 0.8, 1);
    l.castShadow = false;
    l.matrixAutoUpdate = false;
    l.target.matrixAutoUpdate = false;
    group.add(l, l.target);
    spots.push({ light: l, e: null });
  }
  ctx.scene.add(group);

  const live: Live[] = [];
  const occluders: LightOccluder[] = [];
  let seq = 0;
  let level = 0;
  const service: LightsService = {
    add(e) {
      const rec: Live = { e, seed: (seq++ * 2.399) % 6.283 };
      live.push(rec);
      return () => { const i = live.indexOf(rec); if (i >= 0) live.splice(i, 1); };
    },
    occluder(o) {
      occluders.push(o);
      return () => { const i = occluders.indexOf(o); if (i >= 0) occluders.splice(i, 1); };
    },
    get level() { return level; },
    all: () => live.map((l) => l.e),
    occluders: () => occluders,
  };
  ctx.services.set('lights', service);

  // candidates, reused every frame (no allocation in steady state)
  interface Cand { e: LightEmitter; d: number; score: number; k: number }
  const candP: Cand[] = [], candS: Cand[] = [];
  const pool: Cand[] = [];
  let used = 0;
  const cand = (): Cand => (pool[used] ??= { e: null as unknown as LightEmitter, d: 0, score: 0, k: 0 }, pool[used++]);
  const byScore = (a: Cand, b: Cand) => a.score - b.score;

  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const cam = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let stats = { emitters: 0, points: 0, spots: 0 };

  /**
   * Building occluders for point slot i: the (up to) two nearest boxes that reach into the light's sphere but do not
   * hold the light itself (wall lanterns are spots: their wall plane does that job).
   */
  const near: { o: LightOccluder | null; d: number }[] = [{ o: null, d: 0 }, { o: null, d: 0 }];
  const writeOccluders = (i: number, e: LightEmitter | null) => {
    near[0].o = near[1].o = null;
    if (e && i < VL_OCC_SLOTS) for (const o of occluders) {
      if (e.pos.y > o.y1 + 0.5) continue;
      const dx = e.pos.x - o.x, dz = e.pos.z - o.z, c = Math.cos(o.yaw), sn = Math.sin(o.yaw);
      const qx = Math.abs(dx * c - dz * sn) - o.w / 2, qz = Math.abs(dx * sn + dz * c) - o.d / 2;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
      if (d < 0.3 || d > e.radius) continue;
      if (!near[0].o || d < near[0].d) { near[1].o = near[0].o; near[1].d = near[0].d; near[0].o = o; near[0].d = d; }
      else if (!near[1].o || d < near[1].d) { near[1].o = o; near[1].d = d; }
    }
    if (i >= VL_OCC_SLOTS) return;
    for (let b = 0; b < 2; b++) {
      const o = near[b].o, k = (i * 4 + b * 2) * 4;
      if (!o) { VL_OCC[k + 4] = 0; continue; }
      VL_OCC[k] = o.x; VL_OCC[k + 1] = (o.y0 + o.y1) / 2; VL_OCC[k + 2] = o.z; VL_OCC[k + 3] = Math.cos(o.yaw);
      VL_OCC[k + 4] = o.w / 2; VL_OCC[k + 5] = (o.y1 - o.y0) / 2; VL_OCC[k + 6] = o.d / 2; VL_OCC[k + 7] = Math.sin(o.yaw);
    }
  };
  const place = (l: THREE.Light, p: THREE.Vector3) => { l.position.copy(p); l.updateMatrix(); l.updateMatrixWorld(); };

  return {
    name: 'lights',
    update(f) {
      const L = ctx.lighting;
      // eased night factor: lamps glow up through dusk and come on early under storm gloom
      const target = smooth(0.08, 0.7, L.night);
      level = f.frame <= 1 ? target : level + (target - level) * (1 - Math.exp(-f.dt / 1.2));

      const camera = ctx.camera;
      camera.updateMatrixWorld();
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      camera.getWorldPosition(cam);

      used = 0;
      candP.length = 0; candS.length = 0;
      for (const { e, seed } of live) {
        let k = (e.gain ?? 1) * (e.when === 'always' ? 1 : level);
        if (k < 0.004 || e.intensity <= 0 || e.radius <= 0) continue;
        const d = cam.distanceTo(e.pos);
        if (d - e.radius > FAR) continue;
        sphere.center.copy(e.pos); sphere.radius = e.radius;
        if (!frustum.intersectsSphere(sphere)) continue;
        // fade out with distance before the pool would drop it
        k *= 1 - smooth(FAR * 0.7, FAR, d - e.radius * 0.5);
        if (e.flicker) k *= 1 + e.flicker * 0.22 * flickerAt(f.time, seed);
        if (k < 0.004) continue;
        const c = cand();
        c.e = e; c.d = d; c.k = k;
        let score = d - e.radius * 0.4;
        // window spill pointing away from us mostly lands behind its wall
        if (e.dir) { tmp.subVectors(cam, e.pos); score *= e.dir.dot(tmp) < 0 ? 1.8 : 1; }
        c.score = score / Math.max(0.3, Math.min(1.5, e.intensity * k));
        (e.dir ? candS : candP).push(c);
      }
      candP.sort(byScore);
      candS.sort(byScore);

      // slot 0's decay = the pool's reach from the camera (the shader skips farther pixels; see shader.ts)
      let reachP = 0, reachS = 0;
      for (let i = 0; i < points.length && i < candP.length; i++) reachP = Math.max(reachP, candP[i].d + candP[i].e.radius);
      for (let i = 0; i < spots.length && i < candS.length; i++) reachS = Math.max(reachS, candS[i].d + candS[i].e.radius);
      for (let i = 0; i < points.length; i++) {
        const s = points[i], c = candP[i];
        s.light.decay = i === 0 ? reachP : 1;
        writeOccluders(i, c?.e ?? null);
        if (!c) { if (s.e) { s.light.intensity = 0; s.light.distance = 0; s.e = null; } continue; }
        s.e = c.e;
        place(s.light, c.e.pos);
        s.light.color.copy(c.e.color);
        s.light.intensity = c.e.intensity * c.k;
        s.light.distance = c.e.radius;
      }
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i], c = candS[i];
        s.light.decay = i === 0 ? reachS : 1;
        if (!c) { if (s.e) { s.light.intensity = 0; s.light.distance = 0; s.e = null; } continue; }
        const e = c.e;
        s.e = e;
        place(s.light, e.pos);
        s.light.target.position.copy(e.pos).add(e.dir!);
        s.light.target.updateMatrix(); s.light.target.updateMatrixWorld();
        s.light.color.copy(e.color);
        s.light.intensity = e.intensity * c.k;
        s.light.distance = e.radius;
        // a hemisphere about the apex (see shader.ts): full light from ~70° off the wall normal, fading to 0 in the wall
        // plane; `cone` narrows it
        s.light.angle = Math.min(e.cone ?? Math.PI / 2, Math.PI / 2);
        s.light.penumbra = 0.25;
      }
      stats = { emitters: live.length, points: Math.min(candP.length, NP), spots: Math.min(candS.length, NS) };
    },
    stats: () => ({ ...stats, level: +level.toFixed(2) }),
    dispose() {
      ctx.services.delete('lights');
      ctx.scene.remove(group);
      for (const s of points) s.light.dispose();
      for (const s of spots) s.light.dispose();
    },
  };
};
