# Lore: the farm metaphor

How agent state becomes farm life: fields, farmers, ducklings, jobs, the traces work leaves and what idle farmers do.
Use it in copy, signs, letters and tooltips.

Key sources: `model/jobs.ts`, `model/valley.ts`, `model/types.ts`, `scene/farmers/` (`brain.ts`, `traces.ts`,
`idle.ts`, `labels.ts`), `scene/plots/`, `scene/structures/` (`nooks.ts`, `countryside.ts`, `landmarks.ts`),
`world/map.ts` (`NOOKS`). Paths are relative to `renderer/src/farm/`.

## Fields, farmers, helpers

* **Workspace = field.** Opening a herdr workspace tills a new field on a free plot site: the soil turns, fence posts
  drop in, a sign with the workspace name pops up, seedlings sprout (`tilling`). While agents work it grows lush
  (`thriving` → `growing`); left alone for an hour it goes golden and sleepy (`resting`). Closing the workspace brings
  the harvest cart (`harvest`); the soil then rests `fallow` with a little "Fallow — resting" sign until the slot is
  reclaimed; after that the site returns to wild meadow.
* **Agent = farmer.** Each agent pane is a farmer who works its workspace's field. Farmers are 3D voxel versions of
  the agents' mascots: Claude agents are **Clawd** (Claude Code's orange 8-bit crab: block body, two eye notches, arm
  nubs, four stubby legs); Codex agents are a voxel **Codex cloud** (scalloped blob with a `>_` prompt face). A tiny tier
  hat and a workspace-colour neckerchief are the only farm dressing; the mascot silhouette is sacred. Shell panes are
  **scarecrows** (helpers) whose lantern is lit while a process runs; a green/red ribbon shows the last exit.
* **Subagents = ducklings** that waddle in a line behind their farmer and go home (to the pond) when done.

## States and events

* **Needs you (blocked)** = the farmer runs to the gate, hops, waves both arms, a big bouncing golden **!** above them,
  a letter lands in the mailbox, the farmhouse bell rings once.
* **Done** = proud, basket of produce, a gentle ✓ sparkle; waves when you pass.
* **Commit** = carries a crate to the shipping bin by the farmhouse. **Tests pass** = little celebration.
  **Test fail / error** = drops the watering can, "oops" puff, dusts off.
* **Struggle** = sweat drops, crows circling the field, head scratching.

## Jobs = what you see the farmer doing

`model/jobs.ts` `clsJob`, smoothed; `FarmerView.tool` = the tool flavour inside the visible job, `stickyTool`, held
≥ 8 s by the brain so churn never flickers; `scene/farmers/brain.ts` `workAct`.

* Edit/write: trowel and hoe in the rows (feed / brush in animal pens).
* Read: magnifier over the crop, then the seed almanac.
* **Search**: rummages in a burlap seed sack and flings handfuls over the shoulder.
* Test: the watering can along the row.
* Bash / build: hammer and saw.
* Git: a crate to the shipping bin.
* **Web / net fetch**: a carrier pigeon flies in to the raised nub with a letter, perches, flies off, then the farmer
  reads the letter (MCP and the rest still walk to the mailbox / well).
* Think: on the hay bale with a notebook under a thought cloud of turning cogs (a checklist cloud for todo), a light
  bulb now and then.
* Subagents: whistling to the ducklings. Compact: stretch and sweep.

The nameplate verb follows the flavour (rummaging, pigeon post, pondering). Props grow a little with distance
(≈ +60 % at 45 m) so tools read across the valley.

## Work leaves traces in the field

`scene/farmers/traces.ts`, 2 instanced draws. At each farmer's work spot a row of **seed stakes** (one per file planted
since the valley loaded, banked across tasks, max 6) on its right, and a row of **sprouts** on its left, one per test
run / error: green and perky for a pass, wilted brown for a fail (newest 6). A busy field bristles; a quiet one is
bare. Gallery `field-traces`; dev `__valley.ctx.services.get('farmers').react(id, 'celebrate' | 'oops')`.

## Fields read at a glance (plots package, `scene/plots/`)

