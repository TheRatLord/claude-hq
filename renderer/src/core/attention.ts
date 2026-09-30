/**
 * Store-driven attention signals that must work in a hidden tab (channel 7): the `document.title` badge
 * and, when the window is unfocused and permission was already granted, one OS notification per new block
 * (rate limit 1 per agent per 10 s, bursts merge into one notification). Runs entirely off store listeners, never the
 * frame loop (rAF stops in hidden tabs).
 * The UI's `ui/notify.ts` (chime, toasts, chevrons) subscribes to the same store events and can read `attention.state()`;
 * it never needs to write the title itself.
 */

import type { Entity, Status } from '../../../shared/protocol.ts';
import type { StoreEvents } from '../net/store.ts';

const RATE_MS = 10_000;

/** Pure title formatter. */
export function titleFor({ blocked, unseen, session = null, demo = false }: { blocked: number; unseen: number; session?: string | null; demo?: boolean }): string {
  const where = demo ? ' · DEMO' : session && session !== 'default' ? ` · ${session}` : '';
  const base = `Claude HQ${where}`;
  if (!blocked) return base;
  return `${unseen ? '● ' : ''}(${blocked}) blocked — ${base}`;
}

/**
 * Pure transition tracker: which ids *became* blocked. The first snapshot seeds silently (nothing "became" blocked on
 * page load).
 */
export function createBlockTracker() {
  const last = new Map<string, Status>();
  let seeded = false;
  return {
    /** `entities`: the full set (world). Returns the newly blocked ids. */
    world(entities: Iterable<Pick<Entity, 'id' | 'status'>>): string[] {
      const fresh: string[] = [];
      const seen = new Set<string>();
      for (const e of entities) {
        seen.add(e.id);
        if (seeded && e.status === 'blocked' && last.get(e.id) !== 'blocked') fresh.push(e.id);
        last.set(e.id, e.status);
      }
      for (const id of [...last.keys()]) if (!seen.has(id)) last.delete(id);
      seeded = true;
      return fresh;
    },
    /** Did this entity just become blocked? */
    entity(e: Pick<Entity, 'id' | 'status'>): boolean {
      const prev = last.get(e.id);
      last.set(e.id, e.status);
      return e.status === 'blocked' && prev !== 'blocked';
    },
    gone(id: string) { last.delete(id); },
    blockedCount() { let n = 0; for (const s of last.values()) if (s === 'blocked') n++; return n; },
    isBlocked: (id: string) => last.get(id) === 'blocked',
  };
}

/** The entity fields the badge reads (the store's full `Entity` satisfies it). */
export type AttentionEntity = Pick<Entity, 'id' | 'status'> & Partial<Pick<Entity, 'name' | 'title' | 'prompt'>>;
/** The topics the badge listens to. */
type AttentionTopic = 'world' | 'entity' | 'gone' | 'event' | 'hello';
/** The slice of the store the attention badge listens to. */
export interface AttentionStore {
  on<K extends AttentionTopic>(evt: K, fn: (payload: StoreEvents[K]) => void): unknown;
  entities: Map<string, AttentionEntity>;
  hello: { session?: string | null } | null;
  demo: boolean;
}
/** The slice of `document` it uses (a test passes a plain object). */
export interface AttentionDoc {
  hidden: boolean;
  title: string;
  hasFocus?(): boolean;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
}
/** The slice of `window` it uses. */
export interface AttentionWin {
  Notification?: typeof Notification;
  focus(): void;
  addEventListener(type: 'focus', fn: () => void): void;
}

export function createAttention({ store, doc = document, win = window }: { store: AttentionStore; doc?: AttentionDoc; win?: AttentionWin }) {
  const tracker = createBlockTracker();
  /** ids that became blocked while the page was not attended */
  const unseen = new Set<string>();
  /** id → last OS notification ms */
  const notifiedAt = new Map<string, number>();
  let pendingNotify: string[] = [];
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  let title = '';
  let muted = false;

  const attended = () => !doc.hidden && (typeof doc.hasFocus !== 'function' || doc.hasFocus());

  const render = () => {
    for (const id of unseen) if (!tracker.isBlocked(id)) unseen.delete(id);
    const t = titleFor({ blocked: tracker.blockedCount(), unseen: unseen.size, session: store.hello?.session, demo: store.demo });
    if (t !== title) doc.title = title = t;
  };

  const flushNotify = () => {
    notifyTimer = null;
    const ids = pendingNotify.filter((id) => tracker.isBlocked(id));
    pendingNotify = [];
    if (!ids.length || muted || attended()) return;
    const N = win.Notification;
    if (!N || N.permission !== 'granted') return;
    const names = ids.map((id) => store.entities.get(id)?.name ?? id);
    const first = store.entities.get(ids[0]);
    const body = ids.length === 1 ? (first?.prompt?.question || first?.title || 'needs you') : names.join(', ');
    try {
      const n = new N(ids.length === 1 ? `${names[0]} is blocked` : `${ids.length} agents are blocked`, { body, tag: 'hq-blocked', silent: true });
      n.onclick = () => { win.focus(); n.close(); };
    } catch { /* notifications unavailable (e.g. insecure context) */ }
  };

  const becameBlocked = (id: string) => {
    if (!attended()) unseen.add(id);
    const now = Date.now();
    if ((notifiedAt.get(id) ?? -Infinity) + RATE_MS > now) return;
    notifiedAt.set(id, now);
    pendingNotify.push(id);
    if (!notifyTimer) notifyTimer = setTimeout(flushNotify, 400); // bursts merge
  };

  const onWorld = () => { for (const id of tracker.world(store.entities.values())) becameBlocked(id); render(); };
  store.on('world', onWorld);
  store.on('entity', (e) => { if (tracker.entity(e)) becameBlocked(e.id); render(); });
  store.on('gone', (g) => { tracker.gone(g.id); unseen.delete(g.id); notifiedAt.delete(g.id); render(); });
  store.on('event', (ev) => {
    // The entity usually lands with the event; this covers an event-first ordering.
    if (ev.kind === 'blocked' && !unseen.has(ev.id) && !attended() && store.entities.get(ev.id)?.status === 'blocked') {
      unseen.add(ev.id);
      render();
    }
  });
  store.on('hello', render);

  const onAttend = () => { if (attended() && unseen.size) { unseen.clear(); render(); } };
  doc.addEventListener('visibilitychange', onAttend);
  win.addEventListener('focus', onAttend);
  render();

  return {
    state: (): { blocked: number; unseen: string[]; title: string } => ({ blocked: tracker.blockedCount(), unseen: [...unseen], title }),
    /** Mute OS notifications (the title badge always stays). */
    setMuted(b: boolean) { muted = !!b; },
  };
}
