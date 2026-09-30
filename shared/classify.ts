// @pure
/**
 * Tool / command / process classification (ToolClass, ShellActivity). Owner: BE2.
 * Pure: imported by the backend enrichers and by renderer @pure modules. No node built-ins, no three.
 */

import type { ToolClass, ShellActivity } from './protocol.ts';

/** The Bash sub-classes of ToolClass (`bashCategory`). */
export type BashCategory = 'test' | 'build' | 'git' | 'net' | 'bash';
/** A transcript `tool_use` input: a JSON object whose fields are read defensively. */
export type ToolInput = Record<string, unknown>;

const TOOL_TABLE: Record<string, ToolClass> = {
  Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Write: 'write',
  Read: 'read', NotebookRead: 'read',
  Grep: 'search', Glob: 'search', LS: 'search', ToolSearch: 'search',
  WebSearch: 'web', WebFetch: 'web',
  Agent: 'task', Task: 'task', Workflow: 'task',
  TodoWrite: 'todo', TodoRead: 'todo', TaskCreate: 'todo', TaskUpdate: 'todo', TaskList: 'todo',
  AskUserQuestion: 'ask',
  BashOutput: 'bash', KillShell: 'bash', KillBash: 'bash', TaskStop: 'bash', Monitor: 'bash',
};

/** Classify a transcript `tool_use` by tool name and input (Bash: {command}). */
export function toolClass(name: string | null | undefined, input?: ToolInput | null): ToolClass {
  if (!name) return 'other';
  if (name === 'Bash' || name === 'PowerShell') return bashCategory(String(input?.command ?? ''));
  if (name.startsWith('mcp__')) return 'mcp';
  return TOOL_TABLE[name] ?? 'other';
}

// ---------------------------------------------------------------------------------------------
// Bash commands

const RUNNERS = /^(npx|pnpx|bunx|uvx|poetry run|uv run|pipenv run|bundle exec|dotenv(?: --)?|env)$/;

/** Split a shell line into simple-command segments (on && || ; | and newlines), outside quotes. */
function segments(cmd: string): string[] {
  const out: string[] = [];
  let cur = '', q: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"') {
        cur += c + (cmd[++i] ?? '');
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ';' || c === '\n' || c === '|' || (c === '&' && cmd[i + 1] === '&')) {
      if (c === '&' || (c === '|' && cmd[i + 1] === '|')) i++;
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Strip wrappers from one simple command: env assignments, sudo, time, timeout N, nice, subshell parens. */
function core(seg: string): string {
  let s = seg.replace(/^[({\s]+/, '').replace(/[)}\s]+$/, '');
  for (let k = 0; k < 8; k++) {
    const before = s;
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/, '');
    s = s.replace(/^(sudo|time|nice|nohup|exec|command|builtin)\s+(-\S+\s+)*/, '');
    s = s.replace(/^timeout\s+(-\S+\s+)*\d+[smh]?\s+/, '');
    s = s.replace(/^(npx|pnpx|bunx|uvx)\s+(-y\s+|--yes\s+)?/, '');
    s = s.replace(/^(poetry run|uv run|pipenv run|bundle exec)\s+/, '');
    if (s === before) break;
  }
  return s;
}

const TEST_RE = [
  /^(jest|vitest|mocha|ava|tap|pytest|py\.test|tox|nox|rspec|phpunit|ctest|karma|playwright test|cypress run)\b/,
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/,
  /^(npm|pnpm|yarn|bun)\s+run\s+test[:\w-]*/,
  /^npm\s+t\b/,
  /^(cargo|go|deno|dotnet|mix|swift|zig|gradle|\.\/gradlew|mvn)\s+test\b/,
  /^node\s+(.*\s)?--test\b/,
  /^python3?\s+-m\s+(pytest|unittest)\b/,
  /^make\s+(\S+\s+)*(test|check)\b/,
  /^(\.{0,2}\/\S*)?\/?(run-)?tests?\.sh\b|^\.\/test\b/,
];
const BUILD_RE = [
  /^(make|cmake|ninja|meson|bazel|tsc|webpack|rollup|esbuild|gcc|g\+\+|clang|rustc|javac)\b/,
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?build\b/,
  /^(cargo|go|dotnet|swift|zig|gradle|\.\/gradlew|mvn|docker|docker compose|podman)\s+(build|compile|package|install)\b/,
  /^vite\s+build\b/,
  /^(\S*\/)?build(\.sh)?\b/,
];
const NET_RE = [
  /^(curl|wget|ssh|scp|rsync|sftp|ftp|nc|telnet|ping|dig|nslookup|http|https|xh|gh)\b/,
  /^(npm|pnpm)\s+(i|install|add|ci)\b/,
  /^(yarn|bun)\s+(add|install)\b/,
  /^yarn$/,
  /^(pip3?|uv pip|pipx)\s+install\b/,
  /^(apt|apt-get|brew|dnf|pacman)\s+(install|update|upgrade)\b/,
  /^cargo\s+(add|fetch|install)\b/,
  /^go\s+(get|mod download)\b/,
];

