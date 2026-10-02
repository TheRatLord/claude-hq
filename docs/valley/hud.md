# HUD and in-world UI

Names in 3D, the anchored tag/bubble overlay, the interaction tag, every route to a terminal, the power-user loop, the
HUD layout zones and z-order, layer classes, the drawer, keys and HUD performance. The map has its own doc
([map.md](map.md)), as does the welcome tour ([onboarding.md](onboarding.md)).

Key sources: `hud/hud.ts` (keys, layer classes, `__hud`), `hud/pause.ts` (Settings), `model/prefs.ts` + `prefs.ts`
(browser-local prefs; `prefs.test.ts`), `hud/anchors.ts` + `anchors.css` (overlay), `hud/anchor.ts`
(pure maths: `placeRect`; `anchor.test.ts`), `hud/prompt.ts` (interaction tag), `hud/needs.ts` (needs-you strip),
`hud/mailbox.ts`, `hud/roster.ts` (the ledger), `hud/cards.ts` (farmer card), `hud/recap.ts` (harvest recaps: [recap.md](recap.md)), `hud/drawer.ts` (terminal drawer),
`hud/toasts.ts`, `hud/status.ts`, `hud/notify.ts`, `hud/pause.ts`, `hud/format.ts` (`shortName`, `altName`,
`askOrder`, `nextAfter`, `rosterFilterHit`; `format.test.ts`), `hud/ctx.ts` (prefs), `hud/hud.css`,
`scene/farmers/labels.ts`, `model/types.ts` (`FarmerView.tag`), `browser-tests/valley.spec.ts`, `browser-tests/settings.spec.ts`. Paths are relative to
`renderer/src/farm/` unless rooted.

## In-world UI (names, speech bubbles, the interaction tag)

* **Names in 3D are project names.** `FarmerView.tag` / `HelperView.tag` (model, tested): the project directory name
  (`project` = basename of the repo / cwd), unique per field — twins become `claude-hq·flint` when each has a clean
  one-word herdr name, else `claude-hq`, `claude-hq·2`, … Nameplates, bubbles, the prompt and the noticeboard use
  `tag`; `name` (herdr name / tab label, may be a long path) is for HUD panels with room (secondary line / tooltip).
* **One anchored overlay system** (`hud/anchors.ts` + `anchors.css`, pure maths in `hud/anchor.ts`): nameplates,
  villager signboards, duckling labels and speech / needs-you bubbles are DOM nodes projected over their world anchor
  every frame (transform only, nodes reused per key, sizes measured once per text change), so they stay crisp at night,
  in fog and rain. Scene code never touches the DOM: it calls `Labels.show(key, owner, style, title, sub, pos, alpha)`
  (`scene/farmers/labels.ts`, which fades tags behind the big buildings via the light occluders) → `UiPort.tag`.
  Same-owner tags stack (plate, then bubble); stacks nudge apart nearest-first; long lines wrap and page (`1/3`),
  never truncate; tags shrink a little with distance.
* **HUD furniture is an obstacle.** Mark any fixed HUD element `data-hud-obstacle` (its box) or
  `data-hud-obstacle="children"` (each visible child: a card column, a toast stack); `anchors.ts` re-measures them only
  when they change (Resize/MutationObserver on the marked elements, window resize), and bubbles, nameplates and the
  interaction tag step around them (`placeRect` in `hud/anchor.ts`: up, sideways, then down; hidden or edge-pinned
  when nothing fits).
* **`ui.say(text, ms, { who, from })`** is a timed bubble anchored to the speaker: `from` (an interactable id), else
  whatever was under the crosshair when it was said (most lines come from `use()`); characters get a speech bubble,
  structures / props a parchment note. If you turn away it pins to the screen edge with an arrow toward the speaker.
