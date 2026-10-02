# The secret grotto behind the waterfall

A reward for curious explorers. A worn ledge of stepping slabs leaves the plunge pool's west shore, climbs the cliff
and slips behind the falling water to a mossy rock arch. Inside is a cavern lit by glowing crystals that slowly change
colour. It has a still pool that mirrors them, stalactites, bats, drips, an old explorer's camp, and cave paintings of
the valley's oldest story. Nothing points you there except a "?" on the map.

Key sources (paths relative to `renderer/src/farm/`):

* `world/grotto.ts` is pure and tested by `grotto.test.ts`. It holds:
  * the ledge (`LEDGE` polyline, `MOUTH`, `carveGrotto`, `ledgeAt`);
  * the cave plan in room-local metres (`caveSdf`, `caveFloor`, `inCave`, `floorAt`, `cavePushOut`, `caveRay`, `SOLIDS`);
  * the placements (`POOL`, `CAMP`, `CHEST`, `GLOWCAP`, `PAINTING`, `ROOST`).
* `model/grotto.ts` is pure and tested by `grotto.test.ts`. `GrottoService` tracks found / visits / chest / journal
  pages, stored under `claude-valley.grotto.v1`. It also holds `JOURNAL` (six pages signed "— R.") and
  `glowcapToday` / `grottoSpawn` (glow-caps grow here on about 2 days in 3).
* Scene files:
  * `scene/grotto/grotto.ts`: system and service `grotto` (`GrottoHandle`). It handles the outside: discovery, the
    mouth, and walking in.
  * `outside.ts`: the slabs, arch, throat, glow and spray, and the back of the falling sheet.
  * `room.ts`: `grottoRoom`, a `RoomDef` for the interior system. It covers views, lights, interactables, fishing,
    bats and drips.
  * `cave.ts`: the builders (surface-nets shell, crystals, pool shader, painting canvas, bats, drips, curtain, camp).
  * `assets.ts`: gallery assets `grotto-cave`, `cave-crystals`, `cave-bat`, `explorer-camp`, `cave-paintings`,
    `grotto-mouth`.

## The ledge

`heightAt = carveGrotto(heightBeforeGrotto)` in `world/map.ts`:

* The cut has a level floor out to `CUT_HW` = 1.7 m, then blends into the cliff over 1.6 m. The floor is wider than the
  1 m tread on purpose: the terrain mesh is a 1.25 m grid, and a narrower cut makes the rendered rock overhang the walk.
* The waterfall's sheet (`buildFall`, `scene/terrain/water.ts`) is traced on `heightBeforeGrotto`. The water falls
  where it always did, and the cut opens a real gap behind it.
* `pathAt` paints the tread as worn rock. `clearance` keeps scatter off it, and bank pebbles skip its foot.

Outside dressing comes to 4 draws: one merged vertex-coloured mesh (slabs, boulders, arch, a dark throat), the throat's
crystal glow, spray, and `curtainBack()`. `curtainBack()` redraws the falls' own sheet a hand's width toward the cliff,
back faces only, as streaky backlit water: pale blue by day, moonlit by night.

The system hides all of it beyond 60 m of both the player and the camera, so the valley pays nothing. The waterfall's
roar gets louder close in (`audio/mix.ts`).

How you get in and out:

* **Discovery:** standing on the ledge within ~5 m of the mouth calls `grotto.discover()`. You hear a chime and see a
  "Discovery" line, and the map's "?" becomes a pin.
* **Entering:** walking into the mouth enters the room (re-armed once you back off a pace). E on `grotto:mouth`
  ("Squeeze inside") also works.
* **Leaving:** inside, walking out of the mouth or E on `interior:grotto:mouth` steps you back onto the ledge.

## The cave (a room)

`grottoRoom` is registered in `scene/interior/interior.ts` (`ROOMS`), so the outdoor scene is hidden while you're in it.
It uses two optional `RoomDef` fields:

