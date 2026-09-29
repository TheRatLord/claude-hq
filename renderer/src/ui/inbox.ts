/**
 * Blocked Inbox (§8.8) = the Serve card (§6.8.1), plus the **Done** tab. UI kit §5.4: a clipped paper sheet with the
 * `INBOX` plaque and a paper detent `Blocked n · Done n`, one question per sheet and ≤ 2 deck edges below.
 * - Blocked tab: oldest blocked first. The sheet: porthole, name, `shield ws › tab · 1 of n`, the `WAITING m:ss` stamp,
 *   the question (serif), options as the ledger (`role=listbox`, 1–9 active inside the card only), **Open terminal ↗**
 *   last. Choosing an option shows the confirm line on the same sheet ("Send ‘2. Yes’ to tinker?" [Esc] Back
 *   [⏎] Send); only confirm sends `agent.answer {id, key, promptHash}` (the server re-validates the hash, §4.8).
 *   `ok` → the sheet flies off and the next one slides up after 600 ms; `prompt_changed` → shake + new prompt;
 *   `not_accepted` → toast + highlight Open terminal.
 * - Done tab: unacked done agents as ledger lines (Enter signs off the highlighted one) and `[A] Sign off all`
 *   (HQ-local `done.ack`, §6.8.2).
 * - The away recap is the sheet's "While you were out" slip band (one panel, m2-r1): clay rule, then `lamp · name ·
 *   serif sentence · time` lines; no close ×: Esc (closes the inbox) and the detent (switching tab) dismiss it.
 * - Non-modal `role=dialog`: it can be open without focus (away recap); focused, its keys are the `serve` scope (§8.2).
 * One legend per sheet; its entries are also the mouse targets (cards.ts actLegend).
 * The same component serves quick-answer (Alt+1–9 → the confirm), the status card's ledger and the roster's expanded
 * blocked row (both open this confirm: one confirm path).
 * Owner: UI.
 */
import { h, setText, cls, setDisabled } from './dom.ts';
import { errMessage } from '../../../shared/guards.ts';
import type { Entity, Prompt, ReplyMsg } from '../../../shared/protocol.ts';
import type { Store, OutMsg } from '../net/store.ts';
import type { TicketOpts } from './hud.ts';
import type { RecapLine } from './recap.ts';
import { attachPortrait } from '../chars/render/portraits.ts';
import { paper, plaque, detent, porthole, shield, stamp, question, ledger, button, slipBand, type Ledger } from './kit/index.ts';
import { actLegend, injectCardStyles, recapSlipLine } from './cards.ts';
import { taskLabel } from '../../../shared/task.ts';
import { blockedQueue, doneQueue, cardRows, rowForDigit, confirmText, questionText, answerOutcome, initialRow, crumbLabel, isPrompt, type AnswerReply } from './serveModel.ts';
import { mmss } from './recap.ts';
import { elapsedLabel, nameQualifier } from './roster/model.ts';
import { AT_LEAST } from './help.ts'; // [UI fix r1] the '≥' wording

const ADVANCE_MS = 600;
const SKIP_ANSWERED_MS = 6000;

type Tab = 'blocked' | 'done';
/** Where a visit started (see `origin` below). */
export type Origin = 'inbox' | 'card' | 'mini' | 'quick';

export interface InboxDeps {
  root: HTMLElement;
  store: Pick<Store, 'entities' | 'now'>;
  label?: (e: Entity) => string;
  call(m: OutMsg): Promise<ReplyMsg>;
  hooks: {
    open(id: string): void; goTo(id: string): void; signOff(id: string): Promise<unknown> | void; signOffAll(): void;
    toast(lvl: 'info' | 'warn' | 'error', text: string, o?: TicketOpts): unknown; closed(hadFocus: boolean, origin: Origin): void;
    announce(t: string, assertive?: boolean): void;
    answered?(id: string, key: string): void; pend?(k: number): void; keys(): void; typeReply?(id: string, label: string): void;
    /** the streak (triage.ts) toasts the 'inbox zero' moment itself */
    streakOwnsZero?(): boolean;
  };
}

