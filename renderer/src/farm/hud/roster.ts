/**
 * The ledger (Tab): every farmer and scarecrow grouped by field, with status, job, time in status, ducklings.
 * Keyboard-first: type to filter, ↑/↓ to move, Enter = terminal, Shift+Enter (or W) = walk there, C = card.
 */
import type { FarmerView, HelperView, PlotView, ValleyState } from '../model/types.ts';
import { farmerFace, ICONS, KIND_ICON, icon } from './icons.ts';
import { dur, HELPER_LABEL, JOB_LABEL, JOB_REAL, kindLine, matches, nice, seedHue, STAGE_LABEL, STATUS_LABEL, STATUS_RANK, WS_COLORS } from './format.ts';
import { framePanel, h, typingIn, type HudCtx, type Panel } from './ctx.ts';

type Row = { id: string; kind: 'farmer'; f: FarmerView } | { id: string; kind: 'helper'; hp: HelperView };
interface Group { plot: PlotView | null; rows: Row[] }

function groups(s: ValleyState, q: string): Group[] {
  const out = new Map<string, Group>();
  const get = (plotId: string) => {
    let g = out.get(plotId);
    if (!g) { g = { plot: s.plots.get(plotId) ?? null, rows: [] }; out.set(plotId, g); }
    return g;
  };
  for (const f of s.farmers.values()) {
    const plot = s.plots.get(f.plotId);
    if (!matches(q, f.name, f.detail, f.title, f.question, plot?.label, STATUS_LABEL[f.status], JOB_LABEL[f.job], f.kind, f.needsYou ? 'needs blocked' : '')) continue;
    get(f.plotId).rows.push({ id: f.id, kind: 'farmer', f });
  }
  for (const hp of s.helpers.values()) {
    const plot = s.plots.get(hp.plotId);
    if (!matches(q, hp.name, hp.label, plot?.label, 'shell scarecrow', HELPER_LABEL[hp.activity])) continue;
    get(hp.plotId).rows.push({ id: hp.id, kind: 'helper', hp });
  }
  const rank = (r: Row) => (r.kind === 'farmer' ? STATUS_RANK[r.f.status] : 10);
  const list = [...out.values()];
  for (const g of list) g.rows.sort((a, b) => rank(a) - rank(b) || (a.kind === 'farmer' ? a.f.name : a.hp.name).localeCompare(b.kind === 'farmer' ? b.f.name : b.hp.name));
  const worst = (g: Group) => Math.min(...g.rows.map(rank));
  return list.sort((a, b) => worst(a) - worst(b) || (a.plot?.label ?? '~').localeCompare(b.plot?.label ?? '~'));
}

