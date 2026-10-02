/**
 * The summit trail system (world/trail.ts is the route, cut into `heightAt`): builds the trail's dressing, publishes
 * its walkable tops (staircase, rope bridge, lookout deck) through 'walkSurface' (wrapping whatever was there), its
 * solids, a few interactables, and runs the summit's coin-op viewer.
 *
 * **The viewer** (E on it): the camera stays at your eye and zooms (the field of view narrows) onto a farmer down in
 * the valley; ← / → cycle through them (whoever needs you first), ↑ / ↓ zoom, the mouse nudges the view a little; a
 * name tag on the farmer says what they're doing. E (or any walking key, or a panel opening) steps back. The view
 * steers the player's own yaw / pitch, so every system (lights, culling, labels) sees the real view direction.
 *
 * **The summit cairn**: E leaves a stone (one a day; a tiny counter kept per browser profile), the pile grows (one
 * InstancedMesh).
 *
 * Budget: 1 solid + 1 glow baked mesh, the sign, the viewer head, the flag, the offered stones (≤ 6 draws, + shadows).
 * Per frame: the flag's 44 vertices, the viewer head's aim; nothing allocated.
 * Dev: service 'trail' (`TrailService`): `view(i?)` enters the viewer on farmer i, `leave()`, `stones()`.
 */
import * as THREE from 'three';
import type { AudioService, FarmerLocator, LightEmitter, LightsService, SceneCtx, SystemFactory, WorldTag } from '../context.ts';
import type { FarmerView, Season } from '../../model/types.ts';
import { TRAIL, heightAt } from '../../world/map.ts';
import { Kit, bakeInto, glowMat, setGlow, solidMat } from '../structures/kit.ts';
import { JOB_VERB, TOOL_VERB } from '../farmers/farmers.ts';
import { SUMMIT, benchKit, binocularMask, bridgeKit, cairnKit, flagMesh, offeringGeometry, offeringSpot, stairsKit, summitKit, summitWorld, trailheadKit, trailheadSign, treadKit, viewerHead, waveFlag } from './build.ts';
import type { Solid } from './build.ts';
import { bridgeFloor, flightOf, platformFloor, spanOf, stairsFloor } from './decks.ts';
import { damp } from '../../../core/math.ts';
import { readJson, writeJson } from '../../storage.ts';

export interface TrailService {
  /** look through the summit viewer at farmer i (in viewer order); teleports you to it first */
  view(i?: number): void;
  leave(): void;
  readonly viewing: boolean;
  /** the farmer in the viewer (null: none / not viewing) */
  target(): string | null;
  /** stones left on the summit cairn */
  stones(): number;
  /** dev: the trail's centre line (x, z, tread y), trailhead → summit */
  route(): readonly { x: number; z: number; y: number }[];
  /**
   * dev: hike it. Teleports to the route's point `from` (default the trailhead), then walks (holding W, Shift to
   * sprint) steering along the route; resolves with where it got to (`stuck` = no progress for 3 s).
   */
  hike(o?: { from?: number; sprint?: boolean }): Promise<{ done: boolean; at: number; of: number; x: number; y: number; z: number; secs: number }>;
}

const FOV = 62;
const MAX_STONES = 45;
const STORE = 'claude-valley.summit.v1';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** Build every static piece into one Kit; returns the kit and the solids. */
export function buildTrailKit(season: Season): { kit: Kit; solids: Solid[] } {
  const k = new Kit(77);
  const A = TRAIL.anchors;
  const solids: Solid[] = [];
  // (the anchors' heights are the land before the cut: stand things on the land as it is now)
  trailheadKit(k, { ...A.trailhead, y: heightAt(A.trailhead.x, A.trailhead.z) - 0.03 });
  solids.push([A.trailhead.x, A.trailhead.z, 0.3]);
  solids.push(...treadKit(k, TRAIL.pts, heightAt, TRAIL.landings));
  solids.push(...stairsKit(k, A.stairs, heightAt));
  solids.push(...bridgeKit(k, A.bridge, heightAt));
  benchKit(k, A.bench);
  { const c = Math.cos(A.bench.yaw), s = Math.sin(A.bench.yaw); solids.push([A.bench.x - 0.05 * s, A.bench.z - 0.05 * c, 1.6, 0.5, A.bench.yaw]); }
  A.cairns.forEach((c, i) => { cairnKit(k, c.x, heightAt(c.x, c.z) - 0.04, c.z, c.s, i); solids.push([c.x, c.z, 0.32 * c.s]); });
  solids.push(...summitKit(k, A.summit, heightAt, season));
  return { kit: k, solids };
}

