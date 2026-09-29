// @pure
/**
 * Capacity & overflow (DESIGN §6.4, §6.4.4) for the full office: a pure function of the entity set (+ the previous
 * assignment for stickiness) → every actor's home and pin. No three.js, no nav calls at allocation time (the spiral
 * overflow spots are generated once from the layout with a `free(x, z, level)` predicate).
 *
 * Homes
 * - agents: bay = `BAY_ORDER[workspace.slot]` (layout.bays is in BAY_ORDER; pod index = order index) when free; a
 *   bay held last time stays (same slot); workspaces left without one (slot ≥ 6 after churn, or whose bay a sticky
 *   workspace holds) take the free bays in slot order. Desks in `(tab.index, paneIndex, id)` order, sticky while the
 *   desk stays in the workspace's own bays. A workspace with > 6 agents takes the nearest free bay as an annex
 *   (annexes resolved in slot order); anything left over goes to the overflow chain: mezzanine hot desks 8 → Reading
 *   Alley laptop benches 6 → Library floor-cushion spiral.
 * - shells: ENG benches 10 → rack-wall standing spots 8 → ENG spiral (same canonical order, sticky).
 * Pins (sorted by `(statusSince, id)`)
 * - blocked ≥ `blockedChairMs`: queue lane 10 → overflow rug 6 → none (waits at its desk standing on the chair, "queue
 *   full"; the brain shows it).
 * - done, not acked: Pit seats 24 (oldest nearest the south gap) → Pit floor spiral → atrium spiral.
 * Owner: BRN.
 */

import { inViewCone, VIEW_CONE } from '../../world/nav/grid.ts';
import type { Entity } from '../../../../shared/protocol.ts';
import type { HqLayout, KeepClearView, Slot } from '../../world/layout/schema.ts';

interface P2 { x: number; z: number }

/** Body width 0.72 m + a clear gap (review r3: overflow bodies never overlap). */
export const SPIRAL_PITCH = 0.95;

const cmpId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const since = (e: { statusSince?: number }) => (typeof e.statusSince === 'number' ? e.statusSince : 0);
export const cmpSince = (a: Entity, b: Entity) => since(a) - since(b) || cmpId(a, b);
/** Canonical pane order: workspace slot → tab → pane → id. */
export const canon = (a: Entity, b: Entity) => (a.workspace?.slot ?? 0) - (b.workspace?.slot ?? 0) || (a.tab?.index ?? 0) - (b.tab?.index ?? 0)
  || (a.paneIndex ?? 0) - (b.paneIndex ?? 0) || cmpId(a, b);

export interface SpiralOpts { pitch?: number; avoid?: P2[]; maxR?: number; face?: P2 }
export interface SpiralSpot { x: number; z: number; yaw: number }

/**
 * Deterministic overflow spots on an Archimedean spiral around `anchor` (arc step = pitch, ring gap = pitch), skipping
 * cells `free` rejects and anything within `pitch` of an already placed spot or of `avoid` points.
 */
export function spiral(anchor: P2, n: number, free: (x: number, z: number) => boolean, o: SpiralOpts = {}): SpiralSpot[] {
  const pitch = o.pitch ?? SPIRAL_PITCH, maxR = o.maxR ?? 9;
  const avoid = o.avoid ?? [];
  const out: SpiralSpot[] = [];
  const ok = (x: number, z: number) => free(x, z)
    && out.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= pitch * pitch)
    && avoid.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= pitch * pitch * 0.8);
  const b = pitch / (2 * Math.PI);
  let th = 0;
  const face = o.face ?? anchor;
  const push = (x: number, z: number) => {
    const dx = face.x - x, dz = face.z - z;
    out.push({ x, z, yaw: Math.hypot(dx, dz) > 0.2 ? Math.atan2(-dx, -dz) : 0 });
  };
  if (ok(anchor.x, anchor.z)) push(anchor.x, anchor.z);
  while (out.length < n) {
    const r = b * th;
    if (r > maxR) break;
    th += Math.max(0.05, pitch / Math.max(r, pitch)); // ≈ one pitch of arc per step
    const x = anchor.x + r * Math.sin(th), z = anchor.z - r * Math.cos(th);
    if (ok(x, z)) push(x, z);
  }
  return out;
}

/**
 * Precomputed capacity tables of a full-office layout (hq.ts shape). `free`: open floor for a standing body (spirals).
 */
