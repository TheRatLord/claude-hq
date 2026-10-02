/**
 * The walk-in barn (a `RoomDef` for the interior system): a tall timber barn with a hay loft up a ladder, Daisy the
 * cow and Pepper the donkey in their stalls, two sheep in a pen, four hens on a roost over their nest boxes, a
 * workbench under the tool wall, swallows nesting in the rafters, Mochi napping on the bales — and the valley's
 * machine room: the barn carries the system-stats thermometer outside, and inside it brass dials for CPU, RAM, disk
 * and network, the thermometer's inside face and a chart recorder, all driven by the same gauges the landmarks show.
 *
 * Light: by day it comes in through the shutters left ajar and the gaps between the boards (bright slits that follow
 * the sky, dusty shafts along the real sun, motes); after dark the lanterns carry it (LightEmitters with flicker).
 * Rain drums loudly on the roof (`AudioService.indoors(1, { roof })`), and a drip finds the bucket by the door.
 *
 * Chores (model/barn.ts, service 'barn'): grab an armful of hay (E on the hay) and feed Daisy, Pepper and the sheep;
 * scoop grain for the hens; milk Daisy once she has eaten; take the curry brush off the tool wall for Pepper; collect
 * the eggs. Eggs and milk go into the basket (sellable); every animal fed in a day inks the "Barn chores" stamp.
 * E on the dial board opens the system stats.
 */
import * as THREE from 'three';
import type { Interactable, LightEmitter } from '../context.ts';
import type { Season } from '../../model/types.ts';
import type { WalletService } from '../../model/wallet.ts';
import { createBarn } from '../../model/barn.ts';
import type { BarnAnimal, BarnService } from '../../model/barn.ts';
import { localJson } from '../../storage.ts';
import { LAMP_LIGHT, setGlass, setGlow } from '../structures/kit.ts';
import { levelsFrom, newLevels } from '../structures/rig.ts';
import { buildBeams } from './view.ts';
import type { BeamOpening } from './view.ts';
import { LANTERNS, SWALLOW_NESTS, buildBarnRoom, buildDaylight } from './barnRoom.ts';
import { SLATE, buildCarried, buildMotes, buildProps, buildStable, buildSwallows, buildWorks, netLevel } from './barnPieces.ts';
import type { Beast, BeastId, Carry } from './barnPieces.ts';
import { B, BARN_DOOR_OUT, BARN_ENTRY, BARN_EXIT, BARN_PET, BARN_ROOM, BARN_VIEWS, LOFT, OPENINGS, barnFloor, barnPushOut, inBarn } from './barnLayout.ts';
import { disposeTree } from './house.ts';
import type { RoomBuilt, RoomDef, RoomHost } from './space.ts';
import { PetBody, petInput } from '../life/petBody.ts';

export const BARN_KEY = 'claude-valley.barn.v1';
const F = BARN_ROOM.floor;

/** the chores (persisted), shared by the room and the stamp book; created on first use */
let chores: BarnService | null = null;
export function barnChores(): BarnService {
  if (!chores) chores = createBarn(localJson(BARN_KEY));
  return chores;
}

export const barnRoom: RoomDef = {
  id: 'barn',
  site: 'barn',
  entry: BARN_ENTRY,
  exit: BARN_EXIT,
  views: BARN_VIEWS,
  floor: (lx, lz, ly) => barnFloor(lx, lz, ly),
  contains: (lx, lz, r) => inBarn(lx, lz, r),
  pushOut: (l, r, ly) => barnPushOut(l, r, ly),
  pet: { ...BARN_PET, y: F },
  roof: 1.9,
  door: { at: BARN_DOOR_OUT, label: 'Barn', hint: 'the animals, the hay loft, the machine room' },
  init: (ctx) => { ctx.services.set('barn', barnChores()); return () => { if (ctx.services.get('barn') === chores) ctx.services.delete('barn'); }; },
  build: buildBarn,
};

