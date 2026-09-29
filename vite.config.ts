// Vite config (DESIGN §2.1, §2.2). Root = renderer/; `/ws` is proxied to the backend so dev keeps one origin.
// Dev ports: vite 7461, backend 7462. Override with HQ_VITE_PORT / HQ_BACKEND_PORT (parallel engineers: pick unique ports).
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const vitePort = Number(process.env.HQ_VITE_PORT ?? 7461);
const backendPort = Number(process.env.HQ_BACKEND_PORT ?? 7462);

export default defineConfig({
  root: 'renderer',
  base: './',
  publicDir: false,
  resolve: {
    // renderer code imports shared modules as `@shared/protocol.ts` (or by relative path).
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: vitePort,
    strictPort: true,
    // [CORE m2-carryover cross-owner, LEAD file] Serve ONLY what the renderer needs. `allow: [repo]` exposed every file
    // under the repo root over /@fs/ (backend config dirs with live tokens in scratch/, docs, server/...).
    fs: {
      strict: true,
      allow: ['renderer', 'shared', 'node_modules'].map((d) => fileURLToPath(new URL(`./${d}/`, import.meta.url))),
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/token', '**/scratch/**'],
    },
    // Never watch scratch output / build output / backend config dirs (a 500 MB scratch/ made the watcher crawl).
    watch: { ignored: ['**/scratch/**', '**/dist/**', '**/docs/**', '**/server/**'] },
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${backendPort}`, ws: true, changeOrigin: false },
      '/healthz': { target: `http://127.0.0.1:${backendPort}` },
      '/debug': { target: `http://127.0.0.1:${backendPort}` },
      '/api': { target: `http://127.0.0.1:${backendPort}` }, // [BE M3.5 cross-owner] GET /api/audit (Recent HQ actions)
    },
  },
  preview: { host: '127.0.0.1', port: vitePort, strictPort: true },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2023',
    sourcemap: true,
    chunkSizeWarningLimit: 2048,
  },
});
