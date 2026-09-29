/**
 * Boot + frame loop wiring only (§8.1). Owner: CORE.
 * Order per frame: player → cull → director/actors → charBatch.write → world → fx → ui → post.render.
 */
import * as THREE from 'three';
import { parseParams } from './core/params.ts';
import { createBus } from './core/bus.ts';
import { createClock } from './core/time.ts';
import { createCtx } from './core/ctx.ts';
import type { Ctx } from './core/ctx.ts';
import { createLoop } from './core/loop.ts';
import { createSettings } from './core/settings.ts';
import { setSeed } from './core/rng.ts';
import { installHq, hqStatSection, hqRegister } from './core/debug.ts';
import { installDrawSplit } from './core/drawSplit.ts';
import { createAttention } from './core/attention.ts';
import { store, connect, send, call } from './net/store.ts';
import { createPerfOverlay } from './debug/perfOverlay.ts';
import { POSES } from './debug/poses.ts';
import { createFrameCheck } from './debug/frameCheck.ts'; // [INT M1.5]
import { createRenderer } from './render/renderer.ts';
import { createQuality } from './render/quality.ts';
import { createLights } from './render/lights.ts';
import { createPost } from './render/post.ts';
import { LAYERS } from './render/layers.ts';
import { layout as protoLayout } from './world/layout/proto.ts';
import { createNav } from './world/nav/index.ts';
import * as worldBuild from './world/build/index.ts'; // namespace: WORLD_ART is optional (ENV may drop it)
import { createCharBatch } from './chars/render/charBatch.ts';
import { createPortraits } from './chars/render/portraits.ts'; // [CHR M3.5, cross-owner CORE edit]
import { createDirector } from './chars/brain/director.ts';
import { createActors } from './chars/actors.ts';
import { createFx } from './fx/index.ts';
import { createPlayer } from './player/controller.ts';
import { createUI } from './ui/index.ts';
import { createAudio } from './audio/index.ts'; // [AUD M3]
import { createStats } from './world/stats/index.ts'; // [STAT M3, cross-owner]
import { stripView } from './ui/layout.ts'; // [UI fix r2] off-axis world-strip projection
import { createAmbient } from './world/ambient/index.ts'; // [AMB M3, cross-owner] Ada, Segfault, roomba, fish, fans, steam
import { createScreenFeed } from './render/screenFeed.ts'; // [RND M3.5, cross-owner CORE edit] the one screen.watch arbiter
import { createMonitorAtlas } from './render/monitorAtlas.ts'; // [RND M3.5, cross-owner CORE edit] live desk monitors

const params = parseParams(location.search);
if (params.seed !== null) setSeed(params.seed);
// CHR (§6.1.1): `?sheet=hero` boots the hero turntable sheet instead of the office; boot never continues past it.
if (params.sheet === 'hero') { await (await import('./debug/sheet.ts')).runHeroSheet({ params }); await new Promise(() => {}); }
// [ENV M1.75, cross-owner CORE edit] `?sheet=props`: the prop-kit sheet (§7.5), same contract as the hero sheet
if (params.sheet === 'props') { await (await import('./debug/propSheet.ts')).runPropSheet({ params }); await new Promise(() => {}); }

const canvas = document.getElementById('view');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html has no <canvas id="view">');
const uiRoot = document.getElementById('ui');
if (!uiRoot) throw new Error('index.html has no #ui root');

// ---- core objects ---------------------------------------------------------------------------
const bus = createBus();
const clock = createClock({ scale: params.timescale ?? 1, hour: params.hour });
const settings = createSettings({ send });
const quality = createQuality({ pinned: params.quality });
const { renderer, resize } = createRenderer(canvas, { renderScale: quality.renderScale });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(params.fov, innerWidth / innerHeight, 0.05, 200);

