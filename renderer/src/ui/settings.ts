/**
 * Settings panel (§8 "Help / onboarding / settings") + the UI's client-local prefs.
 *
 * Server-persisted settings (`settings.set`, shared/protocol.ts DEFAULT_SETTINGS) are edited in place with an optimistic
 * apply; `allowMutations` is server-side and shown read-only. Sound levels + mute are AUD's settings keys
 * (`volume*`, `audioMuted`); "Mixer & previews" opens AUD's own card. Client-local prefs (this browser only,
 * localStorage `hq.prefs`): `doneToasts`. ui-kit §5.5: a paper form with the `Settings` plaque: circled choices for
 * enums, clay faders with a mono value, ticks for booleans; server-side items say so. The sections sit behind a paper
 * detent (Look · Sound · Answering · Terminal · Keys & help; `[` / `]` or ←/→ on the detent), one at a time, so the
 * sheet stays ≤ 65vh below the HUD tally and never becomes a full-height slab; a section that still runs long scrolls
 * inside the kit's stitched edge. The tour and the key overlay are keyed ledger lines in Keys & help (`T`, `?`).
 * `role="dialog"`, modal for the key dispatcher
 * (index.ts `blocked()`); Esc closes, Ctrl/⌘+K hands over to the palette (P2 table: "palette / settings / note text
 * inputs: Ctrl+K → name → Enter").
 * Owner: UI.
 */
import { h, setText, refocus, type Kid } from './dom.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { Settings as WireSettings } from '../../../shared/protocol.ts';
import type { Settings } from '../core/settings.ts';
import type { Store } from '../net/store.ts';
import type { Platform } from './platform.ts';
import { paper, plaque, legend, button, tick, circled, fader, detent, ledger, scrollArea, trapFocus } from './kit/index.ts';
import { injectDialogCss, anchorBelowHud } from './dialogCss.ts';

/** The detent sections, in order (`[` / `]` step through them). */
export const SETTINGS_SECTIONS = Object.freeze([
  ['look', 'Look'], ['sound', 'Sound'], ['answering', 'Answering'], ['terminal', 'Terminal'], ['keys', 'Keys & help'],
] as const);
type SectionId = (typeof SETTINGS_SECTIONS)[number][0];

const PREFS_KEY = 'hq.prefs';
/** Client-local UI prefs. */
export interface Prefs { doneToasts: boolean }
export const PREF_DEFAULTS: Readonly<Prefs> = Object.freeze({ doneToasts: true });

/** A one-key patch (`p[k] = v` keeps the value type tied to the key). */
function patchOf<T, K extends keyof T>(k: K, v: T[K]): Partial<T> {
  const p: Partial<T> = {};
  p[k] = v;
  return p;
}

/** Client-local UI prefs (this browser only). */
export function createPrefs(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
  let v: Prefs = { ...PREF_DEFAULTS };
  try { const raw: unknown = JSON.parse(storage?.getItem(PREFS_KEY) || '{}'); if (isRecord(raw)) Object.assign(v, raw); } catch { /* ignore */ }
  const fns = new Set<(patch: Partial<Prefs>) => void>();
  return {
    get: <K extends keyof Prefs>(k: K): Prefs[K] => v[k],
    set(patch: Partial<Prefs>) {
      v = { ...v, ...patch };
      try { storage?.setItem(PREFS_KEY, JSON.stringify(v)); } catch { /* ignore */ }
      for (const f of fns) f(patch);
    },
    onChange(fn: (patch: Partial<Prefs>) => void) { fns.add(fn); return () => fns.delete(fn); },
  };
}

export interface SettingsPanelDeps {
  root: HTMLElement;
  settings: Pick<Settings, 'get' | 'set' | 'onChange'>;
  prefs: ReturnType<typeof createPrefs>;
  platform: Pick<Platform, 'mac'>;
  store: Pick<Store, 'hello'>;
  hooks: { quality(q: WireSettings['quality']): void; tour(): void; keys(): void; palette(): void; mixer: (() => void) | null; closed(): void };
}

