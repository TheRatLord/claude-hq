/** Test helpers: a demo app on port 0 with a temp config dir and fixed token, and a WS client that records. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import WebSocket from 'ws';
import type { RawData } from 'ws';
import { createApp } from '../app.ts';
import type { App } from '../app.ts';
import type { AppOptions } from '../config.ts';
import { nullLogger } from '../log.ts';
import { DemoWorld } from '../demo/world.ts';
import { HerdrLive } from '../herdr/live.ts';
import type { HerdrClient } from '../herdr/client.ts';
import { decodeFrame } from '../../shared/protocol.ts';
import type { Hello, ReplyMsg, ServerMsg, WorldMsg } from '../../shared/protocol.ts';
import type { MockHerdr, MockSnapshot } from './mockHerdr.ts';

export const TOKEN = 'ab'.repeat(32);

/** A demo app: `source` is the DemoWorld. */
export type DemoApp = App & { source: DemoWorld };
/** A live app: `source` is a HerdrLive and `client` exists. */
export type LiveApp = App & { source: HerdrLive; client: HerdrClient; close(o?: { keep?: boolean }): Promise<void> };

export async function startApp(opts: AppOptions = {}): Promise<DemoApp> {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-test-'));
  const app = await createApp({ port: 0, demo: 12, token: TOKEN, configDir, log: nullLogger, ...opts });
  if (!(app.source instanceof DemoWorld)) throw new Error('startApp: expected a demo source');
  const close = app.close;
  app.close = async () => {
    await close();
    fs.rmSync(configDir, { recursive: true, force: true });
  };
  return Object.assign(app, { source: app.source });
}

/** A JSON text message the server sent: narrow on `t` (or name the type in `c.wait<ScreenMsg>(...)`). */
export type WireMsg = ServerMsg;
export interface WireFrame { id: string; full: boolean; text: string }

export interface WsTestClient {
  ws: WebSocket;
  msgs: WireMsg[];
  frames: WireFrame[];
  closed: number | null;
  rid: number;
  /** a JSON message (an object is stringified; a string or bytes are sent as they are: tests send garbage on purpose) */
  send(m: string | Uint8Array | object): void;
  /** Send with a rid and await the reply. */
  call(m: object): Promise<ReplyMsg>;
  /** Wait for a message; name its type (`c.wait<ScreenMsg>(...)`) to read the fields the predicate checked. */
  wait<M extends WireMsg = WireMsg>(pred: (m: WireMsg) => boolean, ms?: number): Promise<M>;
  waitFrame(pred: (f: WireFrame) => boolean, ms?: number): Promise<WireFrame>;
  text(id: string): string;
  close(): Promise<void>;
}

/** The hello message a client received (throws if none arrived) */
export function helloOf(c: Pick<WsTestClient, 'msgs'>): Hello {
  const h = c.msgs.find((m): m is Hello => m.t === 'hello');
  if (!h) throw new Error('no hello received');
  return h;
}

/** The (first) world message a client received (throws if none arrived) */
export function worldOf(c: Pick<WsTestClient, 'msgs'>): WorldMsg {
  const w = c.msgs.find((m): m is WorldMsg => m.t === 'world');
  if (!w) throw new Error('no world received');
  return w;
}

export interface ConnectOpts { origin?: string | null; token?: string | null; ack?: boolean; cid?: string; headers?: Record<string, string> }


