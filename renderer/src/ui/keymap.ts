// @pure
/**
 * The ONE key table (§8.2): every scope's bindings + the Leader chord table. The key handler (ui/keys.ts) dispatches
 * from these tables and the `?` overlay renders them, so the two can never drift.
 *
 * Key spec syntax: `Mod+Mod+Key`.
 *   Mods: `Primary` (Ctrl on Linux/Windows, Cmd on macOS), `Ctrl` (the literal Ctrl key), `Alt`, `Shift`,
 *         `QA` (quick-answer modifier: Alt on Linux/Windows, Ctrl on macOS, §8.2.2).
 *   Keys: a letter `E` (matched by event.code KeyE), a digit `1` or range `1-9` (Digit1…9, arg = n), a named key
 *         (`Enter`, `Escape`, `Tab`, `ArrowUp`, `PageUp`, `Home`, `F1`, `Insert`, …) or a single punctuation char
 *         (`/`, `?`, `[`, `]`), which matches `event.key` (layout-aware) and ignores Shift.
 * Owner: UI.
 */

/** Focus scopes (§8.2). Exactly one is active. */
export const SCOPES = Object.freeze(['world-locked', 'world-unlocked', 'roster', 'input', 'palette', 'serve', 'xterm'] as const);
export type Scope = (typeof SCOPES)[number];
/** The binding tables (both world scopes share `world`). */
export type Table = 'world' | 'roster' | 'input' | 'palette' | 'serve' | 'xterm';

/** One row of a scope table or of the Leader chord table. `action: null` = info-only row. */
export interface Binding {
  keys: string;
  action: string | null;
  desc: string;
  /** platform-specific row (xterm table) */
  mac?: boolean;
  /** Leader chords: matched by event.code */
  code?: string;
  shift?: boolean;
  arg?: number;
  hidden?: boolean;
}
type BindingExtra = Partial<Pick<Binding, 'mac' | 'code' | 'shift' | 'arg' | 'hidden'>>;
/** A Leader chord always has its event.code and a real action. */
export type Chord = Binding & { code: string; action: string };

/** event.code values the world (walking, verbs) uses: the Leader chord table must be disjoint from these. */
export const WORLD_CODES = Object.freeze([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyG', 'KeyF', 'KeyQ', 'KeyR', 'KeyT', 'KeyV', 'KeyB', 'KeyP', 'KeyM',
  'KeyH', 'KeyN', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
  'Enter', 'Escape',
]);
/** Letters whose Ctrl-chord Chrome eats before the page sees it (Ctrl may still be held after a Leader tap). */
export const BROWSER_EATEN_CODES = Object.freeze(['KeyW', 'KeyT', 'KeyN']);

const b = (keys: string, action: string, desc: string, extra: BindingExtra = {}): Binding => Object.freeze({ keys, action, desc, ...extra });
/** Info-only rows (shown in the overlay, handled elsewhere, e.g. by the player controller). */
const info = (keys: string, desc: string): Binding => Object.freeze({ keys, action: null, desc });

const WORLD = [
  info('W A S D / Arrows', 'walk (Shift sprints)'),
  b('Enter', 'openLast', 'focus last terminal (or the oldest blocked / roster)'),
  b('Shift+Enter', 'drawerCollapse', 'drawer collapse ↔ expand'),
  b('Tab', 'rosterOpen', 'roster'),
  b('E', 'interact', 'open the aimed agent’s terminal'),
  b('G', 'highFive', 'high-five the aimed agent (= sign off when done) · else go to the selected one'),
  b('F', 'follow', 'follow the aimed / selected agent'),
  b('B', 'inbox', 'Blocked Inbox'),
  b('Shift+B', 'triage', 'triage: everyone who needs you, one card at a time'),
  b('T', 'talk', 'talk: one-line prompt to the aimed / selected agent (confirm before sending)'),
  b('Q', 'pat', 'pat the aimed agent'),
  b('R', 'summon', 'summon the aimed / selected agent to you'),
  b('Shift+N', 'rename', 'rename the aimed / selected agent (HQ only)'),
  b('M', 'map', 'office map (overview)'),
  b('1-9', 'pinOpen', 'pinned agent n → terminal'),
  b('Shift+1-9', 'pinAssign', 'pin the aimed agent to slot n'),
  b('QA+1-9', 'quickAnswer', 'quick-answer the aimed blocked agent (confirm with Enter)'),
  b('Primary+K', 'palette', 'command palette'),
  b('/', 'palette', 'command palette'),
  b('Escape', 'clearSelection', 'clear selection'),
  b('?', 'keys', 'key overlay'),
  b('F1', 'help', 'help: how HQ works, legend, tour'),
  b('H', 'help', 'help: how HQ works, legend, tour'),
];

