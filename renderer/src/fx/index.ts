/**
 * FX API (§5.4): everything is keyed by actorId, idempotent and cheap to call every frame. BRN's actors.ts is the only
 * caller for actors (§5.4 wiring); FX reads actor positions / rigs through `bindActors(actors)` and draws:
 *  - status rings per the chroma budget + the blocked beacon ripple (rings.ts)
 *  - nameplates (nameplates.ts), speech / thought / alert bubbles (bubbles.ts), all placed by ONE screen-space
 *    declutter pass with the glyphs and the task boards as obstacles (labels.ts, declutter.ts) [FX fix r2]
 *  - distance activity glyphs (glyphs.ts), the long-idle dust ladder (dust.ts)
 *  - derived ambient signals: rain cloud, crossed-out paper orbit, Z's, steaming mug (ambient.ts, rules.ambientOf)
 *  - the particle pool (particles.ts) and task placards (placards.ts, own task atlas + screen program)
 *  - [FX M3.5] struggle flares (flares.ts, in the label pass) and the feedback moments (moments.ts): blocked lantern
 *    escalation, the prompt paper plane, pat hearts, crate-unwrap dust, inbox-zero confetti; all on the batches above
 * Draw cost: ≤ 4 overlay draw calls (sprites, hot sprites, particles, confetti) + 1 while a nameplate or alert shows
 * (the on-top batch: alert cards / chips and, [FX fix r3], nameplates) + 1 while an alert shows (its hot badges, INT M1.5),
 * all on the one `particle` program,
 * + 1 placard draw on the existing instanced `screen` program, whatever the agent count. One 2048² sprite atlas + one 2048² task atlas (ART §10 ≤ 4).
 * Owner: FX.
 */
import * as THREE from 'three';
import { getMaterial } from '../render/materials/index.ts';
import { hqRegister, hqStatSection } from '../core/debug.ts';
import { hash32 } from '../../../shared/identity.ts';
import { taskLabel, fitLabel } from '../../../shared/task.ts';
import { BODY_H } from '../chars/render/geometry.ts';
import { createAtlas } from './atlas.ts';
import { createQuadBatch } from './quads.ts';
import { createTiles } from './tiles.ts';
import { createParticles } from './particles.ts';
import { createRings } from './rings.ts';
import { createNameplates } from './nameplates.ts';
import { createBubbles } from './bubbles.ts';
import { createGlyphs } from './glyphs.ts';
import { createDust } from './dust.ts';
import { createAmbient } from './ambient.ts';
import { createPlacards, deskMugSpot } from './placards.ts';
import { createLabels } from './labels.ts';
import { sortInPlace } from './declutter.ts';
import { ambientOf, pennantText, stripTask } from './rules.ts';
import { createFlares, flareText } from './flares.ts'; // [FX M3.5] struggle flare
import { createMoments } from './moments.ts'; // [FX M3.5] lantern escalation, paper plane, hearts, inbox-zero confetti
import { boardNames } from '../world/stats/format.ts'; // [FX fix m2-r2] the Big Board's twin labels (STAT, @pure)
import type { Ctx } from '../core/ctx.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { BurstKind, BurstOpts } from './particles.ts';
import type { BubbleSpec, FxActors, FxFrame, FxState, PlacardSpec, PlateSpec, RingSpec, Vec3Like } from './types.ts';
import type { PlacardQuery } from './placards.ts';

/** Burst options as callers pass them: the pool's own plus free-form extras (the `verb` event's kind / detail). */
export type FxBurstOpts = BurstOpts & { [extra: string]: unknown };

/** The frame ctx fields `update` reads (the full §8.1 ctx satisfies it). */
export type FxUpdateCtx = Pick<Ctx, 'camera' | 'time' | 'dt' | 'now' | 'store'>;

export interface Fx {
  bubble(actorId: string, spec: BubbleSpec | null): void;
  ring(actorId: string, spec: RingSpec | null): void;
  plate(actorId: string, spec: PlateSpec | null): void;
  glyph(actorId: string, cls: string | null): void;
  burst(kind: BurstKind, pos: Vec3Like, opts?: FxBurstOpts): void;
  dust(actorId: string, level: 0 | 1 | 2 | 3): void;
  placard(actorId: string, spec: PlacardSpec | null): void;
  /** drop everything keyed by this actor (actor removed) */
  forget(actorId: string): void;
  /** position / rig source (main.ts) */
  bindActors(actors: FxActors | null): void;
  /** §8.1 step 6 */
  update(ctx: FxUpdateCtx): void;
  /** `__hq.stats().fx` */
  counters: Record<string, number>;
}

