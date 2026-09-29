#!/usr/bin/env node
// One-shot mechanical JS -> TS rename (already applied; kept for the record / reproducibility on a clean baseline).
//   node docs/port/rename.mjs [--dry]
// 1. git mv every .js/.mjs (-> .ts) and .cjs (-> .cts) under shared/ server/ electron/ scripts/ renderer/src/ + vite.config.js
// 2. rewrite relative import / export-from / dynamic-import('...') / new URL('...', import.meta.url) specifiers
// 3. rewrite the fixed list of path strings below (package.json scripts, spawn paths, walkers, tests)
// 4. verify every relative specifier resolves to a file. Behaviour is untouched: no types are added here.
// Prerequisite found while running it: .gitignore's `build/` hid renderer/src/world/build/ (47 files), so it is changed
// to `/build/` and the dir `git add`ed first (the script only renames tracked files).
// Hand edits applied after the script (path strings it cannot know are real vs demo data): package.json test/serve/doctor/
// main/start scripts, renderer/index.html script tag, `\.m?js$` file walkers in tests (seams, kit, audio, clock, callpaths,
// unusedImports), server/config.ts staleness scan, scripts/dev.ts (server + vite config paths), scripts/walktimes.ts,
// wp-briefs contract list, ui/kit/lint.ts allow-lists, `<script>.mjs` names in usage strings; then `npm run briefs`.
// electron/preload.cjs became preload.cts (compiled by tsconfig.preload.json, see docs/port/GUIDE.md).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const DRY = process.argv.includes('--dry');
const DIRS = ['shared', 'server', 'electron', 'scripts', 'renderer/src'];
const sh = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const tracked = sh('ls-files', '-z').split('\0').filter(Boolean);
const isSrc = (f) => /\.(js|mjs|cjs)$/.test(f) && (f === 'vite.config.js' || DIRS.some((d) => f.startsWith(d + '/')));
const newName = (f) => f.replace(/\.(m?js)$/, '.ts').replace(/\.cjs$/, '.cts');
const renamed = new Map(tracked.filter(isSrc).map((f) => [f, newName(f)]));

// ---- 1. content rewrites (before the move so paths are still the old ones) -------------------------------------
const CTX = String.raw`(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bnew URL\(\s*|\bglob\(\s*\[?\s*)`;
const SPEC = new RegExp(`${CTX}(['"])(\\.{1,2}/[^'"\`\\n]*?\\.(?:m?js|cjs))\\2`, 'g');
const toExt = (s) => s.replace(/\.(m?js)$/, '.ts').replace(/\.cjs$/, '.cts');
const fixSpecs = (src) => src.replace(SPEC, (_m, ctx, q, spec) => `${ctx}${q}${toExt(spec)}${q}`);

// Fixed extra string rewrites: [file, from, to] (exact, must occur; the script fails loudly otherwise).
const EXTRA = [
  ['package.json', '"main": "electron/main.js"', '"main": "electron/main.ts"'],
];
const edits = new Map(); // file -> new content
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
for (const f of renamed.keys()) {
  const s = read(f), t = fixSpecs(s);
  if (s !== t) edits.set(f, t);
}
for (const [f, a, b] of EXTRA) {
  const s = edits.get(f) ?? read(f);
  if (s.includes(b)) continue; // already applied (re-run)
  if (!s.includes(a)) throw new Error(`EXTRA: ${f} lacks ${JSON.stringify(a)}`);
  edits.set(f, s.split(a).join(b));
}

if (DRY) { console.log(`${renamed.size} renames, ${edits.size} content edits`); process.exit(0); }
for (const [f, t] of edits) fs.writeFileSync(path.join(ROOT, f), t);
for (const [a, b] of renamed) sh('mv', a, b);

// ---- 2. verify -------------------------------------------------------------------------------------------------
const bad = [];
for (const b of renamed.values()) {
  const s = read(b);
  for (const m of s.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"`\n]+)\1/g)) {
    const p = path.join(path.dirname(path.join(ROOT, b)), m[2]);
    if (!fs.existsSync(p) && !/\.(css|json)$/.test(p)) bad.push(`${b}: ${m[2]}`);
  }
}
if (bad.length) { console.error('UNRESOLVED specifiers:\n' + bad.join('\n')); process.exit(1); }
console.log(`renamed ${renamed.size} files, ${edits.size} content edits`);
