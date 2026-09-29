# UI audit: AI-slop inventory (pre UI-kit pass)

Auditor pass, 2026-09-28. Scope: every DOM surface in `renderer/src/ui/**` (source unchanged). The target is DESIGN §8 and
art-direction §9: one coherent kit that belongs to the clay diorama (painted wood, enamel plaques, cream paper, felt,
CRT, clay terracotta, ink), keyboard-first, with a clean xterm.

Screenshots: `docs/shots/ui-audit/`. The prefix gives the state. `mixed-*` is the demo `mixed` scenario at 1600×900.
`queue-*` is `queue` (4 blocked + 2 shells). `narrow-*` is `mixed` at 1280×720. The harness is a scratch driver built on
`scripts/dev.mjs` and `scripts/shoot.mjs` (ports 7600–7605). It opens each surface through `__hq` / `__hqUi`.
Numbers use the same scheme across prefixes:

| # | surface / state | # | surface / state |
|---|---|---|---|
| 00/01 | world HUD, pit pose | 19 | help |
| 02-* | roster ×7 group-bys (state, workspace, tab, project, directory, kind, tool) | 20 | keys overlay (`?`) |
| 03 | roster search | 21 | onboarding tour card |
| 04-* | status card: working / blocked / done / idle / shell | 22 | settings |
| 05/06/07 | drawer 1 tab / 5 tabs / blocked tab active | 23/35 | toasts (blocked burst, done, info, warn) |
| 08 | drawer + roster | 24 | hotbar (5 pins) |
| 09 | drawer, all tabs closed | 25 | map overview (M) |
| 10/11/32 | inbox blocked / done / confirm | 26 | away recap + inbox |
| 12 | triage | 28 | rename |
| 13/14/30 | prompt bar / on blocked (→ inbox) / confirm | 29 | drawer fullscreen |
| 15/16/31 | hire claude / shell / review | 33 | drawer toasts |
| 17/18 | palette / with query | 34 | drawer collapsed rail |
| 36 | aim hint + status card via aim | 37 | terminal context menu |
| 38 | roster + drawer + hotbar collision | | |

---

## 0. Global findings (the root causes)

Measured in `styles.js` + `styles35.js` (875 lines of CSS-in-JS):

- **27 distinct `border-radius` values**: 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 999px, 50%, plus
  7 asymmetric variants. ART §9.1 specifies one panel radius (14px). Nothing sets the rule for inner elements, so every
  surface picked its own.
- **19 font sizes** (9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 18, 19, 24, 30px) and **8
  weights** (400, 500, 550, 600, 650, 700, 750, 800). There is no type scale. Half-pixel sizes are a sign of per-surface
  tuning.
- **70 distinct hex colours + 69 distinct rgba()** in the stylesheet. There are also hard-coded colours in JS: the
  `#F1C66E` warn colour in `hud.js:224`, the minimap palette in `minimap.js`, the menu hover in `overlays.js:103`, and
  `#8A8278` fallbacks in `terminal/drawer.js`. Only about 20 of these are the §2 palette tokens.
- **43 distinct `box-shadow` declarations.**
- **Two surface languages with no rule for which one applies.**
  - Dark "ink glass" (`.hq-panel`, blur, 14px): roster, status card, drawer, toasts, prompt bar, hire, triage, help,
    keys, settings, hotbar, minimap.
  - Cream "paper" (16px, drop shadow): palette, inbox, onboarding, map overview, confirm.
  - ART §9.1 says paper is "the one light-surface moment" (the palette). It has spread to 5 surfaces while the dark
    surfaces still use it too.
  - Neither language looks like the world. There is no wood, enamel, felt or plaque. They are generic glassmorphism
    cards and a generic light card. Compare the in-world signage in `mixed-00`: the HELP DESK plaque, the ARRIVALS
    enamel sign, the Big Board marquee, and the cream speech bubbles with a clay outline. The in-world bubbles are the
    most on-brand "UI" in the product. The DOM UI shares nothing with them.
