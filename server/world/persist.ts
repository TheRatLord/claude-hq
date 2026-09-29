/**
 * Tiny persisted JSON document per session (`~/.config/claude-hq/<session>/<name>.json`, 0600): debounced atomic
 * writes through the injectable clock, flush on close. `dir = null` → memory only (tests, --demo). Owner: BE.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Clock, Logger, TimerHandle } from '../interfaces.ts';
import { errMessage, isRecord } from '../../shared/guards.ts';

export interface JsonFileOptions {
  dir: string | null;
  name: string;
  clock: Clock;
  debounceMs?: number;
  log?: Partial<Logger>;
}

/** `V` = the value type of the document's entries (the caller owns and sanitises what it reads back). */
export class JsonFile<V = unknown> {
  file: string | null;
  clock: Clock;
  debounceMs: number;
  log: Partial<Logger> | undefined;
  _timer: TimerHandle | null;
  data: Record<string, V>;

  constructor({ dir, name, clock, debounceMs = 1000, log }: JsonFileOptions) {
    this.file = dir ? path.join(dir, name) : null;
    this.clock = clock;
    this.debounceMs = debounceMs;
    this.log = log;
    this._timer = null;
    this.data = {};
    if (this.file) {
      try {
        const d: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        // a JSON object; its entries are validated by each owner (acks/notes/since/slots) as before
        if (isRecord(d)) this.data = d as Record<string, V>;
      } catch {}
    }
  }
  /** Mark dirty; write after the debounce. */
  touch(): void {
    if (!this.file || this._timer) return;
    this._timer = this.clock.setTimeout(() => {
      this._timer = null;
      this.flush();
    }, this.debounceMs);
  }
  flush(): void {
    this.clock.clearTimeout(this._timer);
    this._timer = null;
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.log?.warn?.(`persist ${this.file}: ${errMessage(e)}`);
    }
  }
}
