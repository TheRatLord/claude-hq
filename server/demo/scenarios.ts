/**
 * Demo content pools + scenario builders. Pure data/functions: no timers, no I/O.
 *
 * A scenario builds a list of pane specs; `DemoWorld` turns them into herdr-shaped raw snapshots and schedules.
 *   PaneSpec = {ws, tab, kind, name?, status, frozen?, cls?, proc?, prompt?, idleForMs?, model?, title?, ...}
 */
import { mulberry32, hash32 } from '../../shared/identity.ts';
import { TOOL_CLASSES, SHELL_ACTIVITIES, STATUSES } from '../../shared/protocol.ts';
import type { Kind, ShellActivity, Status, ToolClass } from '../../shared/protocol.ts';

/** Shape of a blocked prompt (drives DemoWorld's `pane.read detection` text and the fake TUI). */
export interface PromptSpec {
  shape: 'numbered' | 'trust' | 'bullets' | 'free';
  /** text above the options */
  lines: string[];
  labels: string[];
  numbered: boolean;
  footer?: string;
}

/** A pane to create (a scenario lists them; `agent.start` / comings / churn add more). */
export interface NewPaneSpec {
  tab?: string;
  kind?: Kind;
  /** herdr's agent label when it is not the kind itself (`opencode`, `aider` … for kind 'agent'; the zoo) */
  agent?: string;
  /** agent display name; null = unnamed */
  name?: string | null;
  status?: Status;
  /** never scheduled: the state holds */
  frozen?: boolean;
  frozenIdle?: boolean;
  frozenProc?: boolean;
  cls?: ToolClass | null;
  proc?: string[];
  procActivity?: ShellActivity;
  prompt?: PromptSpec | null;
  idleForMs?: number;
  model?: string;
  title?: string;
  lastPrompt?: string | null;
  queue?: boolean;
  askActivity?: boolean;
  /** a fresh hire (agent.start): no task yet */
  fresh?: boolean;
  /** starts on the folder-trust prompt */
  trust?: boolean;
  nearCompact?: boolean;
  index?: number;
  cwd?: string;
}
/** A pane of a scenario: which workspace (index into WORKSPACES) it lands in. */
export interface PaneSpec extends NewPaneSpec { ws: number }

/** A scenario's pane list and behaviour flags. */
export interface Scenario { specs: PaneSpec[]; offline?: boolean; churn?: boolean; schedule: boolean }

/** Activity a demo agent shows (`tool` null for think/talk/compact). */
export interface DemoActivity { tool: string | null; cls: ToolClass; detail: string }
/** One printed line of a demo shell; `kind` colours it in fakeTerm (out | ok | err | dim | cmd). */
export interface ShellLine { text: string; kind: string }

export const HOME = '/home/demo';

export const WORKSPACES = Object.freeze([
  { label: 'hq-core', cwd: `${HOME}/src/claude-hq`, repo: 'claude-hq' },
  { label: 'tinker', cwd: `${HOME}/src/tinker`, repo: 'tinker' },
  { label: 'infra', cwd: `${HOME}/ops/infra`, repo: null },
  { label: 'webshop', cwd: `${HOME}/src/webshop`, repo: 'webshop' },
  { label: 'ml-lab', cwd: `${HOME}/research/ml-lab`, repo: 'ml-lab' },
  { label: 'docs-site', cwd: `${HOME}/src/docs-site`, repo: 'docs-site' },
  { label: 'mobile', cwd: `${HOME}/src/mobile-app`, repo: 'mobile-app' },
  { label: 'data-pipe', cwd: `${HOME}/src/data-pipe`, repo: 'data-pipe' },
  { label: 'api-gw', cwd: `${HOME}/src/api-gateway`, repo: 'api-gateway' },
  { label: 'blog', cwd: `${HOME}/src/blog`, repo: 'blog' },
  { label: 'dotfiles', cwd: `${HOME}/dotfiles`, repo: 'dotfiles' },
  { label: 'sandbox', cwd: '/tmp/sandbox', repo: null },
]);
export const RENAMES = Object.freeze(['hq-next', 'tinker-v2', 'ops', 'shop', 'lab', 'docs', 'app', 'etl', 'gateway', 'notes']);

export const NAMES = Object.freeze(['scout', 'relay', 'ledger', 'tinker', 'quill', 'nova', 'pike', 'ember', 'moss', 'juniper', 'wren',
  'atlas', 'cobalt', 'fern', 'sable', 'orbit', 'pixel', 'bramble', 'comet', 'dune', 'flint', 'gale', 'harbor', 'iris', 'kestrel',
  'lumen', 'maple', 'nimbus', 'onyx', 'pebble', 'quartz', 'rook', 'sprig', 'thistle', 'umber', 'vale', 'willow', 'yarrow', 'zephyr', 'basil']);

