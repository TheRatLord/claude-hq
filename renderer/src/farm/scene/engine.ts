/**
 * The engine: renderer, scene, camera, the shared SceneCtx, the system list and the frame loop.
 * Rendering goes through the 'post' service when one is registered (post-processing), else straight to the canvas.
 */
import * as THREE from 'three';
import { createRenderer } from '../../render/renderer.ts';
import { createClock } from '../../core/time.ts';
import { createLoop } from '../../core/loop.ts';
import type { LoopState } from '../../core/loop.ts';
import type { AgentPort, ValleyEvent, ValleyState } from '../model/types.ts';
import type { Colliders, FrameInfo, IndoorSpace, Interactable, Interactions, Lighting, Quality, SceneCtx, System, SystemFactory, UiPort } from './context.ts';
import { WORLD, heightAt } from '../world/map.ts';

export interface PostService {
  render(dt: number): void;
  setSize(w: number, h: number, pixelRatio: number): void;
}

export interface Engine {
  ctx: SceneCtx;
  add(f: SystemFactory): System | null;
  systems(): readonly System[];
  start(): void;
  stop(): void;
  /** per-frame hooks outside systems (player controller, HUD sync) */
  onFrame(fn: (f: FrameInfo) => void): () => void;
  perf(): { fps: number; frameMs: number; cpuMs: number; calls: number; tris: number; frameErrors: number; systemMs: Record<string, number> };
  /** render one frame now (screenshots) */
  renderOnce(): void;
  setTimeScale(k: number): void;
  /** resolution multiplier on top of the quality's own (Settings → Graphics → render scale); applies at once */
  setRenderScale(k: number): void;
  /** frames per second cap (null = the display's rate): Settings → Graphics, the idle throttle */
  setFpsCap(fps: number | null): void;
  /** the shadow-casting lights on / off (Settings → Graphics → shadows); materials recompile once on a change */
  setShadows(on: boolean): void;
}

export interface EngineOpts {
  canvas: HTMLCanvasElement;
  valley: ValleyState;
  onValley(fn: (e: ValleyEvent) => void): () => void;
  agents: AgentPort;
  ui: UiPort;
  quality?: Quality;
  /** server clock (ms) */
  now(): number;
}

function createInteractions(ctx: () => SceneCtx): Interactions & { pick(): void } {
  const items = new Set<Interactable>();
  let focused: Interactable | null = null;
  const p = new THREE.Vector3(), fwd = new THREE.Vector3(), to = new THREE.Vector3();
  return {
    add(i) { items.add(i); return () => { items.delete(i); if (focused === i) focused = null; }; },
    focused: () => focused,
    all: () => items,
    pick() {
      const c = ctx();
      if (c.player.frozen) { focused = null; return; }
      c.camera.getWorldDirection(fwd);
      let best: Interactable | null = null, bestScore = Infinity;
      // inside a room (the farmhouse) only its own things are in reach: nothing through the walls
      const room = c.services.get('indoors') as IndoorSpace | undefined;
      const inside = room?.active ? room : null;
      for (const i of items) {
        if (i.enabled && !i.enabled()) continue;
        if (inside && !inside.owns(i)) continue;
        i.pos(p);
        to.subVectors(p, c.player.eye);
        const d = to.length();
        const reach = i.reach ?? 3.2;
        if (d > reach + 0.6) continue;
        to.divideScalar(d || 1);
        const cos = to.dot(fwd);
        // generous cone up close, tighter far away; distance breaks ties
        const need = d < 1.5 ? 0.55 : 0.8;
        if (cos < need) continue;
        const score = (1 - cos) * 6 + d / reach;
        if (score < bestScore) { bestScore = score; best = i; }
      }
      focused = best;
    },
  };
}

function createColliders(): Colliders {
  interface R { x: number; z: number; hw: number; hd: number; c: number; s: number; r?: number }
  const solids = new Set<R>();
  const push = (p: { x: number; z: number }, rad: number): boolean => {
    let moved = false;
    for (const o of solids) {
      if (o.r !== undefined) {
        const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.r + rad;
        if (d < m && d > 1e-6) { p.x = o.x + (dx / d) * m; p.z = o.z + (dz / d) * m; moved = true; }
        continue;
      }
      const dx = p.x - o.x, dz = p.z - o.z;
      const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
      const cx = Math.max(-o.hw, Math.min(o.hw, lx)), cz = Math.max(-o.hd, Math.min(o.hd, lz));
      let ex = lx - cx, ez = lz - cz, d = Math.hypot(ex, ez);
      if (d >= rad) continue;
      let nlx: number, nlz: number;
      if (d < 1e-6) { // inside: exit through the nearest face
        const px = o.hw - Math.abs(lx), pz = o.hd - Math.abs(lz);
        if (px < pz) { nlx = Math.sign(lx || 1) * (o.hw + rad); nlz = lz; } else { nlx = lx; nlz = Math.sign(lz || 1) * (o.hd + rad); }
      } else { ex /= d; ez /= d; nlx = cx + ex * rad; nlz = cz + ez * rad; }
      // back to world (inverse rotation)
      p.x = o.x + nlx * o.c + nlz * o.s;
      p.z = o.z - nlx * o.s + nlz * o.c;
      moved = true;
    }
    return moved;
  };
  return {
    rect(x, z, w, d, yaw) { const o: R = { x, z, hw: w / 2, hd: d / 2, c: Math.cos(yaw), s: Math.sin(yaw) }; solids.add(o); return () => solids.delete(o); },
    circle(x, z, r) { const o: R = { x, z, hw: 0, hd: 0, c: 1, s: 0, r }; solids.add(o); return () => solids.delete(o); },
    resolve: (p, r) => push(p, r),
    blocked(x, z, r) { const p = { x, z }; return push(p, r); },
  };
}

