# Claude Valley — design brief

A cozy, first-person, low-poly, cel-shaded farm valley where your coding agents (Claude Code, Codex, … running in
herdr panes) are little farmers. You walk the valley to see what everyone is doing, who's stuck, and who needs you —
and every agent is always one click away from its real terminal, however far away its farmer is standing.

Think Stardew Valley's warmth and density, A Short Hike's charm, Animal Crossing's villagers acknowledging you,
Zelda: Wind Waker's toon light. **Genuinely usable first, adorable second, and never at the cost of the first.**

## Layers (enforced by `renderer/src/farm/layers.test.ts`)

```
server/ (herdr → Entity wire protocol, unchanged)
  └─ renderer/src/net/store.ts           the only WebSocket user
       └─ farm/source.ts                  store → ValleySource adapter + AgentPort (the ONLY net importers, with main.ts)
            └─ farm/model/  (pure)        ValleyState: farmers, helpers, plots, letters, gauges, sky, events
            └─ farm/world/  (pure)        the land: heightAt, SITES, STRUCTURES, PATHS, RIVER, POND, spots
                 └─ farm/scene/           three.js systems; read ValleyState + world, publish services
                 └─ farm/hud/             DOM overlays; get a HudNet port injected (never import net/)
                 └─ farm/audio/           WebAudio synthesis
```

The visuals are detachable: anything that produces a `ValleySource` (live store, a recording, a fake) drives the
whole valley. Scene/HUD code must only use `ValleyState` (`ctx.valley`), `ValleyEvent`s (`ctx.onValley`), and the
ports (`ctx.agents: AgentPort`, `ctx.ui: UiPort`). Never read Entity fields in presentation code; if you need
something the model does not expose, add it to `model/types.ts` + `model/valley.ts` (pure, tested) — coordinate via
the lead.

## Lore (use it in copy, signs, letters, tooltips)

* **Workspace = field.** Opening a herdr workspace tills a new field on a free plot site: the soil turns, fence posts
  drop in, a sign with the workspace name pops up, seedlings sprout (`tilling`). While agents work it grows lush
  (`thriving` → `growing`); left alone for an hour it goes golden and sleepy (`resting`). Closing the workspace brings
  the harvest cart (`harvest`); the soil then rests `fallow` with a little "Fallow — resting" sign until the slot is
  reclaimed; after that the site returns to wild meadow.
* **Agent = farmer.** Each agent pane is a farmer who works its workspace's field. Farmers are 3D voxel versions of
  the agents' mascots: Claude agents are **Clawd** (Claude Code's orange 8-bit crab: block body, two eye notches, arm
  nubs, four stubby legs); Codex agents are a voxel **Codex cloud** (scalloped blob with a `>_` prompt face). A tiny tier
  hat and a workspace-colour neckerchief are the only farm dressing; the mascot silhouette is sacred. Shell panes are **scarecrows**
  (helpers) whose lantern is lit while a process runs; a green/red ribbon shows the last exit.
* **Subagents = ducklings** that waddle in a line behind their farmer and go home (to the pond) when done.
* **Needs you (blocked)** = the farmer runs to the gate, hops, waves both arms, a big bouncing golden **!** above them,
  a letter lands in the mailbox, the farmhouse bell rings once.
* **Done** = proud, basket of produce, a gentle ✓ sparkle; waves when you pass.
* **Commit** = carries a crate to the shipping bin by the farmhouse. **Tests pass** = little celebration.
  **Test fail / error** = drops the watering can, "oops" puff, dusts off.
* **Struggle** = sweat drops, crows circling the field, head scratching.
* **System stats live in the landmarks:** windmill blade speed = CPU; water tower gauge/level = RAM; silo fill
  window = disk; farmhouse chimney smoke = disk IO; carrier pigeons between the farmhouse loft and the valley =
  network; a big thermometer on the barn = temperature; the greenhouse-glow / barn lantern = GPU. Each has a readable
  in-world plaque (canvas texture) when you walk up (E to read exact numbers).

## Art direction

* **Low poly + cel shaded.** Faceted geometry (`facet()` in `scene/toon.ts`), `toon()` materials (3-band ramp),
  colours from `PAL`. Merge static geometry per object with vertex colours (`paint()` + `mergeGeometries`); instance
  anything repeated (`InstancedMesh`). Rounded, chunky, slightly exaggerated proportions; nothing razor-thin.
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
  and pumpkins, winter snow caps and bare trees. Assets take `season` in their build options.
* **Everything alive sways/breathes:** wind service uniforms for foliage; idle squash-and-stretch; nothing freezes.
* **No external assets.** All geometry, textures (canvas), sounds (WebAudio synthesis) and fonts (system) are made
  in code. No downloads, no image/model/audio files.

## Coordinates & conventions

