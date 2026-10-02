/**
 * Git enricher: the repository state of each pane's cwd, `Entity.git` (rev 2): branch, short HEAD, dirty / untracked
 * counts, ahead / behind the upstream, the last commit's subject and time. Every pane kind (agents and shells).
 *
 * Load shaping: panes are grouped by cwd, cwds by work-tree root (`rev-parse --show-toplevel`, cached 5 min; a non-repo
 * cwd is re-checked after 1 min). One sweep every `pollMs` (10 s) runs `status` + `log -1` once per root, strictly one
 * git process at a time, each with a 4 s timeout. A root whose status timed out is polled with `-uno` from then on
 * (untracked = 0). Read-only and lock-free: GIT_OPTIONAL_LOCKS=0 keeps `status` from refreshing the index, so it never
 * contends with the agent's own git commands. A new cwd is swept within `firstMs`.
 */
import { execFile } from 'node:child_process';
import { Enricher } from '../interfaces.ts';
import type { BaseEntity, Clock, Logger, TimerHandle } from '../interfaces.ts';
import type { GitInfo } from '../../shared/protocol.ts';
import { errMessage } from '../../shared/guards.ts';
import { gitInfo, parseLastCommit, parseStatusV2 } from './gitState.ts';

const POLL_MS = 10_000;
const FIRST_MS = 500;
const ROOT_TTL_MS = 5 * 60_000;
const NOT_REPO_TTL_MS = 60_000;
const TIMEOUT_MS = 4000;

/** Runs `git args` in `cwd`; `ok` false on a non-zero exit, `timedOut` when it was killed. Injectable for tests. */
export type GitRunner = (args: string[], cwd: string) => Promise<{ ok: boolean; out: string; timedOut?: boolean }>;

export const runGit: GitRunner = (args, cwd) => new Promise((resolve) => {
  execFile('git', args, {
    cwd, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  }, (err, stdout) => {
    const killed = !!err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
    resolve({ ok: !err, out: String(stdout ?? ''), timedOut: killed });
  });
});

interface CwdRec { root: string | null; checkedAt: number }
interface RootRec { info: GitInfo | null; slow: boolean }

export interface GitOpts { clock: Clock; log?: Pick<Logger, 'debug'>; run?: GitRunner; pollMs?: number; firstMs?: number }

export class GitEnricher extends Enricher {
  clock: Clock;
  log: Pick<Logger, 'debug'>;
  run: GitRunner;
  pollMs: number;
  firstMs: number;
  /** pane id → cwd */
  panes: Map<string, string>;
  /** pane id → last sent JSON */
  sent: Map<string, string>;
  cwds: Map<string, CwdRec>;
  roots: Map<string, RootRec>;
  timer: TimerHandle | null;
  soon: TimerHandle | null;
  sweeping: boolean;
  again: boolean;
  closed: boolean;
  sweeps: number;
  constructor({ clock, log, run = runGit, pollMs = POLL_MS, firstMs = FIRST_MS }: GitOpts) {
    super('git');
    this.clock = clock;
    this.log = log ?? { debug() {} };
    this.run = run;
    this.pollMs = pollMs;
    this.firstMs = firstMs;
    this.panes = new Map();
    this.sent = new Map();
    this.cwds = new Map();
    this.roots = new Map();
    this.timer = null;
    this.soon = null;
    this.sweeping = false;
    this.again = false;
    this.closed = false;
    this.sweeps = 0;
  }

  override attach(id: string, base: BaseEntity): void {
    this._sync(id, base);
  }
  override update(id: string, base: BaseEntity): void {
    this._sync(id, base);
  }
  override detach(id: string): void {
    this.panes.delete(id);
    this.sent.delete(id);
    if (!this.panes.size) this._stopTimers();
  }
  override async close(): Promise<void> {
    this.closed = true;
    this._stopTimers();
    this.panes.clear();
  }
  metrics(): { panes: number; cwds: number; roots: number; sweeps: number } {
    return { panes: this.panes.size, cwds: this.cwds.size, roots: this.roots.size, sweeps: this.sweeps };
  }

