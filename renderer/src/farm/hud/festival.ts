/**
 * Festivals in the HUD (model/calendar.ts): the greeting toast the first time the valley is seen during a festival
 * (once per real day and festival, remembered in localStorage `valley.hud.greeted`, so reloads stay quiet), and the
 * icon the noticeboard's poster uses.
 */
import type { FestivalId } from '../model/calendar.ts';
import { dayText, inDaysText } from '../model/calendar.ts';
import type { ValleyState } from '../model/types.ts';
import { ICONS, SEASON_ICON } from './icons.ts';
import type { ToastSpec } from './ctx.ts';
import { readJson, writeJson } from '../storage.ts';

export const FESTIVAL_ICON: Readonly<Record<FestivalId, string>> = {
  blossom: SEASON_ICON.spring, lantern: ICONS.lantern, founders: ICONS.rosette, harvest: SEASON_ICON.autumn,
  hallowtide: ICONS.lantern, starlight: SEASON_ICON.winter, newyear: ICONS.rosette,
};

const GREETED_KEY = 'valley.hud.greeted';

/** call on every HUD tick: greets once per festival and day (and once for one starting within 3 days) */
export function festivalGreeter(push: (t: ToastSpec) => void): (s: ValleyState) => void {
  const greeted = new Set<string>();
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  // remembered per day: `${day}|${what}` entries from today only
  const seen = (what: string): boolean => {
    const k = `${today()}|${what}`;
    if (greeted.has(k)) return true;
    greeted.add(k);
    try {
      const stored = readJson(GREETED_KEY);
      const prev = (Array.isArray(stored) ? stored : []).filter((x): x is string => typeof x === 'string' && x.startsWith(`${today()}|`));
      if (prev.includes(k)) return true;
      writeJson(GREETED_KEY, [...prev, k]);
    } catch { /* once per load */ }
    return false;
  };
  return (s) => {
    if (s.link === 'connecting') return;
    const f = s.sky.festival;
    const a = f?.active;
    if (a && !seen(a.id)) {
      push({ text: `Happy ${a.name}!`, sub: `${a.blurb} · ${dayText(a)}`, icon: FESTIVAL_ICON[a.id], level: 'good', ms: 6500, key: `festival|${a.id}` });
    } else if (!a && f?.next && f.next.inDays <= 3 && !seen(`soon|${f.next.id}`)) {
      push({ text: `The ${f.next.name} is ${inDaysText(f.next.inDays)}`, sub: f.next.blurb, icon: FESTIVAL_ICON[f.next.id], level: 'info', ms: 5500, key: `festival-soon|${f.next.id}` });
    }
  };
}