const ROSTER = [
  b('ArrowDown', 'down', 'next row'),
  b('J', 'down', 'next row'),
  b('ArrowUp', 'up', 'previous row'),
  b('K', 'up', 'previous row'),
  b('ArrowLeft', 'left', 'collapse group / jump to its header'),
  b('ArrowRight', 'right', 'expand group'),
  b('Enter', 'open', 'open terminal'),
  b('Shift+Enter', 'goTo', 'go to'),
  b('Primary+Enter', 'follow', 'follow'),
  b('G', 'goTo', 'go to'),
  b('F', 'follow', 'follow'),
  b('S', 'signOff', 'sign off (done rows)'),
  b('A', 'answer', 'answer (blocked rows)'),
  b('T', 'talk', 'talk: one-line prompt (confirm before sending)'),
  b('Shift+N', 'rename', 'rename (HQ only)'),
  b('N', 'newShell', 'new shell (a new herdr tab; needs --allow-mutations)'), // [UI roster r1, cross-owner] the footer's [N] New shell
  b('P', 'pin', 'pin / unpin'),
  b('/', 'search', 'search (or just type: letters filter until ↑↓ / a click picks a row, then they are verbs)'),
  b('PageUp', 'prevGroup', 'previous group'),
  b('[', 'prevGroup', 'previous group'),
  b('PageDown', 'nextGroup', 'next group'),
  b(']', 'nextGroup', 'next group'),
  b('Home', 'first', 'first row'),
  b('End', 'last', 'last row'),
  b('B', 'inbox', 'blocked agents (filter)'),
  b('1-9', 'pinOpen', 'pinned agent n → terminal'),
  b('Shift+1-9', 'pinAssign', 'pin selected row to slot n'),
  b('Alt+1-7', 'groupBy', 'group by State · Workspace · Tab · Project · Directory · Kind · Tool'),
  b('Alt+C', 'compact', 'compact rows'),
  b('Primary+K', 'palette', 'command palette'),
  b('Escape', 'close', 'close roster'),
  b('Tab', 'close', 'close roster → world'),
  b('?', 'keys', 'key overlay'),
];

const INPUT = [
  b('ArrowDown', 'toList', 'to the results'),
  b('Enter', 'toList', 'to the best match (then G go · Enter open)'),
  // [UI fix r3, playtest "footer says G go but G types g"] act on the highlighted best match without leaving the field
  b('Shift+Enter', 'goTo', 'go to the highlighted match'),
  b('Tab', 'toList', 'to the results'),
  b('Escape', 'clearOrClose', 'clear, then close'),
  b('Primary+K', 'palette', 'command palette'),
];

const PALETTE = [
  b('ArrowDown', 'down', 'next result'),
  b('ArrowUp', 'up', 'previous result'),
  b('Enter', 'run', 'run'),
  b('Shift+Enter', 'runAlt', 'go to (agents)'),
  b('Escape', 'close', 'clear, then close'),
  info('Tab / Shift+Tab', 'scope: Find · Go · Do (cmdk.ts handles it on the input)'),
];

/** Serve card / Blocked Inbox (§6.8.1, §8.8): the focused inbox card. 1–9 are active inside the card only. */
const SERVE = [
  b('ArrowDown', 'down', 'next option / row'),
  b('S', 'down', 'next option / row'),
  b('J', 'down', 'next option / row'),
  b('ArrowUp', 'up', 'previous option / row'),
  b('W', 'up', 'previous option / row'),
  b('K', 'up', 'previous option / row'),
  b('1-9', 'option', 'jump to option n (then Enter sends; Done tab: select row n)'),
  b('Enter', 'choose', 'choose / confirm send (Done tab: sign off)'),
  b('Space', 'choose', 'choose / confirm send'),
  b('E', 'choose', 'choose / confirm send'),
  b('O', 'openTerm', 'open terminal'),
  b('G', 'goThere', 'go there'),
  b('ArrowRight', 'next', 'next card'),
  b('ArrowLeft', 'prev', 'previous card'),
  b('Tab', 'tab', 'Blocked ↔ Done'),
  b('A', 'signOffAll', 'sign off all (Done tab)'),
  b('Primary+K', 'palette', 'command palette'),
  b('B', 'close', 'close the inbox'),
  b('Escape', 'close', 'back (cancel confirm) / leave'),
  b('?', 'keys', 'key overlay'),
];

