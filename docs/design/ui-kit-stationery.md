# UI kit direction: "Diorama Stationery"

Status: direction proposal (UI kit pass). Mockup: `renderer/ui-lab/stationery.html` (`?v=all|world|work|palette|sheet`).
Shots: `docs/shots/ui-lab/stationery-{all,world,work,palette,sheet}.png`. Amends DESIGN §8 / ART §9.1 visual language
only; behaviour, keymap, ARIA and P2 rules in DESIGN §8 are unchanged.

## 1. The idea

The 2D UI is made of the **paper goods of this office**. It's the same stuff you see on the Help Desk and the desks in
3D: tickets from the Help Desk dispenser, index cards, a clipboard, manila folders, sticky notes, a rubber stamp,
Dymo tape, a floor plan taped to the wall. Every surface is a real object with one job, drawn in the palette of the
world (cream paper, ink, clay, manila, teal ruling). Nothing is a generic rounded dark card.

**Principles**

1. **One object = one surface.** Each UI surface is a named paper object (table in §4). Inside it we use only
   *printed marks*: rules, ink text, keycaps, tick boxes, a margin mark, at most one stamp. No boxes inside boxes.
2. **Status is written in the margin, not pilled.** Each row has one status **margin mark** (shape + ink colour).
   Only *blocked* gets a loud treatment: the red rubber stamp. The status word shows up as plain coloured text where a
   sentence needs it ("working · 3m").
3. **Colour has a job, or it isn't used.** Clay = HQ's hand (selection, primary action, margin line). Status colours =
   status only. Workspace jewels = workspace identity only. Butter = highlighter and notes. Teal = ruling lines. No
   other accents.
4. **Paper for reading, ink for machines.** Lists, cards and dialogs are paper (light, opaque, high contrast over any 3D
   lighting, day or night). Terminals and screens are ink. The drawer is a walnut desk edge holding a screen.
5. **Keyboard first, printed on the object.** Every actionable line shows its key as a printed keycap. Legends sit at
   the foot of each object like the fine print on a form.
6. **Quiet until it matters.** Nothing animates except blocked (the stamp lands with a 120 ms "thunk", the ticket-stub
   count pulses once, the flag slides in). There is no idle shimmer.

## 2. Tokens

### 2.1 Type (system fonts only; no network, no bundled files)