/** The category of one simple command (null for an empty one or a bare `cd`). */
function categoryOf(seg: string): BashCategory | null {
  const c = core(seg);
  if (!c || /^cd\b/.test(c)) return null;
  if (TEST_RE.some((r) => r.test(c))) return 'test';
  if (/^(git|gh pr|gh repo)\b/.test(c)) return 'git';
  if (BUILD_RE.some((r) => r.test(c))) return 'build';
  if (NET_RE.some((r) => r.test(c))) return 'net';
  return 'bash';
}

const PRIORITY: readonly BashCategory[] = ['test', 'build', 'git', 'net', 'bash'];

/**
 * Classify a Bash command line (first word(s) of each simple command; the strongest category wins, so
 * `cd x && npm test 2>&1 | tail -20` is `test`).
 */
export function bashCategory(cmd: string | null | undefined): BashCategory {
  const cats = new Set(segments(String(cmd ?? '')).map(categoryOf).filter((c): c is BashCategory => c !== null));
  return PRIORITY.find((p) => cats.has(p)) ?? 'bash';
}

/** Is this Bash command a git commit/push (the `commit` event trigger)? */
export function isGitCommit(cmd: string | null | undefined): boolean {
  return segments(String(cmd ?? '')).some((s) => /^git\s+(-\S+\s+(\S+\s+)?)*(commit|push)\b/.test(core(s)));
}

// ---------------------------------------------------------------------------------------------
// Shell foreground processes

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'xonsh', 'login', '-bash', '-zsh']);
const EDITORS = new Set(['vim', 'nvim', 'vi', 'nano', 'hx', 'helix', 'emacs', 'micro', 'kak', 'joe', 'ne', 'mcedit']);
const MONITORS = new Set(['top', 'htop', 'btop', 'btm', 'atop', 'glances', 'nvtop', 'radeontop', 'watch', 'iotop', 'nethogs', 'bmon', 'k9s', 'less', 'more', 'journalctl', 'dmesg', 'lnav']);
const REMOTE = new Set(['ssh', 'mosh', 'mosh-client', 'telnet', 'et', 'autossh']);
const REPLS = new Set(['python', 'python3', 'ipython', 'ipython3', 'node', 'bun', 'deno', 'irb', 'pry', 'ghci', 'lua', 'R', 'julia', 'psql', 'sqlite3', 'mysql', 'redis-cli', 'iex', 'erl', 'ocaml', 'utop', 'clj', 'scala', 'php', 'perl', 'ruby']);
const GIT = new Set(['git', 'lazygit', 'tig', 'gitui']);
const SERVE_RE = [
  /\bserve\b|\bserver\b|http\.server|SimpleHTTPServer/,
  /^(vite|next|nuxt|astro|remix|webpack-dev-server|nodemon|uvicorn|gunicorn|hypercorn|daphne|flask|caddy|nginx|httpd|docker|docker-compose|podman|livereload|browser-sync|jekyll|hugo)\b/,
  /\bvite(\.js)?\b(?!\s+build)/,
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/,
  /^(rails|bin\/rails)\s+s(erver)?\b/,
  /\bmanage\.py\s+runserver\b/,
  /^flask\s+run\b/,
];

const base = (p: unknown): string => String(p ?? '').split('/').pop() ?? '';

/**
 * Classify a pane's foreground process. `nameOrProc` = process name (comm) or {name, argv}; `argvIn` = argv
 * array or command line string.
 */
export function processActivity(nameOrProc: string | { name?: string; argv?: string | string[] }, argvIn?: string | string[]): ShellActivity {
  const p = typeof nameOrProc === 'object' && nameOrProc ? nameOrProc : { name: nameOrProc, argv: argvIn };
  const argvArr = Array.isArray(p.argv) ? p.argv.map(String) : String(p.argv ?? '').split(/\s+/).filter(Boolean);
  const name = base(p.name || argvArr[0] || '');
  const argv0 = base(argvArr[0] ?? name);
  const line = [argv0, ...argvArr.slice(1)].join(' ').trim() || name;
  const exe = SHELLS.has(argv0) || SHELLS.has(name) ? (argvArr.length <= 1 || argvArr.slice(1).every((a) => /^-/.test(a)) ? 'shell' : 'script') : null;
  if (exe === 'shell') return 'prompt';
  if (EDITORS.has(name) || EDITORS.has(argv0)) return 'edit';
  if (REMOTE.has(name) || REMOTE.has(argv0)) return 'remote';
  if (/^tail\b.*\s-(f|F|\w*f)\b/.test(line)) return 'monitor';
  if (MONITORS.has(name) || MONITORS.has(argv0)) return 'monitor';
  if (SERVE_RE.some((r) => r.test(line))) return 'serve';
  const cat = bashCategory(line);
  if (cat === 'test') return 'test';
  if (cat === 'build') return 'build';
  if (GIT.has(name) || GIT.has(argv0) || cat === 'git') return 'git';
  if (REPLS.has(argv0) || REPLS.has(name)) {
    const rest = argvArr.slice(1).filter((a) => !/^-/.test(a));
    const interactive = rest.length === 0 || argvArr.includes('-i');
    if (interactive) return 'repl';
  }
  return 'run';
}

