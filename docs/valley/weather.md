# Weather, sky and atmosphere

Real-clock weather and the traces it leaves (wet ground, puddles, lying snow, frost), its moments (rainbow, mist, god
rays) and the night sky (moon path, shooting stars). Atmosphere package.

Key sources: `model/sky.ts` (+ `sky.test.ts`), `scene/weather/` (`surfaces.ts`, `weather.ts`, `lightning.ts`,
`particles.ts`, `ripples.ts`), `scene/sky/` (`sky.ts`, `meteors.ts`, `celestial.ts`, `clouds.ts`), `scene/post/`.
Paths are relative to `renderer/src/farm/`.

## Weather leaves traces and makes moments

Weather follows the real clock (`model/sky.ts`, 3-hour blocks); `sky.trace` (`weatherTrace`, pure + `sky.test.ts`)
integrates the last two days of blocks (a forced `weather` counts as the last 1.5 h for rain / storm / snow, 3 h for
dry kinds, under the forced `hour`'s sun, so `?weather=clear&hour=10` has mostly dried the real night's rain) into `wet` (soaks in fast, dries over hours: slower at night, in fog and
winter), lying `snow` (builds ~3 h to full, melts in rain / sun) and `sinceRain`, so every window agrees and a reload
does not dry the puddles. What it drives:

* **Wet world + puddles** (`scene/weather/surfaces.ts`): one shader-chunk patch on every toon material (no
  per-material hook; shared `VW` uniform block written by the weather system). Wet surfaces darken and richen with a
  soft sky sheen and a banded sun glint (wet lamp pools shine at night). Puddles grow and shrink with `wet` on flat
  ground-level surface-library faces (`VW_SURF`, defined by `withSurfaces`; height checked against `vwGround`, a
  128² heightmap of `heightAt`; the terrain skips that check, it tells the patch its own tracks via `vwPathK` and its
  tall grass via `vwTallK`): freely on paths, the square and soil; on grass rarely, small and muddy (darker, less
  sky, a wider wet rim), only in hollows of the heightmap and never under tall grass. They mirror the sky gradient,
  the sun and lamp light, and ring with drops while it rains. Only real wetting glints in the sun (merely damp ground
  does not). Never on characters, never indoors.
* **Lying snow + frost**: snow covers up-facing world faces in drifts as `trace.snow` builds (the square, roofs,
  fences, crops), with sun sparkle; on cold clear nights and mornings (winter, Nov–mid-Mar) the ground goes pale and
  twinkles with pin-point frost that shimmers as you move, until the sun has been up a while.
* **Rainbow** on the antisolar ring in the first hour after a real shower stops, with the sun out.
* **Mist banks** (post): at dawn a few mornings a week (more in autumn / spring, after rain, in calm air) mist pools
  over the river and pond and lies in the low ground, burning off by mid-morning; all day on fog days. Ray-marched in
  the composite against the same heightmap, drifting downwind, lit by the low sun.
* **God rays** (post, one quarter-res pass): a low sun (early morning, golden hour) fans shafts through trees and gaps
  in the clouds; skipped unless the sun is in front of the camera.

Already there: cloud shadows, lightning that lights the valley, seasonal leaves / petals, sun motes. Weather also
drives footsteps ([audio.md](audio.md)), villagers sheltering ([friends.md](friends.md)), what bites
([pastimes.md](pastimes.md)) and gathering cancellations ([gatherings.md](gatherings.md)).

**Cost** on the 780M at 1600×900 (frame ≈ 6–7 ms GPU when this was measured; see the benchmark in
[tools.md](tools.md#benchmark-npm-run-bench) for current per-pose numbers): wet, snow, rays ≈ +0.3–0.6 ms each, mist
≈ +1.5 ms (dawn / fog only); no draw calls added (rays: one quarter-res post pass). `?quality=low` compiles the wet /
puddle / snow / frost surfaces out of every toon program and skips the rays pass (in software rendering the untaken
surface branch alone cost ~30% of the frame); mist banks stay.

## The night sky

The moon keeps its real phase and lays a shimmering path across the pond and river toward itself; on clear nights a
shooting star crosses now and then (`scene/sky/meteors.ts`), and on the real peak nights of the Perseids, Geminids and
Quadrantids they come every few seconds. The first one you see in a while gets a "make a wish" line.

## Dev

* `__valley.atmo({ wet, snow, frost, rainbow, mist, rays })` (0..1; wet/snow set the model trace, the rest force the
  scene), `atmo(null)` to follow the weather again, `atmo()` reads the eased state.
* `__atmo.bench(n)` = GPU ms per frame (timer query; A/B a moment on and off).
* `__valley.meteor()` launches a shooting star where the camera looks.
* `__valley.setWeather(kind | null, intensity?)`, `setSeason(s | null)`, `setHour(h | null)`; URL `?weather=`,
  `?season=`, `?hour=`.

```sh
npm run shoot -- --shot "name=wet,pose=hub,hour=16,weather=clear,eval=__valley.atmo({wet:1})"        # puddles after rain, sun out
npm run shoot -- --shot "name=rb,hour=16.5,weather=cloudy,cam=0;3;10;-1.3;0.2,eval=__valley.atmo({wet:0.9,rainbow:1})"  # rainbow
npm run shoot -- --shot "name=mist,hour=7,weather=clear,cam=0;22;70;0;-0.22,eval=__valley.atmo({mist:1})"   # dawn mist on the river
npm run shoot -- --shot "name=gr,hour=16.8,weather=cloudy,cam=0;3;10;1.87;0.3"                          # god rays (face the sun)
npm run shoot -- --shot "name=sn,pose=hub,hour=10,weather=snow,season=winter"                             # lying snow builds
npm run bench -- --scenario mixed --cond snow --pose hub,farmhouse   # snow on the real GPU (≈ +0.3 ms over a clear day; flakes
                                                                     # within 1.5 m of the eye are collapsed, not overdrawn)
npm run shoot -- --shot "name=fr,cam=0;2.2;14;0;-0.35,hour=7.6,weather=clear,eval=__valley.atmo({frost:1})"  # frost sparkle
npm run bench -- --quality low --eval "__valley.atmo({mist:1})"  # A/B a setting on the real GPU (tools.md → Benchmark)
```
