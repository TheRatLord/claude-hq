/** Memory: /proc/meminfo, bytes. used = MemTotal − MemAvailable; cache = Buffers + Cached + SReclaimable (free's buff/cache). */
import type { Stats } from '../../../shared/protocol.ts';
import { read } from './util.ts';

export function createMem(root = ''): () => Stats['mem'] | null {
  return () => {
    const t = read(root, '/proc/meminfo');
    if (!t) return null;
    const kv: Record<string, number> = {};
    for (const l of t.split('\n')) {
      const m = /^(\w+(?:\(\w+\))?):\s+(\d+)/.exec(l);
      if (m) kv[m[1]] = Number(m[2]) * 1024;
    }
    const total = kv.MemTotal ?? 0;
    return {
      total,
      used: total - (kv.MemAvailable ?? kv.MemFree ?? 0),
      cache: (kv.Buffers ?? 0) + (kv.Cached ?? 0) + (kv.SReclaimable ?? 0),
      swapTotal: kv.SwapTotal ?? 0,
      swapUsed: (kv.SwapTotal ?? 0) - (kv.SwapFree ?? 0),
    };
  };
}
