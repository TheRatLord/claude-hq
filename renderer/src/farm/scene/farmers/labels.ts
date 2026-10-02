/**
 * In-world labels: nameplates ("claude-hq · planting store.ts"), the villagers' role signboards, speech / needs-you
 * bubbles and duckling labels. The scene only decides what shows where (anchor, text, fade); the HUD draws them as
 * DOM overlays anchored to the world point (`UiPort.tag`, see `WorldTag` in scene/context.ts), so they stay crisp and
 * legible at night, in fog and rain, stack per character and nudge apart instead of overlapping.
 *
 * Big buildings (the light occluders: farmhouse, barn, toolshed, silo, windmill) hide the labels behind them: a
 * segment-vs-box test from the eye, faded per key. No per-frame allocation once a key has been seen.
 */
import * as THREE from 'three';
import type { LightOccluder, LightsService, SceneCtx, TagStyle, WorldTag } from '../context.ts';

export type LabelStyle = TagStyle;

/** does the segment eye → p pass through the box (a little shrunk so labels by a wall still show)? Allocation-free. */
export function segmentHitsBox(o: LightOccluder, ex: number, ey: number, ez: number, px: number, py: number, pz: number): boolean {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  // into the box frame (Colliders.rect convention: local x = (cos, -sin), local z = (sin, cos))
  const ax = (ex - o.x) * c - (ez - o.z) * s, az = (ex - o.x) * s + (ez - o.z) * c;
  const bx = (px - o.x) * c - (pz - o.z) * s, bz = (px - o.x) * s + (pz - o.z) * c;
  const hw = o.w / 2 - 0.1, hd = o.d / 2 - 0.1;
  slabT0 = 0; slabT1 = 1;
  return slab(ax, bx, -hw, hw) && slab(az, bz, -hd, hd) && slab(ey, py, o.y0, o.y1 - 0.1);
}
let slabT0 = 0, slabT1 = 1;
function slab(a: number, b: number, lo: number, hi: number): boolean {
  const d = b - a;
  if (Math.abs(d) < 1e-9) return a >= lo && a <= hi;
  let u = (lo - a) / d, v = (hi - a) / d;
  if (u > v) { const t = u; u = v; v = t; }
  slabT0 = Math.max(slabT0, u); slabT1 = Math.min(slabT1, v);
  return slabT0 <= slabT1;
}

export class Labels {
  private readonly tag: WorldTag = { key: '', owner: '', style: 'name', title: '', sub: '', pos: new THREE.Vector3(), alpha: 0, dist: 0 };
  private readonly seen = new Map<string, number>();
  private readonly eye = new THREE.Vector3();
  private shown = 0;
  private dt = 0;
  private readonly ctx: SceneCtx;
  constructor(ctx: SceneCtx) { this.ctx = ctx; }

  begin(dt = 1 / 60): void { this.shown = 0; this.dt = dt; this.ctx.camera.getWorldPosition(this.eye); }

  /** Show a label this frame, its bottom centre at `pos` (just above the head). */
  show(key: string, owner: string, style: LabelStyle, title: string, sub: string, pos: THREE.Vector3, alpha: number): void {
    const ui = this.ctx.ui;
    if (!ui.tag || alpha < 0.02 || !title) return;
    const e = this.eye;
    let vis = 1;
    const occ = (this.ctx.services.get('lights') as LightsService | undefined)?.occluders();
    if (occ) for (let i = 0; i < occ.length; i++) if (segmentHitsBox(occ[i], e.x, e.y, e.z, pos.x, pos.y, pos.z)) { vis = 0; break; }
    // keys are per farmer and farmers come and go all day: a fade state is cheap to lose, an ever-growing map is not
    if (this.seen.size > 512 && !this.seen.has(key)) this.seen.clear();
    const prev = this.seen.get(key) ?? vis;
    const k = prev + (vis - prev) * Math.min(1, this.dt * 10);
    this.seen.set(key, k);
    const a = alpha * k;
    if (a < 0.02) return;
    const t = this.tag;
    t.key = key; t.owner = owner; t.style = style; t.title = title; t.sub = sub; t.alpha = a;
    t.pos.copy(pos);
    t.dist = e.distanceTo(pos);
    ui.tag(t);
    this.shown++;
  }

  end(): void { /* the HUD hides whatever was not shown this frame */ }

  /** labels shown this frame (perf overlay) */
  visible(): number { return this.shown; }
}
