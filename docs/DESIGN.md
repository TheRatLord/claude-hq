# Claude HQ: DESIGN (single source of truth)

Status: **v4**, lead architect, 2026-09-27. This is the contract engineers code against. Where it conflicts with the input
docs, **this file wins**. §12 lists every resolved conflict. The input docs remain the detailed references:

> **v4 changes (review round 3).** *Art:* cool CAF floor + painted-brick STR + neutral grades, hue-gap at `cafe`/`street`
> (§5.5–5.6); ENV prop kit (§7.5) + **M1.75 hero-zone gate** (§11); planarity edge test with angle/distance fade (§5.1);
> golden/night rendered-L\* rows run from M1 (§5.0); slate codex lifted to L\* 32 + codex `clayCheck` row; ART rows
> struck inline. *Gameplay:* task placards legible at 8–10 m (§6.7); player feel block, ride the slide, sit (§6.10);
> Shelly idle ladder (§6.4.1); "while you were away" recap (§6.4.5). *UI:* Peek never promotes on Esc/Ctrl+C/arrows
> (§8.4); Leader tap acts on keyup, chords disjoint from world keys, close tab = Leader X (§8.2); meaningful unread
> (§8.9); UI state keyed through the rekey map, pins by stable identity (§8.10); plain 1–9 = pins only, quick-answer
> Alt+1–9 via confirm; first-use fallbacks; roster ARIA; Directory group-by + `cwd:`/`project:` (§8). *Eng:* orphan
> child reaping (§4.7.1); persisted `statusSince` (§4.3.1); fire-and-forget keystrokes with credit window (§3.4, §8.6);
> M0.5 scaffold with stubs + per-WP reading map/briefs (§11); one session resolver + ping-before-spawn (§4.1);
> injectable clock + `--timescale` (§4.13); shadow casters fixed per tier (§5.2). Backlog grew (§11.5).

> **v3 changes (review round 2).** *Art:* studio key decoupled from the sun (sun only via gobo/sky/grade), shadow feeds
> the ramp, rendered-luminance targets + `lumaStats.p50`, toy-scale AO with characters excluded, screen emissive budget,
> status-ring chroma budget, workspace-vs-kind ΔE (palette swaps: cocoa, slate codex, rose other-LLM) + accessory trim,
> lamp pools + cross-faded points (§5.0, §5.1, §5.5, §5.6, §6.7). *Gameplay:* work-call rule, cold-start placement,
> slide/mezzanine/NE-quadrant traffic, roped teller-window queue with keep-clear rects, table-first block map (§6.4, §7).
> *UI:* focus/layout model, full roster keyboard, real clipboard APIs, macOS client keymap, blocked counter in the
> drawer, settled-fit resize path, tab lifecycle, font size (§8). *Eng:* enricher `update`/`emitEvent` + ownership
> table, `term.scroll` verified pane-global → local history, multi-viewer sizing rule, read-only mode + client allowlist,
> WP-code mapping, Director capacity, charBatch culling, wire validation + caps (§3, §4, §5.3, §6.4, §11).

> **v2 changes (review round 1: art / gameplay / UI / eng).** Toy-scale plan rebuilt at 42×28 m (§7) with an M1.5 greybox
> gate (§11). Radiometric + tone-map contract, NEUTRAL tone mapping, and post order fixed (§5.0–5.1). Status/workspace
> colour separation with a ΔE test (§5.5). One normative signal vocabulary (§6.7). Commute honesty rules (§6.5). Help Desk
> **Serve** verb and **done sign-off** (verified herdr behaviour) (§6.8). Keymap scopes, escape leader, scrollback, paste,
> and drawer lifecycle (§8). Backend seams, headless-xterm resync, observe-first terminals, single-instance lock,
> hash-checked answers, reconnect semantics (§4). Superseded rows in ART/GP are listed in §12.2.

| Doc | Use it for |
|---|---|
| `docs/research/herdr-api.md` | herdr wire facts and gotchas |
| `docs/research/platform.md` | GPU flags, perf numbers, security, stats sources |
| `docs/design/art-direction.md` (**ART**) | Palette, materials, rigs, animation, UI look |
| `docs/design/gameplay-and-floorplan.md` (**GP**) | Floor plan, zones, behaviour, stats placement, controls |

Changing a contract (protocol, Entity, module API) means editing this file in the same commit. Add optional fields; don't
break existing shapes.

---

## 1. Vision & pillars

A cozy **"Clay Studio Diorama"** office (ART §1): a toy-scale world of matte clay, painted wood and felt, seen in first person.

- Every herdr agent is a lively **Clawd** character, and every plain shell pane is a **Shelly** CRT robot.
- What each character does, and where, is the honest truth about the pane.
- It is a sim game you *walk around in*, and a real ops console that is never more than 2 keypresses from a live terminal.

| # | Pillar | Acceptance test |
|---|---|---|
| P1 | **Readable at a glance.** State shows through location, pose, ring colour and icon. | From the `spawn` pose with no HUD, every agent's status is answerable from diegetic elements: the agent itself (E-bay glazing, the Pit, the Help Desk queue), or its name on the Big Board STATES face (which lists W-bay agents too). Checked in §9.2 |
| P2 | **≤ 2 inputs to real work.** | From every scope (§8.7 table: world locked/unlocked, drawer collapsed/docked/fullscreen, roster, search or settings input) a fixed 2-input path (`Tab`→`Enter`, Leader `L`→`Enter`, or `Ctrl+K`→name→`Enter`) opens the xterm for any pane. |
| P3 | **Alive with 3 agents that are mostly idle for hours.** | Ambient NPCs (Ada the receptionist, Segfault the cat), stats objects, the long-idle ladder (§6.4.1) and amenity bays (§7.2) mean nothing is ever static and no bay is an empty storefront. Checked with the `trio` and `longIdle` scenarios |
| P4 | **Varied space.** | Sunken pit, mezzanine, studio street, raised engine room, outside views. |
| P5 | **Characters, not blobs.** | Squash and stretch, anticipation, springs, expressive eyes and emotes. A 2 s clip reads "cute and bouncy". |
| P6 | **Honest.** | Every animation maps to herdr, transcript or process data, or is visibly ambient (no nameplate, no ring). One visual = one meaning (§6.7). Player verbs never move an agent away from where its status says it is (§6.9). Working agents spend ≤ 20% of working time walking, **work-call returns included** (`mixed` demo, §6.4.2, §6.5). Agents present at boot never parade in (§6.4.3) |
| P7 | **Fast on an iGPU.** | 60 fps at 1080p Medium with 12 agents on the 780M; ≥ 45 fps with 40. |
| P8 | **Safe.** | Never mutates the default herdr session without an explicit user action. Loopback, token and CSP are mandatory. |

**Fun first.** This is not a waterfall. Every milestone ends with reviewer passes: art, gameplay, UI, code and perf. The idea
backlog (§11.5) is live, and anyone may append to it. Good ideas get pulled into the next milestone.

---

## 2. Processes & repo layout

```
               ┌──────────── Node backend  (server/, plain ESM, no native deps) ──────────────┐
herdr socket ◄─┤ HerdrLive ─► WorldModel ─► diffs ─┐                                           │
 (unix, NDJSON)│ Transcripts, ProcInfo, Subagents ─┤──► WsHub ◄──► renderer(s) over ws://…/ws   │
herdr CLI child│ TerminalHub (control/observe)─────┘       ▲                                   │
  processes    │ StatsSampler (/proc, /sys) ───────────────┘   HttpServer: static dist/, auth  │
               │ DemoWorld (--demo) implements HerdrSource + Enricher + TerminalBackend (§4.0)│
               └───────────────────────────────────────────────────────────────────────────────┘
Electron main (electron/main.js) = imports server/app.js in-process + BrowserWindow → http://127.0.0.1:PORT/?t=TOKEN
Web mode      = node server/main.js → user runs `ssh -L 7462:127.0.0.1:7462 box` and opens the printed URL
Renderer      = renderer/ (Vite root). three 0.186 + postprocessing + n8ao + xterm. Same bundle in both modes.
```

- **The backend reports facts, and the renderer decides presentation.** The backend never knows about desks, zones or
  animations. The renderer never talks to herdr.
- **Web mode is the primary surface.** The user is headless over SSH, so the renderer runs on the *client's* GPU. We still
  budget for the 780M.
- **Language.** Plain JavaScript ESM with JSDoc typedefs, and no TypeScript build step. Node 24 is the target.
  - `shared/` is imported by both sides and must be pure: no three, no node built-ins.
- **Pure renderer modules** (layout, nav, springs, brain logic, classify) must not import three, so they run under `node --test`.
  - Mark them with a `// @pure` header.

### 2.1 Directory map & ownership
Owners are work-package codes. **WP codes are exactly these owner codes** (LEAD BE BE2 CORE RND LVL ENV CHR BRN FX STAT
AMB AUD UI PLY); §11 uses no other codes (mapping in §11.0). A file has exactly one owner; others may only *call* it.
**This table is the only ownership source.** The milestone tables in §11 list deliverables, never different owners.
`shared/{protocol,identity,palette}.js`, `server/interfaces.js` and this file are owned by **LEAD**, who writes them in
**M0** (before M1 starts). Anyone may *propose* additions in their WP summary; LEAD merges them.

```
package.json  vite.config.js (root: renderer/, proxy /ws → backend)   LEAD
shared/
  protocol.js     message type constants, PROTOCOL_VERSION, EVENT_KINDS, JSDoc typedefs (Entity, Stats, …), binary frame codec,
                  VALIDATE (renderer→server validation table, §4.11), FIELD_OWNERS (§4.0)                    LEAD
  identity.js     hash32, mulberry32, workspaceColorIndex(label, taken), identityMatch(saved, entity) (§8.10)   LEAD
  task.js         taskLabel(entity) (§3.1, §6.7), @pure + tests                                    LEAD
  palette.js      every colour token (ART §2 as amended by §5.5) + CIEDE2000 helper; palette.test.js   LEAD
  clock.js        waitClock(ms, approx) — the one wait-clock formatter (§3.5), @pure + tests          LEAD
  classify.js     toolClass(name,input) / bashCategory(cmd) / processActivity(proc)  (§4.6)          BE2
server/
  interfaces.js   JSDoc typedefs + tiny base classes: HerdrSource, Enricher, TerminalBackend (§4.0)    LEAD
  main.js         CLI: parse args (§2.2), createApp(), print URL                                   BE
  app.js          createApp(opts) → {port, url, token, close()}  (Electron imports this)           BE
  config.js       resolved options, paths (~/.config/claude-hq/{token,config.json,<session>/})     BE
  clock.js        injectable clock: now(), setTimeout/setInterval, timescale; FakeClock for tests (§4.13)   BE
  reaper.js       child env tags, children.json, startup /proc orphan scan, signal handlers (§4.7.1)   BE
  doctor.js       `npm run doctor` diagnostics (§9.3)                                               BE
  instance.js     single-instance lock + attach (§4.12)                                            BE
  record.js       --record / --replay NDJSON: snapshots, status, patches **and events** (§4.9)       BE2
  http.js         static dist/, Host/Origin/token/CSP, /healthz, /debug/metrics (§4.11)             BE
  ws.js           WsHub: auth'd sockets, VALIDATE enforcement, client/terminal caps, rid replies, watch sets  BE
  log.js          tiny leveled logger (stderr), never logs terminal bytes                           BE
  audit.js        metadata-only HQ action log → ~/.config/claude-hq/<session>/audit.ndjson (§4.8)    BE
  herdr/resolve.js the ONE session → socket resolver (`socketFor`), default-socket guard (§4.1)      BE
  herdr/client.js request/subscribe/spawnTerm, env scrub, **per-session method allowlist + read-only mode** (§4.1)  BE
  herdr/live.js   HerdrLive: live-model recipe (§4.2) → raw snapshot state + status events           BE
  world/model.js  WorldModel: raw herdr + enrichers → Entity map, diff → entity/gone/event msgs     BE
  world/naming.js display name / project / seedKey rules (§4.3)                                     BE
  world/blocked.js pane.read detection → Prompt {question, options}                                 BE
  world/screens.js monitor text (pane.read visible) for watched ids                                 BE
  world/actions.js mutation gate + herdr calls for renderer actions (§4.8)                          BE
  world/acks.js   HQ-side done sign-off overlay, persisted per session (§6.8.2)                     BE
  world/slots.js  stable per-workspace `slot` ordinal, persisted per session (§6.4; not bays)       BE
  world/since.js  persisted `statusSince` + `statusSinceApprox` per stable identity (§4.3.1)          BE
  world/timeline.js 24 h ring of status transitions + events per pane, persisted; `hq.timeline` (§4.3.1) BE
  world/notes.js  HQ-local sticky notes per stable identity, persisted per session (§8.10)           BE
  enrich/transcripts.js  tail + parse Claude JSONL → activity/model/context/todos/prompt/title      BE2
  enrich/subagents.js    subagent dir scan → count + list                                           BE2
  enrich/procinfo.js     pane.process_info poll for shells (+ per-pane cpu/rss, M4)                BE2
  terminals/hub.js       TerminalHub (§4.7)                                                          BE
  terminals/mirror.js    @xterm/headless + addon-serialize screen mirror per open pane (§4.7)        BE
  stats/sampler.js + stats/sources/{cpu,mem,disk,gpu,net,temps,proc}.js                             BE2
  demo/world.js  demo/scenarios.js  demo/fakeTerm.js   (§4.9)                                        BE2
  test/mockHerdr.js      scripted NDJSON unix-socket herdr + fake `terminal session` bin (§9.3)     BE
  **/*.test.js    node --test                                                                         owner of file
electron/main.js  in-process server or attach (§4.12), window, GPU switches, before-input-event (§8.3), --shoot (§9.3)                            BE
renderer/
  index.html  src/main.js (boot + frame loop wiring only)                                            CORE
  src/core/   loop.js ctx.js bus.js rng.js math.js time.js settings.js debug.js(window.__hq)         CORE
  src/net/    socket.js (WS + backoff, binary codec) store.js (eager apply, entities, workspaces, stats history)  CORE
  src/render/ renderer.js post.js quality.js lights.js lut.js contextLoss.js zoneGrade.js             RND
  src/render/materials/ index.js (getMaterial factory, §5.4) toon.js patterns.glsl.js screen.js glass.js hull.js foliage.js sky.js gobo.glsl.js   RND
  src/render/text/ canvasText.js atlas.js dotmatrix.js (shader 5×7 glyphs) glyphs.js (capsule-stroke display face, M3)  RND
  src/render/monitorAtlas.js screenFeed.js  live desk-monitor atlas + the one screen.watch arbiter (M3.5)   RND
  src/render/lamps.js  lamp-pool uniforms per vis cell + ≤ 2 cross-faded point lights (§5.6)          RND
  src/world/layout/ @pure: schema.js hq.js (full office) proto.js (M1 room) floorY.js slots.js vis.js  LVL
  src/world/nav/    @pure: grid.js astar.js pull.js portals.js reservations.js                        LVL
  src/world/build/  index.js (buildWorld, §5.4) architecture.js zones/<ZONE>.js amenities.js kit/*.js (prop kit, §7.5) exterior.js merge.js greybox.js   ENV (greybox.js: LVL)
  src/debug/  propSheet.js (`?sheet=props`, §7.5)                                                    ENV
  src/world/stats/  registry.js (§5.4) rack.js ramColumn.js drawers.js gauge.js hamster.js mast.js bigBoard.js …  STAT
  src/world/ambient/ ada.js cat.js fish.js roomba.js …                                              AMB
  src/chars/rig/    clawd.js shelly.js mini.js face.js accessories.js props.js                        CHR
  src/chars/render/ charBatch.js (instanced parts + hull), portraitBatch.js portraits.js             CHR
  src/chars/anim/   @pure: springs.js sod.js noise.js easing.js pose.js; locomotion.js ik.js animator.js activities/*.js reactions.js   CHR
  src/chars/brain/  @pure: director.js (bays/desks/queue/stations/amenities) capacity.js (§6.4.4) brain.js (HFSM) phase.js (dominant phase, §6.5) tuning.js social.js   BRN
  src/chars/actors.js  entity ↔ actor lifecycle, LOD, culling                                        BRN
  src/fx/     index.js (fx API, §5.4) particles.js bubbles.js nameplates.js rings.js glyphs.js blobShadows.js dust.js placards.js (task atlas, §6.7)   FX
  src/player/ controller.js (feel block §6.10) cameras.js (walk/follow/glide/photo/ride/sit)          PLY
  (crosshair aim lives in src/ui/aim.js, UI; §2.1 fixed LEAD m2 fix r2)
  src/ui/     ui.css icons.js keymap.js (§8.2) roster.js inbox.js (Blocked Inbox + Serve card, §6.8.1) statusCard.js hud.js toasts.js minimap.js commandPalette.js help.js settings.js onboarding.js notify.js   UI
  src/ui/terminal/ drawer.js xtermView.js theme.js lifecycle.js (state machine, §8.4) fit.js (settled-fit path, §8.5) tabs.js (LRU lifecycle, §8.5) history.js (local scrollback overlay, §8.6) clipboard.js   UI
  src/ui/triage.js promptBar.js hireDialog.js hotbar.js  (M3.5)                                           UI
  src/ui/platform.js  client-OS detection + modifier mapping (§8.2.2)                                 UI
  src/ui/rekey.js     UI-side rekey map + stable identity keys for pins/notes/tabs (§8.10)             UI
  src/ui/away.js      "while you were away" recap driver (§6.4.5)                                      UI
  src/audio/  sfx.js (procedural WebAudio), spatial.js                                                AUD
  src/debug/  perfOverlay.js                                                                          CORE
  src/debug/  poses.js (canonical shots + per-pose probe pixels)                                      LVL
  src/debug/  probe.js (probe/lumaStats/clayCheck/surfaceStats; owns emissive-gain override) silhouette.js  RND
  src/debug/  sheet.js (hero turntable)                                                               CHR
scripts/ shoot.mjs dev.mjs review-shots.mjs perf.mjs                                                  CORE
README.md       user-facing install/run/tunnel/controls/safety (M3.5)                                             BE
scripts/ hqtest-up.sh hqtest-down.sh integrity.mjs (default-session before/after hash, §9.3)           BE
scripts/ walktimes.mjs (+ `--ascii` block-map dump)                                                   LVL
scripts/ p2.mjs (+ `--mac` variant, §8.7)                                                             UI
scripts/ wp-briefs.mjs → docs/wp/<CODE>.md (inlined normative sections, §11.0)                          LEAD
renderer/src/stubs/ M0.5 seam stubs (§11 M0.5), deleted by the owning WP when replaced                   CORE
```

### 2.2 Commands, ports and flags
- **Backend:** `node server/main.js [--port 7462] [--session <name>|default] [--demo [N]] [--scenario <name>] [--seed S] [--allow-mutations] [--dev] [--record file.ndjson] [--replay file.ndjson [--speed K]] [--new-instance] [--metrics] [--timescale K]`
  - A live backend for the same session is detected via the lock (§4.12): `main.js` prints its URL and exits 0; Electron attaches to it.
  - `--port 0` picks a free port (tests).
  - Session resolution order: `--session`, then `CLAUDE_HQ_SESSION`, then `default`.
  - `--demo` never constructs a herdr client.
  - `--metrics` (implied by `--dev`) enables the token-auth'd `/debug/metrics` endpoint (§4.11).
  - `--timescale K` (§4.13) scales the server clock; accepted **only** with `--demo` or `--replay` (live herdr is
    wall-clock; refused otherwise). The renderer's `?timescale` follows `hello.timescale` unless overridden.
  - **Socket guards (§4.1):** `--demo`/`--replay` never call the resolver (constructing a `HerdrClient` there throws);
    `dev:hq`, `hqtest-up.sh`, the mock-herdr tests and any `--allow-mutations` run refuse to start if
    `realpath(socketFor(session)) === realpath(socketFor('default'))`.
- **npm scripts:**

  | Script | Runs |
  |---|---|
  | `dev` | `scripts/dev.mjs`: backend `--demo 12 --dev` on 7462, plus vite on **7461** proxying `/ws`, then prints the URL with the token |
  | `dev:hq` | Same, with `--session hqtest` (run `scripts/hqtest-up.sh` first) |
  | `build` | `vite build` → `dist/` |
  | `serve` | Build, then `node server/main.js` |
  | `start` | `electron --no-sandbox --ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan .` (`package.json` `main` = `electron/main.js`) |
  | `test` | `node --test` |
  | `shoot` | `node scripts/shoot.mjs …` |
  | `review` | `node scripts/review-shots.mjs <outDir>` |
  | `walktimes` | `node scripts/walktimes.mjs` → markdown table of nav path lengths/times (§11 M1.5) |
  | `perf` | `node scripts/perf.mjs` → uncapped median-of-3 at fixed poses; fails on > 15% regression vs `perf-baseline.json` |
  | `doctor` | `node server/doctor.js [--session S]` (§9.3): resolver, ping/protocol, live HQ children, env gotchas, GPU flags, tunnel command |
  | `briefs` | `node scripts/wp-briefs.mjs` → `docs/wp/*.md` (§11.0); CI fails if they are stale |

- **Renderer URL params:**

  | Param | Effect |
  |---|---|
  | `t` | Token, stripped from the URL after use |
  | `pose=name` | Start at a canonical pose |
  | `hour=13.5` | Pin the time of day |
  | `quality=low\|medium\|high\|photo` | Force a quality tier |
  | `layout=proto\|hq` | Choose the layout |
  | `nohud` | Hide the HUD |
  | `silhouette` | Silhouette-check render |
  | `seed` | Seed for the renderer's cosmetic RNG |
  | `timescale` | Animation time scale |
  | `noaudio` | Disable audio |
  | `season=` | Force seasonal decor |
  | `sheet=hero` | Hero turntable sheet scene (§6.1.1) instead of the office |
  | `greybox` | Flat-material layout render (M1.5 gate) |
  | `open=<name\|paneId>` | Open that terminal after boot (deep link) |
  | `fov=60` | Vertical FOV (default 60; settings allow 55–75) |

---

## 3. Data model & protocol (`shared/protocol.js`)

`PROTOCOL_VERSION = 1`. The transport is WebSocket at `/ws`. Control messages are JSON text frames `{t, ...}`. Any
renderer→server message may carry a `rid`; the server replies with `{t:'reply', rid, ok, error?, ...result}`.
**Terminal bytes are binary frames** (never base64 JSON): `[u8 kind][u8 idLen][id utf8][u8 flags][payload]`, kind 1 =
`term.data` (server→renderer; flags bit0 = full snapshot), kind 2 = `term.input` **interactive** bytes (renderer→server;
flags must be 0: paste chunks need a `rid`, so they use the JSON form, §3.4 / D6). The codec lives in `shared/protocol.js`
with a round-trip test.

### 3.1 Entity (one per herdr pane; key = `pane_id`)
```js
/** @typedef {'idle'|'working'|'blocked'|'done'|'unknown'} Status */
Entity = {
  id: 'w1:p3',                    // pane_id (demo: 'd1:p3'; never valid in herdr)
  terminalId: 'term_…',
  kind: 'claude'|'codex'|'gemini'|'agent'|'shell',  // herdr `agent` ?? 'shell'; unrecognised agent kinds → 'agent'
  name: 'scout',                  // §4.3 display name (stable-ish)
  seedKey: 'scout',               // personality seed input; stable for the pane's life
  status: Status,                 // shells: always 'unknown' from herdr → renderer uses `process` instead
  statusSince: 1727400000000,     // ms epoch, server clock (renderer corrects with hello.serverNow skew); persisted
                                  // across backend restarts by world/since.js (§4.3.1)
  statusSinceApprox: false,       // true = first-ever sighting seeded from a transcript/boot estimate (§4.3.1); the
                                  // renderer tones down time-derived visuals (dust, mug, rain cloud) while true
  identity: {terminalId, agentSession, place},   // stable identity for UI persistence (pins, notes, tabs; §8.10);
                                  // place = `${ws.label}/${tab.label}/${paneIndex}/${cwd}`; match order = §4.2 rekey order
  stateSeq: 4,                    // herdr agents[].state_change_seq (null for shells); keys acks and prompt hashes
  ack: {at: ms, by:'hq'} | null,  // HQ sign-off of `done` (§6.8.2); only non-null while status==='done' && stateSeq unchanged
  layoutRect: {cols, rows} | null,// the pane's rect in herdr `layouts[]` (control-size policy, §4.7)
  workspace: {id:'w1', label:'hq-core', number:1, colorIndex:0-7, cycle:0, slot:0, status: Status},
                                  // slot = stable ordinal from world/slots.js (bay allocation input, §6.4)
  tab: {id:'w1:t2', label:'claude', number:2, index:0},   // index = order within workspace
  paneIndex: 0,                   // order within tab (layout reading order)
  cwd: '/home/…/claude-hq', project: 'claude-hq', repo: 'claude-hq'|null,
  baseTitle: 'vim foo.js'|null,   // herdr terminal_title_stripped, every pane kind; WorldModel (base) owns it (D2)
  title: 'Route stops display'|null,         // agent task title (transcripts ai-title / demo); null for shells.
                                  // Never display either raw: surfaces use taskLabel() (title → baseTitle → prompt)
  focused: false,                 // focused in the herdr TUI
  activity: { tool: 'Bash'|null, cls: ToolClass|null, detail: 'npm test'|'', since: ms } | null,
  model: 'claude-opus-5-5'|null, modelTier: 'opus'|'sonnet'|'haiku'|'other'|null,
  contextTokens: number|null, outputTokens: number|null,
  subagents: [{id, type, label, active: bool}],   // active = mtime < 30 s; max 8 reported
  todos: [{content, status:'pending'|'in_progress'|'completed', activeForm}] | null,
  struggle: {level: 0|1|2|3, reason:'fails'|'errors'|'noEdits'} | null,  // §4.4; only while working
  lastPrompt: string|null,
  prompt: {question, options:[{key:'1', label:'Yes', index:0}], selected:0, numbered:true, hash:'a1b2c3', raw} | null,
                                  // only while blocked; hash = hash32(stateSeq + question + option labels) (§4.8)
  process: {name:'vim', argv:'vim foo.js', activity:ShellActivity} | null,   // shells (and agent panes' fg proc)
  res: {cpu: pct, rssMB} | null,  // M4: process-tree attribution
}
```
`ToolClass` (from `shared/classify.js`) is one of:

| Class | Tools |
|---|---|
| `edit` | Edit, MultiEdit, NotebookEdit |
| `write` | Write |
| `read` | Read |
| `search` | Grep, Glob, LS |
| `bash`, `test`, `build`, `git`, `net` | Bash, sub-classified by the command |
| `web` | WebSearch, WebFetch |
| `task` | Agent, Task, Workflow |
| `todo` | TodoWrite |
| `mcp` | `mcp__*` |
| `ask` | AskUserQuestion |
| `think` | Last block is `thinking` |
| `talk` | Last block is `text` |
| `compact` | Context compaction |
| `other` | Anything else |

`ShellActivity`: `prompt edit test serve monitor remote repl git build run`.

**Task label (`shared/task.js`, @pure, LEAD):** `taskLabel(entity) → string|null`, 3–6 words, ≤ 28 chars, used by the
roster, status card, desk placard, ticket, pennant and storefront line (§6.7). Source order: `title` → first clause of
`lastPrompt` (stopwords trimmed); agents insert `baseTitle` after `title` (D2). Shells: `process.argv` basename + first arg →
`baseTitle` → `null` (placard shows the project). Prompt-style titles (`user@host: ~/dir`, bare paths) never label.
Pure so every surface shows the identical string; unit-tested on real titles/prompts.

Workspace list: `{id, label, number, colorIndex, cycle, slot, status, focused, paneCount, tabs:[{id,label,number,status}]}`.
- `colorIndex` comes from `identity.workspaceColorIndex(label, takenByLowerNumbers)`: a hash of the label with linear probing,
  so the same label keeps its colour across restarts.
- `cycle = floor(n/8)` adds the stripe variant (ART §5.4).

### 3.2 Stats (1 Hz; `disks` every 30 s)
```js
Stats = { at, host, uptime,
  cpu: {total, cores:[pct×16], load:[1,5,15], freqMHz, psi:{cpu, mem, io}},
  mem: {total, used, cache, swapTotal, swapUsed},                 // bytes; used = MemTotal − MemAvailable
  disks: [{mount, fs, total, used}], io: {readBps, writeBps},
  gpu: {busy, vramUsed, vramTotal, gttUsed, gttTotal, clockMHz, powerW, tempC} | null,
  temps: {cpu, nvme, wifi, gpu},                                   // °C or null; hwmon found by name
  net: {rxBps, txBps, ifaces:[name]},
}
```
- The server keeps a 300-sample ring and sends it in `hello.statsHistory`, so sparklines are full immediately.
- Stats are always **real**, even in `--demo`, because they are read-only and harmless.

### 3.3 Server → renderer
| `t` | Payload | Notes |
|---|---|---|
| `hello` | `{protocol, serverNow, session, instanceId, demo, timescale, herdr:{connected, protocol, readOnly}, allowMutations, settings, statsHistory, limits}` | First message. Renderer checks `protocol` first (§4.11) |
| `world` | `{entities:[Entity], workspaces:[…], focusedPaneId}` | Full state: on connect, after a herdr reconnect settles (§4.2), on demand |
| `entity` | `{entity}` | Upsert. Full object, diffed server-side so it is only sent on change; coalesced per id per 50 ms |
| `gone` | `{id, reason:'closed'\|'exited'\|'rekeyed', newId?}` | Never sent while herdr is offline or inside the reconnect grace window (§4.2) |
| `workspaces` | `{workspaces, focusedPaneId}` | |
| `event` | `{id, kind, detail?}` | One-shot moments (`EVENT_KINDS`): `arrived` `left` `blocked` `unblocked` `finished` `error` `test-pass` `test-fail` `commit` `subagent-spawned` `subagent-done` `compact` `tool` (detail = {tool, cls}) `acked` `struggle` (level change) `news` (unread signal, §8.9). Emitted by WorldModel or by enrichers via `emitEvent` (§4.0). Suppressed during reconnect grace |
| `stats` | `{stats}` | |
| `herdr` | `{connected, retryInMs?, reconnecting?}` | |
| `screen` | `{id, lines:[string], cols, rows, ansi?}` | Monitor text for watched ids, ≤ 1 Hz each. From the terminal mirror when one exists (§4.7), else `pane.read` |
| `term.state` | `{id, state, mode:'observe'\|'control', cols, rows, writer:bool, sizer:bool, detail?}` | Drawer lifecycle (§8.4). `state ∈ connecting live busy taken gone offline reconnecting released error readonly`. `cols/rows` = the child's grid; every viewer's xterm uses exactly this grid (§4.7) |
| *binary* `term.data` | `id, full, bytes` | Rendered-screen ANSI → `xterm.write(Uint8Array)`. `full` = serialized snapshot from the mirror |
| `toast` | `{level, text}` | Server-side notices |
| `term.ack` | `{id, upTo}` | Input credit for the interactive path (§3.4): cumulative bytes written to the child's stdin; coalesced ≤ 1 per 50 ms or per 16 KB |
| `timeline` | `{since, items:[{at, id, identity, kind:'status'\|EVENT_KIND, from?, to?, detail?}]}` | Reply to `timeline.get`; ≤ 2000 items (§4.3.1) |
| `reply` | `{rid, ok, error?, …}` | |

`term.opened`/`term.closed` from v1 are folded into `term.state` (closed ≙ state `gone|taken|released|error` with `detail` =
herdr's reason).

### 3.4 Renderer → server
| `t` | Payload | Gate (§4.8) |
|---|---|---|
| `hello.ack` | `{protocol}`: first message after `hello`; nothing else is accepted before it (§4.11) | always |
| `term.open` | `{id, cols, rows, mode?:'observe'}` → reply `{mode, cols, rows}`. Default and only initial mode is **observe** (§4.7) | always |
| `term.promote` | `{id, cols, rows, takeover?:bool}` → observe→control; sent on first keystroke, paste or explicit resize | always |
| *binary* `term.input` | **Two paths.** *Interactive* (xterm `onData` from typing, ≤ 4 KB): binary kind 2, **no rid, fire-and-forget**, written to the child in order; the client keeps ≤ 64 KB un-acked (credit window, `term.ack`) and only queues locally beyond that. *Paste* (a single `onData` > 4 KB, or any `xterm.paste`): **JSON** `{t:'term.input', id, text, paste:true, rid}` in ≤ 16 K-char UTF-8-safe chunks (D6: binary frames have no rid field), next chunk only after the reply (hub awaits stdin `drain`, §8.6). Paste chunks do not count against the interactive credit window. To an observe viewer → `{ok:false, error:'not_controller'}` (paste) or one `term.state` resend (interactive); the server **never** auto-promotes | always (control writer only) |
| `term.writer` | `{id}`: take the keyboard from another HQ window on the same backend (no herdr takeover) | always |
| `term.fit` | `{id, cols, rows}`: this viewer's settled drawer grid (§8.5). Observe: respawns the observe child only if this viewer is the **sizer** (never a PTY resize). Control: stored, never applied | always |
| `term.resize` | `{id, cols, rows}` (clamped 10–500 × 4–200): **explicit** user resize only (§8.5); resizes the PTY | control writer only; rejected in observe |
| `term.pause` / `term.resume` | `{id}`: stop/restart binary frames to this client for a background tab; resume → one serialized `full` frame (§8.5) | always |
| `term.history` | `{id, lines≤5000}` → reply `{ansi}` via `pane.read {source:'recent', format:'ansi', lines}`; local scrollback overlay (§8.6) | always (read-only) |
| `term.scroll` | `{id, dir:'up'\|'down'\|'bottom', lines}` → reply `{offsetFromBottom}`. **Moves the pane's global herdr scroll (verified, §4.7)** | control writer only, and only with setting `scrollMode:'herdr'` |
| `term.copyRecent` | `{id, lines≤5000}` → reply `{text}` via `pane.read {source:'recent_unwrapped', format:'text'}` | always (read-only) |
| `term.close` | `{id}` | always (release when the last viewer leaves) |
| `screen.watch` | `{ids:[≤6]}` | always (replaces this client's watch set) |
| `done.ack` | `{id, stateSeq}` → HQ sign-off overlay (§6.8.2) | always (HQ-local, touches nothing in herdr) |
| `herdr.focus` | `{id}` (also the only way to clear herdr's own `done`, §6.8.2) | explicit only (moves the user's TUI) |
| `agent.prompt` | `{id, text}` → reply `{ok}` | interact |
| `agent.answer` | `{id, key, promptHash}` → server re-validates (§4.8) → reply `{ok}` or `{ok:false, error:'prompt_changed', prompt}` | interact |
| `agent.keys` | `{id, keys:[≤16]}` | interact |
| `agent.explain` | `{id}` → reply `{explain}` (herdr `agent.explain`, read-only) | always |
| `spawn` | `{workspaceId?, cwd?, kind?:'claude'\|'codex', label?, name?}` → `{paneId}`; no kind = shell (new tab) | structural |
| `pane.close` | `{id}` | structural + UI confirm |
| `settings.set` | `{patch}` | always; persisted in `~/.config/claude-hq/config.json` |
| `world.get` | `{}` | always |
| `timeline.get` | `{since}` → `timeline` (§4.3.1) | always (read-only, HQ-local) |
| `note.set` | `{id, text≤280 \| null}` → HQ-local sticky note (§8.10) | always (HQ-local) |
| `demo.force` | `{id, patch}` / `demo.scenario {name}` / `demo.event {id, kind}` | demo only |

The renderer store (`renderer/src/net/store.js`) exposes the following. No other renderer module touches the WebSocket.
- `store.entities: Map`, `store.workspaces`, `store.stats`, `store.statsHistory`, `store.conn`, `store.hello`.
- `store.on(evt, fn)` for events `entity`, `gone`, `world`, `workspaces`, `event`, `stats`, `screen`, `term.*`, `conn`, `herdr`.
- `send(msg)`, `call(msg) → Promise`, `sendBytes(id, Uint8Array)`, `onTermData(id, fn)`.
- **The store applies messages eagerly in `ws.onmessage`**, never in the frame loop (rAF stops in hidden tabs). Entity/screen
  messages are coalesced per id into the map; listeners fire on a microtask. Binary `term.data` goes straight to the
  registered xterm writer. Notifications (`src/ui/notify.js`: chime, title badge, OS notification) subscribe to store
  events, so they fire while the tab is hidden. The frame loop only *reads* the store.

### 3.5 Contract additions & LEAD decisions (M0 exports as shipped in `shared/`, `server/interfaces.js`; M1 D1–D8)
- **`shared/protocol.js`** also exports: `S2R`/`R2S` type constants; `ACTION_CLASS` (t → §4.8 class, plus `demo`);
  `ERR` error codes (`bad_message unknown_entity not_controller prompt_changed not_accepted terminal_limit
  readonly_protocol mutations_disabled not_demo herdr_offline no_hello_ack protocol_mismatch internal`); `CLOSE`
  codes; `LIMITS` (every cap in §3.4/§4.7/§4.8/§4.11) and `DEFAULT_LIMITS` (= `hello.limits`); `DEFAULT_SETTINGS` /
  `SETTINGS_KEYS` (the §8 settings list plus `volumeMaster/Sfx/Ambient`, `leaderKey`, `idleDemotion`, `platform`);
  `EVENT_OWNERS`, `LIVE_OWNERS`/`DEMO_OWNERS`, `fieldOwnerMap()`, `FIELD_DEFAULTS`, `ENTITY_FIELDS`;
  `validateMessage()`, `parseClientText()` (64 KB cap first → `close:true`), `validateBinaryInput()`, rule builders
  `R.*`; codec helpers `encodeTermData`/`encodeTermInput`. VALIDATE is **strict**: unknown fields are rejected, `rid` is
  a non-negative int or a string ≤ 64. `term.input` also has a JSON text form `{id, text, paste?}`: the paste path
  (with `rid`, D6) and tools/tests. `SHARED_EVENTS` + `mayEmit(owner, kind, entityKind)` implement D3.
- **`shared/identity.js`** also exports `hashHex`, `promptHash(stateSeq, question, labels)` (§4.3 recipe, 8 hex chars),
  `assignWorkspaceColors(workspaces)` (cycle = floor(n/8) by `number`; probing only within a cycle band), `placeOf`,
  `findByIdentity(saved, entities)` (key-by-key across all entities; an ambiguous key falls through), `identityKey`.
  `hash32` = FNV-1a over UTF-8 + murmur3 fmix32; golden values pinned in `identity.test.js`.
- **`server/interfaces.js`**: base classes `HerdrSource` (EventEmitter), `Enricher(name)` (owns/events default from
  the tables), `TerminalBackend`, `TerminalHandle` (listener plumbing; subclasses call `_frame`/`_closed`), plus
  `assertEnricher`, `checkPatch(e, patch, {dev})`, `closedReasonToState(reason)` (§4.7 table).
- **M1 LEAD decisions (D1–D8; each is also written into its home section):**
  - **D1 cream:** `cream #F4EDE3` (L\* 94) and `paper` are **UI-only** (DOM, bubbles, LUT fixed point). In lit 3D, "cream"
    means `wallCream #DBD0C3` (L\* 84; walls, large surfaces) or `trim #EFE6D6` (L\* 92; small props, piping, keys). §5.5.
  - **D2 titles:** base-owned `baseTitle` = herdr `terminal_title_stripped` on every pane; `title` stays transcripts/demo
    (agent task title only, no base fallback inside the enricher). Display goes through `taskLabel()` only. §3.1, §4.0.
  - **D3 shared events:** an event kind listed under two owners (`commit`, `news`) is split by pane kind: agent panes →
    transcripts/demo, shells → procinfo. WorldModel checks `mayEmit` (dev throws, prod drops). §4.0.
  - **D4/D5 briefs:** §3.5 is in every protocol-facing brief; briefs inline only their own milestone rows (generator). §11.0.
  - **D6 paste:** JSON `term.input {paste:true, rid}`; binary kind 2 is interactive-only (flags ≠ 0 → `bad_message`). §3.4.
  - **D7 proto room seats 12:** 12 desks (3 pods of 4), ≈ 12 × 9 m. §7.1, M1.
  - **D8 demo session:** in `--demo`, `hello.session` is `'demo'` (never `'default'`) unless `--session` is given; the banner
    says DEMO. §4.9 (BE `config.js`).
- **M2 contract merges (LEAD m2 fix r2, from the m15 + m2 proposals):**
  - **`shared/clock.js`** (LEAD; added by FX r1): `waitClock(ms, approx?)` → `m:ss` under an hour, then `h:mm:ss`; `approx`
    (`statusSinceApprox`) prefixes `≥ `. The one wait-clock formatter for the alert bubble, Inbox cards, roster rows,
    status card and recap; no surface formats a wait itself.
  - **`layout.keepClearViews`** (BRN r1): `{id, x, z, level, yaw}[]` authored viewpoints (spawn + §9.2 cameras); directors
    read only this (never `debug/poses.js`), `layout.test` keeps it in sync. **`levels[].cameraWells`** (LVL m2 r1): §6.6.
  - **`ctx.director`** (LVL r1): `main.js` publishes the director on ctx so `world/build` reads `director.bayState()` for
    the live bay signs (§7.2). Read-only for the world.
  - **Animator** (CHR m15): `createAnimator(rig, {seedKey?, ground?})`, `ground(x,z)` = world floor height (mini-Clawds);
    activity/reaction context carries `crown` (rig head-top height, default 0.545) and `seated` (head-clearing poses,
    seated reactions).
  - **Street palette** `strPavers`/`strBrick`/`strMortar` (RND m2 r1): §5.5. **A\* Float32 scratch** (BRN m2 r1): §6.6.
    **Stats split** `drawCalls.post/prepass`, `programs.total`, `frameErrors` (CORE/RND m2): §5.3.
- **M3.5 contract (LEAD, "walk up and manage" wave):** Entity gains `lastText` (last assistant text, ≤ 280 chars) and
  `work {since, added, removed, files}` (current task = since the latest real user prompt; counts from Edit/MultiEdit/
  Write inputs), both transcript-owned (BE2; `demo` writes them too). `Struggle` gains `reason:'context'` and an optional
  `detail` line ("3 test fails in a row"). `spawn` accepts `prompt` (first prompt for an agent kind; BE sends it via
  `agent.prompt` once the agent reports idle, ≤ 20 s). `LIMITS.watchMax` 6 → 8, `watchUnionMax` 12 → 16 (monitor atlas).
  Renderer-side screen watches go through ONE arbiter, `ctx.screens.want(tag, ids[])` (RND, `render/screenFeed.js`):
  it unions every tag's ids (priority: triage/peek > proximity > nearest-visible) and sends one `screen.watch`; nobody
  else sends `screen.watch`. New renderer bus topics: `verb {verb, id}` (UI emits pat/summon/prompt/highFive),
  `answered {id, key}`, `inbox.zero {answered, ms}`, `prompt.sent {id}`, `spawn.sent {paneId, kind}` (UI emits; BRN, CHR,
  FX, AUD consume).
- **Dev ports:** `vite.config.js` honours `HQ_VITE_PORT` / `HQ_BACKEND_PORT` (defaults 7461/7462); renderer may import
  shared code as `@shared/…`.

---

## 4. Backend

### 4.0 Internal seams (`server/interfaces.js`, LEAD, written in M0)
The three interfaces below are the only way backend modules talk to each other across WP boundaries. Live and demo modes
differ **only** in which implementations `app.js` wires in.

```js
/** HerdrSource: raw herdr truth. Implemented by HerdrLive (§4.2), DemoWorld (§4.9), Replay (§4.9). */
interface HerdrSource extends EventEmitter {
  connected: boolean;
  snapshot(): RawSnapshot | null;          // herdr-shaped: {workspaces, tabs, panes, agents, layouts, focused_*}
  request(method, params): Promise<result> // same method names/params/errors as the herdr socket (subset in demo)
  // events: 'snapshot'(raw) · 'status'(pane_id, status, seq) · 'connected'(bool) · 'reconnected'({grace:true})
}
/** Enricher: adds facts to one pane. Implemented by transcripts, subagents, procinfo, blocked, acks, demo. */
interface Enricher {
  name: string;
  owns: string[];                          // Entity fields it writes; must equal FIELD_OWNERS (checked at wire-up)
  events: string[];                        // EVENT_KINDS it may emit
  attach(id, base, ctx): void;             // pane appeared (or kind changed); ctx = {source, clock, log, session, sinceHint}
                                           // clock = server/clock.js (§4.13): never call Date.now()/setTimeout directly
  update(id, base, prevBase): void;        // after EVERY base-entity change (status, stateSeq, cwd, kind, agent session…),
                                           // before the merged entity is diffed; start/stop pollers here
  detach(id): void;                        // pane gone (after grace)
  onPatch: (id, partialEntity) => void;    // set by WorldModel; only fields in `owns`, else throws in dev / drops in prod
  emitEvent: (id, kind, detail?) => void;  // set by WorldModel; kind ∈ this.events; grace-suppressed and recorded (§4.9)
}
/** TerminalBackend: one terminal stream per pane. Implemented by HerdrTerminals (herdr CLI child) and FakeTerminals. */
interface TerminalBackend {
  open(id, {mode:'observe'|'control', cols, rows, takeover?}): TerminalHandle;
}
interface TerminalHandle {
  onFrame(fn(bytes: Uint8Array, full: boolean)); onClosed(fn({code, reason}));
  input(bytes): Promise<void>;  resize(cols, rows); scroll(dir, lines); release(): Promise<void>;
}
```
- **DemoWorld emits raw herdr-shaped snapshots and status events** (so WorldModel, naming, event derivation and the
  reconnect logic run unchanged in demo), plus a `DemoEnricher` that patches transcript-only facts (activity, model,
  context, todos, subagents). Its `request()` implements `pane.read` (`detection` returns realistic prompt text so
  `blocked.js` parses real strings), `pane.send_keys`, `agent.prompt`, `pane.focus`, `agent.explain`, `spawn`/`close`.
- `actions.js` only ever calls `source.request(...)`; it does not know which mode it is in.
- WorldModel owns the Entity map: `raw snapshot → base entity` → `update(id, base, prev)` on every enricher → shallow-merge
  each enricher's latest patch by field ownership → diff → `entity`/`gone`/`event`. `update` runs synchronously, so a
  status change and the enricher reaction to it (e.g. `activity → null` on leaving `working`) ship in **one** `entity`.
- **Field and event ownership** (`FIELD_OWNERS` in `shared/protocol.js`; a field has exactly one writer):

  | Owner | Entity fields | Events it emits | Reacts in `update` to |
  |---|---|---|---|
  | WorldModel (base) | id terminalId kind name seedKey status statusSince statusSinceApprox identity stateSeq layoutRect workspace (incl. `slot` from `world/slots.js`) tab paneIndex cwd project repo focused baseTitle | arrived left blocked unblocked finished tool | — |
  | transcripts (Claude) | activity model modelTier contextTokens outputTokens todos lastPrompt title struggle | error test-pass test-fail commit compact struggle news | status ≠ working → `activity:null` (or `ask`), `struggle:null`; `agent_session` change → re-locate file |
  | subagents | subagents | subagent-spawned subagent-done | cwd / session change |
  | procinfo | process res | commit (shell argv `git commit\|push`) news (shell output after the prompt): **shells only** (D3) | kind (poll 2.5 s shell / 10 s agent) |
  | blocked | prompt | — | status → blocked: start 2 s `pane.read detection` poll; leaves blocked: stop, `prompt:null`; stateSeq change → re-hash |
  | acks | ack | acked | status ≠ done or stateSeq changed → `ack:null` (entry deleted) |
  | demo (DemoEnricher) | the transcripts + subagents rows (replaces both in `--demo`) | same as those rows | same |

  `screens.js` is not an enricher (it writes `screen` messages, no Entity fields).
- **Shared event kinds (D3).** `commit` and `news` have two possible emitters; the pane's kind picks one: agent panes →
  transcripts (demo: DemoEnricher), shells → procinfo. `mayEmit(owner, kind, entity.kind)` in `shared/protocol.js` is
  the check WorldModel runs on every `emitEvent` (dev throws, prod drops). A new shared kind must be added to
  `SHARED_EVENTS` with its split rule; the protocol test fails otherwise.
- **Events never bypass `emitEvent`**: exit status and `is_error` stay inside the transcripts enricher, which turns them
  into `test-pass`/`test-fail`/`error`. DemoEnricher emits the same kinds from its schedule, so demo and live share one
  path to the renderer and to `record.js`.

### 4.1 herdr client (`server/herdr/client.js`)
- **One resolver (`herdr/resolve.js`).** `socketFor(session)` (lifted from the snippet: `default` →
  `~/.config/herdr/herdr.sock`, else `~/.config/herdr/sessions/<name>/herdr.sock`) is the only place a socket path is
  computed; `client.js` connects to it and passes the **same** `--session <name>` to every child. Verified 2026-09-27
  (research/herdr-api §0): `herdr --session default workspace list` with a scrubbed env returns the default session's
  data (identical to the direct socket), and creates no `sessions/default/` dir or server; an unknown name returns
  `server_not_running` and creates nothing. M1 re-verifies for `terminal session observe` on hqtest (argv + socket in
  the fake-bin log).
- **Ping before spawn.** At startup (and after each reconnect) `ping` over `socketFor(session)` must succeed with
  `protocol === 22` (or enter read-only, below) **before** any subscription or terminal child is spawned. No ping → no
  children, `herdr {connected:false}`.
- **Default-socket guard:** see §2.2 (demo/replay never resolve; hqtest/dev:hq/tests/`--allow-mutations` refuse the
  default socket by realpath).
- Lift from `docs/research/snippets/herdr.mjs`. Connections:
  - Requests: one connection per request, `params` always an object, and errors matched on the first line (the error `id` may be `""`).
  - Subscriptions: a long-lived connection.
- Binary: `HERDR_BIN_PATH` or `~/.local/bin/herdr`.
  - Every child gets `--session <name>` **and** a scrubbed env with no `HERDR_SOCKET_PATH/HERDR_SESSION/HERDR_PANE_ID/HERDR_TAB_ID/HERDR_WORKSPACE_ID/HERDR_ENV`,
    plus the reaper tags `CLAUDE_HQ_INSTANCE=<instanceId>` and `CLAUDE_HQ_SESSION=<session>` (§4.7.1).
- On startup `ping` must report `protocol === 22`. **On a mismatch the client enters read-only mode** (`hello.herdr.readOnly`):
  only the READ class below and `terminal session observe` work; control, interact, focus and structural calls throw
  `readonly_protocol`; the renderer shows a persistent banner ("herdr protocol N ≠ 22: read-only") and drawers stay in
  Peek (`term.state readonly`).
- **Method allowlist (defence in depth; `client.js`, not only `actions.js`).** `new HerdrClient({session, allowMutations,
  readOnly})`; every `request(method)` and `spawnTerm(mode)` is classified, and anything unlisted throws `method_denied`:

  | Class | Methods | default session | named session |
  |---|---|---|---|
  | READ | `ping` `session.snapshot` `events.subscribe` `workspace.list` `tab.list` `pane.list` `pane.get` `pane.read` `pane.process_info` `agent.list` `agent.get` `agent.read` `agent.explain`; spawn `observe` | ✓ | ✓ |
  | CONTROL | spawn `terminal session control` | ✓ only with a hub-issued one-shot `promoteToken` (created on `term.promote`) | same |
  | INTERACT | `pane.send_keys` `agent.prompt` | ✓ | ✓ |
  | FOCUS | `pane.focus` | ✓ | ✓ |
  | STRUCTURAL | `workspace.create/close/rename` `tab.create/close/rename` `pane.split/close/run` `agent.start/stop` | **throws unless `allowMutations`** | ✓ |
  | NEVER | `server.stop` `session.stop/delete`, anything unknown | throws | throws |
- **Never** call `server stop`, run bare `herdr`, or make focus calls without an explicit renderer request.

### 4.2 HerdrLive (`server/herdr/live.js`): the live-model recipe (herdr-api §3)
1. `ping` → open the structural subscription (all global types) → buffer → `session.snapshot` → apply snapshot + buffer.
2. **Status subscription:** one connection per agent pane, `[{type:'pane.agent_status_changed', pane_id}]`.
   - Rebuild on `pane_created`, `pane_agent_detected` and `pane_closed`.
   - A pane that no longer exists makes the whole subscription fail, which is why each pane gets its own connection.
3. **Reconcile:** a snapshot 80 ms (debounced) after any structural event, plus every 1.5 s.
   - The snapshot is the truth; events are only latency hints.
4. **Offline:** on EOF or ECONNREFUSED, emit `herdr {connected:false}`, retry every 2 s, and keep the last world.
   While offline the model is frozen: no `gone`, no events, statuses unchanged (the renderer dims and dozes, §8 Offline).
5. **Reconnect grace (15 s).** herdr restores panes on restart but may assign new `pane_id`s (it re-runs
   `claude --resume`). After reconnecting:
   - Match each new pane to an old entity by `terminal_id`, then `agent_session.value`, then `(workspace label, tab label,
     pane index, cwd)`. A match **re-keys** the entity: the server sends `gone{id:old, reason:'rekeyed', newId}` +
     `entity`; the renderer moves the existing actor to the new id without leave/arrive animations.
   - During the grace window, `arrived`/`left`/`finished`/`blocked` events are suppressed, and unmatched old entities are
     kept. After it, unmatched old entities get `gone` (one batched message), and new ones arrive normally.
   - Acks (§6.8.2) follow the re-key; workspace `slot`s are keyed by workspace label + number, so they survive too.
6. **Emits:** `snapshot(raw)` and `status(pane_id, status, seq)`, which flows through to WorldModel immediately.

### 4.3 WorldModel (`server/world/model.js`)
Merges raw herdr panes with enrichers into `Entity` objects, deep-diffs them, and emits `entity`, `gone` and `event`.

- **Status hysteresis:** none server-side. The server tells the truth, and the renderer smooths.
- **Naming (`naming.js`):**
  - `name` = herdr `name` → non-numeric tab label → `basename(cwd)`. Append `·2`, `·3` for duplicates within a workspace.
  - The title is **not** used as a name because it churns every task. It goes in `title`.
  - `seedKey` = herdr `name` ?? `pane_id`.
  - `project` = `worktree.repo_name` ?? `basename(foreground_cwd ?? cwd)`.
- **Events** (who emits: §4.0 table):

  | Event | Trigger | Emitter |
  |---|---|---|
  | `blocked`, `unblocked` | Status transitions | WorldModel |
  | `finished` | working → done or idle after ≥ 3 s of working | WorldModel |
  | `arrived`, `left` | Pane appears or disappears **after the first snapshot** (panes in the first snapshot never emit `arrived`, §6.4.3) | WorldModel |
  | `tool` | merged `activity.tool` changes | WorldModel |
  | `error` | `tool_result.is_error` | transcripts |
  | `test-pass`, `test-fail` | A test-class Bash result: exit status or output match on `passed\|failed` | transcripts |
  | `commit` | A git-class Bash command matching `commit\|push` | transcripts (agent panes) / procinfo (shells), D3 |
  | `subagent-*` | Subagent start and finish | subagents |
  | `compact` | Context compaction | transcripts |
  | `struggle` | `struggle.level` changes (§4.4) | transcripts |

- **Blocked prompt (`blocked.js`, an enricher; **M1**):**
  - Started/stopped from `update()` on status: while blocked, run `pane.read {source:'detection', format:'text'}` every 2 s.
  - Parse the `❯ 1. Yes` / numbered or bulleted options into `prompt`. The question is the last non-option paragraph.
    `selected` = index of the line carrying `❯`; `numbered` = every option has a `N.` prefix.
  - `prompt.hash = hash32(stateSeq + '\n' + question + '\n' + labels.join('\n'))`.
  - Answers go through `pane.send_keys`, never `agent.prompt`, because herdr rejects `agent.prompt` while blocked. The
    answer algorithm is in §4.8.
- **Screens (`screens.js`):**
  - The union of all clients' `screen.watch` sets, capped at 12.
  - If the pane has a live terminal mirror (§4.7), lines come from the mirror (ANSI colours, no polling).
  - Otherwise `pane.read {source:'visible', format:'text'}` at ≤ 1 Hz each, sending only when `revision` changes.

#### 4.3.1 Honest time across restarts (`world/since.js`, `world/timeline.js`)
herdr exposes no transition timestamps, so without persistence every backend/Electron restart would reset `statusSince`
to boot time (dust ladder, mug streaks, rain cloud, queue/Pit order, overflow sort).
- **Persist** `~/.config/claude-hq/<session>/since.json`: `{[stableKey]: {stateSeq, status, since, approx}}` where
  `stableKey` = `terminalId` (else `agentSession`, else `place`). Written debounced (1 s) and on shutdown; entries for
  panes gone > 24 h are pruned. Re-keys (§4.2) carry the entry.
- **On sighting a pane:** if a record exists with the same `stateSeq` and `status` → reuse `since` and `approx`. Agents
  with changed `stateSeq`, or shells whose `status`/`process.activity` changed → `since = now`, `approx = false`. No
  record (first-ever sighting) → `since = now`, `approx = true`, then accept **one** `ctx.sinceHint(id, ms)` from an
  enricher: transcripts passes the timestamp of the last transcript line (≈ when an idle/done agent went quiet), and
  `since` becomes `min(now, hint)`, still `approx = true`. Any later real transition clears `approx`.
- Renderer (§6.4.1, §6.7): while `statusSinceApprox`, dust is capped at level 1, mugs show plain (no steam), the rain
  cloud waits for 5 min of *observed* time, and elapsed chips render as `~12m`. Ordering (queue, Pit, overflow) still uses
  `statusSince`.
- **Timeline ring** (`timeline.js`, M2): every status transition and every `event` per pane, 24 h, ≤ 20k items,
  persisted to `timeline.ndjson` (rotated at 2 MB, metadata only: never prompt text). Served via `timeline.get {since}`.
  Feeds the away recap (§6.4.5), roster sparklines, Daily Diff and "longest block today" honestly.

### 4.4 Transcripts (`server/enrich/transcripts.js`, Claude only)
- **Locate:** `~/.claude/projects/<cwd with [^A-Za-z0-9]→'-'>/<agent_session.value>.jsonl`.
  - Fall back to a glob, at most one scan per 10 s per missing id.
  - The file may not exist yet, because it is created on the first prompt.
- **Tail:**
  - First read: the last 512 KB, dropping the partial first line.
  - Then `fs.watch` plus a 1.5 s stat poll, reading `[offset,size)` with a partial-line buffer. Reset if the file shrinks.
- **Derive:**
  - Current tool = the last `tool_use` without a matching `tool_result`.
  - `think` or `talk` comes from the last block type.
  - `model` = `message.model`.
  - Context = `input + cache_read + cache_creation` of the latest assistant `message.id`. Dedupe usage by `message.id`.
  - `title` = `ai-title`. `lastPrompt` = `last-prompt`, or the latest real user string.
  - `todos` = the latest TodoWrite `input.todos`.
  - `detail`: a file basename, a command up to 60 chars, a pattern, a query, or a subagent description.
- Transcript `activity` is only trusted while herdr says `working`. When the status is idle, done or blocked, the activity is
  set to `null`, or `ask` for a pending AskUserQuestion (done in `update()`, §4.0).
- **Struggle** (honest "what is it stuck on" short of blocked; M2): `level` = max of
  (consecutive `test-fail`/`error` results with no `test-pass` and no successful Edit/Write in between: 2 → 1, 4 → 2, 6 → 3)
  and (working streak with no Edit/Write/MultiEdit: 10 min → 1, 20 min → 2). `reason` names the dominant term. Cleared
  (`null`, `struggle` event with level 0) on `test-pass`, on a successful Edit/Write after fails, or when leaving `working`.
- **Load shaping:** initial 512 KB tails are staggered over 2 s (≤ 1 new tail per 50 ms) and parsed in ≤ 64 KB chunks
  yielding via `setImmediate`, so 40 agents × 22 MB files never stall the WS loop or terminal streaming. Parse budget
  ≤ 4 ms per event-loop turn; the rest waits.

### 4.5 Subagents & process info
- **Subagents** (`enrich/subagents.js`):
  - Every 2 s, `readdir` + `stat` on `<projdir>/<session>/subagents/`: `agent-*.jsonl` with `.meta.json` (`agentType`, `description`) and `workflows/*/`.
  - `active` = mtime < 30 s.
- **Process info** (`enrich/procinfo.js`):
  - `pane.process_info` every 2.5 s for shell panes, and every 10 s for agent panes (subprocess of interest).
  - `processActivity(name, argv)` → ShellActivity via `shared/classify.js`.

### 4.6 `shared/classify.js`
`toolClass(name, input)` and `bashCategory(cmd)` classify commands, matched against the command's first word(s):

| Category | Patterns |
|---|---|
| `test` | test, jest, vitest, pytest, `cargo test`, `go test`, `npm (run )?test` |
| `build` | build, make, `cargo build`, tsc, `vite build`, cmake |
| `git` | git |
| `net` | curl, wget, ssh, `npm i` |
| `bash` | Anything else |

`processActivity`:

| Activity | Processes |
|---|---|
| `edit` | vim, nvim, nano, hx, emacs |
| `test` | Test runners |
| `serve` | vite, `npm run dev`, docker, `*serve*`, http.server |
| `monitor` | top, htop, btop, watch |
| `remote` | ssh, mosh |
| `repl` | python, node, ipython with no script |
| `git` | git |
| `build` | Build commands |
| `run` | Any other foreground process |
| `prompt` | The shell itself: bash, zsh, fish |

Unit tests with a table of real samples.

### 4.7 TerminalHub (`server/terminals/hub.js`, `mirror.js`)
- **One herdr child per (pane, mode)** via the `HerdrTerminals` backend:
  `herdr --session S terminal session {observe|control} <pane_id> --cols C --rows R [--takeover]`.
  - Plain pipes, **no node-pty**. `terminal attach`/`agent attach` need a TTY and are unusable.
  - stdin stays open for the child's life. Commands: `terminal.input {text|bytes}`, `terminal.resize`, `terminal.release`
    (`terminal.scroll`: see below). The exit code is always 0; trust only `terminal.closed.reason`:

    | Reason contains | `term.state` |
    |---|---|
    | "already has an attached client" | `busy` |
    | "taken over" | `taken` |
    | "not found" | `gone` |
    | "detached" | `released` |
    | anything else | `error` |

  - **Verified on hqtest (herdr 0.9.0, research/herdr-api §4.1):** a *control* child detaches on `terminal.release` or
    stdin EOF. An *observe* child ignores both (no `terminal.closed`, no exit after 6 s), so the hub ends observe
    children with **SIGTERM** (then SIGKILL after 1 s) and never waits for `terminal.closed` from them.
- **Observe first, control on demand** (minimises side effects on the default session):
  - `term.open` always starts (or joins) an **observe** child. Observe never resizes the PTY, never reflows the user's
    herdr TUI and never makes Claude redraw.
  - The renderer sends `term.promote` on the first keystroke, paste, or explicit resize. Only `term.promote` mints the
    `promoteToken` that `client.js` requires to spawn a control child (§4.1); `term.input` to an observe viewer is
    rejected, never auto-promoted. The hub spawns the control child, buffers the user's input until the first control
    frame, swaps every viewer of the pane to the control stream (mirror resets on its first `full` frame), then SIGTERMs
    the observe child. Typical swap ≤ 150 ms; P2 stays at 2 inputs.
  - **Control size policy:** if the pane's `layoutRect` fits inside the writer's settled drawer grid, control at exactly
    `layoutRect` (no PTY resize, no reflow; drawers letterbox). Otherwise control at the writer's grid and show the
    "resizes your herdr pane to C×R" chip (§8.5). Afterwards only explicit `term.resize` changes it (§8.5).
  - Idle demotion: 10 min with no input → release control, fall back to observe (setting; default on in the default
    session). Background-tab demotion: §8.5.
- **Multi-viewer sizing rule** (one child per (pane, mode), shared by every HQ viewer on this backend):
  - **Observe child: sized by the *sizer*** = the viewer that opened it first. Later openers do not change it. When the
    sizer's settled grid changes (`term.fit`), the hub respawns the observe child at the new grid (≤ 1 respawn / 2 s per
    pane; the mirror resets on the new `full` frame). When the sizer closes or pauses, the oldest remaining active viewer
    becomes the sizer; the child is respawned only if the grids differ by > 10% in cols or rows.
  - **Control child: sized by the writer** per the size policy above.
  - **Everyone else letterboxes:** `term.state` carries the child's `cols×rows`; every viewer's xterm is exactly that
    grid, and the drawer fits it by font scaling (down to 0.7× of the user font size), then centred letterbox, then
    (if still too small) scroll-panning (§8.5). Viewers never resize a child they don't size.
  - **Promotion with other viewers:** when viewer A promotes, viewers B and C are moved to the control stream in the same
    swap: they receive one serialized `full` frame at the control grid, keep Peek mode and the "Another HQ window is
    typing — Take the keyboard" banner, and re-letterbox. On demotion/release, a new observe child is spawned sized by
    the ex-writer (still the sizer if it is open).
- **Screen mirror (`mirror.js`):** each live child feeds its frames into an `@xterm/headless` Terminal (+
  `@xterm/addon-serialize`; pure JS) at the child's grid.
  - Late joiners, reconnecting clients, resumed background tabs and clients flagged `needsFull` receive `serialize()` as
    one `full` frame. **No resize is ever used to force a redraw.**
  - The mirror also feeds `screen` messages for that pane (desk monitors become truly live).
  - Memory: one headless terminal per live child, scrollback 0; destroyed with the child.
- **Writer:** exactly one viewer per pane is the writer (the one that promoted, or the last to send `term.writer`).
  Others are read-only. This is HQ-internal and never uses herdr `--takeover`, so two HQ windows cannot ping-pong.
  - `--takeover` is only sent when the user clicks **Take over** on a `busy` state (an external `herdr attach` holds the
    pane). HQ never auto-retakes on `taken`.
- **Scroll (verified on hqtest):** `terminal.scroll` on an *observe* child is **ignored** (no frame, pane offset
  unchanged). On a *control* child it moves the **pane-global** herdr scroll offset (`pane.get → scroll.offset_from_bottom`
  = 20 after `up 20`; `pane.read visible` shows the scrolled screen) and every other viewer's frames, i.e. it scrolls the
  user's own herdr view. Therefore HQ's scrollback is **local by default**: `term.history` → `pane.read {source:'recent',
  format:'ansi', lines}` → a read-only overlay (§8.6). `term.scroll` exists only for the control writer with setting
  `scrollMode:'herdr'` and a "scrolls your herdr pane" chip; the hub always sends `scroll bottom` before release.
- **Caps** (`hello.limits`; over cap → `{ok:false, error:'terminal_limit'}` and the UI evicts its LRU tab):

  | Resource | Cap |
  |---|---|
  | WS clients per backend | 8 (the 9th upgrade gets close 1013 "try again later") |
  | Terminal viewers per client | 6 (= the drawer's LRU tabs) |
  | herdr terminal children per backend | 16 (+1 transient per in-flight promote swap) |
  | Child spawns | ≤ 4/s per backend, ≤ 1 respawn / 2 s per pane |
  | Paused viewers | dropped after 60 s paused (§8.5) |

- **WS backpressure:** per client, if `ws.bufferedAmount > 1 MB`, drop `term.data` diffs for that pane and mark the client
  `needsFull`. When it drains below 256 KB, send one serialized `full` frame. `entity`/`screen` are coalesced per id, so
  they never queue unboundedly.
- **Lifecycle:**
  - The last viewer's `term.close`: control → `terminal.release`, then SIGTERM after 1 s; observe → SIGTERM.
  - **WS drop:** the client's viewers are kept for a **10 s grace** keyed by the client's session id (sent in the WS URL);
    a reconnect within grace resumes the same child with a serialized `full` frame. After grace, release as above.
  - **Shutdown:** on `close()` and Electron `before-quit`, release every child and await exit (≤ 1.5 s).
- Opening/observing/controlling/typing **does not clear herdr's `done`** (verified, §6.8.2).
- **Input paths (§3.4).** Interactive frames are written to the child's stdin immediately in arrival order (no reply);
  the hub counts bytes written per (client, pane) and sends `term.ack {id, upTo}` (≤ 1 per 50 ms or per 16 KB). If the
  child's stdin is not draining, acks stall and the client's 64 KB window fills, so a wedged child cannot balloon server
  memory. Paste chunks keep the rid + `drain` gate.

#### 4.7.1 Child reaping (`server/reaper.js`): no orphans on the user's default session
Observe children ignore stdin EOF (research §4.1), so a backend that dies without cleanup would leave
`terminal session observe` processes attached to the default session indefinitely. Web mode usually runs under
ssh/mosh, where a disconnect sends SIGHUP.
1. **Signals:** `main.js` (and Electron main) handle `SIGINT`, `SIGTERM`, `SIGHUP` with the same path as `close()`:
   release every child (control → `terminal.release`; observe → SIGTERM, SIGKILL after 1 s), remove the lock, exit.
   A second signal during shutdown → SIGKILL all children immediately and exit.
2. **Tagging:** every herdr child's env carries `CLAUDE_HQ_INSTANCE=<instanceId>` and `CLAUDE_HQ_SESSION=<session>`;
   pids are recorded in `~/.config/claude-hq/<session>/children.json` (`{instanceId, pids:[{pid, mode, paneId,
   startedAt}]}`, rewritten on every spawn/exit).
3. **Startup scan:** before the first spawn, scan `/proc/*/environ` (own uid only; unreadable entries skipped) for
   processes whose `CLAUDE_HQ_INSTANCE` is set and ≠ the live instance, and whose `cmdline` starts with the herdr binary
   (never touch anything else) → SIGTERM, wait 1 s, SIGKILL survivors, log a count. `children.json` of a dead instance
   is a fast path only; `/proc` is the truth. Linux only (the backend runs on the herdr box).
4. **Tests:** mock-herdr `reaper.test.js` spawns the backend as a child process, opens 3 observe + 1 control terminal
   via WS, `kill -9`s the backend, asserts the fake children are still alive (the bug), restarts the backend, and
   asserts zero processes with the stale tag within 2 s. `integrity.mjs` asserts at the end of every run that `/proc`
   contains no process tagged with a `CLAUDE_HQ_INSTANCE` other than a currently live lock's.

### 4.8 Actions & safety gate (`server/world/actions.js`)
| Class | Messages | Default session | Named session / demo |
|---|---|---|---|
| always | `term.*` (incl. paste; `term.resize`/`term.scroll` writer-only, §3.4), `screen.watch`, `settings.set`, `world.get`, `done.ack`, `agent.explain` | ✓ (all user-initiated or HQ-local) | ✓ |
| explicit | `herdr.focus` | ✓ (button only) | ✓ |
| interact | `agent.prompt`, `agent.answer`, `agent.keys` | ✓ (the UI confirms prompts and answers) | ✓ |
| structural | `spawn`, `pane.close` | only with `allowMutations` (flag or setting, off by default) | ✓ |

- Every id must name a known entity. Size caps: `term.input` ≤ 16 KB per message (client chunks, §8.6; hub awaits child
  stdin `drain` before replying), other text ≤ 8 KB, keys ≤ 16 × 16 chars.
- **`agent.answer {id, key, promptHash}`** (Serve card, Blocked Inbox, status card, quick-answer hotkeys all use this):
  1. Synchronously re-read `pane.read {source:'detection'}` and re-parse. If the entity is not blocked, or the recomputed
     hash ≠ `promptHash`, or `key` is not an option → reply `{ok:false, error:'prompt_changed', prompt}`; the UI shows the
     new prompt and asks again. Nothing is sent to the pane.
  2. If `numbered`, send the digit key. Otherwise send `Down`/`Up` × (target − `selected`) computed from the **current**
     `❯` line, then `Enter`.
  3. Re-check every 200 ms for up to 2 s (a menu answer that exits the agent can take ~1 s to show): status, stateSeq or kind changed, pane gone, or prompt text/cursor changed → ok. Only the identical prompt with an unmoved cursor at the deadline → `{ok:false, error:'not_accepted'}`.
- **Quick-answer** (`Alt+1–9` aimed at a blocked agent outside Serve/Inbox; plain `1–9` always means pinned terminals,
  §8.2) never sends directly: it opens the one-line Serve confirm ("Send ‘2. Yes’ to tinker? [Enter] send [Esc] back")
  and only `Enter` sends, with the same hash check. Off by default in the default session (`quickAnswer`). Answering
  inside the Serve card / Blocked Inbox never depends on that setting.
- In demo mode, `source.request` applies calls to the simulation (§4.0).
- **Two gates, not one:** `actions.js` gates by message class; `herdr/client.js` independently enforces the method
  allowlist (§4.1). A bug in either alone cannot mutate the default session. In read-only mode (§4.1) every class except
  `always` read paths is refused with `readonly_protocol`.
- **Audit log (`audit.js`, M3):** every promote, takeover, answer, prompt, keys, focus, resize, spawn and close appends
  `{at, session, cid, action, paneId, ok, error?}` to `~/.config/claude-hq/<session>/audit.ndjson` (0600, rotated at
  1 MB). **Never bytes, prompt text or answers.** The drawer's "Recent HQ actions" panel reads it (§8.5).

### 4.9 Demo mode (`server/demo/`)
Without `--demo` the renderer cannot tell it apart from real herdr: same messages, same Entity shapes, same code path
from `HerdrSource` onwards (§4.0).

- **`DemoWorld(N=12, seed)`:**
  - ⌈N/4⌉ workspaces with realistic labels, 1–3 tabs each, and about 20% shells.
  - Agent kinds: 1 codex per 10 agents, the rest claude.
  - IDs look like `d<ws>:p<n>`. They are rejected by herdr and are never sent to it, since no herdr client exists in demo mode.
  - `hello.session` is `'demo'` unless `--session` was given explicitly (D8); the renderer banner reads "DEMO", never
    "default", so nobody mistakes demo for their real session.
- **Per-agent schedule (seeded).** Working turns are **phase-structured** like real Claude sessions, so station logic is
  exercised honestly:

  | State | Duration / behaviour |
  |---|---|
  | working | 20–300 s made of phases: explore (read/search 20–90 s), plan (think/todo 10–30 s), edit (edit/write 20–120 s), verify (test/build 20–90 s), occasional web (20–60 s), task (60–240 s), git (5–15 s). Within a phase 70% of tools are the phase's class, the rest short interjections |
  | blocked | ≈10% of turn ends, with a realistic prompt and options; auto-resolves after 30–90 s, or immediately on `agent.answer` |
  | done | Until `pane.focus` (demo `request`) or 60–300 s ("user looked in herdr") |
  | idle | Can run for hours in `longIdle` |
  | unknown | Rare |

  Demo agents also grow `contextTokens`, spawn subagents during `task`, keep todos, fire `test-pass`/`test-fail`/`commit`/
  `error`, and occasionally arrive or leave. Shells cycle through the process activities.
- **Scenarios** (`--scenario` or `demo.scenario`):

  | Scenario | Contents |
  |---|---|
  | `mixed` | The default. Used for the ≤ 20% walking acceptance (§6.5) |
  | `allStates` | 1 agent per status + 1 per ToolClass + 1 shell per ShellActivity, frozen (no schedule) |
  | `crowd40` | 40 agents across 8 workspaces |
  | `trio` | 3 agents + 1 shell at `prompt`, 1 workspace |
  | `longIdle` | 4 agents + 2 shells at `prompt`, 2 workspaces, idle for 0 / 25 min / 2 h / 7 h (dust ladder, §6.4.1; seeded through `since.json`, not `approx`); runs under `--timescale` / the fake clock (§4.13) |
  | `queue` | 4 blocked agents with different prompt shapes (numbered, ❯-bulleted, folder trust, free text) for Serve tests |
  | `churn` | Panes appear/vanish every 1–2 s, herdr offline flaps every 20 s, restart with re-keyed ids, workspace renames that change `colorIndex` |
  | `empty` | No agents |
  | `offline` | herdr disconnected |

- **`fakeTerm.js`** (the demo `TerminalBackend`): real ANSI frames (a mock Claude Code TUI for agents, a bash prompt for
  shells); echoes input, understands `ls`, `help`, `clear`, and a `seq N` that produces scrollback for scroll tests.
- **Clock:** DemoWorld schedules, fakeTerm, replay and every grace timer run on `ctx.clock` (§4.13), so `--timescale 10`
  compresses a whole scenario, and tests drive it with a `FakeClock`.
- **Record / replay (`record.js`):** `--record f.ndjson` appends every HerdrSource `snapshot`/`status`, every enricher
  patch **and every `emitEvent`** with timestamps; `--replay f.ndjson --speed K` is a `HerdrSource` + a replay enricher
  that re-emits the recorded patches and events through the same `onPatch`/`emitEvent` seams. Recordings may contain
  prompts/paths: they stay local and are git-ignored, **except** one scrubbed golden fixture (M2, BE2):
  `server/test/fixtures/hqtest-10min.ndjson` (paths → `/p/<n>`, prompt/title/detail text → hashes) plus
  `…golden.ndjson` = the WorldModel output stream. `npm test` replays it at `--speed 20` and diffs the emitted
  `entity`/`gone`/`event` stream (volatile fields removed); a deliberate change regenerates the golden file with the
  reason in the commit.

### 4.10 Stats sampler (`server/stats/`)
- Sources (all verified in platform §6):
  - `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/pressure/*`, cpufreq, `/proc/diskstats`, `/proc/net/dev`
    (skipping `lo`, `docker*`, `br-*`, `veth*`).
  - `fs.statfsSync` on `/` and other real mounts from `/proc/mounts` (ext4, xfs, btrfs, vfat on `/boot*`). **Never `df`**.
  - amdgpu `gpu_busy_percent`, `mem_info_*`, and hwmon found **by `name`** (amdgpu, k10temp, nvme, mt7921_phy0).
- A missing source produces `null`, never a crash.
- Sampling rates:

  | Rate | Sources |
  |---|---|
  | 1 Hz | Everything by default |
  | 30 s | statfs |
  | 3 s | Per-process scan (M4 `res`) |

### 4.11 HTTP / WS security (`server/http.js`, `ws.js`)
- Bind `127.0.0.1` only.
- **Host check:** hostname ∈ {127.0.0.1, localhost, [::1]}; the port is ignored.
- **WS Origin check:** required, and must be loopback.
- **Token:** 32 random bytes in `~/.config/claude-hq/token` (0600), created on first run.
  - `GET /?t=TOKEN` sets an `hq_token` HttpOnly SameSite=Strict cookie, then redirects to strip the token.
  - The WS upgrade accepts the cookie, or a `?t=` query. The dev proxy path uses the query: the renderer removes `t` from
    the location and keeps it in memory plus sessionStorage.
- **CSP:** `default-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; img-src 'self' data: blob:;
  style-src 'self' 'unsafe-inline'; worker-src 'self' blob:`. This also enforces "no external assets".
- `--dev` only relaxes the static serving (vite serves the renderer). Auth is never disabled.
- The WS URL carries `cid` (random per renderer tab, kept in sessionStorage) for the terminal grace resume (§4.7).
- **Wire validation (`VALIDATE` in `shared/protocol.js`, enforced in `ws.js` before routing).** One row per renderer→server
  `t`: required fields + types, numeric ranges and size caps, e.g.

  | `t` | Fields (type, cap) |
  |---|---|
  | `term.open` | `id` paneId (≤ 64 chars, known entity), `cols` int 10–500, `rows` int 4–200, `mode?` ∈ {observe} |
  | `term.input` | `id`, `text` string ≤ 16 KB **or** binary ≤ 16 KB + header |
  | `term.fit` / `term.resize` | `id`, `cols` int 10–500, `rows` int 4–200 |
  | `term.history` | `id`, `lines` int 1–5000 |
  | `screen.watch` | `ids` array ≤ 6 of paneId |
  | `agent.prompt` | `id`, `text` ≤ 8 KB |
  | `agent.answer` | `id`, `key` ≤ 4 chars, `promptHash` hex ≤ 16 |
  | `agent.keys` | `id`, `keys` ≤ 16 × ≤ 16 chars |
  | `settings.set` | `patch` object ≤ 4 KB, keys ∈ `SETTINGS_KEYS` |
  | `spawn` | `workspaceId?`, `cwd?` ≤ 1 KB absolute path, `kind?` ∈ {claude, codex}, `label?`/`name?` ≤ 64 |

  Unknown `t`, missing/extra-typed fields → reply `{ok:false, error:'bad_message'}` (nothing executed). Any text frame
  > 64 KB, or > 20 invalid messages in 10 s from one client, closes that socket with 1008. `ws.test.js` has one
  reject case per row.
- **Protocol skew.** The renderer compares `hello.protocol` with its bundled `PROTOCOL_VERSION` **before handling any
  other message**. Mismatch (a stale cached renderer after an upgrade) → banner "Claude HQ was updated — reloading",
  close the WS, `location.reload()` once (guarded by a sessionStorage key holding both versions). Still mismatched after
  the reload → persistent banner, no WS traffic. `http.js` serves `index.html` with `Cache-Control: no-store` and hashed
  assets as immutable, so the reload fixes it. The server additionally rejects renderer messages whose `hello` ack
  (`{t:'hello.ack', protocol}`) is missing or different.
- **`/debug/metrics`** (`--metrics`/`--dev` only, token auth, JSON): herdr children by mode, subscription connections,
  enricher pollers/watchers per enricher, WS clients with `bufferedAmount` and viewer counts, mirrors, transcript tails.
  The `churn` 10-minute leak test asserts these return to baseline (± 0) after the scenario quiesces.

### 4.12 Single instance (`server/instance.js`)
- Lock file `~/.config/claude-hq/<session>.lock` (0600): `{pid, port, instanceId, startedAt}`, written after `listen`
  succeeds, removed on clean exit.
- **Startup:** if the lock exists, the pid is alive, and `GET http://127.0.0.1:<port>/healthz` returns the same
  `{instanceId, session}` → a live backend already owns this session:
  - `server/main.js` prints the existing URL and exits 0 (`--new-instance` refuses instead of attaching, for tests with
    `--port 0` and a temp config dir).
  - `electron/main.js` does not call `createApp`; it opens a window on the existing URL (token read from the token file).
  - Otherwise the lock is stale: replace it.
- EADDRINUSE on the configured port with no valid lock → fail with a clear message (another program owns the port);
  never silently pick another port for the default session.
- Two renderers on one backend share terminal children (§4.7 writer rules). Two backends can only coexist for
  *different* sessions.
- The lock's `instanceId` is the same id used to tag children (§4.7.1); a stale lock triggers the orphan scan.

### 4.13 Clock (`server/clock.js`)
- `clock = {now(), setTimeout, clearTimeout, setInterval, clearInterval, scale}`. **Every** server timer and timestamp
  goes through it: DemoWorld schedules, HerdrLive reconcile/grace (15 s), WS grace (10 s), TerminalHub idle demotion
  and paused-viewer drop (60 s), slot free (5 min), since/timeline stamps, enricher pollers. Lint rule (`npm test`
  greps `server/**/*.js` except `clock.js`): no bare `Date.now()`, `setTimeout`, `setInterval`.
- `RealClock(scale=1)`; `--timescale K` (demo/replay only, §2.2) gives `now = t0 + K·(wall − t0)` and timers ÷ K.
  `FakeClock` (tests): `advance(ms)` fires due timers in order; the churn/longIdle leak tests and the golden replay run
  under it deterministically, with no wall-time sleeps (a 10-min churn run takes < 10 s).
- The renderer receives `hello.timescale` and uses it for its own animation/brain clock unless `?timescale` overrides
  (so server durations and client ladders agree).

---

## 5. Render pipeline (RND)

### 5.0 Radiometric & tone-mapping contract (normative; overrides ART §3.1, §3.2, §4 numbers)
Goal: the brand clay renders as brand clay, the environment never blooms, and one `__hq` probe proves it.

- **Two keys, split by job.**
  - **Studio key** (`lights.js`, one `DirectionalLight`): the only light that shades characters and props and the only
    shadow caster. **Fixed direction, never follows the clock:** elevation 60°, from plan azimuth 200° (from the south,
    slightly west, i.e. behind the spawn camera), so faces seen from the main poses are lit and cast shadows are short
    (≈ 0.58 × height) and fall away from the viewer. Colour `#FFE9D2` (normalised). Shadow map `CASTERS` only.
  - **Sun** (real clock, `?hour=`): reaches the scene **only** through the window gobo (§5.6), the sky shader, the
    exterior cards and the zone grade. It never drives `N·L` on characters and never casts shadow maps. So no raking
    golden-hour shadows cross windowless rooms (ENG, ARC, bays) and point at nothing.
- **Units.** Our toon lighting is **normalised**: the ramp replaces three's `RE_Direct` diffuse term and does **not** apply
  three's `1/π` Lambert factor. Light "intensities" below are gains on albedo, not physical units.
  ```
  t, t2   = ART §3.2 banded N·L_studio terms (uBand0 .42, uBand1 .72)
  rampT   = (t*0.7 + t2*0.3) * mix(1.0, keyVis, 0.85)        // shadow FEEDS the ramp (ART §3.2): shadow = shadow band
  keyTerm = kKey * keyCol * mix(uShadowTint, vec3(1), rampT)  // keyVis is NOT multiplied outside the ramp
  ambTerm = kAmb * hemi(N)                                    // hemi(N) = mix(ground, sky, N.y*.5+.5) * mix(.55, 1, N.y*.5+.5); ≤ 1
  sunTerm = kSun * gobo * sunCol * max(N·L_sun, 0)            // toonEnv only (§5.6); 0 for chars/props
  out     = albedo * (keyTerm + ambTerm + sunTerm + lampPool + Σ pointTerms) + rim + sheen   // chars add rim/sheen
  ```
  - A fully shadowed pixel keeps `kKey·keyCol·mix(tint,1,0.15·ramp)`: violet-shifted, never "ambient only" grey.
  - `uShadowTint` is an **independent constant** (not blended with albedo), so albedo enters exactly once. Default
    `#AAA5DC` (linear ≈ .40/.38/.72): shadowed clay goes toward violet-red, not muddy.
  - `keyVis` = the shadow-map factor (PCF) for every lit program, env included (env *receives* caster shadows). There
    is no `uIndoorKey` any more: the studio key is at full strength indoors.
  - `keyCol`, `sunCol`, `sky`, `ground`, lamp colours are normalised to max channel = 1; brightness lives only in gains.
- **Gains** (`lights.js`). Characters/props and environment have **separate** gain sets, because only env takes sun and
  the character set is pinned by `clayCheck`. Invariant: the per-pixel gain sum ≤ **1.0** for chars/props and ≤ **1.14**
  for env (env albedo cap 0.80 → lit env ≤ 0.91 < bloom threshold 1.0):

  | | chars/props kKey / kAmb / points | env kKey / kAmb / kSun (gobo only) / lamp pools |
  |---|---|---|
  | Day (8–17 h) | 0.62 / 0.38 / 0 | 0.48 / 0.46 / 0.20 / 0 |
  | Golden (6–8, 17–19 h) | 0.62 / 0.36 / 0 | 0.48 / 0.44 / 0.22 (`sunCol #FFC58F`) / 0 |
  | Night | 0.55 / 0.33 / ≤ 0.12 | 0.44 / 0.40 / 0 / ≤ 0.30 summed (clamped to the invariant) |

  Night keeps the studio key because the office's own ceiling lights are "on"; night reads through the windows, sky,
  zone grade and lamp pools (§5.6), never through an underexposed interior. Tuning (below) may change **env** gains
  only; character gains change only with an art review of `clayCheck`.
- **Albedo cap.** Every lit environment token has linear luminance Y ≤ 0.80 (L\* ≤ 91). `paper` (#FBF8F3) is for unlit
  UI/bubbles only; whiteboards use `oat`-light `#EDE6DA`. **`cream` (#F4EDE3, L\* 94) is UI-only too (D1)**: wherever
  this doc or ART says "cream" on a lit 3D surface, walls and large surfaces use `wallCream` `#DBD0C3` (L\* 84, the value
  map's "82 cream") and small props / piping / key caps / trim use `trim` `#EFE6D6`. `palette.test.js` enforces the cap.
- **Rendered luminance targets** (post-tonemap sRGB L\*, day hour 13, at `spawn`, `street`, `pitOverview`; measured by
  `__hq.surfaceStats()` on the per-pose probe pixels in `poses.js`, 5×5 medians). The value map (§5.5) is albedo; this
  table is what the eye sees:

  | Surface | Rendered L\* | Notes |
  |---|---|---|
  | Walls, lit side (cream/oat, albedo 74–84) | 65–78 | walls facing away from the key: ≥ 60 |
  | Floors (albedo 40–52) | 40–50 | gobo sun patches ≤ 62 |
  | Ceilings (bright zones) | 55–70 | STR/MEZ/ENG are dark by design: 28–45 |
  | Clawd lit clay | 58–62 | = `clayCheck` (ΔE < 6 vs `#D97757`) |
  | Clawd shadow band / in a desk's cast shadow | ≈ `#A1544B` (L\* ≈ 44), ΔE < 8 | `clayCheck().castShadow` |
  | Ink hull, status emissives | unchanged | |
  | STR painted brick (albedo 62; token L\* 66) | 55–65 | cool, below the cream walls by design |

  If walls miss low, raise env `kAmb` first, then env `kKey` (never character gains).
- **Golden (hour 18) and night (hour 22) targets** (same probes and method; lamps per §5.6 schedule). These run in
  `npm run review` **from M1** in the proto room (pose `proto`, which carries its own probe pixels and a desk lamp +
  floor lamp), and at `spawn`/`street`/`pitOverview`/`cafe` from M2. Missing them fails the review like the day row:

  | Surface / metric | Day 13 h | Golden 18 h | Night 22 h |
  |---|---|---|---|
  | Walls, lit side | 65–78 | 60–74 | 52–68 |
  | Floors (outside lamp pools / gobo) | 40–50 | 38–50 (gobo ≤ 66) | 32–46 |
  | Floor inside a lamp pool (pool centre) | ≤ +4 over its floor | ≤ +8 | +6…+14 over the same floor outside (pools read, never flatten) |
  | Walls − floors (value hierarchy) | ≥ 15 | ≥ 14 | ≥ 12 |
  | Clay lit, ΔE00 vs `#D97757` | < 6 | < 8 | < 8 |
  | Clay shadow band, ΔE00 vs `#A1544B` | < 8 | < 10 | < 10 |
  | `lumaStats` (emissive off) p99 / p50 / p10 | ≤ .85 / ≥ .20 / ≥ .04 | ≤ .85 / ≥ .18 / ≥ .04 | ≤ .88 / ≥ .14 / ≥ .03 |
  | `bloomFrac` (normal frame, lamps on) | ≤ 1.0% | ≤ 1.2% | ≤ 1.5% (bulbs 1.8 + screens) |

  If night floors flatten into the pools, lower the summed pool gain (≤ 0.30 is a cap, not a target) before touching
  env `kAmb`.
- **Tone mapping: `ToneMappingEffect(NEUTRAL)`** (Khronos PBR Neutral), exposure 1.0. It is the identity below ≈ 0.76
  linear, so clay (max channel 0.69 linear) passes through unchanged. **AgX and ACES are banned** for the main grade (AgX
  greys the clay, ACES pushes it yellow).
- **LUT fixed points.** The JS-generated LUTs (day/golden/night) keep `clay`, `clayDeep`, `cream`, `ink` and every status
  colour within ΔE2000 < 3 of identity in the **day** LUT; golden/night may shift the environment but clamp character
  swatches to ΔE < 8. `lut.test.js` checks this on the LUT data (pure JS).
- **Emissive policy.** Only emissive materials exceed 1.0, and only small features do:

  | Source | Level | Rule |
  |---|---|---|
  | Screen background + body text (monitors, Big Board text, Shelly face base) | **≤ 0.95** | never blooms; text stays legible |
  | Screen accents: cursor, status bar/pill, error flash (≤ 0.6 s) | 1.2–1.6 | ≤ 12% of a screen's area |
  | Blocked beacon / "!" bubble | 2.5 | the only strong bloom |
  | Lamps (bulbs only, not shades) | 1.8 | |
  | Shelly phosphor glyphs | 1.4 | glyph strokes only |
  | Confetti | 1.2 | |

  Budget: `__hq.lumaStats().bloomFrac` (fraction of pixels with pre-tonemap luminance > 1.0) **≤ 1.0%** at `spawn` and
  `eBayGlass` in `mixed`, ≤ 2.5% anywhere. `screen.js` scales accent gain down as more monitors are on screen
  (`gain = 1 + 0.5 / max(1, visibleScreens/4)`). Unknown's fresnel glow and workspace colours are never emissive.
- **Verification (`src/debug/probe.js`, RND, exposed on `__hq`):**
  - `__hq.probe(x, y)` → `{pre:[r,g,b,a], post:[r,g,b]}`: the composer input buffer (linear, pre-tonemap) and the final
    sRGB pixel, via `readRenderTargetPixelsAsync`.
  - `__hq.lumaStats({emissive:false})` renders one frame with emissive gains at 0 (probe.js owns that override) and
    returns `{max, p99, p50, p10, bloomFrac}` of pre-tonemap luminance (`bloomFrac` from a normal frame). **Pass:
    `p99 ≤ 0.85`, `max ≤ 0.95`, `p50 ≥ 0.20`, `p10 ≥ 0.04`** at `spawn`, `pitOverview`, `street`, `cafe`, hour 13.
    (p50 0.20 ≈ L\* 52: a first-person frame is ~40% floor at L\* 45, so 0.25 would force floors above their target.)
  - `__hq.surfaceStats()` → rendered L\* at the current pose's probe pixels, compared with the table above.
  - `__hq.clayCheck()` focuses the hero pose (`sheet=hero`, day) and returns `{lit, shadow, castShadow}`, each with ΔE2000:
    `lit` = lit band of the body (centre-top 20% of the front face, 5×5 median) vs `#D97757`, **< 6**; `shadow` = the
    self-shadow band vs `#A1544B`, **< 8**; `castShadow` = a Clawd standing fully inside a desk's cast shadow on the sheet
    (the sheet includes one desk) vs `#A1544B`, **< 8**.
  - `clayCheck().codex` (slate body, §5.5; the sheet has a codex beside the desk): rendered **lit L\* ≥ 30**, **self-shadow
    band L\* ≥ 20**, **in the desk's cast shadow L\* ≥ 20**, eye paper vs body **ΔL\* ≥ 40**, glint present, and body vs
    its hull ΔE00 ≥ 15 (the `rim × 1.5` + `#141210` hull). The same row runs at night (hour 22).
  - These run in `npm run review` and fail the review script on a miss.

> **LEAD ratification (M3): golden/night targets.** Night reads through a dimmed interior (lightMath EXPOSURE_KEYS: env exposure 0.46 at night, 0.74 at 18 h) lit by lamp pools; characters take a softened exposure 1 − 0.37·(1 − env) (≈ 0.80 at night). This supersedes the night/golden rows above and "never an underexposed interior". Rows (golden / night): walls lit 54–72 / 34–52; walls shade 44–72 / 28–52; floors 34–50 / 20–34; ceilings 42–66 / 24–42; dark ceilings 24–42 / 12–34; walls − floors ≥ 14 / ≥ 6; pool delta ≤ +8 / +8…+36; lumaStats p50 ≥ .12 / ≥ .07, p10 ≥ .035 / ≥ .015. probe.js SURFACE_TARGETS/LUMA_TARGETS are normative.

### 5.1 Pipeline
- **Renderer:** `WebGLRenderer({antialias:false, stencil:false, alpha:false, powerPreference:'high-performance'})`,
  `outputColorSpace = SRGB`, `toneMapping = NoToneMapping` (the composer tone-maps), DPR clamped to 1 (1.5 on High).
  Camera: **vertical FOV 60°** (setting 55–75), near 0.05, far 400.
- **Composer:** pmndrs `EffectComposer({frameBufferType: HalfFloatType})`. **Pass order (normative):**
  ```
  [depth prepass: architecture, layer PREPASS, 'hq:prepass' depth-only]   // m2: early-z for the fill-bound world pass
  RenderPass(env + props, layers ENV|PROPS)          // opaque world only
  → N8AOPostPass (Med+)                               // AO never sees characters
  → CharPass(layers CHARS|HULLS, then transparent overlays; depth-tested against the scene depth texture)
  → EffectPass(Edge*, Bloom, ToneMapping(NEUTRAL), LUT3D)
  → EffectPass(SMAA)            // Low: FXAA here instead
  → EffectPass(Vignette, Noise*, CA*)
  ```
  AA runs on the tone-mapped image **before** grain/vignette/CA, so SMAA never sees grain or CA fringes.
  - **Architecture depth prepass** (RND m2 r1; ratified by LEAD m2 fix r2): walls, floors and ceilings (`LAYERS.PREPASS`)
    are drawn depth-only first with the shadow map's plain depth program (BackSide + inverted winding: **no new program**)
    and a polygon offset, so the colour pass passes LEQUAL and hidden toon fragments are early-z rejected. Its draws
    count as `drawCalls.prepass` (§5.3), not `main`. `composer.passes[0].prepass = false` turns it off.
  - **N8AO at toy scale** (a Clawd is 0.88 m): `halfRes, aoRadius 0.32 (range 0.25–0.4), distanceFalloff 1.0 (relative
    to the radius, i.e. ≈ 0.3 m), intensity 1.5 (≤ 2), aoSamples 12 (Med) / 16 (High), color #3A2A30`. Contact
    grounding for characters is the blob decal, not AO.
  - **Characters never receive or cause AO** because they are drawn after N8AO. `CharPass` (RND, ≈ 40 lines) renders
    into the composer's current input buffer with `autoClear=false`, attaching the **scene depth texture** that
    `RenderPass` wrote (`composer` created with `depthBuffer:true`; the depth texture is shared via `setDepthTexture`),
    so characters are occluded by desks and walls exactly as before. Fallback if the depth texture cannot be shared on
    ANGLE/Vulkan: the v2 alpha-0 mask, with N8AO composited as `mix(color, color·ao, alpha)` in a one-line Effect
    (N8AO `renderMode` AO-only into its own target). M1 check: `__hq.probe` on a Clawd face 0.3 m from a monitor
    returns the same `pre` (±1%) with N8AO on and off.
  - The shadow map is rendered **once per frame** in `RenderPass` (the key's shadow camera has layers
    `CASTERS|CHARS`, so characters still cast onto the floor); `CharPass` sets `renderer.shadowMap.needsUpdate = false`
    for its render and reuses it (characters still receive shadows).
  - Bloom: `mipmapBlur, luminanceThreshold 1.0, smoothing 0.2, intensity 0.8`.
  - Noise: overlay 0.035, re-seeded at 24 Hz; CA: 0.0006 edges only (High, plus error/drawer juice spikes).
- **Character mask & outlines (no double lines):**
  - Characters and hulls write **alpha 0** into the RGBA half-float scene buffer; everything else writes alpha 1.
    Transparent overlays use `blendSrcAlpha = Zero, blendDstAlpha = One` so they never change the mask.
  - **Hulls** (inverted hull, ART §4.1): `depthWrite:false`, `depthTest:true`, drawn after all character parts in
    `CharPass`, never in `CASTERS`. The Edge pass never sees them as depth: no Sobel line on the hull.
  - **Hull width is distance-scaled in screen space:** the hull vertex shader extrudes along the clip-space normal by
    `px = clamp(mix(3.2, 1.2, (d − 1.5)/16.5), 1.2, 3.2)` pixels (d = view distance in m), times the state multiplier
    (§5.6). Chunky and toy-like at 1.5 m; distant agents are never heavy black specks.
  - **Edge** (custom Effect, environment only): skips any pixel whose 3×3 neighbourhood contains alpha 0. Result: hull
    lines on characters only, edge lines on the environment only. **Not a depth Sobel** (at 1.2 m eye height a depth
    Sobel draws false lines and bands on floors, ramps and the Pit steps at grazing angles, and swims as you walk):
    - **Planarity test.** Let `w = 1/z_view` (reciprocal linear depth, which is *affine in screen space across any
      plane*). For each of 4 directions (h, v, 2 diagonals): `e_i = |w(−1) + w(+1) − 2·w(0)| / w(0)`, i.e. the
      neighbour vs the depth predicted from the opposite neighbour. `e = max e_i`; line if `e > τ` (τ = 0.012, tuned in
      M1; a relative threshold, so it scales with depth). Flat floors, ramps and walls give `e ≈ 0` at any angle;
      creases (step nosings, wall/floor seams) and silhouettes spike. Depth comes from the shared scene depth texture
      (§5.1 CharPass), never the half-float colour alpha.
    - **Fades:** `× smoothstep(30, 18, z)` (distance, m) and `× smoothstep(0.08, 0.22, |n·v|)` with `n` reconstructed
      from `w` derivatives, so residual grazing-angle precision noise never draws. Line colour ink at 55%, 1 px (1.5 px
      on High).
    - **Medium** = planarity test only; **High** = planarity + a normal-angle term (reconstructed normals, never a
      `NormalPass`, which re-renders the scene).
    - **Acceptance (review, M1 in the proto room, M2 at `street` and `pitOverview`):** each pose's `floorCrop` rect (in
      `poses.js`) has edge coverage ≤ 0.2% of pixels; Pit treads show only nosing lines, no banding; `--edge-swim`
      renders two frames 5 cm apart and the floor-crop edge-mask XOR is ≤ 0.1%.
- **Ghosting:** `alphaHash` and any temporally varying dither are banned (no TAA to resolve them). `unknown` agents stay
  **opaque**: `uDesat 0.6`, a violet fresnel edge (non-emissive, ≤ 0.8), slower blinks and a slow 0.25 Hz bob.
  Arrive/leave dissolves (0.4 s) use a **fixed screen-space 4×4 Bayer** threshold ramp (stable per pixel).
- **Materials:** see §5.4 for the factory and the allowed program matrix.
  - Every lit material patches `MeshLambertMaterial` via `onBeforeCompile` (ramp per §5.0, rim, clay sheen).
  - Procedural patterns (planks, terrazzo, tile, carpet, brick, cobble, wainscot) live in `patterns.glsl.js`, selected by
    `uPattern`.
  - **Vertex displacement** (foliage sway, character wobble, Shelly screen bulge) must ship a matching
    `customDepthMaterial` (and `customDistanceMaterial` if a point light ever casts) patched with the same chunk, or the
    mesh is excluded from `CASTERS`.
- **Lights:**
  - Always: a hemisphere light plus the fixed **studio key** directional light (§5.0). The sun is not a three.js light;
    it is uniforms (`uSunDir`, `uSunCol`, `kSun`) consumed by the gobo, sky and zone grade.
  - Shadow map from the studio key, following the player on a texel-snapped 24 m ortho box, `CASTERS` only.
  - **Lamp pools** (all tiers, `lamps.js`, §5.6) light every lamp's surroundings inside the existing toon programs.
  - Point lights: **≤ 2** pooled, reserved for sources that must visibly light characters near the player (the red
    blocked desk lamp, the Help Desk beacon). Reassigned at most every 0.5 s with a **≥ 0.4 s cross-fade** (old fades
    out while new fades in; the pool keeps a third hidden slot for the overlap). Unused ones sit at intensity 0 (no
    recompiles).
  - Time of day follows the real clock. Override with `?hour=`.
- **Shadows:** a blob decal under every character on every tier (instanced, 1 draw) keeps them grounded.
- **Text:**
  - Canvas2D with system font stacks (ART §3.4) for body text (ticket questions, monitor lines). Await `document.fonts.ready`.
  - **In-world display lettering (M3, `text/glyphs.js`):** a procedural capsule-stroke face (Hershey-like polyline
    table for A–Z, 0–9 and ~20 symbols, round caps, stroke = 0.16 em, weight-800 feel) rasterised into the signage atlas.
    Zone signs, storefronts, the Big Board headings, tickets' headers and plaques share one clay-lettering look that is
    identical on every host (no DejaVu/Ubuntu drift) and asset-free.
  - Static signage goes in one 2048² atlas. Stats readouts use the shader dot-matrix (`dotmatrix.js`).
  - **troika-three-text is banned** because it downloads a font from a CDN.
- **WebGL context loss (`contextLoss.js`):** on `webglcontextlost` (preventDefault) pause the loop and show a "Graphics
  reset, restoring…" banner (never a dead frame). On `webglcontextrestored`: rebuild composer targets, the LUT
  `Data3DTexture`, canvas textures (`needsUpdate`), portraits RT and the shadow map; resume. `__hq.loseContext()` drives
  it via `WEBGL_lose_context` in tests. xterm's webgl addon: `onContextLoss` → dispose it and fall back to the DOM renderer.

### 5.2 Quality tiers (`quality.js`)
| Tier | Scale | Shadows | AO | Bloom | Env edge | Hull | Gobo | Extras |
|---|---|---|---|---|---|---|---|---|
| low | 0.75 | off (blob only) | off (baked vertex AO) | light, 3 mips | off | ≤ 10 m | off | FXAA |
| **medium** (default) | 1.0 | 1024², chars + `CASTERS` props (≤ 10 prop depth draws) | N8AO half, Low | on | planarity (§5.1) | ≤ 18 m | on (≤ 4 windows) | SMAA, grain |
| high | 1.0 (DPR ≤ 1.5) | 2048², same caster set | N8AO half, Medium | on | planarity + reconstructed normals | all | on (≤ 8) | CA, god rays, dust, clay micro-surface |
| photo | 1–2 | 4096², same caster set | full res | on | planarity + normals | all | on | DOF, tilt-shift, no HUD, "on twos" filter + line boil (§11.5) |

- **Shadow casters are the same set on every shadowed tier:** characters (`castShadow` part types, §6.2) + `CASTERS`
  props (chairs, plants, big props; one shared instanced depth material, §5.4). Architecture never casts. This is what
  the §5.3 shadow budget (≈ 12 char + ≈ 10 prop depth draws) assumes.

- **Auto-scaling:** keep an EMA of frame ms (timer query if available, otherwise rAF delta). With
  `EXT_disjoint_timer_query_webgl2`, per-pass GPU times (RenderPass, N8AO, CharPass, Edge+Bloom, SMAA) are sampled too
  (F3 budget bar vs §5.3, M3) and the scaler **sheds the most over-budget pass first** (N8AO Low → off, Edge off, bloom
  mips 3) before lowering the render scale.
  - Above 20 ms for 2 s: lower the render scale by 0.1, down to a floor of 0.6. Then drop a tier.
  - Below 12 ms for 5 s: step back up.
  - `?quality=` pins the tier and disables auto. The choice is saved in localStorage.
- **Throttling:**
  - Tab hidden: 10 fps with no post.
  - Terminal drawer open: ≤ 30 fps.
  - Drawer fullscreen: 10 fps.

### 5.3 Perf budget (1080p, 780M, medium, 12 agents unless stated)
| Item | Budget | Measured basis (platform §4) |
|---|---|---|
| Frame | ≤ 16.6 ms at vsync, ≤ 6 ms uncapped GPU | Full bench stack 3.2 ms |
| Draw calls (all passes) | ≤ 150 target, 250 hard cap at 40 agents. Split: main ≤ 110 (env merged per cell ≈ 45, props ≈ 20, chars ≈ 35, fx ≈ 10) + shadow pass ≤ 25 (char part types that cast ≈ 12 + prop depth ≈ 10) + portraits ≤ 1 × 35 on frames where main + shadow < 115, else deferred | Instancing makes character count nearly free; `__hq.stats().drawCalls = {main, shadow, portrait, portraits, post, prepass, total}` (`core/drawSplit.js`, attributed per render call: `main` = world colour draws, `shadow` = nested shadow-map draws, `portrait` = `userData.hqPortrait` scenes (`portraits` = legacy alias of `portrait`), `post` = postprocessing fullscreen passes, `prepass` = RND's depth-only architecture prepass (`overrideMaterial` `hq:prepass`, §5.1); `total` = all of them). Caps are checked on main/shadow/portrait and main + shadow + portrait ≤ 250 (`overBudget`); `post` and `prepass` are reported, not capped (post is ≈ fixed per tier, the prepass exists to cut main-pass fill) |
| Triangles visible | ≤ 500k main-pass with ≤ 12 agents; above 12: env ≤ 300k, chars ≤ 250k, stat ≤ 60k, total ≤ 610k (`__hq.stats().render.tris`; overBudget `triangles*`; perf.mjs fails on overrun) | 149k office costs 0.4 ms |
| Shader programs | Scene ≤ 12 target / 14 cap (matrix in §5.4); post ≤ 16. `__hq.stats().programs = {scene, post, total}` (a program is `scene` when first compiled in a world/portrait/shadow render, else `post`; `total` = `renderer.info.programs.length`) | `overBudget` keys `scenePrograms`, `postPrograms` |
| Portraits | ≤ 2 per frame, ≤ 1 ms total, only while the roster is open (§5.4) | |
| Readbacks | `readRenderTargetPixelsAsync` only; synchronous `readPixels` is banned outside tests | |
| JS per frame | ≤ 4 ms at 40 agents (anim + brain + nav) | 200 bench chars take 0.6 ms |
| Textures | ≤ 64 MB: ≤ 5 × 2048² atlases (signage, glyph faces, monitor, **task placards** §6.7, spare), 24 pooled bubble canvases, **one 2048² monitor atlas** (16 tiles of 512×512; dirty tiles uploaded via `copyTextureToTexture` from one 512² staging canvas, ≤ 2 tiles/frame) | One texture bind for all desk monitors |
| Live xterm instances | ≤ 2 WebGL addon contexts; the others dispose their addon | Chromium caps about 16 contexts per page |
| A* | ≤ 2 searches/frame (queued); cached per (bay, station) | |
| Frame errors | 0. `__hq.stats().frameErrors` = frames whose loop callback threw since boot (`core/loop.js` catches, counts and keeps running) | `review-shots` exits 2 and `perf.mjs` exits 7 on any row with `frameErrors > 0` |
| Per-row report | `perf.mjs` / `review.json` rows carry `{fps, drawCalls, triangles, programs, overBudget, frameErrors}` and flag `contended` (GPU busy before the run) / `noisy` | |

**Zone cells** (GP §6) have a hand-authored visibility table. Groups outside the camera cell's visible set are hidden.
Actors outside the set only integrate their position.

**Character LOD:**

| Distance | Update |
|---|---|
| < 12 m | Full |
| 12–25 m | 20 Hz, interpolated, no accessory springs |
| > 25 m or out of frustum | Locomotion only |

Beyond 14 m, face micro-parts (glints, lids, brows) are hidden; hull distance is per tier.

### 5.4 Renderer seams (RND ↔ CHR / ENV / STAT / FX / BRN)
All signatures live in JSDoc next to the implementation; these are the contracts other WPs code against.

```js
// src/render/materials/index.js (RND)
getMaterial(kind, opts?) → THREE.Material     // cached by (kind, flags); never construct lit materials elsewhere
//   kind ∈ 'toonChar'|'toonProp'|'toonEnv'|'foliage'|'hull'|'screen'|'glass'|'sky'|'blob'|'particle'|'sprite'|'dotmatrix'
//   opts: {instanced?, vertexColors?, pattern?:PatternId, color?, emissive?, uniforms?}  (pattern/color/emissive are uniforms)
//   customProgramCacheKey = kind + '|' + flags  where flags ⊂ {INSTANCED, VCOL, SWAY, WOBBLE}; anything else is a uniform

// src/chars/render/charBatch.js (CHR)
charBatch.register(rig, {kind, colorIndex, cycle}) → handle
handle.setVisible(bool) · handle.setLod(level) · handle.setOutline({color, width}) · handle.remove()
charBatch.write()   // once per frame, after animators

// src/fx/index.js (FX): all keyed by actorId, idempotent, cheap to call every frame
fx.bubble(actorId, spec|null)   // {kind:'speech'|'thought'|'alert', icon, title, detail, priority}
fx.ring(actorId, {status, pulse}|null) · fx.plate(actorId, {name, tab, colorIndex}|null)
fx.glyph(actorId, cls|null)     // distance-readable activity pictogram (§6.7)
fx.burst(kind, pos, opts)       // confetti, poof, smoke, sparkle, dust, capsule
fx.dust(actorId, level0to3)     // long-idle ladder (§6.4.1)
fx.placard(actorId, {text, muted, deskAnchor}|null)  // task placard board + storefront line (§6.7)

// src/world/build/index.js (ENV)
buildWorld(layout, ctx) → {cells: Map<cellId, Object3D>, anchors, update(ctx), dispose()}

// src/world/stats/registry.js (STAT)
registerStat(anchorId, factory)  // factory(ctx, anchor:{pos, yaw, size, cell}) → {object3d, update(stats, dt, ctx), tooltip() → {title, value, spark:number[], source}}
```
- **Actor → animation/fx wiring (BRN, `actors.js`):** per frame, `brain.update(entity, now) → Intent`; `motor` moves the
  root; on arrival `animator.setAction(intent.activity, …)`; then `fx.ring/plate/bubble/glyph/dust` from the Intent.
  Reactions from `event` messages go to `animator.react()` plus `fx.burst()`. No other module calls animator or fx for
  actors.
- **Allowed scene programs** (the whole matrix; adding one needs a DESIGN edit):

  | Kind | Variants | Depth variants |
  |---|---|---|
  | toonChar | INSTANCED+WOBBLE | 1 (customDepthMaterial) |
  | toonProp | INSTANCED(+VCOL) | 0 (props cast via the shared instanced depth material) |
  | toonEnv | VCOL | 0 (architecture never casts) |
  | foliage | VCOL+SWAY | 1 |
  | hull | INSTANCED | — |
  | screen, glass, sky, blob, particle, sprite, dotmatrix | 1 each | — |

  = 12 colour programs + 2 depth programs.
- **Portraits (`portraitBatch.js`):** a dedicated **count-1** InstancedMesh per part type (shares geometries and
  materials with charBatch, so no new programs) poses one actor at a time on a neutral backdrop into a 64² render target,
  then `readRenderTargetPixelsAsync` → `ImageData` → the row's `<canvas>`. Never render the shared charBatch for a
  portrait (whole-mesh culling would draw every instance). ≤ 2 per frame, round-robin over visible roster rows, ≤ 1 Hz
  each, only while the roster is open.

### 5.5 Colour & value contract (amends ART §2)
- **Channel separation.** Status colours are **bright** (L\* 58–83), are the only saturated emissives, and are the only
  colours used for floor rings, status chips, beacons and screen tints. Workspace colours are **deep, matte jewel tones**
  (L\* 27–55), never emissive, and appear only on accessories, nameplate pills, bay signs/banners/rugs, Shelly chest
  plates and stickers. **No workspace-coloured ring exists anywhere** (ART §5.4's floor ring is removed).
- **Workspace palette** (replaces ART §2.4; index = `colorIndex`):

  | # | Token | Hex | L\* | h° | Nearest status (ΔE00) |
  |---|---|---|---|---|---|
  | 0 | bronze | `#946A1C` | 48 | 79 | shell-busy 31 ΔL\* (lightness step) |
  | 1 | olive | `#6B7A2A` | 49 | 114 | done 26.5 |
  | 2 | pine | `#1E7A74` | 46 | 189 | done 27.6 |
  | 3 | indigo | `#4B4FA6` | 38 | 297 | unknown 26.9 (ΔL\* 26) |
  | 4 | plum | `#7E3F8C` | 38 | 322 | unknown 27.2 (ΔL\* 26) |
  | 5 | raspberry | `#A8385E` | 41 | 4 | blocked 24.3 (Δh 31°) |
  | 6 | forest | `#2F5A34` | 34 | 144 | done 37.5 (ΔL\* 38) |
  | 7 | **cocoa** (was charcoal `#4A4541`: ΔE 8.4 vs the codex body) | `#6B3F24` | 31 | 56 | blocked 30.3 |

- **Agent-kind bodies** (`palette.js` tokens `bodyClay`/`bodySlate`/`bodyRose`/`bodyPebble`; ART's UI `slate` and cushion
  `rose` tokens are different colours; replaces ART §5.2 table colours and v2's graphite/jade/pebble, which collided with dark jewel
  accessories: graphite↔charcoal ΔE 8.4, jade↔pine 7.3, graphite↔indigo 16.7):

  | Kind | Token | Hex | L\* | Nearest status | Nearest workspace |
  |---|---|---|---|---|---|
  | claude | clay | `#D97757` | 60 | (brand; exempt) | bronze 23.3 |
  | codex | **slate** (v4: lifted from `#34383D` L\* 23, which went near-black in shadow) | `#4D4B52` | 32 | unknown 37.0 | cocoa 20.6 (indigo 22.1, plum 21.7) |
  | gemini / other LLM | **rose** | `#C98FA0` | 65 | unknown 20.1 | raspberry 25.4 |
  | unknown agent kind | **pebble** | `#77736E` | 49 | idle 19.3 (ΔL\* 21) | bronze 20.8 |

  Codex keeps paper round eyes; slate is still the darkest body, so codex gets `rim × 1.5` and its hull colour is ink at
  60% value (`#141210`; slate vs hull ΔE00 19.1, was 12.6), and `clayCheck().codex` (§5.0) guards its lit/shadow
  values in dark zones (STR ceiling, MEZ, ENG).
- **Accessory trim (all workspaces).** Every accessory carries a **paper/cream trim** (`#EFE6D6`, non-emissive): beanie
  cuff + pompom, headphone band stripe, cone-hat band, propeller-cap button + brim edge, bucket-hat band, scarf end
  stripes, bow knot, antenna bobble ring. ≥ 12% of the accessory's projected area, so dark jewels (cocoa L\* 31,
  forest 34) keep their shape against the ink outline and the body. `cycle > 0` stripes are drawn in the trim colour.
- **The check (`shared/palette.test.js`, CIEDE2000 in `palette.js`):** every workspace colour vs every status colour and
  clay: ΔE00 ≥ 20 **and** (hue gap ≥ 25° **or** ΔL\* ≥ 20); workspace pairwise ΔE00 ≥ 14 (the accessory *type* carries the
  rest); non-clay kind bodies vs status ΔE00 ≥ 17 and (hue ≥ 25° or ΔL\* ≥ 20); **every workspace colour vs every kind
  body ΔE00 ≥ 20** (so no accessory vanishes on its wearer); trim vs every workspace colour ΔE00 ≥ 25. A failing pair
  is fixed by swapping the kind body or the workspace token, never by relaxing the threshold. The test prints the
  matrices (the table above is its current output, min workspace↔kind = 20.6: slate↔cocoa).
- **Value map** (albedo L\* targets; ±4). Floors ≥ 15 L\* darker than walls; ceilings darker than walls; walkable floors
  ≤ 52 so the lit clay body (L\* 60) and its ink hull separate from what they stand on.

  | Zone | Floor | Wall | Wainscot/trim | Ceiling | Hero prop |
  |---|---|---|---|---|---|
  | LOB | 46 oak-dark planks; queue lane mat 44 **slate-teal** `#4E6E6E` | 82 cream | 58 oak | 72 | Help Desk walnut 38 + brass |
  | ATR / PIT | 48 warm concrete; pit rug 40 **deep teal** `#2F5F5A`; sofas 52 sage `#7E9A86` | 80 | 60 | 70 (skylight frame) | Big Board ink 20 + emissive |
  | STR | 40 **slate-green pavers** `strPavers` `#5F6A64` (L\* 44, cobble pattern) | 62 **painted brick**: sage-grey `strBrick` `#97A396` (L\* 66) bricks, grey-green mortar `strMortar` `#77827A` (L\* 53) | 30 storefront frames | 36 (dark, string lights pop) | banners (workspace jewel) |
  | BAY | 50 felt carpet, **desaturated blue-green** `#6F8784` | 80 | 62 | 70 | desks oak 66 |
  | LIB | 44 walnut | 74 oat plaster | 40 green | 60 (mezz underside) | shelves walnut 32, spines 45–65 |
  | MEZ | 38 navy carpet | 70 | 50 | 28 star-map | telescope brass |
  | LAB | 52 teal-grey tile | 84 | 70 tile | 76 | fume hood 30 + TEST light |
  | ENG | 40 perforated steel | 58 | 44 | 34 | rack wall ink 22 + LEDs |
  | CAF | 48 **sage-teal terrazzo** `#5F7A74` (h 180; chips cream/oat/`tealDeep` only, **no clay chips**) | 82 | 58 | 70 | espresso bar walnut 36 |
  | WAR / MAIL / ARC | 48 | 76 | 56 cork/kraft/steel | 66 | whiteboard `#EDE6DA`, pigeonholes, drawers |

  *STR tokens (RND m2 r1, ratified by LEAD m2 fix r2):* the covered street is lit only by fill + lamps, so at the nominal
  40 / 62 it rendered floor L\* 34 and shade-side brick 45, under the §5.0 rows. The tokens sit **+3.5 L\* inside the ±4
  band** with hue and chroma unchanged (pavers h 160°, brick h 142°); floor stays ≥ 15 L\* under the wall and ≤ 52.
  `palette.test.js` pins all three to the band. Any further lift goes to STR lighting (§5.6), not albedo.

- **Complementary staging.** Surfaces behind the most-viewed character hotspots are deliberately cool (Pit rug and sofas,
  queue mat, bay carpets above; café terrazzo and banquettes teal; Studio Street pavers and painted brick sage), so
  terracotta Clawds get hue separation as well as value separation. **No warm-on-warm where Clawds spend time:** no
  floor or wall within 15 L\* of clay (60) may sit within 30° of its hue (44°) in BAY, PIT, CAF, STR, LOB (wood trims,
  storefront frames and small props excepted). **Hue-gap check** (`review-shots`, with the greyscale check): at
  `pitOverview`, `lobbyDesk`, `eBayGlass`, **`cafe` and `street`**,
  sample the 6 px ring just outside each Clawd's mask; in ≥ 70% of samples the ring's hue differs from clay (h 44°) by
  ≥ 60° or its chroma is < 12.
- **Greyscale check (ART §11 #10, new):** `review-shots` also writes luminance-only versions of `spawn` and `street` (shot
  poses 1 and 3). In both, the top-10 local-contrast blobs (8×8 px RMS of L\*) must all lie on characters, their hulls,
  status emissives or stats readouts.

### 5.6 Mood lighting (cheap, all inside existing programs)
- **Window gobo = the only way the sun gets in (Medium+).** `toonEnv` gets `uWindows[8]` (rects from the layout for the
  current vis cell: plane, size, mullion count, blind-slat frequency). For each env fragment, cast along the **real sun
  direction** to each window plane; inside the rect and outside mullion/slat bars → `gobo = 1`. Result feeds `sunTerm`
  (§5.0), an *additive* warm patch; it does not touch `keyVis` or the studio key. Patches sweep with the clock and go
  long and golden at 17 h; windowless rooms simply get none. Low: no gobo, no sun indoors. Characters don't receive
  gobo (they stay uniformly readable). Replaces god-ray quads on Medium (High keeps both).
- **Lamp pools (all tiers, `lamps.js`).** Every lamp anchor in the layout (desk lamps, street lamps, string-light spans,
  pendant lamps, the hearth, rack LEDs as one pool) has `{pos, radius, colour, gain, schedule}`. Per vis cell, the ≤ 12
  pools nearest the cell centre (visible set included) go into `uLampPos[12]` (vec4 pos + radius) and `uLampCol[12]`
  (vec3 × gain) shared by `toonEnv`, `toonProp` and `toonChar`: `lampPool = Σ col · (1 − (d/r)²)² · max(N·Ł, 0)`,
  unshadowed, inside the existing programs (no new variants). Set changes on a cell switch cross-fade over 0.4 s
  (per-pool gain ramps, never a hard swap). So every lamp always lights its own surroundings; rooms never pop on/off as
  the player walks. Day: pools at 15% (lamps read as "on" without lifting the value map); golden 40%; night 100%.
  The red blocked desk lamp is a pool with `colour = blocked`, gain 0.25, and also one of the ≤ 2 point lights when
  it is the nearest to the player (§5.1).
- **Glass reflections.** `glass` has a `uReflect` mode uniform (no new program): **exterior** windows reflect the sky
  gradient; **interior** glazing (E-bay back walls, ENG partition, café screens, phone booths) reflects a warm interior
  gradient (ceiling cream `#F2E7D6` → floor oak `#8A6A4C`) plus one soft diagonal streak highlight (≤ 0.9, never
  emissive). A blue sky seen reflected indoors reads as a bug.
- **Per-zone colour script (`zoneGrade.js`).** Each vis cell has `{keyTint, skyTint, groundTint}` (chroma-only; max
  channel 1, so §5.0 still holds). Blended over 1.5 s as the camera changes cell: LIB brass-green warmth, ENG cool teal +
  LED spill, **CAF neutral** (a hint of teal in `groundTint`), **STR cool dusk-teal** (the string lights' warmth comes
  only from their lamp pools and bulbs, never from the zone grade), LAB clean cool, MEZ dusk navy. Zero extra draws.
  No zone grade may push clay beyond the LUT clamp (ΔE < 8, §5.0).
- **State-driven outline (CHR, via `handle.setOutline`).** blocked: width ×1.35, colour pulsing ink ↔ `#7A2A20` at 1.5 Hz;
  selected/followed: `clayLight`; sleeping: width ×0.7, softer (ink 60%). Everyone else: ink 80% + 20% part colour.
- **Polymer-clay micro-surface (High, M3).** Within 2 m: object-space fingerprint noise perturbs the normal (≤ 4°), and a
  thin band at the ramp edge shifts the shadow tint toward `#C0503A` (warm subsurface terminator). Uniform-faded, no new
  program.

---

## 6. Character system (CHR, BRN)

### 6.1 Scale & look
Toy scale (ART §1 proportions restored; GP §1.2 heights superseded by §7):

| Element | Size |
|---|---|
| Clawd | ≈ 0.88 m incl. accessory (legs 0.16 + body 0.54 + accessory) |
| Shelly | ≈ 0.75 m |
| Mini-Clawd (subagent) | 0.45× |
| Desk / chair seat | 0.55 m / 0.32 m |
| Door | **1.7 m high**, 1.4 m wide (main entrance 3 m, bay storefront openings 2.4 m) |
| **Player eye height / FOV** | **1.2 m / 60° vertical** |

- **Framing check (§9.2):** a standing Clawd 4 m in front of the camera at 1600×900 fills **≥ 18% of frame height**
  (0.88 / (2·4·tan 30°) = 19%). `__hq.frameCheck()` measures the projected bbox.
- Rigs, face, accessories, personality and variants follow ART §5 with these amendments:
  - **Eyes 0.09 w × 0.17 h** (was 0.075 × 0.15; ART's own ≥ 1/9-body-width rule needs ≥ 0.08), at x ±0.145, y +0.08.
  - **Glints are placed in screen space:** the glint offset is computed per frame from the key-light direction projected
    into view space (upper side toward the light), clamped inside the eye, and its radius is `max(0.018 m, 2.5 px)` so
    it never shrinks to a sub-pixel speck. It is unlit paper, always on.
  - Workspace accessory = `colorIndex` (type and colour), stripe when `cycle > 0`. No floor ring in workspace colour.
  - Kind body colours per §5.5. The model tier is a lanyard emblem, not a hat (see §12).

#### 6.1.1 Hero gate (before any breadth)
The first CHR deliverable is **one** Clawd brought to final quality and approved by the art reviewer on a hero sheet
(`?sheet=hero`, `src/debug/sheet.js`): neutral cyc (oat backdrop L\* 70, ground L\* 50), final post stack, day grade.
- An 8-angle turntable (45° steps) at eye height 1.2 m, 2 m distance.
- All 9 expressions (ART §5.3) front 3/4.
- All 8 accessories (on the same body), plus one `cycle 1` stripe variant.
- 3 personality extremes: chubby (width +6%), tall (height +5%), low-energy (0.75) mid-idle.
- Codex (**slate** `#4D4B52`, standing beside the sheet's desk for `clayCheck().codex`), **rose** and **pebble** kind
  bodies once each (v2's jade is retired, §5.5).
- The sheet also runs `__hq.clayCheck()` (§5.0) and the silhouette render.
No other character work (Shelly, activities beyond M1's list, minis) starts until this sheet is signed off.

### 6.2 Rig ↔ render split (decided now so instancing is never a rewrite)
- A rig is a **pure math `Object3D` tree that is never added to the scene**. It declares
  `parts: [{type, node, colorKey, hull:bool, castShadow:bool}]`.
- **`charBatch.js`** owns one `InstancedMesh` per part type (body, eye-slot, eye-arc, eye-heart, glint, lid, brow, arm-seg,
  hand, leg, each accessory type, each prop type, the Shelly parts and screen) plus a hull `InstancedMesh` for hull parts.
  - Hulls share the `instanceMatrix` attribute.
  - Each frame it writes world matrices and colours. Hidden parts get a zero-scale matrix.
  - Target: about 25–40 draws for all characters regardless of count.
  - **Culling:** every charBatch/hull `InstancedMesh` has `frustumCulled = false` (its geometry bounds say nothing about
    instances spread over the office; three's default would cull or pop the whole batch). Culling is per actor in JS:
    `actors.js` tests each actor's bounding sphere (r 0.6 m, + prop reach) against the camera frustum and the vis-cell
    set once per frame; hidden, LOD-hidden and out-of-frustum actors write zero-scale matrices for all their parts. A
    part type with 0 visible instances sets `mesh.count = 0` → no draw.
  - **Shadow pass:** the shadow camera has its own frustum; actors inside the 24 m shadow box but outside the view
    frustum keep non-zero matrices *only* if their shadow can land in view (sphere vs view frustum expanded by 1.5 m
    toward the key). Only part types with `castShadow` (body, legs, arms, accessory, prop ≈ 12) draw in the shadow
    pass; eyes, glints, lids, brows, glyphs and hulls never do (budget in §5.3).
- **Swappable face glyphs** (mouth frames, `@` dizzy eyes, Shelly screen glyphs) use one instanced sprite type. An
  `aGlyph` instance attribute indexes an atlas.
- **Shelly's screen** is an instanced `screen` material quad that shows glyph faces from the atlas. Close-range live output
  lines use a small per-Shelly canvas, only within 4 m.
- **Portraits** (`portraitBatch.js` + `portraits.js`): a dedicated count-1 batch and async readback; rules and budget in §5.4.

### 6.3 Animation stack (`src/chars/anim/`)
ART §6 is normative.

- **Springs and helpers:** `Spring1D/3D` (presets snappy, bouncy, floaty, jiggle), `SecondOrderDynamics`, `noise1`, easings.
- **Pose layers:** `locomotion → action → reaction → additive`, each with a joint mask. The `animator.js` API:
  ```js
  animator.setLocomotion(speed, turnRate, grounded)      // from motor
  animator.setAction(activityId, {prop, target, intensity})  // blend 0.25 s
  animator.react(reactionId)                              // one-shot, preempts ≤ 2.5 s
  animator.setFace(expression) / lookAt(vec3|null) / setEnergy(k)
  animator.update(dt, lod)  → writes rig node transforms
  ```
- **Activity vocabulary** (`activities/*.js`, each file `{id, mask, props, face, update(t, pose, actor)}`):
  - Desk and generic: `type`, `typeFrenzy`, `pencilEdit`, `readBook`, `grepMagnify`, `globCards`, `think`, `bashPound`,
    `bashWatch`, `dishWeb`, `delegate`, `clipboard`, `phoneMcp`, `cableMcp`, `compactBackpack`, `ask`.
  - Desk git: `stampEnvelope`.
  - Stations: `libraryRead`, `ladder`, `labPour`, `mailSort`, `whiteboard`, `telescope`, `radio`, `roundTable`.
  - **Walking variants** (arms-layer only, used during 2.0 m/s scurries, §6.5): `walkRead`, `walkType` (laptop),
    `walkMagnify`, `walkClipboard`, `walkPhone`, `walkFlask`.
  - Blocked: `waveBlocked`, `queueWait`, `serveStepUp`, `pointTicket`.
  - Idle and done: `lounge`, `sleepDesk`, `sleepBunk`, `sleepwalk`, `sitIdle`, `fidget:<name>`, `coffee`, `windowGaze`,
    `arcade`, `pingpong`, `foosball`, `waterPlants`, `petCat`, `fishStare`, `confused`, `holdSign` (still here?),
    amenity hobbies `piano`, `treadmill`, `waterGreenhouse`, `boardGame`, `paint`, `hammock`; NE/mezzanine picks
    `telescopeGaze`, `slideRide` (climb, whee, tumble-land), `hotDeskDoodle` (mezzanine rail), `microfiche`,
    `fileNook` (reads a drawer file), `vaultNap`; sign-off `parcelCarry` (§6.4).
  - Shelly (§6.7): `cursorTap`, `knit`, `juggle`, `crank`, `newspaper`, `walkie`, `cocktail`, `sortEnvelopes`, `shovel`,
    `spinnerWatch`.
- **Reactions:** `startle`, `victory` (3 variants), `dizzy`, `fistPump`, `slump`, `clap`, `arrive`, `leave`, `bump`,
  `pat`, `wave`, `busyFinger`, `highFive`, `hop`, `bow`, `wake`, `sneeze`, `unblock` (hop + thanks), `thankYou` (sign-off),
  `workCall` (jolt + "!" + grab laptop, §6.4.2), `exhale` (struggle cleared), `dissolveIn` (cold start, §6.4.3).
- **Stop-motion accents (M2, CHR):** on fast actions (`typeFrenzy` noodle arms, `victory` spin, `startle`, `workCall`,
  `slideRide` exit) a part whose screen velocity exceeds a threshold is **smeared** for one frame (scaled along its
  velocity ×1.6, thinned ×0.8, via its instance matrix; no new geometry), and key poses are **held for 2 frames**
  (animator samples the action layer on twos for the key pose window). Cheaper and more "claymation" than extra spring
  amplitude. Disabled under reduced motion.
- **Locomotion:** trot, waddle or skip by personality. Planted feet with step triggers, noodle-arm 2-bone reach, banking,
  anticipation on start and stop, a sit and stand hop, and a hop on auto-steps. Shelly uses a wheel roll with a lagging neck
  spring.
- **Personality:** `mulberry32(hash32(seedKey))` → energy, bounciness, size, hue, blink rate, favoriteFidget,
  favoriteSpot, walkStyle, voice. Deterministic.

### 6.4 Brain (`src/chars/brain/`, @pure logic + thin three adapters)
- **Director** (global, one instance) owns allocations:
  - bays: **a pure function of `workspace.slot`** (server-persisted ordinal, `world/slots.js`: smallest free ordinal on
    first sight, keyed by label + number, freed 5 min after the workspace disappears). `BAY_ORDER = [E3, E2, E1, W3, W2,
    W1]` (E bays first: glazed onto the atrium, closest to stations, visible from spawn); `bay = BAY_ORDER[slot]` if
    free, annexes resolved in slot order. So reloads, reconnects and a second window produce the same office. A
    workspace with > 6 panes takes the nearest free bay as an annex; slots ≥ 6 → mezzanine hot desks. A freed bay reverts
    to its amenity (§7.2) with a "moving day" crate animation;
  - desks: tab runs in `(tab.index, paneIndex)` order;
  - shell benches in ENG, plus a ghost desk in the bay;
  - the help queue ordered by `statusSince` (the head is NOW SERVING, §6.8.1);
  - Pit seats for unacked done agents, oldest nearest the south gap;
  - station and amenity slots, via `nav/reservations.js`.
- **Brain** (one per actor) is a hierarchical FSM that takes the Entity and `now` and outputs an **Intent**:
  `{slot, activity, face, bubble, ring, glyph, lamp, outline, dust, speed}`, plus one-shot reactions from `event` messages.
  - **Motor** (in `actors.js`) plans the path via nav, walks, and hands off to the activity on arrival.
- **Timings** live in `tuning.js`. This table is authoritative (merges GP §3.1 and ART §6.4; conflicting rows there are
  superseded, §12.2):

| Status | Phase | Location / activity |
|---|---|---|
| working | always | Own desk, activity from `activity.cls`; station trips only per §6.5. **Task placard** on the desk (§6.7). Mug on desk after a 10 min working streak, steaming after 30 min (plain mug while `statusSinceApprox`) |
| blocked | 0–10 s | `startle` → stands on chair, `waveBlocked`, red "!" bubble, red desk lamp, pulsing state ring, blocked outline |
| blocked | > 10 s | Scurries (2.0 m/s) to the Help Desk queue holding a ticket (`mm:ss` + question + a `re: <task>` line, §6.7), taps the bell every 20 s. Desk keeps a red lamp and an "at help desk →" post-it. Beacon spins. The queue head waits under NOW SERVING (§6.8.1) |
| blocked | > 5 min | Personal rain cloud; skylight rain streaks while any agent is in this phase |
| done (not acked) | 0–4 s | `victory` at the desk + 40 confetti |
| done (not acked) | then | Carries its laptop to a Pit sofa seat, `lounge` with cocoa, ✓ pennant **lettered with its task**, waves at the player within 4 m. **Stays in the Pit until signed off** (§6.8.2); after 30 min it naps on the sofa (idle ladder, but in place) |
| done (acked) | on ack | `thankYou` (bow + wave), pennant removed, picks up a wrapped **parcel** and trots Pit → Mailroom **OUTBOX chute** (drops it in: chute flap, bell ding, "SHIPPED" stamp; not the pneumatic tube, which means commit), then home to its desk; then the idle ladder with idle time counted from `statusSince`. If a new prompt arrives mid-run, the work-call rule applies (§6.4.2) |
| idle | ladder | §6.4.1 |
| working, struggle ≥ 2 | while set | Same desk/station logic; adds the struggle look (§6.7): static-frizz tufts on the head, scribble eye-bags, a small orbit of crossed-out paper balls; `exhale` + tufts settle when cleared |
| unknown | always | Opaque ghost look (§5.1), "?" bubble, wanders Studio Street ↔ Plaza, stares at the signpost |
| shell | by `process.activity` | ENG bench activity per §6.7 (Shelly rows); smoke puff on exit; long `prompt` → Shelly idle ladder (§6.4.1) |

- **Status hysteresis:** a new status must persist 1.5 s before the actor re-targets (except → `working` while away,
  which reacts at once, §6.4.2). Status changes mid-walk re-plan from the current position.

#### 6.4.1 Long-idle ladder (P3 with 2–5 mostly idle agents)
| Idle for | Behaviour | Dust (`fx.dust`) |
|---|---|---|
| < 2 min | At the desk: `sitIdle` + favoriteFidget | 0 |
| 2–10 min | Chill loop: a weighted pick every 20–60 s from the **chill list** below, biased by favoriteSpot | 0 |
| 10–60 min | Alternates **nap 3–6 min** (bay nap spot / bunk / Pit beanbag / head on desk) with **hobby 2–4 min** (favoriteSpot, an amenity, or the **hobby list**). 10% of naps are **sleepwalks** (eyes shut, arms forward, ≤ 10 m loop at 0.4 m/s, Z's) | 0 |
| 1–3 h | Same cycle, naps get longer | 1: dust film on desk and head top, motes puff when bumped |
| 3–6 h | Same | 2: + cobweb from chair to desk corner |
| ≥ 6 h | Same | 3: + a "still here?" sign taped to its monitor; it holds the sign up when the player is within 4 m |

- **Chill list** (weights before bias): coffee 3, arcade 2, ping-pong pair 2, foosball 1, plants 1, window 1, library
  browse 2, cat 1, fish tank 1, amenity bay 3, **ride the slide 2** (stairs up, slide down), **telescope gazing 1.5**,
  **mezzanine hot-desk doodle 1.5**, **Archive microfiche 1**, **filing nook 1**.
- **Hobby list (10–60 min):** amenity hobbies, board game at the Round Table, stargazing at the Observatory,
  "cataloguing" in the Archive (sorts drawers), vault nap in the Archive (with Segfault if the cat is there).
- **Roaming cap:** a pick is eligible only if its path from the agent's desk is ≤ **25 m** (≤ 9 s at the 2.8 m/s
  work-call speed); weights are multiplied by `1/(1 + d/10)`. Nap spots are looked up nearest-first (each bay has one
  nap spot: beanbag or hammock corner). The slide/mezzanine/Archive picks are exempt from the cap only for agents whose
  bay is within 25 m of the stairs foot (E bays), so traffic exists without long commutes for W bays.
- **Shelly idle ladder** (shells at `prompt`; P3: ENG must not be static in real sessions, where `prompt` dominates):

  | At `prompt` for | Behaviour (never leaves ENG) |
  |---|---|
  | < T (T = 5–10 min, seeded per Shelly) | At its bench: `cursorTap` + green drink (§6.7) |
  | ≥ T | **Pocket mode**, a pick every 30–90 s: tend the racks (wipe an LED, tug a cable, the rack blinks), read the boiler gauge, water the ENG fern, roll a slow lap along the glass partition waving at the atrium |
  | ≥ T with ≥ 1 other pocket Shelly | **Card game** at the ENG break table (≤ 4 seats; drawn suit glyphs in bubbles, a winner `^_^` every ~40 s) |
  | ≥ 30 min | Parks at its bench, screen dims to a pixel-Clawd screensaver (§11.5) with Z's |

  Any `process.activity` change or pane focus → **snap back**: screen flash + beep, roll to its bench at 2.0 m/s
  (≤ 8 m inside ENG, ≤ 4 s), then the activity. The bench plate always shows the true state; a pocket Shelly's face
  shows `>_`. With zero shells, ENG liveness comes from the rack LEDs, hamster wheel, boiler and Segfault's rack naps.
- Dust is a pure function of idle time (honest). The player's blow-dust verb (§6.9) is a cosmetic puff + sneeze; the dust
  re-settles to the level implied by idle time over 60 s. Nightcaps on sleepers 00–06 local are ambient (time-based).

#### 6.4.2 Work call (idle/done → working while away from the desk)
- Trigger: status becomes `working` (after the 1.5 s hysteresis is **skipped** for this transition: a prompt is a user
  action and the reaction must feel immediate) while the actor is not at its desk.
- Sequence: `workCall` reaction 0.5 s (napping: `wake` jolt, Z's pop; otherwise `startle`-lite with "!"), then a
  **scurry at 2.8 m/s, sped up to a dash of at most 4.6 m/s so the leg home takes ≤ 6.4 s** (`tuning.js`
  `workCallSpeed` / `workCallDashMax` / `workCallBudgetS`; BRN m15, ratified LEAD m2 fix r2) with `walkType` (laptop open, typing) on the arms layer, the speech bubble live with the current
  tool, shortest path home (stairs down; the slide if on the mezzanine and it is shorter). At the desk: sit-hop straight
  into the current activity. If a station trip is valid for the current dominant phase (§6.5), go there instead.
- Blocked while away → the blocked rules apply from where it is (walk to the queue directly after 10 s).
- **Accounting:** work-call time **counts toward `walkWhileWorkingPct`** (it is walking while working). Budget:
  `__hq.metrics().workCallS` p90 ≤ 8 s and `workCallPct` ≤ 6 in `mixed`; with station trips the total stays ≤ 20. The
  roaming cap above is what makes this hold.
- M4: the atrium zipline (§11.5) shortens calls from the café/Nap Nook to ≈ 3 s.

#### 6.4.3 Cold start, reconnect and second windows
- **The first `world` a renderer receives is a cold start:** every entity spawns **already at its Intent slot** (desk,
  queue slot, Pit seat, ENG bench, current idle-pick spot at a deterministic phase of its loop) with a 0.4 s Bayer
  `dissolveIn` and a small `hop`; no walking, no arrivals, no reactions for pre-existing states (no confetti for an old
  `done`).
- **Front-door arrival** (walk in from the entrance, `arrive` reaction) plays only for an `arrived` event, which the
  server emits only for panes created after its own first snapshot (§4.3).
- **WS reconnect / later `world` messages:** existing actors keep their positions and re-plan if their Intent changed;
  entities new to this renderer without an `arrived` event (created while disconnected) use the cold-start rule;
  entities missing from `world` leave with a `dissolveOut` (the server already applied the herdr grace rules, §4.2).
- Idle-time-derived state (dust, nap phase) is computed from `statusSince`, which the server persists across restarts
  (§4.3.1), so a cold start shows the right dust level. For first-ever sightings (`statusSinceApprox`) dust is capped
  at level 1 and elapsed chips read `~12m`.

#### 6.4.4 Capacity & overflow (`brain/capacity.js`, @pure)
Every slot type has a fixed capacity and a **deterministic overflow** (sorted by `(statusSince, id)`; overflow spots
are generated on a spiral from an anchor in `hq.js` with 0.7 m spacing, skipping non-walkable cells and keep-clear
rects, so any N fits):

| Slot type | Capacity | Overflow (in order) |
|---|---|---|
| Bay desks | 6 bays × 6 = 36 (+ annex rules) | mezzanine hot desks 8 → Reading Alley laptop benches 6 → spiral "floor cushion" desks in the Library |
| ENG shell benches | 10 (2 rows × 5) | standing spots along the rack wall 8 → spiral in ENG |
| Help queue | 10 lane slots (§7.1) | overflow rug 6 → **waits at its desk** standing on the chair (red lamp, ticket shows "queue full"); Big Board lists it |
| Pit (unacked done) | sofa ring 12 + step seats 8 + beanbags 4 = 24 | spiral on the Pit floor → atrium rug |
| Library (read/search) | 6 seats + 2 ladders | desk variant (§6.5) |
| Lab | 4 benches | desk variant |
| War Room | 4 whiteboard spots | desk variant |
| Observatory / Round Table | 3 telescopes / 8 seats | desk variant |
| Phone booths | 3 | desk variant |
| Mailroom | 2 sorting spots + 1 OUTBOX queue of 4 | parcel dropped by the door with the same animation |
| Amenities | per amenity 2–6; café 10; Nap Nook bunks 6 | next pick in the chill/hobby list |
| Unknown wanderers | unbounded (free walking) | — |

`director.test.js`: for N ∈ {1, 12, 40, 60} and 200 seeded status mixes (incl. 60 blocked, 60 done, 60 shells), every
actor gets exactly one slot, no slot is double-booked, results are identical for the same input, and a full queue
(10 + 6) leaves every door reachable (with nav, §6.6).

#### 6.4.5 "While you were away" (`ui/away.js`, M2)
The typical real session: leave for 40 minutes, come back, want the story.
- **Trigger:** `lastPresentAt` (tab visible + window focused + any input) is kept in localStorage per session. On
  `visibilitychange`→visible, window `focus`, or the first input after a reload, if `now − lastPresentAt ≥ 10 min`
  (setting `awayRecapMin`, default 10; 0 = off) → recap once.
- **Data** (honest, all already produced): the store's event ring (the store applies events while hidden, §3.4) or,
  after a reload, `timeline.get {since: lastPresentAt}` (§4.3.1). Lines, ≤ 6, in this order: blocked now (count +
  longest wait `name mm:ss`), finished (N, names), commits, test streaks (`scout 5× pass`) / fails, arrivals and
  departures, struggle incidents. Nothing happened → one line "All quiet · 3 idle, dust settling".
- **Presentation (5–8 s):** Ada rings her desk bell and waves; the Big Board flips to a **WHILE YOU WERE AWAY** face and a
  paper ticker prints the lines one per 0.8 s (typewriter clack). If the Big Board is not in view, the same ticker
  prints as a paper strip under the HUD pills (DOM). Any key/click dismisses it and still performs its action; each
  line is clickable (open terminal / go to). Reduced motion: the strip only, no typewriter.
- **If anything is blocked:** the Blocked Inbox opens **non-modally** with the oldest blocked pre-selected; world input
  keeps focus (`B` or a click focuses the inbox). If xterm has focus, the inbox does not open; the drawer's blocked
  counter pulses and an in-drawer toast lists the recap.
- Test: `p2.mjs` fakes `lastPresentAt − 40 min` with the `queue` scenario → ticker visible within 1 s, inbox open with
  the oldest blocked selected, world scope unchanged.

### 6.5 Stations without dishonest commutes (`brain/phase.js`)
Problem (review): at 0.9 m/s over 20–45 m, agents arrived after the tool had changed. Rules:
- **Dominant phase.** Sample `activity.cls` at 1 Hz into a rolling **40 s** window. A class with ≥ 60% time share becomes
  the dominant phase; the phase ends when its share falls below 40% for 10 s, or the status leaves `working`. Short
  interjections (a 3 s Edit during a read phase) never trigger movement.
- **2× rule.** Go to the station only if `expectedRemaining ≥ 2 × travel`, where `travel = pathLength / 2.0 m/s` (cached
  per (desk, station)) and `expectedRemaining = E[phase length] − elapsed`. `E` is a per-actor EMA of completed phase
  lengths for that class, seeded by priors: read/search 45 s, test/build 45 s, web 40 s, task 120 s, todo/think 25 s,
  mcp 25 s, git 10 s.
- **Cooldown:** 60 s per actor between the end of one station visit and the start of the next.
- **Scurry:** working commutes run at **2.0 m/s**; the actor carries the class prop and keeps animating the tool on the
  arms layer while walking (reading while trotting, typing on a laptop, magnifier sweeping), and its bubble keeps updating.
- **Return / chain:** when the phase ends, go straight to the next dominant class's station if the 2× rule passes, else
  back to the desk. A full station → desk variant. Returning from the mezzanine to level 0: slide 50% of the time.
- **Honesty backstop:** the activity glyph (§6.7) always shows the *current* tool class, even mid-walk or at a station.
- **Acceptance:** `mixed` demo, 10 min, `__hq.metrics().walkWhileWorkingPct ≤ 20` (time spent walking while
  `status==='working'` ÷ total working time, summed over actors, **work calls included**, §6.4.2). Station placement
  (§7) is by frequency so this holds.
- **Vertical traffic is guaranteed by honest idle sources, not by rare trips.** The Observatory (web) almost never
  passes the 2× rule; the slide and stairs live off the chill/hobby lists (§6.4.1), mezzanine hot desks (§6.4.4) and
  Round Table task trips. Acceptance (`__hq.metrics().slideRides`, `stairClimbs`, `zoneVisits`), 10 min at timescale 1:
  `mixed` ≥ 4 slide rides and ≥ 8 stair climbs; `trio` ≥ 1 slide ride; `mixed` has ≥ 1 visit to each of MAIL and ARC
  per 3 min (NE quadrant alive, P3). `npm run review -- --sim 600` runs these headless at `timescale 10`.

| Class | Desk activity | Station | One-way from E2, mean of 6 desks (measured, `walktimes`, s @ 2.0 m/s) |
|---|---|---|---|
| edit | `pencilEdit` | — | |
| write | `typeFrenzy` | — | |
| read | `readBook` | Library | 13.0 m · 6.5 s (E-bay back door; E1 7.8 m) |
| search | `grepMagnify` / `globCards` | Library | 13.0 m · 6.5 s |
| bash | `bashPound` (> 10 s → `bashWatch`) | — | |
| test / build | `bashPound` + monitor `>_` | Lab | 17.8 m · 8.9 s (E3 11.3 m; E1 23.8 m · 11.9 s) |
| git | `stampEnvelope` (desk) | Mailroom (rarely passes the 2× rule) | 21.7 m · 10.8 s |
| net | `bashPound` | — | |
| web | `dishWeb` | Observatory (mezzanine) | 36.1 m · 18.0 s (stairs; back by slide) |
| task | `delegate` + mini-Clawds | Round Table (mezzanine) | 39.3 m · 19.7 s (stairs; back by slide) |
| todo | `clipboard` | War Room | 22.5 m · 11.3 s |
| think (> 20 s) | `think` (lightbulb after 20 s) | War Room | 22.5 m · 11.3 s |
| mcp | `phoneMcp` | Phone booths (Plaza) | 18.2 m · 9.1 s |
| compact | `compactBackpack` | — | |
| ask | `ask` (raises hand, bubble shows question) | — | |
| talk / other / null | `type` | — | |

Measured by `npm run walktimes` at LVL fix r1 (nav path lengths, current hq.js); re-run at every layout gate.

### 6.6 Navigation (`src/world/nav/`, @pure)
- 0.25 m occupancy grids: level 0 is 168×112 (42×28 m), level 1 is the mezzanine rect + landing (§7). They are baked at
  load from layout walls and `solid` furniture footprints.
- **Nav level schema** (`layout.levels[]`, `layout/schema.js` `NavLevel`): `{id, y, open?, block?, queueLane?, cameraWells?}`.
  `block` entries are `{rect}|{circle}|{seg}`, solid for everyone. `queueLane` is a rect or list of rects, solid for everyone except
  queue members (`opts.queue`). **`cameraWells`** (LVL m2 r1; ratified by LEAD m2 fix r2) are `{rect}|{circle}` in world
  coords: the stand and near field of a §9.2 review camera (`eBayGlass`, `library`, `lab`, `street`). They are **solid for agents**
  (walkers route round them and no wander point or stander lands in them) and **open for the player** (grid owner `'*'`).
  No slot may lie in a well, and each listed pose must stand in one (`layout.test` 'hq camera wells'). Wells complement
  `keepClearViews` (the directors' soft 1.5 m / view-cone avoidance): a well is a hard block.
- Octile A*, then string-pulling. Portals link the levels: stairs are two-way, the slide is one-way (agents and the
  player; the player rides it with E, §6.10).
- **A\* scratch (BRN m2 r1 rewrite of `nav/astar.js`; ratified by LEAD m2 fix r2):** allocation-free, with one scratch set per
  grid size validated by a generation stamp and a typed-array binary heap (Float64 `f`). `gScore` is **Float32**: its
  relative rounding is 2^-24 per step, so on paths of ≤ 1000 cells the accumulated error stays < 1e-2 cell and can only
  pick among near-tied routes. The contract is **cost equivalence**, not bit-identical paths: the returned path's cost
  (re-summed in Float64, cell units) must equal a Float64 reference A\*'s within 1e-2 on random start/goal pairs on both hq
  levels, both must agree on reachability, and every step must be a legal octile move (no corner cutting) (LVL owns
  that test in `nav/astar.test.js`). LEAD's one-off check at ratification (800 seeded pairs, both levels, paths ≤ 187 cells)
  found a max cost difference of 2e-13, no reachability mismatch and no illegal step. Non-reentrant; single-threaded callers only.
- Steering: separation within 0.6 m. Head-on conflicts resolve by id priority, and the actor that yields does a `bow`.
- `Slot {id, tag, pos, yaw, pose, level}` with `reserve(tag, actorId, near?) → Slot|null`, `release`, `releaseAll(actorId)`.

### 6.7 Signal vocabulary (normative: one visual = one meaning)
Every team codes against this table. Rows in ART §6.4–6.6 / GP §2–3 that disagree are superseded (§12.2).

| Visual | Means (only this) | Source |
|---|---|---|
| Floor ring, state colour (**chroma budget below**) | herdr status | `status` |
| Activity glyph: small **non-emissive** paper pictogram with an ink outline (book, magnifier, pencil, flask, globe, phone, crowd, clipboard, bulb, `>_`) above the head, shown only beyond 8 m | current tool class while working | `activity.cls` |
| Monitor status strip: a 1-line bar at the top of the desk monitor in state colour (accent emissive ≤ 1.6, ≤ 12% of the screen); the screen body is neutral live text ≤ 0.95 | the desk owner's status | `status` |
| Speech bubble (tool + detail) / thought bubble | current tool detail / thinking | `activity` |
| **Task placard**: paper board on the desk + line on the bay's storefront sign; also on the ticket (`re:` line) and the ✓ pennant | what the agent is working on (the goal, not the tool). Idle: `last: <task>` in muted ink | `taskLabel(entity)` (§3.1) |
| Red "!" bubble, beacon, red desk lamp + post-it | blocked (lamp/post-it = owner is away at the queue) | `status` |
| Ticket in hand | blocked; ticket text = `prompt.question`, `mm:ss` waited | `prompt`, `statusSince` |
| Rain cloud | blocked > 5 min. **Nothing else** (test-fail no longer rains) | `status`, `statusSince` |
| Confetti + victory | `finished` event | `event` |
| ✓ pennant | done and not yet signed off | `status`, `ack` |
| Sweat drops (+0.75× walk) | context ≥ 180k tokens. **Nothing else** | `contextTokens` |
| Backpack size | context 50k / 100k / 150k | `contextTokens` |
| Heat shimmer above head | the pane's process tree > 100% CPU for 10 s (M4 `res`) | `res.cpu` |
| Mug on desk / steaming mug | working streak ≥ 10 min / ≥ 30 min | `status`, `statusSince` |
| Mini-Clawds | active subagents (max 4) | `subagents` |
| Lanyard emblem | model tier | `modelTier` |
| Accessory type + colour, nameplate pill, bay sign/banner/rug, Shelly chest plate, stickers | workspace | `workspace.colorIndex` |
| Tab plate + rug stripe | tab | `tab` |
| Spotlight cone + ◆ | pane focused in the user's herdr TUI | `focused` |
| Lightbulb | thinking > 20 s | `activity.cls==='think'` |
| Envelope stamping (desk) / Mailroom sorting | git command running | `cls==='git'` / `process` |
| **Pneumatic capsule** → ceiling tube thunk | `commit` event (agent) or a shell running `git commit\|push`. Parcels and desk stamps no longer mean commit | `event`, `process.argv` |
| Fist pump + Lab TEST light green | `test-pass` | `event` |
| Slump + TEST light red + safety-shower drizzle (only if at the Lab) + monitor red flash | `test-fail` | `event` |
| Dizzy `@` eyes + smoke puff | `error` event | `event` |
| Z's / sleeping pose | idle nap phase of the ladder (§6.4.1) | `status`, `statusSince` |
| Dust, cobweb, "still here?" sign | idle ≥ 1 h / 3 h / 6 h | `statusSince` |
| Opaque violet-edged ghost + "?" | status unknown (agent kinds) | `status` |
| Outline: thick pulsing red-brown / clay-light / thin soft | blocked / selected or followed / sleeping | `status`, UI selection |
| Nightcap | local time 00–06 (ambient, not data) | clock |
| Static-frizz tufts + scribble eye-bags + orbit of crossed-out paper balls; `exhale` when it clears | struggling while working: repeated test-fail/error, or a long streak without edits (`struggle.level ≥ 2`; level 1 = tufts only) | `struggle` |
| Wrapped parcel → Mailroom OUTBOX chute ("SHIPPED" stamp) | done signed off (the run after `acked`) | `event acked` |
| No nameplate and no ring | ambient NPC (Ada, Segfault, roomba) | — |

**Task placard spec** (P1 for *what*, not only *which state*; the bubble shows the tool, the glyph the tool class):
- **Desk board:** non-emissive paper (`#EDE6DA`) board 0.80 × 0.20 m on a 0.30 m stalk clipped to the monitor's top edge
  (board centre y ≈ 1.15 m, above a seated Clawd's accessory), **double-sided**, ink lettering, clip in the workspace
  colour. One line, ≤ 24 chars (ellipsis), **cap height 0.085 m** → ≥ 6.5 px at 10 m and ≥ 8 px at 8 m (1600×900,
  FOV 60°). M1–M2 lettering is canvas with the §3.4 font stack at weight 800; M3 switches to the capsule-stroke face.
- **Near card (≤ 3 m):** a tent card on the desk top shows the full 2-line `title` + project.
- **Storefront sign line:** under each bay's sign, a paper strip lists `name · task` per desk (≤ 6 lines, cap 0.07 m),
  readable from the street and, for E bays, through the glazing from the atrium (the glazing's reflection streak must
  not cross the strip: `glass` streak mask per window).
- **Ticket / pennant:** the blocked ticket adds `re: <task>` under the question; the Pit ✓ pennant (0.5 × 0.14 m) is
  lettered with the task, so the Pit reads as "what got done".
- **Render:** tiles in one 2048² task atlas (256×64 tiles), redrawn only when `taskLabel` changes (≤ 2 tiles/frame);
  instanced `sprite`-free quads with the `screen` program at emissive 0 (no new program); hidden beyond 18 m.
- **Sightline acceptance** (review, `mixed`): at `spawn` and `pitOverview`, `__hq.placardCheck()` returns, for every
  E-bay agent's desk board and storefront line in view, `capPx ≥ 6` and `visibleFrac ≥ 0.7`; the reviewer reads them
  in the shots.

**Status-ring chroma budget** (60/30/10: blocked is the only thing that pops):

| Status | Ring | Visible when |
|---|---|---|
| blocked | full strength, emissive 2.5 pulse, 0.08 m wide | always (and through the minimap/chevrons) |
| done, not acked | full strength, non-emissive `done` green, 0.06 m, slow 0.3 Hz breathe | always |
| working | **thin 0.02 m, non-emissive, α 0.35**, desaturated 40% toward the floor colour | player within 6 m, or the agent is hovered/selected/followed |
| idle, done-acked, unknown | 0.02 m, non-emissive, α 0.5 | hovered or selected only |
| shells | none (bench plate carries state) | — |

So a busy office is not a field of blue selection circles; `working` reads from location + pose + monitor strip.

**Shelly (shell panes), by `process.activity`** (replaces ART §6.6 and GP §3.3; all at its ENG bench):

| Activity | Behaviour |
|---|---|
| prompt | Taps the blinking cursor on its face, sips a green drink |
| edit | Knits; a code-scarf grows |
| test | Juggles 3 balls; catches all and bows when the process exits |
| serve | Turns a hand-crank generator; the bench bulb glows while it runs |
| monitor | Reads a newspaper whose pages show mini bars |
| remote | Talks into a walkie-talkie; antenna blinks |
| repl | Shakes a cocktail shaker |
| git | Sorts envelopes; a capsule only for `commit`/`push` argv |
| build | Shovels coal into the rack furnace door |
| run | Taps a foot, watching a spinner on its face |

### 6.8 Help Desk & the Pit as real work
#### 6.8.1 Serve (answer blocked agents at the counter)
- **Enter Serve:** step onto the STAFF mat behind the Help Desk counter facing the queue, or press **E** on the bell or on
  any queued agent's ticket (the camera glides behind the counter in 400 ms). Input scope becomes `serve` (§8.2).
- The **NOW SERVING** agent (queue head, or the ticket you pressed) steps up and slides its ticket across. A paper card
  appears on the counter (world canvas) and is mirrored by the DOM Serve card (`ui/inbox.js`, the same component as the
  Blocked Inbox) for legibility: portrait, name, ws · tab, waited `mm:ss`, question, numbered options, and
  **Open terminal ↗** as the last row.
- **Pointer-locked controls:** look is damped to ±15°. `W/S`, `↑/↓` or the wheel move the highlight; `1–9` jump to an
  option; `Enter`/`Space`/`E` choose → confirm line "Send ‘2. Yes, allow all edits this session’ to tinker? [Enter] send
  [Esc] back". Choosing *Open terminal* opens the drawer (focus goes to xterm). **Unlocked:** options are buttons; click →
  confirm button.
- **Esc** backs out of a pending confirm; otherwise leaves Serve (the browser also releases pointer lock; the next click
  relocks). Walking off the mat leaves Serve too.
- **On send:** `agent.answer {id, key, promptHash}` (§4.8). `ok` → the agent plays `unblock` (hop, "thanks!" glyph bubble,
  bow) and scurries back to its desk at 2.0 m/s; the next ticket steps up after 600 ms (auto-advance). `prompt_changed` →
  the card shakes and shows the new prompt. `not_accepted` → toast + highlight *Open terminal*.
- No parsed options (free-text prompt) → the card shows the detection text and only *Open terminal*.
- Serving never depends on `settings.quickAnswer`.

#### 6.8.2 Done sign-off (verified herdr behaviour)
herdr `done` means "finished while unseen". Verified on `hqtest` (herdr 0.9.0, protocol 22; research/herdr-api §5.1):

| Action on an unfocused `done` pane | Clears `done`? |
|---|---|
| `pane.read` (visible, detection), `agent.get`, `agent.explain` | no |
| `terminal session observe` | no |
| `terminal session control` (+ release) | no |
| Input via control, or `pane.send_keys` | no |
| **`pane.focus` on that pane** | **yes** → `idle` (and it becomes herdr's focused pane) |

A pane that is focused in herdr when its turn ends goes straight to `idle`. So nothing HQ does silently clears `done`, and
the only herdr-side clear moves the user's TUI. Therefore:
- **HQ sign-off overlay** (`world/acks.js`): `done.ack {id, stateSeq}` stores `{stateSeq, at}` per pane in
  `~/.config/claude-hq/<session>/acks.json`. `Entity.ack` is non-null only while `status==='done'` and `stateSeq` is
  unchanged, so any new herdr transition invalidates it. It follows re-keys (§4.2).
- **Sign-off verbs:** `G` (high-five) on a done agent in the world; opening its terminal for ≥ 2 s (setting
  `autoAckOnOpen`, default on); the ✓ button in the roster / Done section of the inbox; `Ctrl+K` "sign off all done".
- **"Mark seen in herdr"** (status card and drawer header; explicit class) sends `herdr.focus` and genuinely clears it,
  with the label "moves your herdr focus".
- **Honest labelling:** acked agents show `done · signed off in HQ` in the roster and status card (herdr still says done);
  the Big Board STATES face lists them as `done ✓`. On ack the agent does a thank-you and walks back to its desk (§6.4).

### 6.9 Player verbs never lie (P6)
Cosmetic verbs may animate, never relocate, an agent whose status pins it somewhere.

| Verb | idle | done | working | blocked | shell |
|---|---|---|---|---|---|
| R "come here" (cooldown 30 s) | walks to you, waves, returns after 6 s | same; unacked returns to the Pit | turns, waves, holds up a "busy" finger; stays | points at its ticket / the Help Desk; stays | antenna wave, beep |
| Q pat (hold) | squash + hearts | same | squash in place, keeps typing | comfort squash, keeps its queue spot | `^_^` face |
| Q hold on a dusty sleeper | blows the dust (cosmetic), sneezes awake for 10 s | — | — | — | — |
| G high-five | high-five | high-five **= sign-off** (§6.8.2) | air high-five from the desk | — | fist bump |
| E with a coffee cup | takes it, wiggle, mug buff 60 s | same | takes it at the desk | takes it in the queue | oil can |
| Walk into | bump + giggle | same | bump, keeps typing | bump, stays | wobble |

Any status change cancels a verb immediately; the agent goes where the status says.

### 6.10 Player feel (PLY, `player/controller.js`, `cameras.js`)
The player is a toy too. All values in `player/tuning.js`; reduced motion disables bob, roll, FOV kicks and landing dip.

| Aspect | Spec |
|---|---|
| Walk | 3.6 m/s. Accel 0 → walk in 0.14 s, decel to 0 in 0.10 s (exponential approach, frame-rate independent); air control 40% |
| Sprint | Hold Shift: 5.6 m/s; FOV +5° over 0.2 s ease-out, back over 0.3 s |
| Head-bob | Vertical 0.018 m at step rate (walk 1.9 Hz, sprint 2.6 Hz), lateral 0.008 m at half rate, roll ±0.35°. **Phase-locked to footsteps:** the controller emits `bus 'player.step' {surface, speed}` at each bob trough and AUD plays the footstep on that event, so sound and camera agree |
| Stairs / auto-step | Camera y smoothed over 0.08 s: no pops on the stairs ramp, Pit steps or the ENG +0.25 m step |
| Jump | v0 4.2 m/s, g 12; release early → g × 1.8 (variable height); **coyote time 0.12 s**, jump buffer 0.10 s |
| Landing dip | Camera spring dip `clamp(0.012·v_fall, 0.02, 0.10)` m (ω 18, ζ 0.6) + surface thud (`player.land`) |
| Collision | Circle r 0.28, per-axis slide; agents are soft (push-through after 0.3 s; the agent plays `bump`) |
| **Ride the slide** (E at the mezzanine mouth, 1.6 m) | Camera follows the slide centreline (+0.25 m) on a baked Catmull-Rom path, 2.2 s, ease-in, FOV +8°, roll into the turns ≤ 6°, whoosh + "whee" squeak; exits with a landing dip and 0.6 s forward carry. Look stays free ±60°. Clawds within 4 m of the exit clap/cheer (cosmetic reaction, §6.9). The same camera-path system drives the M4 zipline |
| **Sit** (E on a free seat: Pit sofas/steps/beanbags, café stools, library armchairs, amenity chairs; never an agent's own desk chair: "that's scout's chair") | Glide 0.3 s to the seat, eye height 0.78 m, look clamp yaw ±100° / pitch ±60°. In the Pit, done agents in adjacent seats scoot, wave or offer cocoa; idle agents' chill picks bias toward the Pit while you sit (cosmetic, obeys §6.9). WASD / Space / E stands up with a hop |
| Interaction | E radius 1.6 m, crosshair hint names the verb ("E ride", "E sit", "E terminal") |

---

## 7. World & floor plan (LVL, ENV)

**This section supersedes GP §1.1–1.3 geometry** (the 48×32 m, 2 m-door, 8 m-atrium plan regressed to "tiny characters
in big rooms"). Topology and zone ideas are kept; the footprint shrinks 23% to **42 × 28 m** (≈ 1180 m²) at ART toy
proportions. **Source order for the M1.5 build: the §7.1 table (rects, doors, keep-clear, points) is authoritative; the
block map below is only a picture of it.** LVL builds `hq.js` from the table; from then on `hq.js` is the source of truth,
the map is regenerated with `npm run walktimes -- --ascii` and pasted here, and the table is updated from `hq.js` at
every gate. Numbers are provisional until the **M1.5 greybox gate** (§11) measures them.

- **Coordinates.**
  - Plan coordinates `(px, pz)`: origin at the NW corner, +x east, +z south, building 42 × 28 m.
  - three.js world = `(px − 20.5, y, pz − 14)` (the Pit centre is the world origin).
  - **Yaw convention:** camera-style. `forward = (−sin yaw, 0, −cos yaw)`, so yaw 0 faces north (−z). Characters are modelled
    facing +z, so `root.rotation.y = yaw + π`.
  - `layout/schema.js` exports `plan2world`, `world2plan`, `yawTo(dx,dz) = atan2(−dx, −dz)`.
- **Block map** (1 char = 1 m; `a` Reading Alley · `1–3` bays W1–W3 · `s` Studio Street · `4–6` bays E1–E3 · `L` Library
(mezzanine above) · `.` Atrium · `:`/`o` Pit steps/floor · `#` Big Board · `@` slide · `/` stairs · `=` landing · `p` Plaza ·
`W` War Room · `B` Lab · `,` Lobby · `H` Help Desk teller counter · `h` STAFF mat · `q` roped queue lane (10 slots) ·
`Q` queue overflow rug · `k` keep-clear · `-` rope/planter line · `R` RAM column · `*` spawn · `M` Mailroom · `A` Archive ·
`E` Engine Room · `c` Café · `n` Nap Nook). Regenerated by `npm run walktimes -- --ascii` (LVL fix r1). Resolution is 1 m, so half-metre edges are rounded; the table wins:
```
     0         1         2         3         4
     012345678901234567890123456789012345678901
z00  aaaaaaaaaaaaaaLLLLLLLLLLLLLLMMMMMAAAAAAAAA
z01  aaaaaaaaaaaaaaLLLLLLLLLLLLLLMMMMMAAAAAAAAA
z02  11111sss444444LLLLLLLLLLLLLLMMMMMAAAAAAAAA
z03  11111sss444444LLLLLLLLLLLLLLMMMMMAAAAAAAAA
z04  11111sss444444LLLLLLLLLLLLLLMMMMMAAAAAAAAA
z05  11111sss444444LLLLLLLLLLLLLLMMMMMAAAAAAAAA
z06  11111sss444444LLLLLLLLLLLLLLMMMMMAAAAAAAAA
z07  11111sss444444.@..........==MMMMMAAAAAAAAA
z08  22222sss555555@@@.........==MMMMMAAAAAAAAA
z09  22222sss555555.@..........//MMMMMAAAAAAAAA
z10  22222sss555555.....:::....//MMMMMAAAAAAAAA
z11  22222sss555555...::ooo::..//EEEEEEEEEEEEEE
z12  22222sss555555...:ooooo:..//EEEEEEEEEEEEEE
z13  22222sss555555...:oo#oo:..//EEEEEEEEEEEEEE
z14  22222sss555555...:oo#oo:..//EEEEEEEEEEEEEE
z15  33333sss666666...:ooooo:..//EEEEEEEEEEEEEE
z16  33333sss666666...::ooo::..//EEEEEEEEEEEEEE
z17  33333sss666666kk...:::......EEEEEEEEEEEEEE
z18  33333sss666666kkQQkkkkk.....EEEEEEEEEEEEEE
z19  33333sss666666qqqqkkkkk.....EEEEEEEEEEEEEE
z20  33333sss666666qHHHkkkkk-kkk-ccccccccccnnnn
z21  pppppppppppppp,,,,kkkkkRkkk,ccccccccccnnnn
z22  pppppppppppppp,hhhkkkkk,,,,,ccccccccccnnnn
z23  pppppppppppppp,,,,,,,,,,,,,,cccccccccccccc
z24  WWWWWWWBBBBBBB,,,,,,,,,,,,,,cccccccccccccc
z25  WWWWWWWBBBBBBB,,,,,,,,,,,,,,cccccccccccccc
z26  WWWWWWWBBBBBBB,,,,,,*,,,,,,,cccccccccccccc
z27  WWWWWWWBBBBBBB,,,,,,,,,,,,,,cccccccccccccc
```

### 7.1 Zones, heights, doors
| Code | Zone | Plan rect | Floor / ceiling (m) | Purpose |
|---|---|---|---|---|
| LOB | Lobby, Help Desk, spawn | 14,21→28,28 | 0 / 3.4 | Spawn (20.5,26.5) → world (0,0,12.5), yaw **0.22** (12.6° left: the whole queue + overflow ≤ 30° off the view axis, LVL fix r2). **Teller-window Help Desk:** counter x15–17.5, z20.9–21.5 (0.62 m high, LVL fix r2; set into the z21 rope line; the queue stands on a 0.15 m dais), STAFF mat x15–17.5, z21.6–22.6 on the lobby side; the queue waits on the atrium side (ATR row). RAM column (23.2,21.3); coffee cart (27.2,21.45), 2 coffee slots on its south side; floor medallion (20.5,24.35) flanked by 2 flower boxes (x17.15/23.85, z24.6; LVL fix r2: out of the spawn→queue sightline); fish tank (26.5,27.2); entrance x19–22 @ z28 |
| PIT | The Pit | circle c(20.5,14), r 4.0 | steps at r 4.0/3.4/2.8 → −0.15/−0.3/−0.45 | Unacked done agents; sofa ring r 2.0–2.6 (gaps N,S; six 1.8 m two-seaters, 12 seats every 24°, ≥ 0.95 m apart, LVL fix r2); hearth r 0.7; Big Board overhead y 3.3–4.7. Reads as sunken: dark risers #4B443D, light nosing strip #D8CBB4 on each step edge, darker treads toward the floor |
| ATR | Atrium | 14,7→28,21 minus pit | 0 / **5.5** | Circulation, skylight 6×6, slide exit (NW), stairs (E). **Queue lane** (LVL fix r2) rows x14.65–18.4, z19.0–20.9 + row C x15.55–17.55, z18.1–19.0: roped (stanchions, see-through), slate-teal mat, 10 slots serpentine at **1.0 m** pitch (4 columns x15.05–18.05 × rows z20.5/19.5, 2 cells at z18.5), head at the teller window (16.05, 20.5), entry cell (18.05, 18.5) at the NE corner off the main corridor; exact slots `POINTS.queue[0..9]`, ropes `layout.queueRopes`. **Overflow rug** x15.2–17.7, z16.95–18.0 (6 spots ≥ 0.95 m apart, z17.5/16.55). Ping-pong table in the NE pocket (25.0, 10.6, N–S); a 3rd arcade cabinet on the Library's west pier (19.95, 7.4) |
| LIB | Library (under the mezzanine) | 14,0→28,7 | 0 / 2.6 | read/search station; tea trolley (16.0,5.1) with 2 coffee slots (the E1/E2 idle coffee pick); arches onto the atrium at z7; **side door from the Reading Alley** (x14, z0.3–1.7) and a **private back door from E1** |
| MEZ | Mezzanine | 14,0→28,7 + landing 26,7→28,9.5 | 2.9 / 2.6 | Round Table (x14–21), Observatory (x21–28), hot desks on the rail (z6.6) |
| NAL | Reading Alley | 0,0→14,2 | 0 / 2.8 | Book carts, benches; links Studio Street and W1/E1 to the Library |
| STR | Studio Street | 5,2→8,21 | 0 / **3.4** | 3 m wide (1.4–2 m lane + storefront stoops). Storefronts, string lights, banners, street lamps in rollup colour |
| BAY | W1–W3 (x0–5), E1–E3 (x8–14); z 2–8 / 8–15 / 15–21 | e.g. E2 8,8→14,15 | 0 / **2.8** | One workspace each, ≤ 6 desks + 1 nap spot. **E bays have a glazed back wall onto the atrium** (ribbon glass above a 0.12 m sill, rollup neon visible; the screens-to-glass desk column is listed first so the desks seen from spawn fill first) and a private back door |
| PLZ | Plaza | 0,21→14,23.5 | 0 / 3.0 | Street ↔ Lobby junction; phone booths (mcp); map signpost (unknown agents) |
| WAR | War Room | 0,23.5→6.5,28 | 0 / 2.8 | todo/think station; whiteboards render real todos |
| LAB | Lab (**moved next to the Lobby**) | 6.5,23.5→14,28 | 0 / 2.8 | test/build station; doors to the Lobby and the Plaza |
| MAIL | Mailroom (swapped with the Lab) | 28,0→33,11 | 0 / 2.8 | git station (rare); **OUTBOX chute** for sign-off parcel runs (every done → acked, §6.4); pneumatic capsule tube terminus (commits); door from the atrium under the stair landing |
| ARC | Archive | 33,0→42,11 | 0 / 2.8 | Disk stats; chill/hobby picks: microfiche reader, filing nook (armchair + lamp pool), vault-door nap corner (§6.4.1) |
| ENG | Engine Room | 28,11→42,20 | **+0.25** / 3.0 | Shell benches; CPU/GPU/temps/net stats; glass partition to the atrium |
| CAF | Café, Arcade, Nap Nook | 28,20→42,28 (Nap Nook 38,20→42,23) | 0 / 2.8 | Idle loop, bunks |
| OUT | Outside | — | — | North: layered skyline cards; south: garden cards; §7.3 |

**Doors** (1.7 m high, 1.4 m wide unless noted; `x=`/`z=` is the wall line):
- Entrance: z28, x19–22 (3 m sliding glass). LOB↔ATR along z21: rope line + 0.45 m planters (see-through; sightlines
  unchanged) with the teller counter at x15–17.5 and **openings x18.5–22.5 (main, spawn→Pit axis) and x24.5–26.5**.
  LOB↔PLZ: open, x14, z21–23.5.
- LOB↔LAB: x14, z25–26.4. PLZ↔LAB: z23.5, x9–10.4. PLZ↔WAR: z23.5, x2.5–3.9. LOB↔CAF: x28, z23–26 (3 m).
- STR↔PLZ: open at z21. STR↔NAL: open at z2. NAL↔LIB: x14, z0.3–1.7. LIB↔ATR: arches at z7, x16–19.5 and x21.5–25.
- Bays↔STR: 2.4 m storefront openings centred on each bay's street face.
- **Private back doors** (owners + player only; nav cost ∞ for others): E1↔LIB x14 z3–4.4; E2↔ATR x14 z11–12.4;
  E3↔ATR x14 z17–18.4.
- **Keep-clear rects** (`KEEP_CLEAR` in `hq.js`; no slot, overflow spot, prop or queue member may occupy them; nav
  treats them as walkable): E3 back-door apron x14→15.8, z16.6→19.0; main LOB↔ATR corridor x18.5→22.5, z18.3→23.0;
  east opening x24.5→26.5, z20→22; teller-window approach x15→17.5, z20.9→21.0 (head slot only); every door ±0.8 m
  deep across its width. The queue lane's rope footprint is `solid` for everyone except queue members.
- **Nav invariant (M1.5 gate, `layout.test.js`):** with all 10 lane slots + 6 overflow spots occupied (as static
  obstacles), every door is reachable from spawn and from every bay desk, and spawn → Pit south gap path length grows
  by ≤ 10%.
- ATR↔MAIL: x28, z7.2–8.6 (under the landing; clearance 2.6 m). MAIL↔ARC: x33, z4–5.4.
- ATR↔ENG: x28, z17.5–19 (+0.25 step). ENG↔ARC: z11, x37–38.4. ENG↔CAF: z20, x33–34.4.

**Vertical:**
- **Stairs** along the atrium east edge, x26.3–28, from z16.5 (y 0) north to z9.5 (y 2.9): a 7 m run at 0.41, drawn as open
  risers (the ENG glass stays visible), walked as a ramp. Landing x26–28, z7–9.5 joins the mezzanine.
- **Slide** (one-way down): helix around (16.3, 8.4), r 0.9, 1.25 turns, from the mezzanine mouth (16.3, 7.0, y 2.9) to an
  exit at (17.3, 9.6) facing south-east (next to the E2 back door: "slide home").
- **`floorY`** is analytic: pit rings, ENG rect +0.25, stairs `2.9·(16.5 − z)/7`, mezzanine/landing 2.9 when `level==1`.
  Auto-step ≤ 0.3 m. The player is a circle of radius 0.28 on the grid, with per-axis slide. Jump v0 4.2 m/s at g 12.

**Sightlines (checked at the M1.5 gate and in §9.2):**
- `spawn` (FOV 60°, horizontal ≈ 91°): Help Desk + queue left-front, RAM column right, the Pit and Big Board ahead, the
  **E-bay glazing** (≈ 24° left) with working agents' monitors, the library arches and mezzanine rail beyond.
- `pitOverview`: ENG LEDs through the glass east, stairs, slide, E-bay glazing west, Lobby south.
- `mezzToPit`: Big Board face STATES, the whole atrium floor, the queue.

**Density.** Circulation lanes 1.4–2.0 m (atrium ring ≤ 2.5 m; `hq.js` `LANES`: the ring is an annulus r 4.0–6.3 around the Pit, rect lanes ≤ 2.0 m across, asserted in `layout.test.js`; `walktimes` prints any patch). Outside lanes, no empty floor patch larger than
2.5 × 2.5 m; ≥ 1 prop cluster per 4 m² of non-circulation floor; every zone has one signature prop and ≥ 3 small
"story" props (mugs, plants, notes, boxes). ENV reports per-cell prop counts in `__hq.stats().props`.

- **`layout/hq.js` is the single source of truth.** It exports `ZONES`, `WALLS` (kind: wall, glass, storefront, rail, lintel),
  `DOORS` (with `private: wsSlot`), `FURNITURE` (instanced type + footprint + `solid`), `SLOTS`, `STATIONS`, `BAYS`,
  `AMENITIES`, `WINDOWS` (gobo rects), `STAT_ANCHORS`, `POINTS` (`spawn`, `helpDesk`, `staffMat`, `queue[]`, `pitSeats[]`, …),
  `VIS` (cell visibility) and `LEVELS`.
  - `layout/proto.js` exports the same schema for the M1 room. **It seats 12 (D7):** ≈ 12 × 9 m, 12 desk `SLOTS` as
    3 pods of 4 (2 × 2 facing), a 3-seat sofa corner, a help counter and a window with sky. BRN assigns desks by pod =
    `workspace.slot mod 3`, then the first free desk in that pod, else the first free desk anywhere (stable across
    reconnects and windows). The minimap is baked from the layout.
- **Build (ENV):** static geometry merged per zone cell per material; bevels via `RoundedBoxGeometry`; baked vertex AO in
  seams and corners; furniture instanced per type with ±4% lightness jitter; glass is one unsorted layer. **All
  furniture and small props come from the prop kit (§7.5)**; a zone file only places kit items and its one bespoke
  signature prop.

### 7.2 Amenity bays (no "FOR LEASE" storefronts)
Bays not allocated to a workspace are amenities the idle ladder uses (§6.4.1). Default dressing by slot (filled last
first, so with ≤ 3 workspaces all W bays are amenities): **W1 Music Room** (piano, guitar, a record player), **W2 Gym**
(tiny treadmill, dumbbells, yoga mats), **W3 Greenhouse** (planters, watering can, sun lamp), **E1 Game Room** (board
games, beanbags), **E2 Art Studio** (easels that paint the agent's favourite colour), **E3 Nap Lounge** (hammocks).
- When a workspace needs an amenity bay: "moving day" (crates roll out, the sign flips to `#n label`) over 3 s.
- Amenity storefront signs are diegetic too ("MUSIC ROOM · 2 inside").

### 7.3 Exterior (no box city)
- **North (skyline):** drawn in the `sky` shader as **3 layered, flat, fogged silhouette cards** (rounded rooftops, water
  towers, a crane, antennae), each 1 value step closer to `skyHorizon` with distance; a few warm lit-window dots at night
  (hash-placed). **Never lit instanced boxes.** The radio mast is the only 3D element above the roofline.
- **South (garden):** 2 hill cards, a row of rounded tree-blob cards, a pond plane with sky reflection fake.
- **West:** canal card; **East:** hills. Clouds: 3 fbm bands, slow drift. Sun and moon follow the real clock.

### 7.4 Diegetic stats (STAT), per GP §4
Every stats object has a readable number plaque, legible at 4 m.
- Readouts use dot-matrix shader text, or a canvas at ≤ 2 Hz.
- Aiming at an object (≤ 8 m) shows a tooltip with the value, a 5-minute sparkline and its source.
- Critical thresholds turn red and pulse.

| Stat | Object | Location (plan) |
|---|---|---|
| CPU per thread | 16-column LED rack wall | ENG east wall, x41.8, z11.5–19.5 |
| CPU total, load | Boiler gauge (1 m dial) + atrium ceiling fans ∝ load | ENG glass (28, 13, y 2.0), faces the Pit |
| RAM | Lava column (used + cache) + swap bucket | LOB (25.5, 23.5), visible from spawn |
| Disk | Filing-drawer wall per mount | ARC north wall |
| Disk I/O | Microfiche reader | ARC |
| NVMe temp | Thermometer on the vault door | ARC |
| GPU busy | Hamster wheel (mini Clawd runs) | ENG (39.5, 12.5) |
| VRAM | Arcade HI-SCORE bar | CAF arcade (30, 21) |
| CPU temp | Thermostat + heat shimmer over racks (+ the cat moves to the hottest rack) | ENG |
| Network | Radio mast rings (roof, seen from MEZ and outside) + light pulses running along a ceiling cable tray (rx blue in, tx amber out). **Not capsules** (capsule = commit, §6.7) | MEZ, ATR |
| Uptime | "DAYS SINCE LAST REBOOT" flip sign | ENG door |
| Clock / date | Wall clock over the entrance + sun and sky | LOB, global |
| Macro stress (weather) | CPU temp or load > 80% for 30 s → heat-shimmer + haze on the skyline cards seen through windows; swap in use > 25% → the skylight fogs from the edges; both fade over 20 s (M3) | exterior, ATR skylight |
| Summary | **Big Board** over the Pit, 4 faces (+ the transient WHILE YOU WERE AWAY face, §6.4.5): STATES (counts **and names** per state, incl. `done ✓`, so W-bay agents are covered for P1) / MACHINE / WORKSPACES / CLOCK. Rotates 90° every 20 s; stops when looked at; the STATES face starts toward spawn | PIT |

---

### 7.5 ENV prop kit (`world/build/kit/*.js`): the anti-box-city contract
Procedural primitives at this breadth are the biggest "cheap / box city" risk (the old project's failure). Every
furniture item and small prop is a **parametric builder** `build<Name>(params, rng) → {parts:[{geometry, slot}],
footprint, solid, anchors}` with these global rules:
- **No raw boxes.** Every visible edge within 6 m is bevelled (radius ≥ the row's value; `RoundedBoxGeometry`, lathe
  or extruded rounded `Shape`). Legs taper; tops overhang; nothing is a unit cube scaled.
- **3-colour rule.** ≤ 3 palette tokens per prop: *body*, *secondary*, *accent* (accent ≤ 15% of area), as vertex
  colours into `toonProp` (no new programs). Colours come from the zone's value map (§5.5); **no clay-hued body within
  1.5 m of a Clawd seat/desk** (warm-on-warm rule).
- **Hero detail.** Each builder has one silhouette-breaking detail (column below) that survives the silhouette render
  at 4 m. Seeded variation: size ±8%, one of 2–3 story variants (a mug left on it, a sticky note, a lean).
- **Budgets:** ≤ 1.5k tris per kit item (hero/signature props ≤ 6k), baked vertex AO in crevices, instanced per
  builder+variant.

| # | Builder | Bevel r (m) | Body / secondary / accent | Hero detail |
|---|---|---|---|---|
| 1 | `desk` (w, d, drawers) | 0.02 | oak / ink2 legs / brass | tapered legs with toe caps, round drawer knobs, cable grommet |
| 2 | `deskChair` (swivel) | 0.03 | teal or sage fabric / ink2 / butter piping | 5-star base with ball casters, seat piping |
| 3 | `stool` (bar/lab) | 0.02 | oak / ink2 / brass | footring |
| 4 | `sofa` (2–3 seats, arm style) | 0.06 | sage/teal fabric / oak feet / cream piping | roll arms, button tufts, peg feet |
| 5 | `armchair` | 0.06 | lavender or teal / walnut / cream | wingback ears + piping |
| 6 | `beanbag` | lathe blob | fabric / — / cream | pinched top + seam line, squash dent |
| 7 | `table` (round café, coffee, meeting) | 0.02 | oak / ink2 / cream | pedestal with flared foot |
| 8 | `counter` (bar, Help Desk, lab bench) | 0.03 | walnut / cream top / brass | foot rail + top overhang lip |
| 9 | `shelf` (w, h, fill) | 0.015 | walnut / book spines / brass | crown moulding, leaning books, bookends |
| 10 | `book` / `bookStack` | 0.005 | spine tokens / cream page block / ink | visible page block, tilt |
| 11 | `plant` family: bush, monstera, fern, cactus, pothos (hanging), tree-in-tub | pot 0.02 | sage→moss foliage / pot oat, teal or cream glaze / rim band | leaf silhouettes (notched monstera, trailing pothos), pot lip + saucer |
| 12 | `lamp` family: desk arm, floor arc, pendant, street lamp, string span | 0.01 | shade butter or cream / ink2 / brass | knuckled arm, conical shade with rim, visible bulb (emissive 1.8) |
| 13 | `monitor` (size) | 0.012 | ink2 / screen / status strip | round-foot stand, bezel chin, back cable |
| 14 | `keyboard` + `mouse` | 0.005 | oat / ink / cream keys | key-grid relief (pattern), coiled cable |
| 15 | `mug` | lathe | cream, teal or workspace jewel / — / trim | torus handle, steam anchor |
| 16 | `crate` | 0.02 | oak / ink2 straps / stencil | slats + corner brackets |
| 17 | `box` (cardboard) | 0.01 | kraft oat / tape / ink | tape strip, one open flap |
| 18 | `rug` (round, rect, runner) | edge roll 0.01 | zone tokens / border / accent stripe | fringe tassels or bound border |
| 19 | `stanchion` + rope | lathe | brass / ink2 / teal rope | ball top, weighted base, sagging rope catenary |
| 20 | `whiteboard` | 0.015 | `#EDE6DA` / ink2 frame / marker colours | marker tray with markers, casters |
| 21 | `corkboard` | 0.015 | cork / oak frame / paper notes | pinned notes + pushpins (offset quads) |
| 22 | `filingCabinet` (drawers) | 0.015 | oat steel / ink2 / brass | cup handles + label holders |
| 23 | `rack` (server) | 0.01 | ink / tealDeep / LEDs | vent grilles, LED rows (STAT drives them) |
| 24 | `coatRack` / umbrella stand | lathe | walnut / brass / — | ball-ended hooks, a hung scarf |
| 25 | `waterCooler` | 0.02 | cream / teal bottle / ink | bottle dome + cup dispenser |
| 26 | `bin` (paper basket) | lathe | teal or oat / — / paper | crumpled paper balls |
| 27 | `sign` / `plaque` | 0.01 | cream / ink / workspace jewel | stand-off bolts, rounded corners |
| 28 | `pipe` / `radiator` / `vent` (architecture dressing) | 0.01 | oat / ink2 / brass valve | fins, valve wheel, elbows |
| 29 | `planter` (rope-line / street) | 0.03 | teal or oat / moss / cream rim | overflowing foliage lip |
| 30 | `cushion` / `throw` | 0.04 | rose, sage or lavender / cream / — | corner pinch, fold |

Signature props (Big Board, espresso bar, arcade cabinet, piano, telescope, boiler, hamster wheel, vault door, slide)
are bespoke per zone but follow the same three rules. **`?sheet=props`** (`debug/propSheet.js`) lays out every kit item
and variant on the hero-sheet cyc at 2 m and 6 m with the final post stack, plus a silhouette pass; it is part of the
M1.75 gate (§11).

## 8. UI (UI) — DOM overlay, ART §9 visual language

> **Visual language: [`docs/design/ui-kit.md`](design/ui-kit.md) (normative).** Every DOM surface is built from that one kit ("Workshop Signage": the board is for scanning, paper is for deciding, and status is shown by lamps, not pills), with components in `renderer/src/ui/kit/`. The mockup is `renderer/ui-lab/final.html`. Where the table below names a visual (chips, pills, pinned Inbox card, "state chip", badges, "segmented control"), read it as the kit component in ui-kit.md §7. The behaviour, keys and placement stated here still hold.

| Element | Placement | Behaviour |
|---|---|---|
| **Roster** | **Left** overlay, 360 px. `Tab` toggles from any world scope, with or without pointer lock | Group-by **segmented control** in the header: State (blocked first, pinned) · Workspace · Tab (headers `workspace › tab`, since tab labels like `claude` repeat) · Project · **Directory** (full `cwd`, nested under its repo root: `claude-hq › server/`) · Kind · Tool (`Alt+1..7`). Collapsed groups and the empty state ("No agents match · clear filters") are remembered **per group-by mode** (localStorage). Search, state filter chips, "Shells" toggle, `+ Shell` (gated). A pinned **Blocked Inbox** card when anything is blocked. **Pinned** section on top (favourites, `P` on a row; up to 9, fixed mapping: `1–9` in world and roster scopes, Leader `1–9` in xterm; persisted per session **by stable identity**, §8.10). Rows: portrait, name, `◆` if focused in herdr, workspace chip, state chip + elapsed (`done · signed off in HQ` when acked), `tool · detail`, title, context meter, **unread dot/count** (meaningful signals only, §8.9), sticky-note glyph + text on hover (§8.10), elapsed chip with an **age heat tint** (§8.7 "needs you" order), buttons `>_ open` `⌖ go to` `◉ follow` `✓ sign off` (done) `↩ answer` (blocked). **Compact mode** (toggle in header, `Alt+C`): one-line 28 px rows. Sort within group: **"needs you" first** (blocked by age, then `struggle.level`, then done-unacked by age), then by the header's sort (recent activity / name / elapsed). ARIA and focus: §8.11. Hovering a workspace group lights that bay's banner in-world. Keys, selection and reorder rules in §8.7 |
| **Terminal drawer** | **Right** sheet, 50% width (resizable 35–80%); Leader `Z` fullscreen; layout rules §8.2.1 | Tabs (≤ 6, LRU) with portrait + **state chip (text-less shape + colour, `aria-label` = state; §8.11)** + unread dot (§8.9). Header: workspace › tab › pane, cwd, mode badge (Peek / Control), `◆ in herdr` badge, **always-visible blocked counter** `● 2 blocked · Leader B` (hidden at 0; pulses on a new block; click = next blocked terminal), buttons **Mark seen in herdr** (done only) · **Focus in herdr** · **Release** · **Copy recent** · **Close pane** (confirm, gated) · **Why?** (`agent.explain`, M3). xterm 6 with fit, webgl (≤ 2 live) and unicode11 addons; theme from ART §9.3. Keys §8.2, lifecycle §8.4, behaviour §8.5, clipboard §8.6 |
| **Status card** | Bottom-right, when aiming at an agent within 6 m or when one is selected | Name, kind, emblem, status + time, ws·tab·project, title, `tool: detail`, context bar, subagents, lastPrompt (2 lines), todos (top 3), blocked question + options (buttons; world `Alt+1–9` only with `quickAnswer`, always via the Enter confirm, §4.8), sticky note (§8.10), key hints (`[E] terminal [G] high-five/sign off [F] follow`) |
| **Blocked Inbox** | `B`; also the pinned roster card | Serve-card stack (§8.8, same component as §6.8.1) |
| **HUD** | Top-centre state pills (`● 3 working ● 1 blocked …`, clickable filters). Centre crosshair with an interact hint. Bottom-left minimap (180 px, `M` = overview). Toasts stack above the minimap; **while the drawer is focused or fullscreen, toasts render in the drawer's own layer** (top-right inside the drawer), so they are never behind it. Edge chevrons for off-screen blocked agents. Session badge top-left (`hqtest`/`DEMO`/`default`). M4: control-group hotbar with portraits along the bottom | |
| **Command palette** | `Ctrl+K` (or `/` in world scopes), a centred paper card | Agents (open/go/follow/sign off), zones (glide), actions (quality, time, photo, settings, spawn shell, "sign off all done") |
| **Bubbles & nameplates** | In-world (FX) | ART §8. At most 8 full bubbles. Priority: blocked > selected > hovered > nearest working. Screen-space collision nudging. Nameplates within 6 m, on hover and always for blocked agents |
| **Notifications** | On → blocked | The 7 channels from GP §5.4 (chime, spatial ding, toast with `[B] inbox`, chevron, minimap pulse, beacon, `document.title` badge / Electron badge / OS notification when unfocused). Driven by store events (§3.4), so they fire in hidden tabs. Rate limit 1 per agent per 10 s; mute toggle |
| **Help / onboarding / settings** | `H`/`F1` overlay; **`?`** (and Leader `?`) = key overlay | Ada-led 5-card first-run coach (localStorage flag). The `?` overlay shows the **current scope's** key table (world / roster / serve / xterm-leader), generated from `keymap.js` + `platform.js`, so it can never drift. Settings: volumes, quality, FOV, `quickAnswer`, `autoAckOnOpen`, `pasteConfirmLines`, `copyOnSelect` (default **on**), `termFontPx`, `scrollMode`, escape leader key, `allowMutations` (server-side), reduced motion, `headBob`, `awayRecapMin`, `peekCtrlCConfirm` (default on) |
| **Offline** | | A "herdr offline" banner with retry and the `--demo` hint. Lights at 40%; agents doze. Open terminals go to `offline` (§8.4) |

"Go to" is an eased glide along the nav path (400–900 ms), ending 1.8 m from the agent, facing it.

### 8.1 Frame loop order (`renderer/src/main.js`)
1. `player.update` (camera, aim)
2. `cull` (vis cell)
3. `director.update` / `actors.update` (brain → motor → animator), reading the store (already applied, §3.4)
4. `charBatch.write`
5. `world.update` (stats objects, ambient, time of day, zone grade)
6. `fx.update` (bubbles, plates, particles, rings, glyphs)
7. `ui.update` (DOM, ≤ 10 Hz, except the crosshair)
8. `post.render`

Modules get a shared `ctx = {dt, time, now, frame, scene, camera, renderer, store, player, camZone, visibleCells, perf,
quality, bus}`. There is no per-frame allocation in `update` paths. Nothing that must happen while the tab is hidden
(notifications, terminal bytes, store updates) lives in the frame loop.

### 8.2 Keymap (`src/ui/keymap.js`; one table, per focus scope)
Exactly one scope is active: the focused DOM element decides (xterm, text input, roster list, palette, serve card),
otherwise world-locked / world-unlocked by pointer-lock state. Keys not listed pass through to the browser default.
`Ctrl` below means **Primary** on Linux/Windows; the macOS mapping is §8.2.2.

| Key | world-locked | world-unlocked | roster list | palette / search input | serve | xterm |
|---|---|---|---|---|---|---|
| WASD | move | move | **nothing** (W/D unbound; A and S are row actions below) | types | W/S move highlight | → pane (Control); Peek: see §8.4 |
| Arrows, `j`/`k` | move (arrows) | move (arrows) | ↑↓ or `j`/`k` select; ←/→ on a group header collapse/expand, on a row ← = jump to its header | ↑↓ results (letters type); ↓ from roster search → list | ↑↓ move highlight | → pane (Control); Peek: swallowed + hint (§8.4) |
| Mouse | look | cursor, click = lock / pick | hover freezes order | — | damped look | → pane (selection) |
| Tab | roster (exits lock, focuses list) | roster | close roster → world | roster search: **→ list** (initial-selection rule, §8.7); palette/settings: next field | — | → pane (Control); Peek: swallowed |
| Enter | **focus last terminal tab** (reopens/expands the drawer); **no tab yet / last closed → open the oldest blocked agent's terminal, else open the roster with the list focused** | same | open terminal (roster closes unless pinned open) | default action (open) | choose / confirm | → pane (in Peek: promotes, §8.4) |
| Shift+Enter / Ctrl+Enter | drawer collapse ↔ expand / — | same | **go to** / **follow** (aliases of G / F) | go to / follow | — | → pane |
| Esc | (browser releases lock) | clear selection | close roster | clear, then close | back / leave Serve | Control: → pane. **Peek: never reaches the pane or promotes; returns focus to the world (docked-unfocused); a second Esc collapses the drawer** |
| E | interact / open terminal | same on hovered | — | types | choose | → pane |
| G | high-five / sign off (§6.9) | same on hovered | **go to** (glide) | types | — | → pane |
| F | follow | same | **follow** | types | — | → pane |
| S | — | — | **sign off** (done rows) | types | — | → pane |
| A | — | — | **answer**: opens the Serve card for this row (blocked rows) | types | — | → pane |
| P | photo | photo | **pin / unpin** row | types | — | → pane |
| Q / R / T / V | pat / summon / plane (M4) / peek (hold, M3) | same | — | types | — | → pane |
| B | Blocked Inbox | Blocked Inbox | — | types | — | → pane |
| `/` | palette | palette | **focus the search field** (type-to-filter) | — | — | → pane |
| PgUp/PgDn, `[` / `]` | — | — | previous / next group header | — | — | → pane |
| Home / End | — | — | first / last row | — | — | → pane |
| 1–9 | pinned agent 1–9 → open terminal (**always**; never depends on aim) | same | open pinned 1–9 | types | jump to option | → pane |
| Alt+1–9 | quick-answer the aimed blocked agent → one-line Serve confirm, `Enter` sends (only with `quickAnswer`, §4.8) | same on hovered | — | — | — | → pane |
| Shift+1–9 | pin the aimed/hovered agent to slot n (pins replace v2's M4 control groups) | same | pin selected row to slot n | types | — | → pane |
| Alt+1–7 | — | — | group-by (roster scope only; world Alt+digits = quick-answer) | — | — | → pane |
| N | sticky note on the aimed agent (§8.10) | same on hovered | sticky note on the row | types | — | → pane |
| Shift | sprint (hold, §6.10) | same | — | — | — | → pane |
| Alt+C | — | — | compact rows toggle | — | — | → pane |
| Ctrl+K | palette | palette | palette | — | — | → pane |
| M / H, F1 / F3 / `?` | map / help / perf / key overlay | same | `?` key overlay | types | `?` | → pane |
| **Leader** (`Ctrl+`` `, alt `F9`) | **focus last terminal tab** (same fallback as Enter) | same | same | same | — | see below |

**Inside xterm in Control mode every key goes to the pane** (Esc, Esc Esc, Tab, `/`, digits, letters, Ctrl+K, …) except
the leader and, on macOS, Cmd chords (§8.2.2). **In Peek mode only printable input, Enter, paste and Leader `I` promote;
Esc returns to the world and everything else is swallowed with a hint (§8.4).** Implemented with xterm
`attachCustomKeyEventHandler` (return false + `preventDefault`).

**Leader timing (no timeout trap).** Leader keydown enters *pending*; a HUD chip "Leader ▸" shows. The chord key is the
next keydown **while Leader is held or ≤ 400 ms after Leader's keydown**, matched by `event.code`. Leader **released with
no chord** → acts immediately on keyup (focus the world if in xterm; focus the last terminal if in the world), no wait.
Any key not in the chord table ends *pending* and is handled by the now-current scope, so a Leader tap followed by `W`
walks. **The chord table is disjoint from every world key** (W A S D E G F Q R T V B P M H N, Space, Shift, arrows,
Tab, Enter, Esc) and from letters whose Ctrl-chord the browser eats (W T N) when Ctrl is still held:

| Leader + | Action |
|---|---|
| `,` / `.` | previous / next tab |
| `X` | close tab (Leader Shift+X closes all but active) |
| `U` | next blocked terminal ("urgent"; opens its tab) |
| `1–9` | pinned agent 1–9 (same meaning as world `1–9`) |
| `Z` | fullscreen ("zoom") |
| `I` | Peek ↔ Control (explicit promote / release) |
| `L` | roster (overlay while fullscreen) |
| `K` | palette |
| `C` | copy recent output |
| `Y` | paste via the clipboard API ("yank", §8.6) |
| `[` | history overlay (§8.6) |
| `+` / `-` / `0` | terminal font size (§8.5) |
| `J` | recent HQ actions ("journal") |
| `?` | key overlay |
| `;` then a letter | send Ctrl+letter literally (browser-reserved chords) |
| Leader again | literal Ctrl+`` ` `` |

`keymap.test.js` asserts the disjointness (chord codes ∩ world codes = ∅) on both platforms. The leader and alternate
are settings (for keyboard layouts where `` ` `` is a dead key).

**Roster search** matches, case-insensitively and fuzzy per token: name, title, project, cwd, workspace label, tab label,
`activity.detail`, `lastPrompt`, kind, status. Filter tokens: `is:blocked|working|idle|done|shell`, `ws:<label>`,
`tab:<label>`, `kind:<kind>`, **`cwd:<substring>`** (matched against the full cwd, `~`-abbreviated), **`project:<name>`**,
`has:note`, `is:unread`. `↓`/`Enter`/`Tab` in the field moves to the first result.

#### 8.2.1 Focus & layout model (drawer ↔ world ↔ roster)
| Drawer state | Looks like | Enter it by | World input |
|---|---|---|---|
| closed | — | Leader X on the last tab | full |
| docked-focused | right sheet, header bright, xterm has focus | open a terminal; Enter/Leader in world; click in xterm | none (xterm scope) |
| docked-unfocused | same sheet, header dimmed, "Leader or Enter to type" hint | **Leader tap** from xterm; **Esc in Peek**; click in the world | **full, on the left part**; pointer lock allowed; loop ≤ 30 fps |
| collapsed | 28 px edge rail: tab portraits + state chips + unread + blocked counter | Shift+Enter in world; Esc Esc in Peek; drawer header `⟩` button | full width |
| fullscreen | covers everything; HUD hidden except the drawer's own blocked counter and toasts | Leader Z | none |

- Getting back to an open terminal is **one key** from any world scope: `Enter` or Leader → the last active tab,
  expanding a collapsed drawer and focusing xterm (< 100 ms; no re-aim, no roster).
- **Enter on a roster row opens the terminal and closes the roster**, unless the roster's pin toggle (header pin icon, drawn
  in code) is on; then it stays and focus moves to xterm.
- **Roster + drawer together** (allowed). Widths: roster `R` = 360 px (300 compact); drawer `D = clamp(pct·W, 480,
  W − R − 240)`; the world keeps ≥ 240 px. If `pct·W` doesn't fit, the roster collapses to a 64 px **icon rail**
  (portraits + status dots, still keyboard-navigable) and the drawer gets `min(pct·W, W − 64 − 240)`. At 1366 px:
  50% drawer → roster 360 + drawer 683 + world 323; 80% drawer → rail 64 + drawer 1062 + world 240.
- In fullscreen, Leader L shows the roster as a 360 px overlay on the drawer (list focused); Enter switches tab and
  hides it.

#### 8.2.2 Client platform (`ui/platform.js`)
The browser runs on the user's *client* (maybe a Mac over `ssh -L`), not on the headless box. `platform.mac =
/Mac/.test(navigator.userAgentData?.platform ?? navigator.platform)`; overridable in settings.

| Action | Linux / Windows | macOS |
|---|---|---|
| Copy in xterm | Ctrl+Insert (guaranteed), Ctrl+Shift+C (best effort, §8.6), copy-on-select | **Cmd+C** (selection present), copy-on-select |
| Paste in xterm | Shift+Insert, Ctrl+Shift+V (native `paste` event) | **Cmd+V** (native `paste` event) |
| Interrupt | Ctrl+C → pane | **Ctrl+C → pane** (Cmd never reaches the pane) |
| Palette | Ctrl+K (world scopes) | **Cmd+K**, from world scopes *and* from inside xterm (Cmd chords are never pane input) |
| Leader | Ctrl+`` ` `` / F9 | **Ctrl+`` ` ``** (no clash with Cmd+`` ` `` window cycling) / F9 (fn+F9) |
| Font size | Leader + / − / 0 | **Cmd+= / Cmd+− / Cmd+0** inside xterm (preventDefault page zoom), and Leader + / − / 0 |
| Quick-answer | Alt+1–9 | **Ctrl+1–9** (Option+digit types characters on macOS layouts) |
| Option key | — | xterm `macOptionIsMeta: true` (Alt-word motions work) |
| Browser-reserved | Ctrl+W/T/N eaten → Leader `;` letter | Cmd+W/T/N are browser; **Ctrl+W/T/N reach the pane** (no Leader `;` needed) |

### 8.3 Browser- and OS-reserved keys
- **Electron:** `Menu.setApplicationMenu(null)` (no accelerators steal keys). A `before-input-event` handler in main only
  blocks reload (`Ctrl+R`, `F5`) and devtools outside `--dev`, and only when the renderer reports (IPC) that xterm is *not*
  focused; while xterm is focused every key reaches the page (so `Ctrl+R` reverse-search, `Ctrl+W` delete-word work).
- **Web mode (primary):** the page `preventDefault`s interceptable chords while xterm is focused (`Ctrl+R/L/F/D/S/P/U/K`,
  F-keys). Chrome never delivers `Ctrl+W/T/N`, `Ctrl+Shift+T/N/W`, `Ctrl+Tab`, `Ctrl+PgUp/PgDn`, `Ctrl+1–9` to a normal
  page. Mitigations:
  - Leader `Z` fullscreen → `document.documentElement.requestFullscreen()` + `navigator.keyboard.lock()` → those chords
    reach the pane (Chromium). Firefox has no keyboard lock: hint only.
  - Leader `; <letter>` sends them literally; the drawer footer shows a one-time hint: "Browser eats Ctrl+W/T/N: use
    Alt+Backspace to delete a word, Leader ; W for ^W, or fullscreen."
  - A `beforeunload` guard is active whenever any terminal tab is open.

### 8.4 Terminal drawer lifecycle (`ui/terminal/lifecycle.js`, driven by `term.state`)
| State | Shows | Input |
|---|---|---|
| `connecting` | Spinner over the blank/last frame | Buffered in the outbox |
| `live` (observe) | Badge **Peek**; hint "type or Leader I to take control" (+ resize chip, §8.5) | **Promotes only on** printable input, Enter, paste or Leader `I` → `term.promote`, the key held until control is live (≤ 150 ms). **Esc** → world (docked-unfocused), Esc Esc → collapse; never promotes, never reaches the pane. **Ctrl+C** → chip "Ctrl+C will interrupt scout — press again" (2 s window; the second Ctrl+C promotes and sends it). Arrows, Tab, Backspace, F-keys, other Ctrl/Alt chords → swallowed, hint flashes |
| `live` (control) | Badge **Control** | To pane (writer only; others see "Another HQ window is typing — Take the keyboard") |
| `busy` | Banner "Another terminal client (herdr attach) holds this pane." **Take over** (disconnects it) · **Peek** | Outbox |
| `taken` | Banner "Another client took control." **Reclaim** (explicit, never automatic) · stays in Peek meanwhile | Outbox |
| `released` | Idle demotion to Peek | As `live` observe (same promote rules) |
| `gone` | Tombstone: last frame dimmed, "Pane closed", **Close tab** | Disabled; outbox shown |
| `offline` | herdr offline banner, last frame dimmed | Outbox |
| `reconnecting` | Dimmed, spinner; auto re-`term.open` (same mode, never takeover) on WS reconnect; seamless within the 10 s grace (§4.7) | Outbox |
| `error` | Reason + **Retry** | Outbox |
| `readonly` | herdr protocol mismatch (§4.1): badge **Read-only**, Peek only | Disabled; outbox shown |

- **The outbox** (≤ 4 KB) is always visible as a chip ("12 chars pending · Send · Discard"). It auto-flushes only when a
  grace resume restores the same controller within 3 s; otherwise the user chooses. Typed input is never dropped
  silently.
- On WS reconnect the renderer re-issues `term.open` for every open tab (mode as before), then `term.promote` only if it
  was control and the user types again.

### 8.5 Drawer behaviour
- **Open latency:** on E / Enter / B / palette / deep link, create (or reuse) the xterm, send `term.open` and **focus the
  xterm immediately**; frames that arrive are written as they come. Target **< 150 ms keypress → focused xterm**. Only E
  in the world plays the 300 ms camera dolly, **in parallel**; no dolly from roster/palette/inbox/deep link; no white flash
  under reduced motion.
- **One settled-fit path (`ui/terminal/fit.js`).** Every layout change that can alter the fitted grid — window resize,
  fullscreen toggle, drawer drag, roster open/close/rail, drawer collapse/expand, tab switch, font-size change, DPR
  change (`matchMedia('(resolution: Xdppx)')`), Electron window moving between displays (`screen` `display-metrics-changed`
  → IPC) — calls `fit.invalidate(reason)`. 150 ms after the last invalidation, `fit.settled(cols, rows, reason)` fires
  once. Nothing else computes cols/rows. What `settled` does depends on the mode:

  | Mode | On `settled` |
  |---|---|
  | observe | send `term.fit` (the hub respawns the observe child only if this viewer is the sizer, §4.7). **Never `term.resize`.** |
  | control at `layoutRect` | re-letterbox/scale locally only. If the drawer grid now differs from the pane by > 10%, show the chip **"Fit pane to drawer (resizes your herdr pane)"**; only that click sends `term.resize` |
  | control at drawer size (we already resized the pane) | explicit reasons (`drag`, `font`, `fullscreen`, `fitButton`) → `term.resize`; implicit reasons (`window`, `roster`, `tab`, `dpr`, `display`, `collapse`) → re-letterbox only |

  Letterboxing: the xterm grid always equals the child grid; the drawer scales the font down to 0.7× of `termFontPx`
  to fit, then centres; if still too small, it pans (the cursor row is kept in view).
- **Your real herdr pane:** when `entity.focused` (the user is looking at it in herdr) and the control size ≠ `layoutRect`,
  show the chip "Typing resizes your herdr pane to C×R · Stay in Peek" before promotion, and "Resized your herdr pane to
  C×R" after. When `layoutRect` fits, control happens at that size and no chip is needed (§4.7).
- **Tab lifecycle (≤ 6 LRU tabs, ≤ 2 WebGL contexts, `ui/terminal/tabs.js`):**

  | Tab | xterm | Renderer | Server viewer | Mode |
  |---|---|---|---|---|
  | active | live | WebGL addon | streaming | as chosen |
  | previous (MRU #2) | live, detached from DOM | keeps its WebGL addon (context 2) | **paused** (`term.pause`) | control kept 30 s, then demoted to observe |
  | older background | instance kept (grid only, scrollback 0: ~100 KB each) | none (addon disposed) | paused; dropped after 60 s paused (child released if no other viewer) | **demoted to observe after 30 s hidden** (release control → the user's pane snaps back to its layout rect) |
  | evicted (7th tab) | disposed | — | closed | — |

  - **Switching to a tab:** attach the DOM node, `term.resume` → the hub sends one serialized `full` frame from the
    mirror (≈ 20–40 ms); if the viewer was dropped, `term.open` again (spinner over the last frame). The WebGL context
    moves from the LRU-oldest holder to the new active tab; a tab without one uses the DOM renderer until it gets one.
    **Target < 150 ms keypress → current frame visible and focused** (Leader `,`/`.`, tab click, palette, Leader U).
  - Hidden tabs never hold control past 30 s, so a stale tab cannot keep the user's pane resized or the writer lock.
- **Font size:** `termFontPx` (global, default 14, 9–28) changed by Leader `+`/`-`/`0` (and Cmd+=/−/0 on macOS),
  persisted in settings; applied to every tab, routed through `fit.invalidate('font')`. Browser page zoom is left alone
  (it would scale the world canvas and HUD too).
- **Triage:** Leader `,`/`.`, `X`, `U` (next blocked terminal) work from inside xterm. Tabs show state chips and unread
  dots; a blocked tab pulses.
- **Blocked awareness while typing:** the drawer header's blocked counter is always visible (fullscreen included) and
  new-blocked toasts render inside the drawer layer (§8). Leader U jumps to the oldest blocked terminal.
- **Recent HQ actions** (Leader J or the footer clock icon, M3): the last 50 audit entries for this session (§4.8):
  "answered prompt · tinker · 12:03", "took control · scout", "resized your pane to 120×40", "pasted 42 lines". Where
  possible an **Undo**: take control → demote to Peek; resize → "Restore layout size" (release + re-observe).

### 8.6 Scrollback, copy and paste
- herdr frames are rendered screens, so the live xterm keeps **`scrollback: 0`**. `terminal.scroll` would move the
  user's own herdr view (verified pane-global, §4.7), so scrollback is **local**:
  - Wheel-up (when the app has not enabled mouse tracking; otherwise xterm forwards the wheel to the app),
    `Shift+PgUp`, or Leader `[` → **history overlay** (`ui/terminal/history.js`): `term.history {lines: 2000}` → a
    read-only xterm (DOM renderer, `scrollback: 5000`, same theme/font) laid over the live one, scrolled to 3 lines above
    the bottom, header pill "History (read-only) · End / Esc / type to return". Refresh on reopen, not live.
  - Typing, `End`, `Esc` or wheel past the bottom closes it (the keystroke then goes to the pane).
  - `scrollMode:'herdr'` (setting, off by default): in control mode the wheel sends `term.scroll` instead, with the
    chip "Scrolling moves your herdr pane"; the hub sends `scroll bottom` before any release.
- **Which API does what** (web mode; Electron uses the same paths, plus its native clipboard works without permission):

  | Gesture | Mechanism | Notes |
  |---|---|---|
  | Ctrl+Insert / Cmd+C | `navigator.clipboard.writeText(selection)` in the keydown handler (user activation) | **guaranteed** copy chord on every browser |
  | Ctrl+Shift+C | same | best effort: Chrome binds it to DevTools inspect and may not deliver it; documented, not relied on |
  | Copy-on-select (default on; toggle in the drawer footer and settings) | `writeText` on `mouseup` after a selection | first-class; the footer shows "Copy on select ✓" |
  | Context menu → Copy | `writeText` | |
  | Fallback when `writeText` rejects | hidden `<textarea>` + `document.execCommand('copy')` | |
  | Shift+Insert, Ctrl+Shift+V, Cmd+V | **native `paste` event** on xterm's textarea → `event.clipboardData.getData('text/plain')` → chunker | no permission prompt anywhere; `readText()` is never used for keyboard paste |
  | Middle-click | HQ's internal last-selection buffer (PRIMARY emulation), no clipboard API | |
  | Context menu → Paste, Leader Y | `navigator.clipboard.readText()` | Chrome may prompt once; Firefox may show its paste popup or refuse → toast "Use Shift+Insert (Cmd+V on Mac) to paste" |
  | Copy recent output (Leader C / header) | `term.copyRecent {lines: 2000}` → `writeText` | |

  `127.0.0.1`/`localhost` are secure contexts (true through `ssh -L`), so the async clipboard API exists.
- **Keystroke path (latency over ssh -L / mosh):** typed `onData` (≤ 4 KB) goes out immediately as a binary
  `term.input` frame with no rid (§3.4); the client tracks bytes un-acked by `term.ack` and only buffers locally when
  > 64 KB are in flight. Key repeat and fast typing therefore cost one one-way trip, never a round trip per key.
- **Paste pipeline:** text → `xterm.paste()` (bracketed-paste wrapping is xterm's, passed through untouched) → the
  client chunker splits `onData` output into UTF-8-safe ≤ 16 K-char JSON `term.input {paste:true, rid}` chunks (D6),
  sending the next only after the previous reply (the hub awaits stdin `drain`); interactive frames queued behind a paste keep order. Progress chip above 64 KB; confirm above 256 KB; hard cap 1 MB.
  Multi-line pastes over `pasteConfirmLines` (default 5) into an **agent** pane ask "Paste 42 lines into scout?". Paste
  is allowed in the default session (user-initiated, class `always`). A paste in Peek promotes first (§4.7).

### 8.7 Roster selection & P2
- `Tab` from world-locked exits pointer lock, opens the roster and focuses the list. **Initial selection:** the top
  "needs you" entity (oldest blocked → highest `struggle.level` → oldest done-unacked) → else the entity of the
  last-opened terminal → else the top row. So `Tab`, `Enter` opens the most urgent terminal.
- **P2 path per scope** (every row is a p2.mjs case):

  | Focus is in | 2-input path to any pane's xterm |
  |---|---|
  | world locked / unlocked, drawer closed / docked-unfocused / collapsed | `Tab` → `Enter` (or `Ctrl+K` → name → `Enter`) |
  | xterm, drawer docked or fullscreen | Leader `L` → `Enter` (roster overlay when fullscreen) |
  | roster list | `Enter` (1 input) |
  | roster search input | `Tab` (→ list, initial-selection rule) → `Enter`, or `↓` → `Enter` |
  | palette / settings / note text inputs | `Ctrl+K` (captured in every text input) → name → `Enter` |
  | Serve card / Blocked Inbox | *Open terminal* row: `↓…`/`O` → `Enter` |
- Selection is anchored by entity id, never by index. While the list has keyboard focus or pointer hover, **reordering
  is frozen**; in-place fields (chips, elapsed) still update; pending moves show as a "3 changes" pill that applies on
  click, on blur, or after 5 s without interaction. Rows of gone entities become tombstones until then.
- Hover or arrow-select for 400 ms → live mini preview (80×12 text from the mirror / `screen.watch`, M3).
- "Follow herdr focus" toggle (M3): the drawer switches to whatever pane is `focused` in the user's herdr TUI.
- **Scripted test** (`scripts/p2.mjs` via shoot.mjs `--eval`, demo fakeTerm and hqtest):
  - locked world → `Tab` → `Enter` opens the oldest blocked terminal with a focused xterm in < 150 ms, and the roster
    closes; arrow-key selection survives a forced re-sort; `Ctrl+K` name `Enter` works;
  - roster keys: `/` focuses search, `is:blocked` filters, `↓` returns to the list, `G`/`F`/`S`/`A`/`P` act on the
    selected row, `←`/`→` collapse/expand a group, `]` jumps groups;
  - in **Control** mode inside xterm `Esc`, `Tab`, `/` reach the fake terminal; a Leader tap → world on keyup (drawer
    docked-unfocused), then `Enter` refocuses the same tab in < 100 ms;
  - **fullscreen blocked awareness:** with xterm fullscreen and focused, `demo.force` a new blocked agent → the drawer's
    blocked counter increments and a toast is visible inside the drawer within 1 s, without leaving xterm;
  - **P2 per scope:** every row of the P2 table above, incl. drawer fullscreen, drawer collapsed, search input and the
    settings panel focused, first run with no tab ever opened (Enter → oldest blocked terminal; with none blocked →
    roster opens with the list focused) and after the last tab was closed;
  - **Peek safety:** in Peek, `Esc`, `Esc Esc`, arrows, `Tab`, `Backspace` send **zero** bytes and **no** `term.promote`
    (spy on the WS; fake terminal records nothing); `Esc` leaves focus in the world; a single `Ctrl+C` shows the "press
    again" chip and sends nothing; a second within 2 s promotes and delivers `\x03`; a printable key promotes and
    arrives;
  - **Leader timing:** Leader tap then `W` within 100 ms → focus is in the world and the player moved; no tab closed;
    Leader `X` closes the tab; chord/world key disjointness from `keymap.test.js`;
  - **digits:** with the crosshair on a blocked agent and `quickAnswer` on, `1` opens pinned terminal 1 and sends no
    answer; `Alt+1` shows the confirm and sends only on `Enter`;
  - **rekey:** `demo.scenario churn` restart with re-keyed ids → open tabs, the active tab, pins 1–9, roster selection,
    follow target, unread and a pending outbox all follow the new ids (no tombstones, pins intact after a reload);
  - **typing latency:** with 150 ms injected WS latency (proxy in the test harness), 100 keystrokes typed at 30 ms
    intervals arrive at the fake terminal in order, the last within RTT + 100 ms of its keydown;
  - resize policy: roster open/close and window resize while in observe send **no** `term.resize` (spy on the WS);
  - tab switch Leader →/← shows the resumed frame in < 150 ms; a control tab hidden for 30 s is demoted to observe;
  - clipboard: Ctrl+Insert copies; a synthetic `paste` event with `clipboardData` reaches the fake terminal;
  - **`p2.mjs --mac`**: same run with a macOS userAgent and `navigator.platform='MacIntel'` (`addInitScript`); Meta+C /
    Meta+V / Meta+K / Meta+= behave per §8.2.2 and Ctrl+C reaches the pane.

### 8.8 Blocked Inbox (`ui/inbox.js`)
- `B` (or the pinned roster card) opens a paper card stack, oldest blocked first. Each card is the Serve card (§6.8.1):
  question, options as buttons with `1–9` active **inside the card only**, **Open terminal**, **Go there** (glide), and the
  same confirm + `agent.answer` hash check. After an answer it auto-advances.
- A **Done** tab lists unacked done agents with ✓ sign-off buttons and "Sign off all".
- **Triage mode** (M3; `Ctrl+K` "triage", or the inbox's Triage tab): one full-width card cycles through every blocked
  and done-unacked agent in "needs you" order, showing the last 12 screen lines (mirror/`screen`), the prompt, and
  one-key actions: `Alt+1–9`/click answer (confirm), `O` open, `S` sign off, `→` skip. Clears the office's backlog
  without walking.
- M4: Electron tray icon with the blocked count + a global hotkey that raises the window straight into the Inbox; CLI
  `claude-hq open <name>` and `?open=` deep links.

---

### 8.9 Unread (meaningful signals only)
Claude Code's TUI redraws constantly (spinner, timers, status line), so screen revisions are not "news".
- **An unread mark is added by:** a new assistant **text** message or a finished tool result in the transcript
  (transcripts enricher emits `event news {src:'text'|'tool'}`); any status transition to `done` or `blocked`; for
  shells, new lines in `pane.read recent_unwrapped` **after the last prompt line** (procinfo diffs the tail at its poll
  and emits `news {src:'shell', lines}`; prompt redraws don't count). The renderer counts these; events are recorded in
  the timeline (§4.3.1), so unread survives a reload.
- **Shown as** a dot (1) or a count capped at `9+`; blocked adds nothing (blocked has its own channel).
- **Cleared** when that pane's tab is the active, visible, focused-or-hovered drawer tab for ≥ 1 s, or when its row is
  opened. Stored per stable identity (§8.10) in sessionStorage.

### 8.10 Stable identity, rekeys and sticky notes (`ui/rekey.js`, `world/notes.js`)
- **All UI state keys through `rekey.resolve(id)`**: drawer tabs, the active and LRU order, "last terminal", roster
  selection and anchors, follow target, glide target, pins 1–9, unread marks, the outbox, open Serve/Inbox cards,
  portraits cache. On `gone {reason:'rekeyed', newId}` the map records `old → new` and every holder is migrated in the
  same tick (the xterm view re-opens with `term.open` on `newId` in the same mode; no tombstone, no leave/arrive).
- **Persistence uses `entity.identity`, never `pane_id`:** pins, notes, collapsed groups and unread are saved as
  `{terminalId, agentSession, place}` and re-bound on load with the §4.2 match order (terminalId → agentSession →
  place). A pin that matches nothing shows as a dimmed "missing" slot for 24 h, then frees.
- **Sticky notes (M3):** `N` on a row or an aimed agent opens a 280-char note input; `note.set` stores it HQ-locally
  (`~/.config/claude-hq/<session>/notes.json`, by stable identity). It renders as a paper post-it on the desk (next to
  the placard) and a note glyph in the roster row; `has:note` filters. Never sent to herdr.

### 8.11 Accessibility & focus (roster, drawer tabs, inbox)
- **Roster** is `role="tree"` (groups = expandable `treeitem`s with `aria-expanded`, rows = `treeitem`s, `aria-level`),
  keyboard focus stays on the tree container with **`aria-activedescendant`** pointing at the selected row. Row
  `aria-label`: "scout, blocked 4 minutes, hq-core › claude, task: route stops display".
- **Three distinct visuals:** keyboard **focus ring** = 2 px ink outline with 2 px offset (`:focus-visible` only);
  **selection** = clay left bar + paper-light fill; **hover** = 4% ink tint. Never the same colour or shape.
- **State chips carry text and shape, not colour alone:** blocked ▲ "blocked", working ● "working", done ✓ "done",
  idle ◌ "idle", unknown ? "unknown", shell `>_`. Drawer tab dots use the same shapes (≥ 8 px) with `aria-label`.
- **Live regions:** one `aria-live="assertive"` region announces new blocked agents ("tinker is blocked: Allow edits?"),
  rate-limited like notifications; one `polite` region announces finished agents and the away recap.
- **Drawer tabs** are `role="tablist"`/`tab` with `aria-selected`; the **Blocked Inbox** and Serve card are
  `role="dialog"` (non-modal) with the option list as `role="listbox"`; every button has a text label.
- Colour contrast of UI text ≥ 4.5:1 on paper and ink surfaces (checked by `p2.mjs` with axe-core bundled, no network).

## 9. Testing & review tooling

### 9.1 `window.__hq` (CORE, `src/core/debug.js`); always present
```js
__hq.ready            // Promise → resolves after first frame with world built + fonts ready
__hq.setPose(x,y,z,yaw,pitch)   // world coords, y = FEET; holds while no input
__hq.pose(name)       // canonical poses below; returns the pose array
__hq.stats()          // {fps, frameMs, cpuMs, gpuMs, drawCalls, triangles, programs, textures, geometries, entities, actors,
                      //  quality, renderScale, zone, conn, herdr, demo, overBudget, budget, frameErrors}
                      //  drawCalls {main, shadow, portrait, portraits, post, prepass, total}, programs {scene, post, total} (§5.3)
__hq.setQuality(tier) __hq.setHour(h|null) __hq.setTimeScale(k) __hq.freeze(bool)   // freeze = pause anim time
__hq.focus(idOrQuery, dist=1.5, height=1.1) // put the camera in front of an actor (e.g. 'status:working', 'cls:read', 'kind:shell')
__hq.select(id) __hq.openTerminal(id) __hq.closeTerminal() __hq.roster(open, groupBy?)
__hq.demo(msg)        // forwards demo.force / demo.scenario / demo.event (demo backend only)
__hq.entities() __hq.actors() __hq.store __hq.scene __hq.camera   // debugging
__hq.probe(x,y)       // {pre:[r,g,b,a] linear pre-tonemap, post:[r,g,b] sRGB}   (§5.0)
__hq.lumaStats({emissive:false})  // {max, p99, p50, p10, bloomFrac} pre-tonemap luminance   (§5.0)
__hq.surfaceStats()   // rendered L* at the current pose's probe pixels vs the §5.0 targets
__hq.clayCheck()      // {lit, shadow, castShadow, codex:{litL, shadowL, castL, eyeDL, hullDE}} on the hero sheet   (§5.0)
__hq.edgeCheck()      // {floorCoverage, swimXor} on the current pose's floorCrop   (§5.1)
__hq.hueGapCheck()    // {samples, frac, failMedian} ring around Clawds vs clay hue   (§5.5)
__hq.greyCheck()      // {top:[{at, rms, on}], onTarget} greyscale top-10 contrast blobs   (§5.5, ART §11 #10)
__hq.placardCheck()   // [{id, capPx, visibleFrac}] for placards/storefront lines in view   (§6.7)
__hq.feelTrace(ms)    // records camera y, fov, speed, step events → {maxDyPerFrame, bobPhaseErrMs, ...}   (§6.10)
__hq.frameCheck(dist=4)   // {heightFrac} of a standing Clawd at dist m (≥ 0.18 at 1600×900, FOV 60)
__hq.metrics()        // {walkWhileWorkingPct, workCallPct, workCallS:{p50,p90}, stationTrips, slideRides, stairClimbs,
                      //  zoneVisits:{ZONE:n}, queueMax, overflowUsed, avgTravelS} since load or reset  (§6.4–6.5)
__hq.loseContext()    // WEBGL_lose_context round-trip                           (§5.1)
__hq.keyScope()       // current §8.2 scope name
__hq.goToSpot(id)     // where "go there" would end for this agent: {x, y, z, yaw, pitch, why} | null   (UI m2 r2)
__hq.goTo(id)         // go there now (the roster/card "go there" verb)                               (UI m2 r2)
__hq.away(minutes)    // pretend lastPresentAt was N min ago and fire the recap check   (§6.4.5)
```

### 9.2 Canonical poses (`src/debug/poses.js`; world coords, `x,y,z,yaw,pitch`, y = feet)
LVL keeps these valid as the layout evolves and updates the table here, in the same change as `poses.js`
(`scripts/wp-briefs.test.js` fails when the table and `POSES` disagree). `library`, `lab`, `eBayGlass` and `street` stand in
**camera wells** (§6.6: `levels[].cameraWells`, solid for agents, open to the player). `review-shots.mjs` shoots all of them plus
`focus` hero shots at 1600×900 on medium, with `?pose=`, `?hour=14` and `--scenario allStates`; the §5.0 radiometry
set is repeated at **hour 18 and hour 22** (from M1 in the proto room).

| Name | Pose (world; plan in §7 = world + (20.5, 0, 14)) | Checks |
|---|---|---|
| `spawn` | 0,0,12.5, 0.22, −0.05 | **P1** (§1): E-bay glazing shows working agents, queue, Pit, Big Board STATES face legible; RAM column; ≥ 5 zones; greyscale check |
| `pitOverview` | 6,0.3,6, 0.785, −0.03 | Pit, Big Board, sofa loungers + task pennants, ENG glass, E-bay placards; edge floor crop (Pit steps). From the atrium's SE corner, eye 0.3 m up: the whole Board (I NEED YOU band included) hangs below the HUD pills; Pit ring, library, slide, stairs in frame (LVL m2 r2) |
| `eBayGlass` | −2.85,0,−1.2, 1.571, −0.02 | E2/E3 through the glazing: monitors, rings, rollup neon; the bay signs whole below the HUD pills (LVL m3 fix r2) |
| `street` | −14.65,0,5.7, −0.04, −0.05 | Storefronts, banners, amenity signs, storefront task lines; greyscale + hue-gap + edge floor crop. Against the west facade at the street's south end (just ahead of the last lamp), in a camera well, 2.3° right onto the vanishing point; walkers keep to the east side (LVL m2 r2) |
| `lobbyDesk` | 0.5,0,11, 0.73, −0.1 | Help queue, beacon, NOW SERVING |
| `serve` | −4.35,0.9,8.5, 0, −0.32 | On the STAFF mat, eye 2.1 m, leaning over the walnut counter: the queue head at the window 2.0 m off, its whole face, mouth and raised arms clear of the counter's front edge (the front rope is open at the window), NEED YOU band above, lane behind (BRN m2 r1; LVL m3 fix r2) |
| `library` | 0,0,−13.15, π, −0.06 | Inside view from the north aisle (camera well), due south: readers at the tables' south seats facing the lens, both arches + the atrium behind, window gobo (LVL m2 r1) |
| `lab` | −7.6,0,10.35, 2.2, −0.08 | Inside view from the NE corner (camera well) south-west over the round table: both benches, fume hood, TEST light (LVL m2 r1) |
| `mezz` | 6,2.9,−10.5, 1.571, −0.1 | Round Table, Observatory |
| `mezzToPit` | −0.65,2.9,−7.32, π, −0.32 | Big Board, atrium, queue. Leaning on the 0.8 m glass rail (0.32 m, due south so the rail runs parallel to the image plane): the cap is 51° down, below the frame at every aspect; camera between the rail posts at x19.1/20.25 (LVL m2 r1; `layout.test` 'mezzToPit pose') |
| `engine` | 9,0.25,1.5, −1.571, 0 | Rack wall, shells |
| `cafe` | 9.5,0,12.5, −1.2, −0.05 | Idle life, espresso bar + steam and coffee slots in frame, tables + booth, Nap Nook; hue-gap (cool terrazzo) (ENV m2 r1) |
| `plan` | 0,32,0, 0, −1.5707 | Top-down layout |
| `proto` | M1 room, defined in `proto.js` | M1 only |

Hero shots use `--eval "__hq.focus('status:working')"`, and likewise `status:blocked`, `status:done`, `status:idle`,
`kind:shell` and `cls:task`. The silhouette check uses `?silhouette`. `review-shots` also runs: `?sheet=hero` (§6.1.1) +
`clayCheck` (lit, shadow, castShadow, codex), `lumaStats` at `spawn`/`pitOverview`/`street`/`cafe` (incl. `bloomFrac`
at `eBayGlass`) at hours 13/18/22, `surfaceStats` at `spawn`/`street`/`pitOverview` (incl. the golden/night rows and
lamp-pool contrast), `edgeCheck` at `street`/`pitOverview`, `placardCheck` at `spawn`/`pitOverview`, `frameCheck`,
greyscale + hue-gap checks (§5.5, incl. `cafe`/`street`), `?sheet=props` (§7.5), and prints all numbers into
`review.json`; any miss exits non-zero. Each pose in `poses.js` carries its probe pixels (`{wallLit, wallShade, floor,
floorPool?, ceiling}` screen coords) and a `floorCrop` rect, maintained by LVL with the pose.

### 9.3 Commands
- **Web screenshots:** `node scripts/shoot.mjs "http://127.0.0.1:7461/?t=$(cat ~/.config/claude-hq/token)&pose=spawn" /tmp/hq --wait 6000 [--uncapped] [--json]`.
  - It uses `--use-angle=vulkan` headless Chromium, which gives the real 780M.
  - It exits 2 on a page error or software GL. Filtered errors must be empty.
- **Electron screenshots:** `xvfb-run -a -s "-screen 0 2560x1440x24" npx electron --no-sandbox --ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan . --demo --shoot /tmp/e.png [--shoot-wait 6000] [--shoot-pose name|x,y,z,yaw,pitch]`.
  - This implements the `experiments/electron-probe` approach inside `electron/main.js`.
  - Make the Xvfb screen larger than the window.
- **Perf:** compare configurations only with `--uncapped`, taking the median of 3 runs. Expect ±10% noise.
  `npm run perf` runs `crowd40` and `allStates` at `spawn`, `pitOverview`, `street` and fails on > 15% regression vs
  the committed `perf-baseline.json` (updated deliberately, with the reason in the commit).
- **Unit tests** (`npm test`, all `node --test`, no real herdr):
  - backend: classify, naming, blocked parse + prompt hash + answer key computation, transcript derivations (fixtures in
    `server/**/fixtures/`, trimmed real JSONL), hub reason mapping, binary codec, security checks, lock file logic;
  - **mock herdr** (`server/test/mockHerdr.js`): a unix-socket server scripted with NDJSON (snapshot, events, status
    changes, subscription EOF, `pane_not_found` on subscribe, restart with re-keyed pane ids) plus a fake
    `terminal session` binary via `HERDR_BIN_PATH` (frames, `busy`, `taken`, `not found`; observe children that ignore
    release/EOF like the real one). Covers HerdrLive, the reconnect grace (no exodus), TerminalHub observe→control
    promotion, mirror resync, writer rules, backpressure (`needsFull`), event derivation (arrive/leave/blocked/finished,
    enricher `emitEvent`, no `arrived` for first-snapshot panes), and enricher `update()` start/stop (blocked poller only
    while blocked; `activity` null on leaving working in the same `entity` message). Plus:
    - **promote with other viewers:** A, B, C observe (B/C different drawer grids); A promotes → B and C receive a `full`
      frame at the control grid within one swap, stay Peek, and no second control child is spawned;
    - **mixed drawer sizes:** the observe child is spawned at the first opener's grid; B's `term.fit` does not respawn it;
      A's does (rate-limited); A closes → B becomes sizer;
    - **safety:** the mock logs every method; a full WS e2e run including `spawn`/`pane.close`/`agent.*` messages against
      a socket registered as session `default` without `allowMutations` → **zero** STRUCTURAL/NEVER methods written; with
      a protocol-21 `ping` → zero CONTROL/INTERACT/FOCUS methods and `hello.herdr.readOnly`;
    - **no control without promote:** the fake bin records argv; a scripted client doing `term.open`, `term.fit`,
      `term.input` (rejected), `term.history`, `term.pause/resume`, `term.close` spawns **no** `control` child; only
      `term.promote` does;
  - **WS e2e:** `createApp({demo:true, port:0, configDir:tmp})` → `hello`/`world`, `term.open` → binary frame round-trip,
    `term.input` chunking, bad token/Origin/Host → reject, single-instance attach, one reject case per `VALIDATE` row,
    `hello.ack` protocol mismatch → rejected, the 9th client → 1013, the 17th terminal child → `terminal_limit`;
  - **replay golden:** `hqtest-10min.ndjson` at `--speed 20` → emitted stream equals the golden file (§4.9);
  - **leaks:** `churn` for 10 simulated min under `FakeClock` (§4.13), then quiesce → `/debug/metrics` equals the
    pre-run baseline; `longIdle` under `FakeClock` reaches the 7 h dust level deterministically;
  - **reaper** (§4.7.1): kill -9 the backend with live children, restart → zero stale-tagged processes within 2 s;
    SIGHUP → clean release (control children receive `terminal.release`, observe children SIGTERMed);
  - **since** (§4.3.1): restart the backend with unchanged `stateSeq` → identical `statusSince`, `approx` false; a new
    pane → `approx` true with the transcript hint applied;
  - **chaos (M2, `test/chaos.test.js`):** on mockHerdr under `FakeClock`, N = 20 seeds of randomised herdr restarts
    (re-keyed ids), pane churn, subscription EOFs and slow/partial NDJSON lines split mid-UTF-8 → no exodus, no
    duplicate entities, no leaked children, and the default-session method log contains zero non-READ calls;
  - **resolver:** `socketFor` table test; `dev:hq`/test harness refuse when the session resolves to the default socket;
    no child spawns before a successful `ping` (fake bin argv log empty when ping fails);
  - shared: `palette.test.js` (ΔE matrices incl. workspace × kind and trim, §5.5), `lut.test.js` (§5.0);
  - renderer @pure modules: layout invariants (doors open, every slot and station reachable, private doors respected,
    floorY, keep-clear rects empty, full-queue reachability §7.1), A*, springs, `phase.js` (dominant phase, 2× rule,
    cooldown), brain FSM transitions (work call, cold start), `director.test.js` capacity/overflow (§6.4.4), keymap scope
    table (every key in `?` overlay equals the handler table, both platforms).
- **Walk times:** `npm run walktimes` prints spawn → every zone and every bay → every station (agent at 2.8, 2.0 and
  0.9 m/s, player at 3.6 m/s) from the real nav grid; pasted into §6.5 at the M1.5 gate. `--ascii` dumps the block map
  from `hq.js` (§7). `--sim mixed|trio --minutes 10` runs the @pure brain + director + nav headless (no renderer) and
  prints the §6.5 traffic metrics (slide rides, stair climbs, MAIL/ARC visits, work-call p90, walkWhileWorkingPct);
  the M1.5/M2 gates fail on a miss.
- **Default-session integrity (`scripts/integrity.mjs`, BE):** read-only `session.snapshot` of the default session,
  normalised (drop `revision`, `scroll`, focus/timestamp and title fields, sort arrays by id) and hashed; runs before and
  after `npm run dev:hq` e2e + `p2.mjs` + `p2.mjs --mac`; any hash change fails (P8). Also asserts no
  `terminal session control` child for the default session appeared in the process table during the run, and that at
  the end `/proc` holds no process tagged `CLAUDE_HQ_INSTANCE` other than a live lock's (§4.7.1).
- **`npm run doctor`** (`server/doctor.js`, BE, M1): resolves the session socket (prints path + realpath), pings
  (protocol 22?), lists live HQ children from `/proc` by instance tag (flags stale ones), checks the lock file, checks
  env gotchas (`HERDR_*` inherited, `CLAUDECODE` set → transcripts warning, §10), probes the GPU flags Electron would
  use, and prints the exact `ssh -L 7462:127.0.0.1:7462 <host>` command and URL. The first thing to run when "it's
  broken over ssh".
- **Live herdr:** `scripts/hqtest-up.sh`, then `npm run dev:hq`.
  - Fixtures: scout is idle, tinker is **blocked** (folder trust), plus shells running `top`, `watch`, `http.server` and a
    log loop.
  - To see `working`: `herdr --session hqtest agent prompt scout "…" --wait`. This costs tokens, so use it sparingly.
  - Teardown: `scripts/hqtest-down.sh`.
  - **Never test against the default session** except read-only.

---

## 10. Gotchas (read before coding)
- **three:** stay at **0.186** (postprocessing peer range `<0.187`). N8AO must be a Pass *before* the EffectPass.
  `--use-angle=gl-egl` renders the post stack black, and `--disable-vulkan-surface` cuts fps by 4×.
- **Electron:** needs `--no-sandbox` in **argv**, and headless use needs Xvfb (`--ozone-platform=headless` segfaults).
  Deny `window.open`, block off-origin navigation, and set `contextIsolation:true`.
- **herdr:**
  - Status transitions only arrive on per-pane subscriptions.
  - A subscription naming a closed pane fails entirely.
  - `params` is required.
  - Controlling a pane resizes its PTY.
  - stdin EOF detaches a *control* child.
  - The exit code is always 0.
  - Focus calls move the user's real UI.
  - `done` is cleared **only** by focusing the pane (`pane.focus`); reads, observe, control and input don't (§6.8.2).
  - `observe` never resizes the PTY; `control` does, immediately.
  - Observe children ignore `terminal.release` and stdin EOF: SIGTERM them.
  - `terminal.scroll` is ignored by observe and moves the **pane-global** scroll under control (it scrolls the user's
    herdr view): use `term.history` (`pane.read recent`) for HQ scrollback.
- **Transcripts:**
  - A transcript file only appears after the first prompt.
  - Usage repeats on every content-block line, so dedupe by `message.id`.
  - A herdr server launched from inside Claude Code produces agents that save no transcript. `hqtest-up.sh` uses `env -i`.
- **Stats:** use `statfs`, not `df`. Find hwmon by name, not index. `mem_busy_percent` and battery don't exist here.
- **Rendering:** tone mapping is NEUTRAL (never AgX/ACES); no `alphaHash` or temporal dither; no synchronous
  `readPixels`; hulls never write depth; never use a pmndrs `NormalPass`; displaced vertices need a matching
  `customDepthMaterial`. The sun is never a `DirectionalLight` (studio key only); `keyVis` goes **inside** the ramp;
  charBatch meshes are `frustumCulled = false`; characters render after N8AO.
- **Assets:** no network fetches of any kind (CSP enforces it); UI/canvas text uses system font stacks and in-world display lettering is procedural (`glyphs.js`); no emoji dependence in
  in-world text (draw icons in code).

---

## 11. Milestones & work packages
**How we work:**
- Each milestone runs its work packages (WPs) in parallel. **Ownership comes only from §2.1**; the tables below list
  deliverables and acceptance.
- WPs integrate only through the contracts in §3, §4.0, §5.4, §6.2, §6.3, §8.1 and §9.1.
- At the end of each WP, the engineer runs `npm test`, runs `npm run review` and attaches shots + `review.json`, and writes
  a summary of proposed contract additions (LEAD merges them).
- **Milestone gate:** reviewers must sign off before the next milestone starts, iterating until they are satisfied.
- New ideas go to §11.5 at any time; LEAD pulls them into the current or next milestone when they earn it.

  | Reviewer | Signs off on |
  |---|---|
  | Art | ART §11 checklist (+ §5.0 numbers, §5.5 greyscale/ΔE, §6.1.1 hero sheet) |
  | Gameplay | Pillars P1, P3–P6; walk-time table; Serve and sign-off loops |
  | UI | P2, keymap scopes, drawer lifecycle, clipboard |
  | Code | Contracts, ownership, safety, tests with the mock herdr |
  | Perf | §5.3 on the 780M, `npm run perf` |

### 11.0 WP codes → owners
WP codes **are** the §2.1 owner codes; a milestone never introduces new ones (v2's BE3, CHR2, UI2, UI3, RND2, BRN0 are
retired: they were the same owners in later milestones).

| WP | Owns (§2.1) | M0 | M0.5 | M1 | M1.5 | M1.75 | M2 | M3 | M4 |
|---|---|---|---|---|---|---|---|---|---|
| LEAD | `shared/{protocol,identity,palette,task,clock}.js`, `server/interfaces.js`, `scripts/wp-briefs.mjs`, `docs/wp/*`, DESIGN.md | ✓ | ✓ briefs | merge | merge | merge | merge | merge | merge |
| BE | `server/{main,app,config,clock,reaper,doctor,instance,http,ws,log,audit}.js`, `herdr/*`, `world/*` (incl. blocked, acks, slots, screens, actions), `terminals/*`, `test/mockHerdr.js`, `electron/main.js`, `scripts/{hqtest-*,integrity.mjs}` | |  | ✓ | |  | ✓ | ✓ | ✓ |
| BE2 | `shared/classify.js`, `server/record.js`, `enrich/*`, `stats/*`, `demo/*` | | ✓ static demo + echo term | ✓ | |  | ✓ | | |
| CORE | `renderer/index.html`, `src/main.js`, `src/core/*`, `src/net/*`, `src/stubs/*`, `src/debug/perfOverlay.js`, `scripts/{shoot,dev,review-shots,perf}.mjs` | | ✓ scaffold | ✓ | |  | | | |
| RND | `src/render/**` (incl. `lamps.js`, `text/glyphs.js`), `src/debug/{probe,silhouette}.js` | |  | ✓ | | ✓ tune | ✓ | ✓ | |
| LVL | `src/world/layout/*`, `src/world/nav/*`, `build/greybox.js`, `src/debug/poses.js`, `scripts/walktimes.mjs` | |  | ✓ (proto) | ✓ | ✓ poses | ✓ | | |
| ENV | `src/world/build/*` (incl. `kit/*`) except greybox, `src/debug/propSheet.js` | |  | | | ✓ kit + hero zones | ✓ | ✓ | |
| CHR | `src/chars/{rig,render,anim}/*`, `src/debug/sheet.js` | |  | ✓ (hero) | | support | ✓ | | ✓ |
| BRN | `src/chars/brain/*`, `src/chars/actors.js` | |  | ✓ (minimal) | ✓ | support | ✓ | | ✓ |
| FX | `src/fx/*` | |  | | | ✓ placards | ✓ | | ✓ |
| STAT | `src/world/stats/*` | |  | | |  | | ✓ | |
| AMB | `src/world/ambient/*` | |  | | |  | | ✓ | ✓ |
| AUD | `src/audio/*` | |  | | |  | | ✓ | |
| UI | `src/ui/**`, `scripts/p2.mjs` | |  | ✓ | |  | ✓ | ✓ | ✓ |
| PLY | `src/player/*` | |  | ✓ (with RND+LVL) | ✓ feel |  | ✓ | | ✓ |

**Reading map (engineer context budget).** DESIGN.md is ~255 KB; nobody (human or LLM agent) should hold all of it
plus ART/GP. Each WP reads **only its brief** `docs/wp/<CODE>.md`, generated by `npm run briefs`
(`scripts/wp-briefs.mjs`, LEAD, M0.5): it inlines the sections below **verbatim** with their § anchors, plus §10, the
§12.2 superseded list and **only its own milestone rows + exit lines** (never the whole of §11, D5), and records the
DESIGN.md hash (`npm run briefs:check` fails if a brief is stale). Keep rows narrow: cite the subsection, not the chapter. ART/GP are opened only for
art/behaviour *reference*; their superseded rows are struck inline (→ DESIGN §x), never implemented.

| WP | Normative sections (inlined in the brief) | Reference only |
|---|---|---|
| LEAD | everything | — |
| BE | §2, §3 (incl. §3.5), §4.0–4.3, §4.7–4.8, §4.11–4.13, §6.8.2, §8.4 states, §8.6 input paths, §8.10 identity, §9.3 | research/herdr-api, research/platform §5; DESIGN §4.4–4.6, §4.9–4.10 (BE2's side of the seams) |
| BE2 | §2, §3.1–3.2, §3.5, §4.0, §4.3–4.6, §4.9–4.10, §4.13, §9.3 | research/herdr-api §6, platform §6 |
| CORE | §2, §3.3–3.5, §4.11 protocol skew, §5.2 throttling, §8.1, §9 | stubs: `renderer/src/stubs/README.md` |
| RND | §5 (all), §6.2, §6.7 placard render, §7.1 VIS/windows, §9.1–9.2 | ART §3–4 |
| LVL | §6.6, §7.1–7.4, §9.2, §9.3 walktimes | GP §1 topology |
| ENV | §5.4 getMaterial + program matrix, §5.5, §5.6, §7 (all, esp. §7.5), §9.2 | ART §2, §3.3, §7 |
| CHR | §5.1 hull/mask, §5.4, §5.5 bodies/trim, §6.1–6.3, §6.7 | ART §5–6 |
| BRN | §3.1, §6.4–6.9, §7.1–7.2, §9.1 metrics | GP §3 |
| FX | §5.0 emissive policy, §5.4 fx API, §6.7 | ART §8 |
| STAT | §3.2, §5.4 registry, §7.4 | ART §3.4 dot-matrix |
| AMB | §6.4.1, §6.4.5, §6.9, §7.4 | GP §4 |
| AUD | §3.3 events, §6.7, §6.10 step events, §8 intro (notification channels), §8.9 | ART §6.7 |
| UI | §3.3–3.5, §4.7 intro (states + sizing), §4.8, §6.4.5, §6.8, §8 (all), §9.1, §9.3 p2 | ART §9 |
| PLY | §6.6, §6.10, §7.1 vertical, §8.2 world keys, §9.1 `feelTrace` | GP §5 |

**Dependency DAG (who waits for whom inside a milestone):** CORE scaffold (M0.5) → everyone. RND `getMaterial`
toon/hull + `CharPass` + final post → **CHR hero-sheet sign-off** (CHR builds rig/anim against stubs meanwhile).
CHR `animator`/`charBatch` → BRN integration (BRN codes against the stubs). CORE store/bus + BE2 `fakeTerm` → UI drawer.
LVL proto nav/layout → PLY and BRN walking. BE `blocked.js` → UI Serve. Each WP's summary lists the stubs it deleted.

### M0: Contracts (LEAD, before anything else)
`shared/protocol.js` (+ binary codec, `EVENT_KINDS`, `FIELD_OWNERS`, `VALIDATE`, and tests), `shared/identity.js`,
`shared/palette.js` (+ ΔE tests incl. workspace × kind and trim), `server/interfaces.js`, `package.json`,
`vite.config.js`. Exit: `npm test` green on these; every M1 WP can import them.

### M0.5: Scaffold (CORE + LEAD + BE2, ≈ 1 day, before any parallel WP)
A booting renderer and server with **every cross-WP seam present at its final signature and JSDoc**, backed by stubs, so
parallel WPs never block each other. Stubs live in `renderer/src/stubs/` (and `server/demo/static.js`); the owning WP
replaces and deletes them.

| Seam (final module) | M0.5 stub behaviour | Coded against by | Replaced by |
|---|---|---|---|
| `core/{loop,ctx,bus}.js`, `net/{socket,store}.js` | real, minimal (no backoff/skew yet) | all renderer WPs | CORE, M1 |
| `server/demo/static.js` (a `HerdrSource`) | 12 entities, every status once, no schedule; real `hello`/`world` over WS | CORE, UI, BRN, CHR | BE2 DemoWorld, M1 |
| `server/demo/fakeTerm.js` | echo terminal with a prompt | UI drawer | BE2, M1 |
| `render/materials/index.js` `getMaterial(kind)` | plain `MeshLambertMaterial` per kind (hull = BackSide ink) | CHR, ENV, LVL, FX, STAT | RND, M1 |
| `render/post.js` `post.render()` | `renderer.render(scene, camera)`; `CharPass` no-op (chars in the main scene) | all | RND, M1 |
| `chars/render/charBatch.js` | registers rigs as plain unbatched meshes | BRN | CHR, M1 |
| `chars/anim/animator.js` | holds the rest pose; `setAction`/`react` recorded for `__hq` | BRN | CHR, M1 |
| `fx/index.js` | every call a no-op with counters in `__hq.stats().fx` | BRN | FX, M1.75/M2 |
| `chars/brain/*` `brain.update()` | static Intent: sit at desk slot `i` | CHR (sheet), CORE | BRN, M1 |
| `world/layout/proto.js` + `nav/*` | 10×8 m box, 6 desk slots, straight-line `path()` | RND, PLY, BRN | LVL, M1 |
| `player/controller.js` | fly camera | RND review shots | PLY, M1 |
| `world/stats/registry.js` `registerStat` | no-op | — | STAT, M3 |
| `debug.js` `__hq` | full §9.1 surface, unimplemented calls return `null` | scripts | owners, M1 |

Exit: `npm run dev` boots to a lit box with 12 placeholder capsules at desks; `__hq.ready` resolves; `shoot.mjs` exits 0
on the 780M; `npm run briefs` produced every `docs/wp/*.md`; `npm test` green.

### M1: Skeleton, end-to-end (demo + real herdr, one room, one hero character)
| WP | Deliverables | Acceptance |
|---|---|---|
| **BE** | HerdrLive recipe + reconnect grace; WorldModel + enricher seam (`update`, `emitEvent`, ownership check); `client.js` allowlist + read-only mode; TerminalHub (observe-first, promote token, SIGTERM observe, mirror, sizer/writer rules, pause/resume, history, caps, backpressure, grace resume); **`world/blocked.js` + hash-checked `agent.answer`** (the whole blocked path lives here, M1); `actions.js`; acks; slots; ws `VALIDATE` + `hello.ack`; `/debug/metrics`; security (§4.11); single-instance lock; Electron window + attach + GPU switches + `before-input-event` + `--shoot`; mock herdr; `integrity.mjs`; **`herdr/resolve.js` + ping-before-spawn (§4.1), reaper (§4.7.1), `since.js` (§4.3.1), `clock.js` (§4.13), interactive/paste input paths + `term.ack` (§3.4), `doctor`** | Against `hqtest`: entities appear and scout/tinker/shells have the right status within 2 s of a change; tinker's folder-trust prompt is parsed and answerable from a test client; opening a drawer does **not** change the pane's size until the first keystroke; xterm round-trip (`echo hi`); busy → takeover; a late second window gets a full serialized frame with no resize. All §9.3 mock-herdr and WS e2e tests pass (incl. safety, no-control-without-promote, promote-with-viewers, mixed sizes). Electron `--shoot` produces a 780M screenshot. Bad Host/Origin/token → 403. `integrity.mjs` unchanged hash and no stale-tagged processes. Reaper, since, resolver and FakeClock tests pass; `npm run doctor` against hqtest and default (read-only) is correct |
| **BE2** | Transcript tail + derivations (staggered, chunked), `emitEvent` for error/test/commit/compact, subagents, procinfo, the full Stats shape, DemoWorld as HerdrSource + DemoEnricher + FakeTerminals, phase-structured schedules, all scenarios incl. `queue`, `longIdle`, `churn`, record/replay incl. events | `node --test` passes with real-JSONL fixtures. Demo cycles through every status and ToolClass within 3 min. `allStates` is deterministic. `churn` runs 10 min with `/debug/metrics` back to baseline. Stats match `free`/`top` within 5% |
| **CORE** | Boot, WS store (eager apply, binary codec, backoff, `cid`, protocol-skew reload), notifications from store events, frame loop + ctx, `__hq` (full §9.1 API; stubs are OK where later WPs fill in), URL params, `npm run dev`, `review-shots`, `perf` | `shoot.mjs` at `?pose=proto` exits 0 on the 780M. `__hq.stats()` is populated. Reconnect after a backend restart re-renders the world. A blocked event in a hidden tab updates `document.title`. A renderer with a stale `PROTOCOL_VERSION` reloads once and then shows the banner |
| **RND** (+ **LVL** proto room, **PLY** walk) | Materials factory + program matrix, §5.0 lighting contract (studio key + sun uniforms, ramp-internal shadow, gain sets), post stack in the §5.1 order (N8AO toy scale, `CharPass`), tiers and auto-scale, alpha mask + Edge skip, NEUTRAL + generated LUTs, lamp pools, emissive policy, time of day, context-loss handling, `probe.js` (probe, lumaStats, surfaceStats, clayCheck incl. codex, edgeCheck); **planarity edge (§5.1)**; the proto room (≈ 12×9 m: **12 desks in 3 pods of 4** (D7), a sofa corner, a help counter, a window with sky, toy proportions); player walk/sprint/jump/collide | Medium ≥ 200 fps uncapped in the proto room on the 780M. Scene programs ≤ 12. `lumaStats`, `surfaceStats` and `bloomFrac` within the §5.0 day, **golden (18 h) and night (22 h)** rows at `proto` (incl. lamp-pool contrast); `edgeCheck` floor crop ≤ 0.2% and swim ≤ 0.1%. AO probe on a Clawd unchanged ±1% with N8AO on/off. No double outlines or AO halos (reviewer crop). At hour 18 no long shadows in the windowless half of the room. Art reviewer passes shots 1, 3 and 6 (partial) |
| **CHR** hero Clawd (§6.1.1 first) | One Clawd at final quality: rig, face layers, screen-space glints, 8 accessories with trim, 4 kind bodies, springs, trot, sit, `type`, `typeFrenzy`, `readBook`, `think`, `waveBlocked`, `lounge`, `sleepDesk`; reactions `startle`, `victory`, `hop`, `dissolveIn`; blob shadow; distance-scaled hull; charBatch with per-actor culling; the hero sheet | **Art sign-off on the hero sheet before any other character work.** `clayCheck` lit < 6, shadow < 8, castShadow < 8. 12 Clawds cost ≤ 40 draws (main) + ≤ 12 (shadow). Silhouette test passes. Motion review: anticipation, squash and overshoot visible |
| **BRN** (minimal) | Entity → actor lifecycle (incl. re-key and cold-start placement, §6.4.3); desk assignment from `workspace.slot` in the proto room; the status → activity table (no stations, no nav: straight-line walk) | Every demo status is visibly distinct from the proto pose; on boot nobody walks in; `churn` shows no exodus/re-hire on reconnect; two windows show the same desk assignment |
| **UI** | Keymap scopes + leader + platform map (§8.2), focus/layout model (§8.2.1), roster (selection + reorder freeze, segmented group-by, search fields/tokens, row keys, pins, open), drawer (lifecycle states, observe→control, outbox, settled-fit path, tab lifecycle, blocked counter + in-drawer toasts, history overlay, clipboard per §8.6, font size, triage keys), HUD pills + crosshair + E-to-open, Ctrl+K palette, blocked toast, `?` overlay | `scripts/p2.mjs` and `p2.mjs --mac` pass (§8.7, incl. P2 per scope, Peek safety, Leader timing, digits, rekey, 150 ms-latency typing) against demo fakeTerm and hqtest; keypress → focused xterm < 150 ms; tab switch < 150 ms; `rekey.js` + stable-identity pins; roster ARIA tree + focus ring (§8.11) |

**M1 exit:** `npm run dev` runs the demo in the proto room with 12 lively Clawds; `dev:hq` shows scout and tinker live
and a terminal can be typed into; the Electron shot works; `integrity.mjs` passes; the code reviewer signs off on every
herdr call path.

### M1.5: Greybox gate (LVL + BRN + PLY, before ENV dresses anything)
| Deliverable | Acceptance (gameplay reviewer signs) |
|---|---|
| `layout/hq.js` built **from the §7.1 table**: walls, doors (incl. private), rope line + teller counter, queue lane + overflow rug, keep-clear rects, stairs, slide, pit, mezzanine, slots, stations, amenities, nap spots, lamp anchors, vis cells, stat anchors; `build/greybox.js` renders it with flat `toonEnv` colours from the §5.5 value map (`?greybox`); `walktimes --ascii` regenerates the §7 map | Nav invariants pass (every slot/station reachable; private doors only for owners; slide one-way; keep-clear rects empty; **full 10 + 6 queue leaves every door reachable**) |
| `npm run walktimes` table: spawn → every zone; every bay → every station (agent 2.8/2.0/0.9 m/s; player 3.6 m/s) | Every E-bay → Library/Lab ≤ 12 s at 2.0 m/s; spawn → farthest zone ≤ 12 s walking; the §6.5 distance column is replaced with measured values |
| Sightline shots `spawn`, `pitOverview`, `mezzToPit`, `eBayGlass`, `lobbyDesk` with greybox agents in `mixed` and `queue` | P1 holds from `spawn` (queue visible over the rope line); `frameCheck` ≥ 0.18; no empty patch > 2.5 m outside lanes (a density overlay in `?greybox`) |
| **PLY feel block (§6.10)** on the greybox: accel/decel, sprint + FOV kick, head-bob with step events (AUD stub clicks), landing dip, coyote time, ride the slide, sit on a Pit sofa | **Motion-feel sign-off (gameplay reviewer)** on a traversal run spawn → Pit (sit, stand) → stairs → mezzanine → slide → Lobby: no camera pop > 3 cm/frame except the landing dip (`__hq.feelTrace`), bob phase error vs footstep events ≤ 20 ms, slide ride smooth at ≥ 60 fps, sprint FOV kick visible; judged **before** ENV dresses anything |
| BRN station logic (§6.5), idle ladder with chill/hobby lists and roaming cap (§6.4.1), **Shelly idle ladder**, work call (§6.4.2), capacity/overflow (§6.4.4) on the greybox | `walktimes --sim mixed`: `walkWhileWorkingPct ≤ 20` (work calls included), work-call p90 ≤ 8 s, ≥ 4 slide rides and ≥ 8 stair climbs / 10 min, MAIL and ARC visited ≥ 1 / 3 min; `--sim trio` ≥ 1 slide ride / 10 min; `director.test.js` passes |

Doors, stations and zone sizes may still move freely here; after sign-off they change only with a gameplay review.

### M1.75: Hero-zone gate (ENV + RND + FX, art reviewer signs before any other zone is dressed)
| Deliverable | Acceptance (art reviewer signs; gameplay reviewer co-signs placards) |
|---|---|
| The full **prop kit** (§7.5) + `?sheet=props` | Every builder has its bevel, 3-colour rule and hero detail; silhouette pass at 4 m reads each item; no raw boxes within 6 m |
| **Atrium + Pit** and **E2** (the E-bay seen from spawn) dressed to final: value map, complementary staging, density, signature props (Big Board, sofas, hearth), glazing with interior reflection, lamp anchors, gobo windows | Shots `spawn`, `pitOverview`, `eBayGlass`, `mezzToPit` at hours 13/18/22 with the full post stack: `surfaceStats`, `lumaStats`, `bloomFrac`, hue-gap, greyscale, `edgeCheck` pass; "diorama, not box city" judgement by the art reviewer |
| **Task placards** (FX `placards.js` + desk board anchors) in E2 and the Pit pennants | `placardCheck` at `spawn` and `pitOverview` passes; reviewer can read every E2 task in the shots |

No other zone is dressed until this gate passes; the signed zones are the reference ("match E2") for M2 breadth.

### M2: Full office, full cast, full behaviour
| WP | Deliverables |
|---|---|
| **LVL** | Canonical poses + probe pixels updated from the signed greybox, **§9.2 table updated in the same change** (`wp-briefs.test.js` checks it); vis table tuning; minimap bake; **`nav/astar.test.js`: Float32-`gScore` cost equivalence vs a Float64 reference A\* on seeded random start/goal pairs on both hq levels (§6.6; LEAD ask, m2 fix r2)** |
| **ENV** | Every **remaining** zone dressed from the signed kit and hero zones (M1.75), to the §5.5 value map, complementary staging and density targets, one signature prop per zone, amenity bays with moving-day swap, storefronts, Mailroom OUTBOX chute, Archive nook/microfiche/vault corner, skyline/garden **cards** (§7.3), baked vertex AO, merged per cell, window list for gobo, lamp anchors |
| **RND** | Interior/exterior glass reflection modes, monitor atlas (§5.3), screen emissive budget (`screen.js`), hue-gap + greyscale checks in review |
| **CHR** | Shelly rig + the §6.7 Shelly table; mini-Clawds; every activity and reaction in §6.3 (incl. walking variants, `workCall`, `slideRide`, `parcelCarry`, struggle look, `exhale`); smear frames + 2-frame holds; waddle and skip; noodle-arm IK; props; backpacks; emblems; state-driven outlines |
| **BRN** | Full Director (slot-based bays, annex, hot desks, amenities, queue with NOW SERVING, Pit seats, benches, ghost desks, capacity/overflow), full HFSM (§6.4) with the idle ladder, work call, parcel run, `phase.js` stations, stairs and slide traffic, avoidance + bow, verbs per §6.9, arrivals through the front door (post-boot only), LOD + culling |
| **FX** | Bubbles with declutter, nameplates, status rings per the chroma budget, activity glyphs, dust levels, blocked beacon ring, particle pool (confetti, Z's, sparks, steam, smoke, rain cloud, capsule, crossed-out paper orbit) |
| **BE** | Monitor `screen`s from mirror/`pane.read` into the atlas feed; `agent.explain` passthrough; audit log; `timeline.js` + `timeline.get` (§4.3.1); chaos harness (§9.3); `news` events for shells |
| **BE2** | Struggle derivation (§4.4); `news` events from transcripts (§8.9); `sinceHint` (§4.3.1); scrubbed golden replay fixture + golden test (§4.9, under `FakeClock`) |
| **UI** | Status card with blocked options; **Serve** mode (§6.8.1) and the **Blocked Inbox / Done tab** (§8.8); sign-off verbs; minimap + overview; follow cam; glide; monitor-dive transition; **away recap** (§6.4.5); unread from `news` (§8.9) |
| **PLY** | Follow/glide cameras on the full plan, Serve camera glide, sit/ride on every seat type and the slide in the dressed office |

**M2 exit:** 60 fps with 12 agents (`mixed`) and ≥ 45 fps with `crowd40` on medium; from spawn a blocked agent is found in
≤ 8 s; answering at the counter works in `queue` and against tinker on hqtest; M1.5 sim metrics still pass in the
renderer (`__hq.metrics()`); all canonical poses pass art review (incl. `surfaceStats`, `bloomFrac`, hue-gap); `trio`
and `longIdle` pass the P3 review (nothing static for 60 s **in any zone incl. ENG**, whose shells sit at `prompt`; no
empty storefronts; NE quadrant has traffic); the away recap fires in `queue` after `__hq.away(40)`.

### M3: Stats, polish, post
| WP | Deliverables |
|---|---|
| **STAT** | Every §7.4 object, Big Board 4 faces (STATES with names) + the away face, plaques, crosshair tooltips with sparklines, macro-stress weather (§7.4), pixel-Clawd screensavers (§11.5) |
| **RND** | F3 per-pass GPU budget bar + pass-shedding auto-scaler (§5.2), High/photo tiers, window gobo on all tiers ≥ Medium, per-zone colour script, god rays + dust (High), clay micro-surface, CA juice, DOF focus on inspect, night + golden lighting sign-off (lamp pools, cross-faded points), per-part hull LOD, **capsule-stroke display face** (`glyphs.js`) across all signage |
| **AMB** | Ada (greeter, hands Serve tickets, points at the oldest blocked agent, "herdr offline" sign), Segfault the cat (hottest rack, keyboards, follows the player, vault naps), fish boids, roomba, espresso steam, fans driven by load |
| **UI** | Roster portraits (portraitBatch), all groupings (incl. Directory), compact mode, triage mode (§8.8), sticky notes (§8.10), history search + web-links addons (§11.5), team crests in group headers, FLIP reorders, hover mini preview, "Follow herdr focus", peek overlay (`V`), notification stack, help + `?` overlay, onboarding, settings, perf overlay, offline mode, `?open=` deep links, "Why?" expander, Recent HQ actions panel |
| **AUD** | Procedural chimes, spatial dings, footsteps by material, typing near the player, ENG hum ∝ CPU, per-category volumes |
| **BE** | Audit log rotation + read endpoint for the Recent HQ actions panel; `notes.js` |
| **PLY** + **UI** | **Manager's desk** (§11.5, pulled from backlog): E on the mezzanine-rail desk → overhead tilt-shift camera over the atrium/Pit, click-select agents, roster docked; Esc stands up |

**M3 exit:** Art checklist 1–10 passes; stats agree with `free`, `top` and `df -x fuse` within 5%; night and golden hour
signed off (the numeric rows run since M1; M3 adds the full-office judgement: no raking shadows in windowless rooms, no
lamp popping while walking); the UI reviewer does a full P2 + Serve
run in both Electron and web, on Linux and macOS client profiles.

### M4: Juice & features (pull from §11.5; each item is small)
Paper-plane prompt (T) with confirm · pinned-agent hotbar with portraits · physical roll call · pat, summon and coffee
delivery · blow-dust verb · photo mode ("say cheese", filters, "on twos" claymation filter, PNG save) · Employee of the
Day · The Daily Diff newspaper · dance party · ping-pong rallies with an audience, high-fives · rain cloud + skylight
rain · seasonal decor, nightcaps, bell spam · departures board for tokens · per-agent CPU/RSS (`res`) → heat shimmer ·
`+ Shell` / new-agent spawn (gated) · Lab safety shower on test-fail · Electron tray + global hotkey + `claude-hq open`
CLI · **work-call zipline** across the atrium (§11.5; the player rides it too, §6.10) · rubber-duck verb · water-cooler
moments · photo-board / family-photo wall · spectacular arrivals & departures · join-in ping-pong · line boil · clay
footprints & sofa dents · split drawer · gated broadcast prompts · CRT live wall (§11.5).

### M3.5: "Walk up and manage" wave (LEAD producer plan, one package per owner; full specs in the wave brief)
Player/usability goal: walk up to any Claude and **see its face and its real screen**, understand what it is doing or
stuck on from one card, and **act** (answer, prompt, sign off, hire) in ≤ 2 keystrokes, from inside or outside the app.
| WP | Package |
|---|---|
| **UI** | Walk-up framing (goto/focus 3/4-front stand spots, carryover), status card v2 (todo ▶ line, lastText, work, context bar, stuck reason), `T` prompt bar + chips, Triage mode (M3) + inbox-zero, Hire dialog / `+ Shell` (gated), names/deep-link/unread/drawer-chip carryover, hotbar + Shift+N rename |
| **BE** | Real-usage path (web + Electron vs default read-only-safe and hqtest), `spawn` with first prompt, Electron tray/badge/global hotkey/notification deep link, screens feed at 8 ids, README.md |
| **BE2** | `lastText`, `work`, struggle `detail`/`context`, meaningful `news`, demo parity (prompt → working, spawn, varied cards), golden regen |
| **RND** | Monitor atlas + `screenFeed` arbiter (live desk screens), monitor-back tally lights, night lamp pools + mezz skyline + monitor spill, stats contract fixes, CA merge (stretch: DOF on inspect) |
| **PLY** | Monitor-dive transition, face-framing stand-spot helper, Manager's desk overhead camera (M3 row) |
| **CHR** | Hull LOD + `chars.tris`, glance-back/"shh", catch-plane/read, pat/summon replies, `dash` gait, crate unwrap, seated look-back wave |
| **BRN** | Social scenes that actually fire, §6.9 verbs (pat/summon), answered sprint arc, parcel-crate arrivals/departures |
| **FX** | Blocked lantern escalation, paper plane, hearts, inbox-zero confetti, struggle flare, carryover (serve queue card order, placardCheck n/a) |
| **STAT** | Big Board NEED YOU band legibility + marquee, café chalk specials, Lab chalk test tallies, §7.4 completeness audit |
| **ENV** | Carryover dressing (facade, MAIL wall, W-bay windows, library wall + rugs, lobby runner), triangle budget (`~far` twin), hiring-crate anchor |
| **AUD** | `amb.*` cues (carryover), new verb/plane/lantern/inbox-zero/crate cues, spatial blocked bell, mix loudness pass |

**M3.5 exit:** `__hq.focus('status:working')` at every E/W desk frames the face + a live, readable monitor; a
full hqtest loop (hire a claude with a first prompt → watch it work → answer its block → sign off) works from the web
build and from Electron with no terminal needed; default session: every structural action refused with an explanation
and `scripts/integrity.mjs` unchanged; `mixed` over 4 min shows ≥ 1 rally, huddle and high-five; 60 fps `mixed` medium,
≥ 45 fps `crowd40`; `npm test` green; README lets a new user install, run, tunnel and play.

### 11.5 Backlog / ideas (append freely; pulled into milestones when they earn it)
**Adopted in v2:** window gobo light; per-zone colour script; state-driven outline; polymer-clay micro-surface;
activity glyph; Blocked Inbox; observe-first terminals; headless mirror feeding desk monitors; `agent.explain` expander;
record/replay; perf regression gate; amenity bays; long-idle dust ladder.

**Adopted in v3** (now in the plan): capsule-stroke display face (M3, §5.1); smear frames + 2-frame holds (M2, §6.3);
distance-scaled hull width (M1, §5.1); interior glass reflection (M2, §5.6); complementary staging + hue-gap check (M2,
§5.5); sign-off parcel run (M2, §6.4); struggle signal (M2, §4.4/§6.7); work-call zipline (M4); `?` key overlay from
`keymap.js` (M1/M3, §8); unread (M3; redefined in v4, §8.9); pinned agents with fixed 1–9 (M1, replaces M4 control groups); roster
compact mode + blocked-first sort within group (M3); Recent HQ actions + audit log (M3, §4.8/§8.5); default-session
integrity script (M1, §9.3); `/debug/metrics` (M1, §4.11); staggered/chunked transcript parsing (M1, §4.4); monitor
atlas (M2, §5.3); golden replay fixture (M2, §4.9).

**Adopted in v4** (now in the plan): task placards (M1.75, §6.7); player feel block, ride the slide, sit (M1.5, §6.10);
Shelly idle ladder (M1.5/M2, §6.4.1); while-you-were-away recap (M2, §6.4.5); server timeline ring (M2, §4.3.1); ENV
prop kit + hero-zone gate (M1.75, §7.5); `hq doctor` (M1, §9.3); chaos harness (M2, §9.3); per-pass GPU budget bar +
pass shedding (M3, §5.2); triage mode (M3, §8.8); "needs you" sort + age heat tint (M1, §8); sticky notes (M3, §8.10);
Manager's desk (M3, pulled from this backlog); macro-stress weather (M3, §7.4); pixel-Clawd screensavers (M3, below).

**Queued for M3 (small, earned their slot):**
- *Pixel-Clawd homage:* idle/locked desk monitors, the Big Board's screensaver, parked Shellies' faces and one Studio
  Street neon sign show the original pixel-art Claude Code mascot, drawn as a **shader bitmap** (a const bit table in
  `dotmatrix.js`, no asset), so the 3D toy and its 2D source visibly rhyme. The neon one gets a 2-frame wave loop.
- *Team crests:* a procedural crest from `hash32(workspace.label)` (shape grammar: shield / circle / flag + 1–2 Bauhaus
  glyphs in the workspace jewel + cream trim) on the bay banner, rug, Shelly chest plate and roster group header: a
  second identity channel beyond colour and accessory (canvas into the signage atlas; CSS/SVG path in the roster).
- *xterm addons:* `@xterm/addon-search` inside the history overlay (Ctrl+F, n/N) and `@xterm/addon-web-links` (file
  paths and URLs clickable; `file:line` → copy path, or glide to the owner's desk).

**Queued for M4 or later:**
- *(FX, M2)* **Bubble tails that point home:** when declutter nudges or edge-clamps a bubble, bend its tail toward the
  speaker's head (tail tip drawn per frame as a 2-quad ribbon) so a nudged bubble never reads as someone else's; and a
  thought bubble 'pops' into 3 little puffs (particle pool) when thinking ends, a tiny reward for watching.
- *Hand-made line boil:* under "on twos" / photo mode (optionally High), hull width ±8% with per-actor noise re-seeded at
  8 Hz so outlines shimmer like stop-motion. One uniform; reduced motion disables it.
- *Living family-photo wall + photo-board trophies* (merged art + gameplay idea): a Lobby corkboard where the game
  pins render-to-texture polaroids of notable moments (first commit of the day, a 10-deep queue, a 6 h sleeper, a
  test-pass streak; capped, from the timeline) plus a daily posed group portrait by workspace; a rolling strip of the
  last 7 days so the office accumulates history. Portrait renders reuse `portraitBatch` at 256², ≤ 1 per minute.
- *Clay footprints & felt dents:* carpet/felt floors take faint decaying footprint decals from the blob-shadow instanced
  pool along walked paths; Pit sofas keep a squash dent for 20 s after a Clawd stands up.
- *Rubber-duck verb:* hand a procedural squeaky duck (E with a duck from the Help Desk bin) to an agent with
  `struggle.level ≥ 2`; it sets it on its desk, squeaks at it occasionally until struggle clears, then tosses it back
  into the duck bin. Cosmetic, never lies (§6.9).
- *Water-cooler moments:* idle agents of the same workspace sometimes meet at their bay's nap spot or the café and
  "talk" in glyph bubbles showing each other's last tool icons: workspace membership readable socially.
- *Spectacular arrivals/departures:* new panes arrive in a lobby parcel crate (unwrap anim) or on a tiny delivery
  scooter; closed panes wave goodbye through a revolving door (only for post-boot `arrived`/`left`, §6.4.3).
- *Join-in ping-pong/foosball:* with two idle agents at the table, E takes a paddle for a 20 s click-timing rally;
  the loser agent does a dramatic `slump`, the winner a `victory`.
- *Split drawer* (Leader `\`): two terminals side by side (e.g. a Claude and the Shelly in its cwd), within the 2
  WebGL-context budget.
- *Broadcast / quick-prompt* from the palette: `prompt scout: <text>` (confirm) and "continue all idle in ws:hq-core"
  (interact class, confirm dialog listing every target; never in read-only mode).
- *Thin-client mode for slow tunnels:* permessage-deflate for JSON only (never `term.data`) and field-level JSON-merge
  patches for `entity`; ~5–10× fewer WS bytes at 40 agents.
- *CRT live wall* (merges the CCTV idea): a bank of 9 diegetic CRTs in the Lobby showing the pinned agents' screens at
  1 Hz from the monitor atlas + mirror `screen`s; E on a CRT opens that drawer tab. A second, honest route to P2.
- *Physical roll call* (`Ctrl+K` "roll call" or a whistle object): every agent jogs to the atrium and lines up in labelled
  floor lanes by the current group-by key, holds 6 s while you walk the lines, then scatters back. Honesty: only idle and
  acked-done agents move; working/blocked ones raise a sign with their lane from where they are.
- *Claymation "on twos"* photo filter: characters step at 12 fps and hull vertices boil slightly per frame.
- *Identity stickers*: the workspace accessory icon as a decal on laptops, mugs and the bay sign (same SVG paths as the
  roster chips).
- *CCTV wall* behind Ada: low-res render-to-texture feeds of occupied bays + Lab + Library at 1 Hz; `E` on a feed glides
  there. Needs a draw-call budget check (1 extra scene render per second, round-robin).
- *The Daily Diff* newspaper stand in the lobby: a front page generated from today's events (commits, test streaks,
  longest block, Employee of the Day).
- *Peek window* (`V` hold on a storefront or monitor): a translucent read-only observe overlay anchored in the world.
- *Proximity peek*: within 1.5 m of a desk, its monitor switches to a live observe stream (budget: ≤ 2 at once).
- *Pinned-agent hotbar* with portraits along the bottom (keys already bound: 1–9 / Shift+1–9, §8.2).
- *Session switcher / campus*: one backend exposing every herdr session as an elevator "floor"; non-default floors
  mutable, default read-only unless `allowMutations`.
- *Day timeline* replay (ghost trails on the minimap), fed by `--record`.
- *Work-call zipline / people-tube* (M4): handles on a cable from the café/Nap Nook across the atrium ceiling (y 4.2) to
  a landing by the E-bay back doors; used by the work-call rule when the path is > 15 m: grab, zip in ≈ 3 s, squash on
  landing. Counts as walking-while-working time (it is travel).
- *(CHR, M2 ideas)* **Duckling commute:** mini-Clawds already fall in behind a walking parent in a hopping line; on
  a station trip they could each carry a tiny version of the class prop (a book, a flask) and peel off at the station
  door to "file" things. **Shelly screensaver sneeze:** a parked Shelly whose dust level ≥ 1 sneezes static (screen
  flashes noise, antenna boings) when the player walks by. **Backpack burst:** at 180k+ an overstuffed backpack spits a
  paper every ~40 s that flutters to the floor and fades (particles, cosmetic, honest: it only happens near the context
  limit). **Victory photo-bomb:** a same-workspace neighbour within 3 m of a `victory` leaps into frame with a `highFive`
  (both hitstop 60 ms).
- *Office mood ambience* from aggregate truth: footstep/keyboard chatter density, string-light tempo and a procedural
  lo-fi bed follow the working/blocked/idle counts; a blocked backlog adds a tense undertone that resolves with a sting
  when the queue empties (AUD).
- *Best friends*: the agents you pat or high-five most wave from across the room and, when idle, sometimes wander over
  to show a doodle of their current tool (cosmetic, seeded; obeys §6.9).
- *Split triage view* (superseded by v4 triage mode, §8.8; kept for the split layout): left column of blocked agents (question + options inline, answer with 1–9) beside the
  live terminal of the selected one.
- *Diorama set dressing*: at zone cut-lines a visible cream wall-top cap with a faint thumbprint texture; occasionally a
  tiny ambient "stagehand" mini-Clawd (no ring, no plate) repositions a prop.
- Achievements; framed commit messages on bay walls; a layout-rect "wall of monitors" per tab (herdr `layouts`); a
  `pane.output_matched` watcher for "tests passed"; a kanban of todos across agents; an agent "diary" card from
  `lastPrompt` history; weather tied to CI; a split-flap arrivals board for new panes.
- *(UI, M2)* **Inbox card flies from the queue**: when the Blocked Inbox opens, each paper card animates out of the
  queued Clawd's ticket (world → screen projection) and an answered card flies back into its hands before it hops
  "thanks!"; the 2D and 3D blocked stories become one gesture. UI emits `bus 'answered' {id}` already.
- *(UI, M2)* **Inbox zero moment**: answering the last blocked agent pops a small confetti burst from the HUD "all clear ✓"
  pill and the help-desk bell dings once (FX/AUD listen to `answered` + queue length 0).
- *(UI)* **Minimap ghost ping**: clicking a dot on the minimap (not the overview) pings that agent in-world for 1 s (a
  ring + nameplate via `bus 'roster.hover'`), without moving the camera.
- *(BE/BE2, M2)* **Permission-first demo**: demo agents now stop mid-turn for Claude Code's real permission menus
  (the exact Bash command / edit target / fetch host / MCP tool they are about to run) and resume the same turn when
  answered; newcomers ask the folder-trust question. Idea on top: the Serve card could show the *pending tool* as a
  prop the Clawd holds up (a tiny `npm test` cartridge, a file sheet), so the ask reads in-world before any text.
- *(BE2)* **Shell stories on monitors**: demo shells print like the real thing (a test runner ticking ✔/✖, a dev
  server's access log, a training loss curve, a vim/top frame in the alt screen). A follow-up: STAT/RND could tint a
  desk monitor's glow from its last line kind (green ✔ burst, red ✖, amber `^C`) — the `screen` lines already carry it.
- *(BE)* **Timeline scrubber**: `timeline.get` has 24 h of status transitions + events per stable identity; a roster row
  hover could show a 24 h ribbon (working/blocked/done bands) and the away recap could replay the last hour as a 5 s
  time-lapse of the office (actors jump between desk, queue and sofa by the recorded transitions).
- *(BE)* **Why? from herdr**: `agent.explain` now replies with a compact `why {state, rule, region, evidence}`; the
  status card could show the matched rule as a one-line "herdr thinks blocked because: *live_blocked_form*" with the
  evidence preview on hover — great for trust when a status looks wrong.
- *(PLY)* **Slide exit "stick the landing"**: time Space within 0.15 s of the slide exit → a hop instead of the carry,
  a bigger FOV pop and a louder cheer from the Clawds within 4 m (they score it 1–10 on held-up cards). Pure bus events
  (`player.slide` exit + `player.land`), zero new art beyond the score cards.
- *(PLY)* **Sofa bounce**: jumping while seated on a Pit sofa bounces you (squash spring on the camera, cushion puff),
  and the done agents in adjacent seats bounce with you — a cheap "join the party" beat for the done lounge.
- *(PLY)* **Coaster-cam photo**: `P` during a slide ride takes a mid-ride photo with the roll + FOV kick baked in and the
  nearest cheering Clawds framed; it becomes the away-recap header when the player last rode within the hour.
- *(BRN → CHR)* **Work-call dash look**: BRN now speeds a long work call up to 4.6 m/s so the leg home takes ≤ 6.4 s
  (`tuning.workCallBudgetS`, M1.5 fix r1). Give it a cartoon gait: leaning run, wheel-legs smear, a dust puff per
  step and a skid-stop into the chair (`setGait('dash')` when the motor's speed exceeds 3 m/s).
- *(BRN)* **"After you!" standoff**: a walker blocked by the player now waits and waves instead of squeezing past. If the
  player stays put for 8 s, the Clawd taps its foot, then does an exaggerated tiptoe detour (or a leapfrog hop over a
  low obstacle) — a small comedy beat that also rewards stepping aside.

---

- **(LVL fix r1) Café reach from the E bays.** The café proper is 26–35 m from E2/E1 desks (E3 ≤ 25 m); the coffee
  cart (Lobby NE) and the library tea trolley keep the "coffee" idle pick ≤ 20 m for every E desk. If BRN wants the
  full café loop within 25 m, a café kiosk on the atrium east edge (x24.5–26, z17–20) is the cheapest place.
  *(LVL fix r2: that spot is the `pitOverview` camera's stand (25.5, 19); the E bays' non-coffee picks are now the Library
  tea-corner café table (24.9, 5.75), a 3rd arcade cabinet on the Library's west pier and the ping-pong table in the atrium's
  NE pocket: ≥ 3 non-coffee picks ≤ 25 m for E1/E2/E3, `walktimes --check` enforces it.)*
- **(LVL fix r1) Vis cells are nearly all-to-all.** The open plan means sampled visibility gives little (most cells
  see ≥ 15 of 21); the triangle win comes from per-region frustum culling + per-part draw distance (`far`) in the
  kit. Consider low walls/shelving between the NE block and the café to make NE/CAF/NAP separate cells, and an
  impostor for the exterior cards beyond 30 m.
- **(LVL fix r1) Near-patches at 2.0–2.25 m** (ARC east floor (39.9,7.6), LAB (9.6,25.1), CAF (30.6,26.1)): under the
  2.5 m gate, but the next ENV dressing pass should put a story-prop cluster in each.
- **(LVL fix r1) Nav-wait 'think' pose.** Actors held by the A* budget (`a.navWait`) just stand for ≤ 1 frame today;
  if the queue ever backs up (dozens of agents re-planning at once), BRN could play a short look-around.
- **(FX fix r2) Back-to-back bay desks hide the near card from across the desk.** In the E/W bays the opposite
  column's monitor stands in line with a desk's pod-centre corner, so from the focus() front view the (face-safe,
  tested) near card is often behind that monitor. LVL/ENV could offset the two columns' monitors (or seat the column
  pairs 0.25 m apart) so the corner shows; or the Serve / status card could echo the task instead.
- **(FX fix r2) Stack cohesion for queued alerts:** the declutter stacks a queue's cards in wait order, each naming its
  agent; a thin coloured stripe per card in the agent's workspace colour (the plate is dropped when there's no room)
  would tie card ↔ Clawd at a glance.
- **(UI M3) Portrait hand-off contract for portraitBatch (CHR):** the roster, drawer tabs, status card and inbox draw
  procedural SVG portraits today (`ui/dom.js portraitSvg`: kind body, state face, the workspace accessory = CHR's
  `colorIndex % 8`). Proposed seam: `ctx.portraits = { request(id, px) → HTMLCanvasElement|null, onReady(fn(id)) }`;
  the UI swaps the SVG for the canvas when one is ready and keeps the SVG as the fallback (no GPU work while the roster
  is closed).
- **(UI M3) Ada reacts to the tour:** `bus 'onboarding' {done, skipped}` is emitted by `ui/onboarding.js`; AMB's Ada
  could wave on start, point at the aimed agent on card 3 and clap on finish.
- **(AUD M3) Shelly machine foley:** each Shelly activity (§6.7 table) has an obvious sound: crank generator whirr
  (serve), furnace door clank + coal shovel (build), cocktail-shaker rattle (repl), newspaper rustle (monitor), knitting
  clicks (edit), walkie squelch (remote). AUD would need a cheap hook (actors' `a.intent.activity` is enough, as typing
  already uses it); positional, ENG only, ≤ 3 benches audible at once.
- **(AUD M3) Procedural lo-fi bed:** a quiet generative marimba/Rhodes loop in the Café and Pit whose tempo and chord
  follow the working/blocked counts (the §11.5 mood idea, second half); AUD already has the marimba voice and the mood
  undertone to build it on. Off by default, its own `volumeMusic` setting.
- **(AUD M3) Remember who you pat:** the same Clawd's voice warms (higher, happier contour) toward the player after
  high-fives/pats in the session; pairs with "Best friends".
- **(BRN M2, landed) Social scenes** (`brain/social.js`, tunables `SOCIAL` in tuning.js; only *free* idle agents are
  ever cast, and a gig runs only from the brain's idle branch, so any status change ends it on the same frame):
  ping-pong **rallies** on one shared clock (a lone player waves a colleague over; synced swings via animator
  `setSync`, one real ball over the net, a miss every 5–13 crossings, the winner hops) with an **audience** that walks
  over and claps points; **high-five on done** (the nearest free pod-mate by walking distance ≤ 6.5 m trots over, the
  done agent waits ≤ 4 s for it); the **Pit welcome wave** (seated done agents clap in turn round the ring); **Big
  Board huddles** (2–3 idle agents on the far Pit rim look up, point and chat after a `finished`, or every ~2–3 min);
  **coffee invites** (a lone drinker waves a colleague over; the water-cooler chat takes it from there); **inbox-zero
  applause** round the Help Desk; a "whee!" bubble down the slide. `__hq.metrics().social` counts them; debug
  `window.__hqSocial.stage('rally'|'huddle'|'watch')` (proposed as `__hq.social`, CORE/LEAD).
- **(BRN idea) Rally commentary:** the Big Board's ticker (STAT) could show the live ping-pong score (`social.counts().rally`)
  while a rally runs ("gale 3 : 2 tinker"), and the Pit crowd turns to look on a long rally (≥ 12 crossings).
- **(BRN idea) Cheer the ship:** when a parcel drops into the OUTBOX chute, idle agents within 6 m look over and one
  claps (the §6.4 sign-off run is currently a solo beat); reuse the social poke queue.
- **(BRN idea) Board huddle reads the Board:** have the huddle's chat bubbles show the actual name that just finished
  (a tiny name chip instead of a glyph), so the gathering visibly discusses *who* shipped.
- **(FX idea) ENV publishes sign geometry:** `layout.bays[].signs = [{x,y,z,yaw,w,h}]` (street + atrium) and a
  `layout.signs` list (HELP DESK …), so FX's storefront strips / declutter sign obstacles stop mirroring greybox.js
  constants (`fx/placards.js stripSpots / signQuads`).
- **(FX idea) Pennant hand-off:** on sign-off the ✓ pennant is rolled up and tucked into the OUTBOX parcel (a 0.3 s
  furl before the parcel pick-up), and a strip line flashes "shipped ✓" for 10 s.

- **(AMB idea) Agents pet the cat:** the chill list's `cat 1` pick has no target today. AMB exposes
  `ctx.ambient.catPos()` (world {x,y,z}, perched or not); BRN could route a `cat` chill pick there (floor-level cat only)
  and play CHR's existing `petCat`; the cat would purr + hearts when an agent is within 0.8 m.
- **(AMB idea) Segfault rides Dusty:** when the roomba passes a sitting cat in the lobby, the cat hops on and rides a
  lap (loaf pose on the lid, tail over the side); dismounts at the dock or when bumped.
- **(AMB idea) Vault nap together:** an agent on the §6.4.1 "vault nap" hobby curls up next to the cat when Segfault is
  already napping at the vault (AMB sends the cat there when a vault-nap agent appears; BRN reads `catPos()`).
- **(AMB idea) Bell spam frown (GP §5.9):** 5 bell rings in 3 s → Ada frowns and taps her headset; AUD's bell sfx
  emits `bus 'desk.bell'` so AMB can count (no owner emits a bell event yet).
- **(BRN, done m2-r2) Showcase regulars:** `social.js` keeps a dwell floor — one idle (or spare done) agent parked in
  each empty showcase room (Café, Pit, Library; `SOCIAL.regularRooms`) plus one touring room (street, a W amenity bay,
  Lab, Round Table, Nap Nook; `regularTour`), seated in the spot best framed by the room's `keepClearViews` camera.
  Idea: AMB's Segfault could read `__hqSocial.roomEmpty(zone)` and wander to the Lab / Mezzanine when no agent is free.
- **(AMB note) Fish tank prop contract:** the boids school lives in the tank's water box (footprint inset 0.06 m, y
  0.74–1.26 above the floor, front = local +z). ENV's tank must render glass + tinted water, not an opaque box
  (greybox.js draws it opaque, which hides the school).

- **(ENV idea) Floors carry their inlays as coplanar vertex-coloured rings/strips:** edge.js is a planarity test, so any
  decal lifted even 4 mm draws a line at grazing angles. ENV M1.75 rebuilt the Pit/atrium inlays as coplanar rings that
  share rim vertices; the M2 breadth pass should do the same for every zone rug border, threshold and lane stripe (rugs
  are now 6 mm, one layer + sub-mm stripes).
- **(ENV → RND) edgeCheck auto region vs real steps:** the auto floor mask counts floor-on-floor silhouettes (Pit tread
  edges seen from the rim, flat tops of benches/tables over the floor) as swim. Proposal: skip pixels where the w-jump
  between the two sides is a step > 3 cm (a real crease), keep the coplanar test for pattern/decal swim.
- **(ENV idea) Lived-in dust / wear map per cell:** the kit baker already writes per-vertex AO; a second baked term
  (floor wear under chair casters, a darker path worn along the queue rope, scuffs at door jambs) from `layout.lanes`
  would make the diorama read "used" at zero runtime cost.
- **(ENV idea) Hearth → social magnet:** the Pit hearth (lamp kind `hearth`) could flicker its pool gain ±6 % at 3 Hz
  and BRN could weight Pit chill picks toward the two sofas facing it after dark.
- **(ENV idea) Story props follow the agent:** a desk's seeded mug / sticky note / book stack could come from the
  agent's history (a note per blocked prompt this session, a mug refill per long task), so each desk tells its
  occupant's day.
- **(RND idea) Sun patch tracks the clock across the Pit:** the skylight gobo already moves with `sunDirection`; a
  subtle 1.5× patch gain in the 30 min before sunset (patch climbs the atrium's east wall) would make "late" visible
  from the Pit without a clock. Zero cost (uniform only).
- **(RND idea) Zone-grade handoff as a doorway cue:** `zoneGrade` already cross-fades over 1.5 s on vis-cell change;
  keying the fade start to the portal the camera crosses (rather than cell centroid) would make each doorway a small
  "colour door" (warm LIB → cool STR) that reads as entering a new room.
- **(RND idea) Night lamp flicker on blocked agents:** the nearest desk lamp to a blocked agent could dip its pool gain
  10 % once every 4 s: a diegetic "someone needs you" at night that costs one uniform write.
- ~~**(RND → CORE) Register `hueGapCheck` / `greyCheck` in `HQ_PLUGGABLE`** (today on `__hqRender.checks`) and call
  them from `review-shots` so §5.5 hue-gap and §9.1 grey-blob rules are gated, not hand-run.~~ Done (CORE, m175 fix
  r1): both are `__hq` calls; `review-shots` runs edgeCheck + hueGapCheck + greyCheck at every radiometry pose × hour.
- **(RND fix r1 → §5.0 proposal) Lighting deviations made for M1.75 art r1:** (1) the atrium skylight gobo uses the
  true sun azimuth with the elevation clamped ≥ 50° (`lightMath.goboSkyDir`), so golden hour lands a warm patch on the
  Pit/atrium instead of 18 m away; golden patch ×4.4 (day ×3), scaled down on bright albedos (a sunlit cream wall caps at
  the shoulder). (2) Lamps lay a compact plateau pool disk (`POOL_RADIUS` by kind) over a wash at 30 %; props (rugs,
  sofas, desk tops) take the env night pool scale. (3) The Pit hearth runs at 4× the per-lamp cap with 1.8× reach and a
  ±6 % 3 Hz flicker (open flame, surrounded by albedo ≤ 0.45). (4) Golden hour = warm sun patches in a cool dusk-lit
  room: golden `ENV_TINT #DEE6FF`, env golden kKey .60 / kAmb .60 / kSun .20 (per-channel peak 1.08 ≤ 1.14), golden LUT
  split-tone (near-neutral mids, amber highlights, dusk-violet shadows). A warm golden base light failed hueGapCheck at
  18 h (0.1–0.4). (5) `edgeCheck` skips real steps (≥ 1.5 cm height jump, not 1 px slivers) and is decisive on
  every pose; `greyCheck` counts screen/readout pixels via an emissive-off + screen-mask frame.
- **(RND fix r2 → §5.0/§5.5/§5.6 proposal) M1.75 art r2 deviations:** (1) skylight gobo floor 50° → 60° so the 18 h
  patch lands on the Pit's east half + atrium ring (visible from pitOverview / spawn); the skylight patch has a soft
  0.1 m penumbra and 30 %-dark mullion bands; golden patch ×10 of kSun in `sunCol` softened 15 % toward white, **value-
  capped per pixel** at linear Y 0.34 (or +12 % over the unlit value), so it always sits just under the §5.0 golden
  "gobo ≤ 66" row (dark rugs / sofas take the full light, walls a gentle lift). (2) Golden sky: rose zenith `#D9A0A6`,
  peach horizon only toward the sun's azimuth, lilac `#BFB2D9` elsewhere; exterior horizontal glass (the skylight) is
  frosted (peach at golden, blue-grey by day), which also took the skylight rim out of greyCheck's top 10.
  (3) **Complementary staging is spatial** (`zoneGrade.js` STAGES → `uStageRect[4]`): env + props inside the Clawd
  hotspots (ATR+LOB+PIT, bays+STR, CAF+NAP) take the hero-zone grade whatever cell the camera is in, and warm
  mid-chroma, mid/dark albedos there (walnut, oak, brass, warm concrete; opponent hue 41–110°, not light accents, not
  clay-hued) are pulled 65 % toward grey (LIB/MEZ 50 %, keeping their own grade). Proposal for ENV: bake the same
  intent into the hotspot palettes so the shader pull can drop. (4) `hueGapCheck` samples the ring round **Clawd**
  masks only: blobs of the chars + hulls frame (FX overlays excluded) that contain ≥ 12 clay-hued body pixels —
  placards' ink hulls, the roomba, the cat and non-clay kind bodies no longer count (§5.5 text: "each Clawd's mask").
  Also: probe/greyCheck `at` is CSS px, hueGapCheck `fails` (debug option) are buffer px (y up). A tried additive
  god-ray prism (golden shaft) was dropped: without scene depth it hazes occluders inside the beam (Big Board) and
  its warm haze over the Pit cut hueGapCheck to 0.5–0.6 at 18 h; revisit with the depth texture in CharPass (High).
- **(RND → ENV) Ink slide posts vs greyCheck:** the slide's centre pole / support posts are `CORE.ink2` against the
  pale atrium wall; at pitOverview 13 h one post block (852,344, RMS 28.4) is the only non-character entry in the
  top 10. A mid-value post (walnut / slate, L* 35–45) would clear it.
- **(RND → ENV) Dotted ink along the Pit's brass inlay ring** (seen at 2 m, `5.5,0,2,0.785,-0.9`): 1 px holes where
  the ring meets the checker band (T-junctions show the ground below), drawn as dashed edge lines. Share rim vertices.
- **(RND idea) Moon patch:** at night the skylight could lay a faint cool (#9FB4FF, ≤ 0.05) moon gobo on the Pit,
  the only cool light in a warm-pooled room; one uniform write, same gobo code.
- **(BRN m175-r2 → LVL) Crowd pinch points** (`actors.js` crowd avoidance, `__hq.metrics().crowd`): the served help-queue
  head can only leave back through the 1 m serpentine (the rope's one gap is the NE entry), past everyone in line (BRN
  now has them "make way" 0.3 m and moves the line up only once the place is free). A rope gap by the head (west or
  south) would let it leave cleanly. The two Pit-gap beanbags (r 1.35 at ±20°) sit 0.92 m apart across the N/S gap
  lanes, so walkers can only brush between two loungers, and the 0.95 m aisle between the ping-pong table and the
  stairs is one body wide for two-way traffic. Moving the beanbags off the gap axis and widening that aisle would
  clear the last Pit squeezes.
- **(ENV M2 breadth LIB/MAIL/ARC idea) Living mail + stacks:** `outboxChute` exports `anchors.mouth` (the hopper) and
  `anchors.bell` (the ship's bell on its bracket); FX/AMB could tip the flap and ring the bell (a 0.4 s swing) on every
  sign-off parcel drop, the diegetic half of the "Cheer the ship" idea. `capsuleTube` exports `anchors.tray`: commits could
  pile capsules in the tray (≤ 6, emptied at midnight) so the Mailroom shows the day's commit count at a glance. The
  Library ladders hook a brass rail that runs the whole shelf wall (x 14.9–26.3, y 1.33): the `ladder` activity could
  roll its ladder along the rail to the reader's shelf before climbing.
- **(ENV M2 breadth perf note → ENV/RND)** With every zone dressed, the single office-wide kit draw group (`K`) is
  ≈ 0.95 M kit triangles drawn (+ shadow pass) from every pose: 1080p uncapped on the 780M, `library` 1.71 M tris /
  86 draws / 158 fps, `spawn` 2.12 M / 139 / 132 fps, `pitOverview` 2.03 M / 111 / 89 fps. `?kitLod` (per super-region
  groups + half-detail twins) measured 1.16 M / 100 / 165, 2.04 M / 169 / 139, 1.57 M / 136 / 131 at the same poses:
  per-region groups (maybe without the twins) plus a shadow-caster distance cap are worth re-measuring now that breadth
  fills the building (§5.3 ≤ 500 k visible).
- **(ENV M2 LAB/ENG ideas)** *Boiler whistle:* the ENG boiler (`kit/workshop.js` `boiler`, `anchors.steam`) puffs an AMB
  steam vent and toots when STAT's boiler gauge passes 85% (the gauge already rattles), so a CPU spike reads from the
  Pit through the ENG glass. *Firebox ∝ load:* its firebox window (a `bulb` part today) could ride a per-object gain.
  *TEST light "running":* amber lens steady while any agent at the Lab station has a `test`/`build` activity (today:
  standby amber dim, pass green, fail red blink; `build/labLight.js`). *Spare heads:* a Shelly that exits (§6.7 smoke
  puff) leaves its CRT on the ENG parts crate for a minute.
- **(ENV M2 breadth W/STR ideas)** *Neon flicker on change:* the rollup neon (`build/zones/neon.js`, one instanced tube per
  bay display window / E glazing / lamp post) could stutter off-on twice when a bay's rollup changes (the "sign buzz"
  AUD could pair with it). *Amenity life:* the W1 piano bench, W2 treadmill belt and W3 sun lamp are amenity slots;
  BRN/CHR could give them bespoke loops (piano = two-hand bob + note sprites, treadmill = jog in place while the belt
  slats scroll, greenhouse = watering-can tilt with a drip), so "2 inside" on the sign is visible from the street.
  *Moving day with passengers:* the crate parade (`build/zones/movingDay.js`, `ctx.movingDay.trigger(from, to)`) could
  hand one crate to the nearest idle Clawd, who carries it across the street instead of the crate hopping alone.
  *Street market hour:* after 17 h the flower stall's canopy bulbs light (a `bulb` string) and one A-frame flips to
  "happy hour · café →", nudging idle traffic toward CAF.
- **(ENV M2 breadth CAF/NAP/MEZ ideas)** *Barista moment:* the espresso bar (`kit/lounge.js`, `anchors.machine` /
  `anchors.wand`) has no barista; the Lobby's Ada (AMB) could walk over at 8 h / 15 h, pull a shot (the AMB wand
  "pssht") and leave a mug on a random café table, which a coffee-slot Clawd then carries back to its desk. *Round Table
  cards:* the Round Table's task cards (one per seat, `roundTable` parts) could become one placard quad per seated
  `task` agent (FX placards) so the table reads as the team's live plan from the mezzanine rail. *Orrery ∝ network:* the
  Observatory orrery's planets could rotate at a rate ∝ network throughput (STAT `net`), with the sun (`bulb`) pulsing on
  each web fetch of an Observatory agent. *Canopy shooting star:* one star-canopy pin streaks across the Mezzanine sky
  when an agent turns `done` (a single FX quad, ≤ 1 per 30 s). *Lamp anchors to add (LVL):* the café marquee cup
  (warm, gain ≈ 0.18) and the orrery sun (butter, ≈ 0.12) glow but light nothing; two `lamp` anchors would give them
  pools. *Mezzanine nav:* `dressObstacles` now emits level-1 circles for props standing on the mezzanine (orrery, crate,
  cubbies, floor lamps); the Library side might want the same for any future level-1 dressing.
- **(INT M2)** *NAL / WAR dressed:* the Reading Alley and War Room fell between the five ENV splits and were still
  greybox; `zones/alley.js` / `zones/war.js` dress them from the existing kit (no new builders). *War Room todos:* §7.1
  says the WAR whiteboards "render real todos"; nothing draws them yet: an FX placard quad per rolling board (the
  `station:war` agents' todo items, `whiteboard` face = local +z, y 0.55–1.5) would make the room a live planning
  wall. *Kit shadow tiles (perf):* the office kit is one merged draw group (`K`), so the 24 m sun-shadow box can't
  cull it and the shadow pass redraws ~0.6M kit triangles every frame. Measured: dropping every kit caster = −580k
  tris for only +4–5 % fps on the 780M (frames are fill / post bound, ~7 ms), so not urgent; if triangles ever
  matter, bake a position-only caster copy per vis cell on the CASTERS layer only (main pass keeps one `K`).
- **BRN m2-r1 (ideas + proposals).** *Proposal (§6.4.1):* the "< 2 min at the desk" tier is 45 s in `tuning.js`
  (`idleDeskMs`): real idle stretches are long, but in `mixed` (idle 15–150 s) the chill list never showed and the
  storefronts stayed empty. *Proposal (§6.4.1 10–60 min):* long-idle agents share one nap / hobby cycle
  (`idleCycleS` 450 s) offset by their rank k / n (`director.idleRank`), hobby share max(0.4, 1/n + 0.08), so with ≥ 2
  long-idle agents someone is always up; naps: 35 % desk, the rest bay nap spot / Pit beanbag or sofa / Nap Nook bunk
  (naps no longer lengthen past 1 h). *Proposal (§6.5):* a per-actor walk budget on top of the 2× rule
  (`walked + 2·travel ≤ 0.3 × (worked + remaining)`, none before 90 s of working, `phase.js`), cooldown 90 s. *Proposal (§6.4.4 / §7.1):* a
  queue of ≤ 5 uses every other lane place (1.41 m apart, single file through the whole lane, `capacity.spacedLane`);
  only the head waves / holds its hand up (`queueWait` for the rest). *Proposal (§9.2):* `serve` pose z 8.1 → 8.7 (queue
  head 2.2 m off). *Proposal (§6.4 done row):* done agents' Pit outings (seat held) are more frequent (every 70 s,
  25–45 s): the first of a stay is a cocoa at the Café proper or a street-bench / storefront stroll, the second a Nap
  Nook bunk, a slide ride or an amenity bay (the M2 "no empty storefronts" rule); a slide-drought bias keeps rides coming; a queue "ticket number" stub on each queued agent (#1…#5) would pair with the spaced
  lane. *Idea:* a Lab "peek" chill pick exists (idle agents stare at the bubbling flasks; any test phase evicts them);
  a War Room equivalent (doodling on a spare whiteboard corner) needs a non-work whiteboard activity from CHR so it
  can't read as `todo`.

- **RND m2-r1 (notes + proposals).** *Program matrix:* `toonProp`/`toonEnv`/`foliage` are always `VCOL` (post.js gives
  uncoloured geometry a white `color` attribute and every hq InstancedMesh a white `instanceColor` once at its layer
  sweep), which folded 17 → 13 scene programs and removed the 12.5 KB/frame `getParameters` churn (the flips of
  `instancingColor` between the kit and moving-day meshes). The one non-instanced `screen` (plan pose) is the 14th.
  *Shadow cache:* the sun box snaps in 1.5 m steps (64 texels) on all three light-space axes; env casters that stayed
  still for 2.5 s are baked into a depth copy and only characters and recently moved casters are drawn per frame (the
  depth copy is blitted back instead of three's clear). Stats: `__hq.stats().render.shadowCache`,
  `__hqRender.post.invalidateShadows()`. *Architecture depth prepass:* walls, floors and ceilings (`LAYERS.PREPASS`)
  are laid into depth first with the shadow map's plain depth program (BackSide + inverted winding, so no new program),
  which saves ≈ 0.2–0.6 ms of fill. Its ≈ 9 depth-only draws are counted as `drawCalls.prepass`, not `main`;
  `composer.passes[0].prepass = false` turns it off. *GPU profiler:* `__hqRender.post.gpuProfile(ms)` gives per-pass
  GPU means (`EXT_disjoint_timer_query_webgl2`), with the shadow render split out. *Proposal (§5.0):* windowless-zone
  eye adaptation, where the STR zone gets exposure `EXPO_MAX` = 1.14 / lit luminance (the invariant still holds
  per channel; `zoneGrade.test.js`), and an env-only sky-fill soften (`ENV_SKY_SOFTEN` day 0.25 / golden 0.5), so the
  street and the Pit reach p50 0.20 without raising the character gains. *Proposal (ENV):* the two visible `~far` kit
  runs are ≈ 219 k triangles each at spawn; a half-detail twin or a distance cap on them is the next triangle win.
  Ink poles and posts against cream walls (the slide pole, lanterns, the arc-lamp shade) are most of the remaining
  greyCheck hits. The café at 22 h is dim (p50 0.12 against 0.14), and one more warm lamp anchor at the counter would
  fix it. *Idea:* the shadow cache's static bake makes a 2048² sun map affordable on `high`.

- **[BRN m2-r3] In-stay variety + P3 metric.** A settled stay (pick, gig, showcase regular, nap) runs in 30–58 s beats:
  the spot's own activity, a variant (read, doodle, sip, stretch, yo-yo, a chat with a settled neighbour, petting
  Segfault via `ctx.ambient.catPos`), the spot's own again. Naps stir (a yawning stretch, or a roll between the curled
  and the sprawled pose). *Proposal (§6.4.1 Shelly ladder):* the ≥ 30 min row becomes "the doze is one pocket pick
  (35 %)" instead of "parks for good", and a pocket bench pick is toy time (juggle, spinner, paper); P3 in ENG needs it.
  `__hq.metrics()` gains `occupancyPct` (settled only, never walking) and `p3 {maxStillS, over60, recent}`; the sim gate
  asserts maxStillS ≤ 60 s in `longIdle` + `mixed`. *Idea (CHR):* a seated `sitRead` / `sitDoodle` (idle-only) would let
  café and library chairs read and doodle too (today the seated menu borrows fidgets and `readBook` stays a work signal).
- **[FX m2-r3] Floor slabs as label occluders (LVL/UI idea).** FX now bakes the mezzanine slab itself (`fx/occlude.js`:
  plane at `MEZZ_Y − 0.1`, footprint = where `layout.floorY(x, z, 1)` is the mezzanine) and hides plates / bubbles /
  alert cards / ✓ pennants whose agent is on the other side of it. *Proposal (LVL):* publish `layout.slabs = [{y, rects}]`
  (world) so FX, UI's aim and any future level share one slab list (`bakeSlabs` already prefers it), and move it with the
  wall bake into world/layout (carryover item). Pennants and task cards within 1.5 m of the lens (plan) or cut > 15 % by
  the frame edge are now hidden (`placards.stats()` pennantsNear / pennantsEdge / pennantsSlab / boardsNear).

- **[LEAD M3.5 producer triage] Ideas not in the M3.5 wave (ranked by fun + use):**
  1. *Photo mode (P)* — "say cheese" poses, on-twos + line-boil filter, polaroid frame, PNG save; Lobby photo wall with
     auto-polaroids of notable moments (first commit, inbox zero, 6 h sleeper). RND+PLY+CHR+UI+ENV, L.
  2. *The Daily Diff / standup recap* — `timeline.get` aggregate (tasks shipped, commits, tests, ± lines, longest block,
     Employee of the Day, ping-pong champ), Lobby newspaper stand (E to read), copy as markdown, also in the away recap.
     BE+STAT+ENV+UI, M; verify with a golden-fixture snapshot.
  3. *Summon bell + physical roll call* — Help Desk bell; idle/acked-done agents line up in labelled lanes by group-by
     key; working/blocked raise lane signs in place; bell spam frowns Ada. BRN+FX+AMB+AUD, M.
  4. *CRT live wall in the Lobby* — 9 pinned agents' screens at 1 Hz from the M3.5 monitor atlas; E opens that
     terminal. Also Shelly CRT faces showing the shell's last line. STAT/RND+UI, M.
  5. *Night & seasonal life* — 22 h Pit campfire circle with marshmallow roasting, "closing time" bay dimming, shooting
     star per `done`, date-driven decor (`?date=` override): pumpkins + pumpkin Segfault late Oct, snow cards Dec,
     nightcaps after midnight. BRN/CHR/RND/FX/ENV/AMB, M.
  6. *Coffee & cat economy* — Bean flies a cup to agents after 20 min continuous work (60 s mug wiggle); idle agents
     route to `catPos()` to pet Segfault; cat trots to a blocked agent after 2 min and meows; Segfault rides Dusty.
     Held-mug player viewmodel (PLY) + E-with-mug coffee delivery verb; Q-hold blow-dust verb. AMB+BRN+AUD+PLY, S–M.
  7. *Weather from the agents' work* — fail streaks → rain on the glazing (`glass.js` `uReflect` droplets, no new
     program), skylight rain, greyer sky, rain bed audio. STAT+RND+AUD, M.
  8. *High tier spend* — golden-hour depth-tested god rays + FX dust motes (≤ 0.8 ms), clay micro-surface + warm
     terminator (§5.6), tilt-shift for plan/manager's desk, capsule-stroke display face (`glyphs.js`, still an M3 row),
     "bat signal" red gobo after 2 min blocked. RND+FX, S–M each.
  9. *Git truth for diff stats* — throttled read-only `git diff --numstat` per cwd (≤ 1 per 30 s per repo) as a
     second source for `work` (BE enricher `git`, new FIELD_OWNERS row). BE, S.
  10. *Desk progress prop* — clay paper stack / flip counter on each desk that grows with lines changed today. ENV+FX, S.
  11. *Quick wins pile* — sofa bounce for neighbours, slide score cards, atrium bin paper-ball swish, pennant plant +
      confetti yank on sign-off, Nap Nook snore chorus, live rally score on the Board ticker, Big Board "hot seat" face
      for ≤ 4 agents, ticket dispenser + NOW SERVING clack, story ring at the hearth, 'lost & found' street window-shopping.
  12. *Tooling* — `dev.mjs --attach-readonly` for a second reviewer on hqtest, churn soak + allocation budget rows in
      perf.mjs, review.json `hard`/`art` split with a committed baseline, architecture-import lint, CPU split in stats,
      free CPU-side static geometry arrays after upload. CORE+BE, S each.
  13. *Rubber-duck verb* for struggling agents, water-cooler moments, dance party, departures board for tokens, gated
      broadcast prompts, split drawer (remain M4).

## 12. Conflict resolutions (input docs → decision)
| Topic | Inputs | Decision |
|---|---|---|
| Player eye height / character scale | ART 1.15 m & 0.9 m; GP 1.35 m & 0.7 m; DESIGN v1 2.0 m doors, GP ceilings | Characters per ART (0.88 m); eye **1.2 m**; FOV 60° vertical; **ART toy proportions**: doors 1.7 m, bays 2.8 m, street 3.4 m, atrium 5.5 m; footprint 42×28 m (§7) |
| Roster side | ART left; GP right | **Roster left**, terminal drawer right |
| Minimap & toasts | ART minimap bottom-right; GP minimap bottom-left | Minimap bottom-left, toasts above it, status card bottom-right |
| Model indicator | GP hats; ART lanyard emblem | **Emblem** (the head slot belongs to workspace identity) |
| Blocked → help desk delay | ART 20 s; GP 6 s | **10 s**: quick permission prompts don't cause commutes, and long blocks still escalate. Hurry speed 2.0 m/s |
| Where done agents go | ART café; GP Pit sofa | **Pit sofa** (GP) until signed off (§6.8.2) |
| Display name fallback | herdr doc: name → title → tab → cwd | name → non-numeric tab → cwd; title shown separately (titles churn) |
| Draw-call budget | platform 150; ART 250 | 150 target / 250 hard cap at 40 agents |
| Character rendering | ART plain meshes → BatchedMesh later; platform instanced | **Instanced parts from M1** via the §6.2 rig/render split |
| E key on an agent | ART opens the inspector; GP opens the terminal | **E opens the terminal**; the status card appears on aim |
| Workspace colour key | ART hash of id; GP hash of label | Hash of **label** with probing (stable across restarts), computed server-side |
| Accessory type vs colour | ART type = index % 8 | Type and colour both come from `colorIndex`; stripe when `cycle > 0` |
| Demo terminals | Prior art closed them | A fakeTerm streaming real ANSI, so the drawer is testable offline |
| Yaw convention | Prior art +z; GP spawn faces −z | Camera-style yaw, 0 = north (−z); characters `+π` |
| Backend port | platform 7777 example | **7462** (vite dev 7461) |
| Tone mapping | ART AgX or ACES | **NEUTRAL** (§5.0) |
| Post order | ART/DESIGN v1: SMAA last | AA before grain/vignette/CA (§5.1) |
| Unknown ghosting | ART `alphaHash` dither | Opaque desaturated + fresnel edge + bob (§5.1) |
| Floor ring colour | ART §5.4 workspace ring; GP/DESIGN state ring | **State only**; workspace on accessories/plates/rugs/banners (§5.5) |
| Workspace & codex colours | ART §2.4 / §5.2 | Jewel-tone palette + graphite codex (§5.5) |
| Skyline | ART painted cards; GP/DESIGN v1 instanced box rings | **Layered fogged silhouette cards** in the sky shader (§7.3) |
| Lab location | GP: reached only through ENG | Swapped with the Mailroom: Lab beside the Lobby (§7.1) |
| Station trips | GP ≥ 5 s class, return 8 s after | Dominant phase + 2× rule + 60 s cooldown + 2 m/s scurry (§6.5) |
| Esc Esc / G g keys | DESIGN v1 | Leader chord for xterm; segmented group-by + `Alt+1..7`; `G` = high-five/sign-off (§8.2) |
| Terminal replay | Cache since last full / resize to force full | Headless xterm mirror + serialize (§4.7) |
| Default terminal mode | control on open | **Observe first**, promote on first input (§4.7) |
| Network stat | GP pneumatic capsules | Cable-tray light pulses; capsules mean commit (§6.7) |
| Key light | ART §3.1 / DESIGN v2: one sun-driven directional key casting everywhere | **Fixed studio key** (elev 60°) for shading + shadows; sun only via gobo/sky/grade (§5.0) |
| Shadow in the ramp | DESIGN v2 `keyVis` outside the ramp | `rampT *= mix(1, keyVis, .85)` (§5.0) |
| AO | DESIGN v2 radius 0.6–0.9, intensity 2.5, characters masked | Toy scale 0.25–0.4, ≤ 2; characters drawn after N8AO (§5.1) |
| Working ring | ART/DESIGN v2: saturated blue ring under every working agent | Thin, non-emissive, near/selected only (§6.7 chroma budget) |
| Kind bodies / ws 7 | DESIGN v2 graphite, jade, pebble `#7D776F`, charcoal | slate, rose, pebble `#77736E`, cocoa + accessory trim (§5.5) |
| Night lights | DESIGN v2 ≤ 4 points reassigned every 0.5 s | Lamp pools in the toon programs + ≤ 2 cross-faded points (§5.6) |
| Help queue | DESIGN v2 `q` cells in the atrium SW corner on the circulation path | Teller window in a rope line, roped 10-slot lane + overflow rug, keep-clear rects (§7.1) |
| Street / E-bay x | DESIGN v2 table 8.5 vs map 8 | Table snapped to the map: STR 5→8, E bays 8→14; table is the M1.5 source (§7) |
| Scrollback | DESIGN v2 `term.scroll` always | Verified pane-global → local `term.history` overlay; `term.scroll` opt-in, writer only (§4.7, §8.6) |
| Observe child sizing | unspecified | Sizer = first opener; control sized by writer; others letterbox (§4.7) |
| Protocol mismatch | DESIGN v2 warn and continue | Read-only mode + client allowlist (§4.1) |
| WP codes | DESIGN v2 BE3/CHR2/UI2/UI3/RND2/BRN0 | Owner codes only (§11.0); blocked path in M1 BE |
| Bay allocation | renderer-local arrival order | Server-persisted `workspace.slot` → `BAY_ORDER[slot]` (§6.4) |
| M4 control groups | DESIGN v2 keys 1–9 recall | Pinned agents 1–9 (M1); hotbar M4 |
| Warm-on-warm zones | DESIGN v3 CAF terracotta tile + grade; STR clayDeep↔walnut brick + amber grade | Cool CAF terrazzo, painted sage brick + slate pavers, neutral/cool grades; hue-gap at `cafe`/`street` (§5.5–5.6) |
| Codex body | DESIGN v3 slate `#34383D` (L\* 23) | slate `#4D4B52` (L\* 32) + `clayCheck().codex` (§5.0, §5.5) |
| Medium env edge | depth Sobel | planarity test on reciprocal depth + fades (§5.1) |
| Medium shadows | "chars only" vs budget with prop depth | chars + `CASTERS` props on every shadowed tier (§5.2) |
| Leader alone / close tab | 800 ms timeout; Leader W | acts on keyup; 400 ms chord window; chords disjoint from world keys; Leader X (§8.2) |
| Esc in Peek | every key → pane, first key promotes | Esc → world, never promotes; Ctrl+C confirm; only printable/Enter/paste/Leader I promote (§8.4) |
| Digits in world | 1–9 pins, or quick-answer by aim | 1–9 pins only; Alt+1–9 quick-answer via confirm (§8.2, §4.8) |
| Unread | new output lines / screen revision | meaningful `news` + status signals (§8.9) |
| `term.input` | rid-gated per chunk for everything | interactive fire-and-forget + credit window; paste gated (§3.4) |
| `statusSince` | boot time after restart | persisted + `statusSinceApprox` (§4.3.1) |

### 12.2 Superseded rows in the input docs (do not implement)
| Doc § | Superseded content | Now |
|---|---|---|
| ART §1 Scale | eye 1.15 m | §6.1 (1.2 m, FOV 60°) |
| ART §2.4 | blueberry/mint/mustard/grape/bubblegum/lagoon/tangerine/pewter | §5.5 jewel palette |
| ART §3.1 light table intensities (2.2, 0.9, …) | physical-ish gains | §5.0 normalised gains |
| ART §3.2 "tint blended 35% with albedo" | albedo² in shadow | §5.0 independent `uShadowTint` |
| ART §4 tone map row, merged pass order, `alphaHash` in §10 | AgX/ACES, SMAA last, dither ghosting | §5.1 |
| ART §5.2 eye size 0.075×0.15, codex `#5E7FC9`, gemini/other `#9A7FD1`/`#6DB57A`, pebble `#A8A29A` | | §6.1, §5.5 |
| ART §5.4 workspace floor ring | | removed (§5.5) |
| ART §2.3 working "Monitor glow, floor ring"; ART §3.1 sun as the shadow light; ART §4 AO radius | | §6.7 chroma budget; §5.0 studio key; §5.1 toy-scale AO |
| ART §5.4 plain single-colour accessories | | §5.5 accessory trim |
| ART §6.4 working sweat at 5 min / head steam at 15 min | | §6.7 (sweat = context; mug = streak) |
| ART §6.5 test-fail rain cloud; git commit parcel | | §6.7 (rain = blocked > 5 min; capsule = commit) |
| ART §6.6 Shelly table (booth, DJ, rotary phone, crank = build) | | §6.7 Shelly table |
| GP §1.1–1.3 geometry, doors, heights, `floorY` numbers | 48×32 plan | §7 |
| GP §1.5 bay order, "FOR LEASE" | | §6.4 order, §7.2 amenities |
| GP §2 `model` hats row; floor-ring wording | | lanyard emblem; §6.7 |
| GP §3.1 blocked > 6 s; done > 30 min "blends into idle"; idle > 10 min always sleeps | | §6.4 table + §6.4.1 ladder |
| GP §3.2 station trip rule | | §6.5 |
| GP §3.3 Shelly table (bench vs booth, crank = serve vs build) | | §6.7 |
| GP §3.4 "pneumatic capsules follow network" | | §7.4 cable-tray pulses |
| GP §5.1 R "come here" on any agent; 1–9 quick answer; Ctrl+` back | | §6.9, §8.2 |
| GP §5.3 dolly + flash before the drawer | | §8.5 (focus first; dolly in parallel, E only) |
| GP §5.5 `G` cycles grouping, `g` go to | | §8.2 |
| GP §6 "single skyline InstancedMesh" | | §7.3 |
| ART §3.3 brick row (`clayDeep`↔`walnut` bricks) and terrazzo chips incl. clay | | §5.5 painted sage brick; CAF terrazzo without clay chips |
| ART §5.2 codex visor band; v2/v3 jade and `#34383D` slate | | §5.5 slate `#4D4B52`, rose, pebble |
| ART §6.4 "light working ring under the chair" | | §6.7 chroma budget (thin, near/selected only) |
| ART §6.4 blocked "≥ 20 s" walk | | §6.4 table (10 s) |
| ART §2.1 `cream` "walls" (and "cream" on any lit 3D surface) | L\* 94 over the albedo cap | §5.5 D1: `wallCream` (walls) / `trim` (small props); `cream` is UI-only |
| GP §5 quick-answer on plain digits | | §8.2 Alt+1–9 + confirm |
| GP controller (sprint 6.5 m/s) | | §6.10 (sprint 5.6 m/s) |

## 13. TypeScript port

The codebase is strict TypeScript with unchanged runtime behaviour; the guide, project layout and status live in
`docs/port/` (`GUIDE.md`, `STATUS.md`, `DEVIATIONS.md`). This supersedes the "plain JavaScript + JSDoc, no TypeScript build step"
bullet in §2. Node 24 strips the types, so there is still no build step for `server/`, `shared/`, `scripts/`, tests or
`electron/main.ts`; Vite compiles the renderer, and `electron/preload.cts` is the one compiled file (`npm run build:preload`
→ `out/preload/`, gitignored).

Every `.js` / `.mjs` / `.cjs` file named elsewhere in this document is now a `.ts` / `.cts` file with the same path and
basename. The runnable examples in §2.2, §9 and the gates map as:

| Written above | Run now |
|---|---|
| `node server/main.js …` | `node server/main.ts …` |
| `node server/doctor.js` | `node server/doctor.ts` (`npm run doctor`) |
| `scripts/dev.mjs` | `node scripts/dev.ts` (`npm run dev`) |
| `scripts/shoot.mjs`, `review-shots.mjs`, `perf.mjs`, `walktimes.mjs`, `wp-briefs.mjs` | the same names with `.ts` (`npm run shoot`, `review`, `perf`, `walktimes`, `briefs`) |
| `scripts/p2.mjs`, `integrity.mjs` | `node scripts/p2.ts`, `node scripts/integrity.ts` |
| `electron/main.js`, `preload.cjs` | `electron/main.ts`, `electron/preload.cts` (`npm start` compiles the preload first) |
| `node --test` | `npm test` (`node --test "**/*.test.ts"`) |

`npm run typecheck` runs the node, renderer, test, preload and experiments projects and fails on any source file outside them.
