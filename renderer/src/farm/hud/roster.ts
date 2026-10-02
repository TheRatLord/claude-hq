/**
 * The ledger (Tab): every farmer and scarecrow grouped by field, with status, job, time in status, ducklings.
 * Keyboard-first: type to filter, ↑/↓ to move, Enter = terminal, Shift+Enter (or W) = walk there, Ctrl+I (or C) = card,
 * Ctrl+Enter = give an idle / finished farmer a new task. The summary chips (needs you · working · done · idle) are
 * status filters (click the active chip again for everyone); typing "needs", "working", "done" filters by text too.
 * Each farmer row carries a mini day strip (timeline.ts) on one shared window, so the agents' days compare at a glance.
 */
import type { FarmerView, HelperView, PlotView, ValleyState } from '../model/types.ts';
import { farmerFace, ICONS, KIND_ICON, icon } from './icons.ts';
import { agentName, altName, dur, fieldName, shortName, HELPER_LABEL, JOB_LABEL, JOB_REAL, kindLine, matches, nice, rosterFilterHit, seedHue, STAGE_LABEL, STATUS_LABEL, STATUS_RANK, WS_COLORS, type RosterFilter } from './format.ts';
import { framePanel, h, typingIn, type HudCtx, type Panel } from './ctx.ts';
import { earliest, stripRange } from '../model/timeline.ts';
import { paintMiniStrip } from './timeline.ts';
import { branchName, repoBits, spendLine } from './format.ts';
import { costLabel, tokensLabel } from '../model/signals.ts';
import './signals.css';
import { mascotOf } from '../model/mascots.ts';

const CHIPS = ['needs', 'working', 'done', 'idle'] as const;
type Row = { id: string; kind: 'farmer'; f: FarmerView } | { id: string; kind: 'helper'; hp: HelperView };
interface Group { plot: PlotView | null; rows: Row[] }

