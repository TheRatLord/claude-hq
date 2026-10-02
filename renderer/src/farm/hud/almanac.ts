/**
 * The Valley Almanac (H): how prosperous the valley has grown from the agents' work. The rank and its progress, today's
 * harvest by kind, the last seven days, the streak, and the town upgrades each rank brings (model/almanac.ts). The
 * status sign carries a compact rank chip that opens it; a new rank pops a toast with a fanfare.
 *
 * Two tabs: the Almanac itself and the **stamp book** (model/stamps.ts, drawn by hud/stamps.ts). `open('almanac',
 * 'stamps')` (or `{ tab: 'stamps' }`) opens on the stamps; 1 / 2 or S switch while it is open.
 */
import { HARVEST, HARVEST_KINDS, RANKS, STAR_POINTS, UPGRADES } from '../model/almanac.ts';
import type { AlmanacView, HarvestKind } from '../model/almanac.ts';
import { ICONS, KIND_ICON, LETTER_ICON, icon } from './icons.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';
import { createStampPage } from './stamps.ts';

export const HARVEST_ICON: Record<HarvestKind, string> = {
  commit: LETTER_ICON.commit, tests: LETTER_ICON['test-pass'], finished: LETTER_ICON.finished,
  answered: ICONS.bang, tilled: ICONS.sprout, ducklings: ICONS.duck, found: KIND_ICON.berries,
};

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (key: string) => WD[new Date(`${key}T12:00:00`).getDay()];
const stars = (n: number) => (n > 0 ? ` ${'★'.repeat(Math.min(5, n))}${n > 5 ? `×${n}` : ''}` : '');

/** The rank line on the status sign: rosette, rank name, a slim progress bar. */
export function rankChip(ctx: HudCtx): { el: HTMLElement; refresh(a: AlmanacView): void } {
  const name = h('span.nm');
  const fill = h('i');
  const el = h('button.vh-rank', { type: 'button', title: 'Valley Almanac (H)', 'data-testid': 'rank-chip' }, icon(ICONS.rosette), name, h('span.bar', null, fill));
  el.addEventListener('click', (e) => { e.stopPropagation(); ctx.panels.toggle('almanac'); });
  let sig = '';
  return {
    el,
    refresh(a) {
      const s = `${a.rank}|${a.stars}|${Math.round(a.progress * 200)}`;
      if (s === sig) return;
      sig = s;
      name.textContent = `${a.name}${stars(a.stars)}`;
      fill.style.width = `${Math.round(a.progress * 100)}%`;
      el.title = a.nextAt !== null ? `Valley Almanac (H): ${a.points} / ${a.nextAt} toward ${a.nextName}` : `Valley Almanac (H): ${a.points} points`;
    },
  };
}

