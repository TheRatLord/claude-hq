import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, ACT_INFO, actPose, cycleLength, faceGlyphs, footAt, gait, newGlyphs, newPose, newSprings, poseDelta, springStep, FACES, NCH } from './pose.ts';
import type { Body, GaitState } from './pose.ts';
import { lookFor } from './look.ts';
import { BODIES as ALL_BODIES, BODY_STYLE, CLAWD, CODEX, GLYPHS, KIND_COLORS, clawdBody, clawdPlan, codexPlan } from './mascots.ts';
import { farmerFace } from '../../hud/icons.ts';
import { newMover, moveStep, separate, place } from './motion.ts';
import { newTrail, trailPush, trailAt } from './trail.ts';
import { buildSeats, newMind, pickSeat, plan } from './brain.ts';
import type { World } from './brain.ts';
import { HANGOUTS, SITES, structure, POND } from '../../world/map.ts';
import { JOBS } from '../../model/types.ts';
import type { FarmerView, Job } from '../../model/types.ts';

const BODIES: readonly Body[] = ALL_BODIES;

test('every act produces a finite pose and loops continuously, for every body', () => {
  const a = newPose(), b = newPose();
  for (const body of BODIES) for (const act of ACTS) {
    for (let t = 0; t < 12; t += 0.016) {
      actPose(act, t, 0.3, 1, a, t, body);
      actPose(act, t + 0.016, 0.3, 1, b, t + 0.016, body);
      for (let i = 0; i < NCH; i++) assert.ok(Number.isFinite(a[i]), `${body} ${act} ch${i}`);
      // the springs smooth everything downstream; the raw targets may only step on deliberate beats
      assert.ok(poseDelta(a, b) < 0.9, `${body} ${act} jumps ${poseDelta(a, b)} at t=${t}`);
    }
  }
});

test('springs carry every act change without a pop, and settle on the target', () => {
  const s = newSprings();
  const out = newPose(), prev = newPose(), prev2 = newPose(), tgt = newPose();
  const g: GaitState = { cyc: 0, w: 0, jog: 0, turn: 0, speed: 0, heavy: false, bounce: 1 };
  let t = 0;
  for (const act of ['plant', 'ask', 'plan', 'lie', 'carry', 'fish', 'cheer', 'stand'] as const) {
    for (let i = 0; i < 40; i++) {
      t += 0.016;
      prev2.set(prev);
      prev.set(out);
      actPose(act, t, 0.1, 1, tgt, t);
      g.w = act === 'carry' ? 1 : 0; g.cyc += 0.016 * 1.4 / cycleLength('clawd', 0, !!ACT_INFO[act].heavy);
      gait(tgt, 'clawd', g, !!ACT_INFO[act].carryWalk);
      springStep(s, tgt, 0.016, out);
      for (let c = 0; c < NCH; c++) assert.ok(Number.isFinite(out[c]));
      if (t > 0.05) {
        // never teleports: a stiff spring may whip a nub up in a few frames, but always passes through the gap
        assert.ok(poseDelta(prev, out) < 0.8, `pop into ${act} (frame ${i}): ${poseDelta(prev, out)}`);
      }
    }
  }
  // a still target: the springs settle onto it
  actPose('stand', 0, 0, 1, tgt, 0);
  const fixed = new Float32Array(tgt);
  for (let i = 0; i < 400; i++) springStep(s, fixed, 0.016, out);
  assert.ok(poseDelta(out, fixed) < 0.01);
});

