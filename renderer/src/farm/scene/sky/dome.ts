/**
 * The sky dome: one sphere that follows the camera, drawn first without depth. Gradient zenith → horizon with a
 * sun-side glow, a soft sun disk (HDR so it blooms), the moon with its real phase and a halo, twinkling stars that
 * wheel slowly around the pole with a faint milky band, and a rainbow on the antisolar ring after rain.
 */
import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99995, p.w); // just inside the far plane
}`;

const frag = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uGlow, uSunColor;
uniform vec3 uSunDir, uMoonDir, uAntiSun;
uniform vec2 uDeckOffset;
uniform vec3 uDeckLit, uDeckShade;
uniform float uDeck;
uniform float uSunVis, uMoonVis, uMoonPhase, uStars, uTime, uStarAngle, uRainbow, uOvercast, uFlash;
varying vec3 vDir;

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash13(vec3(i, 1.0)), b = hash13(vec3(i + vec2(1, 0), 1.0)), c = hash13(vec3(i + vec2(0, 1), 1.0)), d = hash13(vec3(i + vec2(1, 1), 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm2(vec2 p) { return n2(p) * 0.5 + n2(p * 2.03 + 1.7) * 0.28 + n2(p * 4.1 - 3.1) * 0.14 + n2(p * 8.3 + 5.3) * 0.08; }
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // gradient: a soft horizon band, then up to the zenith
  float t = pow(clamp(h, 0.0, 1.0), 0.5);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.9, t));
  float sd = dot(d, uSunDir);
  // the sun-side sky warms (strongest near the horizon), the far side stays cool
  float side = max(sd, 0.0);
  float horizonBand = 1.0 - smoothstep(0.0, 0.55, max(h, 0.0));
  col = mix(col, uGlow, (pow(side, 3.0) * 0.75 * horizonBand + pow(side, 14.0) * 0.35) * uSunVis);
  // below the horizon (seen past the valley rim): fade to the ground haze
  col = mix(col, uGround, smoothstep(0.0, -0.2, h));

  // stars + milky band (rotating about a pole tilted north)
  if (uStars > 0.001 && h > -0.05) {
    float ca = cos(uStarAngle), sa = sin(uStarAngle);
    vec3 pole = normalize(vec3(0.0, 0.64, -0.77));
    // rotate d about the pole (Rodrigues)
    vec3 r = d * ca + cross(pole, d) * sa + pole * dot(pole, d) * (1.0 - ca);
    float fade = smoothstep(-0.02, 0.25, h) * uStars;
    vec3 sp = r * 170.0;
    vec3 cell = floor(sp);
    vec3 rnd = hash33(cell);
    float star = 0.0;
    if (rnd.x > 0.9) {
      vec3 c = cell + 0.2 + 0.6 * hash33(cell + 7.0);
      float dist = length(sp - c);
      float size = mix(0.16, 0.34, pow(rnd.y, 4.0));
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + rnd.z * 3.0) + rnd.y * 40.0);
      star = smoothstep(size, size * 0.2, dist) * tw * (0.5 + 2.2 * pow(rnd.z, 3.0));
    }
    vec3 starCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), rnd.y);
    col += starCol * star * fade * 2.2;
    // milky band along a great circle
    vec3 bandN = normalize(vec3(0.3, 0.35, 0.88));
    float b = dot(r, bandN);
    float band = exp(-b * b * 22.0);
    float n = vnoise(r * 5.0) * 0.6 + vnoise(r * 11.0) * 0.3 + vnoise(r * 23.0) * 0.1;
    col += vec3(0.32, 0.36, 0.55) * band * smoothstep(0.35, 0.8, n) * fade * 0.16;
  }

  // sun: a soft round disk with a warm halo
  float sunA = acos(clamp(sd, -1.0, 1.0));
  float disk = smoothstep(0.047, 0.042, sunA);
  float halo = exp(-sunA * 14.0) * 0.55 + exp(-sunA * 4.5) * 0.18;
  col += uSunColor * (disk * 6.0 + halo) * uSunVis * (1.0 - uOvercast * 0.85) * smoothstep(-0.06, 0.02, h);

  // moon with phase (halo everywhere, disk only near it)
  float md = dot(d, uMoonDir);
  if (uMoonVis > 0.001) {
    float ma = acos(clamp(md, -1.0, 1.0));
    float halo2 = (exp(-ma * 30.0) * 0.22 + exp(-ma * 8.0) * 0.06) * (0.3 + 0.7 * sin(uMoonPhase * 3.14159));
    vec3 moonCol = col + vec3(0.6, 0.7, 1.0) * halo2;
    if (md > 0.99) {
      const float R = 0.036;
      vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(right, uMoonDir);
      vec2 q = vec2(dot(d, right), dot(d, up)) / R;
      float r2 = dot(q, q);
      if (r2 < 1.0) {
        vec3 n = vec3(q, sqrt(1.0 - r2));
        float th = uMoonPhase * 6.28318;
        vec3 L = vec3(sin(th), 0.0, -cos(th));
        float lit = smoothstep(-0.08, 0.12, dot(n, L));
        float m = vnoise(vec3(q * 2.6, 3.0)) * 0.6 + vnoise(vec3(q * 6.0, 9.0)) * 0.4;
        vec3 surf = mix(vec3(1.0, 0.96, 0.86), vec3(0.74, 0.74, 0.8), smoothstep(0.45, 0.7, m));
        vec3 dark = mix(uHorizon, uZenith, 0.7) * 0.85 + vec3(0.01, 0.015, 0.03);
        float edge = smoothstep(1.0, 0.9, r2);
        moonCol = mix(moonCol, mix(dark, surf * 1.05, lit), edge);
      }
    }
    col = mix(col, moonCol, uMoonVis * smoothstep(-0.03, 0.02, h));
  }

  // overcast deck: a banded, drifting cloud layer that closes over the sky as cover rises
  if (uDeck > 0.001 && h > -0.02) {
    vec2 p = d.xz / (max(h, 0.0) + 0.1) * 0.9 + uDeckOffset;
    float n = fbm2(p);
    float th = mix(0.72, 0.18, uDeck);
    float c = smoothstep(th - 0.06, th + 0.1, n);
    float dark = smoothstep(th + 0.08, th + 0.3, n);
    vec3 cc = mix(uDeckLit, uDeckShade, dark);
    // lit rims toward the sun
    cc += uGlow * pow(max(sd, 0.0), 6.0) * (1.0 - dark) * 0.35 * uSunVis;
    c *= smoothstep(-0.02, 0.1, h) * min(1.0, uDeck * 1.6);
    col = mix(col, cc, c);
  }

  // rainbow on the antisolar ring (42°, with a faint secondary at 51°)
  if (uRainbow > 0.001 && h > -0.02) {
    float a = degrees(acos(clamp(dot(d, uAntiSun), -1.0, 1.0)));
    float p = (a - 39.6) / 3.4;
    float bow = smoothstep(0.0, 0.18, p) * smoothstep(1.0, 0.82, p);
    vec3 rc = hue(clamp(p, 0.0, 1.0) * 0.8) * bow;
    float p2 = (51.5 - a) / 3.4;
    float bow2 = smoothstep(0.0, 0.2, p2) * smoothstep(1.0, 0.8, p2);
    rc += hue(clamp(p2, 0.0, 1.0) * 0.8) * bow2 * 0.35;
    float inside = smoothstep(41.0, 30.0, a) * 0.08; // the brighter sky inside the bow
    col = col + (rc * 0.55 + inside * col) * uRainbow * smoothstep(-0.02, 0.1, h) * (1.0 - smoothstep(0.4, 0.9, h));
  }

  col += vec3(0.75, 0.8, 1.0) * uFlash * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Dome {
  mesh: THREE.Mesh;
  u: {
    uZenith: { value: THREE.Color }; uHorizon: { value: THREE.Color }; uGround: { value: THREE.Color }; uGlow: { value: THREE.Color };
    uSunColor: { value: THREE.Color }; uSunDir: { value: THREE.Vector3 }; uMoonDir: { value: THREE.Vector3 }; uAntiSun: { value: THREE.Vector3 };
    uSunVis: { value: number }; uMoonVis: { value: number }; uMoonPhase: { value: number }; uStars: { value: number }; uTime: { value: number };
    uStarAngle: { value: number }; uDeck: { value: number }; uDeckOffset: { value: THREE.Vector2 }; uDeckLit: { value: THREE.Color }; uDeckShade: { value: THREE.Color }; uRainbow: { value: number }; uOvercast: { value: number }; uFlash: { value: number };
  };
}

export function createDome(): Dome {
  const u: Dome['u'] = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uAntiSun: { value: new THREE.Vector3(0, -1, 0) }, uSunVis: { value: 1 }, uMoonVis: { value: 0 }, uMoonPhase: { value: 0.5 }, uStars: { value: 0 },
    uTime: { value: 0 }, uStarAngle: { value: 0 }, uDeck: { value: 0 }, uDeckOffset: { value: new THREE.Vector2() }, uDeckLit: { value: new THREE.Color() }, uDeckShade: { value: new THREE.Color() }, uRainbow: { value: 0 }, uOvercast: { value: 0 }, uFlash: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = true;
  return { mesh, u };
}
