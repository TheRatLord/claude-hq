/**
 * Ada, the receptionist (GP §3.4 / §5.8, DESIGN §6.4.5, §11 M3 AMB): an oat-coloured Clawd with a teal headset on the
 * Help Desk STAFF mat. Visibly ambient (no nameplate, no ring, not an entity).
 * - Greets the player on arrival (spawn, or coming back to the lobby after a while): turns, waves, happy face.
 * - Points at the **oldest blocked** agent with a long noodle arm (every ~14 s while anything is blocked).
 * - Serve: with the Blocked Inbox open and the player on the mat, holds a ticket out over the counter; each answer →
 *   clap + a fresh ticket while the queue lasts.
 * - "while you were away" recap (`bus 'away.recap'`): rings the desk bell and waves (§6.4.5).
 * - herdr unreachable → holds up a "herdr offline" card, worried (GP §5.8).
 * - Otherwise: types on her laptop, looks around, waters the lobby fig when nobody is blocked.
 * - [AMB fix m2 r2] Coffee break: every few minutes, while nothing is blocked and the player is not in the Lobby, she
 *   walks to the Café bar, Bean (barista.ts) serves her, she sips, and walks back to her desk with the mug. Anything
 *   blocked, herdr offline, the inbox serve or the player walking into the Lobby sends her straight back.
 * Draws through charBatch with the CHR rig + animator. Owner: AMB.
 */
import * as THREE from 'three';
import { createClawdRig } from '../../chars/rig/clawd.ts';
import { makeBuilder, node, limbScale } from '../../chars/rig/build.ts';
import { createAnimator } from '../../chars/anim/animator.ts';
import { FORE_L, FORE_SEGS } from '../../chars/rig/clawd.ts';
import { CORE, ENV, STATUS, MISC } from '../../../../shared/palette.ts';
import { createCard, card as cardTexture } from './sign.ts';
import { createWalker, inboxOpen, oldestBlocked, offlineKind, W, clamp, damp, dampAng, angDiff, yawTo } from './util.ts';
import type { AmbDeps, AmbFrame, Vec2, Vec3 } from './util.ts';
import type { Furniture } from '../layout/schema.ts';
import type { RigPart } from '../../chars/rig/build.ts';

const TICKET_SEGS = 3;

type AdaMode = 'post' | 'serve' | 'offline' | 'coffee' | 'water';
/** Coffee break phases: walk to the bar, wait for Bean, sip, walk back, savour at the desk. */
type CoffeePhase = 'go' | 'wait' | 'sip' | 'back' | 'savor';
type AdaFace = 'happy' | 'worried' | 'determined';
type AdaAction = 'standWork' | 'standIdle' | 'holdSign' | 'waterPlants' | 'coffee';

interface AdaState {
  mode: AdaMode;
  t: number;
  busyT: number;
  act: AdaAction;
  face: AdaFace | null;
  /** the face last handed to the animator */
  faceSet?: AdaFace | null;
  yawGoal: number;
  look: Vec3 | null;
  greetCd: number;
  greeted: boolean;
  returning?: boolean;
  awayFromLobby: number;
  pointCd: number;
  pointT: number;
  pointId: string | null;
  pointK: number;
  pointAt?: Vec3;
  ticketK: number;
  ticketOut: boolean;
  ticketCd: number;
  offlineT: number;
  fidgetCd: number;
  waterCd: number;
  busyT2?: number;
  bellT: number;
  lastOldest: string | null;
  reacted: string | null;
  coffeeCd: number;
  coffeePh: CoffeePhase | null;
  coffeeT: number;
  forceOffline?: boolean;
  forceServe?: boolean;
}

