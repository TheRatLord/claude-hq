/**
 * Ducklings = subagents. Fluffy voxel ducklings (mascots.ts) that waddle in a line behind their farmer: the body rocks
 * side to side, the webbed feet paddle in time with the distance covered, the head bobs forward on every step. When
 * they fall behind they flap their wing stubs and hop to catch up; when the farmer stops they settle in an arc, sit
 * down and peep now and then (bill open). A new subagent hatches: the egg wobbles, cracks, and the top shell pops off.
 * A finished one flaps goodbye, waddles off to the pond and hops in.
 *
 * Rendered as five InstancedMeshes (body, head, wings, feet, egg shells), independent of the number of ducklings.
 */
import * as THREE from 'three';
import { duckBodyGeometry, duckFootGeometry, duckHeadGeometry, duckWingGeometry, eggGeometry } from './geo.ts';
import { addInstanceAttrs, rigDepthMaterial, rigMaterial } from './mat.ts';
import { DUCK, DUCK_DIM } from './mascots.ts';
import { trailAt } from './trail.ts';
import type { Trail } from './trail.ts';
import type { Duckling } from '../../model/types.ts';

export interface Duck {
  id: string;
  label: string;
  x: number; z: number; y: number; yaw: number;
  /** waddle phase (steps), advanced by distance */
  phase: number;
  /** 0..1 spawn pop */
  pop: number;
  /** seconds since hatching started (egg shown while < HATCH) */
  hatch: number;
  /** flap-hop height (m) and vertical speed */
  hop: number; hopV: number;
  /** 0..1 wing flapping */
  flap: number;
  speed: number;
  /** 0..1 sitting down, and how long it has been standing still */
  sit: number; still: number;
  /** bill open (peep) until this time; next spontaneous peep */
  peepUntil: number; peepAt: number;
  /** head look (yaw offset) and its target */
  look: number; lookT: number; lookAt: number;
  /** personality phase */
  k: number;
  /** waddling home to the pond */
  home: { x: number; z: number } | null;
  homeT: number;
  fade: number;
  lastH: { x: number; z: number; h: number };
  /** the top half of the shell after the pop, flying off */
  shell: { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; t: number } | null;
  /** internal clock */
  t: number;
}

export const HATCH = 1.5;
const U = DUCK.u;
const STEP = 0.075; // metres per waddle step
const _m = new THREE.Matrix4(), _root = new THREE.Matrix4(), _body = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _o = { x: 0, z: 0 };
const T = (x: number, y: number, z: number) => _t.makeTranslation(x, y, z);
const R = (x: number, y: number, z: number, o: THREE.EulerOrder = 'XYZ') => _t.makeRotationFromEuler(_e.set(x, y, z, o));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

type PartName = 'body' | 'head' | 'wing' | 'foot' | 'egg';

export class Ducks {
  readonly group = new THREE.Group();
  private parts = {} as Record<PartName, { mesh: THREE.InstancedMesh; n: number; sel: THREE.InstancedBufferAttribute }>;

  constructor(cap = 160) {
    const spec: [PartName, () => THREE.BufferGeometry, number][] = [
      ['body', duckBodyGeometry, 1], ['head', duckHeadGeometry, 1], ['wing', duckWingGeometry, 2], ['foot', duckFootGeometry, 2], ['egg', eggGeometry, 1],
    ];
    for (const [name, geo, per] of spec) {
      const n = name === 'egg' ? 48 : cap * per;
      const g = geo().clone();
      addInstanceAttrs(g, n);
      const mesh = new THREE.InstancedMesh(g, rigMaterial(), n);
      mesh.name = `duckling-${name}`;
      mesh.frustumCulled = false; mesh.castShadow = name !== 'wing'; mesh.receiveShadow = name === 'egg'; mesh.count = 0;
      mesh.customDepthMaterial = rigDepthMaterial();
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.parts[name] = { mesh, n: 0, sel: g.getAttribute('iSel') as THREE.InstancedBufferAttribute };
    }
  }

  static make(d: Duckling, x: number, z: number, y: number, hatch: boolean): Duck {
    const k = Math.random();
    return {
      id: d.id, label: d.label, x, z, y, yaw: 0, phase: k, pop: hatch ? 0 : 1, hatch: hatch ? 0 : HATCH + 2, hop: 0, hopV: 0, flap: 0, speed: 0,
      sit: 0, still: 0, peepUntil: 0, peepAt: 2 + k * 6, look: 0, lookT: 0, lookAt: 1 + k * 3, k, home: null, homeT: 0, fade: 1,
      lastH: { x: 1e9, z: 0, h: y }, shell: null, t: 0,
    };
  }

