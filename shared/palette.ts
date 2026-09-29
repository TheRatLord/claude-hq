// @pure
/**
 * Every colour token in Claude HQ (ART §2 as amended by DESIGN §5.5) + CIEDE2000 helpers.
 * sRGB hex strings. Feature code never hard-codes hex: import a token from here.
 * Owner: LEAD. Pure (no three, no node built-ins).
 */

import type { Kind, Status } from './protocol.ts';

/** Colour-space triples: sRGB / linear RGB in 0..1, CIELAB, and CIELCh (h in degrees). */
export type Rgb = [r: number, g: number, b: number];
export type Lab = [L: number, a: number, b: number];
export type Lch = [L: number, C: number, h: number];

/** ART §2.1 core (brand + neutrals). */
export const CORE = Object.freeze({
  clay: '#D97757',
  clayDeep: '#B8593B',
  clayLight: '#EBA283',
  cream: '#F4EDE3', // UI-only (DOM, bubbles, LUT fixed point): L* 94 > albedo cap. Lit "cream" = wallCream / trim (D1)
  paper: '#FBF8F3', // unlit UI / bubbles only (albedo cap, §5.0)
  oat: '#E4D9C8',
  sand: '#CDBFA8',
  ink: '#1F1E1D',
  ink2: '#3A3733',
  slate: '#6B6760', // UI muted text; NOT the codex body (bodySlate)
});

/** ART §2.2 environment accents. */
export const ENV = Object.freeze({
  wallCream: '#DBD0C3', // lit cream walls / large cream surfaces, L* 84 (§5.5 value map "82 cream" ±4; D1)
  oak: '#C79A6B',
  walnut: '#7B5238',
  sage: '#9DB38F',
  moss: '#5F7F5B',
  teal: '#5E9EA0',
  tealDeep: '#2F5E62',
  butter: '#F1C66E',
  lavender: '#A99BD3',
  rose: '#E3A0A0', // cushions; NOT the other-LLM body (bodyRose)
  skyTop: '#8EC3E6',
  skyHorizon: '#FCE3C4',
});

/** ART §2.3 status colours (bright, the only saturated emissives). */
export const STATUS = Object.freeze({
  working: '#4FA3E8',
  blocked: '#EF5A4C',
  done: '#63C48A',
  idle: '#B3AA9D',
  unknown: '#A98BE0',
  shell: '#7FE3A0',
  shellBusy: '#F4B860',
});

/** DESIGN §5.5 workspace palette; index = `workspace.colorIndex`. Deep matte jewels, never emissive. */
export const WORKSPACE = Object.freeze([
  Object.freeze({ token: 'bronze', hex: '#946A1C' }),
  Object.freeze({ token: 'olive', hex: '#6B7A2A' }),
  Object.freeze({ token: 'pine', hex: '#1E7A74' }),
  Object.freeze({ token: 'indigo', hex: '#4B4FA6' }),
  Object.freeze({ token: 'plum', hex: '#7E3F8C' }),
  Object.freeze({ token: 'raspberry', hex: '#A8385E' }),
  Object.freeze({ token: 'forest', hex: '#2F5A34' }),
  Object.freeze({ token: 'cocoa', hex: '#6B3F24' }),
]);
export const WORKSPACE_COUNT = WORKSPACE.length;

/** DESIGN §5.5 agent-kind bodies. */
export const BODY = Object.freeze({
  bodyClay: '#D97757',
  bodySlate: '#4D4B52',
  bodyRose: '#C98FA0',
  bodyPebble: '#77736E',
});

/** Entity.kind → body token name. */
export const KIND_BODY = Object.freeze({
  claude: 'bodyClay',
  codex: 'bodySlate',
  gemini: 'bodyRose',
  agent: 'bodyPebble',
});

/** Misc contract colours from DESIGN §5.0–5.6 / §6.7 / §7.5. */
export const MISC = Object.freeze({
  trim: '#EFE6D6', // accessory paper/cream trim (§5.5), also cycle>0 stripes
  whiteboard: '#EDE6DA', // oat-light: whiteboards, task placards (§5.0, §6.7)
  codexHull: '#141210', // ink at 60% value (§5.5)
  clayShadow: '#A1544B', // clayCheck shadow target (§5.0)
  keyLight: '#FFE9D2', // studio key colour (§5.0)
  fillLight: '#AAA5DC', // fill (§5.0)
  sunGolden: '#FFC58F', // golden-hour sunCol (§5.0)
  aoColor: '#3A2A30', // N8AO colour (§5.1)
  blockedOutline: '#7A2A20', // pulsing outline partner of ink (§5.6)
  subsurface: '#C0503A', // polymer-clay terminator tint (§5.6)
  glassCeiling: '#F2E7D6', // interior glass reflection gradient top (§5.6)
  glassFloor: '#8A6A4C', // interior glass reflection gradient bottom (§5.6)
  queueMat: '#4E6E6E', // LOB slate-teal (§5.5 value map)
  pitRug: '#2F5F5A',
  pitSofa: '#7E9A86',
  // STR (RND m2 r1; ratified by LEAD m2 fix r2, §5.5 value map note): +3.5 L* inside the ±4 band (same hue/chroma): at
  // 40 / 62 the covered street rendered floor L* 34 and shade-side brick 45, under the §5.0 rows (40–50 / 55–65).
  // palette.test.ts pins them to the band; any further lift is STR lighting (§5.6), not albedo.
  strPavers: '#5F6A64', // L* 44 (value map 40 ± 4)
  strBrick: '#97A396', // L* 66 (62 ± 4)
  strMortar: '#77827A', // L* 53.5
  bayCarpet: '#6F8784',
  cafTerrazzo: '#5F7A74',
});

