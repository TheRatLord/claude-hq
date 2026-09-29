/**
 * Hero sheet (`?sheet=hero`, DESIGN §6.1.1): Clawd at final quality on a neutral cyc (oat backdrop L* 70, ground
 * L* 50), the renderer's own post stack and lights at a day hour. One stage, several framed views:
 *   turntable   8 angles (45° steps) at eye height 1.2 m, 2 m away             view('turntable', {angle: 0..7})
 *   expressions all 9 ART §5.3 expressions, front 3/4                         view('expressions')
 *   accessories all 8 accessories on the same body + one cycle-1 stripe      view('accessories')
 *   variants    personality extremes (chubby, tall, low-energy) + codex/rose/pebble; a desk with a clay and a codex
 *               Clawd sitting under it in its cast shadow (clayCheck castShadow)   view('variants')
 *   shelly      first-pass Shelly faces                                        view('shelly')
 *   silhouette  64 px-tall ink silhouettes: Clawd typing / waving / jumping / sleeping + Shelly   view('silhouette')
 *   strip       motion review: N copies of the hero frozen at t = i·dt of a reaction/action   strip(id, {n, dt, …})
 *   live        the hero cycling through the whole vocabulary                   view('live')
 *   catalogue (M2, every §6.3 activity + reaction, labelled, looping live):
 *     desk · stations · blocked · idle · idle2 · fidgets · walking · reactions · shellyActs · gear
 *                                                                           view('desk') … (labels: ?labels=0 hides)
 * `window.__sheet` drives it (the review scripts and shoot.ts `--eval`); `window.__hq` is installed with the sheet's
 * camera so `setPose`/`stats`/pluggable probes (RND clayCheck) work here too. Owner: CHR.
 */
import * as THREE from 'three';
import { createRenderer } from '../render/renderer.ts';
import { createQuality } from '../render/quality.ts';
import { createLights } from '../render/lights.ts';
import { createPost } from '../render/post.ts';
import { getMaterial } from '../render/materials/index.ts';
import { LAYERS, markCaster } from '../render/layers.ts';
import { createClock } from '../core/time.ts';
import { createCtx } from '../core/ctx.ts';
import { createBus } from '../core/bus.ts';
import { installHq, hqStatSection } from '../core/debug.ts';
import { createRig } from '../chars/rig/clawd.ts';
import { createAnimator } from '../chars/anim/animator.ts';
import { setViewer } from '../chars/anim/viewer.ts';
import { createCharBatch } from '../chars/render/charBatch.ts';
import { EXPRESSION_IDS } from '../chars/anim/face.ts';
import { ACCESSORIES } from '../chars/rig/accessories.ts';
import { ACTIVITIES, VOCAB } from '../chars/anim/activities/index.ts';
import { REACTIONS } from '../chars/anim/reactions.ts';
import { MISC } from '../../../shared/palette.ts';
import { ENV, CORE } from '../../../shared/palette.ts';
import { errMessage } from '../../../shared/guards.ts';
import type { Params } from '../core/params.ts';
import type { Rig } from '../chars/rig/clawd.ts';
import type { Animator, Traits } from '../chars/anim/animator.ts';
import type { Personality } from '../chars/anim/personality.ts';
import type { CharHandle, CharBatch, CharBatchStats, OutlineSpec } from '../chars/render/charBatch.ts';
import { sheetStore, sheetPlayer, noReply } from './sheetStubs.ts';

/** Per-frame script of a catalogue actor (treadmill lanes, circles): moves the rig root from its home `pos`. */
type SheetScript = (a: SheetActor, t: number) => void;
interface SheetActor {
  rig: Rig; anim: Animator; handle: CharHandle; id: string; group: string; pos: THREE.Vector3; yaw: number; frozen: boolean;
  script: SheetScript | null; label: string;
  loco?: number; shown?: boolean; scriptT?: number; hideUnder?: boolean;
  loopReact?: { id: string; every: number; variant: number; t: number };
}
/** What `add` takes for one actor. */
interface ActorOpts {
  id?: string; label?: string; kind?: string; seed?: string; pos: [number, number, number]; yaw?: number; colorIndex?: number; cycle?: number;
  pers?: Partial<Personality>; face?: string | null; action?: string | null; loco?: number; script?: SheetScript | null;
}
/** One catalogue cell (a labelled actor of a grid page). */
interface CatalogueItem {
  label: string; action?: string | null; kind?: string; seed?: string; yaw?: number; colorIndex?: number; face?: string | null;
  pers?: Partial<Personality>; react?: string; every?: number; variant?: number; loco?: number; gait?: string;
  traits?: Traits; outline?: OutlineSpec; script?: SheetScript; noStool?: boolean;
}
interface GridOpts { cols?: number; dx?: number; dz?: number; yaw?: number; desk?: boolean; per?: number }
export interface ViewOpts { angle?: number; id?: string; dist?: number; h?: number; ty?: number; silhouette?: boolean; solo?: boolean }
type ViewFn = (o?: ViewOpts) => void;
export interface StripOpts {
  n?: number; dt?: number; t0?: number; variant?: number; spacing?: number; seed?: string; colorIndex?: number; kind?: string;
  /** viewer distance for setViewDist */
  view?: number;
  /** action held before a reaction (kept through it with `keep`) */
  pre?: string; yaw?: number; keep?: boolean;
}
/** `window.__sheet`: what the review scripts and shoot.ts `--eval` drive. */
export interface HeroSheetApi {
  views: string[];
  view(name: string, o?: ViewOpts): string | null;
  strip(id: string, o?: StripOpts): string[];
  play(id: string): string;
  react(id: string, variant?: number): string;
  face(expr: string): string;
  live(on?: boolean): boolean;
  pause(b?: boolean): boolean;
  plain(b?: boolean): boolean;
  clayProbe(): Record<string, Record<string, [number, number, boolean]>>;
  actors(): { id: string; group: string; label: string; pos: number[]; anim: unknown }[];
  charStats(): CharBatchStats;
  handle(id?: string): CharHandle | null;
  rig(id?: string): Rig | null;
  batch: CharBatch;
}
declare global {
  interface Window { __sheet?: HeroSheetApi }
}

