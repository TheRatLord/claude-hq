# UI kit direction: WORKSHOP SIGNAGE

Status: direction proposal (UI kit pass). Extends DESIGN §8 and ART §9 and replaces ART §9.1 "Visual language" if adopted.
Mockup: `renderer/ui-lab/signage.html`. Scenes are chosen by hash: `#work`, `#world`, `#palette`, `#kit`.
Shots: `docs/shots/ui-lab/signage-{work,world,palette,kit}.png`, plus 2× crops `signage-work-{roster,drawer,card}-2x.png`.

> **The 2D UI is more signage in the same building.** Every panel is something a clay-diorama carpenter could have made:
> a painted board in a walnut rim, a cream paper slip, an enamel plaque, a brass-bezelled readout, an indicator lamp. The
> Big Board, the HELP DESK plaque, the ARRIVALS sign, the paper task placards and the CRT screens already exist in
> the world. The UI reuses their materials and never adds a new one.

---

## 1. Principles

1. **Four materials only: Board, Paper, Plaque, Readout.** (Hardware like brass, walnut rims, lamps and keycaps are fittings *on* them.)
   Any surface has to be one of these four. "A dark rounded rectangle with a 1 px border" is not a material, and it is what made the old UI read as generic.
2. **Lamps, not pills.** Status is a *lit fitting* (a lamp with a shape-coded bezel) plus a *word*. The UI never uses a filled
   capsule, for status or for anything else.
3. **Readouts for numbers.** Counts, timers and the blocked counter are dot-matrix LEDs behind brass. They use the same 5×7 bitmap as the
   Big Board (`world/stats/dotfont.js`), so a HUD count and the Big Board count read as the same device.
4. **Paper is for deciding.** Anything the user has to *read and answer* (a blocked question, the palette, a toast, help) is
   cream paper with ink text. The dark board is for *scanning* (roster, drawer chrome). This is the ART §9 "ink cards dark / paper
   light" rule made physical.
5. **One accent with one job.** Clay marks **selection and the one primary action per surface**. Status colours appear only on
   lamps, readouts, the marquee and the rubber stamp. Workspace colours appear only on the little enamel shield. Brass is only ever a fitting.
6. **Separate with grooves, not boxes.** Inside a surface, sections are separated by a routed groove (dark line + light line), a
   dashed pencil rule (on paper), or whitespace. Rows are never boxed.
7. **Keyboard is the primary input, and the keycaps show it.** Every action shows its key as a cream type-block keycap. The keycap looks the
   same on board and on paper. Usability rules from DESIGN §8 (≤ 2 inputs to any terminal, scopes, focus) are unchanged.
8. **The terminal is sacred.** The xterm grid keeps ART §9.3 exactly: no scanlines, texture or tint over glyphs. Only the
   bezel around it is styled, as a recessed CRT glass.

---

## 2. Tokens

All colours come from `shared/palette.js`. The kit adds **derived** tokens (below) and no new hues. They belong in `palette.js`
as a `UI` group, so feature code still never hard-codes hex.

### 2.1 Colour

