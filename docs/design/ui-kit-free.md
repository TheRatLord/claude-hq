# UI kit "Felt & Clay": the game table

Direction proposal from the "free" designer. It extends DESIGN §8 and ART §9 and replaces ART §9.1's visual language (panels, chips, pills).
Mockup: `renderer/ui-lab/free.html`. Its views are `#all`, `#world`, `#drawer`, `#palette` and `#kit`. It is shot over a clean game frame, `renderer/ui-lab/free-bg.png`, taken with the UI hidden.
Screenshots: `docs/shots/ui-lab/free-{all,world,drawer,palette,kit}.png`.

## 1. The idea

The 2D UI is the **table you play the office on**, like a board game laid out in front of the diorama. It uses the same material family as the world: matte clay, painted wood, felt and cream paper.

| Material | Real-world read | UI role |
|---|---|---|
| **Felt mat** | the dark baize a board game sits on | **Every panel**: roster, drawer, status card, toast, HUD strip, dialogs. A thick soft slab with a 4 px extruded lip |
| **Walnut rail** | painted-wood edge of a game box | The header strip of the two big mats (roster, drawer) and of dialogs. It carries names, tabs and the blocked counter |
| **Clay tile** | Scrabble tile / toy block | **Anything you press**: buttons, key hints, switch knobs, unread beads. It has a 2–3 px lip and presses down 2 px |
| **Clay bead** | a game token | **Status**. A coloured, shape-coded bead with plain words next to it. Never a coloured pill |
| **Paper** | a card you're dealt | **Things you read closely and answer**: the question slip, the command palette, coach cards. Pinned with a clay pushpin |
| **Well** | a dimple pressed into felt | Inputs, switch tracks, meters, hotbar sockets, and the terminal bed |
| **Stitch** | a sewn seam | The only divider, a 1.5 px dashed cream line at 15 %. It also runs inset around free-floating mats |

This is not stationery (paper is rare and means "answer this"), and it is not signage (the enamel and marquee signs stay in the world). It is the **toy-box/board-game layer** between you and the diorama.

### Principles
1. **Three materials, one accent.** Felt holds, clay is pressed, paper is answered. `clay` is the only accent colour, used for the primary tile, the selection notch, the focus ring, the Control switch, the caret and the pushpin.
2. **Status is a bead, not a pill.** A 12 px clay bead (shape + colour) followed by plain words in `t2`. Only *blocked* colours its words, and only blocked animates.
3. **Flat inside a mat.** Content sits directly on the felt. Rows, groups and sections are separated by whitespace and stitches, never by borders or inner cards.
4. **Every action wears its key.** A key is always a cream key tile. Buttons carry their tile on the left (`[E] Terminal`).
5. **Depth has 3 steps** (well −1, mat 1, tile 2) plus paper at 1½. Nothing stacks deeper.
6. **The terminal is sacred.** xterm keeps the ART §9.3 theme, sitting in a well (inset bed) with 12 px of felt around it. The chrome is styled; the glyphs are not.

## 2. Tokens

The source of truth is `shared/palette.js` for colours. The new UI-only tokens below are derived from it and live in `styles.js` as CSS vars.

### 2.1 Colour
| Token | Value | Use |
|---|---|---|
| `--felt` | `#2A2724` (+ top-lit gradient `#302C28 → #262320`) | mat body |
| `--felt-raised` | `#37332E` | selected row, felt tile, switch knob |
| `--felt-hover` | `#312D29` | row hover |
| `--felt-well` | `#1A1917` | wells (= xterm bg) |
| `--lip` | `#121110` | the mat/tile extrusion |
| `--rail-a/-b` | `#5E402C → #4A3222` | walnut rail (darkened `walnut`) |
| `--rail-ink` | `#F1DEC6` | engraved text on the rail |
| `--t1/t2/t3/t4` | `#F4EDE3 / #BDB3A6 / #9A9186 / #6E675F` | text on felt |
| `--p1/p2/p3` | `#1F1E1D / #5E5850 / #766E64` | text on paper |
| `--stitch` | `rgba(244,237,227,.15)` | seams |
| `--clay/-light/-deep/-lip` | `#D97757 / #EBA283 / #B8593B / #8C4127` | accent family |
| status | `STATUS.*` unchanged | beads, the blocked counter, minimap dots only |
| `--blocked-text` | `#FF9285` | blocked words on felt (AA on `--felt`) |
| workspace | `WORKSPACE[i]` | **only** the portrait coin's rim and the in-portrait accessory. There is no workspace chip |

