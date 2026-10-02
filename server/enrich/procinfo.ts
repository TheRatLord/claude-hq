/**
 * Process-info enricher: polls herdr `pane.process_info` every 2.5 s for shell panes and every 10 s
 * for agent panes, and patches `process` = {name, argv, activity} (ShellActivity via shared/classify.ts). `res` stays
 * null for now. Emits `commit` for shells whose foreground argv is a `git commit|push` (shells only), and `news
 * {src:'shell', lines}`: the tail of `pane.read recent_unwrapped` is diffed against the previous one each poll
 * (shellNews; the last line, the prompt / cursor line redrawn constantly, never counts) and new lines accumulate while a
 * command runs; ONE news fires when the shell is back at its prompt ("meaningful news": a finished command, not
 * every chunk a dev server or `tail -f` prints). Full-screen activities (monitor, edit) are not news.
 * Every poll also sniffs the foreground process for an agent CLI (shared/vendors.ts `vendorOfInfo`) and tells the
 * model through `ctx.agentHint` (Aider / Goose / Crush in a plain shell pane become agents; WorldModel ignores the
 * hint for panes herdr labels itself).
 * Works unchanged against HerdrLive, DemoWorld and Replay (it only calls `source.request`).
 */
import { Enricher } from '../interfaces.ts';
import type { BaseEntity, Clock, EnricherCtx, HerdrSource, Logger, TimerHandle } from '../interfaces.ts';
import { processFromInfo, isGitCommit } from '../../shared/classify.ts';
import type { HerdrProcessInfo } from '../../shared/classify.ts';
import type { ProcessInfo } from '../../shared/protocol.ts';
import { isRecord, errMessage } from '../../shared/guards.ts';
import { vendorOfInfo } from '../../shared/vendors.ts';

const SHELL_MS = 2500;
const AGENT_MS = 10_000;
const NEWS_TAIL = 60;
const NO_NEWS = new Set(['monitor', 'edit']); // full-screen TUIs redraw constantly

/**
 * New output lines between two tails of a shell. The final line of each tail is the live prompt/cursor line and
 * is ignored; the previous tail's last ≤ 4 settled lines anchor the overlap. No anchor found (cleared screen, a burst
 * bigger than the tail) → every settled line of the new tail counts. Blank lines never count.
 */
export function shellNews(prev: string[] | null, cur: string[]): number {
  if (!prev) return 0;
  const settled = (a: string[]) => a.slice(0, -1);
  const p = settled(prev), c = settled(cur);
  if (p.join('\n') === c.join('\n')) return 0;
  const k = Math.min(4, p.length);
  let from = 0;
  if (k) {
    const anchor = p.slice(-k).join('\n');
    from = -1;
    for (let i = c.length - k; i >= 0; i--) {
      if (c.slice(i, i + k).join('\n') === anchor) {
        from = i + k;
        break;
      }
    }
    if (from < 0) from = 0;
  }
  let n = 0;
  for (let i = from; i < c.length; i++) if (c[i].trim()) n++;
  return n;
}

/** Per-pane record. */
interface Rec {
  id: string;
  shell: boolean;
  timer: TimerHandle | null;
  busy: boolean;
  sent: string;
  lastCommitArgv: string | null;
  dead: boolean;
  tail: string[] | null;
  pending: number;
  ctx: EnricherCtx | null;
}

/** herdr's reply is `{process_info}` (or the info itself). Only the container shape is checked here. */
const isProcessInfo = (v: unknown): v is HerdrProcessInfo => isRecord(v) && (v.foreground_processes === undefined || Array.isArray(v.foreground_processes));

export interface ProcInfoOpts { source: Pick<HerdrSource, 'request' | 'connected'>; clock: Clock; log?: Pick<Logger, 'debug'>; shellMs?: number; agentMs?: number }

