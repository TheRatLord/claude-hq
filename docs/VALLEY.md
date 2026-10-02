# Claude Valley — design brief

A cozy, first-person, low-poly, cel-shaded farm valley where your coding agents (Claude Code, Codex, … running in
herdr panes) are little farmers. You walk the valley to see what everyone is doing, who's stuck, and who needs you —
and every agent is always one click away from its real terminal, however far away its farmer is standing.

Think Stardew Valley's warmth and density, A Short Hike's charm, Animal Crossing's villagers acknowledging you,
Zelda: Wind Waker's toon light. **Genuinely usable first, adorable second, and never at the cost of the first.**

This file is the index: layers, conventions, ownership, budgets and how to verify. Each area has its own doc in
[`docs/valley/`](valley/); read the one for the area you touch before you change it, and keep it current.

## Contents

| doc | read this when… |
|---|---|
| [lore.md](valley/lore.md) | writing copy or changing how agent state shows: fields, farmers, ducklings, jobs, field traces, idle leisure and nooks, system-stat landmarks |
| [art.md](valley/art.md) | building or restyling anything visible: toon/facet rules, sculpted creatures, surface library, palette, local lights, post, seasons, the land (strata, ivy, meadow, horizon) |
| [hud.md](valley/hud.md) | touching DOM overlays: names/tags, anchored bubbles, the interaction tag, terminal routes, power-user loop, keys, layout zones, z-order, layer classes, drawer |
| [ops.md](valley/ops.md) | running many agents at once: the command palette (Ctrl+K: agents by name or by what they said, every terminal's scrollback via `term.search`, answers, panels), the focus queue (Alt+N, the drawer's Next), pin / mute per agent, the overview grid (V) |
| [recap.md](valley/recap.md) | changing harvest recaps: what a stretch of work records, when it closes, the postcard / toast / card / ledger, the read-only `git.diff` |
| [timeline.md](valley/timeline.md) | changing the per-farmer day timeline: what is recorded, its bounds and storage, the card's Today section, the ledger strips |
| [signals.md](valley/signals.md) | changing what the server knows about an agent and where it shows: model, context fill, todo checklist, git per field, token spend; the known-vs-surfaced audit |
| [map.md](valley/map.md) | changing the map panel or minimap: painted base, live layers, pin language, layer toggles |
| [onboarding.md](valley/onboarding.md) | changing the first-run welcome, tour checklist or one-time tips |
| [guide.md](valley/guide.md) | changing Fern's field notebook (O): the activity pages and how they're found, Fern's nudges, villager rumours, the "what's new" letter |
| [weather.md](valley/weather.md) | changing weather traces (wet, puddles, snow, frost), rainbow / mist / god rays, the night sky and meteors |
| [audio.md](valley/audio.md) | changing sound: buses, music planner and band, gathering music, footsteps, ambience, levels, the audio debug renderer |
| [almanac.md](valley/almanac.md) | changing prosperity points, ranks or town upgrades |
| [pastimes.md](valley/pastimes.md) | changing foraging, fishing or the Collections book |
| [seasons.md](valley/seasons.md) | changing the seasonal pastimes: the rowboat, skating on the frozen pond, snowmen (and the controller's `ride` hook) |
| [wildlife.md](valley/wildlife.md) | changing wild visitors, shyness or the field guide |
| [pet.md](valley/pet.md) | changing your own pet: adoption at the foundlings basket, following, fetch, finds, bedtime, happiness |
| [economy.md](valley/economy.md) | changing bits, the basket, the General store, decor or the yard |
| [friends.md](valley/friends.md) | changing villagers (cast, routines, contracts) or friendship, gifts, requests and milestones |
| [villagers.md](valley/villagers.md) | changing villagers' daily routines or the heart events at 3 / 5 / 7 hearts |
| [gatherings.md](valley/gatherings.md) | changing campfire evenings, concerts or market mornings |
| [festivals.md](valley/festivals.md) | changing the festival calendar or festival dressing |
| [stamps.md](valley/stamps.md) | changing the stamp book: achievements across every system, their rewards and trophies, the Almanac's Stamps tab |
| [gazette.md](valley/gazette.md) | changing The Valley Gazette: the weekly / morning editions, where its facts come from, the weekly roll-up, delivery, back issues, the newspaper page |
| [album.md](valley/album.md) | changing photo mode's looks, frames, timer or "say cheese", the photo album (IndexedDB, limits, the panel) or the farmhouse photo wall |
| [interior.md](valley/interior.md) | changing the walk-in rooms (farmhouse, barn: chores, machine room) |
| [grotto.md](valley/grotto.md) | changing the secret grotto behind the waterfall: the ledge cut, the cave room, its secrets (glow-caps, cave fish, the chest, the stamp), the map's "?" |
| [orchard.md](valley/orchard.md) | changing the hillside orchard & apiary: the fruit trees through the seasons, shaking a tree (E), the hives, bees and honey, the cider press, its site on the east slope |
| [projects.md](valley/projects.md) | changing the Valley Projects: the Mayor's board on the square, the six plans (bits, finds, a friend's blessing, real work; the demo never counts), the ruined and restored places, the unveiling, the board's panel |
| [visitors.md](valley/visitors.md) | changing the visitors: the travelling merchant (his calendar, cart and rare stock: decor, the glimmer lure, the sketch map), the wandering painter and her paintings for the farmhouse wall, the parcel post off the restored halt, their panel, map pins and announcements |
| [trail.md](valley/trail.md) | changing the summit trail, its decks, the lookout or the valley viewer |
| [viewmodel.md](valley/viewmodel.md) | changing your first-person paws: what they hold, gestures, the lantern, their overlay drawing, the `hands` service |
| [desktop.md](valley/desktop.md) | changing the Electron shell: tray icon + menu, dock / taskbar badges, native notifications, the summon hotkey, window state, start at login, background rendering, the preload bridge |
| [tools.md](valley/tools.md) | taking screenshots, benchmarking, auditing placement, running browser tests, or using URL params, debug keys and the `__valley` / `__hud` dev API |

