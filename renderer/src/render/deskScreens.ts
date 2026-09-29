/**
 * Desk monitors as an honest status cue (§6.7 "one visual = one meaning"): each desk's screen shows its owner's
 * state instead of always scrolling code.
 *   code (working, busy shell) · saver (idle: dim drifting clay blob) · done (dim saver + green check) ·
 *   blocked (deep-red screen, pulsing "!") · prompt (shell at its prompt: `>_` cursor) · off (no owner: dark glass)
 * The desk-monitor InstancedMesh (world build) registers its per-instance desk anchors; actors.ts reports each actor's
 * home desk every frame. Screens whose desk nobody reported for 0.75 s fall back to `off`.
 * The mode rides in instanceColor (screen.ts decodes `r ≥ 2` as mode·2 + strip red), so no new attribute, program or
 * draw call: one InstancedMesh, one upload of the colour buffer when a desk changes state.
 * M3.5 (RND): `live` (mode 6) = the desk shows its tile of the monitor atlas (monitorAtlas.ts; g = strip.g + 2·tile);
 * a tally LED on each monitor's back (one extra instanced draw, same 'screen' program: blue pulse working, red blink
 * blocked, green done, off idle); monitor spill (uSpill* arrays in the toon program: the 8 nearest lit screens tint
 * the face / desk in front of them); `screenRect(deskId)` → the screen's world corners (PLY dive, UI drawer origin).
 * Owner: RND.
 */
import * as THREE from 'three';
import { STATUS, CORE, type Rgb } from '../../../shared/palette.ts';
import { hqStatSection } from '../core/debug.ts';
import { getMaterial } from './materials/index.ts';
import { U, MAX_SPILL } from './uniforms.ts';

/** Screen modes (shader ids, screen.ts). */
export const SCREEN_MODE = Object.freeze({ code: 0, saver: 1, done: 2, blocked: 3, prompt: 4, off: 5 });
/** Shader id of a live atlas tile (screen.ts; the procedural mode keeps driving the strip colour, tally and spill). */
export const LIVE_MODE = 6;
/** Tally LED states (screen.ts uCode 2): 0 off (idle / saver / shell prompt), 1 working (blue pulse), 2 blocked (red blink), 3 done (green). */
export const TALLY = Object.freeze({ off: 0, working: 1, blocked: 2, done: 3 });
export type ScreenMode = keyof typeof SCREEN_MODE;
type TallyState = keyof typeof TALLY;
const TALLY_OF: Record<ScreenMode, TallyState> = { code: 'working', blocked: 'blocked', done: 'done', saver: 'off', prompt: 'off', off: 'off' };
/** Tally state of a desk's mode ('' = never written: off). */
const tallyOf = (mode: ScreenMode | ''): TallyState => (mode ? TALLY_OF[mode] : undefined) ?? 'off';
const TALLY_COL: Record<TallyState, string> = { off: '#101216', working: STATUS.working, blocked: STATUS.blocked, done: STATUS.done };
const STRIP: Record<ScreenMode, string> = { code: STATUS.working, saver: STATUS.idle, done: STATUS.done, blocked: STATUS.blocked, prompt: STATUS.shell, off: CORE.ink2 };

/**
 * @pure Screen mode for a desk owner. `lamp` is the brain's intent.lamp (wins when set).
 */
export function screenModeFor(entity: { status?: string; kind?: string } | null, lamp?: 'off' | 'work' | 'blocked' | null): ScreenMode {
  if (!entity) return 'off';
  if (lamp === 'blocked' || entity.status === 'blocked') return 'blocked';
  if (lamp === 'work' || (lamp == null && entity.status === 'working')) return 'code';
  if (entity.kind === 'shell') return 'prompt';
  return entity.status === 'done' ? 'done' : 'saver';
}

/**
 * @pure instanceColor encoding for a mode (screen.ts decodes it). With `tile ≥ 0` the desk shows atlas tile `tile`
 * (mode 6, g = strip.g + 2·tile); the strip colour still follows the procedural mode. Returns linear rgb.
 */
