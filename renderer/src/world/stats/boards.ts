/**
 * The M3.5 chalkboards as stats objects that draw into a HOST object's panel set (no draw call of their own):
 * - Café "Today's specials": the hanging chalk menu over the espresso bar + the reading-corner wall board (ENV's
 *   `cafMenu` / `cafBoard`, zones/cafe.ts) get a slate canvas over their faces; host = hiScore (same zone).
 * - Lab test tallies: the Lab's mobile whiteboard + the print over the west test bench (ENV `labBoard` / `labPosterW`,
 *   zones/lab.ts) turn slate; host = the lobby clock
 *   (the nearest stats object; the Lab has none of its own).
 * The board poses mirror ENV's placements (plan coords, face depth from the kit builders): keep in sync if ENV moves them.
 * Tallies come from store `event`s (`tool`, `test-pass`, `test-fail`) + a `timeline.get` backfill for today's tests;
 * the TEST light itself (ENV labLight.ts) flashes on the same events, the newest chalk mark glows for 4 s.
 * Owner: STAT.
 */
import * as THREE from 'three';
import { PLAN_OFFSET } from '../layout/schema.ts';
import { call } from '../../net/store.ts';
import { isRecord } from '../../../../shared/guards.ts';
import type { StatObject } from './registry.ts';
import type { PanelBand, PanelQuad } from './panel.ts';
import type { Ctx } from '../../core/ctx.ts';
import { createToolTally, createTestTally, createThroughput, steamFor, drawSpecials, drawTallies, toolLabel, shortN, CHALK } from './chalk.ts';

/** Board faces: plan (x, z), face-centre height y, facing yaw, slate size, face depth (local +z) and canvas px. */
export interface Board { id: string; plan: [number, number]; y: number; yaw: number; w: number; h: number; z: number; px: number }

export const CAFE_BOARDS: readonly Board[] = Object.freeze<Board[]>([
  // kit/lounge.ts buildCafeMenu (w 1.5, h 0.62; slate w−0.08 × h−0.08, chalk lines at z 0.029) at W(35.0, 27.5, 2.13, π)
  { id: 'cafMenu', plan: [35.0, 27.5], y: 2.13, yaw: Math.PI, w: 1.42, h: 0.54, z: 0.034, px: 768 },
  // kit/decor.ts buildCorkboard (w 1.0, h 0.66; origin = bottom edge; pins to z 0.032) at W(36.45, 20.12, 1.45, 0)
  { id: 'cafBoard', plan: [36.45, 20.12], y: 1.45 + 0.33, yaw: 0, w: 0.94, h: 0.6, z: 0.036, px: 640 },
]);
export const LAB_BOARDS: readonly Board[] = Object.freeze<Board[]>([
  // kit/decor.ts buildWhiteboard (w 1.25, h 0.75, mobile: face y0 0.55; notes at z 0.02) at W(11.6, 23.86, 0, 0.04)
  { id: 'labBoard', plan: [11.6, 23.86], y: 0.55 + 0.375, yaw: 0.04, w: 1.19, h: 0.69, z: 0.026, px: 768 },
  // kit/decor.ts buildPoster (w 0.7, h 0.5; origin centre; mat frame to z 0.051) at W(6.62, 25.2, 1.62, π/2): the
  // print over the west test bench (the one the `lab` pose looks at) becomes a slate
  { id: 'labPosterW', plan: [6.62, 25.2], y: 1.62, yaw: Math.PI / 2, w: 0.64, h: 0.44, z: 0.055, px: 640 },
]);

/** World centre of a board face. */
export function boardWorld(b: Board) {
  return new THREE.Vector3(b.plan[0] - PLAN_OFFSET.x + Math.sin(b.yaw) * b.z, b.y, b.plan[1] - PLAN_OFFSET.z + Math.cos(b.yaw) * b.z);
}

/**
 * Panel-set specs placing `boards` in `root`'s local frame (root: a stats object's root Group, posed, not yet parented).
 */
export function boardSpecs(root: THREE.Object3D, boards: readonly Board[]): PanelQuad[] {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  return boards.map((b) => {
    const p = boardWorld(b).applyMatrix4(inv);
    return { w: b.w, h: b.h, px: b.px, pos: [p.x, p.y, p.z], rot: [0, b.yaw - root.rotation.y, 0] };
  });
}

/** World aim box of a board face (a thin slab). */
function boardBox(b: Board) {
  const c = boardWorld(b);
  const hw = b.w / 2, cs = Math.abs(Math.cos(b.yaw)), sn = Math.abs(Math.sin(b.yaw));
  const half = new THREE.Vector3(hw * cs + 0.04 * sn, b.h / 2, hw * sn + 0.04 * cs);
  return new THREE.Box3(c.clone().sub(half), c.clone().add(half));
}

const ring = (arr: number[], v: number, n = 300) => { arr.push(v); if (arr.length > n) arr.splice(0, arr.length - n); };

/**
 * Café specials (both boards): top 3 tools today, coffees Bean pulled, brew = output tokens/s. Emits the AMB steam hook
 * `bus 'stat.brew' {tps, steam}` at 1 Hz.
 * `panels`: one panel per CAFE_BOARDS entry (from the host's panel set).
 */
