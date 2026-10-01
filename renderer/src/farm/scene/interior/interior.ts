/**
 * The walk-in farmhouse (system 'interior', service 'indoors'): the player's home and the valley's cozy heart.
 *
 * E on the farmhouse door → a short fade → you stand inside the ground floor; E on the inside door → back out on the
 * porch. The room is built in place, inside the farmhouse's shell (scene/interior/room.ts, farmhouse-local frame), and
 * only exists in the scene while you are in it: outside it costs nothing but this system's idle check.
 *
 * While inside:
 *  - the controller walks the room's floor and furniture (IndoorSpace.floor / resolve) and the engine offers only the
 *    room's interactables (`owns`: ids 'interior:*'), so nothing outside is in reach through the walls;
 *  - the outdoor scene is hidden (every top-level scene object without lights in it, re-checked each frame) so the
 *    room renders in a few dozen draw calls; outdoor systems keep running (state, sounds, events);
 *  - the windows show the real valley: view.ts captures it from just outside the panes into small HDR targets and
 *    projects it back through the openings with depth, so post grades, outlines and hazes it like the real thing;
 *    the sun (or moon) shines in through the openings for real (the room's walls cast the shadows) with dusty beams;
 *  - the hearth fire (always lit) and, after dark or in gloomy weather, the lamps and candles are LightEmitters; the
 *    sky dims its open-air fill (sky.ts reads the service), the audio muffles the valley and drums rain on the roof.
 *
 * Things to do: read the Almanac (desk), open the terminals list (the CRT), browse the Collections shelf (every find
 * on a shelf; real fish swim in the tank; the biggest catch is mounted over the fire), stoke the fire, nap in the bed,
 * check the grandfather clock (the valley's clock), fluff Mochi's bed, look out of the window.
 */
import * as THREE from 'three';
import type { AudioService, IndoorSpace, Interactable, LightEmitter, LightsService, SceneCtx, SystemFactory } from '../context.ts';
import type { CollectionService } from '../../model/collection.ts';
import { CATALOG } from '../../model/collection.ts';
import { structure } from '../../world/map.ts';
import { setGlow } from '../structures/kit.ts';
import { LAMP_LIGHT } from '../structures/kit.ts';
import { buildRoom } from './room.ts';
import { buildFinds, buildFire, buildPaper, buildPendulum, buildScreen, buildTank } from './pieces.ts';
import type { Finds, Fire, Paper, Screen, Tank } from './pieces.ts';
import { buildBeams, buildGlass, createCaptures, disposeCaptures, renderCapture, setFallback } from './view.ts';
import type { Beams, Capture, Glass } from './view.ts';
import { DOOR, ENTRY, EXIT, FURN, INSIDE_VIEWS, ROOM, SHELF_IDS, TANK_IDS, WINDOWS, biggestCatch, clockText, onFloor, pushOut } from './layout.ts';

interface Controllerish { teleport(x: number, z: number, yaw?: number, pitch?: number): void }

const F = ROOM.floor;
const FADE_OUT = 0.32, FADE_IN = 0.45;

const BOOK_LINES = [
  'You pull out "Refactoring for Farmers". Someone has underlined every mention of tests.',
  '"The Joy of Green Builds", well thumbed. A pressed violet marks chapter three.',
  '"A Field Guide to Valley Mushrooms". Fern\'s handwriting fills the margins: "NOT this one".',
  '"Merge Conflicts and How to Love Them". The spine has never been cracked.',
  '"Weather Lore" by Nimbus. Every page says it will be fair tomorrow.',
  'A dog-eared cookbook falls open at "Bram\'s Shipping-Day Stew".',
];

