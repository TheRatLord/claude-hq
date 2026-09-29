// @pure
/**
 * `__hq.metrics()` (DESIGN §9.1, §6.4.2, §6.5): walking while working, work calls, station trips, vertical traffic,
 * zone visits, queue and overflow peaks. Sampled per actor per frame by actors.ts (and the headless sim).
 * Owner: BRN.
 */

const CALLS_MAX = 512;

/** what the P3 stillness check reads of a slot */
type MetricsSlot = { id?: string } | null | undefined;

/** the per-actor state the metrics read and keep (an actors.ts Actor satisfies it structurally) */
export interface MetricsActor {
  id: string;
  entity: { kind?: string; status?: string; name?: string; process?: { activity?: string } | null };
  pos: { x: number; z: number };
  level?: number;
  moving?: boolean;
  settledAt?: string | null;
  metWalking?: boolean;
  parcelCounted?: boolean;
  p3Slot?: MetricsSlot;
  p3Act?: string | null;
  p3Since?: number;
  p3Cand?: MetricsSlot;
  p3CandAct?: string | null;
  p3CandT?: number;
  p3Over?: boolean;
}

/** the slice of a brain intent the metrics read */
export interface MetricsIntent {
  slot?: MetricsSlot;
  activity?: string | null;
  phase?: string | null;
}

export interface MetricsOptions {
  zoneAt?: (x: number, z: number, level: number) => string | null;
  info?: () => { queueLen?: number; overflowUsed?: number } | null | undefined;
}

export interface MetricCounts {
  stationTrips: number; slideRides: number; stairClimbs: number; stairDescents: number; parcelRuns: number;
  /** counted by actors.ts on the first crowd jam (absent until then) */
  crowdJams?: number;
}

export interface MetricsReading extends MetricCounts {
  walkWhileWorkingPct: number;
  workCallPct: number;
  workCallS: { p50: number; p90: number; n: number };
  zoneVisits: Record<string, number>;
  queueMax: number; overflowUsed: number;
  avgTravelS: number; walkLegs: number; workCalls: number;
  workS: number; elapsedS: number;
  occupancyPct: Record<string, number>;
  p3: { maxStillS: number; worst: string; over60: number; recent: string[] };
}

export interface Metrics {
  count(k: keyof MetricCounts): void;
  frame(frameId: number, dt: number): void;
  sample(a: MetricsActor, intent: MetricsIntent, dt: number): void;
  forget(id: string): void;
  rekey(oldId: string, newId: string): void;
  sizes(): { zoneOf: number; inCall: number; calls: number };
  read(): MetricsReading;
  reset(): true;
}

