/**
 * The day timeline in the HUD (model/timeline.ts → `ValleyState.timeline`):
 *   * `createDayCard` — the farmer card's "Today" section: four stat tiles (active, waited on you, ships, test runs), a
 *     day strip (one gradient of colour bands, ask / ship / test markers, hour ticks, a hover tooltip) and a scrollable
 *     list of key moments ("10:42 shipped a commit", "11:05 tests failed → 11:09 green"). Kept as one node the card
 *     re-appends on its rebuilds; it repaints itself only when the farmer's day changed (rev) or a minute passed.
 *   * `paintMiniStrip` — the ledger's per-row strip: a single element's background gradient over a shared window, so
 *     rows compare at a glance; the caller repaints only rows whose day changed.
 */
import './timeline.css';
import type { FarmerDay, Moment } from '../model/timeline.ts';
import { bands, keyMoments, spanAt, stripRange, summarize } from '../model/timeline.ts';
import { BAND_COLOR, BAND_LABEL, LEGEND, hhmm, hourTicks, momentTail, spanLine, stripGradient, summaryLine } from './daystrip.ts';
import { dur } from './format.ts';
import { ICONS, LETTER_ICON, icon } from './icons.ts';
import { h, type HudCtx } from './ctx.ts';

const MOMENT_ICON: Record<Moment['kind'], string> = {
  ship: LETTER_ICON.commit, pass: LETTER_ICON['test-pass'], fixed: LETTER_ICON['test-pass'], fail: LETTER_ICON['test-fail'],
  error: LETTER_ICON.error, ask: ICONS.bang, finished: LETTER_ICON.finished, sub: ICONS.duck, compact: ICONS.sprout,
  struggle: LETTER_ICON.struggle, start: ICONS.sprout,
};
/** markers drawn on the card strip (the rest only show in the list) */
const MARKED = new Set(['ship', 'pass', 'fail', 'error', 'ask', 'finished']);

export interface DayCard { el: HTMLElement; update(id: string): void }

