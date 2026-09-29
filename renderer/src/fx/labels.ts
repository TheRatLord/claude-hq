/**
 * In-world label pass [FX fix r2] (DESIGN §8 "screen-space collision nudging", ART §8.4): ONE screen-space declutter
 * per frame over every agent label FX draws — blocked alert cards, speech / thought bubbles, nameplates, activity
 * glyphs — with the desk task boards (placards.ts `rects`) as fixed obstacles.
 *  1. prepare: each module readies its tile and on-screen size (bubbles.ts, nameplates.ts, glyphs.ts);
 *  2. rank agents: blocked (queue order: longest wait first) > selected > hovered > nearest (declutter.labelRank);
 *  3. place per agent, in rank order: nameplate at the head, the bubble stacked on the placed plate (or the head), the
 *     glyph likewise; each nudges up / sideways within a limit (declutter.createPlacer) or collapses: a bubble to its
 *     dot, a plate / glyph to nothing (selected / hovered plates are forced; a blocked agent's alert card carries its
 *     name, so its plate may drop). Blocked alerts are pinned:
 *     never hidden, stacked in queue order, clamped inside the visible world strip (roster / drawer insets from the
 *     `viewStrip` bus event); an alert whose agent is fully behind a wall (UI's aim.wallBlocks on the head and body
 *     rays) shows only its "! name  ≥ m:ss" pill [FX fix m2-r2: was a bare "!" dot]. A label whose anchor is off the
 *     strip / view is not drawn, and an alert anchored in the strip's edge band is handed to UI's edge chevron
 *     (`alertEdge`) [FX fix m2-r2];
 *  4. emit far → near: every label is a camera-facing quad placed EXACTLY at its screen rect (screen → world at the
 *     agent's view depth, pulled ≤ 0.25 m toward the lens), plus a thin ink leader line from the head to any label
 *     moved more than LEADER_PX. No per-frame allocation (items live on the actor state, rects in typed arrays).
 * [FX fix r3] Queued Clawds' bodies are protected rects (declutter `body`): labels anchor over the raised hand / hat
 * (fx/index.ts S.top) and climb instead of burying the queue; beyond COMPACT_M only the queue head (or the selected /
 * hovered agent) keeps its full card, the rest show "! name · ≥ m:ss" chips (declutter.alertForm), which is also the
 * fallback when the view strip is narrower than a card. Nameplates draw on the on-top batch like the cards.
 * Owner: FX.
 */
import * as THREE from 'three';
import { createPlacer, labelRank, bubblePriority, alertForm, sortInPlace, anchorInView, alertAtEdge, planView, type AlertForm, type AlertQuery, type PlacedItem } from './declutter.ts';
import { badgeHex, type BubbleTargets, type Bubbles } from './bubbles.ts';
import { bakeOccluders, wallBlocks, type Occluder } from '../ui/aim.ts';
import { CORE, STATUS } from '../../../shared/palette.ts';
import { bakeSlabs, slabBlocks, type Slab } from './occlude.ts'; // [FX fix m2-r3] mezzanine floor slab occluder
import { QV, type QuadBatch } from './quads.ts'; // [FX fix m2-r1] staged quads (no boxed float arguments)
import type { Layout } from '../world/layout/schema.ts';
import type { ScreenRect } from '../core/bus.ts';
import type { Nameplates } from './nameplates.ts';
import type { Glyphs } from './glyphs.ts';
import type { Flares } from './flares.ts';
import type { Particles } from './particles.ts';
import type { Tiles } from './tiles.ts';
import type { Placards, PlacardRect } from './placards.ts';
import type { FxFrame, FxState, UvRect } from './types.ts';

const MAX_FULL = 8; // ART §8.4: at most 8 full bubbles (alerts always)
/** [FX fix r3] Beyond this a queued alert that is not the queue head / selected / hovered collapses to its chip. */
export const COMPACT_M = 6;
/** [FX fix r3] A card needs the strip to be this much wider than itself, else it falls back to the chip / dot. */
const STRIP_SLACK_PX = 16;
/** Protected body width (m): the Clawd body is 0.72 m wide. */
const BODY_W_M = 0.72;
const LEADER_PX = 7;
/** [FX fix r2 m2-carry] Plan / overview '!' pin diameter (px at 900 px tall). */
const PLAN_PIN_PX = 26;
/** [FX fix m2-r1] Serve / close range: within this camera distance of a queued agent, the queue collapses to its head's
 *  card + name · timer pills (4 full cards covered the top half of the view at `serve`). */
export const CLOSE_M = 3;
/** [FX fix m2-r1] Alert tether: a label moved more than this from its agent gets a coral tether + a knob on the agent. */
const TETHER_PX = 14;
const PLATE_GAP_PX = 2;
/** The HUD's top pill row (ui/hud.ts, ≈ 12–40 px): labels stay below it. */
const HUD_TOP_PX = 46;
const INK = new THREE.Color(CORE.ink);
const CORAL = new THREE.Color(STATUS.blocked);
// [FX fix m2-r1] comparators return small integers (a float difference is a boxed heap number outside optimised code)
const cmpNum = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
const byBubblePriority = (a: FxState, b: FxState) => cmpNum(b.bubble?.priority ?? 0, a.bubble?.priority ?? 0) || cmpNum(a.dist, b.dist);
const byRank = (a: FxState, b: FxState) => cmpNum(b.rank, a.rank);
const farToNear = (a: FxState, b: FxState) => cmpNum(b.dist, a.dist);