export function createAda(d: AmbDeps) {
  const { layout, nav, charBatch, fx, actors, player, store, bus, rand } = d;
  // ---- rig: oat body, teal headset + mic boom ----------------------------------------------------------------------
  const rig = createClawdRig({ kind: 'claude', seedKey: 'ada:receptionist', pers: { energy: 1.05, bounciness: 1.1, width: 0.02, height: 0.04, hue: 0, lightness: 0 } });
  rig.setAccessory(1, 0); // headphones → a headset
  const RECOLOR: Record<string, string> = { body: '#DDD0BB', bodyDeep: CORE.sand, workspace: ENV.teal }; // warm cream (oat↔sand; albedo cap)
  for (const p of rig.parts) if (RECOLOR[p.colorKey]) p.colorKey = RECOLOR[p.colorKey];
  const { part } = makeBuilder(rig.parts);
  rig.root.updateMatrixWorld(true);
  const shape = rig.nodes.shape;
  // earcup (left) in the shape frame → boom down to the mouth corner
  let cup = null;
  for (const p of rig.parts) if (p.type === 'cyl' && p.group === 'acc') { const w = p.node.getWorldPosition(new THREE.Vector3()); if (!cup || w.x < cup.x) cup = w; }
  const from = cup ? shape.worldToLocal(cup.clone()) : new THREE.Vector3(-0.4, 0.5, 0);
  // two-segment boom outside the body: down the cheek, then forward to the mouth corner
  const pts = [from.clone().add(new THREE.Vector3(0.0, -0.03, 0.02)), new THREE.Vector3(-0.41, 0.2, 0.19), new THREE.Vector3(-0.24, 0.16, 0.28)];
  for (let i = 0; i < 2; i++) {
    const dir = pts[i + 1].clone().sub(pts[i]); const len = dir.length(); dir.normalize();
    const boom = node(shape, { p: [pts[i].x, pts[i].y, pts[i].z] });
    boom.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    part(boom, 'limb', CORE.ink2, { hull: true, s: limbScale(0.014, len + 0.02) });
  }
  part(shape, 'sphere', ENV.teal, { hull: true, s: [0.036, 0.03, 0.03], p: [pts[2].x, pts[2].y, pts[2].z] });
  rig.version++;
  const animator = createAnimator(rig, { seedKey: 'ada:receptionist' });
  const handle = charBatch.register(rig, { kind: 'claude', colorIndex: 1, cycle: 0 });

  // ---- ticket: a paper stub with a blocked-red header (a tiny rig in the same batch) --------------------------------
  const tParts: RigPart[] = [];
  const tRoot = new THREE.Object3D();
  const tb = makeBuilder(tParts);
  const tIn = tb.node(tRoot, { p: [0, -0.02, 0.07] });
  tb.part(tIn, 'rbox', MISC.trim, { hull: true, s: [0.2, 0.12, 0.012] });
  tb.part(tIn, 'rbox', STATUS.blocked, { s: [0.202, 0.03, 0.014], p: [0, 0.045, 0] });
  for (let i = 0; i < TICKET_SEGS; i++) tb.part(tIn, 'rbox', CORE.ink2, { s: [0.13 - i * 0.025, 0.01, 0.015], p: [-0.025 + i * 0.012, 0.008 - i * 0.022, 0] });
  const ticket = { root: tRoot, parts: tParts, species: 'prop', kind: 'prop', pers: {}, version: 0, smear: 0, accessory: { index: 0, cycle: 0 }, setAccessory() {} };
  const tHandle = charBatch.register(ticket, { kind: 'prop', colorIndex: 0, cycle: 0 });
  tHandle.setVisible(false);

  // ---- "herdr offline" card over the rig's sign prop ---------------------------------------------------------------
  const card = createCard(d.scene, 'herdr', 'offline', 0.5);
  const cardTex: Record<string, THREE.Texture | null> = { herdr: card.material.map, hq: null };
  let cardKind = 'herdr';
  const cardOffset = new THREE.Matrix4().makeTranslation(0, 0.31, 0.03);

  // ---- places ------------------------------------------------------------------------------------------------------
  const mat = layout.points?.staffMat ?? W(16.25, 22.1);
  const POST = { x: mat.x - 0.95, z: mat.z - 0.02 };
  // [AMB fix m3 r1] the player's Serve camera stands on the STAFF mat (poses.ts serve = mat centre, 0.6 m back): Ada's
  // head filled the frame's lower-left corner. With the player on the mat she steps aside to the counter's end, ≥ 1.5 m
  // lateral of the mat centre (the side away from the player), and holds the Serve ticket out from there (noodle arm).
  const ASIDE_DX = 1.62, ASIDE = [{ x: mat.x - ASIDE_DX, z: mat.z - 0.2 }, { x: mat.x + ASIDE_DX, z: mat.z - 0.2 }];
  let asideSide = 0; // 0 = west end, 1 = east end (hysteresis: flips only when the player is clearly on her side)
  const playerOnMat = () => Math.abs(player.pos.x - mat.x) < 1.35 && Math.abs(player.pos.z - mat.z) < 0.9 && (player.level ?? 0) === 0;
  /** where she stands at her post: the desk spot, or aside at the counter's end while the player is on the mat */
  const postSpot = () => {
    if (!playerOnMat()) return POST;
    if (asideSide === 0 && player.pos.x < mat.x - 0.45) asideSide = 1;
    else if (asideSide === 1 && player.pos.x > mat.x + 0.45) asideSide = 0;
    return ASIDE[asideSide];
  };
  const fig = (layout.furniture ?? []).filter((f: Furniture) => f.type === 'plant').sort((a: Furniture, b: Furniture) => Math.hypot(a.pos.x - POST.x, a.pos.z - POST.z) - Math.hypot(b.pos.x - POST.x, b.pos.z - POST.z))[0] ?? null;
  const FIG = fig ? { x: fig.pos.x + 0.35, z: fig.pos.z - 0.5, at: fig.pos } : null;
  const bell = layout.points?.bell ?? null;
  const homeYaw = yawTo((layout.spawn?.[0] ?? 0) - POST.x, (layout.spawn?.[2] ?? 12.5) - POST.z);
  const walker = createWalker(nav, layout, POST, { speed: 1.0, turn: 7 });
  let postGoal = POST; // the spot the walker was last sent to in post/serve/offline modes
  const goPost = () => { postGoal = postSpot(); walker.go(postGoal); };
  walker.yaw = homeYaw;

  const S: AdaState = {
    mode: 'post', t: 0, busyT: 0, act: 'standWork', face: null, yawGoal: homeYaw, look: null,
    greetCd: 1.2, greeted: false, awayFromLobby: 0, pointCd: 3, pointT: 0, pointId: null, pointK: 0,
    ticketK: 0, ticketOut: false, ticketCd: 0, offlineT: 0, fidgetCd: 12, waterCd: 45, bellT: 0, lastOldest: null,
    reacted: null, coffeeCd: 45 + rand() * 40, coffeePh: null, coffeeT: 0,
  };
  const CAFE = W(33.6, 26.72); // the Café bar's west end (the coffee slots are 34.3 / 35.5 / 36.7)
  const toBar = yawTo(0, 1);
  const react = (id: string) => { animator.react(id); S.reacted = id; };
  const onAnswered = () => { // Serve: each answer → clap, sparkle, a fresh ticket
    if (S.mode !== 'serve') return;
    react('clap'); S.face = 'happy'; S.busyT = 1.2; S.ticketCd = 1.4; S.ticketOut = false;
    const p = handPos(); if (p) fx?.burst?.('sparkle', p, { count: 8 });
  };
  const onRecap = () => { S.bellT = 3.2; S.greetCd = 0; };
  const offA = bus?.on?.('answered', onAnswered);
  const offR = bus?.on?.('away.recap', onRecap);

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), mtx = new THREE.Matrix4();
  const handPos = () => {
    const h = rig.arms[1]?.hand; if (!h) return null;
    return h.getWorldPosition(new THREE.Vector3());
  };
  const inLobby = () => layout.zoneAt?.(player.pos.x, player.pos.z, player.level ?? 0) === 'LOB';

  /** Long noodle arm: pitch the right arm toward a world point (the body is already turned toward it); k = blend 0..1. */
  function armTo(k: number, at: Vec3, stretch: number) {
    if (k <= 0.001) return;
    const a = rig.arms[1];
    a.pivot.getWorldPosition(tmp);
    const dx = at.x - tmp.x, dy = at.y - tmp.y, dz = at.z - tmp.z;
    const el = Math.atan2(dy, Math.hypot(dx, dz));
    const rel = angDiff(walker.yaw, yawTo(dx, dz));
    const px = -(Math.PI / 2 + clamp(el, -0.6, 1.2));
    a.pivot.rotation.x += (px - a.pivot.rotation.x) * k;
    a.pivot.rotation.y += (clamp(rel, -0.6, 0.6) - a.pivot.rotation.y) * k;
    a.pivot.rotation.z += (0.08 - a.pivot.rotation.z) * k;
    a.elbow.rotation.x *= 1 - k;
    const seg = (FORE_L / FORE_SEGS) * (1 + (stretch - 1) * k);
    for (let i = 0; i < FORE_SEGS; i++) {
      a.joints[i].rotation.z *= 1 - k;
      if (i) a.joints[i].position.y = -seg;
      a.segs[i].scale.y = 1 + (stretch - 1) * k;
    }
    a.hand.position.y = -seg;
  }

  function update(c: AmbFrame, camera: { position: { x: number; z: number } } | null | undefined) {
    const dt = Math.min(c.dt, 0.1);
    S.t += dt;
    const ents = store?.entities?.values?.() ?? [];
    const oldest = oldestBlocked(ents);
    const oldestActor = oldest ? actors?.get?.(oldest.id) : null;
    const offKind = S.forceOffline ? 'herdr' : offlineKind(store);
    const offline = !!offKind;
    S.offlineT = offline ? S.offlineT + dt : 0;
    const pd = Math.hypot(player.pos.x - walker.pos.x, player.pos.z - walker.pos.z);
    const lob = inLobby();
    S.awayFromLobby = lob ? 0 : S.awayFromLobby + dt;
    const serveOpen = inboxOpen(d.ui) || !!S.forceServe;
    const onMat = Math.hypot(player.pos.x - mat.x, player.pos.z - mat.z) < 1.6;
    const queueN = [...(store?.entities?.values?.() ?? [])].filter((e) => e.status === 'blocked').length;

    // ---- choose the mode ------------------------------------------------------------------------------------------
    let want: AdaMode = 'post';
    if (S.offlineT > 2) want = 'offline';
    else if (serveOpen && onMat && queueN > 0) want = 'serve';
    else if (S.mode === 'water' && !oldest) want = 'water';
    else if (S.mode === 'coffee' && !oldest && (!lob || S.coffeePh === 'back' || S.coffeePh === 'savor')) want = 'coffee';
    if (want !== S.mode) {
      if (S.mode === 'water') goPost();
      if (S.mode === 'coffee') { walker.speed = 1.7; S.coffeePh = null; S.coffeeCd = 150 + rand() * 90; } // hurry back
      S.mode = want; S.busyT = 0;
      if (want === 'serve') { goPost(); S.ticketCd = 0.5; }
      if (want === 'post' || want === 'offline') goPost();
    }

    // [AMB fix m3 r1] step aside / back as the player steps on / off the STAFF mat (a brisk shuffle + "oop!" hop)
    const atPost = S.mode === 'post' || S.mode === 'serve' || S.mode === 'offline' || (S.mode === 'coffee' && (S.coffeePh === 'back' || S.coffeePh === 'savor'));
    if (atPost) {
      const spot = postSpot();
      if (spot !== postGoal) {
        const aside = spot !== POST;
        postGoal = spot; walker.go(spot); walker.speed = aside ? 1.8 : 1.0;
        if (aside && S.mode === 'post' && S.bellT <= 0) { react('hop'); S.face = 'happy'; S.busyT = Math.max(S.busyT, 0.8); }
        if (S.mode === 'coffee' && S.coffeePh === 'savor') S.coffeePh = 'back';
      }
    }

    // greeting: first arrival, or back in the lobby after ≥ 45 s away
    S.greetCd -= dt;
    if (lob && S.awayFromLobby === 0 && (!S.greeted || S.returning) && S.greetCd <= 0 && pd < 14 && S.mode === 'post') {
      S.greeted = true; S.returning = false; S.greetCd = 30;
      S.face = 'happy'; S.busyT = 2.6; S.yawGoal = yawTo(player.pos.x - walker.pos.x, player.pos.z - walker.pos.z);
      react('wave'); bus?.emit?.('amb.ada', { ev: 'greet' });
    }
    if (!lob && S.awayFromLobby > 45) S.returning = true;

    // ---- per-mode behaviour ---------------------------------------------------------------------------------------
    let act: AdaAction = 'standWork', face: AdaFace | null = null, lookAt: Vec3 | null = null, point = 0, ticket = 0;
    S.busyT = Math.max(0, S.busyT - dt);
    const moving = walker.update(dt);
    if (S.mode === 'offline') {
      act = 'holdSign'; face = 'worried';
      S.yawGoal = yawTo(player.pos.x - walker.pos.x, player.pos.z - walker.pos.z);
      lookAt = { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z };
    } else if (S.mode === 'serve') {
      act = 'standIdle'; face = 'happy';
      S.yawGoal = yawTo(mat.x - walker.pos.x, mat.z - 0.9 - walker.pos.z);
      lookAt = { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z };
      S.ticketCd -= dt;
      if (S.ticketCd <= 0 && !moving) S.ticketOut = true;
      ticket = S.ticketOut ? 1 : 0;
    } else if (S.mode === 'coffee') {
      S.coffeeT += dt; face = 'happy';
      if (S.coffeePh === 'go') { act = 'standIdle'; if (!moving && S.coffeeT > 0.5) { S.coffeePh = 'wait'; S.coffeeT = 0; } }
      else if (S.coffeePh === 'wait') { // at the bar: Bean flies the cup over (self-serve if it is busy for long)
        act = 'standIdle'; S.yawGoal = toBar;
        const b = d.peers?.barista?.pos;
        lookAt = b ? { x: b.x, y: b.y + 0.15, z: b.z } : null;
        if (S.coffeeT > 24) { S.coffeePh = 'sip'; S.coffeeT = 0; }
      } else if (S.coffeePh === 'sip') {
        act = 'coffee'; S.yawGoal = dampAng(S.yawGoal, toBar + 2.2, 0.6, dt);
        if (S.coffeeT > 6.5) { S.coffeePh = 'back'; S.coffeeT = 0; goPost(); }
      } else if (S.coffeePh === 'back') { act = 'coffee'; if (!moving && S.coffeeT > 0.5) { S.coffeePh = 'savor'; S.coffeeT = 0; } }
      else { // savour it at the desk, then back to work
        act = 'coffee'; S.yawGoal = dampAng(S.yawGoal, homeYaw, 1, dt);
        if (S.coffeeT > 14 || pd < 6) { S.mode = 'post'; S.coffeePh = null; S.coffeeCd = 220 + rand() * 160; }
      }
    } else if (S.mode === 'water') {
      if (!moving && FIG) {
        act = 'waterPlants'; face = 'happy';
        S.yawGoal = yawTo(FIG.at.x - walker.pos.x, FIG.at.z - walker.pos.z);
        S.busyT2 = (S.busyT2 ?? 0) + dt;
        if (S.busyT2 > 8) { S.mode = 'post'; S.busyT2 = 0; goPost(); }
      } else act = 'standIdle';
    } else {
      // post: bell (recap) > point at the oldest blocked > greet/look at the player > fidget / type / water
      if (S.bellT > 0) {
        S.bellT -= dt;
        if (bell) S.yawGoal = yawTo(bell.x - walker.pos.x, bell.z - walker.pos.z);
        if (S.bellT > 2.4 && S.reacted !== 'bellTap') react('bellTap');
        if (S.bellT < 1.2 && S.reacted === 'bellTap') { react('wave'); S.face = 'happy'; }
        act = 'standIdle';
      }
      S.pointCd -= dt;
      if (oldest && oldest.id !== S.lastOldest) { S.lastOldest = oldest.id; S.pointCd = Math.min(S.pointCd, 0.8); }
      if (!oldest) S.lastOldest = null;
      if (oldest && oldestActor && S.pointCd <= 0 && S.busyT <= 0 && S.bellT <= 0 && !moving) { S.pointT = 3.6; S.pointCd = 14; S.pointId = oldest.id; }
      if (S.pointT > 0) {
        S.pointT -= dt;
        const a = S.pointId !== null ? actors?.get?.(S.pointId) : null;
        if (a && S.pointId !== null && store?.entities?.get?.(S.pointId)?.status === 'blocked') {
          const at = { x: a.pos.x, y: a.pos.y + 0.55, z: a.pos.z };
          S.yawGoal = yawTo(at.x - walker.pos.x, at.z - walker.pos.z);
          point = 1; face = 'determined'; act = 'standIdle';
          // glance at the player mid-point ("over there!")
          lookAt = pd < 6 && S.pointT < 1.6 && S.pointT > 0.8 ? { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z } : at;
          S.pointAt = at;
        } else S.pointT = 0;
      }
      if (!point && S.bellT <= 0) {
        if (pd < 7) {
          lookAt = { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z };
          if (S.busyT <= 0) S.yawGoal = dampAng(S.yawGoal, yawTo(player.pos.x - walker.pos.x, player.pos.z - walker.pos.z), 1.5, dt);
          act = 'standIdle';
        } else {
          if (S.busyT <= 0) S.yawGoal = dampAng(S.yawGoal, homeYaw, 1, dt);
          act = 'standWork';
        }
        S.fidgetCd -= dt; S.waterCd -= dt;
        if (S.fidgetCd <= 0 && !moving) {
          S.fidgetCd = 14 + rand() * 18;
          const r = rand();
          react(pd < 7 ? (r < 0.5 ? 'hop' : 'wave') : r < 0.5 ? 'hop' : 'exhale');
        }
        S.coffeeCd -= dt;
        if (S.coffeeCd <= 0 && !oldest && !lob && S.bellT <= 0 && !moving && S.mode === 'post') {
          S.mode = 'coffee'; S.coffeePh = 'go'; S.coffeeT = 0; walker.speed = 1.25; walker.go(CAFE);
        } else if (S.waterCd <= 0 && !oldest && FIG && pd > 3 && !moving) {
          S.waterCd = 90 + rand() * 60; S.mode = 'water'; S.busyT2 = 0; walker.go(FIG);
        }
      }
      if (moving) act = 'standIdle';
    }
    if (S.busyT > 0 && S.face) face = S.face;

    // ---- drive the animator ---------------------------------------------------------------------------------------
    if (!moving) walker.yaw = dampAng(walker.yaw, S.yawGoal, 5, dt);
    if (walker.done && S.mode !== 'coffee' && walker.speed !== 1.0) walker.speed = 1.0;
    rig.root.position.set(walker.pos.x, walker.pos.y, walker.pos.z);
    rig.root.rotation.y = walker.yaw;
    const far = camera ? Math.hypot(camera.position.x - walker.pos.x, camera.position.z - walker.pos.z) : 0;
    const vis = far < 40;
    handle.setVisible(vis);
    if (!vis) { tHandle.setVisible(false); card.visible = false; return; }
    if (act !== S.act) { S.act = act; animator.setAction(act); }
    if (face !== S.faceSet) { S.faceSet = face; animator.setFace(face ?? 'neutral'); }
    animator.lookAt(lookAt);
    animator.setLocomotion(moving ? walker.v : 0);
    animator.setViewDist?.(far);
    animator.update(dt, far < 12 ? 0 : 1);
    handle.setLod?.(far < 12 ? 0 : far < 22 ? 1 : 2);
    // arm overrides (after the animator): pointing noodle / ticket reach
    S.pointK = damp(S.pointK, point, 7, dt);
    S.ticketK = damp(S.ticketK, ticket, 6, dt);
    if (S.pointK > 0.01 || S.ticketK > 0.01) {
      // (getWorldPosition updates only the ancestor chain: no full-rig traversal)
      if (S.pointK > 0.01 && S.pointAt) armTo(S.pointK, S.pointAt, 1 + 4.2 * S.pointK + 0.35 * Math.sin(S.t * 9) * S.pointK);
      else if (S.ticketK > 0.01) {
        // [AMB fix m3 r1] held out over the counter on her side of the Serve camera (lower-left/right third), not in
        // front of the queue head's face
        const side = postGoal === POST ? 0 : postGoal === ASIDE[1] ? 1 : -1;
        const tgt = { x: mat.x + 0.02 + side * 0.6, y: side ? 1.14 : 1.06, z: mat.z - 0.66 };
        const reach = Math.hypot(tgt.x - walker.pos.x, tgt.z - walker.pos.z) - 0.3; // shoulder → hand, noodle makes up the rest
        armTo(S.ticketK, tgt, 1 + (clamp(reach / 0.065, 1, 10) - 1) * S.ticketK);
      }
      rig.poseSerial = (rig.poseSerial ?? 0) + 1;
    }
    // ticket follows the right hand
    const showT = S.ticketK > 0.4;
    tHandle.setVisible(showT);
    if (showT) {
      // (getWorldPosition updates only the ancestor chain: no full-rig traversal)
      rig.arms[1].hand.getWorldPosition(tmp2);
      tRoot.position.copy(tmp2);
      tRoot.rotation.set(-0.25, yawTo(player.pos.x - tmp2.x, player.pos.z - tmp2.z), 0.1 * Math.sin(S.t * 3)); // held up to the reader
      tRoot.scale.setScalar(Math.min(1, (S.ticketK - 0.4) / 0.4));
    }
    // offline card over the sign prop
    const sign = rig.props?.sign?.root;
    card.visible = S.mode === 'offline' && !!sign && sign.visible;
    if (card.visible && offKind && offKind !== cardKind) {
      cardKind = offKind;
      if (offKind === 'hq' && !cardTex.hq) cardTex.hq = cardTexture('HQ link', 'retrying…');
      const m = card.material as THREE.MeshBasicMaterial; m.map = cardTex[offKind] ?? cardTex.herdr; m.needsUpdate = true;
    }
    if (card.visible) {
      sign.updateWorldMatrix(true, false);
      mtx.multiplyMatrices(sign.matrixWorld, cardOffset);
      card.matrix.copy(mtx);
      card.matrixWorldNeedsUpdate = true;
    }
  }

  return {
    update,
    get pos() { return { x: walker.pos.x, y: walker.pos.y, z: walker.pos.z }; },
    rig,
    /** [AMB fix m2 r2] waiting at the Café bar for Bean */
    wantsCoffee: () => S.mode === 'coffee' && S.coffeePh === 'wait',
    served: () => { if (S.mode === 'coffee' && S.coffeePh === 'wait') { S.coffeePh = 'sip'; S.coffeeT = 0; react('hop'); } },
    debug: () => ({ coffee: S.coffeePh, coffeeCd: Math.round(S.coffeeCd), yaw: +walker.yaw.toFixed(2), goal: +S.yawGoal.toFixed(2), mode: S.mode, act: S.act, pointing: S.pointT > 0 ? S.pointId : null, ticket: S.ticketOut, offline: S.offlineT > 2, x: +walker.pos.x.toFixed(2), z: +walker.pos.z.toFixed(2) }),
    /** debug: force a pose ('point' | 'offline' | 'serve' | 'water' | 'greet' | 'bell') for shots */
    force(id?: string) {
      if (id === 'point') { S.pointCd = 0; S.busyT = 0; return true; }
      if (id === 'offline') { S.offlineT = 99; S.forceOffline = true; return true; }
      if (id === 'serve') { S.forceServe = true; return true; }
      if (id === 'water' && FIG) { S.mode = 'water'; S.busyT2 = 0; walker.go(FIG); return true; }
      if (id === 'greet') { S.greeted = false; S.greetCd = 0; return true; }
      if (id === 'bell') { onRecap(); return true; }
      if (id === 'coffee') { S.coffeeCd = 0; S.mode = 'post'; return true; }
      if (id === 'coffeeNow') { S.mode = 'coffee'; S.coffeePh = 'wait'; S.coffeeT = 0; walker.stop(); walker.pos.x = CAFE.x; walker.pos.z = CAFE.z; walker.yaw = toBar; S.yawGoal = toBar; return true; }
      return false;
    },
    dispose() {
      handle.remove(); tHandle.remove();
      card.parent?.remove(card); card.geometry.dispose();
      if (typeof offA === 'function') offA();
      if (typeof offR === 'function') offR();
    },
  };
}