export interface CapacityPlan {
  bays: { id: string; index: number; desks: Slot[]; center: P2 }[];
  /** [BRN fix m3-r2] slots in a view's 3 m near field */
  inView: Set<string>;
  hot: Slot[];
  alley: Slot[];
  cushions: Slot[];
  benches: Slot[];
  rack: Slot[];
  engSpiral: Slot[];
  queue: Slot[];
  queueOverflow: Slot[];
  pit: Slot[];
  pitSpiral: Slot[];
  atriumSpiral: Slot[];
}
export function capacityPlan(layout: HqLayout, free: (x: number, z: number, level: number) => boolean): CapacityPlan {
  const byId = new Map(layout.slots.map((s): [string, Slot] => [s.id, s]));
  // [BRN fix m3-r2] (art review m3-r2: lumen, homed on hot desk 7, was a giant orange blob 1.5 m in front of the mezz
  // camera) a home inside an authored view's 3 m near field goes last in its chain: used only when all else is taken
  const views = layout.keepClearViews ?? [];
  // (less 1 cm: the engine pose frames shell benches 0–1 at 2.997 m by design, layout.test 'hq engine pose')
  const inView = (s: Slot) => views.some((v) => (v.level ?? 0) === (s.level ?? 0) && inViewCone(v, s.pos.x, s.pos.z, VIEW_CONE.r - 0.01));
  const viewLast = (list: Slot[]) => [...list.filter((s) => !inView(s)), ...list.filter(inView)];
  const tagged = (t: string) => viewLast(layout.slots.filter((s) => s.tag === t).sort((a, b) => num(a.id) - num(b.id) || cmpId(a, b)));
  const bays = layout.bays.map((b, i) => ({ id: b.id, index: i, desks: b.desks.flatMap((id) => byId.get(id) ?? []), center: rectC(b.rect) }));
  const pts = layout.points;
  const ov: Partial<HqLayout['points']['overflow']> = pts.overflow ?? {};
  const avoidAll = layout.slots.map((s) => s.pos);
  const mk = (tag: string, list: SpiralSpot[], level: number, prefix: string): Slot[] => list.map((p, i) => ({ id: `${prefix}:${i}`, tag, pos: { x: p.x, y: 0, z: p.z }, yaw: p.yaw, pose: 'stand', level }));
  const sp = (key: keyof HqLayout['points']['overflow'], n: number, level: number, tag: string, face?: P2): Slot[] => {
    const anchor = ov[key];
    return anchor
    ? mk(tag, spiral(anchor, n, (x, z) => free(x, z, level), { avoid: avoidAll, face }), level, `spiral:${key}`)
    : [];
  };
  return {
    bays,
    inView: new Set(layout.slots.filter(inView).map((q) => q.id)), // [BRN fix m3-r2] slots in a view's 3 m near field
    hot: tagged('hotdesk'),
    alley: tagged('alleyBench'),
    cushions: sp('library', 24, 0, 'cushion'),
    benches: tagged('shellBench'),
    rack: tagged('rackSpot'),
    engSpiral: sp('eng', 48, 0, 'engStand'),
    queue: tagged('queue'),
    queueOverflow: tagged('queueOverflow'),
    // the sofa ring first (it reads as "lounging" from every pose), then the step seats, then the beanbags; within each,
    // [BRN fix m3-r2] the seats facing the hero views first (fun review m3-r2: the Pit's 1–2 sitters sat on the near arc
    // with their backs to pitOverview in every hour): the far arc, faces toward the atrium camera and the spawn
    pit: ['sofa', 'pitStep', 'beanbag'].flatMap((t) => (pts.pitSeats ?? []).flatMap((id) => { const s = byId.get(id); return s && s.tag === t ? [s] : []; })
      .map((s, i): [Slot, number] => [s, heroFacing(s, views) - i * 1e-6]).sort((a, b) => b[1] - a[1]).map((q) => q[0])),
    pitSpiral: sp('pit', 16, 0, 'pitStand', pts.pitCenter),
    atriumSpiral: sp('atrium', 24, 0, 'atriumStand', pts.pitCenter),
  };
}
/** How squarely a seat faces the Pit's hero views (pitOverview, then the spawn): Σ weight × cos(seat facing, seat → lens). */
const HERO: readonly (readonly [string, number])[] = [['pitOverview', 1], ['spawn', 0.5]];
function heroFacing(s: Slot, views: readonly KeepClearView[]): number {
  let v = 0;
  const fx = -Math.sin(s.yaw ?? 0), fz = -Math.cos(s.yaw ?? 0);
  for (const [id, w] of HERO) {
    const c = views.find((q) => q.id === id);
    if (!c) continue;
    const dx = c.x - s.pos.x, dz = c.z - s.pos.z, d = Math.hypot(dx, dz) || 1;
    v += w * (fx * dx + fz * dz) / d;
  }
  return v;
}
const num = (s: string) => { const m = /(\d+)\D*$/.exec(s); return m ? +m[1] : 0; };
const rectC = (r: readonly number[]): P2 => ({ x: (r[0] + r[2]) / 2, z: (r[1] + r[3]) / 2 });