export interface LabelDeps {
  bubbles: Bubbles;
  plates: Nameplates;
  glyphs: Glyphs;
  flares?: Flares | null;
  particles?: Particles | null;
  tiles: Tiles;
  placards: Placards | null;
  sprite: QuadBatch;
  pin: QuadBatch;
  pinHot: QuadBatch;
  hot: QuadBatch;
  layout?: Layout | null;
}

export function createLabels({ bubbles, plates, glyphs, flares = null, particles = null, tiles, placards, sprite, pin, pinHot, hot, layout = null }: LabelDeps) {
  const placer = createPlacer({ max: 320 });
  const obs: PlacardRect[] = [];
  const v = new THREE.Vector3(), w = new THREE.Vector3(), cam = new THREE.Vector3();
  const uv = { u0: 0, v0: 0, u1: 0, v1: 0 };
  const strip = { left: 0, right: 0 };
  const pBudget = { n: 3 }; // plate tile redraws per frame
  // [UI fix r3] UI screen obstacles (edge chevrons, by key) + the ids whose alert card was placed this frame (the UI
  // suppresses a chevron whose agent's card is already in the strip)
  const uiObs = new Map<string, ScreenRect[]>();
  const alertIds = new Set<string>();
  /** [FX fix m2-r2] blocked agents whose alert FX hands to the UI edge chevron this frame (anchor in the edge band) */
  const edgeIds = new Set<string>();
  // [FX fix m2-r1] UI panels (roster, inbox card, status card, minimap) are hard obstacles; `panelIds` = agents whose
  // question a panel shows; `serve` = the inbox is open
  let panels: ScreenRect[] = [];
  const panelIds = new Set<string>();
  let serve = false;
  const stKeys: string[] = [];
  const RQ = { blocked: false, waitMs: 0, selected: false, hovered: false, dist: 0, queuePos: -1 }; // reused labelRank query
  const BQ = { priority: 0, working: false, dist: 0 }; // reused bubblePriority query
  const AQ: AlertQuery = { head: false, selected: false, hovered: false, dist: 0, cardW: 0, chipW: 0, chipMinW: 0, stripW: 0, compactM: COMPACT_M, slack: STRIP_SLACK_PX, compact: false, onPanel: false, plan: false };
  const AF: AlertForm = { form: 'card', k: 1 };
  const F0 = { vw: 1600 };
  let occ: Occluder[] = [], occLayout: Layout | null = null, slabs: Slab[] = [];
  const st: Record<string, number> = { flares: 0, bubbles: 0, bubblesWalled: 0, dots: 0, chips: 0, plates: 0, platesWalled: 0, glyphs: 0, leaders: 0, obstacles: 0, labelsCut: 0, queueBodies: 0, compact: 0, panelHidden: 0, tethers: 0, edgeHanded: 0, alertsWalled: 0, offView: 0, pills: 0 };
  stKeys.push(...Object.keys(st));
  /** [FX fix r3] protected queued-body rects of the last frame (x0 y0 x1 y1), for the lazy `queueBodyClearMin` stat */
  const bodies = new Float64Array(64 * 4);
  /** [FX fix m175-r2] placed alert card / chip rects of the last frame (x0 y0 x1 y1): a storefront strip under one yields
   *  (placards.ts reads them next frame; the card is pinned, the strip is not) */
  const cards = { n: 0, r: new Float64Array(32 * 4) };

  const rayBlocked = (tx: number, ty: number, tz: number) => {
    const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z, T = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    // [FX fix m2-r3] + the floor slabs: an agent on the other level (under the mezzanine seen from it, or vice versa)
    return wallBlocks(occ, cam.x, cam.y, cam.z, dx / T, dy / T, dz / T, T) || slabBlocks(slabs, cam.x, cam.y, cam.z, tx, ty, tz);
  };
  const bake = () => { if (layout !== occLayout) { occLayout = layout; occ = bakeOccluders(layout); slabs = bakeSlabs(layout); } };
  /** Is S's whole body behind a solid wall span (head and body rays both cut)? Cached ~5 Hz per actor. */
  function walled(S: FxState): boolean {
    if (S.nowT - (S.occT ?? -9) < 0.2) return S.occ;
    S.occT = S.nowT;
    bake();
    S.occ = !!(occ.length || slabs.length) && rayBlocked(S.x, S.top - 0.1, S.z) && rayBlocked(S.x, S.floorY + 0.35, S.z);
    return S.occ;
  }

  /** Screen px (top-left origin) at view depth `dq` → world, into `out` (off-axis projections included). */
  function toWorld(F: FxFrame, px: number, py: number, dq: number, out: THREE.Vector3): THREE.Vector3 {
    out.set((px / F.vw) * 2 - 1, 1 - (py / F.vh) * 2, 0.5).applyMatrix4(F.camera.projectionMatrixInverse);
    out.multiplyScalar(dq / Math.max(1e-6, -out.z)).applyMatrix4(F.camera.matrixWorld);
    return out;
  }

  const item = (S: FxState, key: 'lP' | 'lB' | 'lG' | 'lF'): PlacedItem => S[key] ?? (S[key] = { x: 0.5, y: 0.5, w: 0.5, h: 0.5, dx: 0.5, dy: 0.5, pinned: false, avoidObs: undefined, avoidSigns: undefined, overBodies: false, noDrop: false, maxUp: 0.5, maxSide: 0.5 }); // [FX fix m2-r1] one shape

  /** Leader line from screen (x0, y0) to (x1, y1) at depth dq: ink, ~1.6 px (`px` = full width, `col` / `k` = colour /
   *  alpha gain). */
  function leader(F: FxFrame, batch: QuadBatch, x0: number, y0: number, x1: number, y1: number, dq: number, a: number, px = 1.6, col: THREE.Color = INK, k = 0.6) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy);
    if (L < LEADER_PX) return;
    const wpp = (2 * dq * F.fovK) / F.vh;
    toWorld(F, (x0 + x1) / 2, (y0 + y1) / 2, dq, w);
    const ux = dx / L, uy = dy / L; // screen dir (y down)
    const hl = (L / 2) * wpp, ht = (px / 2) * wpp;
    // along = R·ux − U·uy ; across = R·uy + U·ux
    const ax = (F.R.x * ux - F.U.x * uy) * hl, ay = (F.R.y * ux - F.U.y * uy) * hl, az = (F.R.z * ux - F.U.z * uy) * hl;
    const cx = (F.R.x * uy + F.U.x * ux) * ht, cy = (F.R.y * uy + F.U.y * ux) * ht, cz = (F.R.z * uy + F.U.z * ux) * ht;
    const t = tiles.shape('solid'), u = (t.u0 + t.u1) / 2, vv = (t.v0 + t.v1) / 2;
    (QV[0] = w.x, QV[1] = w.y, QV[2] = w.z, QV[3] = ax, QV[4] = ay, QV[5] = az, QV[6] = cx, QV[7] = cy, QV[8] = cz, QV[9] = u, QV[10] = vv, QV[11] = u, QV[12] = vv, QV[13] = col.r, QV[14] = col.g, QV[15] = col.b, QV[16] = k * a, batch.pushQ());
    st.leaders++;
  }
  /**
   * [FX fix m2-r1] Alert tether: a coral line (ink-edged) from the label's tail tip down to a knob over its agent's head,
   * so a card / pill the declutter moved aside still says whose question it is (lobbyDesk: claude's pill floated 2 m
   * left of its owner with only a faint 1.6 px ink leader).
   */
  function tether(F: FxFrame, batch: QuadBatch, hx: number, hy: number, bx: number, by: number, dq: number, a: number): boolean {
    const dx = bx - hx, dy = by - hy;
    if (dx * dx + dy * dy < TETHER_PX * TETHER_PX) return false;
    const s = F.vh / 900;
    leader(F, batch, hx, hy, bx, by, dq, a, 4.2 * s, INK, 0.55); // soft ink edge
    leader(F, batch, hx, hy, bx, by, dq, a, 2.4 * s, CORAL, 1);
    // knob on the agent end: an ink ring with a coral centre
    const wpp = (2 * dq * F.fovK) / F.vh, t = tiles.shape('knob');
    toWorld(F, hx, hy, dq, w);
    const r0 = 6.5 * s * wpp, r1 = 4.2 * s * wpp;
    (QV[0] = w.x, QV[1] = w.y, QV[2] = w.z, QV[3] = F.R.x * r0, QV[4] = F.R.y * r0, QV[5] = F.R.z * r0, QV[6] = F.U.x * r0, QV[7] = F.U.y * r0, QV[8] = F.U.z * r0, QV[9] = t.u0, QV[10] = t.v0, QV[11] = t.u1, QV[12] = t.v1, QV[13] = INK.r, QV[14] = INK.g, QV[15] = INK.b, QV[16] = 0.8 * a, batch.pushQ());
    (QV[0] = w.x, QV[1] = w.y, QV[2] = w.z, QV[3] = F.R.x * r1, QV[4] = F.R.y * r1, QV[5] = F.R.z * r1, QV[6] = F.U.x * r1, QV[7] = F.U.y * r1, QV[8] = F.U.z * r1, QV[9] = t.u0, QV[10] = t.v0, QV[11] = t.u1, QV[12] = t.v1, QV[13] = CORAL.r, QV[14] = CORAL.g, QV[15] = CORAL.b, QV[16] = a, batch.pushQ());
    st.tethers++;
    return true;
  }

  /** `vis` = visible actor states (their order is mutated), `kindOf` = agent kind (plate tab rule). */
  function draw(vis: FxState[], F: FxFrame, kindOf: (id: string) => string | undefined) {
    F0.vw = F.vw;
    for (let i = 0; i < stKeys.length; i++) st[stKeys[i]] = 0;
    cam.setFromMatrixPosition(F.camera.matrixWorld);
    placer.begin(F.vw, F.vh, strip.left, strip.right, 6, 3, HUD_TOP_PX);
    const nObs = placards ? placards.rects(F.camera, F.vw, F.vh, obs) : 0;
    for (let i = 0; i < nObs; i++) (obs[i].id === 'sign' ? placer.sign : placer.obstacle)(obs[i].x0, obs[i].y0, obs[i].x1, obs[i].y1);
    st.obstacles = nObs;
    for (const rs of uiObs.values()) for (let i = 0; i < rs.length; i++) { const r = rs[i]; placer.obstacle(r[0], r[1], r[2], r[3]); st.obstacles++; } // [UI fix r3]
    for (let i = 0; i < panels.length; i++) { const r = panels[i]; placer.panel(r[0], r[1], r[2], r[3]); st.obstacles++; } // [FX fix m2-r1]
    alertIds.clear(); // [UI fix r3]
    edgeIds.clear();
    cards.n = 0;

    // 1. prepare (bubble tile redraws go to the highest bubble priority first)
    sortInPlace(vis, byBubblePriority);
    bubbles.begin();
    pBudget.n = 3;
    let closeQ = false;
    for (let i = 0; i < vis.length; i++) {
      const S = vis[i];
      S.hasB = bubbles.prepare(S, F);
      S.hasP = plates.prepare(S, F, pBudget, kindOf(S.id));
      S.hasG = glyphs.prepare(S, F);
      S.hasF = !!flares && flares.prepare(S, F, pBudget); // [FX M3.5] struggle flare (shares the plate redraw budget)
      S.lMode = 0; S.pMode = 0; S.gMode = 0; S.fMode = 0; S.lTether = false;
      const blocked = S.status === 'blocked';
      RQ.blocked = blocked; RQ.waitMs = blocked ? F.now - (S.since ?? F.now) : 0; RQ.selected = S.selected; RQ.hovered = S.hovered; RQ.dist = S.dist; RQ.queuePos = S.qPos ?? -1;
      S.rank = labelRank(RQ);
      if (S.hasB && S.bubble) { BQ.priority = S.bubble.priority; BQ.working = S.status === 'working'; BQ.dist = S.dist; S.rank += bubblePriority(BQ) * 0.01; }
      if (blocked && S.hasB && S.bubble?.kind === 'alert' && S.dist < CLOSE_M) closeQ = true;
    }
    // [FX fix m2-r1] serve scope (the inbox is open) or the queue within arm's reach: only the queue head keeps its card
    const compact = serve || closeQ;
    if (compact) st.compact = 1;

    // 2–3. place in rank order
    sortInPlace(vis, byRank);
    // [FX fix r3] the queue's bodies are protected rects (no label may bury a queued Clawd), and the head of the queue
    // (first blocked in rank order = queue order, oldest wait first) keeps its full card at any distance. [FX fix m2-r3]
    // even when a UI panel shows its question (serve pose: the head at the window was a pill and queue #2 took the card
    // over its hat); everyone queued behind it is a pill, placed after it in queue order
    let head: FxState | null = null;
    const ppm = F.vh / (2 * F.fovK); // screen px per metre at view depth 1 m
    for (let i = 0; i < vis.length; i++) {
      const S = vis[i];
      if (S.status !== 'blocked' || !S.hasB || S.bubble?.kind !== 'alert') continue;
      if (!head) head = S;
      if (walled(S) || st.queueBodies >= 64) continue;
      v.set(S.x, S.bodyTop ?? S.top, S.z).project(F.camera);
      if (v.z > 1 || v.z < -1) continue;
      const yT = (-v.y * 0.5 + 0.5) * F.vh, xC = (v.x * 0.5 + 0.5) * F.vw;
      v.set(S.x, S.floorY, S.z).project(F.camera);
      const yB = (-v.y * 0.5 + 0.5) * F.vh, hw = (BODY_W_M / 2) * (ppm / Math.max(0.3, S.depth ?? S.dist));
      if (yB - yT < 2) continue;
      const j = st.queueBodies++ * 4;
      bodies[j] = xC - hw; bodies[j + 1] = yT; bodies[j + 2] = xC + hw; bodies[j + 3] = yB;
      placer.body(bodies[j], bodies[j + 1], bodies[j + 2], bodies[j + 3]);
    }
    const stripW = placer.stripW - 12; // the placer's 6 px margins
    let full = 0;
    for (let i = 0; i < vis.length; i++) {
      const S = vis[i];
      if (!S.hasB && !S.hasP && !S.hasG && !S.hasF) continue;
      v.set(S.x, S.top + 0.06, S.z).project(F.camera);
      if (v.z > 1 || v.z < -1) continue;
      const ax = (v.x * 0.5 + 0.5) * F.vw, ay = (-v.y * 0.5 + 0.5) * F.vh;
      S.ax = ax; S.ay = ay;
      const blocked = S.status === 'blocked';
      // [FX fix m2-r2] an alert anchored in the strip's edge band is merged into its UI edge chevron (a clipped '!' sat
      // under the chevron stack at `street`); any other label whose head is off the strip / above / below the view is
      // not drawn (a 'claude' plate clamped to the bottom edge pointed at nothing from `mezzToPit`)
      if (blocked && S.hasB && S.bubble?.kind === 'alert') {
        S.lEdge = alertAtEdge(ax, ay, strip.left, F.vw - strip.right, F.vh, S.lEdge);
        if (S.lEdge) { edgeIds.add(S.id); st.edgeHanded++; continue; }
        // [FX fix m3-r3, reviewer art] an alert whose agent is on the other level (mezzanine slab) or wholly behind a
        // wall collapses to its UI edge chevron: the walled pill floated over the mezz beanbag with its tether ending
        // on the empty carpet while the agent sat at an E1 desk below (h8-8 / h22-8). Plan view keeps its '!' pin.
        if (walled(S) && !planView(F.F.y, cam.y, S.floorY ?? 0)) { edgeIds.add(S.id); st.edgeHanded++; st.alertsWalled++; continue; }
      } else if (!anchorInView(ax, ay, strip.left, F.vw - strip.right, F.vh)) { st.offView++; continue; }
      // [FX fix m2-r1] the tether's agent end: the crown (hat incl.), not the raised hand the label anchor clears
      if (blocked) { v.set(S.x, (S.bodyTop ?? S.top) + 0.03, S.z).project(F.camera); S.hx = (v.x * 0.5 + 0.5) * F.vw; S.hy = (-v.y * 0.5 + 0.5) * F.vh; }
      let tx = ax, ty = ay; // stack anchor for the next label
      // [FX fix r3] plates draw on the no-depth-test batch (a foreground hat never slices one), so a plate whose agent is
      // wholly behind a wall is not drawn unless it is the selected / hovered one
      if (S.hasP && !S.selected && !S.hovered && walled(S)) { S.hasP = false; st.platesWalled++; }
      // [FX M1.75] speech / thought bubbles draw on the no-depth-test batch too (a mezzanine rail post near the lens cut
      // 'Agent · Check the c…' in half, m15 carryover): so one behind a solid wall is not drawn (selected / hovered are)
      if (S.hasB && S.bubble && S.bubble.kind !== 'alert' && !S.selected && !S.hovered && walled(S)) { S.hasB = false; st.bubblesWalled++; }
      if (S.hasF && !S.selected && !S.hovered && walled(S)) S.hasF = false; // [FX M3.5] like the bubbles
      // [FX fix r3] a queued agent's card / chip carries its name (draw.ts `who`): no plate under it (it pushed the stack
      // a plate higher and doubled every name); [FX fix m2-r1] selected / hovered too (serve: 'pike' plate over its
      // 'pike · ≥ 6:15' pill)
      if (S.hasP && blocked && S.hasB && S.bubble?.kind === 'alert') S.hasP = false;
      if (S.hasP) {
        const P = item(S, 'lP');
        P.x = ax; P.y = ay; P.w = S.pW; P.h = S.pH; P.pinned = false; P.avoidObs = undefined;
        if (panels.length) besidePanels(P);
        P.maxUp = S.pH * 1.6 + 18; P.maxSide = S.pW * 0.6;
        if (!placer.inStrip(ax, P.w)) st.labelsCut++;
        else if (placer.place(P)) S.pMode = 1;
        // a blocked agent's alert card carries its name (draw.ts `who`): a plate with no free spot just drops
        else if ((blocked || S.selected || S.hovered) && !(blocked && S.hasB)) {
          // a plate that must show gets a wider search (with a leader) before it is forced over something
          P.maxUp = S.pH * 3 + 60; P.maxSide = S.pW; P.pinned = true; P.avoidObs = true; // pinned: may also drop a little
          if (!placer.place(P)) {
            placer.force(P);
            // [FX fix m2-r1] never under a UI panel (the roster cut 'willow · review' in half)
            if (underPanel(P)) { placer.pop(); st.panelHidden++; } else S.pMode = 1;
          } else S.pMode = 1;
        }
        if (S.pMode) { tx = ax + P.dx; ty = ay + P.dy - S.pH - PLATE_GAP_PX; }
      }
      const bubble = S.bubble;
      if (S.hasB && bubble) {
        const alert = bubble.kind === 'alert';
        const hidden = alert && walled(S);
        const B = item(S, 'lB');
        // [FX fix r3] alert form: the full card for the queue head / selected / hovered or within COMPACT_M, else the
        // compact "! name · ≥ m:ss" chip; a strip narrower than the card (+ slack) falls back to the chip (shrunk to the
        // strip down to its readable minimum), then to the "!" dot. [FX fix m2-r1] serve / close range: only the head
        // keeps its card; a question a UI panel already shows is a pill
        S.lChip = false;
        let bw = S.bW, bh = S.bH, dotOnly = false, pinOnly = false;
        if (alert) {
          AQ.head = S === head; AQ.selected = S.selected; AQ.hovered = S.hovered; AQ.dist = S.dist; AQ.cardW = S.bW; AQ.chipW = S.cW;
          AQ.chipMinW = S.cMinW; AQ.stripW = stripW; AQ.compact = compact; AQ.onPanel = panelIds.has(S.id);
          AQ.plan = planView(F.F.y, cam.y, S.floorY ?? 0); // [FX fix r2 m2-carry] plan: the '!' pin, text on hover
          const f = alertForm(AQ, AF);
          if (f.form === 'chip') { S.lChip = true; bw = S.cW * f.k; bh = S.cH * f.k; } else if (f.form === 'dot') dotOnly = true;
          pinOnly = AQ.plan && dotOnly;
        }
        B.x = tx; B.y = ty; B.w = bw; B.h = bh; B.pinned = alert; B.overBodies = false; B.noDrop = alert; B.avoidSigns = undefined;
        if (panels.length) besidePanels(B);
        // alerts: 1) clear of the task boards, strips and sign plates within 2.5 heights; 2) [FX M1.75] over the boards /
        // strips / bay signs but still clear of the HELP DESK sign within 2.5 heights, chips also up to 2.2 widths
        // aside (the queue stack sat on the HELP DESK sign from the spawn); 3) climb over anything but the queued
        // bodies, and cover a body only as the last resort before a forced spot. UI panels are never covered.
        B.avoidObs = alert ? true : undefined;
        B.maxUp = alert ? bh * 2.5 : bh * 1.2 + 20; B.maxSide = bw * (alert ? 0.25 : 0.45);
        const card = alert && !hidden && !dotOnly;
        if (!placer.inStrip(tx, B.w)) st.labelsCut++;
        else if (!hidden && !dotOnly && (alert || full < MAX_FULL) && placer.place(B)) { S.lMode = 1; full++; }
        else if (card && ((B.avoidObs = false), (B.avoidSigns = true), (B.maxUp = bh * 2.5), (B.maxSide = bw * (S.lChip ? 2.2 : 0.35)), placer.place(B))) { S.lMode = 1; full++; }
        else if (card && ((B.avoidSigns = false), (B.maxSide = bw * 0.25), placer.place(B))) { S.lMode = 1; full++; }
        // no room to climb: a full card first shrinks to its chip, and only then may drop below / cover a body
        else if (card && !S.lChip && S.cW > 0 && S.cW + STRIP_SLACK_PX <= stripW && ((S.lChip = true), (B.w = S.cW), (B.h = S.cH), placer.place(B))) { S.lMode = 1; full++; }
        else if (card && ((B.noDrop = false), placer.place(B))) { S.lMode = 1; full++; }
        else if (card && ((B.overBodies = true), placer.place(B))) { S.lMode = 1; full++; }
        else if (card) {
          placer.force(B);
          // [FX fix m2-r1] a card forced under a UI panel is cut by it ('Do y…' under the inbox card): the pill if it
          // finds a spot, else nothing (the panel / the edge chevron carries the agent)
          if (!underPanel(B)) { S.lMode = 1; full++; }
          else {
            placer.pop();
            if (!S.lChip && S.cW > 0) { S.lChip = true; B.w = S.cW; B.h = S.cH; B.maxSide = B.w * 2.2; if (placer.place(B)) { S.lMode = 1; full++; } }
            if (!S.lMode) { S.lChip = false; st.panelHidden++; }
          }
        } else if (alert && S.cW > 0 && !pinOnly) {
          // [FX fix m2-r2] a walled alert (or one in a strip too narrow for the chip) is the "! name  ≥ m:ss" pill,
          // shrunk to the strip if it must: never a bare '!' (serve at h22: a nameless '!' among the lamps, 2 blocked
          // agents both 'claude'); its tether still leads to the agent
          const k = Math.max(0.55, Math.min(1, (stripW - STRIP_SLACK_PX) / S.cW));
          S.lChip = true; B.w = S.cW * k; B.h = S.cH * k; B.maxUp = B.h * 2.5; B.maxSide = B.w * 0.6;
          B.avoidObs = true; B.avoidSigns = undefined; B.overBodies = false; B.noDrop = false;
          if (placer.place(B)) S.lMode = 1;
          else if (((B.avoidObs = false), placer.place(B))) S.lMode = 1;
          else if (((B.overBodies = true), placer.place(B))) S.lMode = 1;
          else { placer.force(B); if (underPanel(B)) { placer.pop(); st.panelHidden++; } else S.lMode = 1; }
          if (S.lMode) st.pills++; else S.lChip = false;
        } else {
          S.lChip = false;
          // [FX fix r2 m2-carry] the plan pin is the size of the other plan dots (the alert scale kept it ~36 px at 720p)
          const dotPx = pinOnly ? Math.min(S.bDot, PLAN_PIN_PX * (F.vh / 900)) : S.bDot;
          B.w = B.h = dotPx; B.maxUp = dotPx * 1.5 + 12; B.maxSide = dotPx; B.avoidObs = alert ? true : undefined; B.avoidSigns = undefined; B.overBodies = false;
          if (placer.place(B)) S.lMode = 2;
          else if (alert && ((B.avoidObs = false), placer.place(B))) S.lMode = 2;
          else if (alert && ((B.overBodies = true), placer.place(B))) S.lMode = 2;
          else if (alert) { placer.force(B); if (underPanel(B)) { placer.pop(); st.panelHidden++; } else S.lMode = 2; }
        }
        if (S.lMode) { tx = B.x + B.dx; ty = B.y + B.dy - B.h - PLATE_GAP_PX; if (alert) alertIds.add(S.id); } // [UI fix r3]
        if (alert && S.lMode === 1 && cards.n < 32) { const j = cards.n++ * 4; cards.r[j] = B.x - B.w / 2 + B.dx; cards.r[j + 1] = B.y + B.dy - B.h; cards.r[j + 2] = B.x + B.w / 2 + B.dx; cards.r[j + 3] = B.y + B.dy; }
      }
      // [FX M3.5] struggle flare: stacked over the bubble / plate; a wider search (pinned, clear of the boards) before it
      // gives up, since it is the "what is it stuck on" signal (P1)
      if (S.hasF) {
        const Fi = item(S, 'lF');
        Fi.x = tx; Fi.y = ty; Fi.w = S.fW; Fi.h = S.fH; Fi.pinned = false; Fi.avoidObs = undefined; Fi.avoidSigns = undefined;
        Fi.overBodies = false; Fi.noDrop = false; Fi.maxUp = S.fH * 2 + 16; Fi.maxSide = S.fW * 0.5;
        if (panels.length) besidePanels(Fi);
        if (!placer.inStrip(tx, Fi.w)) st.labelsCut++;
        else if (placer.place(Fi)) S.fMode = 1;
        else if (((Fi.pinned = true), (Fi.avoidObs = true), (Fi.noDrop = true), (Fi.maxUp = S.fH * 4 + 60), (Fi.maxSide = S.fW), placer.place(Fi))) S.fMode = 1;
        if (S.fMode) { tx = Fi.x + Fi.dx; ty = Fi.y + Fi.dy - Fi.h - PLATE_GAP_PX; }
      }
      if (S.hasG) {
        const G = item(S, 'lG');
        G.x = tx; G.y = ty; G.w = G.h = S.gPx; G.pinned = false; G.maxUp = S.gPx; G.maxSide = S.gPx;
        if (placer.inStrip(tx, G.w) && placer.place(G)) S.gMode = 1;
      }
    }
    // [BRN fix r3, cross-owner] the O(n²) overlap count runs only when stats are read (`overlaps()`), not every frame

    // 4. emit far → near (nearer labels over farther ones in the same batch); [FX fix m2-r1] every leader / tether
    // first, so the paper labels cover the lines (a tether no longer runs across another agent's card)
    sortInPlace(vis, farToNear);
    for (let i = 0; i < vis.length; i++) {
      const S = vis[i];
      if (!S.pMode && !S.lMode && !S.fMode) continue;
      const dq = Math.max(0.3, (S.depth ?? S.dist) - Math.min(0.25, S.dist * 0.1));
      if (S.pMode && S.lP) { const P = S.lP, x0 = P.x - P.w / 2 + P.dx; leader(F, pin, S.ax, S.ay, Math.min(Math.max(S.ax, x0 + 8), x0 + P.w - 8), P.y + P.dy, dq, S.pA); }
      if (S.fMode && !S.lMode && !S.pMode && S.lF) { const Fi = S.lF, x0 = Fi.x - Fi.w / 2 + Fi.dx; leader(F, pin, S.ax, S.ay, Math.min(Math.max(S.ax, x0 + 8), x0 + Fi.w - 8), Fi.y + Fi.dy, dq, S.fA); }
      if (S.lMode && S.lB && S.bubble) {
        const B = S.lB, bx = B.x + B.dx, by = B.y + B.dy; // bottom centre (the tail tip for full bubbles)
        // leader from the plate top / head to the tail tip when the bubble had to move; an alert gets the coral tether
        // + knob instead (whose question is whose, at a glance)
        const fromX = S.pMode && S.lP ? S.lP.x + S.lP.dx : S.ax, fromY = S.pMode && S.lP ? S.lP.y + S.lP.dy - S.pH : S.ay;
        if (!(S.bubble.kind === 'alert' && S.status === 'blocked' && (S.lTether = tether(F, pin, S.hx, S.hy, bx, by - (S.lMode === 2 ? B.h * 0.2 : 0), dq, S.bA)))) leader(F, pin, fromX, fromY, bx, by, dq, S.bA);
      }
    }
    for (let i = 0; i < vis.length; i++) {
      const S = vis[i];
      if (!S.pMode && !S.lMode && !S.gMode && !S.fMode) continue;
      const dq = Math.max(0.3, (S.depth ?? S.dist) - Math.min(0.25, S.dist * 0.1));
      const wpp = (2 * dq * F.fovK) / F.vh;
      if (S.fMode && S.lF) {
        // [FX M3.5] the flare floats ±1.5 px and spits two sparks from its disc every ~0.6 s
        const Fi = S.lF, x0 = Fi.x - Fi.w / 2 + Fi.dx, y1 = Fi.y + Fi.dy + Math.sin(S.nowT * 2.6 + S.phase) * 1.5;
        toWorld(F, x0 + Fi.w / 2, y1 - Fi.h / 2, dq, w);
        flares?.uv(S, uv);
        const hw = (Fi.w / 2) * wpp, hh = (Fi.h / 2) * wpp;
        (QV[0] = w.x, QV[1] = w.y, QV[2] = w.z, QV[3] = F.R.x * hw, QV[4] = F.R.y * hw, QV[5] = F.R.z * hw, QV[6] = F.U.x * hh, QV[7] = F.U.y * hh, QV[8] = F.U.z * hh, QV[9] = uv.u0, QV[10] = uv.v0, QV[11] = uv.u1, QV[12] = uv.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.fA, pin.pushQ());
        st.flares++;
        S.fAcc = (S.fAcc ?? 0) + F.dt;
        if (particles && S.fAcc > 0.6 && S.dist < 20) { S.fAcc = 0; toWorld(F, x0 + Fi.h * 0.5, y1 - Fi.h / 2, dq, w); particles.burst('sparks', w, sparkOpt); }
      }
      if (S.pMode && S.lP) {
        const P = S.lP, x0 = P.x - P.w / 2 + P.dx, y1 = P.y + P.dy;
        toWorld(F, x0 + P.w / 2, y1 - P.h / 2, dq, w);
        plates.uv(S, uv);
        const hw = (P.w / 2) * wpp, hh = (P.h / 2) * wpp;
        (QV[0] = w.x, QV[1] = w.y, QV[2] = w.z, QV[3] = F.R.x * hw, QV[4] = F.R.y * hw, QV[5] = F.R.z * hw, QV[6] = F.U.x * hh, QV[7] = F.U.y * hh, QV[8] = F.U.z * hh, QV[9] = uv.u0, QV[10] = uv.v0, QV[11] = uv.u1, QV[12] = uv.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.pA, pin.pushQ());
        st.plates++;
      }
      if (S.lMode && S.lB && S.bubble) {
        const B = S.lB, alert = S.bubble.kind === 'alert';
        const bx = B.x + B.dx, by = B.y + B.dy; // bottom centre (the tail tip for full bubbles)
        const card = pin; // [FX M1.75] every bubble on the on-top batch (see the walled check above)
        if (S.lMode === 1) {
          const k = S.bK;
          toWorld(F, bx, by - (B.h * k) / 2, dq, w);
          const hw = (B.w / 2) * wpp * k, hh = (B.h / 2) * wpp * k;
          bubbles.emitFull(S, F, toPin, w.x, w.y, w.z, hw, hh, S.lChip);
          S.bubbleTopY = w.y + hh; S.bubbleTopX = w.x; S.bubbleTopZ = w.z; // the rain cloud floats on the card (ambient.ts, next frame)
          S.bubbleTopPx = B.h; // [FX fix m2-r1] its on-screen height: ambient.ts sizes the cloud to it
          if (S.lChip) st.chips++; else st.bubbles++;
        } else {
          const tl = tiles.dot(alert ? '!' : S.bubble.icon ?? 'dots', badgeHex(S.bubble, S.status)); // [FX fix m175-r1] alerts collapse to the '!' badge
          toWorld(F, bx, by - B.h / 2, dq, w);
          const hh = (B.h / 2) * wpp * S.bK;
          (QV[0] = w.x, QV[1] = w.y, QV[2] = w.z, QV[3] = F.R.x * hh, QV[4] = F.R.y * hh, QV[5] = F.R.z * hh, QV[6] = F.U.x * hh, QV[7] = F.U.y * hh, QV[8] = F.U.z * hh, QV[9] = tl.u0, QV[10] = tl.v0, QV[11] = tl.u1, QV[12] = tl.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.bA, card.pushQ());
          S.bubbleTopY = w.y + hh; S.bubbleTopX = w.x; S.bubbleTopZ = w.z; S.bubbleTopPx = B.h;
          st.dots++;
        }
      }
      if (S.gMode && S.lG) {
        const G = S.lG;
        toWorld(F, G.x + G.dx, G.y + G.dy - G.h / 2, dq, w);
        glyphs.emit(S, F, sprite, w.x, w.y, w.z, (G.h / 2) * wpp);
        st.glyphs++;
      }
    }
  }
  /**
   * [FX fix m2-r1] An anchor under a UI panel starts beside it instead (the nearer side that stays in the view strip,
   * else just below it), so the label's search begins next to the panel rather than climbing / dropping away from it
   * (the serve pill fell to the counter under the inbox card). The tether still leads back to the agent.
   */
  function besidePanels(it: PlacedItem) {
    const L = strip.left + 6, Rt = F0.vw - strip.right - 6;
    for (let k = 0; k < 3; k++) { // a shifted anchor may land under a neighbouring panel: a few rounds
      let moved = false;
      for (let i = 0; i < panels.length; i++) {
        const r = panels[i], hw = it.w / 2 + 4;
        if (it.x < r[0] - hw || it.x > r[2] + hw || it.y - it.h > r[3] + 3 || it.y < r[1] - 3) continue;
        const left = r[0] - hw, right = r[2] + hw;
        const okL = left - it.w / 2 >= L, okR = right + it.w / 2 <= Rt;
        if (okL && (!okR || it.x - left <= right - it.x)) it.x = left;
        else if (okR) it.x = right;
        else it.y = r[3] + it.h + 4;
        moved = true;
      }
      if (!moved) break;
    }
  }
  /** [FX fix m2-r1] Is placed item `it` (its rect after dx / dy) mostly under a UI panel? */
  const underPanel = (it: PlacedItem) => placer.underPanel(it.x - it.w / 2 + it.dx, it.y - it.h + it.dy, it.x + it.w / 2 + it.dx, it.y + it.dy);
  const sparkOpt = { count: 2 };
  const toPin: BubbleTargets = { card: pin, badge: pinHot, get badgeTile() { return tiles.shape('badge'); } };

  return {
    draw,
    /** Visible world strip insets (CSS px), from the UI's `viewStrip` bus event. */
    setStrip(s: { left?: number; right?: number } | null | undefined) { strip.left = Math.max(0, s?.left ?? 0); strip.right = Math.max(0, s?.right ?? 0); },
    /** [UI fix r3] Fixed screen obstacles from the UI ('ui.obstacles' {key, rects:[[x0,y0,x1,y1]], ids?, serve?}, CSS px). */
    setUiObstacles(key: string, rects: ScreenRect[] | null | undefined, meta: { ids?: string[]; serve?: boolean } | null = null) {
      // [FX fix m2-r1] the 'panels' key (status card, minimap, roster, inbox card) are hard obstacles; its `ids` / `serve`
      // say which questions a panel shows and whether the inbox is open
      if (key === 'panels') {
        panels = Array.isArray(rects) ? rects : [];
        panelIds.clear();
        for (const id of meta?.ids ?? []) panelIds.add(id);
        serve = !!meta?.serve;
        return;
      }
      if (rects?.length) uiObs.set(key, rects); else uiObs.delete(key);
    },
    /** [UI fix r3] Was this agent's alert card (full or dot) placed in the strip last frame? */
    alertShown: (id: string) => alertIds.has(id),
    /** [FX fix m2-r2] Did FX hand this agent's alert to its edge chevron last frame (anchor in the strip's edge band)? */
    alertEdge: (id: string) => edgeIds.has(id),
    /** [FX fix m175-r2] Alert card rects of the last frame ({n, r: x0 y0 x1 y1 …}, reused) and the view-strip insets. */
    cardRects: () => cards,
    /** [FX M3.5] Is the segment camera (last label pass) → (x, y, z) cut by a solid wall span or a floor slab? */
    los: (x: number, y: number, z: number) => { bake(); return !!(occ.length || slabs.length) && rayBlocked(x, y, z); },
    strip: () => strip,
    stats: () => ({ ...st }),
    /** Debug: overlapping label pairs of the last frame (O(n²); stats readers only). [BRN fix r3, cross-owner] */
    overlaps: () => placer.overlaps(),
    /**
     * [FX fix r3] Worst uncovered fraction (0..1) over the queued bodies of the last frame (1 = none queued): the
     * "≥ 50% of every queued body unoccluded by labels" acceptance. Computed on read, not per frame.
     */
    queueBodyClearMin: () => {
      let m = 1;
      for (let j = 0; j < st.queueBodies; j++) m = Math.min(m, placer.clearFrac(bodies[j * 4], bodies[j * 4 + 1], bodies[j * 4 + 2], bodies[j * 4 + 3]));
      return m;
    },
    /** Debug: the placer's rects of the last frame [[x0, y0, x1, y1, obstacle], …]. */
    rects: () => Array.from({ length: placer.count }, (_, i) => placer.rect(i)),
    /** Debug: overlapping rect index pairs of the last frame. */
    overlapPairs: () => placer.overlapPairs(),
  };
}

export type Labels = ReturnType<typeof createLabels>;
