/**
 * Crosshair + the interaction tag: a compact card anchored beside the focused character or object (never over its
 * face, never in the screen centre), showing who / what it is, the key caps with their verbs ("[E] Talk to",
 * "[F] Open terminal") and a hint line ("needs you: Allow Bash?", "Postmaster · opens the mailbox"). The text only
 * touches the DOM when the target or its text changes; the position is a transform written each frame.
 */
import * as THREE from 'three';
import type { Interactable } from '../scene/context.ts';
import { farmerLine } from './format.ts';
import { h, type HudCtx } from './ctx.ts';

export interface Prompt {
  cross: HTMLElement;
  el: HTMLElement;
  /** per frame; returns the tag's screen rect (for the speech bubbles to keep clear of), or null when hidden */
  update(cam: THREE.Camera | null, fit?: (x: number, y: number, w: number, h: number, out: { x: number; y: number }) => boolean): { x: number; y: number; w: number; h: number } | null;
  focused(): Interactable | null;
}

/** rough half-width (m) of each kind of target, so the tag clears the silhouette */
const RADIUS: Record<Interactable['kind'], number> = { farmer: 0.62, villager: 0.6, helper: 0.5, animal: 0.55, structure: 0.35, prop: 0.3, plot: 0.6 };
const KIND_NAME: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', agent: 'Agent' };

export function createPrompt(ctx: HudCtx): Prompt {
  const cross = h('div.vh-cross', { 'aria-hidden': 'true' });
  const nameEl = h('b');
  const roleEl = h('span.role');
  const verbEl = h('span');
  const altVerb = h('span');
  const main = h('span.act', null, h('kbd.vh-k', { text: 'E' }), verbEl);
  const alt = h('span.act.alt', null, h('kbd.vh-k', { text: 'F' }), altVerb);
  const sub = h('div.sub');
  const el = h('div.vh-prompt.hide', { 'data-testid': 'interact-prompt', 'aria-live': 'polite' },
    h('div.who', null, nameEl, roleEl), h('div.acts', null, main, alt), sub);
  let sig = '';
  let cur: Interactable | null = null;
  let w = 0, hgt = 0, measure = false;
  let side = 1; // +1 right of the target, -1 left (sticky, so it does not flip-flop)
  let ax = NaN, ay = NaN, flipped = false;
  const rect = { x: 0, y: 0, w: 0, h: 0 };
  const v = new THREE.Vector3(), r = new THREE.Vector3(), right = new THREE.Vector3();

  function text(): void {
    const b = ctx.b;
    const hidden = !b || ctx.panels.modal;
    cur = hidden ? null : safe(() => b.interact.focused());
    cross.classList.toggle('hide', hidden);
    cross.classList.toggle('on', !!cur);
    let verb = '', label = '', role = '', altText = '', subText = '', ask = false;
    if (cur) {
      const c = cur;
      verb = c.verb;
      label = safe(() => c.label()) ?? '';
      altText = c.alt?.verb ?? (c.kind === 'farmer' || c.kind === 'helper' ? 'Open terminal' : '');
      if (c.hint) subText = safe(() => c.hint!()) ?? '';
      if (c.kind === 'farmer') {
        const f = ctx.farmer(c.id);
        if (f) {
          const field = ctx.plot(f.plotId)?.label;
          role = field && field !== f.project ? `${KIND_NAME[f.kind] ?? f.kind} · ${field}` : KIND_NAME[f.kind] ?? f.kind;
          subText = f.needsYou ? `needs you: ${f.question ?? 'waiting'}` : farmerLine(f);
          ask = f.needsYou;
        }
      } else if (c.kind === 'helper') {
        const hv = ctx.helper(c.id.replace(/^helper:/, ''));
        if (hv) { role = 'scarecrow · shell'; subText = hv.running ? `running ${hv.label}` : hv.exit === 'fail' ? 'last run failed' : 'idle at the prompt'; }
      }
    }
    const next = `${cur?.id ?? ''}|${verb}|${label}|${role}|${altText}|${subText}`;
    if (next === sig) return;
    const target = `${cur?.id ?? ''}`;
    if (target !== sig.slice(0, sig.indexOf('|'))) { ax = NaN; flipped = false; }
    sig = next;
    el.classList.toggle('hide', !cur);
    el.classList.toggle('ask', ask);
    nameEl.textContent = label;
    roleEl.textContent = role;
    roleEl.style.display = role ? '' : 'none';
    verbEl.textContent = verb;
    alt.style.display = altText ? '' : 'none';
    altVerb.textContent = altText;
    sub.textContent = subText;
    sub.style.display = subText ? '' : 'none';
    measure = !!cur;
  }

  const spot = { x: 0, y: 0 };
  function update(cam: THREE.Camera | null, fit?: (x: number, y: number, w: number, h: number, out: { x: number; y: number }) => boolean): typeof rect | null {
    text();
    if (!cur || !cam) { if (cur && !cam) el.classList.add('hide'); return null; }
    if (measure) { measure = false; w = el.offsetWidth; hgt = el.offsetHeight; }
    const W = innerWidth, H = innerHeight;
    try { cur.pos(v); } catch { return null; }
    cam.updateMatrixWorld();
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    r.copy(v).addScaledVector(right, RADIUS[cur.kind] ?? 0.4);
    v.project(cam); r.project(cam);
    const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
    const rpx = Math.min(W * 0.32, Math.max(18, Math.abs((r.x - v.x) * 0.5 * W)));
    // beside the body, on the side with room; vertically centred a little below the target's centre (the face is above)
    const gap = 16;
    let x = side > 0 ? sx + rpx + gap : sx - rpx - gap - w;
    if (side > 0 && x + w > W - 12) { side = -1; x = sx - rpx - gap - w; }
    else if (side < 0 && x < 12) { side = 1; x = sx + rpx + gap; }
    if (x < 12 || x + w > W - 12) x = Math.min(W - 12 - w, Math.max(12, x));
    let y = sy - hgt * 0.35;
    y = Math.min(H - hgt - 70, Math.max(12, y));
    // keep off the HUD's fixed panels (status card, needs-you cards, dock, toasts…)
    if (fit && fit(x, y, w, hgt, spot)) { x = spot.x; y = spot.y; }
    if (flipped !== (side < 0)) { flipped = side < 0; el.classList.toggle('left', flipped); }
    const dpr = devicePixelRatio || 1;
    x = Math.round(x * dpr) / dpr; y = Math.round(y * dpr) / dpr;
    if (!(Math.abs(x - ax) <= 0.3 && Math.abs(y - ay) <= 0.3)) { ax = x; ay = y; el.style.transform = `translate3d(${x}px,${y}px,0)`; }
    rect.x = x; rect.y = y; rect.w = w; rect.h = hgt;
    return rect;
  }
  return { cross, el, update, focused: () => cur };
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch (e) { console.warn('[hud] interactable threw', e); return null; }
}
