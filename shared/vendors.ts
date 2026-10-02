// @pure
/**
 * Which coding-agent CLI runs in a pane (`Entity.vendor`, protocol revision 3). Pure: imported by the server (base
 * entities, the process-info enricher, the demo) and by the renderer (mascots, card labels, gazette wording).
 *
 * Two ways a pane gets a vendor:
 *  1. herdr's own detection: `pane.agent` is a label from herdr's agent manifests ('claude', 'codex', 'gemini',
 *     'opencode', 'copilot', 'cursor', 'amp', 'qwen', 'droid', 'omp', … plus their aliases). `vendorOfLabel`.
 *  2. Our process sniffing, for CLIs herdr does not know (Aider, Goose, Crush) or an older herdr: the pane's
 *     foreground process from `pane.process_info` (name + argv). `vendorOfProcess`. Only unambiguous signals count:
 *     the program's own name (after unwrapping node / python / npx / uvx …), or its npm / PyPI package path in argv.
 *     Generic names stay out (`agent`, `pi`, `grok`), and `goose` only counts when it is not the pressly/goose
 *     database migrator (`goose up`, `goose postgres …`).
 *
 * `Entity.kind` keeps its five values for old renderers: claude / codex / gemini map to themselves, every other
 * vendor is kind 'agent'. A label herdr reports that is not in this table is still an agent (kind 'agent', vendor null).
 */

export const VENDORS = Object.freeze([
  'claude', 'codex', 'gemini', 'aider', 'opencode', 'goose', 'cursor', 'amp', 'crush', 'qwen', 'copilot',
  // herdr knows these too; they have no mascot of their own yet (the valley draws its generic sprout-bot)
  'droid', 'kimi', 'kilo', 'cline', 'grok', 'devin', 'kiro', 'hermes', 'pi', 'antigravity', 'qoder', 'mastra', 'muse', 'maki',
] as const);
export type Vendor = (typeof VENDORS)[number];

export interface VendorInfo {
  /** display name (cards, gazette) */
  label: string;
  /** herdr agent labels that mean this vendor (lower case; the id itself always matches) */
  aliases?: readonly string[];
  /** program names (basename, extension stripped) that mean this vendor when they are the pane's foreground program */
  progs?: readonly string[];
  /** npm / PyPI package names whose path or spec in argv means this vendor (`npx @google/gemini-cli`, …/node_modules/…) */
  pkgs?: readonly string[];
  /** progs only count when launched by a JS runtime (node / bun / npx …): their name alone is too common */
  jsOnly?: boolean;
}

export const VENDOR_INFO: Readonly<Record<Vendor, VendorInfo>> = Object.freeze({
  claude: { label: 'Claude', aliases: ['claude-code', 'claude code'], progs: ['claude'], pkgs: ['@anthropic-ai/claude-code'] },
  codex: { label: 'Codex', aliases: ['codex-cli', 'openai-codex'], progs: ['codex'], pkgs: ['@openai/codex'] },
  gemini: { label: 'Gemini', aliases: ['gemini-cli', 'gemini cli'], progs: ['gemini'], pkgs: ['@google/gemini-cli'] },
  aider: { label: 'Aider', aliases: ['aider-chat'], progs: ['aider'], pkgs: ['aider-chat', 'aider-install'] },
  opencode: { label: 'OpenCode', aliases: ['open-code', 'open_code', 'opencode-ai'], progs: ['opencode'], pkgs: ['opencode-ai'] },
  goose: { label: 'Goose', aliases: ['goose-cli', 'block-goose'], progs: ['goose'] },
  cursor: { label: 'Cursor', aliases: ['cursor-agent', 'cursor-cli'], progs: ['cursor-agent'] },
  amp: { label: 'Amp', aliases: ['amp-local', 'ampcode'], progs: ['amp'], pkgs: ['@sourcegraph/amp'], jsOnly: true },
  crush: { label: 'Crush', aliases: ['charm-crush'], progs: ['crush'], pkgs: ['@charmland/crush'] },
  qwen: { label: 'Qwen', aliases: ['qwen-code', 'qwen code'], progs: ['qwen'], pkgs: ['@qwen-code/qwen-code'] },
  copilot: { label: 'Copilot', aliases: ['github-copilot', 'github_copilot', 'copilot-cli', 'ghcs'], progs: ['copilot'], pkgs: ['@github/copilot'], jsOnly: true },
  droid: { label: 'Droid', aliases: ['factory-droid'], progs: ['droid'] },
  kimi: { label: 'Kimi', aliases: ['kimi-code', 'kimi code', 'kimi-cli'] },
  kilo: { label: 'Kilo', aliases: ['kilo-code', 'kilo code', 'kilocode'], progs: ['kilocode'], pkgs: ['@kilocode/cli'] },
  cline: { label: 'Cline', aliases: ['cline-cli'] },
  grok: { label: 'Grok', aliases: ['grok-build', 'grok-cli'] },
  devin: { label: 'Devin', aliases: ['devin-cli', 'devin cli'] },
  kiro: { label: 'Kiro', aliases: ['kiro-cli'], progs: ['kiro-cli'] },
  hermes: { label: 'Hermes', aliases: ['hermes-agent'] },
  pi: { label: 'Pi', aliases: ['omp', 'oh-my-pi', 'pi-agent'] },
  antigravity: { label: 'Antigravity', aliases: ['agy', 'antigravity-cli', 'antigravity_cli'] },
  qoder: { label: 'Qoder', aliases: ['qodercli', 'qoderclicn', 'qodercn'] },
  mastra: { label: 'Mastra', aliases: ['mastracode', 'mastra-code'] },
  muse: { label: 'Muse', aliases: ['muse-code', 'muse-cli'] },
  maki: { label: 'Maki', aliases: [] },
});

