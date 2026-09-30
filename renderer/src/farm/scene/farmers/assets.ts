/**
 * Asset registrations for the farmers package. The gallery builds farmers through the same Crowd rig and pose loops
 * the valley uses: `variant` = the activity loop, so every job pose can be inspected, turned and scrubbed.
 */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { Crowd } from './rig.ts';
import { lookFor } from './look.ts';
import type { Look } from './look.ts';
import { ACTS, ACT_INFO, FACES, PROPS, actPose, blendStep, gait, newBlend, newPose, setAct } from './pose.ts';
import type { Act, Blend, Face, Pose, Prop } from './pose.ts';
import { propOf } from './brain.ts';
import { faceCell, EMOTE } from './atlas.ts';
import { Ducks } from './ducks.ts';
import { Billboards } from './fx.ts';
import { WORKSPACE_COLORS, PAL } from '../toon.ts';
import type { FarmerView } from '../../model/types.ts';

interface Doll { look: Look; act: Act; face: Face | null; prop: Prop | null; x: number; z: number; yaw: number; k: number; blend: Blend; tgt: Pose; out: Pose; walk: boolean }

/** A little stage of farmers driven by the real rig + pose loops (gallery only). */
export class Puppets {
  readonly crowd: Crowd;
  readonly dolls: Doll[] = [];
  constructor(n: number) { this.crowd = new Crowd(Math.max(1, n), true); }
  add(look: Look, act: Act, x: number, z: number, yaw = 0, face: Face | null = null, walk = false): Doll {
    const i = this.dolls.length;
    this.crowd.setLook(i, look, PAL.apple);
    const d: Doll = { look, act, face, prop: propOf(act) ?? (walk ? null : null), x, z, yaw, k: i * 0.137, blend: newBlend(act), tgt: newPose(), out: newPose(), walk };
    if (act === 'bindle') d.prop = 'bindle';
    this.crowd.setProp(i, d.prop);
    this.dolls.push(d);
    return d;
  }
  tick(t: number, dt: number): void {
    if (!Number.isFinite(t)) t = performance.now() / 1000; // tolerate a gallery clock that is not running yet
    if (!Number.isFinite(dt)) dt = 1 / 60;
    this.dolls.forEach((d, i) => {
      setAct(d.blend, d.act, d.out);
      actPose(d.blend.act, t, d.k, d.look.tempo / 1.9, d.tgt);
      if (d.walk) gait(d.tgt, t * 1.4, 1, 0, d.look.bounce, !!ACT_INFO[d.act].carryWalk);
      blendStep(d.blend, d.tgt, Math.max(dt, 1 / 60), d.out);
      const face = d.face ?? ACT_INFO[d.act].face ?? 'neutral';
      const blink = (t + d.k * 7) % 3.3 < 0.12 && face !== 'happy' && face !== 'asleep';
      this.crowd.setFace(i, faceCell(face === 'talk' && Math.sin(t * 13) < 0 ? 'neutral' : face, blink));
      const want = propOf(d.act) ?? (d.act === 'bindle' ? 'bindle' : null);
      if (want !== d.prop) { d.prop = want; this.crowd.setProp(i, want); }
      this.crowd.write(i, { x: d.x, y: 0, z: d.z, yaw: d.yaw, scale: d.look.scale }, d.out, d.prop, 1);
    });
    this.crowd.setCount(this.dolls.length);
  }
}

const PUP = new WeakMap<THREE.Object3D, Puppets>();
const DUCK = new WeakMap<THREE.Object3D, { ducks: Ducks; list: ReturnType<typeof Ducks.make>[] }>();
const fake = (seed: string, tier: FarmerView['tier'], kind: FarmerView['kind']) => ({ seed, tier, kind });

const stage = (build: (p: Puppets) => void, n: number): THREE.Object3D => {
  const p = new Puppets(n);
  build(p);
  p.tick(0.5, 1);
  PUP.set(p.crowd.group, p);
  return p.crowd.group;
};
const animate = (obj: THREE.Object3D, t: number, dt: number) => PUP.get(obj)?.tick(t, dt);

