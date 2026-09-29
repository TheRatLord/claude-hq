// @pure
/**
 * §5.0 radiometric contract as plain numbers: gain sets by hour, normalised light colours, the studio key and sun
 * directions, lamp schedule, and a CPU mirror of the toon shading used by tests (`lightMath.test.ts`) and probe.ts.
 * Owner: RND. No three.js here.
 */
import { hexToRgb, srgbToLinear, MISC, type Rgb } from '../../../shared/palette.ts';

/** The three lighting phases of the §5.0 gain table. */
export type Phase = 'day' | 'golden' | 'night';
export type PhaseWeights = Record<Phase, number>;
/** Phase weights plus the morning look's share (LUT blend). */
export interface LutWeights extends PhaseWeights { morning: number }
/** Per-phase values (day / golden / night). */
export type PerPhase<T> = Readonly<Record<Phase, T>>;

/** Linear RGB of a hex token. */
export const lin = (hex: string): Rgb => { const [r, g, b] = hexToRgb(hex); return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]; };
/** Normalise to max channel = 1 (§5.0: brightness lives only in gains). */
export const norm = (v: readonly number[]): Rgb => { const m = Math.max(...v, 1e-6); return [v[0] / m, v[1] / m, v[2] / m]; };

/** Toon ramp constants (ART §3.2 as amended by §5.0). */
export const RAMP = Object.freeze({ band0: 0.42, band1: 0.72, softChar: 0.03, softProp: 0.05, softEnv: 0.08 });
export const SHADOW_TINT = '#AAA5DC';
export const KEY = Object.freeze({ color: MISC.keyLight, elevationDeg: 60, azimuthDeg: 200 });

/**
 * Gain sets (§5.0 table). chars/props: kKey/kAmb/kPts; env: kKey/kAmb/kSun/lamp.
 * Tuning may change env gains only; character gains change only with an art review of clayCheck.
 * M1 tuning (proto room): env day kAmb 0.46→0.52 / kSun 0.20→0.14, golden kAmb 0.44→0.48 / kSun 0.22→0.18, night kAmb 0.40→0.34 (walls facing
 * away from the key read ≥ 60 and p50 ≥ 0.20; the env sum stays ≤ 1.14).
 * M1 fix r1 (night mood): env night kKey 0.44→0.32 / kAmb 0.34→0.26 and night pools ×1.7 (per-lamp ≤ 0.51), so the
 * room reads as warm lamp pools in a darker surround (proto poolDelta 6.3 → ≈ 10) instead of a cool-graded day;
 * env sum 0.32 + 0.26 + 0.51 = 1.09 ≤ 1.14.
 * M1 fix r2 (cozy night): env/prop base light takes a cool night tint (ENV_TINT, chroma-only) so warm pools and
 * screens carry the frame; env night kKey 0.36 / kAmb 0.39 put the tinted walls/floors back on the §5.0 night rows.
 * The invariant is checked per channel (what bloom sees): max_c(kKey·key·tint + kAmb·hemi·tint + kSun·sun) + pools
 * ≤ 1.14 (`envGainPeak`, lightMath.test.ts); night peaks at 1.13 in blue.
 * M1.75 tune (full office): night: a darker surround (walls/floors kept on the night rows by the new bounce
 * floor), night env kKey 0.40 / kAmb 0.42 with pools ×1.9 in the warm lamp colour (LAMP_NIGHT_WARMTH); the per-channel peak now uses the warm
 * reference lamp instead of a white one (no white lamp exists; blue is where the cool surround peaks).
 */
