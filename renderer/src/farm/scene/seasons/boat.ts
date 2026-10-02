/**
 * The rowboat (spring to autumn): tied alongside the pond dock; E climbs in and you row in first person (W / S row,
 * A / D turn: physics.ts `stepBoat`, two oars that animate with their strokes, a little drift), wake rings spread
 * behind her and around each oar dip, she bumps softly off the shore, the dock and the lily pads. Look at the water
 * to fish (scene/forage: casts out in the middle of the pond have better odds of the rarer fish, service 'rowboat'),
 * E by the dock steps out and she drifts back to her mooring. A lantern on the bow lights at night (service
 * 'lights'); your pet (if you have one) rides in the bow (service 'petPerch', scene/life/companion.ts). In winter she
 * lies upside down on the beach.
 *
 * Draws: hull + lantern glass (2), the oars (1, instanced), wake rings (1, only while any are alive).
 */
import * as THREE from 'three';
import type { HandsPort, Interactable, LightEmitter, LightsService } from '../context.ts';
import type { RideInput, RideOut, Rider } from '../../player/controller.ts';
import { POND, WORLD, heightAt } from '../../world/map.ts';
import { solidMat, setGlow } from '../structures/kit.ts';
import { shorePlaces } from '../terrain/shore.ts';
import type { PetPerch } from '../life/companion.ts';
import { BOAT, boatState, fishBoost, oarPose, stepBoat } from './physics.ts';
import type { BoatEnv, Pad } from './physics.ts';
import { BOAT_SPOTS, buildBoat, oarGeometry, wakeGeometry } from './models.ts';
import { DECK, dockToWorld, worldToDock } from './ice.ts';
import type { Pastime, Shared } from './shared.ts';

type Mode = 'moored' | 'aboard' | 'return' | 'winter';
const WAKES = 28;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Service 'rowboat': forage asks it how good the fishing is where you cast. */
export interface RowboatService {
  readonly aboard: boolean;
  /** rare-fish odds multiplier for a cast at (x, z) (1 unless you're out in the boat) */
  fishBoost(x: number, z: number): number;
}

