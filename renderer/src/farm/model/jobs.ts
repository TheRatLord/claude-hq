// @pure
/**
 * Entity → visible farm job, plus the smoother that keeps farmers from twitching between jobs.
 *
 * Agents flip tools every few seconds (read, edit, read, bash, edit…). Showing every flip would make farmers teleport
 * between poses, so the visible job is a time-weighted vote over a sliding window, with a minimum dwell and
 * hysteresis. Attention states (ask, done) cut through quickly because they matter to the player.
 */
import type { Entity, ToolClass } from '../../../../shared/protocol.ts';
import type { Job } from './types.ts';

/** Instantaneous job for an agent entity (not smoothed). */
export function rawJob(e: Pick<Entity, 'status' | 'activity' | 'prompt' | 'subagents'>): Job {
  switch (e.status) {
    case 'blocked': return 'ask';
    case 'done': return 'done';
    case 'idle': return 'idle';
    case 'unknown': return 'away';
    case 'working': break;
  }
  const a = e.activity;
  if (!a) return 'plan'; // working with no tool = thinking / generating
  return clsJob(a.cls);
}

/** The farm job a tool class shows as (for a working agent). */
export function clsJob(cls: ToolClass | null): Job {
  switch (cls) {
    case 'edit': case 'write': return 'plant';
    case 'read': case 'search': return 'inspect';
    case 'test': return 'water';
    case 'bash': case 'build': case 'other': return 'build';
    case 'git': return 'haul';
    case 'net': case 'web': case 'mcp': return 'fetch';
    case 'todo': case 'think': return 'plan';
    case 'talk': return 'talk';
    case 'task': return 'delegate';
    case 'compact': return 'rest';
    case 'ask': return 'ask';
    case null: return 'plan';
  }
  return 'build';
}

/**
 * The tool flavour of the visible job: which tool class inside the job's family the farmer is showing (a read vs a
 * grep inside 'inspect', a web fetch vs an MCP call inside 'fetch'). Sticky: the latest class that belongs to the
 * visible job wins; a class from another family (tool churn the smoother hid) keeps the previous flavour; a job
 * change with nothing matching yet clears it. The scene adds its own dwell so the flavour never flickers.
 */
export function stickyTool(job: Job, cls: ToolClass | null | undefined, prev: ToolClass | null): ToolClass | null {
  if (cls && clsJob(cls) === job) return cls;
  if (prev && clsJob(prev) === job) return prev;
  return null;
}

/** Jobs that pre-empt the vote: they commit after `FAST_S` of holding. */
const FAST = new Set<Job>(['ask', 'done', 'away']);
const FAST_S = 0.4;
/** A work job, once visible, stays at least this long unless pre-empted. */
export const MIN_DWELL_S = 7;
/** Sliding vote window. */
export const WINDOW_S = 14;
/** A challenger must out-weigh the incumbent by this factor. */
const HYSTERESIS = 1.3;
/** Going idle between turns is common: idle must hold this long before the farmer drops tools. */
const IDLE_HOLD_S = 4;

interface Sample { job: Job; t: number }
export interface JobSmoother {
  /** feed the raw job at time `t` (seconds, monotonic); returns the visible job */
  step(raw: Job, t: number): Job;
  readonly job: Job;
  /** seconds (same clock as `step`) when `job` was committed */
  readonly since: number;
}

export function createJobSmoother(initial: Job, t0: number): JobSmoother {
  let job = initial;
  let since = t0;
  let rawSince = t0;
  let lastRaw: Job = initial;
  const samples: Sample[] = [{ job: initial, t: t0 }];
  const commit = (j: Job, t: number) => { if (j !== job) { job = j; since = t; } };

  const weights = (t: number): Map<Job, number> => {
    const w = new Map<Job, number>();
    const from = t - WINDOW_S;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const a = Math.max(s.t, from);
      const b = i + 1 < samples.length ? samples[i + 1].t : t;
      if (b > a) w.set(s.job, (w.get(s.job) ?? 0) + (b - a));
    }
    return w;
  };

  return {
    get job() { return job; },
    get since() { return since; },
    step(raw, t) {
      if (raw !== lastRaw) { lastRaw = raw; rawSince = t; samples.push({ job: raw, t }); }
      while (samples.length > 1 && samples[1].t <= t - WINDOW_S) samples.shift();
      const held = t - rawSince;
      if (raw === job) return job;
      if (FAST.has(raw)) { if (held >= FAST_S) commit(raw, t); return job; }
      // leaving an attention state is also quick: the player just answered / the agent resumed
      if (FAST.has(job)) {
        if (held >= (raw === 'idle' ? FAST_S : FAST_S)) commit(raw, t);
        return job;
      }
      if (raw === 'idle') { if (held >= IDLE_HOLD_S) commit('idle', t); return job; }
      if (job === 'idle') { if (held >= 1) commit(raw, t); return job; }
      if (t - since < MIN_DWELL_S) return job;
      const w = weights(t);
      let best: Job = job, bestW = (w.get(job) ?? 0) * HYSTERESIS;
      for (const [j, v] of w) if (j !== 'idle' && !FAST.has(j) && v > bestW) { best = j; bestW = v; }
      commit(best, t);
      return job;
    },
  };
}

/** How absorbed a farmer is in a job (0 free … 1 heads down). Farmers above 0.6 don't stop to greet. */
export const JOB_BUSY: Readonly<Record<Job, number>> = Object.freeze({
  plant: 0.85, build: 0.85, water: 0.75, inspect: 0.7, plan: 0.65, talk: 0.55, delegate: 0.5, haul: 0.45, fetch: 0.4,
  rest: 0.3, ask: 0, done: 0.1, idle: 0.05, away: 0.9,
});

/** Short subject line for a job, from the activity detail (a basename, a command head). */
export function shortDetail(detail: string | null | undefined, max = 48): string {
  if (!detail) return '';
  let s = detail.replace(/\s+/g, ' ').trim();
  // absolute or relative path → basename (keep one parent dir for context)
  if (/^[~./]?[\w.@-]*\//.test(s) && !s.includes(' ')) {
    const parts = s.split('/').filter(Boolean);
    s = parts.slice(-2).join('/');
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
