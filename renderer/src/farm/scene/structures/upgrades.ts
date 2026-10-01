/**
 * Town upgrades: what the Valley Almanac's ranks unlock in the world (model/almanac.ts UPGRADES, one per rank).
 * Bunting over the square, flower barrels along the roads, a fountain on the plaza, market stalls, festoon lanterns
 * over the roads, a bandstand, a patchwork hot-air balloon, a golden Clawd statue, and evening fireworks.
 *
 * Everything is built once (per season) but only joins the scene when its rank is reached; an upgrade unlocked while
 * you watch pops in with a bounce, a confetti burst and a little fanfare of sounds. A new rank also sets off a short
 * firework show, and once `fireworks` is unlocked there is a show over the south meadow every evening at nine.
 *
 * Owned by the structures system (it builds the hub dressing whose lamps the strings hang from); none of this is
 * baked, so visibility stays per upgrade. Service 'upgrades' (dev / shots): `fireworks(seconds)`.
 */
import * as THREE from 'three';
import type { AlmanacView, UpgradeId } from '../../model/almanac.ts';
import type { Season } from '../../model/types.ts';
import { PATHS, POND, RIVER, RIVER_HALF_WIDTH, SITES, STRUCTURES, WORLD, distToPolyline, heightAt, inSite } from '../../world/map.ts';
import type { AudioService, LightEmitter, LightsService, SceneCtx } from '../context.ts';
import { PAL, toon } from '../toon.ts';
import { loft } from '../sculpt.ts';
import { Kit, damp, glowMat, plaque, rng, setGlow } from './kit.ts';
import type { Env } from './rig.ts';
import { PLAZA } from './dressing.ts';
import { barrel, crate, flowerColors, pumpkin } from './props.ts';

export interface UpgradesHost {
  season: Season;
  /** the hub dressing's lamp posts (feet), plaza ring first */
  lamps: readonly THREE.Vector3[];
  /** flora trunks / bushes */
  blocked(x: number, z: number, r: number): boolean;
}

export interface Upgrades {
  update(env: Env, almanac: AlmanacView, hour: number): void;
  /** a short firework show (level-ups, dev) */
  fireworks(seconds: number): void;
  dispose(): void;
}

const LAMP_ARM = 2.75;
const WISHES = [
  'Plink! You wish for green tests on the first run.',
  'Plink! You wish for a merge with no conflicts.',
  'Plink! You wish that every farmer finishes before supper.',
  'Plink! You wish for a bumper harvest of commits.',
  'Plink! The coin glints at the bottom with all the others.',
];
const TAU = Math.PI * 2;
const easeOutBack = (x: number) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };

// ---------------------------------------------------------------------------------------------------------------
// Placement