* **The interaction tag** (`hud/prompt.ts`) sits beside the focused target (right side, flips left when there is no
  room; never over the face): name + role, `[E] verb`, `[F] alt`, and the hint line. The crosshair stays. F on a farmer
  or scarecrow with no alt action opens its terminal.
  Shots: `goto=villager:posy` plus `eval=setTimeout(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'})),1200)`
  for a villager line; `__valley.force(id, { status: 'working', activity: { cls: 'talk', … }, lastText })` for a talker.

## Names

Compact spots (needs-you cards, map pins and the side lists, ledger rows, the drawer's list and header, the farmer
card's title) use `shortName()` = the in-world `tag`; the full herdr name goes on a secondary line or a tooltip via
`altName()` (`hud/format.ts`, tested). Map pins carry one glyph (`pinGlyph()`: the tag's suffix).

## Every terminal is a menu away

Ledger (Tab), map (M: click a pin, or ↑/↓ + Enter in the side list, which lists farmers *and* scarecrows), mailbox (J:
the Needs you tab pre-selects the first ask, 1–9 answers it, Enter opens the terminal), the needs-you strip (Alt+1…9),
the pause menu's Terminals entry, the dock's terminal button, the command palette (Ctrl+K; also a line any terminal printed), the overview grid (V), the focus queue (Alt+N; [ops.md](ops.md)) and the leader key (Ctrl+` by default; Settings
`leaderKey`). `browser-tests/valley.spec.ts` checks the ledger, map-click, map-keyboard, mailbox and needs-you paths and
the power-user loop below: add a flow there when you add one.

## The power-user loop (5–15 agents)

* *Answer + next.* The mailbox's Needs you tab lists asks in the strip's order (`askOrder`, newest first, so Alt+1 is
  the top letter); answering one (1–9 or a click) selects the next (`nextAfter`, `format.ts`), so `J 1 1 2 Esc` clears
  a queue. A second key press while an answer is in flight is ignored (no double answers).
* *New tasks.* An idle / finished farmer's card has **Give a new task** (`AgentPort.prompt`, a confirm step, Ctrl+Enter
  twice); `N` in the card jumps into it, and the ledger reaches it directly: the paper-plane row button or Ctrl+Enter
  on the selected row opens the card with the box focused (`panels.open('card', { id, task: true })`).
* *Ledger chips.* The ledger's summary pills (needs you · working · done · idle; `rosterFilterHit`) are status filters
  (click again for everyone); text filtering still matches names, fields, jobs and questions.
* *Away from the window.* The tab title counts asks / finishes (`status.ts`) and the tab icon is a canvas-drawn Clawd
  with a gold count badge for asks or a blue dot for unreviewed finishes (`notify.ts`). Opt-in **desktop
  notifications** (Settings → Alerts, HUD pref `notify`; asks the browser for permission) fire on `blocked` /
  `finished` only while the window is hidden or unfocused: bursts merge (`notifyCopy`), one per farmer per 15 s;
  clicking opens that terminal (several asks: the mailbox). `__hud.notify()` shows the last copy and the icon badge.
  In the desktop app they are native (Electron) notifications, with a tray, dock badge and summon hotkey: [desktop.md](desktop.md).
* *Every key.* `?` opens the pause menu's Controls tab from anywhere outside a terminal: grouped (getting around,
  agents, mailbox, ledger, card & terminal, the valley). Add new keys there and to the hints bar's budget sparingly.

## Settings (pause menu → Settings; `hud/pause.ts`)

One section at a time (a tab row; ←/→ switch, like every tab row): **Controls · Graphics · Audio · Interface ·
Accessibility · Alerts · Terminal**. `__hud.open('pause', 'settings:access')` opens a section directly.

Two stores, on purpose:

* **Server settings** (`core/settings.ts`, `hello.settings` / `settings.set`) roam with the HQ: volumes, mute, the
  terminal (text size, leader key, paste confirm, …). The old wire keys `fov`, `headBob`, `quality` are no longer
  shown; `reducedMotion` still counts while Accessibility → reduced motion follows the system.
* **Browser-local prefs** (`model/prefs.ts`: shape, defaults, `sanitizePrefs`, pure helpers; `prefs.ts`: the live
  store) describe this screen, GPU and person: one object in localStorage `valley.hud.prefs` (the same key as the old
  HUD prefs, so `minimap`, `toasts`, `drawerH`, … carry over). `sanitizePrefs` = `pickTyped` + clamps (`RANGES`) +
  enum checks + `sanitizeKeys`, so garbage in storage can only produce a valid, in-range object. main.ts makes the
  store and shares it: HUD (`ctx.prefs` + `ctx.savePrefs()`, which persists **and** notifies), the controller
  (`createController(ctx, canvas, () => prefs.data)`), the engine wiring (`applyPrefs` in main.ts). `__hud.prefs()`
  reads, `__hud.prefs({ … })` patches (shots: `eval=__hud.prefs({uiScale:1.3})`).

| section | pref | what it does |
|---|---|---|
| Controls | `mouseSens` (×0.2–3), `invertY`, `fov` (50–90°, default 62), `headBob`, `sprintToggle` | read live by `player/controller.ts` (fov by main.ts on the camera) |
| Controls | `keys` | rebind use / alt / map / ledger / mail / wave / lantern / notebook / overview (defaults E F M Tab J Z T O V). Click, press a key; Esc cancels. Refused with a message when it is another action's key or a fixed one (`RESERVED_KEYS`: walking, Space, Shift, Esc, Enter, B H K I Q N P C, digits, F3/F4/F6, modifiers): `keyConflict` / `rebind`. The interaction tag, hints bar, dock, menu and Controls list show the bound keys (`keyLabel`). *Reset keys* restores the defaults |
| Graphics | `quality` (low / medium / high) | systems size pools at start, so it applies **on reload** (a *Reload now* button); `?quality=` wins and the note says so |
| Graphics | `renderScale` (50–100 %), `shadows`, `weatherFx` (0–100 %) | live: `engine.setRenderScale` (× the quality's own scale), `engine.setShadows` (castShadow off on every light, re-applied after systems start), `ctx.comfort.weatherFx` (weather.ts scales rain / snow / leaves / motes) |
| Graphics | `fpsCap` (display / 60 / 30) and `idleMin` (off / 2 / 5 / 10 / 30 min, default 10) | `engine.setFpsCap(effectiveFpsCap(…))`: after `idleMin` minutes with no key / mouse / wheel / touch the valley runs at `IDLE_FPS` (15) until the next input. Hidden tabs already stop rendering (core/loop.ts). Automated browsers (`navigator.webdriver`) never idle-throttle |
| Interface | `uiScale` (80–150 %) | `--ui-zoom` on `.vh-layer` → CSS `zoom`; world-anchored overlays (`.vh-anchors`, `.vh-prompt`, `.vh-cross`) zoom back to 1 because they are placed in screen px |
| Interface | `nameplates` (always / near ≤ 14 m / off) | `anchors.ts` drops nameplates, signboards and duckling labels (`nameplateShown`); bubbles and asks always show |
| Interface | `toastK` (short / normal / long / very long), `clock` (24 h / 12 h) | toast lifetimes × k (captions too); `clockText` in the status sign and noticeboard |
| Interface | `minimap`, `toasts`, `compactStrip`, `needsDoze`, valley tips | as before |
| (per agent) | `pinned`, `muted` | pane ids (≤ 64 each, `sanitizeIds`): pin / mute ([ops.md](ops.md#pin-and-mute-modelmarksts)); set from the ledger, card, overview or palette, not from Settings |
| Interface | `hands` (Show hands) | `ctx.comfort.hands`: the first-person paws and what they hold ([viewmodel.md](viewmodel.md)) |
| Accessibility | `reducedMotion` (follow the system / on / off) | `reducedMotion(pref, prefers-reduced-motion, server reducedMotion)` → `.vh-layer.reduced` (every HUD animation and transition off), `ctx.comfort.reducedMotion` (head bob ×0.25, weather particles ×0.5, lightning flashes ×0.3), map / minimap rings stop pulsing (`DrawOpts.still`). *Off* adds `.motion-ok`, which also overrides the OS media query in hud.css |
| Accessibility | `colorSafe` | `.vh-layer.cb`: Okabe–Ito status colours (`STATUS_PALETTE.safe`) **and** a shape per status everywhere status shows: needs you ▲, working ●, done ■, idle ◆ (`STATUS_SHAPE` / `STATUS_GLYPH`) on map pins and the minimap (`statusMark` in mapdraw.ts, the map key redraws), list dots (`.vh-dot`), every status pill (ledger, card, map tips) and farmer nameplates (`data-st` set by anchors.ts from `statusOf`) |
| Accessibility | `highContrast` | `.vh-layer.hc`: black ink, near-white paper, black borders, solid hints bar, white nameplates / bubbles / interaction tag, a black + gold focus ring |
| Accessibility | `largeText` | the HUD zoom × 1.15 (`uiZoom`) and bigger nameplate / bubble / interaction-tag text (which the zoom leaves alone) |
| Accessibility | `captions` | a caption line (bottom centre, `.vh-captions`, `role=log`) for the cues that carry news, from the valley events the audio layer voices (`captionFor`: needs you = alert bell, finished = done chime, cheer, oops, fanfare, a new field). One per kind and farmer per 1.5 s, three at most, ~5 s × `toastK` |
| Alerts | `notify` | desktop notifications (above); in the desktop app also the *Desktop app* rows (hotkey, tray, login, background drawing: [desktop.md](desktop.md), stored by the shell, not here) |

**Screen readers and keyboards.** Panels are `role=dialog` with a label (their plaque); the left column is a named
region, the dock a `nav`, the hints a `note`, toasts `aria-live=polite`, captions a `log`. A visually hidden
`aria-live=assertive` region (`sr-announce`) says who needs you and how to answer on every new ask. Inside any panel
**Tab / Shift+Tab walk its controls and wrap** (focus never leaks behind it); the ledger keeps *Tab closes it* while Tab
is its key (Shift+Tab walks it), and the ledger key opens the ledger from another panel only when it is not Tab.
Everything focusable shows a ring on keyboard focus (`:focus-visible`, gold; black + gold in high contrast).
`browser-tests/settings.spec.ts` covers the round-trips (incl. a reload), refused rebinds, reduced motion (OS and
toggle), Tab containment, arrow-key tabs, captions and the live region.

## Keys (`hud/hud.ts`)

| key | does |
|---|---|
| E / F | use / alt on the focused target (F on a farmer or scarecrow: its terminal; on a villager: chat or gift); rebindable |
| Tab | the ledger (roster); rebindable. Inside a panel Tab walks its controls instead |
| M | the map ([map.md](map.md)); rebindable |
| J | the mailbox; rebindable |
| B | the noticeboard |
| H | the Valley Almanac ([almanac.md](almanac.md)) |
| K | the Collections book ([pastimes.md](pastimes.md)) |
| G | The Valley Gazette: today's paper and the back issues ([gazette.md](gazette.md)) |
| Z / T | wave / light or put away your lantern ([viewmodel.md](viewmodel.md)); rebindable |
| I | your pockets (shop panel, basket; 1/2/3 tabs; [economy.md](economy.md)) |
| Q | keep the request tracker open ([friends.md](friends.md)) |
| N | toggle the corner minimap |
| Alt+1…9 | the n-th needs-you farmer's terminal, from anywhere (outside a terminal) |
| Alt+0 | fold / unfold (or wake) the needs-you list |
| Alt+N | the next agent in the focus queue (asks, struggling, unreviewed finishes), from anywhere incl. a terminal ([ops.md](ops.md)) |
| Ctrl+K (⌘K) | the command palette: any agent (also by what they said), every terminal's scrollback (3+ letters), answers, panels, actions; Esc goes back ([ops.md](ops.md)) |
| Ctrl+` (leader) | terminals |
| ? | the pause menu's Controls tab |
| Esc | the pause menu (also on losing pointer lock) |
| P | photo mode ([album.md](album.md)) |
| L | the photo album ([album.md](album.md)) |
| O | Fern's field notebook: every activity, how-tos, progress, hints ([guide.md](guide.md)); rebindable |
| V | the overview grid: every agent as a tile; arrows + Enter (terminal); rebindable ([ops.md](ops.md#the-overview-grid-v-rebindable)) |
| Alt+P / Alt+M | pin / mute the selected agent (ledger row, card, overview): pinned first everywhere, muted makes no noise ([ops.md](ops.md#pin-and-mute-modelmarksts)) |
| F3 / F4 / F6 | dev overlays ([tools.md](tools.md#in-game-keys)) |

## HUD layout: calm by default, informative on demand

The world is the point; furniture keeps to fixed zones at the edges that never overlap at 1280×720, 1366×768, 1600×900
or 1920×1080 (check `mixed`, `queue`, `crowd40`, with panels open and closed and toasts flowing;
`__hud.toast({ text, sub, level, key })` pushes one). Sizes come from two tokens on `.vh-layer`: `--gut` (12 px; 10 px
under 820 px tall) and `--left-w` (300 px; 288 px ≤ 1440 wide; 272 px ≤ 900 wide).

```
[☀ 16:00  Thu 1 Oct      ]                                              ( minimap )
[● Demo valley 5 working 2 done]                                   [J][M][Tab][⌃`][Esc]
[(🏵 Harvest Town ▬) (🪙 0)]                                        (♥ 0/3 requests ▸ 📖)
(🔔 1 farmer needs you ▾)
[ open ask: 2-line question ]
[ 1 Yes                     ]
[ 2 Yes, and don't ask a…   ]                                     [ toast ×2 ]
[ Terminal ][ Walk there    ]                                     [ toast    ]
[ row ] [ row ]     (onboarding checklist / tips)      Click look around · M map · … · ? all keys
```

* **Top-left column** (`.vh-left`, `--left-w` wide). The **status sign** in three short rows: the clock with the date
  and season icon (the season's name in the tooltip); the link pill and *working / done* counts (who needs you is the
  chip right below, so the sign doesn't repeat it); the **rank chip** (rosette, name, a tiny bar; opens the Almanac)
  and the **coin chip** (opens your pockets) side by side.
* Under it the **needs-you strip**: a count chip, then the asks newest first: one open **compact card** (name + Alt+N;
  the question clamped to two lines, all of it in the tooltip and on keyboard focus inside the card; one single-line
  button per answer, the full label in the tooltip and on keyboard focus; Terminal + Walk there) and the rest as
  one-line rows (click / Enter opens one; the green button opens its terminal). **Nothing in the card reflows on hover
  or mouse focus**: growing text would push the answers under a pointer on its way to one (a wrong answer, or a lost
  click); the new-ask ring is a transform / opacity pseudo-element, never the card's or a button's own box. The chip
  folds the list (click or Alt+0; pref `compactStrip`).
* **Dozing:** after 25 s (`DOZE_MS`) of walking about (pointer locked, no panel: `.roam`) without a new ask the list
  tucks itself behind the chip, which keeps a slow gold pulse (a ring on `::after`); it never tucks while the pointer is
  free (you just arrived, paused, or have a panel up), and freeing the pointer, a new ask, the chip or Alt+0 brings it
  back (pref `needsDoze`, Settings → *Tuck an unanswered ask away*). Keyboard flows never depend on what is shown:
  Alt+1…9, J then 1–9 / Enter work while dozing or folded.
* **Top-right column** (`.vh-dock`): the minimap (160 px; 136 px on short screens), the dock buttons (mail, map,
  ledger, terminals, menu), then the request tracker chip.
* **Bottom-right:** the key-hints bar (E / F live on the interaction tag instead; the bar dims while you walk about
  with the pointer locked: `.vh-layer.roam`) and above it the **toasts**: at most two (one under a big panel), 4 s by
  default (asks and warnings 5.5 s, errors 7 s), hovering holds one, and the same kind **coalesces** in place with a
  `×n` count instead of stacking (`ToastSpec.group`, else the key's first `|` segment: `commit|…`, `ans|…`,
  `ready|…`). Background toasts (letters, server toasts, festival greetings: `push(t, true)`) never push off a
  confirmation of something you just did; they squeeze in beside it (one over the limit for its few seconds).
* **Clicks on toasts:** a leaving toast (`.out`, fading for 0.4 s) has `pointer-events: none`, so a click meant for the
  toast sliding into its place never opens the old one. Closing a panel puts the pointer back how it was when the
  panel opened (`setModal` in main.ts): walking about (locked, or the pause menu that a lost lock opened) re-locks it;
  a free cursor (a panel opened from the dock, a toast, the hint card, or the keyboard before you ever clicked in)
  stays free, so the toast that pops up next is clickable. With the pointer locked, clicks go to the canvas by design
  (that is what the old headless "canvas over the toast" in `recap.spec.ts` was: a re-lock after Escape).
* **Bottom-left:** the onboarding checklist and one-time tips (`hud/onboarding.ts`; right of the strip while it is
  open).
* **Top-centre:** only the offline banner (it docks bottom-left under a big panel).
* **z-order** (tokens in `hud.css :root`): anchored world tags 5 · interaction tag 6 · hints 20 · panel backdrop 30 ·
  left column 40 · dock 41 · welcome card 45 · panels 50 · terminal dim 54 / drawer 55 · toasts 60 · banner 70. The
  left column sits above the backdrop so asks stay clickable beside any panel.
* Every zone is HUD furniture for the anchored bubbles (`data-hud-obstacle`: the sign, the strip's children, the
  dock's children, hints, the toasts' children, banner, drawer); children of a `children` obstacle are size-watched
  too, so CSS-only changes (the tracker opening on hover) re-measure.

## Layer classes

On `.vh-layer`, set by `hud.ts` / `needs.ts`; style against them instead of measuring:

* `modal` (any panel);
* `covered` (a big panel, not the side card: hints hide, toasts drop to one compact one and only asks / errors pop,
  the offline banner docks bottom-left, the tracker hides);
* `side` (the side card is open: toasts stand to its left, off its buttons);
* `has-needs` (the strip is unfolded and awake: centred panels shift right by `--lw` so the strip stays clickable
  beside them; the mailbox sits between the strip and the dock);
* `roam` (pointer locked, no panel open).

## Empty and offline states

Every list says what is going on and what to do (no farmers yet → open a herdr workspace; herdr offline → it comes back
on its own); never an empty frame.

## Drawer

Bottom-anchored; drag the grip on its top edge (or ↑/↓ on the focused grip) to resize, double-click to reset; the
height is the `drawerH` HUD pref (browser-local, like `minimap`, `toasts`, `compactStrip`, `notify`, `needsDoze` and
every Settings pref above; all in localStorage `valley.hud.prefs`).

## Performance

The 4 Hz tick refreshes only what changed (keyed rows with per-row signatures: `syncList`, the ledger's row cache);
nothing in the HUD reads layout per frame except the map canvas, which redraws only while open. Check with
`npm run shoot -- --scenario crowd40 --shot name=r,pose=hub,panel=roster` (fps in the printed perf).

## Dev handle (`window.__hud`)

`open(id, arg?)` (any `PanelId` in `hud/ctx.ts`: `mailbox map roster card recap noticeboard stats almanac collection shop friends pause
drawer welcome pet gazette album guide projects palette visitors overview`), `close()`,
`current()`, `openTerminal(id)`, `patch(bindings)`, `dismissHint()`, `mapHits()`, `toast(spec)`, `notify()`, `prefs(patch?)`, `tour`
([onboarding.md](onboarding.md)). Full dev API: [tools.md](tools.md#dev-api).