export const trailSystem: SystemFactory = (ctx: SceneCtx) => {
  const group = new THREE.Group();
  group.name = 'trail';
  ctx.scene.add(group);
  const A = TRAIL.anchors, S = A.summit;
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const lights = ctx.services.get('lights') as LightsService | undefined;
  const offs: (() => void)[] = [];
  const glow = glowMat(0);
  let season: Season = ctx.valley.sky.season;
  let baked: THREE.Mesh[] = [];

  function build(): void {
    for (const m of baked) { m.removeFromParent(); m.geometry.dispose(); }
    baked = [];
    for (const f of offs.splice(0)) f();
    const { kit, solids } = buildTrailKit(season);
    const tmp = kit.build(new THREE.Group(), 0);
    for (const o of tmp.children) {
      const m = o as THREE.Mesh;
      const isGlow = m.userData.bake === 'glow';
      const g = bakeInto(m.geometry, new THREE.Matrix4());
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, isGlow ? glow : solidMat());
      mesh.name = `trail:${isGlow ? 'glow' : 'solid'}`;
      mesh.castShadow = !isGlow; mesh.receiveShadow = !isGlow;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      baked.push(mesh);
      if (lights) for (const e of (m.userData.emitters as LightEmitter[] | undefined) ?? []) offs.push(lights.add(e));
    }
    for (const s of solids) offs.push(s.length === 3 ? ctx.colliders.circle(s[0], s[1], s[2]) : ctx.colliders.rect(s[0], s[1], s[2], s[3], s[4]));
  }
  build();

  // ---- moving pieces: sign, viewer head, flag, offered stones ----
  const sign = trailheadSign({ ...A.trailhead, y: heightAt(A.trailhead.x, A.trailhead.z) - 0.03 }, TRAIL.length, TRAIL.climb);
  group.add(sign);
  const head = viewerHead();
  const vw = summitWorld(S, SUMMIT.viewer.x, SUMMIT.viewer.z);
  head.position.set(vw.x, S.y + S.deck + SUMMIT.viewerH, vw.z);
  head.rotation.order = 'YXZ';
  head.rotation.y = S.yaw;
  group.add(head);
  const flag = flagMesh();
  const fw = summitWorld(S, SUMMIT.flag.x, SUMMIT.flag.z);
  flag.position.set(fw.x, S.y + S.deck + SUMMIT.flagH - 0.42, fw.z);
  group.add(flag);
  const cw = summitWorld(S, SUMMIT.cairn.x, SUMMIT.cairn.z);
  const cairnBase = new THREE.Vector3(cw.x, heightAt(cw.x, cw.z) - 0.04, cw.z);
  const stoneMesh = new THREE.InstancedMesh(offeringGeometry(), solidMat(), MAX_STONES);
  stoneMesh.name = 'trail:offerings';
  stoneMesh.castShadow = true; stoneMesh.receiveShadow = true;
  group.add(stoneMesh);

  // the cairn counter, per browser profile
  let store = { stones: 0, day: '' };
  store = { ...store, ...(readJson(STORE) as Partial<typeof store> | null) };
  const spot = { x: 0, y: 0, z: 0, ry: 0 };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function placeStones(): void {
    const n = Math.min(MAX_STONES, store.stones);
    for (let i = 0; i < n; i++) {
      offeringSpot(i, spot);
      // the pile's flank: offerings ring the cairn (1.45× scale), higher rings tuck in
      v3.set(cairnBase.x + spot.x * 1.45, cairnBase.y + spot.y * 1.45, cairnBase.z + spot.z * 1.45);
      v3.y = Math.max(v3.y, heightAt(v3.x, v3.z) + 0.03);
      q.setFromEuler(e3.set(0, spot.ry, (i % 3 - 1) * 0.15));
      m4.compose(v3, q, one);
      stoneMesh.setMatrixAt(i, m4);
    }
    stoneMesh.count = n;
    stoneMesh.instanceMatrix.needsUpdate = true;
    stoneMesh.computeBoundingSphere();
  }
  placeStones();

  // ---- walkable tops: wrap whatever 'walkSurface' was (structures' porch, bridge, dock) ----
  const flight = flightOf(A.stairs), span = spanOf(A.bridge);
  const prev = ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
  const b = TRAIL.box;
  const walk = (x: number, z: number): number | null => {
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) {
      const y = stairsFloor(flight, x, z) ?? bridgeFloor(span, x, z) ?? platformFloor(S, x, z);
      if (y !== null) {
        // a deck overhead is not a floor for someone standing under it (the saddle under the bridge)
        const p = ctx.player.pos;
        if (!(Math.abs(p.x - x) < 1.5 && Math.abs(p.z - z) < 1.5 && y > p.y + 0.6)) return y;
      }
    }
    return prev ? prev(x, z) : null;
  };
  ctx.services.set('walkSurface', walk);

  // ---- the viewer ----
  const view = { on: false, enteredAt: 0, lettered: null as FarmerView | null, letteredI: -1, list: [] as string[], i: 0, zoom: 1, panYaw: 0, panPitch: 0, setYaw: 0, setPitch: 0, saveYaw: 0, savePitch: 0, fov: FOV, enterT: 0, caption: false };
  const tag: WorldTag = { key: 'trail:viewer', owner: '', style: 'name', title: '', sub: '', pos: new THREE.Vector3(), alpha: 1, dist: 12 };
  const locator = () => ctx.services.get('farmers') as FarmerLocator | undefined;
  const order = (): string[] => {
    const fs = [...ctx.valley.farmers.values()];
    const rank = (f: FarmerView) => (f.needsYou ? 0 : f.job === 'idle' || f.job === 'away' || f.job === 'done' ? 2 : 1);
    fs.sort((a, c) => rank(a) - rank(c) || a.tag.localeCompare(c.tag));
    return fs.map((f) => f.id);
  };
  const viewerPos = new THREE.Vector3(), aim = new THREE.Vector3();
  // the binocular mask: a dark card with two round windows, held in front of the camera while you look through
  const mask = binocularMask();
  mask.visible = false;
  group.add(mask);
  const fwd = new THREE.Vector3();
  function enter(i = 0): void {
    if (view.on) return;
    view.on = true;
    view.list = order();
    view.i = Math.max(0, Math.min(view.list.length - 1, i));
    view.zoom = 1; view.panYaw = 0; view.panPitch = 0;
    view.saveYaw = ctx.player.yaw; view.savePitch = ctx.player.pitch;
    view.setYaw = ctx.player.yaw; view.setPitch = ctx.player.pitch;
    view.enterT = 0; view.caption = false; view.enteredAt = performance.now();
    head.visible = false; // your eyes are on its eyepieces
    audio()?.play('creak', { pos: head.position, volume: 0.5, pitch: 1.4 });
    audio()?.play('coins', { pos: head.position, volume: 0.35 });
  }
  function leave(): void {
    if (!view.on) return;
    view.on = false;
    head.visible = true; mask.visible = false;
    ctx.player.yaw = view.saveYaw; ctx.player.pitch = view.savePitch;
    ctx.camera.fov = FOV;
    ctx.camera.updateProjectionMatrix();
    audio()?.play('creak', { pos: head.position, volume: 0.35, pitch: 1.1 });
  }
  const cycle = (d: number) => {
    view.list = order();
    if (!view.list.length) return;
    view.i = (view.i + d + view.list.length) % view.list.length;
    view.panYaw = 0; view.panPitch = 0;
    audio()?.play('ui-click', { volume: 0.5 });
  };
  const onKey = (e: KeyboardEvent) => {
    // (not the very E that opened the viewer, if it reaches us after the HUD used it)
    if (!view.on || (e.code === 'KeyE' && performance.now() - view.enteredAt < 250)) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); cycle(e.code === 'ArrowLeft' ? -1 : 1); return; }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); view.zoom = Math.max(0.4, Math.min(2.5, view.zoom * (e.code === 'ArrowUp' ? 0.8 : 1.25))); return; }
    if (e.code === 'KeyE' || e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); leave(); return; }
    // any walking key (or photo mode, a panel key…) steps back and goes on as usual
    leave();
  };
  addEventListener('keydown', onKey, true);

  // ---- interactables ----
  const vec = (x: number, y: number, z: number) => (out: THREE.Vector3) => out.set(x, y, z);
  const atSummit = () => Math.hypot(ctx.player.pos.x - S.x, ctx.player.pos.z - S.z) < 8;
  const say = (t: string, ms?: number) => ctx.ui.say(t, ms);
  const th = { ...A.trailhead, y: heightAt(A.trailhead.x, A.trailhead.z) };
  const stoneSay = (n: number) => n === 1 ? 'You set a stone on the cairn. The first one is yours. 🪨' : `You set a stone on the cairn: ${n} now, one for every climb.`;
  const interact = [
    ctx.interact.add({ id: 'trail:sign', kind: 'structure', verb: 'Read', label: () => 'Summit trail', pos: vec(th.x, th.y + 2.0, th.z), reach: 3.6,
      hint: () => `${Math.round(TRAIL.length)} m · ${Math.round(TRAIL.climb)} m up · lookout & viewer`,
      use: () => say(`Summit Lookout: ${Math.round(TRAIL.length)} m of switchbacks, ${Math.round(TRAIL.climb)} m up, a rope bridge at the top. The viewer up there can find every farmer in the valley. 🥾`, 5200) }),
    ctx.interact.add({ id: 'trail:bench', kind: 'prop', verb: 'Rest on', label: () => 'Halfway bench', pos: vec(A.bench.x, A.bench.y + 0.55, A.bench.z), reach: 3.0,
      use: () => say(`Halfway! ${Math.round(A.bench.y - th.y)} m up already. The square looks like a postage stamp from here.`, 3600) }),
    ctx.interact.add({ id: 'trail:viewer', kind: 'prop', verb: 'Look through', label: () => 'Valley viewer', pos: (out) => out.copy(head.position), reach: 2.6,
      enabled: () => !view.on,
      hint: () => (ctx.valley.farmers.size ? `zoom onto the valley · ←/→ ${ctx.valley.farmers.size} farmer${ctx.valley.farmers.size === 1 ? '' : 's'}` : 'zoom onto the valley'),
      use: () => enter(0) }),
    ctx.interact.add({ id: 'trail:cairn', kind: 'prop', verb: 'Leave a stone on', label: () => (store.stones ? `Summit cairn (${store.stones})` : 'Summit cairn'), pos: vec(cairnBase.x, cairnBase.y + 0.9, cairnBase.z), reach: 3.0,
      enabled: () => !view.on,
      hint: () => (store.day === today() ? 'you left one today' : 'one stone a day'),
      use: () => {
        if (store.day === today()) { say(`Your stone from today is up there already, with ${store.stones - 1 || 'no'} other${store.stones === 2 ? '' : 's'}. Come back tomorrow.`); return; }
        store = { stones: store.stones + 1, day: today() };
        writeJson(STORE, store);
        placeStones();
        audio()?.play('pop', { pos: cairnBase, volume: 0.6, pitch: 0.7 });
        audio()?.play('sparkle', { pos: cairnBase, volume: 0.4 });
        say(stoneSay(store.stones));
      } }),
  ];

  const service: TrailService = {
    view(i = 0) {
      // stand behind the viewer, facing the valley, then look through it
      const p = summitWorld(S, SUMMIT.viewer.x, SUMMIT.viewer.z - 0.75);
      (ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined)?.teleport(p.x, p.z, S.yaw + Math.PI, -0.2);
      enter(i);
    },
    leave,
    get viewing() { return view.on; },
    target: () => (view.on ? view.list[view.i] ?? null : null),
    stones: () => store.stones,
    route: () => TRAIL.pts,
    hike(o = {}) {
      const from = o.from ?? TRAIL.pts.findIndex((p) => p.kind !== 'path');
      const p0 = TRAIL.pts[Math.max(0, from)];
      (ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined)?.teleport(p0.x, p0.z, ctx.player.yaw, -0.05);
      const key = (code: string, down: boolean) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
      key('KeyW', true);
      if (o.sprint !== false) key('ShiftLeft', true);
      return new Promise((resolve) => { hike = { i: Math.max(0, from), t: 0, best: 0, bestT: 0, done: (r) => { key('KeyW', false); key('ShiftLeft', false); hike = null; resolve(r); } }; });
    },
  };
  ctx.services.set('trail', service);

  const env = { t: 0 };
  type HikeReport = { done: boolean; at: number; of: number; x: number; y: number; z: number; secs: number };
  let hike: { i: number; t: number; best: number; bestT: number; done(r: HikeReport): void } | null = null;
  function stepHike(dt: number): void {
    if (!hike) return;
    const pts = TRAIL.pts, p = ctx.player.pos;
    hike.t += dt;
    // advance to the furthest route point within reach ahead
    while (hike.i + 1 < pts.length && Math.hypot(pts[hike.i].x - p.x, pts[hike.i].z - p.z) < 1.3) hike.i++;
    const last = hike.i === pts.length - 1 && Math.hypot(pts[hike.i].x - p.x, pts[hike.i].z - p.z) < 1.3;
    if (hike.i > hike.best) { hike.best = hike.i; hike.bestT = hike.t; }
    const report = (done: boolean) => hike!.done({ done, at: hike!.i, of: pts.length - 1, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), secs: +hike!.t.toFixed(1) });
    if (last) { report(true); return; }
    if (hike.t - hike.bestT > 3) { report(false); return; }
    const q = pts[hike.i];
    ctx.player.yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z));
  }
  return {
    name: 'trail',
    update(f) {
      if (ctx.valley.sky.season !== season) { season = ctx.valley.sky.season; build(); }
      env.t = f.time;
      stepHike(f.dt);
      setGlow(glow, ctx.lighting.night);
      // the flag, only when it could be seen (it is 4 m tall up on the rim: in view from most of the valley)
      const w = Math.hypot(ctx.lighting.wind.x, ctx.lighting.wind.z);
      if (Math.hypot(ctx.player.pos.x - flag.position.x, ctx.player.pos.z - flag.position.z) < 180) {
        waveFlag(flag, f.time, w);
        flag.rotation.y = Math.atan2(ctx.lighting.wind.x, ctx.lighting.wind.z) - Math.PI / 2;
      }
      if (!view.on) {
        // idle: the viewer head drifts, looking over the valley
        head.rotation.y = S.yaw + Math.sin(f.time * 0.07) * 0.25;
        head.rotation.x = -0.08;
        return;
      }
      if (ctx.player.frozen || !atSummit()) { leave(); return; }
      const dt = Math.min(0.1, f.dt || 1 / 60);
      view.enterT += dt;
      // the mouse nudges the view: what the controller applied since our last write
      view.panYaw = Math.max(-0.12, Math.min(0.12, view.panYaw + (ctx.player.yaw - view.setYaw)));
      view.panPitch = Math.max(-0.08, Math.min(0.08, view.panPitch + (ctx.player.pitch - view.setPitch)));
      // the target: a farmer's head, else the square
      const id = view.list[view.i];
      const at = id ? locator()?.head(id) : null;
      if (at) aim.copy(at); else aim.set(0, heightAt(0, -2) + 2, -2);
      // you look from the viewer's eyepieces (the camera leans out past the rail: a lens, not your eye level)
      viewerPos.copy(head.position); viewerPos.y += 0.07;
      const dx = aim.x - viewerPos.x, dy = aim.y - viewerPos.y, dz = aim.z - viewerPos.z, dh = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dx, -dz) + view.panYaw, pitch = Math.atan2(dy, dh) + view.panPitch;
      // ease in from where you were looking
      const k = Math.min(1, view.enterT * 2.2);
      const ky = view.enterT < 0.6 ? 1 - Math.exp(-dt * 7) : 1 - Math.exp(-dt * 10);
      let d = yaw - ctx.player.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      ctx.player.yaw += d * ky;
      ctx.player.pitch += (pitch - ctx.player.pitch) * ky;
      view.setYaw = ctx.player.yaw; view.setPitch = ctx.player.pitch;
      // frame ~5 m of the valley round the farmer (whole square when nobody's out)
      const want = Math.max(2.2, Math.min(40, (2 * Math.atan2((at ? 2.6 : 22) * view.zoom, Math.hypot(dh, dy)) * 180) / Math.PI));
      view.fov = FOV + (want - FOV) * (k * k * (3 - 2 * k));
      view.fov = damp(ctx.camera.fov, view.fov, 9, dt);
      if (Math.abs(ctx.camera.fov - view.fov) > 0.01) { ctx.camera.fov = view.fov; ctx.camera.updateProjectionMatrix(); }
      // the head follows the view
      head.rotation.y = ctx.player.yaw + Math.PI;
      head.rotation.x = -ctx.player.pitch;
      // the mask sits a hand's width in front of the eye, sized to the lens (fades in as you lean in)
      const cam = ctx.camera;
      const cp = Math.cos(ctx.player.pitch);
      fwd.set(-Math.sin(ctx.player.yaw) * cp, Math.sin(ctx.player.pitch), -Math.cos(ctx.player.yaw) * cp);
      cam.position.copy(viewerPos).addScaledVector(fwd, 0.75 * k);
      cam.rotation.set(ctx.player.pitch, ctx.player.yaw, 0);
      cam.updateMatrixWorld();
      mask.position.copy(cam.position).addScaledVector(fwd, 0.2);
      mask.quaternion.copy(cam.quaternion);
      const sy = 0.2 * Math.tan((cam.fov * Math.PI) / 360);
      mask.scale.set(sy, sy, 1);
      mask.visible = view.enterT > 0.15;
      (mask.material as THREE.MeshBasicMaterial).opacity = Math.min(0.92, (view.enterT - 0.15) * 3);
      // the farmer's tag: who, what they're doing
      const fv = id ? ctx.valley.farmers.get(id) : undefined;
      if (fv && at && ctx.ui.tag) {
        // (the view model is replaced each tick: re-letter only then, not every frame)
        if (fv !== view.lettered || view.letteredI !== view.i) {
          view.lettered = fv; view.letteredI = view.i;
          const verb = (fv.tool && TOOL_VERB[fv.tool]) || JOB_VERB[fv.job];
          tag.owner = fv.id;
          tag.title = `${fv.tag}  ${view.i + 1}/${view.list.length}`;
          tag.sub = fv.needsYou ? `needs you: ${fv.question ?? fv.detail ?? ''}`.slice(0, 90) : fv.detail && fv.job !== 'idle' && fv.job !== 'away' ? `${verb} · ${fv.detail}` : verb;
        }
        tag.pos.set(at.x, at.y + 0.45, at.z);
        tag.alpha = Math.min(1, view.enterT * 2);
        ctx.ui.tag(tag);
      }
      if (!view.caption && view.enterT > 0.05) {
        view.caption = true;
        say(view.list.length ? 'Valley viewer · ← → another farmer · ↑ ↓ zoom · E to step back' : 'Nobody out in the fields right now: just the valley. E to step back.', 4200);
      }
    },
    stats: () => ({ baked: baked.length, viewing: view.on ? 1 : 0, stones: store.stones }),
    dispose() {
      leave();
      removeEventListener('keydown', onKey, true);
      for (const r of interact) r();
      for (const f of offs.splice(0)) f();
      if (ctx.services.get('walkSurface') === walk) { if (prev) ctx.services.set('walkSurface', prev); else ctx.services.delete('walkSurface'); }
      ctx.services.delete('trail');
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      (sign.material as THREE.MeshToonMaterial).map?.dispose();
      ctx.scene.remove(group);
    },
  };
};
