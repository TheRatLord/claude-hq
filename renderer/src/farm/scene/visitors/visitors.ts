/**
 * The visitors system (model/visitors.ts says who comes when; docs/valley/visitors.md): Barnaby the travelling
 * merchant pulls his cart in over the south pass and parks it on the square's east side; Odile the wandering painter
 * walks in with her easel on her back, paints a scenic spot all day and packs up (or leaves the canvas with you);
 * Ned the parcel post steps off the morning train at the restored halt, walks a parcel to the mailbox and back.
 *
 * They walk the farmers' roads with the farmers' movement, gait and pose code (scene/farmers: motion, roads, pose,
 * rig), fade in where the road comes over the pass (or at the halt) and fade out there again, carry a lit lantern
 * after dark, and respect the weather (the painter won't work in the rain). Presentation only: the schedule, the
 * stock and what you bought live in the model service 'visitors' (visitorsboard.ts); this system publishes
 * 'visitorsScene' (`VisitorsScene`: map pins, the merchant's open shop, the painting on the easel, dev hooks).
 *
 * The painting you buy hangs in the farmhouse over the fish tank: a framed canvas built in the farmhouse's frame and
 * flagged `userData.indoors` (scene/interior keeps it while you're inside; it is hidden outdoors).
 *
 * Draw calls: one Crowd (≈ 7 + shadow pass) for the three of them, the cart (solid + glass) while it is in the valley,
 * the easel (solid + canvas) while she paints, and the wall painting (frame + canvas) only indoors. No per-frame
 * allocation in the steady state.
 */
import * as THREE from 'three';
import type { AudioService, FrameInfo, IndoorSpace, LightEmitter, LightsService, SceneCtx, SystemFactory } from '../context.ts';
import type { Season } from '../../model/types.ts';
import { PATHS, POIS, SITES, WORLD, distToPolyline, heightAt, inSite, structure } from '../../world/map.ts';
import type { XZ } from '../../world/map.ts';
import { projectSite, siteLocal } from '../../world/projects.ts';
import { dayKey } from '../../model/almanac.ts';
import {
  VISITOR_IDS, VISITORS, comes, paintProgress, paintSpotFor, paintingTitle, phaseAt, tooWetToPaint,
} from '../../model/visitors.ts';
import type { VisitorId, VisitorsService } from '../../model/visitors.ts';
import type { ProjectsService } from '../../model/projects.ts';
import { Crowd } from '../farmers/rig.ts';
import type { DrawIn, DrawOut } from '../farmers/rig.ts';
import type { Look } from '../farmers/look.ts';
import { ACT_INFO, CH, actPose, cycleLength, faceGlyphs, gait, holdOf, newGlyphs, newPose, newSprings, springSnap, springStep } from '../farmers/pose.ts';
import type { Act, Face, GaitState, GlyphState, Pose, Prop, Springs } from '../farmers/pose.ts';
import { propOf } from '../farmers/brain.ts';
import { moveStep, newMover, place } from '../farmers/motion.ts';
import type { Mover } from '../farmers/motion.ts';
import { buildRoads, route } from '../farmers/roads.ts';
import { Labels } from '../farmers/labels.ts';
import { Kit, canvasTex } from '../structures/kit.ts';
import { warmEmitter } from '../lights/emitters.ts';
import { LOOKS, MERCHANT_BYE, MERCHANT_LINES, MERCHANT_NIGHT, MERCHANT_RAIN, PAINTER_DONE, PAINTER_LINES, PAINTER_SOLD, POSTIE_LINES, visitorLook } from './cast.ts';
import { CART, CART_LANTERN, EASEL_CANVAS, buildCart, buildEasel } from './models.ts';
import { drawPainting, paintingUrl } from './paint.ts';

/** a visitor on the map (only while they are in the valley) */
export interface VisitorPin { id: VisitorId; name: string; title: string; glyph: string; color: string; x: number; z: number; line: string; settled: boolean }
/** the painting on the easel today */
export interface EaselView { day: string; spot: string; season: Season; title: string; progress: number; x: number; z: number }
/** what the HUD and the dev API use (service 'visitorsScene') */
export interface VisitorsScene {
  list(): VisitorPin[];
  /** Barnaby is at his counter: the cart is open for business */
  open(): boolean;
  /** today's canvas on the easel (null when she isn't painting) */
  painting(): EaselView | null;
  /** a painting as a data URL (thumbnails) */
  paintingUrl(spot: string, season: Season, day: string, progress?: number): string;
  /** dev: bring one in now ('in': walk in from the road; 'here': already settled), send them off ('out'), or back to the calendar (null) */
  force(id: VisitorId, mode: 'in' | 'here' | 'out' | null): boolean;
  /** stand in front of one (the merchant's counter, the easel, the postie) */
  go(id: VisitorId): boolean;
  /** dev: finish today's canvas */
  finish(): void;
  /** today's date key and who is where (dev / tests) */
  debug(): Record<string, unknown>;
}

type State = 'away' | 'in' | 'out';
/** the merchant's errand with the cart */
type CartStep = 'pull' | 'park' | 'counter' | 'unpark';