export function encodeScreen(mode: ScreenMode, tile = -1): Rgb {
  const c = new THREE.Color(STRIP[mode]);
  if (tile >= 0) return [c.r + 2 * LIVE_MODE, c.g + 2 * tile, c.b];
  return [c.r + 2 * SCREEN_MODE[mode], c.g, c.b];
}

/** @pure Tally LED encoding (r = colour.r + 2·state). */
export function encodeTally(mode: ScreenMode): Rgb {
  const k = TALLY_OF[mode] ?? 'off';
  const c = new THREE.Color(TALLY_COL[k]);
  return [c.r + 2 * TALLY[k], c.g, c.b];
}

const HOLD_MS = 750;
export interface Desk {
  mesh: THREE.InstancedMesh;
  index: number;
  /** procedural mode (the status cue; also drives strip, tally, spill); '' until first written */
  mode: ScreenMode | '';
  /** last report (performance.now) */
  seen: number;
  /** owner entity id (last report) */
  id: string | null;
  /** owner seated at the desk (last report) */
  seated: boolean;
  /** atlas tile shown (-1 = procedural) */
  tile: number;
  /** when `mode` last changed (done flash) */
  modeAt: number;
  /** screen centre (world) */
  pos: THREE.Vector3 | null;
  /** screen front normal (world) */
  normal: THREE.Vector3 | null;
  /** [tl, tr, br, bl] (world) */
  corners: THREE.Vector3[] | null;
  /** {mesh, index} of the tally LED */
  tally: { mesh: THREE.InstancedMesh; index: number } | null;
  /** `pos` / `normal` are a real placement (see placeDesk) */
  placed: boolean;
  /** spill sort key: squared distance to the camera */
  sk: number;
}
/** A desk whose screen has been placed in the world. */
export type PlacedDesk = Desk & { pos: THREE.Vector3; normal: THREE.Vector3; corners: THREE.Vector3[] };
const desks = new Map<string, Desk>();
const tmpC = new THREE.Color();

const paint = (d: Desk): void => {
  const [r, g, b] = encodeScreen(d.mode || 'off', d.tile);
  d.mesh.setColorAt(d.index, tmpC.setRGB(r, g, b));
  if (d.mesh.instanceColor) d.mesh.instanceColor.needsUpdate = true; // (setColorAt just created it)
  if (d.tally) {
    const [tr, tg, tb] = encodeTally(d.mode || 'off');
    d.tally.mesh.setColorAt(d.tally.index, tmpC.setRGB(tr, tg, tb));
    if (d.tally.mesh.instanceColor) d.tally.mesh.instanceColor.needsUpdate = true;
  }
};
const write = (d: Desk, mode: ScreenMode): void => {
  if (d.mode === mode) return;
  d.mode = mode;
  d.modeAt = performance.now();
  paint(d);
};

/**
 * Tally LED: a flattened bead on the top-back edge of the bezel (screen-local: +x right, +y up, +z out of the glass),
 * so it reads from behind the monitor (its back) and peeks over the bezel from the front.
 */
const TALLY_LOCAL = new THREE.Matrix4().compose(new THREE.Vector3(0.14, 0.098, -0.034), new THREE.Quaternion(), new THREE.Vector3(1.25, 0.8, 1));
const TALLY_R = 0.019;

/**
 * Register the desk monitors (world build). `anchors[i]` is the desk anchor id of instance i (null = no desk).
 */
