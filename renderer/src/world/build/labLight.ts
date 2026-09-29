/**
 * The Lab's live TEST light (§6.7 signal vocabulary: `test-pass` → TEST light green, `test-fail` → TEST light red):
 * three lenses (red · amber · green) in the kit `testLight` housing (zones/lab.ts publishes their world positions as
 * `k.labLight`). One mesh on the existing `screen` program (the lens colours × level live in a 3×1 map), so it costs
 * one draw and no new program. Standby: amber; a pass lights green (three quick blinks, then steady), a fail flashes
 * red at 1.5 Hz for 9 s; the last result then holds steady (one lens is always lit and state-true). `?labLight=pass|fail` holds a state (review shots). Owner: ENV.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial } from '../../render/materials/index.ts';
import { hqStatSection } from '../../core/debug.ts';
import { STATUS } from '../../../../shared/palette.ts';
import type { Ctx } from '../../core/ctx.ts';
import type { LabLightSpec } from './zones/common.ts';

const LENS = [STATUS.blocked, STATUS.shellBusy, STATUS.done];
const HOLD_S = 9;

type LightKind = 'idle' | 'pass' | 'fail';
const isLightKind = (s: string | null): s is LightKind => s === 'idle' || s === 'pass' || s === 'fail';
export interface LabLight { mesh: THREE.InstancedMesh; update: (c?: { dt?: number }) => void; dispose: () => void }

/** @param spec world lens centres + housing yaw */
export function createLabLight(spec: LabLightSpec, ctx: Pick<Ctx, 'store'>): LabLight {
  const r = spec.lenses[0]?.r ?? 0.056, n = spec.lenses.length;
  // one merged geometry: each lens disc samples its own texel of a n×1 colour texture (the screen program ignores
  // vertex / instance colours, so the lens colours ride in its map; state changes rewrite n texels)
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.yaw, 0));
  const discs = spec.lenses.map((l, i) => {
    const g = new THREE.CircleGeometry(r, 24);
    const uv = g.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (i + 0.5) / n, 0.5);
    g.applyQuaternion(q).translate(l.x, l.y, l.z);
    return g;
  });
  const geo = mergeGeometries(discs, false);
  for (const g of discs) g.dispose();
  const data = new Uint8Array(n * 4);
  const tex = new THREE.DataTexture(data, n, 1);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = getMaterial('screen', { color: '#FFFFFF', emissive: 1.5, instanced: true, uniforms: {} }); // [STAT m2 r2] 1.35 → 1.5 (accent ≤ 1.6): the lit lens reads at 13h
  Object.assign(mat, { map: tex });
  // [RND fix r1, cross-owner ENV] count-1 InstancedMesh + instanced material: shares the one §5.4 screen program (a plain
  // Mesh compiled an off-matrix screen variant the first time the library / lab came into view)
  const mesh = new THREE.InstancedMesh(geo, mat, 1);
  mesh.name = 'env:labLight';
  const cols = LENS.map((h) => new THREE.Color(h));
  const tmp = new THREE.Color();
  let state: { kind: LightKind; t0: number } = { kind: 'idle', t0: 0 };
  let now = 0, last = '';
  const set = (kind: LightKind) => { state = { kind, t0: now }; };
  const off = ctx?.store?.on?.('event', (ev) => {
    if (ev?.kind === 'test-pass') set('pass');
    else if (ev?.kind === 'test-fail') set('fail');
  });
  // review shots: `?labLight=pass|fail` holds that state (no __hq surface change: §9.1 is LEAD's)
  const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('labLight') : null;
  hqStatSection('labLight', () => ({ state: state.kind, age: +(now - state.t0).toFixed(1), lit: ['red', 'amber', 'green'][levels.indexOf(Math.max(...levels))] ?? null, flashing: state.kind !== 'idle' && now - state.t0 <= HOLD_S }));
  const levels: number[] = n === 3 ? [0.1, 0.75, 0.1] : new Array<number>(n).fill(0.18);
  const paint = () => {
    const key = levels.map((v) => v.toFixed(2)).join('|');
    if (key === last) return;
    last = key;
    levels.forEach((v, i) => {
      tmp.copy(cols[i]).convertLinearToSRGB().multiplyScalar(v);
      data[i * 4] = Math.round(tmp.r * 255); data[i * 4 + 1] = Math.round(tmp.g * 255); data[i * 4 + 2] = Math.round(tmp.b * 255); data[i * 4 + 3] = 255;
    });
    tex.needsUpdate = true;
  };
  paint();
  return {
    mesh,
    update(c?: { dt?: number }) {
      now += Math.min(0.1, c?.dt ?? 0.016);
      const age = now - state.t0;
      if (forced && state.kind !== forced) state = { kind: isLightKind(forced) ? forced : 'idle', t0: now };
      // [STAT m2 r2 art, cross-owner] one lens is ALWAYS lit and state-true (review: a 'fail' shot caught the blink's
      // 0.22 "off" phase and read fully dark at 13h): the last result holds after its flash window instead of
      // falling back to standby; the fail flash swings 1.0 ↔ 0.5 (never dark); standby = a clear amber
      const flash = age <= HOLD_S;
      levels[0] = levels[1] = levels[2] = 0.1;
      if (state.kind === 'pass') levels[2] = flash && age < 0.9 ? (Math.floor(age / 0.15) % 2 ? 0.45 : 1) : 1;
      else if (state.kind === 'fail') levels[0] = flash ? (Math.sin(age * Math.PI * 3) > -0.2 ? 1 : 0.5) : 0.9;
      else levels[1] = 0.75; // standby: amber
      paint();
    },
    dispose() { if (typeof off === 'function') off(); geo.dispose(); tex.dispose(); },
  };
}
