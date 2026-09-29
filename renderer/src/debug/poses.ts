// @pure
/**
 * Canonical poses (§9.2): world coords `x,y,z,yaw,pitch`, y = feet. Each pose carries its probe pixels
 * `{wallLit, wallShade, floor, floorPool?, ceiling}` (screen px at 1600×900, measured on the shots) and a
 * `floorCrop` rect `[x, y, w, h]` for edgeCheck. hq poses get their probes when hq.ts lands (M1.5).
 * Owner: LVL.
 */

export type Pose5 = readonly [x: number, y: number, z: number, yaw: number, pitch: number];
export type PoseLayoutId = 'proto' | 'hq';
export interface PoseDef {
  pose: Pose5;
  layout: PoseLayoutId;
  probes: Readonly<Record<string, readonly [number, number]>> | null;
  /** x, y, w, h */
  floorCrop: readonly [number, number, number, number] | null;
  note?: string;
}

const P = (
  pose: Pose5,
  layout: PoseLayoutId = 'hq',
  probes: Record<string, [number, number]> | null = null,
  floorCrop: [number, number, number, number] | null = null,
  note?: string,
): PoseDef => Object.freeze({ pose: Object.freeze(pose), layout, probes: probes && Object.freeze(probes), floorCrop, note });

export const POSES: Readonly<Record<string, PoseDef>> = Object.freeze({
  // M1 proto room. `proto` = the review pose (§5.0 radiometry at 13/18/22 h): window + pods + sofa lamp + counter.
  proto: P([-1.85, 0, 3.95, -0.12, -0.1], 'proto',
    { wallLit: [1200, 260], wallShade: [70, 330], floor: [700, 850], floorPool: [705, 512], ceiling: [800, 150] },
    [640, 790, 420, 110], 'spawn view: window, three pods, sofa corner + floor lamp, help counter'),
  protoDesks: P([1.7, 0, 1.9, 0.6, -0.3], 'proto', null, null, 'over the middle pod'),
  protoCorner: P([-5.3, 0, 3.9, -0.69, -0.12], 'proto', null, null, 'from the SW corner across the pods to the sofa'),
  // [LVL fix r2] protoSofa / protoHelp / protoWindow stand ≥ 1.5 m from every seat (the old sofa spot put a pod-2
  // sitter's hat over 40 % of the frame; the old help spot stood in desk 4's chair). The director keeps 1.5 m round
  // every camera clear of standers, so the two back-wall cameras sit in dead corners (by the shelf / behind the
  // counter) instead of eating the back overflow strip (seat distance: proto.test.ts; strip: director.test.ts).
  protoSofa: P([3.4, 0, -3.8, -1.9, -0.2], 'proto', null, null, 'sofa corner and floor lamp, from beside the shelf'),
  protoHelp: P([-5.85, 0, -3.2, -1.85, 0], 'proto', null, null, 'teller view over the help counter down the queue line'),
  protoWindow: P([3.2, 0, 3.8, 0.65, -0.02], 'proto', null, null, 'toward the window wall'),
  // full office (§9.2 table; probes arrive with hq.ts)
  spawn: P([0, 0, 12.5, 0.22, -0.05]), // [LVL fix r2] yawed left so the whole queue is in frame (hq.ts SPAWN_YAW)
  // [LVL fix m175 r1] 0.7 m NW (was 5,0,5): the old stand was inside the atrium fern's fronds (plant6, world 5.4,3.6),
  // three leaves cut across the lower-right quarter; the fern is now 90° right of the view axis, out of frame
  // [LVL fix m2 r2] 1.5 m further back along the diagonal (plan 26.5, 20; the atrium's SE corner, the fern moved behind
  // it), the eye 0.3 m up and pitched −0.03 (was −0.15): the whole Big Board, its I NEED YOU band included, hangs below
  // the HUD pill row (it was cut at the top edge and collided with the pills; art review m2-r2 h13-1/h22-1), the top
  // quarter is the skylight and the Board instead of beams, and the Pit ring, the library, the slide, the E-bay glazing
  // and the stairs stay in frame. probes: wallLit = the lit north wall between the round print and the slide, wallShade =
  // the west wall between the prints, floor = bare near floor lower right, floorPool = the SW atrium pendant's pool on
  // the ring left of centre (day Δ −2, night Δ +12 vs floor); floorCrop = the bare floor band right of the minimap, left of
  // the stairs
  pitOverview: P([6.0, 0.3, 6.0, 0.785, -0.03], 'hq',
    { wallLit: [790, 345], wallShade: [475, 230], floor: [1300, 836], floorPool: [582, 800] },
    [210, 800, 1240, 95]),
  // [LVL fix r2] 0.2 m north: clear of the wider (1.8 m) west sofa. [LVL m3 fix r2] 0.2 m back (east, still in its camera
  // well) and 0.03 rad up: the 'E2 · #2 tinker' bay sign was cut by the frame top under the HUD pills (art review m3-r2
  // h13-2 / h22-2 / c40-2); its top edge now sits ≈ 93 px down at 1920×1080, below the 60 px HUD band
  eBayGlass: P([-2.85, 0, -1.2, 1.571, -0.02]),
  // [LVL fix m2 r2] against the west facade at the street's south end (plan 5.85, 19.7, just ahead of the last
  // lamp, its pothos basket out of frame; was the lane's middle, 6.75, 20), yawed 2.3° right onto the street's vanishing point; it stands in a camera well (hq.ts CAMERA_WELLS: walkers keep to
  // the east side, no stander in the near field)
  street: P([-14.65, 0, 5.7, -0.04, -0.05]),
  lobbyDesk: P([0.5, 0, 11, 0.73, -0.1]),
  // [BRN fix m2-r1, cross-owner LVL] 0.6 m back on the STAFF mat's rear edge: the queue head (slot:queue:0) stands 2.2 m
  // off (was 1.6 m: its face filled the frame and raised arms hid the Big Board / NOW SERVING, gameplay review m2)
  // [LVL m3 fix r2] the counter cut the head off at the eyes / mouth and filled the lower 40 % (art review m3-r2 h13-5 /
  // h22-5). The head's face is only ≈ 0.2 m behind the counter's front edge, so what shows of it depends on the lens's
  // height AND distance (not pitch): at 2.4 m even a 2.1 m eye kept the mouth on the edge. The lens leans over the
  // counter now: eye 2.1 m (feet 0.9), 0.2 m nearer (plan 16.15, 22.5, head 2.0 m off; still on the STAFF mat, so Ada
  // steps aside, ambient/ada.ts), pitched −0.32: face, mouth and raised arms clear the walnut top (a band in the
  // lower sixth), NEED YOU band of the Big Board top right
  serve: P([-4.35, 0.9, 8.5, 0, -0.32]),
  // [LVL fix m2 r1] library + lab are INSIDE views now (they framed a door jamb and an empty room from outside). library:
  // from the north aisle (plan 20.5, 0.85) due south, the readers at the tables' south seats (library:2/5, the first
  // picks from the arches) face the lens, both arches + the atrium behind them; lab: from the NE corner (plan 12.9, 24.35)
  // south-west over the round table: both benches (lab:0–3), the fume hood, the TEST light. Both stand in camera wells
  // (hq.ts CAMERA_WELLS: no walker / stander in the near field)
  library: P([0, 0, -13.15, Math.PI, -0.06]),
  lab: P([-7.6, 0, 10.35, 2.2, -0.08]),
  mezz: P([6, 2.9, -10.5, 1.571, -0.1]),
  // [LVL fix r1] 1.2 m back from the rail (the handrail sits in the top quarter, not mid-frame) and west of the Big Board,
  // so the queue (SW) and the Pit read beside the board instead of behind it. [LVL fix r2] 0.55 m east along the rail:
  // the camera sits between two rail posts (x19.1 / 20.25), both outside the frame's centre third
  // [LVL fix r3] the rail dropped to 0.8 m: standing back 1.2 m now put the cap across the queue, so the camera steps up
  // to the rail (0.55 m, as close as the player's 0.28 m circle gets on the 0.25 m grid) and pitches −0.32: the cap falls below the frame, the Board stays in it
  // [LVL fix m2 r1] the cap still banded the lower fifth (0.55 m from the rail it sat 37° down, the frame's bottom at 48°).
  // Rails now rasterize without the half-cell slack, so the player leans on the glass (0.32 m): the cap is 51° down, and
  // facing due south (yaw π: the rail runs parallel to the image plane, no corner creeps up) it is below the frame at
  // every aspect (layout.test 'mezzToPit pose')
  mezzToPit: P([-0.65, 2.9, -7.32, Math.PI, -0.32]),
  engine: P([9, 0.25, 1.5, -1.571, 0]),
  // [ENV fix m2 r1, cross-owner LVL] yaw −0.968 → −1.2: the espresso bar (the café's signature, with its steam) sat on the
  // frame's right edge (review m2 r1); 13° right keeps the tables and the booth in view and puts the bar + coffee slots in frame
  cafe: P([9.5, 0, 12.5, -1.2, -0.05]),
  plan: P([0, 32, 0, 0, -1.5707]),
});

export const getPose = (name: string): PoseDef | null => POSES[name] ?? null;
/** Pose names valid for a layout. */
export const posesFor = (layoutId: string): string[] => Object.keys(POSES).filter((k) => POSES[k]?.layout === layoutId || k === 'plan');
