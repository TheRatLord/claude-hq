import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { PlaceItem, AlertForm } from './declutter.ts';
import type { Atlas } from './atlas.ts';
import type { BurstKind, BurstOpts } from './particles.ts';
import type { MomentState } from './moments.ts';
import type { Vec3Like } from './types.ts';
import type { Entity, Todo } from '../../../shared/protocol.ts';

const todo = (content: string, status: Todo['status']): Todo => ({ content, status, activeForm: '' });

/** A fake quad batch counting its `pushQ` calls (`reset`: `begin` zeroes the count, like a real frame). */
const batch = (reset: boolean) => {
  let n = 0;
  return { get n() { return n; }, begin() { if (reset) n = 0; }, end() {}, pushQ() { n++; return true; } };
};

/** The 17 floats of one staged quad (see quads.ts QV). */
type Q17 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
import type { Layout } from '../world/layout/schema.ts';
import { createPlacer, bubblePriority, labelRank, alertForm, sortInPlace } from './declutter.ts';
import { ringStyle, plateAlpha, glyphAlpha, bubbleAlpha, ambientOf, placardLayout, RAIN_AFTER_MS } from './rules.ts';
import { clip, toolTitle } from './draw.ts';
import { createParticles, MAX_PARTICLES } from './particles.ts';

const It = (x: number, y: number, w = 120, h = 40, o: Partial<PlaceItem> = {}): PlaceItem & { dx: number; dy: number } => ({ x, y, w, h, dx: 0, dy: 0, ...o });
const rectOf = (it: { x: number; y: number; w: number; h: number; dx: number; dy: number }) => [it.x - it.w / 2 + it.dx, it.y - it.h + it.dy, it.x + it.w / 2 + it.dx, it.y + it.dy] as const;
const hit = (a: readonly number[], b: readonly number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

test('[FX fix r2] placer: first come keeps its spot, later labels nudge up / aside or fail, never overlap', () => {
  const p = createPlacer();
  p.begin(1600, 900);
  const a = It(800, 400), b = It(820, 410, 120, 40, { maxUp: 60 }), c = It(800, 400, 120, 40, { maxUp: 10, maxSide: 10 });
  assert.ok(p.place(a)); assert.equal(a.dx, 0); assert.equal(a.dy, 0);
  assert.ok(p.place(b), 'b finds a spot');
  assert.ok(!hit(rectOf(a), rectOf(b)), 'no overlap');
  assert.ok(b.dy < 0 || b.dx !== 0);
  assert.equal(p.place(c), false, 'c has no spot within its limits (caller collapses it)');
  assert.equal(p.overlaps(), 0);
});

test('[FX fix r2] placer: a nameplate stack (crowd at the Pit) resolves to 0 overlapping rects', () => {
  const p = createPlacer();
  p.begin(1600, 900);
  // 6 plates whose anchors sit within a few px of each other (sofa loungers seen from pitOverview)
  const items = [[900, 490], [930, 500], [880, 508], [1010, 505], [760, 470], [790, 466]].map(([x, y]) => It(x, y, 150, 26, { maxUp: 26 * 1.6 + 18, maxSide: 90 }));
  const placed = items.filter((it) => p.place(it));
  assert.ok(placed.length >= 5, `most plates stay (${placed.length})`);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!hit(rectOf(placed[i]), rectOf(placed[j])), `${i}/${j}`);
  assert.equal(p.overlaps(), 0);
});

test('[FX fix r2] placer: board obstacles push labels off; pinned alerts ignore them', () => {
  const p = createPlacer();
  p.begin(1600, 900);
  p.obstacle(760, 330, 860, 370); // a task board right above the head
  const plate = It(810, 372, 130, 24, { maxUp: 24 * 1.6 + 18 });
  assert.ok(p.place(plate));
  assert.ok(!hit(rectOf(plate), [760, 330, 860, 370]), 'plate clear of the board');
  const alert = It(810, 372, 220, 60, { pinned: true });
  assert.ok(p.place(alert));
  assert.ok(!hit(rectOf(alert), rectOf(plate)));
  assert.ok(p.overlaps() <= 1, 'only the alert may sit on the board (it outranks it)');
});

test('[FX fix r2] placer: queued alerts stack in order inside the strip, none cut by the screen edge', () => {
  const p = createPlacer();
  const left = 300; // roster open
  p.begin(1366, 768, left, 0);
  // three blocked agents at the Help Desk, anchors a few px apart, the last one half off the strip's left edge
  const al = [It(330, 300, 230, 56, { pinned: true }), It(320, 305, 230, 56, { pinned: true }), It(290, 310, 230, 56, { pinned: true })];
  for (const a of al) assert.ok(p.place(a));
  for (const a of al) { const r = rectOf(a); assert.ok(r[0] >= left + 6 - 0.01 && r[2] <= 1366 - 6 + 0.01, `in strip ${r}`); assert.ok(r[1] >= 6 - 0.01); }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!hit(rectOf(al[i]), rectOf(al[j])));
  assert.ok(rectOf(al[0])[3] > rectOf(al[1])[3] && rectOf(al[1])[3] > rectOf(al[2])[3], 'queue order: first alert lowest, the next ones stack above');
  assert.ok(p.inStrip(310, 230) && !p.inStrip(100, 230), 'an anchor far off the strip is not drawn (edge chevrons own it)');
  // at the top of the screen alerts drop below instead of leaving the viewport
  const q = createPlacer(); q.begin(1366, 768);
  const top = [It(600, 50, 230, 56, { pinned: true }), It(610, 52, 230, 56, { pinned: true })];
  for (const a of top) assert.ok(q.place(a));
  assert.ok(!hit(rectOf(top[0]), rectOf(top[1])) && rectOf(top[1])[1] >= 6 - 0.01);
});

test('[FX fix r2] labelRank: blocked (longest wait first) > selected > hovered > nearest', () => {
  const b1 = labelRank({ blocked: true, waitMs: 90_000, dist: 20 }), b2 = labelRank({ blocked: true, waitMs: 5_000, dist: 2 });
  const sel = labelRank({ selected: true, dist: 9 }), hov = labelRank({ hovered: true, dist: 9 });
  const near = labelRank({ dist: 2 }), far = labelRank({ dist: 8 });
  assert.ok(b1 > b2 && b2 > sel && sel > hov && hov > near && near > far);
});

test('[FX fix r2] plateTab drops the default / repeated tab suffix', async () => {
  const { plateTab } = await import('./rules.ts');
  assert.equal(plateTab('claude', 'claude', 'claude'), '');
  assert.equal(plateTab('pebble', 'claude', 'claude'), '');
  assert.equal(plateTab('tinker', 'Codex', 'codex'), '');
  assert.equal(plateTab('umber', 'agents', 'claude'), 'agents');
  assert.equal(plateTab('review', 'review', 'claude'), '');
  assert.equal(plateTab('x', '', 'claude'), '');
});

test('bubblePriority: blocked > selected > hovered > nearest working', () => {
  const blocked = bubblePriority({ priority: 3, dist: 30 });
  const sel = bubblePriority({ priority: 1, selected: true, dist: 2 });
  const hov = bubblePriority({ priority: 1, hovered: true, dist: 2 });
  const near = bubblePriority({ priority: 1, working: true, dist: 2 });
  const far = bubblePriority({ priority: 1, working: true, dist: 9 });
  assert.ok(blocked > sel && sel > hov && hov > near && near > far);
});

test('ringStyle follows the §6.7 chroma budget', () => {
  const b = ringStyle({ status: 'blocked' }, { dist: 40 });
  assert.ok(b);
  assert.equal(b.shape, 'ring8'); assert.ok(b.hot && b.pulse);
  const d = ringStyle({ status: 'done' }, { dist: 40 });
  assert.ok(d);
  assert.equal(d.shape, 'ring6'); assert.equal(d.hot, false); assert.equal(d.breathe, 0.3);
  assert.equal(ringStyle({ status: 'done' }, { dist: 2, acked: true }), null);
  assert.ok(ringStyle({ status: 'done' }, { dist: 2, acked: true, selected: true }));
  const w = ringStyle({ status: 'working' }, { dist: 3 });
  assert.ok(w);
  assert.equal(w.shape, 'ring2'); assert.equal(w.alpha, 0.35); assert.equal(w.hot, false);
  assert.equal(ringStyle({ status: 'working' }, { dist: 8 }), null);
  assert.ok(ringStyle({ status: 'working' }, { dist: 8, hovered: true }));
  assert.equal(ringStyle({ status: 'idle' }, { dist: 1 }), null);
  assert.equal(ringStyle({ status: 'idle' }, { dist: 1, hovered: true })?.alpha, 0.5);
  assert.equal(ringStyle(null, { dist: 1 }), null);
});

