# Port deviations and bugs found

The port is meant to keep runtime behaviour identical. This file is the committed record of every place it does not, and of
the real defects the type checker exposed. Add a line here in the same commit as any further fix (file, what, why).

## Real bugs the type checker exposed (fixed)

| where | what | why it was a bug |
| --- | --- | --- |
| `.gitignore` | `build/` became `/build/` | It also ignored `renderer/src/world/build/` (47 source files: the whole world builder, imported by `main`, `fx`, `player`), so the baseline commit lacked them and a fresh clone could not build |
| `shared/protocol.ts` `Entity` | `note: Note \| null` declared | `Entity.note` was used by `FIELD_OWNERS` / `ENTITY_FIELDS` / `FIELD_DEFAULTS` but missing from the typedef |
| `renderer/src/ui` (`createUI`) | now returns `aimed` | `main.ts` always called `ui.aimed`, but `createUI` never returned it, so the stat tooltip never learned the aimed agent |
| `renderer/src/fx` | `FxActor.intent.face` / `ambientOf` accept `null`; `AmbFx.burst` takes `BurstKind` | callers already passed `null` / the burst kinds; the JSDoc had said otherwise |
| `renderer/src/debug/poses` | `posesFor` takes a `string` | it was called with arbitrary layout ids |
| `renderer/src/ui/help.ts`, `ui/roster/view.ts` | unused type imports removed (`Ledger`, `StateKey`) | dead imports that fail under `verbatimModuleSyntax` at runtime if they were value imports |

Bugs fixed by individual areas during the port that are not listed above are recorded in that area's return summary; the
integration owner merges them into this table.

## Deliberate behaviour or tooling differences

| where | difference | reason |
| --- | --- | --- |
| `electron/preload.cts` | compiled to `out/preload/preload.cjs` by `npm run build:preload` (run by `prestart`) | The sandboxed preload is loaded as plain CJS and cannot be type-stripped. The only compiled file |
| `scripts/hqtest-realuse.ts` | frames from the backend are now validated with the shared `isServerMsg` guard (moved to `shared/serverMsg.ts`, re-exported from `renderer/src/net/store.ts`) instead of a `t`-tag check plus a double cast | A frame with a known `t` but a malformed body is now dropped by the test client exactly as the renderer store drops it. Backend output is unchanged, so this only makes the test client stricter |
| `renderer/src/core/ctx.ts` `createCtx` | draft typed `Nullable<Ctx>`, one `as Ctx` instead of `as unknown as Ctx` | Same runtime object (`null` placeholders kept) |
| `renderer/src/chars/brain/testkit.ts` `stubRig` | goes through the shared `fake<Rig>` test double | Same object; test-only code |
| `experiments/flags.ts` | prints `NO DEBUG INFO` when `WEBGL_debug_renderer_info` is missing | The JS threw a `TypeError` that the surrounding `catch` printed as `ERR` |
| `experiments/bench/main.ts` | `stats()` uses `avg(...) ?? 0` for an empty window | The JS threw on `null.toFixed` in the first frames |
| `experiments/electron-probe/main.ts` | ESM `import` instead of `require`, so it is `.ts` not `.cjs` | Electron 44 loads an ESM `.ts` main; run it as `electron ... experiments/electron-probe/main.ts` |
| `scripts/wp-briefs.ts` | each generated brief gets a "TypeScript port" note; `docs/DESIGN.md` gets a short section 13 | The briefs inline DESIGN verbatim, which still names `.js` / `.mjs` files and `node server/main.js`. The section maps every runnable command; the rest of DESIGN is untouched |
| `scripts/typecheck.ts` | also runs the `experiments` project and fails if a source file is outside every project | Guards against drift |

## Files that are deliberately not TypeScript

Every file under `server/ shared/ scripts/ electron/ renderer/src/ experiments/` and `vite.config.ts` is `.ts` / `.cts`.
Not converted, on purpose:

- `docs/port/rename.mjs`, `docs/port/baseline/compare.mjs`: one-shot port tooling, kept as the record of how the rename was made.
- `docs/research/snippets/*.mjs`: the frozen herdr API research snippets that `docs/research/herdr-api.md` quotes by path.
- `renderer/ui-lab/`: static HTML mock-ups and PNGs, no scripts.

## Type-check coverage

`npm run typecheck` runs `tsconfig.{node,renderer,test,preload,experiments}.json`, then compares the union of their file
lists with every tracked or untracked `.ts/.cts/.js/.mjs/.cjs` file outside `docs/ scratch/ dist/ out/` and fails on any
orphan (currently none). `tsconfig.json` is the editor catch-all and is not run: combining the DOM and node libs in one
program reports false positives (`preload.cts` is CommonJS, and the page-evaluating scripts see the renderer's `window.__hq`).
`tsconfig.node.json` uses the `ES2023` lib to match `target`; Node 24 supports more, but nothing in the code needs it.
