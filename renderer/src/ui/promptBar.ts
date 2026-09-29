/**
 * Talk (`T`, M3.5): a one-line prompt bar for the aimed / selected agent. Type (or pick a quick prompt: continue, run tests,
 * commit, summarize), Enter shows the confirm `Send "…" to <label>? [Enter] send [Esc] back`, and only that second
 * Enter sends `agent.prompt {id, text}` (§4.8 interact: the UI confirms prompts). Esc from the bar closes it and sends
 * nothing (p2 spies on the WS). On success the bus gets `verb {verb:'prompt', id}` + `prompt.sent {id}` (BRN, CHR,
 * FX, AUD react). A free-standing DOM card with its own keydown handler: while it is open the global dispatcher
 * stands down (index.ts `blocked()`), so every key types.
 * Owner: UI.
 */
import { h, setText, cls, refocus, setDisabled } from './dom.ts';
import { errMessage } from '../../../shared/guards.ts';
import type { Entity, ReplyMsg } from '../../../shared/protocol.ts';
import type { Store, OutMsg } from '../net/store.ts';
import type { Bus } from '../core/bus.ts';
import type { TicketOpts } from './hud.ts';
import { plaque, porthole, slot, keycap, legend, button, trapFocus } from './kit/index.ts';
import { injectDialogCss } from './dialogCss.ts';

/**
 * Keep a bottom strip clear of the fixed panels: centred on the visible world strip (between roster and drawer), and only
 * when that would overlap the minimap (bottom-left) or the status card (bottom-right) in the strip's own band does the
 * layer's left / right edge stop short of that panel (at 1280×720 the card used to sit under the bar). The strip keeps
 * `width:min(680px,100%)` of what is left, never less than 420 px. Call after the layer is shown (it measures the strip).
 * `wrap` = the `.hq-dlg.low` layer, `root` = the `.hq-ui` root.
 */
export function placeBar(wrap: HTMLElement, root: HTMLElement): void {
  const W = innerWidth;
  const cs = getComputedStyle(root);
  const wl = parseFloat(cs.getPropertyValue('--world-l')) || 0;
  const wr = parseFloat(cs.getPropertyValue('--world-r')) || 0;
  const bar = wrap.firstElementChild;
  const bh = (bar instanceof HTMLElement ? bar.offsetHeight : 0) || 100;
  const bandBot = innerHeight * 0.88;
  const bandTop = bandBot - bh;
  const obstacles: DOMRect[] = [];
  for (const sel of ['.hq-mini', '.hq-scard.show']) {
    const el = root.querySelector<HTMLElement>(sel);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.top < bandBot && r.bottom > bandTop) obstacles.push(r);
  }
  let L = wl, R = W - wr;
  for (let pass = 0; pass < 2; pass++) {
    const w = Math.min(680, R - L - 32);
    const x0 = (L + R) / 2 - w / 2;
    for (const r of obstacles) {
      if (r.left + r.width / 2 < (L + R) / 2) { if (x0 < r.right + 12) L = Math.max(L, r.right); }
      else if (x0 + w > r.left - 12) R = Math.min(R, r.left);
    }
  }
  if (R - L < 420 + 32) { const need = 420 + 32 - (R - L); L = Math.max(wl, L - need); } // too tight: overlap the minimap, stay usable
  wrap.style.paddingLeft = `${Math.round(L + 16)}px`;
  wrap.style.paddingRight = `${Math.round(W - R + 16)}px`;
}

/** Quick prompts (Alt+1–4): label → prompt text. */
export const PROMPT_CHIPS = Object.freeze([
  { id: 'continue', label: 'continue', text: 'continue' },
  { id: 'tests', label: 'run tests', text: 'Run the tests and fix anything that fails.' },
  { id: 'commit', label: 'commit', text: 'Commit your changes with a clear message.' },
  { id: 'summarize', label: 'summarize', text: 'Summarize what you did and what is left, briefly.' },
]);
export const PROMPT_MAX = 8 * 1024; // LIMITS.textMax

/** @pure Confirm line for a prompt (clipped). */
export function promptConfirmText(text: string, who: string): string {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const clip = t.length > 60 ? `${t.slice(0, 57)}…` : t;
  return `Send “${clip}” to ${who}?`;
}

type Toast = (level: 'info' | 'warn' | 'error', text: string, o?: TicketOpts) => unknown;

export interface PromptBarDeps {
  root: HTMLElement;
  store: Pick<Store, 'entities'>;
  call(m: OutMsg): Promise<ReplyMsg>;
  bus?: Bus | null;
  label(e: Entity): string;
  hooks: { toast: Toast; closed(sent: boolean): void; announce?(t: string): void };
}

