/**
 * The command palette (Ctrl+K, ⌘K on a Mac): one fuzzy search box for every agent, every panel and the common actions,
 * from anywhere (the valley, any panel, a terminal you are watching). Docs: docs/valley/ops.md.
 *
 * Empty, it is the focus queue (model/ops.ts focusQueue: asks, struggling, unreviewed finishes) followed by everyone
 * else and the panels. Typing matches agents by name, field, project, job, task, question, their todo list and the
 * last thing they said (the row shows that line when it is what matched), answers to open asks ("pebble yes"), "new
 * task" for idle / finished farmers, and panels / actions by name.
 *
 * Enter runs the selection: an agent's terminal (Shift+Enter: walk there, Ctrl+Enter: their card, with the new-task
 * box when they are free); Esc goes back to where you were (the terminal or panel the palette was opened over).
 */
import './palette.css';
import type { FarmerView, HelperView, ValleyState } from '../model/types.ts';
import { FOCUS_LABEL, fieldsMatch, findNeedle, focusQueue, SEARCH_DEBOUNCE_MS, SEARCH_ROWS, snippet, wantsScrollSearch, type FocusWhy } from '../model/ops.ts';
import { markLabel } from '../model/marks.ts';
import type { ScrollHit } from '../../../../shared/protocol.ts';
import { keyLabel } from '../model/prefs.ts';
import { farmerFace, ICONS } from './icons.ts';
import { agentName, HELPER_LABEL, JOB_LABEL, seedHue, shortName, STATUS_LABEL, STATUS_RANK } from './format.ts';
import { h, typingIn, type HudCtx, type Panel, type PanelId } from './ctx.ts';
import { mascotOf } from '../model/mascots.ts';

/** where Esc goes back to: a panel (and its argument) or a terminal */
export type PaletteBack = { panel: PanelId; arg?: unknown } | { terminal: string } | null;
export interface PaletteHooks {
  /** Alt+N: the next one in the focus queue (hud.ts) */
  next(): void;
  /** the minimap toggle (N) */
  minimap(): void;
}

type Mods = { shift: boolean; ctrl: boolean };
interface Entry {
  key: string;
  kind: 'farmer' | 'helper' | 'answer' | 'task' | 'panel' | 'action' | 'line';
  label: string;
  sub: string;
  /** the key cap shown on the right */
  cap?: string;
  why?: FocusWhy;
  status?: string;
  face?: string;
  fields: { text: string | null | undefined; weight?: number }[];
  /** indices of fields whose match is worth showing as the sub line (what they said, a todo) */
  quote?: number[];
  /** only offered once you type (answers, new tasks) */
  typed?: boolean;
  /** ranking nudge (agents before panels on equal matches) */
  boost?: number;
  /** a pinned agent (model/marks.ts): the empty palette lists them first */
  pinned?: boolean;
  /** a terminal line (`term.search`): the [start, end) of the match inside `sub` */
  mark?: [number, number];
  run(m: Mods): void;
}

const MAX_ROWS = 40;

