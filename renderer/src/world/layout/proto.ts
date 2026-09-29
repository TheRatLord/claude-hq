// @pure
/**
 * M1 proto room (§7.1 D7): ≈ 12 × 9 m, 12 desks in 3 pods of 4 (2 × 2, facing), a 3-seat sofa corner, a help counter
 * with a short queue, a window with sky, toy proportions (desk 0.55 m, chair seat 0.32 m, Clawd 0.88 m).
 * Same schema as hq.ts (see schema.ts). World coords; yaw camera-style (forward = (−sin yaw, 0, −cos yaw)).
 *
 * Plan (north up; spawn * looks north):
 *   ┌──[ window ]────────── board ── shelf ──────┐
 *   │ counter q q q                     rug  sofa│
 *   │ [help]                            table  ║ │
 *   │                                           │
 *   │   ╔═pod 0═╗     ╔═pod 1═╗     ╔═pod 2═╗  door
 *   │   ╚═══════╝     ╚═══════╝     ╚═══════╝   │
 *  win                                  cooler  │
 *   │ plant               *              plant │
 *   └────────────────────────────────────────────┘
 * Owner: LVL (built by RND for M1).
 */
import { MISC, ENV, CORE } from '../../../../shared/palette.ts';
import type { Furniture, LampAnchor, Layout, ProtoLayout, Slot, Wall, WindowRect } from './schema.ts';

const W = 12, D = 9, H = 2.8;
const minX = -W / 2, maxX = W / 2, minZ = -D / 2, maxZ = D / 2;

/** Desk / pod geometry (shared with greybox.ts). */
export const DESK = Object.freeze({
  w: 1.1, h: 0.55, d: 0.62,
  /** Chair back top (m): ≤ seat 0.32 + 0.2 so a seated Clawd seen from behind shows its whole head and shoulders
   *  ([LVL fix r3] 0.52 → 0.48: a low lumbar pad, so from the entrance the Clawd reads as sitting in the chair). */
  chairBack: 0.48,
  /** [LVL fix r3] Chair back (chair-local, +z = behind the sitter): a thin panel hung off the rear edge of the 0.44 m
   *  seat and reclined (top away from the sitter), with its front face `backFront` m behind the chair centre. The
   *  desk slot sits `sitForward` m ahead of the chair centre, so the 0.46 m-deep seated body (back face 0.23 m behind
   *  the slot) keeps a ≈ 8 cm gap to the backrest and never sinks into it — even leaning back in `lounge`
   *  (proto.test.ts checks both gaps). */
  back: { z: 0.245, t: 0.05, h: 0.13, recline: 0.12 },
  sitForward: 0.1,
  /** P1 sightlines from spawn (proto.test.ts): toy monitors are low (top 0.76 m, under the 0.68 m seated eye line
   *  seen from the 1.2 m player eye), and the agents shift toward the pod's aisle (m, per row [north, south]) so the
   *  south row, seen from behind, does not sit in front of the north-row faces. The monitor follows its agent. */
  sitShift: [0.35, 0.1], monitorShift: 0.27,
  monitor: { w: 0.42, h: 0.2, lift: 0.12 },
});
/**
 * Desk-local placement of a desk's monitor and agent (greybox.ts builds from this; proto.test.ts checks sightlines).
 * `m` = +1 when desk-local +x points at the pod centre (local +x is world +x for yaw 0, world −x for yaw π).
 * `f` is the desk furniture.
 */
export function deskLocal(f: { side?: number; row?: number; m?: number; yaw: number }) {
  const m = f.m ?? (f.side ? -f.side * Math.sign(Math.cos(f.yaw)) : 1); // hq desks carry `m` explicitly
  const agentX = -m * DESK.sitShift[f.row ?? 0], x = -m * DESK.monitorShift, z = -0.17;
  const { w, h, lift } = DESK.monitor;
  // screen turned toward the agent's eyes (≈ 0.75 m in front of the monitor)
  return { m, agentX, monitor: { x, y: DESK.h + lift, z, w, h, twist: Math.atan2(agentX - x, 0.75) } };
}
export const POD_X = Object.freeze([-3.75, -0.15, 3.8]);
export const POD_Z = 0.1;

