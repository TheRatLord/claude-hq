/**
 * Cel-shading materials and the valley palette. Every mesh in the game uses these so the look stays coherent:
 * flat-shaded low poly, 3-band toon ramp, vertex colours where one mesh needs several colours.
 */
import * as THREE from 'three';
import './lights/shader.ts';

/** The palette. Warm, saturated, a little dusty. Add colours here instead of inlining hex in systems. */
export const PAL = Object.freeze({
  grass: 0x7fb84e, grassDark: 0x5c9a3c, grassDry: 0xb9b85a, meadow: 0x93c45a,
  dirt: 0xa77b4f, dirtDark: 0x7a5534, soil: 0x6b4a2f, soilWet: 0x4f3622, sand: 0xe0c98f,
  rock: 0x9a958c, rockDark: 0x6f6a64, cliff: 0x8c8476, snow: 0xf4f6fa,
  water: 0x4aa3c9, waterDeep: 0x2d6f96, foam: 0xe8f6ff,
  wood: 0xa0703f, woodDark: 0x6e4a2a, woodLight: 0xcf9c63, plank: 0xb98555,
  roofRed: 0xc2533e, roofBlue: 0x4f78a8, roofGreen: 0x5f8f4a, roofBrown: 0x8a5a3a,
  wallCream: 0xf1e3c4, wallWhite: 0xf6f1e6, wallRed: 0xb8483a, stone: 0xb7b0a3,
  leaf: 0x5fa64a, leafDark: 0x3f7f3a, leafAutumn: 0xe0903a, leafAutumn2: 0xd0573a, leafSpring: 0x8fd06a, pine: 0x3d7a4f,
  trunk: 0x7a5236, bark: 0x5e3f28,
  wheat: 0xe8c45a, pumpkin: 0xe8812f, cabbage: 0x8fcf6a, sunflower: 0xf6c830, sunflowerCore: 0x6b3f1f,
  apple: 0xd83a36, grape: 0x7a3f8f, berry: 0x3f5fbf, strawberry: 0xe0404a,
  hay: 0xe3c86a, metal: 0x9aa4ad, metalDark: 0x5a646e, rust: 0xa65a36,
  cloth: 0xe8dcc8, red: 0xd9453b, blue: 0x3f78c8, yellow: 0xf2c33a, green: 0x5cae4f, purple: 0x8e5fc2, pink: 0xf08aa8, orange: 0xef8a2f,
  skin: 0xf2c6a0, skinTan: 0xd9a27a, skinDark: 0x9a6a4a,
  white: 0xffffff, black: 0x22201e, ink: 0x2b2420,
  lampGlow: 0xffc566, windowGlow: 0xffd27a, fire: 0xff8a2a,
  alert: 0xffd23a, alertRed: 0xff4a3a, ok: 0x6ad16a,
});

/** Workspace colours by `colorIndex` (fence ribbons, sign paint, scarf of the plot's farmers). */
export const WORKSPACE_COLORS: readonly number[] = [0xe0574a, 0xf09a3a, 0xf2cf4a, 0x6cc25a, 0x4fb3c8, 0x5a7fd6, 0x9a6ad0, 0xe07ab0];

let rampCache: THREE.DataTexture | null = null;
/** 3-band toon ramp: shadow, mid, lit. Nearest filtering keeps the bands crisp. */
export function toonRamp(): THREE.DataTexture {
  if (rampCache) return rampCache;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  rampCache = t;
  return t;
}

const matCache = new Map<string, THREE.MeshToonMaterial>();

export interface ToonOpts {
  vertexColors?: boolean;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** share the instance (default true); pass false for materials you will animate */
  shared?: boolean;
}

/** Shared toon material by colour/options. Do not mutate a shared one; ask for `shared: false` instead. */
export function toon(color: number = 0xffffff, o: ToonOpts = {}): THREE.MeshToonMaterial {
  const key = `${color}|${o.vertexColors ? 1 : 0}|${o.emissive ?? 0}|${o.emissiveIntensity ?? 1}|${o.transparent ? o.opacity ?? 1 : 1}|${o.side ?? 0}`;
  if (o.shared !== false) { const m = matCache.get(key); if (m) return m; }
  const m = new THREE.MeshToonMaterial({
    color, gradientMap: toonRamp(), vertexColors: !!o.vertexColors,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide,
  });
  // MeshToonMaterial has no flatShading: faceting comes from the geometry (see `facet`)
  if (o.shared !== false) matCache.set(key, m);
  return m;
}

/** Faceted low-poly look: split vertices per face so normals are flat (toon materials cannot flat-shade). */
export function facet(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  f.computeVertexNormals();
  return f;
}

/** Unlit colour (glows, markers, sky bits). */
export function unlit(color: number, o: { transparent?: boolean; opacity?: number; depthWrite?: boolean; fog?: boolean } = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: o.depthWrite ?? true, fog: o.fog ?? true });
}

/** Paint every vertex of a (non-indexed or indexed) geometry one colour, for merging multi-colour meshes. */
export function paint(g: THREE.BufferGeometry, color: number | THREE.Color): THREE.BufferGeometry {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
