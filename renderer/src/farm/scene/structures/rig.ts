/**
 * The per-structure animation contract. Every model a builder returns carries `userData.rig` (a Rig); the system and
 * the gallery both drive it with an Env, so what the gallery scrubs is exactly what the valley animates.
 */
import type * as THREE from 'three';
import type { Gauges } from '../../model/types.ts';
import { clamp01 } from './kit.ts';

/** System stats normalised for the landmarks (0..1 unless noted). */
export interface Levels {
  cpu: number;
  cores: number[];
  mem: number;
  memUsedGB: number;
  memTotalGB: number;
  disk: number;
  diskUsedGB: number;
  diskTotalGB: number;
  /** disk IO, log-scaled 0..1 */
  io: number;
  ioRead: number;
  ioWrite: number;
  /** null = no GPU sensor */
  gpu: number | null;
  /** hottest sensor, °C, null = none */
  tempC: number | null;
  /** 0..1 of 25..100 °C */
  temp: number;
  host: string;
  live: boolean;
}

export interface Env {
  t: number;
  dt: number;
  night: number;
  wind: { x: number; z: number };
  lv: Levels;
}

export interface Rig {
  update(e: Env): void;
  /** one-shot reactions ('ship', 'blocked', 'mail', 'wish'…) and state pushes ('unread', n) */
  poke?(what: string, value?: unknown): void;
}

export const rigOf = (o: THREE.Object3D): Rig | undefined => o.userData.rig as Rig | undefined;

const LOG_IO_LO = 2e4, LOG_IO_HI = 3e8;
export const ioLevel = (bytes: number): number => clamp01(Math.log10(1 + bytes / LOG_IO_LO) / Math.log10(1 + LOG_IO_HI / LOG_IO_LO));

export function levelsFrom(g: Gauges | null, out: Levels): Levels {
  if (!g) {
    out.live = false; out.cpu = 0; out.mem = 0; out.disk = 0; out.io = 0; out.gpu = null; out.tempC = null; out.temp = 0;
    return out;
  }
  out.live = true;
  out.cpu = clamp01(g.cpu); out.cores = g.cores;
  out.mem = clamp01(g.mem); out.memUsedGB = g.memUsedGB; out.memTotalGB = g.memTotalGB;
  out.disk = clamp01(g.disk); out.diskUsedGB = g.diskUsedGB; out.diskTotalGB = g.diskTotalGB;
  out.ioRead = g.ioRead; out.ioWrite = g.ioWrite; out.io = ioLevel(g.ioRead + g.ioWrite);
  out.gpu = g.gpu; out.tempC = g.tempC; out.temp = g.tempC == null ? 0 : clamp01((g.tempC - 25) / 75);
  out.host = g.host;
  return out;
}

export const newLevels = (): Levels => ({
  cpu: 0, cores: [], mem: 0, memUsedGB: 0, memTotalGB: 0, disk: 0, diskUsedGB: 0, diskTotalGB: 0, io: 0, ioRead: 0, ioWrite: 0,
  gpu: null, tempC: null, temp: 0, host: '', live: false,
});

/** Gallery: one slider drives every gauge. */
export function levelsFromParam(p: number, out: Levels): Levels {
  out.live = true;
  out.cpu = p; out.cores = Array.from({ length: 8 }, (_, i) => clamp01(p + Math.sin(i * 2.1) * 0.25));
  out.mem = p; out.memTotalGB = 32; out.memUsedGB = 32 * p;
  out.disk = p; out.diskTotalGB = 512; out.diskUsedGB = 512 * p;
  const bytes = LOG_IO_LO * (Math.pow(1 + LOG_IO_HI / LOG_IO_LO, p) - 1);
  out.ioRead = bytes * 0.6; out.ioWrite = bytes * 0.4; out.io = p;
  out.gpu = p; out.tempC = 25 + 75 * p; out.temp = p; out.host = 'gallery';
  return out;
}

export const fmtBytes = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB/s` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${Math.round(b / 1e3)} KB/s` : `${Math.round(b)} B/s`);
export const pct = (v: number): string => `${Math.round(v * 100)}%`;