### 2.2 Type (system fonts only)
- `--f-ui`: `ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI Variable Text", "Segoe UI", Ubuntu, Cantarell, "DejaVu Sans", system-ui, sans-serif`
- `--f-stamp`: `"DIN Condensed", "Bahnschrift", "Roboto Condensed", "Arial Narrow", "DejaVu Sans Condensed", sans-serif`. Always 700, uppercase, tracking `.12em`, `font-stretch: condensed`. Used for **labels only**: rail titles, group headers, field labels and section heads.
- `--f-mono`: `ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace`. Used for tool lines, cwd, elapsed times, key-tile glyphs and terminal dimensions.

| Step | Size / weight | Use |
|---|---|---|
| stamp | 11 / 700 caps | group headers, field labels, palette sections |
| meta | 12 mono | tool · detail, cwd, age |
| body | 13 / 400–600 | default |
| name | 14.5 / 700 | row name, toast title, palette row |
| title | 16–19 / 800 | drawer crumb name, status-card name |
| input-lg | 22 / 500 | palette query |

### 2.3 Space, radii, edges
- Spacing is on a 4-pt scale: `4 8 12 16 24 32`. Mats have 16 px padding, 12 px between mats, and a 16 px gutter to the viewport.
- Radii follow the bevel rule (ART §1): mat 16 px, small mat 12 px, tile 8 px, key 5 px, well 10 px, paper `5 12 12 12` (the pinned corner is sharper).
- Borders: **there are none.** Edges come from the lip, the inner top highlight (`rgba(255,255,255,.07)`) and stitches.

### 2.4 Depth (box-shadow recipes)
- **mat**: `inset 0 1px 0 rgba(255,255,255,.07), inset 0 -1px 0 rgba(0,0,0,.35), 0 4px 0 var(--lip), 0 16px 32px -10px rgba(0,0,0,.6)`
- **clay tile**: `inset 0 1px 0 rgba(255,255,255,.28), 0 3px 0 var(--clay-lip), 0 5px 8px -3px rgba(0,0,0,.5)`. The same with `--lip` for a felt tile. When pressed it gets `top: 2px` and a 1 px lip.
- **key tile**: a cream gradient `#FFFCF6 → #EADFCF`, `0 2px 0 #A89A85`. On paper it adds a 1 px ink ring at 12 %.
- **well**: `inset 0 2px 3px rgba(0,0,0,.55), inset 0 -1px 0 rgba(255,255,255,.05)`
- **paper**: `0 3px 0 #CFC3B0` (card thickness) plus a soft drop. The palette adds a second card layer behind it, rotated 1.2° (a deck).

### 2.5 Textures (runtime-generated)
- **Felt**: an SVG `feTurbulence` data-URI (`baseFrequency .9–1.1`, 3 octaves, α .11 cream), tiled at 180 px over the felt gradient.
- **Paper**: the same approach, lower frequency (.55), brown at α .07.
- **Wood grain**: a `repeating-linear-gradient(90deg, …)` of 1 px dark/light lines over the rail gradient.

All three are CSS strings built in `styles.js`, with no files. On the Low tier, drop the felt and paper noise layers; the gradients stay.

