/**
 * Claude HQ UI kit, "Workshop Signage" (docs/design/ui-kit.md §3). Small DOM builders: each returns an element built
 * with dom.ts `h()` and carrying the kit's `k-*` classes (visual reference: renderer/ui-lab/final.html). Stateful
 * parts also get a `set(...)` method on the returned element (readout / tally return `{el, set}` per the spec).
 *
 * Materials: board · paper (clip, deck) · plaque · readout.  Parts: lamp · stateWord · keycap/keys · legend · button ·
 * iconButton · groove · stitch · slot · detent · modeSwitch · tick · circled · fader · porthole · shield · unread ·
 * gauge · groupHeader · ledger · question · stamp · ticket · postit · printout · slip · tally.  Behaviour: trapFocus
 * (modal Tab / Shift+Tab cycle) · focusStops.
 *
 * `injectKit()` puts the token block, the kit CSS and the lamp sprite / #inked filter into the document once; the UI
 * calls it from styles.ts `injectStyles()` before the surface styles. Owner: UI (kit).
 */
import { h, portraitSvg, crestSvg, workspaceHex, type PortraitSubject, type Kid } from '../dom.ts';
import { STATUS, UI } from '../../../../shared/palette.ts';
import { tokenCss } from './tokens.ts';
import { KIT_CSS } from './styles.ts';
import { LAMP, lampSprite, lampHtml, type LampState } from './lamps.ts';
import { comboCaps, isSymbolCap, setKeyPlatform, type KeyPlatform } from './keys.ts';
import { paintDots } from './dotmatrix.ts';

export { LAMP, lampState, lampHtml } from './lamps.ts';
export { keyLabel, comboCaps, leaderCap, setKeyPlatform } from './keys.ts';
export { FONT, RADIUS, RADIUS_PX, TYPE_SCALE, SPACE, EASE } from './tokens.ts';

// ---------------------------------------------------------------------------------------------------- injection
/**
 * Inject tokens + kit CSS + the lamp sprite once (idempotent). Optional: `platform` (keycap labels follow the OS),
 * `quality` (render/quality.ts; the Low tier sets `.hq-lowq` on <html>, which drops the three noise textures).
 */
export function injectKit(o: { platform?: KeyPlatform; quality?: { tier: string; onChange?: (fn: () => void) => void } } = {}) {
  if (o.platform) setKeyPlatform(o.platform);
  if (typeof document === 'undefined') return;
  if (!document.getElementById('hq-kit-css')) {
    const s = document.createElement('style');
    s.id = 'hq-kit-css';
    s.textContent = tokenCss() + KIT_CSS;
    // before every other UI sheet so surface CSS positions kit parts
    const first = document.head.querySelector('style[id^="hq-ui-css"]');
    document.head.insertBefore(s, first ?? null);
  }
  const addSprite = () => {
    if (document.getElementById('k-sprite')) return;
    const t = document.createElement('template');
    t.innerHTML = lampSprite();
    const sprite = t.content.firstElementChild;
    if (sprite) document.body.prepend(sprite);
  };
  if (document.body) addSprite(); else addEventListener('DOMContentLoaded', addSprite, { once: true });
  const quality = o.quality;
  if (quality) {
    const apply = () => document.documentElement.classList.toggle('hq-lowq', quality.tier === 'low');
    apply();
    quality.onChange?.(apply);
  }
}

// ---------------------------------------------------------------------------------------------------- materials
/**
 * The dark painted board in its walnut rim (scanning surfaces). `title` adds the one plaque.
 */
export function board(o: { title?: string; cls?: string } = {}, ...kids: Kid[]) {
  return h(`div.k-board${o.cls ? `.${o.cls.split(' ').join('.')}` : ''}`, null, o.title ? plaque(o.title) : null, ...kids);
}

/**
 * A cream paper sheet (deciding surfaces). `clip` wraps it in a brass clamp (returns the clip wrapper; the sheet is
 * `el.sheet`), `deck` (1–2) draws that many sheet edges below.
 */
export function paper(o: { clip?: boolean; deck?: number; tilt?: boolean; cls?: string } = {}, ...kids: Kid[]) {
  const sheet = h(`div.k-paper${o.tilt ? '.tilt' : ''}${o.cls ? `.${o.cls.split(' ').join('.')}` : ''}`, null, ...kids);
  let el: HTMLElement = sheet;
  if (o.deck) { el = h(`div.k-deck${o.deck === 1 ? '.one' : ''}`, null, sheet); }
  if (o.clip) { el = h('div.k-clip', null, h('div.k-clamp', { 'aria-hidden': 'true' }), el); }
  return Object.assign(el, { sheet });
}

/**
 * The surface's one enamel title plaque. tone: 'clay' (Ada only) | 'butter' (Demo / History) | 'slate' (default session).
 */
