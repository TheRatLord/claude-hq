/**
 * Glass (§5.6): one unsorted transparent layer; fresnel + a fake reflection gradient. `reflect:'exterior'` shows the
 * sky gradient, `'interior'` a warm ceiling→floor gradient plus one soft diagonal streak (≤ 0.9, never emissive).
 * Blends colour only; destination alpha is preserved so the character mask survives (§5.1).
 * Owner: RND.
 */
import * as THREE from 'three';
import { U, type UniformMap } from '../uniforms.ts';
import { MISC, ENV } from '../../../../shared/palette.ts';
import type { MaterialOpts } from './index.ts';

export function glassMaterial(color: THREE.Color, opts: MaterialOpts = {}): THREE.ShaderMaterial {
  const local: UniformMap = {
    uTint: { value: color.clone() },
    uTop: { value: new THREE.Color(opts.reflect === 'exterior' ? ENV.skyTop : MISC.glassCeiling) },
    uBottom: { value: new THREE.Color(opts.reflect === 'exterior' ? ENV.skyHorizon : MISC.glassFloor) },
    uStreak: { value: opts.reflect === 'exterior' ? 0 : 1 },
    uExterior: { value: opts.reflect === 'exterior' ? 1 : 0 },
    ...opts.uniforms,
  };
  const m = new THREE.ShaderMaterial({
    uniforms: { ...local, uTime: U.uTime, uNight: U.uNight, uGolden: U.uGolden },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform vec3 uTop; uniform vec3 uBottom; uniform float uStreak; uniform float uExterior; uniform float uNight; uniform float uGolden;
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 v = normalize(vW - cameraPosition);
        vec3 n = normalize(vN); if (dot(n, v) > 0.0) n = -n;
        float fr = pow(1.0 - abs(dot(n, v)), 3.0);
        vec3 r = reflect(v, n);
        vec3 refl = mix(uBottom, uTop, smoothstep(-0.4, 0.5, r.y));
        // after dark an exterior window is a dark mirror, not a daytime sky (the night sky shows through it)
        refl = mix(refl, vec3(0.025, 0.03, 0.06), uExterior * uNight * 0.9);
        // RND fix r3: the interior streak follows the exposure: full 0.35 by day, a quarter after dark (at 22 h a
        // constant white slash on the mezz rail / ENG / E-bay glazing read as an artifact), and it tints warm (the
        // lamp-lit room it reflects) instead of white
        float streak = uStreak * smoothstep(0.06, 0.0, abs(fract((vW.x + vW.z) * 0.35 + vW.y * 0.35) - 0.5)) * 0.35 * (1.0 - 0.75 * uNight);
        vec3 streakCol = streak * mix(vec3(1.0), vec3(1.0, 0.72, 0.45), uNight);
        // fix r1: the pale day tint (#DDEBF2) kept the skylight a flat white slab at 22 h. After dark exterior glass takes
        // a night-blue gradient instead: deep navy face-on (the starry sky reads through), a dusk-blue sheen toward
        // grazing angles, and less opacity, so the skylight dims with the clock
        vec3 nightTint = mix(vec3(0.012, 0.018, 0.05), vec3(0.06, 0.08, 0.2), fr);
        vec3 tint = mix(uTint, nightTint, uExterior * uNight);
        // m175 fix r2: at golden hour exterior glass (the atrium skylight, street windows) catches the low sun: a peach
        // tint + warm reflection, so the skylight reads as dusk from the Pit instead of a white day slab
        tint = mix(tint, vec3(1.0, 0.62, 0.42), uExterior * uGolden * 0.85);
        refl = mix(refl, vec3(1.0, 0.7, 0.48), uExterior * uGolden * 0.6);
        vec3 col = min(mix(tint, refl, 0.55) + streakCol, vec3(0.9));
        float a = clamp(0.12 + fr * 0.55 + streak, 0.0, 0.8) * mix(1.0, 0.7, uExterior * uNight);
        // m175 fix r2: a roof light (horizontal exterior glass) is frosted: seen from below it is a soft mid-value panel,
        // not a clear window onto a near-white sky. The clear skylight was the brightest thing in every atrium frame and
        // its edge against the dark beams out-ranked the Clawds in greyCheck (mezzToPit, spawn: top-10 blobs on the
        // skylight rim). Day: pale blue-grey; golden: peach; night: the dark-glass branch above
        float hqRoof = uExterior * smoothstep(0.7, 0.9, abs(n.y));
        vec3 frost = mix(vec3(0.46, 0.52, 0.58), vec3(0.55, 0.36, 0.27), uGolden);
        // m2 fix r1: from *above* (plan / overhead poses) the roof light is clear glass seen from outside: a thin
        // sky-tinted sheen with a soft diagonal glint, mostly see-through, so the Pit reads through it instead of a
        // pale frosted slab over the atrium
        float hqAbove = hqRoof * step(0.0, -v.y);
        hqRoof -= hqAbove;
        col = mix(col, mix(frost, col, uNight), hqRoof);
        a = mix(a, mix(0.62, a, uNight), hqRoof);
        float glint = smoothstep(0.08, 0.0, abs(fract((vW.x - vW.z) * 0.12) - 0.5)) * (1.0 - uNight * 0.7);
        vec3 roofSky = mix(mix(vec3(0.34, 0.47, 0.6), vec3(0.62, 0.45, 0.4), uGolden), vec3(0.03, 0.04, 0.09), uNight);
        col = mix(col, min(roofSky + glint * 0.35, vec3(0.85)), hqAbove);
        a = mix(a, 0.22 + fr * 0.4 + glint * 0.25, hqAbove);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  m.userData.uniforms = local;
  return m;
}
