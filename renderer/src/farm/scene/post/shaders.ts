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
 * God rays (quarter res): march from the pixel toward the sun's screen position, gathering the open sky near the sun
 * (depth = far: the dome; clouds, trees, roofs and the rim occlude), with decay. The composite adds it in sun colour.
 */
export const raysFrag = /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform float uAspect;
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  const int N = 30;
  vec2 d = (uSunUv - vUv) / float(N);
  vec2 p = vUv + d * ign(gl_FragCoord.xy);
  float acc = 0.0, w = 1.0, wsum = 0.0;
  for (int i = 0; i < N; i++) {
    vec2 c = clamp(p, vec2(0.0), vec2(1.0));
    float sky = step(0.999999, texture2D(tDepth, c).x) * step(abs(p.x - 0.5), 0.5) * step(abs(p.y - 0.5), 0.5);
    vec2 q = (p - uSunUv) * vec2(uAspect, 1.0);
    acc += sky * exp(-dot(q, q) * 4.0) * w;
    wsum += w;
    w *= 0.975;
    p += d;
  }
  gl_FragColor = vec4(vec3(acc / wsum), 1.0);
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
uniform vec3 uHazeColor, uHazeWarm, uHazeDir;
// contact shadows: AO_TAPS (0 on quality low) depth taps around each pixel, uProjScale = pixels per metre at 1 m
uniform float uProjScale, uAO;
uniform vec3 uAOTint;
// cloud shadows
uniform float uCloudShadow, uCloudCover;
uniform vec2 uCloudOffset;
// mist banks (low-lying, ray-marched against the valley floor heightmap) + god rays
uniform sampler2D tGround;
uniform sampler2D tRays;
uniform float uBanks, uWater, uGroundHalf, uRays;
uniform vec2 uBankDrift;
uniform vec3 uBankColor, uRaysColor;
// grade
uniform float uNight, uBloom, uExposure, uSaturation, uContrast, uVignette, uFlash, uUseBloom;
uniform vec3 uGain, uShadowTint;
varying vec2 vUv;

float linZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// value noise from a 256² lattice texture (hash12 per texel, bilinear + smoothstep remap): one fetch instead of four
// hashes, same look (the cloud shadows and the mist-bank march call it per pixel / per step)
uniform sampler2D tNoise;
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return texture2D(tNoise, (i + f + 0.5) * (1.0 / 256.0)).r;
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
#if AO_TAPS > 0
  // --- contact shadows: what sits in front of this pixel's own plane, within a metre or so, darkens it (props on the
  // ground, posts in the turf, walls meeting the cobbles). The plane is extrapolated in raw depth (affine on any plane)
  // from the outline's four neighbours, so open ground and walls seen at a grazing angle never self-occlude.
  if (uAO > 0.0 && !sky && z0 < 60.0) {
    vec2 o = uTexel * uOutlinePx;
    float dl = texture2D(tDepth, uv - vec2(o.x, 0.0)).x, dr = texture2D(tDepth, uv + vec2(o.x, 0.0)).x;
    float dd = texture2D(tDepth, uv - vec2(0.0, o.y)).x, du = texture2D(tDepth, uv + vec2(0.0, o.y)).x;
    // one-sided slopes, the gentler side (a silhouette on one side must not tilt the plane)
    float gx = abs(dr - d0) < abs(d0 - dl) ? dr - d0 : d0 - dl;
    float gy = abs(du - d0) < abs(d0 - dd) ? du - d0 : d0 - dd;
    float rpx = clamp(0.75 * uProjScale / z0, 3.0, 48.0);
    float occ = 0.0;
    for (int i = 0; i < AO_TAPS; i++) {
      float fi = float(i);
      float a = fi * 2.39996 + 0.6;
      float r = rpx * (0.35 + 0.65 * (fi + 0.5) / float(AO_TAPS));
      vec2 off = vec2(cos(a), sin(a)) * r;
      float ds = texture2D(tDepth, uv + off * uTexel).x;
      float dp = clamp(d0 + (gx * off.x + gy * off.y) / uOutlinePx, 0.0, 1.0);
      float dz = linZ(dp) - linZ(ds);
      occ += smoothstep(0.09, 0.35, dz) * (1.0 - smoothstep(0.9, 2.2, dz));
    }
    occ = occ / float(AO_TAPS);
    occ = smoothstep(0.12, 0.7, occ) * (1.0 - smoothstep(35.0, 60.0, z0)) * uAO;
    // painted, not sooty: a cool tint toward the shadow colour
    col *= mix(vec3(1.0), uAOTint, occ);
  }
