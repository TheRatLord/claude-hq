/**
 * Materials for fields: a toon material with wind sway, droop and "life" tints computed in the shader (so a whole
 * field breathes without touching instance matrices), the sign atlas material (instanced text regions), and the
 * hand-painted surfaces every field material wears (scene/surface + a few field-only paints, below).
 *
 * Field paints: parts tagged `SURF.plain` with an axis/variant pick a paint that only fields need (see `PAINT`):
 * pumpkin ribs, leaf veins (leaf cards carry their across-the-leaf coordinate in the tag's aux), sunflower seeds and
 * tilled soil (clods: hoe lines, crumbs, seed dots, darker moist flanks; fallow / resting soil — instance tint
 * above 1 — dries out and cracks). Everything else goes through the library dispatcher (planks, bark, hay, …).
 */
import * as THREE from 'three';
import { packCode, SURF, chainShader, surfaceQuality, withSurfaces } from '../surface/index.ts';
import type { SurfAxis, SurfName } from '../surface/index.ts';
import { toon, toonRamp } from '../toon.ts';
import type { ToonOpts } from '../toon.ts';

export interface CropUniforms {
  uTime: { value: number };
  /** wind in world xz (m/s-ish, ~0..3) */
  uWind: { value: THREE.Vector2 };
  /** sway amount per metre² of height */
  uBend: { value: number };
  /** 0..1 tips hang down (resting) */
  uDroop: { value: number };
  /** 0..1 greens turn golden-dry */
  uDry: { value: number };
  /** 0..1 non-green colours turn unripe green */
  uGreen: { value: number };
  /** saturation multiplier (thriving > 1) */
  uSat: { value: number };
  /** 0..1 frost/snow on upward faces */
  uSnow: { value: number };
  /**
   * Parting: up to PART_N world points (x, z, radius, strength) that tall crops bend away from and duck under — a
   * farmer (or the player) standing in wheat stays visible. Shared per field; `uPartK` = how much this part parts.
   */
  uPart: { value: THREE.Vector4[] };
  uPartK: { value: number };
}

/** parting points per field (farmers in the field + the player) */
export const PART_N = 6;
export const partPoints = (): THREE.Vector4[] => Array.from({ length: PART_N }, () => new THREE.Vector4(0, 0, 0, 0));
const NO_PART = partPoints();

export function cropUniforms(bend = 0.12): CropUniforms {
  return {
    uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.8, 0.3) }, uBend: { value: bend }, uDroop: { value: 0 },
    uDry: { value: 0 }, uGreen: { value: 0 }, uSat: { value: 1 }, uSnow: { value: 0 }, uPart: { value: NO_PART }, uPartK: { value: 0 },
  };
}

