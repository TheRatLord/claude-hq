/**
 * Post stack in the §5.1 order (normative):
 *   shadow map (once, CASTERS|CHARS) → RenderPass(world: DEFAULT|ENV|PROPS) → N8AO (Med+, AO-only: half-res AO) →
 *   CharPass(CHARS, then HULLS, then OVERLAY; depth-tested against the scene depth) →
 *   EffectPass(AO apply, Edge, Bloom, [toe compensation], ToneMapping(NEUTRAL), LUT3D) →
 *   EffectPass(SMAA | FXAA on Low, then Vignette, Noise). CA (High+) runs first inside the main EffectPass (M3.5)
 * N8AO sees only the world depth, so characters never cause AO; the AO is applied as mix(c, c·ao, alpha) (the §5.1
 * alpha-mask variant), so characters (alpha 0) never receive it either, and Edge skips them the same way.
 * `?silhouette=1` swaps the whole frame for the ink-on-paper check render (debug/silhouette.ts).
 * Owner: RND.
 */
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Pass, Effect, BloomEffect, ToneMappingEffect, ToneMappingMode, LUT3DEffect,
  SMAAEffect, SMAAPreset, FXAAEffect, VignetteEffect, NoiseEffect, ChromaticAberrationEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { LAYERS, MASK } from './layers.ts';
import { U, effectUniform } from './uniforms.ts';
import { EdgeEffect } from './edge.ts';
import { lutData, blendLuts, LUT_SIZE, type GradePhase } from './lut.ts';
import { lutWeightsInto, type LutWeights } from './lightMath.ts';
import { MISC } from '../../../shared/palette.ts';
import { hqStatSection } from '../core/debug.ts';
import { installProbe } from '../debug/probe.ts';
import { installContextLoss } from './contextLoss.ts';
import { createSilhouette } from '../debug/silhouette.ts';
import { parseParams } from '../core/params.ts';
import { createDrawCount, programSplit, type DrawCounts } from './drawCount.ts';
import { isSceneProgram } from '../core/drawSplit.ts';
import { monitorAtlasStats, type AtlasStats } from './monitorAtlas.ts';
import { deskScreenModes } from './deskScreens.ts';
import { createProgramWarmup } from './programWarmup.ts';
import { materialData, type Drawable } from './materials/index.ts';
import type { Quality, Tier } from './quality.ts';
import type { Ctx } from '../core/ctx.ts';
import type { DrawSplit } from '../core/drawSplit.ts';

/** three's internal per-render-target record (`renderer.properties.get(rt)`); `properties.get` is typed `unknown`. */
interface TargetProps { __webglFramebuffer?: WebGLFramebuffer | null }
const framebufferOf = (renderer: THREE.WebGLRenderer, rt: THREE.RenderTarget): WebGLFramebuffer | null =>
  (renderer.properties.get(rt) as TargetProps).__webglFramebuffer ?? null;

/** postprocessing's typings omit the composer's public `depthRenderTarget` (set once a pass needs the depth texture). */
const depthTargetOf = (composer: EffectComposer): THREE.WebGLRenderTarget | null =>
  (composer as EffectComposer & { depthRenderTarget?: THREE.WebGLRenderTarget | null }).depthRenderTarget ?? null;

/** three is WebGL2-only (r163+), but `getContext()` is typed as the union. */
const gl2 = (renderer: THREE.WebGLRenderer): WebGL2RenderingContext => renderer.getContext() as WebGL2RenderingContext;

/** Blit one framebuffer attachment set to another (depth or colour). */
function blit(renderer: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, bits: number): boolean {
  const gl = gl2(renderer);
  renderer.setRenderTarget(dst); // ensures dst's FBO exists
  const s = framebufferOf(renderer, src), d = framebufferOf(renderer, dst);
  if (!s || !d) return false;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d);
  gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, bits, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  renderer.setRenderTarget(null);
  return true;
}

/** Exact inverse of the NEUTRAL toe (lut.ts `untoe`), so NEUTRAL is the identity below ≈ 0.76 (§5.0). */
class ToeCompEffect extends Effect {
  constructor() {
    super('HqToeComp', /* glsl */ `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float m = min(c.r, min(c.g, c.b));
        float add = m < 0.04 ? sqrt(max(m, 0.0) / 6.25) - m : 0.04;
        outputColor = vec4(c + add, inputColor.a);
      }`, { blendFunction: BlendFunction.SRC });
  }
}

/**
 * N8AO in AO-only mode (§5.1 fallback composite; perf, M1). N8AO v2 composites into its own full-res target, copies
 * that into the output buffer and, with `accumulate:false`, still copies the blurred half-res AO into an accumulation
 * target: two full-res half-float passes (≈ 0.5 ms on the 780M, bandwidth-bound) plus a program, every frame. Here it
 * only produces the half-res AO (depth downsample → AO → 2 denoise passes) and never touches the colour buffers, so it
 * no longer swaps and CharPass draws into the RenderPass buffer, which already holds the scene depth (no blit).
 * `AOEffect` applies the AO inside the main EffectPass as `mix(c, c·aoColor, (1 − ao)·alpha)`: characters (alpha 0)
 * never receive AO, as before.
 */
function aoOnlyN8AO(pass: N8AOPostPass): void {
  // With an even denoiseIterations the blur ends in writeTargetInternal; alias the accumulation target to it.
  Object.defineProperty(pass, 'accumulationRenderTarget', { get: () => pass.writeTargetInternal, set() {}, configurable: true });
  for (const q of [pass.accumulationQuad, pass.effectCompositerQuad, pass.copyQuad]) q.render = () => {};
  // (configuration changes swap these quads' materials, never the quads, so the no-ops stick)
  pass.needsSwap = false;
}

