/**
 * Lamp pools (§5.6): every lamp anchor in the layout `{pos, radius, color, gain}` lights its surroundings inside the
 * existing toon programs (uLampPos/uLampCol, ≤ 12). The 12 pools nearest the camera's vis cell are active; set
 * changes cross-fade over 0.4 s (per-pool gain ramps), so rooms never pop. Phase scale (day 15% / golden 40% /
 * night 100%) is applied in the shader via uGain.w. Night summed pool gain is capped at 0.30 (§5.0).
 * Pendants and desk lamps are shaded downlights (negative radius in uLampPos.w: nothing above the shade is lit).
 * Screen light (M1 fix r2): each desk cluster's monitors form one extra night-only pool coloured by their modes
 * (deskScreens.screenGlows); real lamps always win the slots. At night lamp colours shift warmer (rgb^LAMP_NIGHT_WARMTH).
 * Point lights (≤ 2, the red blocked desk lamp / beacon) arrive with BRN/FX in M2; unused they sit at 0.
 * Owner: RND.
 */
import type * as THREE from 'three';
import { U, MAX_LAMPS } from './uniforms.ts';
import { lin, norm, LAMP_CAP, LAMP_SCALE, LAMP_NIGHT_WARMTH, POOL_RADIUS, phaseWeightsInto } from './lightMath.ts';
import { screenGlows, type ScreenGlow } from './deskScreens.ts';
import type { Rgb } from '../../../shared/palette.ts';
import type { Layout, LampKind, Vec3 } from '../world/layout/schema.ts';

/** Shaded lamps light only below their shade (no hot ceiling above a pendant): encoded as a negative radius. */
const DOWNLIGHT = new Set(['pendant', 'desk', 'fixture', 'string']);   // street lanterns are glass: they light the dark street ceiling too
/**
 * Pool encoding (toon.ts): |w| = reach + 100 × pool radius in decimetres (reach < 100 m; 0 = wash only, screen glows)
 * + 10000 for an open flame (the hearth: full-strength wash, no shade) + 20000 for a task lamp (RND fix r3: its pool
 * may run past POOL_MAX up to POOL_TASK_MAX where it dominates, toon.ts).
 * `pool` is the pool radius in metres.
 */
export const poolCode = (reach: number, pool: number, omni = false, task = false): number => Math.min(reach, 99.9) + 100 * Math.min(99, Math.round(pool * 10)) + (omni ? 10000 : 0) + (task ? 20000 : 0);
/**
 * The Pit hearth (fix r1): reach ×1.8 so its warm wash reaches the sofas that face it (authored 2.4 m ended at the
 * sofa fronts) and a ±6 % 3 Hz flicker (two detuned sines, §11.5 ENV idea); its pool is the warm disk on the rug.
 */
const HEARTH_REACH = 1.8;
/**
 * The hearth is an open fire in the middle of dark sage sofas and a teal rug, which absorb orange light: at the §5.0
 * per-lamp cap its pool did not read at all. It runs at 2.5× the cap (fix r1; lumaStats max ≤ 0.95 on the hearth stones): the Pit's only other pools are the
 * pendants' outer rims, and every surface it reaches has albedo ≤ 0.45, so the lit shoulder keeps it under bloom.
 */
const HEARTH_BOOST = 2.5;
/**
 * Task lamps (kind 'desk': the Library's banker's lamps, the proto desk lamps). RND fix r2 (art review: "banker lamps
 * are flat yellow slabs with no pool on the green desks"): a task lamp lights the desk it stands on, not the room. Its
 * reach is capped at DESK_REACH, so the pool ends on the table top (the floor under the table no longer takes the warm
 * disk) and the wash stays within arm's length; within that small disk it runs DESK_BOOST × the per-lamp cap, since
 * the surfaces it lands on (green leather insets, walnut) have albedo ≤ 0.2 and a cap-level pool read as olive murk.
 * POOL_MAX still clamps the summed pool light per pixel and the fragment shoulder keeps pale paper under bloom.
 *
 * RND fix r3 (art review: "library hero at 22 h is murky, no warm pool on the reading tables or the rug"): the 0.8 m
 * reach and the 0.55 m disk ended ≈ 0.3 m short of the tables' front edge and inner ends in the hero frame. The pool now
 * covers the whole 1.8 × 0.8 table top (DESK_POOL 1.1 m + the cone ≈ 1.25 m at the top) and spills a soft warm rim onto
 * the runner rug around it (reach 1.3 m keeps the disk alive down to the floor). A desk lamp is a task lamp (poolCode
 * flag): where its pool dominates, the per-pixel cap rises from POOL_MAX to POOL_TASK_MAX, so at DESK_BOOST 3.0 the
 * warm pool out-shines the studio key on the green leather (at POOL_MAX it tied with it and read olive). Pale paper
 * under it is held by POOL_ALB_MAX (toon.ts), so the pool warms the leather, not a white slab.
 */
