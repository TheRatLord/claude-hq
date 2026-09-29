/**
 * Unlit screen / dot-matrix material (§5.0 emissive policy). Output = colour × map × intensity × uEmissiveGain.
 * Body ≤ 0.95 (never blooms); accents (status strip, cursor) are drawn by `uStrip` at 1.2–1.6 and stay ≤ 12% of
 * the area. With `uCode > 0` and no map it draws the desk-monitor states (render/deskScreens.ts): scrolling code while
 * working, a dim saver when idle/done, a red "!" when blocked, a prompt for idle shells, dark when unowned. Instance
 * colour carries the status strip colour + the mode (r = strip.r + 2·mode), so one InstancedMesh covers every monitor.
 * Owner: RND.
 */
import * as THREE from 'three';
import { U, type UniformMap } from '../uniforms.ts';
import { STATUS } from '../../../../shared/palette.ts';
import type { MaterialOpts } from './index.ts';

/** 1×1 white map: every screen/overlay material always has a map, so text canvases never add a program variant. */
export const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;
/**
 * The live desk-monitor atlas (M3.5, monitorAtlas.ts sets `.value`): one shared sampler for every screen program, read
 * only by desk monitors in mode 6 (instanceColor g = strip.g + 2·tile, 4 × 4 tiles, canvas row order: flipY false).
 */
export const U_ATLAS: { value: THREE.Texture } = { value: WHITE };

export function screenMaterial(color: THREE.Color, opts: MaterialOpts = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, map: WHITE });
  const intensity = typeof opts.emissive === 'number' ? opts.emissive : 0.9;
  const local: UniformMap = {
    uIntensity: { value: intensity },
    uCode: { value: opts.code ?? 0 },
    uStrip: { value: new THREE.Color(opts.strip ?? STATUS.working) },
    uStripOn: { value: opts.strip === null ? 0 : opts.code ? 1 : 0 },
    ...opts.uniforms,
  };
  m.userData.uniforms = local;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uEmissiveGain: U.uEmissiveGain, uAccentGain: U.uAccentGain, uTime: U.uTime, uNight: U.uNight, uScreenMask: U.uScreenMask, uAtlas: U_ATLAS, ...local });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHqUv;\nvarying float vHqSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vHqUv = uv; vHqSeed = 0.0;
  #ifdef USE_INSTANCING
    vHqSeed = instanceMatrix[3].x * 3.7 + instanceMatrix[3].z * 1.3;
  #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uIntensity; uniform float uEmissiveGain; uniform float uAccentGain; uniform float uTime; uniform float uNight; uniform float uScreenMask;
