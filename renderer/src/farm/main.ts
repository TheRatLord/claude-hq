/**
 * Game boot. Wires the layers:
 *   net/store ──storeSource──▶ model/valley (pure) ──ValleyState──▶ scene systems + HUD
 *   HUD / scene ──AgentPort / HudNet──▶ net/store
 * Nothing below this file crosses those lines.
 *
 * URL params: ?t= (token, stripped), ?hour=, ?weather=, ?season=, ?pose=, ?quality=low|medium|high, ?timescale=,
 *             ?almanac=POINTS (demo: the almanac's starting prosperity), ?festival=ID (force a festival, model/calendar.ts)
 *             ?pose=inside[:VIEW] (inside the farmhouse, scene/interior)
 */
import './hud/base.css';
import { R2S } from '../../../shared/protocol.ts';
import type { Season, WeatherKind } from './model/types.ts';
import { call, connect, onTermData, send, sendBytes, store } from '../net/store.ts';
import { createSettings } from '../core/settings.ts';
import { createPlatform } from '../ui/platform.ts';
import { createValley } from './model/valley.ts';
import { demoAlmanac } from './model/almanac.ts';
import { createCollection } from './model/collection.ts';
import { createWallet } from './model/wallet.ts';
import { createFriends, friendDef } from './model/friends.ts';
import type { FriendLetter } from './model/friends.ts';
import type { YardPort } from './hud/shop.ts';
import { installPhotoMode } from './photo.ts';
import { storeSource, createAgentPort } from './source.ts';
import { createEngine } from './scene/engine.ts';
import type { Quality } from './scene/context.ts';
import { SYSTEMS } from './scene/systems.ts';
import { createController } from './player/controller.ts';
import { createHud } from './hud/hud.ts';
import type { HudNet } from './hud/port.ts';
import { installDevApi, POSES } from './dev/api.ts';
import { installOverlay } from './dev/overlay.ts';
import type { AudioService, FarmerLocator, IndoorSpace, VillagersService } from './scene/context.ts';
import { SITES } from './world/map.ts';

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
const valley = createValley(storeSource, {
  almanac: {
    load: () => { const raw = localStorage.getItem(ALMANAC_KEY); return raw ? JSON.parse(raw) : null; },
    save: (d) => localStorage.setItem(ALMANAC_KEY, JSON.stringify(d)),
  },
});
store.on('hello', (h) => {
  if (!h.demo) return;
  let mem: unknown = demoAlmanac(Date.now(), params.get('almanac') ? Number(params.get('almanac')) : undefined);
  valley.useAlmanac({ load: () => mem, save: (d) => { mem = d; } });
});
const hour = params.get('hour');
if (hour !== null && hour !== '') valley.setSky({ hour: Number(hour) });
if (params.get('weather')) valley.setSky({ weather: params.get('weather') as WeatherKind });
if (params.get('season')) valley.setSky({ season: params.get('season') as Season });
if (params.get('festival')) valley.setSky({ festival: params.get('festival') });
store.on('event', (e) => valley.ingest(e));
store.on('hello', (h) => settings._applyServer(h.settings));

