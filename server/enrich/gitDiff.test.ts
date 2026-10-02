import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capPatch, diffFiles, GitDiffs, parseNameStatusZ, parseNumstatZ } from './gitDiff.ts';
import type { GitRunner } from './git.ts';

test('gitDiff: numstat / name-status parsers (-z, renames, binaries)', () => {
  const ns = parseNumstatZ('3\t1\tsrc/a.ts\0-\t-\timg.png\0' + '5\t0\t\0old/name.ts\0new/name.ts\0' + '0\t9\tgone.ts\0');
  assert.deepEqual(ns, [
    { path: 'src/a.ts', added: 3, removed: 1 },
    { path: 'img.png', added: null, removed: null },
    { path: 'new/name.ts', from: 'old/name.ts', added: 5, removed: 0 },
    { path: 'gone.ts', added: 0, removed: 9 },
  ]);
  const names = parseNameStatusZ('M\0src/a.ts\0A\0img.png\0R087\0old/name.ts\0new/name.ts\0D\0gone.ts\0');
  assert.deepEqual([...names], [['src/a.ts', { status: 'M' }], ['img.png', { status: 'A' }], ['new/name.ts', { status: 'R', from: 'old/name.ts' }], ['gone.ts', { status: 'D' }]]);
  const d = diffFiles(ns, names, [{ path: 'notes.md', added: 4 }, { path: 'src/a.ts', added: 1 }]);
  assert.equal(d.files[0].path, 'gone.ts', 'biggest change first');
  assert.deepEqual(d.files.find((f) => f.path === 'notes.md'), { path: 'notes.md', status: '?', added: 4, removed: 0 });
  assert.equal(d.files.filter((f) => f.path === 'src/a.ts').length, 1, 'a tracked file is not listed twice');
  assert.equal(d.added, 3 + 5 + 4);
  assert.equal(d.removed, 1 + 9);
  assert.equal(d.more, 0);
  const cut = capPatch('a\n'.repeat(100), 51);
  assert.ok(cut.truncated && cut.text.endsWith('\n') && cut.text.length <= 51);
});

test('gitDiff: read-only flags, the range is verified, a path must be in the list, one request at a time', async () => {
  const calls: string[][] = [];
  let busy = 0, maxBusy = 0;
  const run: GitRunner = async (args) => {
    busy++; maxBusy = Math.max(maxBusy, busy);
    calls.push(args);
    await new Promise((r) => setTimeout(r, 2));
    busy--;
    const sub = args[args.indexOf('-c', args.indexOf('-c') + 1) + 2];
    if (sub === 'rev-parse') return { ok: !args.includes('dead999^{commit}'), out: '' };
    if (args.includes('--numstat')) return { ok: true, out: '2\t1\tsrc/a.ts\0' };
    if (args.includes('--name-status')) return { ok: true, out: 'M\0src/a.ts\0' };
    if (sub === 'ls-files') return { ok: true, out: '' };
    return { ok: true, out: 'diff --git a/src/a.ts b/src/a.ts\n+x\n' };
  };
  const d = new GitDiffs({ run });
  const [a, b] = await Promise.all([d.diff('p', '/r', { from: 'abc1234' }), d.diff('p', '/r', { from: 'abc1234', to: 'def5678', path: 'src/a.ts' })]);
  assert.equal(maxBusy, 1, 'one git process at a time');
  assert.deepEqual(a.files, [{ path: 'src/a.ts', status: 'M', added: 2, removed: 1 }]);
  assert.equal(a.to, null);
  assert.equal(b.patch?.text.includes('+x'), true);
  for (const c of calls) {
    assert.deepEqual(c.slice(0, 4), ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off']);
    if (c.includes('diff')) for (const f of ['--no-ext-diff', '--no-textconv']) assert.ok(c.includes(f), `${c.join(' ')} has ${f}`);
  }
  assert.ok(calls.some((c) => c.includes(':(literal)src/a.ts')), 'paths are literal pathspecs');
  assert.ok(!calls.some((c) => c.includes('ls-files') && c.includes('def5678')), 'a commit range lists no untracked files');
  await assert.rejects(d.diff('p', '/r', { from: 'dead999' }), /unknown commit/);
  await assert.rejects(d.diff('p', '/r', { from: 'abc1234', path: '../../etc/passwd' }), /not in this diff/);
  await assert.rejects(d.diff('p', null, {}), /not a git repository/);
  for (const c of calls) assert.ok(!c.some((x) => /^(commit|add|reset|checkout|stash|update-index|gc|fetch|push|apply)$/.test(x)), `read-only: ${c.join(' ')}`);
});

test('gitDiff: the real git on a scratch repo (committed range, working tree, untracked, a symlink out of the tree)', async (t) => {
  try {
    execFileSync('git', ['--version']);
  } catch {
    t.skip('no git');
    return;
  }
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-gitdiff-')));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-secret-'));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'pipe' }).toString().trim();
  try {
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    fs.writeFileSync(path.join(dir, 'old.txt'), 'x\n'.repeat(20));
    g('add', '.');
    g('commit', '-q', '-m', 'first');
    const h0 = g('rev-parse', '--short', 'HEAD');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n2\nthree\nfour\n');
    g('mv', 'old.txt', 'renamed.txt');
    g('commit', '-q', '-am', 'second');
    const h1 = g('rev-parse', '--short', 'HEAD');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'new.ts'), 'export const a = 1;\nexport const b = 2;\n');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret\n');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
    const before = g('status', '--porcelain');
    const d = new GitDiffs();
    const committed = await d.diff('p', dir, { from: h0, to: h1 });
    assert.deepEqual(committed.files.map((f) => [f.path, f.status, f.added, f.removed, f.from]).sort(), [
      ['a.txt', 'M', 2, 1, undefined], ['renamed.txt', 'R', 0, 0, 'old.txt'],
    ].sort());
    const live = await d.diff('p', dir, { from: h0 });
    const byPath = new Map(live.files.map((f) => [f.path, f]));
    assert.equal(byPath.get('src/new.ts')?.status, '?');
    assert.equal(byPath.get('src/new.ts')?.added, 2, 'untracked lines are counted');
    assert.equal(byPath.get('link.txt')?.added, null, 'a symlink is never read');
    const p = await d.diff('p', dir, { from: h0, path: 'a.txt' });
    assert.match(p.patch!.text, /^\+four$/m);
    const pn = await d.diff('p', dir, { from: h0, path: 'src/new.ts' });
    assert.match(pn.patch!.text, /^\+export const b = 2;$/m);
    const pl = await d.diff('p', dir, { from: h0, path: 'link.txt' });
    assert.ok(!pl.patch!.text.includes('top secret'), 'nothing outside the work tree leaks');
    assert.equal(g('status', '--porcelain'), before, 'the repo is untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
