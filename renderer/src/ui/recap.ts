// @pure
/**
 * "While you were away" lines (§6.4.5), pure: from an event ring (the store applies events while the tab is hidden)
 * or a `timeline` reply, plus the current entities. ≤ 6 lines in the §6.4.5 order: blocked now → finished → commits →
 * test streaks / fails → arrivals & departures → struggle incidents; nothing → "All quiet · N idle, dust settling".
 * Also the tiny event ring the UI keeps (names captured at event time: departed panes have no entity any more).
 * Owner: UI.
 */

import { waitClock } from '../../../shared/clock.ts';
import { blockedQueue } from './serveModel.ts';
import { elapsedLabel } from './roster/model.ts';
import { lampState, type LampState } from './kit/lamps.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { Entity } from '../../../shared/protocol.ts';

export const RECAP_MAX_LINES = 6;
export const RING_MAX = 400;

/** m:ss / h:mm:ss for waits (§6.4.5 "longest wait name mm:ss"); [FX fix r1] the shared wait clock (shared/clock.ts). */
export function mmss(ms: number, approx = false): string {
  return waitClock(ms, approx);
}

/** Human list: "a, b and c" / "a, b +3". */
export function nameList(names: Iterable<string>, max = 3): string {
  const u = [...new Set(names)];
  if (u.length <= max) return u.length > 1 ? `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}` : (u[0] ?? '');
  return `${u.slice(0, max).join(', ')} +${u.length - max}`;
}

/** One recorded event (`to` is set on folded-in timeline `status` items). */
export interface RingItem { at: number; id: string; name?: string; kind: string; detail?: unknown; to?: string }
const isRingItem = (x: unknown): x is RingItem => isRecord(x) && typeof x.at === 'number' && !!x.kind;

/** Append-only ring of recent events with the entity name captured at record time. */
export function createRing(max = RING_MAX) {
  let items: RingItem[] = [];
  return {
    push(item: RingItem) { items.push(item); if (items.length > max) items = items.slice(-max); },
    since(t: number) { return items.filter((x) => x.at >= t); },
    get items() { return items; },
    load(arr: unknown) { if (Array.isArray(arr)) items = arr.filter(isRingItem).slice(-max); },
  };
}

/**
 * One recap line. `strong` + `text` is the one-string form (announce, drawer, Big Board); `name` · `say` · `time` is the slip's line
 * (UI kit §5.4 "While you were out": lamp · name · serif sentence · time).
 * [fix r3 art] `lamp` is the named agent's REAL lamp (kit lampState: a Claude never gets the square CRT bezel, §4.1);
 * null = the agent has left (no lamp, the name stands alone); undefined = a summary line (the slip picks by kind).
 */
export interface RecapLine { text: string; kind: string; id?: string | null; strong?: string; name?: string; say?: string; time?: string; lamp?: LampState | null }

/**
 * Builds the lines. `events` since lastPresentAt (timeline items with kind 'status' are folded in: to 'done' = finished). `label` is the
 *   one display label (names.ts: namesakes → 'claude · 2'); live agents are named and grouped by it, so two agents
 *   both called 'claude' are two lines' worth of names, never one merged 'claude'.
 */