  /** Open the bill for a quick peep-peep (the system calls this when it plays the quack). */
  static peep(d: Duck): void { d.peepUntil = d.t + 0.42; }

  begin(): void { for (const p of Object.values(this.parts)) p.n = 0; }

  /**
   * Step a following duckling: target a point `dist` back along the owner's trail (or `spot` when the owner has
   * settled); hop when the owner whistles (`hop`). Returns true when the duckling hatched this frame.
   */
  follow(d: Duck, trail: Trail, ox: number, oz: number, dist: number, dt: number, hop: boolean, height: (x: number, z: number) => number, ownerYaw: number, spot: { x: number; z: number } | null = null): boolean {
    d.t += dt;
    let popped = false;
    if (d.hatch < HATCH) {
      d.hatch += dt;
      if (d.hatch >= HATCH) {
        popped = true;
        d.shell = { x: d.x, y: d.y + 0.16, z: d.z, vx: (Math.random() - 0.5) * 0.8, vy: 2.2, vz: (Math.random() - 0.5) * 0.8, spin: (Math.random() - 0.5) * 14, t: 0 };
        d.peepUntil = d.t + 0.5;
      }
      d.yaw = ownerYaw + Math.PI;
      d.y = height(d.x, d.z);
      return popped;
    }
    d.pop = Math.min(1, d.pop + dt * 2.4);
    if (spot) { _o.x = spot.x; _o.z = spot.z; } else trailAt(trail, ox, oz, dist, _o);
    const far = Math.hypot(_o.x - d.x, _o.z - d.z);
    // fell behind: flap and hop to catch up
    const hurry = far > 1.1 && d.pop >= 1;
    this.walk(d, _o.x, _o.z, dt, hurry ? 3.4 : 2.4, height);
    if (d.speed < 0.05) d.yaw = damp(d.yaw, Math.atan2(ox - d.x, oz - d.z), 3, dt, true);
    d.flap = damp(d.flap, hurry || hop ? 1 : 0, hurry ? 10 : 5, dt);
    if ((hurry || hop) && d.hop <= 0 && d.hopV <= 0) d.hopV = hurry ? 1.25 : 1.0 + Math.random() * 0.3;
    this.air(d, dt);
    // settle: sit down when everyone has stopped for a moment; peep and look around
    d.still = spot && d.speed < 0.08 ? d.still + dt : 0;
    d.sit = damp(d.sit, d.still > 1.6 + d.k ? 1 : 0, d.still > 0 ? 3 : 9, dt);
    this.idle(d);
    return popped;
  }

  /** Waddle toward the pond (after a goodbye flap); returns true when gone. */
  goHome(d: Duck, dt: number, height: (x: number, z: number) => number): boolean {
    if (!d.home) return true;
    d.t += dt;
    d.homeT += dt;
    d.sit = damp(d.sit, 0, 9, dt);
    if (d.homeT < 0.9) {
      // goodbye: flap the wing stubs and peep, then turn toward the pond
      d.flap = damp(d.flap, 1, 10, dt);
      if (d.homeT < 0.1) d.peepUntil = d.t + 0.5;
      d.yaw = damp(d.yaw, Math.atan2(d.home.x - d.x, d.home.z - d.z), 4 * clamp01(d.homeT - 0.4), dt, true);
    } else {
      d.flap = damp(d.flap, 0, 5, dt);
      this.walk(d, d.home.x, d.home.z, dt, 1.7, height);
      const left = Math.hypot(d.home.x - d.x, d.home.z - d.z);
      if (left < 0.45) {
        // hop in
        if (d.hopV === 0 && d.hop === 0 && d.fade > 0.99) d.hopV = 1.3;
        d.fade -= dt * 1.6;
      }
    }
    this.air(d, dt);
    this.idle(d);
    return d.fade <= 0;
  }

  private air(d: Duck, dt: number) {
    if (d.hopV !== 0 || d.hop > 0) {
      d.hopV -= 9.8 * dt;
      d.hop += d.hopV * dt;
      if (d.hop <= 0) { d.hop = 0; d.hopV = 0; }
    }
  }

