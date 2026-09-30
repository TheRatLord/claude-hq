/**
 * Mock herdr: a scripted NDJSON unix-socket server shaped like herdr 0.9.0 / protocol 22, plus a fake
 * `terminal session` binary (server/test/fakeHerdrBin.ts, used via HERDR_BIN_PATH) that attaches through this
 * socket. Every method call is logged (`calls`) so safety tests can assert what was — and was not — sent.
 *
 *   const m = await MockHerdr.start({ home, session: 'hqtest' });   // socket = <home>/sessions/hqtest/herdr.sock
 *   m.addPane({...}); m.setStatus('w1:p1', 'working'); await m.stop(); await m.restart({ rekey: true });
 *
 * Terminals: the fake bin sends `fake.term.attach {pane_id, mode, takeover, cols, rows}` on a long-lived connection;
 * the mock answers like herdr (busy without takeover, "taken over" to the old controller, "not found") and streams
 * `{type:'frame', text, full}` lines; the bin writes `terminal.frame`/`terminal.closed` NDJSON on stdout.
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_BIN = fileURLToPath(new URL('./fakeHerdrBin.ts', import.meta.url));

const clone = <T>(o: T): T => structuredClone(o);

export interface MockAgentSession { source: string; agent: string; kind: string; value: string }
export interface MockPane {
  pane_id: string; terminal_id: string; workspace_id: string; tab_id: string; focused: boolean; cwd: string; foreground_cwd: string;
  terminal_title?: string; terminal_title_stripped: string; agent_status: string; agent?: string; agent_session?: MockAgentSession;
  scroll: { offset_from_bottom: number; max_offset_from_bottom: number; viewport_rows: number }; revision: number;
}
export interface MockWorkspace { workspace_id: string; number: number; label: string; focused: boolean; pane_count: number; tab_count: number; active_tab_id: string; agent_status: string }
export interface MockTab { tab_id: string; workspace_id: string; number: number; label: string; focused: boolean; pane_count: number; agent_status: string }
export interface MockRect { x: number; y: number; width: number; height: number }
export interface MockLayout {
  workspace_id: string; tab_id: string; zoomed: boolean; area: MockRect; focused_pane_id: string;
  panes: { pane_id: string; focused: boolean; rect: MockRect }[]; splits: unknown[];
}
export interface MockAgent {
  terminal_id: string; name: string | null; agent: string; agent_status: string; agent_session?: MockAgentSession; workspace_id: string; tab_id: string;
  pane_id: string; focused?: boolean; interactive_ready?: boolean; state_change_seq: number; cwd: string;
}
export interface MockSnapshot {
  version: number; protocol: number; focused_workspace_id: string; focused_tab_id: string; focused_pane_id: string;
  workspaces: MockWorkspace[]; tabs: MockTab[]; panes: MockPane[]; layouts: MockLayout[]; agents: MockAgent[];
}
export interface MockCall { method: string; params: Record<string, unknown>; at: number }
export interface MockSub { type: string; pane_id?: string }
interface MockTerm { sock: net.Socket; mode: string; cols: number; rows: number }
interface MockOpts { home: string; session?: string; protocol?: number; snapshot?: MockSnapshot }
/** a socket carrying the chaos write queue */
type ChaosSocket = net.Socket & { _chaosQ?: Promise<void> };
/** request params the mock understands (the wire shape our client sends; unchecked beyond being an object) */
interface Params { pane_id?: string; target?: string; subscriptions?: MockSub[]; keys?: string[]; source?: string; format?: string; mode?: string; takeover?: boolean; cols?: number; rows?: number; text?: string }
/** a request line: id/method/params are checked in `_handle` */
type Req = Record<string, unknown>;


