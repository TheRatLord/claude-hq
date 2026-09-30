/**
 * Crosshair + interaction prompt: "[E] Talk to Flint", "[F] Open terminal", and for farmers a one-line status
 * ("needs you: Allow Bash?"). Updated per frame but only touches the DOM when the target or its text changes.
 */
import type { Interactable } from '../scene/context.ts';
import { farmerLine, nice } from './format.ts';
import { h, type HudCtx } from './ctx.ts';

export interface Prompt { cross: HTMLElement; el: HTMLElement; update(): void; focused(): Interactable | null }

export function createPrompt(ctx: HudCtx): Prompt {
  const cross = h('div.vh-cross', { 'aria-hidden': 'true' });
  const verbEl = h('span');
  const labelEl = h('b', { style: { color: '#ffd97a' } });
  const main = h('div.row', null, h('kbd.vh-k', { text: 'E' }), verbEl, labelEl);
  const alt = h('div.row.alt', null, h('kbd.vh-k', { text: 'F' }), h('span'));
  const sub = h('div.sub');
  const el = h('div.vh-prompt.hide', { 'data-testid': 'interact-prompt', 'aria-live': 'polite' }, main, alt, sub);
  let sig = '';
  let cur: Interactable | null = null;

  function update(): void {
    const b = ctx.b;
    const hidden = !b || ctx.panels.modal;
    cur = hidden ? null : safe(() => b.interact.focused());
    cross.classList.toggle('hide', hidden);
    cross.classList.toggle('on', !!cur);
    let verb = '', label = '', altText = '', subText = '', ask = false;
    if (cur) {
      const c = cur;
      verb = c.verb;
      label = safe(() => c.label()) ?? '';
      if (c.kind === 'farmer' || c.kind === 'helper') { const f = ctx.farmer(c.id) ?? ctx.helper(c.id); if (f && label.toLowerCase().includes(f.name.toLowerCase())) label = label.split(f.name).join(nice(f.name)); }
      altText = c.alt?.verb ?? (c.kind === 'farmer' || c.kind === 'helper' ? 'Open terminal' : '');
      if (c.kind === 'farmer') {
        const f = ctx.farmer(c.id);
        if (f) { subText = f.needsYou ? `needs you: ${f.question ?? 'waiting'}` : `${nice(f.name)} · ${farmerLine(f)}`; ask = f.needsYou; }
      }
    }
    const next = `${cur?.id ?? ''}|${verb}|${label}|${altText}|${subText}`;
    if (next === sig) return;
    sig = next;
    el.classList.toggle('hide', !cur);
    verbEl.textContent = verb;
    labelEl.textContent = label;
    alt.style.display = altText ? '' : 'none';
    (alt.lastElementChild as HTMLElement).textContent = altText;
    sub.textContent = subText;
    sub.style.display = subText ? '' : 'none';
    sub.classList.toggle('ask', ask);
  }
  return { cross, el, update, focused: () => cur };
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch (e) { console.warn('[hud] interactable threw', e); return null; }
}
