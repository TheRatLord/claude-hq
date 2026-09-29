/**
 * Command palette (§8 table, ui-kit §5.5 "index card"): Ctrl+K (Cmd+K on macOS) or `/` in world scopes. A clipped paper
 * index card (brass clamp, one sheet edge below) over the palette veil: the search line carries the `Index` plaque, the
 * input and a `Find · Go · Do` scope detent (Tab cycles it); sections in sign caps on teal rules, one line per result
 * (porthole or icon · name with the butter match marks · mono context · lamp + pencil state word, blocked with its wait),
 * action shortcuts as keycaps in the right column (paletteRank.splitKeyHint), the Enter hint on the selected line
 * only, and one footer legend.
 * Find: agents + actions, Enter opens the terminal, Shift+Enter goes to. Go: agents only, Enter goes to, Shift+Enter
 * opens. Do: actions only. The ranking itself is paletteRank.ts (unchanged).
 * Owner: UI.
 */
import { taskLabel } from '../../../shared/task.ts';
import { waitClock } from '../../../shared/clock.ts';
import { h, ICON, refocus } from './dom.ts';
import { rankPalette, splitKeyHint, type PaletteHit } from './paletteRank.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Store } from '../net/store.ts';
import { fuzzy } from './roster/model.ts';
import { detent, keycap, keys, legend, porthole, stateWord, lampState, LAMP, paper, plaque, scrollArea, trapFocus } from './kit/index.ts';
import { injectDialogCss, anchorBelowHud } from './dialogCss.ts';

const SEARCH = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>';
export const PALETTE_SCOPES = Object.freeze(['find', 'go', 'do'] as const);
export type PaletteScope = (typeof PALETTE_SCOPES)[number];
const isScope = (v: unknown): v is PaletteScope => PALETTE_SCOPES.some((s) => s === v);

/**
 * @pure Which characters of `label` the query marks (butter highlighter): a substring hit marks the run, otherwise
 * each query word's subsequence. Returns [start, end) ranges, merged and sorted.
 */
