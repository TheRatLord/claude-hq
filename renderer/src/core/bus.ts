// @pure
/** Synchronous typed event bus. Callers supply their own topic-to-payload schema. */
export interface Bus<E extends object> {
  /** returns an unsubscribe fn */
  on<K extends keyof E>(topic: K, fn: (payload: E[K]) => void): () => void;
  once<K extends keyof E>(topic: K, fn: (payload: E[K]) => void): () => void;
  off<K extends keyof E>(topic: K, fn: (payload: E[K]) => void): void;
  /** listener errors are caught and logged, never propagate */
  emit<K extends keyof E>(topic: K, payload: E[K]): void;
}

export function createBus<E extends object>(): Bus<E> {
  type Listener = (payload: E[keyof E]) => void;
  const topics = new Map<keyof E, Set<Listener>>();
  // The one cast: a listener for topic K is stored in the shared per-topic set, and only ever called with topic K's payload.
  const store = <K extends keyof E>(fn: (payload: E[K]) => void) => fn as Listener;
  const off: Bus<E>['off'] = (topic, fn) => { topics.get(topic)?.delete(store(fn)); };
  const on: Bus<E>['on'] = (topic, fn) => {
    let s = topics.get(topic);
    if (!s) topics.set(topic, (s = new Set()));
    s.add(store(fn));
    return () => off(topic, fn);
  };
  const once: Bus<E>['once'] = (topic, fn) => {
    const w = (p: E[typeof topic]) => { off(topic, w); fn(p); };
    return on(topic, w);
  };
  const emit: Bus<E>['emit'] = (topic, payload) => {
    const s = topics.get(topic);
    if (!s) return;
    for (const fn of [...s]) {
      try { fn(payload); } catch (e) { console.error(`[bus] ${String(topic)} listener threw`, e); }
    }
  };
  return { on, once, off, emit };
}
