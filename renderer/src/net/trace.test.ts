import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionTrace, interactionTrace, TRACE_LIMITS } from './trace.ts';
import { PROTOCOL_VERSION, encodeTermData } from '../../../shared/protocol.ts';
import { fake } from '../core/testDoubles.ts';
import { connect, call, sendBytes } from './store.ts';

const secret = 'PRIVATE_TOKEN_prompt_/home/private/project_terminal_contents';

test('trace excludes adversarial payloads, identifiers, errors and unknown enum values', () => {
  const trace = createInteractionTrace(() => 10);
  trace.setEnabled(true);
  trace.setContext({ scenario: secret, seed: NaN });
  trace.captureHello({ protocol: Infinity, demo: secret, timescale: secret, session: secret,
    demoConfig: { scenario: secret, seed: secret, population: secret } });
  const request = { t: 'term.open', rid: secret, id: secret, cols: 80, rows: 24, token: secret, mode: secret };
  trace.beginCall(request);
  trace.message('out', request, 'sent');
  trace.message('in', { t: 'term.state', id: secret, state: secret, mode: secret, detail: secret, cols: secret, writer: secret });
  trace.message('in', { t: 'event', id: secret, kind: secret, detail: { text: secret } });
  trace.message('in', { t: 'gone', id: secret, newId: `${secret}/new`, reason: secret });
  trace.message('in', { t: secret, text: secret, id: secret });
  trace.message('in', { t: 'reply', rid: secret, ok: false, error: secret, paneId: secret, data: secret });
  const snapshot = trace.snapshot();
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.deepEqual(snapshot.context, {});
  assert.deepEqual(snapshot.entries[1].meta, { id: 'p1', request: 'r1', delivery: 'sent', cols: 80, rows: 24 });
  assert.deepEqual(snapshot.entries.find(e => e.type === 'term.state')?.meta, { id: 'p1' });
  assert.deepEqual(snapshot.entries.find(e => e.type === 'gone')?.meta, { id: 'p1', newId: 'p2' });
  assert.deepEqual(snapshot.entries.at(-1)?.meta, { request: 'r1', requestType: 'term.open', outcome: 'error', elapsedMs: 0, delivery: 'sent' });
});

test('trace captures authoritative demo context and safe protocol error codes only', () => {
  const trace = createInteractionTrace(() => 0);
  trace.setEnabled(true);
  trace.setContext({ scenario: 'mixed', seed: 1 });
  trace.message('in', { t: 'hello', protocol: 4, demo: 12, timescale: 2, session: secret,
    demoConfig: { scenario: 'allStates', seed: 7, population: 12, token: secret } });
  assert.deepEqual(trace.snapshot().context, { scenario: 'allStates', seed: 7, protocol: 4, demo: true, timescale: 2, population: 12 });
  trace.beginCall({ t: 'demo.scenario', rid: 1 });
  trace.message('out', { t: 'demo.scenario', rid: 1, name: 'trio', seed: 0 }, 'sent');
  trace.message('in', { t: 'reply', rid: 1, ok: true, demoConfig: { scenario: 'trio', seed: 0, population: 3 } });
  assert.equal(trace.snapshot().context.scenario, 'trio');
  assert.equal(trace.snapshot().context.seed, 0);
  trace.beginCall({ t: 'demo.scenario', rid: 2 });
  trace.message('out', { t: 'demo.scenario', rid: 2, name: 'mixed', seed: 42 }, 'sent');
  trace.message('in', { t: 'reply', rid: 2, ok: true, demoConfig: { scenario: 'mixed', seed: 42, population: 3, token: secret } });
  assert.equal(trace.snapshot().context.seed, 42);
  const sequence = trace.snapshot().entries.filter(e => e.type === 'demo.scenario' || (e.type === 'reply' && e.meta?.ok));
  assert.deepEqual(sequence.map(e => [e.direction, e.meta?.scenario, e.meta?.seed]),
    [['out', 'trio', 0], ['in', 'trio', 0], ['out', 'mixed', 42], ['in', 'mixed', 42]]);
  assert.deepEqual(sequence.filter(e => e.type === 'reply').map(e => e.meta?.population), [3, 3]);
  trace.message('out', { t: 'demo.scenario', name: secret, seed: secret }, 'sent');
  assert.deepEqual(trace.snapshot().entries.at(-1)?.meta, { delivery: 'sent' });
  trace.message('in', { t: 'reply', rid: 2, ok: false, error: 'not_controller', detail: secret });
  assert.deepEqual(trace.snapshot().entries.at(-1)?.meta, { ok: false, errorCode: 'not_controller' });
  assert.equal(JSON.stringify(trace.snapshot()).includes(secret), false);
});

