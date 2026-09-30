// world/* pure-ish units: blocked parse + answer keys, naming, slots, since.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePrompt, answerKeys } from './blocked.ts';
import { baseName, dedupeNames, projectOf, seedKeyOf } from './naming.ts';
import { Slots, SLOT_FREE_MS } from './slots.ts';
import { SinceStore } from './since.ts';
import { FakeClock } from '../clock.ts';
import { TRUST_PROMPT } from '../test/mockHerdr.ts';
import { promptHash } from '../../shared/identity.ts';

/** parsePrompt for input that must contain a prompt. */
function parse(text: string, stateSeq: number): NonNullable<ReturnType<typeof parsePrompt>> {
  const p = parsePrompt(text, stateSeq);
  assert.ok(p, 'a prompt was parsed');
  return p;
}

test('parsePrompt: Claude folder-trust (bulleted), numbered edit prompt, cursor moved, no prompt', () => {
  const t = parse(TRUST_PROMPT, 2);
  assert.equal(t.question, 'Quick safety check: Is this a project you created or one you trust?');
  assert.deepEqual(t.options, [{ key: '1', label: 'No, exit', index: 0 }, { key: '2', label: 'Yes, I trust this folder', index: 1 }]);
  assert.deepEqual([t.selected, t.numbered], [0, false]);
  assert.equal(t.hash, promptHash(2, t.question, ['No, exit', 'Yes, I trust this folder']));
  assert.deepEqual(answerKeys(t, '2'), ['Down', 'Enter']);
  assert.deepEqual(answerKeys(t, '1'), ['Enter']);
  assert.equal(answerKeys(t, '3'), null);
  const moved = parse(TRUST_PROMPT.replace(' ❯ No, exit', '   No, exit').replace('   Yes, I trust', ' ❯ Yes, I trust'), 2);
  assert.equal(moved.selected, 1);
  assert.equal(moved.hash, t.hash, 'the cursor is not part of the hash');
  assert.deepEqual(answerKeys(moved, '1'), ['Up', 'Enter']);
  const edit = parse('● Update(config.toml)\n\nDo you want to make this edit to config.toml?\n❯ 1. Yes\n  2. Yes, allow all edits during this session (shift+tab)\n  3. No, and tell Claude what to do differently (esc)\n', 7);
  assert.equal(edit.question, 'Do you want to make this edit to config.toml?');
  assert.equal(edit.numbered, true);
  assert.deepEqual(edit.options.map((o) => o.key), ['1', '2', '3']);
  assert.deepEqual(answerKeys(edit, '3'), ['3']);
  assert.notEqual(parse(TRUST_PROMPT, 3).hash, t.hash, 'stateSeq is part of the hash');
  assert.equal(parsePrompt('$ ls\nfoo bar\n', 1), null);
  assert.equal(parsePrompt('', 1), null);
});

test('naming: agent name → non-numeric tab label → basename(cwd); per-workspace ·2 in stable order', () => {
  assert.equal(baseName({ agentName: 'scout', tabLabel: 'claude', cwd: '/x/y' }), 'scout');
  assert.equal(baseName({ tabLabel: 'dev', cwd: '/x/y' }), 'dev');
  assert.equal(baseName({ tabLabel: '3', cwd: '/x/proj/' }), 'proj');
  assert.equal(projectOf({ repoName: null, foregroundCwd: '/a/b', cwd: '/c' }), 'b');
  assert.equal(projectOf({ repoName: 'repo', cwd: '/c' }), 'repo');
  assert.equal(seedKeyOf(null, 'w1:p3'), 'w1:p3');
  const m = dedupeNames([
    { id: 'b', ws: 'w1', name: 'dev', order: [1, 1, 1] }, { id: 'a', ws: 'w1', name: 'dev', order: [1, 1, 0] },
    { id: 'c', ws: 'w2', name: 'dev', order: [2, 0, 0] },
  ]);
  assert.deepEqual([m.get('a'), m.get('b'), m.get('c')], ['dev', 'dev·2', 'dev']);
});

test('slots: stable per label+number, persisted, freed 5 min after the workspace is gone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-slots-'));
  const clock = new FakeClock();
  const s = new Slots({ dir, clock });
  const w = (id: string, n: number, label: string) => ({ workspace_id: id, number: n, label });
  let m = s.assign([w('w1', 1, 'a'), w('w2', 2, 'b'), w('w3', 3, 'c')]);
  assert.deepEqual([...m.values()], [0, 1, 2]);
  m = s.assign([w('w1', 1, 'a'), w('w3', 3, 'c')]);
  assert.deepEqual([m.get('w1'), m.get('w3')], [0, 2], 'no reshuffle when b closes');
  s.close();
  const s2 = new Slots({ dir, clock });
  m = s2.assign([w('w9', 1, 'a'), w('w3', 3, 'c'), w('w7', 4, 'new')]);
  assert.deepEqual([m.get('w9'), m.get('w3'), m.get('w7')], [0, 2, 3], 'b keeps its slot for 5 min');
  clock.advance(SLOT_FREE_MS + 1);
  m = s2.assign([w('w9', 1, 'a'), w('w3', 3, 'c'), w('w7', 4, 'new'), w('w8', 5, 'late')]);
  assert.equal(m.get('w8'), 1, 'b freed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('since: first sighting approx + one hint; transitions exact; shells by activity; rekey keeps the record', () => {
  const clock = new FakeClock(1_000_000);
  const s = new SinceStore({ dir: null, clock });
  assert.deepEqual(s.observe('k', { status: 'idle', stateSeq: 3 }), { since: 1_000_000, approx: true });
  clock.advance(500);
  assert.equal(s.hint('k', 900_000), 900_000);
  assert.equal(s.hint('k', 800_000), null, 'only one hint');
  assert.deepEqual(s.observe('k', { status: 'idle', stateSeq: 3 }), { since: 900_000, approx: true });
  clock.advance(500);
  assert.deepEqual(s.observe('k', { status: 'working', stateSeq: 4 }), { since: 1_001_000, approx: false });
  s.observe('sh', { status: 'unknown', stateSeq: null });
  assert.equal(s.activity('sh', 'prompt'), false, 'first activity is not a change');
  clock.advance(100);
  assert.equal(s.activity('sh', 'serve'), true);
  assert.deepEqual(s.observe('sh', { status: 'unknown', stateSeq: null }), { since: 1_001_100, approx: false });
  s.observe('new', { status: 'idle', stateSeq: 1 });
  s.rekey('k', 'new');
  assert.equal(s.get('new')?.since, 1_001_000);
});
