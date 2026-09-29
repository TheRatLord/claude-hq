// dev.ts CLI parsing (CORE m2 fix r3): `--demo` without a count defaults to 12 (mirrors server/main.ts `--demo [N]`),
// and bad numbers fail with a usage error instead of reaching the backend as NaN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './dev.ts';

test('dev.ts parseArgs: --demo [N]', () => {
  assert.equal(parseArgs(['--demo']).demo, 12);
  assert.equal(parseArgs(['--demo', '--port', '7695']).demo, 12);
  assert.equal(parseArgs(['--demo', '--port', '7695']).port, 7695);
  assert.equal(parseArgs(['--demo', '5']).demo, 5);
  assert.equal(parseArgs([]).demo, undefined);
});

test('dev.ts parseArgs: bad numbers / unknown args / default session throw', () => {
  assert.throws(() => parseArgs(['--port', 'abc']), /--port needs a number/);
  assert.throws(() => parseArgs(['--vite-port']), /--vite-port needs a number/);
  assert.throws(() => parseArgs(['--bogus']), /unknown arg --bogus/);
  assert.throws(() => parseArgs(['--session', 'default']), /refusing --session default/);
});
