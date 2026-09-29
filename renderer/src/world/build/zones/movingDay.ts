/**
 * Amenity "moving day" (§7.2): when a bay changes hands (director.bayState(): amenity ↔ workspace), a little parade of
 * crates hops out of the bay being taken over, across Studio Street and into the nearest bay that is (still) an
 * amenity, or off toward the Plaza when none is left — 3 s, staggered, tumbling, with a squash on every hop. At boot
 * this is the "west wing becomes the amenity wing" moment (E bays fill first, their amenity kit moves west).
 * The bay signs flip on their own (greybox live signs). One InstancedMesh of a baked kit crate (toonProp
 * INSTANCED+VCOL wood, the kit's own program), hidden (scale 0) when idle. Renderer only. Owner: ENV.
 */
import * as THREE from 'three';
import { getMaterial } from '../../../render/materials/index.ts';
import { markCaster } from '../../../render/layers.ts';
import { KIT } from '../kit/registry.ts';
import { bakePart, mergeBaked, rngOf } from '../kit/core.ts';
import type { Layout, Bay } from '../../layout/schema.ts';
import type { Ctx } from '../../../core/ctx.ts';
import type { BayInfo } from '../../../chars/brain/directorHq.ts';

const N = 9, DUR = 3.0, STAGGER = 0.3, HOP = 0.36;

interface Pt2 { x: number; z: number }
interface Run { t0: number; pts: Pt2[]; seed: number }
export interface MovingDay { mesh: THREE.InstancedMesh; update: (c?: { time?: number }) => void; trigger: (from: string, to?: string | null) => void }

