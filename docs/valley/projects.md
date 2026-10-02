# Valley Projects

The Mayor's restoration board. Six broken places around the valley each have a plan pinned to a board on the square.
A plan asks for a mix of four things:

* bits from your purse;
* finds from your pastimes (forage, fish, a rare find, the old boot);
* a friend's blessing (hearts with the villager who champions it);
* real work from your coding agents: commits shipped, test runs passed, blocked agents unblocked, tasks finished.

When a plan is complete the place is mended. Until then it stands in the world as a ruin. The first time you come near
afterwards it is **unveiled**: the ruin goes, the restored place pops up with confetti and a fanfare, and the champion
says a line. Each restored place unlocks something small.

Key sources (paths relative to `renderer/src/farm/`):

| file | what |
|---|---|
| `model/projects.ts` (pure, `projects.test.ts`) | the six plans (`PROJECTS`), item groups, how work events count (`WORK_OF`, `countWork`), the store and service (`createProjects`): pay, give, event, check, unveil, the glasshouse violet (`pick`), dev complete / reset, the letters (`projectLetter`) |
| `world/projects.ts` (pure) | where the places stand (`PROJECT_SITES`), each site's frame, its terrace pad and its forecourt (`PROJECT_CLEAR`, which `world/map.ts` keeps clear of scatter) |
| `projectboard.ts` | wires the model to the wallet, friendship, the valley's event stream and the mailbox. Storage key `claude-valley.projects.v1` |
| `scene/projects/models.ts` | Kit builders for each place (ruin and restored), the board and its live cork face |
| `scene/projects/projects.ts` | system `projects` (scene root `projects`), service `projectsScene`: places, unveiling, confetti, interactables, colliders, the footbridge's walk surface, the mill wheel, the telescope, the halt's bell |
| `scene/projects/assets.ts` | gallery assets `projects-board`, `project-lanterns`, `-footbridge`, `-glasshouse`, `-mill`, `-observatory`, `-halt` (variants `ruin` / `restored`) |
| `hud/projects.ts`, `hud/projects.css` | the board's panel (`panel-projects`) and the completion / unveiling toasts (`watchProjects`) |
| `dev/projects.ts` | `__valley.projects` |

## The plans

They are listed in board order. "After" means the plan stays locked until those projects are done. The whole set ends
at the halt.

| id | place | bits | finds | real work | blessing | after | unlocks |
|---|---|---|---|---|---|---|---|
| `lanterns` | lantern posts along the stones' footpath | 60 | 3 forage | 2 unblocked | Fern ♥2 | | the path glows every night |
| `footbridge` | footbridge over the river, downstream of the big bridge | 120 | 2 fish | 5 shipped | Bram ♥3 | | a walkable shortcut to the west bank |
| `glasshouse` | glasshouse below the windmill hill | 150 | 5 forage | 10 test runs | Posy ♥3 | | E picks a sweet violet once a day, all year |
| `millwheel` | river mill north of the hot spring | 200 | 3 fish + the old boot | 15 shipped, 5 finished | Hazel ♥4 | footbridge | the wheel turns (millrace sound), a bench |
| `observatory` | observatory up the north slope | 250 | 1 rare + 4 forage | 25 test runs | Nimbus ♥4 | lanterns | sit at the telescope: the view tilts up and zooms |
| `halt` | train halt on the south rim | 400 | 4 fish + 4 forage | 40 shipped, 10 unblocked | Marigold ♥5 | glasshouse, mill, observatory | ring the bell (the train whistles back), a bench |

* **Bits** go in from the panel: Pay 10, or pay the rest (or whatever you have).
* **Finds** are handed in one at a time from the basket. Every basket item that fits the need gets a chip. Groups:
  `forage` (any forage find), `fish` (any fish except junk), `rare` (anything marked rare in the Collections book),
  `boot` (the old boot: fishing junk finally has a use).
* **Real work** counts by itself while the plan is open. `WORK_OF` maps the valley's events to kinds: `ship` →
  shipped, `celebrate` → test runs, `unblocked` → unblocked, `finished` → finished. One event counts toward every
  open plan that wants it, capped at the need. Locked and done plans never count.
* **The blessing** is read live from friendship. It is never spent.

### The demo never counts

`countWork(data, kind, demo)` returns nothing when `demo` is true. `projectboard.ts` passes `valley.state.demo` with
every event, so the demo valley's pretend farmers can't fill a plan. It also ignores events until the server has said
hello. Bits, finds and hearts still work in the demo, so you can try the board. The work rows say "the demo valley's
farmers are pretend: only real work counts". This mirrors `stampbook.ts`.