/** Applies N8AO's half-res AO (bilinear) to the world pixels (alpha 1); characters (alpha 0) are untouched. */
class AOEffect extends Effect {
  constructor() {
    super('HqAO', /* glsl */ `
      uniform sampler2D tAO; uniform vec3 uAOColor; uniform float uAOIntensity;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float ao = pow(clamp(texture2D(tAO, uv).r, 0.0, 1.0), uAOIntensity);
        outputColor = vec4(mix(inputColor.rgb, inputColor.rgb * uAOColor, (1.0 - ao) * inputColor.a), inputColor.a);
      }`, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([['tAO', new THREE.Uniform(null)], ['uAOColor', new THREE.Uniform(new THREE.Color())], ['uAOIntensity', new THREE.Uniform(1.5)]]),
    });
  }
  sync(n8ao: N8AOPostPass): void {
    effectUniform<THREE.Texture>(this, 'tAO').value = n8ao.writeTargetInternal.texture;
    effectUniform<THREE.Color>(this, 'uAOColor').value.copy(n8ao.configuration.color).convertSRGBToLinear();
    effectUniform<number>(this, 'uAOIntensity').value = n8ao.configuration.intensity;
  }
}

type SetMaterial = (material: THREE.Material, frontFaceCW: boolean, hardwareClippingPlanes: number) => void;

/** RenderPass limited to the world layers. */
class WorldPass extends RenderPass {
  prepass: boolean;
  prepassMat: THREE.MeshDepthMaterial;
  _cc: THREE.Color;
  _setMat: SetMaterial | null;
  _flipSetMat: SetMaterial;
  _restore: { on: boolean; bg: THREE.Scene['background']; auto: boolean };
  /** the frame's §5.3 draw counter (post.ts, m2 fix r3) */
  dc: ReturnType<typeof createDrawCount> | null;
  primed?: boolean;
  prepassCalls?: number;
  /** the buffer the world was rendered into (holds the scene depth) */
  target?: THREE.WebGLRenderTarget | null;
  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super(scene, camera);
    /**
     * Architecture depth prepass (m2 fix r1, §5.3 perf): the world pass was fill-bound (≈ 3 ms of a 5.7 ms GPU frame at
     * spawn; the merged per-region walls / floors / ceilings overdraw each other and three sorts opaque draws by
     * material before depth). Walls, floors and ceilings (LAYERS.PREPASS) are laid into the depth buffer first with the
     * shadow pass's own plain depth program (no new program), pushed back by a polygon offset so the colour pass still
     * passes LEQUAL on them; every hidden toon fragment is then early-z rejected.
     * Program sharing: the shadow map draws front-sided casters with a BackSide clone of its depth material, so its
     * program key has flipSided set. The prepass material is BackSide too (same key → same program) and inverts
     * the winding three passes to state.setMaterial for its one render, so it still rasterises front faces.
     */
    this.prepass = true;
    this.prepassMat = new THREE.MeshDepthMaterial();
    this.prepassMat.colorWrite = false;
    this.prepassMat.polygonOffset = true; this.prepassMat.polygonOffsetFactor = 1; this.prepassMat.polygonOffsetUnits = 2;
    this.prepassMat.side = THREE.BackSide;
    this.prepassMat.name = 'hq:prepass';
    // m2 fix r2 (perf): the per-frame scratch lives on the pass (was a new THREE.Color + two closures every frame)
    this._cc = new THREE.Color();
    this._setMat = null; // three's state.setMaterial while the prepass render runs
    this._flipSetMat = (m, cw, clip) => this._setMat?.(m, !cw, clip); // BackSide material, front faces (see above)
    this._restore = { on: false, bg: null, auto: true };
    this.dc = null;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null, dt?: number, stencil?: boolean): void {
    const cam = this.camera;
    const mask = cam.layers.mask;
    // three renders shadows before it sets up the frame's lights, so a first-ever shadow render sees an empty light
    // state and compiles a pair of depth programs that are never used again (they count against the §5.3 program
    // budget). Prime the light state once with a lights-only render (the key light is on every layer; bit 31 is unused).
    if (!this.primed) {
      this.primed = true;
      renderer.shadowMap.needsUpdate = false;
      cam.layers.mask = 1 << 31;
      renderer.setRenderTarget(inputBuffer);
      renderer.render(this.scene, cam);
    }
    const scene = this.scene;
    const R = this._restore;
    R.on = false;
    this.prepassCalls = 0;
    if (this.prepass && !this.renderToScreen) {
      // clear to the background colour here (three's background pass would clear the prepass depth), lay the
      // architecture depth, then draw the world without any clear
      const bg = scene.background, auto = renderer.autoClear, ov = scene.overrideMaterial;
      const cc = renderer.getClearColor(this._cc), ca = renderer.getClearAlpha();
      renderer.setRenderTarget(inputBuffer);
      if (bg instanceof THREE.Color) renderer.setClearColor(bg, 1);
      renderer.clear(true, true, false);
      renderer.setClearColor(cc, ca);
      scene.background = null; renderer.autoClear = false; scene.overrideMaterial = this.prepassMat;
      renderer.shadowMap.needsUpdate = false;
      cam.layers.mask = MASK.prepass;
      const st = renderer.state;
      const setMat = this._setMat = st.setMaterial;
      st.setMaterial = this._flipSetMat;
      const c0 = renderer.info.render.calls, r0 = renderer.info.render.triangles;
      try { renderer.render(scene, cam); } finally { st.setMaterial = setMat; this._setMat = null; }
      this.prepassCalls = renderer.info.render.calls - c0;
      this.dc?.prepassDraws(this.prepassCalls, renderer.info.render.triangles - r0);
      scene.overrideMaterial = ov;
      this.clearPass.enabled = false;
      R.on = true; R.bg = bg; R.auto = auto;
    }
    cam.layers.mask = MASK.world;
    renderer.shadowMap.needsUpdate = true; // the frame's one shadow render happens inside this call
    try { this._main(renderer, inputBuffer, outputBuffer, dt, stencil); } finally {
      if (R.on) { scene.background = R.bg; renderer.autoClear = R.auto; this.clearPass.enabled = true; R.on = false; R.bg = null; }
    }
    this.target = inputBuffer; // holds the scene depth; CharPass skips its depth copy when it draws into this buffer
    cam.layers.mask = mask;
  }
  /** The world colour render (counted as §5.3 `main`; the nested shadow render goes to `shadow`). */
  _main(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null, dt?: number, stencil?: boolean): void {
    const sup = RenderPass.prototype.render;
    if (this.dc) this.dc.main(sup, this, renderer, inputBuffer, outputBuffer, dt, stencil);
    else sup.call(this, renderer, inputBuffer, outputBuffer, dt, stencil);
  }
}

