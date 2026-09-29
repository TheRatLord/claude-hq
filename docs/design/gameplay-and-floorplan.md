# Claude HQ: Gameplay & Floor Plan

> **Partly superseded by `docs/DESIGN.md` v2** (DESIGN wins). See DESIGN §12.2 for the exact rows: all geometry in §1.1–1.3
> and the bay order/"FOR LEASE" of §1.5 (→ DESIGN §7, a 42×28 m toy-scale plan with the Lab beside the Lobby), model hats
> (→ lanyard emblem), §3.1 blocked/done/idle timings (→ DESIGN §6.4), §3.2 station rule (→ §6.5), §3.3 Shelly table and
> §3.4 network capsules (→ §6.7, §7.4), §5 key bindings (→ §8.2), and §6's skyline InstancedMesh (→ §7.3 cards).
> Zone ideas, stats metaphors, the fun layer and the notification channels remain the design reference.

Owner: game/level design. Scope covers the floor plan, the herdr to world mapping, agent behaviour, diegetic stats, player verbs, the UI grouping views and milestones. Art style, the render pipeline and the server protocol live in sibling docs. Where they conflict, geometry numbers in this doc win, and so do data facts in `docs/architecture*`.

**Conventions.**
- Units are metres.
- **Plan coords** `(x, z)` have the origin at the NW outer corner. +x is east and +z is south, so ASCII rows run in the same direction as z.
- `y` is up.
- Three.js world = `(x − 24, y, z − 16)`, which centres the building on the origin. Camera forward at spawn is −z (north).
- Every number below is a default, and `layout.js` is the single source of truth for it.

## 0. Pillars (what "better than claude-office" means)

| # | Pillar | Test |
|---|---|---|
| P1 | **Readable at a glance.** State shows through location, pose, colour ring and icon, and each one is legible from 15 m. | A screenshot from spawn answers "who is blocked, working or done" with no HUD. |
| P2 | **One keypress from real work.** | Any terminal opens in ≤ 2 inputs from anywhere (`Tab`→row `Enter`, or `Ctrl+K` name `Enter`). |
| P3 | **Alive with 3 agents.** The user normally runs 2–5 agents across about 3 workspaces. | The office never looks abandoned. An NPC, a cat, ambient props and stats keep it moving. Empty bays read as charming "For Lease" storefronts. |
| P4 | **Varied space.** It has levels, a sunken pit, a mezzanine, a street, glass partitions and outside views. | Every zone has a distinct floor material and palette, a distinct ceiling height and one signature prop. |
| P5 | **Characters, not blobs.** Silhouette, eyes, squash and stretch, anticipation, overlap, emotes. | A walk cycle reads as "cute and bouncy" in a 2 s GIF. |
| P6 | **Honest.** Every animation maps to real herdr or transcript data, or is clearly ambient (the NPC and cat carry no nameplate). | Nothing implies a state that isn't true. |

Prior-art weak spots to avoid:
- A lobby-heavy box city with a flat Lambert look.
- Characters that read as orange cubes.
- Hex pods that read as clutter at a distance.
- Blocked agents queuing far from their workspace context with no trace left at the desk.
- Stats that were decorative but hard to read.

## 1. Floor plan

Footprint is 48 × 32 m, with a single ground level plus a **mezzanine** (y 3.6) over the library. It includes:
- a **sunken pit** (−0.6 m, 3 steps)
- a **raised-floor engine room** (+0.3 m)
- an indoor **studio street** with 4.5 m string-lit ceilings
- an 8 m **atrium** with a skylight

Walking speed is 3.6 m/s and sprint is 6.5 m/s. Spawn → far bay W1 is about 45 m (13 s walk, 7 s sprint). Spawn → observatory on the mezzanine is about 30 m (8 s).

### 1.1 ASCII map (2 chars = 1 m in x, 1 row = 1 m in z)

Legend:
- `I` / `=` exterior wall or glazing
- `|` `-` interior wall
- `:` storefront glass
- `!` glass partition
- `~` library arches under the mezzanine edge
- `/` stairs
- `@` slide
- `.:o` pit steps (y −0.2 / −0.4 / −0.6)
- `#` rack wall
- gaps are doorways

```
     0                   1                   2                   3                   4                
     0   2   4   6   8   0   2   4   6   8   0   2   4   6   8   0   2   4   6   8   0   2   4   6   8
z00  ==================================  north glass: skyline  =======================================
z01  I           |       |           |                               |               |               I
z02  I W1        :       :E1         | LIBRARY (y0)  /  MEZZ y3.6    |               |               I
z03  I           : S     :           |                               |   LAB         |   ARCHIVE     I
z04  I           : T     :           | ROUND TABLE | OBSERVATORY     |               |               I
z05  I           | R     |           |                               |                               I
z06  I-----------+ E     +-----------+                               |                               I
z07  I           | E     |           |                               |               |               I
z08  I W2        : T     :E2         +LND~       ~~~~~~~~~       ~~~~+               |               I
z09  I           :       :           |///                            |               |               I
z10  I           :       :           |///                         @@ +---------------+     ----------I
z11  I           |       |           |///<stairs .....:.....       @ !                             |#I
z12  I-----------+       +-----------+///     ..::::ooooo::::.slide  !                            R|#I
z13  I           |       |           |///    .:::oo       oo:::.     !                             |#I
z14  I W3        :       :E3         |///   .::oo           oo::.    !                             |#I
z15  I           :       :           |///  ..:oo             oo:..           ENGINE ROOM +0.3      |#I
z16  I           :       :           |///  .::oo   BIG       oo::.                                 |#I
z17  I           |       |           |///  ..:oo   BOARD     oo:..   !     benches (shells)        |#I
z18  I-----------+       +-----------+///   .::oo           oo::.    !                             |#I
z19  I           |                           .:::oo       oo:::.     !                             |#I
z20  I W4        :        PLAZA               ..::::ooooo::::..      !                             |#I
z21  I           :                               .....:.....         |                               I
z22  I           :                                                    ----------------     ----------I
z23  I           |                         ^ THE PIT (sunken -0.6)                           NAP     I
z24  I-----------+       +-----------+                               |                               I
z25  I HALL ->                         ========                      |                               I
z26  I                                 HELPDESK            RAM               CAFE / ARCADE           I
z27  I--------   --------+----   ----+                     COL                                       I
z28  I                   |           |                                                               I
z29  I WAR ROOM          |MAIL       |                                       coffee  ping-pong       I
z30  I                   |           |         * SPAWN               |                               I
z31  I                   |           |                               |                               I
z32  ==================================== south glass: garden  =======================================
```

