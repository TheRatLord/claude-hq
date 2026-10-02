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
  /** load-time costs: each system's build (factory) ms, when the first frame finished and how long it took (shader compiles) */
  startup(): StartupInfo;
  /** render one frame now (screenshots) */
  renderOnce(): void;
  setTimeScale(k: number): void;
  /** resolution multiplier on top of the quality's own (Settings → Graphics → render scale); applies at once */
  setRenderScale(k: number): void;
  /** frames per second cap (null = the display's rate): Settings → Graphics, the idle throttle */
  setFpsCap(fps: number | null): void;
  /** the desktop shell's render mode (farm/desktop.ts): null = normal, ms = a slow timer instead of rAF, 0 = no frames */
  setBackground(ms: number | null): void;
  /** the shadow-casting lights on / off (Settings → Graphics → shadows); materials recompile once on a change */
  setShadows(on: boolean): void;
}

export interface StartupInfo {
  /** factory ms per system, in start order (+ lazily built parts that report through `noteBuild`) */
  buildMs: Record<string, number>;
  /** performance.now() when the first frame was submitted, and that frame's ms (mostly program compiles) */
  firstFrameAt: number; firstFrameMs: number;
  /** shader programs compiled so far */
  programs: number;
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
  /** `br`: the solid's bounding radius (a cheap reject before the exact test; the order and maths are unchanged) */
  interface R { x: number; z: number; hw: number; hd: number; c: number; s: number; r?: number; br: number }
  // an array in insertion order (a Set iterated per resolve was most of the cost: ~40 farmers + pets resolve a frame)
  const solids: R[] = [];
  const remove = (o: R) => { const i = solids.indexOf(o); if (i >= 0) solids.splice(i, 1); return i >= 0; };
  const push = (p: { x: number; z: number }, rad: number): boolean => {
    let moved = false;
    for (let i = 0; i < solids.length; i++) {
      const o = solids[i], reach = o.br + rad;
      if (p.x - o.x > reach || o.x - p.x > reach || p.z - o.z > reach || o.z - p.z > reach) continue;
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
    rect(x, z, w, d, yaw) { const o: R = { x, z, hw: w / 2, hd: d / 2, c: Math.cos(yaw), s: Math.sin(yaw), br: Math.hypot(w / 2, d / 2) + 1e-6 }; solids.push(o); return () => remove(o); },
    circle(x, z, r) { const o: R = { x, z, hw: 0, hd: 0, c: 1, s: 0, r, br: r + 1e-6 }; solids.push(o); return () => remove(o); },
    resolve: (p, r) => push(p, r),
    blocked(x, z, r) { const p = { x, z }; return push(p, r); },
  };
}

/**
 * three re-resolves a material's program (parameters + cache key, ~10 µs) whenever consecutive draws of it disagree on
 * instancing / instance colours. Two places did that dozens of times a frame:
 *  - the opaque list sorts by material then instancing, but not by instance colour: shared materials whose users mix
 *    InstancedMeshes with and without `instanceColor` (plots, forage, beasts) flipped back and forth. This sort is
 *    three's own plus that key (same material, same z order inside each group; opaque, so the image is the same);
 *  - the shadow pass draws in scene order with one shared depth material for every caster: plain meshes and instanced
 *    ones alternate all the way through. `groupShadowDepth` gives each instanced / skinned kind its own (identical)
 *    depth material, so each keeps its program.
 */
type RenderItem = { groupOrder: number; renderOrder: number; material: { id: number }; materialVariant?: number; object: THREE.Object3D; z: number; id: number };
const colourKey = (o: THREE.Object3D) => ((o as THREE.InstancedMesh).instanceColor ? 1 : 0);
function opaqueSort(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.material.id !== b.material.id) return a.material.id - b.material.id;
  if (a.materialVariant !== b.materialVariant) return (a.materialVariant ?? 0) - (b.materialVariant ?? 0);
  const ca = colourKey(a.object), cb = colourKey(b.object);
  if (ca !== cb) return ca - cb;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}