export async function connect(port: number, { origin = `http://127.0.0.1:${port}`, token = TOKEN, ack = true, cid = 'c1', headers = {} }: ConnectOpts = {}): Promise<WsTestClient> {
  const qs = new URLSearchParams({ ...(token ? { t: token } : {}), cid });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${qs}`, { ...(origin ? { origin } : {}), headers });
  const msgs: WireMsg[] = [];
  const frames: WireFrame[] = [];
  const c: WsTestClient = {
    ws, msgs, frames, closed: null, rid: 100,
    send: (m) => ws.send(typeof m === 'string' || m instanceof Uint8Array ? m : JSON.stringify(m)),
    call: async (m) => {
      const rid = ++c.rid;
      c.send({ ...m, rid });
      const r = await waitFor(() => msgs.find((x): x is ReplyMsg => x.t === 'reply' && x.rid === rid));
      return r;
    },
    // the predicate is the caller's check that the message has the type it names
    wait: async <M extends WireMsg>(pred: (m: WireMsg) => boolean, ms?: number): Promise<M> => (await waitFor(() => msgs.find(pred), ms)) as M,
    waitFrame: (pred, ms) => waitFor(() => frames.find(pred), ms),
    text: (id) => frames.filter((f) => f.id === id).map((f) => f.text).join(''),
    close: () => new Promise<void>((r) => {
      if (ws.readyState === ws.CLOSED) r();
      else {
        ws.once('close', () => r());
        ws.close();
      }
    }),
  };
  ws.on('message', (d: RawData, bin: boolean) => {
    if (bin) {
      const f = decodeFrame(Array.isArray(d) ? Buffer.concat(d) : d);
      if (f) frames.push({ id: f.id, full: (f.flags & 1) === 1, text: new TextDecoder().decode(f.payload) });
    } else msgs.push(JSON.parse(d.toString()) as WireMsg); // the server's own JSON
  });
  ws.on('close', (code) => (c.closed = code));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req: http.ClientRequest, res: http.IncomingMessage) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
  });
  await c.wait((m) => m.t === 'hello');
  if (ack) {
    const r = await c.call({ t: 'hello.ack', protocol: 1 });
    if (!r.ok) throw new Error('ack failed');
    await c.wait((m) => m.t === 'world');
  }
  return c;
}

export async function waitFor<T>(fn: () => T | undefined | null | false, ms = 2000): Promise<T> {
  const t0 = performance.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setImmediate(r));
    await new Promise<void>((r) => queueMicrotask(r));
    await sleep(5);
  }
}
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface StartLiveOpts { session?: string; protocol?: number; snapshot?: MockSnapshot; app?: AppOptions; home?: string; configDir?: string; mock?: MockHerdr }
/** One line the fake bin logged per spawn */
export interface SpawnLog { argv: string[]; instance: string | null; session: string | null; herdrEnv: string[]; pid: number }
export interface LiveHarness {
  app: LiveApp;
  mock: MockHerdr;
  home: string;
  configDir: string;
  spawns(): SpawnLog[];
  session: string;
}

/**
 * Live backend against a MockHerdr (+ fake terminal bin). Sets process.env.HQ_HERDR_HOME / HERDR_BIN_PATH /
 * FAKE_HERDR_LOG for this test process (every test file runs in its own process).
 */
export async function startLive(o: StartLiveOpts = {}): Promise<LiveHarness> {
  const { MockHerdr, FAKE_BIN, fixture } = await import('./mockHerdr.ts');
  const home = o.home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'hq-herdr-'));
  const configDir = o.configDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'hq-live-'));
  const logFile = path.join(home, 'fake-bin.log');
  process.env.HQ_HERDR_HOME = home;
  process.env.HERDR_BIN_PATH = FAKE_BIN;
  process.env.FAKE_HERDR_LOG = logFile;
  const session = o.session ?? 'hqtest';
  const mock = o.mock ?? await MockHerdr.start({ home, session, protocol: o.protocol ?? 22, snapshot: o.snapshot ?? fixture() });
  const base = await createApp({ port: 0, session, token: TOKEN, configDir, log: nullLogger, ...(o.app ?? {}) });
  if (!(base.source instanceof HerdrLive) || !base.client) throw new Error('startLive: expected a live source');
  const close = base.close;
  // `keep`: leave the mock and the dirs for a restart
  const app: LiveApp = Object.assign(base, { source: base.source, client: base.client, close: async ({ keep = false }: { keep?: boolean } = {}): Promise<void> => {
    await close();
    if (!keep) {
      await mock.close();
      fs.rmSync(configDir, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  } });
  /** argv lines the fake bin logged */
  const spawns = (): SpawnLog[] => {
    try {
      return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as SpawnLog); // written by fakeHerdrBin
    } catch {
      return [];
    }
  };
  return { app, mock, home, configDir, spawns, session };
}
