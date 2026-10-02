/**
 * The player's pastimes: foraging and fishing, recorded in the Collections book (model/collection.ts, service
 * 'collection', set up by main.ts; the HUD's Collections panel reads the same book).
 *
 * Forage: each real day a handful (8–12) of the season's forageables lie around the valley (placement: place.ts,
 * deterministic per date). One InstancedMesh per kind in season, a twinkling glint per item (one additive draw) so
 * they can be spotted from a distance, and an interactable each ("[E] Pick up"): picking pops the item with a burst
 * of sparkles and records it; a picked spot stays empty until tomorrow's batch.
 *
 * Fishing: look at open water (the pond, from the dock or its beach, or the river) and press E to cast. The rod is
 * held in view, the bobber flies out on an arc and floats; it nibbles now and then, then dips under with a splash:
 * press E while it is down (a generous window, and a second chance if you miss) to reel in. What bites depends on the
 * season, the hour, the weather and the water (model/collection.ts `rollFish`). The catch is held up for a moment.
 *
 * Budget: ≤ 4 forage draws + the glint + (while fishing) rod, line, bobber, ripple and the held catch. No per-frame
 * allocation: matrices, vectors and the line buffer are reused.
 */
import * as THREE from 'three';
import type { AudioService, HandsPort, Interactable, SceneCtx, SystemFactory } from '../context.ts';
import { biteDelay, collectDef, forageDay, rand, rollFish } from '../../model/collection.ts';
import type { CollectionService, FindResult, ForageDef, ForageSpawn, WaterKind } from '../../model/collection.ts';
import { dayKey } from '../../model/almanac.ts';
import type { Season } from '../../model/types.ts';
import { POND, RIVER, RIVER_HALF_WIDTH, WORLD, distToPolyline, heightAt } from '../../world/map.ts';
import { ROD_LEN, bobberGeometry, catchGeometry, forageGeometry, forageRadius, glintGeometry, rippleGeometry, rodGeometry } from './models.ts';
import { forageMaterial, materialFor } from './assets.ts';
import { placeForage } from './place.ts';
import type { Spot } from './place.ts';

type Placed = Spot & { spawn: ForageSpawn; def: ForageDef; mesh: THREE.InstancedMesh; slot: number; picked: boolean; pop: number; phase: number };

const GLINTS = 16, BURST = 10;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _fwd = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _q2 = new THREE.Quaternion();

type Phase = 'idle' | 'cast' | 'wait' | 'bite' | 'reel' | 'show';

