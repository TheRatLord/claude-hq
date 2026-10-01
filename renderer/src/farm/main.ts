/**
 * Game boot. Wires the layers:
 *   net/store ──storeSource──▶ model/valley (pure) ──ValleyState──▶ scene systems + HUD
 *   HUD / scene ──AgentPort / HudNet──▶ net/store
 * Nothing below this file crosses those lines.
 *
 * URL params: ?t= (token, stripped), ?hour=, ?weather=, ?season=, ?pose=, ?quality=low|medium|high, ?timescale=
 */
import './hud/base.css';
import { R2S } from '../../../shared/protocol.ts';
import type { Season, WeatherKind } from './model/types.ts';
import { call, connect, onTermData, send, sendBytes, store } from '../net/store.ts';
import { createSettings } from '../core/settings.ts';
import { createPlatform } from '../ui/platform.ts';
import { createValley } from './model/valley.ts';
import { storeSource, createAgentPort } from './source.ts';
import { createEngine } from './scene/engine.ts';
import type { Quality } from './scene/context.ts';
import { SYSTEMS } from './scene/systems.ts';
import { createController } from './player/controller.ts';
import { createHud } from './hud/hud.ts';
import type { HudNet } from './hud/port.ts';
import { installDevApi, POSES } from './dev/api.ts';
import { installOverlay } from './dev/overlay.ts';
import type { AudioService, FarmerLocator, VillagersService } from './scene/context.ts';
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

const valley = createValley(storeSource);
const hour = params.get('hour');
if (hour !== null && hour !== '') valley.setSky({ hour: Number(hour) });
if (params.get('weather')) valley.setSky({ weather: params.get('weather') as WeatherKind });
if (params.get('season')) valley.setSky({ season: params.get('season') as Season });
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
  sfx: (name) => (engine.ctx.services.get('audio') as AudioService | undefined)?.play(name),
});
engine.onFrame((f) => hud.update(f));

installDevApi({
  engine, controller, valley,
  demoForce: (id, patch) => call({ t: R2S.DEMO_FORCE, id, patch }),
  demoScenario: (name, seed) => call({ t: R2S.DEMO_SCENARIO, name, ...(seed !== undefined ? { seed } : {}) }),
});
installOverlay(engine);
const ts = Number(params.get('timescale'));
if (params.get('timescale') !== null && Number.isFinite(ts)) engine.setTimeScale(ts);
const pose = params.get('pose');
if (pose) {
  const named = POSES[pose];
  const nums = pose.split(',').map(Number);
  if (named) controller.teleport(named[0], named[1], named[2], named[3]);
  else if (nums.length >= 2 && nums.every(Number.isFinite)) controller.teleport(nums[0], nums[1], nums[2], nums[3]);
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