// Modules later WPs add (a missing file is simply absent from the glob, so boot never breaks on it).
const optional = import.meta.glob<typeof import('./world/layout/hq.ts')>(['./world/layout/hq.ts']);
// [LVL M1.5] hq is the default layout; `?layout=proto` (or a proto pose such as `?pose=proto` with no layout) keeps the M1 room.
const wantHq = params.layout === 'hq' || (params.layout == null && (params.pose ? POSES[params.pose]?.layout : undefined) !== 'proto');
const hqLayout = wantHq && optional['./world/layout/hq.ts'] ? (await optional['./world/layout/hq.ts']()).layout : null;
const layout = hqLayout ?? protoLayout;
const ctx = createCtx({ scene, camera, renderer, store, bus, clock, params, settings, quality, layout, camZone: layout.id });
ctx.screens = createScreenFeed({ store, send }); // [RND M3.5, cross-owner CORE edit] ctx.screens.want(tag, ids): registered before the UI boots (§3.5)
// [UI fix r2, cross-owner CORE edit] off-axis projection centred on the visible world strip (roster left, drawer
// right; §8.2.1). The UI publishes the strip on the bus ('viewStrip' {left, right}, CSS px); the reticle / aim / WASD
// then all sit at the camera axis. No strip (or a centred one) = the plain full-canvas projection.
let viewStrip = { left: 0, right: 0 };
const applyView = () => {
  const W = innerWidth, H = innerHeight;
  const v = stripView(W, viewStrip.left, viewStrip.right);
  if (v) { camera.aspect = v.fullW / H; camera.setViewOffset(v.fullW, H, v.offsetX, 0, W, H); }
  else { camera.aspect = W / H; camera.clearViewOffset(); }
  camera.updateProjectionMatrix();
};
bus.on('viewStrip', (s) => { viewStrip = s; applyView(); });

// ---- systems --------------------------------------------------------------------------------
const lights = createLights(scene, { layout });
const post = createPost({ renderer, scene, camera, quality });
const drawSplit = installDrawSplit(renderer, scene); // [CORE fix m2 r1] §5.3 main/shadow/portrait/post split (after post.ts wrapped the shadow map)
post.useDrawSplit?.(drawSplit); // [RND m2 fix r3, cross-owner] render.programs reuses the split's program classification
const nav = createNav(layout, { obstacles: worldBuild.dressObstacles?.(layout, params) }); // [ENV fix r1, cross-owner CORE] dressing props (planters, coolers, lamps…) block walkers too
const world = worldBuild.buildWorld(layout, ctx);
ctx.worldArt = worldBuild.WORLD_ART ?? 'kit'; // [CORE fix r2] 'greybox' until ENV's prop kit (M1.75): review gates the art checks on it
const monitors = createMonitorAtlas(ctx); // [RND M3.5, cross-owner CORE edit] live desk-monitor atlas + tally/spill (updates in step 5)
const charBatch = createCharBatch({ scene, camera, quality, layers: { chars: LAYERS.CHARS, hulls: LAYERS.HULLS }, viewportHeight: () => innerHeight });
// [CHR M3.5, cross-owner CORE edit] live clay portraits (roster rows, status card, hotbar): ctx.portraits.request /
// attach / onReady; renders only when a shown agent's look changes, one atlas render per refresh (portraits.ts)
const portraits = createPortraits({ renderer, lights, store });
ctx.portraits = portraits;
const director = createDirector(layout, nav);
ctx.director = director; // [LVL fix r1, cross-owner] the world reads director.bayState() for the live bay signs (§7.2)
const fx = createFx(ctx);
const actors = createActors({ store, layout, director, charBatch, fx });
fx.bindActors?.(actors); // [FX M2] rings / plates / bubbles read actor positions + rigs (fx/index.ts)
const player = createPlayer({ camera, dom: canvas, bus, fov: params.fov, nav, director }); // [PLY M1.5] director: seat ownership + the player's seat claim
ctx.player = player;
player.setSoftColliders(actors.list); // [PLY fix r2] agents are soft colliders (§6.10); BRN's brain plays `bump` on contact
const ui = createUI(ctx, { root: uiRoot, actors, nav }); // UI: `actors` for crosshair aim / go-to (cross-owner edit, UI M1) · [UI m2-r2, cross-owner] `nav`: go-to stand point + glide along the nav path (§8)
const perfOverlay = createPerfOverlay({ root: uiRoot, ctx });
// [UI kit, cross-owner CORE edit] `?sheet=ui`: every kit component in every state over the live office (docs/design/ui-kit.md)
if (params.sheet === 'ui') (await import('./ui/kit/sheet.ts')).runUiSheet({ root: uiRoot, params, quality });
// [AMB M3, cross-owner CORE edit] ambient cast: rigs draw in charBatch, so it updates between actors and charBatch.write
const ambient = createAmbient({ ctx, layout, nav, charBatch, fx, actors, player, ui });
ctx.ambient = ambient;
const audio = createAudio(ctx, { actors, uiRoot }); // [AUD M3] procedural WebAudio (silent until the first gesture; ?noaudio)
ctx.audio = audio;
actors.tapReactions?.((...args: Parameters<typeof audio.react>) => audio.react(...args));
// [STAT M3, cross-owner CORE edit] diegetic stats objects at layout.statAnchors + the crosshair stat tooltip (§7.4)
const statsWorld = layout.statAnchors ? createStats(ctx, { root: uiRoot, aimedAgent: () => ui.aimed?.() ?? null }) : null;
// __hq UI calls (§9.1) fall back to the UI instance unless the UI registered its own.
hqRegister('select', (id) => ui.select(id), { ifAbsent: true });
hqRegister('openTerminal', (id) => ui.openTerminal(id), { ifAbsent: true });
hqRegister('closeTerminal', () => ui.closeTerminal(), { ifAbsent: true });
hqRegister('roster', (open, groupBy) => ui.roster(!!open, groupBy), { ifAbsent: true });
hqRegister('keyScope', () => ui.keyScope(), { ifAbsent: true });
hqStatSection('fx', () => ({ ...fx.counters }));
hqRegister('frameCheck', createFrameCheck({ camera, actors }), { ifAbsent: true }); // [INT M1.5] §6.1 framing check (nobody owned it)
// Title badge + OS notification off store events: works while the tab is hidden (no frame loop involved).
const attention = createAttention({ store });
hqStatSection('attention', () => attention.state());

