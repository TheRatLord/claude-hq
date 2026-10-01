/**
 * The pen herds: cows, sheep, pigs and chickens (with chicks and eggs) acting out their day. Each animal runs a small
 * activity machine (behavior.ts) — graze, look around, wander with the flock, drink at the trough, scratch on a fence
 * post, shake, call, roll in mud, dust-bathe, brood, lie down and sleep in the shelter at night — and reacts to the
 * player (heads follow you, the curious ones come over, hens scatter when you sprint, petting makes them lean in with
 * happy eyes, wag and hop). Every pose channel is a critically damped spring so nothing pops; legs step with the
 * distance-driven gait in gait.ts so hooves plant without sliding.
 *
 * Coordinates are site-local metres (x across, z toward the gate); the Herd draws into shared instance batches with
 * the site matrix. Nothing here allocates per frame.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import type { SfxName } from '../context.ts';
import type { Batch, Batches } from './batch.ts';
import type { Fx } from './fx.ts';
import { rng } from './geo.ts';
import { BEASTS, CHICK_J, chickBody, chickLeg, eggGeo, pickCoat } from './beasts.ts';
import type { BeastDef } from './beasts.ts';
import { choose, interruptible, LYING } from './behavior.ts';
import type { Act, BeastKey, Dest, Mood } from './behavior.ts';
import { clamp, footAt, frac, headHold, LIE_TIME, lieStage, phaseStep, rhythm, smoothstep, solveLeg, spring, springAngle, springTo, strideAmp, strideLen, wrapAngle } from './gait.ts';
import type { FootOut, LegSolve, Rhythm, Spring } from './gait.ts';
import { rigDepthMaterial, rigMaterial } from './rig.ts';

export type SpeciesKey = BeastKey;
export { BEASTS as SPECIES };

type Life = 'arrive' | 'live' | 'leave' | 'gone';
type Stage = 'go' | 'turn' | 'do' | 'climb' | 'inside' | 'exit';
type React = 'none' | 'flee' | 'approach' | 'petted';

const TAU = Math.PI * 2;

export class Animal {
  readonly id: string;
  readonly name: string;
  readonly def: BeastDef;
  /** species key (kept as `sp` for callers) */
  get sp(): BeastDef { return this.def; }
  x = 0; z = 0; yaw = 0; ay = 0;
  tx = 0; tz = 0; face = NaN;
  life: Life = 'live';
  act: Act = 'idle'; dur = 3; t = 0; stage: Stage = 'do'; goT = 0; dest: Dest = 'none';
  react: React = 'none'; reactT = 0; fx = 0; fz = 0;
  lying = false; lieDir = 0; lieT = 0; front = 0; hind = 0;
  speed = spring(); yawRate = spring(); pushX = 0; pushZ = 0;
  phase = 0; gaitV = 0; walkK = spring();
  // pose springs
  bodyY = spring(); pitch = spring(); roll = spring(); lean = spring(); surge = spring(); side = spring();
  headYaw = spring(); neck = spring(); nod = spring(); tilt = spring(); headFwd = spring();
  jaw = spring(); earL = spring(); earR = spring(); tail = spring(); tailLift = spring(); wingL = spring(); wingR = spring();
  squash = spring(1); fluff = spring(1); eyes = spring(); wiggle = spring();
  relax = spring();
  // timers
  blinkT = 1; blinkK = 0; lookT = 0; lookYaw = 0; lookPitch = 0; swishT = 9; earT = 2; hopT = -1; soundT = 0; zzzT = 0;
  sub = 0; subT = 0; pecks = 0; kickL = 0; kickR = 0; scratchSide = 1; called = false;
  // looks
  readonly tint = new THREE.Color();
  pattern = 0; patSeed = 0; dirt = 0;
  scale = 1; appear = 1; seed = 0; lastSound = -99; friendly = false; happy = 0;
  chase: Animal | null = null;
  /** chicken: a mother with chicks keeps them close */
  mother = false;
  eggDue = false;

  constructor(id: string, name: string, def: BeastDef) { this.id = id; this.name = name; this.def = def; }
  /** 0..1 how asleep (for the plots service) */
  get sleepK(): number { return this.act === 'sleep' && (this.lying || this.stage === 'inside') ? 1 : 0; }
  /** legacy mode name for other packages */
  get mode(): string { return this.life === 'gone' ? 'gone' : this.life === 'leave' ? 'leave' : this.act; }
}

interface Chick {
  x: number; z: number; yaw: number; ay: number;
  mom: Animal; slot: number; phase: number; speed: number;
  head: Spring; bob: number; peckT: number; peck: number; blinkT: number; blink: number; hidden: Spring; hop: number;
  wing: Spring;
}

export interface LureSpot { x: number; z: number; yaw: number; h: number }
export interface Pen {
  hw: number; hd: number;
  /** keep-out circles (spots and props) in site-local coords */
  avoid: { x: number; z: number; r: number }[];
  /** where the mud is (pigs roll there) */
  mud?: { x: number; z: number; r: number };
  /** troughs / hay (drink, eat): stand at (x, z) facing yaw, food at height h */
  lure: LureSpot[];
  /** where they sleep (near the shelter), facing yaw */
  beds: { x: number; z: number; yaw: number }[];
  /** fence posts to scratch on: the post and the inward normal */
  posts: { x: number; z: number; nx: number; nz: number }[];
  /** straw nests (hens brood, eggs) */
  nests: { x: number; z: number }[];
  /** chicken coop ramp: foot (ground) and door (top) */
  coop?: { fx: number; fz: number; dx: number; dz: number; dy: number };
}

export interface HerdInput {
  dt: number; time: number;
  /** 0 calm … 1 lively (vigor/thriving) */
  lively: number;
  /** 0..1 how sleepy (resting stage, night) */
  sleepy: number;
  /** player in site-local coords; `near` false when far away */
  player: { x: number; z: number; speed: number; near: boolean };
  /** intro: 0..1 of the arrival; harvest: 0..1 of the leaving */
  arrive: number;
  leave: number;
  /** growth 0..1 */
  growth: number;
  /** direction (site-local, unit) toward the barn */
  barn: { x: number; z: number };
  fx: Fx | null;
  /** site matrix (local → world) */
  site: THREE.Matrix4;
  sound(name: SfxName, x: number, y: number, z: number, volume?: number): void;
}

/** A scripted loop for the gallery: the same Herd code, one activity on repeat. */
export type Script = 'walk' | 'trot' | 'graze' | 'idle' | 'lie' | 'sleep' | 'pet' | 'scratch' | 'shake' | 'call' | 'roll' | 'root' | 'dust' | 'stretch' | 'chase' | 'brood' | 'flee' | 'chicks';

const P0 = new THREE.Vector3();
const LS = { front: 0, hind: 0 };
/** gallery loop scale per species */
const GK: Record<BeastKey, number> = { cow: 1, sheep: 0.7, pig: 0.68, chicken: 0.42 };

export class Herd {
  readonly animals: Animal[] = [];
  readonly chicks: Chick[] = [];
  readonly eggs: { nest: number; a: number; r: number; laid: number; brown: boolean }[] = [];
  readonly def: BeastDef;
  readonly pen: Pen;
  readonly plotId: string;
  /** gallery loop */
  script: Script | null = null;
  private readonly r: () => number;
  private readonly mood: Mood = { sleepy: 0, lively: 0.5, dirt: 0, hasMud: false, hasNests: false, hasPosts: false };
  private inp: HerdInput | null = null;
  private eggBase = 0;
  private clock = 0;

  get sp(): BeastDef { return this.def; }

  constructor(key: BeastKey, pen: Pen, plotId: string, count: number, preplaced: boolean) {
    this.def = BEASTS[key]; this.pen = pen; this.plotId = plotId;
    this.r = rng(`herd:${plotId}`);
    this.mood.hasMud = !!pen.mud; this.mood.hasNests = pen.nests.length > 0; this.mood.hasPosts = pen.posts.length > 0;
    const used = new Set<number>();
    const d = this.def;
    for (let i = 0; i < count; i++) {
      const rr = rng(`${plotId}:${key}:${i}`);
      let ni = Math.floor(rr() * d.names.length);
      while (used.has(ni) && used.size < d.names.length) ni = (ni + 1) % d.names.length;
      used.add(ni);
      const a = new Animal(`${plotId}:${key}:${i}`, d.names[ni], d);
      const p = this.randomPoint(a);
      a.x = p.x; a.z = p.z; a.tx = p.x; a.tz = p.z; a.yaw = rr() * TAU;
      a.seed = rr(); a.scale = 0.88 + rr() * 0.22; a.friendly = rr() < 0.45;
      const coat = pickCoat(d, rr());
      a.tint.set(coat.tint); a.pattern = coat.pattern; a.patSeed = rr() * 10;
      a.t = rr() * 3; a.dur = 1 + rr() * 3; a.blinkT = rr() * 3; a.lookT = rr() * 2;
      a.phase = rr();
      if (key === 'pig' && rr() < 0.35) a.dirt = 0.3 + rr() * 0.5;
      if (!preplaced) { a.life = 'arrive'; a.appear = 0; a.x = (rr() - 0.5) * 2; a.z = pen.hd + 3 + i * 1.1; a.yaw = Math.PI; }
      a.mother = key === 'chicken' && (i === 0 || i === 3);
      this.animals.push(a);
    }
    if (key === 'chicken') {
      let slot = 0;
      for (const m of this.animals) if (m.mother) for (let k = 0; k < 3; k++) {
        this.chicks.push({ x: m.x - 0.3 - k * 0.1, z: m.z, yaw: m.yaw, ay: 0, mom: m, slot: slot++, phase: k * 0.3, speed: 0, head: spring(), bob: 0, peckT: k * 0.7, peck: 0, blinkT: k, blink: 0, hidden: spring(m.life === 'arrive' ? 1 : 0), hop: 0, wing: spring() });
      }
      pen.nests.forEach((_, ni) => { for (let k = 0; k < 6; k++) { const rr = this.r(); this.eggs.push({ nest: ni, a: (k / 6) * TAU + rr * 0.5, r: 0.14 + (k % 2) * 0.1, laid: 0, brown: rr < 0.35 }); } });
    }
  }

