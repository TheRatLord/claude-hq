/**
 * The mascot crowd renderer. Every body part is an instance of a handful of shared InstancedMeshes (Clawd body,
 * Clawd legs, Codex body, Codex feet, nubs, face glyphs, hats, props), written densely each frame, so 40 farmers cost
 * the same ~8 draw calls (+ shadow pass) as one and no triangles are spent on hidden slots.
 *
 * `draw` turns a pose vector + gait state into part matrices:
 *   root (feet on the ground, yaw) → lie (flop back around the rear bottom edge) → body (lift, twist/lean/roll,
 *   volume-preserving squash about the bottom) → nubs, eye glyphs, hat, prop. Legs run from the hips under the body
 *   to feet placed by the gait (planted feet stay put), stretching a little so contacts never break.
 */
import * as THREE from 'three';
import { clawdBodyGeometry, clawdLegGeometry, codexBodyGeometry, codexFootGeometry, GLYPH_GROUP, glyphGeometry, hatGeometryOf, nubGeometry, PROP_GROUP, propGeometry, ROLE_HAT_GROUP, roleHatGeometry, WEAR_GROUP, wearGeometry } from './geo.ts';
import { addInstanceAttrs, rigDepthMaterial, rigMaterial } from './mat.ts';
import { HAT_NAMES, clawdPlan, codexPlan } from './mascots.ts';
import type { GlyphName, HatName, Plan } from './mascots.ts';
import { CH, footAt } from './pose.ts';
import type { Body, GaitState, GlyphState, Hold, Pose, Prop } from './pose.ts';
import type { Look } from './look.ts';

export const PLANS: Readonly<Record<Body, Plan>> = { clawd: clawdPlan(), codex: codexPlan() };

type PartName = 'clawd' | 'leg' | 'codex' | 'foot' | 'nub' | 'glyph' | `hat_${HatName}` | 'prop' | 'rolehat' | 'wear';

interface Part {
  mesh: THREE.InstancedMesh;
  n: number;
  cap: number;
  a: Record<'iA' | 'iB' | 'iC' | 'iSel' | 'iJig', THREE.InstancedBufferAttribute>;
}

export interface Placement { x: number; y: number; z: number; yaw: number; scale: number }

export interface DrawIn {
  look: Look;
  at: Placement;
  pose: Pose;
  gait: GaitState;
  glyphs: readonly [GlyphState, GlyphState];
  prop: Prop | null;
  hold: Hold;
  /** prop take-out / put-away scale */
  propScale: number;
  /** basket / crate contents colour */
  produce: number;
  /** hat follow-through: tilt (rad) about x / z and a little hop (m) */
  hatLag: { x: number; z: number; y: number };
  /** prop follow-through (rad) */
  propLag: { x: number; z: number };
  /** body follow-through shear (m of x / z offset per m of height) and lobe wobble */
  shear: { x: number; z: number };
  wobble: number;
  wobblePhase: number;
}

export interface DrawOut {
  /** top centre of the body (labels, emotes, hat) */
  head: THREE.Vector3;
  /** where the prop is held */
  hand: THREE.Vector3;
  /** between the eyes */
  eyes: THREE.Vector3;
}

/** Hanging props keep level with gravity instead of following the body's lean. */
/** Villagers' role hats read from across the square: a size up on the tier hats. */
const ROLE_HAT_SCALE = 1.4;
const HANGS: ReadonlySet<Prop> = new Set(['can', 'basket', 'lantern', 'sack', 'pigeon']);

const _root = new THREE.Matrix4(), _L = new THREE.Matrix4(), _Br = new THREE.Matrix4(), _Bs = new THREE.Matrix4(), _W = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _arm = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _s = new THREE.Vector3();
const _hip = new THREE.Vector3(), _foot = new THREE.Vector3(), _dir = new THREE.Vector3(), _free = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);
const _tipL = new THREE.Vector3(), _tipR = new THREE.Vector3();
const _rq = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _yq = new THREE.Quaternion();
const _fo = { z: 0, y: 0 };
const _c = new THREE.Color();

const T = (x: number, y: number, z: number) => _t.makeTranslation(x, y, z);
const R = (x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') => _t.makeRotationFromEuler(_e.set(x, y, z, order));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

interface Rgb { body: number[]; dark: number[]; glyph: number[]; scarf: number[]; hat: number[]; band: number[]; wear: number[]; trim: number[] }
const rgbCache = new WeakMap<Look, Rgb>();
const rgb = (hex: number) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };
function colorsOf(l: Look): Rgb {
  let c = rgbCache.get(l);
  if (!c) { c = { body: rgb(l.color), dark: rgb(l.dark), glyph: rgb(l.glyph), scarf: rgb(l.scarf), hat: rgb(l.hatColor), band: rgb(l.hatBand), wear: rgb(l.wearColor ?? 0xffffff), trim: rgb(l.wearTrim ?? l.dark) }; rgbCache.set(l, c); }
  return c;
}
const WHITE = [1, 1, 1];

