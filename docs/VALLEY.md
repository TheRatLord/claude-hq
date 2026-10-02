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
* **Jobs = what you see the farmer doing** (`model/jobs.ts` `clsJob`, smoothed; `FarmerView.tool` = the tool flavour
  inside the visible job, `stickyTool`, held ≥ 8 s by the brain so churn never flickers; `scene/farmers/brain.ts`
  `workAct`). Edit/write: trowel and hoe in the rows (feed / brush in animal pens). Read: magnifier over the crop, then
  the seed almanac. **Search**: rummages in a burlap seed sack and flings handfuls over the shoulder. Test: the watering
  can along the row. Bash / build: hammer and saw. Git: a crate to the shipping bin. **Web / net fetch**: a carrier
  pigeon flies in to the raised nub with a letter, perches, flies off, then the farmer reads the letter (MCP and the
  rest still walk to the mailbox / well). Think: on the hay bale with a notebook under a thought cloud of turning cogs
  (a checklist cloud for todo), a light bulb now and then. Subagents: whistling to the ducklings. Compact: stretch and
  sweep. The nameplate verb follows the flavour (rummaging, pigeon post, pondering). Props grow a little with distance
  (≈ +60 % at 45 m) so tools read across the valley.
* **Work leaves traces in the field** (`scene/farmers/traces.ts`, 2 instanced draws): at each farmer's work spot a row
  of **seed stakes** (one per file planted since the valley loaded, banked across tasks, max 6) on its right, and a row
  of **sprouts** on its left, one per test run / error: green and perky for a pass, wilted brown for a fail (newest 6).
  A busy field bristles; a quiet one is bare. Gallery `field-traces`; dev `__valley.ctx.services.get('farmers').react(id,
  'celebrate' | 'oops')`.
* **Fields read at a glance** (plots package, `scene/plots/`). *Farmers stay visible in tall crops:* wheat leaves a
  **tramline** from each back-row work spot to the headland (`cropLayout(…, lanes)`), and the crop shader **parts**
  round whoever stands in it (`uPart`: per-field world points for the field's farmers, fed ~7×/s from the `farmers`
  locator, plus the player; stalks within ~1.7 m duck to ~40 % and lean away; `PartDef.part` opts a crop in, wheat
  only). *Lifecycle:* harvested annuals leave dry **stubble** in the fallow soil (`PartDef.stubble`: wheat straw,
  withered vines, cabbage stumps, sunflower stalks) while **perennials** (`PartDef.perennial`: orchard trees, vines,
  berry bushes) stay put and only their fruit flies to the cart. *Seasons:* spring fruit sets small and green; winter
  wheat is short green shoots in the snow, pumpkin vines die back to a brown mat on straw with a few pumpkins left
  to cure, sunflowers stand as dry stalks with hanging seed heads; seedlings start larger so a new field shows its kind
  from across the valley. *Small life:* **crows** settle on the back-fence posts while a farmer struggles (struggle + 1
  of them; circling as before at ≥ 2), one when the field rests, and three glean the fallow stubble; they flush when you
  come close and drift back. *Personality:* burlap **yield sacks** fill the front-right corner (one per log step of
  lines changed in the workspace since the valley loaded, banked across tasks from `FarmerView.work`, 6 at ~1000).
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
  later opens their shortcut; F just chats (or, with something in your basket, gives a gift: see *Friendship and
  requests* below). The prompt's second line says what they open, their hearts and any request.

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
  Walk up to one (< 4.2 m) and look at them and they pause and turn to you (`heldUntil`: a 2 s grace after you look
  away, 12 s at most, never on the way to shelter), so E finds who you walked up to. `__valley.goTo(id)` picks the
  nearest approach angle from which the crosshair takes the target (not a mailbox standing in line).
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
* **Weather leaves traces and makes moments** (atmosphere package). Weather follows the real clock (`model/sky.ts`,
  3-hour blocks); `sky.trace` (`weatherTrace`, pure + `sky.test.ts`) integrates the last two days of blocks into
  `wet` (soaks in fast, dries over hours: slower at night, in fog and winter), lying `snow` (builds ~3 h to full, melts
  in rain / sun) and `sinceRain`, so every window agrees and a reload does not dry the puddles. What it drives:
  * **Wet world + puddles** (`scene/weather/surfaces.ts`): one shader-chunk patch on every toon material (no
    per-material hook; shared `VW` uniform block written by the weather system). Wet surfaces darken and richen with a
    soft sky sheen and a banded sun glint (wet lamp pools shine at night). Puddles grow and shrink with `wet` on flat
    ground-level surface-library faces (`VW_SURF`, defined by `withSurfaces`; height checked against `vwGround`, a
    128² heightmap of `heightAt`): freely on paths, the square and soil, now and then on grass; they mirror the sky
    gradient, the sun and lamp light, and ring with drops while it rains. Never on characters, never indoors.
  * **Lying snow + frost**: snow covers up-facing world faces in drifts as `trace.snow` builds (the square, roofs,
    fences, crops), with sun sparkle; on cold clear nights and mornings (winter, Nov–mid-Mar) the ground goes pale and
    twinkles with pin-point frost that shimmers as you move, until the sun has been up a while.
  * **Rainbow** on the antisolar ring in the first hour after a real shower stops, with the sun out.
  * **Mist banks** (post): at dawn a few mornings a week (more in autumn / spring, after rain, in calm air) mist
    pools over the river and pond and lies in the low ground, burning off by mid-morning; all day on fog days. Ray-
    marched in the composite against the same heightmap, drifting downwind, lit by the low sun.
  * **God rays** (post, one quarter-res pass): a low sun (early morning, golden hour) fans shafts through trees and
    gaps in the clouds; skipped unless the sun is in front of the camera.
  Already there: cloud shadows, lightning that lights the valley, seasonal leaves / petals, sun motes. Dev:
  `__valley.atmo({ wet, snow, frost, rainbow, mist, rays })` (0..1; wet/snow set the model trace, the rest force the
  scene), `atmo(null)` to follow the weather again, `atmo()` reads the eased state; `__atmo.bench(n)` = GPU ms per
  frame (timer query; A/B a moment on and off). Cost on the 780M at 1600×900 (frame ≈ 6–7 ms GPU): wet, snow, rays
  ≈ +0.3–0.6 ms each, mist ≈ +1.5 ms (dawn / fog only); no draw calls added (rays: one quarter-res post pass).
  `?quality=low` compiles the wet / puddle / snow / frost surfaces out of every toon program and skips the rays pass
  (in software rendering the untaken surface branch alone cost ~30% of the frame); mist banks stay.
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
* **Wild visitors and the field guide.** Shy, larger wildlife that rewards being in the right place at the right
  time (`scene/life/wildlife.ts`; rhythm + shyness pure and tested in `wild.ts`, sculpted models `wildModels.ts`, motion
  `wildAnim.ts`, gallery `wildAssets.ts`): a **roe doe and her fawn** graze the meadow in front of the woods near the rim
  at dawn and dusk (IK'd walk / gallop on `gait.ts`, feet on the slope, white tail flagged as they bound off); a **red
  fox** trots the hedgerows round one field after dark, stops to sniff and listen, yips; a **grey heron** stands in the
  river shallows mornings and late afternoons, wades and stabs for fish (splash, sometimes a catch), and lifts off in slow
  deep beats to land further down the river; a **tawny owl** sits on a standing stone (or a hay bale) at night, turns its
  head right round to keep you in view, blinks slowly, hoots, flits stone to stone; a **hedgehog** snuffles under the
  orchard trees on mild evenings (not winter) and curls into a ball when you come close; **greylag geese** go over in a
  long V, honking, mornings and evenings (south in autumn, home in spring). Which spot, whether today has a visit (a
  small skip chance) and arrival times wander per date (`wildDay`, seeded). Eyes catch the lamplight after dark (one
  additive glint draw). **Shyness** (`Shy`): a walking player is noticed at the species' `notice` range (a still one only
  close, a sprinting one from further); while it watches you (alert pose: head up, ears pricked, tail up) its nerves rise
  as you keep coming and settle when you stand still, so the way in is a few steps, stop, wait for the head to go down;
  sprinting at it or getting inside `flee` sends it off (deer bound, fox streaks, heron/owl fly, hedgehog curls; a third
  fright and the heron/owl leave for the window). **Field guide:** a good look (in range, in view ~0.8 s, not fleeing)
  records a sighting once a day in the Collections book's *Field guide* section (`model/collection.ts` `SIGHTINGS`,
  `sight(id)` / `onSight`, data `seen` — never a find, never in the basket); silhouettes show where / when and a tip until
  seen; a first sighting toasts and is a `found` harvest. Budget: one instanced draw per species + 1 eyeshine (≤ 7, only
  while something is out); life total stays ≤ ~23 with everything about. Sounds: `honk`, `yip`, `snort` critter voices
  (plus `hoot`, `caw`, `flap`). Dev: `__valley.wildlife()` lists, `wildlife('deer')` brings one out at its habitat and
  stands you in view (it ignores you for 12 s), `wildlife('owl', 'here')` in front of the camera, `wildlife('deer',
  'spook')` startles it; service `wildlife`. Gallery: `deer` (graze walk alert bound fawn lie), `fox` (trot walk sniff
  alert run), `heron` (stand hunt wade fly takeoff), `owl` (perch watch hoot fly), `hedgehog` (snuffle walk curl),
  `goose` (fly glide).
