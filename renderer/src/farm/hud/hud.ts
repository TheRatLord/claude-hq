/**
 * HUD root. Owns every DOM overlay: crosshair + interaction prompt, status corner, needs-you strip, mailbox, map,
 * roster, farmer card, terminal drawer, noticeboard, stats, toasts, pause/settings. Implements the UiPort the 3D world
 * calls, and the terminal opener the AgentPort uses.
 *
 * Modules: ctx.ts (plumbing, panel manager) · status.ts · needs.ts · prompt.ts · toasts.ts · map.ts/mapdraw.ts ·
 * mailbox.ts · roster.ts · cards.ts · drawer.ts · boards.ts · pause.ts · icons.ts · format.ts · hud.css
 *
 * Timers: `update(f)` runs per rendered frame (prompt, map animation); a 4 Hz interval drives everything that must
 * keep working in a hidden tab (title badge, strip, badges, open panels), since rAF stops there.
 */
import './hud.css';
import type { AgentPort, Letter, ValleyEvent, ValleyState } from '../model/types.ts';
import { unreadCount } from '../model/valley.ts';
import type { FrameInfo, Interactions, SfxName, UiPort } from '../scene/context.ts';
import type { HudDeps } from './port.ts';
import { createPanels, displayName, h, loadPrefs, savePrefs, typingIn, type HudCtx, type ToastSpec } from './ctx.ts';
import { letterKey, matchCombo, parseCombo, STATUS_RANK } from './format.ts';
import { ICONS, icon } from './icons.ts';
import { createStatus } from './status.ts';
import { createNeeds } from './needs.ts';
import { createPrompt } from './prompt.ts';
import { createToasts } from './toasts.ts';
import { createMapPanel, createMinimap } from './map.ts';
import { warmBase } from './mapdraw.ts';
import { createMailbox, mailOf } from './mailbox.ts';
import { createRoster } from './roster.ts';
import { createCard } from './cards.ts';
import { createDrawer } from './drawer.ts';
import { createNoticeboard, createStats } from './boards.ts';
import { createHint, createPause } from './pause.ts';

export interface HudBindings {
  valley: () => ValleyState;
  onValley(fn: (e: ValleyEvent) => void): () => void;
  agents: AgentPort;
  interact: Interactions;
  /** freeze/unfreeze player input (modal open/closed) */
  setModal(open: boolean): void;
  /** travel the player next to a farmer (map "walk there") */
  travelTo(id: string): void;
  markRead(letterId: string): void;
  markAllRead(): void;
  /** UI sounds go through the audio service (a no-op until it exists) */
  sfx(name: SfxName): void;
  /** optional: the player's feet + look direction, for the map arrow and the minimap */
  player?(): { x: number; z: number; yaw: number };
  /** optional: live world position of a farmer / helper (FarmerLocator); the map falls back to their field */
  locate?(id: string): { x: number; z: number } | null;
}

export interface Hud {
  ui: UiPort;
  openTerminal(id: string): void;
  /** late binding: the engine exists after the HUD port is created */
  bind(b: HudBindings): void;
  update(f: FrameInfo): void;
}

const READ_KEY = 'valley.hud.read';
const TELL_RE = /tell (?:claude|codex|gemini|the agent|it)|differently|\(esc\)/i;

