/**
 * The overview grid (V by default, rebindable; also from the command palette): every agent as one compact tile, for
 * scanning 10–40 of them at once. Each tile: status colour + glyph (the colour-safe shapes when that is on), the name,
 * the job, the current todo (or the question when they wait on you), time in that state, a "needs you" badge, today's
 * cost, and pin / mute marks. Docs: docs/valley/ops.md. Order and keyboard maths are pure: model/overview.ts.
 *
 * Keys: arrows / Home / End / PgUp / PgDn move, Enter opens the terminal, Shift+Enter walks there, Ctrl+Enter (or C)
 * the card, Alt+P pins, Alt+M mutes, Esc (or V again) closes. Tiles are `option`s of a `listbox` grid.
 */
import './overview.css';
import type { FarmerView } from '../model/types.ts';
import { columnsOf, gridMove, overviewOrder, tileState } from '../model/overview.ts';
import { STATUS_GLYPH } from '../model/prefs.ts';
import { costLabel, tokensLabel } from '../model/signals.ts';
import { MUTE_HELP, PIN_HELP } from '../model/marks.ts';
import { farmerFace, ICONS, icon } from './icons.ts';
import { dur, JOB_LABEL, seedHue, shortName, STATUS_LABEL } from './format.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';
import { mascotOf } from '../model/mascots.ts';

const STATE_LABEL = { blocked: 'Needs you', working: 'Working', done: 'Done', idle: 'Idle', unknown: 'Unknown' } as const;

