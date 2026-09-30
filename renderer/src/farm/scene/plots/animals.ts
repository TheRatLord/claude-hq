/**
 * Farm animals: chunky toon chickens, cows, sheep and pigs built from three instanced parts each (body, head, leg),
 * plus the herd behaviour that moves them around a pen: wander, graze / peck, sleep when the field rests, trot in
 * when a field is tilled, walk off to the barn at harvest, look at / nuzzle the player, scatter from sprinting.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PAL, toon } from '../toon.ts';
import type { Batches } from './batch.ts';
import { ball, box, cached, cone, cyl, dodec, jitter, leaf, merge, rng, rod, torus } from './geo.ts';
import type { V3 } from './geo.ts';
import { clamp01, damp, smooth01 } from './geo.ts';
import type { Fx } from './fx.ts';
import type { SfxName } from '../context.ts';

export type SpeciesKey = 'chicken' | 'cow' | 'sheep' | 'pig';

export interface Species {
  key: SpeciesKey;
  body(season: Season): THREE.BufferGeometry;
  head(): THREE.BufferGeometry;
  leg(): THREE.BufferGeometry;
  /** hip joints in body space */
  hips: V3[];
  legLen: number;
  neck: V3;
  /** avoidance radius */
  r: number;
  speed: number;
  sound: SfxName;
  names: string[];
  tints: number[];
  max: number;
  /** grazing head pitch */
  graze: number;
}

const tintOf = (c: number) => c;

function chickenBody(): THREE.BufferGeometry {
  return cached('chicken:body', () => jitter(merge([
    ball(0.17, 0xffffff, { p: [0, 0.3, -0.02], s: [0.85, 0.85, 1.15] }, 1),
    ball(0.1, 0xffffff, { p: [0, 0.36, 0.12] }),
    cone(0.1, 0.2, 5, 0xf0ece0, { p: [0, 0.42, -0.2], r: [-0.7, 0, 0], s: [0.5, 1, 1] }),
    cone(0.07, 0.16, 5, 0xe0dccf, { p: [0, 0.45, -0.17], r: [-0.3, 0, 0], s: [0.4, 1, 1] }),
    ball(0.1, 0xefeadc, { p: [0.13, 0.31, -0.03], s: [0.35, 0.7, 1.1] }),
    ball(0.1, 0xefeadc, { p: [-0.13, 0.31, -0.03], s: [0.35, 0.7, 1.1] }),
  ]), 0.03, 3));
}
function chickenHead(): THREE.BufferGeometry {
  return cached('chicken:head', () => merge([
    ball(0.085, 0xfbf8f0, { p: [0, 0.08, 0.02] }, 1),
    cone(0.03, 0.08, 4, PAL.orange, { p: [0, 0.07, 0.12], r: [Math.PI / 2, 0, 0] }),
    box(0.03, 0.06, 0.03, PAL.red, { p: [0, 0.17, 0.0] }), box(0.03, 0.05, 0.03, PAL.red, { p: [0, 0.165, 0.045] }), box(0.03, 0.045, 0.03, PAL.red, { p: [0, 0.16, -0.04] }),
    ball(0.025, PAL.red, { p: [0, 0.02, 0.09], s: [0.7, 1.3, 0.7] }),
    box(0.02, 0.025, 0.02, PAL.ink, { p: [0.07, 0.1, 0.05] }), box(0.02, 0.025, 0.02, PAL.ink, { p: [-0.07, 0.1, 0.05] }),
  ]));
}
function chickenLeg(): THREE.BufferGeometry {
  return cached('chicken:leg', () => merge([
    cyl(0.015, 0.015, 0.16, 4, PAL.orange, { p: [0, -0.08, 0] }),
    box(0.03, 0.015, 0.09, PAL.orange, { p: [0, -0.16, 0.03] }), box(0.08, 0.015, 0.03, PAL.orange, { p: [0, -0.16, 0.05] }),
  ]));
}