export function createDayCard(ctx: HudCtx): DayCard {
  const stats = h('div.vh-day-stats');
  const bar = h('div.bar');
  const marks = h('div.marks', { 'aria-hidden': 'true' });
  const tip = h('div.tip', { role: 'tooltip' });
  const strip = h('div.vh-day-strip', { role: 'img', 'data-testid': 'day-strip' }, bar, marks, tip);
  const hours = h('div.vh-day-hours', { 'aria-hidden': 'true' });
  const legend = h('div.vh-day-legend', { 'aria-hidden': 'true' }, ...LEGEND.map((b) => h('span', null, h('i', { style: { background: BAND_COLOR[b] ?? 'transparent' } }), BAND_LABEL[b])));
  const since = h('span.since');
  const list = h('ol.vh-day-moments.vh-scroll', { 'data-testid': 'day-moments', 'aria-label': 'Key moments today' });
  const el = h('section.vh-day', { 'data-testid': 'card-day', 'aria-label': 'Today' },
    h('div.vh-day-head', null, h('div.vh-h3', { style: { fontSize: '14px', margin: '0' } }, icon(ICONS.book), 'Today'), since),
    stats, strip, hours, legend, list);

  let sig = '';
  let fd: FarmerDay | undefined;
  let range = { from: 0, to: 1 };

  const tile = (label: string, value: string, sub: string, cls = '', testid = '') =>
    h(`div.tile${cls}`, { title: `${label}: ${value} ${sub}`, ...(testid ? { 'data-testid': testid } : {}) }, h('span.lab', { text: label }), h('b', { text: value }), h('small', { text: sub }));

  function paint(id: string, now: number): void {
    const s = summarize(fd);
    range = stripRange(s.first, now);
    const tests = s.passes + s.fails;
    stats.replaceChildren(
      tile('Active', dur(s.active), s.first != null ? `since ${hhmm(s.first)}` : 'nothing yet', '', 'day-active'),
      tile('Waited', s.waited ? dur(s.waited) : '—', `on you · ${s.asks} ask${s.asks === 1 ? '' : 's'}`, s.waited > 10 * 60_000 ? '.warm' : '', 'day-waited'),
      tile('Shipped', String(s.ships), s.ships === 1 ? 'commit' : 'commits', '', 'day-ships'),
      tile('Test runs', String(tests), s.fails ? `${s.fails} red` : tests ? 'all green' : 'none yet', s.fails && !s.passes ? '.red' : '', 'day-tests'));
    since.textContent = s.first != null ? `${hhmm(range.from)} – now` : '';
    strip.setAttribute('aria-label', `${ctx.nameOf(id)} today: ${summaryLine(s)}`);
    bar.style.background = stripGradient(bands(fd, range.from, range.to, 140));
    const span = range.to - range.from;
    const pos = (t: number) => `${Math.max(0, Math.min(100, ((t - range.from) / span) * 100)).toFixed(2)}%`;
    marks.replaceChildren(...(fd?.marks ?? []).filter((m) => MARKED.has(m.kind) && m.at >= range.from)
      .map((m) => h(`i.m.${m.kind}`, { style: { left: pos(m.at) } })));
    hours.replaceChildren(...hourTicks(range.from, range.to).filter((t) => t.pct < 94).map((t) => h('span', { text: t.label, style: { left: `${t.pct.toFixed(2)}%` } })));
    const keep = list.scrollTop;
    const ms = keyMoments(fd);
    if (!ms.length) list.replaceChildren(h('li.empty', { text: 'Nothing to report yet today. Moments (ships, test runs, asks) collect here.' }));
    else list.replaceChildren(...ms.map((m) => {
      const tail = momentTail(m, now);
      return h(`li.k-${m.kind}`, { title: [m.text, m.sub, tail].filter(Boolean).join(' · ') },
        h('time', { text: hhmm(m.at) }), icon(MOMENT_ICON[m.kind]),
        h('span.tx', null, h('b', { text: m.text }), m.sub ? h('small', { text: m.sub }) : null),
        tail ? h(`span.tail${m.kind === 'ask' && m.wait == null ? '.open' : ''}`, { text: tail }) : null);
    }));
    list.scrollTop = keep;
  }

  // one tooltip, positioned from the pointer: the span under it and any marks nearby
  strip.addEventListener('pointermove', (e) => {
    const r = strip.getBoundingClientRect();
    if (!r.width) return;
    const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const t = range.from + k * (range.to - range.from);
    const near = (range.to - range.from) * (8 / r.width);
    const sp = spanAt(fd, t);
    const lines: string[] = [sp ? spanLine(sp) : `${hhmm(t)} · no record`];
    for (const m of fd?.marks ?? []) {
      if (!MARKED.has(m.kind) || Math.abs(m.at - t) > near) continue;
      const what = m.kind === 'ship' ? 'shipped' : m.kind === 'pass' ? 'tests green' : m.kind === 'fail' ? 'tests failed' : m.kind === 'error' ? 'error'
        : m.kind === 'finished' ? 'finished' : `asked you${m.wait != null ? ` · waited ${dur(m.wait)}` : ''}`;
      lines.push(`${hhmm(m.at)} ${what}${m.text ? `: ${m.text}` : ''}`);
    }
    tip.textContent = lines.slice(0, 6).join('\n');
    tip.style.left = `${(k * 100).toFixed(1)}%`;
    tip.classList.toggle('flip', k > 0.6);
    tip.classList.add('on');
  });
  strip.addEventListener('pointerleave', () => tip.classList.remove('on'));

  return {
    el,
    update(id) {
      const tv = ctx.state()?.timeline;
      fd = tv?.farmers.get(id);
      const now = tv?.now || Date.now();
      // repaint on a change, else once a minute (the strip grows to now)
      const nsig = `${id}|${fd?.rev ?? -1}|${Math.floor(now / 60_000)}`;
      if (nsig === sig) return;
      sig = nsig;
      paint(id, now);
    },
  };
}

/** Paint one ledger row's mini strip (a single element; 48 buckets). */
export function paintMiniStrip(el: HTMLElement, fd: FarmerDay | undefined, from: number, to: number): void {
  const g = stripGradient(bands(fd, from, to, 48));
  el.style.backgroundImage = g === 'transparent' ? 'none' : g;
  el.title = `Today${fd ? ` (${hhmm(from)}–now)` : ''}: ${summaryLine(summarize(fd))}`;
}