const VERT_HEAD = /* glsl */ `
uniform float uTime; uniform vec2 uWind; uniform float uBend; uniform float uDroop;
uniform vec4 uPart[${PART_N}]; uniform float uPartK;
varying float vUp;
`;
const VERT_BODY = /* glsl */ `
#include <begin_vertex>
{
  float hgt = max(position.y, 0.0);
  float k = hgt * hgt * uBend;
  vec3 ip = vec3(0.0);
  mat3 im = mat3(1.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
    im = mat3(instanceMatrix);
  #endif
  vec3 wp = (modelMatrix * vec4(ip, 1.0)).xyz;
  mat3 toWorld = mat3(modelMatrix) * im;
  float sc2 = max(1e-4, dot(toWorld[0], toWorld[0]));
  float ph = uTime * 1.9 + wp.x * 0.31 + wp.z * 0.23;
  float gust = 0.55 + 0.45 * sin(uTime * 0.7 + wp.x * 0.05 - wp.z * 0.04);
  float s = sin(ph) * 0.55 + sin(ph * 2.37 + 1.3) * 0.2;
  vec3 ww = vec3(uWind.x * (0.6 + 0.4 * s) * gust + s * 0.25, 0.0, uWind.y * (0.6 + 0.4 * s) * gust + cos(ph * 1.3) * 0.18);
  vec3 wl = transpose(toWorld) * ww / sc2;
  transformed.xz += wl.xz * k;
  // droop: tips fall toward local +x and down
  float dk = hgt * hgt * uDroop * 0.35;
  transformed.x += dk;
  transformed.y -= dk * 0.6;
  // parting: stalks near a farmer duck to ~40 % and lean away from them (a trampled, parted patch)
  if (uPartK > 0.0) {
    float duck = 0.0;
    vec2 away = vec2(0.0);
    for (int i = 0; i < ${PART_N}; i++) {
      vec4 pp = uPart[i];
      if (pp.w <= 0.0) continue;
      vec2 d = wp.xz - pp.xy;
      float l = length(d);
      float k = pp.w * (1.0 - smoothstep(pp.z * 0.45, pp.z, l));
      if (k > duck) { duck = k; away = d / max(l, 0.05); }
    }
    duck *= uPartK;
    if (duck > 0.0) {
      vec3 al = transpose(toWorld) * vec3(away.x, 0.0, away.y) / sc2;
      transformed.y *= 1.0 - 0.6 * duck;
      transformed.xz += al.xz * hgt * hgt * 0.55 * duck;
    }
  }
  vUp = normalize(toWorld * objectNormal).y;
}
`;
const FRAG_HEAD = /* glsl */ `
uniform float uDry; uniform float uGreen; uniform float uSat; uniform float uSnow;
varying float vUp;
`;
const FRAG_BODY = /* glsl */ `
#include <color_fragment>
{
  vec3 c = diffuseColor.rgb;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float green = clamp((c.g - max(c.r, c.b)) * 4.0, 0.0, 1.0);
  vec3 gold = vec3(luma) * vec3(1.55, 1.2, 0.55);
  c = mix(c, gold, green * uDry);
  c = mix(c, c * vec3(1.12, 0.96, 0.72), uDry * 0.6);
  vec3 unripe = vec3(luma) * vec3(0.85, 1.45, 0.55);
  c = mix(c, unripe, (1.0 - green) * uGreen);
  c = mix(vec3(luma), c, uSat);
  c = mix(c, vec3(0.93, 0.96, 1.0), smoothstep(0.55, 0.9, vUp) * uSnow);
  diffuseColor.rgb = c;
}
`;

/** Toon material with the crop shader; `u` is per material (one per field) but the program is shared. */
export function cropMaterial(u: CropUniforms, o: { side?: THREE.Side } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp(), side: o.side ?? THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', FRAG_BODY);
  };
  m.customProgramCacheKey = () => 'plots-crop';
  m.userData.u = u;
  // surfaces run right after color_fragment, i.e. before the crop tints (dry / unripe / snow paint over the detail)
  return withPlotSurfaces(m, CROP_SURFACES);
}

// ---------------------------------------------------------------------------------------------------------------
// Field surfaces

/** Field-only paints: `tagSurface(g, SURF.plain, paintTag('ribs'))`. */
export const PAINT = {
  ribs: { axis: 'y', variant: 1 },
  veins: { axis: 'y', variant: 2 },
  seeds: { axis: 'y', variant: 3 },
  tilled: { axis: 'x', variant: 1 },
  worn: { axis: 'x', variant: 2 },
  head: { axis: 'z', variant: 1 },
} as const satisfies Record<string, { axis: SurfAxis; variant: number }>;
export type PaintName = keyof typeof PAINT;
export const paintCode = (p: PaintName) => packCode(SURF.plain, PAINT[p].axis, PAINT[p].variant);

const CROP_SURFACES: SurfName[] = ['leaves', 'bark', 'hay'];
const PROP_SURFACES: SurfName[] = ['planks', 'logs', 'bark', 'shingle', 'tile', 'thatch', 'fieldstone', 'metal', 'fabric', 'hay', 'dirt', 'soil', 'snow', 'leaves'];

const PLOT_VERT_HEAD = /* glsl */ `
varying float vPlotAux;
varying float vPlotDry;
`;
const PLOT_VERT_BODY = /* glsl */ `
vPlotAux = surface.w;
vPlotDry = 0.0;
#ifdef USE_INSTANCING_COLOR
  vPlotDry = clamp((instanceColor.r - 1.0) / 0.14, 0.0, 1.0);
#endif
`;

const PLOT_FRAG_HEAD = /* glsl */ `
varying float vPlotAux;
varying float vPlotDry;
`;

const cPaint = (p: PaintName) => String(paintCode(p));