/** Parse NDJSON from a socket; tolerates lines split anywhere (incl. mid-UTF-8). */
function lines(sock: net.Socket, fn: (m: Req) => void): void {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (d: string) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!l.trim()) continue;
      let m: Req;
      try {
        m = JSON.parse(l) as Req; // wire JSON from our own client; fields are validated in _handle
      } catch {
        sock.write(JSON.stringify({ id: '', error: { code: 'invalid_request', message: 'bad json' } }) + '\n');
        sock.end();
        continue;
      }
      fn(m);
    }
  });
}

/** A default 2-workspace fixture: scout (idle), tinker (blocked on folder trust), two shells. */
export function fixture(): MockSnapshot {
  const ws = (id: string, n: number, label: string, status: string): MockWorkspace => ({ workspace_id: id, number: n, label, focused: n === 1, pane_count: 2, tab_count: 1, active_tab_id: `${id}:t1`, agent_status: status });
  const tab = (ws: string, n: number, label: string, status: string): MockTab => ({ tab_id: `${ws}:t${n}`, workspace_id: ws, number: n, label, focused: n === 1, pane_count: 1, agent_status: status });
  const pane = (id: string, ws: string, tab: string, cwd: string, extra: Partial<MockPane> = {}): MockPane => ({ pane_id: id, terminal_id: `term_${id.replace(':', '_')}`, workspace_id: ws, tab_id: tab, focused: false, cwd,
    foreground_cwd: cwd, terminal_title: '', terminal_title_stripped: '', agent_status: 'unknown', scroll: { offset_from_bottom: 0, max_offset_from_bottom: 0, viewport_rows: 24 }, revision: 1, ...extra });
  const agent = (p: MockPane, name: string, seq: number): MockAgent => ({ terminal_id: p.terminal_id, name, agent: 'claude', agent_status: p.agent_status, agent_session: p.agent_session,
    workspace_id: p.workspace_id, tab_id: p.tab_id, pane_id: p.pane_id, focused: false, interactive_ready: true, state_change_seq: seq, cwd: p.cwd });
  const scout = pane('w1:p1', 'w1', 'w1:t1', '/home/u/claude-hq', { agent: 'claude', agent_status: 'idle', terminal_title_stripped: 'Confirmation message',
    agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 'sess-scout' } });
  const sh1 = pane('w1:p2', 'w1', 'w1:t2', '/home/u/claude-hq', { terminal_title_stripped: 'u@box: ~/claude-hq' });
  const tinker = pane('w2:p1', 'w2', 'w2:t1', '/tmp/sandbox', { agent: 'claude', agent_status: 'blocked',
    agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 'sess-tinker' } });
  const sh2 = pane('w2:p2', 'w2', 'w2:t2', '/tmp/sandbox');
  const panes = [scout, sh1, tinker, sh2];
  return {
    version: 1, protocol: 22, focused_workspace_id: 'w1', focused_tab_id: 'w1:t1', focused_pane_id: 'w1:p2',
    workspaces: [ws('w1', 1, 'hq-core', 'idle'), ws('w2', 2, 'hq-sandbox', 'blocked')],
    tabs: [tab('w1', 1, 'claude', 'idle'), tab('w1', 2, 'dev', 'unknown'), tab('w2', 1, 'claude', 'blocked'), tab('w2', 2, 'git', 'unknown')],
    panes,
    layouts: panes.map((p) => ({ workspace_id: p.workspace_id, tab_id: p.tab_id, zoomed: false, area: { x: 0, y: 0, width: 120, height: 40 },
      focused_pane_id: p.pane_id, panes: [{ pane_id: p.pane_id, focused: true, rect: { x: 0, y: 0, width: 120, height: 40 } }], splits: [] })),
    agents: [agent(scout, 'scout', 6), agent(tinker, 'tinker', 2)],
  };
}

export const TRUST_PROMPT = [
  'u@box:/tmp/sandbox$ claude', '', '────────────', ' Accessing workspace:', '', ' /tmp/sandbox', '',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to review what\'s in this folder first.', '',
  ' Security guide', '', ' ❯ No, exit', '   Yes, I trust this folder', '', ' Enter to confirm · Esc to cancel',
].join('\n');