* **The summit trail: the valley is not a bowl you can't leave.** A hiking trail climbs the terraced south wall to a
  lookout on the rim (route + cut: `world/trail.ts`, pure, fed `padHeight` by `world/map.ts`; dressing + viewer:
  `scene/trail/`, system `trail`, service `trail`). A meadow footpath leaves the south road between fields 9 and 10 to
  the **trailhead** (signpost: length and climb, a lantern, a bin of walking sticks; E reads it), then four legs
  switchback up the strata: each leg follows the contour of one riser (half cut into the face, half built out), each
  hairpin crosses the shelf above it as a little level landing. The tread is cut into `heightAt` itself (`carveTrail`: a
  2.1 m flat core blended into the slope with pad-style weights, so two legs of a hairpin keep their own level treads),
  so the terrain mesh, scatter, forage, `clearance()` (the trail and its landings are reserved) and the player agree;
  `pathAt` paints it as dirt (and footsteps crunch). Max grade ≈ 0.45 (the controller climbs to ≈ 1.4); **log steps**
  bed across the steeper legs, **rope railings** run along the outer edge wherever it drops more than ~1.4 m, **cairns**
  mark the hairpins and the saddle, the **halfway bench** sits on the second hairpin (E: rest). From the saddle between
  two knobs a **wooden staircase** (0.24 m risers) climbs the east knob and a **rope bridge** (sagging plank deck on
  cables, hand ropes) crosses back over the saddle, 7 m up, to the summit knob: both are `walkSurface`s the trail system
  publishes by wrapping the structures' function (a deck more than 0.6 m above you is not your floor, so you can walk
  under the bridge), and the controller treats a reachable deck as walkable whatever is under it. The **summit
  lookout** (≈ 40 m above the trailhead, 44 m above the square's level): a deck with a railing on the valley side, a
  bench facing north over the whole valley to the waterfall and the far ranges, a lantern (a real `LightEmitter`), a
  Claude-orange swallow-tail flag that streams with the wind, a windswept pine and the **summit cairn** (E: leave a
  stone, once a real day; the count is kept per browser profile in `claude-valley.summit.v1` and the pile grows, one
  InstancedMesh). **The valley viewer** (a teal coin-op binocular viewer; "free for valley folk"): E zooms the camera
  onto a farmer down in the valley, framed ≈ 5 m wide, through a binocular mask, with their tag and what they're doing
  (`needs you: …` first); ← / → cycle farmers (needs-you first, then working, then the rest), ↑ / ↓ zoom, the mouse
  nudges the view; E, Esc, any walking key or a panel steps back. The view steers the player's own yaw / pitch (lights,
  culling and labels see the real view) and looks from the viewer's eyepieces, leaning out past the rail. Map data:
  `TRAILS` (polyline, for the map) and `POIS` (trailhead, halfway bench, rope bridge, summit) in `world/map.ts`. Budget:
  6 draws when in view (1 baked solid + 1 glow, the sign, the viewer head, the flag, the offered stones; +1 mask while
  viewing), ~0.02 ms a frame. Dev: poses `trailhead trail bridge summit`; `__valley.ctx.services.get('trail')`:
  `view(i)` (stand at the viewer and look at farmer i), `leave()`, `stones()`, `route()`, `hike()` (walks the whole
  route holding W, resolves `{ done, at, of, secs }`: a regression check for walkability); gallery assets
  `summit-lookout`, `rope-bridge`, `trail-stairs`, `trailhead`, `trail-cairn`, `windswept-pine`.
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
* **Friendship and requests (villagers).** Pure + tested `model/friends.ts` (service `friends`, `HudBindings.friends`,
  persisted per profile in `claude-valley.friends.v1`); dialogue in `scene/villagers/friendlines.ts` (pure, tested); HUD
  `hud/friends.ts` (panel `friends`, the request tracker, toasts). Each villager has **hearts** (0–10, 100 points each):
  the day's first chat (E or F) +20, **one gift a day each** from your basket (F on a villager while the basket has
  something → the gift picker, 1–9 or a click; loved +80, liked +45, anything else +20, disliked −25), a finished request
  +60. Tastes fit the roles: Hazel loves hazelnuts, acorns, chanterelles; Nimbus frost crystals, the message in a bottle,
  thunder bass, moonlit char; Fern feathers, pinecones, morels, trout; Bram the big fish (salmon, pike, carp, thunder bass);
  Posy violets, wild strawberries, mussel shells; Mayor Marigold the showy prizes (golden koi, chanterelles, maple leaves,
  moonlit char). What they think of a gift is remembered and shown in the picker and on their card. Reactions are lines
  in their voice + an emote (heart / sparkle / note / sweat). **Requests:** each real day 1–3 villagers post one
  (`requestsFor(day, season)`, deterministic, feasible in season): bring N of an in-season forageable (counted from the
  basket, taken on delivery), catch a fish (any weather; sometimes "before dusk", or "anything after dark"), visit a far
  nook at the right hour (the standing stones after dark, the stargazers' knoll at night, the swing tree, the hot spring
  at dusk, the orchard by day, the hay meadow: the villagers system checks where you stand twice a second), or agent work
  via `ValleyEvent`s (answer a farmer who needs you = `unblocked`, ship a commit = `ship`, a green test run = `celebrate`,
  a finished task = `finished`). Talking to them the first time says the request (instead of opening their shortcut);
  when it's done (toast "Request ready") E on them hands it over: bits (`WalletService.reward`) + hearts, a thank-you
  line, a heart emote. Unfinished requests lapse at midnight. The **tracker** (`data-testid="quests"`) sits under the
  dock (top right, a `data-hud-obstacle="children"` child of the dock) as a one-line chip (`♥ 0/3 requests`, a gold `!`
  while one is ready); hover / focus opens it, a click or **Q** keeps it open (pref `valley.hud.quests` = `open`), and
  it peeks open for 10 s when a request turns ready; it hides under big panels, rows open the Friends panel; the
  noticeboard pins a Requests note; the prompt's hint line shows
  `♥ n` and "has a request" / "request ready!". **Milestones:** 2 ♥ a letter, 4 ♥ warmer lines (`closeLine`), 6 ♥ their
  own decor piece in the General store (`DecorDef.friend`: Posy's pillar box, Bram's crate stack, Hazel's millstone
  table, the Mayor's prize pumpkin, Fern's pup tent, Nimbus's weather vane), 8 ♥ a recipe letter, 10 ♥ a keepsake portrait
  on an easel (`keep-<id>`, `DecorDef.keepsake`, never sold) given into your yard with a last letter. Letters are kept in
  the friends data and re-posted to the mailbox on load (`Valley.post`, kind `news`). Dev: `__valley.hearts(id?, n?)`,
  `requests()` / `requests('ready')` / `requests('YYYY-MM-DD')` (that date's set, as today's), `gift(id, item)`.
* **Evening gatherings: the valley is a community** (pure + tested `model/gatherings.ts` schedule and stories,
  `scene/gather/` system + service `gatherings`, slot maths in `slots.ts`). The calendar (`scheduleFor`, seeded per day):
  **campfire evenings** on most clear nights (~86 %, about 19:30–22:00; rain and storms cancel, light snow or fog
  don't); a **bandstand concert** 18:30–20:15 on Saturdays, Sundays and festival nights once the bandstand upgrade is
  in (everyone then moves on to the fire); a **market morning** on Saturdays 8:00–11:30 once the stalls are up.
  *Gatherings never hide state:* only `idle` / `done` farmers that don't need you attend (`canAttend`); a farmer that
  starts work or gets blocked leaves at once (the brain's `World.gather()` is asked every plan, so needs-you still runs
  to the gate). Villagers come on their evening slot (~78 %, regulars always; market browsing is a seeded ~40-minute
  visit from their post). **Campfire:** farmers take the logs and the stool, villagers the grass ring; a 4-minute cycle
  (`CAMPFIRE_CYCLE`) of a **story** (the teller, chosen among the settled, says one line every ~10 s in a speech bubble,
  built from ValleyState / almanac only by `storyLines`: crates shipped, green test runs, who planted what, a stubborn
  bug, a finished task title, the streak, the next rank; first person for the teller's own deeds), **laughter**
  ("ha!" emotes, a chuckle chorus), **toasting marshmallows** (held prop), a **sing-along** (the music plays the
  `campfire` waltz, notes over heads) and chat. **Concert:** three farmers climb the steps and play fiddle, banjo and
  flute (props + strum / bow / blow poses, a warm lamp under the roof after dark), the crowd arcs out front dancing and
  clapping, applause between songs; the music plays the `concert` piece *live* from the stage. **Market:** villagers
  browse the counters and gossip between the stalls. **Join in:** E on a free log bench ("Sit on") sits you down
  (`controller.sit`, the eye lowers to 0.98 m and turns to the fire; any move key stands you up) and, once a day, every
  villager present gains friendship (`friends.gathered`, +30 pts each). Props and acts reuse the farmer Crowd's
  vgroup variants (no extra draw calls); the system ticks at 4 Hz and allocates nothing per frame.
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
  noticeboard pins a poster, and a toast greets you once per real day (`hud/festival.ts`, not on every reload). Force one on any date with
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
* **The map (M) and the minimap** (`hud/map.ts` panel + minimap + layer toggles, `hud/mapdraw.ts` live layers and chart
  furniture, `hud/mapbase.ts` the painted base, `hud/mappins.ts` pin glyphs + place data, `hud/map.css`). A hand-drawn
  parchment chart, **painted once** in idle time (`warmBase`, ~5 px/m over the whole 300 m world, repainted only when the
  season changes; the minimap blits a half-res copy and never forces the build): a watercolour wash (meadow mosaic,
  groves, the forest ring, mossy shelves, ochre rock, pale peaks, faded to bare paper at the world's edge), paper grain
  and tea stains, **hachures** down every steep slope (the cliff strata read as inked bands), the river with inked banks
  and flow dashes, the pond with ripple rings, beach and lily pads, the waterfall and the four cascades, roads as inked
  double lines (ruts on the big ones), footpaths dashed, **trails** (`world/map.ts` `TRAILS`) as red dots, hedgerows,
  stamped trees (round / pine / willow, seasonal; the map re-plays flora/scatter.ts's noise, hud never imports scene
  systems), the square's cobbles, the yard's picket fence, the garden, and every landmark as a little drawing with a
  cast shadow. Per frame (only while open; the minimap at ≤ 30 Hz) it blits the visible part and draws the live layers:
  fields, hint washes, place tiles, the festival, request hearts, scarecrows, villagers, farmers, labels (greedy, never
  over a pin, sign or the furniture), the player arrow + view cone, then the cached furniture: compass rose (top right),
  title cartouche "Claude Valley · season · festival · rank" (bottom right, shrinks on laptops), scale bar, deckled edge.
  **Pin language** (`mappins.ts`; the side panel's *Key* draws the same pins): circles = farmers (status colour, gold
  pulsing ring = needs you), houses = villagers, crosses = scarecrows, rounded **tiles** = places (store, mailbox +
  unread count, your yard, the farmhouse door, nooks, fishing spots with what bites now, trail stops from `POIS`:
  trailhead / bench / rope bridge / summit), **hearts** = today's requests (on the villager, or on the place to visit;
  gold + pulsing when ready), the **rosette** = the festival centrepiece (`festivals.where().center`). Hover any pin for
  a tooltip; only farmers / scarecrows (and fields, Shift) act on a click. **Layers** (toggle chips over the key,
  remembered in `valley.hud.mapLayers`; `data-testid="map-layer-<id>"`): *Places* and *Requests* on by default,
  *Forage* (soft washes nudged off today's unpicked spots: the area, never the spot) and *Wildlife* (habitat washes
  with the species' paw tile and when, "out now!" + a pulse while one is about, dimmed out of season; text from
  `SIGHTINGS`). Live data comes through `HudBindings.service(name)` (forage, wildlife, festivals, yard → the store),
  `friends`, `collection`, gathered ≤ 3×/s. The key starts folded on screens ≤ 860 px tall (toggle remembered).
  **Minimap:** the same art; fields, villagers, hearts, the store and festival, farmers; a farmer who needs you is
  bigger with a gold halo and, when off the minimap, waits on the rim with a pointer toward them.
* **First-run welcome + tips** (pure + tested `model/onboarding.ts`, HUD `hud/onboarding.ts` + `onboarding.css`, panel
  `welcome`, service wired in `main.ts`, persisted per profile in `claude-valley.onboarding.v1`). On a profile's first
  visit **Posy the postmaster** hands you a letter (airmail-edged, her stamp): agents are farmers, fields are workspaces,
  a golden ! needs you, every terminal is a key away. *Let's go* (Enter / Esc) starts the tour, *Skip the tour* doesn't;
  then she says hello over by the mailbox. The tour is a small foldable / closable checklist bottom-left (right of the
  needs-you strip while it is open; `data-hud-obstacle="children"`; hidden under any panel), ticked by **real signals,
  never by duplicated logic**: look around + take a stroll (the player's own yaw / feet at 4 Hz, teleports and panels
  ignored), say hello to a villager (hud.ts's E / F on a `villager`), open a terminal (the `drawer` panel opening, from
  F, the dock, the map, anywhere), answer someone who needs you (`ctx.answer` succeeding; **skipped** when it comes up
  and nobody needs you, a later answer still ticks it), the map (M) and the ledger (Tab) panels, and *when you have a
  moment: a pastime* (any of: a find from `collection.onFind` → pick something up / cast a line, or `indoors.active` →
  the farmhouse; each lights a chip). Steps tick in any order; the current one shows its how-to. Finishing pays
  **50 bits**, gives the **Welcome sign** (`welcome`, `DecorDef.gift`: never stocked, never sold) straight into the yard
  and posts Posy's "Welcome home" letter (re-posted on load) — once per profile, a replay pays nothing. **Replay the
  welcome** is in the pause menu. **Tips** (`HINTS`): one-time hints in the same corner, queued by the world (a farmer
  needs you → "Alt+1 answers from anywhere"; rain → "fish bite better in the rain"; night; the first find in your
  basket → sell to Bram / gift), at most one per 4 min, the first 45 s after the welcome closes, never during the tour,
  a panel / terminal, typing or photo mode; × dismisses, *Tips off* or Settings → *Valley tips* turns them off.
  **Automation:** `navigator.webdriver` (Playwright tests, `npm run shoot`) skips the welcome and the tips unless the URL
  has `?welcome=1` (forces a fresh tour); `?welcome=0` never shows it. Dev: `__hud.tour.tip(id)`, `.signal(s)`,
  `.data()`; shots: `npm run shoot -- --shot name=w,pose=hub,welcome=1` (the letter), add
  `eval=setTimeout(()=>document.querySelector('[data-testid=welcome-go]').click(),1800)` for the checklist.
* **Names:** compact spots (needs-you cards, map pins and the side lists, ledger rows, the drawer's list and header,
  the farmer card's title) use `shortName()` = the in-world `tag`; the full herdr name goes on a secondary line or a
  tooltip via `altName()` (`hud/format.ts`, tested). Map pins carry one glyph (`pinGlyph()`: the tag's suffix).
* **HUD layout: calm by default, informative on demand.** The world is the point; furniture keeps to fixed zones at the
  edges that never overlap at 1280×720, 1366×768, 1600×900 or 1920×1080 (check `mixed`, `queue`, `crowd40`, with panels
  open and closed and toasts flowing; `__hud.toast({ text, sub, level, key })` pushes one). Sizes come from two tokens on
  `.vh-layer`: `--gut` (12 px; 10 px under 820 px tall) and `--left-w` (300 px; 288 px ≤ 1440 wide; 272 px ≤ 900 wide).

  ```
  [☀ 16:00  Thu 1 Oct      ]                                              ( minimap )
  [● Demo valley 5 working 2 done]                                   [J][M][Tab][⌃`][Esc]
  [(🏵 Harvest Town ▬) (🪙 0)]                                        (♥ 0/3 requests ▸ 📖)
  (🔔 1 farmer needs you ▾)
  [ open ask: 2-line question ]
  [ 1 Yes                     ]
  [ 2 Yes, and don't ask a…   ]                                     [ toast ×2 ]
  [ Terminal ][ Walk there    ]                                     [ toast    ]
  [ row ] [ row ]     (onboarding checklist / tips)      Click look around · M map · … · ? all keys
  ```
  * **Top-left column** (`.vh-left`, `--left-w` wide). The **status sign** in three short rows: the clock with the date
    and season icon (the season's name in the tooltip); the link pill and *working / done* counts (who needs you is the
    chip right below, so the sign doesn't repeat it); the **rank chip** (rosette, name, a tiny bar; opens the Almanac)
    and the **coin chip** (opens your pockets) side by side. Under it the **needs-you strip**: a count chip, then the
    asks newest first: one open **compact card** (name + Alt+N; the question clamped to two lines, all of it in the
    tooltip and on keyboard focus inside the card; one single-line button per answer, the full label in the tooltip and
    on keyboard focus; Terminal + Walk there). **Nothing in the card reflows on hover or mouse focus**: growing text
    would push the answers under a pointer on its way to one (a wrong answer, or a lost click); the new-ask ring is a
    transform / opacity pseudo-element, never the card's or a button's own box and the rest as one-line rows (click / Enter opens one; the green button opens its
    terminal). The chip folds the list (click or Alt+0; pref `compactStrip`). **Dozing:** after 25 s of walking about
    (pointer locked, no panel: `.roam`) without a new ask the list tucks itself behind the chip, which keeps a slow gold
    pulse (a ring on `::after`); it never tucks while the pointer is free (you just arrived, paused, or have a panel up),
    and freeing the pointer, a new ask, the chip or Alt+0 brings it back (pref `needsDoze`, Settings → *Tuck an
    unanswered ask away*). Keyboard flows never depend on what is shown: Alt+1…9, J then 1–9 / Enter work while dozing
    or folded.
  * **Top-right column** (`.vh-dock`): the minimap (160 px; 136 px on short screens), the dock buttons (mail, map,
    ledger, terminals, menu), then the request tracker chip.
  * **Bottom-right:** the key-hints bar (E / F live on the interaction tag instead; the bar dims while you walk about
    with the pointer locked: `.vh-layer.roam`) and above it the **toasts**: at most two (one under a big panel), 4 s by
    default (asks and warnings 5.5 s, errors 7 s), hovering holds one, and the same kind **coalesces** in place with a
    `×n` count instead of stacking (`ToastSpec.group`, else the key's first `|` segment: `commit|…`, `ans|…`, `ready|…`).
    Background toasts (letters, server toasts, festival greetings: `push(t, true)`) never push off a confirmation of
    something you just did; they squeeze in beside it (one over the limit for its few seconds).
  * **Bottom-left:** the onboarding checklist and one-time tips (`hud/onboarding.ts`; right of the strip while it is open).
  * **Top-centre:** only the offline banner (it docks bottom-left under a big panel).
  * **z-order** (tokens in `hud.css :root`): anchored world tags 5 · interaction tag 6 · hints 20 · panel backdrop 30 ·
    left column 40 · dock 41 · welcome card 45 · panels 50 · terminal dim 54 / drawer 55 · toasts 60 · banner 70. The
    left column sits above the backdrop so asks stay clickable beside any panel.
  * Every zone is HUD furniture for the anchored bubbles (`data-hud-obstacle`: the sign, the strip's children, the
    dock's children, hints, the toasts' children, banner, drawer); children of a `children` obstacle are size-watched
    too, so CSS-only changes (the tracker opening on hover) re-measure.
* **Layer classes** (on `.vh-layer`, set by `hud.ts` / `needs.ts`; style against them instead of measuring): `modal` (any
  panel), `covered` (a big panel, not the side card: hints hide, toasts drop to one compact one and only asks / errors
  pop, the offline banner docks bottom-left, the tracker hides), `side` (the side card is open: toasts stand to its left,
  off its buttons), `has-needs` (the strip is unfolded and awake: centred panels shift right by `--lw` so the strip stays
  clickable beside them; the mailbox sits between the strip and the dock), `roam` (pointer locked, no panel open).
* **Empty and offline states:** every list says what is going on and what to do (no farmers yet → open a herdr
  workspace; herdr offline → it comes back on its own); never an empty frame.
* **Drawer:** bottom-anchored; drag the grip on its top edge (or ↑/↓ on the focused grip) to resize, double-click to
  reset; the height is the `drawerH` HUD pref (browser-local, like `minimap`, `toasts`, `compactStrip`, `notify`).
* **Performance:** the 4 Hz tick refreshes only what changed (keyed rows with per-row signatures: `syncList`, the
  ledger's row cache); nothing in the HUD reads layout per frame except the map canvas, which redraws only while open.
  Check with `npm run shoot -- --scenario crowd40 --shot name=r,pose=hub,panel=roster` (fps in the printed perf).
## Sound (`audio/*`: WebAudio synthesis, no files)

* **Buses** (`engine.ts`): sfx, notify, voice → master; ambient (the beds, critters, other packages' loops) and
  **music** → a hidden-tab duck (30 %) → master. Every bus has its own slider (pause menu → Sound: master, effects,
  ambience, alerts & chimes, farmer voices, music; square-law taper in `mix.ts busGains`). Master chain (`buildMaster`,
  shared with the offline mixdowns): a gentle glue compressor (−16 dB, 2:1) then a fast limiter (−4 dB, 20:1). Indoors
  the outdoor beds go through a low-pass and duck; the music, the `roof` rain and loops started by the interior stay dry.
* **Music** (`musicPlan.ts` pure + tested, `music.ts` player, `instruments.ts` band). Pieces, not a drone: a piece is
  planned for the moment (`musicScene`: morning 5–11, afternoon 11–17, evening 17–21:30, night, rain (storms too,
  quieter; a fierce storm gets none), indoors) with a key, a mode, a tempo (56–108 bpm), 3/4 or 4/4 and a song form
  (`iAABAo`, `iABAo`, …: 2 intro bars, 4- or 8-bar sections, 2 outro bars; ≈ 45–125 s). Melodies come from a 2-bar motif
  stated, sequenced, restated and cadenced; strong beats sit on chord tones, weak beats on the mode's pentatonic,
  everything is diatonic, A ends home and B on the dominant. After a piece it **rests 15–75 s** (longer at night) so the
  valley's own sound carries the silence. Going in / out or a storm fades the piece within ~1 s; a new hour or rain lets
  it finish. **Seasons change the band** (`KITS`: spring flute + kalimba, summer marimba + guitar, autumn reed +
  guitar, winter glockenspiel / music box + electric piano; rain = electric piano + strings; indoors a parlour waltz).
  **Festivals** (`sky.festival.active`): every other outdoor piece is the festival's own, built on its leitmotif and
  instrument (`FESTIVAL_MUSIC`: Blossom flute reel, Lantern bell lullaby, Founders' "happy birthday" music box waltz,
  Harvest barn-dance oom-pah, Hallowtide minor celesta + pizzicato, Starlight jingle bells + sleigh shaker, New Year
  auld lang syne on a soft horn), auto-harmonized (`harmonizeTune`). Tunes are seeded per real day. Ducks to 25 % under
  notifications and to 60 % while someone near you talks.
* **Gathering music** (`GATHER_SCENES` in `musicPlan.ts`; `MusicIn.gathering` from the `gatherings` service's
  `music(listener)`): near a campfire sing-along (≤ 80 m) the piece is the `campfire` waltz (84 bpm 3/4, reed + guitar,
  the `CAMPFIRE_SONG` motif); near a concert (≤ 115 m) the `concert` piece (100–116 bpm, strings / guitar / flute,
  percussion, short rests between songs). Starting one fades the current piece; while it plays the music bus is
  **placed** at the fire / stage (`music.place(pan, gain)`: spatial pan × 0.75, distance gain floored at 0.22).
* **Footsteps** (`steps.ts` pure + tested, `STEP_RECIPES` in `sfx.ts`): the controller's grass / water / wood is refined
  from where you stand: paved square = stone, roads (`pathAt` > 0.55) = dirt crunch, decks (bridge, dock, porch) = hollow
  wood, the farmhouse = floorboards (one creaks now and then), lying snow (`sky.trace.snow`) or winter above the snow
  line = snow crunch, wading = splash; wet ground (`sky.trace.wet`, lingers after rain) adds a puddle splash. Steps
  alternate a touch left / right; `STEP_GAIN` levels the surfaces.
* **Ambience** (`ambience.ts` + pure `ambientLevels` in `mix.ts`, loops in `loops.ts`): wind (gusts), rain, river /
  waterfall / pond by distance (positional), dawn chorus and daytime birds, crickets (tempo follows the CPU
  thermometer), owls and pond frogs at night, the campfire after dusk, the windmill (creak period = CPU), bees by live
  hives, **leaves** rustling with the gusts out in the countryside (thin in winter) and **cowbells** near a cows / sheep
  field by day. Beds are built only while audible and retired after 8 s of silence.
* **Levels** (measured offline, default sliders, momentary loudness in dBFS after the master): land beds ≈ −40, near
  water −28…−33, music ≈ −34, footsteps ≈ −31…−36, needs-you alert peak ≈ −5; mixes peak below −11 dBFS. Instruments are
  trimmed to equal loudness (`INSTRUMENT_GAIN`), roles balanced in `ROLE_GAIN`, overall `MUSIC_LEVEL`. CPU: the audio
  system costs ≈ 0.1 ms / frame; music schedules ≲ 30 notes a bar (a few oscillators each).
* **Measure, don't guess** (`audio/debug.ts`, loaded on demand): `const d = __valley.ctx.services.get('audio')._debug`;
  `d.render('inst:flute:67' | 'step:dirt:wet' | 'loop:leaves:1' | 'piece:evening:autumn:harvest' | 'alert')` → peak /
  RMS / momentary loudness / spectral centroid / HF share; `d.mix('meadow,music=afternoon,steps=grass')` renders 20 s of a
  moment per layer and through the master (presets: square meadow river pond campfire mill falls dawn rain storm snow);
  `d.pcm(name, s)` returns 16-bit PCM for a WAV; `d.renderAll()`; `d.stats()` (beds, music piece / bar / rest);
  `d.next()` skips to the next piece; `d.music(false)`.

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
| **life & sound** | `scene/life/*`, `audio/*` | ambient critters (birds, butterflies, fireflies, fish, frogs, village dog & cat), wild visitors, services `audio`, `pets`, `wildlife` |
| **hud** | `hud/*` | every DOM overlay, terminal drawer, `UiPort` |
| **interior** | `scene/interior/*` | the walk-in farmhouse room, service `indoors` (`IndoorSpace`) |
| **trail** | `scene/trail/*` (route + cut in `world/trail.ts`) | the summit trail's dressing, staircase / bridge / deck `walkSurface`s (wrapping structures'), the valley viewer, the summit cairn, service `trail` |
| lead | `model/*`, `world/*` (API), `scene/{engine,context,toon,assets,systems}.ts`, `player/*`, `dev/*`, `main.ts`, scripts | contracts |

## Budgets (1600×900 on the Radeon 780M iGPU, 12–16 agents, `mixed` demo)

60 fps. Draw calls ≲ 600 total: land ≤ 120, structures ≤ 120, plots ≤ 150, farmers ≤ 100 (villagers ≈ 10 of it), life ≤ 40, forage ≤ 10, yard ≤ 6 (4 merged/instanced, +2 while carrying), trail ≤ 8, interior ≤ 40 (only while inside),
atmosphere ≤ 30 + post. One shadow-casting directional light (atmosphere owns it; shadow camera follows the player).
Check `__valley.perf()` → `calls`, `tris` (main + shadow pass), `systemMs`. GPU ≤ 10 ms a frame at the hub and the
top view (`npm run bench`; ≈ 7–8 ms today), CPU frame (`cpu`) ≲ 8 ms with `crowd40`.

### Benchmark (`npm run bench`)

`scripts/bench.ts` drives the real GPU (same Chromium flags as `shoot`) through `mixed` and `crowd40` × day (10:00
clear) / night (22:00 clear) / rain (14:00) × 7 poses (`hub square river pond east top inside`; `top` = free camera
`0;90;70;0;-0.95`) and prints one row each: `gpu` (whole frame, `EXT_disjoint_timer_query_webgl2`, median of reps),
split into `scene` (incl. the shadow map), `shadow` (scene with shadow updates on − off) and `post` (bloom, rays,
composite, FXAA); `cpu` (frame loop EMA: hooks + systems + submit), `sys` (sum of systems), `submit` (JS/driver time
of the render call), `calls` / `shCls` (shadow pass share) / `tris`, and the top three systems.

```sh
npm run bench                                                   # everything (~6 min)
npm run bench -- --scenario mixed --cond night --pose hub,top    # a slice
npm run bench -- --json scratch/bench/a.json --shots             # keep numbers + a PNG per row (scratch/bench/)
npm run bench -- --quality low --eval "__valley.atmo({mist:1})"  # A/B a setting
```

The machine is shared (agents shooting): check `uptime`, compare medians of A and B run alternately, and trust the GPU
columns over `cpu` when the load is high (timer queries still include time-slicing with other GPU clients). Per-pose
costs worth knowing: mist banks ≈ 0.3 ms (night / dawn), wet surfaces ≈ 0.7 ms (any toon pixel while `wet` > 0; dry
costs nothing), god rays ≈ 0.1 ms, shadow map ≈ 0.5 ms, post ≈ 1.2 ms. Rules of thumb: a `DoubleSide` material does
not need explicit back faces (`plots/geo.ts` `singleSided`); a valley-wide `InstancedMesh` cannot be frustum-culled
by three, so pack only what is in view (`plots/meadow.ts`); transparent `DoubleSide` materials take
`forceSinglePass: true` when additive (else three draws them twice and re-resolves the program each frame).

## Verify your work (do this constantly)

```sh
npm run typecheck                                   # all projects
node --test "renderer/src/farm/**/*.test.ts"        # model + layer rules (+ your pure tests)
npm run shoot -- --shot name=a,pose=hub,hour=10     # screenshots on the real GPU → scratch/shots/a.png, prints errors + perf
npm run bench -- --scenario mixed --pose hub,top      # GPU / CPU ms, calls, tris per pose (see Budgets → Benchmark)
npm run shoot -- --shot name=n,pose=square,hour=22,weather=rain
npm run shoot -- --shot name=f,goto=d1:p2           # stand in front of a farmer / plot / structure id
npm run shoot -- --shot 'name=top,cam=0;90;70;0;-0.95'  # free camera x;y;z;yaw;pitch (quote: ';')
npm run shoot -- --shot 'name=w,gallery=dog,variant=run,frames=12,every=70,clip=400;100;900;700'  # flipbook: N frames tiled into one PNG
npm run shoot -- --shot name=m,pose=hub,panel=map    # HUD panel (map mailbox roster …); hud=0 hides the HUD; term=ID opens a terminal
npm run shoot -- --shot "name=mw,pose=hub,hour=19,panel=map,eval=setTimeout(()=>{dispatchEvent(new KeyboardEvent('keydown',{key:'9'}));document.querySelector('[data-testid=map-layer-wildlife]').click()},1500)"  # whole valley + wildlife layer
npm run shoot -- --url 'http://127.0.0.1:PORT/?t=TOKEN' --shot name=live,pose=hub   # a running backend (live herdr; npm run build first)
npm run shoot -- --shot name=g,gallery=windmill,param=0.8   # one asset in the gallery
npm run shoot -- --shot name=g,grid=structure        # every asset of a group
npm run shoot -- --shot name=u,pose=square,almanac=3400,hour=22,eval=__valley.fireworks(30)  # every town upgrade + a show
npm run shoot -- --shot name=f,pose=square,festival=hallowtide,hour=21   # a festival (blossom lantern founders harvest hallowtide starlight newyear)
# __valley.almanac(points) sets prosperity live (crossing a rank pops its upgrade in)
npm run shoot -- --shot "name=c,pose=hub,panel=collection,eval=__valley.collect(16)"   # the Collections book
npm run shoot -- --shot "name=f,pose=hub,eval=__valley.fish('demo'),frames=9,every=450"  # cast, bite, catch (flipbook)
npm run shoot -- --shot "name=p,pose=hub,eval=__valley.forageGo(0)"                       # stand over today's first find
npm run shoot -- --shot "name=w,hour=7,weather=clear,eval=__valley.wildlife('deer')"       # a wild visitor at its habitat (fox owl: hour=22; heron hour=9)
npm run shoot -- --shot "name=wf,hour=9,weather=clear,hud=0,wait=500,eval=__valley.wildlife('heron');setTimeout(()=>__valley.wildlife('heron','spook'),1500),frames=12,every=200"  # take-off
npm run shoot -- --shot "name=g,hour=8,weather=clear,pose=hub,eval=__valley.wildlife('geese'),wait=5000"   # a skein going over
npm run shoot -- --shot "name=y,hour=11,eval=__valley.furnish();__valley.yard()"   # your yard, filled (hour=21 for the lights)
npm run shoot -- --shot "name=yc,hour=11,eval=__valley.furnish();__valley.yard('carry')"   # carrying: slot rings + ghost
npm run shoot -- --shot "name=st,hour=11,eval=__valley.yard('store')"     # the General store cart
npm run shoot -- --shot "name=sp,pose=hub,eval=__valley.coins(800);__hud.open('shop',{tab:'buy',at:'store'})"  # shop panel (tab buy|sell|yard)
npm run shoot -- --shot name=d,gallery=decor,variant=scarecrow:2     # one decor piece (id or id:style)
npm run shoot -- --shot "name=fa,goto=villager:fern,hour=10,eval=setTimeout(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'})),1200)"  # a villager asks for today's request
npm run shoot -- --shot "name=fg,pose=hub,eval=__valley.hearts('posy',7);__valley.gift('hazel','boot');__valley.ctx.services.get('wallet').stash('koi',2);__hud.open('friends',{give:'villager:marigold'})"  # Friends panel + gift picker
npm run shoot -- --shot "name=fd,goto=villager:hazel,hour=10,eval=__valley.requests('ready');setTimeout(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'})),1200)"  # hand a request over
npm run shoot -- --shot "name=fs,hour=22,eval=__valley.requests('2026-10-06');__valley.goTo('stones')"   # a visit request (stones after dark) turning ready
npm run shoot -- --shot name=w,pose=hub,hour=10,welcome=1,wait=3000   # the first-run welcome letter (Posy)
npm run shoot -- --shot "name=wl,pose=hub,welcome=1,eval=setTimeout(()=>{document.querySelector('[data-testid=welcome-go]').click();__hud.tour.signal('map')},1800)"  # the tour checklist
npm run shoot -- --shot name=i,pose=inside,hour=10          # farmhouse interior (inside:hearth|shelf|desk|bed|tank|window|sun|room)
npm run shoot -- --shot name=s,pose=summit,hour=18.6         # the summit lookout at dusk (poses trailhead trail bridge summit)
npm run shoot -- --shot "name=v,pose=summit,hour=10,eval=__valley.ctx.services.get('trail').view(0),wait=2500"   # the valley viewer on farmer 0
npm run shoot -- --shot "name=h,pose=trailhead,eval=__valley.ctx.services.get('trail').hike().then(r=>window.__h=r),wait=40000,log=JSON.stringify(window.__h)"  # hike it: done=true

npm run shoot -- --scenario longIdle --shot "name=g,hour=20.6,weather=clear,eval=__valley.gather('campfire'),wait=80000"  # campfire evening from the viewpoint (farmers walk ~60–80 s)
npm run shoot -- --scenario longIdle --shot "name=gs,hour=20.6,weather=clear,eval=__valley.gather(...'campfire|sing'.split('|')),wait=80000,frames=6,every=600"  # jump to a segment (story laugh toast sing chat)
npm run shoot -- --scenario longIdle --shot "name=c,hour=19.2,weather=clear,eval=__valley.gather('concert'),wait=75000"   # the band + dancing crowd (auto-unlocks the bandstand)
npm run shoot -- --scenario longIdle --shot "name=mk,hour=9.5,weather=clear,eval=__valley.gather('market'),wait=40000"   # market morning
# __valley.gather() → debug state; gather(null) back to the calendar; 3rd arg stay=true keeps a free cam= (no commas in eval: split a '|' string)
npm run shoot -- --shot "name=ir,pose=inside:hearth,hour=21,weather=rain,eval=__valley.collect(28)"  # night, rain on the glass, full shelf
npm run mapviz                                      # top-down map PNG, no browser
npm run audit:placement                             # floating / sunk / overlapping assets → scratch/placement/ (below)
npm run dev                                         # interactive: /, /gallery/, /workbench/
npm run app  |  npm run app:demo                    # Electron: live herdr session | demo world
# in game: F3 perf overlay, F4 valley state inspector, F6 debug labels, P photo mode (fly, [ ] time, wheel zoom, Enter → PNG)
# __valley.meteor() launches a shooting star where the camera looks
npm run shoot -- --shot "name=wet,pose=hub,hour=16,weather=clear,eval=__valley.atmo({wet:1})"        # puddles after rain, sun out
npm run shoot -- --shot "name=rb,hour=16.5,weather=cloudy,cam=0;3;10;-1.3;0.2,eval=__valley.atmo({wet:0.9,rainbow:1})"  # rainbow
npm run shoot -- --shot "name=mist,hour=7,weather=clear,cam=0;22;70;0;-0.22,eval=__valley.atmo({mist:1})"   # dawn mist on the river
npm run shoot -- --shot "name=gr,hour=16.8,weather=cloudy,cam=0;3;10;1.87;0.3"                          # god rays (face the sun)
npm run shoot -- --shot "name=sn,pose=hub,hour=10,weather=snow,season=winter"                             # lying snow builds
npm run shoot -- --shot "name=fr,cam=0;2.2;14;0;-0.35,hour=7.6,weather=clear,eval=__valley.atmo({frost:1})"  # frost sparkle
```

Read the PNGs you produce (they are the ground truth), compare against the art direction, iterate. Poses:
`hub farmhouse square windmill pond barn river plots east trailhead trail bridge summit` (`dev/api.ts`). The in-page API `window.__valley`
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