test('planted feet never skate: a foot on the ground moves back at exactly the body speed', () => {
  for (const body of BODIES) for (const jog of [0, 1]) for (const heavy of [false, true]) {
    const L = cycleLength(body, jog, heavy);
    const g: GaitState = { cyc: 0, w: 1, jog, turn: 0, speed: 1, heavy, bounce: 1 };
    const n = BODY_STYLE[body].legs === 'legs' ? 4 : 2;
    const a = { z: 0, y: 0 }, b = { z: 0, y: 0 };
    let planted = 0, lifted = 0;
    const dx = 0.002; // metres travelled per step
    for (let d = 0; d < L * 3; d += dx) {
      for (let i = 0; i < n; i++) {
        g.cyc = d / L; footAt(body, i, g, a);
        g.cyc = (d + dx) / L; footAt(body, i, g, b);
        if (a.y === 0 && b.y === 0 && Math.abs(b.z - a.z) < L * 0.3) {
          planted++;
          // world position = travel + offset stays fixed
          assert.ok(Math.abs((d + dx + b.z) - (d + a.z)) < 1e-4, `${body} jog=${jog} heavy=${heavy} leg ${i} skates ${(dx + b.z - a.z).toFixed(5)}`);
        } else lifted++;
        assert.ok(a.y >= 0 && a.y < 0.2);
      }
    }
    assert.ok(planted > 0 && lifted > 0, `${body} both stance and swing`);
  }
  // Clawd trots on diagonal pairs: FL with BR, FR with BL
  const g: GaitState = { cyc: 0.3, w: 1, jog: 0, turn: 0, speed: 1, heavy: false, bounce: 1 };
  const f = [0, 1, 2, 3].map((i) => ({ ...footAt('clawd', i, g, { z: 0, y: 0 }) }));
  assert.deepEqual(f[0], f[3]);
  assert.deepEqual(f[1], f[2]);
  assert.notDeepEqual(f[0], f[1]);
  // a waddle alternates: one foot swings while the other stands
  const w = [0, 1].map((i) => ({ ...footAt('goose', i, g, { z: 0, y: 0 }) }));
  assert.ok((w[0].y === 0) !== (w[1].y === 0) || w[0].z !== w[1].z, 'the two feet are out of phase');
});

test('looks: deterministic, tier hats, kind bodies and colours', () => {
  const a = lookFor({ seed: 'gale', tier: 'opus', kind: 'claude' }, 0xff0000);
  assert.deepEqual(a, lookFor({ seed: 'gale', tier: 'opus', kind: 'claude' }, 0xff0000));
  assert.equal(a.hat, 'straw');
  assert.equal(a.body, 'clawd');
  assert.equal(a.color, 0xd97757);
  assert.equal(a.scarf, 0xff0000);
  assert.equal(lookFor({ seed: 'x', tier: 'sonnet', kind: 'claude' }, 0).hat, 'cap');
  assert.equal(lookFor({ seed: 'x', tier: 'haiku', kind: 'claude' }, 0).hat, 'bandana');
  assert.equal(lookFor({ seed: 'x', tier: null, kind: 'agent' }, 0).hat, 'beanie');
  assert.equal(lookFor({ seed: 'x', tier: 'opus', kind: 'codex' }, 0).body, 'codex');
  assert.equal(lookFor({ seed: 'x', tier: null, kind: 'gemini' }, 0).body, 'gemini');
  assert.equal(lookFor({ seed: 'x', tier: null, kind: 'agent' }, 0).body, 'bot', 'an unknown agent is the sprout-bot, never a Clawd');
  assert.equal(lookFor({ seed: 'x', tier: null, kind: 'agent', vendor: 'goose' }, 0).body, 'goose');
  assert.equal(lookFor({ seed: 'x', tier: null, kind: 'agent', vendor: 'droid' }, 0).body, 'bot');
  assert.equal(lookFor({ seed: 'x', tier: null, kind: 'agent', vendor: 'goose' }, 0).hat, 'beanie', 'the tier hat still applies');
  const scales = Array.from({ length: 60 }, (_, i) => lookFor({ seed: `s${i}`, tier: 'opus', kind: 'claude' }, 0).scale);
  assert.ok(Math.min(...scales) >= 0.95 && Math.max(...scales) <= 1.05 && new Set(scales).size > 10);
});