export interface Allocation {
  /** actor id → home slot (desk / hot desk / bench / overflow spot) */
  home: Map<string, Slot>;
  /** actor id → bay id whose desk it holds (own or annex) */
  bayOf: Map<string, string | undefined>;
  /** workspace id → bay ids it occupies (primary first) */
  wsBays: Map<string, string[]>;
  /** workspace id → slot + bays (pass back as `prevWs`) */
  wsState: Map<string, WsState>;
  /** homes outside the bays / ENG benches */
  overflowUsed: number;
}
export interface WsState { slot: number; bays: string[] }

/**
 * Homes (desks, benches, overflow) — a pure function of the entity set, sticky via `prev` (id → slot id).
 * `prevWs`: the previous result's `wsState` (bay stickiness).
 */
export function allocateHomes(ents: Entity[], plan: CapacityPlan, prev: Map<string, string> = new Map(), prevWs: Map<string, WsState> | null = null): Allocation {
  const home = new Map<string, Slot>(), bayOf = new Map<string, string | undefined>(), wsBays = new Map<string, string[]>();
  const taken = new Set<string>();
  let overflowUsed = 0;
  const agents = ents.filter((e) => e.kind !== 'shell').sort(canon);
  const shells = ents.filter((e) => e.kind === 'shell').sort(canon);

  // ---- agents: workspaces → bays
  const byWs = new Map<string, { slot: number; list: Entity[] }>();
  for (const e of agents) {
    const k = e.workspace?.id ?? `slot${e.workspace?.slot ?? 0}`;
    let w = byWs.get(k);
    if (!w) byWs.set(k, (w = { slot: e.workspace?.slot ?? 0, list: [] }));
    w.list.push(e);
  }
  const wss = [...byWs.entries()].sort((a, b) => a[1].slot - b[1].slot || (a[0] < b[0] ? -1 : 1));
  const B = plan.bays.length;
  const bayIdx = new Map(plan.bays.map((b, i): [string, number] => [b.id, i]));
  const owned = new Map<number, string>(); // bay index → ws key
  const primary = new Map<string, number>(); // ws key → bay index
  const own = (k: string, i: number) => { owned.set(i, k); primary.set(k, i); wsBays.set(k, [plan.bays[i].id]); };
  // [BRN fix r2] bays after workspace churn (review r2: slots {5, 7, 17, 21, 30, 33} left 5 of 6 bays as amenities
  // while 8 agents sat on hot desks). A bay whose slot has no live workspace is free: live workspaces keep the bay they
  // held while their slot is unchanged (1), take their own `BAY_ORDER[slot]` when free (2), and the rest — slot ≥ 6, or
  // a returning workspace whose bay a sticky one holds — take free bays in slot order before the hot-desk overflow (3).
  for (const [k, w] of wss) { // 1) sticky
    const p = prevWs?.get(k);
    const i = p && p.slot === w.slot ? bayIdx.get(p.bays?.[0]) : undefined;
    if (i !== undefined && !owned.has(i)) own(k, i);
  }
  for (const [k, w] of wss) if (!primary.has(k) && w.slot >= 0 && w.slot < B && !owned.has(w.slot)) own(k, w.slot); // 2)
  const nearestFree = (c0: P2 | null) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < B; i++) {
      if (owned.has(i)) continue;
      const d = c0 ? Math.hypot(plan.bays[i].center.x - c0.x, plan.bays[i].center.z - c0.z) + i * 1e-6 : i; // no anchor: BAY_ORDER
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  for (const [k, w] of wss) { // 3) the rest, in slot order: a returning workspace next to its own bay, others E bays first
    if (primary.has(k)) continue;
    const i = nearestFree(w.slot >= 0 && w.slot < B ? plan.bays[w.slot].center : null);
    if (i < 0) break;
    own(k, i);
  }
  // annexes: workspaces with more agents than their bay seats, in slot order, nearest free bay
  for (const [k, w] of wss) {
    const mine = wsBays.get(k);
    if (!mine) continue;
    let need = w.list.length - mine.length * 6;
    const pi = primary.get(k);
    if (pi === undefined) continue;
    const c0 = plan.bays[pi].center;
    while (need > 0) {
      const best = nearestFree(c0);
      if (best < 0) break;
      owned.set(best, k);
      mine.push(plan.bays[best].id);
      need -= 6;
    }
  }
  const rest: Entity[] = [];
  for (const [k, w] of wss) {
    const bayIds = wsBays.get(k);
    if (!bayIds) { rest.push(...w.list); continue; }
    const desks = bayIds.flatMap((id) => plan.bays.find((b) => b.id === id)?.desks ?? []);
    const deskBay = new Map(desks.map((s): [string, string | undefined] => [s.id, s.bay ?? bayIds.find((id) => s.id.includes(`:${id}:`))]));
    const left: Entity[] = [];
    for (const e of w.list) { // 1) sticky inside this workspace's own bays
      const p = prev.get(e.id);
      const s = p ? desks.find((d) => d.id === p) : undefined;
      if (s && !taken.has(s.id)) { taken.add(s.id); home.set(e.id, s); bayOf.set(e.id, deskBay.get(s.id)); } else left.push(e);
    }
    for (const e of left) { // 2) first free desk in (tab, pane) order
      const s = desks.find((d) => !taken.has(d.id));
      if (s) { taken.add(s.id); home.set(e.id, s); bayOf.set(e.id, deskBay.get(s.id)); } else rest.push(e);
    }
  }
  // ---- overflow chain: hot desks → alley benches → library cushions (sticky, then canonical)
  // ([BRN fix m3-r2] the hot desks inside a view's near field — 5–7, in the mezz frame — after the alley benches)
  const hotOk = plan.hot.filter((q) => !plan.inView?.has(q.id)), hotView = plan.hot.filter((q) => plan.inView?.has(q.id));
  const chain = [...hotOk, ...plan.alley, ...hotView, ...plan.cushions];
  overflowUsed += fill(rest.sort(canon), chain, home, taken, prev);
  // ---- shells: benches → rack spots → ENG spiral
  const sChain = [...plan.benches, ...plan.rack, ...plan.engSpiral, ...plan.cushions, ...plan.atriumSpiral]; // ENG first, always
  const benchN = plan.benches.length;
  const placed = fill(shells, sChain, home, taken, prev);
  overflowUsed += Math.max(0, placed - benchN);
  const wsState = new Map([...wsBays].map(([k, bays]): [string, WsState] => [k, { slot: byWs.get(k)?.slot ?? 0, bays: [...bays] }]));
  return { home, bayOf, wsBays, wsState, overflowUsed };
}