### 1.2 Zones

| Id | Zone | Rect (x0,z0→x1,z1) | Floor y / ceiling | Purpose (behaviour hook) | Signature props | Palette / material |
|---|---|---|---|---|---|---|
| LOB | **Lobby & Help Desk** | 16,24→32,32 | 0 / 4.0 | Spawn, blocked queue, arrivals and departures | Help Desk counter 17.5→21.5 @ z25.3 with brass **bell**; **alarm beacon** on a 1.6 m pole @ (21.3,25.2); RAM lava column @ (27.5,26.5); real wall clock over the inner entrance; fish tank @ (30,30.5); 4 m sliding glass entrance @ x22–26, z32 | light oak, cream plaster, brass |
| PIT | **The Pit** (sunken commons) | circle c(24.5,16), r 5.8 | 0 → −0.6 / 8.0 (atrium) | Done agents lounge and wait for you. Social hub, central sightline | **Big Board**: a 4-faced hanging display at y 4.2–6.2 over the centre; a curved sofa ring r 3.4–4.2 with gaps N and S; a "hearth" round LED table r 1.1 that glows in the rollup state colour; planters on the rim | warm rust rug, walnut, a skylight shaft |
| ATR | **Atrium** (walkway around the pit) | 16,8→32,24 minus pit | 0 / 8.0 | Circulation. Every major zone is visible from here | Skylight 8×8; 2 hanging planters; ceiling fans whose speed follows load average | polished concrete, terracotta inlay rings |
| STR | **Studio Street** | 6,0→10,24 | 0 / 4.5 | Workspace neighbourhood: bays open onto it like shopfronts | String lights; hanging **workspace banners** (one per occupied bay); a street lamp per bay whose glass shows the bay's rollup colour; a painted crosswalk at z24 | brick, wood-plank street, awnings |
| BAY | **Team bays** ×7: W1–W4 (x0→6), E1–E3 (x10→16), each 6 m in z | e.g. W1 0,0→6,6 | 0 / 3.2 | One workspace per bay: up to 6 desks and tab islands | Storefront glass + 3 m opening; **shop sign** with `#n label` in workspace colour; awning; tab rugs; a rollup neon in the window; empty bays have a "FOR LEASE" sign and sheet-draped desks | per-workspace accent on a neutral base |
| PLZ | **Plaza** | 10,18→16,24 | 0 / 4.5 | Street ↔ atrium junction; where `unknown` agents mill around | **Map signpost** (the one confused agents stare at); 2 **phone booths** (MCP tool calls); Lost & Found box; bench | cobble tile |
| HAL | **Hall** | 0,24→16,27 | 0 / 3.0 | Connects street, War Room and Mail to the lobby | Pneumatic mail tube running along the ceiling | carpet runner |
| WAR | **War Room** (planning) | 0,27→10,32 | 0 / 3.0 | TodoWrite, plan mode, long thinking | 2 whiteboards that render the agent's **real todo list**; sticky notes; a projector | cork, whiteboard white, cool light |
| MAIL | **Mailroom** | 10,27→16,32 | 0 / 3.0 | `git commit` / `git push` moments | Outgoing tray; pneumatic tube inlet; a pigeonhole wall with a slot per workspace | kraft brown, green metal |
| LIB | **Library** (under the mezzanine) | 16,0→32,8 | 0 / 3.4 | Read / Grep / Glob / LS | 5 tall shelf rows perpendicular to the north glass; a rolling ladder; 4 reading armchairs by the window; a card catalogue | deep green, brass, warm lamps |
| MEZ | **Mezzanine** | 16,0→32,8 + landing 16,8→18,9 | 3.6 / 3.2 | Round Table (Task and subagents) at x16–24; Observatory (WebSearch/WebFetch) at x24–32; overflow hot desks along the balcony rail at z7.5 | Glass balcony rail at z8 overlooking the pit; a telescope pointed out the north clerestory; a **radio mast** that pierces the roof (visible outside); the slide mouth @ (30.5,8.5) | navy, star-map ceiling |
| LAB | **Lab** | 32,0→40,10 | 0 / 3.6 | Bash tests, builds, lint | 2 benches with beakers and bubbling flasks; a fume hood; a big **TEST light** (green, red or amber); a safety shower (plays on test-fail) | white tile, teal, lab glass |
| ARC | **Archive** | 40,0→48,10 | 0 / 3.6 | Disk stats. Quiet chill spot | Vault door; a **filing-drawer wall** (disk fill); nvme thermometer; a microfiche reader | steel grey, amber labels |
| ENG | **Engine Room / Workshop** | 32,10→48,22 | **+0.3** (raised tiles) / 3.4 | Shell robots; CPU, GPU, temps, network, uptime | **Rack wall** at x47.5, z11–21 with 16 core columns; 2 rows of 4 **shell workbenches** at z13 and z18, x35–44; **hamster wheel** for GPU @ (44.5,11.5); "DAYS SINCE REBOOT" sign; boiler **pressure gauge** for CPU total, mounted on the glass at (32,13,y3) facing the pit | dark steel, perforated tiles, LED glow |
| CAF | **Café & Arcade** | 32,22→48,32 | 0 / 3.2 | Idle behaviours, coffee, games | Espresso bar along x47, z24–31 (steam); 4 bistro tables; ping-pong @ (38,29); arcade cabinet for GPU/VRAM @ (34,23); foosball @ (41,25); **Nap Nook**, 3 bunk pods at x44–48, z22–25 | terracotta tile, cream, mint |
| OUT | **Outside** (not walkable) | around the footprint | — | Views: skyline to the north, park and garden with a pond to the south, a canal to the west | Procedural instanced skyline (3 rings at 40/80/140 m); trees; the sun and moon follow the real clock | sky gradient dome |

