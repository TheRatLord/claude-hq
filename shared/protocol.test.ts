import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientMsgType, EventKind } from './protocol.ts';
import {
  SHARED_EVENTS, mayEmit, ACTION_CLASS, VALIDATE, EVENT_KINDS, FIELD_OWNERS, EVENT_OWNERS, ENTITY_FIELDS,
  LIVE_OWNERS, DEMO_OWNERS, FIELD_DEFAULTS, fieldOwnerMap, BIN, LIMITS,
  encodeFrame, decodeFrame, encodeTermData, encodeTermInput, validateBinaryInput, validateMessage, parseClientText,
} from './protocol.ts';

test('binary codec round-trips', () => {
  const bytes = new Uint8Array([0, 1, 2, 27, 91, 255]);
  const cases: [string, boolean][] = [['w1:p3', true], ['d1:p12', false], ['ü:π', true]];
  for (const [id, full] of cases) {
    const f = decodeFrame(encodeTermData(id, bytes, full));
    assert.ok(f);
    assert.equal(f.kind, BIN.TERM_DATA);
    assert.equal(f.id, id);
    assert.equal(f.flags & 1, full ? 1 : 0);
    assert.deepEqual([...f.payload], [...bytes]);
  }
  const f = decodeFrame(encodeTermInput('w1:p1', 'hello'));
  assert.ok(f);
  assert.equal(new TextDecoder().decode(f.payload), 'hello');
  assert.deepEqual(validateBinaryInput(f), { ok: true, paste: false });
  // the old binary paste flag is rejected (paste chunks are JSON term.input with a rid)
  assert.equal(validateBinaryInput(decodeFrame(encodeFrame(2, 'a', 1, 'x'))).ok, false, 'paste flag');
  // Node Buffer + ArrayBuffer + offset views
  const enc = encodeFrame(2, 'x', 0, new Uint8Array([9]));
  assert.equal(decodeFrame(Buffer.from(enc))?.id, 'x');
  const ab = new ArrayBuffer(enc.length);
  new Uint8Array(ab).set(enc);
  assert.equal(decodeFrame(ab)?.payload[0], 9);
  const padded = new Uint8Array(enc.length + 4);
  padded.set(enc, 4);
  assert.equal(decodeFrame(padded.subarray(4))?.payload[0], 9);
  // empty payload is fine to encode
  assert.equal(decodeFrame(encodeFrame(1, 'a', 0, new Uint8Array()))?.payload.length, 0);
});

test('binary codec rejects malformed frames', () => {
  assert.equal(decodeFrame(new Uint8Array([1, 5, 65])), null);
  assert.equal(decodeFrame(new Uint8Array([1])), null);
  assert.equal(decodeFrame(new Uint8Array([1, 1, 0xff, 0])), null, 'invalid utf8 id');
  // @ts-expect-error deliberately not a buffer
  assert.equal(decodeFrame('nope'), null);
  assert.throws(() => encodeFrame(1, 'x'.repeat(256), 0, new Uint8Array()));
  assert.equal(validateBinaryInput(decodeFrame(encodeTermData('a', 'x'))).ok, false, 'kind 1 from renderer');
  assert.equal(validateBinaryInput(decodeFrame(encodeTermInput('a', new Uint8Array()))).ok, false, 'empty');
  assert.equal(validateBinaryInput(decodeFrame(encodeTermInput('a', new Uint8Array(LIMITS.termInputMax + 1)))).ok, false);
  assert.equal(validateBinaryInput(decodeFrame(encodeFrame(2, 'a', 4, 'x'))).ok, false, 'unknown flag');
});