const furniture: Furniture[] = [];
const slots: Slot[] = [];
const lamps: LampAnchor[] = [];

// ---- desks: 3 pods of 4; row N agents face south (toward spawn), row S agents face north -------------------------
let n = 0;
POD_X.forEach((cx, pod) => {
  for (const row of [0, 1] as const) { // 0 = north row (faces camera), 1 = south row
    for (const side of [-1, 1] as const) {
      const x = cx + side * (DESK.w / 2 + 0.02);
      const ax = x + side * DESK.sitShift[row]; // agent sits off-centre, toward the aisle; the monitor sits toward the pod centre
      const dz = row === 0 ? -(DESK.d / 2 + 0.01) : DESK.d / 2 + 0.01;
      const z = POD_Z + dz;
      const yaw = row === 0 ? Math.PI : 0; // agent facing: north row looks south (+z)
      const seatZ = z + (row === 0 ? -1 : 1) * (DESK.d / 2 + 0.36);
      const id = `desk${n}`;
      furniture.push({ id, type: 'desk', pos: { x, y: 0, z }, yaw, size: [DESK.w, DESK.h, DESK.d], solid: true, pod, side, row });
      furniture.push({ id: `chair${n}`, type: 'chair', pos: { x: ax, y: 0, z: seatZ }, yaw, size: [0.5, 0.32, 0.5], solid: false });
      // sit DESK.sitForward ahead of the chair centre (toward the desk) so the seated body clears the backrest
      const sitZ = seatZ + (row === 0 ? 1 : -1) * DESK.sitForward;
      slots.push({ id: `slot:desk:${n}`, tag: 'desk', pos: { x: ax, y: 0, z: sitZ }, yaw, pose: 'sit', level: 0, anchor: id, pod });
      n++;
    }
  }
  furniture.push({ id: `podRug${pod}`, type: 'podRug', pos: { x: cx, y: 0, z: POD_Z }, yaw: 0, size: [3.1, 0.01, 3.4], solid: false });
  // pendant over each pod
  lamps.push({ id: `pendant${pod}`, kind: 'pendant', pos: { x: cx, y: 2.25, z: POD_Z }, radius: 4.0, color: '#FFD9A8', gain: 0.25 }); // [LVL fix r2] gain 0.1 → 0.25, radius 3.2 → 4.0: visible warm pools over the desks at night (+2..5 luma at 22 h)
});
// one desk lamp per pod: north-row desk, front inner corner (clear of the agent's face from spawn), shade leaning
// in over the keyboard
[1, 4, 9].forEach((d) => {
  const f = furniture.find((q) => q.id === `desk${d}`);
  if (!f?.side) throw new Error(`proto: desk${d} missing`);
  const x = f.pos.x - f.side * 0.46, z = f.pos.z - 0.2;
  const yaw = f.side * Math.PI / 2;
  furniture.push({ id: `lamp${d}`, type: 'deskLamp', pos: { x, y: DESK.h, z }, yaw, size: [0.2, 0.42, 0.2], solid: false });
  lamps.push({ id: `deskLamp${d}`, kind: 'desk', pos: { x: x + f.side * 0.1, y: DESK.h + 0.36, z }, radius: 1.3, color: '#FFD49A', gain: 0.2 });
});

