/**
 * World-space procedural surface patterns for toonEnv / toonProp (ART §3.3, §5.4 `uPattern`). No textures, no UVs.
 * All patterns modulate the albedo within a few % of lightness (low-contrast floors, §5.5) and never lift it above
 * the albedo cap. Owner: RND.
 */

/** Pattern ids (uniform `uPattern`). */
export const PATTERN = Object.freeze({
  none: 0, planks: 1, felt: 2, terrazzo: 3, tile: 4, brick: 5, cobble: 6, wainscot: 7, plaster: 8, fabric: 9, wood: 10,
});

export const patternsGlsl = /* glsl */ `
float hqHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hqNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hqHash(i), hqHash(i + vec2(1, 0)), u.x), mix(hqHash(i + vec2(0, 1)), hqHash(i + vec2(1, 1)), u.x), u.y);
}
float hqFbm(vec2 p) { return hqNoise(p) * 0.6 + hqNoise(p * 2.13 + 7.1) * 0.3 + hqNoise(p * 4.7 + 3.3) * 0.1; }
// two octaves (m2 fix r1, perf): the big fill surfaces (plaster walls, plank floors) carry a ±1.5–2 % wobble whose
// third octave (10 % weight) was invisible but cost 4 of 12 hashes per pixel over most of the frame
float hqFbm2(vec2 p) { return hqNoise(p) * 0.66 + hqNoise(p * 2.13 + 7.1) * 0.34; }
// Pick the 2D coords of the dominant plane of the normal.
vec2 hqPlaneUV(vec3 w, vec3 n) {
  vec3 a = abs(n);
  return a.y > max(a.x, a.z) ? w.xz : (a.x > a.z ? w.zy : w.xy);
}
// Terrazzo aggregate layer: cells of 1/sc m, a chip in dens of them (random offset, rotation, 1.0–1.85 elongation,
// radius rad × 0.7–1.3 of a cell, ≤ 0.45 so the 4-neighbour search never clips one). Returns (mask, tone pick,
// pixel fade): the mask edge is ~1 px wide (fwidth) and chips smaller than ~3 px fade out.
vec3 hqChips(vec2 p, float sc, float dens, float rad, float seed) {
  vec2 cc = p * sc + seed; vec2 i = floor(cc); vec2 f = fract(cc);
  float fw = max(fwidth(cc.x), fwidth(cc.y));
  float aa = fw * 0.75 + 0.01;
  vec2 best = vec2(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k % 2), float(k / 2));
    vec2 id = i + o;
    if (hqHash(id + seed * 3.1) > dens) continue;
    vec2 v = f - o - vec2(hqHash(id + 17.0 + seed), hqHash(id + 31.0 - seed)) + 0.5;
    float a = hqHash(id + 53.0) * 6.283;
    vec2 cs = vec2(cos(a), sin(a));
    v = vec2(dot(v, cs), dot(v, vec2(-cs.y, cs.x))) * vec2(1.0, 1.0 + 0.85 * hqHash(id + 71.0));
    float rr = rad * (0.7 + 0.6 * hqHash(id + 91.0));
    float m = 1.0 - smoothstep(rr - aa, rr + aa, length(v));
    if (m > best.x) best = vec2(m, hqHash(id + 113.0));
  }
  return vec3(best, 1.0 - smoothstep(0.12, 0.3, fw));
}
// Returns albedo multiplier (rgb) for the pattern.
vec3 hqPattern(int id, vec3 base, vec3 w, vec3 n) {
  if (id == 0) return base;
  vec2 p = hqPlaneUV(w, n);
  if (id == 1) { // oak planks along x, 0.18 m wide, staggered ends, grain + seams
    float row = floor(p.y / 0.18);
    float off = hqHash(vec2(row, 3.0)) * 2.4;
    float plank = floor((p.x + off) / 1.2);
    float tint = (hqHash(vec2(row, plank)) - 0.5) * 0.12;
    float grain = sin((p.x + hqFbm2(p * vec2(1.0, 8.0)) * 0.3) * 60.0) * 0.02;
    vec2 f = vec2(fract((p.x + off) / 1.2) * 1.2, fract(p.y / 0.18) * 0.18);
    float seam = 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.008, min(min(f.y, 0.18 - f.y), min(f.x, 1.2 - f.x))));
    return base * (1.0 + tint + grain) * seam;
  }
  if (id == 2) { // felt carpet: two-octave speckle ±5% + a faint 0.5 m chevron in two close tones
    float s = (hqNoise(p * 38.0) - 0.5) * 0.07 + (hqNoise(p * 7.0) - 0.5) * 0.05;
    float chev = step(0.5, fract((p.x + abs(fract(p.y * 1.5) - 0.5) * 0.6) * 2.0)) * 0.025;
    return base * (1.0 + s - chev);
  }
  if (id == 3) { // terrazzo (fix r1): 3 chip sizes, 4 muted chip tones, ~40 % less contrast, far smaller chips
    float mott = 1.0 + (hqNoise(p * 3.0) - 0.5) * 0.035 + (hqNoise(p * 23.0) - 0.5) * 0.025;
    vec3 col = base * mott;
    // large → small layer; a smaller chip never paints over a larger one (first hit wins, like real aggregate)
    vec3 c = hqChips(p, 16.0, 0.34, 0.18, 0.0);      // ≈ 1.5–2.8 cm aggregate
    if (c.x < 0.01) c = hqChips(p, 34.0, 0.42, 0.2, 7.0);   // ≈ 0.8–1.4 cm
    if (c.x < 0.01) c = hqChips(p, 70.0, 0.5, 0.2, 13.0);   // ≈ 0.4–0.7 cm grit
    // oat / sage / clay at low chroma (albedo multipliers ≈ ±8–12 % L), plus a few dark flecks; sub-pixel chips fade
    // into the matrix (c.z = the layer's pixel footprint fade), so the far floor never shimmers into noise
    vec3 tone = c.y < 0.4 ? vec3(1.11, 1.09, 1.04) : c.y < 0.68 ? vec3(0.97, 1.06, 1.0) : c.y < 0.9 ? vec3(1.09, 0.99, 0.95) : vec3(0.86, 0.85, 0.86);
    return mix(col, base * tone, c.x * c.z);
  }
  if (id == 4) { // tiles 0.3 m, grout 6 mm
    vec2 f = fract(p / 0.3) * 0.3; vec2 i = floor(p / 0.3);
    float g = smoothstep(0.0, 0.006, min(min(f.x, 0.3 - f.x), min(f.y, 0.3 - f.y)));
    return mix(base * 1.08, base * (1.0 + (hqHash(i) - 0.5) * 0.06), g);
  }
  if (id == 5) { // painted brick: running bond, sage-grey bricks, darker mortar
    vec2 b = vec2(p.x / 0.24, p.y / 0.08); b.x += mod(floor(b.y), 2.0) * 0.5;
    vec2 f = fract(b); vec2 i = floor(b);
    float m = smoothstep(0.0, 0.08, min(min(f.x, 1.0 - f.x) * 0.24, min(f.y, 1.0 - f.y) * 0.08) / 0.012 * 0.08);
    return mix(base * 0.78, base * (1.0 + (hqHash(i) - 0.5) * 0.08), m);
  }
  if (id == 6) { // cobble pavers
    vec2 c = p / 0.35; vec2 i = floor(c); vec2 f = fract(c) - 0.5;
    float r = max(abs(f.x), abs(f.y));
    return base * mix(0.9, 1.0 + (hqHash(i) - 0.5) * 0.08, 1.0 - smoothstep(0.44, 0.5, r));   // grout 0.9, 6 % of the stone (m2 fix r1; was 0.82 then 0.88 over 16 %: STR pavers rendered below the floor row)
  }
  if (id == 7) { // wall: plaster wobble + wainscot band below 0.9 m (darker) with a 3 cm trim line
    float y = w.y;
    float plaster = 1.0 + (hqFbm2(p * 3.0) - 0.5) * 0.03;
    float band = step(y, 0.9);
    float trim = smoothstep(0.9, 0.905, y) * (1.0 - smoothstep(0.925, 0.93, y));
    vec3 col = base * plaster;
    col = mix(col, base * vec3(0.78, 0.74, 0.70), band);
    col = mix(col, base * 1.04, trim);
    return col;
  }
  if (id == 8) return base * (1.0 + (hqFbm2(p * 2.5) - 0.5) * 0.035);
  if (id == 9) return base * (1.0 + (hqNoise(p * 60.0) - 0.5) * 0.05 + (hqNoise(p * 9.0) - 0.5) * 0.03);
  if (id == 10) { // wood props: gentle grain along the dominant axis
    float g = sin((p.x * 1.3 + p.y * 0.2 + hqFbm(p * vec2(2.0, 12.0)) * 0.4) * 45.0) * 0.025;
    return base * (1.0 + g + (hqNoise(p * 3.0) - 0.5) * 0.04);
  }
  return base;
}
`;
