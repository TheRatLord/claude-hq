/**
 * Toasts (new letters, server toasts, confirmations), bottom-right above the key hints (`ui.say` lines are anchored
 * speech bubbles: anchors.ts). Calm by design: short-lived, at most two on screen (one while a big panel is open),
 * rate-limited per key, and **coalesced**: a toast whose group (`ToastSpec.group`, else the key's first `|` segment)
 * is already showing updates that toast in place with a ×n count instead of stacking a new one. A background toast (a
 * letter arriving) never pushes off one that confirms something you just did (Settings → notifications on, a sale…):
 * the corner may hold one extra for those few seconds. Clicking a farmer toast opens its terminal, any other toast
 * dismisses it; hovering one holds it.
 */
import type { Letter } from '../model/types.ts';
import { ICONS, LETTER_ICON, icon } from './icons.ts';
import { h, type HudCtx, type ToastSpec } from './ctx.ts';
import { letterTitle } from './format.ts';

const MAX = 2;
const SAME_KEY_MS = 8_000;
/** default lifetimes (ms): long enough to read a line, short enough to keep the corner quiet */
const LIFE = { error: 7000, warn: 5500, ask: 5500, other: 4000 } as const;

export interface Toasts { el: HTMLElement; push(t: ToastSpec, bg?: boolean): void; watchLetters(letters: readonly Letter[]): void }

interface Live { node: HTMLElement; group: string; n: number; timer: ReturnType<typeof setTimeout> | undefined; ms: number; gone: boolean; hover: boolean; bg: boolean }

export function createToasts(ctx: HudCtx): Toasts {
  const el = h('div.vh-toasts', { 'aria-live': 'polite', 'data-testid': 'toasts' });
  const recent = new Map<string, number>();
  const live: Live[] = [];

  const groupOf = (t: ToastSpec) => t.group ?? (t.key && t.key.includes('|') ? t.key.slice(0, t.key.indexOf('|')) : t.key ?? t.text);
  // Settings → Interface → toast duration scales every lifetime (asks and errors keep their longer base)
  const lifeOf = (t: ToastSpec) => (t.ms ?? (t.level === 'error' ? LIFE.error : t.level === 'warn' ? LIFE.warn : t.level === 'ask' ? LIFE.ask : LIFE.other)) * (ctx.prefs.toastK || 1);

  function dismiss(x: Live): void {
    if (x.gone) return;
    x.gone = true;
    clearTimeout(x.timer);
    const i = live.indexOf(x);
    if (i >= 0) live.splice(i, 1);
    x.node.classList.add('out');
    setTimeout(() => x.node.remove(), 420);
  }
  function arm(x: Live): void {
    clearTimeout(x.timer);
    x.timer = setTimeout(() => { if (x.hover) arm(x); else dismiss(x); }, x.ms);
  }
  function fill(x: Live, t: ToastSpec): void {
    const lvl = t.level ?? 'info';
    x.node.className = `vh-toast ${lvl}${t.id ? ' click' : ''}`;
    x.node.replaceChildren(
      icon(t.icon ?? (lvl === 'error' || lvl === 'warn' ? ICONS.bell : LETTER_ICON.news)),
      h('div', null, h('div.t', { text: t.text }), t.sub ? h('div.s', { text: t.sub }) : null),
      ...(x.n > 1 ? [h('span.n', { text: `×${x.n}`, title: `${x.n} of these in a row` })] : []));
    x.node.title = t.id ? 'Open the terminal' : 'Dismiss';
    x.node.onclick = () => { if (t.id) ctx.openTerminal(t.id); dismiss(x); };
  }

  /** `bg`: the world's news (letters), not a reply to something the player did */
  function push(t: ToastSpec, bg = false): void {
    if (!ctx.prefs.toasts && t.level !== 'error' && t.level !== 'warn') return;
    const key = t.key ?? t.text;
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < SAME_KEY_MS) return;
    recent.set(key, now);
    if (recent.size > 200) for (const [k, v] of recent) if (now - v > SAME_KEY_MS) recent.delete(k);
    const group = groupOf(t);
    const same = live.find((x) => x.group === group && !x.gone);
    if (same) {
      // coalesce: refresh the one on screen (newest text, ×n), bump it to the top, restart its clock
      same.n++;
      same.ms = Math.max(same.ms, lifeOf(t));
      fill(same, t);
      same.node.classList.remove('bump'); void same.node.offsetWidth; same.node.classList.add('bump');
      if (el.firstElementChild !== same.node) el.prepend(same.node);
      live.splice(live.indexOf(same), 1); live.unshift(same);
      arm(same);
      return;
    }
    const node = h('div.vh-toast', { role: 'status' });
    const x: Live = { node, group, n: 1, timer: undefined, ms: lifeOf(t), gone: false, hover: false, bg };
    node.addEventListener('pointerenter', () => { x.hover = true; });
    node.addEventListener('pointerleave', () => { x.hover = false; });
    fill(x, t);
    el.prepend(node);
    live.unshift(x);
    // fewer while a big panel is up: the corner must not climb over it
    const max = ctx.panels.modal && !ctx.panels.current()?.light ? 1 : MAX;
    // make room: the oldest background toast goes first; your own confirmations only make way for each other, and a
    // background one squeezes in beside them (one over the limit, for their few seconds) rather than pushing them off
    while (live.length > max) {
      const older = live.slice(1);
      const victim = [...older].reverse().find((o) => o.bg) ?? (x.bg && live.length <= max + 1 ? null : older[older.length - 1]);
      if (!victim) break;
      dismiss(victim);
    }
    arm(x);
  }

  // new letters → toasts (the first look seeds silently: nothing "arrived" on page load)
  const seen = new Set<string>();
  let primed = false;
  const LEVEL: Partial<Record<Letter['kind'], ToastSpec['level']>> = {
    'needs-you': 'ask', finished: 'good', 'test-pass': 'good', commit: 'good', error: 'error', 'test-fail': 'warn', struggle: 'warn',
  };
  function watchLetters(letters: readonly Letter[]): void {
    const fresh: Letter[] = [];
    for (const l of letters) if (!seen.has(l.id)) { seen.add(l.id); if (primed) fresh.push(l); }
    // the mailbox is capped, the ids seen all day are not: keep only the ones still in it
    if (seen.size > letters.length * 2 + 200) { const keep = new Set(letters.map((l) => l.id)); for (const id of seen) if (!keep.has(id)) seen.delete(id); }
    if (!primed && ctx.state()?.link !== 'connecting') primed = letters.length > 0 || (ctx.state()?.farmers.size ?? 0) > 0;
    // while a big panel is up only asks and errors pop (everything else is in the mailbox)
    const covered = ctx.panels.modal && !ctx.panels.current()?.light;
    for (const l of fresh.reverse()) {
      if (l.kind === 'news' || l.kind === 'subagents') continue;
      if (covered && l.kind !== 'needs-you' && l.kind !== 'error') continue;
      push({
        text: letterTitle(l), sub: [l.plotLabel, l.body].filter(Boolean).join(' · '), icon: LETTER_ICON[l.kind], level: LEVEL[l.kind] ?? 'info',
        id: l.kind === 'left' ? undefined : l.farmerId, key: `${l.kind}|${l.farmerId}`,
      }, true);
      if (l.kind === 'needs-you') ctx.sfx('mail');
    }
  }
  return { el, push, watchLetters };
}
