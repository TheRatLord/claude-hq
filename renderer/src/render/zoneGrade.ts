/**
 * Per-zone colour script (§5.6 `zoneGrade.ts`): each vis cell has chroma-only `{keyTint, skyTint, groundTint}`
 * (normalised to max channel 1, so the §5.0 gain invariants hold), blended over 1.5 s as the camera changes cell.
 * Applied to environment + props only (toon.ts `uZoneKey/uZoneSky/uZoneGround`): characters keep the clay contract,
 * so no zone grade can push clay past the LUT clamp. Zero extra draws, zero extra programs.
 * Night: the tints are blended 50% toward white (the night ENV_TINT already carries the cool surround).
 * Owner: RND.
 */
import { U } from './uniforms.ts';
import { lin, norm } from './lightMath.ts';
import type { Rgb } from '../../../shared/palette.ts';

/** One zone's tints as sRGB hex (normalised when used). */
export interface ZoneHex { key: string; sky: string; ground: string }
/** Normalised linear tints. */
export interface ZoneTints { key: Rgb; sky: Rgb; ground: Rgb }
type Channel = keyof ZoneTints;
/** The slice of a world layout the stage rects read. */
export interface StageLayout { zones?: readonly { id: string; rect: readonly number[] }[] }
export interface Stage { rect: [number, number, number, number]; desat: number; grade: boolean }

/**
 * Tints per zone (sRGB hex; normalised when used). A zone grade is a mood, not a filter: most are ≤ 8% off white;
 * the Clawd hotspots (LOB/ATR/PIT/BAY/CAF) carry a stronger key correction for the hue-gap rule (cool staging behind
 * Clawds, §5.5, comes mostly from albedo; the grade only nudges).
 */
export const ZONE_GRADE = Object.freeze({
  // hero zones where Clawds gather (§5.5 hue-gap): the studio key (#FFE9D2) is half-neutralised on architecture so
  // cream walls and concrete render near-neutral (C* < 12) behind terracotta bodies; warmth lives in wood + lamps
  LOB: { key: '#E4EEFF', sky: '#FFFFFF', ground: '#EEF2FF' },
  ATR: { key: '#E2EEFF', sky: '#FFFFFF', ground: '#ECF2FF' },
  PIT: { key: '#E2EEFF', sky: '#FFFFFF', ground: '#ECF2FF' },
  LIB: { key: '#FFF5E4', sky: '#F6F8E8', ground: '#F8F1DE' },   // brass-green warmth
  MEZ: { key: '#F4F4FF', sky: '#EEF0FC', ground: '#F4F0F8' },   // dusk navy (the star-map ceiling carries it)
  NAL: { key: '#FFF4E4', sky: '#F8F8EE', ground: '#F8F0E2' },
  STR: { key: '#EEF5F4', sky: '#E6F0F2', ground: '#EAF2EE' },   // cool dusk-teal: warmth only from the string lights
  PLZ: { key: '#F2F7F4', sky: '#EDF4F4', ground: '#EEF4F0' },
  BAY: { key: '#E6EFFF', sky: '#F8FBFF', ground: '#EEF2FF' },   // neutral workrooms, a breath of cool daylight
  WAR: { key: '#FFF6EA', sky: '#FCFAF4', ground: '#FAF2E6' },   // warm paper / cork
  LAB: { key: '#F6FBFF', sky: '#EEF6FF', ground: '#F4F8FA' },   // clean cool
  MAIL: { key: '#FFF4E6', sky: '#FAF8F2', ground: '#F8F0E4' },  // kraft
  ARC: { key: '#FFF5E8', sky: '#F8F6F0', ground: '#F6EEE2' },
  ENG: { key: '#EAF6F6', sky: '#DFF2F2', ground: '#E6F2EE' },   // cool teal + LED spill (pools)
  CAF: { key: '#E6F0FF', sky: '#FAFCFC', ground: '#EAF6F4' },   // neutral, a hint of teal in the ground
  NAP: { key: '#F6F0FF', sky: '#EEEAFA', ground: '#F4F0F8' },   // lavender hush
});
const WHITE: Rgb = [1, 1, 1];
// string-keyed views for lookups by an arbitrary zone id
const GRADE_BY_ID: Readonly<Record<string, ZoneHex | undefined>> = ZONE_GRADE;