test('plate / glyph / bubble distance rules', () => {
  assert.equal(plateAlpha({ dist: 3 }), 1);
  assert.equal(plateAlpha({ dist: 10 }), 0);
  assert.equal(plateAlpha({ dist: 20, blocked: true }), 1);
  assert.ok(plateAlpha({ dist: 7.5 }) > 0 && plateAlpha({ dist: 7.5 }) < 1);
  assert.equal(glyphAlpha({ dist: 5 }), 0);
  assert.equal(glyphAlpha({ dist: 12 }), 1);
  assert.equal(glyphAlpha({ dist: 12, blocked: true }), 0);
  assert.equal(bubbleAlpha({ dist: 30, kind: 'alert' }), 1);
  assert.equal(bubbleAlpha({ dist: 30, kind: 'speech' }), 0);
});

test('ambientOf: rain only for blocked > 5 min, orbit for struggle ≥ 2 while working', () => {
  const now = 1e9;
  assert.equal(ambientOf({ status: 'blocked', statusSince: now - RAIN_AFTER_MS + 1000 }, null, now).rain, false);
  assert.equal(ambientOf({ status: 'blocked', statusSince: now - RAIN_AFTER_MS - 1000 }, null, now).rain, true);
  assert.equal(ambientOf({ status: 'working', statusSince: now - 1e8, struggle: { level: 3 } }, null, now).rain, false);
  assert.equal(ambientOf({ status: 'working', struggle: { level: 1 } }, null, now).orbit, 0);
  assert.equal(ambientOf({ status: 'working', struggle: { level: 2 } }, null, now).orbit, 3);
  assert.equal(ambientOf({ status: 'idle', struggle: { level: 3 } }, null, now).orbit, 0);
  assert.equal(ambientOf({ status: 'idle' }, { face: 'sleepy' }, now).zzz, true);
});

test('placardLayout: one line when it fits, balanced two-line wrap otherwise', () => {
  const measure = (s: string, px: number) => s.length * px * 0.55;
  const one = placardLayout(measure, 'Fix login', { maxW: 480, fontPx: 75 });
  assert.deepEqual(one.lines, ['Fix login']); assert.equal(one.fontPx, 75);
  const two = placardLayout(measure, 'Tune nginx cache headers', { maxW: 480, fontPx: 75 });
  assert.equal(two.lines.length, 2); assert.equal(two.lines.join(' '), 'Tune nginx cache headers');
  assert.ok(two.fontPx >= 60, `cap kept near nominal: ${two.fontPx}`);
  const tent = placardLayout(measure, 'last: Tune nginx cache headers', { maxW: 480, fontPx: 46, lines: 1 });
  assert.equal(tent.lines.length, 1);
});

test('clip / toolTitle', () => {
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(clip('  a   b ', 10), 'a b');
  assert.equal(toolTitle('mcp__playwright__browser_click'), 'playwright · browser click');
  assert.equal(toolTitle('Read'), 'Read');
});

test('particle pool: bursts, caps at MAX_PARTICLES, dies out, no hot leak into plain', () => {
  const mk = () => { let n = 0; return { begin() { n = 0; }, push() { n++; return true; }, pushQ() { n++; return true; }, end() {}, get n() { return n; } }; };
  const hot = mk(), plain = mk();
  const tile = { u0: 0, v0: 0, u1: 1, v1: 1, w: 32, h: 32 };
  const p = createParticles({ hot, plain, tile: () => tile });
  const R = new THREE.Vector3(1, 0, 0), U = new THREE.Vector3(0, 1, 0);
  p.burst('confetti', { x: 0, y: 1, z: 0 }, { count: 40 });
  p.burst('smoke', { x: 0, y: 1, z: 0 });
  p.update(0.016, R, U, 0);
  assert.equal(hot.n, 40); assert.equal(plain.n, 9);
  for (let i = 0; i < 100; i++) p.burst('confetti', { x: 0, y: 1, z: 0 }, { count: 40 });
  assert.equal(p.stats().live, MAX_PARTICLES);
  assert.ok(p.stats().dropped > 0);
  for (let i = 0; i < 400; i++) p.update(0.02, R, U, i * 0.02);
  assert.equal(p.stats().live, 0);
  // capsule rises to the ceiling and ends in a poof
  const before = p.stats().spawned;
  p.burst('capsule', { x: 0, y: 0.9, z: 0 }, { ceil: 2.7 });
  for (let i = 0; i < 100; i++) p.update(0.02, R, U, i * 0.02);
  assert.ok(p.stats().spawned - before >= 1 + 3 + 6, 'capsule + trail puffs + ceiling poof');
});

test('[FX fix r1] placard atlas: 36 boards churned 10× between board and tent never fail and never fill', async () => {
  const { createPacker } = await import('./atlas.ts');
  const { PLACARD_SLOT } = await import('./rules.ts');
  const BOARD_T = [404, 136], TENT_T = [404, 124]; // placards.ts BOARD.tile / TENT.tile (sub-rects of PLACARD_SLOT)
  const p = createPacker(2048);
  assert.ok(p.alloc(80, 8), 'swatch strip');
  const slots = Array.from({ length: 36 }, () => p.alloc(...PLACARD_SLOT));
  assert.ok(slots.every(Boolean), 'initial 36');
  for (const t of [BOARD_T, TENT_T]) assert.ok(t[0] <= PLACARD_SLOT[0] && t[1] <= PLACARD_SLOT[1], 'dims fit the slot');
  const fill0 = p.stats().fillY;
  for (let r = 0; r < 10; r++) {
    // churn: every board releases and re-allocates (agents leave / arrive, labels change), plus 4 newcomers per round
    for (let i = 0; i < slots.length; i++) { p.release(slots[i]); slots[i] = p.alloc(...PLACARD_SLOT); assert.ok(slots[i], `round ${r} board ${i}`); }
    const extra = Array.from({ length: 4 }, () => p.alloc(...PLACARD_SLOT));
    assert.ok(extra.every(Boolean));
    extra.forEach((t) => p.release(t));
  }
  const st = p.stats();
  assert.ok(st.fillY < 1, `fill ${st.fillY}`);
  assert.ok(st.fillY <= fill0 + 0.08, `churn does not grow the atlas: ${fill0} → ${st.fillY}`);
  // capacity: MAX_BOARDS (64) placards fit
  const more = Array.from({ length: 64 - 36 }, () => p.alloc(...PLACARD_SLOT));
  assert.ok(more.every(Boolean), '64 boards fit');
});

test('[FX fix r1] packer: mixed-size churn reuses freed slots across sizes instead of returning null', async () => {
  const { createPacker } = await import('./atlas.ts');
  const p = createPacker(2048);
  // the M1.75 failure: two tile sizes churning (512×172 board ↔ 512×158 tent) until the shelves run out
  let tiles = Array.from({ length: 30 }, (_, i) => p.alloc(512, i % 2 ? 172 : 158));
  for (let r = 0; r < 10; r++) {
    tiles = tiles.map((t, i) => { p.release(t); return p.alloc(512, (i + r) % 2 ? 158 : 172); });
    assert.ok(tiles.every(Boolean), `round ${r}`);
  }
  assert.ok(p.stats().fillY < 1);
  const full = createPacker(64);
  assert.ok(full.alloc(40, 40));
  assert.equal(full.alloc(40, 40), null, 'truly full → null (callers skip, never throw)');
});

test('[FX fix r1] placardLowTarget: near / blocked / edge-on drop to the near card, with hysteresis', async () => {
  const { placardLowTarget, PLACARD_NEAR_M } = await import('./rules.ts');
  assert.equal(placardLowTarget(2.5, 0), 1);
  assert.equal(placardLowTarget(PLACARD_NEAR_M + 0.2, 1), 1, 'hysteresis keeps it low');
  assert.equal(placardLowTarget(PLACARD_NEAR_M + 0.2, 0), 0);
  assert.equal(placardLowTarget(8, 1), 0);
  assert.equal(placardLowTarget(8, 0, true), 1, 'blocked always low');
  assert.equal(placardLowTarget(8, 0, false, 0.2), 1, 'edge-on drops');
  assert.equal(placardLowTarget(8, 1, false, 0.35), 1, 'facing hysteresis');
  assert.equal(placardLowTarget(8, 1, false, 0.9), 0);
});

