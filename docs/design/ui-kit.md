# Claude HQ UI kit (FINAL): "Workshop Signage"

Status: **normative** for every DOM surface in `renderer/src/ui/**`. It replaces the visual-language parts of DESIGN §8
and ART §9.1/§9.2, which now point here. Behaviour, keymap, scopes and lifecycle (DESIGN §8.1–§8.11) are unchanged.
ART §9.3 (the xterm theme) is unchanged.

- **Mockup, the visual reference that must match this spec:** `renderer/ui-lab/final.html`. Scenes are selected by hash: `#work` `#world` `#palette` `#cards` `#dialogs` `#kit`.
  Its class names are the kit's real class names (`k-*`), so the CSS can be lifted into `ui/kit/styles.js`.
- **Shots:** `docs/shots/ui-lab/final-{work,world,palette,cards,dialogs,kit}.png`.
- **Lineage:** the winning direction is `ui-kit-signage.md`, with grafts from `ui-kit-stationery.md` and `ui-kit-free.md`.
  The problems it answers are listed in `ui-audit.md`. Those four docs are history. Where they disagree with this file, this file wins.

> **The 2D UI is more fittings in the same building.** Every surface is something the diorama's carpenter could have
> made: a painted board in a walnut rim (for scanning), a cream paper sheet (for deciding), one enamel plaque (for the
> title), and lamps, keycaps and a few readouts. These are the same materials as the Big Board, the HELP DESK plaque,
> the paper placards and the CRTs. No new material is invented, and no stock rounded card is used.

---

## 1. Principles

1. **Board for scanning, paper for deciding.** Lists, chrome and anything you skim sit on the dark **board**: the roster,
   drawer chrome, triage, help and the HUD rails. Anything you *read and answer* is on cream **paper**: the status card, inbox,
   toasts, palette, forms, recap and onboarding. At night the paper is the one light moment. It must never become a full-height
   slab.
2. **Lamps, not pills.** Status is a lamp whose **bezel shape** carries the meaning, plus a word or `aria-label`. Nothing
   is ever a filled capsule.
3. **One accent with one job.** Clay means *selection* and *the one primary action on this surface*. Status colours
   appear only on lamps and the few places listed in §4. Workspace colour appears only on the porthole rim and the enamel shield.
4. **Separate with grooves and stitches, not boxes.** A board uses the routed groove. Paper uses the dashed stitch. Rows
   and groups are never boxed.
5. **Keyboard first, and the keys are always shown.** Every action is either a button with its key tile on the left, or a
   legend entry. Never both. Each surface has at most one legend strip. The Leader is shown once per strip.
6. **Say it once.** Each fact has one home per view (§4.3). Redundant signals are deleted, not restyled.
7. **Two voices.** HQ speaks in the system sans. **The agent speaks in serif** (its question, task title and recap line),
   so "Claude is asking you" reads differently from UI chrome at a glance. Serif is upright, and never used in dense
   meta lines.
8. **The terminal is sacred.** The xterm is ART §9.3 verbatim, and only its bezel is styled. Nothing is drawn over glyphs:
   toasts, fit hints and banners sit in strips outside the CRT glass.

---

## 2. Tokens

All colour comes from `shared/palette.js`. The kit adds one **derived `UI` group** and no new hues. It is exported from
`palette.js` and emitted as CSS variables by `ui/kit/styles.js`. Feature code never hard-codes hex. That covers today's
literals in `hud.js`, `overlays.js`, `minimap.js` and `drawer.js`.

```js
// shared/palette.js  (added by the kit lead; CSS var = --<kebab-name>)
export const UI = Object.freeze({
  board: '#221F1C', boardLo: '#1A1816', boardHi: '#2C2824', glass: '#141312', crt: '#1A1917',
  walnut: '#7B5238', walnutLo: '#3D2819',
  brass: '#C9A15A', brassHi: '#EBCB8A', brassLo: '#8A6A34', enamel: '#2F5E62',
  clayInk: '#9A4A2E',                                        // clay text on paper (5.8:1)
  t1: '#F4EDE3', t2: '#BFB5A7', t3: '#9A9186',               // text on board  14.1 / 8.1 / 5.3 : 1
  p1: '#1F1E1D', p2: '#5A544D', p3: '#756C61',               // text on paper  15.7 / 7.1 / 4.9 : 1
  onBoard: { blocked: '#FF8A7C', working: '#8CC4F2', done: '#8FD9AB', shell: '#9FEAB9', busy: '#F6C98A' }, // 7.2–11.7 : 1
  onPaper: { blocked: '#B8332A', working: '#2C6DAA', done: '#2A7A4C', busy: '#8A5A12' },                  // 5.0–5.6 : 1
  rule: 'rgba(94,158,160,.30)', stitch: 'rgba(90,84,77,.30)',
});
```

The contrast figures were computed against `board #221F1C` and `paper #FBF8F3`. **Two fixes are baked in:**
- `t3` is lifted from `#8A8278`, which failed at 3.9:1.
- The primary button uses **ink text on clay** (5.3:1). Cream on clay is 2.95:1 and fails.
  `p3` (4.9:1) replaces the old 3.6–3.8:1 paper greys.

### 2.1 Type (system fonts only)