uniform float uCode; uniform vec3 uStrip; uniform float uStripOn; uniform sampler2D uAtlas;
varying vec2 vHqUv; varying float vHqSeed;
float hqH1(float n) { return fract(sin(n) * 43758.5453); }
float hqSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }`)
      .replace('#include <opaque_fragment>', `
  vec3 hqCol = outgoingLight * uIntensity;
  vec3 strip = uStrip;
  float mode = 0.0;   // desk monitors (render/deskScreens.ts): instanceColor.r = strip.r + 2·mode
  float tile = 0.0;   // live monitors (mode 6): instanceColor.g = strip.g + 2·tile
  #ifdef USE_COLOR   // (USE_INSTANCING_COLOR is a vertex-only define; three sets USE_COLOR in both stages)
    mode = floor( vColor.r * 0.5 );
    tile = floor( vColor.g * 0.5 );
    strip = vec3( vColor.r - 2.0 * mode, vColor.g - 2.0 * tile, vColor.b );
  #endif
  if ( uCode > 1.5 ) {
    // tally LED on a monitor's back (deskScreens.ts, M3.5): mode = 0 off, 1 working (blue pulse), 2 blocked (red blink),
    // 3 done (green). Accent gain ≤ 1.5 (§5.0 accents), lit side of the bead a little brighter
    float lit = 0.8 + 0.2 * vHqUv.y;
    float k = mode < 0.5 ? 0.0 : mode < 1.5 ? 0.55 + 0.75 * ( 0.5 + 0.5 * sin( uTime * 3.4 + vHqSeed ) ) : mode < 2.5 ? 0.12 + 1.38 * step( 0.45, fract( uTime * 2.2 + vHqSeed * 0.1 ) ) : 1.2;
    hqCol = mode < 0.5 ? vec3( 0.018, 0.02, 0.024 ) : strip * k * lit;
  } else if ( uCode > 0.0 && mode > 5.5 ) {
    // 6 live: this desk's tile of the monitor atlas (the owner's real screen / blocked question, monitorAtlas.ts)
    vec2 tuv = vec2( mod( tile, 4.0 ) + clamp( vHqUv.x, 0.002, 0.998 ), floor( tile * 0.25 ) + clamp( 1.0 - vHqUv.y, 0.002, 0.998 ) ) * 0.25;
    hqCol = texture2D( uAtlas, tuv ).rgb * 0.95;
  } else if ( uCode > 0.0 && mode < 0.5 ) {
    // 0 code: working, procedural scrolling code
    vec2 uv = vHqUv;
    float rows = 11.0;
    float scroll = floor( uTime * 1.5 + vHqSeed * 5.0 );
    float r = floor( ( 1.0 - uv.y ) * rows );
    float line = r + scroll;
    float indent = floor( hqH1( line * 1.7 + vHqSeed ) * 3.0 ) * 0.07;
    float len = 0.25 + hqH1( line * 3.1 + vHqSeed ) * 0.55;
    float fy = fract( ( 1.0 - uv.y ) * rows );
    float inRow = step( 0.3, fy ) * step( fy, 0.7 );
    float x = uv.x - 0.08 - indent;
    float inLen = step( 0.0, x ) * step( x, len );
    float word = step( 0.18, fract( x * 9.0 + hqH1( line ) ) );
    float tok = hqH1( line * 7.3 + floor( x * 9.0 + hqH1( line ) ) );
    vec3 ink = tok > 0.8 ? vec3( 0.95, 0.62, 0.45 ) : tok > 0.6 ? vec3( 0.55, 0.78, 0.62 ) : vec3( 0.78, 0.78, 0.74 );
    float on = inRow * inLen * word * step( 1.0, r ) * step( r, rows - 2.0 );
    hqCol = mix( hqCol, ink * 0.9, on * uCode );
    // cursor blink at the end of the last row
    float cur = step( rows - 2.0, r ) * step( r, rows - 2.0 ) * step( 0.08, uv.x ) * step( uv.x, 0.12 ) * inRow * step( 0.5, fract( uTime * 1.2 ) );
    hqCol = mix( hqCol, vec3( 0.95 ) * uAccentGain, cur * uCode );
  } else if ( uCode > 0.0 ) {
    vec2 uv = vHqUv;
    vec2 asp = vec2( 1.7, 1.0 );   // screen aspect (0.44 × 0.26)
    if ( mode < 2.5 ) {
      // 1 saver (idle) / 2 done: dim screen, a small clay blob drifting DVD-style; done adds a green check
      hqCol *= 0.45;
      float t = uTime * 0.11 + vHqSeed;
      vec2 c = vec2( abs( fract( t * 0.83 ) * 2.0 - 1.0 ) * 0.7 + 0.15, abs( fract( t * 0.61 + 0.3 ) * 2.0 - 1.0 ) * 0.5 + 0.2 );
      vec2 d = ( uv - c ) * asp;
      vec2 q = abs( d ) - vec2( 0.09, 0.065 );
      float blob = 1.0 - smoothstep( 0.0, 0.02, length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - 0.03 );
      hqCol = mix( hqCol, vec3( 0.52, 0.2, 0.11 ), blob );   // clay, dim (≤ 0.55): a sleeping screen, never a light
      float eyes = step( length( ( d - vec2( -0.045, 0.012 ) ) * vec2( 1.0, 0.6 ) ), 0.014 ) + step( length( ( d - vec2( 0.045, 0.012 ) ) * vec2( 1.0, 0.6 ) ), 0.014 );
      hqCol = mix( hqCol, vec3( 0.03 ), eyes * blob );
      if ( mode > 1.5 ) {
        // check mark (two capsules) in the top-left corner
        vec2 p = ( uv - vec2( 0.14, 0.62 ) ) * asp;
        float dk = min( hqSeg( p, vec2( -0.06, 0.0 ), vec2( -0.015, -0.05 ) ), hqSeg( p, vec2( -0.015, -0.05 ), vec2( 0.08, 0.07 ) ) );
        hqCol = mix( hqCol, strip * 0.85, 1.0 - smoothstep( 0.012, 0.022, dk ) );
      }
    } else if ( mode < 3.5 ) {
      // 3 blocked: deep red body (≤ 0.95), a pulsing "!" accent
      float pulse = 0.5 + 0.5 * sin( uTime * 6.0 );
      hqCol = mix( vec3( 0.32, 0.035, 0.03 ), vec3( 0.5, 0.06, 0.05 ), pulse * ( 1.0 - length( ( uv - 0.5 ) * asp ) ) );
      vec2 p = ( uv - vec2( 0.5, 0.5 ) ) * asp;
      float bar = step( abs( p.x ), 0.028 ) * step( -0.03, p.y ) * step( p.y, 0.2 );
      float dot0 = step( length( p - vec2( 0.0, -0.12 ) ), 0.034 );
      hqCol = mix( hqCol, strip * mix( 0.9, uAccentGain, pulse ), max( bar, dot0 ) );
    } else if ( mode < 4.5 ) {
      // 4 prompt (shell idle at its prompt): dark screen, ">_" and a blinking cursor on the first row
      hqCol *= 0.55;
      vec2 p = ( uv - vec2( 0.12, 0.8 ) ) * asp;
      float chev = 1.0 - smoothstep( 0.008, 0.016, min( hqSeg( p, vec2( -0.04, 0.04 ), vec2( 0.01, 0.0 ) ), hqSeg( p, vec2( 0.01, 0.0 ), vec2( -0.04, -0.04 ) ) ) );
      float cur = step( 0.04, p.x ) * step( p.x, 0.1 ) * step( abs( p.y + 0.035 ), 0.01 ) * step( 0.5, fract( uTime * 1.1 + vHqSeed ) );
      hqCol = mix( hqCol, strip * 0.85, max( chev, cur ) );
    } else {
      // 5 off: nobody's desk, dark glass
      hqCol *= 0.18;
    }
  }
  if ( uStripOn > 0.0 && mode < 4.5 && uCode < 1.5 ) {
    hqCol = mix( hqCol, strip * ( mode > 0.5 && mode < 2.5 ? 0.55 : uAccentGain ), step( 0.9, vHqUv.y ) * uStripOn );
  }
  // after dark desk monitors are the room's light sources (§5.0 night bloom budget "bulbs 1.8 + screens"): body text
  // 0.9 → 1.4, so code, prompts and the blocked "!" bloom softly; lamps.ts adds their light pools
  if ( uCode > 0.0 && uCode < 1.5 ) {
    // a lit panel's backlight: dark code/prompt backgrounds lift to a deep blue glow (≤ 0.2, never blooms)
    if ( mode < 0.5 || ( mode > 3.5 && mode < 4.5 ) ) hqCol = max( hqCol, vec3( 0.05, 0.085, 0.16 ) * uNight );
    hqCol *= 1.0 + 0.55 * uNight;
  }
  // lumaStats({emissive:false}) (uEmissiveGain 0): desk monitors (uCode) are light sources and go dark; signage,
  // placards and stat panels are self-lit paper (body ≤ 0.95, never blooms) and keep their body, capped at 0.8, so
  // the emissive-off frame measures the scene's surfaces instead of painting every sign black
  gl_FragColor = vec4( uCode > 0.0 ? hqCol * uEmissiveGain : mix( min( hqCol, vec3( 0.8 ) ), hqCol, uEmissiveGain ), 1.0 );
  gl_FragColor.rgb *= 1.0 - uScreenMask;   // probe.ts greyCheck: readout pixels go black for one frame`)
      .replace('#include <color_fragment>', '');
  };
  return m;
}
