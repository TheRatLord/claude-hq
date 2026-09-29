/**
 * Child reaping (DESIGN §4.7.1): no orphaned herdr children on the user's default session. Owner: BE.
 *  - every herdr child's env carries CLAUDE_HQ_INSTANCE=<instanceId>, CLAUDE_HQ_SESSION=<session> (herdr/resolve.ts);
 *  - pids are recorded in `~/.config/claude-hq/<session>/children.json` ({instanceId, pids:[{pid, mode, paneId,
 *    startedAt}]}), rewritten on every spawn/exit;
 *  - startup scan (before the first spawn): /proc/<pid>/environ (own uid only) for processes tagged with an instance
 *    that is not live, whose argv[0] is the herdr binary (nothing else is ever touched) → SIGTERM, 1 s, SIGKILL.
 *    Scope: children tagged with THIS config dir (CLAUDE_HQ_STATE = stateTag(configDir)); another deployment's
 *    backends (different config dir) keep theirs.
 * Linux only (the backend runs on the herdr box).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { errMessage } from '../shared/guards.ts';
import type { Clock, Logger } from './interfaces.ts';
import { herdrBin } from './herdr/resolve.ts';
import { liveInstanceIds } from './instance.ts';

/** Short tag of a config dir (children env CLAUDE_HQ_STATE). */
export const stateTag = (configDir: string): string => crypto.createHash('sha256').update(path.resolve(configDir)).digest('hex').slice(0, 12);

const realOr = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

export interface TaggedProcess { pid: number; instance: string; session: string | null; state: string | null; argv: string[] }

/** Tagged herdr processes visible in /proc (own uid). */
export function scanTagged({ bin = herdrBin(), procDir = '/proc' }: { bin?: string; procDir?: string } = {}): TaggedProcess[] {
  const uid = process.getuid?.() ?? -1;
  const bins = new Set([bin, realOr(bin)]);
  const out: TaggedProcess[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(procDir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!/^\d+$/.test(n)) continue;
    const pid = Number(n);
    if (pid === process.pid) continue;
    try {
      if (fs.statSync(path.join(procDir, n)).uid !== uid) continue;
      const env = fs.readFileSync(path.join(procDir, n, 'environ'), 'latin1').split('\0');
      const tag = env.find((e) => e.startsWith('CLAUDE_HQ_INSTANCE='));
      if (!tag) continue;
      const argv = fs.readFileSync(path.join(procDir, n, 'cmdline'), 'utf8').split('\0').filter(Boolean);
      // argv[0] is the herdr binary (argv[1] when it is an interpreter script, e.g. the test fake)
      const isBin = (a: string | undefined) => !!a && (bins.has(a) || bins.has(realOr(a)));
      if (!argv.length || !(isBin(argv[0]) || isBin(argv[1]))) continue;
      const val = (k: string) => env.find((e) => e.startsWith(`${k}=`))?.slice(k.length + 1) ?? null;
      out.push({ pid, instance: tag.slice('CLAUDE_HQ_INSTANCE='.length), session: val('CLAUDE_HQ_SESSION'), state: val('CLAUDE_HQ_STATE'), argv });
    } catch {}
  }
  return out;
}

export interface ReaperOpts {
  configDir: string;
  stateDir: string | null;
  instanceId: string;
  clock: Clock;
  log?: Pick<Logger, 'info' | 'warn' | 'debug'>;
  bin?: string;
}

interface TrackedChild { pid: number; mode: string; paneId: string; startedAt: number }

export class Reaper {
  configDir: string;
  file: string | null;
  instanceId: string;
  clock: Clock;
  log: Pick<Logger, 'info' | 'warn' | 'debug'>;
  bin: string;
  pids: Map<number, TrackedChild>;
  constructor({ configDir, stateDir, instanceId, clock, log, bin }: ReaperOpts) {
    this.configDir = configDir;
    this.file = stateDir ? path.join(stateDir, 'children.json') : null;
    this.instanceId = instanceId;
    this.clock = clock;
    this.log = log ?? { info() {}, warn() {}, debug() {} };
    this.bin = bin ?? herdrBin();
    this.pids = new Map();
  }

  /**
   * Kill tagged herdr processes of dead instances. Resolves with the number reaped.
   */
  async scan(): Promise<number> {
    const live = liveInstanceIds(this.configDir);
    live.add(this.instanceId);
    const mine = stateTag(this.configDir);
    const victims = scanTagged({ bin: this.bin }).filter((p) => !live.has(p.instance) && (p.state === null || p.state === mine));
    if (!victims.length) return 0;
    for (const v of victims) {
      try {
        process.kill(v.pid, 'SIGTERM');
      } catch {}
    }
    await new Promise<void>((r) => this.clock.setTimeout(r, 1000));
    for (const v of victims) {
      try {
        process.kill(v.pid, 0);
        process.kill(v.pid, 'SIGKILL');
      } catch {}
    }
    this.log.warn(`reaped ${victims.length} orphaned herdr child(ren) of dead HQ instances`);
    return victims.length;
  }

  /** Record a spawned child (client.ts onSpawn). */
  track(child: ChildProcess, { mode, paneId }: { mode: string; paneId: string }): void {
    const pid = child.pid;
    if (!pid) return;
    this.pids.set(pid, { pid, mode, paneId, startedAt: this.clock.now() });
    this._write();
    child.once('exit', () => {
      this.pids.delete(pid);
      this._write();
    });
  }

  _write(): void {
    if (!this.file) return;
    try {
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ instanceId: this.instanceId, pids: [...this.pids.values()] }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.log.debug(`children.json: ${errMessage(e)}`);
    }
  }

  /** SIGKILL every tracked child now (second signal during shutdown). */
  killAll(): void {
    for (const pid of this.pids.keys()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }

  close(): void {
    this.pids.clear();
    this._write();
  }
}
