/**
 * Stats sampler: 1 Hz `Stats` from /proc and /sys (disks via statfs every 30 s), a 300-sample
 * ring for `hello.statsHistory`, and a 'stats' event per sample. Always real, even in --demo (read-only, harmless).
 * A missing source produces null, never a crash.
 *
 *   const s = new StatsSampler({ clock }); s.on('stats', (st) => …); s.start(); s.history(); s.stop();
 */
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { Stats } from '../../shared/protocol.ts';
import type { Clock, Logger, TimerHandle } from '../interfaces.ts';
import { createCpu } from './sources/cpu.ts';
import { createMem } from './sources/mem.ts';
import { createDisks, createIo } from './sources/disk.ts';
import type { StatfsResult } from './sources/disk.ts';
import { createNet } from './sources/net.ts';
import { createTemps } from './sources/temps.ts';
import { createGpu } from './sources/gpu.ts';
import { num, safe } from './sources/util.ts';

export const HISTORY = 300;
const INTERVAL_MS = 1000;
const DISK_MS = 30_000;

/** root = path prefix for a fixture /proc + /sys tree (tests) */
export interface StatsSamplerOpts {
  clock: Clock;
  root?: string;
  intervalMs?: number;
  diskMs?: number;
  statfs?: (p: string) => StatfsResult;
  log?: Pick<Logger, 'debug'>;
}

export class StatsSampler extends EventEmitter<{ stats: [Stats] }> {
  clock: Clock;
  root: string;
  intervalMs: number;
  diskMs: number;
  log: Pick<Logger, 'debug'>;
  _cpu: (() => Stats['cpu'] | null) | null;
  _mem: () => Stats['mem'] | null;
  _disks: () => Stats['disks'];
  _io: (() => Stats['io']) | null;
  _net: (() => Stats['net'] | null) | null;
  _temps: () => Stats['temps'];
  _gpu: (() => Stats['gpu']) | null;
  _ring: Stats[];
  _diskCache: Stats['disks'];
  _diskAt: number;
  _timer: TimerHandle | null;
  host: string;
  constructor({ clock, root = '', intervalMs = INTERVAL_MS, diskMs = DISK_MS, statfs, log }: StatsSamplerOpts) {
    super();
    this.clock = clock;
    this.root = root;
    this.intervalMs = intervalMs;
    this.diskMs = diskMs;
    this.log = log ?? { debug() {} };
    // Wall-time deltas for rates: the clock may be time-scaled (--timescale) but /proc counters are wall-clock.
    const wall = () => performance.timeOrigin + performance.now();
    this._cpu = safe(() => createCpu(root));
    this._mem = createMem(root);
    this._disks = createDisks(root, statfs);
    this._io = safe(() => createIo(root, wall));
    this._net = safe(() => createNet(root, wall));
    this._temps = createTemps(root);
    this._gpu = safe(() => createGpu(root));
    this._ring = [];
    this._diskCache = [];
    this._diskAt = -Infinity;
    this._timer = null;
    this.host = safe(() => os.hostname(), 'localhost');
  }

  start(): this {
    if (this._timer) return this;
    this.sample(); // primes deltas; the first sample's rates are 0
    this._timer = this.clock.setInterval(() => this.sample(), this.intervalMs);
    return this;
  }

  stop(): void {
    this.clock.clearInterval(this._timer ?? undefined);
    this._timer = null;
  }

  /** oldest first */
  history(): Stats[] {
    return this._ring.slice();
  }

  latest(): Stats | null {
    return this._ring[this._ring.length - 1] ?? null;
  }

  /** Take one sample now (also pushes it to the ring and emits 'stats'). */
  sample(): Stats {
    const now = this.clock.now();
    const r = this.root;
    if (now - this._diskAt >= this.diskMs) {
      this._diskAt = now;
      this._diskCache = safe(() => this._disks(), []) ?? [];
    }
    const cpu = safe(() => this._cpu?.()) ?? { total: 0, cores: [], load: [0, 0, 0], freqMHz: 0, psi: { cpu: null, mem: null, io: null } };
    const mem = safe(() => this._mem()) ?? { total: 0, used: 0, cache: 0, swapTotal: 0, swapUsed: 0 };
    const st: Stats = {
      at: now,
      host: this.host,
      uptime: Math.round(num(r, '/proc/uptime') ?? safe(() => os.uptime(), 0)),
      cpu,
      mem,
      disks: this._diskCache,
      io: safe(() => this._io?.()) ?? { readBps: 0, writeBps: 0 },
      gpu: safe(() => this._gpu?.()) ?? null,
      temps: safe(() => this._temps()) ?? { cpu: null, nvme: null, wifi: null, gpu: null },
      net: safe(() => this._net?.()) ?? { rxBps: 0, txBps: 0, ifaces: [] },
    };
    this._ring.push(st);
    if (this._ring.length > HISTORY) this._ring.shift();
    this.emit('stats', st);
    return st;
  }
}
