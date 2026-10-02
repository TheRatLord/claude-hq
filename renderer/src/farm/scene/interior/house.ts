/**
 * The farmhouse room (a `RoomDef` for the interior system): the player's home and the valley's cozy heart.
 *
 * Built in place inside the farmhouse's shell (room.ts, farmhouse-local frame). The windows show the real valley:
 * view.ts captures it from just outside the panes into small HDR targets and projects it back through the openings
 * with depth, so post grades, outlines and hazes it like the real thing; the sun (or moon) shines in through the
 * openings for real (the room's walls cast the shadows) with dusty beams. The hearth fire (always lit) and, after
 * dark or in gloomy weather, the lamps and candles are LightEmitters.
 *
 * Things to do: read the Almanac (desk), open the terminals list (the CRT), browse the Collections shelf (every find
 * on a shelf; real fish swim in the tank; the biggest catch is mounted over the fire), stoke the fire, nap in the bed,
 * check the grandfather clock (the valley's clock), fluff Mochi's bed, look out of the window.
 */
import * as THREE from 'three';
import type { Interactable, LightEmitter } from '../context.ts';
import type { Season } from '../../model/types.ts';
import type { CollectionService } from '../../model/collection.ts';
import { CATALOG } from '../../model/collection.ts';
import { setGlass, setGlow, LAMP_LIGHT } from '../structures/kit.ts';
import { buildRoom } from './room.ts';
import { buildFinds, buildFire, buildPaper, buildPendulum, buildScreen, buildTank } from './pieces.ts';
import { buildBeams, buildGlass, createCaptures, disposeCaptures, houseOpenings, renderCapture, setFallback } from './view.ts';
import type { Capture } from './view.ts';
import { DOOR, ENTRY, EXIT, FURN, INSIDE_VIEWS, ROOM, SHELF_IDS, TANK_IDS, WINDOWS, biggestCatch, clockText, onFloor, pushOut } from './layout.ts';
import type { RoomBuilt, RoomDef, RoomHost } from './space.ts';

const F = ROOM.floor;

const BOOK_LINES = [
  'You pull out "Refactoring for Farmers". Someone has underlined every mention of tests.',
  '"The Joy of Green Builds", well thumbed. A pressed violet marks chapter three.',
  '"A Field Guide to Valley Mushrooms". Fern\'s handwriting fills the margins: "NOT this one".',
  '"Merge Conflicts and How to Love Them". The spine has never been cracked.',
  '"Weather Lore" by Nimbus. Every page says it will be fair tomorrow.',
  'A dog-eared cookbook falls open at "Bram\'s Shipping-Day Stew".',
];

export const houseRoom: RoomDef = {
  id: 'farmhouse',
  site: 'farmhouse',
  entry: ENTRY,
  exit: EXIT,
  views: INSIDE_VIEWS,
  floor: (lx, lz) => (onFloor(lx, lz, 0.3) ? F : null),
  contains: (lx, lz, r) => onFloor(lx, lz, r),
  pushOut: (l, r) => pushOut(l, r),
  // the hearth rug, fireside of the armchair, in view of the room
  pet: { x: FURN.rug.x + 0.55, z: FURN.rug.z + 0.7, yaw: Math.atan2(-0.6, 0.8), y: F },
  build: buildHouse,
};