/**
 * CharPass (§5.1, ≈ 40 lines): renders CHARS, then HULLS, then OVERLAY into the composer's current input buffer with
 * autoClear off, depth-tested against the scene depth, so characters are occluded by desks and walls. With N8AO in
 * AO-only mode nothing swaps before it, so that buffer is the RenderPass target and already holds the depth; otherwise
 * the stable depth copy RenderPass filled is blitted in first. Reuses the frame's shadow map.
 */
export class CharPass extends Pass {
  composer: EffectComposer;
  worldPass: WorldPass;
  /** probe hook: (renderer, inputBuffer) → void */
  onInput: ((renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) => void) | null;
  /** probe hook (hueGapCheck): 'charsHulls' | 'chars' renders just those layers for one frame (masks) */
  only: 'chars' | 'charsHulls' | null;
  constructor(scene: THREE.Scene, camera: THREE.Camera, composer: EffectComposer, worldPass: WorldPass) {
    super('CharPass', scene, camera);
    this.needsSwap = false;
    this.composer = composer;
    this.worldPass = worldPass;
    this.onInput = null;
    this.only = null;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    const depthRT = depthTargetOf(this.composer);
    if (depthRT && inputBuffer !== this.worldPass.target) blit(renderer, depthRT, inputBuffer, gl2(renderer).DEPTH_BUFFER_BIT);
    const scene = this.scene, cam = this.camera;
    const mask = cam.layers.mask, bg = scene.background, auto = renderer.autoClear;
    scene.background = null;
    renderer.autoClear = false;
    renderer.setRenderTarget(inputBuffer);
    const masks = this.only === 'chars' ? [MASK.chars] : this.only === 'charsHulls' ? [MASK.chars, MASK.hulls] : [MASK.chars, MASK.hulls, MASK.overlay];
    const c0 = renderer.info.render.calls, r0 = renderer.info.render.triangles;
    for (const m of masks) { cam.layers.mask = m; renderer.render(scene, cam); }
    this.worldPass.dc?.mainDraws(renderer.info.render.calls - c0, renderer.info.render.triangles - r0);   // §5.3 main (m2 fix r3)
    cam.layers.mask = mask; scene.background = bg; renderer.autoClear = auto;
    this.onInput?.(renderer, inputBuffer);
  }
}

/**
 * Cached environment shadow (m2 fix r1, §5.3). The studio key never moves and the shadow box only moves when its
 * snapped position steps (lights.ts, 1.5 m steps), but the prop kits cast ≈ 0.56 M triangles: re-rendering them every
 * frame was most of the shadow pass. The map is now two layers:
 *  - **static**: every non-character caster that has not moved for SETTLE_MS, rendered into `staticRT` only when the
 *    shadow camera, the map, or the static set / any static caster's transform, instance buffer or visibility changes;
 *  - **dynamic**: characters (CHARS) plus any caster that moved recently, drawn every frame on top of a depth blit of
 *    `staticRT` (three's own clear of the map is swapped for that blit for the duration of the render).
 * A caster that starts moving drops out of the static layer (one re-bake), is drawn per frame while it moves, and
 * rejoins the static layer SETTLE_MS after it stops (one more re-bake). Output is identical to a full render.
 * `casters` is the live list, refilled by the layer sweep each frame.
 */
/** `count` of an instanced object (0 for anything else). */
const countOf = (o: object): number => ('count' in o && typeof o.count === 'number' ? o.count : 0);

