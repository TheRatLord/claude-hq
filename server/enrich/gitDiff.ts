/**
 * `git.diff` (rev 4): what changed in a pane's repository, for the harvest recap's "View changes". Strictly read-only:
 *
 *   rev-parse --verify <from>^{commit} [<to>^{commit}]     the range must name real commits
 *   diff --numstat -z -M <from> [<to>]                       lines per file (binary: null)
 *   diff --name-status -z -M <from> [<to>]                   A / M / D / R… per file
 *   ls-files --others --exclude-standard -z                  untracked files (working-tree diffs only)
 *   diff -M <from> [<to>] -- :(literal)<path>                one file's patch (`path` must be in the list above)
 *
 * Every call runs with GIT_OPTIONAL_LOCKS=0 (no index refresh, so it never contends with the agent's own git), no
 * external diff / textconv drivers, no fsmonitor hook, a 4 s timeout, one git process at a time across all requests
 * (a queue), and a 10 s cache of the file list per (root, from, to). Untracked files are counted / shown by reading
 * them directly, only when they are regular files inside the work tree (never through a symlink), up to a size cap.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIMITS } from '../../shared/protocol.ts';
import type { DiffFile, DiffResult } from '../../shared/protocol.ts';
import { runGit } from './git.ts';
import type { GitRunner } from './git.ts';

const CACHE_MS = 10_000;
const UNTRACKED_COUNT_MAX = 60;
const UNTRACKED_BYTES_MAX = 512 * 1024;
const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off'];
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '-M'];

/** What the actions router needs: a pane's repo root, the range, maybe a file's patch. */
export interface DiffSource {
  diff(id: string, root: string | null, q: { from?: string; to?: string; path?: string }): Promise<DiffResult>;
}

/** `git diff --numstat -z`: `a\tb\tpath\0`, renames `a\tb\t\0old\0new\0`; binary files count `-` (null). */
export function parseNumstatZ(out: string): { path: string; from?: string; added: number | null; removed: number | null }[] {
  const parts = out.split('\0');
  const res: { path: string; from?: string; added: number | null; removed: number | null }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(rec.replace(/^\n/, ''));
    if (!m) continue;
    const added = m[1] === '-' ? null : Number(m[1]);
    const removed = m[2] === '-' ? null : Number(m[2]);
    if (m[3] === '') {
      const from = parts[++i] ?? '', to = parts[++i] ?? '';
      if (to) res.push({ path: to, from, added, removed });
    } else res.push({ path: m[3], added, removed });
  }
  return res;
}

/** `git diff --name-status -z`: `M\0path\0`, `R100\0old\0new\0` → path → status letter (+ from). */
export function parseNameStatusZ(out: string): Map<string, { status: string; from?: string }> {
  const parts = out.split('\0');
  const res = new Map<string, { status: string; from?: string }>();
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].replace(/^\n/, '');
    if (!code) continue;
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const from = parts[++i] ?? '', to = parts[++i] ?? '';
      if (to) res.set(to, { status: letter, from });
    } else {
      const p = parts[++i] ?? '';
      if (p) res.set(p, { status: letter });
    }
  }
  return res;
}

/** Merge the two listings (+ untracked) into the reply's files, biggest change first, capped. */
export function diffFiles(numstat: ReturnType<typeof parseNumstatZ>, names: Map<string, { status: string; from?: string }>, untracked: { path: string; added: number | null }[]): { files: DiffFile[]; added: number; removed: number; more: number } {
  const all: DiffFile[] = numstat.map((n) => {
    const st = names.get(n.path);
    return { path: n.path, status: st?.status ?? 'M', ...(n.from || st?.from ? { from: n.from || st?.from } : {}), added: n.added, removed: n.removed };
  });
  const seen = new Set(all.map((f) => f.path));
  for (const u of untracked) if (!seen.has(u.path)) all.push({ path: u.path, status: '?', added: u.added, removed: u.added === null ? null : 0 });
  let added = 0, removed = 0;
  for (const f of all) { added += f.added ?? 0; removed += f.removed ?? 0; }
  all.sort((a, b) => ((b.added ?? 0) + (b.removed ?? 0)) - ((a.added ?? 0) + (a.removed ?? 0)) || a.path.localeCompare(b.path));
  const max = LIMITS.diffFilesMax;
  return { files: all.slice(0, max), added, removed, more: Math.max(0, all.length - max) };
}

/** Cut a patch to `max` bytes at a line boundary. */
export function capPatch(text: string, max = LIMITS.diffPatchMax): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= max) return { text, truncated: false };
  let cut = Buffer.from(text).subarray(0, max).toString('utf8');
  const nl = cut.lastIndexOf('\n');
  if (nl > 0) cut = cut.slice(0, nl + 1);
  return { text: cut, truncated: true };
}