| Token | Value | Derived from | Use |
|---|---|---|---|
| `board` | `#221F1C` (gradient `#26221F → #221F1C → #1E1B19`) | `ink` + 3% oak | Board paint |
| `boardLo` | `#1A1816` | ink | Recesses: search slot, detent track, lever well |
| `glass` | `#141312` | ink | Readout / CRT glass |
| `rim` | `walnut #7B5238`, outer line `#3D2819` | walnut | 5 px board rim, minimap / hotbar / knob rail wood |
| `brass` / `brassHi` / `brassLo` | `#C9A15A` / `#EBCB8A` / `#8A6A34` | butter × oak (in-world `#E4C27A` RAM plaque) | Bezels, rivets, clip, drawer pull, tab rail, knobs |
| `enamel` | `tealDeep #2F5E62` (+ `#3A6F73` top) | tealDeep | Plaques (titles, session, minimap label) |
| `paper` / `cream` / `oat` | palette | — | Paper face / paper shade / keycap bottom |
| `clay` / `clayDeep` / `clayLight` | palette | — | Selection bar, highlighter, primary button, tab underline, detent notch, focus ring |
| text on board | `t1 #F4EDE3`, `t2 #BFB5A7`, `t3 #8E857A` | cream ramp | 14.1:1 / 8.1:1 / 4.5:1 on `board` |
| text on paper | `p1 #1F1E1D`, `p2 #5A544D`, `p3 #877E72` | ink ramp | 14.8:1 / 6.7:1 / 3.6:1 (p3 only for non-essential ≥ 12 px meta that is repeated elsewhere; use `#756C61` 4.6:1 where it must pass) |
| status (lamps) | palette `STATUS` | — | Lamp glass, LED digits |
| status word on board | blocked `#FF8A7C`, working `#8CC4F2`, done `#8FD9AB`, idle `t3`, shell `#9FEAB9`, busy `#F6C98A` | status +20% L | Small-caps state word (7.2–11.7:1 on board) |
| status word on paper | blocked `#C23A2D`, working `#25659E`, done `#23704A`, idle `p3` | status −30% L | State word, stamp ink (4.75 / 5.45 / 5.36:1 on paper) |
| `rule` | `rgba(94,158,160,.28)` | teal | Ruled lines on the palette index card |
| `unreadBulb` | butter radial | butter | Unread dot (a small bulb, not a status colour) |
| `marquee` | `#C8392C → #A62A20`, bulbs `#FFE6A6` | blocked, darkened | "N NEEDS YOU" strip, alarm tally cell |

### 2.2 Type (system fonts only)

| Role | Stack | Style | Sizes |
|---|---|---|---|
| **Sign** (plaques, group headers, state words, buttons, keycap letters, engraved labels) | `ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", Ubuntu, Cantarell, "DejaVu Sans", system-ui, sans-serif` (identical to in-world `FONT_UI`) | 800, UPPERCASE, `letter-spacing .10–.16em`, `font-stretch: condensed` (it picks DejaVu Sans Condensed where it exists) | 10.5 / 11.5 / 13 / 18 |
| **UI** (names, questions, body) | `system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "DejaVu Sans", sans-serif` | 600–750 for names, 400–650 body | 12 / 13 / 14.5 (row name) / 16.5 (question) / 22 (card name, sign stack) |
| **Mono** (tool lines, cwd, times, terminal) | `ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace` (+ `TERM_FONT` fallbacks in xterm) | 400/700 | 11.5 / 12 / 12.5; xterm `termFontPx` |
| **Dot-matrix** (counts, timers, blocked counter) | procedural canvas, 5×7 bitmap from `dotfont.js`, round LEDs + ghost dots at 7% | lit colour + `shadowBlur = 1.6·pitch` | pitch 1.8 (drawer) / 2.2 (roster count) / 2.7 (HUD tally) |

Scale steps: **10.5 · 11.5 · 12 · 13 · 14.5 · 16.5 · 22** (sign 18 only for a hero plaque). Only the sign role uses uppercase.
Agent names, paths and questions keep their real case.

### 2.3 Space, edges and depth

