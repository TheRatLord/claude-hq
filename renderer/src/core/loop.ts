/**
 * Frame loop driver (§8.1, §5.2 throttling). main.ts supplies `frame(ctx)` which calls the systems in the §8.1 order.
 * - Visible: requestAnimationFrame, optionally capped (`setFpsCap`: drawer open 30, fullscreen 10).
 * - Hidden tab: rAF stops, so a 10 fps setTimeout tick runs with `ctx.hidden = true` (main skips post).
 * Nothing that must happen while hidden (notifications, terminal bytes, store updates) lives here.
 * Owner: CORE.
 */

import { errMessage } from '../../../shared/guards.ts';
import type { Ctx } from './ctx.ts';

export interface Loop {
  start(): void;
  stop(): void;
  /** null = uncapped (vsync) */
  setFpsCap(fps: number | null): void;
  fpsCap(): number | null;
}

export function createLoop(ctx: Ctx, frame: (ctx: Ctx) => void): Loop {
  let running = false;
  let raf = 0;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  let cap: number | null = null;
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
    ctx.now = ctx.store ? ctx.store.now() : Date.now();
    ctx.hour = ctx.clock.hour();
    ctx.frame++;
    const t0 = performance.now();
    try {
      frame(ctx);
    } catch (e) {
      // Log each distinct error once (with its stack): a throwing system must not flood the console at 60 Hz.
      const key = errMessage(e);
      if (!errSeen.has(key)) { errSeen.add(key); console.error(`[loop] frame threw: ${e instanceof Error ? (e.stack ?? e) : e}`); }
      ctx.perf.frameErrors = (ctx.perf.frameErrors ?? 0) + 1;
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
  const onHiddenTick = () => {
    hiddenTimer = null;
    if (!running || !document.hidden) return;
    tick(performance.now());
    hiddenTimer = setTimeout(onHiddenTick, HIDDEN_MS);
  };
  const onVisibility = () => {
    ctx.hidden = document.hidden;
    if (!running) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      if (!hiddenTimer) hiddenTimer = setTimeout(onHiddenTick, HIDDEN_MS);
    } else {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      lastFrameAt = 0;
      raf = requestAnimationFrame(onRaf);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      document.addEventListener('visibilitychange', onVisibility);
      ctx.hidden = document.hidden;
      if (document.hidden) onVisibility();
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
  };
}