/** [title, prompt] pairs (agent task titles are what Claude's ai-title looks like). */
export const TASKS = Object.freeze([
  ['Route stops display', 'show the next three stops on the route card, not just the next one'],
  ['Fix flaky ws test', 'the ws test fails about one run in ten, find out why'],
  ['Coalesce store updates', 'make the store apply entity messages eagerly and coalesce per id'],
  ['Add retry to fetcher', 'add exponential backoff with jitter to the fetcher'],
  ['Tune nginx cache headers', 'cache static assets for a year but never index.html'],
  ['Rotate staging TLS certs', 'rotate the staging certs before friday and update the runbook'],
  ['Migrate config to TOML', 'move the config from yaml to toml and keep the old keys working'],
  ['Speed up CI cache', 'CI spends four minutes restoring node_modules, make it faster'],
  ['Dark mode toggle', 'add a dark mode toggle that remembers the choice'],
  ['Paginate orders API', 'the orders endpoint returns everything, add cursor pagination'],
  ['Fix login redirect loop', 'logging in from /settings loops back to /login forever'],
  ['Profile slow report query', 'the monthly report takes 40 seconds, profile the query'],
  ['Add OpenGraph tags', 'add og: and twitter: meta tags to every blog post'],
  ['Refactor auth middleware', 'split the auth middleware so API keys and sessions are separate'],
  ['Train tokenizer v2', 'retrain the tokenizer on the new corpus and compare perplexity'],
  ['Bump deps, fix types', 'bump all dependencies and fix whatever the type checker says'],
  ['Offline sync queue', 'queue edits while offline and replay them when the app reconnects'],
  ['Dedupe ETL rows', 'the nightly ETL inserts duplicate rows when a batch retries'],
  ['Rate limit per API key', 'add a per-key token bucket to the gateway'],
  ['Write migration guide', 'write a guide for upgrading from v1 to v2 with code samples'],
]);

/**
 * What a Claude says while on each TASKS entry (`lastText`): [finding, fix]. `demoText()` phrases them per stage.
 */
export const TASK_NOTES: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  'Route stops display': ['the route card only reads `stops[0]` from the store', 'slice the next three stops and render them as a list'],
  'Fix flaky ws test': ['the reconnect timer can fire before the close handler finishes', 'await the close event before re-arming the timer'],
  'Coalesce store updates': ['every entity message triggers its own re-render', 'batch patches per id and flush once per animation frame'],
  'Add retry to fetcher': ['the fetcher gives up on the first 503', 'retry with exponential backoff (base 250 ms, full jitter, 5 tries)'],
  'Tune nginx cache headers': ['index.html inherits the one-year `immutable` header', 'add an exact `location = /index.html` with `no-cache`'],
  'Rotate staging TLS certs': ['the staging certs expire Friday 09:00 UTC', 'issue new certs, reload nginx and update the runbook steps'],
  'Migrate config to TOML': ['three keys were renamed between the yaml and toml drafts', 'load TOML first and map the old yaml keys with a deprecation warning'],
  'Speed up CI cache': ['the cache key includes the lockfile mtime, so it never hits', 'key the cache on the lockfile hash and cache ~/.npm instead of node_modules'],
  'Dark mode toggle': ['the theme is read before localStorage is available', 'read the saved choice in an inline head script to avoid the flash'],
  'Paginate orders API': ['`GET /orders` loads every row into memory', 'add an opaque cursor on (created_at, id) with a default limit of 50'],
  'Fix login redirect loop': ['`/settings` redirects to `/login?next=/login`', 'strip auth routes from `next` before redirecting'],
  'Profile slow report query': ['the report does a sequential scan on `orders.created_at`', 'add a composite index on (account_id, created_at)'],
  'Add OpenGraph tags': ['posts have no og:image fallback', 'emit og:/twitter: tags from front matter with a site-wide default image'],
  'Refactor auth middleware': ['API-key and session checks share one 200-line function', 'split it into `apiKeyAuth` and `sessionAuth` behind one `requireAuth`'],
  'Train tokenizer v2': ['the new corpus has 4% duplicated documents', 'dedupe first, then train with a 48k vocab and compare perplexity'],
  'Bump deps, fix types': ['the router bump changed `params` to be possibly undefined', 'narrow `params` at the three call sites instead of casting'],
  'Offline sync queue': ['edits made offline are dropped on reload', 'persist the queue in IndexedDB and replay it in order on reconnect'],
  'Dedupe ETL rows': ['a retried batch re-inserts rows it already wrote', 'make the load an upsert keyed on (source_id, batch_ts)'],
  'Rate limit per API key': ['the gateway only limits per IP', 'add a token bucket per key (100 req/min, burst 20) in the shared cache'],
  'Write migration guide': ['v2 renames four options and drops `legacyMode`', 'write the guide with before/after snippets for each rename'],
});

const GENERIC_NOTES: readonly [string, string] = Object.freeze(['where this is handled', 'make the change and cover it with a test'] as const);

export type DemoTextStage = 'explore' | 'plan' | 'talk' | 'fail' | 'pass' | 'done' | 'refused';

/**
 * A plausible assistant text for a demo agent (`lastText`). `prompt` is unused, kept for callers.
 */
