/**
 * First-run coach (GP §5.8, §8 "Help / onboarding / settings"): Ada, the cream receptionist Clawd, walks you through
 * five cards, each one gated by doing the thing (never by reading):
 *   1 look around (mouse) · 2 walk (WASD) · 3 aim at an agent → its card · 4 E opens its terminal (type to take
 *   control) · 5 tap Leader to come back, Tab = everyone at a glance.
 * Non-modal: the world keeps every key; the card sits at the bottom centre of the visible world strip. ui-kit §5.5: a
 * paper sheet with Ada's porthole, the `Ada says` enamel plaque, the serif body, 5 progress lamps (clay = seen) and two
 * keyed buttons, `[Esc] Skip tour` and the primary `[Enter] Next` (keys always shown). While the tour runs and the
 * world has the keyboard (no field, terminal or dialog focused), Enter = Next and Esc = Skip (tourKey); Esc while the
 * mouse is captured only releases it (the browser's), so looking around never ends the tour by accident. A localStorage flag (`hq.onboarded.v1`) makes it first-run only; the Help overlay and
 * settings can replay it. Automation (navigator.webdriver: shoot.ts, p2.ts, review shots) never sees it unless the
 * URL says `?tour=1`.
 * Owner: UI.
 */
import { h, setText, cls, adaSvg } from './dom.ts';
import { paper, plaque, keys, lamp, button, stateWord, type Lamp } from './kit/index.ts';
import { injectDialogCss } from './dialogCss.ts';
import type { Params } from '../core/params.ts';
import type { Bus } from '../core/bus.ts';

export const ONBOARD_FLAG = 'hq.onboarded.v1';

/** What the tour has seen the player do so far. */
export interface TourSignals { look: number; walk: number; aimed: boolean; opened: boolean; roster: boolean }

/**
 * The running tour's key hook. Registered on window (capture) at import, i.e. BEFORE keys.ts's dispatcher registers
 * its own capture listener at runtime, so the tour sees Enter / Esc first and can consume them.
 */
let tourKeyHook: ((ev: KeyboardEvent) => void) | null = null;
if (typeof window !== 'undefined') window.addEventListener('keydown', (ev) => tourKeyHook?.(ev), true);

/**
 * Pure step gates (unit-tested): progress of a step (0..4) from accumulated signals.
 */
export function stepDone(step: number, s: TourSignals): boolean {
  switch (step) {
    case 0: return s.look >= 0.9; // radians of yaw + pitch travel
    case 1: return s.walk >= 2.5; // metres
    case 2: return s.aimed; // a *fresh* aim held ≥ AIM_HOLD_MS after this card appeared (aimGate)
    case 3: return s.opened;
    case 4: return s.roster;
    default: return true;
  }
}

/** how long the reticle must rest on an agent (newly aimed after card 3 appeared) to pass card 3 */
export const AIM_HOLD_MS = 400;

/**
 * Pure aim gate for card 3 (m2-r1: it passed instantly when the reticle already rested on an agent as the card
 * appeared, so the status card was skipped unseen). Feed it the aimed name (or null) each poll with the time.
 * Only an aim that *starts* after the card appeared counts, and it must be held ≥ AIM_HOLD_MS on the same agent.
 */
export function createAimGate(initialAim: string | null | undefined, hold = AIM_HOLD_MS) {
  let prev = initialAim ?? null;
  let since = -1; // start of the current fresh aim, -1 = none
  return {
    /** Returns whether the gate has passed. */
    feed(aim: string | null | undefined, now: number): boolean {
      aim = aim ?? null;
      if (aim !== prev) { since = aim ? now : -1; prev = aim; }
      return since >= 0 && now - since >= hold;
    },
  };
}

/** Should the tour start on its own? */
export function shouldAutoStart({ flag, webdriver, forced, nohud, pose }: { flag: string | null; webdriver: boolean; forced: boolean; nohud: boolean; pose: string | null }): boolean {
  if (forced) return true;
  return !flag && !webdriver && !nohud && !pose;
}

export interface OnboardingDeps {
  root: HTMLElement;
  params: Pick<Params, 'nohud' | 'pose' | 'sheet'>;
  bus?: Bus | null;
  hooks: { pose(): number[] | null; aimed(): string | null; opened(): boolean; roster(): boolean; done?(): void };
}