const BACKDROP = '#B3A99B'; // oat backdrop, L* 70
const GROUND = '#7C766E'; // ground, L* 50
const EYE = 1.2;
const HERO_SEED = 'clawd-hero';

export async function runHeroSheet({ params }: { params: Params }): Promise<void> {
  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html has no <canvas id="view">');
  const quality = createQuality({ pinned: params.quality });
  const { renderer, resize } = createRenderer(canvas, { renderScale: quality.renderScale });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(params.fov, innerWidth / innerHeight, 0.05, 400);
  const clock = createClock({ scale: params.timescale ?? 1, hour: params.hour ?? 13 });
  const bus = createBus();
  const lights = createLights(scene);
  const post = createPost({ renderer, scene, camera, quality });
  const charBatch = createCharBatch({ scene, camera, quality });
  scene.background = new THREE.Color(BACKDROP);

  // ---- stage: cyc (floor curving into the backdrop), a desk ------------------------------------------------------
  const stage = new THREE.Group();
  scene.add(stage);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 40).rotateX(-Math.PI / 2), getMaterial('toonEnv', { color: GROUND }));
  ground.position.set(70, 0, 8);
  ground.receiveShadow = true;
  stage.add(ground);
  const cycShape = new THREE.Shape();
  const R = 2.2;
  cycShape.moveTo(0, 0);
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * (Math.PI / 2); cycShape.lineTo(R - Math.cos(a) * R, R - Math.sin(a) * R + 0); }
  const cycPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * (Math.PI / 2); cycPts.push(new THREE.Vector3(0, R - Math.cos(a) * R, -Math.sin(a) * R)); }
  cycPts.push(new THREE.Vector3(0, 14, -R));
  const cycGeo = new THREE.BufferGeometry();
  {
    const pos: number[] = [], idx: number[] = [];
    const xs = [-50, 190];
    cycPts.forEach((p) => { for (const x of xs) pos.push(x, p.y, p.z); });
    for (let i = 0; i < cycPts.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    cycGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cycGeo.setIndex(idx);
    cycGeo.computeVertexNormals();
  }
  const cyc = new THREE.Mesh(cycGeo, getMaterial('toonEnv', { color: BACKDROP }));
  cyc.position.set(0, 0, -1.6);
  cyc.receiveShadow = true;
  stage.add(cyc);
  // Ground → backdrop value blend strip is the cyc curve itself (BACKDROP colour); tint the lower curve toward ground.
  const lip = new THREE.Mesh(new THREE.PlaneGeometry(240, 1.2).rotateX(-Math.PI / 2), getMaterial('toonEnv', { color: GROUND }));
  lip.position.set(70, 0.001, -1.0);
  stage.add(lip);

  const deskGroup = new THREE.Group();
  const oak = getMaterial('toonProp', { color: ENV.oak });
  const walnut = getMaterial('toonProp', { color: ENV.walnut });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; deskGroup.add(b); return b; };
  box(1.6, 0.045, 0.72, 0, 0.55, 0, oak);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, 0.53, 0.05, sx * 0.74, 0.265, sz * 0.31, walnut);
  box(0.5, 0.3, 0.035, 0.35, 0.72, -0.22, getMaterial('toonProp', { color: CORE.ink2 })); // monitor
  box(0.08, 0.14, 0.06, 0.35, 0.6, -0.25, walnut);

  // ---- characters -------------------------------------------------------------------------------------------------
  const actors: SheetActor[] = [];
  const groups: Record<string, SheetActor[]> = {};
  const add = (group: string, o: ActorOpts): SheetActor => {
    const kind = o.kind ?? 'claude';
    const rig = createRig({ kind, seedKey: o.seed ?? HERO_SEED, pers: o.pers });
    const handle = charBatch.register(rig, { kind, colorIndex: o.colorIndex ?? 0, cycle: o.cycle ?? 0 });
    const anim = createAnimator(rig, { seedKey: o.seed ?? HERO_SEED });
    const a: SheetActor = { rig, anim, handle, id: o.id ?? `${group}${actors.length}`, group, pos: new THREE.Vector3(...o.pos), yaw: o.yaw ?? 0, frozen: false, script: o.script ?? null, label: o.label ?? '' };
    rig.root.position.copy(a.pos);
    rig.root.rotation.y = a.yaw;
    if (o.action !== undefined) anim.setAction(o.action);
    if (o.face) anim.setFace(o.face);
    if (o.loco) { a.loco = o.loco; anim.setLocomotion(o.loco); }
    actors.push(a);
    (groups[group] ??= []).push(a);
    return a;
  };
  const Y34 = 0.42; // front 3/4 yaw
  // Hero (turntable) at the origin, beanie (workspace 0), stands facing +z.
  add('hero', { id: 'hero', pos: [0, 0, 0], colorIndex: 0 });
  // Expressions.
  EXPRESSION_IDS.forEach((ex, i) => add('expressions', { id: `ex:${ex}`, label: ex, pos: [6 + i * 0.95, 0, 0], yaw: Y34, colorIndex: 0, face: ex, pers: { energy: 0.8 } }));
  // Accessories 0..7 + a cycle-1 stripe variant.
  for (let i = 0; i < 9; i++) add('accessories', { id: `acc:${i}`, label: i < 8 ? ACCESSORIES[i] : `${ACCESSORIES[2]} ×stripe`, pos: [16 + i * 0.95, 0, 0], yaw: Y34 * 0.6, colorIndex: i < 8 ? i : 2, cycle: i < 8 ? 0 : 1 });
  // Variants: personality extremes + kinds; the desk with two Clawds under it.
  add('variants', { id: 'chubby', label: 'chubby', pos: [26, 0, 0.2], yaw: Y34, colorIndex: 3, pers: { width: 0.06, height: -0.02 } });
  add('variants', { id: 'tall', label: 'tall', pos: [27, 0, 0.2], yaw: Y34, colorIndex: 3, pers: { width: -0.03, height: 0.05 } });
  add('variants', { id: 'lowEnergy', label: 'low-energy', pos: [28, 0, 0.2], yaw: Y34, colorIndex: 3, pers: { energy: 0.75 } });
  add('variants', { id: 'rose', label: 'rose (gemini)', kind: 'gemini', pos: [29.1, 0, 0.2], yaw: Y34, colorIndex: 5 });
  add('variants', { id: 'pebble', label: 'pebble (unknown kind)', kind: 'agent', pos: [30.1, 0, 0.2], yaw: Y34, colorIndex: 6 });
  add('variants', { id: 'codex', label: 'codex (slate) beside the desk', kind: 'codex', pos: [31.1, 0, 0.3], yaw: Y34 * 0.5, colorIndex: 1 });
  deskGroup.position.set(32.9, 0, -0.1);
  markCaster(deskGroup);
  scene.add(deskGroup);
  add('variants', { id: 'underClay', label: 'clay in the desk shadow', pos: [32.55, 0, -0.34], yaw: 0.1, colorIndex: 5, action: null });
  add('variants', { id: 'underCodex', label: 'codex in the desk shadow', kind: 'codex', pos: [33.3, 0, -0.34], yaw: -0.1, colorIndex: 5, action: null });
  // Shelly: faces row (front) + locomotion.
  const shellFaces: [string, string | null, string | null][] = [['prompt', null, null], ['busy', 'spinnerWatch', null], ['happy', null, 'happy'], ['sleepy', null, 'sleepy'], ['error', null, 'dizzy'], ['surprised', null, 'surprised'], ['love', null, 'love'], ['strain', null, 'determined']];
  shellFaces.forEach(([label, action, face], i) => add('shelly', { id: `shelly:${label}`, label, kind: 'shell', seed: `shelly-${i}`, pos: [36 + i * 0.8, 0, 0], yaw: Y34 * 0.5, colorIndex: i, face, action }));
  add('shelly', { id: 'shelly:roll', label: 'rolling 1.2 m/s', kind: 'shell', seed: 'shelly-roll', pos: [36 + 8 * 0.8, 0, 0], yaw: Math.PI / 2 - 0.4, colorIndex: 3, loco: 1.2 });

  // Crowd: 12 mixed Clawds for the §11 M1 draw-call budget (12 Clawds ≤ 40 main + ≤ 12 shadow draws).
  const CROWD: (string | null)[] = ['type', 'typeFrenzy', 'readBook', 'think', 'waveBlocked', 'lounge', 'sleepDesk', null, 'sitIdle', 'queueWait', 'confused', null];
  CROWD.forEach((act, i) => add('crowd', { id: `crowd:${i}`, kind: ['claude', 'claude', 'codex', 'gemini'][i % 4], seed: `crowd-${i}`, pos: [100 + (i % 6) * 1.1, 0, Math.floor(i / 6) * -1.3], yaw: 0.2, colorIndex: i, cycle: i >= 8 ? 1 : 0, action: act, face: i === 11 ? 'love' : null }));
  // ---- M2 catalogue: every §6.3 activity and reaction, laid out in labelled grids that share one stage spot (only one
  // group is visible at a time). Seated ones get a stool, desk ones a desk top; walkers run on a treadmill. ----------
  const stageProps = new THREE.Group();
  scene.add(stageProps);
  const stoolMat = getMaterial('toonProp', { color: ENV.walnut }), deskMat = getMaterial('toonProp', { color: ENV.oak });
  const propBox = (group: string, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; b.userData.group = group;
    stageProps.add(b); return b;
  };
  const GX = 140;
  /** Catalogue pages (a group of ≤ `per` actors, 5 × 2): name → actors; names in creation order. */
  const pages: string[] = [];
  const grid = (name: string, items: CatalogueItem[], o: GridOpts = {}) => {
    const per = o.per ?? 10;
    for (let pg = 0; pg * per < items.length; pg++) {
      const group = pg ? `${name}${pg + 1}` : name;
      pages.push(group);
      gridPage(group, items.slice(pg * per, (pg + 1) * per), o);
    }
  };
  const gridPage = (group: string, items: CatalogueItem[], o: GridOpts) => {
    const cols = o.cols ?? 5, dx = o.dx ?? 1.5, dz = o.dz ?? 2.1;
    items.forEach((it, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = GX + (c - (Math.min(cols, items.length) - 1) / 2) * dx, z = r * dz;
      const yaw = it.yaw ?? o.yaw ?? 0.35;
      const def = it.action ? ACTIVITIES[it.action] : null;
      const a = add(group, { id: `${group}:${it.label}`, label: it.label, pos: [x, 0, z], yaw, colorIndex: it.colorIndex ?? i % 8, kind: it.kind, seed: it.seed ?? `${group}-${i}`,
        action: it.action ?? null, face: it.face, pers: it.pers });
      if (def?.sit && !it.noStool) propBox(group, 0.42, 0.3, 0.42, x, 0.15, z, stoolMat);
      if (def?.sit && o.desk) { const dz2 = 0.62; propBox(group, 0.95, 0.04, 0.5, x + Math.sin(yaw) * dz2, 0.55, z + Math.cos(yaw) * dz2, deskMat).rotation.y = yaw; }
      if (it.react) a.loopReact = { id: it.react, every: it.every ?? (REACTIONS[it.react]?.dur ?? 1.5) + 0.9, variant: it.variant ?? 0, t: 0.3 + (i % 5) * 0.15 };
      if (it.loco) { a.loco = it.loco; a.anim.setLocomotion(it.loco); }
      if (it.gait) a.anim.setGait?.(it.gait);
      if (it.traits) a.anim.setTraits?.(it.traits);
      if (it.outline) a.handle.setOutline(it.outline);
      if (it.script) a.script = it.script;
    });
  };
  const acts = (ids: readonly string[]): CatalogueItem[] => ids.map((id) => ({ label: id, action: id }));
  grid('desk', acts(VOCAB.desk), { yaw: 0.5 });
  grid('stations', acts([...VOCAB.stations, ...VOCAB.blocked]));
  const idleIds = VOCAB.idle.filter((id) => id !== 'parcelCarry' && id !== 'sleepwalk');
  grid('idle', acts(idleIds));
  grid('fidgets', acts(VOCAB.fidgets), { cols: 4 });
  grid('walking', [
    { label: 'trot 0.9', loco: 0.9, gait: 'trot', yaw: Math.PI / 2 - 0.35 }, { label: 'waddle 0.9', loco: 0.9, gait: 'waddle', yaw: Math.PI / 2 - 0.35 },
    { label: 'skip 1.2 (happy)', loco: 1.2, gait: 'skip', face: 'happy', yaw: Math.PI / 2 - 0.35 }, { label: 'scurry 2.8', loco: 2.8, gait: 'trot', face: 'determined', yaw: Math.PI / 2 - 0.35 },
    ...[...VOCAB.walking, 'parcelCarry', 'sleepwalk'].map((id) => ({ label: id, action: id, loco: id === 'sleepwalk' ? 0.4 : 2.0, yaw: Math.PI / 2 - 0.35 })),
  ], { cols: 4, per: 8 });
  grid('reactions', VOCAB.reactions.flatMap((id) => (id === 'victory' ? [0, 1, 2].map((v) => ({ label: `victory/${v}`, react: id, variant: v })) : [{ label: id, react: id }])), { per: 10 });
  // [CHR M3.5] walk-up-and-manage: the viewer-aimed reactions staged the way BRN fires them (the sheet camera is the
  // viewer: seated backs to it for glanceBack / lookBackWave), the arrival crate, the dash + skid-stop.
  const lane = (speed: number, runS: number, holdS: number): SheetScript => (a, t) => {
    const T = runS + holdS, u = t % T;
    const x = u < runS ? u * speed : runS * speed;
    a.rig.root.position.set(a.pos.x - 0.75 + x, 0, a.pos.z);
    if (u < runS) a.anim.setLocomotion(speed); else a.anim.setLocomotion(0);
  };
  grid('walkup', [
    { label: 'glanceBack (shh)', action: 'type', react: 'glanceBack', yaw: Math.PI - 0.35 },
    { label: 'lookBackWave (done)', action: 'sitIdle', react: 'lookBackWave', face: 'happy', yaw: Math.PI + 0.45 },
    { label: 'summonBusy', action: 'type', react: 'summonBusy', yaw: Math.PI / 2 + 0.2 },
    { label: 'patted (keeps typing)', action: 'type', react: 'patted', yaw: 0.45 },
    { label: 'catchPlane → readNote', react: 'catchPlane', yaw: 0.3, every: 4.6 },
    { label: 'summoned', react: 'summoned', yaw: Math.PI / 2 },
    { label: 'crateUnwrap', react: 'crateUnwrap', yaw: 0.25 },
    { label: 'cheer', react: 'cheer', yaw: 0.35 },
    { label: 'dash 3.6 m/s', loco: 3.6, yaw: Math.PI / 2 - 0.35 },
    { label: 'dash → skid stop', yaw: Math.PI / 2, script: lane(3.6, 0.42, 1.3) },
  ], { cols: 5, per: 10, desk: true, dx: 1.6, dz: 2.3 });
  grid('shellyActs', VOCAB.shelly.map((id, i) => ({ label: id, action: id, kind: 'shell', seed: `shelly-act-${i}`, yaw: 0.3 })), { dx: 1.1 });
  const circle = (r: number, spd: number): SheetScript => (a, t) => { const ang = t * spd / r; a.rig.root.position.set(a.pos.x + Math.sin(ang) * r, 0, a.pos.z + Math.cos(ang) * r); a.rig.root.rotation.y = ang + Math.PI / 2; };
  grid('gear', [
    { label: 'no gear', traits: {} },
    { label: 'pack 50k', traits: { contextTokens: 60_000 }, yaw: Math.PI - 0.6 },
    { label: 'pack 100k', traits: { contextTokens: 110_000 }, yaw: Math.PI - 0.6 },
    { label: 'pack 150k', traits: { contextTokens: 160_000 }, yaw: Math.PI - 0.6 },
    { label: 'sweat 180k', traits: { contextTokens: 190_000 }, face: 'worried', yaw: 0.9 },
    { label: 'opus', traits: { modelTier: 'opus' } }, { label: 'sonnet', traits: { modelTier: 'sonnet' } }, { label: 'haiku', traits: { modelTier: 'haiku' } },
    { label: 'struggle 1', traits: { struggle: { level: 1 } }, action: 'typeFrenzy' }, { label: 'struggle 2', traits: { struggle: { level: 2 } }, action: 'type', face: 'worried' },
    { label: 'exhale', react: 'exhale' },
    { label: 'outline blocked', outline: { color: MISC.blockedOutline, width: 1.6 }, action: 'waveBlocked' },
    { label: 'outline selected', outline: { color: CORE.clayLight, width: 1.5 } }, { label: 'outline sleeping', outline: { color: CORE.ink2, width: 0.6 }, action: 'sleepDesk' },
    { label: 'minis ×2 (desk)', traits: { subagents: 2 }, action: 'delegate' }, { label: 'minis ×4 (desk fan)', traits: { subagents: 4 }, action: 'type' },
    { label: 'minis ×4 (walking)', traits: { subagents: 4 }, loco: 0.9, script: circle(0.9, 0.9) },
  ], { cols: 4, dx: 1.5, per: 8 });

  // Silhouette line-up (far away; only shown in the silhouette view).
  const silPoses: [string | null, string][] = [['type', 'typing'], ['waveBlocked', 'waving'], [null, 'jumping'], ['sleepDesk', 'sleeping'], ['shell', 'shelly']];
  silPoses.forEach(([act, label], i) => {
    const a = add('silhouette', { id: `sil:${label}`, label, kind: act === 'shell' ? 'shell' : 'claude', pos: [60 + i * 1.3, 0, 0], yaw: act === 'type' || act === 'sleepDesk' ? 0.9 : 0.3, colorIndex: 0, action: act === 'shell' ? 'spinnerWatch' : act });
    if (label === 'jumping') a.loopReact = { id: 'victory', every: 2.2, variant: 1, t: 0 };
  });

  // ---- views ------------------------------------------------------------------------------------------------------
  const look = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); camera.updateMatrixWorld(); };
  const setFov = (f: number) => { if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); } };
  const frameRow = (list: SheetActor[], pad = 0.6, height = EYE, look3 = 0.42) => {
    const xs = list.map((a) => a.pos.x);
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
    const cx = (x0 + x1) / 2, half = (x1 - x0) / 2;
    const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    const d = half / Math.tan(hf) + 0.3;
    look(cx, height, d + list[0].pos.z, cx, look3, list[0].pos.z);
  };
  const CATALOGUE = pages;
  const CATALOGUE_SET = new Set(pages);
  /** Frame a catalogue grid from the front, slightly above, so every row reads. */
  const frameGrid = (list: SheetActor[]) => {
    const xs = list.map((a) => a.pos.x), zs = list.map((a) => a.pos.z);
    const x0 = Math.min(...xs) - 0.7, x1 = Math.max(...xs) + 0.7, z0 = Math.min(...zs), z1 = Math.max(...zs);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    const d = Math.max(3.2, ((x1 - x0) / 2) / Math.tan(hf) * 1.02);
    look(cx, 1.5 + (z1 - z0) * 0.5, z1 + d, cx, 0.4, cz);
  };
  const VIEW_GROUPS: Record<string, string[]> = { turntable: ['hero'], live: ['hero'], expressions: ['expressions'], accessories: ['accessories'], variants: ['variants'], shelly: ['shelly'], silhouette: ['silhouette'], strip: ['strip'], crowd: ['crowd'], ...Object.fromEntries(CATALOGUE.map((g) => [g, [g]])) };
  let current = 'turntable';
  let silhouette = false;
  const views: Record<string, ViewFn> = {
    turntable({ angle = 0 }: ViewOpts = {}) {
      const a = (angle * Math.PI) / 4;
      look(Math.sin(a) * 2, EYE, Math.cos(a) * 2, 0, 0.42, 0);
    },
    closeup({ id = 'hero', dist = 1.5, angle = 0.35, h = 0.95 }: ViewOpts = {}) {
      const act = actors.find((x) => x.id === id) ?? actors[0];
      const a = act.yaw + angle;
      const c = act.pos;
      look(c.x + Math.sin(a) * dist, h, c.z + Math.cos(a) * dist, c.x, 0.48 + (act.rig.nodes.hips.position.y - 0.16), c.z);
    },
    /** [CHR fix m15-r1] Orbit an actor (any group): `angle` 0 = in front of it, `h` eye height. */
    orbit({ id = 'hero', dist = 2, angle = 0, h = 1.2, ty = 0.45 }: ViewOpts = {}) {
      const act = actors.find((x) => x.id === id) ?? actors[0];
      const c = act.pos, a = act.yaw + angle;
      look(c.x + Math.sin(a) * dist, h, c.z + Math.cos(a) * dist, c.x, ty, c.z);
    },
    expressions() { frameRow(groups.expressions, 0.55, 1.0, 0.45); },
    accessories() { frameRow(groups.accessories, 0.55, 1.05, 0.5); },
    variants() { frameRow(groups.variants, 0.6, 1.1, 0.4); },
    shelly() { frameRow(groups.shelly, 0.6, 1.0, 0.42); },
    silhouette() { const g = groups.silhouette; const cx = (g[0].pos.x + g[g.length - 1].pos.x) / 2; look(cx, EYE, 12.9, cx, 0.45, 0); },
    live() { look(1.4, EYE, 2.6, 0, 0.45, 0); },
    crowd() { look(102.75, EYE, 5.2, 102.75, 0.4, -0.6); },
    ...Object.fromEntries(CATALOGUE.map((g) => [g, () => frameGrid(groups[g])])),
    strip() {
      // Near-orthographic side-by-side frames (narrow FOV from far away) so every copy is seen from the same angle.
      setFov(14);
      const g = groups.strip; const cx = (g[0].pos.x + g[g.length - 1].pos.x) / 2; const half = (g[g.length - 1].pos.x - g[0].pos.x) / 2 + 0.7;
      const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
      const d = half / Math.tan(hf);
      look(cx, 0.55 + d * 0.12, d, cx, 0.5, 0);
    },
  };
  const setView = (name: string, o: ViewOpts = {}): string | null => {
    if (!views[name]) return null;
    lastViewOpts = o;
    setFov(params.fov);
    current = name;
    silhouette = name === 'silhouette' || !!o.silhouette;
    // Each view shows only its own group (the closeup shows every group so neighbours frame the shot).
    const show = name === 'closeup' || name === 'orbit' ? [actors.find((x) => x.id === o.id)?.group ?? 'hero'] : VIEW_GROUPS[name];
    for (const a of actors) { a.shown = (!show || show.includes(a.group)) && (!o.solo || a.id === o.id); a.handle.setVisible(a.shown); } // solo: orbit one actor alone
    for (const m of stageProps.children) m.visible = !!show && show.includes(m.userData.group);
    labelsFor(show ?? []);
    views[name](o);
    return name;
  };

  // ---- labels (catalogue views): DOM tags projected above each visible actor ------------------------------------
  const showLabels = new URLSearchParams(location.search).get('labels') !== '0';
  const labelRoot = document.createElement('div');
  labelRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 12px/1.2 ui-monospace,Menlo,monospace;z-index:5';
  document.body.appendChild(labelRoot);
  let labels: { a: SheetActor; el: HTMLDivElement }[] = [];
  function labelsFor(groupsShown: string[]) {
    labelRoot.textContent = '';
    labels = [];
    if (!showLabels) return;
    for (const a of actors) {
      if (!a.label || !groupsShown.includes(a.group) || !CATALOGUE_SET.has(a.group) && a.group !== 'shelly') continue;
      const el = document.createElement('div');
      el.textContent = a.label;
      el.style.cssText = 'position:absolute;transform:translate(-50%,0);padding:1px 6px;border-radius:8px;background:rgba(244,237,227,.86);color:#1F1E1D;white-space:nowrap';
      labelRoot.appendChild(el);
      labels.push({ a, el });
    }
  }
  const lv = new THREE.Vector3();
  const placeLabels = () => {
    for (const { a, el } of labels) {
      lv.set(a.rig.root.position.x, 1.02, a.rig.root.position.z).project(camera);
      el.style.left = `${((lv.x + 1) / 2) * innerWidth}px`;
      el.style.top = `${((1 - lv.y) / 2) * innerHeight - 18}px`;
    }
  };

  // ---- silhouette render: characters in ink on paper, no post ------------------------------------------------------
  const inkMat = new THREE.MeshBasicMaterial({ color: CORE.ink });
  const renderSilhouette = () => {
    const bg = scene.background;
    scene.background = new THREE.Color('#F4EDE3');
    stage.visible = false; deskGroup.visible = false;
    scene.overrideMaterial = inkMat;
    const mask = camera.layers.mask;
    camera.layers.set(LAYERS.CHARS); // character parts only (no hulls, blobs or glints)
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    scene.overrideMaterial = null;
    stage.visible = true; deskGroup.visible = true;
    scene.background = bg;
  };

  // ---- motion strips ------------------------------------------------------------------------------------------------
  /**
   * N copies of the hero, each frozen at t = t0 + i·dt into `id` (a reaction, an action, or 'walk'/'walkStop'/'sit').
   * (kind: 'shell' strips Shelly; view: viewer distance for setViewDist; pre: action held before a reaction, kept through it with keep; yaw: copies' yaw)
   */
  const strip = (id: string, o: StripOpts = {}): string[] => {
    const n = o.n ?? 8, dt = o.dt ?? 0.1, t0 = o.t0 ?? 0, spacing = o.spacing ?? 1.05;
    for (const a of groups.strip ?? []) { a.handle.remove(); actors.splice(actors.indexOf(a), 1); }
    groups.strip = [];
    const isReaction = id in REACTIONS;
    for (let i = 0; i < n; i++) {
      const x = 80 + i * spacing;
      const a = add('strip', { id: `strip:${i}`, kind: o.kind, pos: [x, 0, 0], yaw: o.yaw ?? (id.startsWith('walk') || id === 'run' || id === 'dash' ? Math.PI / 2 - 0.5 : 0.3), colorIndex: o.colorIndex ?? 0, seed: o.seed ?? HERO_SEED, label: `t=${(t0 + i * dt).toFixed(2)}` });
      if (o.view != null) a.anim.setViewDist?.(o.view);
      if (o.pre) { a.anim.setAction(o.pre); }
      const step = 1 / 240;
      const run = (secs: number, fn?: (s: number) => void) => { for (let s = 0; s < secs; s += step) { fn?.(s); a.anim.update(step, 0); } };
      run(0.6);
      const T = t0 + i * dt;
      setViewer({ x, y: EYE, z: 3 }); // [CHR M3.5] each copy's viewer: 3 m in front of its lane (viewer-aimed reactions)
      if (isReaction) { if (o.pre) { run(1.5); if (!o.keep) a.anim.setAction(null); } a.anim.react(id, { variant: o.variant ?? 0 }); run(T); }
      else if (id === 'walk') { a.anim.setLocomotion(0.9); run(1.5 + T); }
      else if (id === 'run' || id === 'dash') { a.anim.setLocomotion(id === 'dash' ? 3.6 : 2.4); run(1.5 + T); } // [CHR M3.5] dash > 3 m/s
      else if (id === 'walkStop' || id === 'walkStart') {
        // Real root motion along +x inside the copy's lane: start → cruise → stop (anticipation / skid / settle).
        const start = x - 0.45;
        let px = start, v = id === 'walkStart' ? 0 : 1.2;
        a.rig.root.position.x = px;
        const tStop = 0.5;
        run((id === 'walkStart' ? 0 : 0.5) + T, (s) => {
          if (id === 'walkStart') v = Math.min(1.2, s * 6);
          else if (s > tStop) v = 0;
          px += v * step; a.rig.root.position.x = Math.min(px, x + 0.5);
        });
      } else if (id === 'sit') { a.anim.setAction('sitIdle'); run(T); }
      else { a.anim.setAction(id); run(1.2 + T); } // past the sit hop / blend-in
      a.frozen = true;
    }
    setView('strip');
    return groups.strip.map((a) => a.label);
  };

  // ---- live demo script: the hero cycles through the M1 vocabulary --------------------------------------------------
  const LIVE: [string, number][] = [['standIdle', 2], ...[...VOCAB.desk, ...VOCAB.stations, ...VOCAB.blocked, ...VOCAB.idle, ...VOCAB.fidgets].map((id): [string, number] => [id, 3]),
    ...VOCAB.reactions.map((id): [string, number] => [`react:${id}`, (REACTIONS[id]?.dur ?? 1.5) + 0.4])];
  let liveI = -1, liveT = 0, liveOn = false;
  const hero = actors[0];

  // ---- frame loop ------------------------------------------------------------------------------------------------
  const ctx = createCtx({ scene, camera, renderer, bus, clock, params, quality, camZone: 'sheet', store: sheetStore() });
  ctx.player = sheetPlayer(camera, EYE);
  let firstFrame: (() => void) | null = null;
  const firstDone = new Promise<void>((r) => { firstFrame = r; });
  let paused = false;
  let postBroken = false;
  const onResize = () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    resize(innerWidth, innerHeight, quality.renderScale); post.setSize(innerWidth, innerHeight);
    views[current]?.(lastViewOpts);
  };
  let lastViewOpts: ViewOpts = {};
  addEventListener('resize', onResize);

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    clock.tick(now);
    const dt = paused ? 0 : clock.dt;
    ctx.dt = dt; ctx.rawDt = clock.rawDt; ctx.time = clock.time; ctx.hour = clock.hour(); ctx.frame++;
    const t0 = performance.now();
    if (liveOn && dt > 0) {
      liveT -= dt;
      if (liveT <= 0) {
        liveI = (liveI + 1) % LIVE.length;
        const [id, dur] = LIVE[liveI];
        liveT = dur;
        if (id.startsWith('react:')) hero.anim.react(id.slice(6), { variant: liveI % 3 });
        else hero.anim.setAction(id);
      }
    }
    for (const a of actors) {
      if (a.frozen || a.shown === false) continue; // hidden groups don't animate (the sheet holds ~180 actors)
      if (a.loopReact && dt > 0 && (a.loopReact.t -= dt) <= 0) { a.loopReact.t = a.loopReact.every; a.anim.react(a.loopReact.id, { variant: a.loopReact.variant }); }
      if (a.script) { a.scriptT = (a.scriptT ?? 0) + dt; a.script(a, a.scriptT); }
      a.anim.update(dt, 0);
    }
    charBatch.write();
    if (labels.length) placeLabels();
    lights.update(ctx);
    if (silhouette) renderSilhouette();
    else {
      // Fall back to the plain (no-post) path if the post stack throws, so the sheet still shows the characters.
      try { post.setEnabled(!postBroken); post.render(ctx); } catch (e) { if (!postBroken) console.warn('[sheet] post.render threw; plain render fallback:', errMessage(e)); postBroken = true; }
    }
    const info = renderer.info.render;
    ctx.perf.drawCalls = info.calls; ctx.perf.triangles = info.triangles;
    ctx.perf.cpuMs += (performance.now() - t0 - ctx.perf.cpuMs) * 0.05;
    if (firstFrame) { firstFrame(); firstFrame = null; }
  };

  // The desk-shadow pair sits on the floor under the desk: the seated pose minus the chair + leg height.
  for (const id of ['underClay', 'underCodex']) { const u = actors.find((x) => x.id === id); if (u) u.hideUnder = true; }

  const api: HeroSheetApi = {
    views: Object.keys(views),
    view(name, o = {}) { lastViewOpts = o; return setView(name, o); },
    strip,
    play(id) { hero.anim.setAction(id === 'idle' ? null : id); return id; },
    react(id, variant) { hero.anim.react(id, { variant }); return id; },
    face(expr) { hero.anim.setFace(expr); return expr; },
    live(on = true) { liveOn = on; liveI = -1; liveT = 0; setView('live'); return on; },
    pause(b = true) { paused = b; return paused; },
    /** Debug: bypass the post stack (plain render). */
    plain(b = true) { postBroken = b; return b; },
    /** Screen-space probe points (CSS px) for a clay check: lit band, self-shadow band, desk cast shadow, codex. */
    clayProbe() {
      const out: Record<string, Record<string, [number, number, boolean]>> = {};
      const proj = (a: SheetActor, lx: number, ly: number, lz: number): [number, number, boolean] => {
        const v = new THREE.Vector3(lx, ly, lz);
        a.rig.nodes.shape.localToWorld(v);
        v.project(camera);
        return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight), v.z < 1];
      };
      for (const a of actors) {
        a.rig.root.updateMatrixWorld(true);
        out[a.id] = { litFront: proj(a, 0, 0.47, 0.245), litTop: proj(a, 0, 0.56, 0.05), sideShadow: proj(a, 0.37, 0.3, -0.05), frontLow: proj(a, 0.2, 0.16, 0.245) };
      }
      return out;
    },
    actors: () => actors.map((a) => ({ id: a.id, group: a.group, label: a.label, pos: a.rig.root.position.toArray(), anim: a.anim.debug })),
    charStats: () => charBatch.stats(),
    handle: (id = 'hero') => actors.find((a) => a.id === id)?.handle ?? null,
    rig: (id = 'hero') => actors.find((a) => a.id === id)?.rig ?? null,
    batch: charBatch,
  };
  window.__sheet = api;
  hqStatSection('chars', () => charBatch.stats());
  installHq({ ctx, ready: firstDone.then(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))), actors: { list: () => [], get: () => null, count: () => actors.length }, call: async () => noReply, poses: {} });

  // Apply the hide pose: lounge minus the seat lift → sitting on the floor under the desk.
  const origUpdate = new Map<SheetActor, Animator['update']>();
  for (const a of actors.filter((x) => x.hideUnder)) {
    const upd = a.anim.update;
    origUpdate.set(a, upd);
    a.anim.update = (dt, lod) => { upd(dt, lod); a.rig.nodes.hips.position.y -= 0.165; };
  }

  const q = new URLSearchParams(location.search);
  const v = q.get('view') ?? 'turntable';
  const stripId = q.get('strip');
  if (stripId) strip(stripId, { n: +(q.get('n') ?? 8), dt: +(q.get('dt') ?? 0.1), variant: +(q.get('variant') ?? 0) });
  else if (v === 'live') api.live(true);
  else setView(v, { angle: +(q.get('angle') ?? (v === 'closeup' ? 0.35 : 0)), id: q.get('id') ?? 'hero', dist: +(q.get('dist') ?? 1.5), h: +(q.get('h') ?? 0.95) });
  onResize();
  requestAnimationFrame(tick);
}