test('[FX fix r2] near card: never overlaps the face from any focus() desk camera, never meets the monitor', async () => {
  const { deskBoardAnchor, boardPoseOf, lowSideTarget } = await import('./placards.ts');
  const { DESK, deskLocal } = await import('../world/layout/proto.ts');
  const { BODY_D } = await import('../chars/render/geometry.ts');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
  const v = new THREE.Vector3();
  const rect = (pts: THREE.Vector3[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { v.copy(p).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    return [x0, y0, x1, y1];
  };
  // proto rows 0 / 1 (agent 0.35 / 0.1 m toward the aisle) and the hq bay desk (m 1, row 1), at several yaws
  const desks = [
    { m: 1, row: 0, yaw: 0 }, { m: -1, row: 0, yaw: Math.PI }, { m: 1, row: 1, yaw: Math.PI / 2 }, { m: 1, row: 1, yaw: -Math.PI / 2 }, { m: -1, row: 1, yaw: 0.4 },
  ];
  let shots = 0;
  for (const dk of desks) {
    const f = { id: 'd', type: 'desk', pos: { x: 3, y: 0, z: -2 }, ...dk };
    const A = deskBoardAnchor({ furniture: [f] } as unknown as Layout, 'd'); // (a one-desk layout: the anchor reads only furniture)
    assert.ok(A);
    const { agentX, monitor } = deskLocal(f);
    const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const W = (lx: number, y: number, lz: number) => new THREE.Vector3(f.pos.x + lx * cs + lz * sn, y, f.pos.z - lx * sn + lz * cs);
    // seated Clawd: slot 0.57 m in front of the desk centre (proto.ts / hq.ts: d/2 + 0.36 − sitForward), face plate on
    // the body front; everything above the desk top can show (0.95 m covers the head + wobble), full body width
    const slotZ = DESK.d / 2 + 0.36 - DESK.sitForward, faceZ = slotZ - BODY_D / 2;
    const face: THREE.Vector3[] = [];
    for (const x of [-0.34, 0.34]) for (const y of [DESK.h, 0.95]) face.push(W(agentX + x, y, faceZ));
    const slot = W(agentX, 0, slotZ), faceC = W(agentX, 0.75, faceZ);
    for (const k of [1.1, 1.3, 1.5, 1.75, 2, 2.4]) for (const deg of [0, 15, -15, 25, -25, 35, -35, 45, -45]) {
      // core/debug.ts createFocusShot desk mode: camera at the agent's facing ± deg, 1.5·k m, eye 1.2 m, aimed at the face
      const faceYaw = f.yaw; // the agent faces the monitor (desk-local −z; forward = (−sin, −cos) of its yaw)
      const ang = faceYaw + (deg * Math.PI) / 180, r = 1.5 * k;
      cam.position.set(slot.x - Math.sin(ang) * r, 1.2, slot.z - Math.cos(ang) * r);
      cam.lookAt(faceC.x, 0.57, faceC.z); cam.updateMatrixWorld();
      const side = lowSideTarget(A, cam.position.x, cam.position.z, 1);
      assert.equal(side, 0, 'a camera facing the agent gets the far-side stand');
      const P = boardPoseOf(A, 1, side);
      const card: THREE.Vector3[] = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) card.push(new THREE.Vector3(P.x + P.rx * P.hw * sx + P.ux * P.hh * sy, P.y + P.uy * P.hh * sy, P.z + P.rz * P.hw * sx + P.uz * P.hh * sy));
      const a = rect(card), b = rect(face);
      assert.ok(!(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]), `card over the face: desk ${JSON.stringify(dk)} ${deg}° ${r.toFixed(2)} m`);
      shots++;
    }
    // no depth intersection with the monitor: in desk-local x the card and the (twisted) screen never share a span
    const P = boardPoseOf(A, 1, 0);
    const lx = (P.x - f.pos.x) * cs - (P.z - f.pos.z) * sn; // world → desk-local x
    const cardX = [lx - P.hw, lx + P.hw].map((x) => x * f.m).sort((p, q) => p - q);
    const monX = [monitor.x - monitor.w / 2 - 0.03, monitor.x + monitor.w / 2 + 0.03].map((x) => x * (f.m ?? 1)).sort((p, q) => p - q);
    assert.ok(cardX[0] > monX[1] || cardX[1] < monX[0], `card ${cardX} vs monitor ${monX}`);
    assert.ok(Math.abs(lx) + P.hw <= DESK.w / 2 + 0.005, 'card on the desk top');
  }
  assert.equal(shots, desks.length * 54);
});

test('[FX fix r3] placer: a far queue (head card + chips) leaves every queued body ≥ 50% clear of labels', () => {
  // the `queue` scenario seen from the spawn (1600×900, ≈ 9 m): four Clawds shoulder to shoulder behind the Help Desk,
  // bodies ≈ 58 × 60 px, raised hands ≈ 25 px over the crowns. Head of the queue: full card; the rest: chips.
  const p = createPlacer();
  p.begin(1600, 900, 0, 0, 6, 3, 46);
  const q = ([[340, 430], [400, 425], [460, 432], [520, 428]] as const).map(([x, top]) => ({ x, top, body: [x - 29, top, x + 29, top + 60] as const }));
  for (const b of q) p.body(b.body[0], b.body[1], b.body[2], b.body[3]);
  const forms = q.map((b, i) => alertForm({ head: i === 0, dist: 9, cardW: 390, chipW: 170, chipMinW: 140, stripW: 1588 }));
  assert.deepEqual(forms.map((f) => f.form), ['card', 'chip', 'chip', 'chip']);
  q.forEach((b, i) => {
    const it = It(b.x, b.top - 25, i ? 170 : 390, i ? 38 : 88, { pinned: true, avoidObs: true, maxUp: (i ? 38 : 88) * 2.5 });
    if (!p.place(it)) { it.avoidObs = false; assert.ok(p.place(it), `alert ${i} found a spot over the bodies`); }
    assert.ok(rectOf(it)[1] >= 46 - 0.01, 'below the HUD pill row');
  });
  for (const b of q) assert.ok(p.clearFrac(b.body[0], b.body[1], b.body[2], b.body[3]) >= 0.5, `body clear ${p.clearFrac(b.body[0], b.body[1], b.body[2], b.body[3]).toFixed(2)}`);
  assert.equal(p.overlaps(), 0);
});

test('[FX fix r3] placer: protected bodies block a pinned alert\'s drop-below until the last resort', () => {
  const p = createPlacer();
  p.begin(1600, 900, 0, 0, 6, 3, 46);
  p.body(770, 120, 830, 200); // a queued Clawd right under the top of the strip
  const top = It(800, 60, 300, 80, { pinned: true }); // pinned under the HUD row: no climb left
  assert.ok(p.place(top));
  const next = It(800, 60, 300, 80, { pinned: true });
  assert.ok(p.place(next), 'finds a spot (sideways or below the body, never on it)');
  assert.ok(!hit(rectOf(next), [770, 120, 830, 200]), 'the body stays clear');
  const last = It(800, 60, 1580, 700, { pinned: true, overBodies: true });
  assert.equal(p.place(last), false, 'no room at all → the caller forces it');
  assert.equal(p.overlaps(), 0, 'bodies never count as label overlaps');
});

test('[FX fix r3] alertForm: far non-head alerts compact; a strip narrower than the card falls back to chip / dot', () => {
  const o = { dist: 9, cardW: 390, chipW: 180, chipMinW: 150, stripW: 1588 };
  assert.equal(alertForm({ ...o, head: true }).form, 'card');
  assert.equal(alertForm({ ...o, selected: true }).form, 'card');
  assert.equal(alertForm({ ...o, hovered: true }).form, 'card');
  assert.equal(alertForm(o).form, 'chip');
  assert.equal(alertForm({ ...o, dist: 4 }).form, 'card', 'near: full card');
  // rail + 80% drawer at 1366: the world strip is ≈ 228 px → never a card that the rail / drawer would cut
  const narrow = alertForm({ ...o, head: true, stripW: 228 - 12 });
  assert.equal(narrow.form, 'chip'); assert.equal(narrow.k, 1);
  const tight = alertForm({ ...o, head: true, stripW: 176 });
  assert.equal(tight.form, 'chip'); assert.ok(tight.k < 1 && 180 * tight.k + 16 <= 176 + 1e-9, 'chip shrunk to the strip');
  assert.equal(alertForm({ ...o, head: true, stripW: 120 }).form, 'dot');
  assert.equal(alertForm({ ...o, dist: 3, stripW: 410 }).form, 'card', 'a card that fits stays');
  assert.equal(alertForm({ ...o, dist: 3, stripW: 400 }).form, 'chip', 'card + 16 px slack must fit');
});

