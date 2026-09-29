// Reference herdr client (verified against herdr 0.9.0 / protocol 22). Plain Node, no deps.
//   request(): one NDJSON request per unix-socket connection (server closes after the reply).
//   subscribe(): long-lived connection streaming event envelopes.
//   openTerminal(): `herdr terminal session control|observe` child; NDJSON over pipes, no PTY needed.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const HERDR_BIN = process.env.HERDR_BIN_PATH || path.join(os.homedir(), '.local/bin/herdr');
export const socketFor = (session) => !session || session === 'default'
  ? path.join(os.homedir(), '.config/herdr/herdr.sock')
  : path.join(os.homedir(), '.config/herdr/sessions', session, 'herdr.sock');

// NDJSON line splitter for any readable stream.
export function lines(stream, onMsg) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (l.trim()) { try { onMsg(JSON.parse(l)); } catch { /* skip */ } }
    }
  });
}

let seq = 0;
export function request(sock, method, params = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const id = `hq_${++seq}`;
    const s = net.createConnection(sock);
    const done = (err, val) => { clearTimeout(t); s.destroy(); err ? reject(err) : resolve(val); };
    const t = setTimeout(() => done(new Error(`herdr ${method}: timeout`)), timeoutMs);
    s.on('error', (e) => done(e));
    s.on('close', () => done(new Error(`herdr ${method}: closed without reply`)));
    s.on('connect', () => s.write(JSON.stringify({ id, method, params }) + '\n'));
    // Parse errors come back with id "" -> accept any first line.
    lines(s, (m) => m.error
      ? done(Object.assign(new Error(m.error.message), { code: m.error.code }))
      : done(null, m.result));
  });
}

// subscriptions: [{type:'pane.created'}, {type:'pane.agent_status_changed', pane_id:'w1:p1'}, ...]
// Resolves with the socket after {"result":{"type":"subscription_started"}}; onEvent({event, data}).
export function subscribe(sock, subscriptions, onEvent, onClose) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(sock);
    let started = false;
    s.on('error', (e) => { if (!started) reject(e); });
    s.on('close', () => { if (started) onClose?.(); });
    s.on('connect', () => s.write(JSON.stringify({ id: 'sub', method: 'events.subscribe', params: { subscriptions } }) + '\n'));
    lines(s, (m) => {
      if (!started) {
        if (m.error) { s.destroy(); return reject(Object.assign(new Error(m.error.message), { code: m.error.code })); }
        started = true; return resolve(s);
      }
      onEvent(m);
    });
  });
}

// Terminal stream for xterm.js. mode: 'control' (single writer; takeover kicks the previous controller)
// or 'observe' (read-only, unlimited). target: pane id ("w1:p2"), terminal id, or agent name.
// Callbacks: onBytes(Uint8Array ansi, frame), onClosed(reason).
export function openTerminal({ session, target, mode = 'control', cols = 100, rows = 30, takeover = false, onBytes, onClosed }) {
  const env = { ...process.env };
  for (const k of ['HERDR_SOCKET_PATH', 'HERDR_SESSION', 'HERDR_PANE_ID', 'HERDR_TAB_ID', 'HERDR_WORKSPACE_ID']) delete env[k];
  const args = [...(session ? ['--session', session] : []), 'terminal', 'session', mode, target,
    '--cols', String(cols), '--rows', String(rows), ...(takeover && mode === 'control' ? ['--takeover'] : [])];
  // stdin MUST stay open: EOF on stdin makes the child detach immediately.
  const child = spawn(HERDR_BIN, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let closed = false;
  const close = (reason) => { if (!closed) { closed = true; onClosed?.(reason); } };
  lines(child.stdout, (m) => {
    if (m.type === 'terminal.frame') onBytes?.(Buffer.from(m.bytes, 'base64'), m);
    else if (m.type === 'terminal.closed') close(m.reason);
  });
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.on('exit', () => close('exited'));
  child.on('error', (e) => close(e.message));
  const send = (o) => { if (!closed) child.stdin.write(JSON.stringify(o) + '\n'); };
  return {
    child,
    input: (text) => send({ type: 'terminal.input', text }),                      // utf8 text incl. control chars
    inputBytes: (buf) => send({ type: 'terminal.input', bytes: Buffer.from(buf).toString('base64') }),
    resize: (c, r) => send({ type: 'terminal.resize', cols: c, rows: r }),          // control only; resizes the pane PTY
    scroll: (direction, n) => send({ type: 'terminal.scroll', direction, lines: n }), // 'up'|'down'
    // Graceful detach. A TUI client (if attached) snaps the pane back to its layout size on any detach.
    release: () => { send({ type: 'terminal.release' }); setTimeout(() => child.kill(), 1000).unref(); },
  };
}