export function demoText(R: Pick<Rng, 'next'>, stage: DemoTextStage,
  { title = null, file = 'the code', work = null }: { title?: string | null; prompt?: string | null; file?: string; work?: { added: number; removed: number; files: number } | null } = {}): string {
  const [finding, fix] = (title && TASK_NOTES[title]) ?? GENERIC_NOTES;
  const pick = (a: string[]) => a[Math.floor(R.next() * a.length)];
  switch (stage) {
    case 'explore': return pick([`Let me look at ${file} first.`, `Found it: ${finding}.`, `Reading ${file} to see how this is wired.`]);
    case 'plan': return pick([`Plan: ${fix}, then run the tests.`, `The root cause is that ${finding}. I'll ${fix}.`]);
    case 'fail': return pick([`The test still fails — ${file} expects the old shape. Adjusting.`, `One assertion is off by one in ${file}; fixing that.`]);
    case 'pass': return pick(['All tests pass now.', `Tests are green; tidying up ${file}.`]);
    case 'refused': return 'Understood — I won\'t run that. Continuing another way.';
    case 'done': {
      const w = work && work.files ? ` ${work.files} file${work.files === 1 ? '' : 's'}, +${work.added} −${work.removed}.` : '';
      return `Done: ${fix}.${w} Tests pass.`;
    }
    default: return pick([`Now I'll ${fix}.`, `Working on ${file}.`, `That part works; next up is ${file}.`]);
  }
}

export const FILES = Object.freeze(['src/net/store.ts', 'server/ws.ts', 'README.md', 'package.json', 'src/ui/roster.js', 'tests/api.test.js',
  'config.toml', 'Dockerfile', 'nginx.conf', 'src/app.tsx', 'lib/fetcher.py', 'train.py', 'src/auth/middleware.ts', 'docs/guide.md',
  'src/orders/handler.go', 'etl/load.sql', 'src/settings/Theme.tsx', '.github/workflows/ci.yml', 'src/sync/queue.ts', 'Makefile']);
const PATTERNS = ['applyEntity', 'TODO', 'retry', 'cache-control', 'redirect', 'SELECT .* FROM orders', 'useTheme', 'rate_limit'];
const GLOBS = ['**/*.test.js', 'src/**/*.tsx', '**/nginx*.conf', 'migrations/*.sql'];
const WEB_QUERIES = ['nginx cache-control immutable', 'postgres explain analyze hash join', 'node fs.watch reliability linux',
  'exponential backoff jitter formula', 'toml vs yaml comments preserve', 'css prefers-color-scheme localStorage'];
const WEB_URLS = ['nginx.org/en/docs/http/ngx_http_headers_module.html', 'developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control',
  'www.postgresql.org/docs/current/using-explain.html', 'toml.io/en/v1.0.0'];
const CMDS: Record<'test' | 'build' | 'git' | 'net' | 'bash', string[]> = {
  test: ['npm test', 'npm test -- server/ws.test.ts', 'pytest -q tests/', 'go test ./...', 'node --test', 'cargo test'],
  build: ['npm run build', 'vite build', 'make -j8', 'cargo build --release', 'npx tsc --noEmit', 'docker build -t shop .'],
  git: ['git status', 'git diff --stat', 'git log --oneline -10', 'git add -A && git commit -m "wip"'],
  net: ['curl -s localhost:8080/healthz', 'npm i zod', 'pip install -r requirements.txt', 'curl -I https://staging.example.com'],
  bash: ['ls -la src', 'rg -n TODO src | head', 'cat package.json | jq .scripts', 'wc -l src/**/*.ts', 'tail -50 logs/app.log'],
};
const SUBAGENTS: [string, string][] = [['Explore', 'Find every location block'], ['general-purpose', 'Check the CDN docs'], ['Explore', 'Map the renderer boot order'],
  ['Plan', 'Plan the migration steps'], ['general-purpose', 'Survey failing tests'], ['Explore', 'Find callers of fetchOrders']];
const MCP_TOOLS = ['mcp__playwright__browser_take_screenshot', 'mcp__playwright__browser_click', 'mcp__github__create_pull_request'];

/** Demo git (rev 2): branch names and last-commit subjects a workspace starts with. */
export const BRANCHES = Object.freeze(['main', 'main', 'feat/valley-signals', 'fix/reconnect-backoff', 'feat/orders-pagination', 'chore/deps',
  'feat/dark-mode', 'refactor/store', 'fix/flaky-ws-test', 'spike/webgpu']);
export const COMMITS = Object.freeze(['Coalesce entity messages per id', 'Back off WS reconnects exponentially', 'Add cursor pagination to orders',
  'Fix flaky timeline test', 'Bump three to 0.186', 'Split docs per area', 'Cache the parsed config', 'Tidy the drawer layout',
  'Guard against empty stats history', 'Add a soak tool for leaks']);

export const MODELS: readonly (readonly [string, number])[] = Object.freeze([['claude-opus-5-5', 0.6], ['claude-sonnet-5', 0.3], ['claude-haiku-5', 0.1]] as const);

