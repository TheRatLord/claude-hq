# The Valley Gazette (G)

A little weekly newspaper made only from what really happened in the valley. Every Monday morning (or on the first
visit of a new week) the post brings the **weekly edition** about the week just gone; any day the noticeboard (and G)
has the **morning edition** about the last seven days, today included.

Key sources: `model/gazette.ts` (pure + `gazette.test.ts`: gather, compose, keep, the demo week), `newsroom.ts`
(wiring: the journal, delivery, the morning edition), `hud/gazette.ts` + `gazette.css` (the page and its canvas
engravings), the weekly roll-up in `model/timeline.ts` (`rollDay`, `past`), `model/sky.ts` (`blockKinds`). Paths are
relative to `renderer/src/farm/`.

## Where the news comes from (real data only)

`gatherFacts(input)` builds a small `WeekFacts` from:

* **The Almanac** (`valley.almanacData()`: per-day harvest counts): the covered days' commits, green test runs, tasks,
  answers, fields tilled and prosperity; the best day (a *record* when it beats every earlier day on record), the
  streak (and whether it is the longest), the rank at the start and end of the days (a rank-up is the lead story, with
  the town upgrade it built), how far to the next rank.
* **The timeline's weekly roll-up** (`state.timeline.past` + today's live `rollDay`): the hardest-working farmer (most
  active time), the most commits if that's someone else, the busiest field (project part of the in-world tag, share of
  all work), the average wait for you over the answered asks, red test runs.
* **The sky's real 3-hour weather blocks** (`blockKinds(day)`, the same table the sky uses, season from the month): a
  word per day (any daytime storm, else the most common daytime kind), the week's recap, and, because the blocks are
  deterministic, a true four-day forecast (written up by Nimbus).
* **The calendar**: the festival on now (day x of y) or the next one within three weeks.
* **The stamp book**: the newest stamp inked in the covered days (shown as the inked stamp), and how many.
* **The Gazette's journal** (`GzNote`, kept by `newsroom.ts` from the services' change hooks): gifts (with how much
  they liked it: "Hazel was delighted by your hazelnut"), delivered requests, every second heart, catches with their
  size (the fishing report: the biggest real fish, junk never wins), first-ever finds, and the Valley Projects finished
  (`ev: 'done'`) or unveiled (`'unveiled'`; [projects.md](projects.md)).
* **The projects board** (the `projects` service's view, read live): `boardNeed` picks the open plan nearest done and
  up to three unmet needs as short phrases ("150 more bits", "2 more fish", "Bram's blessing (3 ♥)"). Stored with the
  facts (`board`), so a back issue keeps the teaser it printed.

Nothing is invented about the valley: a quiet week prints *A Quiet Week in the Valley*, the gossip column says the
fence was quiet, and stories without data are left out. The whimsical bits are clearly flavour: a fixed bank of
classifieds ("LOST. One left mitten…"), pull quotes from villagers keyed to real facts (Bram on a full bin only after
ten commits), price and motto.

## Composing

`composeIssue(facts)` → `Issue`: masthead data, the lead (rank-up › record day › the harvest › quiet progress › all
quiet; a place restored leads a week with no harvest), stories (Valley Projects: restored, or fully funded and waiting
to be seen, with the champion's quote; farmer of the week, busiest field, your post, tests, streak, new ground, festival, stamp of the week,
fishing report, Collections), the harvest in numbers, a pull quote, gossip, the weather recap and forecast,
classifieds (the board's teaser is a *Wanted* ad) and the Mayor's editorial (a thank-you after an unveiling, and
what the board has its eye on next). Headlines and lines are templated with variety and seeded per edition and
covered days (`hash32('gazette|kind|from|to|no')`), so a page reads the same each time it's opened and different weeks
read fresh. Issue numbers count weeks since the valley's first harvest (`issueNo`).

## Delivery and the archive

* `newsroom.ts` checks every 2 s once the server said hello: `weeklyDue` is true when this week (its Monday) has had no
  delivery, from `DELIVERY_HOUR` (6) on Mondays, any time on other days (first visit of the week). It files the issue
  (`fileIssue`) and posts a letter from *The Valley Gazette* (`valley.post`, id `gazette:<from>`); the mailbox shows a
  **Read the paper** button on it. A week in which nothing at all happened is skipped silently (no empty paper).
* Persisted per browser profile in `claude-valley.gazette.v1`: the journal (≤ `NOTES_MAX` 120 notes, ≤ `NOTE_DAYS` 9
  days old) and the last `ISSUES_KEPT` (8) weekly issues **as facts** (≈ 1–2 KB each), recomposed on reading. The last
  two issues' letters come back after a reload. `parseGazette` / `parseFacts` coerce anything (`robust.test.ts`).

## The weekly roll-up (timeline)

The day timeline keeps today only; the Gazette needs a week. At midnight (a valley left open) and when a stored day
from an earlier date is loaded, `rollDay` turns that day into a few numbers per farmer (`FarmerRoll`: active, waited,
asks, answered + total wait, ships, passes, fails, finished; the busiest `ROLL_FARMERS` 24) kept in
`TimelineData.past` for `ROLL_DAYS` (8) days and read as `state.timeline.past`. See [timeline.md](timeline.md).

## The page (HUD)

`hud/gazette.ts` prints an `Issue` on newsprint: a hand-drawn canvas masthead (the name with an engraved hairline,
vignettes of a sunrise over the hills and the windmill), ears (edition, price), a dateline under a double rule, the lead
with a drop cap and an engraving, the harvest-in-numbers box and pull quote beside it, two columns of stories with
little ink engravings (crates, rosette, star, farmer in a straw hat, field rows, fish, pumpkin, lantern, quill, moon,
heart; seeded wobble and hatching), a sidebar (the week's weather in ink glyphs, Nimbus's forecast, *Over the garden
fence*, classifieds) and the Mayor's editorial with a signature. Editions bar: *Today's paper* and the back issues;
← / → step between them; G (or Esc) closes. Narrow windows collapse to one column. The demo prints a small
"illustrative edition" line.

Opening: G, the noticeboard's *The Valley Gazette* note, a Gazette letter's *Read the paper*, or
`open('gazette', 'latest' | { from: 'YYYY-MM-DD' } | { index })`.

## Demo

The demo valley keeps its paper in memory (never the real archive) and builds its week from the seeded history:
`demoPast` runs `demoDay` for each demo farmer over the last eight days (weekends quieter) and rolls them up,
`almanacFromRolls` re-tallies the demo Almanac's counts for those days so the numbers agree with the farmers (points
and ranks stay the demo Almanac's, matching the HUD), plus `demoNotes` (a gift, a catch, a request, a find) and
`demoStamps`. The weekly edition arrives in the mailbox a couple of seconds after the farmers do.

## Dev

`__valley.gazette()` → today's edition (lead, stories, gossip, numbers, back issues, due); `gazette('open' | 'latest' | n)`
opens the panel; `gazette('deliver')` files and posts a weekly edition now; `gazette('weekly' | 'daily')` → the facts.

```sh
npm run shoot -- --shot name=gz,pose=hub,hour=10,panel=gazette,wait=2500          # today's paper
npm run shoot -- --shot "name=gz2,pose=hub,hour=10,panel=gazette,wait=2500,eval=setTimeout(()=>{document.querySelector('.gz-holder').scrollTop=620},1500)"   # further down
npm run shoot -- --shot "name=gzw,pose=hub,hour=10,wait=4000,eval=setTimeout(()=>__valley.gazette('latest'),2500)"   # the weekly edition
npm run build && npx playwright test browser-tests/gazette.spec.ts --output test-results/gazette   # browser test
```
