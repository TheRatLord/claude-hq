#!/usr/bin/env node
/**
 * Backend CLI:
 *   node server/main.ts [--port 7462] [--session <name>|default] [--demo [N]] [--scenario <name>] [--seed S]
 *     [--dev [--vite-port P]] [--record f.ndjson] [--replay f.ndjson [--speed K]] [--new-instance] [--metrics]
 *     [--timescale K]
 * Prints the URL (with token) on stdout. SIGINT/SIGTERM/SIGHUP → clean close; a second signal exits immediately.
 *
 * Single instance: a live backend for the same session → print its URL and exit 0 (`--new-instance` refuses
 * instead). Owner: BE. --record/--replay: record.ts (BE2), wired in app.ts.
 */
import { createApp } from './app.ts';
import type { App } from './app.ts';
import type { AppOptions } from './config.ts';
import { errMessage } from '../shared/guards.ts';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORT, ALLOW_MUTATIONS_REMOVED, resolveConfig, loadOrCreateToken } from './config.ts';
import { findLive } from './instance.ts';

export type CliOptions = AppOptions & { port: number; help?: boolean };

export function parseArgs(argv: string[]): CliOptions {
  const o: CliOptions = { port: DEFAULT_PORT };
  const num = (v: string | undefined, flag: string): number => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n)) throw new Error(`${flag} needs a number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--port': o.port = num(next(), a); break;
      case '--session': o.session = next(); if (!o.session) throw new Error('--session needs a name'); break;
      case '--demo': {
        const v = argv[i + 1];
        if (v !== undefined && /^\d+$/.test(v)) {
          o.demo = Math.max(1, Math.min(64, Number(v)));
          i++;
        } else o.demo = 12;
        break;
      }
      case '--scenario': o.scenario = next(); break;
      case '--seed': o.seed = num(next(), a); break;
      case '--allow-mutations': throw new Error(ALLOW_MUTATIONS_REMOVED);
      case '--dev': o.dev = true; break;
      case '--vite-port': o.vitePort = num(next(), a); break; // --dev: the one extra WS Origin port (default HQ_VITE_PORT/7461)
      case '--metrics': o.metrics = true; break;
      case '--new-instance': o.newInstance = true; break;
      case '--record': o.record = next(); break;
      case '--replay': o.replay = next(); break;
      case '--speed': o.speed = num(next(), a); break;
      case '--dist': o.distDir = next(); if (!o.distDir) throw new Error('--dist needs a directory'); break;
      case '--config-dir': o.configDir = next(); if (!o.configDir) throw new Error('--config-dir needs a directory'); break;
      case '--timescale': o.timescale = num(next(), a); if (o.timescale <= 0) throw new Error('--timescale must be > 0'); break;
      case '-h':
      case '--help': o.help = true; break;
      default: throw new Error(`unknown argument ${a}`);
    }
  }
  if (o.timescale !== undefined && o.timescale !== 1 && !o.demo && !o.replay) throw new Error('--timescale is only accepted with --demo or --replay');
  return o;
}

async function main() {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`claude-hq: ${errMessage(e)}\n`);
    process.exit(2);
  }
  if (opts.help) {
    process.stdout.write('usage: node server/main.ts [--port 7462] [--session S] [--demo [N]] [--scenario NAME] [--seed S] ' +
      '[--dev [--vite-port P]] [--dist DIR] [--config-dir DIR] [--metrics] [--timescale K] [--new-instance] [--record F] [--replay F [--speed K]]\n');
    return;
  }
  const cfg = resolveConfig(opts);
  // demo backends hold no herdr children and may coexist (parallel dev stacks); live sessions are single-instance
  const live = cfg.demo || opts.replay ? { live: false as const } : await findLive(cfg.configDir, cfg.session);
  if (live.live === true && 'lock' in live) {
    if (opts.newInstance) {
      process.stderr.write(`claude-hq: a backend for session "${cfg.session}" is already running (pid ${live.lock.pid}, port ${live.lock.port})\n`);
      process.exit(1);
    }
    const token = loadOrCreateToken(cfg.configDir);
    process.stdout.write(`Claude HQ already running for session "${cfg.session}" → http://127.0.0.1:${live.lock.port}/?t=${token}\n`);
    process.exit(0);
  }
  const app = await createApp(opts);
  // M1 integ: handlers before the URL is printed (callers signal as soon as they see it).
  let stopping = false;
  const stop = (sig: string): void => {
    if (stopping) {
      process.stderr.write(`claude-hq: second ${sig}, killing children and exiting now\n`);
      app.kill();
      process.exit(1);
    }
    stopping = true;
    app.close().then(() => process.exit(0), (e: unknown) => {
      process.stderr.write(`claude-hq: close failed: ${(e instanceof Error ? e.stack : undefined) ?? String(e)}\n`);
      process.exit(1);
    });
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig));
  const banner = opts.replay ? `REPLAY ${opts.replay}` : opts.demo ? `DEMO ×${opts.demo}` : `session "${app.session}"`;
  process.stdout.write(`Claude HQ ${banner} → ${app.url}\n`);
  if (!opts.dev) {
    process.stdout.write(`remote: ssh -L ${app.port}:127.0.0.1:${app.port} ${os.hostname()}   (on your laptop), then open the URL above\n`);
    const mode = modeLine(app, opts);
    if (mode) process.stdout.write(`${mode}\n`);
    if (!fs.existsSync(path.join(cfg.distDir, 'index.html'))) {
      process.stderr.write(`claude-hq: no frontend bundle at ${cfg.distDir}; backend API is available. Use --dist DIR to serve a frontend.\n`);
    }
  }

}

/** One line on what HQ may do in this session (the safety model at a glance). */
export function modeLine(app: Pick<App, 'client' | 'actions' | 'session'>, opts: Pick<AppOptions, 'demo' | 'replay'>): string | null {
  if (opts.demo || opts.replay) return null;
  if (app.client?.readOnly) return `mode: herdr protocol mismatch → READ-ONLY (view and observe only; upgrade herdr or HQ)`;
  if (app.actions?.isDefault) {
    return 'mode: DEFAULT session, read-only-safe: terminals open only when you click, prompts/answers need your confirm, hiring/closing panes is refused';
  }
  return `mode: named session "${app.session}": full actions (hire, prompt, answer, close)`;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.replaceAll('\\', '/').endsWith('/server/main.ts')) {
  main().catch((e: unknown) => {
    process.stderr.write(`claude-hq: ${errMessage(e)}\n`);
    process.exit(1);
  });
}