test('trace correlates queued, sent, timeout and disconnect outcomes with elapsed time', () => {
  let clock = 100;
  const trace = createInteractionTrace(() => clock);
  trace.setEnabled(true);
  const first = { t: 'term.open', rid: 99, id: secret };
  trace.beginCall(first);
  trace.message('local', first, 'queued');
  clock += 5;
  trace.message('out', first, 'sent');
  clock += 7;
  trace.message('in', { t: 'reply', rid: 99, ok: true });
  assert.deepEqual(trace.snapshot().entries.at(-1)?.meta,
    { request: 'r1', requestType: 'term.open', outcome: 'ok', elapsedMs: 12, delivery: 'sent' });
  const second = { t: 'world.get', rid: 100 };
  trace.beginCall(second);
  trace.message('local', second, 'queued');
  clock += 25;
  trace.finishCall(100, 'timeout');
  assert.deepEqual(trace.snapshot().entries.at(-1)?.meta,
    { request: 'r2', requestType: 'world.get', outcome: 'timeout', elapsedMs: 25, delivery: 'queued' });
  trace.beginCall({ t: 'agent.prompt', rid: 101 });
  trace.disconnect();
  assert.equal(trace.snapshot().entries.at(-1)?.meta?.outcome, 'disconnected');
  assert.equal(trace.snapshot().entries.filter(e => e.direction === 'out').length, 1);
  const exported = JSON.stringify(trace.snapshot());
  clock += 100;
  assert.equal(JSON.stringify(trace.snapshot()), exported, 'export timestamps do not drift with time');
});

test('trace bounds chronological ring, correlations and identity aliases', () => {
  const trace = createInteractionTrace(() => 0);
  trace.setEnabled(true);
  for (let i = 0; i < TRACE_LIMITS.entries + 5; i++) trace.connection('open', null);
  let snapshot = trace.snapshot();
  assert.equal(snapshot.entries.length, TRACE_LIMITS.entries);
  assert.equal(snapshot.dropped, 5);
  assert.equal(snapshot.entries[0].seq, 6);
  assert.equal(snapshot.entries.at(-1)?.seq, TRACE_LIMITS.entries + 5);
  trace.clear();
  for (let i = 0; i < TRACE_LIMITS.calls + 2; i++) trace.beginCall({ t: 'world.get', rid: i });
  trace.message('in', { t: 'reply', rid: 0, ok: true });
  assert.equal(trace.snapshot().entries.at(-1)?.meta?.request, undefined, 'evicted correlation cannot be resurrected');
  trace.disconnect();
  snapshot = trace.snapshot();
  assert.equal(snapshot.entries.filter(e => e.meta?.outcome === 'evicted').length, 2);
  assert.equal(snapshot.entries.filter(e => e.meta?.outcome === 'disconnected').length, TRACE_LIMITS.calls);
  trace.clear();
  trace.message('in', { t: 'gone', id: 'first', reason: 'closed' });
  for (let i = 0; i < TRACE_LIMITS.aliases; i++) trace.message('in', { t: 'gone', id: `pane-${i}` });
  trace.message('in', { t: 'gone', id: 'first' });
  assert.equal(trace.snapshot().entries.at(-1)?.meta?.id, `p${TRACE_LIMITS.aliases + 2}`);
  trace.message('in', { t: 'gone', id: 'x'.repeat(TRACE_LIMITS.identifierLength + 1) });
  assert.equal(trace.snapshot().entries.at(-1)?.meta, undefined, 'oversized identifiers are not retained');
});

test('disabled and cleared trace releases session data; snapshots cannot mutate retained entries', async () => {
  const trace = createInteractionTrace(() => 0);
  const empty = { version: 1, context: {}, entries: [], dropped: 0 };
  trace.message('in', { t: 'hello', protocol: 4 });
  trace.beginCall({ t: 'world.get', rid: 1 });
  trace.setContext({ scenario: 'mixed', seed: 1 });
  assert.deepEqual(trace.snapshot(), empty);
  trace.setEnabled(true);
  trace.setContext({ scenario: 'mixed', seed: 1 });
  trace.beginCall({ t: 'world.get', rid: 1 });
  trace.message('in', { t: 'gone', id: secret });
  const snapshot = trace.snapshot();
  snapshot.context.scenario = secret;
  if (snapshot.entries[1].meta) snapshot.entries[1].meta.id = secret;
  assert.equal(JSON.stringify(trace.snapshot()).includes(secret), false);
  trace.clear();
  trace.finishCall(1, 'timeout');
  assert.deepEqual(trace.snapshot(), empty);
  trace.message('in', { t: 'gone', id: 'new' });
  assert.equal(trace.snapshot().entries[0].meta?.id, 'p1');
  trace.setEnabled(false);
  trace.disconnect();
  trace.binary('in', secret, 99, true);
  assert.deepEqual(trace.snapshot(), empty);
  let notifications = 0;
  const unsubscribe = trace.subscribe(() => { notifications++; });
  trace.setEnabled(true);
  trace.connection('open', null);
  trace.connection('closed', 500);
  await Promise.resolve();
  assert.equal(notifications, 1, 'burst notifications are batched');
  unsubscribe();
  trace.clear();
  await Promise.resolve();
  assert.equal(notifications, 1);
});

