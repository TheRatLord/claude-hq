#!/usr/bin/env node
// Dev stack (DESIGN §2.2): backend `server/main.ts --demo 12 --dev` + vite (proxying /ws, /healthz, /debug), then
// prints the renderer URL with the token.
//
// usage: node scripts/dev.ts [--session S] [--demo [N]] [--scenario name] [--seed S] [--timescale K]
//                             [--port 7462] [--vite-port 7461] [--config-dir dir] [--quiet] [-- extra backend args]
//   --session S     live herdr session instead of demo (`npm run dev:hq` = --session hqtest)
//   ports           also HQ_BACKEND_PORT / HQ_VITE_PORT (parallel engineers: pick unique ports)
//   --config-dir    CLAUDE_HQ_CONFIG_DIR for the backend (token, settings); refused inside the repo (holds the token)
//   --no-hmr        vite without HMR / file watching (edits by others can't reload the page; code is a snapshot)
// Also importable: `startDevStack(opts) → {url, base, token, backendPort, vitePort, close()}`, `freePort()`.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errMessage } from '../shared/guards.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));

export interface DevOpts {
  session?: string | null;
  /** agent count (ignored with session) */
  demo?: number;
  scenario?: string | null;
  seed?: string | number | null;
  timescale?: number | null;
  /** backend port */
  port?: number;
  vitePort?: number;
  configDir?: string | null;
  /** more backend args */
  extra?: string[];
  /** false: vite without HMR / file watching, so another engineer's edit can't reload the page mid-measurement (perf,
   *  review shots); the served code is then a snapshot */
  hmr?: boolean;
  /** don't pipe child output */
  quiet?: boolean;
  /** false → backend only (serves dist/) */
  vite?: boolean;
}

/** A child process plus the last lines of its output (kept to explain an early exit). */
type TailedChild = ChildProcess & { hqTail?: string[] };

/** A currently free loopback TCP port (for scripts that must not collide with other dev stacks). */
export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address() as net.AddressInfo; /* listening on TCP, never a pipe path */ srv.close(() => resolve(port)); });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms: number, child?: TailedChild) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child && child.exitCode !== null) {
      // surface why (e.g. the backend's own usage error) instead of just the exit code
      const tail = (child.hqTail ?? []).slice(-8).map((l) => `\n  | ${l}`).join('');
      throw new Error(`${url}: process exited with ${child.exitCode}${tail}`);
    }
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return r.status;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${url}`);
}

/**
 * Refuse a backend config dir inside the repo (m2-carryover): it holds the auth token + settings, and anything under the
 * repo is one misconfigured static server away from being served (it was: /@fs/.../scratch/INT/cfg/token → 200).
 * Symlinks resolved on both sides; a not-yet-existing dir is judged by its nearest existing ancestor.
 */
export function assertConfigDirOutsideRepo(dir: string | null | undefined) {
  if (!dir) return;
  const real = (p: string): string => { let cur = path.resolve(p); const rest: string[] = []; for (;;) { try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch { const up = path.dirname(cur); if (up === cur) return path.resolve(p); rest.push(path.basename(cur)); cur = up; } } };
  const repo = real(REPO), d = real(dir);
  if (d === repo || d.startsWith(repo + path.sep)) {
    throw new Error(`refusing --config-dir ${dir}: it is inside the repo (${repo}); backend config dirs hold the auth token. ` +
      'Use your session scratchpad or os.tmpdir() instead');
  }
}

export async function startDevStack(o: DevOpts = {}) {
  assertConfigDirOutsideRepo(o.configDir || process.env.CLAUDE_HQ_CONFIG_DIR);
  { const extra = o.extra ?? [], i = extra.indexOf('--config-dir'); if (i >= 0) assertConfigDirOutsideRepo(extra[i + 1]); }
  const port = o.port ?? Number(process.env.HQ_BACKEND_PORT ?? 7462);
  const vitePort = o.vitePort ?? Number(process.env.HQ_VITE_PORT ?? 7461);
  const useVite = o.vite !== false;
  const env: NodeJS.ProcessEnv = { ...process.env, HQ_BACKEND_PORT: String(port), HQ_VITE_PORT: String(vitePort) };
  if (o.configDir) env.CLAUDE_HQ_CONFIG_DIR = o.configDir;

  const args = ['server/main.ts', '--port', String(port), '--new-instance'];
  if (useVite) args.push('--dev');
  if (o.session) args.push('--session', o.session);
  else args.push('--demo', String(o.demo ?? 12));
  if (o.scenario) args.push('--scenario', o.scenario);
  if (o.seed !== undefined && o.seed !== null) args.push('--seed', String(o.seed));
  if (o.timescale) args.push('--timescale', String(o.timescale));
  args.push(...(o.extra ?? []));

  const children: TailedChild[] = [];
  let token: string | null = null;
  const pipe = (child: TailedChild & { stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream }, tag: string) => {
    const onData = (buf: Buffer) => {
      const s = buf.toString();
      const m = /[?&]t=([0-9a-f]{64})/.exec(s);
      if (m) token = m[1];
      child.hqTail = [...(child.hqTail ?? []), ...s.split('\n').filter((l) => l.trim())].slice(-20);
      if (!o.quiet) for (const line of s.split('\n')) if (line.trim()) process.stderr.write(`[${tag}] ${line}\n`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  };
  const backend = spawn(process.execPath, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(backend);
  pipe(backend, 'backend');
  let vite: TailedChild | null = null;
  if (useVite) {
    const viteArgs = [path.join(REPO, 'node_modules/vite/bin/vite.js'), '--clearScreen', 'false'];
    if (o.hmr === false) viteArgs.push('--config', frozenViteConfig());
    const v = spawn(process.execPath, viteArgs, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    vite = v;
    children.push(v);
    pipe(v, 'vite');
  }
  const close = async () => {
    for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
    await Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise<void>((r) => { const t = setTimeout(() => { c.kill('SIGKILL'); r(); }, 3000); c.once('exit', () => { clearTimeout(t); r(); }); }))));
  };
  try {
    await waitHttp(`http://127.0.0.1:${port}/healthz`, 20000, backend);
    if (vite) await waitHttp(`http://127.0.0.1:${vitePort}/`, 20000, vite);
  } catch (e) {
    await close();
    throw e;
  }
  if (!token) {
    const dir = o.configDir || process.env.CLAUDE_HQ_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claude-hq');
    try { token = fs.readFileSync(path.join(dir, 'token'), 'utf8').trim(); } catch { /* none */ }
  }
  const base = `http://127.0.0.1:${useVite ? vitePort : port}/`;
  const url = token ? `${base}?t=${token}` : base;
  return { url, base, token, backendPort: port, vitePort, backend, vite, close };
}

