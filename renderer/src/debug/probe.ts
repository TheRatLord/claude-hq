/**
 * Radiometry probes (§5.0, §5.1, §9.1): `__hq.probe`, `lumaStats`, `surfaceStats`, `clayCheck`, `edgeCheck`.
 * All readbacks are asynchronous (PBO + fence / readRenderTargetPixelsAsync); synchronous readPixels is never used.
 * - pre  = the composer input buffer right after CharPass (linear, pre-tonemap, half float)
 * - post = the final canvas pixel (sRGB, 0..255)
 * Owns the emissive-gain override used by `lumaStats({emissive:false})`.
 * Owner: RND.
 */
import * as THREE from 'three';
import { hqRegister } from '../core/debug.ts';
import { tallyPoints } from '../render/deskScreens.ts';
import { U } from '../render/uniforms.ts';
import { getMaterial } from '../render/materials/index.ts';
import { KEY_DIR, POOL_CONE } from '../render/lightMath.ts';
import { markCaster } from '../render/layers.ts';
import { CORE, BODY, MISC, srgbToLinear, linearRgbToLab, hexToLab, deltaE2000 } from '../../../shared/palette.ts';
import { POSES } from './poses.ts';
import { lumaQuantiles } from '../render/lumaStats.ts';
import type { LumaTarget } from '../render/lumaStats.ts';
import type { Post } from '../render/post.ts';
import type { Rgb } from '../../../shared/palette.ts';

type Phase = 'day' | 'golden' | 'night';
type Range = readonly [number, number];
interface SurfaceTarget { wallLit: Range; wallShade: Range; floor: Range; ceiling: Range; ceilingDark: Range; wallMinusFloor: number; poolDelta: Range }
const isRange = (v: unknown): v is Range => Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
/** The [min, max] row of a surface target by name (pose probes carry arbitrary keys; unknown / scalar rows → undefined). */
const rangeOf = (tgt: SurfaceTarget, k: string): Range | undefined => {
  const v: unknown = new Map(Object.entries(tgt)).get(k);
  return isRange(v) ? v : undefined;
};

/** One captured frame: `post` = the final canvas (RGBA8), `pre` = the CharPass input (linear half float → f32); null when not asked for. */
export interface Frame { w: number; h: number; post: Uint8Array | null; pre: Float32Array | null; preW: number; preH: number }
export interface CaptureOpts { pre: boolean; post: boolean }

const REF = { w: 1600, h: 900 }; // pose probe pixels are authored at 1600×900

/**
 * §5.0 rendered L* targets per phase. [min, max]
 * RND fix r1 (art review "time of day barely changes the interior"; DESIGN §5.0 row change proposed to LEAD): the
 * golden and night rows follow the hour exposure (lightMath EXPOSURE_KEYS): golden hour dims the room ~25 % so the
 * low sun reads, and a 22 h interior sits ~40 % under 13 h in frame luma with the lamp pools as the light sources
 * (pools now read +8…+36 over their floor; the STR ceiling, dark by design, goes darker still after dark). Measured
 * at spawn / pitOverview / street / cafe (1600×900, medium, demo): golden walls 57–66, floors 37–42, ceilings 46–50;
 * night walls 37–43, floors 23–31, ceilings 27–30, pools +10…+33, lumaStats p50 0.075–0.106.
 */
export const SURFACE_TARGETS: Readonly<Record<Phase, SurfaceTarget>> = Object.freeze({
  day: { wallLit: [65, 78], wallShade: [60, 78], floor: [40, 50], ceiling: [55, 70], ceilingDark: [28, 45], wallMinusFloor: 15, poolDelta: [-99, 4] },
  golden: { wallLit: [54, 72], wallShade: [44, 72], floor: [34, 50], ceiling: [42, 66], ceilingDark: [24, 42], wallMinusFloor: 14, poolDelta: [-99, 8] },
  night: { wallLit: [34, 52], wallShade: [28, 52], floor: [20, 34], ceiling: [24, 42], ceilingDark: [12, 34], wallMinusFloor: 6, poolDelta: [8, 36] },
});
export const LUMA_TARGETS: Readonly<Record<Phase, LumaTarget>> = Object.freeze({
  day: { p99: 0.85, p50: 0.2, p10: 0.04, bloomFrac: 0.01 },
  golden: { p99: 0.85, p50: 0.12, p10: 0.035, bloomFrac: 0.012 },
  night: { p99: 0.88, p50: 0.07, p10: 0.015, bloomFrac: 0.015 },
});
const phaseOf = (h: number): Phase => (h >= 8 && h < 17 ? 'day' : (h >= 6 && h < 8) || (h >= 17 && h < 19) ? 'golden' : 'night');

const lab8 = (rgb: readonly number[]) => linearRgbToLab([srgbToLinear(rgb[0] / 255), srgbToLinear(rgb[1] / 255), srgbToLinear(rgb[2] / 255)]);
const Lstar = (rgb: readonly number[]): number => lab8(rgb)[0];
const median = (a: readonly number[]): number => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const round = (v: number, n = 2): number => +v.toFixed(n);

/** The live handle the probes drive (`window.__hq`, set by installHq before any probe runs). */
const liveHq = () => {
  const hq = window.__hq;
  if (!hq) throw new Error('probe: window.__hq is not installed');
  return hq;
};

/** three's internal per-render-target record (`renderer.properties.get(rt)`); `properties.get` is typed `unknown`. */
interface TargetProps { __webglFramebuffer?: WebGLFramebuffer | null }
const framebufferOf = (renderer: THREE.WebGLRenderer, rt: THREE.RenderTarget): WebGLFramebuffer | null =>
  (renderer.properties.get(rt) as TargetProps).__webglFramebuffer ?? null;
const preOf = (f: Frame): Float32Array => { if (!f.pre) throw new Error('probe: frame has no pre pixels'); return f.pre; };
const postOf = (f: Frame): Uint8Array => { if (!f.post) throw new Error('probe: frame has no post pixels'); return f.post; };