* `origin`: the frame is the world `MOUTH`, not a structure site.
* `light`: `{ sky: 0.16, skyTint, groundTint, sun: 0 }`. `sky.ts` reads it through `IndoorSpace.light`: a cool trickle
  of fill and no key light. Nothing in the room casts, so the shadow pass draws nothing.

### Shell and props

* **Shell:** an SDF (blended ellipsoid lobes + 3D noise + a floor), polygonised with surface nets at 0.36 m. Floor
  vertices snap to `caveFloor`. Faces are painted per face (moss low and near the mouth, wet dark rock, mineral
  streaks). Stalactites, the bat roost and the stalagmites that hide the chest are merged in.
* **Crystals:** clusters raycast onto the walls. The emissive colour wheel (`crystalTint`, `CYCLE_SECS` = 48) runs in
  the shader, and 4 real `LightEmitter`s follow the same wheel. Also lit:
  * the explorer's lantern (flickers; E dims it);
  * the glow-caps;
  * a daylight spot at the mouth (daylight through water).
* **Pool:** an analytic shader that mirrors the crystal, lantern and daylight lights (6 slots), plus up to 4 ripples.
  Drips that land on it ripple and plop.
* **Paintings:** a canvas texture showing the sun, the falls, three Clawd farmers (hoe, watering can, a wave), the
  windmill, the first field, stars, crystals and hand prints. It is laid on a 52×18 grid raycast onto the north wall.
* **Bats:** 7 instanced bats with a wing fold/flap vertex shader. They flutter when you enter or when you E them.

The draw budget is ≤ 25 calls with the whole cave in view (`door` view: 25; most views 20–22). The browser test checks
this. `update` doesn't allocate per frame (the glow-cap check is cached once a second).

### Interactables (`interior:grotto:*`)

| id | does |
|---|---|
| `journal` | Reads a page (cycles through 6 whimsical pages, counts the furthest read) |
| `lantern` | Turns it up or down |
| `bedroll` | Rests (lines) |
| `glowcap` | Picks today's glow-caps |
| `pool` | Fishing (blind cave fish) |
| `chest` | Opens the hidden chest once |
| `paintings` | Lore lines |
| `crystal` | Lore lines |
| `bats` | Makes them flutter |
| `mouth` | Steps out |

## Secrets

* **Glow-cap** (`collection.ts` `glowcap`, rare forage, every season, habitat `grotto`): not in the valley's daily
  batch (`forageFor` skips it). Its spawn key is `${day}:grotto:0`, picked through `collection.pick`.
* **Blind cave fish** (`cavefish`, rare, water `cave`): only from the cave pool (`rollFish` with water `'cave'`). It
  doesn't count toward "every fish of a season". The 3D fish has no eyes (`Shape.blind`).
* **Stamp:** "Behind the curtain" (`grotto`, Explorer, secret, motif `cave`). It is inked when
  `StampWorld.at.grotto` (you're inside).
* **Chest:** `wallet.gift('geode')`, the **Grotto geode lamp** (gift-only glowing decor, `scene/yard/models.ts`).
* **Map:** `POIS` has `{ id: 'grotto', hidden: true }`. `hud/mapdraw.ts` draws a purple "?" tile ("Locals say the
  falls hide something…") until `MapExtras.found` contains it (from `svc('grotto').discovered()`), then a cave pin with
  its name.

## Tools

* Poses:
  * `?pose=falls`: the falls from the pool.
  * `?pose=curtain`: on the ledge behind the falls, facing the mouth (never nudged).
  * `?pose=grotto[:view]`: views are `door cave pool camp paintings chest chestside mouth bats`.
* `__valley.grotto(where?)`:
  * outside: `'ledge' | 'curtain' | 'mouth'`;
  * in the cave: `'inside'` or any view;
  * `'reset'` forgets everything;
  * with no argument, returns `{ discovered, inside, data }`.
* Browser test: `browser-tests/grotto.spec.ts` (the map "?", discovery, walking in with W, the stamp, the draw
  budget, journal, chest, E out).
