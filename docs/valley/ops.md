# Operating many agents: the command palette and the focus queue

What a power user running 6–12 agents for a whole day reaches for, besides the ledger, the mailbox and the needs-you
strip ([hud.md](hud.md#the-power-user-loop-515-agents)): one search box for everything (**Ctrl+K**, ⌘K on a Mac), which
also searches what every agent printed in its terminal; one key that always takes you to the next agent that wants you
(**Alt+N**); **pin / mute** per agent; and one grid of every agent to scan at a glance (**V**).

Key sources: `model/ops.ts` (pure: `fuzzyScore`, `fieldsMatch`, `snippet`, `focusQueue`, `nextFocus`; `ops.test.ts`),
`hud/palette.ts` + `palette.css` (the palette panel), `hud/hud.ts` (the keys, `focusNext` / `focusPeek`, where Esc goes
back to), `hud/drawer.ts` (the Next button), `hud/roster.ts` (the ledger filter), `browser-tests/ops.spec.ts`; the scrollback
search: `server/world/scrollback.ts` (+ `.test.ts`), `shared/protocol.ts` (`term.search`, rev 5), `source.ts`
(`AgentPort.search`), `ui/terminal/view.ts` (`findLine`, `openHistory({ find })`); pin / mute: `model/marks.ts`
(+ `.test.ts`), `model/prefs.ts` (`pinned`, `muted`, `sanitizeIds`); the overview: `model/overview.ts` (+ `.test.ts`),
`hud/overview.ts` + `overview.css`; `browser-tests/ops2.spec.ts`. Paths are relative to `renderer/src/farm/` unless rooted.

## The focus queue (`focusQueue`, Alt+N)

Everyone who wants your attention, most urgent first:

1. **asks** (`needsYou`): the agent is blocked; the *longest-waiting* first, so nobody starves behind a stream of new
   ones (the strip and the mailbox stay newest-first: Alt+1 is still "the ask that just came in");
2. **struggling** (`status = working`, `struggle ≥ 2`): looping on a failing test, retrying a tool;
3. **finished, unreviewed** (`unseenDone`), oldest first.

Idle and happily working agents are not in it: an empty queue means you are caught up.

**Alt+N** works from anywhere: the valley, any panel, and *inside a terminal* (also while in control; it is taken from
the terminal like Ctrl+PgUp/PgDn). It opens the next agent's terminal (`nextFocus`: the head of the queue, skipping the
terminal you are in and the ones you already stepped through this round, so an ask you looked at but did not answer
does not bounce you back to it; when everyone was seen it wraps). A toast names who and why and how many are left
(each step replaces it in place). The drawer header has a **Next** button with the count of others waiting; its
tooltip names who is next (`focusPeek`, the same choice Alt+N makes). Nothing waiting: "All caught up".

## The command palette (Ctrl+K / ⌘K)

A top-centre search box over everything, from anywhere (`panels.open('palette', back)`). In a terminal you *control*
Ctrl+K stays the agent's (readline / Claude Code: kill line), so there only ⌘K (Mac) opens it; while watching it opens.

* **Empty** it is the overview: *Needs a look* (the focus queue, with why), then *Everyone* (farmers by status, then
  scarecrows; each with field · job · current todo `(done/total)` or the question), then *Panels & actions*.
* **Typing** matches (`fieldsMatch`, every word must hit some field, fields weighted): agents by tag, herdr name,
  field, project, status / job / agent words ("needs", "finished"), detail, task title, question, **the last thing they
  said** and **their todo list**; when one of those last four is what matched, the row shows that line as a quoted
  snippet, so "rate limit" finds who is working on rate limiting. Scattered-letter matching (`chp` → `claude-hq·pebble`)
  only applies to short texts (≤ 48 chars, `LOOSE_MAX`) within a tight span; long texts need the word itself.
* **In their terminals** (3+ letters, `wantsScrollSearch`): the query also goes to the server's scrollback search
  (below), 250 ms after the last keystroke, one request at a time (the latest query wins). Up to 12 lines show after the
  other matches, newest first: who · field · *on screen* or how long ago, and the line with the match marked. **Enter**
  opens that agent's terminal with the **history overlay scrolled to the line and the match selected** (`findLine` in
  `ui/terminal/view.ts`: wrapped rows joined, the occurrence nearest the hit's distance from the bottom; the needle is the
  line from the match on, else the matched word); a line older than the history's 2000 lines says so in a toast.
  Shift+Enter walks there, Ctrl+Enter opens the card. Esc closes the overlay, then the drawer.