export function createHud(d: HudDeps): Hud {
  const layer = h('div.vh-layer', { 'data-testid': 'hud' });
  d.root.append(layer);
  const prefs = loadPrefs();
  let b: HudBindings | null = null;
  let pendingOpen: { id: string; enterAt?: number } | null = null;
  const backdrop = h('div.vh-backdrop');
  const panelHost = h('div', { style: { display: 'contents' } });

  const ctx: HudCtx = {
    d, layer, prefs,
    get b() { return b; },
    set b(v) { b = v; },
    state: () => { try { return b?.valley() ?? null; } catch { return null; } },
    farmer: (id) => ctx.state()?.farmers.get(id),
    helper: (id) => ctx.state()?.helpers.get(id),
    plot: (id) => ctx.state()?.plots.get(id),
    nameOf: (id) => displayName(ctx.state(), id),
    now: () => ctx.state()?.now ?? Date.now(),
    sfx: (n) => { try { b?.sfx(n); } catch { /* audio is optional */ } },
    openTerminal: (id, o) => openTerminal(id, o?.enterAt),
    travel: (id) => {
      if (!b) return;
      if (panels.current()?.id === 'pause') panels.close();
      try { b.travelTo(id); toasts.sayText(`Off to see ${ctx.nameOf(id)}!`, 1600); } catch (e) { console.warn('[hud] travel failed', e); }
    },
    answer: async (id, key, label) => {
      if (!b) return false;
      const name = ctx.nameOf(id);
      const r = await b.agents.answer(id, key).catch((e: unknown) => ({ ok: false, error: String(e) }));
      if (r.ok) {
        ctx.sfx('ui-click');
        toasts.push({ text: `Answered ${name}`, sub: label, level: 'good', icon: ICONS.check, key: `ans|${id}|${key}|${Date.now()}` });
        if (label && TELL_RE.test(label)) openTerminal(id);
        setTimeout(tick, 120);
      } else toasts.push({ text: `Couldn't answer ${name}`, sub: r.error === 'prompt_changed' ? 'the question changed — have another look' : r.error ?? 'unknown error', level: 'error', id });
      return r.ok;
    },
    toast: (t: ToastSpec) => toasts.push(t),
    panels: null as unknown as HudCtx['panels'],
    savePrefs: () => savePrefs(prefs),
    kick: () => tick(),
  };
  const panels = createPanels(() => ctx, panelHost, backdrop);
  ctx.panels = panels;

  // ---- overlays ----
  const status = createStatus(ctx);
  const needs = createNeeds(ctx);
  const prompt = createPrompt(ctx);
  const toasts = createToasts(ctx);
  const minimap = createMinimap(ctx);
  const hint = createHint();
  const freehint = h('div.vh-freehint', { text: 'Click the valley to look around · Esc for the menu' });

  // ---- read-state persistence (letter ids restart per page; keys survive) ----
  const readKeys = new Set<string>();
  try { for (const k of JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[]) readKeys.add(k); } catch { /* storage blocked */ }
  const saveRead = () => { try { localStorage.setItem(READ_KEY, JSON.stringify([...readKeys].slice(-400))); } catch { /* storage blocked */ } };
  const synthRead = new Set<string>();
  const mark = {
    synthRead,
    read(l: Letter) { if (!b) return; if (l.id.startsWith('ask:')) synthRead.add(l.id); else b.markRead(l.id); l.read = true; readKeys.add(letterKey(l)); saveRead(); tick(); },
    all() { if (!b) return; for (const l of mailOf(ctx.state(), synthRead)) { readKeys.add(letterKey(l)); if (l.id.startsWith('ask:')) synthRead.add(l.id); } b.markAllRead(); saveRead(); tick(); },
  };

  // ---- panels ----
  const drawer = createDrawer(ctx);
  const card = createCard(ctx);
  const stats = createStats(ctx);
  const mapPanel = createMapPanel(ctx);
  for (const p of [createMailbox(ctx, mark), mapPanel, createRoster(ctx), card, createNoticeboard(ctx), stats, createPause(ctx), drawer]) panels.register(p);

  // ---- dock ----
  const dockBtn = (label: string, key: string, svg: string, fn: () => void, testid: string) => {
    const bt = h('button.vh-dockbtn', { type: 'button', title: `${label} (${key})`, 'aria-label': label, 'data-testid': testid }, icon(svg), h('span.badge'), h('span.key', { text: key }));
    bt.addEventListener('click', fn);
    return bt;
  };
  const mailBtn = dockBtn('Mailbox', 'J', ICONS.mail, () => panels.toggle('mailbox'), 'dock-mail');
  const dock = h('div.vh-dock', null, minimap.el, h('div.vh-dockbtns.vh-wood', null,
    mailBtn,
    dockBtn('Map', 'M', ICONS.map, () => panels.toggle('map'), 'dock-map'),
    dockBtn('Farm ledger', 'Tab', ICONS.book, () => panels.toggle('roster'), 'dock-roster'),
    dockBtn('Menu', 'Esc', ICONS.gear, () => panels.toggle('pause'), 'dock-menu')));
  const hints = h('div.vh-hints', null,
    h('span', null, h('kbd.vh-k', { text: 'M' }), 'map'), h('span', null, h('kbd.vh-k', { text: 'Tab' }), 'ledger'),
    h('span', null, h('kbd.vh-k', { text: 'J' }), 'mail'), h('span', null, h('kbd.vh-k', { text: 'Esc' }), 'menu'));

  layer.append(prompt.cross, prompt.el, toasts.say, dock, hints, freehint, hint, backdrop, h('div.vh-left', null, status.el, needs.el), drawer.dim, panelHost, toasts.el, status.banner);

  // ---- terminal opener ----
  function openTerminal(id: string, enterAt?: number): void {
    if (!b) { pendingOpen = { id, enterAt }; return; }
    if (panels.isOpen('drawer')) drawer.show(id, enterAt);
    else panels.open('drawer', { id, enterAt });
  }
  function bestTerminal(): string | null {
    const s = ctx.state();
    if (!s) return null;
    const need = needs.list()[0];
    if (need) return need.id;
    const last = drawer.lastId();
    if (last && (s.farmers.has(last) || s.helpers.has(last))) return last;
    const f = [...s.farmers.values()].sort((a, c) => STATUS_RANK[a.status] - STATUS_RANK[c.status])[0];
    return f?.id ?? null;
  }

  // ---- keyboard ----
  let leaderSpec = '', leader = parseCombo('Ctrl+`');
  const leaderMatch = (e: KeyboardEvent) => {
    const spec = d.settings.get('leaderKey') || 'Ctrl+`';
    if (spec !== leaderSpec) { leaderSpec = spec; leader = parseCombo(spec); }
    return matchCombo(e, leader);
  };
  const handled = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); };
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const cur = panels.current();
    if (leaderMatch(e)) {
      handled(e);
      if (cur?.id === 'drawer') panels.close();
      else { const id = bestTerminal(); if (id) openTerminal(id); else toasts.push({ text: 'No terminals to open yet', level: 'info' }); }
      return;
    }
    if (cur?.id === 'drawer') { if (cur.key?.(e)) handled(e); return; }
    // Alt+1…9: the Nth needs-you farmer's terminal, from anywhere
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
      const f = needs.list()[Number(e.code.slice(5)) - 1];
      if (f) { handled(e); openTerminal(f.id); }
      return;
    }
    const typing = typingIn(e.target);
    if (cur) {
      if (cur.key?.(e)) { handled(e); return; }
      if (e.key === 'Escape') {
        handled(e);
        // the same Escape that released pointer lock (and so opened the pause menu) must not close it again
        if (!(cur.id === 'pause' && Date.now() - pausedAt < 400)) panels.close();
        return;
      }
      if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.code === 'KeyJ') { handled(e); panels.toggle('mailbox'); return; }
      if (e.code === 'KeyM') { handled(e); panels.toggle('map'); return; }
      if (e.key === 'Tab' && cur.id !== 'pause') { handled(e); panels.toggle('roster'); return; }
      if (e.code === 'KeyE' && cur.id === 'card') { handled(e); panels.close(); return; }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey) return;
    if (e.altKey) return;
    switch (e.code) {
      case 'KeyE': { const f = prompt.focused(); if (f) { handled(e); try { f.use(); } catch (err) { console.warn('[hud] use() threw', err); } } return; }
      case 'KeyF': {
        const f = prompt.focused();
        if (!f) return;
        handled(e);
        try { if (f.alt) f.alt.use(); else if (f.kind === 'farmer' || f.kind === 'helper') openTerminal(f.id); } catch (err) { console.warn('[hud] alt.use() threw', err); }
        return;
      }
      case 'KeyJ': handled(e); panels.open('mailbox'); return;
      case 'KeyM': handled(e); panels.open('map'); return;
      case 'KeyB': handled(e); panels.open('noticeboard'); return;
      case 'KeyN': handled(e); prefs.minimap = !prefs.minimap; savePrefs(prefs); toasts.sayText(prefs.minimap ? 'Minimap on' : 'Minimap off', 900); return;
      case 'Tab': handled(e); panels.open('roster'); return;
      case 'Escape': handled(e); if (Date.now() - pausedAt > 400) { pausedAt = Date.now(); panels.open('pause'); } return;
    }
  }, true);

  // ---- pointer lock: losing it (Esc) pauses; the first lock dismisses the welcome card ----
  let wasLocked = false, pausedAt = 0;
  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    if (locked && panels.modal) { document.exitPointerLock(); return; } // a late grant while a panel is open
    if (locked && !prefs.hinted) { prefs.hinted = true; savePrefs(prefs); }
    if (!locked && wasLocked && !panels.modal) { pausedAt = Date.now(); panels.open('pause'); }
    wasLocked = locked;
    overlays();
  });
  function overlays(): void {
    const locked = !!document.pointerLockElement;
    layer.classList.toggle('modal', panels.modal);
    const idle = !locked && !panels.modal;
    hint.classList.toggle('show', idle && !prefs.hinted && !!b);
    freehint.classList.toggle('show', idle && prefs.hinted && !!b);
  }

  // DOM rebuilds between mousedown and mouseup would swallow the click: hold refreshes while a button is down
  let pointerDown = false;
  addEventListener('pointerdown', () => { pointerDown = true; }, true);
  const release = () => { if (pointerDown) { pointerDown = false; setTimeout(tick, 0); } };
  addEventListener('pointerup', release, true);
  addEventListener('pointercancel', release, true);
  addEventListener('blur', release);

  // ---- the slow tick (4 Hz, also in hidden tabs) ----
  let lastUnread = 0;
  function tick(): void {
    const s = ctx.state();
    status.refresh();
    if (!s || !b) return;
    for (const l of s.letters) if (!l.read && readKeys.has(letterKey(l))) { b.markRead(l.id); l.read = true; }
    if (!pointerDown) needs.refresh();
    toasts.watchLetters(s.letters);
    const mail = mailOf(s, synthRead);
    const unread = unreadCount(mail);
    const badge = mailBtn.querySelector('.badge') as HTMLElement;
    badge.textContent = unread ? String(unread) : '';
    badge.dataset.n = String(unread);
    mailBtn.classList.toggle('ask', mail.some((l) => l.kind === 'needs-you' && !l.resolved && !l.read));
    if (unread > lastUnread) { mailBtn.classList.remove('bounce'); void mailBtn.offsetWidth; mailBtn.classList.add('bounce'); }
    lastUnread = unread;
    stats.sample();
    minimap.refresh();
    if (!pointerDown) drawer.tick();
    const cur = panels.current();
    if (cur && cur.id !== 'drawer' && !pointerDown) { try { cur.refresh?.(); } catch (e) { console.error('[hud] panel refresh', e); } }
    overlays();
  }
  setInterval(tick, 250);

  // ---- network toasts, settings ----
  d.net.onToast((level, text) => toasts.push({ text, level: level === 'info' ? 'info' : level }));
  const motion = () => layer.classList.toggle('reduced', !!d.settings.get('reducedMotion'));
  d.settings.onChange((c) => { if ('reducedMotion' in c) motion(); });
  motion();

  // dev/test handle (screenshots, browser tests): open any panel or terminal without key simulation
  (window as unknown as { __hud?: unknown }).__hud = {
    open: (id: Parameters<typeof panels.open>[0], arg?: unknown) => panels.open(id, arg),
    close: () => panels.close(),
    current: () => panels.current()?.id ?? null,
    /** dev: supply the optional bindings (player / locate) before main.ts provides them */
    patch: (o: Partial<HudBindings>) => { if (b) b = { ...b, ...o }; },
    openTerminal: (id: string) => openTerminal(id),
    /** dev: hide the welcome card as if the player had clicked in */
    dismissHint: () => { prefs.hinted = true; savePrefs(prefs); overlays(); },
    /** map hit targets in canvas css px (browser tests click farmers by these) */
    mapHits: () => mapPanel.hits().map((x) => ({ ...x })),
  };

  return {
    ui: {
      farmerCard: (id) => panels.open('card', id),
      helperCard: (id) => panels.open('card', id),
      mailbox: () => panels.open('mailbox'),
      map: () => panels.open('map'),
      noticeboard: () => panels.open('noticeboard'),
      stats: () => panels.open('stats'),
      say: (t, ms) => toasts.sayText(t, ms),
    },
    openTerminal: (id) => openTerminal(id),
    bind(x) {
      b = x;
      x.onValley((e) => {
        if (e.kind === 'blocked') { mailBtn.classList.remove('bounce'); void mailBtn.offsetWidth; mailBtn.classList.add('bounce'); }
        else if (e.kind === 'plot-opened') { const p = ctx.plot(e.id); if (p) toasts.push({ text: `A new field was tilled: ${p.label}`, sub: 'a workspace opened in herdr', icon: ICONS.sprout, level: 'good' }); }
        else if (e.kind === 'plot-closed') { const p = ctx.plot(e.id); if (p) toasts.push({ text: `Harvest time at ${p.label}`, sub: 'the workspace closed', icon: ICONS.sprout }); }
      });
      tick();
      warmBase();
      if (pendingOpen) { const p = pendingOpen; pendingOpen = null; openTerminal(p.id, p.enterAt); }
    },
    update(f) {
      prompt.update();
      minimap.frame(f);
      const cur = panels.current();
      if (cur?.frame) { try { cur.frame(f); } catch (e) { console.error('[hud] panel frame', e); } }
    },
  };
}