const DESK_REACH = 1.3, DESK_BOOST = 3.0, DESK_POOL = 1.1;
/** Screen-light pools (deskScreens.ts clusters): night only, gain at full night for a pod of working screens. */
const SCREEN_GAIN = 0.5, SCREEN_RADIUS = 1.9, SCREEN_LIFT = 0.12;

/** Layout lamp kinds plus the pools adopted at runtime (baked fixtures, string-light runs, desk-screen glows). */
export type PoolKind = LampKind | 'fixture' | 'string' | 'screen';

/** A pool anchor: the layout's `LampAnchor` shape, plus the runtime kinds and an optional pool disk radius. */
export interface PoolAnchor {
  id: string;
  kind: PoolKind;
  /** the pool centre (usually the bulb) */
  pos: Vec3;
  /** metres */
  radius: number;
  /** hex */
  color: string;
  /** ≤ 0.30 */
  gain: number;
  /** pool disk radius (m); default by kind */
  pool?: number;
}

/** One live pool: the anchor plus its slot / fade state. */
interface Lamp {
  id: string;
  kind: PoolKind;
  pos: Vec3;
  radius: number;
  color?: string;
  rgb: Rgb;
  rgbNight?: Rgb;
  gain: number;
  /** current ramped gain */
  cur: number;
  /** uniform slot, -1 = none */
  slot: number;
  want: boolean;
  sk: number;
  down: boolean;
  pool: number;
}

const POOL_BY_KIND: Readonly<Record<string, number | undefined>> = POOL_RADIUS;
const bySortKey = (a: Lamp, b: Lamp) => a.sk - b.sk;

/**
 * Fixture pools (m2 fix r3, night interiors had no warm pools): many glowing fixtures the zones dress (café bar
 * pendants, wall sconces, bay pendants, the street's string lights) have no layout lamp anchor, so they glowed as
 * emissive shades over an evenly lit room. At boot the baked glow classes (`kit:*:shade` = lamp shades,
 * `kit:*:bulb` = bare bulbs) are clustered into fixtures, and every fixture without a layout anchor within
 * FIXTURE_NEAR becomes a pool anchor of its own: shades as downlights under the shade, ceiling bulb runs (string-light
 * spans, festoons ≥ FIXTURE_BULB_Y) as one soft pool under the run's centre, sized to the run. No new draws, no new
 * lights: they compete for the same 12 pool slots (§5.6).
 */
const FIXTURE_NEAR = 1.1, FIXTURE_BULB_Y = 2.0, FIXTURE_MAX = 64, BULB_RUN = 3.2;
/**
 * Group points into fixtures: occupied grid cells (size `cell`) joined through their 26 neighbours (union-find).
 * Pure (lamps.test.ts).
 */
