// Type-only: the debug handle RND (post.ts, monitorAtlas.ts) and the probe (debug/probe.ts) hang on `globalThis`
// (devtools / review scripts: `__hqRender.post.setDebugEdge(true)`, `__hqRender.monitors.screenRect(...)`). Members are
// `unknown` so this file pulls in no other module; owners narrow what they read.
export interface HqRenderHandle {
  /** post.ts: the `Post` */
  post?: unknown;
  /** post.ts: the shared uniforms (`U`) */
  U?: unknown;
  /** monitorAtlas.ts: `screenRect`, `rectFor`, `stats`, `live`, `shoulder` */
  monitors?: unknown;
  /** debug/probe.ts */
  checks?: unknown;
  tallyCheck?: unknown;
  popCheck?: unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var __hqRender: HqRenderHandle | undefined;
}
