import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputPipe, chunkUtf8 } from './input.ts';

test('input pipe: credit window, paste chunking order, hold/outbox', async () => {
  const log: [string, string][] = [];
  const replies: ((r: { ok: boolean }) => void)[] = [];
  const pipe = createInputPipe({
    id: 'p1', window: 10, interactiveMax: 4, chunk: 5,
    sendBinary: (b) => { log.push(['bin', new TextDecoder().decode(b)]); return true; },
    call: (m) => {
      const { promise, resolve } = Promise.withResolvers<{ ok: boolean }>();
      log.push(['paste', m.text]);
      replies.push(resolve);
      return promise;
    },
  });
  pipe.write('abc');
  pipe.write('defg');
  assert.deepEqual(log.map((x) => x[1]), ['abc', 'defg']);
  pipe.write('xyz'); // 7 in flight + 3 = 10: sent
  pipe.write('Q'); // over the credit window: queued
  assert.equal(pipe.queued, 1);
  pipe.ack(10);
  assert.equal(pipe.queued, 0);
  log.length = 0;
  pipe.write('0123456789A', { paste: true });
  pipe.write('k'); // queued behind the paste
  assert.deepEqual(log, [['paste', '01234']]);
  for (let i = 0; i < 3; i++) { replies.shift()?.({ ok: true }); await 0; await 0; }
  assert.deepEqual(log.map((x) => x[1]), ['01234', '56789', 'A', 'k']);
  pipe.hold();
  assert.equal(pipe.write('zz'), 'held');
  assert.equal(pipe.held, 2);
  pipe.discard();
  assert.equal(pipe.held, 0);
  pipe.write('ok');
  pipe.release();
  assert.equal(log.at(-1)?.[1], 'ok');
  assert.deepEqual(chunkUtf8('ééé', 4), ['éé', 'é']);
  assert.deepEqual(chunkUtf8('a😀b', 4), ['a', '😀', 'b']);
});