type CharGain = { kKey: number; kAmb: number; kPts: number };
type EnvGain = { kKey: number; kAmb: number; kSun: number };
export const GAINS: PerPhase<{ char: CharGain; env: EnvGain }> = Object.freeze({
  day: { char: { kKey: 0.62, kAmb: 0.38, kPts: 0 }, env: { kKey: 0.48, kAmb: 0.46, kSun: 0.2 } },
  golden: { char: { kKey: 0.62, kAmb: 0.36, kPts: 0 }, env: { kKey: 0.6, kAmb: 0.63, kSun: 0.2 } },   // fix r1: golden = warm sun patches in a cool dusk-lit room (ENV_TINT golden); key/amb raised to hold p50 ≥ 0.18 under the cool tint (the tint drops the red channel, so the per-channel peak stays ≤ 1.14)
  night: { char: { kKey: 0.55, kAmb: 0.33, kPts: 0.12 }, env: { kKey: 0.4, kAmb: 0.42, kSun: 0 } },
});
/**
 * Lamp pool gain scale by phase (§5.6: day 15%, golden 40%, night 100%; night boosted to 170% with the darker night
 * env gains above, still inside the §5.0 env invariant).
 */
export const LAMP_SCALE = Object.freeze({ day: 0.15, golden: 0.4, night: 1.9 });
/** After dark lamp colours shift warmer: rgb^this (normalised). 1.5 cost the pools ~45% of their luminance. */
export const LAMP_NIGHT_WARMTH = 1.6;
/** The warmest-common lamp (floor lamps, pendants): the per-channel pool colour used by `envGainPeak`. */
export const LAMP_REF = '#FFCF94';
/**
 * Lamp pool shape (toon.ts, M1.75 fix r1): real lamps lay a compact plateau disk (POOL_RADIUS by kind, metres) on
 * up-facing surfaces below them, over their reach-sized wash scaled to WASH_W, so night floors show pools with a rim
 * instead of one broad gradient (§5.0 pool row +6…+14 over the floor outside). Peak stays 1 × the lamp gain (the
 * invariant's assumption).
 */
export const WASH_W = 0.3;
// [ENV fix m2 r3, cross-owner RND minimal] `lantern` 0 = no plateau disk, the full reach wash (the garden lanterns and
// porch light must light the vertical south façade, which a disk lamp's 0.3 wash left one flat tone at 22 h)
export const POOL_RADIUS = Object.freeze({ pendant: 1.2, floor: 1.0, floorArc: 1.1, desk: 0.55, street: 1.5, hearth: 1.8, lantern: 0, default: 1.0 });
/**
 * m2 fix r3 (night pools): shaded lamps throw a cone, pool radius = POOL_RADIUS + POOL_CONE × drop below the shade;
 * the summed pool light per pixel is capped at POOL_MAX (overlaps never flatten a floor); env / props take pool light
 * on an albedo desaturated by POOL_DESAT (warm light on a teal floor reads warm, not olive).
 */
export const POOL_CONE = 0.32;
export const POOL_MAX = 1.0;
/** RND fix r3: the per-pixel pool cap inside a task lamp's (desk lamp) own pool (lamps.ts poolCode task flag). */
export const POOL_TASK_MAX = 1.6;
/** Env / prop pool gain over the character one (pools are the night's light sources; chars keep 1 for clayCheck). */
export const POOL_GAIN = 1.6;
export const POOL_DESAT = 0.8;
/** Inside a pool the cool surround tint is neutralised by pool luminance × this (≤ 0.85): the pool reads warm. */
export const POOL_NEUTRAL = 2.5;
/** Pool light sees an albedo luminance of at least this (dark floors / furniture still show the warm pool). */
export const POOL_ALB_MIN = 0.16;
/**
 * RND fix r3 (art review: at 22 h the lab's pale round table read as a glowing disc): pool light sees an albedo
 * luminance of at most this, so a pale top (cream, white laminate, paper) in a pool is warmed like a mid-value
 * surface instead of blooming into a lit plate.
 */
export const POOL_ALB_MAX = 0.3;
/** Per-lamp pool gain cap (layout `gain`, §5.0 "≤ 0.30"); the night pool term is LAMP_CAP × LAMP_SCALE.night. */
export const LAMP_CAP = 0.3;

