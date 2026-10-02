# The summit trail and the valley viewer

The valley is not a bowl you can't leave: a hiking trail climbs the terraced south wall to a lookout on the rim, with
a coin-op viewer that zooms onto farmers down in the valley. Trail package.

Key sources: `world/trail.ts` (route + cut, pure, `trail.test.ts`; fed `padHeight` by `world/map.ts`), `scene/trail/`
(system `trail`, service `trail`: `trail.ts`, `build.ts`, `decks.ts`, `assets.ts`), `world/map.ts` (`TRAILS`, `POIS`),
`browser-tests/trail.spec.ts`. Paths are relative to `renderer/src/farm/` unless rooted.

## The route

* A meadow footpath leaves the south road between fields 9 and 10 to the **trailhead** (signpost: length and climb, a
  lantern, a bin of walking sticks; E reads it), then four legs switchback up the strata: each leg follows the contour
  of one riser (half cut into the face, half built out), each hairpin crosses the shelf above it as a little level
  landing.
* The tread is cut into `heightAt` itself (`carveTrail`: a 2.1 m flat core blended into the slope with pad-style
  weights, so two legs of a hairpin keep their own level treads), so the terrain mesh, scatter, forage, `clearance()`
  (the trail and its landings are reserved) and the player agree; `pathAt` paints it as dirt (and footsteps crunch).
* Max grade ≈ 0.45 (the controller climbs to ≈ 1.4); **log steps** bed across the steeper legs, **rope railings** run
  along the outer edge wherever it drops more than ~1.4 m, **cairns** mark the hairpins and the saddle, the **halfway
  bench** sits on the second hairpin (E: rest).
* From the saddle between two knobs a **wooden staircase** (0.24 m risers) climbs the east knob and a **rope bridge**
  (sagging plank deck on cables, hand ropes) crosses back over the saddle, 7 m up, to the summit knob: both are
  `walkSurface`s the trail system publishes by wrapping the structures' function (a deck more than 0.6 m above you is
  not your floor, so you can walk under the bridge), and the controller treats a reachable deck as walkable whatever
  is under it.

## The summit lookout

≈ 40 m above the trailhead, 44 m above the square's level: a deck with a railing on the valley side, a bench facing
north over the whole valley to the waterfall and the far ranges, a lantern (a real `LightEmitter`), a Claude-orange
swallow-tail flag that streams with the wind, a windswept pine and the **summit cairn** (E: leave a stone, once a real
day; the count is kept per browser profile in `claude-valley.summit.v1` and the pile grows, one InstancedMesh).

## The valley viewer

A teal coin-op binocular viewer ("free for valley folk"): E zooms the camera onto a farmer down in the valley, framed
≈ 5 m wide, through a binocular mask, with their tag and what they're doing (`needs you: …` first); ← / → cycle
farmers (needs-you first, then working, then the rest), ↑ / ↓ zoom, the mouse nudges the view; E, Esc, any walking
key or a panel steps back. The view steers the player's own yaw / pitch (lights, culling and labels see the real view)
and looks from the viewer's eyepieces, leaning out past the rail.

## Map data and budget

Map data: `TRAILS` (polyline, for the map, drawn as red dots) and `POIS` (trailhead, halfway bench, rope bridge, summit)
in `world/map.ts` ([map.md](map.md)). Budget: 6 draws when in view (1 baked solid + 1 glow, the sign, the viewer
head, the flag, the offered stones; +1 mask while viewing), ~0.02 ms a frame.

## Dev

Poses `trailhead trail bridge summit`; `__valley.ctx.services.get('trail')`: `view(i)` (stand at the viewer and look at
farmer i), `leave()`, `target()`, `stones()`, `route()`, `hike({ from?, sprint? })` (walks the whole route holding W,
resolves `{ done, at, of, x, y, z, secs }`: a regression check for walkability; `browser-tests/trail.spec.ts` covers
the viewer); gallery assets `summit-lookout`, `rope-bridge`,
`trail-stairs`, `trailhead`, `trail-cairn`, `windswept-pine`.

```sh
npm run shoot -- --shot name=s,pose=summit,hour=18.6         # the summit lookout at dusk (poses trailhead trail bridge summit)
npm run shoot -- --shot "name=v,pose=summit,hour=10,eval=__valley.ctx.services.get('trail').view(0),wait=2500"   # the valley viewer on farmer 0
npm run shoot -- --shot "name=h,pose=trailhead,eval=__valley.ctx.services.get('trail').hike().then(r=>window.__h=r),wait=40000,log=JSON.stringify(window.__h)"  # hike it: done=true
```