export function registerDeskScreens(mesh: THREE.InstancedMesh, anchors: readonly (string | null)[]): void {
  const now = performance.now();
  // tally LEDs: one InstancedMesh child of the screens (one extra draw), same 'screen' program (uCode 2 = LED path)
  const n = anchors.filter(Boolean).length;
  let tally: THREE.InstancedMesh | null = null;
  if (n && typeof mesh.add === 'function') {
    const geo = new THREE.SphereGeometry(TALLY_R, 8, 5);
    tally = new THREE.InstancedMesh(geo, getMaterial('screen', { color: '#FFFFFF', emissive: 1, code: 2, strip: null, instanced: true, uniforms: {} }), n);
    tally.name = 'rnd:tally';
    tally.setColorAt(0, tmpC.setRGB(1, 1, 1));
    tally.frustumCulled = false; // spans every bay; 36 × 50 tris
    mesh.add(tally);
  }
  const m = new THREE.Matrix4();
  let ti = 0;
  anchors.forEach((a, index) => {
    if (!a) return;
    const d: Desk = { mesh, index, mode: '', seen: now - HOLD_MS, id: null, seated: false, tile: -1, modeAt: now, pos: null, normal: null, corners: null, tally: null, placed: false, sk: 0 };
    if (tally) {
      mesh.getMatrixAt(index, m);
      tally.setMatrixAt(ti, m.multiply(TALLY_LOCAL));
      d.tally = { mesh: tally, index: ti++ };
    }
    desks.set(a, d);
    write(d, 'off');
  });
  if (tally) tally.instanceMatrix.needsUpdate = true;
  // age out desks nobody reported (the owner left, moved desks or is gone) once per rendered frame
  mesh.onBeforeRender = () => {
    const t = performance.now();
    for (const d of desks.values()) if (d.mesh === mesh && t - d.seen > HOLD_MS) write(d, 'off');
  };
}

/**
 * Report a desk owner's state (actors.ts, per frame; cheap: writes only on change). `anchor` is the desk anchor id (the
 * home slot's `anchor`).
 */
export function setDeskScreen(anchor: string | null | undefined, mode: ScreenMode, id: string | null = null, seated = false): void {
  const d = anchor ? desks.get(anchor) : null;
  if (!d) return;
  d.seen = performance.now();
  d.id = id;
  d.seated = !!seated;
  write(d, mode);
}

/** Owner still reporting (the actor is alive and this is its home desk). */
export const deskOwned = (d: Desk): boolean => !!d.id && performance.now() - d.seen <= HOLD_MS && d.mode !== 'off';

/** World placement of a desk's screen (lazy: the world build adds the mesh to the scene after registering it). */
function placeDesk(d: Desk): PlacedDesk {
  // [UI fix r1, cross-owner RND] cache only a real placement: the W-bay desks were read before their instance matrices
  // were written (all zero → pos (0,0,0)), cached forever, so their screens never went live (walk-up review check)
  if (d.pos && d.normal && d.corners && d.placed) return Object.assign(d, { pos: d.pos, normal: d.normal, corners: d.corners });
  // Plane / Box geometries keep their construction parameters; three's typings do not declare them
  const geo = (d.mesh.geometry as THREE.BufferGeometry & { parameters?: { width: number; height: number } })?.parameters ?? { width: 0.37, height: 0.155 };
  d.mesh.updateWorldMatrix(true, false);
  d.mesh.getMatrixAt(d.index, tmpM);
  tmpM.premultiply(d.mesh.matrixWorld);
  const hw = geo.width / 2, hh = geo.height / 2;
  const pos = new THREE.Vector3().setFromMatrixPosition(tmpM);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(tmpM);
  const corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(tmpM));
  d.placed = pos.lengthSq() > 1e-8 && normal.lengthSq() > 0.5;
  return Object.assign(d, { pos, normal, corners });
}

/** Every registered desk (monitorAtlas.ts), placed in the world. */
export function* deskEntries(): IterableIterator<[string, PlacedDesk]> {
  for (const e of desks) yield [e[0], placeDesk(e[1])];
}

/**
 * Show atlas tile `tile` on a desk (-1 = back to the procedural mode). monitorAtlas.ts only.
 */
export function setDeskTile(anchor: string, tile: number): void {
  const d = desks.get(anchor);
  if (!d || d.tile === tile) return;
  d.tile = tile;
  paint(d);
}

export interface ScreenRect { corners: THREE.Vector3[]; center: THREE.Vector3; normal: THREE.Vector3; width: number; height: number }

/**
 * The world rectangle of a desk's screen (M3.5: PLY monitor dive, UI drawer-open origin). `deskId` is the desk anchor id
 * (e.g. 'desk:E2:1'; director.slotFor(id).anchor); corners = [top-left, top-right, bottom-right, bottom-left] as seen
 * from the front; normal points out of the glass.
 */
