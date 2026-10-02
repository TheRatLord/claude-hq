# Work signals

What the server knows about each agent beyond its status and job, and where the valley shows it. Read this before
adding a signal, changing how one is derived, or moving where one appears.

## Audit: known vs surfaced

| signal | server source | wire (`Entity`) | ValleyState | shown |
|---|---|---|---|---|
| status, blocked prompt + options, subject | herdr, `world/blocked.ts` | `status`, `prompt` | `FarmerView.status/needsYou/question/options` | everywhere (jobs, asks, mailbox) |
| current tool + detail, subagents | transcripts, subagents | `activity`, `subagents` | `job`, `tool`, `detail`, `ducklings` | farmer animation, nameplate, ducklings |
| task title, last prompt, last text | transcripts | `title`, `lastPrompt`, `lastText` | `title`, `said` | card, ledger, speech bubbles |
| lines / files of the task | transcripts (`editStats`) | `work` | `work`, plot `growth` | card, crop growth, stakes |
| struggle (fails, errors, no edits, context) | transcripts | `struggle` | `struggle`, `mood` | mood, letters |
| tests pass/fail, errors, compaction, commits, turn news | transcripts / procinfo events | `event` | letters, timeline marks, valley events | mailbox, Today timeline, celebrations, shipping bin |
| shell foreground process, ports, last exit | procinfo | `process` | `HelperView` | scarecrows, card |
| **agent CLI (vendor)** | herdr `pane.agent` label, else procinfo's process sniff (`shared/vendors.ts`) | **`vendor`** (rev 3; base-owned) | **`FarmerView.vendor`** → `mascotOf()` | **the mascot itself**, portrait, card / ledger / prompt name ('OpenCode') |
| **model id** | transcripts | `model`, `modelTier` | `tier` (hat) + **`model`** ('Opus 5.5') | hat; **card + ledger kind line** |
| **context tokens** | transcripts | `contextTokens` | **`context` against the real window**, `contextTokens`, `contextWindow` | **card bar + '82% · 164k of 200k', nameplate gauge** |
| **todo list** | transcripts (TodoWrite) | `todos` | `todos` counts + **`items` checklist** | **card checklist**, noticeboard |
| **git: branch, changed, ahead/behind, last commit** | **`enrich/git.ts` (new)** | **`git`** (rev 2) | **`FarmerView.git`, `HelperView.git`, `PlotView.git`** | **card, ledger group head, field sign + sign text; in the field: weeds, crates + push cart, sign pennant, upstream letter** |
| **token spend today (+ USD estimate)** | **transcripts usage (new)** | **`usage`** (rev 2) | **`FarmerView.spend`, `ValleyState.spend`** | **card, ledger column + total, Almanac** |
| commit subject | transcripts (git's `[branch sha] subject` / `-m`) | `commit` event `detail.msg/sha/branch` (rev 2) | letter body, timeline mark | mailbox, Today moments |
| output tokens | transcripts | `outputTokens` | — | not shown (spend supersedes it) |
| `res` (cpu / rss) | reserved, always null | `res` | — | card when present |

Not derived (no reliable source today): PR links, CI status, per-test names, permission-mode, Codex / Gemini usage
(their transcripts are not parsed; they show tokens only if a later enricher reports them).

## The signals

**Model** (`model/signals.ts modelLabel`): `claude-opus-5-5` → `Opus 5.5`, `[1m]` → `… 1M`, codex → `Codex`. The hat
still keys off `tier`; the label is HUD copy (card sub line, ledger rows via `kindLine`).

**Context** (`contextFill`): `contextTokens` over `shared/classify.ts contextWindow` (200k; 1M for `[1m]` ids or once a
context passes 200k), the same window the server's context struggle uses. Card: bar (amber > 65 %, red > 85 %) and
`82% · 164k of 200k`, `· compaction soon` past 85 %. Nameplate: a slim gauge under the name from 65 % (red past 85 %):
`WorldTag.meter`, set by `scene/farmers/farmers.ts`, drawn by `hud/anchors.ts`.

**Todo checklist** (`todoItems`): the TodoWrite list as `done / doing / todo` items, ≤ 12 (a long list shows a window
around the in-progress item). Card: progress bar, `n/m · current`, then the checklist (struck-through done items).

**Git** (`server/enrich/git.ts`, owner `git`; demo: `DemoWorld.gits`). Per pane cwd → work-tree root (`rev-parse
--show-toplevel`, cached 5 min, non-repos 1 min) → one `status --porcelain=v2 --branch` + `log -1` per root per 10 s
sweep, one git process at a time, 4 s timeout, `GIT_OPTIONAL_LOCKS=0` (never takes the index lock an agent may need). A
root whose status times out switches to `-uno` (untracked not counted). Parsers are pure (`enrich/gitState.ts`).
`dirty` = changed tracked + untracked files. The field's repo (`plotRepo`) is the root most of its panes share (agents
weigh double); `branches` counts distinct branches (worktrees). Shown: card `Branch main · 3 changed · 2 to push` and
`Last commit “…” · 28m ago` (farmers and scarecrows); ledger group head chip `feat/x · 4 changed · ↑1`; the field sign's
second line `on feat/x` (crop name when not a repo); reading the sign: weeds (changed files) and crates waiting to
ship (unpushed commits).

**Git in the field** (`scene/plots/git.ts` `FieldGit`, driven by `PlotView.git` from `field.ts`; gallery `field-git`
variants `feature | main | detached | cycle`, props `git-weed`, `git-pennant`):

