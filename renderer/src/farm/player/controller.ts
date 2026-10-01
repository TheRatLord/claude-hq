/**
 * First-person walker for the valley: pointer-lock mouse look, WASD, sprint, jump, terrain following, structure
 * collision, no swimming (deep water and cliffs push back), footstep-locked head bob.
 * Movement pauses whenever a modal UI owns the input (`player.frozen`).
 * Fly mode (photo mode): the camera leaves the body and flies freely (WASD along the view, Space up, C down, Shift
 * fast, no collision); leaving it snaps the view back to where you stood.
 */
import * as THREE from 'three';
import type { FrameInfo, SceneCtx } from '../scene/context.ts';
import { WORLD, heightAt, normalAt } from '../world/map.ts';
import { bobAdvance, bobShape, stepIndex } from '../../player/feel.ts';
import { damp, dampAngle } from '../../core/math.ts';

const EYE = 1.62;
const RADIUS = 0.35;
const WALK = 4.6, SPRINT = 8.2, ACCEL = 10, JUMP_V = 5.2, GRAVITY = 16;
const MAX_SLOPE = 0.42; // 1 − normal.y above which ground is a wall
const MAX_R = 128; // hard boundary (the mountains are steeper than this anyway)

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
  dispose(): void;
}

export function createController(ctx: SceneCtx, canvas: HTMLCanvasElement): Controller {
  const p = ctx.player;
  const keys = new Set<string>();
  const vel = new THREE.Vector3();
  let vy = 0, grounded = true, bob = 0, lastStep = 0, look: { yaw: number; pitch: number } | null = null;
  const stepFns = new Set<(speed: number, surface: 'grass' | 'water' | 'wood') => void>();
  let sens = 0.0022;
  let flying = false;
  const flyPos = new THREE.Vector3(), flyVel = new THREE.Vector3(), body = { yaw: 0, pitch: 0 };
  const flyDir = new THREE.Vector3();

  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (p.frozen && down) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (down) keys.add(e.code); else keys.delete(e.code);
  };
  const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
  const blur = () => keys.clear();
  const mm = (e: MouseEvent) => {
    if (p.frozen || document.pointerLockElement !== canvas) return;
    look = null;
    p.yaw -= e.movementX * sens;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - e.movementY * sens));
  };
  const click = () => { if (!p.frozen && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {}); };
  addEventListener('keydown', kd);
  addEventListener('keyup', ku);
  addEventListener('blur', blur);
  addEventListener('mousemove', mm);
  canvas.addEventListener('click', click);

  const walkable = (x: number, z: number): boolean => {
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
      const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
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
      const h0 = heightAt(p.pos.x, p.pos.z);
      const wading = h0 < WORLD.water - 0.1;
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
      ctx.colliders.resolve(p.pos, RADIUS);
      // vertical
      if (grounded && keys.has('Space')) { vy = JUMP_V; grounded = false; }
      const ground = Math.max(heightAt(p.pos.x, p.pos.z), WORLD.water - 0.6);
      const walk = (ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined)?.(p.pos.x, p.pos.z) ?? null;
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
        bobY = s.y * 0.045 * amp; bobX = s.x * 0.02 * amp;
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
      p.pos.set(x, heightAt(x, z), z);
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
    dispose() {
      removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', blur);
      removeEventListener('mousemove', mm); canvas.removeEventListener('click', click);
      sens = 0;
    },
  };
}
