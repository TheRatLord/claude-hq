# The farmhouse interior

A walk-in room inside the farmhouse: hearth, the Almanac desk, the Collections shelf and fish tank, a CRT terminal
desk, with the real valley seen through the windows. Interior package.

Key sources: `scene/interior/` (system `interior`, service `indoors` = `IndoorSpace`: `interior.ts`, `layout.ts`
(pure + `interior.test.ts`: room box, windows, furniture anchors, colliders, viewpoints, `INSIDE_VIEWS`), `room.ts`,
`pieces.ts`, `view.ts`, `assets.ts`), `audio/` (`AudioService.indoors(k)`). Paths are relative to
`renderer/src/farm/`.

## Going in

E on the front door ("Go inside") fades (real-time, works at timescale 0) into one warm room built in place in the
farmhouse's own frame. Leaving: E on the door (back to the porch) or any travel out of the room.

## The room

* A stone hearth with an instanced fire + flickering `LightEmitter` (E stokes it).
* The Valley Almanac open on a desk (E → Almanac panel, live page drawn on a canvas; [almanac.md](almanac.md)).
* The Collections shelf (every forage/junk find fills its slot, unfound slots wear a "?" tag; E → Collections book;
  [pastimes.md](pastimes.md)) with the biggest catch mounted over the mantel, a fish tank swimming every species
  caught (one merged mesh, vertex-shader swim).
* A CRT terminal desk (phosphor list of farmers, amber blink when one needs you; E → roster).
* Bed (E naps: time skips in demo, a cozy line live), Mochi's cat bed, grandfather clock on the real time (ticks),
  bookshelf, plants, rug, armchair.

## Windows, light and sound

* While inside the outdoor scene is hidden; the windows show the real valley: each view (front, east) is captured to
  an HDR target + depth from just outside and re-projected on backdrops (refreshed when night/wet/sun angle drift, max
  one per 1.5 s), with rain running down the glass.
* The existing shadow-casting sun throws real patches through the window holes plus soft additive shafts by day; lamps
  and the hearth carry the night; the farmhouse windows keep glowing outward.
* Audio: outdoor ambience goes through a low-pass/duck (`AudioService.indoors(k)`), music and the new `roof` rain loop
  stay dry ([audio.md](audio.md)).
* Controller, pick and sky read the service (room floor/colliders, only `interior:*` interactables, warmer dimmer
  hemi).

## Budget

~24 draw calls inside **including post** (budget ≤ 40, only while inside), ~0.15 ms system time; outside it is not in
the scene (one `active` check per frame).

## Dev

URL / shot `pose=inside[:view]` (views: door room hearth shelf desk bed tank window sun), `__valley.inside(view | false)`
(instant; `false` leaves); gallery `farmhouse-interior` (cutaway/closed).

```sh
npm run shoot -- --shot name=i,pose=inside,hour=10          # farmhouse interior (inside:door|room|hearth|shelf|desk|bed|tank|window|sun)
npm run shoot -- --shot "name=ir,pose=inside:hearth,hour=21,weather=rain,eval=__valley.collect(28)"  # night, rain on the glass, full shelf
```
