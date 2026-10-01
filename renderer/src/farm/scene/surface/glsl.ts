/**
 * GLSL for the surface library: helpers (hashes, value noise, AA steps, dots, strokes, cells) and one function per
 * surface, `vec3 surf_<name>(SurfIn s, vec3 c)`, that takes the base (vertex/palette) colour and returns it
 * hand-painted: a few bold value steps (seams darker and cooler, highlights lighter and warmer), never a replacement.
 *
 * Rules for every function here: no derivatives (callers may branch per surface; `s.pw` is the pixel footprint in
 * metres, computed once before any branching), fade features smaller than a few pixels with `slod`, fade fine
 * detail with `s.near` (distance), stay cheap (value noise, one-dot-per-cell, 3×3 cells only for stones/leaves).
 */
import { SURF } from './ids.ts';

export const SURF_LIB = /* glsl */ `
struct SurfIn {
  vec3 p;       // pattern position, object space, metres (÷ scale)
  vec3 n;       // object-space normal
  vec2 uv;      // face coords: v runs along the tag axis, u across it (metres ÷ scale)
  float pw;     // pixel footprint, metres (÷ scale)
  float near;   // 1 close … 0 beyond the detail distance
  float variant;
  float aux;    // per-vertex scalar (logs: distance from the axis)
  float along;  // |normal · axis| (1 = looking down the axis: log ends)
  vec3 off;     // per-instance pattern offset included in p (p - off = true local position)
  vec2 eye;     // the viewer in uv (ground strokes point away from it); far down -v when unknown
};

float sh1(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 sh2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float svn(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh1(i), sh1(i + vec2(1.0, 0.0)), u.x), mix(sh1(i + vec2(0.0, 1.0)), sh1(i + vec2(1.0, 1.0)), u.x), u.y);
}
/** anti-aliased step: 0 below e, 1 above, over ±w (w = how much x changes per pixel) */
float sst(float e, float x, float w) { w = max(w, 1e-4); return clamp((x - e) / (2.0 * w) + 0.5, 0.0, 1.0); }
/** visibility of a feature of size cell metres: 0 at ≤ 2 px, 1 at ≥ 6 px */
float slod(float cell, float pw) { return clamp(cell / max(pw, 1e-5) * 0.25 - 0.5, 0.0, 1.0); }
float sluma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
/** value step: k > 0 lighter and a touch warmer, k < 0 darker and a touch cooler (shadows lean blue) */
vec3 sval(vec3 c, float k) { return c * (1.0 + k * (k >= 0.0 ? vec3(1.04, 1.0, 0.86) : vec3(1.04, 1.0, 0.78))); }
vec3 sgrey(vec3 c, float k) { return mix(c, vec3(sluma(c)), k); }
/** 3 posterised tones from a hash: -1, 0, 1 */
float stone3(float h) { return h < 0.3 ? -1.0 : (h > 0.74 ? 1.0 : 0.0); }

/** one round dot per cell (p in cells, r radius in cells, occ = share of cells with a dot, w = cells per pixel).
 *  x coverage, y hash, z vertical position in the dot (-1 bottom … 1 top), w distance / r (99 when empty) */
vec4 sdot(vec2 p, float r, float occ, float w) {
  vec2 i = floor(p), f = fract(p); vec2 h = sh2(i);
  r *= 0.65 + 0.7 * fract(h.y * 7.31);   // organic: sizes vary per cell
  vec2 c = 0.5 + (sh2(i + 7.13) - 0.5) * (1.0 - 2.4 * r);
  vec2 d = f - c; float l = length(d);
  float on = step(h.x, occ);
  return vec4((1.0 - sst(r, l, w)) * on, h.y, d.y / r, mix(99.0, l / r, on));
}
/** one short tapered stroke per cell (angle ang ± jitter, len/wid in cells): x coverage, y hash */
vec2 sdash(vec2 p, float ang, float len, float wid, float occ, float w) {
  vec2 i = floor(p); vec2 h = sh2(i); vec2 h2 = sh2(i + 3.7);
  vec2 f = fract(p) - 0.5 - (h2 - 0.5) * max(0.0, 1.0 - len - wid * 2.0);
  float a = ang + (h.y - 0.5) * 1.1;
  vec2 d = vec2(cos(a), sin(a));
  float t = clamp(dot(f, d), -len * 0.5, len * 0.5);
  float taper = wid * (1.0 - 0.7 * abs(t) / (len * 0.5));
  return vec2((1.0 - sst(taper, length(f - d * t), w)) * step(h.x, occ), h.y);
}
/** a painted tuft mark per cell: 2–4 thin, gently curved blades from bases spread along a short line, each with its
 *  own length, spread and bend, so no two tufts are alike (p and eye in cells, len/wid in cells, occ = share of
 *  cells with a tuft): x coverage, y hash, z position along the covering blade (0 base … 1 tip) */
vec3 stuft(vec2 p, vec2 eye, float len, float wid, float occ, float w) {
  vec2 i = floor(p); vec2 h = sh2(i);
  if (h.x >= occ) return vec3(0.0, h.y, 0.0);
  vec2 h2 = sh2(i + 3.7);
  // blades point away from the eye (= up on screen), like real tufts standing on the ground, with a lean per tuft
  vec2 d0 = i + 0.5 - eye;
  d0 = dot(d0, d0) > 1e-4 ? normalize(d0) : vec2(0.0, 1.0);
  float ra = (h.y - 0.5) * 0.9, cr = cos(ra), sr = sin(ra);
  vec2 d = vec2(d0.x * cr - d0.y * sr, d0.y * cr + d0.x * sr);
  vec2 sd = vec2(-d.y, d.x) * (h2.x > 0.5 ? 1.0 : -1.0);   // mirrored half of the time
  len *= 0.7 + 0.6 * h2.y;
  vec2 f = fract(p) - (vec2(0.5) + (h2 - 0.5) * (0.9 - 2.0 * len) - d * len * 0.45);
  if (dot(f - d * len * 0.5, f - d * len * 0.5) > len * len * 0.5 + wid * 4.0) return vec3(0.0, h.y, 0.0);
  float cov = 0.0, tip = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    vec2 r = fract(h2 * vec2(fk * 3.17 + 5.3, fk * 5.31 + 7.1) + h.yx * (fk + 1.7));   // per-blade randoms
    if (k == 3 && r.x < 0.5) break;                       // 3 or 4 blades (the first two always)
    float a = (fk - 1.2) * 0.36 + (r.y - 0.5) * 0.45;       // uneven fan
    vec2 e = d * cos(a) + sd * sin(a);
    vec2 nr = vec2(-e.y, e.x);
    float l = len * (0.45 + 0.55 * r.x);
    vec2 g = f - sd * ((fk - 1.3) * wid * 1.4);            // bases spread sideways
    float t = clamp(dot(g, e), 0.0, l);
    float tt = t / l;
    vec2 ctr = e * t + nr * ((r.y - 0.5) * 0.6 * l * tt * tt);   // a gentle bend towards the tip
    float cv = 1.0 - sst(wid * (1.0 - tt), length(g - ctr), w);
    if (cv > cov) { cov = cv; tip = tt; }
  }
  return vec3(cov, h.y, tip);
}
/** a hand-painted crack per cell: a tapered stroke that kinks once (p in cells, wid in cells): x coverage, y hash */
vec2 scrack(vec2 p, float occ, float wid, float w) {
  vec2 i = floor(p); vec2 h = sh2(i); vec2 h2 = sh2(i + 5.1);
  float a = h.y * 6.2832;
  vec2 d = vec2(cos(a), sin(a));
  float kink = (h2.x - 0.5) * 1.6;
  vec2 e = vec2(d.x * cos(kink) - d.y * sin(kink), d.y * cos(kink) + d.x * sin(kink));
  vec2 f = fract(p) - 0.5 - (h2 - 0.5) * 0.2;
  float L = 0.34;
  // main stroke from -L*d to the kink at +0.1*d, then a thinner tail along e
  vec2 a0 = -d * L, a1 = d * 0.1;
  float t0 = clamp(dot(f - a0, d) / (L + 0.1), 0.0, 1.0);
  float c0 = 1.0 - sst(wid * (0.25 + 0.75 * sin(t0 * 3.1416)), length(f - a0 - d * t0 * (L + 0.1)), w);
  float t1 = clamp(dot(f - a1, e) / 0.26, 0.0, 1.0);
  float c1 = 1.0 - sst(wid * 0.7 * (1.0 - t1), length(f - a1 - e * t1 * 0.26), w);
  return vec2(max(c0, c1) * step(h.x, occ), h.y);
}
/** pixel footprint in metres of a pattern position: between the geometric mean and the long axis of the pixel
 *  (keeps ground detail at grazing angles without shimmer). Call from uniform control flow only. */
float surfPw(vec3 p) {
  float lx = length(dFdx(p)), ly = length(dFdy(p));
  return mix(sqrt(lx * ly), max(lx, ly), 0.4);
}
/** stones / clumps: x distance to own centre, y edge distance estimate (F2-F1), z cell hash, w offset above the
 *  centre; off = pixel − centre (cells) */
vec4 svor2(vec2 p, float jit, out vec2 off) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  off = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = g + 0.5 + (sh2(i + g) - 0.5) * jit - f;
    float d = dot(o, o);
    if (d < d1) { d2 = d1; d1 = d; id = sh1(i + g + 11.7); off = -o; } else if (d < d2) d2 = d;
  }
  d1 = sqrt(d1);
  return vec4(d1, sqrt(d2) - d1, id, off.y);
}
vec4 svor(vec2 p, float jit) { vec2 o; return svor2(p, jit, o); }
/** the two-tone blotch every natural surface gets: +up where n > hi, -down where n < lo */
vec3 sblot(vec3 c, float n, float lo, float hi, float up, float down, float w) {
  return sval(c, up * sst(hi, n, w) - down * (1.0 - sst(lo, n, w)));
}

/** face frame: v along the axis projected into the face, u across it */
vec2 surfUV(vec3 p, vec3 n, int axis, out float along) {
  vec3 A = axis == 1 ? vec3(1.0, 0.0, 0.0) : (axis == 2 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0));
  if (axis == 3) { vec3 h = vec3(n.z, 0.0, -n.x); A = dot(h, h) > 0.02 ? normalize(h) : vec3(1.0, 0.0, 0.0); }
  along = abs(dot(n, A));
  vec3 V = A - n * dot(A, n);
  if (dot(V, V) < 0.04) { vec3 B = axis == 2 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0); V = B - n * dot(B, n); }
  V = normalize(V);
  vec3 U = cross(V, n);
  return vec2(dot(p, U), dot(p, V));
}

// ------------------------------------------------------------------ ground

/** grass hue step: k > 0 sunny (warmer, yellower, lighter), k < 0 shade / lush (cooler blue-green, darker) */
vec3 sgreen(vec3 c, float k) {
  return c * (1.0 + (k >= 0.0 ? vec3(1.0, 0.8, -0.3) : vec3(1.2, 0.62, 0.05)) * k);
}

vec3 surf_grass(SurfIn s, vec3 c) {
  vec2 q = s.uv;
  float n1 = svn(q * 0.075 + 3.1);                     // ≈ 13 m: warm/cool patches, stroke direction, clump drifts
  float n2 = svn(q * 0.38 + 11.0);                     // ≈ 2.6 m: sun dapples, tuft density
  float lc = slod(0.45, s.pw);
  float n4 = mix(0.5, lc > 0.0 ? svn(q * 3.3) : 0.5, lc);   // ≈ 0.3 m breakup (edges), only where it resolves
  // warm / cool patches: three painted tones with soft, slightly broken edges
  float wc = n1 * 0.8 + n2 * 0.2;
  c = sgreen(c, 0.1 * sst(0.57, wc, s.pw * 0.12 + 0.02) - 0.12 * (1.0 - sst(0.43, wc, s.pw * 0.12 + 0.02)));
  // sun-dappled blotches, ragged by the fine octave
  float dap = n2 * 0.8 + n4 * 0.2;
  c = sgreen(c, 0.1 * slod(1.2, s.pw) * sst(0.62, dap, s.pw + 0.01));
  float clump = 0.0;
  if (lc > 0.0) {
    // darker clumps (clover / lush tussocks, 0.4–1.2 m) gathered in drifts
    float cl = svn(q * 1.25 + 5.0) * 0.65 + n4 * 0.35;
    clump = (1.0 - sst(0.28 + 0.2 * n1, cl, s.pw * 1.8 + 0.01)) * lc;
    c = sgreen(c, -0.14 * clump);
    // brush strokes: soft streaks along a slowly turning direction (grass lying in the wind, not a flat fill)
    float ang = n1 * 5.0;
    vec2 dir = vec2(cos(ang), sin(ang));
    float st = svn(vec2(dot(q, dir) * 0.75, dot(q, vec2(-dir.y, dir.x)) * 3.4) + 21.0);
    float lsk = slod(0.25, s.pw);
    c = sval(c, lsk * (0.05 * sst(0.7, st, s.pw * 3.4 + 0.02) - 0.045 * (1.0 - sst(0.3, st, s.pw * 3.4 + 0.02))));
  }
  float lt = slod(0.06, s.pw) * s.near;
  if (lt > 0.0) {
    // painted tufts in clumpy drifts: small dark ones, and lighter sunlit ones between them; each blade dark at its
    // base and catching the light at its tip (tufts read as standing, not stamped)
    float occ = 0.12 + 0.5 * sst(0.45, n2 + clump * 0.3, 0.2);
    vec3 a = stuft(q * 4.6, s.eye * 4.6, 0.42, 0.05, occ, s.pw * 4.6);
    vec3 b = stuft(q * 6.3 + 17.0, s.eye * 6.3 + 17.0, 0.4, 0.05, 0.75 - occ * 0.6, s.pw * 6.3);
    float ka = mix(-0.2, 0.05, a.z) - 0.05 * a.y, kb = mix(-0.05, 0.15, b.z);
    c = sgreen(c, lt * (kb * b.x * (1.0 - a.x) + ka * a.x));
  }
  return c;
}

vec3 surf_meadow(SurfIn s, vec3 c) {
  c = surf_grass(s, c);
  float m = svn(s.uv * 0.16 + 9.0);
  c = mix(c, c * vec3(1.12, 1.08, 0.78), 0.55 * sst(0.6, m, s.pw * 0.25 + 0.003));
  float ls = slod(0.07, s.pw) * s.near;
  vec4 f = sdot(s.uv * 3.2, 0.08, 0.22, s.pw * 3.2);
  vec3 petal = f.y < 0.55 ? vec3(0.92, 0.9, 0.84) : vec3(0.95, 0.72, 0.22);
  petal = mix(petal, vec3(0.95, 0.75, 0.25), step(f.w, 0.35) * step(f.y, 0.55));   // yellow eye
  return mix(c, petal * (0.55 + sluma(c)), f.x * ls * 0.9);
}

vec3 surf_soil(SurfIn s, vec3 c) {
  float x = s.uv.x / 0.45 + (svn(s.uv * 1.5) - 0.5) * 0.3;
  float prof = abs(fract(x) - 0.5) * 2.0;           // 0 ridge crest … 1 furrow
  float w = s.pw / 0.45 * 2.0;
  float lr = slod(0.18, s.pw);
  c = sval(c, lr * (0.1 * (1.0 - sst(0.35, prof, w)) - 0.2 * sst(0.78, prof, w)));
  float lc = slod(0.05, s.pw) * s.near;
  vec4 d = sdot(s.uv * 7.0, 0.34, 0.6, s.pw * 7.0);
  c = sval(c, lc * d.x * (d.z > 0.0 ? 0.13 : -0.1));
  vec4 e = sdot(s.uv * 17.0 + 3.0, 0.3, 0.35, s.pw * 17.0);
  return sval(c, -0.12 * e.x * slod(0.03, s.pw) * s.near);
}

vec3 surf_dirt(SurfIn s, vec3 c) {
  vec2 q = s.uv;
  c = sblot(c, svn(q * 0.55 + 4.0), 0.3, 0.64, 0.06, 0.06, s.pw * 0.8 + 0.003);
  float lp = slod(0.05, s.pw) * s.near;
  if (lp > 0.0) {
    // a few small half-buried stones: a touch greyer and lighter on top, a soft shadow on their lower side
    vec4 pb = sdot(q * 4.2 + 2.3, 0.17, 0.15, s.pw * 4.2);
    float rim = (1.0 - sst(1.4, pb.w, s.pw * 4.2 / 0.17)) * (1.0 - pb.x) * step(pb.z, 0.0);
    vec3 st = sval(sgrey(c, 0.3), (pb.z > 0.15 ? 0.09 : -0.02) + (pb.y - 0.5) * 0.12);
    c = mix(sval(c, -0.14 * rim * lp), st, pb.x * lp);
  }
  vec4 e = sdot(q * 11.0, 0.25, 0.35, s.pw * 11.0);
  return sval(c, -0.1 * e.x * slod(0.03, s.pw) * s.near);
}

vec3 surf_cobble(SurfIn s, vec3 c) {
  vec4 v = svor(s.uv / 0.3, 0.8);
  float lm = slod(0.3, s.pw);
  float mortar = 1.0 - sst(0.13, v.y, s.pw / 0.3 * 2.0);
  vec3 st = sval(c, stone3(v.z) * 0.09 + (0.38 - v.x) * 0.2 + 0.05 * sst(0.15, v.w, s.pw / 0.3));
  vec3 mo = sval(sgrey(c, 0.4), -0.38);
  return mix(c, mix(st, mo, mortar), lm);
}

vec3 surf_sand(SurfIn s, vec3 c) {
  vec2 q = s.uv;
  float r = dot(q, vec2(0.8, 0.6)) + svn(q * 0.4) * 1.6;
  float f = fract(r / 0.42);
  float w = s.pw / 0.42 * 1.5;
  float l = slod(0.1, s.pw) * s.near;
  c = sval(c, l * (0.08 * (1.0 - sst(0.12, f, w)) - 0.06 * sst(0.16, f, w) * (1.0 - sst(0.36, f, w))));
  vec4 d = sdot(q * 9.0, 0.22, 0.25, s.pw * 9.0);
  return sval(c, slod(0.035, s.pw) * s.near * d.x * (d.y > 0.6 ? 0.16 : -0.12));
}

vec3 surf_pebbles(SurfIn s, vec3 c) {
  float l = slod(0.06, s.pw);
  c = sval(c, -0.1 * l);
  for (int k = 0; k < 2; k++) {
    float cell = k == 0 ? 0.17 : 0.11;
    vec4 d = sdot(s.uv / cell + float(k) * 13.1, 0.36, k == 0 ? 0.8 : 0.6, s.pw / cell);
    float rim = (1.0 - sst(1.3, d.w, s.pw / cell / 0.36)) * (1.0 - d.x);
    vec3 st = sval(mix(c, vec3(sluma(c)) * (1.0 + d.y * 0.5), 0.55), (d.z > 0.1 ? 0.12 : -0.05) + (d.y - 0.5) * 0.25);
    c = mix(sval(c, -0.16 * rim * l), st, d.x * l);
  }
  return c;
}

vec3 surf_rock(SurfIn s, vec3 c) {
  vec2 q = s.uv;
  c = sblot(c, svn(q * 0.9 + 2.0), 0.34, 0.64, 0.07, 0.08, s.pw * 1.4 + 0.003);
  float lc = slod(0.04, s.pw) * s.near;
  if (lc > 0.0) {
    // cracks: a few straight, tapered ink strokes (hand-painted, not noise worms), a light chip beside some
    vec2 k1 = scrack(q / 0.75, 0.42, 0.03, s.pw / 0.75);
    vec2 k2 = scrack(q / 0.75 + vec2(0.035, -0.035), 0.42, 0.03, s.pw / 0.75);   // its lit lower lip
    c = sval(c, 0.08 * k2.x * (1.0 - k1.x) * lc);
    c = sval(c, -0.34 * k1.x * lc);
  }
  // lichen: small spots gathered in patches, mostly on tops
  vec4 d = sdot(q * 4.0, 0.3, 0.45, s.pw * 4.0);
  float ll = d.x * slod(0.06, s.pw) * smoothstep(0.0, 0.5, s.n.y) * sst(0.6, svn(q * 0.8 + 11.0), 0.05);
  vec3 lich = c * (d.y > 0.45 ? vec3(1.0, 1.1, 0.6) : vec3(1.22, 1.0, 0.62));
  return mix(c, lich, ll * 0.7);
}

/** big painted cliff structure that reads across the valley (80–200 m), in world space (continuous across facets):
 *  warm ochre / cool grey drifts, tilted strata ledges (lit lip on top, shaded underside, lighter toward the top of
 *  each layer), vertical fissures with a lit edge; where snow lies (white vertex colour) it stays on the ledges and
 *  the undersides and fissures show dark rock. */
vec3 scliffBig(SurfIn s, vec3 c, out float yw) {
  vec3 p = s.p;
  float snowy = smoothstep(0.58, 0.72, min(c.r, min(c.g, c.b)));
  float steep = 1.0 - smoothstep(0.55, 0.85, s.n.y);
  float far = smoothstep(0.05, 0.25, s.pw);                       // bolder across the valley, where haze flattens it
  // warm ochre vs cool grey, in drifts that follow the strata a little
  float wc = svn(p.xz * 0.017 + vec2(2.0, p.y * 0.02)) * 0.8 + sin(p.y * 0.3 + (p.x + p.z) * 0.05) * 0.1 + 0.1;
  float warm = smoothstep(0.38, 0.66, wc);
  c = mix(c, mix(c * vec3(0.9, 0.97, 1.08), c * vec3(1.2, 1.02, 0.72), warm), 0.85 * (1.0 - snowy));
  // strata: ~7 m layers dipping gently per region, wobbling along the face
  float H = 7.0;
  vec2 dip = vec2(sin(p.z * 0.009 + 1.3), sin(p.x * 0.008 + 4.1)) * 0.15;
  float y = p.y + dot(p.xz, dip) + (svn(p.xz * 0.045 + 4.0) - 0.5) * 4.0 + sin(p.x * 0.021 + p.z * 0.017) * 4.5;
  yw = y;
  float li = floor(y / H), f = fract(y / H);
  float hl = sh1(vec2(li, 8.3));
  float w = s.pw / H * 1.6 + 0.004;
  float lb = slod(2.2, s.pw);
  float lip = sst(0.9 - hl * 0.05 - far * 0.04, f, w);           // sunlit lip on top of each layer
  float under = 1.0 - sst(0.1 + hl * 0.08 + far * 0.06, f, w);   // shaded underside of the layer above
  float bold = 0.35 + 0.65 * fract(hl * 7.31);                   // some ledges bold, some barely there
  float k = stone3(hl) * 0.07 + (f - 0.5) * 0.12 + bold * (0.2 * lip * (0.6 + 0.4 * s.n.y) - 0.3 * under);
  c = sval(c, k * lb * steep * (1.0 - snowy * 0.4) * (1.0 + far * 0.6));
  // layer tint: some layers a touch warmer (ochre bands)
  c = mix(c, c * vec3(1.1, 1.0, 0.84), step(0.7, fract(hl * 13.7)) * 0.7 * lb * (1.0 - snowy));
  // vertical fissures: contours of a noise over xz extrude straight up, so they run down every facet seamlessly
  float fz = svn(p.xz * 0.11 + 3.0) + sin(p.x * 0.29 - p.z * 0.23) * 0.06;
  float fg = step(0.35, fract(hl * 5.37));                       // some layers fissured, broken at the ledges
  float fw = s.pw * 0.15 + 0.002;
  float d = fz - 0.5;
  float lf = slod(1.4, s.pw) * fg * steep;
  float fis = (1.0 - sst(0.03 + far * 0.03, abs(d), fw)) * lf;
  float edge = (1.0 - sst(0.05 + far * 0.03, abs(d - 0.05 - far * 0.03), fw)) * (1.0 - fis) * lf;
  c = sval(c, (0.1 * edge - 0.34 * fis) * (1.0 - snowy * 0.3));
  // snow fields: dark rock shows in the undersides and fissures, snow stays on the ledges
  vec3 rockShow = vec3(0.42, 0.45, 0.54);
  c = mix(c, rockShow, snowy * steep * lb * max(under * 0.75 * bold, fis * 0.8));
  return c;
}

vec3 surf_cliff(SurfIn s, vec3 c) {
  // bold strata: posterised layers ~1.8 m thick, a sunlit lip on each ledge with a dark shadow line under it,
  // staggered vertical joints per layer; the rock detail on top
  float y;
  c = scliffBig(s, c, y);                                          // big structure; y = its warped height
  float H = 1.8;
  float li = floor(y / H), f = fract(y / H);
  float hs = sh1(vec2(li, 3.7));
  float lb = slod(0.3, s.pw);
  float w = s.pw / H * 1.5;
  c = sval(c, lb * (stone3(hs) * 0.1 + 0.13 * sst(0.88, f, w) - 0.26 * (1.0 - sst(0.07, f, w))));
  float P = 2.2 + hs * 1.8;
  float u = s.uv.x / P + hs * 7.0 + sin(s.uv.x * 2.3 + y * 1.7) * 0.05;
  float joint = sst(0.955, abs(fract(u) - 0.5) * 2.0, s.pw / P * 2.0) * step(0.1, f);
  c = sval(c, -0.28 * joint * slod(0.1, s.pw));
  return surf_rock(s, c);
}

/** soft water plants: 0 blades (reeds, cattail leaves, stems: veins along the blade, dark base, sun-bleached tips),
 *  1 fuzzy seed heads (cattails: velvet speckle, lit top), 2 floating pads (lily: radial veins from the centre,
 *  waxy sheen, darker rim; aux = pad radius) */
vec3 surf_plant(SurfIn s, vec3 c) {
  vec3 lp = s.p - s.off;
  if (s.variant < 0.5) {
    float P = 0.028;
    float x = s.uv.x / P + (svn(vec2(s.uv.x * 20.0, lp.y * 3.0)) - 0.5) * 0.6;
    float g = abs(fract(x) - 0.5) * 2.0;
    float lv = slod(P * 0.5, s.pw) * s.near;
    c = sval(c, lv * (0.13 * (1.0 - sst(0.3, g, s.pw / P * 2.0)) - 0.12 * sst(0.78, g, s.pw / P * 2.0)));
    c = sval(c, -0.22 * (1.0 - smoothstep(0.0, 0.35, lp.y)));                   // dark, damp base
    float tip = smoothstep(0.7, 1.4, lp.y + (svn(s.uv * 4.0) - 0.5) * 0.3);
    c = mix(c, c * vec3(1.25, 1.15, 0.6), tip * 0.7);                               // sun-bleached tips
    vec4 d = sdot(vec2(s.uv.x / 0.05, lp.y / 0.12), 0.25, 0.18, s.pw / 0.05);       // a few rust flecks
    return mix(c, c * vec3(0.9, 0.7, 0.45), d.x * slod(0.012, s.pw) * s.near * 0.7);
  }
  if (s.variant < 1.5) {
    float lf = slod(0.018, s.pw) * s.near;
    c = sblot(c, svn(vec2(s.uv.x * 12.0, lp.y * 9.0)), 0.36, 0.64, 0.16, 0.18, s.pw * 10.0 + 0.004);
    vec2 a = sdash(vec2(s.uv.x / 0.036, lp.y / 0.05), 1.5708, 0.75, 0.18, 0.7, s.pw / 0.036);
    vec4 d = sdot(vec2(s.uv.x, lp.y) / 0.03 + 7.0, 0.3, 0.5, s.pw / 0.03);
    c = sval(c, lf * (0.26 * a.x - 0.26 * d.x * (1.0 - a.x)));
    return sval(c, 0.2 * smoothstep(0.3, 0.9, s.n.y) - 0.1 * smoothstep(-0.3, -0.9, s.n.y));
  }
  float R = max(s.aux, 0.05);
  float r = length(lp.xz) / R;
  float ang = atan(-lp.z, lp.x) - 0.1;                                              // 0 at the notch
  float k = (ang + r * 0.35) / 6.2832 * 15.0;
  float gv = abs(fract(k) - 0.5) * 2.0;
  float wv = s.pw / (R * max(r, 0.05) * 6.2832 / 15.0) * 2.0;
  float lv = slod(R * max(r, 0.2) * 0.12, s.pw) * s.near * smoothstep(0.12, 0.3, r) * (1.0 - smoothstep(0.8, 0.95, r));
  c = sval(c, lv * (0.18 * (1.0 - sst(0.1, gv, wv)) - 0.08 * sst(0.55, gv, wv) * (1.0 - sst(0.9, gv, wv))));
  c = mix(c, c * vec3(1.1, 1.14, 0.8), 1.0 - smoothstep(0.08, 0.2, r));             // pale heart
  c = sval(c, -0.2 * sst(0.9, r, s.pw / R * 1.5));                                  // darker rim
  float sheen = sst(0.62, svn(lp.xz / R * 2.2 + s.off.xz), 0.06);
  return mix(c, c * vec3(1.14, 1.12, 0.96), sheen * 0.6 * slod(0.08, s.pw));
}

vec3 surf_snow(SurfIn s, vec3 c) {
  vec2 q = s.uv;
  float b = svn(q * 0.35 + 1.0) * 0.65 + svn(q * 1.1) * 0.35;
  float wb = s.pw * 0.7 + 0.003;
  c = mix(c, c * vec3(0.86, 0.91, 1.03), sst(0.6, b, wb) * 0.85);
  c *= 1.0 + 0.07 * (1.0 - sst(0.025, abs(b - 0.57), wb)) * slod(0.08, s.pw);
  vec4 d = sdot(q * 5.0, 0.16, 0.18, s.pw * 5.0);
  return c * (1.0 + 0.14 * d.x * slod(0.035, s.pw) * s.near);
}

// ------------------------------------------------------------------ wood

vec3 surf_bark(SurfIn s, vec3 c) {
  float P = 0.11;
  float x = s.uv.x / P + (svn(vec2(s.uv.x * 4.0, s.uv.y * 0.9)) - 0.5) * 1.6;
  float ci = floor(x), f = fract(x);
  float w = s.pw / P * 2.0;
  float lb = slod(P * 0.45, s.pw);
  float birch = step(0.5, s.variant);
  float furrow = (1.0 - sst(0.24, f, w)) * (1.0 - birch);
  float lit = sst(0.55, f, w) * (1.0 - sst(0.82, f, w));
  float len = 0.35 + sh1(vec2(ci, 2.0)) * 0.45;
  float fb = fract(s.uv.y / len + sh1(vec2(ci, 5.0)) * 3.0);
  float brk = 1.0 - sst(0.012, min(fb, 1.0 - fb) * len, s.pw);
  // birch: short dark horizontal lenticels instead of furrows
  vec2 lent = sdash(vec2(s.uv.x / 0.09, s.uv.y / 0.07), 0.0, 0.7, 0.09, 0.3, s.pw / 0.07);
  c = sval(c, lb * (stone3(sh1(vec2(ci, 9.0))) * 0.05 - 0.3 * max(furrow, brk * 0.8 * (1.0 - birch)) + 0.08 * lit * (1.0 - birch)));
  return sval(c, -0.5 * lent.x * birch * slod(0.03, s.pw));
}

vec3 surf_planks(SurfIn s, vec3 c) {
  float W = 0.25;
  float bu = s.uv.x / W, bi = floor(bu), fu = fract(bu);
  float hb = sh1(vec2(bi, 1.3));
  float L = 1.5 + hb * 1.4;
  float bv = (s.uv.y + hb * 9.0) / L, bj = floor(bv), fv = fract(bv);
  float h = sh1(vec2(bi, bj) + 0.5);
  float weathered = step(0.5, s.variant) * step(s.variant, 1.5), painted = step(1.5, s.variant);
  float lb = slod(W, s.pw);
  c = sval(c, stone3(h) * 0.075 * (1.0 - painted * 0.6) * lb);
  // grain: wavy lines along the board
  float lg = slod(0.028, s.pw) * s.near * (1.0 - painted * 0.85);
  if (lg > 0.0) {
    float gx = fu * W / 0.03 + svn(vec2(bi * 5.1, s.uv.y * 1.6)) * 2.5 + h * 10.0;
    float g = abs(fract(gx) - 0.5);
    c = sval(c, -(0.08 + weathered * 0.07) * (1.0 - sst(0.13, g, s.pw / 0.03 * 1.5)) * lg);
    vec4 k = sdot(vec2(bu, s.uv.y / 0.5), 0.14, 0.12, s.pw / 0.1);
    c = sval(c, -0.3 * k.x * lg * (1.0 - sst(0.5, k.w, 0.1)) - 0.12 * k.x * lg);
  }
  // seams and butt joints, a light bevel on one side, nails near the board ends
  float ls = slod(0.018, s.pw);
  float seam = 1.0 - sst(0.011, min(fu, 1.0 - fu) * W, s.pw * 0.7);
  float butt = 1.0 - sst(0.008, min(fv, 1.0 - fv) * L, s.pw * 0.7);
  float bevel = (1.0 - sst(0.032, fu * W, s.pw)) * (1.0 - seam);
  vec2 nd = vec2(abs(fu - 0.5) * W - 0.06, min(fv, 1.0 - fv) * L - 0.045);
  float nail = (1.0 - sst(0.01, length(nd), s.pw * 0.8)) * slod(0.02, s.pw) * s.near;
  c = sval(c, 0.07 * bevel * lb - 0.46 * max(seam, butt) * ls - 0.4 * nail);
  return mix(c, vec3(sluma(c)) * vec3(1.0, 1.0, 1.04), 0.28 * weathered);
}

vec3 surf_logs(SurfIn s, vec3 c) {
  if (s.along > 0.72) {
    // end grain: posterised rings around the axis, a dark pith, lighter cut face
    float r = s.aux;
    float rr = r / 0.04 + (svn(s.uv * 5.0) - 0.5) * 0.7;
    float g = abs(fract(rr) - 0.5);
    float lr = slod(0.035, s.pw) * s.near;
    c = sval(c * vec3(1.18, 1.12, 0.98), -0.2 * (1.0 - sst(0.12, g, s.pw / 0.04 * 1.5)) * lr);
    return sval(c, -0.3 * (1.0 - sst(0.022, r, s.pw)) * lr);
  }
  if (s.variant > 0.5) return surf_bark(s, c);
  // peeled log / beam: long grain, a few knots
  float lg = slod(0.03, s.pw) * s.near;
  float gx = s.uv.x / 0.035 + svn(vec2(s.uv.x * 3.0, s.uv.y * 1.2)) * 2.2;
  c = sval(c, -0.09 * (1.0 - sst(0.14, abs(fract(gx) - 0.5), s.pw / 0.035 * 1.5)) * lg);
  c = sblot(c, svn(s.uv * vec2(3.0, 0.6)), 0.3, 0.7, 0.05, 0.06, s.pw * 3.0 + 0.003);
  vec4 k = sdot(s.uv / vec2(0.2, 0.6), 0.2, 0.2, s.pw / 0.2);
  return sval(c, -0.28 * k.x * slod(0.05, s.pw));
}

// ------------------------------------------------------------------ roofs

vec3 surf_shingle(SurfIn s, vec3 c) {
  float H = 0.2, W = 0.2;
  float rv = s.uv.y / H, ri = floor(rv), fv = fract(rv);
  float su = s.uv.x / W + sh1(vec2(ri, 4.1)) * 3.0 + ri * 0.5;
  float si = floor(su), fu = fract(su);
  // some joints are skipped: irregular shingle widths
  float skipL = step(0.66, sh1(vec2(si, ri) + 0.3)), skipR = step(0.66, sh1(vec2(si + 1.0, ri) + 0.3));
  float h = sh1(vec2(si - skipL, ri));
  float lb = slod(H * 0.6, s.pw);
  float w = s.pw / H * 1.2;
  float shadow = sst(0.8, fv, w) * (0.45 + 0.55 * clamp((fv - 0.8) / 0.2, 0.0, 1.0));
  float lip = 1.0 - sst(0.07, fv, w);
  float eg = min(mix(fu, 9.0, skipL), mix(1.0 - fu, 9.0, skipR)) * W;
  float gap = (1.0 - sst(0.008, eg, s.pw * 0.8)) * (1.0 - shadow);
  float grain = (1.0 - sst(0.12, abs(fract(fu * 5.0 + h * 3.0 + fv * 0.3) - 0.5), s.pw / W * 7.5)) * slod(0.03, s.pw) * s.near;
  c = sval(c, lb * (stone3(h) * 0.1 + 0.08 * (1.0 - fv) + 0.1 * lip - 0.26 * shadow) - 0.4 * gap * slod(0.025, s.pw) - 0.06 * grain);
  // mossy (variant 1)
  float moss = step(0.5, s.variant) * sst(0.62, svn(s.uv * 1.2 + 4.0), 0.05) * lb;
  return mix(c, c * vec3(0.82, 1.08, 0.55), moss * 0.7);
}

vec3 surf_tile(SurfIn s, vec3 c) {
  float H = 0.28, W = 0.22;
  float rv = s.uv.y / H, ri = floor(rv), fv = fract(rv);
  float su = s.uv.x / W, si = floor(su), fu = fract(su);
  float crest = -cos(fu * 6.2832);
  float lb = slod(W * 0.5, s.pw);
  float w = s.pw / W * 6.0;
  float wv = s.pw / H * 1.2;
  float shade = 0.12 * sst(0.45, crest, w) - 0.2 * (1.0 - sst(-0.55, crest, w));
  c = sval(c, lb * (shade + stone3(sh1(vec2(si, ri))) * 0.06 + 0.08 * (1.0 - sst(0.07, fv, wv)) - 0.26 * sst(0.84, fv, wv)));
  return c;
}

vec3 surf_thatch(SurfIn s, vec3 c) {
  float H = 0.32;
  float jag = (svn(vec2(s.uv.x * 12.0, floor(s.uv.y / H) * 3.0)) - 0.5) * 0.28;
  float rv = s.uv.y / H + jag, ri = floor(rv), fv = fract(rv);
  float w = s.pw / H * 1.5;
  float lb = slod(0.12, s.pw);
  c = sval(c, lb * (0.08 * (1.0 - fv) - 0.3 * sst(0.82, fv, w) + stone3(sh1(vec2(floor(s.uv.x / 0.16), ri))) * 0.05));
  float x = s.uv.x / 0.03 + svn(vec2(s.uv.x * 9.0, s.uv.y * 2.5)) * 3.0;
  float g = abs(fract(x) - 0.5);
  float ls = slod(0.02, s.pw) * s.near;
  float wg = s.pw / 0.03 * 1.5;
  return sval(c, ls * (0.1 * (1.0 - sst(0.16, g, wg)) - 0.08 * sst(0.38, g, wg)));
}

// ------------------------------------------------------------------ walls

vec3 surf_brick(SurfIn s, vec3 c) {
  float H = 0.13, L = 0.3, M = 0.017;
  float rv = s.uv.y / H, ri = floor(rv), fv = fract(rv);
  float bu = s.uv.x / L + mod(ri, 2.0) * 0.5, bi = floor(bu), fu = fract(bu);
  float h = sh1(vec2(bi, ri));
  float em = min(min(fu, 1.0 - fu) * L, min(fv, 1.0 - fv) * H);
  float lb = slod(H * 0.5, s.pw);
  float mortar = (1.0 - sst(M * 0.5, em, s.pw * 0.7)) * slod(M * 1.5, s.pw);
  vec3 b = sval(c, stone3(h) * 0.1 + (h > 0.93 ? -0.18 : 0.0) + 0.07 * sst(0.8, fv, s.pw / H));
  vec3 m = mix(vec3(sluma(c)) * 1.45 + 0.05, c, 0.3) * vec3(1.02, 1.0, 0.94);
  return mix(c, mix(b, m, mortar), lb);
}

vec3 surf_fieldstone(SurfIn s, vec3 c) {
  vec4 v = svor(s.uv / vec2(0.42, 0.28), 0.85);
  float lb = slod(0.28, s.pw);
  float gap = 1.0 - sst(0.16, v.y, s.pw / 0.28 * 2.0);
  vec3 st = sval(c, stone3(v.z) * 0.11 + v.w * 0.2 - v.x * 0.08);
  st *= mix(vec3(1.0), vec3(1.07, 1.0, 0.88), step(0.62, fract(v.z * 7.3)));
  st = mix(st, surf_rock(s, st), 0.6);
  return mix(c, mix(st, sval(sgrey(c, 0.3), -0.5), gap), lb);
}

vec3 surf_plaster(SurfIn s, vec3 c) {
  float b = svn(s.uv * 1.1 + 2.0) * 0.6 + svn(s.uv * 2.9) * 0.4;
  c = sblot(c, b, 0.36, 0.6, 0.045 * slod(0.3, s.pw), 0.05 * slod(0.3, s.pw), s.pw * 2.0 + 0.003);
  vec4 d = sdot(s.uv * 14.0, 0.25, 0.3, s.pw * 14.0);
  c = sval(c, -0.08 * d.x * slod(0.03, s.pw) * s.near);
  float n1 = svn(s.uv * 2.2 + 8.0);
  float crack = (1.0 - sst(0.014, abs(n1 - 0.5), s.pw * 3.0)) * sst(0.7, svn(s.uv * 0.45 + 1.0), 0.04);
  return sval(c, -0.25 * crack * slod(0.04, s.pw) * s.near);
}

// ------------------------------------------------------------------ made things

vec3 surf_metal(SurfIn s, vec3 c) {
  float P = 0.8;
  float pu = s.uv.x / P, pi = floor(pu), fu = fract(pu);
  float e = min(fu, 1.0 - fu) * P;
  c = sval(c, (sh1(vec2(pi, floor(s.uv.y / 1.6))) - 0.5) * 0.12 * slod(0.4, s.pw));
  if (s.variant > 0.5 && s.variant < 1.5) {
    float k = -cos(s.uv.x / 0.075 * 6.2832), wk = s.pw / 0.075 * 6.0;
    c = sval(c, slod(0.04, s.pw) * (0.12 * sst(0.4, k, wk) - 0.16 * (1.0 - sst(-0.4, k, wk))));
  }
  float lb = slod(0.03, s.pw);
  float seam = 1.0 - sst(0.01, e, s.pw * 0.7);
  float lip = sst(0.01, e, s.pw * 0.7) * (1.0 - sst(0.024, e, s.pw * 0.7));
  vec2 nd = vec2(e - 0.04, (fract(s.uv.y / 0.15) - 0.5) * 0.15);
  float rivet = (1.0 - sst(0.011, length(nd), s.pw * 0.8)) * slod(0.02, s.pw) * s.near;
  float streak = svn(vec2(s.uv.x * 6.0, s.uv.y * 0.35));
  c = sval(c, lb * (-0.4 * seam + 0.12 * lip) + rivet * (nd.y > 0.0 ? 0.2 : -0.25) - 0.06 * sst(0.6, streak, 0.08) * slod(0.1, s.pw));
  float rust = step(1.5, s.variant) * sst(0.55, svn(s.uv * 1.3 + 2.0) + seam * 0.3, 0.06) * slod(0.1, s.pw);
  return mix(c, c * vec3(1.45, 0.82, 0.48), rust * 0.75);
}

vec3 surf_fabric(SurfIn s, vec3 c) {
  float lw = slod(0.012, s.pw) * s.near;
  c = sval(c, 0.05 * sin(s.uv.x / 0.006 * 3.1416) * sin(s.uv.y / 0.006 * 3.1416) * lw);
  float f = svn(vec2(s.uv.x * 2.2, s.uv.y * 0.25));
  c = sblot(c, f, 0.36, 0.62, 0.06 * slod(0.2, s.pw), 0.07 * slod(0.2, s.pw), s.pw * 3.0 + 0.003);
  float fu = fract(s.uv.x);
  float e = abs(min(fu, 1.0 - fu) - 0.035);
  float stitch = (1.0 - sst(0.004, e, s.pw * 0.7)) * step(0.45, fract(s.uv.y / 0.045));
  return sval(c, -0.3 * stitch * slod(0.012, s.pw) * s.near);
}

vec3 surf_hay(SurfIn s, vec3 c) {
  vec2 q = s.uv;
  float l = slod(0.035, s.pw) * s.near;
  c = sval(c, slod(0.2, s.pw) * (svn(q * 3.0) - 0.5) * 0.16);
  if (l > 0.0) {
    vec2 a = sdash(q / 0.09, 1.57, 0.8, 0.07, 0.85, s.pw / 0.09);
    vec2 b = sdash(q / 0.07 + 5.0, 1.2, 0.75, 0.07, 0.7, s.pw / 0.07);
    vec2 d = sdash(q / 0.11 + 9.0, 2.0, 0.8, 0.06, 0.6, s.pw / 0.11);
    c = sval(c, l * (0.15 * a.x - 0.15 * b.x * (1.0 - a.x) + 0.08 * d.x));
  }
  return c;
}

/** foliage mapping: cylindrical around the object's up axis on the sides (no seams between facets), planar on tops */
vec2 leafUV(SurfIn s) {
  vec3 p = s.p - s.off;
  if (abs(s.n.y) > 0.82) return p.xz + s.off.xz;
  float r = max(length(p.xz), 0.35);
  return vec2(atan(p.z, p.x) * r + s.off.x, p.y);
}

/** foliage normal tilt, written by surf_leaves (x across the face, y up it; ~0..1): materials compiled with leaves
 *  bend the lit normal by it after normal_fragment_maps (SURF_TILT_FRAG), so every leaf clump catches the sun on
 *  its own rounded top and the toon terminator runs scalloped around the clumps instead of along facets. */
vec2 sLeafTilt = vec2(0.0);

/** one layer of leaf clumps (q in clump cells, w = cells per pixel): overlapping round clumps, the higher one in front,
 *  so every clump shows a round, scalloped hem over the one below. x lit cap, y shade (belly, underside rim, the hem
 *  shadow of the clump in front, bare gaps), z hash, w sunny top of the cap (highlight leaves); tilt = the bulge. */
vec4 leafClumps(vec2 q, float w, out vec2 tilt) {
  vec2 i = floor(q), f = fract(q);
  float best = -9.0, R = 1.0, h = 0.0;
  vec2 o = vec2(0.0, -1.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), hh = sh2(i + g);
    vec2 d = f - g - 0.5 - (hh - 0.5) * 0.7;
    float r = 0.6 + hh.x * 0.14, pr = g.y + hh.y * 0.9;
    if (dot(d, d) < r * r && pr > best) { best = pr; o = d; R = r; h = hh.y; }
  }
  // the hem shadow: clumps in front of this one darken a band just below their round bottom edge
  float sh = 0.0;
  for (int y = 0; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), hh = sh2(i + g);
    vec2 d = f - g - 0.5 - (hh - 0.5) * 0.7;
    float r = 0.6 + hh.x * 0.14, pr = g.y + hh.y * 0.9;
    if (pr > best) sh = max(sh, (1.0 - sst(r + 0.16, length(d), w * 1.5 + 0.05)) * sst(0.0, -d.y, 0.25));
  }
  float aw = w / R * 1.5;
  vec2 u = o / R;   // -1..1 inside its clump
  float cap = (1.0 - sst(0.64, length(u - vec2(0.06, 0.3)), aw + 0.1)) * (1.0 - sh);
  float belly = sst(0.0, -u.y, 0.45) * (1.0 - cap);
  float rim = sst(0.78, length(u), aw + 0.06) * sst(-0.1, -u.y, 0.3);
  float top = (1.0 - sst(0.28, length(u - vec2(-0.1, 0.46)), aw)) * (1.0 - sh);
  tilt = u;
  float shade = best < -8.0 ? 1.0 : max(max(belly * 0.55, rim * 0.8), sh * 0.85);
  return vec4(cap, shade, h, top);
}

vec3 surf_leaves(SurfIn s, vec3 c) {
  // Ghibli / Wind Waker clumps: each clump a lit, rounded, warm cap and a cool shaded belly, darker gaps between them,
  // a few bright leaves on the sunny caps. Colour modulation + a normal tilt (sLeafTilt) so the sun shapes each clump.
  vec3 p = s.p - s.off;
  float rc = max(length(p.xz), 0.35);
  vec2 side = vec2(atan(p.z, p.x) * rc + s.off.x, p.y);
  if (s.aux > 0.0) {
    // blob radius in aux (normals bent round each blob): wrap round the blob itself, longitude × radius across, arc
    // length up; the longitude seam faces the tree's axis (hidden inside the crown), and the blob centre shifts it
    float R = s.aux, ny = clamp(s.n.y, -0.98, 0.98);
    vec3 cc = p - s.n * R;
    vec2 ref = normalize(-cc.xz - vec2(0.6, 0.0));
    vec2 nx = s.n.xz;
    float th = atan(ref.x * nx.y - ref.y * nx.x, -dot(ref, nx));
    side = vec2(th * R + cc.x * 0.7 + cc.z * 0.45 + s.off.x, asin(ny) * R + cc.y * 0.6);
  }
  float ln = slod(0.05, s.pw) * s.near;
  if (s.variant > 0.5 && s.variant < 1.5) {
    // needles: soft bough clumps, short strokes hanging down them
    vec2 uv = leafUV(s), o;
    float S = 0.5;
    vec4 v = svor2(uv / S * vec2(1.0, 1.25), 0.8, o);
    float w = s.pw / S * 1.25, lb = slod(S * 0.4, s.pw);
    float cap = 1.0 - sst(0.3 + (v.z - 0.5) * 0.1, length(o - vec2(0.04, 0.16)), w * 1.5);
    float belly = 1.0 - sst(-0.14, o.y, w * 1.5);
    c = mix(c, c * vec3(1.2, 1.17, 0.8), cap * lb * 0.45);
    c = sval(c, lb * (-0.13 * belly * (1.0 - cap) + stone3(v.z) * 0.04));
    vec2 a = sdash(uv / 0.09, -1.57, 0.8, 0.07, 0.8, s.pw / 0.09);
    return sval(c, ln * (a.y > 0.5 ? 0.13 : -0.13) * a.x);
  }
  bool curtain = s.variant > 1.5;
  // clump cells: squat on crowns, long hanging sprays on willow curtains
  float S = curtain ? 0.3 : 0.6;
  vec2 st = curtain ? vec2(1.0, 0.45) : vec2(1.0, 1.2);
  float w = s.pw / S * max(st.x, st.y);
  // sides wrap round the up axis, tops are planar; blend the two over a band (no seam on smooth crowns)
  float topk = curtain ? 0.0 : smoothstep(s.aux > 0.0 ? 0.8 : 0.62, s.aux > 0.0 ? 0.95 : 0.88, abs(s.n.y));
  vec4 a = vec4(0.0); vec2 ta = vec2(0.0);
  if (topk < 1.0) a = leafClumps(side / S * st, w, ta);
  if (topk > 0.0) { vec2 tb; vec4 b = leafClumps(s.p.xz / S * st + 17.0, w, tb); a = mix(a, b, topk); }
  float lb = slod(S * 0.35, s.pw);
  float sun = smoothstep(-0.35, 0.65, s.n.y);
  // lit caps warm up (more on the sunny top of the crown), bellies and gaps go cool and dark
  c = mix(c, c * vec3(1.2, 1.15, 0.8), a.x * lb * (0.4 + 0.35 * sun));
  c = mix(c, c * vec3(0.7, 0.76, 0.94), a.y * lb * 0.72);
  c = sval(c, stone3(a.z) * 0.05 * lb);
  if (ln > 0.0) {
    // a few bright leaves on the sunny caps, a few dark ones in the shade
    vec2 mu = topk > 0.5 ? s.p.xz : side;
    vec4 d = sdot(mu / 0.1 + 3.0, 0.32, 0.5, s.pw / 0.1);
    c = sval(c, ln * d.x * (a.w * sun * 0.34 - a.y * 0.12));
  }
  // the bulge: only where clumps are big on screen (no band flicker far away), less on flat tops and curtains
  sLeafTilt = ta * slod(S * 0.7, s.pw) * (1.0 - topk) * (curtain ? 0.45 : 0.8);
  return c;
}
`;

