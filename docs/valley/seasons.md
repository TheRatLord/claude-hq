# Seasonal pastimes: the rowboat, skating, snowmen

Something to *do* in every season: row the little boat on the pond from spring to autumn (and fish from it), skate
on the frozen pond in winter, and build snowmen whenever snow is lying. System `seasons`.

Key sources: `scene/seasons/` (`seasons.ts` the system + service, `boat.ts`, `skate.ts`, `snow.ts`, `ice.ts`,
`models.ts`, `assets.ts`, `shared.ts`; pure rules in `physics.ts` + `snowman.ts`, tested in `seasons.test.ts`),
`player/controller.ts` (the `ride` hook), hooks in `scene/forage/forage.ts` + `model/collection.ts` (`rareBoost`),
`scene/life/companion.ts` (`petPerch`), `scene/terrain/shore.ts` (`shorePlaces`), `model/stamps.ts` (3 stamps),
`audio/sfx.ts` (`oar`, `skate`, `crunch`). Paths are relative to `renderer/src/farm/`.

## The rowboat (spring – autumn)

* Tied alongside the pond dock (its east side, near the end). **E: Climb into** puts you on the middle thwart facing
  the bow; the controller hands movement to the boat (`Controller.ride`). **W / S** row (both oars pull / back-water),
  **A / D** turn (one oar pulls, the other backs: a spin in place without W). The mouse still looks around; the view
  turns with the boat.
* Physics (`physics.ts` `stepBoat`, pure): each oar has a stroke phase (pull half = force, recovery = none), the
  difference between the two oars turns her, little drag along the keel and a lot across it (she carries on straight
  and drifts to a stop), a breath of wind drift. The hull outline is sampled against the pond's depth (≥ draft), the
  dock (a signed distance, so the depth gradient pushes her off its pilings) and land beyond the pond; contacts push
  out along the gradient with a soft restitution and a little spin, and the lily pads part around the hull and slow
  her. Bumps thunk (`step-wood`, low).
* Oars (one instanced draw) animate from the stroke phase (`oarPose`: sweep + lift, shipped along the gunwales at
  rest); each blade dip plays `oar` and drops a small ring. While she moves, wake rings spread from the stern (one
  additive instanced draw, only while any are alive), drawn over the water surface as their own mesh.
* **Fishing from the boat**: look at the water and E as usual (scene/forage). Service `rowboat.fishBoost(x, z)`
  multiplies the rare-fish odds (`FishConditions.rareBoost`): ×1 at the edges up to ×2.6 in the middle of the pond.
* **E: Step out onto Dock** when she's alongside (within ~2.6 m of the planks); she drifts back to her mooring.
* A lantern on the bow lights after dusk (glow mesh + a `lights` emitter). Your pet, if you have one, hops into the
  bow and rides along facing you (service `petPerch`, read by `companion.ts`), and hops out by you after.
* Winter: hauled up upside down on the south beach (a collider; "Look at" says to try the ice).
* "First row" stamp: 12 m rowed in one outing (`StampEvent 'row'`). Every metre rowed also goes into the book's
  lifetime `n.rowM` (`stamps.rowed(m)`, flushed ten metres at a time and on stepping out): Fern's notebook shows it on
  the rowboat page ("1.2 km rowed on the pond · 5 outings").

## Skating (winter, the pond frozen)

* `pondIce(season, trace, weather)`: frozen every winter unless a long rain has softened it (`trace.wet > 0.75` in
  rain). Freezing / thawing eases over ~2 s; a thaw clears the scratches.
* **The ice** (`ice.ts`, its own mesh + material over the water, so the water shader is untouched; one draw):
  glassy blue-green in the middle, milky toward the shore, trapped bubbles, long cracks, old skate arcs, a dusting of
  snow in drifts that follows `sky.trace.snow`, sky reflection at grazing angles and a hard sun glint; snowbanks
  drifted round the waterline (they grow with the lying snow); frost feathers on the dock planks. Your blades carve
  into a 256² scratch map over the pond (≈ 10 cm a texel, uploaded ≤ 5×/s): the ice keeps your drawing.
* **Walk out onto it** and you're skating (`skate.ts`, `stepSkate`): W pushes strides (each a `skate` hiss), A / D
  carve (the body and the view turn, faster the faster you go), S snowploughs to a stop (a spray of ice). Almost no
  friction (a dusting of snow adds a little); the blades grip across their length, so sideways slide turns into
  glide. The view dips with each push and leans into carves. At the edge: slow, you step off onto the shore; fast,
  you bounce off the snowbank (`crunch`).
