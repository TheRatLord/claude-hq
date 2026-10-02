# Sound

WebAudio synthesis, no files: buses and the master chain, the music planner and band, gathering music, footsteps,
ambience, measured levels and the offline debug renderer. Life & sound package.

Key sources: `audio/engine.ts` (buses), `audio/mix.ts` (`busGains`, `ambientLevels`; `mix.test.ts`),
`audio/musicPlan.ts` (pure + tested), `audio/music.ts` (player), `audio/instruments.ts` (band), `audio/steps.ts`
(pure + tested), `audio/sfx.ts` (`STEP_RECIPES`), `audio/ambience.ts`, `audio/loops.ts`, `audio/voice.ts` +
`voicePlan.ts`, `audio/debug.ts` (loaded on demand). Paths are relative to `renderer/src/farm/`.

## Buses (`engine.ts`)

sfx, notify, voice → master; ambient (the beds, critters, other packages' loops) and **music** → a hidden-tab duck
(30 %) → master. Every bus has its own slider (pause menu → Sound: master, effects, ambience, alerts & chimes, farmer
voices, music; square-law taper in `mix.ts busGains`). Master chain (`buildMaster`, shared with the offline mixdowns):
a gentle glue compressor (−16 dB, 2:1) then a fast limiter (−4 dB, 20:1). Indoors the outdoor beds go through a
low-pass and duck; the music, the `roof` rain and loops started by the interior stay dry ([interior.md](interior.md)).

## Music (`musicPlan.ts` pure + tested, `music.ts` player, `instruments.ts` band)

* Pieces, not a drone: a piece is planned for the moment (`musicScene`: morning 5–11, afternoon 11–17, evening
  17–21:30, night, rain (storms too, quieter; a fierce storm gets none), indoors) with a key, a mode, a tempo
  (56–108 bpm), 3/4 or 4/4 and a song form (`iAABAo`, `iABAo`, …: 2 intro bars, 4- or 8-bar sections, 2 outro bars;
  ≈ 45–125 s).
* Melodies come from a 2-bar motif stated, sequenced, restated and cadenced; strong beats sit on chord tones, weak
  beats on the mode's pentatonic, everything is diatonic, A ends home and B on the dominant.
* After a piece it **rests 15–75 s** (longer at night) so the valley's own sound carries the silence. Going in / out or
  a storm fades the piece within ~1 s; a new hour or rain lets it finish.
* **Seasons change the band** (`KITS`: spring flute + kalimba, summer marimba + guitar, autumn reed + guitar, winter
  glockenspiel / music box + electric piano; rain = electric piano + strings; indoors a parlour waltz).
* **Festivals** (`sky.festival.active`; [festivals.md](festivals.md)): every other outdoor piece is the festival's own,
  built on its leitmotif and instrument (`FESTIVAL_MUSIC`: Blossom flute reel, Lantern bell lullaby, Founders' "happy
  birthday" music box waltz, Harvest barn-dance oom-pah, Hallowtide minor celesta + pizzicato, Starlight jingle bells +
  sleigh shaker, New Year auld lang syne on a soft horn), auto-harmonized (`harmonizeTune`).
* Tunes are seeded per real day. Ducks to 25 % under notifications and to 60 % while someone near you talks.

## Gathering music

`GATHER_SCENES` in `musicPlan.ts`; `MusicIn.gathering` from the `gatherings` service's `music(listener)`
([gatherings.md](gatherings.md)): near a campfire sing-along (≤ 80 m) the piece is the `campfire` waltz (84 bpm 3/4,
reed + guitar, the `CAMPFIRE_SONG` motif); near a concert (≤ 115 m) the `concert` piece (100–116 bpm, strings /
guitar / flute, percussion, short rests between songs). Starting one fades the current piece; while it plays the music
bus is **placed** at the fire / stage (`music.place(pan, gain)`: spatial pan × 0.75, distance gain floored at 0.22).

## Footsteps (`steps.ts` pure + tested, `STEP_RECIPES` in `sfx.ts`)

The controller's grass / water / wood is refined from where you stand: paved square = stone, roads (`pathAt` > 0.55) =
dirt crunch, decks (bridge, dock, porch) = hollow wood, the farmhouse = floorboards (one creaks now and then), lying
snow (`sky.trace.snow`) or winter above the snow line = snow crunch, wading = splash; wet ground (`sky.trace.wet`,
lingers after rain; [weather.md](weather.md)) adds a puddle splash. Steps alternate a touch left / right; `STEP_GAIN`
levels the surfaces.

## Ambience (`ambience.ts` + pure `ambientLevels` in `mix.ts`, loops in `loops.ts`)

Wind (gusts), rain, river / waterfall / pond by distance (positional), dawn chorus and daytime birds, crickets (tempo
follows the CPU thermometer), owls and pond frogs at night, the campfire after dusk, the windmill (creak period = CPU),
bees by live hives, **leaves** rustling with the gusts out in the countryside (thin in winter) and **cowbells** near a
cows / sheep field by day. Beds are built only while audible and retired after 8 s of silence. Wildlife voices:
[wildlife.md](wildlife.md#budget-and-sound).

## Levels

Measured offline, default sliders, momentary loudness in dBFS after the master: land beds ≈ −40, near water −28…−33,
music ≈ −34, footsteps ≈ −31…−36, needs-you alert peak ≈ −5; mixes peak below −11 dBFS. Instruments are trimmed to
equal loudness (`INSTRUMENT_GAIN`), roles balanced in `ROLE_GAIN`, overall `MUSIC_LEVEL`. CPU: the audio system costs
≈ 0.1 ms / frame; music schedules ≲ 30 notes a bar (a few oscillators each).

## Measure, don't guess (`audio/debug.ts`, loaded on demand)

* `const d = __valley.ctx.services.get('audio')._debug`
* `d.render('inst:flute:67' | 'step:dirt:wet' | 'loop:leaves:1' | 'piece:evening:autumn:harvest' | 'alert')` → peak /
  RMS / momentary loudness / spectral centroid / HF share.
* `d.mix('meadow,music=afternoon,steps=grass')` renders 20 s of a moment per layer and through the master (presets:
  square meadow river pond campfire mill falls dawn rain storm snow).
* `d.pcm(name, s)` returns 16-bit PCM for a WAV; `d.renderAll()`; `d.stats()` (beds, music piece / bar / rest);
  `d.next()` skips to the next piece; `d.music(false)`.