## Layers (enforced by `renderer/src/farm/layers.test.ts`)

```
server/ (herdr → Entity wire protocol; additive revisions, signals.md)
  └─ renderer/src/net/store.ts           the only WebSocket user
       └─ farm/source.ts                  store → ValleySource adapter + AgentPort (the ONLY net importers, with main.ts)
            └─ farm/model/  (pure)        ValleyState: farmers, helpers, plots, letters, gauges, sky, events
            └─ farm/world/  (pure)        the land: heightAt, SITES, STRUCTURES, PATHS, RIVER, POND, spots
                 └─ farm/scene/           three.js systems; read ValleyState + world, publish services
                 └─ farm/hud/             DOM overlays; get a HudNet port injected (never import net/)
                 └─ farm/audio/           WebAudio synthesis
                 └─ farm/player/          the first-person controller
                 └─ farm/dev/             window.__valley dev API, debug overlay, gallery, placement audit
       farm/main.ts                       wires it all (+ farm/photo.ts photo mode)
```

What the test checks: `model/` and `world/` are pure (start with `// @pure`; no three, no DOM, no net, nothing from
scene / hud / audio / dev / player); `scene/` never imports `hud/`, `main.ts` or `source.ts`; `hud/` imports no scene
system (only `scene/context.ts` types and `scene/toon*`); `audio/` never imports `hud/`; only `main.ts` and
`source.ts` touch `../net`.

The visuals are detachable: anything that produces a `ValleySource` (live store, a recording, a fake) drives the
whole valley. Scene/HUD code must only use `ValleyState` (`ctx.valley`), `ValleyEvent`s (`ctx.onValley`), and the
ports (`ctx.agents: AgentPort`, `ctx.ui: UiPort`). Never read Entity fields in presentation code; if you need
something the model does not expose, add it to `model/types.ts` + `model/valley.ts` (pure, tested) — coordinate via
the lead.

