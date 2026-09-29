/**
 * UI entry (§8): DOM overlay over the world canvas. main.ts calls `createUI(ctx, deps)` once and `ui.update(ctx)` every
 * frame (§8.1 step 7; DOM work is throttled to ≤ 10 Hz except the crosshair). Composes the roster, terminal drawer,
 * HUD, command palette, key overlay and the one keyboard dispatcher; owns focus scopes and the §8.2.1 layout.
 * M2: Blocked Inbox / Serve card (inbox.ts), status card, minimap + overview, edge chevrons, away recap, unread from
 * `news` (per stable identity), sign-off verbs (G high-five), follow / glide camera hooks.
 * Registers the `__hq` UI calls (select, openTerminal, closeTerminal, roster, keyScope, away).
 * Owner: UI.
 */
import * as THREE from 'three';
import { send, call, sendBytes, onTermData } from '../net/store.ts';
import { hqRegister, hqStatSection } from '../core/debug.ts';
import { injectStyles } from './styles.ts';
import { setKeyPlatform } from './kit/keys.ts';
import { h, ICON } from './dom.ts';
import { createPlatform } from './platform.ts';
import { createRekey, createPins, localIo } from './rekey.ts';
import { createRoster } from './roster/view.ts';
import { oldestBlocked } from './roster/model.ts';
import { createDrawer } from './terminal/drawer.ts';
import { createHud } from './hud.ts';
import { createPalette } from './cmdk.ts';
import { createKeyOverlay, createConfirm } from './overlays.ts';
import { createKeys, type KeyHandler } from './keys.ts';
import { createAim, AIM_MAX_DIST } from './aim.ts';
import { computeLayout } from './layout.ts';
import { createInbox } from './inbox.ts';
import { createStatusCard, STATUS_CARD_AIM_M } from './statusCard.ts';
import { createMinimap, MINIMAP_PX } from './minimap.ts';
import { createChevrons } from './chevrons.ts';
import { createAway } from './away.ts';
import { createUnread, sessionIo, UNREAD_CLEAR_MS } from './unread.ts';
import { createNotify } from './notify.ts';
import { createPrefs, createSettingsPanel } from './settings.ts';
import { createHelp } from './help.ts';
import { createOnboarding } from './onboarding.ts';
import { resolveDeepLink } from './deeplink.ts';
import { createNames } from './names.ts';
import { pickStand, standBegin, standStep, isStandJob, isStand, glidePath, destOf, WALKUP, standErrors, monitorOf, screenBlocked, screenBodyHidden, bodySeated, eyesView, standWorld } from './goto.ts';
// [PLY m3 fix r3, cross-owner] go-there: the state machine is PLY's player/goThereCtl.ts; this file only wires it
import { goDest, keepOffFor } from '../player/goThere.ts';
import { createGoThereCtl } from '../player/goThereCtl.ts';
import { faceYaw } from '../core/debug.ts';
// M3.5 "walk up and manage"
import { createPromptBar, createRenameCard } from './promptBar.ts';
import { createTriage, createStreak, triageQueue } from './triage.ts';
import { pruneIfGrown } from './prune.ts'; // [UI fix r3] per-agent maps stay ≤ the live agents
import { createHireDialog, canSpawn, MUTATIONS_OFF_TEXT } from './hireDialog.ts';
import { createHotbar } from './hotbar.ts';
import { bindAliases, setAlias } from './aliases.ts';
import { summonText } from './cardModel.ts';
import type { Ctx } from '../core/ctx.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Player, PlayerActor } from '../player/controller.ts';
import type { RectLike } from './terminal/drawer.ts';
import type { GoStandJob } from '../player/goThereCtl.ts';
import type { RoutePt, StandActor, StandQuery, Stand, Eye, LensPose } from './goto.ts';
import type { GoDest, GoStand } from '../player/goThereCtl.ts';
import type { PoseArr } from '../player/goThere.ts';
import type { Nav } from '../world/nav/index.ts';
import type { TicketLevel } from './hud.ts';
import { TOAST_LEVELS } from '../../../shared/protocol.ts';
import type { ActorView } from './aim.ts';
import type { Nameable } from './names.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { ScreenRect } from '../core/bus.ts';

/** The preload bridge (electron/preload.cts); absent in a plain browser. */
interface HqElectron { setXtermFocused?(focused: boolean): void; onOpen?(fn: (link: string) => void): void }
declare global {
  interface Window { hqElectron?: HqElectron; __hqUi?: object }
}

/**
 * An actor as the UI reads it: the go-there / follow scorers' view, the aim boxes' view and the player controller's view
 * (chars/actors.ts owns the real one and is not typed yet; these are the fields ui/ relies on).
 */
export type UiActor = StandActor & ActorView & PlayerActor;
/** The actor collection main.ts hands in. */
export interface UiActors { list(): UiActor[]; get?(id: string): UiActor | null | undefined }
export interface UiDeps { root: HTMLElement; actors?: UiActors | null; nav?: Nav | null }
/** A pose track: [x, feetY, z, yaw, pitch]. */
type Pose5 = [number, number, number, number, number];
interface GlideState { from: readonly number[]; to: PoseArr; t0: number; dur: number; path: ReturnType<typeof glidePath> }
/** Walk-up lens: see `lens` below. */
interface LensState { base: number; want: number; cur: number; pose: readonly number[] | null }
/** One desk worker's row in `__hq.walkUpCheck`. */
interface WalkUpRow {
  id: string; slot: string | undefined; tier: number | undefined; ok: boolean; note?: string; facing?: number; eyes?: number | null; eyesGood?: number | null;
  eyesInFrame?: number | null; eyesFacing?: number | null; eyesHidden?: number | null; mon?: number; hidden?: number; screen?: unknown; dist?: number; fov?: number; pitch?: number;
}
interface GlideOpts { keepTrack?: boolean; quiet?: boolean }
/** The controller's own `glideTo` (PLY may provide it; the UI's eased glide runs otherwise). */
type GlidingPlayer = Player & { glideTo?(to: PoseArr, o: { ms: number; path: RoutePt[] }): void };
/** `drawer.open` options, plus the roster's own `keepRoster`. */
interface OpenOpts { focus?: boolean; fromRect?: RectLike; keepRoster?: boolean }
/** A deep link waiting for its pane to appear. */
interface PendingLink { q: string; t0: number; chip?: boolean }
/** The actor fields the stand search + the live-rig checks read (any go-there actor; `rig` is optional). */
type SpotActor = StandActor & Pick<ActorView, 'rig'>;
export type UI = ReturnType<typeof createUI>;
const toastLevels: readonly string[] = TOAST_LEVELS;
const isTicketLevel = (k: string): k is TicketLevel => k === 'blocked' || k === 'done' || toastLevels.includes(k);
/** The rig's face yaw (core/debug.ts faceYaw); the body yaw without a rig. */
const faceYawOf = (a: SpotActor): number | undefined => (a.rig ? faceYaw({ yaw: a.yaw ?? 0, rig: a.rig.nodes ? { root: a.rig.root, nodes: a.rig.nodes } : null }) : a.yaw);

