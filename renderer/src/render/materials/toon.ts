/**
 * The one lit material (§5.0, ART §3.2): `MeshLambertMaterial` patched via onBeforeCompile so three's shadow,
 * instancing and vertex-colour chunks are kept. Replaces three's RE_Direct with the banded toon ramp (shadow feeds
 * the ramp), adds the hemisphere ambient, lamp pools and (env only) the window-gobo sun term; characters add rim +
 * clay sheen and write alpha 0 (character mask, §5.1).
 * Owner: RND.
 */
import * as THREE from 'three';
import { U, type UniformMap, MAX_LAMPS, MAX_WINDOWS, MAX_STAGES, MAX_SPILL } from '../uniforms.ts';
import { RAMP, WASH_W, POOL_CONE, POOL_MAX, POOL_TASK_MAX, POOL_DESAT, POOL_NEUTRAL, POOL_ALB_MIN, POOL_ALB_MAX, POOL_GAIN, CHAR_LAMP_REACH, CHAR_LAMP_KEY, CHAR_LAMP_RIM, CHAR_LAMP_MAX } from '../lightMath.ts';
import { patternsGlsl } from './patterns.glsl.ts';

/** Vertex displacement shared by the colour program and its depth material (§5.1 rule). */
export const swayGlsl = /* glsl */ `
#ifdef HQ_SWAY
  {
    vec4 hqWp = modelMatrix * vec4(transformed, 1.0);
    float hqH = clamp(position.y / 1.2, 0.0, 1.0);
    transformed.x += sin(uTime * 1.3 + hqWp.x * 2.0 + hqWp.z) * 0.03 * hqH * hqH;
    transformed.z += cos(uTime * 1.1 + hqWp.z * 2.0) * 0.02 * hqH * hqH;
  }
#endif
#ifdef HQ_WOBBLE
  transformed.xz *= 1.0 + sin(uTime * 2.2 + position.y * 6.0) * uWobble * 0.02;
#endif
`;

const vertPars = /* glsl */ `
uniform float uTime;
uniform float uWobble;
varying vec3 vHqWorld;
`;

const vertWorld = /* glsl */ `
{
  vec4 hqW = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    hqW = batchingMatrix * hqW;
  #endif
  #ifdef USE_INSTANCING
    hqW = instanceMatrix * hqW;
  #endif
  vHqWorld = (modelMatrix * hqW).xyz;
}
`;