* Metres. +x east, +z south (north = −z), +y up. Models are built facing **+z** (their front); `rotation.y = yaw`
  makes the front face `(sin yaw, cos yaw)`. The player's `yaw` is the camera's (0 = looking north).
* Heights: always `heightAt(x, z)` from `world/map.ts`. Water surface is `WORLD.water`.
* Place things with `clearance(x, z)` (distance to reserved features) and `inSite`/`siteToWorld`/`spots.ts`.
* Keep per-frame allocation at zero (reuse vectors). Systems update in `update(f)`; `f.dt` is scaled and ≤ 0.1 s.
* Deterministic: use `seeded(key)` / `mulberry32(hash32(key))` so every window renders the same valley.
* Register every buildable model with `defineAsset` in your package's `assets.ts` so it shows in the gallery.
  Systems build through the same functions.

## Ownership (one package per directory; don't edit other packages' files — message the lead instead)

| package | owns | publishes |
|---|---|---|
| **land** | `scene/terrain/*`, `scene/flora/*`, `scene/surface/*` (shared surface library), `world/map.ts` tuning | terrain look, water (river, pond, waterfall), path decals, trees/bushes/grass/flowers/rocks/logs scatter |
| **atmosphere** | `scene/sky/*`, `scene/weather/*`, `scene/post/*` | `ctx.lighting`, services `wind`, `post` |
| **structures** | `scene/structures/*` | landmarks + gauges, hub decoration, service `walkSurface` |
| **plots** | `scene/plots/*` | 12 plot kinds × lifecycle, animals (pettable), scarecrow helpers, service `plots` |
| **farmers** | `scene/farmers/*` | characters, jobs → animation, emotes, ducklings, greetings, service `farmers` |
| **life & sound** | `scene/life/*`, `audio/*` | ambient critters (birds, butterflies, fireflies, fish, frogs, village dog & cat), service `audio` |
| **hud** | `hud/*` | every DOM overlay, terminal drawer, `UiPort` |
| lead | `model/*`, `world/*` (API), `scene/{engine,context,toon,assets,systems}.ts`, `player/*`, `dev/*`, `main.ts`, scripts | contracts |

## Budgets (1600×900 on the Radeon 780M iGPU, 12–16 agents, `mixed` demo)

60 fps. Draw calls ≲ 600 total: land ≤ 120, structures ≤ 120, plots ≤ 150, farmers ≤ 100, life ≤ 40,
atmosphere ≤ 30 + post. One shadow-casting directional light (atmosphere owns it; shadow camera follows the player).
Check `__valley.perf()` → `calls`, `tris`, `systemMs`.

## Verify your work (do this constantly)

```sh
npm run typecheck                                   # all projects
node --test "renderer/src/farm/**/*.test.ts"        # model + layer rules (+ your pure tests)
npm run shoot -- --shot name=a,pose=hub,hour=10     # screenshots on the real GPU → scratch/shots/a.png, prints errors + perf
npm run shoot -- --shot name=n,pose=square,hour=22,weather=rain
npm run shoot -- --shot name=f,goto=d1:p2           # stand in front of a farmer / plot / structure id
npm run shoot -- --shot 'name=top,cam=0;90;70;0;-0.95'  # free camera x;y;z;yaw;pitch (quote: ';')
npm run shoot -- --shot 'name=w,gallery=dog,variant=run,frames=12,every=70,clip=400;100;900;700'  # flipbook: N frames tiled into one PNG
npm run shoot -- --shot name=m,pose=hub,panel=map    # HUD panel (map mailbox roster …); hud=0 hides the HUD; term=ID opens a terminal
npm run shoot -- --url 'http://127.0.0.1:PORT/?t=TOKEN' --shot name=live,pose=hub   # a running backend (live herdr; npm run build first)
npm run shoot -- --shot name=g,gallery=windmill,param=0.8   # one asset in the gallery
npm run shoot -- --shot name=g,grid=structure        # every asset of a group
npm run mapviz                                      # top-down map PNG, no browser
npm run dev                                         # interactive: /, /gallery/, /workbench/
npm run app  |  npm run app:demo                    # Electron: live herdr session | demo world
# in game: F3 perf overlay, F4 valley state inspector, F6 debug labels
```

Read the PNGs you produce (they are the ground truth), compare against the art direction, iterate. Poses:
`hub farmhouse square windmill pond barn river plots east` (`dev/api.ts`). The in-page API `window.__valley`
(`dev/api.ts`) also offers `setHour`, `setWeather`, `setSeason`, `timeScale`, `force(id, patch)` (demo entity
patch), `scenario(name)`, `debug(flag)`, `state()`. Demo scenarios: `mixed allStates crowd40 trio longIdle queue churn
empty offline` (`--scenario`). Put scratch files under `scratch/` (gitignored).
