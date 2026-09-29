/**
 * HQ action audit log (DESIGN §4.8, M2; read endpoint `GET /api/audit?n=50` for the Recent HQ actions panel, M3). Every promote, takeover, answer, prompt, keys,
 * focus, resize, spawn and close appends `{at, session, cid, action, paneId, ok, error?}` to
 * `~/.config/claude-hq/<session>/audit.ndjson` (0600, rotated at 1 MB into `audit.1.ndjson`).
 * **Metadata only: never bytes, prompt text, keys or answers.** `dir = null` (demo/replay/tests) keeps only the
 * in-memory ring that `recent()` serves. Owner: BE.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isRecord, errMessage } from '../shared/guards.ts';
import type { Clock, Logger } from './interfaces.ts';

export type AuditAction = 'takeover' | 'promote' | 'resize' | 'answer' | 'prompt' | 'keys' | 'focus' | 'spawn' | 'close';

/** One audit entry; metadata only. */
export interface AuditEntry {
  at: number;
  session: string;
  cid: string | null;
  action: string;
  paneId: string | null;
  ok: boolean;
  error?: string;
}

export interface AuditRecordInput {
  cid?: string | null;
  action: string;
  paneId?: string | null;
  ok: boolean;
  error?: string | null;
}

export interface AuditOpts {
  dir: string | null;
  session: string;
  clock: Pick<Clock, 'now'>;
  log?: Pick<Logger, 'warn'>;
  rotateBytes?: number;
}

export const AUDIT_ROTATE_BYTES = 1024 * 1024;
const RING = 200;

/** renderer message `t` → audit action (null = not audited). `term.promote` with takeover → 'takeover'. */
export function auditAction(msg: { t?: string; takeover?: boolean } | null | undefined): AuditAction | null {
  switch (msg?.t) {
    case 'term.promote': return msg.takeover ? 'takeover' : 'promote';
    case 'term.resize': return 'resize';
    case 'agent.answer': return 'answer';
    case 'agent.prompt': return 'prompt';
    case 'agent.keys': return 'keys';
    case 'herdr.focus': return 'focus';
    case 'spawn': return 'spawn';
    case 'pane.close': return 'close';
    default: return null;
  }
}

// on-disk lines are our own records: only the discriminating field is checked
const isAuditEntry = (e: unknown): e is AuditEntry => isRecord(e) && typeof e.action === 'string';

export class AuditLog {
  file: string | null;
  old: string | null;
  session: string;
  clock: Pick<Clock, 'now'>;
  log: Pick<Logger, 'warn'>;
  rotateBytes: number;
  ring: AuditEntry[];
  count: number;
  constructor({ dir, session, clock, log, rotateBytes = AUDIT_ROTATE_BYTES }: AuditOpts) {
    this.file = dir ? path.join(dir, 'audit.ndjson') : null;
    this.old = dir ? path.join(dir, 'audit.1.ndjson') : null;
    this.session = session;
    this.clock = clock;
    this.log = log ?? { warn() {} };
    this.rotateBytes = rotateBytes;
    this.ring = [];
    this.count = 0;
  }

  record({ cid, action, paneId, ok, error }: AuditRecordInput): AuditEntry {
    const entry: AuditEntry = { at: this.clock.now(), session: this.session, cid: cid ?? null, action, paneId: paneId ?? null, ok: !!ok };
    if (!ok && error) entry.error = String(error).slice(0, 40);
    this.count++;
    this.ring.push(entry);
    if (this.ring.length > RING) this.ring.shift();
    if (!this.file || !this.old) return entry; // `old` is set whenever `file` is
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n', { mode: 0o600 });
      if (fs.statSync(this.file).size > this.rotateBytes) fs.renameSync(this.file, this.old);
    } catch (e) {
      this.log.warn?.(`audit: ${errMessage(e)}`);
    }
    return entry;
  }

  /** Newest last. */
  recent(n = 50): AuditEntry[] {
    return this.ring.slice(-n);
  }

  /**
   * The last `n` entries for the Recent HQ actions panel (GET /api/audit): from disk (this run and earlier runs,
   * `audit.ndjson` then the rotated `audit.1.ndjson`), else the in-memory ring. Newest last; malformed lines skipped.
   * Reads at most the last 256 KB of each file (an entry is ~120 bytes).
   */
  read(n = 50): AuditEntry[] {
    n = Math.max(1, Math.min(500, Math.floor(Number(n)) || 50));
    if (!this.file || !this.old) return this.recent(n);
    const out: AuditEntry[] = [];
    for (const f of [this.file, this.old]) {
      if (out.length >= n) break;
      const lines = tailLines(f, 256 * 1024);
      const got: AuditEntry[] = [];
      for (const l of lines) {
        try {
          const e: unknown = JSON.parse(l);
          if (isAuditEntry(e)) got.push(e);
        } catch {}
      }
      out.unshift(...got.slice(-(n - out.length)));
    }
    return out;
  }

  metrics(): { entries: number } {
    return { entries: this.count };
  }
}

/** Complete lines in the last `max` bytes of a file ([] when missing). */
function tailLines(file: string, max: number): string[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    if (len < size) lines.shift(); // first line is partial
    return lines;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