export function createSettingsPanel(d: SettingsPanelDeps) {
  const { settings, prefs } = d;
  injectDialogCss();
  const body = scrollArea({ cls: 'bd' });
  /** the section on show (remembered while the page lives) */
  let section: SectionId = 'look';
  const tabs = detent(SETTINGS_SECTIONS.map(([value, label]) => ({ value, label })), section, (v: string) => showSection(v));
  tabs.setAttribute('aria-label', 'Section ([ and ])');
  const card = paper({ cls: 'hq-settings' },
    h('div.hd', null, plaque('Settings'), h('span.aside', { text: 'saved for this HQ' })),
    tabs,
    body,
    h('div.k-foot', null, legend([{ key: ['[', ']'], label: 'section' }, { spacer: true }, { key: 'Escape', label: 'close' }])));
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Settings');
  card.tabIndex = -1;
  const wrap = h('div.hq-settings-wrap.hq-dlg.mid.dim', null, card);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) api.close(); });
  d.root.append(wrap);
  trapFocus(card);
  addEventListener('resize', () => { if (api.isOpen) anchorBelowHud(wrap); });
  let restore: Element | null = null;
  /** refreshers for the live controls */
  let refresh: (() => void)[] = [];

  // ---- controls (kit parts; each registers a refresher so server echoes / other surfaces keep them true) ----
  const S = <K extends keyof WireSettings>(k: K) => settings.get(k);
  const P = <K extends keyof Prefs>(k: K) => prefs.get(k);
  /** a boolean: a tick (+ a short aside) */
  function tk(label: string, get: () => unknown, set: (on: boolean) => void, aside?: string) {
    const t = tick(label, { aside, on: !!get(), onChange: (on) => set(on) });
    refresh.push(() => t.set(!!get()));
    return t;
  }
  /** an enum on paper: circled words (values may be numbers: kept by index) */
  function choice<T extends string | number>(label: string, aside: string | null, options: readonly (readonly [T, string])[], get: () => T, set: (v: T) => void) {
    const c = circled(options.map(([v, text]) => ({ value: String(v), label: text })), String(get()), (v) => { const hit = options.find(([x]) => String(x) === v); if (hit) set(hit[0]); });
    c.setAttribute('aria-label', label);
    refresh.push(() => c.set(String(get())));
    return field(label, aside, c);
  }
  /** a number: a clay fader with its mono value */
  function num(label: string, aside: string | null, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt?: (v: number) => string) {
    const f = fader(get(), { min, max, step, format: fmt, label, onChange: (v) => set(v) });
    refresh.push(() => { if (document.activeElement !== f) f.set(get()); });
    return field(label, aside, f);
  }
  const field = (label: string, aside: string | null | undefined, ctrl: Node) => h('div.k-field', null, h('span.k-label', null, label, aside ? h('span.aside', { text: ` · ${aside}` }) : null), ctrl);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const setS = <K extends keyof WireSettings>(k: K) => (v: WireSettings[K]) => settings.set(patchOf<WireSettings, K>(k, v));
  const setP = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => prefs.set(patchOf<Prefs, K>(k, v));

  function osRow() {
    const st = h('span');
    const btn = button('Allow', { small: true, onClick: async () => { try { await Notification.requestPermission(); } catch { /* ignore */ } sync(); } });
    const sync = () => {
      const p = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
      setText(st, p === 'granted' ? 'on, when HQ is in the background' : p === 'denied' ? 'blocked by the browser' : p === 'unsupported' ? 'not available here' : 'off');
      btn.hidden = p !== 'default';
    };
    refresh.push(sync); sync();
    return h('div.k-field', null, h('span.k-label', { text: 'OS notifications' }), h('div.os', null, st, btn));
  }

  /** Help-ish actions, as keyed ledger lines (the Keys & help section): `?` all keys, `T` the tour. */
  const LINKS = [
    { key: '?', label: 'All keyboard shortcuts', run: () => d.hooks.keys() },
    { key: 'T', label: 'Replay the tour with Ada', run: () => d.hooks.tour() },
  ];
  function runLink(i: number) { const l = LINKS[i]; if (!l) return; api.close(); l.run(); }

  /** The controls of one section (rebuilt on show, so every control reads the live value). */
  function sectionBody(id: SectionId): HTMLElement {
    const mut = !!d.store.hello?.allowMutations;
    const sec = (...rows: Kid[]) => h('section.sec', { 'data-t': id }, ...rows);
    const ticks = (...t: Kid[]) => h('div.ticks', null, ...t);
    const two = (...t: Kid[]) => h('div.two', null, ...t);
    switch (id) {
      case 'sound': return sec(
        two(
          num('Master', null, 0, 1, 0.05, () => S('volumeMaster') ?? 0.8, setS('volumeMaster'), pct),
          ...(S('volumeNotify') !== undefined ? [num('Alerts', null, 0, 1, 0.05, () => S('volumeNotify'), setS('volumeNotify'), pct)] : []),
          ...(S('volumeVoices') !== undefined ? [num('Voices', null, 0, 1, 0.05, () => S('volumeVoices'), setS('volumeVoices'), pct)] : []),
          num('Effects', null, 0, 1, 0.05, () => S('volumeSfx') ?? 0.8, setS('volumeSfx'), pct),
          num('Ambience', null, 0, 1, 0.05, () => S('volumeAmbient') ?? 0.5, setS('volumeAmbient'), pct)),
        ticks(tk('Mute sounds', () => S('audioMuted') === true, setS('audioMuted')), tk('Toast when an agent finishes', () => P('doneToasts') !== false, setP('doneToasts'))),
        osRow(),
        ...(d.hooks.mixer ? [h('div.k-field', null, button('Mixer & previews', { small: true, onClick: () => { api.close(); d.hooks.mixer?.(); } }))] : []));
      case 'answering': return sec(
        ticks(
          tk('Quick-answer', () => S('quickAnswer'), setS('quickAnswer'), `${d.platform.mac ? '⌥' : 'Alt+'}1–9, then confirm`),
          tk('Sign off when I open a done terminal', () => S('autoAckOnOpen'), setS('autoAckOnOpen'))),
        choice('“While you were away” recap', 'after this long away', [[0, 'Off'], [5, '5 m'], [10, '10 m'], [20, '20 m'], [40, '40 m']], () => S('awayRecapMin'), setS('awayRecapMin')));
      case 'terminal': return sec(
        num('Font size', null, 10, 22, 1, () => S('termFontPx'), setS('termFontPx'), (v) => `${v} px`),
        ticks(
          tk('Copy on select', () => S('copyOnSelect') !== false, setS('copyOnSelect')),
          tk('Peek: Ctrl+C asks twice', () => S('peekCtrlCConfirm'), setS('peekCtrlCConfirm')),
          tk('Release control when idle', () => S('idleDemotion'), setS('idleDemotion'), '10 min')),
        choice('Confirm pastes longer than', 'lines', [[1, '1'], [5, '5'], [20, '20'], [100000, 'never']], () => S('pasteConfirmLines'), setS('pasteConfirmLines')),
        choice('Scrollback', 'HQ’s history or herdr’s own view', [['local', 'HQ'], ['herdr', 'herdr']], () => S('scrollMode'), setS('scrollMode')));
      case 'keys': {
        const safety = tick('Structural actions', { on: mut, aside: 'server · on for a named herdr session' });
        safety.disabled = true;
        const links = ledger(LINKS.map((l) => ({ key: l.key, label: l.label })), { selected: -1, onPick: (i) => runLink(i) });
        links.setAttribute('aria-label', 'Help');
        return sec(
          choice('Leader key', 'F9 always works too', [['Ctrl+`', 'Ctrl+`'], ['Alt+`', 'Alt+`']], () => S('leaderKey'), setS('leaderKey')),
          choice('Key layout', 'modifier names to show and use', [['auto', 'Auto'], ['mac', 'macOS'], ['other', 'Linux / Win']], () => S('platform'), setS('platform')),
          ticks(safety),
          links);
      }
      default: return sec(
        choice('Quality', 'auto keeps 60 fps', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => S('quality'), (q) => { settings.set({ quality: q }); d.hooks.quality(q); }),
        num('Field of view', null, 55, 75, 1, () => S('fov'), setS('fov'), (v) => `${v}°`),
        ticks(tk('Head bob', () => S('headBob'), setS('headBob')), tk('Reduced motion', () => S('reducedMotion'), setS('reducedMotion'))));
    }
  }
  function showSection(id: string) {
    section = SETTINGS_SECTIONS.find(([v]) => v === id)?.[0] ?? 'look';
    tabs.set(section);
    build();
  }
  function build() {
    refresh = [];
    body.replaceChildren(sectionBody(section));
    body.scrollTop = 0;
    body.update();
  }
  const offS = settings.onChange(() => { if (api.isOpen) for (const f of refresh) f(); });
  void offS;

  card.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); api.close(); return; }
    if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === '[' || ev.key === ']')) {
      ev.preventDefault(); ev.stopPropagation();
      const i = SETTINGS_SECTIONS.findIndex(([v]) => v === section);
      const n = SETTINGS_SECTIONS.length;
      showSection(SETTINGS_SECTIONS[(i + (ev.key === ']' ? 1 : n - 1)) % n][0]);
      return;
    }
    if (section === 'keys' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const i = LINKS.findIndex((l) => l.key === ev.key || l.key === ev.key.toUpperCase());
      if (i >= 0) { ev.preventDefault(); ev.stopPropagation(); runLink(i); return; }
    }
    const primary = d.platform.mac ? ev.metaKey : ev.ctrlKey;
    if (primary && ev.code === 'KeyK') { ev.preventDefault(); ev.stopPropagation(); api.close(); d.hooks.palette(); }
  });

  const api = {
    el: wrap,
    get isOpen() { return wrap.classList.contains('show'); },
    open() {
      restore = document.activeElement;
      if (document.pointerLockElement) document.exitPointerLock?.();
      build();
      anchorBelowHud(wrap);
      wrap.classList.add('show');
      body.update();
      card.focus();
    },
    close() {
      if (!api.isOpen) return;
      wrap.classList.remove('show');
      const r = restore;
      restore = null;
      if (r && r !== document.body && r.isConnected) refocus(r);
      d.hooks.closed();
    },
    toggle() { if (api.isOpen) api.close(); else api.open(); },
  };
  return api;
}