* Only offered once you type: **pin / unpin**, **mute / unmute** for any agent (`pin pebble`, `mute flint`), **answers** to open asks (`pebble yes`, `<tag> answer <option>`: Enter sends that
  option, same path and toast as the strip) and **New task for …** (idle / finished farmers: the card with the task box).
* **Pinned** agents (below) come first in the empty palette, in their own group, and rank higher when you type.
* **Panels and actions**: ledger, mailbox (Needs you), map, the overview grid, terminals, noticeboard, stats, almanac, projects, gazette,
  notebook, collections, pockets, friends, album, settings, all keys, *Next who needs you*, toggle the minimap; each
  shows its key.
* Keys: ↑/↓ (PgUp/PgDn) choose, **Enter** go (an agent: its terminal), **Shift+Enter** walk there, **Ctrl+Enter** the
  card (with the new-task box when they are free). **Esc** (or Ctrl+K again) **goes back** to where you were: the
  terminal (same agent) or panel the palette was opened over; the valley otherwise.
* Live: it refreshes at 4 Hz while open (a new ask moves up), keeping what you typed and the selection.
* a11y: the input is a `combobox` with `aria-activedescendant` on the `listbox` rows; the result count is a polite live
  region; high contrast gets a black-bordered selection with a gold outline; reduced motion drops the pop-in.
* testids: `panel-palette`, `palette-input`, `palette-list`, `palette-item` (`data-kind` farmer / helper / answer /
  task / panel / action / line, `data-key` e.g. `f:<id>`, `a:<id>:<key>`, `p:<panel>:<arg>`, `m:pinned|muted:<id>`,
  `l:<id>:<fromEnd>`), `drawer-next`; `drawer-host[data-found]` = 1 / 0 after a scrollback hit opened the history.

## Scrollback search (`term.search`, protocol rev 5)

The server used to keep only what an agent last *said* (`lastText`, ≤ 280 chars). `server/world/scrollback.ts` keeps
more, bounded, read-only:

* **A ring per pane** (`LineRing`): the last `LIMITS.scrollbackLines` (2000) lines and at most
  `LIMITS.scrollbackBytes` (256 KB) of text, oldest dropped first; ANSI-stripped (`stripAnsi`), one line ≤ 1000 chars,
  each stamped with when the server first saw it. A closed pane's ring is dropped with its `gone`.
* **Fed from herdr's own scrollback**: `pane.read {source:'recent_unwrapped', format:'text', lines:400}`. The bottom
  `rows` lines of a read are the live screen (a TUI redraws them: spinners, the input box): kept apart and replaced on
  every read, so a spinner never piles up. The lines above have scrolled off and never change: `mergeTail` appends only
  what follows the ring's last lines (an anchor of ≥ 2 non-blank lines) in the new read; no anchor (a cleared screen,
  more output than one read) appends all of it.
* **Only once somebody searches**: a search re-reads panes read more than 8 s ago (4 at a time, 1.5 s per read, 2 s for
  the whole refresh; a slow pane answers from its ring). For 30 min after the last search a slow sweep (every 15 s, the
  8 stalest panes, one after another) keeps the rings growing past herdr's read window. No search, no reads.
* **The search** (`searchLines`): every word of the query in the line (case-insensitive); per pane the newest 4 distinct
  lines, then across panes by when the line was seen; ≤ `max` (24, ≤ `LIMITS.searchHitsMax` 40). Each hit: `{id, text
  (≤ 200 chars around the match, `…` where cut), match: [start, end), fromEnd, at, screen}` (`ScrollHit`); the reply also
  has `panes`, `lines` scanned and `more`.
* **Rate limited**: one search per client per 150 ms (`not_accepted`; the palette debounces and retries once).
  `term.search` is class `always` (read-only: allowed on a read-only herdr protocol); it never sends keys, resizes or
  runs anything. The demo answers the same `pane.read` from its fake terminals (banners, tool lines, shell output);
  a replay has no pane text and refuses. Metrics: `/api/metrics` → `scrollback`.

## Pin and mute (`model/marks.ts`)

