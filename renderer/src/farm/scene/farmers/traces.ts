/**
 * Work traces in the field: what a farmer got done today stays visible at its work spot, so a glance over a field tells
 * a busy day from a quiet one even when nobody is out there.
 *
 *   seed stakes (on the farmer's right)  one per file planted (edited) since the valley loaded, a little seed packet
 *                                        on a stick over a mound of turned soil; up to MAX
 *   sprouts (on the farmer's left)       one per test run / error: green and perky for a pass, brown and drooping
 *                                        for a fail; the newest MAX
 *
 * Two instanced draws (no shadows), zero per-frame allocation. The farmers system owns the per-farmer bookkeeping
 * (`TraceRow`) and calls `stake` / `sprout` per visible marker between `begin` / `end`.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint, toon } from '../toon.ts';

export const TRACE_MAX = 6;

/** Per-farmer trace bookkeeping (fixed-size, reused). */
export interface TraceRow {
  /** files planted: banked from earlier tasks + the current task's count */
  bank: number; lastFiles: number;
  /** stakes shown and when each popped in (system time) */
  stakes: number; stakeT: Float32Array;
  /** sprouts ring (oldest first): 1 = wilted; pop-in time */
  sprouts: number; wilt: Uint8Array; sproutT: Float32Array;
  /** cached spot frame and marker ground heights (recomputed when the spot changes) */
  plot: string; spot: number; x: number; z: number; yaw: number; ok: boolean;
  ys: Float32Array;
}

export const newTraceRow = (): TraceRow => ({
  bank: 0, lastFiles: 0, stakes: 0, stakeT: new Float32Array(TRACE_MAX), sprouts: 0, wilt: new Uint8Array(TRACE_MAX), sproutT: new Float32Array(TRACE_MAX),
  plot: '', spot: -1, x: 0, z: 0, yaw: 0, ok: false, ys: new Float32Array(TRACE_MAX * 2),
});

/**
 * Pure: fold the current task's file count into the row's planted total (a new task restarts `files` at 0, so the
 * old count is banked). Returns the number of stakes to show.
 */
export function plantedStakes(r: Pick<TraceRow, 'bank' | 'lastFiles'>, files: number): number {
  if (files < r.lastFiles) r.bank += r.lastFiles;
  r.lastFiles = files;
  return Math.min(TRACE_MAX, r.bank + files);
}

/** Pure: push a test result into the sprout ring (drops the oldest when full). */
export function pushSprout(r: Pick<TraceRow, 'sprouts' | 'wilt' | 'sproutT'>, wilted: boolean, t: number): void {
  if (r.sprouts >= TRACE_MAX) {
    r.wilt.copyWithin(0, 1); r.sproutT.copyWithin(0, 1);
    r.sprouts = TRACE_MAX - 1;
  }
  r.wilt[r.sprouts] = wilted ? 1 : 0; r.sproutT[r.sprouts] = t; r.sprouts++;
}

/** Marker i's world position in a row's spot frame: side +1 = the farmer's left (sprouts), −1 = right (stakes). */
export function tracePos(r: Pick<TraceRow, 'x' | 'z' | 'yaw'>, side: 1 | -1, i: number, out: { x: number; z: number }): { x: number; z: number } {
  const s = side * (0.78 + (i % 2) * 0.05), f = -0.25 + i * 0.25;
  const sn = Math.sin(r.yaw), cs = Math.cos(r.yaw);
  // model left = (cos yaw, −sin yaw), forward = (sin yaw, cos yaw)
  out.x = r.x + cs * s + sn * f; out.z = r.z - sn * s + cs * f;
  return out;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paint(g, c);
};

export function stakeGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.2, 0.05, 0.14, 0, 0.012, 0, 0x6a4a2e), // turned-soil mound
    box(0.12, 0.03, 0.08, 0.02, 0.04, 0.01, 0x7d5836),
    box(0.026, 0.3, 0.026, 0, 0.16, 0, 0xb08a58), // stick
    box(0.13, 0.15, 0.018, 0, 0.27, 0.016, 0xf6ead0), // seed packet
    box(0.1, 0.06, 0.006, 0, 0.29, 0.027, 0x6cbf4a), // its picture: a green sprout band
    box(0.03, 0.03, 0.006, -0.02, 0.24, 0.027, 0xe0574a),
  ])!.scale(1.15, 1.15, 1.15);
}

export function sproutGeometry(): THREE.BufferGeometry {
  // white-ish so the instance colour (green / brown) paints it; a darker stem
  return mergeGeometries([
    box(0.12, 0.03, 0.1, 0, 0.012, 0, 0x8a7a6a), // little soil cap
    box(0.025, 0.17, 0.025, 0, 0.09, 0, 0xc8d8c0),
    box(0.11, 0.02, 0.06, 0.05, 0.17, 0, 0xffffff, 0.45),
    box(0.11, 0.02, 0.06, -0.05, 0.17, 0, 0xffffff, -0.45),
    box(0.05, 0.05, 0.05, 0, 0.19, 0, 0xffffff),
  ])!.scale(1.5, 1.5, 1.5);
}

const GREEN = new THREE.Color(0x5cc24a), BROWN = new THREE.Color(0x9a7244);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Traces {
  readonly group = new THREE.Group();
  private stakesM: THREE.InstancedMesh;
  private sproutsM: THREE.InstancedMesh;
  private ns = 0;
  private np = 0;

  constructor(cap = 48 * TRACE_MAX) {
    const mat = toon(0xffffff, { vertexColors: true });
    this.stakesM = new THREE.InstancedMesh(stakeGeometry(), mat, cap);
    this.sproutsM = new THREE.InstancedMesh(sproutGeometry(), mat, cap);
    this.sproutsM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    for (const [m, n] of [[this.stakesM, 'farmer-stakes'], [this.sproutsM, 'farmer-sprouts']] as const) {
      m.name = n; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
  }

  begin(): void { this.ns = 0; this.np = 0; }

  /** a seed stake at (x, y, z) facing yaw; `pop` 0..1 grows it in */
  stake(x: number, y: number, z: number, yaw: number, scale: number): void {
    if (this.ns >= this.stakesM.instanceMatrix.count || scale < 0.01) return;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(scale, scale, scale));
    this.stakesM.setMatrixAt(this.ns++, _m);
  }

  /** a sprout: perky green, or wilted brown and drooping */
  sprout(x: number, y: number, z: number, yaw: number, scale: number, wilted: boolean, sway: number): void {
    if (this.np >= this.sproutsM.instanceMatrix.count || scale < 0.01) return;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(wilted ? 0.95 : sway, yaw, wilted ? 0.25 : sway * 0.6, 'YXZ')), _s.set(scale, scale * (wilted ? 0.8 : 1), scale));
    this.sproutsM.setMatrixAt(this.np, _m);
    this.sproutsM.setColorAt(this.np++, wilted ? BROWN : GREEN);
  }

  end(): void {
    for (const [m, n] of [[this.stakesM, this.ns], [this.sproutsM, this.np]] as const) {
      m.count = n;
      m.visible = n > 0;
      if (n) {
        m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, n * 16); m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) { m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, n * 3); m.instanceColor.needsUpdate = true; }
      }
    }
  }

  dispose(): void {
    this.stakesM.geometry.dispose(); this.sproutsM.geometry.dispose();
  }
}
