/**
 * Shelly animator (ART §5.6/§6.3, DESIGN §6.7): same API as the Clawd animator. Wheel roll from real root motion,
 * lean into acceleration with overshoot, a lagging accordion neck and a whipping antenna; the CRT squashes on hops;
 * head-mounted noodle arms from the pose's arm channels (Shelly activities in their own head frame; Clawd-style
 * reactions remapped so "arms up" still reads); held props; phosphor glyph faces with a blinking cursor for a blink;
 * the antenna bulb shows green idle / amber busy / red flash on error. Owner: CHR.
 */
import * as THREE from 'three';
import { CH, createPose, resetPose, blendInto, MASK_ALL, ARM_REST, type Pose } from './pose.ts';
import { Spring1D, SPRING, Jiggle } from './springs.ts';
import { noise1 } from './noise.ts';
import { activity, type ActivityArgs } from './activities/index.ts';
import { reaction } from './reactions.ts';
import { aimStroke, nodeData } from '../rig/build.ts';
import { WHEEL_R, HIP_Y, type ShellyRig } from '../rig/shelly.ts';
import type { Animator, AnimatorOptions, AnimDebug, Layer, Playing } from './animator.ts';
import { SHELLY_ARM } from './ik.ts';
import { STATUS } from '../../../../shared/palette.ts';
const LOD_STEP = 1 / 20; // [CHR fix r3] mirrors animator.ts LOD_STEP (a circular import otherwise)

const TAU = Math.PI * 2;
const C_SHELL = new THREE.Color(STATUS.shell), C_BUSY = new THREE.Color(STATUS.shellBusy), C_BLOCKED = new THREE.Color(STATUS.blocked);
/** Max forward pitch of Shelly's head (hips + neck), ≈ 35°: the screen keeps facing the viewer in a bow. */
export const HEAD_PITCH_MAX = 0.61;
const W = 0.018; // stroke width
const DOT = 0.042; // dot-eye diameter
/**
 * Glyph faces as segments [x0, y0, x1, y1, width?] in screen metres (screen 0.29 × 0.21, origin centre). A
 * zero-length segment is a round dot.
 */
type Seg = readonly number[];
const GLYPHS: Record<string, readonly Seg[]> = {
  prompt: [[-0.105, 0.05, -0.045, 0.0], [-0.045, 0.0, -0.105, -0.05]],
  cursor: [[0.0, -0.05, 0.08, -0.05]],
  happy: [[-0.11, -0.0, -0.08, 0.045], [-0.08, 0.045, -0.05, -0.0], [0.05, -0.0, 0.08, 0.045], [0.08, 0.045, 0.11, -0.0], [-0.03, -0.06, 0.03, -0.06]],
  error: [[-0.11, 0.045, -0.05, -0.015], [-0.11, -0.015, -0.05, 0.045], [0.05, 0.045, 0.11, -0.015], [0.05, -0.015, 0.11, 0.045], [-0.03, -0.06, 0.03, -0.06]],
  sleepy: [[-0.11, 0.01, -0.05, 0.01], [0.05, 0.01, 0.11, 0.01], [-0.02, -0.055, 0.02, -0.055]],
  surprised: [[-0.08, 0.02, -0.08, 0.02, 0.06], [0.08, 0.02, 0.08, 0.02, 0.06], [0, -0.06, 0, -0.06, 0.03]],
  strain: [[-0.11, 0.05, -0.06, 0.02], [-0.06, 0.02, -0.11, -0.01], [0.11, 0.05, 0.06, 0.02], [0.06, 0.02, 0.11, -0.01], [-0.03, -0.06, 0.03, -0.06]],
  love: [[-0.07, 0.05, -0.12, 0.0], [-0.12, 0.0, -0.07, -0.05], [-0.02, 0.05, -0.02, -0.05], [0.02, 0.05, 0.07, 0.05], [0.07, 0.05, 0.07, 0.0], [0.07, 0.0, 0.02, 0.0], [0.07, 0.0, 0.07, -0.05], [0.07, -0.05, 0.02, -0.05]],
  insert: [[-0.07, 0.05, -0.07, 0.05, 0.03], [-0.07, 0.015, -0.07, -0.05], [0.0, -0.05, 0.08, -0.05]],
};
const FACE_MAP: Record<string, string> = {
  neutral: 'prompt', focused: 'busy', determined: 'strain', happy: 'happy', celebrate: 'happy', love: 'love', worried: 'strain',
  surprised: 'surprised', sleepy: 'sleepy', dizzy: 'error',
};
const SELF = new Set(['prompt', 'busy', 'watch', 'talk', 'insert', 'happy', 'error', 'sleepy', 'surprised', 'strain', 'love']);

