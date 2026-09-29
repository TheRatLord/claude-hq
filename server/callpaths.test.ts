/**
 * Herdr call-path lint (M1 exit "every herdr call path signed off", kept true by a test; carryover idea). Owner: BE.
 * Only `server/herdr/client.ts` may open the herdr socket or spawn a process, and nobody outside it calls the
 * allowlist-bypassing `_raw()`. Everything else goes through HerdrClient.request/subscribe/spawnTerm (§4.1), whose
 * method allowlist + default-session gate are then the single choke point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLIENT = 'server/herdr/client.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name !== 'node_modules' && d.name !== 'fixtures') walk(p, out);
    } else if (/\.ts$/.test(d.name) && !/\.test\.ts$/.test(d.name)) out.push(p);
  }
  return out;
}

test('only herdr/client.ts opens the herdr socket, spawns herdr or calls _raw()', () => {
  const files = [...walk(path.join(ROOT, 'server')), path.join(ROOT, 'electron/main.ts')]
    .map((f) => path.relative(ROOT, f))
    .filter((f) => !f.startsWith('server/test/')); // the mock herdr + fake bin ARE the other end of the socket
  const bad: string[] = [];
  for (const f of files) {
    if (f === CLIENT) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((l, i) => {
      if (/^\s*(\*|\/\/)/.test(l)) return; // comments / JSDoc
      if (/^\s*import type\b/.test(l)) return; // a type-only import is erased: it opens nothing
      if (/\bfrom ['"]node:child_process['"]|require\(['"](node:)?child_process['"]\)/.test(l)) bad.push(`${f}:${i + 1} imports child_process`);
      if (/\._raw\(/.test(l)) bad.push(`${f}:${i + 1} calls _raw()`);
      if (/\bnet\.(createConnection|connect)\(|\bfrom ['"]node:net['"]/.test(l)) bad.push(`${f}:${i + 1} opens a raw socket`);
    });
  }
  assert.deepEqual(bad, [], 'herdr call paths outside server/herdr/client.ts');
});
