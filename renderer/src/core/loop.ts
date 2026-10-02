/**
 * Browser frame loop with optional FPS capping, a 10 FPS hidden-tab timer and an embedder background rate / pause.
 * The caller owns the complete frame state and supplies the frame callback.
 */

import { errMessage } from '../../../shared/guards.ts';
import type { AnimClock } from './time.ts';

export interface LoopPerf {
  fps: number;
  frameMs: number;
  cpuMs: number;
  frameErrors: number;
}

export interface LoopState {
  clock: AnimClock;
  perf: LoopPerf;
  dt: number;
  rawDt: number;
  time: number;
  /** Milliseconds sampled from the caller's time source at frame start. */
  now: number;
  hour: number;
  frame: number;
  hidden: boolean;
}

export interface Loop {
  start(): void;
  stop(): void;
  /** null = uncapped (vsync) */
  setFpsCap(fps: number | null): void;
  fpsCap(): number | null;
  /**
   * An embedder's say over drawing (the desktop shell when its window is hidden / minimized, or "Pause rendering"):
   * null = normal (rAF; the hidden-tab timer while document.hidden), a number of ms = a timer at that interval
   * instead of rAF, 0 = no frames at all until set back.
   */
  setBackground(ms: number | null): void;
}

export function createLoop<C extends LoopState>(ctx: C, frame: (ctx: C) => void, now: () => number = Date.now): Loop {
  let running = false;
  let raf = 0;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  let cap: number | null = null;
  let background: number | null = null;
  let lastFrameAt = 0;
  const perf = ctx.perf;
  const HIDDEN_MS = 100;
  const errSeen = new Set<string>();

  const tick = (t: number) => {
    if (cap && lastFrameAt && t - lastFrameAt < 1000 / cap - 1) return;
    const interval = lastFrameAt ? t - lastFrameAt : 16.7;
    lastFrameAt = t;
    ctx.clock.tick(t);
    ctx.dt = ctx.clock.dt;
    ctx.rawDt = ctx.clock.rawDt;
    ctx.time = ctx.clock.time;
    ctx.now = now();
    ctx.hour = ctx.clock.hour();
    ctx.frame++;
    const t0 = performance.now();
    try {
      frame(ctx);
    } catch (e) {
      // Log each distinct error once (with its stack): a throwing system must not flood the console at 60 Hz.
      const key = errMessage(e);
      if (!errSeen.has(key)) { errSeen.add(key); console.error(`[loop] frame threw: ${e instanceof Error ? (e.stack ?? e) : e}`); }
      perf.frameErrors++;
    }
    const cpu = performance.now() - t0;
    const k = 0.05;
    perf.frameMs = perf.frameMs ? perf.frameMs + (interval - perf.frameMs) * k : interval;
    perf.cpuMs = perf.cpuMs ? perf.cpuMs + (cpu - perf.cpuMs) * k : cpu;
    perf.fps = perf.frameMs > 0 ? 1000 / perf.frameMs : 0;
  };

  const onRaf = (t: number) => {
    if (!running) return;
    raf = requestAnimationFrame(onRaf);
    tick(t);
  };
  /** the timer interval while not on rAF: the embedder's background rate, else the hidden-tab rate, else null (rAF) */
  const timerMs = () => background !== null ? background : document.hidden ? HIDDEN_MS : null;
  const onHiddenTick = () => {
    hiddenTimer = null;
    const ms = timerMs();
    if (!running || !ms) return;
    tick(performance.now());
    hiddenTimer = setTimeout(onHiddenTick, ms);
  };
  const onVisibility = () => {
    ctx.hidden = document.hidden;
    if (!running) return;
    const ms = timerMs();
    if (ms !== null) {
      cancelAnimationFrame(raf);
      if (hiddenTimer && ms !== HIDDEN_MS) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      if (!hiddenTimer && ms > 0) hiddenTimer = setTimeout(onHiddenTick, ms);
    } else {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      lastFrameAt = 0;
      // a 'visible' event while already visible (duplicate events, embedders) must not start a second rAF chain:
      // each extra chain renders the whole valley once more per vsync
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(onRaf);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      document.addEventListener('visibilitychange', onVisibility);
      ctx.hidden = document.hidden;
      if (timerMs() !== null) onVisibility();
      else raf = requestAnimationFrame(onRaf);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    setFpsCap(fps) { cap = fps && fps > 0 ? fps : null; },
    fpsCap: () => cap,
    setBackground(ms) {
      const next = ms === null || !Number.isFinite(ms) ? null : Math.max(0, ms);
      if (next === background) return;
      background = next;
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      onVisibility();
    },
  };
}
