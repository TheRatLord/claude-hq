// Store + socket against a fake WebSocket (no browser): eager apply, hello.ack gating, coalescing, reconnect,
// interactive credit window, paste chunking, protocol-skew reload guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, decodeFrame, encodeTermData, BIN } from '../../../shared/protocol.ts';
import { fake } from '../core/testDoubles.ts';

// ---- browser shims ----------------------------------------------------------------------------
const ssData = new Map<string, string>();
globalThis.sessionStorage = fake<Storage>({
  getItem: (k: string) => (ssData.has(k) ? ssData.get(k) : null),
  setItem: (k: string, v: string) => ssData.set(k, String(v)),
  removeItem: (k: string) => ssData.delete(k),
});
let reloads = 0;
globalThis.location = fake<Location>({ protocol: 'http:', host: '127.0.0.1:1', href: 'http://127.0.0.1:1/?t=tok&pose=proto', reload: () => { reloads++; } });
globalThis.history = fake<History>({ state: null, replaceState: (_s: unknown, _t: string, u?: string | URL | null) => { globalThis.location.href = `http://127.0.0.1:1${u}`; } });

/** What the fake socket recorded: a parsed JSON message, or a decoded binary frame (`kind`, `id`, `flags`, `payload`). */
interface Sent { t?: string; rid?: number | string; protocol?: number; kind?: number; flags?: number; payload?: Uint8Array; [k: string]: unknown }
const sockets: FakeWS[] = [];
class FakeWS {
  static OPEN = 1;
  url: string;
  readyState = 0;
  sent: Sent[] = [];
  bufferedAmount = 0;
  onopen?: () => void;
  onmessage?: (e: { data: unknown }) => void;
  onclose?: (e: { code: number; reason: string }) => void;
  constructor(url: string) { this.url = url; sockets.push(this); }
  send(d: string | ArrayBuffer | ArrayBufferView) { this.sent.push(typeof d === 'string' ? JSON.parse(d) : { ...decodeFrame(d) }); }
  close() { this._close(1000); }
  // test helpers
  _open() { this.readyState = 1; this.onopen?.(); }
  _text(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  _bin(u8: Uint8Array) { this.onmessage?.({ data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) }); }
  _close(code = 1006) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code, reason: '' }); }
}
globalThis.WebSocket = fake<typeof WebSocket>(FakeWS);

const { store, connect, send, call, sendBytes, sendPaste, onTermData, chunkUtf8 } = await import('./store.ts');

const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (fn: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};
const ent = (id: string, status = 'idle', extra: Record<string, unknown> = {}) => ({ id, kind: 'claude', status, name: id, ...extra });
const hello = (extra: Record<string, unknown> = {}) => ({ t: 'hello', protocol: PROTOCOL_VERSION, serverNow: Date.now() + 5000, session: 'demo', demo: true, herdr: { connected: true }, limits: {}, ...extra });

test('chunkUtf8: byte-bounded, never splits a code point', () => {
  assert.deepEqual(chunkUtf8('abcdef', 4), ['abcd', 'ef']);
  const s = 'aé😀b'; // 1 + 2 + 4 + 1 bytes
  const parts = chunkUtf8(s, 4);
  assert.equal(parts.join(''), s);
  for (const p of parts) assert.ok(new TextEncoder().encode(p).length <= 4);
  assert.deepEqual(parts, ['aé', '😀', 'b']);
  assert.deepEqual(chunkUtf8('', 4), []);
});