/** Hemisphere colours (ART §3.1 reference; normalised). */
export const HEMI = Object.freeze({
  day: { sky: '#DDE8F2', ground: '#C9A887' },
  golden: { sky: '#F2D6C0', ground: '#A87C60' },
  night: { sky: '#D2CCE0', ground: '#A89484' }, // the office lights are on at night (§5.0): near-neutral, a hint of dusk; ART's #3A4466 normalises to pure blue
});
export const SUN_COL = Object.freeze({ day: '#FFE7C8', golden: MISC.sunGolden, night: '#9FB4FF' });
/**
 * Environment/prop base-light tint (key + ambient only; lamp pools, sun gobo and characters untouched). Chroma-only
 * (max channel 1, like the §5.6 zone grade), so the §5.0 invariants hold. Night: a cool blue-violet surround so the
 * warm lamp pools and glowing screens carry the frame (M1 fix r2: "a cozy night, not a dim grey-lilac day").
 */
/**
 * Environment hemisphere ground colour = the character ground softened this far toward white (M1.75 tune): the
 * saturated clay-orange bounce (#C9A887, normalised 1/.67/.41) turned every ceiling and shaded wall dusty mauve under
 * the violet shadow tint; architecture now gets a creamy peach bounce. Characters keep HEMI.ground (clayCheck).
 */
export const ENV_GROUND_SOFTEN = 0.45;
/**
 * Env/prop-only sky desaturation by phase (m2 fix r1). The golden sky (#F2D6C0, normalised 1/.76/.59) carries only
 * 0.80 luminance, so under the cool golden ENV_TINT the ambient that lights every shaded surface fell ~10% under the
 * day level and the darkest tenth of the frame went under the §5.0 p10 row (mezzToPit 18 h: p10 0.036 < 0.04).
 * Softening it toward white (still max channel 1: the §5.0 per-channel invariant is untouched) brings the golden
 * ambient back to the day level; the golden hour's warmth lives in the sun patches, lamps and the LUT. Characters keep
 * HEMI.sky (clayCheck).
 */
export const ENV_SKY_SOFTEN = Object.freeze({ day: 0.25, golden: 0.5, night: 0 });
/**
 * Env-only hemisphere factor for down-facing architecture (toon.ts uEnvHemiFloor: mix(this, 1, N.y·½+½); chars/props
 * keep §5.0's 0.55). > 1 = floor bounce: a real room's ceiling is lit by its floor and the office's own uplights, so
 * ceilings reach the §5.0 row (55–70) and walls pick up ~7%. Up-facing surfaces (the §5.0 invariant's worst case)
 * are unchanged, so envGainPeak still holds.
 */
export const ENV_HEMI_FLOOR = 1.4;
/** Sun-patch multiplier on env kSun inside the window gobo (toon.ts uSunPatch; bounded by the lit shoulder). */
export const SUN_PATCH = 3.0;
/**
 * Golden-hour patch multiplier (fix r1): the low warm sun is the one moment the office should visibly glow, so the
 * gobo patch runs hotter than by day (floor patches reach the §5.0 golden "gobo ≤ 66" row instead of +5 L*).
 * toon.ts scales the patch down on bright albedos (cream walls) so a lit wall stays under the bloom threshold.
 */
/** RND fix r1: morning patch multiplier (pale sun through the east windows / skylight). */
export const SUN_PATCH_MORNING = 5;
/**
 * RND fix r1: the patch value cap (toon.ts uPatchCap, linear Y): by day a patch lifts a surface to at most 0.34 (the
 * §5.0 "gobo ≤ 66" row); at golden hour the low sun is the one warm light in a dimmed room and may reach 0.46 (L* ≈ 73),
 * or +30 % over its unlit value on pale walls (the +12 % day rule), still under the 0.82 shoulder / bloom threshold.
 */