function createShadowCache(renderer: THREE.WebGLRenderer, casters: readonly THREE.Mesh[]) {
  const SETTLE_MS = 2500;
  const gl = gl2(renderer);
  const track = new WeakMap<THREE.Mesh, { sig: number; moved: number }>();
  let staticRT: THREE.WebGLRenderTarget | null = null, bakedKey = NaN, bakedMap: THREE.RenderTarget | null = null, forced = true;
  const st = { bakes: 0, static: 0, dynamic: 0, lastBake: 0 };
  const dyn: THREE.Mesh[] = [], stat: THREE.Mesh[] = [];
  const visibleUp = (o: THREE.Object3D | null): number => { for (let p = o; p; p = p.parent) if (!p.visible) return 0; return 1; };
  const sigOf = (o: THREE.Mesh): number => {
    const e = o.matrixWorld.elements;
    let h = o.id * 0.618 + visibleUp(o) * 7 + (countOf(o)) * 0.013 + (o instanceof THREE.InstancedMesh ? o.instanceMatrix.version * 1.37 : 0);
    for (let i = 0; i < 16; i++) h += e[i] * (i + 1.7);
    return h;
  };
  // m2 fix r2 (perf): the light key is 15 numbers compared in place (was a 15-field toFixed string per frame)
  const bakedLight = new Float64Array(15);
  const curLight = new Float64Array(15);
  const lightKey = (light: THREE.DirectionalLight, out: Float64Array): Float64Array => {
    // (three places the shadow camera from these inside its render, so the camera's own matrix is a frame late here)
    const e = light.matrixWorld.elements, t = light.target.matrixWorld.elements, c = light.shadow.camera;
    out[0] = e[12]; out[1] = e[13]; out[2] = e[14]; out[3] = t[12]; out[4] = t[13]; out[5] = t[14];
    out[6] = c.left; out[7] = c.right; out[8] = c.top; out[9] = c.bottom; out[10] = c.near; out[11] = c.far;
    out[12] = light.shadow.mapSize.x; out[13] = light.shadow.bias; out[14] = light.shadow.normalBias;
    return out;
  };
  /** same light placement (to 1e-4 m, the old string key's toFixed(4); the rest exact) */
  const sameLight = (a: Float64Array, b: Float64Array): boolean => {
    for (let i = 0; i < 6; i++) if (Math.abs(a[i] - b[i]) >= 5e-5) return false;
    for (let i = 6; i < 15; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  const fbo = (rt: THREE.RenderTarget) => framebufferOf(renderer, rt);
  const blitDepth = (src: WebGLFramebuffer | null, dst: WebGLFramebuffer | null, w: number, h: number) => {
    const cur = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, cur);
  };
  const ensureStatic = (map: THREE.RenderTarget) => {
    const w = map.width, h = map.height;
    if (staticRT && staticRT.width === w && staticRT.height === h) return;
    staticRT?.dispose();
    const rt = staticRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, generateMipmaps: false });
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    rt.depthTexture.format = THREE.DepthFormat;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); // allocates the FBO
    renderer.setRenderTarget(prev);
    forced = true;
  };
  const setCast = (list: readonly THREE.Mesh[], v: boolean) => { for (let i = 0; i < list.length; i++) list[i].castShadow = v; };
  // stand-ins for three's clear of the shadow map during a render (m2 fix r2: fields, not per-frame closures)
  const noClear = () => {};
  let blitMap: THREE.RenderTarget | null = null;
  const blitClear = () => { if (staticRT && blitMap) blitDepth(fbo(staticRT), fbo(blitMap), blitMap.width, blitMap.height); };
  return {
    /** `draw` renders the shadow map (three's WebGLShadowMap.render) */
    render(lightsArr: readonly THREE.Light[], draw: () => void) {
      const light = lightsArr.length === 1 ? lightsArr[0] : null;
      if (!light || !(light instanceof THREE.DirectionalLight) || !light.castShadow) { draw(); return; }
      const map = light.shadow.map;
      // classify (casters were collected by this frame's layer sweep)
      const now = performance.now();
      dyn.length = 0; stat.length = 0;
      let key = 0;
      for (const o of casters) {
        if (o.layers.mask & MASK.chars) { dyn.push(o); continue; }
        const s = sigOf(o);
        let t = track.get(o);
        if (!t) { t = { sig: s, moved: -Infinity }; track.set(o, t); }
        else if (t.sig !== s) { t.sig = s; t.moved = now; }
        if (now - t.moved < SETTLE_MS) dyn.push(o);
        else { stat.push(o); key += s * 1.000003 + stat.length * 0.5; }
      }
      st.static = stat.length; st.dynamic = dyn.length;
      const lk = lightKey(light, curLight);
      if (!map || forced || map !== bakedMap || !sameLight(lk, bakedLight) || key !== bakedKey) {
        // bake: static casters only (three clears the map), keep a copy, then the dynamic ones on top without a clear
        setCast(dyn, false);
        try { draw(); } finally { setCast(dyn, true); }
        const m2 = light.shadow.map;
        if (!m2) return;
        ensureStatic(m2);
        if (!staticRT) return; // (ensureStatic just made it)
        blitDepth(fbo(m2), fbo(staticRT), m2.width, m2.height);
        bakedKey = key; bakedLight.set(lk); bakedMap = m2; forced = false;
        st.bakes++; st.lastBake = now;
        if (!dyn.length) return;
        const clear = renderer.clear;
        renderer.clear = noClear;
        setCast(stat, false);
        try { draw(); } finally { setCast(stat, true); renderer.clear = clear; }
        return;
      }
      // cached frame: three's clear of the map becomes a depth blit of the static layer; only dynamic casters draw
      const clear = renderer.clear;
      blitMap = map;
      renderer.clear = blitClear;
      setCast(stat, false);
      try { draw(); } finally { setCast(stat, true); renderer.clear = clear; blitMap = null; }
    },
    invalidate() { forced = true; },
    stats() { return { ...st, sinceBakeMs: Math.round(performance.now() - st.lastBake) }; },
    dispose() { staticRT?.dispose(); staticRT = null; },
  };
}

/**
 * Always-on frame GPU timer (RND fix r1, §5.2 auto-scale): one TIME_ELAPSED query around the composer render per
 * frame (shadow, world, chars, post), read back a few frames later, EMA'd into `perf.gpuMs` for quality.ts. Skipped
 * while the pass profiler runs (queries cannot nest). Without EXT_disjoint_timer_query_webgl2 `gpuMs` stays null.
 */
function createFrameTimer(renderer: THREE.WebGLRenderer) {
  const gl = gl2(renderer);
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const free: WebGLQuery[] = [], pending: WebGLQuery[] = [];
  let open: WebGLQuery | null = null, ema: number | null = null;
  return {
    begin() {
      if (!ext || open || pending.length > 6) return;
      open = free.pop() ?? gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(open); open = null;
    },
    poll(perf: { gpuMs: number | null } | undefined) {
      if (!ext || !pending.length) return;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending[0];
        pending.shift();
        if (!disjoint) {
          const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          if (ms > 0 && ms < 200) ema = ema === null ? ms : ema + (ms - ema) * 0.05;
        }
        free.push(q);
      }
      if (ema !== null && perf) perf.gpuMs = +ema.toFixed(2);
    },
    reset() { if (open && ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); free.push(open); open = null; } for (const q of pending) gl.deleteQuery(q); pending.length = 0; free.length = 0; ema = null; },
  };
}

/**
 * GPU pass profiler (m2 fix r1, §5.2 "per-pass GPU times"; debug only). One TIME_ELAPSED query per labelled span:
 * `mark(label)` closes the open span and opens the next (queries cannot nest, so the shadow render inside the world
 * pass splits it into world + shadow). Results are read back asynchronously and averaged per label.
 */
