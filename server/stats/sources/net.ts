/** Network: /proc/net/dev byte deltas; skips lo, docker*, br-*, veth*. */
import type { Stats } from '../../../shared/protocol.ts';
import { read } from './util.ts';

const SKIP = /^(lo|docker|br-|veth|virbr)/;

function readNet(root: string): Map<string, { rx: number; tx: number }> | null {
  const t = read(root, '/proc/net/dev');
  if (!t) return null;
  const out = new Map<string, { rx: number; tx: number }>();
  for (const l of t.split('\n').slice(2)) {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(l);
    if (!m || SKIP.test(m[1])) continue;
    const c = m[2].trim().split(/\s+/).map(Number);
    out.set(m[1], { rx: c[0], tx: c[8] });
  }
  return out;
}

export function createNet(root: string, now: () => number): () => Stats['net'] | null {
  let prev = readNet(root), prevAt = now();
  return () => {
    const cur = readNet(root), at = now();
    if (!cur) return null;
    const dt = (at - prevAt) / 1000;
    let rx = 0, tx = 0;
    for (const [k, v] of cur) {
      const p = prev?.get(k);
      if (p && dt > 0) {
        rx += Math.max(0, v.rx - p.rx);
        tx += Math.max(0, v.tx - p.tx);
      }
    }
    prev = cur;
    prevAt = at;
    return { rxBps: dt > 0 ? Math.round(rx / dt) : 0, txBps: dt > 0 ? Math.round(tx / dt) : 0, ifaces: [...cur.keys()] };
  };
}
