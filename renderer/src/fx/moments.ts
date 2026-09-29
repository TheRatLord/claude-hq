/**
 * [FX M3.5] Diegetic feedback moments ("walk up and manage" wave), all on FX's existing quad batches and particle pool
 * (0 added draw calls, 0 new programs):
 *  - **Blocked lantern escalation** (GD #10): after LANTERN_AFTER_MS blocked, a red paper lantern rises on a string
 *    from the agent's head to just under its zone's ceiling (atrium / Pit 5.5 m, bays 2.8 m) and bobs there, readable
 *    over partitions. It draws depth-tested (`sprite`); when the camera cannot see it (a wall / the mezzanine slab
 *    between, or it hangs above the camera's own ceiling: seen from the street or a bay), a faint ghost of it draws on
 *    the on-top batch, so it is found from anywhere on the floor, the mezzanine and the street. Longest waiter first:
 *    at most LANTERN_MAX, ranked by wait (rank 0 the biggest and highest); they rise one after another. `answered`
 *    pops it into confetti; leaving `blocked` any other way deflates it with a puff.
 *  - **Paper plane** on bus `verb {verb:'prompt', id}`: from just under the lens along an arc to the target's head in
 *    ≈ 0.8 s, a paper trail, a puff on landing.
 *  - **Hearts** on `verb {verb:'pat'}`; a **dust poof** on `crate.unwrap {id?, pos?}`; **confetti in the Pit** on
 *    `inbox.zero`.
 * Emits `fx.lantern {ev:'rise'|'pop'|'deflate', id}` and `fx.plane {ev:'launch'|'land', id}` (AUD cues).
 * Counters (`__hq.stats().fx`): one `mAnswered` / `mInboxZero` / `mVerb` / `mCrate` per event that made a burst.
 * No per-frame allocation: lanterns / planes are pooled records, quads are staged in QV.
 * Owner: FX.
 */
import { SHAPES, type ShapeKey } from './draw.ts';
import { QV, type QuadBatch } from './quads.ts';
import { CORE } from '../../../shared/palette.ts';
import type { Bus } from '../core/bus.ts';
import type { Layout, Zone } from '../world/layout/schema.ts';
import type { Particles, BurstKind } from './particles.ts';
import type { FxFrame, FxState, UvRect, Vec3Like } from './types.ts';

declare module '../core/bus.ts' {
  interface BusEvents {
    /** FX's paper plane: launched from the lens / landed on its target (AUD cues) */
    'fx.plane': { ev: 'launch' | 'land'; id: string };
  }
}

/** The actor-state fields moments read (an `FxState` satisfies it). */
export interface MomentState extends Pick<FxState, 'id' | 'status' | 'since' | 'x' | 'z' | 'floorY' | 'top' | 'vis' | 'phase'> { headY?: number }
/** The frame fields moments read. */
export type MomentFrame = Pick<FxFrame, 't' | 'dt' | 'now' | 'R' | 'U' | 'F' | 'fovK' | 'vh'>;

/** Blocked this long (ms) before the lantern rises (GD #10). */
export const LANTERN_AFTER_MS = 60_000;
/** At most this many lanterns (longest waiters). */
export const LANTERN_MAX = 6;
const RISE_S = 2.6, STAGGER_S = 0.45;
/** Lantern body height (m) and its minimum on-screen height (px at a 900 px viewport). */
const LANTERN_H = 0.8, LANTERN_MIN_PX = 62; // the tile's paper body is ≈ 60% of its height
const PLANE_MAX = 4;
/** Hang this far under the zone ceiling (m), but no higher than HANG_MAX over the floor (the atrium's 5.5 m ceiling hid
 *  it behind the lobby / bay ceilings: at ≈ 3 m it reads from the lobby, the mezzanine and through the bay glazing);
 *  rank steps down (m). */
const CEIL_GAP = 0.45, HANG_MAX = 3.1, RANK_STEP = 0.22;
const GHOST_A = 0.5;
/** [FX fix r1 m2-carry] pat hearts: count, gap over the crown (m), pull toward the lens (m), highest spawn NDC y, and
 *  the window in which a second hearts request for the same actor is the same pat (s). */
export const PAT_HEARTS = 7, PAT_ABOVE = 0.06, PAT_TOWARD = 0.18, PAT_NDC_Y = 0.42, PAT_DEDUPE_S = 0.5;

const easeOut = (x: number) => 1 - (1 - x) ** 3;
const INK = (() => { const h = CORE.ink; return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; })();