const depthKinds = new Map<string, THREE.MeshDepthMaterial>();
function groupShadowDepth(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.castShadow || m.customDepthMaterial || Array.isArray(m.material)) return;
    const inst = (m as THREE.InstancedMesh).isInstancedMesh, skin = (m as THREE.SkinnedMesh).isSkinnedMesh;
    if (!inst && !skin) return;   // plain meshes keep three's shared default
    const mat = m.material as THREE.Material & { alphaTest: number; alphaMap?: unknown; map?: unknown; displacementMap?: unknown };
    // three makes a per-material variant for these: leave them to it
    if (mat.alphaTest > 0 || mat.alphaToCoverage || mat.displacementMap || mat.clippingPlanes?.length || m.geometry.morphAttributes.position) return;
    const key = `${inst ? ((m as THREE.InstancedMesh).instanceColor ? 'IC' : 'I') : ''}${skin ? 'S' : ''}`;
    let d = depthKinds.get(key);
    if (!d) { d = new THREE.MeshDepthMaterial(); d.name = `shadow-depth:${key}`; depthKinds.set(key, d); }
    m.customDepthMaterial = d;
  });
}

export function createEngine(o: EngineOpts): Engine {
  // the scene renders into the post chain's own target (scene/post): the canvas only gets the final full-screen pass, so
  // a multisampled default framebuffer would be pure cost (the 'post' service is always registered)
  const { renderer, resize } = createRenderer(o.canvas, { antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setOpaqueSort(opaqueSort as unknown as Parameters<THREE.WebGLRenderer['setOpaqueSort']>[0]);
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
  const buildMs: Record<string, number> = {};
  let firstFrameAt = 0, firstFrameMs = 0, started = false;
  const compileRT = new THREE.WebGLRenderTarget(1, 1);
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
    const t0 = firstFrameAt ? 0 : performance.now();
    // new casters appear all day (farmers, decor, seasons): sort them into their depth kinds now and then
    if (s.frame % 120 === 1) groupShadowDepth(scene);
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
    if (!firstFrameAt) { firstFrameAt = performance.now(); firstFrameMs = firstFrameAt - t0; }
  };
  const loop = createLoop(state, frame);

  return {
    ctx,
    add(f) {
      try {
        const t0 = performance.now();
        const before = new Set(scene.children);
        const s = f(ctx);
        // hand what it added to the GPU now: compileShader / linkProgram do not block (only the first use waits for a
        // program), so the driver compiles this system's programs while the next systems build on the CPU and the
        // first frame finds most of them linked (it used to stall ~0.6–1 s compiling ~90 programs in a row)
        // (into a render target like the post chain's scene target: linear output, no tone mapping, as the real frame)
        if (!started) {
          renderer.setRenderTarget(compileRT);
          for (const o of scene.children) if (!before.has(o)) { try { renderer.compile(o, camera, scene); } catch { /* compiled on first use */ } }
          renderer.setRenderTarget(null);
          renderer.getContext().flush();   // send the queued compiles to the GPU process now, not at the first frame
        }
        buildMs[s.name] = (buildMs[s.name] ?? 0) + performance.now() - t0;
        systems.push(s);
        return s;
      } catch (e) { console.error('[engine] system failed to start', e); return null; }
    },
    systems: () => systems,
    // lights made by systems exist now: a saved "shadows off" applies to them
    start() { fit(); applyShadows(); started = true; compileRT.dispose(); loop.start(); },
    stop() { loop.stop(); },
    onFrame(fn) { frameHooks.add(fn); return () => frameHooks.delete(fn); },
    perf: () => ({ ...state.perf, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, systemMs: { ...systemMs } }),
    startup: () => ({ buildMs: { ...buildMs }, firstFrameAt, firstFrameMs, programs: (renderer.info.programs ?? []).length }),
    renderOnce() { fit(); frame(state); },
    setTimeScale(k) { clock.setScale(k); },
    setRenderScale(k) {
      const v = Math.max(0.25, Math.min(1, k));
      if (v === renderScale) return;
      renderScale = v; fit();
    },
    setFpsCap(fps) { loop.setFpsCap(fps); },
    setBackground(ms) { loop.setBackground(ms); },
    setShadows(on) {
      if (on === shadows) return;
      shadows = on;
      applyShadows();
    },
  };
}
