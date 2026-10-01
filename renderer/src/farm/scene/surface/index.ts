/**
 * Surfaces: hand-painted, procedural surface detail for the whole valley (no image files). Wind Waker / Ghibli
 * style: a few bold value steps — plank seams, shingle rows, brick courses, cobbles, bark ridges, grass strokes,
 * soil clods, rock cracks and strata — painted in the fragment shader over the palette/vertex colour, never
 * replacing it (seasons, `PAL`, instance tints and night lighting keep working). Detail lives in object /
 * instance-local metres (animated parts and instances never swim), fades per feature below ~4 px (no shimmer or
 * moiré) and fine detail fades out past ~55 m (`SURFACE_UNIFORMS.uSurfFar`). Cheap: value noise and one-dot-per-cell
 * patterns; only stones/leaves search 3×3 cells.
 *
 * ## Use it (structures, plots, props)
 * ```ts
 * import { SURF, surfaceMaterial, tagSurface, ensureSurface } from '../surface/index.ts';
 * const wall = tagSurface(paint(new THREE.BoxGeometry(4, 3, 0.2), PAL.wallCream), SURF.plaster);
 * const roof = tagSurface(paint(roofGeo, PAL.roofRed), SURF.tile);            // rows step down the slope (axis 'y')
 * const deck = tagSurface(paint(floorGeo, PAL.plank), SURF.planks, { axis: 'x', variant: 1 });
 * const mesh = new THREE.Mesh(mergeGeometries([wall, roof, deck, ensureSurface(trim)]), surfaceMaterial({ vertexColors: true }));
 * ```
 * Single-surface / instanced meshes can skip tagging: `surfaceMaterial({ vertexColors: true, surface: 'rock' })`.
 * Existing (shared or hooked) materials: `withSurfaces(material, opts)` — it chains after `sway()`/crop hooks.
 * Patch shaders yourself with `chainShader(material, hook, key)` so hooks compose instead of overwriting.
 *
 * ## Tagging (`surface` attribute, vec4: code, scale, strength, aux — see ids.ts)
 * - `tagSurface(g, SURF.x, { axis, variant, scale, strength })` tags every vertex; tag parts in their own local
 *   space, then transform/merge. `tagSurfaceBy(g, (n, c) => …)` tags per triangle (tops vs sides).
 * - `mergeGeometries` needs the attribute on every part: `ensureSurface(part)` (= inherit the material default).
 *   Kit-style builders that strip attributes must keep `surface`.
 * - Axis = the direction the pattern's v runs, projected into each face: 'y' (default) — boards/bark run up,
 *   roof/brick/thatch rows stack up (so rows stay level and step down roof slopes); 'x' | 'z' — along that local
 *   axis (floor boards, a log lying along x); 'h' — horizontal along every face (clapboard siding on all 4 walls).
 * - scale multiplies the pattern size; strength 0..1 per vertex; material `amount` (and `setSurfaceAmount`) on top.
 *
 * ## Surfaces (id: what it paints · variants)
 * grass (blotches, clumps, strokes) · meadow (+ big sunny blotches, flower specks) · soil (tilled furrows across u,
 * ridges along v, clods) · dirt (worn blotches, pebbles, grit) · cobble (rounded pavers, dark joints) · sand (ripples,
 * grit) · pebbles · rock (blotches, cracks + chips, lichen on tops) · cliff (strata ledges, staggered joints, + rock) ·
 * snow (cool drift shadows, crest glints, sparkle) · planks (boards across u, butt joints, grain, knots, nails ·
 * 1 weathered, 2 painted) · logs (end-grain rings on faces looking down the axis — tag with the log's axis; peeled
 * grain on the sides · 1 bark sides) · bark (ridges + furrows · 1 birch lenticels) · shingle (wood rows · 1 mossy) ·
 * tile (clay barrel rows) · thatch (jagged layers, straw) · brick (running bond, light mortar) · fieldstone
 * (irregular stones, deep joints) · plaster (patchy, speckle, hairline cracks) · metal (panels, standing seams,
 * rivets · 1 corrugated, 2 rusty) · fabric (weave, folds, stitched hems) · hay (straw strokes) · leaves (overlapping
 * round clumps: warm lit caps, cool bellies, dark hem shadows, highlight leaves, plus a normal tilt so each clump
 * catches the sun · 1 needles, 2 hanging curtain sprays; build crowns with `foliageBlob`, foliage.ts) · plant (water plants: 0 blades with veins, dark base, bleached tips · 1 fuzzy
 * cattail heads · 2 lily pads with radial veins from the notch, pale heart, dark rim; aux = pad radius). White upward faces (snow caps baked into vertex colours) paint as snow.
 *
 * ## Kit / merged builders (structures, plots)
 * `Kit.add()` style helpers that delete every attribute but `position` must keep `surface` (and tag the part first):
 * `kit.add(tagSurface(new THREE.BoxGeometry(…), SURF.brick), color)` → keep `surface` in the attribute filter, call
 * `ensureSurface` on untagged parts, and give the baked mesh `surfaceMaterial({ vertexColors: true })`. Glow / unlit
 * materials don't take surfaces. Existing hooked materials: `withSurfaces(cropMaterial, { surface: 'soil' })`.
 *
 * ## Custom blends (advanced)
 * `withSurfaces(m, { fragment, surfaces })` replaces the per-vertex dispatcher with your own GLSL (runs after
 * `color_fragment`; the library functions `surf_<name>(SurfIn s, vec3 c)` and helpers are in scope). Build the input
 * with `surfIn(vSurfP, normalize(vSurfN), axis, scale, surfPw(vSurfP), length(vViewPosition), variant, aux)`; ground
 * patterns want `s.uv = vSurfP.xz` and `s.eye = <viewer in uv>` (tufts face the viewer). See terrain.ts (grass,
 * meadow flowers, dirt with ruts, sand + pebbles, cliff, snow, blended by per-vertex weights).
 *
 * ## Knobs
 * `SURFACE_UNIFORMS.uSurfStrength` (global, 0 = off), `uSurfFar` (fine-detail distance), `setSurfaceQuality(q)`
 * ('low' compiles detail out; the terrain system sets it from ctx.quality; safe at runtime). `surfaces: [...]` limits
 * what a material compiles (smaller shader). Programs are shared by (surface set, quality, previous hooks).
 * Dev: `__surfaces.quality('low' | 'high')` in the page A/Bs the cost. Gallery: `surfaces` asset (group terrain):
 * variants = families (all, ground, wood, roofs, walls, made, nature), `compare` (off | on) and one per surface
 * (default, its variants, ×0.6, ×1.6). Cost: ≈ 0.35 ms/megapixel on the 780M (≈ 0.5 ms at 1600×900).
 */
export { SURF, SURF_NAMES, AXIS_CODE, packCode, unpackCode, packSurface, surfIds } from './ids.ts';
export type { SurfId, SurfName, SurfAxis, SurfTag } from './ids.ts';
export {
  SURFACE_UNIFORMS, setSurfaceQuality, surfaceQuality, chainShader, withSurfaces, setSurfaceAmount, surfaceMaterial,
  tagSurface, tagSurfaceBy, ensureSurface,
} from './material.ts';
export type { SurfaceOpts, TagOpts } from './material.ts';
export { SURF_LIB, SURF_FN } from './glsl.ts';
export { foliageBlob } from './foliage.ts';
export type { FoliageColors, FoliageCore, FoliageOpts } from './foliage.ts';
