/**
 * Roster (§8 table, §8.7, §8.11; look: docs/design/ui-kit.md §5.2 + §7.2): one kit board on the left with the AGENTS
 * plaque, the group-by detent, the search slot, filter ticks, then `role="tree"` (aria-activedescendant) of group
 * headers and rows, a pending re-sort strip and the footer (sort · New shell · one legend).
 * Rows carry no buttons and no chips: porthole (workspace rim) · name · unread bulb · note · `ws › tab`, the tool line,
 * the age (heat-tinted) and a lamp (+ the red word for Blocked only) when the grouping doesn't already say the state;
 * no context gauge. The SELECTED row adds its legend, and a selected blocked row puts the agent's question under its
 * name and expands to the shared board ledger ([n] keycaps, the default highlighted; click = answer, confirm in the
 * inbox) unless that agent is already the active drawer tab. The focus ring goes round the row head (.hd) only. The old Blocked-Inbox card is gone: the BLOCKED
 * header (with `[B] inbox`) is its home. Selection anchored by id with the reorder freeze while focused / hovered
 * ("N changes" button), compact mode, icon rail, collapsed groups per group-by mode.
 * Owner: UI (roster).
 */
import { taskLabel } from '../../../../shared/task.ts';
import type { Entity } from '../../../../shared/protocol.ts';
import type { Store } from '../../net/store.ts';
import type { Pins } from '../rekey.ts';
import type { UnreadBreakdown } from '../unread.ts';
import type { TicketOpts } from '../hud.ts';
import type { resolveKey } from '../keymap.ts';
import { stuckLine } from '../cardModel.ts'; // M3.5 struggle reason on the row
import { sinceLabel } from '../unread.ts'; // M3.5 'since you looked: 1 msg · 4 edits'
import { waitClock } from '../../../../shared/clock.ts'; // [FX fix r1]
import { AT_LEAST } from '../help.ts'; // [UI fix r1] the '≥' wording
import { MUTATIONS_OFF_TEXT } from '../hireDialog.ts'; // [UI fix r3] one wording for the spawn gate
import { cardRows, questionText } from '../serveModel.ts';
import { h, ICON, setText, cls, setDisabled, workspaceHex } from '../dom.ts';
import { attachPortrait } from '../../chars/render/portraits.ts'; // [CHR M3.5, cross-owner UI edit]
import {
  plaque, iconButton, detent, slot, tick, groove, lamp, stateWord, keycap, legend, button, porthole, shield, unread as unreadBulb,
  noteGlyph, ledger, question, lampState, type Lamp, type Unread,
} from '../kit/index.ts';
import type { LampState } from '../kit/lamps.ts';
import { ROSTER_CSS } from './styles.ts';
import {
  GROUP_MODES, GROUP_LABELS, GROUP_SHORT, SORTS, buildRoster, initialSelection, needsYou, elapsedLabel, rowAriaLabel, stateKey, tildePath,
  reconcileFrozen, isGroupMode, isSort,
  type GroupMode, type Sort, type RosterItem, type RowItem, type GroupItem,
} from './model.ts';

const FREEZE_IDLE_MS = 5000;
/** a within-group reorder must be pending this long before the 'N changes' button shows */
const PILL_HOLD_MS = 1500;
const STATE_FILTERS = ['blocked', 'working', 'done', 'idle'] as const;
const STATE_WORD: Record<(typeof STATE_FILTERS)[number], string> = { blocked: 'Blocked', working: 'Working', done: 'Done', idle: 'Idle' };
/** Roster actions that pick a row by hand: after one of them the letter keys are verbs again (typeAhead). */
const NAV_ARMS = new Set(['down', 'up', 'left', 'right', 'first', 'last', 'prevGroup', 'nextGroup']);
/** Keys that type into the search field while the list isn't armed: letters and the query punctuation (not digits,
 *  which stay the pinned-agent keys, nor `/ ? [ ]`, which are bound). */
const TYPE_AHEAD = /^[\p{L}\-_.:~@]$/u;
const CHEV = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';

/** A persisted value (undefined when absent or unreadable): callers validate the shape they expect. */
const lsGet = (k: string): unknown => { try { const v = localStorage.getItem(k); return v == null ? undefined : JSON.parse(v); } catch { return undefined; } };
const lsBool = (k: string, dflt: boolean): boolean => { const v = lsGet(k); return typeof v === 'boolean' ? v : dflt; };
const lsStrings = (k: string): string[] => { const v = lsGet(k); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('hq-roster-css')) return;
  const s = document.createElement('style');
  s.id = 'hq-roster-css';
  s.textContent = ROSTER_CSS;
  document.head.append(s);
}

/**
 * Age heat (§5.2): t3 → butter ('warm') → onBoard.blocked ('hot'). Blocked warms at once and turns hot after 2 min;
 * an unsigned done warms after 10 min.
 */
const heatOf = (e: Entity, age: number) => (e.status === 'blocked' ? (age >= 120_000 ? 'hot' : 'warm') : e.status === 'done' && !e.ack && age >= 600_000 ? 'warm' : '');

export interface RosterDeps {
  store: Pick<Store, 'entities' | 'hello' | 'now'>;
  pins: Pins;
  session(): string;
  label?(e: Entity): string;
  unreadOf(id: string): number;
  unreadDetail?(id: string): UnreadBreakdown | null | undefined;
  hasNote?(e: Entity): boolean;
  hooks: {
    open(id: string): void; goTo(id: string): void; follow(id: string): void; signOff(id: string): void;
    answer(id: string): void; option?(id: string, row: number): void; activeTab?(): string | null;
    toast(level: 'info' | 'warn' | 'error', text: string, o?: TicketOpts): unknown;
    layout(): void; palette(): void; keys(): void; closed(toWorld: boolean): void; spawnShell(): void;
    triage?(): void; lastOpened(): string | null; hoverWorkspace?(wsId: string | null): void; hoverAgent?(id: string | null): void;
  };
}