export function buildRecap({ events, entities, now, label }: { events: readonly RingItem[]; entities: Iterable<Entity>; now: number; label?: (e: Entity) => string }): RecapLine[] {
  const ents = [...entities];
  const byId = new Map(ents.map((e) => [e.id, e]));
  const lab = (e: Entity) => (label ? label(e) : null) || e.name || e.id;
  const nameOf = (ev: RingItem) => { const e = byId.get(ev.id); return (e ? lab(e) : null) || ev.name || ev.id; };
  /** the named agent's own lamp; null when it has left (no entity) */
  const lampOf = (id: string | undefined) => { const e = id === undefined ? undefined : byId.get(id); return e ? lampState(e.status, e) : null; };
  const lines: RecapLine[] = [];

  // 1. blocked now: count + longest wait
  const blocked = blockedQueue(ents); // the shared needs-you order (= inbox, roster)
  if (blocked.length) {
    const b = blocked[0];
    const w = mmss(now - (b.statusSince || now), b.statusSinceApprox);
    const more = blocked.length - 1;
    lines.push({ kind: 'blocked', id: b.id, strong: `${blocked.length} blocked`, text: ` · ${lab(b)} waiting ${w}`,
      name: lab(b), say: `is waiting on you${more ? `, and ${more} more in the queue` : ''}`, time: w });
  }

  // 2. finished (events 'finished' or status → done) + [m2-r1] everyone still done and waiting for your sign-off (they
  //    may have finished before the away window), with time in state: "3 done · moss 12m, gale 3m and pike 1m"
  const fin = new Map<string, string>(); // name → label
  let finId: string | null = null;
  for (const ev of events) {
    if (ev.kind === 'finished' || (ev.kind === 'status' && ev.to === 'done')) { fin.set(nameOf(ev), nameOf(ev)); finId = ev.id ?? finId; }
  }
  const sawFinish = fin.size > 0;
  const doneNow = ents.filter((e) => e.kind !== 'shell' && e.status === 'done' && !e.ack).sort((a, b) => (a.statusSince || now) - (b.statusSince || now));
  for (const e of doneNow) {
    fin.delete(lab(e));
    fin.set(lab(e), e.statusSince ? `${lab(e)} ${elapsedLabel(now - e.statusSince)}` : lab(e));
  }
  if (!finId && doneNow.length) finId = doneNow[0].id;
  if (fin.size) {
    const n = fin.size;
    // the agents still waiting on you lead the list (oldest first), then the ones already signed off / gone
    const order = [...doneNow.map((e) => fin.get(lab(e)) ?? lab(e)), ...[...fin.entries()].filter(([k]) => !doneNow.some((e) => lab(e) === k)).map(([, v]) => v)];
    const first = doneNow[0];
    const lead = first ? lab(first) : [...fin.keys()][0];
    const rest = [...fin.keys()].filter((k) => k !== lead);
    lines.push({ kind: 'finished', id: finId, strong: `${n} ${sawFinish ? 'finished' : 'done'}`, text: ` · ${nameList(order)}`,
      name: lead, say: rest.length ? `${first ? 'is done' : 'finished'}; so ${first ? (rest.length > 1 ? 'are' : 'is') : 'did'} ${nameList(rest, 1)}` : first ? 'is done, waiting for your sign-off' : 'finished',
      time: first?.statusSince ? elapsedLabel(now - first.statusSince) : undefined });
  }

  // 3. commits (per author)
  const commits = new Map<string, number>();
  const commitId = new Map<string, string>();
  for (const ev of events) if (ev.kind === 'commit') { commits.set(nameOf(ev), (commits.get(nameOf(ev)) ?? 0) + 1); commitId.set(nameOf(ev), ev.id); }
  if (commits.size) {
    const total = [...commits.values()].reduce((a, b) => a + b, 0);
    const parts = [...commits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => (c > 1 ? `${n} ${c}` : n));
    const [top, c] = [...commits.entries()].sort((a, b) => b[1] - a[1])[0];
    lines.push({ kind: 'commit', id: null, lamp: lampOf(commitId.get(top)), strong: `${total} commit${total === 1 ? '' : 's'}`, text: ` · ${parts.join(', ')}${commits.size > 3 ? ' …' : ''}`,
      name: top, say: `committed${c > 1 ? ` ${c} times` : ''}${commits.size > 1 ? `; ${total - c} more by ${nameList([...commits.keys()].filter((k) => k !== top), 2)}` : ''}` });
  }

  // 4. test streaks / fails: the best pass streak and every fail
  const streak = new Map<string, { run: number; best: number; fails: number; id: string }>(); // name → {run, best, lastFail}
  for (const ev of events) {
    if (ev.kind !== 'test-pass' && ev.kind !== 'test-fail') continue;
    const n = nameOf(ev);
    const s = streak.get(n) ?? { run: 0, best: 0, fails: 0, id: ev.id };
    if (ev.kind === 'test-pass') { s.run++; s.best = Math.max(s.best, s.run); } else { s.run = 0; s.fails++; }
    s.id = ev.id;
    streak.set(n, s);
  }
  if (streak.size) {
    const pass = [...streak.entries()].filter(([, s]) => s.best >= 2).sort((a, b) => b[1].best - a[1].best);
    const fail = [...streak.entries()].filter(([, s]) => s.fails && s.run === 0);
    const bits: string[] = [];
    if (pass.length) bits.push(`${pass[0][0]} ${pass[0][1].best}× pass`);
    if (fail.length) bits.push(`${nameList(fail.map(([n]) => n), 2)} failing`);
    if (!bits.length) { const [n, s] = [...streak.entries()][0]; bits.push(s.fails ? `${n} failed` : `${n} passed`); }
    const who = (fail[0] ?? pass[0])?.[0] ?? [...streak.keys()][0];
    const sayT = fail.length ? `keeps failing its tests${fail.length > 1 ? `; so does ${nameList(fail.slice(1).map(([n]) => n), 2)}` : ''}`
      : pass.length ? `passed its tests ${pass[0][1].best}× in a row` : streak.get(who)?.fails ? 'failed its tests' : 'passed its tests';
    lines.push({ kind: 'tests', id: (fail[0] ?? pass[0])?.[1].id ?? null, lamp: lampOf(streak.get(who)?.id), strong: 'tests', text: ` · ${bits.join(' · ')}`, name: who, say: sayT });
  }

  // 5. arrivals and departures
  const arr = events.filter((e) => e.kind === 'arrived').map(nameOf);
  const dep = events.filter((e) => e.kind === 'left').map(nameOf);
  if (arr.length || dep.length) {
    const bits: string[] = [];
    if (arr.length) bits.push(`${new Set(arr).size} arrived (${nameList(arr, 2)})`);
    if (dep.length) bits.push(`${new Set(dep).size} left (${nameList(dep, 2)})`);
    const last = events.filter((e) => e.kind === 'arrived').pop();
    const who = arr.length ? arr[arr.length - 1] : dep[dep.length - 1];
    const whoEv = events.filter((e) => (e.kind === 'arrived' || e.kind === 'left') && nameOf(e) === who).pop();
    const others = [...new Set([...arr, ...dep])].length - 1;
    lines.push({ kind: 'crowd', id: last && byId.has(last.id) ? last.id : null, lamp: lampOf(whoEv?.id), strong: bits[0], text: bits[1] ? ` · ${bits[1]}` : '',
      name: who, say: `${arr.includes(who) ? 'arrived' : 'left'}${others ? `, with ${others} other${others === 1 ? '' : 's'} coming or going` : ''}` });
  }

  // 6. struggle incidents (level rises)
  const strug = new Map<string, { lvl: number; id: string }>();
  for (const ev of events) {
    if (ev.kind !== 'struggle') continue;
    const lvl = isRecord(ev.detail) && typeof ev.detail.level === 'number' ? ev.detail.level : 1;
    if (lvl > 0) strug.set(nameOf(ev), { lvl: Math.max(lvl, strug.get(nameOf(ev))?.lvl ?? 0), id: ev.id });
  }
  if (strug.size) {
    const top = [...strug.entries()].sort((a, b) => b[1].lvl - a[1].lvl);
    lines.push({ kind: 'struggle', id: top[0][1].id, lamp: lampOf(top[0][1].id), strong: `${top[0][0]} struggled`, text: `${top[0][1].lvl > 1 ? ` (level ${top[0][1].lvl})` : ''}${top.length > 1 ? ` · +${top.length - 1} more` : ''}`,
      name: top[0][0], say: `struggled${top[0][1].lvl > 1 ? ' badly' : ''}${top.length > 1 ? `; ${top.length - 1} more had a rough patch` : ''}` });
  }

  if (!lines.length) {
    const idle = ents.filter((e) => e.kind !== 'shell' && e.status === 'idle').length;
    lines.push({ kind: 'quiet', id: null, strong: 'All quiet', text: ` · ${idle} idle, dust settling`, name: 'All quiet', say: `${idle} idle, dust settling` });
  }
  return lines.slice(0, RECAP_MAX_LINES);
}

/**
 * Should the recap fire? (§6.4.5 trigger) `minutes` = setting awayRecapMin (0 = off).
 */
export function awayDue(lastPresentAt: number | null, now: number, minutes: number): boolean {
  if (!minutes || minutes <= 0 || !lastPresentAt) return false;
  return now - lastPresentAt >= minutes * 60_000;
}