/** Paints for plain-tagged field parts (library helpers are in scope). */
const PLOT_PAINT = /* glsl */ `
vec3 plotTilled(vec3 c, vec3 lp, vec3 q, vec3 n, float pw, float near, float dry) {
  // lp: clod-local metres (x across the ridge, y up, z along it); q: the same + a per-clod offset (noise)
  float top = smoothstep(0.35, 0.75, n.y) * smoothstep(0.03, 0.08, lp.y);
  // moist, darker flanks and troughs; the crest dries lighter (fallow soil dries all over)
  float low = 1.0 - smoothstep(-0.1, 0.07, lp.y);
  c = sval(c, -0.16 * low * (1.0 - dry * 0.7));
  c = mix(c, c * vec3(0.92, 0.9, 1.02), low * (1.0 - dry) * 0.5);
  c = sval(c, 0.06 * top * smoothstep(0.02, 0.1, lp.y) * (1.0 - dry));
  // hoe lines along the ridge, wobbly
  float lh = slod(0.03, pw) * near;
  if (lh > 0.0) {
    float fx = lp.x / 0.12 + (svn(vec2(q.z * 1.8, q.x * 3.0)) - 0.5) * 0.7;
    float g = abs(fract(fx) - 0.5) * 2.0;
    c = sval(c, lh * top * (1.0 - dry * 0.6) * (-0.13 * (1.0 - sst(0.16, g, pw / 0.12 * 2.0)) + 0.05 * sst(0.7, g, pw / 0.12 * 2.0)));
  }
  // crumbs / clods: lit tops, shaded undersides
  float lc = slod(0.04, pw) * near;
  if (lc > 0.0) {
    vec4 d = sdot(q.xz / 0.1, 0.3, 0.55, pw / 0.1);
    c = sval(c, lc * d.x * (d.z > 0.0 ? 0.14 : -0.12));
    vec4 e = sdot(q.xz / 0.045 + 5.0, 0.3, 0.35, pw / 0.045);
    c = sval(c, -0.1 * lc * e.x);
  }
  // seed dots along the crest (freshly sown rows): a dark dibble hole, a pale seed beside it
  float ls = slod(0.03, pw) * near * top * (1.0 - dry);
  if (ls > 0.0) {
    float z = q.z / 0.2;
    float zi = floor(z), zf = fract(z) - 0.5;
    float jx = (sh1(vec2(zi, floor(q.x * 0.5))) - 0.5) * 0.08;
    vec2 d = vec2((lp.x - jx) / 0.2, zf);
    float hole = 1.0 - sst(0.1, length(d * vec2(1.0, 1.0)), pw / 0.2);
    float seed = 1.0 - sst(0.07, length(d - vec2(0.12, 0.12)), pw / 0.2);
    float on = step(0.25, sh1(vec2(zi, 3.3)));
    c = sval(c, ls * on * (-0.22 * hole * (1.0 - seed) + 0.35 * seed));
  }
  // fallow: dried, crazed crust
  float lk = slod(0.04, pw) * near * dry;
  if (lk > 0.0) {
    vec2 k1 = scrack(q.xz / 0.2, 0.8, 0.06, pw / 0.2);
    vec2 k2 = scrack(q.xz / 0.2 + vec2(0.06, -0.06), 0.8, 0.06, pw / 0.2);
    c = sval(c, lk * (0.1 * k2.x * (1.0 - k1.x) - 0.42 * k1.x));
  }
  return mix(c, vec3(sluma(c)) * vec3(1.06, 1.0, 0.9), dry * 0.25);
}

vec3 plotWorn(vec3 c, vec3 lp, vec3 q, float pw, float near) {
  // trampled pen floor / mulch: soft blotches, a darker worn rim, half-buried pebbles and scattered straw
  c = sblot(c, svn(q.xz * 1.3 + 2.0), 0.32, 0.66, 0.07, 0.08, pw * 1.3 + 0.003);
  c = sval(c, -0.14 * (1.0 - smoothstep(0.018, 0.032, lp.y)));
  float l = slod(0.035, pw) * near;
  if (l > 0.0) {
    vec4 pb = sdot(q.xz / 0.13 + 1.7, 0.22, 0.3, pw / 0.13);
    c = mix(c, sval(sgrey(c, 0.45), pb.z > 0.1 ? 0.12 : -0.04), pb.x * l * 0.9);
    vec2 st = sdash(q.xz / 0.11, sh1(floor(q.xz / 0.11)) * 6.28, 0.85, 0.07, 0.3, pw / 0.11);
    vec3 straw = vec3(sluma(c)) * vec3(1.45, 1.22, 0.62) + vec3(0.08, 0.06, 0.0);
    c = mix(c, straw, st.x * l * 0.75);
    vec4 e = sdot(q.xz / 0.05 + 4.0, 0.25, 0.3, pw / 0.05);
    c = sval(c, -0.1 * e.x * l);
  }
  return c;
}

vec3 plotPaint(vec3 c, float pw, float dist, float aw) {
  int code = int(vSurf.x + 0.5);
  if (code % 32 != ${SURF.plain} || code < 32) return c;
  float k = vSurf.z * uSurfStrength * uSurfDef.w;
  if (k <= 0.0) return c;
  float near = 1.0 - smoothstep(uSurfFar * 0.6, uSurfFar, dist);
  vec3 lp = vSurfP - vSurfOff;
  vec3 n = normalize(vSurfN);
  vec3 r = c;
  if (code == ${cPaint('tilled')}) {
    r = plotTilled(c, lp, vSurfP, n, pw, near, vPlotDry);
  } else if (code == ${cPaint('worn')}) {
    r = plotWorn(c, lp, vSurfP, pw, near);
  } else if (code == ${cPaint('ribs')}) {
    // pumpkin: dark grooves between the lobes, a sunny sheen on each lobe, faint streaks
    float rr = max(length(lp.xz), 1e-3);
    float a = atan(lp.z, lp.x);
    float cr = cos(a * 6.0);
    float w = pw * 6.0 / rr;
    float lr = slod(rr * 0.12, pw);
    float groove = 1.0 - sst(-0.55, cr, w);
    r = sval(r, lr * (-0.34 * groove + 0.13 * sst(0.45, cr, w)));
    // pale streaks running pole to pole, strongest on the lobes
    float st = svn(vec2(a * 14.0, lp.y * 2.0));
    r = sval(r, 0.12 * sst(0.6, st, 0.05) * (1.0 - groove) * slod(0.03, pw) * near);
  } else if (code == ${cPaint('head')}) {
    // cabbage head: overlapping leaves spiralling round it (a shaded lip under each leaf edge, a lit rim, a vein)
    vec3 d = normalize(lp + vec3(0.0, 1e-4, 0.0));
    float a = atan(lp.z, lp.x), el = asin(clamp(d.y, -1.0, 1.0));
    float u = a * (5.0 / 6.2832) + el * 1.3;
    float f = fract(u);
    float w = pw * (0.8 / max(length(lp.xz), 0.04) + 1.3 / max(length(lp), 0.04));
    float lh = slod(0.02, pw);
    r = sval(r, lh * (-0.24 * (1.0 - sst(0.1, f, w)) + 0.12 * sst(0.86, f, w)));
    float vein = 1.0 - sst(0.035, abs(f - 0.5), w);
    r = sval(r, 0.14 * vein * slod(0.012, pw) * near);
  } else if (code == ${cPaint('veins')}) {
    // leaf cards: a light midrib and faint side veins sweeping out to the edge (aux = 0 midrib … 1 edge)
    float x = vPlotAux;
    float lv = slod(0.012, pw) * near;
    float mid = 1.0 - sst(0.1, x, aw * 1.2);
    float R = length(lp);
    float sv = abs(fract(R / 0.08 - x * 1.6) - 0.5) * 2.0;
    float side = (1.0 - sst(0.16, sv, max(aw * 8.0, pw / 0.08 * 2.0))) * smoothstep(0.1, 0.18, x) * (1.0 - smoothstep(0.55, 0.9, x));
    // veins lighter, the leaf a touch darker and cooler toward its rim
    r = sval(r, lv * (0.3 * mid + 0.11 * side * slod(0.03, pw)) - 0.1 * smoothstep(0.45, 1.0, x) * slod(0.03, pw));
  } else if (code == ${cPaint('seeds')}) {
    // sunflower disc: packed seeds, darker towards the rim
    vec4 d = sdot(lp.xy / 0.026, 0.4, 0.9, pw / 0.026);
    float rim = smoothstep(0.06, 0.13, length(lp.xy));
    r = sval(r, slod(0.012, pw) * near * (d.x * (d.z > 0.0 ? 0.25 : 0.05) - 0.12 * (1.0 - d.x))) ;
    r = sval(r, -0.12 * rim);
  }
  return mix(c, r, k);
}
`;

