/**
 * Valley lights, shader side. Lamps, lanterns, windows and fires reach every toon material through three's own light
 * uniforms (a fixed pool of PointLights / SpotLights owned by `lights.ts`, so the light count never changes and nothing
 * recompiles), but the toon shader evaluates them its own way: a stylised, painted falloff instead of inverse-square.
 *
 *   e    = (1 - d / radius)^2 * facing(N·L) * spill        (spill: the window cone, soft)
 *   pool = three soft-edged bands of e (outer wash, mid pool, hot core)  →  += lightColour * pool * albedo
 *
 * Facing is a soft terminator, so walls, benches, farmers and tree trunks catch warm light on the sides turned toward
 * the lamp and stay moonlit on the far side. The loops are dynamic and stop at the first unused slot (the pool is
 * packed nearest-first; an unused slot has distance 0), so by day the cost is one uniform compare per pool.
 *
 * Occlusion: spots (windows, wall lanterns) only reach the half-space in front of their wall (cone apex just behind the
 * wall face); point lights test up to two building boxes each (`vlOcc`, a shared typed-array uniform written by
 * lights.ts) with a soft ray-vs-box overlap, so a lamp behind the farmhouse does not light the plaza through it.
 *
 * Installed by patching `THREE.ShaderChunk` once at import (toon.ts imports this module): every MeshToonMaterial,
 * including ones built outside `toon()` with their own `onBeforeCompile`, gets it with no per-material hook.
 */
import * as THREE from 'three';
// wet sheen, puddles, lying snow and frost ride on the same toon programs (atmosphere package)
import '../weather/surfaces.ts';

/** point-light pool slots that can carry building occluders (lights.ts never pools more points than this) */
export const VL_OCC_SLOTS = 12;
/**
 * Shared occluder data for every toon program: a typed array is passed by reference through three's uniform cloning,
 * so writing it once a frame (lights.ts) updates every material. Layout per point slot: see `vlOcc` below.
 */
export const VL_OCC = new Float32Array(VL_OCC_SLOTS * 4 * 4);

/** functions appended to the toon light pars (after `lights_pars_begin` declared the light uniforms) */
export const VL_PARS = /* glsl */`
#define VL_TOON
// painted bands: an outer wash, the pool, a hot core; soft edges so the rings read hand-painted, not posterised
float vlRamp( const in float e ) {
  return 0.2 * smoothstep( 0.0, 0.12, e ) + 0.45 * smoothstep( 0.13, 0.22, e ) + 0.35 * smoothstep( 0.34, 0.48, e );
}
// energy proxy before banding: distance shape × soft facing terminator
float vlShade( const in vec3 lv, const in float r, const in vec3 n ) {
  float d2 = dot( lv, lv );
  if ( d2 >= r * r ) return 0.0;
  float d = sqrt( d2 );
  float x = 1.0 - d / r;
  float ndl = dot( n, lv ) / max( d, 1e-3 );
  return x * x * smoothstep( -0.2, 0.55, ndl );
}
#if NUM_POINT_LIGHTS > 0
// building occluders per point slot: 2 boxes × [ (centre xyz, cos yaw), (half extents xyz, sin yaw) ], world space
uniform vec4 vlOcc[ ${VL_OCC_SLOTS * 4} ];
// soft ray-vs-box: how much of the segment a→b runs through the box (0 = clear, 1 = solidly blocked)
float vlBox( const in vec3 a, const in vec3 b, const in vec4 c0, const in vec4 c1 ) {
  if ( c1.x <= 0.0 ) return 0.0;
  vec3 o = a - c0.xyz, d = b - a;
  float cs = c0.w, sn = c1.w;
  vec3 lo = vec3( o.x * cs - o.z * sn, o.y, o.x * sn + o.z * cs );
  vec3 ld = vec3( d.x * cs - d.z * sn, d.y, d.x * sn + d.z * cs );
  vec3 inv = 1.0 / ( ld + vec3( 1e-5 ) );
  vec3 t0 = ( -c1.xyz - lo ) * inv, t1 = ( c1.xyz - lo ) * inv;
  vec3 tn3 = min( t0, t1 ), tf3 = max( t0, t1 );
  float tn = max( max( tn3.x, tn3.y ), max( tn3.z, 0.0 ) );
  float tf = min( min( tf3.x, tf3.y ), min( tf3.z, 1.0 ) );
  return smoothstep( 0.08, 0.7, ( tf - tn ) * length( d ) );
}
void vlPoints( const in vec3 P, const in vec3 N, const in vec3 albedo, inout ReflectedLight rl ) {
  mat3 vlR = transpose( mat3( viewMatrix ) );
  for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
    if ( pointLights[ i ].distance <= 0.0 ) break;
    float e = vlShade( pointLights[ i ].position - P, pointLights[ i ].distance, N );
    if ( e <= 0.0 ) continue;
    #if NUM_POINT_LIGHTS <= ${VL_OCC_SLOTS}
    if ( vlOcc[ i * 4 + 1 ].x > 0.0 ) {
      vec3 Pw = vlR * ( P - viewMatrix[ 3 ].xyz ), Lw = vlR * ( pointLights[ i ].position - viewMatrix[ 3 ].xyz );
      float vis = ( 1.0 - vlBox( Pw, Lw, vlOcc[ i * 4 ], vlOcc[ i * 4 + 1 ] ) ) * ( 1.0 - vlBox( Pw, Lw, vlOcc[ i * 4 + 2 ], vlOcc[ i * 4 + 3 ] ) );
      e *= vis;
      if ( e <= 0.0 ) continue;
    }
    #endif
    rl.directDiffuse += pointLights[ i ].color * ( vlRamp( e ) * ( 0.85 + 0.3 * e ) ) * albedo;
  }
}
#endif
#if NUM_SPOT_LIGHTS > 0
void vlSpots( const in vec3 P, const in vec3 N, const in vec3 albedo, inout ReflectedLight rl ) {
  for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
    float r = spotLights[ i ].distance;
    if ( r <= 0.0 ) break;
    vec3 lv = spotLights[ i ].position - P;
    float d2 = dot( lv, lv );
    if ( d2 >= r * r ) continue;
    // wall-mounted: the cone's apex sits 0.45 m back from the light (just behind the wall surface the light hangs in
    // front of), so the wall face itself catches a soft glow but nothing behind the wall plane is ever lit
    vec3 av = lv + spotLights[ i ].direction * 0.45;
    float k = smoothstep( spotLights[ i ].coneCos, spotLights[ i ].penumbraCos, dot( normalize( av ), spotLights[ i ].direction ) );
    if ( k <= 0.0 ) continue;
    float e = vlShade( lv, r, N ) * k;
    if ( e > 0.0 ) rl.directDiffuse += spotLights[ i ].color * ( vlRamp( e ) * ( 0.85 + 0.3 * e ) ) * albedo;
  }
}
#endif
`;

