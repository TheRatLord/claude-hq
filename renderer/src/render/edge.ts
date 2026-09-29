/**
 * Environment edge lines (§5.1): a **planarity test** on reciprocal view depth, not a depth Sobel.
 * w = 1/z is affine in screen space across any plane, so e_i = |w(−1) + w(+1) − 2·w(0)| / w(0) is ≈ 0 on flat floors,
 * ramps and walls at any angle and spikes on creases and silhouettes. Fades by distance (18→30 m) and by view angle
 * (|n·v| 0.08→0.22, n from w derivatives). Skips any pixel whose 3×3 neighbourhood has alpha 0 (characters carry
 * their own hull lines) and fades under screen FX, which lower the alpha by their coverage (materials/overlay.ts). Depth is the shared scene depth (env only). High adds a reconstructed-normal crease term.
 * `debug = 1` outputs the binary edge mask (edgeCheck): R all lines, G lines that are not real steps (≥ 1.5 cm), B floor.
 * Owner: RND.
 */
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { hexToRgb, srgbToLinear, CORE } from '../../../shared/palette.ts';

const frag = /* glsl */ `
uniform float uTau;
uniform float uOpacity;
uniform float uWidth;
uniform float uNormalTerm;
uniform float uDebug;
uniform vec2 uProj;          // 1/P00, 1/P11
uniform vec3 uInk;
uniform vec3 uUpView;       // world up in view space (debug floor mask)

float wAt(vec2 uv) { float z = -getViewZ(readDepth(uv)); return 1.0 / max(z, 1e-4); }
vec3 posW(vec2 uv, float w) { float z = 1.0 / w; return vec3((uv * 2.0 - 1.0) * uProj * z, -z); }
// m2 fix r1 (dashed silhouettes): per direction, the planarity error, except on the *far* side of a depth
// discontinuity. A silhouette (door jamb against the wall or room behind it) used to fire on both pixels of the
// gap, and each side's fade used a normal reconstructed across the gap, so the grazing fade switched the line on
// and off along every long straight edge (dashes / serration). Now a one-sided jump (the silhouette case: this side
// continuous, the other ≥ 2 % of depth away) draws on its near pixel only, and flags it so the grazing fade skips it.
vec2 edgeDir(float wa, float wb, float w0) {
  float ja = wa - w0, jb = wb - w0;
  float e = abs(ja + jb) / w0;
  float big = abs(ja) > abs(jb) ? ja : jb;
  float sml = min(abs(ja), abs(jb));
  float disc = step(0.02 * w0, abs(big)) * step(sml, 0.25 * abs(big));
  // far side (the jumping neighbour is nearer: larger w): no line here, the near pixel draws it
  return disc > 0.5 && big > 0.0 ? vec2(0.0) : vec2(e, disc);
}
// best-of-two one-sided difference: the neighbour on this pixel's own surface (never across a silhouette gap)
vec3 sideStep(vec3 p, vec3 pm, vec3 pp, float wm, float wp, float w0) { return abs(wp - w0) <= abs(wm - w0) ? pp - p : p - pm; }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  // character mask: 4 bilinear taps at ±½ texel cover the 3×3 neighbourhood (any alpha 0 pulls a tap below 1)
  vec2 h = texelSize * 0.5;
  float mask = min(min(texture2D(inputBuffer, uv + vec2(-h.x, -h.y)).a, texture2D(inputBuffer, uv + vec2(h.x, -h.y)).a),
                   min(texture2D(inputBuffer, uv + vec2(-h.x, h.y)).a, texture2D(inputBuffer, uv + vec2(h.x, h.y)).a));
  // cover = this pixel's world mask. Characters are 0. Screen FX (bubbles, plates, glyphs) lower it by their own
  // coverage (overlay.ts), so scaling the line by it composites the line *under* the FX, as if they were drawn after
  // this pass. A character pixel anywhere in the 3×3 pulls some tap to ≤ ¾ of the centre (any FX in front scales
  // centre and taps alike), so the ratio test keeps the hard skip next to character silhouettes.
  float cover = inputColor.a;
  if (cover < 0.02 || mask < 0.8 * cover || depth >= 1.0) { if (uDebug > 0.5) outputColor = vec4(0.0, 0.0, 0.0, inputColor.a); return; }
  vec2 o = texelSize * uWidth;
  float w0 = wAt(uv);
  float wl = wAt(uv - vec2(o.x, 0.0)), wr = wAt(uv + vec2(o.x, 0.0));
  float wd = wAt(uv - vec2(0.0, o.y)), wu = wAt(uv + vec2(0.0, o.y));
  float wa = wAt(uv - o), wb = wAt(uv + o);
  float wc = wAt(uv + vec2(-o.x, o.y)), wdd = wAt(uv + vec2(o.x, -o.y));
  vec2 e0 = edgeDir(wl, wr, w0), e1 = edgeDir(wd, wu, w0), e2 = edgeDir(wa, wb, w0), e3 = edgeDir(wc, wdd, w0);
  float e = max(max(e0.x, e1.x), max(e2.x, e3.x));
  // silhouette: some direction over τ is a one-sided jump (then the grazing fade below does not apply)
  float sil = max(max(e0.y * step(uTau, e0.x), e1.y * step(uTau, e1.x)), max(e2.y * step(uTau, e2.x), e3.y * step(uTau, e3.x)));
  // soft threshold (m2 fix r1): a crease hovering near τ fades in and out along its length instead of breaking into dots
  float line = smoothstep(0.7 * uTau, 1.6 * uTau, e);
  float z = 1.0 / w0;
  vec3 p = posW(uv, w0);
  vec3 px = posW(uv + vec2(o.x, 0.0), wr), py = posW(uv + vec2(0.0, o.y), wu);
  vec3 pxm = posW(uv - vec2(o.x, 0.0), wl), pym = posW(uv - vec2(0.0, o.y), wd);
  vec3 n = normalize(cross(sideStep(p, pxm, px, wl, wr, w0), sideStep(p, pym, py, wd, wu, w0)));
  float ndv = abs(dot(n, normalize(-p)));
  if (uNormalTerm > 0.5) {
    vec3 nl = normalize(cross(p - posW(uv - vec2(o.x, 0.0), wl), py - p));
    vec3 nd = normalize(cross(px - p, p - posW(uv - vec2(0.0, o.y), wd)));
    line = max(line, step(0.35, 1.0 - dot(nl, nd)) * step(0.02, e));
  }
  float fade = smoothstep(30.0, 18.0, z) * max(sil, smoothstep(0.08, 0.22, ndv));
  float a = line * fade * cover;
  // debug (edgeCheck): R = binary edge mask; G = the same minus real steps; B = "floor" (reconstructed normal within
  // ~25° of world up), for edgeCheck's automatic floor region when a pose has no authored floorCrop.
  // A "real step" (§11.5 ENV → RND): some opposite neighbour pair differs in world height by ≥ 1.5 cm, i.e. the line is
  // a tread nosing, a bench/table top over the floor or a dais lip seen against the floor behind it. Those are the
  // creases §5.1 allows; coplanar decals, rug borders (6 mm) and pattern/precision swim stay counted.
  // A pixel that is farther or nearer than *both* neighbours of a pair is a hole or a 1 px sliver (a T-junction crack
  // showing the ground below, a cable), not a step edge: it stays counted, so cracks still fail edgeCheck.
  if (uDebug > 0.5) {
    float hs = abs(dot(posW(uv - vec2(o.x, 0.0), wl) - posW(uv + vec2(o.x, 0.0), wr), uUpView));
    hs = max(hs, abs(dot(posW(uv - vec2(0.0, o.y), wd) - posW(uv + vec2(0.0, o.y), wu), uUpView)));
    hs = max(hs, abs(dot(posW(uv - o, wa) - posW(uv + o, wb), uUpView)));
    hs = max(hs, abs(dot(posW(uv + vec2(-o.x, o.y), wc) - posW(uv + vec2(o.x, -o.y), wdd), uUpView)));
    float m = 0.01 * w0;   // 1 % tolerance
    float hole = 0.0;
    hole = max(hole, step(m, min(wl, wr) - w0) + step(m, w0 - max(wl, wr)));
    hole = max(hole, step(m, min(wd, wu) - w0) + step(m, w0 - max(wd, wu)));
    hole = max(hole, step(m, min(wa, wb) - w0) + step(m, w0 - max(wa, wb)));
    hole = max(hole, step(m, min(wc, wdd) - w0) + step(m, w0 - max(wc, wdd)));
    // ... and the pixels beside such a sliver: the jump must persist one more pixel out (a real far/near surface),
    // else the neighbour was a 1 px crack
    vec2 o2 = 2.0 * o;
    float s2 = 0.0;
    s2 = max(s2, step(m, abs(wr - w0)) * step(abs(wAt(uv + vec2(o2.x, 0.0)) - w0), 0.3 * abs(wr - w0)));
    s2 = max(s2, step(m, abs(wl - w0)) * step(abs(wAt(uv - vec2(o2.x, 0.0)) - w0), 0.3 * abs(wl - w0)));
    s2 = max(s2, step(m, abs(wu - w0)) * step(abs(wAt(uv + vec2(0.0, o2.y)) - w0), 0.3 * abs(wu - w0)));
    s2 = max(s2, step(m, abs(wd - w0)) * step(abs(wAt(uv - vec2(0.0, o2.y)) - w0), 0.3 * abs(wd - w0)));
    float isStep = step(0.015, hs) * (1.0 - min(hole + s2, 1.0));   // ≥ 1.5 cm: prop foot plates (2 cm) are geometry, rugs (6 mm) and decals stay counted
    float ed = step(0.5, a);
    outputColor = vec4(ed, ed * (1.0 - isStep), step(0.9, dot(n, uUpView)), inputColor.a);
    return;
  }
  outputColor = vec4(mix(inputColor.rgb, uInk, a * uOpacity), inputColor.a);
}
`;

