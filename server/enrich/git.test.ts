import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitEnricher, runGit } from './git.ts';
import type { GitRunner } from './git.ts';
import { gitInfo, parseLastCommit, parseStatusV2 } from './gitState.ts';
import { FakeClock } from '../clock.ts';
import { assertEnricher } from '../interfaces.ts';
import type { Entity, GitInfo } from '../../shared/protocol.ts';

const STATUS = [
  '# branch.oid 4f1c2d3e5a6b7c8d9e0f11223344556677889900',
  '# branch.head feat/valley-signals',
  '# branch.upstream origin/feat/valley-signals',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa bbb renderer/src/farm/hud/cards.ts',
  '1 M. N... 100644 100644 100644 aaa bbb shared/protocol.ts',
  '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
  'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
  '? scratch/notes.txt',
  '? server/enrich/git.ts',
  '! dist/',
].join('\n');

test('gitState: porcelain v2 status, last commit, the wire shape', () => {
  const s = parseStatusV2(STATUS);
  assert.deepEqual(s, { branch: 'feat/valley-signals', head: '4f1c2d3', ahead: 2, behind: 1, dirty: 4, untracked: 2 });
  // detached, no upstream, fresh repo
  assert.deepEqual(parseStatusV2('# branch.oid (initial)\n# branch.head (detached)\n'), { branch: null, head: null, ahead: null, behind: null, dirty: 0, untracked: 0 });
  assert.deepEqual(parseLastCommit('4f1c2d3\x1f1759400000\x1fShip   the valley\n'), { sha: '4f1c2d3', at: 1_759_400_000_000, subject: 'Ship the valley' });
  assert.equal(parseLastCommit(''), null);
  assert.equal(parseLastCommit('nope'), null);
  assert.equal(parseLastCommit(`abcdef1\x1f1\x1f${'x'.repeat(200)}`)?.subject.length, 120);
  assert.deepEqual(gitInfo('/r', s, { at: 5, subject: 'S' }), {
    root: '/r', branch: 'feat/valley-signals', head: '4f1c2d3', dirty: 6, untracked: 2, ahead: 2, behind: 1, lastCommit: { subject: 'S', at: 5 },
  });
});

/** Settle the enricher's promise chains under the fake clock. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await null;
}

test('git enricher: one status per root per sweep, panes grouped by root, non-repos null, slow roots drop untracked', async () => {
  const clock = new FakeClock();
  const calls: string[] = [];
  let slow = false;
  const run: GitRunner = async (args, cwd) => {
    calls.push(`${cwd}:${args[0]}${args.includes('-uno') ? ' -uno' : ''}`);
    if (args[0] === 'rev-parse') return cwd.startsWith('/repo') ? { ok: true, out: '/repo\n' } : { ok: false, out: '' };
    if (args[0] === 'status') return slow && !args.includes('-uno') ? { ok: false, out: '', timedOut: true } : { ok: true, out: STATUS };
    return { ok: true, out: 'abc1234\x1f1759400000\x1fLast one\n' };
  };
  const e = new GitEnricher({ clock, run, pollMs: 10_000, firstMs: 500 });
  assertEnricher(e);
  const patches: { id: string; git: GitInfo | null | undefined }[] = [];
  e.onPatch = (id, p: Partial<Entity>) => void patches.push({ id, git: p.git });
  e.attach('a', { kind: 'claude', cwd: '/repo' });
  e.attach('b', { kind: 'shell', cwd: '/repo/server' });
  e.attach('c', { kind: 'claude', cwd: '/tmp/elsewhere' });
  clock.advance(500);
  await flush();
  assert.equal(calls.filter((c) => c.endsWith(':status')).length, 1, calls.join(' '));
  const a = patches.find((p) => p.id === 'a')?.git;
  assert.equal(a?.branch, 'feat/valley-signals');
  assert.equal(a?.dirty, 6);
  assert.equal(a?.lastCommit?.subject, 'Last one');
  assert.deepEqual(patches.find((p) => p.id === 'b')?.git, a);
  assert.equal(patches.find((p) => p.id === 'c')?.git, null);
  // unchanged → no new patches; roots are cached (no rev-parse within 5 min)
  const n = patches.length;
  calls.length = 0;
  clock.advance(10_000);
  await flush();
  assert.equal(patches.length, n);
  assert.equal(calls.filter((c) => c.includes('rev-parse')).length, 0);
  // a timed-out status switches the root to -uno
  slow = true;
  clock.advance(10_000);
  await flush();
  calls.length = 0;
  clock.advance(10_000);
  await flush();
  assert.ok(calls.includes('/repo:status -uno'), calls.join(' '));
  // a pane moving out of the repo gets null; close stops sweeping
  e.update('a', { kind: 'claude', cwd: '/' });
  clock.advance(10_000);
  await flush();
  assert.equal(patches.filter((p) => p.id === 'a').at(-1)?.git, null);
  await e.close();
  calls.length = 0;
  clock.advance(30_000);
  await flush();
  assert.equal(calls.length, 0);
});

test('git enricher: the real git on a scratch repo', async (t) => {
  try {
    execFileSync('git', ['--version']);
  } catch {
    t.skip('no git');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-git-'));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', 'a.txt');
  g('commit', '-q', '-m', 'First commit');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'b\n');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'n\n');
  const clock = new FakeClock();
  const e = new GitEnricher({ clock, run: runGit });
  let got: GitInfo | null | undefined;
  e.onPatch = (_id, p: Partial<Entity>) => { got = p.git; };
  e.attach('p', { kind: 'shell', cwd: dir });
  await e.sweep();
  await e.close();
  const real = fs.realpathSync(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(got?.branch, 'main');
  assert.equal(got?.dirty, 2);
  assert.equal(got?.untracked, 1);
  assert.equal(got?.ahead, null);
  assert.equal(got?.lastCommit?.subject, 'First commit');
  assert.equal(got?.root, real);
});
