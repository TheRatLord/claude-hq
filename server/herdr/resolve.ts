/**
 * The ONE session → socket resolver (DESIGN §4.1). Every herdr socket path in the backend comes from `socketFor`;
 * every herdr child gets the same `--session <name>`. Owner: BE.
 *
 * Default-socket guard (§2.2): `dev:hq`, `hqtest-up.sh`, and the mock-herdr tests refuse to
 * start when `realpath(socketFor(session)) === realpath(socketFor('default'))`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** herdr's config root (`HQ_HERDR_HOME` overrides it for tests; never set in production). */
export const herdrHome = () => process.env.HQ_HERDR_HOME || path.join(os.homedir(), '.config', 'herdr');

/** herdr binary: `HERDR_BIN_PATH` or `~/.local/bin/herdr`. */
export const herdrBin = () => process.env.HERDR_BIN_PATH || path.join(os.homedir(), '.local', 'bin', 'herdr');

/** Session names herdr accepts (and that are safe as a path segment). */
export const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** Absolute socket path of `session`; 'default' (or empty) → the default socket. */
export function socketFor(session?: string): string {
  if (!session || session === 'default') return path.join(herdrHome(), 'herdr.sock');
  if (!SESSION_RE.test(session) || session === '.' || session === '..') throw new Error(`bad herdr session name ${JSON.stringify(session)}`);
  return path.join(herdrHome(), 'sessions', session, 'herdr.sock');
}

const real = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    // socket missing: resolve the directory instead so symlinked session dirs still compare equal
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
};

/** True when `session` resolves (by realpath) to the default session's socket. */
export function isDefaultSocket(session: string): boolean {
  return real(socketFor(session)) === real(socketFor('default'));
}

/**
 * THE default-session test for a live run (§4.1, §4.8): the name 'default', a named session whose socket realpath is
 * the default socket (symlinked sessions/<name> dir), or a socket override that resolves to the default socket.
 * Computed once in app.ts wireLive and handed to HerdrClient, Actions and hello — nothing else decides by name.
 * `socketOverride` is opts.herdrSocket.
 */
export function isDefaultTarget(session?: string, socketOverride: string | null = null): boolean {
  if (!session || session === 'default' || isDefaultSocket(session)) return true;
  return !!socketOverride && real(socketOverride) === real(socketFor('default'));
}

/**
 * Throw unless `session` is a named session whose socket is not the default one (mutation-capable runs, tests).
 */
export function refuseDefault(session: string, why = 'this run', socketOverride: string | null = null): void {
  if (isDefaultTarget(session, socketOverride)) {
    throw Object.assign(new Error(`${why} refuses the default herdr session (socket ${socketFor(session)} is the default socket)`), { code: 'default_session' });
  }
}

/** Env for herdr children: HERDR_* scrubbed, reaper tags added (§4.1, §4.7.1): instance, session, config-dir tag. */
export function childEnv(
  { instanceId, session, stateTag }: { instanceId?: string | null; session?: string | null; stateTag?: string | null },
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const k of Object.keys(env)) if (k.startsWith('HERDR_') && k !== 'HERDR_BIN_PATH') delete env[k];
  delete env.HERDR_BIN_PATH;
  if (instanceId) env.CLAUDE_HQ_INSTANCE = instanceId;
  if (session) env.CLAUDE_HQ_SESSION = session;
  if (stateTag) env.CLAUDE_HQ_STATE = stateTag; // which config dir's instances own it (reaper scope)
  return env;
}
