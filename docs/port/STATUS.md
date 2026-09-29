# Port status

Numbers come from `node scripts/typecheck.ts --dirs` (unique `file(line,col)` errors across the node, renderer, test and
preload projects; a file shared by several projects counts once).

## After the mechanical rename (step 3; no types added yet)

| area | errors |
| --- | ---: |
| shared | 158 |
| server (top-level files) | 656 |
| server/demo | 793 |
| server/enrich | 383 |
| server/herdr | 222 |
| server/stats | 112 |
| server/terminals | 377 |
| server/world | 820 |
| electron | 111 |
| scripts | 1855 |
| renderer/src/audio | 325 |
| renderer/src/chars | 3436 |
| renderer/src/core | 299 |
| renderer/src/debug | 543 |
| renderer/src/fx | 1178 |
| renderer/src/main.ts | 30 |
| renderer/src/net | 120 |
| renderer/src/player | 1248 |
| renderer/src/render | 882 |
| renderer/src/ui | 2734 |
| renderer/src/world | 107 |
| **total** | **16388** |

The errors are almost all `TS7006` / `TS7031` (implicit any: the JSDoc types are not read in `.ts`) plus the `unknown`
catch variable and index-signature errors that surface once code is real TypeScript.

## After step 4 (shared types)

`shared/*.ts` (sources and tests) and `server/interfaces.ts` are at zero errors in every project. Remaining:

| area | errors |
| --- | ---: |
| shared | 0 |
| server (top-level files) | 599 |
| server/demo | 762 |
| server/enrich | 374 |
| server/herdr | 219 |
| server/stats | 112 |
| server/terminals | 376 |
| server/world | 812 |
| electron | 111 |
| scripts | 1855 |
| renderer/src/audio | 325 |
| renderer/src/chars | 3436 |
| renderer/src/core | 300 |
| renderer/src/debug | 543 |
| renderer/src/fx | 1178 |
| renderer/src/main.ts | 30 |
| renderer/src/net | 120 |
| renderer/src/player | 1248 |
| renderer/src/render | 882 |
| renderer/src/ui | 2740 |
| renderer/src/world | 106 |
| **total** | **16128** |

(Some counts moved by a few because the shared types now flow into the callers and expose new mismatches, e.g. `Status`
literal unions and `OwnerName`.)

## Baseline (before any change)

- `npm test`: 783 tests, 781 pass, 1 fail, 1 skipped. The one failure, `server/test/golden.test.js` ("golden: hqtest-10min.ndjson
  ... reproduces the committed WorldModel stream"), is caused by the uncommitted M4 edit to `shared/protocol.js` in the
  working tree (new entity fields `git`, `asks`, `conflicts`, ... without a regenerated golden). At HEAD the test passes
  (verified in a scratch worktree). It fails identically after the port. Regenerate with
  `node server/test/golden.ts --regen` once the M4 work is settled; not part of the port.
- After the rename and after step 4: identical counts (783 / 781 / 1 / 1).
- Screenshots: `docs/port/baseline/` (see its README). After the rename the empty-scenario shots match the baseline within the
  render noise floor (mean channel diff < 0.9 of 255, < 1.3 % of pixels differ by more than 24).

## Things found on the way (real repo bugs, fixed)

- `.gitignore` had `build/`, which also ignored `renderer/src/world/build/` (47 source files: the whole world builder,
  imported by `main`, `fx`, `player`, ...). The baseline commit therefore did not contain them and a fresh clone could not
  build. Changed to `/build/` and `git add`ed the directory (staged, not committed).
- `Entity.note` was never declared in the `Entity` typedef although `FIELD_OWNERS`/`ENTITY_FIELDS`/`FIELD_DEFAULTS` use it. Now
  `note: Note | null`.

## Final (integration)

| check | result |
| --- | --- |
| `npm run typecheck` | 0 errors (node, renderer, test, preload) |
| `npm test` | 785 tests, 783 pass, 1 fail, 1 skipped. The failure is still the known M4 `golden` test (see Baseline); the baseline had 783 tests, the port added 2 |
| `npm run build` | ok |
| demo dev stack, `shoot-all.sh` (6 shots) | `frameErrors` 0, `bootErrors` 0, no console errors; structurally identical to `docs/port/baseline/` (demo world differs only by its wall-clock scripted state) |
| empty scenario vs `baseline/empty` | mean diff 0.17-0.63, big% 0.00-1.39 (noise floor) |
| `node scripts/p2.ts` | 50 passed, 0 skipped, 0 failed |
| `npm run serve -- --demo` | serves the built page, renders |
| Electron under Xvfb, `--shoot` | `ready:true`, frame errors 0 |
| `dev:hq` (session `hqtest`, read-only) | 8 live entities, terminal drawer opens on `scout` |

Integration fixes: `FxActor.intent.face` / `ambientOf` accept `null`; `AmbFx.burst` takes `BurstKind`; `ui.aimed` is now
returned by `createUI` (main.ts always called it, so the stat tooltip never learned the aimed agent); `posesFor` takes a
string; `p2.ts` logger typed `ScopedLogger`; the GPU test's window type omits the global `__hq`; two unused type imports
dropped (`Ledger` in `ui/help.ts`, `StateKey` in `ui/roster/view.ts`).

Left as is on purpose: the narrow consumer-side interfaces (`AmbStore`, `AmbActors`, `AudioStore`, `AudioActors`,
`FxActors`, ...). They are optional-field subsets of the real `Store` / `Actors` so tests can pass small fakes.

See `DEVIATIONS.md` for the full list of bugs fixed, behaviour differences and the type-check coverage rules.

## Final (integration after fix round 1)

| check | result |
| --- | --- |
| `npm run typecheck` | 0 errors in node, renderer, test, preload, experiments; 0 files outside every project |
| `npm test` | 785 tests, 784 pass, 0 fail, 1 skipped (the golden drift is gone; the `transcripts` fixture assertion was restored to `.js`) |
| `npm run build` | ok |
| dev stack boot (`--scenario empty --seed 1`, ports 7970/7971) | boots clean, no errors or warnings in the log |
| empty scenario vs `baseline/empty` | mean diff 0.07-0.66, big% 0.00-1.39 (world-0 marginally above the 1.0% noise line) |

Fix round 1 changes: wire validation (`toWireMsg`, per-variant `isServerMsg` in `shared/serverMsg.ts`), `Entity` wire additions
removed to match HEAD, `readConfigJson` and storage `load()` typed `unknown`, stale JSDoc types removed, `experiments/` ported.
Not re-run this round: Electron under Xvfb, `p2.ts`, `dev:hq`. No git push was performed (no target was given).