- **Three primary-button colours.**
  - Clay (`.hq-btn.primary`: Answer…, Sign off, Review…, Hire, Send, All keys).
  - Green (inbox Done tab: "✓ Sign off", "Sign off all (3)", `mixed-11`).
  - Ink-black ("Next ›" in onboarding, `mixed-21`).
  - The same action ("Sign off") is clay in the status card (`mixed-04-status-done`) and green in the inbox
    (`mixed-11`).
- **One prompt-options list, four renderings.** Claude's permission options (1 Yes / 2 … / 3 No) are drawn differently in
  each place:
  - roster Blocked-Inbox card: dark pills holding kbd chips (`mixed-02-roster-state`);
  - status card: dark rows in a red sub-card (`mixed-04-status-blocked`);
  - inbox: paper rows, a filled clay kbd and a "REFUSES" micro-badge (`mixed-10`);
  - triage: dark bars (`mixed-12`).
  - Option 3 ("No…") is red in all four: a dashed red outline in three, red text in the inbox.
- **Status is shown as a tinted capsule everywhere.** The `● working`, `▲ blocked`, `✓ done`, `◌ idle`, `? unknown`,
  `>_ serve` pill is repeated in the HUD, roster rows, status card, palette rows, prompt bar, triage and the help legend.
  Its glyphs are Unicode (`◌ ○ ? >_ ▲`), which breaks the §9.1 rule of 1.75px-stroke SVG icons and no glyph dependence.
  It reads as an isolated pill next to a name, not as part of the row.
- **Nesting depth.** Cards sit in cards, and pills sit in pills in cards:
  - roster panel › Blocked-Inbox red card › option pill › kbd chip (4 levels, `mixed-02-*`);
  - drawer header › red "1 blocked" pill › "Leader U" kbd pill (`mixed-05..08`);
  - status card › red question sub-card › option row › kbd box (`mixed-04-status-blocked`);
  - inbox paper card › dashed question box and beige option boxes › clay kbd (`mixed-10`);
  - prompt bar › clay-outlined confirm box › kbd chips + Back + Send (`mixed-30`);
  - hire modal › review sub-card › kbd chips (`mixed-31`);
  - help modal › 5 step cards › numbered clay circles › inline kbd chips (`mixed-19`);
  - triage card › black xterm snapshot box (`mixed-12`).
- **Kbd soup.** Keycap chips appear in nearly every surface, often twice: once on or next to the button and again in a
  footer legend. Examples:
  - status card: `Terminal` / `Talk` buttons, then `E terminal · T talk · G go there · F follow`;
  - inbox: `Open terminal ↗ [O]` / `Go there [G]`, then a footer `O terminal · G go there`.
  - Four key spellings are mixed: `[B]` in bracket text (toasts), `.hq-kbd` chips, bare digits ("1 continue"), and
    `Ctrl+\`` in prose.
- **Redundant "blocked" signalling at the same moment** (`mixed-02-roster-state`, one blocked agent):
  1. HUD pill;
  2. Big Board marquee (in-world);
  3. speech bubble;
  4. roster Blocked-Inbox card;
  5. roster "Blocked" group row with the same question;
  6. minimap red dot;
  7. edge chevron;
  8. drawer header "▲ 1 blocked · Leader U";
  9. blocked toast.
  - Items 1 and 4 duplicate diegetic signals. Item 8 appears even when the active tab *is* the blocked agent
    (`mixed-07`).
- **Collisions.**
  - The hotbar tray sits on top of the drawer footer chip (`mixed-37`, `mixed-38`: "Typing resizes pane…" is covered).
  - Drawer toasts float over live xterm text (`mixed-33`).
  - The blocked toast stack sits on the minimap edge and over the world's lower-left (`mixed-23`).

---

## 1. Surface-by-surface slop list

### 1.1 HUD top strip, corner badges, chevrons, crosshair (`mixed-00`, `mixed-08`, `narrow-06`, `mixed-28`, `mixed-36`)
- **Pill row.** Six separate status capsules (`● 5 working`, `▲ 1 blocked`, `✓ 2 done`, `◌ 1 idle`, `? 1 unknown`,
  `>_ 2 shells`), each with its own rounded background and coloured glyph. This is the isolated-pill pattern in its
  purest form. It also duplicates the Big Board, which shows the same counts diegetically in the centre of the view.
