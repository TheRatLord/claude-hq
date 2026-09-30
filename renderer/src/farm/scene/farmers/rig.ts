/**
 * The crowd renderer: every farmer's body parts are instances of a handful of shared InstancedMeshes (legs, torso,
 * arms, head+hair+hats, face, props), so 40 farmers cost the same few draw calls as one. Each farmer owns a stable
 * slot; `write` turns a pose vector into the part matrices for that slot.
 */
import * as THREE from 'three';
import { armGeometry, DIM, faceGeometry, HAIR_GROUP, HAT_GROUP, headGeometry, legGeometry, PROP_GROUP, propGeometry, torsoGeometry } from './geo.ts';
import { addInstanceAttrs, faceMaterial, rigDepthMaterial, rigMaterial } from './mat.ts';
import { faceAtlas } from './atlas.ts';
import { CH, PROP_HOLD } from './pose.ts';
import type { Pose, Prop } from './pose.ts';
import type { Look } from './look.ts';

interface Part { mesh: THREE.InstancedMesh; per: number }

const geoCache: Record<string, THREE.BufferGeometry> = {};
const baseGeo = (k: string, f: () => THREE.BufferGeometry) => (geoCache[k] ??= f());

/** Props that hang with gravity from the hand (compensate the arm swing) rather than swinging with it. */
const HANGS: ReadonlySet<Prop> = new Set(['can', 'basket', 'rod', 'notebook', 'bindle']);

const _m = new THREE.Matrix4(), _root = new THREE.Matrix4(), _pelvis = new THREE.Matrix4(), _torso = new THREE.Matrix4();
const _arm = new THREE.Matrix4(), _hand = new THREE.Matrix4(), _tmp = new THREE.Matrix4(), _headM = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _c = new THREE.Color();

