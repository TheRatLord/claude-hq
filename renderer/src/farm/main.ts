/**
 * Game boot. Wires the layers:
 *   net/store ──storeSource──▶ model/valley (pure) ──ValleyState──▶ scene systems + HUD
 *   HUD / scene ──AgentPort / HudNet──▶ net/store
 * Nothing below this file crosses those lines.
 *
 * URL params: ?t= (token, stripped), ?hour=, ?weather=, ?season=, ?pose=, ?quality=low|medium|high (beats Settings), ?timescale=,
 *             ?almanac=POINTS (demo: the almanac's starting prosperity), ?festival=ID (force a festival, model/calendar.ts)
 *             ?timeline=0 (demo: no seeded morning on the farmers' day timelines, model/timeline.ts)
 *             ?recaps=0 (demo: no seeded harvest recaps earlier today, model/recap.ts)
 *             ?pose=inside[:VIEW] (inside the farmhouse, scene/interior), ?pose=barn-inside[:VIEW] (the barn), ?pose=grotto[:VIEW] (the cave behind the falls)
 *             ?album=memory (the photo album in memory only, not IndexedDB)
 *             ?welcome=1 (open the first-run welcome tour, fresh; automated browsers skip it otherwise) | ?welcome=0 (never)
 */
import './hud/base.css';
import { R2S } from '../../../shared/protocol.ts';
import type { Season, WeatherKind } from './model/types.ts';
import { call, connect, onTermData, send, sendBytes, store } from '../net/store.ts';
import { createSettings } from '../core/settings.ts';
import { createPlatform } from '../ui/platform.ts';
import { createValley } from './model/valley.ts';
import { demoAlmanac } from './model/almanac.ts';
import { demoDay } from './model/timeline.ts';
import { demoRecaps } from './model/recap.ts';
import { createCollection } from './model/collection.ts';
import { createWallet } from './model/wallet.ts';
import { createFriends, friendDef } from './model/friends.ts';
import type { FriendLetter } from './model/friends.ts';
import { createOnboarding, shouldWelcome, tipsAllowed, parseOnboarding, emptyOnboarding } from './model/onboarding.ts';
import type { YardPort } from './hud/shop.ts';
import { installPhotoMode } from './photo.ts';
import { createAlbumStore } from './albumstore.ts';
import { installStampBook, watchPhotos } from './stampbook.ts';
import { installNewsroom } from './newsroom.ts';
import { installGuide } from './guidebook.ts';
import { installProjectBoard } from './projectboard.ts';
import { localJson } from './storage.ts';
import { createPrefsStore } from './prefs.ts';
import { ACTIONS, effectiveFpsCap, keyLabel, reducedMotion } from './model/prefs.ts';
import { storeSource, createAgentPort } from './source.ts';
import { createEngine } from './scene/engine.ts';
import type { Quality } from './scene/context.ts';
import { SYSTEMS } from './scene/systems.ts';
import { createController } from './player/controller.ts';
import { createHud } from './hud/hud.ts';
import type { HudNet } from './hud/port.ts';
import { installDevApi, POSES } from './dev/api.ts';
import { installOverlay } from './dev/overlay.ts';
import { installDesktop } from './desktop.ts';
import type { AudioService, FarmerLocator, IndoorSpace, VillagersService } from './scene/context.ts';
import { SITES } from './world/map.ts';

performance.mark('valley:main');   // every module evaluated (npm run bench -- --startup reads these marks)
const params = new URLSearchParams(location.search);
const settings = createSettings({ send });
const platform = createPlatform(settings);
connect({ token: params.get('t') });

const hudNet: HudNet = {
  send: (m) => store.conn.state === 'open' ? send(m) : false,
  call: (m) => call(m),
  sendBytes, onTermData,
  ready: () => store.conn.state === 'open' && store.hello !== null,
  herdrConnected: () => store.herdr.connected,
  entity: (id) => store.entities.get(id) ?? null,
  onTermState: (fn) => { const off = store.on('term.state', fn); return () => void off(); },
  onTermAck: (fn) => { const off = store.on('term.ack', fn); return () => void off(); },
  onGone: (fn) => { const off = store.on('gone', fn); return () => void off(); },
  onToast: (fn) => { const off = store.on('toast', (t) => fn(t.level, t.text)); return () => void off(); },
  onEntity: (fn) => { const off = store.on('entity', fn); return () => void off(); },
  onConn: (fn) => { const offs = [store.on('conn', fn), store.on('herdr', fn), store.on('hello', fn)]; return () => offs.forEach((o) => o()); },
  demoScenario: async (name, seed) => { const r = await call({ t: R2S.DEMO_SCENARIO, name, ...(seed !== undefined ? { seed } : {}) }); return { ok: r.ok, error: r.error }; },
};