export function screenRect(deskId: string): ScreenRect | null {
  const d = desks.get(deskId);
  if (!d) return null;
  const { corners: c, pos, normal } = placeDesk(d);
  return { corners: c.map((v) => v.clone()), center: pos.clone(), normal: normal.clone(), width: c[0].distanceTo(c[1]), height: c[1].distanceTo(c[2]) };
}
/**
 * Tally LED positions (probe.ts `__hqRender.tallyCheck`): world centre + the state it should show.
 */
export function tallyPoints(): { desk: string; mode: ScreenMode | ''; state: string; pos: THREE.Vector3; back: THREE.Vector3 }[] {
  const out: ReturnType<typeof tallyPoints> = [];
  const m = new THREE.Matrix4();
  for (const [a, d] of desks) {
    if (!d.tally) continue;
    const { normal } = placeDesk(d);
    d.tally.mesh.updateWorldMatrix(true, false);
    d.tally.mesh.getMatrixAt(d.tally.index, m);
    m.premultiply(d.tally.mesh.matrixWorld);
    out.push({ desk: a, mode: d.mode, state: tallyOf(d.mode), pos: new THREE.Vector3().setFromMatrixPosition(m), back: normal.clone().negate() });
  }
  return out;
}

/** Desk id → screen rect for an entity's home desk, when it has one (a convenience for UI / PLY). */
export function screenRectFor(entityId: string): ScreenRect | null {
  for (const [a, d] of desks) if (d.id === entityId && performance.now() - d.seen <= HOLD_MS) return screenRect(a);
  return null;
}

/**
 * Monitor spill (M3.5): the MAX_SPILL nearest owned screens light the face and desk in front of them (toon.ts
 * uSpill* arrays, characters + props only): working = cool code light, blocked = red pulse, done = a green flash that
 * settles, shell prompt = faint green, idle saver = faint warm. Night-weighted (a lit screen in a dark room), a hint
 * by day. Writes the uniforms; the arrays live in uniforms.ts (no new program variant).
 */
const SPILL: Record<string, readonly [hex: string, weight: number]> = { code: ['#9CC0FF', 1], blocked: ['#FF4A3A', 1.25], done: ['#7CF29A', 0.35], prompt: ['#A2E6BE', 0.45], saver: ['#FFB795', 0.2] };
const SPILL_RGB: Readonly<Record<string, Rgb | undefined>> = Object.fromEntries(Object.entries(SPILL).map(([k, [hex, w]]): [string, Rgb] => { const c = new THREE.Color(hex); return [k, [c.r * w, c.g * w, c.b * w]]; }));
const SPILL_DAY = 0.07, SPILL_NIGHT = 0.42, SPILL_R = 1.0, DONE_FLASH_MS = 1600;
const spillPick: PlacedDesk[] = [];
/** `time` in seconds. */
export function updateSpill(cam: THREE.Vector3, time: number): void {
  spillPick.length = 0;
  const now = performance.now();
  for (const d of desks.values()) {
    if (!deskOwned(d) || !SPILL_RGB[d.mode]) continue;
    const p = placeDesk(d);
    p.sk = p.pos.distanceToSquared(cam);
    spillPick.push(p);
  }
  spillPick.sort((a, b) => a.sk - b.sk);
  const n = Math.min(MAX_SPILL, spillPick.length);
  const k = SPILL_DAY + (SPILL_NIGHT - SPILL_DAY) * (U.uNight.value ?? 0);
  for (let i = 0; i < MAX_SPILL; i++) {
    const P = U.uSpillPos.value[i], N = U.uSpillN.value[i], C = U.uSpillCol.value[i];
    if (i >= n) { P.w = 0; C.setRGB(0, 0, 0); continue; }
    const d = spillPick[i];
    let g = k;
    if (d.mode === 'blocked') g *= 0.55 + 0.45 * Math.sin(time * 6);
    else if (d.mode === 'done') g *= 1 + 3 * Math.max(0, 1 - (now - d.modeAt) / DONE_FLASH_MS);
    const rgb = SPILL_RGB[d.mode] ?? [0, 0, 0]; // (only modes with a spill colour were picked)
    P.set(d.pos.x, d.pos.y, d.pos.z, SPILL_R);
    N.set(d.normal.x, d.normal.y, d.normal.z, 0);
    C.setRGB(rgb[0] * g, rgb[1] * g, rgb[2] * g);
  }
  U.uSpillCount.value = n;
}

