/** GLSL for the post chain: bloom prefilter / down / up, the combined composite, FXAA. */

export const fullscreenVert = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** HDR → half res, soft-knee threshold, 13-tap (Jimenez) with a Karis-style average against fireflies */
export const prefilterFrag = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold, uKnee;
varying vec2 vUv;
vec3 thr(vec3 c) {
  if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);
  c = min(c, vec3(64.0));
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = rq * rq / (4.0 * uKnee + 1e-4);
  float w = max(rq, br - uThreshold) / max(br, 1e-4);
  return c * w / (1.0 + br * 0.25);
}
void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2( 1.0,  1.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 col = (thr(a) + thr(b) + thr(c) + thr(d)) * 0.125 + thr(e) * 0.5;
  gl_FragColor = vec4(col, 1.0);
}`;

/** dual-filter downsample */
export const downFrag = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv - t).rgb;
  s += texture2D(tSrc, vUv + t).rgb;
  s += texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb;
  s += texture2D(tSrc, vUv - vec2(t.x, -t.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

/** dual-filter upsample of the lower level, added onto this level */
export const upFrag = /* glsl */`
uniform sampler2D tSrc;
uniform sampler2D tBase;
uniform vec2 uTexel;
uniform float uMixBase;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 s = texture2D(tSrc, vUv + vec2(-t.x * 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, t.y * 2.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(t.x * 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, -t.y * 2.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(tBase, vUv).rgb * uMixBase, 1.0);
}`;

/**
 * The one combined pass: ink outlines from depth, height fog + sun scatter, drifting cloud shadows, bloom, grade,
 * tone map, vignette, dither → sRGB.
 */
export const compositeFrag = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uNear, uFar;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos;
uniform float uTime;
// outline
uniform vec3 uInk;
uniform float uInkStrength, uOutlinePx;
// fog + light
uniform vec3 uFogColor, uSunDir, uSunColor;
uniform float uMist, uMistHeight, uHaze;
uniform vec3 uHazeColor;
// cloud shadows
uniform float uCloudShadow, uCloudCover;
uniform vec2 uCloudOffset;
// grade
uniform float uNight, uBloom, uExposure, uSaturation, uContrast, uVignette, uFlash, uUseBloom;
uniform vec3 uGain, uShadowTint;
varying vec2 vUv;

float linZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// depth-only ink: extrapolate the raw depth (affine in screen space on any plane) from one side and compare with the
// other side in linear metres. Planes (and gentle facets) give ~0; silhouettes and hard creases give a large error.
float edgeAxis(float dc, float zc, float dA, float dB) {
  float eB = abs(linZ(dB) - linZ(clamp(2.0 * dc - dA, 0.0, 1.0)));
  float eA = abs(linZ(dA) - linZ(clamp(2.0 * dc - dB, 0.0, 1.0)));
  return min(eA, eB) / zc;
}

void main() {
  vec2 uv = vUv;
  vec4 c0 = texture2D(tColor, uv);
  vec3 col = c0.rgb;
  float cA = c0.a;
  if (any(isnan(col))) col = vec3(0.0);
  float d0 = texture2D(tDepth, uv).x;
  bool sky = d0 >= 0.999999;
  float z0 = linZ(d0);

  // world position of this pixel
  vec4 ndc = vec4(uv * 2.0 - 1.0, d0 * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc; vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec3 ray = wp - uCamPos;
  float dist = sky ? 700.0 : length(ray);
  vec3 rd = ray / max(length(ray), 1e-4);

  // --- ink outline (only on the near side of a silhouette so lines stay ~1px, faded with distance)
  float ink = 0.0;
  if (uInkStrength > 0.0 && !sky) {
    vec2 o = uTexel * uOutlinePx;
    float dl = texture2D(tDepth, uv - vec2(o.x, 0.0)).x;
    float dr = texture2D(tDepth, uv + vec2(o.x, 0.0)).x;
    float dd = texture2D(tDepth, uv - vec2(0.0, o.y)).x;
    float du = texture2D(tDepth, uv + vec2(0.0, o.y)).x;
    float zl = linZ(dl), zr = linZ(dr), zd = linZ(dd), zu = linZ(du);
    // silhouette: a neighbour is much farther than me (I am the foreground)
    float far = max(max(zl, zr), max(zd, zu)) - z0;
    float sil = smoothstep(0.06, 0.16, far / z0) * smoothstep(0.15, 0.4, far);
    // crease: plane extrapolation breaks
    float cr = max(edgeAxis(d0, z0, dl, dr), edgeAxis(d0, z0, dd, du));
    float crease = smoothstep(0.035, 0.08, cr);
    // I am the background of someone else's silhouette: leave the line to them
    float near = z0 - min(min(zl, zr), min(zd, zu));
    float bg = smoothstep(0.04, 0.08, near / z0);
    ink = max(sil, crease * (1.0 - bg) * 0.7);
    ink *= 1.0 - smoothstep(55.0, 170.0, z0);
    ink *= uInkStrength;
  }
  col = mix(col, uInk * (0.35 + 0.65 * dot(col, vec3(0.3, 0.5, 0.2))), ink);

  // --- aerial perspective: far land recedes into a soft sky-tinted haze
  if (!sky) col = mix(col, uHazeColor, smoothstep(50.0, 360.0, dist) * uHaze);

  // --- drifting cloud shadows on the ground
  if (uCloudShadow > 0.001 && !sky && dist < 260.0 && wp.y < 80.0) {
    vec2 q = (wp.xz - uCloudOffset) * 0.012;
    float n = vnoise(q) * 0.65 + vnoise(q * 2.3 + 7.1) * 0.35;
    float c = smoothstep(0.62 - uCloudCover * 0.3, 0.72 - uCloudCover * 0.3, n);
    col *= 1.0 - c * uCloudShadow * 0.32 * (1.0 - smoothstep(160.0, 260.0, dist));
  }

  // --- valley mist: exponential height fog (analytic along the ray), lit by the sun
  if (uMist > 0.001) {
    float b = 1.0 / uMistHeight;
    float a = 0.022 * uMist;
    float ry = rd.y;
    float oy = uCamPos.y - (-1.5);
    float fogAmt = a * exp(-oy * b) * (1.0 - exp(-dist * ry * b)) / (abs(ry) > 1e-3 ? ry * b : 1e-3 * b);
    if (abs(ry) <= 1e-3) fogAmt = a * exp(-oy * b) * dist;
    float fogK = 1.0 - exp(-max(fogAmt, 0.0));
    fogK = min(fogK, 0.94);
    vec3 fc = uFogColor + uSunColor * pow(max(dot(rd, uSunDir), 0.0), 6.0) * 0.35;
    col = mix(col, fc, fogK);
  }

  // --- bloom
  if (uUseBloom > 0.5) col += texture2D(tBloom, uv).rgb * uBloom;

  // --- grade in linear HDR, tone map, then display-space tweaks
  // warm = how lamp-lit this pixel is (its local-light share, written to alpha by the toon shader: 1 - share / 2;
  // values below 0.5 are not ours). At night moonlit tones lose colour into blue, but lamp pools, windows and fire keep
  // (and slightly gain) their colour and skip the cool white balance: a blue world with warm pockets.
  float warm = (cA >= 0.5 ? clamp((1.0 - cA) * 2.0, 0.0, 1.0) : 0.0) * uNight;
  col *= uExposure * mix(uGain, vec3(dot(uGain, vec3(0.3333))) * vec3(1.06, 1.0, 0.9), warm * 0.6);
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.25;
  col = neutral(col);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float satK = mix(uSaturation, max(uSaturation, 1.0), max(smoothstep(0.3, 0.8, lum), warm) * uNight);
  col = mix(vec3(lum) * mix(vec3(1.0), vec3(0.8, 0.92, 1.25), uNight * (1.0 - warm) * (1.0 - smoothstep(0.25, 0.7, lum))), col, satK);
  vec3 s = toSRGB(col);
  float sl = dot(s, vec3(0.299, 0.587, 0.114));
  // split-tone: cool-violet shadows, leaving warm highlights (lamps at night) untouched
  s += uShadowTint * pow(1.0 - sl, 2.0) * 1.25;
  s = (s - 0.5) * uContrast + 0.5;
  vec2 vv = (uv - 0.5) * vec2(1.0, 0.8);
  s *= 1.0 - uVignette * smoothstep(0.25, 0.75, length(vv) * 1.25);
  s += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}`;
