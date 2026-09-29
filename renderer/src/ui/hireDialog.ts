/**
 * Hire (M3.5 ideation #5): "New Claude in…" / "+ Shell" from the palette, the roster header or the hotbar. A paper
 * dialog: kind (Claude · Codex · Shell), workspace (an existing one or a new one by name), working directory (recent
 * cwds of the office's entities, or typed), name, and — agents only — a first prompt. "Review" shows an explicit
 * confirm step; only "Hire" sends `spawn {kind?, cwd?, workspaceId?, label?, name?, prompt?}` (BE sends the first
 * prompt once the agent is ready, ≤ 20 s). The reply emits `spawn.sent {paneId, kind}` (BRN's crate arrival, AUD),
 * selects the new entity and, for a shell, opens its terminal. Never auto-retries.
 * Gate: `hello.allowMutations` false → the dialog shows why and sends nothing (`MUTATIONS_OFF_TEXT`).
 * Owner: UI.
 */
import { h, setText, cls, refocus, setDisabled, type Kid } from './dom.ts';
import { errMessage } from '../../../shared/guards.ts';
import type { ClientMsgOf, Entity, Hello, ReplyMsg, Workspace } from '../../../shared/protocol.ts';
import type { Store, OutMsg } from '../net/store.ts';
import type { Bus } from '../core/bus.ts';
import type { TicketLevel, TicketOpts } from './hud.ts';
import type { Ledger } from './kit/index.ts';
import { tildePath } from './roster/model.ts';
import { paper, circled, ledger, shield, slot, button, stamp, scrollArea, trapFocus } from './kit/index.ts';
import { injectDialogCss, anchorBelowHud } from './dialogCss.ts';

/**
 * [UI fix r1, reviewer code] The spawn round trip: BE (server/world/actions.ts) may take SPAWN_SHELL_MS (8 s) for the
 * pane's shell + SPAWN_READY_MS (20 s) for the agent to be ready + the tab.create / agent.start round trips before it
 * replies. The store's default 20 s call timeout reported "Hire failed: timeout" for an agent that did get hired (P6).
 * ui35.test.ts asserts this stays above SPAWN_SHELL_MS + SPAWN_READY_MS + SPAWN_SLACK_MS. (Proposed to LEAD: export the
 * spawn budget in shared/protocol.ts LIMITS so both ends read one number.)
 */
export const SPAWN_SLACK_MS = 10_000;
export const SPAWN_CALL_TIMEOUT_MS = 45_000;

export const MUTATIONS_OFF_TEXT = 'Spawning is off in your default herdr session (run HQ with --session <name>, e.g. --session hqtest)';
const LABEL_MAX = 64;
const ARRIVE_MS = 60_000;

/** @pure Can this session hire? */
export const canSpawn = (hello: Pick<Hello, 'allowMutations'> | null | undefined): boolean => !!hello?.allowMutations;

/**
 * @pure Recent working directories of the office (most recent activity first, unique, ≤ n).
 */
export function recentCwds(entities: Iterable<Entity>, n = 12): string[] {
  const seen = new Map<string, number>();
  for (const e of entities) {
    if (!e?.cwd || !e.cwd.startsWith('/')) continue;
    const t = Math.max(e.activity?.since || 0, e.statusSince || 0);
    if (!seen.has(e.cwd) || (seen.get(e.cwd) ?? 0) < t) seen.set(e.cwd, t);
  }
  return [...seen].sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => c);
}

export interface SpawnForm { kind: 'claude' | 'codex' | 'shell'; ws: string; newWs: string; cwd: string; name: string; prompt: string }
export type SpawnMsg = ClientMsgOf<'spawn'>;

/**
 * @pure The spawn message for a filled form (null + why when invalid).
 */
export function spawnMessage(f: SpawnForm, workspaces: readonly Pick<Workspace, 'id'>[] = []): { msg: SpawnMsg | null; why?: string } {
  const msg: SpawnMsg = { t: 'spawn' };
  const kind = f.kind === 'shell' ? null : f.kind;
  if (kind) msg.kind = kind;
  const cwd = String(f.cwd || '').trim();
  if (cwd) {
    if (!cwd.startsWith('/')) return { msg: null, why: 'The working directory must be an absolute path (/…).' };
    msg.cwd = cwd.replace(/\/+$/, '') || '/';
  }
  const name = String(f.name || '').trim().slice(0, LABEL_MAX);
  if (f.ws === '__new') {
    const w = String(f.newWs || '').trim().slice(0, LABEL_MAX);
    if (!w) return { msg: null, why: 'Name the new workspace.' };
    msg.label = w; // workspace.create label
    if (name) msg.name = name;
  } else if (f.ws) {
    if (workspaces.length && !workspaces.some((w) => w.id === f.ws)) return { msg: null, why: 'That workspace is gone.' };
    msg.workspaceId = f.ws;
    if (name) { msg.name = name; msg.label = name; } // the new tab's label
  } else if (name) msg.name = name;
  const prompt = String(f.prompt || '').trim();
  if (prompt && kind) msg.prompt = prompt.slice(0, 8 * 1024);
  return { msg };
}

