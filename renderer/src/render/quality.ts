/**
 * Quality tiers + auto-scaling (§5.2). `?quality=` pins the tier and disables auto; the choice is saved.
 *
 * Auto-scaling judges *load*, not the frame interval alone (RND fix r1, playtest: the drawer's 30 / 10 fps cap read as
 * overload and ratcheted medium/1.0 → low/0.6 for the rest of the session while the GPU idled):
 * - While a loop fps cap is active (`ctx.fpsCap`, drawer open / fullscreen) or the tab is hidden, the scaler does
 *   nothing and forgets its evidence; after the cap lifts it waits SETTLE frames before it measures again.
 * - Work = max(cpuMs, gpuMs) (EMAs from the loop and post.ts's frame timer query; gpuMs is null without
 *   EXT_disjoint_timer_query_webgl2). Interval = EMA of the rAF interval.
 * - Overload: interval > 20 ms for 2 s AND (work unknown, i.e. neither cpuMs nor gpuMs measured, or work > 12 ms) →
 *   render scale −0.1 (floor 0.6), then a tier down. Without a GPU timer, work = the measured cpuMs alone. A long interval with little work of ours (a throttled or slow-refresh display) is not overload.
 * - Headroom: (interval ≤ 17.5 ms, i.e. a 60 Hz vsync frame, or measured work ≤ 8 ms) AND the step's predicted work
 *   stays ≤ 13 ms, for `upWait` s → scale +0.1, then a tier up (never above the starting tier). A step down within
 *   20 s of a step up doubles `upWait` (5 → 10 → … 80 s), so a GPU-bound scene cannot oscillate.
 * Owner: RND.
 */

export const TIERS = Object.freeze(['low', 'medium', 'high', 'photo'] as const);
export type Tier = (typeof TIERS)[number];
/** Type guard for a tier name (`?quality=` value, saved choice, `set()` argument). */
const isTier = (v: unknown): v is Tier => (TIERS as readonly unknown[]).includes(v);
const SCALE: Record<Tier, number> = { low: 0.75, medium: 1, high: 1, photo: 1 };
const LS_KEY = 'hq.quality';
/** Tunables (exported for the unit test). */
export const AUTO = Object.freeze({ overMs: 20, upMs: 17.5, workOverMs: 12, workIdleMs: 8, workUpMs: 13, overS: 2, upS: 5, upMaxS: 80, bounceS: 20, settle: 90, warmup: 120 });
/** Relative cost of each tier (pass count, AO samples…) for the step-up prediction. */
const TIER_COST: Record<Tier, number> = { low: 0.6, medium: 1, high: 1.25, photo: 1.6 };

/** The slice of CORE's per-frame ctx the auto-scaler reads. */
export interface QualityCtx {
  hidden?: boolean;
  /** loop fps cap (drawer open / fullscreen), 0 / undefined when uncapped */
  fpsCap?: number | null;
  rawDt: number;
  frame: number;
  perf?: { gpuMs?: number | null; cpuMs?: number | null };
}

export interface QualityDebug {
  emaMs: number; workMs: number | null; over: number; under: number; upWait: number; hold: number; capped: boolean; last: string | null;
}

export interface Quality {
  tier: Tier;
  renderScale: number;
  /** false when pinned (`?quality=` or setQuality) */
  auto: boolean;
  set(tier: string): boolean;
  /** auto-scaler hook, once per frame */
  update(ctx: QualityCtx): void;
  onChange(fn: (q: Quality) => void): void;
  debug: QualityDebug;
}

