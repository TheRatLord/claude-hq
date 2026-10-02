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
import type { Camera } from 'three';
import type { FrameInfo, Interactions, SfxName, UiPort, VillagerPin } from '../scene/context.ts';
import type { HudDeps } from './port.ts';
import { createPanels, displayName, h, loadPrefs, savePrefs, typingIn, type HudCtx, type ToastSpec } from './ctx.ts';
import { letterKey, matchCombo, parseCombo, STATUS_RANK } from './format.ts';
import { ICONS, icon } from './icons.ts';
import { createStatus } from './status.ts';
import { createNeeds } from './needs.ts';
import { createPrompt } from './prompt.ts';
import { createAnchors } from './anchors.ts';
import { createToasts } from './toasts.ts';
import { festivalGreeter } from './festival.ts';
import { createMapPanel, createMinimap } from './map.ts';
import { warmBase } from './mapdraw.ts';
import { createMailbox, mailOf } from './mailbox.ts';
import { createRoster } from './roster.ts';
import { createCard } from './cards.ts';
import { createDrawer } from './drawer.ts';
import { createNoticeboard, createStats } from './boards.ts';
import { createAlmanac } from './almanac.ts';
import { createCollectionPanel } from './collection.ts';
import type { CollectionService } from '../model/collection.ts';
import { createShopPanel } from './shop.ts';
import type { YardPort } from './shop.ts';
import type { WalletService } from '../model/wallet.ts';
import { createFriendsPanel, createQuests } from './friends.ts';
import type { FriendsService } from '../model/friends.ts';
import { UPGRADES } from '../model/almanac.ts';
import { createHint, createPause } from './pause.ts';
import { createNotifier } from './notify.ts';
import { createOnboarding } from './onboarding.ts';
import type { OnboardingService } from '../model/onboarding.ts';

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
  /** optional: the persistent villagers (scene service 'villagers'), drawn as role pins on the maps */
  villagers?(): readonly VillagerPin[];
  /** optional: the scene camera, for the anchored overlays (nameplates, speech bubbles, the interaction tag) */
  camera?(): Camera;
  /** optional: the player's Collections book (forage + fishing, model/collection.ts) */
  collection?(): CollectionService;
  /** optional: the player's wallet (bits, basket, yard decor: model/wallet.ts) and the scene's yard (scene/yard) */
  wallet?(): WalletService;
  yard?(): YardPort | undefined;
  /** optional: friendship with the villagers + their daily requests (model/friends.ts) */
  friends?(): FriendsService;
  /** optional: the first-run welcome tour + one-time tips (model/onboarding.ts, hud/onboarding.ts) */
  onboarding?(): OnboardingService;
  /** optional: a scene service by name (ctx.services), duck-typed by the reader: the map reads 'forage', 'wildlife', 'festivals', 'yard' */
  service?(name: string): unknown;
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
      try { b.travelTo(id); anchors.say(`Off to see ${ctx.nameOf(id)}!`, 1600, undefined, 'screen'); } catch (e) { console.warn('[hud] travel failed', e); }
    },
    answer: async (id, key, label) => {
      if (!b) return false;
      const name = ctx.nameOf(id);
      const r = await b.agents.answer(id, key).catch((e: unknown) => ({ ok: false, error: String(e) }));
      if (r.ok) {
        tour.signal('answer');
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
  const panels = createPanels(() => ctx, panelHost, backdrop, () => overlays());
  ctx.panels = panels;

  // ---- overlays ----
  const status = createStatus(ctx);
  const needs = createNeeds(ctx);
  const prompt = createPrompt(ctx);
  const anchors = createAnchors(() => prompt.focused() ?? safeFocus(), () => b?.interact.all() ?? null);
  const safeFocus = () => { try { return b?.interact.focused() ?? null; } catch { return null; } };
  const toasts = createToasts(ctx);
  const notifier = createNotifier(ctx);
  const greetFestival = festivalGreeter((t) => toasts.push(t, true));
  const minimap = createMinimap(ctx);
  const quests = createQuests(ctx);
  const hint = createHint();
  const tour = createOnboarding(ctx, (t, ms, o) => anchors.say(t, ms, o));
  // the free-mouse reminder is the first item of the key-hints bar (one bar at the bottom, not two)
  const freehint = h('span.vh-freehint', null, h('kbd.vh-k', { text: 'Click' }), 'look around');

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
  for (const p of [createMailbox(ctx, mark), mapPanel, createRoster(ctx), card, createNoticeboard(ctx), stats, createAlmanac(ctx), createCollectionPanel(ctx), createShopPanel(ctx), createFriendsPanel(ctx), createPause(ctx), drawer, tour.panel]) panels.register(p);

  // ---- dock ----
  const dockBtn = (label: string, key: string, svg: string, fn: () => void, testid: string) => {
    const bt = h('button.vh-dockbtn', { type: 'button', title: `${label} (${key})`, 'aria-label': label, 'data-testid': testid }, icon(svg), h('span.badge'), h('span.key', { text: key }));
    bt.addEventListener('click', fn);
    return bt;
  };
  const mailBtn = dockBtn('Mailbox', 'J', ICONS.mail, () => panels.toggle('mailbox'), 'dock-mail');
  const leaderLabel = () => (d.settings.get('leaderKey') || 'Ctrl+`').replace(/^Ctrl\+/i, '⌃').replace(/^Alt\+/i, '⌥');
  const termBtn = dockBtn('Terminals', leaderLabel(), ICONS.terminal, () => toggleTerminal(), 'dock-term');
  const dock = h('div.vh-dock', null, minimap.el, h('div.vh-dockbtns.vh-wood', null,
    mailBtn,
    dockBtn('Map', 'M', ICONS.map, () => panels.toggle('map'), 'dock-map'),
    dockBtn('Farm ledger', 'Tab', ICONS.book, () => panels.toggle('roster'), 'dock-roster'),
    termBtn,
    dockBtn('Menu', 'Esc', ICONS.gear, () => panels.toggle('pause'), 'dock-menu')), quests.el);
  const leaderKbd = h('kbd.vh-k');
  const hints = h('div.vh-hints', null, freehint,
    h('span.opt', null, h('kbd.vh-k', { text: 'E' }), 'talk'), h('span.opt', null, h('kbd.vh-k', { text: 'F' }), 'terminal'),
    h('span', null, h('kbd.vh-k', { text: 'M' }), 'map'), h('span', null, h('kbd.vh-k', { text: 'Tab' }), 'ledger'),
    h('span', null, h('kbd.vh-k', { text: 'J' }), 'mail'),
    h('span', null, leaderKbd, 'terminals'), h('span', null, h('kbd.vh-k', { text: 'Esc' }), 'menu'),
    h('span', null, h('kbd.vh-k', { text: '?' }), 'all keys'));
  const syncLeader = () => {
    const spec = d.settings.get('leaderKey') || 'Ctrl+`';
    leaderKbd.textContent = spec;
    (termBtn.querySelector('.key') as HTMLElement).textContent = leaderLabel();
    termBtn.title = `Terminals (${spec})`;
  };
  syncLeader();

  layer.append(anchors.el, prompt.cross, prompt.el, dock, hints, hint, backdrop, h('div.vh-left', null, status.el, needs.el), drawer.dim, panelHost, toasts.el, status.banner, tour.el);
  // fixed HUD furniture the anchored bubbles / interaction tag keep clear of (anchors.ts measures them on change only;
  // "children" = each visible child, so the gaps in a column or a toast stack stay usable)
  for (const [el, how] of [[status.el, ''], [needs.el, 'children'], [dock, 'children'], [hints, ''], [hint, ''],
    [toasts.el, 'children'], [status.banner, ''], [drawer.el, ''], [tour.el, 'children']] as const) el.dataset.hudObstacle = how;
  anchors.watch(layer);

  // ---- terminal opener ----
  function openTerminal(id: string, enterAt?: number): void {
    if (!b) { pendingOpen = { id, enterAt }; return; }
    if (panels.isOpen('drawer')) drawer.show(id, enterAt);
    else panels.open('drawer', { id, enterAt });
  }
  function toggleTerminal(): void {
    if (panels.isOpen('drawer')) { panels.close(); return; }
    const id = bestTerminal();
    if (id) openTerminal(id); else toasts.push({ text: 'No terminals to open yet', sub: 'open a herdr workspace and its agents show up here', level: 'info' });
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
  // photo mode (farm/photo.ts) owns the keyboard while it is on
  const inPhoto = () => document.body.classList.contains('photo-mode');
  const photoJustLeft = () => performance.now() - ((window as unknown as { __photoLeftAt?: () => number }).__photoLeftAt?.() ?? -1e9) < 400;
  addEventListener('keydown', (e) => {
    if (inPhoto()) return;
    if (e.defaultPrevented || e.isComposing) return;
    const cur = panels.current();
    if (leaderMatch(e)) {
      handled(e);
      toggleTerminal();
      return;
    }
    if (cur?.id === 'drawer') { if (cur.key?.(e)) handled(e); return; }
    // Alt+0 folds / unfolds the needs-you list; Alt+1…9: the Nth needs-you farmer's terminal, from anywhere
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'Digit0') { handled(e); needs.toggle(); return; }
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
      if (e.key === '?') { handled(e); panels.open('pause', 'controls'); return; }
      if (e.code === 'KeyJ') { handled(e); panels.toggle('mailbox'); return; }
      if (e.code === 'KeyM') { handled(e); panels.toggle('map'); return; }
      if (e.code === 'KeyH') { handled(e); panels.toggle('almanac'); return; }
      if (e.code === 'KeyK') { handled(e); panels.toggle('collection'); return; }
      if (e.code === 'KeyI') { handled(e); panels.toggle('shop', { tab: 'sell', at: 'pocket' }); return; }
      if (e.key === 'Tab' && cur.id !== 'pause') { handled(e); panels.toggle('roster'); return; }
      if (e.code === 'KeyE' && cur.id === 'card') { handled(e); panels.close(); return; }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey) return;
    if (e.altKey) return;
    // ? (Shift+/ on most layouts): every key, grouped (the pause menu's Controls tab)
    if (e.key === '?') { handled(e); panels.open('pause', 'controls'); return; }
    switch (e.code) {
      case 'KeyE': { const f = prompt.focused(); if (f) { handled(e); if (f.kind === 'villager') tour.signal('talk'); try { f.use(); } catch (err) { console.warn('[hud] use() threw', err); } } return; }
      case 'KeyF': {
        const f = prompt.focused();
        if (!f) return;
        handled(e);
        if (f.kind === 'villager') tour.signal('talk');
        try { if (f.alt) f.alt.use(); else if (f.kind === 'farmer' || f.kind === 'helper') openTerminal(f.id); } catch (err) { console.warn('[hud] alt.use() threw', err); }
        return;
      }
      case 'KeyJ': handled(e); panels.open('mailbox'); return;
      case 'KeyM': handled(e); panels.open('map'); return;
      case 'KeyB': handled(e); panels.open('noticeboard'); return;
      case 'KeyH': handled(e); panels.open('almanac'); return;
      case 'KeyK': handled(e); panels.open('collection'); return;
      case 'KeyI': handled(e); panels.open('shop', { tab: 'sell', at: 'pocket' }); return;
      case 'KeyQ': if (quests.toggle()) handled(e); return;
      case 'KeyN': handled(e); prefs.minimap = !prefs.minimap; savePrefs(prefs); anchors.say(prefs.minimap ? 'Minimap on' : 'Minimap off', 900, undefined, 'screen'); return;
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
    if (!locked && wasLocked && !panels.modal && !inPhoto() && !photoJustLeft()) { pausedAt = Date.now(); panels.open('pause'); }
    wasLocked = locked;
    overlays();
  });
  function overlays(): void {
    const locked = !!document.pointerLockElement;
    layer.classList.toggle('modal', panels.modal);
    // a big panel (not a side card) is up: corner furniture steps back (toasts shrink, the banner docks, hints hide)
    layer.classList.toggle('covered', panels.modal && !panels.current()?.light);
    // a side card is up (right edge): toasts step left of it so they never sit on its buttons
    layer.classList.toggle('side', panels.modal && !!panels.current()?.light);
    // walking about (pointer locked, no panel): the key-hints bar steps back (hud.css .vh-layer.roam)
    layer.classList.toggle('roam', locked && !panels.modal);
    // otherwise the player is looking at the HUD (a panel, or a free pointer): the needs-you list wakes up right away
    // (needs.ts only dozes while roaming)
    if (!layer.classList.contains('roam')) needs.attend();
    tour.panelChanged(panels.current()?.id ?? null);
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
    notifier.tick(s);
    for (const l of s.letters) if (!l.read && readKeys.has(letterKey(l))) { b.markRead(l.id); l.read = true; }
    if (!pointerDown) needs.refresh();
    toasts.watchLetters(s.letters);
    greetFestival(s);
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
    quests.refresh();
    tour.refresh();
    if (!pointerDown) drawer.tick();
    const cur = panels.current();
    if (cur && cur.id !== 'drawer' && !pointerDown) { try { cur.refresh?.(); } catch (e) { console.error('[hud] panel refresh', e); } }
    overlays();
  }
  setInterval(tick, 250);

  // ---- network toasts, settings ----
  d.net.onToast((level, text) => toasts.push({ text, level: level === 'info' ? 'info' : level }, true));
  const motion = () => layer.classList.toggle('reduced', !!d.settings.get('reducedMotion'));
  d.settings.onChange((c) => { if ('reducedMotion' in c) motion(); if ('leaderKey' in c) syncLeader(); });
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
    /** push a toast (layout checks: `__hud.toast({ text, sub, level, key })`) */
    toast: (t: ToastSpec) => toasts.push(t),
    /** the last desktop notification's copy and the tab icon's badge ('n3', 'd', '') */
    notify: () => notifier.debug(),
    /** the welcome tour (hud/onboarding.ts): tip(id), signal(s), data() */
    tour: tour.dev,
  };

  return {
    ui: {
      farmerCard: (id) => panels.open('card', id),
      helperCard: (id) => panels.open('card', id),
      mailbox: () => panels.open('mailbox'),
      map: () => panels.open('map'),
      noticeboard: () => panels.open('noticeboard'),
      stats: () => panels.open('stats'),
      almanac: () => panels.open('almanac'),
      roster: () => panels.open('roster'),
      collection: () => panels.open('collection'),
      shop: (tab, at) => panels.open('shop', { tab: tab ?? 'buy', at: at ?? (tab === 'yard' ? 'pocket' : 'store') }),
      friends: (o) => panels.open('friends', o),
      say: (t, ms, o) => anchors.say(t, ms, o),
      tag: (t) => anchors.submit(t),
    },
    openTerminal: (id) => openTerminal(id),
    bind(x) {
      b = x;
      x.onValley((e) => {
        notifier.event(e);
        if (e.kind === 'blocked') { mailBtn.classList.remove('bounce'); void mailBtn.offsetWidth; mailBtn.classList.add('bounce'); }
        else if (e.kind === 'plot-opened') { const p = ctx.plot(e.id); if (p) toasts.push({ text: `A new field was tilled: ${p.label}`, sub: 'a workspace opened in herdr', icon: ICONS.sprout, level: 'good' }); }
        else if (e.kind === 'level-up') {
          const a = ctx.state()?.almanac;
          const up = a && a.rank > 0 ? UPGRADES[a.rank - 1] : null;
          toasts.push({ text: `The valley is now ${/^[aeiou]/i.test(e.detail ?? '') ? 'an' : 'a'} ${e.detail}!`, sub: up ? `New in town: ${up.title.replace(/^The /, "the ")} · H for the almanac` : 'H for the almanac', icon: ICONS.rosette, level: 'good', ms: 9000, key: `level|${e.detail}` });
          ctx.sfx('fanfare');
        }
        else if (e.kind === 'plot-closed') { const p = ctx.plot(e.id); if (p) toasts.push({ text: `Harvest time at ${p.label}`, sub: 'the workspace closed', icon: ICONS.sprout }); }
      });
      // a first-ever find for the Collections book
      try {
        x.collection?.().onFind((r) => {
          if (r.isNew) toasts.push({ text: `New in your collection: ${r.def.name}`, sub: `${r.def.rare ? 'a rare one! · ' : ''}K for the Collections book`, icon: ICONS.book, level: 'good', key: `find|${r.def.id}` });
        });
        // a first-ever sighting of a wild visitor (scene/life/wildlife.ts) for the field guide
        x.collection?.().onSight((r) => {
          if (r.isNew) toasts.push({ text: `New in your field guide: ${r.def.name}`, sub: 'K for the Collections book', icon: ICONS.book, level: 'good', key: `sight|${r.def.id}` });
        });
      } catch { /* optional */ }
      tick();
      warmBase(() => b?.valley().sky.season ?? 'summer');
      if (pendingOpen) { const p = pendingOpen; pendingOpen = null; openTerminal(p.id, p.enterAt); }
    },
    update(f) {
      const cam = b?.camera?.() ?? null;
      anchors.frame(cam, prompt.update(cam, anchors.fit));
      minimap.frame(f);
      const cur = panels.current();
      if (cur?.frame) { try { cur.frame(f); } catch (e) { console.error('[hud] panel frame', e); } }
    },
  };
}

