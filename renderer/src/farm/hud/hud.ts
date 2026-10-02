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
import type { FrameInfo, HandsPort, Interactions, SfxName, UiPort, VillagerPin } from '../scene/context.ts';
import type { HudDeps } from './port.ts';
import { createPanels, displayName, h, typingIn, type HudCtx, type ToastSpec } from './ctx.ts';
import { createPrefsStore } from '../prefs.ts';
import { captionFor, keyLabel, nameplateShown, reducedMotion, uiZoom, type Action } from '../model/prefs.ts';
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
import { UPGRADES, dayKey } from '../model/almanac.ts';
import { createHint, createPause } from './pause.ts';
import { createNotifier } from './notify.ts';
import { createOnboarding } from './onboarding.ts';
import { createPetPanel } from './pet.ts';
import { createGazettePanel } from './gazette.ts';
import { createAlbumPanel } from './album.ts';
import type { GazetteView } from './gazette.ts';
import type { OnboardingService } from '../model/onboarding.ts';
import type { StampsService } from '../model/stamps.ts';
import { stampIconHtml } from './stamps.ts';
import { readJson, writeJson } from '../storage.ts';

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
  /** optional: the stamp book (model/stamps.ts; the Almanac's Stamps tab, hud/stamps.ts) */
  stamps?(): StampsService;
  /** optional: The Valley Gazette (farm/newsroom.ts; hud/gazette.ts prints it) */
  gazette?(): GazetteView;
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
  // browser-local prefs (model/prefs.ts): main.ts shares its store with the controller and the engine
  const store = d.prefs ?? createPrefsStore();
  const prefs = store.data;
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
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
    savePrefs: () => store.save(),
    reduced: () => reducedMotion(prefs.reducedMotion, !!motionQuery?.matches, !!d.settings.get('reducedMotion')),
    kick: () => tick(),
  };
  const panels = createPanels(() => ctx, panelHost, backdrop, () => overlays());
  ctx.panels = panels;

  // ---- overlays ----
  const status = createStatus(ctx);
  const needs = createNeeds(ctx);
  const prompt = createPrompt(ctx);
  const anchors = createAnchors(() => prompt.focused() ?? safeFocus(), () => b?.interact.all() ?? null, {
    plate: (dist) => nameplateShown(prefs.nameplates, dist),
    statusOf: (owner) => { const f = ctx.farmer(owner); return f ? (f.needsYou ? 'blocked' : f.unseenDone ? 'done' : f.status) : null; },
  });
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
  const stored = readJson(READ_KEY);
  if (Array.isArray(stored)) for (const k of stored.slice(-400)) if (typeof k === 'string') readKeys.add(k);
  const saveRead = () => writeJson(READ_KEY, [...readKeys].slice(-400));
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
  for (const p of [createMailbox(ctx, mark), mapPanel, createRoster(ctx), card, createNoticeboard(ctx), stats, createAlmanac(ctx), createCollectionPanel(ctx), createShopPanel(ctx), createFriendsPanel(ctx), createPetPanel(ctx), createGazettePanel(ctx, () => b?.gazette?.()), createAlbumPanel(ctx), createPause(ctx), drawer, tour.panel]) panels.register(p);

  // ---- dock ----
  const dockBtn = (label: string, key: string, svg: string, fn: () => void, testid: string) => {
    const bt = h('button.vh-dockbtn', { type: 'button', title: `${label} (${key})`, 'aria-label': label, 'data-testid': testid }, icon(svg), h('span.badge'), h('span.key', { text: key }));
    bt.addEventListener('click', fn);
    return bt;
  };
  const mailBtn = dockBtn('Mailbox', 'J', ICONS.mail, () => panels.toggle('mailbox'), 'dock-mail');
  const mapBtn = dockBtn('Map', 'M', ICONS.map, () => panels.toggle('map'), 'dock-map');
  const ledgerBtn = dockBtn('Farm ledger', 'Tab', ICONS.book, () => panels.toggle('roster'), 'dock-roster');
  const leaderLabel = () => (d.settings.get('leaderKey') || 'Ctrl+`').replace(/^Ctrl\+/i, '⌃').replace(/^Alt\+/i, '⌥');
  const termBtn = dockBtn('Terminals', leaderLabel(), ICONS.terminal, () => toggleTerminal(), 'dock-term');
  const dock = h('nav.vh-dock', { 'aria-label': 'Quick panels' }, minimap.el, h('div.vh-dockbtns.vh-wood', null,
    mailBtn, mapBtn, ledgerBtn,
    termBtn,
    dockBtn('Menu', 'Esc', ICONS.gear, () => panels.toggle('pause'), 'dock-menu')), quests.el);
  const leaderKbd = h('kbd.vh-k');
  // key caps that follow Settings → Controls (rebindable keys)
  const kcap: Record<Action, HTMLElement[]> = { use: [], alt: [], map: [], ledger: [], mail: [], wave: [], lantern: [] };
  const kc = (a: Action) => { const k = h('kbd.vh-k'); kcap[a].push(k); return k; };
  const syncKeys = () => {
    for (const a of Object.keys(kcap) as Action[]) for (const k of kcap[a]) k.textContent = keyLabel(prefs.keys[a]);
    for (const [bt, a, label] of [[mailBtn, 'mail', 'Mailbox'], [mapBtn, 'map', 'Map'], [ledgerBtn, 'ledger', 'Farm ledger']] as const) {
      (bt.querySelector('.key') as HTMLElement).textContent = keyLabel(prefs.keys[a]);
      bt.title = `${label} (${keyLabel(prefs.keys[a])})`;
    }
  };
  const hints = h('div.vh-hints', { role: 'note', 'aria-label': 'Key hints' }, freehint,
    h('span.opt', null, kc('use'), 'talk'), h('span.opt', null, kc('alt'), 'terminal'),
    h('span', null, kc('map'), 'map'), h('span', null, kc('ledger'), 'ledger'),
    h('span', null, kc('mail'), 'mail'),
    h('span', null, leaderKbd, 'terminals'), h('span', null, h('kbd.vh-k', { text: 'Esc' }), 'menu'),
    h('span', null, h('kbd.vh-k', { text: '?' }), 'all keys'));
  const syncLeader = () => {
    const spec = d.settings.get('leaderKey') || 'Ctrl+`';
    leaderKbd.textContent = spec;
    (termBtn.querySelector('.key') as HTMLElement).textContent = leaderLabel();
    termBtn.title = `Terminals (${spec})`;
  };
  syncLeader();
  syncKeys();

  // captions for the important sound cues (Settings → Accessibility) and a screen-reader live region that announces
  // who needs you (always on, visually hidden)
  const captions = h('div.vh-captions', { role: 'log', 'aria-label': 'Sound captions', 'data-testid': 'captions' });
  const announce = h('div.vh-sr', { 'aria-live': 'assertive', role: 'alert', 'data-testid': 'sr-announce' });
  const capAt = new Map<string, number>();
  const caption = (sound: string, text: string, key: string) => {
    const now = performance.now();
    if (now - (capAt.get(key) ?? -1e9) < 1500) return;
    capAt.set(key, now);
    const line = h('div.cap', null, h('b', { text: `[${sound}]` }), ` ${text}`);
    captions.append(line);
    while (captions.children.length > 3) captions.firstElementChild?.remove();
    setTimeout(() => line.remove(), Math.round(5000 * (prefs.toastK || 1)));
  };
  layer.append(anchors.el, prompt.cross, prompt.el, dock, hints, hint, backdrop, h('div.vh-left', { role: 'region', 'aria-label': 'Valley status and who needs you' }, status.el, needs.el), drawer.dim, panelHost, toasts.el, status.banner, tour.el, captions, announce);
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
  /** the first-person paws (scene service 'hands'; HandsPort is a scene/context.ts type) */
  const paws = (): HandsPort | undefined => { try { return b?.service?.('hands') as HandsPort | undefined; } catch { return undefined; } };
  // photo mode (farm/photo.ts) owns the keyboard while it is on
  const inPhoto = () => document.body.classList.contains('photo-mode');
  const photoJustLeft = () => performance.now() - ((window as unknown as { __photoLeftAt?: () => number }).__photoLeftAt?.() ?? -1e9) < 400;
  /** Tab / Shift+Tab inside a panel: the next / previous visible control, wrapping around */
  const focusStep = (root: HTMLElement, dir: 1 | -1) => {
    const all = [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
      .filter((x) => !(x as HTMLButtonElement).disabled && x.getClientRects().length > 0 && !x.closest('[aria-hidden="true"], [inert]'));
    if (!all.length) { root.focus({ preventScroll: true }); return; }
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = all[i < 0 ? (dir > 0 ? 0 : all.length - 1) : (i + dir + all.length) % all.length];
    next.focus();
    next.scrollIntoView?.({ block: 'nearest' });
  };
  addEventListener('keydown', (e) => {
    if (inPhoto()) return;
    const K = prefs.keys;
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
      // keyboard navigation: Tab / Shift+Tab walk the open panel's controls and wrap (focus never leaks into the
      // valley behind it); the ledger key toggles the ledger only when it is not Tab
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) { handled(e); focusStep(cur.el, e.shiftKey ? -1 : 1); return; }
      if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === '?') { handled(e); panels.open('pause', 'controls'); return; }
      if (e.code === K.mail) { handled(e); panels.toggle('mailbox'); return; }
      if (e.code === K.map) { handled(e); panels.toggle('map'); return; }
      if (e.code === K.ledger) { handled(e); panels.toggle('roster'); return; }
      if (e.code === 'KeyH') { handled(e); panels.toggle('almanac'); return; }
      if (e.code === 'KeyK') { handled(e); panels.toggle('collection'); return; }
      if (e.code === 'KeyG') { handled(e); panels.toggle('gazette'); return; }
      if (e.code === 'KeyL') { handled(e); panels.toggle('album'); return; }
      if (e.code === 'KeyI') { handled(e); panels.toggle('shop', { tab: 'sell', at: 'pocket' }); return; }
      if (e.code === K.use && cur.id === 'card') { handled(e); panels.close(); return; }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey) return;
    if (e.altKey) return;
    // ? (Shift+/ on most layouts): every key, grouped (the pause menu's Controls tab)
    if (e.key === '?') { handled(e); panels.open('pause', 'controls'); return; }
    // the rebindable actions (Settings → Controls; defaults E / F / M / Tab / J)
    if (e.code === K.use) { const f = prompt.focused(); if (f) { handled(e); if (f.kind === 'villager') tour.signal('talk'); paws()?.used(f); try { f.use(); } catch (err) { console.warn('[hud] use() threw', err); } } return; }
    if (e.code === K.alt) {
      const f = prompt.focused();
      if (!f) return;
      handled(e);
      if (f.kind === 'villager') tour.signal('talk');
      if (f.alt) paws()?.used({ kind: f.kind, verb: f.alt.verb, id: f.id, pos: f.pos });
      try { if (f.alt) f.alt.use(); else if (f.kind === 'farmer' || f.kind === 'helper') openTerminal(f.id); } catch (err) { console.warn('[hud] alt.use() threw', err); }
      return;
    }
    // the first-person paws (scene/viewmodel): wave (Z), the lantern (T); rebindable
    if (e.code === K.wave && !e.repeat) { const h = paws(); if (h) { handled(e); h.gesture('wave'); } return; }
    if (e.code === K.lantern && !e.repeat) { const h = paws(); if (h) { handled(e); anchors.say(h.lantern() ? 'Lantern lit' : prefs.hands ? 'Lantern away' : 'Lantern: Settings → Interface → Show hands is off', 1100, undefined, 'screen'); } return; }
    if (e.code === K.mail) { handled(e); panels.open('mailbox'); return; }
    if (e.code === K.map) { handled(e); panels.open('map'); return; }
    if (e.code === K.ledger) { handled(e); panels.open('roster'); return; }
    switch (e.code) {
      case 'KeyB': handled(e); panels.open('noticeboard'); return;
      case 'KeyH': handled(e); panels.open('almanac'); return;
      case 'KeyK': handled(e); panels.open('collection'); return;
      case 'KeyG': handled(e); panels.open('gazette'); return;
      case 'KeyL': handled(e); panels.open('album'); return;
      case 'KeyI': handled(e); panels.open('shop', { tab: 'sell', at: 'pocket' }); return;
      case 'KeyQ': if (quests.toggle()) handled(e); return;
      case 'KeyN': handled(e); prefs.minimap = !prefs.minimap; store.save(); anchors.say(prefs.minimap ? 'Minimap on' : 'Minimap off', 900, undefined, 'screen'); return;
      case 'Escape': handled(e); if (Date.now() - pausedAt > 400) { pausedAt = Date.now(); panels.open('pause'); } return;
    }
  }, true);

  // ---- pointer lock: losing it (Esc) pauses; the first lock dismisses the welcome card ----
  let wasLocked = false, pausedAt = 0;
  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    if (locked && panels.modal) { document.exitPointerLock(); return; } // a late grant while a panel is open
    if (locked && !prefs.hinted) { prefs.hinted = true; store.save(); }
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
  // Settings → Interface / Accessibility on the layer: UI zoom, reduced motion (or explicitly not, over the OS), high
  // contrast, larger text, the colour-safe status palette (hud.css)
  let styleSig = '';
  const applyPrefs = () => {
    const z = uiZoom(prefs);
    layer.style.setProperty('--ui-zoom', String(z));
    layer.classList.toggle('reduced', ctx.reduced());
    layer.classList.toggle('motion-ok', prefs.reducedMotion === 'off');
    layer.classList.toggle('hc', prefs.highContrast);
    layer.classList.toggle('big', prefs.largeText);
    layer.classList.toggle('cb', prefs.colorSafe);
    captions.hidden = !prefs.captions;
    syncKeys();
    const sig = `${z}|${prefs.highContrast}|${prefs.largeText}|${prefs.colorSafe}`;
    if (sig !== styleSig) { styleSig = sig; anchors.remeasure(); }
  };
  store.onChange(() => { applyPrefs(); tick(); });
  motionQuery?.addEventListener?.('change', applyPrefs);
  d.settings.onChange((c) => { if ('reducedMotion' in c) applyPrefs(); if ('leaderKey' in c) syncLeader(); });
  applyPrefs();

  // dev/test handle (screenshots, browser tests): open any panel or terminal without key simulation
  (window as unknown as { __hud?: unknown }).__hud = {
    open: (id: Parameters<typeof panels.open>[0], arg?: unknown) => panels.open(id, arg),
    close: () => panels.close(),
    current: () => panels.current()?.id ?? null,
    /** dev: supply the optional bindings (player / locate) before main.ts provides them */
    patch: (o: Partial<HudBindings>) => { if (b) b = { ...b, ...o }; },
    openTerminal: (id: string) => openTerminal(id),
    /** dev: hide the welcome card as if the player had clicked in */
    dismissHint: () => { prefs.hinted = true; store.save(); overlays(); },
    /** map hit targets in canvas css px (browser tests click farmers by these) */
    mapHits: () => mapPanel.hits().map((x) => ({ ...x })),
    /** push a toast (layout checks: `__hud.toast({ text, sub, level, key })`) */
    toast: (t: ToastSpec) => toasts.push(t),
    /** the last desktop notification's copy and the tab icon's badge ('n3', 'd', '') */
    notify: () => notifier.debug(),
    /** the welcome tour (hud/onboarding.ts): tip(id), signal(s), data() */
    tour: tour.dev,
    /** browser-local prefs (model/prefs.ts): `prefs()` reads, `prefs({ uiScale: 1.3, colorSafe: true })` patches + applies */
    prefs: (patch?: Record<string, unknown>) => { if (patch) store.set(patch); return JSON.parse(JSON.stringify(prefs)) as unknown; },
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
      pet: () => panels.open('pet'),
      album: (id) => panels.open('album', id),
      say: (t, ms, o) => anchors.say(t, ms, o),
      tag: (t) => anchors.submit(t),
    },
    openTerminal: (id) => openTerminal(id),
    bind(x) {
      b = x;
      x.onValley((e) => {
        notifier.event(e);
        const who = e.kind === 'level-up' ? '' : ctx.nameOf(e.id);
        if (prefs.captions) { const c = captionFor(e.kind, who, e.detail); if (c) caption(c.sound, c.text, `${c.key}|${e.id}`); }
        if (e.kind === 'blocked') { const f = ctx.farmer(e.id); announce.textContent = `${who} needs you${f?.question ? `: ${f.question}` : ''}. Press Alt+1 for their terminal, or J for the mailbox.`; }
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
      // a stamp inked into the stamp book (model/stamps.ts): the stamp itself on the toast, a rubber-stamp thunk
      try {
        let thunkAt = 0;
        x.stamps?.().onEarn((e) => {
          toasts.push({
            text: `Stamp inked: ${e.def.name}`, sub: `+${e.bits} bits · ${e.def.blurb} (H, then S: the stamp book)`,
            icon: stampIconHtml(e.def, dayKey(e.at)), level: 'good', ms: 6500, key: `stamp|${e.def.id}`, group: 'stamp',
          });
          if (e.trophy) toasts.push({ text: `A trophy for your yard: the ${e.trophy.name.toLowerCase()}`, sub: `${e.trophy.at} stamps in the book`, icon: ICONS.rosette, level: 'good', ms: 8000, key: `trophy|${e.trophy.decor}` });
          if (performance.now() - thunkAt > 1200) { thunkAt = performance.now(); ctx.sfx('stamp'); }
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