**Doors** are 2 m wide unless noted. `x=` marks a wall position.
- STR↔HAL: z24, x6–10
- HAL↔LOB: open, x16, z24–27
- HAL↔WAR: z27, x4–6
- HAL↔MAIL: z27, x12–14
- PLZ↔ATR: open, x16, z18–24
- LOB↔ATR: fully open at z24
- LIB↔ATR: arches at z8, x18–22 and x26–30
- ATR↔ENG: x32, z15–17, with a +0.3 step
- ATR↔CAF: x32, z22–24
- LOB↔CAF: x32, z26–30 (4 m)
- LAB↔ARC: x40, z4–7
- LAB↔ENG: z10, x40–43
- ENG↔CAF: z22, x40–43
- Bays↔STR: 3 m storefront opening centred on each bay's street face
- LAB has **no atrium door**, because the slide occupies that corner. It is reached through ENG (z10) or ARC.

**Vertical:**
- **Stairs** run from x16.2→18, z18 (y0) to z9 (y3.6). That's a 9 m run at 0.4 slope, drawn as steps and walked as a ramp.
- The top **landing** at x16–18, z8–9 joins the mezzanine.
- **Slide** (one-way down): a helix around the axis (31,10.5), r 1.1, 1.5 turns, from the mezzanine mouth (30.5,8.5,y3.6) down to an exit at (30.8,12.6,y0) facing south. Both the player and agents can ride it.

**Sightlines** are the reason the layout is shaped this way:
- From spawn, looking north: help desk and queue to the left; RAM column to the right; the pit and Big Board ahead; beyond them the library arches, the mezzanine balcony with agents at the Round Table, and the north skyline through the glass.
- From the pit you see the engine-room LEDs through the `!` glass east, the slide east, the stairs and plaza west, and the café door southeast.
- Studio Street is the one "enclosed" contrast space. It's a lane you walk down, with bays on both sides.

### 1.3 Height field & collision

`floorY(x, z, level)` is analytic. There is no physics engine.

| Region | y |
|---|---|
| default | 0 |
| pit `d = dist((x,z),(24.5,16))` | d > 5.0 → 0; 4.2–5.0 → −0.2; 3.4–4.2 → −0.4; < 3.4 → −0.6 |
| ENG rect | +0.3 |
| stairs rect | `3.6 · (18 − z) / 9` |
| mezz rect or landing, and `level == 1` | 3.6 |

- `level` is 1 when the actor enters from the stair top. It switches back to 0 at the stair bottom or at the slide exit.
- The library (level 0) and mezzanine (level 1) share an xz footprint.
- **Auto-step:** actors climb ≤ 0.35 m instantly. Characters play a little hop, the player gets a smoothed camera y. Anything > 0.35 m is a wall.
- **Occupancy grids:** 0.25 m cells.
  - Level 0 grid is 192×128. Level 1 covers only the MEZ rect, 64×36.
  - Grids are baked at load from `layout.js` walls and from furniture footprints tagged `solid`.
  - Seats and station slots are `walkable-reserved`.
- **Player collision:** a circle (r 0.28) against the grid, resolved per axis with sliding.
- **Jump:** Space gives v0 4.2 m/s at g 12. Pure fun, but lets you hop onto the pit sofa.

### 1.4 Navigation (agents)

- **Grid A\*** on the occupancy grid for the actor's level, with an octile heuristic, then **string-pulling** (LOS on the grid) for smooth paths.
- Cross-level travel uses portal edges:
  - `stairs` (bottom (17.1,18.6) ↔ top (17.1,8.6)), followed by a fixed spline
  - `slide` (mezzanine → pit, one-way)
- **Budget:** ≤ 2 A* runs per frame, queued. Paths are cached per `(bay, station)` pair and invalidated only on layout change.
- **Steering:**
  - Path following with arrival easing, plus separation from neighbours within 0.6 m.
  - Head-on conflicts resolve by id priority: the lower-priority agent side-steps and does a tiny "after you" bow. This is a feature, not a bug.