function cowBody(): THREE.BufferGeometry {
  return cached('cow:body', () => {
    const p = [
      box(0.72, 0.62, 1.3, 0xffffff, { p: [0, 0.98, 0] }),
      box(0.66, 0.5, 0.3, 0xffffff, { p: [0, 1.0, 0.68] }),
      box(0.74, 0.3, 0.44, 0x2e2a2a, { p: [0, 1.06, -0.18] }),
      box(0.3, 0.26, 0.3, 0x2e2a2a, { p: [0.23, 1.2, 0.35] }),
      box(0.74, 0.22, 0.26, 0x2e2a2a, { p: [0.0, 0.86, 0.44], s: [1.005, 1, 1] }),
      box(0.3, 0.14, 0.3, PAL.pink, { p: [0, 0.62, -0.3] }),
      rod([0, 1.18, -0.66], [0.04, 0.7, -0.78], 0.035, 0.025, 4, 0xffffff),
      ball(0.06, 0x2e2a2a, { p: [0.04, 0.66, -0.79], s: [1, 1.5, 1] }),
    ];
    return jitter(merge(p), 0.03, 5);
  });
}
function cowHead(): THREE.BufferGeometry {
  return cached('cow:head', () => merge([
    box(0.44, 0.42, 0.46, 0xfbf8f0, { p: [0, 0.02, 0.2] }),
    box(0.46, 0.22, 0.2, 0xf2a6a0, { p: [0, -0.08, 0.46] }),
    box(0.05, 0.05, 0.02, 0x7a3a3a, { p: [0.1, -0.06, 0.565] }), box(0.05, 0.05, 0.02, 0x7a3a3a, { p: [-0.1, -0.06, 0.565] }),
    box(0.05, 0.08, 0.02, PAL.ink, { p: [0.15, 0.1, 0.435] }), box(0.05, 0.08, 0.02, PAL.ink, { p: [-0.15, 0.1, 0.435] }),
    box(0.2, 0.08, 0.12, 0x2e2a2a, { p: [0.28, 0.13, 0.12], r: [0, 0, -0.3] }), box(0.2, 0.08, 0.12, 0x2e2a2a, { p: [-0.28, 0.13, 0.12], r: [0, 0, 0.3] }),
    cone(0.04, 0.14, 4, 0xf2e8d0, { p: [0.14, 0.27, 0.12], r: [0, 0, -0.35] }), cone(0.04, 0.14, 4, 0xf2e8d0, { p: [-0.14, 0.27, 0.12], r: [0, 0, 0.35] }),
    box(0.24, 0.08, 0.14, 0x2e2a2a, { p: [0, 0.2, 0.3] }),
    torus(0.07, 0.015, 4, 8, PAL.yellow, { p: [0, -0.24, 0.26], r: [Math.PI / 2, 0, 0] }),
    box(0.09, 0.11, 0.05, PAL.yellow, { p: [0, -0.34, 0.3] }),
  ]));
}
function cowLeg(): THREE.BufferGeometry {
  return cached('cow:leg', () => merge([box(0.15, 0.62, 0.15, 0xf6f2ea, { p: [0, -0.31, 0] }), box(0.17, 0.1, 0.17, 0x3a3030, { p: [0, -0.6, 0.01] })]));
}

function sheepBody(season: Season): THREE.BufferGeometry {
  return cached(`sheep:body:${season}`, () => {
    const r = rng('sheep');
    const wool = season === 'winter' ? 0xfdfcf8 : 0xf6f1e4;
    const p: THREE.BufferGeometry[] = [ball(0.36, wool, { p: [0, 0.62, 0], s: [1, 0.9, 1.25] }, 1)];
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2, e = r() * 1.2 - 0.3;
      p.push(dodec(0.16 + r() * 0.06, i % 3 ? wool : 0xe8e0cc, { p: [Math.cos(a) * Math.cos(e) * 0.32, 0.64 + Math.sin(e) * 0.3, Math.sin(a) * Math.cos(e) * 0.42] }));
    }
    p.push(ball(0.08, wool, { p: [0, 0.66, -0.47] }));
    return jitter(merge(p), 0.04, 7);
  });
}
function sheepHead(): THREE.BufferGeometry {
  return cached('sheep:head', () => merge([
    ball(0.15, 0x3a3434, { p: [0, 0, 0.12], s: [0.85, 1, 1.25] }, 1),
    dodec(0.12, 0xf6f1e4, { p: [0, 0.13, 0.06] }), dodec(0.08, 0xf6f1e4, { p: [0.07, 0.15, 0.13] }), dodec(0.08, 0xf6f1e4, { p: [-0.07, 0.15, 0.13] }),
    leaf(0.16, 0.09, 0x3a3434, { p: [0.1, 0.05, 0.05], r: [0.4, 1.9, 0] }), leaf(0.16, 0.09, 0x3a3434, { p: [-0.1, 0.05, 0.05], r: [0.4, -1.9, 0] }),
    box(0.04, 0.04, 0.02, 0xffffff, { p: [0.075, 0.03, 0.27] }), box(0.04, 0.04, 0.02, 0xffffff, { p: [-0.075, 0.03, 0.27] }),
    box(0.02, 0.02, 0.02, PAL.ink, { p: [0.075, 0.03, 0.285] }), box(0.02, 0.02, 0.02, PAL.ink, { p: [-0.075, 0.03, 0.285] }),
    box(0.06, 0.02, 0.02, 0xd08080, { p: [0, -0.08, 0.3] }),
  ]));
}
function sheepLeg(): THREE.BufferGeometry {
  return cached('sheep:leg', () => merge([box(0.08, 0.36, 0.08, 0x3a3434, { p: [0, -0.18, 0] }), box(0.09, 0.05, 0.1, 0x2a2424, { p: [0, -0.35, 0.01] })]));
}