export function plaque(text: string, o: { tone?: 'clay' | 'butter' | 'slate'; small?: boolean } = {}) {
  return h(`span.k-plaque${o.small ? '.sm' : ''}${o.tone ? `.${o.tone}` : ''}`, { text });
}

/**
 * Dot-matrix readout (glass + brass ring). Allowed ONLY for the HUD needs-you digit, the drawer blocked counter and
 * the triage progress (§2.1). Redraws only when the text changes.
 */
export function readout(text: string | number, o: { color?: string; pitch?: number; dot?: number; glow?: number; core?: string; label?: string; lamp?: string } = {}): { el: HTMLElement; set: (text: string | number, label?: string) => void } {
  const cv = h('canvas', { 'aria-hidden': 'true' });
  const el = h('span.k-readout', { role: 'img' }, o.lamp ? lamp(o.lamp, { size: 'sm', label: '' }) : null, cv);
  let last: string | null = null;
  const set = (t: string | number, label?: string) => {
    const s = String(t);
    el.setAttribute('aria-label', label ?? o.label ?? s);
    if (s === last) return;
    last = s;
    paintDots(cv, s, o.color ?? STATUS.blocked, o.pitch ?? 2, { dot: o.dot, glow: o.glow, core: o.core });
  };
  set(text);
  return { el, set };
}

// ---------------------------------------------------------------------------------------------------- lamps + words
const isLampKey = (s: string): s is LampState => Object.hasOwn(LAMP, s);

export interface Lamp extends SVGSVGElement { set(state: string, label?: string): void }
/**
 * A status lamp (bezel shape = meaning). size: 'sm' 12 (tabs) | '' 14 (rows) | 'lg' 18 (HUD, tickets).
 * `el.set(state)` swaps it in place. `state` = blocked|working|done|idle|unknown|shell|busy|peek|seen (anything else
 * reads as unknown).
 */
export function lamp(state: string, o: { size?: '' | 'sm' | 'lg'; label?: string; still?: boolean } = {}): Lamp {
  const t = document.createElement('template');
  t.innerHTML = lampHtml(state, o);
  const svg = t.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error('lampHtml() did not produce an <svg>');
  const el: Lamp = Object.assign(svg, {
    set(st: string, label?: string) {
      const known = isLampKey(st);
      const [sym, word] = known ? LAMP[st] : LAMP.unknown;
      el.setAttribute('class', ['k-lamp', known ? st : 'unknown', o.size, o.still ? 'still' : ''].filter(Boolean).join(' '));
      el.setAttribute('aria-label', label ?? word);
      el.firstElementChild?.setAttribute('href', `#${sym}`);
    },
  });
  if (o.label === '') { el.removeAttribute('role'); el.setAttribute('aria-hidden', 'true'); }
  return el;
}

/**
 * Lamp + sentence-case state word, tinted for its material. Only where the grouping doesn't already say it (§4.2).
 */
export function stateWord(state: string, o: { lamp?: boolean; text?: string; still?: boolean } = {}) {
  const st: LampState = isLampKey(state) ? state : 'unknown';
  const word = o.text ?? LAMP[st][1];
  return h(`span.k-state.${st}`, null, o.lamp === false ? null : lamp(st, { label: '', still: o.still }), word);
}

// ---------------------------------------------------------------------------------------------------- keys
/** Symbol caps use mono; ⏎ ⇧ ⌫ and the arrows are drawn (.g-*: an SVG mask in kit/styles.ts), since fallback mono
 *  fonts draw those glyphs tiny or not at all. The cap keeps its text (screen readers, tests). */
const GLYPH_CAP: Record<string, string> = { '⏎': 'ret', '↑': 'up', '↓': 'dn', '←': 'lt', '→': 'rt', '⇧': 'sh', '⌫': 'bs' };
const capCls = (s: string) => (GLYPH_CAP[s] ? `.sym.glyph.g-${GLYPH_CAP[s]}` : isSymbolCap(s) ? '.sym' : '');
/** One keycap for one key label (already a display label, or a key name like 'Enter'). */
export function keycap(label: string, o: { small?: boolean } = {}) {
  const [s] = comboCaps(label);
  return h(`span.k-key${o.small ? '.sm' : ''}${capCls(s ?? '')}`, { text: s ?? String(label) });
}

/**
 * Caps for a combo: 'Mod+K' → [Ctrl][K]; 'Leader' → one [Ctrl `] cap; ['1','–','3'] → [1]–[3].
 */
