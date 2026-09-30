/**
 * Resolved options + paths (DESIGN §2.1, §2.2, §4.11, §4.9 D8). Owner: BE.
 *   session: --session → CLAUDE_HQ_SESSION → 'default'; in --demo, 'demo' unless --session is given (D8).
 *   ~/.config/claude-hq/{token, config.json (settings), <session>/ (since, slots, acks, children.json), <session>.lock}
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../shared/guards.ts';
import type { Clock } from './interfaces.ts';
import type { ScopedLogger } from './log.ts';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_PORT = 7462;
/** `--allow-mutations` / `opts.allowMutations` was removed (it could never enable anything): a hard error, not a no-op. */
export const ALLOW_MUTATIONS_REMOVED = '--allow-mutations was removed: a named session (--session hqtest) already allows hire/close, ' +
  'and nothing enables them in the default herdr session. Drop the flag.';

/** createApp / resolveConfig options; the CLI and programmatic consumers share this contract. */
export interface AppOptions {
  port?: number;
  session?: string;
  /** `true` = default N; a positive integer = N demo panes */
  demo?: boolean | number;
  scenario?: string;
  seed?: number;
  dev?: boolean;
  vitePort?: number;
  metrics?: boolean;
  timescale?: number;
  configDir?: string;
  distDir?: string;
  token?: string | null;
  newInstance?: boolean;
  /** removed option: passing it (any value) is a hard error */
  allowMutations?: unknown;
  clock?: Clock;
  log?: ScopedLogger;
  /** `false`: no single-instance lock file */
  lock?: boolean;
  herdrSocket?: string | null;
  herdrBin?: string;
  /** --replay F */
  replay?: string;
  /** --record F */
  record?: string;
  /** --replay speed factor */
  speed?: number;
  /** tests only */
  graceMs?: number;
}

/** Options after defaults (see resolveConfig). */
export interface ResolvedConfig {
  port: number;
  host: string;
  session: string;
  /** false, or the number of demo panes */
  demo: number | false;
  scenario: string;
  seed: number;
  dev: boolean;
  vitePort: number | null;
  metrics: boolean;
  timescale: number;
  configDir: string;
  distDir: string;
  token: string | null;
  newInstance: boolean;
}

/** ~/.config/claude-hq, overridable with CLAUDE_HQ_CONFIG_DIR (tests use a temp dir). */
export function defaultConfigDir() {
  return process.env.CLAUDE_HQ_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claude-hq');
}

/**
 * Read the backend token, creating 32 random bytes (hex, 0600) on first run.
 */
export function loadOrCreateToken(configDir: string): string {
  const file = path.join(configDir, 'token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
  } catch {}
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const t = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return t;
}

/** Normalise createApp options. */
export function resolveConfig(o: AppOptions = {}): ResolvedConfig {
  if (o.allowMutations !== undefined) throw new Error(ALLOW_MUTATIONS_REMOVED);
  const demo = o.demo === true ? 12 : typeof o.demo === 'number' && Number.isInteger(o.demo) && o.demo > 0 ? o.demo : o.demo ? 12 : false;
  const configDir = o.configDir ?? defaultConfigDir();
  return {
    port: o.port ?? DEFAULT_PORT,
    host: '127.0.0.1',
    session: o.session ?? (demo ? 'demo' : process.env.CLAUDE_HQ_SESSION ?? 'default'),
    demo,
    scenario: o.scenario ?? 'mixed',
    seed: o.seed ?? 1,
    dev: !!o.dev,
    // --dev permits a separately served frontend on this loopback port (http.ts originOk).
    vitePort: o.dev ? Number(o.vitePort ?? process.env.HQ_VITE_PORT ?? 7461) || null : null,
    metrics: !!(o.metrics || o.dev),
    timescale: o.timescale ?? 1,
    configDir,
    distDir: o.distDir ?? path.join(REPO_ROOT, 'dist'),
    token: o.token ?? null,
    newInstance: !!o.newInstance,
  };
}

/** Per-session state dir (0700). */
export function sessionDir(configDir: string, session: string): string {
  const d = path.join(configDir, session.replace(/[^A-Za-z0-9_.-]/g, '_'));
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/**
 * Settings that are NEVER written to or read from the global `config.json`: `allowMutations` is a per-run safety
 * decision (§4.8), so persisting it would leak one run's (or one session's) permission into the next — e.g. into the
 * default session.
 */
export const UNPERSISTED_SETTINGS: readonly string[] = Object.freeze(['allowMutations']);

/** Persisted settings (`config.json` → `settings`), merged over defaults; unknown/mistyped/unpersisted keys dropped. */
export function loadSettings<S extends object>(configDir: string, defaults: Readonly<S>): S {
  const out: S = { ...defaults };
  try {
    const j: unknown = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    const saved = isRecord(j) ? j.settings : undefined;
    for (const [k, v] of Object.entries(isRecord(saved) ? saved : {})) {
      // `typeof v` equals the default's typeof, so the value has the right type for the key
      if (k in defaults && typeof v === typeof defaults[k as keyof S] && !UNPERSISTED_SETTINGS.includes(k)) out[k as keyof S] = v as S[keyof S];
    }
  } catch {}
  return out;
}

/** Write settings into `config.json` (0600, atomic; other top-level keys kept). */
export function saveSettings(configDir: string, settings: object): void {
  const file = path.join(configDir, 'config.json');
  let j: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    j = isRecord(parsed) ? parsed : {};
  } catch {}
  j.settings = Object.fromEntries(Object.entries(settings).filter(([k]) => !UNPERSISTED_SETTINGS.includes(k)));
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