export const PATCH_CAP = Object.freeze({ day: 0.34, golden: 0.46, dayLift: 1.12, goldenLift: 1.3 });
export const SUN_PATCH_GOLDEN = 10;   // m175 fix r2: 4.4 barely moved the Pit's dark teal rug and sage sofas (+14 L* on the rug); the patch must read from pitOverview / spawn

export const ENV_TINT = Object.freeze({ day: '#FFFFFF', golden: '#DEE6FF', night: '#C3D3EE' }); // night bluer, less lilac (M1.75); fix r1: golden base light goes cool dusk-blue so the warm gobo patches carry golden hour and the Clawds keep their hue gap (a warm golden tint failed hueGapCheck at 18 h)  // RND fix r1 (art): night #CFD8F4 → #C3D3EE (less red): cream walls read dusk-blue, not lilac-white

/**
 * RND fix r1 (art review: "time of day barely changes the interior"). Two hour-continuous mood terms on top of the
 * §5.0 phase gain sets, both env / prop base light only (key + hemisphere, via the env tint uniform): lamp pools, sun
 * patches, shafts and characters are untouched, so the pools and the golden sun carry the light when the room dims and
 * the clay contract (clayCheck) holds at every hour.
 * - EXPOSURE_KEYS: [hour, multiplier] (piecewise linear, wraps at 24). Full by day; golden hour dims the room to ~0.75 so
 *   the low sun patches / shafts read; after dark the room drops to ~0.5 (a 22 h interior is ~40 % darker in frame luma
 *   than 13 h, with warm lamp pools as the light sources).
 * - Morning (MORNING, `morningWeight`): 6–9 h reads cool and pale instead of a second sunset: flatter light (less key,
 *   a little more sky fill), a pale blue-grey env tint and sky fill, a pale sun (patches through the east windows), and
 *   the `morning` LUT (lifted, slightly desaturated, cool) in place of the warm golden grade.
 */
export const EXPOSURE_KEYS: readonly (readonly [hour: number, mult: number])[] = Object.freeze([[0, 0.46], [5, 0.46], [6, 0.6], [7, 0.8], [8, 0.9], [9.5, 0.97], [11, 1], [15.5, 1], [16.5, 0.94], [17.5, 0.84], [18, 0.74], [18.5, 0.68], [19.25, 0.6], [20, 0.52], [21, 0.47], [24, 0.46]]);
/**
 * RND fix r2 (art review: "at 22 h the characters get no night exposure or lamp light, so they read as unlit stickers
 * pasted on a dim scene"): characters take a softened copy of the hour exposure, 1 − CHAR_EXPO_SOFT × (1 − exposure),
 * so at night (env 0.46) the clay sits at ≈ 0.80, dimmer with the room but still the brightest, most readable thing in
 * it (clayCheck night row: lit ΔE00 < 8). Day (exposure 1) is untouched.
 */
export const CHAR_EXPO_SOFT = 0.37;
/** Character exposure for the env exposure (`exposureAt`). */
export const charExposure = (exposure: number): number => 1 - CHAR_EXPO_SOFT * (1 - exposure);
/**
 * Lamp key / rim on characters (toon.ts HQ_CHAR, RND fix r2): each active pool lamp within CHAR_LAMP_REACH × its reach
 * lights the clay as a small warm source (N·L to the bulb, (1 − q)² falloff, scaled by the phase lamp scale): a key
 * share CHAR_LAMP_KEY on the albedo plus a fresnel rim CHAR_LAMP_RIM toward it, so an agent on a Pit sofa takes the
 * floor lamp's warm edge like the sofa behind it does. The summed term is clamped at CHAR_LAMP_MAX (gain units): with
 * the night char gains × charExposure (≈ 0.8) the per-pixel sum stays ≤ 1.0 + the rim (§5.0 chars invariant).
 */