// ---- sofa corner (NE): sofa against the east wall facing west, coffee table, rug, floor lamp in the corner -------
const SOFA = { x: 5.35, z: -2.75 };
furniture.push({ id: 'sofa0', type: 'sofa', pos: { x: SOFA.x, y: 0, z: SOFA.z }, yaw: -Math.PI / 2, size: [2.4, 0.72, 0.85], solid: true });
for (let i = 0; i < 3; i++) {
  slots.push({ id: `slot:sofa:${i}`, tag: 'sofa', pos: { x: SOFA.x - 0.12, y: 0, z: SOFA.z - 0.78 + i * 0.78 }, yaw: Math.PI / 2, pose: 'sit', level: 0, anchor: 'sofa0' });
}
furniture.push({ id: 'coffee0', type: 'coffeeTable', pos: { x: 3.6, y: 0, z: SOFA.z }, yaw: 0, size: [0.7, 0.3, 1.2], solid: true });
furniture.push({ id: 'rug0', type: 'rug', pos: { x: 4.3, y: 0, z: SOFA.z }, yaw: 0, size: [2.6, 0.01, 3.0], solid: false });
furniture.push({ id: 'floorLamp0', type: 'floorLamp', pos: { x: 5.55, y: 0, z: -4.12 }, yaw: 0, size: [0.4, 1.55, 0.4], solid: true });
lamps.push({ id: 'floorLamp0', kind: 'floor', pos: { x: 5.5, y: 1.45, z: -4.05 }, radius: 2.8, color: '#FFCF94', gain: 0.26 });
// reading lamp at the north end of the west aisle, by the window (the `proto` pose's lamp-pool probe)
furniture.push({ id: 'floorLamp1', type: 'floorLamp', pos: { x: -1.85, y: 0, z: -3.85 }, yaw: 0, size: [0.4, 1.55, 0.4], solid: true });
lamps.push({ id: 'floorLamp1', kind: 'floor', pos: { x: -1.85, y: 1.15, z: -3.75 }, radius: 4.5, color: '#FFE8CC', gain: 0.3 });

// ---- help counter (NW, under the window) + queue going east ---------------------------------------------------
const CTR = { x: -4.9, z: -2.9 };
furniture.push({ id: 'counter0', type: 'counter', pos: { x: CTR.x, y: 0, z: CTR.z }, yaw: Math.PI / 2, size: [2.0, 0.9, 0.6], solid: true });
furniture.push({ id: 'beacon0', type: 'beacon', pos: { x: CTR.x, y: 0.9, z: CTR.z + 0.8 }, yaw: 0, size: [0.2, 0.3, 0.2], solid: false });
slots.push({ id: 'slot:staff:0', tag: 'staff', pos: { x: -5.6, y: 0, z: CTR.z }, yaw: -Math.PI / 2, pose: 'stand', level: 0, anchor: 'counter0' });
// [LVL fix r2] 1.05 m pitch (0.72 m bodies → a 0.33 m gap a waving arm clears) and the line angled 22° away from the
// counter toward the room, so the three read as a queue in depth rather than a shoulder-to-shoulder lineup.
// Each spot faces the one ahead (the head faces the counter window).
const Q = { pitch: 1.05, angle: 22 * Math.PI / 180 };
for (let i = 0; i < 3; i++) {
  const x = -4.05 + i * Q.pitch * Math.cos(Q.angle), z = CTR.z + i * Q.pitch * Math.sin(Q.angle);
  slots.push({ id: `slot:queue:${i}`, tag: 'queue', pos: { x, y: 0, z }, yaw: i ? Math.PI / 2 - Q.angle : Math.PI / 2, pose: 'stand', level: 0, anchor: 'counter0' });
}

// ---- dressing: plants, shelf, water cooler, whiteboard (§7.5 kit arrives with ENV in M1.75) --------------------
furniture.push({ id: 'plant0', type: 'plant', pos: { x: -5.4, y: 0, z: 3.95 }, yaw: 0, size: [0.6, 1.2, 0.6], solid: true });
furniture.push({ id: 'plant1', type: 'plant', pos: { x: 5.4, y: 0, z: 3.95 }, yaw: 0, size: [0.6, 1.0, 0.6], solid: true });
furniture.push({ id: 'plant2', type: 'plantSmall', pos: { x: -0.4, y: 0, z: -4.1 }, yaw: 0, size: [0.45, 0.7, 0.45], solid: true });
furniture.push({ id: 'shelf0', type: 'shelf', pos: { x: 2.35, y: 0, z: -4.18 }, yaw: 0, size: [1.8, 1.25, 0.4], solid: true });
furniture.push({ id: 'cooler0', type: 'cooler', pos: { x: 5.55, y: 0, z: 2.6 }, yaw: -Math.PI / 2, size: [0.4, 1.1, 0.4], solid: true });
furniture.push({ id: 'board0', type: 'whiteboard', pos: { x: 0.6, y: 0.95, z: -4.4 }, yaw: 0, size: [2.0, 1.0, 0.05], solid: false });