  private idle(d: Duck) {
    if (d.t > d.peepAt) { d.peepAt = d.t + 3 + Math.random() * 7; if (d.speed < 0.3) d.peepUntil = d.t + 0.42; }
    if (d.t > d.lookAt) { d.lookAt = d.t + 0.8 + Math.random() * 2.5; d.lookT = (Math.random() - 0.5) * 1.6; }
    d.look += (d.lookT - d.look) * 0.08;
  }

  private walk(d: Duck, tx: number, tz: number, dt: number, vmax: number, height: (x: number, z: number) => number) {
    const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
    const want = dist > 0.08 ? Math.min(vmax, dist * 2.2) : 0;
    d.speed = damp(d.speed, want * (1 - d.sit * 0.9), 8, dt);
    if (dist > 1e-4) {
      const s = Math.min(dist, d.speed * dt);
      d.x += (dx / dist) * s; d.z += (dz / dist) * s;
      if (d.speed > 0.05) d.yaw = damp(d.yaw, Math.atan2(dx, dz), 10, dt, true);
      d.phase += s / STEP;
    }
    if (Math.abs(d.x - d.lastH.x) + Math.abs(d.z - d.lastH.z) > 0.08) { d.lastH.x = d.x; d.lastH.z = d.z; d.lastH.h = height(d.x, d.z); }
    d.y = d.lastH.h;
  }

  private put(name: PartName, m: THREE.Matrix4, s0 = 0, s1 = 0): void {
    const p = this.parts[name];
    if (p.n >= p.mesh.instanceMatrix.count) return;
    p.mesh.setMatrixAt(p.n, m);
    p.sel.setXYZW(p.n, s0, s1, 0, 0);
    p.n++;
  }

  draw(d: Duck, t: number, dt = 1 / 60): void {
    void t;
    if (d.hatch < HATCH) { this.drawEgg(d); return; }
    if (d.shell) this.drawShell(d, dt);
    const moving = clamp01(d.speed / 0.35);
    const ph = d.phase * Math.PI; // one step per half cycle
    const step = Math.sin(ph);
    const sc = d.fade * (d.pop < 1 ? easeOutBack(d.pop) : 1);
    const sit = d.sit;
    // root
    _q.setFromEuler(_e.set(0, d.yaw, 0));
    _root.compose(_p.set(d.x, d.y + d.hop, d.z), _q, _s.set(sc, sc, sc));
    // body: rock side to side on every step, bob, lean forward when hurrying, sit down
    const land = d.hop > 0 ? 0 : Math.abs(step) * 0.2 * moving;
    const rock = step * 0.28 * moving + Math.sin(d.t * 1.7 + d.k * 9) * 0.03 * (1 - moving);
    const lower = sit * (DUCK_DIM.hipY - 0.35) * U;
    const bob = Math.abs(Math.cos(ph)) * 0.012 * moving;
    const breath = Math.sin(d.t * 2.6 + d.k * 5) * 0.03;
    _body.copy(_root).multiply(T(0, DUCK_DIM.hipY * U - lower + bob, 0)).multiply(R(0.12 * moving + d.flap * 0.25 - sit * 0.08, 0, rock, 'YXZ'))
      .multiply(_t.makeScale(1 + land * 0.2, 1 - land * 0.25 + breath * (1 - moving), 1 + land * 0.1));
    this.put('body', _body);
    // head: bob forward on each step (pigeon-style), look around when still, tip up to peep
    const peeping = d.t < d.peepUntil;
    const bobZ = (Math.cos(ph * 2) * 0.5 + 0.5) * 0.9 * moving;
    const tilt = peeping ? -0.35 : 0;
    const cock = Math.sin(d.t * 0.9 + d.k * 3) * 0.15 * (1 - moving);
    _m.copy(_body).multiply(T(0, (DUCK_DIM.neck.y - DUCK_DIM.hipY) * U, (DUCK_DIM.neck.z + bobZ) * U))
      .multiply(R(tilt + bobZ * 0.1 - d.flap * 0.2, d.look * (1 - moving), cock - rock * 0.6, 'YXZ'));
    const open = peeping && Math.sin((d.peepUntil - d.t) * 30) > -0.2;
    this.put('head', _m, open ? 1 : 2);
    // wings: tucked, a little flutter on each step; flapping fast when hopping or saying goodbye
    for (const s of [1, -1]) {
      const flap = d.flap * (0.6 + 0.7 * Math.abs(Math.sin(d.t * 26 + (s > 0 ? 0 : 0.4))));
      const flutter = Math.abs(step) * 0.12 * moving;
      _m.copy(_body).multiply(T(s * DUCK_DIM.shoulder.x * U, (DUCK_DIM.shoulder.y - DUCK_DIM.hipY) * U, DUCK_DIM.shoulder.z * U))
        .multiply(R(0, 0, s * (0.08 + flap + flutter)));
      this.put('wing', _m);
    }
    // feet: paddle in time with the steps (planted foot moves back with the ground), lifted while hopping
    for (const [s, off] of [[1, 0], [-1, Math.PI]] as const) {
      const f = Math.sin(ph + off);
      const swing = Math.cos(ph + off);
      const lift = Math.max(0, f) * 0.025 * moving + (d.hop > 0 ? 0.01 : 0);
      const z = swing * STEP * 0.5 * moving;
      const hide = 1 - sit * 0.85;
      _m.copy(_root).multiply(T(s * DUCK_DIM.foot.x * U, DUCK_DIM.hipY * U - lower + lift, DUCK_DIM.foot.z * U + z))
        .multiply(R(-Math.max(0, f) * 0.6 * moving + (d.hop > 0 ? 0.5 : 0), 0, 0)).multiply(_t.makeScale(hide, hide, hide));
      this.put('foot', _m);
    }
  }

