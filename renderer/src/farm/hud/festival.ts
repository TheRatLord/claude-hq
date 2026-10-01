/**
 * Festivals in the HUD (model/calendar.ts): the greeting toast the first time the valley is seen during a festival
 * (per page load and festival), and the icon the noticeboard's poster uses.
 */
import type { FestivalId } from '../model/calendar.ts';
import { dayText, inDaysText } from '../model/calendar.ts';
import type { ValleyState } from '../model/types.ts';
import { ICONS, SEASON_ICON } from './icons.ts';
import type { ToastSpec } from './ctx.ts';

export const FESTIVAL_ICON: Readonly<Record<FestivalId, string>> = {
  blossom: SEASON_ICON.spring, lantern: ICONS.lantern, founders: ICONS.rosette, harvest: SEASON_ICON.autumn,
  hallowtide: ICONS.lantern, starlight: SEASON_ICON.winter, newyear: ICONS.rosette,
};

/** call on every HUD tick: greets once per festival (and once for one starting within 3 days) */
export function festivalGreeter(push: (t: ToastSpec) => void): (s: ValleyState) => void {
  const greeted = new Set<string>();
  return (s) => {
    if (s.link === 'connecting') return;
    const f = s.sky.festival;
    const a = f?.active;
    if (a && !greeted.has(a.id)) {
      greeted.add(a.id);
      push({ text: `Happy ${a.name}!`, sub: `${a.blurb} · ${dayText(a)}`, icon: FESTIVAL_ICON[a.id], level: 'good', ms: 9000, key: `festival|${a.id}` });
    } else if (!a && f?.next && f.next.inDays <= 3 && !greeted.has(`soon|${f.next.id}`)) {
      greeted.add(`soon|${f.next.id}`);
      push({ text: `The ${f.next.name} is ${inDaysText(f.next.inDays)}`, sub: f.next.blurb, icon: FESTIVAL_ICON[f.next.id], level: 'info', ms: 7000, key: `festival-soon|${f.next.id}` });
    }
  };
}
