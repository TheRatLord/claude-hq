# Claude HQ

A cozy first-person 3D office where every [herdr](https://herdr.dev) agent pane is a little clay character. Claude
agents are Clawds, Codex agents get their own body, and plain shells are CRT robots. You walk up to your agents to see
what they are doing, what they are stuck on, and what they just finished. You answer their questions at the Help Desk,
sign off finished work with a high-five, and open real terminals into their panes. The building itself shows your
machine: a RAM lava column, one server rack per CPU core, a GPU gauge and a Big Board over the Pit.

Everything is procedural (geometry, textures, sounds) and nothing is loaded from the network. It runs as a web page
(the main way to use it, over an SSH tunnel) or as an Electron app.

## Requirements

| | |
|---|---|
| OS | Linux (primary) or macOS for the backend. Any desktop OS with a recent Chrome, Edge or Firefox for the web client |
| Node | **24 or newer** (`node --version`) |
| herdr | Installed, with its server running (`herdr` in your terminal). HQ speaks herdr socket protocol 22. If the version doesn't match, HQ runs read-only |
| GPU | WebGL2. HQ is tuned for an AMD Radeon 780M iGPU: 60 fps at the medium tier with a dozen agents. Weaker GPUs drop the quality tier automatically, and you can choose one in Settings |
| Electron (optional) | Needs a display. On Linux it uses ANGLE on Vulkan (`--use-angle=vulkan`); on macOS it keeps Chromium's default (Metal) |

## Install

```sh
git clone <this repo> claude-hq && cd claude-hq
npm ci
npm run doctor        # checks herdr, the socket, the GPU bits, and prints the command to run
```

## Run

| Command | What you get |
|---|---|
| `npm run serve` | **Web mode.** Builds the renderer, starts the backend on `127.0.0.1:7462` and prints a URL with a token. Open it in a browser |
| `npm start` | **Electron.** Builds, then opens a window with the backend running in-process. It also sets up a tray icon, badge, global hotkey and notifications (below) |
| `npm run serve -- --demo` | A simulated office with 12 agents. It never touches herdr, so it's good for a first look |
| `npm run serve -- --session hqtest` | Connects to a *named* herdr session with full actions (hire, close panes) |
| `npm run dev` | Development mode: a demo backend plus Vite with hot reload on `7461` |

Arguments after `--` go to the backend (`npm run serve -- …`, `npm start -- …`):

| Flag | Meaning |
|---|---|
| `--port 7462` | Listen port (always on `127.0.0.1`). If the port is taken, HQ fails with a clear message instead of picking another one |
| `--session <name>` | herdr session. The default comes from `$CLAUDE_HQ_SESSION`, otherwise `default` |
| `--demo [N]` | Simulated office with N agents (default 12). `--scenario mixed\|queue\|crowd40\|longIdle\|…`, `--seed S` |
| ~~`--allow-mutations`~~ | **Removed.** A named session (`--session hqtest`) already has full actions (hire, prompt, answer, close), and nothing turns on hire/close in the default session. Passing the flag is an error that says so |
| `--new-instance` | Refuse instead of attaching when a backend for this session is already running |
| `--metrics` | Enables `/debug/metrics` (token-authenticated) |
| `--record f.ndjson` / `--replay f.ndjson [--speed K]` | Record a session and play it back |
| `--timescale K` | Speeds up time (demo and replay only) |
| `--dist dir` / `--config-dir dir` | Use another renderer build or config directory (config defaults to `~/.config/claude-hq`) |

Useful page URL parameters: `?open=<name>` (open that agent's terminal), `?open=inbox`, `?open=roster`,
`?quality=low|medium|high|photo`, `?hour=22` (pin the time of day), `?noaudio`.

### One HQ per session

Starting HQ again for a session that already has a backend doesn't start a second one. `npm run serve` prints the
running backend's URL and exits. `npm start` attaches its window to that backend. A second `npm start` for the same
session focuses the window that is already open. Different sessions (for example `default` and `hqtest`) can run side
by side on different ports.

## Remote use (SSH tunnel)

The backend only listens on `127.0.0.1`. HQ renders on **your** machine's GPU, so you tunnel to the backend and open it
in your local browser:

```sh
# on the box running herdr
npm run serve
#   Claude HQ session "default" → http://127.0.0.1:7462/?t=3f9c…
#   remote: ssh -L 7462:127.0.0.1:7462 my-box   (on your laptop), then open the URL above

# on your laptop
ssh -N -L 7462:127.0.0.1:7462 my-box
# then open http://127.0.0.1:7462/?t=3f9c… in your browser
```

- **Token.** The token is 32 random bytes stored in `~/.config/claude-hq/token` (mode 0600). The first visit with
  `?t=` sets an HttpOnly, SameSite=Strict cookie and removes the token from the address bar. After that, bookmark
  `http://127.0.0.1:7462/`. `npm run doctor` prints the full URL again.
- **Host and Origin rules.** HQ only answers to the Host names `127.0.0.1`, `localhost` and `[::1]`, whatever the port.
  The WebSocket also requires a loopback Origin on HQ's own port. So use a plain `-L` port forward and open it as
  `127.0.0.1`/`localhost`. A reverse proxy or a LAN IP gets 403.
- **Ports.** If you tunnel to a different local port (`-L 9000:127.0.0.1:7462`), open `http://127.0.0.1:9000/?t=…`.
  The Host check ignores the port.
- If the backend restarts, the page reconnects by itself. If herdr restarts, agents come back within a few seconds.

## Playing

Click the office to capture the mouse. Walk up to a character and look at it: the status card shows its task, current
tool, todos, context and a blocked question if there is one. The Help Desk queue in the lobby is where blocked agents
wait for you.

| Key | Action |
|---|---|
| W A S D / arrows, Shift | walk, sprint |
| E | open the aimed agent's terminal (it opens in **Peek**: read-only until you type) |
| Enter | focus the last terminal, or the oldest blocked agent |
| B | Blocked Inbox: answer every waiting question from one card |
| T | prompt bar: send the aimed agent a prompt (you confirm before it sends) |
| G | high-five, which also signs off a `done` agent. Q pats an agent, R summons it |
| F | follow an agent |
| Tab | roster: every agent, grouped and searchable (`is:blocked`, `ws:`, `cwd:`, `has:note`) |
| N / Shift+N | sticky note on an agent / rename in the hotbar |
| 1–9, Shift+1–9 | open pinned agent n / pin the aimed agent to slot n |
| Alt+1–9 | quick-answer the aimed blocked agent (only if Settings › Quick answer is on; Enter confirms) |
| Ctrl+K or `/` | command palette. Type `triage` to cycle through every blocked agent |
| M, H or F1, `?` | map, help, key overlay |
| Leader (`` Ctrl+` `` or F9) | leave or enter the terminal. Leader I switches Peek ↔ Control, Leader J shows recent HQ actions |

In a terminal in Control mode, every key goes to the pane except the Leader. On macOS, `Ctrl` in this table is `Cmd`.

**Electron extras.**
- The tray icon tooltip (and title, where the desktop shows one) gives the number of blocked agents. The app badge
  shows the same number on macOS and Unity-style launchers.
- `Ctrl+Alt+H` raises the window straight into the Blocked Inbox from anywhere.
- An OS notification appears when an agent blocks while the window is in the background. Clicking it jumps to that agent
  in the inbox.
- To change the hotkey, set it in `~/.config/claude-hq/config.json`: `{"electron": {"hotkey": "Super+Shift+J"}}`, or
  `false` to turn it off.
- Without a tray host or a notification daemon, those pieces just stay off.

## Safety model

HQ is built to watch your real work without breaking it.

- **Your default herdr session is read-only-safe.** HQ never creates, closes or rearranges panes there. Hiring and
  closing panes are refused with an explanation. No flag or setting turns them on there (a named session whose socket
  is really the default one counts as the default), and the setting can't be turned on from the UI.
  - Terminals open only when you open them, and they start in **Peek** (an observe-only attachment that doesn't resize
    your pane). They take control only when you type or press Leader I.
  - Answers and prompts are sent only after you confirm them in the UI. An answer is checked against the prompt it was
    meant for: if the question changed, nothing is sent.
- **Named sessions** (`--session hqtest`) get full actions:
  - hire a Claude/Codex with a first prompt (HQ waits until it's ready, then sends the prompt once);
  - `+ Shell`;
  - close panes.
- **Two independent gates.** The action gate checks each renderer message. The herdr client separately checks every
  herdr method against a per-session allowlist. A bug in one can't mutate the default session. Server and session
  stop/delete are never allowed.
- **Audit log.** Every takeover, answer, prompt, key send, focus, resize, hire and close is appended to
  `~/.config/claude-hq/<session>/audit.ndjson` (mode 0600, rotated at 1 MB) as `{at, session, cid, action, paneId, ok,
  error?}`. It **never contains terminal bytes, prompt text, answers or keys**. The Recent HQ actions panel (Leader J)
  reads it.
- Sticky notes, sign-offs and slots are HQ-local files under `~/.config/claude-hq/<session>/` and are never sent to herdr.

## Troubleshooting

- **Start with `npm run doctor [-- --session S]`.** It checks the socket path and ping, shows the mode (default
  read-only-safe / named full / read-only on a protocol mismatch), says whether the renderer build is stale, lists
  running HQ backends and their herdr children, warns about inherited `HERDR_*` or Claude Code variables, and prints the
  tunnel command and URL.
- **"port 7462 is in use by another program"**: another app owns the port. Pass `-- --port 7470`, and use the same
  port in `ssh -L`.
- **"Claude HQ already running for session …"**: that session already has a backend. Open the URL it printed, or
  stop the other one with Ctrl+C in its terminal.
- **401 or "open the URL the backend printed"**: the cookie is missing. Open the printed `?t=` URL once.
  **403**: you opened HQ through a hostname other than `127.0.0.1`/`localhost`.
- **Blank or slow 3D**: check `chrome://gpu` for hardware WebGL2, try `?quality=low`, and keep the tab in the foreground.
  In Electron on Linux, `npm start` already passes `--ignore-gpu-blocklist --use-angle=vulkan`.
- **Stale page after an update**: `npm run serve` and `npm start` rebuild first. A bare `node server/main.ts` warns
  when `dist/` is older than the sources (`npm run build`).
- **Agents missing their activity**: a herdr server started from inside Claude Code passes that session's variables on,
  and then agents save no transcripts. Start herdr from a normal shell.
- **Headless box, want Electron anyway**: `xvfb-run -a npm start`. Web mode is the better fit.

## Development

The whole codebase is strict TypeScript, run directly by Node 24 (type stripping, no build step for the server, scripts
or tests) and bundled by Vite for the renderer.

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc` over the node, renderer, test, preload and experiments projects (must report 0 errors), plus a check that no source file is outside them |
| `npm test` | `node --test "**/*.test.ts"` |
| `npm run build` | Vite renderer bundle into `dist/` |
| `npm run build:preload` | Compiles `electron/preload.cts` to `out/preload/preload.cjs` (gitignored) |
| `npm run dev` | Demo backend (`--demo 12 --dev`) plus Vite with hot reload on `7461`, prints the URL with the token. **Node >= 24** |
| `npm run dev:hq` | Same against the named herdr session `hqtest` (run `scripts/hqtest-up.sh` first) |
| `npm run serve` | `vite build`, then `node server/main.ts` (web mode) |
| `npm start` | Electron. `prestart` runs `vite build` and `npm run build:preload` first. **Node >= 24** |
| `npm run doctor` | `node server/doctor.ts [--session S]`: resolver, ping/protocol, live HQ children, GPU flags, tunnel command |
| `npm run perf` | `node scripts/perf.ts`: uncapped median-of-3 at fixed poses, fails on a >15% regression vs `perf-baseline.json` |
| `npm run shoot` | `node scripts/shoot.ts <url> <outPrefix> [...]`: headless GPU screenshots of a running page |
| `npm run review` | `node scripts/review-shots.ts <outDir>`: the review shot set |
| `npm run briefs` / `briefs:check` | Regenerate / verify `docs/wp/*.md` from `docs/DESIGN.md` |
| `npm run walktimes` | Nav path lengths and times as a markdown table |

`npm start` and `npm run dev` need Node >= 24 (`engines`; type stripping of `.ts` at runtime, in Electron 44's embedded
Node too). The preload is the only compiled file: `electron/preload.cts` is built to `out/preload/` because the sandboxed
preload cannot be type-stripped. Everything else runs as `.ts`. `tsconfig.json` is only the editor catch-all; the checked
projects are `tsconfig.{node,renderer,test,preload,experiments}.json`. The port's guide, status and deviations are in `docs/port/`.