const rot = (out: THREE.Matrix4, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') => out.makeRotationFromEuler(_e.set(x, y, z, order));
const trans = (out: THREE.Matrix4, x: number, y: number, z: number) => out.makeTranslation(x, y, z);

export interface Placement { x: number; y: number; z: number; yaw: number; scale: number }

export class Crowd {
  readonly group = new THREE.Group();
  capacity = 0;
  private parts: Record<'leg' | 'torso' | 'arm' | 'head' | 'face' | 'prop', Part> | null = null;
  private used = 0;
  /** world matrices of the last write, for markers and the locator */
  readonly headPos: THREE.Vector3[] = [];
  readonly handPos: THREE.Vector3[] = [];

  private shadows: boolean;
  constructor(capacity = 48, shadows = true) {
    this.shadows = shadows;
    this.group.name = 'farmers';
    this.ensure(capacity);
  }

  ensure(n: number): void {
    if (n <= this.capacity) return;
    const cap = Math.max(n, this.capacity * 2, 8);
    const old = this.parts;
    const mk = (key: string, g: THREE.BufferGeometry, per: number, mat: THREE.Material = rigMaterial(), shadow = this.shadows): Part => {
      const geo = g.clone();
      if (mat === rigMaterial()) addInstanceAttrs(geo, cap * per);
      const mesh = new THREE.InstancedMesh(geo, mat, cap * per);
      mesh.name = `farmer-${key}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      if (mat === rigMaterial()) mesh.customDepthMaterial = rigDepthMaterial();
      for (let i = 0; i < cap * per; i++) mesh.setMatrixAt(i, ZERO);
      mesh.count = 0;
      return { mesh, per };
    };
    const faceGeo = baseGeo('face', faceGeometry).clone();
    faceGeo.setAttribute('iFace', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    const parts = {
      leg: mk('leg', baseGeo('leg', legGeometry), 2),
      torso: mk('torso', baseGeo('torso', torsoGeometry), 1),
      arm: mk('arm', baseGeo('arm', armGeometry), 2),
      head: mk('head', baseGeo('head', headGeometry), 1),
      face: mk('face', faceGeo, 1, faceMaterial(faceAtlas()), false),
      prop: mk('prop', baseGeo('prop', propGeometry), 1),
    };
    if (old) {
      // carry instance data over
      for (const k of Object.keys(parts) as (keyof typeof parts)[]) {
        const a = old[k].mesh, b = parts[k].mesh;
        (b.instanceMatrix.array as Float32Array).set(a.instanceMatrix.array as Float32Array);
        for (const name of ['iA', 'iB', 'iC', 'iD', 'iSel', 'iFace']) {
          const src = a.geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
          const dst = b.geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
          if (src && dst) { (dst.array as Float32Array).set(src.array as Float32Array); dst.needsUpdate = true; }
        }
        this.group.remove(a);
        a.geometry.dispose();
      }
    }
    for (const p of Object.values(parts)) this.group.add(p.mesh);
    this.parts = parts;
    for (let i = this.capacity; i < cap; i++) { this.headPos.push(new THREE.Vector3()); this.handPos.push(new THREE.Vector3()); }
    this.capacity = cap;
  }

  private setAttr(part: Part, name: string, i: number, ...v: number[]) {
    const a = part.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
    for (let k = 0; k < part.per; k++) {
      const j = (i * part.per + k) * a.itemSize;
      for (let c = 0; c < v.length; c++) (a.array as Float32Array)[j + c] = v[c];
    }
    a.needsUpdate = true;
  }
  private col(part: Part, name: string, i: number, hex: number) {
    _c.setHex(hex);
    this.setAttr(part, name, i, _c.r, _c.g, _c.b);
  }

  /** Dress a slot. `produce` = colour of the basket / crate contents (by plot kind). */
  setLook(i: number, l: Look, produce: number): void {
    this.ensure(i + 1);
    const p = this.parts!;
    this.col(p.leg, 'iA', i, l.overalls); this.col(p.leg, 'iB', i, l.boots);
    this.col(p.torso, 'iA', i, l.shirt); this.col(p.torso, 'iB', i, l.overalls); this.col(p.torso, 'iC', i, l.scarf); this.col(p.torso, 'iD', i, l.skin);
    this.col(p.arm, 'iA', i, l.shirt); this.col(p.arm, 'iB', i, l.skin);
    this.col(p.head, 'iA', i, l.skin); this.col(p.head, 'iB', i, l.hair); this.col(p.head, 'iC', i, l.hatColor); this.col(p.head, 'iD', i, l.hatBand);
    const hat = HAT_GROUP(l.hat);
    // goggles carry their own messy hair; spikes would poke through a hat, so hatted spiky hair becomes a crop
    const hair = l.hat === 'goggles' ? 0 : HAIR_GROUP(l.hairStyle === 'spiky' ? 'tuft' : l.hairStyle);
    this.setAttr(p.head, 'iSel', i, hair, hat, 0, 0);
    this.col(p.prop, 'iA', i, produce); this.col(p.prop, 'iD', i, l.scarf);
  }

  setProp(i: number, prop: Prop | null): void {
    this.setAttr(this.parts!.prop, 'iSel', i, prop ? PROP_GROUP(prop) : 0, 0, 0, 0);
  }

  setFace(i: number, cell: number): void {
    const a = this.parts!.face.mesh.geometry.getAttribute('iFace') as THREE.InstancedBufferAttribute;
    if (a.array[i] !== cell) { (a.array as Float32Array)[i] = cell; a.needsUpdate = true; }
  }

  hide(i: number): void {
    if (!this.parts || i >= this.capacity) return;
    for (const p of Object.values(this.parts)) for (let k = 0; k < p.per; k++) p.mesh.setMatrixAt(i * p.per + k, ZERO);
    for (const p of Object.values(this.parts)) p.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Set how many slots are live (highest used slot + 1). */
  setCount(n: number): void {
    this.used = n;
    for (const p of Object.values(this.parts!)) { p.mesh.count = n * p.per; p.mesh.visible = n > 0; p.mesh.instanceMatrix.needsUpdate = true; }
  }

  /** Pose slot `i`. `prop`/`propScale`: the held prop (scale tween for take-out / put-away). */
  write(i: number, at: Placement, o: Pose, prop: Prop | null, propScale: number): void {
    const p = this.parts!;
    // root
    _q.setFromAxisAngle(_v.set(0, 1, 0), at.yaw);
    _root.compose(_v.set(at.x, at.y, at.z), _q, _s.set(at.scale, at.scale, at.scale));
    // pelvis: hips height (drop, bob), lying down rotates the whole body back around the hips
    const lie = o[CH.lie];
    const hipsY = (DIM.legLen - o[CH.drop]) * (1 - lie) + 0.2 * lie + o[CH.bob];
    _pelvis.copy(_root).multiply(trans(_tmp, 0, hipsY, 0));
    if (lie > 1e-3) _pelvis.multiply(rot(_tmp, -Math.PI / 2 * lie, 0, 0));
    // legs
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1; // 0 = left (+x)
      const a = s === 0 ? o[CH.lL] : o[CH.lR];
      _m.copy(_pelvis).multiply(trans(_tmp, side * DIM.hipX, 0, 0)).multiply(rot(_tmp, -a, 0, side * 0.04));
      p.leg.mesh.setMatrixAt(i * 2 + s, _m);
    }
    // torso: twist, lean, roll, squash & stretch
    const sq = o[CH.sq];
    _torso.copy(_pelvis).multiply(rot(_tmp, o[CH.lean], o[CH.twist], o[CH.roll], 'YXZ')).multiply(_tmp.makeScale(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5));
    p.torso.mesh.setMatrixAt(i, _torso);
    // head
    _headM.copy(_torso).multiply(trans(_tmp, 0, DIM.torsoH, 0)).multiply(rot(_tmp, o[CH.headP], o[CH.headY], o[CH.headR], 'YXZ'));
    p.head.mesh.setMatrixAt(i, _headM);
    p.face.mesh.setMatrixAt(i, _headM);
    _v.set(0, DIM.headY, 0).applyMatrix4(_headM);
    this.headPos[i].copy(_v);
    // arms
    const hold = prop ? PROP_HOLD[prop] : null;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      const ax = s === 0 ? o[CH.aLx] : o[CH.aRx], az = s === 0 ? o[CH.aLz] : o[CH.aRz];
      _arm.copy(_torso).multiply(trans(_tmp, side * DIM.shoulderX, DIM.shoulderY, 0)).multiply(rot(_tmp, -ax, 0, side * az, 'XZY'));
      p.arm.mesh.setMatrixAt(i * 2 + s, _arm);
      const isHand = (hold === 'R' && s === 1) || (hold === 'L' && s === 0);
      if (isHand && prop) {
        _hand.copy(_arm).multiply(trans(_tmp, 0, -DIM.armLen, 0));
        if (HANGS.has(prop)) _hand.multiply(rot(_tmp, ax, 0, -side * az, 'ZXY')); // undo the swing: hang with gravity
        this.propMatrix(prop, o, _hand, propScale);
        p.prop.mesh.setMatrixAt(i, _hand);
        this.handPos[i].setFromMatrixPosition(_hand);
      }
    }
    if (hold === 'front' && prop) {
      _hand.copy(_torso).multiply(trans(_tmp, 0, prop === 'crate' ? 0.2 : 0.26, prop === 'crate' ? 0.34 : 0.3));
      if (prop === 'book') _hand.multiply(rot(_tmp, -0.9 + o[CH.prop] * 0.1, 0, 0));
      if (prop === 'letter') _hand.multiply(rot(_tmp, -0.3, 0, 0));
      _hand.multiply(_tmp.makeScale(propScale, propScale, propScale));
      p.prop.mesh.setMatrixAt(i, _hand);
      this.handPos[i].setFromMatrixPosition(_hand);
    }
    if (!prop || propScale <= 0.001) p.prop.mesh.setMatrixAt(i, ZERO);
    for (const part of Object.values(p)) part.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Per-prop grip orientation in the hand (+ the `prop` channel: can tilt, rod tug, hammer snap…). */
  private propMatrix(prop: Prop, o: Pose, m: THREE.Matrix4, s: number) {
    const k = o[CH.prop];
    switch (prop) {
      case 'can': m.multiply(rot(_tmp, k * 0.7, 0, 0)); break;
      case 'rod': m.multiply(rot(_tmp, -k * 0.35, 0, 0)); break;
      case 'hoe': m.multiply(rot(_tmp, -0.5 - k * 0.3, 0, 0)); break;
      case 'hammer': m.multiply(rot(_tmp, -0.2 + k * 0.3, 0, 0)); break;
      case 'magnifier': m.multiply(rot(_tmp, Math.PI, 0, 0)); break;
      case 'broom': m.multiply(rot(_tmp, 0.25, 0, 0)); break;
      case 'bindle': m.multiply(rot(_tmp, 0.4, 0, 0)); break;
      case 'notebook': m.multiply(trans(_tmp, 0.05, 0.02, 0)).multiply(rot(_tmp, 0.1, 0, 0.1)); break;
      case 'basket': break;
      default: break;
    }
    m.multiply(_tmp.makeScale(s, s, s));
  }

  dispose(): void {
    if (!this.parts) return;
    for (const p of Object.values(this.parts)) { p.mesh.geometry.dispose(); p.mesh.dispose(); }
  }
}