function structDist(x: number, z: number): number {
  let d = Infinity;
  for (const s of STRUCTURES) {
    const dx = x - s.x, dz = z - s.z, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const qx = Math.abs(lx) - s.size[0] / 2, qz = Math.abs(lz) - s.size[1] / 2;
    d = Math.min(d, Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
  }
  return d;
}
const pathDist = (x: number, z: number) => Math.min(...PATHS.map((p) => distToPolyline(x, z, p.points) - p.width / 2));
const wet = (x: number, z: number, r: number) => distToPolyline(x, z, RIVER) < RIVER_HALF_WIDTH + 2 + r || Math.hypot(x - POND.x, z - POND.z) < POND.r + 2 + r || heightAt(x, z) < WORLD.water + 0.4;

/** the nearest point on any road to (x, z) */
function nearestRoad(x: number, z: number): { x: number; z: number } {
  let best = { x, z }, bd = Infinity;
  for (const p of PATHS) for (let i = 0; i < p.points.length - 1; i++) {
    const a = p.points[i], b = p.points[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = { x: px, z: pz }; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Sparks: fireworks, confetti (one instanced mesh, HDR colours for the bloom)

const MAX_SPARKS = 900;
class Sparks {
  readonly mesh: THREE.InstancedMesh;
  private readonly p = new Float32Array(MAX_SPARKS * 3);
  private readonly v = new Float32Array(MAX_SPARKS * 3);
  private readonly life = new Float32Array(MAX_SPARKS);
  private readonly max = new Float32Array(MAX_SPARKS);
  private readonly size = new Float32Array(MAX_SPARKS);
  private readonly drag = new Float32Array(MAX_SPARKS);
  private readonly grav = new Float32Array(MAX_SPARKS);
  private readonly col = new Float32Array(MAX_SPARKS * 3);
  private readonly flick = new Uint8Array(MAX_SPARKS);
  private next = 0;
  alive = 0;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), mat, MAX_SPARKS);
    this.mesh.name = 'upgrades:sparks';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3);
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_SPARKS; i++) this.mesh.setMatrixAt(i, this.m);
    this.mesh.visible = false;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, drag = 1, grav = 4, flick = false): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_SPARKS;
    if (this.life[i] <= 0) this.alive++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.drag[i] = drag; this.grav[i] = grav;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.flick[i] = flick ? 1 : 0;
  }
  update(dt: number, t: number): void {
    if (this.alive <= 0) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    let alive = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      alive++;
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 2] *= k;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const f = this.life[i] / this.max[i];
      const tw = this.flick[i] ? (Math.sin(t * 40 + i * 1.7) > 0 ? 1 : 0.25) : 1;
      const s = this.size[i] * Math.sqrt(f) * (0.6 + 0.4 * tw);
      this.m.makeScale(s, s, s).setPosition(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      this.mesh.setMatrixAt(i, this.m);
      const fade = Math.min(1, f * 2.5) * tw;
      this.c.setRGB(this.col[i * 3] * fade, this.col[i * 3 + 1] * fade, this.col[i * 3 + 2] * fade);
      this.mesh.setColorAt(i, this.c);
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const FW_COLORS: [number, number, number][] = [
  [3.2, 0.9, 0.6], [3.4, 2.4, 0.6], [0.8, 2.6, 1.2], [0.8, 1.6, 3.6], [2.8, 1.0, 3.2], [3.2, 2.9, 2.4], [3.4, 1.6, 0.5],
];

// ---------------------------------------------------------------------------------------------------------------

interface Built {
  id: UpgradeId;
  root: THREE.Object3D;
  /** where the pop-in confetti bursts */
  anchor: THREE.Vector3;
  emitters: LightEmitter[];
  colliders: [number, number, number][];
  rects: [number, number, number, number, number][];
  shown: boolean;
  pop: number;
  offs: (() => void)[];
  rig?(env: Env): void;
  /** what you can do with it once it's there */
  use?: { verb: string; label: string; pos: THREE.Vector3; reach?: number; act(): void };
  /** looping sound while shown */
  loop?: { name: 'river' | 'fire'; pos: THREE.Vector3; volume: number; h?: { setVolume(v: number): void; stop(): void } };
}

export function createUpgrades(ctx: SceneCtx, host: UpgradesHost): Upgrades {
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const lights = ctx.services.get('lights') as LightsService | undefined;
  const group = new THREE.Group();
  group.name = 'upgrades';
  ctx.scene.add(group);
  const sparks = new Sparks();
  group.add(sparks.mesh);
  const glows: THREE.MeshBasicMaterial[] = [];
  const bulbs = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const season = host.season;
  const R = rng(4242);
  const gy = (x: number, z: number) => heightAt(x, z);
  const taken: { x: number; z: number; r: number }[] = [];

  const lampHead = (l: THREE.Vector3) => new THREE.Vector3(l.x, l.y + LAMP_ARM, l.z);
  const plazaLamps = host.lamps.filter((l) => Math.hypot(l.x - PLAZA.x, l.z - PLAZA.z) < PLAZA.r + 1.5);
  const roadLamps = host.lamps.filter((l) => !plazaLamps.includes(l));

  const free = (x: number, z: number, r: number, plaza = false): boolean => {
    if (!plaza && Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 1.4 + r) return false;
    if (structDist(x, z) < r + 1.2) return false;
    if (SITES.some((s) => inSite(s, x, z, r + 1.2))) return false;
    if (!plaza && pathDist(x, z) < r + 0.5) return false;
    if (wet(x, z, r)) return false;
    if (host.blocked(x, z, r + 0.2)) return false;
    if (host.lamps.some((l) => Math.hypot(l.x - x, l.z - z) < r + 0.7)) return false;
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < r + t.r + 0.6)) return false;
    // keep it level-ish: no building on a hillside
    const h0 = gy(x, z);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; if (Math.abs(gy(x + Math.cos(a) * r, z + Math.sin(a) * r) - h0) > 0.45) return false; }
    return true;
  };
  const findSpot = (x: number, z: number, r: number): { x: number; z: number } => {
    for (let i = 0; i < 400; i++) {
      const a = i * 2.39996, d = Math.sqrt(i) * 0.6, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (free(px, pz, r)) { taken.push({ x: px, z: pz, r }); return { x: px, z: pz }; }
    }
    taken.push({ x, z, r });
    return { x, z };
  };
  const faceRoad = (x: number, z: number) => { const p = nearestRoad(x, z); return Math.atan2(p.x - x, p.z - z); };

  /** a Kit's meshes into a root (glow parts get their own material, tracked for the night) */
  const kitInto = (k: Kit, root: THREE.Object3D): LightEmitter[] => {
    const before = root.children.length;
    k.build(root, 0);
    const em: LightEmitter[] = [];
    for (const c of root.children.slice(before)) {
      const m = c as THREE.Mesh;
      if (m.userData.bake === 'glow') {
        const gm = glowMat(0);
        m.material = gm;
        glows.push(gm);
        em.push(...((m.userData.emitters as LightEmitter[] | undefined) ?? []));
      }
      delete m.userData.bake;
    }
    return em;
  };

  /** a sagging string (catenary-ish) between a and b: points along it */
  const sag = (a: THREE.Vector3, b: THREE.Vector3, droop: number, n: number) => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) { const t = i / n; out.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -droop * 4 * t * (1 - t), 0))); }
    return out;
  };

  const built: Built[] = [];
  const add = (b: Omit<Built, 'shown' | 'pop' | 'offs'>) => { const x: Built = { ...b, shown: false, pop: -1, offs: [] }; built.push(x); return x; };

  // ---- bunting: pennant strings round the plaza ring and out to the nearest road lamps ----
  {
    const k = new Kit(11);
    const cols = [PAL.red, PAL.yellow, PAL.blue, PAL.green, PAL.orange, PAL.pink, PAL.white];
    let ci = 0;
    const string = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b);
      const pts = sag(a, b, Math.min(1.4, len * 0.07), Math.max(6, Math.round(len / 0.9)));
      k.part('bunting', () => {
        for (let i = 0; i < pts.length - 1; i++) k.rod(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z, 0.012, PAL.cloth, 4);
        for (let i = 1; i < pts.length - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          const yaw = Math.atan2(q.x - p.x, q.z - p.z) + Math.PI / 2;
          k.prism([[-0.15, 0], [0.15, 0], [0, -0.34]], 0.012, cols[ci++ % cols.length], { x: p.x, y: p.y - 0.01, z: p.z, ry: yaw }, 'solid');
        }
      });
    };
    const ring = [...plazaLamps].sort((p, q) => Math.atan2(p.x - PLAZA.x, p.z - PLAZA.z) - Math.atan2(q.x - PLAZA.x, q.z - PLAZA.z));
    for (let i = 0; i < ring.length && ring.length > 1; i++) string(lampHead(ring[i]), lampHead(ring[(i + 1) % ring.length]));
    for (const l of ring) {
      const near = roadLamps.filter((r) => r.distanceTo(l) < 16).sort((p, q) => p.distanceTo(l) - q.distanceTo(l))[0];
      if (near) string(lampHead(l), lampHead(near));
    }
    const root = new THREE.Group();
    kitInto(k, root);
    add({ id: 'bunting', root, anchor: new THREE.Vector3(PLAZA.x, gy(PLAZA.x, PLAZA.z) + 4, PLAZA.z), emitters: [], colliders: [], rects: [] });
  }

  // ---- flower barrels along the roads out of the square ----
  {
    const k = new Kit(12);
    const fl = flowerColors(season);
    const spots: { x: number; z: number }[] = [];
    let side = 1;
    for (const p of PATHS) {
      let acc = 4;
      for (let i = 0; i < p.points.length - 1 && spots.length < 14; i++) {
        const a = p.points[i], b = p.points[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        for (let t = 0; t < L; t += 1) {
          acc++;
          const x = a.x + (dx * t) / L, z = a.z + (dz * t) / L, d = Math.hypot(x - PLAZA.x, z - PLAZA.z);
          if (d < PLAZA.r + 3 || d > 34 || acc < 7) continue;
          const nx = -dz / L, nz = dx / L, off = p.width / 2 + 0.75;
          const fx = x + nx * off * side, fz = z + nz * off * side;
          if (!free(fx, fz, 0.45, true) || pathDist(fx, fz) < 0.3) continue;
          taken.push({ x: fx, z: fz, r: 0.45 });
          spots.push({ x: fx, z: fz }); acc = 0; side = -side;
        }
      }
    }
    for (const [i, s] of spots.entries()) k.part('flowerBarrel', () => k.at({ x: s.x, y: gy(s.x, s.z), z: s.z, ry: i }, () => {
      k.surf(['planks', { scale: 0.9 }], () => k.cyl(0.42, 0.46, PAL.wood, { y: 0.23 }, 9, 0.46));
      for (const y of [0.08, 0.38]) k.cyl(y > 0.2 ? 0.465 : 0.43, 0.05, PAL.metalDark, { y }, 9);
      k.cyl(0.4, 0.04, PAL.soil, { y: 0.45 }, 9);
      if (season === 'winter') { k.cone(0.3, 0.7, PAL.pine, { y: 0.8 }, 6); k.ball(0.05, PAL.red, { x: 0.1, y: 0.7, z: 0.12 }); return; }
      k.ball(0.33, PAL.leafDark, { y: 0.62, s: [1, 0.7, 1] }, 1);
      for (let j = 0; j < 9; j++) { const a = j * 2.4 + i, r = 0.12 + (j % 3) * 0.08; k.ball(0.075, fl[(i + j) % fl.length], { x: Math.cos(a) * r, y: 0.78 + (j % 2) * 0.05, z: Math.sin(a) * r }); }
      for (let j = 0; j < 4; j++) { const a = j * 1.6 + i; k.ball(0.06, PAL.leaf, { x: Math.cos(a) * 0.36, y: 0.52, z: Math.sin(a) * 0.36 }); }
    }));
    const root = new THREE.Group();
    kitInto(k, root);
    const c = spots[0] ?? { x: 0, z: 14 };
    add({ id: 'planters', root, anchor: new THREE.Vector3(c.x, gy(c.x, c.z) + 1, c.z), emitters: [], colliders: spots.map((s) => [s.x, s.z, 0.45]), rects: [] });
  }

  // ---- the fountain, on the plaza's south-west quadrant (the well has the south-east) ----
  {
    const fx = PLAZA.x - 4.7, fz = PLAZA.z + 4.4, y0 = gy(fx, fz);
    taken.push({ x: fx, z: fz, r: 1.8 });
    const k = new Kit(13);
    k.part('fountain', () => k.at({ x: fx, y: y0, z: fz }, () => {
      k.surf(['rock', { scale: 0.55 }], () => {
        for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; k.box(0.98, 0.5, 0.34, i % 2 ? PAL.stone : 0xa9a294, { x: Math.sin(a) * 1.55, y: 0.25, z: Math.cos(a) * 1.55, ry: a }); }
        for (let i = 0; i < 10; i++) { const a = (i / 10 + 0.05) * TAU; k.box(1.02, 0.08, 0.42, 0xc9c2b4, { x: Math.sin(a) * 1.57, y: 0.53, z: Math.cos(a) * 1.57, ry: a }); }
        k.cyl(1.45, 0.1, 0x8f887c, { y: 0.06 }, 10);
        k.cyl(0.28, 1.05, PAL.stone, { y: 0.6 }, 8, 0.2);
        k.cyl(0.36, 0.14, 0xc9c2b4, { y: 0.12 }, 8);
        k.cyl(0.78, 0.28, PAL.stone, { y: 1.18 }, 10, 0.95);
        k.cyl(0.95, 0.06, 0xc9c2b4, { y: 1.33 }, 10);
        k.cyl(0.12, 0.35, PAL.stone, { y: 1.5 }, 6, 0.08);
        k.ball(0.13, 0xd9a93a, { y: 1.72 }, 1);
      });
    }));
    const root = new THREE.Group();
    kitInto(k, root);
    const waterMat = toon(0x7cc8f0, { emissive: 0x2a6f9a, emissiveIntensity: 0.35 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.04, 20), waterMat);
    basin.position.set(fx, y0 + 0.4, fz);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.02, 16), waterMat);
    bowl.position.set(fx, y0 + 1.365, fz);
    root.add(basin, bowl);
    // jets: droplets on parabolas from the spout into the bowl, and a curtain from the bowl rim into the basin
    const N = 56;
    const drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.032, 0), toon(0xbfe8ff, { emissive: 0x4aa3d8, emissiveIntensity: 0.5 }), N);
    drops.castShadow = false;
    root.add(drops);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 3, 24), new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.6 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(fx, y0 + 0.43, fz);
    root.add(ring);
    const M = new THREE.Matrix4();
    add({
      id: 'fountain', root, anchor: new THREE.Vector3(fx, y0 + 1.8, fz), emitters: [], colliders: [[fx, fz, 1.8]], rects: [],
      loop: { name: 'river', pos: new THREE.Vector3(fx, y0 + 0.8, fz), volume: 0.22 },
      use: { verb: 'Toss a coin into', label: 'The fountain', pos: new THREE.Vector3(fx, y0 + 0.9, fz), reach: 3.8, act: () => {
        const p = new THREE.Vector3(fx + (R() - 0.5) * 1.2, y0 + 0.45, fz + (R() - 0.5) * 1.2);
        audio()?.play('splash', { pos: p, volume: 0.5 });
        for (let i = 0; i < 12; i++) { const a = R() * TAU; sparks.spawn(p.x, p.y, p.z, Math.cos(a) * 0.8, 1.5 + R(), Math.sin(a) * 0.8, 0.6, 0.05, 0.8, 1.4, 1.9, 2, 6); }
        ctx.ui.say(WISHES[Math.floor(R() * WISHES.length)]);
      } },
      rig(e) {
        for (let i = 0; i < N; i++) {
          const top = i < 24;
          const ph = ((e.t * (top ? 0.9 : 1.3) + i * 0.618) % 1);
          const a = i * 2.39996 + (top ? 0 : 0.3);
          let x: number, y: number, r: number;
          if (top) { r = 0.1 + ph * 0.62; y = 1.72 + 0.55 * ph - 0.9 * ph * ph * 1.5; x = r; }
          else { r = 0.9 + ph * 0.3; y = 1.3 - ph * ph * 0.9; x = r; }
          M.makeTranslation(fx + Math.cos(a) * x, y0 + y, fz + Math.sin(a) * x);
          drops.setMatrixAt(i, M);
        }
        drops.instanceMatrix.needsUpdate = true;
        const rp = (e.t * 0.6) % 1;
        ring.scale.setScalar(0.95 + rp * 0.4);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - rp);
        basin.position.y = y0 + 0.4 + Math.sin(e.t * 3) * 0.006;
      },
    });
  }

  // ---- market stalls ----
  {
    const k = new Kit(14);
    const root = new THREE.Group();
    const stalls: { x: number; z: number; yaw: number }[] = [];
    const first = findSpot(-14.5, 7, 1.9);
    stalls.push({ ...first, yaw: faceRoad(first.x, first.z) });
    const second = findSpot(first.x - 1.5, first.z + 4.5, 1.9);
    stalls.push({ ...second, yaw: faceRoad(second.x, second.z) });
    const awning = [[PAL.red, PAL.white], [PAL.green, 0xfff3d6]];
    const produce = [[PAL.apple, PAL.pumpkin, PAL.cabbage], [PAL.wheat, PAL.grape, PAL.strawberry]];
    stalls.forEach((s, si) => k.part('marketStall', () => k.at({ x: s.x, y: gy(s.x, s.z), z: s.z, ry: s.yaw }, () => {
      // posts and counter (front = +z, toward the road)
      for (const [x, z] of [[-1.1, 0.45], [1.1, 0.45], [-1.1, -0.55], [1.1, -0.55]]) k.surf(['logs', { axis: 'y', scale: 0.5 }], () => k.box(0.12, z > 0 ? 2.15 : 2.45, 0.12, PAL.woodDark, { x, y: z > 0 ? 1.07 : 1.22, z }));
      k.surf(['planks', { axis: 'x' }], () => k.box(2.3, 0.85, 0.75, PAL.plank, { y: 0.43, z: 0.15 }));
      k.box(2.45, 0.07, 0.92, PAL.woodLight, { y: 0.88, z: 0.18 });
      // striped awning sloping to the front
      for (let i = 0; i < 7; i++) {
        const x = -1.2 + (i + 0.5) * (2.4 / 7);
        k.surf(['fabric', { axis: 'z', scale: 0.6 }], () => k.box(2.4 / 7 + 0.005, 0.05, 1.5, awning[si][i % 2], { x, y: 2.32, z: -0.05, rx: -0.26 }));
        k.prism([[-0.17, 0], [0.17, 0], [0, -0.2]], 0.04, awning[si][i % 2], { x, y: 2.11, z: 0.69 });
      }
      // produce in crates on the counter, a price board
      for (let j = 0; j < 3; j++) {
        const x = -0.72 + j * 0.72;
        crate(k, { x, y: 0.92, z: 0.18 }, 0.42);
        for (let q = 0; q < 6; q++) {
          const c = produce[si][j];
          if (c === PAL.pumpkin && q < 2) { pumpkin(k, { x: x + (q - 0.5) * 0.18, y: 1.3, z: 0.18 }, 0.12); continue; }
          if (c === PAL.pumpkin) continue;
          k.ball(c === PAL.wheat ? 0.07 : 0.085, c, { x: x + ((q % 3) - 1) * 0.12, y: 1.37 + Math.floor(q / 3) * 0.06, z: 0.12 + Math.floor(q / 3) * 0.1, s: c === PAL.wheat ? [0.7, 1.6, 0.7] : 1 }, 0);
        }
      }
      k.box(0.7, 0.42, 0.04, 0x3d4a3a, { x: 0.85, y: 0.55, z: 0.55, rx: 0.12 });
      k.box(0.78, 0.5, 0.03, PAL.woodDark, { x: 0.85, y: 0.55, z: 0.53, rx: 0.12 });
      for (let l = 0; l < 3; l++) k.box(0.42 - l * 0.08, 0.025, 0.01, 0xf4f0e6, { x: 0.82, y: 0.66 - l * 0.1, z: 0.575, rx: 0.12 });
      barrel(k, { x: -1.55, y: 0, z: -0.2, s: 0.75 });
      crate(k, { x: 1.5, y: 0, z: -0.3, ry: 0.4 }, 0.5);
    })));
    kitInto(k, root);
    add({ id: 'market', root, anchor: new THREE.Vector3(first.x, gy(first.x, first.z) + 2, first.z), emitters: [], colliders: [],
      use: { verb: 'Browse', label: 'The market stalls', pos: new THREE.Vector3(first.x, gy(first.x, first.z) + 1.2, first.z), reach: 3.8, act: () => {
        audio()?.play('page', { pos: new THREE.Vector3(first.x, gy(first.x, first.z) + 1, first.z) });
        const t = lastAlmanac?.today;
        const c = t?.counts ?? {};
        const bits = [c.commit ? `${c.commit} crate${c.commit === 1 ? '' : 's'} of commits` : '', c.tests ? `${c.tests} basket${c.tests === 1 ? '' : 's'} of green tests` : '', c.finished ? `${c.finished} finished job${c.finished === 1 ? '' : 's'}` : ''].filter(Boolean);
        ctx.ui.say(bits.length ? `Fresh today: ${bits.join(', ')}. Prices are very reasonable.` : 'The stalls are stocked from yesterday. Today\'s harvest isn\'t in yet.');
      } }, rects: stalls.map((s) => [s.x - Math.sin(s.yaw) * 0.05, s.z - Math.cos(s.yaw) * 0.05, 2.6, 1.3, s.yaw]) });
  }

  // ---- festoon lanterns between the road lamps ----
  {
    const k = new Kit(15);
    const root = new THREE.Group();
    const colors = [0xffb347, 0xff7a7a, 0x9be0a0, 0xffe27a, 0x9cc8ff];
    const bulbG: THREE.BufferGeometry[] = [];
    const em: LightEmitter[] = [];
    const used = new Set<string>();
    let ci = 0;
    for (const a of roadLamps) {
      const b = roadLamps.filter((q) => q !== a && q.distanceTo(a) > 5 && q.distanceTo(a) < 15).sort((p, q) => p.distanceTo(a) - q.distanceTo(a))[0];
      if (!b) continue;
      const key = [a, b].map((v) => `${v.x.toFixed(1)},${v.z.toFixed(1)}`).sort().join('|');
      if (used.has(key) || used.size >= 12) continue;
      used.add(key);
      const A = lampHead(a).add(new THREE.Vector3(0, 0.1, 0)), B = lampHead(b).add(new THREE.Vector3(0, 0.1, 0));
      const len = A.distanceTo(B);
      const pts = sag(A, B, Math.min(1.1, len * 0.075), Math.max(6, Math.round(len / 1.1)));
      k.part('festoon', () => {
        for (let i = 0; i < pts.length - 1; i++) k.rod(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z, 0.012, PAL.ink, 4);
        for (let i = 1; i < pts.length; i++) k.box(0.03, 0.08, 0.03, PAL.ink, { x: pts[i].x, y: pts[i].y - 0.04, z: pts[i].z });
      });
      for (let i = 1; i < pts.length; i++) {
        const g = new THREE.IcosahedronGeometry(0.075, 0);
        g.translate(pts[i].x, pts[i].y - 0.13, pts[i].z);
        const c = new THREE.Color(colors[ci++ % colors.length]);
        const n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        bulbG.push(g);
      }
      const mid = pts[Math.floor(pts.length / 2)];
      em.push({ pos: mid.clone().add(new THREE.Vector3(0, -0.3, 0)), color: new THREE.Color(1.0, 0.62, 0.3), intensity: 0.32, radius: 5.5, flicker: 0.1 });
    }
    kitInto(k, root);
    if (bulbG.length) {
      const merged = new THREE.BufferGeometry();
      const total = bulbG.reduce((s, g) => s + g.attributes.position.count, 0);
      const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
      let o = 0;
      for (const g of bulbG) { pos.set(g.attributes.position.array as Float32Array, o * 3); col.set(g.attributes.color.array as Float32Array, o * 3); o += g.attributes.position.count; g.dispose(); }
      merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(merged, bulbs);
      m.castShadow = false;
      root.add(m);
    }
    const c = roadLamps[0] ?? new THREE.Vector3(0, 0, 14);
    add({ id: 'lanterns', root, anchor: lampHead(c), emitters: em, colliders: [], rects: [] });
  }

  // ---- the bandstand, south-west of the square ----
  {
    const s = findSpot(-12, 18, 3.1);
    const y0 = gy(s.x, s.z);
    const yaw = faceRoad(s.x, s.z);
    const k = new Kit(16);
    const R8 = 2.6;
    k.part('bandstand', () => k.at({ x: s.x, y: y0, z: s.z, ry: yaw }, () => {
      k.surf(['brick', { scale: 0.7 }], () => k.cyl(R8 + 0.1, 0.6, 0xc9b49a, { y: 0.3 }, 8));
      k.surf(['planks', { axis: 'x', scale: 0.8 }], () => k.cyl(R8 + 0.2, 0.1, PAL.plank, { y: 0.65, ry: Math.PI / 8 }, 8));
      // steps at the front
      for (let i = 0; i < 3; i++) k.box(1.4, 0.2, 0.34, PAL.stone, { y: 0.1 + i * 0.2, z: R8 + 0.5 - i * 0.3 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + Math.PI / 8;
        const x = Math.sin(a) * R8, z = Math.cos(a) * R8;
        k.box(0.16, 2.5, 0.16, PAL.wallWhite, { x, y: 1.95, z });
        const b = ((i + 1) / 8) * TAU + Math.PI / 8;
        const bx = Math.sin(b) * R8, bz = Math.cos(b) * R8;
        if (i !== 7 && i !== 0) {
          k.beam(x, 1.6, z, bx, 1.6, bz, 0.08, PAL.wallWhite);
          for (let q = 1; q < 6; q++) { const t = q / 6; k.box(0.05, 0.85, 0.05, PAL.wallWhite, { x: x + (bx - x) * t, y: 1.15, z: z + (bz - z) * t }); }
        }
        // scalloped trim under the eaves
        k.beam(x, 3.15, z, bx, 3.15, bz, 0.12, 0x3f6f9a);
        for (let q = 0; q < 4; q++) { const t = (q + 0.5) / 4; k.prism([[-0.16, 0], [0.16, 0], [0, -0.22]], 0.03, q % 2 ? PAL.red : PAL.white, { x: x + (bx - x) * t, y: 3.1, z: z + (bz - z) * t, ry: Math.atan2(bx - x, bz - z) + Math.PI / 2 }); }
      }
      k.surf(['shingle', { scale: 0.8 }], () => k.cone(R8 + 0.55, 1.7, 0x3f6f9a, { y: 4.05, ry: Math.PI / 8 }, 8));
      k.cyl(0.06, 0.6, PAL.ink, { y: 5.1 }, 5);
      k.ball(0.12, 0xd9a93a, { y: 4.95 }, 1);
      // music stands and a little drum
      for (const x of [-0.8, 0.8]) { k.cyl(0.02, 1.0, PAL.ink, { x, y: 1.2, z: 0.4 }, 4); k.box(0.42, 0.3, 0.02, PAL.ink, { x, y: 1.75, z: 0.42, rx: -0.4 }); }
      k.cyl(0.32, 0.36, PAL.red, { x: 0, y: 0.88, z: -0.9 }, 10);
      k.cyl(0.33, 0.04, PAL.cloth, { x: 0, y: 1.07, z: -0.9 }, 10);
    }));
    const root = new THREE.Group();
    kitInto(k, root);
    // weathervane: a little rooster that swings into the wind
    const vk = new Kit(17);
    vk.prism([[-0.3, 0], [0.32, 0], [0.38, 0.18], [0.22, 0.36], [0.06, 0.3], [-0.12, 0.42], [-0.3, 0.3]], 0.03, PAL.ink, { y: 0, ry: Math.PI / 2 });
    vk.beam(0, -0.05, -0.45, 0, -0.05, 0.45, 0.04, PAL.ink);
    vk.cone(0.07, 0.16, PAL.ink, { y: -0.05, z: 0.5, rx: Math.PI / 2 }, 4);
    const vane = vk.mesh();
    vane.position.set(s.x, y0 + 5.45, s.z);
    root.add(vane);
    let vy = 0;
    add({
      id: 'bandstand', root, anchor: new THREE.Vector3(s.x, y0 + 3.5, s.z), emitters: [], colliders: [[s.x, s.z, R8 + 0.3]], rects: [],
      use: { verb: 'Strike up', label: 'The bandstand', pos: new THREE.Vector3(s.x, y0 + 1.6, s.z), reach: 4.2, act: () => {
        audio()?.play('fanfare', { pos: new THREE.Vector3(s.x, y0 + 2, s.z), volume: 0.8 });
        confetti(new THREE.Vector3(s.x, y0 + 3.2, s.z));
        ctx.ui.say('Ta-ra-ra! A little tune drifts over the square.');
      } },
      rig(e) {
        const w = Math.atan2(e.wind.x, e.wind.z) || 0;
        vy = damp(vy, w + Math.sin(e.t * 0.7) * 0.25, 1.5, e.dt);
        vane.rotation.y = vy;
      },
    });
    bandstandAt = { x: s.x, z: s.z, y: y0 };
  }

  // ---- the hot-air balloon over the south meadow ----
  {
    const root = new THREE.Group();
    const cols = [0xe8553e, 0xf6c23e, 0x4f8fd8, 0xf6f1e6, 0x6abf5a, 0xe87ab0];
    const env = loft([
      { p: [0, 0, 0], r: 0.55, up: [0, 0, 1] }, { p: [0, 1.2, 0], r: 1.4, up: [0, 0, 1] }, { p: [0, 3.1, 0], r: 3.0, up: [0, 0, 1] },
      { p: [0, 5.0, 0], r: 3.2, up: [0, 0, 1] }, { p: [0, 6.6, 0], r: 2.3, up: [0, 0, 1] }, { p: [0, 7.4, 0], r: 0.9, up: [0, 0, 1] },
    ], { sides: 16, sub: 3, caps: ['open', 'pole'], round: 0.4, paint: (f) => {
      const gore = Math.floor(((f.a % TAU) + TAU) % TAU / (TAU / 16));
      if (f.t > 0.8) return cols[0];
      if (f.y < 1.1) return 0xd8c8a0;
      return cols[(gore + (f.y > 4.2 ? 1 : 0) * 2) % cols.length];
    } });
    const envM = new THREE.Mesh(env, toon(0xffffff, { vertexColors: true }));
    envM.castShadow = true;
    const bk = new Kit(18);
    bk.surf(['hay', { scale: 0.6 }], () => bk.box(1.1, 0.8, 1.1, 0xb9894a, { y: -2.0 }));
    bk.box(1.2, 0.1, 1.2, 0x8a5a2a, { y: -1.58 });
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) bk.rod(x, -1.58, z, x * 1.1, 0.05, z * 1.1, 0.02, 0x6e4a2a, 4);
    bk.cyl(0.18, 0.3, PAL.metalDark, { y: -0.9 }, 6);
    for (let i = 0; i < 4; i++) bk.ball(0.12, [PAL.red, PAL.yellow, PAL.blue, PAL.green][i], { x: i % 2 ? 0.62 : -0.62, y: -2.1, z: i < 2 ? 0.62 : -0.62, s: [0.7, 1.4, 0.7] });
    const basket = bk.mesh(toon(0xffffff, { vertexColors: true }));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.5), toneMapped: false }));
    flame.position.y = -0.55;
    const craft = new THREE.Group();
    craft.add(envM, basket, flame);
    root.add(craft);
    const C = { x: 6, z: 34 };
    let burn = 0, burnT = 3;
    add({
      id: 'balloon', root, anchor: new THREE.Vector3(C.x, 30, C.z), emitters: [], colliders: [], rects: [],
      rig(e) {
        const a = e.t * 0.012;
        craft.position.set(C.x + Math.cos(a) * 22, 27 + Math.sin(e.t * 0.21) * 1.6, C.z + Math.sin(a) * 14);
        craft.rotation.z = Math.sin(e.t * 0.33) * 0.04;
        craft.rotation.x = Math.sin(e.t * 0.27 + 1) * 0.03;
        burnT -= e.dt;
        if (burnT <= 0) { burn = 1.2; burnT = 6 + Math.sin(e.t) * 3 + 3; }
        burn = Math.max(0, burn - e.dt);
        flame.visible = burn > 0;
        flame.scale.set(1, 0.6 + Math.sin(e.t * 30) * 0.15 + Math.min(1, burn) * 0.8, 1);
      },
    });
  }

  // ---- the golden Clawd statue, on the plaza's north-east quadrant ----
  {
    const sx = PLAZA.x + 4.7, sz = PLAZA.z - 4.4, y0 = gy(sx, sz);
    taken.push({ x: sx, z: sz, r: 1.1 });
    const yaw = Math.atan2(PLAZA.x - sx, PLAZA.z - sz) + 0.4;
    const k = new Kit(19);
    const GOLD = 0xf0b94a, GOLD_D = 0xc98f2a;
    k.part('statue', () => k.at({ x: sx, y: y0, z: sz, ry: yaw }, () => {
      k.surf(['rock', { scale: 0.5 }], () => {
        k.box(1.6, 0.25, 1.6, 0xa9a294, { y: 0.12 });
        k.box(1.25, 0.95, 1.25, PAL.stone, { y: 0.72 });
        k.box(1.45, 0.14, 1.45, 0xc9c2b4, { y: 1.25 });
      });
      // Clawd: block body with two eye notches, arm nubs, four stubby legs (the mascot silhouette is sacred)
      k.at({ y: 1.32, s: 1.15 }, () => {
        for (const x of [-0.33, -0.11, 0.11, 0.33]) k.box(0.13, 0.26, 0.2, GOLD_D, { x, y: 0.13 });
        k.box(1.0, 0.62, 0.56, GOLD, { y: 0.57 });
        for (const x of [-0.6, 0.6]) k.box(0.22, 0.2, 0.3, GOLD, { x, y: 0.55 });
        for (const x of [-0.2, 0.2]) k.box(0.1, 0.17, 0.04, 0x5a3c12, { x, y: 0.66, z: 0.27 });
        k.box(1.02, 0.04, 0.58, 0xffe08a, { y: 0.89 });
      });
    }));
    const root = new THREE.Group();
    kitInto(k, root);
    const pq = plaque(1.1, 0.42);
    pq.set({ title: 'For every farmer', value: 'who shipped', sub: 'Claude Valley', accent: '#c98f2a' });
    pq.mesh.position.set(sx + Math.sin(yaw) * 0.64, y0 + 0.75, sz + Math.cos(yaw) * 0.64);
    pq.mesh.rotation.y = yaw;
    root.add(pq.mesh);
    let glintT = 2;
    add({
      id: 'statue', root, anchor: new THREE.Vector3(sx, y0 + 2.2, sz), emitters: [], colliders: [[sx, sz, 1.0]], rects: [],
      use: { verb: 'Admire', label: 'The golden Clawd', pos: new THREE.Vector3(sx, y0 + 1.8, sz), act: () => {
        audio()?.play('sparkle', { pos: new THREE.Vector3(sx, y0 + 2, sz) });
        for (let i = 0; i < 18; i++) { const a = R() * TAU; sparks.spawn(sx, y0 + 2 + R() * 0.6, sz, Math.cos(a) * 1.2, 0.8 + R(), Math.sin(a) * 1.2, 0.9, 0.08, 3.2, 2.7, 1.4, 1.5, 0.5); }
        const a = lastAlmanac;
        ctx.ui.say(a ? `"For every farmer who shipped." ${a.points.toLocaleString()} prosperity and counting.` : '"For every farmer who shipped."');
      } },
      rig(e) {
        glintT -= e.dt;
        if (glintT <= 0 && e.night < 0.6) {
          glintT = 2.5 + R() * 4;
          const gx = sx + (R() - 0.5) * 0.9, gz = sz + (R() - 0.5) * 0.4;
          sparks.spawn(gx, y0 + 1.6 + R() * 0.8, gz, 0, 0.05, 0, 0.5, 0.09, 3.2, 3, 2.2, 1, 0);
        }
      },
    });
  }

  // ---- fireworks: nothing to build, they are sparks ----
  add({ id: 'fireworks', root: new THREE.Group(), anchor: new THREE.Vector3(0, 24, 40), emitters: [], colliders: [], rects: [] });

  // ---------------------------------------------------------------------------------------------------------------
  // Showing / hiding

  const vecFor = (b: Built) => b.anchor;
  const show = (b: Built, pop: boolean) => {
    if (b.shown) return;
    b.shown = true;
    group.add(b.root);
    for (const [x, z, r] of b.colliders) b.offs.push(ctx.colliders.circle(x, z, r));
    for (const [x, z, w, d, y] of b.rects) b.offs.push(ctx.colliders.rect(x, z, w, d, y));
    if (lights) for (const e of b.emitters) b.offs.push(lights.add(e));
    if (b.use) {
      const u = b.use;
      b.offs.push(ctx.interact.add({ id: `upgrade:${b.id}`, kind: 'structure', verb: u.verb, label: () => u.label, pos: (o) => o.copy(u.pos), reach: u.reach ?? 3.4, use: u.act }));
    }
    if (b.loop) { const h = audio()?.loop(b.loop.name, b.loop.pos); if (h) { h.setVolume(b.loop.volume); b.loop.h = h; } }
    if (pop && b.id !== 'fireworks') {
      b.pop = 0;
      scaleAbout(b, 0.001, 0.001);
      confetti(vecFor(b));
      audio()?.play('pop', { pos: vecFor(b), volume: 0.9 });
      setTimeout(() => audio()?.play('sparkle', { pos: vecFor(b) }), 250);
    }
  };
  const hide = (b: Built) => {
    if (!b.shown) return;
    b.shown = false;
    group.remove(b.root);
    for (const f of b.offs) f();
    b.offs = [];
    b.loop?.h?.stop();
    if (b.loop) b.loop.h = undefined;
  };

  // pop-in scales about each upgrade's own foot (anchor on the ground), without re-parenting: rigs write world coords
  const pivotOf = (b: Built) => new THREE.Vector3(b.anchor.x, b.id === 'balloon' ? 0 : gy(b.anchor.x, b.anchor.z), b.anchor.z);
  const scaleAbout = (b: Built, sx: number, sy: number) => {
    const p = pivotOf(b);
    b.root.scale.set(sx, sy, sx);
    b.root.position.set(p.x * (1 - sx), p.y * (1 - sy), p.z * (1 - sx));
  };

  function confetti(p: THREE.Vector3): void {
    for (let i = 0; i < 70; i++) {
      const a = R() * TAU, up = 3 + R() * 4, out = 1 + R() * 2.5;
      const c = FW_COLORS[i % FW_COLORS.length];
      sparks.spawn(p.x, p.y, p.z, Math.cos(a) * out, up, Math.sin(a) * out, 1.4 + R() * 1.2, 0.07, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 1.6, 5, true);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Fireworks

  interface Rocket { x: number; y: number; z: number; vy: number; t: number; kind: number; color: number; trail: number }
  const rockets: Rocket[] = [];
  let showLeft = 0, launchT = 0, nightlyDay = '';
  const flash: LightEmitter = { pos: new THREE.Vector3(0, 25, 40), color: new THREE.Color(1, 0.8, 0.6), intensity: 0, radius: 45, when: 'always', gain: 0 };
  const flashOff = lights?.add(flash);
  const launchSite = { x: 0, z: 46 };
  const launch = () => {
    const x = launchSite.x + (R() - 0.5) * 24, z = launchSite.z + (R() - 0.5) * 10;
    const y = gy(x, z);
    rockets.push({ x, y, z, vy: 24 + R() * 4, t: 0, kind: Math.floor(R() * 4), color: Math.floor(R() * FW_COLORS.length), trail: 0 });
    audio()?.play('firework', { pos: new THREE.Vector3(x, y + 20, z), volume: 0.8, pitch: 0.9 + R() * 0.2 });
  };
  const burst = (r: Rocket) => {
    const c = FW_COLORS[r.color], c2 = FW_COLORS[(r.color + 3) % FW_COLORS.length];
    const n = r.kind === 2 ? 80 : 120;
    for (let i = 0; i < n; i++) {
      let vx: number, vy: number, vz: number;
      if (r.kind === 1) { const a = (i / n) * TAU; vx = Math.cos(a) * 15; vy = Math.sin(a) * 12; vz = Math.sin(a) * 6; }
      else { const u = R() * 2 - 1, a = R() * TAU, s = Math.sqrt(1 - u * u), sp = (r.kind === 2 ? 9 : 15) * (0.85 + R() * 0.3); vx = Math.cos(a) * s * sp; vy = u * sp; vz = Math.sin(a) * s * sp; }
      const col = r.kind === 2 ? [3.4, 2.4, 0.9] : i % 3 === 0 ? c2 : c;
      sparks.spawn(r.x, r.y, r.z, vx, vy, vz, r.kind === 2 ? 2.8 : 1.5 + R() * 0.4, r.kind === 2 ? 0.26 : 0.32, col[0], col[1], col[2], r.kind === 2 ? 1.8 : 1.3, r.kind === 2 ? 3 : 5, r.kind === 3);
    }
    flash.pos.set(r.x, r.y, r.z);
    flash.color.setRGB(c[0] / 3.4, c[1] / 3.4, c[2] / 3.4);
    flash.intensity = 0.9; flash.gain = 1;
  };
  const updateFireworks = (dt: number, t: number) => {
    if (showLeft > 0) {
      showLeft -= dt;
      launchT -= dt;
      if (launchT <= 0) { launch(); launchT = 0.5 + R() * 1.3; if (R() < 0.25) setTimeout(launch, 180); }
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.t += dt; r.y += r.vy * dt; r.vy -= 6 * dt;
      r.trail -= dt;
      if (r.trail <= 0) { r.trail = 0.03; sparks.spawn(r.x, r.y, r.z, (R() - 0.5) * 0.4, -1, (R() - 0.5) * 0.4, 0.45, 0.08, 3, 2, 1, 2, 2); }
      if (r.t >= 0.95) { burst(r); rockets.splice(i, 1); }
    }
    flash.gain = Math.max(0, (flash.gain ?? 0) - dt * 2.2);
    flash.intensity = 0.9 * (flash.gain ?? 0);
    sparks.update(dt, t);
  };

  // ---------------------------------------------------------------------------------------------------------------

  let primed = false;
  let lastAlmanac: AlmanacView | null = null;
  let unsub: (() => void) | null = ctx.onValley((e) => { if (e.kind === 'level-up') { showLeft = Math.max(showLeft, 16); launchT = 1.6; } });
  const svc = { fireworks: (s: number) => { showLeft = Math.max(showLeft, s); launchT = 0; } };
  ctx.services.set('upgrades', svc);

  return {
    update(e, almanac, hour) {
      lastAlmanac = almanac;
      const have = new Set(almanac.unlocked);
      for (const b of built) {
        if (have.has(b.id)) show(b, primed);
        else hide(b);
        if (!b.shown) continue;
        if (b.pop >= 0) {
          b.pop += e.dt / 0.85;
          const s = b.pop >= 1 ? 1 : Math.max(0.001, easeOutBack(b.pop));
          scaleAbout(b, s, b.pop >= 1 ? 1 : Math.max(0.001, easeOutBack(Math.min(1, b.pop * 1.15))));
          if (b.pop >= 1) b.pop = -1;
        }
        b.rig?.(e);
      }
      primed = true;
      // nine o'clock show, once a day
      if (have.has('fireworks') && hour >= 21 && hour < 21.03) {
        const day = new Date().toDateString();
        if (day !== nightlyDay) { nightlyDay = day; showLeft = Math.max(showLeft, 100); launchT = 0; }
      }
      for (const m of glows) setGlow(m, e.night);
      bulbs.color.setScalar(0.8 + e.night * 1.9);
      updateFireworks(e.dt, e.t);
    },
    fireworks: svc.fireworks,
    dispose() {
      for (const b of built) hide(b);
      flashOff?.();
      unsub?.(); unsub = null;
      if (ctx.services.get('upgrades') === svc) ctx.services.delete('upgrades');
      ctx.scene.remove(group);
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      for (const m of glows) m.dispose();
      bulbs.dispose();
    },
  };
}

let bandstandAt: { x: number; z: number; y: number } | null = null;
/** where the bandstand stands (for the farmers' / villagers' outings later), null until built */
export const bandstandSpot = () => bandstandAt;