Per agent, per browser: `Prefs.pinned` / `Prefs.muted` (pane ids, newest 64 kept, `sanitizeIds`) in the browser-local
prefs (localStorage `valley.hud.prefs` through `farm/storage.ts`), so they survive a reload. Toggles: the ledger row's
pin and bell buttons (`aria-pressed`; **Alt+P** / **Alt+M** on the selected row, also while typing in the filter), the
farmer card (buttons + Alt+P / Alt+M), the overview grid (Alt+P / Alt+M), the palette (`pin …`, `mute …`). Each toggle
toasts what it means.

* **Pinned**: first in the ledger (a *Pinned* group at the top, in pin order, out of their field's group), the needs-you
  strip (so Alt+1 is a pinned ask when there is one), the palette (a *Pinned* group) and the overview grid.
* **Muted**: no toasts for its letters, no desktop notification, no alert bell, done chime, far cheer / oops, no
  caption or screen-reader announcement, no harvest toast. Main.ts hands the scene the muted agent's noisy events
  (`NOISY`: blocked, finished, unblocked, celebrate, oops) marked `quiet` (`quietEvent`): the farmer still cheers and
  hops, `audio.ts` and the farmhouse bell stay silent (a farmer's own little positional sounds near you remain). **Asks
  still show**, quietly: in the needs-you strip (no new-ask ring, it does not wake a dozing strip, a struck-through
  bell with the explanation in its tooltip), in the mailbox and on the overview. The card says so under the buttons.

## The overview grid (V, rebindable)

`hud/overview.ts`: every farmer as a compact tile in a wrapping grid, for scanning 10–40 agents at once (3–5 columns
at 1600 px). Each tile: the status colour as a thick left edge and the status glyph (▲ ● ■ ◆; the colour-safe palette
recolours both), face, name, pin / mute marks, the job and then the current todo `(done/total)` or the question,
time in that state (or a gold **waiting 3m** badge for an ask) and today's cost. Order (`overviewOrder`): pinned, then
asks (longest waiting first), struggling, unreviewed finishes, working, idle, unknown; names within a rank, so it does
not reshuffle while you read. A summary line counts agents, asks, working, done, pinned.

* **V** opens it (Settings → Controls → *Overview of every agent*, `Prefs.keys.overview`; V was free: G and O are
  taken, R / X are used inside panels and by the yard), V or Esc closes; also from the palette ("overview").
* Keys (`gridMove`): arrows (left / right wrap rows, up / down keep the column), Home / End, PgUp / PgDn; **Enter** the
  terminal, **Shift+Enter** walk there, **C** or Ctrl+Enter the card, **Alt+P** / **Alt+M** pin / mute. A click selects,
  a double click opens the terminal.
* a11y: the grid is a focusable `listbox` with `aria-activedescendant`; each tile an `option` with a spoken summary
  (status, waiting / job, todo, cost, pinned / muted). testids: `panel-overview`, `overview-grid`, `overview-tile`
  (`data-id`, `data-st`), `overview-waiting`.

## The ledger filter

The ledger's text filter (Tab) also matches what each agent last said and its current todo, like the palette.

## Audit notes (Oct 2026, 10 agents in the `mixed` demo)

What already worked well: the strip + Alt+1…9 + mailbox `J 1 1 2` loop for asks, the drawer's ask bar, the ledger's
chips / day strips / new-task row button, background notifications. What hurt, and what was done:

* *Getting to a specific agent* meant Tab + filter or the map; there was no one place to type a name from inside a
  terminal → the palette.
* *Working through everything that wants you* (asks, then struggling agents, then finished work to review) meant
  juggling the strip, the ledger's chips and Ctrl+PgDn (which walks fields, not priority) → the focus queue / Alt+N /
  Next, which also work inside the drawer, where Alt+1…9 do not.
* *"Who was working on X?"*: neither the ledger nor any list searched what agents said or their todos → both do now.
* *Getting back*: opening a panel from the drawer dropped the terminal → the palette's Esc returns to it.

Done since (Oct 2026, second round): scrollback search in the palette (`term.search`), per-agent pin / mute, the
overview grid (V).

Left for later: batch actions (approve-all safe asks: needs a server-side notion of "safe", and confirmation); regex /
case-sensitive search and searching beyond herdr's own read window before the first search (the ring only starts filling
when somebody searches); a muted agent's own positional sounds near you; overview tiles for scarecrows (shells).
