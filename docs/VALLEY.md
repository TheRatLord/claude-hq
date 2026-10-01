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
* **Idle = leisure.** An idle farmer (no job for 4 s) picks a seat weighted by its `likes`, the hour and distance,
  and runs a varied activity loop there (`scene/farmers/idle.ts`, pure + `idle.test.ts`): fishing casts, reels and
  sometimes lands a catch; fireside toasting and chatting; reading on a bench; checkers turns with a partner. Four
  purpose-built leisure nooks (`scene/structures/nooks.ts`, `NOOKS` in `world/map.ts`): the **Pergola** (checkers
  table, spectators' bench, hanging lantern) north-east of the farmhouse, the **Picnic spot** (gingham blanket,
  parasol, firefly jar) south of the square, **Stargazers' knoll** (octagonal deck, telescope, benches; favoured at
  night) by the windmill, and the **Hot spring** foot-bath (steam, stone lanterns, rubber duck) on the river meadow
  behind the barn. Four **countryside nooks** out by the rim (`scene/structures/countryside.ts`), each at the end of
  its own footpath, give strolls somewhere to go: the **Orchard & apiary** (seasonal fruit trees, beehives with bees
  on fine days, a honey honesty stand) to the north-east, the **Standing stones** on the north knoll (runes glow cyan
  after dark), the **Hay meadow** (round bales, a hay wagon; away farmers doze against the bales) to the south-west,
  and the **Swing tree** on the east edge (a rope swing in the wind; E pushes it). Fern's rounds pass the stones and
  the orchard. Restless or chatty farmers sometimes leave their seat for an outing: a stroll to a view, the
  mailbox, their own field, visiting a friend, or petting the village dog/cat (service `pets`) or one of their
  field's animals (`plots.petAnimal`).
* **Villagers = the persistent townsfolk** (`scene/villagers/`, cast in `cast.ts`). Not agents, never in ValleyState,
  the roster, the needs-you strip, the mailbox or the agent dots: Clawds in non-agent body colours, each with a role
  hat (one shared instanced mesh), one piece of role wear over the body, a green role signboard for a nameplate and a
  house-shaped pin on the maps. Talking to one (E) says a line about the valley (`lines.ts`, via `ui.say`) and a beat
  later opens their shortcut; F just chats. The prompt's second line says what they open.

  | villager | look | post | E opens | lunch · evening · night |
  |---|---|---|---|---|
  | **Posy**, postmaster | teal, peaked postcap, mail satchel | beside the mailbox | mailbox ("2 letters waiting, Flint needs you!"); waves you over with an envelope while a letter needs you | picnic meadow · farmhouse yard · farmhouse |
  | **Bram**, shipping clerk | mustard, green eyeshade, canvas apron | by the shipping bin | farm ledger (commits shipped today); cheers every `ship` event | pergola · campfire · toolshed |
  | **Hazel**, miller | flour-tan, floppy flour-dusted cap, smock | windmill door | system stats, with a line keyed to CPU / RAM / disk | the well · under the sails · the mill |
  | **Mayor Marigold** | plum, top hat, sash + medal | by the noticeboard | noticeboard ("3 fields busy, 1 resting") | the square · pergola · farmhouse |
  | **Fern**, ranger | forest green, campaign hat, rucksack + bedroll | the signpost; rounds to the stones, orchard, bridge, waterfall, hot spring and pond | valley map | campfire · campfire · sleeps out by the fire |
  | **Nimbus**, weather-watcher | sky blue, sou'wester, oilskin cape | stargazers' knoll (a night owl) | the real-clock weather report (say only) | the dock · the knoll · the mill's loft till late morning |

  Routines run on the real clock (`schedule.ts`: a cyclic day plan per villager, ±18 min seeded jitter per day, rounds,
  seeded act loops); indoors = they walk to their door and fade out (lights out). Storms (or heavy rain / snow) send
  everyone indoors, the ranger to the barn. At social places they wander off to chat with an idle farmer or pet
  Biscuit / Mochi (`pets.hold` / `pets.pet`). After dark they carry a hand lantern (prop `lantern`) that is a real
  `LightEmitter`. They greet you like farmers do and walk the farmers' roads with the farmers' motion / gait / pose code.
  Contracts (`scene/context.ts`): interactable kind `'villager'`, optional `Interactable.hint()` (the prompt's second
  line), optional `UiPort.roster()`, service `'villagers'` → `VillagerPin[]` (the HUD gets them as `HudBindings.villagers`).
  Gallery: `villagers` (variants `post walk wave night back`).