export function matchRanges(label: string, q: string | null | undefined): [number, number][] {
  const L = String(label).toLowerCase();
  const words = String(q ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const out: [number, number][] = [];
  for (const w of words) {
    const at = L.indexOf(w);
    if (at >= 0) { out.push([at, at + w.length]); continue; }
    if (!fuzzy(w, L)) continue;
    let j = 0;
    for (let i = 0; i < L.length && j < w.length; i++) if (L[i] === w[j]) { out.push([i, i + 1]); j++; }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** A label with `mark.k-match` over the matched runs. */
function marked(tag: string, label: string, q: string) {
  const el = h(tag);
  let i = 0;
  for (const [a, b] of matchRanges(label, q)) {
    if (a > i) el.append(label.slice(i, a));
    el.append(h('mark.k-match', { text: label.slice(a, b) }));
    i = b;
  }
  if (i < label.length) el.append(label.slice(i));
  return el;
}

/** One action row of the palette ("Do"). */
export interface PaletteAction { id: string; label: string; hint?: string; icon?: string; disabled?: boolean; run(): void }

export interface PaletteDeps {
  root: HTMLElement;
  store: Pick<Store, 'entities' | 'now'>;
  label?: (e: Entity) => string;
  actions(): PaletteAction[];
  hooks: { open(id: string): void; goTo(id: string): void; closed(): void };
}

export function createPalette(d: PaletteDeps) {
  injectDialogCss();
  const input = h('input', { type: 'text', placeholder: 'Name or action…', 'aria-label': 'Command', spellcheck: 'false', autocomplete: 'off', role: 'combobox', 'aria-controls': 'hq-cmdk-list', 'aria-expanded': 'true' });
  const listEl = scrollArea({ tag: 'ul', attrs: { role: 'listbox', id: 'hq-cmdk-list', tabindex: null } });
  const scopeEl = detent([{ value: 'find', label: 'Find' }, { value: 'go', label: 'Go' }, { value: 'do', label: 'Do' }], 'find', (v) => setScope(v));
  scopeEl.setAttribute('aria-label', 'Scope (Tab)');
  const esc = keycap('Esc');
  esc.title = 'Close (Esc)';
  esc.addEventListener('click', () => api.close());
  const foot = h('div.foot');
  const clip = paper({ clip: true, deck: 1, cls: 'hq-cmdk k-index' },
    h('div.top', null, plaque('Index'), h('span', { html: SEARCH, style: { display: 'contents' } }), input, scopeEl, esc),
    listEl, foot);
  clip.classList.add('hq-cmdk-clip');
  const card = clip.sheet;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Command palette');
  const wrap = h('div.hq-cmdk-wrap.hq-dlg.k-veil', null, clip);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) api.close(); });
  // clicks on the card's chrome (detent, rows) keep the caret in the search line
  card.addEventListener('mousedown', (ev) => { if (ev.target !== input) ev.preventDefault(); });
  d.root.append(wrap);
  trapFocus(card, { keep: (t) => t === input }); // Tab in the search line cycles the scope

  let items: PaletteHit<PaletteAction>[] = [];
  let idx = 0;
  let isOpen = false;
  let restoreFocus: Element | null = null;
  let scope: PaletteScope = 'find';

  function setScope(v: string) {
    scope = isScope(v) ? v : 'find';
    scopeEl.set(scope);
    idx = 0;
    renderFoot();
    build();
    input.focus();
  }
  function renderFoot() {
    const go = scope === 'go';
    foot.replaceChildren(legend([
      scope === 'do' ? { key: 'Enter', label: 'run' } : { key: 'Enter', label: go ? 'go to' : 'open' },
      scope === 'do' ? null : { key: 'Shift+Enter', label: go ? 'open' : 'go to' },
      { key: ['ArrowUp', 'ArrowDown'], label: 'select' },
      { spacer: true },
      { key: 'Tab', label: 'scope' },
    ]));
  }

  function build() {
    // one tiered ranking across agents AND actions (paletteRank.ts): 'set' → Settings beats a task-text subsequence hit
    const all = rankPalette(input.value, d.store.entities.values(), d.actions(), { label: d.label, ...(scope === 'go' ? { maxAgents: 24 } : {}), ...(scope === 'do' ? { maxActions: 40 } : {}) });
    items = scope === 'go' ? all.filter((x) => x.kind === 'agent') : scope === 'do' ? all.filter((x) => x.kind === 'action') : all;
    idx = Math.min(idx, Math.max(0, items.length - 1));
    render();
  }

  /** The hint on the selected line: what Enter does here. */
  function hintFor(it: PaletteHit<PaletteAction>) {
    if (it.kind === 'action') return it.a.disabled ? null : 'run';
    return scope === 'go' ? 'go to' : 'open';
  }

  function render() {
    const q = input.value.trim();
    const nodes: HTMLElement[] = [];
    let lastKind: string | null = null;
    // with a query in Find, agents and actions interleave by rank under one header (the porthole / icon says which)
    const mixed = !!q && scope === 'find';
    if (mixed && items.length) nodes.push(h('li.sec', { role: 'presentation', text: 'Best matches' }));
    const now = d.store.now?.() ?? Date.now();
    items.forEach((it, i) => {
      if (!mixed && it.kind !== lastKind) {
        nodes.push(h('li.sec', { role: 'presentation', text: it.kind === 'agent' ? 'Agents' : 'Actions' }));
        lastKind = it.kind;
      }
      let li: HTMLElement;
      if (it.kind === 'agent') {
        const e = it.e;
        const name = qualified(e);
        const st = lampState(e.status, e);
        const ctx = [e.workspace?.label, e.tab?.label].filter(Boolean).join(' › ') + (taskLabel(e) ? ` · ${taskLabel(e)}` : '');
        const word = st === 'busy' ? (e.process?.activity ?? LAMP.busy[1]) : LAMP[st][1];
        const wait = st === 'blocked' && e.statusSince ? waitClock(now - e.statusSince, e.statusSinceApprox) : '';
        li = h('li.it', { role: 'option', id: `hq-cmdk-${i}` },
          porthole(e, { size: 'xs' }),
          h('span.tx', null, marked('b.nm', name, q), h('span.ctx', { text: ctx })),
          h('span.st', null, stateWord(st, { text: word, still: true }), wait ? h('span.t', { text: wait }) : null));
      } else {
        const a = it.a;
        const kh = splitKeyHint(a.hint);
        li = h(a.disabled ? 'li.it.off' : 'li.it', { role: 'option', id: `hq-cmdk-${i}`, ...(a.disabled ? { 'aria-disabled': 'true' } : {}) },
          h('span.ic', { html: a.icon ?? ICON.chevron }),
          h('span.tx', null, marked('b.nm', a.label, q), kh.rest ? h('span.aside', { text: kh.rest }) : null),
          kh.keys ? h('span.kc', null, keys(kh.keys, { small: true })) : null);
      }
      const on = i === idx;
      li.setAttribute('aria-selected', String(on));
      if (on) {
        li.classList.add('k-hl');
        const hint = hintFor(it);
        if (hint) li.append(h('span.k-legend', null, h('span.h', null, keys('Enter', { small: true }), hint)));
      }
      li.addEventListener('mousemove', () => { if (idx !== i) { idx = i; render(); } });
      li.addEventListener('click', (ev) => { idx = i; run(ev.shiftKey); });
      nodes.push(li);
    });
    if (!items.length) nodes.push(h('li.none', { role: 'presentation', text: q ? 'Nothing matches' : scope === 'go' ? 'Nobody is here yet' : 'Nothing to do' }));
    listEl.replaceChildren(...nodes);
    listEl.update();
    input.setAttribute('aria-activedescendant', items.length ? `hq-cmdk-${idx}` : '');
    listEl.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * The one label every surface shows (names.ts: namesakes → 'claude · 2', m2-r3 [ui]); the workspace › tab line beside
   * it stays the secondary cue.
   */
  function qualified(e: Entity) {
    return d.label ? d.label(e) : e.name;
  }

  function run(alt = false) {
    const it = items[idx];
    if (!it) return;
    if (it.kind === 'action' && it.a.disabled) return; // a disabled row (e.g. 'Sign off all — nobody is done') stays put
    api.close(false);
    if (it.kind === 'agent') {
      const goTo = scope === 'go' ? !alt : alt;
      if (goTo) d.hooks.goTo(it.e.id); else d.hooks.open(it.e.id);
    } else it.a.run();
  }

  input.addEventListener('input', () => { idx = 0; build(); });
  // Tab / Shift+Tab cycle the scope (the palette scope has no Tab binding, so the key reaches the input)
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab' || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    ev.preventDefault();
    const n = PALETTE_SCOPES.length;
    setScope(PALETTE_SCOPES[(PALETTE_SCOPES.indexOf(scope) + (ev.shiftKey ? n - 1 : 1)) % n]);
  });

  const api = {
    get isOpen() { return isOpen; },
    get scope() { return scope; },
    input,
    open(prefill = '', o: { scope?: PaletteScope } = {}) {
      restoreFocus = document.activeElement;
      isOpen = true;
      anchorBelowHud(wrap);
      wrap.classList.add('show');
      input.value = prefill;
      idx = 0;
      scope = isScope(o.scope) ? o.scope : 'find';
      scopeEl.set(scope);
      renderFoot();
      build();
      input.focus();
    },
    close(restore = true) {
      if (!isOpen) return;
      isOpen = false;
      wrap.classList.remove('show');
      if (document.activeElement === input) input.blur();
      if (restore && restoreFocus !== document.body) refocus(restoreFocus);
      d.hooks.closed();
    },
    action(name: string): boolean {
      switch (name) {
        case 'down': idx = Math.min(items.length - 1, idx + 1); render(); return true;
        case 'up': idx = Math.max(0, idx - 1); render(); return true;
        case 'run': run(false); return true;
        case 'runAlt': run(true); return true;
        case 'close': if (input.value) { input.value = ''; build(); } else api.close(); return true;
      }
      return false;
    },
  };
  return api;
}
