/**
 * Triage mode (§8.8 M3 row, pulled into M3.5) + inbox zero.
 *
 * One full-width card cycles through everyone who needs you, in order: blocked (oldest first) → done, not signed off
 * → struggling. The card shows the agent's last 12 screen lines (live: `ctx.screens.want('triage', [id])`), its last
 * assistant text, work counters, the in-progress todo, and the question + options when blocked. One key each:
 *   1–9  answer (the Serve confirm: "Send ‘2. Yes’ to tinker? [Enter] send [Esc] back"; the same `agent.answer`
 *        hash check as the inbox, §4.8), S sign off (done), C continue (prompt "continue", with the same confirm),
 *   T    new task (the prompt bar), O open the terminal, → skip, ← back, Esc exit (or back out of a confirm).
 * So a queue of 5 blocked agents clears in 10 keys (digit, Enter × 5).
 * UI kit §5.4: a board with the `TRIAGE` plaque, a dot-matrix `3/7` readout and the one legend; a tractor-feed printout
 * of the screen on the left, the porthole, serif question and board ledger on the right, the confirm line under it.
 *
 * `createStreak` counts answers since the queue last went non-empty; when the last blocked agent clears it emits
 * `inbox.zero {answered, ms}` once, toasts "Inbox zero! 4 answered in 0:52" and keeps the per-day best in localStorage.
 * Owner: UI.
 */
import { h, setText, cls, refocus } from './dom.ts';
import { isRecord, errMessage } from '../../../shared/guards.ts';
import type { Entity, Prompt } from '../../../shared/protocol.ts';
import type { Store, OutMsg } from '../net/store.ts';
import type { Bus } from '../core/bus.ts';
import type { TicketLevel, TicketOpts } from './hud.ts';
import { ENV } from '../../../shared/palette.ts';
import { attachPortrait } from '../chars/render/portraits.ts';
import { plaque, readout, porthole, shield, stateWord, printout, question, ledger, button, lamp } from './kit/index.ts';
import { actLegend, injectCardStyles, type ActLegendItem } from './cards.ts';
import { cmpNeedsYou, stateKey } from './roster/model.ts';
import { cardRows, rowForDigit, confirmText, questionText, answerOutcome, CARD_GLYPHS, cardGlyphs, isPrompt, type OptRow, type AnswerReply } from './serveModel.ts';
import { todoLine, workLine, stuckLine, lastTextLine } from './cardModel.ts';
import { waitClock } from '../../../shared/clock.ts';
import { AT_LEAST } from './help.ts';
import { anchorBelowHud } from './dialogCss.ts';

export const SCREEN_LINES = 12;

/**
 * @pure Triage order: blocked (needs-you order) → done, not signed off (oldest first) → struggling (highest level).
 * Skipped ids (`skip`) go to the end (in the same order).
 */
export function triageQueue(entities: Iterable<Entity>, skip: ReadonlySet<string> = new Set()): Entity[] {
  const list = [...entities].filter((e) => e && e.kind !== 'shell');
  const blocked = list.filter((e) => e.status === 'blocked').sort(cmpNeedsYou);
  const done = list.filter((e) => e.status === 'done' && !e.ack).sort((a, b) => (a.statusSince || 0) - (b.statusSince || 0) || String(a.id).localeCompare(String(b.id)));
  const stuck = list.filter((e) => e.status !== 'blocked' && !(e.status === 'done' && !e.ack) && (e.struggle?.level ?? 0) > 0)
    .sort((a, b) => ((b.struggle?.level ?? 0) - (a.struggle?.level ?? 0)) || String(a.id).localeCompare(String(b.id)));
  const all = [...blocked, ...done, ...stuck];
  return [...all.filter((e) => !skip.has(e.id)), ...all.filter((e) => skip.has(e.id))];
}

// Claude Code's tofu-prone UI glyphs → look-alikes on the card (serveModel.ts cardGlyphs; playtest d18-triage)
export { CARD_GLYPHS, cardGlyphs };

/** @pure The tail of a screen: the last `n` lines with trailing blank lines dropped, tofu-prone glyphs swapped. */
export function screenTail(lines: unknown, n = SCREEN_LINES): string[] {
  const src: unknown[] = Array.isArray(lines) ? lines : [];
  const L = src.map((l) => cardGlyphs(String(l ?? '').replace(/\s+$/, '')));
  while (L.length && !L[L.length - 1]) L.pop();
  return L.slice(-n);
}

