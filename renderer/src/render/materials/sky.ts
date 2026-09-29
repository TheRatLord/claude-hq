/**
 * Window sky (ART §3.3 "Sky (windows)", §7.3): unlit, direction-based so a flat card behind a window reads as an
 * infinite vista with parallax. Gradient skyTop→horizon by hour, a soft sun glow, two fbm cloud bands drifting, two
 * layers of rolling hills with a few lollipop trees, heavy haze. Everything ≤ 0.92 linear (never blooms, §5.0).
 * Owner: RND.
 */
import * as THREE from 'three';
import { U } from '../uniforms.ts';
import type { MaterialOpts } from './index.ts';

export function skyMaterial(opts: MaterialOpts = {}): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uSunDir: U.uSunDir, uSkyTop: U.uSkyTop, uSkyHorizonIn: U.uSkyHorizon, uSkyHorizonAway: U.uSkyHorizonAway, uNight: U.uNight, uEmissiveGain: U.uEmissiveGain, uSkyMask: U.uSkyMask, ...opts.uniforms },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSkyTop; uniform vec3 uSkyHorizonIn; uniform vec3 uSkyHorizonAway; uniform float uNight; uniform float uSkyMask;
      varying vec3 vW;
      float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h1(i), h1(i + vec2(1, 0)), u.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p) { return n2(p) * 0.55 + n2(p * 2.1) * 0.28 + n2(p * 4.3) * 0.17; }
      // m2 fix r1 (seam): azimuth wraps at ±π (due south, straight out of the entrance), so every azimuth-driven term
      // must be 2π-periodic. Periodic value noise: the lattice wraps every P cells in x, so fbm over (az/2π·P, y) is
      // continuous across the wrap; octave frequencies are integers (1, 2, 4) so each octave wraps too
      float n2p(vec2 p, float P) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        float i0 = mod(i.x, P), i1 = mod(i.x + 1.0, P);
        return mix(mix(h1(vec2(i0, i.y)), h1(vec2(i1, i.y)), u.x), mix(h1(vec2(i0, i.y + 1.0)), h1(vec2(i1, i.y + 1.0)), u.x), u.y); }
      float fbmp(vec2 p, float P) { return n2p(p, P) * 0.55 + n2p(p * 2.0, P * 2.0) * 0.28 + n2p(p * 4.0, P * 4.0) * 0.17; }
      void main() {
        vec3 d = normalize(vW - cameraPosition);
        float az = atan(d.x, -d.z);
        float el = d.y;
        // the horizon glows toward the sun's azimuth only (golden hour: peach there, lilac elsewhere; fix r2)
        vec2 hz = normalize(d.xz + vec2(1e-5)), sz = normalize(uSunDir.xz + vec2(1e-5));
        vec3 uSkyHorizon = mix(uSkyHorizonAway, uSkyHorizonIn, smoothstep(-0.3, 0.85, dot(hz, sz)));
        vec3 col = mix(uSkyHorizon, uSkyTop, pow(smoothstep(-0.02, 0.32, el), 0.7));
        // night zenith (fix r1): the skylight looks almost straight up, where the day gradient is flat; after dark the
        // sky keeps deepening toward the zenith, so the skylight reads as a night-blue gradient, not a flat slab
        col *= mix(1.0, 0.5, smoothstep(0.35, 1.0, el) * uNight);
        // sun glow (cosmetic sun direction)
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(sd, 24.0) * 0.35 + pow(sd, 400.0) * 0.4) * step(0.0, uSunDir.y);
        // stars at night
        float az01 = az * 0.15915494 + 0.5;   // 0..1 round the horizon (wraps at due south)
        // stars (m2 fix r1): small round points jittered inside a fine az/el grid (was 1° squares), varied brightness
        {
          vec2 sp = vec2(az01 * 1131.0, el * 180.0);
          vec2 si = vec2(mod(floor(sp.x), 1131.0), floor(sp.y)), sf = fract(sp);
          float r = h1(si + 17.0);
          vec2 jit = vec2(h1(si + 3.1), h1(si + 5.7)) * 0.6 + 0.2;
          float star = step(0.975, r) * smoothstep(0.26, 0.08, length(sf - jit)) * (0.35 + 0.65 * h1(si + 9.3));
          col += uNight * star * smoothstep(0.1, 0.25, el) * 0.55;
        }
        // clouds: two drifting bands
        vec2 cp = vec2(az01 * 14.0 + uTime * 0.004, el * 7.0 * 2.2);
        float c = smoothstep(0.5, 0.72, fbmp(cp, 14.0)) * smoothstep(0.06, 0.2, el) * smoothstep(0.7, 0.3, el);
        // night clouds (fix r1): moonlit navy, a little lighter than the sky around them (0.3 × the day cloud was a
        // beige-grey that made the atrium skylight read as a flat pale slab at 22 h)
        vec3 cloudCol = mix(mix(vec3(0.9, 0.88, 0.84), uSkyHorizon, 0.25), uSkyTop * 1.7 + vec3(0.006, 0.008, 0.02), uNight);
        col = mix(col, cloudCol, c * 0.85);
        // [ENV M2 breadth, cross-owner RND] §7.3 exterior cards by azimuth: south / east = hills with a row of blob
        // trees (denser to the south: the garden's backdrop), north = 3 layered flat skyline cards (rounded roofs,
        // water towers, antennae, a crane; lit-window dots after dark), west = a canal (quay, water band with the sky
        // reflected, low far bank). Each skyline layer is one value step closer to the horizon with distance.
        vec3 haze = mix(uSkyHorizon, uSkyTop, 0.25);
        float cz = cos(az), sx = sin(az);
        float north = smoothstep(0.12, 0.55, cz), west = smoothstep(0.35, 0.8, -sx) * (1.0 - north), south = smoothstep(0.2, 0.7, -cz);
        vec3 sky0 = col;
        // hills: far (hazy) then near with lollipop trees
        float far = 0.07 + 0.045 * sin(az * 3.0 + 1.3) + 0.025 * sin(az * 7.0 + 0.2);
        float nearH = 0.02 + 0.04 * sin(az * 5.0 + 2.0) + 0.018 * sin(az * 13.0);
        // [ENV fix m3 r1, cross-owner RND] night hills are dark blue-green silhouettes (review m3 r1 art: at 22 h they
        // stayed saturated green under a black starry sky, "a day card pasted under a night sky"); same night multiplier
        // as ENV's 3D window scenery (build/index.ts SCENERY_TINT.night), one step darker for the far ridge
        vec3 farCol = mix(vec3(0.32, 0.46, 0.44), haze, 0.45) * mix(vec3(1.0), vec3(0.2, 0.26, 0.38), uNight);
        vec3 nearCol = mix(vec3(0.2, 0.34, 0.2), haze, 0.18) * mix(vec3(1.0), vec3(0.17, 0.25, 0.36), uNight);
        col = mix(col, farCol, smoothstep(0.004, 0.0, el - far));
        float tx = fract(az01 * 57.0); float tid = mod(floor(az01 * 57.0), 57.0);
        // lollipop trees standing on the near hill: a round crown on a trunk (m2 fix r1: crowns alone read as green
        // dots floating over the far hill wherever the garden hides the near hill line)
        float hasT = step(mix(0.55, 0.2, south), h1(vec2(tid, 3.0)));
        float tH = 0.03 + 0.012 * h1(vec2(tid, 5.0));
        float crown = smoothstep(0.1, 0.09, length(vec2((tx - 0.5) * 0.9, (el - nearH - tH) * 10.0)));
        float trunk = step(abs(tx - 0.5), 0.025) * step(el, nearH + tH) * step(nearH - 0.01, el);
        col = mix(col, mix(nearCol * 0.92, vec3(0.3, 0.22, 0.18) * mix(1.0, 0.4, uNight), trunk * (1.0 - crown) * 0.7), hasT * max(crown, trunk));
        col = mix(col, nearCol * 0.92, smoothstep(0.004, 0.0, el - nearH));
        // [ENV fix m3 r1, cross-owner RND] after dark a few treeless slots hold a farmhouse: a warm window dot just under
        // the near ridge (the 3D west hills carry lit cottages, build/zones/exterior.ts)
        float hasH = step(0.86, h1(vec2(tid, 11.0))) * (1.0 - hasT);
        float hDot = step(abs(tx - 0.5 + 0.2 * (h1(vec2(tid, 13.0)) - 0.5)), 0.05) * step(abs(el - nearH + 0.007), 0.0028);
        col = mix(col, vec3(1.0, 0.74, 0.42) * 0.62, hasH * hDot * uNight);
        if (north > 0.0) {
          // m2 fix r3 (skyline read as "a ladder of stripes on a grey band"): three layers of distinct buildings, each
          // with its own height (a wide spread, a few towers), a roof type (flat + parapet, setback, gable, spire,
          // water tower) and a value step per layer (far = hazy, near = darkest), standing in front of the hills. The
          // city tapers into the hills at its ends (heights → 0) instead of cross-fading over them. Windows are a
          // square-ish angular grid of dots kept inside each body (side margins, below the roof line, off the
          // parapet/roof shapes); after dark ~⅓ are lit (warm, a few cool), per building so some blocks are dark.
          float taper = smoothstep(0.12, 0.62, cz);
          vec3 city = vec3(0.2, 0.23, 0.29);
          vec3 nightB = vec3(0.016, 0.018, 0.04);   // under the night horizon #34385E (lin .034/.039/.11): silhouettes
          for (int L = 0; L < 3; L++) {
            float fl = float(L); // 0 far, 1 mid, 2 near
            float k = 12.0 - fl * 3.0, sd = 5.0 + fl * 13.0;
            float u = az * k + sd, id = floor(u), f = fract(u);
            float r1 = h1(vec2(id, sd)), r2 = h1(vec2(id, sd + 3.1)), r3 = h1(vec2(id, sd + 7.7)), r4 = h1(vec2(id, sd + 11.3));
            // body: a random width inside the cell (gaps show the layer behind), height with a wide spread + towers
            float gl = 0.04 + 0.22 * r1, gr = 0.04 + 0.22 * r4;
            float e = min(f - gl, 1.0 - gr - f) / k;                      // radians from the nearer side edge (< 0 = gap)
            float w = (1.0 - gl - gr) / k;                                // body width, radians
            float hgt = (0.035 + 0.012 * fl) + (0.05 + 0.015 * fl) * r2 * r2 + step(0.86, r2) * (0.04 + 0.02 * fl);
            float roof = hgt * taper;
            if (roof < 0.006) continue;
            float aa = 0.0014;
            float body = step(0.0, e) * smoothstep(roof + aa, roof - aa, el);
            float c = body;
            float xm = (f - gl) / max(1e-4, 1.0 - gl - gr) - 0.5;          // -0.5..0.5 across the body
            float top = roof;                                             // the highest solid line (window cut-off)
            if (r3 < 0.28) {            // flat roof: parapet lip + a little rooftop box
              c = max(c, step(0.0, e) * step(el, roof + 0.004) * step(roof, el));
              c = max(c, step(abs(xm - 0.18), 0.12) * step(roof, el) * step(el, roof + 0.011));
            } else if (r3 < 0.46) {     // setback: a narrower upper block
              float h2 = roof + 0.02 + 0.02 * r4;
              c = max(c, step(abs(xm), 0.3) * step(roof - aa, el) * smoothstep(h2 + aa, h2 - aa, el));
              top = h2;
            } else if (r3 < 0.62) {     // gable
              float ridge = roof + w * 0.35;
              c = max(c, step(0.0, e) * step(roof - aa, el) * smoothstep(0.0, aa, (ridge - el) - abs(xm) * 2.0 * (ridge - roof)));
            } else if (r3 < 0.76) {     // spire / antenna tower
              float h2 = roof + 0.035 + 0.02 * r1;
              c = max(c, smoothstep(0.0, aa, (h2 - el) * 0.12 - abs(xm) * w * 0.9) * step(roof - aa, el) * step(el, h2));
              c = max(c, step(abs(xm * w), 0.0008) * step(el, h2 + 0.02) * step(roof, el));
            } else if (r3 > 0.88) {     // water tower on legs
              float wx = xm * w;
              c = max(c, step(abs(wx - 0.004), 0.009) * step(roof + 0.01, el) * step(el, roof + 0.026));
              c = max(c, smoothstep(0.0, aa, 0.009 - abs(wx - 0.004) - (el - roof - 0.026) * 0.8) * step(roof + 0.026, el) * step(el, roof + 0.036));
              c = max(c, step(abs(abs(wx - 0.004) - 0.007), 0.0009) * step(roof, el) * step(el, roof + 0.01));
            }
            // the crane stands in the mid layer
            if (L == 1) {
              float ca = az - 0.42;
              c = max(c, taper * step(abs(ca), 0.0025) * smoothstep(0.2, 0.196, el));
              c = max(c, taper * step(-0.1, ca) * step(ca, 0.16) * step(0.184, el) * step(el, 0.192));
              c = max(c, taper * step(abs(ca - 0.13), 0.0012) * step(0.12, el) * step(el, 0.184));
              c = max(c, taper * step(abs(ca + 0.075), 0.02) * step(0.17, el) * step(el, 0.184));
            }
            // value per layer: far = hazy and light, near = dark (day); at night navy silhouettes under the horizon
            // a per-building paint by day (slate / sand / brick / sage, low chroma so the haze still reads)
            vec3 paint = r4 < 0.3 ? vec3(0.2, 0.23, 0.29) : r4 < 0.55 ? vec3(0.3, 0.27, 0.22) : r4 < 0.78 ? vec3(0.3, 0.2, 0.17) : vec3(0.22, 0.26, 0.23);
            vec3 lcD = mix(mix(city, paint, 0.6), haze, 0.62 - fl * 0.24);
            vec3 lcN = nightB * (1.45 - fl * 0.28) * (1.0 - 0.08 * r4);
            vec3 lc = mix(lcD, lcN, uNight);
            // windows: angular grid (square-ish dots, bigger on nearer layers), inside the body only
            float gx = 0.0048 + 0.0014 * fl, gy = 0.0058 + 0.0016 * fl;
            float eL = (f - gl) / k;                                      // radians from the body's left edge
            vec2 wc = vec2(eL / gx, (el - 0.004) / gy);
            vec2 wi = floor(wc), wf = fract(wc);
            float inWin = step(abs(wf.x - 0.5), 0.23) * step(abs(wf.y - 0.5), 0.26)
                        * step(gx * 0.55, eL) * step(gx * 0.55, w - eL) * step(el, top - gy * 0.8) * step(0.006, el) * body;
            float warmB = h1(vec2(id, sd + 21.0));                                    // this building's occupancy
            float rw = h1(wi + vec2(id * 13.0, sd));
            float on = step(1.0 - (0.14 + 0.36 * warmB), rw) * step(0.75, taper);   // the tapering ends stay dark
            vec3 wcol = mix(vec3(1.0, 0.72, 0.36), vec3(1.0, 0.86, 0.58), h1(wi + id)) * (0.62 - fl * 0.06);
            wcol = mix(wcol, vec3(0.55, 0.7, 0.95) * 0.5, step(0.93, h1(wi * 1.7 + id)));   // the odd TV-blue window
            // by day the panes are just a touch darker glass on the facade (texture, never lit)
            lc = mix(lc, lc * 0.82, inWin * (1.0 - uNight));
            lc = mix(lc, wcol, inWin * on * uNight);
            col = mix(col, lc, c);
          }
          // a low strip of park trees in front of the city
          float pu = az * 26.0, pf = fract(pu) - 0.5;
          float pt = 0.006 + 0.004 * sin(az * 9.0) + step(0.35, h1(vec2(floor(pu), 4.0))) * 0.014 * sqrt(max(0.0, 1.0 - pf * pf * 4.4));
          col = mix(col, nearCol * 0.9, north * smoothstep(0.003, 0.0, el - pt));
        }
        if (west > 0.0) {
          vec3 cw = sky0;
          float fb = 0.035 + 0.02 * sin(az * 4.0 + 0.5) + 0.01 * sin(az * 11.0);
          cw = mix(cw, farCol, smoothstep(0.004, 0.0, el - fb));
          float wt = fract(az * 14.0); float wid = floor(az * 14.0);
          float wtr = step(0.3, h1(vec2(wid, 9.0)));
          cw = mix(cw, nearCol * 0.95, wtr * max(smoothstep(0.1, 0.09, length(vec2((wt - 0.5) * 0.55, (el - 0.03) * 3.2))), step(abs(wt - 0.5), 0.025) * step(el, 0.03)));
          vec3 quay = mix(vec3(0.55, 0.52, 0.47), haze, 0.3) * mix(1.0, 0.4, uNight);
          cw = mix(cw, quay, smoothstep(0.012, 0.009, el));
          vec3 water = mix(uSkyHorizon, uSkyTop, 0.55) * 0.85 + 0.012 * sin(el * 700.0 + sin(az * 40.0) * 2.0 + uTime * 0.6);
          cw = mix(cw, water, smoothstep(0.003, 0.0, el));
          cw = mix(cw, quay * 0.85, smoothstep(-0.04, -0.043, el));
          cw = mix(cw, nearCol, smoothstep(-0.052, -0.055, el));
          col = mix(col, cw, west);
        }
        gl_FragColor = vec4(min(col, vec3(0.92)) * (1.0 - uSkyMask), 1.0);   // uSkyMask: probe.ts lumaStats (sky leaves the measure)
      }`,
  });
  return m;
}
