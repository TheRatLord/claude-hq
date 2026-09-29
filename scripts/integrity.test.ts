// integrity.ts stale-child scoping (fix r3): only default-config children are judged by the default config's locks;
// other deployments' children (parallel --config-dir instances) by whether their backend parent is alive. Owner: BE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { procIssues, ppidOf, ownerAlive } from './integrity.ts';
import { stateTag } from '../server/reaper.ts';
import type { TaggedProcess } from '../server/reaper.ts';

const CFG = '/tmp/hq-default-cfg';
const child = (pid: number, instance: string, state: string | null, session = 'hqtest', mode = 'observe'): TaggedProcess =>
  ({ pid, instance, session, state, argv: ['herdr', 'terminal', 'session', mode] });

test('procIssues: foreign-deployment child with a live parent is not a FAIL; own dead-instance child is', () => {
  const mine = stateTag(CFG);
  const procs = [
    child(11, 'live-default', mine),              // ours, live lock → ok
    child(12, 'dead-default', mine),              // ours, no lock → FAIL
    child(13, 'untagged-dead', null),             // pre-STATE tag → judged as ours → FAIL
    child(14, 'other-live', 'aaaabbbbcccc'),      // other --config-dir, backend alive → ok (the reviewer's false FAIL)
    child(15, 'other-orphan', 'aaaabbbbcccc'),    // other deployment, orphaned → warn
    child(16, 'other-orphan', 'aaaabbbbcccc', 'default', 'control'), // orphaned control child on DEFAULT → FAIL
  ];
  const { fails, warns } = procIssues({ procs, configDir: CFG, live: new Set(['live-default']), owner: (pid) => pid === 14 });
  assert.deepEqual(fails.map((f) => f.match(/pid (\d+)/)?.[1]), ['12', '13', '16']);
  assert.deepEqual(warns.map((f) => f.match(/pid (\d+)/)?.[1]), ['15']);
});

test('ppidOf / ownerAlive read /proc stat + the parent cmdline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-proc-'));
  const mk = (pid: number, stat: string, cmd: string[]) => {
    fs.mkdirSync(path.join(dir, String(pid)));
    fs.writeFileSync(path.join(dir, String(pid), 'stat'), stat);
    fs.writeFileSync(path.join(dir, String(pid), 'cmdline'), cmd.join('\0'));
  };
  mk(100, '100 (node) S 1 100 100', ['/usr/bin/node', 'server/main.ts']);
  mk(200, '200 (herdr (x) y) S 100 200 200', ['herdr', 'terminal']);
  mk(300, '300 (herdr) S 1 300 300', ['herdr', 'terminal']);
  mk(400, '400 (herdr) S 500 400 400', ['herdr']);
  mk(500, '500 (systemd) S 1 500 500', ['/usr/lib/systemd/systemd', '--user']);
  assert.equal(ppidOf(200, dir), 100);
  assert.equal(ownerAlive(200, dir), true);
  assert.equal(ownerAlive(300, dir), false, 'reparented to init');
  assert.equal(ownerAlive(400, dir), false, 'reparented to a systemd --user subreaper');
  assert.equal(ownerAlive(999, dir), false, 'gone');
  fs.rmSync(dir, { recursive: true, force: true });
});
