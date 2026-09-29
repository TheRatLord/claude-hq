#!/usr/bin/env node
/**
 * Default-session integrity (DESIGN §9.3, P8). Owner: BE. Strictly read-only against the default session
 * (`session.snapshot` only, through the same client allowlist the backend uses).
 *
 *   node scripts/integrity.ts hash                    print the normalised default-session hash
 *   node scripts/integrity.ts run -- <cmd …>          hash before, run <cmd> while watching /proc, hash after
 *   node scripts/integrity.ts procs                   only the /proc checks
 *
 * Normalisation: drop revision, scroll, focus, titles, timestamps, and the fields the user's own agents change on
 * their own (agent_status, state_change_seq, tokens, cwd drift) — what is left is the STRUCTURE HQ could mutate:
 * workspaces/tabs/panes/agents (ids, labels, numbers, kinds, terminal ids, names) and layouts (rects, splits).
 * `run` fails if the hash changes, if a `terminal session control` child for the default session appears during the
 * run, or if /proc holds a CLAUDE_HQ_INSTANCE-tagged herdr process whose instance has no live lock at the end.
 * Stale-child scope mirrors reaper.ts: only children tagged with the DEFAULT config dir (CLAUDE_HQ_STATE =
 * stateTag(defaultConfigDir()), or untagged) are judged against its locks. Children of other deployments (parallel
 * `--config-dir` instances) are judged by their parent: alive under a node/electron backend → fine; orphaned → a
 * warning, or a FAIL only when it is a `control` child on the default session.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HerdrClient } from '../server/herdr/client.ts';
import { RealClock } from '../server/clock.ts';
import { defaultConfigDir } from '../server/config.ts';
import { liveInstanceIds } from '../server/instance.ts';
import { scanTagged, stateTag } from '../server/reaper.ts';
import type { TaggedProcess } from '../server/reaper.ts';
import { errMessage, isRecord } from '../shared/guards.ts';

const DROP = new Set(['revision', 'scroll', 'focused', 'focused_workspace_id', 'focused_tab_id', 'focused_pane_id', 'focused_pane',
  'terminal_title', 'terminal_title_stripped', 'title', 'agent_status', 'state_change_seq', 'interactive_ready', 'launch_pending',
  'tokens', 'cwd', 'foreground_cwd', 'active_tab_id', 'screen_detection_skipped', 'state_labels', 'display_agent', 'at', 'updated_at']);
const idOf = (x: unknown): unknown => {
  const o = isRecord(x) ? x : undefined;
  return o?.pane_id ?? o?.tab_id ?? o?.workspace_id ?? o?.terminal_id ?? o?.id ?? JSON.stringify(x);
};

export function normalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalise).sort((a, b) => String(idOf(a)).localeCompare(String(idOf(b))));
  if (isRecord(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if (!DROP.has(k)) out[k] = normalise(v[k]);
    return out;
  }
  return v;
}

export async function defaultHash() {
  const client = new HerdrClient({ session: 'default', clock: RealClock() });
  const r = await client.request('session.snapshot', {});
  const snap = normalise(isRecord(r) ? (r.snapshot ?? r) : r);
  // the original `delete snap.version` threw a TypeError on a null/primitive reply; keep it an error, with a message
  if (!isRecord(snap)) throw new Error('session.snapshot returned no snapshot object');
  delete snap.version;
  return { hash: crypto.createHash('sha256').update(JSON.stringify(snap)).digest('hex').slice(0, 16), snap };
}

/** Parent pid from /proc/<pid>/stat (field 4, after the parenthesised comm), or null. */
export function ppidOf(pid: number, procDir = '/proc') {
  try {
    const st = fs.readFileSync(path.join(procDir, String(pid), 'stat'), 'utf8');
    const n = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** True when `pid`'s parent is a live HQ backend process (node/electron), i.e. the child is not orphaned. */
export function ownerAlive(pid: number, procDir = '/proc') {
  const pp = ppidOf(pid, procDir);
  if (!pp || pp <= 1) return false;
  try {
    const argv0 = fs.readFileSync(path.join(procDir, String(pp), 'cmdline'), 'utf8').split('\0')[0] ?? '';
    return /(^|\/)(node|electron)[^/]*$/i.test(argv0);
  } catch {
    return false;
  }
}

export interface ProcIssueOpts {
  procs?: TaggedProcess[];
  configDir?: string;
  live?: Set<string>;
  owner?: (pid: number) => boolean;
}

export function procIssues({ procs = scanTagged(), configDir = defaultConfigDir(), live, owner = ownerAlive }: ProcIssueOpts = {}): { fails: string[]; warns: string[] } {
  const mine = stateTag(configDir);
  live ??= liveInstanceIds(configDir);
  const fails: string[] = [], warns: string[] = [];
  const line = (p: TaggedProcess) => `stale HQ child pid ${p.pid} (instance ${p.instance}, session ${p.session}): ${p.argv.join(' ')}`;
  for (const p of procs) {
    if (p.state === null || p.state === mine) {
      if (!live.has(p.instance)) fails.push(line(p));
    } else if (!owner(p.pid)) {
      const bad = p.session === 'default' && p.argv.includes('control');
      (bad ? fails : warns).push(`${line(p)} [other deployment, state ${p.state}]`);
    }
  }
  return { fails, warns };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'hash') {
    const { hash } = await defaultHash();
    console.log(hash);
    return 0;
  }
  if (cmd === 'procs') {
    const { fails, warns } = procIssues();
    warns.forEach((l) => console.error(`integrity: warn ${l}`));
    fails.forEach((l) => console.error(`integrity: ${l}`));
    console.log(fails.length ? 'FAIL' : 'ok: no stale HQ children');
    return fails.length ? 1 : 0;
  }
  if (cmd !== 'run') {
    console.error('usage: integrity.ts hash | procs | run -- <cmd …>');
    return 2;
  }
  const argv = rest[0] === '--' ? rest.slice(1) : rest;
  const before = await defaultHash();
  console.log(`integrity: default session before ${before.hash}`);
  const controlSeen = new Map<number, string>();
  const watch = setInterval(() => {
    for (const p of scanTagged()) {
      if (p.session === 'default' && p.argv.includes('control')) controlSeen.set(p.pid, p.argv.join(' '));
    }
  }, 250);
  let code = 0;
  if (argv.length) {
    code = await new Promise<number>((resolve) => {
      const c = spawn(argv[0], argv.slice(1), { stdio: 'inherit' });
      c.on('exit', (x) => resolve(x ?? 1));
      c.on('error', () => resolve(127));
    });
  }
  clearInterval(watch);
  const after = await defaultHash();
  console.log(`integrity: default session after  ${after.hash}`);
  const fails: string[] = [];
  if (after.hash !== before.hash) fails.push(`default-session structure changed: ${JSON.stringify(diff(before.snap, after.snap)).slice(0, 2000)}`);
  for (const [pid, a] of controlSeen) fails.push(`control child on the DEFAULT session during the run: pid ${pid} ${a}`);
  const procs = procIssues();
  procs.warns.forEach((w) => console.error(`integrity: warn ${w}`));
  fails.push(...procs.fails);
  fails.forEach((f) => console.error(`integrity: FAIL ${f}`));
  if (!fails.length) console.log('integrity: ok (hash unchanged, no default-session control child, no stale HQ children)');
  return fails.length ? 1 : code;
}

interface DiffEntry { path: string; before: unknown; after: unknown }

/** Any non-null object, arrays included (unlike isRecord): diff walks arrays by index. */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function diff(a: unknown, b: unknown, p = ''): DiffEntry[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (!isObject(a) || !isObject(b)) return [{ path: p, before: a, after: b }];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diff(a[k], b[k], `${p}/${k}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => process.exit(c), (e) => {
    console.error(`integrity: ${errMessage(e)}`);
    process.exit(2);
  });
}