/** The row's DOM parts and the keys of what they currently show (diffed on every refresh). */
interface RowRefs {
  root: HTMLElement; port: HTMLElement; pinNo: HTMLElement; rl: Lamp; bulb: Unread; railBulb: Unread; rn: HTMLElement; nm: HTMLElement;
  note: HTMLElement; foc: HTMLElement; ctx: HTMLElement; tool: HTMLElement; ask: HTMLElement; age: HTMLElement; ageTxt: Text;
  sideState: HTMLElement; under: HTMLElement; key: string; stKey: string; underKey: string;
  lampKey?: LampState; toolHtml?: string; askText?: string;
}
interface GroupRefs { root: HTMLElement; sig: string }
type Sel = { type: 'row' | 'group'; id: string } | null;
type RowAction = 'open' | 'goTo' | 'follow' | 'signOff' | 'answer' | 'pin';

export function createRoster(d: RosterDeps) {
  const { store, hooks } = d;
  injectCss();
  /** one display label per agent on every surface (names.ts: namesakes → 'claude · 2'; m2-r3 [ui]) */
  const label = (e: Entity) => d.label?.(e) || e.name || e.id;
  let open = false;
  const savedMode = lsGet('hq.roster.mode');
  let mode: GroupMode = isGroupMode(savedMode) ? savedMode : 'state';
  const savedSort = lsGet('hq.roster.sort');
  let sort: Sort = isSort(savedSort) ? savedSort : 'recent';
  let compact = lsBool('hq.roster.compact', false);
  let keepOpen = lsBool('hq.roster.keepOpen', false);
  let shells = lsBool('hq.roster.shells', true);
  let query = '';
  /** state filter: empty = every state shown */
  const states = new Set<string>();
  let sel: Sel = null;
  let armed = false; // letters are row verbs only once a row was picked by hand (typeAhead)
  // [UI fix r2, playtest "the search box keeps its old text"] set on (re)open while the field holds a query: the next
  // type-ahead letter REPLACES it ('scout' + 'dev' was 'scoutdev', Agents 0) instead of appending
  let replaceQuery = false;
  /** the old query shows dimmed while the next letter would replace it */
  const setReplace = (v: boolean) => { replaceQuery = v; cls(searchSlot, 'stale', v); };
  let frozen: RosterItem[] | null = null; // frozen visual list while focused/hovered
  let hover = false;
  let lastInteract = 0;
  let pendingChanges = 0;
  let pendingSince = 0;
  let railMode = false;

  const collapsedKey = () => `hq.roster.collapsed.${d.session()}.${mode}`;
  let collapsed = new Set(lsStrings(collapsedKey()));
  const saveCollapsed = () => lsSet(collapsedKey(), [...collapsed]);

  // ---- DOM: header ----
  const compactBtn = iconButton(ICON.compact, { title: 'Compact rows', key: 'Alt+C', onClick: () => api.action('compact') });
  const pinBtn = iconButton(ICON.pin, { title: 'Keep the roster open after opening a terminal', onClick: () => { keepOpen = !keepOpen; lsSet('hq.roster.keepOpen', keepOpen); render(); } });
  const closeBtn = iconButton(ICON.close, { title: 'Close roster', key: 'Esc', onClick: () => api.close() });
  const seg = detent(GROUP_MODES.map((m) => ({ value: m, label: GROUP_SHORT[m] })), mode, (m) => setMode(m));
  seg.setAttribute('aria-label', 'Group by');
  for (const b of seg.children) { if (!(b instanceof HTMLElement)) continue; const m = b.dataset.value; if (!isGroupMode(m)) continue; b.setAttribute('data-mode', m); b.setAttribute('aria-label', GROUP_LABELS[m]); b.setAttribute('title', `Group by ${GROUP_LABELS[m]} (Alt+${GROUP_MODES.indexOf(m) + 1})`); }
  const searchSlot = slot({ placeholder: 'search or type · is:blocked ws:', key: '/', search: true, label: 'Search agents' });
  searchSlot.classList.add('hq-search');
  searchSlot.title = 'Search · typing in the list starts a new search (Ctrl+A edits this one)';
  const input = searchSlot.input;
  input.addEventListener('input', () => { setReplace(false); query = input.value; frozen = null; render(); });
  const footHint = (inSearch: boolean) => { listHint.hidden = inSearch; searchHint.hidden = !inSearch; cls(footer, 'searching', inSearch); };
  input.addEventListener('focus', () => footHint(true));
  input.addEventListener('blur', () => footHint(false));
  input.addEventListener('blur', () => { if (input.value && open) setReplace(true); }); // back in the list: the next letter starts a new query
  input.addEventListener('focus', () => { if (replaceQuery) input.select(); }); // clicked back in: the old query selected, typing replaces it
  // filter ticks: ticked = shown. All ticked = no filter; the HUD tally's "only blocked" leaves just that one ticked
  const ticks = STATE_FILTERS.map((s) => {
    const t = tick([lamp(s, { size: 'sm', label: STATE_WORD[s], still: true }), h('span.w', { text: STATE_WORD[s] })], {
      onChange: (on) => {
        if (!states.size) for (const x of STATE_FILTERS) states.add(x);
        if (on) states.add(s); else states.delete(s);
        if (STATE_FILTERS.every((x) => states.has(x))) states.clear();
        frozen = null; render();
      },
    });
    t.dataset.s = s;
    t.title = `Show ${s}`;
    return t;
  });
  const shellsTick = tick([lamp('shell', { size: 'sm', label: 'Shells', still: true }), h('span.w', { text: 'Shells' })], { on: shells, onChange: (on) => { shells = on; lsSet('hq.roster.shells', shells); frozen = null; render(); } });
  shellsTick.title = 'Show shells';

  // ---- DOM: list + footer ----
  const tree = h('div.hq-tree', { role: 'tree', tabindex: '0', 'aria-label': 'Agents' });
  const pending = button('', { small: true, onClick: () => { frozen = null; render(); tree.focus(); } });
  pending.classList.add('hq-pending');
  // Own strip between the list and the footer, so it never overlays the last row (§8.7 reorder freeze).
  const pendingBar = h('div.hq-pbar', { hidden: true }, pending);
  const sortSel = h('select', { 'aria-label': 'Sort', title: 'Sort within groups (needs-you always first)' }, ...SORTS.map((s) => h('option', { value: s, text: s === 'recent' ? 'recent' : s })));
  sortSel.value = sort;
  sortSel.addEventListener('change', () => { if (isSort(sortSel.value)) sort = sortSel.value; lsSet('hq.roster.sort', sort); frozen = null; render(); });
  const spawnBtn = button('New shell', { key: 'N', small: true, onClick: () => hooks.spawnShell() });
  // [UI fix r3, playtest "G types g into the query"] while the search field has focus the legend names what works
  // there: ↓/Enter pick the highlighted best match (then G / Enter are verbs), Shift+Enter goes straight there
  const listHint = legend([{ key: '?', label: 'keys' }]);
  const searchHint = legend([{ key: '↓', label: 'pick, then' }, { key: 'G', label: 'go' }, { key: 'Shift+Enter', label: 'go now' }]);
  searchHint.hidden = true;
  const footer = h('div.hq-rf', null, h('span.k-label', { text: 'Sort' }), sortSel, h('span.k-sp'), spawnBtn, listHint, searchHint);
  const el = h('aside.hq-roster.k-board', { 'aria-label': 'Roster' },
    h('div.hq-rh', null,
      h('div.top', null, plaque('Agents'), compactBtn, pinBtn, closeBtn),
      seg,
      searchSlot,
      h('div.hq-ticks', null, ...ticks, shellsTick)),
    groove(), tree, pendingBar, groove(), footer);

  // ---- interaction tracking (reorder freeze, §8.7) ----
  const touch = () => { lastInteract = performance.now(); };
  tree.addEventListener('pointerenter', () => { hover = true; touch(); });
  tree.addEventListener('pointerleave', () => { hover = false; touch(); });
  tree.addEventListener('pointermove', touch, { passive: true });
  tree.addEventListener('focus', touch);
  tree.addEventListener('blur', () => { if (frozen) { frozen = null; render(); } });
  tree.addEventListener('click', (ev) => {
    if (!(ev.target instanceof Element)) return;
    const t = ev.target;
    const g = t.closest<HTMLElement>('.hq-gh');
    const r = t.closest<HTMLElement>('.hq-row');
    const opt = t.closest('[data-opt]');
    touch();
    if (g) { const key = g.dataset.key ?? ''; sel = { type: 'group', id: key }; toggleGroup(key); tree.focus(); return; }
    if (!r) return;
    const id = r.dataset.id ?? '';
    sel = { type: 'row', id };
    armed = true; // a clicked row takes the letter verbs
    if (opt) { ev.stopPropagation(); answerOption(id, Number(opt.getAttribute('data-opt'))); return; }
    tree.focus();
    render();
  });
  tree.addEventListener('dblclick', (ev) => {
    if (!(ev.target instanceof Element)) return;
    const r = ev.target.closest<HTMLElement>('.hq-row');
    if (r && !ev.target.closest('[data-opt]')) rowAction('open', r.dataset.id ?? '');
  });
  // hovering a row for ~400 ms lights that agent in the world (bus 'roster.hover'; FX/CHR may ring or nameplate it)
  let hoverTimer: ReturnType<typeof setTimeout> | null = null, hoverId: string | null = null;
  tree.addEventListener('mouseover', (ev) => {
    if (!(ev.target instanceof Element)) return;
    const g = ev.target.closest<HTMLElement>('.hq-gh');
    hooks.hoverWorkspace?.(g && mode === 'workspace' ? (g.dataset.key ?? '').slice(3) : null);
    const r = ev.target.closest<HTMLElement>('.hq-row');
    const id = r?.dataset.id ?? null;
    if (id === hoverId) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    if (hoverId) { hoverId = null; hooks.hoverAgent?.(null); }
    if (id) hoverTimer = setTimeout(() => { hoverId = id; hooks.hoverAgent?.(id); }, 400);
  });
  tree.addEventListener('mouseleave', () => { if (hoverTimer) clearTimeout(hoverTimer); if (hoverId) { hoverId = null; hooks.hoverAgent?.(null); } });

  // ---- model ----
  const unreadOf = (e: Entity) => d.unreadOf(e.id);
  function model() {
    return buildRoster(store.entities.values(), {
      mode, sort, query, states, shells, collapsed,
      pinnedIds: d.pins.slots.flatMap((s) => (s?.id ? [s.id] : [])),
      ext: { unread: unreadOf, hasNote: d.hasNote },
    });
  }

  let current = model();
  let selQuery = ''; // the query the selection was last ranked for
  /** A typed query → its top-ranked row; otherwise the §8.7 initial selection. */
  const pickRow = () => current.best || initialSelection(list, store.entities, hooks.lastOpened());
  let list = current.list;

  function isFrozen() {
    return (document.activeElement === tree || hover) && performance.now() - lastInteract < FREEZE_IDLE_MS;
  }

  // ---- rows ----
  const rowEls = new Map<string, RowRefs>();
  const groupEls = new Map<string, GroupRefs>();
  const domId = (x: RosterItem) => (x.type === 'row' ? `hq-r-${x.group}-${x.id}` : `hq-g-${x.key}`).replace(/[^\w-]/g, '_');

  function rowEl(item: RowItem): RowRefs {
    const k = `${item.group}|${item.id}`;
    const had = rowEls.get(k);
    if (had) return had;
    const port = h('div.k-port', null, h('div'));
    const pinNo = keycap('1', { small: true });
    pinNo.hidden = true;
    const rl = lamp('idle', { size: 'sm', label: '' }); // icon rail only: the state lamp on the porthole
    rl.classList.add('rl');
    const bulb = unreadBulb(0);
    const railBulb = unreadBulb(0); // icon rail: the bulb rides on the porthole
    port.append(pinNo, rl, railBulb);
    const rn = h('span.rn', { 'aria-hidden': 'true' });
    const nm = h('span.nm');
    const note = noteGlyph('has a note');
    note.hidden = true;
    const foc = h('span.foc', { text: '◆', title: 'focused in herdr', hidden: true });
    const ctx = h('span.ctx');
    const tool = h('div.l2');
    const age = h('span.age');
    const ageTxt = document.createTextNode('');
    const sideState = h('span.st');
    age.append(ageTxt);
    // a selected blocked row's question sits in the head, right under the name (it replaces the tool line)
    const ask = h('div.ask', { hidden: true });
    const under = h('div.under', { hidden: true });
    // .hd = the row head (porthole · name/tool · age): the keyboard focus ring goes round it, never round the body
    const root = h('div.hq-row.k-row', { role: 'treeitem', 'aria-level': '2', 'data-id': item.id, 'aria-selected': 'false' },
      h('div.hd', null, port, rn,
        h('div.main', null, h('div.l1', null, nm, bulb, note, foc, ctx), tool, ask),
        h('div.side', null, h('span.sa', null, sideState, age))),
      under);
    const r: RowRefs = { root, port, pinNo, rl, bulb, railBulb, rn, nm, note, foc, ctx, tool, ask, age, ageTxt, sideState, under, key: '', stKey: '', underKey: '' };
    rowEls.set(k, r);
    return r;
  }

  /** The selected row's extra: 'since you looked', the blocked row's board ledger, and its one legend. */
  function buildUnder(e: Entity, since: string, expandAsk: boolean): HTMLElement[] {
    const kids: HTMLElement[] = [];
    if (since) kids.push(h('div.since', { text: since }));
    if (expandAsk) {
      const opts = cardRows(e.prompt).filter((x) => x.kind === 'opt');
      if (opts.length) {
        // THE shared board ledger ([n] keycaps + the highlighted default, = status card / inbox / triage). A click
        // answers via the inbox confirm; A opens it on the highlighted line (in the roster 1–9 stay the pin keys)
        const lg = ledger(opts.map((o) => ({ key: String(o.n), label: o.label, note: o.danger === 'exit' ? 'ends session' : o.danger ? 'refuses' : undefined, destructive: !!o.danger })), { board: true, wrap: true, selected: 0 });
        [...lg.children].forEach((li, i) => { if (!(li instanceof HTMLElement)) return; li.setAttribute('data-opt', String(i)); li.title = `Answer ‘${opts[i].n}. ${opts[i].label}’ (confirm next)`; });
        kids.push(lg);
      }
    }
    const verbs: { key: string; label: string }[] = [{ key: 'Enter', label: 'open' }, { key: 'G', label: 'go' }, { key: 'F', label: 'follow' }];
    if (e.status === 'blocked') verbs.push({ key: 'A', label: 'answer' });
    else if (e.status === 'done' && !e.ack) verbs.push({ key: 'S', label: 'sign off' });
    kids.push(legend(verbs, { small: true }));
    return kids;
  }

  function updateRow(r: RowRefs, item: RowItem, now: number, isSel: boolean) {
    const e = store.entities.get(item.id);
    r.root.id = domId(item);
    r.root.dataset.id = item.id;
    const gone = !e;
    cls(r.root, 'gone', gone);
    if (gone) { r.root.setAttribute('aria-label', 'pane closed'); r.under.hidden = true; return; }
    const st = stateKey(e);
    const ls = lampState(st, e);
    const pk = `${e.kind}|${e.status}|${e.workspace?.colorIndex}|${e.process?.activity}|${compact || railMode ? 'xs' : ''}`;
    if (r.key !== pk) {
      r.key = pk;
      const fresh = porthole(e, { size: compact && !railMode ? 'xs' : '' });
      r.port.className = fresh.className;
      r.port.style.setProperty('--ws', workspaceHex(e.workspace?.colorIndex));
      r.port.firstChild?.replaceWith(fresh.inner);
      attachPortrait(fresh.inner, e.id, compact && !railMode ? 22 : 36); // [CHR M3.5, cross-owner UI edit] live clay portrait over the SVG fallback
    }
    const slot = d.pins.slotOf(e.id);
    r.pinNo.hidden = !slot;
    if (slot) setText(r.pinNo, slot);
    const name = label(e);
    setText(r.nm, name);
    setText(r.rn, name);
    if (r.lampKey !== ls) { r.lampKey = ls; r.rl.set(ls); r.rl.classList.add('rl'); r.rl.setAttribute('aria-hidden', 'true'); }
    r.foc.hidden = !e.focused;
    r.note.hidden = !d.hasNote?.(e);
    // `ws › tab` only when the grouping doesn't say it (§5.2); the workspace colour is the porthole rim
    setText(r.ctx, mode === 'workspace' ? e.tab?.label ?? '' : mode === 'tab' ? '' : `${e.workspace?.label ?? '?'} › ${e.tab?.label ?? '?'}`);
    const acked = e.status === 'done' && e.ack;
    // right column (§4.2): by state only a shell running a process shows its lamp; in every other grouping (and the
    // Pinned section) the row says its state with the LAMP alone, and only Blocked adds its red word (no word soup)
    const byState = mode === 'state' && item.group !== 'pinned'; // the Pinned section doesn't say the state
    const showState = !byState || ls === 'busy';
    const sk = showState ? `${ls}|${ls === 'busy' ? e.process?.activity ?? '' : ''}|${byState}` : '';
    if (r.stKey !== sk) {
      r.stKey = sk;
      const word = ls === 'busy' ? (e.process?.activity && e.process.activity !== 'prompt' ? e.process.activity : 'Running') : undefined;
      if (!showState) r.sideState.replaceChildren();
      else if (ls === 'blocked' && !byState) r.sideState.replaceChildren(stateWord('blocked'));
      else r.sideState.replaceChildren(lamp(ls, { label: word, still: true }));
    }
    const age = now - (e.statusSince || now);
    // approx = first-snapshot pane: at least this long; [FX fix r1] a blocked wait uses the shared wait clock (= bubble / inbox)
    const ageText = e.status === 'blocked' ? waitClock(age, e.statusSinceApprox) : `${e.statusSinceApprox ? '≥' : ''}${elapsedLabel(age)}`;
    if (r.ageTxt.nodeValue !== ageText) r.ageTxt.nodeValue = ageText;
    r.age.title = e.statusSinceApprox ? `≥ = ${AT_LEAST}` : ''; // [UI fix r1] one wording everywhere (help.ts)
    const heat = heatOf(e, age);
    cls(r.age, 'warm', heat === 'warm');
    cls(r.age, 'hot', heat === 'hot');
    const u = d.unreadOf(e.id);
    r.bulb.set(u);
    r.railBulb.set(u);
    // M3.5: what arrived since you looked (the news breakdown): the bulb's tooltip; spelled out on the selected row
    const since = u ? sinceLabel(d.unreadDetail?.(e.id)) : '';
    r.bulb.title = since;
    // tool · detail, else the task label (§8 row)
    let toolHtml: string;
    if (e.kind === 'shell') toolHtml = e.process?.argv ? `$ ${esc(e.process.argv)}` : esc(tildePath(e.cwd));
    else if (e.activity?.tool) toolHtml = `<em>${esc(e.activity.tool)}</em> · ${esc(e.activity.detail || '')}`;
    else if (e.status === 'blocked' && e.prompt?.question) toolHtml = esc(e.prompt.question);
    else toolHtml = esc(taskLabel(e) ?? e.project ?? '');
    if (acked) toolHtml = `<span class="dim">signed off ·</span> ${toolHtml}`;
    // M3.5: why it is struggling, first ("⚠ 3 test fails in a row"; the same line as the status card / triage)
    const stg = stuckLine(e.struggle);
    if (stg && e.status !== 'blocked') toolHtml = `<span class="stg">⚠ ${esc(stg)}</span> · ${toolHtml}`;
    if (r.toolHtml !== toolHtml) { r.tool.innerHTML = toolHtml; r.toolHtml = toolHtml; }
    const title = taskLabel(e);
    r.tool.title = title ? `${title}${e.activity?.detail ? ` — ${e.activity.detail}` : ''}` : '';
    // (no context gauge in rows: the status card and the drawer cwd line carry it; a row is lamp + time only)
    // the selected row's extra (legend; a blocked one expands to its question + ledger unless it IS the active tab)
    const expandAsk = isSel && !compact && !railMode && e.status === 'blocked' && hooks.activeTab?.() !== e.id;
    cls(r.root, 'asking', expandAsk); // the question replaces the tool line, right under the name (say it once)
    const qk = expandAsk ? questionText(e.prompt, 3) || 'Waiting for input…' : '';
    if (r.askText !== qk) { r.askText = qk; r.ask.hidden = !qk; r.ask.replaceChildren(...(qk ? [question(qk)] : [])); }
    const uk = isSel && !railMode ? `${e.status}|${!!e.ack}|${expandAsk ? e.prompt?.hash ?? e.prompt?.question ?? '' : ''}|${since}|${compact}` : '';
    if (r.underKey !== uk) {
      r.underKey = uk;
      r.under.hidden = !uk;
      r.under.replaceChildren(...(uk ? buildUnder(e, compact ? '' : since, expandAsk) : []));
    }
    const aria = rowAriaLabel(e, now, name) + (slot ? `, pinned ${slot}` : '') + (u ? `, ${u} unread` : '');
    r.root.setAttribute('aria-label', aria);
    if (railMode) r.root.title = aria;
    else if (r.root.title) r.root.title = '';
  }

  function groupEl(item: GroupItem): GroupRefs {
    const had = groupEls.get(item.key);
    if (had) return had;
    const root = h('div.hq-gh.k-gh', { role: 'treeitem', 'aria-level': '1', 'data-key': item.key, html: CHEV });
    const g: GroupRefs = { root, sig: '' };
    groupEls.set(item.key, g);
    return g;
  }

  /** Collapsed-group summary: the first few names (`IDLE 3 · moss · ledger · quill`). */
  const summaryOf = (key: string) => {
    const G = current?.groups?.find((x) => x.key === key);
    const names = (G?.items ?? []).slice(0, 4).map((e) => label(e));
    return names.length ? `${names.join(' · ')}${(G?.items.length ?? 0) > 4 ? ' …' : ''}` : '';
  };

  function updateGroup(g: GroupRefs, item: GroupItem) {
    g.root.id = domId(item);
    const isState = !!item.state;
    const alarm = isState && item.state === 'blocked';
    // non-state groups: a collapsed group still says it holds blocked agents (header count in blocked ink, §4.2)
    const nb = isState ? 0 : item.blocked;
    const sum = item.collapsed ? summaryOf(item.key) : '';
    const sig = `${item.label}|${item.count}|${item.collapsed}|${item.state}|${item.colorIndex}|${nb}|${sum}|${item.pinned}`;
    if (g.sig !== sig) {
      g.sig = sig;
      const kids: (HTMLElement | Node)[] = [];
      if (item.colorIndex != null) kids.push(shield(item.colorIndex));
      if (item.state) kids.push(lamp(item.state, { label: '', still: !alarm }));
      // one header style for every grouping (state, space, tab, dir, tool, search): the sign-font name; the tooltip
      // keeps the label's own case (`claude-hq › server/`)
      kids.push(h('span.name', { text: item.label, title: item.label }));
      kids.push(h('span.cnt', { text: String(item.count) }));
      if (item.collapsed && nb) kids.push(h('span.nb', null, lamp('blocked', { size: 'sm', label: '', still: true }), String(nb)));
      if (item.collapsed && sum) kids.push(h('span.sum', { text: `· ${sum}` }));
      else kids.push(h('span.fill'));
      if (alarm) kids.push(legend([{ key: 'B', label: 'inbox' }], { small: true }));
      g.root.innerHTML = CHEV;
      g.root.append(...kids);
    }
    cls(g.root, 'alarm', alarm);
    g.root.setAttribute('aria-expanded', String(!item.collapsed));
    const nd = isState ? 0 : item.doneUnacked;
    g.root.setAttribute('aria-label', `${item.label}, ${item.count} ${item.count === 1 ? 'agent' : 'agents'}${item.blocked && !isState ? `, ${item.blocked} blocked` : ''}${nd ? `, ${nd} done` : ''}${item.collapsed ? ', collapsed' : ''}`);
    if (railMode) g.root.title = g.root.getAttribute('aria-label') ?? '';
    else if (g.root.title) g.root.title = '';
  }

  // the empty state stays up (and its button focusable) after ↓ / Enter from the search: Enter on it clears
  const emptyMsg = h('span');
  const clearBtn = button('Clear filters', { key: 'Enter', small: true, onClick: () => { api.clearFilters(); tree.focus(); } });
  const emptyEl = h('div.hq-empty', null, emptyMsg, clearBtn);

  // ---- render ----
  function render() {
    if (!open) return;
    const now = store.now();
    const fresh = model();
    current = fresh;
    if (frozen && isFrozen()) {
      // [m2-r2] groups / membership / cross-group moves apply at once; only within-group sort moves stay frozen
      const r = reconcileFrozen(frozen, fresh.list);
      list = frozen = r.list;
      pendingChanges = r.pending;
    } else {
      frozen = null;
      pendingChanges = 0;
      list = fresh.list;
      if (document.activeElement === tree || hover) frozen = list;
    }
    // selection anchored by id; falls back to initial selection
    const rowIds = list.filter((x) => x.type === 'row').map((x) => x.id);
    // [UI fix r3, playtest "roster search picks the wrong agent"] whenever the query changes the selection moves to the
    // top-ranked match ('flint' → flint, not the previously selected claude that also matched)
    if (query !== selQuery) {
      selQuery = query;
      if (fresh.best) sel = { type: 'row', id: fresh.best };
      else if (sel?.type === 'row' && !rowIds.includes(sel.id)) sel = null;
    }
    const cur = sel;
    if (!cur || (cur.type === 'row' && !rowIds.includes(cur.id) && !frozen) || (cur.type === 'group' && !list.some((x) => x.type === 'group' && x.key === cur.id))) {
      const id = pickRow();
      const first = list[0];
      sel = id ? { type: 'row', id } : first?.type === 'group' ? { type: 'group', id: first.key } : null; // (a list always starts with a group header)
    }
    const nodes: HTMLElement[] = [];
    const seenRows = new Set<string>();
    for (const item of list) {
      if (item.type === 'group') {
        const g = groupEl(item);
        updateGroup(g, item);
        cls(g.root, 'sel', sel?.type === 'group' && sel.id === item.key);
        nodes.push(g.root);
      } else {
        const r = rowEl(item);
        seenRows.add(`${item.group}|${item.id}`);
        const s = sel?.type === 'row' && sel.id === item.id;
        updateRow(r, item, now, s);
        cls(r.root, 'sel', s);
        cls(r.root, 'compact', compact && !railMode);
        r.root.setAttribute('aria-selected', String(s));
        nodes.push(r.root);
      }
    }
    for (const [k, r] of rowEls) if (!seenRows.has(k)) { r.root.remove(); rowEls.delete(k); }
    if (fresh.empty && !list.some((x) => x.type === 'row')) {
      const q = query.trim();
      setText(emptyMsg, q ? `No agents match “${q}”.` : 'No agents match these filters.');
      nodes.push(emptyEl);
    }
    // the button only once a pending move has lasted PILL_HOLD_MS: the 'recent' sort reshuffles on every tool call, and
    // one flashing up within 800 ms of opening (reviewer m2-r2) reads as a stale list
    const tNow = performance.now();
    if (!pendingChanges) pendingSince = 0; else if (!pendingSince) pendingSince = tNow;
    pendingBar.hidden = !pendingChanges || tNow - pendingSince < PILL_HOLD_MS;
    const pt = `${pendingChanges} change${pendingChanges === 1 ? '' : 's'} · re-sort`;
    if (pending.lastChild?.nodeValue !== pt) pending.replaceChildren(pt);
    const kids = tree.children;
    if (nodes.length !== kids.length || nodes.some((n, i) => kids[i] !== n)) tree.replaceChildren(...nodes);
    const selEl = sel && nodes.find((n) => n.classList.contains('sel'));
    if (selEl) tree.setAttribute('aria-activedescendant', selEl.id);
    else tree.removeAttribute('aria-activedescendant');

    // header
    if (seg.value !== mode) seg.set(mode);
    for (const t of ticks) { const on = !states.size || states.has(t.dataset.s ?? ''); if (t.on !== on) t.set(on); }
    if (shellsTick.on !== shells) shellsTick.set(shells);
    // BE: hello.allowMutations is authoritative (realpath default check, not the name). M3.5: shown disabled with the
    // reason instead of hidden, so the verb is discoverable
    const canSpawn = !!store.hello?.allowMutations;
    setDisabled(spawnBtn, !canSpawn);
    spawnBtn.title = canSpawn ? 'New shell (a new tab in herdr)' : MUTATIONS_OFF_TEXT /* [UI fix r3] no --allow-mutations: the backend refuses it on the default session */;
    compactBtn.setAttribute('aria-pressed', String(compact));
    pinBtn.setAttribute('aria-pressed', String(keepOpen));
    cls(el, 'compact', compact);
  }

  // ---- actions ----
  function setMode(m: string) {
    if (!isGroupMode(m)) return;
    mode = m;
    lsSet('hq.roster.mode', mode);
    collapsed = new Set(lsStrings(collapsedKey()));
    frozen = null;
    groupEls.clear();
    for (const r of rowEls.values()) { r.stKey = '\u0000'; }
    render();
  }
  function toggleGroup(key: string, force?: boolean) {
    const want = force ?? !collapsed.has(key);
    if (want) collapsed.add(key); else collapsed.delete(key);
    saveCollapsed();
    frozen = null;
    render();
  }
  /** A ledger line in the expanded blocked row: the inbox opens on that option's confirm (the one confirm path). */
  function answerOption(id: string, i: number) {
    const e = store.entities.get(id);
    if (!e || e.status !== 'blocked') return;
    if (hooks.option) hooks.option(id, i); else hooks.answer(id);
  }
  function rowAction(act: RowAction, id: string) {
    const e = store.entities.get(id);
    if (!e) return;
    switch (act) {
      case 'open': hooks.open(id); if (!keepOpen) api.close({ toWorld: false }); return;
      case 'goTo': hooks.goTo(id); return;
      case 'follow': hooks.follow(id); return;
      case 'signOff': if (e.status === 'done') hooks.signOff(id); else hooks.toast('info', `${label(e)} is not done.`); return;
      case 'answer': if (e.status === 'blocked') { hooks.answer(id); if (!keepOpen) api.close({ toWorld: false }); } else hooks.toast('info', `${label(e)} is not blocked.`); return;
      case 'pin': {
        const slot = d.pins.toggle(e);
        hooks.toast('info', slot ? `Pinned ${label(e)} to ${slot}` : d.pins.slotOf(e.id) ? 'All 9 pins are used' : `Unpinned ${label(e)}`);
        render();
        return;
      }
    }
  }
  function move(delta: number) {
    const cur = sel;
    const idx = list.findIndex((x) => (x.type === 'row' ? cur?.type === 'row' && x.id === cur.id : cur?.type === 'group' && x.key === cur.id));
    const next = list[Math.max(0, Math.min(list.length - 1, (idx < 0 ? 0 : idx) + delta))];
    if (next) sel = next.type === 'row' ? { type: 'row', id: next.id } : { type: 'group', id: next.key };
    render();
    scrollSel();
  }
  /** Home (dir 1) / End (dir −1): the first / last row of the list; a list of only collapsed groups → its header. */
  function edgeRow(dir: 1 | -1) {
    const rows = list.filter((x) => x.type === 'row');
    const r = dir > 0 ? rows[0] : rows[rows.length - 1];
    if (r) sel = { type: 'row', id: r.id };
    else if (list.length) { const g = list[dir > 0 ? 0 : list.length - 1]; if (g.type === 'group') sel = { type: 'group', id: g.key }; }
    render();
    scrollSel();
  }
  /**
   * Enter on a group header (reviewer r3): open that group's most urgent row (needs-you order, collapsed or not);
   * a calm group just moves the selection onto its first row with a hint (←/→ still collapse / expand).
   */
  function openFromHeader(key: string) {
    const G = current?.groups?.find((g) => g.key === key);
    const items = G?.items ?? [];
    const urgent = items.find((e) => needsYou(e));
    if (urgent) { rowAction('open', urgent.id); return; }
    if (!items.length) { hooks.toast('info', 'This group is empty.'); return; }
    if (collapsed.has(key)) toggleGroup(key, false);
    sel = { type: 'row', id: items[0].id };
    render();
    scrollSel();
    hooks.toast('info', `Enter opens ${items[0].name ? label(items[0]) : 'the row'} · ←/→ collapse / expand the group`, { key: 'rosterHdr' });
  }
  function jumpGroup(dir: 1 | -1) {
    const cur = sel;
    const idx = list.findIndex((x) => (x.type === 'row' ? cur?.type === 'row' && x.id === cur.id : cur?.type === 'group' && x.key === cur.id));
    let i = idx;
    for (;;) {
      i += dir;
      if (i < 0 || i >= list.length) return;
      const it = list[i];
      if (it.type === 'group') { sel = { type: 'group', id: it.key }; render(); scrollSel(); return; }
    }
  }
  function scrollSel() {
    const n = tree.querySelector('.sel');
    n?.scrollIntoView({ block: 'nearest' });
  }
  const selEntity = () => (sel?.type === 'row' ? store.entities.get(sel.id) ?? null : null);

  const api = {
    el,
    tree,
    input,
    get isOpen() { return open; },
    get mode() { return mode; },
    /** Current search text (deep links: `name:claude` for namesakes). */
    get query() { return query; },
    get selectedId() { return sel?.type === 'row' ? sel.id : null; },
    get keepOpen() { return keepOpen; },
    get compact() { return compact; },
    setRail(on: boolean) { if (railMode === on) return; railMode = on; cls(el, 'rail', on); if (open) render(); },
    get rail() { return railMode; },
    open(o: { focus?: 'list' | 'search' | false; groupBy?: string; query?: string } = {}) {
      if (o.groupBy) setMode(o.groupBy);
      if (typeof o.query === 'string') { query = o.query; input.value = o.query; frozen = null; sel = null; }
      if (!open) { open = true; frozen = null; sel = null; armed = false; setReplace(!!input.value); }
      // Tab back into an open, unfocused roster: a stale header selection re-applies the initial-selection rule
      else if (o.focus === 'list' && document.activeElement !== tree && sel?.type !== 'row') sel = null;
      cls(el, 'open', true);
      hooks.layout();
      render();
      if (o.focus === 'search') { input.focus(); input.select(); } // selected: typing replaces the old query
      else if (o.focus !== false) { tree.focus(); touch(); }
      scrollSel();
    },
    close(o: { toWorld?: boolean } = {}) {
      if (!open) return;
      open = false;
      frozen = null;
      cls(el, 'open', false);
      if (document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) document.activeElement.blur();
      hooks.layout();
      hooks.closed(o.toWorld !== false);
    },
    toggle() { if (open) api.close(); else api.open(); },
    select(id: string | null | undefined) { if (id) sel = { type: 'row', id }; render(); scrollSel(); },
    selected: selEntity,
    focusList() { if (!open) api.open(); tree.focus(); touch(); },
    /**
     * [UI fix r1, playtest "the search box is a trap"] Type-ahead: Tab focuses the list (§8.2), where single letters
     * are row verbs (G go, T talk, A answer, P pin, B inbox…). Until the user picks a row with the arrows / j k /
     * Home End / a click (or leaves the search field with ↓ Enter Tab), a plain printable key is typing: it goes to
     * the search field, which takes focus, so "ledger" filters instead of walking to the preselected agent.
     * Called by keys.ts before the key table. → true when the key was taken (`bound` = the key's roster binding, if any).
     */
    typeAhead(e: KeyboardEvent, bound: ReturnType<typeof resolveKey> = null): boolean {
      if (!open || !el.contains(document.activeElement) || document.activeElement === input) return false;
      // [UI fix r2] Ctrl/Cmd+A in the roster selects the search text (not the whole page)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A')) {
        setReplace(false); input.focus(); input.select(); return true;
      }
      if (document.activeElement !== tree && document.activeElement !== clearBtn) return false;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
      if (typeof e.key !== 'string' || !TYPE_AHEAD.test(e.key)) return false;
      // armed (a row was picked by hand): a letter bound to a row verb is that verb. [UI fix r2, playtest] with no row
      // under the cursor (an empty result list) or for an unbound letter it is typing, never a world hotkey
      if (armed && sel?.type === 'row' && bound) return false;
      if (armed && sel?.type === 'group' && bound) return false;
      const fresh = replaceQuery;
      setReplace(false);
      input.focus();
      input.value = fresh ? e.key : input.value + e.key;
      armed = false;
      query = input.value; frozen = null; sel = null;
      render();
      return true;
    },
    get armed() { return armed; },
    render,
    clearFilters() { setReplace(false); query = ''; input.value = ''; states.clear(); if (!shells) { shells = true; lsSet('hq.roster.shells', true); } frozen = null; render(); },
    setStateFilter(s: string | null | undefined) { states.clear(); if (s) states.add(s); frozen = null; render(); },
    get stateFilter() { return [...states]; },
    /** Force a re-sort now (tests / the 'N changes' button). */
    applyPending() { frozen = null; render(); },
    get pendingChanges() { return pendingChanges; },
    visibleIds: () => list.filter((x) => x.type === 'row').map((x) => x.id),
    /** Roster-scope + search-input actions from the key table. */
    action(name: string, arg?: number | null): boolean {
      touch();
      if (NAV_ARMS.has(name)) armed = true;
      switch (name) {
        case 'down': move(1); return true;
        case 'up': move(-1); return true;
        case 'left':
          if (sel?.type === 'group') { if (!collapsed.has(sel.id)) toggleGroup(sel.id, true); return true; }
          if (sel?.type === 'row') { const cur = sel; const item = list.find((x): x is RowItem => x.type === 'row' && x.id === cur.id); if (item) { sel = { type: 'group', id: item.group }; render(); scrollSel(); } }
          return true;
        case 'right': if (sel?.type === 'group' && collapsed.has(sel.id)) toggleGroup(sel.id, false); return true;
        case 'open':
          if (current.empty) { api.clearFilters(); tree.focus(); return true; } // the empty state's [Enter] Clear filters
          if (sel?.type === 'group') { openFromHeader(sel.id); return true; }
          if (sel?.type === 'row') rowAction('open', sel.id);
          return true;
        case 'goTo': case 'follow': case 'signOff': case 'answer': case 'pin':
          if (sel?.type === 'row') rowAction(name, sel.id);
          return true;
        case 'search': input.focus(); input.select(); return true;
        case 'prevGroup': jumpGroup(-1); return true;
        case 'nextGroup': jumpGroup(1); return true;
        case 'first': edgeRow(1); return true; // §8.2: first / last ROW (never a header: Home → Enter must open)
        case 'last': edgeRow(-1); return true;
        case 'groupBy': setMode(GROUP_MODES[(arg ?? 0) - 1]); return true;
        case 'compact': compact = !compact; lsSet('hq.roster.compact', compact); frozen = null; render(); hooks.layout(); return true;
        case 'close': api.close(); return true;
        case 'pinAssign': { const e = selEntity(); if (e) { d.pins.assign(arg ?? 0, e); hooks.toast('info', `Pinned ${label(e)} to ${arg}`); render(); } return true; }
        // search-input scope
        case 'toList': {
          armed = true;
          frozen = null;
          render();
          // [UI fix r3] a query lands on its best match (the highlighted row), else the §8.7 initial selection
          const cur = sel;
          const id = cur?.type === 'row' && query.trim() && list.some((x) => x.type === 'row' && x.id === cur.id) ? cur.id : pickRow();
          if (id) sel = { type: 'row', id };
          // no match: the empty state stays up and its Clear filters button takes the focus (Enter clears)
          if (current.empty && emptyEl.isConnected) { clearBtn.focus(); render(); return true; }
          tree.focus();
          render();
          scrollSel();
          return true;
        }
        case 'clearOrClose':
          if (input.value) { input.value = ''; query = ''; frozen = null; render(); } else api.close();
          return true;
      }
      return false;
    },
  };
  return api;
}
