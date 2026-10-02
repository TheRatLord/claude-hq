# Tools: verify, shoot, bench, audit, dev hooks

Everything for checking your work: tests, screenshots on the real GPU, the benchmark, the map PNG, the placement
audit, browser tests, URL parameters, in-game debug keys and the `window.__valley` / `window.__hud` dev API.

Key sources: `scripts/shoot.ts`, `scripts/bench.ts`, `scripts/soak.ts`, `scripts/mapviz.ts`, `scripts/placement.ts` +
`scripts/placement-allow.json`, `scripts/devserver.ts`, `scripts/workbench.ts`, `scripts/typecheck.ts`,
`renderer/src/farm/dev/` (`api.ts`, `overlay.ts`, `gallery.ts`, `placement.ts`, `placementCore.ts`),
`renderer/src/farm/photo.ts`, `renderer/src/farm/main.ts` (URL params), `browser-tests/`, `playwright.config.ts`,
`server/demo/scenarios.ts`.

## Verify your work (do this constantly)

```sh
npm run typecheck                                   # all projects
node --test "renderer/src/farm/**/*.test.ts"        # model + layer rules (+ your pure tests); npm test runs every *.test.ts
npm run test:browser                                # Playwright browser tests (below)
npm run shoot -- --shot name=a,pose=hub,hour=10     # screenshots on the real GPU → scratch/shots/a.png, prints errors + perf
npm run bench -- --scenario mixed --pose hub,top    # GPU / CPU ms, calls, tris per pose (Benchmark below)
npm run soak -- --minutes 20                        # leave it running all day, compressed: leak report (Soak below)
npm run mapviz                                      # top-down map PNG, no browser
npm run audit:placement                             # floating / sunk / overlapping assets → scratch/placement/ (below)
npm run dev                                         # interactive: /, /gallery/, /workbench/
npm run app  |  npm run app:demo                    # Electron: live herdr session | demo world
```

Read the PNGs you produce (they are the ground truth), compare against the art direction ([art.md](art.md)), iterate.
Put scratch files under `scratch/` (gitignored).

## Screenshots (`npm run shoot`)

Starts the demo dev server, drives headless Chromium on the real GPU (Vulkan ANGLE), writes PNGs, prints console errors
and perf.

```sh
npm run shoot -- --shot name=n,pose=square,hour=22,weather=rain
npm run shoot -- --shot name=f,goto=d1:p2           # stand in front of a farmer / plot / structure id
npm run shoot -- --shot 'name=top,cam=0;90;70;0;-0.95'  # free camera x;y;z;yaw;pitch (quote: ';')
npm run shoot -- --shot 'name=w,gallery=dog,variant=run,frames=12,every=70,clip=400;100;900;700'  # flipbook: N frames tiled into one PNG
npm run shoot -- --shot name=m,pose=hub,panel=map    # HUD panel (map mailbox roster …); hud=0 hides the HUD; term=ID opens a terminal
npm run shoot -- --url 'http://127.0.0.1:PORT/?t=TOKEN' --shot name=live,pose=hub   # a running backend (live herdr; npm run build first)
npm run shoot -- --shot name=g,gallery=windmill,param=0.8   # one asset in the gallery
npm run shoot -- --shot name=g,grid=structure        # every asset of a group
npm run shoot -- --shot 'name=q,pose=hub,log=__valley.state().plots.map(p => p.kind)'   # print an expression's value
```

* Shot keys: `frames every clip name pose hour weather season quality goto cam wait eval hint hud panel term gallery
  variant grid night param turn time pitch zoom log almanac festival welcome` (`pose hour weather season quality
  timescale almanac festival welcome` go onto the page URL). `hint=1` keeps the click-in hint card.
* Options: `--url URL` (existing backend + its built dist; default: a fresh demo dev server), `--out DIR` (default
  `scratch/shots`), `--size 1600x900`, `--scenario mixed`, `--seed 1`, `--demo 12`, `--wait 2500`, `--timescale K`,
  `--video` (also record a short webm per shot, wait = its length).
