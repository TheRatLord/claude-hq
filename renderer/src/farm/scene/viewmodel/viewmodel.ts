/**
 * The first-person viewmodel (system 'viewmodel', service 'hands' = HandsPort): your own two orange mitten-paws in a
 * knitted sleeve, holding whatever you are doing and gesturing when you do things. The brain is pure (logic.ts:
 * which item / mode / gesture); this file poses and draws it.
 *
 * Drawing: the paws live in the main scene (so the sun and sky, the lamp pools, the barn's lanterns, the
 * grade all light them like everything else; the weather's wet sheen is left off) but every vertex is projected with the viewmodel's own
 * small field of view (`VM_FOV`, unaffected by Settings → FOV, the summit viewer's zoom or photo zoom) and its depth is
 * squeezed into the first ~0.3 m in front of the camera (`vmDepth`), so they never clip into a wall, a fence or a
 * farmer, and the post pass inks their outline like any silhouette. They draw after everything else (transparent
 * list, `NoBlending`, so they are opaque and still beat the summit viewer's mask). ≤ 4 draws: left paw (+ its item),
 * right paw (+ its item), the lantern glass (unlit glow), nothing else. Neither cast nor receive shadows.
 *
 * Motion (all scaled by Settings → head bob and reduced motion): idle breathing sway, a walk bob locked to the
 * controller's footsteps (onStep), an arm pump when sprinting, a spring dip on landing, inertia when you turn, and a
 * pendulum for the hanging lantern / basket. A paw that changes what it holds drops out of view and comes back up.
 *
 * Items in view are FOV-matched to the world where they meet it: the rod tip the fishing line leaves from
 * (`rod()` writes it for forage), the oar grips the boat reports (`oars()`), the lantern's light (a real LightEmitter
 * where the lantern shows on screen).
 */
import * as THREE from 'three';
import type {
  AudioService, FarmerLocator, HandCarry, HandGesture, HandsPort, IndoorSpace, Interactable, LightEmitter, LightsService,
  PhotoService, SceneCtx, SystemFactory,
} from '../context.ts';
import type { Controller } from '../../player/controller.ts';
import type { WalletService } from '../../model/wallet.ts';
import { toonRamp } from '../toon.ts';
import { chainShader } from '../surface/material.ts';
import { warmEmitter } from '../lights/emitters.ts';
import { atmoOf } from '../sky/atmo.ts';
import { ROD_LEN } from '../forage/models.ts';
import { bobAdvance } from '../../../player/feel.ts';

/** player/feel.ts `bobShape` without the object (zero per-frame allocation): vertical / lateral at phase φ */
const bobY = (ph: number) => -0.5 * Math.cos(2 * ph), bobX = (ph: number) => Math.cos(ph);
import {
  emptyInput, emptyOut, gestureK, gestureFor, gestureState, lanternLit, lanternShown, requestGesture, resolveHands, settleLantern,
  stepGesture, toggleLantern,
} from './logic.ts';
import type { LanternMode } from './logic.ts';
import { COIN_REST, GRIP, ITEM_POSE, LANTERN_GLASS, ROD_TILT, handGeometry, lanternGlow } from './models.ts';
import type { PawPose } from './models.ts';
import type { HandItem } from '../context.ts';

/** the viewmodel's own vertical field of view (degrees) */
export const VM_FOV = 50;
/** squeezed depth range (metres, as the post pass reads it): nearest, span */
const D_NEAR = 0.085, D_SPAN = 0.22;
/** the paws' size in view (their geometry is authored a little large) */
const PAW_SCALE = 0.74;

/** a pose: position (camera space, metres) + rotation (radians, order YXZ) */
interface Pose { px: number; py: number; pz: number; rx: number; ry: number; rz: number }
const pose = (): Pose => ({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 });
const setP = (o: Pose, px: number, py: number, pz: number, rx: number, ry: number, rz: number) => { o.px = px; o.py = py; o.pz = pz; o.rx = rx; o.ry = ry; o.rz = rz; return o; };
const copyP = (o: Pose, a: Pose) => setP(o, a.px, a.py, a.pz, a.rx, a.ry, a.rz);
/** right-paw numbers mirrored for the left (side −1) */
const sideP = (o: Pose, s: number, px: number, py: number, pz: number, rx: number, ry: number, rz: number) => setP(o, s * px, py, pz, rx, s * ry, s * rz);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixN = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpP = (o: Pose, a: Pose, b: Pose, k: number) => setP(o, mixN(a.px, b.px, k), mixN(a.py, b.py, k), mixN(a.pz, b.pz, k), mixN(a.rx, b.rx, k), mixN(a.ry, b.ry, k), mixN(a.rz, b.rz, k));