/**
 * docs/design/ui-kit.md §2: the DOM UI kit's derived group ("Workshop Signage"). No new hues: every value is a shade
 * of a CORE / ENV / STATUS colour. `ui/kit/tokens.ts` emits it as CSS custom properties (`--<kebab-name>`); nested
 * groups get a prefix (`onBoard.blocked` → `--b-blocked`, `onPaper.blocked` → `--i-blocked`, `fit.enamelHi` →
 * `--f-enamel-hi`). Contrast (board #221F1C / paper #FBF8F3): t1/t2/t3 14.1/8.1/5.3, p1/p2/p3 15.7/7.1/4.9,
 * onBoard 7.2–11.7, onPaper 5.0–5.6 : 1. Feature code in renderer/src/ui/** never hard-codes hex (kit lint test).
 */
export const UI = Object.freeze({
  board: '#221F1C', boardLo: '#1A1816', boardHi: '#2C2824', glass: '#141312', crt: '#1A1917',
  walnut: '#7B5238', walnutLo: '#3D2819',
  brass: '#C9A15A', brassHi: '#EBCB8A', brassLo: '#8A6A34', enamel: '#2F5E62',
  clayInk: '#9A4A2E', // clay text on paper (5.8:1)
  t1: '#F4EDE3', t2: '#BFB5A7', t3: '#9A9186', // text on board
  p1: '#1F1E1D', p2: '#5A544D', p3: '#756C61', // text on paper
  onBoard: Object.freeze({ blocked: '#FF8A7C', working: '#8CC4F2', done: '#8FD9AB', shell: '#9FEAB9', busy: '#F6C98A', unknown: '#C9B6F0' }),
  onPaper: Object.freeze({ blocked: '#B8332A', working: '#2C6DAA', done: '#2A7A4C', busy: '#8A5A12', unknown: '#6A4FA8' }),
  rule: 'rgba(94,158,160,.30)', stitch: 'rgba(90,84,77,.30)',
  /** Fitting shades (gradient stops, lips, edges) the kit's materials are drawn with. Shades only, no new hues. */
  fit: Object.freeze({
    boardTop: '#26221F', boardBot: '#1E1B19', rimDark: '#140F0B', groove: '#0E0C0B',
    walnutHi: '#8A5D40', walnutMid: '#5F3F2A', rod: '#6A5A44', rodHi: '#B9A27A',
    paperLo: '#F3ECE0', edge1: '#E0D5C4', edge2: '#D2C5B1', deck1: '#EDE4D5', deck2: '#DCCFBB', graph: '#F4EDE1',
    enamelHi: '#3A6F73', enamelLo: '#27504F', enamelLip: '#1B3A3C', enamelPort: '#5B8F93',
    clayHi: '#E08A6C', clayMid: '#C8674A', clayGlow: '#F3B39A', clayKeyHi: '#FDF1EA', clayKeyLo: '#F3D2C3', clayTrack: '#3A1D14',
    butterHi: '#F6D68E', butterLo: '#E1B458', butterLip: '#B98C3A', butterDeep: '#C9962F', butterBulb: '#FFF2C4', postitHi: '#F6D992', postitLip: '#D9A94A', postitInk: '#3D2F12',
    keyLip: '#B9A98E', lampIdle: '#8A8176', lampIdleGlass: '#2A2724', shellGlass: '#0F1A13',
    tabRail: '#141210', tabRailLo: '#1A1815', tabHi: '#2C2824', tabLo: '#24211E', tabOn: '#2A2622',
    alarmHi: '#4A1712', alarmLo: '#2A0F0C', alarmWord: '#FFC2B8', clasp: '#5B4520',
    shellPortHi: '#6C6F5E', shellPortLo: '#3E4237', cubbyHi: '#171513', cubbyLo: '#24201D',
    sprocket: '#3A2F25', printInk: '#2A2825', backdrop: '#2A2622', sheetBgHi: '#D8CDBF', sheetBgLo: '#CFC3B3', sheetInk: '#5A4A3A',
  }),
});