export const CHAR_LAMP_REACH = 1.35, CHAR_LAMP_KEY = 0.9, CHAR_LAMP_RIM = 1.1, CHAR_LAMP_MAX = 0.24;
/** Env / prop base-light exposure at hour h. */
export function exposureAt(h: number): number {
  h = ((h % 24) + 24) % 24;
  const K = EXPOSURE_KEYS;
  for (let i = 1; i < K.length; i++) if (h <= K[i][0]) { const [h0, v0] = K[i - 1], [h1, v1] = K[i]; return v0 + (v1 - v0) * (h - h0) / (h1 - h0); }
  return K[K.length - 1][1];
}
export const MORNING = Object.freeze({ envTint: '#D5E2F6', envSky: '#DFE9F7', sun: '#FFF6EA', keyK: 0.78, ambK: 1.1 });
/** Morning look weight: 1 over 6.5–8.5 h, fading out by 10 h (0 otherwise). */
export function morningWeight(h: number): number {
  h = ((h % 24) + 24) % 24;
  return ramp01(h, 5.5, 6.5) * (1 - ramp01(h, 8.5, 10));
}
/**
 * LUT blend weights for an hour (post.ts): the phase weights, with the morning look taking its share from each (the
 * golden LUT is the evening one only). Sums to 1.
 */
export function lutWeightsInto(out: LutWeights, h: number): LutWeights {
  const w = phaseWeightsInto(out, h), m = morningWeight(h);
  w.day *= 1 - m; w.golden *= 1 - m; w.night *= 1 - m; w.morning = m;
  return w;
}

/**
 * Phase weights for an hour: day 8–17, golden 6–8 and 17–19, night otherwise; 0.5 h cross-fades so nothing pops
 * when the real clock ticks over.
 * `h` is 0..24; the weights sum to 1.
 */
export function phaseWeights(h: number): PhaseWeights {
  return phaseWeightsInto({ day: 0, golden: 0, night: 0 }, h);
}

/**
 * m2 fix r2 (perf, allocation-free frame): the palette entries are converted to normalised linear RGB once here, and
 * `lightingInto` writes the mixed state into a caller-owned object (lights.ts keeps one and recomputes it only when the
 * hour moves). The old per-call path (hexToRgb + lin + map + norm ≈ 20 arrays) cost ≈ 25 KB of garbage per frame.
 */
const perPhase = <T>(f: (p: Phase) => T): PerPhase<T> => Object.freeze({ day: f('day'), golden: f('golden'), night: f('night') });
const soften = (v: Rgb, k: number): Rgb => [v[0] + (1 - v[0]) * k, v[1] + (1 - v[1]) * k, v[2] + (1 - v[2]) * k];
const PRE = Object.freeze({
  sky: perPhase((p) => norm(lin(HEMI[p].sky))),
  ground: perPhase((p) => norm(lin(HEMI[p].ground))),
  envGround: perPhase((p) => soften(norm(lin(HEMI[p].ground)), ENV_GROUND_SOFTEN)),
  envSky: perPhase((p) => soften(norm(lin(HEMI[p].sky)), ENV_SKY_SOFTEN[p])),
  sunCol: perPhase((p) => norm(lin(SUN_COL[p]))),
  envTint: perPhase((p) => norm(lin(ENV_TINT[p]))),
});
const MORNING_LIN = Object.freeze({ envTint: norm(lin(MORNING.envTint)), envSky: norm(lin(MORNING.envSky)), sun: norm(lin(MORNING.sun)) });
/** a = mix(a, b, k), renormalised to max channel 1 (in place). */
const mixNorm = (a: Rgb, b: Rgb, k: number): void => { let m = 1e-6; for (let i = 0; i < 3; i++) { a[i] += (b[i] - a[i]) * k; if (a[i] > m) m = a[i]; } for (let i = 0; i < 3; i++) a[i] /= m; };
const KEY_COL = Object.freeze(norm(lin(KEY.color)));
const SHADOW_TINT_LIN = Object.freeze(lin(SHADOW_TINT));

