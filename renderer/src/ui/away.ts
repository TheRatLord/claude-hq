/**
 * "While you were away" (§6.4.5). `lastPresentAt` (tab visible + window focused + any input) is kept in localStorage
 * per session. On visibilitychange→visible, window focus or the first input after a reload, if the gap is ≥
 * `awayRecapMin` (default 10; 0 = off) → recap once:
 * - lines from the UI's event ring (store events apply while hidden; the ring is persisted so a reload keeps it) merged
 *   with `timeline.get {since}` (§4.3.1), built by the pure `recap.ts`;
 * - the "While you were out" slip (UI kit §5.4) under the HUD tally prints one line per 0.8 s (reduced motion: all at once); each line is
 *   clickable; any key/click dismisses it and still performs its own action; `bus 'away.recap'` lets the Big Board /
 *   Ada do their part (ENV/BRN);
 * - if anything is blocked, the Blocked Inbox opens non-modally with the oldest blocked selected (world keeps focus)
 *   and the recap is its header (one panel, m2-r1) instead of the strip;
 *   with xterm focused it does not open: the drawer's blocked counter pulses and an in-drawer toast lists the recap.
 * `__hq.away(minutes)` fakes the gap (§9.1).
 * Owner: UI.
 */
import { h, cls } from './dom.ts';
import { paper, button, slipBand } from './kit/index.ts';
import { injectCardStyles, recapSlipLine } from './cards.ts';
import { buildRecap, createRing, awayDue, RING_MAX, type RecapLine, type RingItem } from './recap.ts';
import type { Entity, Status, TimelineItem } from '../../../shared/protocol.ts';
import type { Store, OutMsg } from '../net/store.ts';
import type { Settings } from '../core/settings.ts';
import type { Bus } from '../core/bus.ts';

const LINE_MS = 800;
const TOUCH_MIN_MS = 5000;

export interface AwayDeps {
  root: HTMLElement;
  store: Pick<Store, 'on' | 'entities' | 'now'>;
  settings: Pick<Settings, 'get'>;
  session(): string;
  bus?: Bus | null;
  call(m: OutMsg): Promise<{ ok: boolean }>;
  label?: (e: Entity) => string;
  hooks: {
    scope(): string;
    inbox(id?: string | null, recap?: { minutes: number; lines: (RecapLine & { act?: (() => void) | null })[] }): void;
    recapShown?(): boolean; open(id: string): void; goTo(id: string): void;
    drawerRecap(lines: string[]): boolean; announce(t: string): void; reduced(): boolean;
  };
}