/** Clawd arm raise (rest 1.15 = side nubs out) → Shelly's hanging cable arms (rest 0.3), π stays straight up. */
const mapRaise = (r: number): number => (r >= ARM_REST ? 0.3 + (r - ARM_REST) * (Math.PI - 0.3) / (Math.PI - ARM_REST) : (r * 0.3) / ARM_REST);

export function createShellyAnimator(rig: ShellyRig, _o: AnimatorOptions = {}): Animator {
  const pers = rig.pers;
  const seed = pers.seed;
  const lodPhase = ((seed >>> 0) % 997) / 997; // [CHR fix r3] 20 Hz LOD cadence stagger
  // [CHR m2 r2 alloc] per-frame float state as fixed double fields (a closure `let` re-boxes a HeapNumber per store)
  const S = { lodAcc: LOD_STEP * lodPhase, t: pers.phase * 23, speedCmd: 0, speed: 0, dist: 0, prevHipY: 0, prevHipV: 0,
    dt: 0, l: 0, lr: 0, accFwd: 0, accLat: 0, ha: 0, jx: 0, jy: 0 };
  const debug: AnimDebug = { action: null, face: null, reactions: [], speed: 0 };
  const P = createPose(), A = createPose(), Rp = createPose(), Prev = createPose();
  const prevPos = new THREE.Vector3(), vel = new THREE.Vector3(), acc = new THREE.Vector3();
  let havePrev = false;
  let cur: Layer | null = null;
  let prev: Layer | null = null;
  let react: Playing | null = null;
  let baseFace: string | null = null, lastProp: string | null | undefined;
  const lean = new Spring1D(SPRING.bouncy), leanR = new Spring1D(SPRING.bouncy);
  const neck = [0, 1].map(() => new Spring1D({ f: 2.6, z: 0.22 })), neckR = [0, 1].map(() => new Spring1D({ f: 2.6, z: 0.22 }));
  const sqS = new Spring1D({ f: 4, z: 0.25 });
  const lookX = new Spring1D({ f: 7, z: 0.7 }), lookY = new Spring1D({ f: 7, z: 0.7 });
  const ant = new Jiggle(SPRING.bouncy, 0.12);
  const tmp = new THREE.Vector3();
  const act: ActivityArgs = { amp: 1, seed, energy: pers.energy, dt: 0, variant: 0, crown: 0.25, seated: false }; // crown: Clawd-frame stand-in so arms-up poses stay short on the CRT
  const bulbTint = new THREE.Color(), phosphor = new THREE.Color(), ledTint = new THREE.Color();
  for (const p of rig.strokeParts) p.tint = phosphor;
  if (rig.bulbPart) rig.bulbPart.tint = bulbTint;
  if (rig.ledPart) rig.ledPart.tint = ledTint;
  const tmp2 = new THREE.Vector3();

  // [CHR m2 r2 alloc] glyph segments: a fixed pool of [x0, y0, x1, y1, w] records + a count (no per-frame arrays)
  const segs = Array.from({ length: Math.max(16, rig.strokes.length) }, () => [0, 0, 0, 0, W]);
  let segN = 0;
  const seg = (x0: number, y0: number, x1: number, y1: number, w: number) => { if (segN >= segs.length) return; const r = segs[segN++]; r[0] = x0; r[1] = y0; r[2] = x1; r[3] = y1; r[4] = w; };
  const segOf = (g: Seg) => seg(g[0], g[1], g[2], g[3], g[4] ?? W);
  const setStrokes = (jx: number, jy: number) => {
    for (let i = 0; i < rig.strokes.length; i++) {
      const n = rig.strokes[i];
      const on = i < segN;
      n.visible = on;
      if (on) { const s = segs[i]; aimStroke(n, s[0] + jx, s[1] + jy, s[2] + jx, s[3] + jy, s[4]); }
    }
  };
  /** Remap Clawd-frame arm raise channels to Shelly's cable arms (reactions / generic activities). */
  const remap = (pose: Pose) => { pose.f[CH.aLr] = mapRaise(pose.f[CH.aLr]); pose.f[CH.aRr] = mapRaise(pose.f[CH.aRr]); };

  const api: Animator = {
    debug,
    setLocomotion(s) { S.speedCmd = Math.max(0, s || 0); },
    setGait() {},
    setAction(id) {
      if ((cur?.id ?? null) === (id ?? null)) return;
      const def = activity(id);
      if (cur) prev = { ...cur };
      cur = id && def && def.mask ? { def, t: 0, w: 0, id } : null;
      debug.action = id;
    },
    react(id, ro = {}) {
      debug.reactions.push(id); if (debug.reactions.length > 8) debug.reactions.shift();
      const def = reaction(id);
      if (def) react = { def, t: 0, variant: ro.variant ?? 0 };
    },
    setFace(expr) { baseFace = expr; debug.face = expr; },
    lookAt() {},
    setEnergy() {},
    setTraits() {},
    get traits() { return {}; },
    update(dtIn, lod = 0) {
      // [CHR fix r3] §5.3 LOD cadence (see animator.ts): lod ≥ 1 re-poses at 20 Hz, staggered; charBatch reuses meanwhile.
      if (lod >= 1) {
        S.lodAcc += Math.max(dtIn, 0);
        if (S.lodAcc < LOD_STEP - 1e-6 && (rig.poseSerial ?? 0) > 0) return;
        dtIn = S.lodAcc; S.lodAcc = 0;
      } else S.lodAcc = LOD_STEP * lodPhase;
      rig.poseSerial = ((rig.poseSerial ?? 0) | 0) + 1;
      S.dt = Math.min(Math.max(dtIn, 0), 0.1);
      // [CHR m2 r2 alloc] split into small steps that pass no doubles (see animator.ts update)
      stepMotion();
      stepLayers();
      writeBody();
      writeArms();
      writeProps();
      writeFace();
      rig.smear = react?.def.smear ? 1 : 0;
      debug.speed = S.speed;
    },
  };

  function stepMotion() {
    const dt = S.dt;
    S.t += dt;
    const root = rig.root;
    if (havePrev && dt > 0) {
      const d = root.position.distanceTo(prevPos);
      if (d < 1) {
        tmp.subVectors(root.position, prevPos).divideScalar(dt);
        acc.lerp(tmp2.copy(tmp).sub(vel).divideScalar(dt), Math.min(1, dt * 12));
        vel.copy(tmp);
        S.dist += d;
      }
    }
    prevPos.copy(root.position); havePrev = true;
    const vh = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    S.speed += (Math.max(vh, S.speedCmd) - S.speed) * Math.min(1, dt * 8);
    if (S.speedCmd > 0 && vh < 0.01) S.dist += S.speedCmd * dt; // treadmill (sheet)
    const yaw = root.rotation.y;
    S.accFwd = acc.x * Math.sin(yaw) + acc.z * Math.cos(yaw);
    S.accLat = acc.x * Math.cos(yaw) - acc.z * Math.sin(yaw);
  }

  /** Layers: rest (arms hanging) → action → reaction. */
  function stepLayers() {
    const dt = S.dt, t = S.t;
    resetPose(P);
    P.f[CH.aLr] = 0.3; P.f[CH.aRr] = 0.3; P.f[CH.aLb] = 0.3; P.f[CH.aRb] = 0.3;
    P.f[CH.aLp] = 0.1 * Math.sin(t * 1.3 + seed); P.f[CH.aRp] = 0.1 * Math.sin(t * 1.1 + seed + 1);
    if (prev) {
      prev.t += dt; prev.w = (prev.w ?? 1) - dt / 0.25;
      if (prev.w <= 0) prev = null;
      else { resetPose(Prev); prev.def.update(prev.t, Prev, act); if (!prev.def.shelly) remap(Prev); blendInto(P, Prev, prev.w, prev.def.mask); }
    }
    if (cur) {
      cur.t += dt; cur.w = Math.min(1, cur.w + dt / 0.25);
      resetPose(A); cur.def.update(cur.t, A, act);
      if (!cur.def.shelly) remap(A);
      blendInto(P, A, cur.w, cur.def.mask);
    }
    if (react) {
      react.t += dt; act.variant = react.variant;
      resetPose(Rp); react.def.update(react.t, Rp, act); remap(Rp);
      const w = Math.min(1, react.t / 0.1) * Math.min(1, Math.max(0, (react.def.dur - react.t) / 0.3));
      blendInto(P, Rp, w, react.def.mask ?? MASK_ALL);
      if (react.t >= react.def.dur) react = null;
    }
  }

  /** Wheel, hips (lean, hop squash), the lagging neck, the antenna whip. */
  function writeBody() {
    const f = P.f, dt = S.dt, t = S.t;
    rig.nodes.wheel.rotation.x = S.dist / WHEEL_R;
    const hips = rig.nodes.hips;
    const bob = 0.006 * Math.sin(TAU * 0.5 * t + seed) + f[CH.l0y] + 0.012 * Math.abs(Math.sin(S.dist * 9)) * Math.min(1, S.speed);
    const hy = HIP_Y + bob + Math.max(0, f[CH.hipY]) * 0.8;
    hips.position.set(f[CH.hipX] * 0.5, hy, f[CH.hipZ] * 0.5);
    rig.nodes.wheel.position.y = WHEEL_R + Math.max(0, f[CH.hipY]) * 0.8 + f[CH.l0y];
    // hops squash the CRT on landing (follow-through)
    const hv = dt > 0 ? (hy - S.prevHipY) / dt : 0, ha = dt > 0 ? (hv - S.prevHipV) / dt : 0;
    S.prevHipY = hy; S.prevHipV = hv; S.ha = ha;
    if (dt > 0 && Math.abs(ha) < 400) sqS.v += -ha * 0.0008;
    lean.step(dt, Math.max(-0.5, Math.min(0.5, -S.accFwd * 0.07 + S.speed * 0.12)));
    leanR.step(dt, Math.max(-0.3, Math.min(0.3, S.accLat * 0.04)));
    const l = lean.x, lr = leanR.x;
    S.l = l; S.lr = lr;
    hips.rotation.set(l + f[CH.pitch] * 0.5, f[CH.twist] * 0.5, -f[CH.roll] * 0.6 - lr);
    // Neck lags the hips: each segment springs toward counter-lean; the head keeps the rest of the pose.
    // [CHR fix m15-r2] The head's total forward pitch (hips + both neck springs, incl. their overshoot) is capped at
    // HEAD_PITCH_MAX so a bow never turns the screen to the floor: the ^_^ payoff stays readable the whole bow.
    neck[0].step(dt, -l * 0.5 + f[CH.pitch] * 0.35 + 0.03 * noise1(t * 0.4, seed));
    neck[1].step(dt, -l * 0.5 + f[CH.pitch] * 0.35 + 0.03 * noise1(t * 0.4, seed + 1));
    let nx0 = neck[0].x, nx1 = neck[1].x;
    const over = hips.rotation.x + nx0 + nx1 - HEAD_PITCH_MAX;
    if (over > 0) { nx0 -= over * 0.4; nx1 -= over * 0.6; } // the upper segment tips the head back up
    for (let i = 0; i < 2; i++) {
      neckR[i].step(dt, 0.04 * noise1(t * 0.3, seed + 10 + i) - f[CH.roll] * 0.3 + lr * 0.6);
      rig.neck[i].rotation.set(i ? nx1 : nx0, f[CH.twist] * 0.25, neckR[i].x);
    }
    sqS.step(dt, 0);
    const sq = Math.max(0.5, 1 + f[CH.sq] * 0.7 + sqS.x);
    const g = Math.max(0.001, f[CH.grow]);
    rig.nodes.shape.scale.set(g / Math.sqrt(sq), g * sq, g / Math.sqrt(sq));
    rig.root.scale.setScalar(f[CH.grow] < 0.999 ? g : 1);
    // ---- antenna whip ----
    ant.update(dt, -f[CH.roll] * 30 + S.accLat, S.accFwd + f[CH.sq] * 20 + ha * 0.02);
    const an = rig.dyn[0].node, ab = nodeData(an).base.r;
    an.rotation.set(ab.x + ant.sz.x, ab.y, ab.z - ant.sx.x);
  }

  /** Arms in the head frame. */
  function writeArms() {
    const f = P.f, t = S.t, l = S.l, arms = rig.arms;
    for (let ai = 0; ai < arms.length; ai++) {
      const a = arms[ai];
      const s = a.side;
      const p = s < 0 ? f[CH.aLp] : f[CH.aRp], r = s < 0 ? f[CH.aLr] : f[CH.aRr], b = s < 0 ? f[CH.aLb] : f[CH.aRb], len = s < 0 ? f[CH.aLs] : f[CH.aRs];
      a.pivot.rotation.set(-p - l * 0.6, 0, s * r + 0.06 * Math.sin(t * 2 + s));
      a.elbow.rotation.x = -b;
      a.fore.scale.y = Math.max(0.3, len);
      a.hand.position.y = -SHELLY_ARM.fore * Math.max(0.3, len);
      const grip = P.prop ? 0.15 : 0.45 + 0.1 * Math.sin(t * 1.7 + s);
      a.fingers[0].rotation.z = -grip; a.fingers[1].rotation.z = grip;
    }
  }

  function writeProps() {
    const f = P.f;
    const want = P.prop && rig.props[P.prop] ? P.prop : null;
    if (want !== lastProp) { for (const id in rig.props) rig.props[id].root.visible = id === want; lastProp = want; }
    if (want) {
      const pr = rig.props[want];
      pr.root.position.set(f[CH.propX], f[CH.propY], f[CH.propZ]);
      pr.root.rotation.set(f[CH.propRx], f[CH.propRy], f[CH.propRz]);
      pr.update?.(f, S.t);
    }
  }

  /** Phosphor glyph face + antenna bulb / LED tint + knobs. */
  function writeFace() {
    const f = P.f, dt = S.dt, t = S.t;
    const rf = react?.def.face ? FACE_MAP[react.def.face] ?? null : null;
    const pf = P.face ? (SELF.has(P.face) ? P.face : FACE_MAP[P.face]) : null;
    const bf = baseFace && baseFace !== 'neutral' && baseFace !== 'focused' ? FACE_MAP[baseFace] ?? null : null;
    const af = cur?.def.face ? (SELF.has(cur.def.face) ? cur.def.face : FACE_MAP[cur.def.face]) : null;
    // sleepy / dizzy / love base faces win over the activity's own glyph; neutral/focused let the activity speak
    const face = rf ?? pf ?? bf ?? af ?? (baseFace === 'focused' ? 'busy' : 'prompt');
    const busy = face === 'busy' || face === 'strain' || (cur && cur.id !== 'cursorTap' && face !== 'sleepy');
    phosphor.copy(busy ? C_BUSY : C_SHELL); // [CHR m2 r2 alloc] pre-parsed colours (Color.set(string) parses a style)
    const errFlash = face === 'error' && (t % 0.5) < 0.25;
    bulbTint.copy(errFlash ? C_BLOCKED : busy ? C_BUSY : C_SHELL);
    ledTint.copy(bulbTint);
    lookX.step(dt, Math.max(-1, Math.min(1, f[CH.lookX]))); lookY.step(dt, Math.max(-1, Math.min(1, f[CH.lookY])));
    segN = 0;
    let jx = 0, jy = 0;
    if (face === 'busy') {
      // braille-ish spinner: 8 dots, the lit head sweeping round
      for (let i = 0; i < 8; i++) {
        const a0 = (i * TAU) / 8, head = ((t * 1.6) % 1) * 8;
        const age = ((head - i) % 8 + 8) % 8;
        const w = 0.012 + 0.028 * Math.max(0, 1 - age / 5);
        seg(Math.cos(-a0) * 0.06, Math.sin(-a0) * 0.06, Math.cos(-a0) * 0.06, Math.sin(-a0) * 0.06, w);
      }
    } else if (face === 'prompt') {
      for (let i = 0; i < GLYPHS.prompt.length; i++) segOf(GLYPHS.prompt[i]);
      if ((t % 1.1) < 0.6) segOf(GLYPHS.cursor[0]); // cursor blink = Shelly's blink
    } else if (face === 'watch' || face === 'talk') {
      const ex = lookX.x * 0.035, ey = lookY.x * 0.03;
      const blink = (t + seed) % 3.7 < 0.12;
      for (let side = -1; side <= 1; side += 2) {
        const x = side * 0.07 + ex, y = 0.02 + ey;
        if (blink) seg(x - 0.025, y, x + 0.025, y, W); else seg(x, y, x, y, DOT);
      }
      if (face === 'talk') { if ((t % 0.3) < 0.15) seg(ex, -0.06, ex, -0.06, 0.035); else seg(ex - 0.025, -0.06, ex + 0.025, -0.06, W); }
    } else {
      const gl = GLYPHS[face] ?? GLYPHS.prompt;
      for (let i = 0; i < gl.length; i++) segOf(gl[i]);
      if (face === 'sleepy') {
        jy = 0.006 * Math.sin(t * 1.3);
        const zt = (t * 0.5) % 1, zx = 0.07 + 0.03 * zt, zy = 0.03 + 0.05 * zt, zs = 0.018 * (1 - zt * 0.4);
        seg(zx - zs, zy + zs, zx + zs, zy + zs, 0.01); seg(zx + zs, zy + zs, zx - zs, zy - zs, 0.01); seg(zx - zs, zy - zs, zx + zs, zy - zs, 0.01);
      }
      if (face === 'error') jx = 0.004 * Math.sin(t * 50);
    }
    S.jx = jx; S.jy = jy;
    setStrokes(S.jx, S.jy);
    for (let i = 0; i < rig.knobs.length; i++) rig.knobs[i].rotation.x += dt * (busy ? 5 : 0.3);
  }
  api.update(0);
  return api;
}
