# The Valley Almanac (H) and town upgrades

The valley's long memory: real work earns prosperity points that lift the valley through ten ranks, each building a
town upgrade in the world.

Key sources: `model/almanac.ts` (pure + `almanac.test.ts`), `scene/structures/upgrades.ts`, `hud/almanac.ts`,
`main.ts` (persistence). Paths are relative to `renderer/src/farm/`.

## How it works

* Real work is a *harvest* worth prosperity points (`HARVEST` in `model/almanac.ts`): commit 10, green test run 4,
  finished task 6, answered question 3, new field 5, duckling 1, a first-ever Collections find (`found`) 5. Per-kind
  daily caps (a count of harvests per day: commits 60, test runs 40, finished 60, answered 60, fields 12,
  ducklings 40, finds 3) so a busy test loop can't farm it.
* Points persist per browser profile (localStorage `claude-valley.almanac.v1`; the demo keeps a fortnight in memory,
  `?almanac=POINTS`) and lift the valley through ten ranks, Homestead → Golden Valley (`RANKS`: Homestead 0,
  Smallholding 40, Hamlet 130, Village 280, Market Village 500, Market Town 800, Harvest Town 1200, Festival Town
  1750, Valley of Plenty 2450, Golden Valley 3300), then a star per 1,500 (`STAR_POINTS`).
* Each rank unlocks a **town upgrade** built in the world (`scene/structures/upgrades.ts`, not baked): bunting over the
  square, flower barrels along the roads, the fountain (toss a coin), market stalls (browse today's harvest), festoon
  lanterns, the bandstand (strike up a tune), a patchwork hot-air balloon, the golden Clawd statue, and evening
  fireworks over the south meadow at nine.
* A new rank pops its upgrade in with confetti, fires a short firework show and toasts with a fanfare; Mayor Marigold
  talks about the rank every third chat.
* The status sign's rank chip opens the panel (rank, today's harvest, the week, streak, upgrades). The Collections
  book is a tab on the same panel ([pastimes.md](pastimes.md)); the farmhouse desk shows a live page
  ([interior.md](interior.md)).
* Ranks also gate General store stock ([economy.md](economy.md)), the bandstand concert and the market morning
  ([gatherings.md](gatherings.md)).
* The panel has a second tab, the **stamp book** (1 / 2 or S; [stamps.md](stamps.md)).

## Dev

`__valley.almanac(points)` sets prosperity live (crossing a rank pops its upgrade in); `__valley.fireworks(seconds = 20)` fires a
show; URL / shot key `almanac=POINTS` (demo).

```sh
npm run shoot -- --shot name=u,pose=square,almanac=3400,hour=22,eval=__valley.fireworks(30)  # every town upgrade + a show
```
