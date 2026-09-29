/**
 * Studio Street (§7.1 STR, §5.5 value map: slate-green pavers, painted sage brick, dark ceiling so the string lights
 * pop): six storefronts with striped awnings + scalloped valances and slate-teal door mats, the layout's street lamps
 * (lantern posts on the lamp anchors), bay banners on iron wall brackets, a zig-zag of string lights under the dark
 * ceiling, the layout's planters + bench, chalk A-frame boards, a bicycle with a flower basket, a post box, a bin —
 * and the signature flower stall on the east stoop. The street lane (plan x 5.5–7.5) stays clear; everything
 * floor-standing lives on the 0.5 m stoops between the storefront doors. Owner: ENV.
 */
import { W, poseOf } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { T } from '../kit/tokens.ts';
import { WORKSPACE } from '../../../../../shared/palette.ts';

const PI = Math.PI;
/** Street wall faces (plan x): west stoop wall, east stoop wall. */
const WX = 5.1, EX = 7.9;
/** Awning stripe pairs per bay (trim + a cool dusk tone; §5.5 low chroma, no warm-on-warm over the stoops). */
const STRIPES: Record<string, [string, string]> = {
  W1: [T.trim, '#6E6A8E'], W2: [T.trim, '#5F7F7A'], W3: [T.trim, '#6B8A73'],
  E1: [T.trim, '#5B6F8A'], E2: [T.trim, '#6C8D88'], E3: [T.trim, '#7A6A8C'],
};

/** [ENV fix m2 r2] banner cloths: the muted accent tokens, cycled along the street. */
const BANNER_CLOTH = [T.tealDeep, T.lavender, T.walnut];