export interface AddPaneOpts { id: string; ws?: string; tab?: string; label?: string; cwd?: string; agent?: string | null; name?: string | null; status?: string }

export class MockHerdr {
  home: string;
  session: string;
  socket: string;
  protocol: number;
  raw: MockSnapshot;
  calls: MockCall[] = [];
  conns = new Set<net.Socket>();
  subs = new Set<{ sock: net.Socket; subs: MockSub[] }>();
  /** pane → screen text (pane.read + terminal frames) */
  screens = new Map<string, { text: string; cursor?: number }>([['w2:p1', { text: TRUST_PROMPT }]]);
  terms = new Map<string, MockTerm[]>();
  server: net.Server | null = null;
  delayMs = 0;
  /**
   * Chaos (chaos harness): `{rng}` → every reply/event line is written in 1–4 byte-level pieces split at random
   * offsets (mid-UTF-8 included), each after a random 0–2 ms, so the client's NDJSON reader must reassemble them.
   */
  chaos: { rng: () => number } | null = null;
  /** the last blocked-prompt answer (`_keys`) */
  answered?: { pane: string; text: string };

  /** session 'default' → <home>/herdr.sock */
  constructor({ home, session = 'hqtest', protocol = 22, snapshot = fixture() }: MockOpts) {
    this.home = home;
    this.session = session;
    this.socket = session === 'default' ? path.join(home, 'herdr.sock') : path.join(home, 'sessions', session, 'herdr.sock');
    this.protocol = protocol;
    this.raw = snapshot;
  }

  /** Write one NDJSON line (end the socket after it when `end`), chunked when chaos is on. */
  _write(chaosSock: net.Socket, line: string, end = false): void {
    const sock: ChaosSocket = chaosSock;
    if (!sock.writable) return;
    if (!this.chaos) {
      if (end) sock.end(line);
      else sock.write(line);
      return;
    }
    const buf = Buffer.from(line);
    const r = this.chaos.rng;
    const cuts = [...new Set(Array.from({ length: Math.floor(r() * 4) }, () => 1 + Math.floor(r() * (buf.length - 1))))].sort((a, b) => a - b);
    const parts: Buffer[] = [];
    let at = 0;
    for (const c of [...cuts, buf.length]) {
      if (c > at) parts.push(buf.subarray(at, c));
      at = c;
    }
    // sequential, so pieces never reorder; chaos lines of one socket are serialised by the per-socket queue
    const q = (sock._chaosQ ??= Promise.resolve());
    sock._chaosQ = q.then(async () => {
      for (const part of parts) {
        await new Promise<void>((res) => setTimeout(res, Math.floor(r() * 3)));
        if (!sock.writable) return;
        sock.write(part);
      }
      if (end && sock.writable) sock.end();
    });
  }

  /** Every status/structural subscription connection ends (EOF) while the server stays up. */
  dropSubscriptions(): void {
    for (const s of [...this.subs]) s.sock.end();
    this.subs.clear();
  }

  static async start(o: MockOpts): Promise<MockHerdr> {
    const m = new MockHerdr(o);
    await m.listen();
    return m;
  }

  listen(): Promise<void> {
    fs.mkdirSync(path.dirname(this.socket), { recursive: true });
    try {
      fs.unlinkSync(this.socket);
    } catch {}
    this.server = net.createServer((sock) => this._conn(sock));
    const server = this.server;
    return new Promise((r) => server.listen(this.socket, () => r()));
  }

  /** Methods logged, optionally filtered. */
  methods(filter: (c: MockCall) => boolean = () => true): string[] {
    return this.calls.filter(filter).map((c) => c.method);
  }

