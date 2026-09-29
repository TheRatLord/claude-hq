/**
 * Material factory (§5.4): `getMaterial(kind, opts?)`. Never construct lit materials elsewhere.
 * - Cached by (kind, flags, colour, emissive, pattern): identical requests share one material object.
 * - Programs are keyed by kind + flags only (`customProgramCacheKey`), so colours / patterns / emissive are uniforms
 *   and many materials share one program (the §5.4 matrix: 12 colour programs + 2 depth programs).
 * - Each material carries `userData.hqKind` and `userData.hqLayer`; post.ts moves meshes onto that layer so
 *   characters render in CharPass after AO and overlays never enter the AO/edge inputs.
 * Owner: RND.
 */
import * as THREE from 'three';
import { CORE, ENV, MISC } from '../../../../shared/palette.ts';
import { LAYERS } from '../layers.ts';
import { U, type UniformMap } from '../uniforms.ts';
import { RAMP } from '../lightMath.ts';
import { PATTERN } from './patterns.glsl.ts';
import { patchToon, displacedDepthMaterial } from './toon.ts';
import { hullMaterial } from './hull.ts';
import { screenMaterial } from './screen.ts';
import { glassMaterial } from './glass.ts';
import { skyMaterial } from './sky.ts';
import { blobMaterial, overlayMaterial } from './overlay.ts';

export { PATTERN };

export const MATERIAL_KINDS = Object.freeze(['toonChar', 'toonProp', 'toonEnv', 'foliage', 'hull', 'screen', 'glass', 'sky', 'blob', 'particle', 'sprite', 'dotmatrix'] as const);
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export interface MaterialOpts {
  instanced?: boolean;
  vertexColors?: boolean;
  /** PatternId (§5.4), a uniform */
  pattern?: keyof typeof PATTERN | number;
  /** palette hex or int (sRGB) */
  color?: string | number;
  /** emissive colour; for 'screen' a number = intensity (≤ 0.95 body text, §5.0) */
  emissive?: string | number;
  /** gain on `emissive` (lamp bulbs 1.8, beacon 2.5, §5.0) */
  emissiveIntensity?: number;
  /**
   * toon kinds: emissive multiplier by day, blended to 1 at night via `uNight` (lamp shades 0 → glow only after dark;
   * bulbs dimmer by day). Default 1.
   */
  emissiveDay?: number;
  /** toonChar rim strength (default 0.35; codex slate 0.52) */
  rim?: number;
  /** toonChar: vertex wobble (WOBBLE program flag) */
  wobble?: boolean;
  /** glass mode (§5.6) */
  reflect?: 'interior' | 'exterior';
  /** screen: status strip colour (null = no strip) */
  strip?: string | number | null;
  /** screen: desk-monitor mode (deskScreens); > 1.5 = tally LED */
  code?: number;
  /** blob: peak alpha (default 0.28) */
  alpha?: number;
  /** extra per-material uniforms (merged into the program's) */
  uniforms?: UniformMap;
}

/** What the factory stores in `material.userData`. */
export interface MaterialUserData {
  hqKind?: MaterialKind;
  hqLayer?: number;
  uniforms?: UniformMap;
  /** displaced (sway / wobble) meshes: the matching shadow depth material */
  depthMaterial?: THREE.Material;
}
/** An object that may carry a material and a geometry (Mesh, InstancedMesh, Points, Line, Sprite…); three's Object3D declares neither. */
export interface Drawable extends THREE.Object3D {
  material?: THREE.Material | THREE.Material[] | null;
  geometry?: THREE.BufferGeometry;
}

/** Typed view of a material's `userData` (the one cast: three types it `Record<string, any>`). */
export const materialData = (m: THREE.Material): MaterialUserData => m.userData as MaterialUserData;

const DEFAULT_COLOR: Record<MaterialKind, string> = {
  toonChar: CORE.clay, toonProp: ENV.oak, toonEnv: ENV.wallCream, foliage: ENV.moss, hull: CORE.ink, screen: CORE.ink2,
  glass: ENV.skyTop, sky: ENV.skyTop, blob: CORE.ink, particle: MISC.trim, sprite: MISC.trim, dotmatrix: ENV.butter,
};
const LAYER_OF: Record<MaterialKind, number> = {
  toonChar: LAYERS.CHARS, hull: LAYERS.HULLS, toonProp: LAYERS.PROPS, toonEnv: LAYERS.ENV, foliage: LAYERS.PROPS,
  screen: LAYERS.PROPS, glass: LAYERS.ENV, sky: LAYERS.ENV, blob: LAYERS.OVERLAY, particle: LAYERS.OVERLAY,
  sprite: LAYERS.OVERLAY, dotmatrix: LAYERS.PROPS,
};

const cache = new Map<string, THREE.Material>();