export function createQuality({ pinned = null, storage = true }: { pinned?: string | null; storage?: boolean } = {}): Quality {
  let saved: string | null = null;
  if (storage) { try { saved = localStorage.getItem(LS_KEY); } catch { /* storage blocked */ } }
  const start: Tier = isTier(pinned) ? pinned : isTier(saved) ? saved : 'medium';
  const ceiling = start;
  const fns: Array<(q: Quality) => void> = [];
  const fire = () => { for (const f of fns) { try { f(q); } catch (e) { console.error(e); } } };
  const dbg: QualityDebug = { emaMs: 0, workMs: null, over: 0, under: 0, upWait: AUTO.upS, hold: 0, capped: false, last: null };
  let lastUpAt = -Infinity, t = 0;
  const reset = (hold: number) => { dbg.emaMs = 0; dbg.over = 0; dbg.under = 0; dbg.hold = hold; };
  /** relative GPU cost of (tier, scale) ≈ tier cost × pixel count */
  const cost = (tier: Tier, scale: number) => TIER_COST[tier] * scale * scale;
  const q: Quality = {
    tier: start,
    renderScale: SCALE[start],
    auto: !pinned,
    debug: dbg,
    set(tier) {
      if (!isTier(tier)) return false;
      q.tier = tier;
      q.renderScale = SCALE[tier];
      q.auto = false;
      if (storage) { try { localStorage.setItem(LS_KEY, tier); } catch { /* ignore */ } }
      fire();
      return true;
    },
    update(ctx) {
      if (!q.auto) return;
      // a capped loop (drawer 30 / fullscreen 10 fps) or a hidden tab says nothing about load: forget, then settle
      const capped = !!ctx.hidden || !!ctx.fpsCap;
      if (capped || dbg.capped) { dbg.capped = capped; reset(AUTO.settle); return; }
      const dt = ctx.rawDt;
      if (!(dt > 0) || dt > 0.2) return; // stalls (tab switch, GC) are not load
      t += dt;
      if (ctx.frame < AUTO.warmup) return; // ignore boot / shader compile
      if (dbg.hold > 0) { dbg.hold--; return; } // after a cap lifts or a step: let the EMAs refill
      const ms = dt * 1000;
      dbg.emaMs = dbg.emaMs ? dbg.emaMs + (ms - dbg.emaMs) * 0.05 : ms;
      const p = ctx.perf ?? {};
      const gpu = typeof p.gpuMs === 'number' ? p.gpuMs : null;
      const cpu = typeof p.cpuMs === 'number' && p.cpuMs > 0 ? p.cpuMs : null;
      const work = gpu === null && cpu === null ? null : Math.max(gpu ?? 0, cpu ?? 0);
      dbg.workMs = work;
      // RND fix r2: one rule, as documented above — overload needs the interval AND (no measurement at all, or measured
      // work > 12 ms). A low measured cpuMs without a GPU timer (Electron/Chrome may hide EXT_disjoint_timer_query_webgl2)
      // is evidence that a long interval is a throttled display, not our load, so it no longer ratchets quality down.
      const overloaded = dbg.emaMs > AUTO.overMs && (work === null || work > AUTO.workOverMs);
      // headroom: predicted work of the next step up must still fit a 60 Hz frame
      const next = q.renderScale < SCALE[q.tier] - 1e-6 ? cost(q.tier, Math.min(SCALE[q.tier], q.renderScale + 0.1))
        : TIERS.indexOf(q.tier) < TIERS.indexOf(ceiling) ? cost(TIERS[TIERS.indexOf(q.tier) + 1], Math.max(0.6, SCALE[TIERS[TIERS.indexOf(q.tier) + 1]] - 0.2)) : null;
      const predicted = next === null || gpu === null ? null : gpu * next / cost(q.tier, q.renderScale);
      const fits = predicted === null ? (cpu ?? 0) <= AUTO.workUpMs : predicted <= AUTO.workUpMs && (cpu ?? 0) <= AUTO.workUpMs;
      const headroom = next !== null && fits && (dbg.emaMs <= AUTO.upMs || (work !== null && work <= AUTO.workIdleMs));
      if (overloaded) { dbg.over += dt; dbg.under = 0; } else if (headroom) { dbg.under += dt; dbg.over = 0; } else { dbg.over = 0; dbg.under = 0; }
      if (dbg.over > AUTO.overS) {
        if (q.renderScale > 0.6 + 1e-6) q.renderScale = Math.max(0.6, +(q.renderScale - 0.1).toFixed(2));
        else if (TIERS.indexOf(q.tier) > 0) { q.tier = TIERS[TIERS.indexOf(q.tier) - 1]; q.renderScale = SCALE[q.tier]; }
        else { dbg.over = 0; return; }
        if (t - lastUpAt < AUTO.bounceS) dbg.upWait = Math.min(AUTO.upMaxS, dbg.upWait * 2); // it could not hold the step up
        dbg.last = `down@${t.toFixed(1)}`;
        reset(AUTO.settle);
        fire();
      } else if (dbg.under > dbg.upWait) {
        if (q.renderScale < SCALE[q.tier] - 1e-6) q.renderScale = Math.min(SCALE[q.tier], +(q.renderScale + 0.1).toFixed(2));
        else if (TIERS.indexOf(q.tier) < TIERS.indexOf(ceiling)) { q.tier = TIERS[TIERS.indexOf(q.tier) + 1]; q.renderScale = Math.max(0.6, SCALE[q.tier] - 0.2); }
        else { dbg.under = 0; return; }
        lastUpAt = t;
        dbg.last = `up@${t.toFixed(1)}`;
        reset(AUTO.settle);
        fire();
      }
    },
    onChange(fn) { fns.push(fn); },
  };
  return q;
}