/** Seeded RNG with helpers. */
export interface Rng {
  next: () => number;
  int: (a: number, b: number) => number;
  range: (a: number, b: number) => number;
  pick: <T>(arr: readonly T[]) => T;
  chance: (p: number) => boolean;
  weighted: <T>(pairs: readonly (readonly [T, number])[]) => T;
}

export function rng(seed: number | string): Rng {
  const r = mulberry32(typeof seed === 'number' ? seed >>> 0 : hash32(String(seed)));
  return {
    next: r,
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    range: (a, b) => a + r() * (b - a),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    weighted: (pairs) => {
      let x = r() * pairs.reduce((s, [, w]) => s + w, 0);
      for (const [v, w] of pairs) if ((x -= w) <= 0) return v;
      return pairs[pairs.length - 1][0];
    },
  };
}

const basename = (p: string): string => p.split('/').pop() as string; // split() is never empty

/** A realistic activity for a ToolClass: {tool, cls, detail}. */
export function activityFor(R: Rng, cls: ToolClass): DemoActivity {
  switch (cls) {
    case 'edit': return { tool: R.chance(0.85) ? 'Edit' : 'MultiEdit', cls, detail: basename(R.pick(FILES)) };
    case 'write': return { tool: 'Write', cls, detail: basename(R.pick(FILES)) };
    case 'read': return { tool: 'Read', cls, detail: basename(R.pick(FILES)) };
    case 'search': return R.chance(0.7) ? { tool: 'Grep', cls, detail: R.pick(PATTERNS) } : { tool: 'Glob', cls, detail: R.pick(GLOBS) };
    case 'test': case 'build': case 'git': case 'net': case 'bash':
      return { tool: 'Bash', cls, detail: R.pick(CMDS[cls]) };
    case 'web': return R.chance(0.5) ? { tool: 'WebSearch', cls, detail: R.pick(WEB_QUERIES) } : { tool: 'WebFetch', cls, detail: R.pick(WEB_URLS) };
    case 'task': return { tool: 'Agent', cls, detail: R.pick(SUBAGENTS)[1] };
    case 'todo': return { tool: 'TodoWrite', cls, detail: '' };
    case 'mcp': {
      const t = R.pick(MCP_TOOLS);
      return { tool: t, cls, detail: t.split('__').slice(2).join(' ').replace(/_/g, ' ') };
    }
    case 'ask': return { tool: 'AskUserQuestion', cls, detail: 'Which approach should I take?' };
    case 'think': return { tool: null, cls, detail: '' };
    case 'talk': return { tool: null, cls, detail: '' };
    case 'compact': return { tool: null, cls, detail: '' };
    default: return { tool: 'Skill', cls: 'other', detail: 'frontend-design' };
  }
}

export const pickSubagent = (R: Rng): [string, string] => R.pick(SUBAGENTS);

/** Shell foreground processes per ShellActivity: argv arrays. */
export const SHELL_PROCS = Object.freeze({
  prompt: [['bash']],
  edit: [['nvim', 'src/app.tsx'], ['vim', 'nginx.conf'], ['hx', '.']],
  test: [['npm', 'test'], ['pytest', '-x'], ['cargo', 'test']],
  serve: [['node', 'node_modules/.bin/vite', '--port', '5173'], ['python3', '-m', 'http.server', '8000'], ['docker', 'compose', 'up']],
  monitor: [['htop'], ['watch', '-n', '2', 'uptime'], ['tail', '-f', '/var/log/nginx/access.log'], ['btop']],
  remote: [['ssh', 'staging'], ['mosh', 'buildbox']],
  repl: [['python3'], ['node'], ['ipython']],
  git: [['git', 'log', '-p'], ['lazygit'], ['git', 'commit', '-v']],
  build: [['make', '-j8'], ['cargo', 'build'], ['npm', 'run', 'build']],
  run: [['python3', 'train.py', '--epochs', '3'], ['./scripts/seed-db.sh'], ['sleep', '30']],
});

/**
 * Blocked prompts in Claude Code's real shapes (numbered permission menus, a ❯-bulleted menu, folder trust, free text).
 * `lines` = text above the options; `labels`; `numbered`; `footer`.
 */
