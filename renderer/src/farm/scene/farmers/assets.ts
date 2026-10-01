/**
 * Asset registrations for the farmers package. The gallery drives the mascots through the same rig, pose loops,
 * springs and gaits the valley uses, so every loop can be inspected, turned, scrubbed and flipbooked:
 *
 *   clawd / codex        variant = a gait ('walk' 'jog' 'hop' 'haul' 'stroll'), a job (its loop) or any single act
 *   mascot-cast          every kind × tier side by side, playing the variant
 *   mascot-faces         every expression on both mascots (blinking)
 *   mascot-props         the held props, each in the loop that uses it
 *   duckling             variant = 'waddle' 'hurry' 'sit' 'peep' 'hatch' 'home'
 *   farmer-emotes        the emote atlas
 */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { Crowd } from './rig.ts';
import type { DrawIn, DrawOut } from './rig.ts';
import { lookFor } from './look.ts';
import type { Look } from './look.ts';
import { ACTS, ACT_INFO, CH, FACES, PROPS, actPose, cycleLength, faceGlyphs, gait, holdOf, newGlyphs, newPose, newSprings, springSnap, springStep } from './pose.ts';
import type { Act, Face, GaitState, Prop, Springs } from './pose.ts';
import { propOf } from './brain.ts';
import { EMOTE } from './atlas.ts';
import { Ducks, HATCH } from './ducks.ts';
import type { Duck } from './ducks.ts';
import { newTrail } from './trail.ts';
import { Billboards } from './fx.ts';
import { WORKSPACE_COLORS, PAL } from '../toon.ts';
import { JOBS } from '../../model/types.ts';
import type { FarmerView, Job } from '../../model/types.ts';

/** What each job looks like in the gallery (the main act of its loop). */
export const JOB_ACT: Readonly<Record<Job, Act>> = {
  plant: 'plant', inspect: 'inspect', water: 'water', build: 'hammer', haul: 'carry', fetch: 'read', plan: 'plan', talk: 'talk',
  delegate: 'delegate', rest: 'stretch', ask: 'ask', done: 'done', idle: 'campfire', away: 'nap',
};
const GAITS = ['walk', 'jog', 'hop', 'haul', 'stroll'] as const;
export const GALLERY_VARIANTS: readonly string[] = [...GAITS, ...JOBS, ...ACTS.filter((a) => !Object.values(JOB_ACT).includes(a))];

interface Doll {
  look: Look; act: Act; walk: 'walk' | 'jog' | 'haul' | 'stroll' | null; face: Face | null; x: number; z: number; yaw: number; k: number;
  spr: Springs; tgt: Float32Array; out: Float32Array; g: GaitState; glyphs: ReturnType<typeof newGlyphs>; prop: Prop | null; t0: number;
  top0: THREE.Vector3; hat: { x: number; z: number; v: number; w: number };
}