function buildHouse(host: RoomHost, season: Season): RoomBuilt {
  const { ctx, frame } = host;
  const vec = frame.vec, P = frame.P;
  const audio = host.audio;
  const collection = () => ctx.services.get('collection') as CollectionService | undefined;

  const root = new THREE.Group();
  root.name = 'interior:room';
  const room = buildRoom({ season });
  let glowMat: THREE.MeshBasicMaterial | null = null;
  for (const m of [...room.children] as THREE.Mesh[]) {
    root.add(m);
    if (m.userData.emitters) glowMat = m.material as THREE.MeshBasicMaterial;
    m.castShadow = !m.userData.emitters;
    m.receiveShadow = !m.userData.emitters;
  }
  const glow = glowMat ?? new THREE.MeshBasicMaterial();
  setGlass(glow, 0.38, 0.55);   // smoky amber glass by day (bright outdoor glass reads white in the room)
  const fire = buildFire(), pendulum = buildPendulum(), paper = buildPaper(), screen = buildScreen(), finds = buildFinds(), tank = buildTank(), glass = buildGlass(), beams = buildBeams(houseOpenings());
  root.add(fire.mesh, pendulum, paper.mesh, screen.mesh, finds.mesh, tank.fish, tank.glass, glass.mesh, beams.mesh);
  // the window captures are placed in the world from the room's frame
  const placed = new THREE.Group();
  placed.position.set(frame.x, frame.y, frame.z);
  placed.rotation.y = frame.yaw;
  placed.updateMatrixWorld(true);
  const caps = createCaptures(placed);

  // lights (world space): the fire always; the lamps fade in after dark and in gloomy weather
  const fireLight: LightEmitter = { pos: P(FURN.hearth.x - 0.45, F + 0.55, FURN.hearth.z), color: new THREE.Color(1.0, 0.42, 0.13), intensity: 0.6, radius: 6.5, flicker: 0.85, when: 'always' };
  const crtLight: LightEmitter = { pos: P(FURN.crtDesk.x + 0.35, F + 1.05, FURN.crtDesk.z + 0.12), color: new THREE.Color(0.35, 1.0, 0.5), intensity: 0.22, radius: 2.2, flicker: 0.05, when: 'always' };
  const lamps: LightEmitter[] = [
    { pos: P(FURN.table.x, ROOM.ceil - 1.12, FURN.table.z), color: LAMP_LIGHT.clone(), intensity: 0.6, radius: 4.6, flicker: 0.18 },
    { pos: P(FURN.sideTable.x - 0.08, F + 1.0, FURN.sideTable.z), color: LAMP_LIGHT.clone(), intensity: 0.45, radius: 3.0, flicker: 0.04 },
    { pos: P(FURN.almanacDesk.x + 0.4, F + 1.1, FURN.almanacDesk.z - 0.12), color: LAMP_LIGHT.clone(), intensity: 0.42, radius: 2.8, flicker: 0.04 },
    { pos: P(FURN.nightstand.x - 0.06, F + 0.75, FURN.nightstand.z - 0.08), color: LAMP_LIGHT.clone(), intensity: 0.35, radius: 2.4, flicker: 0.5 },
  ];

  let fireLoop: { setVolume(v: number): void; stop(): void } | null = null;
  let recapAt = 0, lastCapture = -1e9, capIdx = 0, stokeT = 0, tickAt = 0, tock = false;

  /** render the outdoor views (the world shown, the room hidden for the render) */
  function capture(c: Capture): void {
    host.withOutdoors(() => {
      for (const x of caps) x.backdrop.visible = false;
      try { renderCapture(ctx.renderer, ctx.scene, c); } catch (e) { console.error('[interior] capture', e); }
      for (const x of caps) x.backdrop.visible = true;
    });
    c.at = host.since(); c.night = ctx.lighting.night; c.wet = ctx.lighting.wet; c.sun.copy(ctx.lighting.sunDir);
    lastCapture = host.since();
  }

  // ---- interactables (registered while inside)
  const I = (id: string, verb: string, label: () => string, at: [number, number, number], use: () => void, o: Partial<Interactable> = {}): Interactable =>
    ({ id: `interior:${id}`, kind: 'prop', verb, label, pos: vec(at[0], at[1], at[2]), reach: 2.8, use, ...o });
  const say = (t: string, ms?: number) => host.say(t, ms);
  const col = () => collection()?.data() ?? null;
  const night = () => ctx.lighting.night > 0.5;
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
    host.fadeThen(() => {
      const h = ctx.valley.sky.hour;
      setTimeout(() => say(h >= 21 || h < 5 ? 'You doze off under the quilt… the fire has burned low. The valley is still asleep.'
        : h < 12 ? 'A short morning nap. You wake to birdsong and someone\'s tests passing.' : 'Forty winks. You wake up rested; the farmers kept things ticking.', 6000), 1800);
    }, 1.6);
  }
  function interactables(): Interactable[] {
    const A = FURN;
    return [
      I('door', 'Go outside', () => 'Front door', [DOOR.x, F + 1.2, ROOM.z1 - 0.1], () => { audio()?.play('creak', { volume: 0.6 }); host.leave(); }, { hint: () => 'back out to the porch' }),
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

  const sunLocal = new THREE.Vector3(), beamColor = new THREE.Color(), winK = [0, 0, 0];
  const tickPos = new THREE.Vector3();
  const hearthAt = P(FURN.hearth.x - 0.3, F + 0.4, FURN.hearth.z);

  return {
    root,
    extras: caps.map((c) => c.backdrop),
    emitters: [fireLight, crtLight, ...lamps],
    interactables,
    entered() {
      for (const c of caps) { c.at = -1e9; c.ok = false; (c.backdrop.material as THREE.ShaderMaterial).uniforms.uOk.value = 0; }
      setFallback(caps, ctx.lighting.skyColor);
      for (const c of caps) capture(c);
      recapAt = host.since() + 2.5; // once more when the valley has settled (farmers placed after a cold start)
      fireLoop = audio()?.loop('fire', hearthAt) ?? null;
      fireLoop?.setVolume(0.8);
    },
    left() { fireLoop?.stop(); fireLoop = null; },
    update(f) {
      const since = host.since();
      const L = ctx.lighting;
      // ---- the window views: refresh one per frame when the light or the weather moved on, or every two minutes
      if (since - lastCapture > 1.5) {
        const c = caps[capIdx % caps.length];
        capIdx++;
        const stale = !c.ok || since - c.at > 120 || Math.abs(L.night - c.night) > 0.05 || Math.abs(L.wet - c.wet) > 0.15 || c.sun.angleTo(L.sunDir) > 0.08 || (recapAt > 0 && since > recapAt);
        if (stale) capture(c);
        if (recapAt > 0 && since > recapAt && capIdx % caps.length === 0) recapAt = 0;
      }
      // ---- live pieces
      const t = f.time;
      stokeT = Math.max(0, stokeT - f.dt);
      fire.update(t, 1 + stokeT * 0.5);
      // the fire is a glow by day and the room's heart after dark
      fireLight.intensity = (0.42 + 0.55 * L.night) * (1 + stokeT * 0.25);
      pendulum.rotation.z = Math.sin(t * Math.PI) * 0.09;
      paper.update(ctx.valley.sky.hour, ctx.valley, col());
      screen.update(t, ctx.valley);
      const cs = collection();
      finds.update(cs?.data() ?? null, cs?.version ?? 0);
      tank.update(t, cs?.data() ?? null, cs?.version ?? 0);
      glass.update(t, L.wet, L.night);
      setGlow(glow, Math.max(L.night, 0.15));
      // sun (or moon) through each opening: how squarely it shines in, and how strong it is
      sunLocal.copy(L.sunDir).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -frame.yaw);
      const strength = Math.min(1, L.sunIntensity / 2.6) * (sunLocal.y > 0.03 ? 1 : 0);
      WINDOWS.forEach((w, i) => {
        const facing = w.wall === 'front' ? sunLocal.z : sunLocal.x;
        winK[i] = strength * Math.min(1, Math.max(0, (facing - 0.05) / 0.35));
      });
      beamColor.copy(L.sunColor).multiplyScalar(0.11 * (1 - L.night * 0.6));
      beams.update(t, sunLocal, winK, beamColor);
      // grandfather clock: a soft tick-tock when you are near
      if (t > tickAt) {
        tickAt = t + 1;
        vec(FURN.clock.x, F + 1.2, FURN.clock.z)(tickPos);
        if (tickPos.distanceTo(ctx.player.pos) < 4.5) { tock = !tock; audio()?.play('ui-click', { pos: tickPos, volume: 0.07, pitch: tock ? 0.42 : 0.5 }); }
      }
      fireLoop?.setVolume(0.75 + stokeT * 0.3);
    },
    dispose() {
      fireLoop?.stop(); fireLoop = null;
      disposeCaptures(caps);
      disposeTree(root);
    },
  };
}

/** dispose every mesh's geometry and canvas map under a group */
export function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mat = m.material as THREE.MeshBasicMaterial;
    if (mat.map) mat.map.dispose();
  });
}