| Role | Stack | Use |
|---|---|---|
| **Label** (printed caps) | `"Avenir Next Condensed","Bahnschrift","DIN Condensed","Roboto Condensed","Ubuntu Condensed","Arial Narrow","DejaVu Sans Condensed",sans-serif` + `font-stretch:condensed`, 700–800, `letter-spacing .12–.14em`, uppercase | Object titles (AGENTS, NEW HIRE), folder tabs, form labels, stamp, breadcrumb. Never for sentences. |
| **Sans** (UI voice) | `system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,Cantarell,"DejaVu Sans",sans-serif` | Names (750), buttons (700), option text, legends. |
| **Serif** (the agent's words) | `"Iowan Old Style","Charter","Bitstream Charter",Georgia,"DejaVu Serif",serif` | Anything an agent *said or is doing*: blocked questions, task titles, recap sentences. Italic in dense rows. This is how you tell "HQ talking" from "agent talking" at a glance. |
| **Mono** (machine data) | existing `MONO` in `styles.js` | Paths, tool · detail, times, counts, keycaps, typed input (the typewriter line), terminal. |

Scale (px/line-height): 22/1 object title · 19/1 card name · 17.5/26 card question (serif, sits on the 26 px ruling) ·
15/1.3 toast question · 14 names · 13 body/serif row text · 12.5 buttons · 11.5 meta/mono · 10–11 labels (caps).
Minimum 11 px anywhere except map captions (9.5 px caps, decorative).

### 2.2 Palette (all from `shared/palette.js`; new names are mixes of existing tokens)

| Token | Value | Role |
|---|---|---|
| `paper` | `#FBF8F3` | sheet surface (roster, cards, palette, dialogs) |
| `cream` | `#F4EDE3` | card stock (footers, stacked cards underneath) |
| `oat` | `#E4D9C8` | back-of-stack card, inactive index tabs |
| `manila` | `#E8D3A6` (oat + butter) | folder tabs, tag labels, tools tab |
| `manilaDeep` | `#D8BF8A` | inactive drawer tabs |
| `ink` / `ink2` / `slate` | `#1F1E1D` / `#3A3733` / `#6B6760` | text 1 / rules, icons / text 2 (5.3:1 on paper) |
| `screen` | `#1A1917` | terminal and CRT (xterm theme ART §9.3 unchanged) |
| board | `oak`→`walnut` gradient | clipboard, drawer desk edge, sheet-view desk |
| `clay` / `clayDeep` / `clayInk` | `#D97757` / `#B8593B` / `#A34A2E` | primary button, selection bar, margin line (50%), caret, "circled" pen stroke |
| `rule` | `teal` at 30% | index-card ruling, row separators |
| `hl` | `butter` at 50% | highlighter: selection wash, active filter underline, match highlight |
| status **bright** | working `#4FA3E8` · blocked `#EF5A4C` · done `#63C48A` · idle `#B3AA9D` · unknown `#A98BE0` · shell `#7FE3A0` | on ink surfaces, map dots, the blocked flag/stub fill |
| status **ink** (new, for text on paper; ≥ 4.5:1 on `paper` and `cream`) | working `#2C6DAA` · blocked `#B8332A` · done `#2A7A4C` · idle `#6F6659` · unknown `#7454B8` · shell `#1E7A5A` | margin marks, stamp, status words on paper |
| workspace jewels | DESIGN §5.5 | only as a 3 × 11 px **signal bar** before the workspace name, folder-tab signal clip, portrait accessory |

On-ink text: `#F4EDE3` / `#B7AEA2` / `#8A8278` (unchanged).

### 2.3 Spacing, edges, radii

- 4 px grid; object padding 14–20 px; row height 54 px comfortable / 28 px compact; ruling pitch 26 px on cards.
- **Radii are physical:** paper 2 px; keycaps and buttons 3 px; index/folder tabs 5 px top corners only; clipboard
  board 12 px; laminated card 6 px; circles only for dots, pins and the unread counter. **No 999 px pills anywhere.**
- Edges: paper gets `inset 0 0 0 1px ink/7%` + `inset 0 1px 0 white/70%` (cut edge). Section breaks are **rules**,
  never boxes: 1.5 px `ink2` (form section), 1 px `rule` (rows), 1.5 px dashed ink/25% (tear line before a footer).

### 2.4 Depth (three levels only)

| Level | Shadow | Used by |
|---|---|---|
| flat (lying on something) | `0 1px 0 ink/14%, 0 1px 3px ink/16%` | tools tab, stacked cards underneath |
| card (lying on the world) | `0 1px 1px ink/22%, 0 6px 12px -4px ink/32%, 0 20px 34px -18px ink/55%` | roster sheet, toasts, minimap, forms |
| held (in your hand, modal-ish) | `0 2px 2px, 0 14px 24px -8px, 0 40px 60px -30px` | status card, palette, prompt bar |

Shaped objects (tickets, receipts, flags, tags) use `filter: drop-shadow` so the shadow follows the cut. Everything
else uses `box-shadow` (cheaper). No `backdrop-filter` blur: paper is opaque, so it costs nothing and reads at night.

### 2.5 Textures (generated at runtime)

- **Grain:** inline SVG `feTurbulence` (fractalNoise .85, 3 octaves, alpha 9%) as a CSS data-URI background layer on
  every paper surface. **Fibre:** stretched turbulence (.012 × .25) on wood boards.
- **Ruling:** `repeating-linear-gradient` teal lines (26 px) under a clay header line at the top of index cards.
- **Perforations/tears:** radial-gradient masks (ticket notches), `conic-gradient` mask for the receipt's zig-zag
  tear, dotted radial gradient for perforation lines, sprocket holes on the triage printout.
- **Stamp ink:** one inline SVG filter `#inked` (turbulence alpha threshold + 1.6 px displacement) plus
  `mix-blend-mode: multiply`. Injected once into the UI root. Grain SVGs are data URIs built in `styles.js`.

## 3. Components

| Component | Look | Rules |
|---|---|---|
| **Margin mark** | 14 px glyph in the row's left margin (left of the clay margin line): working ● filled · blocked ▲ · done ✓ · idle ◌ ring · unknown ? · shell `>_` on a tiny ink CRT tile. Ink variants on paper, bright on ink. | The one status indicator per row/tab/result. `aria-label` = state word (DESIGN §8.11 shapes kept). |
| **Stamp** | Label caps + mono time in a 2 px `blockedInk` border, radius 3, rotated −3°, worn ink filter. Big (17 px) on cards, small (10.5 px, time only) in rows. | **Blocked only.** One per row/card/toast. Lands with a 120 ms scale 1.15→1 (none with reduced motion). |
| **Keycap** | Mono 10.5 px in a 3 px-radius printed key: paper cap with ink outline + 2 px bottom (on paper), dark cap (on ink). | Always paired with a verb ("`G` go"). Never a standalone decoration. |
| **Legend** | A row of keycap + verb pairs in slate 11.5 px at the foot of an object. | One legend per object, at the bottom. |
| **Buttons** | *Primary:* clay fill, `clayDeep` 1.5 px edge + 2 px bottom lip, ink label, optional keycap. *Secondary:* 1.5 px ink outline, transparent. *Ink:* ink fill, paper label (sticky-note context). *Tertiary:* underlined link. *Icon:* 28 px, 1.75 px stroke, no fill until hover (4% ink). | **Max one primary per object.** Buttons live only in an object's action line or foot, never inside list rows (rows show key legends instead). |
| **Tick box** | 12 px square, 1.4 px ink2 border, ink ✓ when on. | All boolean toggles and filters (roster "Show", settings, hire options). |
| **Circled option** | Set members as plain text; the chosen one is circled by a hand-drawn clay pen ellipse (SVG, non-scaling stroke). | All single-choice sets: group-by, quality, hire kind, inbox tab when inline. Replaces segmented pills. |
| **Fill-in line** | Label caps on the left, mono input on a 1.5 px ink underline, clay caret, keycap hint on the right. | All text inputs (roster find, palette, hire, notes, T prompt). No input boxes. |
| **Ruler slider** | Printed ruler ticks (10% + 2%) with a clay pointer. | All numeric settings; the context meter uses the same ruler, thin. |
| **Folder tab header** | Manila tab (label caps + count + ▾/▸) on a 3 px manila folder edge that spans the list. Workspace grouping adds a jewel signal clip on the tab. "Needs you" folder is pink-tinted with a blocked edge. | Group headers only. Collapsed = tab + a one-line summary of names. |
| **Selection** | Clay 5 px bar *on the margin line* + butter highlighter wash from the margin to the edge. | Hover = 4% ink. Focus = 2 px ink outline, 2 px offset. Three distinct looks (DESIGN §8.11). |
| **Workspace label** | Mono 11 px slate name preceded by a 3 × 11 px jewel signal bar. | Not a chip. Never tinted text. |
| **Unread** | Clay disc 15 px with ink mono count (`9+` cap); on drawer tabs a 7 px clay dot. | The only filled circle besides status dots. |
| **Portrait photo** | Live portrait in a 2 px paper photo border with a small shadow; 36 px rows, 44 px cards, 20 px tabs. | Always the RenderTarget atlas in-app; the mockup draws SVG stand-ins. |
| **Dymo tape** | Embossed mono caps on ink2 tape (or `clayDeep` for CONTROL). | System identity only: session badge, terminal mode (PEEK / CONTROL). |
| **Masking tape / pin** | Translucent tape strips; clay push-pin. | Attaches free-floating objects to the world (minimap, onboarding note, history label). Decoration budget: ≤ 2 per object. |

## 4. Surfaces

### HUD (`hud.js`, `hotbar.js`, `notify.js`, `minimap.js`, `chevrons.js`, `aim.js`, `overlays.js`)
- **Status counts = "Now serving" ticket** (top centre of the free world area). The left **stub** is the Big Board's
  voice: `▲ 2 NEED YOU` in blocked ink (click/`B` = inbox); at zero it reads `✓ ALL CLEAR` in done ink. Perforation,
  then the body: `● 4 working ✓ 1 done ◌ 3 idle >_ 2 shells` as one line of tallies (click = filter; an active filter
  gets a highlighter underline). Narrow widths drop the words, then the idle/shell tallies.
- **Tools** (sound, keys, settings): icon buttons on a manila tab hanging from the top edge. When the drawer is open
  they move to the right end of the drawer's tab strip.
- **Session badge:** Dymo tape top-left. With the roster open it's stuck on the clipboard board.
- **Crosshair:** unchanged 6 px dot. On an interactable: ring + a manila **luggage tag** on a string: `E open flint`.
- **Toasts = receipts** from the Help Desk printer: ticket number and time in label caps, name + workspace, the
  question in serif, the blocked stamp top-right, a dashed tear line, then the legend (`B inbox`, `↵ open terminal`).
  Zig-zag torn bottom. They stack above the minimap, or inside the drawer layer when the drawer is focused (§8).
- **Minimap = floor plan on graph paper**, taped to the screen corner (tilted −0.6°). Ink walls, label-caps room
  names, status dots with ink rings; blocked dots get a pulsing ring.
- **Off-screen chevrons = red "sign here" flags** at the edge: `▲ moss 18 m`, pointing off-screen.
- **Hotbar = ID badges on a rail:** 52 px paper badges with a clip, photo, margin mark + name, and a digit keycap in
  the corner. Selected badge lifts 6 px with a clay outline.
- **Overlays** (offline, photo mode captions): a **hanging paper sign**, "BACK SOON · herdr is offline", `Retry R`.

### Roster (`roster/**`, `names.js`, `unread.js`, `prune.js`) = a clipboard
- Wooden board, metal clip, one paper sheet. Board top carries the session Dymo (left) and compact / pin / close
  icons (right).
- Sheet head: `AGENTS` (label 22) + `12 on staff` (mono) + `Tab` keycap. Then a small form: **By** (circled option:
  State Space Tab Proj Dir Kind Tool, `Alt+1..7`), **Find** (fill-in line, `/`), **Show** (tick boxes: blocked,
  working, done, idle, shells). `+ Shell` is a secondary button in the foot when mutations are allowed.
- List: a clay double **margin line** runs down the sheet; margin marks sit left of it. Rows: mark · photo · name
  (sans 750) + pin keycap if pinned + workspace label · second line = serif question/task or mono `tool · detail` ·
  right column = elapsed (mono; a stamp with the time when blocked) and unread disc. Age heat = the elapsed text
  shifts slate → clayInk → blockedInk; no background tint.
- **Selected row** expands in place: highlighter + clay bar; blocked rows list their options as `1 Yes / 2 … / 3 …`
  keycap lines; then the action legend `↵ open  G go  F follow  P pin  S sign off`. No buttons in rows.
- **Blocked Inbox in the roster is the "Needs you" folder**, not a card inside the sheet.
- Compact mode: 28 px rows, photo hidden, second line hidden; the margin mark and stamp stay.
- Foot: `sort needs you ▾` (link) + legend.

### Drawer chrome (`terminal/**`; the xterm and its theme stay as they are)
- The drawer is a walnut **desk edge** holding a **screen**. Tabs are **manila folder tabs** along the top: photo,
  margin mark, name, unread dot, `×`. The active tab is paper and joins the **case label** header below it; inactive
  tabs are `manilaDeep`, recessed. The blocked tab's mark pulses (the only tab animation).
- Case label (paper strip): breadcrumb in label caps `HQ-CORE › CLAUDE › FLINT`, cwd in mono below. Right side:
  **blocked counter = red sign-here flag** `▲ 2 blocked ⌃B` (hidden at 0, click = next blocked), **mode Dymo** `PEEK`
  (ink) / `CONTROL` (clay), `◆ in herdr` as a small ink diamond + text, then icon buttons (focus in herdr, recent HQ
  actions, copy recent, fullscreen, collapse). Destructive actions (close pane) live in the `…` menu, confirm-gated.
- Screen: `screen` inset 10 px from the desk edges, inner top shadow cast by the case label. No other decoration.
- **Fit hint / resize notices = butter post-it** stuck on the screen corner, with an underlined action link.
- **History overlay:** a masking-tape strip across the top of the screen: `HISTORY · READ-ONLY  End Esc or type to
  return`.
- Footer on the desk edge (on-ink text): mode sentence with keycaps (`Peek · type or Leader I to take control`),
  mono grid/font readout, tick box `copy on select`, `?` keycap.
- Toasts in the drawer layer: the same receipt, top-right of the screen.

### Cards (`statusCard.js`, `cardModel.js`, `inbox.js`, `serveModel.js`, `triage.js`, `recap.js`, `away.js`)
- **Status card = index card** (clay header line, teal ruling). Header: tilted photo, name (label 19), `kind ·
  model`, workspace label; the stamp on the right when blocked. Body on the ruling: question in serif 17.5/26, options
  as keycap lines (`1 Yes`), the chosen one with a highlighter and a ✓ in the margin, then the confirm line
  (`Send answer 2 ↵` primary + `Esc cancel`). Non-blocked cards show the title (serif), `tool: detail` (mono), todos
  as tick boxes (top 3), last prompt (serif, 2 lines). Context = thin ruler meter. Foot on card stock: legend
  `E terminal  G go  F follow  N note`. Sticky note = a butter post-it overlapping the card's top-right corner.
- **Blocked Inbox / Serve = a stack of index cards.** Two cards visibly underneath show depth; label-caps **index
  tabs** on top: `BLOCKED 1/3 · DONE 4 · TRIAGE`. The Serve card is the status card plus `O Open terminal` / `G Go
  there` lines under a dashed rule. Auto-advance = the top card slides off left (180 ms).
- **Done tab:** a ledger of rows with ✓ marks, `S sign off` legend and one primary `Sign off all`.
- **Triage = tractor-feed printout** (green-bar paper, sprocket holes, dotted tear lines) with the last 12 screen
  lines in mono, above the one-key legend (`Alt 1 answer  O open  S sign off  → skip`).
- **Away recap = "While you were out" message slip:** rose header band with label-caps title and the time span, then
  labelled lines (FINISHED / STUCK / NEW) with margin marks and serif summaries, `Dismiss` + `Serve 1 B`.

### Dialogs (`cmdk.js`, `paletteRank.js`, `promptBar.js`, `hireDialog.js`, `help.js`, `onboarding.js`, `settings.js`)
- **Command palette = a catalogue card** (held depth, 640 px, 38% ink scrim). An index tab on top shows `Ctrl K ·
  FIND · GO · DO`. The query is a big typewriter line (mono 22) over a clay rule. Results sit on teal ruling with a
  margin line: mark/icon, name (sans 750, matched letters highlighted), workspace label, serif description, and a
  right-hand mono hint (`↵ open  Alt ↵ go`). Sections are label-caps headings (AGENTS, PLACES, ACTIONS). Legend on
  card stock at the foot.
- **T prompt bar = memo pad** docked bottom-centre: clay top binding, `TO` label, margin line, recipient (mark +
  name), mono fill-in line, `↵ send  Esc`.
- **Hire / + Shell = requisition form** "NEW HIRE · form HQ-7": circled-option Kind, fill-in lines for Name,
  Workspace (▾), Directory; tick-box options; `Cancel Esc` + `Hire quill ↵` primary.
- **Help / `?` = laminated quick-reference card** (6 px radius, gloss sweep): scope title, two columns of keycap +
  verb on ruling, label-caps group headings (e.g. `IN A TERMINAL · LEADER = CTRL+\`). Generated from `keymap.js` as
  before.
- **Onboarding = Ada's sticky notes**, pinned with a clay push-pin, −1° tilt, label-caps title, progress dots,
  `skip` link + ink `Next ↵` button.
- **Settings = form on the clipboard**: sections with label-caps names, circled options (quality), ruler sliders
  (volume, FOV, term font), tick boxes (behaviour). Saves live, with `saved` in mono top-right.

## 5. Hierarchy rules (what never nests in what)

1. **World → object → printed marks.** An object (sheet, card, ticket, dialog) may contain rules, text, marks,
   keycaps, tick boxes, the fill-in line, one stamp, and its action line/foot. It **never contains another bordered or
   shadowed box.** Exceptions that are physical attachments sitting *on top*, never inside: a post-it on a card or
   screen, a photo, tape, a pin.
2. **Rows never contain buttons.** Rows show key legends. Actions appear on the selected row as legend text; buttons
   live in the object's action line or foot.
3. **One stamp per row, card or toast, and only for blocked.** One primary button per object. One legend per object.
4. **Status is shown once per row:** the margin mark. The word appears only in running text or `aria-label`. Never
   mark + chip + coloured name together.
5. **Sections are rules or folder tabs, not cards.** The roster's Blocked Inbox is a folder; the palette's groups are
   headings; the status card's footer is a tear line + card stock.
6. **Colour ownership** (§1.3) is enforced in review: any new hex outside §2.2 fails.
7. **Depth is at most three levels** (flat, card, held), and only one "held" object is on screen at a time: the
   palette, the status card or a dialog.
8. **Decoration budget:** tilt ≤ 1° (notes, minimap, photos only; stamp −3°), ≤ 2 tape/pin attachments per object,
   no decoration on anything that scrolls.

## 6. Usability guardrails

- Contrast: all text ≥ 4.5:1 (ink variants exist for exactly this); paper is opaque, so it never depends on the 3D
  frame behind it.
- Keyboard: every surface's keys are printed on it; `Tab → Enter` and palette paths (P2) are unchanged; focus ring
  is always the 2 px ink outline.
- Terminal: the xterm theme, font and letterboxing are untouched. The chrome only frames it, and the only thing laid
  over the screen is a post-it that can be dismissed.
- Perf: static gradients plus two shared SVG data URIs; `drop-shadow` only on ≤ 6 shaped elements at a time; no
  backdrop blur. Grain can switch off on the Low tier.
- Reduced motion: the stamp doesn't land, flags don't slide, and the tilts stay (they're static).

## 7. Implementation notes (for the UI pass)

- `styles.js` gains the tokens in §2 as CSS custom properties, the `--grain`/`--fibre` data URIs and the `#inked`
  filter (injected once). Component classes map 1:1 to §3: `.mk .stamp .key .legend .btn .tick .opt .find .ruler
  .folder .row .dymo .receipt .ticket .flag .idx .memopad`.
- Replace `.hq-pill`, `.hq-chip` and `.hq-sum .sg` usage with `.mk` + text; replace `.hq-panel` (dark 14 px card) with
  the object classes. `.hq-ws` becomes the signal-bar workspace label.
- Everything in the mockup is plain HTML/CSS plus a tiny script (portrait SVG stand-ins, list data). No external
  assets; fonts resolve to DejaVu on this machine and to Avenir Next Condensed / Bahnschrift / Charter where available.
