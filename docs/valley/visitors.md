# Visitors

Three strangers call on the valley on their own calendar. They walk in along the roads like the villagers, show on the
map, and are announced by a toast, Fern's notebook and the Gazette. They keep to daylight, and the painter keeps to
fair weather.

* **Barnaby Pell, the travelling merchant.** He pulls a plum-and-teal cart over the south pass and parks it off the
  square, east of the cobbles. He sells a few rare things the General store never stocks: one of each per visit, and
  no haggling.
* **Odile Varenne, the wandering painter.** She sets up an easel facing one of the valley's sights and paints it over
  the day. When it is finished you can buy the canvas, and it hangs on the farmhouse wall.
* **Ned Hobbs, the parcel post.** Once the train halt is restored (see [projects.md](projects.md)), he steps off the
  morning train, walks to the mailbox, leaves a parcel and hurries back.

Key sources (paths relative to `renderer/src/farm/`):

| file | what |
|---|---|
| `model/visitors.ts` (pure, `visitors.test.ts`) | who comes when (`VISITORS`, `comes`, `visitorsOn`, `nextVisit`, `phaseAt`), the cart's stock and prices (`STOCK`, `stockFor`, `stockView`), the painter's spots and progress (`PAINT_SPOTS`, `paintSpotFor`, `paintProgress`), the parcel (`parcelFor`), the stored data (`parseVisitors`) and the service (`createVisitors`) |
| `visitorsboard.ts` | wires the model to the wallet, the projects (is the halt done?), the grotto and the mailbox. Storage key `claude-valley.visitors.v1`. Service `visitors` |
| `scene/visitors/visitors.ts` | system `visitors` (scene root `visitors`), service `visitorsScene`: the walkers (the villagers' rig, gait and road routing), the cart, the easel, the farmhouse wall painting, labels, lanterns, interactables |
| `scene/visitors/models.ts` | Kit builders: the cart (`buildCart`), the easel (`buildEasel`) |
| `scene/visitors/cast.ts` (pure) | their looks (Clawds in villager dressing: a body colour no agent kind uses, a role hat, one piece of wear) and their lines |
| `scene/visitors/paint.ts` | the painting itself, drawn on a canvas in passes as the day's progress grows (`drawPainting`, `paintingUrl`) |
| `hud/visitors.ts`, `hud/visitors.css` | the panel (`panel-visitors`: the merchant's and painter's tabs) and the toasts (`watchVisitors`) |
| `dev/visitors.ts` | `__valley.visitors` |

Decor pieces live in `model/shop.ts` like every other piece, flagged `visitor: true`: `starlamp`, `sundial`,
`moonflower` and `whirligig`. They are built in `scene/yard/models.ts`. The flag keeps them out of the General store
(`shopView`), and `lockOf` treats them like keepsakes.

## The calendar

Everything is deterministic from the local date key, so the panel, the notebook and the Gazette can all say *when*
truthfully.

| who | days | hours | weather |
|---|---|---|---|
| merchant | Wednesdays and Saturdays (`MERCHANT_DAYS`), plus festival days (`festivalVisit`: every day of a festival of three days or fewer, otherwise its first day, its last day and its weekend days) | 8:30–17:30 | comes rain or shine (a rain line); a lantern on the cart after dusk |
| painter | 40 % of fair days (`PAINTER_ODDS`, seeded per day); a fair day has no rain, storm or snow in the 9:00–18:00 blocks | 9:30–16:30 | packs up early if it turns wet anyway (`tooWetToPaint`) |
| postie | Mondays and Thursdays, once the halt is restored | 10:15–11:30 | comes in any weather; one delivery a day |

They walk in after their arrival hour and walk out at their leaving hour. The merchant and the painter come through the
south pass; the postie comes from the halt's platform. If you load the valley mid-visit, they are already in place
(the cart parked, the easel up). At night a carried lantern and the cart's lamp light them (`LightEmitter`,
`when: 'night'`).

## The merchant's cart

**Stock** (`stockFor(day)`): two of the four rare pieces, plus the glimmer lure (70 % of days) and the sketch map (55 %).
If that leaves fewer than three items, he adds a third piece. Prices sit within ±8 % of base, rounded to 5.

| id | what | base | effect |
|---|---|---|---|
| `starlamp` | Star-glass lantern (decor) | 240 | a glowing yard piece |
| `sundial` | Brass sundial (decor) | 210 | a yard piece |
| `moonseed` | Moonflower seeds (the `moonflower` decor, max 2) | 170 | a pot of white flowers that glows at night |
| `whirligig` | Whirligig (decor) | 150 | a yard piece |
| `lure` | Glimmer lure | 85 | for the rest of the day, rare forage and fish odds × `LURE_BOOST` (2.5): `forage.ts` multiplies `rareBoost` by `visitors.fishBoost(day)` |
| `map` | Explorer's sketch map | 140 | the grotto's "?" appears on the map (`visitors.mapped('grotto')`, read by `hud/map.ts`); shown as known (not for sale) once you have found the grotto |