const fragPars = /* glsl */ `
uniform vec4 uGain;           // kKey, kAmb, kSun (env) | char exposure (chars, RND fix r2), lampScale
uniform vec3 uKeyCol;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uEnvGround;
uniform vec3 uEnvSky;
uniform vec3 uShadowTint;
uniform vec3 uEnvTint;
uniform vec3 uZoneKey;
uniform vec3 uZoneSky;
uniform vec3 uZoneGround;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec4 uLampPos[${MAX_LAMPS}];
uniform vec3 uLampCol[${MAX_LAMPS}];
uniform vec4 uSpillPos[${MAX_SPILL}];
uniform vec4 uSpillN[${MAX_SPILL}];
uniform vec3 uSpillCol[${MAX_SPILL}];
uniform int uSpillCount;
uniform float uEmissiveGain;
uniform float uEmisDay;          // emissive × this by day → × 1 when the lamps are fully on (night)
uniform float uLampPhase;
uniform float uSoft;
uniform float uRim;
uniform float uSheen;
uniform float uDesat;
uniform float uFlash;
uniform int uPattern;
uniform vec4 uWinA[${MAX_WINDOWS}];
uniform vec4 uWinB[${MAX_WINDOWS}];
uniform vec4 uWinC[${MAX_WINDOWS}];
uniform int uWinCount;
uniform float uGobo;
uniform float uEnvHemiFloor;
uniform float uSunPatch;
uniform vec4 uSunGain;   // the env gain set (its .z = kSun), shared by env and props
uniform vec3 uGoboSkyDir;  // the skylight's sun direction: true azimuth, elevation clamped (lightMath goboSkyDir)
uniform vec2 uPatchCap;     // RND fix r1: sun-patch value cap (linear Y ceiling, max lift), by hour
uniform vec4 uStageRect[${MAX_STAGES}];
uniform vec3 uStageKey;
uniform vec3 uStageSky;
uniform vec3 uStageGround;
uniform vec4 uStageDesat;   // per-stage warm-albedo pull (x..w = stage 0..3; < 0: pull only, no stage grade)
varying vec3 vHqWorld;
// complementary staging (§5.5, m175 fix r2): 1 inside a Clawd hotspot rect (0.4 m soft edge), else 0. Inside, env and
// props take the hero-zone grade (so the Pit seen from the mezzanine is staged like the Pit seen from the lobby) and
// warm mid-chroma albedos (walnut, oak, brass, warm concrete: Lab h ≈ 50–85, C ≲ 40) are pulled toward grey, so the
// ring round a terracotta Clawd is cool or neutral. Clay-hued accents (opponent angle < 41°; clay 39°, walnut 48°) and saturated accents
// (butter, slide) are left alone; warmth comes from lamps and the sun patch (light), not from the surfaces
float hqStage = 0.0;       // grade weight (hero-zone tints)
float hqStageK = 0.0;      // warm-albedo pull
float hqStageW( vec3 p ) {
  float w = 0.0;
  for ( int i = 0; i < ${MAX_STAGES}; i ++ ) {
    vec4 r = uStageRect[ i ];
    vec2 d = max( r.xy - p.xz, p.xz - r.zw );
    float wi = 1.0 - smoothstep( -0.2, 0.2, max( d.x, d.y ) );
    float ki = wi * abs( uStageDesat[ i ] );
    hqStageK = max( hqStageK, ki );
    w = max( w, uStageDesat[ i ] > 0.0 ? wi : 0.0 );   // a negative pull = a stage that keeps its own zone grade (Library)
  }
  return w;
}
vec3 hqStageAlbedo( vec3 c ) {
  vec3 s = sqrt( max( c, vec3( 0.0 ) ) );   // ≈ sRGB
  float a = s.r - s.g, b = 0.5 * ( s.r + s.g ) - s.b;
  float ang = degrees( atan( b, a ) );
  float y = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  // light accents (the butter slide, cream, paper) are spared: only mid/dark warm surfaces sit in a Clawd's ring
  float k = hqStageK * smoothstep( 41.0, 46.0, ang ) * ( 1.0 - smoothstep( 95.0, 110.0, ang ) ) * ( 1.0 - smoothstep( 0.36, 0.52, length( vec2( a, b ) ) ) ) * ( 1.0 - smoothstep( 0.5, 0.62, y ) );
  return mix( c, vec3( y ), k );
}
vec3 hqZone( vec3 camZone, vec3 stage ) { return mix( camZone, stage, hqStage ); }
// the night tint skips lamp fixtures (day-dimmed emissives: shades, bulbs), which read as warm self-lit fabric
vec3 hqEnvTint() { return uEmisDay < 0.99 ? vec3( 1.0 ) : uEnvTint; }
// RND fix r2: the characters' softened hour exposure (lightMath charExposure, uGain.z ≈ 0.8 at night). Dark bodies
// (the codex slate, §5.5: lit L* ≥ 30 / shadow ≥ 20 at every hour) already sit at the readability floor, so they keep
// full exposure, and so does eye paper (Y ≥ 0.7: the face must read, eye paper vs body ΔL* ≥ 40); the clays and
// accessories in between take the whole dimming
float hqCharExpo( vec3 alb ) {
  float y = dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) );
  return mix( 1.0, uGain.z, smoothstep( 0.06, 0.16, y ) * ( 1.0 - smoothstep( 0.5, 0.7, y ) ) );
}
float hqRamp = 1.0;
float hqT = 1.0;
vec3 hqKeyDirV = vec3(0.0, 1.0, 0.0);
${patternsGlsl}

void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float ndl = dot( geometryNormal, directLight.direction ) * 0.5 + 0.5;
  float keyVis = directLight.color.r;   // the studio key is white/1.0 in three: its colour is exactly the shadow factor
  #ifdef HQ_CHAR
    // no self-shadow acne on the bevels: toward the terminator the ramp already carries the shading, so the
    // shadow map fades out there (a desk's cast shadow on a key-facing face still lands in full)
    keyVis = mix( 1.0, keyVis, smoothstep( 0.02, 0.3, dot( geometryNormal, directLight.direction ) ) );
  #endif
  float t = smoothstep( ${RAMP.band0.toFixed(3)} - uSoft, ${RAMP.band0.toFixed(3)} + uSoft, ndl );
  float t2 = smoothstep( ${RAMP.band1.toFixed(3)} - uSoft, ${RAMP.band1.toFixed(3)} + uSoft, ndl );
  float ramp = ( t * 0.7 + t2 * 0.3 ) * mix( 1.0, keyVis, 0.85 );   // shadow feeds the ramp (§5.0)
  hqRamp = ramp; hqT = t * mix( 1.0, keyVis, 0.85 ); hqKeyDirV = directLight.direction;
  vec3 hqKey = uKeyCol;
  #ifndef HQ_CHAR
    hqKey *= hqEnvTint() * hqZone( uZoneKey, uStageKey );   // cool night surround + zone grade for env + props; characters keep the clay contract
  #else
    hqKey *= hqCharExpo( material.diffuseColor );   // RND fix r2: the characters' softened hour exposure
  #endif
  reflectedLight.directDiffuse += material.diffuseColor * uGain.x * hqKey * mix( uShadowTint, vec3( 1.0 ), ramp );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Toon

float hqGobo(vec3 p, vec3 n) {
  if (uSunDir.y < 0.02 || uWinCount == 0) return 0.0;
  // m2 fix r1 (perf): a surface facing away from both sun directions (ceilings, the back of every wall) can't take a
  // patch (the per-window factor below is smoothstep(0, .25, n·sd)): skip the window loop for about half the pixels
  if (max(dot(n, uSunDir), dot(n, uGoboSkyDir)) <= 0.0) return 0.0;
  float g = 0.0;
  for (int i = 0; i < ${MAX_WINDOWS}; i++) {
    if (i >= uWinCount) break;
    vec4 clip = uWinC[i];                     // the window's room (world xz rect): beams never pass interior walls
    if (p.x < clip.x || p.x > clip.z || p.z < clip.y || p.z > clip.w) continue;
    vec3 c = uWinA[i].xyz; vec3 nin = uWinB[i].xyz;
    bool hqSky = abs(nin.y) > 0.5;             // skylight: plan-aligned rect, 2 × 2 panes
    // the skylight uses the elevation-clamped sun, so a low golden sun still lands its patch inside the atrium
    // (rakes across the floor toward the far wall and climbs it) instead of 18 m away behind a wall
    vec3 sd = hqSky ? uGoboSkyDir : uSunDir;
    float dn = dot(sd, nin);
    if (dn > -0.02) continue;                 // sun must shine in through this window
    float side = dot(p - c, nin);
    if (side < 0.0) continue;                 // fragment outside
    float t = side / -dn;
    vec3 h = p + sd * t - c;
    float hw = uWinA[i].w, hh = uWinB[i].w;
    vec3 tang = hqSky ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), nin));
    float u = dot(h, tang), v = hqSky ? h.z : h.y;
    // soft 3 cm penumbra on the patch edge (a sun disc is ~0.5°; at 2–4 m that is a few cm), then mullion bars
    // m175 fix r2: the 5.5 m-high skylight throws a soft-edged patch (a wide penumbra + blurred mullions: at that height
    // the sun disc and the frosted panes smear the edge over ≈ 0.5 m), so golden hour reads as a warm pool of light
    float pen = hqSky ? 0.1 : 0.03;
    float inside = ( 1.0 - smoothstep(hw - pen, hw + pen, abs(u)) ) * ( 1.0 - smoothstep(hh - pen, hh + pen, abs(v)) );   // (edge0 < edge1: reversed smoothstep is undefined in GLSL)
    float nu = hqSky ? 2.0 : 3.0, nv = 2.0;
    float pu = fract((u + hw) / (2.0 * hw) * nu), pv = fract((v + hh) / (2.0 * hh) * nv);
    float bw = hqSky ? 0.16 : 0.05;              // bar half-widths (skylight: blurred mullion shadows), window mullions ≈ 5 cm
    float bu = bw / (2.0 * hw / nu), bv = bw / (2.0 * hh / nv);
    float bars = smoothstep(0.0, bu, min(pu, 1.0 - pu)) * smoothstep(0.0, bv, min(pv, 1.0 - pv));
    if (hqSky) bars = mix(0.3, 1.0, bars);        // soft mullion shade, never a hard black cross
    g = max(g, inside * bars * smoothstep(0.0, 0.25, dot(n, sd)));
  }
  return g * uGobo;
}
`;

