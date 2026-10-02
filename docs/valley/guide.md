# Fern's Field Notebook (O): discoverability

There is a lot to do in the valley, and the welcome tour covers only the basics. The notebook makes the rest
discoverable, gently: it lists every activity with a sketch, how to do it and your progress, and gives a cryptic hint
for the ones you haven't found. Fern also nudges you once when you stand next to something you've never tried, the
villagers mention things now and then, and a letter tells a returning player what's new.

Key sources (paths relative to `renderer/src/farm/`):

* `model/guide.ts` is pure and tested by `guide.test.ts`. It holds:
  * the pages (`PAGES`, `CHAPTERS`) and the snapshot they read (`GuideWorld`);
  * the view (`guideView`);
  * the nudges (`nudgesFor`, `Near`, `NUDGE_R`);
  * the rumours (`rumourFor`, `RUMOUR_GAP_MS`);
  * what's new (`FEATURES`, `LATEST`, `BASELINE`, `newsDue`, `newsLetter`);
  * the store (`parseGuide`, `createGuide`).
* `guidebook.ts` does the wiring. It builds the `GuideWorld` off the live services at 1 Hz, ticks the `seen` signals,
  queues the nudges and settles the letter. It publishes the service `guide` (`GuideHandle`).
* `hud/guide.ts` and `guide.css` draw the panel `guide`, the pencil sketches and the "new page" toast.
* The nudge tips live in `model/onboarding.ts` (`HINTS` with `nudge: true`) and are shown by `hud/onboarding.ts`.
* The rumour hook is one line in `talk()` in `scene/villagers/villagers.ts`.
* The `paw` motif was added to `model/stamps.ts` and `hud/stamps.ts`, and `drawMotif` is exported from there.

## The notebook

Open it with **O** (Settings → Controls → *Field notebook*, rebindable), from the pause menu (*Fern's field
notebook*), from the button on the what's-new letter, or with `ui.guide(page?)` / `__hud.open('guide', page | chapter)`.

It looks like an open ranger's notebook: a green cloth cover, ruled cream pages with a red margin and a stitched spine.

* **The left page** is the index. It has five chapter ribbons: *Pastimes, Seasons, Village life, Exploring, House &
  barn*. Each ribbon shows a found/total count, and a red dot when something on it is new. Below the ribbons are the
  entries:
  * a found entry shows its sketch and its title, with a ✓, or a *new!* mark until you've looked at it;
  * an entry you haven't found shows a pencilled "?" and the first words of its hint, with *now* when it can be done
    right now;
  * a secret shows only "? ? ?".
* **The right page** shows the selected entry.
  * A found page has:
    * the sketch on a taped card;
    * the how-to, with the bound keys as key caps (`{use}`, `{alt}`, `{wave}`, `{lantern}` and `{notebook}` are
      filled in by `fillKeys`);
    * *When:* and a *now!* stamp;
    * your progress, pencilled in.
  * A page you haven't found is an empty page with Fern's hint in quotes. A page that isn't secret also gets its *When:*
    line.
  * The foot of the page shows the chapter so far as a row of pencilled boxes.
* Keys inside the panel:
  * **↑ / ↓** walk the pages;
  * **← / →** turn chapters;
  * **O** or **Esc** closes it.

Looking at a freshly found page for about a second marks it read.

Sketches reuse the stamp book's motif drawings (`drawMotif`). Each one is drawn twice in graphite with a seeded wobble,
over a watercolour wash in the chapter's colour, then cached as a data URL.

### The pages

