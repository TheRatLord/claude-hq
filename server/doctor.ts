#!/usr/bin/env node
/**
 * `npm run doctor [-- --session S] [--port P]`: the first thing to run when "it's broken over ssh".
 * Strictly read-only: resolves the session socket (path + realpath), pings it (protocol 22?), lists live HQ children
 * from /proc by instance tag (flags stale ones), checks the lock file, checks env gotchas (HERDR_* inherited,
 * CLAUDECODE → transcripts warning), prints the ssh -L command and URL.
 * Never spawns herdr, never writes to a socket beyond `ping`, never modifies anything. Owner: BE.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { socketFor, herdrBin, isDefaultSocket } from './herdr/resolve.ts';
import { HerdrClient, HERDR_PROTOCOL } from './herdr/client.ts';
import { RealClock } from './clock.ts';
import { defaultConfigDir, DEFAULT_PORT } from './config.ts';
import { findLive, liveInstanceIds, lockPath } from './instance.ts';
import { scanTagged } from './reaper.ts';
import type { TaggedProcess } from './reaper.ts';
import { isRecord, errCode, errMessage } from '../shared/guards.ts';

const tty = process.stdout.isTTY;
const OK = tty ? '\x1b[32m✓\x1b[0m' : '✓', WARN = tty ? '\x1b[33m!\x1b[0m' : '!', BAD = tty ? '\x1b[31m✗\x1b[0m' : '✗';

export interface DoctorArgs { session: string; port: number }

export function parseDoctorArgs(argv: string[]): DoctorArgs {
  const o: DoctorArgs = { session: process.env.CLAUDE_HQ_SESSION || 'default', port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--session') o.session = argv[++i];
    else if (argv[i] === '--port') o.port = Number(argv[++i]);
  }
  return o;
}

export async function doctor({ session, port }: DoctorArgs, env: NodeJS.ProcessEnv = process.env): Promise<{ lines: string[]; problems: number }> {
  const lines: string[] = [];
  let problems = 0;
  const say = (mark: string, text: string) => lines.push(`${mark} ${text}`);
  const bad = (t: string) => {
    problems++;
    say(BAD, t);
  };

  // --- resolver
  lines.push(`Claude HQ doctor — session "${session}"`);
  let sock: string;
  try {
    sock = socketFor(session);
  } catch (e) {
    bad(errMessage(e));
    return { lines, problems };
  }
  let real = sock;
  try {
    real = fs.realpathSync(sock);
  } catch {}
  say(fs.existsSync(sock) ? OK : BAD, `socket ${sock}${real !== sock ? ` → ${real}` : ''}${fs.existsSync(sock) ? '' : ' (missing)'}`);
  if (!fs.existsSync(sock)) problems++;
  if (session !== 'default' && isDefaultSocket(session)) bad(`session "${session}" resolves to the DEFAULT socket: HQ treats it as the default session (spawn/close refused)`);
  const bin = herdrBin();
  say(fs.existsSync(bin) ? OK : BAD, `herdr binary ${bin}${fs.existsSync(bin) ? '' : ' (missing)'}`);
  if (!fs.existsSync(bin)) problems++;

  // --- ping (read-only)
  const isDef = session === 'default' || isDefaultSocket(session);
  let protoOk: boolean | null = null;
  if (fs.existsSync(sock)) {
    const client = new HerdrClient({ session, clock: RealClock() });
    try {
      const pong: unknown = await client.ping();
      const r = isRecord(pong) ? pong : {}; // {protocol, version}
      protoOk = r.protocol === HERDR_PROTOCOL;
      if (r.protocol === HERDR_PROTOCOL) say(OK, `ping: herdr ${r.version}, protocol ${r.protocol}`);
      else say(WARN, `ping: herdr ${r.version}, protocol ${r.protocol} ≠ ${HERDR_PROTOCOL} → HQ runs READ-ONLY`);
      const snap = await client.request('session.snapshot', {});
      const s = isRecord(snap) && snap.snapshot !== undefined && snap.snapshot !== null ? snap.snapshot : snap;
      const rec: Record<string, unknown> = isRecord(s) ? s : {};
      const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
      const agents = list(rec.agents).map((a) => (isRecord(a) ? `${a.name ?? a.pane_id}:${a.agent_status}` : 'undefined:undefined')).join(' ');
      say(OK, `snapshot: ${list(rec.workspaces).length} workspaces, ${list(rec.panes).length} panes, agents: ${agents || '—'}`);
    } catch (e) {
      bad(`ping failed: ${errCode(e) ?? ''} ${errMessage(e)} (is the herdr server for "${session}" running?)`);
    }
  }

  // --- mode: what HQ may do here
  if (protoOk === false) say(WARN, 'mode: READ-ONLY (herdr protocol mismatch): view + observe terminals only');
  else if (isDef) say(OK, 'mode: DEFAULT session → read-only-safe: nothing opens until you click, prompts/answers go through a confirm, hire/close refused (use --session <name> for full actions)');
  else say(OK, `mode: named session "${session}" → full actions (hire with a first prompt, answer, prompt, close panes)`);

  // --- lock + live children
  const configDir = defaultConfigDir();
  const live = await findLive(configDir, session);
  if (live.live) say(OK, `backend running: pid ${live.lock.pid}, port ${live.lock.port} (${lockPath(configDir, session)})`);
  else if (live.stale) say(WARN, `stale lock ${lockPath(configDir, session)} (pid ${live.stale.pid}); the next start replaces it and reaps orphans`);
  else say(OK, `no backend running for "${session}"`);
  const liveIds = liveInstanceIds(configDir);
  const kids = scanTagged({ bin });
  const stale = kids.filter((k) => !liveIds.has(k.instance));
  const byMode = (list: TaggedProcess[]) => ['observe', 'control'].map((m) => `${list.filter((k) => k.argv.includes(m)).length} ${m}`).join(', ');
  say(OK, `HQ herdr children: ${kids.length} (${byMode(kids)})`);
  if (stale.length) {
    problems++;
    say(BAD, `${stale.length} STALE child(ren) of dead instances: ${stale.map((k) => `${k.pid}[${k.session}]`).join(' ')} — restart the backend (it reaps them)`);
  }
  const ctlDefault = kids.filter((k) => k.session === 'default' && k.argv.includes('control'));
  if (ctlDefault.length) say(WARN, `${ctlDefault.length} control child(ren) on the DEFAULT session right now (someone is typing into a drawer)`);

  // --- env gotchas
  const herdrEnv = Object.keys(env).filter((k) => k.startsWith('HERDR_') && k !== 'HERDR_BIN_PATH');
  if (herdrEnv.length) say(WARN, `inherited ${herdrEnv.join(' ')} (harmless: HQ scrubs them from every herdr child and passes --session)`);
  else say(OK, 'no HERDR_* socket variables inherited');
  if (env.CLAUDECODE || env.CLAUDE_CODE_CHILD_SESSION) {
    say(WARN, 'running inside Claude Code (CLAUDECODE set): a herdr server started from here may save no transcripts; start herdr outside that inherited agent environment');
  }

  // --- how to reach it
  let token = '<token>';
  try {
    token = fs.readFileSync(path.join(configDir, 'token'), 'utf8').trim();
  } catch {}
  const p = live.live ? live.lock.port : port;
  lines.push('');
  lines.push(`tunnel:  ssh -L ${p}:127.0.0.1:${p} ${os.hostname()}`);
  lines.push(`open:    http://127.0.0.1:${p}/?t=${token}`);
  if (!live.live) {
    const sess = session !== 'default' ? ` --session ${session}` : '';
    lines.push(`start:   npm start -- --port ${p}${sess}`);
  }
  return { lines, problems };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/server/doctor.ts')) {
  doctor(parseDoctorArgs(process.argv.slice(2))).then(({ lines, problems }) => {
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(problems ? 1 : 0);
  }, (e) => {
    process.stderr.write(`doctor: ${e.stack ?? e}\n`);
    process.exit(2);
  });
}