// Ambient + lamp pools + gobo sun + rim/sheen, appended after three's lights_fragment_end.
const fragLightEnd = /* glsl */ `
{
  vec3 hqN = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );   // world normal
  float hqF = hqN.y * 0.5 + 0.5;
  #ifdef HQ_ENV
    // env bounce floor (M1.75 tune): architecture's down/side faces get the warm floor bounce a real room has, so
    // ceilings and walls sit on the §5.0 rendered-L* rows; characters/props keep the 0.55 contract (clayCheck)
    vec3 hqLight = uGain.y * mix( uEnvGround * hqZone( uZoneGround, uStageGround ), uEnvSky * hqZone( uZoneSky, uStageSky ), hqF ) * mix( uEnvHemiFloor, 1.0, hqF );
  #elif defined( HQ_CHAR )
    vec3 hqLight = uGain.y * hqCharExpo( material.diffuseColor ) * mix( uGround, uSky, hqF ) * mix( 0.55, 1.0, hqF );   // × char exposure (RND fix r2)
  #else
    vec3 hqLight = uGain.y * mix( uGround * hqZone( uZoneGround, uStageGround ), uEnvSky * hqZone( uZoneSky, uStageSky ), hqF ) * mix( 0.55, 1.0, hqF );
  #endif
  #ifndef HQ_CHAR
    hqLight *= hqEnvTint();
  #endif
  // pool scale: env and props take the full night boost (fix r1: rugs, sofas and desk tops are props, and at 1.0 the
  // hearth / desk-lamp pools on them did not read); characters keep 1.0 (clayCheck, no clay blow-out beside a lamp)
  #ifdef HQ_PROP
    float hqLampK = uSunGain.w;
  #else
    float hqLampK = uGain.w;
  #endif
  // lamp pools (§5.6). m2 fix r3 (night interiors had no warm pools): a shaded lamp (pendant, desk lamp, street
  // lantern) now throws a cone: the pool widens with the drop below the shade (radius = pool + POOL_CONE × drop), with
  // a bright core over a wide soft shoulder, so a pendant 2.3 m up lays a ≈ 2 m warm gradient on the floor and a
  // brighter spot on the table under it. Env / props take the pool light on a half-desaturated albedo: warm light on a
  // teal floor reads as warm light (plain albedo turned it olive and it vanished into the cool surround).
  vec3 hqPool = vec3( 0.0 );
  float hqTaskW = 0.0;   // RND fix r3: how much of this pixel's pool is a task lamp's (desk lamp) → a higher cap
  #ifdef HQ_CHAR
    vec3 hqLampKey = vec3( 0.0 );   // RND fix r2: the pool lamps as small warm key / rim sources for the clay
  #endif
  for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
    vec4 lp = uLampPos[ i ];
    float aw = abs( lp.w );   // w < 0: a shaded downlight (pendant, desk lamp) that lights only below its shade
    if ( aw <= 0.0 ) continue;
    // |w| = reach + 100 × pool radius in dm + 10000 if the source is an open flame + 20000 for a task lamp (lamps.ts poolCode)
    bool hqTask = aw >= 20000.0;
    float aw2 = hqTask ? aw - 20000.0 : aw;
    bool hqOmni = aw2 >= 10000.0;
    aw2 = hqOmni ? aw2 - 10000.0 : aw2;
    float r = mod( aw2, 100.0 );
    float hqPr = floor( aw2 / 100.0 ) * 0.1;
    vec3 d = lp.xyz - vHqWorld;
    #ifdef HQ_CHAR
      {
        float rc = r * ${CHAR_LAMP_REACH.toFixed(3)};
        float qc = dot( d, d ) / ( rc * rc );
        if ( qc < 1.0 ) {
          float fc = ( 1.0 - qc ) * ( 1.0 - qc );
          if ( lp.w < 0.0 ) fc *= smoothstep( -0.2, 0.25, d.y );   // shaded lamps light what is below the shade
          hqLampKey += uLampCol[ i ] * fc * max( dot( hqN, normalize( d ) ), 0.0 );
        }
      }
    #endif
    // shaded downlights (w < 0) reach ×3 further down, so a pendant 2.5–3.4 m up still reaches the floor below
    vec3 dq = lp.w < 0.0 ? vec3( d.x, d.y * 0.33, d.z ) : d;
    float q = dot( dq, dq ) / ( r * r );
    if ( q >= 1.0 ) continue;
    float fall = ( 1.0 - q ) * ( 1.0 - q ) * ( 1.0 - q );   // (1 − q)³ wash
    if ( lp.w < 0.0 ) fall *= smoothstep( -0.2, 0.25, d.y );
    float hqL = fall * max( dot( hqN, normalize( d ) ), 0.0 );
    if ( hqPr > 0.0 ) {
      float drop = max( d.y, 0.0 );
      float R = hqPr + ( lp.w < 0.0 ? ${POOL_CONE.toFixed(3)} * drop : 0.0 );
      float hd = length( d.xz ) / R;
      float prof = 0.55 * ( 1.0 - smoothstep( 0.0, 0.5, hd ) ) + 0.45 * ( 1.0 - smoothstep( 0.25, 1.0, hd ) );
      // up-facing surfaces take the full pool, sides of things standing in it a little (chair legs, sofa fronts)
      float facing = max( hqN.y, 0.0 ) + 0.3 * ( 1.0 - abs( hqN.y ) );
      float disk = prof * facing * smoothstep( 0.02, 0.2, d.y ) * ( 1.0 - smoothstep( r * 0.8, r * 1.15, d.y ) );
      disk *= mix( 0.35, 1.0, uLampPhase );   // by day the lamps are dim accents: the disk only reads after dark
      hqL = min( 1.0, ( hqOmni ? 1.0 : ${WASH_W.toFixed(3)} ) * hqL + disk );   // shaded lamps: dim wash; an open flame keeps its full wash
    }
    if ( hqTask ) {   // a task lamp lights its desk top (≤ 0.55 m below it); the floor under the desk takes 45 %
      float hqTf = smoothstep( 0.55, 0.85, d.y );
      hqL *= 1.0 - 0.55 * hqTf;
      hqTaskW += hqL * ( 1.0 - hqTf );
    }
    hqPool += uLampCol[ i ] * hqL;
  }
  #ifdef HQ_CHAR
    hqPool = min( hqPool * hqLampK, vec3( ${POOL_MAX.toFixed(3)} ) );   // overlapping pools never flatten into a slab
  #else
    // env / props: pools read against the cool night room at POOL_GAIN (characters keep 1: clayCheck)
    hqPool = min( hqPool * hqLampK * ${POOL_GAIN.toFixed(3)}, vec3( mix( ${POOL_MAX.toFixed(3)}, ${POOL_TASK_MAX.toFixed(3)}, min( hqTaskW, 1.0 ) ) ) );
  #endif
  #if defined( HQ_ENV ) || defined( HQ_PROP )
    // sun patch (§5.6): kSun × the patch multiplier. Props (sofas, rugs, desks) take it too (M1.75: a patch that
    // stopped at the rug edge read as a bug); characters never do, so they stay uniformly readable. The patch may exceed the key+amb+pool sum invariant: the lit
    // shoulder below (Y > 0.82 compressed) is what keeps a sunlit cream wall under the bloom threshold, and floors
    // (albedo ≤ 0.3) need ≈ +0.45 to read as sun at all (M1.75 tune; DESIGN §5.0 proposal)
    // bright albedos take less of the patch (fix r1): a sunlit cream wall caps near the shoulder instead of blooming,
    // while floors (Y ≈ 0.2–0.3) get the full golden patch
    float hqAlbY = dot( material.diffuseColor, vec3( 0.2126, 0.7152, 0.0722 ) );
    // fix r2: the patch light is sunCol softened 15 % toward white — a pale-gold patch brightens what it lands on
    // instead of repainting it orange, so a Clawd sitting in the golden patch keeps its hue gap on the sofa behind it
    vec3 hqPatch = uSunGain.z * uSunPatch * mix( uSunCol, vec3( 1.0 ), 0.15 ) * hqGobo( vHqWorld, hqN ) * clamp( 0.3 / max( hqAlbY, 0.01 ), 0.3, 1.0 );
    // value cap (fix r2): the patch lifts a surface to at most linear Y 0.34 (L* ≈ 65, the §5.0 golden "gobo ≤ 66" row)
    // or +12 % over its unlit value, whichever is higher, so dark rugs / sofas take the full golden light, mid floors
    // stop just under the row, and pale walls get a gentle warm lift instead of a blown-out panel
    float hqBaseY = dot( reflectedLight.directDiffuse + material.diffuseColor * hqLight, vec3( 0.2126, 0.7152, 0.0722 ) );
    float hqPatchY = dot( material.diffuseColor * hqPatch, vec3( 0.2126, 0.7152, 0.0722 ) );
    hqLight += hqPatch * clamp( ( max( uPatchCap.x, hqBaseY * uPatchCap.y ) - hqBaseY ) / max( hqPatchY, 1e-4 ), 0.0, 1.0 );   // RND fix r1: cap by hour (lightMath PATCH_CAP)
  #endif
  reflectedLight.indirectDiffuse += material.diffuseColor * hqLight;
  #ifdef HQ_CHAR
    reflectedLight.indirectDiffuse += material.diffuseColor * hqPool;   // clay keeps its hue under a lamp (clayCheck)
    // RND fix r2: lamp key (on the albedo) + a fresnel rim toward the lamp, scaled by the phase lamp scale (by day the
    // lamps are dim accents), clamped so a Clawd beside the hearth never blows out
    // pale parts (eye paper, trims: Y ≥ 0.45) already sit at the lit shoulder: they take no lamp term (lumaStats max)
    vec3 hqLk = min( hqLampKey * hqLampK, vec3( ${CHAR_LAMP_MAX.toFixed(3)} ) )
      * ( 1.0 - smoothstep( 0.45, 0.7, dot( material.diffuseColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ) );
    float hqLf = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 2.0 );
    reflectedLight.indirectDiffuse += material.diffuseColor * hqLk * ${CHAR_LAMP_KEY.toFixed(3)};
    reflectedLight.directDiffuse += hqLk * hqLf * ${CHAR_LAMP_RIM.toFixed(3)} * mix( material.diffuseColor, vec3( 1.0 ), 0.35 );
  #else
    // inside a pool the lamp is the dominant light: the cool night surround tint (ENV_TINT, zone grade) is neutralised
    // in proportion to the pool, so the pool reads warm against the cool room, not as a grey lift
    float hqPk = clamp( dot( hqPool, vec3( 0.2126, 0.7152, 0.0722 ) ) * ${POOL_NEUTRAL.toFixed(3)}, 0.0, 0.85 );
    reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( dot( reflectedLight.indirectDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) ), hqPk );
    reflectedLight.directDiffuse = mix( reflectedLight.directDiffuse, vec3( dot( reflectedLight.directDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) ), hqPk );
    float hqAY = dot( material.diffuseColor, vec3( 0.2126, 0.7152, 0.0722 ) );
    // dark paints (teal floors, ink furniture) take the pool as if at least POOL_ALB_MIN bright: the pool is a visible
    // warm gradient on every floor, not only on pale ones. RND fix r3: pale tops take it as if at most POOL_ALB_MAX
    // bright (the lab's pale round table read as a glowing disc at 22 h). Up-facing tops only: walls keep their pool
    // light (they sit on the §5.0 wallLit row)
    float hqAlbMax = mix( 1.0, ${POOL_ALB_MAX.toFixed(3)}, smoothstep( 0.5, 0.9, hqN.y ) );
    vec3 hqPoolAlb = mix( material.diffuseColor, vec3( hqAY ), ${POOL_DESAT.toFixed(3)} ) * ( clamp( hqAY, ${POOL_ALB_MIN.toFixed(3)}, max( hqAlbMax, ${POOL_ALB_MIN.toFixed(3)} ) ) / max( hqAY, 0.02 ) );
    reflectedLight.indirectDiffuse += hqPoolAlb * hqPool;
  #endif
  #if defined( HQ_CHAR ) || defined( HQ_PROP )
    // monitor spill (M3.5, deskScreens.updateSpill): a lit desk screen lights what is in front of it (the face at the
    // desk, the keyboard, the desk top): working cool, blocked pulsing red, done a green flash. Front half-space only
    for ( int i = 0; i < ${MAX_SPILL}; i ++ ) {
      if ( i >= uSpillCount ) break;
      vec4 sp = uSpillPos[ i ];
      vec3 sd = vHqWorld - sp.xyz;
      float along = dot( sd, uSpillN[ i ].xyz );
      float dist = length( sd );
      if ( along <= 0.0 || dist >= sp.w ) continue;
      float f = 1.0 - dist / sp.w;
      float lam = 0.35 + 0.65 * max( dot( hqN, -sd / max( dist, 1e-3 ) ), 0.0 );
      reflectedLight.indirectDiffuse += material.diffuseColor * uSpillCol[ i ] * ( f * f * lam * smoothstep( 0.0, 0.06, along ) );
    }
  #endif
  #ifdef HQ_CHAR
    float hqNdV = saturate( dot( geometryNormal, geometryViewDir ) );
    float rim = pow( 1.0 - hqNdV, 3.0 ) * uRim * hqT * hqCharExpo( material.diffuseColor );   // studio rim + sheen follow the char exposure (RND fix r2)
    reflectedLight.directDiffuse += rim * mix( material.diffuseColor, uKeyCol, 0.5 );
    vec3 hqH = normalize( hqKeyDirV + geometryViewDir );
    // soft-edged toon sheen: a 0.05 smoothstep instead of a hard step, so the highlight edge never stair-steps
    float sh = smoothstep( 0.475, 0.525, pow( max( dot( geometryNormal, hqH ), 0.0 ), 24.0 ) ) * uSheen * hqRamp;
    reflectedLight.directDiffuse += sh * uKeyCol * 0.5 * hqCharExpo( material.diffuseColor );
  #endif
}
`;

