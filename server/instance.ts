/**
 * Single instance per session. Lock `~/.config/claude-hq/<session>.lock` (0600):
 * `{pid, port, instanceId, startedAt}`, written after `listen` succeeds, removed on clean exit. A lock is LIVE when its
 * pid is alive and `GET http://127.0.0.1:<port>/healthz` returns the same `{instanceId, session}`; otherwise stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { isRecord, errCode } from '../shared/guards.ts';

/** `{pid, port, instanceId, startedAt}` as written by writeLock. */
export interface LockInfo { pid: number; port: number; instanceId: string; startedAt?: number }
export type LiveResult = { live: true; lock: LockInfo } | { live: false; stale: LockInfo | null };

export const lockPath = (configDir: string, session: string): string => path.join(configDir, `${session.replace(/[^A-Za-z0-9_.-]/g, '_')}.lock`);

const isLock = (j: unknown): j is LockInfo => isRecord(j) && Number.isInteger(j.pid) && Number.isInteger(j.port) && typeof j.instanceId === 'string';

export function readLock(configDir: string, session: string): LockInfo | null {
  try {
    const j: unknown = JSON.parse(fs.readFileSync(lockPath(configDir, session), 'utf8'));
    return isLock(j) ? j : null;
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errCode(e) === 'EPERM';
  }
}

/** GET /healthz on loopback: the parsed JSON body (unvalidated), or null. */
export function healthz(port: number, timeoutMs = 1500): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: timeoutMs, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(b));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/**
 * Is a live backend already serving `session`? → `{live:true, lock}` or `{live:false, stale: lock|null}`.
 */
export async function findLive(configDir: string, session: string): Promise<LiveResult> {
  const lock = readLock(configDir, session);
  if (!lock) return { live: false, stale: null };
  if (lock.pid !== process.pid && pidAlive(lock.pid)) {
    const h = await healthz(lock.port);
    if (isRecord(h) && h.instanceId === lock.instanceId && h.session === session) return { live: true, lock };
  }
  return { live: false, stale: lock };
}

/** Instance ids of every live lock in configDir (any session) — the reaper never touches their children. */
export function liveInstanceIds(configDir: string): Set<string> {
  const out = new Set<string>();
  let names: string[] = [];
  try {
    names = fs.readdirSync(configDir).filter((n) => n.endsWith('.lock'));
  } catch {}
  for (const n of names) {
    try {
      const j: unknown = JSON.parse(fs.readFileSync(path.join(configDir, n), 'utf8'));
      if (isRecord(j) && typeof j.instanceId === 'string' && j.instanceId && typeof j.pid === 'number' && Number.isInteger(j.pid) && pidAlive(j.pid)) out.add(j.instanceId);
    } catch {}
  }
  return out;
}

export function writeLock(configDir: string, session: string, { port, instanceId, startedAt }: Omit<LockInfo, 'pid'>): void {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const file = lockPath(configDir, session);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, port, instanceId, startedAt }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Remove the lock only if it is ours. */
export function removeLock(configDir: string, session: string, instanceId: string): void {
  const l = readLock(configDir, session);
  if (l && l.instanceId === instanceId) {
    try {
      fs.unlinkSync(lockPath(configDir, session));
    } catch {}
  }
}