`__valley.projects.work(kind, n)` counts events as if the valley were real. Use it for testing.

### Completing and unveiling

The board calls `check({ friends })` once a second, and soon after any gift, payment, work or friendship change. A
plan whose needs are all met is marked `done` (a timestamp). That emits `complete`. The HUD then shows "Project
complete: …" (fanfare), and a letter from the champion arrives in the mailbox. Letters are re-posted on load if
missing, so they are idempotent.

A done plan is `pending` until its place has been seen. The scene unveils it when you are outdoors within 42 m and not
frozen in a panel or cutscene. The ruin is removed and the restored place pops in (an `easeOutBack` scale about its
pivot). Confetti bursts (instanced, at most 220 bits). You hear fanfare, pop and sparkle, and the champion speaks.
(Sound elsewhere: the mill wheel's `millwheel` loop, the halt's bell answered by a distant steam `train`, the
telescope's `scope` ratchet, the glasshouse's ambience bed: [audio.md](audio.md#coverage-features--sounds).)
`unveil(id)` stores `unveiled`, and the HUD toasts "… is restored!" with the unlock line. The lantern path lights its
posts one by one. When the last project is unveiled, the valley lets off fireworks.

Reduced motion: no pop-in (the place simply appears) and a smaller confetti burst (60 bits rather than 160). The
toasts and sound still play.

## The board on the square

The board stands on the square's west edge, next to the noticeboard and facing the square. Its cork face is a canvas
redrawn live: six cards with progress bars, ✓ or a lock, and "n of 6 restored". There is a contributions box under
it. Look at it and press E ("Read"). The hint line shows how many are restored, any waiting to be seen, and whether
your basket has anything that fits.

### The panel (`panel-projects`)

* Left: one button per plan (`project-<id>`), with an icon, the title, a status (glyph + word) and a progress bar.
  Keys: ↑ / ↓ move, 1–6 jump to a plan.
* Right (`project-page`): the title, where it is, a status chip (`project-status`), the blurb, and one row per need:
  * `project-need-bits`, with `project-pay` and `project-pay-all`;
  * `project-need-<group>`, with `project-give-<item>` chips;
  * `project-need-<work>`;
  * `project-need-hearts`.

  A finished plan shows what it unlocked. "Go and see it" / "Go there" (`project-go`) closes the panel and stands you
  in front of the place.
* `project-msg` reports the last action. `project-purse` shows your bits.

Status is always a glyph plus a word, never colour alone:

| glyph | word |
|---|---|
| ● | n% there |
| ▲ | Ready! / Finished: go and see! |
| ✓ | Restored |
| ■ | After … |

High contrast (`.vh-layer.hc`) outlines the bars and cards. Focus stays on the same control across re-renders. Narrow
windows stack the list above the page.

Layout (`projects.css`): the panel sits between the needs-you strip (`--lw`) and the dock's column (`--dw`, the dock
buttons' row + a gutter), so the mail / map / ledger buttons stay visible and clickable beside it (at 1440×1000 a
centred 900 px board used to cover them). When less than 560 px is left between the two, it keeps the strip clear and
covers the dock.

## The places

Each place is built in its site's local frame (`world/projects.ts`; front = +z, as everywhere). The ruin is built at
start-up. The restored version is built the first time it is needed. Places beyond 175 m are hidden.

| place | ruin | restored |
|---|---|---|
| lanterns | posts every 6.5 m along the stones' footpath (alternating sides, arms over the path, a pair at the entrance), knocked askew, dark, glass cracked, weeds | upright, lanterns lit at dusk (`LightsService` emitters) |
| footbridge | stone abutments on both banks, the trestles, a snapped middle trailing in the water, sawhorse barriers | full deck (walkable: wraps `walkSurface`), rope rails (colliders), lanterns at the ends |
| glasshouse | brick sill, a bare frame with a few loose panes, a heap of panes, weeds, a wheelbarrow | glazed (the glass glows warm from inside at night), benches of seedlings, pots, an open door, a tub of violets. E picks today's violet into the basket |
| mill | stone ground floor, broken walls, no roof; the wheel half its paddles, jammed with a boot | upper walls and a roof, a wheel turning on its axle over the river (sound loop), a bench by the millrace |
| observatory | round stone tower, dome rusted shut, ivy, a boarded door | dome open with the telescope out, lit window, a visitors' telescope outside (sit: view tilts up, FOV 24) |
| halt | an overgrown platform on a terrace, a fallen shelter roof, weedy sleepers, a leaning lamp post | swept platform, shelter, "CLAUDE VALLEY" sign, lamp, flower tubs, bench, and a bell (ring it and the evening train whistles back after 2 s) |

"Look at" on a ruin shows the plan's blurb and points you to the board.

### Sites and terrain

`world/projects.ts` is plain data, so `world/map.ts` can read it without a cycle:

* `pad` (blend metres) levels a terrace under the glasshouse, mill, observatory and halt. These are the
  `PROJECT_SITES` loop next to the orchard's pad. The board and the footbridge have none.
* `PROJECT_CLEAR` (the footprint, plus a `front` forecourt where set) joins `clearance()`'s rectangles. Flora, rocks,
  walls and paths' decor then keep off the footprint and out of the view in front of it.

The halt was moved from the east rim to (−17, 78.5), on the south rim east of the hay meadow. A scan of the rim band
for the flattest 20 × 8 m footprint with clearance found it: the east-rim spot sat on a slope with a cliff behind and
had no good view.

## Integration

* **Fern's notebook**: page `projects` (village chapter, motif `house`). It is found once anything has been given or a
  project is done. Notes say "n of 6 places restored" and the next one up. Rumours come from Marigold, Bram and Fern.
  "What's new" has a ver 7 line. `GuideWorld.projects` is read from the `projects` service in `guidebook.ts`.
* **Mailbox**: a letter from the champion on completion (`projectLetter`).
* **Stamps** ([stamps.md](stamps.md)): *Good as mended* (the first place restored) and *All aboard* (all six), Village
  category, motifs `mallet` and `bell`. "Restored" = unveiled: `stampbook.ts` counts `unveiled` from the board's data
  (`StampWorld.projects`) and re-checks right after an unveiling.
* **The Gazette** ([gazette.md](gazette.md)): `newsroom.ts` notes `complete` / `unveil` in the journal
  (`GzNote` `project`, `ev: 'done' | 'unveiled'`). A place restored in the covered days is a *Valley Projects* story
  (the lead in a week with no harvest) with the champion's quote; one finished but not yet seen is a "fully funded"
  story. The board's teaser (`boardNeed`: the open plan nearest done, up to three unmet needs, e.g. "150 more bits")
  is a *Wanted* classified and a line in the Mayor's editorial.
* **The map** ([map.md](map.md)): place tiles for the board, every ruin (grey broken arch; gold once finished and
  waiting to be seen) and every restored place (terracotta, its own glyph and a label). Positions come from
  `projectsScene.anchor(id)` (the lantern path's is the middle of its posts), else `world/projects.ts`.
* **At night** the restored glasshouse's panes use the Kit's glasshouse pane style (`Kit.pane('glasshouse', …)` in
  `scene/structures/kit.ts`): warm glass with the seedlings, stems and leaves in silhouette on the wall panes and a
  hanging basket in some roof panes; no room, no curtains.

## Dev hooks and tests

```
__valley.projects()                    every project: status, progress, needs (have / need), done / unveiled / restored
__valley.projects.complete(id, seen?)  finish one now (needs filled, letter, toast); seen=true also marks it unveiled
                                       quietly (for shots of restored places). 'all' finishes every one
__valley.projects.unveil(id)           play the unveiling now (the project must be done)
__valley.projects.go(id | 'board')     stand in front of a place
__valley.projects.open(id?)            open the board's panel
__valley.projects.reset(id?)           forget one project, or all
__valley.projects.work(kind, n?)       count real work ('ship' | 'celebrate' | 'unblocked' | 'finished')
__hud.open('projects', id?)            the panel on a plan
```

Shots: `npm run shoot -- --shot "name=x,hour=11,weather=clear,eval=__valley.projects.complete('all',true);__valley.projects.go('halt'),wait=3000"`.

Tests:

* `model/projects.test.ts`: plans, paying, giving, work counting and demo, completion and tiers, the view, the violet,
  persistence and parsing.
* `model/robust.test.ts`: fuzzes the store.
* `model/guide.test.ts`: the notebook page.
* `browser-tests/projects.spec.ts`: board E → panel, pay and give (mouse and keyboard), demo work not counted,
  complete → toast → unveil → restored, reload persistence, the notebook page.
* `npm run audit:placement`: covers the ruins (scene group `projects`). The allowlist entries for intended contacts
  (abutments in the banks, trestles and the wheel in the river, ruins on their bases, weeds on the platform) are
  under `projects/*` in `scripts/placement-allow.json`.