function groups(s: ValleyState, q: string, only: RosterFilter): Group[] {
  const out = new Map<string, Group>();
  const get = (plotId: string) => {
    let g = out.get(plotId);
    if (!g) { g = { plot: s.plots.get(plotId) ?? null, rows: [] }; out.set(plotId, g); }
    return g;
  };
  for (const f of s.farmers.values()) {
    const plot = s.plots.get(f.plotId);
    if (!rosterFilterHit(only, f)) continue;
    if (!matches(q, f.name, f.tag, f.project, f.detail, f.title, f.question, plot?.label, STATUS_LABEL[f.status], JOB_LABEL[f.job], f.kind, agentName(f), f.needsYou ? 'needs blocked' : '')) continue;
    get(f.plotId).rows.push({ id: f.id, kind: 'farmer', f });
  }
  for (const hp of only ? [] : s.helpers.values()) {
    const plot = s.plots.get(hp.plotId);
    if (!matches(q, hp.name, hp.tag, hp.project, hp.label, plot?.label, 'shell scarecrow', HELPER_LABEL[hp.activity])) continue;
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
    h('span', null, h('kbd.vh-k', { text: 'Ctrl+Enter' }), 'new task'),
    h('span', null, h('kbd.vh-k', { text: 'Tab' }), '/', h('kbd.vh-k', { text: 'Esc' }), 'close'));
  body.append(h('div.top', null, h('div.vh-search', null, input), summary), rowsEl, foot);

  let sel: string | null = null;
  let only: RosterFilter = null;
  const setOnly = (f: RosterFilter) => { only = only === f ? null : f; sel = null; summary.dataset.sig = ''; render(); };
  let visible: string[] = [];
  let sig = '';
  const rowEls = new Map<string, HTMLElement>();
  /** per row: its mini day strip (kept across row refills) */
  const strips = new Map<string, HTMLElement>();
  const stripOf = (id: string) => { let el = strips.get(id); if (!el) { el = h('span.vh-lstrip', { 'data-testid': 'roster-day' }); strips.set(id, el); } return el; };

  const select = (id: string | null, scroll = true) => {
    sel = id;
    for (const [rid, r] of rowEls) { const on = rid === id; r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on)); }
    if (id && scroll) rowEls.get(id)?.scrollIntoView({ block: 'nearest' });
  };
  const open = (id: string, enterAt?: number) => ctx.openTerminal(id, { enterAt });
  const walk = (id: string) => { ctx.travel(id); ctx.panels.close(); };
  const card = (id: string) => ctx.panels.open('card', id);
  /** an idle / finished farmer: the card with the new-task box focused */
  const canTask = (f: FarmerView | undefined) => !!f && !f.needsYou && (f.status === 'idle' || f.status === 'done');
  const task = (id: string) => ctx.panels.open('card', { id, task: canTask(ctx.farmer(id)) });

  const rowSig = (r: Row): string => r.kind === 'farmer'
    ? `f|${r.f.name}|${r.f.tag}|${r.f.status}|${r.f.job}|${r.f.detail}|${r.f.title}|${r.f.needsYou}|${r.f.unseenDone}|${r.f.ducklings.filter((d) => d.active).length}|${r.f.question}|${r.f.tier}|${r.f.model}|${spendCell(r.f)}`
    : `h|${r.hp.name}|${r.hp.tag}|${r.hp.running}|${r.hp.exit}|${r.hp.label}|${r.hp.activity}|${r.hp.ports.join(',')}`;

  /** the ledger's spend column: '$1.24' (or '2.1M tok' for an unpriced model); '' when nothing today */
  const spendCell = (f: FarmerView): string => (f.spend ? costLabel(f.spend.cost) || `${tokensLabel(f.spend.tokens)} tok` : '');

  function rowFor(r: Row): HTMLElement {
    const id = r.id;
    const row = h('div.vh-row', { role: 'option', 'data-testid': 'roster-row', 'data-id': id });
    row.addEventListener('click', () => { select(id, false); });
    row.addEventListener('dblclick', () => open(id));
    return row;
  }

  /** (re)fill a row's cells; called only when its signature changes */
  function fillRow(row: HTMLElement, r: Row): void {
    const id = r.id;
    const acts = h('div.acts', null,
      h('button.vh-btn.small.term', { type: 'button', title: 'Open terminal (Enter)', onclick: (e: Event) => { e.stopPropagation(); open(id); } }, icon(ICONS.terminal), 'Terminal'),
      h('button.vh-btn.small', { type: 'button', title: 'Walk there (W)', 'aria-label': 'Walk there', onclick: (e: Event) => { e.stopPropagation(); walk(id); } }, icon(ICONS.walk)));
    if (r.kind === 'farmer' && canTask(r.f)) acts.prepend(h('button.vh-btn.small.task', { type: 'button', title: 'Give a new task (Ctrl+Enter)', 'aria-label': 'Give a new task', 'data-testid': 'roster-task', onclick: (e: Event) => { e.stopPropagation(); task(id); } }, icon(ICONS.send)));
    const ago = h('span.t', { title: 'time since their last activity' });
    if (r.kind === 'farmer') {
      const f = r.f;
      const face = h('div.face'); face.innerHTML = farmerFace(seedHue(f.seed), mascotOf(f.kind, f.vendor), f.tier);
      const job = f.needsYou
        ? h('div.job.ask', { title: f.question ?? '' }, h('b', { text: 'Needs you: ' }), f.question ?? 'waiting')
        : h('div.job', { title: `${JOB_REAL[f.job]}${f.detail ? ` · ${f.detail}` : ''}${f.title ? `\nTask: ${f.title}` : ''}` }, h('b', { text: JOB_LABEL[f.job] }), f.detail ? ` · ${f.detail}` : f.title ? ` · ${f.title}` : '');
      const ducks = f.ducklings.filter((d) => d.active).length;
      const nm = fieldName(f), alt = altName(f, nm);
      row.className = 'vh-row';
      row.dataset.status = f.status;
      row.replaceChildren(
        face, h('div.nm', { title: [shortName(f), alt].filter(Boolean).join('\n') }, h('span.n', { text: nm }), h('small', { text: alt ? `${kindLine(f)} · ${alt}` : kindLine(f) })),
        h('div', null, h(`span.vh-pill.st-${f.status}`, { text: f.unseenDone ? 'Done ✓' : STATUS_LABEL[f.status] })),
        stripOf(id),
        job,
        h('div.since', null, spendCell(f) ? h('span.spend', { title: `Today: ${spendLine(f.spend!)}`, 'data-testid': 'roster-spend' }, spendCell(f)) : null, ducks ? h('span.ducks', { title: `${ducks} duckling${ducks === 1 ? '' : 's'} (subagents)` }, icon(ICONS.duck), String(ducks)) : null, ago),
        acts);
    } else {
      const hp = r.hp;
      const face = h('div.face'); face.innerHTML = ICONS.scarecrow;
      const nm = fieldName(hp), alt = altName(hp, nm);
      row.className = 'vh-row helper';
      row.dataset.status = 'helper';
      row.replaceChildren(
        face, h('div.nm', { title: [shortName(hp), alt].filter(Boolean).join('\n') }, h('span.n', { text: nm }), h('small', { text: alt ? `Scarecrow · ${alt}` : 'Scarecrow · shell' })),
        h('div', null, h('span.vh-pill', { text: hp.running ? 'Running' : hp.exit === 'fail' ? 'Failed' : 'Resting', style: { background: hp.running ? '#c98f12' : hp.exit === 'fail' ? '#d0584a' : '#a08a68' } })),
        h('span.vh-lstrip', { 'aria-hidden': 'true' }),
        h('div.job', { title: hp.label }, h('b', { text: HELPER_LABEL[hp.activity] }), hp.label ? ` · ${hp.label}` : '', hp.ports.length ? ` · :${hp.ports.join(' :')}` : ''),
        h('div.since', null, ago), acts);
    }
    const on = id === sel;
    row.classList.toggle('sel', on);
    row.setAttribute('aria-selected', String(on));
  }

  function groupHead(g: Group): HTMLElement {
    const p = g.plot;
    const n = g.rows.length;
    let need = 0, work = 0;
    for (const r of g.rows) if (r.kind === 'farmer') { if (r.f.needsYou) need++; else if (r.f.status === 'working') work++; }
    const bits = [p ? STAGE_LABEL[p.stage] : '', `${n} hand${n === 1 ? '' : 's'}`, work ? `${work} working` : ''].filter(Boolean).join(' · ');
    return h('div.vh-ghead', null,
      p ? icon(KIND_ICON[p.kind]) : icon(ICONS.sprout),
      h('span.gl', { text: p?.label ?? 'Wandering' }),
      p ? h('span.swatch', { style: { background: WS_COLORS[p.colorIndex % WS_COLORS.length] } }) : null,
      h('span.gs', { text: bits }),
      p?.git ? h('span.repo', { title: `${p.git.repo} · ${branchName(p.git)}${repoBits(p.git) ? ` · ${repoBits(p.git)}` : ''}${p.git.lastCommit ? `\nLast commit: ${p.git.lastCommit.subject}` : ''}`, 'data-testid': 'roster-repo' },
        `${branchName(p.git)}${p.git.branches > 1 ? ` +${p.git.branches - 1}` : ''}${p.git.dirty ? ` · ${p.git.dirty} changed` : ''}${p.git.ahead ? ` · ↑${p.git.ahead}` : ''}${p.git.behind ? ` · ↓${p.git.behind}` : ''}`) : null,
      need ? h('span.vh-pill.st-blocked', { text: `${need} need${need === 1 ? 's' : ''} you` }) : null);
  }

  function render(force = false): void {
    const s = ctx.state();
    if (!s) return;
    const q = input.value;
    const gs = groups(s, q, only);
    const order = gs.map((g) => `${g.plot?.id ?? '-'}:${g.rows.map((r) => r.id).join(',')}`).join('|');
    if (force) { rowsEl.replaceChildren(); rowEls.clear(); sig = ''; }
    if (order !== sig) {
      // structure changed (rows added / removed / regrouped / reordered): rebuild the group shells, keep row nodes
      sig = order;
      const keep = rowsEl.scrollTop;
      const nodes: HTMLElement[] = [];
      visible = [];
      const live = new Set<string>();
      for (const g of gs) {
        const grp = h('div.vh-group', { role: 'group', 'aria-label': g.plot?.label ?? 'Wandering' }, groupHead(g));
        grp.dataset.head = '';
        for (const r of g.rows) {
          let re = rowEls.get(r.id);
          if (!re) { re = rowFor(r); rowEls.set(r.id, re); }
          live.add(r.id); visible.push(r.id); grp.append(re);
        }
        nodes.push(grp);
      }
      for (const id of [...rowEls.keys()]) if (!live.has(id)) { rowEls.delete(id); strips.delete(id); }
      const away = s.link === 'offline' || s.link === 'herdr-offline' || s.link === 'connecting';
      if (!visible.length && only) nodes.push(h('div.vh-empty', null, icon(ICONS.sprout), `Nobody ${only === 'needs' ? 'needs you' : `is ${only === 'done' ? 'done' : only}`}${q ? ` matching "${q}"` : ''} right now.`,
        h('small', { text: 'Click the chip again to see everyone.' })));
      else if (!visible.length) nodes.push(h('div.vh-empty', null, icon(ICONS.sprout), q ? `Nobody matches "${q}".`
        : away ? 'The ledger is waiting for herdr.' : 'No farmers in the valley yet.',
        h('small', { text: q ? 'Try a name, a field, a job (“testing”) or “needs”.' : away ? 'Your agents appear here the moment herdr answers again.' : 'Open a herdr workspace and start an agent: a field gets tilled and its farmer shows up here.' })));
      rowsEl.replaceChildren(...nodes);
      if (!sel || !visible.includes(sel)) sel = visible[0] ?? null;
      rowsEl.scrollTop = keep;
    }
    // per row: refill only what changed; the time column is cheap text
    const byId = new Map<string, Row>();
    for (const g of gs) for (const r of g.rows) byId.set(r.id, r);
    for (const g of gs) {
      const head = rowEls.get(g.rows[0]?.id ?? '')?.parentElement?.firstElementChild as HTMLElement | null | undefined;
      const hs = `${g.plot?.stage}|${g.rows.map((r) => (r.kind === 'farmer' ? `${r.f.needsYou}${r.f.status}` : '')).join('')}|${g.plot?.git ? `${branchName(g.plot.git)}${g.plot.git.branches}${repoBits(g.plot.git)}` : ''}`;
      if (head && head.dataset.sig !== hs) { const nh = groupHead(g); nh.dataset.sig = hs; head.replaceWith(nh); }
    }
    // day strips share one window (the earliest record today → now, in 5-minute steps) and repaint only on a change
    const tl = s.timeline;
    const range = stripRange(earliest(tl.farmers.values()), Math.floor(tl.now / 300_000) * 300_000 || tl.now);
    for (const [id, re] of rowEls) {
      const r = byId.get(id);
      if (!r) continue;
      const rs = rowSig(r);
      if (re.dataset.sig !== rs) { re.dataset.sig = rs; fillRow(re, r); }
      if (r.kind === 'farmer') {
        const st = stripOf(id), fd = tl.farmers.get(id);
        const ds = `${fd?.rev ?? -1}|${range.from}|${range.to}`;
        if (st.dataset.sig !== ds) { st.dataset.sig = ds; paintMiniStrip(st, fd, range.from, range.to); }
      }
      if (r.kind === 'farmer') {
        const t = re.querySelector('.since .t');
        const txt = dur(s.now - r.f.lastActive);
        if (t && t.textContent !== txt) t.textContent = txt;
      }
    }
    select(sel, false);
    const n: Record<Exclude<RosterFilter, null>, number> = { needs: 0, working: 0, done: 0, idle: 0 };
    for (const f of s.farmers.values()) for (const k of CHIPS) if (rosterFilterHit(k, f)) n[k]++;
    const sp = s.spend;
    const spendTxt = sp && sp.tokens ? `${sp.partial ? '≥ ' : ''}${costLabel(sp.cost) || `${tokensLabel(sp.tokens)} tokens`} today` : '';
    const ssig = `${n.needs}|${n.working}|${n.done}|${n.idle}|${s.farmers.size}|${s.helpers.size}|${only}|${spendTxt}`;
    if (summary.dataset.sig !== ssig) {
      summary.dataset.sig = ssig;
      const chip = (k: Exclude<RosterFilter, null>, cls: string, label: string) => (n[k] || only === k ? [h(`button.vh-pill.chip.${cls}${only === k ? '.on' : ''}`, {
        type: 'button', 'aria-pressed': String(only === k), 'data-testid': `roster-chip-${k}`,
        title: only === k ? 'Show everyone' : `Only farmers who ${k === 'needs' ? 'need you' : k === 'done' ? 'are done' : `are ${k}`}`,
        onclick: () => setOnly(k),
      }, `${n[k]} ${label}`)] : []);
      summary.replaceChildren(
        ...chip('needs', 'st-blocked', n.needs === 1 ? 'needs you' : 'need you'),
        ...chip('working', 'st-working', 'working'),
        ...chip('done', 'st-done', 'done'),
        ...chip('idle', 'st-idle', 'idle'),
        h('span.vh-muted.count', { text: `${s.farmers.size} farmer${s.farmers.size === 1 ? '' : 's'}${s.helpers.size ? ` · ${s.helpers.size} scarecrow${s.helpers.size === 1 ? '' : 's'}` : ''}${only ? ' · filtered' : ''}` }),
        ...(spendTxt ? [h('span.vh-spend-sum', { 'data-testid': 'roster-spend-total', title: `${sp!.agents} agent${sp!.agents === 1 ? '' : 's'} today · ${tokensLabel(sp!.tokens)} tokens · an estimate at list prices` }, spendTxt)] : []));
    }
  }

  input.addEventListener('input', () => { sel = null; render(); });

  return {
    id: 'roster', el,
    onOpen(arg) {
      input.value = '';
      only = null;
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
      if (sel && e.ctrlKey && e.key === 'Enter') { if (ctx.farmer(sel)) task(sel); return true; }
      if (e.key === 'Enter' && sel && !(e.target instanceof HTMLButtonElement)) {
        if (e.shiftKey) walk(sel); else open(sel, e.timeStamp);
        return true;
      }
      if (sel && e.ctrlKey && (e.key === 'i' || e.key === 'I')) { if (ctx.farmer(sel)) card(sel); return true; }
      if (sel && !typingIn(e.target) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.code === 'KeyW') { walk(sel); return true; }
        if (e.code === 'KeyC') { if (ctx.farmer(sel)) card(sel); return true; }
      }
      // Tab closes the ledger while Tab is its key (Settings → Controls); Shift+Tab, or any Tab once the ledger has
      // another key, walks the ledger's controls (hud.ts)
      if (e.key === 'Tab' && !e.shiftKey && ctx.prefs.keys.ledger === 'Tab') { ctx.panels.close(); return true; }
      return false;
    },
  };
}
