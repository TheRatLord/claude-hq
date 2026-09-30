# Claude HQ

Backend and reusable browser modules for a 3D agent frontend. The original fixed office, mascot rigs, art pipeline, office UI, and Electron application have been removed on this branch. There is no bundled application page or replacement setting.

## Requirements

- Node **24 or newer**. Node runs the TypeScript sources directly.
- Live backend: Linux or macOS with [herdr](https://herdr.dev) installed and running. HQ speaks herdr protocol **22**; a mismatch makes the connection read-only.
- Demo mode does not construct a herdr client or touch real agent processes.
- Browser modules target modern browsers; the renderer helper requires WebGL2.

## Install and run

```sh
npm ci
npm start -- --demo 12 --port 7462
```

The backend listens on `127.0.0.1` and prints a token-bearing URL. `/healthz` and the authenticated WebSocket at `/ws` work without any frontend. Requesting `/` without a frontend bundle returns **503** with an explicit explanation.

```sh
# Live session; the default session never allows creation/closure of panes.
npm start

# Named session with agent creation/closure enabled by the backend safety gates.
npm start -- --session hqtest

# Serve a separately built frontend from the same origin.
npm start -- --demo --dist /path/to/frontend-build

# Allow a separately served local frontend to connect from port 7461.
npm start -- --demo --dev --vite-port 7461

npm run doctor -- --session hqtest
```

`--dev` does not start a frontend development server. It permits the configured loopback frontend origin and leaves page serving to that frontend. This repository has no frontend build or development-page command.

Other backend flags:

| Flag | Purpose |
|---|---|
| `--port N` | Listen port; `0` selects an available port |
| `--config-dir DIR` | Override token, settings, and per-session persistence directory |
| `--scenario NAME`, `--seed N` | Deterministic demo scenarios |
| `--record FILE` | Record source/enricher input as NDJSON |
| `--replay FILE`, `--speed N` | Replay a recording without connecting to herdr |
| `--timescale N` | Scale demo/replay time only |
| `--new-instance` | Refuse to attach to an already-running backend for that session |
| `--metrics` | Enable authenticated `/debug/metrics` |

The CLI demo population is limited to 64. This is not a verified capacity limit for live agent swarms or a rendering performance guarantee.

## Retained code

| Path | Responsibility |
|---|---|
| `server/` | herdr integration, enrichment, state, actions, terminal hub, HTTP/WS security, persistence, demo, record/replay, and machine stats |
| `shared/` | Wire protocol, validation, identity/hashing, task labels, classification, and clock helpers |
| `renderer/src/net/` | Browser WebSocket/reconnect handling and eagerly updated agent state store |
| `renderer/src/core/` | Math, RNG, clock, settings, attention notifications, caller-typed event bus and frame loop |
| `renderer/src/render/renderer.ts` | Standalone Three.js renderer setup; no office postprocessing stack |
| `renderer/src/world/nav/` | Occupancy grids, A*, route smoothing, portals, slot reservations, and collision queries |
| `renderer/src/world/layout/schema.ts` | Spatial types consumed by navigation; no authored office layout |
| `renderer/src/player/` | Movement/camera-feel math, camera paths, and soft-collision helpers; no assembled player controller |
| `renderer/src/ui/terminal/` | Standalone terminal widget and input, lifecycle, fitting, history, clipboard, and glyph handling |

The browser modules are reusable source, not a bootable scene. There is no global scene context, office event schema, character director, workspace-building allocator, or character rig left in the repository.

Navigation is a snapshot of its input geometry. Mutating a layout after creating navigation does not rebuild occupancy or invalidate cached paths. Consumers must replace navigation and reconcile routes/reservations when geometry changes.

## Frontend protocol

`shared/protocol.ts` is the authoritative data/action contract. `docs/DESIGN.md` describes the retained boundaries; `docs/research/herdr-api.md` records the underlying herdr protocol research.

1. Connect to `/ws?cid=<per-tab-client-id>` using the authenticated cookie, or add `&t=<token>`.
2. Receive `hello`, verify `protocol`, and send `hello.ack` with that version.
3. Receive the initial `world`, then apply `entity`, `gone`, `workspaces`, `event`, and other updates.
4. Send validated actions with a request ID (`rid`) and consume `reply` messages.
5. Open terminal viewers explicitly; terminal output/input use the binary framing defined in the protocol.

The existing browser store implements this handshake, binary delivery, request/reply calls, coalescing, and reconnect handling. State updates do not depend on animation frames.

A frontend must handle `gone {reason: 'rekeyed', newId}` and migrate its identity-keyed state. Presentation of an agent does not own the agent's process lifetime.

## Safety

- The backend only binds loopback. Host and WebSocket Origin checks reject non-loopback origins or unconfigured frontend ports.
- The token is stored under the config directory. Visiting `?t=...` sets an HttpOnly, SameSite=Strict cookie and redirects without the token.
- The default herdr session never allows creating, closing, or rearranging panes. Named sessions whose resolved socket is actually the default are treated as default.
- Terminal viewers open in observe mode; control requires explicit promotion. Answers are checked against the question's prompt hash.
- The action layer and herdr client independently enforce safety gates. A frontend cannot bypass them by changing settings.
- Audit entries contain action metadata, not terminal bytes, prompts, answers, or keystrokes.
- Notes and done acknowledgements are HQ-local state.

For remote use, tunnel the backend and open the client on loopback:

```sh
ssh -N -L 7462:127.0.0.1:7462 user@backend-host
```

## Verification

```sh
npm run typecheck
npm test
```

Type checking covers backend/tooling, browser libraries, tests, and source-file coverage separately. Tests exercise retained behavior, not the deleted office presentation. Run the full backend suite on Linux/macOS with LF checkout line endings: its live fixtures use executable shebangs, Unix sockets, POSIX signals, and file permissions. Demo/API scenarios can be exercised without herdr.