- **Spacing:** 4-pt base, using `4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24`. Board inner padding is 14. Paper padding is 18–20. Row padding is `8 14`. HUD inset from the viewport is 22.
- **Radii** (everything is bevelled, per ART §1): board 12 (rim 15), paper 4 (it's cut stock, so nearly square), plaque 5, readout 4,
  keycap 4, button 6, tab 5 (top only), porthole 50%. **Never** 999 px, because that's the pill.
- **Borders:** the board has no CSS border. Its edge is the walnut rim (`box-shadow` rings 1/5/6 px). Paper has a 1 px `rgba(80,60,40,.18)` hairline
  plus a 2-step stack edge (`0 2px #E0D5C4, 0 3px #D2C5B1`) that reads as card thickness. Readouts use a 3-ring brass bezel.
- **Depth (3 levels, warm shadows, never neutral black):**
  - `d1` fitted: `0 2px 0 <darker rim>` (plaques, keycaps, buttons: a physical lip)
  - `d2` resting: `0 4px 10px rgba(28,16,8,.35), 0 18px 40px -8px rgba(28,16,8,.55)` (boards, paper)
  - `recess`: `inset 0 2px 4px rgba(0,0,0,.65), 0 1px 0 rgba(255,236,210,.06)` (slots, detent track, lever well, CRT)
- **Textures (runtime-generated, no files):** inline SVG `feTurbulence` data-URIs used as CSS backgrounds:
  `grain` (board paint, `baseFrequency .012 .55`, α .055), `woodgrain` (rims, α .35), `fibre` (paper, α .07). Each is one
  320 px tile, cached by the browser, and costs nothing per frame. **No `backdrop-filter`.** Boards are 100% opaque, like real
  signs. That removes the ART §9.1 blur cost and the "Low quality" special case.

### 2.4 Motion

ART §9.1 easing and timings are unchanged (160–220 ms, `cubic-bezier(.2,.9,.3,1.2)`, ≤ 4 px overshoot). Kit-specific:
- A **blocked lamp** pulses at 1.4 s (opacity and glow). It's the only pulsing thing besides the marquee.
- **Marquee bulbs** chase at `steps(3)` 1.2 s. They only run while blocked > 0.
- **Readout digits** flip in 90 ms: the old digit's dots fade and the new ones light, row by row top to bottom (a split-flap nod).
- **Paper** slides in with a 0.5° settle rotation. A **toast ticket** "prints" by sliding 12 px down from its stub.
- `prefers-reduced-motion` or the setting: no pulse (the lamp stays lit at full), no chase (bulbs static), digits cut.

---

## 3. Parts (the kit)

| Part | Anatomy | Rules |
|---|---|---|
| **Board** | painted ink + grain, 5 px walnut rim, 12 px radius | The only large dark surface. Opaque. Rows sit directly on it. |
| **Paper** | cream + fibre, 4 px radius, stack edge, warm drop shadow | For deciding and reading. Optional fitting: brass **clip** (status card) or perforated **stub** (toast). |
| **Plaque** | teal enamel, cream 1 px keyline inset 2 px, two brass rivets, sign type | **One per surface**, as its title (`AGENTS`, session `HQTEST`, `LOBBY`). Variants: `butter` (DEMO), `clay` (reserved for Onboarding "Ada says"). |
| **Readout** | glass + 3-ring brass bezel, dot-matrix canvas | Numbers and ≤ 10-char codes (`2 BLOCKED`, `4:12`, `08`). Never prose. |
| **Lamp** | brass bezel + lit glass. Shape = meaning | See §4. 14 px in rows, 12 px in tabs, 18 px in the HUD and on tickets. |
| **Keycap** | cream type-block, 1 px hairline, 2 px lip, sign font 800 (letters don't read as digits: `O` ≠ `0`) | Same on every material. `.sm` = 16 px. Chords are separate caps (`Leader` `U`). |
| **Button, primary** | clay face, `clayDeep` 3 px lip, cream sign text, optional keycap | At most **one per surface**. Pressing drops 2 px (the lip shrinks). |
| **Button, plain** | no fill, 1.5 px brass (board) or ink 35% (paper) inset keyline, sign text | Secondary actions (`+ SHELL`, `BACK`). |
| **Hint** | keycap + lowercase verb in `t2`/`p2` | Action rows and footers. Hints in a row are spaced 12–18 px apart, with no separators. |
| **Icon button** | 26 px, 1.75 px stroke icon (ART §9.1), `t2`. On: `brassHi` | Toolbars only. Each has a tooltip with its key. |
| **Groove** | 2 px: `#0E0C0B` + `rgba(255,236,210,.06)` | The only divider on a board. Group headers extend it as their leader line. |
| **Slot** (text input) | `boardLo` recess, mono placeholder, trailing keycap | Search, note and hire inputs. The focus ring is on the slot. |
| **Detent** (segmented choice) | recessed track, sign labels, a 3 px clay **notch** under the active one | Group-by and scope. Labels light up (cream). They don't fill. |
| **Lever** (binary mode) | `PEEK ◯— CONTROL` in a recessed well, brass knob that turns clay in Control | Peek/Control only. The lit label is butter (Peek) or clayLight (Control). |
| **Porthole** | 44/28/56 px live portrait in a conic brass ring | Rows, tabs, cards and the hotbar. The portrait atlas is unchanged (ART §9.1). |
| **Enamel shield** | 9×11 px shield in the workspace colour, cream keyline | Before a `workspace › tab` label. It's the only place a workspace colour appears in the 2D UI. |
| **Marquee** | red strip, chasing bulb border, glowing cream sign text | Only for "N NEEDS YOU" (roster top) and the alarm tally cell. Echoes the Big Board. |
| **Stamp** | rotated −6°, 2.5 px status-ink border, multiply blend, fibre-masked | Paper only. `WAITING 4:12` on blocked cards and `SIGNED OFF` on done cards. |
| **Highlighter** | clay 28–34% skewed swipe behind a paper row, plus a clay ▸ in the margin | Selection on paper (options, palette results). |

---

## 4. Status without pills

| State | Lamp (shape) | Word | Where colour may appear |
|---|---|---|---|
| blocked | **triangle** warning lamp, red glass, "!" etched, pulses | `BLOCKED` | lamp, time readout in red, marquee, stamp, alarm tally cell |
| working | **round** lamp, blue glass, steady glow | `WORKING` | lamp, word |
| done | **round** lamp, green glass, ✓ etched | `DONE` | lamp, word; `SIGNED OFF` stamp when acked |
| idle | round bezel, **unlit** dark glass, dashed ring | `IDLE` | none (the word is `t3`) |
| unknown | round, lavender, "?" etched | `UNKNOWN` | lamp |
| shell | **square CRT** bezel, green phosphor `>_` | `PROMPT` | lamp, word |
| shell-busy | square CRT, amber phosphor | `RUNNING` (or the process verb: `SERVE`, `MONITOR`) | lamp, word |

- The shape carries the meaning, so the UI never relies on colour alone (DESIGN §8.11). Every lamp has `aria-label` = the state word.
- In a **roster row** the right column is the stacked *word* (small caps, status tint) over the *elapsed time* (mono). There is no
  background. The lamp moves to the **group header**, since grouping by state already says it. When grouping by something other than state, the
  row puts the lamp before the word.
- **Drawer tabs** show a text-less 12 px lamp (shape + `aria-label`), as in DESIGN §8.2.
- **HUD** counts are **tally cells**: lamp + LED digits + sign label. A zero count is ghost dots at 55% opacity, so the board never
  reflows. The blocked cell becomes a marquee cell when > 0.
- **Unread** is a butter *bulb* (8 px) after the name, with a count as small mono digits when > 1 (`9+`). It never uses a status colour.
- **Age heat** (DESIGN §8.7) tints the time only: `t3 → butter → #FF8A7C` as the wait grows.

---

## 5. Hierarchy (what never nests in what)

```
World
 ├─ Board          ⊃ plaque ×1 · grooves · rows · slot · detent · lever · readouts · lamps · keycaps · icon buttons
 │                   · at most ONE paper slip clipped to it (a toast ticket inside the drawer layer)
 ├─ Paper          ⊃ text · dashed rules · keycaps · lamps · stamp · highlighter · portholes · ONE clay button
 └─ HUD hardware   (tally board, knob rail, minimap frame, hotbar, chevrons, crosshair + aim tag)
```

**Never:**
- paper in paper, or board in paper (the old "card in a card": the Serve card, the pinned Inbox card in the roster, the confirm bar inside the card)
- a filled capsule (pill) for anything: status, filters, counts, badges or mode
- status colour outside lamps, readouts, the marquee and the stamp (no tinted row backgrounds, no coloured borders)
- more than one plaque or one clay primary button per surface
- a box around a list row, a group or a single line of text (use a groove, a dashed rule or whitespace)
- icons without a key hint in a place the keyboard can reach
- texture, tint or scanlines over terminal glyphs

---

## 6. Components per surface

### 6.1 HUD (`hud.js`, `hotbar.js`, `notify.js`, `minimap.js`, `chevrons.js`, `aim.js`, `overlays.js`)

| Old | Signage kit |
|---|---|
| Top-centre state pills | **Tally board**: a brass-framed glass board hung on two short rods from the top edge, and the only HUD element the pills turn into. Cells are `lamp · LED digits · LABEL`, separated by grooves. The blocked cell becomes a marquee when > 0. Cells stay clickable filters (they open the roster filtered). It centres on the *visible world strip* when the roster or drawer is open. |
| Session badge | **Plaque**: enamel `HQTEST`, butter `DEMO`, slate-enamel `DEFAULT`. |
| Sound / help / settings | **Knob rail**: walnut rail with three brass knobs (icon inked on each). |
| Toasts | **Ticket**: a paper slip with a perforated stub. The stub holds the 18 px lamp and the elapsed time in status ink. The body holds `workspace › tab` (p3), the **headline** (`lumen is blocked`, sign 800 15 px), one line of question (p2, ellipsised) and hints (`B inbox`, `Leader U jump`). The stack sits above the minimap, max 3, newest on top, and older ones slide under by 6 px. Inside a focused or fullscreen drawer, tickets render top-right *inside* the CRT bezel layer (DESIGN §8). |
| Minimap | **Paper map in a walnut frame**, with a `LOBBY` zone plaque on the frame's top edge. Ink walls on cream, the pit ring in dashed teal, agent dots in status colours (blocked has a halo ring), the player as a clay arrow. `M` = overview is unchanged. |
| Off-screen chevrons | **Clay arrow sign** at the edge: a clay face shaped into an arrowhead (pointing toward the agent), with a blocked lamp, name and wait time in cream. |
| Crosshair + E prompt | 6 px cream dot with an ink ring. On an interactable it expands to a 30 px cream ring (ink-outlined). The **aim tag** is a small paper tag tilted −1.2° with `E` keycap + **name** + verb (`open terminal`, `sign off`, `answer`). |
| Hotbar (pins 1–9) | **Pigeonholes**: 9 recessed cubbies in a walnut rail. Each shows a porthole, a number keycap in the corner and a status lamp bottom-right. The selected cubby gets a 2 px clay inset ring. Empty cubbies are dim. A missing (24 h) pin shows as a dimmed porthole with a dashed ring. |
| Overlays (offline, leader pending) | Offline is a **paper notice** pinned top-centre (`herdr offline` + Retry plain button + hint). The Leader-pending chip becomes a **plaque** `LEADER ▸`, top-centre under the tally. |

### 6.2 Roster (`roster/**`, `names.js`, `unread.js`, `prune.js`)

Top to bottom, all on one board (360 px; the compact variant is 300):
1. **Header:** `AGENTS` plaque + readout count (`08`, butter LEDs) · spacer · icon buttons: compact (`Alt+C`), keep-open pin (brassHi when on), close.
2. **Group-by detent:** `STATE SPACE TAB PROJ DIR KIND TOOL` (`Alt+1..7`). Clay notch under the active one.
3. **Search slot:** mono placeholder `search · is:blocked ws: cwd:` + `/` keycap.
4. **Lamp toggles** (state filters): `lamp + WORD` for blocked, working, done, idle and shells. Off = unlit lamp + dim word. There are no chips. `+ SHELL` moves to the footer as a plain button.
5. Groove.
6. **Marquee** `▲ 1 NEEDS YOU · B inbox` when anything is blocked. It **replaces the pinned Blocked Inbox card** (no card in a card). Enter or click opens the Inbox.
7. **Pinned** section (when pins exist): header `PINNED` with the digit keycaps shown in each row's porthole corner.
8. **Groups:** header = chevron · lamp · `SIGN LABEL` · groove leader line · mono count. Sticky. `aria-level` per DESIGN §8.11.
9. **Rows** (56 px comfortable / 28 px compact):
   `porthole | name (14.5/750) + unread bulb + ◆ if herdr-focused + shield ws › tab`
   `          | tool · detail (mono 12, t2)`
   `          | [selected only] hints: ⏎ open · A answer · G go · F follow · S sign off · P pin`
   right column: `STATE WORD` over `elapsed` (heat-tinted). The context meter shows only on the selected row and on hover (a 96 px gauge
   in a recess, sage→butter), which keeps unselected rows calm. The sticky note shows as a paper-corner glyph after the name.
10. **Selection** = clay 4 px left bar with a soft glow + cream 9% → 3.5% gradient fill. **Hover** = 4% cream tint. **Focus ring** = 2 px
   `clayLight` outline, 2 px offset (`:focus-visible`). These are three distinct visuals (DESIGN §8.11).
11. **Frozen reorder** "3 changes" becomes a *plain button* with a readout digit (`3 CHANGES`), not a pill.
12. **Footer** (behind a groove): `SORT recent ▾` (engraved label + value) · `+ SHELL` plain · `? keys`.
13. **Icon rail** (64 px, when squeezed): portholes + lamps only, still keyboard-navigable.

### 6.3 Terminal drawer chrome (`terminal/**`, excluding xterm internals and theme)

- **Sheet:** a board with the walnut rim on the left only and a 14 px radius on the left corners. The **resize handle is a brass drawer pull**
  (14×64 px, dotted grip), centred on the left edge. Dragging it = resize, double-click = reset to 50%.
- **Tab rail** (48 px, darker recessed strip): tabs are **label holders**. Inactive: a dark raised plate with the name in `t2`. Active: a
  **paper card** in the holder (cream, ink name, 3 px brass rail on top, clay underline where it meets the header). Each tab =
  porthole 22 · name · 12 px lamp · unread bulb · × on hover or when active. A blocked tab's lamp pulses. ≤ 6 LRU tabs (unchanged).
- **Blocked counter** (always visible, fullscreen too): a readout `▲ 2 BLOCKED` (red LEDs) at the right end of the tab rail + `Leader` `U`
  keycaps. Hidden at 0. On a new block the digits flip and the lamp pulses 3×. Click = next blocked terminal.
- **Header:** breadcrumb `workspace › tab › pane` in UI 15/750 (the earlier segments in `t2`, `›` in brass), cwd below in mono 12 `t3`.
  Right side: the **Peek/Control lever** · icon toolbar (copy recent `Leader C`, history `Leader [`, focus in herdr, fullscreen
  `Leader Z`, collapse). *Mark seen*, *Release*, *Close pane* and *Why?* live in an overflow `⋯` menu, which is a paper dropdown with key hints.
  `◆ in herdr` becomes a small enamel plaque-less label: a brass ◆ + `IN HERDR` in engraved sign type.
- **Docked-unfocused:** the header text drops to `t3`, the lever dims, and the footer hint reads `⏎ or Leader to type`.
- **CRT bezel:** the xterm sits in a recessed glass well (`#1A1917`, 8 px radius, inset shadow, 3 px dark ring + faint catch light).
  ART §9.3 colours, font and grid are untouched. Letterboxing fills with the same glass colour.
- **Lifecycle banners** (`busy`, `taken`, `gone`, `offline`, `error`): a **paper notice strip** laid across the top of the CRT
  (not a floating card): message · plain button (`Take over`, `Reclaim`, `Retry`, `Close tab`). There is at most one.
- **Outbox** `12 chars pending · Send · Discard` is a ticket stub at the bottom-left of the CRT (paper). The **Ctrl+C confirm** and
  **fit hint** ("Fit pane to drawer…") use the same bottom-left ticket slot, one at a time, with a keycap for the action.
- **History overlay:** the read-only xterm keeps the same glass. A **butter plaque** `HISTORY · READ-ONLY` sits top-centre with hints
  `End` `Esc` `type to return`.
- **Footer rail** (46 px): left = mode hint with lamp (`● Peek — type or Leader I to take control`). Right = engraved label
  + value pairs separated by grooves: `GRID 120×44 | FONT 14px | COPY ON SELECT on`. The `?` icon opens the key overlay.
- **Collapsed** (28 px edge rail): portholes + lamps + a vertical blocked readout.

### 6.4 Cards (`statusCard.js`, `cardModel.js`, `inbox.js`, `serveModel.js`, `triage.js`, `recap.js`, `away.js`)

- **Status card = a clipboard sheet.** A paper sheet with a brass clip at its top centre, 360–396 px, bottom-right of the *visible world*
  (it moves left of the drawer).
  - Head: porthole 56 · name (sign stack 22/850) · shield `ws › tab · kind`. Right: the state as `lamp WORD` over the time, or for
    blocked a **stamp** `WAITING 4:12` (red ink, −6°).
  - Body: title (UI 14.5/700), `tool · detail` mono, a dashed rule, a small **two-column spec list** with engraved labels
    (`TODO`, `CONTEXT`, `SUBAGENTS`, `LAST PROMPT`, `NOTE`) and plain values. There are no boxes or inner cards.
  - Footer: hints `E terminal · G high-five/sign off · F follow · N note`.
- **Blocked question (Serve card; Inbox; status card of a blocked agent)**: the same sheet.
  - Question: UI 16.5/700 ink with a 3 px **red margin rule** at the left (like ledger paper). No box.
  - Options: **ledger lines**. Each is `keycap n · label`, 38 px tall, separated by dashed rules. The destructive note is sign 10 red
    (`ENDS SESSION`, `ESC`). The highlighted option = clay highlighter swipe + clay ▸ in the margin. `1–9` jump (only inside the card).
  - Confirm: *on the same sheet*, the line `Send "1. Yes" to flint?` (p2 with the option in p1) + the **one clay primary** `SEND ⏎`
    + plain `BACK Esc`. The old ink confirm bar inside the paper card is removed.
  - Moves: `O open terminal · G go there · → next · Esc`.
- **Blocked Inbox (`B`)**: a stack of these sheets on one **clipboard**, oldest on top. The sheets behind show as 2 offset paper edges.
  Tabs `BLOCKED · DONE · TRIAGE` are a **detent** printed at the top of the clipboard (paper variant: ink labels, clay notch), with a
  readout count only on the clip (`2`). The Done tab uses ledger lines with `S sign off` and a plain `SIGN OFF ALL`.
- **Triage** (full width): a wide clipboard. On the left is a **CRT inset** with the last 12 screen lines (xterm theme, read-only). On the right
  is the Serve sheet. Progress is a readout `3/7` on the clip. `→ skip`, `O open`, `S sign off` hints at the bottom.
- **Away recap / recap**: a **paper memo** pinned with a brass tack (`WHILE YOU WERE AWAY` in sign type). The lines are ledger rows, each
  `lamp · name · what happened · time`. There's one primary button (`OPEN OLDEST BLOCKED ⏎`) and a plain `DISMISS`.

### 6.5 Dialogs (`cmdk.js`, `paletteRank.js`, `promptBar.js`, `hireDialog.js`, `help.js`, `onboarding.js`, `settings.js`)

- **Command palette = index card** (ART §9.2's "one light moment", now literal). 640 px, centred on the visible world, world veiled
  (warm radial 28–60% ink). Header line: search icon · 21 px input · `Esc` keycap, under a **clay double rule** (index-card red line). The results sit
  on **teal ruled lines** with section heads in clayDeep sign type (`AGENTS`, `PLACES`, `ACTIONS`). A row = porthole or icon · name
  · mono context · right-aligned `lamp WORD time` or verb. The selected row = highlighter + ▸. Footer hints: `⏎ open · ⇧⏎ go to · ↑↓ select ·
  Tab scope`. Ranking (`paletteRank.js`) is unchanged.
- **T prompt bar** = a **paper strip** (single ruled line) docked bottom-centre above the hotbar: a `TO: flint` enamel mini-label (the
  surface's one plaque) + input + `⏎ send`. Multi-agent targets show as portholes, not chips.
- **Hire / + Shell dialog** = a **paper work order** on a clipboard. Fields are ruled-line inputs (label in engraved sign above, value on
  the line). Kind is chosen with a detent. The workspace pick is a list of shield + name ledger lines. Review step = the same sheet
  with a stamp `READY` and the one clay button `HIRE ⏎`. The `allowMutations` gate shows as a red stamp `LOCKED` + reason.
- **Help / `?` key overlay** = a **notice board**: a board titled `KEYS · WORLD` (plaque, scope in the title) holding 2–3
  **paper sheets** side by side (the columns: Move, Agents, Terminal). Each line = keycaps · verb. This is board ⊃ paper (allowed), and there's
  never paper in paper.
- **Onboarding** = Ada holds a **card**: a paper sheet with Ada's porthole on the left, a `clay` plaque `ADA SAYS` (the one clay plaque
  use), body text, progress as 5 small lamps (lit clay = seen), and a plain `SKIP TOUR` + primary `NEXT ⏎`.
- **Settings** = a **control panel board**. Sections are separated by grooves with engraved headings. Booleans are **levers** (the same
  component as Peek/Control, with ON/OFF labels). Sliders are **brass fader knobs in a recessed track** with a readout value.
  Enums are **detents**. Text/number values are slots. The one plaque is `SETTINGS`. Server-side settings carry a brass padlock glyph.

---

## 7. Accessibility & usability checks (unchanged contract, kit-specific notes)

- Text contrast is ≥ 4.5:1 for everything ≤ 13 px on board and paper (tokens in §2.1). `p3` is used only for ≥ 12 px metadata that is repeated elsewhere.
- The state is always **shape + word** (lamp + small-caps word or `aria-label`). Readouts carry an `aria-label` with the plain text
  (`2 blocked`), because the canvas is decorative (`role="img"`).
- Letter keycaps use the sign font (800), so `O`/`0` and `I`/`1` are distinct. Symbol keycaps (⏎ ↑ ↓ /) may use mono.
- Keyboard paths (P2 ≤ 2 inputs), scopes, Leader and focus rules: DESIGN §8.2 and §8.7 are unchanged. The kit only restyles them.
- The terminal is ART §9.3 verbatim. Nothing overlays glyphs except toasts and banners, which sit in their own layer, never above the cursor row.

## 8. Performance

- No `backdrop-filter` anywhere. That saves the blur pass under the roster and drawer on the 780M.
- Textures are 3 SVG noise tiles, rasterised once. Lamps are `<use>` of 7 `<symbol>`s. Glows are `drop-shadow` on ≤ ~30 small
  SVGs. The pulse animates only opacity/filter on blocked lamps (≤ 9 at a time).
- Readouts: redraw a canvas only when the text changes (≤ 10 Hz UI tick). Each is ≤ 200×20 px at DPR 2.
- The marquee bulb chase is a `background-position` step animation on one element. It is paused when blocked = 0 or under reduced motion.

## 9. Implementation map (for the per-surface owners)

1. Add `UI` tokens to `shared/palette.js` (§2.1) and expose them as CSS vars in `styles.js` (`--board`, `--brass*`, `--enamel`,
   `--t1..t3`, `--p1..p3`, …). Delete `--panel`, the 999 px radii and every `.chip`/`.pill` rule.
2. `styles.js` gets the shared kit classes: `.board .paper .plaque .readout .lamp .key .btn.primary .btn.plain .hint
   .groove .slot .detent .lever .port .ws .marquee .stamp .hl`, plus the three noise tiles.
3. Add `ui/kit/dotmatrix.js`: a DOM wrapper over `world/stats/dotfont.js` `drawDots` (so the HUD and the Big Board share one bitmap).
   Add `ui/kit/lamps.js`: the `<symbol>` sprite injected once, plus `lamp(state, size)` → `<svg><use>` with `aria-label`.
4. Surfaces migrate independently. Each owner replaces its local chip/pill/card markup with kit parts and checks the §5 "never"
   list in review. `p2.mjs` and `npm test` selectors stay the same (class names on semantic containers are kept).

The mockup (`renderer/ui-lab/signage.html`) is the visual reference for every part above. Its CSS is written so it can be
lifted into `styles.js` almost verbatim.
