/**
 * The needs-you strip (top left, under the status sign): a count chip, then every farmer blocked on a prompt, newest
 * on top. One card is open (the newest, or the one you clicked) with the question, one button per answer, Terminal
 * and Walk there; the others are one-line rows that open on click / Enter. The chip folds the list away (Alt+0).
 * Sits above the modal backdrop so it stays clickable while a panel is open (centred panels make room for it).
 * Alt+1…9 opens the terminal of the Nth farmer from anywhere.
 */
import type { FarmerView } from '../model/types.ts';
import { farmerFace, ICONS, icon } from './icons.ts';
import { ago, altName, askOrder, seedHue, shortName } from './format.ts';
import { h, syncList, type HudCtx } from './ctx.ts';

/** rows beyond this go behind "+N more" (they are all in the mailbox's Needs you tab) */
const MAX = 9;

export interface NeedsStrip { el: HTMLElement; refresh(): void; list(): FarmerView[]; toggle(): void }

export function createNeeds(ctx: HudCtx): NeedsStrip {
  const count = h('span');
  const caret = h('span.caret', { 'aria-hidden': 'true' });
  const title = h('button.vh-needs-title', { type: 'button', 'data-testid': 'needs-chip', onclick: () => toggle() }, icon(ICONS.bell), count, caret);
  const cards = h('div.vh-needs-list.vh-scroll');
  const more = h('button.vh-btn.small.vh-needs-more', { type: 'button', onclick: () => ctx.panels.open('mailbox', 'needs') });
  const el = h('div.vh-needs', { 'data-testid': 'needs-strip', role: 'region', 'aria-label': 'Farmers who need you' }, title, cards, more);
  const busy = new Set<string>();
  let current: FarmerView[] = [];
  let active: string | null = null;

  const select = (id: string) => {
    active = id;
    refresh();
    cards.querySelector(`[data-key="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const make = (f: FarmerView): HTMLElement => {
    const id = f.id;
    const card = h('article.vh-need', { 'data-testid': 'need-card', 'data-id': id });
    const term = h('button.vh-btn.small.primary', { type: 'button', title: 'Open the terminal', onclick: () => ctx.openTerminal(id) }, icon(ICONS.terminal), 'Terminal');
    const walk = h('button.vh-btn.small', { type: 'button', title: 'Walk to this farmer', onclick: () => ctx.travel(id) }, icon(ICONS.walk), 'Walk there');
    const quick = h('button.vh-need-term', { type: 'button', title: 'Open the terminal', 'aria-label': 'Terminal', onclick: () => ctx.openTerminal(id) }, icon(ICONS.terminal));
    card.append(h('div.top', null, h('div.face'), h('div.who', null, h('div.name'), h('div.plot')), h('kbd.vh-k.hot'), quick),
      h('div.q'), h('div.opts'), h('div.acts', null, term, walk));
    // a folded row opens on click / Enter (buttons inside keep their own meaning)
    card.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button') && active !== id) select(id); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) { e.preventDefault(); select(id); } });
    return card;
  };

  const update = (card: HTMLElement, f: FarmerView, i: number, open: boolean) => {
    const s = ctx.state();
    const isBusy = busy.has(f.id);
    card.classList.toggle('busy', isBusy);
    card.classList.toggle('row', !open);
    if (open) card.removeAttribute('tabindex'); else card.tabIndex = 0;
    card.setAttribute('aria-expanded', String(open));
    const since = s ? ago(f.jobSince, s.now).replace(' ago', '') : '';
    const field = s?.plots.get(f.plotId)?.label ?? 'field';
    const plot = card.querySelector('.plot') as HTMLElement;
    const alt = altName(f);
    const pt = open ? `${alt ? `${alt} · ` : ''}${field} · waiting ${since}` : `${field} · ${since}`;
    if (plot.textContent !== pt) plot.textContent = pt;
    const sig = `${f.name}|${f.tag}|${f.question}|${f.options.map((o) => `${o.key}:${o.label}`).join('|')}|${i}|${isBusy}|${open}`;
    if (card.dataset.sig === sig) return;
    card.dataset.sig = sig;
    (card.querySelector('.face') as HTMLElement).innerHTML = farmerFace(seedHue(f.seed), f.kind, f.tier);
    const name = card.querySelector('.name') as HTMLElement;
    name.textContent = shortName(f);
    name.title = [shortName(f), altName(f)].filter(Boolean).join(' · ');
    const hot = card.querySelector('.hot') as HTMLElement;
    hot.textContent = i < 9 ? `Alt+${i + 1}` : '';
    hot.style.display = i < 9 ? '' : 'none';
    hot.title = 'Open this terminal from anywhere';
    const q = card.querySelector('.q') as HTMLElement;
    q.textContent = f.question || 'Waiting for your answer';
    q.title = open ? '' : q.textContent;
    const opts = card.querySelector('.opts') as HTMLElement;
    opts.replaceChildren(...(open ? f.options.map((o) => h('button.vh-btn.gold.answer', {
      type: 'button', title: o.label, 'data-testid': 'need-answer',
      onclick: async () => {
        if (busy.has(f.id)) return;
        busy.add(f.id); refresh();
        try { await ctx.answer(f.id, o.key, o.label); } finally { busy.delete(f.id); refresh(); }
      },
    }, h('span.num', { text: o.key }), h('span.lab', { text: o.label }))) : []));
  };

  function toggle(): void {
    ctx.prefs.compactStrip = !ctx.prefs.compactStrip;
    ctx.savePrefs();
    refresh();
  }

  function refresh(): void {
    const s = ctx.state();
    // newest first: the ask that just arrived is the one you are most likely looking for
    const list = s ? [...s.farmers.values()].filter((f) => f.needsYou).sort((a, b) => askOrder({ since: a.jobSince, id: a.id }, { since: b.jobSince, id: b.id })) : [];
    current = list;
    const folded = ctx.prefs.compactStrip;
    el.style.display = list.length ? '' : 'none';
    el.classList.toggle('folded', folded);
    ctx.layer.classList.toggle('has-needs', list.length > 0 && !folded);
    count.textContent = list.length === 1 ? '1 farmer needs you' : `${list.length} farmers need you`;
    caret.textContent = folded ? '▸' : '▾';
    title.title = folded ? 'Show who needs you (Alt+0)' : 'Fold this list away (Alt+0)';
    title.setAttribute('aria-expanded', String(!folded));
    if (!list.some((f) => f.id === active)) active = list[0]?.id ?? null;
    const shown = folded ? [] : list.slice(0, MAX);
    const idx = new Map(list.map((f, i) => [f.id, i]));
    syncList(cards, shown, (f) => f.id, make, (c, f) => update(c, f, idx.get(f.id) ?? 0, f.id === active));
    const rest = folded ? 0 : list.length - shown.length;
    more.style.display = rest > 0 ? '' : 'none';
    more.textContent = `+${rest} more waiting · open the mailbox`;
  }
  refresh();
  return { el, refresh, list: () => current, toggle };
}
