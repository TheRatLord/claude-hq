# TypeScript port guide

Goal: a strict TypeScript codebase with identical runtime behaviour. This is a port, not a refactor. Every source file is
already `.ts` (see `docs/port/rename.mjs`); your job is to make your area type-check with no `any`.

## How it runs (no build step, except one file)

- Node 24 strips types natively, so `server/`, `shared/`, `scripts/`, tests and `electron/main.ts` run as-is:
  `node server/main.ts`, `node --test "**/*.test.ts"`, `node scripts/dev.ts`. Electron 44's embedded Node (24.21) does the
  same, including for the in-process backend. Vite compiles `renderer/src/**/*.ts` (and `vite.config.ts`).
- Stripping only erases types, so the code must be **erasable syntax** (`erasableSyntaxOnly` enforces it): no `enum`, no
  `namespace`, no constructor parameter properties (`constructor(private x)`), no `import x = require()`, no `export =`,
  no decorators. Use `as const` objects + union types instead of enums, and declare + assign fields explicitly.
- The one exception is the sandboxed Electron preload (`electron/preload.cts`): Electron loads it as plain CJS text, so it
  is compiled by `npm run build:preload` into `out/preload/preload.cjs` (gitignored; `npm start` does it via `prestart`).
- TypeScript is 7.x (the native `tsc`): whole-repo check takes about 2 s. `baseUrl` no longer exists (there are no path
  aliases; `@shared` is unused in source), and options must not rely on removed modes.

## Projects and commands

| config | covers | libs / types |
| --- | --- | --- |
| `tsconfig.node.json` | `shared/ server/ scripts/ electron/` (not tests), `vite.config.ts` | ES2023, `@types/node` |
| `tsconfig.renderer.json` | `renderer/src` (not tests) + `shared/` | ES2023 + DOM, `vite/client` |
| `tsconfig.test.json` | every `*.test.ts` and `server/test/` helpers | ES2023 + DOM, node + vite/client |
| `tsconfig.preload.json` | `electron/preload.cts` (emits) | node |
| `tsconfig.experiments.json` | `experiments/` (bench page, probes) + `renderer/src/stubs` | ES2023 + DOM, node + vite/client |
| `tsconfig.json` | everything, for editors only (not run by `typecheck`, see DEVIATIONS.md) | DOM + node |

All extend `tsconfig.base.json`: `strict`, `noImplicitOverride`, `erasableSyntaxOnly`, `verbatimModuleSyntax`,
`allowImportingTsExtensions`, `skipLibCheck`; `noUncheckedIndexedAccess` is off.

```sh
npm run typecheck                        # all five projects + the coverage check
node scripts/typecheck.ts --dirs         # + unique errors per directory (the table in STATUS.md)
npx tsc -p tsconfig.renderer.json | grep '^renderer/src/ui/'      # only your files, renderer sources
npx tsc -p tsconfig.node.json     | grep '^server/enrich'          # node-side sources
npx tsc -p tsconfig.test.json     | grep '^server/enrich'          # the tests of the same dir
npm test                                 # must stay 781 pass (+ new tests) / 1 known failure (golden, see STATUS.md)
```

Type-check your sources in their project *and* your `*.test.ts` in the test project. Never leave a file failing in one of them.

## Imports and exports

- Relative imports keep the extension, now `.ts`: `import { x } from './foo.ts'`. Package imports do not change
  (`'three'`, `'three/examples/jsm/utils/BufferGeometryUtils.js'`, `'ws'`, `'node:fs'`).
- `verbatimModuleSyntax` is on: anything that is only a type must be imported with `import type { X } from '...'`, or
  `import { a, type X } from '...'` when mixed. Same for `export type { X } from '...'`. A wrongly value-imported type
  fails at runtime under type stripping, not just in tsc.
- Named exports, no default-export churn, no barrel rewrites. Keep file names, module boundaries and export names.
- Dynamic `import()` and `import.meta.glob` keys use `.ts` specifiers.