export function clusterPoints(xyz: ArrayLike<number>, cell: number): { min: number[]; max: number[]; n: number }[] {
  interface Cell { i: number; j: number; k: number; min: number[]; max: number[]; n: number; /** union-find parent (itself for a root) */ p: Cell | null }
  const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
  const cells = new Map<string, Cell>();
  for (let v = 0; v < xyz.length; v += 3) {
    const x = xyz[v], y = xyz[v + 1], z = xyz[v + 2];
    const i = Math.floor(x / cell), j = Math.floor(y / cell), k = Math.floor(z / cell), kk = key(i, j, k);
    let c = cells.get(kk);
    if (!c) { c = { i, j, k, min: [x, y, z], max: [x, y, z], n: 0, p: null }; c.p = c; cells.set(kk, c); }
    c.n++;
    if (x < c.min[0]) c.min[0] = x; if (y < c.min[1]) c.min[1] = y; if (z < c.min[2]) c.min[2] = z;
    if (x > c.max[0]) c.max[0] = x; if (y > c.max[1]) c.max[1] = y; if (z > c.max[2]) c.max[2] = z;
  }
  const root = (c: Cell): Cell => { for (;;) { const p = c.p; if (!p || p === c) return c; c.p = p.p; c = c.p ?? p; } };
  for (const c of cells.values()) {
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      const o = cells.get(key(c.i + di, c.j + dj, c.k + dk));
      if (o) { const a = root(c), b = root(o); if (a !== b) b.p = a; }
    }
  }
  const out = new Map<Cell, { min: number[]; max: number[]; n: number }>();
  for (const c of cells.values()) {
    const r = root(c);
    let g = out.get(r);
    if (!g) { g = { min: [...c.min], max: [...c.max], n: 0 }; out.set(r, g); }
    g.n += c.n;
    for (let a = 0; a < 3; a++) { g.min[a] = Math.min(g.min[a], c.min[a]); g.max[a] = Math.max(g.max[a], c.max[a]); }
  }
  return [...out.values()];
}

/**
 * Pool anchors for the scene's unanchored glow fixtures (see above). Pure given the positions (lamps.test.ts).
 * Heights are taken above the local floor (`floorAt`, the mezzanine is 2.9 m up):
 *  - a shade whose bottom is ≥ 1.4 m up is a pendant / sconce / floor-lamp head: a downlight under the shade;
 *  - a shade lower than that (desk / table lamps) lights the desk around it from just above the shade;
 *  - bare bulbs 2.0–3.6 m up are string lights: bulbs are chunked into runs of ≤ BULB_RUN m, one soft pool per run
 *    of ≥ 3 bulbs (lone bulbs, the mezzanine's star ceiling and LEDs are not lamps).
 * `sets` = world-space vertex positions per glow class; `anchored` = the layout's lamps; `skipBulb` = bulbs that are not
 * lamps (the mezzanine's star ceiling).
 */
export function fixtureAnchors(sets: readonly GlowSet[], anchored: readonly { pos: Vec3 }[], floorY: (x: number, z: number, y: number) => number = () => 0, skipBulb: (x: number, y: number, z: number) => boolean = () => false): PoolAnchor[] {
  const out: PoolAnchor[] = [];
  const near = (x: number, y: number, z: number) => anchored.some((l) => Math.hypot(l.pos.x - x, l.pos.z - z) < FIXTURE_NEAR && Math.abs(l.pos.y - y) < 1.4)
    || out.some((l) => Math.hypot(l.pos.x - x, l.pos.z - z) < FIXTURE_NEAR * 0.8 && Math.abs(l.pos.y - y) < 1.0);
  for (const { cls, xyz } of sets) {
    if (cls === 'shade') {
      const groups = clusterPoints(xyz, 0.3).sort((a, b) => b.n - a.n);
      for (const g of groups) {
        if (out.length >= FIXTURE_MAX) break;
        const cx = (g.min[0] + g.max[0]) / 2, cz = (g.min[2] + g.max[2]) / 2, span = Math.hypot(g.max[0] - g.min[0], g.max[2] - g.min[2]);
        const fy = floorY(cx, cz, g.max[1]), lo = g.min[1] - fy;
        if (lo < 0.45 || span > 2.2) continue;                         // not a lamp shade (a glowing strip / floor part)
        const desk = lo < 1.4;
        const y = desk ? g.max[1] + 0.12 : g.min[1];
        if (near(cx, y, cz)) continue;
        out.push(desk
          ? { id: `fixture:desk:${out.length}`, kind: 'fixture', pos: { x: cx, y, z: cz }, radius: 2.0, color: '#FFD4A0', gain: 0.22, pool: 0.5 }
          : { id: `fixture:shade:${out.length}`, kind: 'fixture', pos: { x: cx, y, z: cz }, radius: 3.2, color: '#FFD4A0', gain: 0.24, pool: 0.9 });
      }
    } else {
      // one point per bulb (fine cells keep neighbouring bulbs apart), then greedy runs
      const bulbs = clusterPoints(xyz, 0.12).map((g) => ({ x: (g.min[0] + g.max[0]) / 2, y: g.min[1], z: (g.min[2] + g.max[2]) / 2 }))
        .filter((b) => { const h = b.y - floorY(b.x, b.z, b.y); return h >= FIXTURE_BULB_Y && h <= 3.6 && !skipBulb(b.x, b.y, b.z); })
        .sort((a, b) => a.z - b.z || a.x - b.x);
      const runs: { sx: number; sy: number; sz: number; pts: Vec3[] }[] = [];
      for (const b of bulbs) {
        let r = runs.find((q) => Math.hypot(q.sx - b.x, q.sz - b.z) < BULB_RUN / 2 && Math.abs(q.sy - b.y) < 0.8);
        if (!r) runs.push(r = { sx: b.x, sy: b.y, sz: b.z, pts: [] });
        r.pts.push(b);
      }
      for (const r of runs) {
        if (r.pts.length < 3 || out.length >= FIXTURE_MAX) continue;
        let x = 0, y = Infinity, z = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const p of r.pts) { x += p.x; z += p.z; y = Math.min(y, p.y); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
        x /= r.pts.length; z /= r.pts.length;
        const span = Math.hypot(x1 - x0, z1 - z0);
        if (near(x, y - 0.1, z)) continue;
        out.push({ id: `fixture:string:${out.length}`, kind: 'string', pos: { x, y: y - 0.1, z }, radius: 3.4, color: '#FFC98A', gain: 0.2, pool: Math.min(1.8, 0.8 + span * 0.35) });
      }
    }
  }
  return out;
}