test('[FX M1.75] placards: distance growth keeps every hq desk board clear of its coplanar row neighbours', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { deskBoardAnchor, grownExtent, farScale, boardPoseOf, BOARD } = await import('./placards.ts');
  assert.equal(farScale(4, 8.6, 2), 1);
  assert.ok(Math.abs(farScale(12.9, 8.6, 2) - 1.5) < 1e-9);
  assert.equal(farScale(40, 8.6, 2), 2);
  const desks = layout.furniture.filter((f) => f.type === 'desk');
  assert.ok(desks.length >= 30);
  const A = desks.map((f) => deskBoardAnchor(layout, f.id)).filter((a) => a !== null);
  assert.equal(A.length, desks.length, 'every desk has a board anchor');
  const rects = A.map((a) => {
    const g = grownExtent(BOARD.farMax, a.lim);
    assert.ok(g.s >= 1.6, `board ${a.x.toFixed(2)},${a.z.toFixed(2)} can still grow to ≥ 1.6 (got ${g.s.toFixed(2)})`);
    const P = boardPoseOf(a, 0, 0, undefined, g.s, g.ox);
    // plan interval along the right axis + the height span + plane key
    const along0 = (P.x - P.rx * P.hw) * P.rx + (P.z - P.rz * P.hw) * P.rz, along1 = along0 + 2 * P.hw;
    return { yaw: a.yaw, n: P.x * P.nx + P.z * P.nz, a0: along0, a1: along1, y0: P.y - P.hh, y1: P.y + P.hh };
  });
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const p = rects[i], q = rects[j];
    if (Math.cos(p.yaw - q.yaw) < 0.99 || Math.abs(p.n - q.n) > 0.35) continue;
    const overlapX = p.a0 < q.a1 - 1e-6 && q.a0 < p.a1 - 1e-6, overlapY = p.y0 < q.y1 && q.y0 < p.y1;
    assert.ok(!(overlapX && overlapY), `coplanar boards ${i}/${j} overlap when grown`);
  }
  // the back-to-back partner (opposite yaw, 0.4 m away) stays staggered at full growth: the raised board clears the low one
  const hi = A.find((a) => a.stag > 0), lo = A.find((a) => a.stag === 0);
  assert.ok(hi && lo);
  const Ph = boardPoseOf(hi, 0, 0, undefined, 2, 0), Pl = boardPoseOf(lo, 0, 0, undefined, 2, 0);
  assert.ok(Ph.y - Ph.hh >= Pl.y + Pl.hh - 1e-6, 'stagger grows with the board');
});

test('[FX M1.75] placardLowTarget: muted boards stand tall beyond PLACARD_MUTED_M; blocked-at-desk still drops', async () => {
  const { placardLowTarget, PLACARD_MUTED_M, PLACARD_NEAR_M } = await import('./rules.ts');
  assert.equal(placardLowTarget(PLACARD_NEAR_M + 1, 1, false, 1, true), 1, 'muted: near card within 6 m');
  assert.equal(placardLowTarget(PLACARD_MUTED_M + 1, 1, false, 1, true), 0, 'muted: tall board from afar');
  assert.equal(placardLowTarget(PLACARD_MUTED_M + 0.2, 1, false, 1, true), 1, 'muted: hysteresis');
  assert.equal(placardLowTarget(12, 0, true, 1, false), 1, 'blocked at the desk: the hand owns the air');
});

test('[FX M1.75] storefront strip spots + sign obstacles follow the hq bays (E2 / E3 also on the atrium side)', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { stripSpots, signQuads } = await import('./placards.ts');
  const sp = stripSpots(layout);
  const by = (id: string) => sp.filter((s) => s.bay === id).length;
  assert.equal(by('E2'), 2); assert.equal(by('E3'), 2); assert.equal(by('E1'), 1); assert.equal(by('W1'), 1);
  for (const s of sp) assert.ok(s.y > 1.9 && s.y < 2.6 && s.w > 1, 'hangs under a sign');
  const sq = signQuads(layout);
  assert.equal(sq.filter((q) => q.hard).length, 1, 'one hard sign: HELP DESK');
  assert.equal(sq.length, sp.length + 1);
});

test('[FX M1.75] placer: a pinned alert keeps clear of a sign plate but may cover a board', () => {
  const p = createPlacer();
  p.begin(1600, 900, 0, 0, 6, 3, 46);
  p.sign(500, 190, 700, 240); // HELP DESK sign, just above the card's spot
  p.obstacle(520, 250, 680, 320); // a bay strip right above the queue
  const card = It(600, 330, 260, 60, { pinned: true, avoidObs: false, avoidSigns: true, maxUp: 150, maxSide: 60 });
  assert.ok(p.place(card));
  assert.ok(!hit(rectOf(card), [500, 190, 700, 240]), 'clear of the sign');
  assert.equal(p.overlaps(), 1, 'only the card over the (soft) strip counts');
});

test('[FX M1.75] placer: diagonal spots (up and aside) when straight up and straight aside are both taken', () => {
  const p = createPlacer();
  p.begin(1600, 900, 0, 0, 6, 3, 46);
  p.sign(500, 200, 700, 280);
  p.body(0, 285, 399, 345); p.body(801, 285, 1600, 345);
  const block = It(600, 340, 400, 60, { pinned: true, avoidObs: false, avoidSigns: false });
  p.force(block);
  const chip = It(600, 330, 150, 34, { pinned: true, avoidObs: false, avoidSigns: true, maxUp: 100, maxSide: 300 });
  assert.ok(p.place(chip), 'chip placed');
  assert.ok(chip.dx !== 0 && chip.dy < 0, `diagonal move (${chip.dx}, ${chip.dy})`);
  const c = rectOf(chip);
  assert.ok(!hit(c, [500, 200, 700, 280]) && !hit(c, rectOf(block)), 'clear of sign and block');
});

test('[FX fix m175-r1] a pinned alert card on its 2nd try (avoidSigns) keeps clear of a Big Board / bay plate sign rect', () => {
  const p = createPlacer();
  p.begin(1600, 900);
  p.sign(440, 200, 790, 300); // the Big Board's projected box
  p.obstacle(600, 300, 700, 330); // a strip (ignored on the 2nd try)
  const card = It(700, 320, 380, 64, { pinned: true, avoidObs: false, avoidSigns: true, maxUp: 64 * 2.5, maxSide: 380 * 0.35, noDrop: true });
  assert.ok(p.place(card));
  assert.ok(!hit(rectOf(card), [440, 200, 790, 300]), `card ${rectOf(card)} clear of the Big Board`);
});

test('[FX fix m175-r2] Pit pennant poles step along the ring off the floor lamps (seated agent at the lamp bearings)', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { dressObstacles } = await import('../world/build/dress.ts');
  const { createPoleSpots, pitPoleSpot, PENNANT, POLE } = await import('./placards.ts');
  const obs = dressObstacles(layout);
  const spots = createPoleSpots(layout, obs);
  const c = layout.points.pitCenter;
  const lamps = obs.filter((o) => o.id.startsWith('lamp:floor') && Math.hypot(o.x - c.x, o.z - c.z) < 3.5);
  assert.ok(lamps.length >= 2, 'the two Pit floor lamps are static obstacles');
  const out = { x: 0, z: 0 };
  let speared = 0;
  for (const L of lamps) {
    const lampDeg = Math.atan2(L.z - c.z, L.x - c.x);
    // the unstepped pole of a seat 0.6 m back along the ring lands right on the lamp (the crowd40 case); and deg 90 itself
    for (const r of [2.3, 2.5, 2.6]) for (const back of [PENNANT.pitSide / Math.max(PENNANT.pitPoleR, r + PENNANT.pitBehind), 0]) {
      const a = lampDeg - back, ax = c.x + Math.cos(a) * r, az = c.z + Math.sin(a) * r;
      assert.ok(pitPoleSpot(ax, az, c, spots, out), 'a free spot exists');
      if (back) { pitPoleSpot(ax, az, c, null, out); if (Math.hypot(out.x - L.x, out.z - L.z) < L.r + POLE.pad) speared++; pitPoleSpot(ax, az, c, spots, out); }
      for (const o of obs) assert.ok(Math.hypot(out.x - o.x, out.z - o.z) >= o.r + POLE.pad - 1e-6, `pole ${out.x.toFixed(2)},${out.z.toFixed(2)} clear of ${o.id}`);
      const R = Math.hypot(out.x - c.x, out.z - c.z);
      assert.ok(R >= PENNANT.pitPoleR - 1e-6, 'still on the tread behind the sofa backs');
      // nearest free spot: at most a few ring steps from the unstepped one
      const a0 = Math.atan2(az - c.z, ax - c.x) + PENNANT.pitSide / R, ux = c.x + Math.cos(a0) * R, uz = c.z + Math.sin(a0) * R;
      assert.ok(Math.hypot(out.x - ux, out.z - uz) <= 3 * POLE.ringStep + 0.05, 'stepped to the nearest free spot');
    }
  }
  assert.ok(speared >= 2, `the unstepped pole spears a lamp in these cases (${speared})`);
});