  _conn(sock: net.Socket): void {
    this.conns.add(sock);
    sock.on('close', () => {
      this.conns.delete(sock);
      for (const s of this.subs) if (s.sock === sock) this.subs.delete(s);
      for (const [id, list] of this.terms) this.terms.set(id, list.filter((t) => t.sock !== sock));
    });
    sock.on('error', () => {});
    let first = true;
    lines(sock, (m) => {
      if (!first && m.method !== 'fake.term.input' && m.method !== 'fake.term.resize') return; // one request per connection
      first = false;
      this._handle(sock, m);
    });
  }

  _reply(sock: net.Socket, id: string, result: unknown): void {
    const go = () => this._write(sock, JSON.stringify({ id, result }) + '\n', true);
    if (this.delayMs) setTimeout(go, this.delayMs);
    else go();
  }
  _error(sock: net.Socket, id: string, code: string, message = code): void {
    this._write(sock, JSON.stringify({ id, error: { code, message } }) + '\n', true);
  }

  pane(id: unknown): MockPane | null {
    return this.raw.panes.find((p) => p.pane_id === id) ?? null;
  }
  agent(id: string): MockAgent | null {
    return this.raw.agents.find((a) => a.pane_id === id) ?? null;
  }

  _handle(sock: net.Socket, m: Req): void {
    const { id, method } = m;
    const params = m.params as Params | null | undefined; // typeof-checked below
    if (typeof id !== 'string' || typeof method !== 'string' || !params || typeof params !== 'object') {
      return this._error(sock, '', 'invalid_request', 'missing field');
    }
    if (!method.startsWith('fake.term.')) this.calls.push({ method, params: { ...clone(params) }, at: Date.now() });
    const p = this.pane(params.pane_id ?? params.target);
    const needPane = (): void => this._error(sock, id, 'pane_not_found', `pane ${params.pane_id ?? params.target} not found`);
    switch (method) {
      case 'ping':
        return this._reply(sock, id, { type: 'pong', version: '0.9.0-mock', protocol: this.protocol, capabilities: {} });
      case 'session.snapshot':
        return this._reply(sock, id, { type: 'session_snapshot', snapshot: clone(this.raw) });
      case 'events.subscribe': {
        const subs = params.subscriptions ?? [];
        for (const s of subs) {
          if (s.pane_id && !this.pane(s.pane_id)) return this._error(sock, 'sub', 'pane_not_found', `pane ${s.pane_id} not found`);
        }
        this.subs.add({ sock, subs });
        return this._write(sock, JSON.stringify({ id, result: { type: 'subscription_started' } }) + '\n');
      }
      case 'pane.get':
        if (!p) return needPane();
        return this._reply(sock, id, { type: 'pane_info', pane: clone(p) });
      case 'pane.read': {
        if (!p) return needPane();
        const text = this.screens.get(p.pane_id)?.text ?? `${p.cwd}$ `;
        return this._reply(sock, id, { type: 'pane_read', read: { pane_id: p.pane_id, source: params.source, format: params.format, text, revision: p.revision, truncated: false } });
      }
      case 'pane.process_info':
        if (!p) return needPane();
        return this._reply(sock, id, { type: 'process_info', process_info: { shell_pid: 1, foreground_process_group_id: 1, foreground_processes: [{ pid: 1, name: 'bash', argv: ['bash'], cmdline: 'bash', cwd: p.cwd }] } });
      case 'agent.list':
        return this._reply(sock, id, { type: 'agent_list', agents: clone(this.raw.agents) });
      case 'agent.get':
      case 'agent.explain':
        if (!p) return needPane();
        return this._reply(sock, id, { type: method === 'agent.get' ? 'agent_info' : 'agent_explain', agent: clone(this.agent(p.pane_id)),
          explain: { agent: p.agent ?? null, state: p.agent_status, matched_rule: { id: `mock_${p.agent_status}`, priority: 1, region: 'screen', state: p.agent_status },
            evaluated_rules: [{ id: `mock_${p.agent_status}`, matched: true, state: p.agent_status, region: 'screen', priority: 1,
              evidence: { region_preview: this.screens.get(p.pane_id)?.text?.slice(0, 200) ?? '' } }] } });
      case 'pane.send_keys':
        if (!p) return needPane();
        this._keys(p, params.keys ?? []);
        return this._reply(sock, id, { type: 'ok' });
      case 'agent.prompt':
        if (!p) return needPane();
        if (p.agent_status === 'blocked') return this._error(sock, id, 'agent_blocked', 'agent is blocked');
        return this._reply(sock, id, { type: 'ok' });
      case 'pane.focus':
        if (!p) return needPane();
        this.raw.focused_pane_id = p.pane_id;
        if (p.agent_status === 'done') this.setStatus(p.pane_id, 'idle');
        return this._reply(sock, id, { type: 'ok' });
      case 'workspace.create':
      case 'tab.create':
        return this._reply(sock, id, { type: 'created', root_pane: { pane_id: 'w9:p1' } });
      case 'pane.close':
      case 'agent.start':
      case 'agent.stop':
      case 'pane.run':
      case 'pane.split':
      case 'workspace.close':
      case 'tab.close':
        return this._reply(sock, id, { type: 'ok' });
      case 'fake.term.attach':
        return this._attach(sock, id, params);
      case 'fake.term.input':
        return this._termInput(sock, params);
      case 'fake.term.resize':
        return this._termResize(sock, params);
      default:
        return this._error(sock, '', 'invalid_request', `unknown method ${method}`);
    }
  }