/** Local day key for the per-day best. */
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/**
 * Inbox-zero streak. `answered()` on every successful answer (any surface), `check()` whenever entities change.
 */
export function createStreak(d: {
  store: Pick<Store, 'entities'> & Partial<Pick<Store, 'now'>>; bus?: Pick<Bus, 'emit'> | null; toast(lvl: TicketLevel, t: string, o?: TicketOpts): unknown;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null; now?: () => number;
}) {
  // [UI fix r2, playtest "1 answered in 0:00" after a 2-minute wait] the clock is the server's (store.now: statusSince
  // is server time) and starts when the queue went non-empty — the oldest blocked agent's statusSince when HQ first
  // sees it — not at the first answer
  const now = d.now ?? d.store.now ?? (() => Date.now());
  let n = 0, t0: number | null = null, hadBlocked = false, firedAt = -1e9, pending = 0;
  // [UI fix r3, fun "inbox zero still reads 0:00"] the queue a clear just closed with no answer counted yet: the
  // blocked→working flip can land before the answer's reply (the inbox had no pend), so an answer arriving within
  // LATE_MS of that clear belongs to it and keeps its start instead of restarting the clock at now()
  let closed: { t0: number; at: number } | null = null;
  const LATE_MS = 15_000;
  const blockedCount = () => { let c = 0; for (const e of d.store.entities.values()) if (e.status === 'blocked') c++; return c; };
  /** when the queue went non-empty: the oldest blocked statusSince (server ms), never in the future, else now */
  const queueStart = () => {
    const t = now();
    let s = t;
    for (const e of d.store.entities.values()) if (e.status === 'blocked' && Number.isFinite(e.statusSince) && e.statusSince > 0 && e.statusSince < s) s = e.statusSince;
    return t - s > 6 * 3600_000 ? t : s; // a stale / skewed stamp never makes a 7 h "streak"
  };
  const io = d.storage === undefined ? (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })() : d.storage;
  interface Best { day: string; answered: number; ms: number }
  function best(): Best | null {
    try {
      const v: unknown = JSON.parse(io?.getItem('hq.inboxZero.best') ?? 'null');
      return isRecord(v) && v.day === dayKey() && typeof v.answered === 'number' && typeof v.ms === 'number' ? { day: v.day, answered: v.answered, ms: v.ms } : null;
    } catch { return null; }
  }
  function saveBest(answered: number, ms: number) {
    const b = best();
    const better = !b || answered > b.answered || (answered === b.answered && ms < b.ms);
    if (better) { try { io?.setItem('hq.inboxZero.best', JSON.stringify({ day: dayKey(), answered, ms })); } catch { /* storage off */ } }
    return better;
  }
  const api = {
    get count() { return n; },
    get firedAt() { return firedAt; },
    best,
    answered() {
      if (t0 == null) {
        t0 = closed && now() - closed.at <= LATE_MS && blockedCount() === 0 ? closed.t0 : queueStart();
      }
      closed = null;
      n++;
      hadBlocked = true;
      // the flip already landed (the queue is empty): celebrate once the in-flight answers are in, not at the next
      // unrelated entity update
      if (!pending && blockedCount() === 0) queueMicrotask(() => api.check());
    },
    /** Answers in flight (triage moves on before the reply): inbox zero waits for them so the count is whole. */
    pend(k: number) {
      pending = Math.max(0, pending + k);
      if (!pending) queueMicrotask(() => api.check());
    },
    /** The inbox-zero moment, when it fires. */
    check(): { answered: number; ms: number } | null {
      const b = blockedCount();
      if (b > 0) { if (t0 == null) t0 = queueStart(); hadBlocked = true; return null; }
      if (!hadBlocked || pending) return null;
      hadBlocked = false;
      if (!n) { closed = t0 != null ? { t0, at: now() } : null; t0 = null; return null; } // cleared elsewhere (a terminal, herdr), or an answer's reply still on its way (see `closed`)
      const ms = Math.max(0, now() - (t0 ?? now()));
      t0 = null;
      closed = null;
      const answered = n;
      n = 0;
      firedAt = now();
      d.bus?.emit('inbox.zero', { answered, ms });
      const record = saveBest(answered, ms);
      const b2 = best();
      // a single answer is no streak: no 'best today' line for it
      const sub = answered < 2 ? 'everyone is unblocked ✓' : record ? 'best today ★' : b2 && b2.answered > 1 ? `best today: ${b2.answered} in ${waitClock(b2.ms)}` : 'everyone is unblocked ✓';
      d.toast('done', `Inbox zero! ${answered} answered in ${waitClock(ms)}`, { key: 'inbox0', ttl: 6000, sub });
      return { answered, ms };
    },
  };
  return api;
}