* Area recipes live with their area: [weather.md](weather.md), [almanac.md](almanac.md),
  [festivals.md](festivals.md), [pastimes.md](pastimes.md), [wildlife.md](wildlife.md), [economy.md](economy.md),
  [friends.md](friends.md), [onboarding.md](onboarding.md), [interior.md](interior.md), [trail.md](trail.md),
  [gatherings.md](gatherings.md), [map.md](map.md), [hud.md](hud.md), [stamps.md](stamps.md).

## Poses, scenarios, URL parameters

* **Poses** (`POSES` in `dev/api.ts`): `hub farmhouse square windmill pond barn river plots east trailhead trail bridge
  summit dock ice falls curtain`; also `pose=x,z[,yaw,pitch]` and `pose=inside[:view]` / `pose=barn-inside[:view]` ([interior.md](interior.md)),
  `pose=grotto[:view]` (the cave behind the falls, [grotto.md](grotto.md)). `curtain` (a cramped ledge) is never nudged.
  Named poses are picked with open ground in front in every season, but festival stalls, scarecrows and town upgrades
  come and go: a few frames after a named pose, `pose()` fans rays across the middle of the view and, if something solid
  is within 4.5 m, steps back / aside (never into a collider) to the first clear spot. `pose=x,z,…` is never nudged.
* **Demo scenarios** (`server/demo/scenarios.ts`, `--scenario`): `mixed allStates crowd40 trio longIdle queue churn
  empty offline`.
* **URL parameters** (`main.ts`): `t` (server token), `pose`, `hour`, `weather`, `season`, `festival=ID`
  ([festivals.md](festivals.md)), `almanac=POINTS` (demo; [almanac.md](almanac.md)), `quality=low|medium|high` (`low`
  compiles the wet / snow surfaces out and skips god rays; [weather.md](weather.md); beats Settings → Graphics → quality), `timescale=K`, `welcome=1|0`
  ([onboarding.md](onboarding.md)). The gallery (`/gallery/`, `dev/gallery.ts`) takes `asset variant season night param
  grid time turn pitch zoom`.

## In-game keys

* F3 perf overlay (fps, frame/cpu ms, draw calls, triangles, per-system ms, player position/yaw), F4 valley state
  inspector (farmers with raw vs smoothed job, plots with stage), F6 debug labels (`ctx.debug.labels`) (`dev/overlay.ts`).
* **Photo mode (P)** (`farm/photo.ts`): the HUD steps away and the camera flies free (WASD along the view, Space / C,
  Shift); the wheel zooms, [ ] scrub the clock, 1–6 looks, V frames, G grid, N name tags, T timer, F say cheese,
  Enter saves to the photo album (X: also a PNG), L opens the album; P or Esc puts the view and the clock back
  ([album.md](album.md)).
