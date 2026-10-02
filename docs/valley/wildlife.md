# Wild visitors and the field guide

Shy, larger wildlife that rewards being in the right place at the right time, and the field-guide section of the
Collections book that records sightings. Life & sound package.

Key sources: `scene/life/wildlife.ts` (system, service `wildlife`), `scene/life/wild.ts` (rhythm + shyness, pure,
`wild.test.ts`), `scene/life/wildModels.ts` (sculpted models), `scene/life/wildAnim.ts` (motion),
`scene/life/wildAssets.ts` (gallery), `scene/life/gait.ts`, `model/collection.ts` (`SIGHTINGS`). Ambient critters
(birds, butterflies, fireflies, fish, frogs, the village dog Biscuit and cat Mochi: service `pets`) live alongside in
`scene/life/`. Paths are relative to `renderer/src/farm/`.

## The visitors

* A **roe doe and her fawn** graze the meadow in front of the woods near the rim at dawn and dusk (IK'd walk / gallop on
  `gait.ts`, feet on the slope, white tail flagged as they bound off).
* A **red fox** trots the hedgerows round one field after dark, stops to sniff and listen, yips.
* A **grey heron** stands in the river shallows mornings and late afternoons, wades and stabs for fish (splash,
  sometimes a catch), and lifts off in slow deep beats to land further down the river.
* A **tawny owl** sits on a standing stone (or a hay bale) at night, turns its head right round to keep you in view,
  blinks slowly, hoots, flits stone to stone.
* A **hedgehog** snuffles under the orchard trees on mild evenings (not winter) and curls into a ball when you come
  close.
* **Greylag geese** go over in a long V, honking, mornings and evenings (south in autumn, home in spring).

Which spot, whether today has a visit (a small skip chance) and arrival times wander per date (`wildDay`, seeded). Eyes
catch the lamplight after dark (one additive glint draw).

## Shyness (`Shy`)

A walking player is noticed at the species' `notice` range (a still one only close, a sprinting one from further);
while it watches you (alert pose: head up, ears pricked, tail up) its nerves rise as you keep coming and settle when
you stand still, so the way in is a few steps, stop, wait for the head to go down; sprinting at it or getting inside
`flee` sends it off (deer bound, fox streaks, heron/owl fly, hedgehog curls; a third fright and the heron/owl leave for
the window).

## Field guide

A good look (in range, in view ~0.8 s, not fleeing) records a sighting once a day in the Collections book's *Field
guide* section (`model/collection.ts` `SIGHTINGS`, `sight(id)` / `onSight`, data `seen` — never a find, never in the
basket); silhouettes show where / when and a tip until seen; a first sighting toasts and is a `found` harvest
([almanac.md](almanac.md)). The map's *Wildlife* layer shows habitats and who is out now ([map.md](map.md)).

## Budget and sound

One instanced draw per species + 1 eyeshine (≤ 7, only while something is out); life total stays ≤ ~23 with
everything about. Sounds: `honk`, `yip`, `snort` critter voices (plus `hoot`, `caw`, `flap`).

## Dev

`__valley.wildlife()` lists, `wildlife('deer')` brings one out at its habitat and stands you in view (it ignores you
for 12 s), `wildlife('owl', 'here')` in front of the camera, `wildlife('deer', 'spook')` startles it (ids: deer fox
heron owl hedgehog geese); service `wildlife`. Gallery: `deer` (graze walk alert bound fawn lie), `fox` (trot walk
sniff alert run), `heron` (stand hunt wade fly takeoff), `owl` (perch watch hoot fly), `hedgehog` (snuffle walk curl),
`goose` (fly glide).

```sh
npm run shoot -- --shot "name=w,hour=7,weather=clear,eval=__valley.wildlife('deer')"       # a wild visitor at its habitat (fox owl: hour=22; heron hour=9)
npm run shoot -- --shot "name=wf,hour=9,weather=clear,hud=0,wait=500,eval=__valley.wildlife('heron');setTimeout(()=>__valley.wildlife('heron','spook'),1500),frames=12,every=200"  # take-off
npm run shoot -- --shot "name=g,hour=8,weather=clear,pose=hub,eval=__valley.wildlife('geese'),wait=5000"   # a skein going over
```