export function createMovingDay(layout: Layout, ctx: Pick<Ctx, 'director'>): MovingDay | null {
  const bays = layout.bays;
  const street = layout.zones.find((z) => z.id === 'STR');
  if (!bays?.length || !street) return null;
  const crate = KIT.crate;
  if (!crate) throw new Error('createMovingDay: kit has no crate');
  const item = crate({ w: 0.34, h: 0.26, d: 0.3 }, rngOf('movingDay'));
  const id = new THREE.Matrix4();
  const geo = mergeBaked(item.parts.map((p) => bakePart(p, item.colors, 1, id)));
  if (!geo) throw new Error('createMovingDay: crate bakes to no geometry');
  const mesh = new THREE.InstancedMesh(geo, getMaterial('toonProp', { instanced: true, vertexColors: true, color: '#FFFFFF', pattern: 'wood' }), N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.name = 'env:movingDay';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  markCaster(mesh);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) mesh.setMatrixAt(i, zero);
  const streetX = street.rect; // world [x0, z0, x1, z1]
  const midX = (streetX[0] + streetX[2]) / 2;
  const bayById = new Map<string, Bay>(bays.map((b) => [b.id, b]));
  /** a bay's door point just inside (in) or on the street side (out) */
  const door = (b: Bay, side: 'in' | 'out'): Pt2 => ({ x: b.storefront.x + (b.side === 'W' ? (side === 'in' ? -0.9 : 0.5) : (side === 'in' ? 0.9 : -0.5)), z: b.storefront.z });
  const runs: (Run | null)[] = new Array<Run | null>(N).fill(null);
  let prev: Map<string, string | null> | null = null, now = 0;
  const trigger = (from: string, to: string | null = null): void => {
    const a = bayById.get(from);
    if (!a) return;
    const b = to ? bayById.get(to) : null;
    const end = b ? door(b, 'in') : { x: midX, z: streetX[3] - 0.4 };
    const pts = [door(a, 'in'), door(a, 'out'), { x: midX, z: (door(a, 'out').z + (b ? door(b, 'out').z : end.z)) / 2 }, b ? door(b, 'out') : end, end];
    for (let k = 0, placed = 0; k < N && placed < 3; k++) {
      const cur = runs[k];
      if (cur && now - cur.t0 < DUR + STAGGER * 3) continue;
      runs[k] = { t0: now + placed * STAGGER, pts, seed: k * 1.7 + placed };
      placed++;
    }
  };
  const along = (pts: Pt2[], u: number) => { // piecewise-linear by length
    let L = 0; const seg: number[] = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); seg.push(l); L += l; }
    let d = u * L;
    for (let i = 0; i < seg.length; i++) { if (d <= seg[i] || i === seg.length - 1) { const f = seg[i] ? Math.min(1, d / seg[i]) : 1; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, z: pts[i].z + (pts[i + 1].z - pts[i].z) * f, dx: pts[i + 1].x - pts[i].x, dz: pts[i + 1].z - pts[i].z, L }; } d -= seg[i]; }
    const last = pts[pts.length - 1] ?? { x: 0, z: 0 };
    return { x: last.x, z: last.z, dx: 0, dz: 1, L };
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const nearestAmenity = (bid: string, state: Record<string, BayInfo>): string | null => {
    const a = bayById.get(bid);
    if (!a) return null;
    let best: string | null = null, bd = Infinity;
    for (const b of bays) {
      if (b.id === bid || state[b.id]?.ws) continue;
      const d = Math.abs(b.storefront.z - a.storefront.z) + (b.side === a.side ? 1.5 : 0);
      if (d < bd) { bd = d; best = b.id; }
    }
    return best;
  };
  return {
    mesh,
    trigger,
    update(c?: { time?: number }) {
      now = c?.time ?? performance.now() / 1000;
      const dir = ctx.director;
      if (dir?.bayState) {
        const st = dir.bayState();
        const key = (id: string): string | null => st[id]?.ws?.id ?? null;
        if (prev) {
          for (const b of bays) {
            const was = prev.get(b.id), is = key(b.id);
            if (was === is) continue;
            if (!was && is) trigger(b.id, nearestAmenity(b.id, st)); // taken over: its amenity kit moves out
            else if (was && !is) { // freed: the kit comes back from the street's south end
              const src = { ...door(b, 'out'), z: streetX[3] - 0.4 };
              for (let k = 0, placed = 0; k < N && placed < 3; k++) { const cur = runs[k]; if (cur && now - cur.t0 < DUR + 1) continue; runs[k] = { t0: now + placed * STAGGER, pts: [{ x: midX, z: src.z }, door(b, 'out'), door(b, 'in')], seed: k }; placed++; }
            }
          }
        }
        prev = new Map<string, string | null>(bays.map((b) => [b.id, key(b.id)]));
      }
      let any = false;
      for (let k = 0; k < N; k++) {
        const r = runs[k];
        if (!r) continue;
        const t = (now - r.t0) / DUR;
        if (t < 0) { mesh.setMatrixAt(k, zero); any = true; continue; }
        if (t > 1) { runs[k] = null; mesh.setMatrixAt(k, zero); any = true; continue; }
        const u = t * t * (3 - 2 * t);
        const a = along(r.pts, u);
        const hops = Math.max(3, Math.round(a.L / 0.55));
        const ph = (u * hops) % 1;
        const y = Math.sin(ph * Math.PI) * HOP * (1 - 0.4 * u);
        const squash = ph < 0.12 || ph > 0.9 ? 0.82 : 1;
        const grow = Math.min(1, t * 8, (1 - t) * 8);
        e.set(Math.sin(ph * Math.PI) * 0.35, Math.atan2(a.dx, a.dz) + Math.sin(r.seed) * 0.3, Math.sin(ph * Math.PI * 2 + r.seed) * 0.15, 'YXZ');
        q.setFromEuler(e);
        mesh.setMatrixAt(k, m.compose(p.set(a.x, y, a.z), q, s.set(grow * (2 - squash), grow * squash, grow * (2 - squash))));
        any = true;
      }
      if (any) mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = runs.some(Boolean); // [ENV fix m2 r1] no idle draw + shadow draw while no crate is out
    },
  };
}