function createGpuProfiler(renderer: THREE.WebGLRenderer, labelOf: (pass: Pass) => string) {
  const gl = gl2(renderer);
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let on = false, cur: string | null = null, open: WebGLQuery | null = null;
  const pending: [string | null, WebGLQuery][] = [], acc = new Map<string | null, [number, number]>();
  const wrapped = new WeakSet<Pass>();
  const poll = () => {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length && gl.getQueryParameter(pending[0][1], gl.QUERY_RESULT_AVAILABLE)) {
      const [label, q] = pending[0];
      pending.shift();
      if (!disjoint) { const a = acc.get(label) ?? [0, 0]; a[0] += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; acc.set(label, a); }
      gl.deleteQuery(q);
    }
  };
  const self = {
    get active() { return on; },
    /** Returns the label that was open. */
    mark(label: string | null): string | null {
      if (!on || !ext) return null;
      const prev = cur;
      if (open) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push([cur, open]); open = null; }
      cur = label;
      if (label) { open = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, open); }
      return prev;
    },
    wrap(passes: readonly Pass[]) {
      if (!on) return;
      for (const p of passes) {
        if (wrapped.has(p)) continue;
        wrapped.add(p);
        const r = p.render.bind(p), name = p.name || p.constructor.name;
        p.render = (...a) => { if (on) self.mark(name === 'EffectPass' ? `fx:${labelOf(p)}` : name); return r(...a); };
      }
    },
    async run(ms: number) {
      if (!ext) return null;
      acc.clear(); on = true;
      const t0 = performance.now();
      let frames = 0;
      await new Promise<void>((res) => { const tick = () => { poll(); frames++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
      self.mark(null); on = false;
      await new Promise((res) => setTimeout(res, 100)); poll();
      const out: Record<string, number> = {}; let total = 0;
      for (const [k, [sum]] of acc) { out[String(k)] = +(sum / frames).toFixed(3); total += sum / frames; }
      return { frames, totalMs: +total.toFixed(3), passes: out };
    },
  };
  return self;
}

/** What the frame reads from CORE's ctx (a full `Ctx` satisfies it; the debug sheets pass less). */
export type PostFrameCtx = Partial<Pick<Ctx, 'time' | 'hour' | 'rawDt' | 'perf'>>;

export interface PostOpts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality?: Pick<Quality, 'tier'> | null;
}

export interface Post {
  composer: EffectComposer;
  /** characters render after N8AO into this pass */
  charPass: { enabled: boolean; add(obj: THREE.Object3D): void };
  /** the last step of the frame (§8.1) */
  render(ctx?: PostFrameCtx): void;
  /** Attach CORE's §5.3 draw split (main.ts) so `render.programs` reuses its program classification. */
  useDrawSplit(s: Pick<DrawSplit, 'programs'>): void;
  /** One-shot hook run right after the final pass wrote the canvas (probe.ts readbacks). */
  afterRender: ((renderer: THREE.WebGLRenderer) => unknown) | null;
  lost: boolean;
  setSize(w: number, h: number): void;
  /** false → plain render (hidden tab, §5.2) */
  setEnabled(v: unknown): void;
  setDebugEdge(on: unknown): void;
  /** Silhouette-check frame on/off (also `?silhouette=1`). */
  setSilhouette(on: unknown): void;
  readonly edge: EdgeEffect;
  readonly n8ao: N8AOPostPass;
  /** debug: the effect instances (perf experiments, `__hqRender.post.fx.smaa`) */
  readonly fx: { smaa: SMAAEffect; fxaa: FXAAEffect; bloom: BloomEffect; edge: EdgeEffect; aoFx: AOEffect; tone: ToneMappingEffect; lut: LUT3DEffect; vignette: VignetteEffect; noise: NoiseEffect; ca: ChromaticAberrationEffect };
  readonly charPassImpl: CharPass;
  readonly tier: Tier | null;
  stats(): PostStats;
  /** Force the static shadow layer to re-render next frame (tests, context restore). */
  invalidateShadows(): void;
  /**
   * Per-pass GPU time (ms, mean over `ms` of frames) via EXT_disjoint_timer_query_webgl2; null when unsupported.
   * Debug / review only (`await __hqRender.post.gpuProfile(2000)`); zero cost while not running.
   */
  gpuProfile(ms?: number): Promise<{ frames: number; totalMs: number; passes: Record<string, number> } | null>;
  dispose(): void;
}

/** `__hq.stats().render` */
export interface PostStats {
  drawCalls: DrawCounts & { portrait: number };
  tris: { main: number; env: number; chars: number; stat: number; shadow: number; prepass: number };
  programs: { scene: number; post: number };
  warmup: ReturnType<ReturnType<typeof createProgramWarmup>['stats']>;
  tier: Tier | null;
  lut: string;
  shadowCache: ReturnType<ReturnType<typeof createShadowCache>['stats']>;
  monitorAtlas: AtlasStats & { modes: ReturnType<typeof deskScreenModes> };
}

