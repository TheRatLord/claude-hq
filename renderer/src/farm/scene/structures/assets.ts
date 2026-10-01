/** Asset registrations for the structures package (gallery + systems build through these). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import type { AssetBuildOpts } from '../assets.ts';
import { buildFarmhouse } from './farmhouse.ts';
import { buildBarn, buildSilo, buildWaterTower, buildWindmill } from './landmarks.ts';
import { buildMailbox, buildNoticeboard, buildShippingBin, buildSignpost, buildToolshed, buildWell } from './hub.ts';
import type { Board } from './hub.ts';
import { buildBridge, buildCampfire, buildDock } from './leisure.ts';
import { buildHotSpring, buildLookout, buildPergola, buildPicnic } from './nooks.ts';
import { buildHayMeadow, buildOrchard, buildStones, buildSwingTree } from './countryside.ts';
import { Kit } from './kit.ts';
import * as P from './props.ts';
import { levelsFromParam, newLevels, rigOf } from './rig.ts';
import type { Env } from './rig.ts';

const genv: Env = { t: 0, dt: 0, night: 0, wind: { x: 2, z: 0.6 }, lv: newLevels() };
/** gallery animate: drive the model's rig with the slider as every gauge */
function animate(obj: THREE.Object3D, t: number, dt: number, param: number): void {
  // the gallery's `t` URL param collides with the dev server's auth token (?t=…) and arrives as NaN: keep our own clock
  if (!Number.isFinite(t)) t = obj.userData.clock = ((obj.userData.clock as number | undefined) ?? 0) + (Number.isFinite(dt) ? dt : 0);
  genv.t = t; genv.dt = Number.isFinite(dt) ? dt : 0; genv.night = (obj.userData.night as number | undefined) ?? 0;
  genv.wind.x = 2 * Math.cos(t * 0.1); genv.wind.z = 2 * Math.sin(t * 0.1);
  levelsFromParam(param, genv.lv);
  rigOf(obj)?.update(genv);
}
const opts = (o: AssetBuildOpts) => ({ season: o.season, night: o.night ?? 0, seed: o.seed });
const tag = <T extends THREE.Object3D>(o: T, b: AssetBuildOpts): T => { o.userData.night = b.night ?? 0; return o; };

