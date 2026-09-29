/**
 * Notification stack (§8 "Notifications", GP §5.4; UI kit §3 Ticket): what the UI does when an agent becomes blocked
 * or finishes. Toasts are receipt tickets (hud.toast): stub lamp + running wait, caption `14:02 · ws › tab`, headline,
 * the agent's line in serif, then the key legend.
 *   blocked → toast (question + key hint that follows focus, click = open), assertive live region, bus
 *             `notify {kind:'blocked', id, pos}`. The chime + spatial ding are AUD's (audio/index.ts listens to the
 *             store itself); the edge chevron, minimap pulse and title / OS badge are their own channels
 *             (chevrons.ts, minimap.ts, core/attention.ts).
 *   done    → a soft green toast (bursts within 1.5 s merge: "3 agents finished"; pref `doneToasts`), polite live
 *             region, bus `notify {kind:'done'}`.
 * Rate limit: 1 per agent per 10 s. Driven by store events (§3.4), so it also fires in hidden tabs.
 * Owner: UI.
 */
import { h } from './dom.ts';
import { hintLegend, type createHud } from './hud.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Store } from '../net/store.ts';
import type { Bus, WorldPos } from '../core/bus.ts';
import type { createPrefs } from './settings.ts';
import type { Lamp } from './kit/index.ts';
import { nameQualifier } from './roster/model.ts';
import { firstQuestionLine } from './serveModel.ts';

export const NOTIFY_RATE_MS = 10_000;
const DONE_MERGE_MS = 1500;
/** blocked toasts this close together merge into one (a burst of four used to stack four red cards for 8 s) */
export const BLOCKED_MERGE_MS = 1500;
/** how long a resolved blocked toast shows 'answered ✓' before it fades */
export const RESOLVED_MS = 1400;

export interface NotifyDeps {
  store: Pick<Store, 'entities' | 'now'>;
  hud: Pick<ReturnType<typeof createHud>, 'toast' | 'announce'>;
  bus?: Bus | null;
  prefs: Pick<ReturnType<typeof createPrefs>, 'get'>;
  label?: (e: Named) => string;
  hooks: {
    open(id: string): void; inbox(): void; drawerLayer(): boolean; hint(): string; pos?(id: string): WorldPos | null | undefined;
    inboxOpen?(): boolean;
  };
}

type Named = Pick<Entity, 'id' | 'name'>;

/** The live blocked burst (see `blocked`). */
interface Burst { ids: string[]; last: number; t: HTMLElement | null; n: number }