export function createSpecials(ctx: Ctx, panels: PanelBand[]): StatObject {
  const tools = createToolTally();
  const tp = createThroughput();
  const tpsHist: number[] = [];
  let coffees = 0, acc = 1, sampleT = 0;
  const offs = [
    ctx.store?.on?.('event', (ev) => { if (ev?.kind === 'tool') tools.add(isRecord(ev.detail) && typeof ev.detail.tool === 'string' ? ev.detail.tool : undefined); }),
    ctx.bus?.on?.('amb.bean', (e) => { if (e?.ev === 'pssht') coffees++; }),
  ];
  // review shots: `?chalk=demo` pre-fills plausible numbers (never in normal use)
  const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).get('chalk') === 'demo';
  if (demo) { for (const [t, n] of ([['Read', 42], ['Edit', 27], ['Bash', 19], ['Grep', 8]] as const)) for (let i = 0; i < n; i++) tools.add(t); coffees = 7; }
  const group = new THREE.Group();
  group.name = 'stat:specials';
  return {
    object3d: group,
    hitBoxes: CAFE_BOARDS.map(boardBox),
    redraws: () => panels.reduce((n, p) => n + p.redraws, 0),
    update(stats, dt, c) {
      const now = performance.now() / 1000;
      acc += c.rawDt ?? dt;
      if (acc >= 1) {
        acc = 0;
        const ents = [...(c.store?.entities?.values() ?? [])];
        tools.seed(ents);
        sampleT = now;
        const tps = tp.sample(ents, sampleT) + (demo ? 380 : 0);
        ring(tpsHist, tps);
        c.bus?.emit?.('stat.brew', { tps, steam: steamFor(tps) });
      }
      const top = tools.top(3);
      const tps = tpsHist.length ? tpsHist[tpsHist.length - 1] : 0;
      const d = { top, coffees, tps };
      const key = `${top.map((t) => `${t.tool}:${t.n}`).join(',')}|${coffees}|${shortN(tps)}`;
      panels.forEach((p) => { p.draw(key, (g, W, H) => drawSpecials(g, W, H, d), now); p.tick(now); });
    },
    tooltip() {
      const top = tools.top(3);
      const tps = tpsHist.length ? tpsHist[tpsHist.length - 1] : 0;
      return {
        title: "Café · Today's specials", value: `${top.map((t) => `${toolLabel(t.tool)} ×${t.n}`).join(' · ') || 'no tools yet'} · ${coffees} coffees · ${shortN(tps)} tok/s`,
        spark: tpsHist.slice(), unit: 'tok/s', source: 'agent tool events (today) · outputTokens Δ · Bean the barista', color: CHALK.butter,
      };
    },
    dispose() { for (const off of offs) if (typeof off === 'function') off(); },
  };
}

/**
 * Lab test tallies (today): live `test-pass` / `test-fail` events + one `timeline.get` backfill once connected.
 * `panels`: one panel per LAB_BOARDS entry (from the host's panel set).
 */
export function createTallies(ctx: Ctx, panels: PanelBand[]): StatObject {
  const tally = createTestTally();
  const store = ctx.store;
  const offs = [store?.on?.('event', (ev) => { if (ev?.kind === 'test-pass' || ev?.kind === 'test-fail') tally.add(ev.kind, store.now?.() ?? Date.now()); })];
  const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).get('chalk') === 'demo';
  if (demo) { const t = Date.now() - 3600e3; 'ppppfppppppfpppppppppfpppp'.split('').forEach((k, i) => tally.add(k === 'p' ? 'test-pass' : 'test-fail', t + i * 60e3, `demo${i}`, i === 25)); }
  let asked = false;
  const backfill = () => {
    asked = true;
    const skew = (store.now?.() ?? Date.now()) - Date.now();
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const bootAt = store.now?.() ?? Date.now();
    const off: (() => boolean) | undefined = store.on?.('timeline', (m) => {
      off?.();
      for (const it of m?.items ?? []) if (it.at < bootAt) tally.add(it.kind, it.at, `${it.at}|${it.id}|${it.kind}`, false);
    });
    try { call({ t: 'timeline.get', since: Math.floor(d.getTime() + skew) }).then((r) => { if (!r?.ok) off?.(); }).catch(() => off?.()); } catch { off?.(); }
    setTimeout(() => off?.(), 5000);
  };
  const group = new THREE.Group();
  group.name = 'stat:labTallies';
  const GLOW_S = 4;
  return {
    object3d: group,
    hitBoxes: LAB_BOARDS.map(boardBox),
    redraws: () => panels.reduce((n, p) => n + p.redraws, 0),
    update(stats, dt, c) {
      const now = performance.now() / 1000;
      if (!asked && c.store?.stats && !demo) backfill();
      const glow = now - tally.lastAt < GLOW_S ? 1 : 0;
      const d = { marks: tally.marks, pass: tally.pass, fail: tally.fail, glow };
      for (const p of panels) { p.draw(`${d.pass}|${d.fail}|${glow}`, (g, W, H) => drawTallies(g, W, H, d), now); p.tick(now); }
    },
    tooltip() {
      let p = 0;
      const spark = tally.marks.map((m, i) => { if (m.ok) p++; return p / (i + 1) * 100; });
      return { title: 'Lab · test tallies', value: `${tally.pass} passed · ${tally.fail} failed today`, spark, max: 100, unit: '%', source: 'test-pass / test-fail events (transcripts) · timeline', color: CHALK.white };
    },
    dispose() { for (const off of offs) if (typeof off === 'function') off(); },
  };
}
