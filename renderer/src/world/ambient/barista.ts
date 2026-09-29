/**
 * "Bean", the Café's espresso-bot barista (review m2 fix r2 [gameplay]: an empty Café must not look dead). A flying
 * teacup with stubby flapping wings, a teal apron band, a latte-art heart on its crema and noodle arms. Visibly ambient
 * (no nameplate, no ring, never an entity, P6): its cups are cosmetic and it never moves an agent.
 * Day loop (a pick every errand; weights below, never the same idle errand twice in a row):
 * - pull a shot: grinder → machine (reach, "pssht" steam burst) → ta-da hop with the fresh cup, then sip-tests it
 * - polish cups at the cup tower, wipe a café table (circling cloth), water the east-window pothos, rest on its dock
 * - serve: any agent at a coffee / café slot, Ada on her coffee break, or the player standing at the bar → pulls a
 *   shot and flies it over, holds the cup out, happy face (per-customer cooldown)
 * - Segfault begging at the pastry case → wags a finger, then drops a crumb (the cat purrs)
 * - the player walks into the Café → zips over, waves, a happy loop-the-loop
 * Night (22–07): asleep on its charging puck at the bar's east end (dim, Z's). Draws through charBatch. Owner: AMB.
 */
import * as THREE from 'three';
import { makeBuilder, node, limbScale } from '../../chars/rig/build.ts';
import { CORE, ENV } from '../../../../shared/palette.ts';
import { W, TAU, clamp, damp, dampAng, yawTo, smooth01 } from './util.ts';
import type { AmbDeps, AmbFrame, AmbPeers, Vec3 } from './util.ts';
import type { RigPart } from '../../chars/rig/build.ts';

const CREAM = '#EDE3D2', CREMA = '#6E4631', BRASS = '#C9A15C', FOAM = '#F4EADB', BLUSH = '#E6A09A';
export const BEAN_CRUISE = 1.62; // flight altitude between errands (clears the café monstera, below the bar pendants)
const MAX_V = 1.8;
export const BEAN_SCALE = 1.3; // toy-scale exaggeration like the cat: reads across the Café

/** Idle errand weights (the day loop). */
export const BEAN_ERRANDS = Object.freeze({ shot: 3, polish: 2, wipe: 2, plants: 1, rest: 1.2, loop: 0.6 });

export type IdleErrand = keyof typeof BEAN_ERRANDS;
export type Errand = IdleErrand | 'serve' | 'treat' | 'greet' | 'dock';

/**
 * Next errand (pure). Priority: night → 'dock'; a waiting customer → 'serve'; a begging cat → 'treat'; a player who
 * just walked in → 'greet'; else a weighted idle pick (never the previous idle errand).
 */
export function chooseErrand(w: { night?: boolean; customer?: unknown; catBegging?: boolean; greet?: boolean; last?: string | null }, rand: () => number): Errand {
  if (w.night) return 'dock';
  if (w.customer) return 'serve';
  if (w.catBegging) return 'treat';
  if (w.greet) return 'greet';
  // Object.entries keys are strings; BEAN_ERRANDS' key set is fixed above
  const opts = (Object.entries(BEAN_ERRANDS) as [IdleErrand, number][]).filter(([k]) => k !== w.last);
  let sum = 0; for (const [, v] of opts) sum += v;
  let r = rand() * sum;
  for (const [k, v] of opts) { r -= v; if (r <= 0) return k; }
  return opts[opts.length - 1][0];
}

/** A fly-to station: a point plus the yaw to face there (`null` = keep the flight heading). */
type Station = Vec3 & { yaw: number | null };
/** Somebody Bean serves: an agent, Ada or the player. `pos` is live (a getter over the mover's position). */
interface Customer { id: string; readonly pos: Vec3; h: number; near?: number }
type Cat = AmbPeers['cat'];
/** One step of an errand plan (a discriminated union on `k`; the flags are set once when the step fires). */
type Step =
  | { k: 'fly'; to: Vec3 & { yaw?: number | null } }
  | { k: 'flyTo'; who: Customer }
  | { k: 'perch' | 'sleep' | 'grind' | 'tada' | 'sip' | 'drop' | 'polish' | 'water' | 'loop'; dur: number; sp?: boolean }
  | { k: 'pull'; dur: number; pssht?: boolean }
  | { k: 'wipe'; dur: number; c: Vec3 }
  | { k: 'offer'; dur: number; who: Customer; given?: boolean }
  | { k: 'tsk'; dur: number; cat: Cat }
  | { k: 'crumb'; dur: number; cat: Cat; dropped?: boolean }
  | { k: 'hello'; dur: number; said?: boolean };
/** Arm pitch (x) / spread (z) override for one frame. */
interface ArmPose { x: number; z: number }