export const PROMPTS = Object.freeze({
  edit: (file: string): PromptSpec => ({ shape: 'numbered', lines: [' Edit file', ` ${file}`, '', ` Do you want to make this edit to ${basename(file)}?`],
    labels: ['Yes', 'Yes, allow all edits during this session (shift+tab)', 'No, and tell Claude what to do differently (esc)'], numbered: true }),
  bash: (cmd: string, cwd: string): PromptSpec => ({ shape: 'numbered', lines: [' Bash command', '', `   ${cmd}`, '   Run the command', '', ' Do you want to proceed?'],
    labels: ['Yes', `Yes, and don't ask again for ${cmd.split(' ')[0]} commands in ${cwd}`, 'No, and tell Claude what to do differently (esc)'], numbered: true }),
  trust: (cwd: string): PromptSpec => ({ shape: 'trust', lines: [' Do you trust the files in this folder?', '', ` ${cwd}`, '',
    ' Claude Code may read, write, or execute files contained in this directory. This can pose security risks, so only use',
    ' files from trusted sources.', '', ' Learn more'], labels: ['Yes, proceed', 'No, exit'], numbered: true, footer: ' Enter to confirm · Esc to exit' }),
  bullets: (): PromptSpec => ({ shape: 'bullets', lines: [' How should the HUD appear after boot?'], labels: ['Fade in over 300 ms', 'Pop in with a bounce', 'Slide up from the bottom'],
    numbered: false, footer: ' Enter to select · ↑/↓ to navigate · Esc to cancel' }),
  free: (): PromptSpec => ({ shape: 'free', lines: [' ☐ Old keys', '', ' Should I keep reading the old YAML keys after the migration?'],
    labels: ['Keep both for one release', 'Drop the old keys now', 'Type something.'], numbered: true, footer: ' Enter to select · ↑/↓ to navigate · Esc to cancel' }),
});

/**
 * AskUserQuestion-style questions Claude really asks mid-task: [chip, question, options…]. The UI shows them as
 * `☐ chip` + question + a numbered menu ending in "Type something." (the free-text escape hatch).
 */
export const ASKS: readonly (readonly string[])[] = Object.freeze([
  ['Cache', 'Which caching strategy should I use for the orders API?', 'In-memory LRU per instance', 'Redis, shared across instances', 'No cache, add an index instead'],
  ['Migration', 'The migration locks the orders table for about 40 s. Run it now?', 'Run it now', 'Run it tonight at 02:00', 'Rewrite it as an online migration'],
  ['Theme', 'Should dark mode follow the OS setting by default?', 'Yes, follow prefers-color-scheme', 'No, default to light', 'Remember the last choice only'],
  ['Flaky tests', 'I found two flaky tests. Fix both, or just the ws one?', 'Fix both', 'Only the ws test', 'Quarantine them and open an issue'],
  ['Coverage', 'Tests pass but coverage dropped 3%. Add tests before committing?', 'Yes, add tests first', 'Commit now, tests in a follow-up'],
  ['Node', 'Which Node version should CI run?', 'Node 24 (current)', 'Node 22 LTS', 'Both, as a matrix'],
  ['Deps', 'Some bumps are major versions. Include those too?', 'Only minor and patch', 'Everything, I will review', 'Majors in a separate PR'],
  ['API', 'Keep the old /v1 endpoints alive for one more release?', 'Keep /v1 with a deprecation header', 'Remove /v1 now'],
  ['Config', 'Where should the retry settings live?', 'config.toml', 'Environment variables', 'Hard-coded defaults'],
  ['Training', 'The tokenizer run takes about 2 h on this box. Start it now?', 'Start now', 'Run a 10% sample first', 'Skip, reuse the old tokenizer'],
  ['Certs', 'Staging and prod share one wildcard cert. Rotate both?', 'Staging only', 'Both, staging first'],
  ['Scope', 'The redirect loop also affects /billing. Fix that here too?', 'Yes, same PR', 'No, just /settings'],
  ['Naming', 'Name the new module sync-queue or outbox?', 'sync-queue', 'outbox'],
  ['Pagination', 'Cursor or offset pagination for /orders?', 'Cursor (stable under inserts)', 'Offset (simpler clients)'],
]);

/** An AskUserQuestion menu (numbered, free-text last option). `q` = [chip, question, …options] */
export const askPrompt = ([chip, question, ...opts]: readonly string[]): PromptSpec => ({ shape: 'free', lines: [` ☐ ${chip}`, '', ` ${question}`],
  labels: [...opts, 'Type something.'], numbered: true, footer: ' Enter to select · ↑/↓ to navigate · Esc to cancel' });
/** WebFetch permission (`url` = host/path). */
export const fetchPrompt = (url: string): PromptSpec => {
  const host = url.split('/')[0];
  return { shape: 'numbered', lines: [' Fetch', '', `   https://${url}`, `   Claude wants to fetch content from ${host}`, '', ' Do you want to allow Claude to fetch this content?'],
    labels: ['Yes', `Yes, and don't ask again for ${host}`, 'No, and tell Claude what to do differently (esc)'], numbered: true };
};
/** MCP tool permission (`tool` = mcp__server__tool). */
export const mcpPrompt = (tool: string): PromptSpec => {
  const [, server, name] = tool.split('__');
  return { shape: 'numbered', lines: [' Tool use', '', `   ${server} - ${name.replace(/_/g, ' ')} (MCP)`, '', ` Do you want to proceed?`],
    labels: ['Yes', `Yes, and don't ask again for ${server} - ${name} commands`, 'No, and tell Claude what to do differently (esc)'], numbered: true };
};

/**
 * The permission prompt Claude Code shows before THIS tool call (mid-turn blocks), or null when the tool never
 * asks (reads, searches, todos, thinking).
 */