export function createMetrics(o: MetricsOptions = {}): Metrics {
  let workS = 0, walkWorkS = 0, callS = 0, travelS = 0, trips = 0, legs = 0, elapsedS = 0;
  // work-call durations: a bounded ring (the latest CALLS_MAX calls), so a long session's metrics stay O(1)
  const calls = new Float64Array(CALLS_MAX);
  let callN = 0;
  const pushCall = (v: number) => { calls[callN % CALLS_MAX] = v; callN++; };
  const inCall = new Map<string, number>();
  const counts: MetricCounts = { stationTrips: 0, slideRides: 0, stairClimbs: 0, stairDescents: 0, parcelRuns: 0 };
  let zoneVisits: Record<string, number> = {};
  const zoneOf = new Map<string, string>();
  let queueMax = 0, overflowUsed = 0;
  let lastFrame = -1;
  // [BRN fix m2-r3] (gameplay review m2-r3: occupancy counted a slot as occupied while its agent was still walking to
  // it) settled dwell per zone: seconds with ≥ 1 agent settled (arrived, not moving) there; and the P3 'nothing static
  // for 60 s' check: per idle / shell actor, how long its (slot, activity) stayed the same while settled. A change
  // counts once it holds ≥ STILL_BLIP_S (a 2 s fidget is texture, not a new activity).
  let occS: Record<string, number> = {};
  const occFrame = new Set<string>();
  const over60Recent: string[] = [];
  let stillMax = 0, stillOver60 = 0, worstName = '', worstSlot = '', worstAct: string | null | undefined = null;
  const STILL_BLIP_S = 5;
  /** P3 stillness of one idle / shell actor (state on the actor: no per-frame allocation) */
  function p3(a: MetricsActor, intent: MetricsIntent, settled: boolean) {
    const e = a.entity;
    // idle agents and Shellys at `prompt` (a busy Shelly's loop is its process signal, like a working agent's typing)
    const idle = e.kind === 'shell' ? (e.process?.activity ?? 'prompt') === 'prompt' : e.status === 'idle';
    const slot = intent.slot ?? null, act = intent.activity ?? null;
    if (!idle || !settled) { a.p3Slot = undefined; a.p3Cand = undefined; return; }
    const t = elapsedS;
    if (a.p3Slot === undefined || (a.p3Since ?? 0) > t) { // (first settled frame, or the metrics were reset)
      a.p3Slot = slot; a.p3Act = act; a.p3Since = t; a.p3Cand = undefined; a.p3Over = false; return; }
    if (slot === a.p3Slot && act === a.p3Act) a.p3Cand = undefined;
    else if (a.p3Cand !== slot || a.p3CandAct !== act) { a.p3Cand = slot; a.p3CandAct = act; a.p3CandT = t; }
    else if (t - (a.p3CandT ?? 0) >= STILL_BLIP_S) { a.p3Slot = slot; a.p3Act = act; a.p3Since = a.p3CandT ?? 0; a.p3Cand = undefined; a.p3Over = false; }
    const run = (a.p3Cand !== undefined ? a.p3CandT ?? 0 : t) - (a.p3Since ?? 0); // (a pending change ends the run where it began)
    if (run > stillMax) { stillMax = run; worstName = e.name ?? a.id; worstSlot = a.p3Slot?.id ?? '-'; worstAct = a.p3Act; }
    if (run > 60 && !a.p3Over) {
      a.p3Over = true; stillOver60++;
      if (over60Recent.length >= 8) over60Recent.shift();
      over60Recent.push(`${e.name ?? a.id}:${a.p3Slot?.id ?? '-'}/${a.p3Act}@${Math.round(a.p3Since ?? 0)}s`);
    }
  }
  return {
    count(k: keyof MetricCounts) { counts[k] = (counts[k] ?? 0) + 1; },
    /** once per frame (actor-independent peaks) */
    frame(frameId: number, dt: number) {
      if (frameId === lastFrame) return;
      lastFrame = frameId;
      elapsedS += dt;
      for (const z of occFrame) occS[z] = (occS[z] ?? 0) + dt;
      occFrame.clear();
      const inf = o.info?.();
      if (inf) { queueMax = Math.max(queueMax, inf.queueLen ?? 0); overflowUsed = Math.max(overflowUsed, inf.overflowUsed ?? 0); }
    },
    /** per actor per frame */
    sample(a: MetricsActor, intent: MetricsIntent, dt: number) {
      const working = a.entity.status === 'working';
      if (working) { workS += dt; if (a.moving) walkWorkS += dt; }
      // [BRN fix m2-r1] avgTravelS = mean walk-leg duration: travel time over walk legs (a leg starts when an actor
      // starts moving). It used to divide all actors' travel time by the number of *work calls* (188 s "average").
      if (a.moving) { travelS += dt; if (!a.metWalking) legs++; }
      a.metWalking = !!a.moving;
      if (intent.phase === 'workCall') { callS += dt; inCall.set(a.id, (inCall.get(a.id) ?? 0) + dt); }
      else if (inCall.has(a.id)) { pushCall(inCall.get(a.id) ?? 0); inCall.delete(a.id); trips++; }
      if (intent.phase === 'parcelRun' && a.settledAt && !a.parcelCounted) { a.parcelCounted = true; counts.parcelRuns++; }
      else if (intent.phase !== 'parcelRun') a.parcelCounted = false;
      const settled = !!a.settledAt && !a.moving;
      p3(a, intent, settled);
      if (o.zoneAt) {
        const z = o.zoneAt(a.pos.x, a.pos.z, a.level ?? 0);
        if (z && settled) occFrame.add(z);
        const prev = zoneOf.get(a.id);
        if (z && z !== prev) {
          if (prev !== undefined) zoneVisits[z] = (zoneVisits[z] ?? 0) + 1;
          zoneOf.set(a.id, z);
        }
      }
    },
    /** an actor left: drop its per-actor state (an unfinished call is not a call) */
    forget(id: string) { zoneOf.delete(id); inCall.delete(id); },
    /** an actor was re-keyed (same Clawd, new pane id): carry its per-actor state over */
    rekey(oldId: string, newId: string) {
      const z = zoneOf.get(oldId);
      if (z !== undefined) { zoneOf.set(newId, z); zoneOf.delete(oldId); }
      const c = inCall.get(oldId);
      if (c !== undefined) { inCall.set(newId, c); inCall.delete(oldId); }
    },
    /** debug / tests: per-actor map sizes (must track the live actor count, §9.1 churn soak) */
    sizes: () => ({ zoneOf: zoneOf.size, inCall: inCall.size, calls: Math.min(callN, CALLS_MAX) }),
    read() {
      const s = Array.from(calls.subarray(0, Math.min(callN, CALLS_MAX))).sort((x, y) => x - y);
      const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
      return {
        walkWhileWorkingPct: workS ? (100 * walkWorkS) / workS : 0,
        workCallPct: workS ? (100 * callS) / workS : 0,
        workCallS: { p50: q(0.5), p90: q(0.9), n: s.length },
        ...counts,
        zoneVisits: { ...zoneVisits }, queueMax, overflowUsed,
        avgTravelS: legs ? travelS / legs : 0, walkLegs: legs, workCalls: trips,
        workS, elapsedS,
        // [BRN fix m2-r3] % of elapsed time with ≥ 1 agent settled in the zone; P3 stillness (idle + shell actors)
        occupancyPct: Object.fromEntries(Object.entries(occS).map(([z, v]) => [z, elapsedS ? Math.round((1000 * v) / elapsedS) / 10 : 0])),
        p3: { maxStillS: Math.round(stillMax * 10) / 10, worst: stillMax ? `${worstName}:${worstSlot}/${worstAct}` : '', over60: stillOver60, recent: [...over60Recent] },
      };
    },
    reset() {
      workS = walkWorkS = callS = travelS = elapsedS = 0; trips = 0; legs = 0; callN = 0; inCall.clear();
      counts.stationTrips = counts.slideRides = counts.stairClimbs = counts.stairDescents = counts.parcelRuns = 0;
      if (counts.crowdJams !== undefined) counts.crowdJams = 0;
      zoneVisits = {}; queueMax = 0; overflowUsed = 0;
      occS = {}; occFrame.clear(); stillMax = 0; stillOver60 = 0; worstName = ''; over60Recent.length = 0;
      return true;
    },
  };
}