/** the almanac persists per browser profile; the demo valley keeps a believable fortnight in memory instead */
const ALMANAC_KEY = 'claude-valley.almanac.v1';
/** each farmer's day timeline (model/timeline.ts): today only, per browser profile; the demo seeds a morning in memory */
const TIMELINE_KEY = 'claude-valley.timeline.v1';
/** harvest recaps (model/recap.ts): each farmer's last few stretches of work, per browser profile; the demo seeds some in memory */
const RECAPS_KEY = 'claude-valley.recaps.v1';
const valley = createValley(storeSource, {
  almanac: localJson(ALMANAC_KEY),
  timeline: localJson(TIMELINE_KEY),
  recaps: localJson(RECAPS_KEY),
});
addEventListener('pagehide', () => { valley.timeline.flush(); valley.recaps.flush(); });
store.on('hello', (h) => {
  if (!h.demo) return;
  let mem: unknown = demoAlmanac(Date.now(), params.get('almanac') ? Number(params.get('almanac')) : undefined);
  valley.useAlmanac({ load: () => mem, save: (d) => { mem = d; } });
  let tmem: unknown = null;
  valley.useTimeline({ load: () => tmem, save: (d) => { tmem = d; } }, params.get('timeline') === '0' ? null : demoDay);
  let rmem: unknown = null;
  valley.useRecaps({ load: () => rmem, save: (d) => { rmem = d; } }, params.get('recaps') === '0' ? null : demoRecaps);
});
const hour = params.get('hour');
if (hour !== null && hour !== '') valley.setSky({ hour: Number(hour) });
if (params.get('weather')) valley.setSky({ weather: params.get('weather') as WeatherKind });
if (params.get('season')) valley.setSky({ season: params.get('season') as Season });
if (params.get('festival')) valley.setSky({ festival: params.get('festival') });
store.on('event', (e) => valley.ingest(e));
store.on('hello', (h) => settings._applyServer(h.settings));

