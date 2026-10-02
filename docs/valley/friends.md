# Villagers, friendship and requests

The persistent townsfolk (cast, routines, dialogue, contracts) and your friendship with them: hearts, gifts, daily
requests, the tracker and milestones. Villagers package.

Key sources: `scene/villagers/` (`cast.ts`, `schedule.ts`, `lines.ts`, `friendlines.ts` (pure, tested),
`villagers.ts`; role hats / wear / lantern data in `scene/farmers/mascots.ts` + `geo.ts`, drawn by the shared rig),
`model/friends.ts` (pure + `friends.test.ts`; service `friends`, `HudBindings.friends`), `hud/friends.ts` +
`friends.css` (panel `friends`, the request tracker, toasts), `scene/context.ts` (contracts). Paths are relative to
`renderer/src/farm/`.

## The villagers

Not agents, never in ValleyState, the roster, the needs-you strip, the mailbox or the agent dots: Clawds in non-agent
body colours, each with a role hat (one shared instanced mesh), one piece of role wear over the body, a green role
signboard for a nameplate and a house-shaped pin on the maps. Talking to one (E) says a line about the valley
(`lines.ts`, via `ui.say`) and a beat later opens their shortcut; F just chats (or, with something in your basket,
gives a gift: see below). The prompt's second line says what they open, their hearts and any request.

| villager | look | post | E opens | lunch · evening · night |
|---|---|---|---|---|
| **Posy**, postmaster | teal, peaked postcap, mail satchel | beside the mailbox | mailbox ("2 letters waiting, Flint needs you!"); waves you over with an envelope while a letter needs you | picnic meadow · farmhouse yard · farmhouse |
| **Bram**, shipping clerk | mustard, green eyeshade, canvas apron | by the shipping bin | farm ledger (commits shipped today); cheers every `ship` event | pergola · campfire · toolshed |
| **Hazel**, miller | flour-tan, floppy flour-dusted cap, smock | windmill door | system stats, with a line keyed to CPU / RAM / disk | the well · under the sails · the mill |
| **Mayor Marigold** | plum, top hat, sash + medal | by the noticeboard | noticeboard ("3 fields busy, 1 resting") | the square · pergola · farmhouse |
| **Fern**, ranger | forest green, campaign hat, rucksack + bedroll | the signpost; rounds to the stones, orchard, bridge, waterfall, hot spring and pond | valley map | campfire · campfire · sleeps out by the fire |
| **Nimbus**, weather-watcher | sky blue, sou'wester, oilskin cape | stargazers' knoll (a night owl) | the real-clock weather report (say only) | the dock · the knoll · the mill's loft till late morning |

## Routines

* Routines run on the real clock (`schedule.ts`: a cyclic day plan per villager, ±18 min seeded jitter per day,
  rounds, seeded act loops); indoors = they walk to their door and fade out (lights out).
* Storms (or heavy rain / snow) send everyone indoors, the ranger to the barn.
* At social places they wander off to chat with an idle farmer or pet Biscuit / Mochi (`pets.hold` / `pets.pet`).
* After dark they carry a hand lantern (prop `lantern`) that is a real `LightEmitter`.
* They greet you like farmers do and walk the farmers' roads with the farmers' motion / gait / pose code.
* Walk up to one (< 4.2 m) and look at them and they pause and turn to you (`heldUntil`: a 2 s grace after you look
  away, 12 s at most, never on the way to shelter), so E finds who you walked up to. `__valley.goTo(id)` picks the
  nearest approach angle from which the crosshair takes the target (not a mailbox standing in line).
* Villagers also talk about the Almanac rank ([almanac.md](almanac.md)) and festivals ([festivals.md](festivals.md)),
  and come to evening gatherings ([gatherings.md](gatherings.md)).

## Contracts

