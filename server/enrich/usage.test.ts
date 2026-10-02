import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TranscriptState, commitSubject } from './transcriptState.ts';
import { scanHead } from './transcripts.ts';

const day = (h: number, m = 0) => new Date(2026, 9, 2, h, m).getTime();
const msg = (at: number, id: string, usage: Record<string, number>, model = 'claude-opus-5-5') => ({
  type: 'assistant', timestamp: new Date(at).toISOString(),
  message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage },
});
const U = { input_tokens: 1000, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 100_000, output_tokens: 2000 };

test('usage: today sums each message id once (streamed repeats: the last block wins), priced per model', () => {
  const st = new TranscriptState();
  st.feed(msg(day(0) - 3_600_000, 'y1', U), 0); // yesterday 23:00: not today
  st.feed(msg(day(9), 'a', { ...U, output_tokens: 10 }), 0);
  st.feed(msg(day(9), 'a', U), 0); // the same message, later block: replaces
  st.feed(msg(day(10), 'b', U, 'claude-sonnet-5'), 0);
  const u = st.usage(day(12));
  assert.ok(u);
  assert.equal(u.day, '2026-10-02');
  assert.equal(u.tokens, 2 * 113_000);
  assert.equal(u.output, 4000);
  // opus 5.5 0.114 + sonnet 5: 1000×2 + 10000×2.5 + 100000×0.2 + 2000×10 = 67000 → 0.067
  assert.ok(Math.abs((u.cost ?? 0) - 0.181) < 1e-6, String(u.cost));
  assert.equal(u.partial, false);
  // the next day: nothing yet
  const next = st.usage(day(12) + 86_400_000);
  assert.equal(next?.tokens, 0);
  assert.equal(next?.cost, null);
  // and back: re-summed from the kept messages
  assert.equal(st.usage(day(13))?.tokens, 2 * 113_000);
  assert.deepEqual(st.facts(day(13)).usage, st.usage(day(13)));
});

test('usage: unknown model → tokens without a cost; no usage at all → null', () => {
  const st = new TranscriptState();
  assert.equal(st.usage(day(9)), null);
  st.feed(msg(day(9), 'x', U, 'my-local-model'), 0);
  assert.deepEqual(st.usage(day(10)), { day: '2026-10-02', tokens: 113_000, output: 2000, cost: null, partial: false });
});

test('usage: scanHead reads back to this morning from before the tail (usage lines only)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-usage-'));
  const file = path.join(dir, 's.jsonl');
  const head: string[] = [];
  // yesterday (stops the scan), then many lines this morning
  head.push(JSON.stringify(msg(day(0) - 60_000, 'old', U)));
  for (let i = 0; i < 400; i++) head.push(JSON.stringify(msg(day(6) + i * 1000, `m${i}`, { ...U, output_tokens: 1 })));
  head.push(JSON.stringify({ type: 'user', timestamp: new Date(day(7)).toISOString(), message: { role: 'user', content: 'hi "usage"' } }));
  const text = head.join('\n') + '\n';
  fs.writeFileSync(file, text);
  const st = new TranscriptState();
  const fh = await fs.promises.open(file, 'r');
  try {
    await scanHead(fh, Buffer.byteLength(text), st, day(0), { cancelled: false });
  } finally {
    await fh.close();
  }
  const u = st.usage(day(12));
  assert.equal(u?.output, 400);
  assert.equal(u?.partial, false);
  // a capped read-back marks the numbers partial
  const st2 = new TranscriptState();
  const fh2 = await fs.promises.open(file, 'r');
  try {
    await scanHead(fh2, Buffer.byteLength(text), st2, day(0), { cancelled: false }, 4096, 4096);
  } finally {
    await fh2.close();
  }
  assert.equal(st2.usage(day(12))?.partial, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('commitSubject: git output line first, then -m / heredoc', () => {
  assert.deepEqual(commitSubject('git commit -m "x"', '[main 1a2b3c4] Fix the reconnect backoff\n 2 files changed'), { msg: 'Fix the reconnect backoff', sha: '1a2b3c4', branch: 'main' });
  assert.deepEqual(commitSubject('git commit -m x', '[feat/a (root-commit) abcdef0] Initial'), { msg: 'Initial', sha: 'abcdef0', branch: 'feat/a' });
  assert.deepEqual(commitSubject('git add -A && git commit -m "Add \\"quotes\\" support"'), { msg: 'Add "quotes" support' });
  assert.deepEqual(commitSubject("git commit -m 'single quoted'"), { msg: 'single quoted' });
  assert.deepEqual(commitSubject(`git commit -m "$(cat <<'EOF'\nStamp book rewards\n\nLonger body.\nEOF\n)"`), { msg: 'Stamp book rewards' });
  assert.equal(commitSubject('git commit --amend --no-edit'), null);
});

test('state: a commit event carries its subject', () => {
  const st = new TranscriptState();
  const t = new Date(day(9)).toISOString();
  st.feed({ type: 'assistant', timestamp: t, message: { id: 'a', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'git commit -m "Ship it"' } }] } }, 0);
  const ev = st.feed({ type: 'user', timestamp: t, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '[main 0badc0d] Ship it\n 1 file changed' }] } }, 0);
  assert.deepEqual(ev, [{ kind: 'commit', detail: { push: false, msg: 'Ship it', sha: '0badc0d', branch: 'main' } }]);
});