export function createOverview(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('overview', 'Every agent', ICONS.eye);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const summary = h('div.vh-ov-sum', { 'aria-live': 'polite' });
  const grid = h('div.vh-ov-grid.vh-scroll', { role: 'listbox', 'aria-label': 'Every agent', tabindex: '0', 'data-testid': 'overview-grid' });
  const foot = h('div.vh-foot', null,
    h('span', null, h('kbd.vh-k', { text: '←↑↓→' }), 'choose'),
    h('span', null, h('kbd.vh-k', { text: 'Enter' }), 'terminal'),
    h('span', null, h('kbd.vh-k', { text: 'Shift+Enter' }), 'walk'),
    h('span', null, h('kbd.vh-k', { text: 'C' }), 'card'),
    h('span', null, h('kbd.vh-k', { text: 'Alt+P' }), 'pin'),
    h('span', null, h('kbd.vh-k', { text: 'Alt+M' }), 'mute'),
    h('span', null, h('kbd.vh-k', { text: 'Esc' }), 'close'));
  body.append(summary, grid, foot);

  let order: string[] = [];
  let sel: string | null = null;
  const tiles = new Map<string, HTMLElement>();

  const select = (id: string | null, focus = true) => {
    sel = id;
    for (const [tid, t] of tiles) { const on = tid === id; t.classList.toggle('sel', on); t.setAttribute('aria-selected', String(on)); }
    if (id) {
      grid.setAttribute('aria-activedescendant', `vh-ov-${cssId(id)}`);
      if (focus) tiles.get(id)?.scrollIntoView?.({ block: 'nearest' });
    }
  };

  const tile = (f: FarmerView): HTMLElement => {
    const t = h('div.vh-ov-tile', { role: 'option', id: `vh-ov-${cssId(f.id)}`, 'data-testid': 'overview-tile', 'data-id': f.id });
    t.addEventListener('click', (e) => { select(f.id, false); if ((e as MouseEvent).detail >= 2) ctx.openTerminal(f.id); });
    return t;
  };

  function fill(t: HTMLElement, f: FarmerView, now: number): void {
    const st = tileState(f);
    const pinned = ctx.marks.pinned(f.id), muted = ctx.marks.muted(f.id);
    const what = f.needsYou ? (f.question || 'waiting for your answer')
      : f.todos?.current ? `${f.todos.current}${f.todos.total ? ` (${f.todos.done}/${f.todos.total})` : ''}` : f.detail || f.title || '';
    const cost = f.spend ? costLabel(f.spend.cost) || `${tokensLabel(f.spend.tokens)} tok` : '';
    const since = dur(Math.max(0, now - f.jobSince));
    const sig = `${st}|${f.tag}|${f.job}|${what}|${cost}|${since}|${pinned}|${muted}|${f.struggle}|${f.tier}`;
    if (t.dataset.sig === sig) return;
    t.dataset.sig = sig;
    t.dataset.st = st;
    t.classList.toggle('pinned', pinned);
    t.classList.toggle('muted', muted);
    const face = h('span.face', { 'aria-hidden': 'true' });
    face.innerHTML = farmerFace(seedHue(f.seed), mascotOf(f.kind, f.vendor), f.tier);
    const marks = h('span.marks', null,
      pinned ? h('span.mk', { title: PIN_HELP, 'aria-label': 'pinned' }, icon(ICONS.pin)) : null,
      muted ? h('span.mk', { title: MUTE_HELP, 'aria-label': 'muted' }, icon(ICONS.muted)) : null);
    t.replaceChildren(
      face,
      h('span.nm', { text: shortName(f), title: f.name }),
      marks,
      // status glyph (shape + colour), the job, then the current todo / the question
      h('span.line', { title: what },
        h('span.st', { 'aria-hidden': 'true', text: STATUS_GLYPH[st] }),
        h('b.job', { text: f.needsYou ? 'Needs you' : `${JOB_LABEL[f.job]}${f.struggle >= 2 ? ' · struggling' : ''}` }),
        what ? h('span.what', { text: ` · ${what}` }) : null),
      h('span.meta', null,
        f.needsYou ? h('span.badge', { 'data-testid': 'overview-waiting' }, `waiting ${since}`) : h('span.since', { title: `${STATUS_LABEL[f.status]} for ${since}`, text: since }),
        cost ? h('span.cost', { title: 'today (an estimate at list prices)', text: cost }) : null));
    t.setAttribute('aria-label', `${shortName(f)}: ${STATE_LABEL[st]}${f.needsYou ? `, waiting ${since}: ${what}` : `, ${JOB_LABEL[f.job]} for ${since}${what ? `: ${what}` : ''}`}${cost ? `, ${cost} today` : ''}${pinned ? ', pinned' : ''}${muted ? ', muted' : ''}`);
  }

  function render(): void {
    const s = ctx.state();
    if (!s) return;
    const list = overviewOrder(s.farmers.values(), ctx.prefs.pinned);
    const ids = list.map((f) => f.id);
    if (ids.join(',') !== order.join(',')) {
      order = ids;
      for (const id of [...tiles.keys()]) if (!ids.includes(id)) tiles.delete(id);
      const nodes = list.map((f) => { let t = tiles.get(f.id); if (!t) { t = tile(f); tiles.set(f.id, t); } return t; });
      grid.replaceChildren(...nodes);
      if (!list.length) grid.append(h('div.vh-empty', null, icon(ICONS.sprout), 'No agents in the valley yet.', h('small', { text: 'Open a herdr workspace and start an agent: it shows up here.' })));
    }
    for (const f of list) fill(tiles.get(f.id)!, f, s.now);
    if (!sel || !ids.includes(sel)) select(ids[0] ?? null, false);
    else select(sel, false);
    let need = 0, work = 0, done = 0;
    for (const f of list) { const st = tileState(f); if (st === 'blocked') need++; else if (st === 'working') work++; else if (st === 'done') done++; }
    const txt = `${list.length} agent${list.length === 1 ? '' : 's'} · ${need} need${need === 1 ? 's' : ''} you · ${work} working · ${done} done${ctx.prefs.pinned.length ? ` · ${list.filter((f) => ctx.marks.pinned(f.id)).length} pinned` : ''}`;
    if (summary.textContent !== txt) summary.textContent = txt;
  }

  const cols = () => columnsOf([...grid.querySelectorAll<HTMLElement>('.vh-ov-tile')].slice(0, 16).map((t) => t.offsetTop));

  return {
    id: 'overview', el,
    onOpen() { order = []; render(); grid.focus({ preventScroll: true }); select(sel); },
    refresh: render,
    key(e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (!order.length) return true;
        const i = gridMove(sel ? order.indexOf(sel) : 0, e.key, cols(), order.length);
        select(order[i]);
        return true;
      }
      if (!sel) return false;
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyP' || e.code === 'KeyM')) { ctx.marks.toggle(e.code === 'KeyP' ? 'pinned' : 'muted', sel); render(); return true; }
      if (e.key === 'Enter' && !e.altKey && !(e.target instanceof HTMLButtonElement)) {
        if (e.ctrlKey || e.metaKey) ctx.panels.open('card', sel);
        else if (e.shiftKey) { ctx.travel(sel); ctx.panels.close(); } else ctx.openTerminal(sel, { enterAt: e.timeStamp });
        return true;
      }
      if (e.code === 'KeyC' && !e.ctrlKey && !e.altKey && !e.metaKey) { ctx.panels.open('card', sel); return true; }
      if (e.code === ctx.prefs.keys.overview && !e.ctrlKey && !e.altKey && !e.metaKey) { ctx.panels.close(); return true; }
      return false;
    },
  };
}

const cssId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');
