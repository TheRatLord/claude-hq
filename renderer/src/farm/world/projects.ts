// @pure
/**
 * Where the Valley Projects stand (model/projects.ts is the board's logic, scene/projects draws them,
 * docs/valley/projects.md). Plain data only: world/map.ts reads it to keep scatter off the footprints
 * (`clearance`) and to level a terrace under the ones that want it (`pad`); it must not import map.ts back.
 *
 * Frames: a site's local +z is its front (`yaw` as everywhere: the front faces (sin yaw, cos yaw)).
 *   board        the Mayor's projects board on the square's west edge, beside the noticeboard (front: the square)
 *   footbridge   local z runs across the river (−z = the east bank, +z = the west bank); deck from z −L/2 to +L/2
 *   glasshouse   long side along local x, door at +z (toward the square)
 *   millwheel    the mill house; +z faces the river, the wheel turns on an axle along z just off the bank
 *   observatory  a round tower with a dome, door at +z (toward the square)
 *   halt         the platform along local x, the track behind it (−z), the waiting side at +z (toward the valley)
 * The lantern path has no site of its own: its posts follow the stones' footpath (scene/projects reads PATHS).
 */

export type ProjectSiteId = 'board' | 'footbridge' | 'glasshouse' | 'millwheel' | 'observatory' | 'halt';

export interface ProjectSite {
  id: ProjectSiteId;
  x: number;
  z: number;
  yaw: number;
  /** footprint width (local x) × depth (local z), kept clear of scatter */
  size: readonly [number, number];
  /** level a terrace under it (blend metres), or none (on the square, over water) */
  pad: number | null;
  /** an extra forecourt in front (metres along +z) kept clear of trees and rocks, so the place can be seen */
  front?: number;
}

const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
const HUB = { x: 0, z: -2 };

/** the footbridge: across the river south of the big bridge (centreline from (-55, 52) to (-64, 76)), clear of the boulders */
const FB = { x: -56.5, z: 56 };
/** across the flow: the river runs (-9, 24) here, so across is (24, 9) */
const FB_YAW = Math.atan2(-24, -9);

/** the mill on the east bank north of the hot spring (river (-43, -67) → (-51, -43)); its front looks back at the water */
const MILL = { x: -38.6, z: -42.4 };
const MILL_YAW = Math.atan2(-24, -8);

const SITE_LIST: ProjectSite[] = [
  { id: 'board', x: -12.9, z: 5.75, yaw: face(-12.9, 5.75, 0, -1), size: [2.8, 1.0], pad: null },
  { id: 'footbridge', x: FB.x, z: FB.z, yaw: FB_YAW, size: [2.6, 17.5], pad: null },
  { id: 'glasshouse', x: 31.5, z: -32, yaw: face(31.5, -32, HUB.x, HUB.z), size: [8.4, 5.6], pad: 4, front: 4 },
  { id: 'millwheel', x: MILL.x, z: MILL.z, yaw: MILL_YAW, size: [5.4, 5.0], pad: 2.2 },
  { id: 'observatory', x: 22, z: -80, yaw: face(22, -80, HUB.x, HUB.z), size: [7.2, 7.2], pad: 4, front: 9 },
  { id: 'halt', x: -17, z: 78.5, yaw: face(-17, 78.5, HUB.x, HUB.z), size: [20, 10], pad: 4, front: 6 },
];
export const PROJECT_SITES: readonly ProjectSite[] = Object.freeze(SITE_LIST.map((s) => Object.freeze(s)));

/** the rectangles world/map.ts keeps clear of scatter (`clearance`): each footprint plus its forecourt */
export const PROJECT_CLEAR: readonly { x: number; z: number; hw: number; hd: number; yaw: number }[] = PROJECT_SITES.map((s) => {
  const f = s.front ?? 0, c = siteLocal(s, 0, f / 2);
  return { x: c.x, z: c.z, hw: s.size[0] / 2, hd: s.size[1] / 2 + f / 2, yaw: s.yaw };
});

export const projectSite = (id: ProjectSiteId): ProjectSite => PROJECT_SITES.find((s) => s.id === id)!;

/** world position of a site-local point (lx along width, lz along depth; +lz is the front) */
export function siteLocal(s: Pick<ProjectSite, 'x' | 'z' | 'yaw'>, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return { x: s.x + lx * c + lz * sn, z: s.z - lx * sn + lz * c };
}
