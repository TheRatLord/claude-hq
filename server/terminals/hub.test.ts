// TerminalHub rules under FakeClock with a scripted backend (DESIGN §4.7): backpressure (needsFull), paused-viewer
// drop, idle demotion, sizer hand-over hysteresis, promote timeout, ack coalescing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalHub, IDLE_DEMOTE_MS, PROMOTE_TIMEOUT_MS } from './hub.ts';
import type { HubClient } from './hub.ts';
import { TerminalBackend, TerminalHandle } from '../interfaces.ts';
import type { TerminalOpenOpts } from '../interfaces.ts';
import type { Frame, ServerMsg, TermStateMsg } from '../../shared/protocol.ts';
import { FakeClock } from '../clock.ts';
import { need } from '../test/need.ts';
import { LIMITS, decodeFrame } from '../../shared/protocol.ts';

class H extends TerminalHandle {
  id: string;
  mode: TerminalOpenOpts['mode'];
  takeover?: boolean;
  promoteToken?: string;
  inputs: string[] = [];
  released = false;
  constructor(id: string, o: TerminalOpenOpts) {
    super();
    this.id = id;
    this.mode = o.mode;
    this.cols = o.cols;
    this.rows = o.rows;
    this.takeover = o.takeover;
    this.promoteToken = o.promoteToken;
  }
  override async input(b: Uint8Array): Promise<void> {
    this.inputs.push(new TextDecoder().decode(b));
  }
  override async release(): Promise<void> {
    this.released = true;
  }
}
class Backend extends TerminalBackend {
  opened: H[] = [];
  tokens = 0;
  /** the i-th opened handle */
  nth(i: number): H {
    return need(this.opened[i], `opened[${i}]`);
  }
  last(): H {
    return need(this.opened.at(-1), 'a handle');
  }
  mintPromoteToken(): string {
    return `tok${++this.tokens}`;
  }
  override open(id: string, o: TerminalOpenOpts): H {
    const h = new H(id, o);
    this.opened.push(h);
    return h;
  }
}
const flush = (): Promise<void> => new Promise((r) => setImmediate(() => r()));
interface TestClient extends HubClient {
  json: ServerMsg[];
  bin: Frame[];
  buffered: number;
  states(): TermStateMsg[];
}
function client(cid: string): TestClient {
  const c: TestClient = {
    cid, json: [], bin: [], buffered: 0,
    sendJson: (m) => void c.json.push(m),
    sendBinary: (u8) => {
      const f = decodeFrame(u8);
      if (f) c.bin.push(f);
    },
    bufferedAmount: () => c.buffered,
    states: () => c.json.filter((m): m is TermStateMsg => m.t === 'term.state'),
  };
  return c;
}
const te = (s: string): Uint8Array => new TextEncoder().encode(s);

function setup() {
  const clock = new FakeClock();
  const backend = new Backend();
  const hub = new TerminalHub({ backend, clock });
  return { clock, backend, hub };
}

test('backpressure: > 1 MB buffered drops diffs and marks needsFull; below 256 KB one full frame', async () => {
  const { clock, backend, hub } = setup();
  const a = client('a');
  hub.open(a, { id: 'p', cols: 80, rows: 24 });
  const h = backend.nth(0);
  h._frame(te('\x1b[2Jhello'), true);
  await flush();
  a.buffered = LIMITS.bufferedHigh + 1;
  const n = a.bin.length;
  h._frame(te(' world'), false);
  h._frame(te('!'), false);
  assert.equal(a.bin.length, n, 'diffs dropped');
  a.buffered = LIMITS.bufferedLow - 1;
  clock.advance(100);
  for (let i = 0; i < 50 && !((a.bin.at(-1)?.flags ?? 0) & 1 && a.bin.length > n); i++) await new Promise((r) => setTimeout(r, 10)); // xterm parses async
  const last = need(a.bin.at(-1));
  assert.equal(last.flags & 1, 1, 'full frame');
  assert.match(new TextDecoder().decode(last.payload), /hello world!/);
});

test('paused viewer is dropped after 60 s; resume before that gets one full frame; sizer hands over', async () => {
  const { clock, backend, hub } = setup();
  const a = client('a'), b = client('b');
  hub.open(a, { id: 'p', cols: 80, rows: 24 });
  backend.nth(0)._frame(te('x'), true);
  hub.open(b, { id: 'p', cols: 84, rows: 25 });
  hub.pause(a, { id: 'p' });
  assert.equal(hub.panes.get('p')?.sizer, b, 'sizer handed to the oldest active viewer');
  assert.equal(backend.opened.length, 1, '< 10 % difference: no respawn');
  clock.advance(LIMITS.pausedDropMs + 1);
  assert.equal(hub.panes.get('p')?.viewers.has(a), false);
  assert.equal(a.states().at(-1)?.detail, 'paused too long');
});