/** One accept + one reject case per row (the ws.test.ts contract mirrors these). */
const CASES: Record<ClientMsgType, [Record<string, unknown>, Record<string, unknown>]> = {
  'hello.ack': [{ protocol: 1 }, { protocol: '1' }],
  'term.open': [{ id: 'w1:p1', cols: 80, rows: 24, mode: 'observe' }, { id: 'w1:p1', cols: 80, rows: 24, mode: 'control' }],
  'term.promote': [{ id: 'w1:p1', cols: 80, rows: 24, takeover: true }, { id: 'w1:p1', cols: 9, rows: 24 }],
  'term.input': [{ id: 'w1:p1', text: 'ls\r' }, { id: 'w1:p1', text: 'x'.repeat(LIMITS.termInputMax + 1) }],
  'term.writer': [{ id: 'w1:p1' }, { id: '' }],
  'term.fit': [{ id: 'w1:p1', cols: 500, rows: 200 }, { id: 'w1:p1', cols: 501, rows: 24 }],
  'term.resize': [{ id: 'w1:p1', cols: 10, rows: 4 }, { id: 'w1:p1', cols: 80, rows: 3 }],
  'term.pause': [{ id: 'w1:p1' }, {}],
  'term.resume': [{ id: 'w1:p1' }, { id: 5 }],
  'term.history': [{ id: 'w1:p1', lines: 5000 }, { id: 'w1:p1', lines: 5001 }],
  'term.scroll': [{ id: 'w1:p1', dir: 'up', lines: 20 }, { id: 'w1:p1', dir: 'left' }],
  'term.copyRecent': [{ id: 'w1:p1', lines: 100 }, { id: 'w1:p1', lines: 0 }],
  'term.close': [{ id: 'w1:p1' }, { id: 'a b' }],
  'screen.watch': [{ ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }, { ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }],
  'done.ack': [{ id: 'w1:p1', stateSeq: 4 }, { id: 'w1:p1', stateSeq: -1 }],
  'herdr.focus': [{ id: 'w1:p1' }, { id: 'x'.repeat(65) }],
  'agent.prompt': [{ id: 'w1:p1', text: 'run the tests' }, { id: 'w1:p1', text: 'x'.repeat(8193) }],
  'agent.answer': [{ id: 'w1:p1', key: '1', promptHash: 'a1b2c3' }, { id: 'w1:p1', key: '12345', promptHash: 'a1' }],
  'agent.keys': [{ id: 'w1:p1', keys: ['Down', 'Enter'] }, { id: 'w1:p1', keys: Array(17).fill('a') }],
  'agent.explain': [{ id: 'w1:p1' }, { id: null }],
  spawn: [{ cwd: '/home/x', kind: 'claude', label: 'hq' }, { cwd: 'relative/path' }],
  'pane.close': [{ id: 'w1:p1' }, { id: 'w1:p1', force: true }],
  'settings.set': [{ patch: { fov: 70 } }, { patch: { evil: 1 } }],
  'world.get': [{}, { x: 1 }],
  'timeline.get': [{ since: 0 }, { since: 'yesterday' }],
  'git.diff': [{ id: 'w1:p1', from: 'abc1234', path: 'src/a.ts' }, { id: 'w1:p1', from: 'HEAD~1; rm -rf /' }],
  'note.set': [{ id: 'w1:p1', text: null }, { id: 'w1:p1', text: 'x'.repeat(281) }],
  'demo.force': [{ id: 'd1:p1', patch: { status: 'blocked' } }, { id: 'd1:p1', patch: [] }],
  'demo.scenario': [{ name: 'longIdle' }, { name: '../etc' }],
  'demo.event': [{ id: 'd1:p1', kind: 'commit' }, { id: 'd1:p1', kind: 'explode' }],
};

test('VALIDATE: one accept and one reject case per row', () => {
  assert.deepEqual(Object.keys(CASES).sort(), Object.keys(VALIDATE).sort());
  for (const [t, [good, badMsg]] of Object.entries(CASES) as [ClientMsgType, [Record<string, unknown>, Record<string, unknown>]][]) {
    const g = validateMessage({ t, rid: 1, ...good });
    assert.ok(g.ok, `${t} accept: ${g.ok ? '' : g.why}`);
    assert.equal(g.cls, ACTION_CLASS[t]);
    const b = validateMessage({ t, ...badMsg });
    assert.ok(!b.ok, `${t} reject`);
    assert.equal(b.error, 'bad_message');
  }
});