/** herdr `pane.process_info`. */
export interface HerdrProcessInfo {
  shell_pid?: number;
  foreground_process_group_id?: number;
  foreground_processes?: { pid: number; name: string; argv?: string[]; cmdline?: string }[];
}

/**
 * Pick the foreground process of interest from herdr `pane.process_info` and build Entity.process.
 * Prefers the process-group leader (pid === foreground_process_group_id), else the first entry.
 */
export function processFromInfo(info: HerdrProcessInfo | null): { name: string; argv: string; activity: ShellActivity } | null {
  const list = info?.foreground_processes ?? [];
  if (!list.length) return null;
  const lead = list.find((p) => p.pid === info?.foreground_process_group_id) ?? list[0];
  const argvArr = Array.isArray(lead.argv) && lead.argv.length ? lead.argv : String(lead.cmdline ?? lead.name ?? '').split(/\s+/);
  // herdr sometimes reports a single-element argv holding the whole command line
  const words = argvArr.length === 1 && /\s/.test(argvArr[0]) ? argvArr[0].split(/\s+/) : argvArr;
  const argv0 = base(words[0] ?? '');
  const name = SHELLS.has(argv0) ? argv0 : lead.name && !/\s/.test(lead.name) && lead.name !== 'MainThread' ? lead.name : argv0 || lead.name;
  const argv = [argv0, ...words.slice(1)].join(' ').slice(0, 200);
  return { name, argv, activity: processActivity({ name, argv: words }) };
}

// ------------------------------------------------------------------------------------------------
// M3.5 (BE2): work stats + context window, shared by the transcripts enricher, the demo and the UI.

/** Lines in a string ('' → 0; a trailing newline does not start a line). */
export function lineCount(s: unknown): number {
  if (typeof s !== 'string' || !s) return 0;
  let n = 1;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return s.endsWith('\n') ? n - 1 : n;
}

/**
 * Lines added/removed by one old→new replacement: both sides minus the lines they share as a common prefix/suffix
 * (so a one-line change inside a 5-line anchor counts +1 −1, like a diff hunk would).
 */
export function replaceStats(oldS: unknown, newS: unknown): { added: number; removed: number } {
  const a = typeof oldS === 'string' && oldS ? oldS.replace(/\n$/, '').split('\n') : [];
  const b = typeof newS === 'string' && newS ? newS.replace(/\n$/, '').split('\n') : [];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return { added: b.length - p - q, removed: a.length - p - q };
}

/**
 * Work done by one Edit / MultiEdit / Write tool input (`Entity.work`): Edit = replaceStats(old_string,
 * new_string), MultiEdit = Σ over its edits, Write = lineCount(content) added. null for any other tool.
 */
export function editStats(name: string, input: ToolInput | null | undefined): { added: number; removed: number; file: string | null } | null {
  const i = input ?? {};
  const file = typeof i.file_path === 'string' && i.file_path ? i.file_path : null;
  if (name === 'Write') return { added: lineCount(i.content), removed: 0, file };
  if (name === 'Edit') return { ...replaceStats(i.old_string, i.new_string), file };
  if (name === 'MultiEdit') {
    let added = 0, removed = 0;
    const edits: ({ old_string?: unknown; new_string?: unknown } | null | undefined)[] = Array.isArray(i.edits) ? i.edits : [];
    for (const e of edits) {
      const s = replaceStats(e?.old_string, e?.new_string);
      added += s.added;
      removed += s.removed;
    }
    return { added, removed, file };
  }
  return null;
}

export const CONTEXT_WINDOW = 200_000;
export const CONTEXT_WINDOW_1M = 1_000_000;

/**
 * Context window of a model: 1M for a `[1m]` / `-1m` model id, or once the context already exceeds 200k (the transcript
 * never names the beta); else 200k.
 */
export function contextWindow(model: string | null | undefined, tokens?: number | null): number {
  if (/\[1m\]|[-_]1m\b/i.test(String(model ?? ''))) return CONTEXT_WINDOW_1M;
  if ((tokens ?? 0) > CONTEXT_WINDOW) return CONTEXT_WINDOW_1M;
  return CONTEXT_WINDOW;
}
