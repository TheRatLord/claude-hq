// @pure
/**
 * Drawer tab bookkeeping (§8.5 tab lifecycle): display order, MRU order, ≤ 6 tabs (LRU eviction), ≤ 2 WebGL holders
 * (active + MRU #2). Pure: the drawer applies the side effects this returns.
 * Owner: UI.
 */

export function createTabs(o: { max?: number; webglMax?: number } = {}) {
  const max = o.max ?? 6;
  const webglMax = o.webglMax ?? 2;
  /** display order (open order) */
  let order: string[] = [];
  /** most recent first */
  let mru: string[] = [];
  return {
    get order() { return order; },
    get mru() { return mru; },
    get active() { return mru[0] ?? null; },
    get previous() { return mru[1] ?? null; },
    has: (id: string) => order.includes(id),
    /**
     * Activate (opening if new). Returns {evict: ids to dispose, webgl: ids that should hold WebGL}.
     */
    activate(id: string) {
      if (!order.includes(id)) order.push(id);
      mru = [id, ...mru.filter((x) => x !== id)];
      const evict: string[] = [];
      while (order.length > max) {
        const victim = mru[mru.length - 1];
        mru = mru.slice(0, -1);
        order = order.filter((x) => x !== victim);
        evict.push(victim);
      }
      return { evict, webgl: mru.slice(0, webglMax) };
    },
    /** Remove a tab; returns the id that should become active (MRU next) or null. */
    remove(id: string): string | null {
      order = order.filter((x) => x !== id);
      const wasActive = mru[0] === id;
      mru = mru.filter((x) => x !== id);
      return wasActive ? mru[0] ?? null : mru[0] ?? null;
    },
    /** Neighbour in display order (dir ±1, wraps). */
    step(dir: number): string | null {
      if (!order.length) return null;
      const i = order.indexOf(mru[0]);
      return order[(i + dir + order.length) % order.length];
    },
    /** The LRU-oldest tab other than the active one (terminal_limit eviction). */
    lru(): string | null { return mru.length > 1 ? mru[mru.length - 1] : null; },
    rekey(oldId: string, newId: string) {
      order = order.map((x) => (x === oldId ? newId : x));
      mru = mru.map((x) => (x === oldId ? newId : x));
    },
  };
}

/**
 * [UI fix r2, reviewer code "six tabs truncate to 'm.', 'c', 'cl…'"] Short, DISTINCT tab labels for a crowded strip:
 * each label's first `k` characters (k from `min`, grown only where two tabs would read the same), keeping a
 * namesake suffix ('claude · 2' → 'claude·2', 'ledgerbot' → 'ledge…'), so two claude tabs always differ. Labels ≤ `min` + 1 chars stay whole.
 * `labels` = the full display labels (names.ts: namesakes carry ' · n').
 */
export function shortTabLabels(labels: readonly string[], min = 5): string[] {
  const parts = labels.map((l) => {
    const m = /^(.*?)\s*·\s*(\d+)$/.exec(String(l ?? ''));
    return m ? { base: m[1], suf: `·${m[2]}` } : { base: String(l ?? ''), suf: '' };
  });
  const cut = (p: { base: string; suf: string }, k: number) => (p.base.length <= k + 1 ? p.base : `${p.base.slice(0, k)}${p.suf ? '' : '…'}`) + p.suf;
  const ks = parts.map(() => min);
  for (let pass = 0; pass < 24; pass++) {
    const out = parts.map((p, i) => cut(p, ks[i]));
    const seen = new Map<string, number[]>();
    out.forEach((s, i) => { const g = seen.get(s) ?? []; g.push(i); seen.set(s, g); });
    let grew = false;
    for (const g of seen.values()) {
      if (g.length < 2) continue;
      for (const i of g) if (ks[i] < parts[i].base.length) { ks[i]++; grew = true; }
    }
    if (!grew) {
      // identical labels (no namesake suffix): number them
      const n = new Map<string, number>();
      return out.map((s) => { const c = (n.get(s) ?? 0) + 1; n.set(s, c); return (seen.get(s)?.length ?? 0) > 1 ? `${s}·${c}` : s; });
    }
  }
  return parts.map((p, i) => cut(p, ks[i]));
}