// browser-local comfort / graphics / accessibility prefs (model/prefs.ts; Settings in the pause menu)
const prefs = createPrefsStore();
const hud = createHud({ root: document.getElementById('hud') ?? document.body, net: hudNet, settings, platform, prefs });
const agents = createAgentPort((id) => hud.openTerminal(id));
const canvas = document.getElementById('valley') as HTMLCanvasElement;
// ?quality= wins over Settings → Graphics → quality (which systems read at start: it applies on reload)
const quality = ((['low', 'medium', 'high'] as const).find((q) => q === params.get('quality')) ?? prefs.data.quality) as Quality;
const engine = createEngine({
  canvas, valley: valley.state, onValley: valley.on, agents, ui: hud.ui, quality, now: () => store.now(),
});
const controller = createController(engine.ctx, canvas, () => prefs.data);
// Settings → Controls / Graphics / Accessibility applied live: fov, render scale, shadows, weather amount, reduced
// motion, the frame cap and the idle throttle (no input for `idleMin` minutes → a slow frame rate until you are back)
const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let lastInput = performance.now(), throttled = false;
const applyCap = () => {
  // automated browsers (tests, shots, bench, soak) never idle-throttle: their numbers must mean the real frame rate
  const cap = effectiveFpsCap(navigator.webdriver ? { ...prefs.data, idleMin: 0 } : prefs.data, performance.now() - lastInput);
  throttled = cap !== null && cap < (prefs.data.fpsCap || Infinity);
  engine.setFpsCap(cap);
};
const applyPrefs = () => {
  const p = prefs.data, cam = engine.ctx.camera;
  if (cam.fov !== p.fov) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
  engine.setRenderScale(p.renderScale);
  engine.setShadows(p.shadows);
  engine.ctx.comfort.weatherFx = p.weatherFx;
  engine.ctx.comfort.reducedMotion = reducedMotion(p.reducedMotion, !!motionQuery?.matches, settings.get('reducedMotion'));
  engine.ctx.comfort.headBob = p.headBob;
  engine.ctx.comfort.hands = p.hands;
  applyCap();
};
prefs.onChange(applyPrefs);
motionQuery?.addEventListener?.('change', applyPrefs);
settings.onChange((c) => { if ('reducedMotion' in c) applyPrefs(); });
for (const t of ['keydown', 'pointerdown', 'mousemove', 'wheel', 'touchstart'] as const) {
  addEventListener(t, () => { lastInput = performance.now(); if (throttled) applyCap(); }, { capture: true, passive: true });
}
setInterval(() => { if (!throttled) applyCap(); }, 5000);
applyPrefs();
engine.onFrame((f) => controller.update(f));
engine.ctx.services.set('controller', controller);
engine.ctx.services.set('settings', settings);
// the Collections book (forage + fishing, scene/forage): browser-local like the almanac; a first-ever find is a harvest
const COLLECTION_KEY = 'claude-valley.collection.v1';
const collection = createCollection(localJson(COLLECTION_KEY));
collection.onFind((r) => { if (r.isNew) valley.harvest('found'); });
collection.onSight((r) => { if (r.isNew) valley.harvest('found'); });
engine.ctx.services.set('collection', collection);
// the wallet (bits, the basket of finds, yard decor: model/wallet.ts; the store + yard are scene/yard, the panel hud/shop.ts):
// browser-local; finds go into the basket, real agent work pays a few bits a day (capped)
const WALLET_KEY = 'claude-valley.wallet.v1';
const wallet = createWallet(localJson(WALLET_KEY), { seed: () => Object.fromEntries(Object.entries(collection.data().found).map(([id, f]) => [id, f.n])) });
collection.onFind((r) => wallet.stash(r.def.id));
valley.on((e) => { wallet.work(e.kind); });
engine.ctx.services.set('wallet', wallet);
// friendship with the villagers + their daily requests (model/friends.ts; the villagers system talks, hud/friends.ts shows):
// browser-local; gifts come out of the basket, requests pay bits, milestone letters go in the mailbox
const FRIENDS_KEY = 'claude-valley.friends.v1';
const friends = createFriends(localJson(FRIENDS_KEY), {
  season: () => valley.state.sky.season,
  basket: { count: (id) => wallet.data().basket[id] ?? 0, take: (id, n) => wallet.take(id, n), stash: (id, n) => wallet.stash(id, n) },
  pay: (c, why) => wallet.reward(c, why),
  gift: (id) => { wallet.gift(id); },
});
const postFriendLetter = (l: FriendLetter) => valley.post({ id: l.id, at: l.at, from: l.from, fromName: friendDef(l.from)?.name ?? '', title: l.title, body: l.body });
for (const l of friends.data().letters) postFriendLetter(l);
friends.onChange((c) => { if (c.kind === 'milestone' && c.letter) postFriendLetter(c.letter); });
collection.onFind((r) => { if (r.def.kind === 'fish' && !r.def.junk) friends.caught(r.def.id, valley.state.sky.hour); });
valley.on((e) => friends.event(e.kind));
engine.ctx.services.set('friends', friends);
// the first-run welcome tour + one-time tips (model/onboarding.ts; hud/onboarding.ts shows it): browser-local. Real
// people get it on their first visit; tests / shots (navigator.webdriver) only with ?welcome=1
const ONBOARDING_KEY = 'claude-valley.onboarding.v1';
const onboardingStore = localJson(ONBOARDING_KEY);
const welcomeParam = params.get('welcome');
const automated = !!navigator.webdriver;
const onboarding = createOnboarding(onboardingStore, {
  autostart: shouldWelcome(parseOnboarding(onboardingStore.load()) ?? emptyOnboarding(), { param: welcomeParam, automated }),
  tips: tipsAllowed({ param: welcomeParam, automated }),
  pay: (c, why) => wallet.reward(c, why),
  gift: (id) => { wallet.gift(id); },
  post: (l) => valley.post({ ...l, fromName: friendDef(l.from)?.name ?? 'Posy' }),
});
if (onboarding.data().letter) { const l = onboarding.data().letter!; valley.post({ ...l, fromName: friendDef(l.from)?.name ?? 'Posy' }); }
collection.onFind((r) => onboarding.signal(r.def.kind === 'fish' ? 'fish' : 'forage'));
// the stamp book (model/stamps.ts, wired in stampbook.ts; hud/stamps.ts draws it in the Almanac): long-term goals read
// off every service above; browser-local; stamps pay a few bits and bring yard trophies at 10 / 25 / all
const stamps = installStampBook({ engine, controller, valley, collection, wallet, friends, ready: () => store.hello !== null });
engine.ctx.services.set('stamps', stamps);
// the Valley Projects (model/projects.ts, wired in projectboard.ts; scene/projects shows the places, hud/projects.ts the
// board's panel): the town's restoration arc, paid for in bits, finds, friendship and real agent work; browser-local
const projects = installProjectBoard({ valley, wallet, friends, ready: () => store.hello !== null });
engine.ctx.services.set('projects', projects);
// The Valley Gazette (model/gazette.ts, wired in newsroom.ts; hud/gazette.ts prints it): the weekly edition in the
// mailbox every Monday morning, the morning edition on the noticeboard / G; browser-local, the demo's in memory
const gazette = installNewsroom({ valley, collection, friends, stamps, demo: () => (store.hello ? !!store.hello.demo : null) });
engine.ctx.services.set('gazette', gazette);
// Fern's field notebook (model/guide.ts, wired in guidebook.ts; hud/guide.ts draws it): every activity in the valley,
// found from the services above (only a small 'seen' set of its own), her nudges (onboarding tips), the villagers'
// rumours, and the "what's new" letter (never on a first run: the profile hadn't met Posy before this load)
const guide = installGuide({
  engine, controller, valley, collection, wallet, friends, stamps, onboarding,
  photos: () => album.list().length,
  keys: () => Object.fromEntries(ACTIONS.map((a) => [a, keyLabel(prefs.data.keys[a])])),
  welcomed: onboarding.data().welcomed,
});
engine.ctx.services.set('guide', guide);
performance.mark('valley:systems-start');
for (const f of SYSTEMS) engine.add(f);
performance.mark('valley:systems');