- **Slots:** every seat, station spot, queue slot and lounge seat is a `Slot{pos, yaw, pose, level, tag}` held in a reservation table (`reserve(tag, actorId) → slot | null`). If a station is full, the agent falls back to the desk variant of the animation.

### 1.5 Scaling 1 → 40 agents

**Bays.** Each workspace gets a bay, and bays are **sticky** while the workspace lives.
- Bay order goes nearest the pit first: `E3, W4, E2, W3, W2, E1, W1`.
- Bay key is `workspace_id`. The colour comes from a hash of `label`, so it stays stable across restarts, from an 8-colour palette defined by art.

**Desks.** A bay has 6 desk slots:

```
bay interior (5.7 m) seen from the street:
 back wall  [D1][D2][D3]
            [ tab rug ]      ← D4..D6 face D1..D3 (face-to-face island)
            [D4][D5][D6]
 street     ---- 3 m opening ----
```

- Panes are ordered by `(tab order, pane order)`.
- **Tabs** get contiguous runs. Each run's first desk carries a **tab plate** (`tab.label`), and a potted plant divides runs.
- A workspace with > 6 panes takes the nearest free bay as an **annex**: the awning extends and the sign reads "#n → annex".
- More than 7 bays in use sends overflow to **hot desks** on the mezzanine balcony (8 seats, z7.5, x17–29). Those desks get a tiny workspace pennant.

**Shells.** Shells get their own benches in ENG: 8 benches, then 8 standing stations along the glass.
- Each shell bot wears a chest plate in its **workspace colour**, so workspace grouping survives the separation.
- Shells also get a "ghost desk" in their bay: a small CRT-and-mug placeholder. This way the bay tells the full workspace story.

**Capacities:**

| Place | Capacity | Overflow |
|---|---|---|
| Help queue | 10 visible slots (a snake) | Bench @ (29,28) |
| Pit | 10 sofa seats + 6 beanbags | Rim standing |
| Nap Nook | 3 bunks | Pit beanbags |

**Counts.** At 40 agents, about 25 are working at desks or stations, and the counts stay readable. At 1 agent, the NPC receptionist, the cat and ambient props carry the life (P3).

## 2. herdr → world mapping

Source fields come from `session.snapshot` / events: `PaneInfo`, `WorkspaceInfo`, and the transcript-derived `activity`. See the architecture doc for the exact Entity shape.

| herdr / derived | World representation |
|---|---|
| workspace (`workspace_id`, `label`, `number`, rollup `agent_status`) | A bay with a shop sign `#number label`, a street banner in the workspace colour, and a window neon plus street-lamp glass in the rollup colour. The Big Board WORKSPACES face shows it too |
| tab (`tab_id`, `label`) | A desk run, a tab plate and a rug stripe |
| pane with `agent != null` | A Clawd-family character with a nameplate `name · project` |
| `agent` kind | Body tint: `claude` = terracotta Clawd; `codex` and others get a hue shift plus a different ear/antenna silhouette (defined by art) |
| pane with `agent == null` | A **shell bot** in ENG with the workspace chest plate. The head screen shows `process` |
| `agent_status` | Destination + pose + a **floor ring** under the feet in the state colour + an overhead icon (§3) |
| `cwd` / `foreground_cwd` basename | Project label on the nameplate, the desk monitor bezel sticker and the coffee-mug text. Roster "group by cwd" |
| `terminal_title_stripped` | Speech/thought bubble text when the player is near (≤ 8 m) |
| `focused` (in the herdr TUI) | A little spotlight cone plus a ◆ over the head: "the boss is looking at this one" |
| transcript `activity.tool` / `detail` / `category` | Station trip or desk prop (§3.2). The monitor shows `detail` |
| `model` | Hat: opus = tiny crown, sonnet = beret, haiku = flower sprig |
| `contextTokens` | Backpack size (≥ 50k small, ≥ 100k medium, ≥ 150k stuffed with papers, ≥ 180k sweat drops and a slower walk) |
| `subagents` | Mini interns (0.45×) orbiting the owner, one per subagent, max 4 |
| `todos` | The War Room whiteboard renders the list with checkmarks when that agent is there. Also shown on the status card |
| `prompt` (blocked choice menu) | The Help Desk ticket shows `question`; the status card shows the options |
| pane appears / disappears | Arrives through the front door with a "first day" box → walks to its desk. On leaving, packs the box, waves at the nearest camera and exits through the door |

## 3. Behaviour

### 3.1 State machine (location = f(status, time in status); tool only affects working)

Status colours are placeholders that art will finalise: working blue, blocked red, done green, idle grey, unknown violet, shell amber.

**Working:**
- **Default:** at its **own desk**. The pose and prop depend on the tool (§3.2). The monitor glows.
- After 5 min in the same state it steams from the head. After 15 min a coffee mug appears.

**Blocked, 0–6 s:**
- A **startle jump**: anticipation squash, then a 0.4 m hop.
- A big red "!" bubble at 1.6 m.
- It stands on its chair and waves both arms.
- Its desk lamp turns red, and this stays red for the whole blocked period.

