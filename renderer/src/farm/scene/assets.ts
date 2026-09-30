/**
 * Asset registry. Every buildable thing (structures, props, plants, animals, farmers, fx) registers here so the
 * gallery (/gallery/) can show it in isolation, turn it, scrub its animation and screenshot it.
 * Systems build through the same `build` functions, so what the gallery shows is what the valley uses.
 */
import type * as THREE from 'three';
import type { Season } from '../model/types.ts';

export type AssetGroup = 'structure' | 'prop' | 'plant' | 'crop' | 'animal' | 'character' | 'fx' | 'terrain';

export interface AssetBuildOpts {
  seed: number;
  season: Season;
  /** one of `variants` when the asset has any */
  variant?: string;
  /** 0 day … 1 night (lamps, windows) */
  night?: number;
}

export interface AssetDef {
  name: string;
  group: AssetGroup;
  /** one line for the gallery */
  note?: string;
  variants?: readonly string[];
  build(o: AssetBuildOpts): THREE.Object3D;
  /** drive the asset's own animation in the gallery (t seconds, param 0..1 = a gauge / growth slider) */
  animate?(obj: THREE.Object3D, t: number, dt: number, param: number): void;
  /** label for the gallery slider driving `param` (e.g. 'CPU', 'growth') */
  param?: string;
}

const registry = new Map<string, AssetDef>();

export function defineAsset(def: AssetDef): AssetDef {
  if (registry.has(def.name)) console.warn(`[assets] redefined ${def.name}`);
  registry.set(def.name, def);
  return def;
}
export const listAssets = (): AssetDef[] => [...registry.values()];
export const getAsset = (name: string): AssetDef | undefined => registry.get(name);
