// @pure
/**
 * Stations without dishonest commutes (DESIGN §6.5): the dominant-phase tracker + the 2× rule.
 *
 * - `activity.cls` is sampled at 1 Hz into a rolling 40 s window, grouped by **phase key** (read+search share the
 *   Library, test+build the Lab, todo+think the War Room): a key with ≥ 60 % of the window (≥ `minSamples` seen)
 *   becomes the dominant phase; it ends when its share stays < 40 % for 10 s, or when the status leaves `working`.
 *   Short interjections (a 3 s Edit in a read phase) never move anybody.
 * - `E[len]` per key is an EMA of completed phase lengths, seeded with the §6.5 priors.
 * - Go only if `E − elapsed ≥ 2 × travel` (travel = path / 2.0 m/s, the caller's cached number), and never within
 *   `cooldownS` of the end of the previous visit (cooldown).
 * - [BRN fix m2-r1] Walk budget: the §6.5 acceptance is a *share* (`walkWhileWorkingPct ≤ 20`), and the 2× rule alone
 *   lets one early mezzanine trip (2 × 20 s of walking against a 40 s stay) blow a small office's share (trio 31 % over
 *   100 s). The tracker keeps this actor's own working / walking-while-working seconds (`account`) and a trip must keep
 *   `walked + 2 × travel ≤ walkBudget × (worked + graceS + remaining)`, and none before `minWorkS` of working: stations
 *   stay honest *and* cheap, and the budget leaves headroom for work calls and the unblock scurry (not optional).
 * Owner: BRN.
 */

/** ToolClass → phase key (a station), or null = desk-only class. */
export const PHASE_KEY: Readonly<Record<string, string>> = Object.freeze({
  read: 'read', search: 'read', test: 'test', build: 'test', todo: 'plan', think: 'plan', web: 'web', task: 'task',
  mcp: 'mcp', git: 'git',
});
/** Phase key → station id (layout.stations[].id). */
export const KEY_STATION: Readonly<Record<string, string>> = Object.freeze({
  read: 'library', test: 'lab', plan: 'war', web: 'observatory', task: 'roundtable', mcp: 'phones', git: 'mail',
});
/** §6.5 priors for E[phase length] (s). */
export const PRIORS_S: Readonly<Record<string, number>> = Object.freeze({ read: 45, test: 45, web: 40, task: 120, plan: 25, mcp: 25, git: 10 });

export const PHASE = Object.freeze({
  windowS: 40, enter: 0.6, exit: 0.4, exitHoldS: 10, minSamples: 10, ratio: 2, cooldownS: 90, ema: 0.5,
  walkBudget: 0.3, graceS: 0, minWorkS: 90, // [BRN fix m2-r1] per-actor walk budget (see above); cooldown 60 → 90 s
});

export type PhaseConfig = { [K in keyof typeof PHASE]: number };

export interface PhaseTracker {
  /** call every frame while working (samples at 1 Hz) */
  sample(cls: string | null, nowMs: number): void;
  /** status left `working`: close the phase */
  stop(nowMs: number): void;
  /** current dominant phase key */
  key(): string | null;
  /** age of the current phase */
  elapsedS(nowMs: number): number;
  /** E[phase length] (s) for a key */
  expectS(k?: string | null): number;
  /** the 2× rule (+ cooldown, skipped when chaining station → station) for the current phase */
  worthTrip(travelS: number, nowMs: number, chain?: boolean): boolean;
  /** starts the cooldown */
  visitEnded(nowMs: number): void;
  /** a working frame: its length and whether it walked */
  account(dtS: number, moving: boolean): void;
  debug(): { key: string | null; n: number; workS: number; walkS: number; shares: Record<string, number>; ema: Record<string, number> };
}

export function createPhaseTracker(o: Partial<PhaseConfig> = {}): PhaseTracker {
  const P = { ...PHASE, ...o };
  const N = P.windowS;
  const ring: (string | null)[] = new Array(N).fill(null);
  let n = 0, head = 0, lastSec = -Infinity;
  let cur: string | null = null;
  let startMs = 0, lowSinceMs = -1, cooldownUntil = -Infinity;
  let workS = 0, walkS = 0; // this actor's working seconds / of them walking (the walk budget)
  const ema: Record<string, number> = { ...PRIORS_S };
  const counts = new Map<string, number>();

  const share = (k: string) => (n ? (counts.get(k) ?? 0) / n : 0);
  const push = (k: string | null) => {
    if (n === N) { const old = ring[head]; if (old) counts.set(old, (counts.get(old) ?? 0) - 1); } else n++;
    ring[head] = k;
    head = (head + 1) % N;
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  const close = (nowMs: number) => {
    if (!cur) return;
    const len = (nowMs - startMs) / 1000;
    if (len > 2) ema[cur] = (1 - P.ema) * (ema[cur] ?? len) + P.ema * len;
    cur = null; lowSinceMs = -1;
  };
  const reset = () => { ring.fill(null); counts.clear(); n = 0; head = 0; };

  return {
    sample(cls, nowMs) {
      const sec = Math.floor(nowMs / 1000);
      if (sec <= lastSec) return; // same second, or the clock stepped back (skew correction): nothing new
      // fill skipped seconds with the current class (a frame hitch or a hidden tab), at most a full window
      const steps = lastSec === -Infinity ? 1 : Math.min(N, Math.max(1, sec - lastSec));
      lastSec = sec;
      const k = (cls && PHASE_KEY[cls]) || null;
      for (let i = 0; i < steps; i++) push(k);
      if (cur) {
        if (share(cur) < P.exit) {
          if (lowSinceMs < 0) lowSinceMs = nowMs;
          if (nowMs - lowSinceMs >= P.exitHoldS * 1000) close(nowMs);
        } else lowSinceMs = -1;
      }
      if (!cur && n >= P.minSamples) {
        let best: string | null = null, bs = 0;
        for (const [key, c] of counts) if (c / n > bs) { bs = c / n; best = key; }
        if (best && bs >= P.enter) {
          cur = best;
          startMs = nowMs - bs * n * 1000; // the phase began about when its samples started piling up
          lowSinceMs = -1;
        }
      }
    },
    stop(nowMs) { close(nowMs); reset(); lastSec = -Infinity; },
    key: () => cur,
    elapsedS: (nowMs) => (cur ? (nowMs - startMs) / 1000 : 0),
    expectS: (k = cur) => (k ? ema[k] ?? 30 : 0),
    worthTrip(travelS, nowMs, chain = false) {
      if (!cur || (!chain && nowMs < cooldownUntil)) return false;
      const remaining = (ema[cur] ?? 30) - (nowMs - startMs) / 1000;
      if (remaining < P.ratio * travelS) return false;
      if (workS < P.minWorkS) return false; // a fresh actor settles in first (one early trip was a small office's whole share)
      return walkS + 2 * travelS <= P.walkBudget * (workS + P.graceS + Math.max(0, remaining));
    },
    visitEnded(nowMs) { cooldownUntil = nowMs + P.cooldownS * 1000; },
    account(dtS, moving) { if (!(dtS > 0)) return; workS += dtS; if (moving) walkS += dtS; },
    debug: () => ({ key: cur, n, workS: Math.round(workS), walkS: Math.round(walkS), shares: Object.fromEntries([...counts].map(([k, c]) => [k, +(c / Math.max(1, n)).toFixed(2)])), ema: { ...ema } }),
  };
}