export class EdgeEffect extends Effect {
  camera: THREE.PerspectiveCamera;
  constructor(camera: THREE.PerspectiveCamera) {
    const [ir, ig, ib] = hexToRgb(CORE.ink).map(srgbToLinear);
    super('HqEdgeEffect', frag, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['uTau', new THREE.Uniform(0.012)],
        ['uOpacity', new THREE.Uniform(0.55)],
        ['uWidth', new THREE.Uniform(1)],
        ['uNormalTerm', new THREE.Uniform(0)],
        ['uDebug', new THREE.Uniform(0)],
        ['uProj', new THREE.Uniform(new THREE.Vector2(1, 1))],
        ['uInk', new THREE.Uniform(new THREE.Vector3(ir, ig, ib))],
        ['uUpView', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
      ]),
    });
    this.camera = camera;
  }
  /** A uniform this effect registered in its constructor. */
  private uni<T>(name: string): THREE.Uniform<T> {
    const u = this.uniforms.get(name);
    if (!u) throw new Error(`EdgeEffect: no uniform ${name}`);
    return u;
  }
  get debug(): number { return this.uni<number>('uDebug').value; }
  set debug(v: unknown) { this.uni<number>('uDebug').value = v ? 1 : 0; }
  setTier(tier: 'low' | 'medium' | 'high' | 'photo') {
    this.uni<number>('uNormalTerm').value = tier === 'high' || tier === 'photo' ? 1 : 0;
    this.uni<number>('uWidth').value = tier === 'high' || tier === 'photo' ? 1.5 : 1;
  }
  override update() {
    const p = this.camera.projectionMatrix.elements;
    this.uni<THREE.Vector2>('uProj').value.set(1 / p[0], 1 / p[5]);
    if (this.debug) this.uni<THREE.Vector3>('uUpView').value.set(0, 1, 0).transformDirection(this.camera.matrixWorldInverse);
  }
}