**Blocked, > 6 s:**
- It walks with a hurried trot (1.6 m/s) to the **Help Desk queue**, ordered by `statusSince`.
- It holds a **ticket** showing `mm:ss` waited. Every 20 s it taps the bell (a spatial "ding").
- Its bubble shows `prompt.question`, or `title` if there's no question.
- The first in line stands at the counter under the NOW SERVING light.
- The desk keeps a red lamp and a post-it: "at help desk →".
- The alarm beacon spins when any agent is blocked.

**Blocked, > 5 min:**
- A personal **rain cloud** appears over its head.
- The skylight gets rain streaks while any agent has been blocked more than 5 min.

**Done:**
- At the desk: a **victory**. Anticipation crouch, a backflip or spin (random from 3 variants), and 40-piece confetti.
- Then it carries its laptop to a **Pit sofa** seat and sits, sipping cocoa. It waves when the player is within 4 m.
- A green ✓ pennant sits in its mug.
- Order on the sofa is by `statusSince` (oldest nearest the south gap, i.e. nearest you).

**Done, > 30 min:** it blends into idle behaviours but keeps the ✓ pennant.

**Idle:**
- **Under 2 min:** at the desk. Chair spin, stretch, doodle, looks at the player.
- **2–10 min:** a weighted chill loop, one new pick every 20–60 s:
  - coffee machine
  - arcade
  - ping-pong, which **pairs** 2 idle agents
  - foosball (2–4 agents)
  - water the plants
  - window gazing
  - library browsing
  - petting the cat
  - fish-tank staring
- **Over 10 min:** the Nap Nook bunk, a pit beanbag or head-on-desk. Z's rise from the head. A nightcap appears between 00:00 and 06:00 local time.

**Unknown:**
- Desaturated body with a "?" icon.
- **Wanders** STR ↔ PLZ, stares at the map signpost, turns in circles, bumps into things and apologises.

**Shell (by `process`):**
- At its ENG bench, see §3.3.
- A crashed or closed process gets a smoke puff and an antenna blink.

- **Hysteresis:** a status must persist 1.5 s before the actor re-targets. Status changes during a walk re-plan from the current position.
- **Reactions** are one-shots on a layer that preempts the loop for 0.6–2.5 s. The events come from the server's `event` messages:

| Event | Reaction |
|---|---|
| `blocked` | Startle |
| `finished` | Victory |
| `error` | Dizzy spiral eyes plus a smoke puff |
| `test-pass` | Fist pump, and the Lab TEST light goes green |
| `test-fail` | Slump, the safety shower drizzle, and the TEST light goes red |
| `commit` | Runs a capsule to the Mail tube, which then *thunks* across the ceiling |
| `spawned-subagent` | Clap, and the interns pop out |
| `arrived` | A door-chime wave |

### 3.2 Working: tool → station

**Station trip rule:** the agent goes to a station only if the same **tool class** persists for ≥ 5 s and the station has a free slot. It returns 8 s after the class ends (hysteresis). Otherwise it plays the **desk variant**, so short tool bursts never cause commuting spam.

| Tool class (transcript `name`, Bash `category`) | Station (slots) | Station animation | Desk variant |
|---|---|---|---|
| Edit / Write / MultiEdit / NotebookEdit | — (always the desk) | Fast typing at 5–7 Hz with exaggerated elbow bounce; pages fly into the out-tray; a red pencil flick on Edit | same |
| Read / Grep / Glob / LS | **Library** (6: 4 armchairs, the ladder, 1 aisle) | Read: an open book, head scanning left to right. Grep: sweeps a magnifier. Glob: pulls books off the shelf onto a stack. The ladder slot slides along the rail | Book on the desk |
| Bash `test` / `build` / lint | **Lab** (4 bench slots) | Pours beakers and watches the flask bubble. The TEST light is amber while running | Monitor flashes `>_` |
| Bash `git` | **Mail** (2) | Stamps envelopes, feeds the tube | Stamps on the desk |
| Bash other / `network` | — | Hammering keys at 7 Hz, leaning in, `>_` sparks | same |
| TodoWrite, plan mode, `thinking` > 20 s | **War Room** (4 whiteboard slots) | Draws on the whiteboard, which renders `todos` (✓ / ◻ / →) | Clipboard ticks; thinking = chin-rest plus 3 thought orbs; after 20 s a lightbulb |
| WebSearch / WebFetch | **Observatory** on the MEZ (3: telescope, radio desk, window) | Looks through the telescope; wears headphones at the radio desk while the mast pulses | Satellite-dish hat on the head |
| Task / Agent (subagents > 0) | **Round Table** on the MEZ (6) | Sits at the head of the table and pounds the table; interns take the other seats and scribble | Interns scurry around the desk |
| `mcp__*` tools | **Phone booths** in the PLZ (2) | Talks on a rotary phone and gesticulates | A phone at the desk |
| unknown / null | — | Generic typing | — |

The mezzanine stations mean working agents regularly use the **stairs**. When the station trip ends, agents **take the slide down** 50% of the time. It's the main "look, they're alive" moment.

### 3.3 Shell bots (ENG)

Shell bots wear their workspace plate. Behaviour follows `process` (substring match):

| process | Animation |
|---|---|
| none / shell prompt | Idles at the bench and taps a blinking cursor on its face screen |
| vim / nvim / nano / hx | Knits (a code scarf grows) |
| `*test*` / pytest / cargo test / jest | Juggles 3 balls; one drops on failure |
| dev servers (`npm run dev`, vite, docker, `*serve*`) | Turns a hand-crank generator; its bench bulb glows |
| htop / top / btop | Reads a newspaper; the pages show a CPU chart |
| ssh / mosh | Talks into a walkie-talkie; its antenna blinks |
| python / node / REPLs | Shakes a cocktail shaker |
| git | Carries a box to Mail and comes back |
| long-running build (make, cargo build, cmake) | Shovels coal into the rack furnace door |

