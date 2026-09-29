/** Shared helpers for stats sources: every read is sync, tiny, and returns null on any error (§4.10). Owner: BE2. */
import fs from 'node:fs';
import path from 'node:path';

/** Read a file as trimmed text, or null. `root` = path prefix ('' = real system). */
export function read(root: string, p: string): string | null {
  try {
    return fs.readFileSync(root + p, 'utf8').trim();
  } catch {
    return null;
  }
}
/** Read a number, or null. */
export function num(root: string, p: string): number | null {
  const t = read(root, p);
  if (t === null || t === '') return null;
  const v = Number(t.split(/\s+/)[0]);
  return Number.isFinite(v) ? v : null;
}
export function list(root: string, p: string): string[] {
  try {
    return fs.readdirSync(root + p);
  } catch {
    return [];
  }
}

/** hwmon directories by `name` (indices are not stable across boots): name → dir. */
export function hwmonByName(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of list(root, '/sys/class/hwmon')) {
    const dir = path.posix.join('/sys/class/hwmon', d);
    const name = read(root, `${dir}/name`);
    if (name && !out.has(name)) out.set(name, dir);
  }
  return out;
}

/** Guard: run a source fn, returning `fallback` if it throws. */
export function safe<T>(fn: () => T): T | null;
export function safe<T, F>(fn: () => T, fallback: F): T | F;
export function safe<T, F>(fn: () => T, fallback: F | null = null): T | F | null {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