/** xterm scope: everything goes to the pane except these (and the Leader). Platform-specific rows carry `mac`. */
const XTERM = [
  info('Leader (tap)', 'back to the world'),
  b('Ctrl+Insert', 'copy', 'copy selection', { mac: false }),
  b('Ctrl+Shift+C', 'copy', 'copy selection (best effort)', { mac: false }),
  b('Shift+Insert', 'pasteNative', 'paste', { mac: false }),
  b('Ctrl+Shift+V', 'pasteNative', 'paste', { mac: false }),
  b('Primary+C', 'copy', 'copy selection', { mac: true }),
  b('Primary+V', 'pasteNative', 'paste', { mac: true }),
  b('Primary+K', 'palette', 'command palette', { mac: true }),
  b('Primary+=', 'fontUp', 'font larger', { mac: true }),
  b('Primary+-', 'fontDown', 'font smaller', { mac: true }),
  b('Primary+0', 'fontReset', 'font reset', { mac: true }),
];

/** Scope → binding list. Both world scopes share one table (the handler gets the scope). */
export const BINDINGS = Object.freeze({
  world: Object.freeze(WORLD),
  roster: Object.freeze(ROSTER),
  input: Object.freeze(INPUT),
  palette: Object.freeze(PALETTE),
  serve: Object.freeze(SERVE),
  xterm: Object.freeze(XTERM),
});

/** Scope name → BINDINGS key. */
export const tableFor = (scope: string): Table => (scope === 'world-locked' || scope === 'world-unlocked' ? 'world' : (scope as Table));

/**
 * Leader chord table (§8.2). Matched by event.code while Leader is held or ≤ 400 ms after its keydown.
 * `shift:true` rows only match with Shift; rows without `shift` match either way unless a shift row claims the code.
 */
const chord = (keys: string, action: string, desc: string, extra: BindingExtra & { code: string }): Chord => Object.freeze({ keys, action, desc, ...extra });
export const LEADER_CHORDS: readonly Chord[] = Object.freeze([
  chord(',', 'tabPrev', 'previous tab', { code: 'Comma' }),
  chord('.', 'tabNext', 'next tab', { code: 'Period' }),
  chord('Shift+X', 'tabCloseOthers', 'close all tabs but this', { code: 'KeyX', shift: true }),
  chord('X', 'tabClose', 'close tab', { code: 'KeyX' }),
  chord('U', 'nextBlocked', 'next blocked terminal', { code: 'KeyU' }),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => chord(String(n), 'pinOpen', n === 1 ? 'pinned agent 1–9' : '', { code: `Digit${n}`, arg: n, hidden: n > 1 })),
  chord('Z', 'fullscreen', 'fullscreen (zoom)', { code: 'KeyZ' }),
  chord('I', 'modeToggle', 'Peek ↔ Control', { code: 'KeyI' }),
  chord('L', 'roster', 'roster', { code: 'KeyL' }),
  chord('K', 'palette', 'command palette', { code: 'KeyK' }),
  chord('C', 'copyRecent', 'copy recent output', { code: 'KeyC' }),
  chord('Y', 'pasteClipboard', 'paste from clipboard', { code: 'KeyY' }),
  chord('[', 'history', 'scrollback history', { code: 'BracketLeft' }),
  chord('+', 'fontUp', 'font larger', { code: 'Equal' }),
  chord('+', 'fontUp', '', { code: 'NumpadAdd', hidden: true }),
  chord('-', 'fontDown', 'font smaller', { code: 'Minus' }),
  chord('-', 'fontDown', '', { code: 'NumpadSubtract', hidden: true }),
  chord('0', 'fontReset', 'font reset', { code: 'Digit0' }),
  chord('J', 'journal', 'recent HQ actions', { code: 'KeyJ' }),
  chord('?', 'keys', 'key overlay', { code: 'Slash' }),
  chord(';', 'literalCtrl', 'then a letter: send Ctrl+letter', { code: 'Semicolon' }),
  chord('Leader', 'literalLeader', 'send a literal Ctrl+`', { code: 'Backquote' }),
]);