/** World-space vertex positions (x, y, z flattened) of one baked glow class. */
export interface GlowSet { cls: 'shade' | 'bulb'; xyz: ArrayLike<number> }

/** World-space positions of the scene's baked glow classes (`kit:<group>:shade|bulb`). */
function glowSets(scene: THREE.Object3D | null | undefined): GlowSet[] | null {
  const acc: { shade: number[]; bulb: number[] } = { shade: [], bulb: [] };
  scene?.traverse?.((o) => {
    const m = /^kit:.*:(shade|bulb)$/.exec(o.name ?? '');
    const geometry = (o as { geometry?: THREE.BufferGeometry }).geometry; // Mesh / InstancedMesh: three's Object3D does not declare it
    if (!m || !geometry) return;
    const pos = geometry.getAttribute('position');
    if (!pos) return;
    o.updateWorldMatrix?.(true, false);
    const e = o.matrixWorld.elements;
    const a = acc[m[1] as 'shade' | 'bulb']; // the regex admits only these two
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      a.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
  });
  return acc.shade.length + acc.bulb.length ? [{ cls: 'shade', xyz: acc.shade }, { cls: 'bulb', xyz: acc.bulb }] : null;
}

/** The slice of the layout the pools read. */
export interface LampsLayout { lamps?: Layout['lamps']; floorAt?: Layout['floorAt']; zoneAt?: Layout['zoneAt'] }

/** What a frame reads from CORE's ctx (a full `Ctx` satisfies it). */
export interface LampsFrame {
  camera: { position: Vec3; matrixWorld?: { elements: ArrayLike<number> } | null };
  scene?: THREE.Object3D | null;
  frame?: number;
  hour?: number;
  rawDt?: number;
  time?: number;
}

