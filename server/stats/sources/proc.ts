/**
 * Per-process scan (`res`): CPU% and RSS of a process tree from /proc/<pid>/{stat,statm}. Sampled every 3 s by the
 * sampler when a caller asks for trees (none yet).
 */
import { read, list } from './util.ts';

export interface ProcInfo { ppid: number; ticks: number; rssBytes: number }

const CLK_TCK = 100;
const PAGE = 4096;

export function procInfo(root: string, pid: number | string): ProcInfo | null {
  const st = read(root, `/proc/${pid}/stat`);
  const sm = read(root, `/proc/${pid}/statm`);
  if (!st || !sm) return null;
  const rest = st.slice(st.lastIndexOf(')') + 2).split(' '); // fields from 3 (state) on
  return { ppid: Number(rest[1]), ticks: Number(rest[11]) + Number(rest[12]), rssBytes: Number(sm.split(' ')[1]) * PAGE };
}

/** Snapshot of every process: pid → info. */
export function scanAll(root = ''): Map<number, ProcInfo> {
  const out = new Map<number, ProcInfo>();
  for (const d of list(root, '/proc')) {
    if (!/^\d+$/.test(d)) continue;
    const p = procInfo(root, d);
    if (p) out.set(Number(d), p);
  }
  return out;
}

/** CPU% + RSS MB of `pid` and its descendants between two scans `dtMs` apart. */
export function treeUsage(prev: Map<number, ProcInfo>, cur: Map<number, ProcInfo>, pid: number, dtMs: number): { cpu: number; rssMB: number } {
  const kids = new Map<number, number[]>();
  for (const [p, i] of cur) {
    if (!kids.has(i.ppid)) kids.set(i.ppid, []);
    kids.get(i.ppid)?.push(p);
  }
  let ticks = 0, rss = 0;
  const stack = [pid];
  const seen = new Set<number>();
  while (stack.length) {
    const p = stack.pop() as number; // loop condition: non-empty
    if (seen.has(p)) continue;
    seen.add(p);
    const c = cur.get(p);
    if (!c) continue;
    ticks += c.ticks - (prev.get(p)?.ticks ?? c.ticks);
    rss += c.rssBytes;
    for (const k of kids.get(p) ?? []) stack.push(k);
  }
  return { cpu: dtMs > 0 ? Math.round((1000 * ticks) / CLK_TCK / dtMs * 1000) / 10 : 0, rssMB: Math.round(rss / 1048576) };
}
