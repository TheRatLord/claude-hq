# The hillside orchard & apiary

A walled orchard on the east foothills slope, above the road out of the village. It has eighteen fruit trees in three
rows, four beehives over a wildflower bed, and an open press shed with a cider press, barrels and a shelf of jars. A
dry-stone wall runs round it, with a five-bar gate in the downhill wall. A footpath runs from the gate to the nearest
road, and a mown alley runs up between the rows.

This is not the older *Honey stand* leisure nook (once called Orchard & apiary) (`structures/countryside.ts`, the honesty stand at (64.5, −50)).
That one is scenery the farmers idle at. This one is a pastime you play, so on the map and in the notebook it is the
**Hillside orchard**.

Key sources (paths relative to `renderer/src/farm/`):

| file | what |
|---|---|
| `world/orchard.ts` (pure) | the site: origin, yaw, wall, gate, tree / hive / bed / shed / sign layout in local coordinates. Also `orchardToWorld` / `orchardToLocal`, `ORCHARD_GATE`, `ORCHARD_ALLEY`, `ORCHARD_BOUND`, `orchardClearance` (fed into `world/map.ts` `clearance()`) and `inOrchard` |
| `model/orchard.ts` (pure, `orchard.test.ts`) | tree phases per kind × season, fruit counts per tree per day, shaking, honey timing, bee activity / mood, the press, the store (`createOrchard`) |
| `scene/orchard/models.ts` | trunk / crown (one per season) / fruit / bee / petal geometry, species tints, the static kit (wall, gate, shed + press, hives, flower bed, ladder, basket, sign) |
| `scene/orchard/bees.ts` | `Colony`: instanced foragers (hive → flower → hive) and guards at the entrances |
| `scene/orchard/orchard.ts` | system `orchard`, service `orchard` (`OrchardHandle`): the scene root (`hillorchard`), interactables, colliders, the shake / fly-to-basket animation, petals, bees, the hum |
| `scene/orchard/assets.ts` | gallery assets `orchard-tree` (variants per kind), `orchard-fruit`, `orchard-bee`, `orchard-hive` |

## Where it is

The origin is (92.2, 37.2) with yaw −2.0, so the local front (+z) faces downhill to the WNW. The gate is at about
(83.1, 33.0). The site was picked with mapviz as the largest under-used slope that crosses no road, field, nook or
project site (the Valley Projects sites are all clear of it).

`world/map.ts` changes are kept small and marked:

* one levelled pad under the press shed;
* the gate footpath: a stub 3.6 m outside the gate to the nearest road (width ≥ 2), plus the alley (width 1.4);
* `clearance()` takes `orchardClearance(x, z)` east of x = 60, so flora, rocks and the path decals keep off the wall,
  the trees, the hives, the bed and the shed.

`orchard.test.ts` checks the layout. The trees stand on the slope, on dry ground, clear of paths. The alley is a path.
The gate footpath reaches a road.

## The trees through the year

There are four kinds: **apple** (rows 1 and 3), **pear**, **plum** (row 2) and **cherry** (row 3). `treePhase(kind,
season)`:

| | spring | summer | autumn | winter |
|---|---|---|---|---|
| apple | blossom | green (small green fruit) | **ripe** | bare |
| pear | blossom | green | **ripe** | bare |
| plum | blossom | **ripe** | **ripe** | bare |
| cherry | blossom | **ripe** | turning (leaves, no fruit) | bare |

* **Spring**: pink-white blossom crowns, tinted per kind (cherry pinkest, pear whitest). Petals drift off the trees,
  about 5 a second within view.
* **Summer**: green crowns. Cherries and plums hang ripe, and apples and pears hang small and green.
* **Autumn**: amber / gold / russet crowns, thinner, with leaves falling (about 4 a second).
* **Winter**: bare boughs. Snow lumps show on them only while there is lying snow (`trace.snow > 0.12`).

Fruit per tree per day is seeded: `fruitOnTree(day, tree, kind, season)` uses `hashKey('orchard:' + day + ':' + tree)`.
The ranges are apple 4–6, pear 3–5, plum 3–5, cherry 3–6. A new day refills every tree.

## Shaking a tree (E)

Look at a tree trunk within 3.6 m. The tag reads *Apple tree · E Shake · 4 apples ripe · shake some down*, or *picked
clean today*, *in blossom*, *still green*, *leaves turning*, or *bare until spring*.

When you shake it:

* the crown wobbles about the crotch;
* up to **3** fruit (`SHAKE_DROP`) come loose, fall, bounce on the grass, rest a moment, then fly to the paws' basket.
  The `hands` service does a *grab*, the basket shows them, and a pop sounds;
* each fruit is recorded in the Collections book (`collection.gather(kind)`), so a new kind gets the usual "New in your
  collection" toast;