test('validateMessage: generic rejections', () => {
  assert.equal(validateMessage(null).ok, false);
  assert.equal(validateMessage([]).ok, false);
  assert.equal(validateMessage({ t: 'nope' }).ok, false);
  assert.equal(validateMessage({ t: 'toString' }).ok, false, 'prototype keys are not message types');
  assert.equal(validateMessage({ t: 'world.get', rid: { x: 1 } }).ok, false);
  assert.ok(validateMessage({ t: 'world.get', rid: 'abc' }).ok);
  assert.equal(validateMessage({ t: 'term.open', id: 'a', cols: 80.5, rows: 24 }).ok, false);
});

test('demo.scenario accepts only unsigned 32-bit seeds, with omission retaining compatibility', () => {
  for (const seed of [0, 1, 0xffff_ffff]) {
    assert.equal(validateMessage({ t: 'demo.scenario', name: 'mixed', seed }).ok, true);
  }
  assert.equal(validateMessage({ t: 'demo.scenario', name: 'mixed' }).ok, true);
  for (const seed of [-1, 0x1_0000_0000, Number.MAX_SAFE_INTEGER, 1.5, NaN, Infinity, '1', null]) {
    assert.equal(validateMessage({ t: 'demo.scenario', name: 'mixed', seed }).ok, false, String(seed));
  }
});

test('parseClientText: size cap closes, bad JSON rejects, rid echoed', () => {
  const big = parseClientText(JSON.stringify({ t: 'agent.prompt', id: 'a', text: 'x'.repeat(70_000) }));
  assert.ok(!big.ok);
  assert.equal(big.close, true);
  assert.equal(parseClientText('{nope').ok, false);
  const r = parseClientText(JSON.stringify({ t: 'term.close', rid: 7 }));
  assert.ok(!r.ok);
  assert.equal(r.rid, 7);
  const ok = parseClientText(JSON.stringify({ t: 'term.close', id: 'w1:p2', rid: 8 }));
  assert.ok(ok.ok);
  assert.equal('id' in ok.msg ? ok.msg.id : undefined, 'w1:p2');
});

test('FIELD_OWNERS: exactly one writer per field in live and in demo wiring', () => {
  for (const owners of [LIVE_OWNERS, DEMO_OWNERS]) {
    const m = fieldOwnerMap(owners);
    assert.deepEqual([...m.keys()].sort(), [...ENTITY_FIELDS].sort(), `${owners}`);
  }
  assert.throws(() => fieldOwnerMap(['transcripts', 'demo']));
  for (const k of Object.keys(FIELD_DEFAULTS)) assert.ok((ENTITY_FIELDS as readonly string[]).includes(k), k);
  assert.equal(new Set(ENTITY_FIELDS).size, ENTITY_FIELDS.length);
});

test('mayEmit: shared events (commit, news) split by pane kind', () => {
  assert.equal(mayEmit('transcripts', 'commit', 'claude'), true);
  assert.equal(mayEmit('procinfo', 'commit', 'claude'), false);
  assert.equal(mayEmit('procinfo', 'commit', 'shell'), true);
  assert.equal(mayEmit('transcripts', 'news', 'shell'), false);
  assert.equal(mayEmit('demo', 'news', 'codex'), true);
  assert.equal(mayEmit('procinfo', 'error', 'shell'), false);
  assert.equal(mayEmit('subagents', 'subagent-done', 'claude'), true);
  // every kind emitted by >1 owner in a wiring is listed in SHARED_EVENTS
  for (const owners of [LIVE_OWNERS, DEMO_OWNERS]) {
    const seen = new Map<EventKind, number>();
    for (const o of owners) for (const k of EVENT_OWNERS[o]) seen.set(k, (seen.get(k) ?? 0) + 1);
    for (const [k, n] of seen) if (n > 1) assert.ok(SHARED_EVENTS.includes(k), `${k} has ${n} owners`);
  }
});

test('EVENT_OWNERS cover EVENT_KINDS and use only valid kinds', () => {
  const all = new Set<EventKind>();
  for (const [o, kinds] of Object.entries(EVENT_OWNERS)) {
    assert.ok(Object.hasOwn(FIELD_OWNERS, o), o);
    for (const k of kinds) {
      assert.ok(EVENT_KINDS.includes(k), `${o}:${k}`);
      all.add(k);
    }
  }
  assert.deepEqual([...all].sort(), [...EVENT_KINDS].sort());
});