  /** The egg: gentle wobbles, then harder with pauses, a crack opens, and it pops. */
  private drawEgg(d: Duck) {
    const k = d.hatch / HATCH;
    const burst = Math.floor(d.hatch * 2.2) % 2 === 0 ? 1 : 0.25; // wobble – pause – wobble
    const wob = Math.sin(d.hatch * 34) * (0.08 + k * 0.3) * burst;
    const hop = k > 0.7 ? Math.abs(Math.sin(d.hatch * 20)) * 0.02 : 0;
    _q.setFromEuler(_e.set(0, d.yaw, wob, 'YXZ'));
    _root.compose(_p.set(d.x, d.y + hop, d.z), _q, _s.set(1, 1, 1));
    this.put('egg', _root, 2);
    // the top half lifts a hair as the crack opens
    const crack = Math.max(0, (k - 0.55) / 0.45);
    _m.copy(_root).multiply(T(0, crack * 0.012, 0)).multiply(R(crack * Math.sin(d.hatch * 40) * 0.08, 0, 0));
    this.put('egg', _m, 1);
  }

  /** The popped top shell tumbles off and the bottom half fades. */
  private drawShell(d: Duck, dt: number) {
    const s = d.shell!;
    s.t += dt;
    s.vy -= 9.8 * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    if (s.y < d.y) { s.y = d.y; s.vy *= -0.3; s.vx *= 0.5; s.vz *= 0.5; s.spin *= 0.5; }
    const fade = clamp01(1.4 - s.t);
    if (fade <= 0) { d.shell = null; return; }
    _q.setFromEuler(_e.set(s.t * s.spin, d.yaw, s.t * s.spin * 0.6));
    _m.compose(_p.set(s.x, s.y - 0.16, s.z), _q, _s.set(fade, fade, fade));
    this.put('egg', _m, 1);
    const b = clamp01(1.8 - s.t);
    _q.setFromEuler(_e.set(0, d.yaw, 0));
    _m.compose(_p.set(d.x - Math.sin(d.yaw) * 0.22 * clamp01(s.t * 3), d.y, d.z - Math.cos(d.yaw) * 0.22 * clamp01(s.t * 3)), _q, _s.set(b, b, b));
    this.put('egg', _m, 2);
  }

  end(): void {
    for (const p of Object.values(this.parts)) {
      p.mesh.count = p.n; p.mesh.visible = p.n > 0;
      p.mesh.instanceMatrix.needsUpdate = true; p.sel.needsUpdate = true;
    }
  }
}

function damp(c: number, t: number, rate: number, dt: number, angle = false): number {
  let d = t - c;
  if (angle) d = Math.atan2(Math.sin(d), Math.cos(d));
  return c + d * (1 - Math.exp(-rate * dt));
}
export function easeOutBack(x: number): number { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; }