export function createInbox(d: InboxDeps) {
  injectCardStyles();
  const { store, hooks } = d;
  /** [m2-r2 gameplay] the one agent label (names.ts: 'claude · 2' for namesakes), same as chevrons / Big Board */
  const lab = (e: Entity) => (d.label ? d.label(e) : e.name || e.id);
  let open = false;
  let tab: Tab = 'blocked';
  let curId: string | null = null;
  let hl = 0;
  /** card identity (id|prompt hash) `hl` was initialised for; '' = pick the card's safe initial row on next render */
  let hlFor = '';
  /**
   * Every card change goes through here (reviewer r3 SAFETY): the highlight is re-derived from the NEW card
   * (serveModel.initialRow: Claude Code's ❯ unless destructive, else the first safe option), never carried over.
   */
  const resetHl = () => { hlFor = ''; hl = 0; };
  /** last pointer position over the options: hover moves the highlight only on a real pointer move, not when a new
   *  card's rows slide in under a resting cursor (Chromium re-fires mouseenter after the re-render) */
  let ptrX = -1, ptrY = -1, ptrMoved = false;
  /** last user action on the inbox (open / key / click): a fly-off timer older than it leaves the card alone */
  let actedAt = 0;
  addEventListener('mousemove', (ev) => { ptrMoved = ev.clientX !== ptrX || ev.clientY !== ptrY; ptrX = ev.clientX; ptrY = ev.clientY; }, true);
  let confirming = false;
  let busy = false;
  let doneSel = 0;
  /** what the Done list currently shows (diffed on every refresh) */
  let doneKey = '';
  /**
   * Where this visit started (reviewer r2): 'inbox' (B / palette / roster A / away recap: you came to work the queue)
   * or a one-shot answer from elsewhere — 'card' (status card), 'mini' (roster mini card), 'quick' (Alt+1–9). A
   * one-shot visit closes itself after the send and hands focus back to where you were (hooks.closed).
   */
  let origin: Origin = 'inbox';
  /** the fly-off → next-card animation is running (the queue already skips the answered card) */
  let sending = false;
  /** this visit has shown a blocked card: the queue running dry afterwards closes the inbox (Done tab excepted) */
  let sawCards = false;
  /** id → {at, since, hash}: answered moments ago — skipped while that same prompt is still showing (server lag) */
  const answered = new Map<string, { at: number; since: number; hash: string }>();
  /** id → prompt from a prompt_changed reply until the entity catches up */
  const override = new Map<string, Prompt>();

  // ---- DOM (UI kit §5.4: one question per clipped sheet, deck edges below) ----
  const tabs = detent([{ value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done' }], 'blocked', (v) => setTab(v === 'done' ? 'done' : 'blocked'));
  tabs.setAttribute('aria-label', 'Inbox tabs');
  const [tabBlocked, tabDone] = [...tabs.querySelectorAll('button')]; // the detent's two option buttons
  const head = h('div.ih', null, plaque('Inbox'), tabs);

  const port = porthole(null, { size: 'lg' });
  const pt = port.inner;
  const nm = h('div.nm');
  const crest = h('span');
  const where = h('span.cr');
  const pager = h('span.pager');
  const waitStamp = stamp('Waiting', { time: '' });
  const who = h('div.k-who', null, port, h('div', null, nm, h('div.sub', null, crest, where, pager)), waitStamp);
  const qBox = h('div');
  let opts: Ledger = ledger([]);
  const optsBox = h('div');
  const cfText = h('span.t');
  const cfSend = button('Send', { key: 'Enter', primary: true, onClick: () => send() });
  const cfBack = button('Back', { key: 'Esc', onClick: () => { confirming = false; render(); } });
  const confirm = h('div.cf.k-confirm', { role: 'alert' }, h('span.say', null, cfText), cfBack, cfSend);
  const foot = h('div.ft.k-foot');
  // away recap merged into the inbox (§6.4.5, m2-r1): one sheet, the "While you were out" band on top of the question
  const awHead = slipBand({ span: ' ' });
  const awMins = awHead.querySelector<HTMLElement>('.span') ?? h('span'); // slipBand({span}) always draws it
  const awList = h('div');
  const recapEl = h('div.aw.k-slip', { hidden: true, role: 'status' }, awHead, awList);
  const blockedBody = h('div.bb', null, who, qBox, optsBox, confirm, foot);
  const empty = h('div.empty', null, stamp('Inbox zero', { ink: 'done' }), h('span', { text: 'Nobody is waiting on you.' }));

  const doneList = h('div.dl');
  const allBtn = button('Sign off all', { key: 'A', primary: true, onClick: () => hooks.signOffAll() });
  const doneFoot = h('div.dfoot.k-foot');
  const doneNote = h('p.note', { text: 'Sign-off is HQ-local: herdr keeps its own “done” until you focus the pane there.' });
  const doneBody = h('div.db', null, doneNote, doneList, doneFoot);

  const sheet = paper({ clip: true, deck: 2 });
  const card = sheet.sheet;
  card.classList.add('card');
  card.append(head, recapEl, blockedBody, empty, doneBody);
  const deck = sheet.querySelector<HTMLElement>('.k-deck');
  const el = h('div.hq-inbox.hq-cards', { role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Blocked Inbox', tabindex: '-1' }, sheet);
  el.addEventListener('animationend', (ev) => { if (ev.animationName === 'hq-card-shake') card.classList.remove('shake'); });
  d.root.append(el);

  // ---- model ----
  const queue = () => {
    const now = performance.now();
    for (const [id, a] of answered) if (now - a.at > SKIP_ANSWERED_MS) answered.delete(id);
    return blockedQueue(store.entities.values()).filter((e) => {
      const a = answered.get(e.id);
      return !a || a.since !== e.statusSince || (a.hash && e.prompt?.hash && a.hash !== e.prompt.hash);
    });
  };
  const promptOf = (e: Entity): Prompt | null => {
    const o = override.get(e.id);
    if (o && e.prompt && o.hash === e.prompt.hash) { override.delete(e.id); return e.prompt; }
    return o ?? e.prompt;
  };
  function current() {
    const qq = queue();
    let e = curId ? qq.find((x) => x.id === curId) : null;
    if (!e) { e = qq[0] ?? null; if (e?.id !== curId) { curId = e?.id ?? null; resetHl(); confirming = false; } }
    return { e, qq };
  }

  // ---- render ----
  let rowKey = '';
  let footKey = '';
  function render() {
    if (!open) return;
    const now = store.now();
    const { e, qq } = current();
    if (qq.length) sawCards = true;
    else if (sawCards && tab === 'blocked' && !sending && !busy) {
      // the queue ran dry (answered here, in a terminal, or in herdr): nothing left to serve → close, keep the moment
      // (M3.5: the 'Inbox zero! n answered in m:ss' toast + bus 'inbox.zero' come from the streak, triage.ts createStreak)
      if (!hooks.streakOwnsZero?.()) hooks.toast('info', 'Inbox zero · everyone is unblocked ✓', { key: 'inbox0' });
      api.close();
      return;
    }
    const dq = doneQueue(store.entities.values());
    setText(tabBlocked, qq.length ? `Blocked ${qq.length}` : 'Blocked');
    setText(tabDone, dq.length ? `Done ${dq.length}` : 'Done');
    if (tabs.value !== tab) tabs.set(tab);
    el.setAttribute('aria-label', tab === 'blocked' ? `Blocked Inbox, ${qq.length} waiting` : `Done, ${dq.length} to sign off`);
    // the deck: one sheet edge per further card (≤ 2), none on the Done tab
    const n = tab === 'blocked' ? Math.min(2, Math.max(0, qq.length - 1)) : 0;
    if (deck) { cls(deck, 'one', n === 1); cls(deck, 'none', n === 0); }
    const idx = e ? qq.indexOf(e) : -1;
    setText(pager, tab === 'blocked' && qq.length > 1 ? ` · ${idx + 1} of ${qq.length}` : '');
    blockedBody.hidden = tab !== 'blocked' || !e;
    empty.hidden = tab !== 'blocked' || !!e;
    doneBody.hidden = tab !== 'done';
    if (tab === 'blocked' && e) renderBlocked(e, now, qq.length);
    if (tab === 'done') renderDone(dq, now);
  }

  function renderBlocked(e: Entity, now: number, total: number) {
    const p = promptOf(e);
    const rows = cardRows(p);
    // a new card starts on the option Claude Code itself highlights (❯), never blindly on 1, and never on a
    // destructive one ("No, exit"): then the first safe option, else Open terminal (Enter, Enter must not kill an agent)
    const hk = `${e.id}|${p?.hash ?? ''}`;
    if (hk !== hlFor) { hlFor = hk; hl = initialRow(rows, p?.selected ?? 0); }
    if (hl >= rows.length) hl = rows.length - 1;
    const key = `${e.id}|${p?.hash ?? ''}|${e.kind}|${e.status}|${e.workspace?.colorIndex}|${lab(e)}`;
    if (key !== rowKey) {
      rowKey = key;
      const fresh = porthole(e, { size: 'lg' });
      port.style.setProperty('--ws', fresh.style.getPropertyValue('--ws'));
      pt.replaceChildren(...fresh.inner.childNodes);
      attachPortrait(pt, e.id, 56);
      const qual = nameQualifier(e, store.entities.values());
      nm.textContent = lab(e);
      crest.replaceChildren(shield(e.workspace?.colorIndex));
      where.textContent = crumbLabel(qual, e.workspace?.label, e.tab?.label);
      const qEl = question(questionText(p) || 'Waiting for input (no question parsed yet).');
      cls(qEl, 'free', !p?.options?.length);
      qBox.replaceChildren(qEl);
      opts = ledger(rows.map((r) => (r.kind === 'open'
        ? { label: 'Open terminal ↗', key: 'O' }
        : { label: r.label, key: String(r.n), note: r.danger === 'exit' ? 'ends session' : r.danger === 'reject' ? 'refuses' : undefined, destructive: !!r.danger })),
      { selected: hl, wrap: true, onPick: (i) => { actedAt = performance.now(); hl = i; choose(); } });
      opts.classList.add('opts');
      opts.setAttribute('aria-label', 'Options');
      [...opts.children].forEach((li, i) => {
        if (!(li instanceof HTMLElement)) return;
        const r = rows[i];
        li.id = `hq-io-${i}`;
        li.classList.add(r.kind);
        cls(li, 'danger', !!r.danger);
        li.querySelector('.tx')?.classList.add('lb');
        if (r.danger) li.title = r.danger === 'exit' ? `Ends ${lab(e)}'s session` : 'Refuses the request';
        li.addEventListener('mousemove', () => { if (ptrMoved && !confirming && hl !== i) { hl = i; paintHl(); } });
      });
      optsBox.replaceChildren(opts);
    }
    waitStamp.setTime(mmss(now - (e.statusSince || now), e.statusSinceApprox));
    waitStamp.title = e.statusSinceApprox ? `≥ = ${AT_LEAST}` : ''; // [UI fix r1]
    paintHl();
    confirm.hidden = !confirming;
    cls(card, 'confirming', confirming);
    cls(confirm, 'danger', confirming && !!rows[hl]?.danger);
    if (confirming) {
      const t = confirmText({ ...e, name: lab(e) }, rows[hl]);
      setText(cfText, t);
      cfText.title = rows[hl]?.label ?? '';
    }
    setDisabled(cfSend, busy);
    cls(card, 'busy', busy);
    // one legend; while confirming, Back / Send carry Esc / Enter
    const nOpt = rows.filter((r) => r.kind === 'opt').length;
    const fk = `${nOpt}|${total > 1}|${confirming}`;
    if (fk !== footKey) {
      footKey = fk;
      foot.replaceChildren(actLegend([
        nOpt ? { key: nOpt > 1 ? ['1', '–', String(nOpt)] : '1', label: 'answer' } : null,
        total > 1 ? { key: 'ArrowRight', label: 'next', act: () => api.action('next') } : null,
        // O (terminal) lives on the ledger's last line, "Open terminal ↗": not repeated here (banned #7, fix r2)
        { key: 'G', label: 'go there', act: () => api.action('goThere') },
        confirming ? null : { spacer: true },
        confirming ? null : { key: 'Esc', label: 'close', title: 'Close the inbox', act: () => api.close() },
      ]));
    }
  }
  function paintHl() {
    opts.select(hl);
    for (const li of opts.children) if (li instanceof HTMLElement) cls(li, 'hl', Number(li.dataset.i) === hl);
    opts.setAttribute('aria-activedescendant', `hq-io-${hl}`);
  }

  function renderDone(dq: Entity[], now: number) {
    if (doneSel >= dq.length) doneSel = Math.max(0, dq.length - 1);
    if (allBtn.lastChild) allBtn.lastChild.textContent = dq.length ? `Sign off all (${dq.length})` : 'Nothing to sign off';
    setDisabled(allBtn, !dq.length);
    allBtn.hidden = !dq.length;
    doneNote.hidden = !dq.length;
    const k = dq.map((x) => `${x.id}:${x.status}:${lab(x)}`).join(',') + `|${doneSel}|${Math.floor(now / 5000)}`;
    if (doneKey === k) return;
    doneKey = k;
    doneFoot.replaceChildren(actLegend([
      dq.length ? { key: dq.length > 1 ? ['1', '–', String(Math.min(9, dq.length))] : '1', label: 'select' } : null,
      dq.length ? { key: 'Enter', label: 'sign off', act: () => api.action('choose') } : null,
      dq.length ? { key: 'O', label: 'terminal', act: () => api.action('openTerm') } : null,
      dq.length ? null : { key: 'Tab', label: 'blocked', act: () => setTab('blocked') },
    ]), allBtn);
    if (!dq.length) { doneList.replaceChildren(h('div.none', { text: 'All signed off. The sofa is getting crowded.' })); return; }
    const lg = ledger(dq.map((x, i) => ({
      label: lab(x), key: i < 9 ? String(i + 1) : '·',
      lead: porthole(x, { size: 'xs' }),
      note: `${taskLabel(x) ?? x.project ?? ''} · done ${elapsedLabel(now - (x.statusSince || now))}`.replace(/^ · /, ''),
    })), { selected: doneSel, onPick: (i) => { doneSel = i; render(); } });
    lg.setAttribute('aria-label', 'Done agents');
    [...lg.children].forEach((li, i) => { li.querySelector('.note')?.classList.add('meta'); li.addEventListener('dblclick', () => { void hooks.signOff(dq[i].id); }); });
    doneList.replaceChildren(lg);
  }

  // ---- actions ----
  function setTab(t: Tab) {
    if (t !== tab) recapEl.hidden = true; // the detent turns the page: the recap was read
    tab = t;
    confirming = false;
    rowKey = '';
    footKey = '';
    doneKey = '';
    render();
  }
  function choose() {
    const { e } = current();
    if (!e || busy) return;
    const rows = cardRows(promptOf(e));
    const r = rows[hl];
    if (!r) return;
    if (r.kind === 'open') { hooks.open(e.id); return; }
    if (confirming) { void send(); return; }
    confirming = true;
    render();
    cfSend.focus({ preventScroll: true });
    el.focus({ preventScroll: true });
  }
  async function send() {
    const { e } = current();
    if (!e || busy || !confirming) return;
    const p = promptOf(e);
    const r = cardRows(p)[hl];
    if (!r || r.kind !== 'opt' || !p?.hash) return;
    busy = true;
    render();
    let res: AnswerReply;
    // [UI fix r3, fun "inbox zero 0:00"] the answer is in flight until counted: the status flip often lands before the
    // reply, and inbox zero must wait for answered() (live order: pend(+1) → flip → answered → pend(-1))
    hooks.pend?.(1);
    try { res = await d.call({ t: 'agent.answer', id: e.id, key: r.key, promptHash: p.hash }); } catch (err) { res = { ok: false, error: errMessage(err) || String(err) }; }
    busy = false;
    confirming = false;
    const out = answerOutcome(res);
    if (out !== 'sent') hooks.pend?.(-1);
    if (out === 'sent') {
      answered.set(e.id, { at: performance.now(), since: e.statusSince, hash: p.hash });
      hooks.answered?.(e.id, r.key);
      hooks.pend?.(-1);
      hooks.announce(`Answered ${lab(e)}: ${r.label}`);
      if (r.free) {
        // a free-text option only opened the agent's text field: take you to type there (Control, xterm focused)
        // instead of advancing while the agent waits invisibly (reviewer r3)
        resetHl();
        rowKey = '';
        api.close();
        hooks.typeReply?.(e.id, r.label);
        return;
      }
      card.classList.add('sent');
      sending = true;
      const sentAt = performance.now();
      setTimeout(() => {
        sending = false;
        card.classList.remove('sent');
        // still on the answered card: move on (the next card starts on its own safe row, reviewer r3). A card you
        // already moved to during the fly-off keeps its highlight / confirm (a late timer must not stomp it)
        if (curId === e.id && actedAt <= sentAt) { curId = null; resetHl(); }
        rowKey = '';
        render(); // an empty queue closes here (with the inbox-zero toast)
        if (!open) return;
        // a one-shot answer (status card / roster mini card / Alt+digit) doesn't strand you in the serve scope
        if (origin !== 'inbox') { api.close(); return; }
        card.classList.add('slidein');
        setTimeout(() => card.classList.remove('slidein'), 260);
      }, ADVANCE_MS);
    } else if (out === 'changed') {
      if (isPrompt(res.prompt)) override.set(e.id, res.prompt);
      resetHl();
      rowKey = '';
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      hooks.toast('warn', `${lab(e)}'s prompt changed — look again.`, { key: `pc:${e.id}` });
    } else if (out === 'gone') {
      hooks.toast('info', `${lab(e)} is no longer blocked.`, { key: `pc:${e.id}` });
      answered.set(e.id, { at: performance.now(), since: e.statusSince, hash: p.hash });
    } else if (out === 'notAccepted') {
      hooks.toast('warn', `${lab(e)} didn't take the answer — try the terminal.`, { key: `na:${e.id}` });
      hl = cardRows(p).length - 1;
    } else {
      hooks.toast('warn', `Answer failed: ${res?.error ?? 'unknown error'}`);
    }
    render();
  }
  function step(dir: 1 | -1) {
    const qq = queue();
    if (!qq.length) return;
    const i = Math.max(0, qq.findIndex((x) => x.id === curId));
    curId = qq[(i + dir + qq.length) % qq.length].id;
    resetHl();
    confirming = false;
    rowKey = '';
    render();
  }

  const api = {
    el,
    get isOpen() { return open; },
    get focused() { return el.contains(document.activeElement); },
    get tab() { return tab; },
    get currentId() { return tab === 'blocked' ? current().e?.id ?? null : null; },
    get confirming() { return confirming; },
    /** Done tab: the highlighted row's id (p2) */
    get doneSelectedId() { return doneQueue(store.entities.values())[doneSel]?.id ?? null; },
    get doneIds() { return doneQueue(store.entities.values()).map((x) => x.id); },
    get origin() { return origin; },
    /**
     * `o.from`: where the visit started (default 'inbox'); an inbox you are already working (opened with B) stays an
     * inbox visit.
     */
    open(o: { id?: string | null; tab?: Tab; focus?: boolean; digit?: number; confirm?: boolean; row?: number; from?: Origin } = {}) {
      actedAt = performance.now();
      const was = open;
      if (!was) { origin = o.from ?? 'inbox'; sawCards = false; } else if (origin !== 'inbox') origin = o.from ?? 'inbox';
      open = true;
      cls(el, 'open', true);
      if (o.tab) tab = o.tab;
      else if (!was) tab = queue().length || !doneQueue(store.entities.values()).length ? 'blocked' : 'done';
      if (o.id) { tab = 'blocked'; if (curId !== o.id) { curId = o.id; resetHl(); confirming = false; rowKey = ''; } }
      if (!was) { rowKey = ''; card.classList.add('slidein'); setTimeout(() => card.classList.remove('slidein'), 260); }
      render();
      if (o.digit) {
        const { e } = current();
        const i = e ? rowForDigit(cardRows(promptOf(e)), o.digit) : -1;
        if (i >= 0) { hl = i; if (o.confirm) confirming = true; render(); } else if (e) hooks.toast('warn', `No option ${o.digit} on ${lab(e)}'s prompt.`);
      } else if (o.confirm && typeof o.row === 'number') { hl = o.row; confirming = true; render(); }
      if (o.focus) el.focus({ preventScroll: true });
    },
    close() {
      if (!open) return;
      const hadFocus = api.focused;
      open = false;
      confirming = false;
      sawCards = false;
      cls(el, 'open', false);
      recapEl.hidden = true;
      if (hadFocus && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      hooks.closed(hadFocus, origin);
    },
    focus() { if (open) el.focus({ preventScroll: true }); },
    render,
    /**
     * The away recap as the inbox's own header (§6.4.5, m2-r1: one panel instead of a strip stacked on the inbox).
     * `lines` = recap.ts lines (+ `act`: click handler or null); null hides it. Hidden again when the inbox closes.
     */
    recap(r: { lines: (RecapLine & { act?: (() => void) | null })[]; minutes: number } | null) {
      recapEl.hidden = !r;
      if (!r) return;
      setText(awMins, `${r.minutes >= 90 ? `${Math.round(r.minutes / 60)} h` : `${Math.round(r.minutes)} min`} away`);
      awList.replaceChildren(...r.lines.map((l) => recapSlipLine(l, l.act ? () => { api.recap(null); l.act?.(); } : null)));
    },
    get recapShown() { return open && !recapEl.hidden; },
    /** `serve` scope actions (keymap.ts SERVE). */
    action(name: string, arg: number | null = null): boolean {
      if (!open) return false;
      actedAt = performance.now();
      if (tab === 'done') return doneAction(name, arg);
      const { e } = current();
      const rows = e ? cardRows(promptOf(e)) : [];
      switch (name) {
        case 'down': if (!confirming && rows.length) { hl = (hl + 1) % rows.length; render(); } return true;
        case 'up': if (!confirming && rows.length) { hl = (hl - 1 + rows.length) % rows.length; render(); } return true;
        case 'option': {
          if (!e) return true;
          const i = arg == null ? -1 : rowForDigit(rows, arg);
          if (i < 0) { hooks.toast('info', `No option ${arg}.`); return true; }
          hl = i; confirming = true; render(); return true;
        }
        case 'choose': choose(); return true;
        case 'openTerm': if (e) hooks.open(e.id); return true;
        case 'goThere': if (e) hooks.goTo(e.id); return true;
        case 'next': step(1); return true;
        case 'prev': step(-1); return true;
        case 'tab': setTab('done'); return true;
        case 'signOffAll': return true;
        case 'close': if (confirming) { confirming = false; render(); } else api.close(); return true;
      }
      return false;
    },
  };
  function doneAction(name: string, arg: number | null) {
    const dq = doneQueue(store.entities.values());
    const x = dq[doneSel];
    switch (name) {
      case 'down': case 'next': doneSel = Math.min(dq.length - 1, doneSel + 1); render(); return true;
      case 'up': case 'prev': doneSel = Math.max(0, doneSel - 1); render(); return true;
      // [m2-r1 SAFETY] a digit only selects row n: the 'B, 1' answer habit must never sign someone off unconfirmed.
      // Sign-off stays on Enter / Space / E (labelled in the footer) and the row's own button
      case 'option': if (arg != null && arg >= 1 && arg <= dq.length) { doneSel = arg - 1; render(); } return true;
      case 'choose': if (x) void hooks.signOff(x.id); return true;
      case 'signOffAll': if (dq.length) hooks.signOffAll(); return true;
      case 'openTerm': if (x) hooks.open(x.id); return true;
      case 'goThere': if (x) hooks.goTo(x.id); return true;
      case 'tab': setTab('blocked'); return true;
      case 'close': api.close(); return true;
    }
    return false;
  }
  return api;
}