export function permissionFor(a: DemoActivity, cwd: string): PromptSpec | null {
  switch (a.cls) {
    case 'bash': case 'test': case 'build': case 'git': case 'net': return PROMPTS.bash(a.detail, cwd);
    case 'edit': case 'write': return PROMPTS.edit(`src/${a.detail}`);
    case 'web': return a.tool === 'WebFetch' ? fetchPrompt(a.detail) : null;
    case 'mcp': return a.tool ? mcpPrompt(a.tool) : null;
    default: return null;
  }
}

/** A random prompt for a pane (turn-end blocks): permission menus, plus real-sounding AskUserQuestion menus. */
export function randomPrompt(R: Rng, cwd: string): PromptSpec {
  const k = R.weighted([['edit', 3], ['bash', 3], ['ask', 3], ['bullets', 0.5], ['fetch', 0.5]]);
  if (k === 'edit') return PROMPTS.edit(R.pick(FILES));
  if (k === 'bash') return PROMPTS.bash(R.pick([...CMDS.test, ...CMDS.net, 'rm -rf dist', 'docker compose down -v', 'psql -f migrations/042_orders.sql']), cwd);
  if (k === 'ask') return askPrompt(R.pick(ASKS));
  if (k === 'fetch') return fetchPrompt(R.pick(WEB_URLS));
  return PROMPTS.bullets();
}

// ------------------------------------------------------------------------------------------------
// Shell output (demo shells print like real commands; DemoWorld owns the line log, fakeTerm renders it)

const pad = (n: number, w: number): string => String(n).padStart(w);
const TEST_NAMES = ['store applies entity messages eagerly', 'ws reconnect backs off', 'answer re-validates the prompt hash', 'router keeps query params',
  'orders paginate with a cursor', 'config reads legacy yaml keys', 'fetcher retries with jitter', 'theme persists the choice', 'etl dedupes retried batches',
  'token bucket refills per key', 'redirect loop is gone', 'migration guide examples compile'];
const ROUTES = ['GET /', 'GET /api/orders?cursor=eyJpZCI6', 'GET /assets/index-4f2a.js', 'POST /api/login', 'GET /healthz', 'GET /api/me', 'PUT /api/settings/theme', 'GET /favicon.ico'];

/**
 * Lines a running command prints on its `i`-th output tick (0-based), or [] for a quiet tick.
 * `kind` colours them in fakeTerm: out | ok | err | dim.
 */
export function shellTick(R: Rng, act: ShellActivity, argv: readonly string[], i: number): ShellLine[] {
  const L = (text: string, kind = 'out'): ShellLine => ({ text, kind });
  switch (act) {
    case 'test': {
      if (i === 0) return [L(`> ${argv.join(' ')}`, 'dim'), L('')];
      const t = TEST_NAMES[(i * 7) % TEST_NAMES.length]; // 7 ⟂ 12: every test once per cycle, never twice in a row
      return R.chance(0.1) ? [L(`✖ ${t} (${R.int(2, 90)} ms)`, 'err')] : [L(`✔ ${t} (${R.int(1, 40)} ms)`, 'ok')];
    }
    case 'build': {
      if (i === 0) return [L(`vite v8.3.1 building for production...`, 'dim')];
      if (i === 1) return [L(`transforming (${R.int(80, 400)}) src/${R.pick(['main', 'app', 'store', 'router'])}.ts`)];
      return R.chance(0.5) ? [L(`✓ ${R.int(200, 900)} modules transformed.`, 'ok')] : [L(`dist/assets/index-${R.int(1000, 9999).toString(16)}.js  ${R.int(80, 900)}.${R.int(0, 9)} kB │ gzip: ${R.int(20, 200)} kB`)];
    }
    case 'serve':
      if (i === 0) return [L(''), L(`  VITE v8.3.1  ready in ${R.int(120, 900)} ms`, 'ok'), L(''), L('  ➜  Local:   http://127.0.0.1:5173/'), L('')];
      return R.chance(0.6) ? [L(`${R.pick(ROUTES)} ${R.chance(0.92) ? 200 : R.pick([304, 404, 500])} ${R.int(1, 180)}ms`, 'dim')] : [];
    case 'run':
      if (i === 0) return [L(`loading dataset… ${R.int(10, 90)}k rows`, 'dim')];
      return [L(`epoch ${1 + Math.floor(i / 8)}/3  step ${pad((i % 8) * 64, 3)}/512  loss ${(2.6 - i * 0.04 + R.range(-0.05, 0.05)).toFixed(3)}  ${R.int(900, 1400)} tok/s`)];
    case 'repl':
      if (i === 0) return [L(argv[0].startsWith('python') ? 'Python 3.12.4 (main) [GCC 13.2.0] on linux' : 'Welcome to Node.js v24.1.0.', 'dim')];
      return R.chance(0.3) ? [L(argv[0].startsWith('python') ? `>>> len(rows)` : `> rows.length`), L(String(R.int(10, 99999)))] : [];
    case 'remote':
      return i === 0 ? [L(`Last login: Sat Sep 26 ${R.int(8, 23)}:${pad(R.int(0, 59), 2).replace(' ', '0')} from 10.0.0.${R.int(2, 250)}`, 'dim'), L(`deploy@${argv[1] ?? 'staging'}:~$ journalctl -fu app`)]
        : R.chance(0.5) ? [L(`app[${R.int(1000, 9999)}]: ${R.pick(ROUTES)} ${R.int(1, 90)}ms`, 'dim')] : [];
    case 'git':
      return i === 0 ? [L(`[main ${R.int(0x1000000, 0xfffffff).toString(16)}] ${R.pick(['fix redirect loop', 'cursor pagination', 'retry with jitter', 'wip'])}`), L(` ${R.int(1, 9)} files changed, ${R.int(3, 200)} insertions(+), ${R.int(0, 80)} deletions(-)`)] : [];
    default:
      return [];
  }
}