* HUD keys: [hud.md](hud.md#keys-hudhudts).

## Dev API

`window.__valley` (`dev/api.ts`; the header there is the full list):

* `ready`, `state()` (ValleyState as JSON), `service(name)` (any published service), `teleport(x, z, yaw?, pitch?)`,
  `pose(name)`, `cam(x, y, z, yaw, pitch)` / `cam(null)`, `look(x, y, z)` (turn toward a point; the controller ignores
  zero-delta mouse moves, so headless Chromium's per-frame move under pointer lock does not cancel it), `goTo(id)`
  (farmer / helper / plot / structure / villager id; `'villager:posy'`), `interact()`, `focused()`.
* `setHour(h | null)`, `setWeather(kind | null, intensity?)`, `setSeason(s | null)`, `festival(id | null)`,
  `timeScale(k)` (0 freezes animation), `atmo(…)`, `meteor()` ([weather.md](weather.md)).
* `perf()` (fps, `calls`, `tris`, `systemMs`), `systems()`, `debug(flag, on?)` (`'labels'`, `'colliders'`, `'nav'`),
  `force(id, patch)` / `scenario(name, seed?)` (demo backend only), `villagers()` / `villager(id)`.
* Areas: `almanac(points)`, `fireworks(s)`, `forage` / `forageGo` / `fish` / `collect`, `wildlife`, `coins` / `buy` /
  `sell` / `yard` / `furnish`, `hearts` / `requests` / `gift`, `gather`, `inside`, `stamps` / `stamp`, `boat` / `skate` / `snowman` ([seasons.md](seasons.md)); `ctx.services.get(name)` reaches any
  service (e.g. `'trail'`, `'farmers'`, `'audio'`).
* `audit(opts?)`, `auditShow(keys, focus, view)`, `auditClear()` (placement audit, below).

`window.__hud` (`hud/hud.ts`): `open`, `close`, `current`, `openTerminal`, `dismissHint`, `mapHits`, `toast`, `notify`, `prefs` (browser-local Settings prefs: read or patch),
`tour` ([hud.md](hud.md#dev-handle-window__hud)). `window.__atmo.bench(n)`: GPU ms per frame.

## Budgets check

`__valley.perf()` → `calls`, `tris` (main + shadow pass), `systemMs`; see the budgets in [../VALLEY.md](../VALLEY.md#budgets).

## Benchmark (`npm run bench`)

`scripts/bench.ts` drives the real GPU (same Chromium flags as `shoot`) through `mixed` and `crowd40` × day (10:00
clear) / night (22:00 clear) / rain (14:00) × 7 poses (also `--cond snow`: 09:00 snow in winter; any named pose works
in `--pose`, e.g. `farmhouse`) (`hub square river pond east top inside`; `top` = free camera
`0;90;70;0;-0.95`) and prints one row each: `gpu` (whole frame, `EXT_disjoint_timer_query_webgl2`, median of reps),
split into `scene` (incl. the shadow map), `shadow` (scene with shadow updates on − off) and `post` (bloom, rays,
composite, FXAA); `cpu` (frame loop EMA: hooks + systems + submit), `sys` (sum of systems), `submit` (JS/driver time
of the render call), `calls` / `shCls` (shadow pass share) / `tris`, and the top three systems.

```sh
npm run bench                                                   # everything (~6 min)
npm run bench -- --scenario mixed --cond night --pose hub,top    # a slice
npm run bench -- --json scratch/bench/a.json --shots             # keep numbers + a PNG per row (scratch/bench/)
npm run bench -- --quality low --eval "__valley.atmo({mist:1})"  # A/B a setting
```

The machine is shared (agents shooting): a `shoot` fps of 25–45 under load average > 10 is contention, not the
scene (a "27 fps in snow" report re-measured at 60 fps / 6 ms GPU); check `uptime`, compare medians of A and B run alternately, and trust the GPU
columns over `cpu` when the load is high (timer queries still include time-slicing with other GPU clients). Per-pose
costs worth knowing: mist banks ≈ 0.3 ms (night / dawn), wet surfaces ≈ 0.7 ms (any toon pixel while `wet` > 0; dry
costs nothing), god rays ≈ 0.1 ms, shadow map ≈ 0.5 ms, post ≈ 1.2 ms. (The atmosphere's own earlier estimates, mist
≈ +1.5 ms and wet / snow / rays ≈ +0.3–0.6 ms each, are in [weather.md](weather.md); prefer fresh bench numbers.)

Rules of thumb: a `DoubleSide` material does not need explicit back faces (`scene/plots/geo.ts` `singleSided`); a
valley-wide `InstancedMesh` cannot be frustum-culled by three, so pack only what is in view (`scene/plots/meadow.ts`);
transparent `DoubleSide` materials take `forceSinglePass: true` when additive (else three draws them twice and
re-resolves the program each frame).

## Soak (`npm run soak`)

The valley is left open all day, so anything that grows per toast, per panel, per season or per reconnect eventually
hurts. `scripts/soak.ts` starts a demo dev server (or `--url`), drives one page through everything a long session does
and prints a leak report. Every `--cycle` seconds it churns through random actions — `scenario` (mixed / churn /
crowd40 …), `panels` (every HUD panel and a farmer card), `terminal`, `toasts`, `poses`, `weather` (+ hour, season,
puddles / snow / rainbow), `inside`, `gather`, `wildlife`, `festival`, `forage` (+ fishing), `pet`, `flap` (rapid
status changes), `socket` (drops the valley's WebSocket), `hidden` (tab hidden, the page clock jumps 1–5 h), `midnight`
(the page clock jumps to 8 s before midnight) — then returns to a fixed baseline (first scenario, hub, 10:00 clear,
panels closed), settles, forces a GC (CDP) and samples:

| metric | from |
|---|---|
| `heapMB`, `nodes`, `listeners` | CDP `Performance.getMetrics` after `HeapProfiler.collectGarbage` (nodes include detached ones) |
| `hudNodes` (+ the biggest `#hud` subtrees) | the DOM |
| `geometries`, `textures`, `programs`, `objects` | `renderer.info`, a scene traversal |
| `timeouts`, `intervals`, `rafs` | live counts from an init script that wraps the timer APIs |
| `audio` | live AudioNodes (CDP `WebAudio` created − destroyed) |
| `storageTotal` (+ per key) | localStorage bytes |
| `fps`, `err` | `__valley.perf()` (fps is only indicative: the machine is shared) |

The report fits a line over the second half of the samples; a metric is flagged `LEAK` when it grows faster than its
hourly tolerance, the last third's median sits above the middle third's and it grew by a real amount overall. Every
console error / warning / page error is listed with the action that preceded it (`--stacks` appends a short stack).
Exit code 1 on a leak or a console message.

```sh
npm run soak                                                   # 20 min, every action (≈ 25–30 min wall on a busy box)
npm run soak -- --minutes 4 --cycle 12 --actions terminal       # one action: is it the leak?
npm run soak -- --start 2026-10-02T23:58 --date-scale 4         # cross midnight with the page open (page Date only)
npm run soak -- --json scratch/soak/a.json --stacks             # keep every sample
```

Options: `--minutes --cycle --settle --scenarios --demo --timescale` (the demo server clock, default 20×) `--anim`
(`__valley.timeScale`) `--date-scale --start --seed --actions --json --size --stacks --url`. The page's `Date` is
replaced by an accelerated / jumpable clock (`__soak.jump(ms)`, `__soak.setScale(k)`); timers and frames stay real.
Runs on the working tree: when other agents' edits are half-done, run it from a copy (`git archive HEAD | tar -x -C
scratch/snap`, symlink `node_modules`, copy your files over).

Finding the source of a leak: run one action at a time (`--actions X`), then look at what is retained — CDP
`DOM.getDetachedDomNodes` names detached elements; for GPU memory, hook `BufferGeometry.prototype.addEventListener`
(three adds its `'dispose'` listener when it uploads a geometry) to list uploaded geometries that are not in the scene
by creation stack. Last round (fixed): every toast was kept alive by the anchored bubbles' obstacle set (`hud/anchors.ts`
prunes it now), a duplicate `visibilitychange` started a second rAF chain (`core/loop.ts`), and a season change leaked
the town upgrades' geometry (`structures/upgrades.ts` dispose).

## Browser tests (`npm run test:browser`)

Playwright (`playwright.config.ts`, specs in `browser-tests/`: `valley.spec.ts` (terminal routes and the power-user
loop, see [hud.md](hud.md#every-terminal-is-a-menu-away)), `trail.spec.ts` (the valley viewer), `stamps.spec.ts` (the stamp
book, [stamps.md](stamps.md)), `seasons.spec.ts` (rowboat, skating, snowmen, [seasons.md](seasons.md)), `album.spec.ts` (photo mode's looks, frames, timer, say cheese, the album panel, the photo wall; saves the framed exports to its output folder, [album.md](album.md)), `robust.spec.ts` (corrupt or old localStorage in every store, midnight
with the page open, a tab hidden for hours, a dropped socket under a terminal, long / unicode / emoji names, status
flapping: all with a clean console), `settings.spec.ts` (Settings round-trips, rebinding, reduced motion, keyboard
navigation, captions; [hud.md](hud.md#settings-pause-menu--settings-hudpausets)), `workbench.spec.ts`;
`server.ts` starts a demo server fixture). Add a flow to `valley.spec.ts` when you add a route to a terminal.

The specs load `dist/`, so **`npm run build` first** (a stale build tests old code). Each test gets its own demo
server on an ephemeral port and its own browser context (fresh localStorage), so tests are independent and run in
parallel; pass `--output <dir>` when several agents run Playwright at once.

**Speed: GPU first, SwiftShader fallback** (`browser-tests/gpu.ts`). When a GPU is available (Linux: a
`/dev/dri/renderD*` node; macOS / Windows: always) Chromium gets the same Vulkan ANGLE flags as shoot / bench
(`scripts/gpu.ts` `GPU_ARGS`), the valley renders at ~50+ fps instead of ~1–3, and the config runs **4 workers** with
`valley.spec.ts` in `parallel` mode: the whole suite takes **~1 min** (was ~19 min on one SwiftShader worker). Not more
than 4: on the 3 GB iGPU six valleys at once ran out of video memory and `page.evaluate` stalled for 10–60 s, failing
polls. Without a GPU Chromium falls back to SwiftShader by itself; `valley.spec.ts` then runs serially (parallel
software valleys starve each other's frames) and the suite takes ~15–20 min. `HQ_TEST_GPU=0` forces software (to
reproduce CI), `HQ_TEST_GPU=1` forces the GPU flags.

Writing tests: poll state (`expect.poll`, `toBeVisible`) rather than sleeping — at 50 fps things happen sooner than
they did in software, and at 2 fps later. Read back the thing you acted on (e.g. the focused interactable's id) rather
than assuming list index 0 is what the crosshair found. `test.slow()` / long timeouts are for the software fallback.

## Placement audit (`npm run audit:placement`)

Finds assets that float, sink into the terrain or run through each other, in the real built scene (all demo
scenarios' static world: `allStates` + `crowd40` by default, every plot lifecycle stage, flora, terrain features,
structures and dressing). `scripts/placement.ts` starts a dev server per scenario (no HMR), freezes time and calls
`__valley.audit()` (`dev/placement.ts`, loaded lazily; pure maths in `dev/placementCore.ts`, tested):

- **items**: every static mesh, every InstancedMesh instance, and every named part of a merged / baked geometry, so a
  finding names the placed thing, e.g. `structures/barn/pumpkin#3`, `plots/field:d4/fence#100`,
  `flora/tree-pine#12`. Provenance comes from `scene/parts.ts`: `Kit.part(name, fn)` / labelled props (structures),
  `named(parts, name, fn)` (plots) and `partName(geo, name)` record element ranges that survive `merge` / `bake`.
  Name new parts the same way, or they show up as `…/m<n>`.
- **ground checks** against the rendered terrain (raycast into the terrain chunks, plus `walkSurface` decks and
  anything the item rests on): `floating` (base gap > 4 cm), `overhang` (part of a wide base hovers > 20 cm),
  `sunk` (terrain swallows > 12 cm of a solid), `water` (dry-land object in the river / pond), `path` (a solid on a
  road's centre line). Soft cover (grass, flowers, clover, pebbles, reeds, soil) only gets the ground checks.
- **overlaps**: three-mesh-bvh per item, a uniform-grid broad phase over world AABBs, then triangle–triangle
  intersection (`bvhcast`); pairs that a 3 cm nudge separates are resting contact, not overlap. Parts of one placed
  object never pair with each other.

Output: `scratch/placement/report.json` (every finding, ranked, with key / owner / asset / AABB / metrics and the
scenarios it appeared in) and one contact sheet per open class (`NN-check-asset.png`: best view, opposite side, from
above; magenta = the item, cyan = what it hits, yellow = the problem region). Exit code 1 with `--strict` if anything
is open. Options: `--scenario a,b`, `--season x|all`, `--top N`, `--only key`, `--all-sheets`, `--shots allowed`.
`--sitters` adds a pass that poses a rest-pose Clawd and Codex (largest look scale) on every leisure-nook seat and the
telescope stand, in every act of the seat's loop (`idle.ts` LOOPS), and reports only their overlaps (`sitters/<nook>:
<seat>:<body>/<act>/…` against the nook and the neighbouring seats). Run it after changing a nook, a seat anchor or a
seated pose; legs hanging through their own seat and soakers' feet in the pool are allowlisted.

Intended cases live in `scripts/placement-allow.json` (globs over key / owner / asset, per check, optional `max` /
`min` on the metrics, and a `reason` for each). Fix real findings at the source (the placing code), allowlist only
what is meant to be (apples hang in trees, outcrops are bedded into slopes), and keep `max` tight so a regression
still surfaces. Entries that match nothing are reported; delete them. In page: `__valley.audit({ only })`,
`__valley.auditShow(keys, focus, view)`, `__valley.auditClear()`.
