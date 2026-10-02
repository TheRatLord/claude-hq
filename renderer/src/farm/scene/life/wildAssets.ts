/** Gallery registrations for the wild visitors (wildlife.ts builds through the same models and motion). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { rigMaterial } from './rig.ts';
import type { RigMaterial } from './rig.ts';
import { body } from './critterAnim.ts';
import type { Body } from './critterAnim.ts';
import type { Legs } from './gait.ts';
import { DEER_LOOK, FAWN_LOOK, deer, fox, goose, hedgehog, heron, owl } from './wildModels.ts';
import type { Model } from './wildModels.ts';
import { gooseFly, grazeNeck, heronFly, heronLift, heronStand, hogPose, owlFly, owlPerch, quadBody, quadHead, quadLegPose, quadLegs, quadRig, resetBody } from './wildAnim.ts';
import type { QuadHead, QuadRig } from './wildAnim.ts';

type C3 = readonly [number, number, number];
interface Live { legs: Legs | null; rig: QuadRig | null; head: QuadHead; ch: Float32Array; b: Body; loop: string; scale: number; tint: C3; tint2: C3; x: number }
const live = new WeakMap<THREE.Object3D, Live>();
type Loop = (e: Live, t: number, dt: number, param: number) => void;

function asset(name: string, note: string, make: () => Model & { dims?: unknown }, scale: number, loops: Record<string, Loop>, look?: (variant: string) => { scale?: number; tint?: C3; tint2?: C3 }) {
  const names = Object.keys(loops);
  defineAsset({
    name, group: 'animal', note, variants: names, param: 'speed',
    build(o) {
      const m = make();
      const mat = rigMaterial(m.spec, { instanced: false });
      const mesh = new THREE.Mesh(m.geo, mat);
      mesh.rotation.order = 'YXZ';
      mesh.castShadow = true;
      const g = new THREE.Group();
      g.add(mesh);
      const loop = o.variant ?? names[0];
      const lk = look?.(loop) ?? {};
      const rig = 'dims' in m && m.dims ? quadRig(m.dims as never) : null;
      const e: Live = { legs: rig ? quadLegs(rig) : null, rig, head: { neck: 0, yaw: 0, ears: 0, tail: 0 }, ch: new Float32Array(12), b: body(), loop, scale: lk.scale ?? scale, tint: lk.tint ?? [1, 1, 1], tint2: lk.tint2 ?? [1, 1, 1], x: 0 };
      live.set(g, e);
      for (let i = 0; i < 60; i++) step(g, e, i / 30, 1 / 30, 0.5, loops);
      return g;
    },
    animate(obj, t0, dt0, param) {
      const e = live.get(obj);
      if (!e) return;
      const t = Number.isFinite(t0) ? t0 : performance.now() / 1000;
      const dt = Number.isFinite(dt0) ? Math.min(0.1, Math.max(dt0, 1 / 120)) : 1 / 60;
      step(obj, e, t, dt, param, loops);
    },
  });
}

function step(g: THREE.Object3D, e: Live, t: number, dt: number, param: number, loops: Record<string, Loop>): void {
  const mesh = g.children[0] as THREE.Mesh;
  const mat = mesh.material as RigMaterial;
  e.ch.fill(0); resetBody(e.b);
  (loops[e.loop] ?? Object.values(loops)[0])(e, t, dt, param);
  const ch = e.ch, u = mat.userData, b = e.b, s = e.scale;
  u.animA.set(ch[0], ch[1], ch[2], ch[3]); u.animB.set(ch[4], ch[5], ch[6], ch[7]); u.animC.set(ch[8], ch[9], ch[10], ch[11]);
  u.tint.setRGB(e.tint[0], e.tint[1], e.tint[2]); u.tint2.setRGB(e.tint2[0], e.tint2[1], e.tint2[2]);
  mesh.position.y = b.y * s;
  mesh.rotation.set(b.pitch, 0, b.roll);
  mesh.scale.set(s * b.sx, s * b.sy, s * b.sz);
}

/** a quadruped moving at v (model units / s), head from `head` */
const quad = (v: (p: number) => number, head: (e: Live, t: number) => void, fold = 0): Loop => (e, t, dt, p) => {
  if (!e.legs || !e.rig) return;
  e.legs.update(dt, v(p), 0);
  head(e, t);
  quadBody(e.legs, e.b);
  quadLegPose(e.rig, fold ? null : e.legs, e.b, e.ch, fold);
  quadHead(e.head, e.ch);
};
const grazing = (e: Live, t: number) => { e.head.neck = grazeNeck(t, 0.3, e.head); e.head.ears = 0.1 + Math.max(0, Math.sin(t * 2.3)) * 0.2; e.head.tail = 0.05; };
const walking = (e: Live, t: number) => { e.head.neck = 0.25 + Math.sin(t * 2) * 0.05; e.head.yaw = Math.sin(t * 0.6) * 0.15; e.head.ears = 0.2; e.head.tail = 0.1; };
const alerting = (e: Live, t: number) => { e.head.neck = -0.2; e.head.yaw = Math.sin(t * 0.5) * 0.4; e.head.ears = 0.35; e.head.tail = 0.5 + Math.max(0, Math.sin(t * 3)) * 0.3; };
const bolting = (e: Live) => { e.head.neck = -0.15; e.head.yaw = 0; e.head.ears = -0.5; e.head.tail = 1.3; };

