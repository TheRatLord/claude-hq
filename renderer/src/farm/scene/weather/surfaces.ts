/**
 * The world's weather surfaces, shader side: wet sheen, puddles, lying snow and frost sparkle on every toon material,
 * with no per-material hook (like scene/lights/shader.ts: three's shader chunks are patched once at import).
 *
 *   wet     every toon surface darkens a little and picks up a soft sky sheen (fresnel) and a banded sun glint; wet
 *           lamp pools shine a little brighter at night. Upward faces soak most, walls a little.
 *   puddles on the surface-library world only (`VW_SURF`, set by `withSurfaces`), on flat ground within ~0.4 m of the
 *           valley floor (`vwGround`, a coarse heightmap of `heightAt`), on ground surfaces (soil, dirt, cobble,
 *           sand, pebbles, rock, fieldstone, untagged terrain). A world-space noise mask grows the puddles as the
 *           ground soaks and shrinks them as it dries; inside: dark water reflecting the sky gradient, a sun glint, lamp
 *           light, and rain-drop rings while it rains. The terrain tells the patch where its dirt tracks are
 *           (`vwPathK`) and where tall grass stands (`vwTallK`): on grass, puddles are rare, small, muddy (darker,
 *           less sky) with a wider wet rim, and only in hollows of the heightmap; none under tall grass.
 *   snow    lying snow covers up-facing surface-library faces (ground, roofs, fences, crops) in noisy drifts as it
 *           builds (`trace.snow`), with blue-white sparkles in sun / lamp light.
 *   frost   on cold clear mornings the ground goes pale and twinkles; the twinkle depends on the view direction so it
 *           shimmers as you walk.
 *
 * All per-frame values live in one shared Float32Array (`VW`, written by the weather system), passed by reference
 * through three's uniform cloning, so writing it once a frame reaches every program. Everything is skipped with one
 * uniform branch when the world is dry.
 *
 * Quality 'low' compiles all of it out (`setWeatherSurfaceQuality`, called by the weather system before the first
 * frame): even untaken, the branch roughly adds a third to the frame on software / weak GPUs (SwiftShader A/B).
 */
import * as THREE from 'three';
import { WORLD, heightAt } from '../../world/map.ts';
import type { Quality } from '../context.ts';

/**
 * Shared uniform block (vec4 × 6):
 *  0 wet, snow, rain falling now, time
 *  1 sky reflection (zenith) rgb, frost
 *  2 sky reflection (horizon) rgb, puddle amount
 *  3 sun dir (world), ground heightmap half extent
 *  4 sun glint colour rgb (× visibility), night
 *  5 snow colour rgb, sparkle
 */
export const VW = new Float32Array(6 * 4);

const GROUND_N = 128;
/** half extent (m) of the ground heightmap */
export const GROUND_HALF = WORLD.half;