  // ------------------------------------------------------------------ terminals (fake bin)

  _attach(sock: net.Socket, id: string, { pane_id = '', mode = 'observe', takeover, cols = 80, rows = 24 }: Params): void {
    const p = this.pane(pane_id);
    if (!p) return this._error(sock, id, 'not_found', `terminal session ${mode} failed: terminal target ${pane_id} not found`);
    const list = this.terms.get(pane_id) ?? [];
    if (mode === 'control') {
      const cur = list.find((t) => t.mode === 'control');
      if (cur && !takeover) return this._error(sock, id, 'busy', `terminal attach failed: terminal ${p.terminal_id} already has an attached client; retry with --takeover`);
      if (cur) {
        cur.sock.write(JSON.stringify({ type: 'closed', reason: 'terminal attach taken over' }) + '\n');
        this.terms.set(pane_id, list.filter((t) => t !== cur));
      }
      p.scroll.viewport_rows = rows; // control resizes the PTY
    }
    const t = { sock, mode, cols, rows };
    this.terms.set(pane_id, [...(this.terms.get(pane_id) ?? []), t]);
    sock.write(JSON.stringify({ id, result: { type: 'attached' } }) + '\n');
    this._frame(t, pane_id, true);
  }

  _frame(t: MockTerm, paneId: string, full: boolean): void {
    const text = this.screens.get(paneId)?.text ?? `${this.pane(paneId)?.cwd ?? ''}$ `;
    t.sock.write(JSON.stringify({ type: 'frame', full, cols: t.cols, rows: t.rows, text: full ? `\x1b[2J\x1b[H${text.replace(/\n/g, '\r\n')}` : text }) + '\n');
  }

  _termInput(sock: net.Socket, { pane_id = '', text = '' }: Params): void {
    const t = (this.terms.get(pane_id) ?? []).find((x) => x.sock === sock);
    if (!t || t.mode !== 'control') return; // observe ignores input
    const s = this.screens.get(pane_id) ?? { text: `${this.pane(pane_id)?.cwd ?? ''}$ ` };
    s.text += text;
    this.screens.set(pane_id, s);
    for (const v of this.terms.get(pane_id) ?? []) v.sock.write(JSON.stringify({ type: 'frame', full: false, text: text.replace(/\r/g, '\r\n') }) + '\n');
  }