export function keys(combo: string | string[], o: { small?: boolean } = {}) {
  const list = Array.isArray(combo) ? combo : [combo];
  const kids: HTMLElement[] = [];
  for (const c of list) {
    // a separator only between caps (['1','–','3']); a lone '/' (the search key) is a cap
    if (list.length > 1 && (c === '–' || c === '-' || c === '/')) { kids.push(h('span.to', { text: c === '-' ? '–' : c })); continue; }
    for (const s of comboCaps(c)) kids.push(h(`span.k-key${o.small ? '.sm' : ''}${capCls(s)}`, { text: s }));
  }
  return kids.length === 1 ? kids[0] : h('span.k-keys', null, ...kids);
}

/** One legend entry: `[key] label`, or a flexible spacer. */
export type LegendItem = { key: string | string[]; label?: string; spacer?: undefined } | { spacer: true; key?: undefined; label?: undefined };

/**
 * THE key strip of a surface (one per surface): `[key] verb` entries. `leader: true` renders the Leader once,
 * then "then", then the chord keys: [Ctrl `] then [Z] full · [[] history.
 */
export function legend(items: (LegendItem | null | undefined)[], o: { leader?: boolean; small?: boolean; cls?: string } = {}) {
  const el = h(`div.k-legend${o.cls ? `.${o.cls}` : ''}`);
  if (o.leader) el.append(h('span.h', null, keys('Leader', o)), h('span.then', { text: 'then' }));
  for (const it of items) {
    if (!it) continue;
    if (it.spacer) { el.append(h('span.k-sp')); continue; }
    el.append(h('span.h', null, keys(it.key, o), it.label ?? null));
  }
  return el;
}

/**
 * A sheet's scrolling body (`.k-scroll`): an edge with more content past it turns into a stitch (paper) or groove
 * (board) and the text fades into it. `el.update()` re-measures (also on scroll and on resize).
 */
export function scrollArea(o: { cls?: string; tag?: string; attrs?: Record<string, unknown> } = {}, ...kids: Kid[]) {
  const el = h(`${o.tag ?? 'div'}.k-scroll${o.cls ? `.${o.cls.split(' ').join('.')}` : ''}`, { tabindex: '-1', ...o.attrs }, ...kids);
  const update = () => {
    const up = el.scrollTop > 1;
    const dn = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    el.classList.toggle('up', up);
    el.classList.toggle('dn', dn);
  };
  el.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(el);
  return Object.assign(el, { update });
}

// ---------------------------------------------------------------------------------------------------- buttons
/**
 * A button with its key tile on the LEFT. `primary` = the one clay button of a surface (ink text).
 */
export function button(label: Kid, o: { key?: string | string[]; primary?: boolean; small?: boolean; onClick?: (e: Event) => void; disabled?: boolean; title?: string } = {}) {
  const c = `button.k-btn${o.primary ? '.primary' : ''}${o.key ? '' : '.nokey'}${o.small ? '.sm' : ''}`;
  return h(c, { type: 'button', onclick: o.onClick, disabled: !!o.disabled, title: o.title }, o.key ? keys(o.key, { small: true }) : null, label);
}

/**
 * Toolbar icon button (26 px, 1.75 px stroke). The tooltip names the key.
 * `icon` is dom.ts ICON svg markup.
 */
export function iconButton(icon: string, o: { title: string; key?: string | string[]; onClick?: (e: Event) => void; pressed?: boolean }) {
  const tip = o.key ? `${o.title}  ${comboCaps(o.key).join(' ')}` : o.title;
  const el = h('button.k-ibtn', { type: 'button', title: tip, 'aria-label': o.title, onclick: o.onClick, html: icon });
  if (o.pressed != null) el.setAttribute('aria-pressed', String(!!o.pressed));
  return el;
}

// ---------------------------------------------------------------------------------------------------- dividers
export const groove = () => h('div.k-groove', { role: 'separator' });
export const stitch = () => h('hr.k-stitch');

// ---------------------------------------------------------------------------------------------------- inputs
const SEARCH = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/></svg>';

/**
 * Text input: recessed on the board, an underline on paper. `el.input` is the <input>.
 */
export function slot(o: { placeholder?: string; key?: string; search?: boolean; voice?: boolean; value?: string; label?: string } = {}) {
  const input = h('input', { type: 'text', placeholder: o.placeholder, value: o.value, spellcheck: 'false', autocomplete: 'off', 'aria-label': o.label ?? o.placeholder });
  const el = h(`label.k-slot${o.voice ? '.voice' : ''}`, null, o.search ? h('span', { html: SEARCH, style: { display: 'contents' } }) : null, input, o.key ? keys(o.key) : null);
  return Object.assign(el, { input });
}

/** A `detent` / `circled` option: a plain string (value = label) or an explicit pair. */
export type Choice = string | { value: string; label: string };
const normChoices = (options: readonly Choice[]) => options.map((x) => (typeof x === 'string' ? { value: x, label: x } : x));

export interface Detent extends HTMLDivElement { value: string; set(v: string): void }