test('store trace records actual transmission, terminal credit, migration and local failure', async () => {
  const sockets: Transport[] = [];
  class Transport {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    onopen?: () => void;
    onmessage?: (event: { data: unknown }) => void;
    onclose?: (event: { code: number; reason: string }) => void;
    sent: unknown[] = [];
    constructor() { sockets.push(this); }
    send(value: unknown) { this.sent.push(typeof value === 'string' ? JSON.parse(value) : value); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: secret }); }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  globalThis.WebSocket = fake<typeof WebSocket>(Transport);
  globalThis.sessionStorage = fake<Storage>({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  globalThis.location = fake<Location>({ protocol: 'http:', host: '127.0.0.1:1' });
  interactionTrace.setEnabled(true);
  try {
    connect({ token: secret, url: 'ws://127.0.0.1:1/ws' });
    const ws = sockets[0];
    const result = call({ t: 'term.open', id: secret, cols: 80, rows: 24 });
    assert.equal(interactionTrace.snapshot().entries.some(e => e.direction === 'out'), false);
    ws.readyState = 1;
    ws.onopen?.();
    ws.receive({ t: 'hello', protocol: PROTOCOL_VERSION, demo: true, timescale: 1, limits: { creditWindow: 2, termInputMax: 2 } });
    const sent = ws.sent.find((v): v is { t: string; rid: number } => typeof v === 'object' && v !== null && 't' in v && v.t === 'term.open');
    assert.ok(sent);
    ws.receive({ t: 'reply', rid: sent.rid, ok: true });
    assert.equal((await result).ok, true);
    sendBytes(secret, new Uint8Array([65, 66, 67]));
    let binary = interactionTrace.snapshot().entries.filter(e => e.type === 'term.input.binary' && e.direction === 'out');
    assert.deepEqual(binary.map(e => e.meta?.bytes), [2]);
    ws.receive({ t: 'term.ack', id: secret, upTo: 2 });
    binary = interactionTrace.snapshot().entries.filter(e => e.type === 'term.input.binary' && e.direction === 'out');
    assert.deepEqual(binary.map(e => e.meta?.bytes), [2, 1]);
    const frame = encodeTermData(secret, secret, true);
    ws.onmessage?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });
    ws.receive({ t: 'gone', id: secret, newId: `${secret}/new`, reason: 'rekeyed' });
    const timedOut = await call({ t: 'world.get' }, { timeoutMs: 1 });
    assert.equal(timedOut.error, 'timeout');
    const disconnected = call({ t: 'world.get' });
    // Mismatch stops automatic reconnect, then the real close callback resolves pending calls.
    globalThis.sessionStorage = fake<Storage>({ getItem: () => `${PROTOCOL_VERSION}->999`, setItem: () => {}, removeItem: () => {} });
    ws.receive({ t: 'hello', protocol: 999 });
    assert.equal((await disconnected).error, 'disconnected');
    const snapshot = interactionTrace.snapshot();
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    assert.deepEqual(snapshot.entries.filter(e => e.type === 'call.end').map(e => e.meta?.outcome), ['ok', 'timeout', 'disconnected']);
    assert.ok(snapshot.entries.some(e => e.type === 'term.data' && e.meta?.bytes === new TextEncoder().encode(secret).length));
    assert.ok(snapshot.entries.some(e => e.type === 'gone' && e.meta?.reason === 'rekeyed' && e.meta?.id !== e.meta?.newId));
    assert.ok(snapshot.entries.some(e => e.type === 'term.credit' && e.meta?.sent === 3 && e.meta?.acked === 2 && e.meta?.queuedBytes === 0));
    const opened = snapshot.entries.filter(e => e.type === 'term.open');
    assert.deepEqual(opened.map(e => [e.direction, e.meta?.delivery]), [['local', 'queued'], ['out', 'sent']]);
    assert.equal(opened[0].meta?.request, opened[1].meta?.request);
  } finally { interactionTrace.setEnabled(false); }
});
