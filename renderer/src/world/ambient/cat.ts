/**
 * Segfault, the office cat (GP §3.4, DESIGN §6.4.1 / §7.4 / §11 M3 AMB). Visibly ambient: no nameplate, no ring.
 * - Naps on top of the **hottest** rack column (per-thread load EMA → the 16-column rack wall) and pads along the rack top
 *   to a new column when the heat moves (§7.4 CPU-temp row: "the cat moves to the hottest rack").
 * - Hops onto an **idle** agent's desk and loafs on the keyboard (hops off at once if that agent stops being idle, P6).
 * - Follows the player once they stand still for 5 s nearby; sits at their feet and looks up.
 * - Naps by the Archive vault door, stares at the fish tank, grooms by Ada's desk.
 * - Q (hold) while looking at it: purr + hearts. Walking into it: startle hop.
 * Draws through charBatch (catRig.ts). Owner: AMB.
 */
import * as THREE from 'three';
import { createCatRig, CAT_LEG, TAIL_SEGS } from './catRig.ts';
import { createWalker, furniture, slotById, W, TAU, clamp, damp, dampAng, angDiff, yawTo, smooth01 } from './util.ts';
import { local2world } from '../layout/schema.ts';
import type { AmbDeps, AmbFrame, Vec2, Vec3 } from './util.ts';
import type { Furniture, Slot } from '../layout/schema.ts';
import type { AmbActor } from './util.ts';

/** STAT's rack wall is 4 cabinets (world/stats/rack.ts): threads split evenly, left → right. */
export const RACK_CABS = 4;
export const CAT_SCALE = 1.2;

/**
 * Cabinet of the rack wall with the hottest threads (pure). `ema` is a per-thread smoothed load (0–100); the current
 * cabinet is kept unless another's summed load beats it by `hyst` points (no ping-pong between near-equal cabinets).
 */
export function hottestCabinet(ema: number[] | null, cur: number, hyst = 25): number {
  if (!ema || !ema.length) return cur;
  const n = ema.length, per = Math.max(1, Math.floor(n / RACK_CABS));
  const load = (k: number) => { let s = 0; for (let i = k * per; i < (k + 1) * per && i < n; i++) s += ema[i]; return s; };
  let best = cur, bestV = load(cur);
  for (let k = 0; k < RACK_CABS; k++) { const v = load(k); if (v > bestV + hyst) { best = k; bestV = v; } }
  return best;
}

/** Places the cat visits (each exists only when the layout has it). */
type PlaceId = 'fish' | 'vault' | 'ada' | 'pit' | 'sill' | 'pastry';
/** What the cat is doing: a place, the special plans, or the interrupt modes. */
type CatMode = PlaceId | 'rack' | 'keyboard' | 'follow' | 'startle' | 'sit';

/** One step of a plan (discriminated on `k`); the optional numbers/flags are per-step scratch state. */
type Step =
  | { k: 'walk'; to: Vec2; run?: boolean }
  | { k: 'pad'; to: Vec3 }
  | { k: 'jump'; to: Vec3; down?: boolean; big?: boolean }
  | { k: 'face'; yaw: number }
  | { k: 'faceAt'; at?: Vec2 }
  | { k: 'sit'; dur: number; bat?: boolean; lookAt?: 'player' | Vec2 }
  | { k: 'beg'; dur: number; lookAt?: Vec3; meowT?: number; fed?: boolean }
  | { k: 'groom' | 'stretch'; dur: number }
  | { k: 'nap'; dur: number; rack?: boolean }
  | { k: 'loaf'; dur: number; watch: string }
  | { k: 'follow'; dur: number; reT?: number };

interface Jump { from: Vec3; to: Vec3; T: number; crouch: number; apex: number; yaw: number; t: number }

interface CatState {
  mode: CatMode;
  t: number;
  dur: number;
  plan: Step[];
  step: Step | null;
  stepT: number;
  /** height of the surface the cat is on (rack top, desk, sill); null = on the floor */
  perchY: number | null;
  jump: Jump | null;
  look: Vec3 | null;
  sitW: number;
  curlW: number;
  loafW: number;
  lidW: number;
  phase: number;
  blinkT: number;
  blink: number;
  purr: number;
  purrT: number;
  startle: number;
  zAcc: number;
  yawOff: number;
  groom: number;
  bat: number;
  treatT: number;
  hour: number;
  rackCol: number;
  /** cabinet STAT reports as the hot spot (bus 'stats.hotSpot'), when it does */
  hotCab?: number;
  rackEma: number[] | null;
  hotSince: number;
  keyboardId: string | null;
  followT: number;
  followCd: number;
  stillT: number;
  lastP: { x: number; z: number };
  noticeRoll: number;
  thinkCd: number;
  lastPlace: string;
  meowCd: number;
  ridesRoomba: boolean;
  /** where to hop down to when leaving the current perch */
  downTo?: Vec2;
}