export function createBoat(sh: Shared): Pastime {
  const { ctx } = sh;
  const p = ctx.player;
  const root = buildBoat();
  root.rotation.order = 'YXZ';
  const glow = root.children.find((c) => c.userData.bake === 'glow') as THREE.Mesh | undefined;
  ctx.scene.add(root);
  const oars = new THREE.InstancedMesh(oarGeometry(), solidMat(), 2);
  oars.name = 'seasons:oars';
  oars.castShadow = true;
  oars.frustumCulled = false;
  oars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ctx.scene.add(oars);
  const wakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, forceSinglePass: true });
  const wake = new THREE.InstancedMesh(wakeGeometry(), wakeMat, WAKES);
  wake.name = 'seasons:wake';
  wake.frustumCulled = false;
  wake.renderOrder = 3;
  wake.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wake.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(WAKES * 3), 3).setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < WAKES; i++) wake.setMatrixAt(i, ZERO);
  wake.visible = false;
  ctx.scene.add(wake);
  const rings = Array.from({ length: WAKES }, () => ({ x: 0, z: 0, t: 1, life: 1, s0: 0.3, grow: 1, a: 0.3 }));
  let ringAt = 0, wakeIn = 0, alive = 0;
  const ring = (x: number, z: number, s0: number, grow: number, life: number, a: number) => {
    const r = rings[ringAt++ % WAKES];
    r.x = x; r.z = z; r.t = 0; r.s0 = s0; r.grow = grow; r.life = life; r.a = a;
  };

  // ------------------------------------------------------------------ where she lives
  const MOOR = (() => { const w = dockToWorld(DECK.w / 2 + 0.98, 5.3); return { x: w.x, z: w.z, yaw: Math.atan2(dockToWorld(0, 1).x - dockToWorld(0, 0).x, dockToWorld(0, 1).z - dockToWorld(0, 0).z) }; })();
  // winter: hauled up on the sunny beach south of the pond, upside down
  const BEACH = (() => {
    const dx = 0.26, dz = 0.97, l = Math.hypot(dx, dz);
    let r = POND.r * 0.6;
    while (r < POND.r + 12 && WORLD.water - heightAt(POND.x + (dx / l) * r, POND.z + (dz / l) * r) > -0.15) r += 0.2;
    r += 1.8;
    const x = POND.x + (dx / l) * r, z = POND.z + (dz / l) * r;
    return { x, z, yaw: Math.atan2(dz, -dx) };
  })();
  let mode: Mode = 'moored';
  const st = boatState(MOOR.x, MOOR.z, MOOR.yaw);
  let offCollider: (() => void) | null = null;

  // the water she floats on: the pond's depth, the dock's planks and pilings as a solid (a signed distance, so the
  // depth gradient pushes her off it), and land beyond the pond
  const depth = (x: number, z: number): number => {
    if (Math.hypot(x - POND.x, z - POND.z) > POND.r + 6) return -1;
    const d = WORLD.water - heightAt(x, z);
    const l = worldToDock(x, z);
    const ex = Math.abs(l.x) - (DECK.w / 2 + 0.1), ez = Math.max(DECK.z0 - l.z, l.z - (DECK.z1 + 0.15));
    const sdf = Math.hypot(Math.max(ex, 0), Math.max(ez, 0)) + Math.min(Math.max(ex, ez), 0);
    return Math.min(d, sdf - 0.04 + BOAT.draft);
  };
  const pads: Pad[] = shorePlaces().pads.filter((q) => Math.hypot(q.x - POND.x, q.z - POND.z) < POND.r + 2).map((q) => ({ x: q.x, z: q.z, r: 0.5 * q.s }));
  const env: BoatEnv = { depth, pads, wind: { x: 0, z: 0 } };
  const rowIn = { fwd: 0, turn: 0 };
  let dev: { fwd: number; turn: number; until: number } | null = null;
  let rowStamped = false, rowFlushed = 0, hinted = false, bumpSay = 0, t = 0;

  // ------------------------------------------------------------------ the pose (and everything riding on it)
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), one = new THREE.Vector3(1, 1, 1);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), seatW = new THREE.Vector3();
  let bobY = 0, roll = 0, pitch = 0;
  function pose(time: number, dt: number): void {
    if (mode === 'winter') {
      root.position.set(BEACH.x, heightAt(BEACH.x, BEACH.z) + 0.34, BEACH.z);
      root.rotation.set(0, BEACH.yaw, Math.PI);
    } else {
      const sp = Math.hypot(st.vx, st.vz);
      const pull = (st.driveL * Math.max(0, Math.sin(st.phL * Math.PI * 2)) + st.driveR * Math.max(0, Math.sin(st.phR * Math.PI * 2))) * st.active;
      bobY = Math.sin(time * 1.3) * 0.018 + Math.sin(time * 2.1 + 1) * 0.008;
      roll += ((Math.sin(time * 0.9) * 0.025 + st.w * sp * 0.05 + (mode === 'aboard' ? 0.012 : 0)) - roll) * Math.min(1, dt * 3);
      pitch += ((Math.sin(time * 1.1 + 0.5) * 0.012 - pull * 0.025 + st.bump * 0.04) - pitch) * Math.min(1, dt * 4);
      root.position.set(st.x, WORLD.water + bobY, st.z);
      root.rotation.set(pitch, st.yaw, roll);
    }
    root.updateMatrixWorld(true);
  }
  const toWorld = (local: THREE.Vector3, out: THREE.Vector3) => out.copy(local).applyMatrix4(root.matrixWorld);

  // ------------------------------------------------------------------ oars
  const pl = { sweep: 0, lift: 0 }, pr = { sweep: 0, lift: 0 };
  const blade = [new THREE.Vector3(), new THREE.Vector3()];
  const BLADE = new THREE.Vector3(1.7, 0, 0);
  /** the oar's handle grip (oar space: the dark wrap inboard of the lock) and where it is now (port, starboard) */
  const GRIP = new THREE.Vector3(-0.5, 0, 0), grip = [new THREE.Vector3(), new THREE.Vector3()];
  function writeOars(): void {
    oars.visible = mode !== 'winter';
    if (glow) glow.visible = mode !== 'winter';
    if (mode === 'winter') return;
    oarPose(st.phL, st.active, pl);
    oarPose(st.phR, st.active, pr);
    for (let i = 0; i < 2; i++) {
      const o = i === 0 ? pl : pr, lock = i === 0 ? BOAT_SPOTS.lockL : BOAT_SPOTS.lockR;
      // port oar points +x (outboard), starboard −x: a mirrored sweep; lift tips the blade up out of the water
      const yaw = i === 0 ? o.sweep : Math.PI - o.sweep;
      e.set(0, yaw, -0.3 + o.lift * 0.62, 'YXZ');
      q.setFromEuler(e);
      mtx.compose(lock, q, one).premultiply(root.matrixWorld);
      oars.setMatrixAt(i, mtx);
      blade[i].copy(BLADE).applyMatrix4(mtx);
      grip[i].copy(GRIP).applyMatrix4(mtx);
    }
    oars.instanceMatrix.needsUpdate = true;
    // aboard: the first-person paws (scene/viewmodel) hold the grips
    if (mode === 'aboard') (ctx.services.get('hands') as HandsPort | undefined)?.oars(grip[0], grip[1]);
  }

  // ------------------------------------------------------------------ the lantern
  const lamp: LightEmitter = { pos: new THREE.Vector3(), color: new THREE.Color(1.0, 0.6, 0.26), intensity: 0.75, radius: 6.5, flicker: 0.35, gain: 1 };
  let offLamp: (() => void) | null = null;
  const lights = () => ctx.services.get('lights') as LightsService | undefined;

  // ------------------------------------------------------------------ the pet in the bow
  const perch: PetPerch = { active: false, x: 0, y: 0, z: 0, yaw: 0 };
  ctx.services.set('petPerch', perch);

  // ------------------------------------------------------------------ riding
  const rider: Rider = {
    ride(dt: number, input: RideInput, out: RideOut): boolean {
      if (mode !== 'aboard') return false;
      if (dev && t < dev.until) { rowIn.fwd = dev.fwd; rowIn.turn = dev.turn; } else { dev = null; rowIn.fwd = input.fwd; rowIn.turn = input.side; }
      const y0 = st.yaw;
      const w = (ctx.services.get('wind') as { at(x: number, z: number, t: number, o: { x: number; z: number }): unknown } | undefined);
      if (w && env.wind) w.at(st.x, st.z, t, env.wind);
      stepBoat(st, rowIn, dt, env);
      let dy = st.yaw - y0;
      if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
      p.yaw += dy;
      // the rower's seat, carried by the boat's pose (last frame's tilt; the bob is tiny)
      const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
      p.pos.set(st.x + BOAT_SPOTS.seat.x * cy + BOAT_SPOTS.seat.z * sy, WORLD.water + bobY + BOAT_SPOTS.seat.y, st.z - BOAT_SPOTS.seat.x * sy + BOAT_SPOTS.seat.z * cy);
      p.speed = Math.hypot(st.vx, st.vz);
      out.eye = 0.86; out.roll = roll * 0.7; out.vx = 0; out.vz = 0;
      if (st.dip) {
        if (st.dip !== 1) { sh.sfx('oar', blade[0], 0.55, 0.95 + Math.random() * 0.1); ring(blade[0].x, blade[0].z, 0.12, 0.9, 1.3, 0.5); }
        if (st.dip !== -1) { sh.sfx('oar', blade[1], 0.55, 0.95 + Math.random() * 0.1); ring(blade[1].x, blade[1].z, 0.12, 0.9, 1.3, 0.5); }
      }
      if (st.bump > 0.25) {
        sh.sfx('step-wood', p.pos, Math.min(1, 0.3 + st.bump), 0.55);
        if (bumpSay <= 0 && st.bump > 0.7) { bumpSay = 20; sh.say('Bonk. She bounces off gently: no harm done.', 2200, 'Rowboat'); }
      }
      if (!rowStamped && st.rowed > 12) { rowStamped = true; sh.stamp('row'); }
      if (st.rowed - rowFlushed >= 10) flushRowed();   // metres rowed → the stamp book, ten at a time (and the rest on leaving)
      return true;
    },
  };

  function board(): void {
    const c = sh.controller();
    if (!c || mode === 'winter' || mode === 'aboard') return;
    if (mode === 'return') { mode = 'moored'; }
    st.vx = st.vz = st.w = 0; st.active = 0; st.rowed = 0; st.bump = 0;
    rowStamped = false; rowFlushed = 0;
    mode = 'aboard';
    c.ride(rider, () => { if (mode === 'aboard') leave(); });
    p.yaw = st.yaw + Math.PI;
    p.pitch = -0.12;
    sh.sfx('step-wood', root.position, 0.8, 0.7);
    perch.active = true;
    if (!hinted) { hinted = true; sh.say('Into the rowboat! W / S to row, A / D to turn. Look at the water and E to fish; E by the dock to step out.', 6500, 'Rowboat'); }
  }
  /** hand the whole metres rowed since the last flush to the stamp book */
  function flushRowed(): void {
    const m = Math.floor(st.rowed - rowFlushed);
    if (m <= 0) return;
    rowFlushed += m;
    sh.rowed(m);
  }
  function leave(): void {
    if (mode !== 'aboard') return;
    flushRowed();
    mode = 'return';
    perch.active = false;
    dev = null;
  }
  /** nearest point on the deck to the boat (inset), world, and how far */
  const deckPt = { x: 0, z: 0, d: 0 };
  function nearestDeck(): typeof deckPt {
    const l = worldToDock(st.x, st.z);
    const lx = Math.max(-DECK.w / 2 + 0.4, Math.min(DECK.w / 2 - 0.4, l.x)), lz = Math.max(DECK.z0 + 0.5, Math.min(DECK.z1 - 0.4, l.z));
    const w = dockToWorld(lx, lz);
    deckPt.x = w.x; deckPt.z = w.z; deckPt.d = Math.hypot(w.x - st.x, w.z - st.z);
    return deckPt;
  }
  function stepOut(): void {
    if (mode !== 'aboard') return;
    const d = nearestDeck();
    const yaw = p.yaw;
    leave();
    sh.controller()?.ride(null);
    sh.controller()?.teleport(d.x, d.z, yaw, p.pitch);
    sh.sfx('step-wood', p.pos, 0.8, 0.9);
  }

  // ------------------------------------------------------------------ interactables
  const boardI: Interactable = {
    id: 'seasons:boat', kind: 'prop', verb: 'Climb into', reach: 3.4,
    label: () => 'Rowboat',
    pos: (out) => out.set(root.position.x, root.position.y + 0.45, root.position.z),
    enabled: () => (mode === 'moored' || mode === 'return') && !sh.controller()?.riding && sh.ice() < 0.5,
    hint: () => 'row out on the pond · the middle is where the rare fish are',
    use: board,
  };
  const winterI: Interactable = {
    id: 'seasons:boat-winter', kind: 'prop', verb: 'Look at', reach: 3.2,
    label: () => 'Rowboat',
    pos: (out) => out.set(root.position.x, root.position.y + 0.1, root.position.z),
    enabled: () => mode === 'winter',
    hint: () => 'put away for the winter',
    use: () => sh.say(sh.ice() > 0.5 ? 'Hauled up for the winter. The pond is frozen: walk out onto the ice to skate!' : 'Hauled up for the winter.', 3600, 'Rowboat'),
  };
  const outI: Interactable = {
    id: 'seasons:dock-out', kind: 'prop', verb: 'Step out onto', reach: 4.2,
    label: () => 'Dock',
    pos: (out) => { nearestDeck(); return out.set(deckPt.x, DECK.y + 0.2, deckPt.z); },
    enabled: () => mode === 'aboard' && nearestDeck().d < 2.6,
    hint: () => 'she\'ll drift back to her mooring',
    use: stepOut,
  };
  const offs = [ctx.interact.add(boardI), ctx.interact.add(winterI), ctx.interact.add(outI)];
  const svc: RowboatService = { get aboard() { return mode === 'aboard'; }, fishBoost: (x, z) => (mode === 'aboard' ? fishBoost(x, z) : 1) };
  ctx.services.set('rowboat', svc);

  function setWinter(on: boolean): void {
    if (on && mode !== 'winter') {
      if (mode === 'aboard') stepOut();
      mode = 'winter';
      perch.active = false;
      offCollider = ctx.colliders.rect(BEACH.x, BEACH.z, BOAT.beam, BOAT.len, BEACH.yaw);
    } else if (!on && mode === 'winter') {
      mode = 'moored';
      st.x = MOOR.x; st.z = MOOR.z; st.yaw = MOOR.yaw; st.vx = st.vz = st.w = 0; st.active = 0;
      offCollider?.(); offCollider = null;
    }
  }

  return {
    update(f) {
      const dt = f.dt;
      t = f.time;
      bumpSay -= dt;
      setWinter(sh.ice() > 0.5);
      if (mode === 'moored') {
        // tied up: she nudges at her rope
        st.x = MOOR.x + Math.sin(f.time * 0.4) * 0.04; st.z = MOOR.z + Math.cos(f.time * 0.33) * 0.03; st.yaw = MOOR.yaw + Math.sin(f.time * 0.27) * 0.03;
        st.active = Math.max(0, st.active - dt * 0.8);
      } else if (mode === 'return') {
        // drifting home to the dock (a ghost of a tow: no collisions, it's only a few metres)
        const k = 1 - Math.exp(-dt * 0.9);
        st.x += (MOOR.x - st.x) * k; st.z += (MOOR.z - st.z) * k;
        let dy = MOOR.yaw - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        st.yaw += dy * k;
        st.vx = st.vz = st.w = 0;
        st.active = Math.max(0, st.active - dt * 0.8);
        if (Math.hypot(MOOR.x - st.x, MOOR.z - st.z) < 0.05 && Math.abs(dy) < 0.02) mode = 'moored';
      }
      pose(f.time, dt);
      writeOars();
      // the lantern: lit after dusk, out in winter
      if (!offLamp && lights()) offLamp = lights()!.add(lamp);
      toWorld(BOAT_SPOTS.lantern, lamp.pos);
      lamp.gain = mode === 'winter' ? 0 : 1;
      if (glow) setGlow(glow.material as THREE.MeshBasicMaterial, mode === 'winter' ? 0 : ctx.lighting.night);
      // the pet's seat
      if (perch.active) {
        toWorld(BOAT_SPOTS.bow, tmp);
        perch.x = tmp.x; perch.y = tmp.y; perch.z = tmp.z; perch.yaw = st.yaw + Math.PI;
      }
      // the wake: rings off the stern while she moves
      const sp = Math.hypot(st.vx, st.vz);
      if (mode === 'aboard' && sp > 0.25) {
        wakeIn -= dt;
        if (wakeIn <= 0) {
          wakeIn = Math.max(0.18, 0.55 / sp);
          tmp2.set(0, 0, -BOAT.len * 0.5);
          toWorld(tmp2, seatW);
          ring(seatW.x, seatW.z, 0.35, 0.6 + sp * 0.25, 2.4, Math.min(0.55, 0.2 + sp * 0.15));
        }
      }
      alive = 0;
      for (let i = 0; i < WAKES; i++) {
        const r = rings[i];
        if (r.t >= 1) { wake.setMatrixAt(i, ZERO); continue; }
        r.t = Math.min(1, r.t + dt / r.life);
        alive++;
        const s = r.s0 + r.grow * r.t * r.life;
        mtx.makeScale(s, 1, s).setPosition(r.x, WORLD.water + 0.03, r.z);
        wake.setMatrixAt(i, mtx);
        const a = r.a * (1 - r.t) * (1 - r.t) * (1 - ctx.lighting.night * 0.6);
        wake.instanceColor!.setXYZ(i, a, a, a);
      }
      wake.visible = alive > 0;
      if (alive || wake.visible) { wake.instanceMatrix.needsUpdate = true; wake.instanceColor!.needsUpdate = true; }
    },
    dev(cmd, a) {
      const c = sh.controller();
      if (cmd === 'in') {
        if (mode === 'winter') return 'winter: the boat is put away';
        if (mode !== 'moored') { mode = 'moored'; st.x = MOOR.x; st.z = MOOR.z; st.yaw = MOOR.yaw; }
        c?.teleport(MOOR.x, MOOR.z);
        board();
      } else if (cmd === 'row' || cmd === 'turn' || cmd === 'spin') {
        if (mode !== 'aboard') svcDevIn();
        const secs = typeof a === 'number' ? a : 4;
        dev = cmd === 'row' ? { fwd: 1, turn: 0, until: t + secs } : cmd === 'turn' ? { fwd: 1, turn: 0.6, until: t + secs } : { fwd: 0, turn: 1, until: t + secs };
      } else if (cmd === 'middle') {
        if (mode !== 'aboard') svcDevIn();
        st.x = POND.x - 1.2; st.z = POND.z - 1.5; st.yaw = 0.6; st.vx = st.vz = 0;
        p.yaw = st.yaw + Math.PI;
      } else if (cmd === 'out') {
        if (mode === 'aboard') {
          // come alongside first, then step out
          const w = dockToWorld(DECK.w / 2 + 0.9, 4.6);
          st.x = w.x; st.z = w.z;
          stepOut();
        }
      }
      return { mode, x: +st.x.toFixed(2), z: +st.z.toFixed(2), yaw: +st.yaw.toFixed(3), speed: +Math.hypot(st.vx, st.vz).toFixed(2), rowed: +st.rowed.toFixed(1), active: +st.active.toFixed(2), boost: +fishBoost(st.x, st.z).toFixed(2) };
      function svcDevIn() { if (mode === 'moored' || mode === 'return') { c?.teleport(MOOR.x, MOOR.z); board(); } }
    },
    stats: () => ({ boat: mode, wake: alive }),
    dispose() {
      for (const o of offs) o();
      offLamp?.(); offCollider?.();
      if (ctx.services.get('rowboat') === svc) ctx.services.delete('rowboat');
      if (ctx.services.get('petPerch') === perch) ctx.services.delete('petPerch');
      ctx.scene.remove(root, oars, wake);
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).geometry.dispose(); } });
      if (glow) (glow.material as THREE.Material).dispose();
      oars.geometry.dispose(); wake.geometry.dispose(); wakeMat.dispose();
    },
  };
}