function pigBody(): THREE.BufferGeometry {
  return cached('pig:body', () => jitter(merge([
    ball(0.34, 0xffffff, { p: [0, 0.45, 0], s: [0.85, 0.8, 1.3] }, 1),
    torus(0.05, 0.015, 4, 8, 0xffffff, { p: [0, 0.55, -0.45], r: [0, Math.PI / 2, 0] }, Math.PI * 1.6),
    ball(0.08, 0xd89aa0, { p: [0.12, 0.62, 0.1], s: [1.2, 0.3, 1.2] }),
  ]), 0.03, 9));
}
function pigHead(): THREE.BufferGeometry {
  return cached('pig:head', () => merge([
    ball(0.2, 0xffffff, { p: [0, 0.02, 0.08], s: [1, 0.95, 0.95] }, 1),
    cyl(0.09, 0.1, 0.1, 8, 0xf4a0a8, { p: [0, -0.02, 0.27], r: [Math.PI / 2, 0, 0] }),
    box(0.03, 0.04, 0.02, 0x9a4a5a, { p: [0.035, -0.02, 0.325] }), box(0.03, 0.04, 0.02, 0x9a4a5a, { p: [-0.035, -0.02, 0.325] }),
    cone(0.08, 0.14, 3, 0xffe0e4, { p: [0.12, 0.18, 0.02], r: [0.5, 0, -0.5] }), cone(0.08, 0.14, 3, 0xffe0e4, { p: [-0.12, 0.18, 0.02], r: [0.5, 0, 0.5] }),
    box(0.035, 0.05, 0.02, PAL.ink, { p: [0.08, 0.07, 0.24] }), box(0.035, 0.05, 0.02, PAL.ink, { p: [-0.08, 0.07, 0.24] }),
  ]));
}
function pigLeg(): THREE.BufferGeometry {
  return cached('pig:leg', () => merge([box(0.1, 0.24, 0.1, 0xffffff, { p: [0, -0.12, 0] }), box(0.11, 0.05, 0.11, 0x9a6a6a, { p: [0, -0.24, 0.01] })]));
}