defineAsset({ name: 'farmhouse', group: 'structure', note: 'the hub: chimney smoke = disk IO, bell rings when someone needs you', param: 'disk IO', build: (o) => tag(buildFarmhouse(opts(o)), o), animate });
defineAsset({ name: 'windmill', group: 'structure', note: 'blade speed = CPU; rail lamps = per-core load', param: 'CPU', build: (o) => tag(buildWindmill(opts(o)), o), animate });
defineAsset({ name: 'waterTower', group: 'structure', note: 'sight-glass water level = RAM', param: 'RAM', build: (o) => tag(buildWaterTower(opts(o)), o), animate });
defineAsset({ name: 'barn', group: 'structure', note: 'thermometer = hottest sensor, lantern = GPU busy', param: 'temp/GPU', build: (o) => tag(buildBarn(opts(o)), o), animate });
defineAsset({ name: 'silo', group: 'structure', note: 'grain in the window strip = disk used', param: 'disk', build: (o) => tag(buildSilo(opts(o)), o), animate });
defineAsset({ name: 'mailbox', group: 'structure', note: 'flag up = unread mail (slider > 0.5); wiggles on a new letter', param: 'unread', build: (o) => tag(buildMailbox(opts(o)), o), animate: (obj, t, dt, p) => { const r = rigOf(obj); r?.poke?.('unread', p > 0.5 ? 3 : 0); if (Math.floor(t / 4) !== Math.floor((t - dt) / 4)) r?.poke?.('mail'); animate(obj, t, dt, p); } });
defineAsset({ name: 'shippingBin', group: 'structure', note: "lid pops on 'ship'; crates = today's commits", param: 'commits', build: (o) => tag(buildShippingBin(opts(o)), o), animate: (obj, t, dt, p) => { const r = rigOf(obj); r?.poke?.('commits', Math.round(p * 12)); if (Math.floor(t / 5) !== Math.floor((t - dt) / 5)) r?.poke?.('ship'); animate(obj, t, dt, p); } });
defineAsset({ name: 'noticeboard', group: 'structure', note: 'live corkboard: who needs you, who struggles, todos', build: (o) => { const b = tag(buildNoticeboard(opts(o)), o); (b.userData.board as Board).set([
  { pin: 'red', title: 'Flint', tag: 'needs you', body: 'Allow editing package.json? · claude-hq' },
  { pin: 'orange', title: 'Moss', tag: 'struggling', body: 'tests keep failing in auth.spec.ts · api' },
  { pin: 'green', title: 'Juniper', tag: 'done ✓', body: 'Refactor the websocket store · web' },
  { pin: 'blue', title: 'Flint', tag: '3/7', body: 'Writing tests' },
  { pin: 'blue', title: 'Clover', tag: '1/4', body: 'Reading the router and mapping every endpoint' },
]); return b; }, animate });
defineAsset({ name: 'well', group: 'structure', note: 'Make a wish: crank spins, coin sparkle', build: (o) => tag(buildWell(opts(o)), o), animate: (obj, t, dt, p) => { if (Math.floor(t / 5) !== Math.floor((t - dt) / 5)) rigOf(obj)?.poke?.('wish'); animate(obj, t, dt, p); } });
defineAsset({ name: 'signpost', group: 'structure', note: 'arrows point at live fields, lettered with plot names', build: (o) => tag(buildSignpost(opts(o)), o), animate });
defineAsset({ name: 'toolshed', group: 'structure', build: (o) => tag(buildToolshed(opts(o)), o), animate });
defineAsset({ name: 'campfire', group: 'structure', note: 'flames, embers, a flickering local light (scene/lights) at night; log benches', build: (o) => tag(buildCampfire(opts(o)), o), animate });
defineAsset({ name: 'dock', group: 'structure', note: 'walkable planks into the pond, a rod with a bobbing float', build: (o) => tag(buildDock(opts(o)), o), animate });
defineAsset({ name: 'bridge', group: 'structure', note: 'walkable wooden arch over the river', build: (o) => tag(buildBridge(opts(o)), o), animate });
defineAsset({ name: 'pergola', group: 'structure', note: 'leisure nook: checkers table under wisteria, two stools (farmers play each other), hanging lantern', build: (o) => tag(buildPergola(opts(o)), o), animate });
defineAsset({ name: 'picnic', group: 'structure', note: 'leisure nook: gingham blanket for two, basket, parasol, firefly jar on a stump', build: (o) => tag(buildPicnic(opts(o)), o), animate });
defineAsset({ name: 'lookout', group: 'structure', note: "leisure nook: stargazers' deck, brass telescope, benches facing the valley, pennant in the wind", build: (o) => tag(buildLookout(opts(o)), o), animate });
defineAsset({ name: 'hotspring', group: 'structure', note: 'leisure nook: steaming foot-bath with rim seats, stone lanterns, bamboo spout, a rubber duck', build: (o) => tag(buildHotSpring(opts(o)), o), animate });
defineAsset({ name: 'orchard', group: 'structure', note: 'countryside nook: seasonal fruit trees, ladder and basket, beehives with bees, a honey honesty stand', build: (o) => tag(buildOrchard(opts(o)), o), animate });
defineAsset({ name: 'stones', group: 'structure', note: 'countryside nook: a ring of standing stones round an altar, runes glow cyan after dark', build: (o) => tag(buildStones(opts(o)), o), animate });
defineAsset({ name: 'haymeadow', group: 'structure', note: 'countryside nook: round bales on mown stripes, a loaded hay wagon, bales to doze against', build: (o) => tag(buildHayMeadow(opts(o)), o), animate });
defineAsset({ name: 'swingtree', group: 'structure', note: 'countryside nook: a big lone oak, a rope swing in the wind (poke "push"), a log bench', build: (o) => tag(buildSwingTree(opts(o)), o), animate: (obj, t, dt, p) => { if (Math.floor(t / 6) !== Math.floor((t - dt) / 6)) rigOf(obj)?.poke?.('push'); animate(obj, t, dt, p); } });

// small props (the hub dressing merges these; registered for the gallery)
const prop = (name: string, fn: (k: Kit, o: AssetBuildOpts) => void, note?: string) => defineAsset({ name, group: 'prop', note, build: (o) => { const k = new Kit(o.seed); fn(k, o); return k.build(new THREE.Group(), o.night ?? 0); } });
prop('bench', (k) => P.bench(k, {}));
prop('logBench', (k) => P.logBench(k, {}));
prop('lampPost', (k) => { P.lampPost(k, {}); }, 'head glass glows at night; in the valley it is a real local light (scene/lights)');
prop('barrel', (k) => P.barrel(k, {}));
prop('crate', (k) => P.crate(k, {}));
prop('hayBale', (k) => { P.hayBale(k, {}); P.hayBale(k, { x: 1.4 }, true); });
prop('cart', (k, o) => P.cart(k, {}, o.season === 'autumn' ? 'pumpkins' : 'hay'));
prop('picnicTable', (k) => P.picnicTable(k, {}));
prop('flowerPot', (k, o) => { P.flowerPot(k, {}, o.season, 0); P.flowerPot(k, { x: 0.8 }, o.season, 2, true); });
prop('wateringCan', (k) => P.wateringCan(k, {}));
prop('firewood', (k) => { P.firewood(k, {}); P.choppingBlock(k, { x: 1.4, z: 0.5 }); });
prop('fence', (k) => P.fenceRun(k, -2, 0, 2, 0, () => 0));