/** Sticky-then-first-free fill of `list` into `slots`. Returns how many were placed. */
function fill(list: Entity[], slots: Slot[], home: Map<string, Slot>, taken: Set<string>, prev: Map<string, string>): number {
  let n = 0;
  const left: Entity[] = [];
  for (const e of list) {
    const p = prev.get(e.id);
    const s = p ? slots.find((q) => q.id === p) : undefined;
    if (s && !taken.has(s.id)) { taken.add(s.id); home.set(e.id, s); n++; } else left.push(e);
  }
  let k = 0;
  for (const e of left) {
    while (k < slots.length && taken.has(slots[k].id)) k++;
    if (k >= slots.length) break;
    taken.add(slots[k].id); home.set(e.id, slots[k]); n++;
  }
  return n;
}

/** [BRN fix m2-r1] Single-file pitch for a short queue (m, centre to centre of consecutive places). */
export const QUEUE_PITCH = 1.1;
const spaced = new WeakMap<CapacityPlan, Slot[]>();
/**
 * [BRN fix m2-r1] The lane places a short queue uses (gameplay review m2: 4 blocked agents stood as a 2×2 blob at the
 * counter, 1.0 m apart, and jostled): walking the serpentine from the head, every place at least QUEUE_PITCH from the
 * previous one taken (on the hq lane: every other place, 1.41 m apart, so a short queue stretches single file through
 * the whole roped lane). A longer queue uses every lane place (1.0 m pitch, §7.1).
*/
export function spacedLane(plan: CapacityPlan): Slot[] {
  let v = spaced.get(plan);
  if (!v) {
    const lane: Slot[] = (v = []);
    for (const s of plan.queue) {
      const p = lane[lane.length - 1];
      if (!p || Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z) >= QUEUE_PITCH - 1e-6) lane.push(s);
    }
    spaced.set(plan, v);
  }
  return v;
}