export function createPromptBar(d: PromptBarDeps) {
  const { store, hooks } = d;
  injectDialogCss();
  const who = h('b.who');
  const port = h('span', { style: { display: 'contents' } });
  const sl = slot({ voice: true, label: 'Prompt', placeholder: 'Tell it what to do next…' });
  const input = sl.input;
  input.maxLength = PROMPT_MAX;
  const reviewKey = legend([{ key: 'Enter', label: 'review' }]);
  // quick prompts: one legend line [Alt]+[1] continue [2] run tests … (clickable), then [Esc] cancel
  const quick = h('div.k-legend.quick', null,
    h('span.h', { style: { marginRight: '-10px' } }, keycap('Alt'), '+'),
    ...PROMPT_CHIPS.map((c, i) => h('span.h', { 'data-chip': c.id, title: c.text, onclick: () => pick(i) }, keycap(String(i + 1)), c.label)),
    h('span.k-sp'), h('span.h', null, keycap('Esc'), 'cancel'));
  const cfText = h('span.say');
  const cfBack = button('Back', { key: 'Escape', onClick: () => back() });
  const cfSend = button('Send', { key: 'Enter', primary: true, onClick: () => void send() });
  const confirmRow = h('div.cf', { hidden: true, style: { display: 'contents' } }, cfText, cfBack, cfSend);
  const err = h('div.err', { hidden: true, role: 'alert' });
  const card = h('div.hq-pbar2.k-paper', { role: 'dialog', 'aria-label': 'Talk to agent' },
    h('div.ln', null, plaque('To', { small: true }), port, who, sl, reviewKey),
    h('div.k-foot', null, quick, confirmRow), err);
  const wrap = h('div.hq-pbar2-wrap.hq-dlg.low', null, card);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) close(); });
  d.root.append(wrap);
  trapFocus(card);
  addEventListener('resize', () => { if (api.isOpen) placeBar(wrap, d.root); });

  let id: string | null = null;
  let placeTimer: ReturnType<typeof setInterval> | undefined;
  let confirming = false;
  let busy = false;
  let restore: Element | null = null;
  let sentCount = 0;
  let portFor: string | null = null;

  const ent = () => (id ? store.entities.get(id) : null);
  const lab = (e: Entity | null | undefined) => (e ? d.label(e) : 'the agent');

  function render() {
    const e = ent();
    setText(who, lab(e));
    if (e && portFor !== `${e.id}|${e.workspace?.colorIndex}|${e.status}`) {
      portFor = `${e.id}|${e.workspace?.colorIndex}|${e.status}`;
      port.replaceChildren(porthole(e, { size: 'xs' }));
    }
    confirmRow.hidden = !confirming;
    quick.hidden = confirming;
    reviewKey.hidden = confirming;
    cls(card, 'confirming', confirming);
    cls(card, 'busy', busy);
    input.readOnly = confirming || busy;
    setDisabled(cfSend, busy);
    // the text is right above on the same strip: the confirm line names only the target (say it once)
    if (confirming) { cfText.replaceChildren('Send this to ', h('b', { text: lab(e) }), '?'); cfText.title = promptConfirmText(input.value, lab(e)); }
  }
  function pick(i: number) {
    const c = PROMPT_CHIPS[i];
    if (!c || confirming) return;
    input.value = c.text;
    err.hidden = true;
    input.focus();
    review();
  }
  function review() {
    const t = input.value.trim();
    if (!t) { input.focus(); return; }
    if (!ent()) { showErr('That agent is gone.'); return; }
    confirming = true;
    err.hidden = true;
    render();
    cfSend.focus({ preventScroll: true });
  }
  function back() {
    confirming = false;
    render();
    input.focus();
  }
  function showErr(t: string) { err.hidden = false; setText(err, t); }
  async function send() {
    const e = ent();
    const text = input.value.trim();
    if (!confirming || busy || !e || !text) return;
    busy = true;
    render();
    let r: Pick<ReplyMsg, 'ok' | 'error'>;
    try { r = await d.call({ t: 'agent.prompt', id: e.id, text }); } catch (x) { r = { ok: false, error: errMessage(x) || String(x) }; }
    busy = false;
    if (!r?.ok) {
      confirming = false;
      render();
      showErr(r?.error === 'readonly_protocol' ? 'herdr is read-only here: prompts are refused.' : r?.error === 'unknown_entity' ? 'That pane is gone.' : `Not sent: ${r?.error ?? 'failed'}`);
      input.focus();
      return;
    }
    sentCount++;
    d.bus?.emit('verb', { verb: 'prompt', id: e.id });
    d.bus?.emit('prompt.sent', { id: e.id });
    hooks.toast('info', `Sent to ${lab(e)} ✓`, { sub: `“${text.length > 70 ? `${text.slice(0, 67)}…` : text}”`, key: `prompt:${e.id}` });
    hooks.announce?.(`Prompt sent to ${lab(e)}`);
    close(true);
  }
  function close(sent = false) {
    if (!api.isOpen) return;
    wrap.classList.remove('show');
    confirming = false;
    busy = false;
    const r = restore;
    restore = null;
    if (id) d.bus?.emit('talk.close', { id, sent }); // [BRN fix m3-r3, cross-owner UI] the agent stops listening (chars/actors.ts)
    id = null;
    try { refocus(r, { preventScroll: true }); } catch { /* gone */ }
    hooks.closed(sent);
  }

  card.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    const k = ev.key;
    let handled = true;
    if (k === 'Escape') { if (confirming && !busy) back(); else if (!busy) close(); }
    else if (k === 'Enter') { if (confirming) void send(); else review(); }
    else if (ev.altKey && /^Digit[1-4]$/.test(ev.code)) pick(+ev.code.slice(5) - 1);
    else if (confirming && k !== 'Tab') { /* confirm stage: nothing types */ }
    else handled = false;
    if (handled) { ev.preventDefault(); ev.stopPropagation(); }
  });
  input.addEventListener('input', () => { err.hidden = true; });

  const api = {
    el: wrap,
    get isOpen() { return wrap.classList.contains('show'); },
    get id() { return id; },
    get confirming() { return confirming; },
    get sent() { return sentCount; },
    /** `o.text` prefills; `o.confirm` goes straight to the confirm. */
    open(forId: string, o: { text?: string; confirm?: boolean } = {}) {
      if (api.isOpen && id && id !== forId) d.bus?.emit('talk.close', { id, sent: false }); // [BRN fix m3-r3, cross-owner UI]
      id = forId;
      d.bus?.emit('talk.open', { id: forId }); // [BRN fix m3-r3, cross-owner UI] the agent stops, faces the player, listens
      confirming = false;
      busy = false;
      err.hidden = true;
      input.value = o.text ?? '';
      if (!api.isOpen) restore = document.activeElement;
      if (document.pointerLockElement) document.exitPointerLock?.();
      wrap.classList.add('show');
      render();
      placeBar(wrap, d.root);
      clearInterval(placeTimer); // the status card follows the selection a beat later (10 Hz UI tick): keep clear of it
      placeTimer = setInterval(() => { if (api.isOpen) placeBar(wrap, d.root); else clearInterval(placeTimer); }, 250);
      input.focus({ preventScroll: true });
      if (o.confirm && input.value.trim()) review();
    },
    close: () => close(false),
    render,
  };
  return api;
}

