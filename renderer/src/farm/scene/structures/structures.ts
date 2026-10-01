/**
 * Structures system: builds every landmark of `STRUCTURES` (except the waterfall, which is terrain) plus the hub
 * dressing, bakes their static parts into a few merged meshes per map region (vertex colours, two materials), and
 * drives the live bits: gauges (windmill = CPU, water tower = RAM, silo = disk, chimney smoke = disk IO, barn
 * thermometer = temperature, barn lantern = GPU), the mailbox flag, the shipping bin, the noticeboard, the signpost,
 * the bell, windows and lamps at night.
 *
 * Publishes: colliders, interactables, service 'walkSurface' (porch, bridge, dock) and service 'structureSpots'
 * (seats, hammock, pigeon loft, bin drop-off… for the farmers and life packages).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AudioService, LightEmitter, LightsService, SceneCtx, SystemFactory } from '../context.ts';
import type { FarmerView, Season, ValleyState } from '../../model/types.ts';
import { unreadCount } from '../../model/valley.ts';
import { SITES, STRUCTURES, WORLD, heightAt } from '../../world/map.ts';
import type { Structure, StructureId } from '../../world/map.ts';
import { WORKSPACE_COLORS } from '../toon.ts';
import { bakeInto, glowMat, setGlow, solidMat } from './kit.ts';
import { levelsFrom, newLevels, rigOf } from './rig.ts';
import type { Env, Rig } from './rig.ts';
import { FARMHOUSE, buildFarmhouse } from './farmhouse.ts';
import { BARN, SILO, WATER_TOWER, WINDMILL, buildBarn, buildSilo, buildWaterTower, buildWindmill } from './landmarks.ts';
import { NOTICEBOARD, SHIPPING_BIN, buildMailbox, buildNoticeboard, buildShippingBin, buildSignpost, buildToolshed, buildWell } from './hub.ts';
import type { Arrow, Board, Note, Signpost } from './hub.ts';
import { BRIDGE, CAMPFIRE_SEATS, DOCK, bridgeDeck, buildBridge, buildCampfire, buildDock, dockStart } from './leisure.ts';
import type { BridgeOpts, DeckOpts } from './leisure.ts';
import { buildDressing } from './dressing.ts';
import { createUpgrades, type Upgrades } from './upgrades.ts';
import { LOOKOUT, PERGOLA, PICNIC, SPRING, buildHotSpring, buildLookout, buildPergola, buildPicnic, lookoutFloor, lookoutSeats, springSeats, telescopeStand } from './nooks.ts';
import type { NookSeat } from './nooks.ts';
import { HAY, ORCHARD, STONES, SWING, buildHayMeadow, buildOrchard, buildStones, buildSwingTree, hayNaps, standingStones, stoneSeats } from './countryside.ts';
import { partName, recordParts } from '../parts.ts';

import type { StructureSpot, StructureSpots } from '../context.ts';
export type { StructureSpot, StructureSpots };

const CELL = 36;
const HUB_SAY_WISH = [
  'You toss a coin in… plink! May every build be green. ✨',
  'A coin for the well: may nobody ever need you at 3 am.',
  'Plink! You wish for fewer merge conflicts.',
  'The well gurgles approvingly. Your tests feel luckier already.',
  'You wish for a cozy day in the valley. Granted, probably.',
];

const CHECKERS_SAY = [
  'Red to move. Someone is about to be kinged. 👑',
  'A tense endgame. Neither farmer will admit to a draw.',
  'The scorecard reads: Clawds 12, Codexes 12. Rematch!',
];

export const structuresSystem: SystemFactory = (ctx: SceneCtx) => {
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const group = new THREE.Group();
  group.name = 'structures';
  ctx.scene.add(group);

  const solid = solidMat();
  const glow = glowMat(0);
  const env: Env = { t: 0, dt: 0, night: 0, wind: { x: 0, z: 0 }, lv: newLevels() };
  const removers: (() => void)[] = [];

  interface Placed { s: Structure; root: THREE.Object3D; rig?: Rig }
  let placed = new Map<StructureId, Placed>();
  let dressingRig: Rig | undefined;
  let upgrades: Upgrades | undefined;
  const lights = ctx.services.get('lights') as LightsService | undefined;
  const lightOffs: (() => void)[] = [];
  /** move kit/root-local emitters to world space (in place: rigs keep mutating them) and register them */
  const addLights = (list: LightEmitter[] | undefined, m: THREE.Matrix4) => {
    if (!list || !lights) return;
    for (const e of list) {
      e.pos.applyMatrix4(m);
      e.dir?.transformDirection(m);
      lightOffs.push(lights.add(e));
    }
  };
  let baked: THREE.Mesh[] = [];
  let spotsMap = new Map<string, StructureSpot>();
  let seatList: StructureSpot[] = [];
  let season: Season = ctx.valley.sky.season;

  // local ↔ world for a structure
  const toWorld = (s: Structure, lx: number, lz: number) => ({ x: s.x + lx * Math.cos(s.yaw) + lz * Math.sin(s.yaw), z: s.z - lx * Math.sin(s.yaw) + lz * Math.cos(s.yaw) });
  const toLocal = (s: Structure, x: number, z: number) => { const dx = x - s.x, dz = z - s.z, c = Math.cos(s.yaw), sn = Math.sin(s.yaw); return { x: dx * c - dz * sn, z: dx * sn + dz * c }; };
  const spot = (name: string, s: Structure, lx: number, ly: number, lz: number, yawLocal = 0, kind = name) => {
    const w = toWorld(s, lx, lz);
    const v: StructureSpot = { x: w.x, y: s.y + ly, z: w.z, yaw: s.yaw + yawLocal, kind };
    spotsMap.set(name, v);
    return v;
  };

  const S = (id: StructureId) => STRUCTURES.find((x) => x.id === id)!;
  const dockOpts = (s: Structure): DeckOpts => {
    const water = WORLD.water - s.y;
    return { deckY: water + 0.75, water, ground: (lz) => { const w = toWorld(s, 0, lz); return heightAt(w.x, w.z) - s.y; } };
  };
  const bridgeOpts = (s: Structure): BridgeOpts => {
    const a = toWorld(s, 0, -BRIDGE.L / 2), b = toWorld(s, 0, BRIDGE.L / 2);
    return { yA: heightAt(a.x, a.z) - s.y, yB: heightAt(b.x, b.z) - s.y, water: WORLD.water - s.y, ground: (lx, lz) => { const w = toWorld(s, lx, lz); return heightAt(w.x, w.z) - s.y; } };
  };

  function buildAll(): void {
    const o = { season, night: 0, seed: 1 };
    placed = new Map();
    spotsMap = new Map();
    seatList = [];
    const make = (id: StructureId, root: THREE.Object3D) => {
      const s = S(id);
      root.position.set(s.x, s.y, s.z);
      root.rotation.y = s.yaw;
      group.add(root);
      placed.set(id, { s, root, rig: rigOf(root) });
    };
    make('farmhouse', buildFarmhouse(o));
    make('mailbox', buildMailbox(o));
    make('shippingBin', buildShippingBin(o));
    make('noticeboard', buildNoticeboard(o));
    make('well', buildWell(o));
    make('waterTower', buildWaterTower(o));
    make('barn', buildBarn(o));
    make('silo', buildSilo(o));
    make('windmill', buildWindmill(o));
    make('toolshed', buildToolshed(o));
    make('campfire', buildCampfire(o));
    make('dock', buildDock(o, dockOpts(S('dock'))));
    make('bridge', buildBridge(o, bridgeOpts(S('bridge'))));
    make('signpost', buildSignpost(o));
    make('pergola', buildPergola(o));
    make('picnic', buildPicnic(o));
    make('lookout', buildLookout(o));
    make('hotspring', buildHotSpring(o));
    make('orchard', buildOrchard(o));
    make('stones', buildStones(o));
    make('haymeadow', buildHayMeadow(o));
    make('swingtree', buildSwingTree(o));
    const flora = ctx.services.get('floraSolids') as { blocked(x: number, z: number, r: number): boolean } | undefined;
    const dr = buildDressing(season, 1, flora ? (x, z, r) => flora.blocked(x, z, r) : undefined);
    group.add(dr.root);
    dressingRig = rigOf(dr.root);
    upgrades = createUpgrades(ctx, { season, lamps: dr.lamps, blocked: (x, z, r) => flora?.blocked(x, z, r) ?? false });
    group.updateMatrixWorld(true);
    // animated lights (campfire, barn lantern) live on their structure's root
    for (const p of placed.values()) addLights(p.root.userData.lights as LightEmitter[] | undefined, p.root.matrixWorld);
    addLights(dr.root.userData.lights as LightEmitter[] | undefined, dr.root.matrixWorld);
    // building volumes that shadow freestanding lamps (a little inside the walls, so the walls still catch light)
    const occ = (id: StructureId, lx: number, lz: number, w: number, d: number, h: number) => {
      const st = S(id), p = toWorld(st, lx, lz);
      if (lights) lightOffs.push(lights.occluder({ x: p.x, z: p.z, yaw: st.yaw, w, d, y0: st.y - 0.5, y1: st.y + h }));
    };
    occ('farmhouse', 0, FARMHOUSE.bodyZ, 8.7, 6.1, 5.6);
    occ('barn', 0, 0, BARN.w - 0.4, BARN.d - 0.4, BARN.wallH + 1.6);
    occ('toolshed', 0, 0, 2.9, 2.3, 2.3);
    occ('silo', 0, 0, SILO.r * 1.6, SILO.r * 1.6, SILO.h);
    occ('windmill', 0, 0, WINDMILL.r1 * 2.1, WINDMILL.r1 * 2.1, WINDMILL.h * 0.75);
    bake();

    // ---- colliders ----
    for (const f of removers.splice(0)) f();
    const rect = (s: Structure, lx: number, lz: number, w: number, d: number, yawLocal = 0) => { const p = toWorld(s, lx, lz); removers.push(ctx.colliders.rect(p.x, p.z, w, d, s.yaw + yawLocal)); };
    const circ = (s: Structure, lx: number, lz: number, r: number) => { const p = toWorld(s, lx, lz); removers.push(ctx.colliders.circle(p.x, p.z, r)); };
    const fh = S('farmhouse'), F = FARMHOUSE;
    rect(fh, 0.3, F.bodyZ, 10.6, 7.0);
    rect(fh, -5.3, -1.0, 0.9, 2.6);
    for (const x of [F.porch.x0 + 0.15, -1.1, 1.1, F.porch.x1 - 0.15]) circ(fh, x, F.porch.z1 - 0.2, 0.16);
    rect(fh, (F.porch.x0 - 1.1) / 2, F.porch.z1 - 0.2, -1.1 - F.porch.x0, 0.14);
    rect(fh, (F.porch.x1 + 1.1) / 2, F.porch.z1 - 0.2, F.porch.x1 - 1.1, 0.14);
    for (const x of [F.porch.x0 + 0.15, F.porch.x1 - 0.15]) rect(fh, x, (F.porch.z0 + F.porch.z1) / 2, 0.14, F.porch.z1 - F.porch.z0);
    circ(fh, F.hammock.x, F.hammock.z - 1.6, 0.18); circ(fh, F.hammock.x, F.hammock.z + 1.6, 0.18);
    circ(fh, F.bell.x, F.bell.z, 0.2);
    circ(S('mailbox'), 0, 0, 0.28);
    rect(S('shippingBin'), 0, 0, 2.0, 1.2); rect(S('shippingBin'), 2.1, 0.3, 1.6, 1.6);
    rect(S('noticeboard'), 0, 0, 3.3, 0.4);
    circ(S('well'), 0, 0, 1.28);
    circ(S('signpost'), 0, 0, 0.3);
    circ(S('windmill'), 0, 0, 3.05);
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) circ(S('waterTower'), x * 2.2, z * 2.2, 0.36);
    rect(S('barn'), 0, 0, BARN.w + 0.3, BARN.d + 0.3);
    rect(S('barn'), 2.6, -BARN.d / 2 - 1.7, 1.6, 3.0, Math.PI / 2 + 0.25);
    circ(S('silo'), 0, 0, SILO.r + 0.3);
    rect(S('toolshed'), 0, 0, 3.4, 2.8); rect(S('toolshed'), 2.1, 0.1, 0.7, 1.6);
    circ(S('campfire'), 0, 0, 1.25);
    for (const [x, z] of CAMPFIRE_SEATS.slice(0, 3)) rect(S('campfire'), x, z, 2.0, 0.55, Math.atan2(-x, -z));
    for (const sgn of [-1, 1]) rect(S('bridge'), sgn * (BRIDGE.w / 2 + 0.05), 0, 0.24, BRIDGE.L - 0.4);
    // leisure nooks: posts, tables, lanterns and rails are solid; seats stay reachable
    const pg = S('pergola');
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) circ(pg, x * PERGOLA.post, z * PERGOLA.post, 0.22);
    circ(pg, 0, 0, 0.45);
    rect(pg, PERGOLA.bench.x, PERGOLA.bench.z - 0.15, 2.2, 0.5);
    const pc = S('picnic');
    circ(pc, PICNIC.basket.x, PICNIC.basket.z, 0.3); circ(pc, PICNIC.parasol.x, PICNIC.parasol.z, 0.1); circ(pc, PICNIC.stump.x, PICNIC.stump.z, 0.26);
    const lk = S('lookout');
    circ(lk, LOOKOUT.telescope.x, LOOKOUT.telescope.z, 0.32);
    circ(lk, LOOKOUT.lamp.x, LOOKOUT.lamp.z, 0.2);
    for (const b of LOOKOUT.benches) rect(lk, b.x, b.z, LOOKOUT.benchW, 0.55, b.ry);
    {
      const vr = LOOKOUT.apothem / Math.cos(Math.PI / 8) - 0.1, side = 2 * (LOOKOUT.apothem - 0.1) * Math.tan(Math.PI / 8);
      for (let i = 1; i < 8; i++) { const a = (i / 8) * Math.PI * 2; rect(lk, Math.sin(a) * (vr * Math.cos(Math.PI / 8)), Math.cos(a) * (vr * Math.cos(Math.PI / 8)), side + 0.1, 0.16, a); }
    }
    const hs = S('hotspring');
    circ(hs, SPRING.cx, SPRING.cz, SPRING.r - 0.05); // the rim seats at seatR stay reachable
    for (const l of SPRING.lanterns) circ(hs, l.x, l.z, 0.32);
    circ(hs, SPRING.spout.x, SPRING.spout.z, 0.42);
    rect(hs, 0, -3.5, 3.5, 0.3);
    // countryside nooks: trunks, hives, the stand, stones, bales and the wagon are solid
    const oc = S('orchard');
    for (const t of ORCHARD.trees) circ(oc, t.x, t.z, 0.25);
    for (const h of ORCHARD.hives) circ(oc, h.x, h.z, 0.4);
    circ(oc, ORCHARD.stand.x, ORCHARD.stand.z, 0.65);
    const st = S('stones');
    for (const p of standingStones()) circ(st, p.x, p.z, 0.5);
    circ(st, 0, 0, STONES.altar.r);
    const hm = S('haymeadow');
    for (const b of HAY.bales) circ(hm, b.x, b.z, 0.75);
    rect(hm, HAY.wagon.x, HAY.wagon.z, 1.8, 3.2, HAY.wagon.ry);
    const sw = S('swingtree');
    circ(sw, SWING.trunk.x, SWING.trunk.z, SWING.trunk.r + 0.1);
    for (const [x, z, r] of dr.circles) removers.push(ctx.colliders.circle(x, z, r));
    for (const [x, z, w, d, y] of dr.rects) removers.push(ctx.colliders.rect(x, z, w, d, y));

    // ---- spots for other packages ----
    spot('hammock', fh, F.hammock.x, F.hammock.y, F.hammock.z, Math.PI / 2, 'nap');
    spot('rocker', fh, F.rocker.x, F.rocker.y, F.rocker.z, 0.35, 'seat');
    spot('bell', fh, F.bell.x, F.bell.y, F.bell.z);
    spot('pigeonLoft', fh, F.loft.x, F.loft.y, F.loft.z + 0.9, 0, 'perch');
    spot('binDrop', S('shippingBin'), SHIPPING_BIN.drop.x, 0, SHIPPING_BIN.drop.z, Math.PI, 'drop');
    spot('mailbox', S('mailbox'), 0, 0, 0.9, Math.PI);
    spot('well', S('well'), 0, 0, 1.9, Math.PI);
    spot('noticeboard', S('noticeboard'), 0, 0, 1.6, Math.PI);
    const ds = S('dock'), dopt = dockOpts(ds);
    spot('dockEnd', ds, 0, dopt.deckY, DOCK.z1 - 0.8, 0, 'fish');
    spot('campfire', S('campfire'), 0, 0, 0);
    const cf = S('campfire');
    for (const [x, z] of CAMPFIRE_SEATS) { const w = toWorld(cf, x * 0.88, z * 0.88); seatList.push({ x: w.x, y: heightAt(w.x, w.z) + 0.5, z: w.z, yaw: Math.atan2(-x, -z) + cf.yaw, kind: 'fire' }); }
    seatList.push(spotsMap.get('rocker')!);
    for (const st of dr.seats) seatList.push(st);
    // leisure nooks (paired kinds — checkers, blanket — are published as consecutive pairs facing each other)
    const nook = (id: StructureId, list: readonly NookSeat[], kind: string) => { for (const q of list) seatList.push(spot(`${id}:${kind}:${seatList.length}`, S(id), q.x, q.y, q.z, q.yaw, kind)); };
    nook('pergola', PERGOLA.players, 'checkers');
    nook('pergola', [PERGOLA.bench], 'bench');
    nook('picnic', PICNIC.places, 'blanket');
    nook('lookout', lookoutSeats(), 'lookout');
    nook('hotspring', springSeats(), 'soak');
    nook('orchard', [ORCHARD.bench], 'bench');
    nook('stones', stoneSeats(), 'bench');
    nook('swingtree', [SWING.bench], 'bench');
    hayNaps().forEach((q, i) => spot(`haymeadow:nap:${i}`, S('haymeadow'), q.x, q.y, q.z, q.yaw, 'hayNap'));
    const ts = telescopeStand();
    spot('telescope', S('lookout'), ts.x, ts.y, ts.z, ts.yaw, 'telescope');
    spot('lookoutView', S('lookout'), 0, LOOKOUT.deck, LOOKOUT.apothem - 0.75, 0, 'view');
  }

  /** merge every mesh tagged `userData.bake` into per-cell meshes (world space), two materials total */
  function bake(): void {
    const buckets = new Map<string, THREE.BufferGeometry[]>();
    const kill: THREE.Mesh[] = [];
    const c = new THREE.Vector3();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.userData.bake) return;
      addLights(m.userData.emitters as LightEmitter[] | undefined, m.matrixWorld);
      const g = bakeInto(m.geometry.clone(), m.matrixWorld);
      let top: THREE.Object3D = m;
      while (top.parent && top.parent !== group) top = top.parent;
      partName(g, top.name || 'structure'); // provenance for dev tools (scene/parts.ts)
      g.computeBoundingSphere();
      c.copy(g.boundingSphere!.center);
      const key = `${m.userData.bake}|${Math.floor(c.x / CELL)}|${Math.floor(c.z / CELL)}`;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(g);
      kill.push(m);
    });
    for (const m of kill) { m.removeFromParent(); m.geometry.dispose(); if (m.material !== solid && (m.material as THREE.Material).dispose) (m.material as THREE.Material).dispose(); }
    for (const [key, geos] of buckets) {
      const g = mergeGeometries(geos, false);
      if (g) recordParts(g, geos);
      for (const x of geos) x.dispose();
      if (!g) continue;
      g.computeBoundingSphere();
      const isGlow = key.startsWith('glow');
      const mesh = new THREE.Mesh(g, isGlow ? glow : solid);
      mesh.name = `structures:${key}`;
      mesh.castShadow = !isGlow;
      mesh.receiveShadow = !isGlow;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      baked.push(mesh);
    }
  }

  function disposeAll(): void {
    upgrades?.dispose();
    upgrades = undefined;
    for (const f of removers.splice(0)) f();
    for (const f of lightOffs.splice(0)) f();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose(); // plaques, noticeboard, signpost canvases
    });
    group.clear();
    baked = [];
  }

  buildAll();

  // ---- interactables ----
  const P = (id: StructureId) => placed.get(id)!;
  const vec = (id: StructureId, lx: number, ly: number, lz: number) => (out: THREE.Vector3) => {
    const s = S(id), w = toWorld(s, lx, lz);
    return out.set(w.x, s.y + ly, w.z);
  };
  const say = (t: string, ms?: number) => ctx.ui.say(t, ms);
  const lvl = env.lv;
  const gaugeLabel = (name: string, v: () => string) => () => (lvl.live ? `${name} · ${v()}` : name);
  const pctS = (v: number) => `${Math.round(v * 100)}%`;
  let commitsToday = 0;
  const interact = [
    ctx.interact.add({ id: 'mailbox', kind: 'structure', verb: 'Check mail', label: () => { const n = unreadCount(ctx.valley.letters); return n ? `Mailbox (${n} new)` : 'Mailbox'; }, pos: vec('mailbox', 0, 1.2, 0), use: () => { audio()?.play('mail', { pos: vec('mailbox', 0, 1.2, 0)(new THREE.Vector3()) }); ctx.ui.mailbox(); } }),
    ctx.interact.add({ id: 'shippingBin', kind: 'structure', verb: 'Peek into', label: () => 'Shipping bin', pos: vec('shippingBin', 0, 0.9, 0), use: () => {
      P('shippingBin').rig?.poke?.('ship');
      audio()?.play('creak', { pos: vec('shippingBin', 0, 0.9, 0)(new THREE.Vector3()) });
      say(commitsToday ? `${commitsToday} crate${commitsToday === 1 ? '' : 's'} shipped today — the farmers have been busy! 📦` : 'Empty so far today. The first commit will fill it.');
    } }),
    ctx.interact.add({ id: 'noticeboard', kind: 'structure', verb: 'Read', label: () => 'Noticeboard', pos: vec('noticeboard', 0, NOTICEBOARD.y, 0.1), reach: 3.6, use: () => { audio()?.play('page'); ctx.ui.noticeboard(); } }),
    ctx.interact.add({ id: 'well', kind: 'structure', verb: 'Make a wish', label: () => 'Wishing well', pos: vec('well', 0, 1.1, 0), use: () => {
      P('well').rig?.poke?.('wish');
      const at = vec('well', 0, 0.5, 0)(new THREE.Vector3());
      setTimeout(() => { audio()?.play('splash', { pos: at }); audio()?.play('sparkle', { pos: at, volume: 0.6 }); }, 650);
      say(HUB_SAY_WISH[Math.floor(Math.random() * HUB_SAY_WISH.length)]);
    } }),
    ctx.interact.add({ id: 'windmill', kind: 'structure', verb: 'Read', label: gaugeLabel('Windmill', () => `CPU ${pctS(lvl.cpu)}`), pos: vec('windmill', WINDMILL.plaque.x, WINDMILL.plaque.y, WINDMILL.plaque.z), reach: 4.5, use: () => ctx.ui.stats() }),
    ctx.interact.add({ id: 'waterTower', kind: 'structure', verb: 'Read', label: gaugeLabel('Water tower', () => `RAM ${lvl.memUsedGB.toFixed(1)} / ${lvl.memTotalGB.toFixed(0)} GB`), pos: vec('waterTower', 0, WATER_TOWER.plaque.y, WATER_TOWER.plaque.z), reach: 4.5, use: () => ctx.ui.stats() }),
    ctx.interact.add({ id: 'silo', kind: 'structure', verb: 'Read', label: gaugeLabel('Silo', () => `disk ${pctS(lvl.disk)}`), pos: vec('silo', SILO.plaque.x, SILO.plaque.y, SILO.plaque.z), reach: 4.5, use: () => ctx.ui.stats() }),
    ctx.interact.add({ id: 'barn', kind: 'structure', verb: 'Read', label: gaugeLabel('Barn thermometer', () => (lvl.tempC == null ? 'no sensor' : `${Math.round(lvl.tempC)} °C`)), pos: vec('barn', BARN.thermo.x, 1.6, BARN.d / 2 + 0.3), reach: 4.5, use: () => ctx.ui.stats() }),
    ctx.interact.add({ id: 'signpost', kind: 'structure', verb: 'Read', label: () => 'Signpost', pos: vec('signpost', 0, 2.2, 0), reach: 3.6, use: () => ctx.ui.map() }),
    ctx.interact.add({ id: 'farmhouse:bell', kind: 'prop', verb: 'Ring', label: () => 'Bell', pos: vec('farmhouse', FARMHOUSE.bell.x + 0.5, 2.1, FARMHOUSE.bell.z), use: () => { ringBell(); say('Ding-a-ling! Everyone looks up… then back to work.'); } }),
    ctx.interact.add({ id: 'farmhouse:door', kind: 'prop', verb: 'Knock on', label: () => 'Farmhouse door', pos: vec('farmhouse', 0, 1.6, FARMHOUSE.door.z + 0.1), use: () => say('Knock knock… nobody home. Everyone is out in the fields!') }),
    ctx.interact.add({ id: 'campfire', kind: 'structure', verb: 'Warm hands at', label: () => 'Campfire', pos: vec('campfire', 0, 0.6, 0), reach: 3.4, use: () => say(ctx.lighting.night > 0.5 ? 'Toasty. The stars are out over the valley. 🔥' : 'Warm and crackly. Someone left marshmallows.') }),
    ctx.interact.add({ id: 'dock', kind: 'structure', verb: 'Fish from', label: () => 'Dock', pos: vec('dock', 0, dockOpts(S('dock')).deckY + 0.6, DOCK.z1 - 0.8), reach: 3.2, use: () => say('You cast a line… the fish seem busy compiling. 🎣') }),
    ctx.interact.add({ id: 'pergola', kind: 'structure', verb: 'Study', label: () => 'Checkers game', pos: vec('pergola', 0, PERGOLA.floor + 0.75, 0), reach: 3.2, use: () => say(CHECKERS_SAY[Math.floor(Math.random() * CHECKERS_SAY.length)]) }),
    ctx.interact.add({ id: 'picnic', kind: 'structure', verb: 'Nibble at', label: () => 'Picnic', pos: vec('picnic', 0, 0.3, 0), reach: 3.2, use: () => say(ctx.lighting.night > 0.5 ? 'The firefly jar glows. Someone saved you a slice of pie. 🥧' : 'Lemonade, sandwiches, a cherry pie. Help yourself! 🧺') }),
    ctx.interact.add({ id: 'lookout:telescope', kind: 'prop', verb: 'Look through', label: () => 'Telescope', pos: vec('lookout', LOOKOUT.telescope.x, LOOKOUT.deck + 1.05, LOOKOUT.telescope.z), reach: 3.2, use: () => say(ctx.lighting.night > 0.5 ? 'So many stars… is that one shaped like a crab? ✨' : 'You can see every field from up here. Tiny farmers, hard at work. 🔭') }),
    ctx.interact.add({ id: 'hotspring', kind: 'structure', verb: 'Dip toes in', label: () => 'Hot spring', pos: vec('hotspring', SPRING.cx, SPRING.water + 0.3, SPRING.cz), reach: 3.6, use: () => { audio()?.play('splash', { pos: vec('hotspring', SPRING.cx, SPRING.water, SPRING.cz)(new THREE.Vector3()), volume: 0.5 }); say('Ahh. Warm as a fresh build. ♨️'); } }),
    ctx.interact.add({ id: 'orchard', kind: 'structure', verb: 'Buy honey at', label: () => 'Honesty stand', pos: vec('orchard', ORCHARD.stand.x, 1.1, ORCHARD.stand.z), reach: 3.2, use: () => { audio()?.play('pop', { pos: vec('orchard', ORCHARD.stand.x, 1, ORCHARD.stand.z)(new THREE.Vector3()), volume: 0.6 }); say(season === 'winter' ? 'The bees are tucked up for winter. One jar left: you drop a coin in the tin. 🍯' : 'Clink. A coin in the tin, a jar of clover honey for you. The bees approve. 🐝'); } }),
    ctx.interact.add({ id: 'stones', kind: 'structure', verb: 'Touch', label: () => 'Standing stones', pos: vec('stones', 0, STONES.altar.h + 0.3, 0), reach: 3.6, use: () => { audio()?.play('sparkle', { pos: vec('stones', 0, 1, 0)(new THREE.Vector3()) }); say(ctx.lighting.night > 0.5 ? 'The runes hum softly. You feel a sudden urge to write tests. ✨' : 'Cool, old stone. Nobody remembers who raised them, only that the builds pass more often up here.'); } }),
    ctx.interact.add({ id: 'haymeadow', kind: 'structure', verb: 'Flop into', label: () => 'Hay meadow', pos: vec('haymeadow', HAY.bales[0].x, 0.9, HAY.bales[0].z), reach: 3.4, use: () => say(season === 'winter' ? 'The bales are frosty. Maybe in summer.' : 'Fwump. Warm hay, blue sky, the faint sound of someone else\'s CI running. 🌾') }),
    ctx.interact.add({ id: 'swingtree', kind: 'structure', verb: 'Push', label: () => 'Rope swing', pos: vec('swingtree', SWING.pivot.x, 0.9, SWING.pivot.z), reach: 3.4, use: () => { P('swingtree').rig?.poke?.('push'); audio()?.play('creak', { pos: vec('swingtree', SWING.pivot.x, 2, SWING.pivot.z)(new THREE.Vector3()), volume: 0.6 }); say('Wheee! The swing sails out over the valley.'); } }),
    ctx.interact.add({ id: 'toolshed', kind: 'structure', verb: 'Peek into', label: () => 'Toolshed', pos: vec('toolshed', -0.6, 1.2, 1.4), use: () => say('Rakes, hoes, a very old keyboard. Everything in its place.') }),
  ];

  function ringBell(): void {
    P('farmhouse').rig?.poke?.('blocked');
    audio()?.play('bell', { pos: vec('farmhouse', FARMHOUSE.bell.x + 0.5, 2.2, FARMHOUSE.bell.z)(new THREE.Vector3()) });
  }

  // ---- valley events ----
  const offValley = ctx.onValley((e) => {
    if (e.kind === 'blocked') ringBell();
    if (e.kind === 'ship') { P('shippingBin').rig?.poke?.('ship'); audio()?.play('creak', { pos: vec('shippingBin', 0, 0.9, 0)(new THREE.Vector3()), volume: 0.7 }); }
  });

  // ---- walkable tops ----
  const walk = (x: number, z: number): number | null => {
    // farmhouse porch + steps
    const fh = S('farmhouse'), F = FARMHOUSE;
    let l = toLocal(fh, x, z);
    if (l.x >= F.porch.x0 && l.x <= F.porch.x1 && l.z >= F.porch.z0 - 0.3 && l.z <= F.porch.z1) return fh.y + F.porch.y;
    if (l.x >= F.steps.x0 && l.x <= F.steps.x1 && l.z > F.steps.z0 && l.z <= F.steps.z1 + 0.1) {
      const k = Math.floor(((l.z - F.steps.z0) / (F.steps.z1 - F.steps.z0)) * 3);
      return fh.y + F.porch.y - (Math.min(2, k) + 1) * (F.porch.y / 3.3);
    }
    const br = S('bridge');
    l = toLocal(br, x, z);
    if (Math.abs(l.x) <= BRIDGE.w / 2 + 0.15 && Math.abs(l.z) <= BRIDGE.L / 2) return br.y + bridgeDeck(bridgeO, l.z);
    const dk = S('dock');
    l = toLocal(dk, x, z);
    if (Math.abs(l.x) <= DOCK.w / 2 + 0.05 && l.z >= dockZ0 - 0.1 && l.z <= DOCK.z1) return dk.y + dockO.deckY;
    const lk = S('lookout');
    if (Math.abs(x - lk.x) < 4 && Math.abs(z - lk.z) < 4) {
      l = toLocal(lk, x, z);
      const f = lookoutFloor(l.x, l.z);
      if (f !== null) return lk.y + f;
    }
    return null;
  };
  const bridgeO = bridgeOpts(S('bridge')), dockO = dockOpts(S('dock')), dockZ0 = dockStart(dockO);
  ctx.services.set('walkSurface', walk);
  const spots: StructureSpots = { get: (n) => spotsMap.get(n) ?? null, seats: () => seatList };
  ctx.services.set('structureSpots', spots);

  // ---- live content: noticeboard, signpost, mailbox, bin ----
  let contentT = 99, lastLetter: string | null = ctx.valley.letters[0]?.id ?? null;
  function notesFrom(v: ValleyState): Note[] {
    const out: Note[] = [];
    const farmers = [...v.farmers.values()];
    const plotLabel = (f: FarmerView) => v.plots.get(f.plotId)?.label ?? '';
    const where = (f: FarmerView) => { const l = plotLabel(f); return l ? ` · ${l}` : ''; };
    for (const f of farmers) if (f.needsYou) out.push({ pin: 'red', title: f.tag, tag: 'needs you', body: `${f.question ?? (f.detail || 'waiting for your answer')}${where(f)}` });
    for (const f of farmers) if (!f.needsYou && f.struggle >= 2) out.push({ pin: 'orange', title: f.tag, tag: 'struggling', body: `${f.detail || f.title || 'stuck on something'}${where(f)}` });
    for (const f of farmers) if (!f.needsYou && f.unseenDone) out.push({ pin: 'green', title: f.tag, tag: 'done ✓', body: `${f.title ?? (f.detail || 'all done')}${where(f)}` });
    for (const f of farmers) if (f.todos && f.todos.total > 0 && f.todos.done < f.todos.total && !f.needsYou) out.push({ pin: 'blue', title: f.tag, tag: `${f.todos.done}/${f.todos.total}`, body: f.todos.current ?? f.title ?? '' });
    return out;
  }
  function arrowsFrom(v: ValleyState): Arrow[] {
    const sp = S('signpost');
    const list: Arrow[] = [];
    for (const p of v.plots.values()) {
      if (p.stage === 'fallow' || p.stage === 'harvest') continue;
      const site = SITES[p.site];
      if (!site) continue;
      const dx = site.x - sp.x, dz = site.z - sp.z;
      list.push({ label: p.label, color: WORKSPACE_COLORS[p.colorIndex % WORKSPACE_COLORS.length], dir: Math.atan2(dx, dz), dist: Math.hypot(dx, dz) });
    }
    // busiest/needy first, then nearest
    list.sort((a, b) => a.dist - b.dist);
    return list;
  }
  function refreshContent(): void {
    const v = ctx.valley;
    (P('noticeboard').root.userData.board as Board | undefined)?.set(notesFrom(v));
    (P('signpost').root.userData.sign as Signpost | undefined)?.set(arrowsFrom(v), S('signpost').yaw);
    P('mailbox').rig?.poke?.('unread', unreadCount(v.letters));
    commitsToday = v.commitsToday;
    P('shippingBin').rig?.poke?.('commits', commitsToday);
    const newest = v.letters[0]?.id ?? null;
    if (newest && newest !== lastLetter) { P('mailbox').rig?.poke?.('mail'); }
    lastLetter = newest;
  }

  const windSvc = () => ctx.services.get('wind') as { at(x: number, z: number, t: number, out: { x: number; z: number }): { x: number; z: number } } | undefined;

  return {
    name: 'structures',
    update(f) {
      if (ctx.valley.sky.season !== season) { season = ctx.valley.sky.season; disposeAll(); buildAll(); contentT = 99; }
      env.t = f.time; env.dt = f.dt; env.night = ctx.lighting.night;
      env.wind.x = ctx.lighting.wind.x; env.wind.z = ctx.lighting.wind.z;
      const w = windSvc();
      if (w) w.at(ctx.player.pos.x, ctx.player.pos.z, f.time, env.wind);
      levelsFrom(ctx.valley.gauges, env.lv);
      setGlow(glow, env.night);
      contentT += f.dt;
      if (contentT > 1) { contentT = 0; refreshContent(); }
      for (const p of placed.values()) p.rig?.update(env);
      dressingRig?.update(env);
      upgrades?.update(env, ctx.valley.almanac, ctx.valley.sky.hour);
    },
    stats: () => ({ baked: baked.length, structures: placed.size }),
    dispose() {
      offValley();
      for (const r of interact) r();
      ctx.services.delete('walkSurface');
      ctx.services.delete('structureSpots');
      disposeAll();
      ctx.scene.remove(group);
    },
  };
};