/** Every action name a scope table / chord table uses (ui/keys.ts asserts it has a handler for each). */
export function actionNames(): Record<Table | 'leader', string[]> {
  const names = (list: readonly Binding[]) => [...new Set(list.map((x) => x.action).filter((a): a is string => !!a))];
  return {
    world: names(BINDINGS.world), roster: names(BINDINGS.roster), input: names(BINDINGS.input), palette: names(BINDINGS.palette),
    serve: names(BINDINGS.serve), xterm: names(BINDINGS.xterm), leader: [...new Set(LEADER_CHORDS.map((x) => x.action))],
  };
}

// ---------------------------------------------------------------------------------------------
// Parsing + matching

const NAMED = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
  'Home', 'End', 'Insert', 'Delete', 'Backspace', 'Space', 'F1', 'F2', 'F3', 'F9']);
const MODS = new Set(['Primary', 'Ctrl', 'Alt', 'Shift', 'QA']);

export interface ParsedSpec { mods: Set<string>; code: string | null; key: string | null; range: [number, number] | null }
/** The event fields the matchers read (a KeyboardEvent, or a test double). */
export type KeyEventLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Parses a spec such as 'Shift+1-9', 'Primary+K' or '?'. */
export function parseSpec(spec: string): ParsedSpec {
  // split on '+' but keep a trailing literal '+' / '-' / '=' key
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (ch === '+' && cur && i < spec.length - 1) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) parts.push(cur);
  const key = parts.pop() ?? '';
  const mods = new Set(parts);
  for (const m of mods) if (!MODS.has(m)) throw new Error(`keymap: unknown modifier ${m} in ${spec}`);
  let m: RegExpExecArray | null;
  if ((m = /^(\d)-(\d)$/.exec(key))) return { mods, code: null, key: null, range: [+m[1], +m[2]] };
  if (/^[A-Z]$/.test(key)) return { mods, code: `Key${key}`, key: null, range: null };
  if (/^\d$/.test(key)) return { mods, code: `Digit${key}`, key: null, range: null };
  if (NAMED.has(key)) return { mods, code: key, key: null, range: null };
  if (key.length === 1) return { mods, code: null, key, range: null };
  throw new Error(`keymap: bad key spec ${spec}`);
}

/** Normalised modifier set of a keyboard event for a platform. */
export function eventMods(e: Pick<KeyEventLike, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, mac: boolean): Set<string> {
  const s = new Set<string>();
  if (mac ? e.metaKey : e.ctrlKey) s.add('Primary');
  if (mac && e.ctrlKey) s.add('Ctrl');
  if (!mac && e.metaKey) s.add('Meta');
  if (e.altKey) s.add('Alt');
  if (e.shiftKey) s.add('Shift');
  return s;
}

/** Resolve QA / Ctrl aliases of a spec's modifier set for a platform. */
function specMods(mods: Iterable<string>, mac: boolean): Set<string> {
  const s = new Set<string>();
  for (const m of mods) {
    if (m === 'QA') s.add(mac ? 'Ctrl' : 'Alt');
    else if (m === 'Ctrl') s.add(mac ? 'Ctrl' : 'Primary');
    else s.add(m);
  }
  return s;
}

const cache = new Map<string, ParsedSpec>();
const parsed = (spec: string): ParsedSpec => {
  let p = cache.get(spec);
  if (!p) cache.set(spec, (p = parseSpec(spec)));
  return p;
};

/** Does a binding spec match this event? Returns `{arg}` (digit ranges) or null. */
export function matchSpec(spec: string, e: KeyEventLike, mac: boolean): { arg: number | null } | null {
  const p = parsed(spec);
  const want = specMods(p.mods, mac);
  const have = eventMods(e, mac);
  if (p.key) {
    // punctuation by produced character; Shift is implied by the layout
    have.delete('Shift');
    want.delete('Shift');
    if (e.key !== p.key) return null;
  } else if (p.range) {
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (!m || +m[1] < p.range[0] || +m[1] > p.range[1]) return null;
    if (!sameSet(want, have)) return null;
    return { arg: +m[1] };
  } else if (e.code !== p.code) return null;
  return sameSet(want, have) ? { arg: null } : null;
}

const sameSet = (a: Set<string>, c: Set<string>) => a.size === c.size && [...a].every((x) => c.has(x));