// the model ticks off store changes (coalesced) and at 4 Hz regardless, so smoothing timers advance
let queued = false;
const tick = () => {
  queued = false; valley.tick(); engine.ctx.valley = valley.state;
  if (onboarding.data().active && (engine.ctx.services.get('indoors') as IndoorSpace | undefined)?.active) onboarding.signal('farmhouse');
};
const soon = () => { if (!queued) { queued = true; setTimeout(tick, 60); } };
for (const t of ['world', 'entity', 'gone', 'workspaces', 'stats', 'conn', 'herdr'] as const) store.on(t, soon);
setInterval(tick, 250);

hud.bind({
  valley: () => valley.state, onValley: valley.on, agents, interact: engine.ctx.interact,
  setModal(open) {
    engine.ctx.player.frozen = open;
    if (open && document.pointerLockElement) document.exitPointerLock();
    if (!open) controller.lockPointer();
  },
  travelTo(id) {
    const loc = engine.ctx.services.get('farmers') as FarmerLocator | undefined;
    const p = loc?.position(id);
    const f = valley.state.farmers.get(id) ?? valley.state.helpers.get(id);
    const plot = f ? valley.state.plots.get(f.plotId) : valley.state.plots.get(id);
    const gate = plot ? SITES[plot.site].gate : null;
    const tx = p?.x ?? gate?.x ?? 0, tz = p?.z ?? gate?.z ?? 0;
    const from = gate && p ? gate : { x: tx, z: tz + 4 };
    const dx = from.x - tx, dz = from.z - tz, l = Math.hypot(dx, dz) || 1;
    const px = tx + (dx / l) * 3.2, pz = tz + (dz / l) * 3.2;
    controller.teleport(px, pz, Math.atan2(-(tx - px), -(tz - pz)), -0.12);
  },
  markRead: (id) => valley.markRead(id),
  markAllRead: () => valley.markAllRead(),
  player: () => ({ x: engine.ctx.player.pos.x, z: engine.ctx.player.pos.z, yaw: engine.ctx.player.yaw }),
  locate: (id) => { const p = (engine.ctx.services.get('farmers') as FarmerLocator | undefined)?.position(id); return p ? { x: p.x, z: p.z } : null; },
  villagers: () => (engine.ctx.services.get('villagers') as VillagersService | undefined)?.list() ?? [],
  camera: () => engine.ctx.camera,
  sfx: (name) => (engine.ctx.services.get('audio') as AudioService | undefined)?.play(name),
  collection: () => collection,
  wallet: () => wallet,
  friends: () => friends,
  onboarding: () => onboarding,
  stamps: () => stamps,
  gazette: () => gazette,
  guide: () => guide,
  yard: () => engine.ctx.services.get('yard') as YardPort | undefined,
  service: (name) => engine.ctx.services.get(name),
});
engine.onFrame((f) => hud.update(f));
// the Electron shell (tray, badges, native notifications, summon hotkey, hidden-window render mode): a no-op in the
// browser (farm/desktop.ts, shared/desktop.ts, docs/valley/desktop.md)
installDesktop({ valley: () => valley.state, openTerminal: (id) => hud.openTerminal(id), openNeeds: () => hud.openNeeds(), setBackground: (ms) => engine.setBackground(ms) });

