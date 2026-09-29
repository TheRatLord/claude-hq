/** CPU: /proc/stat deltas (total + per core; idle = idle + iowait), /proc/loadavg, cpufreq, PSI. Owner: BE2. */
import type { Stats } from '../../../shared/protocol.ts';
import { read, list, num } from './util.ts';

interface CpuTimes { idle: number; total: number }
type CpuStats = Stats['cpu'];

function readStat(root: string): Map<string, CpuTimes> {
  const out = new Map<string, CpuTimes>();
  const t = read(root, '/proc/stat');
  if (!t) return out;
  for (const line of t.split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const [name, ...rest] = line.trim().split(/\s+/);
    const v = rest.map(Number);
    const idle = (v[3] ?? 0) + (v[4] ?? 0);
    const total = v.slice(0, 8).reduce((a, b) => a + (b || 0), 0); // user..steal (guest is inside user)
    out.set(name, { idle, total });
  }
  return out;
}

const pct = (a: CpuTimes | undefined, b: CpuTimes | undefined): number => {
  if (!a || !b) return 0;
  const dt = b.total - a.total;
  return dt > 0 ? Math.max(0, Math.min(100, (100 * (dt - (b.idle - a.idle))) / dt)) : 0;
};
const r1 = (v: number): number => Math.round(v * 10) / 10;

function psi(root: string, which: string): number | null {
  const t = read(root, `/proc/pressure/${which}`);
  const m = t && /some avg10=([\d.]+)/.exec(t);
  return m ? Number(m[1]) : null;
}

export function createCpu(root = ''): () => CpuStats | null {
  let prev = readStat(root);
  let lastPct: Pick<CpuStats, 'total' | 'cores'> | null = null;
  return () => {
    const cur = readStat(root);
    if (!cur.size) return null;
    const n = Math.max(1, cur.size - 1);
    // < ~100 ms of jiffies since the last read (e.g. the priming sample at start): keep the last numbers, don't advance
    const prevAll = prev.get('cpu'), curAll = cur.get('cpu');
    const tooSoon = prevAll && curAll && curAll.total - prevAll.total < 10 * n;
    if (tooSoon && lastPct) return { ...lastPct, ...tail(root) };
    if (tooSoon) return { total: 0, cores: new Array(n).fill(0), ...tail(root) };
    const cores: number[] = [];
    for (let i = 0; cur.has(`cpu${i}`); i++) cores.push(r1(pct(prev.get(`cpu${i}`), cur.get(`cpu${i}`))));
    const total = r1(pct(prev.get('cpu'), cur.get('cpu')));
    prev = cur;
    lastPct = { total, cores };
    return { total, cores, ...tail(root) };
  };
}

/** load, freq, PSI: instantaneous reads. */
function tail(root: string): Pick<CpuStats, 'load' | 'freqMHz' | 'psi'> {
  const la = read(root, '/proc/loadavg');
  const load = la ? la.split(/\s+/).slice(0, 3).map(Number) : [0, 0, 0];
  const freqs = list(root, '/sys/devices/system/cpu')
    .filter((d) => /^cpu\d+$/.test(d))
    .map((d) => num(root, `/sys/devices/system/cpu/${d}/cpufreq/scaling_cur_freq`))
    .filter((v): v is number => v !== null);
  const freqMHz = freqs.length ? Math.round(freqs.reduce((a, b) => a + b, 0) / freqs.length / 1000) : 0;
  return { load, freqMHz, psi: { cpu: psi(root, 'cpu'), mem: psi(root, 'memory'), io: psi(root, 'io') } };
}