`scene/context.ts`: interactable kind `'villager'`, optional `Interactable.hint()` (the prompt's second line), optional
`UiPort.roster()`, service `'villagers'` → `VillagerPin[]` (the HUD gets them as `HudBindings.villagers`;
`VillagersService`: map pins, debug). Gallery: `villagers` (variants `post walk wave night back`).

## Friendship

Persisted per profile in `claude-valley.friends.v1`.

* Each villager has **hearts** (0–10, 100 points each, `PTS` in `model/friends.ts`): the day's first chat (E or F)
  +20, **one gift a day each** from your basket (F on a villager while the basket has something → the gift picker,
  1–9 or a click; loved +80, liked +45, anything else +20, disliked −25), a finished request +60, a shared evening
  gathering +30 ([gatherings.md](gatherings.md)).
* Tastes fit the roles: Hazel loves hazelnuts, acorns, chanterelles; Nimbus frost crystals, the message in a bottle,
  thunder bass, moonlit char; Fern feathers, pinecones, morels, trout; Bram the big fish (salmon, pike, carp, thunder
  bass); Posy violets, wild strawberries, mussel shells; Mayor Marigold the showy prizes (golden koi, chanterelles,
  maple leaves, moonlit char). What they think of a gift is remembered and shown in the picker and on their card.
* Reactions are lines in their voice + an emote (heart / sparkle / note / sweat).

## Requests

* Each real day 1–3 villagers post one (`requestsFor(day, season)`, deterministic, feasible in season): bring N of an
  in-season forageable (counted from the basket, taken on delivery), catch a fish (any weather; sometimes "before
  dusk", or "anything after dark"), visit a far nook at the right hour (the standing stones after dark, the
  stargazers' knoll at night, the swing tree, the hot spring at dusk, the orchard by day, the hay meadow: the villagers
  system checks where you stand twice a second), or agent work via `ValleyEvent`s (answer a farmer who needs you =
  `unblocked`, ship a commit = `ship`, a green test run = `celebrate`, a finished task = `finished`).
* Talking to them the first time says the request (instead of opening their shortcut); when it's done (toast "Request
  ready") E on them hands it over: bits (`WalletService.reward`) + hearts, a thank-you line, a heart emote. Unfinished
  requests lapse at midnight.
* The **tracker** (`data-testid="quests"`) sits under the dock (top right, a `data-hud-obstacle="children"` child of
  the dock) as a one-line chip (`♥ 0/3 requests`, a gold `!` while one is ready); hover / focus opens it, a click or
  **Q** keeps it open (pref `valley.hud.quests` = `open`), and it peeks open for 10 s when a request turns ready; it
  hides under big panels, rows open the Friends panel; the noticeboard pins a Requests note; the prompt's hint line
  shows `♥ n` and "has a request" / "request ready!". The map shows requests as heart pins ([map.md](map.md)).

## Milestones

2 ♥ a letter, 4 ♥ warmer lines (`closeLine`), 6 ♥ their own decor piece in the General store (`DecorDef.friend`:
Posy's pillar box, Bram's crate stack, Hazel's millstone table, the Mayor's prize pumpkin, Fern's pup tent, Nimbus's
weather vane), 8 ♥ a recipe letter, 10 ♥ a keepsake portrait on an easel (`keep-<id>`, `DecorDef.keepsake`, never
sold) given into your yard with a last letter ([economy.md](economy.md)). Letters are kept in the friends data and
re-posted to the mailbox on load (`Valley.post`, kind `news`).

## Dev

`__valley.villagers()` (pins) / `villager(id)` (what one is doing); `goTo('villager:posy')` walks up to one, then
`interact()` talks. `__valley.hearts(id?, n?)` (set hearts; milestones fire), `requests()` / `requests('ready')`
(completes them) / `requests('YYYY-MM-DD')` (that date's set, as today's), `gift(id, item)` (stashed first if the
basket lacks it); `__hud.open('friends', { give: 'villager:<id>' })` opens the gift picker.

```sh
npm run shoot -- --shot "name=fa,goto=villager:fern,hour=10,eval=setTimeout(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'})),1200)"  # a villager asks for today's request
npm run shoot -- --shot "name=fg,pose=hub,eval=__valley.hearts('posy',7);__valley.gift('hazel','boot');__valley.ctx.services.get('wallet').stash('koi',2);__hud.open('friends',{give:'villager:marigold'})"  # Friends panel + gift picker
npm run shoot -- --shot "name=fd,goto=villager:hazel,hour=10,eval=__valley.requests('ready');setTimeout(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'})),1200)"  # hand a request over
npm run shoot -- --shot "name=fs,hour=22,eval=__valley.requests('2026-10-06');__valley.goTo('stones')"   # a visit request (stones after dark) turning ready
```

A villager line in a shot: `goto=villager:posy` plus
`eval=setTimeout(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'})),1200)` ([hud.md](hud.md)).