export function createBarista(d: Pick<AmbDeps, 'layout' | 'charBatch' | 'fx' | 'actors' | 'player' | 'rand' | 'bus' | 'peers'>) {
  const { layout, charBatch, fx, actors, player, rand } = d;
  const bar = (layout.furniture ?? []).find((f) => f.id === 'espressoBar');
  if (!bar) return null;
  const barTop = layout.floorY(bar.pos.x, bar.pos.z, 0) + bar.size[1];
  const barZ = bar.pos.z; // (update() is a function declaration: it does not see the `bar` null check)
  // bar-local → world (the bar's front faces the room; the machine is at local x −1.2, grinder −0.55, cups +0.22)
  const cs = Math.cos(bar.yaw), sn = Math.sin(bar.yaw);
  const onBar = (lx: number, lz: number, y: number) => ({ x: bar.pos.x + lx * cs + lz * sn, y, z: bar.pos.z - lx * sn + lz * cs });
  const intoBar = yawTo(-sn * 1, -cs * 1); // facing the bar's back (−local z): toward the machine
  const toRoom = yawTo(sn, cs);
  const P = {
    // Bean works the bar facing the room (face to the player), reaching back over its shoulder to the machine
    grinder: { ...onBar(-0.55, 0.5, barTop + 0.34), yaw: toRoom + 0.35 },
    machine: { ...onBar(-1.2, 0.52, barTop + 0.3), yaw: toRoom - 0.3 },
    cups: { ...onBar(0.22, 0.5, barTop + 0.3), yaw: toRoom + 0.25 },
    dock: { ...onBar(-1.78, 0.02, barTop + 0.03), yaw: toRoom },
    front: { ...onBar(-0.2, 0.75, barTop + 0.42), yaw: toRoom },
  };
  const tables = (layout.furniture ?? []).filter((f) => f.type === 'cafeTable' && f.zone === 'CAF')
    .map((f) => ({ x: f.pos.x, y: layout.floorY(f.pos.x, f.pos.z, 0) + f.size[1] + 0.2, z: f.pos.z }));
  const pothos = { ...W(41.05, 25.6), y: 1.9, yaw: yawTo(1, 0) };
  const pastry = { ...W(38.05, 26.05), y: 1.42 };
  const coffeeSlots = (layout.slots ?? []).filter((s) => s.zone === 'CAF' && (s.tag === 'coffee' || s.tag === 'cafe'));
  const inCafe = (x: number, z: number) => layout.zoneAt?.(x, z, 0) === 'CAF';

  // ---- rig ---------------------------------------------------------------------------------------------------------
  const parts: RigPart[] = [];
  const { part } = makeBuilder(parts);
  const root = new THREE.Object3D();
  const blobN = node(root, {});
  part(blobN, 'blob', 'ink', { s: [0.17, 1, 0.17] });
  const bodyN = node(root, { name: 'body', s: BEAN_SCALE });
  part(bodyN, 'cyl', BRASS, { hull: true, s: [0.078, 0.03, 0.078], p: [0, 0.012, 0] }); // foot
  part(bodyN, 'cyl', CREAM, { hull: true, shadow: true, s: [0.125, 0.21, 0.125], p: [0, 0.125, 0] });
  part(bodyN, 'cyl', ENV.teal, { s: [0.129, 0.075, 0.129], p: [0, 0.062, 0] }); // apron band
  part(bodyN, 'rbox', ENV.tealDeep, { s: [0.07, 0.035, 0.02], p: [0.035, 0.07, 0.126] }); // apron pocket
  part(bodyN, 'torus', CREAM, { s: [0.118, 0.07, 0.118], p: [0, 0.23, 0] }); // rim lip
  part(bodyN, 'cyl', CREMA, { s: [0.112, 0.02, 0.112], p: [0, 0.222, 0] });
  part(bodyN, 'heart', FOAM, { s: [0.11, 0.11, 0.05], p: [0, 0.233, 0.005], r: [-Math.PI / 2, 0, 0] }); // latte art
  const handleN = node(bodyN, { p: [-0.13, 0.13, -0.03], r: [Math.PI / 2, 0, 0] });
  part(handleN, 'torus', CREAM, { hull: true, s: [0.055, 0.055, 0.075] });
  // face (front, +z)
  const face = node(bodyN, { p: [0, 0.14, 0.121] });
  const eyes = [-1, 1].map((s) => part(face, 'eye', CORE.ink, { s: [0.46, 0.4, 0.5], p: [s * 0.047, 0.004, 0.004], group: 'face' }));
  const glints = [-1, 1].map((s) => part(face, 'sphere', FOAM, { s: [0.0065, 0.0075, 0.003], p: [s * 0.047 + 0.006, 0.02, 0.008], group: 'face' }));
  const happyEyes = [-1, 1].map((s) => part(face, 'arc', CORE.ink, { s: [0.017, 0.017, 0.02], p: [s * 0.043, -0.008, 0.004], group: 'face' }));
  const smile = part(face, 'arc', CORE.ink, { s: [0.014, 0.014, 0.02], p: [0, -0.04, 0.004], r: [0, 0, Math.PI], group: 'face' });
  const oohMouth = part(face, 'sphere', CORE.ink, { s: [0.012, 0.014, 0.006], p: [0, -0.045, 0.003], group: 'face' });
  for (const s of [-1, 1]) part(face, 'sphere', BLUSH, { s: [0.019, 0.011, 0.005], p: [s * 0.075, -0.03, -0.003], group: 'face' });
  // wings (stubby, flapping)
  const wings = [-1, 1].map((s) => {
    const w = node(bodyN, { p: [s * 0.1, 0.17, -0.07], order: 'ZYX' });
    part(w, 'sphere', FOAM, { hull: true, s: [0.075, 0.028, 0.05], p: [s * 0.065, 0.01, -0.01], r: [0, 0, s * 0.35] });
    return w;
  });
  // arms: shoulder pivots, noodle limb, round hand
  const arms = [-1, 1].map((s) => {
    const pivot = node(bodyN, { p: [s * 0.125, 0.12, 0.03], order: 'ZXY' });
    part(pivot, 'limb', CORE.ink2, { s: limbScale(0.013, 0.1) });
    const hand = node(pivot, { p: [0, -0.105, 0] });
    part(hand, 'sphere', CREAM, { hull: true, s: 0.024 });
    return { pivot, hand, s };
  });
  // props: a demitasse (right hand), a cloth (left hand)
  const cupN = node(arms[1].hand, { p: [0, -0.01, 0.03] });
  part(cupN, 'cyl', FOAM, { hull: true, s: [0.03, 0.05, 0.03], p: [0, 0.02, 0] });
  part(cupN, 'cyl', CREMA, { s: [0.025, 0.01, 0.025], p: [0, 0.043, 0] });
  part(cupN, 'cyl', FOAM, { s: [0.045, 0.008, 0.045], p: [0, -0.006, 0] }); // saucer
  const clothN = node(arms[0].hand, { p: [0, -0.02, 0.015] });
  part(clothN, 'rbox', ENV.teal, { s: [0.07, 0.014, 0.055], r: [0.2, 0.3, 0] });
  const rig = { root, parts, species: 'prop', kind: 'prop', pers: {}, version: 0, smear: 0, accessory: { index: 0, cycle: 0 }, setAccessory() {} };
  const handle = charBatch.register(rig, { kind: 'prop', colorIndex: 0, cycle: 0 });

  // the charging puck on the bar's east end (static; its own tiny rig in the same batch)
  const dParts: RigPart[] = [];
  const db = makeBuilder(dParts);
  const dRoot = new THREE.Object3D();
  db.part(dRoot, 'cyl', BRASS, { hull: true, s: [0.11, 0.024, 0.11], p: [0, 0.012, 0] });
  db.part(dRoot, 'cyl', CORE.ink2, { s: [0.08, 0.01, 0.08], p: [0, 0.026, 0] });
  const dLed = db.part(dRoot, 'glint', ENV.butter, { s: 0.012, p: [0, 0.02, 0.1], emissive: 1.3 });
  const dock = { root: dRoot, parts: dParts, species: 'prop', kind: 'prop', pers: {}, version: 0, smear: 0, accessory: { index: 0, cycle: 0 }, setAccessory() {} };
  dRoot.position.set(P.dock.x, barTop, P.dock.z);
  const dHandle = charBatch.register(dock, { kind: 'prop', colorIndex: 0, cycle: 0 });

  // ---- state -------------------------------------------------------------------------------------------------------
  const S = {
    pos: { x: P.dock.x, y: P.dock.y, z: P.dock.z }, vel: { x: 0, y: 0, z: 0 }, yaw: P.dock.yaw, t: 0,
    errand: 'rest' as Errand, last: null as string | null, steps: [{ k: 'perch', dur: 4 }] as Step[], step: null as Step | null, stepT: 0,
    cup: 0, cloth: 0, back: 0, wave: 0, reach: 0, happy: 0, hop: 0, spin: 0, sleep: 0, blinkT: 2, blink: 0, zAcc: 0,
    served: new Map<string, number>(), greetCd: 0, inCafT: 0, treatCd: 20, errands: 0, shots: 0, serves: 0, treats: 0,
    target: null, lookAt: null as Vec3 | null, faceYaw: null as number | null, lastP: { x: 0, z: 0 }, playerStillT: 0, customer: null as Customer | null,
  };
  const tmp = new THREE.Vector3();

  const playerInCafe = () => (player.level ?? 0) === 0 && inCafe(player.pos.x, player.pos.z);

  /** A waiting customer: an agent at a café coffee / table slot, Ada on her break, or the player at the bar. */
  function findCustomer(): Customer | null {
    const now = S.t;
    const cool = (id: string) => now - (S.served.get(id) ?? -1e9) > 75;
    for (const a of actors?.list?.() ?? []) {
      if (!a?.pos || !inCafe(a.pos.x, a.pos.z) || !cool(a.id)) continue;
      const s = coffeeSlots.find((q) => Math.hypot(q.pos.x - a.pos.x, q.pos.z - a.pos.z) < 0.45);
      if (!s) continue;
      if (a.moving) continue;
      return { id: a.id, get pos() { return a.pos; }, h: s.pose === 'sit' ? 0.62 : 0.95 };
    }
    const ada = d.peers?.ada;
    if (ada?.wantsCoffee?.() && cool('ada')) return { id: 'ada', get pos() { return ada.pos; }, h: 0.95 };
    if (playerInCafe() && cool('player')) {
      const at = coffeeSlots.find((q) => q.tag === 'coffee' && Math.hypot(q.pos.x - player.pos.x, q.pos.z - player.pos.z) < 0.9);
      if (at && S.playerStillT > 1.5) return { id: 'player', get pos() { return player.pos; }, h: 1.3 };
    }
    return null;
  }

  const hoverBeside = (c: Customer) => {
    // between the customer and the bar, a little to the side, at hand height
    const p = c.pos;
    const bx = bar.pos.x - p.x, bz = bar.pos.z - p.z, L = Math.hypot(bx, bz) || 1;
    const k = Math.min(0.5, L * 0.5);
    return { x: p.x + (bx / L) * k + (-bz / L) * 0.18, y: (p.y ?? 0) + c.h, z: p.z + (bz / L) * k + (bx / L) * 0.18 };
  };

  function plan(errand: Errand): Step[] {
    S.errand = errand; S.errands++;
    if (errand !== 'serve' && errand !== 'treat' && errand !== 'greet' && errand !== 'dock') S.last = errand;
    const shot: Step[] = [
      { k: 'fly', to: P.grinder }, { k: 'grind', dur: 1.8 },
      { k: 'fly', to: P.machine }, { k: 'pull', dur: 3.2 },
    ];
    switch (errand) {
      case 'dock': return [{ k: 'fly', to: P.dock }, { k: 'sleep', dur: 30 }];
      case 'rest': return [{ k: 'fly', to: P.dock }, { k: 'perch', dur: 10 + rand() * 12 }];
      case 'shot': return [...shot, { k: 'fly', to: P.front }, { k: 'tada', dur: 1.3 }, { k: 'sip', dur: 3 }, { k: 'fly', to: P.cups }, { k: 'drop', dur: 0.6 }];
      case 'polish': return [{ k: 'fly', to: P.cups }, { k: 'polish', dur: 5 + rand() * 4 }];
      case 'wipe': {
        const t = tables[Math.floor(rand() * tables.length)];
        return t ? [{ k: 'fly', to: { ...t, yaw: null } }, { k: 'wipe', dur: 5 + rand() * 3, c: t }] : [{ k: 'polish', dur: 5 }];
      }
      case 'plants': return [{ k: 'fly', to: pothos }, { k: 'water', dur: 5 }];
      case 'loop': return [{ k: 'fly', to: { ...P.front, y: P.front.y + 0.25, yaw: null } }, { k: 'loop', dur: 1.4 }, { k: 'tada', dur: 1 }];
      case 'serve': {
        const c = S.customer;
        if (!c) return [{ k: 'perch', dur: 5 }]; // unreachable: chooseErrand only picks 'serve' with a customer
        // a customer is waiting: skip the grinder, one quick pull, fly it over
        return [{ k: 'fly', to: P.machine }, { k: 'pull', dur: 2.4 }, { k: 'flyTo', who: c }, { k: 'offer', dur: 3.2, who: c }, { k: 'fly', to: P.front }];
      }
      case 'treat': {
        const cat = d.peers?.cat;
        return [{ k: 'fly', to: { ...pastry, yaw: null } }, { k: 'tsk', dur: 2.2, cat }, { k: 'crumb', dur: 2.4, cat }];
      }
      case 'greet': return [{ k: 'flyTo', who: { id: 'player', get pos() { return player.pos; }, h: 1.0, near: 2.2 } }, { k: 'hello', dur: 2.4 }, { k: 'loop', dur: 1.4 }];
      default: return [{ k: 'perch', dur: 5 }];
    }
  }

  function think(night: boolean) {
    S.customer = night ? null : findCustomer();
    const cat = d.peers?.cat;
    const catBegging = !!cat?.begging && S.treatCd <= 0;
    const greet = S.greetCd <= 0 && S.inCafT > 0.5 && S.inCafT < 8 && Math.hypot(player.pos.x - S.pos.x, player.pos.z - S.pos.z) < 9;
    const e = chooseErrand({ night, customer: S.customer, catBegging, greet, last: S.last }, rand);
    if (e === 'greet') S.greetCd = 90;
    if (e === 'treat') S.treatCd = 45;
    S.steps = plan(e);
    S.step = null;
  }

  // ---- flight --------------------------------------------------------------------------------------------------------
  /** fly toward `to` (cruising altitude while far); returns true on arrival */
  function fly(dt: number, to: Vec3, faceYaw: number | null | undefined) {
    const dx = to.x - S.pos.x, dz = to.z - S.pos.z, hd = Math.hypot(dx, dz);
    const ty = hd > 0.9 ? Math.max(to.y, BEAN_CRUISE) : to.y;
    const dy = ty - S.pos.y;
    const dist = Math.hypot(dx, dy, dz);
    const sp = Math.min(MAX_V, dist * 2.4);
    const k = dist > 1e-4 ? sp / dist : 0;
    // keep clear of the player's head
    let ax = 0, az = 0;
    const px = S.pos.x - player.pos.x, pz = S.pos.z - player.pos.z, pdd = Math.hypot(px, pz);
    if ((player.level ?? 0) === 0 && pdd < 0.55 && S.pos.y < (player.pos.y ?? 0) + 1.6) { ax = (px / (pdd || 1)) * 1.2; az = (pz / (pdd || 1)) * 1.2; }
    S.vel.x = damp(S.vel.x, dx * k + ax, 5, dt);
    S.vel.y = damp(S.vel.y, dy * Math.min(k, 2.5), 5, dt);
    S.vel.z = damp(S.vel.z, dz * k + az, 5, dt);
    S.pos.x += S.vel.x * dt; S.pos.y += S.vel.y * dt; S.pos.z += S.vel.z * dt;
    const hv = Math.hypot(S.vel.x, S.vel.z);
    S.faceYaw = faceYaw ?? null;
    if (hv > 0.35) S.yaw = dampAng(S.yaw, yawTo(S.vel.x, S.vel.z), 6, dt);
    else if (S.faceYaw !== null) S.yaw = dampAng(S.yaw, S.faceYaw, 6, dt);
    return dist < 0.05 && Math.hypot(S.vel.x, S.vel.y, S.vel.z) < 0.15;
  }
  const hold = (dt: number) => {
    S.vel.x = damp(S.vel.x, 0, 6, dt); S.vel.y = damp(S.vel.y, 0, 6, dt); S.vel.z = damp(S.vel.z, 0, 6, dt);
    if (S.faceYaw !== null) S.yaw = dampAng(S.yaw, S.faceYaw, 5, dt); // finish turning to the station's facing
  };

  // ---- update ------------------------------------------------------------------------------------------------------
  function update(c: AmbFrame, camera: THREE.Camera | null | undefined) {
    const dt = Math.min(c.dt, 0.1);
    S.t += dt;
    const night = c.hour >= 22 || c.hour < 7;
    S.greetCd -= dt; S.treatCd -= dt;
    const pic = playerInCafe();
    S.inCafT = pic ? S.inCafT + dt : 0;
    const pSpeed = Math.hypot(player.pos.x - S.lastP.x, player.pos.z - S.lastP.z) / Math.max(dt, 1e-3);
    S.lastP.x = player.pos.x; S.lastP.z = player.pos.z;
    S.playerStillT = pSpeed < 0.1 && pic ? (S.playerStillT ?? 0) + dt : 0;

    // a night fall or a customer interrupts an idle errand (never mid-serve)
    const idleErrand = S.errand in BEAN_ERRANDS;
    if (!S.step && !S.steps.length) think(night);
    else if (idleErrand && (night || (S.stepT > 0.5 && S.t % 1 < dt && (findCustomer() || (d.peers?.cat?.begging && S.treatCd <= 0))))) think(night);
    else if (S.errand === 'dock' && !night) think(false);
    if (!S.step) { S.step = S.steps.shift() ?? null; S.stepT = 0; }
    const st = S.step;
    let cup = 0, cloth = 0, reach = 0, wave = 0, happy = 0, hop = 0, sleep = 0, ooh = 0, shake = 0, back = 0;
    let armR: ArmPose | null = null, armL: ArmPose | null = null; // pivot pitch / spread overrides
    S.lookAt = null;
    if (st) {
      S.stepT += dt;
      const u = 'dur' in st && st.dur ? S.stepT / st.dur : 0;
      const done = () => { S.step = null; };
      switch (st.k) {
        case 'fly': { if (fly(dt, st.to, st.to.yaw) || S.stepT > 20) done(); cup = S.cup > 0.5 && S.errand !== 'rest' ? 1 : 0; break; }
        case 'flyTo': {
          const w = st.who;
          const to = w.near ? (() => { const p = w.pos; const ax = S.pos.x - p.x, az = S.pos.z - p.z, L = Math.hypot(ax, az) || 1; return { x: p.x + (ax / L) * w.near, y: (p.y ?? 0) + w.h, z: p.z + (az / L) * w.near }; })() : hoverBeside(w);
          const fy = yawTo(w.pos.x - S.pos.x, w.pos.z - S.pos.z);
          if (fly(dt, to, fy) || S.stepT > 14) done();
          cup = S.errand === 'serve' ? 1 : 0;
          break;
        }
        case 'perch': case 'sleep': {
          fly(dt, P.dock, P.dock.yaw);
          if (st.k === 'sleep') { sleep = 1; if (night && S.stepT > st.dur) S.stepT = 0; }
          else if (S.stepT > st.dur) done();
          break;
        }
        case 'grind': { hold(dt); shake = 1; reach = 0.6; back = 1; if (S.stepT > st.dur) done(); break; }
        case 'pull': {
          hold(dt); reach = 1; back = 1; ooh = u > 0.35 && u < 0.7 ? 1 : 0;
          if (!st.pssht && u > 0.35) {
            st.pssht = true; S.shots++;
            if (fx?.burst && camera && camera.position.distanceTo(tmp.set(S.pos.x, S.pos.y, S.pos.z)) < 18) {
              const m = onBar(-0.95, 0.12, barTop + 0.14);
              for (let i = 0; i < 6; i++) fx.burst('steam', { x: m.x + (rand() - 0.5) * 0.08, y: m.y, z: m.z + (rand() - 0.5) * 0.08 });
            }
            d.bus?.emit?.('amb.bean', { ev: 'pssht', pos: { ...S.pos } });
          }
          if (u > 0.75) S.cup = 1;
          cup = S.cup;
          if (S.stepT > st.dur) done();
          break;
        }
        case 'tada': {
          hold(dt); cup = S.cup; happy = 1; hop = Math.sin(clamp(u, 0, 1) * Math.PI);
          armR = { x: -2.4, z: 0.2 };
          if (!st.sp && u > 0.3) { st.sp = true; fx?.burst?.('sparkle', { x: S.pos.x, y: S.pos.y + 0.35, z: S.pos.z }, { count: 8 }); d.bus?.emit?.('amb.bean', { ev: 'ding', pos: { ...S.pos } }); }
          if (S.stepT > st.dur) done();
          break;
        }
        case 'sip': { hold(dt); cup = 1; const lift = Math.sin(clamp(u, 0, 1) * Math.PI); armR = { x: -1.2 - 1.3 * lift, z: 0.9 * lift }; happy = u > 0.45 ? 1 : 0; if (S.stepT > st.dur) { done(); S.cup = 0.6; } break; }
        case 'drop': { hold(dt); reach = 1 - u; if (S.stepT > st.dur) { S.cup = 0; done(); } break; }
        case 'polish': {
          hold(dt); cup = 1; cloth = 1; S.cup = 0;
          armR = { x: -1.1, z: 0.35 }; armL = { x: -1.1 + 0.3 * Math.sin(S.t * 9), z: -0.5 + 0.3 * Math.cos(S.t * 9) };
          if (S.stepT > st.dur) done();
          break;
        }
        case 'wipe': {
          const a = S.stepT * 3.2;
          fly(dt, { x: st.c.x + Math.sin(a) * 0.2, y: st.c.y + 0.02 * Math.sin(a * 2), z: st.c.z + Math.cos(a) * 0.2 }, null);
          cloth = 1; armL = { x: -1.6, z: -0.2 };
          S.yaw += dt * 0.8;
          if (S.stepT > st.dur) done();
          break;
        }
        case 'water': {
          hold(dt); reach = 0.9; cup = 1; happy = u > 0.5 ? 1 : 0;
          armR = { x: -2.0, z: 0.2 };
          if (Math.floor(S.stepT * 3) !== Math.floor((S.stepT - dt) * 3)) {
            const h = arms[1].hand.getWorldPosition(tmp);
            fx?.burst?.('drop', { x: h.x + 0.04, y: h.y, z: h.z }, { floor: h.y - 1.1 });
          }
          if (S.stepT > st.dur) done();
          break;
        }
        case 'loop': { // a joyful barrel roll
          hold(dt); happy = 1; S.spin = smooth01(u) * TAU;
          if (S.stepT > st.dur) { S.spin = 0; done(); }
          break;
        }
        case 'offer': {
          hold(dt); cup = 1; happy = 1; reach = 1;
          const p = st.who.pos;
          S.faceYaw = yawTo(p.x - S.pos.x, p.z - S.pos.z);
          S.lookAt = { x: p.x, y: (p.y ?? 0) + (st.who.id === 'player' ? 1.2 : 0.6), z: p.z };
          if (!st.given && u > 0.55) {
            st.given = true; S.served.set(st.who.id, S.t); S.serves++;
            fx?.burst?.('sparkle', { x: S.pos.x, y: S.pos.y + 0.3, z: S.pos.z }, { count: 6 });
            if (st.who.id === 'ada') d.peers?.ada?.served?.();
            d.bus?.emit?.('amb.bean', { ev: 'serve', who: st.who.id });
          }
          if (st.given) { cup = 0; S.cup = 0; wave = 1; }
          if (S.stepT > st.dur) done();
          break;
        }
        case 'tsk': { // wag a finger at the begging cat
          hold(dt);
          const cp = st.cat?.pos;
          if (cp) { S.faceYaw = yawTo(cp.x - S.pos.x, cp.z - S.pos.z); S.lookAt = { x: cp.x, y: cp.y + 0.2, z: cp.z }; }
          armR = { x: -2.6, z: 0.15 + 0.35 * Math.sin(S.t * 14) }; shake = 0.4;
          if (S.stepT > st.dur) done();
          break;
        }
        case 'crumb': {
          hold(dt); happy = 1; reach = 0.6;
          const cp = st.cat?.pos;
          if (cp) S.lookAt = { x: cp.x, y: cp.y + 0.2, z: cp.z };
          if (!st.dropped && u > 0.3) {
            st.dropped = true; S.treats++;
            const h = arms[1].hand.getWorldPosition(tmp);
            fx?.burst?.('sparkle', { x: h.x, y: h.y, z: h.z }, { count: 5 });
            st.cat?.treat?.();
          }
          if (S.stepT > st.dur) done();
          break;
        }
        case 'hello': {
          hold(dt); happy = 1; wave = 1;
          S.faceYaw = yawTo(player.pos.x - S.pos.x, player.pos.z - S.pos.z);
          S.lookAt = { x: player.pos.x, y: (player.pos.y ?? 0) + 1.2, z: player.pos.z };
          if (!st.said) { st.said = true; d.bus?.emit?.('amb.bean', { ev: 'hello', pos: { ...S.pos } }); }
          if (S.stepT > st.dur) done();
          break;
        }
        default: done();
      }
    } else hold(dt);

    // ---- place + pose --------------------------------------------------------------------------------------------
    root.position.set(S.pos.x, S.pos.y, S.pos.z);
    root.rotation.y = S.yaw;
    const far = camera ? camera.position.distanceTo(tmp.set(S.pos.x, S.pos.y, S.pos.z)) : 0;
    const vis = far < 30;
    handle.setVisible(vis);
    dHandle.setVisible(far < 30);
    if (!vis) return;
    const t = S.t;
    const damped = (key: 'sleep' | 'happy' | 'wave' | 'reach' | 'hop' | 'cloth' | 'back', v: number, k = 8) => (S[key] = damp(S[key], v, k, dt));
    damped('sleep', sleep, 2); damped('happy', happy, 8); damped('wave', wave, 6); damped('reach', reach, 6); damped('hop', hop, 12);
    damped('cloth', cloth, 10); damped('back', back, 10);
    const hv = Math.hypot(S.vel.x, S.vel.z);
    // bob + bank + pitch into the flight, squash on the hop; perched: sits still, breathes
    const perched = st && (st.k === 'perch' || st.k === 'sleep') && Math.hypot(S.pos.x - P.dock.x, S.pos.y - P.dock.y, S.pos.z - P.dock.z) < 0.08;
    const bob = perched ? 0 : 0.025 * Math.sin(t * 3.1) + 0.012 * Math.sin(t * 7.3);
    bodyN.position.set(0, bob + S.hop * 0.07, 0);
    const fwd = Math.sin(S.yaw) * S.vel.x + Math.cos(S.yaw) * S.vel.z;
    const lat = Math.cos(S.yaw) * S.vel.x - Math.sin(S.yaw) * S.vel.z;
    bodyN.rotation.set(clamp(fwd * 0.22, -0.4, 0.4) + (shake ? 0.04 * Math.sin(t * 40) * shake : 0), 0, clamp(-lat * 0.3, -0.5, 0.5) + S.spin);
    const sq = S.hop * 0.12 + (perched ? 0.02 * Math.sin(t * 1.8) : 0);
    bodyN.scale.set((1 + sq * 0.5) * BEAN_SCALE, (1 - sq * 0.4 + S.hop * 0.18) * BEAN_SCALE, (1 + sq * 0.5) * BEAN_SCALE);
    // wings: fast flap in flight, lazy when hovering, folded when perched / asleep
    const flapHz = perched ? 0 : 7 + hv * 5;
    for (const w of wings) {
      const s = w === wings[0] ? -1 : 1;
      const fl = perched ? -0.35 : 0.55 * Math.sin(t * TAU * flapHz * 0.5);
      w.rotation.z = s * (fl + 0.15);
      w.rotation.y = s * -0.25;
    }
    // arms
    for (const a of arms) {
      const right = a.s > 0;
      let px = -0.25 + 0.15 * Math.sin(t * 2 + a.s), pz = a.s * (0.25 + 0.15 * hv); // idle: hang, drift back in flight
      if (S.reach > 0.01 && right) px = px * (1 - S.reach) + (S.back > 0.5 ? 1.25 + 0.15 * Math.sin(t * 5) : -1.45) * S.reach;
      if (S.wave > 0.01 && !right) { px = px * (1 - S.wave) + -2.8 * S.wave; pz = pz * (1 - S.wave) + (-0.3 + 0.45 * Math.sin(t * 12)) * S.wave; }
      if (right && armR) { px = armR.x; pz = armR.z; }
      if (!right && armL) { px = armL.x; pz = armL.z; }
      if (S.sleep > 0.5) { px = -0.1; pz = a.s * 0.15; }
      a.pivot.rotation.x = damp(a.pivot.rotation.x, px, 14, dt);
      a.pivot.rotation.z = damp(a.pivot.rotation.z, pz, 14, dt);
    }
    cupN.visible = Math.max(cup, S.errand === 'polish' && st?.k === 'polish' ? 1 : 0) > 0.5;
    clothN.visible = S.cloth > 0.5;
    // face: blink, happy ^^, asleep —, "ooh" on the pull
    S.blinkT -= dt;
    if (S.blinkT < 0) { S.blink = 0.13; S.blinkT = 2 + Math.random() * 3.5; }
    S.blink = Math.max(0, S.blink - dt);
    const isHappy = S.happy > 0.5 && S.sleep < 0.5;
    for (const e of eyes) { e.visible = !isHappy; e.scale.y = S.sleep > 0.5 ? 0.08 : S.blink > 0 ? 0.1 : 0.48; }
    for (const e of happyEyes) e.visible = isHappy;
    for (const g of glints) g.visible = !isHappy && S.sleep < 0.5 && S.blink <= 0;
    smile.visible = !ooh && S.sleep < 0.5;
    oohMouth.visible = !!ooh;
    // head-look: tilt the face toward the target a touch
    if (S.lookAt) {
      const dy = S.lookAt.y - (S.pos.y + 0.15), dd = Math.hypot(S.lookAt.x - S.pos.x, S.lookAt.z - S.pos.z);
      face.rotation.x = clamp(-Math.atan2(dy, dd) * 0.35, -0.25, 0.25);
    } else face.rotation.x = damp(face.rotation.x, 0, 4, dt);
    // floor contact shadow under the hover
    const fy = layout.floorY(S.pos.x, S.pos.z, 0);
    const onCounter = Math.abs(S.pos.x - P.dock.x) < 2.3 && Math.abs(S.pos.z - barZ) < 0.35;
    const below = onCounter ? barTop : fy;
    blobN.position.y = below + 0.004 - S.pos.y;
    blobN.scale.setScalar(clamp(1.1 - (S.pos.y - below) * 0.4, 0.45, 1.1));
    // sleep Z's + dock LED breathing
    if (S.sleep > 0.5) {
      S.zAcc += dt;
      if (S.zAcc > 2 && far < 16) { S.zAcc = 0; fx?.burst?.('zzz', { x: S.pos.x + 0.06, y: S.pos.y + 0.3, z: S.pos.z }); }
    }
    dLed.scale.setScalar(0.012 * (perched ? 0.7 + 0.3 * Math.sin(t * 1.6) : 0.4));
  }

  return {
    update,
    get pos() { return { ...S.pos }; },
    debug: () => ({ errand: S.errand, step: S.step?.k ?? null, x: +S.pos.x.toFixed(2), y: +S.pos.y.toFixed(2), z: +S.pos.z.toFixed(2), shots: S.shots, serves: S.serves, treats: S.treats, errands: S.errands }),
    /** debug / shots: force an errand ('shot' | 'polish' | 'wipe' | 'plants' | 'rest' | 'loop' | 'greet' | 'treat' | 'dock') */
    force(id?: string) {
      if (id === undefined || !(id in BEAN_ERRANDS) && !['greet', 'treat', 'dock'].includes(id)) return false;
      S.steps = plan(id as Errand); S.step = null; return true;
    },
    teleport(x: number, z: number, y = 1.3, yaw = 0) { S.pos.x = x; S.pos.z = z; S.pos.y = y; S.yaw = yaw; S.vel.x = S.vel.y = S.vel.z = 0; },
    dispose() { handle.remove(); dHandle.remove(); },
  };
}