## Where types live

- **Wire contract** (server <-> renderer): `shared/protocol.ts`. `Entity`, `Workspace`, `Stats`, `Settings`, `Status`,
  `Kind`, `ToolClass`, `EventKind`, `TermState`, ... plus the message unions: `ServerMsg` (discriminated on `t`),
  `ClientMsg` / `ClientPayloads` / `ClientMsgOf<'spawn'>`, `ReplyMsg`, `Frame`, `Rule`. The runtime arrays and their types
  come as a pair: `STATUSES` (readonly tuple) and `type Status = (typeof STATUSES)[number]`.
  `EVENT_OWNERS`, `FIELD_OWNERS` are `Record<OwnerName, ...>`. Change a shape there and DESIGN.md in the same commit.
- **Backend seams**: `server/interfaces.ts`: `HerdrSource` (typed events), `Enricher`, `Clock`, `Logger`,
  `TerminalBackend/Handle`, and the herdr wire shapes `RawSnapshot/RawPane/RawWorkspace/RawTab/RawAgent/RawLayout`.
  Need another herdr field? Add it there (optional) rather than casting at the use site. `shared/classify.ts` exports
  `HerdrProcessInfo`, `BashCategory`, `ToolInput`.
- **Renderer cross-area types**: keep them with their owner and import them (`import type`). The shared ones: `Ctx` in
  `renderer/src/core/ctx.ts`, the bus event map in `renderer/src/core/bus.ts` (below), palette tuples `Rgb/Lab/Lch` in
  `shared/palette.ts`. Do not invent a global `types.ts` dumping ground.
- Module-local types go at the top of the module, next to the code that uses them. Convert every JSDoc `@typedef` into an
  `interface` / `type` (export it if any other file uses or could use it). Delete `@param {T}` / `@returns {T}` /
  `@type {T}` once the signature carries the type; keep the prose (`@param x what it means`, or fold it into the doc sentence).
- Type by shape, not by wishful naming: a `type` for unions/tuples/mapped types, an `interface` for object shapes.

## Strictness rules

Forbidden: `any` (including `as any`, `Function`, `{}`-as-object, `Object`), `@ts-ignore`, `// @ts-nocheck`, non-null
assertions used to silence real nullability (`x!` only where an invariant is documented in a comment), `enum`.

- `@ts-expect-error` only when truly unavoidable, always with a reason on the same or the previous line
  (`// @ts-expect-error deliberately not a status: exercises the fallback`). Its main legitimate use is a test that feeds
  deliberately invalid input to a typed API. Never in production code without a reviewer-visible reason.
- `as` casts only at genuine boundaries where the compiler cannot know: `three` `userData`, DOM queries, `Object.keys`
  / `Object.entries` key narrowing, `JSON.parse` results you have just validated. Put the cast in one helper, comment why.
  Never widen with a cast to make an error go away; fix the type.
- Prefer, in order: precise types, generics, discriminated unions, literal unions, `unknown` + narrowing, then a cast.
- Fix real bugs the checker exposes (unreachable branches, `undefined` used as a number, wrong argument order, a missing
  field on a shape). Do not change behaviour to please the types: list each such fix in your summary (file, what, why).
  If a fix would change behaviour, keep the behaviour and note it instead.
- `noImplicitOverride` is on: put `override` on every overriding method (`override update(...) {}`). `override` is erasable.
- Class fields: declare them with types (`connected: boolean;`) and assign in the constructor exactly as before. Do not turn
  them into parameter properties (not erasable) and do not add initialisers that change ordering.

## Boundaries: wire, JSON, herdr, errors

Data that arrives as `unknown` is narrowed at the edge, once, and typed inside. `shared/guards.ts` has the primitives:

```ts
import { isRecord, errMessage, errCode } from '../shared/guards.ts';

try { ... } catch (e) {                    // e is unknown
  log.warn('x failed', errMessage(e));     // never e.message
  if (errCode(e) === 'ENOENT') ...
}

const raw: unknown = JSON.parse(text);
if (!isRecord(raw) || typeof raw.t !== 'string') return;
```

- **Renderer -> server text frames**: already validated by `parseClientText()` / `validateMessage()` (`shared/protocol.ts`,
  the `VALIDATE` table mirrors `ClientPayloads` key for key, so adding a message means one entry in each). It returns a
  `ClientMsg`; switch on `msg.t` and the payload narrows: `case 'term.open': msg.cols`.
- **Server -> renderer frames**: type the parsed frame as `ServerMsg` after checking `t` is one of `S2R`'s values (write a
  `isServerMsg` guard in `renderer/src/net`). Then `switch (msg.t)` narrows every variant. `EventMsg.detail`,
  `TimelineItem.detail` and `ReplyMsg`'s extra fields are `unknown` on purpose: narrow before use.
- **herdr replies** (`server/herdr/client.ts`): `request()` returns `unknown`. Add a small interface per method next to the
  caller (or in `server/interfaces.ts` when shared) and narrow with `isRecord` + `Array.isArray` + `typeof`.
  Do not declare herdr JSON as trusted types without a guard.
- **Transcript JSONL lines** (`server/enrich/*`): same, narrow line by line; tool inputs are `ToolInput` (`Record<string, unknown>`).
- Binary frames: `Frame`, `decodeFrame(): Frame | null`; check for `null`.
- Timers: use the injected `Clock` (`TimerHandle`), never node's global timers in `server/` (a lint test enforces it,
  it also matches the word inside doc comments, so write comments with a line break or different wording).

## three.js

- Import namespace-style as today (`import * as THREE from 'three'`); types come from `@types/three` 0.186. Type the
  things you hold: `THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>`, `THREE.InstancedMesh`, `THREE.Group`.
- **`userData`** is `Record<string, any>` in the typings and is where `any` leaks in. Declare the shape you store
  (`interface PropData { slot: string; anchor: THREE.Vector3 }`) and read/write it through one typed accessor in the
  owning module, the single allowed cast:

  ```ts
  const propData = (o: THREE.Object3D): PropData => o.userData as PropData;
  ```

  If a module needs to test for presence, make the fields optional and narrow. Do not spread `as any` around.
- **Uniforms / shaders**: `THREE.ShaderMaterial.uniforms` is `{ [name: string]: THREE.IUniform }`; keep your own typed record
  (`interface PostUniforms { uTime: THREE.IUniform<number>; ... }`) and assign it to `uniforms`. `onBeforeCompile(shader)`
  gets `WebGLProgramParametersWithUniforms`; patch through that type.
- Materials can be `Material | Material[]`: narrow with `Array.isArray` before use; never cast to `Mesh['material']` blindly.
- `three/examples/jsm/*` modules are typed; keep the `.js` specifiers of those package paths.
- Vectors/colors/quaternions in hot paths stay preallocated exactly as they are; only add types, do not restructure allocation.
- `postprocessing`, `n8ao`, `@xterm/*` ship their own types; `n8ao` may lack full ones: add a minimal `declare module` in
  `renderer/src/stubs/` (an `*.d.ts` there, included by the renderer project) rather than casting to `any`.

## DOM

- Queries: `document.getElementById('view') as HTMLCanvasElement` is an accepted cast. Prefer
  `querySelector<HTMLInputElement>(sel)` (generic, no cast) and handle `null` (`if (!el) return`).
- `renderer/src/ui/dom.ts` `h(tag, attrs, ...kids)` returns `HTMLElement`. Give it an overload / generic for the tag map
  (`h<K extends keyof HTMLElementTagNameMap>(tag: K, ...)`) so `h('canvas')` is a `HTMLCanvasElement`; its `attrs` are
  `Record<string, unknown>` narrowed inside. Callers that need a subtype use the generic, not a cast.