/**
 * Shift+N rename (M3.5): a one-line card that sets the agent's HQ-local alias (aliases.ts, by stable identity, never
 * sent to herdr). Enter saves, an empty name restores herdr's, Esc cancels.
 */
export function createRenameCard(d: {
  root: HTMLElement; store: Pick<Store, 'entities'>; label(e: Entity): string; setAlias(e: Entity, s: string): boolean;
  hooks: { toast: Toast; closed(): void };
}) {
  injectDialogCss();
  const port = h('span', { style: { display: 'contents' } });
  const sl = slot({ label: 'New name' });
  const input = sl.input;
  input.maxLength = 32;
  const card = h('div.hq-pbar2.k-paper', { role: 'dialog', 'aria-label': 'Rename agent' },
    h('div.ln', null, plaque('Rename', { small: true }), port, sl), // the slot holds the current name: said once
    h('div.k-foot', null, h('span.aside', { text: 'HQ only: herdr keeps its name · empty restores it' }), h('span.k-sp'),
      legend([{ key: 'Enter', label: 'save' }, { key: 'Escape', label: 'cancel' }])));
  const wrap = h('div.hq-pbar2-wrap.hq-dlg.low', null, card);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) close(); });
  d.root.append(wrap);
  trapFocus(card);
  let id: string | null = null, restore: Element | null = null;
  function close() {
    if (!api.isOpen) return;
    wrap.classList.remove('show');
    id = null;
    try { refocus(restore, { preventScroll: true }); } catch { /* gone */ }
    restore = null;
    d.hooks.closed();
  }
  card.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault(); ev.stopPropagation();
    const e = id ? d.store.entities.get(id) : null;
    if (e) {
      const before = d.label(e);
      if (d.setAlias(e, input.value)) d.hooks.toast('info', input.value.trim() ? `${before} is now ${d.label(e)}` : `${d.label(e)}: herdr’s name restored`, { sub: 'HQ-local rename · by stable identity' });
    }
    close();
  });
  const api = {
    el: wrap,
    get isOpen() { return wrap.classList.contains('show'); },
    open(forId: string) {
      const e = d.store.entities.get(forId);
      if (!e) return;
      id = forId;
      port.replaceChildren(porthole(e, { size: 'xs' }));
      input.setAttribute('aria-label', `New name for ${d.label(e)}`);
      input.value = d.label(e).replace(/ · \d+$/, '');
      if (!api.isOpen) restore = document.activeElement;
      if (document.pointerLockElement) document.exitPointerLock?.();
      wrap.classList.add('show');
      placeBar(wrap, d.root);
      input.focus({ preventScroll: true });
      input.select();
    },
    close,
  };
  return api;
}