### 2.6 Motion
- Mats enter over 180 ms with `--ease: cubic-bezier(.2,.9,.3,1.2)`, translating 8 px from their edge.
- Tiles press over 60 ms and release over 120 ms.
- The blocked bead pulses on a 1.4 s scale of 1 → 1.12 plus a red glow. This is the **only** looping animation in 2D.
- Rows reorder with FLIP. Reduced motion means no pulse (a static glow instead) and no overshoot.

## 3. Atoms

| Atom | Spec |
|---|---|
| **Status bead** | 12 px SVG (18 px in toasts and the tally, 26 px as a toast icon). The shape carries the meaning without colour. **working**: round bead with a highlight. **blocked**: rounded triangle with "!", pulsing. **done**: round with a check. **idle**: hollow ring. **unknown**: round with "?". **shell**: rounded CRT block with `>_` (phosphor; amber = `shellBusy`). It always has `aria-label` = state. It sits next to plain words: `working 2m`, `done · 12m ago`, **`blocked 4:12`** (red, bold) |
| **Portrait coin** | A round coin: 2 px rim in the **workspace colour**, a cream lit backdrop, and the live portrait (atlas tile) clipped inside with a top-left glint. Sizes 24 (tab/chevron), 30 (palette), 38 (row), 46 (hotbar), 54 (status card). It **replaces the workspace chip** |
| **Key tile** | min 18 × 18, mono 10.5/700. Labels are OS-aware: `Ctrl`, `Alt`, `Shift`, `Esc`, `Tab`, `↵`, `↑↓`, `⇧↵`, and `⌘ ⌥ ⌃` on macOS. The leader chord shows as `[Ctrl `] then [Z]`, and the leader tile appears once per strip |
| **Unread bead** | a clay ball, min 17 px, cream number. Signals only (§8.9) |
| **Meter** | a well of 44 × 6 with a clay fill (`blocked` fill ≥ 85 %). **In rows only when ≥ 80 %.** Always shown in the status card and drawer header |
| **Stitch** | `border-top: 1.5px dashed var(--stitch)`. Header fills, footers, section breaks |
| **Pushpin** | a 9–11 px clay ball on the top-left of paper |

## 4. Molecules

- **Button = tile.** There are three kinds. `clay` (primary) appears at most **once per surface**. `felt` is secondary. `ghost` is text plus a key tile. Every button has its key tile on the left. Icon buttons are bare 30 px glyphs (1.75 stroke) that lift into a felt tile on hover or focus, and get a tooltip with their key.
- **Switch (segmented control)**: a well with one knob riding in it. The knob is felt, or clay when it is a mode that changes input (Peek/Control). It is used for group-by, kind, quality and Peek/Control. There are no separate pill toggles.
- **Toggle**: a well track 40 × 22 with a clay ball knob (on = right).
- **Slider**: a well track with a clay fill and a cream key-tile knob.
- **Input**: a well that is 34 px tall. Placeholder is `t3`, filter tokens (`is: ws: cwd:`) are `t4`, and the `/` key tile sits right. Focus adds a 2 px `clayLight` ring and a clay caret. There is no inner border.
- **Group header**: a caret, a **stamp label**, the count in mono `t3`, and a stitch that fills to the right edge. It is sticky. *Needs you* uses `--blocked-text`. Collapsed groups show `▸` and their count.
- **Row** (roster, palette, recap): flat on felt with a 12 px radius hit area.
  - Hover is `--felt-hover`.
  - **Selected** means the row rises into a felt tile (`--felt-raised` plus a 3 px lip) with a 4 px **clay notch** at its left edge.
  - Dimmed rows (idle) are at 62 % opacity.
- **Paper slip**: a rotated (−0.4°) paper card pinned under a blocked row or inside a status/serve mat. It holds **one** question plus its options. Options are text rows with a number tile. The highlighted option gets a clay highlighter band and `↵` at its right.
- **Tabs (on a rail)**: portrait coin, name and bead on the walnut rail.
  - The active tab is cut from the felt below it: same colour, with rounded inverse corners where it meets the rail. It reads as one object with the mat.
  - Inactive tabs are rail-ink at 72 % with stitch separators.

## 5. Surfaces

### 5.1 HUD (`hud.js`, `hotbar.js`, `notify.js`, `minimap.js`, `chevrons.js`, `aim.js`, `overlays.js`)
- **Session plate** (top-left): a small mat with a phosphor lamp bead, the stamped session name (`HQTEST` / `DEMO` / `DEFAULT`) and `12 agents` in `t3`.
- **Tally** (top centre of the *world region*): **one** mat, 40 px tall, never five pills.
  - Each segment is `bead · bold count · word`.
  - The blocked segment comes first, gets a soft red radial behind it and a `[B]` tile, and reads "needs you".
  - A stitch separates the blocked segment from the rest.
  - Clicking a segment filters the roster. The segment for the active filter becomes a pressed well.
  - Hidden states are omitted. When nothing is blocked, the tally shows `✓ all clear` in the done bead's slot.
- **Utility** (top-right): one mat holding bare icon buttons (sound, help, settings).
- **Crosshair**: a 6 px cream dot with an ink ring. On an interactable it grows into a 26 px ring plus an **aim tag**: a small mat with a speech-tail, `[E] open flint ▲`.
- **Chevrons**: a half-mat stuck to the screen edge with its flat side on the edge. It has a red arrow, the coin, the name and the wait time in mono.
- **Toasts**: stitched mats 360 px wide, stacked 12 px apart above the minimap (or top-right inside the drawer when the drawer is focused).
  - Contents: a large bead icon, a bold title, a one-line `t2` detail, and the key hint on the right.
  - Older toasts fade to 86 %.
  - There is no close ×; Esc or a timeout dismisses them.
- **Minimap**: a paper plan (grid-ruled, ink walls, status dots, a clay player arrow) in a **walnut frame** (rail material, 9 px) with a lip.
- **Hotbar**: a stitched mat tray of 9 **wells** (sockets). Pinned agents sit in them as coins, with a status bead top-right and a number key tile bottom-left. Empty sockets show a faint number.
- **Overlays** (offline, leader-pending): the offline banner is a full-width mat strip under the tally with a `blocked` bead and a clay `Retry` tile. The Leader-pending chip is an aim-tag mat reading `[Ctrl `] ▸`.

### 5.2 Roster (`roster/**`, `names.js`, `unread.js`, `prune.js`)
- A mat 368 px wide, full height under the HUD, with a **walnut rail** reading `ROSTER` and `12 agents · 1 needs you`, plus bare pin and `+` icon buttons.
- Controls: the search well (with `/` tile), then a **full-width switch** for group-by (`State · Space · Tab · Project · Dir · Kind · Tool`, Alt+1–7 in its tooltip and in `?`).
- List: group headers and rows, **flat on the felt**.
  - Row line 1: `coin · name (14.5/700) · ◆ if focused · ws › tab (t3)`.
  - Row line 2: mono `Tool · detail`.
  - Right column: unread bead, then status bead, then age (the elapsed age heat is carried by the `t3` → `t2` → blocked-text colour of the age, not by a chip).
  - The context meter appears only at ≥ 80 %.
- A **blocked** row gets its **paper slip** (question plus `[A] answer here`, `[↵] open terminal`). This replaces the old pinned "Blocked Inbox" card inside the roster, which was a card-in-panel.
- Row actions are **not** buttons on every row. The selected row shows its key hints (`↵ open · A answer · G go · F follow`) and the footer stitch-strip repeats them. The mouse gets bare icon buttons on hover only.
- Compact mode: 28 px rows. The coin drops to 20 px, line 2 is dropped, and the bead and age stay.
- The icon rail (narrow layout) is 64 px: coins with beads, no text.

### 5.3 Terminal drawer (`terminal/**`)
- A mat with a **walnut tab rail**.
  - Tabs are `coin 24 · name · bead · unread bead`, with the active tab cut from the felt (§4).
  - The **blocked counter** sits right-aligned on the rail as a small dark inset (`▲ 2 blocked [Ctrl `][U]`). It pulses on a new block and is hidden at 0.
- Header on the felt:
  - Crumb: **name** (16/800) `· ws › tab › pane` in `t2`, with `›` separators in `t4`.
  - Next to the crumb: the status bead and words.
  - Line 2: mono cwd · kind · ctx meter.
  - Right side: the **Peek/Control switch** (the clay knob means Control), then bare icon buttons (copy recent, focus in herdr, why?, fullscreen, collapse).
  - Destructive or rare actions (close pane, release, mark seen) go in the icon buttons' `⋯` menu, which is a small mat.
  - Docked-unfocused dims the header text to `t3`, and the footer mode line reads "`[↵]` or `[Ctrl `]` to type".
- **Terminal bed**: a well, `#1A1917`, radius 12, 12 px felt margin. xterm fills it unchanged.
- Footer (a strip on the felt, 44 px):
  - Mode lamp (clay = Control, cream = Peek) with **Control** and "keys go to the pane".
  - A stitch, then `[Ctrl `] world  then [Z] zoom [[] history [U] next blocked [?] keys`.
  - The fit size `104 × 38` in mono `t3` on the right.
  - The fit hint during a resize replaces the right side with `↔ 104 × 38` in `t1`.
- **History overlay** (Leader `[`): a paper sheet over the bed with a mono transcript and the search well at the top. It is the drawer's one paper moment.
- Collapsed rail (28 px): a walnut strip with coins, beads and the blocked counter bead.

### 5.4 Cards (`statusCard.js`, `cardModel.js`, `inbox.js`, `serveModel.js`, `triage.js`, `recap.js`, `away.js`)
- **Status card**: a stitched mat 372 px wide, bottom-right of the *world region*.
  - Top: coin 54, name 19/800, kind in `t3`, then bead with words (`blocked 4:12 · waiting on you`), and the `[N]` note tile top-right.
  - Meta block in mono `t3`: `ws › tab · cwd`, `Tool · detail`, ctx meter and todo count.
  - **Question slip** (paper, pinned) with the question, the command context in a faint ink well, options as numbered rows (one highlighted, `↵` to send), and a stitch footer: `[↵] send [↑↓] choose · answers go to the pane`.
  - Footer stitch with `[E] terminal [F] follow [G] go to … [Esc]`.
  - Non-blocked agents show no slip; they show `lastPrompt` (2 lines) and the top 3 todos as flat rows with bead-ticks.
- **Blocked Inbox / Serve / Triage**: the **same mat**, one question at a time. The header reads `gale tinker › #2 · ▲ blocked 2:03 · 2 of 3`, followed by the slip and a footer `[W][S] next · [E] terminal · [Esc] leave`. The stack is shown as 2 thin felt edges peeking below the mat (a deck), never as nested cards.
- **Away recap**: a stitched mat. It has a title ("While you were away · 42 min"), then flat rows of `bead · sentence · age`, stitch-separated, then one clay tile (`[B] Answer 1`), a felt tile (`[S] Sign off 2`) and `Esc`.

### 5.5 Dialogs (`cmdk.js`, `paletteRank.js`, `promptBar.js`, `hireDialog.js`, `help.js`, `onboarding.js`, `settings.js`)
- **Command palette**: **paper**, a card-deck of 680 px at the top-third, with a scrim of `rgba(24,20,17,.42)` over the world.
  - The input line is 22 px, with a clay `›` prompt and a clay ruled line under it.
  - Stamp section headers (`AGENTS · PLACES · ACTIONS`) with stitch fills.
  - Rows show coin/icon · **name** with the matched letters under a butter highlighter · bead · description (blocked in deep red) · key hints on the selected row only.
  - Selection is the clay highlighter band.
  - The footer holds key legends.
- **T prompt bar**: a single paper strip, bottom-centre of the world region. It shows the target coin and name, a 22 px input, `[↵] send · [Esc]`. It is the same material as the palette because you are writing.
- **Hire / + Shell**: a mat with a walnut rail (`HIRE AN AGENT` and `[Esc]`).
  - Fields use stamp labels over wells: Kind is a switch with a clay knob, Workspace is a well select, Directory is a well with mono suggestions as flat text underneath, First prompt is a tall well.
  - Footer: ghost `[Esc] Cancel` and clay `[↵] Hire`.
- **Help / `?` key overlay**: a stitched mat. It is a two-column key table (tiles right-aligned, meaning in `t2`) per scope, with the scope name in a stamp header. The `?` overlay is generated from `keymap.js`, as today.
- **Onboarding**: **paper** coach cards (Ada's coin 52), a deck lip, progress **dots** (clay = current), "Skip tour" as ghost text, and a clay `[↵] Next`.
- **Settings**: a mat with a walnut rail. Sections use stamp headers with stitches. Rows are `label (13) … control` on a 2-column grid; controls are switches, toggles, sliders and wells. There are no cards per section.

## 6. Hierarchy rules (what never nests in what)
1. **World → mat.** A mat never sits on a mat (a menu or popover is a separate mat *beside* or *over*, never inside).
2. **Inside a mat** only these may appear: flat text, stitches, rows, wells, tiles, beads, coins, a rail (top edge only) and **at most one paper slip**.
3. **Paper holds only text, number/key tiles and one ink well** (command context). It never holds felt tiles, coins or another paper.
4. **Tiles never contain tiles**, except the key tile inside a button. Beads never sit on a coloured background.
5. **One clay tile per surface.** It is the default action, the one `↵` triggers.
6. **Status colour** is allowed only on beads, the blocked words, the blocked counter, the tally's blocked segment, minimap dots and meter danger fill.
7. **Workspace colour** is allowed only on coin rims and portrait accessories.
8. **No borders, anywhere.** Separation comes from space, stitches, lips and wells.

## 7. Usability contract (unchanged behaviour, clearer visuals)
- Keyboard-first stays as it is: every surface shows its keys as tiles, and focus is a 2 px `clayLight` ring outside the element (on tiles, rows and wells). Focus never relies on colour alone.
- ≤ 2 inputs to a terminal: `↵` or Leader from the world, or `Tab`, `↵` from the roster. These are shown in the footer strips.
- Contrast:
  - `t1` on felt is 12.8:1, `t2` 7.2:1, `t3` 4.8:1 (meta only, ≥ 12 px). `t4` is decorative only (separators, empty sockets).
  - `--blocked-text` on felt is 6.9:1.
  - `p1` on paper is 15.7:1, `p2` 6.6:1, `p3` 4.7:1.
  - The old `t3` (`#8A8278`) is 3.9:1 on felt, which fails AA; this kit lifts it to `#9A9186`.
- Low tier: no noise textures and no `backdrop-filter` (mats are opaque anyway); lips and shadows stay (cheap).
- Hit targets: rows 54 px, buttons 32 px, icon buttons 30 px, key tiles are decorative (not targets).

## 8. Migration notes (for the surface owners)
- In `styles.js`, add the §2 vars and the `.mat` / `.rail` / `.paper` / `.well` / `.k` / `.tok` / `.btn.{clay,felt,ghost}` / `.switch` / `.stitch` classes. Delete `.hq-pill`, `.hq-fchip` and status chip backgrounds; they map to `.tok` + words.
- `hq-panel` becomes `.mat`, and the existing `hq-kbd` becomes `.k`. The workspace chip becomes the coin rim; roster portraits already come from the atlas, so wrap them in `.coin`.
- The Blocked Inbox pinned card in the roster becomes the blocked row's paper slip. `B` still opens the Serve mat.
- The tally replaces the five top-centre pills with one element. Clicking a segment still filters.
- The bead SVGs and the coin frame are ~30 lines of inline SVG strings. Put them in `ui/glyphs` next to the existing icon set.