test('[FX fix m175-r2] off-Pit pennant poles: world-fixed side from the agent yaw, never through glass / walls / desks', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { createPoleSpots, sidePoleSpot, POLE_CANDS, PENNANT } = await import('./placards.ts');
  const spots = createPoleSpots(layout, []);
  const out = { x: 0, z: 0 };
  // open atrium floor: the agent's own right, whatever the camera does
  const P = layout.points.pitCenter;
  const ax = P.x, az = P.z + 6.2, yaw = 0.7;
  const i = sidePoleSpot(ax, az, yaw, 0, spots, -1, out);
  assert.equal(i, 0, 'right side first');
  assert.ok(Math.abs((out.x - ax) * Math.cos(yaw) - (out.z - az) * Math.sin(yaw) - PENNANT.side) < 1e-6, 'on the agent\'s right');
  // every desk seat in the bays: the chosen base never crosses a wall from the agent and never sits in solid furniture
  let n = 0, hats = 0;
  for (const f of layout.furniture.filter((q) => q.type === 'desk')) {
    for (const yawD of [f.yaw, f.yaw + Math.PI / 2, f.yaw + Math.PI, f.yaw - Math.PI / 2]) {
      const sx = f.pos.x + Math.sin(f.yaw) * 0.75, sz = f.pos.z + Math.cos(f.yaw) * 0.75; // chair side
      const k = sidePoleSpot(sx, sz, yawD, f.level ?? 0, spots, -1, out);
      n++;
      if (k === POLE_CANDS.length) { hats++; continue; }
      assert.ok(spots.free(out.x, out.z, f.level ?? 0, 0.15, sx, sz), 'the pick is free');
      assert.ok(Math.hypot(out.x - f.pos.x, out.z - f.pos.z) > 0.2, 'not in the desk');
    }
  }
  assert.ok(n > 20 && hats < n / 2, `mostly a side pole (${hats}/${n} hat flags)`);
  // the real desk seats (umber done at an E2 desk put the old camera-relative pole in the E2 front glass mullion): a
  // side pole, free with the dressing props too, whatever the camera does
  const { dressObstacles } = await import('../world/build/dress.ts');
  const spotsAll = createPoleSpots(layout, dressObstacles(layout));
  for (const sl of layout.slots.filter((q) => q.tag === 'desk')) {
    const k = sidePoleSpot(sl.pos.x, sl.pos.z, sl.yaw, sl.level ?? 0, spotsAll, -1, out);
    assert.ok(k < POLE_CANDS.length && spotsAll.free(out.x, out.z, sl.level ?? 0, 0.15, sl.pos.x, sl.pos.z), `${sl.id}: a free side pole`);
  }
  // right against a glass wall facing along it: the pole never ends up across the glass
  const w = layout.walls.find((q) => q.kind === 'glass');
  assert.ok(w);
  const mx = (w.a[0] + w.b[0]) / 2, mz = (w.a[1] + w.b[1]) / 2, ux = w.b[0] - w.a[0], uz = w.b[1] - w.a[1], L = Math.hypot(ux, uz);
  const nx = -uz / L, nz = ux / L; // wall normal
  for (const side of [1, -1]) {
    const px = mx + nx * 0.3 * side, pz = mz + nz * 0.3 * side;
    for (let y = 0; y < 8; y++) {
      const k = sidePoleSpot(px, pz, (y / 8) * Math.PI * 2, w.level ?? 0, spots, -1, out);
      if (k === POLE_CANDS.length) continue;
      const s0 = (px - mx) * nx + (pz - mz) * nz, s1 = (out.x - mx) * nx + (out.z - mz) * nz;
      assert.ok(Math.sign(s0) === Math.sign(s1) && Math.abs(s1) > 0.2, 'same side of the glass, clear of it');
    }
  }
});

test('[FX fix m175-r2] a strip past 15% outside the view strip shrinks, then hides; alert cards push strips away', async () => {
  const { EDGE, outsideFrac, stripEdgeLevel } = await import('./placards.ts');
  assert.ok(EDGE.cut === 0.15 && EDGE.back < EDGE.cut, 'hysteresis');
  // pitOverview h13: E3's strip at x -60..260 (1600 wide, no insets) → 19% out
  const f = outsideFrac(-60, 200, 260, 330, 0, 1600, 900);
  assert.ok(Math.abs(f - 60 / 320) < 1e-9);
  assert.equal(stripEdgeLevel(f, () => 0.05, 0), 1, 'shrinks to nominal when that fits');
  assert.equal(stripEdgeLevel(f, () => 0.3, 0), 2, 'hidden when even the nominal strip is cut');
  assert.equal(stripEdgeLevel(0.1, () => 0.1, 0), 0, 'a sliver past the edge is fine');
  assert.equal(stripEdgeLevel(0.1, () => 0.1, 2), 2, 'hidden stays hidden until below EDGE.back');
  assert.equal(stripEdgeLevel(0.05, () => 0.05, 2), 0);
  // the drawer inset counts as the edge
  assert.ok(outsideFrac(1200, 100, 1500, 200, 0, 1600 - 420, 900) > 0.9);
});

test('[FX fix m2-r1] alertForm: serve / close range keeps only the head card; a question on a UI panel is a pill', () => {
  const base = { dist: 2, cardW: 300, chipW: 120, chipMinW: 90, stripW: 1600 };
  const out: AlertForm = { form: 'dot', k: 0 };
  // before: every queued alert within COMPACT_M was a full card
  assert.equal(alertForm({ ...base }).form, 'card');
  // compact (serve scope / queue within 3 m): only the head keeps its card, selected / hovered included
  assert.equal(alertForm({ ...base, compact: true, head: true }, out).form, 'card');
  assert.equal(alertForm({ ...base, compact: true, selected: true, hovered: true }, out).form, 'chip');
  assert.equal(out.form, 'chip', 'writes into `out` (no allocation)');
  assert.equal(alertForm({ ...base, compact: true }, out), out);
  // on a panel (status card / inbox shows it): the pill, except for the queue head [FX fix m2-r3]
  assert.equal(alertForm({ ...base, onPanel: true }).form, 'chip');
  assert.equal(alertForm({ ...base, selected: true, onPanel: true }).form, 'chip');
  assert.equal(alertForm({ ...base, head: true, onPanel: true }).form, 'card');
  assert.equal(alertForm({ ...base, head: true, onPanel: true, compact: true }).form, 'card', 'serve: the head at the window keeps its card');
});

test('[FX fix m2-r1] placer: UI panels are hard obstacles (pinned alerts included); underPanel / pop for forced rects', () => {
  const P = createPlacer();
  P.begin(1600, 900);
  P.panel(600, 50, 1000, 450); // the inbox card
  // a pinned alert anchored under the panel may not climb / sit under it
  const it = It(800, 400, 200, 40, { pinned: true, avoidObs: false });
  assert.ok(P.place(it));
  const x0 = it.x - it.w / 2 + it.dx, y0 = it.y - it.h + it.dy;
  assert.ok(!(x0 < 1000 && x0 + it.w > 600 && y0 < 450 && y0 + it.h > 50), `not under the panel: ${x0},${y0}`);
  assert.equal(P.overlaps(), 0);
  // a forced rect under it is detectable, and can be dropped again
  const f = It(800, 300, 200, 40);
  P.force(f);
  assert.ok(P.underPanel(f.x - 100 + f.dx, f.y - 40 + f.dy, f.x + 100 + f.dx, f.y + f.dy));
  const n = P.count;
  P.pop();
  assert.equal(P.count, n - 1);
  assert.equal(P.overlaps(), 0);
  // panels never count as labels, nor are they popped
  P.begin(1600, 900); P.panel(0, 0, 10, 10); P.pop(); assert.equal(P.count, 1);
});