* **System stats live in the landmarks:** windmill blade speed = CPU; water tower gauge/level = RAM; silo fill
  window = disk; farmhouse chimney smoke = disk IO; carrier pigeons between the farmhouse loft and the valley =
  network; a big thermometer on the barn = temperature; the greenhouse-glow / barn lantern = GPU. Each has a readable
  in-world plaque (canvas texture) when you walk up (E to read exact numbers).
* **The night sky is worth looking up at:** the moon keeps its real phase and lays a shimmering path across the pond
  and river toward itself; on clear nights a shooting star crosses now and then (`scene/sky/meteors.ts`), and on the
  real peak nights of the Perseids, Geminids and Quadrantids they come every few seconds. The first one you see in a
  while gets a "make a wish" line.
* **Photo mode (P)** (`farm/photo.ts`): the HUD steps away and the camera flies free (WASD along the view, Space / C,
  Shift); the wheel zooms, [ ] scrub the clock, Enter saves a PNG; P or Esc puts the view and the clock back.
* **The Valley Almanac (H) is the valley's long memory.** Real work is a *harvest* worth prosperity points (commit 10,
  green test run 4, finished task 6, answered question 3, new field 5, duckling 1; per-kind daily caps so a busy test
  loop can't farm it). Points persist per browser profile (localStorage `claude-valley.almanac.v1`; the demo keeps a
  fortnight in memory, `?almanac=POINTS`) and lift the valley through ten ranks, Homestead → Golden Valley (then a star
  per 1,500). Each rank unlocks a **town upgrade** built in the world (`scene/structures/upgrades.ts`, not baked):
  bunting over the square, flower barrels along the roads, the fountain (toss a coin), market stalls (browse today's
  harvest), festoon lanterns, the bandstand (strike up a tune), a patchwork hot-air balloon, the golden Clawd statue,
  and evening fireworks over the south meadow at nine. A new rank pops its upgrade in with confetti, fires a short
  firework show and toasts with a fanfare; Mayor Marigold talks about the rank every third chat. The status sign's
  rank chip opens the panel (rank, today's harvest, the week, streak, upgrades). Logic is pure: `model/almanac.ts`.
* **Pastimes: foraging, fishing and the Collections book (K).** The player's own cozy hobby between check-ins
  (`scene/forage/`, system `forage`; pure + tested `model/collection.ts`). Each real day 8–12 of the season's
  forageables lie around the valley, deterministic per date (`forageDay` + `place.ts`: meadows a short walk off a road,
  beside trees, the pond beach / river banks, the foot of the cliffs; never on roads, in fields, water or structures):
  spring morels, wild leeks, violets; summer wild strawberries, jay feathers, mussel shells and skipping stones by the
  water; autumn chanterelles, acorns, hazelnuts, maple leaves; winter holly, pinecones and the rare frost crystal. One
  instanced draw per kind in season plus one additive draw of twinkling glints so they can be spotted; look at one →
  `[E] Pick up` (a pop, sparkles, sfx); a picked spot stays empty until tomorrow. **Fishing:** look at open water near
  the pond or the river → `[E] Cast a line`; the held rod casts the bobber, it nibbles, then dips with a splash and a
  `bite` ping → E within ~1.2 s (a second chance if you miss) reels in, and the catch is held up in view. What bites
  depends on season, hour (night-only catfish / eels / moonlit char, dawn-and-dusk pike), weather (rain-only thunder
  bass and eels) and water (`rollFish`); old boots and a message in a bottle come up too. The book (K, or the tab on the
  Almanac panel) shows all 28 entries as silhouettes until found, then count, first-found date, biggest catch and a
  line of flavour; persisted per browser profile (`claude-valley.collection.v1`, service `collection`, `HudBindings.collection`).
  A first-ever find is a `found` harvest in the Almanac (+5, three a day). Dev: `__valley.forage(day?)`, `forageGo(i)`,
  `fish()` / `fish('bite' | 'hook' | 'demo')`, `collect(n)`; gallery assets `forage`, `catch`, `fishing-rod`.
* **Bits, the General store and your yard (I).** The valley's little economy (pure + tested `model/shop.ts` catalogue
  and prices, `model/wallet.ts` purse/basket/yard; `scene/yard/`, system `yard`, service `wallet`; HUD `hud/shop.ts`,
  panel `shop`). The coin is the **bit** (a copper coin stamped with a sprout), shown on the status sign's coin chip.
  Every forage/fish/junk find goes into your **basket**; sell it to Bram (talk to him at the shipping bin when the basket
  has something) or at the **General store**, a green striped cart on the meadow south-east of the square, placed level
  beside a road (`storeSpot`): E browse, F sell your basket. Bram pays by rarity (forage), size and rarity (fish), 2 for
  junk. Real agent work pays a capped trickle (ship 4, celebrate 2, finished 3, …; max 40 bits a day, a "+n" floats on
  the chip). The store stocks 17 yard decor pieces: always (planters, flamingo, gnome, birdhouse, wind chime, Biscuit's
  bed, bench, bird bath, scarecrow with three hats), seasonal (jack-o'-lantern, snowman, blossom sapling, parasol), and
  Almanac-rank-gated (lamp post r2, fairy-light arch r3, Clawd topiary r4, golden gnome r7); each extra copy costs +35%,
  each item has a max. **Your yard** is the picket-fenced garden behind the farmhouse (`world/map.ts` `YARD`, reserved in
  `clearance()`): 15 slots (5×3) with ghost rings while carrying. Look at a piece → E Move / F Turn; carrying snaps to the
  slot you look at (tint: free / taken = swap), E puts it down, F turns, X puts it away. The sign at the gate (E) and the
  shop's Yard tab (map + piece list: place, move, turn, restyle, put away) do the same from the HUD. Glowing pieces
  (lamp post, arch, pumpkin) register `LightEmitter`s. Persisted per profile (`claude-valley.wallet.v1`). Keys: I opens
  your pockets (basket; 1/2/3 tabs). Dev: `__valley.coins(n)`, `buy(id, free?)`, `sell()`, `furnish()` (fill the yard),
  `yard()` / `yard('store' | 'carry')`; gallery assets `decor` (variant `id` or `id:style`), `general-store`.
* **The farmhouse has a walk-in interior** (`scene/interior/`, system `interior`, service `indoors` = `IndoorSpace`).
  E on the front door ("Go inside") fades (real-time, works at timescale 0) into one warm room built in place in the
  farmhouse's own frame (`layout.ts` is pure + tested: room box, windows, furniture anchors, colliders, viewpoints).
  Inside: a stone hearth with an instanced fire + flickering `LightEmitter` (E stokes it), the Valley Almanac open on a
  desk (E → Almanac panel, live page drawn on a canvas), the Collections shelf (every forage/junk find fills its slot,
  unfound slots wear a "?" tag; E → Collections book) with the biggest catch mounted over the mantel, a fish tank
  swimming every species caught (one merged mesh, vertex-shader swim), a CRT terminal desk (phosphor list of farmers,
  amber blink when one needs you; E → roster), bed (E naps: time skips in demo, a cozy line live), Mochi's cat bed,
  grandfather clock on the real time (ticks), bookshelf, plants, rug, armchair. While inside the outdoor scene is hidden;
  the windows show the real valley: each view (front, east) is captured to an HDR target + depth from just outside and
  re-projected on backdrops (refreshed when night/wet/sun angle drift, max one per 1.5 s), with rain running down the
  glass. The existing shadow-casting sun throws real patches through the window holes plus soft additive shafts by day;
  lamps and the hearth carry the night; the farmhouse windows keep glowing outward. Audio: outdoor ambience goes
  through a low-pass/duck (`AudioService.indoors(k)`), music and the new `roof` rain loop stay dry. Controller, pick and
  sky read the service (room floor/colliders, only `interior:*` interactables, warmer dimmer hemi). Leaving: E on the
  door (back to the porch) or any travel out of the room. Budget: ~24 draw calls inside **including post**, ~0.15 ms
  system time; outside it is not in the scene (one `active` check per frame). Dev: `pose=inside[:view]` (door room
  hearth shelf desk bed tank window sun), `__valley.inside(view | false)`; gallery `farmhouse-interior` (cutaway/closed).
* **The calendar has festivals** (`model/calendar.ts`, pure + tested; `ValleyState.sky.festival` = `{ active, next }`):
  **Blossom Fair** (Apr 24 – May 3: maypole, garlands, cherry petals), **Lantern Night** (Aug 10–16: paper lanterns round
  the pond, floating lanterns, sky lanterns after dark), **Founders' Day** (Sep 28, the first commit: cake, pennants),
  **Harvest Festival** (Sep 22 – Oct 14: giant prize pumpkin, cornucopia, hay stacks, scarecrow contest), **Hallowtide**
  (Oct 24 – Nov 1: jack-o'-lanterns that light the roads, bats, wisps), **Starlight** (Dec 1–30: decorated tree, string
  lights, snow lanterns) and **New Year** (Dec 31 – Jan 1: fireworks over the south meadow at midnight). A short festival
  wins a day it shares with a long one. `scene/structures/festivals.ts` builds the active set (centrepiece on the
  square's north-west quadrant, strings between the hub lamps, a banner over the south exit, one interactable: judge
  the pumpkin, vote for a scarecrow, dance round the maypole, light a wish lantern, trick-or-treat, hang an ornament,
  blow out the candles, raise a glass); a live change pops the new set in. ≤ 9 draw calls (3 merged meshes + banner +
  swarms). Villagers talk about it on alternate chats and mention the next one within 14 days (`lines.ts`), the
  noticeboard pins a poster, and a toast greets you once per load (`hud/festival.ts`). Force one on any date with
  `?festival=ID` / `__valley.festival(id)` (the season follows unless `?season=` is set); service `festivals`
  (`where()`: piece positions for shots). Gallery: `festival` (variant per id).

## Art direction

* **Low poly + cel shaded.** Faceted geometry (`facet()` in `scene/toon.ts`), `toon()` materials (3-band ramp),
  colours from `PAL`. Merge static geometry per object with vertex colours (`paint()` + `mergeGeometries`); instance
  anything repeated (`InstancedMesh`). Rounded, chunky, slightly exaggerated proportions; nothing razor-thin.
* **Creatures are sculpted, not stacked.** Animals, pets and critters are smooth low-poly hulls from `scene/sculpt.ts`:
  `loft(rings, { paint, coat?, bump?, blend? })` lofts one continuous mesh through a few cross-section rings
  (Catmull-Rom interpolated superellipses with separate up / down radii) with smooth normals (clean cel bands) and a
  faceted silhouette; `blob()` is the ellipsoid shorthand. Paint per face from `Face` (`t` along the spine, `a` around
  it, snapped to the quad so regions follow the mesh edges; use them rather than raw x / y for clean boundaries),
  `blend: true` for soft gradients, `coat` for a per-face tint / pattern mask (`tag` in plots/rig.ts, `piece` in
  life/rig.ts read it). Pet skins take lofts with `sp(g, null, …)` and `chain` weights so a tail or a leg is one hull
  over several bones. Keep separate pieces for what moves on its own (ears, jaw, eyes, wings) and small accents
  (nostrils, bells, beaks); never build a body out of overlapping balls.
* **Surfaces (texturing):** hand-painted detail comes from the shared surface library `scene/surface/` (read its
  `index.ts` header): tag geometry parts with `tagSurface(g, SURF.planks | shingle | brick | …)` (+ `ensureSurface` on
  untagged parts before merging) and draw with `surfaceMaterial({ vertexColors: true })` or `withSurfaces(material)`.
  It modulates the vertex/palette colour (seasons keep working), is object-space (no swimming), anti-aliased and
  fades with distance. Gallery: `surfaces` (variants per family / per surface, `compare` = off | on).
* **Palette:** warm, saturated, a little dusty. Greens lean yellow; shadows lean blue-purple (the post/grade does
  this). Night is deep blue with warm lamp pools.
* **Local light (night, dusk, storms):** lamps, lanterns, windows and fires are real lights, not ground decals.
  Register a `LightEmitter` with the `'lights'` service (`ctx.services.get('lights') as LightsService`, types in
  `scene/context.ts`): `{ pos (world, mutable), color (linear), intensity (~1 = full albedo at the core), radius (m),
  dir? + cone? (window spill), flicker? 0..1, gain? 0..1, when? 'night' | 'always' }`; keep the returned remove fn.
  `scene/lights/lights.ts` packs the nearest frustum-visible emitters into a fixed pool of three.js PointLights /
  SpotLights each frame (no recompiles), and `scene/lights/shader.ts` patches the toon light loop so every
  `MeshToonMaterial` (any package, any hook) shades them as painted, banded warm pools with a soft facing terminator.
  Emitters fade in with `lighting.night` (dusk and storm gloom included). Occlusion is cheap and explicit: an
  emitter with `dir` is wall-mounted (windows, wall lanterns: `k.emit({ wall: [nx, ny, nz] }, fn)`) and lights only
  the half-space in front of its wall (the wall face itself gets a soft glow); freestanding lamps are shadowed by
  building boxes registered with `lights.occluder({ x, z, yaw, w, d, y0, y1 })` (the structures system adds the
  farmhouse, barn, toolshed, silo and windmill; each pooled lamp tests its 2 nearest boxes, soft-edged, in the shader). Kit glow parts register themselves:
  `PAL.windowGlow` panes spill a cone out of the window, `PAL.lampGlow` glass lights all around (`k.emit(false, fn)`
  for glow that lights nothing, `k.emit({ radius, intensity }, fn)` to tune). Lit glass shows an interior (room
  gradient, curtains, sill plants, flame cores), peaking just above the night bloom threshold so only sources halo.
  Unlit emitters that must stay warm under the night grade (flames, lantern cores): `warmEmitter(material)` from
  `scene/lights/emitters.ts`. Toon pixels write their local-light share to the scene target's alpha for that grade.
* **Outlines + post:** a dark warm outline on silhouettes (post pass), soft bloom on emissives (lamps, "!" markers,
  fireflies), colour grade per time of day, gentle vignette. Keep emissive intensities > 1 only for things meant to glow.
* **Seasons** follow the real month (`ctx.valley.sky.season`): spring blossoms, summer lush, autumn orange/red trees
  and pumpkins, winter snow caps and bare trees. Assets take `season` in their build options.
* **Everything alive sways/breathes:** wind service uniforms for foliage; idle squash-and-stretch; nothing freezes.
* **No external assets.** All geometry, textures (canvas), sounds (WebAudio synthesis) and fonts (system) are made
  in code. No downloads, no image/model/audio files.
* **The land (land package).** The cliff wall steps up in **rock strata** (`terraceHeight` in `world/map.ts`, only from
  the rim + 6 m outward and never at the waterfall): level shelves, steep risers, a 1.25 m grid there, the wall's
  normals leaned toward the smooth slope and rock coloured per vertex so ledges read as clean bands. Shelves carry
  turf; `landB.w` (terrain.ts `lipField`) marks riser tops and the shader paints ragged **turf lips** rolling over each
  ledge with a shadow line (`uTurf`: moss green, autumn gold, winter snow; tongues shorten with distance). Bushes and
  small pines cling to the shelves; **ivy drapes** (`flora/ivy.ts`) hang in clusters (a slow noise picks the heavy
  ledges, most stay bare): a leafy mat on the shelf rolls over the lip and strands walk down the riser against
  `heightAt` (hugging it, ragged hem, longest mid-curtain), merged into 6 sector meshes (no per-frame work; parts
  `ivy#n` for the audit); summer deep green, autumn muted creeper wine / rust / bronze, winter sparse evergreen with
  frosted mats. Outcrops sit on shelves, not stuck to faces;
  four little **cascades** (`TRICKLES` in features.ts, drawn by water.ts as one ribbon) spill down the strata, white
  on the risers and glassy across the shelves. The floor has a **meadow mosaic** (`terrain/meadow.ts`: one value
  noise shared by GLSL and TS): darker clover drifts, sunny bleached patches with rough tall grass, and wildflower
  drifts (a colour wash from afar, petals up close, seasonal colours via `bloomColors`) with clover and flowers planted
  in the same places. Field structure: **hedgerows** (overlapping runs, continuous from above) along tracks and round the backs / sides of the field sites (now
  and then a hedgerow tree), dry-stone walls wandering and following tracks, **kerb stones** where the roads leave the
  square, fairy rings of mushrooms and molehill runs. Everything placed keeps `clearance()` and is audited. Beyond the
  far tiles a **horizon ring** (`terrain/horizon.ts`, one unlit draw tinted from the live fog colour) layers two
  hazy distant ranges at 650 / 760 m; it shows from up high and through gaps in the rim, never over it.

## In-world UI (names, speech bubbles, the interaction tag)

* **Names in 3D are project names.** `FarmerView.tag` / `HelperView.tag` (model, tested): the project directory name
  (`project` = basename of the repo / cwd), unique per field — twins become `claude-hq·flint` when each has a clean
  one-word herdr name, else `claude-hq`, `claude-hq·2`, … Nameplates, bubbles, the prompt and the noticeboard use
  `tag`; `name` (herdr name / tab label, may be a long path) is for HUD panels with room (secondary line / tooltip).
* **One anchored overlay system** (`hud/anchors.ts` + `anchors.css`, pure maths in `hud/anchor.ts`): nameplates,
  villager signboards, duckling labels and speech / needs-you bubbles are DOM nodes projected over their world anchor
  every frame (transform only, nodes reused per key, sizes measured once per text change), so they stay crisp at night,
  in fog and rain. Scene code never touches the DOM: it calls `Labels.show(key, owner, style, title, sub, pos, alpha)`
  (`scene/farmers/labels.ts`, which fades tags behind the big buildings via the light occluders) → `UiPort.tag`.
  Same-owner tags stack (plate, then bubble); stacks nudge apart nearest-first; long lines wrap and page (`1/3`),
  never truncate; tags shrink a little with distance.
* **HUD furniture is an obstacle.** Mark any fixed HUD element `data-hud-obstacle` (its box) or
  `data-hud-obstacle="children"` (each visible child: a card column, a toast stack); `anchors.ts` re-measures them only
  when they change (Resize/MutationObserver on the marked elements, window resize), and bubbles, nameplates and the
  interaction tag step around them (`placeRect` in `hud/anchor.ts`: up, sideways, then down; hidden or edge-pinned
  when nothing fits).
* **`ui.say(text, ms, { who, from })`** is a timed bubble anchored to the speaker: `from` (an interactable id), else
  whatever was under the crosshair when it was said (most lines come from `use()`); characters get a speech bubble,
  structures / props a parchment note. If you turn away it pins to the screen edge with an arrow toward the speaker.
* **The interaction tag** (`hud/prompt.ts`) sits beside the focused target (right side, flips left when there is no
  room; never over the face): name + role, `[E] verb`, `[F] alt`, and the hint line. The crosshair stays.
  Shots: `goto=villager:posy` plus `eval=setTimeout(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'})),1200)`
  for a villager line; `__valley.force(id, { status: 'working', activity: { cls: 'talk', … }, lastText })` for a talker.


## HUD panels (screen furniture, menus, the terminal drawer)

* **Every terminal is a menu away.** Ledger (Tab), map (M: click a pin, or ↑/↓ + Enter in the side list, which lists
  farmers *and* scarecrows), mailbox (J: the Needs you tab pre-selects the first ask, 1–9 answers it, Enter opens the
  terminal), the needs-you strip (Alt+1…9), the pause menu's Terminals entry, the dock's terminal button and the leader
  key (Ctrl+`). `browser-tests/valley.spec.ts` checks the ledger, map-click, map-keyboard, mailbox and needs-you paths
  and the power-user loop below: add a flow there when you add one.
* **The power-user loop (5–15 agents):**
  * *Answer + next.* The mailbox's Needs you tab lists asks in the strip's order (`askOrder`, newest first, so Alt+1 is
    the top letter); answering one (1–9 or a click) selects the next (`nextAfter`, `format.ts`), so `J 1 1 2 Esc` clears
    a queue. A second key press while an answer is in flight is ignored (no double answers).
  * *New tasks.* An idle / finished farmer's card has **Give a new task** (`AgentPort.prompt`, a confirm step, Ctrl+Enter
    twice); `N` in the card jumps into it, and the ledger reaches it directly: the paper-plane row button or Ctrl+Enter
    on the selected row opens the card with the box focused (`panels.open('card', { id, task: true })`).
  * *Ledger chips.* The ledger's summary pills (needs you · working · done · idle; `rosterFilterHit`) are status filters
    (click again for everyone); text filtering still matches names, fields, jobs and questions.
  * *Away from the window.* The tab title counts asks / finishes (`status.ts`) and the tab icon is a canvas-drawn Clawd
    with a gold count badge for asks or a blue dot for unreviewed finishes (`notify.ts`). Opt-in **desktop
    notifications** (Settings → Alerts, HUD pref `notify`; asks the browser for permission) fire on `blocked` /
    `finished` only while the window is hidden or unfocused: bursts merge (`notifyCopy`), one per farmer per 15 s;
    clicking opens that terminal (several asks: the mailbox). `__hud.notify()` shows the last copy and the icon badge.
  * *Every key.* `?` opens the pause menu's Controls tab from anywhere outside a terminal: grouped (getting around,
    agents, mailbox, ledger, card & terminal, the valley). Add new keys there and to the hints bar's budget sparingly.
* **Names:** compact spots (needs-you cards, map pins and the side lists, ledger rows, the drawer's list and header,
  the farmer card's title) use `shortName()` = the in-world `tag`; the full herdr name goes on a secondary line or a
  tooltip via `altName()` (`hud/format.ts`, tested). Map pins carry one glyph (`pinGlyph()`: the tag's suffix).
* **Layout:** top-left the status sign (clock, link, *needs / working / done* counts) over the needs-you strip; top-right
  the minimap over the dock (mail, map, ledger, terminals, menu; z above the backdrop); bottom-right the toasts over the
  key-hints bar (whose first item is the "Click: look around" reminder while the mouse is free). The needs-you strip is
  a count chip (click or Alt+0 folds it; the fold is a HUD pref) and the asks newest-first: one open card with the answer
  buttons, the rest one-line rows (click / Enter opens one; the green button opens its terminal).
* **Layer classes** (on `.vh-layer`, set by `hud.ts` / `needs.ts`; style against them instead of measuring): `modal` (any
  panel), `covered` (a big panel, not the side card: hints hide, toasts shrink to two compact ones and only asks /
  errors pop, the offline banner docks bottom-left), `side` (the side card is open: toasts stand to its left, off its
  buttons), `has-needs` (the strip is unfolded: centred panels shift right by
  `--lw` so the strip stays clickable beside them; the mailbox sits between the strip and the dock).
* **Empty and offline states:** every list says what is going on and what to do (no farmers yet → open a herdr
  workspace; herdr offline → it comes back on its own); never an empty frame.
* **Drawer:** bottom-anchored; drag the grip on its top edge (or ↑/↓ on the focused grip) to resize, double-click to
  reset; the height is the `drawerH` HUD pref (browser-local, like `minimap`, `toasts`, `compactStrip`, `notify`).
* **Performance:** the 4 Hz tick refreshes only what changed (keyed rows with per-row signatures: `syncList`, the
  ledger's row cache); nothing in the HUD reads layout per frame except the map canvas, which redraws only while open.
  Check with `npm run shoot -- --scenario crowd40 --shot name=r,pose=hub,panel=roster` (fps in the printed perf).
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
| **atmosphere** | `scene/sky/*`, `scene/weather/*`, `scene/post/*`, `scene/lights/*` | `ctx.lighting`, services `wind`, `post`, `lights` |
| **structures** | `scene/structures/*` | landmarks + gauges, hub decoration, leisure nooks, services `walkSurface`, `structureSpots` |
| **plots** | `scene/plots/*` | 12 plot kinds × lifecycle, animals (pettable), scarecrow helpers, service `plots` |
| **farmers** | `scene/farmers/*` | characters, jobs → animation, emotes, ducklings, greetings, service `farmers` |
| **villagers** | `scene/villagers/*` (role hats / wear / lantern data live in `farmers/mascots.ts` + `geo.ts`, drawn by the shared rig) | the persistent villager cast, routines, dialogue, service `villagers` (`VillagersService`: map pins, debug) |
| **life & sound** | `scene/life/*`, `audio/*` | ambient critters (birds, butterflies, fireflies, fish, frogs, village dog & cat), services `audio`, `pets` |
| **hud** | `hud/*` | every DOM overlay, terminal drawer, `UiPort` |
| **interior** | `scene/interior/*` | the walk-in farmhouse room, service `indoors` (`IndoorSpace`) |
| lead | `model/*`, `world/*` (API), `scene/{engine,context,toon,assets,systems}.ts`, `player/*`, `dev/*`, `main.ts`, scripts | contracts |

## Budgets (1600×900 on the Radeon 780M iGPU, 12–16 agents, `mixed` demo)

60 fps. Draw calls ≲ 600 total: land ≤ 120, structures ≤ 120, plots ≤ 150, farmers ≤ 100 (villagers ≈ 10 of it), life ≤ 40, forage ≤ 10, yard ≤ 6 (4 merged/instanced, +2 while carrying), interior ≤ 40 (only while inside),
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
npm run shoot -- --shot name=u,pose=square,almanac=3400,hour=22,eval=__valley.fireworks(30)  # every town upgrade + a show
npm run shoot -- --shot name=f,pose=square,festival=hallowtide,hour=21   # a festival (blossom lantern founders harvest hallowtide starlight newyear)
# __valley.almanac(points) sets prosperity live (crossing a rank pops its upgrade in)
npm run shoot -- --shot "name=c,pose=hub,panel=collection,eval=__valley.collect(16)"   # the Collections book
npm run shoot -- --shot "name=f,pose=hub,eval=__valley.fish('demo'),frames=9,every=450"  # cast, bite, catch (flipbook)
npm run shoot -- --shot "name=p,pose=hub,eval=__valley.forageGo(0)"                       # stand over today's first find
npm run shoot -- --shot "name=y,hour=11,eval=__valley.furnish();__valley.yard()"   # your yard, filled (hour=21 for the lights)
npm run shoot -- --shot "name=yc,hour=11,eval=__valley.furnish();__valley.yard('carry')"   # carrying: slot rings + ghost
npm run shoot -- --shot "name=st,hour=11,eval=__valley.yard('store')"     # the General store cart
npm run shoot -- --shot "name=sp,pose=hub,eval=__valley.coins(800);__hud.open('shop',{tab:'buy',at:'store'})"  # shop panel (tab buy|sell|yard)
npm run shoot -- --shot name=d,gallery=decor,variant=scarecrow:2     # one decor piece (id or id:style)
npm run shoot -- --shot name=i,pose=inside,hour=10          # farmhouse interior (inside:hearth|shelf|desk|bed|tank|window|sun|room)
npm run shoot -- --shot "name=ir,pose=inside:hearth,hour=21,weather=rain,eval=__valley.collect(28)"  # night, rain on the glass, full shelf
npm run mapviz                                      # top-down map PNG, no browser
npm run audit:placement                             # floating / sunk / overlapping assets → scratch/placement/ (below)
npm run dev                                         # interactive: /, /gallery/, /workbench/
npm run app  |  npm run app:demo                    # Electron: live herdr session | demo world
# in game: F3 perf overlay, F4 valley state inspector, F6 debug labels, P photo mode (fly, [ ] time, wheel zoom, Enter → PNG)
# __valley.meteor() launches a shooting star where the camera looks
```

Read the PNGs you produce (they are the ground truth), compare against the art direction, iterate. Poses:
`hub farmhouse square windmill pond barn river plots east` (`dev/api.ts`). The in-page API `window.__valley`
(`dev/api.ts`) also offers `setHour`, `setWeather`, `setSeason`, `timeScale`, `villagers()` / `villager(id)` (pins / what one is doing; `goTo('villager:posy')`
walks up to one, then `interact()` talks), `force(id, patch)` (demo entity
patch), `scenario(name)`, `debug(flag)`, `state()`. Demo scenarios: `mixed allStates crowd40 trio longIdle queue churn
empty offline` (`--scenario`). Put scratch files under `scratch/` (gitignored).

### Placement audit (`npm run audit:placement`)

Finds assets that float, sink into the terrain or run through each other, in the real built scene (all demo
scenarios' static world: `allStates` + `crowd40` by default, every plot lifecycle stage, flora, terrain features,
structures and dressing). `scripts/placement.ts` starts a dev server per scenario (no HMR), freezes time and calls
`__valley.audit()` (`dev/placement.ts`, loaded lazily; pure maths in `dev/placementCore.ts`, tested):

- **items**: every static mesh, every InstancedMesh instance, and every named part of a merged / baked geometry, so a
  finding names the placed thing, e.g. `structures/barn/pumpkin#3`, `plots/field:d4/fence#100`,
  `flora/tree-pine#12`. Provenance comes from `scene/parts.ts`: `Kit.part(name, fn)` / labelled props (structures),
  `named(parts, name, fn)` (plots) and `partName(geo, name)` record element ranges that survive `merge` / `bake`.
  Name new parts the same way, or they show up as `…/m<n>`.
- **ground checks** against the rendered terrain (raycast into the terrain chunks, plus `walkSurface` decks and
  anything the item rests on): `floating` (base gap > 4 cm), `overhang` (part of a wide base hovers > 20 cm),
  `sunk` (terrain swallows > 12 cm of a solid), `water` (dry-land object in the river / pond), `path` (a solid on a
  road's centre line). Soft cover (grass, flowers, clover, pebbles, reeds, soil) only gets the ground checks.
- **overlaps**: three-mesh-bvh per item, a uniform-grid broad phase over world AABBs, then triangle–triangle
  intersection (`bvhcast`); pairs that a 3 cm nudge separates are resting contact, not overlap. Parts of one placed
  object never pair with each other.

Output: `scratch/placement/report.json` (every finding, ranked, with key / owner / asset / AABB / metrics and the
scenarios it appeared in) and one contact sheet per open class (`NN-check-asset.png`: best view, opposite side, from
above; magenta = the item, cyan = what it hits, yellow = the problem region). Exit code 1 with `--strict` if anything
is open. Options: `--scenario a,b`, `--season x|all`, `--top N`, `--only key`, `--all-sheets`, `--shots allowed`.
`--sitters` adds a pass that poses a rest-pose Clawd and Codex (largest look scale) on every leisure-nook seat and the
telescope stand, in every act of the seat's loop (`idle.ts` LOOPS), and reports only their overlaps (`sitters/<nook>:
<seat>:<body>/<act>/…` against the nook and the neighbouring seats). Run it after changing a nook, a seat anchor or a
seated pose; legs hanging through their own seat and soakers' feet in the pool are allowlisted.

Intended cases live in `scripts/placement-allow.json` (globs over key / owner / asset, per check, optional `max` /
`min` on the metrics, and a `reason` for each). Fix real findings at the source (the placing code), allowlist only
what is meant to be (apples hang in trees, outcrops are bedded into slopes), and keep `max` tight so a regression
still surfaces. Entries that match nothing are reported; delete them. In page: `__valley.audit({ only })`,
`__valley.auditShow(keys, focus, view)`, `__valley.auditClear()`.