/** sheep / hens answer as a group; the cow and the donkey by name */
const GROUP_OF: Readonly<Record<BeastId, BarnAnimal>> = { cow: 'cow', donkey: 'donkey', sheep0: 'sheep', sheep1: 'sheep', hen0: 'hens', hen1: 'hens', hen2: 'hens', hen3: 'hens' };

const BENCH_LINES = [
  'You sharpen the hoe. Someone has carved "tests first" into the bench.',
  'A half-mended harness, a jar of mismatched screws and a very old keyboard with no Q.',
  'You oil the hinges on the hen house door. Henrietta supervises.',
  'A horseshoe on the vise, mid-shoe. Pepper pretends not to have noticed.',
];

function buildBarn(host: RoomHost, season: Season): RoomBuilt {
  const { ctx, frame } = host;
  const vec = frame.vec, P = frame.P;
  const audio = host.audio;
  const wallet = () => ctx.services.get('wallet') as WalletService | undefined;
  const barn = barnChores();

  const root = new THREE.Group();
  root.name = 'interior:barn';
  const room = buildBarnRoom({ season });
  let glowMat: THREE.MeshBasicMaterial | null = null;
  for (const m of [...room.children] as THREE.Mesh[]) {
    root.add(m);
    if (m.userData.emitters) glowMat = m.material as THREE.MeshBasicMaterial;
    // the shell keeps the sun out (its shadow); everything else only receives
    m.castShadow = !m.userData.emitters;
    m.receiveShadow = !m.userData.emitters;
  }
  const glow = glowMat ?? new THREE.MeshBasicMaterial();
  setGlass(glow, 0.38, 0.55);   // smoky amber glass (bright outdoor glass reads white in the room)
  const daylight = buildDaylight();
  const openings: BeamOpening[] = OPENINGS.map((o) => ({
    o: o.wall === 'front' ? [o.at, o.y, BARN_ROOM.z1 + 0.05] as const : o.wall === 'east' ? [BARN_ROOM.x1 + 0.05, o.y, o.at] as const : [BARN_ROOM.x0 - 0.05, o.y, o.at] as const,
    r: o.wall === 'front' ? [o.w * 0.5, 0, 0] as const : [0, 0, o.wall === 'east' ? -o.w * 0.5 : o.w * 0.5] as const,
    u: [0, o.h * 0.92, 0] as const,
    group: o.wall === 'east' ? 0 : o.wall === 'west' ? 1 : 2,
  }));
  // the open half of each shutter only (the other leaf is shut): shift each beam to the open side
  openings.forEach((op, i) => {
    const o = OPENINGS[i], sh = o.w * 0.25;
    if (o.wall === 'front') op.o = [o.at - sh, op.o[1], op.o[2]];
    else op.o = [op.o[0], op.o[1], o.at + (o.wall === 'east' ? -sh : sh)];
  });
  const beams = buildBeams(openings, 2.4);
  const stable = buildStable(season);
  const props = buildProps();
  const works = buildWorks();
  const swallows = buildSwallows();
  const motes = buildMotes();
  const carried = buildCarried();
  root.add(daylight.mesh, beams.mesh, swallows.mesh, motes.mesh, ...stable.meshes, ...props.meshes, ...works.meshes);
  // Mochi on her bales (she visits: most nights, some afternoons)
  const cat = new PetBody('cat');
  cat.root.position.set(B.bales.x + 0.05, F + 1.1, B.bales.z - 0.05);
  cat.root.rotation.y = 0.9;
  cat.mesh.castShadow = false;
  cat.root.traverse((o) => { o.frustumCulled = false; });
  root.add(cat.root);
  const catIn = petInput('loaf');

  // lights (world): the hanging lanterns after dark, the bench lantern and the panel's banker's lamp always (dim by day)
  // lit by day too (a barn is dim inside), brighter at night
  const lanterns: LightEmitter[] = LANTERNS.map((l, i) => ({ pos: P(l.x, l.y, l.z), color: LAMP_LIGHT.clone(), intensity: i === 4 ? 0.5 : 0.62, radius: i < 2 ? 5.2 : 4.0, flicker: 0.22, when: 'always' }));
  const lanternI = lanterns.map((e) => e.intensity);
  const benchLight: LightEmitter = { pos: P(BARN_ROOM.x0 + 0.35, F + 1.1, B.bench.z - 0.75), color: new THREE.Color(1.0, 0.5, 0.18), intensity: 0.5, radius: 3.4, flicker: 0.35, when: 'always' };
  const panelLight: LightEmitter = { pos: P(B.panel.x - 0.75, F + 1.15, B.panel.z - 0.05), color: new THREE.Color(1.0, 0.72, 0.4), intensity: 0.4, radius: 2.6, flicker: 0.03, when: 'always' };

  // ---- carrying (hay, grain, the brush): one thing at a time
  let carry: Carry | null = null;
  const hold = (c: Carry | null) => { carry = c; carried.set(c); };

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const say = (t: string, ms?: number) => host.say(t, ms);
  const night = () => ctx.lighting.night > 0.5;
  const hour = () => ctx.valley.sky.hour;
  const sleepy = () => { const h = hour(); return h >= 20.75 || h < 5.5; };
  const raining = () => { const k = ctx.valley.sky.weather.kind; return k === 'rain' || k === 'storm'; };
  const catHere = () => { const h = hour(); const day = Math.floor((ctx.valley.sky.dayOfYear ?? 0)); return h >= 19 || h < 7.5 || ((day * 7) % 10 < 6 && h >= 12.5); };

  const heartsAt = (b: Beast, n = 3) => { stable.headAt(b, tmp); props.hearts(tmp.x, tmp.y + 0.25, tmp.z, n); };
  const sound = (b: Beast, vol = 0.55) => {
    stable.headAt(b, tmp);
    root.localToWorld(tmp2.copy(tmp));
    const k = b.sp.key;
    if (k === 'cow') audio()?.play('moo', { pos: tmp2, volume: vol });
    else if (k === 'sheep') audio()?.play('baa', { pos: tmp2, volume: vol, pitch: b.id === 'sheep1' ? 0.85 : 1.05 });
    else if (k === 'hen') audio()?.play('cluck', { pos: tmp2, volume: vol * 0.8, pitch: 0.95 + b.seed * 0.2 });
    else { audio()?.play('moo', { pos: tmp2, volume: vol * 0.8, pitch: 1.55 }); setTimeout(() => audio()?.play('moo', { pos: tmp2, volume: vol * 0.7, pitch: 1.2 }), 380); }
  };
  const group = (g: BarnAnimal) => stable.beasts.filter((b) => b.group === g);

  function feedAnimal(g: BarnAnimal, who: string): void {
    const r = barn.feed(g, carry === 'brush' ? null : carry);
    if (!r.ok) {
      if (r.reason === 'fed') say(`${who} ${g === 'sheep' || g === 'hens' ? 'have' : 'has'} had ${g === 'hens' ? 'their grain' : 'hay'} today. Full and happy.`);
      else say(g === 'hens' ? 'The hens want grain: scoop some from the bin by the pen.' : 'An armful of hay from the pile at the back would do it.');
      return;
    }
    hold(null);
    for (const b of group(g)) { b.eatT = g === 'hens' ? 24 : 14; b.happyT = 2; heartsAt(b, g === 'hens' || g === 'sheep' ? 2 : 3); }
    sound(group(g)[0], 0.7);
    audio()?.play('pet', { volume: 0.4 });
    say(g === 'cow' ? 'Daisy tucks into the hay with a happy rumble. 🌾' : g === 'donkey' ? 'Pepper crunches the hay, ears going round like windmills. 🌾'
      : g === 'sheep' ? 'Cotton and Sooty bury their noses in the rack. 🐑' : 'Grain everywhere! The hens descend like a very small storm. 🐔');
    if (r.allDone) setTimeout(() => { audio()?.play('chime-done', { volume: 0.6 }); say('Barn chores done for today: every animal fed. The whole barn sighs happily. ✨', 5000); }, 1400);
  }
  function petAnimal(b: Beast): void {
    b.happyT = 2.4;
    heartsAt(b, 2);
    audio()?.play('pet', { volume: 0.5 });
    sound(b, 0.45);
    const lines: Record<string, string[]> = {
      cow: ['Daisy leans her big warm head into your hand.', 'Daisy blows a hay-scented sigh at you. High praise.'],
      donkey: ['Pepper nudges your pocket, hopeful.', 'Pepper\'s ears swivel round to listen. He approves of you.'],
      sheep: ['So soft. Your hand disappears into the fleece.', 'Sooty stamps a little hoof: more scratches, please.'],
      hen: ['The hen fluffs up and makes a pleased little trill.', 'She tilts her head, studies you with one eye, decides you are acceptable.'],
    };
    const ls = lines[b.sp.key];
    say(ls[Math.floor(Math.random() * ls.length)]);
  }

  // ---- interactables (registered while inside)
  const I = (id: string, verb: string | (() => string), label: () => string, at: [number, number, number], use: () => void, o: Partial<Interactable> = {}): Interactable => {
    const it: Interactable = { id: `interior:barn:${id}`, kind: 'prop', verb: '', label, pos: vec(at[0], at[1], at[2]), reach: 2.8, use, ...o };
    if (typeof verb === 'function') Object.defineProperty(it, 'verb', { get: verb, enumerable: true });
    else it.verb = verb;
    return it;
  };
  const carrying = () => (carry === 'hay' ? 'an armful of hay' : carry === 'grain' ? 'a scoop of grain' : carry === 'brush' ? 'the curry brush' : '');
  const cowHead = () => { const b = stable.get('cow'); stable.headAt(b, tmp); return [tmp.x, tmp.y, tmp.z] as [number, number, number]; };
  function interactables(): Interactable[] {
    const ch = cowHead();
    const dh = (() => { stable.headAt(stable.get('donkey'), tmp); return [tmp.x, tmp.y, tmp.z] as [number, number, number]; })();
    return [
      I('door', 'Go outside', () => 'Big door', [-0.6, F + 1.5, BARN_ROOM.z1 - 0.15], () => { audio()?.play('creak', { volume: 0.7, pitch: 0.8 }); host.leave(); }, { hint: () => 'back out to the yard', reach: 3.2 }),
      I('hay', () => (carry === 'hay' ? 'Put back' : 'Grab'), () => (carry === 'hay' ? 'the hay' : 'An armful of hay'), [B.hay.x, F + 0.7, B.hay.z + 0.35], () => {
        audio()?.play('hoe', { volume: 0.35, pitch: 1.4 });
        if (carry === 'hay') { hold(null); return; }
        hold('hay');
        say('An armful of sweet hay. Daisy, Pepper and the sheep are all watching you now.', 2600);
      }, { hint: () => 'for the cow, the donkey and the sheep', reach: 3.0 }),
      I('grain', () => (carry === 'grain' ? 'Put back' : 'Scoop'), () => 'Grain bin', [B.grain.x, F + 0.85, B.grain.z], () => {
        audio()?.play('pop', { volume: 0.35 });
        if (carry === 'grain') { hold(null); return; }
        hold('grain');
        say('A scoop of grain. Somewhere in the coop, four heads swivel at once.', 2600);
      }, { hint: () => 'for the hens' }),
      I('brush', () => (carry === 'brush' ? 'Hang up' : 'Take'), () => 'Curry brush', [BARN_ROOM.x0 + 0.1, F + 1.85, B.bench.z + 0.95], () => {
        audio()?.play('ui-click', { volume: 0.4 });
        hold(carry === 'brush' ? null : 'brush');
        if (carry) say('The curry brush. Pepper knows exactly what that means.', 2400);
      }, { hint: () => (barn.data().brushed ? 'Pepper has been brushed today' : 'Pepper loves a good brush'), reach: 3.0 }),
      I('cow', () => (carry === 'hay' && !barn.fed('cow') ? 'Feed' : !carry && barn.fed('cow') && !barn.data().milked ? 'Milk' : 'Pet'), () => 'Daisy', ch, () => {
        const b = stable.get('cow');
        if (carry === 'hay' || carry === 'grain') { feedAnimal('cow', 'Daisy'); return; }
        if (!carry && barn.fed('cow') && !barn.data().milked) {
          if (barn.milk() === 'ok') {
            wallet()?.stash('milk', 1);
            b.happyT = 3; heartsAt(b, 3);
            audio()?.play('water-pour', { volume: 0.5 });
            say('Swish, swish… a frothy pail of milk. Into the basket it goes. 🥛', 3200);
          }
          return;
        }
        petAnimal(b);
      }, { hint: () => (barn.fed('cow') ? (barn.data().milked ? 'fed and milked today' : 'fed: ready to milk') : carry === 'hay' ? 'she\'s hungry' : 'hungry: bring her hay'), reach: 3.0 }),
      I('donkey', () => (carry === 'hay' && !barn.fed('donkey') ? 'Feed' : carry === 'brush' ? 'Brush' : 'Pet'), () => 'Pepper', dh, () => {
        const b = stable.get('donkey');
        if (carry === 'brush') {
          const first = barn.brush();
          b.happyT = 4; heartsAt(b, 4);
          audio()?.play('purr', { volume: 0.35, pitch: 0.6 });
          say(first ? 'Long strokes down his neck. Pepper\'s eyes go half shut and his lip wobbles with joy.' : 'Pepper is already gleaming, but he won\'t say no to more.', 3600);
          return;
        }
        if (carry === 'hay' || carry === 'grain') { feedAnimal('donkey', 'Pepper'); return; }
        petAnimal(b);
      }, { hint: () => (barn.fed('donkey') ? 'fed today' : 'hungry: bring him hay'), reach: 3.0 }),
      I('sheep', () => (carry === 'hay' && !barn.fed('sheep') ? 'Feed' : 'Pet'), () => 'Cotton & Sooty', [B.pen.x0 + 0.5, F + 0.9, -0.1], () => {
        if (carry === 'hay' || carry === 'grain') { feedAnimal('sheep', 'The sheep'); return; }
        const b = stable.get(Math.random() < 0.5 ? 'sheep0' : 'sheep1');
        petAnimal(b);
      }, { hint: () => (barn.fed('sheep') ? 'fed today' : 'hungry: bring them hay'), reach: 3.2 }),
      I('hens', () => (carry === 'grain' && !barn.fed('hens') ? 'Feed' : 'Watch'), () => 'The hens', [B.coop.x0 + 0.4, F + 0.8, -2.6], () => {
        if (carry === 'grain' || carry === 'hay') { feedAnimal('hens', 'The hens'); return; }
        const b = stable.get(`hen${Math.floor(Math.random() * 4)}` as BeastId);
        b.happyT = 1.5; sound(b, 0.6);
        say(sleepy() ? 'Four hens in a row on the roost, fluffed up like dumplings. Shh.' : 'Scratch, scratch, peck. A very serious business, being a hen.');
      }, { hint: () => (barn.fed('hens') ? 'fed today' : 'hungry: bring them grain'), reach: 3.2 }),
      I('nests', () => (barn.eggsWaiting() ? 'Collect' : 'Check'), () => { const n = barn.eggsWaiting(); return n ? `${n} egg${n === 1 ? '' : 's'}` : 'Nest boxes'; }, [B.nestX - 0.3, F + B.nestY + 0.25, -2.95], () => {
        const n = barn.collectEggs();
        if (n) { wallet()?.stash('egg', n); audio()?.play('sparkle', { volume: 0.4 }); say(`${n} warm egg${n === 1 ? '' : 's'} into the basket. 🥚 The hens pretend not to have noticed.`, 3200); }
        else say(barn.fed('hens') ? 'Empty for now. Fed hens lay more tomorrow.' : 'Nothing today but straw. Hens lay better when they\'re fed.');
      }, { hint: () => 'eggs go into your basket (sell them to Bram)', reach: 3.6 }),
      I('panel', 'Read', () => 'Machine room', [B.panel.x - 0.4, F + 1.85, BARN_ROOM.z1 - 0.1], () => { audio()?.play('ui-click'); ctx.ui.stats(); },
        { hint: () => { const g = ctx.valley.gauges; return g ? `CPU ${Math.round(g.cpu * 100)}% · RAM ${g.memUsedGB.toFixed(1)}/${g.memTotalGB.toFixed(0)} GB · disk ${Math.round(g.disk * 100)}%` : 'the valley\'s system stats'; }, reach: 3.0 }),
      I('thermo', 'Read', () => 'Barn thermometer', [B.thermo.x + 0.45, F + 2.0, BARN_ROOM.z1 - 0.1], () => { audio()?.play('ui-click'); ctx.ui.stats(); },
        { hint: () => { const t = ctx.valley.gauges?.tempC; return t == null ? 'no sensor on this machine' : `${Math.round(t)} °C, the hottest sensor`; }, reach: 3.0 }),
      I('slate', 'Read', () => 'Chores slate', [SLATE.x, F + SLATE.y, BARN_ROOM.z1 - 0.12], () => {
        const d = barn.data(), left = (['cow', 'donkey', 'sheep', 'hens'] as const).filter((a) => !d.fed.includes(a));
        say(left.length ? `Still to feed: ${left.map((a) => (a === 'cow' ? 'Daisy' : a === 'donkey' ? 'Pepper' : `the ${a}`)).join(', ')}.` : `All fed today. ${d.total.days} chore day${d.total.days === 1 ? '' : 's'} so far.`);
      }),
      I('bench', 'Tinker at', () => 'Workbench', [BARN_ROOM.x0 + 0.45, F + 1.0, B.bench.z], () => { audio()?.play('hammer', { volume: 0.5 }); say(BENCH_LINES[Math.floor(Math.random() * BENCH_LINES.length)]); }),
      I('mochi', 'Pet', () => 'Mochi', [B.bales.x + 0.05, F + 1.3, B.bales.z - 0.05], () => {
        catPet = 3; audio()?.play('purr', { volume: 0.6 }); props.hearts(B.bales.x, F + 1.65, B.bales.z, 2);
        say(sleepy() ? 'Mochi stretches one paw, purrs, and goes straight back to sleep on the warm hay.' : 'Mochi slow-blinks at you. The barn is her office; you may visit.');
      }, { enabled: () => catHere() }),
      I('loft', 'Flop into', () => 'Hay pile', [B.loftPile.x, LOFT.y + 0.5, B.loftPile.z], () => { audio()?.play('hoe', { volume: 0.4, pitch: 0.8 }); say(raining() ? 'Fwump. Warm hay, rain drumming on the roof. You could stay up here all day.' : 'Fwump. Hay in your hair, swallows overhead. Perfect.'); }, { reach: 3.2 }),
      I('swallows', 'Watch', () => 'Swallows\' nests', [SWALLOW_NESTS[0].x, SWALLOW_NESTS[0].y, SWALLOW_NESTS[0].z], () => say(sleepy() ? 'Three tiny heads poke over the rim of the nest, then tuck back down.' : 'They stitch loops under the roof, in and out of the hay door, never once bumping into anything.'), { reach: 5.5 }),
    ];
  }
  let catPet = 0;

  const sunLocal = new THREE.Vector3(), beamColor = new THREE.Color(), winK = [0, 0, 0, 0], sky = new THREE.Color();
  const lv = newLevels();
  const lp = { x: 0, z: 0 };
  const env = { t: 0, dt: 0, sleepy: false, px: 0, py: 0, pz: 0, data: null as ReturnType<BarnService['data']> | null };
  let dripT = 0, soundT = 6, lastHour = -1;
  const drip = P(1.95, F + 0.9, BARN_ROOM.z1 - 0.55);

  return {
    root,
    extras: [carried.mesh],
    emitters: [...lanterns, benchLight, panelLight],
    interactables,
    entered() {
      hold(null);
      // a fresh look: everyone settles into place for the time of day
      env.data = barn.data();
      lastHour = -1;
    },
    left() { hold(null); },
    update(f) {
      const t = f.time, dt = f.dt, L = ctx.lighting;
      const day = Math.max(0, Math.min(1, 1 - L.night * 1.15));
      // ---- the animals
      frame.toLocal(ctx.player.pos.x, ctx.player.pos.z, lp);
      env.t = t; env.dt = dt; env.sleepy = sleepy(); env.px = lp.x; env.pz = lp.z; env.py = ctx.player.eye.y - frame.y; env.data = barn.data();
      stable.update(env);
      props.update(t, dt, env.data, barn.eggsWaiting());
      // now and then somebody speaks up (quietly at night)
      soundT -= dt;
      if (soundT <= 0) {
        soundT = 9 + Math.random() * 16;
        const b = stable.beasts[Math.floor(Math.random() * stable.beasts.length)];
        if (!env.sleepy || Math.random() < 0.25) sound(b, env.sleepy ? 0.2 : 0.35);
      }
      // ---- Mochi
      cat.root.visible = catHere();
      if (cat.root.visible) {
        catPet = Math.max(0, catPet - dt);
        catIn.pose = env.sleepy && catPet <= 0 ? 'curl' : Math.sin(t * 0.05) > 0.6 ? 'groom' : 'loaf';
        catIn.happy = catPet > 0 ? 1 : 0;
        catIn.slowBlink = catPet > 2.5;
        const dx = lp.x - cat.root.position.x, dz = lp.z - cat.root.position.z;
        catIn.lookYaw = Math.hypot(dx, dz) < 4 && catIn.pose !== 'curl' ? Math.max(-1, Math.min(1, Math.atan2(dx, dz) - cat.root.rotation.y)) : 0;
        cat.animate(dt, t, catIn);
      }
      // ---- the machine room
      levelsFrom(ctx.valley.gauges, lv);
      const g = ctx.valley.gauges;
      works.update(t, dt, lv, g ? netLevel(g.netRx, g.netTx) : 0, lv.host, g?.cpuHistory ?? null, env.data, barn.eggsWaiting(), L.night);
      // ---- light: the sky through the gaps, sun shafts along the real sun, motes, lanterns
      sky.copy(L.skyColor).lerp(L.sunColor, 0.25);
      daylight.update(sky, day);
      setGlow(glow, 0.7 + 0.3 * L.night);
      lanterns.forEach((e, i) => { e.intensity = lanternI[i] * (0.4 + 0.6 * L.night); });
      sunLocal.copy(L.sunDir).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -frame.yaw);
      const strength = Math.min(1, L.sunIntensity / 2.6) * (sunLocal.y > 0.03 ? 1 : 0) * day;
      winK[0] = strength * Math.min(1, Math.max(0, (sunLocal.x - 0.05) / 0.35));
      winK[1] = strength * Math.min(1, Math.max(0, (-sunLocal.x - 0.05) / 0.35));
      winK[2] = strength * Math.min(1, Math.max(0, (sunLocal.z - 0.05) / 0.35));
      beamColor.copy(L.sunColor).multiplyScalar(0.3);
      beams.update(t, sunLocal, winK, beamColor);
      motes.update(t, day * (0.25 + 0.75 * strength) * 0.8);
      swallows.update(t, dt, !env.sleepy);
      const lamp = Math.max(0.15, L.night);
      benchLight.intensity = 0.25 + 0.3 * lamp;
      panelLight.intensity = 0.2 + 0.25 * lamp;
      // ---- rain: a drip finds the bucket by the door
      if (raining()) {
        dripT -= dt;
        if (dripT <= 0) { dripT = 0.9 + Math.random() * 1.4; audio()?.play('plop', { pos: drip, volume: 0.18, pitch: 1.3 + Math.random() * 0.3 }); }
      }
      // ---- what you carry, in front of the camera
      carried.place(ctx.camera, t, Math.min(1, ctx.player.speed / 4));
      if (Math.floor(hour()) !== lastHour) lastHour = Math.floor(hour());
    },
    dispose() {
      stable.dispose(); props.dispose(); works.dispose(); swallows.dispose(); motes.dispose(); carried.dispose();
      disposeTree(root);
    },
    stats: () => ({ eggs: barn.eggsWaiting(), fed: barn.data().fed.length, carry: carry ? 1 : 0 }),
  };
}