const flagsOf = (kind: MaterialKind, o: MaterialOpts): string[] => {
  const f: string[] = [];
  if (o.instanced) f.push('INSTANCED');
  // m2 fix r1 (§5.4 program matrix): lit env / prop / foliage programs are always VCOL, so a caller that passes no
  // vertex colours shares the one program instead of compiling a second variant (post.ts gives such geometry a
  // white colour attribute once, at its layer sweep)
  if (o.vertexColors || kind === 'toonProp' || kind === 'toonEnv' || kind === 'foliage') f.push('VCOL');
  if (kind === 'foliage') f.push('SWAY');
  if (kind === 'toonChar' && o.wobble) f.push('WOBBLE');
  return f;
};

export function getMaterial(kind: MaterialKind, opts: MaterialOpts = {}): THREE.Material {
  if (!MATERIAL_KINDS.includes(kind)) throw new Error(`getMaterial: unknown kind ${kind}`);
  const color = new THREE.Color(opts.color ?? DEFAULT_COLOR[kind]);
  const pattern = typeof opts.pattern === 'string' ? PATTERN[opts.pattern] ?? 0 : opts.pattern ?? 0;
  const flags = flagsOf(kind, opts);
  const key = [kind, flags.join('+'), color.getHexString(), opts.emissive ?? '', opts.emissiveIntensity ?? '', opts.emissiveDay ?? '', pattern, opts.rim ?? '', opts.reflect ?? '', opts.uniforms ? Math.random() : ''].join('|');
  let m = cache.get(key);
  if (m) return m;
  m = build(kind, color, pattern, flags, opts);
  m.name = `hq:${kind}`;
  const data = materialData(m);
  data.hqKind = kind;
  data.hqLayer = LAYER_OF[kind];
  const progKey = `hq|${kind}|${flags.join('+')}`;
  m.customProgramCacheKey = () => progKey;
  cache.set(key, m);
  return m;
}

function build(kind: MaterialKind, color: THREE.Color, pattern: number, flags: readonly string[], opts: MaterialOpts): THREE.Material {
  const defines: Record<string, string> = {};
  for (const f of flags) if (f === 'SWAY' || f === 'WOBBLE') defines[`HQ_${f}`] = '';
  switch (kind) {
    case 'toonChar': case 'toonProp': case 'toonEnv': case 'foliage': {
      const m = new THREE.MeshLambertMaterial({ color, vertexColors: flags.includes('VCOL') });
      if (opts.emissive !== undefined) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
      defines[kind === 'toonChar' ? 'HQ_CHAR' : kind === 'toonEnv' ? 'HQ_ENV' : 'HQ_PROP'] = '';
      const soft = kind === 'toonChar' ? RAMP.softChar : kind === 'toonEnv' ? RAMP.softEnv : RAMP.softProp;
      const local = {
        uSoft: { value: soft },
        uRim: { value: kind === 'toonChar' ? opts.rim ?? 0.35 : 0 },
        uSheen: { value: kind === 'toonChar' ? 0.15 : 0 },
        uDesat: { value: 0 },
        uFlash: { value: 0 },
        uWobble: { value: 1 },
        uPattern: { value: pattern },
        uEmisDay: { value: opts.emissiveDay ?? 1 },
        ...opts.uniforms,
      };
      materialData(m).uniforms = local;
      patchToon(m, { kind, defines, local });
      if (defines.HQ_SWAY || defines.HQ_WOBBLE) materialData(m).depthMaterial = displacedDepthMaterial(defines);
      return m;
    }
    case 'hull': return hullMaterial(color, opts);
    case 'screen': return screenMaterial(color, opts);
    case 'glass': return glassMaterial(color, opts);
    case 'sky': return skyMaterial(opts);
    case 'blob': return blobMaterial(color, opts);
    case 'particle': case 'sprite': return overlayMaterial(color, opts, kind);
    case 'dotmatrix': return screenMaterial(color, { ...opts, emissive: opts.emissive ?? 1.3 });
  }
  throw new Error(kind);
}

/** Apply a displaced mesh's matching depth material (§5.1). Call after creating a foliage / wobble mesh that casts. */
export function applyDepthMaterial<M extends THREE.Mesh>(mesh: M): M {
  const d = Array.isArray(mesh.material) ? undefined : mesh.material && materialData(mesh.material).depthMaterial;
  if (d) mesh.customDepthMaterial = d;
  return mesh;
}

/**
 * One representative material per program key (`hq|kind|flags`) the factory has handed out so far (RND fix r1):
 * post.ts's boot warm-up compiles a hidden dummy for each key the scene did not already compile.

 */
export function programVariants(): Map<string, THREE.Material> {
  const out = new Map<string, THREE.Material>();
  for (const m of cache.values()) { const k = m.customProgramCacheKey(); if (!out.has(k)) out.set(k, m); }
  return out;
}

/** Number of distinct cached materials (debug). */
export const materialCount = () => cache.size;
/** Shared uniforms (read-only for other WPs; e.g. `uTime`). */
export const sharedUniforms = U;
