# Villagers' days and heart events

How the townsfolk spend their day and what friendship unlocks. Friendship itself (hearts, gifts, requests, milestone
letters) is in [friends.md](friends.md).

Key sources (relative to `renderer/src/farm/`): `model/routines.ts` (pure + tested: the day plans), `model/hearts.ts`
(pure + tested: events, scripts, the stored record), `heartsboard.ts` (wiring), `scene/villagers/*` (staging; `cast.ts`
places, `windows.ts` home lamps), `hud/hearts.ts` + `hearts.css` (the dialogue card), `dev/hearts.ts` (dev hooks).

## Days (`model/routines.ts`)

* Each villager keeps a day on the real clock: home in the morning, their work spot, lunch somewhere sociable, an
  afternoon pastime, an evening out, then home to bed, when their home's lamp goes out.
* Rain, the season, festivals, Sundays and restored Valley Projects shift the plan (the glasshouse becomes Posy's
  afternoons, the observatory Nimbus's nights, a festival pulls everyone to the square).
* A plan is a short list of `RoutineEntry`s built from a `RoutineCond`; the scene caches it per condition and asks
  `routineAt` a few times a second. Places are symbolic `PlaceKey`s that the cast maps to spots. The same plan answers
  "where is Fern?" for the map and the "usually at…" lines in Fern's notebook.

## Heart events (`model/hearts.ts`)

* At 3, 5 and 7 hearts (`EVENT_HEARTS`) each villager has a short scene to share. It plays the next time you meet
  them at the right place and hour; they wave you over with a heart and {use} listens.
* A scene is a few lines, one choice and a little staging (an act, an emote, where they and you look), and leaves a
  keepsake: an album photo, a letter, or a yard piece (the `friend` gifts in `model/shop.ts`, never sold).
* Seen events and choices persist in `claude-valley.hearts.v1`; the notebook's village chapter keeps the record.

## Dev

`__valley.routine(id?, to?)` shows or jumps a villager's day (`null` hands them back to the clock).
`__valley.heartEvent(id?, 'play' | 'next' | 'choose' | 'reset', k?)` lists, forces, steps or forgets events.

## Not done yet

No browser test covers a heart event end to end (the pure model is tested in `hearts.test.ts` / `routines.test.ts`).
