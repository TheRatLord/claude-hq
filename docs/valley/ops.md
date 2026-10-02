# Operating many agents: the command palette and the focus queue

What a power user running 6–12 agents for a whole day reaches for, besides the ledger, the mailbox and the needs-you
strip ([hud.md](hud.md#the-power-user-loop-515-agents)): one search box for everything (**Ctrl+K**, ⌘K on a Mac) and
one key that always takes you to the next agent that wants you (**Alt+N**).

Key sources: `model/ops.ts` (pure: `fuzzyScore`, `fieldsMatch`, `snippet`, `focusQueue`, `nextFocus`; `ops.test.ts`),
`hud/palette.ts` + `palette.css` (the palette panel), `hud/hud.ts` (the keys, `focusNext` / `focusPeek`, where Esc goes
back to), `hud/drawer.ts` (the Next button), `hud/roster.ts` (the ledger filter), `browser-tests/ops.spec.ts`. Paths
are relative to `renderer/src/farm/` unless rooted.

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
* Only offered once you type: **answers** to open asks (`pebble yes`, `<tag> answer <option>`: Enter sends that
  option, same path and toast as the strip) and **New task for …** (idle / finished farmers: the card with the task box).
* **Panels and actions**: ledger, mailbox (Needs you), map, terminals, noticeboard, stats, almanac, projects, gazette,
  notebook, collections, pockets, friends, album, settings, all keys, *Next who needs you*, toggle the minimap; each
  shows its key.
* Keys: ↑/↓ (PgUp/PgDn) choose, **Enter** go (an agent: its terminal), **Shift+Enter** walk there, **Ctrl+Enter** the
  card (with the new-task box when they are free). **Esc** (or Ctrl+K again) **goes back** to where you were: the
  terminal (same agent) or panel the palette was opened over; the valley otherwise.
* Live: it refreshes at 4 Hz while open (a new ask moves up), keeping what you typed and the selection.
* a11y: the input is a `combobox` with `aria-activedescendant` on the `listbox` rows; the result count is a polite live
  region; high contrast gets a black-bordered selection with a gold outline; reduced motion drops the pop-in.
* testids: `panel-palette`, `palette-input`, `palette-list`, `palette-item` (`data-kind` farmer / helper / answer /
  task / panel / action, `data-key` e.g. `f:<id>`, `a:<id>:<key>`, `p:<panel>:<arg>`), `drawer-next`.

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

Left for later: batch actions (approve-all safe asks: needs a server-side notion of "safe", and confirmation), per-agent
pin / mute, a compact overview grid of all agents, searching scrollback beyond the last message (the server keeps
only `said`, ≤ 280 chars; a server-side `term.search` over herdr scrollback would be the real thing).