export const forageSystem: SystemFactory = (ctx: SceneCtx) => {
  const root = new THREE.Group();
  root.name = 'forage';
  ctx.scene.add(root);
  const book = () => ctx.services.get('collection') as CollectionService | undefined;
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const sfx = (n: Parameters<AudioService['play']>[0], pos?: THREE.Vector3, volume = 1, pitch = 1) => { try { audio()?.play(n, { pos, volume, pitch }); } catch { /* audio is optional */ } };
  const say = (t: string, ms = 3600, from?: string) => ctx.ui.say(t, ms, { who: from === WATER_ID ? 'Fishing' : 'Foraging', from });

  // ---------------------------------------------------------------------------------------- forage
  let day = '', pinned: string | null = null, season: Season = ctx.valley.sky.season;
  let placed: Placed[] = [];
  const meshes = new Map<string, THREE.InstancedMesh>();
  const removers: (() => void)[] = [];

  const glintMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.1, 1.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false });
  const glint = new THREE.InstancedMesh(glintGeometry(), glintMat, GLINTS + BURST);
  glint.name = 'forage:glint';
  glint.frustumCulled = false;
  glint.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < GLINTS + BURST; i++) glint.setMatrixAt(i, ZERO);
  root.add(glint);
  const burst = Array.from({ length: BURST }, () => ({ t: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
  let burstAt = 0;

  function clear(): void {
    for (const r of removers.splice(0)) r();
    for (const m of meshes.values()) { root.remove(m); m.dispose(); }
    meshes.clear();
    placed = [];
  }

  function spawnDay(d: string, s: Season): void {
    clear();
    day = d; season = s;
    const spawns = forageDay(d, s);
    const solids = ctx.services.get('floraSolids') as { blocked(x: number, z: number, r: number): boolean } | undefined;
    const spots = placeForage(spawns, (id) => collectDef(id) as ForageDef | undefined, forageRadius, { blocked: solids?.blocked });
    const picked = book()?.picked(d) ?? new Set<string>();
    const byId = new Map<string, typeof spots>();
    for (const sp of spots) { const a = byId.get(sp.spawn.id) ?? []; a.push(sp); byId.set(sp.spawn.id, a); }
    for (const [id, list] of byId) {
      const mesh = new THREE.InstancedMesh(forageGeometry(id), materialFor(id), list.length);
      mesh.name = `forage:${id}`;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // a handful of instances spread across the valley
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(mesh);
      meshes.set(id, mesh);
      list.forEach((sp, slot) => {
        const p: Placed = { ...sp, def: collectDef(id) as ForageDef, mesh, slot, picked: picked.has(sp.spawn.key), pop: 0, phase: (sp.spawn.seed % 1000) / 1000 };
        placed.push(p);
        writeItem(p, 1);
        removers.push(ctx.interact.add(forageInteractable(p)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function writeItem(p: Placed, k: number): void {
    if (p.picked && p.pop <= 0) { p.mesh.setMatrixAt(p.slot, ZERO); return; }
    _q.setFromAxisAngle(UP, p.yaw);
    _s.setScalar(p.s * k);
    _p.set(p.x, p.y, p.z);
    p.mesh.setMatrixAt(p.slot, _m.compose(_p, _q, _s));
  }

  function forageInteractable(p: Placed): Interactable {
    return {
      id: `forage:${p.spawn.key}`, kind: 'prop', verb: 'Pick up', reach: 2.8,
      label: () => p.def.name,
      pos: (out) => out.set(p.x, p.y + 0.12, p.z),
      enabled: () => !p.picked,
      hint: () => { const f = book()?.data().found[p.def.id]; return f ? `in your collection · ${f.n} found` : 'something new for your collection!'; },
      use: () => pick(p),
    };
  }

  function pick(p: Placed): void {
    if (p.picked) return;
    p.picked = true;
    p.pop = 1;
    const r = book()?.pick(p.spawn) ?? null;
    _v.set(p.x, p.y + 0.15, p.z);
    sfx('pop', _v, 0.8, 1.15);
    setTimeout(() => sfx('sparkle', undefined, r?.isNew ? 0.9 : 0.45), 90);
    sparkleBurst(p.x, p.y + 0.15, p.z, r?.isNew ? 10 : 6);
    say(findLine(r, p.def.name), 3800, `forage:${p.spawn.key}`);
  }

  function sparkleBurst(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const b = burst[burstAt++ % BURST];
      const a = (i / n) * Math.PI * 2 + Math.random();
      b.t = 0; b.x = x; b.y = y; b.z = z;
      b.vx = Math.cos(a) * (0.5 + Math.random() * 0.5); b.vz = Math.sin(a) * (0.5 + Math.random() * 0.5); b.vy = 1.1 + Math.random() * 0.9;
    }
  }

  // ---------------------------------------------------------------------------------------- fishing
  const WATER_ID = 'fishing:water';
  const fmat = forageMaterial();
  const rig = new THREE.Group();
  rig.name = 'forage:rig';
  const rod = new THREE.Mesh(rodGeometry(), fmat);
  rod.name = 'forage:rod';
  rod.position.set(0.3, -0.36, -0.42);
  rig.add(rod);
  const held = new THREE.Mesh(catchGeometry('minnow'), fmat);
  held.name = 'forage:held';
  held.position.set(0, -0.1, -0.8);
  rig.add(held);
  rig.visible = false;
  held.visible = false;
  root.add(rig);
  const bobber = new THREE.Mesh(bobberGeometry(), fmat);
  bobber.name = 'forage:bobber';
  bobber.scale.setScalar(1.6);
  bobber.visible = false;
  root.add(bobber);
  const ripMat = new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0, depthWrite: false });
  const ripple = new THREE.Mesh(rippleGeometry(), ripMat);
  ripple.name = 'forage:ripple';
  ripple.visible = false;
  root.add(ripple);
  const SEG = 18;
  const linePos = new Float32Array((SEG + 1) * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xfffaf0 }));
  line.name = 'forage:line';
  line.frustumCulled = false;
  line.visible = false;
  root.add(line);

  const st = {
    phase: 'idle' as Phase, t: 0, dur: 0, water: 'pond' as WaterKind,
    aimOk: false, aim: new THREE.Vector3(), target: new THREE.Vector3(), from: new THREE.Vector3(), stand: new THREE.Vector3(),
    bob: new THREE.Vector3(), tip: new THREE.Vector3(), chances: 0, nibbleAt: 0, nibble: 0, rip: 1,
    caught: '', cm: 0, heldScale: 1, swing: 0, seed: 1,
  };

  const waterAt = (x: number, z: number): WaterKind => (Math.hypot(x - POND.x, z - POND.z) < POND.r + 4 ? 'pond' : 'river');
  const nearWater = (x: number, z: number) => Math.min(distToPolyline(x, z, RIVER) - RIVER_HALF_WIDTH, Math.hypot(x - POND.x, z - POND.z) - POND.r) < 11;

  /** the pond frozen over (scene/seasons): no casting onto the ice */
  const pondFrozen = () => ((ctx.services.get('seasons') as { ice(): number } | undefined)?.ice() ?? 0) > 0.5;
  /** where the view ray meets open water within casting range (sets st.aim / st.aimOk) */
  function aimAtWater(): void {
    aimOpen();
    if (st.aimOk && waterAt(st.aim.x, st.aim.z) === 'pond' && pondFrozen()) st.aimOk = false;
  }
  function aimOpen(): void {
    st.aimOk = false;
    const p = ctx.player;
    if (p.frozen || !nearWater(p.pos.x, p.pos.z) || p.pos.y < WORLD.water + 0.05 && heightAt(p.pos.x, p.pos.z) < WORLD.water - 0.05) return;
    ctx.camera.getWorldDirection(_fwd);
    if (_fwd.y > -0.02) _fwd.y = -0.02; // looking at the horizon still casts a fair way out
    for (let d = 1.2; d <= 11; d += 0.25) {
      const x = p.eye.x + _fwd.x * d, y = p.eye.y + _fwd.y * d, z = p.eye.z + _fwd.z * d;
      const g = heightAt(x, z);
      if (y > Math.max(g, WORLD.water)) continue;
      if (g < WORLD.water - 0.2 && Math.hypot(x - p.pos.x, z - p.pos.z) > 1.6) { st.aim.set(x, WORLD.water, z); st.aimOk = true; }
      return;
    }
    // never reached the surface (looking out flat): cast to the furthest open water along the view
    for (let d = 9; d >= 2.5; d -= 0.5) {
      const x = p.eye.x + _fwd.x * d, z = p.eye.z + _fwd.z * d;
      if (heightAt(x, z) < WORLD.water - 0.2) { st.aim.set(x, WORLD.water, z); st.aimOk = true; return; }
    }
  }

  const waterI: Interactable = {
    id: WATER_ID, kind: 'prop', verb: 'Cast a line', reach: 11,
    label: () => (st.phase === 'idle' ? (waterAt(st.aim.x, st.aim.z) === 'pond' ? 'Pond' : 'River') : 'Bobber'),
    pos: (out) => out.copy(st.phase === 'idle' ? st.aim : st.bob),
    enabled: () => (st.phase === 'idle' ? st.aimOk : st.phase !== 'show'),
    hint: () => st.phase === 'idle' ? 'fish bite by season, hour and weather' : st.phase === 'bite' ? 'it\'s biting!' : 'wait for the bobber to dip, then E',
    use: () => press(),
  };
  const offWater = ctx.interact.add(waterI);

  // E while fishing even when the crosshair has wandered off the bobber (the HUD only passes it on when nothing is focused)
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || e.repeat || e.defaultPrevented || ctx.player.frozen || st.phase === 'idle') return;
    press();
  };
  addEventListener('keydown', onKey);

  // out in the rowboat (scene/seasons, service 'rowboat'), the middle of the pond is where the rarer fish are
  const rareBoost = () => (ctx.services.get('rowboat') as { fishBoost(x: number, z: number): number } | undefined)?.fishBoost(st.target.x, st.target.z) ?? 1;
  // the travelling merchant's glimmer lure (model/visitors.ts, service 'visitors'): the rarer fish bite more for the rest of the day
  const lureBoost = () => { try { return (ctx.services.get('visitors') as { fishBoost(day: string): number } | undefined)?.fishBoost(dayKey(Date.now())) ?? 1; } catch { return 1; } };
  const conditions = () => ({ season: ctx.valley.sky.season, hour: ctx.valley.sky.hour, weather: ctx.valley.sky.weather.kind, water: st.water, rareBoost: rareBoost() * lureBoost() });
  const r = rand(Date.now() >>> 0);

  function setPhase(ph: Phase, dur = 0): void { st.phase = ph; st.t = 0; st.dur = dur; waterI.verb = ph === 'idle' ? 'Cast a line' : ph === 'bite' ? 'Hook it!' : 'Reel in'; }

  function press(): void {
    switch (st.phase) {
      case 'idle': return cast();
      case 'cast': return;
      case 'wait': say(st.nibble > 0 ? 'Just a nibble… wait for it to go right under.' : 'Nothing yet. Wait for the bobber to dip.', 2200, WATER_ID); return;
      case 'bite': return hook();
      case 'reel': return;
      case 'show': return end();
    }
  }

  function cast(): void {
    if (!st.aimOk) return;
    st.water = waterAt(st.aim.x, st.aim.z);
    st.target.copy(st.aim);
    st.stand.copy(ctx.player.pos);
    st.chances = 2;
    rig.visible = true; rod.visible = true; held.visible = false; bobber.visible = true; line.visible = true;
    updateRig(0);
    st.from.copy(st.tip);
    st.bob.copy(st.from);
    setPhase('cast', 0.55);
    sfx('cast', undefined, 0.9);
  }

  function hook(): void {
    const f = rollFish(r, conditions());
    st.caught = f.id; st.cm = f.cm;
    setPhase('reel', 0.75);
    sfx('reel', undefined, 0.9);
  }

  function land(): void {
    const res = book()?.catch(st.caught, st.cm) ?? null;
    const def = collectDef(st.caught);
    held.geometry = catchGeometry(st.caught);
    const bb = held.geometry.boundingBox ?? (held.geometry.computeBoundingBox(), held.geometry.boundingBox!);
    const len = Math.max(0.05, bb.max.z - bb.min.z, bb.max.y - bb.min.y);
    st.heldScale = Math.min(2.4, Math.max(0.6, 0.42 / len));
    held.visible = true;
    bobber.visible = false; line.visible = false;
    setPhase('show', 2.6);
    sfx('splash', st.bob, 0.6, 1.3);
    setTimeout(() => sfx(res?.isNew ? 'chime-pass' : 'sparkle', undefined, res?.isNew ? 0.7 : 0.5), 150);
    say(catchLine(res, def?.name ?? 'something', st.cm), 4200, WATER_ID);
  }

  function end(): void {
    setPhase('idle');
    rig.visible = false; held.visible = false; bobber.visible = false; line.visible = false; ripple.visible = false;
  }

  function rippleAt(p: THREE.Vector3, big: boolean): void { ripple.position.set(p.x, WORLD.water + 0.02, p.z); st.rip = big ? -0.2 : 0; ripple.visible = true; }

  /** rod pose (in view) and its tip in world space */
  function updateRig(dt: number): void {
    rig.position.copy(ctx.camera.position);
    rig.quaternion.copy(ctx.camera.quaternion);
    const ph = st.phase, k = st.dur ? Math.min(1, st.t / st.dur) : 0;
    let tilt = 1.05, side = 0.16;
    if (ph === 'cast') tilt = k < 0.35 ? 1.05 - Math.sin((k / 0.35) * Math.PI * 0.5) * 0.9 : 0.15 + (k - 0.35) / 0.65 * 0.95;
    else if (ph === 'bite') tilt = 1.2 + Math.sin(st.t * 30) * 0.03;
    else if (ph === 'reel') tilt = 0.7 + Math.sin(st.t * 22) * 0.04;
    else if (ph === 'show') tilt = 0.6;
    st.swing += (tilt - st.swing) * Math.min(1, dt * 14 || 1);
    // the first-person paws (scene/viewmodel) hold the rod while they are shown: one rod, the line leaves its tip
    if ((ctx.services.get('hands') as HandsPort | undefined)?.rod(st.swing, st.tip)) { rod.visible = false; return; }
    rod.visible = true;
    _e.set(-st.swing, 0, side, 'YXZ');
    rod.quaternion.setFromEuler(_e);
    rig.updateMatrixWorld(true);
    st.tip.set(0, ROD_LEN, 0);
    rod.localToWorld(st.tip);
  }

  function updateFishing(dt: number, time: number): void {
    if (st.phase === 'idle') { aimAtWater(); return; }
    st.t += dt;
    const p = ctx.player;
    if (p.frozen || Math.hypot(p.pos.x - st.stand.x, p.pos.z - st.stand.z) > 1.6) { end(); return; }
    updateRig(dt);
    const wy = WORLD.water;
    switch (st.phase) {
      case 'cast': {
        const k = Math.min(1, st.t / st.dur);
        st.bob.lerpVectors(st.from, st.target, k);
        st.bob.y = st.from.y + (wy - st.from.y) * k + Math.sin(k * Math.PI) * 1.4;
        if (k >= 1) {
          st.bob.copy(st.target);
          rippleAt(st.bob, false);
          sfx('splash', st.bob, 0.25, 1.8);
          setPhase('wait', biteDelay(r, conditions()));
          st.nibbleAt = 0.9 + r() * 1.2; st.nibble = 0;
        }
        break;
      }
      case 'wait': {
        if (st.t > st.nibbleAt && st.t < st.dur - 0.8) {
          st.nibble = 0.3; st.nibbleAt = st.t + 1 + r() * 1.6;
          rippleAt(st.bob, false);
          sfx('plop', st.bob, 0.25, 1.6);
        }
        st.nibble = Math.max(0, st.nibble - dt);
        st.bob.set(st.target.x, wy + 0.01 + Math.sin(time * 2.4) * 0.012 - Math.sin((st.nibble / 0.3) * Math.PI) * 0.03, st.target.z);
        if (st.t >= st.dur) {
          setPhase('bite', 1.25);
          rippleAt(st.bob, true);
          sfx('bite', st.bob, 1);
        }
        break;
      }
      case 'bite': {
        const k = Math.min(1, st.t / 0.12);
        st.bob.set(st.target.x + Math.sin(st.t * 40) * 0.02, wy - 0.06 * k, st.target.z + Math.cos(st.t * 33) * 0.02);
        if (st.t >= st.dur) {
          st.chances--;
          if (st.chances > 0) {
            say('It got away… stay with it, there\'s another one about. Press E when it dips!', 2600, WATER_ID);
            setPhase('wait', 1.4 + r() * 1.6);
            st.nibbleAt = 99;
          } else { say('The fish have wised up to you. Cast again!', 2400, WATER_ID); end(); }
        }
        break;
      }
      case 'reel': {
        const k = Math.min(1, st.t / st.dur);
        st.bob.lerpVectors(st.target, st.tip, k * k);
        st.bob.y = Math.max(st.bob.y, wy) + Math.sin(k * Math.PI) * 0.25 * k;
        if (k >= 1) land();
        break;
      }
      case 'show': {
        const k = Math.min(1, st.t / 0.35);
        const pop = k < 1 ? Math.sin(k * Math.PI * 0.5) * (1 + 0.25 * Math.sin(k * Math.PI)) : 1;
        const out = st.t > st.dur - 0.3 ? Math.max(0, (st.dur - st.t) / 0.3) : 1;
        held.scale.setScalar(st.heldScale * pop * out);
        held.rotation.set(0.15, Math.PI / 2 + Math.sin(time * 1.3) * 0.25, Math.sin(time * 9) * 0.18 * (1 - k * 0.5));
        if (st.t >= st.dur) end();
        break;
      }
    }
    // line: rod tip to bobber, sagging while slack
    if (line.visible) {
      const sag = st.phase === 'wait' ? 0.35 : st.phase === 'cast' ? 0.1 : 0.03;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        linePos[i * 3] = st.tip.x + (st.bob.x - st.tip.x) * t;
        linePos[i * 3 + 1] = st.tip.y + (st.bob.y + 0.1 - st.tip.y) * t - Math.sin(t * Math.PI) * sag;
        linePos[i * 3 + 2] = st.tip.z + (st.bob.z - st.tip.z) * t;
      }
      (lineGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    bobber.position.copy(st.bob);
  }

  const debug: ForageDebug = {
    items: () => placed.map((p) => ({ key: p.spawn.key, id: p.def.id, name: p.def.name, x: p.x, y: p.y, z: p.z, habitat: p.habitat, picked: p.picked })),
    respawn: (d) => { pinned = d ?? null; spawnDay(d ?? dayKey(Date.now()), ctx.valley.sky.season); },
    cast: () => { if (st.phase !== 'idle') return true; aimAtWater(); cast(); return (st.phase as Phase) === 'cast'; },
    bite: () => { if (st.phase === 'wait') st.t = st.dur; },
    phase: () => st.phase,
    near(x, z, r, out) {
      let best: Placed | null = null, bd = r;
      for (const p of placed) {
        if (p.picked) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return false;
      out.key = best.spawn.key; out.name = best.def.name; out.x = best.x; out.y = best.y; out.z = best.z;
      return true;
    },
  };
  ctx.services.set('forage', debug);

  // ---------------------------------------------------------------------------------------- per frame
  let checkIn = 0;
  const camPos = new THREE.Vector3();
  return {
    name: 'forage',
    update(f) {
      checkIn -= f.dt;
      if (checkIn <= 0) {
        checkIn = 2;
        const d = pinned ?? dayKey(Date.now()), s = ctx.valley.sky.season;
        if (d !== day || s !== season) spawnDay(d, s);
      }
      ctx.camera.getWorldPosition(camPos);
      // popping items
      for (const p of placed) {
        if (p.pop <= 0) continue;
        p.pop = Math.max(0, p.pop - f.dt / 0.35);
        const k = 1 - p.pop;
        writeItem(p, p.pop > 0 ? (k < 0.4 ? 1 + k * 0.8 : 1.32 * (1 - (k - 0.4) / 0.6)) : 0);
        p.mesh.instanceMatrix.needsUpdate = true;
      }
      // glints: a short twinkle every few seconds above each unpicked item, facing the camera, sized to stay visible
      let gi = 0;
      for (const p of placed) {
        if (gi >= GLINTS) break;
        if (p.picked) { glint.setMatrixAt(gi++, ZERO); continue; }
        const ph = (f.time / 2.4 + p.phase) % 1;
        const tw = ph < 0.24 ? Math.sin((ph / 0.24) * Math.PI) : 0;
        const dist = Math.hypot(camPos.x - p.x, camPos.z - p.z);
        if (tw <= 0 || dist > 70) { glint.setMatrixAt(gi++, ZERO); continue; }
        _q.copy(ctx.camera.quaternion).multiply(_q2.setFromAxisAngle(Z, ph * 4));
        _s.setScalar((0.17 + dist * 0.015) * tw);
        _p.set(p.x, p.y + 0.3 * p.s + Math.min(0.25, dist * 0.01), p.z);
        glint.setMatrixAt(gi++, _m.compose(_p, _q, _s));
      }
      for (; gi < GLINTS; gi++) glint.setMatrixAt(gi, ZERO);
      for (let i = 0; i < BURST; i++) {
        const b = burst[i];
        if (b.t >= 1) { glint.setMatrixAt(GLINTS + i, ZERO); continue; }
        b.t = Math.min(1, b.t + f.dt / 0.7);
        b.vy -= 3.2 * f.dt;
        b.x += b.vx * f.dt; b.y += b.vy * f.dt; b.z += b.vz * f.dt;
        _q.copy(ctx.camera.quaternion);
        _s.setScalar(0.09 * Math.sin(b.t * Math.PI));
        _p.set(b.x, b.y, b.z);
        glint.setMatrixAt(GLINTS + i, _m.compose(_p, _q, _s));
      }
      glint.instanceMatrix.needsUpdate = true;
      updateFishing(f.dt, f.time);
      // ripple
      if (ripple.visible) {
        st.rip += f.dt / 1.1;
        const k = Math.max(0, st.rip);
        ripple.scale.setScalar(0.08 + k * (st.rip < 0 ? 0.5 : 0.35));
        ripMat.opacity = 0.55 * (1 - Math.min(1, k));
        if (st.rip >= 1) ripple.visible = false;
      }
    },
    stats: () => ({ forage: placed.length, left: placed.filter((p) => !p.picked).length, fishing: st.phase }),
    dispose() {
      ctx.services.delete('forage');
      clear();
      offWater();
      removeEventListener('keydown', onKey);
      ctx.scene.remove(root);
    },
  };
};

function findLine(r: FindResult | null, name: string): string {
  if (!r) return `${name}. Lovely.`;
  if (r.isNew) return `${name}! New for your collection. (K to look)`;
  return `${name} — that's ${r.n} now.`;
}
function catchLine(r: FindResult | null, name: string, cm: number): string {
  const size = cm ? `, ${cm} cm` : '';
  if (!r) return `You caught a ${name}${size}!`;
  const d = r.def;
  if (d.kind === 'fish' && d.junk) return r.isNew ? `${name}?! Well… it's going in the collection.` : `Another ${name.toLowerCase()}. The pond is generous.`;
  if (r.isNew) return `A ${name}${size}! New for your collection.${d.rare ? ' A rare one, too!' : ''}`;
  if (r.record) return `A whopping ${name}${size}: your biggest yet!`;
  return `A ${name}${size}. That's ${r.n} caught.`;
}

/** Dev access (service 'forage', `__valley.forage()`): what lies where today; cast / force a bite for shots and tests. */
export interface ForageDebug {
  items(): { key: string; id: string; name: string; x: number; y: number; z: number; habitat: string; picked: boolean }[];
  /** re-roll a day's batch (YYYY-MM-DD; default today) */
  respawn(day?: string): void;
  /** cast where the view meets water (false if it doesn't) */
  cast(): boolean;
  /** the fish bites right now (while waiting) */
  bite(): void;
  phase(): string;
  /** the nearest unpicked find within r metres of (x, z), written into `out` (no allocation; your pet's nose uses it) */
  near(x: number, z: number, r: number, out: { key: string; name: string; x: number; y: number; z: number }): boolean;
}
