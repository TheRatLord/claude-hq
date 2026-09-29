/**
 * Atrium ceiling fans ∝ load (DESIGN §7.4 "CPU total, load" row, GP §3.4): four clay paddle fans on downrods under
 * the 5.5 m atrium ceiling around the skylight. Speed = load1 / threads (honest: a lazy turn at idle, a whirr at full
 * load, clamped), eased so a spike spins them up over a few seconds. Two draws (static rods + one instanced rotor).
 * Fallback only: STAT's world/stats/weather.ts owns the 'fans' anchor; index.ts builds these when no 'fans' stat
 * factory is registered. Owner: AMB.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getMaterial } from '../../render/materials/index.ts';
import { CORE, ENV } from '../../../../shared/palette.ts';
import { W, damp } from './util.ts';
import type { AmbFrame, AmbScene, AmbStore } from './util.ts';
import type { HqLayout } from '../layout/schema.ts';

/** Fan speed in revolutions / s for a load average and thread count (pure). */
export function fanRps(load1: number | null | undefined, threads: number | null | undefined): number {
  if (load1 == null || !Number.isFinite(load1) || !(threads != null && threads > 0)) return 0.12;
  const u = Math.max(0, Math.min(1.25, load1 / threads));
  return 0.1 + 1.2 * u;
}

/** Plan positions (x, z) of the fans: the corners around the skylight, clear of the stairs and the Big Board. */
const SPOTS: [number, number][] = [[16.2, 10.4], [24.8, 10.4], [16.2, 18.4], [24.8, 18.4]];

const tint = (g: THREE.BufferGeometry, hex: string) => {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.index) return g.toNonIndexed();
  return g;
};
const strip = (g: THREE.BufferGeometry) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k); return g; };

export function createFans(d: { layout: HqLayout; scene: AmbScene; store?: AmbStore }) {
  const { layout, scene, store } = d;
  const ceil = layout.skylight?.y ?? 5.5;
  const rodTop = ceil, hubY = ceil - 0.75;
  const group = new THREE.Group();
  group.name = 'amb:fans';
  // static: downrod + canopy + motor housing (vertex colours, one mesh)
  const statics: THREE.BufferGeometry[] = [];
  const rotorParts: THREE.BufferGeometry[] = [];
  // rotor (local, spins about y): hub cap + 5 paddles with a trim tip
  rotorParts.push(tint(strip(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 20).translate(0, -0.02, 0)), CORE.ink2));
  rotorParts.push(tint(strip(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -0.08, 0)), ENV.butter));
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2;
    const blade = new RoundedBoxGeometry(0.62, 0.03, 0.2, 2, 0.012);
    blade.rotateX(0.16).translate(0.5, 0, 0).rotateY(a);
    rotorParts.push(tint(strip(blade), ENV.walnut));
    const tip = new RoundedBoxGeometry(0.1, 0.034, 0.205, 2, 0.012);
    tip.rotateX(0.16).translate(0.78, 0, 0).rotateY(a);
    rotorParts.push(tint(strip(tip), ENV.oak));
    const arm = new THREE.BoxGeometry(0.2, 0.025, 0.05).translate(0.24, 0.02, 0).rotateY(a);
    rotorParts.push(tint(strip(arm), CORE.ink2));
  }
  const rotorGeo = mergeGeometries(rotorParts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  const pts = SPOTS.map(([x, z]) => W(x, z));
  for (const p of pts) {
    statics.push(tint(strip(new THREE.CylinderGeometry(0.018, 0.018, rodTop - hubY - 0.1, 8).translate(p.x, (rodTop + hubY) / 2 + 0.05, p.z)), CORE.ink2));
    statics.push(tint(strip(new THREE.CylinderGeometry(0.12, 0.08, 0.06, 16).translate(p.x, rodTop - 0.03, p.z)), CORE.ink2));
    statics.push(tint(strip(new THREE.CylinderGeometry(0.13, 0.15, 0.14, 18).translate(p.x, hubY + 0.1, p.z)), ENV.butter));
  }
  // [RND fix r1, cross-owner AMB] count-1 InstancedMesh + instanced material: the §5.4 toonProp program (a plain Mesh
  // compiled an off-matrix `hq|toonProp|VCOL` variant)
  const matS = getMaterial('toonProp', { color: '#FFFFFF', vertexColors: true, instanced: true });
  const mStatic = new THREE.InstancedMesh(mergeGeometries(statics.map((g) => (g.index ? g.toNonIndexed() : g)), false), matS, 1);
  mStatic.name = 'amb:fans:rods';
  group.add(mStatic);
  const matR = getMaterial('toonProp', { color: '#FFFFFF', vertexColors: true, instanced: true });
  const rotor = new THREE.InstancedMesh(rotorGeo, matR, pts.length);
  rotor.name = 'amb:fans:rotors';
  rotor.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rotor.frustumCulled = false;
  group.add(rotor);
  for (const m of [mStatic, rotor]) { m.castShadow = false; m.receiveShadow = true; }
  scene.add(group);

  const S = { rps: 0.12, angle: 0, want: 0.12 };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
  const write = () => {
    for (let i = 0; i < pts.length; i++) {
      q.setFromAxisAngle(Y, S.angle * (i % 2 ? 1 : -1) + i * 0.7);
      pos.set(pts[i].x, hubY, pts[i].z);
      rotor.setMatrixAt(i, m4.compose(pos, q, one));
    }
    rotor.instanceMatrix.needsUpdate = true;
  };
  write();

  function update(c: AmbFrame, camera: THREE.Camera | null | undefined) {
    const st = store?.stats;
    S.want = fanRps(st?.cpu?.load?.[0], st?.cpu?.cores?.length);
    S.rps = damp(S.rps, S.want, 0.6, c.dt);
    S.angle += S.rps * Math.PI * 2 * c.dt;
    // only write matrices when the fans can be seen from here (atrium / pit / lobby / mezzanine)
    const cz = camera ? c.camZone : 'ATR';
    const vis = cz === 'ATR' || cz === 'PIT' || cz === 'LOB' || cz === 'MEZ' || cz === 'LIB' || cz === 'CAF' || cz === 'ENG';
    group.visible = vis;
    if (vis) write();
  }
  return {
    update,
    get rps() { return S.rps; },
    debug: () => ({ rps: +S.rps.toFixed(2), want: +S.want.toFixed(2) }),
    dispose() { scene.remove(group); mStatic.geometry.dispose(); rotorGeo.dispose(); rotor.dispose(); },
  };
}