test('sizer hand-over respawns the observe child when grids differ by > 10 % (rate limited)', () => {
  const { clock, backend, hub } = setup();
  const a = client('a'), b = client('b');
  hub.open(a, { id: 'p', cols: 80, rows: 24 });
  backend.nth(0)._frame(te('x'), true);
  hub.open(b, { id: 'p', cols: 160, rows: 50 });
  hub.close(a, { id: 'p' });
  clock.advance(LIMITS.respawnPerPaneMs);
  assert.equal(backend.opened.length, 2);
  assert.deepEqual([backend.nth(1).mode, backend.nth(1).cols, backend.nth(1).rows], ['observe', 160, 50]);
  assert.equal(backend.nth(0).released, true);
});

test('idle demotion: 10 min without input in control → release, back to observe (state released)', async () => {
  const { clock, backend, hub } = setup();
  const a = client('a');
  hub.open(a, { id: 'p', cols: 80, rows: 24 });
  backend.nth(0)._frame(te('x'), true);
  const pr = hub.promote(a, { id: 'p', cols: 80, rows: 24 });
  const ctl = backend.nth(1);
  assert.equal(ctl.mode, 'control');
  assert.equal(ctl.promoteToken, 'tok1', 'control spawns carry a promote token');
  ctl._frame(te('y'), true);
  await pr;
  await hub.input(a, 'p', te('ls\r'));
  assert.deepEqual(ctl.inputs, ['ls\r']);
  clock.advance(IDLE_DEMOTE_MS - 1000);
  await hub.input(a, 'p', te('x'));
  clock.advance(IDLE_DEMOTE_MS - 1000);
  assert.equal(ctl.released, false, 'input re-arms the timer');
  clock.advance(2000);
  assert.equal(ctl.released, true);
  assert.equal(backend.last().mode, 'observe');
  assert.ok(a.states().some((s) => s.state === 'released' && s.detail === 'idle'));
  assert.deepEqual(await hub.input(a, 'p', te('z')), { ok: false, error: 'not_controller' });
});

test('promote: input typed during the swap is held and delivered in order; a stuck control child times out', async () => {
  const { clock, backend, hub } = setup();
  const a = client('a');
  hub.open(a, { id: 'p', cols: 80, rows: 24 });
  backend.nth(0)._frame(te('x'), true);
  const pr = hub.promote(a, { id: 'p', cols: 80, rows: 24 });
  await hub.input(a, 'p', te('a'));
  await hub.input(a, 'p', te('b'));
  backend.nth(1)._frame(te('y'), true);
  await pr;
  assert.deepEqual(backend.nth(1).inputs, ['a', 'b']);
  clock.advance(LIMITS.ackEveryMs);
  assert.deepEqual(a.json.filter((m) => m.t === 'term.ack').map((m) => m.upTo), [2]);
  // second pane: control never produces a frame
  hub.open(a, { id: 'q', cols: 80, rows: 24 });
  backend.last()._frame(te('x'), true);
  const stuck = hub.promote(a, { id: 'q', cols: 80, rows: 24 }).catch((e) => e);
  clock.advance(PROMOTE_TIMEOUT_MS + 1);
  const err = await stuck;
  assert.match(err.message, /did not start/);
  assert.equal(backend.last().released, true);
  assert.equal(hub.panes.get('q')?.child?.mode, 'observe', 'observe stream keeps running');
});

test('taken: another client takes over the control child → stays in Peek on a fresh observe stream, state taken', () => {
  const { backend, hub } = setup();
  const a = client('a');
  hub.open(a, { id: 'p', cols: 80, rows: 24 });
  backend.nth(0)._frame(te('x'), true);
  hub.promote(a, { id: 'p', cols: 80, rows: 24 });
  backend.nth(1)._frame(te('y'), true);
  backend.nth(1)._closed({ code: 0, reason: 'terminal attach taken over' });
  assert.equal(backend.last().mode, 'observe');
  backend.last()._frame(te('z'), true);
  const st = need(a.states().at(-1));
  assert.deepEqual([st.state, st.mode, st.writer], ['taken', 'observe', false]);
});
