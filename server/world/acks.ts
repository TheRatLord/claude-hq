/**
 * HQ-side done sign-off overlay, an Enricher (`acks`: owns `ack`, emits `acked`).
 * `done.ack {id, stateSeq}` stores `{stateSeq, at}` per stable identity in `acks.json`; `Entity.ack` is non-null only
 * while status === 'done' and stateSeq is unchanged. Keyed by identity so it follows re-keys.
 * Touches nothing in herdr.
 */
import { Enricher } from '../interfaces.ts';
import type { BaseEntity, Clock, Logger } from '../interfaces.ts';
import type { Ack } from '../../shared/protocol.ts';
import { identityKey } from '../../shared/identity.ts';
import { JsonFile } from './persist.ts';
import { ERR } from '../../shared/protocol.ts';

/** Persisted per identity key. */
interface AckRecord { stateSeq: number | null; at: number }

export class AcksEnricher extends Enricher {
  clock: Clock;
  doc: JsonFile<AckRecord>;
  map: Record<string, AckRecord>;
  /** id → base */
  bases: Map<string, BaseEntity>;

  constructor({ dir, clock, log }: { dir: string | null; clock: Clock; log?: Partial<Logger> }) {
    super('acks');
    this.clock = clock;
    this.doc = new JsonFile<AckRecord>({ dir, name: 'acks.json', clock, log });
    this.map = this.doc.data;
    this.bases = new Map();
  }

  override attach(id: string, base: BaseEntity): void {
    this.update(id, base);
  }

  override update(id: string, base: BaseEntity): void {
    this.bases.set(id, base);
    const k = identityKey(base.identity);
    const r = k ? this.map[k] : null;
    if (r && (base.status !== 'done' || r.stateSeq !== base.stateSeq)) {
      delete this.map[k];
      this.doc.touch();
    }
    const cur = k ? this.map[k] : null;
    this.onPatch(id, { ack: cur ? { at: cur.at, by: 'hq' } : null });
  }

  override detach(id: string): void {
    this.bases.delete(id);
  }

  /** `done.ack`. Throws not_accepted unless the pane is done at exactly `stateSeq`. */
  ack(id: string, stateSeq: number | null): { ack: Ack } {
    const base = this.bases.get(id);
    if (!base) throw Object.assign(new Error('unknown pane'), { code: ERR.UNKNOWN_ENTITY });
    if (base.status !== 'done' || (base.stateSeq ?? null) !== (stateSeq ?? null)) {
      throw Object.assign(new Error(`not done at stateSeq ${stateSeq}`), { code: ERR.NOT_ACCEPTED });
    }
    const k = identityKey(base.identity);
    if (!k) throw Object.assign(new Error('pane has no stable identity'), { code: ERR.NOT_ACCEPTED });
    if (this.map[k]?.stateSeq === stateSeq) return { ack: { at: this.map[k].at, by: 'hq' } };
    const at = this.clock.now();
    this.map[k] = { stateSeq, at };
    this.doc.touch();
    this.onPatch(id, { ack: { at, by: 'hq' } });
    this.emitEvent(id, 'acked');
    return { ack: { at, by: 'hq' } };
  }

  override async close(): Promise<void> {
    this.doc.flush();
  }
}