asset('deer', 'roe deer, a doe and her fawn: graze at the forest edge at dawn and dusk, look up when you come near, bound off with the white tail flagged (param = speed)', deer, 1, {
  graze: quad(() => 0, grazing),
  walk: quad((p) => 0.4 + p * 0.6, walking),
  alert: quad(() => 0, alerting),
  bound: quad((p) => 3.5 + p * 3, bolting),
  fawn: quad((p) => 0.4 + p * 0.6, walking),
  lie: quad(() => 0, (e, t) => { e.head.neck = -0.1 + Math.sin(t * 0.4) * 0.05; e.head.yaw = Math.sin(t * 0.3) * 0.5; e.head.ears = 0.3; e.head.tail = 0; e.b.y = -0.42; }, 1),
}, (v) => (v === 'fawn' || v === 'lie' ? { scale: 0.62, tint: FAWN_LOOK[0], tint2: FAWN_LOOK[1] } : { tint: DEER_LOOK[0], tint2: DEER_LOOK[1] }));

asset('fox', 'red fox: trots the hedgerows at night with its brush out behind, stops to sniff and listen, eyes catch the lamplight; streaks off when you rush it (param = speed)', fox, 1.15, {
  trot: quad((p) => 1.2 + p * 0.8, (e, t) => { e.head.neck = 0.35; e.head.yaw = Math.sin(t * 0.8) * 0.1; e.head.ears = 0.6; e.head.tail = -0.15; }),
  walk: quad((p) => 0.35 + p * 0.3, (e, t) => { e.head.neck = 0.55 + Math.max(0, Math.sin(t * 4)) * 0.15; e.head.yaw = Math.sin(t * 0.9) * 0.3; e.head.ears = 0.4; e.head.tail = -0.25; }),
  sniff: quad(() => 0, (e, t) => { e.head.neck = 0.9 + Math.max(0, Math.sin(t * 9)) * 0.08; e.head.yaw = Math.sin(t * 0.7) * 0.35; e.head.ears = 0.5; e.head.tail = -0.3; }),
  alert: quad(() => 0, (e, t) => { e.head.neck = -0.25; e.head.yaw = 0.5 + Math.sin(t * 0.6) * 0.15; e.head.ears = 1; e.head.tail = 0.05; }),
  run: quad((p) => 3 + p * 2.5, (e) => { e.head.neck = 0.25; e.head.yaw = 0; e.head.ears = -0.6; e.head.tail = 0.1; }),
});

asset('heron', 'grey heron: stands stock-still in the river shallows, wades, stabs for fish; lifts off in slow deep beats with its neck tucked (param = speed)', heron, 1, {
  stand: (e, t) => heronStand(t, { reach: 0.1, strike: 0, yaw: Math.sin(t * 0.3) * 0.2, stride: -1, crest: 0 }, e.ch, e.b),
  hunt: (e, t) => { const c = t % 4; heronStand(t, { reach: 1, strike: c > 3 ? (c - 3) / 0.6 : 0, yaw: 0, stride: -1, crest: 0.3 }, e.ch, e.b); },
  wade: (e, t, _dt, p) => heronStand(t, { reach: 0.8, strike: 0, yaw: Math.sin(t * 0.5) * 0.2, stride: t * (0.25 + p * 0.3), crest: 0.1 }, e.ch, e.b),
  fly: (e, t, _dt, p) => heronFly(t * (1.6 + p), t, 0, e.ch, e.b),
  takeoff: (e, t) => { const c = (t % 3) / 3; heronLift(t * 2.6, c, e.ch, e.b); e.b.y += c * 0.6; },
});

asset('owl', 'tawny owl: perches on a standing stone at night, turns its head right round to keep you in view, blinks slowly, hoots; flies off silently (param = speed)', owl, 1.25, {
  perch: (e, t) => owlPerch(t, { yaw: Math.sin(t * 0.4) * 0.3, tilt: 0, blink: (t % 4) > 3.8 ? 1 : 0, fluff: 0, tufts: 0, hoot: 0 }, e.ch, e.b),
  watch: (e, t) => owlPerch(t, { yaw: Math.sin(t * 0.7) * 2.4, tilt: Math.sin(t * 1.3) * 0.25, blink: (t % 3) > 2.85 ? 1 : 0.15, fluff: 0, tufts: 0.3, hoot: 0 }, e.ch, e.b),
  hoot: (e, t) => { const c = t % 3; owlPerch(t, { yaw: 0, tilt: 0, blink: 0.4, fluff: 0.3, tufts: 0, hoot: c < 1.2 ? Math.sin(c / 1.2 * Math.PI) : 0 }, e.ch, e.b); },
  fly: (e, t, _dt, p) => owlFly(t * (1.8 + p), Math.sin(t * 0.7) > 0.4 ? 1 : 0, e.ch, e.b),
});

asset('hedgehog', 'hedgehog: snuffles under the orchard trees on mild evenings; curls into a prickly ball when you come close, uncurls when you keep still (param = speed)', hedgehog, 1.5, {
  snuffle: (e, t) => hogPose(t, t * 1.2, 0.3, 0, 1, Math.sin(t * 0.8) * 0.4, e.ch, e.b),
  walk: (e, t, _dt, p) => hogPose(t, t * (3 + p * 2), 1, 0, 0.5, 0, e.ch, e.b),
  curl: (e, t) => { const c = (t % 5) / 5; const k = c < 0.2 ? c / 0.2 : c < 0.75 ? 1 : 1 - (c - 0.75) / 0.25; hogPose(t, 0, 0, Math.min(1, k), 0, 0, e.ch, e.b); },
});

asset('goose', 'greylag geese: fly over in a long V, honking, south in autumn and home in spring (param = speed)', goose, 1.3, {
  fly: (e, t, _dt, p) => gooseFly(t * (2.3 + p), t, e.ch, e.b),
  glide: (e, t) => { gooseFly(0.2, t, e.ch, e.b); e.ch[0] = 0.12; e.ch[1] = 0; },
});
