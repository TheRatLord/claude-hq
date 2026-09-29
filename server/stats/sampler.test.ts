import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { StatsSampler, HISTORY } from './sampler.ts';
import { FakeClock, RealClock } from '../clock.ts';

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-stats-'));
  for (const [p, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(root + p), { recursive: true });
    fs.writeFileSync(root + p, v);
  }
  return root;
}

const statLine = (u: number, idle: number): string => `cpu  ${u * 2} 0 0 ${idle * 2} 0 0 0 0 0 0\ncpu0 ${u} 0 0 ${idle} 0 0 0 0 0 0\ncpu1 ${u} 0 0 ${idle} 0 0 0 0 0 0\n`;

test('sampler: fixture /proc + /sys → full Stats shape; hwmon by name; missing sources are null', (t) => {
  const root = tree({
    '/proc/stat': statLine(100, 900),
    '/proc/loadavg': '0.50 0.40 0.30 1/200 999',
    '/proc/uptime': '12345.67 999.0',
    '/proc/pressure/cpu': 'some avg10=1.50 avg60=0.10 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0',
    '/proc/meminfo': 'MemTotal:       1000 kB\nMemFree:         100 kB\nMemAvailable:    400 kB\nBuffers:          10 kB\nCached:          200 kB\nSwapTotal:       500 kB\nSwapFree:        400 kB\nSReclaimable:     20 kB\n',
    '/proc/mounts': '/dev/nvme0n1p2 / ext4 rw 0 0\n/dev/nvme0n1p1 /boot/efi vfat rw 0 0\ntmpfs /run tmpfs rw 0 0\n/dev/loop0 /snap/x squashfs ro 0 0\n',
    '/proc/diskstats': ' 259 0 nvme0n1 1 0 1000 0 1 0 2000 0 0 0 0\n 259 1 nvme0n1p1 1 0 999 0 1 0 999 0 0 0 0\n',
    '/proc/net/dev': 'Inter-|\n face |\n    lo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0\n enp3s0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\ndocker0: 5 0 0 0 0 0 0 0 5 0 0 0 0 0 0 0\n',
    '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq': '3000000',
    '/sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq': '1000000',
    '/sys/class/hwmon/hwmon3/name': 'k10temp', '/sys/class/hwmon/hwmon3/temp1_input': '59125',
    '/sys/class/hwmon/hwmon0/name': 'nvme', '/sys/class/hwmon/hwmon0/temp1_input': '44850',
    '/sys/class/hwmon/hwmon7/name': 'amdgpu', '/sys/class/hwmon/hwmon7/temp1_input': '47000',
    '/sys/class/hwmon/hwmon7/freq1_input': '800000000', '/sys/class/hwmon/hwmon7/power1_input': '8123000',
    '/sys/class/drm/card1/device/gpu_busy_percent': '12',
    '/sys/class/drm/card1/device/mem_info_vram_used': '100', '/sys/class/drm/card1/device/mem_info_vram_total': '300',
    '/sys/class/drm/card1/device/mem_info_gtt_used': '10', '/sys/class/drm/card1/device/mem_info_gtt_total': '30',
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statfs = (p: string) => ({ blocks: p.endsWith('efi') ? 100 : 1000, bsize: 4096, bfree: p.endsWith('efi') ? 50 : 250, bavail: 200 });
  const clock = new FakeClock();
  const s = new StatsSampler({ clock, root, statfs });
  s.start();
  fs.writeFileSync(root + '/proc/stat', statLine(150, 950)); // 50% busy on both cores
  fs.writeFileSync(root + '/proc/net/dev', 'Inter-|\n face |\n    lo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0\n enp3s0: 3000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n');
  clock.advance(1000);
  const st = s.latest();
  assert.ok(st);
  assert.equal(st.cpu.total, 50);
  assert.deepEqual(st.cpu.cores, [50, 50]);
  assert.deepEqual(st.cpu.load, [0.5, 0.4, 0.3]);
  assert.equal(st.cpu.freqMHz, 2000);
  assert.deepEqual(st.cpu.psi, { cpu: 1.5, mem: null, io: null });
  assert.deepEqual(st.mem, { total: 1024000, used: 614400, cache: 235520, swapTotal: 512000, swapUsed: 102400 });
  assert.deepEqual(st.disks.map((d) => [d.mount, d.fs, d.total, d.used]), [['/', 'ext4', 4096000, 3072000], ['/boot/efi', 'vfat', 409600, 204800]]);
  assert.deepEqual(st.net.ifaces, ['enp3s0']);
  assert.ok(st.net.rxBps > 0);
  assert.deepEqual(st.temps, { cpu: 59.1, nvme: 44.9, wifi: null, gpu: 47 });
  assert.deepEqual(st.gpu, { busy: 12, vramUsed: 100, vramTotal: 300, gttUsed: 10, gttTotal: 30, clockMHz: 800, powerW: 8.1, tempC: 47 });
  assert.equal(st.uptime, 12346);
  for (let i = 0; i < HISTORY + 10; i++) clock.advance(1000);
  assert.equal(s.history().length, HISTORY);
  s.stop();
  assert.equal(clock.pending, 0);
});

test('sampler: an empty root never throws (every source null/zero)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-stats-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = new StatsSampler({ clock: new FakeClock(), root, statfs: () => { throw new Error('nope'); } });
  const st = s.sample();
  assert.equal(st.gpu, null);
  assert.deepEqual(st.disks, []);
  assert.deepEqual(st.temps, { cpu: null, nvme: null, wifi: null, gpu: null });
});

test('sampler: real /proc memory matches `free -b` within 5%', { skip: process.platform !== 'linux' }, () => {
  const s = new StatsSampler({ clock: RealClock() });
  const st = s.sample();
  let out: string;
  try {
    out = execFileSync('free', ['-b'], { encoding: 'utf8' });
  } catch {
    return;
  }
  const mem = (out.split('\n').find((l) => l.startsWith('Mem:')) ?? '').trim().split(/\s+/).map(Number);
  // free: total used free shared buff/cache available ; our used = total − available
  const [, total = 0, , , , cache = 0, avail = 0] = mem;
  assert.ok(Math.abs(st.mem.total - total) / total < 0.01);
  assert.ok(Math.abs(st.mem.used - (total - avail)) / total < 0.05, `used ${st.mem.used} vs ${total - avail}`);
  assert.ok(Math.abs(st.mem.cache - cache) / Math.max(cache, 1) < 0.05, `cache ${st.mem.cache} vs ${cache}`);
  assert.ok(st.disks.some((d) => d.mount === '/'));
});