export type SurfaceBinName = 'wallLit' | 'wallShade' | 'floor' | 'ceiling' | 'ceilingDark';
const BIN_NAMES: readonly SurfaceBinName[] = ['wallLit', 'wallShade', 'floor', 'ceiling', 'ceilingDark'];
export interface SurfaceBin { L: number; n: number; albedoL?: number }
export interface PoolCand extends SurfaceBin { at: [number, number]; outside: number; outsideAt: [number, number] }
export interface PoolInfo extends PoolCand { delta: number; lamp: [number, number, number]; zone: string | null }
export interface SurfaceEntry {
  L: number; rgb?: number[]; n?: number; albedoL?: number; outside?: number; at?: [number, number]; outsideAt?: [number, number];
  target: Range | null; pass: boolean | null; goboOff?: boolean; goboOffL?: number;
}
export interface SurfaceOpts { auto?: boolean; samples?: boolean; pools?: boolean }
export interface SurfaceOut {
  pose: string | null; hour: number; phase: Phase; auto: boolean; surfaces: Record<string, SurfaceEntry>; pass: boolean;
  samples?: [number, number, string, number][]; pools?: PoolInfo[];
  goboPatch?: { L: number; max: number; pass: boolean };
  wallMinusFloor?: { value: number; min: number; pass: boolean };
  poolDelta?: { value: number; range: Range; pass: boolean };
}
export interface LumaOut {
  maxAt: number[]; max: number; p99: number; p50: number; p10: number; bloomFrac: number; excluded: number; hour: number; emissive: boolean;
  maskUrl?: string; pass?: boolean; targets?: LumaTarget;
}
export interface ClaySample { rgb: number[]; pre: number[]; L: number; dE: number | null }
export interface ClayOut {
  hour: number; proxy: string; lit: ClaySample; shadow: ClaySample; castShadow: ClaySample;
  codex: { litL: number; shadowL: number; castL: number; eyeDL: number; hullDE: number; pass: boolean }; pass: boolean;
}
export interface EdgeOut { pose: string | null; crop: readonly number[] | 'auto'; floorPx: number; stepPx: number; floorCoverage: number; swimXor: number; pass: boolean | null }
export interface HueOut {
  samples: number; frac: number; min: number; failMedian: { L: number; C: number; h: number } | null; pass: boolean | null;
  mask?: [number, number][]; fails?: number[][];
}
export interface GreyOut { top: { at: number[]; rms: number; on: string | null }[]; onTarget: number; pass: boolean }
/** What `installProbe` returns and registers with `hqRegister`. */
export interface ProbeApi {
  capture(o?: CaptureOpts): Promise<Frame>;
  probe(x: number, y: number): Promise<{ pre: number[]; post: number[] }>;
  lumaStats(o?: { emissive?: boolean; mask?: number }): Promise<LumaOut>;
  surfaceStats(name?: string | (SurfaceOpts & { name?: string | null }) | null, o?: SurfaceOpts): Promise<SurfaceOut>;
  clayCheck(o?: { hour?: number }): Promise<ClayOut>;
  edgeCheck(name?: string | null): Promise<EdgeOut>;
  hueGapCheck(opts?: { mask?: boolean; fails?: boolean }): Promise<HueOut>;
  greyCheck(): Promise<GreyOut>;
}