export function createRoster(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('roster', 'Farm Ledger', ICONS.book);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const input = h('input.vh-input', { type: 'text', placeholder: 'Filter by name, field, job, question…', 'aria-label': 'Filter farmers', 'data-autofocus': '', spellcheck: 'false', 'data-testid': 'roster-filter' });
  const summary = h('div.summary');
  const rowsEl = h('div.vh-rows.vh-scroll', { role: 'listbox', 'aria-label': 'Farmers', 'data-testid': 'roster-rows' });
  const foot = h('div.vh-foot', null,
    h('span', null, h('kbd.vh-k', { text: '↑' }), h('kbd.vh-k', { text: '↓' }), 'choose'),
    h('span', null, h('kbd.vh-k', { text: 'Enter' }), 'open terminal'),
    h('span', null, h('kbd.vh-k', { text: 'Shift+Enter' }), 'walk there'),
    h('span', null, h('kbd.vh-k', { text: 'Ctrl+I' }), 'details card'),
    h('span', null, h('kbd.vh-k', { text: 'Tab' }), '/', h('kbd.vh-k', { text: 'Esc' }), 'close'));
  body.append(h('div.top', null, h('div.vh-search', null, input), summary), rowsEl, foot);

  let sel: string | null = null;
  let visible: string[] = [];
  let sig = '';
  const rowEls = new Map<string, HTMLElement>();

  const select = (id: string | null, scroll = true) => {
    sel = id;
    for (const [rid, r] of rowEls) { const on = rid === id; r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on)); }
    if (id && scroll) rowEls.get(id)?.scrollIntoView({ block: 'nearest' });
  };
  const open = (id: string, enterAt?: number) => ctx.openTerminal(id, { enterAt });
  const walk = (id: string) => { ctx.travel(id); ctx.panels.close(); };
  const card = (id: string) => ctx.panels.open('card', id);

  function rowFor(r: Row, s: ValleyState): HTMLElement {
    const id = r.id;
    const acts = h('div.acts', null,
      h('button.vh-btn.small.primary', { type: 'button', title: 'Open terminal (Enter)', onclick: (e: Event) => { e.stopPropagation(); open(id); } }, icon(ICONS.terminal), 'Terminal'),
      h('button.vh-btn.small', { type: 'button', title: 'Walk there (Shift+Enter)', 'aria-label': 'Walk there', onclick: (e: Event) => { e.stopPropagation(); walk(id); } }, icon(ICONS.walk)));
    let row: HTMLElement;
    if (r.kind === 'farmer') {
      const f = r.f;
      const face = h('div.face'); face.innerHTML = farmerFace(seedHue(f.seed), f.kind, f.tier);
      const job = f.needsYou
        ? h('div.job.ask', { title: f.question ?? '' }, `Needs you: ${f.question ?? 'waiting'}`)
        : h('div.job', { title: `${JOB_REAL[f.job]}${f.detail ? ` · ${f.detail}` : ''}` }, h('b', { text: JOB_LABEL[f.job] }), f.detail ? ` · ${f.detail}` : f.title ? ` · ${f.title}` : '');
      const ducks = f.ducklings.filter((d) => d.active).length;
      row = h('div.vh-row', { role: 'option', 'data-testid': 'roster-row', 'data-id': id, 'data-status': f.status },
        face, h('div.nm', null, nice(f.name), h('small', { text: kindLine(f) })),
        h('div', null, h(`span.vh-pill.st-${f.status}`, { text: f.unseenDone ? 'Done ✓' : STATUS_LABEL[f.status] })),
        job,
        h('div.since', null, ducks ? h('span.ducks', { title: `${ducks} duckling${ducks === 1 ? '' : 's'} (subagents)` }, icon(ICONS.duck), String(ducks)) : null, h('span.t', { text: dur(s.now - f.lastActive) })),
        acts);
    } else {
      const hp = r.hp;
      const face = h('div.face'); face.innerHTML = ICONS.scarecrow;
      row = h('div.vh-row.helper', { role: 'option', 'data-testid': 'roster-row', 'data-id': id, 'data-status': 'helper' },
        face, h('div.nm', null, nice(hp.name), h('small', { text: 'Scarecrow · shell' })),
        h('div', null, h('span.vh-pill', { text: hp.running ? 'Running' : hp.exit === 'fail' ? 'Failed' : 'Resting', style: { background: hp.running ? '#d9a520' : hp.exit === 'fail' ? '#d0584a' : '#b09a78' } })),
        h('div.job', { title: hp.label }, h('b', { text: HELPER_LABEL[hp.activity] }), hp.label ? ` · ${hp.label}` : '', hp.ports.length ? ` · :${hp.ports.join(' :')}` : ''),
        h('div.since'), acts);
    }
    row.addEventListener('click', () => { select(id, false); });
    row.addEventListener('dblclick', () => open(id));
    return row;
  }

  function render(force = false): void {
    const s = ctx.state();
    if (!s) return;
    const q = input.value;
    const gs = groups(s, q);
    const nsig = `${q}#${gs.map((g) => `${g.plot?.id}:${g.plot?.stage}:${g.rows.map((r) => r.kind === 'farmer' ? `${r.id}/${r.f.status}/${r.f.job}/${r.f.detail}/${r.f.needsYou}/${r.f.unseenDone}/${r.f.ducklings.length}/${r.f.question}` : `${r.id}/${r.hp.running}/${r.hp.exit}/${r.hp.label}`).join(',')}`).join('|')}`;
    if (nsig !== sig || force) {
      sig = nsig;
      const keep = rowsEl.scrollTop;
      rowsEl.replaceChildren();
      rowEls.clear();
      visible = [];
      for (const g of gs) {
        const p = g.plot;
        const head = h('div.vh-ghead', null,
          p ? icon(KIND_ICON[p.kind]) : icon(ICONS.sprout),
          h('span.gl', { text: p?.label ?? 'Wandering' }),
          p ? h('span.swatch', { style: { background: WS_COLORS[p.colorIndex % WS_COLORS.length] } }) : null,
          h('span.gs', { text: p ? `${STAGE_LABEL[p.stage]} · ${g.rows.length} hand${g.rows.length === 1 ? '' : 's'}` : '' }));
        const grp = h('div.vh-group', null, head);
        for (const r of g.rows) { const re = rowFor(r, s); rowEls.set(r.id, re); visible.push(r.id); grp.append(re); }
        rowsEl.append(grp);
      }
      if (!visible.length) rowsEl.append(h('div.vh-empty', null, icon(ICONS.sprout), q ? `Nobody matches "${q}".` : 'No farmers in the valley yet. Open a herdr workspace to till a field.'));
      if (!sel || !visible.includes(sel)) sel = visible[0] ?? null;
      select(sel, false);
      rowsEl.scrollTop = keep;
    } else {
      for (const f of s.farmers.values()) {
        const t = rowEls.get(f.id)?.querySelector('.since .t');
        if (t) t.textContent = dur(s.now - f.lastActive);
      }
    }
    let need = 0, work = 0, done = 0;
    for (const f of s.farmers.values()) { if (f.needsYou) need++; else if (f.status === 'working') work++; else if (f.unseenDone) done++; }
    summary.replaceChildren(
      h('span.vh-pill.st-blocked', { text: `${need} need you` }),
      h('span.vh-pill.st-working', { text: `${work} working` }),
      h('span.vh-pill.st-done', { text: `${done} done` }));
  }

  input.addEventListener('input', () => { sel = null; render(); });

  return {
    id: 'roster', el,
    onOpen(arg) {
      input.value = '';
      render(true);
      const s = ctx.state();
      if (arg && typeof arg === 'object' && (arg as { focus?: string }).focus === 'blocked' && s) {
        const first = visible.find((id) => s.farmers.get(id)?.needsYou);
        if (first) select(first);
      }
      input.focus();
    },
    refresh() { render(); },
    key(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!visible.length) return true;
        const i = sel ? visible.indexOf(sel) : -1;
        const n = e.key === 'ArrowDown' ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1);
        select(visible[n]);
        return true;
      }
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        const i = sel ? visible.indexOf(sel) : 0;
        select(visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'PageDown' ? 8 : -8)))]);
        return true;
      }
      if (e.key === 'Enter' && sel && !(e.target instanceof HTMLButtonElement)) {
        if (e.shiftKey) walk(sel); else open(sel, e.timeStamp);
        return true;
      }
      if (sel && e.ctrlKey && (e.key === 'i' || e.key === 'I')) { if (ctx.farmer(sel)) card(sel); return true; }
      if (sel && !typingIn(e.target) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.code === 'KeyW') { walk(sel); return true; }
        if (e.code === 'KeyC') { if (ctx.farmer(sel)) card(sel); return true; }
      }
      if (e.key === 'Tab') { ctx.panels.close(); return true; }
      return false;
    },
  };
}