#endif

  col = mix(col, uInk * (0.35 + 0.65 * dot(col, vec3(0.3, 0.5, 0.2))), ink);

  // --- aerial perspective: far land recedes into a soft haze, warmer toward the sun (or silver toward the moon),
  // cooler away from it, and loses colour as it goes
  float lightSide = pow(max(dot(rd, uHazeDir), 0.0) * 0.5 + 0.5 * max(dot(rd, uHazeDir), 0.0), 2.0);
  vec3 hazeC = mix(uHazeColor, uHazeWarm, lightSide);
  if (!sky) {
    // the air thins with height (scale height ~110 m above the water): the mean density along the ray, so the
    // overview and the lookout see the valley floor crisply while a level look across it still fades
    float y0 = max(uCamPos.y - uWater, 0.0), y1 = max(wp.y - uWater, 0.0);
    float dy = y1 - y0;
    float thin = abs(dy) > 0.5 ? 110.0 * (exp(-y0 / 110.0) - exp(-y1 / 110.0)) / dy : exp(-y0 / 110.0);
    float hk = (1.0 - exp(-max(dist - 35.0, 0.0) / 240.0)) * uHaze * thin;
    float hl = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(mix(col, vec3(hl), hk * 0.5), hazeC, hk);
  }

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
    vec3 fc = mix(uFogColor, hazeC, 0.6) + uSunColor * pow(max(dot(rd, uSunDir), 0.0), 6.0) * 0.35;
    col = mix(col, fc, fogK);
  }

  // --- mist banks: thick over the river and pond and in the low ground, a thin skin over the fields, drifting
  if (uBanks > 0.001) {
    float top = uWater + 7.5;
    float t0 = 0.0, t1 = min(dist, 150.0);
    if (uCamPos.y > top) t0 = rd.y < -1e-4 ? (top - uCamPos.y) / rd.y : t1;
    if (rd.y > 1e-4) t1 = min(t1, max(0.0, (top - uCamPos.y) / rd.y));
    if (t1 > t0) {
      // up to 14 samples; short segments (ground a few metres away) need far fewer: about one per 6 m, at least 6
      const int N = 14;
      int steps = int(clamp(ceil((t1 - t0) / 6.0), 6.0, float(N)));
      float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float tau = 0.0, prev = t0;
      for (int i = 0; i < N; i++) {
        if (i >= steps) break;
        // samples bunch up near the eye (quadratic), where the layers are seen at their thinnest
        float u = (float(i) + jit) / float(steps);
        float t = t0 + (t1 - t0) * u * u;
        float ds = t - prev; prev = t;
        vec3 p = uCamPos + rd * t;
        float g = texture2D(tGround, p.xz / (2.0 * uGroundHalf) + 0.5).r;
        float wat = 1.0 - smoothstep(uWater - 0.2, uWater + 0.4, g);
        float h = p.y - max(g, uWater);
        // a dense sheet on the water, pooling in the low ground, a thin skin over the fields
        float dens = exp(-max(h, 0.0) / 1.1) * 2.2 * wat + exp(-max(p.y - uWater, 0.0) / 1.4) * 0.8 + exp(-max(h, 0.0) / 0.4) * 0.2;
        float n = vnoise(p.xz * 0.055 + uBankDrift) * 0.6 + vnoise(p.xz * 0.17 - uBankDrift * 1.8) * 0.4;
        dens *= smoothstep(0.38, 0.7, n + wat * 0.15) * 1.7;
        tau += dens * ds;
      }
      float k = min(1.0 - exp(-tau * 0.085 * uBanks), 0.92);
      float bl = dot(uBankColor, vec3(0.2126, 0.7152, 0.0722));
      vec3 bc = mix(uBankColor, vec3(bl), 0.5) * 1.15 + uSunColor * pow(max(dot(rd, uSunDir), 0.0), 4.0) * 0.4;
      col = mix(col, bc, k);
    }
  }

  // --- god rays
  if (uRays > 0.001) col += uRaysColor * texture2D(tRays, uv).r * uRays;

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