/** A running dev stack (what startDevStack resolves to). */
export type DevStack = Awaited<ReturnType<typeof startDevStack>>;

/** A vite config = the repo's, minus HMR and the file watcher (written once per process to the OS temp dir). */
let frozenConfigPath: string | null = null;
function frozenViteConfig() {
  if (frozenConfigPath) return frozenConfigPath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-vite-'));
  frozenConfigPath = path.join(dir, 'vite.frozen.config.mjs');
  const base = new URL('vite.config.ts', `file://${REPO.endsWith('/') ? REPO : REPO + '/'}`).href;
  fs.writeFileSync(frozenConfigPath, `import cfg from ${JSON.stringify(base)};\n` +
    `export default { ...cfg, server: { ...cfg.server, hmr: false, watch: null } };\n`);
  return frozenConfigPath;
}

/** CLI argv → DevOpts; throws UsageError on bad input (exported for tests). */
export function parseArgs(argv: string[]): DevOpts & { extra: string[] } {
  const o: DevOpts & { extra: string[] } = { extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o.extra.push(...argv.slice(i + 1)); break; }
    else if (a === '--session') o.session = argv[++i];
    // `--demo [N]` mirrors server/main.ts: the count is optional (default 12), clamped 1..64 by the backend
    else if (a === '--demo') { if (/^\d+$/.test(argv[i + 1] ?? '')) o.demo = Number(argv[++i]); else o.demo = 12; }
    else if (a === '--scenario') o.scenario = argv[++i];
    else if (a === '--seed') o.seed = argv[++i];
    else if (a === '--timescale') o.timescale = numArg(a, argv[++i]);
    else if (a === '--port') o.port = numArg(a, argv[++i]);
    else if (a === '--vite-port') o.vitePort = numArg(a, argv[++i]);
    else if (a === '--config-dir') o.configDir = argv[++i];
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--no-hmr') o.hmr = false;
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
      process.exit(0);
    } else throw new UsageError(`unknown arg ${a}`);
  }
  if (o.session === 'default') throw new UsageError('refusing --session default (use the hqtest session; §9.3)');
  return o;
}

const USAGE = 'usage: node scripts/dev.ts [--session S] [--demo [N]] [--scenario name] [--seed S] [--timescale K] ' +
  '[--port P] [--vite-port P] [--config-dir dir] [--quiet] [--no-hmr] [-- extra backend args]';
class UsageError extends Error {}
function numArg(flag: string, v: string | undefined) {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n)) throw new UsageError(`${flag} needs a number (got ${v === undefined ? 'nothing' : JSON.stringify(v)})`);
  return n;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let o: DevOpts;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`dev.ts: ${e.message}\n${USAGE}`);
    process.exit(1);
  }
  let stack: DevStack;
  try {
    stack = await startDevStack(o);
  } catch (e) {
    console.error(`dev.ts: ${errMessage(e)}`);
    process.exit(1);
  }
  console.log(`\n  Claude HQ dev → ${stack.url}\n  (ssh tunnel: ssh -L ${stack.vitePort}:127.0.0.1:${stack.vitePort} <host>)\n`);
  const stop = async () => { await stack.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  for (const c of [stack.backend, stack.vite]) c?.on('exit', (code) => { console.error(`dev.ts: child exited (${code}); stopping`); stop(); });
}
