/**
 * Terminal drawer (§8 table, §8.2.1, §8.4–8.6; look: ui-kit.md §5.3): a board sheet with a brass drawer pull, ≤ 6
 * LRU tabs on a recessed rail (+ the blocked counter readout), a header (shield breadcrumb, cwd + context gauge,
 * Peek/Control switch, icon toolbar with a ⋯ menu), the xterm in a CRT bezel, and a footer rail (mode lamp, the
 * one legend, the notice strip, in-drawer tickets). Also the settled-fit path, collapse rail and fullscreen.
 * States: closed · docked (focused/unfocused) · collapsed · fullscreen.
 * Owner: UI.
 */
import { h, ICON, setText, cls } from '../dom.ts';
import { lamp, lampState, porthole, shield, unread, gauge, modeSwitch, plaque, readout, keys, legend, iconButton, type Lamp, type Unread } from '../kit/index.ts';
import type { Entity, ToastLevel } from '../../../../shared/protocol.ts';
import type { Store } from '../../net/store.ts';
import type { Settings } from '../../core/settings.ts';
import type { Bus } from '../../core/bus.ts';
import type { Platform } from '../platform.ts';
import type { Rekey } from '../rekey.ts';
import { UI } from '../../../../shared/palette.ts';
import { injectDrawerStyles } from './styles.ts';
import { createTermView, drawerGrid, type TermNet, type TermView } from './view.ts';
import { createTabs, shortTabLabels } from './tabs.ts';
import { createDrawerMenu, type MenuItem } from './menu.ts';
import { createFit, observeGrid, minFontPx, hardMinPx, wholePaneFits, paneGridSeen, EXPLICIT_REASONS, type FitReason, type Grid } from './fit.ts';
import { copyText } from './clipboard.ts';
import { tildePath, oldestBlocked } from '../roster/model.ts';
import { blockedQueue } from '../serveModel.ts';
import { PCT_MIN, PCT_MAX } from '../layout.ts';

/**
 * [drawer fix r2, reviewer "tab names cut to 'fl…' with a wide gap before the lamp"] a tab is exactly as wide as its
 * parts: pad 8 · portrait 22 · gap 8 · name · gap 8 · lamp 12 · pad 12 (the active tab adds gap 8 + its × 16; an unread
 * bulb gap 8 + 8). An inactive tab's × takes no room (on hover it replaces the lamp in place). The strip keeps the full
 * names while their natural widths fit; only then it switches to short distinct labels and scrolls past that.
 */
const TAB_FIXED = 8 + 22 + 8 + 8 + 12 + 12, TAB_ACTIVE_X = 8 + 16, TAB_UNREAD = 8 + 8, TAB_GAP = 4;
const tabCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
let HIDDEN_DEMOTE_MS = 30_000; // §8.5: hidden control tabs demote to observe (p2.ts shortens it)
const PCT_KEY = 'hq.drawerPct';
/** Keyboard Lock API (Chromium): keeps browser chords (Ctrl+W, Esc…) for the terminal while fullscreen. Not in lib.dom. */
interface KeyboardLock { lock?(): Promise<void>; unlock?(): void }
const keyboardLock = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

export interface Drawer {
  el: HTMLElement;
  toasts: HTMLElement;
  readonly state: DrawerState;
  readonly pct: number;
  readonly activeId: string | null;
  readonly lastId: string | null;
  readonly tabIds: string[];
  readonly focused: boolean;
  /** Step timings (ms) of the last open(): state · make (new xterm) · attach (term.open) · show (fit) · focus. */
  readonly lastOpen: OpenTimings | null;
  readonly lastGrow: { from: Box; to: Box } | null;
  view(id: string): TermView | null;
  active(): TermView | null;
  open(id: string, o?: { focus?: boolean; fromRect?: RectLike }): TermView | null;
  tick(): void;
  render(): void;
  /** Enter / Leader in the world: focus the last active tab (expanding a collapsed drawer). false = no tab. */
  focusLast(): boolean;
  close(id?: string | null): void;
  closeOthers(): void;
  step(dir: number): void;
  nextBlocked(): void;
  oldestBlocked(): Entity | null | undefined;
  /** Away recap while typing (§6.4.5): pulse the always-visible blocked counter. */
  pulseBlocked(): void;
  readonly hovered: boolean;
  collapse(): void;
  expand(): void;
  toggleCollapse(): void;
  toggleFullscreen(): void;
  /** Leave xterm focus; the drawer stays docked-unfocused. */
  blur(): void;
  copyRecent(): Promise<void>;
  font(delta: number): void;
  fitNow(reason?: FitReason): void;
  /** Fit the pane to the glass (the notice's button / ⋯ menu): take control (Peek → Control), then resize to the drawer grid. */
  fitToGlass(): Promise<void>;
  /** [UI fix r2] a pane HQ just spawned: fit it to the drawer the first time it is open and live here. */
  fitWhenOpened(id: string): void;
  invalidate(reason: FitReason): void;
  /** test hook (p2.ts): hidden-control demotion delay */
  setHiddenDemoteMs(ms: number): void;
  setWidth(px: number): void;
  /** Set by ui/index.ts; the drawer itself never reads it (see DrawerDeps.unreadOf). */
  unreadOf?: (id: string) => number;
}

export type DrawerState = 'closed' | 'docked' | 'collapsed' | 'fullscreen';

/** What the drawer asks of the surrounding UI (ui/index.ts wires these). */
export interface DrawerHooks {
  toWorld: () => void;
  toast: (level: ToastLevel, text: string, o?: { drawer?: boolean }) => void;
  confirm: (t: string) => Promise<boolean>;
  keyAction: (a: string) => void;
  layout: () => void;
  opened: (id: string) => void;
  typed: (id: string) => void;
  signOff?: (id: string, o?: { via?: string }) => unknown;
  /** performance.now() of the Enter keydown that opened the terminal (arms the double-Enter guard) */
  enterAt?: () => number | undefined;
}

export interface DrawerDeps {
  store: Store;
  net: TermNet;
  settings: Settings;
  platform: Platform;
  rekey: Rekey;
  bus: Bus;
  /** one display label per agent (names.ts: namesakes → 'claude · 2') */
  label?: (e: Entity) => string;
  /**
   * Unread count per pane id. NOTE (ported as found): the ui wires this onto the returned drawer (`drawer.unreadOf = ...`)
   * but the drawer reads it from its deps, so tab unread bulbs never show. Kept so behaviour is unchanged.
   */
  unreadOf?: (id: string) => number;
  hooks: DrawerHooks;
}

/** A rect handed over by the dive: DOMRect-like `{left, top, width, height}` or `{x, y, w, h}`. */
export interface RectLike { left?: number; top?: number; width?: number; height?: number; x?: number; y?: number; w?: number; h?: number }
/** Step timings (ms) of the last `open()`. */
export interface OpenTimings { isNew: boolean; state: number; make: number; attach: number; show: number; focus: number; total: number }
interface Box { x: number; y: number; w: number; h: number }

/** An entity as the drawer shows it: live, or the last known one flagged `gone`. */
type Shown = Entity & { gone?: true };
/** Drawer-owned bookkeeping per view (kept off the view itself). */
interface ViewExtra {
  obsAsk?: (Grid & { at: number; prev: Grid | null }) | null;
  openDone?: number | string | null;
  hireFit?: boolean;
  hireFits?: number;
  hireFitAt?: number;
  resizedNoted?: boolean;
  refitKey?: string | null;
  acked?: boolean;
}
interface TabEl { b: HTMLButtonElement; pt: HTMLSpanElement; nm: HTMLSpanElement; lp: Lamp; un: Unread; key: string }