| Role | CSS var | Stack | Use | Sizes / weight |
|---|---|---|---|---|
| **Sign** | `--font-sign` | `ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", Ubuntu, Cantarell, "DejaVu Sans", system-ui` (the in-world `FONT_UI`) | Plaques, group headers, stamps, keycap letters, card name | 800. **UPPERCASE only for plaques, group headers and stamps.** 10.5 / 11.5 / 12.5 caps; 21–22 card name (normal case) |
| **UI** | `--font-ui` | `system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "DejaVu Sans"` | Names, buttons, labels, body, state words | 12 / 13 / 14 / 15 / 21 (palette input). 600–750 |
| **Voice** | `--font-voice` | `"Iowan Old Style", Charter, "Bitstream Charter", "Source Serif Pro", Georgia, "DejaVu Serif", serif` | The agent's own words: question, task title, recap sentence, prompt-bar text | 14 / 16–16.5. 500, **upright** |
| **Mono** | `--font-mono` | `MONO` from `styles.js` | Tool line, cwd, times, ages, ticket caption, printout | 11 / 12 / 12.5 |
| **Dot-matrix** | canvas | `drawDots` from `world/stats/dotfont.js` (the Big Board's own bitmap) | **Only**: HUD needs-you digit, drawer blocked counter, triage progress | pitch ≥ 2 (drawer 2.0, HUD 2.7) |

Rules:
- The type scale is **11 · 12 · 13 · 14 · 15 · 16.5 · 21**, and nothing else.
- Row text is at least 12 px.
- Buttons, state words, labels and legends are sentence case.
- Numbers in tallies are bold system numerals with `tabular-nums`.

### 2.2 Space, radius, depth, texture

- **Space:** a 4-pt base (`4 6 8 10 12 14 16 18 22`). Board padding is 14, paper padding 18–20, row padding `6 14`, and the HUD inset from the viewport is 22.
- **Radius scale:**

  | Element | Radius |
  |---|---|
  | board | 12 (rim 15) |
  | paper | 4 |
  | plaque, button | 5–6 |
  | keycap, readout | 4 |
  | tab | 6 (top corners only) |
  | porthole | 50% |

  Nothing else, and **never 999 px**.
- **Board edge** = walnut rim (`box-shadow` rings 1 / 5 / 6 px) plus a woodgrain ring. **The rim and grain are mandatory on every
  tier.** Without them a board is just "a dark rounded panel".
- **Paper edge** = a 1 px `rgba(80,60,40,.18)` hairline plus a 2-step stack edge (`#E0D5C4`, `#D2C5B1`).
- **Depth (3 levels, warm shadows only):**
  - `d1` fitted lip: `0 2px 0 <darker>`, for keys, buttons and plaques.
  - `d2` resting: `0 4px 10px rgba(28,16,8,.35), 0 18px 40px -8px rgba(28,16,8,.55)`.
  - `recess`: `inset 0 2px 4px rgba(0,0,0,.65), 0 1px 0 rgba(255,236,210,.06)`.
- **Textures:** three runtime SVG `feTurbulence` tiles set as CSS vars: `--grain` (board), `--fibre` (paper) and `--woodgrain` (rims).
  `.hq-lowq` sets all three to `none`. **No `backdrop-filter` anywhere.** Surfaces are opaque, like real signs.

### 2.3 Motion

- The ART §9.1 easing holds: 160–220 ms `cubic-bezier(.2,.9,.3,1.2)`, with at most 4 px of overshoot.
- Roster reorders use FLIP.
- **The blocked lamp's 1.4 s pulse is the only looping animation** in the whole UI. The marquee chase is gone.
- Paper settles with ≤ 0.5° rotation. The minimap paper is tilted −0.8°, a permanent angle and not an animation.
- Readout digits flip in 90 ms.
- With reduced motion, lamps stay lit (no pulse) and digits cut instead of flipping.

---

## 3. Components

Modules live in `renderer/src/ui/kit/`. Each builder returns a DOM node built with `dom.js` `h()`. CSS lives in
`ui/kit/styles.js`, which `injectStyles()` injects before the surface styles. Class names match the mockup.

| Component | Class | API (`ui/kit/*.js`) | Anatomy and rules |
|---|---|---|---|
| **Board** | `.k-board` | `board({title})` | Painted ink + grain, walnut rim, radius 12. The only large dark surface. |
| **Paper** | `.k-paper` | `paper({clip, deck})` | Cream + fibre, radius 4, stack edge. `clip:true` adds the brass **clamp** (status card, inbox, hire). `deck:n` draws ≤ 2 sheet edges below. |
| **Plaque** | `.k-plaque` (`.sm`, `.clay`, `.butter`) | `plaque(text, {tone, small})` | Teal enamel, cream keyline, rivets. **One per surface, as its title.** `.sm` has no rivets (session, minimap zone, `To`). `.butter` = DEMO / history. `.clay` = Ada only. |
| **Readout** | `.k-readout` | `readout(text, {color, pitch, label})` → `{el, set(text)}` | Glass + one brass ring + `drawDots`. Redraws only when the text changes. `role="img"`, `aria-label` = plain text. Allowed uses are listed in §2.1. |
| **Lamp** | `svg.k-lamp.<state>` (`.sm`, `.lg`, `.still`) | `lamp(state, {size, label})` → `<svg><use href="#L-state">` | Sprite injected once (`LAMP_SPRITE`). Shapes are in §4. Sizes: 12 tab / 14 row / 18 HUD and ticket. |
| **State word** | `.k-state.<state>` | `stateWord(state, {lamp})` | Lamp + sentence-case word, tinted `onBoard`/`onPaper`. Used only where the grouping doesn't already say it (§4.2). |
| **Keycap** | `.k-key` (`.sm`) | `keycap(combo)` | Cream type-block. Letters use the sign font (O ≠ 0, I ≠ 1). Labels come from `platform.js`: `Ctrl`/`⌘`, `Alt`/`⌥`, Leader = `platform.leaderLabel`. A chord is separate caps. |
| **Legend** | `.k-legend` > `.h`, `.then` | `legend(items, {leader})` | The single key strip of a surface: `[key] verb` entries 12–16 px apart. Leader chords render as `[Ctrl `] then [Z] full · [[] history`, with the Leader shown once. |
| **Button** | `.k-btn` (`.primary`, `.nokey`) | `button(label, {key, primary, onClick})` | **Key tile on the left**, sentence case, 30 px. `primary` = clay face, ink text, clayDeep lip: **max one per surface**. Otherwise a material, never a bare keyline: a raised **board key** (painted `tabHi→tabLo` face, rim-dark 2 px lip) on the board, a **pressed tab** debossed into the stock on paper; both travel 2 px on press. Nothing else (no green or ink primaries). |
| **Icon button** | `.k-ibtn` | `iconButton(icon, {title, key})` | 26 px, 1.75 px stroke (`dom.js ICON`). The tooltip names the key. For toolbars only. |
| **Groove / stitch** | `.k-groove` / `.k-stitch` | — | The only dividers. The groove is on the board, the dashed stitch on paper. Group headers extend the groove as a leader line. |
| **Slot** | `.k-slot` | `slot({placeholder, key})` | Text input. Recessed on the board, an underline on paper. The focus ring is on the slot. |
| **Detent** | `.k-detent` > `span.on` | `detent(options, value, onChange)` | **The one tab/segment control.** Labels light up and a 3 px clay notch sits under the active one, with no filled segment. Used for group-by, inbox tabs, the help scope and the palette scope. It works on board and paper. |
| **Switch** | `.k-switch` (`.right`) | `modeSwitch({left, right, value})` | A binary mode, drawn as a **brass toggle lever** in a brass-rimmed gate (pivot dome, bat, ball knob); the bat leans toward the live label. Both labels are readable (`t3` / `t1`). The knob is brass on the left and **turns lit clay on the input-changing side** (Control). 28 px tall. Used for Peek/Control and board booleans. Never a capsule toggle. |
| **Tick** | `.k-tick` (`.on`) | `tick(label, {on})` | An on/off filter or option. On the **board**: a dark glass window in a brass bezel whose etched check **lights** warm (`butterBulb`) when on. On **paper**: a hand-drawn pencil box that gets a **clay-ink tick** overshooting its corner (same ink as Circled). Glyphs are mask tokens `--m-tick-box` / `--m-tick-mark` (kit/tokens.js). Off reads *unchecked* (empty window / empty box), not disabled; hover ghosts the mark. Never a stock white checkbox. |
| **Circled choice** | `.k-circled` > `span.on` | `circled(options, value)` | Single *value* choice on paper forms: the chosen word gets a hand-drawn clay ink ellipse. Used for settings quality and hire kind. |
| **Fader** | `.k-fader` > `b`, `i` | `fader(value, {min, max, step, format})` | A number value on paper: an oat track, a clay fill and knob, and the value in mono beside it. Arrow keys step it. Used in settings. |
| **Porthole** | `.k-port` (`.xs`, `.lg`, `.shell`) | `porthole(entity, {size})` | Live portrait atlas (ART §9.1) in a brass ring. **The inner rim is the workspace colour (`--ws`).** This replaces the workspace chip in rows, tabs and the hotbar. Sizes: 22 tab, 36 row, 56 card. |
| **Shield** | `.k-shield` | `shield(colorIndex)` | Enamel workspace crest (`crestSvg`). Used **only** in the drawer breadcrumb, a card header and the hire list. |
| **Unread bulb** | `.k-unread` | `unread(n)` | An 8 px butter bulb after the name, plus mono `n` when > 1 (`9+`). Never a status colour. |
| **Gauge** | `.k-gauge` (`.hot`) | `gauge(pct)` | Context meter: a 44 px recess, sage→butter (hot ≥ 80% = butter→busy). **In rows only when ≥ 80% or on the selected row.** Always shown in the status card and the drawer cwd line. |
| **Group header** | `.k-gh` (`.alarm`) | in `roster/view.js` | chevron · lamp · UPPERCASE sign label · mono count · groove leader. Collapsed groups show a **summary line** (`IDLE 3 · moss · ledger · quill`). `.alarm` = the blocked header in `onBoard.blocked` with a `[B] inbox` legend. |
| **Row** | `.k-row` (`.sel`) | in `roster/view.js` | See §5.2. No buttons and no boxes. Selected = 4 px clay bar + 9%→3.5% cream wash. Hover = 4% cream. Focus = 2 px `clayLight` outline, offset 2 px. These are three distinct visuals. |
| **Ledger** | `.k-ledger` (`.board`) > `li` (`.k-hl`) | `ledger(options, {selected, onPick})` | **The one prompt-options component** (roster, status card, inbox, triage). Each line is `[n] label`, 36 px on paper / 28 px on board, dashed between lines, and the label ellipsises. Destructive note: `onPaper.blocked` 11 px. `1–9` pick; Enter confirms. |
| **Question** | `.k-q` | `question(text)` | The agent's voice with a 3 px red ledger margin. Inline code in mono. |
| **Highlight** | `.k-hl` | — | Selection on paper: a clay highlighter swipe + a clay ▸ in the margin. `mark.k-match` = butter highlighter for palette match letters. |
| **Stamp** | `.k-stamp` (`.done`, `.locked`, `.ready`) | `stamp(text, {ink, time})` | A worn rubber stamp (`filter:url(#inked)` turbulence + displacement, multiply, −5°). Paper only, **max one per sheet**: `WAITING 4:12`, `SIGNED OFF`, `LOCKED`, `READY`. |
| **Ticket** | `.k-ticket` (`.done`, `.line`) | `ticket({entity, kind, headline, text, legend})` | Toast. A receipt: a perforated stub (lamp + elapsed time in status ink), then caption `No. 0412 · 14:02 · ws › tab` (mono), headline, one serif line, a dashed tear, and the legend. Zig-zag torn bottom. **No close ×** (Esc or timeout). `.line` = a one-line variant for the drawer footer. |
| **Post-it** | `.k-postit` | `postit(text, {action, key})` | Butter note: fit hint, resize notice, outbox, onboarding aside. It sits in a **strip outside the CRT** (§5.3) and never covers glyphs. |
| **Printout** | `.k-printout` | `printout(lines)` | Tractor-feed paper with sprocket holes and green-bar bands: the last 12 terminal lines in triage. |
| **Slip** | `.k-slip` | `slip({title, span, lines})` | A "While you were out" message slip: a clay-ruled band, then lines of `lamp · name · serif sentence · time`. |
| **Tally** | `.k-tally` | `tally(counts)` | The HUD strip (§5.1). |
| **Clip / deck** | `.k-clip` `.clamp` `.deck` | via `paper({clip, deck})` | A brass clamp on top of a sheet. The deck is ≤ 2 thin sheet edges below, never stacked cards. |

A `#inked` filter and the lamp `<symbol>` sprite are injected once by `injectKit()`, as a hidden `<svg>` at the root of `document.body`.

### 3.1 As built (`renderer/src/ui/kit/`)

- **Files:** `tokens.js` (CSS vars from `palette.js` `UI`, fonts, `RADIUS`/`RADIUS_PX`, the 3 noise tiles), `styles.js`
  (`KIT_CSS`, every `k-*` rule; no hex), `lamps.js` (sprite + `#inked`), `keys.js` (OS keycap labels), `dotmatrix.js`
  (`drawDots` wrapper), `index.js` (all builders + `injectKit()`), `lint.js` + `lint-allow.js` (§6 lint), `sheet.js`
  (`?sheet=ui&page=board|paper|parts[&lowq=1]`: every component in every state over the live office; shots in
  `docs/shots/ui-kit/`).
- **Wiring:** `styles.js injectStyles({quality})` calls `injectKit()` first; `ui/index.js` calls `setKeyPlatform(platform)`.
  The Low tier puts `.hq-lowq` on `<html>`.
- **Tokens added beyond §2:** `UI.onBoard.unknown` / `UI.onPaper.unknown`, and `UI.fit.*`, the fitting shades
  (gradient stops, lips, edges) the materials are drawn with. CSS names: `--b-*`, `--i-*`, `--f-*`, `--r-*`.
- **Lamp states for non-agents:** `peek` (butter, the drawer mode lamp) and `seen` (clay, onboarding progress).
- **Layout helpers** (lifted from the mockup, `k-` prefixed): `k-tabs`/`k-tab`, `k-crumb`, `k-cwd`, `k-crt`, `k-strip`,
  `k-mode` (drawer); `k-who`, `k-title`, `k-confirm`, `k-foot`, `k-specs`, `k-field` (cards/forms); `k-veil`, `k-index`,
  `k-sheets`/`k-kl` (dialogs); `k-hang` + `.rod`, `k-rail`, `k-aimtag`, `k-frame` + `k-graph`, `k-chev`, `k-hotbar` +
  `k-cubby`, `k-xhair` (HUD); `k-sp`, `k-label`, `k-voice`, `k-mono`, `k-sign`.
- **Stateful builders** return the element with a `set(...)` method (`detent`, `modeSwitch`, `tick`, `circled`,
  `fader`, `gauge`, `unread`, `printout`, `lamp`; `ledger` has `select(i)`); `readout` and `tally` return `{el, set}`.
- **Dialogs pass r1 additions:** `scrollArea({tag, cls})` → `.k-scroll` (a sheet's scrolling body: an edge with more
  past it becomes a stitch / groove and the text fades into it; `el.update()`); `::selection` = butter on paper, clay on
  the board; `.k-circled` pads for its ink ellipse; the `READY` stamp inks in done green (no blue ink on paper);
  `.k-index .top` never shrinks.
- **Lint** (`kit/kit.test.js`, part of `npm test`): `hex`, `radius` (outside `RADIUS_PX`/50 %/`var(--r-*)`), `pill`
  (`hq-*pill*`/`*chip*` classes), `blur`, `caps` (uppercase outside the kit), `dotmatrix` (outside HUD / drawer /
  triage). Un-migrated files are waived per rule in `lint-allow.js`; a waiver the file no longer needs fails the test,
  so migrators delete their line as they go. `node renderer/src/ui/kit/lint.js <file>` lists what is left.

---

## 4. Status, colour and redundancy

### 4.1 Lamps (shape carries meaning; DESIGN §8.11)

| State | Bezel | Word | Notes |
|---|---|---|---|
| blocked | **triangle**, red, "!" etched, **pulses** | Blocked | The only loop in the UI |
| working | round, blue glass | Working | |
| done | round, green, ✓ etched | Done | The `SIGNED OFF` stamp when acked (paper) |
| idle | round, unlit, dashed ring | Idle | No colour |
| unknown | round, lavender, "?" | Unknown | |
| shell | **square CRT**, green `>_` | Prompt | |
| shell busy | square CRT, amber | Running (or the verb) | |

Every lamp carries `aria-label` = its word. Readouts carry `aria-label` = their plain text.

### 4.2 Where colour may appear (exhaustive)

- **Status colour:** lamps; readouts; the HUD alarm cell; the blocked group header label and count; the row age when hot;
  the question's red margin; stamps; ticket stubs; minimap dots; `onPaper` state words.
- **Clay:** the selection bar/highlighter, the one primary button, detent notches, the Control knob, focus rings (`clayLight`),
  and the Ada plaque.
- **Workspace colour:** the porthole inner rim and the shield. Nothing else, so there are **no workspace chips**.
- **Butter:** the unread bulb, match highlighter, post-it, DEMO/history plaques, Peek lamp and warm age.
- **Brass/walnut/enamel:** fittings only, never text.

### 4.3 Say it once (the blocked budget)

For one blocked agent, a view shows at most:
- the **HUD alarm cell** (the dot-matrix count + `needs you` + `[B]`);
- the **BLOCKED group header** in the roster;
- the **drawer counter**, which counts blocked agents **other than the active tab** and is hidden at 0;
- one **ticket** when it first blocks;
- the in-world beacon/bubble/Big Board, which belong to the world.

**Removed:**
- the roster marquee and the pinned Blocked-Inbox card;
- the per-row coloured "BLOCKED" word when grouped by state;
- the drawer pill with a nested `Leader U` pill;
- the "needs you" text on done rows;
- merged-plus-single duplicate toasts.

The selected blocked row expands its options in the roster **unless that agent is the active drawer tab**, because then
the terminal itself is the answer surface.

---

## 5. Surfaces (the shape of each, as built in `final.html`)

### 5.1 HUD (`#world`)

- **Tally board.** A board strip hung on two brass rods from the top edge, centred on the *visible world strip* (between the roster and the drawer).
  - Cells: `[alarm: ▲ 2 need you [B]] · ● 3 working · ✓ 1 done · ◌ 3 idle · ▣ 2 shells`.
  - **Zero cells are hidden.** At 0 blocked, the alarm cell becomes `✓ All clear`.
  - The alarm cell is red glass with the dot-matrix digit (the tie to the Big Board). Other cells use bold system numerals.
  - Each cell is a filter button that opens the roster filtered to it.
- **Session:** a small plaque, top-left (`hqtest`, butter `Demo`, slate `default`).
- **Tools:** a small board rail of 3 icon buttons, top-right.
- **Crosshair** and a **paper aim tag** tilted −1.2°: `[E] flint answer`.
- **Minimap:** graph paper taped inside a walnut frame, with a `Lobby` small plaque on the frame and a clay player arrow. `M` opens the
  overview, which uses the same paper.
- **Chevron:** a clay arrow sign at the screen edge with a blocked lamp, name and wait time.
- **Hotbar:** 9 pigeonholes in a walnut rail. Each has a porthole with its workspace rim, a number keycap and a status lamp. The selected hole gets a clay ring.
  It is centred on the visible world strip, so it **never overlaps the drawer**.
- **Tickets** stack above the minimap (max 3, newest on top).

### 5.2 Roster (`#work`, left)

The roster is one board, 360 px wide (300 px compact). From top to bottom:

1. **Header:** the `AGENTS` plaque, then icon buttons for compact, keep open and close.
2. **Detent** for group-by: State / Space / Tab / Proj / Dir / Kind / Tool (`Alt+1..7`).
3. **Search slot** with the `/` key.
4. **Tick filters:** Blocked, Working, Done, Idle, Shells.
5. A **groove**.
6. **Groups.**
7. A **groove**.
8. **Footer:** `Sort recent ▾`, the `[N] New shell` button and `[?] keys`.

**Row:**

- **Height:** 48 px comfortable, 28 px compact.
- **Porthole:** 36 px, with the workspace rim.
- **Line 1:** the **name** (14/700), then the **unread bulb** and the **note glyph** if there is one, then `ws › tab` in `t3` (omitted when the group already says it).
- **Line 2:** `tool · detail` in mono 12 `t2`.
- **Right column:** the **age** in mono, heat-tinted `t3 → butter → onBoard.blocked`, and the **gauge**, but only at ≥ 80% or on the selected row.
  - Grouped **by state**, the row has no lamp and no state word, because the header says it. The one exception is a
    shell running a process: it shows the amber busy lamp inside the Shells group, to set it apart from a prompt.
  - Grouped by anything else, the right column shows `lamp + word`.
- **Selected row:**
  - It adds its legend (`[⏎] open [G] go [F] follow`, plus `[A] answer` / `[S] sign off` when relevant).
  - A **blocked** selected row expands full width to show the serif question and the **ledger** (`1–3` answer in place).

**Pinned** is a section with digit keycaps on the portholes.

### 5.3 Terminal drawer (`#work`, right)

- **Sheet and resize:** a board with the walnut rim on its left edge. A brass **drawer pull** is the resize handle (double-click resets to 50%).
- **Tabs** sit on a recessed rail.
  - A tab is: porthole 22 · name · 12 px lamp · unread bulb. The × shows on hover or active only.
  - The **active tab is cut from the header**: same board colour, no gap, and a clay top edge.
- **Blocked counter:** at the right of the rail, a readout `▲ 1 BLOCKED` plus `[Ctrl `][U]`. Its counting rule is in §4.3.
- **Header:**
  - The breadcrumb `shield ws › tab › pane`, with brass `›`.
  - The cwd line, with the context gauge.
  - The **Peek/Control switch**.
  - An icon toolbar: copy, history, fullscreen, `⋯`, collapse. The `⋯` menu holds Mark seen, Focus in herdr, Release, Close pane and Why?
- **CRT:** the xterm sits in a recessed glass bezel. ART §9.3 is untouched.
- **Notice strip:** lifecycle banners (busy / taken / gone / offline / error), the fit-hint **post-it**, the outbox and the Ctrl+C confirm
  share one strip **between the CRT and the footer**, one at a time. They never overlay glyphs.
- **Footer rail** (48 px): the mode lamp and word, `· type to take control`, then the legend `[Ctrl `] then [Z] full [[] history`.
- **In-drawer toasts** become a **one-line ticket** at the right end of the footer rail. They never sit on the CRT.
- **History mode:** a butter `History` plaque, top-centre of the bezel.
- **As built** (`terminal/drawer.js`, `terminal/styles.js`): so a notice never resizes the CRT (which would rescale the
  grid's font), the notice strip is the left part of the 48 px footer rail: while a post-it shows, it replaces the
  sub-line and legend (the mode lamp + word stay). The History plaque takes the mode switch's place in the header
  (nothing on the glass), and the footer legend becomes `[End] back to live [PgUp]/[PgDn] scroll`. Short confirmations
  (`Copied`, Peek hints, `Taking control…`) flash in the footer sub-line. The connecting spinner is gone (the mode word
  says `Connecting…`). A grid narrower than the glass gets a faint brass edge line (m3 reviewer idea). The ⋯ menu holds
  Mark seen, Focus in herdr, Release, Copy on select, Fit pane to drawer, Close pane… and Keys; grid size and drawn font
  size are the cwd line's tooltip.

### 5.4 Cards (`#world` status card, `#cards`)

- **Status card = a clipboard sheet**, 400 px wide, bottom-right of the visible world.
  - **Head:** porthole 56 · name (sign 22) · `shield ws › tab · tool`.
  - The state appears as either a `lamp + word` with time, or for blocked the **`WAITING 4:12` stamp**.
  - **Body when working or done:**
    - the serif title, then `tool · detail` in mono;
    - a stitch;
    - a spec list with sentence-case labels: Todo, Context (gauge), Subagents, Last prompt, Note.
  - **Body when blocked:**
    - the question (`.k-q`) and the ledger;
    - the **confirm line on the same sheet**: `Send "1. Yes" to flint?`, then a `Back` keyline button and the one primary `[⏎] Send`.
  - **Foot:** one legend.
- **Inbox (`B`):** the clipboard with the `INBOX` plaque and a paper detent `Blocked 2 · Done 1 · Triage`.
  - It shows **one question per sheet**, with 2 sheet edges below as the deck.
  - `→` moves to the next sheet.
  - The Done tab uses ledger lines with `[S] sign off` and one `[⇧S] Sign off all` button.
- **Triage:** a wide board with the `TRIAGE` plaque and a `3/7` readout.
  - On the left, a tractor-feed **printout** of the last 12 lines.
  - On the right, directly on the board: the porthole, the serif question and the board ledger.
  - One legend.
- **Away recap:** the **"While you were out" slip**, with one primary `[⏎] Open oldest blocked` and `[Esc] Dismiss`.
- **Offline:** a paper notice (lamp, text, `[R] Retry`).
- **As built (cards pass; `ui/cards.js` holds the surface CSS + two helpers):**
  - **Clickable legend** (`actLegend`): a legend entry may carry an `act`; it is then the mouse path for that verb
    (`role=button`). This is how the rule "an action is a button *or* a legend entry" keeps mouse users whole: the old
    Terminal / Answer / Talk / Go there / close buttons are gone, their legend entries click.
  - **Status card:** the head is `name` + (blocked: the stamp on the name line) and `shield ws › tab` (kind, model and
    project move to the crumb's tooltip); a non-blocked state is a third head line `lamp word time`. Spec labels as built:
    Todo, Work, Context, Subagents, You said (no Note row: the card has no note source). The struggle reason is a busy
    (level ≥ 2: blocked) state word. While blocked the sheet is title · question · ledger only (no specs, no `F`); the
    ledger click opens the **inbox's** confirm line (one confirm path, and the card collapses to its head meanwhile).
    Done: the eye icon (Mark seen in herdr) + the one primary `Sign off` (no key: `G` is the high-five).
  - **Inbox:** detent `Blocked n · Done n` (no Triage entry: `Shift+B` opens it); `1 of n` rides in the crumb; `Esc` is a
    bare keycap at the legend's end. The Done tab: ledger lines (porthole · name · task · age), `Enter` signs off the
    highlighted line, one primary `[A] Sign off all (n)` (the keymap's `A`). Empty queue: the `INBOX ZERO` done stamp.
  - **Away recap inside the inbox** is the slip's clay band + lines drawn on the inbox sheet itself (not a slip on a
    sheet: paper never sits in paper), dismissed by its `×` icon. With nobody blocked it is the standalone slip with
    `[Esc] Dismiss` (any key dismisses it anyway; the lines click through to the agent).

### 5.5 Dialogs (`#palette`, `#dialogs`)

- **Command palette = an index card** (640 px, veiled world).
  - **Top line:** a search icon, the 21 px input, a paper detent `Find · Go · Do` (scope, `Tab`), and `Esc`, all above a clay double rule.
  - **Results:** sections in `clayInk` sign caps on teal ruled lines. Matched letters get the butter highlighter.
  - Each result row is: portrait or icon · name · mono context · the state word on the right.
  - **The key hint is only on the selected row.** There is one footer legend.
- **Prompt bar (`T`):** a paper strip with a `To` small plaque, porthole and name, then the serif text on an underline and `[⏎] send`.
  Multiple targets show as portholes, not chips.
- **Hire:** a clipped work order.
  - It has the `HIRE` plaque, and the `READY` stamp on review, or `LOCKED` plus a reason when `allowMutations` is off.
  - Fields: Kind as a **circled choice**; Workspace as a ledger with shields; Task as a slot; one tick.
  - Buttons: `[Esc] Cancel` and the primary `[⏎] Hire`.
- **Settings:** a paper form with the `SETTINGS` plaque.
  - **Circled** choices for enums, clay **faders** with a mono value, **ticks** for booleans, and a slot for the Leader.
  - Sections are split by stitches.
  - Server-side items say `server · set in server config`.
- **Help / `?` keys:** a notice board (the `KEYS · WORLD` plaque, a detent for scope) holding **2–3 paper sheets side by side**.
  - Each sheet is lines of `keycaps · verb`.
  - The content is still generated from `keymap.js` + `platform.js`.
- **Onboarding:** a paper sheet with Ada's porthole, the `Ada says` clay plaque, serif body, 5 progress lamps (clay = seen),
  `[Esc] Skip tour` and the primary `[⏎] Next`.
- **Confirm dialog / context menu:** a paper sheet or dropdown, with ledger lines for the menu items and at most one primary.

---

## 6. Hierarchy and banned patterns (the review checklist)

```
World
 ├─ Board   ⊃ plaque ×1 · grooves · group headers · rows · slot · detent · switch · ticks · readouts · lamps · keys · icon buttons
 │            · paper sheets SIDE BY SIDE (help columns, triage printout) · one one-line ticket (drawer footer)
 ├─ Paper   ⊃ plaque ×1 · text · stitches · ledger · keys · lamps · stamp ×1 · highlighter · portholes · slot/ticks/circled · ONE clay button
 └─ HUD hardware (tally, rods, tool rail, minimap frame, hotbar, chevrons, crosshair + aim tag)
```

**Banned. Any of these is a review failure:**

1. **No free-floating pills.** Nothing has a 999 px radius or a tinted capsule background. Status is shown by a **lamp**, plus a
   word only when the context doesn't already say it. Counts are numerals or a readout. Filters are ticks. Modes are a
   switch. Scopes and tabs are a detent.
2. **No card inside a card.** Paper never sits in paper, and board never sits in paper. A board may hold papers side by side, but never
   stacked or nested. There is no "inner box" to group a section: use a stitch, a groove or whitespace.
3. **Max one accent per component.** Clay is only for selection and the single primary button. There are no green, ink or status-coloured
   buttons, and never two clay buttons on one surface.
4. **Status colour only where §4.2 lists it.** No tinted row backgrounds, coloured borders, or coloured state words that repeat the
   group.
5. **No boxed rows, groups or single lines.** No 1 px border around list items.
6. **No buttons in rows.** A row shows a legend on the selected row only.
7. **An action appears once:** either as a button with its key tile, or as a legend entry. Never both, and never a button that repeats a
   keycap hint beside it.
8. **One legend per surface.** The Leader is shown once. Keys are always keycaps (no `[E]` text). Key labels follow the OS (`Ctrl`/`⌘`).
9. **No ALL CAPS** outside plaques, group headers and stamps (and the dot-matrix).
10. **Dot-matrix only in the three §2.1 places.** No marquees in the UI: the Big Board owns the marquee.
11. **No workspace chips.** Workspace is shown by the porthole rim, and a shield only in breadcrumbs and card heads.
12. **No `backdrop-filter`, no neutral-black shadows, no translucency over the world** except the palette veil.
13. **Nothing over terminal glyphs.** Toasts, hints and banners go in the drawer's strips.
14. **Blocked stays within the §4.3 budget.**
15. **No hex literals in `ui/**`.** Use tokens only (`UI`, `STATUS`, `CORE`, `workspaceColor()`).
16. **Decoration budget:** at most 2 tape or pin pieces and one stamp per paper, and exactly one plaque per surface.

---

## 7. Migration map (old pattern → kit component; what to cut)

The audit IDs refer to `ui-audit.md` §1. Selectors used by `scripts/p2.mjs` and the tests (ids, `data-*`, semantic
container classes) are **kept**. The kit classes are added next to them.

### 7.1 HUD — `hud.js`, `hotbar.js`, `notify.js`, `minimap.js`, `chevrons.js`, `aim.js`, `overlays.js`

| Old | New | Cut or merge |
|---|---|---|
| Five top-centre status pills (`.hq-sum`, blur capsule) | `tally()` board strip on rods | Drop zero cells; `All clear` at 0; the blocked digit becomes the dot-matrix alarm cell |
| Tool capsule (sound, help, settings) | A small board rail of `.k-ibtn` | — |
| Session badge pill | `plaque(…, {small})` | — |
| Toast cards (dark glass, ×, icon) | `ticket()` | No ×. Merged and single toasts for the same agent collapse into one ticket. In the drawer, it becomes the `.line` ticket in the footer rail |
| Minimap and overview (hard-coded hex) | Graph paper in a walnut frame, tokens only | One paper style for both |
| Off-screen chevrons | `.k-chev` clay arrow sign | — |
| Crosshair hint `[E] …` text | Paper aim tag with a keycap | — |
| Hotbar (overlaps the drawer footer) | Pigeonholes centred on the visible world strip | Workspace shown by the porthole rim only |
| Offline banner, Leader-pending chip | Paper notice; `LEADER ▸` small plaque | — |

### 7.2 Roster — `roster/view.js`, `roster/model.js`, `names.js`, `unread.js`, `prune.js`

| Old | New | Cut or merge |
|---|---|---|
| Glass panel | `board()` with the `AGENTS` plaque | Remove the agent count badge (the tally owns counts) |
| Group-by segmented pills | `detent()` | — |
| State filter chips + "Shells" toggle | `tick()` ×5 | — |
| **Pinned Blocked-Inbox card** | **Deleted.** The `BLOCKED` group header with a `[B] inbox` legend; the selected blocked row expands | This is the audit's four-level nest |
| Workspace chip on rows | Porthole rim | Chip removed; `ws › tab` stays as `t3` text only when not grouped by space or tab |
| State chip + elapsed chip | Age in mono (heat-tinted); `lamp + word` only when not grouped by state | Per-row coloured state words removed |
| Row buttons `>_ ⌖ ◉ ✓ ↩` | Selected-row legend | Every row button removed |
| Context meter on every row | Gauge at ≥ 80% or on the selected row | — |
| Option buttons inside the inbox card | `ledger({board:true})` in the expanded selected row | — |
| "3 changes" pill | A `k-btn` "3 changes" (no key) | — |
| Collapsed group | Summary line `IDLE 3 · moss · ledger · quill` | — |
| "needs you" on done rows | Removed | — |

### 7.3 Drawer — `terminal/drawer.js`, `terminal/tabs.js`, `terminal/view.js`, `terminal/lifecycle.js`, `terminal/fit.js`

| Old | New | Cut or merge |
|---|---|---|
| Tab chips with a state dot | Tab: porthole · name · lamp · unread; × only when hovered or active | The active tab is joined to the header |
| `● 2 blocked · Leader B` pill containing a keycap pill | Readout `▲ n BLOCKED` + `[Ctrl `][U]` | Counts other tabs only; hidden at 0 |
| Mode badge Peek/Control | `modeSwitch()` | — |
| `◆ in herdr` badge | Brass `◆` + text in the cwd line | — |
| 6 header buttons | 4 icon buttons + `⋯` menu (paper dropdown, ledger lines) | Mark seen, Focus, Release, Close pane and Why? move into `⋯` |
| Fit hint / outbox / Ctrl+C confirm / banners floating over xterm | One **notice strip** between the CRT and the footer (post-it or paper) | Never over glyphs |
| Toasts inside the drawer (over xterm) | `.line` ticket in the footer rail | — |
| Footer text + multiple key notations | Mode lamp + one `legend()` with the Leader shown once | `? keys` lives in the `?` overlay |
| xterm theme / font / fit | **Unchanged** (ART §9.3) | — |

### 7.4 Cards — `statusCard.js`, `cardModel.js`, `inbox.js`, `serveModel.js`, `triage.js`, `recap.js`, `away.js`

| Old | New | Cut or merge |
|---|---|---|
| Status card (dark or paper, chips) | Clipped paper sheet | State chip becomes lamp + word, or the `WAITING` stamp; the workspace chip becomes a shield |
| Blocked options: 4 different renderings | `ledger()` everywhere | — |
| Ink confirm bar inside the paper card | A confirm line on the same sheet + one primary | Nested bar removed |
| Sign off: clay in the card, green in the inbox | One `[G]`/`[S]` legend entry, or `[⏎] Sign off` primary where it is *the* action | No green buttons |
| Serve stack (stacked cards) | One sheet + 2 deck edges | — |
| Inbox tab pills (Blocked / Done / Triage) | Paper `detent()` | — |
| Triage "last lines" dark box inside a card | `printout()` on a board | — |
| Away recap card | `slip()` | — |

### 7.5 Dialogs — `cmdk.js`, `paletteRank.js`, `promptBar.js`, `hireDialog.js`, `help.js`, `onboarding.js`, `settings.js`

| Old | New | Cut or merge |
|---|---|---|
| Palette paper card with hints on every row | Index card; hints on the selected row only; butter match marks; scope detent | "needs you" on done agents removed (the ranking is unchanged) |
| Prompt bar with target chips | Paper strip, `To` plaque, porthole targets | — |
| Hire dialog segmented pills + review card | Clipped work order, circled kind, ledger workspaces, `READY`/`LOCKED` stamp | Review happens on the same sheet |
| Help / keys overlay | A board holding paper columns, with a scope detent | — |
| Onboarding with an ink "Next ›" | Paper + `Ada says` clay plaque + progress lamps + one clay primary | Ink primary removed |
| Settings toggles and segmented pills | Paper form: circled choices, ticks, faders, slot | — |
| Rename / confirm / context menu | Paper sheet or dropdown with ledger lines | — |

---

## 8. Usability, accessibility and performance

- **Unchanged:** P2 (≤ 2 inputs to any terminal), scopes, focus order, ARIA roles and levels (DESIGN §8.2, §8.7, §8.11).
- Contrast is ≥ 4.5:1 for all text ≤ 14 px (tokens in §2). The shape plus word/label rule means state never depends on colour.
- **Keycap letters** use the sign font, so O/0 and I/1 are distinct. Symbol caps (`⏎ ↑ ↓ / [`) may use mono.
- **Serif is never used for** paths, names, keys or anything the user scans in bulk.
- **Performance:**
  - No backdrop-filter.
  - 3 noise tiles, rasterised once and dropped on Low.
  - Lamps are `<use>` of 7 symbols. Drop-shadow glows are limited to lamps (≤ ~30 small SVGs). Only blocked lamps animate, and only opacity and filter.
  - Readouts redraw on text change only (≤ 10 Hz UI tick), each ≤ 200×20 px at DPR 2.
  - The `#inked` filter applies to ≤ 3 stamps on screen.

## 9. Implementation order (for the per-surface owners)

1. **Kit lead:**
   - Add `UI` to `shared/palette.js`.
   - Create `ui/kit/` (`styles.js`, `lamps.js`, `dotmatrix.js` wrapping `drawDots`, `keys.js` using `platform.js`, and `index.js` with the builders in §3).
   - Hook `injectKit()` into `injectStyles()`.
   - Delete `--panel`, the blur rules, every 999 px radius and the `.chip`/`.pill` rules from `styles.js`/`styles35.js` as surfaces migrate.
2. **Surface owners** migrate independently using §7, and review against §6.
3. **After each surface:** run `npm test` and `node scripts/p2.mjs`, then take a GPU shot of the surface next to `docs/shots/ui-lab/final-*.png`.
4. If a surface needs a component this file doesn't define, **add it here and to `final.html` first**. Do not invent it locally.

### As built (integration pass)
- `kit/lint-allow.js` is **empty**: every file under `renderer/src/ui/**` passes all rules. The portrait inks moved from `ui/dom.js` to `PORTRAIT` in `shared/palette.js`.
- The deprecated generic classes (`hq-panel`, `hq-kbd`, `hq-btn`, `hq-ibtn`, `hq-chip`, `hq-dot`, `hq-ws`, `hq-seg`, `hq-fchip`, `hq-pill`) are deleted. `kit.test.js` now fails if any file references one. `styles35.js` is gone.
- New lint rule `type`: a CSS font size outside `TYPE_SCALE` (§2.1) outside the kit.
- Keycaps: a lone `/` is a cap (it's a separator only inside a key array). The symbol caps ⏎ ⇧ ⌫ ← → ↑ ↓ are drawn as SVG masks (`.k-key.glyph.g-*`) because fallback mono fonts draw those glyphs tiny. The cap keeps its text for screen readers and tests.
- `.k-legend` on graph paper (`.k-graph`, the office map) uses the paper inks.
- Shots of every surface: `docs/shots/ui-final/`.
