/**
 * `__valley.visitors`: dev hooks for the visitors (model/visitors.ts, scene/visitors, hud/visitors.ts).
 *
 *   __valley.visitors()                       today: who comes (calendar), who's in the valley and where, the stock, the easel
 *   __valley.visitors('merchant' | 'painter' | 'postie', mode?)
 *                                             force an arrival now: mode 'in' (default: walks in from the south pass / the
 *                                             halt), 'here' (already settled: the cart parked, the easel up), 'out' (leaves)
 *   __valley.visitors('calendar')             back to the calendar for everyone (drops the forced visits)
 *   __valley.visitors('go', id)               stand in front of one (the merchant's counter, behind the painter, the postie)
 *   __valley.visitors('open', id?)            open the panel ('merchant' | 'painter')
 *   __valley.visitors('finish')               finish today's canvas (the painting goes on sale)
 *   __valley.visitors('buy', stockId)         buy from the cart now (he must be trading); 'painting' buys the canvas
 *   __valley.visitors('days', n?)             the next n days' visitors (calendar check)
 *   __valley.visitors('reset')                forget every purchase, painting, parcel and meeting
 */
import type { SceneCtx } from '../scene/context.ts';
import { VISITOR_IDS, addDays, isVisitorId, stockFor, visitorsOn } from '../model/visitors.ts';
import type { VisitorId, VisitorsService } from '../model/visitors.ts';
import type { VisitorsScene } from '../scene/visitors/visitors.ts';
import type { ProjectsService } from '../model/projects.ts';
import { dayKey } from '../model/almanac.ts';

export function visitorsDev(ctx: SceneCtx) {
  const m = () => ctx.services.get('visitors') as VisitorsService | undefined;
  const scene = () => ctx.services.get('visitorsScene') as VisitorsScene | undefined;
  const halt = () => !!(ctx.services.get('projects') as ProjectsService | undefined)?.data().p.halt?.done;
  return (cmd?: string, a?: string | number): unknown => {
    const day = dayKey(Date.now());
    if (cmd === undefined) {
      return {
        day, calendar: visitorsOn(day, { halt: halt() }), open: scene()?.open() ?? false,
        here: scene()?.list().map((p) => ({ id: p.id, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, line: p.line, settled: p.settled })) ?? [],
        stock: m()?.stock(day).map((e) => ({ id: e.def.id, kind: e.def.kind, price: e.price, lock: e.lock })) ?? [],
        easel: scene()?.painting() ?? null,
        data: m()?.data() ?? null,
        debug: scene()?.debug() ?? null,
      };
    }
    if (isVisitorId(cmd)) {
      const mode = a === 'here' || a === 'out' ? a : 'in';
      return scene()?.force(cmd, mode) ?? false;
    }
    switch (cmd) {
      case 'calendar': for (const id of VISITOR_IDS) scene()?.force(id, null); return true;
      case 'go': return isVisitorId(a) ? scene()?.go(a as VisitorId) ?? false : false;
      case 'open': ctx.ui.visitors?.(typeof a === 'string' ? a : 'merchant'); return true;
      case 'finish': scene()?.finish(); return true;
      case 'buy': {
        if (a === 'painting') { const p = scene()?.painting(); return p ? m()?.buyPainting(p.day, p.spot, p.season, p.progress) ?? null : null; }
        return m()?.buy(String(a), day, scene()?.open() ?? false) ?? null;
      }
      case 'days': {
        const n = typeof a === 'number' ? a : 14;
        return Array.from({ length: n }, (_, i) => { const d = addDays(day, i); return { day: d, who: visitorsOn(d, { halt: halt() }), stock: stockFor(d).map((e) => e.def.id) }; });
      }
      case 'reset': m()?.devReset(); return true;
    }
    return false;
  };
}