  _termResize(sock: net.Socket, { pane_id = '', cols = 80, rows = 24 }: Params): void {
    const t = (this.terms.get(pane_id) ?? []).find((x) => x.sock === sock);
    if (!t || t.mode !== 'control') return;
    t.cols = cols;
    t.rows = rows;
    const p = this.pane(pane_id);
    if (p) p.scroll.viewport_rows = rows;
    this._frame(t, pane_id, true);
  }

  /** Terminal children currently attached (from the mock's view). */
  attached(paneId: string): { mode: string; cols: number; rows: number }[] {
    return (this.terms.get(paneId) ?? []).map((t) => ({ mode: t.mode, cols: t.cols, rows: t.rows }));
  }

  // ------------------------------------------------------------------ scripting

  _keys(p: MockPane, keys: string[]): void {
    const s = this.screens.get(p.pane_id);
    if (p.agent_status !== 'blocked' || !s) return;
    for (const k of keys) {
      if (k === 'Down' || k === 'Up') {
        // move the ❯ cursor in the trust prompt
        const ls = s.text.split('\n');
        const opts = ls.map((l, i) => ({ l, i })).filter(({ l }) => /^ {1,3}(❯ |  )\S/.test(l) && !/Enter to/.test(l));
        const cur = opts.findIndex(({ l }) => l.includes('❯'));
        const next = Math.max(0, Math.min(opts.length - 1, cur + (k === 'Down' ? 1 : -1)));
        if (cur >= 0 && next !== cur) {
          const from = opts[cur]!.i, to = opts[next]!.i; // cur/next index into opts (cur >= 0, next clamped)
          ls[from] = ls[from]!.replace('❯ ', '  ');
          ls[to] = ls[to]!.replace(/^( {1,3}) {2}/, '$1❯ ');
          s.text = ls.join('\n');
        }
      } else if (k === 'Enter' || /^\d$/.test(k)) {
        this.answered = { pane: p.pane_id, text: s.text };
        this.screens.set(p.pane_id, { text: '> ' });
        this.setStatus(p.pane_id, 'idle');
        return;
      }
    }
  }

  _broadcast(type: string, data: Record<string, unknown>): void {
    const ev = type.replace(/\./g, '_');
    for (const s of this.subs) {
      if (!s.subs.some((x) => x.type === type && (!x.pane_id || x.pane_id === data.pane_id))) continue;
      const isStatus = type === 'pane.agent_status_changed';
      this._write(s.sock, JSON.stringify({ event: isStatus ? type : ev, data: { type: isStatus ? type : ev, ...data } }) + '\n');
    }
  }

  /** Change an agent pane's status: bump state_change_seq, fire the per-pane status subscription. */
  setStatus(id: string, status: string): void {
    const p = this.pane(id);
    const a = this.agent(id);
    if (!p) throw new Error(`no pane ${id}`);
    p.agent_status = status;
    if (a) {
      a.agent_status = status;
      a.state_change_seq++;
    }
    p.revision++;
    this._rollup();
    this._broadcast('pane.agent_status_changed', { pane_id: id, workspace_id: p.workspace_id, agent: p.agent ?? null, agent_status: status });
  }

  _rollup(): void {
    const order = ['blocked', 'working', 'done', 'idle', 'unknown'];
    const roll = (ps: MockPane[]): string => order.find((s) => ps.some((p) => p.agent_status === s)) ?? 'unknown';
    for (const t of this.raw.tabs) t.agent_status = roll(this.raw.panes.filter((p) => p.tab_id === t.tab_id));
    for (const w of this.raw.workspaces) w.agent_status = roll(this.raw.panes.filter((p) => p.workspace_id === w.workspace_id));
  }