/** id → GLSL function name (plain has none). */
export const SURF_FN: Readonly<Record<number, string>> = Object.freeze({
  [SURF.grass]: 'surf_grass', [SURF.meadow]: 'surf_meadow', [SURF.soil]: 'surf_soil', [SURF.dirt]: 'surf_dirt',
  [SURF.cobble]: 'surf_cobble', [SURF.sand]: 'surf_sand', [SURF.pebbles]: 'surf_pebbles', [SURF.rock]: 'surf_rock',
  [SURF.cliff]: 'surf_cliff', [SURF.snow]: 'surf_snow', [SURF.planks]: 'surf_planks', [SURF.logs]: 'surf_logs',
  [SURF.bark]: 'surf_bark', [SURF.shingle]: 'surf_shingle', [SURF.tile]: 'surf_tile', [SURF.thatch]: 'surf_thatch',
  [SURF.brick]: 'surf_brick', [SURF.fieldstone]: 'surf_fieldstone', [SURF.plaster]: 'surf_plaster', [SURF.metal]: 'surf_metal',
  [SURF.fabric]: 'surf_fabric', [SURF.hay]: 'surf_hay', [SURF.leaves]: 'surf_leaves',
  [SURF.plant]: 'surf_plant',
});

/** Vertex side: pattern position/normal in (instance-)local metres, and the tag. Hook after `#include <begin_vertex>`. */
export const SURF_VERT_HEAD = /* glsl */ `
attribute vec4 surface;
flat varying vec4 vSurf;
flat varying vec3 vSurfOff;
varying vec3 vSurfP;
varying vec3 vSurfN;
varying float vSurfAux;
`;
export const SURF_VERT_BODY = /* glsl */ `
{
  // rest position (before any sway), so patterns never swim on animated or wind-blown parts
  vec3 sScl = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
  vec3 sOff = vec3(0.0);
  #ifdef USE_INSTANCING
    vec3 sIs = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    sScl *= sIs;
    sOff = fract(instanceMatrix[3].xyz * vec3(0.1731, 0.2317, 0.1379)) * 23.0;
  #endif
  vSurfP = position * sScl + sOff;
  vSurfOff = sOff;
  vSurfN = normalize(normal / max(sScl, vec3(1e-4)));
  vSurf = surface;
  vSurfAux = surface.w * max(sScl.x, max(sScl.y, sScl.z));
}
`;