/**
 * Eye adaptation for windowless zones (m2 fix r1, §5.0/§5.6): a luminance gain on the env + prop key and sky terms
 * while the camera is in the zone (blended like the tints; characters keep the clay contract; the ground bounce, i.e.
 * the dark ceilings, is left alone). Only zones the sun never reaches (no gobo windows) may take it, and only up to the
 * unused sun budget, counted in luminance: the lit-env gain Y = expo × (kKey·Y(key tint) + kAmb·Y(sky tint)) ≤ 1.14.
 * Studio Street sits in the bay stage, whose cool key tint carries Y 0.85, so noon allows × 1.32 (0.48·0.85 + 0.46)
 * (night: 1.5). At 1.0 the covered lane read murky at noon (lumaStats p50
 * 0.146 < 0.20, floor rendered L* 34 < the 40–50 row).
 */
export const ZONE_EXPO = Object.freeze({ STR: 1.315 });
const EXPO_BY_ID: Readonly<Record<string, number | undefined>> = ZONE_EXPO;
const lumOf = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const STAGE_Y = { key: lumOf(norm(lin('#E2EEFF'))), sky: 1 }; // = STAGE_GRADE (ATR) key / sky, checked in the test
/** Largest gain the invariant allows for env gains (kKey, kAmb) under the stage tints. */
export const expoLimit = (kKey: number, kAmb: number): number => 1.14 / Math.max(1e-3, kKey * STAGE_Y.key + kAmb * STAGE_Y.sky);
export const EXPO_MAX = expoLimit(0.48, 0.46);
export const zoneExpo = (zone: string | null | undefined): number => Math.min(EXPO_MAX, EXPO_BY_ID[zone ?? ''] ?? 1);
/**
 * Night-only eye adaptation (RND fix r3, art review: "the library at 22 h is murky, much darker than the café and the
 * Pit"; night floor L* 13.5 < the §5.0 night row 20–34). After dark no zone takes the sun term (kSun = 0), so the
 * windowed rule above does not apply: a zone may lift its key + sky by up to the night invariant headroom
 * (NIGHT_EXPO_MAX = 1.14 / lit-env Y at the night gains), blended in by the night weight. The Library sits under the
 * mezzanine slab with only two task lamps and a floor lamp: it gets the lift a lamp-lit study reads with.
 */
export const ZONE_EXPO_NIGHT = Object.freeze({ LIB: 1.45 });
const EXPO_NIGHT_BY_ID: Readonly<Record<string, number | undefined>> = ZONE_EXPO_NIGHT;
export const NIGHT_EXPO_MAX = expoLimit(0.44, 0.40);
/** `night` is 0..1. */
export const zoneExpoAt = (zone: string | null | undefined, night: number): number => {
  const d = zoneExpo(zone), n = Math.min(NIGHT_EXPO_MAX, EXPO_NIGHT_BY_ID[zone ?? ''] ?? d);
  return d + (Math.max(d, n) - d) * Math.min(1, Math.max(0, night));
};

/**
 * Complementary staging (§5.5, m175 fix r2): the Clawd hotspots as world xz rects (unions of layout zones). Env + props
 * inside a stage take the STAGE_GRADE tints whatever cell the camera is in (the Pit seen from the mezzanine used the
 * near-neutral MEZ grade and failed hueGapCheck), and warm mid-chroma albedos there are pulled STAGE_DESAT toward grey
 * (toon.ts hqStageAlbedo). Library, mezzanine, war room, lab, mailroom, archive and engine room keep their warmth.
 */
export const STAGES: readonly { zones: readonly string[]; desat: number; grade?: boolean }[] = Object.freeze([
  { zones: ['ATR', 'LOB', 'PIT'], desat: 0.65 },
  { zones: ['W1', 'W2', 'W3', 'STR', 'E1', 'E2', 'E3'], desat: 0.65 },
  { zones: ['CAF', 'NAP'], desat: 0.65 },
  // the Library (and the mezzanine above it, same plan rect) is the backdrop of the Pit seen from the lobby and
  // pitOverview, and Clawds hang out on the mezzanine: a lighter pull (walnut + brass still read as warm wood), and it
  // keeps its own brass-green zone grade (grade: false → a negative pull in uStageDesat, toon.ts)
  { zones: ['LIB'], desat: 0.5, grade: false },
]);
export const STAGE_GRADE = ZONE_GRADE.ATR;