const hud = createHud({ root: document.getElementById('hud') ?? document.body, net: hudNet, settings, platform });
const agents = createAgentPort((id) => hud.openTerminal(id));
const canvas = document.getElementById('valley') as HTMLCanvasElement;
const quality = (['low', 'medium', 'high'] as const).find((q) => q === params.get('quality')) as Quality | undefined;
const engine = createEngine({
  canvas, valley: valley.state, onValley: valley.on, agents, ui: hud.ui, quality, now: () => store.now(),
});
const controller = createController(engine.ctx, canvas);
engine.onFrame((f) => controller.update(f));
engine.ctx.services.set('controller', controller);
engine.ctx.services.set('settings', settings);
// the Collections book (forage + fishing, scene/forage): browser-local like the almanac; a first-ever find is a harvest
const COLLECTION_KEY = 'claude-valley.collection.v1';
const collection = createCollection({
  load: () => { const raw = localStorage.getItem(COLLECTION_KEY); return raw ? JSON.parse(raw) : null; },
  save: (d) => localStorage.setItem(COLLECTION_KEY, JSON.stringify(d)),
});
collection.onFind((r) => { if (r.isNew) valley.harvest('found'); });
collection.onSight((r) => { if (r.isNew) valley.harvest('found'); });
engine.ctx.services.set('collection', collection);
// the wallet (bits, the basket of finds, yard decor: model/wallet.ts; the store + yard are scene/yard, the panel hud/shop.ts):
// browser-local; finds go into the basket, real agent work pays a few bits a day (capped)
const WALLET_KEY = 'claude-valley.wallet.v1';
const wallet = createWallet({
  load: () => { const raw = localStorage.getItem(WALLET_KEY); return raw ? JSON.parse(raw) : null; },
  save: (d) => localStorage.setItem(WALLET_KEY, JSON.stringify(d)),
}, { seed: () => Object.fromEntries(Object.entries(collection.data().found).map(([id, f]) => [id, f.n])) });
collection.onFind((r) => wallet.stash(r.def.id));
valley.on((e) => { wallet.work(e.kind); });
engine.ctx.services.set('wallet', wallet);
// friendship with the villagers + their daily requests (model/friends.ts; the villagers system talks, hud/friends.ts shows):
// browser-local; gifts come out of the basket, requests pay bits, milestone letters go in the mailbox
const FRIENDS_KEY = 'claude-valley.friends.v1';
const friends = createFriends({
  load: () => { const raw = localStorage.getItem(FRIENDS_KEY); return raw ? JSON.parse(raw) : null; },
  save: (d) => localStorage.setItem(FRIENDS_KEY, JSON.stringify(d)),
}, {
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
for (const f of SYSTEMS) engine.add(f);

// the model ticks off store changes (coalesced) and at 4 Hz regardless, so smoothing timers advance
let queued = false;
const tick = () => { queued = false; valley.tick(); engine.ctx.valley = valley.state; };
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
  yard: () => engine.ctx.services.get('yard') as YardPort | undefined,
});
engine.onFrame((f) => hud.update(f));

installDevApi({
  engine, controller, valley,
  demoForce: (id, patch) => call({ t: R2S.DEMO_FORCE, id, patch }),
  demoScenario: (name, seed) => call({ t: R2S.DEMO_SCENARIO, name, ...(seed !== undefined ? { seed } : {}) }),
});
installOverlay(engine);
const photo = installPhotoMode(engine, controller, valley, canvas);
engine.ctx.services.set('photo', photo);
const ts = Number(params.get('timescale'));
if (params.get('timescale') !== null && Number.isFinite(ts)) engine.setTimeScale(ts);
const pose = params.get('pose');
if (pose) {
  const named = POSES[pose];
  const nums = pose.split(',').map(Number);
  if (named) controller.teleport(named[0], named[1], named[2], named[3]);
  else if (nums.length >= 2 && nums.every(Number.isFinite)) controller.teleport(nums[0], nums[1], nums[2], nums[3]);
  // pose=inside (or inside:hearth, inside:shelf … see INSIDE_VIEWS in scene/interior/layout.ts): the farmhouse interior
  else if (/^inside(:|$)/.test(pose)) (engine.ctx.services.get('indoors') as IndoorSpace | undefined)?.view?.(pose.split(':')[1] || 'door');
}

engine.start();
// ready: world received and a few frames drawn (the screenshot tool waits on this)
const readyCheck = setInterval(() => {
  if (store.hello && valley.state.farmers.size + valley.state.plots.size > 0 || store.conn.state === 'open' && store.entities.size === 0 && store.hello) {
    clearInterval(readyCheck);
    tick();
    setTimeout(() => { (window as unknown as { __valley: { ready: boolean } }).__valley.ready = true; }, 400);
  }
}, 100);