* a tree that isn't ripe just rustles: blossom or leaves drift down, and nothing is picked.
* sound: the crown's `rustle` (and a soft creak), a `thump` per fruit bounce, the pop into the basket; the press plays
  `press` (ratchet, groan, squelch) then the pour ([audio.md](audio.md#coverage-features--sounds)).

The shaken fruit is counted against today (`picked[tree]`), so a tree empties after a couple of shakes and is full
again tomorrow.

## The hives and honey

Four hives stand in a row by the flower bed. Each gives a jar of **wildflower honey** every **3 days** (`HONEY_DAYS`).
In summer you get 2 jars, in spring and autumn 1, and in winter none (the hives are wrapped up).

The tag reads *Collect honey* when a hive is ready. Otherwise it reads *Look at*, which says "Not much to spare yet.
Give them N more days."

### Bees

* 22 foragers fly hive → flower in the bed → hive in loops, and 8 guards hover at the entrances. They are one
  instanced mesh.
* `beeActivity({ hour, season, weather })` sets how many are out:
  * 0 in winter and in rain, storm or snow;
  * it ramps up 6.8–9 h and fades out 18–19.6 h (an hour later in summer, half an hour earlier in autumn);
  * fog ×0.35, cloudy ×0.7, autumn ×0.65, spring ×0.9.
* `beeMood` names the state for tags and the dev API: *out*, *waking*, *asleep*, *sheltering*, *wintering*.
* The bees are updated only within 60 m of the camera. Further away they are hidden.

### The hum

The hum is `audio.loop('bees', hive centre)` on the existing ambience bus. It is started within 45 m while any bees are
out, and stopped otherwise.

## The press

Look at the press in the shed. With 3 apples or pears in the basket (apples first, `pressPlan`) the tag reads *Press
cider*, and E turns them into a **bottle of cider** (basket produce, `PRODUCE` in `model/collection.ts`). Otherwise it
reads *Look at*.

## Integrations

* **Collections book**: `apple`, `pear`, `plum`, `cherry` and `honey` are forage entries with habitat `orchard`.
  `forageFor()` never spawns them in the wild; you get them here. `cider` is produce. Each has an SVG icon
  (`hud/collection.ts`) and a basket model (`scene/forage/models.ts`).
* **General store**: they sell at the usual rule (`sellPrice`). Apple is 6, pear / plum / cherry are 8, and honey and
  cider are 24.
* **Friends' tastes** (`model/friends.ts`):
  * Hazel loves honey and likes apples and pears;
  * Nimbus likes honey;
  * Posy likes cherries;
  * Fern likes plums;
  * Bram and Marigold like cider (Marigold pears too).
* **Fern's notebook** (`model/guide.ts`):
  * the page `orchard` is in the *Seasons* chapter, with the `apple` motif. It is found by any orchard fruit or honey
    in the book. Its notes show fruit picked, kinds n / 4 and honey jars;
  * the nudge `orchard` fires within 12 m of the gate in summer or autumn if the page isn't found;
  * there is a rumour;
  * there is a what's-new line (`FEATURES` ver 7).
* **Map**: a place tile `place:hillorchard` with the label *Hillside orchard* (`hud/mappins.ts`).

## State

The key is `claude-valley.orchard.v1` (`localJson`), with the shape `{ v, day, picked: { tree: n }, hives: { i: lastDay },
total: { fruit, shakes, honey, cider } }`. `parseOrchard` is tolerant: anything malformed becomes the empty state. It is
fuzzed in `robust.test.ts`. On a new day `rollDay` clears `picked`. Hives keep their last-collected day.

## Budgets

| | |
|---|---|
| draw calls | ≈ 8 + shadows: static solid + glow, sign, trunks, crowns, fruit, petals, bees (+17 at the orchard pose, +7 at the hub, +15 from the top view) |
| tris | ≈ 90 k at the orchard pose (main + shadow pass); crowns are the bulk |
| CPU | system `orchard` ≈ 0.06–0.16 ms a frame near it, ~0 further than 95 m (dynamics) / 60 m (bees) |
| GPU | +0.5–0.7 ms at the orchard pose; +0.1–0.2 ms at the hub / top |

The static kit is rebuilt only when the season changes. The trees, fruit, petals and bees are instanced, and the fruit on the
trees is refreshed only when the store changes.

## Dev and checks

* `__valley.orchard()` returns the trees (kind, phase, fruit left, position), the hives (ready, in days), the bees
  (activity, mood, out), the fruit in the air, and the data.
* `__valley.orchard('gate' | 'top' | 'hives' | 'press')` stands you there. `('tree', i)` stands you 3 m in front of
  tree i, looking at it.
* `__valley.orchard('shake', i)` shakes tree i. `('honey', i)` collects from hive i, `('press')` presses a bottle,
  `('refill')` fills every tree and readies every hive, and `('reset')` forgets the store.
* The pose `?pose=orchard` is the footpath outside the gate, looking up the alley.
* Unit tests: `node --test renderer/src/farm/model/orchard.test.ts`.
* Browser test: `npm run build && npx playwright test browser-tests/orchard.spec.ts --output scratch/pw-orchard`. It
  covers:
  * aiming at an apple tree in autumn, E, the fruit in the air and then in the basket and the book;
  * cider from three apples;
  * honey, once;
  * the bees out on an autumn morning;
  * the notebook page;
  * winter: bare trees, no fruit, the bees wintering;
  * persistence across a reload.
* Placement audit: the scene root is named `hillorchard` (the countryside nook already owns `orchard`). Its intended
  contacts (hanging fruit, crowns on trunks, the wall stepping up the bank, the gate on its pillar, barrels in the shed,
  the hanging lantern) are in `scripts/placement-allow.json`.

```sh
npm run shoot -- --shot "name=orch-autumn,pose=orchard,hour=11,season=autumn"
npm run shoot -- --shot "name=orch-spring,pose=orchard,hour=10,season=spring"
npm run shoot -- --shot "name=orch-dusk,pose=orchard,hour=19.2,season=autumn"
npm run shoot -- --shot "name=orch-shake,pose=orchard,hour=11,season=autumn,eval=__valley.orchard('refill');__valley.orchard('shake',15),wait=600"
```
