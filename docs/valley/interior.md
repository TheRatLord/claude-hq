# Walk-in rooms: the farmhouse and the barn

Two walk-in rooms: the farmhouse (hearth, the Almanac desk, the Collections shelf and fish tank, a CRT terminal desk,
the real valley through the windows) and the barn (animals and daily chores, a hay loft, the machine room with the
valley's system gauges). Interior package.

Key sources (paths relative to `renderer/src/farm/`):

* `scene/interior/interior.ts` is the room registry: system `interior`, service `indoors` = `IndoorSpace`.
* `space.ts` holds the room contract: `RoomDef`, `RoomBuilt`, `RoomHost`, `Frame`.
* Farmhouse:
  * `house.ts` is the room definition.
  * `layout.ts` is pure, tested by `interior.test.ts`.
  * Building: `room.ts`, `pieces.ts`, `view.ts`.
* Barn:
  * `barn.ts` is the room definition and its life.
  * `barnLayout.ts` is pure, tested by `barn.test.ts`.
  * Building: `barnRoom.ts`, `barnPieces.ts`, `donkey.ts`.
* Gallery assets: `assets.ts`.
* Chores model: `model/barn.ts` (pure, tested by `barn.test.ts`).
* Audio: `AudioService.indoors(k, { roof })` in `audio/`.

## The room system

`ROOMS = [houseRoom, barnRoom, grottoRoom]` (the grotto is a cave behind the waterfall: [grotto.md](grotto.md)). Each room is a `RoomDef`:

* **Plan** (pure, room-local): `floor(lx, lz, ly?)`, `contains`, `pushOut(l, r, ly?)`, `entry` / `exit`, named
  `views`, a `pet` spot, a `roof` loudness and an optional outside `door`.
* **`build(host, season)`**: builds the live half lazily on the first visit, kept between visits and rebuilt when the
  season changes. It returns:
  * a root group, placed in the structure's frame;
  * emitters and `interactables()`, registered only while inside (ids `interior:*`);
  * the hooks `entered`, `left`, `update` and `dispose`.

The system owns everything rooms share:

* the real-time fade (works at timescale 0);
* hiding the outdoor scene, except lights and `userData.indoors`;
* the `indoors` service and the audio muffle;
* walking out of the walls, which counts as leaving.

Floors are multi-level: `IndoorSpace.floor(x, z, y?)` and `resolve(p)` take the feet height. The controller, the jump
detector and the pet (`petSpot()`) follow it, so the barn's loft and ladder are walkable. Adding a room means adding
a plan, a builder and one entry in `ROOMS`.

## Going in

* **Farmhouse:** E on the front door ("Go inside") fades into one warm room built in place in the farmhouse's own
  frame. Leave with E on the door (back to the porch) or by any travel out of the room.
* **Barn:** E on the big door ("Go inside · Barn"), and E on the big door again to leave.

## The farmhouse

* A stone hearth with an instanced fire + flickering `LightEmitter` (E stokes it).
* The Valley Almanac open on a desk (E → Almanac panel, live page drawn on a canvas; [almanac.md](almanac.md)).
* The Collections shelf (every forage/junk find fills its slot, unfound slots wear a "?" tag; E → Collections book;
  [pastimes.md](pastimes.md)) with the biggest catch mounted over the mantel, a fish tank swimming every species
  caught (one merged mesh, vertex-shader swim).
* A CRT terminal desk (phosphor list of farmers, amber blink when one needs you; E → roster).
* The photo wall over the bed: eight frames with the album's latest favourites (E opens one in the album;
  `photowall.ts`, [album.md](album.md)).
* Bed (E naps: time skips in demo, a cozy line live), Mochi's cat bed, grandfather clock on the real time (ticks),
  bookshelf, plants, rug, armchair.

## Windows, light and sound

* While inside the outdoor scene is hidden; the windows show the real valley: each view (front, east) is captured to
  an HDR target + depth from just outside and re-projected on backdrops (refreshed when night/wet/sun angle drift, max
  one per 1.5 s), with rain running down the glass.
* The existing shadow-casting sun throws real patches through the window holes plus soft additive shafts by day; lamps
  and the hearth carry the night; the farmhouse windows keep glowing outward.
* Audio: outdoor ambience goes through a low-pass/duck (`AudioService.indoors(k)`), music and the new `roof` rain loop
  stay dry ([audio.md](audio.md)).
* Controller, pick and sky read the service (room floor/colliders, only `interior:*` interactables, warmer dimmer
  hemi).

## The barn

A tall timber barn in the barn's frame (`BARN` from `structures/landmarks.ts`, same shell size).

### The building

* Board walls with knot holes and slits, two gables, shutters ajar, and the big door seen from inside.
* The roof: boards on rafters, collar ties and king posts.

### The hay loft

* A deck over the back third of the barn, with a rail.
* A ladder from the aisle, walkable rung by rung. It is a step-climb in `barnFloor`, and nobody can walk under it.
* Loose hay and a hay pile to flop into. The view from up there takes in the swallows.

### The animals

All are sculpted pen-rig animals from `plots/beasts.ts`. The donkey's definition is in `interior/donkey.ts`.