### 3.4 Ambient life (never mistaken for agents: no nameplate, no floor ring)

**Receptionist NPC "Ada":**
- A cream-coloured Clawd with a headset, at the help desk.
- She greets the player on spawn, points toward the oldest blocked agent, and waters the fig when nobody is blocked.
- She is the onboarding host.

**Office cat "Segfault":**
- A low-poly procedural cat.
- It sleeps on the **hottest** rack column (CPU temp), sits on idle agents' keyboards, and follows the player if the player stands still for 5 s.
- Pat it and it purrs.

**Other ambient life:**
- Fish tank with a boids school of 12.
- Espresso steam.
- Plant sway (vertex shader wind).
- Ceiling fans (load average).
- String lights twinkle on the street.
- Pneumatic capsules follow network activity.
- Occasional pigeons on the north window ledge.

**Crossing paths.** Two agents that cross paths **high-five** (10% chance, cooldown 60 s each). Agents in the same workspace are more likely to chat, shown as a bubble with "…".

## 4. System stats (diegetic, and readable)

**Readability rule.** Every stat object has a canvas **plaque** with the exact number, legible at 4 m. Aiming the crosshair at it (≤ 8 m) shows a tooltip with the value, a 5-minute sparkline and the source. Canvases redraw ≤ 2 Hz and only on change. Needles and fills lerp per frame.

The machine has 16 threads, 28 GB RAM, a 1.9 TB NVMe, amdgpu, `k10temp`, an nvme hwmon and wifi (mt7921).

| Stat (source) | Object | Where | Mapping |
|---|---|---|---|
| CPU per thread (`/proc/stat`) | **Rack wall**: 16 columns × 12 LED segments, one per thread, labelled `c0..c15` | ENG east wall x47.5 | Lit count = pct×12. Green→amber→red ramp. Blinking at ≥ 90% |
| CPU total, load 1/5/15 | **Boiler pressure gauge** (1 m dial, visible from the pit through the glass) + ceiling fans | ENG glass @ (32,13,y3) + atrium | Needle 0–270°. The gauge rattles when > 85%. Fan RPM ∝ load/threads |
| RAM used / buff-cache / total (`/proc/meminfo`) | **RAM lava column**: a 2.8 m glass cylinder of glowing liquid with rising blobs | LOB (27.5,26.5), visible from spawn | Bright layer = used, translucent hazy layer above = cache. Tick marks every 4 GB. Plaque `5.1 / 28 GB (+20 cache)`. Blob speed ∝ allocation churn |
| Swap | A small bucket under the column's drip tap | same | Fill level |
| Disk per mount (`statfs`) | **Filing-drawer wall** (10 cols × 6 rows), one bank per mount | ARC | Drawers bulging or open with paper ∝ used. Plaque `/ 182 / 1900 GB`. > 90% → paper piles on the floor |
| Disk I/O rate (`/proc/diskstats`) | Microfiche reader spinning | ARC | Spin ∝ MB/s |
| NVMe temp | Thermometer on the vault door | ARC | Mercury height |
| GPU busy, VRAM (`/sys/class/drm/card0/device/gpu_busy_percent`, `mem_info_vram_*`) | **Hamster wheel** with a mini Clawd running + the arcade HI-SCORE bar | ENG (44.5,11.5) + CAF arcade | Wheel speed ∝ busy. VRAM as the HI-SCORE bar. If unavailable: "hamster on break" sign |
| CPU temp (`k10temp`) | Thermostat dial + heat shimmer over the racks; the cat relocates to the hottest spot | ENG | Shimmer > 75 °C |
| Network rx/tx (`/proc/net/dev`) | **Radio mast** rings on the roof (seen from the mezzanine and outside) + pneumatic capsules in the atrium ceiling | MEZ + ATR | Pulse rate ∝ log bytes/s. rx blue inbound, tx orange outbound |
| Uptime | "DAYS SINCE LAST REBOOT: N" flip sign | ENG door | Flip animation on change |
| Local time / date | Wall clock in LOB, **sun and sky** outside | global | Real time drives day/night lighting and window emissives |
| Claude tokens (transcripts) *(optional, later)* | Split-flap **departures board** on the mezzanine fascia, facing the lobby | MEZ z8, y4–5 | Shows 5h block, today, burn/min and reset time |
| Everything, summarised | **Big Board**, 4 faces | PIT, y4.2–6.2 | N = STATES (counts + names of blocked), E = MACHINE (CPU ring, RAM bar, disk bar, GPU), S = WORKSPACES (colour + rollup + agent count), W = CLOCK + uptime + tokens. Slowly rotates 90° every 20 s; stops rotating when the player looks at it |

## 5. Player & gameplay

### 5.1 Controls

