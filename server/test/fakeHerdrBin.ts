#!/usr/bin/env node
/**
 * Fake `herdr` binary for tests (HERDR_BIN_PATH). Only `--session S terminal session {observe|control} <pane>
 * --cols C --rows R [--takeover]` is implemented; it attaches through the MockHerdr socket resolved exactly like
 * server/herdr/resolve.ts (HQ_HERDR_HOME), so a wrong `--session` fails. Behaves like herdr 0.9.0:
 *   - NDJSON `terminal.frame` (base64 ansi, full flag) / `terminal.closed {reason}` on stdout; exit code always 0
 *   - control: stdin `terminal.input|resize|scroll|release`; release or stdin EOF → closed "detached", exit
 *   - observe: ignores input, release AND stdin EOF (only a signal ends it)
 * Every invocation appends `{argv, instance, session, pid}` to $FAKE_HERDR_LOG.
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
if (process.env.FAKE_HERDR_LOG) {
  fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify({ argv, instance: process.env.CLAUDE_HQ_INSTANCE ?? null,
    session: process.env.CLAUDE_HQ_SESSION ?? null, herdrEnv: Object.keys(process.env).filter((k) => k.startsWith('HERDR_')), pid: process.pid }) + '\n');
}
const out = (o: object): boolean => process.stdout.write(JSON.stringify(o) + '\n');
let session = 'default';
let i = 0;
if (argv[0] === '--session') {
  session = argv[1] ?? 'default';
  i = 2;
}
if (argv[i] !== 'terminal' || argv[i + 1] !== 'session') {
  process.stderr.write(`fake herdr: unsupported ${argv.join(' ')}\n`);
  process.exit(0);
}
const mode = argv[i + 2];
const pane = argv[i + 3];
const opt = (k: string, d: number): number => {
  const j = argv.indexOf(k);
  return j >= 0 ? Number(argv[j + 1]) : d;
};
const cols = opt('--cols', 80), rows = opt('--rows', 24);
const takeover = argv.includes('--takeover');
const home = process.env.HQ_HERDR_HOME || path.join(os.homedir(), '.config', 'herdr');
const sock = session === 'default' ? path.join(home, 'herdr.sock') : path.join(home, 'sessions', session, 'herdr.sock');

let closed = false;
const close = (reason: string): void => {
  if (closed) return;
  closed = true;
  out({ type: 'terminal.closed', reason });
  setTimeout(() => process.exit(0), 20);
};
const s = net.createConnection(sock);
s.on('error', (e) => close(`terminal session ${mode} failed: ${e.message}`));
s.on('close', () => {
  if (mode === 'control') close('terminal attach ended: server closed');
  else if (!closed) setTimeout(() => process.exit(0), 20);
});
let seq = 0;
s.on('connect', () => s.write(JSON.stringify({ id: 'att', method: 'fake.term.attach', params: { pane_id: pane, mode, takeover, cols, rows } }) + '\n'));
let buf = '';
s.setEncoding('utf8');
s.on('data', (d) => {
  buf += d;
  for (let k; (k = buf.indexOf('\n')) >= 0;) {
    const m = JSON.parse(buf.slice(0, k));
    buf = buf.slice(k + 1);
    if (m.error) close(m.error.message);
    else if (m.type === 'frame') {
      const w = m.cols ?? cols, h = m.rows ?? rows;
      out({ type: 'terminal.frame', encoding: 'ansi', full: !!m.full, seq: ++seq, width: w, height: h,
        bytes: Buffer.from(`\x1b[?2026h${m.text}\x1b[?2026l`).toString('base64') });
    } else if (m.type === 'closed') close(m.reason);
  }
});

let ib = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  ib += d;
  for (let k; (k = ib.indexOf('\n')) >= 0;) {
    const m = JSON.parse(ib.slice(0, k));
    ib = ib.slice(k + 1);
    if (mode !== 'control') continue; // observe ignores everything, even release
    if (m.type === 'terminal.input') {
      const text = m.text ?? Buffer.from(m.bytes ?? '', 'base64').toString('utf8');
      s.write(JSON.stringify({ id: 'in', method: 'fake.term.input', params: { pane_id: pane, text } }) + '\n');
    } else if (m.type === 'terminal.resize') s.write(JSON.stringify({ id: 'rz', method: 'fake.term.resize', params: { pane_id: pane, cols: m.cols, rows: m.rows } }) + '\n');
    else if (m.type === 'terminal.release') close('terminal session detached');
  }
});
process.stdin.on('end', () => {
  if (mode === 'control') close('terminal session detached');
});
process.on('SIGTERM', () => process.exit(0));