## Coordinates & conventions

* Metres. +x east, +z south (north = −z), +y up. Models are built facing **+z** (their front); `rotation.y = yaw`
  makes the front face `(sin yaw, cos yaw)`. The player's `yaw` is the camera's (0 = looking north).
* Heights: always `heightAt(x, z)` from `world/map.ts`. Water surface is `WORLD.water`.
* Place things with `clearance(x, z)` (distance to reserved features) and `inSite`/`siteToWorld`/`spots.ts`.
* Keep per-frame allocation at zero (reuse vectors). Systems update in `update(f)`; `f.dt` is scaled and ≤ 0.1 s.
* Deterministic: use `seeded(key)` / `mulberry32(hash32(key))` so every window renders the same valley. The
  daily plans (forage spots, requests, wild visits) use `hashKey` + `rand` from `model/collection.ts` (plain FNV-1a,
  kept as is: switching to `hash32` would reshuffle every seeded day). Date keys: `dayKey(ms)` (`model/almanac.ts`).
* Register every buildable model with `defineAsset` in your package's `assets.ts` so it shows in the gallery.
  Systems build through the same functions.
* Player progress persists per browser profile in localStorage `claude-valley.<area>.v1` (`almanac`, `collection`,
  `wallet`, `friends`, `onboarding`, `summit`, …); HUD prefs under `valley.hud.*`. Go through `farm/storage.ts`:
  `localJson(key)` is the `{ load, save }` port a `model/` store takes (models parse and log save failures),
  `readJson` / `writeJson` / `readLocal` / `writeLocal` never throw (blocked or full storage); read a prefs-style
  object with `readTyped(key, defaults)` (only known keys of the default's type survive). Anything may be in storage
  (old builds, hand edits, garbage): `model/robust.test.ts` fuzzes every model store and `browser-tests/robust.spec.ts`
  boots on corrupt values.
* No external assets: geometry, textures, sounds and fonts are made in code ([art.md](valley/art.md)).
  HUD icons are inline SVG strings: build them with `svgIcon`, `INK` and `ITEM_OUTLINE` from `hud/icons.ts`.

## Ownership (one package per directory; don't edit other packages' files — message the lead instead)

| package | owns | publishes |
|---|---|---|
| **land** | `scene/terrain/*`, `scene/flora/*`, `scene/surface/*` (shared surface library), `world/map.ts` tuning | terrain look, water (river, pond, waterfall), path decals, trees/bushes/grass/flowers/rocks/logs scatter |
| **atmosphere** | `scene/sky/*`, `scene/weather/*`, `scene/post/*`, `scene/lights/*` | `ctx.lighting`, services `wind`, `post`, `lights` |
| **structures** | `scene/structures/*` | landmarks + gauges, hub decoration, leisure nooks, services `walkSurface`, `structureSpots` |
| **plots** | `scene/plots/*` | 12 plot kinds × lifecycle, animals (pettable), scarecrow helpers, service `plots` |
| **farmers** | `scene/farmers/*` | characters, jobs → animation, emotes, ducklings, greetings, service `farmers` |
| **villagers** | `scene/villagers/*` (role hats / wear / lantern data live in `farmers/mascots.ts` + `geo.ts`, drawn by the shared rig) | the persistent villager cast, routines, dialogue, service `villagers` (`VillagersService`: map pins, debug) |
| **life & sound** | `scene/life/*`, `audio/*` | ambient critters (birds, butterflies, fireflies, fish, frogs, village dog & cat), wild visitors, your own pet, services `audio`, `pets`, `wildlife`, `companion` |
| **hud** | `hud/*` | every DOM overlay, terminal drawer, `UiPort` |
| **interior** | `scene/interior/*` | the walk-in rooms (farmhouse, barn), service `indoors` (`IndoorSpace`) |
| **trail** | `scene/trail/*` (route + cut in `world/trail.ts`) | the summit trail's dressing, staircase / bridge / deck `walkSurface`s (wrapping structures'), the valley viewer, the summit cairn, service `trail` |
| lead | `model/*`, `world/*` (API), `scene/{engine,context,toon,assets,systems}.ts`, `player/*`, `dev/*`, `main.ts`, scripts | contracts |