test('store end to end on a fake socket', async (t) => {
  connect({ token: 'tok' });
  const ws = sockets[0];
  assert.match(ws.url, /\/ws\?cid=[0-9a-f]{24}&t=tok$/);
  assert.equal(ssData.get('hq.token'), 'tok');
  assert.ok(!location.href.includes('t=tok'), 'token stripped from the URL');
  assert.equal(store.conn.state, 'connecting');

  // Nothing leaves before hello.ack: queued.
  send({ t: 'screen.watch', ids: [] });
  ws._open();
  assert.equal(ws.sent.length, 0);

  await t.test('hello → ack first, then the queue; skew + limits applied', async () => {
    const seen: string[] = [];
    store.on('conn', (c) => seen.push(c.state));
    ws._text(hello({ limits: { creditWindow: 10 } }));
    assert.deepEqual(ws.sent.map((m) => m.t), ['hello.ack', 'screen.watch']);
    assert.equal(ws.sent[0].protocol, PROTOCOL_VERSION);
    assert.ok(Math.abs(store.skewMs - 5000) < 200);
    assert.equal(store.limits.creditWindow, 10);
    assert.equal(store.demo, true);
    await tick();
    assert.deepEqual(seen, ['open']);
    assert.equal(store.conn.connects, 1);
  });

  // under --timescale K the server clock runs K× wall; store.now() must follow it or ages go negative.
  await t.test('store.now() extrapolates at hello.timescale', () => {
    assert.equal(store.timescale, 1);
    const saved = { skewMs: store.skewMs, skewAt: store.skewAt };
    Object.assign(store, { timescale: 4, skewMs: 5000, skewAt: Date.now() - 10_000 });
    const d = store.now() - Date.now();
    assert.ok(Math.abs(d - (5000 + 3 * 10_000)) < 200, `server now ahead by ${d} ms`);
    Object.assign(store, { timescale: 1, ...saved });
  });

  await t.test('world/entity/gone apply eagerly; entity coalesced per id on a microtask', async () => {
    ws._text({ t: 'world', entities: [ent('a'), ent('b')], workspaces: [{ id: 'w1' }], focusedPaneId: 'a' });
    assert.equal(store.entities.size, 2); // synchronous
    const got: string[] = [];
    const off = store.on('entity', (e) => got.push(`${e.id}:${e.status}`));
    ws._text({ t: 'entity', entity: ent('a', 'working') });
    ws._text({ t: 'entity', entity: ent('b', 'working') });
    ws._text({ t: 'entity', entity: ent('a', 'blocked') });
    assert.equal(store.entities.get('a')?.status, 'blocked');
    assert.deepEqual(got, []);
    await tick();
    assert.deepEqual(got, ['b:working', 'a:blocked']);
    off();
    ws._text({ t: 'gone', id: 'b', reason: 'closed' });
    assert.ok(!store.entities.has('b'));
  });

  await t.test('binary term.data goes straight to the registered writer', () => {
    const got: [string, boolean][] = [];
    const off = onTermData('a', (bytes, full) => got.push([new TextDecoder().decode(bytes), full]));
    ws._bin(encodeTermData('a', 'hi', true));
    ws._bin(encodeTermData('zz', 'nope'));
    off();
    ws._bin(encodeTermData('a', 'late'));
    assert.deepEqual(got, [['hi', true]]);
  });

  await t.test('interactive credit window: queue beyond creditWindow, drain on term.ack', () => {
    ws.sent.length = 0;
    send({ t: 'term.open', id: 'a', cols: 80, rows: 24 });
    const enc = (s: string) => new TextEncoder().encode(s);
    assert.equal(sendBytes('a', enc('12345678')), true); // 8 ≤ 10
    assert.equal(sendBytes('a', enc('abcd')), true); // 12 > 10 → queued
    const bins = () => ws.sent.filter((m) => m.kind === BIN.TERM_INPUT);
    assert.equal(bins().length, 1);
    assert.equal(bins()[0].flags, 0);
    ws._text({ t: 'term.ack', id: 'a', upTo: 8 });
    assert.equal(bins().length, 2);
    assert.equal(new TextDecoder().decode(bins()[1].payload), 'abcd');
    // term.open resets the count (new viewer on the server)
    send({ t: 'term.open', id: 'a', cols: 80, rows: 24 });
    assert.equal(sendBytes('a', enc('0123456789')), true);
    assert.equal(bins().length, 3);
  });

  await t.test('paste: JSON term.input chunks with rid, sequential, stop on error', async () => {
    ws.sent.length = 0;
    Object.assign(store.limits, { pasteChunk: 4 }); // (readonly in the type: the store only ever replaces `limits` from hello)
    const p = sendPaste('a', 'abcdefghij');
    const jsonInputs = () => ws.sent.filter((m) => m.t === 'term.input');
    await until(() => jsonInputs().length === 1);
    const m0 = jsonInputs()[0];
    assert.deepEqual({ ...m0, rid: 0 }, { t: 'term.input', id: 'a', text: 'abcd', paste: true, rid: 0 });
    assert.equal(ws.sent.filter((m) => m.kind === BIN.TERM_INPUT).length, 0, 'paste never uses binary frames');
    ws._text({ t: 'reply', rid: m0.rid, ok: true });
    await until(() => jsonInputs().length === 2);
    ws._text({ t: 'reply', rid: jsonInputs()[1].rid, ok: false, error: 'not_controller' });
    const r = await p;
    assert.deepEqual(r, { ok: false, error: 'not_controller', chunks: 3, sent: 1 });
    Object.assign(store.limits, { pasteChunk: 16 * 1024 });
  });

  await t.test('drop → pending calls resolve disconnected; reconnect → hello again, world replaced', async () => {
    const pc = call({ t: 'world.get' });
    ws._close(1006);
    assert.deepEqual(await pc, { t: 'reply', rid: (await pc).rid, ok: false, error: 'disconnected' });
    assert.equal(store.conn.state, 'closed');
    assert.ok((store.conn.retryInMs ?? 0) >= 400 && (store.conn.retryInMs ?? 0) <= 600);
    assert.equal(store.entities.size, 1, 'no exodus while offline');
    assert.equal(sendBytes('a', new Uint8Array([1])), false);
    await until(() => sockets.length === 2);
    const ws2 = sockets[1];
    assert.equal(ws2.url, ws.url, 'same cid + token');
    ws2._open();
    ws2._text(hello());
    ws2._text({ t: 'world', entities: [ent('c'), ent('d')], workspaces: [] });
    assert.deepEqual([...store.entities.keys()], ['c', 'd']);
    assert.equal(store.conn.connects, 2);
    assert.equal(store.conn.state, 'open');
  });

  await t.test('protocol skew: banner + one guarded reload, then persistent mismatch without traffic', async () => {
    const ws2 = sockets[1];
    const before = ws2.sent.length;
    ws2._text(hello({ protocol: PROTOCOL_VERSION + 1 }));
    assert.equal(store.conn.state, 'mismatch');
    assert.equal(ws2.sent.length, before, 'no hello.ack on mismatch');
    await until(() => reloads === 1);
    assert.equal(ssData.get('hq.protocolReload'), `${PROTOCOL_VERSION}->${PROTOCOL_VERSION + 1}`);
    assert.equal(send({ t: 'world.get' }), false);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(sockets.length, 2, 'no reconnect after a mismatch');
  });
});

test('skewAction: reload once per version pair, then stuck', async () => {
  const { skewAction } = await import('./store.ts');
  assert.equal(skewAction(3, 3, null).action, 'ok');
  assert.deepEqual(skewAction(3, 4, null), { action: 'reload', tag: '3->4' });
  assert.equal(skewAction(3, 4, '3->4').action, 'stuck');
  assert.equal(skewAction(3, 5, '3->4').action, 'reload', 'a newer server upgrade gets its own reload');
});
