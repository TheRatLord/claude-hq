/**
 * The first-run welcome (model/onboarding.ts is the pure step tracker; main.ts creates the service and pays the reward):
 *
 *   Welcome letter   panel 'welcome': Posy the postmaster's letter on the first visit (or "Replay the welcome" in the
 *                    pause menu): what the valley is, then "Let's go" (the checklist) or "Skip the tour".
 *   Checklist        a small foldable, dismissable card bottom-left (data-hud-obstacle): one line per step with a tick,
 *                    the current step's how-to, the three pastimes as chips. Steps tick from real signals: hud.ts calls
 *                    `signal()` from its existing key / panel / answer / terminal paths; look + walk come from the
 *                    player's yaw and feet; pastimes from main (finds, the farmhouse).
 *   Tips             one-time contextual hints in the same corner (first blocked farmer, first rain, first night, first
 *                    find in the basket), at most one every few minutes, never while a panel / terminal is up or you are
 *                    typing, never during the tour; × dismisses, "Tips off" (or Settings) turns them off.
 *
 * Everything here is skipped in automated browsers (tests, shots) unless the page has ?welcome=1 (main.ts decides).
 */
import './onboarding.css';
import type { HudCtx, Panel } from './ctx.ts';
import { h, typingIn } from './ctx.ts';
import { ICONS, icon } from './icons.ts';
import { portrait } from './friends.ts';
import { decorIcon } from './shop.ts';
import { friendDef } from '../model/friends.ts';
import { coins, decorDef } from '../model/shop.ts';
import { PASTIMES, STEPS, hintDef, nextStep, progress } from '../model/onboarding.ts';
import type { HintDef, HintId, OnbSignal, OnboardingChange, OnboardingService, StepId } from '../model/onboarding.ts';

type Say = (text: string, ms?: number, o?: { who?: string; from?: string }) => void;

export interface Onboarding {
  /** the checklist + tip corner (append to the layer; it is an obstacle for the anchored bubbles) */
  el: HTMLElement;
  /** the welcome letter panel (register with the panel manager) */
  panel: Panel;
  /** a real thing happened (hud.ts: talk, terminal, answer, map, ledger) */
  signal(s: OnbSignal): void;
  /** the panel manager changed what is open */
  panelChanged(id: string | null): void;
  /** 4 Hz */
  refresh(): void;
  /** dev / shots / tests (`__hud.tour`): show a tip now, send a signal, read the data */
  dev: { tip(id: string, ms?: number): boolean; signal(s: OnbSignal): void; data(): unknown };
}

const svcOf = (ctx: HudCtx): OnboardingService | null => { try { return ctx.b?.onboarding?.() ?? null; } catch { return null; } };
const TIP_MS = 16_000;
const LOOK_RAD = 1.1, WALK_M = 5, JUMP_M = 4;

