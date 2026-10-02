# Harvest recaps

When an agent stops, the useful question is *what did it just do?* A harvest recap answers it at a glance: a postcard
for one stretch of work (duration, commits shipped, lines / files changed, tests, todos ticked off, tokens spent, the
context left and the agent's closing message), with a read-only diffstat one key away.

Key sources: `model/recap.ts` (pure + `recap.test.ts`: the recorder, stretches, copy, `recapDiffQuery`, `demoRecaps`),
fed by `model/valley.ts` (`tick` → `observe`, `ingest` → `event`, `harvested()` → the letter + the `harvested` valley
event) and read as `ValleyState.recaps`; `hud/recap.ts` + `recap.css` (the postcard panel `recap`, the card's "Last
harvest", the toast), `hud/recapfmt.ts` (pure copy: `recapfmt.test.ts`); the server's `git.diff`
(`server/enrich/gitDiff.ts` live, `DemoWorld.diff` in `--demo`, routed by `server/world/actions.ts`); `main.ts`
(persistence, the demo seed); `browser-tests/recap.spec.ts`. Paths are relative to `renderer/src/farm/` unless rooted.

## What counts as a stretch (model)

* A **stretch** opens when a farmer starts working (`working`; `blocked` asks stay inside it). If the valley first
  meets a farmer already mid-task (a reload, a new window) the stretch dates from the task's start (`work.since`) and
  is marked `partial` (spend and commits before then are not counted).
* It **closes** on a `finished` event (after `FINISH_LAG_MS`, 1.5 s, so the closing message and counters arrive), after
  `SETTLE_MS` (12 s) resting idle / done (a focused pane goes idle, not done: no finished event), or `LOST_MS` (30 s)
  after the farmer was last seen (went home → `end: 'left'`; the valley was closed → it ends where it was last seen).
  A return to work within the settle time continues the same stretch.
* It is **meaningful** (and becomes a `Recap`) with ≥ `MIN_ACTIVE_MS` (60 s) of work, or any commit (a ship event
  always counts), changed line or test run; anything less is dropped silently. One stretch → one recap: a commit
  mid-stretch does not cut it.
* Gathered while open: commits (`commit` events: subject + sha), test passes / fails (+ the last result), tool
  errors, asks and time waited on you, active time; lines / files from the task's `work` counters (a new prompt
  mid-stretch banks the earlier task; a task already under way when the stretch opened counts only its growth); spend
  = today's `usage` at the end minus at the start (a day roll counts only the new day); todos ticked off = completed
  at the end that were not at the start; the HEAD at the start and the end, dirty files and unpushed commits at the end.
* Bounded and persisted: `RECAP_KEEP` (8) per farmer, newest first; `RECAP_FARMERS` (48, the stalest go); open
  stretches persist too, so a reload mid-task continues it (dropped after 12 h). localStorage
  `claude-valley.recaps.v1` through a `RecapStore` (saves throttled to `SAVE_MS`, a closed recap at once; `pagehide`
  flushes). `parseRecaps` coerces anything (`model/robust.test.ts` fuzzes it).

Copy (pure, shared by toast, letter, card, ledger): `recapHeadline` (*Shipped 2 commits*, *Stopped with tests
failing*, *Changes ready to review*, …), `recapLine` (`2 commits · +120 −30 in 6 files · tests green · 3 todos done ·
42 min`), `recapDur`.

## Where it shows (HUD)

* **The notification.** A toast when a stretch ends (`harvestToast`): `flint: Shipped a commit` + the facts line. If
  that farmer's "finished" toast is still up it is *replaced in place* (`ToastSpec.replaceKey`, no ×2); clicking opens
  the postcard (`ToastSpec.open`). Like every background toast it waits while a big panel is up. The finished letter
  gets the recap (`Letter.recap`, its body becomes title · facts line) and a **View harvest** button in the mailbox; a
  stretch that ended idle (no finished event) posts a "wrapped up" letter with the recap on it (no second toast).
* **The postcard** (panel `recap`, a side sheet in the card's place, `light`): face + name, headline, *Finished 12m ago
  · took 42 min · waited on you 4 min (1 ask)*, the task, the closing message, then Shipped (commit list with shas),
  Lines, Tests, Errors, Todos (the ticked list), Spent, Context, Branch (+ what was left uncommitted / to push), Model.
  Actions: **Open terminal** (T, focused on open), **View changes** (D), **Farmer card** (C), Walk there. ← / → (or
  [ / ]) page through older / newer recaps. `__hud.open('recap', key | farmerId | { key, diff: true })`.
* **View changes** asks the server for `git.diff` (below): a header (`6 files · +120 −30` and the range: *what this task
  committed* when it committed and left a clean tree, else *→ the working tree now*, which also holds later changes),
  then one button per file (status letter, dir dimmed, counts, an add / remove bar; Tab reaches them). Enter / click
  shows that file's patch under it (coloured, ≤ 48 KB, scrolls); again hides it. A farmer who went home cannot be
  diffed (the repo is found through its pane).
* **The farmer card → Last harvest** (`card-harvest`, above *Today*): the newest recap as one button (headline, when,
  title, chips) and the earlier ones as rows; R in the card opens the newest.
* **The ledger**: a small basket chip in the farmer's row (`2↑` commits, `+120` lines, or ✓) with the facts in its
  tooltip; click it, or R on the selected row.

## `git.diff` (server, protocol rev 4)

`git.diff {id, from?, to?, path?}` → `reply {ok, diff: DiffResult}` (`shared/protocol.ts`: files with status / counts,
totals, `more` past `LIMITS.diffFilesMax`, and `patch` for `path`). Action class `always`: it is **read-only** and
allowed even on a read-only herdr protocol. The repo is the root the git enricher found for that pane's cwd
(`Entity.git.root`); the client never names a path to run in. `from` / `to` must be hex shas (validated) and are
verified as commits (`rev-parse --verify`); a `path` must be one of the listed files and is passed as a `:(literal)`
pathspec. Every git call: `GIT_OPTIONAL_LOCKS=0`, `-c core.fsmonitor=false`, `--no-ext-diff --no-textconv`, a 4 s
timeout, one git process at a time across requests, the file list cached 10 s. Untracked files (working-tree diffs
only) are counted and shown by reading them directly, only regular files inside the work tree with no symlink on the
way, ≤ 512 KB. The demo answers from its own edit log (`DemoWorld.edits`: every demo edit tagged with the HEAD it landed
on, so ranges between commits are exact) and seeds a stable diffstat for HEADs it never had (the seeded morning).
Older servers (rev < 4) are detected from `hello.revision`; the postcard then says diffs need a newer HQ.

## Demo

The demo valley keeps recaps in memory and seeds every farmer it meets with 1–3 plausible recaps earlier today
(`demoRecaps`: titles, closing messages, commits, tests, todos, spend; deterministic per farmer and day). `?recaps=0`
skips the seed. Live demo stretches produce real recaps (lines from the demo's `work`, commits, test events, the closing
summary); run with `--timescale 8` to see several within a minute. The seeded recaps' diffstats are seeded too, so their
numbers need not match the recap's own line counts.

## Dev

`__valley.recaps()` → per farmer the count + newest headline / line; `recaps(id)` → that farmer's recaps; `recaps(id |
'*', 'seed')` (demo) adds a seeded history.

```sh
npm run shoot -- --shot "name=recap,pose=hub,wait=2500,eval=__hud.open('recap',{key:[...__valley.ctx.valley.recaps.farmers.keys()][0],diff:true})"   # the postcard + diff
npm run shoot -- --shot "name=recapc,pose=hub,wait=2500,eval=__hud.open('card',[...__valley.ctx.valley.recaps.farmers.keys()][0])"                 # card → Last harvest
npm run shoot -- --timescale 8 --shot "name=live,pose=hub,wait=60000,log=JSON.stringify(__valley.recaps())"                                        # live recaps
npm run build && npx playwright test browser-tests/recap.spec.ts --output scratch/pw-recap
```

## Tests

`model/recap.test.ts` (stretches, settle / finish / left, banking, persistence, demo, through the valley),
`model/robust.test.ts` (stored garbage), `hud/recapfmt.test.ts`, `server/enrich/gitDiff.test.ts` (parsers, read-only
flags, the queue, a real scratch repo incl. a symlink out of the tree), `server/demo/world.test.ts` (demo `git.diff`),
`server/world/actions.test.ts` (routing), `shared/protocol.test.ts` (validation), `browser-tests/recap.spec.ts`.
