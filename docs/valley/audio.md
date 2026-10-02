# Sound

WebAudio synthesis, no files: buses and the master chain, the music planner and band, gathering music, footsteps,
ambience, captions for world sounds, the coverage audit, measured levels and the offline debug renderer. Life & sound
package.

Key sources: `audio/engine.ts` (buses), `audio/mix.ts` (`busGains`, `ambientLevels`; `mix.test.ts`),
`audio/musicPlan.ts` (pure + tested), `audio/music.ts` (player), `audio/instruments.ts` (band), `audio/steps.ts`
(pure + tested), `audio/sfx.ts` (`STEP_RECIPES`), `audio/ambience.ts`, `audio/loops.ts`, `audio/voice.ts` +
`voicePlan.ts`, `audio/captions.ts` (pure), `audio/coverage.test.ts`, `audio/debug.ts` (loaded on demand); browser
check `browser-tests/audio.spec.ts`. Paths are relative to `renderer/src/farm/`.

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
bees by live hives, **leaves** rustling with the gusts out in the countryside (thin in winter; in autumn dry leaves
skitter along the ground on the strong gusts) and **cowbells** near a cows / sheep field by day. Beds are built only
while audible and retired after 8 s of silence. Wildlife voices: [wildlife.md](wildlife.md#budget-and-sound).

* **Seasons** (`BIRD_SEASON` in `mix.ts`): birdsong is densest in spring (× 1.2, and a louder dawn chorus), × 0.8 in
  autumn, a few hardy birds in winter (× 0.35).
* **The snow hush** (`levels.hush`, engine `setHush`): falling or lying snow (`sky.trace.snow`) and fog low-pass the
  outdoor beds and critters (down to ≈ 5 kHz at full hush): a softer, closer valley. Not applied indoors.
* **The grotto** (`levels.cave`; the interior system's `grotto` room): the open-air beds fall away (× 0.15), the falls
  stay as a muffled rumble through the rock, the dry `cave` bed plays (a hollow hum, drips echoing in the dark), the
  sfx and voice buses get a 0.21 s slap-back echo (engine `setCave`, 6 nodes built on first entry) and the music rests
  (`MusicIn.cave` → no scene). The pool's own drips and the fishing are positional one-shots from `scene/grotto`.
* **The glasshouse** (restored: the `projects` model, polled every 2 s): within ≈ 14 m a positional bed of warm still
  air, condensation drips, the mister's hiss and a bumblebee at the glass.
* **The mill wheel** (restored): `scene/projects` runs `audio.loop('millwheel')` at the wheel: the millrace churning,
  a paddle slapping in every 0.58 s (12 paddles at 0.9 rad/s), drips, the axle groaning now and then.

## Captions for world sounds (`captions.ts`, pure + tested)

The HUD captions the valley-event cues itself (`model/prefs.ts captionFor`). The sounds other systems play in the
world that carry news are captioned from here: `SOUND_CAPTIONS` (train whistle, the merchant's cart, a fish biting,
fireworks, thunder), each only while audible (gain after distance ≥ `CAPTION_MIN_GAIN`) and not more often than its
own gap. `ValleyAudio.onCaption(fn)` delivers them (the HUD subscribes in `bind` and draws them when captions are on);
they fire even before the AudioContext is unlocked.

## Coverage (features × sounds)

Audited Oct 2026 (present = intentional, weak = a stand-in sound, missing = silent). "→" is what was done.

| feature | sounds | status |
|---|---|---|
| square, roads, fields | birds, wind, leaves, cowbells, bees, stone / dirt / grass steps, hoe + sparkle (new field), creak (closed), villager / farmer voices | present |
| river vs pond | river: positional brown + babbling bed along the nearest bank; pond: lapping swells, plops, frogs at night | present (distinct) |
| waterfall, ledge | positional roar, swelling past the usual peak right under the falls | present |
| windmill, campfire, gatherings | creak period = CPU; fire bed; sing-along / concert placed at the stage | present |
| farmhouse, barn | muffle + duck, roof rain (tin × 1.9), chores (moo, cluck, pour, hammer…), floorboard creaks | present |
| grotto | pool drips + fishing + chest + glow-caps | present |
| grotto room tone | was: valley beds muffled, parlour waltz → cave bed, slap-back echo, music rests | missing → added |
| orchard hives | `loop('bees')` at the hives by bee activity | present |
| orchard shake | was creak + grass step → `rustle` (leafy swishes + twigs) + a soft creak | weak → added |
| orchard fruit | was a grass step per bounce → `thump` | weak → added |
| cider press | was creak + pour → `press` (ratchet, beam groan, squelch, bubbles) then the pour | weak → added |
| projects board | coins / pop / ui-click (hud), fanfare on complete | present |
| unveiling | fanfare + pop + sparkle at the place, confetti, finale fireworks, lantern sparkles | present |
| mill wheel | was the river loop reused → `millwheel` loop | weak → added |
| halt | bell; the answer was a human whistle → `train` (steam chime whistle + chuffs, carries 320 m, captioned) | weak → added |
| observatory | the telescope was silent → `scope` (brass ratchet, lens click) | missing → added |
| glasshouse | violet pop; no ambience → `glasshouse` bed | missing → added |
| merchant | greet voice, coins / oops in the shop; the cart was silent → `cart` while it rolls (wheels, harness bells; captioned) | missing → added |
| painter | greet voice; the brush was silent → `brush` strokes within 12 m | missing → added |
| parcel post | whistle + mail; the morning train was silent → `train` at the halt as he steps off | missing → added |
| command palette | ui-open / ui-close (panel); ↑↓ were silent → `ui-hover` tick | weak → added |
| focus queue (Alt+N) | was silent → `focus` (notify bus: its own slider, ducks the music) | missing → added |
| harvest recap | done chime (finished event), postcard ui-open; ←/→ paging was silent → `page` | weak → added |
| photo mode / album | countdown ticks, page / clicks; the shutter was a page flip → `shutter` | weak → added |
| Fern's notebook, gazette, stamps | page, ui-click, stamp thunk | present |
| pet, wildlife | bark / meow / purr / pet / fetch; critter voices | present |
| seasons | spring = summer birds; autumn leaves only in the trees; winter just fewer birds → `BIRD_SEASON`, autumn skitter, snow hush | weak → added |
| weather | rain, storm thunder, roof, puddle steps, snow steps | present |
| pastimes (fishing, forage, boat, skating, snowmen) | cast / plop / bite / reel, oar, skate, crunch | present |
| captions | valley events only → + world sounds (`captions.ts`) | weak → added |

## Levels

Measured offline, default sliders, momentary loudness in dBFS after the master: land beds ≈ −40, near water −28…−33,
music ≈ −34, footsteps ≈ −31…−36, needs-you alert peak ≈ −5; mixes peak below −11 dBFS. Instruments are trimmed to
equal loudness (`INSTRUMENT_GAIN`), roles balanced in `ROLE_GAIN`, overall `MUSIC_LEVEL`. CPU: the audio system costs
≈ 0.1 ms / frame; music schedules ≲ 30 notes a bar (a few oscillators each).

New sounds (Oct 2026; `browser-tests/audio.spec.ts` writes `levels.json`): before the buses, momentary loudness
rustle −28, thump −22, press −32, train −19, cart −24, brush −36, scope −30, focus −29, shutter −29 dBFS (for scale:
ui-click −32, creak −32, chime-done −15, alert −13); at the default sliders that lands the shake ≈ −33, the cart
≈ −32 at 4 m, the brush ≈ −42 beside the easel, the focus step ≈ −32 (well under the done chime ≈ −19) and the train
≈ −35 within 25 m (≈ −40 from the halt's platform). Beds at level 1: millwheel −18, cave −23, glasshouse −28 (river
−15, pond −19, leaves −32). Mixes through the master (10 s): river −27, pond −31, glasshouse −35, spring dawn −31,
autumn −38, snow −43, grotto −21 (the offline mix leaves out the indoor muffle, which takes the falls down ≈ 6 dB+);
every mix peaks ≤ −11 dBFS. Cost: the new beds are 2–4 noise sources each and only exist while audible; the cave echo
is 6 nodes built on first entry; the cart / brush one-shots are rate-limited (≥ 1.15 s / 1.3 s).

## Measure, don't guess (`audio/debug.ts`, loaded on demand)

* `const d = __valley.ctx.services.get('audio')._debug`
* `d.render('inst:flute:67' | 'step:dirt:wet' | 'loop:leaves:1' | 'piece:evening:autumn:harvest' | 'alert')` → peak /
  RMS / momentary loudness / spectral centroid / HF share.
* `d.mix('meadow,music=afternoon,steps=grass')` renders 20 s of a moment per layer and through the master (presets:
  square meadow river pond campfire mill falls dawn rain storm snow grotto glasshouse spring autumn).
* `d.render('loop:leaves:1:autumn')`: a 4th part is the season for the loops that care.
* `d.pcm(name, s)` returns 16-bit PCM for a WAV; `d.renderAll()`; `d.stats()` (beds, music piece / bar / rest);
  `d.next()` skips to the next piece; `d.music(false)`.