/**
 * THE one tab / segment control (group-by, inbox tabs, help scope, palette scope). Options are strings or
 * {value, label}. `el.set(value)` moves the notch; clicking calls onChange(value). Arrow keys move between options.
 */
export function detent(options: readonly Choice[], value: string, onChange?: (v: string) => void): Detent {
  const opts = normChoices(options);
  const el: Detent = Object.assign(h('div.k-detent', { role: 'tablist' }), {
    value: '',
    set(v: string) {
      el.value = v;
      for (const b of btns) { const on = b.dataset.value === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    },
  });
  const btns = opts.map((op) => h('button', { type: 'button', role: 'tab', 'data-value': op.value, text: op.label, onclick: () => { el.set(op.value); onChange?.(op.value); } }));
  el.append(...btns);
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = opts.findIndex((op) => op.value === el.value);
    const n = opts[(i + (e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length];
    el.set(n.value); onChange?.(n.value); btns[opts.indexOf(n)].focus(); e.preventDefault();
  });
  el.set(value);
  return el;
}

export type Side = 'left' | 'right';
export interface ModeSwitch extends HTMLButtonElement { set(v: Side): void }

/**
 * A binary mode switch (Peek / Control). value 'left' | 'right'; the knob turns clay on the right (input-changing)
 * side. `el.set(side)`; clicking toggles and calls onChange(side).
 */
export function modeSwitch(o: { left: string; right: string; value?: Side; onChange?: (v: Side) => void; title?: string }): ModeSwitch {
  const l = h('span.lb', { text: o.left }), r = h('span.lb', { text: o.right });
  const el: ModeSwitch = Object.assign(h('button.k-switch', { type: 'button', role: 'switch', title: o.title }, l, h('span.track', null, h('i')), r), {
    set(v: Side) {
      el.value = v;
      el.classList.toggle('right', v === 'right'); l.classList.toggle('on', v !== 'right'); r.classList.toggle('on', v === 'right');
      el.setAttribute('aria-checked', String(v === 'right'));
      el.setAttribute('aria-label', `${o.left} / ${o.right}: ${v === 'right' ? o.right : o.left}`);
    },
  });
  el.addEventListener('click', () => { const v = el.value === 'right' ? 'left' : 'right'; el.set(v); o.onChange?.(v); });
  el.set(o.value ?? 'left');
  return el;
}

export interface Tick extends HTMLButtonElement { on: boolean; set(on?: boolean): void }

/**
 * An on/off filter or option (box + check). `el.set(on)`; clicking toggles and calls onChange(on).
 */
export function tick(label: Kid, o: { on?: boolean; aside?: string; onChange?: (on: boolean) => void } = {}): Tick {
  const el: Tick = Object.assign(h('button.k-tick', { type: 'button', role: 'checkbox' }, h('i', { 'aria-hidden': 'true' }), label, o.aside ? h('span.aside', { text: ` · ${o.aside}` }) : null), {
    on: false,
    set(on?: boolean) { el.on = !!on; el.classList.toggle('on', !!on); el.setAttribute('aria-checked', String(!!on)); },
  });
  el.addEventListener('click', () => { el.set(!el.on); o.onChange?.(el.on); });
  el.set(o.on);
  return el;
}

export interface Circled extends HTMLDivElement { value: string; set(v: string): void }

/**
 * A single value choice on PAPER forms: the chosen word is circled in clay ink (settings enums, hire kind).
 */
export function circled(options: readonly Choice[], value: string, onChange?: (v: string) => void): Circled {
  const opts = normChoices(options);
  // one focus stop (the chosen word; the first when none is chosen); arrows move the circle, like a radio group
  const el: Circled = Object.assign(h('div.k-circled', { role: 'radiogroup' }), {
    value: '',
    set(v: string) {
      el.value = v;
      const any = btns.some((b) => b.dataset.value === v);
      btns.forEach((b, i) => { const on = b.dataset.value === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on || (!any && i === 0) ? 0 : -1; });
    },
  });
  const btns = opts.map((op) => h('button', { type: 'button', role: 'radio', 'data-value': op.value, text: op.label, onclick: () => { el.set(op.value); onChange?.(op.value); } }));
  el.append(...btns);
  el.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
    const live = btns.filter((b) => !b.disabled);
    if (!live.length) return;
    const at = live.findIndex((b) => b === document.activeElement);
    const n = live[((at < 0 ? live.findIndex((b) => b.dataset.value === el.value) : at) + dir + live.length) % live.length];
    e.preventDefault(); e.stopPropagation();
    const nv = n.dataset.value ?? ''; // always set from op.value above
    if (nv !== el.value) { el.set(nv); onChange?.(nv); }
    n.focus();
  });
  el.set(value);
  return el;
}