const PLOT_FRAG = /* glsl */ `
{
  float sPw = surfPw(vSurfP);
  float sDist = length(vViewPosition);
  float pAw = fwidth(vPlotAux);
  vec3 sC = surfApply(diffuseColor.rgb, sPw, sDist);
  diffuseColor.rgb = plotPaint(sC, sPw, sDist, pAw);
}
`;

/** Surfaces + field paints on any lit material (chains after existing hooks such as the crop sway). */
export function withPlotSurfaces<M extends THREE.Material>(m: M, surfaces: readonly SurfName[] = PROP_SURFACES): M {
  withSurfaces(m, { surfaces: [...surfaces], fragment: PLOT_FRAG, fragmentKey: 'plots2' });
  return chainShader(m, (sh) => {
    if (surfaceQuality() === 'low') return;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${PLOT_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${PLOT_VERT_BODY}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${PLOT_FRAG_HEAD}`)
      .replace('vec3 surfApply(', `${PLOT_PAINT}\nvec3 surfApply(`);
  }, () => `plotpaint:${surfaceQuality() === 'low' ? 'off' : 'on'}`);
}

const propCache = new Map<string, THREE.MeshToonMaterial>();
/** The lit vertex-coloured material for field props (fence, signs, carts, sheds, soil, …): toon + surfaces. */
export function propMaterial(o: ToonOpts = {}): THREE.MeshToonMaterial {
  const key = JSON.stringify(o);
  let m = propCache.get(key);
  if (!m) { m = withPlotSurfaces(toon(0xffffff, { vertexColors: true, ...o, shared: false })); propCache.set(key, m); }
  return m;
}

/**
 * A crop part's uniforms + its toon and depth materials, pooled: fields come and go all day (a churny session built
 * ~1.9k crop materials a minute, each a JS object + three's per-material state, all to be collected), and the
 * programs are shared anyway (`customProgramCacheKey`). A material belongs to its uniforms (onBeforeCompile binds
 * them), so the three travel together and the uniforms are reset on reuse.
 */
export interface CropKit { u: CropUniforms; mat: THREE.MeshToonMaterial; depth: THREE.MeshDepthMaterial }
const cropPool: CropKit[] = [];
const CROP_POOL_MAX = 192;
export function takeCropKit(bend = 0.12): CropKit {
  const k = cropPool.pop();
  if (!k) { const u = cropUniforms(bend); return { u, mat: cropMaterial(u, { side: THREE.DoubleSide }), depth: cropDepthMaterial(u) }; }
  const u = k.u;
  u.uTime.value = 0; (u.uWind.value as THREE.Vector2).set(0.8, 0.3); u.uBend.value = bend; u.uDroop.value = 0;
  u.uDry.value = 0; u.uGreen.value = 0; u.uSat.value = 1; u.uSnow.value = 0; u.uPart.value = NO_PART; u.uPartK.value = 0;
  return k;
}
export function releaseCropKit(k: CropKit): void {
  if (cropPool.length < CROP_POOL_MAX) cropPool.push(k);
  else { k.mat.dispose(); k.depth.dispose(); }
}
export const cropPoolSize = (): number => cropPool.length;

/** Depth material for shadows that sways with the crop (keeps shadow and mesh in sync). */
export function cropDepthMaterial(u: CropUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', `vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n${VERT_BODY}`);
  };
  m.customProgramCacheKey = () => 'plots-crop-depth';
  return m;
}

/**
 * Instanced text material: each instance shows the atlas rect in attribute `aRect` (u0, v0, du, dv). The mesh is lit
 * like the rest of the world (toon) so signs sit in the scene, with a touch of emissive so text stays readable.
 */
export function atlasMaterial(tex: THREE.Texture): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonRamp(), transparent: true, alphaTest: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec4 aRect;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
#if defined(USE_MAP) && defined(USE_INSTANCING)
  vMapUv = vMapUv * aRect.zw + aRect.xy;
#endif`);
  };
  m.customProgramCacheKey = () => 'plots-atlas';
  return m;
}