export function createEngine(o: EngineOpts): Engine {
  // the scene renders into the post chain's own target (scene/post): the canvas only gets the final full-screen pass, so
  // a multisampled default framebuffer would be pure cost (the 'post' service is always registered)
  const { renderer, resize } = createRenderer(o.canvas, { antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.08, 900);
  camera.rotation.order = 'YXZ';
  const spawnY = heightAt(WORLD.spawn.x, WORLD.spawn.z);
  const lighting: Lighting = {
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(), sunColor: new THREE.Color(0xfff1d6), sunIntensity: 2.2,
    skyColor: new THREE.Color(0x9fd3ff), groundColor: new THREE.Color(0x7a8a4a), fogColor: new THREE.Color(0xcfe6f0),
    fogNear: 60, fogFar: 320, night: 0, wet: 0, wind: { x: 1, z: 0.3 },
  };
  const systems: System[] = [];
  const frameHooks = new Set<(f: FrameInfo) => void>();
  const systemMs: Record<string, number> = {};
  let ctx!: SceneCtx;
  const interactions = createInteractions(() => ctx);
  ctx = {
    renderer, scene, camera, valley: o.valley, onValley: o.onValley, lighting,
    player: { pos: new THREE.Vector3(WORLD.spawn.x, spawnY, WORLD.spawn.z), eye: new THREE.Vector3(WORLD.spawn.x, spawnY + 1.62, WORLD.spawn.z), yaw: WORLD.spawn.yaw, pitch: 0, speed: 0, frozen: false },
    interact: interactions, colliders: createColliders(), agents: o.agents, ui: o.ui, quality: o.quality ?? 'high', comfort: { weatherFx: 1, reducedMotion: false }, debug: {}, services: new Map(),
  };

  let renderScale = 1, shadows = true;
  /** lights we switched off (so switching back only restores what cast shadows before) */
  const shadowOff = new Set<THREE.Light>();
  const applyShadows = () => {
    if (!shadows) scene.traverse((o) => { if ((o as THREE.Light).isLight && o.castShadow) { o.castShadow = false; shadowOff.add(o as THREE.Light); } });
    else { for (const l of shadowOff) l.castShadow = true; shadowOff.clear(); }
  };
  const fit = () => {
    const w = o.canvas.clientWidth || innerWidth, h = o.canvas.clientHeight || innerHeight;
    const scale = (ctx.quality === 'low' ? 0.66 : ctx.quality === 'medium' ? 0.85 : 1) * renderScale;
    resize(w, h, scale);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    (ctx.services.get('post') as PostService | undefined)?.setSize(w, h, renderer.getPixelRatio());
  };
  addEventListener('resize', fit);

  const clock = createClock();
  const state: LoopState = { clock, perf: { fps: 0, frameMs: 0, cpuMs: 0, frameErrors: 0 }, dt: 0, rawDt: 0, time: 0, now: 0, hour: 12, frame: 0, hidden: false };
  const fi: FrameInfo = { dt: 0, time: 0, now: 0, frame: 0 };
  const draw = (dt: number) => {
    const post = ctx.services.get('post') as PostService | undefined;
    if (post) post.render(dt);
    else renderer.render(scene, camera);
  };
  const frame = (s: LoopState) => {
    fi.dt = s.dt; fi.time = s.time; fi.now = o.now(); fi.frame = s.frame;
    for (const fn of frameHooks) fn(fi);
    interactions.pick();
    for (const sys of systems) {
      const t0 = performance.now();
      try { sys.update(fi); } catch (e) {
        state.perf.frameErrors++;
        if (!ctx.debug[`err:${sys.name}`]) { ctx.debug[`err:${sys.name}`] = true; console.error(`[engine] ${sys.name} threw`, e); }
      }
      systemMs[sys.name] = (systemMs[sys.name] ?? 0) * 0.95 + (performance.now() - t0) * 0.05;
    }
    draw(s.dt);
  };
  const loop = createLoop(state, frame);

  return {
    ctx,
    add(f) {
      try {
        const s = f(ctx);
        systems.push(s);
        return s;
      } catch (e) { console.error('[engine] system failed to start', e); return null; }
    },
    systems: () => systems,
    // lights made by systems exist now: a saved "shadows off" applies to them
    start() { fit(); applyShadows(); loop.start(); },
    stop() { loop.stop(); },
    onFrame(fn) { frameHooks.add(fn); return () => frameHooks.delete(fn); },
    perf: () => ({ ...state.perf, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, systemMs: { ...systemMs } }),
    renderOnce() { fit(); frame(state); },
    setTimeScale(k) { clock.setScale(k); },
    setRenderScale(k) {
      const v = Math.max(0.25, Math.min(1, k));
      if (v === renderScale) return;
      renderScale = v; fit();
    },
    setFpsCap(fps) { loop.setFpsCap(fps); },
    setShadows(on) {
      if (on === shadows) return;
      shadows = on;
      applyShadows();
    },
  };
}