| chapter | page | found when (read from) | progress |
|---|---|---|---|
| Pastimes | forage | a forage kind in the Collections book (or the tour's chip) | kinds, finds |
| | fish | any catch in the book (or the tour's chip) | caught, the biggest |
| | wildlife | a field-guide sighting | n / 6 |
| | sky | the *rainbow* or *meteors* stamp | each ✓ |
| | photo | stamps `n.photo`, or the album | album / snaps |
| Seasons | rowboat | stamps `n.row`, or *seen* aboard | outings |
| | skate | stamps `n.eight`, or *seen* on the ice | figure eights |
| | snowman | stamps `n.snowman`, or *seen* rolling a ball | snow friends |
| | festival | stamps `fests` | n / 7 |
| Village life | gifts | `friends.total.gifts` | gifts, closest friend ♥ |
| | requests | `friends.total.requests`, or one asked | done |
| | gathering | the *campfire* / *concert* stamp, `friends.gathered`, or *seen* seated | each ✓ |
| | pet | an adopted pet (`companion.model`) | walked, fetched, finds |
| | gazette | *seen*: the Gazette panel opened | — |
| Exploring | summit | the *summit* stamp, cairn stones, or *seen* at the viewer | n / 7 stones |
| | nooks | stamps `nooks` | n / 8 |
| | lantern | *seen*: T or Z pressed | each ✓ |
| | grotto (**secret**) | `grotto.data().found` | visits, journal, chest |
| House & barn | farmhouse | *seen* inside (or the tour's chip) | — |
| | barn | `barn.total.feeds`, or *seen* inside | fed, eggs / milk, full days |
| | shop | `wallet.total.sales` or `spent` | yard pieces, sold |

Adding a page:

1. Append to `PAGES`. Ids are save keys, so never rename one.
2. Pick a `MOTIFS` entry, or add one and draw it in `hud/stamps.ts` `M`.
3. Read other services through `GuideWorld`. If you need a new field, add it there and in `guidebook.ts world()`.
4. Write a hint that doesn't name the page (the tests check this).
5. Add a `rumour` (with `by` if only some villagers should say it).

Persist something only when no other service remembers it. Then add a `SeenId` and tick it from real state.

## Found and seen (no duplicated state)

A page is found when the predicate over the snapshot says so. The snapshot comes from the Collections book, friendship,
the wallet, the stamp book's data (its counters and visited sets), the barn's `total`, the grotto's data, the pet
model, the trail's stones, the album's count and the welcome tour's pastime chips.

The notebook persists only these, in `claude-valley.guide.v1` (`parseGuide` is tolerant, fuzzed in `robust.test.ts`):

* **`seen`**: things nobody else records, each from a real signal.
  * `guidebook.ts` ticks these from state:
    * `rowboat`: the boat's mode is `aboard`;
    * `skate`: on the ice;
    * `snowball`: carrying a ball;
    * `farmhouse` / `barn`: `indoors.room`;
    * `viewer`: `trail.viewing`;
    * `gathering`: seated while a gathering is on.
  * The HUD ticks these:
    * `gazette`: the Gazette panel opened;
    * `lantern` / `wave`: the T / Z keys;
    * `notebook`: the panel opened.
* **`told`**: pages already announced, so each gets one toast ever. A service that registers late can't re-announce
  an old page.
* **`known`**: pages you have looked at. Found pages not in it wear *new*.
* **`news`** and the last **letter**.

On a profile's first load with the notebook, everything already found is told and known silently, so there is no burst
of toasts.

A newly found page gets a toast: *"A new page in Fern's notebook: The rowboat · O to read it"*, with the sketch as its
icon. Toasts are grouped as `guide`.

## Fern's nudges

`nudgesFor(world, near)` returns one-time tips for something right in front of you that you've never tried. It runs
only outdoors, and never for a secret.

| nudge | when |
|---|---|
| `boat` | not winter, 6–21 h, within 14 m of the dock |
| `skate` | the pond frozen (ice > 0.8), within 7 m of its edge |
| `snow` | lying snow ≥ 0.3 |
| `barn` | within 13 m of the barn |
| `campfire` | a campfire gathering on, within 26 m |
| `trail` | within 12 m of the trailhead |
| `pet` | no pet, within 8 m of the foundlings' basket |
| `notebook` | 3+ pages found and the notebook never opened |

`guidebook.ts` calls `onboarding.want(id)` every second while a nudge applies. The texts are the `HINTS` entries with
`nudge: true, who: 'villager:fern'`; Fern's portrait replaces Posy's, and the tip gets a green edge. In the sub-line,
`{use}` and `{notebook}` are filled with the bound keys.

They follow the tips' rules ([onboarding.md](onboarding.md)):

* at most one tip every 4 min (shared with the other tips);
* never during the tour, a panel, typing or photo mode;
* *Tips off* or Settings → *Valley tips* turns them off.

On top of those:

* a nudge counts only while it is fresh (queued in the last `NUDGE_FRESH_MS`, 8 s). If you walk away from the dock it
  drops out of the queue;
* a nudge never shows while anybody needs you (`nextHint(busy, asks)`).

## Villager rumours

In `talk()`, when no friendship line applies and nobody needs you, the villager may ask `guide.rumour(id, n)`.

* It answers only on every third chat from the second (n % 3 = 1), so the useful report comes first.
* There is at most one rumour every 3 min across the whole village.
* It picks a page you haven't found that has a `rumour`, preferring ones that can be done right now. The choice is
  seeded by villager, chat number and day.
* `by` limits who says it. The grotto's line ("Does it sound hollow to you?") is Fern's alone.

## What's new

`FEATURES` lists what was added, with an increasing `ver` per release. Append to it; never renumber.

`guide.news({ welcomed })` runs once on load:

* **A first-run profile** (it hadn't met Posy before this load) never gets the letter; Posy's welcome is its letter.
  The notebook marks it as up to date (`news = LATEST`).
* **A profile from before the notebook** (welcomed, but no notebook record) hears about everything after `BASELINE`.
* **Later**, a profile hears only about releases newer than its `news`.

The letter comes from *Fern, the ranger* (`from: 'guide'`): *"New pages for your notebook"*. It lists up to 8 items
(newest first, keys filled in) and never spoils a secret: the grotto is "a rumour". The mailbox shows an **Open the
notebook** button on it. The last letter is re-posted on load.

When shipping something new, add a `FEATURES` line with `ver: LATEST + 1` (and a page if it's an activity).

## Dev and checks

* `__valley.guide()` returns pages (found / fresh / now / notes), seen, known, news and the nudges here.
* `__valley.guide('open', page | chapter)`, `('see', id)`, `('news')` (posts a letter as if your last visit were older)
  and `('reset')`.
* `__hud.tour.tip('boat')` shows a nudge now.
* Tests:
  * `node --test renderer/src/farm/model/guide.test.ts` covers pages, discovery, progress, nudges, rumours, news, the
    service and parsing;
  * `onboarding.test.ts` covers nudge cadence, freshness and asks;
  * `robust.test.ts` covers the store.
* Browser test: `npm run build && npx playwright test browser-tests/guide.spec.ts --output scratch/pw-guide`. It covers:
  * the nudge at the dock;
  * O, hints on empty pages, the secret's "? ? ?", ↑↓←→;
  * climbing into the rowboat finds the page, with a toast;
  * Collections finds;
  * the found page's key caps and progress;
  * the pause menu, Controls and Settings;
  * a rumour;
  * persistence across a reload;
  * the what's-new letter for a returning profile, and none on a first run.

  Screenshots of the notebook, the empty page, the nudge and the letter land in `scratch/pw-guide/`.

```sh
npm run shoot -- --shot "name=nb,pose=dock,hour=10,season=summer,eval=__valley.boat('in');setTimeout(()=>__valley.guide('open','rowboat'),2500),wait=4000"
npm run shoot -- --shot "name=nb2,pose=hub,hour=10,eval=__valley.guide('open','explore'),wait=1500"
```

Budget: one snapshot a second (a handful of service reads, no scene work), one DOM rebuild per change while the panel
is open, and each sketch drawn once.
