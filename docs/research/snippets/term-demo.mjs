// Smoke test: node docs/research/snippets/term-demo.mjs [target=w3:p3] [session=hqtest]
import { openTerminal, request, socketFor, subscribe } from './herdr.mjs';
const target = process.argv[2] || 'w3:p3', session = process.argv[3] || 'hqtest';
const sock = socketFor(session);
console.log('ping', (await request(sock, 'ping')).version);
const sub = await subscribe(sock, [{ type: 'pane.updated' }, { type: 'layout.updated' }], (e) => console.log('event', e.event));
let bytes = 0, frames = 0, sawEcho = false;
const t = openTerminal({ session, target, cols: 90, rows: 25,
  onBytes: (b) => { frames++; bytes += b.length; if (b.toString().includes('HQ-OK-42')) sawEcho = true; },
  onClosed: (r) => { console.log('closed:', r, { frames, bytes, sawEcho }); sub.destroy(); process.exit(sawEcho ? 0 : 1); } });
setTimeout(() => t.input('echo HQ-OK-$((6*7))\r'), 500);
setTimeout(() => t.resize(110, 30), 1000);
setTimeout(() => t.release(), 1800);
