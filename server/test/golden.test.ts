// Golden replay: the scrubbed 10-minute hqtest recording replayed at --speed 20 under
// FakeClock must reproduce the committed WorldModel output stream (entity/gone/event, volatile fields removed).
// A deliberate behaviour change: `node server/test/golden.ts --regen`, with the reason in the commit. Owner: BE2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIXTURE, GOLDEN, goldenStream, makeScrubber } from './golden.ts';
import { parseRecording } from '../record.ts';
import { isRecord } from '../../shared/guards.ts';

test('golden: hqtest-10min.ndjson at speed 20 reproduces the committed WorldModel stream', async () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const { header, items } = parseRecording(text);
  assert.equal(header.session, 'hqtest');
  assert.ok(items.at(-1)!.at - items[0]!.at > 9 * 60_000, 'a ten-minute recording');
  const got = await goldenStream(text);
  const want = fs.readFileSync(GOLDEN, 'utf8').trim().split('\n');
  const kinds = new Set(got.map((l) => {
    const o: unknown = JSON.parse(l);
    return isRecord(o) && isRecord(o.m) ? o.m.t : undefined;
  }));
  assert.ok(kinds.has('entity') && kinds.has('event'), 'the stream carries entities and events');
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] !== want[i]) assert.fail(`golden stream differs at message ${i}:\n  got  ${got[i]?.slice(0, 400)}\n  want ${want[i]?.slice(0, 400)}`);
  }
});

test('golden: the committed fixture is scrubbed (no home paths, no raw titles/prompts)', () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  assert.doesNotMatch(text, /\/home\/|\/Users\/|\/root\//, 'paths are /p/<n>');
  for (const it of parseRecording(text).items) {
    for (const p of ('raw' in it ? it.raw?.panes : undefined) ?? []) {
      if (p.terminal_title_stripped) assert.match(p.terminal_title_stripped, /^h[0-9a-f]{8}$/);
      assert.match(p.cwd ?? '', /^\/p\/\d+$/);
    }
    if (it.k === 'patch' && it.owner === 'transcripts') for (const v of [it.patch.title, it.patch.lastPrompt]) if (v) assert.match(v, /^h[0-9a-f]{8}$/);
    if (it.k === 'patch' && it.owner === 'blocked' && it.patch.prompt) assert.match(it.patch.prompt.question, /^h[0-9a-f]{8}$/);
  }
  const s = makeScrubber();
  assert.deepEqual(s.walk({ cwd: '/home/x/src/a', title: 'secret task', workspaces: [{ label: 'hq-core' }], argv: 'cat /home/x/.env' }),
    { cwd: '/p/1', title: s.walk({ title: 'secret task' }).title, workspaces: [{ label: 'hq-core' }], argv: s.walk({ argv: 'cat /home/x/.env' }).argv });
});
