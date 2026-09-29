import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HerdrSource, Enricher, assertEnricher, checkPatch, TerminalBackend, TerminalHandle, closedReasonToState,
} from './interfaces.ts';
import { FIELD_OWNERS } from '../shared/protocol.ts';
import type { OwnerName } from '../shared/protocol.ts';

test('HerdrSource base', async () => {
  const s = new HerdrSource();
  assert.equal(s.connected, false);
  assert.equal(s.snapshot(), null);
  await assert.rejects(s.request('ping'), { code: 'not_implemented' });
  let got;
  s.on('status', (...a) => (got = a));
  s.emit('status', 'w1:p1', 'working', 3);
  assert.deepEqual(got, ['w1:p1', 'working', 3]);
});

test('Enricher defaults to FIELD_OWNERS and passes assertEnricher', () => {
  for (const name of Object.keys(FIELD_OWNERS) as OwnerName[]) {
    if (name === 'base') continue;
    const e = new Enricher(name);
    assert.doesNotThrow(() => assertEnricher(e), name);
    assert.throws(() => e.onPatch('x', {}), /before wire-up/);
  }
  const bad = new Enricher('acks');
  bad.owns.push('status');
  assert.throws(() => assertEnricher(bad), /owns/);
  const badEv = new Enricher('acks');
  badEv.events.push('commit');
  assert.throws(() => assertEnricher(badEv), /may not emit/);
  // @ts-expect-error deliberately not an owner name
  assert.throws(() => assertEnricher(new Enricher('nope')));
});

test('checkPatch drops (prod) or throws (dev) on foreign fields', () => {
  const e = new Enricher('blocked');
  assert.deepEqual(checkPatch(e, { prompt: null, status: 'idle' }), { prompt: null });
  assert.throws(() => checkPatch(e, { status: 'idle' }, { dev: true }));
});

test('TerminalHandle plumbing', () => {
  const h = new TerminalHandle();
  const frames: [number, boolean][] = [];
  let closed = 0;
  h.onFrame((b, full) => frames.push([b.length, full]));
  h.onClosed(() => closed++);
  h._frame(new Uint8Array(3), true);
  h._closed({ code: 0, reason: 'detached' });
  h._closed({ code: 0, reason: 'again' });
  h._frame(new Uint8Array(1));
  let late;
  h.onClosed((i) => (late = i.reason));
  assert.deepEqual(frames, [[3, true]]);
  assert.equal(closed, 1);
  assert.equal(late, 'detached');
  assert.throws(() => new TerminalBackend().open('x', { mode: 'observe', cols: 80, rows: 24 }));
});

test('closedReasonToState', () => {
  assert.equal(closedReasonToState('pane already has an attached client'), 'busy');
  assert.equal(closedReasonToState('control was taken over'), 'taken');
  assert.equal(closedReasonToState('pane not found'), 'gone');
  assert.equal(closedReasonToState('client detached'), 'released');
  assert.equal(closedReasonToState('boom'), 'error');
});