/** Phase weights written into `out` (no allocation). */
export function phaseWeightsInto<T extends PhaseWeights>(out: T, h: number): T {
  h = ((h % 24) + 24) % 24;
  let day = 0, golden = 0;
  if (h < 12) {
    golden = ramp01(h, 5.75, 6.25) * (1 - ramp01(h, 7.75, 8.25));
    day = ramp01(h, 7.75, 8.25);
  } else {
    day = 1 - ramp01(h, 16.75, 17.25);
    golden = ramp01(h, 16.75, 17.25) * (1 - ramp01(h, 18.75, 19.25));
  }
  out.day = day; out.golden = golden; out.night = Math.max(0, 1 - day - golden);
  return out;
}
function ramp01(h: number, a: number, b: number): number { return Math.min(1, Math.max(0, (h - a) / (b - a))); }

/** out[i] = Σ_p w_p · tab[p][i], then normalised to max channel 1 (in place). */
function mixNormInto(out: Rgb, w: PhaseWeights, tab: PerPhase<readonly number[]>): Rgb {
  const a = tab.day, b = tab.golden, c = tab.night;
  let m = 1e-6;
  for (let i = 0; i < 3; i++) { const v = w.day * a[i] + w.golden * b[i] + w.night * c[i]; out[i] = v; if (v > m) m = v; }
  for (let i = 0; i < 3; i++) out[i] /= m;
  return out;
}
const mixGain = (w: PhaseWeights, set: 'char' | 'env', k: 'kKey' | 'kAmb' | 'kPts' | 'kSun'): number => {
  const d: Record<string, number> = GAINS.day[set], g: Record<string, number> = GAINS.golden[set], n: Record<string, number> = GAINS.night[set];
  return w.day * d[k] + w.golden * g[k] + w.night * n[k];
};

/** Everything the shaders need for an hour (`lightingAt`). Colours are normalised linear RGB. */
export interface LightingState {
  weights: PhaseWeights;
  phase: Phase;
  char: { kKey: number; kAmb: number; kPts: number };
  env: { kKey: number; kAmb: number; kSun: number };
  lampScale: number;
  sky: Rgb; ground: Rgb; envGround: Rgb; envSky: Rgb; sunCol: Rgb;
  keyCol: Rgb; shadowTint: Rgb; envTint: Rgb;
  sunDir: Rgb;
  exposure: number; charExposure: number; morning: number;
}

/** A fresh lighting state object (the shape `lightingAt` returns); pass it to `lightingInto` to reuse it. */
export function createLightingState(): LightingState {
  return {
    weights: { day: 0, golden: 0, night: 0 },
    phase: 'day',
    char: { kKey: 0, kAmb: 0, kPts: 0 },
    env: { kKey: 0, kAmb: 0, kSun: 0 },
    lampScale: 0,
    sky: [0, 0, 0], ground: [0, 0, 0], envGround: [0, 0, 0], envSky: [0, 0, 0], sunCol: [0, 0, 0],
    keyCol: [...KEY_COL], shadowTint: [...SHADOW_TINT_LIN], envTint: [0, 0, 0],
    sunDir: [0, 1, 0],
    exposure: 1, charExposure: 1, morning: 0,
  };
}

/**
 * Everything the shaders need for an hour, written into `L` (from `createLightingState`); allocation-free.
 */