/** A little stage of mascots driven by the real rig + pose loops (gallery only). */
export class Puppets {
  readonly crowd: Crowd;
  readonly dolls: Doll[] = [];
  private din: DrawIn = {
    look: null as unknown as Look, at: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 }, pose: newPose(), gait: null as unknown as GaitState, glyphs: newGlyphs(),
    prop: null, hold: 'R', propScale: 1, produce: PAL.apple, hatLag: { x: 0, z: 0, y: 0 }, propLag: { x: 0, z: 0 }, shear: { x: 0, z: 0 }, wobble: 0, wobblePhase: 0,
  };
  private dout: DrawOut = { head: new THREE.Vector3(), hand: new THREE.Vector3(), eyes: new THREE.Vector3() };
  constructor(n: number) { this.crowd = new Crowd(Math.max(1, n), true); }

  add(look: Look, variant: string, x: number, z: number, yaw = 0, face: Face | null = null): Doll {
    const k = this.dolls.length * 0.137;
    let act: Act = 'stand', walk: Doll['walk'] = null;
    if (variant === 'walk' || variant === 'jog' || variant === 'stroll') walk = variant;
    else if (variant === 'hop') { if (look.body === 'codex') walk = 'walk'; else act = 'ask'; }
    else if (variant === 'haul') { walk = 'haul'; act = 'carry'; }
    else if ((JOBS as readonly string[]).includes(variant)) act = JOB_ACT[variant as Job];
    else if ((ACTS as readonly string[]).includes(variant)) act = variant as Act;
    const d: Doll = {
      look, act, walk, face, x, z, yaw, k, spr: newSprings(), tgt: newPose(), out: newPose(), glyphs: newGlyphs(),
      g: { cyc: k, w: walk ? 1 : 0, jog: walk === 'jog' ? 1 : 0, turn: 0, speed: 0, heavy: walk === 'haul', bounce: look.bounce },
      prop: propOf(act), t0: 0, top0: new THREE.Vector3(1e9, 0, 0), hat: { x: 0, z: 0, v: 0, w: 0 },
    };
    if (walk === 'stroll') d.x += 1.3;
    actPose(act, 0, k, look.tempo / 1.9, d.tgt, 0, look.body);
    springSnap(d.spr, d.tgt);
    this.dolls.push(d);
    return d;
  }

  tick(t: number, dt: number): void {
    if (!Number.isFinite(t)) t = performance.now() / 1000; // tolerate a gallery clock that is not running yet
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.05);
    this.crowd.begin();
    for (const d of this.dolls) {
      const walking = !!d.walk;
      const speed = d.walk === 'jog' ? 3.0 : d.walk === 'haul' ? 1.1 : walking ? 1.4 : 0;
      d.g.speed = speed;
      d.g.cyc += (speed * dt) / cycleLength(d.look.body, d.g.jog, d.g.heavy);
      let yaw = d.yaw;
      if (d.walk === 'stroll') {
        // walk a circle for real: turning lean, feet planted on the ground
        const r = 1.3, a = t * speed / r;
        d.x = Math.cos(a) * r; d.z = -Math.sin(a) * r; yaw = Math.atan2(-Math.sin(a), -Math.cos(a));
        d.g.turn = speed / r;
      }
      actPose(d.act, t, d.k, d.look.tempo / 1.9, d.tgt, t - d.t0, d.look.body);
      springStep(d.spr, d.tgt, dt, d.out);
      gait(d.out, d.look.body, d.g, !!ACT_INFO[d.act].carryWalk);
      const face = d.face ?? ACT_INFO[d.act].face ?? 'neutral';
      const bt = (t + d.k * 7) % 3.3;
      const blink = bt < 0.14 ? Math.sin((bt / 0.14) * Math.PI) : 0;
      faceGlyphs(d.look.body, face, face === 'happy' || face === 'asleep' || face === 'proud' ? 0 : blink, t + d.k, d.glyphs);
      // a little hat follow-through from the body's vertical motion
      const top = this.dout.head;
      const di = this.din;
      di.look = d.look; di.pose.set(d.out); di.gait = d.g; di.glyphs = d.glyphs; di.prop = d.prop; di.hold = d.prop ? holdOf(d.act) : 'R';
      di.at.x = d.x; di.at.z = d.z; di.at.yaw = yaw; di.at.scale = 1; di.at.y = 0;
      di.hatLag.x = d.hat.x; di.hatLag.z = d.hat.z; di.hatLag.y = 0;
      di.wobble = (d.look.body === 'codex' ? 0.09 : 0.03) * Math.min(1, Math.abs(d.out[CH.jig]) * 0.35);
      di.wobblePhase = t * 13;
      this.crowd.draw(di, this.dout);
      if (d.top0.x < 1e8) {
        const vy = (top.y - d.top0.y) / dt;
        d.hat.w += ((vy - d.hat.v) / dt * -0.004 - d.hat.x * 90 - d.hat.w * 5) * dt;
        d.hat.x = Math.max(-0.35, Math.min(0.35, d.hat.x + d.hat.w * dt));
        d.hat.v = vy;
      }
      d.top0.copy(top);
    }
    this.crowd.end();
  }
}

const PUP = new WeakMap<THREE.Object3D, Puppets>();
const fake = (seed: string, tier: FarmerView['tier'], kind: FarmerView['kind']) => ({ seed, tier, kind });

const stage = (build: (p: Puppets) => void, n: number, bounds?: THREE.Vector3): THREE.Object3D => {
  const p = new Puppets(n);
  build(p);
  p.tick(0.5, 1 / 60);
  PUP.set(p.crowd.group, p);
  if (bounds) {
    // an invisible box so the gallery frames a stage that moves around
    const frame = new THREE.Mesh(new THREE.BoxGeometry(bounds.x, bounds.y, bounds.z), new THREE.MeshBasicMaterial({ visible: false }));
    frame.position.y = bounds.y / 2;
    p.crowd.group.add(frame);
  }
  return p.crowd.group;
};
const animate = (obj: THREE.Object3D, t: number, dt: number) => PUP.get(obj)?.tick(t, dt);

