/**
 * Dev hooks for the villagers' days (model/routines.ts, service 'villagerDays') and heart events (model/hearts.ts,
 * service 'hearts'); docs/valley/villagers.md.
 *
 *   __valley.routine()                     every villager: what they're doing now, the place, today's plan
 *   __valley.routine(id)                   one villager's plan, now, and "usually" lines
 *   __valley.routine(id, to)               jump them to a part of their day now (an hour 0..24, a kind 'pastime' |
 *                                          'lunch' | 'sleep' …, a place 'glasshouse' | 'stones' …, or a part
 *                                          'morning' | 'evening'); routine(id, null) hands them back to the clock
 *   __valley.heartEvent()                  every event: seen (choice), due now, what's next per villager, the scene playing
 *   __valley.heartEvent(id)                force one now: hearts raised to its threshold, the villager put at its place,
 *                                          you stood in front of them, and the scene begins
 *   __valley.heartEvent(id, 'play', k?)    force it and play it straight through choosing option k (default 0)
 *   __valley.heartEvent('next' | 'choose', k?)  advance the scene playing / pick option k
 *   __valley.heartEvent('reset', id?)      forget one event (or all)
 */
import type { SceneCtx, VillagersService } from '../scene/context.ts';
import type { FriendsService } from '../model/friends.ts';
import { heartEvent, HEART_EVENTS } from '../model/hearts.ts';
import type { HeartsService } from '../model/hearts.ts';
import type { VillagerDays } from '../scene/villagers/villagers.ts';

const norm = (id: string) => (id.startsWith('villager:') ? id : `villager:${id}`);

export function routineDev(ctx: SceneCtx) {
  const days = () => ctx.services.get('villagerDays') as VillagerDays | undefined;
  const vs = () => ctx.services.get('villagers') as VillagersService | undefined;
  return (id?: string, to?: number | string | null) => {
    const d = days();
    if (!d) return null;
    if (!id) {
      return Object.fromEntries((vs()?.list() ?? []).map((p) => [p.id, { now: d.now(p.id), inside: p.inside, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }]));
    }
    if (to !== undefined) return d.jump(norm(id), to);
    return { now: d.now(norm(id)), plan: d.plan(norm(id)), usual: (['morning', 'afternoon', 'evening', 'night'] as const).map((p) => d.usual(norm(id), p)), debug: vs()?.debug(norm(id)) ?? null };
  };
}

export function heartsDev(ctx: SceneCtx) {
  const hs = () => ctx.services.get('hearts') as HeartsService | undefined;
  const fr = () => ctx.services.get('friends') as FriendsService | undefined;
  const days = () => ctx.services.get('villagerDays') as VillagerDays | undefined;
  /** stand the player ~2.4 m in front of a villager, looking at them */
  const standBefore = (id: string) => {
    const p = (ctx.services.get('villagers') as VillagersService | undefined)?.list().find((x) => x.id === id);
    const dbg = (ctx.services.get('villagers') as VillagersService | undefined)?.debug(id) as { spot?: { yaw: number } } | null;
    const c = ctx.services.get('controller') as { teleport?(x: number, z: number, yaw?: number, pitch?: number): void } | undefined;
    if (!p || !c?.teleport) return;
    const yaw = dbg?.spot?.yaw ?? 0;
    let best = { x: p.x + Math.sin(yaw) * 3.2, z: p.z + Math.cos(yaw) * 3.2 };
    for (let a = 0; a < 12; a++) {
      const q = { x: p.x + Math.sin(yaw + a * 0.52) * 3.2, z: p.z + Math.cos(yaw + a * 0.52) * 3.2 };
      if (!ctx.colliders.blocked(q.x, q.z, 0.35)) { best = q; break; }
    }
    c.teleport(best.x, best.z, Math.atan2(-(p.x - best.x), -(p.z - best.z)), -0.08);
  };
  const status = () => {
    const h = hs();
    if (!h) return null;
    const cur = h.current();
    return {
      seen: h.data().seen, last: h.data().last,
      events: HEART_EVENTS.map((e) => ({ id: e.id, who: e.who, hearts: e.hearts, title: e.title, places: e.places, hours: e.hours, seen: !!h.data().seen[e.id] })),
      next: Object.fromEntries(['posy', 'bram', 'hazel', 'marigold', 'fern', 'nimbus'].map((k) => [k, h.next(k)?.id ?? null])),
      current: cur ? { id: cur.event.id, phase: cur.phase, i: cur.i, lines: cur.lines.length, choice: cur.choice, line: cur.phase === 'talk' ? cur.lines[cur.i]?.text : cur.event.choice.prompt } : null,
    };
  };
  return (cmd?: string, a?: string | number, b?: number) => {
    const h = hs();
    if (!h) return null;
    if (!cmd) return status();
    if (cmd === 'next') { h.advance(); return status(); }
    if (cmd === 'choose') { h.choose(Number(a ?? 0)); return status(); }
    if (cmd === 'reset') { h.devReset(typeof a === 'string' ? a : undefined); return status(); }
    const e = heartEvent(cmd);
    if (!e) return null;
    // the hearts it needs, the villager at its place and hour, you in front of them
    if ((fr()?.hearts(e.who) ?? 0) < e.hearts) fr()?.devHearts(e.who, e.hearts);
    days()?.jump(e.who, e.places[0]);
    const mid = e.hours[0] <= e.hours[1] ? (e.hours[0] + e.hours[1]) / 2 : (e.hours[0] + 24 + e.hours[1]) / 2 % 24;
    // keep them at the event's place: jump to an hour inside its window where the routine has them there
    const d = days();
    if (d && !e.places.includes(d.now(e.who)?.place as never)) d.jump(e.who, mid);
    standBefore(e.who);
    if (h.current()) h.leave();
    h.begin(e.id);
    if (a === 'play') {
      for (let n = 0; n < 60 && h.current(); n++) {
        const s = h.current()!;
        if (s.phase === 'choose') h.choose(Number(b ?? 0)); else h.advance();
      }
    }
    return status();
  };
}
