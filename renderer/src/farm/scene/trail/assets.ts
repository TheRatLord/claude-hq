/** Asset registrations for the summit trail (gallery; the trail system builds through the same functions). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import type { AssetBuildOpts } from '../assets.ts';
import type { TrailAnchors } from '../../world/trail.ts';
import { Kit, solidMat } from '../structures/kit.ts';
import { SUMMIT, bridgeKit, cairnKit, flagMesh, offeringGeometry, offeringSpot, stairsKit, summitKit, trailheadKit, trailheadSign, waveFlag, windsweptPine, viewerHead } from './build.ts';

const flat = () => 0;

const SUMMIT_AT: TrailAnchors['summit'] = { x: 0, z: 0, y: 0, yaw: 0, w: 4.6, d: 3.8, deck: 0.32 };

function summitAsset(o: AssetBuildOpts): THREE.Object3D {
  const k = new Kit(o.seed);
  summitKit(k, SUMMIT_AT, flat, o.season);
  const g = k.build(new THREE.Group(), o.night ?? 0);
  const head = viewerHead();
  head.rotation.order = 'YXZ';
  head.position.set(SUMMIT.viewer.x, SUMMIT_AT.deck + SUMMIT.viewerH, SUMMIT.viewer.z);
  head.rotation.x = -0.12;
  const flag = flagMesh();
  flag.position.set(SUMMIT.flag.x, SUMMIT_AT.deck + SUMMIT.flagH - 0.42, SUMMIT.flag.z);
  flag.rotation.y = -0.4;
  g.add(head, flag);
  // a few stones left on the cairn
  const stones = new THREE.InstancedMesh(offeringGeometry(), solidMat(), 12);
  const s = { x: 0, y: 0, z: 0, ry: 0 }, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 12; i++) { offeringSpot(i, s); v.set(SUMMIT.cairn.x + s.x * 1.45, s.y * 1.45, SUMMIT.cairn.z + s.z * 1.45); m.compose(v, q.setFromEuler(e.set(0, s.ry, 0)), one); stones.setMatrixAt(i, m); }
  g.add(stones);
  g.userData.flag = flag;
  return g;
}

defineAsset({
  name: 'summit-lookout', group: 'structure',
  note: 'summit trail: the lookout on the rim. Deck, bench, coin-op valley viewer (E: zoom onto farmers, ←/→ cycle), waving flag, windswept pine, the summit cairn (E leaves a stone)',
  build: summitAsset,
  animate: (obj, t) => { const f = obj.userData.flag as THREE.Mesh | undefined; if (f) waveFlag(f, Number.isFinite(t) ? t : performance.now() / 1000, 4); },
});

defineAsset({
  name: 'rope-bridge', group: 'structure', note: 'summit trail: the rope bridge over the saddle between the knobs (walkable deck, sags a little)',
  build: (o) => {
    const k = new Kit(o.seed);
    const gully = (x: number, z: number) => Math.max(-3.4, 3 - 3.6 * Math.max(0, 1 - (z / 3.6) ** 2) - Math.abs(x) * 0.05);
    bridgeKit(k, { a: { x: 0, z: -4.8, y: 3.05 }, b: { x: 0, z: 4.8, y: 3.05 }, width: 1.3, sag: 0.4 }, gully);
    // the gully walls, for scale
    k.box(4, 3, 2, 0x8c8476, { y: 1.5, z: -5.8 }); k.box(4, 3, 2, 0x8c8476, { y: 1.5, z: 5.8 });
    return k.build(new THREE.Group(), o.night ?? 0);
  },
});

defineAsset({
  name: 'trail-stairs', group: 'structure', note: 'summit trail: the wooden staircase up the east knob (treads are a walkSurface, 0.24 m risers)',
  build: (o) => {
    const k = new Kit(o.seed);
    const st = { a: { x: 0, z: -4, y: 0 }, b: { x: 0, z: 4.5, y: 7.6 }, width: 1.5 };
    const ground = (_x: number, z: number) => Math.max(0, Math.min(7.6, (z + 1) * 1.8));
    stairsKit(k, st, ground);
    k.box(3, 7.6, 3, 0x8c8476, { y: 3.8, z: 6.1 });
    return k.build(new THREE.Group(), o.night ?? 0);
  },
});

defineAsset({
  name: 'trailhead', group: 'structure', note: 'summit trail: the signpost at the foot of the wall (length, climb), a lantern, a bin of walking sticks',
  build: (o) => {
    const k = new Kit(o.seed);
    const a = { x: 0, z: 0, y: 0, yaw: 0 };
    trailheadKit(k, a);
    const g = k.build(new THREE.Group(), o.night ?? 0);
    g.add(trailheadSign(a, 191, 40));
    return g;
  },
});

defineAsset({
  name: 'trail-cairn', group: 'prop', note: 'summit trail: a cairn marking the way (hairpins, the saddle)',
  build: (o) => { const k = new Kit(o.seed); cairnKit(k, 0, 0, 0, 1, o.seed); cairnKit(k, 1.2, 0, 0.3, 0.7, o.seed + 1); return k.build(new THREE.Group(), o.night ?? 0); },
});

defineAsset({
  name: 'windswept-pine', group: 'plant', note: 'summit trail: the lone pine on the summit knob, crown streaming downwind',
  build: (o) => { const k = new Kit(o.seed); windsweptPine(k, 0, 0, 0, 0, o.season); return k.build(new THREE.Group(), o.night ?? 0); },
});