  private randomPoint(a: Animal | null, near?: { x: number; z: number; r: number }): { x: number; z: number } {
    const { hw, hd } = this.pen;
    const rad = (a?.def ?? this.def).r, len = (a?.def ?? this.def).len;
    for (let k = 0; k < 40; k++) {
      let x: number, z: number;
      if (near) { const ang = this.r() * TAU, d = Math.sqrt(this.r()) * near.r; x = near.x + Math.cos(ang) * d; z = near.z + Math.sin(ang) * d; }
      else { x = (this.r() * 2 - 1) * (hw - 1.0 - len * 0.6); z = -hd + 1.0 + len * 0.5 + this.r() * (hd * 2 - 3.2 - len); }
      if (Math.abs(x) > hw - 0.6 - rad || z < -hd + 0.6 + rad || z > hd - 1.6) continue;
      let ok = true;
      for (const c of this.pen.avoid) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + rad + 0.25) ** 2) { ok = false; break; }
      if (ok) return { x, z };
    }
    return { x: near?.x ?? 0, z: near?.z ?? 0 };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Deciding

  private begin(a: Animal, act: Act, dur: number, dest: Dest): void {
    a.act = act; a.dur = dur; a.t = 0; a.goT = 0; a.sub = 0; a.subT = 0; a.pecks = 0; a.called = false; a.face = NaN; a.dest = dest;
    a.chase = null;
    let go = true;
    const pen = this.pen, d = a.def;
    switch (dest) {
      case 'wander': { const p = this.randomPoint(a); a.tx = p.x; a.tz = p.z; break; }
      case 'flock': {
        let cx = 0, cz = 0, n = 0;
        for (const b of this.animals) if (b !== a && b.appear > 0.5 && b.life === 'live') { cx += b.x; cz += b.z; n++; }
        const p = n ? this.randomPoint(a, { x: cx / n, z: cz / n, r: 1.2 + d.r * 3 }) : this.randomPoint(a);
        a.tx = p.x; a.tz = p.z; break;
      }
      case 'post': {
        const post = pen.posts[Math.floor(this.r() * pen.posts.length)];
        if (!post) { go = false; break; }
        // stand beside the post, flank against it, rubbing the hip
        const side = this.r() < 0.5 ? 1 : -1;
        const tx = -post.nz * side, tz = post.nx * side; // along the fence
        const off = d.r + 0.12;
        a.tx = post.x + post.nx * off - tx * (d.len * 0.25); a.tz = post.z + post.nz * off - tz * (d.len * 0.25);
        a.face = Math.atan2(tx, tz);
        // post on the animal's left (+x local) when the inward normal points to its right
        a.scratchSide = (Math.cos(a.face) * -post.nx + Math.sin(a.face) * post.nz) > 0 ? 1 : -1;
        break;
      }
      case 'mud': { const m = pen.mud; if (!m) { go = false; break; } const p = this.randomPoint(null, { x: m.x, z: m.z, r: m.r * 0.5 }); a.tx = m.x + (p.x - m.x) * 0.4; a.tz = m.z + (p.z - m.z) * 0.4; break; }
      case 'bed': {
        if (pen.coop && d.key === 'chicken') { a.tx = pen.coop.fx; a.tz = pen.coop.fz + 0.1; a.face = Math.PI; break; }
        const i = this.animals.indexOf(a);
        const b = pen.beds[i % Math.max(1, pen.beds.length)];
        if (!b) { go = false; break; }
        a.tx = b.x; a.tz = b.z; a.face = b.yaw; break;
      }
      case 'nest': { const nst = pen.nests[Math.floor(this.r() * pen.nests.length)]; if (!nst) { go = false; break; } a.tx = nst.x; a.tz = nst.z; a.face = this.r() * TAU; break; }
      case 'lure': {
        const l = pen.lure[Math.floor(this.r() * pen.lure.length)];
        if (!l) { go = false; break; }
        const reach = d.neck[2] + d.mouth[2] * 0.7;
        a.tx = l.x - Math.sin(l.yaw) * reach; a.tz = l.z - Math.cos(l.yaw) * reach; a.face = l.yaw;
        a.fx = l.h;
        break;
      }
      default: go = false;
    }
    if (act === 'chase') {
      let best: Animal | null = null, bd = 1e9;
      for (const b of this.animals) {
        if (b === a || b.life !== 'live' || b.lying || b.stage === 'inside' || b.appear < 0.8) continue;
        const dd = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
        if (dd < bd && dd > 0.2) { bd = dd; best = b; }
      }
      a.chase = best;
      if (!best) { a.act = 'look'; }
    }
    a.stage = go ? 'go' : 'do';
    if (a.act === 'wander') a.dur = 0.1;
  }

  private next(a: Animal, inp: HerdInput): void {
    if (this.script) { this.scripted(a, inp); return; }
    this.mood.sleepy = inp.sleepy; this.mood.lively = inp.lively; this.mood.dirt = a.dirt;
    const p = choose(a.def.key, this.mood, this.r);
    // hens: brood only when a nest has room; lay an egg at the end
    if (p.act === 'brood') a.eggDue = this.r() < 0.7;
    this.begin(a, p.act, p.dur, p.dest);
  }

  /** gallery loops */
  private scripted(a: Animal, inp: HerdInput): void {
    const s = this.script!;
    const d = a.def;
    void inp;
    switch (s) {
      case 'walk': case 'trot': case 'flee': {
        const k = a.tx > 0 ? -1 : 1, span = (s === 'walk' ? 2.2 : 3.2) * GK[d.key];
        this.begin(a, 'wander', 0.1, 'none');
        a.tx = k * span; a.tz = 0; a.stage = 'go';
        break;
      }
      case 'lie': this.begin(a, a.lying ? 'idle' : 'rest', a.lying ? 2.5 : 5, 'none'); break;
      case 'sleep': this.begin(a, 'sleep', 30, 'none'); break;
      case 'graze': this.begin(a, 'graze', 20, 'none'); break;
      case 'idle': this.begin(a, a.act === 'look' ? 'idle' : 'look', 4, 'none'); break;
      case 'pet': this.begin(a, 'idle', 30, 'none'); break;
      case 'scratch': this.begin(a, 'scratch', 30, 'none'); a.scratchSide = 1; break;
      case 'shake': this.begin(a, a.act === 'shake' ? 'idle' : 'shake', a.act === 'shake' ? 1.2 : 1.4, 'none'); break;
      case 'call': this.begin(a, a.act === 'call' ? 'idle' : 'call', a.act === 'call' ? 1.2 : 1.6, 'none'); break;
      case 'roll': this.begin(a, 'roll', 30, 'none'); break;
      case 'root': this.begin(a, 'root', 30, 'none'); break;
      case 'dust': this.begin(a, 'dust', 30, 'none'); break;
      case 'stretch': this.begin(a, a.act === 'stretch' ? 'idle' : 'stretch', a.act === 'stretch' ? 0.8 : 1.8, 'none'); break;
      case 'brood': this.begin(a, 'brood', 30, 'none'); break;
      case 'chase': case 'chicks': {
        const k = a.tx > 0 ? -1 : 1;
        this.begin(a, 'wander', 0.1, 'none'); a.tx = k * 2.2 * GK[d.key]; a.tz = (this.animals.indexOf(a) - 0.5) * 0.6; a.stage = 'go';
        break;
      }
    }
  }

  /** the player pets `a` */
  pet(a: Animal): void {
    const inp = this.inp;
    a.react = 'petted'; a.reactT = 0; a.happy = 2.6;
    if (!a.lying) { a.speed.x = 0; a.speed.v = 0; }
    if (!inp) return;
    const s = this.worldScale(a, inp);
    this.local(a, a.def.neck[1] * s + 0.35 * s, P0);
    const fx = inp.fx;
    if (fx) for (let i = 0; i < 5; i++) fx.spawn('heart', P0.x + (this.r() - 0.5) * 0.35, P0.y + i * 0.07, P0.z + (this.r() - 0.5) * 0.35, { vy: 0.55 + this.r() * 0.35, life: 1.6 + this.r() * 0.5, size: 1 + this.r() * 0.5, color: this.r() < 0.5 ? 0xff5a7a : 0xff8aa8, spin: this.r() * 6 });
    inp.sound('pet', P0.x, P0.y, P0.z);
    inp.sound(a.def.sound, P0.x, P0.y, P0.z);
    a.lastSound = inp.time;
  }

  private worldScale(a: Animal, inp: HerdInput): number {
    return a.def.size * a.scale * (0.78 + 0.22 * clamp(inp.growth * 1.4, 0, 1));
  }

  /** site-local point above the animal (y in metres) → world into `out` */
  private local(a: Animal, y: number, out: THREE.Vector3, fwd = 0): THREE.Vector3 {
    return out.set(a.x + Math.sin(a.yaw) * fwd, a.ay + y, a.z + Math.cos(a.yaw) * fwd).applyMatrix4(this.inp!.site);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Per frame

  update(inp: HerdInput): void {
    this.inp = inp;
    this.clock += inp.dt;
    const n = this.animals.length;
    const want = Math.max(1, Math.ceil(n * (0.55 + 0.45 * inp.growth)));
    for (let i = 0; i < n; i++) this.step(this.animals[i], i, inp, i < want || inp.leave > 0 || !!this.script);
    this.stepChicks(inp);
    this.eggBase = Math.floor(clamp(inp.growth, 0, 1) * 3.5);
  }

  private step(a: Animal, idx: number, inp: HerdInput, active: boolean): void {
    const dt = inp.dt, d = a.def, pen = this.pen, n = this.animals.length;
    a.happy = Math.max(0, a.happy - dt);
    // lifecycle
    if (inp.leave > 0 && a.life !== 'leave' && a.life !== 'gone' && inp.leave > (idx / n) * 0.25) {
      a.life = 'leave'; a.react = 'none';
      if (a.stage === 'inside' || a.stage === 'climb') { a.stage = 'do'; a.x = pen.coop!.fx; a.z = pen.coop!.fz; a.ay = 0; }
      if (a.lying) { a.lying = false; a.lieDir = -1; a.lieT = 0; }
    }
    if (a.life === 'gone') { a.appear = 0; return; }
    if (a.life === 'arrive') {
      const start = (idx / Math.max(1, n)) * 0.45;
      if (inp.arrive <= start) { a.appear = 0; return; }
      a.appear += (1 - a.appear) * (1 - Math.exp(-6 * dt));
    } else if (a.life === 'leave') { /* fades below */ }
    else if (a.stage !== 'inside') a.appear += ((active ? 1 : 0) - a.appear) * (1 - Math.exp(-2 * dt));
    if (a.appear < 0.01 && a.life === 'live' && !active) return;

    // posture transitions
    if (a.lieDir !== 0) {
      a.lieT += dt;
      const down = a.lieDir > 0;
      const st = lieStage(d.lie, down, a.lieT, LS);
      a.front = st.front; a.hind = st.hind;
      if (a.lieT >= LIE_TIME[d.lie][down ? 'down' : 'up']) { a.lying = down; a.lieDir = 0; }
    }
    const busy = a.lieDir !== 0;

    // ---- what do we want to do this frame
    let tx = a.x, tz = a.z, want = 0, faceYaw = NaN, steer = false;
    const pl = inp.player;
    if (a.life === 'arrive') {
      const outside = a.z > pen.hd - 1.5;
      tx = outside ? 0 : a.tx; tz = outside ? pen.hd - 2.2 : a.tz; want = d.trot; steer = true;
      if (!outside && (a.x - a.tx) ** 2 + (a.z - a.tz) ** 2 < 0.3) { a.life = 'live'; a.hopT = 0; this.next(a, inp); }
    } else if (a.life === 'leave') {
      a.t += dt;
      const outside = a.z > pen.hd + 0.5;
      if (!outside) { tx = 0; tz = pen.hd + 2; } else { tx = a.x + inp.barn.x * 5; tz = a.z + inp.barn.z * 5; }
      want = d.trot * 1.3; steer = true;
      if (a.z > pen.hd + 4) a.appear += (0 - a.appear) * (1 - Math.exp(-2.5 * dt));
      if (a.appear < 0.02 && a.z > pen.hd + 4) {
        this.local(a, 0.3, P0);
        inp.fx?.spawn('puff', P0.x, P0.y, P0.z, { vy: 0.4, life: 0.8, size: 2, color: 0xe8dcc0 });
        a.life = 'gone';
        return;
      }
    } else {
      // reactions to the player first
      this.react(a, inp);
      if (a.react === 'flee') { tx = a.fx; tz = a.fz; want = d.flee; steer = true; }
      else if (a.react === 'approach') {
        const dd = Math.hypot(pl.x - a.x, pl.z - a.z);
        tx = pl.x; tz = pl.z; want = dd > d.len + 1.1 ? d.walk * 1.2 : 0; steer = want > 0; faceYaw = Math.atan2(pl.x - a.x, pl.z - a.z);
      } else if (a.react === 'petted') {
        if (!a.lying && !busy) faceYaw = a.yaw + clamp(wrapAngle(Math.atan2(pl.x - a.x, pl.z - a.z) - a.yaw), -0.5, 0.5);
      } else {
        // the activity
        if (a.stage === 'go') {
          if (a.lying || busy) { /* get up first */ } else {
            a.goT += dt;
            tx = a.tx; tz = a.tz; steer = true;
            want = a.act === 'chase' ? d.trot : a.dest === 'bed' && inp.sleepy > 0.5 ? d.walk : d.walk * (0.85 + inp.lively * 0.3);
            if (this.script === 'trot' || this.script === 'flee') want = this.script === 'flee' ? d.flee : d.trot;
            const dd = Math.hypot(a.tx - a.x, a.tz - a.z);
            const coop = a.dest === 'bed' && !!pen.coop && d.key === 'chicken';
            if (coop) want = d.trot * 0.7;
            if (dd < (coop ? 0.45 : 0.12 + d.r * 0.25) || a.goT > 25) {
              a.stage = Number.isFinite(a.face) ? 'turn' : 'do';
              if (a.act === 'wander') this.next(a, inp);
            }
          }
        } else if (a.stage === 'turn') {
          faceYaw = a.face;
          if (Math.abs(wrapAngle(a.face - a.yaw)) < 0.12) a.stage = 'do';
          a.goT += dt; if (a.goT > 30) a.stage = 'do';
        } else if (a.stage === 'climb' && pen.coop) {
          tx = pen.coop.dx; tz = pen.coop.dz; want = d.walk; steer = true;
          if (Math.hypot(tx - a.x, tz - a.z) < 0.1) { a.stage = 'inside'; }
        } else if (a.stage === 'inside') {
          a.appear += (0 - a.appear) * (1 - Math.exp(-5 * dt));
          a.t += dt;
          if (a.t > a.dur && inp.sleepy < 0.5) { a.stage = 'exit'; a.yaw = 0; }
        } else if (a.stage === 'exit' && pen.coop) {
          a.appear += (1 - a.appear) * (1 - Math.exp(-5 * dt));
          tx = pen.coop.fx; tz = pen.coop.fz + 0.4; want = d.walk; steer = true;
          if (Math.hypot(tx - a.x, tz - a.z) < 0.15) this.next(a, inp);
        } else {
          // doing it
          const needLie = LYING.has(a.act) && !(a.act === 'sleep' && pen.coop && d.key === 'chicken');
          if (a.lieDir === 0) {
            if (needLie && !a.lying) { a.lieDir = 1; a.lieT = 0; }
            else if (!needLie && a.lying) { a.lieDir = -1; a.lieT = 0; }
          }
          if (a.act === 'sleep' && pen.coop && d.key === 'chicken' && !this.script) { a.stage = 'climb'; a.t = 0; }
          else if (a.lieDir === 0) {
            a.t += dt;
            const w = this.perform(a, inp);
            if (w) { tx = w.x; tz = w.z; want = w.v; steer = true; }
            if (a.t > a.dur && !(a.act === 'sleep' && inp.sleepy > 0.5 && !this.script)) this.finish(a, inp);
          }
        }
      }
    }

    this.move(a, inp, steer ? tx : NaN, tz, want, faceYaw, busy || (a.lying && a.react !== 'flee'));
    this.pose(a, inp, busy);
    this.effects(a, inp);
  }

  private finish(a: Animal, inp: HerdInput): void {
    if (a.act === 'brood' && a.eggDue) {
      a.eggDue = false;
      // lay an egg in the nearest nest
      let best = -1, bd = 1e9;
      this.pen.nests.forEach((nst, i) => { const dd = (nst.x - a.x) ** 2 + (nst.z - a.z) ** 2; if (dd < bd) { bd = dd; best = i; } });
      const egg = this.eggs.find((e) => e.nest === best && !e.laid && this.eggs.indexOf(e) % 6 >= this.eggBase);
      if (egg && bd < 1) {
        egg.laid = 1;
        const nst = this.pen.nests[best];
        P0.set(nst.x, 0.25, nst.z).applyMatrix4(inp.site);
        for (let k = 0; k < 5; k++) inp.fx?.spawn('sparkle', P0.x + (this.r() - 0.5) * 0.4, P0.y + 0.1, P0.z + (this.r() - 0.5) * 0.4, { vy: 0.5, life: 0.9, color: 0xfff0b0 });
        inp.sound('pop', P0.x, P0.y, P0.z, 0.6);
        inp.sound('cluck', P0.x, P0.y, P0.z);
      }
    }
    this.next(a, inp);
  }

  /** player reactions: flee a sprinting player (hens), come over when friendly, finish petting */
  private react(a: Animal, inp: HerdInput): void {
    const pl = inp.player, d = a.def;
    if (a.react !== 'none') a.reactT += inp.dt;
    if (a.react === 'petted' && a.reactT > 2.4) { a.react = 'none'; a.lastSound = inp.time + 4; }
    if (a.react === 'flee' && a.reactT > 1.4) { a.react = 'none'; a.hopT = -1; if (a.act === 'chase') this.next(a, inp); }
    if (a.react === 'approach' && (!pl.near || a.reactT > 9 || inp.sleepy > 0.5)) { a.react = 'none'; a.lastSound = inp.time + 25; }
    if (!pl.near || a.stage === 'inside' || a.stage === 'climb' || this.script) return;
    const dx = a.x - pl.x, dz = a.z - pl.z, dist = Math.hypot(dx, dz);
    if (d.key === 'chicken' && pl.speed > 4.5 && dist < 3.6 && a.react !== 'flee') {
      this.scatter(a, pl.x, pl.z, inp);
      return;
    }
    if (a.react === 'none' && a.friendly && d.key !== 'chicken' && dist < 4.5 && dist > d.len + 1.3 && pl.speed < 2 && !a.lying && a.lieDir === 0 &&
      interruptible(a.act) && inp.time > a.lastSound && inp.sleepy < 0.5) { a.react = 'approach'; a.reactT = 0; }
  }

  /** run away from (x, z) flapping */
  scatter(a: Animal, x: number, z: number, inp: HerdInput): void {
    const dx = a.x - x, dz = a.z - z, dist = Math.hypot(dx, dz) || 1;
    a.react = 'flee'; a.reactT = 0;
    a.fx = a.x + (dx / dist) * 3 + (this.r() - 0.5) * 2.4; a.fz = a.z + (dz / dist) * 3 + (this.r() - 0.5) * 2.4;
    if (a.lying) { a.lying = false; a.lieDir = -1; a.lieT = LIE_TIME[a.def.lie].up * 0.5; }
    a.hopT = 0;
    this.local(a, 0.25, P0);
    if (inp.time - a.lastSound > 1.2) { a.lastSound = inp.time; inp.sound(a.def.sound, P0.x, P0.y, P0.z); }
    inp.fx?.spawn('puff', P0.x, P0.y, P0.z, { vy: 0.4, life: 0.6, size: 0.7, color: a.tint.getHex() });
    for (let k = 0; k < 3; k++) inp.fx?.spawn('puff', P0.x, P0.y + 0.1, P0.z, { vx: (this.r() - 0.5) * 1.2, vy: 0.9, vz: (this.r() - 0.5) * 1.2, grav: 2.5, life: 0.9, size: 0.35, color: a.tint.getHex(), spin: 5 });
  }

  /** activity-specific movement (returns a walk target) and sub-state */
  private readonly _w = { x: 0, z: 0, v: 0 };
  private perform(a: Animal, inp: HerdInput): { x: number; z: number; v: number } | null {
    const d = a.def, dt = inp.dt;
    a.subT += dt;
    switch (a.act) {
      case 'graze': {
        if (d.key === 'chicken') return this.peck(a, inp);
        // head-down grazing with slow steps forward; now and then lift the head to look around, still chewing
        if (a.sub === 0 && a.subT > 2.5 + a.seed * 3) { a.sub = this.r() < 0.55 ? 1 : 2; a.subT = 0; }
        if (a.sub === 1) {
          this._w.x = a.x + Math.sin(a.yaw + (a.seed - 0.5) * 0.25) * 2; this._w.z = a.z + Math.cos(a.yaw + (a.seed - 0.5) * 0.25) * 2; this._w.v = d.walk * 0.35;
          if (a.subT > 1.4) { a.sub = 0; a.subT = 0; }
          return this._w;
        }
        if (a.sub === 2 && a.subT > 1.8) { a.sub = 0; a.subT = 0; }
        return null;
      }
      case 'root': {
        this._w.x = a.x + Math.sin(a.yaw) * 2; this._w.z = a.z + Math.cos(a.yaw) * 2; this._w.v = d.walk * 0.12 * (0.5 + 0.5 * Math.sin(a.t * 1.3));
        if (Math.sin(a.t * 7) > 0.95 && this.r() < 0.3) { this.local(a, 0.05, P0, (d.neck[2] + 0.45) * this.worldScale(a, inp)); inp.fx?.spawn('puff', P0.x, P0.y, P0.z, { vx: (this.r() - 0.5) * 0.8, vy: 0.9, vz: (this.r() - 0.5) * 0.8, grav: 4, life: 0.6, size: 0.4, color: 0x7a5a3a }); }
        return this._w;
      }
      case 'chase': {
        const b = a.chase;
        if (!b || b.life !== 'live') { a.t = a.dur; return null; }
        const dd = Math.hypot(b.x - a.x, b.z - a.z);
        if (dd < 0.55 && b.react !== 'flee') this.scatter(b, a.x, a.z, inp);
        this._w.x = b.x; this._w.z = b.z; this._w.v = dd > 0.35 ? d.trot : 0;
        return this._w;
      }
      case 'roll': {
        a.dirt = Math.min(1, a.dirt + dt * 0.12);
        if (this.r() < dt * 3) { this.local(a, 0.15, P0); inp.fx?.spawn('puff', P0.x + (this.r() - 0.5) * 0.6, P0.y, P0.z + (this.r() - 0.5) * 0.6, { vx: (this.r() - 0.5) * 1.4, vy: 1.3, vz: (this.r() - 0.5) * 1.4, grav: 5, life: 0.7, size: 0.5, color: 0x5a3b22, spin: 4 }); }
        return null;
      }
      case 'dust': {
        if (this.r() < dt * 5) { this.local(a, 0.1, P0); inp.fx?.spawn('puff', P0.x + (this.r() - 0.5) * 0.3, P0.y, P0.z + (this.r() - 0.5) * 0.3, { vx: (this.r() - 0.5) * 0.8, vy: 0.7, vz: (this.r() - 0.5) * 0.8, grav: 1.2, life: 0.9, size: 0.55, color: 0xd8c090 }); }
        return null;
      }
      case 'shake': {
        if (a.subT > 0.35 && a.sub === 0) {
          a.sub = 1;
          this.local(a, d.cog[1] * this.worldScale(a, inp), P0);
          const col = d.key === 'pig' && a.dirt > 0.1 ? 0x5a3b22 : d.key === 'sheep' ? 0xf8f3e6 : a.tint.getHex();
          for (let k = 0; k < 6; k++) inp.fx?.spawn('puff', P0.x, P0.y, P0.z, { vx: (this.r() - 0.5) * 2.2, vy: 0.8 + this.r(), vz: (this.r() - 0.5) * 2.2, grav: 4, life: 0.7, size: d.key === 'chicken' ? 0.3 : 0.55, color: col, spin: 5 });
          if (d.key === 'pig') a.dirt *= 0.4;
        }
        return null;
      }
      case 'call': {
        if (!a.called && a.t > 0.2) {
          a.called = true; a.lastSound = inp.time;
          this.local(a, (d.neck[1] + 0.3) * this.worldScale(a, inp), P0, d.neck[2] * this.worldScale(a, inp));
          inp.sound(d.sound, P0.x, P0.y, P0.z);
          inp.fx?.spawn('note', P0.x, P0.y + 0.2, P0.z, { vy: 0.5, life: 1.3, size: 0.9, color: 0xfff4c0 });
        }
        return null;
      }
      default: return null;
    }
  }

  /** chicken foraging: look → (scratch) → peck bursts → a few steps */
  private peck(a: Animal, inp: HerdInput): { x: number; z: number; v: number } | null {
    const d = a.def;
    switch (a.sub) {
      case 0: // scan
        if (a.subT > 0.5 + a.seed * 0.8) { a.sub = this.r() < 0.3 ? 3 : 1; a.subT = 0; a.pecks = 2 + Math.floor(this.r() * 4); }
        return null;
      case 1: // peck burst: each peck 0.26 s
        if (a.subT > a.pecks * 0.26 + 0.1) { a.sub = this.r() < 0.55 ? 2 : 0; a.subT = 0; a.face = a.yaw + (this.r() - 0.5) * 2; }
        return null;
      case 2: { // a few steps
        this._w.x = a.x + Math.sin(a.face) * 1; this._w.z = a.z + Math.cos(a.face) * 1; this._w.v = d.walk * 0.9;
        if (a.subT > 0.45 + a.seed * 0.4) { a.sub = 0; a.subT = 0; }
        return this._w;
      }
      case 3: // scratch the ground: kick back left, right, left, then peck
        if (a.subT > 0.9) { a.sub = 1; a.subT = 0; }
        return null;
    }
    void inp;
    return null;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Moving

  private move(a: Animal, inp: HerdInput, tx: number, tz: number, want: number, faceYaw: number, planted: boolean): void {
    const dt = inp.dt, d = a.def, pen = this.pen;
    const s = this.worldScale(a, inp);
    let desired = a.yaw, spd = 0;
    if (Number.isFinite(tx)) {
      const dx = tx - a.x, dz = tz - a.z, dist = Math.hypot(dx, dz);
      if (dist > 0.03) { desired = Math.atan2(dx, dz); spd = want * smoothstep(0.02, 0.5, dist); }
    }
    if (Number.isFinite(faceYaw)) desired = faceYaw;
    if (planted) spd = 0;
    const diff = wrapAngle(desired - a.yaw);
    const maxTurn = d.turn * (a.react === 'flee' ? 2 : 1);
    const rate = planted ? 0 : clamp(diff * 3.2, -maxTurn, maxTurn);
    springTo(a.yawRate, rate, a.react === 'flee' ? 14 : 7, dt);
    a.yaw = wrapAngle(a.yaw + a.yawRate.x * dt);
    // forward speed eases in and waits for the turn (anticipation: head leads, then body, then feet)
    const align = Math.max(0, Math.cos(diff));
    springTo(a.speed, spd * align * align * align, a.react === 'flee' ? 9 : 3.2, dt);
    // separation from mates, props and the player
    let px = 0, pz = 0;
    const inPen = a.life === 'live' && a.stage !== 'climb' && a.stage !== 'inside' && a.stage !== 'exit';
    if (inPen && a.appear > 0.3) {
      const fwdX = Math.sin(a.yaw), fwdZ = Math.cos(a.yaw), hl = d.len * 0.5 * s * (d.key === 'chicken' ? 0 : 1), rr = d.r * s;
      for (const b of this.animals) {
        if (b === a || b.appear < 0.3 || b.life !== 'live' || b.stage === 'inside') continue;
        const sb = this.worldScale(b, inp), bl = b.def.len * 0.5 * sb * (b.def.key === 'chicken' ? 0 : 1), br = b.def.r * sb;
        const bfx = Math.sin(b.yaw), bfz = Math.cos(b.yaw);
        for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
          const ax = a.x + fwdX * hl * i * 0.8, az = a.z + fwdZ * hl * i * 0.8, bx = b.x + bfx * bl * j * 0.8, bz = b.z + bfz * bl * j * 0.8;
          const ddx = ax - bx, ddz = az - bz, m = (rr + br) * 1.05, d2 = ddx * ddx + ddz * ddz;
          if (d2 < m * m && d2 > 1e-8) { const dd = Math.sqrt(d2), k = (m - dd) / m * (b.lying ? 1.6 : 0.9); px += (ddx / dd) * k; pz += (ddz / dd) * k; }
          if (hl === 0 && bl === 0) break;
        }
      }
      for (const c of pen.avoid) {
        for (let i = -1; i <= 1; i += 2) {
          const ax = a.x + fwdX * hl * i * 0.8, az = a.z + fwdZ * hl * i * 0.8;
          const ddx = ax - c.x, ddz = az - c.z, d2 = ddx * ddx + ddz * ddz, m = c.r + rr * 0.8;
          if (d2 < m * m) { const dd = Math.sqrt(d2) || 1e-3, k = (m - dd) / m * 2; px += (ddx / dd) * k; pz += (ddz / dd) * k; }
          if (hl === 0) break;
        }
      }
      // a scripted gallery animal, a bed or a lure spot inside a keep-out circle should still be reachable
      if (a.stage === 'do' && (a.dest === 'bed' || a.dest === 'lure' || a.dest === 'post' || a.dest === 'nest')) { px *= 0.15; pz *= 0.15; }
      const pl = inp.player;
      if (pl.near) {
        const ddx = a.x - pl.x, ddz = a.z - pl.z, d2 = ddx * ddx + ddz * ddz, m = rr + 0.45;
        if (d2 < m * m) { const dd = Math.sqrt(d2) || 1e-3; px += (ddx / dd) * 1.5; pz += (ddz / dd) * 1.5; }
      }
    }
    if (a.lying || a.lieDir !== 0) { px = 0; pz = 0; }
    a.pushX += (px - a.pushX) * (1 - Math.exp(-6 * dt));
    a.pushZ += (pz - a.pushZ) * (1 - Math.exp(-6 * dt));
    const v = a.speed.x * s;
    const vx = Math.sin(a.yaw) * v + a.pushX * 0.8, vz = Math.cos(a.yaw) * v + a.pushZ * 0.8;
    a.x += vx * dt; a.z += vz * dt;
    if (inPen) {
      // keep nose and rump inside the fence
      const hl = d.len * 0.62 * s, m = d.r * s * 0.9 + 0.14;
      const fx = Math.sin(a.yaw) * hl, fz = Math.cos(a.yaw) * hl;
      const x0 = -pen.hw + m, x1 = pen.hw - m, z0 = -pen.hd + m, z1 = pen.hd - 1.3;
      for (let i = -1; i <= 1; i += 2) {
        const qx = a.x + fx * i, qz = a.z + fz * i;
        if (qx < x0) a.x += x0 - qx; else if (qx > x1) a.x -= qx - x1;
        if (qz < z0) a.z += z0 - qz; else if (qz > z1) a.z -= qz - z1;
      }
    }
    // ramp height (chicken coop)
    a.ay = this.rampY(a.x, a.z);
    // gait: distance-driven phase; stepping in place while turning
    const gv = (a.lying || a.lieDir !== 0) ? 0 : Math.hypot(vx, vz) / s + Math.abs(a.yawRate.x) * d.len * 0.3;
    a.gaitV = gv;
    a.phase += phaseStep(d.gait, gv, dt);
    springTo(a.walkK, strideAmp(d.gait, gv), 10, dt);
  }

  private rampY(x: number, z: number): number {
    const c = this.pen.coop;
    if (!c || Math.abs(x - c.fx) > 0.3) return 0;
    const k = (c.fz - z) / (c.fz - c.dz);
    return k <= 0 ? 0 : k >= 1 ? c.dy : k * c.dy;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Posing

  private readonly rh: Rhythm = { bob: 0, roll: 0, nod: 0, pitch: 0 };

  private pose(a: Animal, inp: HerdInput, busy: boolean): void {
    const dt = inp.dt, d = a.def, t = this.clock + a.seed * 17, key = d.key;
    const pl = inp.player;
    const hen = key === 'chicken';
    // --- defaults
    let neck = 0, hYaw = 0, nod = 0, tilt = 0, hFwd = 0;
    let jaw = 0, ear = 0, tail = Math.sin(t * 0.9) * 0.06, tailLift = 0, wingL = 0, wingR = 0;
    let eyes = 0, roll = 0, pitch = 0, lean = 0, surge = 0, side = 0, fluff = 1, wiggle = 0, relax = 0;
    a.kickL = 0; a.kickR = 0;

    // --- saccadic look-around
    a.lookT -= dt;
    if (a.lookT <= 0) {
      const range = hen ? 1.3 : key === 'pig' ? 0.5 : 0.8;
      a.lookYaw = (this.r() * 2 - 1) * range; a.lookPitch = (this.r() - 0.6) * 0.3;
      a.lookT = hen ? 0.3 + this.r() * 0.9 : 1.5 + this.r() * 3;
    }
    const walking = a.walkK.x;
    hYaw = a.lookYaw * (1 - walking) * 0.7;
    neck = a.lookPitch * 0.5;

    // --- activity poses
    const act = a.act, doing = a.stage === 'do' && !busy && a.lieDir === 0;
    const at = a.t, e = doing ? Math.sin(Math.PI * clamp(at / Math.max(0.1, a.dur), 0, 1)) : 0;
    if (a.stage === 'go' || a.stage === 'turn' || a.stage === 'climb' || a.stage === 'exit') {
      // anticipation: the head looks where the body is about to turn
      const tgt = a.stage === 'turn' ? a.face : Math.atan2(a.tx - a.x, a.tz - a.z);
      hYaw = clamp(wrapAngle(tgt - a.yaw) * 0.8, -1, 1);
      if (act === 'chase') { wingL = wingR = 0.5 + Math.sin(t * 28) * 0.25; neck = -0.3; }
    }
    if (doing || (a.lying && a.lieDir === 0)) {
      switch (act) {
        case 'look': neck = -0.2 + a.lookPitch; hYaw = a.lookYaw * 1.2; ear = 0.25; tilt = Math.sin(t * 0.7) * 0.15; break;
        case 'graze': {
          if (hen) {
            if (a.sub === 1) {
              // peck: snap down, hold, bob back up to a hovering head
              const q = frac(a.subT / 0.26);
              const down = q < 0.3 ? smoothstep(0, 0.3, q) : q < 0.45 ? 1 : 1 - smoothstep(0.45, 1, q);
              neck = d.graze * (0.45 + 0.55 * down); nod = d.grazeNod * (0.5 + 0.5 * down); hFwd = 0.02 * down; hYaw = (a.seed - 0.5) * 0.4;
              if (q > 0.3 && q < 0.33 && this.r() < 0.4) { this.local(a, 0.03, P0, 0.22 * this.worldScale(a, inp)); inp.fx?.spawn('puff', P0.x, P0.y, P0.z, { vy: 0.4, life: 0.35, size: 0.18, color: 0xc8a878 }); }
            } else if (a.sub === 3) {
              // scratch backward with alternating feet, head down watching
              const q = a.subT / 0.3, leg = Math.floor(q) % 2, k = Math.sin(Math.PI * frac(q));
              if (leg === 0) a.kickL = k; else a.kickR = k;
              neck = d.graze * 0.35; pitch = 0.12;
            } else if (a.sub === 0) { neck = -0.1 + a.lookPitch; hYaw = a.lookYaw; tilt = a.lookYaw * 0.4; }
          } else {
            const up = a.sub === 2 ? smoothstep(0, 0.4, a.subT) * (1 - smoothstep(1.4, 1.8, a.subT)) : 0;
            neck = d.graze * (1 - up * 0.85); nod = d.grazeNod * (1 - up); hYaw = (a.seed - 0.5) * 0.5 * (1 - up) + a.lookYaw * up;
            jaw = 0.04 + 0.07 * (0.5 + 0.5 * Math.sin(t * 8.5)) * (key === 'pig' ? 0.6 : 1);
            if (key !== 'pig') tilt = Math.sin(t * 4.25) * 0.04;
          }
          break;
        }
        case 'root': neck = d.graze * 0.9; nod = d.grazeNod + Math.sin(at * 7) * 0.22; surge = Math.sin(at * 7) * 0.025; jaw = Math.max(0, Math.sin(at * 7)) * 0.1; tail = Math.sin(t * 5) * 0.35; ear = 0.15; break;
        case 'drink': {
          const reach = clamp((d.neck[1] - a.fx) / Math.max(0.1, d.neck[1]), 0, 1);
          neck = d.graze * (0.4 + reach * 0.45); nod = d.grazeNod * 0.8; jaw = Math.max(0, Math.sin(t * 10)) * 0.08; break;
        }
        case 'scratch': {
          const rub = Math.sin(at * 4.2);
          lean = a.scratchSide * (0.06 + rub * 0.07); roll = a.scratchSide * (0.12 + rub * 0.08); surge = Math.sin(at * 2.1) * 0.1;
          neck = -0.25; tilt = -a.scratchSide * 0.25; eyes = 0.62; jaw = 0.08; ear = -0.25; tailLift = key === 'cow' ? 0.25 : 0; hYaw = -a.scratchSide * 0.25;
          break;
        }
        case 'shake': {
          const q = clamp(at / a.dur, 0, 1), env = Math.sin(Math.PI * q);
          if (key === 'chicken') { fluff = 1 + 0.2 * env; wingL = wingR = 0.3 * env + Math.sin(at * 38) * 0.18 * env; roll = Math.sin(at * 34) * 0.12 * env; tail = Math.sin(at * 30) * 0.4 * smoothstep(0.6, 1, q); }
          else if (key === 'pig') { wiggle = Math.sin(at * 26) * 0.16 * env; roll = Math.sin(at * 26 + 1) * 0.12 * env; tail = Math.sin(at * 30) * 0.6; ear = Math.sin(at * 26) * 0.5 * env; hYaw = Math.sin(at * 26 + 2) * 0.25 * env; }
          else { roll = Math.sin(at * 30) * 0.22 * env; hYaw = Math.sin(at * 30 + 1.2) * 0.45 * env; ear = Math.sin(at * 30) * 0.7 * env; tail = Math.sin(at * 33) * 0.5 * env; fluff = 1 + 0.05 * env; }
          break;
        }
        case 'call': {
          const q = clamp((at - 0.15) / (a.dur - 0.35), 0, 1), open = Math.sin(Math.PI * q);
          neck = key === 'cow' ? -0.35 * open : -0.25 * open; nod = -0.25 * open;
          jaw = key === 'cow' ? 0.45 * open : key === 'sheep' ? 0.42 * open * (0.8 + 0.2 * Math.sin(at * 32)) : key === 'pig' ? 0.2 * Math.abs(Math.sin(at * 7)) * open : 0.4 * Math.abs(Math.sin(at * 16)) * open;
          ear = 0.2 * open; if (hen) { fluff = 1 + 0.08 * open; wingL = wingR = 0.12 * open; }
          break;
        }
        case 'stretch': {
          const q = clamp(at / a.dur, 0, 1), left = q < 0.5, k = Math.sin(Math.PI * frac(q * 2));
          if (left) { wingL = 1.25 * k; a.kickL = -k; } else { wingR = 1.25 * k; a.kickR = -k; }
          neck = -0.3 * k; hFwd = 0.03 * k; roll = (left ? -1 : 1) * 0.1 * k; tail = (left ? 1 : -1) * 0.3 * k;
          break;
        }
        case 'dust': fluff = 1.18; roll = Math.sin(at * 5.5) * 0.35; wingL = 0.55 + Math.sin(at * 17) * 0.4; wingR = 0.55 + Math.sin(at * 17 + 1) * 0.4; eyes = 0.55; neck = 0.3 + Math.sin(at * 5.5) * 0.2; hYaw = Math.sin(at * 2.75) * 0.8; break;
        case 'brood': fluff = 1.22; eyes = 0.55 + Math.sin(t * 0.3) * 0.1; neck = -0.05; hYaw = a.lookYaw * 0.5; wingL = wingR = 0.12; break;
        case 'rest': jaw = 0.03 + 0.06 * (0.5 + 0.5 * Math.sin(t * 7)) * (key === 'pig' ? 0 : 1); eyes = 0.3; neck = 0.05; hYaw = a.lookYaw * 0.5; tail = 0; if (key === 'pig') side = 0.35; break;
        case 'sleep': {
          eyes = 1; ear = -0.2; tail = 0;
          if (key === 'cow') { hYaw = (a.seed < 0.5 ? 1 : -1) * 1.15; neck = 0.55; nod = 0.3; tilt = (a.seed < 0.5 ? -1 : 1) * 0.3; }
          else if (key === 'sheep') { neck = d.graze * 0.85; nod = 0.2; hYaw = (a.seed - 0.5) * 0.6; }
          else if (key === 'pig') { side = 1; neck = 0.25; }
          else { neck = 0.55; hYaw = (a.seed < 0.5 ? 1 : -1) * 2.4; fluff = 1.2; nod = 0.4; }
          break;
        }
        case 'roll': side = 1; roll = Math.sin(at * 1.6) * 0.55 + 0.25; relax = 1; eyes = 0.7; jaw = 0.1; tail = Math.sin(t * 6) * 0.5; break;
        case 'idle': default: {
          // weight shift + occasional look over the shoulder
          roll = Math.sin(t * 0.37) * 0.015;
          if (key === 'pig') tail = Math.sin(t * 3) * 0.2;
        }
      }
    }
    if (a.lying && act !== 'sleep' && act !== 'rest' && act !== 'roll' && act !== 'dust' && act !== 'brood') { /* getting up soon */ }

    // --- watch the player (curious heads), unless busy with something important
    const dx = pl.x - a.x, dz = pl.z - a.z, dist = Math.hypot(dx, dz);
    const watching = pl.near && dist < (a.react === 'approach' ? 8 : 5.5) && act !== 'sleep' && act !== 'shake' && act !== 'call' && act !== 'dust' && act !== 'roll' && a.stage !== 'inside'
      && (act !== 'graze' || dist < 3.2 || a.sub === 2 || hen) && a.react !== 'flee';
    if (watching || a.react === 'petted') {
      const rel = wrapAngle(Math.atan2(dx, dz) - a.yaw);
      const lim = hen ? 1.9 : key === 'pig' ? 0.9 : 1.25;
      hYaw = clamp(rel, -lim, lim);
      const eyeH = 1.55 - (d.neck[1] + 0.25) * this.worldScale(a, inp);
      neck = -clamp(Math.atan2(eyeH, Math.max(0.5, dist)) * 0.7, -0.2, 0.55);
      nod = -0.1; ear = 0.3; tilt = Math.sin(t * 0.9 + a.seed * 5) * 0.18;
      if (hen && act === 'graze' && a.sub === 1) { hYaw = a.lookYaw; neck = d.graze; }
      // turn the body when the player is behind (idle / look / approach)
      if (!a.lying && a.lieDir === 0 && Math.abs(rel) > lim * 0.9 && (act === 'idle' || act === 'look' || a.react === 'approach') && a.stage === 'do') {
        a.face = Math.atan2(dx, dz); a.stage = 'turn'; a.goT = 0;
      }
    }
    if (a.react === 'approach') { ear = 0.35; tilt = Math.sin(t * 1.3) * 0.25; if (key === 'pig') tail = Math.sin(t * 9) * 0.5; }
    if (a.react === 'flee') { wingL = wingR = 0.55 + Math.sin(t * 34) * 0.45; neck = -0.35; fluff = 1.12; tail = 0.3; }
    if (a.react === 'petted') {
      // lean into the hand: head up and tilted toward you, eyes shut happy, wag / wiggle, then a hop
      const q = a.reactT;
      const inK = smoothstep(0, 0.35, q) * (1 - smoothstep(2.0, 2.4, q));
      eyes = Math.max(eyes, 0.93 * inK);
      const rel = wrapAngle(Math.atan2(dx, dz) - a.yaw);
      tilt = clamp(rel, -1, 1) * 0.45 * inK + Math.sin(q * 6) * 0.06 * inK;
      neck = (a.lying ? 0.1 : -0.2) * inK + neck * (1 - inK); nod = -0.15 * inK;
      lean = clamp(rel, -1, 1) * 0.06 * inK; roll = -clamp(rel, -1, 1) * 0.08 * inK;
      ear = -0.35 * inK;
      jaw = (key === 'sheep' || key === 'pig' ? 0.12 : key === 'chicken' ? 0.15 : 0.05) * inK;
      if (key === 'cow') tail = Math.sin(q * 9) * 0.7 * inK;
      else if (key === 'pig') { tail = Math.sin(q * 22) * 0.8 * inK; wiggle = Math.sin(q * 14) * 0.08 * inK; }
      else if (key === 'sheep') tail = Math.sin(q * 18) * 0.6 * inK;
      else { tail = Math.sin(q * 20) * 0.4 * inK; fluff = 1 + 0.12 * inK; wingL = wingR = 0.15 * inK; }
      if (!a.lying && q > 1.45 && q - dt <= 1.45) a.hopT = 0;
    }

    // --- gait rhythm on top
    const gs = a.gaitV;
    rhythm(d.gait, a.phase, gs, this.rh);
    const k = a.walkK.x;
    const bobA = hen ? 0.028 : key === 'cow' ? 0.035 : 0.028, rollA = hen ? 0.1 : key === 'pig' ? 0.06 : 0.04;
    const bob = this.rh.bob * bobA;
    roll += this.rh.roll * rollA;
    pitch += this.rh.pitch * (hen ? 0.04 : 0.02);
    if (!hen) { neck += this.rh.nod * 0.07 * k; } else if (act !== 'graze' || a.sub !== 1) {
      // head stabilised while walking: hold still in the world, then thrust forward
      hFwd += headHold(a.phase, strideLen(d.gait, gs), k) * (a.react === 'flee' ? 0.3 : 1);
    }
    if (hen && k > 0.1) { tail += Math.sin(a.phase * TAU * 2) * 0.08 * k; }
    // chickens walk with a slightly forward-leaning body; running more
    if (hen) pitch += 0.12 * k * (gs > d.gait.trotAt ? 1.8 : 1);

    // --- lying: body drops, pitches while the front and hind go down at different times
    const fd = a.front * d.lieDrop[0], hd2 = a.hind * d.lieDrop[1];
    const span = Math.abs(d.hips[0][2] - d.hips[d.hips.length - 1][2]) || 0.3;
    pitch += Math.atan2(fd - hd2, span);
    const lieY = -(fd + hd2) * 0.5;
    const lyingK = Math.min(a.front, a.hind);
    if (lyingK > 0.5 && key === 'cow') roll += 0.1 * (a.seed < 0.5 ? 1 : -1) * lyingK;
    side *= lyingK;

    // --- ears, tail, blink, breathing
    a.earT -= dt;
    const flies = act === 'graze' || act === 'rest' ? 3 : 1;
    if (a.earT <= 0) { a.earT = (1.5 + this.r() * 4) / flies; if (this.r() < 0.5) a.earL.v += 14; else a.earR.v += 14; }
    a.swishT -= dt;
    if (key === 'cow' && a.swishT <= 0 && (act === 'graze' || act === 'idle' || act === 'rest' || act === 'drink') && !a.lying) { a.swishT = 3 + this.r() * 6; a.tail.v += (this.r() < 0.5 ? -1 : 1) * 7; }
    if (key === 'sheep' && a.swishT <= 0) { a.swishT = 2 + this.r() * 5; a.tail.v += 12; }
    a.blinkT -= dt;
    if (a.blinkT <= 0) { a.blinkK = 0.001; a.blinkT = 1.8 + this.r() * 4; if (this.r() < 0.2) a.blinkT = 0.28; }
    if (a.blinkK > 0) { a.blinkK += dt; if (a.blinkK > 0.16) a.blinkK = 0; }
    const blinkNow = a.blinkK > 0 ? Math.sin(Math.PI * a.blinkK / 0.16) : 0;
    if (inp.sleepy > 0.3 && act !== 'sleep') eyes = Math.max(eyes, 0.35 * inp.sleepy);

    // --- hop (arrivals, petting, fleeing hens): anticipation squash, airborne stretch, landing squash
    let hopY = 0;
    if (a.hopT >= 0) {
      a.hopT += dt;
      const h = hen ? 0.12 : key === 'cow' ? 0.1 : 0.16, T = hen ? 0.28 : 0.36;
      const q = a.hopT - 0.1;
      if (q < 0) a.squash.x = 1 - 0.1 * Math.sin(Math.PI * (a.hopT / 0.1) * 0.5);
      else if (q < T) { const u = q / T; hopY = h * 4 * u * (1 - u); if (q < 0.03) a.squash.v += 2.5; }
      else { a.squash.v -= 3.2; a.hopT = a.react === 'flee' && this.r() < 0.6 ? 0.1 : -1; }
    }

    // --- springs
    const wHead = hen ? 22 : key === 'pig' ? 9 : 6.5;
    springAngle(a.headYaw, hYaw, wHead, dt);
    springTo(a.neck, neck, hen ? 24 : 7, dt);
    springTo(a.nod, nod, hen ? 24 : 8, dt);
    springTo(a.tilt, tilt, 6, dt);
    springTo(a.headFwd, hFwd, hen ? 40 : 8, dt);
    springTo(a.jaw, jaw, 22, dt);
    springTo(a.earL, ear, 12, dt); springTo(a.earR, ear, 12, dt);
    springTo(a.tail, tail, key === 'cow' ? 5 : 12, dt);
    springTo(a.tailLift, tailLift, 5, dt);
    springTo(a.wingL, wingL, hen ? 26 : 16, dt); springTo(a.wingR, wingR, hen ? 26 : 16, dt);
    springTo(a.eyes, Math.max(eyes, blinkNow), a.blinkK > 0 ? 60 : 12, dt);
    springTo(a.bodyY, bob + hopY + lieY, hopY !== 0 ? 60 : 14, dt);
    springTo(a.pitch, pitch, 9, dt);
    springTo(a.roll, roll, a.act === 'shake' || a.react === 'flee' ? 30 : 8, dt);
    springTo(a.lean, lean, 6, dt);
    springTo(a.surge, surge, 10, dt);
    springTo(a.side, side, 2.2, dt);
    springTo(a.fluff, fluff, 7, dt);
    springTo(a.wiggle, wiggle, 30, dt);
    springTo(a.relax, relax, 3, dt);
    springTo(a.squash, 1, 12, dt);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Effects

  private effects(a: Animal, inp: HerdInput): void {
    const d = a.def, dt = inp.dt;
    if (a.appear < 0.9 || a.life !== 'live') return;
    // ambient voice
    if (a.act !== 'sleep' && inp.time - a.lastSound > 16 && this.r() < dt * 0.03 * (1 + inp.lively) && !this.script) {
      a.lastSound = inp.time;
      if (a.lieDir === 0 && interruptible(a.act) && !a.lying) this.begin(a, 'call', 1.6, 'none');
    }
    // Zzz while asleep
    if (a.act === 'sleep' && (a.lying || a.stage === 'inside')) {
      a.zzzT -= dt;
      if (a.zzzT <= 0) {
        a.zzzT = 1.6 + this.r() * 1.2;
        const s = this.worldScale(a, inp);
        if (a.stage === 'inside' && this.pen.coop) P0.set(this.pen.coop.dx - 0.6, 1.5, this.pen.coop.dz - 0.2).applyMatrix4(inp.site);
        else this.local(a, (d.neck[1] * 0.6 + 0.25) * s, P0, d.neck[2] * s * 0.6);
        if (a.stage !== 'inside' || this.animals.indexOf(a) % 3 === 0) inp.fx?.spawn('zzz', P0.x, P0.y, P0.z, { vy: 0.32, vx: 0.07, life: 2.6, size: 0.6 + d.r * 0.9, color: 0xdfe8ff, spin: this.r() * 6 });
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Chicks follow their mother hen, peck when she pecks, hide under her when she sits

  private stepChicks(inp: HerdInput): void {
    const dt = inp.dt;
    for (const c of this.chicks) {
      const m = c.mom;
      const mScale = this.worldScale(m, inp);
      const sitting = m.lying || m.lieDir > 0 || m.stage === 'inside';
      const hide = m.life !== 'live' || m.appear < 0.3 || (sitting && m.act !== 'dust') || inp.growth < 0.25;
      // trail behind her, fanned out
      const back = 0.3 * mScale + (c.slot % 3) * 0.14, sideOff = ((c.slot % 3) - 1) * 0.24;
      const fX = Math.sin(m.yaw), fZ = Math.cos(m.yaw);
      let tx = m.x - fX * back + fZ * sideOff, tz = m.z - fZ * back - fX * sideOff;
      if (hide) { tx = m.x; tz = m.z; }
      const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
      const want = dist > 0.08 ? Math.min(1.6, dist * 3) : 0;
      c.speed += (want - c.speed) * (1 - Math.exp(-8 * dt));
      if (dist > 0.03 && c.speed > 0.02) {
        const yaw = Math.atan2(dx, dz);
        c.yaw += wrapAngle(yaw - c.yaw) * Math.min(1, dt * 12);
      } else if (!hide) c.yaw += wrapAngle(m.yaw + (c.slot - 1) * 0.5 - c.yaw) * Math.min(1, dt * 2);
      c.x += Math.sin(c.yaw) * c.speed * dt; c.z += Math.cos(c.yaw) * c.speed * dt;
      if (dist > 3) { c.x = tx; c.z = tz; }
      c.ay = this.rampY(c.x, c.z);
      c.phase += c.speed * dt / 0.05;
      springTo(c.hidden, hide && dist < 0.25 ? 1 : 0, 6, dt);
      // peck with mum
      c.peckT -= dt;
      if (c.peckT <= 0) { c.peckT = 0.5 + ((c.slot * 7) % 5) * 0.2 + (m.act === 'graze' ? 0 : 1.2); c.peck = c.speed < 0.1 ? 1 : 0; }
      if (c.peck > 0) c.peck = Math.max(0, c.peck - dt * 4);
      springTo(c.head, c.peck > 0 ? Math.sin(Math.PI * c.peck) * 1.1 : c.speed > 0.2 ? 0.25 : -0.1, 30, dt);
      springTo(c.wing, c.speed > 1 ? 0.6 + Math.sin(this.clock * 40 + c.slot) * 0.4 : 0.05, 20, dt);
      c.blinkT -= dt; if (c.blinkT <= 0) { c.blinkT = 1.5 + ((c.slot * 3) % 4); c.blink = 0.15; }
      c.blink = Math.max(0, c.blink - dt);
      c.hop = Math.abs(Math.sin(c.phase * Math.PI)) * Math.min(1, c.speed * 1.5) * 0.02;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Drawing

  private B: { body: Batch; head: Batch; upper: Batch; lower: Batch; chick?: Batch; chickLeg?: Batch; egg?: Batch } | null = null;
  private bSeason = '';
  private batches(bs: Batches, season: Season) {
    if (this.B && this.bSeason === season) return this.B;
    const k = this.def.key, d = this.def;
    const mat = rigMaterial(), depth = rigDepthMaterial();
    const mk = (name: string, geo: () => THREE.BufferGeometry, cap: number, shadow = true) =>
      bs.get(`beast:${k}:${name}`, () => ({ geo: geo().clone(), mat, cap, shadow, rect: true, aux: true, depth }));
    this.B = {
      body: mk(`body:${season}`, () => d.body(season), 48),
      head: mk('head', d.head, 48),
      upper: mk('upper', d.upper, 192, k !== 'chicken'),
      lower: mk('lower', d.lower, 192, k !== 'chicken'),
    };
    if (k === 'chicken') {
      this.B.chick = bs.get('beast:chick', () => ({ geo: chickBody().clone(), mat, cap: 96, shadow: true, rect: true, aux: true, depth }));
      this.B.chickLeg = bs.get('beast:chickleg', () => ({ geo: chickLeg().clone(), mat, cap: 192, rect: true, aux: true }));
      this.B.egg = bs.get('beast:egg', () => ({ geo: eggGeo().clone(), mat, cap: 128, shadow: true, rect: true, aux: true }));
    }
    this.bSeason = season;
    return this.B;
  }

  private readonly rect = new Float32Array(4);
  private readonly aux = new Float32Array(4);
  private readonly foot: FootOut = { z: 0, y: 0, planted: false, t: 0 };
  private readonly leg: LegSolve = { upper: 0, lower: 0, kz: 0, ky: 0, splay: 0 };

  /** write every visible animal's parts into the batches (world = site matrix × local) */
  draw(bs: Batches, site: THREE.Matrix4, season: Season, growth: number): void {
    const B = this.batches(bs, season);
    const young = 0.78 + 0.22 * clamp(growth * 1.4, 0, 1);
    const R = this.rect, X = this.aux;
    for (const a of this.animals) {
      if (a.appear < 0.01 || a.life === 'gone') continue;
      const d = a.def;
      const s = d.size * a.scale * young * (a.stage === 'inside' ? a.appear : Math.min(1, 0.2 + a.appear * 0.8)) * (0.35 + 0.65 * smoothstep(0, 1, a.appear));
      // root: site × T(x, ay, z) × Ry(yaw + wiggle) × S(s)
      Q.setFromAxisAngle(UP, a.yaw + a.wiggle.x);
      MR.compose(V.set(a.x, a.ay, a.z), Q, S.set(s, s, s)).premultiply(site);
      // body local: about the centre of mass
      const cy = d.cog[1];
      const side = a.side.x;
      const sideRoll = side * 1.35 * (a.seed < 0.5 ? 1 : -1);
      E.set(a.pitch.x, 0, a.roll.x + sideRoll, 'YXZ');
      Q.setFromEuler(E);
      const breath = Math.sin(this.clock * TAU * (a.act === 'sleep' ? 0.22 : 0.33) + a.seed * 9) * (a.act === 'sleep' ? 0.022 : 0.009);
      const sq = a.squash.x, fl = a.fluff.x;
      const sy = sq * (1 + breath) * (fl > 1 ? 1 + (fl - 1) * 0.6 : 1), sxz = fl / Math.sqrt(sq);
      const sideDrop = side * (cy - d.r * 0.95) * 0.9;
      BL.compose(V.set(a.lean.x, cy + a.bodyY.x - sideDrop, a.surge.x), Q, S.set(sxz, sy, sxz * (fl > 1 ? 0.97 : 1)));
      BL.multiply(ML.makeTranslation(0, -cy, 0));
      M.multiplyMatrices(MR, BL);
      R[0] = a.tail.x; R[1] = a.tailLift.x; R[2] = a.wingL.x; R[3] = a.wingR.x;
      X[0] = a.patSeed; X[1] = a.pattern; X[2] = a.dirt; X[3] = 0;
      B.body.push(M, a.tint, R, X);
      // head: body × T(neck + forward shift) × Ry(yaw) × Rx(pitch) × Rz(tilt)
      const n = d.neck;
      E.set(a.neck.x, a.headYaw.x, a.tilt.x, 'YXZ');
      Q.setFromEuler(E);
      ML.compose(V.set(n[0], n[1], n[2] + a.headFwd.x), Q, ONE);
      MH.multiplyMatrices(BL, ML);
      M.multiplyMatrices(MR, MH);
      R[0] = a.eyes.x; R[1] = Math.max(0, a.jaw.x); R[2] = a.earL.x; R[3] = a.earR.x;
      X[3] = a.nod.x;
      B.head.push(M, a.tint, R, X);
      X[3] = 0;
      // legs: hips follow the body; feet follow the gait on the ground (or relax with the body when on its side)
      R[0] = R[1] = R[2] = R[3] = 0;
      const relax = Math.max(side, a.relax.x, a.hopT >= 0 && a.hopT > 0.1 ? 0.15 : 0);
      const gv = a.gaitV;
      for (let i = 0; i < d.hips.length; i++) {
        const h = d.hips[i];
        const [bu, bl] = d.bones[i];
        V.set(h[0], h[1], h[2]).applyMatrix4(BL); // hip in root space
        footAt(d.gait, i, a.phase, gv, this.foot);
        const front = d.hips.length === 4 ? i < 2 : true;
        const down = d.hips.length === 4 ? (front ? a.front : a.hind) : a.front;
        let fx = h[0], fy = this.foot.y * a.walkK.x, fz = h[2] + this.foot.z;
        // kicks (hen scratching / stretching)
        const kick = i === 0 ? a.kickL : i === 1 ? a.kickR : 0;
        if (kick > 0) { fz -= 0.07 * kick; fy += 0.03 * kick; } else if (kick < 0) { fz += 0.12 * kick; fy -= 0.06 * kick; }
        // lying: legs fold under (fronts tuck back, hinds tuck forward and splay)
        if (down > 0) {
          fz += (front ? -bl * 0.95 : bl * 0.35) * down;
          fx += (front ? 0 : Math.sign(h[0]) * 0.08) * down;
          fy = fy * (1 - down);
        }
        if (relax > 0.01) {
          // legs stretched out from the body (lying on the side / kicking in the mud)
          const kickPh = Math.sin(this.clock * 3 + i * 1.7) * 0.25 * a.relax.x;
          W.set(h[0] + Math.sign(h[0]) * 0.02, h[1] - (bu + bl) * 0.9, h[2] + (front ? 0.12 : -0.12) + kickPh).applyMatrix4(BL);
          fx += (W.x - fx) * relax; fy += (W.y - fy) * relax; fz += (W.z - fz) * relax;
        }
        solveLeg(bu, bl, fx - V.x, fy - V.y, fz - V.z, d.kneeFwd[i], this.leg);
        const lg = this.leg;
        // upper: T(hip) × Rz(splay) × Rx(-upper) × S(1, len)
        Q.setFromEuler(E.set(-lg.upper, 0, lg.splay, 'ZXY'));
        ML.compose(V, Q, S.set(1, bu / d.boneGeo[0], 1));
        M.multiplyMatrices(MR, ML);
        B.upper.push(M, a.tint, R, X);
        // lower: T(knee) × Rz(splay) × Rx(-lower)
        const c = Math.cos(lg.splay), sn = Math.sin(lg.splay);
        W.set(V.x - sn * lg.ky, V.y + c * lg.ky, V.z + lg.kz);
        Q.setFromEuler(E.set(-lg.lower, 0, lg.splay, 'ZXY'));
        ML.compose(W, Q, S.set(1, bl / d.boneGeo[1], 1));
        M.multiplyMatrices(MR, ML);
        B.lower.push(M, a.tint, R, X);
      }
    }
    if (B.chick) this.drawChicks(B, site, young);
    if (B.egg) this.drawEggs(B, site);
  }

  private drawChicks(B: NonNullable<Herd['B']>, site: THREE.Matrix4, young: number): void {
    const R = this.rect, X = this.aux;
    X[0] = 0; X[1] = 0; X[2] = 0;
    for (const c of this.chicks) {
      const k = 1 - c.hidden.x;
      if (k < 0.03) continue;
      const s = 1.05 * k * (0.9 + 0.1 * young);
      Q.setFromAxisAngle(UP, c.yaw);
      MR.compose(V.set(c.x, c.ay + c.hop, c.z), Q, S.set(s, s, s)).premultiply(site);
      R[0] = c.blink > 0 ? 1 : 0; R[1] = 0; R[2] = c.wing.x; R[3] = c.wing.x;
      X[3] = c.head.x;
      B.chick!.push(MR, null, R, X);
      X[3] = 0; R[0] = R[1] = R[2] = R[3] = 0;
      for (let i = 0; i < 2; i++) {
        const sw = Math.sin(c.phase * Math.PI + i * Math.PI) * 0.6 * Math.min(1, c.speed * 2);
        Q.setFromAxisAngle(RX, sw);
        ML.compose(V.set(i ? -0.025 : 0.025, 0.04, 0), Q, ONE);
        M.multiplyMatrices(MR, ML);
        B.chickLeg!.push(M, null, R, X);
      }
    }
    void CHICK_J;
  }

  private readonly eggTint = new THREE.Color();
  private drawEggs(B: NonNullable<Herd['B']>, site: THREE.Matrix4): void {
    const R = this.rect, X = this.aux;
    R[0] = R[1] = R[2] = R[3] = 0; X[0] = X[1] = X[2] = X[3] = 0;
    for (let i = 0; i < this.eggs.length; i++) {
      const e = this.eggs[i];
      if (!(i % 6 < this.eggBase) && !e.laid) continue;
      const nst = this.pen.nests[e.nest];
      Q.setFromEuler(E.set(0.3 * Math.sin(e.a * 3), e.a, 0.35 * Math.cos(e.a * 2), 'YXZ'));
      MR.compose(V.set(nst.x + Math.cos(e.a) * e.r, 0.09, nst.z + Math.sin(e.a) * e.r), Q, ONE).premultiply(site);
      this.eggTint.set(e.brown ? 0xe8c49a : 0xfdf8ec);
      B.egg!.push(MR, this.eggTint, R, X);
    }
  }

  /** world head position of an animal (interactables) */
  headPos(a: Animal, site: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
    const s = a.def.size * a.scale;
    const lie = Math.min(a.front, a.hind) * a.def.lieDrop[0];
    out.set(a.x + Math.sin(a.yaw) * a.def.neck[2] * s * 1.2, a.ay + (a.def.neck[1] - lie) * s + 0.1, a.z + Math.cos(a.yaw) * a.def.neck[2] * s * 1.2);
    return out.applyMatrix4(site);
  }
}

const Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), W = new THREE.Vector3(), S = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1), RX = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const MR = new THREE.Matrix4(), BL = new THREE.Matrix4(), MH = new THREE.Matrix4(), ML = new THREE.Matrix4(), M = new THREE.Matrix4();

// -------------------------------------------------------------------------------------------------------------
// Pen layout per kind (troughs, beds by the shelter, fence posts, nests, the coop ramp)

export function penFor(kind: string, hw: number, hd: number, avoid: Pen['avoid'], posts: { x: number; z: number }[]): Pen {
  const pen: Pen = { hw, hd, avoid, lure: [], beds: [], posts: [], nests: [] };
  const trough = (x: number, z0: number, z1: number, h: number, fromLeft: boolean) => {
    for (const z of [z0 + (z1 - z0) * 0.3, z0 + (z1 - z0) * 0.75]) pen.lure.push({ x: fromLeft ? x - 0.32 : x + 0.32, z, yaw: fromLeft ? Math.PI / 2 : -Math.PI / 2, h });
  };
  const bedsAround = (cx: number, cz: number, n: number, gap: number, yaw: number) => {
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 3), col = (i % 3) - 1;
      pen.beds.push({ x: cx + col * gap + (row % 2) * gap * 0.4, z: cz + row * gap * 0.8, yaw: yaw + (col * 0.25) });
    }
  };
  switch (kind) {
    case 'cows':
      trough(-4.4, 0, 2.0, 0.5, false);
      pen.lure.push({ x: 3.6 - 0.62, z: 0.9, yaw: Math.PI / 2, h: 0.5 });
      // under the lean-to, heads out
      pen.beds.push({ x: -1.1, z: -hd + 2.2, yaw: 0.4 }, { x: 1.2, z: -hd + 2.3, yaw: -0.3 }, { x: 3.2, z: -hd + 2.5, yaw: 0.2 }, { x: -3.2, z: -hd + 2.8, yaw: 0.7 });
      break;
    case 'sheep':
      trough(-4.4, 0.4, 2.0, 0.5, false);
      pen.lure.push({ x: 0.2, z: -hd + 2.2 + 0.62, yaw: Math.PI, h: 0.7 }, { x: 0.9, z: -hd + 2.2 + 0.62, yaw: Math.PI, h: 0.7 });
      bedsAround(3.0, -hd + 2.6, 6, 0.9, Math.PI * 0.85);
      break;
    case 'pigs':
      trough(4.0, 0.2, 1.8, 0.45, true);
      bedsAround(0.8, -hd + 2.75, 5, 0.75, 0.2);
      pen.mud = { x: -3.4, z: -0.6, r: 1.6 };
      break;
    case 'chickens': {
      pen.nests.push({ x: -3.4, z: -hd + 1.4 }, { x: 3.6, z: -hd + 1.3 });
      pen.lure.push({ x: -3.6, z: 0.8, yaw: -Math.PI / 2, h: 0 }, { x: -3.6, z: 1.8, yaw: -Math.PI / 2, h: 0 });
      const cx = 0.6, cz = -hd + 1.3;
      pen.coop = { fx: cx + 0.5, fz: cz + 1.95, dx: cx + 0.5, dz: cz + 0.82, dy: 0.72 };
      bedsAround(cx + 0.5, cz + 2.5, 9, 0.35, Math.PI);
      break;
    }
  }
  // scratching posts: side and back fence posts away from props and spots
  for (const p of posts) {
    let nx = 0, nz = 0;
    if (Math.abs(p.x + hw) < 0.05) nx = 1; else if (Math.abs(p.x - hw) < 0.05) nx = -1; else if (Math.abs(p.z + hd) < 0.05) nz = 1; else continue;
    if (Math.abs(p.z) > hd - 1.5 && nz === 0) continue;
    if (nz !== 0 && Math.abs(p.x) > hw - 1.5) continue;
    const ix = p.x + nx * 0.8, iz = p.z + nz * 0.8;
    if (avoid.some((c) => (c.x - ix) ** 2 + (c.z - iz) ** 2 < (c.r + 0.7) ** 2)) continue;
    pen.posts.push({ x: p.x, z: p.z, nx, nz });
  }
  return pen;
}
