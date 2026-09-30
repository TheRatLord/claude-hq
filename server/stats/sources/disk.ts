/**
 * Disks: `fs.statfsSync` on `/` and real mounts from /proc/mounts (ext4, xfs, btrfs; vfat only on /boot*). Never `df`.
 * I/O: /proc/diskstats sector deltas × 512 over whole disks.
 */
import fs from 'node:fs';
import type { Stats } from '../../../shared/protocol.ts';
import { read } from './util.ts';

/** The `fs.statfsSync` fields used. */
export interface StatfsResult { blocks: number; bsize: number; bfree: number; bavail: number }

const REAL_FS = new Set(['ext4', 'ext3', 'xfs', 'btrfs', 'f2fs', 'zfs', 'bcachefs']);
const WHOLE_DISK = /^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|xvd[a-z]+|mmcblk\d+|hd[a-z]+)$/;
const unescape = (s: string): string => s.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

export function createDisks(root = '', statfs: (p: string) => StatfsResult = (p) => fs.statfsSync(p)): () => Stats['disks'] {
  return () => {
    const t = read(root, '/proc/mounts');
    const seen = new Set<string>();
    const out: Stats['disks'] = [];
    const rows = (t ?? '').split('\n').map((l) => l.split(' ')).filter((c) => c.length >= 3);
    const mounts: string[][] = rows.filter(([dev, mnt, type]) => (REAL_FS.has(type) || (type === 'vfat' && /^\/boot/.test(unescape(mnt)))) && dev.startsWith('/'));
    if (!mounts.some((m) => m[1] === '/')) mounts.unshift(['/', '/', '?']);
    for (const [dev, mntRaw, type] of mounts) {
      const mount = unescape(mntRaw);
      if (seen.has(dev) || /^\/(snap|var\/lib\/docker|run)\b/.test(mount)) continue;
      try {
        const s = statfs(root + mount);
        const total = s.blocks * s.bsize;
        if (!total) continue;
        seen.add(dev);
        out.push({ mount, fs: type, total, used: (s.blocks - s.bfree) * s.bsize });
      } catch {}
    }
    return out;
  };
}

function readIo(root: string): { rd: number; wr: number } | null {
  const t = read(root, '/proc/diskstats');
  if (!t) return null;
  let rd = 0, wr = 0;
  for (const l of t.split('\n')) {
    const c = l.trim().split(/\s+/);
    if (c.length < 10 || !WHOLE_DISK.test(c[2])) continue;
    rd += Number(c[5]) * 512;
    wr += Number(c[9]) * 512;
  }
  return { rd, wr };
}

/** `now` in ms. */
export function createIo(root: string, now: () => number): () => Stats['io'] {
  let prev = readIo(root), prevAt = now();
  return () => {
    const cur = readIo(root), at = now();
    if (!cur) return { readBps: 0, writeBps: 0 };
    const dt = (at - prevAt) / 1000;
    const out = prev && dt > 0 ? { readBps: Math.max(0, Math.round((cur.rd - prev.rd) / dt)), writeBps: Math.max(0, Math.round((cur.wr - prev.wr) / dt)) } : { readBps: 0, writeBps: 0 };
    prev = cur;
    prevAt = at;
    return out;
  };
}