test('[FX fix m2-r1] sortInPlace: stable, in place, same order as Array.prototype.sort', () => {
  const a = Array.from({ length: 60 }, (_, i) => ({ i, d: (i * 37) % 11 }));
  const want = a.slice().sort((p, q) => p.d - q.d).map((x) => x.i);
  assert.equal(sortInPlace(a, (p, q) => p.d - q.d), a);
  assert.deepEqual(a.map((x) => x.i), want);
});

test('[FX fix m2-r1] quad batch: staged pushQ writes exactly what push writes', async () => {
  const { createQuadBatch, QV, stage } = await import('./quads.ts');
  const A = createQuadBatch(new THREE.MeshBasicMaterial(), 4), B = createQuadBatch(new THREE.MeshBasicMaterial(), 4);
  const args: Q17 = [1.5, 2.25, -3, 0.1, 0.2, 0.3, -0.4, 0.5, 0.6, 0.11, 0.22, 0.33, 0.44, 0.9, 0.8, 0.7, 0.5];
  A.begin(); A.push(...args);
  B.begin(); stage(...args); B.pushQ();
  assert.equal(QV.length, 17);
  for (const k of ['position', 'uv', 'color']) assert.deepEqual(Array.from(B.mesh.geometry.getAttribute(k).array.slice(0, 16)), Array.from(A.mesh.geometry.getAttribute(k).array.slice(0, 16)), k);
  assert.equal(B.count, 1);
});

test('[FX fix m2-r1] per-frame rules reuse their results (ringStyle shared styles, ambientOf into `out`)', () => {
  assert.equal(ringStyle({ status: 'blocked' }, { dist: 3 }), ringStyle({ status: 'blocked' }, { dist: 9 }));
  const out = { rain: true, orbit: 3, zzz: true, steam: true };
  assert.equal(ambientOf({ status: 'working', statusSince: 0 }, null, 1000, out), out);
  assert.deepEqual(out, { rain: false, orbit: 0, zzz: false, steam: false });
  assert.equal(ambientOf(null, null, 0, out), out);
});

test('[FX fix m2-r1] tiles: hot lookups return the cached tile without re-keying', async () => {
  const { createTiles } = await import('./tiles.ts');
  let allocs = 0;
  const atlas = { alloc: (w: number, h: number) => ({ x: allocs++ * 8, y: 0, w, h, u0: 0, v0: 0, u1: 1, v1: 1, sizeKey: `${w}x${h}` }), draw() {} };
  const t = createTiles(atlas as unknown as Atlas, () => true); // (createTiles only calls alloc / draw)
  const a = t.shape('solid'), b = t.shape('solid');
  assert.equal(a, b);
  assert.equal(t.dot('!', '#fff'), t.dot('!', '#fff'));
  assert.notEqual(t.dot('!', '#fff'), t.dot('!', '#000'));
  assert.equal(allocs, 3);
});

test('[FX fix m2-r2] edge hand-off: an alert in the strip edge band is the chevron\'s (with hysteresis); off-view plates drop', async () => {
  const { alertAtEdge, anchorInView, EDGE_BAND_PX } = await import('./declutter.ts');
  // 1600 × 900, no insets: mixed h18 street, the '!' at x 1572 sat under the chevron stack
  assert.equal(alertAtEdge(1580, 365, 0, 1600, 900), true);
  assert.equal(alertAtEdge(800, 365, 0, 1600, 900), false);
  // hysteresis: just inside the band comes back only after band / 2 more
  assert.equal(alertAtEdge(1600 - EDGE_BAND_PX - 4, 365, 0, 1600, 900, true), true);
  assert.equal(alertAtEdge(1600 - EDGE_BAND_PX - 4, 365, 0, 1600, 900, false), false);
  // roster inset on the left: the band moves with the strip
  assert.equal(alertAtEdge(330, 300, 320, 1600, 900), true);
  // below the bottom band / above the top
  assert.equal(alertAtEdge(800, 880, 0, 1600, 900), true);
  assert.equal(alertAtEdge(800, -20, 0, 1600, 900), true);
  // longIdle mezzToPit: the arcade agent's head projects below the view: its plate is not drawn (was clamped to 770,880)
  assert.equal(anchorInView(770, 960, 0, 1600, 900), false);
  assert.equal(anchorInView(770, 500, 0, 1600, 900), true);
  assert.equal(anchorInView(-10, 500, 0, 1600, 900), false);
  assert.equal(anchorInView(300, 500, 320, 1600, 900), false); // under the roster
});

test('[FX fix m2-r2] display names keep the board twin suffix; the tab / timer never reuse " · "', async () => {
  const { clipName, whoLine } = await import('./draw.ts');
  assert.equal(clipName('dev · 2', 16), 'dev · 2');
  assert.equal(clipName('reviewer-agent-alpha · 2', 16), 'reviewer-ag… · 2');
  assert.ok(clipName('reviewer-agent-alpha · 2', 16).length <= 16);
  assert.equal(clipName('tinker', 16), 'tinker');
  assert.equal(whoLine('claude · 2', '≥ 0:24'), 'claude · 2  ≥ 0:24');
  assert.equal(whoLine('', '≥ 0:24'), '≥ 0:24');
  const { boardNames } = await import('../world/stats/format.ts');
  const m = boardNames([{ id: 's1', name: 'dev' }, { id: 's2', name: 'dev' }, { id: 'a1', name: 'tinker' }]);
  assert.deepEqual([m.get('s1'), m.get('s2'), m.get('a1')], ['dev', 'dev · 2', 'tinker']);
});

test('[FX fix m2-r3] labelRank: queued agents rank by queue slot (0 = the window) above other blocked, whatever the wait', () => {
  const head = labelRank({ blocked: true, waitMs: 20_000, dist: 2, queuePos: 0 });
  const second = labelRank({ blocked: true, waitMs: 90_000, dist: 1, queuePos: 1 });
  const walking = labelRank({ blocked: true, waitMs: 300_000, dist: 1 });
  assert.ok(head > second && second > walking);
  assert.ok(walking > labelRank({ selected: true, hovered: true, dist: 0 }));
});

test('[FX fix m2-r3] slab occluder: the mezzanine floor hides labels of agents on the other level only', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { bakeSlabs, slabBlocks } = await import('./occlude.ts');
  const slabs = bakeSlabs(layout);
  assert.equal(slabs.length, 1);
  const mezzCam = [6, 4.5, -10.5] as const; // pose `mezz` eye
  assert.equal(slabBlocks(slabs, ...mezzCam, 0, 1.4, -10), true, 'library agent under the mezzanine, seen from it');
  assert.equal(slabBlocks(slabs, ...mezzCam, 0, 1.4, 0), false, 'Pit agent seen over the rail');
  assert.equal(slabBlocks(slabs, ...mezzCam, 3, 4.3, -11), false, 'agent on the mezzanine itself');
  assert.equal(slabBlocks(slabs, 0, 1.6, 5, 0, 4.3, -10), false, 'mezzanine agent seen from the atrium');
  assert.equal(slabBlocks(slabs, 0, 1.6, -10, 3, 4.3, -11), true, 'mezzanine agent seen from under it');
  assert.deepEqual(bakeSlabs(null), []);
  const pub = bakeSlabs({ slabs: [{ y: 3, rects: [[0, 0, 2, 2]] }] });
  assert.equal(slabBlocks(pub, 1, 5, 1, 1, 1, 1), true);
  assert.equal(slabBlocks(pub, 5, 5, 5, 5, 1, 5), false);
});

test('[FX M3.5] lanternOrder: blocked ≥ 60 s only, longest waiter first, capped, answered skipped', async () => {
  const { lanternOrder, LANTERN_AFTER_MS, LANTERN_MAX } = await import('./moments.ts');
  const now = 1e7;
  const S = (id: string, status: string, waitS: number) => ({ id, status, since: now - waitS * 1000 });
  const list = [S('a', 'blocked', 61), S('b', 'blocked', 300), S('c', 'blocked', 59), S('d', 'working', 900), S('e', 'blocked', 120)];
  assert.equal(LANTERN_AFTER_MS, 60_000);
  assert.deepEqual(lanternOrder(list, now), ['b', 'e', 'a']);
  assert.deepEqual(lanternOrder(list, now, { skip: new Set(['e']) }), ['b', 'a']);
  const many = Array.from({ length: 10 }, (_, i) => S(`q${i}`, 'blocked', 100 + i));
  const got = lanternOrder(many, now);
  assert.equal(got.length, LANTERN_MAX);
  assert.equal(got[0], 'q9');
});