defineAsset({
  name: 'clawd', group: 'character', variants: GALLERY_VARIANTS,
  note: 'Clawd (Claude agents), opus straw hat; variant = gait, job loop or act',
  build: (o) => stage((p) => p.add(lookFor(fake('gallery', 'opus', 'claude'), WORKSPACE_COLORS[(o.seed + 4) % 8]), o.variant ?? 'walk', 0, 0), 1,
    o.variant === 'stroll' ? new THREE.Vector3(3.4, 1.1, 3.4) : undefined),
  animate,
});

defineAsset({
  name: 'codex', group: 'character', variants: GALLERY_VARIANTS,
  note: 'the Codex cloud (Codex agents), beanie; variant = gait, job loop or act',
  build: (o) => stage((p) => p.add(lookFor(fake('gallery', null, 'codex'), WORKSPACE_COLORS[(o.seed + 1) % 8]), o.variant ?? 'hop', 0, 0), 1,
    o.variant === 'stroll' ? new THREE.Vector3(3.4, 1.1, 3.4) : undefined),
  animate,
});

defineAsset({
  name: 'mascot-cast', group: 'character', variants: GALLERY_VARIANTS,
  note: 'kind × tier: Clawd opus straw · sonnet cap · haiku bandana · other beanie; Codex; Gemini (star); agent (grey)',
  build: (o) => stage((p) => {
    const cast: [FarmerView['tier'], FarmerView['kind']][] = [['opus', 'claude'], ['sonnet', 'claude'], ['haiku', 'claude'], [null, 'claude'], ['opus', 'codex'], ['sonnet', 'codex'], [null, 'gemini'], [null, 'agent']];
    cast.forEach(([tier, kind], i) => p.add(lookFor(fake(`cast${i}`, tier, kind), WORKSPACE_COLORS[i]), o.variant ?? 'stand', (i % 4 - 1.5) * 1.9, Math.floor(i / 4) * 1.9 - 0.95));
  }, 8),
  animate,
});

defineAsset({
  name: 'mascot-faces', group: 'character', note: 'every expression, Clawd (front row) and Codex (back row) — eyes blink, the cursor blinks',
  build: () => stage((p) => {
    FACES.forEach((f, i) => {
      p.add(lookFor(fake(`face${i}`, 'sonnet', 'claude'), WORKSPACE_COLORS[i % 8]), 'stand', (i % 7 - 3) * 1.7, Math.floor(i / 7) * 3.6 - 1.8, 0, f);
      p.add(lookFor(fake(`face${i}`, null, 'codex'), WORKSPACE_COLORS[i % 8]), 'stand', (i % 7 - 3) * 1.7, Math.floor(i / 7) * 3.6 - 0.1, 0, f);
    });
  }, FACES.length * 2),
  animate,
});

defineAsset({
  name: 'mascot-props', group: 'prop', variants: PROPS,
  note: 'held props, shown in the nub of the loop that uses them',
  build: (o) => stage((p) => {
    const prop = (o.variant as Prop) ?? 'hoe';
    const act = (ACTS.find((a) => propOf(a) === prop) ?? 'stand') as Act;
    p.add(lookFor(fake('props', 'haiku', 'claude'), WORKSPACE_COLORS[2]), act, -0.9, 0);
    p.add(lookFor(fake('props', null, 'codex'), WORKSPACE_COLORS[5]), act, 1.0, 0);
  }, 2),
  animate,
});

defineAsset({
  name: 'mascot-poses', group: 'character', note: 'every act side by side (reading order = ACTS), alternating Clawd / Codex',
  build: () => stage((p) => {
    ACTS.forEach((a, i) => p.add(lookFor(fake(`pose${i % 5}`, (['opus', 'sonnet', 'haiku', null, 'opus'] as const)[i % 5], i % 2 ? 'codex' : 'claude'), WORKSPACE_COLORS[i % 8]), a, (i % 7 - 3) * 2.0, Math.floor(i / 7) * 2.2 - 4.4, 0));
  }, ACTS.length),
  animate,
});

// ducklings ------------------------------------------------------------------------------------------------------------

interface DuckStage { ducks: Ducks; list: Duck[]; variant: string; trail: ReturnType<typeof newTrail>; t: number }
const DUCK = new WeakMap<THREE.Object3D, DuckStage>();
const DUCK_VARIANTS = ['waddle', 'hurry', 'sit', 'peep', 'hatch', 'home'] as const;

