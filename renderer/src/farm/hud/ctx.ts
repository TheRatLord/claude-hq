/**
 * Shared plumbing for the HUD modules: the late-bound bindings, the one-panel-at-a-time modal manager, local
 * (browser-only) HUD preferences, and small DOM helpers.
 */
import type { FarmerView, HelperView, PlotView, ValleyState } from '../model/types.ts';
import type { FrameInfo, SfxName } from '../scene/context.ts';
import type { HudDeps } from './port.ts';
import type { HudBindings } from './hud.ts';
import { h } from '../../ui/dom.ts';
import { shortName } from './format.ts';
import { readJson, writeJson } from '../storage.ts';

export { h };

export type PanelId = 'mailbox' | 'map' | 'roster' | 'card' | 'noticeboard' | 'stats' | 'almanac' | 'collection' | 'shop' | 'friends' | 'pause' | 'drawer' | 'welcome' | 'pet';

export interface Panel {
  id: PanelId;
  el: HTMLElement;
  /** called after the element is shown; `arg` is whatever open() received */
  onOpen?(arg: unknown): void;
  onClose?(): void;
  /** ~4 Hz while open (also in hidden tabs) */
  refresh?(): void;
  /** every rendered frame while open */
  frame?(f: FrameInfo): void;
  /** keydown while open; return true when handled (the manager prevents default) */
  key?(e: KeyboardEvent): boolean;
  /** the drawer keeps the valley dimmed differently and owns Escape itself */
  ownsEscape?: boolean;
  /** does not dim the valley (side cards) */
  light?: boolean;
}

export interface Panels {
  register(p: Panel): void;
  open(id: PanelId, arg?: unknown): void;
  close(): void;
  toggle(id: PanelId, arg?: unknown): void;
  current(): Panel | null;
  isOpen(id?: PanelId): boolean;
  /** true while a modal is open or being opened (pointer-lock loss is expected then) */
  readonly modal: boolean;
}

export interface ToastSpec {
  text: string;
  sub?: string;
  icon?: string;
  level?: 'info' | 'good' | 'warn' | 'error' | 'ask';
  /** farmer id: click opens the terminal */
  id?: string;
  ms?: number;
  /** rate-limit key (defaults to text) */
  key?: string;
  /** coalescing group: a toast of the same group already on screen is updated in place (×n) instead of stacking;
   *  defaults to the key's first `|` segment (e.g. `commit|…`, `ans|…`), else the text */
  group?: string;
}

/** Browser-local HUD preferences (not server settings). Every access is guarded: storage may be unavailable. */
export interface Prefs {
  minimap: boolean;
  toasts: boolean;
  hinted: boolean;
  /** the needs-you strip is folded down to its count chip */
  compactStrip: boolean;
  /** terminal drawer height as a fraction of the viewport (0 = default) */
  drawerH: number;
  /** opt-in desktop notifications (needs you / finished) while the window is in the background (notify.ts) */
  notify: boolean;
  /** the open needs-you card tucks itself away to the (pulsing) chip after a while without attention (needs.ts) */
  needsDoze: boolean;
}
const PREFS_KEY = 'valley.hud.prefs';
export function loadPrefs(): Prefs {
  const def: Prefs = { minimap: true, toasts: true, hinted: false, compactStrip: false, drawerH: 0, notify: false, needsDoze: true };
  return { ...def, ...(readJson(PREFS_KEY) as Partial<Prefs> | null) };
}
export function savePrefs(p: Prefs): void { writeJson(PREFS_KEY, p); }

export interface HudCtx {
  d: HudDeps;
  /** the HUD layer (children of #hud) */
  layer: HTMLElement;
  /** set by bind() */
  b: HudBindings | null;
  state(): ValleyState | null;
  farmer(id: string): FarmerView | undefined;
  helper(id: string): HelperView | undefined;
  plot(id: string): PlotView | undefined;
  /** display name for any pane id */
  nameOf(id: string): string;
  now(): number;
  sfx(n: SfxName): void;
  openTerminal(id: string, o?: { enterAt?: number }): void;
  travel(id: string): void;
  answer(id: string, key: string, label?: string): Promise<boolean>;
  toast(t: ToastSpec): void;
  panels: Panels;
  prefs: Prefs;
  savePrefs(): void;
  /** ask every open view to refresh soon */
  kick(): void;
}

