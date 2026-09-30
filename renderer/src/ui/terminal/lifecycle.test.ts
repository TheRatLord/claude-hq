import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifeView, peekKey } from './lifecycle.ts';

test('lifecycle: peek promotes only on printable/Enter; states map to input routes', () => {
  assert.equal(lifeView({ state: 'live', mode: 'observe' }).input, 'promote');
  assert.equal(lifeView({ state: 'live', mode: 'control', writer: true }).input, 'send');
  assert.equal(lifeView({ state: 'live', mode: 'control', writer: false }).actions[0].action, 'writer');
  assert.equal(lifeView({ state: 'gone' }).input, 'disabled');
  assert.equal(lifeView({ state: 'busy' }).actions[0].action, 'takeover');
  assert.equal(lifeView(null).spinner, true);
  const k = (key: string, o: { code?: string; ctrlKey?: boolean } = {}) => peekKey({ key, code: o.code ?? '', ctrlKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(k('a'), 'promote');
  assert.equal(k('Enter'), 'promote');
  assert.equal(k('Escape'), 'esc');
  for (const x of ['ArrowUp', 'Tab', 'Backspace', 'F5']) assert.equal(k(x), 'swallow', x);
  assert.equal(k('c', { ctrlKey: true, code: 'KeyC' }), 'ctrlc');
  assert.equal(k('r', { ctrlKey: true, code: 'KeyR' }), 'swallow');
});