interface Paw {
  side: 1 | -1;
  mesh: THREE.Mesh;
  /** what the mesh shows now / wants to show */
  item: HandItem; poseName: PawPose;
  wantItem: HandItem; wantPose: PawPose; wantShow: boolean;
  /** 0 lowered out of view … 1 up */
  raise: number;
  cur: Pose; target: Pose; shown: Pose;
  /** camera-space matrix of the paw this frame (no allocation: reused) */
  local: THREE.Matrix4;
  /** the swinging part's matrix (paw space): lantern / basket pendulum, the flipped coin */
  part: { value: THREE.Matrix4 };
}

export interface HandsDebug extends HandsPort {
  /** dev / shots: 'wave' | 'grab' | … plays a gesture; 'lantern' toggles; 'basket' shows it; returns the state */
  dev(cmd?: string): unknown;
}

export const viewmodelSystem: SystemFactory = (ctx: SceneCtx) => {
  const root = new THREE.Group();
  root.name = 'viewmodel';
  // the rooms hide the outdoor scene's children while you are inside; the paws come in with you
  root.userData.indoors = true;
  ctx.scene.add(root);

  // ---- materials: the viewmodel projection + depth squeeze on top of the toon (and the lantern glass's glow)
  const vmProj = { value: new THREE.Matrix4() };
  const vmDepth = { value: new THREE.Vector4() };
  const vmFill = { value: new THREE.Vector3() };
  const vmCam = new THREE.PerspectiveCamera(VM_FOV, 16 / 9, 0.01, 10);
  const patch = <M extends THREE.Material>(m: M, part: { value: THREE.Matrix4 }): M => chainShader(m, (sh) => {
    sh.uniforms.vmProj = vmProj; sh.uniforms.vmDepth = vmDepth; sh.uniforms.vmPart = part;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nuniform mat4 vmProj;\nuniform vec4 vmDepth;\nuniform mat4 vmPart;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tif ( aPart > 0.5 ) objectNormal = mat3( vmPart ) * objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tif ( aPart > 0.5 ) transformed = ( vmPart * vec4( transformed, 1.0 ) ).xyz;')
      .replace('#include <project_vertex>', `#include <project_vertex>
	gl_Position = vmProj * mvPosition;
	{
		// squeeze the depth into the first few decimetres (as the main camera's depth reads it): always in front
		float vmL = vmDepth.z + vmDepth.w * ( 1.0 - exp( -max( gl_Position.w - 0.12, 0.0 ) * 2.0 ) );
		gl_Position.z = ( vmDepth.x - vmDepth.y / vmL ) * gl_Position.w;
	}`);
    // no wet sheen / snow / frost on your own paws (weather/surfaces.ts): the sky sheen washed them out, indoors too
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_toon_pars_fragment>', '#include <lights_toon_pars_fragment>\n#undef VW_TOON');
  }, 'viewmodel');
  const pawMat = (part: { value: THREE.Matrix4 }) => {
    // a faint warm fill so the paws still read as yours on a moonless night (the scene's lights do the rest)
    const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp(), emissive: 0x1e140e, transparent: true, blending: THREE.NoBlending });
    m.name = 'viewmodel:paw';
    // the held lantern and the night's ambient fill: the toon ramp's facing term leaves the paw's top and the sleeve
    // (turned away from a lantern hanging below) near black, so add their light as albedo-tinted fill (vmFill)
    return chainShader(patch(m, part), (sh) => {
      sh.uniforms.vmFill = vmFill;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 vmFill;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * vmFill;');
    }, 'viewmodel-fill');
  };

  const mkPaw = (side: 1 | -1): Paw => {
    const part = { value: new THREE.Matrix4() };
    const mesh = new THREE.Mesh(handGeometry(side, 'open', 'none'), pawMat(part));
    mesh.name = side > 0 ? 'viewmodel:right' : 'viewmodel:left';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    // no cast shadows on them: their real position is a hand's length ahead, often inside the wall or the manger you
    // are standing at (the squeezed depth keeps them drawn in front); sun / sky / lamp light still shade them
    mesh.receiveShadow = false;
    mesh.renderOrder = 1000;
    mesh.visible = false;
    root.add(mesh);
    const rest = sideP(pose(), side, 0.2, -0.42, -0.32, 0.7, 0, 0);
    return {
      side, mesh, item: 'none', poseName: 'open', wantItem: 'none', wantPose: 'open', wantShow: false, raise: 0,
      cur: copyP(pose(), rest), target: copyP(pose(), rest), shown: pose(), local: new THREE.Matrix4(), part,
    };
  };
  const L = mkPaw(-1), R = mkPaw(1);
  const glowMat = warmEmitter(patch(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.NoBlending, fog: false }), L.part));
  glowMat.name = 'viewmodel:glow';
  const glow = new THREE.Mesh(lanternGlow(), glowMat);
  glow.name = 'viewmodel:lantern-glass';
  glow.matrixAutoUpdate = false;
  glow.frustumCulled = false;
  glow.renderOrder = 1001;
  glow.visible = false;
  root.add(glow);

  // ---- services we read (all optional)
  const svc = <T>(name: string) => ctx.services.get(name) as T | undefined;
  const controller = () => svc<Controller>('controller');
  const audio = () => svc<AudioService>('audio');
  const atmo = atmoOf(ctx);

  // ---- the brain
  const input = emptyInput(), out = emptyOut();
  const gs = gestureState();
  let lantern: LanternMode = 'auto', lit = false, prevNight = ctx.lighting.night;
  let now = 0, frame = 0;
  let rodFrame = -9, rodSwing = 1.05, oarFrame = -9;
  let carryFrame = -9, carryWhat: HandCarry | null = null;
  let basketFrom = -1, basketUntil = -1;
  let shownLast = false;
  const oarL = new THREE.Vector3(), oarR = new THREE.Vector3();

  // ---- the lantern's light (a real emitter at the lantern as it shows on screen)
  const light: LightEmitter = { pos: new THREE.Vector3(), color: new THREE.Color(1.0, 0.62, 0.3), intensity: 0.95, radius: 7.5, flicker: 0.3, gain: 0, when: 'always' };
  let offLight: (() => void) | null = null;
  let lightK = 0;

  // ---- motion state
  let bob = 0, bobAmp = 0, lastY = ctx.player.pos.y, vy = 0, airborne = false, fallV = 0, airT = 0;
  let dip = 0, dipV = 0, yawV = 0, pitchV = 0, lastYaw = ctx.player.yaw, lastPitch = ctx.player.pitch;
  let swingX = 0, swingZ = 0, swingVX = 0, swingVZ = 0, skatePh = 0, coinSpin = 0;
  const offStep = controller()?.onStep(() => { bob = Math.round(bob / Math.PI) * Math.PI; }) ?? null;

  // ---- events: finds into the basket, farmers celebrating nearby, storms
  const wallet = svc<WalletService>('wallet');
  const offWallet = wallet?.onChange((c) => { if (c.kind === 'stash') { basketFrom = now + 0.75; basketUntil = now + 4.6; } }) ?? null;
  const fp = new THREE.Vector3();
  const offValley = ctx.onValley((e) => {
    if (e.kind !== 'celebrate' && e.kind !== 'finished') return;
    const at = svc<FarmerLocator>('farmers')?.position(e.id);
    if (!at) return;
    fp.subVectors(at, ctx.player.pos);
    const d = Math.hypot(fp.x, fp.z);
    // near enough to see, roughly in front of you
    if (d > 16 || (-Math.sin(ctx.player.yaw) * fp.x - Math.cos(ctx.player.yaw) * fp.z) / (d || 1) < 0.2) return;
    requestGesture(gs, 'cheer', out, now);
  });
  let flashWas = 0;

  // ---- scratch (no per-frame allocation)
  const m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), one = new THREE.Vector3(PAW_SCALE, PAW_SCALE, PAW_SCALE), camInv = new THREE.Matrix4();
  const restP = pose(), rodP = pose();
  const PAWS: readonly Paw[] = [L, R];
  /** the rod tip in paw space */
  const ROD_TIP = new THREE.Vector3(0, (ROD_LEN - 0.17) * Math.cos(ROD_TILT), -(ROD_LEN - 0.17) * Math.sin(ROD_TILT)).add(new THREE.Vector3(GRIP.x, GRIP.y, GRIP.z));
  const PIVOT = new THREE.Vector3(GRIP.x, GRIP.y, GRIP.z);
  let fovK = 1;

  /** camera-space point → where the main camera shows the same screen spot at the same depth (world) */
  const toWorldMatched = (p: THREE.Vector3, out3: THREE.Vector3) => out3.set(p.x * fovK, p.y * fovK, p.z).applyMatrix4(ctx.camera.matrixWorld);
  const composeLocal = (o: THREE.Matrix4, p: Pose) => { e.set(p.rx, p.ry, p.rz, 'YXZ'); q.setFromEuler(e); v.set(p.px, p.py, p.pz); return o.compose(v, q, one); };

  const port: HandsDebug = {
    get shown() { return shownLast; },
    carry(what) { carryFrame = frame; carryWhat = what; return shownLast; },
    rod(swing, tip) {
      rodFrame = frame; rodSwing = swing;
      if (!shownLast) return false;
      ctx.camera.updateMatrixWorld();
      // the paw may still be swapping to the rod: then where it is about to hold it
      if (R.item === 'rod' && R.raise > 0.3) v2.copy(ROD_TIP).applyMatrix4(R.local);
      else { basePose(rodP, R, 'rod', now); v2.copy(ROD_TIP).applyMatrix4(composeLocal(m4, rodP)); }
      toWorldMatched(v2, tip);
      return true;
    },
    oars(l, r) { oarFrame = frame; oarL.copy(l); oarR.copy(r); },
    gesture(g) {
      if (!requestGesture(gs, g, out, now)) return;
      // a wave at someone you are facing: they chirp back
      if (g === 'wave') {
        const f = ctx.interact.focused();
        if (f && (f.kind === 'villager' || f.kind === 'farmer' || f.kind === 'helper')) {
          f.pos(fp);
          setTimeout(() => { try { audio()?.voice(f.id, { pos: fp, mood: 'happy', syllables: 2 }); } catch { /* optional */ } }, 380);
        }
      }
    },
    used(i: Pick<Interactable, 'kind' | 'verb' | 'id' | 'pos'>) {
      const g = gestureFor(i.kind, i.verb);
      if (g) requestGesture(gs, g, out, now);
    },
    lantern() {
      lantern = toggleLantern(lantern, lit);
      lit = lanternLit(lantern, ctx.lighting.night, !!svc<IndoorSpace>('indoors')?.active);
      try { audio()?.play('creak', { volume: 0.25, pitch: lit ? 1.6 : 1.3 }); } catch { /* optional */ }
      return lit && ctx.comfort.hands !== false;
    },
    get lanternLit() { return lit && lanternShown(out); },
    dev(cmd) {
      if (cmd === 'lantern') port.lantern();
      else if (cmd === 'basket') { basketFrom = now; basketUntil = now + 30; }
      else if (cmd && cmd in { grab: 1, pat: 1, wave: 1, cheer: 1, shield: 1, coin: 1, poke: 1 }) { gs.last[cmd as HandGesture] = -1e9; port.gesture(cmd as HandGesture); }
      return { show: out.show, mode: out.mode, left: L.item, right: R.item, gesture: gs.g, k: +gestureK(gs).toFixed(2), lantern, lit: port.lanternLit, raise: [+L.raise.toFixed(2), +R.raise.toFixed(2)] };
    },
  };
  ctx.services.set('hands', port);

  // ---------------------------------------------------------------------------------------------- poses
  /** base pose of a paw for what it holds / the mode (right-paw numbers, mirrored) */
  function basePose(o: Pose, p: Paw, item: HandItem, t: number): void {
    const s = p.side;
    switch (out.mode) {
      case 'telescope': sideP(o, s, 0.135, -0.115, -0.33, 0.5, 0.45, 0.65); return;
      case 'push': sideP(o, s, 0.11, -0.135 + Math.sin(t * 5 + s) * 0.004 * Math.min(1, ctx.player.speed), -0.43, -0.2, 0.15, 0.1); return;
      case 'carry': sideP(o, s, 0.15, -0.135, -0.43, 0.25, 0.25, 1.15); return;
      case 'oars': {
        // the fist round the grip the boat reports, matched from the world into the paw's field of view
        const g = s > 0 ? oarR : oarL;
        if (frame - oarFrame > 2) { sideP(o, s, 0.17, -0.2, -0.36, 0.2, 0, 1.3); return; }
        v.copy(g).applyMatrix4(camInv);
        v.x /= fovK; v.y /= fovK;
        // keep the paws where you can see them (a grip pulled into your chest would leave the view)
        v.z = Math.min(-0.32, Math.max(-0.75, v.z));
        const half = -v.z * Math.tan((VM_FOV * Math.PI) / 360);
        v.y = Math.max(-half * 0.98, Math.min(half * 0.2, v.y));
        sideP(o, s, 0, 0, 0, 0.15, -0.25, 1.35);
        o.px = v.x; o.py = v.y; o.pz = v.z;
        // the grip point (not the wrist) sits on the oar handle
        e.set(o.rx, o.ry, o.rz, 'YXZ'); v2.copy(PIVOT).applyEuler(e).multiplyScalar(PAW_SCALE);
        o.px -= v2.x; o.py -= v2.y; o.pz -= v2.z;
        return;
      }
    }
    switch (item) {
      case 'rod': sideP(o, s, 0.165, -0.16, -0.37, -(rodSwing - ROD_TILT), 0.08, -0.1); return;
      case 'lantern': sideP(o, s, 0.2, -0.04, -0.47, 0.3, 0.4, 0.12); return;   // wrist tipped down: the forearm leaves the view low, not across it
      case 'basket': sideP(o, s, 0.19, -0.03, -0.45, 0.1, 0.35, 0.1); return;
      case 'hay': sideP(o, s, 0.13, -0.125, -0.4, 0.35, 0.25, 2.9); return;
      case 'grain': sideP(o, s, 0.15, -0.14, -0.38, 0.15, 0.05, -0.12); return;
      case 'brush': sideP(o, s, 0.16, -0.13, -0.4, 0.3, 0, -0.15); return;
      default: break;
    }
    if (out.mode === 'skate') {
      // arms swing with the strides, out a little for balance
      const sw = Math.sin(skatePh) * s;
      sideP(o, s, 0.27, -0.2 + Math.max(0, sw) * 0.05, -0.3 - sw * 0.12, 0.3 + sw * 0.4, -0.2, 0.3);
      return;
    }
    // empty paws: out of view, except when they pump while sprinting
    sideP(o, s, 0.2, -0.245, -0.33, 0.55, 0, 0.1);
  }

  /** a gesture's keyframed pose for paw p at progress k (right-paw numbers, mirrored); also picks the paw shape */
  function gesturePose(o: Pose, p: Paw, g: HandGesture, k: number, t: number): PawPose {
    const s = p.side;
    const up = smooth(0, 0.22, k), down = smooth(0.78, 1, k);
    switch (g) {
      case 'grab': {
        // reach out and down, close the paw on it, pull it back (into the basket)
        const reach = smooth(0, 0.42, k), back = smooth(0.52, 0.95, k);
        sideP(o, s, mixN(mixN(0.2, 0.05, reach), 0.0, back), mixN(mixN(-0.26, -0.1, reach), -0.24, back), mixN(mixN(-0.36, -0.44, reach), -0.36, back),
          mixN(mixN(0.4, 0.05, reach), 0.5, back), mixN(0.15, 0.3, back), mixN(0, 0.5, back));
        return k > 0.44 ? 'grip' : 'open';
      }
      case 'pat': {
        const pats = k > 0.25 && k < 0.85 ? Math.abs(Math.sin(((k - 0.25) / 0.6) * Math.PI * 3)) : 0;
        sideP(o, s, mixN(0.2, 0.035, up - down), mixN(-0.3, -0.105, up - down) + pats * 0.025, mixN(-0.36, -0.43, up - down), mixN(0.4, 0.08, up - down) + pats * 0.2, 0.2, -0.05);
        return 'open';
      }
      case 'wave': {
        const w = Math.sin(((k - 0.15) / 0.7) * Math.PI * 3.5) * smooth(0.12, 0.3, k) * (1 - smooth(0.72, 0.88, k));
        sideP(o, s, mixN(0.2, 0.19, up - down), mixN(-0.36, -0.005, up - down), mixN(-0.33, -0.44, up - down), mixN(0.4, 1.42, up - down), 0.05, w * 0.42 - 0.08);
        return 'open';
      }
      case 'cheer': {
        const pump = Math.abs(Math.sin(((k - 0.2) / 0.6) * Math.PI * 2)) * smooth(0.18, 0.3, k) * (1 - smooth(0.7, 0.8, k));
        const both = gs.side === 'both';
        if (s > 0 || !both) {
          sideP(o, s, mixN(0.2, 0.12, up - down), mixN(-0.34, -0.06, up - down) + pump * 0.035, mixN(-0.33, -0.4, up - down), mixN(0.5, 0.1, up - down), 0.15, -0.25);
          return 'thumb';
        }
        sideP(o, s, mixN(0.2, 0.2, up - down), mixN(-0.36, 0.02, up - down) + pump * 0.03, mixN(-0.33, -0.46, up - down), mixN(0.4, 1.35, up - down), 0, 0.15 + pump * 0.2);
        return 'open';
      }
      case 'shield': {
        // paws up in front of the face, peeking between them, a little shiver
        const u = smooth(0, 0.14, k), d = smooth(0.7, 1, k), sh = Math.sin(t * 38) * 0.004 * (1 - d);
        sideP(o, s, mixN(0.2, 0.07, u - d) + sh, mixN(-0.36, -0.015, u - d), mixN(-0.33, -0.3, u - d), mixN(0.4, 1.38, u - d), mixN(0, 0.28, u - d), mixN(0, -0.18, u - d));
        return 'open';
      }
      case 'coin': {
        // a fist with the coin on the thumb, then a flick
        const flick = smooth(0.3, 0.38, k) * (1 - smooth(0.45, 0.75, k));
        sideP(o, s, mixN(0.2, 0.1, up - down), mixN(-0.34, -0.12, up - down) + flick * 0.03, mixN(-0.33, -0.4, up - down), mixN(0.5, 0.12, up - down) + flick * 0.5, 0.1, -0.25);
        return 'grip';
      }
      case 'poke': {
        const r = Math.sin(Math.min(1, k) * Math.PI);
        sideP(o, s, mixN(0.2, 0.06, r), mixN(-0.28, -0.09, r), mixN(-0.36, -0.47, r), mixN(0.4, 0.1, r), 0.15, 0);
        return 'grip';
      }
    }
    return 'open';
  }

  /** the swinging part of paw p (lantern / basket pendulum hanging plumb; the flipped coin's flight), paw space */
  function partMatrix(p: Paw, k: number): void {
    const m = p.part.value;
    if (p.item === 'coin' && gs.g === 'coin') {
      // the flight is up and away in camera space, turned into paw space (the paw barely moves meanwhile)
      const f = smooth(0.32, 0.9, k);
      m4.extractRotation(p.local).transpose();
      v.set(-p.side * 0.04 * f, Math.sin(f * Math.PI) * 0.2 + f * 0.02, -f * 0.9).applyMatrix4(m4).multiplyScalar(1 / PAW_SCALE);
      v.x += p.side * COIN_REST.x; v.y += COIN_REST.y; v.z += COIN_REST.z;
      coinSpin = f * Math.PI * 7;
      const sc = k > 0.88 ? 0 : 1 - f * 0.6;
      e.set(coinSpin, 0, 0, 'YXZ'); q.setFromEuler(e);
      m.compose(v, q, v2.set(sc, sc, sc));
      m4.makeTranslation(-p.side * COIN_REST.x, -COIN_REST.y, -COIN_REST.z);
      m.multiply(m4);
      return;
    }
    if (p.item !== 'lantern' && p.item !== 'basket') { m.identity(); return; }
    // hang plumb in camera space (undo the paw's own rotation), then the pendulum
    m4.extractRotation(p.local).transpose();
    e.set(swingX, 0, swingZ, 'YXZ'); q.setFromEuler(e);
    m4b.makeRotationFromQuaternion(q);
    m.makeTranslation(PIVOT.x, PIVOT.y, PIVOT.z).multiply(m4).multiply(m4b);
    m4.makeTranslation(-PIVOT.x, -PIVOT.y, -PIVOT.z);
    m.multiply(m4);
  }

  // ---------------------------------------------------------------------------------------------- per frame
  return {
    name: 'viewmodel',
    update(f) {
      frame++;
      const dt = Math.min(0.05, f.dt || 1 / 60);
      now = f.time;
      const p = ctx.player, cam = ctx.camera;
      const c = controller();
      const indoors = !!svc<IndoorSpace>('indoors')?.active;
      const reduced = ctx.comfort.reducedMotion;
      const bobK = ctx.comfort.headBob === false ? 0 : reduced ? 0.25 : 1;
      const calm = reduced ? 0.3 : 1;

      // ---- the brain's inputs
      const night = ctx.lighting.night;
      lantern = settleLantern(lantern, prevNight, night);
      prevNight = night;
      lit = lanternLit(lantern, night, indoors);
      const riding = c?.riding ?? null;
      const rowing = !!(svc<{ aboard: boolean }>('rowboat')?.aboard) && !!riding;
      const carrying = frame - carryFrame <= 2 ? carryWhat : null;
      input.enabled = ctx.comfort.hands !== false;
      input.photo = !!svc<PhotoService>('photo')?.on || !!c?.flying;
      input.menu = p.frozen;
      input.viewing = !!svc<{ viewing: boolean }>('trail')?.viewing;
      input.rowing = rowing;
      input.skating = !!riding && !rowing;
      input.rolling = carrying === 'snowball';
      input.decor = carrying === 'decor' || (svc<{ carrying(): number | null }>('yard')?.carrying() ?? null) !== null;
      input.fishing = frame - rodFrame <= 2;
      input.chore = carrying === 'hay' || carrying === 'grain' || carrying === 'brush' ? carrying : null;
      input.lantern = lit;
      input.basket = now >= basketFrom && now < basketUntil;
      resolveHands(input, out);
      stepGesture(gs, out, dt, now);
      // a lightning flash outdoors: paws up (cute, not scary)
      if (atmo.flash > 0.35 && flashWas <= 0.35 && !indoors) requestGesture(gs, 'shield', out, now);
      flashWas = atmo.flash;

      // ---- camera bookkeeping
      cam.updateMatrixWorld();
      camInv.copy(cam.matrixWorld).invert();
      if (Math.abs(vmCam.aspect - cam.aspect) > 1e-4 || frame === 1) {
        vmCam.aspect = cam.aspect; vmCam.updateProjectionMatrix();
        vmProj.value.copy(vmCam.projectionMatrix);
      }
      const n = cam.near, fa = cam.far;
      vmDepth.value.set((fa + n) / (fa - n), (2 * fa * n) / (fa - n), Math.max(D_NEAR, n * 1.06), D_SPAN);
      fovK = Math.tan((cam.fov * Math.PI) / 360) / Math.tan((VM_FOV * Math.PI) / 360);

      // ---- body motion: walk bob locked to the footsteps, airborne / landing, turning inertia
      const speed = p.speed;
      vy = (p.pos.y - lastY) / dt; lastY = p.pos.y;
      // a hop or a drop: airborne until the feet stop moving vertically; a real fall lands with a dip
      if (!riding && !airborne && (vy > 2.2 || vy < -3.5)) { airborne = true; airT = 0; fallV = 0; }
      if (airborne) {
        airT += dt;
        fallV = Math.min(fallV, vy);
        if (Math.abs(vy) < 0.5 && (fallV < -1.5 || airT > 1.5)) {
          if (fallV < -1.5) dipV -= Math.min(0.6, -fallV * 0.08) * calm;
          airborne = false; fallV = 0;
        }
      }
      if (riding) airborne = false;
      const walking = !riding && !airborne && speed > 0.3;
      if (walking) bob += bobAdvance(dt, 1.6 + speed * 0.12);
      bobAmp += ((walking ? Math.min(1.4, speed / 4.6) : 0) - bobAmp) * Math.min(1, dt * 8);
      // the landing spring (underdamped, ω 16, ζ 0.45; exact enough at frame rate)
      dipV += (-dip * 256 - dipV * 14.4) * dt; dip += dipV * dt;
      let dy = p.yaw - lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yawV += (Math.max(-6, Math.min(6, dy / dt)) - yawV) * Math.min(1, dt * 10); lastYaw = p.yaw;
      pitchV += (Math.max(-6, Math.min(6, (p.pitch - lastPitch) / dt)) - pitchV) * Math.min(1, dt * 10); lastPitch = p.pitch;
      const sprinting = walking && speed > 6;
      if (input.skating) skatePh += dt * Math.min(5, 1.2 + speed * 0.55);
      // the lantern / basket pendulum: plumb under gravity (the camera's pitch tips it), kicked by turning and steps
      {
        const tx = -p.pitch * 0.9 + bobY(bob) * 0.25 * bobAmp * bobK + pitchV * 0.04;
        const tz = yawV * 0.07 * calm + bobX(bob) * 0.12 * bobAmp * bobK;
        swingVX += ((tx - swingX) * 38 - swingVX * 3.2) * dt; swingX += swingVX * dt;
        swingVZ += ((tz - swingZ) * 38 - swingVZ * 3.2) * dt; swingZ += swingVZ * dt;
      }

      // ---- per paw: what to show, its pose, the swap
      const show = out.show;
      for (const paw of PAWS) {
        const s = paw.side;
        const side = s > 0 ? 'right' : 'left';
        const gOn = gs.g !== null && (gs.side === side || gs.side === 'both') && (s > 0 ? out.right : out.left) === 'none';
        let item: HandItem = s > 0 ? out.right : out.left;
        let pz: PawPose = ITEM_POSE[item];
        let want = show && (item !== 'none' || out.mode !== 'free' || sprinting);
        if (gOn) {
          item = gs.g === 'coin' ? 'coin' : 'none';
          pz = gesturePose(paw.target, paw, gs.g!, gestureK(gs), now);
          want = show;
        } else {
          basePose(paw.target, paw, item, now);
          if (out.mode === 'telescope' || out.mode === 'oars') pz = 'grip';
          else if (out.mode === 'push' || out.mode === 'carry' || (out.mode === 'skate' && item === 'none')) pz = 'open';
        }
        paw.wantItem = item; paw.wantPose = pz; paw.wantShow = want;
        // a different thing in the paw: down out of view, swap, back up (empty-paw shapes swap at once)
        const same = paw.item === item && paw.poseName === pz;
        const quick = paw.item === 'none' && item === 'none' || item === 'coin' || paw.item === 'coin';
        if (!same && (quick || paw.raise < 0.04)) {
          paw.item = item; paw.poseName = pz;
          paw.mesh.geometry = handGeometry(s, pz, item);
        }
        const up = want && (paw.item === item || quick) ? 1 : 0;
        paw.raise += (up - paw.raise) * Math.min(1, dt * (up ? (gOn ? 18 : 9) : 14));
        if (paw.raise < 0.002) paw.raise = 0;
        // ease toward the target (gestures are keyframed smoothly, so a quick follow keeps them crisp)
        const kf = Math.min(1, dt * (gOn ? 22 : out.mode === 'oars' ? 30 : 12));
        lerpP(paw.cur, paw.cur, paw.target, kf);
        sideP(restP, s, 0.2, -0.42, -0.32, 0.7, 0, 0);
        const r = paw.raise * paw.raise * (3 - 2 * paw.raise);
        lerpP(paw.shown, restP, paw.cur, r);
        // ---- life on top: breathing, the walk bob, the sprint pump, the landing dip, turning inertia
        const sh = paw.shown;
        const sy = bobY(bob), sx = bobX(bob);
        const amp = bobAmp * bobK;
        const breathe = Math.sin(now * 1.7 + s * 0.6) * 0.0035 * (1 - Math.min(1, amp)) * calm;
        sh.py += sy * 0.016 * amp + breathe + dip;
        sh.px += sx * 0.009 * amp;
        sh.rz += Math.sin(now * 0.9 + s) * 0.012 * calm + sx * 0.03 * amp;
        if (sprinting && out.mode === 'free') {
          const pump = Math.cos(bob) * s * Math.min(1, bobK + 0.3);
          sh.pz += pump * 0.055; sh.py += Math.max(0, -pump) * 0.03; sh.rx += pump * 0.25;
        }
        if (out.mode !== 'oars' && out.mode !== 'telescope') {
          sh.px -= Math.max(-0.05, Math.min(0.05, yawV * 0.012)) * calm;
          sh.py -= Math.max(-0.04, Math.min(0.04, pitchV * 0.01)) * calm;
          sh.rz += Math.max(-0.12, Math.min(0.12, yawV * 0.035)) * calm;
        }
        if (airborne && vy > 0) sh.py += Math.min(0.03, vy * 0.004);
        composeLocal(paw.local, sh);
        paw.mesh.visible = show && paw.raise > 0.01;
        if (paw.mesh.visible) {
          partMatrix(paw, gestureK(gs));
          paw.mesh.matrix.multiplyMatrices(cam.matrixWorld, paw.local);
          paw.mesh.matrixWorld.copy(paw.mesh.matrix);
        }
      }
      shownLast = show;

      // ---- the lantern: glass glow + a real light where it shows on screen
      const lanternOn = L.mesh.visible && L.item === 'lantern';
      glow.visible = lanternOn;
      if (lanternOn) {
        glow.matrix.copy(L.mesh.matrix); glow.matrixWorld.copy(glow.matrix);
        const g = 1.0 + 0.7 * Math.min(1, night * 1.4);
        glowMat.color.setRGB(g, g * 0.8, g * 0.52);
      }
      const wantLight = lanternOn ? L.raise : 0;
      lightK += (wantLight - lightK) * Math.min(1, dt * 5);
      // fill on the paws: the lantern's warm glow (stronger the darker it is) + a little cool ambient after dusk
      {
        const lk = lightK * (0.05 + 0.07 * Math.min(1, night * 1.4)), amb = 0.035 * night;
        vmFill.value.set(light.color.r * lk + 0.55 * amb, light.color.g * lk + 0.62 * amb, light.color.b * lk + 0.8 * amb);
      }
      if (lightK > 0.01) {
        v2.set(LANTERN_GLASS.x, LANTERN_GLASS.y, LANTERN_GLASS.z).applyMatrix4(L.part.value).applyMatrix4(L.local);
        toWorldMatched(v2, light.pos);
        light.gain = lightK;
        if (!offLight) offLight = svc<LightsService>('lights')?.add(light) ?? null;
      } else if (offLight) { offLight(); offLight = null; }
    },
    stats: () => ({ draws: (L.mesh.visible ? 1 : 0) + (R.mesh.visible ? 1 : 0) + (glow.visible ? 1 : 0), mode: out.mode, left: L.item, right: R.item, gesture: gs.g ?? '-' }),
    dispose() {
      offStep?.(); offWallet?.(); offValley(); offLight?.();
      if (ctx.services.get('hands') === port) ctx.services.delete('hands');
      ctx.scene.remove(root);
      for (const m of [L.mesh.material, R.mesh.material, glowMat] as THREE.Material[]) m.dispose();
      glow.geometry.dispose();
    },
  };
};