export function lightingInto<T extends LightingState>(L: T, hour: number): T {
  const w = phaseWeightsInto(L.weights, hour);
  L.phase = w.day >= w.golden && w.day >= w.night ? 'day' : w.golden >= w.night ? 'golden' : 'night';
  L.char.kKey = mixGain(w, 'char', 'kKey'); L.char.kAmb = mixGain(w, 'char', 'kAmb'); L.char.kPts = mixGain(w, 'char', 'kPts');
  L.env.kKey = mixGain(w, 'env', 'kKey'); L.env.kAmb = mixGain(w, 'env', 'kAmb'); L.env.kSun = mixGain(w, 'env', 'kSun');
  L.lampScale = w.day * LAMP_SCALE.day + w.golden * LAMP_SCALE.golden + w.night * LAMP_SCALE.night;
  mixNormInto(L.sky, w, PRE.sky);
  mixNormInto(L.ground, w, PRE.ground);
  mixNormInto(L.envGround, w, PRE.envGround);
  mixNormInto(L.envSky, w, PRE.envSky);
  mixNormInto(L.sunCol, w, PRE.sunCol);
  mixNormInto(L.envTint, w, PRE.envTint);
  // RND fix r1: hour mood (env / props only; see EXPOSURE_KEYS)
  const m = morningWeight(hour);
  L.morning = m;
  L.exposure = exposureAt(hour);
  L.charExposure = charExposure(L.exposure);
  if (m > 0) {
    mixNorm(L.envTint, MORNING_LIN.envTint, m);
    mixNorm(L.envSky, MORNING_LIN.envSky, m);
    mixNorm(L.sunCol, MORNING_LIN.sun, m);
    L.env.kKey *= 1 + (MORNING.keyK - 1) * m;
    L.env.kAmb *= 1 + (MORNING.ambK - 1) * m;
  }
  for (let i = 0; i < 3; i++) { L.keyCol[i] = KEY_COL[i]; L.shadowTint[i] = SHADOW_TINT_LIN[i]; }
  sunDirectionInto(L.sunDir, hour);
  return L;
}

/**
 * Everything the shaders need for an hour (fresh object; tests / probes). Per-frame code uses `lightingInto`.
 */
export function lightingAt(hour: number): LightingState {
  return lightingInto(createLightingState(), hour);
}

