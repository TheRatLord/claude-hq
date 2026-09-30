#!/usr/bin/env node
/** Demo-only Vite workbench. Production output is served by the existing backend CLI. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import type { ProxyOptions, ViteDevServer } from 'vite';
import { createApp } from '../server/app.ts';
import type { App } from '../server/app.ts';
import { SCENARIOS } from '../shared/protocol.ts';
import { errMessage } from '../shared/guards.ts';

const root = fileURLToPath(new URL('../renderer/workbench', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
let port = 7461, seed = 1, population = 12, scenario = 'mixed', buildOnly = false;
const integer = (value: string | undefined, flag: string, min: number, max: number): number => {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${flag} requires an integer (${min}–${max})`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${flag} requires an integer (${min}–${max})`);
  return n;
};

async function main(): Promise<void> {
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--build': buildOnly = true; break;
      case '--port': port = integer(args[++i], '--port', 0, 65535); break;
      case '--seed': seed = integer(args[++i], '--seed', 0, 0xffffffff); break;
      case '--demo':
        if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) population = integer(args[++i], '--demo', 1, 64);
        break;
      case '--scenario':
        scenario = args[++i];
        if (!SCENARIOS.includes(scenario)) throw new Error(`--scenario must be one of: ${SCENARIOS.join(', ')}`);
        break;
      case '--help':
      case '-h':
        console.log('usage: npm run dev -- [--port N] [--demo [1..64]] [--scenario NAME] [--seed UINT32]\n       npm run build');
        return;
      default: throw new Error(`unknown argument ${args[i]}`);
    }
  }
  const config = { configFile: false as const, root, build: { outDir: path.join(repo, 'dist'), emptyOutDir: true } };
  if (buildOnly) {
    await build(config);
    return;
  }

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-workbench-'));
  let vite: ViteDevServer | undefined;
  let app: App | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    // Stop browser sockets before closing the backend and its terminal viewers.
    try { await vite?.close(); } finally {
      try { await app?.close(); } finally { fs.rmSync(configDir, { recursive: true, force: true }); }
    }
  })();
  const stop = (): void => { void close().then(() => process.exit(0), (e: unknown) => { console.error(errMessage(e)); process.exit(1); }); };
  const proxies: ProxyOptions[] = [];
  const proxy = (ws = false): ProxyOptions => ({
    // Patched before publishing the URL, once both ephemeral ports are known.
    target: 'http://127.0.0.1:1', ws,
    configure: (_proxy, options) => { proxies.push(options); },
  });
  try {
    vite = await createServer({
      ...config,
      server: {
        host: '127.0.0.1', port, strictPort: true,
        fs: { allow: [repo] },
        proxy: { '/ws': proxy(true), '/healthz': proxy(), '/debug': proxy(), '/api': proxy() },
      },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('workbench did not bind a TCP port');
    app = await createApp({ demo: population, scenario, seed, port: 0, dev: true, vitePort: address.port, configDir });
    for (const options of proxies) options.target = `http://127.0.0.1:${app.port}`;
    const url = new URL(`http://127.0.0.1:${address.port}/`);
    url.searchParams.set('t', app.token);
    url.searchParams.set('scenario', scenario);
    url.searchParams.set('seed', String(seed));
    console.log(`HQ workbench → ${url}`);
    console.log(`Demo only: ${population} agents, scenario ${scenario}, seed ${seed}. Ctrl+C closes both servers and removes temporary state.`);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
  } catch (e) {
    await close();
    throw e;
  }
}

void main().catch((e: unknown) => { console.error(`workbench: ${errMessage(e)}`); process.exitCode = 1; });