/** Fragment head: uniforms, varyings, the library and a dispatcher over the compiled-in ids. */
export function surfFragHead(ids: readonly number[]): string {
  const cases = ids.filter((id) => SURF_FN[id]).map((id) => `  else if (id == ${id}) r = ${SURF_FN[id]}(s, c);`).join('\n');
  return /* glsl */ `
uniform float uSurfStrength;
uniform float uSurfFar;
uniform vec4 uSurfDef;   // default code, scale, strength; w = material strength
flat varying vec4 vSurf;
flat varying vec3 vSurfOff;
varying vec3 vSurfP;
varying vec3 vSurfN;
varying float vSurfAux;
${SURF_LIB}
SurfIn surfIn(vec3 p, vec3 n, int axis, float scale, float pw, float dist, float variant, float aux) {
  SurfIn s;
  s.p = p / scale; s.n = n;
  s.uv = surfUV(s.p, n, axis, s.along);
  s.pw = pw / scale;
  s.near = 1.0 - smoothstep(uSurfFar * 0.6, uSurfFar, dist);
  s.variant = variant; s.aux = aux / scale;
  s.off = vSurfOff / scale;
  s.eye = s.uv - vec2(0.0, 1e4);
  return s;
}
vec3 surfApply(vec3 c, float pw, float dist) {
  vec4 t = vSurf;
  int code = int(t.x + 0.5);
  if (code % 32 == 0) t = vec4(uSurfDef.xyz, vSurfAux);   // untagged / inherit: the material's default
  code = int(t.x + 0.5);
  int id = code % 32;
  float k = t.z * uSurfStrength * uSurfDef.w;
  if (id <= 1 || k <= 0.0 || t.y <= 0.0) return c;
  vec3 n = normalize(vSurfN);
  SurfIn s = surfIn(vSurfP, n, (code / 32) % 4, t.y, pw, dist, float(code / 128), vSurfAux);
  vec3 r = c;
  if (false) {}
${cases}
  // snow lying on it (white, upward faces): paint it as snow, whatever is underneath
  float snowy = smoothstep(0.8, 0.9, min(c.r, min(c.g, c.b))) * smoothstep(0.3, 0.6, n.y) * float(id != ${SURF.snow} && id != ${SURF.plaster});
  if (snowy > 0.0) r = mix(r, surf_snow(s, c), snowy);
  sLeafTilt *= min(k, 1.0) * (1.0 - snowy);
  return mix(c, r, k);
}
`;
}

/** Leaf clump normal tilt (see sLeafTilt): insert after `#include <normal_fragment_maps>` in materials with leaves. */
export const SURF_TILT_FRAG = /* glsl */ `
if (dot(sLeafTilt, sLeafTilt) > 1e-5) {
  vec3 sUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  vec3 sTu = sUp - normal * dot(sUp, normal);
  float sL = dot(sTu, sTu);
  if (sL > 0.02) {
    sTu *= inversesqrt(sL);
    normal = normalize(normal + cross(normal, sTu) * sLeafTilt.x + sTu * sLeafTilt.y);
  }
}
`;

export const SURF_FRAG_BODY = /* glsl */ `
{
  float sPw = surfPw(vSurfP);
  diffuseColor.rgb = surfApply(diffuseColor.rgb, sPw, length(vViewPosition));
}
`;