export function createAway(d: AwayDeps) {
  injectCardStyles();
  const { store } = d;
  const ring = createRing();
  const key = (k: string) => `hq.${k}.${d.session()}`;
  const ls = {
    get(k: string): unknown { try { return JSON.parse(localStorage.getItem(key(k)) || 'null'); } catch { return null; } },
    set(k: string, v: unknown) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch { /* blocked */ } },
  };
  let loadedFor: string | null = null;
  const ensureLoaded = () => {
    const s = d.session();
    if (loadedFor === s || s === 'pending') return;
    loadedFor = s;
    ring.load(ls.get('awayRing'));
  };
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveRing = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; if (loadedFor) ls.set('awayRing', ring.items.slice(-RING_MAX)); }, 1000);
  };

  // ---- event ring (store listeners fire while hidden, §3.4) ----
  const names = new Map<string, string>();
  /** captured at event time, so a departed namesake keeps its 'claude · 2' */
  const lab = (e: Entity) => (d.label ? d.label(e) : null) || e.name;
  store.on('event', (m) => {
    ensureLoaded();
    const e = store.entities.get(m.id);
    if (m.kind === 'news' || m.kind === 'tool') return; // too chatty for a recap
    ring.push({ at: store.now(), id: m.id, name: (e && lab(e)) ?? names.get(m.id) ?? m.id, kind: m.kind, detail: m.detail ?? null });
    saveRing();
  });
  const prev = new Map<string, Status>();
  store.on('entity', (e) => {
    names.set(e.id, lab(e));
    const was = prev.get(e.id);
    prev.set(e.id, e.status);
    if (was && was !== e.status && e.status === 'done') { ensureLoaded(); ring.push({ at: store.now(), id: e.id, name: lab(e), kind: 'status', to: 'done' }); saveRing(); }
  });
  store.on('world', () => { for (const e of store.entities.values()) { names.set(e.id, lab(e)); prev.set(e.id, e.status); } });
  store.on('hello', () => { ensureLoaded(); });

  // ---- presence ----
  let firstInputSeen = false;
  let lastTouchSave = 0;
  const present = () => !document.hidden && document.hasFocus();
  function touch(force = false) {
    const now = Date.now();
    if (!force && now - lastTouchSave < TOUCH_MIN_MS) return;
    lastTouchSave = now;
    if (d.session() !== 'pending') ls.set('lastPresentAt', now);
  }
  function onInput() {
    if (!present()) return;
    if (!firstInputSeen) { firstInputSeen = true; check('input'); }
    touch();
  }
  for (const t of ['keydown', 'pointerdown', 'wheel']) addEventListener(t, onInput, { capture: true, passive: true });
  addEventListener('mousemove', onInput, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check('visible'); else touch(true); });
  addEventListener('focus', () => check('focus'));
  addEventListener('blur', () => touch(true));
  addEventListener('pagehide', () => touch(true));

  // ---- the slip (UI kit §5.4: "While you were out") ----
  const band = slipBand({ span: ' ' });
  const mins = band.querySelector<HTMLElement>('.span') ?? h('span'); // slipBand({span}) always draws it
  const list = h('div');
  const dismissBtn = button('Dismiss', { key: 'Esc', onClick: () => dismiss() });
  const strip = h('div.hq-away.hq-cards', { role: 'status', 'aria-live': 'polite' },
    paper({ cls: 'k-slip' }, band, list, h('div.acts', null, dismissBtn)));
  d.root.append(strip);
  let timers: ReturnType<typeof setTimeout>[] = [];
  let dismissArmed = false;
  const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = []; };
  // the inbox (and anything else top-centre) sits below the strip while it shows
  const setInset = (px: number) => d.root.style.setProperty('--away-h', `${px}px`);
  function dismiss() {
    clearTimers();
    cls(strip, 'show', false);
    setInset(0);
    dismissArmed = false;
  }
  // any key / click dismisses and still performs its action (we never stop the event)
  const onAny = (ev: Event) => {
    if (!dismissArmed) return;
    if (ev.type === 'pointerdown' && ev.target instanceof Node && strip.contains(ev.target)) return; // the line's own click
    dismiss();
  };
  addEventListener('keydown', onAny, true);
  addEventListener('pointerdown', onAny, true);

  function lineAction(l: RecapLine): (() => void) | null {
    if (l.kind === 'blocked') return () => d.hooks.inbox(l.id);
    const id = l.id;
    if (!id) return null;
    if (l.kind === 'finished') return () => d.hooks.open(id);
    return () => d.hooks.goTo(id);
  }

  function show(lines: RecapLine[], minutes: number) {
    clearTimers();
    mins.textContent = `${minutes >= 90 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes)} min`} away`;
    const reduced = d.hooks.reduced();
    list.replaceChildren(...lines.map((l, i) => {
      const act = lineAction(l);
      const li = recapSlipLine(l, act ? () => { dismiss(); act(); } : null);
      li.style.setProperty('--i', String(i));
      if (!reduced) li.classList.add('wait');
      return li;
    }));
    cls(strip, 'reduced', reduced);
    cls(strip, 'show', true);
    setInset(strip.offsetHeight + 10);
    if (!reduced) {
      // lines take no space until they print (m2-r1: 4 empty ruled rows under the first line looked broken)
      [...list.children].forEach((li, i) => timers.push(setTimeout(() => { li.classList.remove('wait'); li.classList.add('type'); setInset(strip.offsetHeight + 10); }, 150 + i * LINE_MS)));
    }
    const total = (reduced ? 0 : lines.length * LINE_MS) + 7000;
    timers.push(setTimeout(() => { strip.classList.add('fade'); timers.push(setTimeout(() => { strip.classList.remove('fade'); dismiss(); }, 400)); }, total));
    setTimeout(() => { dismissArmed = true; }, 250); // the input that triggered the recap doesn't dismiss it
  }

  let firing = false;
  async function check(why: string): Promise<boolean> {
    ensureLoaded();
    const minutes = Number(d.settings.get('awayRecapMin') ?? 10);
    const saved = ls.get('lastPresentAt');
    const last = typeof saved === 'number' ? saved : null;
    const now = Date.now();
    if (last === null || !awayDue(last, now, minutes) || firing) { if (present()) touch(true); return false; }
    firing = true;
    touch(true);
    try { await recap(last, why); } finally { firing = false; }
    return true;
  }

  async function recap(since: number, why = 'check') {
    const skew = store.now() - Date.now();
    const sinceSrv = since + skew;
    let events = ring.since(sinceSrv);
    // after a reload the ring may be thin: merge the server timeline (§4.3.1)
    if (why !== 'fake' || !events.length) {
      try {
        const got = await new Promise<TimelineItem[]>((resolve) => {
          const off = store.on('timeline', (m) => { off(); resolve(m.items ?? []); });
          d.call({ t: 'timeline.get', since: Math.max(0, Math.floor(sinceSrv)) }).then((r) => { if (!r?.ok) { off(); resolve([]); } }).catch(() => { off(); resolve([]); });
          setTimeout(() => { off(); resolve([]); }, 800);
        });
        const seen = new Set(events.map((x) => `${x.at}|${x.id}|${x.kind}`));
        for (const it of got) {
          const x: RingItem = { at: it.at, id: it.id, name: names.get(it.id), kind: it.kind, to: it.to, detail: it.detail };
          if (!seen.has(`${x.at}|${x.id}|${x.kind}`)) events.push(x);
        }
        events.sort((a, b) => a.at - b.at);
      } catch { /* timeline optional */ }
    }
    const lines = buildRecap({ events, entities: store.entities.values(), now: store.now(), label: d.label });
    const minutes = (Date.now() - since) / 60_000;
    const scope = d.hooks.scope();
    d.bus?.emit?.('away.recap', { minutes, lines: lines.map((l) => `${l.strong ?? ''}${l.text}`) });
    d.hooks.announce(`While you were away: ${lines.map((l) => `${l.strong ?? ''}${l.text}`).join('. ')}`);
    const blocked = lines.find((l) => l.kind === 'blocked');
    if (scope === 'xterm') {
      d.hooks.drawerRecap(lines.map((l) => `${l.strong ?? ''}${l.text}`));
    } else if (blocked?.id) {
      // [m2-r1] one panel: the recap becomes the header of the (non-modal) Blocked Inbox instead of a second strip
      // stacked on top of it
      dismiss();
      d.hooks.inbox(blocked.id, { minutes, lines: lines.map((l) => ({ ...l, act: lineAction(l) })) });
    } else {
      show(lines, minutes);
    }
    return lines;
  }

  return {
    strip,
    /** `__hq.away(minutes)`: pretend lastPresentAt was N min ago and fire the recap check. */
    async fake(minutes: number) {
      ensureLoaded();
      ls.set('lastPresentAt', Date.now() - minutes * 60_000);
      const since = Date.now() - minutes * 60_000;
      const min = Number(d.settings.get('awayRecapMin') ?? 10);
      if (!awayDue(since, Date.now(), min || 10)) return null;
      touch(true);
      return recap(since, 'fake');
    },
    /** the strip, or the recap header inside the inbox */
    get showing() { return strip.classList.contains('show') || !!d.hooks.recapShown?.(); },
    dismiss,
    layout(left: number, right: number) { strip.style.left = `${left}px`; strip.style.right = `${right}px`; },
  };
}