const err = (code: string, why: string): Error & { code: string } => Object.assign(new Error(why), { code });

/** A regular file inside `root` (no symlink anywhere on the way), or null. */
async function readInside(root: string, rel: string, max: number): Promise<string | null> {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return null;
  // every component below root must be a real directory / file, not a link out of the tree
  let cur = root;
  for (const seg of path.relative(root, abs).split(path.sep)) {
    cur = path.join(cur, seg);
    const st = await fs.lstat(cur).catch(() => null);
    if (!st || st.isSymbolicLink()) return null;
    if (cur === abs && (!st.isFile() || st.size > max)) return null;
  }
  return fs.readFile(abs, 'utf8').catch(() => null);
}

const lineCount = (t: string): number => (t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0);

export interface GitDiffsOpts { run?: GitRunner; now?: () => number }

export class GitDiffs implements DiffSource {
  run: GitRunner;
  now: () => number;
  queue: Promise<unknown>;
  cache: Map<string, { at: number; v: Omit<DiffResult, 'patch'> }>;
  constructor({ run = runGit, now = Date.now }: GitDiffsOpts = {}) {
    this.run = run;
    this.now = now;
    this.queue = Promise.resolve();
    this.cache = new Map();
  }

  /** one request at a time (each runs its git processes in sequence) */
  diff(id: string, root: string | null, q: { from?: string; to?: string; path?: string }): Promise<DiffResult> {
    const p = this.queue.then(() => this._diff(root, q));
    this.queue = p.catch(() => {});
    return p;
  }

  async _git(args: string[], root: string): Promise<string> {
    const r = await this.run([...SAFE, ...args], root);
    if (r.timedOut) throw err('not_accepted', 'git took too long');
    if (!r.ok) throw err('not_accepted', `git ${args[0]} failed`);
    return r.out;
  }

  async _stat(root: string, from: string, to: string | null): Promise<Omit<DiffResult, 'patch'>> {
    const key = `${root}\0${from}\0${to ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.v;
    // the range must name commits in this repo (a rewritten history, a sha from another repo → a clear refusal)
    for (const rev of to ? [from, to] : [from]) {
      const ok = await this.run([...SAFE, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`], root);
      if (!ok.ok) throw err('not_accepted', ok.timedOut ? 'git took too long' : `unknown commit ${rev} (rebased away, or another repo)`);
    }
    const range = to ? [from, to] : [from];
    const numstat = parseNumstatZ(await this._git(['diff', ...DIFF_FLAGS, '--numstat', '-z', ...range, '--'], root));
    const names = parseNameStatusZ(await this._git(['diff', ...DIFF_FLAGS, '--name-status', '-z', ...range, '--'], root));
    const untracked: { path: string; added: number | null }[] = [];
    if (!to) {
      const r = await this.run([...SAFE, 'ls-files', '--others', '--exclude-standard', '-z'], root);
      const list = r.ok ? r.out.split('\0').filter(Boolean).slice(0, LIMITS.diffFilesMax) : [];
      for (const [i, p] of list.entries()) {
        const text = i < UNTRACKED_COUNT_MAX ? await readInside(root, p, UNTRACKED_BYTES_MAX) : null;
        untracked.push({ path: p, added: text === null ? null : lineCount(text) });
      }
    }
    const v = { root, from: from.slice(0, 12), to: to ? to.slice(0, 12) : null, ...diffFiles(numstat, names, untracked) };
    this.cache.set(key, { at: this.now(), v });
    if (this.cache.size > 32) for (const [k, c] of this.cache) if (this.now() - c.at > CACHE_MS) this.cache.delete(k);
    return v;
  }

  async _diff(root: string | null, q: { from?: string; to?: string; path?: string }): Promise<DiffResult> {
    if (!root) throw err('not_accepted', 'not a git repository');
    const from = q.from ?? 'HEAD';
    const to = q.to ?? null;
    const stat = await this._stat(root, from, to);
    if (!q.path) return stat;
    const f = stat.files.find((x) => x.path === q.path);
    if (!f) throw err('not_accepted', 'that file is not in this diff');
    if (f.status === '?') {
      const text = await readInside(root, f.path, LIMITS.diffPatchMax * 4);
      if (text === null) return { ...stat, patch: { path: f.path, text: '', truncated: true } };
      const body = `new file (untracked)\n--- /dev/null\n+++ b/${f.path}\n${text.split('\n').map((l) => `+${l}`).join('\n')}\n`;
      return { ...stat, patch: { path: f.path, ...capPatch(body) } };
    }
    const specs = [`:(literal)${f.path}`, ...(f.from ? [`:(literal)${f.from}`] : [])];
    const out = await this._git(['diff', ...DIFF_FLAGS, from, ...(to ? [to] : []), '--', ...specs], root);
    return { ...stat, patch: { path: f.path, ...capPatch(out) } };
  }
}