/**
 * Screen light (M1 fix r2): each lit monitor casts its colour onto the desk, keyboard and the face in front of it
 * after dark. Monitors are grouped into clusters (a pod of desks), one lamp pool each (lamps.ts adds them to the
 * ≤ 12 pools, night-weighted), so a pod of working screens washes its desks in cool code-light and a blocked desk
 * tints its pod red. [colour, weight] per mode; weights are relative light output.
 */
const GLOW: Record<ScreenMode, readonly [hex: string | null, weight: number]> = { code: ['#A9C6FF', 1], prompt: ['#A2E6BE', 0.7], blocked: ['#FF6450', 1.3], saver: ['#FFB795', 0.35], done: ['#BDEFC4', 0.35], off: [null, 0] };
const GLOW_RGB: Readonly<Record<string, Rgb>> = Object.fromEntries(Object.entries(GLOW).map(([k, [hex, w]]): [string, Rgb] => {
  if (!hex) return [k, [0, 0, 0]];
  const c = new THREE.Color(hex); // linear
  const m = Math.max(c.r, c.g, c.b);
  return [k, [c.r / m * w, c.g / m * w, c.b / m * w]];
}));
const CLUSTER_R = 2.4; // m (plan): desks closer than this to a cluster's running centre share its pool (a pod of 4 ≈ 1.7 × 1 m)
/** A screen-light cluster: a pod of desks sharing one lamp pool. */
export interface ScreenGlow { pos: THREE.Vector3; rgb: Rgb }
interface Cluster extends ScreenGlow { sum: THREE.Vector3; members: Desk[] }
let clusters: Cluster[] = [];
let clusteredN = -1;
const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3();

function recluster() {
  clusters = [];
  for (const d of desks.values()) {
    d.mesh.updateWorldMatrix(true, false);
    d.mesh.getMatrixAt(d.index, tmpM);
    tmpP.setFromMatrixPosition(tmpM.premultiply(d.mesh.matrixWorld));
    let c = clusters.find((k) => Math.hypot(k.pos.x - tmpP.x, k.pos.z - tmpP.z) < CLUSTER_R);
    if (!c) clusters.push(c = { pos: new THREE.Vector3(), sum: new THREE.Vector3(), members: [], rgb: [0, 0, 0] });
    c.members.push(d); c.sum.add(tmpP);
    c.pos.copy(c.sum).divideScalar(c.members.length);
  }
  clusteredN = desks.size;
}

/**
 * Current screen-light clusters: world centre (monitor height) and the mean light colour × weight of its screens.

 */
export function screenGlows(): readonly ScreenGlow[] {
  if (desks.size !== clusteredN) recluster();
  for (const c of clusters) {
    c.rgb[0] = c.rgb[1] = c.rgb[2] = 0;
    for (const d of c.members) { const g = GLOW_RGB[d.mode] ?? GLOW_RGB.off; c.rgb[0] += g[0]; c.rgb[1] += g[1]; c.rgb[2] += g[2]; }
    for (let i = 0; i < 3; i++) c.rgb[i] /= c.members.length;
  }
  return clusters;
}

/** Debug: current procedural mode per desk anchor (also `__hq.stats().render.monitorAtlas.modes`). */
export const deskScreenModes = (): Record<string, ScreenMode | ''> => Object.fromEntries([...desks].map(([a, d]) => [a, d.mode]));
/** `__hq.stats().screens`: {deskId: 'live'|'proc'} (M3.5). */
export const deskScreenLive = (): Record<string, 'live' | 'proc'> => Object.fromEntries([...desks].map(([a, d]) => [a, d.tile >= 0 ? 'live' : 'proc']));
hqStatSection('screens', deskScreenLive);