export function createNotify(d: NotifyDeps) {
  const { store, hud, prefs } = d;
  const lastNotify = new Map<string, number>();
  /** live blocked toasts by id, so a late-parsed question can be filled in */
  const blockedToasts = new Map<string, HTMLElement>();

  const rateOk = (id: string) => {
    const now = performance.now();
    if (now - (lastNotify.get(id) ?? -1e9) < NOTIFY_RATE_MS) return false;
    lastNotify.set(id, now);
    return true;
  };

  const lab = (e: Named) => (d.label ? d.label(e) : e.name);
  /** wall-clock time of the ticket (receipt caption) */
  const clock = () => new Date().toTimeString().slice(0, 5);
  /** `14:02 · ws › tab` */
  const captionOf = (e: Entity) => [clock(), [e.workspace?.label, e.tab?.label].filter(Boolean).join(' › ')].filter(Boolean).join(' · ');
  /** swap a ticket's key legend for new hint text (the hint follows focus, §8.2) */
  const setHint = (t: HTMLElement, text: string) => {
    const el = t.querySelector<HTMLElement>('.hint');
    if (!el || el.dataset.hint === text) return;
    const nu = hintLegend(text, { cls: 'hint', small: t.classList.contains('line') });
    nu.dataset.hint = text;
    nu.hidden = el.hidden;
    el.replaceWith(nu);
  };
  /** the live blocked burst: ids blocked within BLOCKED_MERGE_MS of each other share one toast (reviewer m2-r2) */
  let burst: Burst | null = null;
  let burstSeq = 0;

  function blocked(e: Entity) {
    if (!rateOk(`b:${e.id}`)) return;
    const q = firstQuestionLine(e.prompt?.question);
    const qual = nameQualifier(e, store.entities.values());
    hud.announce(`${qual ? `${qual}, ` : ''}${lab(e)} is blocked${q ? `: ${q}` : ''}`, true);
    d.bus?.emit('notify', { kind: 'blocked', id: e.id, pos: d.hooks.pos?.(e.id) ?? null });
    // the open Blocked Inbox already lists them: no second red card over the world
    if (d.hooks.inboxOpen?.()) return;
    const now = performance.now();
    const live = burst && now - burst.last < BLOCKED_MERGE_MS && burst.t?.isConnected && !burst.t.classList.contains('resolved');
    if (live && burst) {
      burst.ids = burst.ids.filter((id) => blockedToasts.get(id) === burst?.t);
      burst.ids.push(e.id);
      burst.last = now;
      const old = burst.t;
      const t = mergedToast(burst.ids);
      old?.remove();
      burst.t = t;
      for (const id of burst.ids) blockedToasts.set(id, t);
      return;
    }
    const t = hud.toast('blocked', h('span', null, qual ? h('span.ql', { text: `${qual} › ` }) : null, lab(e), h('span.st', { text: ' is blocked' })), {
      sub: q,
      hint: d.hooks.hint(),
      caption: captionOf(e),
      since: e.statusSince || store.now?.(),
      drawer: d.hooks.drawerLayer(),
      key: `blocked:${e.id}`,
      onClick: () => { if (!t.classList.contains('resolved')) d.hooks.open(e.id); },
    });
    blockedToasts.set(e.id, t);
    burst = { ids: [e.id], last: now, t, n: ++burstSeq };
  }

  /** One toast for a burst: '3 agents blocked' · 'orbit, comet, pike' · 'B inbox'. Click = the inbox. */
  function mergedToast(ids: string[]) {
    const es = ids.flatMap((id) => store.entities.get(id) ?? []);
    const t = hud.toast('blocked', h('span', null, h('span.cnt', { text: `${ids.length} agents` }), h('span.st', { text: ' blocked' })), {
      sub: namesOf(ids),
      hint: burstHint(),
      caption: clock(),
      since: Math.min(...es.map((x) => x.statusSince || Infinity), store.now?.() ?? Date.now()),
      drawer: d.hooks.drawerLayer(),
      key: `blocked:burst:${burst?.n ?? ++burstSeq}`,
      onClick: () => { if (!t.classList.contains('resolved')) d.hooks.inbox(); },
    });
    t.dataset.ids = ids.join(' ');
    return t;
  }
  /** the focus-following key hint, with the click going to the inbox rather than one terminal */
  const burstHint = () => String(d.hooks.hint()).replace(/click to open$/, 'click for the inbox');
  const namesOf = (ids: string[]) => ids.flatMap((id) => store.entities.get(id) ?? []).map((x) => lab(x)).join(', ');

  let doneBurst: { ids: string[]; timer: ReturnType<typeof setTimeout> | null } | null = null;
  function done(e: Entity) {
    if (e.kind === 'shell' || !rateOk(`d:${e.id}`)) return;
    hud.announce(`${lab(e)} finished`);
    d.bus?.emit('notify', { kind: 'done', id: e.id, pos: d.hooks.pos?.(e.id) ?? null });
    if (prefs.get('doneToasts') === false) return;
    doneBurst ??= { ids: [], timer: null };
    doneBurst.ids.push(e.id);
    if (doneBurst.timer) clearTimeout(doneBurst.timer);
    const flush = () => {
      const ids = doneBurst?.ids ?? [];
      doneBurst = null;
      const es = ids.flatMap((id) => store.entities.get(id) ?? []);
      if (!es.length) return;
      const one = es.length === 1;
      const inDrawer = d.hooks.drawerLayer();
      hud.toast('done', one ? `${lab(es[0])} finished` : `${es.length} agents finished`, {
        sub: one ? (es[0].title || es[0].lastPrompt || 'waiting for your sign-off') : es.map((x) => lab(x)).join(', '),
        // (world scope only: in the drawer a bare B would be typed into the pane)
        hint: inDrawer ? undefined : one ? '[B] inbox · [G] high-five when you are there' : '[B] inbox → Done · sign off all',
        caption: one ? captionOf(es[0]) : clock(),
        drawer: d.hooks.drawerLayer(),
        key: 'done',
        ttl: 5000,
        onClick: () => (one ? d.hooks.open(es[0].id) : d.hooks.inbox()),
      });
    };
    doneBurst.timer = setTimeout(flush, DONE_MERGE_MS);
  }

  /**
   * [m2-r1] a blocked toast must not outlive the block: on an answer from HQ or any status change away from blocked it
   * turns into a calm green 'answered ✓' / 'unblocked ✓' line (no click-through) and fades after RESOLVED_MS.
   */
  function resolve(id: string, how: 'answered' | 'unblocked') {
    const t = blockedToasts.get(id);
    blockedToasts.delete(id);
    if (!t || !t.isConnected || t.classList.contains('resolved')) return;
    if (t.dataset.ids) {
      // a merged burst toast: drop this one; it resolves only when the last of them does
      const rest = t.dataset.ids.split(' ').filter((x) => x !== id && blockedToasts.get(x) === t);
      t.dataset.ids = rest.join(' ');
      if (burst?.t === t) burst.ids = rest;
      if (rest.length) {
        const c = t.querySelector('.cnt');
        if (c) c.textContent = rest.length === 1 ? lab(store.entities.get(rest[0]) ?? { id: rest[0], name: rest[0] }) : `${rest.length} agents`;
        const st = t.querySelector('.st');
        if (st && rest.length === 1) st.textContent = ' is blocked';
        setHint(t, burstHint());
        const sub = t.querySelector('.sub');
        if (sub) sub.textContent = rest.length === 1 ? (firstQuestionLine(store.entities.get(rest[0])?.prompt?.question) || '') : namesOf(rest);
        return;
      }
    }
    t.classList.add('resolved');
    t.setAttribute('role', 'status');
    t.style.cursor = '';
    const st = t.querySelector('.st');
    if (st) st.textContent = how === 'answered' ? ' answered ✓' : ' unblocked ✓';
    t.classList.add('done');
    t.querySelector<Lamp>('.stub .k-lamp')?.set?.('done');
    for (const x of t.querySelectorAll<HTMLElement>('.sub, .hint, .tear')) x.hidden = true;
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, RESOLVED_MS);
  }

  /** The blocked parser often lands the question one entity update after the status flip. */
  function fill(e: Entity) {
    const t = blockedToasts.get(e.id);
    if (!t) return;
    if (!t.isConnected) { blockedToasts.delete(e.id); return; }
    if (e.status !== 'blocked') { resolve(e.id, 'unblocked'); return; }
    if (t.dataset.ids) return; // merged: the names line stays
    const sub = t.querySelector<HTMLElement>('.sub');
    const q = firstQuestionLine(e.prompt?.question);
    if (sub && q && sub.textContent !== q) { sub.textContent = q; sub.hidden = false; }
  }

  /** The toast's key hint follows focus (§8.2): refresh every live blocked toast on a scope change. */
  function refreshHints() {
    if (!blockedToasts.size) return;
    const text = d.hooks.hint();
    for (const [id, t] of blockedToasts) {
      if (!t.isConnected) { blockedToasts.delete(id); continue; }
      setHint(t, t.dataset.ids ? burstHint() : text);
    }
  }

  /** The Blocked Inbox opened: its cards replace the red toasts (they fold away, no 'answered' flash). */
  function foldBlocked() {
    for (const [id, t] of blockedToasts) {
      blockedToasts.delete(id);
      if (!t.isConnected || t.classList.contains('out')) continue;
      t.classList.add('out');
      setTimeout(() => t.remove(), 220);
    }
    burst = null;
  }

  return { blocked, done, fill, refreshHints, foldBlocked, answered: (id: string) => resolve(id, 'answered'), resolve, gone: (id: string) => resolve(id, 'unblocked'), get count() { return blockedToasts.size; } };
}