const startPose = (params.pose ? POSES[params.pose]?.pose : undefined) ?? layout.spawn;
player.setPose(...startPose);

// Server settings / hello-driven state (applied eagerly by the store; this only mirrors into core objects).
store.on('hello', (h) => {
  if (h.settings) settings._applyServer(h.settings);
  if (params.timescale === null && typeof h.timescale === 'number') clock.setScale(h.timescale);
});
settings.onChange((c) => { if (c.fov !== undefined && !new URLSearchParams(location.search).has('fov')) player.setFov(c.fov); });
quality.onChange(() => onResize());
// [RND fix r1, cross-owner CORE edit] ctx.fpsCap mirrors the loop cap: quality.ts's auto-scaler pauses while it is set,
// so the drawer's 30 / 10 fps cap is never read as GPU overload (it used to ratchet the tier down for the session)
bus.on('drawer', ({ open, fullscreen }) => { const cap = fullscreen ? 10 : open ? 30 : null; loop.setFpsCap(cap); ctx.fpsCap = cap; });

const onResize = () => {
  applyView();
  resize(innerWidth, innerHeight, quality.renderScale, quality.tier);
  post.setSize(innerWidth, innerHeight);
};
addEventListener('resize', onResize);
onResize();

// ---- frame loop (§8.1) ------------------------------------------------------------------------
let firstFrame: (() => void) | null = null;
const firstFrameDone = new Promise<void>((res) => { firstFrame = res; });

function frame(c: Ctx) {
  drawSplit.begin();
  player.update(c); // 1. camera, aim
  c.camZone = layout.zoneAt(player.pos.x, player.pos.z, player.level ?? 0) ?? layout.id; // [CORE fix r1] level-aware (mezzanine → MEZ) · 2. cull (vis cell) — LVL/RND fill in
  actors.update(c); // 3. director → brains → motor → animator (director.update runs inside)
  ambient.update(c); // 3½. [AMB M3] ambient NPCs (rigs written by charBatch.write below)
  charBatch.write(); // 4.
  lights.update(c); // 5. world: time of day, stats objects, ambient
  world.update(c);
  monitors.update(c); // [RND M3.5] live monitor tiles (≤ 2 uploads) + monitor spill
  statsWorld?.update(c); // [STAT M3] stats objects (§8.1 step 5)
  quality.update(c);
  fx.update(c); // 6.
  ui.update(c); // 7.
  audio.update(c); // [AUD M3] listener pose + ambience (sounds themselves are event-driven)
  perfOverlay.update(c);
  post.setEnabled(!c.hidden);
  post.render(c); // 8.
  portraits.update(c); // [CHR M3.5, cross-owner CORE edit] dirty portraits only (idle: returns at once)
  drawSplit.end(c.perf); // perf.draws {main, shadow, portrait, post, total} + perf.drawCalls (= total)
  c.perf.triangles = renderer.info.render.triangles;
  if (firstFrame) { firstFrame(); firstFrame = null; }
}

const loop = createLoop(ctx, frame);
connect({ token: params.token });

// __hq.ready: first frame rendered, fonts ready, and the first `world` applied (or 5 s without a backend), then one
// more frame so actors for that world are on screen.
const worldSeen = new Promise<unknown>((res) => { store.on('world', res); setTimeout(res, 5000); });
const nextFrame = () => new Promise<unknown>((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
const ready = Promise.all([firstFrameDone, document.fonts?.ready ?? Promise.resolve(), worldSeen]).then(nextFrame).then(() => undefined);
installHq({ ctx, ready, actors, call, poses: POSES, nav, programs: () => drawSplit.programs() });
loop.start();
