/**
 * First-person walker for the valley: pointer-lock mouse look, WASD, sprint, jump, terrain following, structure
 * collision, no swimming (deep water and cliffs push back), footstep-locked head bob.
 * Movement pauses whenever a modal UI owns the input (`player.frozen`).
 * Indoors (service 'indoors', the farmhouse / barn interiors): its floors (by feet height: the barn's loft) and solids
 * replace the terrain and colliders.
 * Fly mode (photo mode): the camera leaves the body and flies freely (WASD along the view, Space up, C down, Shift
 * fast, no collision); leaving it snaps the view back to where you stood.
 * Sitting (`sit`, the campfire's log benches at an evening gathering): the body eases onto the seat and the eye lowers
 * to a seated height; the mouse still looks around, and any move key or Space stands you up again.
 * Riding (`ride`, scene/seasons: the rowboat, skating on the frozen pond): a `Rider` takes over movement each frame
 * (it reads the move keys, writes the feet position and says where the eye goes); the mouse still looks around.
 */
import * as THREE from 'three';
import type { FrameInfo, IndoorSpace, SceneCtx } from '../scene/context.ts';
import { WORLD, heightAt, normalAt } from '../world/map.ts';
import { bobAdvance, bobShape, stepIndex } from '../../player/feel.ts';
import { damp, dampAngle } from '../../core/math.ts';

const EYE = 1.62;
/** eye height above a seat's surface when sitting */
const SIT_EYE = 0.98;
const RADIUS = 0.35;
const WALK = 4.6, SPRINT = 8.2, ACCEL = 10, JUMP_V = 5.2, GRAVITY = 16;
const MAX_SLOPE = 0.42; // 1 − normal.y above which ground is a wall
const MAX_R = 128; // hard boundary (the mountains are steeper than this anyway)

/** The move keys this frame, for a `Rider`. */
export interface RideInput { fwd: number; side: number; sprint: boolean; jump: boolean }
/** Where the camera goes while riding (written by the rider each frame). */
export interface RideOut {
  /** eye height above `player.pos.y` */
  eye: number;
  /** camera roll (lean into a carve, a rocking boat), radians */
  roll: number;
  /** horizontal velocity to carry on with when the ride ends (skating off onto the shore) */
  vx: number; vz: number;
}
/**
 * Something that moves the player instead of walking (scene/seasons: the rowboat, skates). `ride` advances one frame:
 * read `input`, write `ctx.player.pos` / `speed` (and turn `yaw` if it wants), fill `out`; return false to get off.
 */
export interface Rider { ride(dt: number, input: RideInput, out: RideOut): boolean }

export interface Controller {
  update(f: FrameInfo): void;
  /** instant move (map travel, dev); yaw optional */
  teleport(x: number, z: number, yaw?: number, pitch?: number): void;
  /** smoothly turn the camera toward a point */
  lookAt(x: number, y: number, z: number): void;
  onStep(fn: (speed: number, surface: 'grass' | 'water' | 'wood') => void): () => void;
  lockPointer(): void;
  /** detach the camera and fly it freely (photo mode); false returns to the body */
  fly(on: boolean): void;
  readonly flying: boolean;
  /** sit on a seat (world x / z, seat surface height y, facing yaw in model convention: front = (sin, cos)); null
   *  stands up. `onStand` runs when the player gets up (a move key, Space, or `sit(null)`). */
  sit(at: { x: number; z: number; y: number; yaw: number } | null, onStand?: () => void): void;
  readonly seated: boolean;
  /** hand movement to a rider (null: back on foot); `onEnd` runs when the ride ends for any reason (the rider says
   *  so, `ride(null)`, a teleport) */
  ride(r: Rider | null, onEnd?: () => void): void;
  readonly riding: Rider | null;
  dispose(): void;
}

/** Settings → Controls (browser-local, model/prefs.ts); read every frame / mouse move, so changes apply at once. */
export interface ControlPrefs { mouseSens: number; invertY: boolean; headBob: boolean; sprintToggle: boolean }
const DEFAULT_CONTROLS: ControlPrefs = { mouseSens: 1, invertY: false, headBob: true, sprintToggle: false };