* *Changed files = weeds*: dandelion tufts (rosette, a flower, a seed clock) in the furrows between the rows (open ground
  in pens / the orchard), front ones first, clear of every farmer spot, prop and plant (`gitWeedSpots`, seeded per
  plot). Count `weedCount(dirty)` = 1 + ⌊2.2 log₂ dirty⌋, ≤ 10 (1 → 1, 4 → 5, 8 → 7, 23+ → 10). When `dirty` drops
  (a commit) the extra weeds are pulled one after another: a tug, they pop out spinning with a dirt-and-leaf puff and
  one `pop`. Other drops (field closing, harvest) just wilt them away.
* *Unpushed commits = crates* stacked left of the field sign (one per commit, ≤ 5, popping in as commits land), past 5
  a chalk slate `+N` leans on the front crate. When `ahead` drops (a push) a cart rolls in along the front, the
  pushed crates (≤ 4) hop aboard and it trundles off toward the shipping bin's side, fading out; on arrival the bin's
  lid pops (structures service `shippingBin.ship()`, a soft creak). `ahead` null (no upstream) shows no crates.
* *Behind upstream = mail*: a sealed envelope `↓N` tucked under the sign's top beam.
* *Branch = pennant* on the sign's top beam, coloured by `branchColor` (FNV hash of the name into 7 colours);
  `main` / `master` fly the valley's own colour (Clawd terracotta, never used for other branches), a detached HEAD a
  plain grey. The sign's hover tag reads `hq-core sign · feat/x`; reading the sign lists weeds, crates and letters.
* Cost: two instanced batches (`plots:gitweed`, `plots:pennant`, no shadows) = +2 draw calls for every field; the
  crates, cart and the two little cards (`git:mail:N`, `git:chalk:N`, shared atlas slots by count) ride existing
  batches. No per-frame allocation (strings only when a count changes).

**Spend** (`TranscriptState._usage/usage`, `shared/pricing.ts`). Each assistant `message.id` counts once (streamed
repeats: the last usage block wins) on the local day its first line is stamped. Tokens = input + cache writes + cache
reads + output; cost = list price per model (cache writes at 1.25 × input, reads per the table), an estimate, never a
bill (1-hour cache writes and long-context premiums are not modelled; unknown models → tokens only). The 512 KB tail
misses the morning of a long session, so the enricher reads the file backwards from the tail (`scanHead`, usage lines
only, 1 MB chunks, yielding) until a line older than midnight; past 64 MB it stops and marks `partial` ("at least").
The day rolls on the server's local midnight; the renderer ignores a `usage.day` that is not its own today.
`ValleyState.spend` keeps each farmer's latest figure for the day (`SpendLedger`), so farmers who went home still
count. Shown: card `Today $1.02 · 2.0M tokens`; ledger column per farmer and `$64 today` in the summary; the Almanac's
Today card `Model spend: $64 · 120M tokens across 23 farmers`. Subagent transcripts (separate files) are not summed.

## Protocol

Additive, inside `PROTOCOL_VERSION` 1: `PROTOCOL_REVISION` 2 (sent as `hello.revision`) adds `Entity.git`,
`Entity.usage` (both optional on the type, always sent by a rev-2 server, `null` when unknown) and `detail.msg / sha /
branch` on `commit` events. Older servers and recordings simply lack them: the model reads absent as `null`, and every
presentation path handles `null`. The new View fields are optional on `FarmerView` / `HelperView` / `PlotView` /
`ValleyState` so hand-built views (gallery, scene tests) need not fill them; `createValley` always does.

## Demo

`DemoWorld` seeds every repo workspace (`WORKSPACES[].repo`) with a branch, a few changed files, maybe unpushed commits
and a last commit (`BRANCHES`, `COMMITS`); a task's first edit of a file adds a changed file, a commit clears them,
sets the last commit and stacks one unpushed commit (every other commit "pushes"). Each Claude gets a morning of spend
from its own seeded stream and grows it per tool step from the context it re-reads (`_spend`), so the schedule's random
sequence is untouched. Seeds go up to 7 unpushed commits (a `+N` slate) and are behind upstream one time in five.
`demo.force {git}` sets the workspace's repo. Shot recipe (commit pulls the weeds at 3 s, a push ships the crates at
7 s; `cam` = in front of the demo's `d1` gate):

```sh
F="window.F=(g)=>__valley.force(__valley.state().plots.d1.farmers[0],{git:Object.assign({root:'/w/claude-hq',branch:'main',head:'abc1234',dirty:12,untracked:2,ahead:8,behind:3,lastCommit:null},g)});F({})"
npm run shoot -- --shot "name=git,hour=10,weather=clear,hud=0,wait=1500,frames=16,every=700,cam=-16.84;2.95;11.26;2.618;-0.290,eval=$F;setTimeout(()=>F({dirty:0,untracked:0,ahead:9}),3000);setTimeout(()=>F({dirty:0,ahead:0,behind:0}),7000)"
```

## Tests

`shared/pricing.test.ts`, `server/enrich/usage.test.ts` (spend, read-back, commit subject), `server/enrich/git.test.ts`
(parsers, sweep grouping / caching / slow roots, a real scratch repo), `server/demo/world.test.ts` (rev-2 signals),
`renderer/src/farm/model/signals.test.ts` (helpers + valley end to end), `scene/plots/git.test.ts` (weed count, pennant colours, weed spots), `hud/format.test.ts` (copy),
`browser-tests/signals.spec.ts` (ledger, card, nameplate gauge).
