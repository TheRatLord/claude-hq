# Festivals

The calendar's real-date festivals: what each one builds on the square, its interactable, villager talk, the
noticeboard poster and the greeting toast.

Key sources: `model/calendar.ts` (pure + `calendar.test.ts`; `ValleyState.sky.festival` = `{ active, next }`),
`scene/structures/festivals.ts` (service `festivals`), `scene/villagers/lines.ts`, `hud/festival.ts`,
`audio/musicPlan.ts` (`FESTIVAL_MUSIC`). Paths are relative to `renderer/src/farm/`.

## The calendar

| id | festival | dates | dressing |
|---|---|---|---|
| `blossom` | **Blossom Fair** | Apr 24 – May 3 | maypole, garlands, cherry petals |
| `lantern` | **Lantern Night** | Aug 10–16 | paper lanterns round the pond, floating lanterns, sky lanterns after dark |
| `founders` | **Founders' Day** | Sep 28 (the first commit) | cake, pennants |
| `harvest` | **Harvest Festival** | Sep 22 – Oct 14 | giant prize pumpkin, cornucopia, hay stacks, scarecrow contest |
| `hallowtide` | **Hallowtide** | Oct 24 – Nov 1 | jack-o'-lanterns that light the roads, bats, wisps |
| `starlight` | **Starlight** | Dec 1–30 | decorated tree, string lights, snow lanterns |
| `newyear` | **New Year** | Dec 31 – Jan 1 | fireworks over the south meadow at midnight |

A short festival wins a day it shares with a long one (Founders' Day inside the Harvest Festival).

## In the world

* `scene/structures/festivals.ts` builds the active set: centrepiece on the square's north-west quadrant, strings
  between the hub lamps, a banner over the south exit, one interactable: judge the pumpkin, vote for a scarecrow, dance
  round the maypole, light a wish lantern, trick-or-treat, hang an ornament, blow out the candles, raise a glass.
* A live change pops the new set in. ≤ 9 draw calls (3 merged meshes + banner + swarms).
* Villagers talk about it on alternate chats and mention the next one within 14 days (`lines.ts`), the noticeboard
  pins a poster, and a toast greets you once per real day (`hud/festival.ts`, not on every reload).
* Festival nights also bring a bandstand concert ([gatherings.md](gatherings.md)), festival music
  ([audio.md](audio.md)) and the map's rosette pin + cartouche ([map.md](map.md)).

## Dev

Force one on any date with `?festival=ID` / `__valley.festival(id)` (the season follows unless `?season=` is set);
service `festivals` (`where()`: piece positions for shots). Gallery: `festival` (variant per id).

```sh
npm run shoot -- --shot name=f,pose=square,festival=hallowtide,hour=21   # a festival (blossom lantern founders harvest hallowtide starlight newyear)
```
