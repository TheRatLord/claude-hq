# Your own pet

A puppy, kitten or (rare) fox kit of your own that follows you around the valley, greets the neighbours, finds
forageables, plays fetch and sleeps at home. Life & sound package.

Key sources (relative to `renderer/src/farm/`): `model/pet.ts` (pure model: species, prices, names, happiness;
`pet.test.ts`), `scene/life/companion.ts` (system part of `life`, service `companion`), `scene/life/follow.ts` (pure
follow helpers, `follow.test.ts`), `scene/life/companionModels.ts` (bodies and coats on the village pets' rig
`petBody.ts` / `petModels.ts`, the stick, the foundlings' basket), `scene/life/companionAssets.ts` (gallery),
`hud/pet.ts` + `pet.css` (panel `pet`: adoption card / pet card). Biscuit and Mochi (service `pets`) are unchanged:
the rig only gained optional dims (`sitY`, `headTop`, `tailLift`, `tailCurl`, `tailBack`, `flopEars`) and a `point`
pose.

## Adoption

Until you have a pet, a wicker **basket of foundlings** (a sleeping puppy and kitten, a "free to good homes" slate)
sits in a clear patch by Fern's signpost. E opens the adoption card (`ui.pet()`): pick a species and a coat, type a name
or take a suggestion, Adopt.

| species | coats | gate |
|---|---|---|
| puppy | golden, beagle, cocoa, speckles | free at Fern ♥2, else a 60-bit kibble-fund fee (`wallet.spend`) |
| kitten | ginger, tuxedo, smoke, siamese | same |
| fox kit | red, arctic, silver | Fern ♥4 (locked card until then) |

Names go through `sanitizeName`: control / format / line-separator characters stripped, only letters, marks, digits,
space and `' ’ . -` kept, at most 14 characters, first letter capitalised; empty → a suggested name. Rename from the
pet card (E on your pet → card, or `__hud.open('pet')`).

## Behaviour (`companion.ts`)

* **Follow**: `heelSpot` is a little behind and to one side while you walk, round in front (1.85 m) when you stop;
  `followSpeed` matches your pace, closes gaps and sprints when you sprint. When the straight line is blocked (dry +
  ledge test every 0.45 m, colliders every ~0.9 m) it works along your footstep trail (`Crumbs`, `trailWaypoint`,
  ≤ 6 line tests, replanned every 0.3 s or when the goal moves). It knows the porch steps and the yard's west gap.
  Lost (> 45 m, or stuck 3 s) it catches up out of sight.
* **Stopped**: sits and looks up (head tilt; a kitten slow-blinks when you look at it), lies down after a while,
  wanders off to sniff now and then.
* **Out and about**: greets villagers (sits, looks up) and Biscuit / Mochi (nose to nose); finds today's forageables
  (`forage` debug `near`), runs over and points (a kitten sits and meows), barks a speech line.
* **E: pet** (hearts, a lean; three quick pats and a puppy rolls over for a belly rub). **F: Fetch!** throws a stick
  along your view (never into water or through a wall); it races off, carries it back in its mouth and drops it at your
  feet. A kitten sometimes pounces and sits on it instead (alt verb "Play!").
* **Night** (21:30–6, within 20 m of home): goes to bed: the yard pet bed if placed, else the porch by the door; it
  trots home when the bed is far and ambles the last few metres. Sleeps until morning (F "Wake up" for the night).
* **Indoors**: lies (kitten: loafs; curls at night) on the hearth rug, fireside of the armchair. Outdoor objects with
  `userData.indoors === true` stay visible in the room (`interior.ts` `keep()`).

## Happiness (`model/pet.ts`)

Starts at 50, floor 10, 0–100; hearts = ⌊happy / 20⌋. Daily-capped gains (`GAINS`): pat +4 ×3, walk +1 per 100 m ×10,
fetch +3 ×5, find +4 ×3. On a new day: −5 if it wasn't patted yesterday, −8 per further day away. `moodOf` labels it.
Persisted in localStorage `claude-valley.pet.v1` (walk distance saved every 25 m).

## Budget

≤ +3 draw calls: the pet (one skinned mesh, real shadow), the stick (only while fetching / just dropped), the basket
(only before adopting). No per-frame allocation. CPU ≈ 0.06–0.25 ms a frame (`__valley.pet().ms`, an EMA).

## Dev and tests

```sh
__valley.pet()                         # state: {state, pose, x, z, name, species, happy, stick, gait, dist, ms}
__valley.pet('puppy', 'beagle', 'Pip') # adopt instantly (free, any species/coat), sat in front of you
__valley.pet('fetch' | 'pet' | 'home' | 'sniff' | 'find' | 'reset')
npm run shoot -- --shot "name=p,pose=hub,hour=10,eval=__valley.pet('fox','red','Ember');setTimeout(()=>__valley.pet('find'),400),wait=5000,log=__valley.pet()"
npm run shoot -- --shot "name=p,pose=hub,hour=21,eval=__valley.pet('kitten','smoke','Miso');setTimeout(()=>__valley.inside('hearth'),500),wait=3000"
```

Gallery: `puppy`, `kitten`, `fox-kit` (variants: a loop such as `walk`, `run`, `sit`, `point`, `fetch`; `sit:<coat>`;
`coats` shows every coat side by side), `foundlings`, `fetch-stick`.

Tests: `node --test renderer/src/farm/model/pet.test.ts renderer/src/farm/scene/life/follow.test.ts`;
browser `npm run build && npx playwright test browser-tests/pet.spec.ts --output test-results/pet` (adopt through the
card, follow, catch-up, fetch, pat, hearth, card).