  _stopTimers(): void {
    if (this.timer) this.clock.clearInterval(this.timer);
    if (this.soon) this.clock.clearTimeout(this.soon);
    this.timer = this.soon = null;
  }

  _sync(id: string, base: BaseEntity): void {
    const cwd = typeof base.cwd === 'string' && base.cwd.startsWith('/') ? base.cwd : '';
    const prev = this.panes.get(id);
    if (prev === cwd) return;
    this.panes.set(id, cwd);
    if (!cwd) return this._send(id, null);
    // a known cwd: answer right away from what the last sweep found
    const c = this.cwds.get(cwd);
    if (c) this._send(id, c.root ? this.roots.get(c.root)?.info ?? null : null);
    this.timer ??= this.clock.setInterval(() => void this.sweep(), this.pollMs);
    if (!c && !this.soon && !this.closed) {
      this.soon = this.clock.setTimeout(() => {
        this.soon = null;
        void this.sweep();
      }, this.firstMs);
    }
  }

  _send(id: string, info: GitInfo | null): void {
    const j = JSON.stringify(info);
    if (this.sent.get(id) === j) return;
    this.sent.set(id, j);
    try {
      this.onPatch(id, { git: info });
    } catch (e) {
      this.log.debug(`git patch ${id}: ${errMessage(e)}`);
    }
  }

  async _root(cwd: string, now: number): Promise<string | null> {
    const c = this.cwds.get(cwd);
    if (c && now - c.checkedAt < (c.root ? ROOT_TTL_MS : NOT_REPO_TTL_MS)) return c.root;
    const r = await this.run(['rev-parse', '--show-toplevel'], cwd);
    const root = r.ok ? r.out.trim() || null : null;
    this.cwds.set(cwd, { root, checkedAt: now });
    return root;
  }

  async _poll(root: string): Promise<GitInfo | null> {
    const rec = this.roots.get(root) ?? { info: null, slow: false };
    this.roots.set(root, rec);
    const st = await this.run(['status', '--porcelain=v2', '--branch', '--ignore-submodules=dirty', rec.slow ? '-uno' : '-unormal'], root);
    if (st.timedOut && !rec.slow) {
      rec.slow = true;
      this.log.debug(`git: ${root} status is slow; untracked files are no longer counted`);
      return rec.info;
    }
    if (!st.ok) return (rec.info = null);
    const log = await this.run(['log', '-1', '--format=%h%x1f%ct%x1f%s'], root);
    rec.info = gitInfo(root, parseStatusV2(st.out), log.ok ? parseLastCommit(log.out) : null);
    return rec.info;
  }

  /** One sweep over every pane's cwd (sequential; a sweep asked for while one runs runs again right after). */
  async sweep(): Promise<void> {
    if (this.closed) return;
    if (this.sweeping) {
      this.again = true;
      return;
    }
    this.sweeping = true;
    try {
      do {
        this.again = false;
        this.sweeps++;
        const now = this.clock.now();
        const rootOf = new Map<string, string | null>();
        for (const cwd of new Set(this.panes.values())) if (cwd) rootOf.set(cwd, await this._root(cwd, now));
        const infos = new Map<string, GitInfo | null>();
        for (const root of new Set(rootOf.values())) if (root && !this.closed) infos.set(root, await this._poll(root));
        for (const [id, cwd] of this.panes) {
          const root = rootOf.get(cwd) ?? null;
          this._send(id, root ? infos.get(root) ?? null : null);
        }
        // forget roots and cwds no pane uses any more
        const usedCwds = new Set(this.panes.values());
        for (const cwd of this.cwds.keys()) if (!usedCwds.has(cwd)) this.cwds.delete(cwd);
        const usedRoots = new Set([...this.cwds.values()].map((c) => c.root));
        for (const root of this.roots.keys()) if (!usedRoots.has(root)) this.roots.delete(root);
      } while (this.again && !this.closed);
    } catch (e) {
      this.log.debug(`git sweep: ${errMessage(e)}`);
    } finally {
      this.sweeping = false;
    }
  }
}