test('the Clawd voxel body projects to exactly the banner sprite', () => {
  const v = clawdBody();
  const g = CLAWD.front;
  const plan = clawdPlan();
  // body rows/cols of the sprite (the arm nubs and legs are separate parts)
  const bodyRows = g.map((r, i) => [r, i] as const).filter(([r]) => /[#e]/.test(r));
  const r0 = bodyRows[0][1], r1 = bodyRows[bodyRows.length - 1][1];
  const c0 = Math.min(...bodyRows.map(([r]) => r.search(/[#e]/)));
  const c1 = Math.max(...bodyRows.map(([r]) => Math.max(r.lastIndexOf('#'), r.lastIndexOf('e'))));
  const cols = c1 - c0 + 1;
  let hits = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const has = (z: number) => v.cells.has !== undefined && [...v.cells.values()].some((q) => q.group === 0 && q.slot === 1 && q.x === c - c0 - cols / 2 && q.y === r1 - r && q.z === z);
    const want = '#e'.includes(g[r][c]);
    assert.equal(has(-CLAWD.depth / 2), want, `sprite cell (${c},${r})`);
    assert.equal(has(CLAWD.depth / 2 - 1), want, `sprite cell (${c},${r}) front`);
    if (want) hits++;
  }
  assert.ok(hits >= 90);
  // arm nubs stick out either side on the lower body rows, legs hang below
  for (const row of g) if (row.includes('a')) { assert.equal(row.indexOf('a'), 0); assert.ok(row.search(/[#e]/) > 0); }
  assert.ok(g.slice(r1 + 1).every((row) => /^[.l]+$/.test(row)));
  // four legs with a gap in the middle, eyes symmetric, arm nubs on the lower body row
  assert.equal(plan.hips.length, 4);
  assert.ok(Math.abs(plan.glyphs[0].x + plan.glyphs[1].x) < 1e-9);
  assert.ok(plan.shoulder.y < plan.h / 2);
  const lx = plan.hips.map((h) => h.x).sort((p, q) => p - q);
  assert.ok(lx[2] - lx[1] > lx[1] - lx[0], 'middle gap wider than the pair gap');
  assert.ok(plan.w > 1.15 && plan.w < 1.3, `Clawd a sturdy 1.2 m wide (${plan.w})`);
  assert.ok(plan.h + plan.legLen > 0.95 && plan.h + plan.legLen < 1.15, `Clawd about a metre tall (${plan.h + plan.legLen})`);
  // chunky toy proportions: legs at least two voxels wide and deep, three-voxel-tall arm nubs
  assert.ok(g.every((row) => !/(^|[^l])l([^l]|$)/.test(row)), 'no one-voxel stick legs');
  assert.ok(CLAWD.legDepth >= 2 && plan.armW >= 3 * plan.u - 1e-9);
  const legHalf = plan.hips.map((h) => Math.abs(h.x)).sort((p, q) => p - q);
  assert.ok(legHalf[3] + plan.u < plan.w / 2 + 1e-9, 'legs stand under the body');
});

test('the Codex plan anchors the >_ face on the front and stands on its feet', () => {
  const p = codexPlan();
  assert.equal(p.hips.length, 2);
  assert.equal(p.glyphs.length, 2);
  const [eye, cursor] = p.glyphs;
  assert.ok(eye.x < cursor.x, 'the > sits left of the _ cursor');
  assert.ok(eye.y > cursor.y, 'the cursor sits lower');
  assert.ok(eye.z > 0 && cursor.z > 0);
  assert.ok(p.legLen > 0 && p.h + p.legLen < 1.15 && p.h + p.legLen > 0.9, `height ${p.h + p.legLen}`);
  assert.ok(Math.abs(p.hips[0].x + p.hips[1].x) < 1e-9);
  assert.ok(CODEX.front.every((r) => r.length === CODEX.front[0].length), 'grid rows are the same width');
  for (const [n, rows] of Object.entries(GLYPHS)) assert.ok((rows as readonly string[]).every((r) => r.length === (rows as readonly string[])[0].length), `glyph ${n}`);
});

test('faces: the Codex cursor blinks like a terminal; every face resolves to known glyphs', () => {
  const g = newGlyphs();
  const on = new Set<boolean>();
  for (let t = 0; t < 2.2; t += 0.05) { faceGlyphs('codex', 'neutral', 0, t, g); on.add(g[1].on); }
  assert.deepEqual([...on].sort(), [false, true]);
  for (const body of BODIES) for (const face of FACES) for (const blink of [0, 1]) {
    faceGlyphs(body, face, blink, 0.3, g);
    for (const s of g) {
      assert.ok(s.g in GLYPHS, `${body} ${face}: ${s.g}`);
      for (const k of ['sx', 'sy', 'dx', 'dy', 'roll'] as const) assert.ok(Number.isFinite(s[k]));
    }
  }
});

test('mover walks a route, arrives, and holds its spot against small nudges', () => {
  const m = newMover(0, 0, 0);
  const route = (_f: { x: number; z: number }, to: { x: number; z: number }) => [{ x: 5, z: 0 }, to];
  const tgt = { key: 'a', x: 5, z: 5, yaw: 1, gait: 'walk' as const };
  let t = 0;
  while (!m.arrived || t < 0.1) { moveStep(m, tgt, 0.016, route); t += 0.016; assert.ok(t < 20, 'arrives'); }
  assert.ok(Math.hypot(m.x - 5, m.z - 5) < 0.2);
  m.x += 0.3;
  moveStep(m, tgt, 0.016, route);
  assert.ok(m.arrived, 'nudge does not restart the walk');
  place(m, { key: 'b', x: 9, z: 9, yaw: 0, gait: 'walk' });
  assert.equal(m.x, 9);
});

test('separation pushes walkers apart, not settled farmers', () => {
  const pts = [{ x: 0, z: 0, walking: false }, { x: 0.2, z: 0, walking: true }];
  for (let i = 0; i < 60; i++) separate(pts, 0.7, 0.016);
  assert.equal(pts[0].x, 0);
  assert.ok(pts[1].x > 0.6);
});

test('trail returns points behind the walker', () => {
  const tr = newTrail(0, 0);
  for (let x = 0; x <= 10; x += 0.05) trailPush(tr, x, 0);
  const o = { x: 0, z: 0 };
  trailAt(tr, 10, 0, 2, o);
  assert.ok(Math.abs(o.x - 8) < 0.25);
});

const view = (job: Job, spot = 0): FarmerView => ({
  id: 'f1', name: 'x', project: 'x', tag: 'x', kind: 'claude', seed: 's', tier: 'opus', plotId: 'p', spot, status: 'working', job, jobSince: 0, rawJob: job, detail: '',
  title: null, needsYou: job === 'ask', unseenDone: false, struggle: 0, mood: 'focused', busy: 0.5, ducklings: [], said: null, question: null,
  options: [], todos: null, work: null, context: null, lastActive: 0,
});

test('every job yields an intent; work jobs share one spot; haul reaches the bin and ships', () => {
  const seats = buildSeats({ hangouts: HANGOUTS, campfire: structure('campfire'), well: structure('well'), board: structure('noticeboard'), pond: POND });
  const occ = new Map<number, string>();
  const bin = structure('shippingBin');
  const w: World = {
    site: SITES[0], plotKind: 'wheat', bin, mailbox: structure('mailbox'), well: structure('well'), exit: { x: 0, z: 80 }, hub: { x: 0, z: 0 }, seats,
    claim: (id, kind, t) => { const i = pickSeat(seats, occ, id, kind, ['fire'], 0.5, () => ((t * 7) % 1)); occ.set(i, id); return i; },
  };
  const keys = new Set<string>();
  for (const job of JOBS) {
    const m = newMind(job, 0, 0.2);
    const i = plan(m, view(job), w, { x: 0, z: 0 }, false, 0, []);
    assert.ok(Number.isFinite(i.x) && Number.isFinite(i.z), job);
    if (['plant', 'inspect', 'build', 'talk', 'delegate', 'rest'].includes(job)) keys.add(i.key);
  }
  assert.deepEqual([...keys], ['work']);
  // haul loop
  const m = newMind('haul', 0, 0);
  const cues: string[] = [];
  let pos = { x: 0, z: 0 };
  let sawBin = false;
  for (let t = 0; t < 30; t += 0.1) {
    const i = plan(m, view('haul'), w, pos, true, t, cues);
    pos = { x: i.x, z: i.z };
    if (Math.hypot(i.x - bin.x, i.z - bin.z) < 3) sawBin = true;
  }
  assert.ok(sawBin);
  assert.ok(cues.includes('ship'));
  // idle picks a leisure seat, away a nap seat
  const mi = newMind('idle', 0, 0.5);
  const ii = plan(mi, view('idle'), w, pos, false, 0, []);
  assert.ok(ii.key.startsWith('seat:'));
  const ma = newMind('away', 0, 0.5);
  const ia = plan(ma, view('away'), w, pos, false, 0, []);
  assert.ok(['nap', 'lie'].includes(ia.act));
});

test('the HUD portrait draws the same sprite grids and colours as the 3D mascots', () => {
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const count = (svg: string, c: number) => svg.split(`fill="${hex(c)}"`).length - 1;
  const cells = (rows: readonly string[], chars: string) => rows.join('').split('').filter((ch) => chars.includes(ch)).length;
  const clawd = farmerFace(0, 'claude');
  assert.equal(count(clawd, KIND_COLORS.claude.body), cells(CLAWD.front, '#a'));
  assert.equal(count(clawd, KIND_COLORS.claude.glyph), cells(CLAWD.front, 'e'));
  assert.equal(count(clawd, KIND_COLORS.claude.dark), cells(CLAWD.front, 'l'));
  const codex = farmerFace(0, 'codex');
  assert.equal(count(codex, KIND_COLORS.codex.body), cells(CODEX.front, '#EMa'));
  assert.equal(count(codex, KIND_COLORS.codex.dark), cells(CODEX.front, 'f'));
  assert.equal(count(codex, KIND_COLORS.codex.glyph), cells(GLYPHS.prompt, '#') + cells(GLYPHS.cursor, '#'));
  // gemini / agent are their own mascots now (scene/farmers/mascots.test.ts checks the art portraits)
  for (const k of ['gemini', 'agent'] as const) assert.equal(count(farmerFace(0, k), KIND_COLORS[k].body), 0);
  // with a tier the hat is added on top; the sprite is unchanged
  assert.ok(farmerFace(0, 'claude', 'opus').length > clawd.length);
  assert.equal(count(farmerFace(0, 'claude', 'opus'), KIND_COLORS.claude.body), cells(CLAWD.front, '#a'));
});

test('labels: a building between the eye and a label hides it', async () => {
  const { segmentHitsBox } = await import('./labels.ts');
  const barn = { x: 0, z: 0, yaw: 0.4, w: 6, d: 4, y0: 0, y1: 5 };
  assert.equal(segmentHitsBox(barn, -10, 1.6, 0, 10, 2, 0), true, 'straight through');
  assert.equal(segmentHitsBox(barn, -10, 1.6, 0, 10, 8, 0), true, 'clips the wall on the way up');
  assert.equal(segmentHitsBox(barn, -10, 6, 0, 10, 6, 0), false, 'over the roof');
  assert.equal(segmentHitsBox(barn, -10, 1.6, 8, 10, 2, 8), false, 'beside it');
  assert.equal(segmentHitsBox(barn, -10, 1.6, 0, -5, 2, 0), false, 'label in front of it');
});
