// @pure
/**
 * The real hq desks as the player sees them (test fixture for standSpot / dive; PLY m3 fix r1, reviewer [code]: the old
 * fixtures used an assumed monitor (proto.ts deskLocal + DESK.monitor.h / 2, no tilt) instead of the placed screen).
 * Built from the same sources the world build uses: the layout's desk slots + furniture (world/layout/hq.ts), ENV's bay
 * dressing (world/build/zones/bays.ts `dressBays`, which places each desk's `monitor` kit item and reports its
 * `anchors.screen`) and the monitor kit (kit/tech.ts `buildMonitor`: glass size + tilt). The result matches RND's
 * `deskScreens.screenRect(anchor)` in the running app (checked live: centre, normal and size to 1 mm).
 * Node-only helpers (no three.js); nothing in the running app imports this file.
 * Owner: PLY.
 */
import { dressBays } from '../world/build/zones/bays.ts';
import { buildMonitor } from '../world/build/kit/tech.ts';
import type { DressKit } from '../world/build/zones/common.ts';
import type { Item } from '../world/build/kit/core.ts';
import type { Furniture, HqLayout, Slot } from '../world/layout/schema.ts';

/** What the fixture's kit returns for every prop but the monitor (dressBays reads nothing from it). */
const EMPTY_ITEM: Item = { parts: [], footprint: { r: 0 }, solid: false, anchors: {}, colors: {} };
import type { DeskBox, Screen } from './dive.ts';

/** Seated Clawd (chars/render/geometry.ts BODY_W 0.72 × BODY_D 0.46 on a 0.32 m seat; party-hat tip ≈ 1.15 m). */
export const SEATED = Object.freeze({ seatY: 0.32, top: 0.95, hatTop: 1.15, faceY: 0.62, halfW: 0.36, halfD: 0.23 });

export interface HqDesk { slot: Slot; desk: Furniture; seatYaw: number; screen: Screen }

/** Every dressed desk of `layout` (E bays by default: the W-bay desk sets are ENV's swap groups with hidden screens). */
export function hqDesks(layout: HqLayout, bays = ['E1', 'E2', 'E3']): HqDesk[] {
  const built: { mon?: ReturnType<typeof buildMonitor> } = {};
  // buildMonitor draws no randomness (its rng parameter is unused), so any stream will do
  const k: DressKit = {
    swap: null,
    put: (name, params) => ({ item: name === 'monitor' ? (built.mon = buildMonitor(params ?? undefined, () => 0)) : EMPTY_ITEM, m: null }),
  };
  const { screens } = dressBays(layout, k, bays);
  const a = built.mon?.anchors?.screen ?? { w: 0.37, h: 0.155, rx: -0.1 };
  const out: HqDesk[] = [];
  for (const s of screens) {
    const slot = layout.slots.find((q) => q.tag === 'desk' && q.anchor === s.anchor);
    const desk = layout.furniture.find((f) => f.id === s.anchor);
    if (!slot || !desk) continue;
    // screen-local +z (out of the glass) tilted by rx about x, then turned by yaw (three rotation.y: +z → (sin, cos))
    const rx = s.rx ?? a.rx ?? 0, cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const ln = { y: -Math.sin(rx), z: Math.cos(rx) }, lu = { y: Math.cos(rx), z: Math.sin(rx) };
    out.push({
      slot, desk, seatYaw: slot.yaw,
      screen: { x: s.p.x, y: s.p.y, z: s.p.z, nx: ln.z * sy, ny: ln.y, nz: ln.z * cy, ux: lu.z * sy, uy: lu.y, uz: lu.z * cy, w: a.w, h: a.h },
    });
  }
  return out;
}

/** Oriented desk box (world): {x, z, c, s, hw, hd, y0, y1} for point / segment tests. */
export function deskBox(f: Furniture): DeskBox {
  return { x: f.pos.x, z: f.pos.z, c: Math.cos(f.yaw ?? 0), s: Math.sin(f.yaw ?? 0), hw: f.size[0] / 2, hd: f.size[2] / 2, y0: f.pos.y ?? 0, y1: (f.pos.y ?? 0) + f.size[1] };
}