export function createCat(d: Pick<AmbDeps, 'layout' | 'nav' | 'charBatch' | 'fx' | 'actors' | 'player' | 'store' | 'rand' | 'bus' | 'peers'>) {
  const { layout, nav, charBatch, fx, actors, player, store, rand } = d;
  const rig = createCatRig();
  rig.root.scale.setScalar(CAT_SCALE); // toy-scale exaggeration: reads at 8 m next to 0.7 m agents
  const handle = charBatch.register(rig, { kind: 'cat', colorIndex: 0, cycle: 0 });
  const N = rig.n;

  // ---- places ------------------------------------------------------------------------------------------------------
  const rackF = furniture(layout, 'rackWall');
  const rackFloor = rackF ? layout.floorY(rackF.pos.x, rackF.pos.z, 0) : 0;
  // cabinet i: the cat naps on the rack top beside that cabinet's (warm) cooling fan, facing the room
  const rackCol = (i: number) => {
    if (!rackF) return null;
    const [w, h, dd] = rackF.size;
    const lx = -w / 2 + ((i + 0.5) * w) / RACK_CABS + 0.55;
    const top = local2world(rackF.pos, rackF.yaw, lx, dd / 2 - 0.1), front = local2world(rackF.pos, rackF.yaw, lx - 0.3, dd / 2 + 0.75);
    return { top: { x: top.x, y: rackFloor + Math.max(h, 2.5), z: top.z }, front, yaw: rackF.yaw };
  };
  /** world point (e.g. STAT's 'stats.hotSpot') → cabinet index */
  const cabinetAt = (x: number, z: number) => {
    if (!rackF) return 0;
    const cs = Math.cos(rackF.yaw), sn = Math.sin(rackF.yaw);
    const dx = x - rackF.pos.x, dz = z - rackF.pos.z;
    const lx = dx * cs - dz * sn;
    return Math.max(0, Math.min(RACK_CABS - 1, Math.floor(((lx + rackF.size[0] / 2) / rackF.size[0]) * RACK_CABS)));
  };
    const fishSlot = slotById(layout, 'slot:fish:0') ?? (layout.slots ?? []).find((s) => s.tag === 'fish');
  const vault = furniture(layout, 'vaultDoor');
  // Café: ENV's game cubbies (0.8 m top) under the east window and the pastry case at the bar's east end (plan coords;
  // build/zones/cafe.ts places both as dressing, so they are not layout furniture)
  const cubbies = layout.zoneAt?.(W(41.74, 24.5).x, W(41.74, 24.5).z, 0) === 'CAF' ? { top: { ...W(41.74, 24.45), y: layout.floorY(W(41.74, 24.45).x, W(41.74, 24.45).z, 0) + 0.8 }, floor: W(41.05, 24.45) } : null;
  const sillSpot = (c: { floor: Vec2; top: Vec3 }) => ({ x: c.floor.x, z: c.floor.z, top: c.top });
  const pastryF = layout.zoneAt?.(W(38.05, 26.95).x, W(38.05, 26.95).z, 0) === 'CAF' ? { pos: W(38.05, 26.95), yaw: -Math.PI / 2 } : null;
  const PLACES = {
    fish: fishSlot ? { x: fishSlot.pos.x - 0.55, z: fishSlot.pos.z + 0.05, look: layout.points?.fishTank } : null,
    vault: vault ? { ...local2world(vault.pos, vault.yaw, 0.95, 0.55) } : null,
    ada: layout.points?.staffMat ? { x: layout.points.staffMat.x - 0.45, z: layout.points.staffMat.z + 0.95 } : null, // at Ada's feet, in view of the spawn
    pit: layout.points?.pitCenter ? { x: layout.points.pitCenter.x + 2.2, z: layout.points.pitCenter.z + 3.4 } : null,
    // [AMB fix m2 r2] Café life: a sunny nap on the game cubbies under the east window, begging at the pastry case
    sill: cubbies ? sillSpot(cubbies) : null,
    pastry: pastryF ? { ...W(38.05, 25.78), look: { x: pastryF.pos.x, y: 1.25, z: pastryF.pos.z } } : null,
  };

  // ---- state -------------------------------------------------------------------------------------------------------
  const start = PLACES.ada ?? { x: layout.spawn?.[0] ?? 0, z: (layout.spawn?.[2] ?? 0) - 2 };
  const walker = createWalker(nav, layout, start, { speed: 0.85, turn: 8 });
  walker.yaw = 0.6;
  const S: CatState = {
    mode: 'ada', t: 0, dur: 30, plan: [{ k: 'groom', dur: 7 }, { k: 'sit', dur: 30 }], step: null, stepT: 0,
    perchY: null, jump: null, look: null, sitW: 1, curlW: 0, loafW: 0, lidW: 0,
    phase: 0, blinkT: 2, blink: 0, purr: 0, purrT: 0, startle: 0, zAcc: 0, yawOff: 0, groom: 0, bat: 0,
    treatT: 0, hour: 13, rackCol: 1, rackEma: null, hotSince: 0, keyboardId: null, followT: 0, followCd: 8,
    stillT: 0, lastP: { x: 0, z: 0 }, noticeRoll: 1, thinkCd: 0, lastPlace: 'ada', meowCd: 8, ridesRoomba: false,
  };
  const tmp = new THREE.Vector3();
  // STAT publishes the hottest cabinet (world/stats/rack.ts, 'stats.hotSpot'); fall back to our own thread EMA
  const offHot = d.bus?.on?.('stats.hotSpot', (h) => { if (h && Number.isFinite(h.x)) S.hotCab = cabinetAt(h.x, h.z); });

  const pos = () => ({ x: walker.pos.x, y: S.perchY ?? walker.pos.y, z: walker.pos.z });
  const playerDist = () => Math.hypot(player.pos.x - walker.pos.x, player.pos.z - walker.pos.z);

  // ---- plans -------------------------------------------------------------------------------------------------------
  const setPlan = (steps: Step[], mode: CatMode) => { S.plan = steps; S.step = null; S.mode = mode; S.t = 0; };
  const nextStep = () => {
    S.step = S.plan.shift() ?? null; S.stepT = 0;
    if (!S.step) return;
    const st = S.step;
    if (st.k === 'walk') { S.perchY = null; walker.speed = st.run ? 1.9 : 0.85; walker.go(st.to); }
    if (st.k === 'jump') {
      const p = pos();
      const to = st.to;
      const dy = to.y - p.y, dist = Math.hypot(to.x - p.x, to.z - p.z);
      S.jump = { t: 0, from: p, to, T: 0.32 + 0.1 * Math.sqrt(Math.abs(dy) + dist), crouch: 0.28, apex: Math.max(0.18, dy + 0.3), yaw: yawTo(to.x - p.x, to.z - p.z) };
      if (dist < 0.05) S.jump.yaw = walker.yaw;
      walker.stop();
    }
  };

  const jumpUpTo = (floorPt: Vec2, top: Vec3): Step[] => [{ k: 'walk', to: floorPt }, { k: 'face', yaw: yawTo(top.x - floorPt.x, top.z - floorPt.z) }, { k: 'jump', to: top }];
  const jumpDownIfPerched = (): Step[] => {
    if (S.perchY === null) return [];
    // hop down in front of where we sit (toward the room)
    const p = pos();
    const out = S.downTo ?? { x: p.x + Math.sin(walker.yaw) * 0.6, z: p.z + Math.cos(walker.yaw) * 0.6 };
    return [{ k: 'jump', to: { x: out.x, y: layout.floorY(out.x, out.z, 0), z: out.z }, down: true }];
  };

  function keyboardCandidate() {
    let best: { a: AmbActor; s: Slot; f: Furniture } | null = null, bestD = 1e9;
    for (const a of actors?.list?.() ?? []) {
      const e = a.entity;
      if (!e || (e.status !== 'idle' && e.status !== 'done') || !a.lite?.seated) continue;
      const s = a.slotRef;
      if (!s || s.tag !== 'desk' || s.anchor === undefined) continue;
      const f = furniture(layout, s.anchor);
      if (!f) continue;
      const dd = Math.hypot(a.pos.x - walker.pos.x, a.pos.z - walker.pos.z);
      if (dd < bestD && dd < 34) { bestD = dd; best = { a, s, f }; }
    }
    return best;
  }
  function keyboardPlan(c: { a: AmbActor; s: Slot; f: Furniture }): Step[] {
    const { a, s, f } = c;
    const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const dx = s.pos.x - f.pos.x, dz = s.pos.z - f.pos.z;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const side = Math.sign(lz) || 1;
    const top = local2world(f.pos, f.yaw, lx, side * (f.size[2] / 2 - 0.27)); // between the keyboard and the monitor
    const y = layout.floorY(f.pos.x, f.pos.z, 0) + f.size[1] + 0.005;
    const sideX = rand() < 0.5 ? -1 : 1;
    const app = local2world(f.pos, f.yaw, lx + sideX * 0.55, side * (f.size[2] / 2 + 0.22));
    const down = jumpDownIfPerched();
    S.downTo = app;
    S.keyboardId = a.id;
    const faceYaw = yawTo(a.pos.x - top.x, a.pos.z - top.z);
    return [...down, ...jumpUpTo(app, { x: top.x, y, z: top.z }), { k: 'face', yaw: faceYaw }, { k: 'loaf', dur: 30 + rand() * 40, watch: a.id }];
  }
  function rackPlan(): Step[] | null {
    const c = rackCol(S.rackCol);
    if (!c) return null;
    const down = jumpDownIfPerched();
    S.downTo = c.front;
    return [...down, { k: 'walk', to: c.front }, { k: 'face', yaw: yawTo(c.top.x - c.front.x, c.top.z - c.front.z) },
      { k: 'sit', dur: 0.6 }, { k: 'jump', to: c.top, big: true }, { k: 'face', yaw: c.yaw + (rand() < 0.5 ? 0.5 : -0.5) },
      { k: 'stretch', dur: 1.6 }, { k: 'nap', dur: 90 + rand() * 150, rack: true }];
  }

  type Place<K extends PlaceId> = NonNullable<(typeof PLACES)[K]>;
  const PLAN: { [K in PlaceId]: (p: Place<K>) => Step[] } = {
    fish: (p) => [...jumpDownIfPerched(), { k: 'walk', to: p }, { k: 'faceAt', at: p.look }, { k: 'sit', dur: 25 + rand() * 25, bat: true, lookAt: p.look }],
    vault: (p) => [...jumpDownIfPerched(), { k: 'walk', to: p }, { k: 'face', yaw: rand() * TAU }, { k: 'nap', dur: 60 + rand() * 90 }],
    ada: (p) => [...jumpDownIfPerched(), { k: 'walk', to: p }, { k: 'face', yaw: 0.9 }, { k: 'groom', dur: 8 + rand() * 6 }, { k: 'sit', dur: 15 + rand() * 20 }],
    pit: (p) => [...jumpDownIfPerched(), { k: 'walk', to: p }, { k: 'stretch', dur: 1.6 }, { k: 'nap', dur: 40 + rand() * 60 }],
    sill: (c) => {
      S.downTo = { x: c.x, z: c.z };
      return [...jumpDownIfPerched(), ...jumpUpTo({ x: c.x, z: c.z }, c.top), { k: 'face', yaw: yawTo(-1, 0.35) },
        { k: 'sit', dur: 4 + rand() * 4, lookAt: { x: c.top.x + 3, z: c.top.z } }, { k: 'stretch', dur: 1.6 }, { k: 'nap', dur: 70 + rand() * 90 }];
    },
    pastry: (p) => [...jumpDownIfPerched(), { k: 'walk', to: p }, { k: 'faceAt', at: p.look },
      { k: 'beg', dur: 22 + rand() * 18 }, { k: 'groom', dur: 5 + rand() * 4 }],
  };
  const isPlaceId = (id: string): id is PlaceId => Object.hasOwn(PLACES, id);
  /** the plan for a place, or null when the layout has no such place */
  const planFor = (id: PlaceId): Step[] | null => {
    switch (id) {
      case 'fish': return PLACES.fish ? PLAN.fish(PLACES.fish) : null;
      case 'vault': return PLACES.vault ? PLAN.vault(PLACES.vault) : null;
      case 'ada': return PLACES.ada ? PLAN.ada(PLACES.ada) : null;
      case 'pit': return PLACES.pit ? PLAN.pit(PLACES.pit) : null;
      case 'sill': return PLACES.sill ? PLAN.sill(PLACES.sill) : null;
      case 'pastry': return PLACES.pastry ? PLAN.pastry(PLACES.pastry) : null;
    }
  };
  interface Option { w: number; id: CatMode; fn: () => Step[] | null }
  function think() {
    S.keyboardId = null;
    const opts: Option[] = [];
    const add = (w: number, id: CatMode, fn: () => Step[] | null, at: Vec2 | undefined) => {
      if (!at && id !== 'keyboard') return;
      const dd = at ? Math.hypot(at.x - walker.pos.x, at.z - walker.pos.z) : 10;
      opts.push({ w: (w / (1 + dd / 18)) * (id === S.lastPlace ? 0.25 : 1), id, fn });
    };
    const rc = rackCol(S.rackCol);
    add(3.2, 'rack', rackPlan, rc?.front);
    const kb = keyboardCandidate();
    if (kb) opts.push({ w: 2.4, id: 'keyboard', fn: () => keyboardPlan(kb) });
    if (PLACES.fish) add(1.4, 'fish', () => planFor('fish'), PLACES.fish);
    if (PLACES.vault) add(1.0, 'vault', () => planFor('vault'), PLACES.vault);
    if (PLACES.ada) add(1.0, 'ada', () => planFor('ada'), PLACES.ada);
    if (PLACES.pit) add(0.8, 'pit', () => planFor('pit'), PLACES.pit);
    const sunny = (S.hour ?? 13) >= 8 && (S.hour ?? 13) < 18;
    if (PLACES.sill) add(sunny ? 1.3 : 0.8, 'sill', () => planFor('sill'), PLACES.sill);
    if (PLACES.pastry) add(1.0, 'pastry', () => planFor('pastry'), PLACES.pastry);
    let sum = 0; for (const o of opts) sum += o.w;
    let r = rand() * sum, pick: Option | undefined = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    const plan = pick?.fn();
    if (!plan || !pick) { setPlan([{ k: 'sit', dur: 10 }], 'sit'); return; }
    S.lastPlace = pick.id;
    setPlan(plan, pick.id);
  }

  // ---- stats → hottest rack ----------------------------------------------------------------------------------------
  let lastStats: unknown = null;
  function readHeat(dt: number) {
    const st = store?.stats;
    const cores = st?.cpu?.cores;
    if (!Array.isArray(cores) || !cores.length) return;
    if (st !== lastStats) {
      lastStats = st;
      if (!S.rackEma || S.rackEma.length !== cores.length) S.rackEma = cores.slice();
      else for (let i = 0; i < cores.length; i++) S.rackEma[i] += (cores[i] - S.rackEma[i]) * 0.08; // ~12 samples
    }
    const want = S.hotCab ?? hottestCabinet(S.rackEma, S.rackCol);
    if (want !== S.rackCol) {
      S.hotSince += dt;
      if (S.hotSince > 15) {
        S.hotSince = 0;
        const onRack = S.mode === 'rack' && S.perchY !== null;
        S.rackCol = want;
        if (onRack) {
          // pad along the rack top to the hotter column, then curl up again
          const c = rackCol(want);
          if (c) setPlan([{ k: 'stretch', dur: 1.4 }, { k: 'pad', to: c.top }, { k: 'face', yaw: c.yaw + 0.5 }, { k: 'nap', dur: 90 + rand() * 120, rack: true }], 'rack');
        }
      }
    } else S.hotSince = 0;
  }

  // ---- input: pat (Q hold while looking at the cat) ----------------------------------------------------------------
  let qHeld = false;
  const typing = (ev: KeyboardEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return false;
    return (t instanceof HTMLElement && t.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.xterm, .hq-drawer');
  };
  const onKey = (ev: KeyboardEvent) => { if (ev.code === 'KeyQ' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !typing(ev)) qHeld = ev.type === 'keydown'; };
  const onBlur = () => { qHeld = false; };
  if (typeof window !== 'undefined') { addEventListener('keydown', onKey); addEventListener('keyup', onKey); addEventListener('blur', onBlur); }
  const aimedAt = (camera: THREE.Camera | null | undefined) => {
    if (!camera) return false;
    const p = pos();
    tmp.set(p.x, p.y + 0.22, p.z).sub(camera.position);
    const dist = tmp.length();
    if (dist > 2.4) return false;
    tmp.normalize();
    const f = new THREE.Vector3(); camera.getWorldDirection(f);
    return f.dot(tmp) > Math.cos(0.3);
  };

  // ---- pose --------------------------------------------------------------------------------------------------------
  function pose(dt: number, t: number, speed: number) {
    const n = N;
    const sit = S.sitW, curl = S.curlW, loaf = S.loafW;
    const walkK = clamp(speed / 0.7, 0, 1);
    S.phase += dt * (4 + speed * 9);
    const ph = S.phase;
    const jmp = S.jump;
    const air = jmp && jmp.t > jmp.crouch ? 1 : 0;
    const crouch = jmp && jmp.t <= jmp.crouch ? smooth01(jmp.t / jmp.crouch) : 0;
    const breathe = Math.sin(t * TAU * 0.28) * 0.5 + 0.5;
    const purr = S.purr;
    // hips
    const low = Math.max(curl, loaf);
    n.hips.position.y = CAT_LEG - 0.035 * sit - 0.065 * low - 0.04 * crouch + Math.abs(Math.sin(ph)) * 0.01 * walkK + Math.sin(t * 40) * 0.002 * purr;
    n.hips.rotation.x = -0.62 * sit * (1 - low) + (jmp && air ? -0.25 * Math.sign(jmp.to.y - jmp.from.y) : 0) + 0.12 * crouch;
    n.hips.rotation.z = Math.sin(ph * 0.5) * 0.03 * walkK;
    n.torso.scale.set(1 + 0.04 * curl + 0.02 * breathe * low, 1 - 0.12 * curl + 0.03 * breathe * low, 1 + 0.25 * air - 0.08 * crouch);
    // legs: trot swing (diagonal pairs) / sit / tuck
    for (let i = 0; i < 4; i++) {
      const lg = n.legs[i];
      const pair = i === 0 || i === 3 ? 0 : Math.PI;
      const swing = Math.sin(ph + pair) * 0.6 * walkK;
      const front = i < 2;
      let rx = -swing;
      if (front) rx += 0.62 * sit * (1 - low) - (S.bat && i === 1 ? S.bat * 1.6 : 0);
      else rx += -1.35 * sit;
      rx = rx * (1 - low) + -1.45 * low;
      if (air) rx = front ? -0.9 : 0.9;
      lg.rotation.x = rx;
      lg.scale.y = front ? 1 + 0.18 * sit * (1 - low) : 1;
    }
    // head / neck: look target, curl tucks it, groom licks the paw
    let hy = 0, hp = 0;
    const p = pos();
    if (S.look && low < 0.5) {
      const dy = S.look.y - (p.y + 0.35);
      const dx = S.look.x - p.x, dz = S.look.z - p.z;
      hy = clamp(angDiff(walker.yaw, yawTo(dx, dz)), -1.2, 1.2);
      hp = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.9, 0.5);
    }
    hy = hy * (1 - curl) + 1.0 * curl;
    hp = hp * (1 - curl) + 0.55 * curl;
    if (S.groom > 0) { hp = 0.7; hy = 0.35 * Math.sin(t * 5); n.legs[0].rotation.x = -1.3 + 0.2 * Math.sin(t * 9); }
    n.neck.rotation.y = damp(n.neck.rotation.y, hy * 0.5, 8, dt);
    n.head.rotation.y = damp(n.head.rotation.y, hy * 0.5, 8, dt);
    n.head.rotation.x = damp(n.head.rotation.x, hp + 0.62 * sit * (1 - low) * 0.8, 8, dt);
    n.head.rotation.z = curl * 0.5 + Math.sin(t * 0.7) * 0.05 * (1 - low);
    n.neck.position.y = 0.1 - 0.05 * curl;
    // ears: idle twitches, flat when startled
    const tw = Math.max(0, Math.sin(t * 0.9 + 1.3)) ** 24;
    for (const [i, e] of n.ears.entries()) e.rotation.x = -0.7 * S.startle + (i ? tw : 0) * 0.4;
    // eyes: blink, sleep (∪), purr (∩)
    S.blinkT -= dt;
    if (S.blinkT < 0) { S.blink = 0.14; S.blinkT = 2.5 + Math.random() * 4; }
    S.blink = Math.max(0, S.blink - dt);
    const shut = curl > 0.5 || purr > 0.3;
    for (const e of n.eyes) { e.visible = !shut; e.scale.y = S.blink > 0 ? 0.12 : 1 - 0.45 * S.lidW + 0.25 * S.startle; }
    for (const e of n.shut) { e.visible = shut; e.rotation.z = purr > 0.3 ? 0 : Math.PI; }
    // tail: question mark up while walking / standing, wrapped round the paws when sitting / curled
    const wrap = Math.max(sit, low);
    const tb = n.tailBase;
    tb.rotation.x = 2.25 * (1 - wrap) + 1.42 * wrap + (air ? -0.5 : 0);
    tb.rotation.y = 0.5 * wrap;
    for (let k = 0; k < TAIL_SEGS; k++) {
      const j = n.tail[k];
      const sway = Math.sin(t * (2.1 + purr * 3) - k * 0.7) * (0.12 + 0.1 * walkK);
      j.rotation.x = k ? -0.2 * (1 - wrap) + (k > 3 ? -0.35 : 0) * (1 - wrap) : 0;
      j.rotation.z = (1 - wrap) * sway;
      j.rotation.y = k ? wrap * (0.42 + 0.06 * Math.sin(t * 1.3 - k)) : 0;
    }
    // hearts
    for (let i = 0; i < n.hearts.length; i++) {
      const h = n.hearts[i];
      const u = (S.purrT * 0.8 + i / 3) % 1;
      h.visible = purr > 0.2;
      if (!h.visible) continue;
      h.position.set(Math.sin(i * 2.1 + S.purrT) * 0.1, 0.42 + u * 0.4, 0.05);
      h.scale.setScalar(0.09 * Math.sin(u * Math.PI) * purr + 0.001);
      h.rotation.y = camYawLocal;
    }
  }
  let camYawLocal = 0;

  // ---- update ------------------------------------------------------------------------------------------------------
  function update(c: AmbFrame, camera: THREE.Camera | null | undefined) {
    const dt = Math.min(c.dt, 0.1);
    const t = c.time;
    S.t += dt;
    S.hour = c.hour;
    readHeat(dt);

    // player stillness / proximity
    const pd = playerDist();
    const moved = Math.hypot(player.pos.x - S.lastP.x, player.pos.z - S.lastP.z);
    S.lastP.x = player.pos.x; S.lastP.z = player.pos.z;
    const pSpeed = moved / Math.max(dt, 1e-3);
    if (pSpeed < 0.08) S.stillT += dt; else { S.stillT = 0; S.noticeRoll = rand(); }
    S.followCd -= dt;

    // interrupts: pat → purr; walk-into → startle; still player nearby → follow
    const patted = (qHeld && aimedAt(camera) && !S.jump) || S.treatT > 0;
    if (S.treatT > 0) S.treatT -= dt;
    if (patted) { S.purr = Math.min(1, S.purr + dt * 3); S.purrT += dt; if (S.step?.k === 'walk') { walker.stop(); S.step = null; S.plan = [{ k: 'sit', dur: 6 }]; } }
    else S.purr = Math.max(0, S.purr - dt * 1.2);
    if (S.purr > 0 && Math.random() < dt * 1.5) d.bus?.emit?.('amb.cat', { ev: 'purr', pos: pos() });
    S.startle = Math.max(0, S.startle - dt * 1.5);
    if (pd < 0.42 && pSpeed > 0.6 && S.perchY === null && !S.jump && S.startle <= 0) {
      S.startle = 1;
      const ax = walker.pos.x - player.pos.x, az = walker.pos.z - player.pos.z, L = Math.hypot(ax, az) || 1;
      const out = { x: walker.pos.x + (ax / L) * 0.7, z: walker.pos.z + (az / L) * 0.7 };
      setPlan([{ k: 'jump', to: { x: out.x, y: layout.floorY(out.x, out.z, 0), z: out.z } }, { k: 'sit', dur: 3, lookAt: 'player' }], S.mode === 'follow' ? 'follow' : 'startle');
      d.bus?.emit?.('amb.cat', { ev: 'startle', pos: pos() });
    }
    const canNotice = S.mode !== 'follow' && S.step?.k !== 'beg' && S.followCd <= 0 && (player.level ?? 0) === 0 && pd > 1.4 && pd < 11
      && !S.jump && S.purr <= 0 && S.mode !== 'startle';
    if (canNotice && S.stillT > 5 && S.noticeRoll < (S.mode === 'rack' || S.mode === 'vault' || S.mode === 'sill' ? 0.35 : 0.85)) {
      S.followCd = 60;
      setPlan([...jumpDownIfPerched(), { k: 'follow', dur: 25 + rand() * 25 }], 'follow');
      d.bus?.emit?.('amb.cat', { ev: 'meow', pos: pos() });
    }

    // keyboard honesty: the agent stopped idling → hop off now
    if (S.keyboardId && S.mode === 'keyboard') {
      const a = actors?.get?.(S.keyboardId);
      const st = a?.entity?.status;
      if (!a || (st !== 'idle' && st !== 'done') || !a.lite?.seated) {
        S.keyboardId = null;
        setPlan([...jumpDownIfPerched(), { k: 'sit', dur: 2, lookAt: 'player' }], 'startle');
      }
    }

    // run the plan
    if (!S.step && S.plan.length) nextStep();
    if (!S.step && !S.plan.length) think(), nextStep();
    const st = S.step;
    let wantSit = 0, wantCurl = 0, wantLoaf = 0, speed = 0;
    S.look = null; S.bat = 0; S.groom = 0; S.lidW = 0;
    if (st) {
      S.stepT += dt;
      switch (st.k) {
        case 'walk': {
          walker.update(dt);
          speed = walker.v;
          if (walker.done || walker.failed) S.step = null;
          if (S.stepT > 40) S.step = null;
          break;
        }
        case 'pad': { // walk along a raised surface (rack top): straight line, no nav
          const p = pos();
          const dx = st.to.x - p.x, dz = st.to.z - p.z, dd = Math.hypot(dx, dz);
          walker.yaw = dampAng(walker.yaw, yawTo(dx, dz), 8, dt);
          const stp = Math.min(dd, 0.6 * dt);
          if (dd > 1e-3) { walker.pos.x += (dx / dd) * stp; walker.pos.z += (dz / dd) * stp; }
          speed = dd > 0.02 ? 0.6 : 0;
          if (dd < 0.02) S.step = null;
          break;
        }
        case 'face': {
          walker.yaw = dampAng(walker.yaw, st.yaw, 6, dt);
          if (Math.abs(angDiff(walker.yaw, st.yaw)) < 0.08 || S.stepT > 1.2) S.step = null;
          speed = 0.15;
          break;
        }
        case 'faceAt': {
          const at = st.at ?? { x: walker.pos.x, z: walker.pos.z + 1 };
          const y = yawTo(at.x - walker.pos.x, at.z - walker.pos.z);
          walker.yaw = dampAng(walker.yaw, y, 6, dt);
          if (Math.abs(angDiff(walker.yaw, y)) < 0.08 || S.stepT > 1.2) S.step = null;
          speed = 0.15;
          break;
        }
        case 'jump': {
          const j = S.jump;
          if (!j) { S.step = null; break; }
          j.t = (j.t ?? 0) + dt;
          walker.yaw = dampAng(walker.yaw, j.yaw, 10, dt);
          if (j.t > j.crouch) {
            const u = clamp((j.t - j.crouch) / j.T, 0, 1);
            walker.pos.x = j.from.x + (j.to.x - j.from.x) * u;
            walker.pos.z = j.from.z + (j.to.z - j.from.z) * u;
            const y = j.from.y + (j.to.y - j.from.y) * u + 4 * j.apex * u * (1 - u) * (j.to.y > j.from.y ? 0.6 : 0.35);
            S.perchY = y;
            if (u >= 1) {
              S.jump = null; S.step = null;
              const floor = layout.floorY(j.to.x, j.to.z, 0);
              S.perchY = Math.abs(j.to.y - floor) < 0.05 ? null : j.to.y;
              walker.pos.y = floor;
              fx?.burst?.('dust', { x: j.to.x, y: j.to.y + 0.9, z: j.to.z });
              d.bus?.emit?.('amb.cat', { ev: 'land', pos: pos() });
            }
          }
          break;
        }
        case 'sit': {
          wantSit = 1;
          if (st.bat && Math.sin(S.stepT * 1.7) > 0.92) S.bat = 1;
          if (st.lookAt === 'player') S.look = { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z };
          else if (st.lookAt) S.look = { x: st.lookAt.x, y: 1.0, z: st.lookAt.z };
          else if (pd < 5) S.look = { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z };
          if (S.stepT > st.dur) S.step = null;
          break;
        }
        case 'beg': { // sit up at the pastry case, stare at the treats (or Bean), paw at the glass, meow now and then
          wantSit = 1;
          const bean = d.peers?.barista?.pos;
          const nearBean = bean && Math.hypot(bean.x - walker.pos.x, bean.z - walker.pos.z) < 2.5;
          S.look = nearBean ? { x: bean.x, y: bean.y, z: bean.z } : st.lookAt ?? PLACES.pastry?.look ?? null;
          if (!nearBean && Math.sin(S.stepT * 1.3) > 0.9) S.bat = 1;
          st.meowT = (st.meowT ?? 2) - dt;
          if (st.meowT <= 0) { st.meowT = 5 + rand() * 5; d.bus?.emit?.('amb.cat', { ev: 'meow', pos: pos() }); }
          if (S.stepT > st.dur || (st.fed && S.treatT <= 0)) S.step = null;
          if (S.treatT > 0) st.fed = true;
          break;
        }
        case 'groom': { wantSit = 1; S.groom = 1; S.lidW = 0.6; if (S.stepT > st.dur) S.step = null; break; }
        case 'stretch': {
          // play bow: front down, rump up, then shake
          const u = S.stepT / st.dur;
          wantSit = 0;
          n0.hipsPitch = Math.sin(Math.min(1, u) * Math.PI) * 0.45;
          if (S.stepT > st.dur) { S.step = null; n0.hipsPitch = 0; }
          break;
        }
        case 'nap': {
          wantCurl = 1;
          S.zAcc += dt;
          if (S.zAcc > 1.7 && camera && camera.position.distanceTo(tmp.set(walker.pos.x, pos().y, walker.pos.z)) < 22) {
            S.zAcc = 0; const p = pos(); fx?.burst?.('zzz', { x: p.x + 0.08, y: p.y + 0.3, z: p.z });
          }
          if (S.stepT > st.dur) S.step = null;
          break;
        }
        case 'loaf': {
          wantLoaf = 1; S.lidW = 0.55;
          const a = st.watch ? actors?.get?.(st.watch) : null;
          if (a && Math.sin(S.stepT * 0.4) > 0.3) S.look = { x: a.pos.x, y: a.pos.y + 0.55, z: a.pos.z };
          else if (pd < 5) S.look = { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z };
          if (S.stepT > st.dur) S.step = null;
          break;
        }
        case 'follow': {
          // keep ~1.1 m from the player; sit and look up when there
          const px = player.pos.x, pz = player.pos.z;
          const dd = Math.hypot(px - walker.pos.x, pz - walker.pos.z);
          if (dd > 16 || (player.level ?? 0) !== 0 || S.stepT > st.dur) { S.step = null; break; }
          if (dd > 1.7) {
            if (!walker.moving && !walker.pending || S.stepT - (st.reT ?? -9) > 1.0) {
              st.reT = S.stepT;
              const k = 1.1 / dd;
              walker.speed = dd > 4 ? 2.1 : 1.1;
              walker.go({ x: px + (walker.pos.x - px) * k, z: pz + (walker.pos.z - pz) * k });
            }
          }
          if (walker.moving || walker.pending) { walker.update(dt); speed = walker.v; }
          if (!walker.moving && dd <= 1.9) {
            wantSit = 1;
            walker.yaw = dampAng(walker.yaw, yawTo(px - walker.pos.x, pz - walker.pos.z), 5, dt);
          }
          S.look = { x: px, y: player.pos.y + 1.15, z: pz };
          break;
        }
        default: S.step = null;
      }
    }
    S.sitW = damp(S.sitW, wantSit, 7, dt);
    S.curlW = damp(S.curlW, wantCurl, 3, dt);
    S.loafW = damp(S.loafW, wantLoaf, 5, dt);

    // place the rig
    const p = pos();
    rig.root.position.set(p.x, p.y, p.z);
    rig.root.rotation.y = walker.yaw;
    if (camera) camYawLocal = Math.atan2(camera.position.x - p.x, camera.position.z - p.z) - walker.yaw;
    // cull: nothing to pose beyond 30 m or behind walls the vis table hides (charBatch frustum-culls the rest)
    const far = camera ? camera.position.distanceTo(tmp.set(p.x, p.y, p.z)) : 0;
    handle.setVisible(far < 32);
    if (far < 32) {
      pose(dt, t, speed);
      N.hips.rotation.x += n0.hipsPitch;
      N.blob.visible = S.perchY === null || S.jump != null;
    }
  }
  const n0 = { hipsPitch: 0 };

  return {
    update,
    get pos() { return pos(); },
    get mode() { return S.mode; },
    /** [AMB fix m2 r2] sitting up at the pastry case (Bean reads it for its 'treat' errand) */
    get begging() { return S.step?.k === 'beg' && S.stepT > 3 && S.purr <= 0; },
    /** Bean dropped a crumb: purr + hearts for a moment */
    treat() { S.treatT = 2.6; d.bus?.emit?.('amb.cat', { ev: 'purr', pos: pos() }); },
    debug: () => ({ mode: S.mode, step: S.step?.k ?? null, plan: S.plan.map((s) => s.k), rackCol: S.rackCol, perched: S.perchY !== null, x: +walker.pos.x.toFixed(2), z: +walker.pos.z.toFixed(2), purr: +S.purr.toFixed(2) }),
    /** debug: force a behaviour ('rack' | 'keyboard' | 'fish' | 'vault' | 'ada' | 'pit' | 'sill' | 'pastry' | 'follow') */
    force(id?: string) {
      if (id === 'rackNow') { // shots: already curled up on the hottest cabinet
        const c = rackCol(S.rackCol); if (!c) return false;
        walker.stop(); walker.pos.x = c.top.x; walker.pos.z = c.top.z; S.perchY = c.top.y; walker.yaw = c.yaw + 0.5; S.jump = null;
        S.downTo = c.front; S.curlW = 1; S.sitW = 0; setPlan([{ k: 'nap', dur: 120, rack: true }], 'rack'); return true;
      }
      if (id === 'keyboardNow') {
        const c = keyboardCandidate(); if (!c) return false;
        const plan = keyboardPlan(c); const j = plan.find((s) => s.k === 'jump'); if (!j) return false;
        walker.stop(); walker.pos.x = j.to.x; walker.pos.z = j.to.z; S.perchY = j.to.y; S.jump = null; S.loafW = 1; S.sitW = 0;
        setPlan(plan.slice(plan.indexOf(j) + 1), 'keyboard'); return true;
      }
      if (id === 'follow') { setPlan([...jumpDownIfPerched(), { k: 'follow', dur: 40 }], 'follow'); return true; }
      if (id === 'rack') { const p = rackPlan(); if (p) { setPlan(p, 'rack'); return true; } return false; }
      if (id === 'keyboard') { const c = keyboardCandidate(); if (c) { setPlan(keyboardPlan(c), 'keyboard'); return true; } return false; }
      if (id === undefined || !isPlaceId(id)) return false;
      const plan = planFor(id);
      if (!plan) return false;
      S.lastPlace = id; setPlan(plan, id); return true;
    },
    /** debug: teleport (e.g. onto the rack top for a shot) */
    teleport(x: number, z: number, y: number | null = null, yaw = 0) { walker.stop(); walker.pos.x = x; walker.pos.z = z; S.perchY = y; walker.yaw = yaw; S.jump = null; },
    dispose() {
      handle.remove();
      if (typeof offHot === 'function') offHot();
      if (typeof window !== 'undefined') { removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('blur', onBlur); }
    },
  };
}