/** First binding of `scope` (one of SCOPES) that matches the event. */
export function resolveKey(scope: string, e: KeyEventLike, mac: boolean): { action: string; arg: number | null; binding: Binding } | null {
  const list: readonly Binding[] | undefined = BINDINGS[tableFor(scope)];
  if (!list) return null;
  for (const x of list) {
    if (!x.action) continue;
    if (x.mac !== undefined && x.mac !== mac) continue;
    const m = matchSpec(x.keys, e, mac);
    if (m) return { action: x.action, arg: m.arg, binding: x };
  }
  return null;
}

/** Leader chord for an event (by event.code; modifiers other than Shift are ignored since Ctrl may still be held). */
export function resolveChord(e: Pick<KeyEventLike, 'code' | 'shiftKey'>): { action: string; arg: number | null; chord: Chord } | null {
  for (const c of LEADER_CHORDS) {
    if (c.code !== e.code) continue;
    if (c.shift && !e.shiftKey) continue;
    return { action: c.action, arg: c.arg ?? null, chord: c };
  }
  return null;
}

/** Is this event the Leader key? `leaderKey` setting: 'Ctrl+`' (default) or e.g. 'F9' / 'Ctrl+Space'. F9 always works. */
export function isLeader(e: Pick<KeyEventLike, 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>, setting: string | null | undefined = 'Ctrl+`'): boolean {
  if (e.code === 'F9' && !e.ctrlKey && !e.altKey && !e.metaKey) return true;
  const s = String(setting || 'Ctrl+`');
  const parts = s.split('+');
  const key = parts.pop() || '`';
  const code = key === '`' ? 'Backquote' : key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
  const needCtrl = parts.includes('Ctrl');
  const needAlt = parts.includes('Alt');
  return e.code === code && !!e.ctrlKey === needCtrl && !!e.altKey === needAlt && !e.metaKey;
}

// ---------------------------------------------------------------------------------------------
// Overlay rows (the `?` overlay renders exactly these)

const DISPLAY: Record<'mac' | 'other', Record<string, string>> = {
  mac: { Primary: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', QA: '⌃' },
  other: { Primary: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', QA: 'Alt' },
};
const KEYNAME: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', PageUp: 'PgUp', PageDown: 'PgDn' };

/** Human label for a spec on a platform. */
export function keyLabel(spec: string, mac: boolean): string {
  if (spec.includes(' ') || spec === 'Leader') return spec;
  let p: ParsedSpec;
  try { p = parseSpec(spec); } catch { return spec; }
  const d = mac ? DISPLAY.mac : DISPLAY.other;
  const mods = [...p.mods].map((m) => d[m] ?? m);
  const code = p.code ?? ''; // a parsed spec has a range, a key or a code
  const key = p.range ? `${p.range[0]}–${p.range[1]}` : p.key ?? (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : KEYNAME[code] ?? code);
  return mac ? mods.join('') + key : [...mods, key].join('+');
}

export interface OverlayRow { keys: string; desc: string; action: string | null }

/** Rows for the `?` overlay of a scope (xterm scope also lists the Leader chords). */
export function overlayRows(scope: string, mac: boolean, leaderLabel = 'Ctrl+`'): OverlayRow[] {
  const t = tableFor(scope);
  const list: readonly Binding[] = BINDINGS[t] ?? [];
  const rows: OverlayRow[] = [];
  const seen = new Map<string, OverlayRow>();
  for (const x of list) {
    if (x.mac !== undefined && x.mac !== mac) continue;
    const label = keyLabel(x.keys, mac);
    const k = `${x.action}|${x.desc}`;
    const dup = seen.get(k);
    if (x.action && dup) { dup.keys += ` / ${label}`; continue; }
    const row = { keys: label, desc: x.desc, action: x.action };
    if (x.action) seen.set(k, row);
    rows.push(row);
  }
  rows.push({ keys: `${leaderLabel} / F9`, desc: t === 'xterm' ? 'Leader (tap: world · hold + key: chord)' : 'Leader (tap: last terminal · hold + key: chord)', action: null });
  if (t === 'xterm' || t === 'world' || t === 'roster') {
    for (const c of LEADER_CHORDS) if (!c.hidden) rows.push({ keys: `Leader ${c.arg ? '1–9' : c.keys}`, desc: c.desc, action: c.action });
  }
  return rows;
}