export class Crowd {
  readonly group = new THREE.Group();
  private parts = {} as Record<PartName, Part>;
  private shadows: boolean;
  private produce = [1, 1, 1];

  constructor(capacity = 48, shadows = true) {
    this.shadows = shadows;
    this.group.name = 'farmers';
    this.alloc(capacity);
  }

  private alloc(cap: number): void {
    const spec: [PartName, () => THREE.BufferGeometry, number, boolean][] = [
      ['clawd', clawdBodyGeometry, 1, true], ['leg', clawdLegGeometry, 4, true], ['codex', codexBodyGeometry, 1, true], ['foot', codexFootGeometry, 2, true],
      ['nub', nubGeometry, 2, true], ['glyph', glyphGeometry, 2, false], ['prop', propGeometry, 1, true],
      // villagers' dressing (scene/villagers); empty — and so not drawn — in the farmers' crowd
      ['rolehat', roleHatGeometry, 1, true], ['wear', wearGeometry, 1, true],
      ...HAT_NAMES.map((h) => [`hat_${h}`, () => hatGeometryOf(h), 1, true] as [PartName, () => THREE.BufferGeometry, number, boolean]),
    ];
    for (const [name, geo, per, shadow] of spec) {
      const old = this.parts[name];
      if (old) { this.group.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.dispose(); }
      const g = geo().clone();
      const n = cap * per;
      addInstanceAttrs(g, n);
      const mesh = new THREE.InstancedMesh(g, rigMaterial(), n);
      mesh.name = `mascot-${name}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = shadow && this.shadows;
      // the Codex bevel steps self-shadow into acne; it still casts
      mesh.receiveShadow = name !== 'codex';
      mesh.customDepthMaterial = rigDepthMaterial();
      mesh.count = 0;
      this.group.add(mesh);
      const a = {} as Part['a'];
      for (const k of ['iA', 'iB', 'iC', 'iSel', 'iJig'] as const) a[k] = g.getAttribute(k) as THREE.InstancedBufferAttribute;
      this.parts[name] = { mesh, n: 0, cap: n, a };
    }
  }

  /** Grow capacity for `n` farmers (drops this frame's instances; call before `begin`). */
  ensure(n: number): void {
    if (n * 4 <= this.parts.leg.cap) return;
    this.alloc(Math.max(n, Math.ceil(this.parts.leg.cap / 4) * 2));
  }

  begin(): void { for (const p of Object.values(this.parts)) p.n = 0; }

  end(): void {
    for (const p of Object.values(this.parts)) {
      p.mesh.count = p.n;
      p.mesh.visible = p.n > 0;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.mesh.instanceMatrix.clearUpdateRanges(); p.mesh.instanceMatrix.addUpdateRange(0, p.n * 16);
      for (const a of Object.values(p.a)) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, p.n * a.itemSize); }
    }
  }

  private put(name: PartName, m: THREE.Matrix4, A: number[], B: number[] = WHITE, C: number[] = WHITE, sel0 = 0, jig?: DrawIn): void {
    const p = this.parts[name];
    if (p.n >= p.cap) return;
    const i = p.n++;
    p.mesh.setMatrixAt(i, m);
    const a = p.a;
    a.iA.setXYZ(i, A[0], A[1], A[2]); a.iB.setXYZ(i, B[0], B[1], B[2]); a.iC.setXYZ(i, C[0], C[1], C[2]);
    a.iSel.setXYZW(i, sel0, 0, 0, 0);
    if (jig) a.iJig.setXYZW(i, jig.shear.x, jig.shear.z, jig.wobble, jig.wobblePhase);
    else a.iJig.setXYZW(i, 0, 0, 0, 0);
  }

  /** Draw one farmer; fills `out` with its head / hand / eye world positions. */
  draw(d: DrawIn, out: DrawOut): void {
    const P = PLANS[d.look.body];
    const o = d.pose;
    const col = colorsOf(d.look);
    const clawd = d.look.body === 'clawd';
    _c.setHex(d.produce); this.produce[0] = _c.r; this.produce[1] = _c.g; this.produce[2] = _c.b;

    // root
    _q.setFromAxisAngle(_v.set(0, 1, 0), d.at.yaw);
    _root.compose(_v.set(d.at.x, d.at.y, d.at.z), _q, _s.set(d.at.scale, d.at.scale, d.at.scale));
    // lie: flop back around the rear bottom edge
    const lie = clamp(o[CH.lie], 0, 1);
    _L.identity();
    if (lie > 1e-3) _L.multiply(T(0, 0, -P.d / 2)).multiply(R(-lie * 1.32, 0, 0)).multiply(T(0, 0, P.d / 2));
    // body
    const drop = clamp(o[CH.drop], 0, 1);
    const lift = P.legLen * (1 - drop) + o[CH.bob];
    const sq = clamp(o[CH.sq], -0.45, 0.6), sy = 1 + sq, sxz = 1 / Math.sqrt(sy);
    _Br.copy(_L).multiply(T(0, lift, 0)).multiply(R(o[CH.lean], o[CH.twist], o[CH.roll], 'YXZ'));
    _Bs.copy(_Br).multiply(_t.makeScale(sxz, sy, sxz));
    _W.multiplyMatrices(_root, _Bs);
    this.put(clawd ? 'clawd' : 'codex', _W, col.body, col.dark, col.scarf, d.look.star ? 1 : 0, d);
    _bq.setFromRotationMatrix(_m.extractRotation(_Br));

    // legs / feet
    const tuck = clamp(o[CH.tuck], 0, 1);
    for (let i = 0; i < P.hips.length; i++) {
      const hp = P.hips[i];
      _hip.set(hp.x, 0, hp.z).applyMatrix4(_Bs);
      footAt(d.look.body, i, d.gait, _fo);
      const swing = o[CH.l0 + i];
      if (clawd) {
        _foot.set(hp.x, _fo.y, hp.z + _fo.z);
        _dir.subVectors(_foot, _hip);
        if (Math.abs(swing) > 1e-4) _dir.applyAxisAngle(_v2.set(1, 0, 0), -swing);
        const lenP = _dir.length();
        const air = sstep(1.25, 1.6, lenP / P.legLen);
        const lp = clamp(lenP, P.legLen * 0.45, P.legLen * 1.3);
        const a = tuck * 1.45 + swing * (1 - tuck * 0.3);
        _free.set(0, -Math.cos(a), Math.sin(a)).applyQuaternion(_bq);
        const wf = Math.max(tuck, lie, air);
        _dir.normalize().lerp(_free, wf).normalize();
        const len = lp + (P.legLen - lp) * wf;
        _q2.setFromUnitVectors(_down, _dir);
        _m.compose(_hip, _q2, _s.set(sxz, len / P.legLen, sxz));
        _W.multiplyMatrices(_root, _m);
        this.put('leg', _W, col.body);
      } else {
        // Codex feet: planted by the gait, but they stay tucked just under the body when it hops
        _foot.set(hp.x, P.legLen + _fo.y, hp.z + _fo.z);
        if (_hip.y - _foot.y > P.legLen * 0.45) _foot.y = _hip.y - P.legLen * 0.45;
        if (_foot.y > _hip.y + 0.01) _foot.y = _hip.y + 0.01;
        // sitting: feet stick out in front, soles forward
        _free.set(hp.x * 1.05, P.legLen * 0.55, P.d * 0.42).applyMatrix4(_Br);
        const wf = Math.max(tuck, lie);
        _foot.lerp(_free, wf);
        _e.set(-_fo.y * 5 - tuck * 1.25 - swing * 0.6, o[CH.twist] * 0.5, 0, 'YXZ');
        _q2.setFromEuler(_e);
        if (lie > 1e-3) { _yq.copy(_bq).multiply(_q2); _q2.slerp(_yq, lie); }
        _m.compose(_foot, _q2, _s.set(1, 1, 1));
        _W.multiplyMatrices(_root, _m);
        this.put('foot', _W, col.dark, col.dark);
      }
    }

    // nubs
    const aw = P.armW, al = P.armLen;
    for (let s = 0; s < 2; s++) {
      const L = s === 0;
      const ay = L ? o[CH.aLy] : o[CH.aRy], az = L ? o[CH.aLz] : o[CH.aRz], ax = L ? o[CH.aLx] : o[CH.aRx], ae = L ? o[CH.aLe] : o[CH.aRe];
      _arm.copy(_Bs).multiply(T(L ? P.shoulder.x : -P.shoulder.x, P.shoulder.y, P.shoulder.z));
      _arm.multiply(_m.makeScale(1 / sxz, 1 / sy, 1 / sxz)); // nubs keep their shape when the body squashes
      if (!L) _arm.multiply(R(0, Math.PI, 0));
      _arm.multiply(R(0, L ? -ay : ay, 0)).multiply(R(0, 0, az)).multiply(R(ax, 0, 0));
      const len = al * (1 + Math.max(-0.4, ae));
      (L ? _tipL : _tipR).set(len, 0, 0).applyMatrix4(_arm);
      _W.multiplyMatrices(_root, _m.copy(_arm).multiply(_t.makeScale(len, aw, aw)));
      this.put('nub', _W, col.body);
    }

    // face glyphs
    const cell = P.glyphCell;
    const es = 1 + o[CH.eyeS];
    for (let s = 0; s < 2; s++) {
      const g = d.glyphs[s];
      if (!g.on || g.sy <= 0.01) continue;
      const an = P.glyphs[s];
      const ex = clawd ? o[CH.eyeX] * P.u * 0.8 : o[CH.eyeX] * P.u * 0.5, ey = o[CH.eyeY] * P.u * (clawd ? 0.6 : 0.5);
      _m.copy(_Bs).multiply(T(an.x + ex + g.dx * cell, an.y + ey + g.dy * cell, an.z)).multiply(R(0, 0, g.roll))
        .multiply(_t.makeScale(cell * g.sx * es, cell * g.sy * es, cell));
      _W.multiplyMatrices(_root, _m);
      this.put('glyph', _W, col.glyph, WHITE, WHITE, GLYPH_GROUP(g.g as GlyphName));
    }

    // hat: sits on top, keeps its shape, lags a little behind the body
    _m.copy(_Bs).multiply(T(P.hat.x, P.hat.y, P.hat.z)).multiply(_t.makeScale(1 / sxz, 1 / sy, 1 / sxz))
      .multiply(R(d.hatLag.x, 0, d.hatLag.z + (clawd ? 0.08 : 0.12))).multiply(T(0, d.hatLag.y, 0)).multiply(_t.makeScale(P.hat.s, P.hat.s, P.hat.s));
    _W.multiplyMatrices(_root, _m);
    if (d.look.roleHat) { _W.multiply(_t.makeScale(ROLE_HAT_SCALE, ROLE_HAT_SCALE, ROLE_HAT_SCALE)); this.put('rolehat', _W, col.hat, col.band, col.hat, ROLE_HAT_GROUP(d.look.roleHat)); }
    else this.put(`hat_${d.look.hat}`, _W, col.hat, col.band, col.hat, 0);
    // villager wear rides the body (squash, shear and all)
    if (d.look.wear && clawd) { _W.multiplyMatrices(_root, _Bs); this.put('wear', _W, col.body, col.trim, col.wear, WEAR_GROUP(d.look.wear), d); }
    out.head.set(0, P.h, 0).applyMatrix4(_Bs).applyMatrix4(_root);
    out.eyes.set(0, P.eyeY, P.d / 2).applyMatrix4(_Bs).applyMatrix4(_root);

    // prop
    if (d.prop && d.propScale > 0.01) {
      const ps = d.propScale;
      if (d.hold === 'over') {
        _m.copy(_Bs).multiply(T(0, P.h - 0.01, 0)).multiply(_t.makeScale(1 / sxz, 1 / sy, 1 / sxz))
          .multiply(R(o[CH.pP] + d.propLag.x, 0, d.propLag.z)).multiply(_t.makeScale(ps, ps, ps));
        out.hand.setFromMatrixPosition(_m).applyMatrix4(_root);
      } else {
        const tip = d.hold === 'L' ? _tipL : _tipR;
        if (HANGS.has(d.prop)) _rq.setFromAxisAngle(_v2.set(0, 1, 0), o[CH.twist]);
        else _rq.copy(_bq);
        const bird = d.prop === 'pigeon';
        _e.set(bird ? 0 : o[CH.pP] + d.propLag.x, bird ? Math.PI : o[CH.pY], bird ? 0 : d.propLag.z, 'YXZ'); // the pigeon faces its farmer
        _rq.multiply(_q2.setFromEuler(_e));
        _m.compose(tip, _rq, _s.set(ps, ps, ps));
        out.hand.copy(tip).applyMatrix4(_root);
        // the carrier pigeon flies in / off along a high arc from ahead and to the left (o.prop: 1 far … 0 perched)
        const fly = bird ? o[CH.prop] : 0;
        if (fly > 0.001) _m.premultiply(T(fly * 1.6, fly * 3.2 + Math.sin(fly * Math.PI) * 0.6, fly * 5.5));
      }
      _W.multiplyMatrices(_root, _m);
      const flying = d.prop === 'pigeon' && o[CH.prop] > 0.001;
      this.put('prop', _W, this.produce, WHITE, col.scarf, PROP_GROUP(flying ? (o[CH.pY] >= 0 ? 'pigeonup' : 'pigeondown') : d.prop));
    } else {
      out.hand.copy(_tipR).applyMatrix4(_root);
    }
  }

  dispose(): void {
    for (const p of Object.values(this.parts)) { p.mesh.geometry.dispose(); p.mesh.dispose(); }
  }
}