export const interiorSystem: SystemFactory = (ctx: SceneCtx) => {
  const fh = structure('farmhouse');
  const cos = Math.cos(fh.yaw), sin = Math.sin(fh.yaw);
  const toWorld = (lx: number, lz: number) => ({ x: fh.x + lx * cos + lz * sin, z: fh.z - lx * sin + lz * cos });
  const toLocal = (x: number, z: number) => { const dx = x - fh.x, dz = z - fh.z; return { x: dx * cos - dz * sin, z: dx * sin + dz * cos }; };
  const vec = (lx: number, ly: number, lz: number) => (out: THREE.Vector3) => { const w = toWorld(lx, lz); return out.set(w.x, fh.y + ly, w.z); };
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const lights = () => ctx.services.get('lights') as LightsService | undefined;
  const controller = () => ctx.services.get('controller') as Controllerish | undefined;
  const collection = () => ctx.services.get('collection') as CollectionService | undefined;

  // ---- built lazily on the first visit, kept afterwards (only in the scene while inside)
  interface Built {
    holder: THREE.Group; root: THREE.Group; glowMat: THREE.MeshBasicMaterial;
    fire: Fire; pendulum: THREE.Mesh; paper: Paper; screen: Screen; finds: Finds; tank: Tank; glass: Glass; beams: Beams;
    caps: Capture[]; emitters: LightEmitter[]; lamps: LightEmitter[];
  }
  let built: Built | null = null;
  let season = ctx.valley.sky.season;
  function build(): Built {
    const holder = new THREE.Group();
    holder.name = 'interior';
    const root = new THREE.Group();
    root.name = 'interior:room';
    root.position.set(fh.x, fh.y, fh.z);
    root.rotation.y = fh.yaw;
    holder.add(root);
    const room = buildRoom({ season });
    let glowMat: THREE.MeshBasicMaterial | null = null;
    for (const m of [...room.children] as THREE.Mesh[]) {
      root.add(m);
      if (m.userData.emitters) glowMat = m.material as THREE.MeshBasicMaterial;
      m.castShadow = !m.userData.emitters;
      m.receiveShadow = !m.userData.emitters;
    }
    const fire = buildFire(), pendulum = buildPendulum(), paper = buildPaper(), screen = buildScreen(), finds = buildFinds(), tank = buildTank(), glass = buildGlass(), beams = buildBeams();
    root.add(fire.mesh, pendulum, paper.mesh, screen.mesh, finds.mesh, tank.fish, tank.glass, glass.mesh, beams.mesh);
    holder.updateMatrixWorld(true);
    const caps = createCaptures(root);
    for (const c of caps) holder.add(c.backdrop);
    // lights (world space): the fire always; the lamps fade in after dark and in gloomy weather
    const P = (lx: number, ly: number, lz: number) => vec(lx, ly, lz)(new THREE.Vector3());
    const fireLight: LightEmitter = { pos: P(FURN.hearth.x - 0.45, F + 0.55, FURN.hearth.z), color: new THREE.Color(1.0, 0.42, 0.13), intensity: 0.6, radius: 6.5, flicker: 0.85, when: 'always' };
    const crtLight: LightEmitter = { pos: P(FURN.crtDesk.x + 0.35, F + 1.05, FURN.crtDesk.z + 0.12), color: new THREE.Color(0.35, 1.0, 0.5), intensity: 0.22, radius: 2.2, flicker: 0.05, when: 'always' };
    const lamps: LightEmitter[] = [
      { pos: P(FURN.table.x, ROOM.ceil - 1.12, FURN.table.z), color: LAMP_LIGHT.clone(), intensity: 0.6, radius: 4.6, flicker: 0.18 },
      { pos: P(FURN.sideTable.x - 0.08, F + 1.0, FURN.sideTable.z), color: LAMP_LIGHT.clone(), intensity: 0.45, radius: 3.0, flicker: 0.04 },
      { pos: P(FURN.almanacDesk.x + 0.4, F + 1.1, FURN.almanacDesk.z - 0.12), color: LAMP_LIGHT.clone(), intensity: 0.42, radius: 2.8, flicker: 0.04 },
      { pos: P(FURN.nightstand.x - 0.06, F + 0.75, FURN.nightstand.z - 0.08), color: LAMP_LIGHT.clone(), intensity: 0.35, radius: 2.4, flicker: 0.5 },
    ];
    return { holder, root, glowMat: glowMat ?? new THREE.MeshBasicMaterial(), fire, pendulum, paper, screen, finds, tank, glass, beams, caps, emitters: [fireLight, crtLight, ...lamps], lamps };
  }
  function disposeBuilt(b: Built): void {
    disposeCaptures(b.caps);
    b.holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
    });
  }

  // ---- the fade (a black card in front of the camera; scene code never touches the DOM)
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0x050302, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
  const fadeCard = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), fadeMat);
  fadeCard.name = 'interior:fade';
  fadeCard.renderOrder = 1e6;
  fadeCard.frustumCulled = false;
  let fade = 0, fadeTo = 0, hold = 0, onBlack: (() => void) | null = null, lastReal = performance.now();
  const fadeThen = (fn: () => void, holdS = 0) => { if (onBlack) return; fadeTo = 1; hold = holdS; onBlack = fn; };

  // ---- state
  let active = false;
  const offs: (() => void)[] = [];
  const hidden = new Set<THREE.Object3D>();
  const lit = new WeakMap<THREE.Object3D, boolean>();
  const hasLight = (o: THREE.Object3D): boolean => {
    let v = lit.get(o);
    if (v === undefined) { v = false; o.traverse((c) => { if ((c as THREE.Light).isLight) v = true; }); lit.set(o, v); }
    return v;
  };
  const keep = (o: THREE.Object3D) => o === built?.holder || o === fadeCard || (o as THREE.Light).isLight || hasLight(o);
  function hideOutdoors(): void { for (const o of ctx.scene.children) if (o.visible && !keep(o)) { o.visible = false; hidden.add(o); } }
  function showOutdoors(): void { for (const o of hidden) o.visible = true; hidden.clear(); }

  let fireLoop: { setVolume(v: number): void; stop(): void } | null = null;
  let since = 0, recapAt = 0, lastCapture = -1e9, capIdx = 0, stokeT = 0, tickAt = 0, tock = false;

  function goIn(): void {
    if (active) return;
    if (!built || season !== ctx.valley.sky.season) { if (built) disposeBuilt(built); season = ctx.valley.sky.season; built = build(); }
    const b = built;
    active = true;
    ctx.scene.add(b.holder);
    const L = lights();
    if (L) for (const e of b.emitters) offs.push(L.add(e));
    for (const i of interactables()) offs.push(ctx.interact.add(i));
    const at = toWorld(ENTRY.x, ENTRY.z);
    controller()?.teleport(at.x, at.z, ENTRY.yaw + fh.yaw, ENTRY.pitch);
    hideOutdoors();
    for (const c of b.caps) { c.at = -1e9; c.ok = false; (c.backdrop.material as THREE.ShaderMaterial).uniforms.uOk.value = 0; }
    setFallback(b.caps, ctx.lighting.skyColor);
    captureAll();
    recapAt = since + 2.5; // once more when the valley has settled (farmers placed after a cold start)
    audio()?.indoors?.(1);
    fireLoop = audio()?.loop('fire', vec(FURN.hearth.x - 0.3, F + 0.4, FURN.hearth.z)(new THREE.Vector3())) ?? null;
    fireLoop?.setVolume(0.8);
  }
  function goOut(teleport: boolean): void {
    if (!active) return;
    active = false;
    for (const f of offs.splice(0)) f();
    if (built) ctx.scene.remove(built.holder);
    showOutdoors();
    fireLoop?.stop(); fireLoop = null;
    audio()?.indoors?.(0);
    if (teleport) { const at = toWorld(EXIT.x, EXIT.z); controller()?.teleport(at.x, at.z, EXIT.yaw + fh.yaw, EXIT.pitch); }
  }

  /** render the outdoor views (the world shown, the room hidden for the render) */
  function capture(c: Capture): void {
    if (!built) return;
    showOutdoors();
    built.root.visible = false;
    for (const x of built.caps) x.backdrop.visible = false;
    try { renderCapture(ctx.renderer, ctx.scene, c); } catch (e) { console.error('[interior] capture', e); }
    built.root.visible = true;
    for (const x of built.caps) x.backdrop.visible = true;
    hideOutdoors();
    c.at = since; c.night = ctx.lighting.night; c.wet = ctx.lighting.wet; c.sun.copy(ctx.lighting.sunDir);
    lastCapture = since;
  }
  function captureAll(): void { if (built) for (const c of built.caps) capture(c); }

  // ---- interactables (registered while inside)
  const I = (id: string, verb: string, label: () => string, at: [number, number, number], use: () => void, o: Partial<Interactable> = {}): Interactable =>
    ({ id: `interior:${id}`, kind: 'prop', verb, label, pos: vec(at[0], at[1], at[2]), reach: 2.8, use, ...o });
  const say = (t: string, ms?: number) => ctx.ui.say(t, ms);
  const col = () => collection()?.data() ?? null;
  const night = () => ctx.lighting.night > 0.5;
  function interactables(): Interactable[] {
    const A = FURN;
    return [
      I('door', 'Go outside', () => 'Front door', [DOOR.x, F + 1.2, ROOM.z1 - 0.1], () => { audio()?.play('creak', { volume: 0.6 }); space.leave(); }, { hint: () => 'back out to the porch' }),
      I('almanac', 'Read', () => 'The Valley Almanac', [A.almanacDesk.x - 0.1, F + 0.85, A.almanacDesk.z - 0.02], () => { audio()?.play('page'); ctx.ui.almanac(); },
        { hint: () => { const a = ctx.valley.almanac; return a ? `${a.name} · ${a.points.toLocaleString('en-US')} prosperity` : 'prosperity, ranks, town upgrades'; } }),
      I('crt', 'Use', () => 'Terminal', [A.crtDesk.x + 0.1, F + 1.05, A.crtDesk.z + 0.12], () => { audio()?.play('ui-click'); if (ctx.ui.roster) ctx.ui.roster(); else ctx.ui.map(); },
        { hint: () => { const n = ctx.valley.farmers.size, need = [...ctx.valley.farmers.values()].filter((f) => f.needsYou).length; return `every terminal, one click away · ${n} farmer${n === 1 ? '' : 's'}${need ? ` · ${need} need${need === 1 ? 's' : ''} you` : ''}`; } }),
      I('shelf', 'Browse', () => { const c = col(); const n = c ? SHELF_IDS.filter((id) => c.found[id]).length : 0; return `Collections shelf (${n}/${SHELF_IDS.length})`; }, [A.shelf.x, F + 1.3, A.shelf.z + 0.3],
        () => { audio()?.play('page'); if (ctx.ui.collection) ctx.ui.collection(); else ctx.ui.almanac(); },
        { hint: () => { const c = col(); const n = c ? Object.keys(c.found).length : 0; return `opens the Collections book · ${n}/${CATALOG.length} found`; }, reach: 3.2 }),
      I('trophy', 'Admire', () => 'Biggest catch', [FURN.hearth.x - 0.4, F + 1.9, FURN.hearth.z], () => {
        const best = biggestCatch(col()?.found ?? {});
        const def = best ? CATALOG.find((d) => d.id === best.id) : null;
        say(best && def ? `${def.name}, ${best.cm} cm. You tell everyone it was bigger. 🎣` : 'An empty plaque. Your biggest catch goes here: the dock is that way.');
      }, { reach: 3.4 }),
      I('tank', 'Watch', () => 'Fish tank', [A.tank.x, F + 1.0, A.tank.z + 0.2], () => {
        const c = col(); const n = c ? TANK_IDS.filter((id) => c.found[id]).length : 0;
        audio()?.play('plop', { volume: 0.4 });
        say(n ? `${n} kind${n === 1 ? '' : 's'} of fish doing slow laps. Very calming. 🐟` : 'Just gravel and a little castle so far. Catch something and it will swim here.');
      }),
      I('hearth', 'Stoke', () => 'Hearth', [FURN.hearth.x - 0.4, F + 0.5, FURN.hearth.z], () => {
        stokeT = 1.6; audio()?.play('pop', { volume: 0.7 }); audio()?.play('sparkle', { volume: 0.3 });
        say(ctx.valley.sky.weather.kind === 'rain' || ctx.valley.sky.weather.kind === 'storm' ? 'A new log, a shower of sparks. Let it pour out there. 🔥' : night() ? 'You poke the fire. It settles into a warm orange purr. 🔥' : 'The fire crackles happily. Toasty toes.');
      }, { reach: 3.2 }),
      I('bed', 'Nap in', () => 'Bed', [A.bed.x + 0.4, F + 0.6, A.bed.z], () => nap(), { hint: () => (night() ? 'sleep until… well, a while' : 'a short nap under the quilt') }),
      I('armchair', 'Sit in', () => 'Armchair', [A.armchair.x, F + 0.7, A.armchair.z], () => say(night() ? 'You sink into the armchair. The fire pops. Somewhere a farmer is still compiling.' : 'Deep, soft and slightly lumpy in the right places. Perfect.')),
      I('clock', 'Check', () => 'Grandfather clock', [A.clock.x, F + 1.85, A.clock.z + 0.2], () => say(`It's ${clockText(ctx.valley.sky.hour)}. Tick… tock… the valley keeps good time.`)),
      I('catbed', 'Fluff', () => "Mochi's bed", [A.catBed.x, F + 0.2, A.catBed.z], () => { audio()?.play('purr', { volume: 0.4 }); say('Still warm. Mochi is out on the porch, supervising.'); }),
      I('bookshelf', 'Browse', () => 'Bookshelf', [A.bookshelf.x + 0.2, F + 1.3, A.bookshelf.z], () => { audio()?.play('page'); say(BOOK_LINES[Math.floor(Math.random() * BOOK_LINES.length)]); }),
      I('window', 'Look out of', () => 'Window', [WINDOWS[1].at, WINDOWS[1].y, ROOM.z1], () => say(windowLine())),
    ];
  }
  function windowLine(): string {
    const w = ctx.valley.sky.weather.kind;
    if (w === 'storm') return 'Lightning over the ridge. Good night to be indoors.';
    if (w === 'rain') return 'Rain drums on the porch roof and runs down the glass.';
    if (w === 'snow') return 'Snow drifting past the window, soft as flour.';
    if (w === 'fog') return 'Fog has swallowed the square. Just the lamps glowing through it.';
    return night() ? 'The square\'s lamps are lit. A few windows still glow out there.' : 'Sunshine on the square. The farmers are out in the fields.';
  }
  function nap(): void {
    audio()?.play('ui-close', { volume: 0.4 });
    fadeThen(() => {
      const h = ctx.valley.sky.hour;
      setTimeout(() => say(h >= 21 || h < 5 ? 'You doze off under the quilt… the fire has burned low. The valley is still asleep.'
        : h < 12 ? 'A short morning nap. You wake to birdsong and someone\'s tests passing.' : 'Forty winks. You wake up rested; the farmers kept things ticking.', 6000), 1800);
    }, 1.6);
  }

  // ---- the service
  const space: IndoorSpace = {
    get active() { return active; },
    floor(x, z) { const l = toLocal(x, z); return onFloor(l.x, l.z, 0.3) ? fh.y + F : null; },
    resolve(p, r) {
      const l = toLocal(p.x, p.z);
      if (!pushOut(l, r)) return;
      const w = toWorld(l.x, l.z);
      p.x = w.x; p.z = w.z;
    },
    owns: (i) => i.id.startsWith('interior:'),
    enter(instant) { if (active) return; if (instant) goIn(); else { audio()?.play('creak', { volume: 0.6 }); fadeThen(goIn); } },
    leave(instant) { if (!active) return; if (instant) goOut(true); else fadeThen(() => goOut(true)); },
    view(name) {
      const v = INSIDE_VIEWS[name];
      if (!v) return false;
      if (!active) goIn();
      const at = toWorld(v.x, v.z), t = toWorld(v.tx, v.tz);
      const dx = t.x - at.x, dz = t.z - at.z;
      controller()?.teleport(at.x, at.z, Math.atan2(-dx, -dz), Math.atan2(v.ty - (F + 1.62), Math.hypot(dx, dz)));
      return true;
    },
  };
  ctx.services.set('indoors', space);

  const sunLocal = new THREE.Vector3(), beamColor = new THREE.Color(), winK = [0, 0, 0];
  const camDir = new THREE.Vector3();
  const tickPos = new THREE.Vector3();

  return {
    name: 'interior',
    update(f) {
      // ---- fade (real time: works with the animation clock frozen for shots)
      const now = performance.now(), rdt = Math.min(0.1, (now - lastReal) / 1000);
      lastReal = now;
      if (fadeTo === 1) {
        fade = Math.min(1, fade + rdt / FADE_OUT);
        if (fade >= 1) {
          if (onBlack) { const fn = onBlack; onBlack = null; try { fn(); } catch (e) { console.error('[interior]', e); } }
          hold -= rdt;
          if (hold <= 0) fadeTo = 0;
        }
      } else fade = Math.max(0, fade - rdt / FADE_IN);
      if (fade > 0) {
        if (!fadeCard.parent) ctx.scene.add(fadeCard);
        ctx.camera.getWorldDirection(camDir);
        fadeCard.position.copy(ctx.camera.position).addScaledVector(camDir, 0.12);
        fadeCard.quaternion.copy(ctx.camera.quaternion);
        fadeMat.opacity = fade * fade * (3 - 2 * fade);
      } else if (fadeCard.parent) ctx.scene.remove(fadeCard);

      if (!active || !built) return;
      const b = built;
      since += f.dt > 0 ? f.dt : rdt;
      // walked (or was carried: map travel, dev teleports) out of the room: back to the valley as it is
      const lp = toLocal(ctx.player.pos.x, ctx.player.pos.z);
      if (!onFloor(lp.x, lp.z, -0.4) && fadeTo === 0) { goOut(false); return; }
      if (ctx.valley.sky.season !== season) { goOut(false); goIn(); return; }
      hideOutdoors();

      const L = ctx.lighting;
      // ---- the window views: refresh one per frame when the light or the weather moved on, or every two minutes
      if (since - lastCapture > 1.5) {
        const c = b.caps[capIdx % b.caps.length];
        capIdx++;
        const stale = !c.ok || since - c.at > 120 || Math.abs(L.night - c.night) > 0.05 || Math.abs(L.wet - c.wet) > 0.15 || c.sun.angleTo(L.sunDir) > 0.08 || (recapAt > 0 && since > recapAt);
        if (stale) capture(c);
        if (recapAt > 0 && since > recapAt && capIdx % b.caps.length === 0) recapAt = 0;
      }

      // ---- live pieces
      const t = f.time;
      stokeT = Math.max(0, stokeT - f.dt);
      b.fire.update(t, 1 + stokeT * 0.5);
      // the fire is a glow by day and the room's heart after dark
      b.emitters[0].intensity = (0.42 + 0.55 * L.night) * (1 + stokeT * 0.25);
      b.pendulum.rotation.z = Math.sin(t * Math.PI) * 0.09;
      b.paper.update(ctx.valley.sky.hour, ctx.valley, col());
      b.screen.update(t, ctx.valley);
      const cs = collection();
      b.finds.update(cs?.data() ?? null, cs?.version ?? 0);
      b.tank.update(t, cs?.data() ?? null, cs?.version ?? 0);
      b.glass.update(t, L.wet, L.night);
      setGlow(b.glowMat, Math.max(L.night, 0.15));
      // sun (or moon) through each opening: how squarely it shines in, and how strong it is
      sunLocal.copy(L.sunDir).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -fh.yaw);
      const strength = Math.min(1, L.sunIntensity / 2.6) * (sunLocal.y > 0.03 ? 1 : 0);
      WINDOWS.forEach((w, i) => {
        const facing = w.wall === 'front' ? sunLocal.z : sunLocal.x;
        winK[i] = strength * Math.min(1, Math.max(0, (facing - 0.05) / 0.35));
      });
      beamColor.copy(L.sunColor).multiplyScalar(0.11 * (1 - L.night * 0.6));
      b.beams.update(t, sunLocal, winK, beamColor);
      // grandfather clock: a soft tick-tock when you are near
      if (t > tickAt) {
        tickAt = t + 1;
        vec(FURN.clock.x, F + 1.2, FURN.clock.z)(tickPos);
        if (tickPos.distanceTo(ctx.player.pos) < 4.5) { tock = !tock; audio()?.play('ui-click', { pos: tickPos, volume: 0.07, pitch: tock ? 0.42 : 0.5 }); }
      }
      fireLoop?.setVolume(0.75 + stokeT * 0.3);
    },
    stats: () => ({ inside: active ? 1 : 0, built: built ? 1 : 0, hidden: hidden.size }),
    dispose() {
      goOut(false);
      if (built) disposeBuilt(built);
      ctx.scene.remove(fadeCard);
      if (ctx.services.get('indoors') === space) ctx.services.delete('indoors');
    },
  };
};
