/**
 * Provenance for merged geometry. Static scenery is merged into a few big meshes for draw calls, which erases which
 * placed object a triangle came from. Merge sites record it instead: name the inputs (`partName`), then call
 * `recordParts(merged, inputs)` and the merged geometry carries `userData.parts`, a list of named draw ranges.
 *
 * Nothing at runtime reads it; dev tools do (`dev/placement.ts`, the placement audit, traces a collision back to
 * "hub-dressing/bench#2" instead of "structures:solid|0|0"). Cost: one small array per merged geometry.
 *
 * Ranges are in elements: index entries for an indexed geometry, vertices otherwise (both are 3 per triangle, and
 * `toNonIndexed()` keeps the element count, so ranges survive the usual facet/merge steps).
 */
import type * as THREE from 'three';

export interface PartRange { name: string; start: number; count: number }

/** Name a geometry before it is merged. Returns it. */
export function partName<G extends THREE.BufferGeometry>(g: G, name: string): G {
  g.userData = { ...g.userData, part: name };
  return g;
}

const elements = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position?.count ?? 0);

/**
 * Record on `merged` which element range came from which named input (nested parts of an input are kept, prefixed
 * with the input's own name). Unnamed inputs without parts leave a gap (they belong to the mesh itself). Does nothing
 * when the element counts do not add up (the merge changed topology).
 */
export function recordParts(merged: THREE.BufferGeometry, inputs: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let at = 0;
  const out: PartRange[] = [];
  for (const g of inputs) {
    const n = elements(g);
    const own = g.userData?.part as string | undefined;
    const sub = g.userData?.parts as PartRange[] | undefined;
    if (sub?.length) {
      let cur = 0;
      for (const p of sub) {
        if (own && p.start > cur) out.push({ name: own, start: at + cur, count: p.start - cur });
        out.push({ name: own ? `${own}/${p.name}` : p.name, start: at + p.start, count: p.count });
        cur = p.start + p.count;
      }
      if (own && cur < n) out.push({ name: own, start: at + cur, count: n - cur });
    } else if (own) out.push({ name: own, start: at, count: n });
    at += n;
  }
  if (at !== elements(merged) || !out.length) return merged;
  // coalesce neighbours with the same name
  const parts: PartRange[] = [];
  for (const p of out) {
    const last = parts[parts.length - 1];
    if (last && last.name === p.name && last.start + last.count === p.start) last.count += p.count;
    else parts.push({ ...p });
  }
  const { part: _own, ...rest } = merged.userData ?? {};
  // a merge of one input may return that input: its own name now lives in the ranges
  merged.userData = inputs.includes(merged) ? { ...rest, parts } : { ...merged.userData, parts };
  return merged;
}

/** The recorded parts of a geometry, if any. */
export const partsOf = (g: THREE.BufferGeometry): readonly PartRange[] | undefined => g.userData?.parts as PartRange[] | undefined;