export interface TriageDeps {
  root: HTMLElement;
  store: Pick<Store, 'entities' | 'now' | 'screens'>;
  call(m: OutMsg): Promise<AnswerReply>;
  label(e: Entity): string;
  screens?: { want(tag: string, ids: string[]): void } | null;
  hooks: {
    toast(lvl: 'info' | 'warn' | 'error', t: string, o?: TicketOpts): unknown; open(id: string): void; talk(id: string): void;
    signOff(id: string): Promise<boolean> | boolean; answered(id: string, key: string): void; pend?(k: number): void; closed(): void;
    typeReply?(id: string, label: string): void; announce?(t: string): void; prompted?(id: string): void;
  };
}

/** What the Send button will send. */
type Confirm = { kind: 'answer'; row: OptRow; hash: string } | { kind: 'continue' } | null;

export function createTriage(d: TriageDeps) {
  const { store, hooks } = d;
  injectCardStyles();
  const pos = readout('0/0', { color: ENV.butter, pitch: 2.2, label: 'position in the queue' });
  const keys = h('div.keys.k-legend');
  const hd = h('div.hd', null, plaque('Triage'), pos.el, keys);
  const port = porthole(null, { size: 'lg' });
  const pt = port.inner;
  const nm = h('div.nm');
  const crest = h('span');
  const ws = h('span.cr');
  const stw = h('span');
  const who = h('div.k-who', null, port, h('div', null, nm, h('div.sub', null, crest, ws, stw)));
  const scr = printout([]);
  scr.setAttribute('aria-label', 'Last screen lines');
  const stuck = h('div.stuck');
  const todo = h('div.todo');
  const lt = h('div.lt');
  const work = h('div.work');
  const q = h('div.q');
  const opts = h('div.ob', { role: 'listbox', 'aria-label': 'Options' });
  const cf = h('div.cf.k-confirm', { hidden: true });
  const empty = h('div.empty', { hidden: true }, lamp('done', { size: 'lg' }), h('b', { text: 'Nothing needs you.' }), h('span', { text: 'No one is blocked, done or stuck.' }));
  const bd = h('div.bd', null, scr, h('div.side', null, who, stuck, todo, work, lt, q, opts, cf));
  const card = h('div.hq-triage.k-board', { role: 'dialog', 'aria-label': 'Triage', tabindex: '-1' }, hd, bd, empty);
  const wrap = h('div.hq-triage-wrap.hq-cards', null, h('div.k-veil'), card);
  d.root.append(wrap);

  let curId: string | null = null;
  const skip = new Set<string>();
  let confirm: Confirm = null;
  let busy = false;
  let restore: Element | null = null;
  let key = '';
  /** the portrait currently drawn (id|status) */
  let ptId: string | undefined;
  /** id → statusSince/hash of what we just handled (so the card moves on before the server catches up) */
  const handled = new Map<string, { since: number; status: Entity['status'] }>();
  const override = new Map<string, Prompt>();

  const lab = (e: Entity | null | undefined) => (e ? d.label(e) : 'agent');
  const promptOf = (e: Entity): Prompt | null => override.get(e.id) ?? e.prompt;
  const isHandled = (e: Entity) => { const x = handled.get(e.id); return !!x && x.since === e.statusSince && x.status === e.status; };
  function queue() { return triageQueue(store.entities.values(), skip).filter((e) => !isHandled(e)); }
  function current() {
    const qq = queue();
    let e = curId ? qq.find((x) => x.id === curId) : null;
    if (!e) { e = qq[0] ?? null; if ((e?.id ?? null) !== curId) { curId = e?.id ?? null; confirm = null; } }
    return { e, qq };
  }
  function want(id: string | null) { d.screens?.want?.('triage', id ? [id] : []); }

  function render() {
    if (!api.isOpen) return;
    // modal: the keys must keep landing here (an answer re-renders the ledger under the focus, and the answered toast /
    // status card may take it) — only the card's own controls may hold the focus
    if (!card.contains(document.activeElement)) card.focus({ preventScroll: true });
    const { e, qq } = current();
    want(e?.id ?? null);
    empty.hidden = !!e;
    bd.hidden = !e;
    pos.el.hidden = !e;
    if (!e) { keys.replaceChildren(...actLegend([hint('Esc', 'exit')]).childNodes); key = ''; return; }
    const now = store.now();
    const scrS = store.screens?.get?.(e.id);
    const p = promptOf(e);
    const k = [e.id, e.status, e.ack, e.statusSince, p?.hash, e.lastText, e.todos && JSON.stringify(e.todos), e.work && JSON.stringify(e.work), e.struggle && JSON.stringify(e.struggle), scrS?.at, qq.length, JSON.stringify(confirm), busy, Math.floor(now / 1000), e.workspace?.colorIndex].join('|');
    if (k === key) return;
    key = k;
    const i = qq.indexOf(e);
    pos.set(`${i + 1}/${qq.length}`, `${i + 1} of ${qq.length}`);
    const st = stateKey(e);
    setText(nm, lab(e));
    if (ptId !== `${e.id}|${e.status}`) {
      ptId = `${e.id}|${e.status}`;
      const fresh = porthole(e, { size: 'lg' });
      port.style.setProperty('--ws', fresh.style.getPropertyValue('--ws'));
      pt.replaceChildren(...fresh.inner.childNodes);
      attachPortrait(pt, e.id, 56);
      crest.replaceChildren(shield(e.workspace?.colorIndex));
    }
    const age = now - (e.statusSince || now);
    setText(ws, `${e.workspace?.label ?? '?'} › ${e.tab?.label ?? '?'}`);
    stw.replaceChildren(' · ', stateWord(st === 'shell' ? 'shell' : e.status === 'done' || e.status === 'blocked' ? e.status : st, { still: true, text: e.status === 'blocked' ? `Waiting ${waitClock(age, e.statusSinceApprox)}` : e.status === 'done' ? `Done ${waitClock(age, e.statusSinceApprox)}` : `${st[0].toUpperCase()}${st.slice(1)} · struggling` }));
    stw.title = e.statusSinceApprox ? `≥ = ${AT_LEAST}` : ''; // [UI fix r1] explain the '≥'
    const tail = screenTail(scrS?.lines);
    scr.set(tail.length ? tail : 'waiting for its screen…', { wait: !tail.length });
    const sl = stuckLine(e.struggle);
    stuck.hidden = !sl;
    stuck.replaceChildren(...(sl ? [stateWord('busy', { text: sl, still: true })] : []));
    const tl = todoLine(e.todos);
    todo.hidden = !tl || e.status === 'blocked'; setText(todo, tl?.text ?? '');
    const ltx = lastTextLine(e.lastText);
    lt.hidden = !ltx || e.status === 'blocked'; setText(lt, ltx ?? '');
    const wl = workLine(e.work, now);
    work.hidden = !wl || e.status === 'blocked'; setText(work, wl ?? '');
    const blocked = e.status === 'blocked';
    q.hidden = !blocked;
    q.replaceChildren(...(blocked ? [question(questionText(p, 4) || 'Waiting for input…')] : []));
    const rows = blocked ? cardRows(p).filter((r): r is OptRow => r.kind === 'opt') : [];
    opts.hidden = !rows.length;
    const pending = confirm;
    const sel = pending?.kind === 'answer' ? rows.findIndex((r) => r.key === pending.row.key) : -1;
    const lg = ledger(rows.map((r) => ({ label: r.label, key: String(r.n), note: r.danger === 'exit' ? 'ends session' : r.danger ? 'refuses' : undefined, destructive: !!r.danger })),
      { board: true, wrap: true, selected: sel, onPick: (j) => ask(rows[j].n) });
    [...lg.children].forEach((li, j) => cls(li, 'danger', !!rows[j].danger));
    opts.replaceChildren(...(rows.length ? [lg] : []));
    cf.hidden = !confirm;
    cls(cf, 'danger', confirm?.kind === 'answer' && !!confirm.row.danger);
    if (confirm) {
      const txt = confirm.kind === 'answer' ? confirmText({ ...e, name: lab(e) }, confirm.row) : `Send “continue” to ${lab(e)}?`;
      cf.replaceChildren(h('span.say', null, h('span.t', { text: busy ? 'Sending…' : txt })),
        button('Back', { key: 'Esc', onClick: () => { if (!busy) { confirm = null; key = ''; render(); } } }),
        button('Send', { key: 'Enter', primary: true, disabled: busy, onClick: () => void send() }));
    }
    const ks: ActLegendItem[] = [];
    if (blocked && rows.length) ks.push(hint(rows.length > 1 ? ['1', '–', String(rows.length)] : '1', 'answer'));
    if (e.status === 'done' && !e.ack) ks.push(hint('S', 'sign off', () => void signOff()));
    if (!blocked) ks.push(hint('C', 'continue', () => { if (!busy) { confirm = { kind: 'continue' }; key = ''; render(); } }), hint('T', 'new task', () => { const id = e.id; close(); hooks.talk(id); }));
    ks.push(hint('O', 'terminal', () => { const id = e.id; close(); hooks.open(id); }));
    if (qq.length > 1) ks.push(hint('ArrowRight', 'skip', () => skipCur(1)));
    if (!confirm) ks.push(hint('Esc', 'exit', () => close()));
    keys.replaceChildren(...actLegend(ks).childNodes);
    cls(card, 'blocked', blocked);
  }
  /** a legend entry (cards.ts actLegend); `act` = its mouse path */
  function hint(k2: string | string[], t2: string, act?: () => void): ActLegendItem { return { key: k2, label: t2, act }; }

  function ask(n: number) {
    const { e } = current();
    if (!e || busy || e.status !== 'blocked') return;
    const p = promptOf(e);
    const rows = cardRows(p);
    const i = rowForDigit(rows, n);
    const r = rows[i];
    if (!r || r.kind !== 'opt' || !p?.hash) return;
    confirm = { kind: 'answer', row: r, hash: p.hash };
    key = '';
    render();
  }
  async function send() {
    const { e } = current();
    if (!e || !confirm || busy) return;
    busy = true; key = ''; render();
    if (confirm.kind === 'continue') {
      let r: AnswerReply;
      try { r = await d.call({ t: 'agent.prompt', id: e.id, text: 'continue' }); } catch (x) { r = { ok: false, error: errMessage(x) || String(x) }; }
      busy = false; confirm = null;
      if (r?.ok) { hooks.prompted?.(e.id); hooks.toast('info', `Sent “continue” to ${lab(e)} ✓`, { key: `prompt:${e.id}` }); advance(e); }
      else hooks.toast('warn', `Not sent: ${r?.error ?? 'failed'}`);
      key = ''; render();
      return;
    }
    const { row, hash } = confirm;
    // Optimistic (M3.5 speed: 5 cards in 10 keys): a plain option moves on at once, so the next digit lands on the
    // next card instead of being eaten while the answer round-trips (the demo / herdr verify takes ~1 s). A refusal
    // brings the card back (the toast says why). A free-text row waits: it closes triage and types the reply.
    const e0 = e, who = lab(e);
    if (!row.free) { busy = false; advance(e0); } // advance() clears confirm and re-renders
    let res: AnswerReply;
    hooks.pend?.(1);
    try { res = await d.call({ t: 'agent.answer', id: e0.id, key: row.key, promptHash: hash }); } catch (x) { res = { ok: false, error: errMessage(x) || String(x) }; }
    if (row.free) { busy = false; confirm = null; }
    const out = answerOutcome(res);
    if (out === 'sent') hooks.answered(e0.id, row.key);
    hooks.pend?.(-1);
    if (out === 'sent') {
      hooks.announce?.(`Answered ${who}: ${row.label}`);
      if (row.free) { handled.set(e0.id, { since: e0.statusSince, status: e0.status }); close(); hooks.typeReply?.(e0.id, row.label); return; }
    } else if (out === 'gone') {
      hooks.toast('info', `${who} is no longer blocked.`, { key: `pc:${e0.id}` });
      if (row.free) advance(e0);
    } else {
      handled.delete(e0.id); // back in the queue
      if (out === 'changed') {
        if (isPrompt(res.prompt)) override.set(e0.id, res.prompt);
        curId = e0.id; confirm = null;
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
        hooks.toast('warn', `${who}'s prompt changed — look again.`, { key: `pc:${e0.id}` });
      } else if (out === 'notAccepted') hooks.toast('warn', `${who} didn't take the answer — try the terminal (O).`, { key: `na:${e0.id}` });
      else hooks.toast('warn', `Answer to ${who} failed: ${res?.error ?? 'error'}`);
    }
    key = ''; render();
  }
  function advance(e: Entity) {
    handled.set(e.id, { since: e.statusSince, status: e.status });
    skip.delete(e.id);
    curId = null;
    confirm = null;
    key = '';
    render();
  }
  function skipCur(dir = 1) {
    const { e, qq } = current();
    if (!e || qq.length < 2) return;
    confirm = null;
    if (dir > 0) { skip.add(e.id); curId = null; } else { const i = qq.indexOf(e); const p = qq[(i - 1 + qq.length) % qq.length]; skip.delete(p.id); curId = p.id; }
    key = '';
    render();
  }
  async function signOff() {
    const { e } = current();
    if (!e || e.status !== 'done' || e.ack || busy) return;
    busy = true;
    const ok = await hooks.signOff(e.id);
    busy = false;
    if (ok) advance(e); else { key = ''; render(); }
  }

  card.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    const { e } = current();
    let handledKey = true;
    const code = ev.code;
    if (ev.key === 'Escape') { if (confirm && !busy) { confirm = null; key = ''; render(); } else close(); }
    else if (ev.ctrlKey || ev.metaKey) handledKey = false;
    else if (ev.key === 'Enter') { if (confirm) void send(); else if (e?.status === 'done' && !e.ack) void signOff(); }
    else if (/^(Digit|Numpad)[1-9]$/.test(code)) ask(+code.slice(-1));
    else if (code === 'KeyS') void signOff();
    else if (code === 'KeyC') { if (e && e.status !== 'blocked' && !busy) { confirm = { kind: 'continue' }; key = ''; render(); } }
    else if (code === 'KeyT') { if (e && e.status !== 'blocked') { const id = e.id; close(); hooks.talk(id); } }
    else if (code === 'KeyO') { if (e) { const id = e.id; close(); hooks.open(id); } }
    else if (ev.key === 'ArrowRight' || code === 'KeyN') skipCur(1);
    else if (ev.key === 'ArrowLeft') skipCur(-1);
    else if (ev.key === 'Tab') { /* stay in the card */ }
    else handledKey = false;
    if (handledKey) { ev.preventDefault(); ev.stopPropagation(); }
  });

  function close() {
    if (!api.isOpen) return;
    wrap.classList.remove('show');
    confirm = null;
    want(null);
    const r = restore;
    restore = null;
    try { refocus(r, { preventScroll: true }); } catch { /* gone */ }
    hooks.closed();
  }

  globalThis.addEventListener?.('resize', () => { if (api.isOpen) anchorBelowHud(wrap); });

  const api = {
    el: wrap,
    get isOpen() { return wrap.classList.contains('show'); },
    get currentId() { return api.isOpen ? current().e?.id ?? null : null; },
    get confirming() { return !!confirm; },
    get size() { return queue().length; },
    open(o: { id?: string } = {}) {
      skip.clear();
      handled.clear();
      override.clear();
      confirm = null;
      curId = o.id ?? null;
      if (!api.isOpen) restore = document.activeElement;
      if (document.pointerLockElement) document.exitPointerLock?.();
      anchorBelowHud(wrap); // [fix r2] below the HUD tally + 14 px, like every other sheet
      wrap.classList.add('show');
      key = '';
      render();
      card.focus({ preventScroll: true });
    },
    close,
    render,
    /** keep `handled` in step: an entity whose state moved on no longer needs the marker */
    prune() { for (const [id, x] of handled) { const e = store.entities.get(id); if (!e || e.statusSince !== x.since || e.status !== x.status) handled.delete(id); } },
  };
  return api;
}