/**
 * @pure Which blocked agents get a lantern: those waiting ≥ `afterMs`, longest wait first, at most `max`, skipping ids in
 * `skip` (answered, awaiting the status change). `list` = [{id, status, since}], `now` ms. Writes ids into `out`.
 */
export function lanternOrder(list: readonly Pick<MomentState, 'id' | 'status' | 'since'>[], now: number, { afterMs = LANTERN_AFTER_MS, max = LANTERN_MAX, skip = null }: { afterMs?: number; max?: number; skip?: { has(id: string): boolean } | null } = {}, out: string[] = []): string[] {
  out.length = 0;
  const c: Pick<MomentState, 'id' | 'status' | 'since'>[] = [];
  for (const S of list) if (S.status === 'blocked' && now - (S.since ?? now) >= afterMs && !skip?.has(S.id)) c.push(S);
  c.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : a.id < b.id ? -1 : 1));
  for (let i = 0; i < c.length && i < max; i++) out.push(c[i].id);
  return out;
}

export interface MomentsDeps {
  tiles: { shape(k: ShapeKey): UvRect };
  sprite: Pick<QuadBatch, 'pushQ'>;
  pin: Pick<QuadBatch, 'pushQ'>;
  particles: Pick<Particles, 'burst'>;
  layout: Layout | null;
  bus: Bus | null | undefined;
  los: (x: number, y: number, z: number) => boolean;
  stateOf: (id: string) => MomentState | undefined;
  actorOf: (id: string) => { pos: Vec3Like; lift?: number } | null | undefined;
}
/** A live lantern. */
interface Lantern { id: string; t0: number; x: number; y: number; z: number; floor: number; ceil: number; phase: number; occ: boolean; occT: number }
/** A flying paper plane (pooled). */
interface Plane { live: boolean; id: string; t: number; dur: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; lift: number; trail: number }
/** A delayed secondary burst. */
interface Volley { t: number; kind: BurstKind; x: number; y: number; z: number; count: number }