export function createOnboarding(ctx: HudCtx, say: Say): Onboarding {
  // ---- the welcome letter ----
  const posy = friendDef('posy');
  const stamp = h('div.stamp', { html: posy ? portrait(posy) : '' });
  const goBtn = h('button.vh-btn.primary', { type: 'button', 'data-testid': 'welcome-go', 'data-autofocus': '' }, icon(ICONS.walk), "Let's go!");
  const skipBtn = h('button.vh-btn.ghost', { type: 'button', 'data-testid': 'welcome-skip' }, 'Skip the tour');
  const k = (t: string) => h('kbd.vh-k', { text: t });
  const letter = h('section.vh-welcome', { 'aria-label': 'A letter from Posy', 'data-testid': 'panel-welcome' }, h('div.sheet', null,
    h('div.top', null, stamp, h('div.from', null, h('span.l', { text: 'A letter for you' }), h('span.w', { text: 'from Posy, postmaster of Claude Valley' }))),
    h('h2', { text: 'Welcome to the valley, neighbour!' }),
    h('p', null, 'This valley is your workshop in disguise. Every ', h('b', { text: 'farmer' }), ' you meet is one of your coding agents, and every ',
      h('b', { text: 'field' }), ' is a workspace they are tending. When a farmer runs to the gate with a golden ', h('b.gold', { text: '!' }),
      ' over their head they ', h('b', { text: 'need you' }), '; a basket of produce means they are done.'),
    h('p', null, 'Their real terminals are never more than a key away, however far they wander: walk up and press ', k('F'),
      ', or reach anyone from the map ', k('M'), ', the ledger ', k('Tab'), ' or the dock.'),
    h('p', null, 'I have pinned a little list in the corner to help you settle in. Take it at your own pace: it ticks itself off as you go.'),
    h('p.sign', { text: 'Yours by return of post, Posy' }),
    h('div.btns', null, goBtn, skipBtn)));
  let chose = false;
  const begin = (skip: boolean) => {
    chose = true;
    const s = svcOf(ctx);
    s?.begin(skip);
    ctx.panels.close();
    if (!skip) setTimeout(() => say('Hello, neighbour! Come and find me by the mailbox whenever you like.', 5200, { who: 'Posy', from: 'villager:posy' }), 600);
    else ctx.toast({ text: 'Tour skipped', sub: 'replay the welcome any time from the menu (Esc)', icon: ICONS.mail, key: 'onb-skip' });
    sig = '';
    refresh();
  };
  goBtn.addEventListener('click', () => begin(false));
  skipBtn.addEventListener('click', () => begin(true));
  const panel: Panel = {
    id: 'welcome', el: letter,
    onOpen() {
      chose = false;
      // the welcome supersedes the older first-run hint card
      if (!ctx.prefs.hinted) { ctx.prefs.hinted = true; ctx.savePrefs(); }
      ctx.sfx('letter-open');
    },
    onClose() { if (!chose) begin(false); },
    key(e) {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { begin(false); return true; }
      return false;
    },
  };

  // ---- the checklist ----
  const count = h('span.n');
  const chev = h('span.chev', { text: '▾' });
  const head = h('button.head', { type: 'button', 'data-testid': 'onb-fold', title: 'Fold the welcome tour' }, icon(ICONS.sprout), h('span.l', { text: 'Welcome tour' }), count, chev);
  const closeBtn = h('button.x', { type: 'button', 'data-testid': 'onb-close', title: 'Close the tour (replay it from the menu)', 'aria-label': 'Close the welcome tour' }, icon(ICONS.close));
  const list = h('ol.list');
  const box = h('div.vh-onb', { 'data-testid': 'onboarding', role: 'region', 'aria-label': 'Welcome tour' }, h('div.bar', null, head, closeBtn), list);
  head.addEventListener('click', (e) => { e.stopPropagation(); const s = svcOf(ctx); if (s) { s.fold(!s.data().folded); ctx.sfx('ui-click'); } });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    svcOf(ctx)?.dismiss();
    ctx.toast({ text: 'Welcome tour closed', sub: 'replay it any time from the menu (Esc)', icon: ICONS.mail, key: 'onb-close' });
  });

  // ---- a tip ----
  const tipText = h('div.t'), tipSub = h('div.s');
  const tipX = h('button.x', { type: 'button', 'data-testid': 'onb-tip-close', 'aria-label': 'Dismiss this tip', title: 'Dismiss' }, icon(ICONS.close));
  const tipOff = h('button.off', { type: 'button', 'data-testid': 'onb-tip-off', text: 'Tips off' });
  const tip = h('div.vh-onbtip', { 'data-testid': 'onb-tip', role: 'status', hidden: true }, h('span.ic', { html: posy ? portrait(posy) : '' }), h('div.body', null, tipText, tipSub), h('div.side', null, tipX, tipOff));
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  const hideTip = () => { tip.hidden = true; clearTimeout(tipTimer); };
  tipX.addEventListener('click', (e) => { e.stopPropagation(); hideTip(); });
  tipOff.addEventListener('click', (e) => {
    e.stopPropagation();
    svcOf(ctx)?.setHintsOff(true);
    hideTip();
    ctx.toast({ text: 'Tips are off', sub: 'turn them back on in Settings (Esc → Settings)', key: 'tips-off' });
  });
  const showTip = (x: HintDef, ms = TIP_MS) => {
    tipText.textContent = x.text;
    tipSub.textContent = x.sub;
    tip.dataset.id = x.id;
    tip.hidden = false;
    tip.classList.remove('pop'); void tip.offsetWidth; tip.classList.add('pop');
    ctx.sfx('page');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, ms);
  };

  const el = h('div.vh-onbwrap', null, tip, box);

  // ---- service binding ----
  let bound: OnboardingService | null = null, sig = '', just: StepId | null = null, justAt = 0;
  let started = false, boundAt = 0;
  const onChange = (c: OnboardingChange) => {
    if (c.kind === 'step') { just = c.step; justAt = performance.now(); if (c.state === 'done') ctx.sfx('sparkle'); }
    else if (c.kind === 'finish' && c.reward) {
      const r = c.reward;
      ctx.sfx('fanfare');
      ctx.toast({ text: 'Welcome tour complete!', sub: `+${coins(r.coins)} · a ${decorDef(r.decor)?.name ?? 'present'} in your yard · a letter from Posy (J)`, icon: decorIcon(r.decor), level: 'good', ms: 9000, key: 'onb-done' });
    }
    sig = '';
  };
  const bind = (): OnboardingService | null => {
    const s = svcOf(ctx);
    if (s && s !== bound) { bound = s; boundAt = performance.now(); s.onChange(onChange); }
    return s;
  };

  // ---- look + walk from the player's own movement (teleports and panels don't count) ----
  let last: { x: number; z: number; yaw: number } | null = null, lookAcc = 0, walkAcc = 0;
  function watchPlayer(s: OnboardingService): void {
    const d = s.data();
    if (!d.active || (d.steps.look && d.steps.walk)) { last = null; return; }
    let p: { x: number; z: number; yaw: number } | null = null;
    try { p = ctx.b?.player?.() ?? null; } catch { p = null; }
    if (!p || ctx.panels.modal) { last = null; return; }
    if (last) {
      const moved = Math.hypot(p.x - last.x, p.z - last.z);
      if (moved < JUMP_M) {
        let dy = Math.abs(p.yaw - last.yaw) % (Math.PI * 2);
        if (dy > Math.PI) dy = Math.PI * 2 - dy;
        lookAcc += Math.min(dy, 0.8);
        walkAcc += moved;
        if (lookAcc > LOOK_RAD && !d.steps.look) s.signal('look');
        if (walkAcc > WALK_M && !d.steps.walk) s.signal('walk');
      }
    }
    last = { x: p.x, z: p.z, yaw: p.yaw };
  }

  /** what the world says about tips: queue the ones whose moment has come */
  function watchWorld(s: OnboardingService): void {
    const st = ctx.state();
    if (!st || !s.tips || s.data().hints.off) return;
    for (const f of st.farmers.values()) if (f.needsYou) { s.want('blocked'); break; }
    const w = st.sky.weather.kind;
    if (w === 'rain' || w === 'storm') s.want('rain');
    if (st.sky.hour >= 19.5 || st.sky.hour < 5) s.want('night');
    try { if ((ctx.b?.wallet?.()?.basketCount() ?? 0) > 0) s.want('basket'); } catch { /* optional */ }
  }

  const busy = (): boolean => ctx.panels.modal || typingIn(document.activeElement) || document.body.classList.contains('photo-mode');

  function row(st: StepId): HTMLElement {
    const def = STEPS.find((x) => x.id === st)!;
    const li = h(`li.step${def.extra ? '.extra' : ''}`, { 'data-step': st },
      h('span.tick'), h('span.t', { text: def.title }), h('span.keys', null, ...def.keys.map((x) => h('kbd.vh-k', { text: x }))), h('span.how', { text: def.how }));
    if (st === 'pastime') li.append(h('span.chips', null, ...PASTIMES.map((p) => h('span.chip', { 'data-p': p.id, text: p.label }))));
    return li;
  }
  const rows = new Map<StepId, HTMLElement>();
  for (const st of STEPS) { const r = row(st.id); rows.set(st.id, r); list.append(r); }

  function render(s: OnboardingService): void {
    const d = s.data();
    const show = d.active;
    const nsig = `${show}|${d.folded}|${JSON.stringify(d.steps)}|${JSON.stringify(d.pastimes)}|${just}`;
    if (nsig === sig) return;
    sig = nsig;
    box.hidden = !show;
    if (!show) return;
    const p = progress(d), cur = nextStep(d);
    count.textContent = `${p.done}/${p.total}`;
    box.classList.toggle('folded', d.folded);
    chev.textContent = d.folded ? '▸' : '▾';
    head.title = d.folded ? 'Unfold the welcome tour' : 'Fold the welcome tour';
    for (const [id, li] of rows) {
      const state = d.steps[id];
      li.classList.toggle('done', state === 'done');
      li.classList.toggle('skipped', state === 'skipped');
      li.classList.toggle('cur', cur?.id === id);
      li.classList.toggle('just', just === id && performance.now() - justAt < 1200);
      (li.querySelector('.tick') as HTMLElement).textContent = state === 'done' ? '✓' : state === 'skipped' ? '–' : '';
      li.title = state === 'skipped' ? 'Nobody needs you right now: skipped (answering later still ticks it)' : '';
      for (const c of li.querySelectorAll<HTMLElement>('.chip')) c.classList.toggle('on', !!d.pastimes[c.dataset.p as keyof typeof d.pastimes]);
    }
  }

  function refresh(): void {
    const s = bind();
    if (!s) { el.hidden = true; return; }
    el.hidden = false;
    // open the welcome letter once the valley has arrived and nothing else is up
    if (s.autostart && !started && performance.now() - boundAt > 1200 && ctx.state()?.link !== 'connecting' && !ctx.panels.modal) {
      started = true;
      if (s.data().welcomed) s.replay();
      ctx.panels.open('welcome');
    }
    if (s.data().active) s.settle({ asks: [...(ctx.state()?.farmers.values() ?? [])].filter((f) => f.needsYou).length });
    watchPlayer(s);
    watchWorld(s);
    if (just && performance.now() - justAt > 1200) { just = null; }
    render(s);
    // a tip: never during the tour, a panel, a terminal or typing
    if (tip.hidden && !s.data().active) { const x = s.nextHint(busy()); if (x) showTip(x); }
  }

  return {
    el, panel,
    signal(sg) { bind()?.signal(sg); },
    panelChanged(id) {
      if (id === 'map') bind()?.signal('map');
      else if (id === 'roster') bind()?.signal('ledger');
      else if (id === 'drawer') bind()?.signal('terminal');
    },
    refresh,
    dev: {
      tip(id, ms) { const x = hintDef(id as HintId); if (x) showTip(x, ms); return !!x; },
      signal(sg) { bind()?.signal(sg); },
      data: () => bind()?.data() ?? null,
    },
  };
}

/** for the pause menu: open the welcome letter again (a fresh checklist) */
export function replayWelcome(ctx: HudCtx): void {
  const s = svcOf(ctx);
  if (!s) return;
  s.replay();
  ctx.panels.open('welcome');
}
