#!/usr/bin/env node
// Check backend, browser libraries, tests, and source-file coverage without emitting build output.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const TSC = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
const PROJECTS = ['node', 'renderer', 'test'] as const;
const args = process.argv.slice(2);
const dirs = args.includes('--dirs');
const extra = args.filter((a) => a !== '--dirs');

const all = new Set<string>();
const covered = new Set<string>();
let failed = false;
for (const project of PROJECTS) {
  const listed = spawnSync(process.execPath, [TSC, '-p', `tsconfig.${project}.json`, '--listFilesOnly'], { cwd: REPO, encoding: 'utf8' });
  if (listed.error || listed.status !== 0) {
    failed = true;
    console.error(`${project}: unable to list compiler inputs`, listed.error?.message ?? listed.stderr ?? listed.stdout);
  }
  for (const file of (listed.stdout ?? '').split(/\r?\n/)) {
    if (!path.isAbsolute(file)) continue;
    const rel = path.relative(REPO, file).replaceAll('\\', '/');
    if (!rel.startsWith('../') && !rel.startsWith('node_modules/')) covered.add(rel);
  }
  const result = spawnSync(process.execPath, [TSC, '-p', `tsconfig.${project}.json`, '--noEmit', '--pretty', 'false', ...extra], { cwd: REPO, encoding: 'utf8' });
  const lines = (result.stdout ?? '').split(/\r?\n/).filter((line) => /: error TS\d+:/.test(line));
  for (const line of lines) all.add(line);
  console.log(`${project.padEnd(12)} ${lines.length} error(s)`);
  if (result.error || result.status !== 0) {
    failed = true;
    if (result.error) console.error(result.error.message);
    if (result.stderr) process.stderr.write(result.stderr);
    if (!dirs) process.stdout.write(`${lines.join('\n')}\n`);
  }
}

function sources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sources(file));
    else if (/\.(c|m)?[jt]sx?$/.test(entry.name)) files.push(path.relative(REPO, file).replaceAll('\\', '/'));
  }
  return files;
}
const orphans = ['shared', 'server', 'scripts', 'renderer/src'].flatMap((dir) => sources(path.join(REPO, dir))).filter((file) => !covered.has(file));
console.log(`${'coverage'.padEnd(12)} ${orphans.length} file(s) outside every project`);
if (orphans.length) {
  failed = true;
  process.stdout.write(`${orphans.join('\n')}\n`);
}
if (dirs) {
  const byDir = new Map<string, number>();
  for (const line of all) {
    const file = line.slice(0, line.indexOf('(')).replaceAll('\\', '/');
    const parts = file.split('/');
    const dir = parts[0] === 'renderer' ? parts.slice(0, 3).join('/') : parts.length > 2 && parts[0] === 'server' ? parts.slice(0, 2).join('/') : parts[0];
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  console.log(`\nunique errors by directory (${all.size} total)`);
  for (const [dir, count] of [...byDir].sort()) console.log(`  ${dir.padEnd(28)} ${count}`);
}
process.exit(failed ? 1 : 0);
