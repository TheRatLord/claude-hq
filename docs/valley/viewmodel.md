# The viewmodel: your own paws

You are a little Clawd-ish valley creature in a cosy jumper: two soft orange mitten-paws (stubby thumb, three toe
scallops, pink toe beans underneath) in a sage knitted sleeve with a cream ribbed cuff and a mustard stripe. They
hold what you are doing and gesture when you do things, so every interaction feels like *you* did it. System
`viewmodel`, service `hands` (`HandsPort`, `scene/context.ts`).

Key sources: `scene/viewmodel/logic.ts` (pure brain, tested by `logic.test.ts`), `viewmodel.ts` (the system: poses,
motion, drawing, the lantern light), `models.ts` (paws + items, built lazily per side / pose / item and cached).
Hooks elsewhere: `scene/forage/forage.ts` (the rod), `scene/interior/barn.ts` (chores), `scene/seasons/boat.ts` (oar
grips), `scene/seasons/snow.ts` (rolling a snowball), `hud/hud.ts` (use / alt → gesture, the wave and lantern keys),
`hud/pause.ts` + `model/prefs.ts` (settings, keys), `main.ts` (`ctx.comfort.hands` / `headBob`). Paths are relative
to `renderer/src/farm/`.

## Drawing (≤ 4 draws, 0 shadow-pass draws)

* The paws are ordinary meshes in the main scene, so the sun and sky, the time-of-day grade, lamp pools, the barn's
  lanterns and indoor light all reach them like everything else. Their vertex shader (`patch` in `viewmodel.ts`, a
  `chainShader` on the toon material) projects with the viewmodel's **own field of view** (`VM_FOV` 50°, unaffected by
  Settings → FOV, the summit viewer's zoom or photo zoom) and **squeezes their depth** into the first ~0.3 m in front of
  the main camera (`vmDepth`): they never clip into a wall, a manger or a farmer, and the post pass still inks them.