const fragOut = /* glsl */ `
{
  // soft shoulder on the lit (non-emissive) result: albedo-cap-level surfaces + rim/sheen never read as light
  // sources (§5.0 lumaStats max ≤ 0.95 with emissives off); clay (max ch ~0.69) is untouched
  vec3 hqLit = gl_FragColor.rgb - totalEmissiveRadiance;
  float hqY = dot( hqLit, vec3( 0.2126, 0.7152, 0.0722 ) );
  if ( hqY > 0.82 ) hqLit *= ( 0.82 + ( hqY - 0.82 ) * 0.35 ) / hqY;
  gl_FragColor.rgb = hqLit + totalEmissiveRadiance;
}
#ifdef HQ_CHAR
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uDesat );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.9 ), uFlash );
  gl_FragColor.a = 0.0;   // character mask (§5.1): Edge skips, AO never saw it
#else
  gl_FragColor.a = 1.0;
#endif
`;

export function patchToon(mat: THREE.MeshLambertMaterial, { kind, defines, local }: { kind: string; defines: Record<string, string>; local: UniformMap }): void {
  const isChar = kind === 'toonChar';
  const gain = isChar || kind === 'toonProp' ? U.uGainChar : U.uGainEnv;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.defines ??= {}, defines);
    Object.assign(shader.uniforms, {
      uTime: U.uTime, uGain: gain, uKeyCol: U.uKeyCol, uSky: U.uSky, uGround: U.uGround, uEnvGround: U.uEnvGround, uEnvSky: U.uEnvSky, uShadowTint: U.uShadowTint, uEnvTint: U.uEnvTint, uZoneKey: U.uZoneKey, uZoneSky: U.uZoneSky, uZoneGround: U.uZoneGround,
      uSunDir: U.uSunDir, uSunCol: U.uSunCol, uLampPos: U.uLampPos, uLampCol: U.uLampCol, uSpillPos: U.uSpillPos, uSpillN: U.uSpillN, uSpillCol: U.uSpillCol, uSpillCount: U.uSpillCount, uEmissiveGain: U.uEmissiveGain,
      uWinA: U.uWinA, uWinB: U.uWinB, uWinC: U.uWinC, uWinCount: U.uWinCount, uGobo: U.uGobo, uLampPhase: U.uLampPhase, uEnvHemiFloor: U.uEnvHemiFloor, uSunPatch: U.uSunPatch, uSunGain: U.uSunGain, uGoboSkyDir: U.uGoboSkyDir, uPatchCap: U.uPatchCap,
      uStageRect: U.uStageRect, uStageKey: U.uStageKey, uStageSky: U.uStageSky, uStageGround: U.uStageGround, uStageDesat: U.uStageDesat,
      ...local,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${swayGlsl}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${vertWorld}`);
    // characters: 3× the key's normal-offset bias. A 1024² map over the 24 m box is 2.3 cm/texel, coarser than a
    // Clawd's 4 cm bevels, so the shared bias (tuned for flat props) leaves stair-stepped self-shadow on the body
    if (isChar) shader.vertexShader = shader.vertexShader.replace('#include <shadowmap_vertex>', THREE.ShaderChunk.shadowmap_vertex
      .replace(/directionalLightShadows\[ i \]\.shadowNormalBias/g, '( directionalLightShadows[ i ].shadowNormalBias * 3.0 )'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_lambert_pars_fragment>', `#include <lights_lambert_pars_fragment>\n${fragPars}`)
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * uEmissiveGain * mix( uEmisDay, uEmisDay < 0.99 ? 1.35 : 1.0, uLampPhase );')
      .replace('#include <lights_lambert_fragment>', `#include <lights_lambert_fragment>
  #if defined(HQ_ENV) || defined(HQ_PROP)
    material.diffuseColor = hqPattern( uPattern, material.diffuseColor, vHqWorld, normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz ) );
    hqStage = hqStageW( vHqWorld );
    if ( hqStageK > 0.0 ) material.diffuseColor = hqStageAlbedo( material.diffuseColor );
  #endif`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${fragLightEnd}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${fragOut}`);
  };
}

/** Depth material for displaced meshes (foliage sway / wobble) so shadows match the displaced surface (§5.1). */
export function displacedDepthMaterial(defines: Record<string, string>): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.defines ??= {}, defines);
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWobble = { value: 1 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWobble;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${swayGlsl}`);
  };
  m.customProgramCacheKey = () => `hqdepth|${Object.keys(defines).sort().join(',')}`;
  return m;
}
