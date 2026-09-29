/**
 * One drawer tab's terminal (§8.4–8.6): an xterm at exactly the child's grid, letterboxed in the drawer, fed by
 * binary `term.data`, with the Peek → Control promotion, the outbox, clipboard paths and the local history overlay.
 * Owner: UI.
 */
import { Terminal } from '@xterm/xterm';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { h } from '../dom.ts';
import type { ClientMsg, Entity, ReplyMsg, TermMode, TermStateMsg, ToastLevel } from '../../../../shared/protocol.ts';
import type { Settings } from '../../core/settings.ts';
import type { Platform } from '../platform.ts';
import { XTERM } from '../../../../shared/palette.ts';
import { keys as kitKeys } from '../kit/index.ts';
import { TERM_FONT as MONO } from '../styles.ts';
import { createInputPipe, PASTE_HARD_CAP } from './input.ts';
import { lifeView, peekKey, type LifeView } from './lifecycle.ts';
import { gridFor, letterbox, hardMinPx, type Grid } from './fit.ts';

import { copyText, readClipboard, setPrimary, getPrimary } from './clipboard.ts';
import { resolveKey } from '../keymap.ts';
import { createGlyphMapper, mapGlyphText } from './glyphs.ts';

/** A plain Enter this soon after an Enter opened the terminal is swallowed (double-tap guard, M3.5). */
export const ENTER_GUARD_MS = 250;
/** ART §9.3 xterm theme (matches the in-world monitors); the values live in shared/palette.ts XTERM (no hex in ui/**). */
export const XTERM_THEME = XTERM;
export const LINE_HEIGHT = 1.15;
/** .hq-thost padding (terminal/styles.ts: 10 8 8 12): the glass margin around the grid, in the fit math */
const PAD_W = 20, PAD_H = 18;

// ---- cell metrics (canvas estimate, calibrated against xterm's real render dimensions) ----
const mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
let calib = { w: 1, h: 1 };

/** xterm's private render metrics: not in its typings, read through `internals()` only. */
interface CellDims { width: number; height: number }
interface XtermInternals {
  _core?: {
    _renderService?: { dimensions?: { css?: { cell?: CellDims }; device?: { canvas?: { width: number; height: number } } } };
    screenElement?: HTMLElement;
  };
}
/** The one cast onto xterm's private `_core` (a real API boundary: the letterbox must match xterm's actual cell size). */
const internals = (t: Terminal) => t as Terminal & XtermInternals;

/**
 * [drawer fix r1] the char height the way xterm measures it (a DOM span of 'W's at line-height normal, ceil'd in device
 * px); the cell height is then floor(charHeight × lineHeight). The canvas font box differed from it by a pixel at some
 * sizes, and a ratio calibrated at 14 px then under-estimated 11 px rows (the observe cap asked for 46 rows where 42
 * fit, so the frame panned).
 */