* They draw last (transparent list, `NoBlending`, `renderOrder` 1000: opaque, and over the summit viewer's mask). No
  cast or received shadows (their real position is often inside the thing you stand at); no wet sheen / snow
  (`#undef VW_TOON`: it washed them out).
* **Fill** (`vmFill`, albedo-tinted emissive): the held lantern's warm glow (stronger the darker it is) plus a little
  cool ambient after dusk. The toon ramp's facing term left the paw's top and the sleeve black at night (the lantern
  hangs below them); the fill keeps them reading as lit by it. The sleeve slims and bends down past the cuff so a
  reach (grab, pat, the raised lantern) doesn't fill the view with forearm.
* Draws: left paw + its item, right paw + its item, the lantern's glass (unlit, `warmEmitter`). A swinging or flying
  part (lantern, basket, the flipped coin) is the same draw: vertices with `aPart = 1` move by the paw's `vmPart` matrix.
* Where the paws meet the world they are **FOV-matched**: a camera-space point is scaled by
  `tan(fov/2) / tan(VM_FOV/2)` so the world shows it on the same pixel (`toWorldMatched`): the rod tip the fishing line
  leaves from, the oar grips the boat reports, the lantern's light.
* Cost: ~0.02–0.04 ms a frame; zero per-frame allocation (scratch matrices / poses, `PAWS` array, geometries cached).

## What they hold (the brain, `logic.ts`)

`resolveHands(input, out)`: hidden in photo mode (service `photo` / fly cam), in menus (`player.frozen`) and when
Settings → Interface → **Show hands** is off. Two-handed modes take both paws (and put the lantern away), by priority:
**telescope** (the summit viewer: paws on its handles) › **oars** (rowing: fists on the grips) › **push** (rolling a
snowball) › **carry** (moving yard decor) › **skate** (arms swing with the strides; paws stay free). Otherwise right
paw: **rod** (fishing) › barn chore (**hay** cradled palm-up, **grain** scoop, curry **brush**); left paw: the
**lantern** › the **basket** (a few seconds after a find goes in; on the right when the lantern has the left).

Owners claim per frame (a claim not renewed lapses in 2 frames): `rod(swing, tip)` (forage: hides its own rod while
the paws show, the line starts at `tip`), `carry('hay' | 'grain' | 'brush' | 'snowball' | 'decor')` (barn hides its
carried mesh when this returns true), `oars(l, r)`. The rest is read: `trail.viewing`, `rowboat.aboard` +
`controller.riding` (skating = riding, not rowing), `yard.carrying()`, `wallet.onChange('stash')` for the basket.

**The lantern** is a real `LightEmitter` (warm, radius 7.5 m, flicker) where it shows on screen, so you walk in a pool
of light. Automatic: lit after dusk outdoors (`lanternLit`); the lantern key flips it (`toggleLantern`) and a manual
choice lasts until the next dusk or dawn (`settleLantern`).

## Gestures

One at a time with a queue of one (`requestGesture` / `stepGesture`); a storm shield cuts in; cooldowns stop repeats;
dropped when no paw is free (`gestureSide`; shield / cheer use both paws when both are free).

| gesture | when |
|---|---|
| grab (reach, close, pull back) | use: pick up, collect, take, scoop, feed, milk, gift |
| pat (three pats) | use: pet / brush, any animal |
| wave | the wave key; talking to a villager (a focused villager / farmer chirps back) |
| cheer (thumbs-up, the other paw waves) | a farmer within ~16 m in front of you celebrates or finishes |
| shield (paws up, a little shiver) | a lightning flash outdoors |
| coin (flick, the coin arcs away spinning) | the fountain's "Toss a coin into" |
| poke (a quick boop) | any other prop / structure use (ring, push, …); nothing for reading, looking, farmer cards |

`gestureFor(kind, verb)` maps an interactable to its gesture; the HUD calls `hands.used(focused)` on use / alt.

## Motion

All on top of the eased pose: idle breathing, a walk bob phase-locked to the controller's footsteps (`onStep` snaps the
phase to the step), an arm pump while sprinting (empty paws rise into view to pump), a spring dip on landing, inertia
when you turn or look up / down, a jump lift, and a pendulum for the hanging lantern / basket (hangs plumb with your
pitch, kicked by turns and steps). Settings → **Head bob** off removes the bob; **reduced motion** keeps a quarter of
it and a third of the sway / inertia / dip. A paw that changes what it holds drops out of view, swaps, and rises again
(empty-paw shapes swap at once).

## Settings and keys

Settings → Interface → *Show hands* (`prefs.hands`, default on). Rebindable (Settings → Controls): **Wave** (Z),
**Lantern** (T). The photo album holds L.

## Dev and shots

`__valley.service('hands').dev(cmd?)`: `'wave' | 'grab' | 'pat' | 'cheer' | 'shield' | 'coin' | 'poke'` plays one,
`'lantern'` toggles, `'basket'` shows it; returns the state. Claims can be faked from `eval` with an interval.

```sh
npm run shoot -- --shot name=n,pose=hub,hour=22,hud=0                                          # the lantern's pool at night
npm run shoot -- --shot "name=w,pose=hub,hour=21.5,hud=0,eval=setTimeout(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'})),1500),wait=2500,frames=8,every=110"  # walk bob + swing
npm run shoot -- --shot "name=g,pose=hub,hour=11,hud=0,eval=setInterval(()=>__valley.service('hands').dev('cheer'),1500),wait=900,frames=6,every=200"
npm run shoot -- --shot "name=f,pose=hub,hud=0,eval=__valley.fish('demo'),frames=6,every=500"     # the rod in the paw
npm run shoot -- --shot "name=b,pose=barn-inside:hens,hud=0,eval=setInterval(()=>__valley.service('hands').carry('grain'),16),wait=1800"
npm run shoot -- --shot "name=t,pose=summit,hud=0,eval=__valley.ctx.services.get('trail').view(0),wait=2800"
npm run shoot -- --shot "name=r,season=summer,hud=0,eval=__valley.boat('in');setTimeout(()=>__valley.boat('row',20),300),wait=2500,frames=6,every=180"
```