/**
 * Evaluated right after `lights_fragment_begin` set up the geometry; three's own point/spot loops are skipped. Slot 0's
 * `decay` (unused by the falloff) carries the pool's reach from the camera (max distance + radius of its active
 * lights), so distant land, mountains and the backdrop skip the loops entirely.
 */
export const VL_APPLY = /* glsl */`
#ifdef VL_TOON
  vec3 vlBefore = reflectedLight.directDiffuse;
  float vlDist = length( vViewPosition );
  #if NUM_POINT_LIGHTS > 0
  if ( vlDist < pointLights[ 0 ].decay ) vlPoints( geometryPosition, geometryNormal, material.diffuseColor, reflectedLight );
  #endif
  #if NUM_SPOT_LIGHTS > 0
  if ( vlDist < spotLights[ 0 ].decay ) vlSpots( geometryPosition, geometryNormal, material.diffuseColor, reflectedLight );
  #endif
  vec3 vlLocal = reflectedLight.directDiffuse - vlBefore;
#endif
`;

/**
 * Opaque toon pixels write how much of their light is local (lamp / window / fire) into the scene target's alpha:
 * a = 1 - 0.5 * share (so 1 = moonlight only; blended transparents only push it back toward 1). The post grade reads
 * it to keep lamp-lit pockets warm while the moonlit rest cools into blue.
 */
export const VL_ALPHA = /* glsl */`
#if defined( OPAQUE ) && defined( VL_TOON )
  {
    float vlL = dot( vlLocal, vec3( 0.2126, 0.7152, 0.0722 ) );
    float vlT = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
    gl_FragColor.a = 1.0 - 0.5 * clamp( vlL / max( vlT, 1e-4 ), 0.0, 1.0 );
  }
#endif
`;

const MARK = '// valley-lights';
const POINT_LOOP = '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )';
const SPOT_LOOP = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )';
const ANCHOR = 'IncidentLight directLight;';

/** Patch three's shader chunks (idempotent). Must run before the first toon program compiles. */
export function installValleyLightShaders(): void {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.lights_toon_pars_fragment.includes(MARK)) return;
  const begin = C.lights_fragment_begin;
  const once = (s: string, what: string) => { if (s.split(what).length !== 2) throw new Error(`valley lights: three's lights_fragment_begin changed (${what})`); };
  once(begin, POINT_LOOP); once(begin, SPOT_LOOP); once(begin, ANCHOR);
  C.lights_fragment_begin = begin
    .replace(ANCHOR, `${ANCHOR}\n${VL_APPLY}`)
    .replace(POINT_LOOP, `${POINT_LOOP} && !defined( VL_TOON )`)
    .replace(SPOT_LOOP, `${SPOT_LOOP} && !defined( VL_TOON )`);
  C.lights_toon_pars_fragment = `${C.lights_toon_pars_fragment}\n${MARK}\n${VL_PARS}`;
  C.opaque_fragment = `${C.opaque_fragment}\n${VL_ALPHA}`;
  (THREE.ShaderLib.toon.uniforms as Record<string, THREE.IUniform>).vlOcc = { value: VL_OCC };
}

installValleyLightShaders();