Rules for buying:

* You can buy one of each item per visit, and only while he is trading (settled at the cart).
* A decor piece is paid with `wallet.spend`, then placed with `wallet.gift` (the yard's next free slot, the same path as a
  trophy). If gifting fails, the bits are refunded.
* Locks in `stockView`: `bought` (today), `owned` (at the piece's max), `known` (the map's secret), `coins`.

## The painter

* Her subject for the day is `paintSpotFor(day)`: the windmill, the pond, the farmhouse, the barn, the bridge or the
  stones.
* The scene puts the easel back from the subject (`PAINT_AT`), keeping clear of festival dressing.
* The canvas fills from 10:00 to 15:00 (`paintProgress`), redrawn every 5 %.
* Once finished it costs `PAINTING_PRICE` (160).
* Bought paintings are kept (day, spot, season, title). The newest hangs over the fish tank in the farmhouse. It is a
  scene child flagged `userData.indoors`, so it shows only inside.

## The parcel

When Ned reaches the mailbox, the parcel is delivered (`deliver`, once a day). It contains a letter through
`valley.post`, a common forage find for the season (in your basket), and a pinned note with Barnaby's next day.

## Announcements

* **Toasts** (`watchVisitors`): an arrival (once a day each, `arrived`), a purchase and where it landed, the painting
  hung, the parcel.
* **Map** (`hud/mapdraw.ts`): a tile in each visitor's colour with a glyph: `cart`, `easel` or `parcel`, and a short
  label on the big map. The tooltip says what they are doing.
* **Notebook** (`model/guide.ts`): the page `visitors` ("Comings and goings", village chapter), found when you first
  meet one. It shows when each one comes next. Listed in `FEATURES` at ver 8.
* **Gazette** (`model/gazette.ts`): a "Curiosities" classified with the merchant's next day, worked out from his
  calendar at the issue's date.
* **Sound**: the cart rattles in and out (`cart`: wheels and harness bells, a burst every ~1.2 s while it rolls, within
  60 m; captioned), the painter's `brush` within 12 m while she paints, the morning `train` at the halt as the parcel
  post steps off (captioned), then his whistle ([audio.md](audio.md#coverage-features--sounds)).

## The panel

`panel-visitors` opens from Barnaby (Talk to, then his wares), the cart (Browse), Odile or the easel (Look at), or
`__valley.visitors('open', id)`.

* **Tabs:** `visitor-tab-merchant` and `visitor-tab-painter`. ←/→ or 1/2 switch tabs; ↑/↓ move between the buttons.
* **Rows and buttons:** `visitor-item-<id>`, `visitor-buy-<id>`, `visitor-buy-painting`, `visitor-canvas`.
* **Messages and footer:** `visitor-msg` (a polite live region) and `visitor-foot` (comings & goings, your purse).
* **Accessibility:**
  * Every status is a glyph plus a word, never colour alone.
  * High contrast outlines the rows.
  * Reduced motion makes the easel appear at once instead of popping up.

## Dev and tests

* `__valley.visitors()`: today's calendar, who is here, the stock, the easel, the stored data.
* `__valley.visitors(id, 'in' | 'here' | 'out')`: force an arrival (walking in, already settled) or a departure.
  `('calendar')` drops the forced visits.
* `('go', id)`, `('open', id)`, `('finish')` (the canvas is done), `('buy', stockId | 'painting')`, `('days', n)`,
  `('reset')`.
* A forced painter visit paints on a 90-second real-time clock.
* Tests:
  * `model/visitors.test.ts`: the calendar, stock, prices, the service and the Gazette notice. `robust.test.ts` fuzzes
    the stored data.
  * `browser-tests/visitors.spec.ts`: the merchant parks, the panel opens with E, a bought piece lands in the yard, the
    lure, keyboard, a reload.
* Shots:

  ```
  npm run shoot -- --shot "name=m,hour=11,eval=__valley.visitors('merchant','here');__valley.visitors('go','merchant'),wait=3000"
  ```

  For the painter use `__valley.visitors('painter','here');__valley.visitors('go','painter')`. For the wall,
  `('finish')`, `__valley.coins(500)`, `('buy','painting')`, then `__valley.inside('tank')`.

## Budgets

* About 11 meshes (draw calls) under the `visitors` root with the cart parked and the easel up (merged per material
  through Kit; one Crowd for all three walkers). Zero when nobody is visiting.
* The system costs ≲ 0.5 ms a frame while someone is here. It plans at 2 Hz and is idle when nobody is.
