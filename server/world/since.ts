/**
 * Honest `statusSince` across restarts (DESIGN §4.3.1), persisted in `since.json`:
 *   {[stableKey]: {stateSeq, status, since, approx, activity?, seen, hinted?}}   stableKey = identityKey(identity)
 * On sighting: same stateSeq + status → reuse since/approx. Changed stateSeq or status (shells: status or
 * process.activity) → since = now, approx = false. First-ever sighting → since = now, approx = true, then ONE
 * `hint(ms)` is accepted (since = min(now, hint), still approx). Entries unseen for 24 h are pruned. Owner: BE.
 */
import { JsonFile } from './persist.ts';
import type { Clock, Logger } from '../interfaces.ts';

/** One persisted record per stable identity key. */
export interface SinceRecord {
  stateSeq: number | null;
  status: string;
  since: number;
  approx: boolean;
  activity?: string;
  seen: number;
  hinted?: boolean;
}

export const SINCE_PRUNE_MS = 24 * 3600_000;

export class SinceStore {
  clock: Clock;
  doc: JsonFile<SinceRecord>;
  map: Record<string, SinceRecord>;
  _lastSeenWrite: number;

  constructor({ dir, clock, log }: { dir: string | null; clock: Clock; log?: Partial<Logger> }) {
    this.clock = clock;
    this.doc = new JsonFile<SinceRecord>({ dir, name: 'since.json', clock, log });
    this.map = this.doc.data;
    this._lastSeenWrite = clock.now();
    this.prune();
  }

  /** `key` = stable key ('' → not persisted, treated as first-ever). */
  observe(key: string, { status, stateSeq }: { status: string; stateSeq: number | null }): { since: number; approx: boolean } {
    const now = this.clock.now();
    if (!key) return { since: now, approx: true };
    let r = this.map[key];
    if (!r) {
      r = this.map[key] = { stateSeq, status, since: now, approx: true, seen: now };
      this.doc.touch();
    } else if (r.status !== status || (stateSeq != null && r.stateSeq != null && r.stateSeq !== stateSeq)) {
      Object.assign(r, { stateSeq, status, since: now, approx: false, hinted: true, seen: now });
      this.doc.touch();
    } else {
      if (stateSeq != null && r.stateSeq == null) r.stateSeq = stateSeq;
      r.seen = now;
      if (now - this._lastSeenWrite > 60_000) {
        this._lastSeenWrite = now;
        this.doc.touch();
      }
    }
    return { since: r.since, approx: !!r.approx };
  }

  /** Shell `process.activity` change → new since (not approx). Returns true if `since` changed. */
  activity(key: string, activity: string | null | undefined): boolean {
    const r = key ? this.map[key] : null;
    if (!r || activity == null) return false;
    if (r.activity === activity) return false;
    const first = r.activity === undefined;
    r.activity = activity;
    this.doc.touch();
    if (first) return false;
    r.since = this.clock.now();
    r.approx = false;
    r.hinted = true;
    return true;
  }

  /** Accept one hint for a first-ever (approx) sighting. Returns the new since or null. */
  hint(key: string, ms: unknown): number | null {
    const r = key ? this.map[key] : null;
    if (!r || !r.approx || r.hinted || typeof ms !== 'number' || !Number.isFinite(ms)) return null;
    r.hinted = true;
    r.since = Math.min(this.clock.now(), ms);
    this.doc.touch();
    return r.since;
  }

  get(key: string): SinceRecord | null {
    return this.map[key] ?? null;
  }

  /** Re-key (identity key changed, e.g. place → terminalId after a restore). */
  rekey(oldKey: string, newKey: string): void {
    if (!oldKey || !newKey || oldKey === newKey || !this.map[oldKey]) return;
    this.map[newKey] = this.map[oldKey]; // the old record wins over a fresh first sighting of the new key
    delete this.map[oldKey];
    this.doc.touch();
  }

  prune(): void {
    const now = this.clock.now();
    for (const [k, r] of Object.entries(this.map)) if (!r || now - (r.seen ?? 0) > SINCE_PRUNE_MS) delete this.map[k];
  }

  close(): void {
    this.doc.flush();
  }
}
