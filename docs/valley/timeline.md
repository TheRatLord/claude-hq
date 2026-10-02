# The day timeline

What each farmer did today, so after stepping away you can tell how the morning went: a per-farmer record of spans and
moments, the farmer card's *Today* section, and the ledger's mini strips.

Key sources: `model/timeline.ts` (pure + `timeline.test.ts`: the recorder, `summarize`, `keyMoments`, `bands`,
`demoDay`), fed by `model/valley.ts` (`tick` → `observe`, `ingest` → `mark`) and read as `ValleyState.timeline`;
`hud/timeline.ts` + `timeline.css` (the card section, the ledger strip), `hud/daystrip.ts` (pure + `daystrip.test.ts`:
band colours, the gradient, hour ticks, copy); `main.ts` (persistence, the demo seed). Paths are relative to
`renderer/src/farm/`.

## The record (model)

Every model tick hands each farmer's **visible job** (the smoothed `FarmerView.job`, its tool flavour and subject) to the
recorder, which keeps:

* **Spans**: `{ job, from, to, tool?, what? }` in wall-clock ms (`plant 10:12–10:24 · store.ts`). The same job extends
  the open span; a blip shorter than `BLIP_MS` (20 s) folds into its neighbours (never an ask); more than `GAP_MS` (90 s)
  without a tick leaves a hole (the valley was closed), so a reload within that continues seamlessly.
* **Marks** from the wire (`MARK_OF` in valley.ts): `commit` → `ship` (message), `test-pass` / `test-fail` → `pass` /
  `fail` (command), `error`, `finished` (task title), `subagent-spawned` → `sub`, `compact`, `struggle` (level ≥ 2).
  Events for ids the recorder has not seen as farmers (scarecrows) are ignored.
* **Asks** from the status: `needsYou` turning on adds an `ask` mark with the question; turning off sets its `wait`
  (how long it waited for you). The `ask` spans are the "waited on you" time.

Bounded: today only (reset at local midnight; a stored day from another date is dropped on load: the daily cleanup),
`MAX_SPANS` 240 per farmer (`compactSpans` merges the shortest into a neighbour, asks never), `MAX_MARKS` 160 (the oldest
go), `MAX_FARMERS` 48 (the stalest go). `FarmerDay.rev` bumps only when a span starts / ends or a mark lands (an open span
growing does not), and `TimelineView.rev` with any of them: the HUD keys its repaints on these.

**Weekly roll-up** (for [The Valley Gazette](gazette.md)): when the day rolls over (midnight while open, or a stored day
from an earlier date on load) `rollDay` keeps it as a few numbers per farmer (`FarmerRoll`: active, waited, asks,
answered + their total wait, ships, passes, fails, finished; the busiest `ROLL_FARMERS` 24) in `TimelineData.past`, the
last `ROLL_DAYS` (8) days, read as `TimelineView.past` (`parseRolls` / `pushRoll` prune and coerce).

Persisted per browser profile in `claude-valley.timeline.v1` through a `TimelineStore` (like the almanac): saves are
throttled to one per `SAVE_MS` (20 s), asks / ships / test runs save at once, and `main.ts` flushes on `pagehide`.

Readers: `summarize(fd)` (active = `WORK_JOBS` time, waited, asks, ships, passes, fails, errors, finished, ducklings,
first record), `keyMoments(fd)` (newest first: ships, asks with their wait, a red run paired with the next green one as
`fixed` — "tests failed ×2 → 11:09 green" — green runs coalesced within 15 min, errors, finishes, ducklings coalesced,
"started work" at the first work span; compactions left out), `bands(fd, from, to, n)` (the job covering most of each
bucket, an ask wins with a quarter of one, null where a third or less is recorded), `spanAt`, `earliest`, `stripRange`
(first record floored to the hour, at least 2 h back, to now).

## The HUD

* **Farmer card → Today** (below the actions; `data-testid="card-day"`): four tiles (Active + since when, Waited on you +
  asks, Shipped, Test runs + red ones), the **day strip** (`day-strip`: one CSS gradient of seven calm bands — editing
  green, reading teal, tests blue, commands & git wood, thinking lavender, waiting on you gold, idle sand; hatched paper
  where nothing was recorded; gold notches above for asks, blue dots for finishes, crates / green / red dots below for
  ships / test runs / errors; hour ticks; a legend). Hovering shows one tooltip: the span under the pointer (`spanLine`)
  and any marks within a few pixels. Under it the **key moments** list (`day-moments`, ~5 rows, scrolls). The section is
  one node the card re-appends on its rebuilds; it repaints only when its farmer's `rev` changes or a minute passes.
* **Ledger (Tab) mini strips** (`roster-day`): one element per farmer row, right after the status pill so every row's
  strip starts at the same x (the job column absorbs the slack; hidden ≤ 900 px wide), 48 buckets as the element's
  background image, the day summary in its tooltip. All rows share one window (the earliest record of any farmer today →
  now, stepped every 5 minutes), and a row repaints only when its `rev` or the window changes, so `crowd40` costs
  nothing on the 4 Hz tick between changes.

## Demo

The demo valley keeps the timeline in memory (`valley.useTimeline(memStore, demoDay)` on a demo `hello`) and seeds each
farmer it meets with a plausible day so far: arrives 2.5–6 h ago, turns of read → plan → edit → test (sometimes red,
then fixed) → ship, asks that wait 1–24 min, ducklings, the odd error, often a lunch break; deterministic per farmer and
date, ending now so live recording continues from it. `?timeline=0` skips the seed.

## Dev

`__valley.timeline()` → every farmer's summary; `timeline(id)` → `{ day, summary, moments }`; `timeline(id | '*', 'seed')`
(demo only) replaces a day with a seeded one; `timeline(id, 'clear')` empties it (live recording refills it).

```sh
npm run shoot -- --shot "name=day,pose=hub,eval=__hud.open('card',[...__valley.ctx.valley.timeline.farmers.values()].sort((a,b)=>b.marks.length-a.marks.length)[0].id),wait=1500"   # farmer card → Today (the busiest day)
npm run shoot -- --shot "name=dayh,pose=hub,eval=__hud.open('card',[...__valley.ctx.valley.farmers.keys()][0]);setTimeout(()=>{const s=document.querySelector('[data-testid=day-strip]');const r=s.getBoundingClientRect();s.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+r.width*0.7,clientY:r.top+5}))},1200),wait=2000"   # the strip's hover tooltip
npm run shoot -- --scenario crowd40 --shot name=dayl,pose=hub,panel=roster,wait=3000   # ledger mini strips (fps in the printed perf)
npm run build && npx playwright test browser-tests/timeline.spec.ts --output test-results/timeline   # browser test
```
