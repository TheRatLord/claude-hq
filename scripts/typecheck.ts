#!/usr/bin/env node
// Runs every tsc project (no emit) and reports per project: node (shared/ server/ scripts/ electron/), renderer, test, experiments,
// preload. Exit 1 if any project has errors. Extra args are passed to each tsc (e.g. --pretty).
//   node scripts/typecheck.ts                 all projects, one summary line each
//   node scripts/typecheck.ts --dirs          plus a per-directory error table (unique file:line:col errors)
// Check just your files: npx tsc -p tsconfig.renderer.json | grep '^renderer/src/ui/'
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const TSC = path.join(REPO, 'node_modules/.bin/tsc');
const PROJECTS = ['node', 'renderer', 'test', 'preload', 'experiments'] as const;
const args = process.argv.slice(2);
const dirs = args.includes('--dirs');
const extra = args.filter((a) => a !== '--dirs');

const all = new Set<string>();
const covered = new Set<string>();
let failed = false;
for (const p of PROJECTS) {
  const listed = spawnSync(TSC, ['-p', `tsconfig.${p}.json`, '--listFilesOnly'], { cwd: REPO, encoding: 'utf8' });
  for (const f of listed.stdout.split('\n')) if (f.startsWith(REPO) && !f.includes('/node_modules/')) covered.add(path.relative(REPO, f));

  const r = spawnSync(TSC, ['-p', `tsconfig.${p}.json`, '--noEmit', '--pretty', 'false', ...extra], { cwd: REPO, encoding: 'utf8' });
  const lines = r.stdout.split('\n').filter((l) => /: error TS\d+:/.test(l));
  for (const l of lines) all.add(l);
  console.log(`${p.padEnd(12)} ${lines.length} error(s)`);
  if (lines.length || r.status !== 0) { failed = true; if (!dirs) process.stdout.write(lines.slice(0, 20).map((l) => `  ${l}\n`).join('')); }
}
// Coverage: every script / source file in the repo (docs/, scratch/ and build output aside) belongs to one of the projects,
// so none can drift unchecked. tsconfig.json is the editor catch-all and is deliberately not run (see docs/port/GUIDE.md).
const tracked = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n');
const orphans = tracked.filter((f) => /\.(c|m)?[jt]sx?$/.test(f) && !/^(docs|scratch|dist|out)\//.test(f) && fs.existsSync(path.join(REPO, f)) && !covered.has(f));
console.log(`${'coverage'.padEnd(12)} ${orphans.length} file(s) outside every project`);
if (orphans.length) { failed = true; process.stdout.write(orphans.map((f) => `  ${f}\n`).join('')); }
if (dirs) {
  const byDir = new Map<string, number>();
  for (const l of all) {
    const file = l.slice(0, l.indexOf('('));
    const parts = file.split('/');
    const dir = parts[0] === 'renderer' ? parts.slice(0, 3).join('/') : parts.length > 2 && parts[0] === 'server' ? parts.slice(0, 2).join('/') : parts[0];
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  console.log(`\nunique errors by directory (${all.size} total)`);
  for (const [d, n] of [...byDir].sort()) console.log(`  ${d.padEnd(28)} ${n}`);
}
process.exit(failed ? 1 : 0);
