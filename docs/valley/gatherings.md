# Evening gatherings

The valley is a community: campfire evenings, bandstand concerts and market mornings that idle farmers and villagers
attend, and that you can join.

Key sources: `model/gatherings.ts` (schedule and stories, pure + `gatherings.test.ts`: `scheduleFor`, `canAttend`,
`storyLines`, `CAMPFIRE_CYCLE`, `CAMPFIRE_NIGHTS`), `scene/gather/` (system + service `gatherings`: `gather.ts`; slot
maths in `slots.ts`), `audio/musicPlan.ts` (`GATHER_SCENES`). Paths are relative to `renderer/src/farm/`.

## The calendar (`scheduleFor`, seeded per day)

* **Campfire evenings** on most clear nights (~86 %, `CAMPFIRE_NIGHTS`, and every festival night; about 19:30–22:00,
  times jittered per day; rain and storms cancel, light snow or fog don't).
* A **bandstand concert** 18:30–20:15 on Saturdays, Sundays and festival nights once the bandstand upgrade is in
  ([almanac.md](almanac.md)); everyone then moves on to the fire.
* A **market morning** on Saturdays 8:00–11:30 once the stalls are up.

## Who comes

*Gatherings never hide state:* only `idle` / `done` farmers that don't need you attend (`canAttend`); a farmer that
starts work or gets blocked leaves at once (the brain's `World.gather()` is asked every plan, so needs-you still runs
to the gate). Villagers come on their evening slot (~78 %, regulars always; market browsing is a seeded ~40-minute
visit from their post).

## What happens

* **Campfire:** farmers take the logs and the stool, villagers the grass ring; a 4-minute cycle (`CAMPFIRE_CYCLE`: story 84 s, laugh 12, toast 40, sing 80, chat 30) of
  a **story** (the teller, chosen among the settled, says one line every ~10 s in a speech bubble, built from
  ValleyState / almanac only by `storyLines`: crates shipped, green test runs, who planted what, a stubborn bug, a
  finished task title, the streak, the next rank; first person for the teller's own deeds), **laughter** ("ha!"
  emotes, a chuckle chorus), **toasting marshmallows** (held prop), a **sing-along** (the music plays the `campfire`
  waltz, notes over heads) and chat.
* **Concert:** three farmers climb the steps and play fiddle, banjo and flute (props + strum / bow / blow poses, a warm
  lamp under the roof after dark), the crowd arcs out front dancing and clapping, applause between songs; the music
  plays the `concert` piece *live* from the stage (see [audio.md](audio.md#gathering-music)).
* **Market:** villagers browse the counters and gossip between the stalls.
* **Join in:** E on a free log bench ("Sit on") sits you down (`controller.sit`, the eye lowers to 0.98 m and turns to
  the fire; any move key stands you up) and, once a day, every villager present gains friendship (`friends.gathered`,
  +30 pts each; [friends.md](friends.md)).

## Cost

Props and acts reuse the farmer Crowd's vgroup variants (no extra draw calls); the system ticks at 4 Hz and allocates
nothing per frame.

## Dev

`__valley.gather(kind?, seg?, stay?)`: `gather('campfire' | 'concert' | 'market')` puts one on now and stands you
there (`stay = true`: don't move, keeps a free `cam=`); `seg` jumps the campfire to `'story' | 'laugh' | 'toast' |
'sing' | 'chat'`; `gather(null)` back to the calendar; `gather()` → debug state (what's going on). No commas in a shot's
`eval`: split a `'|'` string.

```sh
npm run shoot -- --scenario longIdle --shot "name=g,hour=20.6,weather=clear,eval=__valley.gather('campfire'),wait=80000"  # campfire evening from the viewpoint (farmers walk ~60–80 s)
npm run shoot -- --scenario longIdle --shot "name=gs,hour=20.6,weather=clear,eval=__valley.gather(...'campfire|sing'.split('|')),wait=80000,frames=6,every=600"  # jump to a segment (story laugh toast sing chat)
npm run shoot -- --scenario longIdle --shot "name=c,hour=19.2,weather=clear,eval=__valley.gather('concert'),wait=75000"   # the band + dancing crowd (auto-unlocks the bandstand)
npm run shoot -- --scenario longIdle --shot "name=mk,hour=9.5,weather=clear,eval=__valley.gather('market'),wait=40000"   # market morning
```