- **Three unrelated floating capsules.** The `DEMO` clay-outline badge (top-left), the pill row (top-centre) and the
  icon-button capsule for sound, help and settings (top-right). Each has a different radius, padding and border.
- **Inconsistent degradation.**
  - With the drawer open, the row collapses to the glyph string `▲1 · ●3 · ✓3 · ◌3 · >_2` (`mixed-08`). It is cryptic,
    with no words.
  - At 1280 wide, only "blocked" keeps its label (`narrow-06`: `● 5`, `▲ 1 blocked`, `✓ 2`).
- **Edge chevrons** (`mixed-28`, `mixed-36`, right edge): a red filled disc with ▶, next to a separate dark name pill.
  That is two isolated pills per agent.
- **Aim hint** (`mixed-36`): an `E` kbd chip plus "open gale" beside a ring. Acceptable, but it is yet another kbd size.
- **Follow label and Leader indicator.** Separate bespoke chips (`.hq-follow`, `.hq-leader`); not captured in this pass.

### 1.2 Minimap and map overview (`mixed-00`, `mixed-25`)
- The small minimap is a **dark teal canvas in a dark panel with a clay 1px border** and a 12px radius. The overview is
  **cream paper**. These are two visual languages for the same object. ART §9.2 asks for "paper style (cream map, ink
  lines)" for the minimap.
- Overview legend: a row of coloured dots plus the text `M / Esc close · click an agent…`, and **`▲` glyphs prefixed to
  names** (`▲ claude · 2`). The overview is the surface closest to the target look: a paper map with ink walls. Keep its
  bones.
- Minimap colours are hard-coded in `minimap.js` (18+ hex values), outside any token.

### 1.3 Roster (`mixed-02-*`, `mixed-03`, `queue-02-*`, `narrow-02`, `mixed-38`)
- **Header clutter before the list** (about 190px). The title "Agents 12" and 3 icon buttons, then:
  - A **7-way segmented control of abbreviations**: `State Space Tab Proj Dir Kind Tool`.
  - The search field. Its placeholder truncates to `/ search — or just type · is:blocked ws: cwc`.
  - **Two rows of chips.** Row 1 holds filter toggles (`▲ blocked`, `● working`, `✓ done`, `◌ idle`). Row 2 mixes a
    toggle (`>_ Shells`, filled when on) with **commands dressed as chips** (`+ Shell`, `▶ Triage`). Filters and actions
    share one visual form.
- **Nested Blocked-Inbox card.**
  - A red-tinted rounded card inside the roster panel: a big red "1", a title, "flint · waited ≥ 0:15", the question,
    three **option pills that each contain a kbd pill**, a floating `B` kbd badge top-right, and a lone terminal icon
    button bottom-right.
  - Option 3 is a **dashed red outline**.
  - The same question is repeated one row below in the "Blocked" group (`AskUserQuestion · Do you want to…`).
- **Row anatomy is overloaded.** Portrait, then the name, then a **stray ◆ marker** (`claude ◆`, meaning unexplained),
  then a "· 2" namesake suffix. Then a coloured workspace dot, the workspace name, a **tinted status pill**, the elapsed
  time "≥15s", the mono tool line, and a **tiny unlabeled context bar**. The bar is a grey sliver at the right edge that
  reads as a mystery meter.
- **Unread accent.** A **clay dot floats next to the ✓ done pill** (willow, `mixed-02-roster-tool`). The line under it
  is "since you looked: finished · infra" in clay mono, which adds another accent colour to the row.
