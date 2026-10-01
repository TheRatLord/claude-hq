/**
 * Demo dev server: Vite (renderer/, multi-page) proxied to an in-process demo backend. Used by `npm run dev`
 * (scripts/workbench.ts) and `npm run shoot` (scripts/shoot.ts).
 *
 * Pages: /  (the valley)   /workbench/  (terminal + protocol workbench)   /gallery/  (asset gallery, no backend needed)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import type { InlineConfig, ProxyOptions, ViteDevServer } from 'vite';
import { createApp } from '../server/app.ts';
import type { App } from '../server/app.ts';

export const REPO = fileURLToPath(new URL('..', import.meta.url));
export const RENDERER = path.join(REPO, 'renderer');

export function viteConfig(): InlineConfig {
  return {
    configFile: false,
    root: RENDERER,
    logLevel: 'warn',
    // loaded lazily by the placement audit (dev/placement.ts); pre-bundle it so its first import does not reload the page
    optimizeDeps: { include: ['three-mesh-bvh'] },
    build: {
      outDir: path.join(REPO, 'dist'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        input: {
          main: path.join(RENDERER, 'index.html'),
          workbench: path.join(RENDERER, 'workbench/index.html'),
          gallery: path.join(RENDERER, 'gallery/index.html'),
        },
      },
    },
  };
}

export async function buildRenderer(): Promise<void> { await build(viteConfig()); }

export interface DevOpts { port?: number; seed?: number; population?: number; scenario?: string; timescale?: number; quiet?: boolean; hmr?: boolean }
export interface Dev { url: URL; origin: string; token: string; app: App; close(): Promise<void> }

export async function startDev(o: DevOpts = {}): Promise<Dev> {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-dev-'));
  let vite: ViteDevServer | undefined;
  let app: App | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    try { await vite?.close(); } finally {
      try { await app?.close(); } finally { fs.rmSync(configDir, { recursive: true, force: true }); }
    }
  })();
  const proxies: ProxyOptions[] = [];
  const proxy = (ws = false): ProxyOptions => ({
    target: 'http://127.0.0.1:1', ws,
    configure: (_proxy, options) => { proxies.push(options); },
  });
  try {
    vite = await createServer({
      ...viteConfig(),
      // one dependency cache per process: parallel shoot runs must not race on renderer/node_modules/.vite
      cacheDir: path.join(configDir, 'vite'),
      logLevel: o.quiet ? 'error' : 'info',
      server: {
        host: '127.0.0.1', port: o.port ?? 7461, strictPort: o.port !== 0,
        fs: { allow: [REPO] },
        proxy: { '/ws': proxy(true), '/healthz': proxy(), '/debug': proxy(), '/api': proxy() },
        // long-running tools (placement audit) must not be reloaded by someone else's edit mid-run
        ...(o.hmr === false ? { hmr: false, watch: null } : {}),
      },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('dev server did not bind a TCP port');
    app = await createApp({
      demo: o.population ?? 12, scenario: o.scenario ?? 'mixed', seed: o.seed ?? 1, port: 0, dev: true, vitePort: address.port, configDir,
      ...(o.timescale ? { timescale: o.timescale } : {}),
    });
    for (const options of proxies) options.target = `http://127.0.0.1:${app.port}`;
    const url = new URL(`http://127.0.0.1:${address.port}/`);
    url.searchParams.set('t', app.token);
    return { url, origin: url.origin, token: app.token, app, close };
  } catch (e) {
    await close();
    throw e;
  }
}
