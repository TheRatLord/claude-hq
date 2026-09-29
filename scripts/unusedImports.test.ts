// Lint (CORE m2 fix r3): every imported binding must be used in its module.
// Parses `import a, { b, c as d } from '…'` / `import * as ns from '…'` in the repo's own JS and fails when a local
// binding never appears again outside import statements and comments. Re-exports (`export { x } from '…'`) bind
// nothing locally and are skipped. Heuristic, not a parser: string contents still count as uses (so a name only
// mentioned inside a string is missed); that errs toward silence, never a false failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['renderer/src', 'renderer/index.html', 'server', 'shared', 'scripts', 'electron'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function* walk(p: string): Generator<string> {
  const st = fs.statSync(p);
  if (st.isFile()) { if (/\.c?ts$/.test(p)) yield p; return; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const q = path.join(p, e.name);
    if (e.isDirectory()) yield* walk(q);
    else if (/\.c?ts$/.test(e.name)) yield q;
  }
}

/** Strip block + line comments (line comments only when `//` isn't part of a URL-ish `:` or a regex/string edge). */
function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\/])\/\/[^\n]*/g, '$1');
}

const IMPORT_RE = /(^|[;\n])\s*import\s+([^'"`;]*?)\s+from\s*(['"])[^'"]+\3\s*;?/g;

/** Local bindings introduced by import statements. */
export function importBindings(src: string): { name: string; clause: string }[] {
  const out: { name: string; clause: string }[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    let clause = m[2].trim();
    if (clause.startsWith('type ')) continue;
    const braces = /\{([\s\S]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const t = part.trim().replace(/^type\s+/, ''); // `import { a, type B }`: B is a binding too
        if (!t) continue;
        const as = /\bas\s+([\w$]+)$/.exec(t);
        out.push({ name: as ? as[1] : t, clause: m[0].trim() });
      }
      clause = clause.replace(braces[0], '');
    }
    const ns = /\*\s*as\s+([\w$]+)/.exec(clause);
    if (ns) { out.push({ name: ns[1], clause: m[0].trim() }); clause = clause.replace(ns[0], ''); }
    const def = /^\s*([\w$]+)\s*,?\s*$/.exec(clause);
    if (def) out.push({ name: def[1], clause: m[0].trim() });
  }
  return out;
}

export function unusedImports(src: string) {
  const code = stripComments(src);
  const body = code.replace(IMPORT_RE, '$1');
  const esc = (s: string) => s.replace(/\$/g, '\\$');
  return importBindings(code).filter(({ name }) => !new RegExp(`(^|[^\\w$.]|\\.\\.\\.)${esc(name)}(?![\\w$])`).test(body))
    .map((b) => b.name);
}

test('unusedImports: detects named/default/namespace, honours aliases, skips re-exports', () => {
  const src = [
    "import { a, b as bee, c } from './x.ts';",
    "import def from './d.ts';",
    "import { spread } from './s.ts';",
    "import * as ns from './n.ts';",
    "import { kept, type Kind, type Gone } from './k.ts';",
    "export { z } from './z.ts';",
    'import {',
    '  multi,',
    '  line,',
    "} from './m.ts';",
    '// a c multi (comments do not count)',
    'const y: Kind = bee + def + ns.q + `${line}` + kept;',
    'const z = [...spread];',
    'obj.c = 1;',
  ].join('\n');
  assert.deepEqual(unusedImports(src).sort(), ['Gone', 'a', 'c', 'multi']);
});

test('no unused imports in the repo', () => {
  const bad: string[] = [];
  for (const root of ROOTS) {
    const abs = path.join(REPO, root);
    if (!fs.existsSync(abs)) continue;
    for (const f of walk(abs)) {
      const names = unusedImports(fs.readFileSync(f, 'utf8'));
      if (names.length) bad.push(`${path.relative(REPO, f)}: ${names.join(', ')}`);
    }
  }
  assert.deepEqual(bad, [], `unused imports:\n  ${bad.join('\n  ')}`);
});