export function dressStreet(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'STR')) return;
  // storefronts: awning over each door (both walls), a door mat on the stoop threshold
  for (const b of layout.bays) {
    const west = b.side === 'W', zc = b.storefront.z + 14, x = west ? WX : EX, yaw = west ? PI / 2 : -PI / 2;
    const [c0, c1] = STRIPES[b.id] ?? [T.trim, '#6C8D88'];
    k.put('awning', { w: 2.7, d: 0.5, colors: { body: c0, secondary: c1 } }, W(x, zc, 2.84, yaw), `str:awning:${b.id}`, 0);
    k.put('rug', { kind: 'rect', w: 1.5, d: 0.42, fringe: false, colors: { body: '#52625E', secondary: '#46534F', accent: '#5C6C67' } }, W(west ? 5.33 : 7.67, zc, 0.002, PI / 2), `str:mat:${b.id}`, 0);
  }
  // the layout's street furniture (LVL ids: lamp posts, planters, bench, banners)
  let bi = 0, bi2 = 0;
  for (const f of layout.furniture) {
    if (f.zone !== 'STR') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'planter': k.put('planter', { w: Math.max(w, d), h: h * 0.85, d: Math.min(w, d), colors: { body: bi++ % 2 ? T.teal : '#6F8A84' } }, { ...p, yaw: (p.yaw ?? 0) + (d > w ? PI / 2 : 0) }, f.id, 0.2); break;
      case 'bench': {
        k.put('bench', { w, d: 0.42, h: 0.42 }, p, f.id, 0.2);
        k.put('cushion', { w: 0.3, h: 0.26, colors: { body: T.lavender } }, { x: p.x, y: 0.42, z: p.z + 0.35, yaw: p.yaw, rx: -0.3 }, `${f.id}:c`, 0);
        k.put('tote', { out: 'bread', colors: { body: '#B9C4B0' } }, { x: p.x + 0.05, y: 0, z: p.z - 0.8, yaw: 1.2, rx: -0.1 }, `${f.id}:tote`, 0);
        break;
      }
      case 'banner': {
        // bracket at the wall face, arm into the street; cloth in the workspace jewel of the bay behind that wall
        const west = f.pos.x < -14; // plan x 5.15 vs 7.85
        const zc = f.pos.z;
        const bay = layout.bays.find((q) => q.side === (west ? 'W' : 'E') && zc + 14 >= q.rect[1] + 14 && zc + 14 <= q.rect[3] + 14);
        const jewel = WORKSPACE[(bay?.pod ?? 0) % WORKSPACE.length].hex;
        // [ENV fix m2 r2] review: the royal-blue / magenta cloths were the most saturated things in the street (above the
        // agents: breaks 60/30/10); the cloth is now a desaturated accent token, the jewel shrinks to the roundel dot
        const cloth = BANNER_CLOTH[bi2++ % BANNER_CLOTH.length];
        k.put('streetBanner', { w: 0.44, h: 0.84, emblem: jewel, ring: T.brass, colors: { body: cloth, secondary: T.trim } }, { x: (west ? WX : EX) - 20.5, y: 2.72, z: zc, yaw: west ? PI / 2 : -PI / 2 }, f.id, 0);
        break;
      }
      default: break; // streetLamp: from the lamp anchors below (the lantern carries the pool)
    }
  }
  // lantern posts on the street lamp anchors (bulb at the anchor height)
  for (const l of layout.lamps) {
    if (l.kind !== 'street' || layout.zoneAt(l.pos.x, l.pos.z, 0) !== 'STR') continue;
    k.put('lamp', { kind: 'street', bulbY: l.pos.y }, { x: l.pos.x, y: 0, z: l.pos.z, yaw: 0 }, l.id, 0.15);
  }
  // string lights: a zig-zag of spans wall to wall under the dark ceiling (3.4 m), each hooked to a wall nail
  const zs = [2.4, 4.6, 6.9, 9.1, 11.4, 13.6, 15.9, 18.1, 20.5];
  for (let i = 0; i < zs.length - 1; i++) {
    const [ax, bx] = i % 2 ? [EX - 0.02, WX + 0.02] : [WX + 0.02, EX - 0.02];
    const a = W(ax, zs[i], 3.08), b = W(bx, zs[i + 1], 3.08);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    k.put('lamp', { kind: 'string', len, sag: 0.28, n: 7 }, { ...a, yaw: Math.atan2(-(b.z - a.z), b.x - a.x) }, `str:lights:${i}`, 0);
  }
  // window boxes under every display window (street side, sill 0.55), hanging baskets beside the lamp lanterns
  for (const w of layout.walls) {
    if (w.kind !== 'storefront') continue;
    const west = Math.abs(w.a[0] + 15.5) < 0.05, z0 = Math.min(w.a[1], w.b[1]);
    for (const o of w.openings ?? []) {
      if (o.kind !== 'display') continue;
      const zc = z0 + o.at + o.w / 2;
      k.put('planter', { w: o.w - 0.25, h: 0.2, d: 0.2, colors: { body: west ? '#6F8A84' : T.teal } }, { x: west ? -15.29 : -12.71, y: 0.33, z: zc, yaw: PI / 2 }, `str:windowBox:${west ? 'W' : 'E'}${zc.toFixed(1)}`, 0);
    }
  }
  for (const l of layout.lamps) {
    if (l.kind !== 'street' || layout.zoneAt(l.pos.x, l.pos.z, 0) !== 'STR') continue;
    k.put('plant', { kind: 'pothos', drop: 0.4 }, { x: l.pos.x + (l.pos.x < -14 ? -0.05 : 0.05), y: 1.62, z: l.pos.z - 0.3, yaw: l.pos.z }, `str:basket:${l.id}`, 0);
  }
  // stoop life: A-frame boards by the doors, a bicycle, a post box, a bin, potted shrubs, and the flower stall
  k.put('aFrame', { doodle: T.lavender }, W(5.3, 4.28, 0, 0.15), 'str:aframe:W1', 0.12);
  k.put('plant', { kind: 'bush', h: 0.7, flowers: true }, W(5.3, 16.45, 0, 1.4), 'str:shrub:W3', 0.18);
  k.put('aFrame', { doodle: T.butter }, W(7.7, 7.3, 0, 0.1), 'str:aframe:E1', 0.12);
  k.put('crate', { w: 0.42, h: 0.3, d: 0.36 }, W(7.7, 16.5, 0, 0.2), 'str:crate:E3', 0.15);
  k.put('crate', { w: 0.36, h: 0.26, d: 0.3 }, { ...W(7.72, 16.55, 0.3, -0.25) }, 'str:crate:E3b', 0);
  k.put('plant', { kind: 'fern', h: 0.4 }, W(7.72, 16.55, 0.56, 0), 'str:crate:E3fern', 0);
  k.put('bicycle', { colors: { body: '#4E7C78' } }, W(5.34, 13.5, 0, PI / 2), 'str:bicycle', 0.12);
  k.put('mailbox', {}, W(7.68, 2.45, 0, -PI / 2), 'str:mailbox', 0.15);
  k.put('bin', {}, W(5.3, 20.5, 0, 0), 'str:bin', 0.1);
  k.put('plant', { kind: 'bush', h: 0.72, flowers: true }, W(7.7, 7.85, 0, 0.3), 'str:shrub:E1', 0.18);
  k.put('plant', { kind: 'fern', h: 0.62 }, W(5.3, 10.0, 0, 0.8), 'str:shrub:W2', 0.18);
  k.put('plant', { kind: 'cactus', h: 0.55 }, W(7.7, 12.95, 0, 0.8), 'str:shrub:E2', 0.15);
  k.put('flowerStall', { w: 1.2 }, W(7.67, 14.1, 0, -PI / 2), 'str:flowerStall', 0.25);
  // exposed service pipes under the dark ceiling, one per side, with brass valve wheels (the "studio" in the street)
  for (const [x, i] of [[WX + 0.16, 0], [EX - 0.16, 1]]) {
    for (const [z0, len] of [[2.1, 9.3], [11.5, 9.3]]) k.put('radiator', { kind: 'pipe', len, colors: { body: '#8C938B' } }, { ...W(x, z0, 3.22, 0), rx: PI / 2 }, `str:pipe:${i}:${z0}`, 0);
  }
  // wall art between the storefronts, above head height (brick is busy: a few enamel plaques + a clock-less poster)
  k.put('poster', { w: 0.55, h: 0.7, style: 0 }, W(WX + 0.01, 8.95, 1.35, PI / 2), 'str:poster:0', 0);
  k.put('poster', { w: 0.5, h: 0.62, style: 2 }, W(EX - 0.01, 2.95, 1.3, -PI / 2), 'str:poster:1', 0);
}