/** Seconds between output ticks per activity ([lo, hi]); null = the command prints once / draws full-screen. */
export const SHELL_TICK_S: Readonly<Record<ShellActivity, readonly [number, number] | null>> = Object.freeze({ test: [0.5, 1.4], build: [0.8, 2], serve: [1.5, 5], run: [1.2, 2.5], repl: [4, 9], remote: [3, 8], git: null, edit: null, monitor: null, prompt: null });

/** Last lines when a command exits. */
export function shellEnd(R: Rng, act: ShellActivity, ticks: number): ShellLine[] {
  const L = (text: string, kind = 'out'): ShellLine => ({ text, kind });
  if (act === 'test') {
    const n = Math.max(3, ticks), fail = R.chance(0.2) ? R.int(1, 2) : 0;
    return [L(''), L(`ℹ tests ${n}`, 'dim'), L(`ℹ pass ${n - fail}`, 'ok'), L(`ℹ fail ${fail}`, fail ? 'err' : 'dim'), L(`ℹ duration_ms ${R.int(300, 9000)}`, 'dim')];
  }
  if (act === 'build') return [L(`✓ built in ${R.range(0.8, 9).toFixed(2)}s`, 'ok')];
  if (act === 'serve' || act === 'run' || act === 'remote') return [L('^C', 'dim')];
  return [];
}

// ------------------------------------------------------------------------------------------------
// Scenario pane specs

const SHELL_START: ShellActivity[] = ['serve', 'test', 'monitor', 'prompt', 'run', 'build', 'edit', 'prompt'];

/**
 * Lay N pane specs out over workspaces of ≈ 4 panes: agents in `claude` tabs (≤ 2 per tab), shells in a `dev`
 * tab or an unnamed numeric tab. ~20% shells, 1 codex per 10 agents.
 */
function layoutMixed(R: Rng, n: number, { shellFrac = 0.2, wsCount = Math.ceil(n / 4) }: { shellFrac?: number; wsCount?: number } = {}): PaneSpec[] {
  const shells = n >= 4 ? Math.max(1, Math.round(n * shellFrac)) : 0;
  const agents = n - shells;
  const codex = Math.floor(agents / 10);
  const kinds: Kind[] = [...Array<Kind>(agents).fill('claude'), ...Array<Kind>(shells).fill('shell')];
  for (let i = 0; i < codex; i++) kinds[agents - 1 - i * 3] = 'codex';
  // spread shells so each workspace gets its share
  const specs: PaneSpec[] = [];
  const perWs = Array.from({ length: wsCount }, (): { kind: Kind }[] => []);
  let a = 0, s = 0;
  for (let i = 0; i < n; i++) {
    const w = i % wsCount;
    const wantShell = s < shells && (perWs[w].filter((p) => p.kind === 'shell').length < Math.ceil(shells / wsCount)) && R.chance(0.35);
    const kind: Kind = wantShell || a >= agents ? 'shell' : kinds[a];
    if (kind === 'shell') s++;
    else a++;
    perWs[w].push({ kind });
  }
  perWs.forEach((list, w) => {
    let agentTab = 0, inTab = 0;
    list.sort((x, y) => Number(x.kind === 'shell') - Number(y.kind === 'shell'));
    list.forEach((p) => {
      let tab: string;
      if (p.kind === 'shell') tab = R.chance(0.5) ? 'dev' : '#'; // '#' → numeric (unnamed) tab
      else {
        if (inTab === 2) {
          agentTab++;
          inTab = 0;
        }
        tab = agentTab === 0 ? 'claude' : agentTab === 1 ? (p.kind === 'codex' ? 'review' : 'agents') : `claude-${agentTab + 1}`;
        inTab++;
      }
      specs.push({ ws: w, tab, kind: p.kind });
    });
  });
  // shells start mid-command (a dev server, a test run, a monitor…) so the office's ENG corner is busy from second 0
  let k = 0;
  for (const s of specs) if (s.kind === 'shell') s.proc = SHELL_PROCS[SHELL_START[k++ % SHELL_START.length]][0];
  return specs;
}