Not assigned a row: `scene/seasons/*` (system `seasons`: rowboat, ice, snowmen; [seasons.md](valley/seasons.md)), `scene/forage/*` (system `forage`), `scene/viewmodel/*` (system `viewmodel`, service `hands`; [viewmodel.md](valley/viewmodel.md)), `scene/orchard/*` (system / service `orchard`, site in `world/orchard.ts`; [orchard.md](valley/orchard.md)), `scene/projects/*` (system `projects`, service `projectsScene`, sites in `world/projects.ts`; [projects.md](valley/projects.md)), `scene/visitors/*` (system `visitors`, service `visitorsScene`; [visitors.md](valley/visitors.md)), `scene/gather/*` (service `gatherings`) and `scene/yard/*`
(system `yard`, service `wallet`) — ask the lead before editing them; `scene/sculpt.ts` and `scene/parts.ts` are shared
helpers.

## Budgets

1600×900 on the Radeon 780M iGPU, 12–16 agents, `mixed` demo:

* 60 fps. Draw calls ≲ 600 total: land ≤ 120, structures ≤ 120, plots ≤ 150, farmers ≤ 100 (villagers ≈ 10 of it),
  life ≤ 40, forage ≤ 10, yard ≤ 6 (4 merged/instanced, +2 while carrying), trail ≤ 8, viewmodel ≤ 4, interior ≤ 40 (only while
  inside), seasons ≤ 8 (rowboat 3–4, winter ice 1 + snowmen 3), orchard ≤ 8 + shadows ([orchard.md](valley/orchard.md#budgets)), projects ≈ 14 + 1 confetti while it flies ([projects.md](valley/projects.md)), atmosphere ≤ 30 + post.
* One shadow-casting directional light (atmosphere owns it; shadow camera follows the player).
* Check `__valley.perf()` → `calls`, `tris` (main + shadow pass), `systemMs`. GPU ≤ 10 ms a frame at the hub and the
  top view (`npm run bench`; 5–7 ms today, max ≈ 7.2 ms in `crowd40` snow at the hub), CPU frame (`cpu`) ≲ 8 ms with
  `crowd40` (≈ 6.5–7 ms today).
* Load: valley `ready` ≲ 4 s from navigation (≈ 3.1–3.3 s today: systems built ≈ 1.8 s, first frame ≈ 2.4 s),
  ≲ 3 MB of JS on the first page (2.7 MB). Measure with `npm run bench -- --startup`
  ([tools.md → Load time](valley/tools.md#load-time-npm-run-bench----startup)); `heightAt` / `clearance` / `pathAt`
  run for every height sample of every build, so keep them cheap.
* Per-area costs (wildlife, trail, interior, gatherings, festivals, audio, weather) are in their docs; how to measure
  is in [tools.md → Benchmark](valley/tools.md#benchmark-npm-run-bench).

## Verify your work (do this constantly)

```sh
npm run typecheck                                   # all projects
node --test "renderer/src/farm/**/*.test.ts"        # model + layer rules (+ your pure tests)
npm run build && npm run test:browser              # Playwright (loads dist/; ~1 min on the GPU, see tools.md)
npm run shoot -- --shot name=a,pose=hub,hour=10     # screenshots on the real GPU → scratch/shots/a.png, prints errors + perf
npm run bench -- --scenario mixed --pose hub,top    # GPU / CPU ms, calls, tris per pose
npm run audit:placement                             # floating / sunk / overlapping assets → scratch/placement/
npm run mapviz                                      # top-down map PNG, no browser
npm run dev                                         # interactive: /, /gallery/, /workbench/
```

Read the PNGs you produce (they are the ground truth), compare against the art direction, iterate. Every shot recipe,
pose, scenario, URL parameter and dev hook is in [tools.md](valley/tools.md) and in the area docs.
