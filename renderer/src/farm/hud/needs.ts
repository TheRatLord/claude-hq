/**
 * The needs-you strip: a persistent card for every farmer blocked on a prompt, with the question, one button per
 * option, "Terminal" and "Walk there". Sits above the modal backdrop so it stays clickable while any panel is open.
 * Alt+1…9 opens the terminal of the Nth card from anywhere.
 */
import type { FarmerView } from '../model/types.ts';
import { farmerFace, ICONS, icon } from './icons.ts';
import { ago, nice, seedHue } from './format.ts';
import { h, syncList, type HudCtx } from './ctx.ts';

/** at most this many cards show their answer buttons; the rest are one-liners (fewer if the column overflows) */
const FULL = 3;

export interface NeedsStrip { el: HTMLElement; refresh(): void; list(): FarmerView[] }

export function createNeeds(ctx: HudCtx): NeedsStrip {
  const title = h('div.vh-needs-title', null, icon(ICONS.bell), h('span', { text: 'Needs you' }));
  const cards = h('div', { style: { display: 'contents' } });
  const more = h('button.vh-btn.small.vh-needs-more', { type: 'button', onclick: () => ctx.panels.open('roster', { focus: 'blocked' }) });
  const el = h('div.vh-needs', { 'data-testid': 'needs-strip', role: 'region', 'aria-label': 'Farmers who need you' }, title, cards, more);
  const busy = new Set<string>();
  let current: FarmerView[] = [];
  let total = 0;
  let full = FULL;

  const make = (f: FarmerView): HTMLElement => {
    const card = h('article.vh-need', { 'data-testid': 'need-card', 'data-id': f.id });
    const id = f.id;
    const face = h('div.face');
    const name = h('div.name');
    const plot = h('div.plot');
    const hot = h('kbd.vh-k.hot');
    const q = h('div.q');
    const opts = h('div.opts');
    const term = h('button.vh-btn.small.primary', { type: 'button', title: 'Open the terminal', onclick: () => ctx.openTerminal(id) }, icon(ICONS.terminal), 'Terminal');
    const walk = h('button.vh-btn.small', { type: 'button', title: 'Walk to this farmer', onclick: () => ctx.travel(id) }, icon(ICONS.walk), 'Walk there');
    const more = h('button.vh-btn.small.gold.only-mini', { type: 'button', title: 'See the answers', onclick: () => ctx.panels.open('card', id) }, 'Answer…');
    card.append(h('div.top', null, face, h('div.who', null, name, plot), hot), q, opts, h('div.acts', null, term, more, walk));
    return card;
  };
  const update = (card: HTMLElement, f: FarmerView, i: number) => {
    const s = ctx.state();
    const sig = `${f.name}|${f.question}|${f.options.map((o) => `${o.key}:${o.label}`).join('|')}|${i}|${busy.has(f.id)}`;
    card.classList.toggle('busy', busy.has(f.id));
    card.classList.toggle('mini', ctx.prefs.compactStrip || i >= full);
    const since = s ? ago(f.jobSince, s.now) : '';
    const plot = card.querySelector('.plot');
    if (plot) plot.textContent = `${s?.plots.get(f.plotId)?.label ?? 'field'} · waiting ${since.replace(' ago', '')}`;
    if (card.dataset.sig === sig) return;
    card.dataset.sig = sig;
    const face = card.querySelector('.face');
    if (face) face.innerHTML = farmerFace(seedHue(f.seed), f.kind, f.tier);
    card.querySelector('.name')!.textContent = nice(f.name);
    const hot = card.querySelector('.hot') as HTMLElement;
    hot.textContent = i < 9 ? `Alt+${i + 1}` : '';
    hot.style.display = i < 9 ? '' : 'none';
    hot.title = 'Open this terminal from anywhere';
    card.querySelector('.q')!.textContent = f.question || 'Waiting for your answer';
    const opts = card.querySelector('.opts') as HTMLElement;
    opts.replaceChildren(...f.options.map((o) => h('button.vh-btn.gold.answer', {
      type: 'button', title: o.label, 'data-testid': 'need-answer',
      onclick: async () => {
        if (busy.has(f.id)) return;
        busy.add(f.id); refresh();
        try { await ctx.answer(f.id, o.key, o.label); } finally { busy.delete(f.id); refresh(); }
      },
    }, h('span.num', { text: o.key }), h('span.lab', { text: o.label }))));
  };

  function refresh(): void {
    const s = ctx.state();
    const list = s ? [...s.farmers.values()].filter((f) => f.needsYou).sort((a, b) => a.jobSince - b.jobSince || a.id.localeCompare(b.id)) : [];
    current = list;
    total = list.length;
    el.style.display = list.length ? '' : 'none';
    title.lastElementChild!.textContent = list.length === 1 ? '1 farmer needs you' : `${list.length} farmers need you`;
    const shown = list.slice(0, 6);
    let i = 0;
    const idx = new Map(shown.map((f) => [f.id, i++]));
    const rest = list.length - shown.length;
    more.style.display = rest > 0 ? '' : 'none';
    more.textContent = `+${rest} more waiting · open the ledger`;
    // fit the column: demote the last full card while it overflows; promote again when there is clearly room
    const apply = () => syncList(cards, shown, (f) => f.id, make, (c, f) => update(c, f, idx.get(f.id) ?? 0));
    apply();
    if (!el.offsetParent) return;
    const room = () => el.clientHeight - el.scrollHeight;
    while (full > 0 && room() < 0) { full--; apply(); }
    if (full < Math.min(FULL, list.length) && el.parentElement && el.parentElement.clientHeight - el.offsetTop - el.scrollHeight > 300) full++;
  }
  refresh();
  return { el, refresh, list: () => current };
}