/** Build the pane specs for a scenario. */
export function buildScenario(scenario: string, { n = 12, seed = 1 }: { n?: number; seed?: number } = {}): Scenario {
  const R = rng(`scenario:${scenario}:${seed}`);
  switch (scenario) {
    case 'empty':
      return { specs: [], schedule: true };
    case 'offline':
      return { specs: layoutMixed(R, 4), schedule: false, offline: true };
    case 'trio':
      return { specs: [{ ws: 0, tab: 'claude', kind: 'claude' }, { ws: 0, tab: 'claude', kind: 'claude' }, { ws: 0, tab: 'agents', kind: 'claude' },
        { ws: 0, tab: 'dev', kind: 'shell', proc: ['bash'] }], schedule: true };
    case 'crowd40':
      return { specs: layoutMixed(R, 40, { wsCount: 8 }), schedule: true };
    case 'longIdle': {
      const H = 3600_000;
      const idle = [0, 25 * 60_000, 2 * H, 7 * H];
      return {
        specs: [
          ...idle.map((ms, i): PaneSpec => ({ ws: i < 2 ? 0 : 1, tab: 'claude', kind: 'claude', status: 'idle', idleForMs: ms, frozenIdle: true })),
          { ws: 0, tab: 'dev', kind: 'shell', proc: ['bash'], idleForMs: 40 * 60_000, frozenProc: true },
          { ws: 1, tab: '#', kind: 'shell', proc: ['bash'], idleForMs: 3 * H, frozenProc: true },
        ],
        schedule: true,
      };
    }
    case 'queue': {
      return {
        specs: [
          { ws: 0, tab: 'claude', kind: 'claude', status: 'blocked', prompt: PROMPTS.edit('config.toml'), queue: true },
          { ws: 0, tab: 'claude', kind: 'claude', status: 'blocked', prompt: PROMPTS.bullets(), queue: true, askActivity: true },
          { ws: 1, tab: 'claude', kind: 'claude', status: 'blocked', prompt: PROMPTS.trust('/tmp/hqtest-sandbox'), queue: true },
          { ws: 1, tab: 'claude', kind: 'claude', status: 'blocked', prompt: PROMPTS.free(), queue: true, askActivity: true },
          { ws: 0, tab: 'dev', kind: 'shell', proc: ['bash'] },
          { ws: 1, tab: 'dev', kind: 'shell', proc: ['npm', 'test'] },
        ],
        schedule: true,
      };
    }
    case 'churn':
      return { specs: layoutMixed(R, Math.min(n, 12)), schedule: true, churn: true };
    case 'allStates': {
      const specs: PaneSpec[] = [];
      let i = 0;
      const ws = () => Math.floor(i++ / 4);
      for (const status of STATUSES) {
        specs.push({ ws: ws(), tab: 'status', kind: 'claude', status, frozen: true, cls: status === 'working' ? 'edit' : null,
          prompt: status === 'blocked' ? PROMPTS.edit('config.toml') : null });
      }
      // 'task' swaps places with 'build' so the cls:task agent lands among the first 12
      // panes, i.e. at a desk (renderer assignDesks), instead of the packed overflow floor grid where no clear hero
      // shot of it exists. 'build' (same bashPound look as 'test') takes the floor spot.
      const toolOrder = TOOL_CLASSES.map((c) => (c === 'task' ? 'build' : c === 'build' ? 'task' : c));
      for (const cls of toolOrder) {
        specs.push({ ws: ws(), tab: 'tools', kind: 'claude', status: cls === 'ask' ? 'blocked' : 'working', frozen: true, cls,
          prompt: cls === 'ask' ? PROMPTS.bullets() : null, askActivity: cls === 'ask' });
      }
      for (const act of SHELL_ACTIVITIES) specs.push({ ws: ws(), tab: 'shells', kind: 'shell', frozen: true, proc: SHELL_PROCS[act][0], procActivity: act });
      return { specs, schedule: false };
    }
    case 'zoo': {
      // one of every agent CLI the valley draws its own mascot for, plus a vendor without one (Droid: the sprout-bot)
      // and a label nobody knows; a shell to keep the scarecrow in the picture. Fixed 14 panes over 3 workspaces.
      const zoo: [Kind, string | undefined, Status][] = [
        ['claude', undefined, 'working'], ['codex', undefined, 'working'], ['gemini', undefined, 'idle'], ['agent', 'aider', 'working'],
        ['agent', 'opencode', 'blocked'], ['agent', 'goose', 'working'], ['agent', 'cursor', 'idle'], ['agent', 'amp', 'working'],
        ['agent', 'crush', 'done'], ['agent', 'qwen', 'working'], ['agent', 'copilot', 'idle'], ['agent', 'droid', 'working'],
        ['agent', 'brand-new-cli', 'idle'],
      ];
      const specs: PaneSpec[] = zoo.map(([kind, agent, status], i) => ({ ws: Math.floor(i / 5), tab: i % 5 < 3 ? 'agents' : 'pair', kind, agent, status }));
      specs.push({ ws: 2, tab: 'dev', kind: 'shell', proc: SHELL_PROCS.serve[0] });
      return { specs, schedule: true };
    }
    case 'mixed':
    default:
      return { specs: layoutMixed(R, n), schedule: true };
  }
}