* **Figure eight** (`trackLoops`): a lobe of ≥ 1.4π one way, then one the other way within 25 s, at speed. It inks
  "Figure eight" (`'eight'`).

## Snowmen (winter, lying snow ≥ 0.3)

* Look down at snowy ground: **E: Roll a snowball**. It sits in front of you and rolls as you walk, growing with
  distance (`grow`: slower as it gets heavy, max 0.78 m radius), scraping a greenish trail through the snow (one
  instanced draw, 180 marks). **E** again sets it down: on a snowman nearby if it's no bigger than the ball below
  (three tall), otherwise as a new base (≥ 0.26 m). Too big, too small, a full snowman and "three is plenty" each
  get a line.
* **E on a snowman** decorates it a piece at a time (`nextDecor`): eyes (two pinecones from your basket if you have
  one, else coal), a carrot nose, a scarf (red / blue / green), coal buttons, twig arms, a holly sprig from the basket
  or a little black hat. Three balls + eyes + nose = a snow friend: the "Snow friend" stamp (`'snowman'`).
* At most three snowmen. Persisted per profile for the day (`claude-valley.snowmen.v1`, tolerant `parseSnow`); a new
  day or ~10 s without lying snow melts them (`settle`). Each has a collider; decorations are one merged mesh rebuilt
  only on change.

## The controller's `ride` hook

`Controller.ride(rider, onEnd)` hands movement to a `Rider` (`ride(dt, input, out)`: read the move keys, write
`player.pos` / `speed` / `yaw`, fill `out.eye` / `roll`; return false to get off, with `out.vx/vz` carried on). A
teleport, `ride(null)` or the rider ending it runs `onEnd`. Photo mode's fly cam and modals still work while riding.

## Budget

Rowboat 3 draws (hull, lantern glass, oars) + 1 wake while moving; ice 1 (winter only); snow up to 3 (balls,
decorations, trail; winter only). No per-frame allocation (scratch vectors, ring buffers; decorations rebuild only on
change). Not done (cheap enough to add later): villagers / idle farmers skating.

## Dev and checks

* `__valley.boat()` state; `boat('in')` climb in at the mooring, `boat('row', secs)` / `'turn'` / `'spin'` rows by
  itself, `boat('middle')` out in the middle, `boat('out')` step out at the dock.
* `__valley.skate()` state; `skate('on')` onto the ice, `skate('glide', secs)`, `skate('eight')` skates a figure eight,
  `skate('off')`.
* `__valley.snowman()` state; `snowman('build', pieces?)` a whole snowman 2.6 m ahead, `snowman('roll', r?)`,
  `snowman('place')`, `snowman('reset')`.
* Poses `dock` (the dock and the moored boat from the pond's west shore) and `ice` (the pond's south-west shore).
* Gallery: `rowboat` (`rowing` / `shipped` / `winter`, param = stroke rate), `snowman` (`base two three face dressed
  pinecone`), `pond-ice` (param = snow).

```sh
npm run shoot -- --shot "name=boat,pose=dock,hour=10,season=summer"                                         # moored at the dock
npm run shoot -- --shot "name=row,pose=dock,hour=17,season=summer,eval=__valley.boat('in');__valley.boat('row',8),wait=5000"   # rowing out
npm run shoot -- --shot "name=lantern,pose=dock,hour=21.5,season=autumn,eval=__valley.boat('in');__valley.boat('middle')"      # bow lantern at night
npm run shoot -- --shot "name=ice,pose=ice,hour=11,season=winter,weather=snow,eval=__valley.atmo({snow:1})"   # the frozen pond
npm run shoot -- --shot "name=eight,pose=ice,hour=11,season=winter,eval=__valley.atmo({snow:0.6});__valley.skate('eight'),wait=14000"
npm run shoot -- --shot "name=sm,pose=hub,hour=11,season=winter,weather=snow,eval=__valley.atmo({snow:1});__valley.snowman('build')"
npm run shoot -- --shot "name=g,gallery=snowman,variant=dressed"
```

Tests: `node --test renderer/src/farm/scene/seasons/seasons.test.ts` (boat: rowing, turning, never aground, pads;
skating: push / glide / brake, carve, edge; figure eights; ice; fish boost; snowballs; snowmen rules and
persistence); browser flow `browser-tests/seasons.spec.ts` (`npm run build && npx playwright test
browser-tests/seasons.spec.ts --output test-results/seasons`).