defineAsset({
  name: 'farmer', group: 'character', variants: ACTS,
  note: 'chibi farmer (haiku: bandana); variant = activity loop',
  build: (o) => stage((p) => p.add(lookFor(fake(`gallery${o.seed}`, 'haiku', 'claude'), WORKSPACE_COLORS[o.seed % 8]), (o.variant as Act) ?? 'stand', 0, 0), 1),
  animate,
});

defineAsset({
  name: 'farmer-cast', group: 'character', variants: ACTS,
  note: 'opus straw hat · sonnet cap · haiku bandana · other beanie · codex goggles · gemini beret',
  build: (o) => stage((p) => {
    const cast: [FarmerView['tier'], FarmerView['kind']][] = [['opus', 'claude'], ['sonnet', 'claude'], ['haiku', 'claude'], [null, 'agent'], ['opus', 'codex'], ['other', 'gemini'], ['sonnet', 'claude'], ['opus', 'claude']];
    cast.forEach(([tier, kind], i) => p.add(lookFor(fake(`cast${i}`, tier, kind), WORKSPACE_COLORS[i]), (o.variant as Act) ?? 'stand', (i % 4 - 1.5) * 1.1, Math.floor(i / 4) * 1.4 - 0.7));
  }, 8),
  animate,
});

defineAsset({
  name: 'farmer-faces', group: 'character', note: 'every expression (row) — eyes blink',
  build: () => stage((p) => {
    FACES.forEach((f, i) => { const d = p.add(lookFor(fake(`face${i}`, i % 2 ? 'sonnet' : 'haiku', 'claude'), WORKSPACE_COLORS[i % 8]), 'stand', (i % 6 - 2.5) * 0.8, Math.floor(i / 6) * 1.2 - 0.6, 0, f); void d; });
  }, FACES.length),
  animate,
});

defineAsset({
  name: 'farmer-props', group: 'prop', variants: PROPS,
  note: 'held props, shown in the hand of the activity that uses them',
  build: (o) => stage((p) => {
    const prop = (o.variant as Prop) ?? 'hoe';
    const act = (ACTS.find((a) => propOf(a) === prop) ?? (prop === 'bindle' ? 'bindle' : 'stand')) as Act;
    p.add(lookFor(fake('props', 'haiku', 'claude'), WORKSPACE_COLORS[2]), act, 0, 0);
  }, 1),
  animate,
});

defineAsset({
  name: 'duckling', group: 'character', note: 'subagent duckling (waddles behind its farmer)',
  build: () => {
    const ducks = new Ducks(8);
    const list = [0, 1, 2].map((i) => Ducks.make({ id: `d${i}`, label: 'helper', type: 'sub', active: true }, i * 0.4 - 0.4, 0, 0, false));
    DUCK.set(ducks.group, { ducks, list });
    ducks.begin(); for (const d of list) ducks.draw(d, 0); ducks.end();
    return ducks.group;
  },
  animate: (obj, t, dt) => {
    const u = DUCK.get(obj);
    if (!u) return;
    u.ducks.begin();
    u.list.forEach((d, i) => { d.phase += dt * 3; d.speed = 0.5; d.x = i * 0.4 - 0.4; d.hop = Math.max(0, Math.sin(t * 6 + i)) * 0.06; u.ducks.draw(d, t); });
    u.ducks.end();
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

defineAsset({
  name: 'farmer-poses', group: 'character', note: 'every activity loop side by side (reading order = ACTS)',
  build: () => stage((p) => {
    ACTS.forEach((a, i) => p.add(lookFor(fake(`pose${i % 5}`, (['opus', 'sonnet', 'haiku', 'other', 'opus'] as const)[i % 5], i % 5 === 4 ? 'codex' : 'claude'), WORKSPACE_COLORS[i % 8]), a, (i % 7 - 3) * 1.5, Math.floor(i / 7) * 1.7 - 3.4, 0));
  }, ACTS.length),
  animate,
});