* *Farmers stay visible in tall crops:* wheat leaves a **tramline** from each back-row work spot to the headland
  (`cropLayout(…, lanes)`), and the crop shader **parts** round whoever stands in it (`uPart`: per-field world points
  for the field's farmers, fed ~7×/s from the `farmers` locator, plus the player; stalks within ~1.7 m duck to ~40 %
  and lean away; `PartDef.part` opts a crop in, wheat only).
* *Lifecycle:* harvested annuals leave dry **stubble** in the fallow soil (`PartDef.stubble`: wheat straw, withered
  vines, cabbage stumps, sunflower stalks) while **perennials** (`PartDef.perennial`: orchard trees, vines, berry
  bushes) stay put and only their fruit flies to the cart.
* *Seasons:* spring fruit sets small and green; winter wheat is short green shoots in the snow, pumpkin vines die back
  to a brown mat on straw with a few pumpkins left to cure, sunflowers stand as dry stalks with hanging seed heads;
  seedlings start larger so a new field shows its kind from across the valley.
* *Small life:* **crows** settle on the back-fence posts while a farmer struggles (struggle + 1 of them; circling as
  before at ≥ 2), one when the field rests, and three glean the fallow stubble; they flush when you come close and
  drift back.
* *Personality:* burlap **yield sacks** fill the front-right corner (one per log step of lines changed in the workspace
  since the valley loaded, banked across tasks from `FarmerView.work`, 6 at ~1000).
* *The sign knows the branch:* a field in a git repo paints `on <branch>` under its name, and reading the sign tells
  its weeds (changed files) and the crates waiting to ship (unpushed commits). A farmer's water can running low is the
  context window filling: the nameplate grows a gauge from 65 % (red near compaction). Copy and derivations:
  [signals.md](signals.md).

## Idle = leisure

An idle farmer (no job for 4 s) picks a seat weighted by its `likes`, the hour and distance, and runs a varied
activity loop there (`scene/farmers/idle.ts`, pure + `idle.test.ts`): fishing casts, reels and sometimes lands a catch;
fireside toasting and chatting; reading on a bench; checkers turns with a partner.

* Four purpose-built **leisure nooks** (`scene/structures/nooks.ts`, `NOOKS` in `world/map.ts`): the **Pergola**
  (checkers table, spectators' bench, hanging lantern) north-east of the farmhouse, the **Picnic spot** (gingham
  blanket, parasol, firefly jar) south of the square, **Stargazers' knoll** (octagonal deck, telescope, benches;
  favoured at night) by the windmill, and the **Hot spring** foot-bath (steam, stone lanterns, rubber duck) on the
  river meadow behind the barn.
* Four **countryside nooks** out by the rim (`scene/structures/countryside.ts`), each at the end of its own footpath,
  give strolls somewhere to go: the **Orchard & apiary** (seasonal fruit trees, beehives with bees on fine days, a honey
  honesty stand) to the north-east, the **Standing stones** on the north knoll (runes glow cyan after dark), the
  **Hay meadow** (round bales, a hay wagon; away farmers doze against the bales) to the south-west, and the
  **Swing tree** on the east edge (a rope swing in the wind; E pushes it). Fern's rounds pass the stones and the orchard.
* Restless or chatty farmers sometimes leave their seat for an outing: a stroll to a view, the mailbox, their own
  field, visiting a friend, or petting the village dog/cat (service `pets`) or one of their field's animals
  (`plots.petAnimal`).

Seat changes are checked by the placement audit's `--sitters` pass ([tools.md](tools.md#placement-audit-npm-run-auditplacement)).

## System stats live in the landmarks

Windmill blade speed = CPU; water tower gauge/level = RAM; silo fill window = disk; farmhouse chimney smoke = disk IO;
carrier pigeons between the farmhouse loft and the valley = network; a big thermometer on the barn = temperature; the
greenhouse-glow / barn lantern = GPU. Each has a readable in-world plaque (canvas texture) when you walk up (E to read
exact numbers). Hazel the miller also reads them out ([friends.md](friends.md)).