export function createPalette(ctx: HudCtx, hooks: PaletteHooks): Panel & { back(): PaletteBack; dismiss(): void } {
  const input = h('input.vh-input', {
    type: 'text', placeholder: 'Find an agent, an answer, a panel…', 'aria-label': 'Search agents, panels and actions', 'data-autofocus': '',
    spellcheck: 'false', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'vh-palette-list', 'aria-autocomplete': 'list',
    'data-testid': 'palette-input',
  }) as HTMLInputElement;
  const list = h('div.vh-pal-list.vh-scroll', { id: 'vh-palette-list', role: 'listbox', 'aria-label': 'Results', 'data-testid': 'palette-list' });
  const count = h('span.vh-pal-count', { 'aria-live': 'polite' });
  const foot = h('div.vh-foot', null,
    h('span', null, h('kbd.vh-k', { text: '↑' }), h('kbd.vh-k', { text: '↓' }), 'choose'),
    h('span', null, h('kbd.vh-k', { text: 'Enter' }), 'go'),
    h('span', null, h('kbd.vh-k', { text: 'Shift+Enter' }), 'walk there'),
    h('span', null, h('kbd.vh-k', { text: 'Ctrl+Enter' }), 'card / new task'),
    h('span', null, h('kbd.vh-k', { text: 'Esc' }), 'back'), count);
  const el = h('section.vh-palette.vh-wood', { 'aria-label': 'Command palette', 'data-testid': 'panel-palette' },
    h('div.vh-paper.vh-pal-paper', null, h('div.vh-search', null, input), list, foot));

  let entries: Entry[] = [];
  let shown: Entry[] = [];
  let sel = 0;
  let back: PaletteBack = null;
  let sig = '';
  // ---- the terminals' scrollback (`term.search`, rev 5): debounced, one request at a time, the latest query wins ----
  let lines: { q: string; hits: ScrollHit[]; more: number } | null = null;
  let searching: string | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchErr = '';
  const searchSoon = () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!wantsScrollSearch(q) || !ctx.b?.agents.search) { searching = null; return; }
    searching = q;
    searchTimer = setTimeout(() => void runSearch(q), SEARCH_DEBOUNCE_MS);
  };
  const runSearch = async (q: string) => {
    const port = ctx.b?.agents;
    if (!port?.search || input.value.trim() !== q) return;
    const r = await port.search(q, 24).catch((e: unknown) => ({ ok: false as const, error: String(e), result: undefined }));
    if (input.value.trim() !== q) return; // typed on meanwhile: that search is coming
    searching = null;
    if (r.ok && r.result) { lines = { q, hits: r.result.hits, more: r.result.more }; searchErr = ''; }
    else { lines = null; searchErr = r.error ?? ''; if (/too fast/.test(searchErr)) { searchSoon(); return; } }
    filter();
  };

  // ---- building the entries ----
  const farmerEntries = (s: ValleyState): Entry[] => {
    const out: Entry[] = [];
    const queue = focusQueue(s.farmers.values());
    const why = new Map(queue.map((q, i) => [q.id, { why: q.why, i }]));
    const farmers = [...s.farmers.values()].sort((a, b) => {
      const qa = why.get(a.id)?.i ?? 1e3, qb = why.get(b.id)?.i ?? 1e3;
      const pa = ctx.marks.pinned(a.id) ? 0 : 1, pb = ctx.marks.pinned(b.id) ? 0 : 1;
      return pa - pb || qa - qb || STATUS_RANK[a.status] - STATUS_RANK[b.status] || shortName(a).localeCompare(shortName(b));
    });
    for (const f of farmers) {
      const plot = s.plots.get(f.plotId);
      const w = why.get(f.id)?.why;
      const todos = f.todos?.items.map((t) => t.text).join(' · ') ?? '';
      const pinned = ctx.marks.pinned(f.id), muted = ctx.marks.muted(f.id);
      out.push({
        key: `f:${f.id}`, kind: 'farmer', label: `${shortName(f)}${muted ? ' (muted)' : ''}`, why: w, status: f.needsYou ? 'blocked' : f.status, pinned,
        sub: farmerSub(f, plot?.label ?? ''),
        face: farmerFace(seedHue(f.seed), mascotOf(f.kind, f.vendor), f.tier),
        fields: [
          { text: f.tag, weight: 3 }, { text: f.name, weight: 2 }, { text: plot?.label, weight: 1.5 }, { text: f.project, weight: 1.5 },
          { text: `${STATUS_LABEL[f.status]} ${JOB_LABEL[f.job]} ${agentName(f)} ${f.needsYou ? 'needs you ask blocked' : ''} ${f.unseenDone ? 'finished done review' : ''}`, weight: 1 },
          { text: f.detail, weight: 1 }, { text: f.title, weight: 1 }, { text: f.question, weight: 1 },
          { text: f.said, weight: 0.6 }, { text: todos, weight: 0.6 },
        ],
        quote: [6, 7, 8, 9],
        boost: (w ? 300 : 200) + (pinned ? 150 : 0),
        run: (m) => {
          if (m.shift) ctx.travel(f.id);
          else if (m.ctrl) ctx.panels.open('card', { id: f.id, task: canTask(f) });
          else ctx.openTerminal(f.id);
        },
      });
      if (f.needsYou) for (const o of f.options) {
        out.push({
          key: `a:${f.id}:${o.key}`, kind: 'answer', typed: true, label: `Answer ${shortName(f)}: ${o.label}`, sub: f.question ?? 'waiting for you',
          cap: o.key, status: 'blocked',
          fields: [{ text: f.tag, weight: 2 }, { text: plot?.label }, { text: `answer reply ${o.label}`, weight: 1.5 }, { text: f.question, weight: 0.5 }],
          boost: 100,
          run: () => { void ctx.answer(f.id, o.key, o.label); },
        });
      }
      // pin / mute (model/marks.ts), offered once you type ("pin pebble", "mute flint")
      for (const [kind, on, words] of [['pinned', pinned, 'pin unpin keep top first favourite'], ['muted', muted, 'mute unmute quiet silence notifications sounds toasts']] as const) {
        out.push({
          key: `m:${kind}:${f.id}`, kind: 'action', typed: true, label: `${markLabel(kind, on)}: ${shortName(f)}`,
          sub: kind === 'pinned' ? 'first in the ledger, the needs-you strip, this palette and the overview' : on ? 'toasts, notifications and alert sounds come back' : 'no toasts, notifications or alert sounds; asks still show, quietly',
          face: kind === 'pinned' ? ICONS.pin : ICONS.muted,
          fields: [{ text: f.tag, weight: 2 }, { text: plot?.label }, { text: words, weight: 1.5 }],
          run: () => ctx.marks.toggle(kind, f.id),
        });
      }
      if (canTask(f)) {
        out.push({
          key: `t:${f.id}`, kind: 'task', typed: true, label: `New task for ${shortName(f)}`, sub: `${STATUS_LABEL[f.status]} · ${plot?.label ?? ''}`,
          fields: [{ text: f.tag, weight: 2 }, { text: plot?.label }, { text: 'new task give prompt start work', weight: 1.5 }],
          run: () => ctx.panels.open('card', { id: f.id, task: true }),
        });
      }
    }
    for (const hp of s.helpers.values()) {
      const plot = s.plots.get(hp.plotId);
      out.push({
        key: `h:${hp.id}`, kind: 'helper', label: shortName(hp), sub: helperSub(hp, plot?.label ?? ''),
        face: ICONS.scarecrow,
        fields: [{ text: hp.tag, weight: 2.5 }, { text: hp.name, weight: 2 }, { text: plot?.label, weight: 1.5 }, { text: `shell scarecrow ${HELPER_LABEL[hp.activity]}` }, { text: hp.label }],
        boost: 50,
        run: (m) => { if (m.shift) ctx.travel(hp.id); else if (m.ctrl) ctx.panels.open('card', hp.id); else ctx.openTerminal(hp.id); },
      });
    }
    return out;
  };

  const panelEntries = (): Entry[] => {
    const K = ctx.prefs.keys;
    const p = (id: PanelId, label: string, cap: string, words: string, arg?: unknown, svg = ICONS.book): Entry => ({
      key: `p:${id}:${String(arg ?? '')}`, kind: 'panel', label, sub: '', cap, face: svg,
      fields: [{ text: label, weight: 2 }, { text: words }],
      run: () => ctx.panels.open(id, arg),
    });
    const leader = ctx.d.settings.get('leaderKey') || 'Ctrl+`';
    return [
      { key: 'x:next', kind: 'action', label: 'Next who needs you', sub: 'step through asks, struggling agents and finished work', cap: 'Alt+N', face: ICONS.bell,
        fields: [{ text: 'Next who needs you', weight: 2 }, { text: 'focus queue attention ask blocked' }], run: () => hooks.next() },
      p('roster', 'Farm ledger', keyLabel(K.ledger), 'roster everyone agents list status', undefined, ICONS.book),
      p('mailbox', 'Mailbox: needs you', keyLabel(K.mail), 'letters asks answers inbox', 'needs', ICONS.mail),
      p('map', 'Map', keyLabel(K.map), 'where everyone is pins', undefined, ICONS.map),
      p('overview', 'Overview of every agent', keyLabel(K.overview), 'grid all agents scan status dashboard glance', undefined, ICONS.eye),
      { key: 'x:term', kind: 'action', label: 'Terminals', sub: 'the terminal drawer', cap: leader, face: ICONS.terminal,
        fields: [{ text: 'Terminals', weight: 2 }, { text: 'drawer shell console' }],
        run: () => { const id = ctx.state() ? (focusQueue(ctx.state()!.farmers.values())[0]?.id ?? [...ctx.state()!.farmers.keys()][0]) : undefined; if (id) ctx.openTerminal(id); else ctx.panels.open('drawer'); } },
      p('noticeboard', 'Noticeboard', 'B', 'board fields stats', undefined, ICONS.board),
      p('stats', 'Machine stats', '', 'cpu memory network system', undefined, ICONS.stats),
      p('almanac', 'Valley Almanac', 'H', 'rank prosperity upgrades stamps', undefined, ICONS.rosette),
      p('projects', 'Valley Projects', '', 'mayor board plans restore', undefined, ICONS.board),
      p('gazette', 'The Valley Gazette', 'G', 'newspaper weekly morning', undefined, ICONS.notebook),
      p('guide', "Fern's field notebook", keyLabel(K.notebook), 'guide how-to hints activities', undefined, ICONS.notebook),
      p('collection', 'Collections book', 'K', 'forage fish field guide', undefined, ICONS.book),
      p('shop', 'Pockets & the shop', 'I', 'basket bits sell buy decor', { tab: 'sell', at: 'pocket' }, ICONS.hand),
      p('friends', 'Friends & requests', 'Q', 'villagers hearts gifts', undefined, ICONS.hand),
      p('album', 'Photo album', 'L', 'photos pictures', undefined, ICONS.camera),
      p('pause', 'Settings', 'Esc', 'preferences options graphics audio accessibility', 'settings', ICONS.gear),
      p('pause', 'All keys', '?', 'controls keyboard shortcuts help', 'controls', ICONS.keyboard),
      { key: 'x:minimap', kind: 'action', label: 'Toggle the minimap', sub: '', cap: 'N', face: ICONS.compass,
        fields: [{ text: 'Toggle the minimap', weight: 2 }, { text: 'corner map' }], run: () => hooks.minimap() },
    ];
  };

  function build(): void {
    const s = ctx.state();
    entries = [...(s ? farmerEntries(s) : []), ...panelEntries()];
  }

  // ---- matching + drawing ----
  function filter(): void {
    const q = input.value.trim();
    if (!q) shown = entries.filter((e) => !e.typed).slice(0, MAX_ROWS);
    else {
      const scored: { e: Entry; score: number; quote: string }[] = [];
      for (const e of entries) {
        const m = fieldsMatch(q, e.fields);
        if (!m) continue;
        const qf = e.quote?.includes(m.field) ? e.fields[m.field].text : null;
        scored.push({ e, score: m.score + (e.boost ?? 0), quote: qf ? snippet(qf, q) : '' });
      }
      scored.sort((a, b) => b.score - a.score);
      const found = lineEntries(q);
      shown = [...scored.slice(0, MAX_ROWS - found.length).map((x) => (x.quote ? { ...x.e, sub: `“${x.quote}”` } : x.e)), ...found];
    }
    if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
    draw();
  }

  /** the terminal lines that matched (newest first, ≤ SEARCH_ROWS): Enter opens that terminal's history at the line */
  function lineEntries(q: string): Entry[] {
    if (!lines || lines.q !== q) return [];
    const s = ctx.state();
    const out: Entry[] = [];
    for (const hit of lines.hits) {
      if (out.length >= SEARCH_ROWS) break;
      const f = s?.farmers.get(hit.id), hp = s?.helpers.get(hit.id);
      if (!f && !hp) continue;
      const who = f ? shortName(f) : shortName(hp!);
      const plot = s?.plots.get((f ?? hp)!.plotId)?.label ?? '';
      const when = s ? agoShort(s.now - hit.at) : '';
      out.push({
        key: `l:${hit.id}:${hit.fromEnd}`, kind: 'line', label: `${who}${plot && plot !== who ? ` · ${plot}` : ''}${hit.screen ? ' · on screen' : when ? ` · ${when}` : ''}`,
        sub: `“${hit.text}”`, mark: [hit.match[0] + 1, hit.match[1] + 1],
        face: f ? farmerFace(seedHue(f.seed), mascotOf(f.kind, f.vendor), f.tier) : ICONS.scarecrow, status: f ? (f.needsYou ? 'blocked' : f.status) : undefined,
        fields: [],
        run: (m) => {
          if (m.shift) ctx.travel(hit.id);
          else if (m.ctrl) ctx.panels.open('card', hit.id);
          else ctx.openTerminal(hit.id, { find: { ...findNeedle(hit), fromEnd: hit.fromEnd } });
        },
      });
    }
    return out;
  }

  function draw(): void {
    const ns = `${input.value}|${searching ?? ''}|${shown.map((e) => `${e.key}${e.sub}${e.why ?? ''}${e.status ?? ''}${e.pinned ? 'p' : ''}`).join(',')}`;
    if (ns === sig) { mark(false); return; }
    sig = ns;
    if (!shown.length) {
      list.replaceChildren(h('div.vh-empty', null, searching ? `Searching the terminals for "${input.value.trim()}"…` : `Nothing matches "${input.value.trim()}".`,
        h('small', { text: 'Try a name, a field, a job ("testing"), words they said or printed (3+ letters search every terminal), "needs" or a panel ("map").' })));
      input.removeAttribute('aria-activedescendant');
      count.textContent = '';
      return;
    }
    let lastGroup = '';
    const nodes: HTMLElement[] = [];
    shown.forEach((e, i) => {
      const group = !input.value.trim() ? (e.pinned ? 'Pinned' : e.why ? 'Needs a look' : e.kind === 'farmer' || e.kind === 'helper' ? 'Everyone' : 'Panels & actions')
        : e.kind === 'line' ? 'In their terminals' : '';
      if (group && group !== lastGroup) { lastGroup = group; nodes.push(h('div.vh-pal-g', { role: 'presentation', text: group })); }
      const face = h('span.face', { 'aria-hidden': 'true' });
      face.innerHTML = e.face ?? '';
      const row = h('div.vh-pal-row', {
        id: `vh-pal-${i}`, role: 'option', 'aria-selected': String(i === sel), 'data-testid': 'palette-item', 'data-kind': e.kind, 'data-key': e.key,
      },
      face,
      h('span.txt', null, h('span.lb', { text: e.label }), e.sub ? (e.mark ? markedSub(e.sub, e.mark) : h('small', { text: e.sub })) : null),
      e.why ? h(`span.vh-pill.st-${e.why === 'ask' ? 'blocked' : e.why === 'done' ? 'done' : 'idle'}`, { text: FOCUS_LABEL[e.why] }) : e.status && e.kind === 'farmer' ? h(`i.vh-dot.st-${e.status}`) : null,
      e.cap ? h('kbd.vh-k', { text: e.cap }) : null);
      row.classList.toggle('sel', i === sel);
      row.addEventListener('pointermove', () => { if (sel !== i) { sel = i; mark(false); } });
      row.addEventListener('click', (ev) => { sel = i; go({ shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey }); });
      nodes.push(row);
    });
    list.replaceChildren(...nodes);
    mark();
    const nl = shown.filter((e) => e.kind === 'line').length;
    count.textContent = `${shown.length}${shown.length === MAX_ROWS ? '+' : ''} result${shown.length === 1 ? '' : 's'}${searching ? ' · searching terminals…' : nl ? ` · ${nl} in terminals` : ''}`;
  }

  /** move the selection highlight without rebuilding the rows */
  function mark(scroll = true): void {
    for (const r of list.querySelectorAll<HTMLElement>('.vh-pal-row')) {
      const on = r.id === `vh-pal-${sel}`;
      r.classList.toggle('sel', on);
      r.setAttribute('aria-selected', String(on));
      if (on && scroll) r.scrollIntoView?.({ block: 'nearest' });
    }
    input.setAttribute('aria-activedescendant', `vh-pal-${sel}`);
  }

  function go(m: Mods): void {
    const e = shown[sel];
    if (!e) return;
    back = null; // going somewhere new: Esc no longer means "back"
    ctx.panels.close();
    try { e.run(m); } catch (err) { console.warn('[palette] action failed', err); }
  }

  function goBack(): void {
    const b = back;
    back = null;
    ctx.panels.close();
    if (!b) return;
    if ('terminal' in b) ctx.openTerminal(b.terminal);
    else ctx.panels.open(b.panel, b.arg);
  }

  input.addEventListener('input', () => { sel = 0; searchSoon(); filter(); });

  return {
    id: 'palette', el,
    onOpen(arg) {
      back = (arg as PaletteBack | undefined) ?? null;
      input.value = '';
      sel = 0; sig = ''; lines = null; searching = null;
      build();
      filter();
      input.focus();
    },
    onClose() { input.value = ''; clearTimeout(searchTimer); searching = null; lines = null; },
    // the live view: statuses change while it is open (a new ask moves up), the text you typed stays
    refresh() { build(); filter(); },
    back: () => back,
    dismiss: () => goBack(),
    key(e) {
      if (e.key === 'Escape') { goBack(); return true; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (shown.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); ctx.sfx('ui-hover'); }
        return true;
      }
      if (e.key === 'PageDown' || e.key === 'PageUp') { sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === 'PageDown' ? 8 : -8))); mark(); return true; }
      if (e.key === 'Enter' && !e.altKey) {
        if (e.target instanceof HTMLButtonElement) return false;
        go({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
        return true;
      }
      // the input keeps focus: letters go to it even after a mouse click on a row
      if (!typingIn(e.target) && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { input.focus(); return false; }
      return false;
    },
  };
}

const canTask = (f: FarmerView): boolean => !f.needsYou && (f.status === 'idle' || f.status === 'done');

function farmerSub(f: FarmerView, field: string): string {
  const what = f.needsYou ? (f.question ?? 'waiting for you')
    : f.todos?.current ? `${JOB_LABEL[f.job]} · ${f.todos.current}${f.todos.total ? ` (${f.todos.done}/${f.todos.total})` : ''}`
      : `${JOB_LABEL[f.job]}${f.detail ? ` · ${f.detail}` : f.title ? ` · ${f.title}` : ''}`;
  return `${field ? `${field} · ` : ''}${what}`;
}

function helperSub(hp: HelperView, field: string): string {
  return `${field ? `${field} · ` : ''}Scarecrow · ${HELPER_LABEL[hp.activity]}${hp.label ? ` · ${hp.label}` : ''}`;
}


/** the hit line with its match marked (the row's sub line) */
function markedSub(text: string, [s, e]: [number, number]): HTMLElement {
  return h('small.vh-pal-line', null, text.slice(0, s), h('mark', { text: text.slice(s, e) }), text.slice(e));
}
/** '3m ago', '2h ago' (seen by the server) */
function agoShort(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}