export function createLamps(layout: LampsLayout) {
  const mk = (l: PoolAnchor): Lamp => {
    const e: Lamp = { ...l, radius: l.kind === 'hearth' ? l.radius * HEARTH_REACH : l.kind === 'desk' ? Math.min(l.radius, DESK_REACH) : l.radius, rgb: norm(lin(l.color)), gain: Math.min(l.gain ?? 0.2, LAMP_CAP), cur: 0, slot: -1, want: false, sk: 0.5, down: DOWNLIGHT.has(l.kind), pool: l.pool ?? (l.kind === 'desk' ? DESK_POOL : POOL_BY_KIND[l.kind] ?? POOL_RADIUS.default) };
    // after dark incandescent pools read warmer against the cool night surround (colour^1.5: more saturated, same max)
    e.rgbNight = [e.rgb[0] ** LAMP_NIGHT_WARMTH, e.rgb[1] ** LAMP_NIGHT_WARMTH, e.rgb[2] ** LAMP_NIGHT_WARMTH];
    return e;
  };
  const lamps: Lamp[] = (layout.lamps ?? []).map(mk);
  let fixturesTried = 0, fixtures = 0, fixtureMs = 0;
  const screens = new Map<ScreenGlow, Lamp>(); // cluster → lamp entry
  const slots: (Lamp | null)[] = new Array(MAX_LAMPS).fill(null);
  let lastPick = -1, clock = 0, snap = false;
  const pickAt = { x: NaN, z: NaN }; // camera position at the last pick (a teleport > 4 m re-picks and snaps)
  const override = new Map<string, number>(); // id → gain multiplier (e.g. blocked lamp colour swaps later)
  const w = { day: 0, golden: 0, night: 0 }; // m2 fix r2: reused phase weights (no per-frame object)

  function pick(cx: number, cz: number, fx: number, fz: number): Set<Lamp> {
    // real lamps first: screen-light pools only take slots the lamps leave free (+ (10 m)² in the sort key)
    // m2 fix r2 (perf): the sort key is computed once per lamp (was per comparison: n·log n boxed doubles, 4×/s)
    // m2 fix r3: pools in front of the camera win over pools behind it (a lamp behind you only lights what you can see
    // when it is close): the distance behind the view plane counts ×3
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i], dx = l.pos.x - cx, dz = l.pos.z - cz;
      const back = Math.max(0, -(dx * fx + dz * fz) - 2.5);
      l.sk = dx * dx + dz * dz + 8 * back * back + (l.kind === 'screen' ? 100 : 0);
    }
    const sorted = [...lamps].sort(bySortKey);
    return new Set(sorted.slice(0, MAX_LAMPS));
  }

  return {
    count: () => lamps.length,
    /** Scale one lamp (0 = off). */
    setLamp(id: string, k: number) { override.set(id, k); },
    /** {anchors, fixtures, active: [ids in the slots]} (lights.ts → `__hq.stats().lamps`). */
    stats: () => ({ anchors: lamps.filter((l) => l.kind !== 'screen').length, fixtures: lamps.filter((l) => /^fixture:/.test(l.id)).length, fixtureMs: +fixtureMs.toFixed(1), active: slots.filter((l): l is Lamp => !!l).map((l) => l.id) }),
    /** Fixture pool anchors adopted from the scene (debug / review). */
    fixtures: () => lamps.filter((l) => /^fixture:/.test(l.id)).map((l) => ({ id: l.id, kind: l.kind, pos: l.pos, radius: l.radius, pool: l.pool })),
    update(ctx: LampsFrame) {
      const cam = ctx.camera.position;
      // fixture pools: once the zones have baked their glow classes (retry for the first few seconds of boot)
      if (!fixtures && fixturesTried < 12 && ((ctx.frame ?? 0) % 30 === 0)) {
        fixturesTried++;
        const t0 = performance.now();
        const sets = glowSets(ctx.scene);
        if (sets) {
          const fy = (x: number, z: number, y: number) => layout.floorAt?.(x, z, y)?.y ?? 0;
          // the mezzanine's ceiling bulbs are its star field (cool, not lamps)
          const stars = (x: number, y: number, z: number) => layout.zoneAt?.(x, z, y > 2.8 ? 1 : 0) === 'MEZ';
          for (const a of fixtureAnchors(sets, layout.lamps ?? [], fy, stars)) lamps.push(mk(a));
          fixtures = 1; lastPick = -1; fixtureMs = performance.now() - t0;
        }
      }
      // screen light: one pool per desk cluster, colour from its screens' modes. The shader scales every pool by the
      // phase lamp scale; screens only light their surroundings after dark, so divide that back out.
      phaseWeightsInto(w, ctx.hour ?? 13);
      const scale = w.day * LAMP_SCALE.day + w.golden * LAMP_SCALE.golden + w.night * LAMP_SCALE.night;
      for (const c of screenGlows()) {
        let l = screens.get(c);
        if (!l) {
          l = { id: `screen:${screens.size}`, kind: 'screen' as const, pos: { x: c.pos.x, y: c.pos.y + SCREEN_LIFT, z: c.pos.z }, radius: SCREEN_RADIUS, rgb: [0, 0, 0], gain: 1, cur: 0, slot: -1, want: false, sk: 0.5, down: false, pool: 0 };
          screens.set(c, l); lamps.push(l);
        }
        const k = SCREEN_GAIN * w.night / scale;
        l.rgb[0] = c.rgb[0] * k; l.rgb[1] = c.rgb[1] * k; l.rgb[2] = c.rgb[2] * k;
      }
      // re-pick at most 4×/s; keep lamps already assigned in their slot (no uniform reshuffle → no flicker)
      clock += ctx.rawDt || 0.016;
      // m2 fix r3: a teleport (pose, goTo, follow jump) re-picks at once and snaps, so the new room is lit on its first
      // frame instead of fading its pools in over the next half second
      const jump = (cam.x - pickAt.x) ** 2 + (cam.z - pickAt.z) ** 2 > 16;
      if (clock - lastPick > 0.25 || lastPick < 0 || jump) {
        snap = lastPick < 0 || jump;
        lastPick = clock; pickAt.x = cam.x; pickAt.z = cam.z;
        const e = ctx.camera.matrixWorld?.elements;
        const fx = e ? -e[8] : 0, fz = e ? -e[10] : -1, fl = Math.hypot(fx, fz) || 1;
        const want = pick(cam.x, cam.z, fx / fl, fz / fl);
        for (const l of lamps) l.want = want.has(l);
      }
      const k = snap || (lastPick === clock && clock < 0.5) ? 1 : 1 - Math.exp(-(ctx.rawDt || 0.016) / 0.13); // ≈ 0.4 s to settle; boot / teleports snap
      snap = false;
      for (const l of lamps) {
        if (!l.want && l.slot < 0 && l.cur === 0) continue; // off and unassigned: nothing to ease (m2 fix r2: no store)
        // after dark every real lamp runs at the per-lamp cap (the §5.0 invariant already budgets LAMP_CAP per pool), so the
        // authored gains set the day/golden balance and the night pools read (+6…+14 L*, M1.75)
        const g = l.kind === 'screen' ? l.gain : l.gain + (LAMP_CAP - l.gain) * w.night;
        // M3.5 (no popping while walking): a lamp only ramps up while it holds a slot. It used to ramp while waiting
        // for one (all 12 taken, the old room's pools still fading out) and then appeared at full strength the frame a
        // slot freed up: a visible pop two frames apart (probe.ts popCheck). A snap (boot / teleport) still lands at once
        const target = l.want && (l.slot >= 0 || k === 1) ? g * (override.get(l.id) ?? 1) : 0;
        l.cur += (target - l.cur) * k;
        if (l.slot >= 0 && !l.want && l.cur < 0.002) { slots[l.slot] = null; l.slot = -1; l.cur = 0; }
      }
      // assign after releasing (a snap frees the old room's slots in the same frame)
      for (const l of lamps) {
        if (l.slot >= 0 || !l.want) continue;
        const free = slots.indexOf(null);
        if (free < 0) break;
        slots[free] = l; l.slot = free;
      }
      for (let i = 0; i < MAX_LAMPS; i++) {
        const l = slots[i];
        const p = U.uLampPos.value[i], c = U.uLampCol.value[i];
        if (!l) { p.w = 0; c.setRGB(0, 0, 0); continue; }
        const rw = poolCode(l.radius, l.pool, l.kind === 'hearth', l.kind === 'desk');
        p.set(l.pos.x, l.pos.y, l.pos.z, l.down ? -rw : rw);
        const n = l.rgbNight ? w.night : 0, rgb = l.rgb, rn = l.rgbNight ?? rgb;
        const t = ctx.time ?? 0;
        const fl = l.kind === 'hearth' ? HEARTH_BOOST * (1 + 0.035 * Math.sin(t * 18.8) + 0.025 * Math.sin(t * 11.3 + 1.7)) : l.kind === 'desk' ? DESK_BOOST : 1;   // ±6 %, ~3 Hz
        const g = l.cur * fl;
        c.setRGB((rgb[0] + (rn[0] - rgb[0]) * n) * g, (rgb[1] + (rn[1] - rgb[1]) * n) * g, (rgb[2] + (rn[2] - rgb[2]) * n) * g);
      }
    },
  };
}
