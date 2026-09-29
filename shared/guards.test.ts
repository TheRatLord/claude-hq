import test from 'node:test';
import assert from 'node:assert/strict';
import { isRecord, errMessage, errCode } from './guards.ts';

test('isRecord: objects only', () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ a: 1 }), true);
  for (const v of [null, undefined, [], [1], 'x', 3, true, () => 1]) assert.equal(isRecord(v), false);
});

test('errMessage / errCode read thrown values defensively', () => {
  assert.equal(errMessage(new Error('boom')), 'boom');
  assert.equal(errMessage('plain'), 'plain');
  assert.equal(errMessage(null), 'null');
  assert.equal(errCode(Object.assign(new Error('x'), { code: 'ENOENT' })), 'ENOENT');
  assert.equal(errCode({ code: 5 }), undefined);
  assert.equal(errCode(new Error('no code')), undefined);
  assert.equal(errCode('ENOENT'), undefined);
});
