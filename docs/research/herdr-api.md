# herdr integration — verified findings

herdr 0.9.0, socket protocol 22, schema_version 1. Everything below was executed on this machine (2026-09-27) against the
headless test session `hqtest` unless marked *(default, read-only)*. Reference code: `docs/research/snippets/herdr.mjs`
(client + subscribe + terminal bridge), smoke test `snippets/term-demo.mjs` (passes). Fixtures: `scripts/hqtest-up.sh` / `hqtest-down.sh`.

## 0. Safety rules (hard)

- Default session socket: `~/.config/herdr/herdr.sock`. Named: `~/.config/herdr/sessions/<name>/herdr.sock`.
- **`--session default` resolution (verified 2026-09-27, read-only):** `herdr session list` maps `default` →
  `~/.config/herdr/herdr.sock` (directory `~/.config/herdr`). With `HERDR_*` scrubbed from the env,
  `herdr --session default workspace list` returned byte-identical output to `HERDR_SOCKET_PATH=~/.config/herdr/herdr.sock
  herdr workspace list`, and **no** `sessions/default/` directory or server was created. An unknown name
  (`--session hqprobe-nosuch workspace list`) returns `{"error":{"code":"server_not_running",…}}` (exit 0) and creates
  no directory and no process: CLI subcommands never auto-start a server (only bare `herdr` / `session attach` do).
  Therefore `socketFor()` in `snippets/herdr.mjs` and the `--session` passed to children agree. Still to re-verify in M1:
  the same for `terminal session observe` (hqtest pane; fake-bin argv log in tests). DESIGN §4.1 requires a successful
  `ping` on `socketFor(session)` before any child spawns.
