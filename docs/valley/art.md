# Art direction and the land

The look (low poly, cel shaded, sculpted creatures, the surface library, palette, local light, post, seasons) and the
land package's terrain dressing (strata, ivy, cascades, meadow mosaic, hedgerows, horizon).

Key sources: `scene/toon.ts`, `scene/sculpt.ts`, `scene/surface/` (`index.ts`), `scene/lights/` (`lights.ts`,
`shader.ts`, `emitters.ts`), `scene/post/`, `scene/terrain/` (`terrain.ts`, `features.ts`, `water.ts`, `meadow.ts`,
`horizon.ts`), `scene/flora/` (`ivy.ts`, `scatter.ts`), `world/map.ts` (`terraceHeight`, `clearance`). Paths are
relative to `renderer/src/farm/`.

## Look

* **Low poly + cel shaded.** Faceted geometry (`facet()` in `scene/toon.ts`), `toon()` materials (3-band ramp),
  colours from `PAL`. Merge static geometry per object with vertex colours (`paint()` + `mergeGeometries`); instance
  anything repeated (`InstancedMesh`). Rounded, chunky, slightly exaggerated proportions; nothing razor-thin.
* **Creatures are sculpted, not stacked.** Animals, pets and critters are smooth low-poly hulls from `scene/sculpt.ts`:
  `loft(rings, { paint, coat?, bump?, blend? })` lofts one continuous mesh through a few cross-section rings
  (Catmull-Rom interpolated superellipses with separate up / down radii) with smooth normals (clean cel bands) and a
  faceted silhouette; `blob()` is the ellipsoid shorthand. Paint per face from `Face` (`t` along the spine, `a` around
  it, snapped to the quad so regions follow the mesh edges; use them rather than raw x / y for clean boundaries),
  `blend: true` for soft gradients, `coat` for a per-face tint / pattern mask (`tag` in `scene/plots/rig.ts`, `piece`
  in `scene/life/rig.ts` read it). Pet skins take lofts with `sp(g, null, …)` and `chain` weights so a tail or a leg is
  one hull over several bones. Keep separate pieces for what moves on its own (ears, jaw, eyes, wings) and small
  accents (nostrils, bells, beaks); never build a body out of overlapping balls.
* **Surfaces (texturing):** hand-painted detail comes from the shared surface library `scene/surface/` (read its
  `index.ts` header): tag geometry parts with `tagSurface(g, SURF.planks | shingle | brick | …)` (+ `ensureSurface` on
  untagged parts before merging) and draw with `surfaceMaterial({ vertexColors: true })` or `withSurfaces(material)`.
  It modulates the vertex/palette colour (seasons keep working), is object-space (no swimming), anti-aliased and
  fades with distance. Gallery: `surfaces` (variants per family / per surface, `compare` = off | on).
* **Palette:** warm, saturated, a little dusty. Greens lean yellow; shadows lean blue-purple (the post/grade does
  this). Night is deep blue with warm lamp pools.
* **Outlines + post:** a dark warm outline on silhouettes (post pass), soft bloom on emissives (lamps, "!" markers,
  fireflies), colour grade per time of day, gentle vignette. Keep emissive intensities > 1 only for things meant to glow.