/** Unit vector toward a light at (elevation, plan azimuth clockwise from north); world: +x east, −z north. */
export function dirFromAngles(elevDeg: number, azDeg: number): Rgb {
  const e = (elevDeg * Math.PI) / 180, a = (azDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
/** Studio key direction (toward the light): fixed, never follows the clock (§5.0). */
export const KEY_DIR = Object.freeze(dirFromAngles(KEY.elevationDeg, KEY.azimuthDeg));

/** Cosmetic sunrise / sunset hours (M1.75: a late sunset keeps a low sun, ≈ 12°, in the 18 h golden gobo). */
export const SUNRISE = 6, SUNSET = 19.25;
/**
 * Cosmetic sun for sky/gobo/grade: rises east at 6 h, south around 12:40, sets west at 19:15 (below the horizon at
 * night), so golden hour (17–19 h, `phaseWeights`) always has a low warm sun.

 */
export function sunDirection(hour: number): Rgb {
  return sunDirectionInto([0, 0, 0], hour);
}
/** `sunDirection` written into `out` (no allocation). */
export function sunDirectionInto<T extends number[]>(out: T, hour: number): T {
  const t = (hour - SUNRISE) / (SUNSET - SUNRISE); // 0 sunrise … 1 sunset
  const elev = 58 * Math.sin(Math.PI * t) + (t < 0 || t > 1 ? -8 : 0);
  const az = 90 + 180 * t;
  const e = (elev * Math.PI) / 180, a = (az * Math.PI) / 180;
  out[0] = Math.sin(a) * Math.cos(e); out[1] = Math.sin(e); out[2] = -Math.cos(a) * Math.cos(e);
  return out;
}

/**
 * Skylight gobo elevation floor (M1.75 fix r1): the 5.5 m atrium skylight is the only sun aperture the atrium and the
 * Pit have. With the true sun (≈ 17° at 18 h) its patch lands ≈ 18 m away, outside the atrium clip, so golden hour
 * showed no sun at all. The skylight uses the true azimuth with the elevation clamped here: at 13 h the patch sits
 * over the north half of the Pit; from ≈ 16 h it slides east across the Pit and the atrium floor toward the east wall (the
 * §11.5 "patch climbs the atrium's east wall" cue). Windows keep the true sun (they are low, so low sun still lands).
 */
export const GOBO_SKY_MIN_ELEV = 60;   // m175 fix r2: 50° put the 18 h patch 4.4 m east, on the atrium's far edge behind the
// Pit sofas (invisible from pitOverview / spawn); at 60° it lands on the Pit's east half + the atrium ring (≈ 3.2 m east)
export function goboSkyDir(sunDir: readonly number[]): Rgb {
  return goboSkyDirInto([0, 0, 0], sunDir);
}
/** `goboSkyDir` written into `out` (no allocation). */
export function goboSkyDirInto<T extends number[]>(out: T, sunDir: readonly number[]): T {
  const x = sunDir[0], y = sunDir[1], z = sunDir[2], h = Math.hypot(x, z) || 1e-6;
  const minY = Math.sin((GOBO_SKY_MIN_ELEV * Math.PI) / 180);
  if (y >= minY || y < 0.02) { out[0] = x; out[1] = y; out[2] = z; return out; }
  const c = Math.cos((GOBO_SKY_MIN_ELEV * Math.PI) / 180);
  out[0] = (x / h) * c; out[1] = minY; out[2] = (z / h) * c;
  return out;
}

/**
 * §5.0 invariant, per channel: the largest total gain any env pixel can receive at `hour` (key + hemisphere + sun,
 * tinted, plus the night pool cap in every channel, as if a white lamp sat on it). Must stay ≤ 1.14.
 */
export function envGainPeak(hour: number): number {
  const L = lightingAt(hour);
  const pools = LAMP_CAP * L.lampScale * L.weights.night; // as §5.0's table: pools count in the night row (day/golden pools ride under the sun's gobo budget)
  const lamp = norm(lin(LAMP_REF)).map((v) => v ** LAMP_NIGHT_WARMTH);
  return Math.max(...[0, 1, 2].map((c) => L.env.kKey * L.keyCol[c] * L.envTint[c] + L.env.kAmb * Math.max(L.sky[c], L.envGround[c]) * L.envTint[c] + L.env.kSun * L.sunCol[c] + pools * lamp[c]));
}

export interface ShadeOpts { set?: 'char' | 'env'; hour?: number; ny?: number; ndl?: number; keyVis?: number; lamp?: readonly number[]; soft?: number }

/**
 * CPU mirror of the toon lighting (§5.0 formula) for one pixel, linear in/out.
 * `albedo` is linear rgb (returned likewise); `ndl` = half-lambert term (N·L·0.5+0.5), `keyVis` = shadow-map factor
 */
export function shade(albedo: Rgb, { set = 'char', hour = 13, ny = 0, ndl = 1, keyVis = 1, lamp = [0, 0, 0], soft }: ShadeOpts = {}): Rgb {
  const L = lightingAt(hour);
  const s = soft ?? (set === 'char' ? RAMP.softChar : RAMP.softEnv);
  const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const t = ss(RAMP.band0 - s, RAMP.band0 + s, ndl), t2 = ss(RAMP.band1 - s, RAMP.band1 + s, ndl);
  const ramp = (t * 0.7 + t2 * 0.3) * (1 + (keyVis - 1) * 0.85);
  const gains = L[set];
  const env = set === 'env';
  const f = ny * 0.5 + 0.5, lo = env ? ENV_HEMI_FLOOR : 0.55, k = lo + (1 - lo) * f;
  const ground = env ? L.envGround : L.ground, tint = env ? L.envTint.map((c) => c * L.exposure) : [1, 1, 1];
  const at = (i: number): number => {
    const key = gains.kKey * L.keyCol[i] * tint[i] * (L.shadowTint[i] + (1 - L.shadowTint[i]) * ramp);
    const amb = gains.kAmb * (ground[i] + (L.sky[i] - ground[i]) * f) * k * tint[i];
    return albedo[i] * (key + amb + lamp[i]);
  };
  return [at(0), at(1), at(2)];
}