test('[FX M3.5] flareText: detail first, reason fallback, clipped, nothing below level 2', async () => {
  const { flareText } = await import('./flares.ts');
  assert.equal(flareText(null), null);
  assert.equal(flareText({ level: 1, reason: 'fails' }), null);
  assert.equal(flareText({ level: 2, reason: 'fails', detail: '3 test fails in a row' }), '3 test fails in a row');
  assert.equal(flareText({ level: 3, reason: 'errors' }), 'errors keep coming');
  assert.equal(flareText({ level: 2, reason: 'context', detail: '  ' }), 'context nearly full');
  const long = flareText({ level: 2, reason: 'fails', detail: 'x'.repeat(80) });
  assert.ok(long && long.length <= 30);
});

test('[FX M3.5] moments: one burst per answered / inbox.zero / verb event, lantern pops, no extra batches', async () => {
  const { createMoments } = await import('./moments.ts');
  const { createBus } = await import('../core/bus.ts');
  const { layout } = await import('../world/layout/hq.ts');
  const bus = createBus();
  const bursts: [BurstKind, Vec3Like, number | undefined][] = [];
  const particles = { burst: (k: BurstKind, p: Vec3Like, o?: BurstOpts) => { bursts.push([k, { ...p }, o?.count]); } };
  const quads = batch(false);
  const pin = batch(false);
  const tiles = { shape: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) };
  const now = 1e7;
  const st = new Map<string, MomentState & { y: number }>([['a', { id: 'a', status: 'blocked', since: now - 90_000, x: -4.4, z: 6.5, y: 0, floorY: 0, top: 1.1, vis: true, phase: 0 }]]);
  const actorsM = new Map([['a', { pos: { x: -4.4, y: 0, z: 6.5 } }]]);
  const m = createMoments({ tiles, sprite: quads, pin, particles, layout, bus, los: () => false, stateOf: (id) => st.get(id), actorOf: (id) => actorsM.get(id) });
  const THREE = await import('three');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
  cam.position.set(0, 1.2, 12.5); cam.lookAt(-4.4, 2, 6.5); cam.updateMatrixWorld();
  const R = new THREE.Vector3(), U = new THREE.Vector3(), Fw = new THREE.Vector3();
  cam.matrixWorld.extractBasis(R, U, Fw); Fw.negate();
  const F = { t: 0, dt: 1 / 60, now, R, U, F: Fw, fovK: Math.tan(Math.PI / 6), vw: 1600, vh: 900, camera: cam };
  const events: string[] = [];
  bus.on('fx.lantern', (e) => events.push(e.ev));
  for (let i = 0; i < 240; i++) { F.t = i / 60; m.draw([...st.values()], F, cam.position); }
  assert.equal(m.stats().lanterns, 1, 'the 90 s waiter has a lantern');
  assert.deepEqual(events, ['rise']);
  assert.ok(quads.n > 0);
  const n0 = bursts.length;
  bus.emit('answered', { id: 'a' });
  assert.equal(m.stats().mAnswered, 1);
  assert.equal(m.stats().lanternPops, 1);
  assert.ok(bursts.slice(n0).some((b) => b[0] === 'confetti'));
  F.t += 0.1; m.draw([...st.values()], F, cam.position);
  assert.equal(m.stats().lanterns, 0, 'answered: no lantern while the status catches up');
  bus.emit('inbox.zero', { answered: 3, ms: 1000 });
  assert.equal(m.stats().mInboxZero, 1);
  bus.emit('verb', { verb: 'pat', id: 'a' });
  bus.emit('verb', { verb: 'prompt', id: 'a' });
  assert.equal(m.stats().mVerb, 2);
  assert.ok(bursts.some((b) => b[0] === 'hearts'));
  for (let i = 0; i < 90; i++) { F.t += 1 / 60; m.draw([...st.values()], F, cam.position); }
  assert.equal(m.stats().planes, 0, 'the plane landed within ~0.8 s');
  bus.emit('crate.unwrap', { id: 'c1', pos: { x: 0, y: 0, z: 0 } });
  assert.equal(m.stats().mCrate, 1);
  assert.equal(pin.n, 0, 'nothing hid the lantern: no ghost');
});

test('[FX M3.5] particle pool: hearts stream in (staggered), stay in the plain batch', () => {
  const hot = batch(false), plain = batch(false);
  const tile = () => ({ u0: 0, v0: 0, u1: 1, v1: 1, w: 64, h: 64 });
  const p = createParticles({ hot, plain, tile });
  p.burst('hearts', { x: 0, y: 1, z: 0 }, { count: 5 });
  const R = new THREE.Vector3(1, 0, 0), U = new THREE.Vector3(0, 1, 0);
  p.update(0.02, R, U, 0);
  const first = plain.n;
  for (let i = 0; i < 20; i++) p.update(0.02, R, U, i * 0.02);
  assert.ok(first < 5, 'staggered');
  assert.equal(hot.n, 0);
  for (let i = 0; i < 200; i++) p.update(0.02, R, U, i * 0.02);
  assert.equal(p.stats().live, 0);
});

test('[FX fix r1 m2-carry] pennantText: task → last todo → "done ✓", never the workspace label / project', async () => {
  const { pennantText, PENNANT_DONE_TEXT } = await import('./rules.ts');
  const { taskLabel, fitLabel } = await import('../../../shared/task.ts');
  const pt = (e: Partial<Entity> | null) => pennantText(e, taskLabel, fitLabel);
  // (a partial fixture: only the fields the label rules read)
  const base = { kind: 'claude', workspace: { label: 'infra' }, project: 'orders-svc', tab: { label: 'review' } } as unknown as Partial<Entity>;
  assert.equal(pt({ ...base, title: 'Paginate orders API' }), 'Paginate orders API');
  // willow (codex, no title / prompt / todos): the flag says it finished, not 'infra'
  assert.equal(pt({ ...base, kind: 'codex', baseTitle: 'codex' }), PENNANT_DONE_TEXT);
  assert.equal(pt({ ...base, baseTitle: 'infra' }), PENNANT_DONE_TEXT, 'a title that only repeats the workspace label');
  assert.equal(pt({ ...base, baseTitle: 'orders-svc' }), PENNANT_DONE_TEXT, '…or the project');
  const todos: Todo[] = [{ content: 'Read the code', status: 'completed', activeForm: '' }, { content: 'Ship the retry queue', status: 'completed', activeForm: '' }, { content: 'Tidy', status: 'pending', activeForm: '' }];
  assert.equal(pt({ ...base, todos }), 'Ship the retry queue', 'the last completed todo');
  assert.equal(pt({ ...base, todos: [todo('Write the migration guide', 'pending')] }), 'Write the migration guide');
  assert.equal(pt({ ...base, todos: [todo('infra', 'completed')] }), PENNANT_DONE_TEXT);
  assert.equal(pt(null), PENNANT_DONE_TEXT);
});

test('[FX fix r1 m2-carry] pat hearts: ≥ 5, on top, popping, one burst per pat (bus verb + CHR burst), kept in frame', async () => {
  const { createMoments, PAT_HEARTS } = await import('./moments.ts');
  const { createBus } = await import('../core/bus.ts');
  const { layout } = await import('../world/layout/hq.ts');
  assert.ok(PAT_HEARTS >= 5);
  const bus = createBus();
  const bursts: [BurstKind, Vec3Like, BurstOpts | undefined][] = [];
  const particles = { burst: (k: BurstKind, p: Vec3Like, o?: BurstOpts) => { bursts.push([k, { ...p }, o]); } };
  const q = batch(false);
  const tiles = { shape: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) };
  // a seated Clawd, crown 1.32 m, framed by a close walk-up camera looking down at its face (hat tip near the top edge)
  const st = new Map<string, MomentState & { y: number }>([['a', { id: 'a', status: 'working', since: 0, x: 0, z: 0, y: 0.25, floorY: 0, top: 1.32, headY: 1.0, vis: true, phase: 0 }]]);
  const m = createMoments({ tiles, sprite: q, pin: q, particles, layout, bus, los: () => false, stateOf: (id) => st.get(id), actorOf: () => ({ pos: { x: 0, y: 0.25, z: 0 } }) });
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
  cam.position.set(0, 1.2, 1.1); cam.lookAt(0, 0.75, 0); cam.updateMatrixWorld();
  const R = new THREE.Vector3(), U = new THREE.Vector3(), Fw = new THREE.Vector3();
  cam.matrixWorld.extractBasis(R, U, Fw); Fw.negate();
  const F = { t: 1, dt: 1 / 60, now: 1e7, R, U, F: Fw, fovK: Math.tan(Math.PI / 6), vw: 1600, vh: 900, camera: cam };
  m.draw([...st.values()], F, cam.position);
  bus.emit('verb', { verb: 'pat', id: 'a' });
  assert.equal(m.hearts('a'), false, 'CHR\'s burst for the same pat is deduped');
  const h = bursts.filter((b) => b[0] === 'hearts');
  assert.equal(h.length, 1);
  assert.equal(h[0][2]?.count, PAT_HEARTS);
  assert.equal(h[0][2]?.top, true, 'on top: never buried in the hat / head');
  const v = new THREE.Vector3(h[0][1].x, h[0][1].y, h[0][1].z).project(cam);
  assert.ok(v.y <= 0.43 && v.y > -0.6 && Math.abs(v.x) < 0.5, `spawn in the upper frame, not off its top edge (ndc ${v.x.toFixed(2)}, ${v.y.toFixed(2)})`);
  assert.ok(h[0][1].y >= 1.0 - 0.12, 'never below the face');
  F.t = 2; m.draw([...st.values()], F, cam.position);
  assert.equal(m.hearts('a'), true, 'a new pat later pops again');
  assert.equal(m.stats().hearts, 2);
  // far camera: plain "over the crown"
  bursts.length = 0; F.t = 4;
  cam.position.set(0, 1.6, 6); cam.lookAt(0, 1, 0); cam.updateMatrixWorld(); cam.matrixWorld.extractBasis(R, U, Fw); Fw.negate();
  m.draw([...st.values()], F, cam.position);
  m.hearts('a');
  assert.ok(bursts[0][1].y > 1.32, 'over the hat tip');
});