/** The protocol `Kind` a vendor's pane carries (old renderers only know these). */
export function kindOfVendor(v: Vendor | null): 'claude' | 'codex' | 'gemini' | 'agent' {
  return v === 'claude' || v === 'codex' || v === 'gemini' ? v : 'agent';
}

/** Display name: 'OpenCode', or 'Agent' for an unknown one. */
export const vendorLabel = (v: string | null | undefined): string => (v && isVendor(v) ? VENDOR_INFO[v].label : 'Agent');

export const isVendor = (v: unknown): v is Vendor => typeof v === 'string' && (VENDORS as readonly string[]).includes(v);

const BY_LABEL: ReadonlyMap<string, Vendor> = (() => {
  const m = new Map<string, Vendor>();
  for (const v of VENDORS) {
    m.set(v, v);
    for (const a of VENDOR_INFO[v].aliases ?? []) m.set(a, v);
  }
  return m;
})();

/** herdr `pane.agent` label → vendor ('herdr:opencode', 'Claude-Code', 'qwen code' all resolve); null when unknown. */
export function vendorOfLabel(label: string | null | undefined): Vendor | null {
  if (!label) return null;
  const l = String(label).trim().toLowerCase().replace(/^herdr:/, '');
  return BY_LABEL.get(l) ?? BY_LABEL.get(l.replace(/[_\s]+/g, '-')) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Process sniffing

const JS_RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node']);
const PY_RUNTIMES = /^(python|pypy)(\d+(\.\d+)?)?$/;
/** launchers whose next word(s) name the real program */
const LAUNCHERS = new Set(['env', 'sudo', 'exec', 'nice', 'nohup', 'time', 'npx', 'pnpx', 'bunx', 'uvx', 'pipx', 'uv', 'npm', 'pnpm', 'yarn', 'poetry', 'pipenv', 'mise', 'asdf', 'rtx']);
/** launcher sub-commands to skip (`npm exec x`, `uv run x`, `pipx run x`, `bun x`, `deno run`) */
const LAUNCH_SUB = new Set(['exec', 'x', 'run', 'dlx', 'tool']);
const PROG_OF: ReadonlyMap<string, Vendor> = (() => {
  const m = new Map<string, Vendor>();
  for (const v of VENDORS) for (const p of VENDOR_INFO[v].progs ?? []) m.set(p, v);
  return m;
})();
const PKG_RE: readonly [RegExp, Vendor][] = VENDORS.flatMap((v) => (VENDOR_INFO[v].pkgs ?? []).map((p): [RegExp, Vendor] =>
  [new RegExp(`(^|[/\\\\])${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|[/\\\\@])`, 'i'), v]));

const base = (p: string): string => (p.split(/[/\\]/).pop() ?? '').toLowerCase();
const stem = (p: string): string => base(p).replace(/\.(m?js|cjs|ts|py|exe|cmd|sh)$/, '');

/** pressly/goose (the DB migrator) shares the name: its argv always names a command or a driver. */
const GOOSE_AGENT_SUBS = new Set(['session', 's', 'run', 'web', 'recipe', 'term', 'acp', 'mcp']);
function gooseIsAgent(rest: readonly string[]): boolean {
  const sub = rest.find((a) => !a.startsWith('-'));
  return sub === undefined || GOOSE_AGENT_SUBS.has(sub);
}

/**
 * The vendor of a foreground process, or null. `name` = the process name (comm), `argv` = its argv (array or a
 * command line). Shebang scripts report their own name (`aider`) with argv[0] the interpreter; npm bins run as
 * `node /usr/local/bin/gemini …`; `npx @google/gemini-cli` names the package.
 */
export function vendorOfProcess(name: string | null | undefined, argvIn?: readonly string[] | string | null): Vendor | null {
  const argv = (Array.isArray(argvIn) ? argvIn.map(String) : String(argvIn ?? '').split(/\s+/)).filter(Boolean);
  // 1. a package path / spec anywhere in the first few words
  for (const a of argv.slice(0, 6)) for (const [re, v] of PKG_RE) if (re.test(a)) return v;
  // 2. unwrap runtimes and launchers to the program word
  let i = 0, js = false;
  for (let guard = 0; i < argv.length && guard < 8; guard++) {
    const w = base(argv[i]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) { i++; continue; } // env assignment
    if (JS_RUNTIMES.has(w) || PY_RUNTIMES.test(w)) {
      js ||= JS_RUNTIMES.has(w);
      i++;
      // runtime flags (`node --no-warnings`, `python -X utf8`), `python -m aider`
      while (i < argv.length && argv[i].startsWith('-')) {
        if (argv[i] === '-m' && argv[i + 1]) { i++; break; }
        i += /^-(X|W)$/.test(argv[i]) ? 2 : 1;
      }
      continue;
    }
    if (LAUNCHERS.has(w)) {
      if (w === 'npx' || w === 'pnpx' || w === 'bunx' || w === 'npm' || w === 'pnpm' || w === 'yarn') js = true;
      i++;
      while (i < argv.length && (argv[i].startsWith('-') || LAUNCH_SUB.has(argv[i]))) i++;
      continue;
    }
    break;
  }
  const candidates: [string, number][] = [];
  if (i < argv.length) candidates.push([stem(argv[i]), i + 1]);
  // a shebang script: comm is the script's own name even though argv[0] is the interpreter
  if (name && !/\s/.test(name)) candidates.push([stem(name), argv.length && stem(argv[0]) === stem(name) ? 1 : -1]);
  for (const [prog, next] of candidates) {
    const v = PROG_OF.get(prog);
    if (!v) continue;
    if (VENDOR_INFO[v].jsOnly && !js) continue;
    if (v === 'goose' && (next < 0 || !gooseIsAgent(argv.slice(next)))) continue; // unknown argv: could be the migrator
    return v;
  }
  return null;
}

/** herdr `pane.process_info` (the fields read here). */
export interface ProcInfoLike {
  foreground_process_group_id?: number;
  foreground_processes?: { pid: number; name: string; argv?: string[]; cmdline?: string }[];
}

/**
 * The vendor running in a pane, from herdr `pane.process_info`: the foreground group leader first, then any other
 * foreground process (`npx` hands over to node). Null when nothing matches.
 */
export function vendorOfInfo(info: ProcInfoLike | null | undefined): Vendor | null {
  const list = info?.foreground_processes ?? [];
  const lead = list.find((p) => p.pid === info?.foreground_process_group_id);
  for (const p of lead ? [lead, ...list.filter((x) => x !== lead)] : list) {
    const raw = Array.isArray(p.argv) && p.argv.length ? p.argv : String(p.cmdline ?? '').split(/\s+/);
    const words = raw.length === 1 && /\s/.test(raw[0]) ? raw[0].split(/\s+/) : raw;
    const v = vendorOfProcess(p.name, words);
    if (v) return v;
  }
  return null;
}