export function createPost({ renderer, scene, camera, quality }: PostOpts): Post {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, multisampling: 0 });
  const worldPass = new WorldPass(scene, camera);
  const charPass = new CharPass(scene, camera, composer, worldPass);
  const n8ao = new N8AOPostPass(scene, camera, 16, 16);
  aoOnlyN8AO(n8ao);
  const aoFx = new AOEffect();
  Object.assign(n8ao.configuration, {
    // distanceFalloff: N8AO's world-space range check is radius × falloff × 0.2, so §5.1's "1.0 relative (≈ 0.3 m)"
    // is 5.0 here (at 1.0 the range was 6 cm: no contact AO under benches/sofas; M1.75 tune)
    aoRadius: 0.36, distanceFalloff: 5.0, intensity: 1.7, aoSamples: 12, denoiseSamples: 4, denoiseRadius: 6,
    halfRes: true, color: new THREE.Color(MISC.aoColor), gammaCorrection: false, screenSpaceRadius: false,
    transparencyAware: false, accumulate: false, depthAwareUpsampling: true,
  });
  // N8AO auto-detects transparent materials (our glass) and then re-renders the scene for them every frame; glass is
  // one unsorted layer that must not get AO anyway
  n8ao.autoDetectTransparency = false;
  n8ao.configuration.transparencyAware = false;

  // grading LUT: day/golden/night blended by hour, regenerated only when the weights move
  const luts: Record<GradePhase, Float32Array> = { day: lutData('day'), golden: lutData('golden'), night: lutData('night'), morning: lutData('morning') }; // RND fix r1: + morning
  const lutMix = new Float32Array(luts.day.length);
  const lutHalf = new Uint16Array(luts.day.length);
  const lutTex = new THREE.Data3DTexture(lutHalf, LUT_SIZE, LUT_SIZE, LUT_SIZE);
  Object.assign(lutTex, { format: THREE.RGBAFormat, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, wrapR: THREE.ClampToEdgeWrapping, unpackAlignment: 1, generateMipmaps: false });
  let lutKey = '', nightW = 0;
  const lutW: LutWeights = { day: 0, golden: 0, night: 0, morning: 0 };
  const updateLut = (hour: number) => {
    const w = lutWeightsInto(lutW, hour);
    const key = `${w.day.toFixed(2)}|${w.golden.toFixed(2)}|${w.night.toFixed(2)}|${w.morning.toFixed(2)}`;
    if (key === lutKey) return;
    lutKey = key;
    blendLuts(lutMix, luts, w);
    nightW = w.night;
    for (let i = 0; i < lutMix.length; i++) lutHalf[i] = THREE.DataUtils.toHalfFloat(lutMix[i]);
    lutTex.needsUpdate = true;
  };
  updateLut(13);

  const edge = new EdgeEffect(camera);
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, intensity: 0.8, radius: 0.7 });
  // threshold at half res: it only feeds the first (half-res) mip, and a full-res half-float pass costs ≈ 0.1 ms
  bloom.luminancePass.resolution.scale = 0.5;
  const toe = new ToeCompEffect();
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
  const lut = new LUT3DEffect(lutTex, { tetrahedralInterpolation: false });
  const smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
  const fxaa = new FXAAEffect();
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.45 });
  const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
  noise.blendMode.opacity.value = 0.035;
  const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0006), radialModulation: true, modulationOffset: 0.3 });

  // EffectPass keeps its effects private: remember each pass's effect names for the GPU profiler's labels
  const fxLabels = new WeakMap<Pass, string>();
  const effectPass = (...effects: Effect[]): EffectPass => {
    const p = new EffectPass(camera, ...effects);
    fxLabels.set(p, effects.map((e) => e.name).join('+'));
    return p;
  };

  let tier: Tier | null = null;
  const build = (t: Tier) => {
    tier = t;
    composer.removeAllPasses();
    const low = t === 'low';
    composer.addPass(worldPass);
    if (!low) {
      n8ao.configuration.aoSamples = t === 'medium' ? 12 : 16;
      n8ao.configuration.halfRes = t !== 'photo';
      composer.addPass(n8ao);
    }
    composer.addPass(charPass);
    edge.setTier(t);
    bloom.mipmapBlurPass.levels = low ? 3 : 6;
    bloom.intensity = low ? 0.4 : 0.8; // (+ night boost in render)
    // M3.5: chromatic aberration (High / Photo) rides in this pass, first, instead of its own last fullscreen pass
    // (−1 pass ≈ 0.4 ms). It is a convolution effect, so it cannot share SMAA's pass; placed first it reads the pass
    // input (the HDR scene) and every per-pixel effect after it (AO, edge, bloom add, tone, LUT) applies on top
    const caHere = t === 'high' || t === 'photo' ? [ca] : [];
    composer.addPass(effectPass(...caHere, ...(low ? [] : [aoFx, edge]), bloom, toe, tone, lut));
    // AA, then grain/vignette/CA in the same pass: SMAA/FXAA blend from the pass input, so AA never sees grain or
    // CA fringes (§5.1 order holds) while saving a fullscreen pass and a program
    const last: Effect[] = [low ? fxaa : smaa, vignette];
    if (!low) last.push(noise);
    composer.addPass(effectPass(...last));
    const size = renderer.getSize(new THREE.Vector2());
    composer.setSize(size.x, size.y, false);
  };

  let enabled = true;
  let silhouette = typeof location !== 'undefined' && parseParams(location.search).silhouette ? createSilhouette({ renderer, scene, camera }) : null;
  let noiseAcc = 0;
  // §5.3 draw accounting (m2 fix r3, drawCount.ts): main = the world-scene colour renders only (was calls − shadow −
  // prepass, which counted the ≈ 20 fullscreen post draws as main); programs use CORE drawSplit's classification
  const dc = createDrawCount(renderer.info);
  const counts = dc.counts;
  let split: Pick<DrawSplit, 'programs'> | null = null;
  const program = { scene: 0, post: 0 };
  const layerSeen = new WeakMap<THREE.Object3D, THREE.Material>();

  // m15 carryover (RND): three's shadow pass shares ONE MeshDepthMaterial for every caster without a customDepthMaterial,
  // so each switch between an InstancedMesh (charBatch parts, prop kits) and a plain mesh flips its program state
  // (instancing) and re-runs WebGLPrograms.getParameters (~6 KB garbage per frame). Instanced / batched casters get
  // their own shared depth material, so both programs stay cached.
  const instDepth = new THREE.MeshDepthMaterial(), batchDepth = new THREE.MeshDepthMaterial();
  instDepth.name = 'hq:shadowDepthInstanced'; batchDepth.name = 'hq:shadowDepthBatched';
  /** Move meshes onto their material's layer (§5.1), once per (object, material). */
  const casters: THREE.Mesh[] = []; // this frame's shadow casters (CASTERS|CHARS meshes with castShadow), for the shadow cache
  const sweepLayers = () => {
    casters.length = 0;
    scene.traverse((o) => {
      const d = o as Drawable; // three's Object3D does not declare `material` / `geometry`
      const mat = d.material;
      if (!mat || Array.isArray(mat)) return;
      const ud = materialData(mat);
      if (layerSeen.get(o) !== mat) {
        layerSeen.set(o, mat);
        const layer = ud.hqLayer;
        if (layer !== undefined) {
          const caster = o.layers.isEnabled(LAYERS.CASTERS) || (layer === LAYERS.CHARS && ud.hqKind === 'toonChar');
          o.layers.set(layer);
          if (layer === LAYERS.CHARS) { o.castShadow = o.castShadow || caster; o.receiveShadow = true; }
          if (caster && layer !== LAYERS.CHARS) o.layers.enable(LAYERS.CASTERS);
          if (layer === LAYERS.ENV || layer === LAYERS.PROPS) o.receiveShadow = true;
          // depth prepass: static, undisplaced architecture (plain meshes on the toonEnv program)
          // [ENV M3.5 tris, cross-owner RND] `userData.noPrepass`: floors / trims that occlude nothing opt out (§5.3 tris)
          if (ud.hqKind === 'toonEnv' && !(o instanceof THREE.InstancedMesh) && !(o instanceof THREE.BatchedMesh) && !(o instanceof THREE.SkinnedMesh) && !o.userData?.noPrepass) o.layers.enable(LAYERS.PREPASS);
        }
        const batched = o instanceof THREE.BatchedMesh;
        if (!o.customDepthMaterial && (o instanceof THREE.InstancedMesh || batched)) o.customDepthMaterial = batched ? batchDepth : instDepth;
        if (ud.hqKind) normalizeForProgram(d, mat);
      } else if (hasVertexColors(mat) && d.geometry && !geoSeen.has(d.geometry) && ud.hqKind) normalizeForProgram(d, mat);
      if (o instanceof THREE.InstancedMesh && whiteIC.has(o)) checkWhiteIC(o);
      if (o instanceof THREE.Mesh && o.castShadow && (o.layers.mask & MASK.shadow)) casters.push(o);
    });
  };
  // m2 fix r1 (program churn, §5.3/§5.4): three keys a program on (instancing, instanceColor, vertexColors …) of the
  // *object*, so one material shared by an InstancedMesh with instanceColor (the prop kits) and one without (e.g.
  // env:movingDay) flipped programs twice per frame: WebGLPrograms.getParameters ran every frame (12.5 KB/frame of
  // garbage, setProgram 0.57 ms) and the shared instanced depth material did the same in the shadow pass. Every
  // instanced mesh on an hq material gets a white instanceColor, and every VCOL material's geometry a white colour
  // attribute, so each (material, pass) pair keeps exactly one program and the scene stays on the §5.4 matrix.
  const whiteIC = new WeakSet<THREE.InstancedMesh>();
  const geoSeen = new WeakSet<THREE.BufferGeometry>();
  const hasVertexColors = (m: THREE.Material): boolean => 'vertexColors' in m && !!m.vertexColors;
  const normalizeForProgram = (o: Drawable, mat: THREE.Material) => {
    if (o instanceof THREE.InstancedMesh && !o.instanceColor) {
      o.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(o.instanceMatrix.count * 3).fill(1), 3);
      whiteIC.add(o);
    }
    const g = o.geometry;
    if (hasVertexColors(mat) && g && !geoSeen.has(g)) {
      geoSeen.add(g);
      const pos = g.getAttribute('position');
      if (pos && !g.getAttribute('color')) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
    }
  };
  /** An owner that grows an instanced mesh (a new, larger instanceMatrix) must not leave our white instanceColor short. */
  const checkWhiteIC = (o: THREE.InstancedMesh) => {
    if (o.instanceColor && o.instanceColor.count >= o.instanceMatrix.count) return;
    o.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(o.instanceMatrix.count * 3).fill(1), 3);
  };

  // The shadow map renders once per frame inside WorldPass's render call (needsUpdate), with the camera mask swapped
  // to CASTERS|CHARS for the duration of the shadow pass only (three tests object layers against the render camera).
  const sm = renderer.shadowMap;
  const smRender = sm.render;
  const shadowCache = createShadowCache(renderer, casters);
  const gpuProf = createGpuProfiler(renderer, (p) => fxLabels.get(p) ?? '');
  const frameTimer = createFrameTimer(renderer); // RND fix r1: perf.gpuMs for the auto-scaler
  // RND fix r1 (§5.3): every scene program variant compiles on the boot frames, none lazily mid-session
  const warmup = createProgramWarmup({ renderer, scene, camera, target: () => composer.inputBuffer });
  // m2 fix r2 (perf): the shadow render's arguments are parked in fields so the cache calls one fixed closure
  const smArgs: { lights: THREE.Light[] | null; scene: THREE.Scene | null; cam: THREE.Camera | null } = { lights: null, scene: null, cam: null };
  const smDraw = () => { sm.needsUpdate = true; if (smArgs.lights && smArgs.scene && smArgs.cam) smRender.call(sm, smArgs.lights, smArgs.scene, smArgs.cam); };
  sm.render = function (lightsArr, sc, cam) {
    if (!sm.enabled || (!sm.autoUpdate && !sm.needsUpdate)) return;
    const before = renderer.info.render.calls, tBefore = renderer.info.render.triangles;
    const m = cam.layers.mask;
    cam.layers.mask = MASK.shadow;
    const resume = gpuProf.mark('shadow');
    smArgs.lights = lightsArr; smArgs.scene = sc; smArgs.cam = cam;
    try { shadowCache.render(lightsArr, smDraw); } finally { cam.layers.mask = m; gpuProf.mark(resume); smArgs.lights = smArgs.scene = smArgs.cam = null; }
    dc.shadowDraws(renderer.info.render.calls - before, renderer.info.render.triangles - tBefore);
  };

  // RND fix r2 (§5.3 triangle caps, code review: "the triangle budget is not enforced"): the main-pass triangles split
  // into the caps' owners. chars = the CharPass renders (exact, per frame); stat = STAT's `stats` group, counted on
  // demand (stats() only, never per frame) as the frustum-visible world-layer meshes; env = the rest of the world
  // colour render (architecture, kit, props, exterior, fx on the world layer).
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  let statRoot: THREE.Object3D | null = null;
  const meshTris = (o: THREE.Mesh): number => {
    const g = o.geometry;
    if (!g) return 0;
    const n = g.index ? g.index.count : g.getAttribute('position')?.count ?? 0;
    const inst = o instanceof THREE.InstancedMesh ? o.count : 1;
    return (g.drawRange && Number.isFinite(g.drawRange.count) ? Math.min(n, g.drawRange.count) : n) / 3 * inst;
  };
  const triSplit = () => {
    statRoot = statRoot?.parent ? statRoot : scene.getObjectByName('stats') ?? null;
    let stat = 0;
    if (statRoot) {
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const probe = new THREE.Layers(); probe.mask = MASK.world;
      statRoot.traverseVisible((o) => {
        if (!(o instanceof THREE.Mesh) || !o.layers.test(probe)) return;
        if (o.frustumCulled !== false && !(o instanceof THREE.InstancedMesh) && o.geometry && !frustum.intersectsObject(o)) return;
        stat += meshTris(o);
      });
    }
    const t = dc.tris;
    stat = Math.min(Math.round(stat), t.world);
    return { main: t.main, env: t.world - stat, chars: t.chars, stat, shadow: t.shadow, prepass: t.prepass };
  };

  const self: Post = {
    composer,
    charPass: { enabled: true, add(obj) { obj.traverse?.((o) => o.layers?.set(LAYERS.CHARS)); scene.add(obj); } },
    render(ctx) {
      if (self.lost) return;
      const t = quality?.tier ?? 'medium';
      if (t !== tier) build(t);
      renderer.info.reset();
      sweepLayers();
      U.uTime.value = ctx?.time ?? U.uTime.value;
      if (silhouette) { silhouette.render(); return; } // `?silhouette=1`: ink-on-paper check frame (ART §11 #2)
      if (!enabled) {
        const mask = camera.layers.mask;
        camera.layers.mask = MASK.world | MASK.chars | MASK.hulls | MASK.overlay;
        renderer.shadowMap.needsUpdate = true;
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        camera.layers.mask = mask;
        return;
      }
      updateLut(ctx?.hour ?? 13);
      aoFx.sync(n8ao);
      // after dark: a deeper vignette and a little more bloom, so lamps and screens glow in a cozy frame (M1 fix r2)
      vignette.darkness = 0.45 + 0.17 * nightW;
      bloom.intensity = (tier === 'low' ? 0.4 : 0.8) * (1 + 0.45 * nightW);
      dc.begin();
      worldPass.dc = dc;
      // film grain re-seeded at 24 Hz: only advance the composer clock in 1/24 s steps (temporal calm, ART §4)
      noiseAcc += ctx?.rawDt ?? 1 / 60;
      let dt = 0;
      if (noiseAcc >= 1 / 24) { dt = 1 / 24; noiseAcc %= 1 / 24; }
      gpuProf.wrap(composer.passes);
      warmup.frame();
      frameTimer.poll(ctx?.perf);
      const timed = !gpuProf.active;
      if (timed) frameTimer.begin();
      composer.render(dt);
      if (timed) frameTimer.end();
      gpuProf.mark(null);
      warmup.check();
      self.afterRender?.(renderer);
      // main = colour draws (the §5.3 cap); the depth-only architecture prepass is reported on its own (in total)
      dc.end();
    },
    /** Attach CORE's §5.3 draw split (main.ts) so `render.programs` reuses its program classification. */
    useDrawSplit(s) { split = s; },
    /** One-shot hook run right after the final pass wrote the canvas (probe.ts readbacks). */
    afterRender: null,
    lost: false,
    setSize(w, h) {
      composer.setSize(w, h, false);
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      U.uResolution.value.copy(s);
    },
    setEnabled(v) { enabled = !!v; },
    setDebugEdge(on) { edge.debug = on; },
    /** Silhouette-check frame on/off (also `?silhouette=1`). */
    setSilhouette(on) { if (!on) { silhouette?.dispose(); silhouette = null; } else silhouette ??= createSilhouette({ renderer, scene, camera }); },
    get edge() { return edge; },
    get n8ao() { return n8ao; },
    /** debug: the effect instances (perf experiments, `__hqRender.post.fx.smaa`) */
    get fx() { return { smaa, fxaa, bloom, edge, aoFx, tone, lut, vignette, noise, ca }; },
    get charPassImpl() { return charPass; },
    get tier() { return tier; },
    stats(): PostStats {
      // one classification (m2 fix r3): CORE drawSplit's (compile-context) when attached, else its cache-key rule
      const ps = split ? split.programs() : programSplit(renderer.info.programs, isSceneProgram);
      program.scene = ps.scene; program.post = ps.post;
      return { drawCalls: { ...counts, portrait: 0 }, tris: triSplit(), programs: { ...program }, warmup: warmup.stats(), tier, lut: lutKey, shadowCache: shadowCache.stats(), monitorAtlas: { ...monitorAtlasStats(), modes: deskScreenModes() } };
    },
    /** Force the static shadow layer to re-render next frame (tests, context restore). */
    invalidateShadows() { shadowCache.invalidate(); },
    /**
     * Per-pass GPU time (ms, mean over `ms` of frames) via EXT_disjoint_timer_query_webgl2; null when unsupported.
     * Debug / review only (`await __hqRender.post.gpuProfile(2000)`); zero cost while not running.
     */
    gpuProfile(ms = 2000) { return gpuProf.run(ms); },
    dispose() { composer.dispose(); lutTex.dispose(); shadowCache.dispose(); },
  };
  hqStatSection('render', () => self.stats());
  /** debug handle (devtools / review scripts): __hqRender.post.setDebugEdge(true), __hqRender.U … */
  globalThis.__hqRender = { post: self, U };
  installProbe({ renderer, scene, camera, post: self });
  installContextLoss({ renderer, post: self, rebuild: () => { lutKey = ''; frameTimer.reset(); warmup.reset(); shadowCache.invalidate(); build(quality?.tier ?? 'medium'); } });
  return self;
}
