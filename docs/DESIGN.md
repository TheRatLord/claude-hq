# Claude HQ: retained contracts

This branch removes the original fixed-office frontend. The backend and wire contract remain independent of any character design, environment, or workspace-building layout. Browser modules are reusable libraries; there is no application entrypoint or bundled scene.

## 2. Processes and repository layout

herdr owns agent execution. HQ observes and controls it through the backend, which exposes agent facts and explicit actions over WebSocket. A frontend owns presentation and any spatial simulation.

- `server/`: backend composition, herdr client/source, enrichment, actions, terminals, persistence, stats, demo, and replay.
- `shared/`: protocol, guards, identity, task labels, classification, and clock helpers.
- `renderer/src/net/`: browser connection and eagerly applied state store.
- `renderer/src/core/`: small independent runtime utilities, typed bus, frame loop, settings, and attention notifications.
- `renderer/src/render/renderer.ts`: standalone Three.js renderer setup.
- `renderer/src/world/nav/` and `world/layout/schema.ts`: navigation algorithms and their spatial input types.
- `renderer/src/player/`: camera/movement-feel and soft-collision math, not an assembled controller.
- `renderer/src/ui/terminal/`: standalone xterm widget and its helper modules.

### 2.2 Commands and frontend serving

`npm start` runs `server/main.ts` directly. `--demo` never constructs a herdr client. `--replay FILE` replaces live inputs with recorded ones. `--dist DIR` serves a separately built static frontend. There is no automatic frontend build.

`--dev --vite-port P` permits a separate loopback frontend origin at port P and disables backend static-page serving. It does not launch Vite or any other frontend server. API and WebSocket routes remain available.

Without a bundle, `/` returns 503; `/healthz` and authenticated API/WS routes remain usable. The CLI reports the absent bundle without treating it as a backend failure.

## 3. Data model and protocol

`shared/protocol.ts` is authoritative. `PROTOCOL_VERSION` is 1. Control frames are JSON messages discriminated by `t`; requests may carry `rid`, answered by `reply {rid, ok, ...}`. Terminal data/input use the binary codec defined in that file.

### 3.1 Entities and workspaces

One entity represents one herdr pane. Fields include identity, terminal ID, kind, name, status/timing, workspace/tab membership, task/activity, model/token counts, subagents, todos, blocked prompts, process/resource information, notes, and done acknowledgements.

`layoutRect` means terminal columns/rows, not physical geometry. Workspace `slot`, `colorIndex`, and `cycle` are stable metadata, not building positions or actual palette values. Workspace colour assignment retains its eight-index cycle in `shared/identity.ts`; no art palette is shared with the backend.

Settings retain their existing wire shape, including rendering/audio preferences. A frontend can choose how to use those preferences; they do not imply the removed office runtime exists.

### 3.2 Stats

Machine stats are sampled independently of the frontend. Frontends may consume or omit them. No server-rack, board, gauge, or other diegetic rendering remains.

### 3.3 Server to frontend

The server sends `hello`; the client checks its version and replies `hello.ack`. The server then sends a complete `world`. Subsequent messages include `entity`, `gone`, `workspaces`, `event`, `stats`, `herdr`, terminal lifecycle/credit messages, `screen`, `timeline`, `toast`, and replies.

`gone {reason: 'rekeyed', newId}` is an identity migration, not necessarily an agent leaving. Frontend state tied to a pane ID must migrate accordingly.

### 3.4 Frontend to server

Messages cover terminal open/promotion/input/history/resize/pause/close, screen subscriptions, prompts/answers/keys, focus, spawn/close, notes, done acknowledgements, settings, timeline/world reads, and demo controls. Central validation rejects malformed/unknown fields and oversized frames. Actions referring to unknown entities are rejected before routing.

Terminal viewers are explicit, observe-first resources. The current limits distinguish entity population from terminal viewers: six viewers per client, sixteen children per backend, eight screen watches per client, and sixteen watched panes across clients. Showing an agent does not require opening its terminal.

### 3.5 Browser state boundary

`renderer/src/net/store.ts` applies messages as they arrive rather than in animation frames. It owns request/reply calls, binary delivery, entity coalescing, clock skew, protocol mismatch handling, and terminal writers. `net/socket.ts` owns the single socket, token adoption, per-tab identity, and reconnect/health probing.

## 4. Backend

### 4.0 Internal seams

`server/interfaces.ts` defines `HerdrSource`, `Enricher`, and `TerminalBackend`. `createApp()` supplies live, demo, or replay implementations. `WorldModel`, `Actions`, `TerminalHub`, and `WsHub` do not require renderer callbacks or geometry.

### 4.1 herdr client

`server/herdr/client.ts` owns herdr socket requests/subscriptions and terminal-attachment child spawning. It checks protocol 22 and enforces method allowlists independently of the action layer. HQ requests agent operations from herdr; it does not directly launch Claude/Codex executables.

### 4.2 Live source and reconnects

`HerdrLive` observes structural/status changes and snapshots. Offline state freezes facts rather than emitting false departures. Reconnect reconciliation uses a grace period and stable identity matching.

### 4.3 World model

`WorldModel` combines source facts with enrichers, respecting field/event ownership. It emits complete initial state and coalesced diffs. It has no office rooms, rigs, navigation, or mesh dependencies. Workspace slot ordinals are persisted and released five minutes after their workspace was last seen.