defineAsset({
  name: 'duckling', group: 'character', variants: DUCK_VARIANTS,
  note: 'subagent duckling: waddle (rock, paddling feet, head bob), hurry (flap-hops), sit, peep, hatch (egg wobble → crack → pop), home (goodbye flap, waddle off)',
  build: (o) => {
    const ducks = new Ducks(8);
    const variant = o.variant ?? 'waddle';
    const n = variant === 'hatch' || variant === 'home' ? 1 : 3;
    const list = Array.from({ length: n }, (_, i) => Ducks.make({ id: `d${i}`, label: 'helper', type: 'sub', active: true }, (i - (n - 1) / 2) * 0.35, 0, 0, variant === 'hatch'));
    const st: DuckStage = { ducks, list, variant, trail: newTrail(0, 0), t: 0 };
    DUCK.set(ducks.group, st);
    ducks.begin(); for (const d of list) ducks.draw(d, 0); ducks.end();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
    frame.position.y = 0.22;
    ducks.group.add(frame);
    return ducks.group;
  },
  animate: (obj, t, dt) => {
    const st = DUCK.get(obj);
    if (!st) return;
    dt = Math.min(Math.max(dt, 1 / 120), 0.05);
    st.t += dt;
    const flat = () => 0;
    st.ducks.begin();
    st.list.forEach((d, i) => {
      const x0 = (i - (st.list.length - 1) / 2) * 0.35;
      switch (st.variant) {
        case 'waddle': case 'hurry': {
          // treadmill: advance the waddle as if walking, stay in place
          const v = st.variant === 'hurry' ? 1.6 : 0.8;
          d.t += dt; d.speed = v; d.phase += (v * dt) / 0.075; d.x = x0; d.z = 0; d.yaw = 0;
          d.flap = st.variant === 'hurry' ? 1 : 0;
          if (st.variant === 'hurry' && d.hop <= 0 && d.hopV <= 0) d.hopV = 1.2;
          if (d.hopV !== 0 || d.hop > 0) { d.hopV -= 9.8 * dt; d.hop += d.hopV * dt; if (d.hop <= 0) { d.hop = 0; d.hopV = 0; } }
          break;
        }
        case 'sit': case 'peep': {
          st.ducks.follow(d, st.trail, 0, 1, 0.5, dt, false, flat, Math.PI, { x: x0, z: 0 });
          d.x = x0; d.z = 0; d.speed = 0; d.yaw = 0;
          if (st.variant === 'peep' && d.t > d.peepUntil + 0.6 + i * 0.3) Ducks.peep(d);
          if (st.variant === 'sit') d.still = 5;
          break;
        }
        case 'hatch': {
          if (d.hatch >= HATCH + 2.5) { d.hatch = 0; d.pop = 0; d.shell = null; }
          if (d.hatch >= HATCH) d.hatch += dt;
          st.ducks.follow(d, st.trail, 0, 1, 0.5, dt, false, flat, Math.PI, { x: x0, z: 0 });
          d.x = x0; d.z = 0; d.speed = 0;
          break;
        }
        case 'home': {
          if (!d.home || d.fade <= 0) { d.home = { x: 0.9, z: 0 }; d.homeT = 0; d.fade = 1; d.x = -0.6; d.z = 0; d.yaw = 0; d.hop = 0; d.hopV = 0; }
          st.ducks.goHome(d, dt, flat);
          break;
        }
      }
      st.ducks.draw(d, t, dt);
    });
    st.ducks.end();
  },
});

defineAsset({
  name: 'farmer-emotes', group: 'fx', note: 'emote atlas: ! ? ♥ ✓ sweat storm Zzz bulb ♪ thought … sparkle star scribble halo puff egg',
  build: () => {
    const b = new Billboards(32);
    const names = Object.keys(EMOTE) as (keyof typeof EMOTE)[];
    b.begin();
    names.forEach((n, i) => b.push((i % 6 - 2.5) * 0.7, 1.4 - Math.floor(i / 6) * 0.7, 0, 0.6, EMOTE[n], 1, 1));
    b.end();
    const g = new THREE.Group();
    g.add(b.mesh);
    // a stand-in box so the gallery can frame billboards (they have no bounds)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 0.02), new THREE.MeshBasicMaterial({ visible: false }));
    frame.position.y = 1;
    g.add(frame);
    return g;
  },
});