/** a→b wound clockwise seen from above; the room is on the right. */
const walls: Wall[] = [
  { a: [minX, minZ], b: [maxX, minZ], h: H, openings: [{ at: 1.0, w: 3.8, h: 1.45, sill: 0.75, kind: 'window' }] },
  { a: [maxX, minZ], b: [maxX, maxZ], h: H, openings: [{ at: 4.4, w: 1.4, h: 1.7, sill: 0, kind: 'door' }] },
  { a: [maxX, maxZ], b: [minX, maxZ], h: H },
  { a: [minX, maxZ], b: [minX, minZ], h: H, openings: [{ at: 1.6, w: 1.9, h: 1.35, sill: 0.8, kind: 'window' }] },
];

/** Window rects for the gobo (§5.6) — centre, inward normal, size. Derived from the openings above. */
const windows: WindowRect[] = [];
for (const w of walls) {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const ux = (w.b[0] - w.a[0]) / len, uz = (w.b[1] - w.a[1]) / len;
  for (const o of w.openings ?? []) {
    if (o.kind !== 'window') continue;
    const s = o.at + o.w / 2;
    // inward normal = right of a→b for a clockwise winding
    windows.push({ center: { x: w.a[0] + ux * s, y: o.sill + o.h / 2, z: w.a[1] + uz * s }, normal: { x: -uz, y: 0, z: ux }, w: o.w, h: o.h });
  }
}

/** §9.2 pose `proto` + friends live in debug/poses.ts; the layout spawn equals `proto`. */
const spawn: Layout['spawn'] = [-1.85, 0, 3.95, -0.12, -0.1];
/** [BRN fix r1, cross-owner: LVL] authored viewpoints the brain keeps clear (= the proto poses; sync: director.test.ts). */
const V = (id: string, x: number, z: number, yaw: number) => Object.freeze({ id, x, z, level: 0, yaw });
const KEEP_CLEAR_VIEWS = Object.freeze([
  V('proto', spawn[0], spawn[2], spawn[3]), V('protoDesks', 1.7, 1.9, 0.6), V('protoCorner', -5.3, 3.9, -0.69),
  V('protoSofa', 3.4, -3.8, -1.9), V('protoHelp', -5.85, -3.2, -1.85), V('protoWindow', 3.2, 3.8, 0.65),
]);

/** Flat-colour value map for the proto room (BAY row of §5.5). */
export const PROTO_COLORS = Object.freeze({
  floor: MISC.bayCarpet, wall: ENV.wallCream, ceiling: '#DDE1D5', trim: MISC.trim, wainscot: '#A89A86',
  desk: ENV.oak, deskLeg: ENV.walnut, rug: MISC.pitRug, sofa: MISC.pitSofa, counter: ENV.walnut, ink: CORE.ink,
});

export const layout: ProtoLayout = Object.freeze<ProtoLayout>({
  id: 'proto',
  bounds: { minX, maxX, minZ, maxZ },
  height: H,
  walls,
  furniture,
  slots,
  pods: [0, 1, 2].map((p) => slots.filter((s) => s.tag === 'desk' && s.pod === p).map((s) => s.id)),
  zones: [{ id: 'proto', rect: [minX, minZ, maxX, maxZ], level: 0 }],
  visCells: [{ id: 'proto', rect: [minX, minZ, maxX, maxZ], level: 0 }],
  anchors: lamps.map((l) => ({ id: l.id, pos: l.pos, kind: `lamp:${l.kind}` })),
  lamps,
  windows,
  points: {
    spawn: { x: spawn[0], z: spawn[2] },
    entrance: { x: maxX - 0.7, z: minZ + 4.4 + 0.7 },
    helpDesk: { x: CTR.x, z: CTR.z },
    staffMat: { x: -5.6, z: CTR.z },
    queue: slots.filter((s) => s.tag === 'queue').map((s) => ({ x: s.pos.x, z: s.pos.z })),
  },
  /** Open floor used by `__hq.clayCheck()`'s probe sheet (camera stands here, sheet 1.7 m west). */
  probeSpot: { x: 4.6, z: 2.9 },
  spawn,
  keepClearViews: KEEP_CLEAR_VIEWS,
  floorY: () => 0,
  zoneAt: (x: number, z: number) => (x >= minX && x <= maxX && z >= minZ && z <= maxZ ? 'proto' : null),
});