export function installProbe({ renderer, scene, camera, post }: {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  post: Pick<Post, 'afterRender' | 'charPassImpl' | 'setDebugEdge'>;
}): ProbeApi {
  // three is WebGL2-only (r163+), but `getContext()` is typed as the union
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let pending: { pre: boolean; post: boolean; resolve: (f: Frame) => void }[] = [];
  let preRT: THREE.WebGLRenderTarget | null = null;

  const ensurePreRT = (w: number, h: number): THREE.WebGLRenderTarget => {
    if (!preRT || preRT.width !== w || preRT.height !== h) {
      preRT?.dispose();
      preRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
    }
    return preRT;
  };

  const waitSync = (sync: WebGLSync) => new Promise<void>((res) => {
    const poll = () => {
      const r = gl.clientWaitSync(sync, 0, 0);
      if (r === gl.TIMEOUT_EXPIRED) setTimeout(poll, 4); else { gl.deleteSync(sync); res(); }
    };
    poll();
  });

  // pre: blit the CharPass output into our own RT (the ping-pong buffer is overwritten by later passes)
  let preCopy: THREE.WebGLRenderTarget | null = null;
  post.charPassImpl.onInput = (r, inputBuffer) => {
    if (!pending.some((p) => p.pre)) return;
    const rt = ensurePreRT(inputBuffer.width, inputBuffer.height);
    r.setRenderTarget(rt);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebufferOf(r, inputBuffer));
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebufferOf(r, rt));
    gl.blitFramebuffer(0, 0, rt.width, rt.height, 0, 0, rt.width, rt.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    r.setRenderTarget(inputBuffer);
    preCopy = rt;
  };

  post.afterRender = async () => {
    if (!pending.length) return;
    const jobs = pending; pending = [];
    const needPost = jobs.some((j) => j.post), needPre = jobs.some((j) => j.pre);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = size.x, h = size.y;
    let postData: Uint8Array | null = null, preData: Float32Array | null = null;
    let postP: Promise<void> | null = null;
    if (needPost) {
      renderer.setRenderTarget(null);
      const pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) throw new Error('probe: fenceSync failed');
      gl.flush();
      postP = waitSync(sync).then(() => {
        postData = new Uint8Array(w * h * 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, postData);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteBuffer(pbo);
      });
    }
    let preP: Promise<void> | null = null;
    if (needPre && preCopy) {
      const raw = new Uint16Array(preCopy.width * preCopy.height * 4);
      preP = renderer.readRenderTargetPixelsAsync(preCopy, 0, 0, preCopy.width, preCopy.height, raw).then(() => {
        preData = new Float32Array(raw.length);
        for (let i = 0; i < raw.length; i++) preData[i] = THREE.DataUtils.fromHalfFloat(raw[i]);
      });
    }
    await Promise.all([postP, preP]);
    const frame: Frame = { w, h, post: postData, pre: preData, preW: preCopy?.width ?? w, preH: preCopy?.height ?? h };
    for (const j of jobs) j.resolve(frame);
  };

  /** Capture the next rendered frame. */
  const capture = (o: CaptureOpts = { pre: true, post: true }) => new Promise<Frame>((resolve) => pending.push({ ...o, resolve }));
  const frames = (n: number) => new Promise<void>((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

  /** CSS (1600×900-authored or live CSS) px → buffer px, y flipped. */
  const toBuf = (frame: Frame, x: number, y: number, authored = false): [number, number] => {
    const cw = authored ? REF.w : innerWidth, ch = authored ? REF.h : innerHeight;
    const bx = Math.round((x / cw) * frame.w), by = Math.round((1 - y / ch) * frame.h) - 1;
    return [Math.min(frame.w - 1, Math.max(0, bx)), Math.min(frame.h - 1, Math.max(0, by))];
  };
  const postAt = (f: Frame, bx: number, by: number): number[] => { const d = postOf(f), i = (by * f.w + bx) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const preAt = (f: Frame, bx: number, by: number): number[] => {
    const d = preOf(f);
    const px = Math.round((bx / f.w) * f.preW), py = Math.round((by / f.h) * f.preH);
    const i = (py * f.preW + px) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  };
  /** 5×5 median of the post pixel around a buffer point. */
  const post5 = (f: Frame, bx: number, by: number): number[] => {
    const r: number[] = [], g: number[] = [], b: number[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const p = postAt(f, Math.min(f.w - 1, Math.max(0, bx + dx)), Math.min(f.h - 1, Math.max(0, by + dy)));
      r.push(p[0]); g.push(p[1]); b.push(p[2]);
    }
    return [median(r), median(g), median(b)];
  };

  async function probe(x: number, y: number) {
    const f = await capture();
    const [bx, by] = toBuf(f, x, y);
    return { pre: preAt(f, bx, by).map((v) => round(v, 4)), post: postAt(f, bx, by) };
  }

  async function lumaStats({ emissive = true, mask = 0 }: { emissive?: boolean; mask?: number } = {}): Promise<LumaOut> {
    const normal = await capture({ pre: true, post: false });
    const hour = window.__hq?.ctx.hour ?? 13;
    const tgt = LUMA_TARGETS[phaseOf(hour)];
    // m2 fix r3 (render/lumaStats.ts): with emissives off, light sources (Board, screens, bulbs, shades) and the window
    // sky are masked out of the measure by a second frame in which they render black; the row is about lit surfaces
    let off: Frame | null = null;
    if (emissive === false) {
      U.uEmissiveGain.value = 0; U.uScreenMask.value = 1; U.uSkyMask.value = 1;
      try { await frames(1); off = await capture({ pre: true, post: false }); } finally { U.uEmissiveGain.value = 1; U.uScreenMask.value = 0; U.uSkyMask.value = 0; }
    }
    const f = off ?? normal;
    const r = lumaQuantiles(preOf(normal), off?.pre ?? null, tgt, emissive === false ? { maxCap: 0.95 } : {});
    const arg = Math.max(0, r.maxIdx);
    const maxAt = [Math.round(((arg % f.preW) / f.preW) * innerWidth), Math.round((1 - Math.floor(arg / f.preW) / f.preH) * innerHeight)];
    const lum = (d: ArrayLike<number>, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const out: LumaOut = { maxAt, max: r.max, p99: r.p99, p50: r.p50, p10: r.p10, bloomFrac: r.bloomFrac, excluded: r.excluded, hour: round(hour, 2), emissive };
    if (mask) {
      // debug: a PNG (data URL) of the frame's luminance with every pixel under `mask` (e.g. 0.04 = the p10 floor)
      // painted red, so the dark content that drags p10 down can be found
      const cv = document.createElement('canvas'); cv.width = f.preW; cv.height = f.preH;
      const g = cv.getContext('2d');
      if (!g) throw new Error('lumaStats: no 2d canvas context');
      const img = g.createImageData(f.preW, f.preH), fPre = preOf(f);
      for (let y = 0; y < f.preH; y++) for (let x = 0; x < f.preW; x++) {
        const i = ((f.preH - 1 - y) * f.preW + x) * 4, o = (y * f.preW + x) * 4;
        const l = lum(fPre, i), v = Math.min(255, Math.sqrt(Math.max(0, l)) * 255);
        img.data[o] = l < mask ? 255 : v; img.data[o + 1] = l < mask ? 0 : v; img.data[o + 2] = l < mask ? 0 : v; img.data[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      out.maskUrl = cv.toDataURL('image/png');
    }
    out.pass = r.pass;
    out.targets = tgt;
    return out;
  }

  const currentPoseName = () => {
    const p = window.__hq?.ctx.player.getPose();
    if (!p) return null;
    let best: string | null = null, bd = 0.05;
    for (const [k, v] of Object.entries(POSES)) {
      const d = v.pose.reduce((s, c, i) => s + Math.abs(c - p[i]), 0);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };

  /**
   * Automatic surface probes (M1.75, used when a pose has no authored probe pixels, or with `{auto:true}`): a grid of
   * camera rays against the opaque world (ENV|PROPS, glass skipped); a ray counts only when its first hit is
   * architecture (toonEnv) and the pixel is not covered by a character or screen FX (pre alpha 1). Hits are binned by
   * world normal: floor (n.y > 0.8, level of the camera's feet ±0.6 m), ceiling (n.y < −0.8), walls (|n.y| < 0.3)
   * split into lit / shade by the horizontal studio-key term; lamp pools are excluded by the median.
   * Returns the per-class median L* of the 5×5 post pixels, plus the sample counts.
   */
  const ray = new THREE.Raycaster();
  ray.layers.set(1); ray.layers.enable(2); // LAYERS.ENV | LAYERS.PROPS
  const isMesh = (o: THREE.Object3D): o is THREE.Mesh => 'isMesh' in o && o.isMesh === true;
  /** The single material of a hit mesh (multi-material meshes have none of the flags read here). */
  const matOf = (o: THREE.Object3D): THREE.Material | null => (isMesh(o) && !Array.isArray(o.material) ? o.material : null);
  const hqKindOf = (o: THREE.Object3D): string => {
    const k: unknown = matOf(o)?.userData?.hqKind;
    return typeof k === 'string' ? k : '';
  };
  function autoSurfaces(f: Frame, samples: [number, number, string, number][] | null = null, fPool: Frame = f, allPools: PoolInfo[] | null = null): { bins: Partial<Record<SurfaceBinName, SurfaceBin>>; floorPool: PoolCand | null } {
    const feetY = window.__hq?.ctx.player.getPose()[1] ?? 0;
    const darkZone = /^(STR|MEZ|ENG)$/.test(window.__hq?.ctx.camZone ?? '');
    const KX = KEY_DIR[0], KZ = KEY_DIR[2], kl = Math.hypot(KX, KZ);
    const bins: Record<SurfaceBinName, number[]> = { wallLit: [], wallShade: [], floor: [], ceiling: [], ceilingDark: [] };
    const alb: Partial<Record<SurfaceBinName, number[]>> = {};
    const zoneAt = window.__hq?.ctx.layout.zoneAt;
    const objs: THREE.Mesh[] = [];
    scene.traverse((o) => { if (isMesh(o) && o.visible && (o.layers.mask & 0b110)) objs.push(o); });
    const NX = 40, NY = 22, v2 = new THREE.Vector2(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    camera.updateMatrixWorld();
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      v2.set(((i + 0.5) / NX) * 2 - 1, ((j + 0.5) / NY) * 2 - 1);
      ray.setFromCamera(v2, camera);
      ray.far = 25;
      const hits = ray.intersectObjects(objs, false);
      const hit = hits.find((h) => !/glass|sky/.test(hqKindOf(h.object)));
      if (!hit || hqKindOf(hit.object) !== 'toonEnv' || !hit.face) continue;
      const bx = Math.round(((v2.x + 1) / 2) * (f.w - 1)), by = Math.round(((v2.y + 1) / 2) * (f.h - 1));
      if (f.pre && preAt(f, bx, by)[3] < 0.99) continue;
      nm.getNormalMatrix(hit.object.matrixWorld);
      n.copy(hit.face.normal).applyMatrix3(nm).normalize();
      if (n.dot(ray.ray.direction) > 0) n.negate();
      const L = Lstar(post5(f, bx, by));
      // walls/ceilings: only light architectural albedos (the §5.0 rows are about cream/oat planes, not ink frames,
      // the Big Board shell or vertex-coloured trim)
      const mat = matOf(hit.object);
      const matColor = mat && 'color' in mat && mat.color instanceof THREE.Color ? mat.color : null;
      let c = matColor ? [matColor.r, matColor.g, matColor.b] : [0, 0, 0];
      const vc = mat && 'vertexColors' in mat && mat.vertexColors && isMesh(hit.object) ? hit.object.geometry.attributes.color : null;
      if (vc) c = [vc.getX(hit.face.a) * c[0], vc.getY(hit.face.a) * c[1], vc.getZ(hit.face.a) * c[2]];
      const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      // §5.0 wall row = cream/oat planes (albedo L* 74–84 → Y ≥ 0.40); ceilings ≥ 0.30 (value map 60–76)
      // dark-by-design zones (STR / MEZ / ENG ceilings 28–45; STR painted brick 62) keep their own planes
      // a ceiling belongs to the zone it hangs over (from the mezzanine you see the atrium's ceiling, not MEZ's)
      const ceilDark = n.y < -0.8 && /^(STR|MEZ|ENG)$/.test(zoneAt?.(hit.point.x, hit.point.z, hit.point.y > 2.8 ? 1 : 0) ?? '');
      const light = n.y < -0.8 ? Y >= (ceilDark ? 0.04 : 0.3) : Y >= (darkZone ? 0.2 : 0.4);
      let cls: SurfaceBinName | null = null;
      if (n.y > 0.8) { if (hit.point.y < feetY + 0.6) cls = 'floor'; } else if (!light) continue;
      else if (n.y < -0.8) cls = ceilDark ? 'ceilingDark' : 'ceiling';
      else if (Math.abs(n.y) < 0.3) cls = (n.x * KX + n.z * KZ) / kl > 0.1 ? 'wallLit' : 'wallShade';
      if (!cls) continue;
      bins[cls].push(L);
      (alb[cls] ??= []).push(Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y);
      samples?.push([Math.round(((v2.x + 1) / 2) * innerWidth), Math.round(((1 - v2.y) / 2) * innerHeight), cls, Math.round(L)]);
    }
    const res: Partial<Record<SurfaceBinName, SurfaceBin>> = {};
    let floorPool: PoolCand | null = null;
    // albedo L* median alongside (linear vertex/material colour): tells "dark by paint" from "dark by light"
    for (const k of BIN_NAMES) { const a = bins[k]; if (a.length >= 4) res[k] = { L: round(median(a), 1), n: a.length, albedoL: round(median(alb[k] ?? []), 1) }; }
    // lamp pool (§5.0 pool rows): the nearest active pool whose floor spot (0.45 m from the lamp toward the camera, clear
    // of its base) is visible bare floor; its 5×5 L* against the floor median
    const cam = camera.position, pv = new THREE.Vector3();
    const pools = U.uLampPos.value.map((p, i) => ({ p, c: U.uLampCol.value[i] })).filter((q) => q.p.w !== 0 && (q.c.r + q.c.g + q.c.b) > 0.01)
      .sort((a, b) => (a.p.x - cam.x) ** 2 + (a.p.z - cam.z) ** 2 - (b.p.x - cam.x) ** 2 - (b.p.z - cam.z) ** 2);
    const floorAt = (x: number, z: number): { L: number; mat: THREE.Material | THREE.Material[]; at: [number, number] } | null => {
      pv.set(x, feetY, z);
      const ndc = pv.clone().project(camera);
      if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.95 || ndc.z > 1) return null;
      ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      const hit = ray.intersectObjects(objs, false).find((h) => !/glass|sky/.test(hqKindOf(h.object)));
      if (!hit || !isMesh(hit.object) || hqKindOf(hit.object) !== 'toonEnv' || hit.point.distanceTo(pv) > 0.3) return null;
      const bx = Math.round(((ndc.x + 1) / 2) * (f.w - 1)), by = Math.round(((ndc.y + 1) / 2) * (f.h - 1));
      if (f.pre && preAt(f, bx, by)[3] < 0.99) return null;
      return { L: Lstar(post5(fPool, bx, by)), mat: hit.object.material, at: [Math.round(((ndc.x + 1) / 2) * innerWidth), Math.round(((1 - ndc.y) / 2) * innerHeight)] };
    };
    let tried = 0;
    for (const { p } of pools) {
      const dx = cam.x - p.x, dz = cam.z - p.z, d = Math.hypot(dx, dz) || 1, aw = Math.abs(p.w), r = (aw % 10000) % 100; // lamps.ts poolCode
      // pool centre (0.45 m toward the camera, clear of the lamp base) vs the same floor material just outside the pool.
      // M3.5: rugs / furniture often cover that spot, so up to 8 directions round the lamp (camera side first) and
      // three inner radii are tried; the first bare-floor pair (inside + outside on the same floor) is measured
      const a0 = Math.atan2(dz / d, dx / d);
      let cand: PoolCand | null = null;
      for (let k = 0; k < 8 && !cand; k++) {
        const ang = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
        const ux = Math.cos(ang), uz = Math.sin(ang);
        for (const rin of [0.45, 0.25, 0.7]) {
          const a = floorAt(p.x + ux * rin, p.z + uz * rin);
          if (!a) continue;
          let b: ReturnType<typeof floorAt> = null;
          // outside: just past the pool disk (radius = pool + cone × drop, toon.ts), then past the wash reach (small
          // rooms: the reach often ends beyond the wall)
          const disk = Math.floor((aw % 10000) / 100) * 0.1 + (p.w < 0 ? POOL_CONE * Math.max(0, p.y - feetY) : 0);
          for (const q of [disk * 1.2, disk * 1.45, r * 1.05, r * 1.25, r * 1.5]) { if (q <= rin + 0.3) continue; b = floorAt(p.x + ux * q, p.z + uz * q); if (b && b.mat === a.mat) break; b = null; }
          if (!b) continue;
          cand = { L: round(a.L, 1), n: 1, at: a.at, outside: round(b.L, 1), outsideAt: b.at };
          break;
        }
      }
      if (!cand) continue;
      // M3.5 (night pools per zone): `surfaceStats({auto:true, pools:true})` lists every measurable active pool
      allPools?.push({ ...cand, delta: round(cand.L - cand.outside, 1), lamp: [round(p.x, 2), round(p.y, 2), round(p.z, 2)], zone: zoneAt?.(p.x, p.z, p.y > 2.8 ? 1 : 0) ?? null });
      if (!floorPool || cand.L - cand.outside > floorPool.L - floorPool.outside) floorPool = cand;
      if (++tried >= 3 && !allPools) break;   // the strongest of the 3 nearest measurable pools
    }
    return { bins: res, floorPool };
  }

  async function surfaceStats(nameArg?: string | (SurfaceOpts & { name?: string | null }) | null, o: SurfaceOpts = {}): Promise<SurfaceOut> {
    let { auto = false, samples = false, pools = false } = o;
    let name: string | null | undefined;
    if (typeof nameArg === 'object' && nameArg) ({ name, auto = false, samples = false, pools = false } = nameArg);
    else name = nameArg;
    name = name ?? currentPoseName();
    const def = name ? POSES[name] : null;
    const useAuto = auto || !def?.probes;
    const f = await capture({ pre: useAuto, post: true });
    const hour = window.__hq?.ctx.hour ?? 13;
    const phase = phaseOf(hour);
    // the §5.0 lamp-pool rows are about lamps: by day / golden hour a sun patch (gobo) can cover the pool probe and
    // read as a +20 "pool" (fix r1), so the pool delta is measured on a second frame with the gobo off, and the patch
    // itself is reported against its own row (gobo ≤ 62 day / ≤ 66 golden)
    let fPool = f;
    if (phase !== 'night' && U.uGobo.value > 0) {
      const g = U.uGobo.value;
      U.uGobo.value = 0;
      try { await frames(1); fPool = await capture({ pre: false, post: true }); } finally { U.uGobo.value = g; }
    }
    const tgt = SURFACE_TARGETS[phase];
    const out: SurfaceOut = { pose: name, hour: round(hour, 2), phase, auto: useAuto, surfaces: {}, pass: true };
    if (useAuto) {
      const list: [number, number, string, number][] | null = samples ? [] : null;
      if (list) out.samples = list;
      const all: PoolInfo[] | null = pools ? [] : null;
      if (all) out.pools = all;
      const auto3 = autoSurfaces(f, list, fPool, all);
      const found: [string, SurfaceBin | PoolCand][] = [...Object.entries(auto3.bins), ...(auto3.floorPool ? [['floorPool', auto3.floorPool] as [string, PoolCand]] : [])];
      for (const [k, s] of found) {
        // STR / MEZ / ENG ceilings are dark by design (§5.0 table: 28–45)
        const zone = window.__hq?.ctx.camZone ?? '';
        const range: Range | undefined = k === 'ceilingDark' ? tgt.ceilingDark : /^wall/.test(k) && zone === 'STR' && phase === 'day' ? [55, 65] : rangeOf(tgt, k);
        const ok = range ? s.L >= range[0] && s.L <= range[1] : null;
        out.surfaces[k] = { ...s, target: range ?? null, pass: ok };
        if (ok === false) out.pass = false;
      }
    } else for (const [k, [x, y]] of Object.entries(def?.probes ?? {})) {
      const [bx, by] = toBuf(f, x, y, true);
      const rgb = post5(f, bx, by);
      const L = round(Lstar(rgb), 1);
      const range = rangeOf(tgt, k);
      const ok = range ? L >= range[0] && L <= range[1] : null;
      out.surfaces[k] = { L, rgb, target: range ?? null, pass: ok };
      if (ok === false) out.pass = false;
      if (k === 'floorPool' && fPool !== f) {
        const L0 = round(Lstar(post5(fPool, bx, by)), 1);
        if (L - L0 > 2) {
          const max = phase === 'golden' ? 66 : 62;
          const goboPatch = { L, max, pass: L <= max };
          out.goboPatch = goboPatch;
          if (!goboPatch.pass) out.pass = false;
        }
        out.surfaces[k] = { L: L0, rgb: post5(fPool, bx, by), target: null, pass: null, goboOff: true };
      }
    }
    const floorProbe = def?.probes?.floor;
    if (fPool !== f && def?.probes?.floorPool && floorProbe && out.surfaces.floor) {
      const [bx, by] = toBuf(f, floorProbe[0], floorProbe[1], true);
      out.surfaces.floor.goboOffL = round(Lstar(post5(fPool, bx, by)), 1);
    }
    const s = out.surfaces;
    if (s.wallLit && s.floor) {
      const d = round(s.wallLit.L - s.floor.L, 1);
      const wmf = { value: d, min: tgt.wallMinusFloor, pass: d >= tgt.wallMinusFloor };
      out.wallMinusFloor = wmf;
      if (!wmf.pass) out.pass = false;
    }
    if (s.floorPool && s.floor) {
      const d = round(s.floorPool.L - (s.floorPool.outside ?? s.floor.goboOffL ?? s.floor.L), 1);
      const pd = { value: d, range: tgt.poolDelta, pass: d >= tgt.poolDelta[0] && d <= tgt.poolDelta[1] };
      out.poolDelta = pd;
      if (!pd.pass) out.pass = false;
    }
    return out;
  }

  /**
   * clayCheck: a probe sheet (lit clay, clay in a cast shadow, codex slate lit + in shadow, a paper eye) is placed
   * 1.7 m in front of a probe camera looking across the key direction, rendered through the full stack and sampled.
   * Until CHR's `?sheet=hero` lands this proxies the hero body with a capsule of the same size and the same
   * toonChar program (the check is about the lighting/grade contract, not the rig).
   */
  async function clayCheck({ hour }: { hour?: number } = {}): Promise<ClayOut> {
    const hq = liveHq();
    const prevHour = hq.ctx.clock.hourPin;
    const prevPose = hq.ctx.player.getPose();
    if (hour !== undefined) hq.setHour(hour);
    const group = new THREE.Group();
    const L = new THREE.Vector3(...KEY_DIR);
    // Probe camera stands east of the sheet, looking west, 1.7 m away at eye height.
    const spot = hq.ctx.layout.probeSpot;
    const base = spot ? new THREE.Vector3(spot.x, 0, spot.z) : new THREE.Vector3(prevPose[0], prevPose[1], prevPose[2]);
    const camPos = base.clone();
    const target = base.clone().add(new THREE.Vector3(-1.7, 0, 0));
    const geo = new THREE.CapsuleGeometry(0.27, 0.3, 8, 24).translate(0, 0.44, 0);
    const mk = (color: string, x: number, z: number, rim?: number) => { const m = new THREE.Mesh(geo, getMaterial('toonChar', { color, rim })); m.position.set(target.x + x, target.y, target.z + z); m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
    const clay = mk(BODY.bodyClay, 0, -0.6), clayS = mk(BODY.bodyClay, 0, 0.6);
    const codexM = mk(BODY.bodySlate, 0, -1.3, 0.52), codexS = mk(BODY.bodySlate, 0, 1.3, 0.52); // codex: rim × 1.5 (§5.5)
    // paper eye on the lit clay body
    const eyeM = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), getMaterial('toonChar', { color: MISC.trim }));
    eyeM.position.set(clay.position.x + 0.26, 0.62, clay.position.z); group.add(eyeM);
    // occluders: slabs 1.2 m toward the key over the "shadow" bodies (desk-top stand-ins)
    {
      const occ = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 1.5), getMaterial('toonProp', { color: CORE.ink2 }));
      occ.position.set(target.x, 0.44, target.z + 0.95).addScaledVector(L, 1.5);
      markCaster(occ); group.add(occ);
    }
    scene.add(group);
    try {
      hq.setPose(camPos.x, camPos.y + 0.05, camPos.z, Math.PI / 2, -0.12);
      await frames(4);
      const f = await capture({ pre: true, post: true });
      camera.updateMatrixWorld();
      const toCam = (m: THREE.Object3D) => new THREE.Vector3().subVectors(camera.position, m.position).setY(0).normalize();
      // pick the visible surface normal with the lowest N·L (the self-shadow band) and the most lit one
      const surf = (m: THREE.Object3D, mode: 'lit' | 'shadow'): { rgb: number[]; pre: number[] } => {
        const tc = toCam(m); let best: THREE.Vector3 | null = null, bs = mode === 'shadow' ? 9 : -9;
        for (let a = 0; a < 64; a++) {
          const n = new THREE.Vector3(Math.cos((a / 64) * Math.PI * 2), 0, Math.sin((a / 64) * Math.PI * 2));
          if (n.dot(tc) < (mode === 'shadow' ? 0.6 : 0.45)) continue;
          const s = n.dot(L);
          if (mode === 'shadow' ? s < bs : s > bs) { bs = s; best = n; }
        }
        if (!best) throw new Error('clayCheck: no surface faces the probe camera');
        const p = m.position.clone().addScaledVector(best, mode === 'shadow' ? 0.22 : 0.25); p.y = m.position.y + (mode === 'shadow' ? 0.44 : 0.62);
        const v = p.project(camera);
        const [bx, by] = [Math.round((v.x * 0.5 + 0.5) * f.w), Math.round((v.y * 0.5 + 0.5) * f.h)];
        return { rgb: post5(f, bx, by), pre: preAt(f, bx, by).map((q) => round(q, 3)) };
      };
      const res = ({ rgb, pre }: { rgb: number[]; pre: number[] }, ref?: string): ClaySample => ({ rgb: [...rgb], pre, L: round(Lstar(rgb), 1), dE: ref ? round(deltaE2000(lab8(rgb), hexToLab(ref)), 2) : null });
      const lit = res(surf(clay, 'lit'), CORE.clay);
      const shadow = res(surf(clay, 'shadow'), MISC.clayShadow);
      const castShadow = res(surf(clayS, 'lit'), MISC.clayShadow);
      const cLit = res(surf(codexM, 'lit')), cShadow = res(surf(codexM, 'shadow')), cCast = res(surf(codexS, 'lit'));
      const ev = eyeM.position.clone().project(camera);
      const eyeRgb = post5(f, Math.round((ev.x * 0.5 + 0.5) * f.w), Math.round((ev.y * 0.5 + 0.5) * f.h));
      const hullDE = round(deltaE2000(lab8(cLit.rgb), hexToLab(MISC.codexHull)), 1);
      const codex0 = { litL: cLit.L, shadowL: cShadow.L, castL: cCast.L, eyeDL: round(Lstar(eyeRgb) - cLit.L, 1), hullDE };
      const codex = { ...codex0, pass: codex0.litL >= 30 && codex0.shadowL >= 20 && codex0.castL >= 20 && codex0.eyeDL >= 40 && hullDE >= 15 };
      const h = hq.ctx.hour;
      const ph = phaseOf(h);
      const litMax = ph === 'day' ? 6 : 8, shMax = ph === 'day' ? 8 : 10;
      return {
        hour: round(h, 2), proxy: 'capsule', lit, shadow, castShadow, codex,
        pass: (lit.dE ?? NaN) < litMax && (shadow.dE ?? NaN) < shMax && (castShadow.dE ?? NaN) < shMax && codex.pass,
      };
    } finally {
      scene.remove(group);
      geo.dispose();
      hq.setPose(...prevPose);
      if (hour !== undefined) hq.setHour(prevHour);
    }
  }

  /**
   * edgeCheck (§5.1): edge coverage on the floor and frame-to-frame swim (two frames 5 cm apart). The floor region is
   * the pose's authored `floorCrop` when it has one; otherwise (hq poses, M1.75) it is found automatically: the edge
   * debug frame carries a floor flag (reconstructed normal within ~25° of world up) and the region is that mask eroded
   * by 6 px (so the contact creases where floors meet walls and furniture, which are real lines, stay out) and
   * restricted to the lower 30 % of the frame (the near floor, where banding and swim show; the old default crop band).
   * Real steps (≥ 1.5 cm height jump across a line: tread nosings, bench / table tops over the floor) are skipped in both
   * frames (fix r1, §11.5), so the result is decisive (pass true/false) on every pose with ≥ 2000 region px.
   */
  async function edgeCheck(nameArg?: string | null): Promise<EdgeOut> {
    const name = nameArg ?? currentPoseName();
    const def = name ? POSES[name] : null;
    const hq = liveHq();
    const pose = hq.ctx.player.getPose();
    post.setDebugEdge(true);
    try {
      await frames(2);
      const a = await capture({ pre: false, post: true });
      const fx = -Math.sin(pose[3]) * 0.05, fz = -Math.cos(pose[3]) * 0.05;
      hq.setPose(pose[0] + fx, pose[1], pose[2] + fz, pose[3], pose[4]);
      await frames(2);
      const b = await capture({ pre: false, post: true });
      const W = a.w, H = a.h;
      // real steps (edge.ts debug: R set, G clear = a ≥ 1.5 cm height jump across the line, e.g. tread nosings, bench and
      // table tops over the floor) in either frame, dilated 2 px: §5.1 allows those lines, and a silhouette moves by a
      // few px over a 5 cm step, so they are left out of both the region and the swim XOR (§11.5 ENV → RND)
      const aPost = postOf(a), bPost = postOf(b);
      const stepPx = new Uint8Array(W * H);
      for (const fp of [aPost, bPost]) for (let i = 0, k = 0; k < W * H; i += 4, k++) if (fp[i] > 60 && fp[i + 1] < 60) stepPx[k] = 1;
      const D = 2, stepD = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!stepPx[y * W + x]) continue;
        for (let dy = -D; dy <= D; dy++) for (let dx = -D; dx <= D; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < W && yy >= 0 && yy < H) stepD[yy * W + xx] = 1;
        }
      }
      let region: (x: number, y: number) => boolean;
      if (def?.floorCrop) {
        const crop = def.floorCrop;
        const [x0, y1] = toBuf(a, crop[0], crop[1], true), [x1, y0] = toBuf(a, crop[0] + crop[2], crop[1] + crop[3], true);
        region = (x, y) => x >= x0 && x < x1 && y >= Math.max(0, y0) && y <= Math.min(H - 1, y1) && !stepD[y * W + x];
      } else {
        const fl = new Uint8Array(W * H);
        for (let i = 0, k = 0; k < W * H; i += 4, k++) fl[k] = aPost[i + 2] > 60 ? 1 : 0;
        const R = 6, ok = new Uint8Array(W * H);
        for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
          const k = y * W + x;
          if (!fl[k] || y > H * 0.3 || stepD[k]) continue; // buffer y is bottom-up: the lower 28–30 % band (the old default crop), floor only
          if (fl[k - R] && fl[k + R] && fl[k - R * W] && fl[k + R * W]) ok[k] = 1;
        }
        region = (x, y) => ok[y * W + x] === 1;
      }
      let n = 0, ea = 0, xor = 0, steps = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (stepPx[y * W + x]) steps++;
        if (!region(x, y)) continue;
        const i = (y * W + x) * 4;
        const ma = aPost[i + 1] > 60, mb = bPost[i + 1] > 60;
        n++; if (ma) ea++; if (ma !== mb) xor++;
      }
      const floorCoverage = round(ea / Math.max(1, n), 5), swimXor = round(xor / Math.max(1, n), 5);
      // decisive on every pose once the region is big enough (≥ 2000 px): the step skip removed the real creases that
      // made the automatic region report numbers only (pass null) in M1.75 r1
      const ok = floorCoverage <= 0.002 && swimXor <= 0.001;
      return { pose: name, crop: def?.floorCrop ?? 'auto', floorPx: n, stepPx: steps, floorCoverage, swimXor, pass: n > 2000 ? ok : null };
    } finally {
      post.setDebugEdge(false);
      hq.setPose(...pose);
    }
  }

  /**
   * Hue-gap check (§5.5): the 6 px ring just outside the character mask (alpha 0 in the pre buffer), world pixels
   * only; in ≥ 70 % of ring samples the hue must differ from clay (h 44°) by ≥ 60° or the chroma be < 12. Half-res.
   */
  async function hueGapCheck(opts: { mask?: boolean; fails?: boolean } = {}): Promise<HueOut> {
    const f = await capture({ pre: true, post: true });
    // m175 fix r2: the mask is the Clawds' own (bodies + hulls). FX overlays (bubbles, placards, nameplates, rings) also
    // zero the world alpha (overlay.ts coverAlpha), so the old mask sampled a ring round every placard and bubble —
    // wall and railing pixels that are not "behind a Clawd" (at mezzToPit ≈ 40 % of the failing ring was the E2
    // placard's). One extra frame without the OVERLAY layer gives the character-only mask; ring pixels covered by an
    // overlay in the real frame are skipped (they show the FX, not the backdrop)
    // Hull outlines are not only Clawds' (FX placards carry ink hulls too), and the CHARS layer also holds the ink
    // roomba, the grey cat and slate / rose kind bodies, none of which the clay hue rule is about. So the mask is: every
    // connected blob of the chars + hulls frame whose body pixels (chars-only frame) include ≥ 12 clay-hued ones
    // (rendered C* > 22, hue within 22° of clay's 44°: lit clay and its violet-red shadow band both qualify)
    let fm: Frame, fb: Frame;
    const cp = post.charPassImpl;
    try {
      cp.only = 'charsHulls'; await frames(1); fm = await capture({ pre: true, post: false });
      cp.only = 'chars'; await frames(1); fb = await capture({ pre: true, post: false });
    } finally { cp.only = null; }
    const fPre = preOf(f), fmPre = preOf(fm), fbPre = preOf(fb);
    const w = f.preW >> 1, h = f.preH >> 1;
    const ch = new Uint8Array(w * h), world = new Uint8Array(w * h), body = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((y * 2) * f.preW + x * 2) * 4 + 3;
      const a = fPre[i], am = fmPre[i];
      ch[y * w + x] = am < 0.02 ? 1 : 0; body[y * w + x] = fbPre[i] < 0.02 ? 1 : 0; world[y * w + x] = a > 0.98 && am > 0.98 ? 1 : 0;
    }
    {
      const isClay = (k: number): boolean => {
        const x = k % w, y = (k - x) / w;
        const bx = Math.min(f.w - 1, Math.round((x * 2 / f.preW) * f.w)), by = Math.min(f.h - 1, Math.round((y * 2 / f.preH) * f.h));
        const [, A, B] = lab8(postAt(f, bx, by));
        const hue = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
        return Math.hypot(A, B) > 22 && Math.min(Math.abs(hue - 44), 360 - Math.abs(hue - 44)) < 22;
      };
      // flood-fill the mask blobs; keep those with enough clay body pixels
      const lab = new Int32Array(w * h).fill(-1), keep: number[] = [];
      const stack: number[] = [];
      for (let s0 = 0; s0 < w * h; s0++) {
        if (!ch[s0] || lab[s0] >= 0) continue;
        const id = keep.length; keep.push(0);
        lab[s0] = id; stack.push(s0);
        for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
          if (body[k] && isClay(k)) keep[id]++;
          const x = k % w, y = (k - x) / w;
          for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (ch[q] && lab[q] < 0) { lab[q] = id; stack.push(q); }
          }
        }
      }
      for (let k = 0; k < w * h; k++) if (ch[k] && keep[lab[k]] < 12) { ch[k] = 0; world[k] = 0; }
    }
    const R = 3; // 6 px at full res
    const tmp = new Uint8Array(w * h), dil = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let d = -R; d <= R && !m; d++) { const xx = x + d; if (xx >= 0 && xx < w && ch[y * w + xx]) m = 1; } tmp[y * w + x] = m; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let d = -R; d <= R && !m; d++) { const yy = y + d; if (yy >= 0 && yy < h && tmp[yy * w + x]) m = 1; } dil[y * w + x] = m; }
    let n = 0, ok = 0;
    const fails: number[][] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (!dil[k] || ch[k] || !world[k]) continue;
      const bx = Math.min(f.w - 1, Math.round((x * 2 / f.preW) * f.w)), by = Math.min(f.h - 1, Math.round((y * 2 / f.preH) * f.h));
      const [L, A, B] = lab8(postAt(f, bx, by));
      const C = Math.hypot(A, B), hue = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
      const dh = Math.min(Math.abs(hue - 44), 360 - Math.abs(hue - 44));
      n++; if (C < 12 || dh >= 60) ok++; else fails.push([L, C, hue, bx, by]);
    }
    const frac = round(ok / Math.max(1, n), 3);
    const med = (i: number) => round(median(fails.map((q) => q[i])) ?? 0, 1);
    const out: HueOut = { samples: n, frac, min: 0.7, failMedian: fails.length ? { L: med(0), C: med(1), h: med(2) } : null, pass: n < 50 ? null : frac >= 0.7 };
    // debug: `hueGapCheck({fails: true})` lists the failing ring pixels [x, y] (post px) for a failure map
    if (opts.mask) { out.mask = []; for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (ch[y * w + x]) out.mask.push([Math.round(x * 2 * f.w / f.preW), Math.round(y * 2 * f.h / f.preH)]); }
    if (opts.fails) out.fails = fails.map((q) => [q[3], q[4], Math.round(q[0]), Math.round(q[1]), Math.round(q[2])]);
    return out;
  }

  /**
   * Greyscale check (§5.5 / ART §11 #10): the top-10 local-contrast blobs (8×8 px RMS of L*, non-overlapping) must
   * lie on characters / hulls (alpha 0 in the block) or emissive readouts (pixels that dim with the emissive gain off,
   * or pre luminance > 0.9).
   */
  async function greyCheck(): Promise<GreyOut> {
    const f = await capture({ pre: true, post: true });
    // emissive readouts = pixels that dim with the emissive gain off and screens masked (fix r1: the old "pre
    // luminance > 0.9" test missed every §5.0-compliant screen, whose body text is ≤ 0.95, so the Big Board / monitor
    // text blocks read as off-target grey blobs)
    let fe: Frame;
    U.uEmissiveGain.value = 0; U.uScreenMask.value = 1;   // screens / readouts (screen.ts) go black too
    try { await frames(1); fe = await capture({ pre: true, post: false }); } finally { U.uEmissiveGain.value = 1; U.uScreenMask.value = 0; }
    const B = 8, bw = Math.floor(f.w / B), bh = Math.floor(f.h / B);
    const blocks: { i: number; j: number; rms: number; on: string | null; emis: number }[] = [];
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      let s = 0, s2 = 0, charPx = 0, emis = 0;
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
        const bx = i * B + x, by = j * B + y;
        const L = Lstar(postAt(f, bx, by)); s += L; s2 += L * L;
        const p = preAt(f, bx, by), q = preAt(fe, bx, by);
        if (p[3] < 0.5) charPx++;
        const lp = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2], lq = 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2];
        if (lp > 0.9 || lp - lq > 0.08 || (lq < 1e-4 && lp > 1e-3)) emis++;   // masked screens render exactly black
      }
      const m = s / (B * B), rms = Math.sqrt(Math.max(0, s2 / (B * B) - m * m));
      blocks.push({ i, j, rms, on: charPx > 0 ? 'character' : emis > 0 ? 'emissive' : null, emis });
    }
    // a readout's own bezel (the Big Board's brass frame on its black face) belongs to the readout: a block whose
    // 4-neighbour holds ≥ 4 readout pixels counts as 'readout frame'
    const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < bw && j < bh ? blocks[j * bw + i] : null);
    for (const b of blocks) if (!b.on && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => (at(b.i + di, b.j + dj)?.emis ?? 0) >= 4)) b.on = 'readout frame';
    blocks.sort((a, b) => b.rms - a.rms);
    const top: typeof blocks = [];
    for (const b of blocks) {
      if (top.some((t) => Math.abs(t.i - b.i) <= 1 && Math.abs(t.j - b.j) <= 1)) continue;
      top.push(b); if (top.length === 10) break;
    }
    const toCss = (b: { i: number; j: number }) => [Math.round(((b.i + 0.5) * B / f.w) * innerWidth), Math.round((1 - (b.j + 0.5) * B / f.h) * innerHeight)];
    const res = top.map((b) => ({ at: toCss(b), rms: round(b.rms, 1), on: b.on }));
    return { top: res, onTarget: res.filter((r) => r.on).length, pass: res.every((r) => r.on) };
  }
  // §5.5 hue gap + greyscale blobs: `__hq.hueGapCheck()` / `__hq.greyCheck()` (fix r1: registered in HQ_PLUGGABLE);
  // __hqRender.checks keeps the old handle for scripts written against it
  globalThis.__hqRender = Object.assign(globalThis.__hqRender ?? {}, { checks: { hueGapCheck, greyCheck } });
  /**
   * M3.5 tally lights: project every monitor-back LED into the next frame and classify the brightest pixel around it
   * (5×5) by hue → {leds:[{desk, state, px, rgb, seen}], visible, match}. `seen` ∈ blue|red|green|dark|other; a match
   * is blue↔working, red↔blocked (a blink's off phase is still dim red), green↔done, dark↔off. Occluded LEDs show
   * whatever covers them (reported, not counted as a match). `__hqRender.tallyCheck()`.
   */
  async function tallyCheck() {
    const pts = tallyPoints();
    const f = await capture({ pre: false, post: true });
    const v = new THREE.Vector3();
    const classify = ([r, g, b]: number[]): string => {
      if (Math.max(r, g, b) < 40) return 'dark';
      if (b > r + 25 && b >= g) return 'blue';
      if (r > g + 45 && r > b + 25) return 'red';
      if (g > r + 25 && g > b) return 'green';
      return 'other';
    };
    const want: Record<string, string> = { working: 'blue', blocked: 'red', done: 'green', off: 'dark' };
    const leds: { desk: string; state: string; px: [number, number]; rgb: number[]; seen: string; match: boolean }[] = [];
    for (const t of pts) {
      v.copy(t.pos).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      const x = (v.x * 0.5 + 0.5) * innerWidth, y = (0.5 - v.y * 0.5) * innerHeight;
      const [bx, by] = toBuf(f, x, y);
      let best = postAt(f, bx, by), bs = -1;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const p = postAt(f, Math.min(f.w - 1, Math.max(0, bx + dx)), Math.min(f.h - 1, Math.max(0, by + dy)));
        const sat = Math.max(...p) - Math.min(...p) + Math.max(...p) * 0.25;
        if (sat > bs) { bs = sat; best = p; }
      }
      const seen = classify(best);
      leds.push({ desk: t.desk, state: t.state, px: [Math.round(x), Math.round(y)], rgb: best, seen, match: seen === want[t.state] || (t.state === 'blocked' && seen === 'dark') });
    }
    return { leds, visible: leds.length, match: leds.filter((l) => l.match).length, byState: leds.reduce<Record<string, number>>((a, l) => { const k = `${l.state}:${l.seen}`; a[k] = (a[k] ?? 0) + 1; return a; }, {}) };
  }
  /**
   * M3.5 night pools "no popping while walking" (two-frame check): walks the camera from `from` to `to` (world x,z)
   * at walking speed, one step per rendered frame, and compares every lamp slot's pool light (uLampPos/uLampCol) with
   * the previous frame's. A pop = a slot whose light luminance jumps by more than `pop` between two frames, or a lamp
   * that appears / vanishes at more than `pop` of its light. → {frames, maxDelta, pops:[{frame, slot, from, to}]}.
   */
  async function popCheck({ from, to, speed = 1.4, pop = 0.06 }: { from?: [number, number]; to?: [number, number]; speed?: number; pop?: number } = {}) {
    const hq = liveHq();
    const p0 = hq.ctx.player.getPose();
    const [x0, z0] = from ?? [p0[0], p0[2]], [x1, z1] = to ?? [x0, z0 - 8];
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / (speed / 60)));
    const yaw = Math.atan2(-(x1 - x0), -(z1 - z0));
    const lumOf = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const snap = () => U.uLampPos.value.map((q, i) => ({ key: `${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)}`, L: q.w === 0 ? 0 : lumOf(U.uLampCol.value[i]) }));
    let prev: { key: string; L: number }[] | null = null, maxDelta = 0;
    const pops: { frame: number; lamp: string; from: number; to: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      hq.setPose(x0 + (x1 - x0) * t, p0[1], z0 + (z1 - z0) * t, yaw, -0.1);
      await frames(1);
      const cur = snap();
      if (prev) {
        // per lamp (by position): its light before vs after, wherever its slot is
        const a = new Map(prev.map((q) => [q.key, q.L])), b = new Map(cur.map((q) => [q.key, q.L]));
        for (const k of new Set([...a.keys(), ...b.keys()])) {
          const d = Math.abs((b.get(k) ?? 0) - (a.get(k) ?? 0));
          if (d > maxDelta) maxDelta = d;
          if (d > pop) pops.push({ frame: i, lamp: k, from: +(a.get(k) ?? 0).toFixed(3), to: +(b.get(k) ?? 0).toFixed(3) });
        }
      }
      prev = cur;
    }
    return { frames: n, maxDelta: round(maxDelta, 4), pops: pops.slice(0, 20), pass: pops.length === 0 };
  }
  globalThis.__hqRender = Object.assign(globalThis.__hqRender ?? {}, { tallyCheck, popCheck });
  hqRegister('hueGapCheck', hueGapCheck);
  hqRegister('greyCheck', greyCheck);

  hqRegister('probe', probe);
  hqRegister('lumaStats', lumaStats);
  hqRegister('surfaceStats', surfaceStats);
  hqRegister('clayCheck', clayCheck);
  hqRegister('edgeCheck', edgeCheck);
  return { capture, probe, lumaStats, surfaceStats, clayCheck, edgeCheck, hueGapCheck, greyCheck };
}