/** World xz rects `{rect: [minX, minZ, maxX, maxZ], desat, grade}` of the stages for a layout (missing zones skipped). */
export function stageRects(layout: StageLayout | null | undefined): Stage[] {
  const out: Stage[] = [];
  for (const { zones: ids, desat, grade = true } of STAGES) {
    const rs = ids.map((id) => layout?.zones?.find((z) => z.id === id)?.rect).filter((r) => !!r);
    if (!rs.length) continue;
    out.push({ rect: [Math.min(...rs.map((r) => Math.min(r[0], r[2]))), Math.min(...rs.map((r) => Math.min(r[1], r[3]))),
      Math.max(...rs.map((r) => Math.max(r[0], r[2]))), Math.max(...rs.map((r) => Math.max(r[1], r[3])))], desat, grade });
  }
  return out;
}
const gradeOf = (zone: string | null | undefined): ZoneHex | null => (zone == null ? null : GRADE_BY_ID[/^[EW]\d$/.test(zone) ? 'BAY' : zone]) ?? null;

/** Normalised linear tints for a zone (white when the zone has no entry). */
export function zoneTints(zone: string | null | undefined): ZoneTints {
  const g = gradeOf(zone);
  if (!g) return { key: WHITE, sky: WHITE, ground: WHITE };
  return { key: norm(lin(g.key)), sky: norm(lin(g.sky)), ground: norm(lin(g.ground)) };
}

/** Cross-fade time constant: ~95% of the way in 1.5 s (§5.6). */
const TAU = 0.5;

const CHANNELS: readonly Channel[] = ['key', 'sky', 'ground'];
function setStage(col: { r: number; g: number; b: number }, st: readonly number[], w: number, gain: number): void {
  col.r = (1 + (st[0] - 1) * w) * gain; col.g = (1 + (st[1] - 1) * w) * gain; col.b = (1 + (st[2] - 1) * w) * gain;
}

export function createZoneGrade() {
  const cur: { [K in Channel]: Rgb } = { key: [...WHITE], sky: [...WHITE], ground: [...WHITE] };
  let zone: string | null = null, target = zoneTints(null), first = true, layout: StageLayout | null | undefined = null, expo = 1, expoT = 1;
  const stage = { key: norm(lin(STAGE_GRADE.key)), sky: norm(lin(STAGE_GRADE.sky)), ground: norm(lin(STAGE_GRADE.ground)) };
  return {
    get zone() { return zone; },
    get expo() { return expo; },
    /** Stage rects from the layout (lights.ts calls it on a layout change). */
    setLayout(l: StageLayout | null | undefined) {
      if (l === layout) return;
      layout = l;
      const rs = stageRects(l);
      U.uStageRect.value.forEach((v, i) => (rs[i] ? v.set(...rs[i].rect) : v.set(0, 0, -1, -1)));
      const d = (i: number) => (rs[i] ? rs[i].desat * (rs[i].grade ? 1 : -1) : 0);
      U.uStageDesat.value.set(d(0), d(1), d(2), d(3));
    },
    /** `night` is 0..1. */
    update(ctx: { camZone?: string | null; rawDt?: number }, night = 0) {
      if (ctx.camZone !== zone) { zone = ctx.camZone ?? null; target = zoneTints(zone); }
      expoT = zoneExpoAt(zone, night);   // RND fix r3: night-only lifts follow the clock
      const k = first ? 1 : 1 - Math.exp(-(ctx.rawDt ?? 0.016) / TAU);
      first = false;
      const w = 1 - 0.5 * night;
      for (let j = 0; j < 3; j++) { const c = CHANNELS[j]; for (let i = 0; i < 3; i++) {
        const t = 1 + (target[c][i] - 1) * w;
        cur[c][i] += (t - cur[c][i]) * k;
      } }
      // a constant per zone (sized on the noon / night gains, see ZONE_EXPO): the golden env gains already run past
      // the invariant globally (lightMath GAINS), and clamping there left the lane at p50 0.15 at 18 h
      expo += (Math.max(1, Math.min(expoT, Math.max(EXPO_MAX, NIGHT_EXPO_MAX * night))) - expo) * k;
      // the gain lifts the key + sky terms fully and the ground bounce by half: the shade-side brick (half ground) comes
      // up to its row while down-facing ceilings (ground only) keep most of their dark §5.5 value
      const ge = 1 + (expo - 1) * 0.5;
      // (m2 fix r2: no per-frame closure / array literal)
      setStage(U.uStageKey.value, stage.key, w, expo);
      setStage(U.uStageSky.value, stage.sky, w, expo);
      setStage(U.uStageGround.value, stage.ground, w, ge);
      U.uZoneKey.value.setRGB(cur.key[0] * expo, cur.key[1] * expo, cur.key[2] * expo);
      U.uZoneSky.value.setRGB(cur.sky[0] * expo, cur.sky[1] * expo, cur.sky[2] * expo);
      U.uZoneGround.value.setRGB(cur.ground[0] * ge, cur.ground[1] * ge, cur.ground[2] * ge);
    },
  };
}