export class ProcInfoEnricher extends Enricher {
  source: Pick<HerdrSource, 'request' | 'connected'>;
  clock: Clock;
  log: Pick<Logger, 'debug'>;
  shellMs: number;
  agentMs: number;
  recs: Map<string, Rec>;
  constructor({ source, clock, log, shellMs = SHELL_MS, agentMs = AGENT_MS }: ProcInfoOpts) {
    super('procinfo');
    this.source = source;
    this.clock = clock;
    this.log = log ?? { debug() {} };
    this.shellMs = shellMs;
    this.agentMs = agentMs;
    this.recs = new Map();
  }

  override attach(id: string, base: BaseEntity, ctx?: EnricherCtx): void {
    this._sync(id, base, ctx);
  }
  override update(id: string, base: BaseEntity): void {
    this._sync(id, base);
  }
  override detach(id: string): void {
    const r = this.recs.get(id);
    if (r) {
      r.dead = true;
      this.clock.clearInterval(r.timer ?? undefined);
    }
    this.recs.delete(id);
  }
  override async close(): Promise<void> {
    for (const id of [...this.recs.keys()]) this.detach(id);
  }
  metrics(): { panes: number } {
    return { panes: this.recs.size };
  }

  _sync(id: string, base: BaseEntity, ctx?: EnricherCtx): void {
    const shell = base.kind === 'shell';
    let r = this.recs.get(id);
    if (r && r.shell !== shell) {
      this.detach(id);
      r = undefined;
    }
    if (!r) {
      const rec: Rec = { id, shell, timer: null, busy: false, sent: '', lastCommitArgv: null, dead: false, tail: null, pending: 0, ctx: ctx ?? null };
      this.recs.set(id, rec);
      rec.timer = this.clock.setInterval(() => void this._poll(rec), shell ? this.shellMs : this.agentMs);
      void this._poll(rec);
    }
  }

  /** Shell output news: diff the recent_unwrapped tail; emit `news {src:'shell', lines}` once back at the prompt. */
  async _news(r: Rec, proc: ProcessInfo | null): Promise<void> {
    if (proc && NO_NEWS.has(proc.activity)) {
      r.tail = null; // re-baseline when the full-screen app exits
      r.pending = 0;
      return;
    }
    const res = await this.source.request('pane.read', { pane_id: r.id, source: 'recent_unwrapped', format: 'text', lines: NEWS_TAIL });
    if (r.dead) return;
    const text = isRecord(res) && isRecord(res.read) ? res.read.text : undefined;
    const lines = String(text ?? '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd());
    while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
    r.pending += shellNews(r.tail, lines);
    r.tail = lines;
    if (!r.pending || (proc && proc.activity !== 'prompt')) return; // still running: wait for the prompt to return
    const n = r.pending;
    r.pending = 0;
    try {
      this.emitEvent(r.id, 'news', { src: 'shell', lines: n });
    } catch (e) {
      this.log.debug(`procinfo emit: ${errMessage(e)}`);
    }
  }

  async _poll(r: Rec): Promise<void> {
    if (r.busy || r.dead) return;
    if (this.source.connected === false) return;
    r.busy = true;
    try {
      const res = await this.source.request('pane.process_info', { pane_id: r.id });
      if (r.dead) return;
      const info = isRecord(res) ? res.process_info ?? res : null;
      const proc = processFromInfo(isProcessInfo(info) ? info : null);
      r.ctx?.agentHint?.(vendorOfInfo(isProcessInfo(info) ? info : null));
      const j = JSON.stringify(proc);
      if (j !== r.sent) {
        r.sent = j;
        this.onPatch(r.id, { process: proc, res: null });
      }
      if (r.shell && proc && isGitCommit(proc.argv)) {
        if (r.lastCommitArgv !== proc.argv) {
          r.lastCommitArgv = proc.argv;
          try {
            this.emitEvent(r.id, 'commit', { push: /\bpush\b/.test(proc.argv) });
          } catch (e) {
            this.log.debug(`procinfo emit: ${errMessage(e)}`);
          }
        }
      } else r.lastCommitArgv = null;
      if (r.shell) await this._news(r, proc);
    } catch (e) {
      this.log.debug(`procinfo ${r.id}: ${errMessage(e)}`);
    } finally {
      r.busy = false;
    }
  }
}