/**
 * Pins (help queue + Pit) — a pure function of entities + now (+ the previous queue order).
 * Queue order is sticky ([BRN fix r1]): whoever already stands in the queue keeps its place (moving up as the head is
 * served); newcomers join at the back in `statusSince` order. Without `prevQueue` (a cold start, a second window) the
 * order is plain `statusSince` — the same thing whenever statusSince order equals arrival order, which it does except
 * when a statusSince jumps (a forced / re-seeded status): then the newcomer must not cut in and bump the queue.
 * `prevQueue`: ids of the previous queue, head first. `o` ([BRN fix m3-r2]): `prev` = the previous pins: a done
 * agent keeps its Pit seat (no reshuffle when a lounger leaves: tinker slid into the seat 0.5 m from the camera);
 * `avoid(slot)` = a seat nobody new is given (the player's personal space).
 */
export interface PinOpts { prev?: Map<string, Slot>; avoid?: (s: Slot) => boolean }
export interface PinAllocation { pins: Map<string, Slot>; queueLen: number; queueFull: string[]; overflowUsed: number; queueOrder: string[] }
export function allocatePins(ents: Entity[], plan: CapacityPlan, now: number, blockedMs: number, prevQueue: string[] | null = null, o: PinOpts = {}): PinAllocation {
  const pins = new Map<string, Slot>();
  const blocked: Entity[] = [], done: Entity[] = [];
  for (const e of ents) {
    if (e.kind === 'shell') continue;
    if (e.status === 'blocked' && now - since(e) >= blockedMs) blocked.push(e);
    else if (e.status === 'done' && !e.ack) done.push(e);
  }
  blocked.sort(cmpSince);
  if (prevQueue?.length) {
    const rank = new Map(prevQueue.map((id, i): [string, number] => [id, i]));
    blocked.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || cmpSince(a, b));
  }
  done.sort(cmpSince);
  const qs = [...(blocked.length <= spacedLane(plan).length ? spacedLane(plan) : plan.queue), ...plan.queueOverflow];
  const queueFull: string[] = [];
  blocked.forEach((e, i) => { if (i < qs.length) pins.set(e.id, qs[i]); else queueFull.push(e.id); });
  const ps = [...plan.pit, ...plan.pitSpiral, ...plan.atriumSpiral];
  if (!o.prev && !o.avoid) done.forEach((e, i) => { if (i < ps.length) pins.set(e.id, ps[i]); });
  else {
    // sticky: a done agent keeps the Pit place it holds; newcomers take the first free place in order (none the player
    // stands next to, unless nothing else is left)
    const taken = new Set<string>(), left: (Entity | null)[] = [];
    for (const e of done) {
      const p = o.prev?.get(e.id);
      if (p && !taken.has(p.id) && ps.includes(p)) { taken.add(p.id); pins.set(e.id, p); } else left.push(e);
    }
    for (const pass of [true, false]) {
      let k = 0;
      for (let i = 0; i < left.length; i++) {
        const e = left[i];
        if (!e) continue;
        while (k < ps.length && (taken.has(ps[k].id) || (pass && o.avoid?.(ps[k])))) k++;
        if (k >= ps.length) break;
        taken.add(ps[k].id); pins.set(e.id, ps[k]); left[i] = null;
      }
    }
  }
  const overflowUsed = Math.max(0, Math.min(blocked.length, qs.length) - plan.queue.length) + Math.max(0, Math.min(done.length, ps.length) - plan.pit.length);
  return { pins, queueLen: Math.min(blocked.length, qs.length), queueFull, overflowUsed, queueOrder: blocked.slice(0, qs.length).map((e) => e.id) };
}
