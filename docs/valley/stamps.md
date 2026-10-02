# The stamp book

Long-term goals that tie the valley's systems together: 48 stamps, each earned once and for good, inked into a book on
the Almanac panel's **Stamps** tab. They read the other systems' state; they never keep a copy of it.

Key sources: `model/stamps.ts` (the book, pure + `stamps.test.ts`: `STAMPS`, `StampWorld`, `observe`, `passes`,
`stampsView`, `createStamps`, `TROPHIES`), `stampbook.ts` (wiring: builds the `StampWorld` snapshot off the live
services, created by `main.ts`), `hud/stamps.ts` + `stamps.css` (canvas-drawn stamps, the page, the toast icon),
`hud/almanac.ts` (the tabs), `audio/sfx.ts` (`stamp`), `scene/yard/models.ts` (the trophies). Service `stamps`,
`HudBindings.stamps`. Paths are relative to `renderer/src/farm/`.

## The stamps

| category | stamps (secret ones in *italics*) |
|---|---|
| **Work** (real agent work) | first crate shipped · 100 commits · a 7-day Almanac streak · 10 green test runs in a day · 50 asks answered · five farmers working at once · a field that lived a full week · *midnight oil* (a commit between midnight and four) |
| **Pastimes** | first fish · every fish of one season · a 60 cm catch · 10 forage kinds · the whole field guide · a rainbow (held 3 s) · *odd boot* · first row (the rowboat, [seasons.md](seasons.md)) · *pen pal* (the bottle) |
| **Village** | 2 ♥ with everyone · a 10 ♥ friend · a first request · 20 requests · sat down at a campfire · a bandstand concert (within 30 m, 12 s) · *perfect presents* (a known loved gift for all six) |
| **Explorer** | the summit lookout · 7 cairn stones · out under a meteor-shower night (clear, dark, 20 s) · every leisure nook · a photo-mode picture · *summit by starlight* · *behind the curtain* (step into the grotto behind the falls, [grotto.md](grotto.md)) |
| **Seasons & festivals** | one per festival (be within 22 m of its centrepiece while it is on) · first snow · a figure eight on the ice · a snow friend (a dressed snowman) · all four seasons |
| **Home** | first decor bought · a rank-gated piece · a full yard · the welcome sign · *keepsake* (a 10 ♥ portrait) |

A **demo valley never inks Work stamps** (its farmers are fake; the ship / answer counters don't move either). Dwell
stamps (`StampDef.dwell`) must hold continuously; the timer is in memory only.

## How it is evaluated (no duplicated data)

Every stamp is a predicate `test(world, memory)` returning yes / no or a `Progress` (`have / need`, shown as a bar and
`3 / 7` under the hint). `stampbook.ts` builds a `StampWorld` about once a second, and ~150 ms after any change hook
(`collection.onFind` / `onSight`, `friends.onChange`, `wallet.onChange`, `celebrate` / `plot-opened` events), from:
the valley state (sky hour / season / weather / lying snow / festival, the Almanac's `streak` and `today.counts.tests`,
farmers with status `working`, open fields), the Collections / friends / wallet data objects as they are, the trail's
`stones()`, `gatherings.active()` + `controller.seated` (campfire) or the stage distance (concert), the festivals
service's `where().center`, `atmosphere.state().rainbow`, `showerOn(dayOfYear)` (scene/sky/meteors.ts), `indoors.active`
and where the player stands (each nook's footprint + 3 m, the summit deck). `ship` / `unblocked` valley events and photo
mode's `onSave` are counted as they happen (`event()`), with the wall-clock hour for midnight oil.

**Persisted** (`claude-valley.stamps.v1`, per browser profile; tolerant `parseStamps`), only what no other service
keeps: earned stamps + when (ms), lifetime counters `ship` / `answered` / `photo` / `late` / `row` / `eight` / `snowman` (the seasonal pastimes count their own moments: `StampsService.event`), first / last seen of open
fields (`plots`, last seen refreshed hourly, pruned 3 days after a field is gone, so a reopened workspace starts its
week again), and the sets of nooks, festivals and seasons visited. `trophies` = cups already given.

## Rewards

* 10 bits a stamp, 25 for a secret one (`bitsFor`, paid through `WalletService.reward`).
* **Trophies** for the yard at 10, 25 and every stamp (`TROPHIES`): bronze, silver and golden loving cups on a wooden
  plinth with a red ink stamp on its face (`trophy-bronze` / `trophy-silver` / `trophy-gold`, `DecorDef.gift`: never
  stocked or sold; given with `WalletService.gift`, into the first free yard slot or storage). Gallery: `decor` variant
  `trophy-gold` etc.

## On screen

* **Toast** when one is inked: the inked stamp itself as the icon (`stampIconHtml`), the name, bits and blurb;
  `group: 'stamp'` so a burst (a first run with an old Collections book) coalesces ×n. A trophy gets its own toast.
  The `stamp` sfx (a rubber stamp: ink-pad tap, woody thunk, paper slap, the peel) plays at most once per 1.2 s.
* **The Almanac (H) has two tabs**, *Almanac* and *Stamp book n/43*: click, 1 / 2, or S toggles;
  `__hud.open('almanac', 'stamps')` (or `{ tab: 'stamps' }`) opens on the book. The page: count, bits earned and the
  three cups, then one grid per category. Inked = the stamp (category shape + ink: work red circle, pastimes blue
  scallop, village rose square, explorer green hexagon, seasons orange oval, home violet house), its own drawing
  (`MOTIFS`, drawn with canvas paths in `hud/stamps.ts`), the date across a band, a seeded tilt and worn ink; unearned
  = a faint dashed outline with a ghost of the drawing and the hint; secret = "?" and a vague clue. Each image is drawn
  once and cached as a data URL.

## Dev and checks

* `__valley.stamps()` lists every stamp (`earned`, `day`, `secret`, `progress`); `stamps(n)` inks the first n quietly
  (no rewards: shots); `stamps('reset')` forgets the book. `__valley.stamp(id)` inks one now with its bits, trophy,
  toast and thunk.
* Shots:

  ```sh
  npm run shoot -- --shot "name=sb,pose=hub,hour=10,eval=__valley.stamps(18);__hud.open('almanac','stamps'),wait=1500"   # the book
  npm run shoot -- --shot "name=st,pose=hub,eval=__valley.stamps(9);setTimeout(()=>__valley.stamp('summit'),1500),wait=2500"   # toast + bronze cup
  npm run shoot -- --shot name=tr,gallery=decor,variant=trophy-gold     # a trophy (trophy-bronze | trophy-silver | trophy-gold)
  ```

* Tests: `node --test renderer/src/farm/model/stamps.test.ts`; browser flow `browser-tests/stamps.spec.ts` (a catch
  inks stamps, toast + bits, the tab's inked / outline / secret cells, persistence across a reload, no work stamps in
  the demo): `npm run build && npx playwright test browser-tests/stamps.spec.ts --output test-results/stamps`.
* Adding a stamp: append to `STAMPS` (ids are save keys; never rename), pick a `MOTIFS` entry (or add one and its
  drawing to `M` in `hud/stamps.ts`), keep the predicate reading other services' data through `StampWorld` (add a field
  there and in `stampbook.ts` if needed), and persist only what nobody else remembers.