// ---------------------------------------------------------------------------------------------------- modal focus
/** Focus stops inside `el` in tab order (visible, enabled, tabIndex ≥ 0). */
export function focusStops(el: ParentNode): HTMLElement[] {
  const q = 'button,input,select,textarea,a[href],[tabindex]';
  return [...el.querySelectorAll<HTMLElement>(q)].filter((n) => n.tabIndex >= 0 && !('disabled' in n && n.disabled)
    && !n.closest('[hidden],[inert]') && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden');
}

interface Trap { el: HTMLElement; keep?: (t: Element) => boolean }
const TRAPS: Trap[] = [];
function onTrapKey(e: KeyboardEvent) {
  if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
  const shown = TRAPS.filter((t) => t.el.isConnected && t.el.getClientRects().length > 0);
  if (!shown.length) return;
  const ae = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const t = shown.find((x) => ae && x.el.contains(ae)) ?? shown[shown.length - 1];
  if (ae && t.el.contains(ae) && t.keep?.(ae)) return; // the dialog uses Tab itself here (palette scope)
  e.preventDefault();
  const stops = focusStops(t.el);
  if (!stops.length) { if (t.el.tabIndex < 0) t.el.tabIndex = -1; t.el.focus(); return; }
  // inside a roving group (detent / circled) the stop is the group's current one
  const at = stops.findIndex((n) => n === ae || (ae && n.contains(ae)));
  const i = at < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
  stops[i].focus();
}

/**
 * Modal focus trap: while `el` is shown (connected and laid out), Tab / Shift+Tab cycle its focus stops and never reach
 * the world behind the dim; focus that fell out (a click on the dim) comes back on the next Tab. `keep(target)` hands
 * Tab to the dialog when it uses the key itself there. Returns a release function.
 */
export function trapFocus(el: HTMLElement, o: { keep?: (t: Element) => boolean } = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  if (!TRAPS.length) document.addEventListener('keydown', onTrapKey, true);
  const t = { el, keep: o.keep };
  TRAPS.push(t);
  return () => { const i = TRAPS.indexOf(t); if (i >= 0) TRAPS.splice(i, 1); if (!TRAPS.length) document.removeEventListener('keydown', onTrapKey, true); };
}

export interface Fader extends HTMLSpanElement { value: number; set(v: number): void }

/**
 * A number on paper: oat track, clay fill + knob, mono value. Arrow keys step; click / drag sets.
 */
export function fader(value: number, o: { min?: number; max?: number; step?: number; format?: (v: number) => string; label?: string; onChange?: (v: number) => void } = {}): Fader {
  const min = o.min ?? 0, max = o.max ?? 100, step = o.step ?? 1, fmt: (v: number) => string = o.format ?? String;
  const fill = h('b'), knob = h('i'), val = h('span.val');
  const trk = h('span.trk', null, fill, knob);
  const el: Fader = Object.assign(h('span.k-fader', { role: 'slider', tabindex: 0, 'aria-label': o.label, 'aria-valuemin': min, 'aria-valuemax': max }, trk, val), {
    value: min,
    set(v: number) {
      const c = Math.min(max, Math.max(min, Math.round(v / step) * step));
      el.value = c;
      const pct = max > min ? ((c - min) / (max - min)) * 100 : 0;
      fill.style.width = `${pct}%`; knob.style.left = `${pct}%`;
      val.textContent = fmt(c);
      el.setAttribute('aria-valuenow', String(c)); el.setAttribute('aria-valuetext', fmt(c));
    },
  });
  const commit = (v: number) => { const before = el.value; el.set(v); if (el.value !== before) o.onChange?.(el.value); };
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0;
    if (d) { commit(el.value + d * (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  });
  const at = (e: PointerEvent) => { const r = trk.getBoundingClientRect(); commit(min + ((e.clientX - r.left) / Math.max(1, r.width)) * (max - min)); };
  trk.addEventListener('pointerdown', (e) => {
    at(e); trk.setPointerCapture?.(e.pointerId);
    const mv = (ev: PointerEvent) => at(ev), up = () => { trk.removeEventListener('pointermove', mv); trk.removeEventListener('pointerup', up); };
    trk.addEventListener('pointermove', mv); trk.addEventListener('pointerup', up);
  });
  el.set(value);
  return el;
}

// ---------------------------------------------------------------------------------------------------- identity
/**
 * Portrait in a brass ring; the inner rim is the WORKSPACE colour (replaces every workspace chip). `portrait` = a live
 * atlas node (canvas / img) from ctx.portraits; without it the procedural SVG stands in. size: 'xs' 22 · '' 36 · 'lg' 56.
 */
export function porthole(entity: PortraitSubject | null | undefined, o: { size?: '' | 'xs' | 'lg'; portrait?: Node | null } = {}) {
  const shell = entity?.kind === 'shell';
  const inner = h('div');
  if (o.portrait) inner.append(o.portrait); else inner.innerHTML = portraitSvg(entity, o.size === 'lg' ? 56 : o.size === 'xs' ? 22 : 36);
  const el = h(`div.k-port${o.size ? `.${o.size}` : ''}${shell ? '.shell' : ''}`, { style: { '--ws': workspaceHex(entity?.workspace?.colorIndex) } }, inner);
  return Object.assign(el, { inner });
}

/** Enamel workspace crest: only in the drawer breadcrumb, a card head and the hire list. */
export function shield(colorIndex: number | null | undefined, o: { title?: string } = {}) {
  return h('span.k-shield', { html: crestSvg(colorIndex, 14), title: o.title, 'aria-hidden': o.title ? null : 'true' });
}

export interface Unread extends HTMLSpanElement { set(k: number): void }

/** Butter unread bulb (+ mono count when > 1, `9+` above 9). `el.set(n)` hides it at 0. */
export function unread(n = 1): Unread {
  const el: Unread = Object.assign(h('span.k-unread'), {
    set(k: number) { el.hidden = !(k > 0); el.textContent = k > 9 ? '9+' : k > 1 ? String(k) : ''; el.setAttribute('aria-label', k > 0 ? `${k} unread` : ''); },
  });
  el.set(n);
  return el;
}

/** The note glyph (a folded butter corner). */
export const noteGlyph = (title = 'note') => h('span.k-note', { title, 'aria-label': title });

export interface Gauge extends HTMLSpanElement { set(pct: number | null | undefined): void }

/** Context meter (44 px); hot ≥ 80 %. `el.set(pct)`. */
export function gauge(pct: number | null | undefined, o: { suffix?: string } = {}): Gauge {
  const bar = h('i');
  const txt = document.createTextNode('');
  const el: Gauge = Object.assign(h('span.k-gauge', null, h('span.bar', null, bar), txt), {
    set(p: number | null | undefined) {
      const v = Math.max(0, Math.min(100, Math.round(p ?? 0)));
      bar.style.width = `${v}%`; txt.textContent = `${v}%${o.suffix ? ` ${o.suffix}` : ''}`;
      el.classList.toggle('hot', v >= 80);
    },
  });
  el.set(pct);
  return el;
}

// ---------------------------------------------------------------------------------------------------- lists
const CHEV = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';

/**
 * Roster group header: chevron · lamp · UPPERCASE sign name (or a normal-case `label` for space/tab/dir groups with a
 * shield) · mono count · groove leader, or the collapsed summary line. `alarm` = the blocked header (+ its legend).
 */
export function groupHeader(o: { name?: string; label?: string; state?: string; count?: number; expanded?: boolean; summary?: string; alarm?: boolean; legend?: HTMLElement; lead?: Node; onClick?: (e: Event) => void }) {
  const el = h(`button.k-gh${o.alarm ? '.alarm' : ''}`, { type: 'button', 'aria-expanded': String(o.expanded !== false), onclick: o.onClick, html: CHEV });
  if (o.lead) el.append(o.lead);
  if (o.state) el.append(lamp(o.state, { label: '', still: !o.alarm }));
  el.append(o.name ? h('span.name', { text: o.name }) : h('span.label', { text: o.label ?? '' }));
  if (o.count != null) el.append(h('span.cnt', { text: String(o.count) }));
  if (o.expanded === false && o.summary) el.append(h('span.sum', { text: `· ${o.summary}` }));
  else el.append(h('span.fill'));
  if (o.legend) el.append(o.legend);
  return el;
}

/** A `ledger` line: a plain label or an object with a note / destructive flag / key tiles. */
export type LedgerOption = string | { label: string; note?: string; destructive?: boolean; key?: string; keys?: string | string[]; lead?: Node };
export interface Ledger extends HTMLUListElement { selected: number; select(i: number): void }

/**
 * THE prompt-options component (roster, status card, inbox, triage): `[n] label` lines; `1–9` pick, Enter confirms.
 * Options are strings or {label, note, destructive}. `board: true` = the 28 px board variant.
 * `el.select(i)` moves the highlighter; clicking calls onPick(i).
 * A line may carry `keys` (a combo, e.g. 'Ctrl+Shift+C' or ['Leader','I']): its key tiles sit at the line's right end,
 * like the palette's (a menu's lines always show their keys).
 * `wrap: true` lets a long label run to 2 lines (the decision text must be readable without the terminal).
 */
export function ledger(options: readonly LedgerOption[], o: { selected?: number; board?: boolean; wrap?: boolean; onPick?: (i: number) => void; numbered?: boolean } = {}): Ledger {
  const el: Ledger = Object.assign(h(`ul.k-ledger${o.board ? '.board' : ''}${o.wrap ? '.wrap' : ''}`, { role: 'listbox' }), {
    selected: 0,
    select(i: number) { el.selected = i; lis.forEach((li, j) => { li.classList.toggle('k-hl', j === i); li.setAttribute('aria-selected', String(j === i)); }); },
  });
  const lis = options.map((x, i) => {
    const op = typeof x === 'string' ? { label: x } : x;
    const key = ('key' in op ? op.key : undefined) ?? (o.numbered === false ? null : String(i + 1));
    return h('li', { role: 'option', 'data-i': i, onclick: () => { el.select(i); o.onPick?.(i); } },
      key ? keycap(key, { small: !!o.board }) : null, ('lead' in op ? op.lead : undefined) ?? null, h('span.tx', { text: op.label }),
      'note' in op && op.note ? h(`span.note${'destructive' in op && op.destructive ? '' : '.meta'}`, { text: op.note }) : null,
      'keys' in op && op.keys ? h('span.kc', null, keys(op.keys, { small: true })) : null);
  });
  el.append(...lis);
  el.select(o.selected ?? 0);
  return el;
}

/** The agent's question in its own (serif) voice with the red ledger margin; `code` spans → mono. */
export function question(text: string | null | undefined) {
  const el = h('div.k-q');
  String(text ?? '').split(/(`[^`]+`)/).forEach((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) el.append(h('code', { text: part.slice(1, -1) }));
    else if (part) el.append(part);
  });
  return el;
}

// ---------------------------------------------------------------------------------------------------- paper marks
export interface Stamp extends HTMLSpanElement { setTime(s: string): void }

/**
 * A worn rubber stamp (paper only, max one per sheet): WAITING 4:12 · SIGNED OFF · LOCKED · READY.
 */
export function stamp(text: string, o: { ink?: 'blocked' | 'done' | 'locked' | 'ready'; time?: string } = {}): Stamp {
  const t = h('span.t', { text: o.time ?? '' });
  const el: Stamp = Object.assign(h(`span.k-stamp${o.ink && o.ink !== 'blocked' ? `.${o.ink}` : ''}`, null, text), {
    setTime(s: string) { if (!t.isConnected) el.append(t); if (t.textContent !== s) t.textContent = s; },
  });
  if (o.time != null) el.append(t);
  return el;
}

/**
 * Toast = a receipt ticket: stub (lamp + elapsed) · caption `No. 0412 · 14:02 · ws › tab` · headline · one serif
 * line · tear · legend. No close ×. `line: true` = the one-line drawer-footer variant.
 * `state` is 'blocked' | 'done' or any other lamp state.
 */
export function ticket(o: { state?: string; elapsed?: string; caption?: string; headline: string; text?: string; legend?: HTMLElement | null; line?: boolean; onClick?: (e: Event) => void }) {
  const st = o.state ?? 'blocked';
  const el = h(`div.k-ticket.in-anim${st === 'done' ? '.done' : ''}${o.line ? '.line' : ''}`, { role: 'status', onclick: o.onClick },
    h('div.in', null,
      h('div.stub', null, lamp(st, { size: o.line ? 'sm' : 'lg' }), o.elapsed ? h('span.t', { text: o.elapsed }) : null),
      h('div.body', null,
        o.caption ? h('div.cap', { text: o.caption }) : null,
        h('div.what', { text: o.headline }),
        o.text ? h('div.q', { text: o.text }) : null,
        o.legend && !o.line ? h('hr.k-stitch.tear') : null,
        o.legend ?? null)));
  return el;
}

/**
 * Butter post-it (fit hint, resize notice, outbox, onboarding aside). Lives in a strip; never over glyphs.
 */
export function postit(text: string, o: { action?: string; key?: string; onAction?: (e: Event) => void } = {}) {
  return h('div.k-postit', { role: 'note' }, h('span', { text }),
    o.action ? h('button.link', { type: 'button', text: o.action, onclick: o.onAction }) : null, o.key ? keys(o.key, { small: true }) : null);
}

export interface Printout extends HTMLDivElement { set(lines: string[] | string | null | undefined, o?: { wait?: boolean }): void }

/** Tractor-feed printout of terminal lines (triage). `el.set(lines, {wait})`. */
export function printout(lines: string[] | string | null | undefined = [], o: { wait?: boolean } = {}): Printout {
  const pre = h('pre');
  const el: Printout = Object.assign(h('div.k-printout', null, pre), {
    set(ls: string[] | string | null | undefined, oo: { wait?: boolean } = {}) { pre.classList.toggle('wait', !!oo.wait); const s = Array.isArray(ls) ? ls.join('\n') : String(ls ?? ''); if (pre.textContent !== s) pre.textContent = s; },
  });
  el.set(lines, o);
  return el;
}

/** One line of a "While you were out" slip (`state` null → no lamp). */
export interface SlipLine { state: string | null; name: string; text: string; time?: string; onClick?: (e: Event) => void }

/**
 * "While you were out" slip: clay-ruled band, then `lamp · name · serif sentence · time` lines, then actions.
 */
export function slip(o: { title?: string; span?: string; lines: SlipLine[]; actions?: Node[] }) {
  const el = paper({ cls: 'k-slip' }, slipBand(o), ...o.lines.map(slipLine), o.actions?.length ? h('div.acts', null, ...o.actions) : null);
  return el;
}

/** The slip's clay-ruled band (also for a slip printed inside another sheet: wrap band + lines in `div.k-slip`). */
export function slipBand(o: { title?: string; span?: string } = {}) {
  return h('div.band', null, h('h3', { text: o.title ?? 'While you were out' }), o.span ? h('span.span', { text: o.span }) : null);
}

/**
 * One slip line: `lamp · name · serif sentence · time`; clickable (`.act`) with onClick.
 */
export function slipLine(l: SlipLine) {
  // state null = no lamp (e.g. an agent that has left): a lamp-sized blank keeps the names in one column
  return h(`div.ln${l.onClick ? '.act' : ''}`, { onclick: l.onClick }, l.state ? lamp(l.state, { still: true }) : h('span.k-lamp-gap', { 'aria-hidden': 'true' }), h('b', { text: l.name }),
    h('span.k-voice', { text: l.text }), l.time ? h('span.t', { text: l.time }) : null);
}

// ---------------------------------------------------------------------------------------------------- HUD
const TALLY = [['working', 'working'], ['done', 'done'], ['idle', 'idle'], ['shell', 'shells']] as const;

export interface TallyCounts { blocked?: number; working?: number; done?: number; idle?: number; shell?: number }

/**
 * The HUD tally board: [alarm ▲ n need you [B]] · ● n working · ✓ n done · ◌ n idle · ▣ n shells. Zero cells hide;
 * at 0 blocked the alarm cell reads "All clear". Each cell is a filter button → onFilter(state).
 */
export function tally(counts: TallyCounts, o: { onFilter?: (state: string) => void; hang?: boolean } = {}): { el: HTMLElement; board: HTMLElement; set: (counts: TallyCounts, pressed?: string | null) => void } {
  // the most important number on screen: 3.4 px pitch (24 px tall), fat bulbs with a hot paper-white core, on glass
  const dm = readout('0', { color: UI.onBoard.blocked, pitch: 3.4, dot: 0.46, glow: 1.2, core: UI.fit.alarmWord });
  dm.el.classList.remove('k-readout'); // the alarm cell IS the glass
  const alarmWord = h('span.w');
  const alarm = h('button.cell.alarm', { type: 'button', 'data-state': 'blocked', onclick: () => o.onFilter?.('blocked') }, lamp('blocked', { size: 'lg', label: '' }), dm.el, alarmWord, keycap('B'));
  const clear = h('button.cell.clear', { type: 'button', 'data-state': 'clear', onclick: () => o.onFilter?.('clear') }, lamp('done', { size: 'lg', label: '' }), h('span.w', { text: 'All clear' }));
  const cells = TALLY.map(([st, word]) => {
    const n = h('span.n');
    const c = h('button.cell', { type: 'button', 'data-state': st, onclick: () => o.onFilter?.(st) }, lamp(st, { label: '' }), n, h('span.w', { text: word }));
    return { st, c, n, word };
  });
  const b = h('div.k-board.k-tally', { role: 'toolbar', 'aria-label': 'Agent tally' }, alarm, clear, ...cells.map((x) => x.c));
  const el = o.hang === false ? b : h('div.k-hang', null, h('span.rod', { style: { left: '22%' } }), h('span.rod', { style: { right: '22%' } }), b);
  const set = (k: TallyCounts, pressed: string | null = null) => {
    const nb = k.blocked ?? 0;
    alarm.hidden = nb === 0; clear.hidden = nb > 0;
    if (nb) { dm.set(String(nb)); alarmWord.textContent = nb === 1 ? 'needs you' : 'need you'; alarm.setAttribute('aria-label', `${nb} ${alarmWord.textContent}`); }
    for (const x of cells) {
      const v = k[x.st] ?? 0;
      x.c.hidden = v === 0;
      if (x.n.textContent !== String(v)) x.n.textContent = String(v);
      x.c.setAttribute('aria-label', `${v} ${x.word}`);
    }
    for (const c of [alarm, ...cells.map((x) => x.c)]) c.setAttribute('aria-pressed', String(c.dataset.state === pressed));
  };
  set(counts);
  return { el, board: b, set };
}