export function createOnboarding(d: OnboardingDeps) {
  const lsGet = () => { try { return localStorage.getItem(ONBOARD_FLAG); } catch { return '1'; } };
  const lsSet = () => { try { localStorage.setItem(ONBOARD_FLAG, String(Date.now())); } catch { /* ignore */ } };
  const url = new URLSearchParams(location.search);

  injectDialogCss();
  const adaInner = h('div', { html: adaSvg(56, 'working') });
  const ada = h('div.k-port.lg', { style: { '--ws': 'var(--teal)' } }, adaInner);
  const text = h('p.tx');
  const lamps: Lamp[] = Array.from({ length: 5 }, () => lamp('idle', { size: 'sm', label: '' }));
  const dots = h('span.dots', { role: 'img' }, ...lamps);
  const nice = stateWord('done', { text: 'Nice!' });
  nice.classList.add('nice');
  const skip = button('Skip tour', { key: 'Escape', small: true, onClick: () => finish(true) });
  skip.classList.add('skip');
  const next = button('Next', { key: 'Enter', small: true, primary: true, onClick: () => advance() });
  next.classList.add('next');
  const card = paper({ cls: 'hq-coach' },
    h('div.hd', null, ada, h('div.say', null, plaque('Ada says'), text)),
    h('div.k-foot', null, dots, nice, h('span.k-sp'), skip, next));
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.setAttribute('aria-label', 'Tour');
  card.addEventListener('mousedown', (ev) => { if (!(ev.target instanceof Element && ev.target.closest('button'))) ev.preventDefault(); });
  d.root.append(card);

  let step = -1;
  let doneAt = 0;
  let sig: TourSignals = { look: 0, walk: 0, aimed: false, opened: false, roster: false };
  let last: number[] | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** card 3's aim gate, armed when that card appears */
  let aimGate: ReturnType<typeof createAimGate> | null = null;
  /** steps shown, with the time each appeared (tests: `onboarding.history`) */
  let history: { step: number; at: number }[] = [];

  const K = (spec: string | string[]) => keys(spec, { small: true });
  const L = () => keys('Leader', { small: true });
  const CARDS: (() => (string | Node)[])[] = [
    () => ['Welcome to HQ! Every clay critter here is one of your live herdr agents. ', h('b', { text: 'Click the office' }), ' and move the mouse to look around.'],
    () => ['Take a stroll: ', K(['W', 'A', 'S', 'D']), ' to walk, hold ', K('Shift'), ' to sprint. Stuck agents queue at my Help Desk.'],
    () => ['Say hi to someone: put the dot on an agent and their card pops up with what they are doing, and their question if they are blocked.'],
    () => ['Press ', K('E'), ' while aiming at them to open their terminal. It opens in Peek: ', h('b', { text: 'start typing' }), ' to take control.'],
    () => ['Tap ', L(), ' to hop back to the office (tap it again to return to the terminal). Now press ', K('Tab'), ': everyone at a glance, most urgent first.'],
  ];

  function show() {
    history.push({ step, at: performance.now() });
    if (step === 2) aimGate = createAimGate(d.hooks.aimed());
    text.replaceChildren(...CARDS[step]());
    lamps.forEach((x, i) => x.set(i <= step ? 'seen' : 'idle', ''));
    dots.setAttribute('aria-label', `Step ${step + 1} of ${CARDS.length}`);
    cls(card, 'ok', false);
    if (next.lastChild) setText(next.lastChild, step === CARDS.length - 1 ? 'Finish' : 'Next');
    adaInner.innerHTML = adaSvg(56, step === 0 ? 'done' : step === 2 ? 'blocked' : 'working');
    card.classList.remove('bump'); void card.offsetWidth; card.classList.add('bump');
  }
  function advance() {
    if (step < 0) return;
    doneAt = 0;
    if (step >= CARDS.length - 1) { finish(false); return; }
    step++;
    show();
  }
  function finish(skipped: boolean) {
    lsSet();
    if (step < 0) return;
    step = -1;
    if (timer) clearInterval(timer);
    timer = null;
    cls(card, 'show', false);
    if (tourKeyHook === tourKey) tourKeyHook = null;
    d.bus?.emit('onboarding', { done: true, skipped });
    if (!skipped) d.hooks.done?.();
  }

  /**
   * The tour's two keys, only while the world has the keyboard: focus on the page itself or the canvas (not a field,
   * the xterm, a dialog or the roster). Capture phase, consumed, so the world's Enter (last terminal) / Esc (clear
   * selection) don't also fire. Esc under pointer lock never gets here (the browser releases the mouse).
   */
  function tourKey(ev: KeyboardEvent) {
    if (step < 0 || ev.repeat || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    if (ev.key !== 'Enter' && ev.key !== 'Escape') return;
    const a = document.activeElement;
    if (a && a !== document.body && a.tagName !== 'CANVAS') return;
    if (document.querySelector('.hq-dlg.show')) return;
    if (ev.key === 'Escape' && document.pointerLockElement) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (ev.key === 'Enter') advance(); else finish(true);
  }

  function poll() {
    if (step < 0) return;
    const p = d.hooks.pose();
    if (p && last) {
      sig.walk += Math.min(1, Math.hypot(p[0] - last[0], p[2] - last[2]));
      let dy = p[3] - last[3];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      sig.look += Math.min(0.5, Math.abs(dy) + Math.abs((p[4] ?? 0) - (last[4] ?? 0)));
    }
    if (p) last = p.slice();
    if (step === 2 && aimGate?.feed(d.hooks.aimed(), performance.now())) sig.aimed = true;
    if (step >= 3 && d.hooks.opened()) sig.opened = true;
    if (step >= 4 && d.hooks.roster()) sig.roster = true;
    if (!doneAt && stepDone(step, sig)) {
      doneAt = performance.now();
      cls(card, 'ok', true);
    } else if (doneAt && performance.now() - doneAt > 750) advance();
  }

  const api = {
    el: card,
    get active() { return step >= 0; },
    get step() { return step; },
    get history() { return history.slice(); },
    start() {
      step = 0;
      history = [];
      aimGate = null;
      sig = { look: 0, walk: 0, aimed: false, opened: false, roster: false };
      last = null;
      doneAt = 0;
      cls(card, 'show', true);
      show();
      if (timer) clearInterval(timer);
      timer = setInterval(poll, 100); // not the frame loop: cheap, and it pauses nothing
      tourKeyHook = tourKey;
      d.bus?.emit('onboarding', { done: false });
    },
    finish,
    /** boot check (after the first world): first run only */
    maybeStart() {
      const go = shouldAutoStart({ flag: lsGet(), webdriver: !!navigator.webdriver, forced: url.get('tour') === '1', nohud: !!d.params.nohud, pose: d.params.pose || d.params.sheet });
      if (go) setTimeout(() => { if (step < 0) api.start(); }, 1200);
    },
  };
  return api;
}