* **Seasons** follow the real month (`ctx.valley.sky.season`): spring blossoms, summer lush, autumn orange/red trees
  (and deep gold, never pale lemon: lemon washes out to khaki under the moon's grade) and pumpkins, winter snow caps and bare trees. Assets take `season` in their build options.
* **Everything alive sways/breathes:** wind service uniforms for foliage; idle squash-and-stretch; nothing freezes.
* **No external assets.** All geometry, textures (canvas), sounds (WebAudio synthesis) and fonts (system) are made
  in code. No downloads, no image/model/audio files.

## Local light (night, dusk, storms)

Lamps, lanterns, windows and fires are real lights, not ground decals.

* Register a `LightEmitter` with the `'lights'` service (`ctx.services.get('lights') as LightsService`, types in
  `scene/context.ts`): `{ pos (world, mutable), color (linear), intensity (~1 = full albedo at the core), radius (m),
  dir? + cone? (window spill), flicker? 0..1, gain? 0..1, when? 'night' | 'always' }`; keep the returned remove fn.
* `scene/lights/lights.ts` packs the nearest frustum-visible emitters into a fixed pool of three.js PointLights /
  SpotLights each frame (no recompiles), and `scene/lights/shader.ts` patches the toon light loop so every
  `MeshToonMaterial` (any package, any hook) shades them as painted, banded warm pools with a soft facing terminator.
  Emitters fade in with `lighting.night` (dusk and storm gloom included).
* Occlusion is cheap and explicit: an emitter with `dir` is wall-mounted (windows, wall lanterns:
  `k.emit({ wall: [nx, ny, nz] }, fn)`) and lights only the half-space in front of its wall (the wall face itself gets
  a soft glow); freestanding lamps are shadowed by building boxes registered with
  `lights.occluder({ x, z, yaw, w, d, y0, y1 })` (the structures system adds the farmhouse, barn, toolshed, silo and
  windmill; each pooled lamp tests its 2 nearest boxes, soft-edged, in the shader).
* Kit glow parts register themselves: `PAL.windowGlow` panes spill a cone out of the window, `PAL.lampGlow` glass
  lights all around (`k.emit(false, fn)` for glow that lights nothing, `k.emit({ radius, intensity }, fn)` to tune).
  Lit glass shows an interior (room gradient, curtains, sill plants, flame cores), peaking just above the night bloom
  threshold so only sources halo.
* Unlit emitters that must stay warm under the night grade (flames, lantern cores): `warmEmitter(material)` from
  `scene/lights/emitters.ts`. Toon pixels write their local-light share to the scene target's alpha for that grade.
  The share is taken against the *unshadowed* sun / moon and weighted by the pool's own strength, and a pool's faint
  outer wash is mostly brightness (`vlTint`), so a cast shadow inside a lamp's reach stays a cool moon shadow instead
  of a brown smudge (the bunting over the cobbles).
* Moon shadows: the night key light never sits lower than ~20° (shadows at most ~2.5× their caster), and on faces it
  only grazes its cast shadow fades out (`vlShadowMix`, `VL_KEY` written by `scene/sky/sky.ts`; off by day), so a low
  moon draws no long stripes down cliff faces (the trail's fence posts).
* Lamp glass (`PAL.lampGlow` boxes) gets a mid-face vertex so the glass shader's flame core shows; rooms dim the unlit
  glass with `setGlass(material, scale, tint)` (smoky amber instead of bright outdoor glass, which read white indoors).

## The land (land package)

* **Rock strata.** The cliff wall steps up in strata (`terraceHeight` in `world/map.ts`, only from the rim + 6 m
  outward and never at the waterfall): level shelves, steep risers, a 1.25 m grid there, the wall's normals leaned
  toward the smooth slope and rock coloured per vertex so ledges read as clean bands. Shelves carry turf; `landB.w`
  (`scene/terrain/terrain.ts` `lipField`) marks riser tops and the shader paints ragged **turf lips** rolling over each
  ledge with a shadow line (`uTurf`: moss green, autumn gold, winter snow; tongues shorten with distance).
* **Shelf life.** Bushes and small pines cling to the shelves; **ivy drapes** (`scene/flora/ivy.ts`) hang in clusters
  (a slow noise picks the heavy ledges, most stay bare): a leafy mat on the shelf rolls over the lip and strands walk
  down the riser against `heightAt` (hugging it, ragged hem, longest mid-curtain), merged into 6 sector meshes (no
  per-frame work; parts `ivy#n` for the audit); summer deep green, autumn muted creeper wine / rust / bronze, winter
  sparse evergreen with frosted mats. **Distance calm** (`IVY_FAR_VERT` / `IVY_FAR_FRAG`): past ~20 m each drape
  fades to its own muted mean colour (`ivyAvg`; autumn warmed toward rust), its leaves grow up to 2× about their
  centres (`ivyC`) and the stems shrink away, so from mid-distance a curtain is one soft patch, not a comb of specks. Outcrops sit on shelves, not stuck to faces.
* **Cascades.** Four little cascades (`TRICKLES` in `scene/terrain/features.ts`, drawn by `water.ts` as one ribbon)
  spill down the strata, white on the risers and glassy across the shelves.
* **Banks.** Steep faces turn to rock on the mountains per face (crisp facets); down in the valley (pad cuts, the
  pond, the windmill hill) the earthy bank blends per vertex from the smoothed slope, softly, with only a hint of the
  cliff pattern (`colourChunk` in `terrain.ts`).
* **Meadow mosaic** (`scene/terrain/meadow.ts`: one value noise shared by GLSL and TS): darker clover drifts, sunny
  bleached patches with rough tall grass, and wildflower drifts (a colour wash from afar, petals up close, seasonal
  colours via `bloomColors`) with clover and flowers planted in the same places.
* **Field structure:** **hedgerows** (overlapping runs, continuous from above) along tracks and round the backs /
  sides of the field sites (now and then a hedgerow tree), dry-stone walls wandering and following tracks, **kerb
  stones** where the roads leave the square, fairy rings of mushrooms and molehill runs. Everything placed keeps
  `clearance()` and is audited ([tools.md](tools.md#placement-audit-npm-run-auditplacement)).
* **Horizon.** Beyond the far tiles a **horizon ring** (`scene/terrain/horizon.ts`, one unlit draw tinted from the
  live fog colour) layers two hazy distant ranges at 650 / 760 m; it shows from up high and through gaps in the rim,
  never over it.