installDevApi({
  engine, controller, valley,
  demoForce: (id, patch) => call({ t: R2S.DEMO_FORCE, id, patch }),
  demoScenario: (name, seed) => call({ t: R2S.DEMO_SCENARIO, name, ...(seed !== undefined ? { seed } : {}) }),
});
installOverlay(engine);
// the photo album (farm/albumstore.ts: IndexedDB, browser-local; ?album=memory keeps it in memory): photo mode fills
// it, hud/album.ts shows it, the farmhouse photo wall (scene/interior/photowall.ts) hangs the favourites
const album = createAlbumStore({ memory: params.get('album') === 'memory' });
engine.ctx.services.set('album', album);
const photo = installPhotoMode(engine, controller, valley, canvas, { album, openAlbum: () => hud.ui.album?.() });
engine.ctx.services.set('photo', photo);
watchPhotos(stamps, photo, valley);
const ts = Number(params.get('timescale'));
if (params.get('timescale') !== null && Number.isFinite(ts)) engine.setTimeScale(ts);
const pose = params.get('pose');
if (pose) {
  const named = POSES[pose];
  const nums = pose.split(',').map(Number);
  if (named) (window as unknown as { __valley: { pose(n: string): void } }).__valley.pose(pose);   // nudged clear of stalls / trees (dev/api.ts)
  else if (nums.length >= 2 && nums.every(Number.isFinite)) controller.teleport(nums[0], nums[1], nums[2], nums[3]);
  // pose=inside (or inside:hearth, inside:shelf … see INSIDE_VIEWS in scene/interior/layout.ts): the farmhouse interior
  else if (/^inside(:|$)/.test(pose)) (engine.ctx.services.get('indoors') as IndoorSpace | undefined)?.view?.(pose.split(':')[1] || 'door');
  // pose=barn-inside (or barn-inside:loft, :stalls … see BARN_VIEWS in scene/interior/barnLayout.ts): the barn interior
  else if (/^barn-inside(:|$)/.test(pose)) (engine.ctx.services.get('indoors') as IndoorSpace | undefined)?.view?.(`barn:${pose.split(':')[1] || 'door'}`);
  // pose=grotto (or grotto:pool, :camp, :paintings, :chest, :mouth, :bats … see GROTTO_VIEWS in scene/grotto/room.ts): the cave behind the falls
  else if (/^grotto(:|$)/.test(pose)) (engine.ctx.services.get('indoors') as IndoorSpace | undefined)?.view?.(`grotto:${pose.split(':')[1] || 'cave'}`);
}

engine.start();
// ready: world received and a few frames drawn (the screenshot tool and the browser tests wait on this). The frames
// matter: systems fill in on their first updates (today's forageables, …) and the first frames compile every shader,
// which takes seconds under software rendering. A hidden tab draws no frames: give up waiting for them after 20 s.
let drawn = 0;
const stopCounting = engine.onFrame(() => { drawn++; });
const startedAt = performance.now();
let worldAt = 0;
const readyCheck = setInterval(() => {
  if (!worldAt && (store.hello && valley.state.farmers.size + valley.state.plots.size > 0 || store.conn.state === 'open' && store.entities.size === 0 && store.hello)) {
    worldAt = drawn + 1;
    performance.mark('valley:world');
    tick();
  }
  if (worldAt && (drawn >= worldAt + 3 || performance.now() - startedAt > 20_000)) {
    clearInterval(readyCheck);
    stopCounting();
    setTimeout(() => { performance.mark('valley:ready'); (window as unknown as { __valley: { ready: boolean } }).__valley.ready = true; }, 400);
  }
}, 100);
