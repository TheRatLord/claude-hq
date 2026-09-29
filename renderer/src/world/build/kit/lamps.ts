/**
 * Prop kit: lamp family (§7.5 row 12): desk (knuckled arm), floor (drum on a tripod / pole), floorArc, pendant
 * (cone / dome / drum), street lamp, string span. Local origin = the lamp's floor point (pendant: the bulb; string
 * span: the first end). Bulbs are the `bulb` class (emissive 1.8, dimmer by day); fabric shades are `shade` (glow
 * only after dark). Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, torus, tube, disc, at, part, vary, detail } from './core.ts';
import type { KitParams, Part, Rng, SlotName } from './core.ts';
import { T } from './tokens.ts';

const PI = Math.PI;
/** Inner cavity of every shade: a warm dark (reads as a hollow from below by day; glows with the shade after dark). */
const CAVITY = '#6E5A45';
/**
 * [ENV fix r1] A smooth shade shell (§7.5 "no faceted"): outer surface (body), inner cavity (dark, normals inward), a
 * rolled rim bead round the open bottom and a thin top bead; ≥ 32 radial segments, the profile sampled finely.
 * `prof` = outer [radius, y] from the open bottom rim up to the top edge (a dome ends at radius 0).
 */
/** A lathe profile: [radius, y] pairs, bottom → top. */
type Profile = [number, number][];
function shadeShell(prof: Profile, o: { seg?: number; t?: number; slot?: SlotName; rim?: number } = {}): Part[] {
  const seg = o.seg ?? 32, t = o.t ?? 0.008, parts: Part[] = [];
  parts.push(part(smoothLathe(prof, seg), o.slot ?? 'body', { mat: 'shade' }));
  // inner surface: the profile offset inward along its 2D normal, reversed (so the lathe faces point inward)
  const inner = prof.map(([r, y], i): [number, number] => {
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [Math.max(0, r - (dy / L) * t), y + (dx / L) * t];
  }).reverse();
  // [ENV fix m3 r1] §5.3 tris (the office-wide glow group drew ≈ 40k tris from every pose): the dark inner cavity is never
  // a silhouette, so it takes half the radial segments and every other profile point (its chords only move further
  // inside the outer shell); the beads drop a ring of their tube (rim 6 → 5, top 4 → 3 at half the segments)
  const innerLo = inner.length > 4 ? inner.filter((_, i) => i % 2 === 0 || i === inner.length - 1) : inner;
  parts.push(part(smoothLathe(innerLo, Math.max(12, Math.round(seg / 2))), 'body', { mat: 'shade', color: CAVITY, ao: 0.8, cast: false }));
  const [rb, yb] = prof[0];
  parts.push(part(at(torus(rb, o.rim ?? 0.011, 5, seg), 0, yb, 0, PI / 2), 'accent', { cast: false })); // rolled rim
  const [rt, yt] = prof[prof.length - 1];
  if (rt > 0.02) parts.push(part(at(torus(rt, 0.006, 3, Math.max(12, Math.round(seg / 2))), 0, yt, 0, PI / 2), 'accent', { cast: false }));
  return parts;
}
/** A lathe that keeps its full segment count at near detail (core.lathe caps segments by radius; a shade's
 *  silhouette is the one place faceting shows, review m175 r1). The far LOD still scales it. */
const smoothLathe = (prof: Profile, seg: number) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), detail() < 1 ? Math.max(8, Math.round(seg * detail())) : seg);
/** Profiles: straight-sided (drum / cone) and a dome (quarter superellipse + a slight flare at the rim). */
const straightProf = (rb: number, rt: number, h: number, y0 = 0): Profile => [[rb, y0], [rb + (rt - rb) * 0.5, y0 + h * 0.5], [rt, y0 + h]];
const domeProf = (R: number, H: number, y0 = 0, n = 14): Profile => {
  const pts: Profile = [[R * 1.03, y0 - 0.012]];
  for (let i = 0; i <= n; i++) { const f = (i / n) * PI / 2; pts.push([R * Math.cos(f) ** 0.85, y0 + H * Math.sin(f) ** 1.15]); }
  pts[pts.length - 1][0] = 0;
  return pts;
};
/** Bulb + dark socket above it (visible from below through the open shade). */
const bulb = (x: number, y: number, z: number, r = 0.035) => part(at(sphere(r, 10, 6), x, y, z), 'bulb', { mat: 'bulb', cast: false }); // [ENV fix m2 r1] 10×6 (was 16×12: 62k tris of bulbs)
const socket = (x: number, y: number, z: number, r = 0.018) => part(at(cyl(r, r * 1.1, r * 2.4, 8), x, y, z), 'secondary', { cast: false });