- **Selection.**
  - The selected row becomes a **clay-outlined rounded card** with a left clay bar and a second line of **5 unlabeled
    icon buttons**: terminal, locate, follow, reply, pin (`mixed-02-roster-workspace`, `mixed-03`).
  - The selected **group header** also gets a full clay-outlined card (`mixed-02-roster-state`: "Working", `-tool`: "no
    tool"). Headers and rows use the same selection card.
- **Group headers** hold a chevron, a label, and **glyph-coloured mini counts** (`▲1 ✓1 4`, `▲3 ✓1 6`). These are more
  micro-pills of state colour.
- **Footer.** "Sort recent activity ⌄" (an uncommitted dropdown) plus a kbd legend. In search mode the legend overflows
  and clips: `↓ pick, then G go · ⇧Enter go r` (`mixed-03`).
- **Pinned group** (`mixed-38`): a tiny white pin-number badge overlaps the portrait's bottom-right corner. That is
  another badge style.

### 1.4 Status card (`mixed-04-*`, `narrow-04`, `mixed-36`)
- **A coloured 2px top stripe per state** (blue, red, green, teal) on a dark rounded card. This is the stock
  "accent-border card".
- **Header.**
  - Name and "claude · opus", then a **tinted status pill with time inside** (`● working · ≥28s`).
  - Then workspace dot › tab · cwd.
  - Then an **alternation of sans and mono lines**: title, then "3/4 ▶ Adding tests" (with "3/4" in blue), then
    `Bash: git status` (mono), then a quote with a left bar, then `+92 −5 · 2 files · 3m on task` (mono).
  - Then a context bar, "34% ctx", and "1 subagent · Explore".
  - That is 8 typographic treatments in one card.
- **Blocked.** A **red sub-card inside the card** holds the question and three option rows with kbd boxes. Option 3 has a
  dashed red outline. It shows the same data as the inbox, in a third style.
- **Done** (`mixed-04-status-done`). Four buttons wrap to two rows (`Terminal`, `✓ Sign off` in clay, `Mark seen in
  herdr`, `Talk`), then a kbd legend.
- **Button row and kbd legend duplicate each other** on every variant: `Terminal` + `E terminal`, `Talk` + `T talk`.
- At 1280×720 the card covers about 27% of the world view (`narrow-04`).

### 1.5 Terminal drawer chrome (`mixed-05..09`, `mixed-29`, `mixed-33`, `mixed-34`, `mixed-37`, `narrow-06/08`)
- **Tabs.** Portrait, name, and a **tiny coloured glyph** (`○ ▲ ✓ >_ ●`). The active tab gets a clay top line and a ×.
  This is fine structurally, but the glyphs are Unicode and each is a different colour.
- **The header right cluster holds 5 unrelated widgets in a row:**
  1. `◆ in herdr` (clay text + diamond);
  2. a **`PEEK` blue tinted pill**. Blue is the *working* status colour, reused for a terminal mode;
  3. a **red outlined `▲ 1 blocked ·` pill containing a `Leader U` kbd pill** (pill in pill);
  4. **6 unlabeled icon buttons** (fit, history, copy, trash, expand, collapse);
  5. a clay 2px underline across the header.
- **The "1 blocked" pill is redundant** when the active tab is the blocked agent (`mixed-07`: flint's tab, flint's
  prompt on screen, and still "1 blocked · Leader U").
- **Footer.**
  - An amber-outlined chip, `Cropped 200×50 Fullscreen` / `Typing resizes pane → 98×44 Stay in Peek` /
    `Peek · type or Leader I to take control`, **containing inline clay link-buttons**.
  - On the right: `124×50`, `11px (scaled from 14)`, `Copy on select ✓` and `?`, as loose grey text.
  - Its wording changes every state, so the chip's width jumps.
- **Drawer toasts** are dark rounded cards that float over the xterm's live text (`mixed-33`).
- **Context menu** (`mixed-37`): a stock dark rounded menu with no icons and no key hints; "Copy" is greyed. The inline JS
  hover background is `rgba(244,237,227,.08)`.
- **Collapsed rail** (`mixed-34`, right edge): a thin dark strip with `<`, a portrait and a red `▲3` pill. It is
  unlabeled.
- **Empty drawer** (`mixed-09`): no designed empty state was captured; the drawer just closes.
- The xterm itself is clean and on-palette (§9.3). Leave it alone.

### 1.6 Blocked Inbox / Serve (`mixed-10`, `mixed-11`, `mixed-32`, `queue-10`, `narrow-10`)
- A cream paper card floats top-centre, a different surface language from the dark roster and status card that show the
  same data.
- **Tabs contain count badges.** `▲ Blocked` has a **red filled circle "1"**; `✓ Done` has a **grey circle "3"**. That is
  two more badge styles.
- **Header.** The portrait sits in a **red rounded frame**. Top-right is a **red mono tinted pill** `waited ≥ 0:49`. The
  roster uses `≥ 0:15` and the status card `blocked · ≥ 0:30`: three formats for the same timer.
- **The question is in a dashed-border box.** The options are beige boxes with a **›** chevron and a **clay filled kbd**.
  Option 3 is red with a **dashed red `REFUSES` micro-badge**.
- **Duplicated actions.** An action row, `Open terminal ↗ [O]` plus `⌖ Go there [G]`, is followed by a footer legend
  `1–9 pick · O terminal · G go there · ⟷ next · Esc close`.
- **Done tab** (`mixed-11`):
  - An explanatory paragraph at the top.
  - Rows with portrait, name, a sub line, a terminal icon, and a **green filled "✓ Sign off" button** per row.
  - A left-aligned **green "✓ Sign off all (3)"** button under a kbd legend.
  - Green primaries exist only here.
- **Confirm** (`mixed-32`): `inbox.action('option',1)` only highlights row 1. The confirmation affordance is subtle and
  reuses the highlighted-row style.
- **Away recap stacked on top** (`mixed-26`): a clay header band `WHILE YOU WERE AWAY · 45 MIN` in caps, then 3 mono
  lines with red, green and ink words. It is fused onto the inbox card with a different header style. The tab bar also
  gains a pager `1 / 3 ‹ › ×`.

### 1.7 Triage (`mixed-12`, `queue-12`)
- A dark wide card with a **2px red/clay full border plus outer glow**. This is the fourth card chrome, after panel,
  paper and status-stripe.
- **Header:** `TRIAGE 1 / 4` in caps, a **red dot**, the name, and a **`▲ blocked · ≥ 0:53` tinted pill**.
- **Card in card.** The left half is a black mono snapshot box, an xterm inside a panel. The right half holds a quote
  bar, stats, the question, and **dark option bars**; option 3 has a dashed red outline.
- **Confusing count.** It reads "1 / 4" with 1 blocked agent (`mixed-12`) because the queue includes done agents, but the
  label says nothing about that.

### 1.8 Prompt bar and rename (`mixed-13`, `mixed-30`, `mixed-28`)
- "Talk to **tinker**" plus a **`◌ idle` pill**, then the input with a clay focus ring.
- **Quick-prompt chips** `1 continue`, `2 run tests`, `3 commit`, `4 summarize`: pills with **bare digit prefixes**, not
  kbd chips. That is a third key notation.
- **Confirm step** (`mixed-30`):
  - A **clay-outlined sub-box** holds a truncated `Send "run the test suite again" to t…`, then `Enter send`, then
    `Esc back`.
  - Then a **Back** ghost button and a **Send** clay button with a double focus ring.
  - The kbd hints and the buttons say the same thing.
- **Rename** (`mixed-28`) reuses the prompt-bar frame. This is good, and it is the one pair that is already consistent.

### 1.9 Hire dialog (`mixed-15`, `mixed-16`, `mixed-31`)
- It is a generic web-form modal: a left label column, then:
  - a **segmented Kind control**, the third segmented style (Claude / Codex / Shell);
  - a **native `<select>`** with the OS chevron;
  - a text input and three **path chips** (`~/src/claude-hq`, …);
  - the name input;
  - a **stock textarea with a resize grip**;
  - `Cancel` (ghost) and `Review…` (clay).
- **Review** (`mixed-31`): a sub-card with a question and kbd hints, then **three buttons: `Cancel`, `Back`, `Hire`**.
  Cancel and Back overlap in meaning.

### 1.10 Command palette (`mixed-17`, `mixed-18`, `narrow-17`)
- A cream paper card and a large input with an `Esc` kbd, then a caps section label `AGENTS` / `BEST MATCHES`.
- **Rows.** Portrait, name, and breadcrumb, then a **tinted status pill** (`▲ blocked`, `✓ done`, `● working`) and a
  grey **"needs you"** text. That text is also on *done* rows, where the agent does not need you in the blocked sense.
- The selected row gets a beige fill and a clay left bar.
- **Action rows** have an icon in a rounded tile and the literal word **`action`** right-aligned: a type label shown as
  text.
- A toggle is exposed as a sentence (`Copy on select: on → off`).
- The kbd footer legend repeats.

### 1.11 Help (`mixed-19`)
- A large dark modal. The hero has the Ada portrait in a rounded tile, a paragraph, and **three stacked right-side
  buttons**: `All keys ?` (clay, containing a kbd), `⚙ Settings`, `◎ Replay the tour`.
- **Grid of 5 step cards inside the modal.** Each has a **clay numbered circle**. Heights are uneven, and card 5 is
  orphaned in the left column.
- **Kbd soup:** 30+ inline keycaps inside running prose ("Click the office…, W A S D to walk, hold Shift…").
- The **"STATES" legend repeats the status pills** a sixth time.
- At 900px height the content clips under the fold.

### 1.12 Keys overlay (`mixed-20`)
- **A new tab style: big boxy buttons of uneven width**, some wrapping to 2 lines (`Blocked Inbox / Serve`,
  `Terminal (xterm) + Leader`). The active tab is a clay fill.
- A two-column table of kbd chip(s) and description, with hairlines. Chip widths vary a lot (`W A S D`, `Arrows`,
  `Leader Shift+X`). The content clips at the bottom.

### 1.13 Onboarding tour (`mixed-21`)
- A cream paper card, bottom-centre: an Ada tile, a title, and a paragraph.
- It has an underlined **"Skip tour" link**, an **ink-black filled "Next ›" button** (the only ink button in the app), and
  clay step dots.
- It persists over other surfaces: it stayed visible under settings, the map and toasts in the first capture run
  (`mixed-22`, `mixed-25`, `mixed-26`), and it hid the hotbar.

### 1.14 Settings (`mixed-22`, `narrow-22`)
- A textbook "settings page" with a left nav list (active item tinted clay) and **caps clay section headers**.
- Each row is a label plus a grey subtitle. The right-hand controls:
  - a **segmented control whose selected segment is a white pill**. White appears nowhere else; the fourth segmented
    style;
  - **stock range sliders** with a clay fill and a mono `%` readout;
  - **iOS-style toggle switches**;
  - ghost buttons (`Open mixer`, `Allow`) and loose status text (`off`).
- Nothing in it is diegetic. It could be any SaaS app.

### 1.15 Toasts and notification stack (`mixed-23`, `mixed-35`, `mixed-30`, `mixed-31`)
- Dark rounded cards, bottom-left, stacked above the minimap. Each has an **18px tinted icon tile** (▲ ✓ i !).
- Variants each get their own tint:
  - **blocked:** red outline, red tint, red "is blocked";
  - **done:** green tint;
  - **info:** blue "i";
  - **warn:** hard-coded yellow `#F1C66E` "!".
- The **`+2 earlier · B inbox`** chip is yet another pill.
- **Hints use three notations:**
  - `[B] inbox · click to open`;
  - `Ctrl+\` U next blocked · Ctrl+\` L, B inbox · click for the inbox` (4 instructions in one toast, `mixed-30`);
  - `click to open · G on them = high-five sign-off`.
- A merged blocked toast plus single blocked toasts shows the same agents twice (`mixed-23`: "2 agents blocked: claude,
  lumen", then "claude · 2 is blocked").

### 1.16 Hotbar (`mixed-24`, `mixed-37`, `mixed-38`)
- A dark rounded tray, bottom-centre. Each slot is a portrait in a rounded tile with a **status-coloured bottom stroke**,
  a digit at top-left, a **coloured Unicode glyph at top-right**, and an unread badge.
- There is a dim empty slot "6".
- **It collides with the drawer footer** (`mixed-37`, `mixed-38`) because it is centred on the full window, not on the
  world strip.
- Pins whose agents are missing render as a **ghost tray of greyed digits**. This was seen when pins did not bind, in
  the first run.

### 1.17 Confirm, menu, empty states
- **Confirm** (`.hq-confirm`, paper, 14px) was not triggered in demo. It is a fifth paper-card variant.
- **Context menu:** see §1.5.
- **Empty drawer and empty inbox** ("All signed off. The sofa is getting crowded.") use their own text styles.

---

## 2. Inventory of distinct components and patterns in use (to be replaced by kit components)

"Where" lists the surfaces. The CSS selector is given where one exists.

### 2.1 Containers / surfaces (9 chromes)
| pattern | where | notes |
|---|---|---|
| Ink glass panel `.hq-panel` (94% ink, blur, 1px #3A3733, 14px) | roster, status card, prompt bar, rename, toasts, hotbar, minimap frame, settings, help, keys, hire | the §9.1 base; radius not honoured by children |
| Paper card (cream, 16px, big drop shadow) | palette `.hq-cmdk`, inbox `.hq-inbox`, onboarding `.hq-coach`, map overview `.hq-map`, confirm `.hq-confirm` | 5 variants, each with its own shadow |
| Status-stripe card (2px coloured top border) | status card `.hq-scard` | |
| Glow-border card (2px clay/red border + glow) | triage `.hq-triage` | |
| Side sheet | drawer `.hq-drawer` (+ `.hq-drawer-fs`, `.hq-rail`) | |
| Modal overlay + scrim | help, keys, settings, hire, triage, cmdk (`*-wrap`) | 6 separate wrap classes |
| Nested sub-card: tinted | roster Blocked-Inbox `.hq-inbox-card`, status-card question box, prompt-bar confirm, hire review | red/clay tints |
| Nested sub-card: dashed | inbox question box, REFUSES badge, option-3 outlines | |
| Nested sub-card: grid tiles | help step cards | |
| Snapshot box (black mono) | triage | |
| Banner | away recap `.hq-away` / `.hq-banner`, drawer `.hq-tbanner` | |

### 2.2 Pills, chips and badges (≥ 17 kinds)
- **HUD state pill** `.hq-pill` (+ `.blocked`, `.clear`, `.pulse`, `.kick`) and its compact glyph-string form.
- **Status pill in rows and cards** (tinted bg + glyph + label, optional time): roster, status card, palette, prompt bar,
  triage, help legend.
- **Roster filter chip** `.hq-fchip` (+ `.plain`) and the **action-as-chip** (`+ Shell`, `▶ Triage`).
- **Drawer footer chip** `.hq-tchip` (+ `.peek`, `.warn`, `.flash`), with inline buttons.
- **Mode badge** `.hq-mode` (`.peek`, `.control`, `.readonly`), e.g. the blue `PEEK`.
- **Blocked-counter pill with a nested kbd**: the drawer header `▲ 1 blocked · Leader U`.
- **Generic chip** `.hq-chip`; **badge** `.hq-badge`; **chip bar** `.hq-chipbar`, `.hq-dchips`.
- **Count badges in tabs** (red filled circle, grey circle; inbox).
- **Timer pill** (`waited ≥ 0:49`) and inline timers (`≥ 0:15`, `≥15s`, `· ≥28s`).
- **`REFUSES` dashed micro-badge.**
- **`+N earlier · B inbox` more-chip** `.hq-toast-more`.
- **Path chips** (hire) and **quick-prompt chips** (prompt bar).
- **DEMO badge.**
- **Group-header mini counts** (`▲1 ✓1 4`).
- **Pin-number badge** on portraits (roster pinned group) and the **unread badge** (hotbar `.ur`).
- **`action` type label** (palette) and **`◆ in herdr`** marker (drawer header).

### 2.3 Keycaps and key notation (4 notations)
- `.hq-kbd`, `.hq-kbd.sans`, and inbox-filled clay kbd variants. At least 5 rendered sizes.
- Bracket text `[B]` (toasts), bare-digit prefixes (`1 continue`), and prose `Ctrl+\``.
- Kbd legends / footers `.hq-keys`, `.hq-rfk`, and the per-surface `foot` rows.

### 2.4 Buttons (≥ 11 kinds)
- `.hq-btn` (ghost dark), `.hq-btn.primary` (clay).
- The **green sign-off button** (inbox Done) and the **ink "Next ›" button** (onboarding).
- The **underlined text link** ("Skip tour") and **inline link-buttons** in the drawer footer chip.
- **Icon buttons** `.hq-ibtn`: roster header, roster row actions (5), drawer header (6), HUD top-right (3).
- **Option buttons/rows**, 4 variants: `.hq-inbox-card .ob button`, `.hq-inbox .opts li` (+ `.hl`, `.danger`, `.gow`),
  `.hq-triage .ob button`, and the status-card options.
- **Inbox action link** `.hq-inbox .go`; **away list action** `li.act`.
- **Help hero stacked buttons** `.hq-help .hero .acts`; **empty-state button** `.hq-empty button`.

### 2.5 Tabs and segmented controls (6 styles)
1. roster group-by `.hq-seg`;
2. `.hq-seg.small` / `.hq-seg.kind` (hire);
3. settings quality seg (white selected);
4. drawer tabs `.hq-tab` / `.hq-tabs`;
5. inbox tabs (with count badges);
6. keys-overlay tab buttons (uneven boxes).

The settings left nav is a seventh.

### 2.6 Form controls
- Search field `.hq-search` (roster) and the palette input.
- Text inputs: prompt bar, rename, hire. A native `<select>` and a native `<textarea>` (hire).
- Range sliders and `.hq-switch` toggles (settings).
- Sort dropdown (roster footer).

### 2.7 Lists and rows
- Roster row `.hq-row`, group header `.hq-gh` (sticky), `.hq-tree`.
- Palette row; inbox option rows; inbox done rows; settings rows; keys table rows; help legend rows; away list; context
  menu items.

### 2.8 Indicators and meters
- Unicode status glyphs `● ▲ ✓ ◌ ○ ? >_` (`STATE_SHAPE`) in HUD, tabs, hotbar, rows and names.
- The workspace colour dot and crest SVG.
- The unread clay dot; the `◆` marker; the left selection bar.
- Coloured top stripes (status card) and bottom strokes (hotbar).
- The context meter bar (roster row, status card); onboarding step dots; the "3/4 ▶" progress text.
- The pulse / flash animations: `.hq-pill.pulse`, the drawer `blockedBtn.pulse`, and `.hq-tchip.flash`.

### 2.9 HUD pieces
- Crosshair `.hq-cross` and the aim label; edge chevrons `.hq-chev`; follow label `.hq-follow`; leader indicator
  `.hq-leader`.
- Top strip `.hq-top`; the top-right icon cluster; the DEMO badge.
- Minimap `.hq-mini` (dark) vs overview `.hq-map` (paper); hotbar `.hq-hotbar`; collapsed drawer rail `.hq-rail`; away
  strip.

### 2.10 Portraits
- `portraitSvg` tiles appear at 5+ sizes, each with its own frame treatment:
  - roster: no frame;
  - status card: plain;
  - inbox: red rounded frame;
  - hotbar: rounded tile with a status stroke;
  - tabs: bare;
  - help / onboarding (Ada): rounded tile.

---

## 3. What the kit must fix (checklist for the kit authors)

1. **One radius scale** (for example: panel, control, and round for status dots only). Delete the other 24 values.
2. **One type scale.** About 5 sizes, 3 weights, one mono and one sans role. No half-pixels.
3. **One surface family that looks like the world.** For example, a painted-wood or enamel plaque header over a
   paper/felt body for dark panels, and paper cards drawn like the in-world speech bubbles. Pick where paper is used by
   a rule, not per surface.
4. **One status mark.** A single SVG shape+colour glyph (not a tinted capsule) used identically everywhere. Status goes
   *into* the row or tab, not onto it as a pill.
5. **One prompt-options component**, used by the roster, status card, inbox and triage.
6. **One button set:** primary (clay), secondary, quiet, icon. No green or ink primaries.
7. **One keycap and one key-legend rule.** Either label the button with its key, or show a legend. Never both.
8. **One tab/segment component**, used by roster group-by, drawer, inbox, keys, settings and hire.
9. **Flatten the nesting.** No card inside a card. No pill inside a pill. The roster's Blocked-Inbox card and the drawer
   "1 blocked · Leader U" pill need to become single-level elements, or go away in favour of the Big Board / inbox.
10. **Remove the redundancy:** HUD pills vs the Big Board; the double-listed blocked question in the roster; the drawer
    blocked pill when the active tab is blocked; merged plus single blocked toasts; the "needs you" text on done rows.
11. **Fix the collisions:** the hotbar vs the drawer footer, and drawer toasts over xterm text.
12. **Tokens only.** No hex in JS (`hud.js`, `overlays.js`, `minimap.js`, `drawer.js`). Minimap and overview share one
    paper style.