const HEAD_EXTRA = { clawd: 0.02, shelly: 0.02 }; // clearance over the crown (Clawd: rig.crown, the accessory top) / antenna
/** [FX fix r3] Raised-hand label hold: the label anchor follows a hand up at once and settles back at this rate (m/s). */
const HAND_FALL = 0.8;

export function createFx(ctx: Ctx): Fx {
  const { scene, renderer, bus, layout } = ctx;
  let fontsOk = false;
  const fontsReady = () => fontsOk;
  (document.fonts?.ready ?? Promise.resolve()).then(() => { fontsOk = true; });

  const atlas = createAtlas(renderer ?? null, { size: 2048, name: 'sprite', premultiply: true });
  const tiles = createTiles(atlas, fontsReady);
  const mat = (kind: 'particle', intensity: number): THREE.MeshBasicMaterial => {
    const m = getMaterial(kind, { vertexColors: true, emissiveIntensity: intensity, uniforms: {} }) as THREE.MeshBasicMaterial; // the `particle` kind is a MeshBasicMaterial
    m.map = atlas.texture;
    m.blendSrc = THREE.OneFactor; // premultiplied atlas + vertex colours (GL state only: same program)
    return m;
  };
  // §5.0 emissive policy: paper sprites ≤ 1 (never bloom); blocked badge / ring / beacon 2.5; confetti 1.2.
  // All four batches use the `particle` kind (VCOL): ONE program for the whole of FX. (`sprite` stays CHR's
  // instanced glint/stroke variant; a non-instanced VCOL sprite would be a second `sprite` program, §5.4 matrix.)
  // [FX fix r2] paper labels (bubbles, plates, glyphs, alert cards) write the character mask (alpha → 0 under opaque
  // paper, GL blend state only: same program): the Edge pass then never draws door frames / rails through a bubble,
  // and the AO composite never darkens one (both skip alpha-0 pixels, §5.1). Floor rings in the same batch only
  // thin the mask where they are drawn.
  const maskOut = (m: THREE.Material) => { m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor; return m; };
  const sprite = createQuadBatch(maskOut(mat('particle', 1)), 1024, { name: 'fx:sprites', renderOrder: 10 });
  const hot = createQuadBatch(mat('particle', 2.5), 256, { name: 'fx:hot', renderOrder: 12 });
  const pPlain = createQuadBatch(mat('particle', 1), 1024, { name: 'fx:particles', renderOrder: 11 });
  const pHot = createQuadBatch(mat('particle', 1.2), 512, { name: 'fx:confetti', renderOrder: 11 });
  // [INT M1.5] blocked alerts (card + "!" badge) draw on top, never hidden behind signs / posts / the Big Board
  // (P1: the queue must read from spawn). Same `particle` program; depthTest is GL state. Drawn only while ≥ 1 alert shows.
  const onTop = (m: THREE.Material) => { m.depthTest = false; m.depthWrite = false; return m; };
  // [FX fix r3] nameplates (+ their leaders) share this batch: a foreground Clawd's hat no longer slices a plate, and
  // plates stay out of the Edge / AO mask like the cards. So it draws whenever a plate or an alert shows.
  // [FX M1.75] speech / thought bubbles too (a near rail post cut them in half; labels.ts hides walled ones).
  const pin = createQuadBatch(maskOut(onTop(mat('particle', 1))), 512, { name: 'fx:alerts', renderOrder: 13 });
  const pinHot = createQuadBatch(maskOut(onTop(mat('particle', 2.5))), 128, { name: 'fx:alertBadges', renderOrder: 14 });
  for (const b of [sprite, hot, pPlain, pHot, pin, pinHot]) scene?.add(b.mesh);

  // [FX fix r1 m2-carry] on-top particles (pat hearts: never buried in a hat / head / desk); drawn only while one lives
  const pTop = createQuadBatch(onTop(mat('particle', 1)), 128, { name: 'fx:particlesTop', renderOrder: 13 });
  scene?.add(pTop.mesh);
  const particles = createParticles({ hot: pHot, plain: pPlain, top: pTop, tile: (k) => tiles.shape(k) });
  const rings = createRings({ tiles, sprite, hot });
  const plates = createNameplates({ atlas, fontsReady });
  const bubbles = createBubbles({ atlas, fontsReady });
  const glyphs = createGlyphs({ tiles });
  const flares = createFlares({ atlas, fontsReady });
  const dust = createDust({ tiles, sprite, particles });
  const ambient = createAmbient({ tiles, sprite, particles });
  const placards = scene ? createPlacards({ renderer: renderer ?? null, scene, layout, params: ctx.params ?? null }) : null;
  const labels = createLabels({ bubbles, plates, glyphs, flares, particles, tiles, placards, sprite, pin, pinHot, hot, layout });
  bus?.on?.('viewStrip', (s) => labels.setStrip(s)); // roster / drawer insets (§8.2.1): labels stay inside the strip
  bus?.on?.('ui.obstacles', (m) => labels.setUiObstacles(m?.key ?? 'ui', m?.rects, m)); // [UI fix r3] edge chevrons; [FX fix m2-r1] 'panels' = hard obstacles + ids / serve
  // [UI fix r3] chevrons skip agents whose card shows; [FX fix m2-r2] + the alerts FX hands to the chevrons (anchor at /
  // past the strip edge: the chevron shows although the agent projects inside the strip)
  bus?.on?.('fx.alertsQuery', (cb) => cb?.(labels.alertShown, { alertEdge: labels.alertEdge }));

  let actors: FxActors | null = null;
  let selected: string | null = null, hovered: string | null = null, followed: string | null = null, rosterHovered: string | null = null;
  bus?.on?.('select', (p) => { selected = p?.id ?? null; });
  bus?.on?.('cam.follow', (p) => { followed = p?.id ?? null; });
  bus?.on?.('aim', (p) => { hovered = p?.id ?? null; }); // UI crosshair target (ui/index.ts)
  // [FX fix r2 m2-carry] a roster row hovered ~400 ms (ui/roster/view.ts) counts as hovering its agent: in plan / overview
  // (reticle aim reaches 9 m) it is how a collapsed '!' pin opens its card
  bus?.on?.('roster.hover', (p) => { rosterHovered = p?.id ?? null; });

  const states = new Map<string, FxState>();
  /** [FX fix m2-r1] array mirror of `states` for the per-frame loops (no Map iterator per loop per frame) */
  const stateList: FxState[] = [];
  const S0 = (id: string): FxState => {
    let S = states.get(id);
    if (!S) {
      // [FX fix m2-r1] EVERY per-actor field FX writes is declared here, in one order: all states share one hidden class,
      // so the hot loops' loads stay monomorphic (fields added later in actor-specific orders made the sorts / label
      // passes megamorphic, and a megamorphic load of a float field boxes a fresh heap number: ~40 KB/frame at crowd40)
      const h = hash32(id);
      S = { id, ring: null, plate: null, bubble: null, bubbleSpec: null, qSpec: null, glyph: null, dust: 0, placardSpec: null, phase: (h % 1000) / 159.2,
        x: 0.5, y: 0.5, z: 0.5, floorY: 0.5, top: 1.5, bodyTop: 1.5, headY: 1.5, handTop: -Infinity, dist: 99.5, depth: 99.5, vis: false, fade: 1.5,
        status: 'unknown', since: 0.5, qPos: -1, acked: false, hovered: false, selected: false, amb: null, mug: null, nowT: 0.5,
        bTile: null, bDrawn: null, bLayout: null, bPopKey: '', bPopT: 0.5, bGoneT: 0.5, bA: 0.5, bW: 0.5, bH: 0.5, bS: 0.5, bK: 0.5, bWob: 0.5, bDot: 0.5,
        cTile: null, cDrawn: null, cLayout: null, cWho: null, cW: 0.5, cH: 0.5, cS: 0.5, cMinW: 0.5,
        pTile: null, pDrawn: null, pLayout: null, pA: 0.5, pW: 0.5, pH: 0.5, gA: 0.5, gPx: 0.5,
        hasB: false, hasP: false, hasG: false, lMode: 0, pMode: 0, gMode: 0, lChip: false, lTether: false, rank: 0.5,
        ax: 0.5, ay: 0.5, hx: 0.5, hy: 0.5, lP: null, lB: null, lG: null, occ: false, occT: -9.5,
        bubbleTopX: 0.5, bubbleTopY: -Infinity, bubbleTopZ: 0.5, bubbleTopPx: 0,
        name: '', pName: '', bWho: '', lEdge: false,
        flare: null, fSrc: null, fTile: null, fDrawn: null, fLayout: null, fW: 0.5, fH: 0.5, fA: 0.5, hasF: false, fMode: 0, lF: null, fAcc: 0.5, // [FX M3.5]
        rainAcc: 0.5, zAcc: (h % 997) / 997, sAcc: 0.5, dAcc: 0.5, pen: null, penAt: null, penKey: null };
      S.rainAcc = S.sAcc = S.dAcc = 0;
      states.set(id, S);
      stateList.push(S);
    }
    return S;
  };

  // [FX M3.5] feedback moments: listens to the renderer bus (answered, inbox.zero, verb, crate.unwrap)
  const moments = createMoments({ tiles, sprite, pin, particles, layout, bus, los: labels.los,
    stateOf: (id) => states.get(id), actorOf: (id) => actors?.get(id) });

  const calls: Record<string, number> = { bubble: 0, ring: 0, plate: 0, glyph: 0, burst: 0, dust: 0, placard: 0, forget: 0 };
  let fxMs = 0, placardMs = 0;
  // [FX fix m2-r1] counters are gathered when read (`__hq.stats().fx`, a spread), not per frame: the per-frame
  // Object.assign over nine fresh stats objects was a steady ~1 KB/frame of garbage. Each key is an enumerable getter
  // over one snapshot, refreshed at most once per rendered frame.
  const snapshot = () => Object.assign({}, calls, rings.stats(), plates.stats(), bubbles.stats(), labels.stats(), dust.stats(), ambient.stats(), flares.stats(), moments.stats(),
    { particles: particles.stats().live, quads: sprite.count + hot.count + pin.count + pinHot.count, atlasTiles: atlas.stats().tiles, placards: placards?.stats().boards ?? 0,
      fxMs: +fxMs.toFixed(3), placardMs: +placardMs.toFixed(3) });
  let snap: Record<string, number> | null = null, snapFrame = -1, frameNo = 0;
  const read = (k: string) => { const s = snapFrame !== frameNo || !snap ? (snap = snapshot()) : snap; snapFrame = frameNo; return s[k]; };
  const counters: Record<string, number> = {};
  for (const k of Object.keys(snapshot())) Object.defineProperty(counters, k, { get: () => read(k), enumerable: true });
  // [BRN fix r3, cross-owner] computed when `__hq.stats().fx` is read, not per frame (labels.overlaps is O(n²))
  Object.defineProperty(counters, 'labelOverlaps', { get: () => labels.overlaps(), enumerable: true });

  const byDistDesc = (p: FxState, q: FxState) => (q.dist < p.dist ? -1 : q.dist > p.dist ? 1 : 0); // small-int result (no boxed float)
  const R = new THREE.Vector3(), U = new THREE.Vector3(), Fw = new THREE.Vector3(), cam = new THREE.Vector3(), v = new THREE.Vector3();
  // (`camera` is a placeholder until the first update writes the real one)
  const F: FxFrame = { t: 0, dt: 0, now: 0, camera: new THREE.PerspectiveCamera(), R, U, F: Fw, fovK: 0.577, vw: 1600, vh: 900 };
  const vis: FxState[] = [];
  const kindOf = (id: string) => actors?.get(id)?.entity?.kind;
  const statusOf = (id: string) => states.get(id)?.status;
  /** [FX fix r2 m2-carry] bay-strip secondary text per actor, memoised on the entity object (rebuilt on any change) */
  const stripMemo = new Map<string, { e: Partial<Entity>; r: ReturnType<typeof stripTask> }>();
  const stripTaskOf = (id: string) => {
    const e = actors?.get(id)?.entity;
    if (!e) return null;
    let m = stripMemo.get(id);
    if (!m || m.e !== e) stripMemo.set(id, (m = { e, r: stripTask(e, taskLabel, fitLabel) }));
    return m.r;
  };
  const placardQ: PlacardQuery = {
    statusOf,
    stripTaskOf, // [FX fix r2 m2-carry] the strip's task line: never the workspace (the board may fall back to it)
    posOf: (id: string) => actors?.get(id)?.pos ?? null,
    nameOf: (id: string) => states.get(id)?.name || actors?.get(id)?.entity?.name,
    cards: () => labels.cardRects(), // [FX fix m175-r2] a strip under an alert card yields to it
    strip: () => labels.strip(), // [FX fix m175-r2] a strip the view-strip edge cuts shrinks / hides
    // [FX fix m3-r3] walk-up subject (placards PEN_CAP: the other agents' near ✓ flags furl away): the selected /
    // followed agent, else the desk UI's last walk-up (ctx.walkUpId, UI; placards gates it to within a few metres)
    subject: () => selected ?? followed ?? ctx?.walkUpId ?? null,
  };

  /**
   * [FX fix m2-r2] Display names = the Big Board's (world/stats/format.ts boardNames): same-named agents get " · 2",
   * " · 3" in stable id order, so an in-world plate / alert reads exactly like its board row and edge chevron
   * (mixed: both Engine Room shells read 'dev' while the board said 'dev · 2 • dev'). Refreshed at 4 Hz and whenever
   * the entity count changes (a few small allocations per refresh, none per frame).
   */
  let names = new Map<string, string>(), namesT = -1, namesN = -1;
  const refreshNames = (store: FxUpdateCtx['store'] | undefined, t: number) => {
    const ents = store?.entities;
    if (!ents) return;
    if (ents.size === namesN && t - namesT < 0.25 && t >= namesT) return;
    names = boardNames(ents.values()); namesT = t; namesN = ents.size;
  };

  function update(c: FxUpdateCtx) {
    const camera = c.camera;
    if (!camera) return;
    const t0 = performance.now();
    refreshNames(c.store ?? ctx.store, c.time ?? 0);
    atlas.prepare();
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(R, U, Fw);
    Fw.negate();
    cam.setFromMatrixPosition(camera.matrixWorld);
    const el = renderer?.domElement;
    F.t = c.time; F.dt = Math.min(0.1, c.dt || 0); F.now = c.now; F.camera = camera;
    F.fovK = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    F.vw = el?.clientWidth || innerWidth; F.vh = el?.clientHeight || innerHeight;

    sprite.begin(); hot.begin(); pin.begin(); pinHot.begin();
    rings.begin(); dust.begin(); ambient.begin();
    vis.length = 0;
    for (const S of stateList) {
      const a = actors?.get(S.id);
      S.nowT = F.t;
      if (!a || a.mode === 'wait') { S.vis = false; continue; }
      const e = a.entity;
      S.x = a.pos.x; S.z = a.pos.z; S.y = a.pos.y; S.floorY = a.pos.y - (a.lift ?? 0);
      S.name = names.get(S.id) ?? S.plate?.name ?? e?.name ?? '';
      S.status = e?.status ?? 'unknown';
      S.since = e?.statusSince ?? F.now;
      // [FX fix m2-r3] queue position (0 = the window / the agent being served) from the brain's queue slot, else -1:
      // the label declutter orders the queue's cards by it (the head gets the full card)
      const sl = a.intent?.slot;
      S.qPos = sl?.tag === 'queue' ? Number(String(sl.id).split(':').pop()) || 0 : -1;
      S.acked = !!e?.ack;
      S.hovered = hovered === S.id || rosterHovered === S.id; S.selected = selected === S.id || followed === S.id;
      const ex = S.x - cam.x, ey = S.y + 0.8 - cam.y, ez = S.z - cam.z;
      S.dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      // [INT M1.5] view-space depth: screen px ↔ world m for camera-facing sprites (Euclidean dist over-sizes them off-axis)
      S.depth = Math.max(0.05, (S.x - cam.x) * Fw.x + (S.y + 0.8 - cam.y) * Fw.y + (S.z - cam.z) * Fw.z);
      S.fade = a.mode === 'leave' ? 0 : 1;
      rings.draw(S, F); // rings draw off-screen actors too (the beacon ripple reaches into view)
      S.vis = !!a.visible && S.fade > 0;
      if (!S.vis) continue;
      // head top from the live rig (matrices written by charBatch.write this frame)
      const rig = a.rig, shape = rig?.nodes?.shape;
      if (rig && shape) {
        const shelly = rig.species === 'shelly';
        // [FX fix r3] the real crown (accessory top, rig.crown: a party hat stands 0.39 m over the body; the old flat
        // 0.14 m allowance put plates inside tall hats)
        v.set(0, shelly ? 0.34 : Math.max(BODY_H, rig.crown ?? BODY_H), 0).applyMatrix4(shape.matrixWorld);
        S.bodyTop = v.y; // the protected body rect's top (labels.ts)
        // the pillowed body top without the accessory: head-hugging FX (dust, the paper orbit) stay on the head
        S.headY = shelly ? v.y : v.set(0, BODY_H + 0.02, 0).applyMatrix4(shape.matrixWorld).y;
        S.top = S.bodyTop + (shelly ? HEAD_EXTRA.shelly : HEAD_EXTRA.clawd);
        // [FX fix r3] a blocked Clawd waves a hand high over its crown: labels anchor over the highest hand, with a
        // peak hold so the card rides the wave instead of bobbing with it
        let hand = -Infinity;
        if (S.status === 'blocked' && rig.arms) {
          for (const arm of rig.arms) { v.setFromMatrixPosition(arm.hand.matrixWorld); hand = Math.max(hand, v.y + 0.07); }
        }
        S.handTop = Math.max(hand, (S.handTop ?? -Infinity) - HAND_FALL * F.dt);
        if (S.handTop > S.top) S.top = S.handTop;
      } else S.headY = S.bodyTop = S.top = S.floorY + 1.0;
      S.amb = ambientOf(e, a.intent, F.now, S.amb ?? undefined); // reused per actor [FX fix m2-r1]
      // [FX M3.5] struggle flare: working with struggle.level ≥ 2 (a new spec object only when the struggle changes)
      const sg = S.status === 'working' ? e?.struggle ?? null : null;
      if (sg !== S.fSrc) { S.fSrc = sg; const ft = flareText(sg); S.flare = ft && sg ? { text: ft, level: sg.level } : null; }
      // §6.7 one visual = one meaning [FX fix r1]: a '?' mark shows only while the entity really is `unknown` (the brain's
      // committed status lags 1.5 s behind, so an agent that just turned idle kept a '? ?' cloud on its wander), and
      // only as the icon (no duplicate '?' title).
      const bs = S.bubbleSpec;
      S.bubble = !bs || bs.icon !== '?' ? bs : S.status !== 'unknown' ? null : bs.title ? (S.qSpec?.src === bs ? S.qSpec : (S.qSpec = { ...bs, title: '', detail: undefined, src: bs })) : bs;
      vis.push(S);
    }
    sortInPlace(vis, byDistDesc); // far → near (transparent overlap order)
    for (const S of vis) {
      dust.draw(S, F);
      const home = S.placardSpec?.deskAnchor;
      if (!S.amb) continue; // (every visible actor got its ambient flags above)
      ambient.draw(S, S.amb, F, S.amb.steam && home && actors?.get(S.id)?.intent?.phase === 'working' ? (S.mug ??= deskMugSpot(layout, home)) : null);
    }
    // [FX M1.75] ✓ pennants: done and not signed off, lettered with the task, carried beside the head (Pit, outings)
    if (placards) {
      for (const S of stateList) {
        const a = actors?.get(S.id);
        const want = !!a && a.mode !== 'wait' && S.status === 'done' && !S.acked && a.entity?.kind !== 'shell';
        if (!want) { if (S.pen) { S.pen = null; placards.pennant(S.id, null); } continue; }
        // [FX fix r1 m2-carry] the task, else the last todo, else 'done ✓': never the desk placard's project fallback
        // (the workspace label 'infra' read as a task title; it is on the nameplate already)
        // [FX fix m2-r1] memoised on the fields taskLabel reads (it ran its regexes per done agent per frame)
        const en = a.entity;
        if (!S.penKey || S.penKey.e !== en || S.penKey.title !== en?.title || S.penKey.base !== en?.baseTitle || S.penKey.prompt !== en?.lastPrompt || S.penKey.proc !== en?.process || S.penKey.todos !== en?.todos) {
          S.penKey = { e: en, title: en?.title, base: en?.baseTitle, prompt: en?.lastPrompt, proc: en?.process, todos: en?.todos,
            text: pennantText(en, taskLabel, fitLabel) };
        }
        const text = S.penKey?.text;
        if (!text) continue;
        const at = S.penAt ?? (S.penAt = { x: 0, z: 0, floorY: 0, top: 1, phase: S.phase, vis: true });
        at.x = S.x; at.z = S.z; at.yaw = a.yaw ?? 0; at.floorY = S.floorY; // [FX fix m175-r2] yaw: world-fixed pole side
        at.top = S.bodyTop ?? S.top; at.vis = S.vis; // hidden while the agent is culled / behind the lens
        if (!S.pen || S.pen.text !== text) S.pen = { text, colorIndex: S.plate?.colorIndex ?? a.entity?.workspace?.colorIndex ?? 0, at };
        placards.pennant(S.id, S.pen);
      }
    }
    const tp = performance.now();
    placards?.update(c, placardQ); // blocked boards drop while the owner is at the desk; before labels: board rects
    placardMs += (performance.now() - tp - placardMs) * 0.05;
    labels.draw(vis, F, kindOf); // plates, bubbles, glyphs: one declutter pass [FX fix r2]
    moments.draw(stateList, F, cam); // [FX M3.5] lanterns (+ on-top ghosts), planes; after labels: warm line-of-sight
    sprite.end(); hot.end(); pin.end(); pinHot.end();
    particles.update(F.dt, R, U, F.t);

    frameNo++; // counters re-snapshot on the next read
    fxMs += (performance.now() - t0 - fxMs) * 0.05; // EMA (≈ 20 frames): `__hq.stats().fx.fxMs / placardMs`
  }

  const fx: Fx = {
    ring(id, spec) { calls.ring++; S0(id).ring = spec ?? null; },
    plate(id, spec) { calls.plate++; S0(id).plate = spec ?? null; },
    glyph(id, cls) { calls.glyph++; S0(id).glyph = cls ?? null; },
    dust(id, level) { calls.dust++; S0(id).dust = level ?? 0; },
    bubble(id, spec) { calls.bubble++; S0(id).bubbleSpec = spec ?? null; },
    placard(id, spec) {
      calls.placard++;
      const S = S0(id);
      S.placardSpec = spec;
      S.mug = null;
      placards?.set(id, spec, S.plate?.colorIndex ?? actors?.get(id)?.entity?.workspace?.colorIndex ?? 0);
    },
    burst(kind, pos, opts = {}) {
      calls.burst++;
      if (!pos) return;
      const o = opts;
      if (kind === 'confetti') particles.burst('confetti', pos, { count: o.count ?? 40, floor: pos.y - 0.9 });
      // (the layout has no `ceiling` field: `height` is its ceiling, unused here, so the default always applied)
      else if (kind === 'capsule') particles.burst('capsule', pos, { ceil: o.ceil ?? 2.7 });
      else if (kind === 'dust') particles.burst('dust', pos, { floor: pos.y - 0.9 });
      else if (kind === 'hearts') {
        // [FX fix r1 m2-carry] CHR's pat / comfort hearts come at `pos.y + 0.95` (inside a Clawd's head): re-anchor to the
        // nearest actor's crown via moments (framed, on top, deduped with the bus `verb` burst for the same pat)
        let best: FxState | null = null, bd = 0.36; // 0.6 m in plan, squared
        for (const S of stateList) { const d = (S.x - pos.x) ** 2 + (S.z - pos.z) ** 2; if (d < bd) { bd = d; best = S; } }
        if (best) moments.hearts(best.id);
        else particles.burst('hearts', pos, { count: o.count ?? 7, top: true });
      }
      else particles.burst(kind, pos, o);
    },
    forget(id) {
      calls.forget++;
      const S = states.get(id);
      if (!S) return;
      bubbles.release(S); plates.release(S); flares.release(S); moments.forget(id); placards?.set(id, null); placards?.pennant(id, null); stripMemo.delete(id);
      states.delete(id);
      const k = stateList.indexOf(S); if (k >= 0) stateList.splice(k, 1);
    },
    bindActors(a) { actors = a; },
    update,
    counters,
  };

  if (placards) hqRegister('placardCheck', () => ({ ...placards.check(ctx.camera, renderer?.domElement?.clientHeight || innerHeight), poles: placards.poles() })); // [FX fix m175-r2] + pennant pole bases
  hqStatSection('fxLabels', () => ({ ...labels.stats(), labelOverlaps: labels.overlaps(), queueBodyClearMin: labels.queueBodyClearMin(), rects: labels.rects().map((r) => r.map((x) => Math.round(x))), pairs: labels.overlapPairs() })); // [FX fix r2] declutter debug
  hqStatSection('fxAtlas', () => ({ sprite: atlas.stats(), task: placards?.stats() ?? null }));
  return fx;
}