export function createController(ctx: SceneCtx, canvas: HTMLCanvasElement, prefs: () => ControlPrefs = () => DEFAULT_CONTROLS): Controller {
  const p = ctx.player;
  /** sprint latched by Shift when Settings → sprint toggle is on (released when you stop moving) */
  let sprintLatch = false;
  const keys = new Set<string>();
  const vel = new THREE.Vector3();
  let vy = 0, grounded = true, bob = 0, lastStep = 0, look: { yaw: number; pitch: number } | null = null;
  const stepFns = new Set<(speed: number, surface: 'grass' | 'water' | 'wood') => void>();
  let sens = 0.0022;
  let flying = false;
  const flyPos = new THREE.Vector3(), flyVel = new THREE.Vector3(), body = { yaw: 0, pitch: 0 };
  const flyDir = new THREE.Vector3();
  let seat: { x: number; z: number; y: number; yaw: number } | null = null, onStand: (() => void) | null = null, sitK = 0;
  const sitFrom = new THREE.Vector3();
  let rider: Rider | null = null, onRideEnd: (() => void) | null = null;
  const rideIn: RideInput = { fwd: 0, side: 0, sprint: false, jump: false };
  const rideOut: RideOut = { eye: EYE, roll: 0, vx: 0, vz: 0 };
  const endRide = () => {
    if (!rider) return;
    const fn = onRideEnd;
    rider = null; onRideEnd = null;
    vel.set(rideOut.vx, 0, rideOut.vz); vy = 0; grounded = true;
    rideOut.roll = 0;
    fn?.();
  };
  const stand = () => {
    if (!seat) return;
    const fn = onStand;
    seat = null; onStand = null;
    vel.set(0, 0, 0);
    fn?.();
  };

  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (p.frozen && down) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (down && !e.repeat && (e.code === 'ShiftLeft' || e.code === 'ShiftRight') && prefs().sprintToggle) sprintLatch = !sprintLatch;
    if (down) keys.add(e.code); else keys.delete(e.code);
  };
  const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
  const blur = () => keys.clear();
  const mm = (e: MouseEvent) => {
    if (p.frozen || document.pointerLockElement !== canvas) return;
    // a zero-delta move is no look input (headless Chromium sends one every frame once the pointer re-locks); don't
    // let it cancel a pending lookAt (dev hooks, tests, sitting down)
    if (!e.movementX && !e.movementY) return;
    look = null;
    const c = prefs(), k = sens * c.mouseSens;
    p.yaw -= e.movementX * k;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - e.movementY * k * (c.invertY ? -1 : 1)));
  };
  const click = () => { if (!p.frozen && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {}); };
  addEventListener('keydown', kd);
  addEventListener('keyup', ku);
  addEventListener('blur', blur);
  addEventListener('mousemove', mm);
  canvas.addEventListener('click', click);

  const indoors = (): IndoorSpace | null => { const r = ctx.services.get('indoors') as IndoorSpace | undefined; return r?.active ? r : null; };
  const walkable = (x: number, z: number): boolean => {
    const room = indoors();
    if (room) return room.floor(x, z, p.pos.y) !== null;
    // a deck you can step onto carries you over anything (the summit trail's staircase and rope bridge, docks)
    const deck = (ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined)?.(x, z);
    if (deck != null && deck < p.pos.y + 0.65) return true;
    if (Math.hypot(x, z) > MAX_R) return false;
    const h = heightAt(x, z);
    if (h < WORLD.water - 0.75) return false; // deep water
    return 1 - normalAt(x, z, 0.6).y < MAX_SLOPE;
  };

  const place = () => {
    p.eye.set(p.pos.x, p.pos.y + EYE, p.pos.z);
    ctx.camera.position.copy(p.eye);
    ctx.camera.rotation.set(p.pitch, p.yaw, 0);
  };
  place();

  return {
    update(f) {
      const dt = Math.min(f.dt, 0.05);
      if (p.frozen) keys.clear();
      if (look) {
        p.yaw = dampAngle(p.yaw, look.yaw, 6, dt);
        p.pitch = damp(p.pitch, look.pitch, 6, dt);
        if (Math.abs(p.yaw - look.yaw) < 0.01 && Math.abs(p.pitch - look.pitch) < 0.01) look = null;
      }
      const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const toggle = prefs().sprintToggle;
      if (!toggle || (!fwd && !side)) sprintLatch = false;
      const sprint = toggle ? sprintLatch : keys.has('ShiftLeft') || keys.has('ShiftRight');
      if (flying) {
        // free camera: along the view (pitch included), Space / C for straight up / down; eased so moves glide
        const rise = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0);
        const sp = sprint ? 16 : 4.5;
        const cp = Math.cos(p.pitch);
        flyDir.set(-Math.sin(p.yaw) * cp * fwd + Math.cos(p.yaw) * side, Math.sin(p.pitch) * fwd + rise, -Math.cos(p.yaw) * cp * fwd - Math.sin(p.yaw) * side);
        if (flyDir.lengthSq() > 1) flyDir.normalize();
        flyVel.x = damp(flyVel.x, flyDir.x * sp, 4, dt); flyVel.y = damp(flyVel.y, flyDir.y * sp, 4, dt); flyVel.z = damp(flyVel.z, flyDir.z * sp, 4, dt);
        flyPos.addScaledVector(flyVel, dt);
        // keep out of the ground and inside the valley's bowl
        flyPos.y = Math.max(flyPos.y, Math.max(heightAt(flyPos.x, flyPos.z), WORLD.water) + 0.3);
        const r = Math.hypot(flyPos.x, flyPos.z);
        if (r > WORLD.half - 10) flyPos.multiplyScalar((WORLD.half - 10) / r);
        flyPos.y = Math.min(flyPos.y, 160);
        ctx.camera.position.copy(flyPos);
        ctx.camera.rotation.set(p.pitch, p.yaw, 0);
        p.speed = 0;
        return;
      }
      if (rider) {
        rideIn.fwd = fwd; rideIn.side = side; rideIn.sprint = sprint; rideIn.jump = keys.has('Space');
        let on = false;
        try { on = rider.ride(dt, rideIn, rideOut); } catch (e) { console.error('[controller] rider threw', e); }
        if (on) {
          p.eye.set(p.pos.x, p.pos.y + rideOut.eye, p.pos.z);
          ctx.camera.position.copy(p.eye);
          ctx.camera.rotation.set(p.pitch, p.yaw, rideOut.roll);
          return;
        }
        endRide();
      }
      if (seat) {
        // seated: ease onto the seat; any move key or Space stands up
        if (fwd || side || keys.has('Space')) { keys.delete('Space'); stand(); }
        else {
          sitK = Math.min(1, sitK + dt / 0.55);
          const e = sitK * sitK * (3 - 2 * sitK);
          const gy = heightAt(seat.x, seat.z);
          p.pos.set(sitFrom.x + (seat.x - sitFrom.x) * e, gy, sitFrom.z + (seat.z - sitFrom.z) * e);
          p.eye.set(p.pos.x, sitFrom.y + EYE + (seat.y + SIT_EYE - sitFrom.y - EYE) * e, p.pos.z);
          p.speed = 0;
          ctx.camera.position.copy(p.eye);
          ctx.camera.rotation.set(p.pitch, p.yaw, 0);
          return;
        }
      }
      const room = indoors();
      const h0 = heightAt(p.pos.x, p.pos.z);
      const wading = !room && h0 < WORLD.water - 0.1;
      const max = (sprint ? SPRINT : WALK) * (wading ? 0.45 : 1);
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      let tx = -sy * fwd + cy * side, tz = -cy * fwd - sy * side;
      const tl = Math.hypot(tx, tz);
      if (tl > 0) { tx = (tx / tl) * max; tz = (tz / tl) * max; }
      const a = grounded ? ACCEL : ACCEL * 0.3;
      vel.x = damp(vel.x, tx, a, dt);
      vel.z = damp(vel.z, tz, a, dt);
      // horizontal move with per-axis rejection so we slide along cliffs and water edges
      const nx = p.pos.x + vel.x * dt, nz = p.pos.z + vel.z * dt;
      if (walkable(nx, nz)) { p.pos.x = nx; p.pos.z = nz; }
      else if (walkable(nx, p.pos.z)) { p.pos.x = nx; vel.z = 0; }
      else if (walkable(p.pos.x, nz)) { p.pos.z = nz; vel.x = 0; }
      else { vel.x = 0; vel.z = 0; }
      if (room) room.resolve(p.pos, RADIUS); else ctx.colliders.resolve(p.pos, RADIUS);
      // vertical
      if (grounded && keys.has('Space')) { vy = JUMP_V; grounded = false; }
      const ground = room ? room.floor(p.pos.x, p.pos.z, p.pos.y) ?? p.pos.y : Math.max(heightAt(p.pos.x, p.pos.z), WORLD.water - 0.6);
      const walk = room ? ground : (ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined)?.(p.pos.x, p.pos.z) ?? null;
      const floor = walk !== null ? Math.max(ground, walk) : ground;
      if (!grounded) {
        vy -= GRAVITY * dt;
        p.pos.y += vy * dt;
        if (p.pos.y <= floor) { p.pos.y = floor; grounded = true; vy = 0; }
      } else {
        // follow the ground; step down smoothly, up instantly
        p.pos.y = floor > p.pos.y ? floor : damp(p.pos.y, floor, 18, dt);
      }
      p.speed = Math.hypot(vel.x, vel.z);
      // head bob, phase-locked footsteps
      let bobY = 0, bobX = 0;
      if (grounded && p.speed > 0.3) {
        const hz = 1.6 + p.speed * 0.12;
        bob += bobAdvance(dt, hz);
        const s = bobShape(bob);
        const amp = Math.min(1, p.speed / WALK);
        // Settings: head bob off, or reduced motion (the footsteps keep their rhythm either way)
        const bk = !prefs().headBob ? 0 : ctx.comfort.reducedMotion ? 0.25 : 1;
        bobY = s.y * 0.045 * amp * bk; bobX = s.x * 0.02 * amp * bk;
        const si = stepIndex(bob);
        if (si !== lastStep) {
          lastStep = si;
          const surface = walk !== null && walk >= ground ? 'wood' : wading ? 'water' : 'grass';
          for (const fn of stepFns) fn(p.speed, surface);
        }
      }
      p.eye.set(p.pos.x + Math.cos(p.yaw) * bobX, p.pos.y + EYE + bobY, p.pos.z - Math.sin(p.yaw) * bobX);
      ctx.camera.position.copy(p.eye);
      ctx.camera.rotation.set(p.pitch, p.yaw, 0);
    },
    teleport(x, z, yaw, pitch) {
      stand();
      endRide();
      p.pos.set(x, indoors()?.floor(x, z) ?? heightAt(x, z), z);
      if (yaw !== undefined) p.yaw = yaw;
      if (pitch !== undefined) p.pitch = pitch;
      vel.set(0, 0, 0); vy = 0; grounded = true; look = null;
      place();
    },
    lookAt(x, y, z) {
      const dx = x - p.eye.x, dy = y - p.eye.y, dz = z - p.eye.z;
      look = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    },
    onStep(fn) { stepFns.add(fn); return () => stepFns.delete(fn); },
    lockPointer() { canvas.requestPointerLock?.()?.catch?.(() => {}); },
    fly(on) {
      if (on === flying) return;
      flying = on;
      keys.clear();
      if (on) { flyPos.copy(ctx.camera.position); flyVel.set(0, 0, 0); body.yaw = p.yaw; body.pitch = p.pitch; look = null; }
      else { p.yaw = body.yaw; p.pitch = body.pitch; place(); }
    },
    get flying() { return flying; },
    sit(at, fn) {
      if (!at) { stand(); return; }
      if (seat) { const old = onStand; onStand = null; old?.(); }
      seat = { ...at }; onStand = fn ?? null; sitK = 0;
      sitFrom.copy(p.pos);
      vel.set(0, 0, 0); vy = 0; grounded = true;
      // turn to face the way the seat faces, eyes a touch down (into the fire)
      look = { yaw: Math.atan2(-Math.sin(at.yaw), -Math.cos(at.yaw)), pitch: -0.16 };
    },
    get seated() { return seat !== null; },
    ride(r, fn) {
      if (rider === r) { onRideEnd = fn ?? onRideEnd; return; }
      endRide();
      if (!r) return;
      stand();
      rider = r; onRideEnd = fn ?? null;
      rideOut.eye = EYE; rideOut.roll = 0; rideOut.vx = 0; rideOut.vz = 0;
      vel.set(0, 0, 0); vy = 0; grounded = true;
    },
    get riding() { return rider; },
    dispose() {
      removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', blur);
      removeEventListener('mousemove', mm); canvas.removeEventListener('click', click);
      sens = 0;
    },
  };
}