- `--session <name>` **overrides** `HERDR_SOCKET_PATH` (verified: `herdr --session hqtest workspace list` returned hqtest's list while the env pointed at default). Still scrub `HERDR_SOCKET_PATH/HERDR_SESSION/HERDR_PANE_ID/HERDR_TAB_ID/HERDR_WORKSPACE_ID` from any child env.
- Backend must be session-parametrised (`--session hqtest` in dev). Mutating calls against default only on explicit user action.
- Focus calls (`workspace.focus`, `tab.focus`, `pane.focus`, `agent.focus`) move the user's real herdr UI. Only on an explicit "Show in herdr" button.
- Never run bare `herdr` (TUI) or `herdr server stop` (stops *whatever socket the env points at*). Use `herdr session stop hqtest`.

## 1. Wire protocol

- Unix stream socket, NDJSON. Request `{"id":string,"method":string,"params":object}` + `\n`. **`params` is required** (use `{}`); `id` must be a string.
- Success `{"id","result":{"type":"<result_type>",...}}`. Error `{"id","error":{"code","message"}}`.
- **One request per connection.** Server replies then closes; a 2nd line on the same connection is ignored (ECONNRESET/EPIPE). Open a fresh connection per call — cheap: `session.snapshot` avg **17 ms**, `pane.read` 5.5 ms, 50 parallel pings 100 ms.
- Parse/validation errors come back with `"id":""` and `code:"invalid_request"` (unknown method, missing field, wrong type, bad JSON) → match "first line on this connection", not by id.
- Domain errors keep the id: `pane_not_found`, `agent_not_found`, `agent_blocked`, `agent_not_ready`, `unsupported_event_wait_match`, … (string codes, stable enough to switch on).
- `ping` → `{type:"pong",version,protocol,capabilities:{live_handoff,detached_server_daemon,endpoint_protocol_generation,surface_interest,health_check}}`. Use for health/handshake; check `protocol===22`.
- Full schema: `herdr api schema --json` (275 KB; sections `request`, `success_response`, `error_response`, `event`, `subscription_event`). The server also accepts `pane.graphics.stream` (not in the schema).

## 2. Data model (fields as returned)

**WorkspaceInfo** `{workspace_id:"w1", number, label, focused, pane_count, tab_count, active_tab_id, agent_status /*rollup*/, tokens?, worktree?:{repo_name,repo_root,checkout_path,is_linked_worktree,repo_key}}`
**TabInfo** `{tab_id:"w1:t2", workspace_id, number, label /*defaults to the number as a string, e.g. "1"*/, focused, pane_count, agent_status /*rollup*/}`
**PaneInfo** `{pane_id:"w1:p3", terminal_id:"term_…", workspace_id, tab_id, focused, cwd, foreground_cwd, terminal_title?, terminal_title_stripped?, agent? /*kind: "claude"|"codex"|…|absent*/, agent_status, agent_session?:{source:"herdr:claude",agent,kind:"id"|"path",value /*claude session uuid*/}, display_agent?, label?, title?, state_labels?, tokens?, scroll:{offset_from_bottom,max_offset_from_bottom,viewport_rows}, revision}`
**AgentInfo** (≈PaneInfo minus scroll/label) `+ name? /*only if started/renamed with a name*/, interactive_ready?, launch_pending?, state_change_seq, screen_detection_skipped?`
**SessionSnapshot** `{version, protocol, workspaces[], tabs[], panes[], agents[], layouts[PaneLayoutSnapshot], focused_workspace_id?, focused_tab_id?, focused_pane_id?}` — 6 KB for 3 ws/4 panes *(default, read-only)*.
**PaneLayoutSnapshot** `{workspace_id, tab_id, zoomed, area:{x,y,width,height}, focused_pane_id, panes:[{pane_id,focused,rect}], splits:[{id,direction,ratio,rect}]}` — cell rects; handy for drawing a tab as a desk cluster / wall of monitors.

Notes
- IDs: workspace `w<N>` (default session also has letters, e.g. `wA`), tab `w1:t<N>`, pane `w1:p<N>`; pane numbers are per-workspace and never reused. `terminal_id` is stable for the life of the terminal.
- `agent_status ∈ idle|working|blocked|done|unknown`. Plain shells = `agent` absent, status `unknown`. `done` = finished while unseen (herdr's "unread" notion).
- `agents[]` ⊂ panes with a detected agent. `name` exists only for agents launched via `agent.start` or renamed (`agent.rename`); the user's hand-started Claudes have no name → display fallback: `name` → `terminal_title_stripped` (Claude sets this to its task summary, e.g. "Route stops display") → non-numeric tab label → basename(cwd).
- Claude's OSC title: `✳ <summary>` when idle, braille spinner prefix while working; `terminal_title_stripped` drops the glyph.
- `label/display_agent/state_labels/tokens/title` exist for plugins (`pane.report_metadata`) — absent in practice today. Workspace `tokens`/`worktree` likewise optional.
- Grouping keys available: `workspace_id/label/number` (the "space"), `tab_id/label`, `agent_status`, `agent` kind, `cwd`/`foreground_cwd` (project = basename; repo via `worktree.repo_name`), `focused`, tab/workspace rollup status, layout adjacency (split siblings). Derived: current tool / model / context from transcripts (§6).

## 3. Events

`events.subscribe {subscriptions:[{type}...]}` on a dedicated connection → ack line `{"id":"sub","result":{"type":"subscription_started"}}`, then one envelope per line: `{"event":"pane_created","data":{"type":"pane_created","pane":PaneInfo}}`.

Global types (no params): `workspace.created|updated|metadata_updated|renamed|moved|reordered|closed|focused`, `worktree.created|opened|removed`, `tab.created|closed|focused|renamed|moved`, `pane.created|closed|updated|focused|moved|exited|agent_detected`, `layout.updated`.
Envelope `event` uses underscores (`pane_created`), subscription `type` uses dots (`pane.created`).

Payloads: `workspace_created/updated/metadata_updated {workspace}`; `workspace_closed {workspace_id, workspace?}`; `workspace_renamed {workspace_id,label}`; `workspace_moved|reordered {…, workspaces[]}`; `workspace_focused {workspace_id}`; `tab_created {tab}`; `tab_closed|focused {tab_id,workspace_id}`; `tab_renamed {tab_id,label}`; `tab_moved {tabs[]}`; `pane_created|updated {pane: full PaneInfo}`; `pane_closed|focused|exited {pane_id,workspace_id}`; `pane_moved {pane, previous_*, created_tab?, closed_tab_id?…}`; `pane_agent_detected {pane_id, agent|null, final_status?, released?}`; `layout_updated {layout}`.

Parametrised types (per pane, **`pane_id` required**):
- `{type:"pane.agent_status_changed", pane_id, agent_status?}` → event `pane.agent_status_changed` `{pane_id, workspace_id, agent, agent_status, display_agent?, title?, state_labels?}`. Fired within ~0.6 s of a Claude turn start/end.
- `{type:"pane.output_matched", pane_id, source, match:{type:"substring"|"regex",value}}` → `{matched_line, read:PaneReadResult}` (worked for regex; one substring attempt didn't fire — treat as best-effort).
- `{type:"pane.scroll_changed", pane_id}` → `{pane_id, scroll}`.
- A nonexistent `pane_id` fails the **whole** subscribe (`pane_not_found`); there is no `pane.output_changed` subscription.

Observed firing (Claude turn: idle→working→idle):
- `pane.agent_status_changed` working, `pane_updated` (only because the OSC title changed), `pane.agent_status_changed` idle. **No `pane_updated`, `workspace_updated` or tab event for the working→idle transition.** ⇒ global events alone cannot track status.
- Agent exit: `pane_updated` (agent→null) + `pane_agent_detected {agent:"claude", final_status:"idle", released:true}`; restart: `pane_agent_detected {agent:"claude"}` then `pane_updated`.
- Plain output (e.g. `seq 1 80`) emits nothing globally; `scroll_changed` fires if subscribed.
- Server stop → subscription socket closes (EOF). Must reconnect + resubscribe + resnapshot.
- `events.wait` only supports `pane_agent_status_changed` matches (`unsupported_event_wait_match` otherwise).

### Live-model recipe (recommended)
1. `ping` (protocol check) → open **structural sub** (all global types) → buffer events → `session.snapshot` → apply snapshot, then buffered events.
2. **Status sub**: one extra connection per agent pane with `[{type:"pane.agent_status_changed",pane_id}]` (per-pane connections so a closed pane can't poison others; rebuild on `pane_created/agent_detected/pane_closed`). Gives instant transitions for animation (anticipation poses, "done!" emotes).
3. **Reconcile**: debounced (80 ms) snapshot after any structural event + periodic snapshot every 1–2 s (17 ms each). Snapshot is the source of truth; events are latency hints. This also covers rollup statuses and `workspace_updated` gaps.
4. On subscription EOF / ECONNREFUSED: mark "herdr offline", retry every 2 s, redo 1–3. Keep last world visible (characters "asleep").
5. Shell foreground program: `pane.process_info` every 2–3 s for shell panes (see §5).

## 4. Terminals for xterm.js

| command | stream | needs TTY | writers | notes |
|---|---|---|---|---|
| `herdr terminal session control <target> [--takeover] --cols C --rows R` | NDJSON frames on stdout, NDJSON commands on stdin | **no** (plain pipes) | 1 | **use this** |
| `herdr terminal session observe <target> --cols C --rows R` | same frames | no | 0 (input ignored) | unlimited, no side effects |
| `herdr terminal attach <terminal_id> [--takeover]` | raw ANSI to its own TTY | **yes** — fails `Not a tty` on pipes; works under `script` | 1 | would need node-pty/script + raw keys; no benefit |
| `herdr agent attach <agent> [--takeover]` | same as terminal attach | yes | 1 | agent targets only (`agent_not_found` for shells) |

`<target>` accepts pane id (`w1:p2`), terminal id, or agent name (`scout`).
stdout: `{"type":"terminal.frame","encoding":"ansi","full":bool,"seq":n,"width","height","bytes":"<b64>"}` … `{"type":"terminal.closed","reason":"…"}`.
- Frames are **rendered-screen updates**, not raw PTY bytes: the first frame (and every frame after a resize) is `full:true` (starts `ESC[2J`), later ones are cell diffs; all wrapped in `ESC[?2026h … ESC[?2026l` (synchronized output). `xterm.write(Uint8Array)` them verbatim. Don't grep frames for text (diffs split words); use `pane.read` for text.
- stdin commands: `{"type":"terminal.input","text":"ls\r"}` | `{"type":"terminal.input","bytes":"<b64>"}` | `{"type":"terminal.resize","cols","rows"}` | `{"type":"terminal.scroll","direction":"up"|"down","lines":n}` (control only: scrolls the pane's **global** herdr scroll offset, i.e. the user's view too; ignored by observe, §4.1) | `{"type":"terminal.release"}` → `terminal.closed reason:"detached"`, exit 0.
- xterm `onData(str)` → `input.text`; `onBinary` → `input.bytes`; `onResize` → `terminal.resize` (control only).
- **stdin EOF ⇒ immediate detach (control children; observe children ignore EOF and release, see §4.1).** Keep the pipe open for the session's lifetime.
- Exit code is 0 even on failure; inspect `terminal.closed.reason`:
  - `terminal attach failed: terminal term_… already has an attached client; retry with --takeover` (2nd controller w/o takeover)
  - `terminal attach taken over` (sent to the old controller when a new one uses `--takeover`)
  - `terminal attach ended: terminal term_… not found` (pane closed while attached)
  - `terminal session control failed: terminal target w9:p9 not found`
- Sizing/side effects:
  - `control` **resizes the pane PTY** to `--cols/--rows` (pane `scroll.viewport_rows` changes immediately). herdr layout changes while controlled (split/zoom) do **not** override the controller size.
  - The user's herdr **TUI client is not a "terminal client"**: no takeover needed while they view the pane; their UI keeps working but shows the pane at our size until we detach.
  - With a TUI client attached, **any** detach (release, SIGTERM, stdin EOF) snaps the pane back to its layout rect. With no TUI client attached, the last controller size sticks until a client/layout sizes it — harmless. (The prior art's manual "resize back to `pane.layout` rect before release" is optional; keep a cheap version: release on close.)
  - `observe` renders at its **own** `--cols/--rows` (observers got 120×40 while controller was 80×24) and never resizes the PTY. Ideal for read-only in-world monitors / spectators.
- Multiple viewers: one controller per pane (herdr enforces). Backend owns a single control child per pane and fans frames out to all UI viewers; late joiners get frames since the last `full` frame (or trigger a fresh full frame via a resize). Resize policy: last focused viewer wins.
- Takeover policy: open without `--takeover`; on "already has an attached client" show "Take over (disconnects the other attach)" → reopen with `--takeover`. The only other controllers are `herdr agent/terminal attach` users and other Claude HQ instances.

Working snippet (full version with helpers in `snippets/herdr.mjs`):
```js
import { spawn } from 'node:child_process';
const env = { ...process.env }; delete env.HERDR_SOCKET_PATH;
const c = spawn(`${process.env.HOME}/.local/bin/herdr`,
  ['--session', 'hqtest', 'terminal', 'session', 'control', 'w1:p2', '--cols', '100', '--rows', '30'],
  { env, stdio: ['pipe', 'pipe', 'pipe'] });           // no PTY; keep stdin open
let buf = ''; c.stdout.setEncoding('utf8');
c.stdout.on('data', (d) => { buf += d; for (let i; (i = buf.indexOf('\n')) >= 0;) {
  const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (m.type === 'terminal.frame') ws.send(Buffer.from(m.bytes, 'base64'));   // → xterm.write(new Uint8Array(data))
  else if (m.type === 'terminal.closed') console.log('closed:', m.reason); } });
const send = (o) => c.stdin.write(JSON.stringify(o) + '\n');
send({ type: 'terminal.input', text: 'echo hi\r' });
send({ type: 'terminal.resize', cols: 120, rows: 40 });
send({ type: 'terminal.release' });                    // graceful detach
```
Verified by `node docs/research/snippets/term-demo.mjs w3:p3 hqtest` → `closed: detached {frames:3, bytes:6816, sawEcho:true}`; also driven against a live Claude TUI by agent name (`control scout`): full redraw, `/` command menu appeared, `ESC` via `bytes:"Gw=="`.

### 4.1 Scroll and observe-child lifecycle (verified 2026-09-27 on hqtest, pane `w3:p3` with ~590 lines of scrollback)

| Experiment | Result |
|---|---|
| `terminal.scroll up 20` on an **observe** child | **Ignored**: no new frame on that child or on a second observer; `pane.get → scroll.offset_from_bottom` stays 0 |
| `terminal.scroll up 20` on a **control** child | Pane-global: `offset_from_bottom` 0 → 20; `pane.read {source:'visible'}` returns the scrolled screen (last visible tick 8 min older); a concurrent observer receives a frame. It moves the **user's own herdr view** of the pane |
| `terminal.scroll down 20` on control | Offset back to 0 |
| `terminal.release` on an **observe** child | No `terminal.closed`, process keeps running |
| stdin EOF on an **observe** child | No `terminal.closed`, no exit after 3 s (6 s total) → had to SIGTERM (exit signal SIGTERM) |
| `terminal.release` on a **control** child | `terminal.closed reason:"detached"` promptly |

Consequences for HQ (DESIGN §4.7, §8.6): scrollback is served locally from `pane.read {source:'recent', format:'ansi',
lines}` into a read-only overlay; `terminal.scroll` is only an opt-in for the control writer and the hub sends
`scroll bottom` before release; observe children are ended with SIGTERM (then SIGKILL after 1 s), never by waiting for
`terminal.closed`. Check: `pane.read {source:'recent', format:'ansi', lines:200}` returned 199 CRLF-separated lines,
`truncated:true`, 3 KB (write it into xterm as-is). The earlier line "stdin EOF ⇒ immediate detach" holds for **control** children only.

## 5. Mutations & reads

| goal | call | result / notes |
|---|---|---|
| new space | `workspace.create {label, cwd, focus:false}` | `{workspace, tab, root_pane}`. First workspace in an empty session becomes focused regardless. |
| new desk (tab) | `tab.create {workspace_id, label, cwd, focus:false}` | `{tab, root_pane}` |
| split | `pane.split {target_pane_id, direction:"right"\|"down", focus:false, cwd?, ratio?}` | `{type:"pane_info", pane}` |
| run in shell | `pane.send_text {pane_id, text:"cmd\n"}` · `pane.send_input {pane_id, text, keys:["Enter"]}` · `pane.send_keys {pane_id, keys:["C-c","Up","Enter"]}` | `{type:"ok"}`; CLI `herdr pane run <pane> <cmd>` |
| start agent | `agent.start {name, kind:"claude", pane_id, args:[], timeout_ms?}` | pane must be at a shell prompt. **Socket call returns immediately** (`launch_pending:true`); poll `agent.get` / wait for `interactive_ready`. CLI `herdr agent start` waits (default 30 s) and errors `agent_not_ready` if the agent sits on a startup dialog (e.g. folder trust) — agent is then `blocked`. `args:["--resume",<session>]` resumes. |
| prompt | `agent.prompt {target, text, wait?:{timeout_ms, until?}}` | rejects `agent_blocked` if blocked; with `wait` returns after the turn (4.5 s for a 1-tool turn) |
| keys to agent | `agent.send_keys {target, keys}` | two `C-c` exits Claude (→ `pane_agent_detected released:true`) |
| read screen | `pane.read {pane_id, source:"visible"\|"recent"\|"recent_unwrapped"\|"detection", format:"text"\|"ansi", lines?}` / `agent.read {target,…}` | `{read:{text, revision, truncated}}`. `detection` = region herdr's detector sees (blocked prompts: question + options). Use `visible`+`ansi` for in-world monitor textures at ≤1 Hz for nearby panes only. |
| process | `pane.process_info {pane_id}` | `{process_info:{shell_pid, foreground_process_group_id, foreground_processes:[{pid,name,argv,cmdline,cwd}]}}` — e.g. `watch -n 2 uptime`, `python3 -m http.server`, `bash` when idle. Drives shell-character activities. |
| why this status | `agent.explain {target}` | detector rules + evidence (debug overlay material) |
| close | `pane.close {pane_id}` / `tab.close` / `workspace.close` | closing the last pane closes the tab/workspace |
| herdr toast | `notification.show {title, body?, sound?}` | `{shown:false, reason:"disabled"\|"no_foreground_client"…}` |
| focus in herdr | `workspace.focus` → `tab.focus` → `pane.focus` (or `agent.focus`) | user-visible; explicit action only |

Blocked prompts: read `source:"detection"`; Claude's menus look like `❯ 1. Yes / 2. … / Esc to cancel` (tinker fixture shows the folder-trust dialog `❯ No, exit / Yes, I trust this folder`). Answer via `pane.send_keys` (`["Down","Enter"]` or digit keys) — never `agent.prompt` (rejected while blocked).

Persistence: herdr saves `sessions/<name>/session.json`; on server restart it restores workspaces/tabs/panes and re-runs `claude --resume <agent_session>` in former agent panes. Headless servers survive their parent shell (setsid).

### 5.1 What clears `done` (verified 2026-09-27 on hqtest)
Setup: `pane.focus w1:p2` (so scout is unfocused), `agent.prompt scout "Reply with exactly: OK" --wait` → scout `done`
(`state_change_seq` 1 → 4). Then, in order, checking `agent.get` after each:

| Action | Status after |
|---|---|
| `pane.read visible`, `pane.read detection`, `agent.explain` | done |
| `terminal session observe w1:p1` for 3 s | done |
| `terminal session control w1:p1` for 3 s + `terminal.release` | done |
| control `terminal.input` "x" then DEL; `pane.send_keys ["x"]` | done |
| `pane.focus w1:p1` | **idle** (`focused:true`) |

- Only focusing the pane clears `done`; a pane focused when its turn ends goes straight to `idle`.
- `state_change_seq` increments on every status transition: use it to key HQ-side acknowledgements.
- `pane.send_keys` key names: `Backspace` works, `BSpace` → `invalid_key`.
- Reproduce: a ~40-line node script (one `net` request per call + one spawned `terminal session` child) against the
  hqtest socket; costs one tiny prompt per run.

## 6. Claude Code transcripts

- Path: `~/.claude/projects/<slug(cwd)>/<agent_session.value>.jsonl`, slug = cwd with every non-`[A-Za-z0-9]` char → `-` (`/home/david/claude-hq` → `-home-david-claude-hq`). Fallback: scan `~/.claude/projects/*/<id>.jsonl` (70 dirs here; rate-limit to 1 scan/10 s per missing id).
- **Created lazily on the first user message** — a freshly started idle Claude has an `agent_session` id but no file yet.
- **Env gotcha**: a Claude spawned in a pane that inherited `CLAUDECODE`/`CLAUDE_CODE_*` (e.g. herdr server started from inside Claude Code) shows "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION" and writes nothing. hqtest-up.sh starts the server with `env -i`. Real user sessions are fine.
- Sizes up to 22 MB → tail: on first open read the last 512 KB (drop the partial first line), then `fs.watch(file)` + 1–2 s stat poll fallback, read only `[offset, size)`, keep a partial-line buffer, reset if size shrinks.
- Line `type`s seen: `user`, `assistant`, `attachment` (hook_success, total_tokens_reminder, …; ignorable), `ai-title {aiTitle}`, `last-prompt {lastPrompt}`, `mode`, `permission-mode`, `system {subtype}`, `file-history-snapshot`, `atis-latch`.
- **Assistant content blocks are split across lines**: each line has one block (`thinking` | `text` | `tool_use`) but repeats the same `message.id`, `requestId`, `message.usage`. De-dup usage by `message.id`.
- Derivations:
  - current tool = last `tool_use` (`name`, `input`, `id`) with no matching `tool_result` (`user` line, `content[].type=="tool_result"`, `tool_use_id`, `is_error`); `toolUseResult` on that line has structured results (Bash: `{stdout,stderr,interrupted}`). Last block `thinking` → "thinking", `text` → "talking"; `stop_reason:"end_turn"` → turn over.
  - last prompt = `last-prompt.lastPrompt`, or latest `user` whose `message.content` is a string and `isMeta` falsy and not starting with `<command-`/`<local-command`.
  - title = `ai-title.aiTitle` (≈ herdr's `terminal_title_stripped`).
  - model = `message.model` (e.g. `claude-opus-5-5`); context tokens = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of the latest assistant message (35 k for a trivial turn); output tokens = Σ `output_tokens` over unique `message.id`.
  - todos: `TodoWrite` `input.todos[{content,status,activeForm}]` if used (none in the last 2 days of transcripts here — keep optional; tool mix observed: Bash, Read, Write, WebSearch, Edit, WebFetch, Agent, Workflow, Skill, ToolSearch, Monitor, TaskStop, AskUserQuestion, mcp__*).
  - `AskUserQuestion` tool_use pending ≈ Claude asking the user (pairs with herdr `blocked`).
- Subagents: files `<session>/subagents/agent-<id>.jsonl` + `agent-<id>.meta.json {agentType, description, toolUseId, requestShape:"foreground"|"background"}`; workflow subagents under `<session>/subagents/workflows/<wf_id>/` plus `journal.jsonl` (`launched`, `started {agentId,label,phase}`, `result`). Background `Agent` calls return a `tool_result` immediately (`toolUseResult.status:"async_launched"`), so "open Agent tool_use" undercounts ⇒ **active subagents = subagent files with mtime < ~30 s** (cheap `readdir`+`stat` every 2 s). Great for spawning mini-helper characters.
- Other kinds: `codex` sessions live in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`session_meta`, `turn_context`, `response_item`, `event_msg:{task_started,token_count,agent_message,task_complete}`); codex isn't installed here — treat non-Claude agents as herdr-status-only.

## 7. Test session (hqtest)

- Start headless: `env -i HOME… PATH… setsid herdr --session hqtest server &` (socket appears in <1 s). Stop: `herdr session stop hqtest`; wipe restore state: `herdr session delete hqtest`.
- `scripts/hqtest-up.sh` (idempotent; `HQ_FRESH=1` rebuilds; `HQ_CLAUDES=0|1|2`, default 2; ~8 s):
  - `w1 hq-core` (~/claude-hq): tab `claude` = agent **scout** (idle), tab `dev` = shell | `top -d 3`
  - `w2 hq-sandbox` (/tmp/hqtest-sandbox, git repo): tab `claude` = agent **tinker** (**blocked** on folder-trust dialog — free, great demo of "stuck"), tab `git`
  - `w3 ops` (/tmp): tab `monitors` = `watch -n 2 uptime` / `python3 -m http.server`, tab `logs` = tick loop
  - No prompts are ever sent (cost ≈ 0). To see `working`, prompt scout manually: `herdr --session hqtest agent prompt scout "…" --wait`.
- `scripts/hqtest-down.sh`: stop + delete + kill stray `--session hqtest terminal session` children.
- Driving a TUI client for side-effect tests: `sleep 100 | script -qfec "stty cols 160 rows 50; herdr --session hqtest" /dev/null &` and **kill the client process** (`pkill -f "herdr --session hqtest$"`) — letting `script` see stdin EOF types ^D into the focused pane and kills its shell.

## 8. Recommended integration design

- Backend (Node, shared by Electron main and `--web` server): `HerdrClient` (conn-per-request), `World` (structural sub + per-agent status subs + 1–2 s snapshot reconcile + process_info poll + transcript tails + subagent dir scan) → emits normalized `Entity` diffs over WebSocket; `TerminalHub` (one `control` child per open pane, fan-out, replay since last full frame, release when last viewer closes, takeover on explicit request); `observe`/`pane.read` for monitors.
- Entity key = `pane_id`; kind = `agent` ?? `"shell"`; name per §2 fallback; group by workspace/tab/status/project; activity from transcript (Claude) or `process_info` (shells); `blocked` → parse `detection` read for the question + options, answer with `send_keys`.
- Session selection: `--session <name>` flag / `CLAUDE_HQ_SESSION`, default `default`; show the session name in the HUD so tests against `hqtest` are obvious.
