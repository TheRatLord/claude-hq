/**
 * Prop kit: tech (§7.5 rows 13, 14, 23): monitor (the screen itself is the status-driven `screen` InstancedMesh,
 * placed from `anchors.screen`), keyboard + mouse, server rack. Owner: ENV.
 */
import { rbox, cyl, sphere, capsule, tube, disc, at, part, vary } from './core.ts';
import type { KitParams, Rng, V3 } from './core.ts';
import { T } from './tokens.ts';

/**
 * 13 · monitor: chunky bezel with a deeper chin, round-foot stand, a back cable to the desk. Origin = desk top;
 * the bezel centre sits `lift` up, tilted back 0.1 rad. `anchors.screen` = {x, y, z, rx, w, h} (local).
 */
export function buildMonitor(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 0.42, h = p.h ?? 0.2, lift = p.lift ?? 0.12, tilt = -0.1;
  const parts = [
    part(at(rbox(w, h, 0.05, 0.022, 2), 0, lift, -0.005, tilt), 'body'),
    part(at(rbox(w * 0.96, 0.028, 0.056, 0.01), 0, lift - h / 2 + 0.006, 0.0, tilt), 'body', { ao: 0.85 }), // chin
    part(at(rbox(w * 0.5, h * 0.6, 0.03, 0.012), 0, lift, -0.04, tilt), 'body', { ao: 0.8 }), // back hump
    part(at(rbox(0.05, lift - 0.02, 0.022, 0.008), 0, (lift - 0.02) / 2, -0.035), 'body'),
    part(at(disc(0.075, 0.014, 16, 0.005), 0, 0, -0.03), 'body'),
    part(at(sphere(0.008, 6, 4), w * 0.3, lift - h / 2 + 0.008, 0.028, tilt), 'accent', { cast: false }), // power pip
    part(tube([[0, lift - 0.02, -0.06], [0, 0.04, -0.11], [0.05, 0.004, -0.15]], 0.005, 6, 3), 'body', { cast: false }),
  ];
  const sw = w - 0.05, sh = h - 0.045;
  return { parts, footprint: { w, d: 0.15 }, solid: false, anchors: { screen: { x: 0, y: lift + 0.004, z: -0.005 + 0.026, rx: tilt, w: sw, h: sh } }, colors: { body: T.ink2, accent: T.trim }, hero: 'round-foot stand, bezel chin, back cable' };
}

/** 14 · keyboard + mouse: key-grid relief in cream rows, a capsule mouse with a coiled cable. Origin = desk top. */
export function buildKeyboard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng);
  const parts = [part(at(rbox(0.34, 0.018, 0.12, 0.008), 0, 0.009, 0, 0.04), 'body', { mat: 'small' })];
  for (let r = 0; r < 4; r++) parts.push(part(at(rbox(r === 3 ? 0.18 : 0.3, 0.008, 0.02, 0.003), r === 3 ? 0.0 : 0, 0.02 + r * 0.001, 0.036 - r * 0.025, 0.04), 'accent', { mat: 'small', cast: false }));
  const mx = p.mouse === false ? null : 0.25;
  if (mx !== null) {
    parts.push(part(at(capsule(0.022, 0.03, 3, 8), mx, 0.017, 0.02, Math.PI / 2, 0, 0, 1, 0.75, 1), 'body', { mat: 'small' }));
    const pts: V3[] = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push([mx + Math.sin(t * 9) * 0.012, 0.012 + t * 0.004, 0.0 - t * 0.14]); }
    parts.push(part(tube(pts, 0.003, 20, 3), 'secondary', { mat: 'small', cast: false }));
  }
  return { parts, footprint: { w: 0.4, d: 0.14 }, solid: false, anchors: {}, colors: { body: T.oat, secondary: T.ink, accent: T.trim }, small: true, hero: 'key-grid relief, coiled cable' };
}

/**
 * 23 · rack (server): ink body, tealDeep door panels, vent grilles, LED rows (STAT drives the real ones).
 */
export function buildRack(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.6, h = p.h ?? 1.9, d = p.d ?? 0.6;
  const parts = [part(at(rbox(w, h, d, 0.02, 1), 0, h / 2, 0), 'body')];
  const units = Math.floor((h - 0.2) / 0.16);
  for (let i = 0; i < units; i++) {
    const y = 0.12 + i * 0.16 + 0.08;
    parts.push(part(at(rbox(w - 0.08, 0.13, 0.012, 0.005), 0, y, d / 2 + 0.004), 'secondary'));
    parts.push(part(at(rbox(0.14, 0.05, 0.004), -w / 2 + 0.16, y + 0.003, d / 2 + 0.011), 'body', { cast: false, ao: 0.5 })); // vent grille
    for (let k = 0; k < 3; k++) parts.push(part(at(rbox(0.014, 0.014, 0.006), w / 2 - 0.1 + k * 0.024, y, d / 2 + 0.012), 'accent', { cast: false, ao: v.chance(0.5) ? 1 : 0.6 }));
  }
  parts.push(part(at(rbox(w + 0.02, 0.04, d + 0.02, 0.012), 0, h + 0.02, 0), 'body'));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(cyl(0.02, 0.02, 0.04, 8), sx * (w / 2 - 0.05), 0.0, sz * (d / 2 - 0.05)), 'body'));
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: T.ink, secondary: T.tealDeep, accent: T.status.shell }, hero: 'vent grilles + LED rows' };
}