const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function createUI(ctx: Ctx, { root, actors = null, nav = null }: UiDeps) {
  injectStyles({ quality: ctx.quality }); // [kit] tokens + k-* components + lamp sprite first (ui/kit/)
  const { store, settings, bus, params } = ctx;
  const net = { send, call, sendBytes, onTermData };
  const canvas = document.getElementById('view');
  const ui = h('div.hq-ui');
  root.append(ui);
  if (params.nohud) ui.style.display = 'none';

  const platform = createPlatform(settings);
  setKeyPlatform(platform); // [kit] keycaps follow the OS (Ctrl/⌘) and the Leader setting
  // M3.5: the last Enter keydown outside the terminal (registered before keys.ts, which may stop propagation): an
  // Enter that opens a terminal arms its double-Enter guard (terminal/view.ts ENTER_GUARD_MS)
  let lastEnterAt = -1e9;
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.repeat && !(e.target instanceof Element && e.target.closest('.xterm'))) lastEnterAt = performance.now(); }, true);
  /** one label per agent on every surface (namesakes → 'claude · 2', STAT's boardNames) */
  const names = createNames(store);
  const label = (e: Nameable | string | null | undefined) => names.label(e);
  const rekey = createRekey();
  bindAliases(localIo(`hq.alias.${store.hello ? (store.hello.demo ? 'demo' : store.hello.session) : 'pending'}`)); // Shift+N renames (M3.5)
  const session = () => (store.hello ? (store.hello.demo ? `demo` : store.hello.session) : 'pending');
  let pins = createPins(localIo(`hq.pins.${session()}`));
  // the roster holds this proxy across `store.on('hello')` re-creating `pins`: every read goes to the current one
  const pinsProxy = new Proxy(pins, { get: (_t, k) => { const v: unknown = Reflect.get(pins, k); return typeof v === 'function' ? v.bind(pins) : v; } });

  // ---- unread (§8.9): news / done transitions, per stable identity in sessionStorage ----
  let unread = createUnread(sessionIo(`hq.unread.${session()}`));
  const unreadOf = (id: string) => unread.of(id);
  const unreadDetail = (id: string) => unread.detailOf?.(id) ?? null;
  const lookingAt = (id: string): boolean => drawer.activeId === id && (drawer.state === 'docked' || drawer.state === 'fullscreen') && !document.hidden && (drawer.focused || drawer.hovered);
  const bumpUnread = (id: string, detail?: unknown) => {
    if (lookingAt(id)) return;
    const e = store.entities.get(id);
    if (e) unread.bump(e, detail); // M3.5: the news breakdown (msgs / edits / shell lines / finished)
  };
  let unreadWatch: { id: string | null; since: number } = { id: null, since: 0 };

  // ---- selection / glide / follow ----
  let selectedId: string | null = null;
  let lastOpened: string | null = null;
  let glide: GlideState | null = null;
  let followId: string | null = null;
  let autoFollow = false; // [UI fix r3] followId was set by a go-there (followWalker), not by the player
  /**
   * [UI fix r2] walk-up lens: {base, want, cur, pose} while a desk walk-up widened the FOV (PLY setFov is the user's
   * lens: `base` is restored). `pose` = where the glide landed; any look / move off it eases the lens back.
   */
  let lens: LensState | null = null;
  function lensTo(fov: number, now = false) {
    if (!ctx.player?.setFov) return;
    const base = lens ? lens.base : ctx.player.fov ?? 60;
    if (fov <= base + 0.25) { lensRelease(now); return; }
    lens = { base, want: fov, cur: lens ? lens.cur : base, pose: null };
    if (now) { lens.cur = fov; ctx.player.setFov(fov); }
  }
  function lensRelease(now = false) {
    if (!lens) return;
    lens.want = lens.base; lens.pose = null;
    if (now) { ctx.player?.setFov?.(lens.base); lens = null; }
  }
  function lensStep(dt: number) {
    if (!lens || !ctx.player?.setFov) return;
    if (!glide && lens.want !== lens.base) {
      const p = ctx.player.getPose();
      const lp = lens.pose;
      if (!lp) lens.pose = p;
      else if (p.some((v, i) => Math.abs(v - lp[i]) > 2e-3)) lensRelease(); // you looked / moved: your lens again
    }
    lens.cur += (lens.want - lens.cur) * (1 - Math.exp(-dt / 0.12));
    if (Math.abs(lens.want - lens.cur) < 0.05) lens.cur = lens.want;
    ctx.player.setFov(lens.cur);
    if (lens.cur === lens.base && lens.want === lens.base) lens = null;
  }
  let lastPeekEscAt = 0;
  let pillFilter: string | null = null;
  const select = (id: string | null) => {
    selectedId = id ? rekey.resolve(id) : null;
    if (!selectedId) { stopFollow(); glide = null; go?.cancel(); lensRelease(); } // deselect also stops follow / glide
    bus.emit('select', { id: selectedId });
    return selectedId;
  };
  const aim = createAim(actors, () => ctx.layout);
  let aimed: UiActor | null = null;
  const actorOf = (id: string): UiActor | null => actors?.get?.(id) ?? actors?.list?.().find((a) => a.id === id) ?? null;

  /** Fallback stand point (no layout / nothing scored): 1.8 m in front of the agent, facing it. */
  function standPose(a: { yaw?: number; pos: { x: number; y?: number; z: number } }, dist = 1.8): Pose5 {
    const yaw = a.yaw ?? 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const x = a.pos.x + fx * dist, z = a.pos.z + fz * dist;
    return [x, a.pos.y ?? NaN, z, Math.atan2(fx, fz), -0.12]; // (a pos without a height was `undefined` here)
  }
  /**
   * Camera hooks (§8 "Go to" / follow; PLY owns the cameras on the full plan in M2): if the player controller exposes
   * `glideTo(pose, {ms})` / `follow(actorOrNull)`, the UI delegates to it; otherwise the UI's own eased glide / spring
   * follow below runs. Either way the bus gets `cam.glide {to, id?}` / `cam.follow {id|null}` (FX ring, AUD whoosh).
   * [m2-r2] `route`: the nav polyline to glide along (goto.ts glidePath); none → a straight eased move.
   */
  function startGlide(to: PoseArr, id: string | null = null, route: readonly RoutePt[] | null = null, o: GlideOpts = {}) {
    followId = null;
    if (!o.keepTrack) go?.dropTrack();
    bus.emit('cam.follow', { id: null });
    const from = ctx.player.getPose();
    const L = ctx.layout;
    const path = glidePath(route, from, to, L?.floorY ? (x: number, z: number, lv: number) => L.floorY(x, z, lv) : undefined);
    const dur = path.ms;
    if (!o.quiet) bus.emit('cam.glide', { to, id, ms: dur });
    const gp: GlidingPlayer = ctx.player;
    if (typeof gp.glideTo === 'function') { glide = null; gp.glideTo(to, { ms: dur, path: path.points }); return; }
    glide = { from, to, t0: performance.now(), dur, path };
  }
  /**
   * Where "go there" would end for this actor (also `__hq.goToSpot`, review). A walking agent is framed at the slot
   * it is walking to (goto.ts destOf: the Help Desk queue place of a blocked agent, its desk…), m2-r3. M3.5 walk-up:
   * a seated desk worker is framed with its face and its screen (goto.ts WALKUP); its facing is the slot's (the live
   * face turns toward a player walking up, CHR). `standQuery` builds the query; `goSpot` runs it at once (review).
   */
  function standQuery(a: SpotActor, log?: string[]) {
    const p = ctx.player;
    const t = goDest(a, destOf); // [PLY m3 fix r1, cross-owner] its slot only when its walk ends there (not a gig's stale chill pick)
    const sl = t.slot ?? a.intent?.slot ?? null;
    const deskSeat = !!sl && /desk/.test(sl.tag ?? '') && (sl.pose ?? 'sit') === 'sit';
    const fy = deskSeat && sl.yaw != null ? sl.yaw : t !== a ? t.yaw : faceYawOf(a);
    const others = actors?.list?.() ?? [];
    // [UI fix r2, reviewer art] a walk-up front runner is re-checked with the live rig's eyes projected from its pose
    // (screen space): tier 0 only when both eyes land in frame, face the lens and nothing hides them
    const validate: StandQuery['validate'] = t === a && deskSeat && a.arrived ? (pose) => liveEyeCheck(a, pose, others) : undefined;
    // [PLY m3 fix r2, cross-owner] keepOff: never its own (empty) seat, nor its body while `t` is the slot it walks to
    const q: StandQuery = { a: t, others, layout: ctx.layout, nav, eyeH: p?.eyeHeight ?? 1.2, faceYaw: fy, from: p ? { x: p.pos.x, z: p.pos.z, level: p.level ?? 0 } : undefined, avoid: 'route' in t ? t.route : undefined, log, validate, keepOff: keepOffFor(a, t, go.seatsOf(a.id)) };
    return { t, q };
  }
  /** World eye points + face-plate normals of a Clawd's live rig (CHR face.ts eyeL / eyeR; local +z = the face), or null. */
  const _v = new THREE.Vector3(), _n = new THREE.Vector3();
  function liveEyes(a: SpotActor | null | undefined): Eye[] | null {
    const eyes = a?.rig?.face?.eyes;
    if (!a?.rig || !eyes?.length || !a.rig.root) return null;
    a.rig.root.updateMatrixWorld(true);
    return eyes.map((e) => { e.node.getWorldPosition(_v); e.node.getWorldDirection(_n); return { x: _v.x, y: _v.y, z: _v.z, nx: _n.x, ny: _n.y, nz: _n.z }; });
  }
  /** Screen-space eye check of actor a from lens pose {x, y (eye), z, yaw, pitch, fov?}: goto.ts eyesView on the live rig. */
  function liveEyeCheck(a: SpotActor, pose: LensPose & { fov?: number }, others: readonly SpotActor[] = actors?.list?.() ?? []) {
    const eyes = liveEyes(a);
    if (!eyes) return null;
    const L = ctx.layout, sl = a.intent?.slot;
    const level = L?.floorAt ? L.floorAt(a.pos.x, a.pos.z, (a.pos.y ?? 0) + 0.05).level : 0;
    const ob = others.filter((b) => b?.pos && b !== a && b.id !== a.id && !b.hidden);
    return eyesView(pose, eyes, { M: monitorOf(L, sl), others: ob, W: L ? standWorld(L) : null, level, fovV: pose.fov ?? ctx.camera?.fov ?? 60, aspect: ctx.camera?.aspect ?? 16 / 9 });
  }
  /**
   * [UI fix r3, reviewer art "○ E open <name> is drawn over the mouth in every walk-up"] where the reticle hint goes for
   * aimed actor a: px below the reticle (just under its chin, clamped on screen) when the hint's default spot (right of
   * the reticle) would overlap the face; null otherwise. Face rect from the live rig's eye nodes (last frame's matrices;
   * allocation-free), chin ≈ 0.24 m (rig scale) under the eyes.
   */
  const HINT_W = 170, HINT_H = 22;
  function chinDock(a: UiActor | null | undefined, camera: THREE.Camera | null | undefined): number | null {
    const eyes = a?.rig?.face?.eyes;
    if (!eyes?.length || !camera) return null;
    const W2 = innerWidth / 2, H2 = innerHeight / 2;
    let x0 = Infinity, x1 = -Infinity, yTop = Infinity, ey = 0;
    for (const e of eyes) {
      _v.setFromMatrixPosition(e.node.matrixWorld);
      ey += _v.y / eyes.length;
      _v.project(camera);
      if (_v.z > 1) return null; // behind the lens
      const px = _v.x * W2, py = -_v.y * H2;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); yTop = Math.min(yTop, py);
    }
    const sc = a?.rig?.root?.scale?.y ?? 1;
    _v.setFromMatrixPosition(eyes[0].node.matrixWorld);
    _v.y = ey - 0.24 * sc;
    _n.setFromMatrixPosition(eyes[eyes.length - 1].node.matrixWorld);
    _v.x = (_v.x + _n.x) / 2; _v.z = (_v.z + _n.z) / 2;
    _v.project(camera);
    const chin = -_v.y * H2;
    const pad = Math.max(12, (x1 - x0) * 0.6); // the face plate reaches past the eyes
    const fx0 = x0 - pad, fx1 = x1 + pad, fy0 = yTop - pad * 0.8;
    // the default hint: x 18 … 18 + HINT_W, y −11 … +11 (styles.ts .hq-cross .hint)
    const overlaps = fx1 > 18 && fx0 < 18 + HINT_W && chin > -HINT_H / 2 && fy0 < HINT_H / 2;
    if (!overlaps) return null;
    return Math.min(H2 - 48, Math.max(20, chin + 10));
  }
  function goSpot(a: SpotActor, log?: string[]) {
    if (!ctx.layout) return null;
    const { t, q } = standQuery(a, log);
    const s = pickStand(q);
    if (s && 'dest' in t) s.dest = t.dest;
    if (s) delete s.route;
    return s;
  }
  /** Camera pose for a stand spot (or the fallback), tilted under an open inbox card. */
  function standTo(a: SpotActor, s: Stand | null): Pose5 {
    const to: Pose5 = s ? [s.x, s.y, s.z, s.yaw, s.pitch] : standPose(destOf(a));
    // the open inbox card sits top-centre over the reticle: frame the agent in the free band under it (tilt up so the
    // agent lands lower on screen) instead of behind the card (reviewer m2-r2 h13-79d)
    if (inbox.isOpen) {
      const r = inbox.el.querySelector('.card')?.getBoundingClientRect();
      const H = innerHeight;
      if (r && r.bottom > H * 0.3) {
        const want = Math.min(H * 0.78, (r.bottom + H) / 2) - H / 2; // px below the centre
        const tanV = Math.tan(((ctx.camera?.fov ?? 60) * Math.PI) / 360);
        to[4] = Math.min(0.25, to[4] + Math.atan((want / (H / 2)) * tanV));
      }
    }
    return to;
  }
  /** Glide to a stand spot along the route its search found (no second path search). */
  function glideToStand(a: SpotActor, s: Stand | null, o: GlideOpts = {}) {
    const to = standTo(a, s);
    // [UI fix r1] a desk walk-up: its screen holds the proximity (live) tile even when the lens ends > 1.5 m from the
    // glass (RND monitorAtlas reads ctx.walkUpId, only while the camera is within a few metres of that desk)
    if (s?.tier != null) ctx.walkUpId = a.id;
    startGlide(to, a.id, s?.route?.points ?? null, o);
    // [UI fix r2, playtest "walk-up framing too tight"] a desk walk-up nearer than WALKUP.frameDist widens the lens
    // during the glide-in (goto.ts walkUpFov), eased back once you move or look
    if (s?.fov && s.tier != null) lensTo(s.fov); else lensRelease();
    return to;
  }
  /**
   * [PLY m3 fix r3, cross-owner] Go there (G, roster, `__hq.goTo`): the budgeted stand search, re-aim tracking, the
   * landed watch, follow-until-settled and the final face turn are PLY's player/goThereCtl.ts; the UI hands it the
   * stand query (goto.ts), its glide / lens, the HUD, selection and the follow hooks.
   */
  // (GoThereCtx types destOf as always yielding a GoDest; goDest() only calls it for a walker heading to its slot, and the
  // controller checks `'dest' in t` for the near-slot case where destOf returns the actor itself: the one cast, cross-area note)
  const go = createGoThereCtl({
    actorOf, resolve: (id) => rekey.resolve(id), player: () => ctx.player, layout: () => ctx.layout, destOf: (a) => destOf(a) as GoDest, world: standWorld,
    standBegin: (a) => { const { t, q } = standQuery(a); return { t, job: standBegin(q) }; },
    // [UI fix r2, reviewer code] ≤ WALKUP.sliceMs of scoring + ≤ routesPerFrame route searches per frame
    standStep: (job) => !isStandJob(job) || standStep(job, WALKUP.routesPerFrame, WALKUP.sliceMs),
    glideTo: (a, s, o) => glideToStand(a, s && isStand(s) ? s : null, o),
    turnTo: (pose, id) => startGlide(pose, id, null, { keepTrack: true, quiet: true }),
    glide: () => (glide ? { t: (performance.now() - glide.t0) / glide.dur, to: glide.to } : null),
    follow: (id, o) => { follow(id); autoFollow = !!o?.auto; }, // [UI fix r3] auto: an answer / terminal ends it
    stopFollow: () => stopFollow(), followingId: () => followId, select: (id) => select(id),
    hud: { aim: (t, v) => hud.aim(t, v), flash: (t) => hud.flash(t), toast: (k, t) => hud.toast(isTicketLevel(k) ? k : 'info', t) },
    label: (a) => label(actorOf(a.id)?.entity ?? store.entities.get(a.id) ?? a.id),
    prune: (m) => pruneIfGrown(m, actors?.list?.() ?? []), // [UI fix r3] per-agent maps stay ≤ the live agents
  });
  const goTo = (id: string) => go.goTo(id);
  const walking = (a: SpotActor) => go.walking(a);
  /** Minimap overview: glide to a floor point, facing along the way. */
  function glideToPoint(x: number, z: number) {
    if (!ctx.player) return;
    // [PLY m3 fix r3, cross-owner] a floor walk never ends on a seat (goThereCtl floorPoint)
    ({ x, z } = go.floorPoint(x, z, nav?.walkable ? (px, pz) => nav.walkable(px, pz, 0, { owner: '*' }) : undefined));
    const p = ctx.player.getPose();
    const dx = x - p[0], dz = z - p[2];
    const yaw = Math.hypot(dx, dz) > 0.2 ? Math.atan2(-dx, -dz) : p[3];
    const y = ctx.layout?.floorY ? ctx.layout.floorY(x, z, 0) : p[1];
    const route = nav?.route ? nav.route({ x: p[0], z: p[2], level: ctx.player.level ?? 0 }, { x, z, level: 0 }, { owner: '*' }) : null;
    startGlide([x, y, z, yaw, -0.05], null, route?.points ?? null);
  }
  function follow(id: string) {
    autoFollow = false;
    followId = rekey.resolve(id);
    glide = null;
    go.dropTrack();
    select(id);
    bus.emit('cam.follow', { id: followId });
    if (typeof ctx.player?.follow === 'function') ctx.player.follow(actorOf(followId));
  }
  /**
   * [UI fix r3, playtest "Following tinker · move to stop kept turning back on"] an answer or a terminal action ends
   * whatever the go-there left running (the landed watch, a settle-follow, a pending re-aim): the camera stays put.
   * A follow the player asked for (F) is kept.
   */
  function endAutoCamera() {
    go.endAuto(); // [PLY m3 fix r3, cross-owner] the landed watch, a settle-follow, a pending re-aim (goThereCtl)
    if (autoFollow) stopFollow();
  }
  function stopFollow() {
    autoFollow = false;
    if (!followId) return;
    followId = null;
    bus.emit('cam.follow', { id: null });
    if (typeof ctx.player?.follow === 'function') ctx.player.follow(null);
  }
  const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

  // ---- terminals ----
  function openTerminal(id: string, o: OpenOpts = {}) {
    const rid = rekey.resolve(id);
    const v = drawer.open(rid, o);
    if (v) {
      endAutoCamera(); // [UI fix r3] a terminal action never resumes an automatic follow
      lastOpened = rid;
      unread.clear(rid);
      if (roster.isOpen && !roster.keepOpen && o.keepRoster !== true) roster.close({ toWorld: false });
      if (document.pointerLockElement) document.exitPointerLock?.();
    }
    return v;
  }
  function toWorld() {
    drawer.blur();
    canvas?.focus({ preventScroll: true });
    syncScope();
  }
  function openLast() {
    if (drawer.focusLast()) return;
    const b = oldestBlocked(store.entities.values());
    if (b) { openTerminal(b.id); return; }
    if (document.pointerLockElement) document.exitPointerLock?.();
    roster.open({ focus: 'list' });
  }
  /**
   * After a free-text option ("Type something.", "No, and tell Claude …") was sent, the agent waits for typed text:
   * open its tab, take Control as soon as the viewer is live, and leave the xterm focused (reviewer r3).
   */
  function typeReply(id: string, optLabel: string) {
    const e = store.entities.get(rekey.resolve(id));
    const v = openTerminal(id);
    if (!v) return;
    hud.toast('info', `Type your reply to ${e ? label(e) : 'the agent'}`, { drawer: true, key: `reply:${id}`, sub: `‘${optLabel}’ sent · it is waiting for your text`, ttl: 6000 });
    const t0 = performance.now();
    const tick = () => {
      if (drawer.active() !== v) return; // you moved on
      const st = v.state?.state;
      if (v.mode === 'control' || st === 'readonly' || st === 'error' || st === 'gone') { v.focus(); return; }
      if (st === 'live') { void v.promote().then(() => { if (drawer.active() === v) v.focus(); }); return; }
      if (performance.now() - t0 < 8000) setTimeout(tick, 60); // a loaded box can take seconds to go live
    };
    tick();
  }
  /** Alt+1–9 (§4.8): never sends directly — opens the Serve card's one-line confirm; only Enter sends. */
  function quickAnswer(n: number) {
    const a = aimed ?? (selectedId && actorOf(selectedId));
    const e = a ? store.entities.get(a.id) : null;
    if (!e || e.status !== 'blocked') return false;
    if (!settings.get('quickAnswer')) { hud.toast('info', 'Quick-answer is off (setting quickAnswer) · B opens the inbox.'); return true; }
    if (document.pointerLockElement) document.exitPointerLock?.();
    inbox.open({ id: e.id, digit: n, confirm: true, focus: true, from: 'quick' });
    return true;
  }
  async function signOff(id: string, o: { via?: string; quiet?: boolean } = {}) {
    const e = store.entities.get(rekey.resolve(id));
    if (!e || e.status !== 'done') return false;
    const r = await call({ t: 'done.ack', id: e.id, stateSeq: e.stateSeq ?? null });
    if (r.ok) {
      bus.emit('signoff', { id: e.id, via: o.via ?? 'ui' }); // BRN: thank-you + walk back (§6.4); AUD: stamp
      unread.clear(e.id);
    }
    if (!o.quiet) hud.toast(r.ok ? 'info' : 'warn', r.ok ? `${o.via === 'highFive' ? 'High-five! ' : ''}Signed off ${label(e)} ✓` : `Sign-off failed: ${r.error}`, r.ok ? { sub: 'In HQ only — herdr still says done until you focus it there' } : {});
    return !!r.ok;
  }
  function signOffAll() {
    const done = [...store.entities.values()].filter((e) => e.status === 'done' && !e.ack && e.kind !== 'shell');
    for (const e of done) void signOff(e.id, { quiet: true, via: 'all' });
    if (done.length) hud.toast('info', `Signed off ${done.length} ✓`, { sub: 'In HQ only — herdr keeps its own done' });
  }
  async function markSeen(id: string) {
    const e = store.entities.get(rekey.resolve(id));
    if (!e) return;
    const r = await call({ t: 'herdr.focus', id: e.id });
    hud.toast(r.ok ? 'info' : 'warn', r.ok ? `Marked ${label(e)} seen in herdr` : `herdr focus failed: ${r.error}`, r.ok ? { sub: 'Your herdr focus moved to that pane' } : {});
  }
  /**
   * G in the world (§6.9): a high-five. On a done agent it *is* the sign-off (§6.8.2); blocked agents don't
   * high-five (they point at their ticket: B answers). With nothing aimed, G glides to the selected agent.
   */
  function highFive() {
    const a = aimed;
    if (!a) { if (!selectedId) return false; goTo(selectedId); return true; }
    const e = store.entities.get(a.id);
    if (!e) return false;
    if (e.status === 'blocked') { goTo(e.id); hud.flash(`${label(e)} is at its ticket · B answers`); return true; } // M3.5: G = go to ticket
    bus.emit('verb', { verb: 'highFive', id: e.id });
    hud.flash(e.status === 'done' && !e.ack ? 'high-five! ✓' : e.kind === 'shell' ? 'fist bump!' : 'high-five!');
    if (e.status === 'done' && !e.ack) void signOff(e.id, { via: 'highFive' });
    return true;
  }
  /** `+ Shell` / "New Claude in…" (M3.5): the hire dialog, gated by hello.allowMutations (it explains when off). */
  function spawnShell() { hire.open({ kind: 'shell', workspaceId: selectedId ? store.entities.get(selectedId)?.workspace?.id : undefined }); }
  function hireAgent(kind: 'claude' | 'codex' = 'claude') { hire.open({ kind, workspaceId: selectedId ? store.entities.get(selectedId)?.workspace?.id : undefined, cwd: selectedId ? store.entities.get(selectedId)?.cwd : undefined }); }
  /** T (M3.5): the one-line prompt bar for the aimed / selected agent (shells: their terminal instead). */
  function talk(id: string | null | undefined, o: Parameters<typeof promptBar.open>[1] = {}) {
    const e = id ? store.entities.get(rekey.resolve(id)) : null;
    if (!e) { hud.flash('aim at an agent (or select one) · T talks'); return false; }
    if (e.kind === 'shell') { openTerminal(e.id); return true; }
    if (e.status === 'blocked') { inbox.open({ id: e.id, focus: true, from: 'card' }); return true; } // it needs an answer, not a new task
    promptBar.open(e.id, o);
    return true;
  }
  /** Q pat / R summon (§6.9 verbs, M3.5): UI only announces them on the bus; BRN decides what the agent does. */
  function verb(v: string, id: string | null | undefined) {
    const e = id ? store.entities.get(id) : null;
    if (!e) return false;
    const m: { verb: string; id: string; outcome?: unknown } = { verb: v, id: e.id, outcome: undefined };
    bus.emit('verb', m); // BRN's actors.ts writes what the agent does into m.outcome (synchronous bus)
    hud.flash(v === 'pat' ? `pat ${label(e)} ♥` : summonText(label(e), typeof m.outcome === 'string' ? m.outcome : undefined, e));
    return true;
  }

  // ---- components ----
  const hud = createHud({
    root: ui, store, params,
    hooks: {
      stopFollow: () => stopFollow(),
      pill: (s) => {
        pillFilter = pillFilter === s ? null : s;
        roster.setStateFilter(pillFilter);
        if (pillFilter && !roster.isOpen) roster.open({ focus: false });
        hud.update(pillFilter);
      },
      drawerToasts: () => (drawer.state === 'fullscreen' || drawer.focused ? drawer.toasts : null),
      retry: () => call({ t: 'world.get' }),
      more: () => openInboxKey(),
      settings: () => settingsPanel.toggle(),
      help: () => help.toggle(),
      mute: () => { settings.set({ audioMuted: settings.get('audioMuted') !== true }); return settings.get('audioMuted') === true; },
      muted: () => settings.get('audioMuted') === true,
    },
  });
  const prefs = createPrefs();
  const confirm = createConfirm({ root: ui });
  const keyOverlay = createKeyOverlay({ root: ui, platform });
  const settingsPanel = createSettingsPanel({
    root: ui, settings, prefs, platform, store,
    hooks: {
      quality: (q) => { if (q !== 'auto') ctx.quality?.set?.(q); },
      tour: () => onboarding.start(),
      keys: () => keyOverlay.open(scope()),
      palette: () => palette.open(),
      mixer: () => ctx.audio?.openMixer?.(), // AUD's card (ctx.audio is set after createUI)
      closed: () => syncScope(),
    },
  });
  const help = createHelp({
    root: ui,
    hooks: { keys: () => keyOverlay.open(scope()), settings: () => settingsPanel.open(), tour: () => onboarding.start(), closed: () => syncScope() },
  });
  // Blocked Inbox / Serve card (§8.8, §6.8.1)
  const inbox = createInbox({
    root: ui, store, call, label,
    hooks: {
      open: (id) => { inbox.close(); openTerminal(id); }, // "Open terminal ↗": you moved on to the pane
      goTo: (id) => goTo(id),
      signOff: (id) => signOff(id),
      signOffAll: () => signOffAll(),
      toast: (lvl, t, o) => hud.toast(lvl, t, { drawer: drawer.state === 'fullscreen', ...o }),
      announce: (t, a) => hud.announce(t, a),
      // [UI fix r3] firedAt is server time (store.now), not performance.now: the 3 s window never matched before
      streakOwnsZero: () => streak.count > 0 || store.now() - (streak.firedAt ?? -1e9) < 3000,
      pend: (k) => streak.pend(k), // [UI fix r3] an inbox answer in flight holds inbox zero until it is counted
      answered: (id, key) => onAnswered(id, key), // M3.5: bus 'answered' {id, key} + the inbox-zero streak; [m2-r1] its 'is blocked' toast → 'answered ✓'. BRN: unblock hop + "thanks!" + scurry back (§6.8.1)
      typeReply: (id, label) => typeReply(id, label),
      // back to where the visit came from: the roster list for its mini card (if still open), else the world
      closed: (hadFocus, origin) => { if (hadFocus) { if (origin === 'mini' && roster.isOpen) roster.focusList(); else toWorld(); } layout(); },
      keys: () => keyOverlay.open('serve'),
    },
  });
  const statusCard = createStatusCard({
    root: ui, store, label, platform, settings,
    hooks: {
      option: (id, row) => { if (document.pointerLockElement) document.exitPointerLock?.(); inbox.open({ id, row, confirm: true, focus: true, from: 'card' }); },
      inbox: (id) => { if (document.pointerLockElement) document.exitPointerLock?.(); inbox.open({ id, focus: true, from: 'card' }); },
      open: (id) => openTerminal(id),
      signOff: (id) => signOff(id),
      markSeen: (id) => markSeen(id),
      follow: (id) => follow(id),
      talk: (id) => talk(id),
    },
  });
  const minimap = ctx.layout ? createMinimap({
    root: ui, layout: ctx.layout, store, actors, label, player: () => ctx.player,
    hooks: {
      goTo: (id) => goTo(id),
      glideTo: (x, z) => glideToPoint(x, z),
      selected: () => selectedId,
      followId: () => followId,
      select: (id) => select(id),
      opened: (on) => { if (!on) canvas?.focus({ preventScroll: true }); syncScope(); },
    },
  }) : null;
  // FX answers with its per-frame "alert card placed" test (fx/index.ts 'fx.alertsQuery'); absent FX → null
  let fxAlertShown: ((id: string) => boolean) | null = null, fxAlertEdge: ((id: string) => boolean) | null = null;
  // [FX fix m2-r2, cross-owner] + FX's edge hand-off: an alert anchored in the strip's edge band is the chevron's
  bus.emit('fx.alertsQuery', (fn, more) => { fxAlertShown = fn; fxAlertEdge = more?.alertEdge ?? null; });
  const chevrons = createChevrons({
    root: ui, store, actors, label, hooks: { goTo: (id) => goTo(id) },
    alertShown: () => fxAlertShown,
    alertEdge: () => fxAlertEdge, // [FX fix m2-r2, cross-owner]
    obstacles: (rects) => bus.emit('ui.obstacles', { key: 'chevrons', rects }), // FX label declutter (fx/labels.ts)
  });
  // "While you were away" (§6.4.5)
  const away = createAway({
    root: ui, store, settings, session, bus, call, label, // [fix r3] namesakes: 'claude · 2' on the slip too
    hooks: {
      scope: () => scope(),
      // non-modal: world input keeps focus (B or a click focuses the inbox)
      inbox: (id, r) => { inbox.open({ id, tab: 'blocked', focus: false }); if (r) inbox.recap(r); },
      recapShown: () => inbox.recapShown,
      open: (id) => openTerminal(id),
      goTo: (id) => goTo(id),
      drawerRecap: (lines) => {
        drawer.pulseBlocked();
        hud.toast('info', 'While you were away', { drawer: true, key: 'away', sub: lines.join(' · '), ttl: 9000 });
        return true;
      },
      announce: (t) => hud.announce(t),
      reduced: () => !!settings.get('reducedMotion') || matchMedia('(prefers-reduced-motion: reduce)').matches,
    },
  });

  const drawer = createDrawer({
    store, net, settings, platform, rekey, bus, label, // [UI fix r2] tabs + header name agents like every other surface
    hooks: {
      toWorld,
      toast: (lvl, text, o) => hud.toast(lvl, text, o),
      confirm: (t) => confirm.ask(t),
      keyAction: (a) => { xtermHandlers[a]?.(null, 'xterm'); },
      layout: () => layout(),
      opened: (id) => { lastOpened = id; },
      signOff: (id, o) => signOff(id, o), // [UI fix r3] opening a done terminal signs off with the full moment
      typed: (id) => unread.clear(id),
      enterAt: () => lastEnterAt,
    },
  });
  drawer.unreadOf = unreadOf;
  ui.append(drawer.el);

  const roster = createRoster({
    store, label, pins: pinsProxy, session, unreadOf, unreadDetail,
    hooks: {
      open: (id) => openTerminal(id, { keepRoster: roster.keepOpen }),
      goTo, follow, signOff,
      answer: (id) => inbox.open({ id, focus: true }), // A on a blocked row: the Serve card for this row (§8.2)
      // [UI kit, roster migrator] the selected blocked row's ledger (it replaced the pinned mini card): one confirm path
      option: (id, row) => inbox.open({ id, row, confirm: true, focus: true, from: 'mini' }),
      activeTab: () => (drawer.state !== 'closed' ? drawer.activeId : null), // that agent's terminal is the answer surface
      toast: (lvl, t) => hud.toast(lvl, t),
      layout: () => layout(),
      palette: () => palette.open(),
      keys: () => keyOverlay.open('roster'),
      closed: (toW) => { if (toW && !drawer.focused) toWorld(); },
      spawnShell,
      triage: () => openTriage(),
      lastOpened: () => lastOpened,
      hoverWorkspace: (wsId) => bus.emit('ws.hover', { id: wsId }), // lights that bay's banner in-world (ENV/FX may listen)
      hoverAgent: (id) => bus.emit('roster.hover', { id }), // lights that agent in-world (FX/CHR may listen)
    },
  });
  ui.append(roster.el);

  const palette = createPalette({
    root: ui, store, label,
    actions: () => {
      const blocked = [...store.entities.values()].filter((e) => e.status === 'blocked').length;
      const done = [...store.entities.values()].filter((e) => e.status === 'done' && !e.ack);
      const list = [
        { id: 'roster', label: 'Open roster', hint: 'Tab', icon: ICON.compact, run: () => roster.open({ focus: 'list' }) },
        // [dialogs r1] the count says what is in the queue (blocked · done · struggling), so it never reads as a second
        // "N need you" that disagrees with the HUD / Big Board (which count blocked only)
        (() => { const q = triageQueue(store.entities.values()); const n = q.length; const nb = q.filter((e) => e.status === 'blocked').length; const nd = q.filter((e) => e.status === 'done').length; const parts = [nb && `${nb} blocked`, nd && `${nd} done`, n - nb - nd && `${n - nb - nd} struggling`].filter(Boolean).join(' · '); return { id: 'triage', label: n ? `Triage (${n} in the queue)` : 'Triage — the queue is empty', hint: n ? `Shift+B · ${parts}, one key each` : 'Shift+B · blocked → done → struggling', icon: ICON.answer, disabled: !n, run: () => openTriage() }; })(),
        ...(selectedId && store.entities.get(selectedId)?.kind !== 'shell' && store.entities.get(selectedId) ? [{ id: 'talk', label: `Talk to ${label(store.entities.get(selectedId))}…`, hint: 'T · one-line prompt, confirm before sending', icon: ICON.type, run: () => talk(selectedId) }] : []),
        ...(blocked ? [{ id: 'blocked', label: `Next blocked terminal (${blocked})`, hint: 'Leader U', icon: ICON.bell, run: () => drawer.nextBlocked() }] : []),
        ...(blocked ? [{ id: 'inbox', label: `Blocked Inbox (${blocked})`, hint: 'B', icon: ICON.answer, run: () => inbox.open({ tab: 'blocked', focus: true }) }] : []),
        // nobody done: a disabled row still answers 'sign' (reviewer m2-r3: the verb vanished and 'sign' hit a task)
        done.length ? { id: 'signoff', label: `Sign off all done (${done.length})`, hint: 'HQ-local; herdr keeps its done', icon: ICON.check, run: () => signOffAll() }
          : { id: 'signoff', label: 'Sign off all — nobody is done', hint: 'sign-off appears when an agent finishes', icon: ICON.check, disabled: true, run: () => {} },
        { id: 'map', label: 'Office map', hint: 'M', icon: ICON.goto, run: () => minimap?.overview(true) },
        { id: 'keys', label: 'Keyboard shortcuts', hint: '?', icon: ICON.keyboard, run: () => keyOverlay.open(scope()) },
        { id: 'help', label: 'Help · how HQ works', hint: 'H / F1', icon: ICON.eye, run: () => help.open() },
        { id: 'settings', label: 'Settings', hint: 'volumes, quality, FOV, terminal…', icon: ICON.compact, run: () => settingsPanel.open() },
        { id: 'tour', label: 'Replay the tour (Ada)', icon: ICON.eye, run: () => onboarding.start() },
        { id: 'font+', label: 'Terminal font larger', hint: 'Leader +', icon: ICON.type, run: () => drawer.font(1) },
        { id: 'font-', label: 'Terminal font smaller', hint: 'Leader −', icon: ICON.type, run: () => drawer.font(-1) },
        { id: 'cos', label: `Copy on select: ${settings.get('copyOnSelect') !== false ? 'on → off' : 'off → on'}`, icon: ICON.copy, run: () => settings.set({ copyOnSelect: !(settings.get('copyOnSelect') !== false) }) },
        { id: 'compact', label: 'Toggle compact roster rows', hint: 'Alt+C in roster', icon: ICON.compact, run: () => roster.action('compact') },
        ...(['low', 'medium', 'high', 'auto'] as const).map((q) => ({ id: `q-${q}`, label: `Quality: ${q}`, icon: ICON.eye, run: () => { settings.set({ quality: q }); if (q !== 'auto') ctx.quality?.set?.(q); } })),
        { id: 'qa', label: `Quick-answer (Alt+1–9): ${settings.get('quickAnswer') ? 'on → off' : 'off → on'}`, icon: ICON.answer, run: () => settings.set({ quickAnswer: !settings.get('quickAnswer') }) },
        ...(() => {
          // M3.5 hire / + Shell: gated by hello.allowMutations — shown disabled with the reason, never hidden
          const ok = canSpawn(store.hello);
          return [
            { id: 'hire', label: 'New Claude in…', hint: ok ? 'hire: workspace, folder, name, first prompt' : MUTATIONS_OFF_TEXT, icon: ICON.plus, disabled: !ok, run: () => hireAgent('claude') },
            { id: 'hireCodex', label: 'New Codex in…', hint: ok ? 'hire a Codex agent' : MUTATIONS_OFF_TEXT, icon: ICON.plus, disabled: !ok, run: () => hireAgent('codex') },
            { id: 'shell', label: '+ Shell', hint: ok ? 'a new shell tab in herdr' : MUTATIONS_OFF_TEXT, icon: ICON.shell, disabled: !ok, run: spawnShell },
          ];
        })(),
        ...(drawer.tabIds.length > 1 ? [{ id: 'closeOthers', label: 'Close other terminal tabs', hint: 'Leader Shift+X', icon: ICON.close, run: () => drawer.closeOthers() }] : []),
      ];
      return list;
    },
    hooks: { open: (id) => openTerminal(id), goTo, closed: () => syncScope() },
  });

  // ---- M3.5: Talk, rename, Triage + inbox zero, Hire, hotbar ----
  const modalClosed = () => { toWorld(); layout(); };
  const promptBar = createPromptBar({
    root: ui, store, call, bus, label,
    hooks: { toast: (lvl, t, o) => hud.toast(lvl, t, { drawer: drawer.state === 'fullscreen', ...o }), closed: () => modalClosed(), announce: (t) => hud.announce(t) },
  });
  const rename = createRenameCard({ root: ui, store, label, setAlias: (e, a) => setAlias(e, a), hooks: { toast: (lvl, t, o) => hud.toast(lvl, t, o), closed: () => modalClosed() } });
  const streak = createStreak({ store, bus, toast: (lvl, t, o) => hud.toast(lvl, t, { drawer: drawer.state === 'fullscreen', ...o }) });
  const onAnswered = (id: string, key?: string) => { endAutoCamera(); bus.emit('answered', { id, key }); notify.answered(id); streak.answered(); }; // [UI fix r3] endAutoCamera
  const triage = createTriage({
    root: ui, store, call, label, screens: ctx.screens ?? null,
    hooks: {
      toast: (lvl, t, o) => hud.toast(lvl, t, o),
      open: (id) => openTerminal(id),
      talk: (id) => talk(id),
      signOff: (id) => signOff(id),
      answered: (id, key) => onAnswered(id, key),
      pend: (k) => streak.pend(k), // answers in flight hold inbox zero until they land
      prompted: (id) => { bus.emit('verb', { verb: 'prompt', id }); bus.emit('prompt.sent', { id }); },
      typeReply: (id, lb) => typeReply(id, lb),
      announce: (t) => hud.announce(t),
      closed: () => modalClosed(),
    },
  });
  const hire = createHireDialog({
    root: ui, store, call, bus,
    hooks: {
      toast: (lvl, t, o) => hud.toast(lvl, t, o),
      closed: () => modalClosed(),
      spawned: (paneId, kind) => {
        // the entity may land a beat after the reply: select it (and open a shell's terminal) once it exists
        const t0 = performance.now();
        const tick = () => {
          const id = rekey.resolve(paneId);
          if (store.entities.get(id)) { select(id); if (!kind) { drawer.fitWhenOpened(id); openTerminal(id); } return; }
          if (performance.now() - t0 < 8000) setTimeout(tick, 150);
        };
        tick();
      },
    },
  });
  const hotbar = createHotbar({ root: ui, store, label, pins: () => pins, unreadOf, hooks: { open: (n) => pinOpenAt(n) } });
  const openTriage = (id?: string) => {
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (inbox.isOpen) inbox.close();
    if (palette.isOpen) palette.close?.();
    triage.open(id ? { id } : {});
    syncScope();
  };

  // ---- scopes (§8.2) ----
  function scope() {
    const ae = document.activeElement as HTMLElement | null;
    if (palette.isOpen) return 'palette';
    if (triage.isOpen) return 'triage'; // M3.5 modal cards own the keyboard (keys.ts stands down, blocked())
    if (promptBar.isOpen || rename.isOpen || hire.isOpen) return 'dialog';
    if (ae && drawer.el.contains(ae) && ae.closest('.xterm')) return 'xterm';
    if (ae && inbox.isOpen && inbox.el.contains(ae)) return 'serve';
    if (ae === roster.tree || (ae && roster.el.contains(ae) && ae.tagName === 'BUTTON')) return 'roster';
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || (ae instanceof HTMLElement && ae.isContentEditable))) return 'input';
    return document.pointerLockElement ? 'world-locked' : 'world-unlocked';
  }
  let lastScope: string | null = null;
  /** set once the toast wiring below exists */
  let onScopeChange: ((s: string) => void) | null = null;
  function syncScope() {
    const s = scope();
    if (s !== lastScope) {
      if ((s === 'xterm') !== (lastScope === 'xterm')) window.hqElectron?.setXtermFocused?.(s === 'xterm'); // §8.3
      lastScope = s;
      onScopeChange?.(s);
    }
    if (ctx.player) ctx.player.inputEnabled = (s === 'world-locked' || s === 'world-unlocked') && !keyOverlay.isOpen && !confirm.isOpen && !minimap?.isOverview && !settingsPanel.isOpen && !help.isOpen;
    return s;
  }
  addEventListener('focusin', () => syncScope());
  addEventListener('focusout', () => setTimeout(syncScope, 0));
  document.addEventListener('pointerlockchange', () => syncScope());

  // ---- key handlers per table ----
  const aimedOrSelected = () => (aimed ? aimed.id : selectedId);
  // [PLY M3, cross-owner] manager's desk: a click on an agent in the overhead view selects it; the roster docks
  bus.on('player.select', (e) => { select(e?.id ?? null); });
  bus.on('player.manager', (e) => { if (e?.on) roster.open({ focus: false }); else roster.close({ toWorld: true }); });
  /** B: the Blocked Inbox (focused). Nothing blocked → the Done tab if anyone waits for a sign-off. */
  function openInboxKey() {
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (inbox.isOpen && inbox.focused) { inbox.close(); return; }
    const nb = [...store.entities.values()].some((e) => e.status === 'blocked');
    const nd = [...store.entities.values()].some((e) => e.status === 'done' && !e.ack && e.kind !== 'shell');
    if (!nb && !nd) { hud.toast('info', 'Nobody is blocked, nothing to sign off. ✓'); return; }
    inbox.open({ tab: nb ? 'blocked' : 'done', focus: true });
  }
  function pinOpenAt(n: number) { const id = pins.idAt(n); if (id) openTerminal(id); else hud.toast('info', `Pin ${n} is empty — Shift+${n} on an agent to pin it.`); }
  const worldHandlers: Record<string, KeyHandler> = {
    openLast: () => openLast(),
    drawerCollapse: () => drawer.toggleCollapse(),
    rosterOpen: () => { if (document.pointerLockElement) document.exitPointerLock?.(); roster.open({ focus: 'list' }); },
    interact: () => {
      // [PLY M2/M3, cross-owner] E in a monitor dive pulls out; at the manager's desk it stands up
      if (ctx.player?.mode === 'dive' || ctx.player?.mode === 'manager') return !!ctx.player.interact();
      if (!aimed) return !!ctx.player?.interact?.(); // [PLY M1.5] E sits / stands / rides / manager's desk
      const id = aimed.id;
      // [PLY M2, cross-owner] monitor dive: an agent at its desk → glide into its monitor, then the drawer opens from
      // the screen's rect; false (away from its desk / no monitor) → the plain open
      if (ctx.player?.dive?.(aimed, { onScreen: (rect) => openTerminal(id, { fromRect: rect ?? undefined }) })) return true;
      openTerminal(id); return true;
    },
    highFive: () => highFive(),
    talk: () => talk(aimedOrSelected()),
    pat: () => { const id = aimed?.id ?? null; if (!id) { hud.flash('aim at an agent · Q pats'); return true; } return verb('pat', id); },
    summon: () => { const id = aimedOrSelected(); if (!id) { hud.flash('select an agent · R summons it'); return true; } return verb('summon', id); },
    rename: () => { const id = aimedOrSelected(); if (!id || !store.entities.get(id)) { hud.flash('aim at an agent · Shift+N renames'); return true; } if (document.pointerLockElement) document.exitPointerLock?.(); rename.open(id); return true; },
    triage: () => openTriage(),
    goTo: () => { const id = aimedOrSelected(); if (!id) return false; goTo(id); return true; },
    follow: () => { const id = aimedOrSelected(); if (!id) return false; if (followId === id) { stopFollow(); return true; } follow(id); return true; },
    map: () => { if (!minimap) return false; if (document.pointerLockElement) document.exitPointerLock?.(); minimap.overview(); return true; },
    inbox: () => openInboxKey(),
    pinOpen: (n) => { if (n != null) pinOpenAt(n); },
    pinAssign: (n) => { const id = aimedOrSelected(); const e = id && store.entities.get(id); if (!e || n == null) return false; pins.assign(n, e); hud.toast('info', `Pinned ${label(e)} to ${n}`); return true; },
    quickAnswer: (n) => { if (n != null) void quickAnswer(n); },
    palette: () => { if (document.pointerLockElement) document.exitPointerLock?.(); palette.open(); },
    clearSelection: () => {
      if ((drawer.state === 'docked' || drawer.state === 'fullscreen') && performance.now() - lastPeekEscAt < 1500) { lastPeekEscAt = 0; drawer.collapse(); return; }
      if (roster.isOpen) { roster.close(); return; }
      if (inbox.isOpen) { inbox.close(); return; }
      select(null);
      stopFollow();
    },
    keys: (_, s) => keyOverlay.open(s),
    help: () => help.open(),
  };
  const rosterHandlers: Record<string, KeyHandler> = {
    ...Object.fromEntries(['down', 'up', 'left', 'right', 'open', 'goTo', 'follow', 'signOff', 'answer', 'pin', 'search', 'prevGroup', 'nextGroup', 'first', 'last', 'groupBy', 'compact', 'pinAssign'].map((a) => [a, (arg: number | null) => roster.action(a, arg)])),
    pinOpen: (n) => { if (n != null) pinOpenAt(n); },
    inbox: () => openInboxKey(),
    talk: () => talk(roster.selectedId),
    rename: () => { if (roster.selectedId) rename.open(roster.selectedId); },
    // [UI roster r1, cross-owner] the footer's [N] New shell; gated like the button (the reason, not silence)
    newShell: () => { if (canSpawn(store.hello)) spawnShell(); else hud.toast('info', MUTATIONS_OFF_TEXT); },
    palette: () => palette.open(),
    close: () => { roster.close(); },
    keys: () => keyOverlay.open('roster'),
  };
  const inputHandlers: Record<string, KeyHandler> = {
    toList: () => { if (document.activeElement === roster.input) return roster.action('toList'); return false; },
    goTo: () => { if (document.activeElement === roster.input) return roster.action('goTo'); return false; }, // [UI fix r3]
    clearOrClose: () => { if (document.activeElement === roster.input) return roster.action('clearOrClose'); const ae = document.activeElement; if (ae instanceof HTMLElement || ae instanceof SVGElement) ae.blur(); return true; },
    palette: () => palette.open(),
  };
  const paletteHandlers = Object.fromEntries(['down', 'up', 'run', 'runAlt', 'close'].map((a) => [a, () => palette.action(a)]));
  const xtermHandlers: Record<string, KeyHandler> = {
    palette: () => palette.open(),
    fontUp: () => drawer.font(1),
    fontDown: () => drawer.font(-1),
    fontReset: () => drawer.font(0),
    keys: () => keyOverlay.open('xterm'),
    copy: () => drawer.active()?.copySelection(),
    pasteNative: () => {},
  };
  const leaderHandlers: Record<string, KeyHandler> = {
    tabPrev: () => drawer.step(-1),
    tabNext: () => drawer.step(1),
    tabClose: () => drawer.close(),
    tabCloseOthers: () => drawer.closeOthers(),
    nextBlocked: () => drawer.nextBlocked(),
    pinOpen: (n) => { if (n != null) pinOpenAt(n); },
    fullscreen: () => drawer.toggleFullscreen(),
    modeToggle: () => { const v = drawer.active(); if (v) { void v.toggleMode(); v.focus(); } },
    roster: () => { if (roster.isOpen && drawer.state === 'fullscreen') roster.close({ toWorld: false }); else roster.open({ focus: 'list' }); },
    palette: () => palette.open(),
    copyRecent: () => drawer.copyRecent(),
    pasteClipboard: () => { const v = drawer.active(); if (v) { v.focus(); void v.pasteFromClipboard(); } },
    history: () => drawer.active()?.openHistory(),
    fontUp: () => drawer.font(1),
    fontDown: () => drawer.font(-1),
    fontReset: () => drawer.font(0),
    journal: () => hud.toast('info', 'Recent HQ actions arrive in M3 (audit log).'),
    keys: (_, s) => keyOverlay.open(s === 'xterm' ? 'xterm' : s),
    literalCtrl: () => {},
    literalLeader: () => { const v = drawer.active(); if (v) { v.focus(); v.sendLiteral('\x00'); } },
  };
  createKeys({
    platform, settings, hud,
    scope: () => syncScope(),
    blocked: () => confirm.isOpen || keyOverlay.isOpen || !!minimap?.isOverview || settingsPanel.isOpen || help.isOpen || promptBar.isOpen || rename.isOpen || triage.isOpen || hire.isOpen,
    handlers: {
      world: worldHandlers, roster: rosterHandlers, input: inputHandlers, palette: paletteHandlers, xterm: xtermHandlers,
      serve: {
        ...Object.fromEntries(['down', 'up', 'option', 'choose', 'openTerm', 'goThere', 'next', 'prev', 'tab', 'signOffAll', 'close'].map((a) => [a, (arg: number | null) => inbox.action(a, arg)])),
        palette: () => palette.open(),
        keys: () => keyOverlay.open('serve'),
      },
    },
    typeAhead: (e, r) => roster.typeAhead(e, r), // [UI fix r1] roster: letters type into search until a row is picked
    leader: leaderHandlers,
    leaderTap: (s) => { if (s === 'xterm') toWorld(); else openLast(); },
    literal: (data) => { const v = drawer.active(); if (v) { v.focus(); v.sendLiteral(data); } },
    onKey: (e, s) => {
      if ((s === 'world-locked' || s === 'world-unlocked') && (followId || glide || go.active) && MOVE_CODES.has(e.code)) { stopFollow(); glide = null; go.cancel(); }
      if ((s === 'world-locked' || s === 'world-unlocked') && lens && MOVE_CODES.has(e.code)) lensRelease();
    },
  });
  // Peek Esc → world, and remember it for "Esc Esc collapses" (§8.4)
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && scope() === 'xterm' && drawer.active()?.life.input === 'promote') lastPeekEscAt = performance.now();
  }, true);
  // Web mode: a beforeunload guard whenever a terminal tab is open (§8.3)
  addEventListener('beforeunload', (e) => { if (drawer.tabIds.length && !params.nohud && !/HeadlessChrome/.test(navigator.userAgent)) { e.preventDefault(); } });
  // Pills should not steal focus from the world
  hud.pills.addEventListener('mousedown', (e) => e.preventDefault());

  // ---- layout (§8.2.1) ----
  let layoutKey = '';
  let stripW = innerWidth;
  function layout() {
    const fs = drawer.state === 'fullscreen';
    const L = computeLayout({ W: innerWidth, pct: drawer.pct, roster: roster.isOpen && !fs, compact: roster.compact, drawer: drawer.state });
    const k = `${L.rosterW}|${L.drawerW}|${L.rosterMode}|${fs}|${roster.isOpen}|${roster.compact}`;
    if (k === layoutKey) return;
    layoutKey = k;
    ui.style.setProperty('--drawer-w', `${L.drawerW}px`);
    ui.style.setProperty('--roster-w', `${roster.compact ? 300 : 360}px`);
    roster.setRail(L.rosterMode === 'rail');
    roster.el.style.zIndex = fs ? '25' : '';
    const left = L.rosterW ? L.rosterW + 12 : 0;
    const worldW = innerWidth - left - L.drawerW;
    stripW = worldW;
    ui.style.setProperty('--world-l', `${left}px`);
    ui.style.setProperty('--world-r', `${L.drawerW}px`);
    const showMini = !!minimap && !fs && worldW >= 420; // (`params.nominimap` was read here but CORE's parseParams never sets it: a dead flag)
    minimap?.layout(left, showMini);
    hud.layout(left, L.drawerW, showMini ? 12 + minimap.height + 10 : 12);
    statusCard.layout(L.drawerW, worldW - (showMini ? MINIMAP_PX + 44 : 24), worldW, innerHeight);
    chevrons.layout(left, L.drawerW, !fs);
    away.layout(left, L.drawerW);
    // the reticle sits at the centre of the visible world strip, and main.ts shifts the projection centre there too
    // (camera.setViewOffset), so the aim ray, the reticle and WASD forward are all the camera axis (NDC 0)
    bus.emit('viewStrip', fs ? { left: 0, right: 0 } : { left, right: L.drawerW });
    hud.crosshair(!fs);
    ui.classList.toggle('hq-drawer-fs', fs);
    hud.pills.style.opacity = fs ? '0' : '';
    drawer.invalidate('roster');
  }
  addEventListener('resize', () => { layoutKey = ''; layout(); });

  // ---- store wiring: rekey, pins, notifications, unread ----
  const prevStatus = new Map();
  /**
   * The toast's key hint follows focus (§8.2): B only means "inbox" in the world / roster; with the xterm (or any
   * text field) focused a bare B is typed into the pane (and would promote Peek → Control), so show the Leader chords.
   */
  function blockedHint(s = scope()) {
    if (s === 'world-locked' || s === 'world-unlocked' || s === 'roster' || s === 'serve') return '[B] inbox  ·  click to open';
    const L = platform.leaderLabel;
    // (no Leader B: chords stay disjoint from world keys; Leader L opens the roster, where B is the inbox filter)
    return `${L} U next blocked  ·  ${L} L, B inbox  ·  click to open`;
  }
  // notification stack (notify.ts): toasts, live regions, chimes, bus 'notify'
  const notify = createNotify({
    store, hud, bus, prefs, label,
    hooks: {
      inboxOpen: () => inbox.isOpen && drawer.state !== 'fullscreen', // a fullscreen drawer hides the inbox: toast as usual
      open: (id) => openTerminal(id),
      inbox: () => openInboxKey(),
      drawerLayer: () => drawer.state === 'fullscreen' || drawer.focused,
      hint: () => blockedHint(),
      pos: (id) => actorOf(id)?.pos ?? null,
    },
  });
  onScopeChange = () => notify.refreshHints();
  const notifyBlocked = (e: Entity) => notify.blocked(e);

  // ?open= deep links (§2.2, §8.8): a name / pane id / ws›name, or inbox · roster · blocked · help · settings.
  // Waits up to 12 s for the entity (a pane can arrive after the first world); a miss says so.
  let deepLink: PendingLink | null = params.open ? { q: String(params.open), t0: 0 } : null;
  // [BE M3.5 cross-owner] Electron deep links into the running page (global hotkey → 'inbox', OS notification click →
  // 'inbox:<name>'; electron/preload.cts). Same resolution as ?open=; without this hook Electron reloads at /?open=.
  window.hqElectron?.onOpen?.((q) => { deepLink = { q, t0: performance.now() }; setTimeout(() => tryDeepLink(true), 12_000); tryDeepLink(); });
  function tryDeepLink(final = false) {
    if (!deepLink) return;
    const r = resolveDeepLink(deepLink.q, store.entities.values());
    if (r.kind === 'none' && !final) {
      // [m2-r2] say what we are waiting for right away (a miss used to be silent for 12 s)
      if (!deepLink.chip) { deepLink.chip = true; hud.toast('info', `Looking for “${deepLink.q}”…`, { key: 'deeplink', ttl: 12_500, sub: 'deep link ?open= · waiting for that pane to appear' }); }
      return;
    }
    const q = deepLink.q;
    const hadChip = deepLink.chip;
    deepLink = null;
    if (hadChip) ui.querySelectorAll('[data-key="deeplink"]').forEach((el) => el.remove());
    switch (r.kind) {
      case 'agent': openTerminal(r.id); break;
      case 'inbox': if (r.id) { if (document.pointerLockElement) document.exitPointerLock?.(); inbox.open({ id: r.id, tab: store.entities.get(r.id)?.status === 'done' ? 'done' : 'blocked', focus: true }); } else openInboxKey(); break;
      case 'roster':
        roster.open({ focus: 'list', groupBy: r.groupBy });
        if (r.badGroup) hud.toast('warn', `No roster grouping “${r.badGroup}”`, { sub: 'roster:state · ws · tab · proj · dir · kind · tool' });
        break;
      case 'help': help.open(); break;
      case 'settings': settingsPanel.open(); break;
      case 'blocked': { const b = oldestBlocked(store.entities.values()); if (b) openTerminal(b.id); else hud.toast('info', 'Nobody is blocked right now ✓'); break; }
      case 'ambiguous': {
        // namesakes: filter the roster by exact name (+ workspace), not a full-text search that hits the claude kind
        const nq = r.exact && !/\s/.test(r.name) ? `name:${r.name}${r.ws && !/\s/.test(r.ws) ? ` ws:${r.ws}` : ''}` : q;
        roster.open({ focus: 'list', query: nq });
        hud.toast('info', `${r.ids.length} agents match “${q}”`, { sub: `${r.ids.map((id) => label(store.entities.get(id) ?? id)).join(', ')} — pick one in the roster` });
        break;
      }
      default: hud.toast('warn', `No agent “${q}” here`, { sub: 'deep link ?open= — name, pane id, ws/name, inbox, roster, blocked' });
    }
  }
  store.on('hello', () => {
    bindAliases(localIo(`hq.alias.${session()}`)); // M3.5 renames, per session
    pins = createPins(localIo(`hq.pins.${session()}`));
    pins.rebind(store.entities.values());
    unread = createUnread(sessionIo(`hq.unread.${session()}`));
    unread.rebind(store.entities.values());
  });
  store.on('world', () => {
    pins.rebind(store.entities.values());
    unread.rebind(store.entities.values());
    for (const e of store.entities.values()) prevStatus.set(e.id, e.status);
    if (deepLink && !deepLink.t0) { deepLink.t0 = performance.now(); setTimeout(() => tryDeepLink(true), 12_000); }
    tryDeepLink();
    if (!onboardingChecked) { onboardingChecked = true; onboarding.maybeStart(); }
  });
  store.on('entity', (e) => {
    streak.check(); // M3.5 inbox zero: fires once when the last blocked agent clears after answers
    if (triage.isOpen) triage.prune();
    const was = prevStatus.get(e.id);
    prevStatus.set(e.id, e.status);
    if (was === undefined) { pins.rebind(store.entities.values()); unread.rebind(store.entities.values()); }
    notify.fill(e);
    if (was === undefined && deepLink?.t0) tryDeepLink();
    if (was && was !== e.status) {
      if (e.status === 'blocked') notifyBlocked(e);
      if (e.status === 'done') { bumpUnread(e.id, { src: 'done' }); notify.done(e); }
    }
  });
  store.on('event', (m) => {
    const e = store.entities.get(m.id);
    if (!e) return;
    if (m.kind === 'blocked') notifyBlocked(e);
    else if (m.kind === 'news') bumpUnread(m.id, m.detail);
  });
  store.on('gone', (m) => {
    queueMicrotask(() => streak.check());
    if (m.reason !== 'rekeyed') notify.gone(m.id);
    if (m.reason === 'rekeyed' && m.newId) {
      rekey.record(m.id, m.newId);
    } else {
      prevStatus.delete(m.id);
      unread.drop(m.id);
      go.seatMemo.delete(m.id); // [UI fix r3] per-agent maps drop the dead id
      if (followId === m.id) stopFollow();
    }
  });
  rekey.onRekey((o, n) => {
    if (selectedId === o) selectedId = n;
    if (lastOpened === o) lastOpened = n;
    if (followId === o) followId = n;
    const memo = go.seatMemo.get(o);
    if (memo) { go.seatMemo.set(n, memo); go.seatMemo.delete(o); } // [UI fix r3] follows the rekey
    unread.rekey(o, n);
    pins.rekey(o, n);
    if (roster.selectedId === o) roster.select(n);
  });
  store.on('toast', (m) => hud.toast(m.level, m.text, { drawer: drawer.state === 'fullscreen' || drawer.focused }));
  store.on('conn', (c) => {
    if (c.state === 'closed' && c.connects > 0) hud.toast('warn', 'Connection lost — reconnecting…', { key: 'conn' });
    else if (c.state === 'open' && c.connects > 1) hud.toast('info', 'Reconnected', { key: 'conn' });
  });

  // ---- first-run tour (Ada) ----
  let onboardingChecked = false;
  const onboarding = createOnboarding({
    root: ui, params, bus,
    hooks: {
      pose: () => ctx.player?.getPose?.() ?? null,
      aimed: () => aimed?.id ?? null,
      opened: () => drawer.tabIds.length > 0 && (drawer.state === 'docked' || drawer.state === 'fullscreen'),
      roster: () => roster.isOpen,
      done: () => hud.toast('done', 'You’re all set!', { sub: 'H or F1 for help any time · ? lists every key', ttl: 6000, key: 'tour' }),
    },
  });

  // ---- __hq (§9.1) ----
  hqRegister('select', (id) => select(id));
  hqRegister('openTerminal', (id) => {
    const e = store.entities.get(id) ?? [...store.entities.values()].find((x) => x.name === id);
    return e ? !!openTerminal(e.id) : false;
  });
  hqRegister('closeTerminal', () => { drawer.close(); return true; });
  hqRegister('roster', (open, groupBy) => { if (open) roster.open({ focus: 'list', groupBy }); else roster.close(); return roster.isOpen; });
  hqRegister('keyScope', () => scope());
  // [m2-r2] review: where 'go there' ends for an agent ({x, y, z, yaw, pitch, why} or null) · go there now
  // (withLog: {spot, log} — the scorer's rejections + front runners, framing diagnostics)
  hqRegister('goToSpot', (id, withLog = false) => { const a = actorOf(rekey.resolve(id)); if (!a) return null; const log: string[] | undefined = withLog ? [] : undefined; const s = goSpot(a, log); return withLog ? { spot: s, log } : s; });
  hqRegister('goTo', (id) => { goTo(id); return true; });
  // [M3.5] walk-up pose for __hq.focus (core/debug.ts): set the camera on the go-there stand spot at once, no glide
  const walkUpMemo = new Map<string, { s: Stand | null; at: number }>();
  hqRegister('walkUp', (id, maxTier = 1) => plugWalkUp(id, maxTier));
  function plugWalkUp(id: string, maxTier: 0 | 1 | 'settle' = 1) {
    // [UI fix r2, reviewer fun] __hq.focus on a walker: the go-there flow (follow until it settles, then walk up)
    if (maxTier === 'settle') { const a = actorOf(rekey.resolve(id)); if (!a || !ctx.player) return null; const following = walking(a); goTo(a.id); return { following }; }
    return walkUpTo(id, maxTier);
  }
  function walkUpTo(id: string, maxTier: 0 | 1) {
    const a = actorOf(rekey.resolve(id));
    // focus() asks tier 0 then tier 1 of the same matches: one search per actor per call burst (≈ 5–20 ms each)
    const now = performance.now();
    const memo = a ? walkUpMemo.get(a.id) : null;
    const s = memo && now - memo.at < 250 ? memo.s : a ? goSpot(a) : null;
    if (a) walkUpMemo.set(a.id, { s, at: now });
    // [UI fix r1] only a face-side spot (tier 0/1) is a walk-up: a walled-in desk (tier 2, its back) returns null so
    // __hq.focus moves on to the next match / its own hero framing. `cf` = the facing the lens sees after CHR's face
    // turn (goto.ts liveFacing; what focus() reports as `facing`), `cfSlot` = off the slot's facing.
    if (!s || !a || !ctx.player || (s.tier ?? 0) > maxTier) return null;
    glide = null; go.cancel();
    ctx.player.setPose(s.x, s.y, s.z, s.yaw, s.pitch);
    lensTo(s.fov ?? 0, true); // [UI fix r2] the walk-up lens at once (hero shots); eased back when the camera moves
    // [UI fix r2, reviewer fun] a live (unfrozen) focus keeps watching like a landed go-there: a freshly blocked
    // agent that gets up for the queue is followed and walked up to again (player/goThereCtl.ts watch)
    // instead of leaving the lens on its empty desk. Frozen review shots (heroFocus) never move the camera.
    if (!ctx.clock?.frozen) {
      const now = performance.now();
      go.watch(a, ctx.player.getPose(), { walkUp: s.tier != null }); // [PLY m3 fix r3, cross-owner] goThereCtl
    }
    ctx.walkUpId = a.id; // RND monitorAtlas: this desk holds the proximity tile while the camera stays near it
    return { ...s, cf: s.cfLive ?? s.cf, cfSlot: s.cf };
  }
  /**
   * [UI fix r1, reviewer code] Review check (scripts/review-shots.ts): walk up to every settled working desk worker
   * (the walkUp hook, any tier), let CHR's face turn and RND's live tile settle, then measure what the lens shows:
   * the face's real facing (its rig), its own screen's facing, occlusion (world + bodies) and tile state. pass = every
   * framed worker shows its face (facing > 0); every tier-0 one (face + screen spot) also shows an unoccluded, live
   * screen; ≥ 1 desk shows both eyes (UI fix r2: eyes projected from the lens, live rig). Tier 1 (the pod leaves no
   * spot where both read: face only) is listed, not failed.
   */
  hqRegister('walkUpCheck', async (o = {}) => {
    const settle = typeof o.settleMs === 'number' ? o.settleMs : 1500;
    const want = typeof o.status === 'string' ? o.status : 'working';
    const L = ctx.layout;
    const list = (actors?.list?.() ?? []).flatMap((a) => {
      const sl = a.intent?.slot;
      return a.arrived && !a.hidden && sl && /desk/.test(sl.tag ?? '') && (sl.pose ?? 'sit') === 'sit' && store.entities.get(a.id)?.status === want ? [{ a, sl }] : [];
    });
    const rows: WalkUpRow[] = [];
    for (const { a, sl } of list.slice(0, typeof o.max === 'number' ? o.max : 24)) {
      walkUpMemo.delete(a.id);
      const r = walkUpTo(a.id, 1);
      if (!r) { rows.push({ id: a.id, slot: sl.id, tier: 2, ok: true, note: 'no face-side spot (walled-in desk): focus() falls back' }); continue; }
      await new Promise((res) => setTimeout(res, settle));
      const p = ctx.player.getPose();
      const fy = faceYawOf(a) ?? 0, dx = p[0] - a.pos.x, dz = p[2] - a.pos.z, d = Math.hypot(dx, dz) || 1;
      const facing = +((-Math.sin(fy) * dx - Math.cos(fy) * dz) / d).toFixed(2);
      const M = monitorOf(L, sl);
      // (no desk monitor for a desk slot: this used to throw on M.x and end the whole check)
      if (!M) { rows.push({ id: a.id, slot: sl.id, tier: r.tier, ok: false, note: 'no desk monitor for the slot' }); continue; }
      const eye = { x: p[0], y: p[1] + (ctx.player.eyeHeight ?? 1.2), z: p[2] };
      const vx = eye.x - M.x, vy = eye.y - M.y, vz = eye.z - M.z, vl = Math.hypot(vx, vy, vz) || 1;
      const mon = +((vx * M.nx + vz * M.nz) / vl).toFixed(2);
      const others = (actors?.list?.() ?? []).filter((b) => b !== a && b.pos && !b.hidden).map((b) => ({ pos: b.pos, seated: bodySeated(b) }));
      const hidden = screenBlocked(L, ctx.player.level ?? 0, eye, M) ? 1 : screenBodyHidden(M, eye, [{ pos: a.pos, seated: true, r: WALKUP.ownR }, ...others]);
      const st: unknown = window.__hq?.stats?.();
      const screen = isRecord(st) && isRecord(st.screens) && sl.anchor !== undefined ? st.screens[sl.anchor] ?? null : null;
      // [UI fix r2, reviewer art] screen space: both eyes of the live rig projected from this exact lens (in frame,
      // facing it, unoccluded); a tier-0 view without both eyes fails, and any walk-up needs ≥ 1 eye
      const ev = liveEyeCheck(a, { x: eye.x, y: eye.y, z: eye.z, yaw: p[3], pitch: p[4], fov: ctx.camera?.fov ?? 60 });
      const eyes = ev ? ev.n : null;
      const ok = facing > 0 && (eyes == null || eyes >= 1) && (r.tier !== 0 || (eyes !== 0 && eyes !== 1 && mon >= WALKUP.monMinDot && hidden === 0 && screen === 'live'));
      rows.push({ id: a.id, slot: sl.id, tier: r.tier, facing, eyes, eyesGood: ev?.good ?? null, eyesInFrame: ev?.inFrame ?? null, eyesFacing: ev?.facing ?? null, eyesHidden: ev?.hidden ?? null, mon, hidden: +hidden.toFixed(2), screen, dist: +Math.hypot(r.x - a.pos.x, r.z - a.pos.z).toFixed(2), fov: +(ctx.camera?.fov ?? 60).toFixed(1), pitch: +p[4].toFixed(2), ok });
    }
    const tier0 = rows.filter((x) => x.tier === 0).length;
    // [UI fix r2] pass = every framed worker shows its face in screen space and ≥ 1 walk-up shows both eyes (in a pod
    // the face + readable-screen band is walled in, so tier 0 is no longer required: it is never faked either)
    const faces = rows.filter((x) => x.eyes === 2).length;
    return { pass: rows.length > 0 && faces > 0 && rows.every((x) => x.ok), faces, desks: rows.length, tier0, tier1: rows.filter((x) => x.tier === 1).length, walled: rows.filter((x) => x.tier === 2).length, rows };
  });
  hqRegister('away', (minutes = 40) => away.fake(minutes));
  hqStatSection('ui', () => ({ standErrors: standErrors.n, peek: peekKey, scope: scope(), drawer: drawer.state, tabs: drawer.tabIds.length, active: drawer.activeId, mode: drawer.active()?.mode ?? null, roster: roster.isOpen, selected: selectedId }));
  // test hooks (p2.ts) — plain data, no side effects beyond what the keys do
  window.__hqUi = {
    drawer, roster, palette, pins: () => pins, rekey, scope, openLast, toWorld, get unread() { return unread; }, aimed: () => aimed?.id ?? null,
    aimIgnoringWalls: () => (ctx.camera ? aim.pick(ctx.camera, AIM_MAX_DIST, 0, false)?.id ?? null : null), sightBlocked: (a: readonly number[], b: readonly number[]) => aim.sightBlocked(a, b),
    aimTop: (id: string) => { const a = actorOf(id); return a ? aim.top(a) : null; }, // world top of the aim boxes (hat incl.)
    inbox, statusCard, minimap, away, selected: () => selectedId, followId: () => followId, highFive, signOff,
    settings: settingsPanel, help, onboarding, notify, prefs, hud,
    goTo: (id: string) => goTo(id), goToSpot: (id: string, log?: string[]) => { const a = actorOf(rekey.resolve(id)); return a ? goSpot(a, log) : null; },
    actorList: () => actors?.list?.() ?? [],
    label: (id: string) => label(store.entities.get(rekey.resolve(id)) ?? id), // the one display label (names.ts)
    track: () => go.trackInfo(), // go-there re-aim state (m2-r3)
    settleWatch: () => go.settleInfo(), // [UI fix r1] go-there on a walker
    navWalkable: (x: number, z: number, level = 0) => (nav ? nav.walkable(x, z, level, { owner: '*' }) : null), // p2 go-there glide check
    // M3.5 test hooks (p2.ts): prompt bar, triage + streak, hire, hotbar, rename, walk-up
    promptBar, triage, streak, hire, hotbar, rename, talk: (id: string) => talk(id), openTriage: (id?: string) => openTriage(id), standJob: () => go.searching(), peek: () => peekKey,
    closePane: (id: string) => call({ t: 'pane.close', id }), // p2 cleanup of a pane it hired (demo / hqtest; the server gates it)
  };

  /**
   * The status card and the minimap are fixed screen panels: FX's label declutter treats them as obstacles (like the
   * edge chevrons), so an alert card climbs clear of them instead of sliding underneath (reviewer r3, r-02). 10 Hz,
   * published on change only.
   */
  let panelsKey = '';
  function publishPanels() {
    const rects: ScreenRect[] = [];
    // [FX m2-r1, cross-owner] + the roster (floating / compact it overlays the world) and the open inbox card: FX treats
    // every 'panels' rect as a hard obstacle; `ids` = agents whose question a panel already shows (FX shows their
    // in-world alert as the compact name · timer pill), `serve` = the inbox is open (FX collapses the queue to pills)
    for (const el of [statusCard.el.classList.contains('show') ? statusCard.el : null, minimap?.el, roster.isOpen ? roster.el : null, inbox.isOpen ? inbox.el : null, hotbar.el.classList.contains('show') ? hotbar.el : null]) {
      if (!el || el.hidden || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push([Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]);
    }
    const ids = [statusCard.shownId, inbox.isOpen ? inbox.currentId : null].filter((x): x is string => !!x);
    const serve = !!inbox.isOpen;
    const k = `${rects.join('|')}#${ids.join(',')}#${+serve}`;
    if (k === panelsKey) return;
    panelsKey = k;
    bus.emit('ui.obstacles', { key: 'panels', rects, ids, serve });
  }

  /**
   * M3.5 walk-up peek: within PEEK_M of a working agent its real screen is watched (ctx.screens arbiter, RND's
   * screenFeed: the desk monitor atlas + the status card read it); ≤ 2 at once, nearest first. 10 Hz, on change only.
   */
  const PEEK_M = 1.5;
  let peekKey = '';
  function peekScreens(c: Ctx) {
    let ids: string[] = [];
    if (c.camera && !document.hidden) {
      const cp = c.camera.position;
      const near: [number, string][] = [];
      for (const a of actors?.list?.() ?? []) {
        const e = a.entity ?? store.entities.get(a.id);
        if (!e || e.status !== 'working' || !a.pos) continue;
        const d = Math.hypot(a.pos.x - cp.x, a.pos.z - cp.z);
        if (d <= PEEK_M + 0.35 /* the seated body's reach */) near.push([d, a.id]);
      }
      near.sort((x, y) => x[0] - y[0]);
      ids = near.slice(0, 2).map((x) => x[1]);
    }
    const k = ids.join(',');
    if (k === peekKey) return;
    peekKey = k;
    ctx.screens?.want?.('peek', ids);
  }

  // ---- frame update ----
  let lastSlow = 0;
  // (PLY's controller always has `follow`; the UI's own spring follow below is the fallback for one without)
  const fallbackFollow: Partial<Pick<Player, 'follow'>> = ctx.player;
  layout();

  return {
    update(c: Ctx) {
      // every frame: aim + glide/follow (cheap, allocation-free)
      const s = syncScope();
      const world = s === 'world-locked' || s === 'world-unlocked';
      if (world && drawer.state !== 'fullscreen' && c.camera) {
        const a = aim.pick(c.camera);
        if ((a?.id ?? null) !== (aimed?.id ?? null)) bus.emit('aim', { id: a?.id ?? null }); // [FX M2] hovered agent → ring + nameplate (§6.7)
        aimed = a;
        const ph = a ? null : ctx.player?.hint?.(); // [PLY M1.5] world affordance: "E sit" / "E ride the slide" / "that's scout's chair"
        if (ph) hud.aim(ph.text, ph.verb ? '' : null); else hud.aim(a?.entity ? label(a.entity) : null);
        hud.aimDock(!ph && a?.entity ? chinDock(a, c.camera) : null); // [UI fix r3] the hint never sits on the face
      } else if (aimed) { aimed = null; hud.aim(null); bus.emit('aim', { id: null }); }
      go.update(performance.now()); // [PLY m3 fix r3, cross-owner] go-there: search slice, re-aim, watch, settle (goThereCtl)
      if (lens) lensStep(c.rawDt || 0.016); // [UI fix r2] walk-up lens widen / restore
      if (glide && ctx.player) {
        const t = Math.min(1, (performance.now() - glide.t0) / glide.dur);
        const q = glide.path.at(t); // eased, arc-length along the nav route (goto.ts)
        ctx.player.setPose(q[0], q[1], q[2], q[3], q[4]);
        if (t >= 1) { glide = null; go.landed(ctx.player.getPose()); }
      } else if (followId && ctx.player && typeof fallbackFollow.follow !== 'function') {
        const a = actorOf(followId);
        if (!a) stopFollow();
        else {
          const p = ctx.player.getPose();
          const dx = a.pos.x - p[0], dz = a.pos.z - p[2];
          const dist = Math.hypot(dx, dz);
          const want = 2.4;
          const kk = 1 - Math.exp(-3 * (c.rawDt || 0.016));
          const nx = p[0] + (dist > 0.01 ? dx / dist : 0) * (dist - want) * kk;
          const nz = p[2] + (dist > 0.01 ? dz / dist : 0) * (dist - want) * kk;
          const yaw = Math.atan2(-dx, -dz);
          const pitch = Math.atan2((a.pos.y ?? 0) + 0.55 - (p[1] + 1.2), Math.max(0.5, dist)); // look at the agent's face
          ctx.player.setPose(nx, p[1] + (a.pos.y - p[1]) * kk, nz, p[3] + wrapAngle(yaw - p[3]) * kk, p[4] + (pitch - p[4]) * kk);
        }
      }
      // ≤ 20 Hz minimap (self-throttled)
      const now = performance.now();
      minimap?.update(now);
      // ≤ 10 Hz DOM work
      if (now - lastSlow < 100) return;
      lastSlow = now;
      hud.update(pillFilter);
      hud.follow(followId && store.entities.get(followId) ? label(store.entities.get(followId)) : null);
      chevrons.update(c.camera);
      if (inbox.isOpen) { inbox.render(); if (notify.count && drawer.state !== 'fullscreen') notify.foldBlocked(); } // the (visible) inbox replaces the red toasts
      // status card: the aimed agent within 6 m, else the selected one (§8)
      let card: Entity | null = null, via: 'aim' | 'select' = 'aim';
      if (aimed && c.camera && drawer.state !== 'fullscreen') {
        const cp = c.camera.position;
        if (Math.hypot(aimed.pos.x - cp.x, aimed.pos.z - cp.z) <= STATUS_CARD_AIM_M) card = store.entities.get(aimed.id) ?? null;
      }
      if (!card && selectedId && drawer.state !== 'fullscreen') { card = store.entities.get(selectedId) ?? null; via = 'select'; }
      if (minimap?.isOverview) card = null;
      // typing into that same agent's terminal: its card over the world only duplicates the drawer (reviewer r3)
      if (card && drawer.focused && drawer.activeId === card.id) card = null;
      statusCard.update(card, via, { collapsed: !!card && inbox.isOpen && inbox.currentId === card.id });
      // the tour card sits bottom-centre; on a narrow strip it would sit on the status card → move it up top
      if (onboarding.active) onboarding.el.classList.toggle('up', !!card && stripW < 1150);
      publishPanels();
      peekScreens(c);
      if (roster.isOpen) roster.render(); // 10 Hz: elapsed chips tick; rows are diffed in place
      hotbar.update({ hidden: drawer.state === 'fullscreen' || !!minimap?.isOverview }); // (`params.nohotbar` was never set by parseParams either)
      if (triage.isOpen) triage.render();
      drawer.tick();
      if (Math.floor(now / 250) % 2 === 0) drawer.render();
      // unread clears when the active tab is visible and focused-or-hovered for ≥ 1 s (§8.9)
      const look = drawer.activeId && lookingAt(drawer.activeId) ? drawer.activeId : null;
      if (look !== unreadWatch.id) unreadWatch = { id: look, since: now };
      else if (look && now - unreadWatch.since >= UNREAD_CLEAR_MS) unread.clear(look);
    },
    select,
    openTerminal: (id: string) => openTerminal(id),
    closeTerminal: () => drawer.close(),
    roster: (open: boolean, groupBy?: string) => (open ? roster.open({ focus: 'list', groupBy }) : roster.close()),
    keyScope: () => scope(),
    aimed: () => aimed?.id ?? null,
  };
}
