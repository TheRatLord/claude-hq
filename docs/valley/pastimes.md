# Pastimes: foraging, fishing and the Collections book (K)

The player's own cozy hobby between check-ins: daily forageables, fishing at the pond and river, and the book that
remembers every find (plus the wildlife field guide).

Key sources: `model/collection.ts` (pure + `collection.test.ts`: `CATALOG`, `SIGHTINGS`, `forageDay`, `rollFish`),
`scene/forage/` (system `forage`: `forage.ts`, `place.ts`, `models.ts`, `assets.ts`), `hud/collection.ts` +
`collection.css`, `main.ts` (persistence, harvest + wallet wiring). Paths are relative to `renderer/src/farm/`.

## Foraging

* Each real day 8–12 of the season's forageables lie around the valley, deterministic per date (`forageDay` +
  `place.ts`: meadows a short walk off a road, beside trees, the pond beach / river banks, the foot of the cliffs; never
  on roads, in fields, water or structures).
* By season: spring morels, wild leeks, violets; summer wild strawberries, jay feathers, mussel shells and skipping
  stones by the water; autumn chanterelles, acorns, hazelnuts, maple leaves; winter holly, pinecones and the rare
  frost crystal.
* One instanced draw per kind in season plus one additive draw of twinkling glints so they can be spotted; look at one
  → `[E] Pick up` (a pop, sparkles, sfx); a picked spot stays empty until tomorrow.

## Fishing

* Look at open water near the pond or the river → `[E] Cast a line`; the held rod casts the bobber, it nibbles, then
  dips with a splash and a `bite` ping → E within ~1.2 s (a second chance if you miss) reels in, and the catch is held
  up in view.
* What bites depends on season, hour (night-only catfish / eels / moonlit char, dawn-and-dusk pike), weather (rain-only
  thunder bass and eels) and water (`rollFish`); old boots and a message in a bottle come up too.

## The Collections book

* The book (K, or the tab on the Almanac panel) shows all 28 entries (14 forage, 14 fish and junk; `CATALOG`) as
  silhouettes until found, then count, first-found date, biggest catch and a line of flavour. Its *Field guide*
  section holds the 6 wildlife sightings (`SIGHTINGS`, see [wildlife.md](wildlife.md)).
* Persisted per browser profile (`claude-valley.collection.v1`, service `collection`, `HudBindings.collection`).
* A first-ever find is a `found` harvest in the Almanac (+5, three a day; [almanac.md](almanac.md)).
* Every find also goes into your basket to sell or gift ([economy.md](economy.md), [friends.md](friends.md)); the
  farmhouse shelf, mantel and fish tank show the collection ([interior.md](interior.md)); the map's *Forage* layer
  hints where today's finds are ([map.md](map.md)).

## Dev

`__valley.forage(day?)` (today's finds), `forageGo(i)` (walk up to one), `fish()` / `fish('bite' | 'hook' | 'demo')`
(cast at the dock), `collect(n)` (fill the book); gallery assets `forage`, `catch`, `fishing-rod`.

```sh
npm run shoot -- --shot "name=c,pose=hub,panel=collection,eval=__valley.collect(16)"   # the Collections book
npm run shoot -- --shot "name=f,pose=hub,eval=__valley.fish('demo'),frames=9,every=450"  # cast, bite, catch (flipbook)
npm run shoot -- --shot "name=p,pose=hub,eval=__valley.forageGo(0)"                       # stand over today's first find
```