/** The valley floor as a small half-float texture (bilinear), for puddle placement and the post mist. Built once. */
function buildGround(): THREE.DataTexture {
  const data = new Uint16Array(GROUND_N * GROUND_N);
  const step = (GROUND_HALF * 2) / GROUND_N;
  for (let j = 0; j < GROUND_N; j++) {
    for (let i = 0; i < GROUND_N; i++) {
      const x = -GROUND_HALF + (i + 0.5) * step, z = -GROUND_HALF + (j + 0.5) * step;
      data[j * GROUND_N + i] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
    }
  }
  const t = new THREE.DataTexture(data, GROUND_N, GROUND_N, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  t.name = 'valley-ground';
  return t;
}

let ground: THREE.DataTexture | null = null;
export function groundTexture(): THREE.DataTexture {
  if (!ground) ground = buildGround();
  return ground;
}

/** helpers + the shared uniforms (appended to the toon light pars, so only toon programs get them) */
const VW_ON = '#define VW_TOON';
const VW_PARS = /* glsl */`
${VW_ON}
uniform vec4 vwP[ 6 ];
uniform sampler2D vwGround;
vec3 vwSheen = vec3( 0.0 );
float vwPuddle = 0.0;
float vwSnowK = 0.0;
// set by a material's own fragment (the terrain): how path-like (dirt / sand) the pixel is (-1 = unknown), and how
// much tall rough grass stands there (no puddles under tall grass)
float vwPathK = -1.0;
float vwTallK = 0.0;
float vwH( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vwN( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( vwH( i ), vwH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( vwH( i + vec2( 0.0, 1.0 ) ), vwH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// rain-drop rings on a puddle: one drop per 0.45 m cell, a ring expanding over its lifetime; returns a normal tilt
vec2 vwDrops( vec2 p, float t ) {
  vec2 acc = vec2( 0.0 );
  vec2 c = floor( p / 0.45 - 0.5 );
  for ( int j = 0; j <= 1; j ++ ) for ( int i = 0; i <= 1; i ++ ) {
    vec2 cell = c + vec2( float( i ), float( j ) );
    float h = vwH( cell * 1.37 + 3.1 );
    float life = fract( t * ( 0.9 + 0.5 * h ) + h * 7.0 );
    vec2 ctr = ( cell + 0.2 + 0.6 * vec2( h, vwH( cell + 9.7 ) ) ) * 0.45;
    vec2 d = p - ctr;
    float r = length( d );
    float rr = life * 0.32;
    float ring = ( 1.0 - smoothstep( 0.0, 0.035, abs( r - rr ) ) ) * ( 1.0 - life );
    acc += d / max( r, 1e-3 ) * ring;
  }
  return acc;
}
`;

/**
 * Before the toon lights (`lights_toon_fragment`): change the albedo (wet darkening, puddle water, snow, frost) and
 * work out the sheen to add after lighting. `normal` is view space here; work in world space.
 */
const VW_ALBEDO = /* glsl */`
#ifdef VW_TOON
if ( vwP[ 0 ].x + vwP[ 0 ].y + vwP[ 1 ].w > 0.002 ) {
  mat3 vwR = transpose( mat3( viewMatrix ) );
  vec3 vwW = vwR * ( -vViewPosition - viewMatrix[ 3 ].xyz );
  vec3 vwNw = normalize( vwR * normal );
  vec3 vwV = normalize( cameraPosition - vwW );
  float vwDist = length( vViewPosition );
  float vwUp = vwNw.y;
  float vwWet = vwP[ 0 ].x;
  float vwSnow = vwP[ 0 ].y;
  float vwFrost = vwP[ 1 ].w;
  float vwT = vwP[ 0 ].w;
  float vwNear = 1.0 - smoothstep( 25.0, 70.0, vwDist );
  bool vwWorld = false;
  float vwGroundK = 0.0;
  float vwPudK = 0.55;
  #ifdef VW_SURF
  vwWorld = true;
  {
    float gy = texture2D( vwGround, vwW.xz / ( 2.0 * vwP[ 3 ].w ) + 0.5 ).r;
    vwGroundK = 1.0 - smoothstep( 0.3, 0.6, abs( vwW.y - gy ) );
    if ( gy < ${(WORLD.water + 0.05).toFixed(2)} ) vwGroundK = 0.0;
    #ifdef VW_SURF_ID
    float vwCode = vSurf.x < 0.5 ? uSurfDef.x : vSurf.x;
    int vwId = int( mod( floor( vwCode + 0.5 ), 32.0 ) );
    // ground surfaces: plain (terrain), soil, dirt, cobble, sand, pebbles, rock, fieldstone, grass, meadow
    if ( !( vwId <= 9 || vwId == 19 ) ) vwGroundK = 0.0;
    // paths (rock decals), the square, soil: puddle freely; terrain, grass, sand: only now and then
    vwPudK = ( vwId >= 4 && vwId <= 6 ) || vwId == 9 || vwId == 19 ? 1.0 : 0.55;
    #endif
  }
  #endif
  // the terrain knows its own paths: puddle freely on the dirt tracks, rarely on the grass. It is the ground by
  // definition: skip the coarse heightmap test (bilinear between 2.3 m samples, it strays > 0.3 m on hills and cut
  // the wet soak into dark triangles there), keep only the water level
  if ( vwPathK >= 0.0 ) {
    vwPudK = mix( 0.36, 1.0, vwPathK );
    vwGroundK = vwW.y < ${(WORLD.water + 0.05).toFixed(2)} ? 0.0 : 1.0;
  }
  // grass puddles are muddy: smaller, darker, in hollows, with a soft wet rim
  float vwMud = clamp( ( 1.0 - vwPudK ) / 0.45, 0.0, 1.0 ) * ( 1.0 - vwTallK );
  float vwLarge = vwN( vwW.xz * 0.21 + 4.0 ) * 0.65 + vwN( vwW.xz * 0.9 - 2.0 ) * 0.35;

  // --- lying snow (world only): up-facing faces, drifting coverage with the amount
  if ( vwWorld && vwSnow > 0.001 ) {
    float k = vwUp * 0.72 + vwLarge * 0.28;
    float th = 1.0 - vwSnow * 0.92;
    vwSnowK = smoothstep( th, th + 0.07, k ) * smoothstep( 0.05, 0.25, vwUp );
    vec3 sc = vwP[ 5 ].rgb * ( 0.93 + 0.07 * vwN( vwW.xz * 3.1 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, sc, vwSnowK );
  }

  // --- frost: pale, crystalline ground on cold clear mornings
  if ( vwFrost > 0.001 ) {
    float fk = vwFrost * smoothstep( 0.35, 0.8, vwUp ) * ( 0.55 + 0.45 * vwN( vwW.xz * 1.7 ) ) * ( 1.0 - vwSnowK );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.7, 0.8, 0.92 ) * ( 0.55 + 0.6 * dot( diffuseColor.rgb, vec3( 0.33 ) ) ), fk * 0.38 );
  }

  // --- glitter: frost crystals and sunny snow twinkle as the view moves (HDR, so it blooms)
  float vwSpark = max( vwFrost, vwSnowK * vwP[ 5 ].w );
  if ( vwSpark > 0.001 && vwDist < 24.0 && vwUp > 0.5 ) {
    const float CELL = 0.07;
    vec2 cell = floor( vwW.xz / CELL );
    float h = vwH( cell );
    float face = vwH( cell + floor( vwV.xz * 11.0 + vwV.y * 6.0 ) * 1.7 );
    float g = step( 0.975, face ) * step( 0.3, h );
    vec2 f = fract( vwW.xz / CELL ) - 0.5;
    // a pin-point: shrinks to a sub-pixel speck with distance rather than a blob
    g *= smoothstep( 0.18 + vwDist * 0.004, 0.0, length( f ) );
    vwSheen += ( vwP[ 4 ].rgb * 1.1 + vec3( 0.35, 0.45, 0.6 ) * vwP[ 4 ].w ) * g * vwSpark * ( 1.0 - smoothstep( 8.0, 24.0, vwDist ) );
  }

  // --- wet: darker, with a sky sheen and a banded sun glint; puddles on flat ground
  if ( vwWet > 0.001 ) {
    float soak = vwWet * ( 0.4 + 0.6 * smoothstep( -0.2, 0.7, vwUp ) ) * ( 1.0 - vwSnowK );
    vec3 Nr = vwNw;
    // puddles: the mask grows with the amount; dark water reflecting the sky
    float pud = 0.0;
    if ( vwGroundK > 0.0 && vwUp > 0.93 ) {
      float amt = vwP[ 2 ].w * vwPudK * ( 1.0 - vwTallK );
      float th = 1.0 - amt * 0.38;
      float m = vwLarge + ( vwN( vwW.xz * 3.7 ) - 0.5 ) * 0.08;
      if ( vwMud > 0.0 ) {
        // on grass water only gathers in hollows of the valley floor (heightmap: lower than its surroundings)
        vec2 gu = vwW.xz / ( 2.0 * vwP[ 3 ].w ) + 0.5, go = vec2( 3.5 / ( 2.0 * vwP[ 3 ].w ), 0.0 );
        float g0 = texture2D( vwGround, gu ).r;
        float hollow = 0.25 * ( texture2D( vwGround, gu + go ).r + texture2D( vwGround, gu - go ).r
          + texture2D( vwGround, gu + go.yx ).r + texture2D( vwGround, gu - go.yx ).r ) - g0;
        m += ( smoothstep( -0.04, 0.12, hollow ) - 0.75 ) * 0.14 * vwMud;
      }
      pud = smoothstep( th, th + 0.025, m ) * vwGroundK * smoothstep( 0.93, 0.98, vwUp ) * ( 1.0 - vwSnowK );
      if ( pud > 0.0 && vwP[ 0 ].z > 0.01 ) {
        vec2 tilt = vwDrops( vwW.xz, vwT ) * vwP[ 0 ].z * vwNear;
        Nr = normalize( vec3( tilt.x * 0.35, 1.0, tilt.y * 0.35 ) );
      } else if ( pud > 0.0 ) Nr = vec3( 0.0, 1.0, 0.0 );
      // a darker, wetter rim around each puddle
      float rim = smoothstep( th - 0.07 - 0.06 * vwMud, th, m ) * ( 1.0 - pud ) * vwGroundK;
      soak = max( soak, vwWet * ( 0.6 + 0.4 * rim ) * vwGroundK * smoothstep( 0.9, 0.98, vwUp ) * ( 1.0 - vwSnowK ) );
    }
    vwPuddle = pud;
    // wet stone / soil / wood: darker and a touch richer (squaring in linear deepens the colour)
    float dk = soak * ( 0.75 + 0.25 * vwGroundK );
    // (only a touch richer: squaring saturates warm dirt into orange paint between the puddles)
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * diffuseColor.rgb * 1.7, 0.18 * dk ) * ( 1.0 - 0.36 * dk );
    // puddle water: near black, mirroring the sky; on grass a peaty brown-olive that keeps less of the sky
    vec3 vwWater = mix( vec3( 0.008, 0.011, 0.016 ), vec3( 0.022, 0.02, 0.008 ), vwMud );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.06 ) ) ) + vwWater, pud );
    float ndv = clamp( dot( Nr, vwV ), 0.0, 1.0 );
    float fres = pow( 1.0 - ndv, 4.0 );
    vec3 rd = reflect( -vwV, Nr );
    vec3 sky = mix( vwP[ 2 ].rgb, vwP[ 1 ].rgb, smoothstep( 0.0, 0.5, rd.y ) ) * vec3( 0.8, 0.88, 1.0 );
    float far = 1.0 - smoothstep( 30.0, 90.0, vwDist ) * 0.6;
    vwSheen += sky * ( fres * 0.16 * soak * far + pud * ( 0.3 + 0.4 * fres ) * ( 1.0 - 0.6 * vwMud ) );
    float sp = max( dot( rd, vwP[ 3 ].xyz ), 0.0 );
    // (merely damp ground does not mirror the sun: the soak glint needs a real wetting, else a pale disc follows the
    // sun across every dry-ish path for hours after rain)
    float glint = smoothstep( 0.86, 0.9, pow( sp, 18.0 ) ) * ( soak * 0.35 * smoothstep( 0.3, 0.7, vwWet ) + pud * 1.2 ) + smoothstep( 0.97, 0.985, sp ) * pud * 2.5;
    vwSheen += vwP[ 4 ].rgb * glint * vwNear;
  }
}
#endif
`;

/** After lighting (`aomap_fragment` is included right after the light loops in the toon shader): add the sheen. */
const VW_LIT = /* glsl */`
#ifdef VW_TOON
  #ifdef VL_TOON
  // wet ground shines under the lamps; puddles mirror the lamp light
  vwSheen += vlLocal * ( vwP[ 0 ].x * 0.25 + vwPuddle * 0.9 );
  #endif
  // lying snow in shade is lit by the sky: a cooler, slightly deeper blue (the sunlit side stays white), so snowy
  // shapes keep their form under an overcast sky and from the overview
  reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), vec3( 0.8, 0.88, 1.02 ), vwSnowK );
  reflectedLight.indirectDiffuse += vwSheen;
#endif
`;

const MARK = '// valley-weather-surfaces';

/** Patch three's shader chunks (idempotent). Must run before the first toon program compiles. */
export function installWeatherSurfaces(): void {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.lights_toon_pars_fragment.includes(MARK)) return;
  C.lights_toon_pars_fragment = `${C.lights_toon_pars_fragment}\n${MARK}\n${VW_PARS}`;
  C.lights_toon_fragment = `${VW_ALBEDO}\n${C.lights_toon_fragment}`;
  C.aomap_fragment = `${C.aomap_fragment}\n${VW_LIT}`;
  VW[3 * 4 + 3] = GROUND_HALF;
  const U = THREE.ShaderLib.toon.uniforms as Record<string, THREE.IUniform>;
  U.vwP = { value: VW };
  U.vwGround = { value: groundTexture() };
}

/**
 * 'low' compiles the weather surfaces out of every toon program (no wet / puddles / snow / frost on the world); others
 * compile them in. Takes effect for programs compiled afterwards, so call it before the first frame (quality is fixed
 * per session).
 */
export function setWeatherSurfaceQuality(q: Quality): void {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  const off = `// ${VW_ON.slice(1)} (quality low)`;
  C.lights_toon_pars_fragment = q === 'low' ? C.lights_toon_pars_fragment.replace(VW_ON, off) : C.lights_toon_pars_fragment.replace(off, VW_ON);
}

installWeatherSurfaces();