export function createDrawer(d: DrawerDeps) {
  const { store, net, settings, platform, hooks } = d;
  const tabs = createTabs({ max: store.limits?.viewersPerClient ?? 6 });
  const views = new Map<string, TermView>();
  const extras = new WeakMap<TermView, ViewExtra>();
  const extra = (v: TermView): ViewExtra => { let x = extras.get(v); if (!x) extras.set(v, (x = {})); return x; };
  const hiddenSince = new Map<string, number>();
  let state: DrawerState = 'closed';
  let lastId: string | null = null; // "last terminal" (survives closing the drawer; cleared when that tab closes)
  let pct = 0.5;
  try { const v = parseFloat(localStorage.getItem(PCT_KEY) ?? ''); if (v >= PCT_MIN && v <= PCT_MAX) pct = v; } catch { /* ignore */ }
  let prevBlocked = 0;
  let activeSince = 0;
  /**
   * [UI fix r2, playtest "a hired shell opens at 120×43, drawn at 10 px"] panes HQ itself just created (hire dialog):
   * the first time one is live in the drawer it is taken into Control and fitted to the drawer (term.resize: the pane
   * is HQ's, not one the user laid out in herdr), so it reads at the user's font size. id → deadline (ms).
   */
  const fitOnOpen = new Map<string, number>();

  // ---- DOM (ui-kit.md §5.3) ----
  injectDrawerStyles();
  const tabStrip = h('div.hq-tabs', { role: 'tablist', 'aria-label': 'Terminals' });
  // blocked counter: readout "▲ n BLOCKED" + [Leader][U]; counts blocked agents OTHER than the active tab, hidden at 0
  const counter = readout('', { color: UI.onBoard.blocked, pitch: 2, lamp: 'blocked', dot: 0.46, core: UI.fit.alarmWord });
  const blockedBtn = h('button.hq-bc', { type: 'button', title: 'Next blocked terminal', onclick: () => api.nextBlocked() }, counter.el, keys(['Leader', 'U'], { small: true }));
  // [drawer fix r1, reviewer "at 1280 the first tab scrolls off with no cue; 'tink' clipped under the readout"] the
  // strip scrolls between two brass end-stops that show how many tabs are past each edge (click = scroll there), and
  // the counter sits in its own bay behind a groove, so no tab ever runs under it
  const moreL = h('button.hq-tabmore.l', { type: 'button', hidden: true, onclick: () => scrollTabs(-1) }, h('span', { html: ICON.chevronLeft }), h('b'));
  const moreR = h('button.hq-tabmore.r', { type: 'button', hidden: true, onclick: () => scrollTabs(1) }, h('b'), h('span', { html: ICON.chevron }));
  const tabWrap = h('div.hq-tabwrap', null, moreL, tabStrip, moreR);
  const tabBar = h('div.k-tabs.hq-tabrail', null, tabWrap, blockedBtn);
  /**
   * [drawer fix r3, reviewer "a sliver 'e ●' of the previous tab shows between the '‹1' end-stop and flint"] the strip
   * never shows part of a tab: past an overflow it pages in WHOLE tabs. `tabFirst` is the first tab in view; the run
   * after it takes what fits (room for an end-stop on each clipped side), every tab outside that run is hidden, and
   * the strip is scrolled so the first one starts right after the left end-stop. The end-stops count the hidden tabs.
   */
  let tabFirst = 0, tabOver = false, tabBrowsing = false; // browsing: an end-stop / the wheel paged away from the active tab
  const stopW = () => (moreL.hidden ? 38 : moreL.offsetWidth + 8);
  /** `anchor`: index of a tab that must end up in view (the active one when it changed; an end-stop's target) */
  function tabOverflow(anchor = -1) {
    const kids = [...tabStrip.children].filter((k): k is HTMLElement => k instanceof HTMLElement);
    const n = kids.length, w = tabStrip.clientWidth;
    if (anchor < 0 && !tabBrowsing) anchor = kids.findIndex((k) => k.classList.contains('on'));
    const x0 = kids[0]?.offsetLeft ?? 0;
    const L = (k: number) => kids[k].offsetLeft - x0, R = (k: number) => L(k) + kids[k].offsetWidth;
    let f = 0, l = n - 1;
    tabOver = n > 1 && w > 0 && R(n - 1) > w + 1;
    if (tabOver) {
      const sw = stopW();
      /** the last whole tab in view when `f` is the first */
      const lastFrom = (f: number) => {
        const lo = L(f) - (f > 0 ? sw : 0);
        let l = f;
        while (l + 1 < n && R(l + 1) - lo + (l + 2 < n ? sw : 0) <= w) l++;
        return l;
      };
      f = Math.max(0, Math.min(tabFirst, n - 1));
      if (anchor >= 0 && anchor < f) f = anchor;
      while (anchor >= 0 && f < anchor && lastFrom(f) < anchor) f++;
      while (f > 0 && lastFrom(f - 1) === n - 1) f--; // no empty rail at the right end
      l = lastFrom(f);
      cls(tabStrip, 'over', true);
      tabStrip.scrollLeft = f > 0 ? L(f) - sw : 0;
    } else { cls(tabStrip, 'over', false); tabStrip.scrollLeft = 0; }
    tabFirst = f;
    kids.forEach((k, i) => cls(k, 'off', tabOver && (i < f || i > l)));
    const lc = tabOver ? f : 0, rc = tabOver ? n - 1 - l : 0;
    moreL.hidden = !lc; moreR.hidden = !rc;
    if (moreL.lastChild) setText(moreL.lastChild, String(lc));
    if (moreR.firstChild) setText(moreR.firstChild, String(rc));
    moreL.title = `${lc} more tab${lc === 1 ? '' : 's'} · Leader ,`; moreR.title = `${rc} more tab${rc === 1 ? '' : 's'} · Leader .`;
    moreL.setAttribute('aria-label', moreL.title); moreR.setAttribute('aria-label', moreR.title);
  }
  /** an end-stop / the wheel: page one whole tab toward that edge */
  function scrollTabs(dir: number) {
    if (!tabOver) return;
    tabBrowsing = true;
    const kids = [...tabStrip.children];
    if (dir < 0) { tabFirst = Math.max(0, tabFirst - 1); tabOverflow(tabFirst); }
    else { const next = kids.findIndex((k, i) => i > tabFirst && k.classList.contains('off')); if (next >= 0) tabOverflow(next); }
  }
  let wheelAcc = 0;
  tabStrip.addEventListener('wheel', (ev) => {
    const dv = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    if (!tabOver || !dv) return;
    ev.preventDefault();
    wheelAcc += ev.deltaMode ? Math.sign(dv) * 60 : dv;
    while (Math.abs(wheelAcc) >= 60) { scrollTabs(Math.sign(wheelAcc)); wheelAcc -= Math.sign(wheelAcc) * 60; }
  }, { passive: false });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { tabBrowsing = false; tabOverflow(); scheduleRender(); }).observe(tabStrip);
  const crumb = h('div.k-crumb');
  const cwdText = h('span.path');
  const herdrMark = h('span.herdr', { text: '◆ in herdr', title: 'This pane is focused in your herdr TUI' });
  const ctxGauge = gauge(0, { suffix: 'context' });
  const cwd = h('div.k-cwd', null, cwdText, herdrMark, ctxGauge);
  const modeSw = modeSwitch({ left: 'Peek', right: 'Control', title: 'Peek ↔ Control', onChange: () => { const v = active(); if (v) void v.toggleMode().then(() => v.focus()); } });
  const histPlaque = plaque('History', { tone: 'butter', small: true });
  const roWord = h('span.k-mode', null, lamp('unknown', { size: 'sm', label: '' }), 'Read-only');
  const MORE = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r=".9"/><circle cx="10" cy="10" r=".9"/><circle cx="15" cy="10" r=".9"/></svg>';
  const histBtn = iconButton(ICON.history, { title: 'History', key: ['Leader', '['], onClick: () => active()?.openHistory() });
  const moreBtn = iconButton(MORE, { title: 'More', onClick: (ev) => { if (!(ev.currentTarget instanceof HTMLElement)) return; const r = ev.currentTarget.getBoundingClientRect(); moreMenu(r.right, r.bottom + 6); } });
  moreBtn.classList.add('more');
  moreBtn.setAttribute('aria-haspopup', 'menu');
  const tools = h('div.tools', null,
    iconButton(ICON.copy, { title: 'Copy recent output', key: ['Leader', 'C'], onClick: () => api.copyRecent() }),
    histBtn,
    iconButton(ICON.expand, { title: 'Fullscreen', key: ['Leader', 'Z'], onClick: () => api.toggleFullscreen() }),
    moreBtn,
    iconButton(ICON.chevron, { title: 'Collapse drawer', key: 'Shift+Enter', onClick: () => api.collapse() }));
  const header = h('div.hq-dh', null, h('div.who', null, crumb, cwd), h('span.k-sp'), modeSw, histPlaque, roWord, tools);
  const body = h('div.hq-tbody.k-crt');
  const emptyMsg = h('div.hq-empty-drawer', { text: 'No terminal open' });
  body.append(emptyMsg);
  // footer rail: mode lamp + word · sub-line · the one legend | the notice strip (one post-it) · in-drawer tickets
  const modeLamp = lamp('peek', { size: 'sm', label: '' });
  const modeWord = h('b');
  const modeSub = h('span.sub');
  const legendSlot = h('span.lg');
  const status = h('div.status', null, h('span.k-mode', null, modeLamp, modeWord), modeSub, legendSlot);
  const noticeSlot = h('div.k-strip.notice'); // the active tab's notices (view.notices)
  const toasts = h('div.hq-toasts', { 'aria-live': 'polite' });
  const footer = h('div.hq-df', null, status, noticeSlot, h('span.k-sp'), toasts);
  /**
   * [drawer fix r3, reviewers "a footer ticket covers '[Ctrl `][I] Fit to drawer'" (r2, r3)] the rail's one line ticket
   * has its own slot at the rail's end, in the flow, so it can never sit on a button: while it shows, the notice
   * drops its words and keeps its post-it + button (the title keeps the words), the mode keeps lamp + word. If the
   * rail still has no room for the ticket's headline (a narrow drawer), the ticket stacks above the rail instead,
   * over the glass's bottom edge.
   */
  function layoutTicket() {
    const has = toasts.childElementCount > 0;
    const was = footer.className;
    cls(footer, 'ticketed', has);
    cls(footer, 'stacked', false);
    if (has) {
      const what = toasts.lastElementChild?.querySelector<HTMLElement>('.what') ?? null;
      const tight = footer.scrollWidth > footer.clientWidth + 1 || !!(what && what.scrollWidth > what.clientWidth + 1);
      cls(footer, 'stacked', tight);
    }
    return was !== footer.className;
  }
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => layoutTicket()).observe(toasts, { childList: true });
  // collapsed rail [drawer fix r1, reviewer "a 36 px strip with a tiny avatar, a triangle and a bare '3' is cryptic"]:
  // a labelled walnut spine: expand pull + its keys, the sign 'TERMINALS · n' (click = expand), one porthole per tab
  // (lamp; the active one on a clay notch), and at the foot the blocked counter readout + [U] (click = next blocked)
  const railCount = readout('0', { color: UI.onBoard.blocked, pitch: 1.6, lamp: 'blocked', dot: 0.46, core: UI.fit.alarmWord });
  const railBlocked = h('button.bc', { type: 'button', onclick: () => api.nextBlocked() }, railCount.el, keys(['Leader', 'U'], { small: true }));
  const railSign = h('button.sign.k-sign', { type: 'button', title: 'Expand drawer (Shift+Enter)', onclick: () => api.expand() });
  const railList = h('div.list', { role: 'tablist', 'aria-label': 'Terminals', 'aria-orientation': 'vertical' });
  const railTop = h('button.pull', { type: 'button', title: 'Expand drawer (Shift+Enter)', 'aria-label': 'Expand drawer', onclick: () => api.expand() }, h('span.ic', { html: ICON.chevronLeft }), keys('Shift+Enter', { small: true }));
  const rail = h('div.hq-rail', null, railTop, railSign, railList, h('span.k-sp'), railBlocked);
  const grip = h('div.grip', { title: 'Drag to resize · double-click resets' });
  grip.addEventListener('dblclick', () => { pct = 0.5; try { localStorage.setItem(PCT_KEY, String(pct)); } catch { /* ignore */ } hooks.layout(); fit.invalidate('drag'); });
  const el = h('section.hq-drawer.k-drawer', { 'aria-label': 'Terminal drawer' }, grip, tabBar, header, body, footer, rail);

  /** ⋯ menu: the rarer pane actions (ui-kit.md §7.3), as the shared context menu. */
  function moreMenu(x: number, y: number) {
    const v = active();
    const e = v ? entity(v.id) : null;
    const cos = settings.get('copyOnSelect') !== false;
    const items: MenuItem[] = [
      ...(e && e.status === 'done' ? [{ label: 'Mark seen in herdr', fn: () => focusInHerdr(true) }] : []),
      { label: 'Focus in herdr', disabled: !e, fn: () => focusInHerdr(false) },
      ...(v && v.mode === 'control' ? [{ label: 'Release control (Peek)', keys: ['Leader', 'I'], fn: () => v.toggleMode() }] : []),
      { label: 'Copy on select', note: cos ? 'on' : 'off', fn: () => settings.set({ copyOnSelect: !cos }) },
      ...(v && (v.mode === 'control' || v.life?.input === 'promote') ? [{ label: state === 'fullscreen' ? 'Fit pane to screen' : 'Fit pane to drawer', fn: () => api.fitToGlass() }] : []),
      ...(store.hello?.allowMutations || store.hello?.demo ? [{ label: 'Close pane…', note: 'kills its process', destructive: true, disabled: !e, fn: () => closePaneConfirm() }] : []),
      { label: 'All keys', keys: ['Leader', '?'], fn: () => hooks.keyAction('keys') },
    ];
    menu.show(x, y, items, { title: menuTitle(v), span: 'pane', right: true });
  }
  const menuTitle = (v: TermView | null) => (v ? tabLabel(shown(v.id) ?? entity(v.id), v.id) : 'Terminal');
  /** the drawer's menus: a paper slip with key tiles (terminal/menu.ts), fixed over the drawer */
  const menu = createDrawerMenu({ host: el, refocus: () => active()?.focus() });

  // ---- fit (§8.5) ----
  const fit = createFit({
    measure: () => drawerGrid(body, settings.get('termFontPx') || 14),
    onSettled: (cols, rows, reason) => {
      const v = active();
      if (!v) return;
      v.relayout();
      const ts = v.state;
      if (!ts || ts.state !== 'live' && ts.state !== 'released') return;
      if (ts.mode === 'observe') { const og = asked(v, obsGrid(v.id, { cols, rows })); if (!og) return; net.send({ t: 'term.fit', id: v.id, cols: og.cols, rows: og.rows }); return; }
      const e = entity(v.id);
      const lr = e?.layoutRect;
      const atLayout = lr && ts.cols === lr.cols && ts.rows === lr.rows;
      const explicit = EXPLICIT_REASONS.some((x) => x === reason);
      if (ts.writer && (cols !== ts.cols || rows !== ts.rows) && (!atLayout && explicit || reason === 'fitButton')) {
        void net.call({ t: 'term.resize', id: v.id, cols, rows }).then((r) => { if (r.ok) hooks.toast('info', `Resized your herdr pane to ${cols}×${rows}`, { drawer: true }); });
      }
    },
  });

  const entity = (id: string): Entity | null => store.entities.get(d.rekey.resolve(id)) ?? null;
  const dGrid = () => drawerGrid(body, settings.get('termFontPx') || 14);
  /** Observe grid this viewer asks for: max(drawer grid, pane layoutRect), capped at what fits at the readable floor (§4.7). */
  const obsGrid = (id: string, g: Grid | null = dGrid()): Grid | null => {
    const px = settings.get('termFontPx') || 14, lr = entity(id)?.layoutRect;
    const floor = drawerGrid(body, hardMinPx(px));
    // [drawer fix r3] fullscreen shows the whole pane whenever it fits the glass at the hard floor: exactly its grid
    if (state === 'fullscreen' && lr && wholePaneFits(lr, floor)) return { cols: lr.cols, rows: lr.rows };
    return observeGrid(g, lr, drawerGrid(body, minFontPx(px)));
  };
  /** remember the observe grid we asked the hub for (term.open / term.fit): paneGrid() compares the child against it */
  const asked = (v: TermView | null, g: Grid | null): Grid | null => {
    if (!v || !g) return g;
    const p = extra(v).obsAsk;
    if (!p || p.cols !== g.cols || p.rows !== g.rows) extra(v).obsAsk = { cols: g.cols, rows: g.rows, at: performance.now(), prev: p ? { cols: p.cols, rows: p.rows } : null };
    return g;
  };
  /** the pane's grid as far as this view can vouch (fit.paneGridSeen): drives 'cropped' in the notice and the edge tag */
  const paneGrid = (v: TermView) => paneGridSeen(entity(v.id)?.layoutRect, v.state, extra(v).obsAsk, performance.now());
  const active = () => (tabs.active ? views.get(tabs.active) ?? null : null);

  // ---- views ----
  function makeView(id: string) {
    const v: TermView = createTermView({
      id,
      net,
      settings,
      platform,
      grid: dGrid,
      observeGrid: () => asked(v, obsGrid(v.id)),
      hooks: {
        entity: () => entity(v.id),
        paneGrid: () => paneGrid(v),
        toWorld: () => hooks.toWorld(),
        toast: (lvl, t) => hooks.toast(lvl, t, { drawer: true }),
        confirm: hooks.confirm,
        changed: () => scheduleRender(),
        evict: () => { const x = tabs.lru(); if (x && x !== v.id) api.close(x); },
        typed: () => hooks.typed(v.id),
        keyAction: (a) => hooks.keyAction(a),
        active: () => tabs.active === v.id,
      },
    });
    v.onCloseTab = () => api.close(v.id);
    // [drawer fix r2, reviewer "the right-click menu is a stock cream card with bare items"] the kit slip, every line
    // with its keys (the xterm's own copy/paste chords, then the Leader chords)
    v.onContextMenu = (x, y) => menu.show(x, y, [
      { label: 'Copy', keys: platform.mac ? 'Mod+C' : 'Ctrl+Shift+C', disabled: !v.term.hasSelection(), fn: () => v.copySelection() },
      { label: 'Paste', keys: platform.mac ? 'Mod+V' : 'Ctrl+Shift+V', fn: () => v.pasteFromClipboard() },
      { label: 'Copy recent output', keys: ['Leader', 'C'], fn: () => api.copyRecent() },
      { label: v.mode === 'control' ? 'Release control (Peek)' : 'Take control', keys: ['Leader', 'I'], fn: () => v.toggleMode() },
      { label: 'Scrollback history', keys: ['Leader', '['], fn: () => v.openHistory() },
    ], { title: menuTitle(v), span: v.mode === 'control' ? 'control' : 'peek' });
    views.set(id, v);
    return v;
  }

  function applyWebgl(list: string[]) {
    for (const [id, v] of views) {
      if (list.includes(id)) { if (id === tabs.active) v.attachWebgl(); } else v.detachWebgl();
    }
  }

  /**
   * Open (or reuse) the terminal for a pane and focus it immediately (< 150 ms target; frames are written as they
   * arrive).
   */
  function open(id: string, o: { focus?: boolean; fromRect?: RectLike } = {}): TermView | null {
    id = d.rekey.resolve(id);
    if (!store.entities.has(id) && !views.has(id)) { hooks.toast('warn', 'That pane is gone.'); return null; }
    // step timings of the key → focus path (p2 prints them when the gate is slow: which step stalled, m2-r3)
    const T = [performance.now()];
    const wasShut = state === 'closed' || state === 'collapsed';
    if (wasShut) setState('docked'); // first: the body box must have its size
    if (wasShut && o.fromRect) growFrom(o.fromRect); // P3 (M3.5): the dive hands the monitor's on-screen rect
    T.push(performance.now());
    let v = views.get(id);
    const isNew = !v;
    if (!v) v = makeView(id);
    T.push(performance.now());
    const prev = tabs.active;
    const { evict } = tabs.activate(id);
    for (const x of evict) disposeView(x);
    v.attach(body);
    T.push(performance.now());
    for (const [vid, vv] of views) {
      if (vid === id) continue;
      if (vv.el.classList.contains('active')) { vv.show(false); vv.pause(); hiddenSince.set(vid, performance.now()); }
    }
    v.show(true, { defer: o.focus !== false }); // the fit runs next frame, after the focus below (m2-r3)
    if (noticeSlot.firstChild !== v.notices) noticeSlot.replaceChildren(v.notices);
    hiddenSince.delete(id);
    T.push(performance.now());
    if (o.focus !== false) v.focus({ enterAt: hooks.enterAt?.() }); // focus first (< 150 ms target); WebGL context creation is deferred; enterAt arms the double-Enter guard (M3.5)
    T.push(performance.now());
    const r1 = (x: number) => Math.round(x * 10) / 10;
    lastOpen = { isNew, state: r1(T[1] - T[0]), make: r1(T[2] - T[1]), attach: r1(T[3] - T[2]), show: r1(T[4] - T[3]), focus: r1(T[5] - T[4]), total: r1(T[5] - T[0]) };
    requestAnimationFrame(() => { if (tabs.active === id) applyWebgl(tabs.mru.slice(0, 2)); });
    if (isNew) void v.open();
    else v.resume();
    lastId = id;
    activeSince = performance.now();
    // [UI fix r3, playtest "an open drawer signs a finishing agent off by itself"] autoAckOnOpen means OPENING a done
    // terminal: remember the done state it was opened on; an agent that finishes while you watch is left for you to
    // sign off (the G high-five / S / ✓ moment)
    { const e0 = entity(id); extra(v).openDone = e0 && e0.status === 'done' && !e0.ack ? (e0.stateSeq ?? 'done') : null; }
    if (prev !== id) fit.invalidate(isNew ? 'open' : 'tab');
    hooks.opened(id);
    render();
    return v;
  }

  /**
   * FLIP the drawer out of a screen rect (the monitor PLY's dive ended on): transform-only, ≤ 240 ms, never delays the
   * focus (the xterm is already live underneath). Rect: DOMRect-like {left,top,width,height} or {x,y,w,h}.
   */
  function growFrom(r: RectLike) {
    try {
      const x = r.left ?? r.x, y = r.top ?? r.y, w = r.width ?? r.w, hh = r.height ?? r.h;
      if (x === undefined || y === undefined || w === undefined || hh === undefined || ![x, y, w, hh].every(Number.isFinite) || w < 4 || hh < 4 || !el.animate) return;
      if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) return;
      const sx = w / b.width, sy = hh / b.height;
      lastGrow = { from: { x, y, w, h: hh }, to: { x: b.left, y: b.top, w: b.width, h: b.height } };
      el.animate([
        { transformOrigin: '0 0', transform: `translate(${x - b.left}px, ${y - b.top}px) scale(${sx}, ${sy})`, opacity: 0.55, borderRadius: '6px' },
        { transformOrigin: '0 0', transform: 'none', opacity: 1, borderRadius: '0' },
      ], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    } catch { /* cosmetic */ }
  }
  let lastGrow: { from: Box; to: Box } | null = null;

  /** step timings of the last open() (ms) */
  let lastOpen: OpenTimings | null = null;
  function disposeView(id: string) {
    const v = views.get(id);
    if (!v) return;
    if (v.notices.parentNode === noticeSlot) noticeSlot.replaceChildren();
    v.dispose();
    views.delete(id);
    hiddenSince.delete(id);
  }

  function setState(s: DrawerState) {
    if (state === s) return;
    const wasFs = state === 'fullscreen';
    state = s;
    cls(el, 'open', s !== 'closed');
    cls(el, 'collapsed', s === 'collapsed');
    cls(el, 'fullscreen', s === 'fullscreen');
    if (wasFs && s !== 'fullscreen' && document.fullscreenElement) { try { void document.exitFullscreen(); } catch { /* ignore */ } }
    d.bus.emit('drawer', { open: s === 'docked' || s === 'fullscreen', fullscreen: s === 'fullscreen', state: s });
    hooks.layout();
    fit.invalidate(s === 'fullscreen' || wasFs ? 'fullscreen' : 'collapse');
    render();
  }

  async function focusInHerdr(markSeen: boolean) {
    const v = active();
    if (!v) return;
    const r = await net.call({ t: 'herdr.focus', id: v.id });
    if (!r.ok) hooks.toast('warn', `herdr focus failed: ${r.error}`, { drawer: true });
    else hooks.toast('info', markSeen ? 'Marked seen in herdr (your herdr focus moved).' : 'Focused in herdr (your herdr TUI moved).', { drawer: true });
  }

  async function closePaneConfirm() {
    const v = active();
    const e = v && entity(v.id);
    if (!e) return;
    if (!store.hello?.allowMutations && !store.hello?.demo) { /* BE: hello.allowMutations is authoritative (a named session may be the default socket) */ hooks.toast('warn', 'Closing panes needs allowMutations (off in the default session).', { drawer: true }); return; }
    if (!(await hooks.confirm(`Close pane ${e.name}? This kills its process in herdr.`))) { v.focus(); return; }
    // [UI fix r1, playtest "a dead w1:p5 tab"] the user closed it: its tab goes too (on `gone`, or now if that already came)
    userClosed.set(e.id, e.name);
    const r = await net.call({ t: 'pane.close', id: e.id });
    if (!r.ok) { userClosed.delete(e.id); hooks.toast('warn', `Close failed: ${r.error}`, { drawer: true }); return; }
    if (views.has(e.id) && !store.entities.has(e.id)) closeClosed(e.id);
  }
  /** Pane ids the user closed from this drawer (→ their name, for the toast). */
  const userClosed = new Map<string, string>();
  function closeClosed(id: string) {
    const name = userClosed.get(id) ?? known.get(id)?.name ?? id;
    userClosed.delete(id);
    if (views.has(id)) api.close(id);
    hooks.toast('info', `Closed pane ${name}.`, { drawer: true });
  }
  /**
   * Last known entity per open tab (name, kind, status, workspace, tab, cwd): a pane that went away keeps its name and
   * portrait on the tab and in the header instead of its raw id and a Clawd for a shell (playtest).
   */
  const known = new Map<string, Entity>();
  /** The live entity, else the last known one flagged `gone`. */
  const shown = (id: string): Shown | null => { const e = entity(id); if (e) { known.set(id, e); return e; } const k = known.get(id); return k ? { ...k, gone: true } : null; };

  // ---- resize drag ----
  grip.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    el.classList.add('dragging');
    const move = (e: PointerEvent) => {
      pct = Math.min(PCT_MAX, Math.max(PCT_MIN, (innerWidth - e.clientX) / innerWidth));
      hooks.layout();
      active()?.relayout();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      el.classList.remove('dragging');
      try { localStorage.setItem(PCT_KEY, String(pct)); } catch { /* ignore */ }
      fit.invalidate('drag');
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    grip.addEventListener('pointercancel', up, { once: true });
  });
  el.addEventListener('focusin', () => { cls(el, 'focused', true); scheduleRender(); });
  el.addEventListener('focusout', () => setTimeout(() => { cls(el, 'focused', el.contains(document.activeElement)); scheduleRender(); }, 0));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { active()?.relayout(); fit.invalidate('window'); }).observe(body);
  addEventListener('resize', () => fit.invalidate('window'));
  const dprWatch = () => {
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { fit.invalidate('dpr'); dprWatch(); }, { once: true });
  };
  dprWatch();

  // ---- store wiring ----
  store.on('term.state', (m) => {
    const v = views.get(m.id);
    if (!v) return;
    v.applyState(m);
    // observe sizer whose child grid differs from the grid we want → settle once (→ term.fit)
    if (m.id === tabs.active) refitObserve(v);
    scheduleRender();
  });
  store.on('term.ack', (m) => views.get(m.id)?.ack(m.upTo));
  store.on('conn', (c) => {
    if (c.state === 'open' && c.connects > 1) for (const v of views.values()) { if (v.id === tabs.active) void v.open(); else { void v.open().then(() => v.pause()); } }
    else if (c.state === 'closed') for (const v of views.values()) v.applyState({ ...(v.state ?? {}), state: 'reconnecting' });
  });
  store.on('herdr', (hs) => { if (!hs.connected) for (const v of views.values()) v.applyState({ ...(v.state ?? {}), state: 'offline' }); });
  store.on('gone', (m) => {
    if (m.reason === 'rekeyed' && m.newId) return; // rekey.ts migrates
    const v = views.get(m.id);
    if (v && userClosed.has(m.id)) { closeClosed(m.id); return; }
    if (v) v.applyState({ ...(v.state ?? {}), state: 'gone', detail: m.reason });
  });
  d.rekey.onRekey((o, n) => {
    const v = views.get(o);
    if (!v) { if (lastId === o) lastId = n; return; }
    views.delete(o);
    views.set(n, v);
    const kn = known.get(o);
    if (kn !== undefined) { known.set(n, kn); known.delete(o); }
    const uc = userClosed.get(o);
    if (uc !== undefined) { userClosed.set(n, uc); userClosed.delete(o); }
    tabs.rekey(o, n);
    const hs = hiddenSince.get(o);
    if (hs !== undefined) { hiddenSince.set(n, hs); hiddenSince.delete(o); }
    if (lastId === o) lastId = n;
    v.rekey(n);
    render();
  });

  // ---- render (header, tabs, rail, footer) ≤ 10 Hz + on change ----
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => { renderQueued = false; render(); });
  }

  const tabEls = new Map<string, TabEl>();
  let lastScrolledTab: HTMLElement | null = null;
  function tabEl(id: string): TabEl {
    let t = tabEls.get(id);
    if (!t) {
      const pt = h('span.pt');
      const nm = h('span.nm');
      const lp = lamp('idle', { size: 'sm' });
      const un = unread(0);
      const x = h('span.x', { html: ICON.close, role: 'button', 'aria-label': 'Close tab', title: 'Close tab' });
      const b = h('button.k-tab', { type: 'button', role: 'tab', 'data-id': id }, pt, nm, lp, un, x);
      b.addEventListener('mousedown', (ev) => { if (ev.button === 1) { ev.preventDefault(); api.close(b.dataset.id); } });
      b.addEventListener('click', (ev) => {
        if (ev.target instanceof Element && ev.target.closest('.x')) api.close(b.dataset.id);
        else open(b.dataset.id ?? id);
      });
      t = { b, pt, nm, lp, un, key: '' };
      tabEls.set(id, t);
    }
    return t;
  }
  /** lamp state for a tab / rail entry (a closed pane shows an unlit lamp) */
  const lampOf = (e: Entity | null | undefined) => (e ? lampState(e.kind === 'shell' ? 'shell' : e.status, e) : 'idle');
  const CTX_MAX = 200_000; // = roster/view.ts
  function flashCounter() { blockedBtn.classList.remove('flash'); void blockedBtn.offsetWidth; blockedBtn.classList.add('flash'); }

  /** natural width of the strip with full labels (sum of each tab's parts + the 4 px gaps) */
  function fullTabsWidth(order: string[], full: string[]) {
    if (!tabCtx) return 0;
    tabCtx.font = `650 13px ${getComputedStyle(tabStrip).fontFamily || 'sans-serif'}`;
    let w = TAB_GAP * (order.length - 1);
    order.forEach((id, i) => {
      w += TAB_FIXED + Math.ceil(tabCtx.measureText(full[i]).width) + 2;
      if (id === tabs.active) w += TAB_ACTIVE_X;
      else if ((d.unreadOf?.(id) ?? 0) > 0) w += TAB_UNREAD;
    });
    return w;
  }
  /** one display label per agent (names.ts via hooks.label: namesakes → 'claude · 2'), else its name */
  const tabLabel = (e0: Entity | null | undefined, id: string): string => (e0 ? d.label?.(e0) || e0.name : null) ?? id;
  const crumbKey = { v: '' };
  function render() {
    // tabs (display order)
    const order = tabs.order;
    for (const [id, t] of tabEls) if (!order.includes(id)) { t.b.remove(); tabEls.delete(id); }
    const nodes: HTMLElement[] = [];
    // [UI fix r2, reviewer code] a crowded strip (full names past its width) shows portrait + a short DISTINCT label
    // (tabs.ts shortTabLabels: 'clau·2' ≠ 'clau'), each tab ≥ its min width; past that the strip scrolls (never 'c')
    const full = order.map((id) => tabLabel(shown(id), id));
    const room = tabStrip.clientWidth || (el.clientWidth - 200);
    const compact = order.length > 1 && fullTabsWidth(order, full) > room;
    const names = compact ? shortTabLabels(full) : full;
    cls(tabStrip, 'compact', compact);
    order.forEach((id, i) => {
      const t = tabEl(id);
      t.b.dataset.id = id;
      const e0 = shown(id), e = e0?.gone ? null : e0;
      const v = views.get(id);
      const st = lampOf(e);
      const key = `${names[i]}|${full[i]}|${st}|${e0?.kind}|${e0?.workspace?.colorIndex}|${v?.state?.state}`;
      if (key !== t.key) {
        t.key = key;
        t.pt.replaceChildren(porthole(e0 ? { ...e0, status: e ? e0.status : 'idle' } : { kind: 'claude', status: 'idle' }, { size: 'xs' }));
        setText(t.nm, names[i]);
        const word = e ? (st === 'shell' ? 'prompt' : st === 'busy' ? 'running' : st) : 'closed';
        t.b.title = `${full[i]} · ${word}${e0?.workspace?.label ? ` · ${e0.workspace.label}` : ''}`;
        t.b.setAttribute('aria-label', `${full[i]}, ${word}`);
        t.lp.set(st, e ? undefined : 'Closed');
        cls(t.b, 'gone', !e);
      }
      const on = id === tabs.active;
      cls(t.b, 'on', on);
      t.b.setAttribute('aria-selected', String(on));
      t.b.tabIndex = on ? 0 : -1;
      t.un.set(on ? 0 : d.unreadOf?.(id) ?? 0);
      nodes.push(t.b);
    });
    if (nodes.length !== tabStrip.children.length || nodes.some((n, i) => tabStrip.children[i] !== n)) tabStrip.replaceChildren(...nodes);
    const act = tabs.active ? tabEls.get(tabs.active)?.b : null;
    if (act && act !== lastScrolledTab) { lastScrolledTab = act; tabBrowsing = false; }
    tabOverflow();

    // header: shield ws › tab › name, then cwd · ◆ in herdr · context gauge
    const v = active();
    const e = v ? entity(v.id) : null;
    const k = v ? (e ?? shown(v.id)) : null;
    emptyMsg.hidden = !!v;
    header.hidden = !v;
    const ck = k && v ? `${k.workspace?.colorIndex}|${k.workspace?.label}|${k.tab?.label}|${tabLabel(k, v.id)}|${!e}` : '';
    if (ck !== crumbKey.v) {
      crumbKey.v = ck;
      if (k && v) {
        crumb.replaceChildren(shield(k.workspace?.colorIndex ?? 0), h('span.dim', { text: k.workspace?.label ?? '?' }), h('span.sep', { text: '›' }),
          h('span.dim', { text: k.tab?.label ?? '?' }), h('span.sep', { text: '›' }), h('span.nm', { text: tabLabel(k, v.id) }), ...(e ? [] : [h('span.dim.closed', { text: ' (closed)' })]));
      } else crumb.replaceChildren();
    }
    setText(cwdText, k?.cwd ? tildePath(k.cwd) : '');
    const g = v?.grid();
    const wantPx = settings.get('termFontPx') || 14, drawnPx = v?.fontPx ?? wantPx;
    cwd.title = g ? `${g.cols}×${g.rows} at ${drawnPx}px${drawnPx !== wantPx ? ` (your size is ${wantPx}px; scaled to fit the pane's grid${v?.panning ? ', cropped: scroll to pan' : ''})` : ''} · font: Leader + / − / 0` : '';
    herdrMark.hidden = !e?.focused;
    const ctxTokens = e && e.kind !== 'shell' && e.contextTokens ? e.contextTokens : 0;
    ctxGauge.hidden = !ctxTokens;
    if (ctxTokens) { ctxGauge.set((Math.min(1, ctxTokens / CTX_MAX)) * 100); ctxGauge.title = `context ${Math.round(ctxTokens / 1000)}k tokens`; }

    // mode: the switch (Peek/Control), or the History plaque, or Read-only
    const life = v?.life;
    const badge = life?.badge ?? 'none';
    const inHist = !!v?.historyOpen;
    modeSw.hidden = inHist || !(badge === 'peek' || badge === 'control');
    modeSw.set(badge === 'control' ? 'right' : 'left');
    modeSw.title = badge === 'peek' ? 'Peek: watching without resizing your pane. Type or Leader I to take control.' : 'Control: your keys go to the pane. Leader I to release.';
    histPlaque.hidden = !inHist;
    roWord.hidden = inHist || badge !== 'readonly';
    cls(histBtn, 'on', inHist);

    // blocked counter (other tabs only; always visible when > 0, fullscreen included)
    const blocked = [...store.entities.values()].filter((x) => x.status === 'blocked');
    const others = blocked.filter((x) => x.id !== tabs.active).length;
    blockedBtn.hidden = others === 0;
    // a crowded rail keeps the lamp + number (the word is in the aria-label / tooltip), so tabs keep their room
    if (others) counter.set(order.length * 150 > el.clientWidth - 260 ? String(others) : `${others} BLOCKED`, `${others} blocked`);
    blockedBtn.title = `${others} blocked in other tabs · next blocked terminal (Leader U)`;
    blockedBtn.setAttribute('aria-label', `${others} blocked: next blocked terminal`);
    if (blocked.length > prevBlocked) flashCounter();
    prevBlocked = blocked.length;

    // footer: mode lamp + word · sub-line (or a flash) · the one legend
    const focusedNow = el.classList.contains('focused');
    const control = badge === 'control';
    const tsState = v?.state?.state;
    const [ml, mw] = !v ? ['idle', ''] : control ? ['seen', 'Control'] : badge === 'peek' ? ['peek', 'Peek']
      : badge === 'readonly' ? ['unknown', 'Read-only'] : tsState === 'gone' ? ['idle', 'Closed'] : tsState === 'offline' ? ['idle', 'Offline'] : ['idle', 'Connecting…'];
    modeLamp.set(ml, '');
    setText(modeWord, mw);
    const flash = v?.flash;
    const sub = flash ? `· ${flash}` : inHist ? '' : !focusedNow && v ? '' : control ? '· keys go to the pane' : badge === 'peek' ? '· type to take control' : '';
    const lk = `${!!v}|${inHist}|${control}|${focusedNow}|${sub}`;
    if (lk !== legendKey) {
      legendKey = lk;
      modeSub.replaceChildren(!flash && !focusedNow && v && !inHist ? h('span.k-legend', null, h('span.h', null, keys('Enter', { small: true }), 'type here')) : document.createTextNode(sub));
      cls(modeSub, 'flash', !!flash);
      legendSlot.replaceChildren(!v ? '' : inHist
        ? legend([{ key: 'End', label: 'back to live' }, { key: ['PageUp', '/', 'PageDown'], label: 'scroll' }], { small: true })
        : legend([control ? { key: 'I', label: 'peek' } : null, { key: 'Z', label: 'full' }, { key: '[', label: 'history' }], { leader: true, small: true }));
    }
    cls(footer, 'noticed', !!v?.notices.firstChild);
    if (toasts.childElementCount) layoutTicket();

    // collapsed rail (updated only while collapsed)
    if (state === 'collapsed') {
      setText(railSign, `Terminals · ${order.length}`);
      railList.replaceChildren(...order.map((id) => {
        const x0 = shown(id), x = x0?.gone ? null : x0;
        const nm = tabLabel(x0, id);
        return h(`button.pt${id === tabs.active ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(id === tabs.active), title: `${nm} · ${x ? lampOf(x) : 'closed'}`, 'aria-label': `${nm}, ${x ? lampOf(x) : 'closed'}`, onclick: () => open(id) },
          porthole(x0 ? { ...x0, status: x ? x0.status : 'idle' } : { kind: 'claude' }, { size: 'xs' }), lamp(lampOf(x), { size: 'sm', label: '' }));
      }));
      railBlocked.hidden = blocked.length === 0;
      if (blocked.length) { railCount.set(String(blocked.length), `${blocked.length} blocked`); railBlocked.title = `${blocked.length} blocked · next blocked terminal (Leader U)`; railBlocked.setAttribute('aria-label', railBlocked.title); }
    }
  }
  let legendKey = '';

  /**
   * Observe sizer whose child grid differs from the observe grid we want (drawer changed, pane layoutRect changed,
   * or back from control at the drawer grid) → settle once (→ term.fit). Keyed so a hub that keeps a different grid
   * (rate limit, clamps) cannot make us loop.
   */
  function refitObserve(v: TermView) {
    const ts = v.state;
    if (!ts || ts.state !== 'live' || ts.mode !== 'observe' || !ts.sizer || fit.pending) return;
    const g = obsGrid(v.id);
    if (!g || (g.cols === ts.cols && g.rows === ts.rows)) { extra(v).refitKey = null; return; }
    const k = `${g.cols}x${g.rows}|${ts.cols}x${ts.rows}`;
    if (extra(v).refitKey === k) return;
    extra(v).refitKey = k;
    fit.invalidate('open');
  }

  /**
   * §8.5 "Your real herdr pane": say before/after when control resizes the user's pane; offer the fit.
   * [drawer fix r1, reviewer "fullscreen draws a 100×50 pane at 10 px in 40 % of the glass"] whenever the pane's grid
   * does not fill the glass at the user's font (scaled down, cropped, or a narrow pane in fullscreen), the notice says
   * so in one ledger line and offers the fit as a real button with its key: Leader I (taking control sizes the pane to
   * the drawer when its layout does not fit) or, when it does fit, an explicit "Fit pane to screen". In fullscreen that
   * button is the drawer's one clay primary.
   */
  function resizeNotices(v: TermView) {
    const e = entity(v.id);
    const ts = v.state;
    const lr = e?.layoutRect;
    const want = settings.get('termFontPx') || 14;
    const g = drawerGrid(body, want);
    if (!e || !ts || !g || !lr) { v.chip('resize', null); v.chip('fit', null); return; }
    // cols/rows are absent on a local stand-in state; NaN keeps every comparison below false, as `undefined` did
    const tc = ts.cols ?? NaN, tr = ts.rows ?? NaN;
    const full = state === 'fullscreen';
    const where = full ? 'screen' : 'drawer';
    const fits = lr.cols <= g.cols && lr.rows <= g.rows;
    const canPromote = v.life?.badge === 'peek' && v.life?.input === 'promote';
    if (ts.mode !== 'control') {
      v.chip('fit', null);
      refitObserve(v);
      const live = ts.state === 'live';
      const pg = paneGrid(v) ?? lr; // (the demo's observe child is the pane's whole screen at its own grid)
      const crop = live && (tc < pg.cols || tr < pg.rows);
      const scaled = live && v.fontPx < want;
      // a narrow pane in fullscreen: ≥ 25 % of the glass empty beside the edge line
      const narrow = live && full && fits && (pg.cols < g.cols * 0.75 || pg.rows < g.rows * 0.75);
      if (!crop && !scaled && !narrow && !(e.focused && !fits)) { v.chip('resize', null); extra(v).resizedNoted = false; return; }
      const text = crop ? `Cropped · pane is ${pg.cols}×${pg.rows}` : scaled ? `Pane ${pg.cols}×${pg.rows} at ${v.fontPx} px` : `Pane ${pg.cols}×${pg.rows}`;
      const sub = e.focused && !fits ? 'typing resizes it' : scaled ? `yours is ${want} px` : narrow ? `the ${where} fits ${g.cols}×${g.rows}` : '';
      const fitAct = !canPromote ? null : fits
        ? { label: `Fit pane to ${where}`, primary: full, title: `Take control and resize your herdr pane to ${g.cols}×${g.rows}`, fn: () => api.fitToGlass() }
        : { label: `Fit to ${where}`, key: ['Leader', 'I'], primary: full, title: `Take control: resizes your herdr pane to ${g.cols}×${g.rows} (${want} px)`, fn: () => api.fitToGlass() };
      // one action in the docked footer (it shares 48 px with the mode word and the tickets), two in fullscreen
      const acts = [
        ...(fitAct ? [fitAct] : !full && (crop || scaled) ? [{ label: 'Fullscreen', key: ['Leader', 'Z'], fn: () => api.toggleFullscreen() }] : []),
        ...(full && e.focused && !fits ? [{ label: 'Stay in Peek', key: 'Esc', fn: () => hooks.toWorld() }] : []),
      ];
      const cropT = crop ? `Cropped: the pane is ${pg.cols}×${pg.rows}, this view ${ts.cols}×${ts.rows}` : '';
      const scaleT = scaled ? `Drawn at ${v.fontPx} px so the pane's ${ts.cols}×${ts.rows} grid fits (your size is ${want} px; Leader + / − / 0)` : '';
      const resizeT = e.focused && !fits ? `Typing takes control and resizes your herdr pane to ${g.cols}×${g.rows} (the ${where}'s grid)` : '';
      v.chip('crop', null);
      v.chip('resize', { kind: crop || (e.focused && !fits) ? 'warn' : 'peek', text, sub, title: [cropT, scaleT, resizeT].filter(Boolean).join('\n'), actions: acts });
      extra(v).resizedNoted = false;
      return;
    }
    v.chip('resize', null);
    v.chip('crop', null);
    const atLayout = ts.cols === lr.cols && ts.rows === lr.rows;
    if (!atLayout && e.focused && !extra(v).resizedNoted) { extra(v).resizedNoted = true; hooks.toast('info', `Resized your herdr pane to ${ts.cols}×${ts.rows}`, { drawer: true }); }
    const off = Math.abs(g.cols - tc) / tc > 0.1 || Math.abs(g.rows - tr) / tr > 0.1;
    v.chip('fit', ts.writer && atLayout && off ? { kind: 'peek', text: `Pane ${ts.cols}×${ts.rows}`, sub: `the ${where} fits ${g.cols}×${g.rows}`, title: `Resizes your herdr pane to ${g.cols}×${g.rows}`,
      actions: [{ label: `Fit pane to ${where}`, primary: full, fn: () => api.fitNow('fitButton') }] } : null);
  }

  /** A hired pane's first live moment in the drawer: Control + fit to the drawer grid (once; ≤ 30 s after the hire). */
  function hiredFit(v: TermView, now: number) {
    const until = fitOnOpen.get(v.id);
    if (until == null) return;
    if (now > until) { fitOnOpen.delete(v.id); return; }
    const ts = v.state;
    if (!ts || ts.state !== 'live' || extra(v).hireFit) return;
    if (ts.mode === 'observe') {
      extra(v).hireFit = true;
      void v.promote().then((r) => { extra(v).hireFit = false; if (!r?.ok) fitOnOpen.delete(v.id); });
      return;
    }
    if (ts.mode === 'control' && ts.writer && !fit.pending) {
      // done once it draws at the user's font (a fit measured before the cell calibration may still scale: ≤ 3 passes)
      const want = settings.get('termFontPx') || 14;
      const x = extra(v);
      x.hireFits = (x.hireFits ?? 0);
      if (v.fontPx >= want || x.hireFits >= 3) { fitOnOpen.delete(v.id); return; }
      if (now - (x.hireFitAt ?? 0) < 600) return;
      const g = dGrid();
      if (!g) return;
      // pass k shrinks the estimate by k cells: xterm snaps cells to device pixels, so the real cell at the user's
      // size can be a hair wider than the calibrated estimate (the frame then scales to font − 1)
      const k = x.hireFits++;
      x.hireFitAt = now;
      const cols = Math.max(10, g.cols - k), rows = Math.max(4, g.rows - (k > 1 ? 1 : 0));
      if (cols === ts.cols && rows === ts.rows) return;
      void net.call({ t: 'term.resize', id: v.id, cols, rows }).then((r) => { if (r?.ok && k === 0) hooks.toast('info', `Fitted the new shell to the drawer (${cols}×${rows})`, { drawer: true }); });
    }
  }

  // background demotion + auto-ack + unread clear (runs from ui.update at ≤ 10 Hz)
  function tick() {
    const now = performance.now();
    for (const [id, since] of hiddenSince) {
      const v = views.get(id);
      if (v && v.mode === 'control' && now - since > HIDDEN_DEMOTE_MS) { hiddenSince.set(id, Infinity); void v.demote().then(() => v.pause()); }
    }
    const v = active();
    if (v && state !== 'closed' && state !== 'collapsed') { hiredFit(v, now); resizeNotices(v); }
    if (v && state !== 'closed' && state !== 'collapsed' && settings.get('autoAckOnOpen') !== false && now - activeSince > 2000 && !document.hidden) {
      const e = entity(v.id);
      if (e && e.status === 'done' && !e.ack && !extra(v).acked && extra(v).openDone != null && (e.stateSeq ?? 'done') === extra(v).openDone) {
        extra(v).acked = true;
        // through the UI's sign-off (bus 'signoff': BRN's thank-you + walk back, AUD's stamp, the toast), not a bare send
        if (hooks.signOff) void hooks.signOff(e.id, { via: 'open' });
        else net.send({ t: 'done.ack', id: e.id, stateSeq: e.stateSeq ?? null });
      }
      if (e && e.status !== 'done') { extra(v).acked = false; extra(v).openDone = null; }
    }
  }

  const api: Drawer = {
    el,
    toasts,
    get state() { return state; },
    get pct() { return pct; },
    get activeId() { return tabs.active; },
    get lastId() { return lastId && (views.has(lastId) ? lastId : null); },
    get tabIds() { return [...tabs.order]; },
    get focused() { return el.contains(document.activeElement); },
    get lastOpen() { return lastOpen; },
    get lastGrow() { return lastGrow; },
    view: (id) => views.get(id) ?? null,
    active,
    open,
    tick,
    render,
    focusLast() {
      const id = api.lastId;
      if (!id) return false;
      open(id);
      return true;
    },
    close(id = tabs.active) {
      if (!id) return;
      known.delete(id);
      const next = tabs.remove(id);
      disposeView(id);
      if (lastId === id) lastId = next;
      if (next) open(next, { focus: api.focused || true });
      else { setState('closed'); hooks.toWorld(); }
      render();
    },
    closeOthers() { for (const id of [...tabs.order]) if (id !== tabs.active) api.close(id); },
    step(dir) { const id = tabs.step(dir); if (id) open(id); },
    nextBlocked() {
      const list = blockedQueue(store.entities.values()); // the shared needs-you order (= inbox, roster)
      if (!list.length) { hooks.toast('info', 'Nobody is blocked.', { drawer: state !== 'closed' }); return; }
      const cur = list.findIndex((e) => e.id === tabs.active);
      open(list[(cur + 1) % list.length].id);
    },
    oldestBlocked: () => oldestBlocked(store.entities.values()),
    pulseBlocked() { flashCounter(); },
    get hovered() { return el.matches(':hover'); },
    collapse() { if (state !== 'closed') { setState('collapsed'); hooks.toWorld(); } },
    expand() { if (state === 'collapsed') { setState('docked'); active()?.focus(); } },
    toggleCollapse() { if (state === 'collapsed') api.expand(); else if (state === 'docked' || state === 'fullscreen') api.collapse(); else api.focusLast(); },
    toggleFullscreen() {
      if (!tabs.active) return;
      if (state === 'fullscreen') { setState('docked'); try { keyboardLock()?.unlock?.(); } catch { /* ignore */ } }
      else {
        setState('fullscreen');
        try { document.documentElement.requestFullscreen?.().then(() => keyboardLock()?.lock?.().catch?.(() => {})).catch(() => {}); } catch { /* ignore */ }
      }
      active()?.focus();
    },
    blur() { const ae = document.activeElement; if (api.focused && ae instanceof HTMLElement) ae.blur(); },
    async copyRecent() {
      const v = active();
      if (!v) return;
      const r = await net.call({ t: 'term.copyRecent', id: v.id, lines: 2000 });
      if (!r.ok) { hooks.toast('warn', `Copy recent failed: ${r.error}`, { drawer: true }); return; }
      const ok = await copyText(String(r.text ?? ''));
      hooks.toast(ok ? 'info' : 'warn', ok ? `Copied ${String(r.text ?? '').split('\n').length} lines` : 'Clipboard write refused', { drawer: true });
      v.focus();
    },
    font(delta) {
      const cur = settings.get('termFontPx') || 14;
      const next = delta === 0 ? 14 : Math.min(28, Math.max(9, cur + delta));
      if (next !== cur) settings.set({ termFontPx: next });
      for (const v of views.values()) v.setFont();
      fit.invalidate('font');
      render();
    },
    fitNow(reason: FitReason = 'fitButton') { fit.invalidate(reason); fit.flush(); },
    async fitToGlass() {
      const v = active();
      if (!v) return;
      if (v.mode !== 'control') { const r = await v.promote(); if (r && r.ok === false) return; }
      api.fitNow('fitButton');
      v.focus();
    },
    fitWhenOpened(id) { fitOnOpen.set(d.rekey.resolve(id), performance.now() + 30_000); },
    invalidate: (reason) => fit.invalidate(reason),
    setHiddenDemoteMs(ms) { HIDDEN_DEMOTE_MS = ms; },
    setWidth(px) { el.style.setProperty('--drawer-w', `${px}px`); },
  };
  settings.onChange((c) => { if ('termFontPx' in c) { for (const v of views.values()) v.setFont(); fit.invalidate('font'); } if ('copyOnSelect' in c) render(); });
  render();
  return api;
}