export function createPanels(ctx: () => HudCtx, host: HTMLElement, backdrop: HTMLElement, changed: () => void = () => {}): Panels {
  const all = new Map<PanelId, Panel>();
  let cur: Panel | null = null;
  let modal = false;
  let lastFocus: Element | null = null;
  const show = (p: Panel, on: boolean) => {
    p.el.classList.toggle('open', on);
    p.el.setAttribute('aria-hidden', String(!on));
  };
  const self: Panels = {
    register(p) {
      all.set(p.id, p);
      p.el.classList.add('vh-modal');
      p.el.setAttribute('aria-hidden', 'true');
      if (!p.el.hasAttribute('role')) p.el.setAttribute('role', 'dialog');
      if (!p.el.hasAttribute('tabindex')) p.el.tabIndex = -1;
      host.append(p.el);
    },
    open(id, arg) {
      const p = all.get(id);
      if (!p) return;
      const c = ctx();
      if (cur && cur !== p) { const old = cur; cur = null; show(old, false); old.onClose?.(); }
      const fresh = !modal;
      modal = true;
      if (fresh) { lastFocus = document.activeElement; c.b?.setModal(true); c.sfx('ui-open'); } else if (cur !== p) c.sfx('page');
      cur = p;
      show(p, true);
      backdrop.classList.toggle('open', !p.ownsEscape);
      backdrop.classList.toggle('light', !!p.light);
      p.onOpen?.(arg);
      if (!p.el.contains(document.activeElement)) {
        const auto = p.el.querySelector<HTMLElement>('[data-autofocus]');
        (auto ?? p.el).focus({ preventScroll: true });
      }
      changed();
    },
    close() {
      if (!cur) return;
      const p = cur;
      cur = null;
      show(p, false);
      backdrop.classList.remove('open');
      p.onClose?.();
      const c = ctx();
      c.sfx('ui-close');
      modal = false;
      if (lastFocus instanceof HTMLElement && lastFocus.isConnected && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur?.();
      lastFocus = null;
      c.b?.setModal(false);
      changed();
    },
    toggle(id, arg) { if (cur?.id === id) self.close(); else self.open(id, arg); },
    current: () => cur,
    isOpen: (id) => (id ? cur?.id === id : !!cur),
    get modal() { return modal; },
  };
  return self;
}

/** Keyed list reconciliation: keeps DOM nodes (and their focus/hover) for items that stay. */
export function syncList<T>(parent: HTMLElement, items: readonly T[], key: (t: T) => string, make: (t: T) => HTMLElement, update: (el: HTMLElement, t: T) => void): void {
  const old = new Map<string, HTMLElement>();
  for (const c of [...parent.children]) if (c instanceof HTMLElement && c.dataset.key) old.set(c.dataset.key, c);
  let prev: Element | null = null;
  const keep = new Set<string>();
  for (const it of items) {
    const k = key(it);
    keep.add(k);
    let el = old.get(k);
    if (!el) { el = make(it); el.dataset.key = k; }
    update(el, it);
    const want: Element | null = prev ? prev.nextElementSibling : parent.firstElementChild;
    if (want !== el) parent.insertBefore(el, want);
    prev = el;
  }
  for (const [k, el] of old) if (!keep.has(k)) el.remove();
}

/** Is the event target somewhere the user is typing (so letter hotkeys must not fire)? */
export function typingIn(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'submit'].includes(type);
  }
  return false;
}

export function displayName(s: ValleyState | null, id: string): string {
  const f = s?.farmers.get(id) ?? s?.helpers.get(id);
  return f ? shortName(f) : id;
}

/** A standard wooden-framed panel skeleton: frame > plaque title + close + body. */
export function framePanel(id: PanelId, title: string, iconSvg: string, cls = ''): { el: HTMLElement; body: HTMLElement; head: HTMLElement; closeBtn: HTMLButtonElement } {
  const closeBtn = h('button.vh-x', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close' });
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
  const plaque = h('div.vh-plaque', null);
  plaque.innerHTML = `<span class="vh-ico">${iconSvg}</span>`;
  plaque.append(h('span', { text: title }));
  const head = h('div.vh-head', null, plaque, closeBtn);
  const body = h('div.vh-body', null);
  const el = h(`section.vh-frame.vh-${id}${cls ? `.${cls}` : ''}`, { 'aria-label': title, 'data-testid': `panel-${id}` }, head, h('div.vh-paper', null, body));
  return { el, body, head, closeBtn };
}