| Input | Action |
|---|---|
| Click canvas | Pointer lock (walk mode). `Esc` releases it (UI mode) |
| WASD / arrows · mouse | Move / look. Eye height 1.35 m. Characters are about 0.7 m tall, so you look down at them fondly |
| Shift | Sprint 6.5 m/s |
| Space | Jump |
| **E** | Context interact. On an agent: **open terminal**. On objects: ring the bell, pour coffee, ride the slide, play the arcade, sit |
| F | **Follow**: a 3rd-person orbit camera that trails the agent. E still opens its terminal. F or Esc exits |
| Q (hold) | **Pat** on the head: the agent squashes, hearts pop out, a purr blip. Cosmetic |
| R | "Come here!": the agent walks to you, waves, then returns. Cosmetic, cooldown 30 s |
| T | **Paper plane**: type a prompt, then throw it. It flies to the agent and sends `agent.prompt`. Confirms if the agent is `working`. Real action |
| 1–9 while looking at a **blocked** agent (or in its card) | Answer the `prompt` option (`agent.answer`). Off by default: `allowQuickAnswer` in settings. Shows a confirm toast |
| B | Jump to the next blocked agent (glide) and open its terminal |
| Tab | Roster drawer (works without pointer lock) |
| Ctrl+K or / | Command palette: agents, zones, actions |
| M | Minimap ⇄ full overview map (click a dot or zone to glide there) |
| P | Photo mode |
| H or F1 | Help overlay |
| Ctrl+` | From the terminal, back to the world (relock) |
| F3 | Perf overlay |

**Gliding / teleport.** "Go to agent" is an eased glide: 400–900 ms, camera path along the nav path at 12 m/s, FOV kick. It ends facing the agent at 1.8 m. It's never a jump cut, because it keeps spatial memory.

### 5.2 Looking at agents

**Aimed at within 12 m:** a nameplate plus a status pill float above the head (always on within 6 m).

**Aimed at within 6 m:** a **status card** docks to the lower right. It shows:
- name, kind, model hat, status and time in status
- workspace · tab · project
- `title`
- `tool: detail`
- context bar, subagent count
- `lastPrompt` (2 lines)
- `todos` (top 3)
- for blocked agents: the `prompt` question with numbered options
- action hints `[E] Terminal [F] Follow [T] Note [Q] Pat`

The agent glances at you. Eyes track the camera within a 60° cone.

**Monitor text.** Desk monitors show real screen text (low-rate `pane.read` / `screen` for ≤ 6 nearest agents within 6 m in the frustum). Walk up behind an agent and you literally read over its shoulder.

### 5.3 Terminal UX

**E / Enter** opens the xterm panel for that pane. The transition:
1. The camera dollies into the agent's monitor (300 ms).
2. The monitor flashes white.
3. The DOM terminal panel slides in docked right (50% width, draggable 35–80%) or full-screen (`Ctrl+Shift+F`).

**While the terminal is open:**
- The world keeps rendering at reduced rate (≤ 30 fps) on the left.
- The agent in the world sits a little straighter and looks toward the camera. It knows you're watching.
- Tabs are available for up to 6 terminals.

**Panel header:** name, status, workspace, plus **Focus in herdr**, **Release** and **Close pane** (with confirm). Shells can be opened the same way.

### 5.4 Notifications (never miss a blocked agent)

**On → blocked:**
1. A global 2-note chime (WebAudio, procedural).
2. A spatial "ding" at the agent's position (HRTF panner). It repeats every 20 s at the Help Desk bell.
3. A toast bottom-left with the question and `[B] go`.
4. An **edge chevron** on the screen border pointing at the agent (colour = red, distance label).
5. A minimap blip pulse.
6. The alarm beacon spins, and its red light sweeps the lobby walls.
7. The window title / Electron badge count. An OS notification only if the window is unfocused.

**On → done:** a soft marimba arpeggio and a green toast. No chevron.

**Noise controls:**
- Rate limit: 1 per agent per 10 s, and bursts merge.
- A mute toggle, and per-category volume in settings.

### 5.5 Roster & grouping (the usable layer)

The roster drawer is a right panel, 360 px, openable at any time with Tab.

**Group-by** (`G` cycles):
- **State**: blocked first, always expanded
- **Workspace**: colour chips, ordered by `number`
- **Tab**
- **Project/cwd**
- **Kind**: claude / codex / shell
- **Tool**

**Rows:**
- Each row shows `● name · elapsed`, `tool · detail`, and `title` (1 line).
- Buttons: `>_ open`, `⌖ go to`, `👁 follow`.
- Keyboard: ↑↓ to move, Enter opens, `g` goes to.

**Header:**
- Counts per state as filter chips.
- A search field.
- A "Shells" toggle.
- `+ Shell`, which spawns in the hqtest/selected workspace. It's a mutation, so it's disabled against the default session unless `allowMutations`.

**The world mirrors grouping:**
- workspace = bay
- tab = desk run
- state = location, plus the Big Board STATES face
- cwd = nameplate sticker

Group-by *Workspace* also lights the matching bay banners when a group row is hovered: "show me where this group lives".

### 5.6 Minimap & overview

- **Minimap:** 180 px, bottom-left above the toasts. The level-0 or level-1 plan is baked once from `layout.js` to a canvas. It shows:
  - dots in state colours, with shells as squares
  - a player arrow
  - pulsing blocked dots
- **Overview (M):** 70% overlay with zone names, workspace bay labels and dots. Click to glide. Hovering a dot shows the mini card.

### 5.7 Photo mode (P)

- Free camera with no collision, 2 m/s.
- The HUD hides.
- Controls: DOF focus on the agent under the crosshair, filter presets (warm / noir / risograph), tilt-shift toggle.
- `Enter` saves a PNG, via download or an Electron save.
- Pose buttons make all agents in view look at the camera and wave ("say cheese").

### 5.8 Onboarding & help

**First run (flag in localStorage):**
1. Ada waves you in: "Welcome to HQ! Your agents work here."
2. A 5-card coach overlay, each card gated by the player's action:
   - "Look around (mouse)"
   - "Walk (WASD)"
   - "Look at an agent → card"
   - "Press E to open its terminal"
   - "Tab = everyone at a glance"
3. It's skippable.

**The H overlay** shows the full keymap plus a legend: state colours and what each zone means.

**If no herdr is reachable:** Ada holds a sign saying "herdr offline". Lights dim to 40%, agents doze, and a banner offers retry and a `--demo` hint.

### 5.9 Fun layer (grows over time; each item is small and optional)

- **The Slide** for the player and agents.
- **Coffee delivery:** E on the espresso machine, carry the cup (visible in hand), E on an agent gives it. The agent does a happy wiggle and gets a steam-mug buff icon for 60 s. Cosmetic.
- **Employee of the Day** frame in the lobby: the agent with the most `finished` events today, portrait rendered live with a render-to-texture of the character.
- **Dance party:** when all agents are `done` or `idle` and at least one finished within the last 2 min, the Pit hearth becomes a disco (bloom sparkles, 20 s procedural music loop).
- **Ping-pong rally:** pairs of idle agents play. A long rally gets an audience.
- **Bell spam:** ringing the Help Desk bell 5× quickly makes every agent in view turn and look at you, annoyed. Ada frowns.
- **Seasonal decor** keyed by date (pumpkins in Oct, snow on the skylight in Dec).
- **Night shift:** after 22:00, lights go warm and dim, desk lamps turn on, and idle agents wear nightcaps.

## 6. Performance-driven level rules (780M)

- Zone **cells** (`LOB PIT/ATR STR+BAYS PLZ/HAL WAR/MAIL LIB MEZ LAB/ARC ENG CAF`) have a hand-authored **visibility table**. Anything outside the camera cell's visible set is hidden, skipping characters' animation updates too, except for position integration.
- Characters update fully when < 12 m, at 20 Hz when 12–25 m, and not at all beyond that.
- Static geometry is merged per cell. Furniture is instanced per type.
- Glass is used sparingly: storefronts, the ENG partition, the mezzanine rail and the facades use a cheap non-refractive material.
- Outside is a single skyline InstancedMesh plus a sky shader.
- Target: 60 fps at 1080p with 12 agents, and ≥ 45 fps with 40. The quality scaler adjusts pixel ratio first, then SSAO, then outline.

## 7. Milestones & targets

### M1: Playable HQ (the MVP; must feel good before anything else is added)

1. `layout.js`: every zone rect, wall, door, the pit, the stairs, the mezzanine, `floorY`, the occupancy grids, slots and the visibility table. The minimap is baked from it.
2. Blockout of all zones with final floor materials and palettes. Windows plus a simple skyline and garden.
3. Player controller: walk, sprint, jump, auto-step, stairs, 2 levels.
4. Clawd rig (walk, idle, sit, type, wave, startle, victory) and shell-bot rig (roll, idle, type).
5. Bay allocation (sticky), desks with tab plates, and shell benches.
6. The state machine for all 5 states plus shells: desk, Help Desk queue, Pit sofa, idle chill loop (coffee, window, nap), unknown wander.
7. Nameplate plus status card, and **E → xterm terminal**. Roster drawer with State and Workspace grouping, open, go to. Ctrl+K palette.
8. Stats: rack wall, RAM column, filing wall, clock, Big Board v1 (STATES and MACHINE faces).
9. Blocked notifications: chime, toast, chevron, beacon.
10. `--demo` mode with scripted agents covering every state and tool, so it's testable without touching the default herdr session.

**M1 acceptance:**
- 60 fps with 12 demo agents.
- Any terminal opens in ≤ 2 inputs.
- A blocked agent is visible from spawn within 8 s.
- A screenshot from spawn shows ≥ 5 zones.

### M2: Living office

- Tool stations with reservations: library, lab, War Room with real todos, observatory, Round Table plus interns, phone booths, mail.
- Stairs and slide traffic.
- One-shot reactions: confetti, test light, mail capsule.
- Model hats and backpacks.
- Monitor screen text.
- Follow cam and glide.
- Spatial audio (footsteps per material, typing near you, ENG hum pitch ∝ CPU).
- Minimap overview, time of day and night lighting.
- Ada onboarding, the cat, ping-pong pairing, high-fives.
- The rest of the stats: gauge, hamster wheel, radio mast, archive thermometer, uptime sign.

### M3: Delight

- Paper-plane prompt, pat, "come here", coffee delivery.
- Photo mode.
- Employee of the Day, dance party, rain cloud and skylight weather, nightcaps, seasonal decor.
- Departures board (tokens).
- The shell process animations table in full.
- Settings panel (volumes, mutations, quick-answer).

### Later / ideas backlog

- **Multi-session campus:** each herdr session is a building across the street. Walk outside through the lobby doors.
- **Per-agent "day timeline"** scrub: replay today's state history as a ghost trail on the minimap.
- **Achievements**, e.g. "Unblocked 10 agents in under a minute".
- **Agent-authored decor:** a finished task pins a tiny framed commit message on the bay wall (last N commits per workspace).
- **Voice-less "chat" bubbles** between agents in the same workspace when one's output mentions another's files.
- **Weather** tied to CI status, if a hook ever exists.