| Animal | Where |
| --- | --- |
| Daisy the cow | a stall with a manger and a milking stool |
| Pepper the donkey | a stall, with a halter on the post |
| Cotton and Sooty, the sheep | a pen with a trough |
| Four hens | a coop with a roost and nest boxes |

* Per species there are 2 instanced batches, one for bodies and one for heads.
* By day the animals look at you, eat and chew, blink and flick their ears and tails. At night they lie down and
  sleep, and the hens hop up onto the roost.

### Other life

* Mochi naps on the bales when she visits.
* Swallows fly figure-eights through the hay door and roost in mud nests on the ties at night. They are one
  instanced mesh with a wing-flap shader.
* Dust motes drift in the air.

### The workbench and tool wall

* A pegboard of tools and the curry brush.
* A lantern and a chores slate (canvas) listing who still needs feeding.

### Light

* **Day:** sun shafts through the shutter gaps and the hay door use the farmhouse beam shader (`buildBeams` takes
  openings). Thin daylight also shows through the slits in the boards and round the door. All of this follows the sun.
* **Night:** three hanging lanterns, a bench lamp and a banker's lamp. They are `LightEmitter`s with flicker and are
  always on, but brighter at night.
* **Lantern glass** (both rooms): amber with a flame core when lit; unlit (the farmhouse by day) it is smoky amber
  (`setGlass(glow, 0.38, 0.55)` in `house.ts` / `barn.ts`), not the bright outdoor glass, which read white in a room.
* The mangers and the sheep's hay rack hold hay (a plain dark inside read as a black hole by lantern light).

### Sound

* Rain drums on the tin roof at `roof: 1.9`, about twice the farmhouse shingles (`AudioService.indoors(1, { roof })`).
* A drip plops into the bucket by the door.
* The animals call now and then.

### Chores (once a game day)

The chores are tracked in `model/barn.ts`, persisted to `claude-valley.barn.v1`, and published as service `barn`.

* **Feeding:** E on the hay pile grabs an armful, and E on the grain bin takes a scoop. The armful or scoop shows in
  front of the camera. Then E on an animal:
  * Daisy, Pepper and the sheep take hay.
  * The hens take grain.

  A fed animal eats, chews and shows hearts.
* **Milking:** once Daisy is fed, she can be milked into the basket (`milk`).
* **Brushing:** take the curry brush to Pepper.
* **Eggs:** the hens lay 2–4 eggs a day, plus one if they were fed yesterday. Collect them from the nest boxes into
  the basket (`egg`).
* **Selling:** eggs and milk are `PRODUCE` items in `model/collection.ts`. They are sellable through the wallet but
  are not in the Collections catalog.
* **Stamp:** feeding everyone in one day inks the **Barn chores** stamp (`model/stamps.ts`, home page, egg motif).

### The machine room

A cozy corner by the door where the valley's system stats live, all driven by `ctx.valley.gauges`, the same stats
the landmarks use:

* A walnut board with four brass dials: CPU, RAM, DISK and NET.
* The inside face of the barn thermometer, with three status bulbs.
* A chart drum and a banker's lamp.

The canvas redraws at 1 Hz, and the needles are springs. E on the board or on the thermometer opens the system stats
(`ui.stats()`).

## Budget

| Room | Draw calls inside (including post) | System time |
| --- | --- | --- |
| Farmhouse | ~24 | ~0.15 ms |
| Barn | ~28–30 | ~0.1–0.2 ms |

The budget is ≤ 40, and it only applies while inside. Per-frame updates write into preallocated buffers.

Outside, a room is not in the scene: one `active` check per frame. The only outdoor cost is one interactable per
outside door.

## Dev

**URL / shot poses**

* Farmhouse: `pose=inside[:view]`. Views: door, room, hearth, shelf, desk, bed, photos, tank, window, sun.
* Barn: `pose=barn-inside[:view]`. Views: door, aisle, stalls, cow, donkey, hens, coop, sheep, panel, bench, loft,
  rafters, ladder.

**Dev API**

* `__valley.inside(view | false)` is instant. It takes `'hearth'`, `'barn'`, `'barn:loft'` or `'farmhouse:bed'`, and
  `false` leaves.
* `__valley.ctx.services.get('barn')` returns the chores. `reset()` starts a fresh day.

**Gallery:** `farmhouse-interior` (cutaway, closed), `barn-interior` (cutaway, closed, night; `gauges` param) and
`donkey`.

**Tests:** `browser-tests/barn.spec.ts` runs the whole chore loop through the E key, and the farmhouse test is in
`valley.spec.ts`.

```sh
npm run shoot -- --shot name=i,pose=inside,hour=10          # farmhouse interior (inside:door|room|hearth|shelf|desk|bed|tank|window|sun)
npm run shoot -- --shot "name=ir,pose=inside:hearth,hour=21,weather=rain,eval=__valley.collect(28)"  # night, rain on the glass, full shelf
npm run shoot -- --shot name=b,pose=barn-inside:door,hour=16                     # the barn (barn-inside:aisle|stalls|cow|…|loft)
npm run shoot -- --shot "name=bn,pose=barn-inside:panel,hour=22,weather=rain"    # machine room by lantern light, rain on tin
```