/** The reply fields the dialog reads (a `ReplyMsg` fits; the rest is `unknown` until narrowed). */
type HireReply = Pick<ReplyMsg, 'ok' | 'error'> & { paneId?: unknown; prompted?: unknown; why?: unknown };

export interface HireDeps {
  root: HTMLElement;
  store: Pick<Store, 'hello' | 'workspaces' | 'entities' | 'on'>;
  call(m: OutMsg, o?: { timeoutMs?: number }): Promise<HireReply>;
  bus?: Bus | null;
  hooks: { toast(lvl: TicketLevel, t: string, o?: TicketOpts): unknown; spawned(paneId: string, kind: string | null): void; closed(): void };
}

export function createHireDialog(d: HireDeps) {
  const { store, hooks } = d;
  injectDialogCss();
  const KINDS = [{ value: 'claude', label: 'claude' }, { value: 'codex', label: 'codex' }, { value: 'shell', label: 'shell' }];
  const kindSel = circled(KINDS, 'claude', (k) => { form.kind = k === 'codex' || k === 'shell' ? k : 'claude'; render(); });
  kindSel.setAttribute('aria-label', 'Kind');
  const wsBox = h('div');
  const newWsSlot = slot({ placeholder: 'new workspace name', label: 'New workspace name' });
  const newWs = newWsSlot.input;
  newWs.maxLength = LABEL_MAX;
  const cwdSlot = slot({ placeholder: 'empty = herdr’s default · ↓ recent folders', label: 'Folder' });
  cwdSlot.classList.add('mono');
  const cwdIn = cwdSlot.input;
  cwdIn.setAttribute('list', 'hq-hire-cwds');
  const cwdList = h('datalist#hq-hire-cwds');
  const nameSlot = slot({ placeholder: 'optional', label: 'Name' });
  const nameIn = nameSlot.input;
  nameIn.maxLength = LABEL_MAX;
  const promptIn = h('textarea', { rows: '2', placeholder: 'optional · sent once it is ready', 'aria-label': 'First prompt', spellcheck: 'false' });
  const field = (label: string, ...kids: Kid[]) => h('div.k-field', null, h('span.k-label', { text: label }), ...kids);
  const promptRow = field('First prompt', promptIn);
  const off = h('div.off', { hidden: true });
  const err = h('div.err', { hidden: true, role: 'alert' });
  const say = h('p.say', { 'aria-live': 'polite' });
  const mark = h('span', { style: { display: 'contents' } });
  const title = h('h3.k-plaque');
  const secondary = button('Cancel', { key: 'Escape', onClick: () => { if (confirming && !busy) back(); else close(); } });
  const primary = button('Review', { key: 'Enter', primary: true, onClick: () => { if (confirming) void hire(); else review(); } });
  const setLabel = (btn: HTMLElement, t: string) => { if (btn.lastChild && btn.lastChild.textContent !== t) btn.lastChild.textContent = t; };
  const fields = h('div.fields', null,
    field('Kind', kindSel),
    field('Workspace', wsBox, newWsSlot),
    field('Folder', cwdSlot), cwdList,
    field('Name', nameSlot),
    promptRow);
  const body = scrollArea({}, off, fields, err);
  // the confirm sentence is its own line above the buttons (names never break: .nb), not squeezed beside them
  const sheet = paper({ clip: true },
    h('div.hd', null, title, mark), body, say,
    h('div.k-foot.btns', null, secondary, primary));
  sheet.classList.add('hq-hire');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Hire');
  const card = sheet;
  const wrap = h('div.hq-hire-wrap.hq-dlg.dim', null, sheet);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) close(); });
  d.root.append(wrap);
  trapFocus(card);

  const form: SpawnForm = { kind: 'claude', ws: '', newWs: '', cwd: '', name: '', prompt: '' };
  let confirming = false;
  let busy = false;
  let restore: Element | null = null;
  let lastMsg: SpawnMsg | null = null;
  let wsLedger: Ledger | null = null;
  /** ledger line → workspace id ('__new' last) */
  let wsIds: string[] = [];

  const read = () => { form.newWs = newWs.value; form.cwd = cwdIn.value; form.name = nameIn.value; form.prompt = promptIn.value; };
  const allowed = () => canSpawn(store.hello);

  /** Workspace = a ledger of the office's workspaces (shield · name · agent count) + "New workspace…". */
  function fillWorkspaces(pref?: string) {
    const wss = Array.isArray(store.workspaces) ? store.workspaces : [];
    const count = new Map<string, number>();
    for (const e of store.entities.values()) { const w = e.workspace?.id; if (w) count.set(w, (count.get(w) ?? 0) + 1); }
    wsIds = [...wss.map((w) => w.id), '__new'];
    form.ws = pref && (pref === '__new' || wss.some((w) => w.id === pref)) ? pref : wss[0]?.id ?? '__new';
    const n = (k: number) => (k ? `${k} ${k === 1 ? 'agent' : 'agents'}` : 'empty');
    wsLedger = ledger([
      ...wss.map((w) => ({ label: w.label || w.id, lead: shield(w.colorIndex), note: n(count.get(w.id) ?? 0) })),
      { label: 'New workspace…' },
    ], { numbered: false, selected: wsIds.indexOf(form.ws), onPick: (i) => { form.ws = wsIds[i]; render(); if (form.ws === '__new') newWs.focus(); } });
    const lg = wsLedger;
    lg.tabIndex = 0;
    lg.setAttribute('aria-label', 'Workspace');
    lg.addEventListener('keydown', (ev) => {
      const dir = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      ev.preventDefault();
      const i = Math.max(0, Math.min(wsIds.length - 1, wsIds.indexOf(form.ws) + dir));
      form.ws = wsIds[i];
      render();
    });
    wsBox.replaceChildren(lg);
  }
  function fillCwds() {
    const list = recentCwds(store.entities.values());
    cwdList.replaceChildren(...list.map((c) => h('option', { value: c, label: tildePath(c) })));
  }
  function render() {
    read();
    const agent = form.kind !== 'shell';
    setText(title, agent ? 'Hire' : 'New shell');
    kindSel.set(form.kind);
    if (wsLedger) {
      const i = wsIds.indexOf(form.ws);
      if (wsLedger.selected !== i) { wsLedger.select(i); wsLedger.children[i]?.scrollIntoView?.({ block: 'nearest' }); }
    }
    newWsSlot.hidden = form.ws !== '__new';
    promptRow.hidden = !agent;
    const ok = allowed();
    off.hidden = ok;
    setText(off, MUTATIONS_OFF_TEXT);
    fields.hidden = !ok;
    mark.replaceChildren(!ok ? stamp('Locked', { ink: 'locked' }) : confirming ? stamp('Ready', { ink: 'ready' }) : '');
    say.hidden = !confirming;
    setLabel(secondary, confirming ? 'Back' : 'Cancel');
    setLabel(primary, busy ? 'Hiring…' : confirming ? 'Hire' : 'Review');
    setDisabled(primary, busy || !ok);
    cls(card, 'confirming', confirming);
  }
  function review() {
    read();
    err.hidden = true;
    if (!allowed()) { render(); return; }
    const { msg, why } = spawnMessage(form, store.workspaces ?? []);
    if (!msg) { err.hidden = false; setText(err, why); return; }
    lastMsg = msg;
    const wsName = form.ws === '__new' ? `new workspace “${msg.label}”` : (store.workspaces ?? []).find((w) => w.id === form.ws)?.label ?? form.ws;
    const what = msg.kind ? `a ${msg.kind === 'codex' ? 'Codex' : 'Claude'}${msg.name ? ` “${msg.name}”` : ''}` : `a shell${msg.name ? ` “${msg.name}”` : ''}`;
    say.replaceChildren('Hire ', h('b.nb', { text: what }), ' in ', h('b.nb', { text: wsName, title: wsName }),
      ...(msg.cwd ? [' · ', h('span.nb.k-mono', { text: tildePath(msg.cwd), title: msg.cwd })] : []), '?');
    confirming = true;
    render();
    primary.focus({ preventScroll: true });
  }
  function back() { confirming = false; render(); nameIn.focus(); }
  async function hire() {
    if (!confirming || busy || !lastMsg || !allowed()) return;
    busy = true;
    render();
    const msg = lastMsg;
    const kind = msg.kind ?? null;
    const who = msg.name ?? (kind ? kind : 'shell');
    close(true);
    hooks.toast('info', kind ? `Hiring ${who}…` : `Opening a shell…`, { key: 'hire', sub: msg.prompt ? 'its first prompt goes in once it is ready' : 'a crate is on its way' });
    let r: HireReply;
    const before = new Set(d.store?.entities?.keys?.() ?? []);
    try { r = await d.call(msg, { timeoutMs: SPAWN_CALL_TIMEOUT_MS }); } catch (x) { r = { ok: false, error: errMessage(x) || String(x) }; }
    busy = false;
    if (r?.error === 'timeout') {
      // no reply yet is not a failure: the pane may still be booting. Say so, and let the arriving entity confirm it.
      hooks.toast('info', kind ? `${who} is still starting…` : 'The shell is still starting…', { key: 'hire', sub: 'herdr is slow to answer; it walks in (crate) once it exists', ttl: 12000 });
      awaitArrival(before, msg, kind, who);
      return;
    }
    const paneId = r?.paneId;
    if (!r?.ok || typeof paneId !== 'string' || !paneId) {
      hooks.toast('warn', r?.error === 'mutations_disabled' ? MUTATIONS_OFF_TEXT : `Hire failed: ${r?.error ?? 'no pane'}`, { key: 'hire' });
      return;
    }
    d.bus?.emit('spawn.sent', { paneId, kind: kind ?? 'shell' });
    hooks.toast('done', kind ? `${who} hired ✓` : 'Shell ready ✓', { key: 'hire', sub: msg.prompt ? (r.prompted ? 'first prompt sent' : `first prompt not sent (${String(r.why ?? 'not ready')}) — T to talk`) : '' });
    hooks.spawned(paneId, kind);
  }
  /** After a timed-out spawn: the first new entity of that kind (and name, when given) within ARRIVE_MS confirms it. */
  function awaitArrival(before: Set<string>, msg: SpawnMsg, kind: string | null, who: string) {
    const want = (e: Entity) => !before.has(e.id) && (kind ? e.kind === kind : e.kind === 'shell') && (!msg.name || e.name === msg.name);
    const off = d.store?.on?.('entity', (e) => {
      if (!e?.id || !want(e)) return;
      stop();
      d.bus?.emit('spawn.sent', { paneId: e.id, kind: kind ?? 'shell' });
      hooks.toast('done', kind ? `${who} hired ✓` : 'Shell ready ✓', { key: 'hire', sub: msg.prompt ? 'T to talk if the first prompt did not go in' : '' });
      hooks.spawned(e.id, kind);
    });
    const timer = setTimeout(() => { stop(); hooks.toast('warn', `No sign of ${who} yet`, { key: 'hire', sub: 'check herdr; nothing was retried' }); }, ARRIVE_MS);
    function stop() { clearTimeout(timer); if (typeof off === 'function') off(); }
  }
  function close(keepBusy = false) {
    if (!api.isOpen) return;
    wrap.classList.remove('show');
    confirming = false;
    if (!keepBusy) busy = false;
    const r = restore;
    restore = null;
    try { refocus(r, { preventScroll: true }); } catch { /* gone */ }
    hooks.closed();
  }

  card.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    let handled = true;
    if (ev.key === 'Escape') { if (confirming && !busy) back(); else close(); }
    else if (ev.key === 'Enter' && !(ev.target instanceof HTMLTextAreaElement && !ev.ctrlKey && !ev.metaKey) && !(ev.target instanceof HTMLButtonElement)) { if (confirming) void hire(); else review(); }
    else handled = false;
    if (handled) { ev.preventDefault(); ev.stopPropagation(); }
  });
  for (const el of [newWs, cwdIn, nameIn, promptIn]) el.addEventListener('input', () => { err.hidden = true; render(); });

  const api = {
    el: wrap,
    get isOpen() { return wrap.classList.contains('show'); },
    get confirming() { return confirming; },
    open(o: { kind?: SpawnForm['kind']; workspaceId?: string; cwd?: string } = {}) {
      form.kind = o.kind ?? 'claude';
      confirming = false;
      busy = false;
      err.hidden = true;
      fillWorkspaces(o.workspaceId);
      fillCwds();
      newWs.value = '';
      cwdIn.value = o.cwd ?? '';
      nameIn.value = '';
      promptIn.value = '';
      if (!api.isOpen) restore = document.activeElement;
      if (document.pointerLockElement) document.exitPointerLock?.();
      anchorBelowHud(wrap);
      wrap.classList.add('show');
      render();
      body.update();
      (allowed() ? nameIn : secondary).focus({ preventScroll: true });
    },
    close: () => close(),
  };
  return api;
}