const charH = new Map<number, number>();
function domCharH(px: number): number | null {
  let v = charH.get(px);
  if (v != null) return v;
  if (typeof document === 'undefined' || !document.body) return null;
  const sp = document.createElement('span');
  sp.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;line-height:normal;font-size:${px}px;font-family:${MONO}`;
  sp.textContent = 'W'.repeat(32);
  document.body.append(sp);
  v = sp.getBoundingClientRect().height;
  sp.remove();
  if (v > 0) charH.set(px, v);
  return v > 0 ? v : null;
}
function estimate(px: number) {
  if (!mctx) throw new Error('view: no 2d canvas to measure the terminal font with');
  mctx.font = `${px}px ${MONO}`;
  const m = mctx.measureText('W');
  const r = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
  const dh = domCharH(px);
  if (dh) return { w: m.width, h: Math.floor(Math.ceil(dh * r) * LINE_HEIGHT) / r };
  const asc = m.fontBoundingBoxAscent ?? px * 0.8, desc = m.fontBoundingBoxDescent ?? px * 0.25;
  return { w: m.width, h: Math.ceil(asc + desc) * LINE_HEIGHT };
}
/**
 * [UI fix r2] xterm snaps a cell's width to whole device pixels (floor of the glyph advance): 13 px → 7, 14 px → 8
 * here. A plain ratio calibrated at one size under-estimated the next (7.54 for a real 8 at 14 px), so every fit to
 * "the drawer at 14 px" overflowed and drew at 13 ('13px (scaled from 14)', a hired shell). Snap first, then calibrate
 * the small remainder.
 */
const snapW = (w: number) => { const r = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1; return Math.max(1, Math.floor(w * r + 1e-3)) / r; };
/** CSS px cell size at a font size. */
export function cellSize(px: number) {
  const e = estimate(px);
  return { w: snapW(e.w) * calib.w, h: snapW(e.h) * calib.h };
}
function calibrate(term: Terminal) {
  let d: CellDims | null | undefined = null;
  // RenderService.dimensions is a getter into the current renderer; it throws once the terminal is disposed.
  try { d = internals(term)._core?._renderService?.dimensions?.css?.cell; } catch { return; }
  if (!d || !d.width || !d.height) return;
  const e = estimate(term.options.fontSize ?? 14);
  // the cell height is snapped to whole device pixels too (floor of char height × lineHeight), [drawer fix r1]:
  // an unsnapped estimate over-counted at small sizes and the observe cap lost a row ('Cropped' by one line)
  calib = { w: d.width / snapW(e.w), h: d.height / snapW(e.h) };
}

export interface ViewHooks {
  /** current entity (null when gone) */
  entity: () => Entity | null;
  /** the pane grid the drawer can vouch for (fit.paneGridSeen) */
  paneGrid?: () => Grid | null;
  /** Esc in Peek / Leader tap */
  toWorld: () => void;
  toast: (level: ToastLevel, text: string) => void;
  confirm: (text: string) => Promise<boolean>;
  /** badge/state/outbox changed → drawer re-renders its header */
  changed: () => void;
  /** terminal_limit → drawer evicts its LRU tab */
  evict: () => void;
  /** user input reached the pane (auto-ack, unread clear) */
  typed: () => void;
  /** xterm-scope table actions (palette, font…) */
  keyAction: (action: string) => void;
  active: () => boolean;
}

/** The slice of the net store a terminal view drives. */
export interface TermNet {
  send(msg: ClientMsg): boolean;
  call(msg: ClientMsg): Promise<ReplyMsg>;
  sendBytes(id: string, bytes: Uint8Array): boolean;
  onTermData(id: string, fn: (bytes: Uint8Array, full: boolean) => void): () => void;
}

/** The latest `term.state` (or the local stand-in while promoting / after a failed open). */
export type TermInfo = Pick<TermStateMsg, 'state'> & Partial<Omit<TermStateMsg, 't' | 'id' | 'state'>>;

/** A notice post-it button. */
export interface ChipAction { label: string; fn: () => void; key?: string | string[]; primary?: boolean; title?: string }
/** A notice (strip post-it) or a flash (footer text): see `chip()`. */
export interface ChipSpec { kind?: string; text: string; sub?: string; key?: string | string[]; title?: string; ttl?: number; actions?: ChipAction[] }
interface ChipEl extends HTMLDivElement { _sig: string; _acts: ChipAction[] }

interface Hist { term: Terminal; mount: HTMLElement; open: boolean; atBottomSince: number }

/** Reply fields that arrive as `unknown` (`ReplyMsg`'s open index): numbers only. */
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const replyGrid = (r: ReplyMsg): Grid | null => { const cols = num(r.cols), rows = num(r.rows); return cols && rows ? { cols, rows } : null; };

export interface TermView {
  el: HTMLDivElement;
  /** this tab's notice post-its (drawer.ts mounts the active tab's in the footer's notice strip) */
  notices: HTMLDivElement;
  /** a short confirmation for the footer ('Copied', a Peek hint), or null */
  readonly flash: string | null;
  term: Terminal;
  readonly id: string;
  readonly state: TermInfo | null;
  readonly life: LifeView;
  readonly mode: TermMode;
  readonly outbox: number;
  readonly historyOpen: boolean;
  readonly paused: boolean;
  readonly hasWebgl: boolean;
  /** Font size the grid is actually drawn at (≤ termFontPx when the letterbox scales the child's grid down). */
  readonly fontPx: number;
  /** True when the grid does not fit even at the minimum scale and the frame pans (Cropped). */
  readonly panning: boolean;
  onCloseTab: (() => void) | null;
  onContextMenu: ((x: number, y: number) => void) | null;
  /** Mount into the DOM (first activation) and open the server viewer. */
  attach(parent: HTMLElement): void;
  /** `term.open` (also after WS reconnect / drop / demotion); always observe first. */
  open(): Promise<ReplyMsg>;
  /** term.state from the store. */
  applyState(m: TermInfo): void;
  ack(upTo: number): void;
  /** `enterAt`: the Enter keydown that opened it (arms the double-Enter guard) */
  focus(o?: { enterAt?: number }): void;
  hasFocus(): boolean;
  relayout(cap?: number): void;
  setFont(): void;
  show(on: boolean, o?: { defer?: boolean }): void;
  pause(): void;
  resume(): void;
  attachWebgl(): void;
  detachWebgl(): void;
  promote(o?: { takeover?: boolean }): Promise<ReplyMsg>;
  demote(): Promise<void>;
  toggleMode(): Promise<void>;
  openHistory(): Promise<void>;
  closeHistory(): void;
  pasteText(text: string): Promise<void>;
  pasteFromClipboard(): Promise<void>;
  copySelection(): void;
  /** Literal bytes from Leader (`;` letter, Leader Leader). */
  sendLiteral(data: string): void;
  sendOutbox(): Promise<void>;
  discardOutbox(): void;
  /** Rekey: the same view continues on the new pane id (re-open in the same mode, §8.10). */
  rekey(newId: string): void;
  /** Close the server viewer and dispose everything. */
  dispose(): void;
  grid(): Grid;
  /** Drawer-owned chips (resize policy notices). */
  chip(key: string, spec: ChipSpec | null): void;
}

export function createTermView(o: { id: string; net: TermNet; settings: Settings; platform: Platform; hooks: ViewHooks; grid: () => Grid | null; observeGrid?: () => Grid | null }): TermView {
  const { net, settings, platform, hooks } = o;
  let id = o.id;
  const fontPx = () => settings.get('termFontPx') || 14;

  // ---- DOM ----
  // ui-kit.md §5.3: the xterm sits alone in the CRT glass. Nothing is drawn over its glyphs: lifecycle banners, the
  // outbox, the Ctrl+C confirm and fit/resize hints are post-its in the drawer's notice strip (`notices`, one at a
  // time, mounted by drawer.ts in the footer rail); short confirmations ('Copied', Peek hints) are `flash` text the
  // drawer shows beside the mode word; history mode swaps the header's mode switch for a butter History plaque.
  const mount = h('div.frame');
  const notices = h('div.hq-notices', { role: 'status' });
  const histHost = h('div.hq-hist');
  const el = h('div.hq-thost', { 'data-id': id }, mount, histHost);

  const g0 = o.grid() ?? { cols: 100, rows: 30 };
  const term = new Terminal({
    cols: g0.cols, rows: g0.rows, scrollback: 0, fontFamily: MONO, fontSize: fontPx(), lineHeight: LINE_HEIGHT,
    theme: XTERM_THEME, allowProposedApi: true, macOptionIsMeta: true, cursorBlink: true, drawBoldTextInBrightColors: false,
    rightClickSelectsWord: false, minimumContrastRatio: 1, rescaleOverlappingGlyphs: true,
  });
  const u11 = new Unicode11Addon();
  term.loadAddon(u11);
  term.unicode.activeVersion = '11';
  let opened = false;
  let webgl: WebglAddon | null = null;

  // ---- state ----
  let ts: TermInfo | null = null; // latest term.state
  let life = lifeView(null);
  let lastName = '';
  let promoting: Promise<ReplyMsg> | null = null;
  let ctrlCAt = 0;
  let lastKeyAt = 0;
  let pasting = false;
  let closed = false;
  let paused = false;
  let hist: Hist | null = null;
  const chips = new Map<string, ChipEl>();

  const pipe = createInputPipe({
    id,
    sendBinary: (bytes) => net.sendBytes(id, bytes),
    call: (m) => net.call({ ...m, id }),
    onPaste: ({ sent, total, done, error }) => {
      if (error) { hooks.toast('warn', `Paste stopped (${error}); the rest is in the outbox.`); chip('paste', null); return; }
      if (total > 64 * 1024) chip('paste', done ? null : { text: `Pasting… ${Math.round((sent / total) * 100)}%` });
    },
    onChange: () => renderOutbox(),
  });

  // Claude-UI glyphs (⎿ ⏺ ⏵ …) that no installed font covers are swapped for box-drawing look-alikes (glyphs.ts).
  const glyphs = createGlyphMapper();
  const onBytes = (bytes: Uint8Array, full: boolean) => {
    if (closed) return;
    if (full) term.reset();
    term.write(glyphs(bytes, full));
  };
  let offData = net.onTermData(id, onBytes);

  // ---- notices (post-its in the strip: banner, outbox, ctrl-c, resize/fit…) and flashes (footer text) ----
  /** strip order: the first one present is the one shown (one at a time, ui-kit.md §5.3) */
  const NOTICE_RANK = ['banner', 'ctrlc', 'outbox', 'paste', 'resize', 'crop', 'fit'];
  const rank = (k: string | undefined) => { const i = NOTICE_RANK.indexOf(k ?? ''); return i < 0 ? NOTICE_RANK.length : i; };
  /** transient confirmations: footer flash text, not a post-it */
  const FLASH_KEYS = new Set(['hint', 'copied', 'promote', 'peek']);
  let flash: string | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function setFlash(text: string | null, ttl = 1600) {
    clearTimeout(flashTimer);
    flash = text;
    if (text && ttl) flashTimer = setTimeout(() => { flash = null; hooks.changed(); }, ttl);
    hooks.changed();
  }
  function chip(key: string, spec: ChipSpec | null) {
    if (FLASH_KEYS.has(key)) { if (spec) setFlash(spec.text, spec.ttl ?? 1600); else if (key !== 'peek') setFlash(null); return; }
    const old = chips.get(key);
    // [UI fix r2] the same notice re-sent at 10 Hz keeps its element (no re-created post-it / replayed entry animation)
    const sig = spec ? `${spec.kind}|${spec.text}|${spec.sub ?? ''}|${spec.key ?? ''}|${spec.title ?? ''}|${(spec.actions ?? []).map((a) => `${a.label}/${a.key ?? ''}/${a.primary ? 1 : 0}`).join(',')}` : '';
    if (old && spec && !spec.ttl && old._sig === sig) { old._acts = spec.actions ?? []; return; }
    if (old) { old.remove(); chips.delete(key); }
    if (!spec) { hooks.changed(); return; }
    // [drawer fix r1, reviewer "the butter slab with underlined web links is the loudest thing in the drawer"] a notice
    // is a LEDGER LINE on the board (ui-kit.md §5.3 notice strip): a small post-it tab, the text, a quieter
    // sub-clause, then kit buttons (key tile on the left), never underlined links.
    const c: ChipEl = Object.assign(h(`div.hq-notice${spec.kind ? `.${spec.kind}` : ''}`, { 'data-key': key, title: spec.title ?? null },
      h('span.k-note.mk', { 'aria-hidden': 'true' }),
      h('span.tx', null, spec.text, spec.sub ? h('span.sub', { text: ` · ${spec.sub}` }) : null),
      spec.key ? kitKeys(spec.key, { small: true }) : null,
      ...(spec.actions ?? []).map((a, i) => h(`button.k-btn.sm${a.primary ? '.primary' : ''}${a.key ? '' : '.nokey'}`, { type: 'button', title: a.title ?? null, onclick: (e: Event) => { e.stopPropagation(); (c._acts[i] ?? a).fn(); term.focus(); } },
        a.key ? kitKeys(a.key, { small: true }) : null, a.label))), { _sig: sig, _acts: spec.actions ?? [] });
    chips.set(key, c);
    const after = [...notices.children].find((n) => rank(n instanceof HTMLElement ? n.dataset.key : undefined) > rank(key));
    notices.insertBefore(c, after ?? null);
    if (spec.ttl) setTimeout(() => { if (chips.get(key) === c) chip(key, null); }, spec.ttl);
    hooks.changed();
  }
  function renderOutbox() {
    const n = pipe.held;
    if (n && !promoting) {
      chip('outbox', { kind: 'warn', text: `${n} character${n === 1 ? '' : 's'} waiting to send`, actions: [{ label: 'Send', fn: () => sendOutbox() }, { label: 'Discard', fn: () => pipe.discard() }] });
    } else chip('outbox', null);
    hooks.changed();
  }
  async function sendOutbox() {
    if (life.input === 'send') pipe.release();
    else if (life.input === 'promote' || ts?.state === 'released') { await promote(); }
    else hooks.toast('warn', 'This terminal cannot take input right now.');
  }

  /** Flash a Peek hint beside the footer's mode word. */
  function hint(text: string) { setFlash(text); }

  // ---- lifecycle ----
  function applyLife() {
    const e = hooks.entity();
    if (e?.name) lastName = e.name; // [UI fix r1] a closed pane keeps its name in the banner
    life = lifeView(ts, { name: e?.name ?? lastName });
    el.classList.toggle('dim', life.dim);
    const bsig = life.banner ? `${life.banner}|${life.actions.map((a) => a.action).join(',')}` : null;
    if (bsig !== bannerDismissed) bannerDismissed = null;
    chip('banner', life.banner && !bannerDismissed ? { kind: 'warn', text: life.banner, actions: life.actions.map((a) => ({ label: a.label, fn: () => bannerAction(a.action, bsig) })) } : null);
    if (life.input === 'send' && pipe.holding && !promoting) pipe.release();
    else if (life.input !== 'send' && !pipe.holding) pipe.hold();
    hooks.changed();
  }
  /** a banner the user dismissed ('Stay in Peek'); it comes back when the lifecycle says something else */
  let bannerDismissed: string | null = null;
  function bannerAction(a: string, sig: string | null) {
    if (a === 'takeover') void promote({ takeover: true });
    else if (a === 'peek') { bannerDismissed = sig; chip('banner', null); }
    else if (a === 'writer') void net.call({ t: 'term.writer', id }).then((r) => { if (!r.ok) hooks.toast('warn', `Could not take the keyboard: ${r.error}`); });
    else if (a === 'closeTab') view.onCloseTab?.();
    else if (a === 'retry') void view.open();
  }

  // ---- promotion (§4.7) ----
  async function promote({ takeover = false }: { takeover?: boolean } = {}): Promise<ReplyMsg> {
    if (promoting) return promoting;
    pipe.hold();
    const g = o.grid() ?? { cols: term.cols, rows: term.rows };
    promoting = net.call({ t: 'term.promote', id, cols: g.cols, rows: g.rows, ...(takeover ? { takeover: true } : {}) }).then((r) => {
      promoting = null;
      chip('promote', null);
      if (r.ok) {
        ts = { ...(ts ?? {}), state: 'live', mode: 'control', writer: true, cols: num(r.cols) ?? ts?.cols, rows: num(r.rows) ?? ts?.rows };
        applyLife();
        pipe.release();
        const pg = replyGrid(r);
        if (pg) setGrid(pg.cols, pg.rows);
      } else {
        hooks.toast('warn', `Could not take control: ${r.error}${pipe.held ? ' (input kept in the outbox)' : ''}`);
        renderOutbox();
      }
      return r;
    });
    chip('promote', { kind: 'peek', text: 'Taking control…', ttl: 1500 });
    return promoting;
  }

  /** Explicit demotion (Leader I in Control, background demotion): release control, re-observe. */
  async function demote(): Promise<void> {
    if (ts?.mode !== 'control') return;
    net.send({ t: 'term.close', id });
    ts = null;
    await view.open();
  }

  // ---- input routing ----
  function route(data: string, paste: boolean) {
    if (closed) return;
    switch (life.input) {
      case 'send':
        pipe.write(data, { paste });
        hooks.typed();
        return;
      case 'promote':
        if (!paste && performance.now() - lastKeyAt > 80) return; // mouse reports etc. never promote
        pipe.hold();
        pipe.write(data, { paste });
        void promote();
        hooks.typed();
        return;
      case 'outbox':
        if (pipe.write(data, { paste }) === 'overflow') hooks.toast('warn', 'Outbox full (4 KB): send or discard first.');
        return;
      default:
        setFlash('This terminal is read-only.', 1500);
    }
  }
  term.onData((d) => route(d, pasting || d.length > 4096));
  term.onBinary((d) => route(d, false));

  async function pasteText(text: string) {
    if (!text) return;
    if (text.length > PASTE_HARD_CAP) { hooks.toast('error', 'Paste is larger than 1 MB; refused.'); return; }
    const e = hooks.entity();
    const lines = text.split('\n').length;
    const limit = settings.get('pasteConfirmLines') ?? 5;
    if (e && e.kind !== 'shell' && limit > 0 && lines > limit) {
      if (!(await hooks.confirm(`Paste ${lines} lines into ${e.name}?`))) { term.focus(); return; }
    } else if (text.length > 256 * 1024) {
      if (!(await hooks.confirm(`Paste ${Math.round(text.length / 1024)} KB?`))) { term.focus(); return; }
    }
    lastKeyAt = performance.now();
    pasting = true;
    try { term.paste(text); } finally { pasting = false; }
    term.focus();
  }

  // Native paste event (Shift+Insert, Ctrl+Shift+V, Cmd+V, browser menu): capture before xterm's own handler.
  el.addEventListener('paste', (ev) => {
    if (hist && ev.target instanceof Node && histHost.contains(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    void pasteText(ev.clipboardData?.getData('text/plain') ?? '');
  }, true);

  // Copy-on-select + PRIMARY emulation; middle-click pastes the last selection.
  el.addEventListener('mouseup', () => {
    if (!term.hasSelection()) return;
    const s = term.getSelection();
    setPrimary(s);
    if (settings.get('copyOnSelect') !== false) void copyText(s).then((ok) => ok && chip('copied', { kind: 'peek', text: 'Copied', ttl: 900 }));
  });
  el.addEventListener('mousedown', (ev) => {
    if (ev.button === 1) { ev.preventDefault(); ev.stopPropagation(); const p = getPrimary(); if (p) void pasteText(p); }
  }, true);
  el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    view.onContextMenu?.(ev.clientX, ev.clientY);
  });
  // Wheel-up (when the app has not enabled mouse tracking) opens the local history overlay (§8.6).
  el.addEventListener('wheel', (ev) => {
    if (hist?.open) return;
    if (ev.deltaY < 0 && term.modes.mouseTrackingMode === 'none') {
      ev.preventDefault();
      ev.stopPropagation();
      void openHistory();
    }
  }, { capture: true, passive: false });

  // ---- keyboard (§8.2, §8.4) ----
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return !(ev.type === 'keypress' && swallowPress);
    swallowPress = false;
    // M3.5 carryover: the Enter that opened this terminal is often double-tapped (Tab, Enter, Enter): a second plain
    // Enter within ENTER_GUARD_MS of the open is swallowed instead of submitting the pane's input line
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey && performance.now() - enterOpenAt < ENTER_GUARD_MS) {
      ev.preventDefault();
      swallowPress = true;
      enterOpenAt = -1e9;
      return false;
    }
    // Leader is handled in the window capture handler (ui/keys.ts) and never reaches here.
    const tbl = resolveKey('xterm', ev, platform.mac);
    if (tbl) {
      ev.preventDefault();
      if (tbl.action === 'copy') {
        if (term.hasSelection()) void copyText(term.getSelection()).then((ok) => chip('copied', { kind: 'peek', text: ok ? 'Copied' : 'Copy failed', ttl: 900 }));
        return false;
      }
      if (tbl.action === 'pasteNative') {
        // Let the browser run its native paste → our capture 'paste' handler. Don't preventDefault.
        return false;
      }
      hooks.keyAction(tbl.action);
      return false;
    }
    if (platform.mac && ev.metaKey) return false; // Cmd chords never reach the pane
    if (life.input === 'promote') {
      const k = peekKey(ev);
      if (k === 'esc') { ev.preventDefault(); hooks.toWorld(); return false; }
      if (k === 'ctrlc') {
        ev.preventDefault();
        const e = hooks.entity();
        if (settings.get('peekCtrlCConfirm') !== false && performance.now() - ctrlCAt > 2000) {
          ctrlCAt = performance.now();
          chip('ctrlc', { kind: 'warn', text: `To interrupt ${e?.name ?? 'this pane'}, press again`, key: 'Ctrl+C', ttl: 2000 });
          return false;
        }
        ctrlCAt = 0;
        chip('ctrlc', null);
        lastKeyAt = performance.now();
        route('\x03', false);
        return false;
      }
      if (k === 'swallow') {
        ev.preventDefault();
        swallowPress = true;
        hint('Peek: type to take control · Esc to the world');
        return false;
      }
      lastKeyAt = performance.now();
      return true;
    }
    if (life.input === 'disabled') { ev.preventDefault(); return false; }
    lastKeyAt = performance.now();
    return true;
  });
  let swallowPress = false;
  let enterOpenAt = -1e9;

  // ---- history overlay (§8.6) ----
  async function openHistory(): Promise<void> {
    if (!hist) {
      const t = new Terminal({ cols: term.cols, rows: term.rows, scrollback: 5000, fontFamily: MONO, fontSize: term.options.fontSize, lineHeight: LINE_HEIGHT, theme: XTERM_THEME, disableStdin: true, cursorBlink: false, allowProposedApi: true });
      const m = h('div.frame');
      histHost.append(m);
      t.open(m);
      t.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== 'keydown') return false;
        const k = ev.key;
        if (k === 'Escape' || k === 'End') { closeHistory(); ev.preventDefault(); return false; }
        if (k === 'PageUp') { t.scrollPages(-1); ev.preventDefault(); return false; }
        if (k === 'PageDown') { t.scrollPages(1); ev.preventDefault(); return false; }
        if (k === 'ArrowUp') { t.scrollLines(-1); ev.preventDefault(); return false; }
        if (k === 'ArrowDown') { t.scrollLines(1); ev.preventDefault(); return false; }
        if (k === 'Home') { t.scrollToTop(); ev.preventDefault(); return false; }
        if ((ev.ctrlKey || ev.metaKey) && (k === 'c' || k === 'C' || k === 'Insert')) { if (t.hasSelection()) void copyText(t.getSelection()); return false; }
        if (k.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
          closeHistory();
          lastKeyAt = performance.now();
          route(k, false);
          ev.preventDefault();
          return false;
        }
        return false;
      });
      const created: Hist = { term: t, mount: m, open: false, atBottomSince: 0 };
      histHost.addEventListener('wheel', () => {
        const b = t.buffer.active;
        requestAnimationFrame(() => { if (created.open && b.viewportY >= b.baseY && created.atBottomSince && performance.now() - created.atBottomSince > 250) closeHistory(); if (b.viewportY >= b.baseY) created.atBottomSince ||= performance.now(); else created.atBottomSince = 0; });
      }, { passive: true });
      histHost.addEventListener('mouseup', () => { if (t.hasSelection()) { setPrimary(t.getSelection()); if (settings.get('copyOnSelect') !== false) void copyText(t.getSelection()); } });
      hist = created;
    }
    hist.open = true;
    hist.atBottomSince = 0;
    histHost.classList.add('show');
    hooks.changed();
    const t = hist.term;
    const my = hist;
    t.options.fontSize = term.options.fontSize;
    t.resize(term.cols, term.rows);
    hist.mount.style.width = mount.style.width;
    hist.mount.style.height = mount.style.height;
    t.reset();
    t.write('\x1b[2m… loading history …\x1b[0m');
    t.focus();
    const r = await net.call({ t: 'term.history', id, lines: 2000 });
    if (!my.open) return;
    t.reset();
    if (!r.ok) { t.write(`\x1b[31mHistory unavailable: ${r.error}\x1b[0m`); return; }
    const text = mapGlyphText(String(r.ansi ?? '')).replace(/\r?\n/g, '\r\n');
    t.write(text, () => { t.scrollToBottom(); t.scrollLines(-3); });
  }
  function closeHistory() {
    if (!hist?.open) return;
    hist.open = false;
    histHost.classList.remove('show');
    hooks.changed();
    term.focus();
  }

  // ---- layout ----
  function setGrid(cols: number, rows: number) {
    if (cols && rows && (cols !== term.cols || rows !== term.rows)) term.resize(cols, rows);
    relayout();
  }
  /**
   * [drawer fix r2, reviewer "'pane ‹' cut at the glass's right edge"] the edge tag takes the longest wording that fits
   * the glass right of the line ('pane edge · 100×50' → '100×50'), else none (the footer notice names the size anyway).
   * A cropped view says so instead of calling its edge the pane's.
   * `room` = px between the grid's right edge and the glass's.
   */
  function edgeLabel(room: number) {
    const lr = hooks.paneGrid?.() ?? hooks.entity?.()?.layoutRect;
    const crop = lr && (lr.cols > term.cols || lr.rows > term.rows);
    const opts = lr && crop ? [`cropped · pane ${lr.cols}×${lr.rows}`, 'cropped ›'] : [`pane edge · ${term.cols}×${term.rows}`, `${term.cols}×${term.rows}`];
    if (!mctx) return opts[opts.length - 1];
    mctx.font = `650 11px ${getComputedStyle(el).fontFamily || 'sans-serif'}`;
    const free = room - 10 /* margin-left */ - 4;
    const ctx = mctx;
    return opts.find((t) => ctx.measureText(t).width <= free) ?? '';
  }
  let verifyRaf = 0, showRaf = 0;
  /** `cap`: font ceiling from a failed verification (real cells wider than estimated) */
  function relayout(cap = Infinity): void {
    if (!opened || !el.isConnected || !el.classList.contains('active')) return;
    const boxW = el.clientWidth - PAD_W, boxH = el.clientHeight - PAD_H;
    if (boxW <= 0 || boxH <= 0) return;
    const want = fontPx();
    const lb = letterbox({ boxW, boxH, cols: term.cols, rows: term.rows, fontPx: Math.min(want, cap), cellW: (px) => cellSize(px).w, cellH: (px) => cellSize(px).h });
    const min = hardMinPx(want);
    if (lb.fontPx < min) { lb.fontPx = min; lb.pan = true; }
    if (term.options.fontSize !== lb.fontPx) { term.options.fontSize = lb.fontPx; hooks.changed(); }
    calibrate(term);
    const c = cellSize(lb.fontPx);
    mount.style.width = `${Math.ceil(term.cols * c.w)}px`;
    mount.style.height = `${Math.ceil(term.rows * c.h)}px`;
    el.classList.toggle('pan', lb.pan);
    // [m3 reviewer idea] a grid much narrower than the glass (a 60-col pane in a 120-col drawer) wraps at half width:
    // a faint edge line marks where the pane ends, so the wrap reads as the pane's width and not as broken output
    el.classList.toggle('edge', !lb.pan && boxW - term.cols * c.w > 6 * c.w);
    // [drawer fix r1] …and a small dimension tag at its top names it ('pane edge · 100×50'), so the empty glass reads as
    // the pane's own size (the footer notice carries the fit)
    mount.dataset.dim = edgeLabel(boxW - term.cols * c.w);
    if (hist?.open) { hist.mount.style.width = mount.style.width; hist.mount.style.height = mount.style.height; }
    // xterm snaps cells to device pixels, so the real cell at a new font size can be wider than the calibrated
    // estimate and the frame overflows (right edge cut). Re-measure after xterm has rendered; step down if needed.
    cancelAnimationFrame(verifyRaf);
    if (!lb.pan) {
      verifyRaf = requestAnimationFrame(() => {
        verifyRaf = 0;
        if (closed || !el.isConnected || !el.classList.contains('active')) return;
        const d = cellDims();
        if (!d?.width) return;
        calibrate(term);
        const fits = term.cols * d.width <= boxW + 0.5 && term.rows * d.height <= boxH + 0.5;
        if (!fits) relayout((term.options.fontSize ?? fontPx()) - 1);
        else {
          mount.style.width = `${Math.ceil(term.cols * d.width)}px`;
          mount.style.height = `${Math.ceil(term.rows * d.height)}px`;
          repaint();
        }
      });
    } else repaint();
  }
  /** xterm's disposed core has no render service; every access to its internals goes through here. */
  function cellDims() {
    if (closed) return null;
    try { return internals(term)._core?._renderService?.dimensions?.css?.cell ?? null; } catch { return null; }
  }
  // A relayout that lands before the (webgl) renderer has its atlas/canvas sized can leave a blank frame with no
  // later repaint (seen on the first open after a cold start). Force one full refresh after each settled layout,
  // and once more on the next frame in case the renderer swap was still in flight.
  let repaintRaf = 0;
  function repaint() {
    if (closed || !opened) return;
    fixGlCanvas();
    try { term.refresh(0, term.rows - 1); } catch { /* disposed mid-frame */ }
    cancelAnimationFrame(repaintRaf);
    repaintRaf = requestAnimationFrame(() => { repaintRaf = 0; if (!closed && el.isConnected) { try { term.refresh(0, term.rows - 1); } catch { /* disposed */ } } });
  }

  // [drawer fix r2, reviewer "half a row cut off at the top of the glass"] the WebGL addon sizes its canvas bitmap from
  // a device-pixel-content-box ResizeObserver, meant to absorb sub-pixel rounding. Where that box reports CSS px at a
  // devicePixelRatio > 1 (Chromium's emulated scale factor; some zoom paths) the bitmap is half its device size and GL
  // draws the grid 2× from the bottom-left: the bottom half of the rows, the top one cut through the middle. Our observer
  // runs after the addon's in each delivery and snaps a bitmap that is off by more than rounding back to the renderer's
  // device grid (an exact multiple of the cell), so only whole rows are ever drawn.
  let glGuard: ResizeObserver | null = null;
  function glCanvas(): HTMLCanvasElement | null {
    const scr = internals(term)._core?.screenElement;
    return scr ? [...scr.querySelectorAll('canvas')].find((c) => !c.className && c.style.width) ?? null : null;
  }
  function fixGlCanvas() {
    if (closed || !webgl) return false;
    const c = glCanvas();
    let dev: { width: number; height: number } | null = null;
    try { dev = internals(term)._core?._renderService?.dimensions?.device?.canvas ?? null; } catch { dev = null; }
    if (!c || !dev?.width || !dev?.height) return false;
    const off = (a: number, b: number) => Math.abs(a - b) > Math.max(2, b * 0.04);
    if (!off(c.width, dev.width) && !off(c.height, dev.height)) return false;
    c.width = dev.width; c.height = dev.height;
    try { term.refresh(0, term.rows - 1); } catch { /* disposed */ }
    return true;
  }
  function guardGlCanvas() {
    glGuard?.disconnect(); glGuard = null;
    const c = glCanvas();
    if (!c || typeof ResizeObserver === 'undefined') return;
    glGuard = new ResizeObserver(() => { fixGlCanvas(); });
    glGuard.observe(c);
  }
  // A cropped grid pans (overflow: auto); the glass scrolls in whole rows so its top edge never cuts a row in half
  // (a wheel/trackpad or the browser keeping the focused cursor in view both land on arbitrary pixels).
  el.addEventListener('scroll', () => {
    if (!el.classList.contains('pan')) { if (el.scrollTop) el.scrollTop = 0; return; }
    const d = cellDims();
    const rh = d?.height || cellSize(term.options.fontSize ?? fontPx()).h;
    if (!(rh > 0)) return;
    const max = el.scrollHeight - el.clientHeight;
    const snapped = el.scrollTop >= max - 0.5 ? Math.floor(max / rh) * rh : Math.round(el.scrollTop / rh) * rh;
    if (Math.abs(snapped - el.scrollTop) > 0.5) el.scrollTop = snapped;
  }, { passive: true });

  // ---- public ----
  const view: TermView = {
    el,
    notices,
    get flash() { return flash; },
    term,
    get id() { return id; },
    get state() { return ts; },
    get life() { return life; },
    get mode() { return ts?.mode ?? 'observe'; },
    get outbox() { return pipe.held; },
    get historyOpen() { return !!hist?.open; },
    get paused() { return paused; },
    get hasWebgl() { return !!webgl; },
    get fontPx() { return term.options.fontSize ?? fontPx(); },
    get panning() { return el.classList.contains('pan'); },
    onCloseTab: null,
    onContextMenu: null,

    attach(parent) {
      if (el.parentNode !== parent) parent.append(el);
      if (!opened) {
        el.classList.add('active');
        term.open(mount);
        opened = true;
        calibrate(term);
      }
    },
    async open() {
      // observe child grid: max(drawer, layoutRect) so Peek never crops a wide pane (§4.7, fit.observeGrid)
      const g = (o.observeGrid ?? o.grid)() ?? { cols: term.cols, rows: term.rows };
      pipe.reset(id);
      paused = false;
      const r = await net.call({ t: 'term.open', id, cols: g.cols, rows: g.rows });
      if (closed) return r;
      if (!r.ok) {
        if (r.error === 'terminal_limit') { hooks.evict(); return view.open(); }
        ts = { state: 'error', mode: 'observe', detail: r.error };
        applyLife();
        return r;
      }
      const og = replyGrid(r);
      if (og) setGrid(og.cols, og.rows);
      return r;
    },
    applyState(m) {
      const was = ts;
      ts = m;
      if (m.cols && m.rows) setGrid(m.cols, m.rows);
      if (was?.mode === 'control' && m.mode !== 'control' && pipe.held === 0) chip('peek', null);
      applyLife();
    },
    ack(upTo) { pipe.ack(upTo); },
    focus(o = {}) {
      if (o.enterAt != null && performance.now() - o.enterAt < 150) enterOpenAt = performance.now();
      if (hist?.open) hist.term.focus();
      else term.focus();
    },
    hasFocus() { return el.contains(document.activeElement); },
    relayout,
    setFont() { if (hist) hist.term.options.fontSize = term.options.fontSize; relayout(); },
    /**
     * Show / hide (tab switch). `defer`: the fit (letterbox → font size → xterm re-measure / WebGL atlas rebuild, ≈ 180 ms
     * on hqtest when the drawer width changed) runs on the next frame, after the caller focused the xterm; the key →
     * focus path stays a few ms (m2-r3 p2 'Leader L → Enter' 189.8 ms, show = 180.7 ms of it).
     */
    show(on, o = {}) {
      el.classList.toggle('active', on);
      cancelAnimationFrame(showRaf);
      if (!on) return;
      applyLife();
      if (o.defer) showRaf = requestAnimationFrame(() => { showRaf = 0; if (!closed && el.classList.contains('active')) relayout(); });
      else relayout();
    },
    pause() { if (paused || closed) return; paused = true; net.send({ t: 'term.pause', id }); },
    resume() {
      if (!paused || closed) return;
      paused = false;
      void net.call({ t: 'term.resume', id }).then((r) => { if (!r.ok && !closed) void view.open(); });
    },
    attachWebgl() {
      if (webgl || !opened) return;
      try {
        webgl = new WebglAddon();
        webgl.onContextLoss(() => { webgl?.dispose(); webgl = null; repaint(); });
        term.loadAddon(webgl);
        guardGlCanvas();
        repaint();
      } catch (e) {
        console.warn('[term] webgl addon failed, DOM renderer', e);
        webgl = null;
      }
    },
    detachWebgl() { if (webgl) { webgl.dispose(); webgl = null; glGuard?.disconnect(); glGuard = null; } },
    promote,
    demote,
    async toggleMode() { if (ts?.mode === 'control' && ts.writer) await demote(); else await promote(); },
    openHistory,
    closeHistory,
    pasteText,
    async pasteFromClipboard() {
      const t = await readClipboard();
      if (t == null) hooks.toast('warn', `Clipboard read refused — use ${platform.mac ? 'Cmd+V' : 'Shift+Insert'} to paste.`);
      else await pasteText(t);
    },
    copySelection() { if (term.hasSelection()) void copyText(term.getSelection()); },
    sendLiteral(data) { lastKeyAt = performance.now(); route(data, false); },
    sendOutbox,
    discardOutbox() { pipe.discard(); },
    rekey(newId) {
      const wasControl = ts?.mode === 'control';
      offData();
      id = newId;
      el.dataset.id = newId;
      offData = net.onTermData(id, onBytes);
      ts = null;
      void view.open().then(() => { if (wasControl && pipe.held) void promote(); });
    },
    dispose() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(verifyRaf);
      cancelAnimationFrame(repaintRaf);
      clearTimeout(flashTimer);
      net.send({ t: 'term.close', id });
      offData();
      webgl?.dispose(); glGuard?.disconnect(); glGuard = null;
      hist?.term.dispose();
      term.dispose();
      el.remove();
    },
    grid() { return { cols: term.cols, rows: term.rows }; },
    chip(key, spec) { if (!!spec !== chips.has(key) || (spec && chips.get(key)?.firstChild?.textContent !== spec.text)) chip(key, spec); },
  };
  return view;
}

/**
 * Best grid for a drawer body box at the user's font size (the settled-fit measure).
 */
export function drawerGrid(box: HTMLElement, px: number): Grid | null {
  const c = cellSize(px);
  const w = box.clientWidth - PAD_W, hh = box.clientHeight - PAD_H;
  if (w <= 0 || hh <= 0) return null;
  return gridFor(w, hh, c.w, c.h);
}