export const SPECIES: Record<SpeciesKey, Species> = {
  chicken: {
    key: 'chicken', body: () => chickenBody(), head: chickenHead, leg: chickenLeg, hips: [[0.06, 0.18, 0], [-0.06, 0.18, 0]], legLen: 0.17, neck: [0, 0.4, 0.13],
    r: 0.3, speed: 0.9, sound: 'cluck', max: 9, graze: 1.2,
    names: ['Nugget', 'Pip', 'Henrietta', 'Peep', 'Clucky', 'Popcorn', 'Dotty', 'Waffles', 'Biscuit', 'Marge', 'Omelette', 'Sunny', 'Pepper', 'Custard'],
    tints: [0xffffff, 0xffffff, tintOf(0xc07840), tintOf(0xd8a060), tintOf(0x8a5a3a), 0xffffff],
  },
  cow: {
    key: 'cow', body: () => cowBody(), head: cowHead, leg: cowLeg, hips: [[0.24, 0.66, 0.45], [-0.24, 0.66, 0.45], [0.24, 0.66, -0.45], [-0.24, 0.66, -0.45]], legLen: 0.66,
    neck: [0, 1.12, 0.75], r: 0.95, speed: 0.55, sound: 'moo', max: 4, graze: 0.95,
    names: ['Daisy', 'Buttercup', 'Clover', 'Bessie', 'Mabel', 'Marigold', 'Petunia', 'Honey', 'Dolly', 'Maple', 'Moomin', 'Toffee'],
    tints: [0xffffff, 0xffffff, tintOf(0xd8a070), tintOf(0xb87a50)],
  },
  sheep: {
    key: 'sheep', body: sheepBody, head: sheepHead, leg: sheepLeg, hips: [[0.16, 0.38, 0.26], [-0.16, 0.38, 0.26], [0.16, 0.38, -0.26], [-0.16, 0.38, -0.26]], legLen: 0.38,
    neck: [0, 0.78, 0.48], r: 0.6, speed: 0.6, sound: 'baa', max: 6, graze: 0.9,
    names: ['Woolly', 'Cotton', 'Fluffy', 'Shaun', 'Baabara', 'Cloud', 'Lamby', 'Muffin', 'Pearl', 'Nimbus', 'Dumpling', 'Tufty'],
    tints: [0xffffff, 0xffffff, 0xffffff, 0xfff4e0, tintOf(0x5a5250)],
  },
  pig: {
    key: 'pig', body: () => pigBody(), head: pigHead, leg: pigLeg, hips: [[0.15, 0.26, 0.26], [-0.15, 0.26, 0.26], [0.15, 0.26, -0.26], [-0.15, 0.26, -0.26]], legLen: 0.26,
    neck: [0, 0.52, 0.4], r: 0.6, speed: 0.6, sound: 'oink', max: 5, graze: 0.7,
    names: ['Truffle', 'Hamlet', 'Pickles', 'Wilbur', 'Peaches', 'Snuffles', 'Pudding', 'Rosie', 'Babe', 'Mochi', 'Sprout', 'Bean'],
    tints: [0xf6b6bc, 0xf0a8b0, 0xfac4c8, 0xe8a0a0, tintOf(0xd89080)],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Herd behaviour

export type AnimalMode = 'idle' | 'walk' | 'graze' | 'sleep' | 'hop' | 'flee' | 'arrive' | 'leave' | 'nuzzle' | 'roll' | 'gone';

export interface Animal {
  id: string;
  name: string;
  sp: Species;
  x: number; z: number; yaw: number;
  tx: number; tz: number;
  mode: AnimalMode;
  t: number;
  phase: number;
  walk: number;
  scale: number;
  tint: THREE.Color;
  headYaw: number; headPitch: number;
  bob: number; roll: number; sleepK: number;
  happy: number;
  friendly: boolean;
  appear: number;
  seed: number;
  lastSound: number;
}

export interface Pen {
  hw: number; hd: number;
  /** keep-out circles (spots and props) in site-local coords */
  avoid: { x: number; z: number; r: number }[];
  /** where the mud is (pigs roll there) */
  mud?: { x: number; z: number; r: number };
  /** where food / water is (animals like to go there) */
  lure: { x: number; z: number }[];
}

export interface HerdInput {
  dt: number; time: number;
  /** 0 calm … 1 lively (vigor/thriving) */
  lively: number;
  /** 0..1 how sleepy (resting stage, night) */
  sleepy: number;
  /** player in site-local coords (null = far) */
  player: { x: number; z: number; speed: number } | null;
  /** intro: 0..1 of the arrival; harvest: 0..1 of the leaving */
  arrive: number;
  leave: number;
  /** growth 0..1 */
  growth: number;
  /** direction (site-local, unit) toward the barn */
  barn: { x: number; z: number };
  fx: Fx | null;
  toWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3;
  sound(name: SfxName, x: number, y: number, z: number): void;
}

const TAU = Math.PI * 2;
const wrap = (a: number) => (Number.isFinite(a) ? a - TAU * Math.round(a / TAU) : 0);

export class Herd {
  readonly animals: Animal[] = [];
  private readonly r: () => number;
  private readonly _v = new THREE.Vector3();

  readonly sp: Species;
  readonly pen: Pen;
  readonly plotId: string;

  constructor(sp: Species, pen: Pen, plotId: string, count: number, preplaced: boolean) {
    this.sp = sp; this.pen = pen; this.plotId = plotId;
    this.r = rng(`herd:${plotId}`);
    const used = new Set<number>();
    for (let i = 0; i < count; i++) {
      const rr = rng(`${plotId}:${sp.key}:${i}`);
      let ni = Math.floor(rr() * sp.names.length);
      while (used.has(ni) && used.size < sp.names.length) ni = (ni + 1) % sp.names.length;
      used.add(ni);
      const p = this.randomPoint();
      const a: Animal = {
        id: `${plotId}:${sp.key}:${i}`, name: sp.names[ni], sp, x: p.x, z: p.z, yaw: rr() * TAU, tx: p.x, tz: p.z,
        mode: preplaced ? 'idle' : 'arrive', t: rr() * 3, phase: rr() * TAU, walk: 0, scale: (0.85 + rr() * 0.25) * (sp.key === 'chicken' ? 1.35 : 1),
        tint: new THREE.Color(sp.tints[Math.floor(rr() * sp.tints.length)]), headYaw: 0, headPitch: 0, bob: 0, roll: 0, sleepK: 0,
        happy: 0, friendly: rr() < 0.4, appear: preplaced ? 1 : 0, seed: rr(), lastSound: -99,
      };
      if (!preplaced) { a.x = (rr() - 0.5) * 2; a.z = pen.hd + 3 + i * 0.9; a.yaw = Math.PI; }
      this.animals.push(a);
    }
  }

  private randomPoint(): { x: number; z: number } {
    const { hw, hd } = this.pen;
    for (let k = 0; k < 30; k++) {
      const x = (this.r() * 2 - 1) * (hw - 1.2), z = -hd + 1.0 + this.r() * (hd * 2 - 3.6);
      if (this.pen.avoid.every((c) => (x - c.x) ** 2 + (z - c.z) ** 2 > (c.r + this.sp.r * 0.6) ** 2)) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  private pick(a: Animal, lively: number, sleepy: number): void {
    const r = this.r();
    if (sleepy > 0.5 && r < 0.75) { a.mode = 'sleep'; a.t = 8 + this.r() * 14; return; }
    if (this.pen.mud && this.sp.key === 'pig' && r < 0.35) {
      const m = this.pen.mud;
      a.tx = m.x + (this.r() - 0.5) * m.r; a.tz = m.z + (this.r() - 0.5) * m.r * 0.6; a.mode = 'walk'; a.t = 12; return;
    }
    if (r < 0.35 + lively * 0.2) {
      const lure = this.pen.lure.length && this.r() < 0.3 ? this.pen.lure[Math.floor(this.r() * this.pen.lure.length)] : null;
      const p = lure ? { x: lure.x + (this.r() - 0.5) * 1.5, z: lure.z + 0.9 + this.r() * 0.6 } : this.randomPoint();
      a.tx = p.x; a.tz = p.z; a.mode = 'walk'; a.t = 14;
    } else if (r < 0.8) { a.mode = 'graze'; a.t = 3 + this.r() * 6; }
    else if (lively > 0.6 && r < 0.9) { a.mode = 'hop'; a.t = 0.7; }
    else { a.mode = 'idle'; a.t = 2 + this.r() * 4; }
  }

  pet(a: Animal, fx: Fx | null, toWorld: HerdInput['toWorld'], sound: HerdInput['sound']): void {
    a.happy = 2.2;
    a.mode = 'hop'; a.t = 0.9;
    const p = toWorld(a.x, a.sp.neck[1] * a.scale + 0.3, a.z, this._v);
    for (let i = 0; i < 4; i++) fx?.spawn('heart', p.x + (this.r() - 0.5) * 0.3, p.y + i * 0.08, p.z + (this.r() - 0.5) * 0.3, { vy: 0.55 + this.r() * 0.3, life: 1.6 + this.r() * 0.4, size: 1 + this.r() * 0.4, color: this.r() < 0.5 ? 0xff5a7a : 0xff8aa8, spin: this.r() * 6 });
    sound(a.sp.sound, p.x, p.y, p.z);
    sound('pet', p.x, p.y, p.z);
  }

  update(inp: HerdInput): void {
    const { dt } = inp;
    const { hw, hd } = this.pen;
    const want = Math.max(1, Math.ceil(this.animals.length * (0.55 + 0.45 * inp.growth)));
    this.animals.forEach((a, idx) => {
      a.t -= dt;
      a.happy = Math.max(0, a.happy - dt);
      const active = idx < want || inp.leave > 0;
      // lifecycle overrides
      if (inp.leave > 0 && a.mode !== 'leave' && a.mode !== 'gone') {
        if (inp.leave > (idx / this.animals.length) * 0.25) { a.mode = 'leave'; a.t = 0; }
      }
      if (a.mode === 'gone') { a.appear = 0; return; }
      if (a.mode === 'arrive') {
        const start = (idx / Math.max(1, this.animals.length)) * 0.45;
        if (inp.arrive <= start) { a.appear = 0; return; }
        a.appear = damp(a.appear, 1, 6, dt);
      } else if (a.mode !== 'leave') a.appear = damp(a.appear, active ? 1 : 0, 2, dt);

      let speed = 0, tx = a.tx, tz = a.tz;
      switch (a.mode) {
        case 'arrive': {
          // trot in through the gate, then on to a spot
          const outside = a.z > hd - 1.5;
          tx = outside ? 0 : a.tx; tz = outside ? hd - 2.2 : a.tz;
          speed = this.sp.speed * 2.2;
          if (a.z < hd - 1.5 && (a.x - a.tx) ** 2 + (a.z - a.tz) ** 2 < 0.2) { a.mode = 'hop'; a.t = 0.6; }
          break;
        }
        case 'leave': {
          a.t += dt * 2; // t counts up while leaving
          const outside = a.z > hd + 0.5;
          if (!outside) { tx = 0; tz = hd + 2; } else { tx = a.x + inp.barn.x * 5; tz = a.z + inp.barn.z * 5; }
          speed = this.sp.speed * 3.2;
          if (a.z > hd + 4) a.appear = damp(a.appear, 0, 2.5, dt);
          if (a.appear < 0.02 && a.z > hd + 4) {
            const p = inp.toWorld(a.x, 0.3, a.z, this._v);
            inp.fx?.spawn('puff', p.x, p.y, p.z, { vy: 0.4, life: 0.8, size: 2, color: 0xe8dcc0 });
            a.mode = 'gone';
          }
          break;
        }
        case 'walk': speed = this.sp.speed * (1 + inp.lively * 0.5); if ((a.x - tx) ** 2 + (a.z - tz) ** 2 < 0.15 || a.t < 0) this.pick(a, inp.lively, inp.sleepy); break;
        case 'flee': speed = this.sp.speed * 4; if (a.t < 0) { a.mode = 'idle'; a.t = 1; } break;
        case 'nuzzle': {
          if (!inp.player) { a.mode = 'idle'; break; }
          tx = inp.player.x; tz = inp.player.z;
          const d = Math.hypot(tx - a.x, tz - a.z);
          speed = d > this.sp.r + 0.7 ? this.sp.speed * 1.3 : 0;
          if (a.t < 0 || d > 6) { a.mode = 'idle'; a.t = 3; a.lastSound = inp.time + 20; }
          break;
        }
        case 'sleep': if (a.t < 0 && inp.sleepy < 0.5) this.pick(a, inp.lively, inp.sleepy); else if (a.t < 0) a.t = 6; break;
        default: if (a.t < 0) this.pick(a, inp.lively, inp.sleepy);
      }
      // player reactions
      if (inp.player && a.mode !== 'leave' && a.mode !== 'arrive') {
        const dx = a.x - inp.player.x, dz = a.z - inp.player.z, d = Math.hypot(dx, dz);
        if (this.sp.key === 'chicken' && inp.player.speed > 5 && d < 3.5 && a.mode !== 'flee') {
          a.mode = 'flee'; a.t = 0.8 + this.r() * 0.5;
          a.tx = a.x + (dx / (d || 1)) * 3 + (this.r() - 0.5) * 2; a.tz = a.z + (dz / (d || 1)) * 3 + (this.r() - 0.5) * 2;
          if (inp.time - a.lastSound > 1.5) { a.lastSound = inp.time; const p = inp.toWorld(a.x, 0.3, a.z, this._v); inp.sound('cluck', p.x, p.y, p.z); }
          const p = inp.toWorld(a.x, 0.3, a.z, this._v);
          inp.fx?.spawn('puff', p.x, p.y - 0.2, p.z, { vy: 0.3, life: 0.6, size: 0.8, color: 0xfbf6ea });
        }
        if (a.mode === 'flee') { tx = a.tx; tz = a.tz; }
        if (a.friendly && this.sp.key !== 'chicken' && d < 4 && d > 1.4 && inp.player.speed < 2 && (a.mode === 'idle' || a.mode === 'graze') && inp.time > a.lastSound && inp.sleepy < 0.5) {
          a.mode = 'nuzzle'; a.t = 7;
        }
      }

      // steering
      let vx = 0, vz = 0;
      if (speed > 0) {
        const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.05) { vx = (dx / d) * speed; vz = (dz / d) * speed; }
      }
      // separation from herd mates, spots, props, player
      const inPen = a.mode !== 'leave' && a.mode !== 'arrive';
      for (const b of this.animals) {
        if (b === a || b.appear < 0.3 || b.mode === 'gone') continue;
        const dx = a.x - b.x, dz = a.z - b.z, d2 = dx * dx + dz * dz, m = this.sp.r * 1.1;
        if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2), k = (m - d) / m * 1.4; vx += (dx / d) * k; vz += (dz / d) * k; }
      }
      if (inPen) {
        for (const c of this.pen.avoid) {
          const dx = a.x - c.x, dz = a.z - c.z, d2 = dx * dx + dz * dz, m = c.r + this.sp.r * 0.5;
          if (d2 < m * m) { const d = Math.sqrt(d2) || 1e-3, k = (m - d) / m * 2.2; vx += (dx / d) * k; vz += (dz / d) * k; }
        }
      }
      if (inp.player) {
        const dx = a.x - inp.player.x, dz = a.z - inp.player.z, d2 = dx * dx + dz * dz, m = this.sp.r * 0.6 + 0.45;
        if (d2 < m * m) { const d = Math.sqrt(d2) || 1e-3; vx += (dx / d) * 2; vz += (dz / d) * 2; }
      }
      a.x += vx * dt; a.z += vz * dt;
      if (inPen) {
        const mx = hw - 0.5 - this.sp.r * 0.4, mz0 = -hd + 0.5 + this.sp.r * 0.4, mz1 = hd - 1.4;
        a.x = Math.max(-mx, Math.min(mx, a.x)); a.z = Math.max(mz0, Math.min(mz1, a.z));
      }
      const v = Math.hypot(vx, vz);
      a.walk = damp(a.walk, Math.min(1, v / (this.sp.speed * 0.7)), 8, dt);
      a.phase += dt * (3 + v * (this.sp.key === 'chicken' ? 14 : 6));
      if (v > 0.08) a.yaw += wrap(Math.atan2(vx, vz) - a.yaw) * Math.min(1, dt * 7);

      // head / body poses
      let hy = Math.sin(inp.time * 0.4 + a.seed * 9) * 0.35, hp = 0;
      if (a.mode === 'graze') {
        if (this.sp.key === 'chicken') hp = (Math.sin(inp.time * 9 + a.seed * 20) > 0.3 ? 1 : 0.2) * this.sp.graze;
        else hp = this.sp.graze + Math.sin(inp.time * 6 + a.seed) * 0.06;
      }
      if (inp.player && (a.mode === 'idle' || a.mode === 'nuzzle' || (a.mode === 'graze' && a.happy > 0))) {
        const dx = inp.player.x - a.x, dz = inp.player.z - a.z, d = Math.hypot(dx, dz);
        if (d < 5) { hy = Math.max(-1.1, Math.min(1.1, wrap(Math.atan2(dx, dz) - a.yaw))); hp = -0.15; }
        if (a.mode === 'nuzzle' && d < this.sp.r + 0.9) { hp = 0.25 + Math.sin(inp.time * 5) * 0.2; hy *= 0.3; if (this.r() < dt * 0.4) a.happy = Math.max(a.happy, 0.6); }
      }
      const sleep = a.mode === 'sleep' ? 1 : 0;
      a.sleepK = damp(a.sleepK, sleep, 2.5, dt);
      if (a.sleepK > 0.5) { hy = 0.4 * Math.sin(a.seed * 10); hp = 0.35; }
      a.headYaw = damp(a.headYaw, hy, 5, dt);
      a.headPitch = damp(a.headPitch, hp, a.mode === 'graze' && this.sp.key === 'chicken' ? 22 : 5, dt);
      const hopping = a.mode === 'hop' || (a.happy > 1.2);
      a.bob = hopping ? Math.abs(Math.sin(inp.time * 11 + a.seed)) * 0.18 * (this.sp.key === 'cow' ? 0.6 : 1) : a.walk * Math.abs(Math.sin(a.phase)) * 0.04;
      const rolling = this.sp.key === 'pig' && this.pen.mud && (a.x - this.pen.mud.x) ** 2 + ((a.z - this.pen.mud.z) / 0.7) ** 2 < this.pen.mud.r ** 2 && a.mode !== 'walk';
      if (rolling && a.mode === 'idle' && this.r() < dt * 0.5) { a.mode = 'roll'; a.t = 3 + this.r() * 3; }
      a.roll = damp(a.roll, a.mode === 'roll' ? Math.PI * 0.45 * (0.6 + 0.4 * Math.sin(inp.time * 2.5 + a.seed * 7)) : 0, 3, dt);
      if (a.mode === 'roll' && this.r() < dt * 0.6) {
        const p = inp.toWorld(a.x, 0.2, a.z, this._v);
        inp.fx?.spawn('puff', p.x, p.y, p.z, { vx: (this.r() - 0.5), vy: 0.8, vz: (this.r() - 0.5), grav: 3, life: 0.7, size: 0.6, color: 0x6a4a2a });
      }
      // ambient sounds + zzz
      if (a.appear > 0.9 && a.mode !== 'sleep' && inp.time - a.lastSound > 14 && this.r() < dt * 0.04 * (1 + inp.lively)) {
        a.lastSound = inp.time;
        const p = inp.toWorld(a.x, 0.6, a.z, this._v);
        inp.sound(this.sp.sound, p.x, p.y, p.z);
        inp.fx?.spawn('note', p.x, p.y + this.sp.neck[1] * 0.6, p.z, { vy: 0.5, life: 1.3, size: 0.9, color: 0xfff4c0 });
      }
      if (a.sleepK > 0.8 && a.appear > 0.9 && this.r() < dt * 0.55) {
        const p = inp.toWorld(a.x + Math.sin(a.yaw) * this.sp.neck[2] * a.scale, (this.sp.neck[1] * 0.7 + 0.25) * a.scale, a.z + Math.cos(a.yaw) * this.sp.neck[2] * a.scale, this._v);
        inp.fx?.spawn('zzz', p.x, p.y, p.z, { vy: 0.35, vx: 0.08, life: 2.4, size: 0.7 + this.sp.r * 0.8, color: 0xdfe8ff, spin: this.r() * 6 });
      }
    });
  }

  /** write every visible animal's parts into the batches (world = site matrix × local) */
  draw(batches: Batches, site: THREE.Matrix4, season: Season, growth: number): void {
    const sp = this.sp;
    const mat = animalMaterial();
    const bb = batches.get(`${sp.key}:body:${season}`, () => ({ geo: sp.body(season), mat, cap: 64, shadow: true }));
    const bh = batches.get(`${sp.key}:head`, () => ({ geo: sp.head(), mat, cap: 64, shadow: true }));
    const bl = batches.get(`${sp.key}:leg`, () => ({ geo: sp.leg(), mat, cap: 256, shadow: sp.key !== 'chicken' }));
    const young = 0.75 + 0.25 * clamp01(growth * 1.4);
    for (const a of this.animals) {
      if (a.appear < 0.01 || a.mode === 'gone') continue;
      const s = a.scale * young * smooth01(a.appear);
      const sleep = a.sleepK;
      const drop = sleep * sp.legLen * 0.72;
      // body
      Q.setFromEuler(E.set(0, a.yaw, 0, 'YXZ'));
      if (a.roll) Q.multiply(Q2.setFromAxisAngle(FWD, a.roll));
      const squash = 1 + (a.mode === 'hop' ? Math.sin(a.t * 18) * 0.06 : 0) + Math.sin(a.phase * 0.5) * 0.015;
      MB.compose(V.set(a.x, (a.bob - drop - (a.roll ? 0.1 : 0)) * s + 0.0, a.z), Q, S.set(s / Math.sqrt(squash), s * squash, s / Math.sqrt(squash)));
      MB.premultiply(site);
      bb.push(MB, a.tint);
      // head
      const n = sp.neck;
      Q.setFromEuler(E.set(a.headPitch, a.headYaw, 0, 'YXZ'));
      ML.compose(V.set(n[0], n[1], n[2]), Q, ONE);
      M.multiplyMatrices(MB, ML);
      bh.push(M, sp.key === 'pig' ? a.tint : null);
      // legs
      for (let i = 0; i < sp.hips.length; i++) {
        const h = sp.hips[i];
        const pair = sp.hips.length === 2 ? i : (i === 0 || i === 3 ? 0 : 1);
        const swing = Math.sin(a.phase + pair * Math.PI) * 0.55 * a.walk;
        Q.setFromAxisAngle(RX, sleep > 0.5 ? (i < 2 ? -1.2 : 1.2) * sleep : swing);
        ML.compose(V.set(h[0], h[1], h[2]), Q, S.set(1, 1 - sleep * 0.45, 1));
        M.multiplyMatrices(MB, ML);
        bl.push(M, sp.key === 'pig' ? a.tint : null);
      }
    }
  }

  /** world head position of an animal (interactables) */
  headPos(a: Animal, site: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
    const s = a.scale;
    out.set(a.x + Math.sin(a.yaw) * a.sp.neck[2] * s, a.sp.neck[1] * s * (1 - a.sleepK * 0.4) + 0.1, a.z + Math.cos(a.yaw) * a.sp.neck[2] * s);
    return out.applyMatrix4(site);
  }
}

let animalMat: THREE.Material | null = null;
export const animalMaterial = () => (animalMat ??= toon(0xffffff, { vertexColors: true }));

const Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1), RX = new THREE.Vector3(1, 0, 0), FWD = new THREE.Vector3(0, 0, 1);
const MB = new THREE.Matrix4(), ML = new THREE.Matrix4(), M = new THREE.Matrix4();

/** A standalone animal model (gallery): body + head + legs as one merged mesh at rest. */
export function animalModel(key: SpeciesKey, season: Season): THREE.Group {
  const sp = SPECIES[key];
  const g = new THREE.Group();
  const mat = animalMaterial();
  const tinted = toon(sp.tints[0], { vertexColors: true });
  const body = new THREE.Mesh(sp.body(season), tinted);
  const head = new THREE.Mesh(sp.head(), key === 'pig' ? tinted : mat);
  head.position.set(...sp.neck);
  body.add(head);
  for (const h of sp.hips) { const l = new THREE.Mesh(sp.leg(), key === 'pig' ? tinted : mat); l.position.set(...h); body.add(l); }
  g.add(body);
  g.userData.parts = { body, head };
  return g;
}