interface Guest {
  id: VisitorId;
  look: Look;
  k: number;
  state: State;
  /** plan says they should be here (or forced) */
  want: boolean;
  mv: Mover;
  fade: number;
  entry: XZ;
  spot: { x: number; z: number; yaw: number };
  act: Act; actSince: number; beatUntil: number; beatAct: Act;
  tgt: Pose; out: Pose; spr: Springs; gait: GaitState; lastYaw: number; glyphs: [GlyphState, GlyphState];
  prop: Prop | null; propS: number;
  y: number; yGround: number; hx: number; hz: number;
  talkUntil: number; talks: number; line: string; lineUntil: number; nameA: number; bubbleA: number; callAt: number;
  blinkAt: number; blinkT: number; waveW: number; greetUntil: number; greetCool: number; greeted: boolean;
  lookX: number; lookY: number;
  pos: THREE.Vector3; head: THREE.Vector3; hand: THREE.Vector3;
  light: LightEmitter; lightOff: () => void;
  unreg: () => void;
  /** seconds since settled at their spot */
  settledFor: number;
  /** the postie: parcel delivered today */
  done: boolean;
  stuckX: number; stuckZ: number; stuckT: number; stuckN: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const damp = (c: number, t: number, r: number, dt: number) => c + (t - c) * (1 - Math.exp(-r * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t: number) => t * t * (3 - 2 * t);
const LANTERN = new THREE.Color(1.0, 0.6, 0.24);
const tmpV = new THREE.Vector3();
/** where the merchant parks: east of the square, off the cobbles, near the road to the pergola */
const MERCHANT_NEAR: XZ = { x: 17.5, z: 3 };
const HUB: XZ = { x: 0, z: -1 };
/** the painter's spots: the subject, how far back she stands, and the side she prefers (toward the square) */
const PAINT_AT: Readonly<Record<string, { at: XZ; dist: number; toward?: XZ }>> = {
  windmill: { at: structure('windmill'), dist: 17 },
  pond: { at: { x: 41, z: 45 }, dist: 15, toward: { x: 30, z: 60 } },
  farmhouse: { at: structure('farmhouse'), dist: 16, toward: { x: 16, z: -8 } },
  barn: { at: structure('barn'), dist: 15, toward: { x: -12, z: -4 } },
  bridge: { at: structure('bridge'), dist: 13, toward: { x: -40, z: 18 } },
  stones: { at: structure('stones'), dist: 13 },
};

export const visitorsSystem: SystemFactory = (ctx: SceneCtx) => {
  const crowd = new Crowd(VISITOR_IDS.length, true);
  crowd.group.name = 'visitor-folk';
  const labels = new Labels(ctx);
  const root = new THREE.Group();
  root.name = 'visitors';
  root.add(crowd.group);
  ctx.scene.add(root);

  const model = () => ctx.services.get('visitors') as VisitorsService | undefined;
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const lights = ctx.services.get('lights') as LightsService | undefined;
  const flora = ctx.services.get('floraSolids') as { blocked(x: number, z: number, r: number): boolean } | undefined;
  const surface = () => ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
  const ground = (x: number, z: number): number => {
    const s = surface()?.(x, z);
    if (typeof s === 'number') return s;
    const h = heightAt(x, z);
    return h < WORLD.water + 0.1 ? WORLD.water + 0.12 : h;
  };
  const dry = (x: number, z: number) => heightAt(x, z) > WORLD.water + 0.15;
  const roads = buildRoads(PATHS, { x: 0, z: -1, hw: 12, hd: 10 });
  const routeFn = (from: XZ, to: XZ) => route(roads, SITES, from, to).filter((p, i, all) => i === all.length - 1 || !ctx.colliders.blocked(p.x, p.z, 0.3));
  const flat = (x: number, z: number, r: number, tol: number) => {
    const h0 = heightAt(x, z);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; if (Math.abs(heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h0) > tol) return false; }
    return true;
  };
  const free = (x: number, z: number, r: number) => !ctx.colliders.blocked(x, z, r) && !flora?.blocked(x, z, r) && dry(x, z) && !SITES.some((s) => inSite(s, x, z, r + 0.6));
  /** spiral out from (x, z) to the first free, level spot of radius r */
  const findSpot = (x: number, z: number, r: number, tol = 0.25, ok: (x: number, z: number) => boolean = () => true): XZ => {
    for (let i = 0; i < 900; i++) {
      const a = i * 2.39996, d = Math.sqrt(i) * 0.4, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (free(px, pz, r) && flat(px, pz, r, tol) && ok(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  };
  /** distance from (x, z) to the nearest road's edge */
  const roadGap = (x: number, z: number) => { let d = Infinity; for (const p of PATHS) if (p.width >= 2) d = Math.min(d, distToPolyline(x, z, p.points) - p.width / 2); return d; };
  const toWorld = (o: { x: number; z: number; yaw: number }, lx: number, lz: number, out: XZ = { x: 0, z: 0 }): XZ => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    out.x = o.x + lx * c + lz * s; out.z = o.z - lx * s + lz * c;
    return out;
  };

  // ---- where things are
  const trailhead = POIS.find((p) => p.id === 'trailhead') ?? { x: 1.5, z: 81 };
  /** the road over the south pass: they appear (and vanish) a few metres up it */
  const PASS: XZ = { x: trailhead.x + 2, z: trailhead.z + 1.5 };
  const halt = projectSite('halt');
  const HALT_STEP = siteLocal(halt, 0, 3.6);
  // on the meadow just off the road east of the square: off the cobbles, by a road, clear of the fields' gates and of
  // the festival dressing (whose colliders appear on the structures' first frames: so it's chosen when he arrives)
  const park = { x: 0, z: 0, yaw: 0 };
  const hitch: XZ = { x: 0, z: 0 }, counter: XZ = { x: 0, z: 0 };
  let parkKey = '';
  const placeCart = () => {
    const fest = Object.values((ctx.services.get('festivals') as { where?(): Record<string, [number, number, number]> } | undefined)?.where?.() ?? {});
    const key = `${today()}|${fest.length}`;
    if (key === parkKey) return;
    parkKey = key;
    const c = findSpot(MERCHANT_NEAR.x, MERCHANT_NEAR.z, CART.r + 0.6, 0.25, (x, z) => {
      const g = roadGap(x, z);
      return g > CART.r + 0.2 && g < CART.r + 4 && Math.hypot(x - HUB.x, z - HUB.z) > 14
        && SITES.every((st) => Math.hypot(st.gate.x - x, st.gate.z - z) > 6) && fest.every(([fx, , fz]) => Math.hypot(fx - x, fz - z) > CART.r + 1.2);
    });
    park.x = c.x; park.z = c.z; park.yaw = Math.atan2(HUB.x - c.x, HUB.z - c.z);
    toWorld(park, 0, -CART.handle - 0.25, hitch);
    toWorld(park, -1.55, 1.15, counter);
  };
  const mailbox = structure('mailbox');
  const postSpot = toWorld({ x: mailbox.x, z: mailbox.z, yaw: mailbox.yaw }, -1.35, 0.9);

  /** the painter's easel and where she stands, for a spot id (cached) */
  const easelSpots = new Map<string, { easel: { x: number; z: number; yaw: number }; stand: { x: number; z: number; yaw: number } }>();
  const easelSpot = (id: string) => {
    const fest = Object.values((ctx.services.get('festivals') as { where?(): Record<string, [number, number, number]> } | undefined)?.where?.() ?? {});
    const key = `${id}|${fest.length}`;
    let e = easelSpots.get(key);
    if (e) return e;
    const p = PAINT_AT[id] ?? PAINT_AT.windmill;
    const tw = p.toward ?? HUB;
    const dx = tw.x - p.at.x, dz = tw.z - p.at.z, l = Math.hypot(dx, dz) || 1;
    // clear of festival dressing (hay bales, the prize pumpkin): she wants room to step back from the canvas
    const c = findSpot(p.at.x + (dx / l) * p.dist, p.at.z + (dz / l) * p.dist, 1.1, 0.35, (x, z) => fest.every(([fx, , fz]) => Math.hypot(fx - x, fz - z) > 3.2));
    const yaw = Math.atan2(p.at.x - c.x, p.at.z - c.z);   // the easel faces the subject: its back (the painted side) toward us
    // she stands behind the canvas, a little to its left, looking at the subject
    const st = toWorld({ x: c.x, z: c.z, yaw }, -0.75, -0.8);
    e = { easel: { x: c.x, z: c.z, yaw: yaw + Math.PI }, stand: { x: st.x, z: st.z, yaw } };
    easelSpots.set(key, e);
    return e;
  };

  // ---- the people
  const guests: Guest[] = VISITOR_IDS.map((id, i) => {
    const entry = id === 'postie' ? HALT_STEP : PASS;
    const light: LightEmitter = { pos: new THREE.Vector3(), color: LANTERN.clone(), intensity: 0.95, radius: 4.6, flicker: 0.3, gain: 0, when: 'night' };
    const g: Guest = {
      id, look: visitorLook(id), k: 0.17 + i * 0.29, state: 'away', want: false,
      mv: newMover(entry.x, entry.z, 0), fade: 0, entry, spot: { x: entry.x, z: entry.z, yaw: 0 },
      act: 'stand', actSince: 0, beatUntil: 0, beatAct: 'stand',
      tgt: newPose(), out: newPose(), spr: newSprings(), gait: { cyc: i, w: 0, jog: 0, turn: 0, speed: 0, heavy: false, bounce: LOOKS[id].bounce }, lastYaw: 0, glyphs: newGlyphs(),
      prop: null, propS: 0, y: 0, yGround: 0, hx: 1e9, hz: 0,
      talkUntil: 0, talks: 0, line: '', lineUntil: 0, nameA: 0, bubbleA: 0, callAt: 0,
      blinkAt: 1 + i, blinkT: 99, waveW: 0, greetUntil: 0, greetCool: 0, greeted: false, lookX: 0, lookY: 0,
      pos: new THREE.Vector3(entry.x, heightAt(entry.x, entry.z), entry.z), head: new THREE.Vector3(), hand: new THREE.Vector3(),
      light, lightOff: lights ? lights.add(light) : () => {}, unreg: () => {}, settledFor: 0, done: false,
      stuckX: 0, stuckZ: 0, stuckT: 0, stuckN: 0,
    };
    actPose('stand', 0, g.k, g.look.tempo / 1.9, g.tgt, 0, 'clawd');
    springSnap(g.spr, g.tgt);
    return g;
  });
  const G = (id: VisitorId) => guests.find((g) => g.id === id)!;

  // ---- the cart
  const cartRoot = new THREE.Group();
  cartRoot.name = 'visitor-cart';
  cartRoot.visible = false;
  root.add(cartRoot);
  let cartGlass: THREE.Mesh | null = null;
  {
    const k = new Kit(41), bk = new Kit(42);
    buildCart(k, bk, true);
    const sg = k.geometry('solid'), gg = bk.geometry('solid');
    if (sg) { const m = new THREE.Mesh(sg, k.mesh().material as THREE.Material); m.castShadow = true; m.receiveShadow = true; m.name = 'visitor-cart:body'; cartRoot.add(m); }
    if (gg) {
      const mat = warmEmitter(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      cartGlass = new THREE.Mesh(gg, mat); cartGlass.name = 'visitor-cart:glass'; cartRoot.add(cartGlass);
    }
  }
  const cart = { x: PASS.x, z: PASS.z - 2.4, yaw: 0, parked: false, ease: 0, step: 'pull' as CartStep, collider: null as (() => void) | null };
  const cartLight: LightEmitter = { pos: new THREE.Vector3(), color: LANTERN.clone(), intensity: 1.1, radius: 6, flicker: 0.2, gain: 0, when: 'night' };
  const cartLightOff = lights ? lights.add(cartLight) : () => {};
  const unpark = () => { cart.collider?.(); cart.collider = null; cart.parked = false; };
  const parkCart = () => {
    cart.x = park.x; cart.z = park.z; cart.yaw = park.yaw; cart.parked = true;
    if (!cart.collider) cart.collider = ctx.colliders.rect(park.x, park.z, CART.hw * 2 + 0.2, CART.hd * 2 + 0.3, park.yaw);
  };

  // ---- the easel (and today's canvas)
  const easelRoot = new THREE.Group();
  easelRoot.name = 'visitor-easel';
  easelRoot.visible = false;
  root.add(easelRoot);
  const easelTex = canvasTex(256, 192);
  {
    const k = new Kit(43);
    buildEasel(k);
    const m = k.mesh(); m.name = 'visitor-easel:frame'; m.receiveShadow = true; easelRoot.add(m);
    const C = EASEL_CANVAS;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(C.w, C.h), new THREE.MeshToonMaterial({ map: easelTex.tex, emissive: 0xffffff, emissiveMap: easelTex.tex, emissiveIntensity: 0.25 }));
    q.name = 'visitor-easel:canvas';
    // the painted side faces the easel's back (−z, toward the subject): no, the viewer stands behind the painter; we
    // face the canvas toward +z of the easel group, which is turned to face the painter and the onlooker
    q.position.set(C.x, C.y, C.z + 0.002); q.rotation.x = C.lean;
    easelRoot.add(q);
  }
  let easelPop = 0, easelDrawn = -1, easelKey = '';
  /** a dev override of the canvas's progress (forced visits paint on a short real-time clock) */
  let forcedPaint: { started: number; done: boolean } | null = null;
  const today = () => dayKey(Date.now());
  const easel = (): EaselView | null => {
    const g = G('painter');
    if (g.state === 'away') return null;
    const day = today(), spot = paintSpotFor(day).id, season = ctx.valley.sky.season;
    const e = easelSpot(spot);
    const progress = forcedPaint ? (forcedPaint.done ? 1 : clamp((time - forcedPaint.started) / 90, 0, 1)) : paintProgress(ctx.valley.sky.hour);
    return { day, spot, season, title: paintingTitle(spot, season), progress: easelPop > 0.5 ? progress : 0, x: e.easel.x, z: e.easel.z };
  };
  const bought = (day: string) => !!model()?.data().paintings.some((p) => p.day === day);

  // ---- the painting over the fish tank (farmhouse frame; scene/interior keeps userData.indoors children while inside)
  const wall = new THREE.Group();
  wall.name = 'visitor-painting-wall';
  wall.userData.indoors = true;
  wall.visible = false;
  ctx.scene.add(wall);
  const wallTex = canvasTex(256, 192);
  {
    const fh = structure('farmhouse');
    const lx = 2.45, ly = 2.5, lz = -4.25 + 0.035;
    const c = Math.cos(fh.yaw), s = Math.sin(fh.yaw);
    wall.position.set(fh.x + lx * c + lz * s, fh.y + ly, fh.z - lx * s + lz * c);
    wall.rotation.y = fh.yaw;
    const k = new Kit(44);
    const W = 0.92, H = 0.69;
    k.box(W + 0.12, H + 0.12, 0.05, 0xc9962a, { z: 0.02 });
    k.box(W + 0.02, H + 0.02, 0.05, 0x8a6420, { z: 0.03 });
    k.box(0.02, 0.2, 0.01, 0x3b2a1e, { y: H / 2 + 0.14, z: 0.005, rz: 0.6 });
    k.box(0.02, 0.2, 0.01, 0x3b2a1e, { y: H / 2 + 0.14, z: 0.005, rz: -0.6 });
    const fm = k.mesh(); fm.castShadow = false; fm.receiveShadow = true; wall.add(fm);
    const q = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshToonMaterial({ map: wallTex.tex, emissive: 0xffffff, emissiveMap: wallTex.tex, emissiveIntensity: 0.35 }));
    q.position.z = 0.058;
    q.name = 'visitor-painting-wall:canvas';
    wall.add(q);
  }
  let wallKey = '';
  const indoors = () => ctx.services.get('indoors') as IndoorSpace | undefined;

  // ---- talking
  const lineOf = (g: Guest): string => {
    const n = g.talks;
    if (g.id === 'merchant') {
      if (g.state === 'out') return MERCHANT_BYE;
      const w = ctx.valley.sky.weather;
      if ((w.kind === 'rain' || w.kind === 'storm') && n % 3 === 1) return MERCHANT_RAIN;
      if (ctx.valley.sky.hour >= VISITORS.merchant.leave - 0.75 && n % 2 === 1) return MERCHANT_NIGHT;
      return MERCHANT_LINES[n % MERCHANT_LINES.length];
    }
    if (g.id === 'painter') {
      const e = easel();
      if (e && bought(e.day)) return PAINTER_SOLD;
      if (e && e.progress >= 1 && n % 2 === 0) return PAINTER_DONE;
      return PAINTER_LINES[n % PAINTER_LINES.length];
    }
    return POSTIE_LINES[n % POSTIE_LINES.length];
  };
  const isOpen = () => { const g = G('merchant'); return g.state === 'in' && cart.parked && cart.step === 'counter'; };
  function talk(g: Guest, chatOnly: boolean): void {
    const line = lineOf(g);
    g.talks++;
    g.talkUntil = time + 6;
    g.greeted = true; g.greetCool = time + 25; g.lineUntil = 0;
    ctx.ui.say(line, 5200, { who: VISITORS[g.id].name, from: `visitor:${g.id}` });
    audio()?.voice(`visitor:${g.id}`, { pos: g.pos, mood: 'happy', syllables: 3 + Math.floor(g.k * 4) });
    try { model()?.met(g.id); } catch { /* optional */ }
    if (chatOnly || g.id === 'postie') return;
    if (g.id === 'merchant' && !isOpen()) return;
    setTimeout(() => ctx.ui.visitors?.(g.id), 850);
  }
  const hintOf = (g: Guest): string => {
    const d = VISITORS[g.id];
    if (g.id === 'merchant') return isOpen() ? `${d.title} · rare goods today · until ${fmtHour(d.leave)}` : g.state === 'out' ? `${d.title} · packing up` : `${d.title} · setting up shop`;
    if (g.id === 'painter') { const e = easel(); return e ? `${d.title} · ${e.progress >= 1 ? (bought(e.day) ? 'the painting is yours' : 'the painting is finished: for sale!') : `painting ${Math.round(e.progress * 100)}%`}` : d.title; }
    return `${d.title} · a parcel for the mailbox`;
  };
  for (const g of guests) {
    const d = VISITORS[g.id];
    g.unreg = ctx.interact.add({
      id: `visitor:${g.id}`, kind: 'villager', verb: 'Talk to', reach: 3.4,
      label: () => `${d.short} the ${d.title.toLowerCase()}`,
      pos: (out) => out.set(g.pos.x, g.pos.y + 0.6, g.pos.z),
      enabled: () => g.state !== 'away' && g.fade > 0.5,
      use: () => talk(g, false),
      alt: { verb: 'Just chat', use: () => talk(g, true) },
      hint: () => hintOf(g),
    });
  }
  const offCart = ctx.interact.add({
    id: 'visitor:cart', kind: 'prop', verb: 'Browse', reach: 3.6, label: () => 'Barnaby\'s travelling cart',
    pos: (out) => out.set(cart.x + Math.sin(cart.yaw) * 0.9, ground(cart.x, cart.z) + 1.3, cart.z + Math.cos(cart.yaw) * 0.9),
    enabled: () => isOpen(),
    use: () => { try { model()?.met('merchant'); } catch { /* optional */ } ctx.ui.visitors?.('merchant'); },
    hint: () => 'Rare goods, one of each · no haggling',
  });
  const offEasel = ctx.interact.add({
    id: 'visitor:easel', kind: 'prop', verb: 'Look at', reach: 3.2, label: () => 'Odile\'s painting',
    pos: (out) => { const e = easel(); const s = e ? easelSpot(e.spot).easel : { x: 0, z: 0 }; return out.set(s.x, ground(s.x, s.z) + 1.2, s.z); },
    enabled: () => easelPop > 0.9 && !!easel(),
    use: () => ctx.ui.visitors?.('painter'),
    hint: () => { const e = easel(); return e ? `${e.title} · ${e.progress >= 1 ? (bought(e.day) ? 'yours' : 'finished: for sale') : `${Math.round(e.progress * 100)}% painted`}` : ''; },
  });

  // ---- the plan (who should be here), 2 Hz
  const force = new Map<VisitorId, 'in' | 'here' | 'out'>();
  let first = true;
  let time = 0, planAt = 0;
  /** when the cart's rumble / the painter's brush may sound next (s of `time`) */
  let cartSfxAt = 0, brushSfxAt = 0;
  const sfxAt = new THREE.Vector3();
  const haltDone = () => { try { return !!(ctx.services.get('projects') as ProjectsService | undefined)?.data().p.halt?.done; } catch { return false; } };
  function plan(): void {
    const day = today(), sky = ctx.valley.sky, hour = sky.hour;
    const halt = haltDone();
    for (const g of guests) {
      const f = force.get(g.id);
      let want: boolean;
      if (f) want = f !== 'out';
      else {
        want = comes(g.id, day, { halt }) && phaseAt(g.id, hour) === 'here';
        if (g.id === 'painter' && tooWetToPaint(sky.weather.kind, sky.weather.intensity)) want = false;
        if (g.id === 'postie' && g.done) want = false;
      }
      if (g.id === 'postie' && f === 'in' && g.done) want = false;
      g.want = want;
      if (want && g.state === 'away') {
        // the valley was here before you: loaded mid-visit, they're already settled (or forced 'here')
        const settled = f === 'here' || (first && !f && hour > VISITORS[g.id].arrive + 0.3);
        arrive(g, settled);
        try { model()?.arrived(g.id, day); } catch { /* optional */ }
      } else if (!want && g.state === 'in') leave(g);
      else if (want && g.state === 'out') { g.state = 'in'; g.settledFor = 0; if (g.id === 'merchant') cart.step = 'pull'; }
    }
    first = false;
  }
  function spotOf(g: Guest): { x: number; z: number; yaw: number } {
    if (g.id === 'merchant') return { x: counter.x, z: counter.z, yaw: park.yaw + 0.35 };
    if (g.id === 'painter') return easelSpot(paintSpotFor(today()).id).stand;
    return { x: postSpot.x, z: postSpot.z, yaw: Math.atan2(mailbox.x - postSpot.x, mailbox.z - postSpot.z) };
  }
  function arrive(g: Guest, settled: boolean): void {
    g.state = 'in'; g.settledFor = 0; g.done = false; g.talks = 0;
    if (g.id === 'merchant' && !cart.parked) placeCart();
    g.spot = spotOf(g);
    if (settled) {
      place(g.mv, { key: 'spot', x: g.spot.x, z: g.spot.z, yaw: g.spot.yaw, gait: 'walk' });
      g.fade = 1;
      if (g.id === 'merchant') { parkCart(); cart.step = 'counter'; cart.ease = 1; }
      if (g.id === 'painter') easelPop = 1;
    } else {
      place(g.mv, { key: 'entry', x: g.entry.x, z: g.entry.z, yaw: Math.atan2(HUB.x - g.entry.x, HUB.z - g.entry.z), gait: 'walk' });
      g.fade = 0;
      if (g.id === 'merchant') { unpark(); cart.step = 'pull'; cart.ease = 0; cart.x = g.entry.x; cart.z = g.entry.z + CART.handle + 0.6; cart.yaw = Math.atan2(g.entry.x - HUB.x, g.entry.z - HUB.z); }
      if (g.id === 'painter') easelPop = 0;
      if (g.id === 'postie') { const p = g.pos.set(g.entry.x, heightAt(g.entry.x, g.entry.z), g.entry.z); audio()?.play('train', { pos: p, volume: 0.8 }); setTimeout(() => audio()?.play('whistle', { pos: g.pos, volume: 0.7, pitch: 0.85 }), 1800); }
    }
    g.y = g.yGround = ground(g.mv.x, g.mv.z); g.hx = 1e9;
    if (g.id === 'painter') forcedPaint = force.get('painter') ? { started: time, done: false } : null;
  }
  function leave(g: Guest): void {
    g.state = 'out'; g.settledFor = 0;
    if (g.id === 'merchant') cart.step = 'unpark';
  }

  // ---- per frame
  const target = { key: '', x: 0, z: 0, yaw: 0, gait: 'walk' as 'walk' | 'jog' | 'amble' };
  function stepGuest(g: Guest, dt: number, night: number): void {
    const mv = g.mv;
    // where to go
    if (g.state === 'in') {
      if (g.id === 'merchant' && cart.step === 'pull') { target.key = 'hitch'; target.x = hitch.x; target.z = hitch.z; target.yaw = park.yaw; }
      else if (g.id === 'merchant' && cart.step === 'park') { target.key = 'hitch'; target.x = mv.x; target.z = mv.z; target.yaw = park.yaw; }
      else { target.key = 'spot'; target.x = g.spot.x; target.z = g.spot.z; target.yaw = g.spot.yaw; }
    } else {
      if (g.id === 'merchant' && cart.step === 'unpark') { target.key = 'hitch'; target.x = hitch.x; target.z = hitch.z; target.yaw = park.yaw + Math.PI; }
      else { target.key = 'exit'; target.x = g.entry.x; target.z = g.entry.z; target.yaw = Math.atan2(g.entry.x - HUB.x, g.entry.z - HUB.z); }
    }
    target.gait = 'walk';
    const talking = time < g.talkUntil;
    const pdx = ctx.player.pos.x - mv.x, pdz = ctx.player.pos.z - mv.z, pd = Math.hypot(pdx, pdz), toPlayer = Math.atan2(pdx, pdz);
    if (talking) { target.key = mv.key; target.x = mv.x; target.z = mv.z; }
    const moved = moveStep(mv, target, dt, routeFn);
    const walking = !mv.arrived;
    if (walking && Math.hypot(mv.goal.x - mv.x, mv.goal.z - mv.z) > 1.5) ctx.colliders.resolve(mv, 0.3);
    unwedge(g);
    if (pd < 0.75 && pd > 1e-3) { mv.x -= (pdx / pd) * (0.75 - pd); mv.z -= (pdz / pd) * (0.75 - pd); }
    const arrivedAt = (key: string) => mv.arrived && mv.key === key;

    // the cart: trails behind Barnaby on the road; parks, opens, packs up
    if (g.id === 'merchant') {
      if (cart.step === 'pull' && g.state === 'in' && arrivedAt('hitch')) { cart.step = 'park'; cart.ease = 0; }
      if (cart.step === 'park') {
        cart.ease = Math.min(1, cart.ease + dt / 1.2);
        if (cart.ease >= 1) { parkCart(); cart.step = 'counter'; }
      }
      if (cart.step === 'unpark' && arrivedAt('hitch')) { unpark(); cart.step = 'pull'; }
      // the cart rattling along behind him (wheels on the road, harness bells): a burst every ~1.2 s while it rolls
      if ((walking || cart.step === 'park') && !cart.parked && time > cartSfxAt && pd < 60) { cartSfxAt = time + 1.15; audio()?.play('cart', { pos: sfxAt.set(cart.x, ground(cart.x, cart.z) + 0.6, cart.z), volume: 0.8 }); }
      if (!cart.parked && cart.step !== 'park') {
        // a two-wheeled trailer: the axle follows the hitch at a fixed distance
        const L = CART.handle + 0.45;
        const dx = cart.x - mv.x, dz = cart.z - mv.z, l = Math.hypot(dx, dz) || 1;
        cart.x = mv.x + (dx / l) * L; cart.z = mv.z + (dz / l) * L;
        cart.yaw = Math.atan2(cart.x - mv.x, cart.z - mv.z);
      } else if (cart.step === 'park') {
        const e = smooth(cart.ease);
        cart.x += (park.x - cart.x) * e * 0.35; cart.z += (park.z - cart.z) * e * 0.35;
        cart.yaw += wrap(park.yaw - cart.yaw) * e * 0.35;
        if (cart.ease >= 0.999) { cart.x = park.x; cart.z = park.z; cart.yaw = park.yaw; }
      }
    }
    if (g.state === 'in' && arrivedAt('spot')) g.settledFor += dt; else if (g.state === 'in') g.settledFor = 0;
    // the postie: hand the parcel in, linger, head back for the train
    if (g.id === 'postie' && g.state === 'in' && !g.done && g.settledFor > 3) {
      g.done = true;
      try { model()?.deliver(today(), ctx.valley.sky.season, Date.now()); } catch { /* optional */ }
      g.line = 'Parcel post!'; g.lineUntil = time + 3.5;
      audio()?.play('mail', { pos: g.pos, volume: 0.8 });
      if (force.get('postie') === 'in') force.delete('postie');
    }
    if (g.id === 'postie' && g.done && g.state === 'in' && g.settledFor > 14) leave(g);
    // the easel: up once she's at her spot, packed away when she goes
    if (g.id === 'painter') {
      const up = g.state === 'in' && arrivedAt('spot');
      const want = up ? 1 : g.state === 'out' ? 0 : easelPop;
      easelPop = ctx.comfort.reducedMotion ? want : damp(easelPop, want, 5, dt);
      if (Math.abs(easelPop - want) < 0.01) easelPop = want;
    }
    // fade in at the road's end, out again when they leave the valley
    if (g.state === 'out' && arrivedAt('exit')) {
      g.fade = Math.max(0, g.fade - dt / 0.8);
      if (g.fade <= 0) {
        g.state = 'away';
        if (g.id === 'merchant') { unpark(); cartRoot.visible = false; }
        if (g.id === 'postie') audio()?.play('whistle', { pos: g.pos, volume: 0.7, pitch: 0.85 });
        if (force.get(g.id) === 'out') force.delete(g.id);
        return;
      }
    } else g.fade = Math.min(1, g.fade + dt / 0.8);

    // calling out to the player as they pass (once in a while)
    if (g.state === 'in' && g.settledFor > 2 && pd > 5 && pd < 22 && time > g.callAt && !talking) {
      g.callAt = time + 40 + g.k * 20;
      g.line = g.id === 'merchant' ? 'Curiosities! Rarities! Step right up!' : g.id === 'painter' ? (easel()?.progress ?? 0) >= 1 ? 'Finished! Come and see.' : 'Lovely light today…' : 'Parcel post!';
      g.lineUntil = time + 4;
    }
    if (pd > 11) g.greeted = false;
    if (pd < 7 && !g.greeted && time > g.greetCool && pd > 1 && g.state !== 'away') {
      g.greeted = true; g.greetCool = time + 25; g.greetUntil = time + 2.2;
      audio()?.voice(`visitor:${g.id}`, { pos: g.pos, mood: 'happy', syllables: 2 + Math.floor(g.k * 3) });
    }
    const greeting = time < g.greetUntil;

    // act
    const settled = g.state === 'in' && arrivedAt('spot');
    if (settled && time > g.beatUntil) {
      const r = Math.sin(time * 12.9898 + g.k * 78.233) * 43758.5453 % 1;
      const roll = Math.abs(r);
      if (g.id === 'painter') { const e = easel(); g.beatAct = e && e.progress < 1 ? (roll < 0.75 ? 'brush' : 'gaze') : roll < 0.5 ? 'gaze' : 'stand'; }
      else if (g.id === 'merchant') g.beatAct = roll < 0.45 ? 'stand' : roll < 0.7 ? 'lean' : roll < 0.9 ? 'inspect' : 'wave';
      else g.beatAct = roll < 0.6 ? 'stand' : 'read';
      g.beatUntil = time + 5 + roll * 6;
    }
    let act: Act = walking ? (g.id === 'postie' && !g.done ? 'carry' : g.id === 'painter' && g.state !== 'out' ? 'bindle' : 'stand') : talking ? 'talk' : settled ? g.beatAct : 'stand';
    if (night > 0.45 && !walking && ACT_INFO[act].prop && !ACT_INFO[act].grounded && act !== 'brush') act = 'stand';
    if (!walking && !talking && Math.abs(wrap(target.yaw - mv.yaw)) > 0.6 && !ACT_INFO[act].grounded) act = 'stand';
    if (act !== g.act) { g.act = act; g.actSince = time; }
    if (act === 'brush' && pd < 12 && time > brushSfxAt) { brushSfxAt = time + 1.3 + Math.random() * 0.9; audio()?.play('brush', { pos: g.pos, volume: 0.9 }); }
    // gait + pose
    const turn = dt > 0 ? wrap(mv.yaw - g.lastYaw) / dt : 0;
    g.lastYaw = mv.yaw;
    const ga = g.gait;
    ga.cyc += moved / cycleLength('clawd', mv.jog, ACT_INFO[act].heavy ?? false);
    ga.w = Math.max(mv.moving, damp(ga.w, walking ? 0 : Math.min(1, Math.abs(turn) * 0.6), 10, dt) * (walking ? 0 : 1));
    ga.jog = mv.jog; ga.turn = turn; ga.speed = mv.speed; ga.heavy = !!ACT_INFO[act].heavy && walking;
    actPose(act, time, g.k, g.look.tempo / 1.9, g.tgt, time - g.actSince, 'clawd');
    springStep(g.spr, g.tgt, dt, g.out);
    const o = g.out;
    gait(o, 'clawd', ga, walking && !!ACT_INFO[act].carryWalk);
    const waveT = greeting && !walking && !ACT_INFO[act].grounded ? 1 : 0;
    g.waveW = damp(g.waveW, waveT, 6, dt);
    if (g.waveW > 0.01) {
      const w = g.waveW;
      o[CH.aLz] += (1.1 + Math.sin(time * 10) * 0.35 - o[CH.aLz]) * w;
      o[CH.aLy] += (0.3 + Math.sin(time * 10 + 1.2) * 0.3 - o[CH.aLy]) * w;
      o[CH.aLe] += (0.5 - o[CH.aLe]) * w;
    }
    // eyes on the player when close
    let lx = 0, ly = 0;
    if (talking || greeting || pd < 4.5) {
      const rel = wrap(toPlayer - mv.yaw);
      if (Math.abs(rel) < 2.2) lx = clamp(rel * 1.1, -1, 1);
      ly = clamp(Math.atan2(1.1, Math.max(0.5, pd)) * 1.2, -0.3, 0.9);
    }
    g.lookX = damp(g.lookX, lx, 5, dt); g.lookY = damp(g.lookY, ly, 5, dt);
    const lw = Math.min(1, Math.abs(g.lookX) + Math.abs(g.lookY));
    o[CH.eyeX] = o[CH.eyeX] * (1 - lw) + g.lookX; o[CH.eyeY] = o[CH.eyeY] * (1 - lw * 0.7) + g.lookY;
    if (!walking && (talking || greeting)) mv.yaw += wrap(toPlayer - mv.yaw) * Math.min(1, dt * 4);
    // props: the act's tool, the lantern after dark
    let want: Prop | null = propOf(act);
    if (night > 0.45 && !ACT_INFO[act].grounded && !want) want = 'lantern';
    if (g.prop !== want) { g.propS -= dt / 0.18; if (g.propS <= 0) { g.propS = 0; g.prop = want; } }
    else g.propS = Math.min(1, g.propS + dt / 0.3);
    // face + blinks
    let face: Face = ACT_INFO[act].face ?? 'neutral';
    if (greeting) face = 'happy';
    if (talking && Math.sin(time * 5) < 0) face = 'talk';
    if (time > g.blinkAt) { g.blinkT = 0; g.blinkAt = time + g.look.blinkEvery * (0.6 + Math.abs(Math.sin(time + g.k * 9)) * 0.8); }
    g.blinkT += dt;
    const blink = g.blinkT < 0.14 ? Math.sin((g.blinkT / 0.14) * Math.PI) : 0;
    faceGlyphs('clawd', face, face === 'happy' ? 0 : blink, time + g.k * 3, g.glyphs);
  }
  function unwedge(g: Guest): void {
    const mv = g.mv;
    if (mv.arrived || !mv.path.length) { g.stuckX = mv.x; g.stuckZ = mv.z; g.stuckT = time; g.stuckN = 0; return; }
    if (Math.hypot(mv.x - g.stuckX, mv.z - g.stuckZ) > 0.35) { g.stuckX = mv.x; g.stuckZ = mv.z; g.stuckT = time; return; }
    if (time - g.stuckT < 1.2) return;
    const p = mv.path[mv.pi], dx = p.x - mv.x, dz = p.z - mv.z, l = Math.hypot(dx, dz) || 1;
    const side = g.stuckN % 2 ? 1 : -1, r = 1.4 + (g.stuckN % 3) * 0.6;
    const qx = mv.x + (-dz / l) * side * r + (dx / l) * 0.6, qz = mv.z + (dx / l) * side * r + (dz / l) * 0.6;
    if (!ctx.colliders.blocked(qx, qz, 0.3)) mv.path.splice(mv.pi, 0, { x: qx, z: qz });
    else if (mv.pi < mv.path.length - 1) mv.pi++;
    g.stuckN++; g.stuckT = time; g.stuckX = mv.x; g.stuckZ = mv.z;
  }

  const din: DrawIn = {
    look: null as unknown as Look, at: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 }, pose: newPose(), gait: null as unknown as GaitState, glyphs: newGlyphs(),
    prop: null, hold: 'R', propScale: 1, produce: 0xc8955a, hatLag: { x: 0, z: 0, y: 0 }, propLag: { x: 0, z: 0 }, shear: { x: 0, z: 0 }, wobble: 0, wobblePhase: 0,
  };
  const dout: DrawOut = { head: new THREE.Vector3(), hand: new THREE.Vector3(), eyes: new THREE.Vector3() };
  function draw(g: Guest, dt: number): void {
    const mv = g.mv;
    if (Math.abs(mv.x - g.hx) + Math.abs(mv.z - g.hz) > 0.05) { g.hx = mv.x; g.hz = mv.z; g.yGround = ground(mv.x, mv.z); }
    g.y = damp(g.y, g.yGround, 18, dt);
    din.look = g.look; din.pose.set(g.out); din.gait = g.gait; din.glyphs = g.glyphs;
    din.at.x = mv.x; din.at.y = g.y; din.at.z = mv.z; din.at.yaw = mv.yaw;
    din.at.scale = g.look.scale * smooth(clamp(g.fade, 0, 1));
    din.prop = g.prop; din.hold = g.prop === 'lantern' ? 'R' : holdOf(g.act); din.propScale = g.propS;
    crowd.draw(din, dout);
    g.pos.set(mv.x, g.y, mv.z);
    g.head.copy(dout.head); g.hand.copy(dout.hand);
    const lit = g.prop === 'lantern' ? g.propS * g.fade : 0;
    g.light.gain = lit;
    if (lit > 0) g.light.pos.set(g.hand.x, g.hand.y - 0.16, g.hand.z);
  }

  // ---- the canvases
  function paintEasel(): void {
    const e = easel();
    if (!e) return;
    const key = `${e.spot}|${e.season}|${e.day}`;
    const q = Math.floor(e.progress * 20) / 20;
    if (key === easelKey && q === easelDrawn) return;
    easelKey = key; easelDrawn = q;
    drawPainting(easelTex.g, easelTex.w, easelTex.h, e.spot, e.season, e.day, q);
    easelTex.tex.needsUpdate = true;
  }
  function paintWall(): void {
    const ps = model()?.data().paintings ?? [];
    const p = ps[ps.length - 1];
    const key = p ? `${p.spot}|${p.season}|${p.day}` : '';
    if (key === wallKey) return;
    wallKey = key;
    if (!p) return;
    drawPainting(wallTex.g, wallTex.w, wallTex.h, p.spot, p.season, p.day, 1);
    wallTex.tex.needsUpdate = true;
  }

  // ---- service
  const pinsOut: VisitorPin[] = [];
  const service: VisitorsScene = {
    list() {
      pinsOut.length = 0;
      for (const g of guests) {
        if (g.state === 'away') continue;
        const d = VISITORS[g.id], L = LOOKS[g.id];
        const where = g.id === 'merchant' ? (cart.parked ? cart : g.mv) : g.mv;
        const line = g.id === 'merchant' ? (isOpen() ? `Rare goods today, until ${fmtHour(d.leave)}` : g.state === 'out' ? 'Leaving over the pass' : 'Pulling the cart into the square')
          : g.id === 'painter' ? (() => { const e = easel(); return e ? `Painting ${(PAINT_SPOT_NAME[e.spot] ?? 'the valley')} · ${e.progress >= 1 ? 'finished' : `${Math.round(e.progress * 100)}%`}` : 'Looking for the light'; })()
          : g.done ? 'Heading back for the train' : 'Bringing a parcel to the mailbox';
        pinsOut.push({ id: g.id, name: d.name, title: d.title, glyph: L.glyph, color: L.pin, x: where.x, z: where.z, line, settled: g.state === 'in' && g.settledFor > 0 });
      }
      return pinsOut;
    },
    open: isOpen,
    painting: easel,
    paintingUrl: (spot, season, day, progress = 1) => paintingUrl(spot, season, day, progress),
    force(id, mode) {
      if (!VISITOR_IDS.includes(id)) return false;
      if (mode === null) force.delete(id); else force.set(id, mode);
      const g = G(id);
      if (mode === 'here' && g.state !== 'away') { arrive(g, true); }
      if (mode === 'in' && id === 'postie') g.done = false;
      if (mode === 'in' && id === 'painter') forcedPaint = { started: time, done: false };
      if (mode === 'here' && id === 'painter') forcedPaint = { started: time, done: false };
      plan();
      return true;
    },
    go(id) {
      const g = G(id);
      const ctl = ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined;
      if (!g || !ctl || g.state === 'away') return false;
      // the merchant: in front of the counter; the painter: behind her shoulder, the canvas in view; the postie: face to face
      if (id === 'merchant' && cart.parked) { const p = toWorld(park, 0.3, 4.6); ctl.teleport(p.x, p.z, Math.atan2(-(park.x - 0.2 - p.x), -(park.z - p.z)), -0.12); return true; }
      if (id === 'painter' && easelPop > 0.5) {
        const e = easelSpot(paintSpotFor(today()).id).easel, p = toWorld(e, -1.5, 3.4);
        ctl.teleport(p.x, p.z, Math.atan2(-(e.x - p.x), -(e.z - p.z)), -0.12);
        return true;
      }
      // the postie at the mailbox: from beyond him (the mailbox behind him, not between us); anyone else face to face
      const s = g.mv, away = id === 'postie' && Math.hypot(s.x - postSpot.x, s.z - postSpot.z) < 1.5
        ? Math.atan2(s.x - mailbox.x, s.z - mailbox.z) : s.yaw;
      const fx = s.x + Math.sin(away) * 3.4, fz = s.z + Math.cos(away) * 3.4;
      ctl.teleport(fx, fz, Math.atan2(-(s.x - fx), -(s.z - fz)), -0.15);
      return true;
    },
    finish() { forcedPaint = { started: time - 999, done: true }; easelDrawn = -1; },
    debug() {
      return {
        day: today(), halt: haltDone(),
        cart: { x: cart.x, z: cart.z, yaw: cart.yaw, parked: cart.parked, step: cart.step, park },
        guests: guests.map((g) => ({ id: g.id, state: g.state, want: g.want, x: g.mv.x, z: g.mv.z, arrived: g.mv.arrived, key: g.mv.key, settled: g.settledFor, fade: g.fade, act: g.act, done: g.done, forced: force.get(g.id) ?? null })),
        easel: easel(),
      };
    },
  };
  ctx.services.set('visitorsScene', service);

  const camPos = new THREE.Vector3();
  return {
    name: 'visitors',
    update(fi: FrameInfo) {
      const dt = fi.dt;
      time += dt;
      const night = ctx.lighting.night;
      if (time >= planAt) { planAt = time + 0.5; plan(); }
      crowd.begin();
      for (const g of guests) {
        if (g.state === 'away') { g.light.gain = 0; continue; }
        stepGuest(g, dt, night);
        if ((g.state as State) !== 'away') draw(g, dt);   // (stepGuest may have sent them home)
        else g.light.gain = 0;
      }
      crowd.end();
      // the cart
      const m = G('merchant');
      cartRoot.visible = m.state !== 'away';
      if (cartRoot.visible) {
        const vis = smooth(clamp(m.fade, 0, 1));
        cartRoot.position.set(cart.x, cart.parked ? heightAt(cart.x, cart.z) - 0.02 : ground(cart.x, cart.z), cart.z);
        cartRoot.rotation.set(0, cart.yaw, 0);
        // rolling on the road: a little rock side to side (not with reduced motion)
        if (!cart.parked && !ctx.comfort.reducedMotion && m.mv.speed > 0.1) cartRoot.rotation.z = Math.sin(time * 5.5) * 0.02;
        cartRoot.scale.setScalar(Math.max(0.001, vis));
        const lit = night * vis;
        if (cartGlass) (cartGlass.material as THREE.MeshBasicMaterial).color.setScalar(0.7 + lit * 1.8);
        cartLight.gain = cart.parked ? lit : lit * 0.7;
        tmpV.set(CART_LANTERN.x, CART_LANTERN.y, CART_LANTERN.z).applyEuler(cartRoot.rotation);
        cartLight.pos.set(cartRoot.position.x + tmpV.x, cartRoot.position.y + tmpV.y, cartRoot.position.z + tmpV.z);
      } else cartLight.gain = 0;
      // the easel
      const p = G('painter');
      easelRoot.visible = p.state !== 'away' && easelPop > 0.01;
      if (easelRoot.visible) {
        const e = easelSpot(paintSpotFor(today()).id).easel;
        easelRoot.position.set(e.x, heightAt(e.x, e.z), e.z);
        easelRoot.rotation.y = e.yaw;
        easelRoot.scale.setScalar(Math.max(0.001, easelPop));
        paintEasel();
      }
      // the farmhouse wall (only while you're inside the farmhouse)
      const ins = indoors();
      wall.visible = !!ins?.active && (ins.room ?? 'farmhouse') === 'farmhouse' && (model()?.data().paintings.length ?? 0) > 0;
      if (wall.visible) paintWall();

      // labels: name + title close up, call-outs
      ctx.camera.getWorldPosition(camPos);
      labels.begin(dt);
      const focused = ctx.interact.focused();
      for (const g of guests) {
        if (g.state === 'away') continue;
        const dist = camPos.distanceTo(g.head);
        const isF = focused?.id === `visitor:${g.id}`;
        g.nameA = damp(g.nameA, (dist < 10 || isF || ctx.debug.labels) ? g.fade : 0, 6, dt);
        g.bubbleA = damp(g.bubbleA, time < g.lineUntil && dist < 24 ? 1 : 0, time < g.lineUntil ? 5 : 8, dt);
        tmpV.set(g.head.x, g.head.y + 0.36, g.head.z);
        const d = VISITORS[g.id];
        if (g.nameA > 0.02) labels.show(`visitor:${g.id}`, `visitor:${g.id}`, 'villager', d.short, d.title, tmpV, g.nameA);
        if (g.bubbleA > 0.02) labels.show(`visitor:${g.id}:say`, `visitor:${g.id}`, 'speech', g.line, d.short, tmpV, g.bubbleA);
      }
      labels.end();
    },
    stats() {
      return { visitors: guests.filter((g) => g.state !== 'away').length, cart: cartRoot.visible ? 1 : 0, easel: easelRoot.visible ? 1 : 0 };
    },
    dispose() {
      for (const g of guests) { g.unreg(); g.lightOff(); }
      offCart(); offEasel(); cartLightOff(); unpark();
      ctx.scene.remove(root); ctx.scene.remove(wall);
      crowd.dispose();
      easelTex.tex.dispose(); wallTex.tex.dispose();
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); } });
      wall.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); } });
      if (ctx.services.get('visitorsScene') === service) ctx.services.delete('visitorsScene');
    },
  };
};

const PAINT_SPOT_NAME: Readonly<Record<string, string>> = {
  windmill: 'the windmill', pond: 'the pond', farmhouse: 'the farmhouse', barn: 'the barn', bridge: 'the bridge', stones: 'the standing stones',
};
function fmtHour(h: number): string { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${hh}:${String(mm).padStart(2, '0')}`; }
