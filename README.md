# Claude HQ

Backend, reusable browser modules, and a developer workbench for a 3D agent frontend. The original fixed office, mascot rigs, art pipeline, office UI, and Electron application have been removed. The workbench is a plain reference consumer, not a replacement 3D setting.

## Requirements

- Node **24 or newer**. Node runs the TypeScript sources directly.
- Live backend: Linux or macOS with [herdr](https://herdr.dev) installed and running. HQ speaks herdr protocol **22**; a mismatch makes the connection read-only.
- Demo mode does not construct a herdr client or touch real agent processes.
- Browser modules target modern browsers; the renderer helper requires WebGL2.

## Install and run

```sh
npm ci
npm run dev
```

Open the token-bearing workbench URL printed by the command. This starts Vite on `127.0.0.1:7461` and an isolated demo backend on an available port, using temporary settings/token storage. No herdr or live agent processes are used. Ctrl+C closes both servers and removes temporary state.

```sh
# Reproduce a specific demo; --port 0 also chooses an available frontend port.
npm run dev -- --demo 12 --scenario allStates --seed 7 --port 0

# Build and serve the same workbench through the production backend.
npm run build
npm start -- --demo 12 --port 7462
```

The workbench provides an agent list, local entity inspector, observe-first terminal with explicit control, reconnect controls, scenario/seed reset, and opt-in interaction tracing. Scenario changes discard old viewers and simulation-local state. Some scenarios prescribe their own population instead of the `--demo` count.

The backend can also run alone. `/healthz` and the authenticated WebSocket at `/ws` work without a frontend; `/` returns **503** when no frontend bundle exists.

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

The backend's `--dev` flag only permits the configured loopback frontend origin; it does not start Vite. Use `npm run dev` for the integrated demo workbench. Its seed is an unsigned 32-bit integer and demo population is 1–64.

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
| `renderer/workbench/` | Runnable reference frontend: entity inspection, real terminal integration, demo controls, and trace export |
| `renderer/src/net/` | Browser WebSocket/reconnect handling, eagerly updated agent state store, and bounded metadata-only interaction trace |
| `renderer/src/core/` | Math, RNG, clock, settings, attention notifications, caller-typed event bus and frame loop |
| `renderer/src/render/renderer.ts` | Standalone Three.js renderer setup; no office postprocessing stack |
| `renderer/src/world/nav/` | Occupancy grids, A*, route smoothing, portals, slot reservations, and collision queries |
| `renderer/src/world/layout/schema.ts` | Spatial types consumed by navigation; no authored office layout |
| `renderer/src/player/` | Movement/camera-feel math, camera paths, and soft-collision helpers; no assembled player controller |
| `renderer/src/ui/terminal/` | Standalone terminal widget and input, lifecycle, fitting, history, clipboard, and glyph handling |

The browser modules remain reusable source, not a bootable 3D scene. The workbench composes the network/settings/terminal modules without a global scene context, office event schema, character director, workspace-building allocator, or character rig.

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

## Reproducing interaction bugs

1. Start a demo with a known scenario and seed; the workbench shows the clean-start command using authoritative backend metadata.
2. Enable **Record interaction trace** before reproducing the interaction.
3. Use **Export trace** to download `hq-interaction-trace.json`. Include the relevant visible failure and reproduction steps with the file.

Tracing is off by default and stays in browser memory until explicitly exported. It retains the latest 512 entries, at most 128 pending correlations and 256 identity aliases. It records request/reply outcomes and timing, queued/sent/dropped delivery, connection and terminal transitions, byte/credit counts, identity migrations, protocol information, and scenario/seed changes. Pane and request IDs are aliased; raw payloads, tokens, paths, prompts, terminal text, and free-form error strings are excluded. The export reports dropped entries. Clearing or disabling tracing releases retained entries and correlations.

This is a diagnostic sequence, **not an executable interaction replay**: deliberately omitted input cannot be reconstructed. Reproduce the starting world with the displayed command, then follow the recorded action sequence and your reproduction steps. Existing `--record`/`--replay` separately capture source/enricher inputs; those recordings can contain prompts and paths and must be scrubbed before sharing.

The local entity inspector is sensitive and separate from trace export. Browser automation screenshots, videos, and Playwright traces can also contain visible content; CI only captures isolated synthetic demo sessions.

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
npm run build
npx playwright install chromium
npm run test:browser
```

Type checking covers backend/tooling, browser libraries/workbench, unit/browser tests, and source-file coverage separately. Run the full backend suite on Linux/macOS with LF checkout line endings: its live fixtures use executable shebangs, Unix sockets, POSIX signals, and file permissions. The Chromium smoke suite runs against the built workbench and actual backend CLI with temporary demo state; it checks authentication, terminal output/control, reconnect, viewer cleanup, scenario reset, and trace privacy/correlation without herdr.

`.github/workflows/ci.yml` runs the typecheck, full unit suite, production build, and Chromium smoke on Linux/Node 24 for pushes and pull requests. Browser failures retain reports, screenshots, video, and Playwright traces for seven days. To enforce merging policy, require the workflow's `linux` check in repository branch protection.