- Event handlers: `(e: KeyboardEvent) => ...`, `addEventListener('keydown', ...)` infers it; do not annotate `Event` and
  cast. `e.target` needs `instanceof` narrowing (`e.target instanceof HTMLElement`).
- `window.__hq` / `window.hqElectron`: one `declare global { interface Window { ... } }` block, in the module that creates
  them (`core/debug.ts` for `__hq`, `net`/`ui` for `hqElectron`). Nobody else augments `Window`.
- Do not use `document` / `window` types in `shared/` or `server/` (their projects have no DOM lib).

## Event bus and registries

- `createBus()` in `renderer/src/core/bus.ts` becomes generic over a topic map, the single registry of topics:

  ```ts
  export interface BusEvents {
    'player.step': { surface: string; speed: number };
    select: { id: string | null };
    // owners append their topics here
  }
  export interface Bus {
    on<K extends keyof BusEvents>(topic: K, fn: (payload: BusEvents[K]) => void): () => void;
    emit<K extends keyof BusEvents>(topic: K, payload: BusEvents[K]): void;
    // once / off likewise
  }
  ```

  A topic that carries no payload uses `undefined`/`void`. An unknown topic is a type error (the old code silently accepted
  typos): add it to `BusEvents` in the same change. CORE owns the file; other owners send a one-line addition.
- `hqRegister(name, fn)` in `core/debug.ts`: type `name` as the `HQ_PLUGGABLE` union and give each pluggable call its
  signature in one `HqPlug` interface, so `__hq.probe(...)` is typed for the callers.
- Keep lookup tables typed `Record<Union, T>` (exhaustive) when they must cover every member (like `ACTION_CLASS`,
  `EVENT_OWNERS`), and `Partial<Record<...>>` when optional.

## Tests

- Test files stay next to their code, named `*.test.ts`, using `node:test` + `node:assert/strict` exactly as before. They are
  type-checked by `tsconfig.test.json` and must pass `npm test` unchanged in behaviour.
- Type fixtures instead of casting them: `const rows: [[string, string[]], ShellActivity][] = [...]`, `Map<string, number>`.
  To reach into a possibly-null result use `assert.ok(x)` (it narrows) or `x?.field`.
- Deliberately invalid input to a typed function: `// @ts-expect-error <why>` on the line above, so the test keeps proving
  the runtime guard and the type stays strict for real callers. Do not loosen the production signature for a test.
- Test doubles: build them as real typed objects (`Partial<Entity>`, a `FakeClock` that satisfies `Clock`); avoid
  `as unknown as X` chains. If a double is used in many tests, export a typed factory from `server/test/` (helpers there are
  type-checked by the test project).
- Do not rename tests, change assertions or thresholds, or touch snapshots/goldens. The lint-style tests scan sources for
  patterns (`clock.test`, `callpaths.test`, `seams.test`, `kit.test`, `unusedImports.test`); they already look at `*.ts`.

## Things that will bite

- A value-only import of a type erases badly at runtime: use `import type`.
- `Object.freeze([...] as const)` is how constant lists get literal types; `Object.keys()` returns `string[]`, so re-narrow
  with a documented cast when the key set is known (`SETTINGS_KEYS` does this once).
- Optional properties vs `| undefined`: mirror the runtime. If the code writes `x.y = undefined` a lot, the type is `y?: T`.
- Prose comments and old JSDoc mention `.js` filenames (`ui/index.js`); that is fine, fix them opportunistically only if
  you are editing the line anyway.
- Do not run `npm install`, do not add dependencies, do not touch `docs/DESIGN.md` (LEAD adds one short "TypeScript"
  section at the end of the port pointing here).
- Herdr safety is unchanged: never mutate the default session; mutating tests only in the named session `hqtest`; never run
  bare `herdr`. Dev stack: `node scripts/dev.ts --port P --vite-port P+1 --config-dir <scratch outside the repo>`; kill it.