export function createMoments({ tiles, sprite, pin, particles, layout, bus, los, stateOf, actorOf }: MomentsDeps) {
  const zones = new Map<string, Zone>();
  for (const z of layout?.zones ?? []) zones.set(`${z.id}|${z.level ?? 0}`, z);
  const zoneOf = (x: number, z: number, level: number): Zone | null => { const id = layout?.zoneAt?.(x, z, level); return id ? zones.get(`${id}|${level}`) ?? zones.get(`${id}|0`) ?? null : null; };
  const ceilAt = (x: number, z: number, level: number) => zoneOf(x, z, level)?.ceil ?? layout?.height ?? 2.8;
  const pit = (() => {
    const z = (layout?.zones ?? []).find((q) => q.id === 'PIT');
    if (!z) return null;
    const c = z.circle ?? [(z.rect[0] + z.rect[2]) / 2, (z.rect[1] + z.rect[3]) / 2];
    return { x: c[0], z: c[1], floor: z.floor ?? 0 };
  })();

  /** live lanterns by actor id */
  const lanterns = new Map<string, Lantern>();
  const lanternList: Lantern[] = [];
  /** answered ids (no lantern until their status leaves blocked, ≤ 30 s) → answered at (s) */
  const answered = new Map<string, number>();
  const want: string[] = [];
  const planes: Plane[] = Array.from({ length: PLANE_MAX }, () => ({ live: false, id: '', t: 0, dur: 0.8, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, lift: 0, trail: 0 }));
  const pendingPlanes: string[] = []; // launched from the bus between frames (the camera pose is read at the next draw)
  const volleys: Volley[] = []; // delayed secondary bursts [{t, kind, x, y, z, opts}]
  const cnt = { mAnswered: 0, mInboxZero: 0, mVerb: 0, mCrate: 0, lanterns: 0, lanternsGhost: 0, lanternPops: 0, planes: 0, hearts: 0 };
  let T = 0;
  const at = { x: 0, y: 0, z: 0 };
  const P = (x: number, y: number, z: number) => { at.x = x; at.y = y; at.z = z; return at; };

  /** Head top of an actor (m) + feet: the FX state when drawn this frame, else the actor record. */
  function headOf(id: string, out: { x: number; y: number; z: number; floor: number }): boolean {
    const S = stateOf(id), a = actorOf(id);
    if (S && S.vis) { out.x = S.x; out.z = S.z; out.y = S.top; out.floor = S.floorY; return true; }
    if (!a?.pos) return false;
    const fl = a.pos.y - (a.lift ?? 0);
    out.x = a.pos.x; out.z = a.pos.z; out.y = fl + 1.0; out.floor = fl;
    return true;
  }
  const H = { x: 0, y: 0, z: 0, floor: 0 };

  // [FX fix r1 m2-carry] pat hearts must pop every time. A seated Clawd framed by the walk-up pose (≈ 1.1 m, looking down)
  // has its hat tip near the top frame edge: hearts that spawn over the tip and rise leave the frame at once, and the
  // CHR burst at `pos.y + 0.95` sat inside the head. So: spawn just over the crown, pulled toward the lens a little and
  // lowered (never under the face) until the spot is inside the upper frame (NDC y ≤ PAT_NDC_Y); drawn on top (depth
  // test off, particles `top`), 7 of them with a squash-scale pop. One burst per actor per PAT_DEDUPE_S (the bus verb
  // and CHR's `fx.burst('hearts')` for the same pat).
  const patAt = new Map<string, number>(); // id → T of the last pat burst
  let lastF: MomentFrame | null = null;
  let lastCam: Vec3Like | null = null;
  /** Pat hearts over actor `id` (deduped). Returns true when it burst. */
  function patHearts(id: string | undefined): boolean {
    if (!id || !headOf(id, H)) return false;
    const t0 = patAt.get(id);
    if (t0 !== undefined && T - t0 >= 0 && T - t0 < PAT_DEDUPE_S) return false;
    patAt.set(id, T);
    if (patAt.size > 64) for (const k of patAt.keys()) { if (T - (patAt.get(k) ?? T) > 5) patAt.delete(k); }
    const S = stateOf(id);
    let x = H.x, y = H.y + PAT_ABOVE, z = H.z;
    const floorFace = S?.vis ? (S.headY ?? H.y) - 0.12 : H.y - 0.2; // never lower than just under the pillowed head top
    if (lastF && lastCam) {
      const cam = lastCam, Fw = lastF.F, U = lastF.U;
      // toward the lens in plan (in front of the head, not behind the hat)
      const dx = cam.x - x, dz = cam.z - z, dl = Math.hypot(dx, dz);
      if (dl > 0.3) { const k = Math.min(PAT_TOWARD, dl * 0.25) / dl; x += dx * k; z += dz * k; }
      const depth = (x - cam.x) * Fw.x + (y - cam.y) * Fw.y + (z - cam.z) * Fw.z;
      if (depth > 0.2 && U.y > 0.2) {
        const up = (x - cam.x) * U.x + (y - cam.y) * U.y + (z - cam.z) * U.z, lim = PAT_NDC_Y * depth * lastF.fovK;
        if (up > lim) y = Math.max(floorFace, y - (up - lim) / U.y);
      }
    }
    particles.burst('hearts', P(x, y, z), { count: PAT_HEARTS, top: true });
    cnt.hearts++;
    return true;
  }

  // ------------------------------------------------------------------------------------------ bus
  bus?.on?.('answered', (m) => {
    const id = m?.id;
    if (!id) return;
    answered.set(id, T);
    const L = lanterns.get(id);
    if (L) {
      // pop: confetti from the lantern (hot 1.2), a paper puff, gone
      particles.burst('confetti', P(L.x, L.y - 0.2, L.z), { count: 44, floor: L.floor, up: 0.55, spread: 0.9 });
      particles.burst('poof', P(L.x, L.y + 0.25, L.z), { count: 6 });
      drop(id);
      cnt.lanternPops++;
      bus.emit?.('fx.lantern', { ev: 'pop', id });
    } else if (headOf(id, H)) {
      particles.burst('confetti', P(H.x, H.y + 0.1, H.z), { count: 22, floor: H.floor, up: 0.6, spread: 0.6 });
    } else return;
    cnt.mAnswered++;
  });
  bus?.on?.('inbox.zero', () => {
    if (!pit) return;
    const y = pit.floor + 0.35;
    particles.burst('confetti', P(pit.x, y, pit.z), { count: 170, floor: pit.floor, up: 1.9, spread: 1.4 });
    particles.burst('sparkle', P(pit.x, y + 0.8, pit.z), { count: 16 });
    // two side volleys from the sofa ring a beat later (one event, one counted burst)
    volleys.push({ t: T + 0.35, kind: 'confetti', x: pit.x - 1.6, y, z: pit.z + 0.8, count: 70 });
    volleys.push({ t: T + 0.6, kind: 'confetti', x: pit.x + 1.5, y, z: pit.z - 0.9, count: 70 });
    cnt.mInboxZero++;
  });
  bus?.on?.('verb', (m) => {
    const id = m?.id, verb = m?.verb;
    if (verb === 'prompt') { if (pendingPlanes.length < PLANE_MAX) pendingPlanes.push(id ?? ''); cnt.mVerb++; return; }
    if (verb === 'pat' && id && patHearts(id)) cnt.mVerb++;
  });
  bus?.on?.('crate.unwrap', (m) => {
    let x, y, z;
    if (m?.pos) { x = m.pos.x; y = m.pos.y ?? 0; z = m.pos.z; } else if (m?.id && headOf(m.id, H)) { x = H.x; y = H.floor; z = H.z; } else return;
    particles.burst('dust', P(x, y + 0.9, z), { count: 14, floor: y });
    particles.burst('poof', P(x, y + 0.7, z), { count: 8 });
    cnt.mCrate++;
  });

  function drop(id: string) {
    const L = lanterns.get(id);
    if (!L) return;
    lanterns.delete(id);
    const k = lanternList.indexOf(L); if (k >= 0) lanternList.splice(k, 1);
  }

  // ------------------------------------------------------------------------------------------ quads
  /** Camera-facing quad at c with half size (hw, hh), rotated by `rot` in the view plane. */
  function quad(batch: Pick<QuadBatch, 'pushQ'>, F: MomentFrame, x: number, y: number, z: number, hw: number, hh: number, rot: number, tl: UvRect, a: number, r = 1, g = 1, b = 1) {
    const c = Math.cos(rot), s = Math.sin(rot), R = F.R, U = F.U;
    QV[0] = x; QV[1] = y; QV[2] = z;
    QV[3] = (R.x * c + U.x * s) * hw; QV[4] = (R.y * c + U.y * s) * hw; QV[5] = (R.z * c + U.z * s) * hw;
    QV[6] = (-R.x * s + U.x * c) * hh; QV[7] = (-R.y * s + U.y * c) * hh; QV[8] = (-R.z * s + U.z * c) * hh;
    QV[9] = tl.u0; QV[10] = tl.v0; QV[11] = tl.u1; QV[12] = tl.v1; QV[13] = r; QV[14] = g; QV[15] = b; QV[16] = a;
    batch.pushQ();
  }
  /** A thin world line a → b (the lantern string), facing the camera. */
  function string(batch: Pick<QuadBatch, 'pushQ'>, F: MomentFrame, cam: Vec3Like, ax: number, ay: number, az: number, bx: number, by: number, bz: number, wpp: number, a: number) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 0.02) return;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    // across = normalize(d × view)
    const vx = mx - cam.x, vy = my - cam.y, vz = mz - cam.z;
    let cx = dy * vz - dz * vy, cy = dz * vx - dx * vz, cz = dx * vy - dy * vx;
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1, w = Math.max(0.006, 1.1 * wpp);
    cx *= w / cl; cy *= w / cl; cz *= w / cl;
    const tl = tiles.shape('solid'), u = (tl.u0 + tl.u1) / 2, v = (tl.v0 + tl.v1) / 2;
    QV[0] = mx; QV[1] = my; QV[2] = mz; QV[3] = cx; QV[4] = cy; QV[5] = cz; QV[6] = dx / 2; QV[7] = dy / 2; QV[8] = dz / 2;
    QV[9] = u; QV[10] = v; QV[11] = u; QV[12] = v; QV[13] = INK[0]; QV[14] = INK[1]; QV[15] = INK[2]; QV[16] = a;
    batch.pushQ();
  }

  // ------------------------------------------------------------------------------------------ frame
  /**
   * Once per frame, after the label pass (its line-of-sight cache is warm) and before the batches end. `stateList` =
   * every FX actor state.
   */
  function draw(stateList: readonly MomentState[], F: MomentFrame, cam: Vec3Like) {
    T = F.t;
    lastF = F; lastCam = cam; // [FX fix r1 m2-carry] the pat-hearts framing reads the last frame's lens
    cnt.lanterns = 0; cnt.lanternsGhost = 0; cnt.planes = 0;
    // answered ids wait for their status to leave blocked (≤ 30 s)
    for (const [id, t0] of answered) { const S = stateOf(id); if (!S || S.status !== 'blocked' || T - t0 > 30 || T < t0) answered.delete(id); }
    lanternOrder(stateList, F.now, { skip: answered }, want);
    // retire lanterns no longer wanted (status left blocked, fell out of the top LANTERN_MAX, actor gone)
    for (let i = lanternList.length - 1; i >= 0; i--) {
      const L = lanternList[i];
      if (want.includes(L.id)) continue;
      const S = stateOf(L.id);
      if (!S || S.status !== 'blocked') { particles.burst('poof', P(L.x, L.y, L.z), { count: 7 }); bus?.emit?.('fx.lantern', { ev: 'deflate', id: L.id }); }
      drop(L.id);
    }
    const camLevel = cam.y > 2.7 ? 1 : 0;
    const camZone = zoneOf(cam.x, cam.z, camLevel), camCeil = camZone?.ceil ?? 99;
    const scale900 = F.vh / 900;
    let born = 0;
    for (let r = 0; r < want.length; r++) {
      const id = want[r], S = stateOf(id), a = actorOf(id);
      if (!S || !a) continue;
      let L = lanterns.get(id);
      const head = S.vis ? S.top : S.floorY + 1.0;
      const level = S.floorY > 2 ? 1 : 0;
      const ceil = ceilAt(S.x, S.z, level);
      if (!L) {
        L = { id, t0: T + born * STAGGER_S, x: S.x, y: head, z: S.z, floor: S.floorY, ceil, phase: S.phase ?? 0, occ: false, occT: -9 };
        born++;
        lanterns.set(id, L); lanternList.push(L);
        bus?.emit?.('fx.lantern', { ev: 'rise', id });
      }
      // follow the agent (a lagging spring on the string), hang under the ceiling, rank r a step lower and smaller
      const k = 1 - Math.exp(-2.2 * F.dt);
      const sway = Math.sin(T * 0.6 + L.phase) * 0.12;
      L.x += (S.x + sway - L.x) * k; L.z += (S.z + sway * 0.6 - L.z) * k;
      L.floor = S.floorY; L.ceil = ceil;
      const top = Math.max(head + 0.8, Math.min(ceil - CEIL_GAP, S.floorY + HANG_MAX) - (r % 3) * RANK_STEP);
      const u = Math.max(0, Math.min(1, (T - L.t0) / RISE_S));
      if (T < L.t0) continue; // waiting its turn to rise (longest waiter first)
      const bob = Math.sin((T - L.t0) * Math.PI + L.phase) * 0.07 * u;
      L.y = head + (top - head) * easeOut(u) + bob;
      // size: LANTERN_H world, never under LANTERN_MIN_PX on screen; rank > 0 a little smaller
      const depth = (L.x - cam.x) * F.F.x + (L.y - cam.y) * F.F.y + (L.z - cam.z) * F.F.z;
      if (depth <= 0.3) continue; // behind / at the lens
      const wpp = (2 * depth * F.fovK) / F.vh;
      const kr = r === 0 ? 1 : 0.85;
      const hh = Math.max((LANTERN_H / 2) * kr, (LANTERN_MIN_PX / 2) * scale900 * wpp * kr) * (0.35 + 0.65 * easeOut(Math.min(1, u * 2)));
      const hw = hh * (SHAPES.lantern.w / SHAPES.lantern.h);
      const rot = Math.sin(T * 1.3 + L.phase) * 0.07;
      const tl = tiles.shape('lantern');
      // string from the lantern's hanger down to the head (the lantern body centre is 0.1 × h above the tile centre)
      string(sprite, F, cam, L.x, L.y - hh * 0.8, L.z, S.x, head, S.z, wpp, 0.55);
      quad(sprite, F, L.x, L.y, L.z, hw, hh, rot, tl, 1);
      cnt.lanterns++;
      // hidden from this camera (wall / slab between, or above the camera's own ceiling): a ghost on top, ~5 Hz check
      if (T - L.occT > 0.2 || T < L.occT) {
        L.occT = T;
        L.occ = (L.y > camCeil + 0.05 && zoneOf(L.x, L.z, level) !== camZone) || los(L.x, L.y, L.z);
      }
      if (L.occ && depth < 45) { quad(pin, F, L.x, L.y, L.z, hw, hh, rot, tl, GHOST_A); cnt.lanternsGhost++; }
    }

    // planes
    while (pendingPlanes.length) {
      const id = pendingPlanes.shift() ?? '';
      const p = planes.find((q) => !q.live);
      if (!p) break;
      p.live = true; p.id = id; p.t = 0; p.trail = 0;
      p.x0 = cam.x + F.F.x * 0.7 - F.U.x * 0.22 + F.R.x * 0.14;
      p.y0 = cam.y + F.F.y * 0.7 - F.U.y * 0.22 + F.R.y * 0.14;
      p.z0 = cam.z + F.F.z * 0.7 - F.U.z * 0.22 + F.R.z * 0.14;
      if (id && headOf(id, H)) { p.x1 = H.x; p.y1 = H.y + 0.12; p.z1 = H.z; } else { p.x1 = cam.x + F.F.x * 8; p.y1 = cam.y + F.F.y * 8; p.z1 = cam.z + F.F.z * 8; }
      const d = Math.hypot(p.x1 - p.x0, p.y1 - p.y0, p.z1 - p.z0);
      p.dur = Math.max(0.6, Math.min(1.0, 0.55 + d * 0.035));
      p.lift = 0.25 + d * 0.12;
      bus?.emit?.('fx.plane', { ev: 'launch', id });
    }
    for (const p of planes) {
      if (!p.live) continue;
      p.t += F.dt;
      // the target keeps moving: aim at its head each frame
      if (p.id && headOf(p.id, H)) { p.x1 = H.x; p.y1 = H.y + 0.12; p.z1 = H.z; }
      const u = Math.min(1, p.t / p.dur), w = 1 - (1 - u) * (1 - u) * (1 - 0.35 * u); // a thrown launch, gliding in
      const x = p.x0 + (p.x1 - p.x0) * w, z = p.z0 + (p.z1 - p.z0) * w;
      const y = p.y0 + (p.y1 - p.y0) * w + p.lift * 4 * w * (1 - w);
      if (u >= 1) {
        p.live = false;
        particles.burst('poof', P(p.x1, p.y1 + 0.25, p.z1), { count: 5 });
        particles.burst('sparkle', P(p.x1, p.y1, p.z1), { count: 6 });
        bus?.emit?.('fx.plane', { ev: 'land', id: p.id });
        continue;
      }
      // velocity (finite difference along the curve) → screen angle
      const w2 = Math.min(1, w + 0.02);
      const vx = (p.x1 - p.x0) * (w2 - w), vz = (p.z1 - p.z0) * (w2 - w);
      const vy = (p.y1 - p.y0) * (w2 - w) + p.lift * 4 * ((w2 * (1 - w2)) - (w * (1 - w)));
      const vr = vx * F.R.x + vy * F.R.y + vz * F.R.z, vu = vx * F.U.x + vy * F.U.y + vz * F.U.z;
      // nose leads, paper side up: flying left = the tile mirrored, rotated by the reversed velocity
      const flip = vr < 0 ? -1 : 1, rot = flip < 0 ? Math.atan2(-vu, -vr) : Math.atan2(vu, vr);
      const tl = tiles.shape('plane');
      const depth = Math.max(0.3, (x - cam.x) * F.F.x + (y - cam.y) * F.F.y + (z - cam.z) * F.F.z);
      const wpp = (2 * depth * F.fovK) / F.vh;
      const hw = Math.max(0.11, 24 * scale900 * wpp), hh = hw * (SHAPES.plane.h / SHAPES.plane.w);
      quad(sprite, F, x, y, z, hw * flip, hh, rot, tl, 1);
      p.trail += F.dt;
      if (p.trail > 0.07) { p.trail = 0; particles.burst('steam', P(x, y, z)); }
      cnt.planes++;
    }
    // delayed volleys
    for (let i = volleys.length - 1; i >= 0; i--) {
      const v = volleys[i];
      if (T < v.t) continue;
      particles.burst(v.kind, P(v.x, v.y, v.z), { count: v.count, floor: pit?.floor ?? v.y - 0.3, up: 1.5, spread: 1.1 });
      volleys.splice(i, 1);
    }
  }

  return {
    draw,
    /** Forget an actor (removed): its lantern goes without a pop. */
    forget: (id: string) => { drop(id); answered.delete(id); patAt.delete(id); },
    /** [FX fix r1 m2-carry] pat / comfort hearts over actor `id` (deduped with the bus verb). Returns true when it burst. */
    hearts: patHearts,
    stats: () => cnt,
  };
}

export type Moments = ReturnType<typeof createMoments>;
