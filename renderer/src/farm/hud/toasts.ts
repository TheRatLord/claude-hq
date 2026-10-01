/**
 * Toasts (new letters, server toasts, confirmations), bottom-right above the key hints (`ui.say` lines are anchored
 * speech bubbles: anchors.ts). Rate-limited per key; at most three on screen (two while a panel is open);
 * clicking a farmer toast opens its terminal, any other toast dismisses it.
 */
import type { Letter } from '../model/types.ts';
import { ICONS, LETTER_ICON, icon } from './icons.ts';
import { h, type HudCtx, type ToastSpec } from './ctx.ts';
import { letterTitle } from './format.ts';

const MAX = 3;
const SAME_KEY_MS = 8_000;

export interface Toasts { el: HTMLElement; push(t: ToastSpec): void; watchLetters(letters: readonly Letter[]): void }

export function createToasts(ctx: HudCtx): Toasts {
  const el = h('div.vh-toasts', { 'aria-live': 'polite', 'data-testid': 'toasts' });
  const recent = new Map<string, number>();

  function push(t: ToastSpec): void {
    if (!ctx.prefs.toasts && t.level !== 'error' && t.level !== 'warn') return;
    const key = t.key ?? t.text;
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < SAME_KEY_MS) return;
    recent.set(key, now);
    if (recent.size > 200) for (const [k, v] of recent) if (now - v > SAME_KEY_MS) recent.delete(k);
    const node = h(`div.vh-toast.${t.level ?? 'info'}${t.id ? '.click' : ''}`, { role: 'status' },
      icon(t.icon ?? (t.level === 'error' || t.level === 'warn' ? ICONS.bell : LETTER_ICON.news)),
      h('div', null, h('div.t', { text: t.text }), t.sub ? h('div.s', { text: t.sub }) : null));
    if (t.id) { const id = t.id; node.title = 'Open the terminal'; node.addEventListener('click', () => { ctx.openTerminal(id); dismiss(); }); }
    else { node.title = 'Dismiss'; node.addEventListener('click', () => dismiss()); }
    el.prepend(node);
    // fewer while a big panel is up: the corner must not climb over it
    const max = ctx.panels.modal ? 2 : MAX;
    while (el.childElementCount > max) el.lastElementChild?.remove();
    let gone = false;
    const dismiss = () => { if (gone) return; gone = true; node.classList.add('out'); setTimeout(() => node.remove(), 420); };
    setTimeout(dismiss, t.ms ?? (t.level === 'error' ? 8000 : 4800));
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
    if (!primed && ctx.state()?.link !== 'connecting') primed = letters.length > 0 || (ctx.state()?.farmers.size ?? 0) > 0;
    // while a big panel is up only asks and errors pop (everything else is in the mailbox)
    const covered = ctx.panels.modal && !ctx.panels.current()?.light;
    for (const l of fresh.reverse()) {
      if (l.kind === 'news' || l.kind === 'subagents') continue;
      if (covered && l.kind !== 'needs-you' && l.kind !== 'error') continue;
      push({
        text: letterTitle(l), sub: [l.plotLabel, l.body].filter(Boolean).join(' · '), icon: LETTER_ICON[l.kind], level: LEVEL[l.kind] ?? 'info',
        id: l.kind === 'left' ? undefined : l.farmerId, key: `${l.kind}|${l.farmerId}`,
      });
      if (l.kind === 'needs-you') ctx.sfx('mail');
    }
  }
  return { el, push, watchLetters };
}
