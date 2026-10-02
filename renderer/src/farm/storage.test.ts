import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localJson, readJson, readLocal, writeJson, writeLocal } from './storage.ts';

function fakeStorage(opts: { blocked?: boolean; full?: boolean } = {}): Map<string, string> {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => { if (opts.blocked) throw new Error('SecurityError'); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (opts.blocked || opts.full) throw new Error('QuotaExceededError'); m.set(k, v); },
  };
  return m;
}

test('JSON round-trips; missing and corrupt keys read as null', () => {
  const m = fakeStorage();
  assert.equal(readJson('a'), null);
  writeJson('a', { n: 1 });
  assert.deepEqual(readJson('a'), { n: 1 });
  m.set('bad', '{nope');
  assert.equal(readJson('bad'), null);
  writeLocal('s', 'open');
  assert.equal(readLocal('s'), 'open');
});

test('blocked storage: reads are empty, HUD writes are dropped quietly', () => {
  fakeStorage({ blocked: true });
  assert.equal(readLocal('a'), null);
  assert.equal(readJson('a'), null);
  assert.doesNotThrow(() => writeJson('a', 1));
  assert.doesNotThrow(() => writeLocal('a', 'x'));
});

test('localJson: a model store port; save failures surface for the model to log', () => {
  const m = fakeStorage();
  const st = localJson('claude-valley.x.v1');
  assert.equal(st.load(), null);
  st.save({ v: 1 });
  assert.equal(m.get('claude-valley.x.v1'), '{"v":1}');
  assert.deepEqual(st.load(), { v: 1 });
  fakeStorage({ full: true });
  assert.throws(() => st.save({ v: 2 }));
});