test('[FX fix r1 m2-carry] particles: hearts `top` go to the on-top batch and pop (squash-scale from 0)', () => {
  const hot = batch(true), plain = batch(true), top = batch(true);
  const tile = () => ({ u0: 0, v0: 0, u1: 1, v1: 1, w: 64, h: 64 });
  const p = createParticles({ hot, plain, top, tile });
  p.burst('hearts', { x: 0, y: 1, z: 0 }, { count: 7, top: true });
  const R = new THREE.Vector3(1, 0, 0), U = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 20; i++) p.update(0.02, R, U, i * 0.02);
  assert.equal(top.n, 7);
  assert.equal(plain.n, 0);
  assert.equal(hot.n, 0);
});

test('[FX fix r1 m2-carry] storefront strips hang ≥ 0.1 m under their sign plate, the gap growing with the strip', async () => {
  const { stripSpots, stripTop, STRIP_GAP } = await import('./placards.ts');
  const { layout } = await import('../world/layout/hq.ts');
  const spots = stripSpots(layout);
  assert.ok(spots.length > 0);
  for (const sp of spots) {
    const plateBottom = sp.y + 0.035; // (spot y = plate bottom − 0.035)
    for (const s of [1, 1.7, 2.3]) assert.ok(plateBottom - stripTop(sp, s) >= STRIP_GAP * s - 1e-9 && plateBottom - stripTop(sp, s) >= 0.1 - 1e-9);
  }
  // the street strip sits on the street face with ENV's plate (greybox createBaySigns: sign.x ∓ 0.26), not in the wall
  const bay = layout.bays.find((b) => b.sign && b.side === 'E');
  assert.ok(bay && bay.sign);
  const st = spots.find((s) => s.bay === bay.id);
  assert.ok(st);
  assert.ok(Math.abs(st.x - (bay.sign.x - 0.26)) < 0.03);
});

test('[FX fix r2 m2-carry] stripTask: bay roster strip line = task → last todo → status word, never the workspace', async () => {
  const { stripTask, STRIP_STATUS_TEXT } = await import('./rules.ts');
  const { taskLabel, fitLabel } = await import('../../../shared/task.ts');
  const s = (e: Partial<Entity>) => stripTask(e, taskLabel, fitLabel);
  // (a partial fixture: only the fields the label rules read)
  const base = { kind: 'claude', workspace: { label: 'tinker' }, project: 'tinker', tab: { label: 'moss' } } as unknown as Partial<Entity>;
  // the reviewer's 'moss · tinker' / 'comet · tinker': no task → the status, not the workspace
  assert.deepEqual(s({ ...base, status: 'idle', baseTitle: 'tinker' }), { text: STRIP_STATUS_TEXT.idle, muted: true });
  assert.deepEqual(s({ ...base, status: 'done' }), { text: 'done ✓', muted: true });
  assert.equal(s({ ...base, status: 'working' }).text, STRIP_STATUS_TEXT.working);
  assert.equal(s({ ...base, status: 'working' }).muted, false);
  assert.equal(s({ ...base, status: 'blocked' }).text, STRIP_STATUS_TEXT.blocked);
  assert.deepEqual(s({ ...base, status: 'working', title: 'Paginate orders API' }), { text: 'Paginate orders API', muted: false });
  assert.deepEqual(s({ ...base, status: 'idle', title: 'Paginate orders API' }), { text: 'last: Paginate orders API', muted: true });
  const todos: Todo[] = [{ content: 'Ship the retry queue', status: 'completed', activeForm: '' }];
  assert.equal(s({ ...base, status: 'idle', todos }).text, 'Ship the retry queue');
  assert.equal(s({ ...base, status: 'idle', todos: [todo('Tinker', 'completed')] }).text, 'idle');
  for (const st of ['idle', 'done', 'working', 'blocked'] as const) {
    for (const e of [{ ...base, status: st }, { ...base, status: st, baseTitle: 'tinker' }, { ...base, status: st, kind: 'shell' as const }]) {
      assert.ok(!/tinker/i.test(s(e).text), `${st}: ${s(e).text}`);
    }
  }
});

test('[FX fix r2 m2-carry] plan view: every alert (queue head too) collapses to the "!" pin, text on hover / selection', async () => {
  const { planView, PLAN_H } = await import('./declutter.ts');
  const q = { dist: 33, cardW: 390, chipW: 150, stripW: 1600 };
  assert.equal(alertForm({ ...q, head: true }).form, 'card', 'head keeps its card in a normal view');
  assert.equal(alertForm({ ...q, head: true, plan: true }).form, 'dot');
  assert.equal(alertForm({ ...q, plan: true, dist: 2 }).form, 'dot');
  assert.equal(alertForm({ ...q, plan: true, hovered: true }).form, 'card');
  assert.equal(alertForm({ ...q, plan: true, selected: true }).form, 'card');
  // the plan pose (y 32 straight down) is plan; the mezz rail looking into the Pit (≈ 5 m up) and a walk view are not
  assert.equal(planView(-1, 32, 0), true);
  assert.equal(planView(-0.95, 5.2, 0), false);
  assert.equal(planView(-0.3, 32, 0), false);
  assert.equal(planView(-1, 4 + PLAN_H + 1, 4), true, 'relative to the agent floor');
});

test('[FX fix m3-r3] near ✓ pennants: on-screen width capped, the HUD chip band is off-frame', async () => {
  const { PEN_CAP, PENNANT, penCapScale, outsideFrac } = await import('./placards.ts');
  const wM = PENNANT.w + PENNANT.tip, ppm = 900 / (2 * Math.tan((70 * Math.PI) / 360)); // 70° lens, 900 px tall
  const px = (s: number, d: number) => (wM * s * ppm) / d;
  // wu22-02: a flag 1.5 m off the lens at scale 1 was ~400 px; now 180 px
  assert.ok(px(1, 1.5) > 300);
  const s15 = penCapScale(1, wM, 1.5, ppm, PEN_CAP.px);
  assert.ok(Math.abs(px(s15, 1.5) - PEN_CAP.px) < 1e-6);
  for (const d of [0.8, 2, 3, 3.9]) assert.ok(px(penCapScale(1, wM, d, ppm, PEN_CAP.px), d) <= PEN_CAP.px + 1e-6, `≤ cap at ${d} m`);
  // far flags keep their distance growth untouched
  assert.equal(penCapScale(1.8, wM, 12, ppm, PEN_CAP.px), 1.8);
  assert.ok(PEN_CAP.fadeM === 3 && PEN_CAP.fadeBack > PEN_CAP.fadeM, 'walk-up furl radius + hysteresis');
  // a flag reaching up into the chip bar (y < hudTop) counts as cut
  assert.equal(outsideFrac(700, 60, 880, 110, 0, 1600, 900, PEN_CAP.hudTop), 0);
  assert.ok(outsideFrac(700, 10, 880, 60, 0, 1600, 900, PEN_CAP.hudTop) > 0.5);
  assert.equal(outsideFrac(700, 10, 880, 60, 0, 1600, 900), 0, 'default top = 0 (strips unchanged)');
});