export function createAlmanac(ctx: HudCtx): Panel {
  const { el, body, head: frameHead, closeBtn } = framePanel('almanac', 'Valley Almanac', ICONS.rosette);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const toBook = h('button.vh-col-tab', { type: 'button', title: 'Collections (K)', 'data-testid': 'almanac-collection' }, icon(ICONS.book), 'Collections');
  toBook.addEventListener('click', () => ctx.panels.open('collection'));
  frameHead.insertBefore(toBook, closeBtn);

  // rank header
  const rName = h('div.rk-name');
  const rSub = h('div.rk-sub');
  const rFill = h('i');
  const rBar = h('div.rk-bar', null, rFill);
  const rNext = h('div.rk-next');
  const head = h('div.vh-al-head', null, h('div.rosette', null, icon(ICONS.rosette)), h('div.rk', null, rName, rSub, rBar, rNext));

  // today + week
  const tPts = h('span.val');
  const tList = h('ul.harvest');
  const today = h('div.vh-al-card', null, h('div.l1', null, h('div.nm', { text: 'Today’s harvest' }), tPts), tList);
  const bars = h('div.week');
  const wSub = h('div.sub');
  const week = h('div.vh-al-card', null, h('div.l1', null, h('div.nm', { text: 'This week' })), bars, wSub);

  // upgrades
  const ups = h('div.vh-al-ups', { 'data-testid': 'almanac-upgrades' });
  const legend = h('div.vh-al-legend', null,
    h('b', { text: 'How the valley grows: ' }),
    ...HARVEST_KINDS.map((k) => h('span', null, icon(HARVEST_ICON[k]), `${HARVEST[k].one} +${HARVEST[k].points}`)));

  // two tabs: the almanac and the stamp book
  const almanacPage = h('div.vh-al-page', null, head, h('div.vh-al-row', null, today, week), h('div.vh-h3', { text: 'Town upgrades' }), ups, legend);
  const stampBook = createStampPage();
  const stampsPage = h('div.vh-al-page', { hidden: true }, stampBook.el);
  const tabAl = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', 'data-testid': 'almanac-tab-almanac' }, 'Almanac');
  const stampN = h('span.n');
  const tabSt = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-testid': 'almanac-tab-stamps' }, 'Stamp book', stampN);
  const tabs = h('div.vh-al-tabs', { role: 'tablist' }, tabAl, tabSt);
  let tab: 'almanac' | 'stamps' = 'almanac';
  const stamps = () => { try { return ctx.b?.stamps?.() ?? null; } catch { return null; } };
  const show = (t: typeof tab, quiet = false) => {
    if (t !== tab && !quiet) ctx.sfx('page');
    tab = t;
    tabAl.setAttribute('aria-selected', String(t === 'almanac'));
    tabSt.setAttribute('aria-selected', String(t === 'stamps'));
    almanacPage.hidden = t !== 'almanac';
    stampsPage.hidden = t !== 'stamps';
    el.dataset.tab = t;
    render();
  };
  tabAl.addEventListener('click', () => show('almanac'));
  tabSt.addEventListener('click', () => show('stamps'));
  body.append(tabs, almanacPage, stampsPage);

  let sig = '';
  function render(): void {
    const sv = stamps()?.view() ?? null;
    stampN.textContent = sv ? `${sv.earned}/${sv.total}` : '';
    if (tab === 'stamps') stampBook.render(sv);
    const s = ctx.state();
    if (!s) return;
    const a = s.almanac;
    const nsig = JSON.stringify([a.points, a.today, a.week, a.streak]);
    if (nsig === sig) return;
    sig = nsig;
    rName.textContent = `${a.name}${stars(a.stars)}`;
    rSub.textContent = `Rank ${a.rank + 1} of ${RANKS.length} · ${a.points.toLocaleString()} prosperity`;
    rFill.style.width = `${Math.round(a.progress * 100)}%`;
    rNext.textContent = a.nextAt !== null
      ? `${(a.nextAt - a.points).toLocaleString()} more to ${a.nextName}${a.next ? `, which brings ${a.next.title.toLowerCase()}` : ''}.`
      : `Every ${STAR_POINTS.toLocaleString()} more earns the valley another star.`;

    tPts.textContent = `+${a.today.points}`;
    const got = HARVEST_KINDS.filter((k) => (a.today.counts[k] ?? 0) > 0);
    tList.replaceChildren(...(got.length ? got.map((k) => {
      const n = a.today.counts[k] ?? 0;
      return h('li', null, icon(HARVEST_ICON[k]), h('b', { text: String(n) }), ` ${n === 1 ? HARVEST[k].one : HARVEST[k].label}`,
        n > HARVEST[k].cap ? h('span.vh-muted', { text: ` (${HARVEST[k].cap} count today)` }) : null);
    }) : [h('li.vh-muted', { text: 'Nothing harvested yet today. Every commit, green test run and finished task counts.' })]));

    const max = Math.max(10, ...a.week.map((d) => d.points));
    bars.replaceChildren(...a.week.map((d, i) => h(`div.day${i === a.week.length - 1 ? '.today' : ''}`, { title: `${d.date}: ${d.points} points` },
      h('span.n', { text: d.points ? String(d.points) : '' }),
      h('i', { style: { height: `${Math.max(3, Math.round((d.points / max) * 100))}%` } }),
      h('span.d', { text: i === a.week.length - 1 ? 'today' : weekday(d.date) }))));
    wSub.textContent = [
      a.streak ? `${a.streak}-day streak` : 'No streak yet',
      a.best ? `best day ${a.best}` : null,
      a.since ? `keeping records since ${new Date(a.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null,
    ].filter(Boolean).join(' · ');

    ups.replaceChildren(...UPGRADES.map((u, i) => {
      const rank = i + 1;
      const have = a.rank >= rank;
      const next = a.rank + 1 === rank;
      return h(`div.up${have ? '.have' : next ? '.next' : ''}`, null,
        h('div.t', null, have ? icon(ICONS.check) : h('span.lv', { text: String(rank + 1) }), h('b', { text: u.title })),
        h('div.s', { text: have ? u.blurb : `${RANKS[rank].name} · ${RANKS[rank].at.toLocaleString()} prosperity` }));
    }));
  }
  return {
    id: 'almanac', el,
    onOpen(arg) {
      sig = '';
      const want = arg === 'stamps' || (arg && typeof arg === 'object' && (arg as { tab?: string }).tab === 'stamps') ? 'stamps' : 'almanac';
      show(want, true); // quietly: the panel's own open sound plays
    },
    refresh: render,
    key(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === '1') { show('almanac'); return true; }
      if (e.key === '2') { show('stamps'); return true; }
      if (e.code === 'KeyS') { show(tab === 'stamps' ? 'almanac' : 'stamps'); return true; }
      return false;
    },
  };
}
