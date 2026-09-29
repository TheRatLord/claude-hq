/**
 * The one `screen.watch` arbiter (DESIGN §3.5 M3.5). Every renderer surface that wants live monitor text for some panes
 * (UI triage / peek / roster preview, the monitor atlas's proximity + nearest-visible desks) calls
 * `ctx.screens.want(tag, ids)`; this module unions every tag's ids by priority
 *   triage / peek (and any other explicit UI tag) > proximity > nearest-visible
 * caps the union at `hello.limits.watchMax` (8), drops ids the store does not know (the server rejects the whole
 * message on an unknown id), and is the ONLY sender of `screen.watch`, debounced to ≤ 2 Hz. A reconnect (`hello`) or a
 * fresh `world` resends the current set (the server forgets a dropped client's watches).
 * Pure logic + an injected `send` / clock, so it is unit-tested in node (screenFeed.test.ts).
 * Owner: RND.
 */
import type { ClientMsgOf } from '../../../shared/protocol.ts';

/** Tag priority ranks (lower wins). Unknown tags are user-explicit surfaces (inbox, card, hover preview): rank 0. */
export const TAG_RANK: Readonly<Record<string, number | undefined>> = Object.freeze({ triage: 0, peek: 0, proximity: 1, nearest: 2, visible: 2 });
export const MIN_INTERVAL_MS = 500; // ≤ 2 Hz

/**
 * @pure Union the tags' id lists by priority, first-come within a rank, capped.
 */
export function unionWatch(tags: ReadonlyMap<string, readonly string[]>, cap: number, known: (id: string) => boolean = () => true): string[] {
  const order = [...tags.keys()].sort((a, b) => (TAG_RANK[a] ?? 0) - (TAG_RANK[b] ?? 0));
  const out: string[] = [];
  for (const t of order) {
    for (const id of tags.get(t) ?? []) {
      if (out.length >= cap) return out;
      if (typeof id === 'string' && !out.includes(id) && known(id)) out.push(id);
    }
  }
  return out;
}

/** The slice of the net store the arbiter reads (the tests pass a fake). */
export interface ScreenFeedStore {
  limits?: { watchMax?: number };
  hello?: { limits?: { watchMax?: number } } | null;
  entities?: { has(id: string): boolean } | null;
  on?(evt: 'hello' | 'world' | 'gone', fn: () => void): unknown;
}

export interface ScreenFeedOpts<H = ReturnType<typeof setTimeout>> {
  store?: ScreenFeedStore | null;
  send: (msg: ClientMsgOf<'screen.watch'>) => unknown;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => H;
  clearTimer?: (h: H) => void;
}

export type ScreenFeed = ReturnType<typeof createScreenFeed>;

// The timer handle type H is whatever the injected setTimer returns (a fake in the tests); the defaults are the real
// timers, so their handle is cast to H once (a caller that injects timers injects both).
export function createScreenFeed<H = ReturnType<typeof setTimeout>>({ store = null, send, now = () => performance.now(), setTimer = ((f, ms) => setTimeout(f, ms)) as (fn: () => void, ms: number) => H, clearTimer = ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)) as (h: H) => void }: ScreenFeedOpts<H>) {
  const tags = new Map<string, string[]>();
  let sentKey: string | null = null, sentAt = -Infinity, timer: H | null = null, sends = 0;
  let current: string[] = [];
  const cap = () => store?.limits?.watchMax ?? store?.hello?.limits?.watchMax ?? 8;
  const known = (id: string) => !store?.entities || store.entities.has(id);

  function flush(force = false): void {
    timer = null;
    const ids = unionWatch(tags, cap(), known);
    const key = ids.join('\n');
    if (!force && key === sentKey) { current = ids; return; }
    const wait = sentAt + MIN_INTERVAL_MS - now();
    if (wait > 0) { timer = setTimer(() => flush(force), wait); return; }
    current = ids;
    sentKey = key; sentAt = now(); sends++;
    send({ t: 'screen.watch', ids });
  }
  const schedule = (force = false): void => {
    if (timer !== null) { if (!force) return; clearTimer(timer); timer = null; }
    flush(force);
  };

  if (store?.on) {
    store.on('hello', () => { sentKey = null; schedule(true); });
    store.on('world', () => schedule());
    store.on('gone', () => schedule());
  }

  return {
    /**
     * Declare (replace) the ids a tag wants watched. `ids` empty or null clears the tag.
     */
    want(tag: string, ids: readonly string[] | null | undefined): void {
      const prev = tags.get(tag);
      const next = ids && ids.length ? [...ids] : null;
      if (!next) { if (!prev) return; tags.delete(tag); }
      else if (prev && prev.length === next.length && prev.every((v, i) => v === next[i])) return;
      else tags.set(tag, next);
      schedule();
    },
    /** Ids currently sent to the server (after cap + unknown-id filtering). */
    watched: (): readonly string[] => current,
    /** True when `id` is in the sent watch set. */
    has: (id: string): boolean => current.includes(id),
    stats: () => ({ watched: current.length, cap: cap(), tags: Object.fromEntries([...tags].map(([k, v]) => [k, v.length])), sends }),
  };
}