/**
 * ART §9.3: the drawer xterm theme (matches the in-world monitors). Moved here verbatim from ui/terminal/view.ts so
 * ui/** holds no hex (ui-kit.md §6 rule 15); the terminal itself is unchanged.
 */
export const XTERM = Object.freeze({
  background: '#1A1917', foreground: '#ECE6DC', cursor: '#D97757', cursorAccent: '#1A1917', selectionBackground: '#D9775755',
  black: '#2A2825', red: '#E5695B', green: '#7FC98F', yellow: '#E8C06A', blue: '#6FA8DC', magenta: '#C58FD0', cyan: '#6FC2BE', white: '#D9D2C7',
  brightBlack: '#6B6760', brightRed: '#F08A7D', brightGreen: '#9FDDAC', brightYellow: '#F2D48E', brightBlue: '#93C0E8', brightMagenta: '#D8AEE0', brightCyan: '#95D6D2', brightWhite: '#FBF8F3',
});

/** The UI's procedural 2D portraits (ui/dom.ts portraitSvg / adaSvg): Shelly's CRT shell and the face inks. Moved
 *  here verbatim so ui/** holds no hex (ui-kit.md §6 rule 15). */
export const PORTRAIT = Object.freeze({
  shellCase: '#E6DCC6', shellBase: '#CFC3AA', shellGlass: '#1A1917', shellFeet: '#8A8278',
  ink: '#1F1E1D', eyeGlint: '#FBF8F3', blush: '#F0907C', adaBody: '#E6DAC6',
});

/** Flat lookup of every named token → hex (workspace tokens by name too). */
export const PALETTE = Object.freeze({
  ...CORE,
  ...ENV,
  ...Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [`status_${k}`, v])),
  ...Object.fromEntries(WORKSPACE.map((w) => [`ws_${w.token}`, w.hex])),
  ...BODY,
  ...MISC,
});

export function statusColor(status: Status | 'shell' | 'shellBusy'): string {
  return STATUS[status] ?? STATUS.unknown;
}

export function workspaceColor(colorIndex: number): string {
  const n = WORKSPACE_COUNT;
  return WORKSPACE[((colorIndex % n) + n) % n].hex;
}

/** Body colour for an Entity.kind (null for shells). */
export function kindBodyColor(kind: Kind): string | null {
  if (kind === 'shell') return null; // Shelly has its own CRT look
  return BODY[KIND_BODY[kind] ?? 'bodyPebble'];
}

// ---------------------------------------------------------------------------------------------
// Colour math

/** '#RRGGBB' → 0xRRGGBB (for three's Color.setHex). */
export function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** '#RRGGBB' → [r,g,b] in 0..1 (sRGB-encoded). */
export function hexToRgb(hex: string): Rgb {
  const n = hexToInt(hex);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB-encoded channel → linear. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear channel → sRGB-encoded. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Relative luminance Y (0..1) of a hex colour. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
}

const D65 = [0.95047, 1.0, 1.08883];
const labF = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** Linear sRGB [r,g,b] → CIELAB [L,a,b] (D65). */
export function linearRgbToLab([r, g, b]: Rgb): Lab {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / D65[0];
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / D65[1];
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / D65[2];
  const fx = labF(x), fy = labF(y), fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** '#RRGGBB' → CIELAB [L,a,b]. */
export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex);
  return linearRgbToLab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
}

/** CIELAB → [L, C, h°] (h in 0..360). */
export function labToLch([L, a, b]: Lab): Lch {
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(a, b), h];
}

/** '#RRGGBB' → [L, C, h°]. */
export function hexToLch(hex: string): Lch {
  return labToLch(hexToLab(hex));
}

/** Smallest absolute hue difference in degrees (0..180). */
export function hueGap(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * CIEDE2000 colour difference (Sharma, Wu & Dalal 2005), kL = kC = kH = 1.
 */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const Cb7 = Math.pow(Cb, 7);
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (b: number, ap: number): number => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp: number;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
  else hbp = (h1p + h2p - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Cbp7 = Math.pow(Cbp, 7);
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)));
  const Lb50 = Math.pow(Lbp - 50, 2);
  const Sl = 1 + (0.015 * Lb50) / Math.sqrt(20 + Lb50);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** ΔE00 between two hex colours. */
export function deltaE(hex1: string, hex2: string): number {
  return deltaE2000(hexToLab(hex1), hexToLab(hex2));
}

/**
 * Pair metrics used by the §5.5 separation checks; `dh` = LCh hue gap in degrees.
 */
export function separation(hex1: string, hex2: string): { dE: number; dL: number; dh: number } {
  const a = hexToLch(hex1), b = hexToLch(hex2);
  return { dE: deltaE(hex1, hex2), dL: Math.abs(a[0] - b[0]), dh: hueGap(a[2], b[2]) };
}