  /** Add a pane (and its tab/layout) to an existing workspace; fires pane_created. */
  addPane({ id, ws = 'w1', tab, label = 'new', cwd = '/tmp', agent = null, name = null, status = 'unknown' }: AddPaneOpts): MockPane {
    const tabId = tab ?? `${ws}:t${this.raw.tabs.filter((t) => t.workspace_id === ws).length + 1}`;
    if (!this.raw.tabs.some((t) => t.tab_id === tabId)) {
      this.raw.tabs.push({ tab_id: tabId, workspace_id: ws, number: this.raw.tabs.filter((t) => t.workspace_id === ws).length + 1, label, focused: false, pane_count: 1, agent_status: status });
    }
    const p: MockPane = { pane_id: id, terminal_id: `term_${id.replace(':', '_')}`, workspace_id: ws, tab_id: tabId, focused: false, cwd, foreground_cwd: cwd,
      terminal_title_stripped: '', agent_status: status, scroll: { offset_from_bottom: 0, max_offset_from_bottom: 0, viewport_rows: 24 }, revision: 1,
      ...(agent ? { agent, agent_session: { source: 'herdr:claude', agent, kind: 'id', value: `sess-${id}` } } : {}) };
    this.raw.panes.push(p);
    if (agent) this.raw.agents.push({ terminal_id: p.terminal_id, name, agent, agent_status: status, agent_session: p.agent_session, workspace_id: ws, tab_id: tabId, pane_id: id, state_change_seq: 1, cwd });
    this.raw.layouts.push({ workspace_id: ws, tab_id: tabId, zoomed: false, area: { x: 0, y: 0, width: 100, height: 30 }, focused_pane_id: id, panes: [{ pane_id: id, focused: true, rect: { x: 0, y: 0, width: 100, height: 30 } }], splits: [] });
    this._rollup();
    this._broadcast('pane.created', { pane: clone(p) });
    return p;
  }

  /** Remove a pane; fires pane_closed; attached terminals get "not found". */
  removePane(id: string): void {
    const p = this.pane(id);
    if (!p) return;
    this.raw.panes = this.raw.panes.filter((x) => x !== p);
    this.raw.agents = this.raw.agents.filter((a) => a.pane_id !== id);
    this.raw.layouts = this.raw.layouts.map((l) => ({ ...l, panes: l.panes.filter((x) => x.pane_id !== id) })).filter((l) => l.panes.length);
    for (const t of this.terms.get(id) ?? []) t.sock.write(JSON.stringify({ type: 'closed', reason: `terminal attach ended: terminal ${p.terminal_id} not found` }) + '\n');
    this.terms.delete(id);
    this._broadcast('pane.closed', { pane_id: id, workspace_id: p.workspace_id });
    for (const s of [...this.subs]) if (s.subs.some((x) => x.pane_id === id)) s.sock.destroy();
  }

  /** Stop the server: every connection ends (EOF), like `herdr session stop`. */
  async stop(): Promise<void> {
    for (const c of this.conns) c.destroy();
    this.conns.clear();
    this.subs.clear();
    this.terms.clear();
    const server = this.server;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    this.server = null;
    try {
      fs.unlinkSync(this.socket);
    } catch {}
  }

  /** Restart; `rekey` renumbers every pane id (herdr restore re-runs `claude --resume`) but keeps agent sessions. */
  async restart({ rekey = false }: { rekey?: boolean } = {}): Promise<void> {
    if (rekey) {
      const map = new Map(this.raw.panes.map((p) => [p.pane_id, p.pane_id.replace(/:p(\d+)$/, (_, n) => `:p${Number(n) + 10}`)]));
      const re = (id: string): string => map.get(id) ?? id;
      for (const p of this.raw.panes) {
        p.pane_id = re(p.pane_id);
        p.terminal_id = `${p.terminal_id}_r`;
      }
      for (const a of this.raw.agents) {
        a.pane_id = re(a.pane_id);
        a.terminal_id = `${a.terminal_id}_r`;
      }
      for (const l of this.raw.layouts) for (const p of l.panes) p.pane_id = re(p.pane_id);
      this.raw.focused_pane_id = re(this.raw.focused_pane_id);
      this.screens = new Map([...this.screens].map(([k, v]) => [re(k), v]));
    }
    await this.listen();
  }

  async close(): Promise<void> {
    await this.stop();
  }
}