/**
 * 12 · lamp: kind ∈ desk | floor | floorArc | pendant | street | string.
 */
export function buildLamp(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), kind = p.kind ?? 'desk';
  // weighted bell base: every face steeper than 25°, so it never reads as a floor-level plate (a flat plate's
  // outline is a floor-on-floor line for edge.ts / edgeCheck)
  const BELL = () => lathe([[0, 0], [0.15, 0], [0.155, 0.01], [0.12, 0.042], [0.05, 0.078], [0.02, 0.082], [0, 0.082]], 18);
  const parts = [];
  const colors = { body: v.pick([T.butter, T.trim, T.linen]), secondary: T.ink2, accent: T.brass };
  switch (kind) {
    case 'desk': { // knuckled arm; the shade faces +z and down
      parts.push(part(at(disc(0.075, 0.025, 16, 0.008), 0, 0, 0), 'secondary'));
      parts.push(part(at(sphere(0.018, 8, 6), 0, 0.03, 0), 'accent'));
      const e1 = [0, 0.03, 0], e2 = [0, 0.22, -0.05], e3 = [0, 0.33, 0.1];
      parts.push(part(tube([e1, e2], 0.009, 2, 6), 'secondary'));
      parts.push(part(at(sphere(0.016, 8, 6), ...e2), 'accent'));
      parts.push(part(tube([e2, e3], 0.008, 2, 6), 'secondary'));
      parts.push(part(at(sphere(0.014, 8, 6), ...e3), 'accent'));
      for (const q of shadeShell([[0.075, -0.1], [0.03, 0]], { seg: 24, t: 0.005, rim: 0.007 })) { at(q.geometry, e3[0], e3[1] + 0.01, e3[2] + 0.02, 0.9, 0, 0); parts.push(q); }
      parts.push(bulb(e3[0], e3[1] - 0.03, e3[2] + 0.07, 0.022));
      return { parts, footprint: { r: 0.08 }, solid: false, anchors: { bulb: [0, 0.3, 0.17] }, colors, small: false, hero: 'knuckled arm, conical shade + rim' };
    }
    case 'floor': { // drum shade on a pole over a weighted base (the layout's `floor` lamp: bulb at bulbY)
      const by = p.bulbY ?? 1.45;
      parts.push(part(BELL(), 'secondary'));
      parts.push(part(at(cyl(0.014, 0.016, by - 0.05, 8), 0, (by + 0.05) / 2, 0), 'secondary'));
      parts.push(part(at(torus(0.022, 0.008, 4, 10), 0, by * 0.55, 0, PI / 2), 'accent')); // collar
      parts.push(...shadeShell(straightProf(0.23, 0.19, 0.28, by - 0.1), { seg: 36 }));
      parts.push(part(at(torus(0.012, 0.004, 4, 10), 0, by + 0.16, 0, PI / 2), 'accent', { cast: false })); // finial ring
      parts.push(part(at(sphere(0.02, 10, 8), 0, by + 0.19, 0), 'accent'));
      parts.push(socket(0, by + 0.05, 0));
      parts.push(bulb(0, by - 0.02, 0, 0.045));
      return { parts, footprint: { r: 0.18 }, solid: false, anchors: { bulb: [0, by, 0] }, colors, hero: 'drum shade + brass rim, visible bulb' };
    }
    case 'floorArc': {
      parts.push(part(BELL(), 'secondary'));
      const pts = [[0, 0.05, 0], [0, 1.2, 0], [0.2, 1.75, 0.15], [0.55, 1.85, 0.4], [0.8, 1.7, 0.55]];
      parts.push(part(tube(pts, 0.014, 20, 6), 'secondary'));
      for (const q of shadeShell(domeProf(0.16, 0.13, 0, 7), { seg: 32 })) { at(q.geometry, 0.8, 1.56, 0.55); parts.push(q); }
      parts.push(socket(0.8, 1.645, 0.55, 0.016));
      parts.push(bulb(0.8, 1.6, 0.55, 0.035));
      return { parts, footprint: { r: 0.2 }, solid: false, anchors: { bulb: [0.8, 1.6, 0.55] }, colors: { ...colors, body: T.trim }, hero: 'arc + dome shade' };
    }
    case 'pendant': { // bulb at the origin; cord up `drop` m to a ceiling canopy
      const drop = p.drop ?? 0.6, shape = p.shape ?? v.pick(['cone', 'dome', 'drum']);
      parts.push(part(at(cyl(0.004, 0.004, drop, 4), 0, drop / 2 + 0.08, 0), 'secondary', { cast: false }));
      parts.push(part(at(lathe([[0.0, 0], [0.07, 0], [0.06, 0.03], [0, 0.03]], 12), 0, drop + 0.05, 0), 'secondary', { cast: false }));
      if (shape === 'dome') parts.push(...shadeShell(domeProf(0.24, 0.2, -0.05, 7), { seg: 36, rim: 0.013 }));
      else if (shape === 'drum') parts.push(...shadeShell(straightProf(0.24, 0.24, 0.24, -0.06), { seg: 36, rim: 0.012 }));
      else parts.push(...shadeShell(straightProf(0.2, 0.05, 0.2, -0.05), { seg: 36 }));
      parts.push(part(at(cyl(0.02, 0.02, 0.06, 12), 0, shape === 'cone' ? 0.17 : 0.18, 0), 'accent', { cast: false }));
      parts.push(socket(0, 0.085, 0, 0.02));
      parts.push(bulb(0, 0.02, 0, 0.045));
      return { parts, footprint: { r: 0.25 }, solid: false, anchors: { bulb: [0, 0, 0] }, colors, hero: `${shape} shade + brass rim` };
    }
    case 'street': { // [ENV M2 breadth STR] carriage lantern: fluted post, frosted panes in an iron frame, dome cap
      const by = p.bulbY ?? 2.4, L0 = by - 0.16, L1 = by + 0.16, hw = 0.1;
      parts.push(part(lathe([[0, 0], [0.16, 0], [0.155, 0.03], [0.1, 0.07], [0.07, 0.16], [0.055, 0.2], [0, 0.2]], 16), 'secondary'));
      parts.push(part(at(cyl(0.035, 0.045, L0 - 0.3, 12), 0, 0.2 + (L0 - 0.3) / 2, 0), 'secondary'));
      for (const y of [0.62, L0 - 0.14]) parts.push(part(at(torus(0.048, 0.012, 4, 14), 0, y, 0, PI / 2), 'accent'));
      parts.push(part(lathe([[0.035, L0 - 0.12], [0.06, L0 - 0.06], [0.12, L0 - 0.02], [0.13, L0], [0, L0]], 14), 'secondary')); // cup
      for (let k = 0; k < 4; k++) { // frosted panes (shade: glow after dark) + iron corner posts
        const a = k * PI / 2;
        parts.push(part(at(rbox(2 * hw - 0.02, L1 - L0, 0.012, 0.004), Math.sin(a) * hw, (L0 + L1) / 2, Math.cos(a) * hw, 0, a, 0, 1, 1, 1), 'body', { mat: 'shade' }));
        parts.push(part(at(rbox(0.022, L1 - L0 + 0.02, 0.022, 0.006), Math.sin(a + PI / 4) * hw * 1.41, (L0 + L1) / 2, Math.cos(a + PI / 4) * hw * 1.41), 'secondary'));
      }
      parts.push(part(lathe([[0.17, L1], [0.16, L1 + 0.03], [0.1, L1 + 0.1], [0.03, L1 + 0.15], [0, L1 + 0.16]], 4).rotateY(PI / 4), 'secondary')); // pyramid cap
      parts.push(part(at(sphere(0.025, 10, 8), 0, L1 + 0.18, 0), 'accent'));
      parts.push(bulb(0, by, 0, 0.055));
      return { parts, footprint: { r: 0.16 }, solid: true, anchors: { bulb: [0, by, 0] }, colors: { ...colors, body: '#F1E4C4', secondary: '#46433F' }, hero: 'carriage lantern: frosted panes, iron frame, pyramid cap' };
    }
    case 'string': { // catenary between (0,0,0) and (len,0,0), n bulbs
      const len = p.len ?? 3, sag = p.sag ?? 0.35, n = p.n ?? Math.max(3, Math.round(len / 0.5));
      const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([t * len, -sag * 4 * t * (1 - t), 0]); }
      parts.push(part(tube(pts, 0.004, 16, 3), 'secondary', { cast: false }));
      for (let k = 1; k < n; k++) { const t = k / n; parts.push(bulb(t * len, -sag * 4 * t * (1 - t) - 0.05, 0, 0.03)); parts.push(part(at(cyl(0.012, 0.012, 0.03, 6), t * len, -sag * 4 * t * (1 - t) - 0.02, 0), 'accent', { cast: false })); }
      return { parts, footprint: { w: len, d: 0.1 }, solid: false, anchors: {}, colors, hero: 'sagging catenary + bulbs' };
    }
    default: throw new Error(`lamp kind ${kind}`);
  }
}