### 4.4 Transcripts

Claude transcript enrichment locates and tails session files to recover tasks, text, tools, token counts, and progress. It remains backend-side and independent of visual activity/animation selection.

### 4.5 Subagents and process information

Independent enrichers track subagent transcripts and process facts. Their output belongs to the entity model, not a character representation.

### 4.6 Classification

`shared/classify.ts` maps tools, commands, and process activity to semantic categories. It does not select animations, workstations, or environment geometry.

### 4.7 Terminal hub

The hub owns viewers, observe/control children, promotion, writers, sizing, credit/backpressure, pause/resume, history, grace resume, and local screen mirrors. Live attachments use herdr CLI children with ordinary pipes; demo attachments use simulated terminal streams. Screen mirroring uses headless xterm, not the visual renderer.

### 4.8 Actions and safety

The default session never permits creating/closing panes or changing its structural layout. A named session resolving to the default socket has the same restrictions. Prompts and answers are explicit operations; answers are checked against the prompt hash. Notes and done acknowledgements are HQ-local.

Protocol mismatch makes herdr read-only. The action gate and herdr method gate are independent. The legacy `allowMutations` preference cannot override these rules. Audit logs contain metadata, never prompts, answers, keystrokes, or terminal bytes.

### 4.9 Demo and replay

Demo/replay use the same world/action/terminal contracts as live mode without accessing real agent processes. Demo task data and terminal content are fixtures, not an alternate visual world. The CLI caps demo population at 64; no larger-swarm performance claim follows from that value.

### 4.10 Stats sampler

Backend stats sources and sampling continue unchanged. The removed frontend's machine-shaped props and weather effects are not part of this API.

### 4.11 HTTP and WebSocket security

The backend binds loopback and checks Host/Origin. The token supports an HttpOnly, SameSite=Strict cookie; `?t=` bootstrap redirects without the token. Static assets are served within the supplied bundle directory, with CSP, content-type, cache, and traversal protections. Dev origins are explicitly configured, not wildcarded.

### 4.12 Single instance

Live sessions use lock files and health checks to avoid multiple backends for the same session. Demo backends can coexist. Cleanup removes locks and terminates only owned attachment children.

### 4.13 Clock

Backend timers use the clock interface. Time scaling is available only for demo/replay. Frontend animation clocks and presentation can progress separately from agent facts.

## 6. Reusable spatial and movement primitives

### 6.6 Navigation

`Layout` contains finite bounds and optional walls, rotated obstacle footprints, slots, levels, and portals. Slots are consumer-tagged positions; there are no desks, bays, help queues, authored camera wells, or private office-door rules.

Navigation builds 0.25-metre occupancy grids, inflates them for clearance, uses octile A*, and smooths paths. It provides collision queries, reservations, cached routes, and per-frame search budgeting. Cross-level routes support a direct connecting portal; this is not a general multi-hop portal graph or terrain navmesh.

Geometry is static for each navigation instance. Consumers changing structures must recreate navigation, discard stale routes, and reconcile reservations. Mutating layout arrays alone does not update cached grids or routes. No dynamic world manager is included.

### 6.10 Movement and camera math

Retained helpers cover frame-rate-independent springs, head-bob/landing feel, camera paths, and soft circle collisions. The office player controller, seat logic, manager camera, monitor dive, slide interaction, actor following, and go-there orchestration are removed.

## 8. Reusable browser runtime and terminal widget

### 8.1 Runtime

The event bus requires a caller-owned topic schema. The frame loop accepts its small clock/frame/performance contract and preserves consumer context typing; it has no global scene, player, store, layout, or director dependency. The renderer helper creates an antialiased sRGB Three.js renderer with built-in neutral tone mapping, without the old composer or shader passes.

### 8.4 Terminal lifecycle

The terminal widget consumes real network calls, settings, platform detection, and explicit consumer hooks. It retains observe/control transitions, gated outbox, input credit/backpressure, paste, pause/resume, reconnect reopening, local history, clipboard, glyph fallback, fitting, and optional WebGL.

### 8.5 Terminal consumer responsibilities

Use `createTermView({id, net, settings, platform, hooks, grid, observeGrid?})` from `ui/terminal/view.ts`:

- `attach(host)` initializes xterm. Mount `view.notices` separately from its glyph grid.
- `open()` explicitly opens an observe viewer.
- Feed matching store terminal states to `applyState()` and credits to `ack()`.
- Reopen after reconnect, use `rekey()` after identity migration, and call `relayout()` after host resize.
- Implement leave/focus, confirmation, notifications, viewer eviction, and font-setting actions in the consumer.
- `dispose()` closes the viewer and releases its DOM/resources.

There is no drawer, roster, command palette, office keymap, UI kit, or Electron bridge. Styling is limited to the standalone widget's readable defaults.

## 9. Verification

`npm run typecheck` checks backend/tooling, browser modules, and tests separately and verifies source-file coverage. `npm test` runs retained behavioral tests. Platform-specific live tests need the OS facilities used by herdr.

The old screenshot matrices, office pose probes, art/colour assertions, performance baseline, work-package briefs, and source-text/wiring tests are removed. A new setting's rendering or swarm capacity must be measured against that actual setting, not inferred from the former office's measurements.
