/**
 * FakeTerminals: the demo `TerminalBackend`. One fake PTY per pane, rendered into an
 * `@xterm/headless` screen so frames look like herdr's: rendered-screen ANSI wrapped in synchronized-output markers,
 * the first frame of every handle (and every frame after a resize) is `full` (`ESC[2J` + serialized screen).
 *
 * Behaviour mirrors herdr:
 *   - observe handles ignore input and never resize the PTY; control handles type and resize.
 *   - a second control open without `takeover` closes with "already has an attached client"; with `takeover` the old
 *     controller closes with "terminal attach taken over".
 *   - release → closed "terminal session detached"; an unknown pane → "terminal target … not found".
 * Shell panes get a bash-ish prompt; agent panes get a mock Claude Code box. Both echo, and understand
 * `help`, `ls`, `clear`, `pwd`, `echo …`, `seq N` (scrollback for scroll tests).
 *
 * Agent panes also run a live mock TUI fed from the pane's entity (tool lines, thinking, the blocked menu, a "worked
 * for" footer); shells print the foreground command DemoWorld runs. Owner: BE2.
 */
import xtermHeadless from '@xterm/headless';
import serializePkg from '@xterm/addon-serialize';
import { TerminalBackend, TerminalHandle } from '../interfaces.ts';
import type { Clock, TerminalOpenOpts, TimerHandle } from '../interfaces.ts';
import { LIMITS } from '../../shared/protocol.ts';
import type { Activity, Entity, Status, ToolClass } from '../../shared/protocol.ts';

/**
 * What describe(id) returns for a pane: at least {kind, name, cwd}; DemoWorld hands over the whole Entity (the mock TUI
 * reads activity/status/prompt from it), replay only {kind, name, cwd, title}.
 */
export type PaneInfo = Pick<Entity, 'kind' | 'name' | 'cwd'> & Partial<Omit<Entity, 'kind' | 'name' | 'cwd'>>;
/** One line of a demo shell's printed-line ring (DemoWorld facts.out). */
export interface OutLine { seq: number; text: string; kind: string }
/** `pane.read`-shaped options / result. */
export interface ReadOpts { source?: string; format?: string; lines?: number }
export interface ReadResult { text: string; revision: number }

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializePkg;

const SYNC_ON = '\x1b[?2026h';
const SYNC_OFF = '\x1b[?2026l';
const te = new TextEncoder();
const td = new TextDecoder();
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.max(lo, Math.min(hi, Math.round(v)));

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', blue: '\x1b[34m', orange: '\x1b[38;5;173m', gray: '\x1b[90m' };

/** One fake pane PTY: screen model + line discipline. */
/** What the mock TUI already printed for an agent pane. */
interface Fed { status: Status | undefined; act: string | null; prompt: string | null; startedAt: number; seeded: boolean }

class FakePty {
  id: string;
  info: PaneInfo;
  cols: number;
  rows: number;
  line: string;
  escape: string;
  revision: number;
  handles: Set<FakeHandle>;
  controller: FakeHandle | null;
  term: InstanceType<typeof Terminal>;
  ser: InstanceType<typeof SerializeAddon>;
  agent: boolean;
  /** a human typed here: this PTY, not the DemoWorld line log, is now the pane's truth */
  touched = false;
  /** a spinner line sits above the cursor */
  spin = false;
  ticks = 0;
  _fed: Fed | null = null;
  /** argv of the full-screen app on the alternate screen, else null */
  alt: string | null = null;
  /** highest DemoWorld line `seq` already printed */
  outSeq = 0;
  /** created by a monitor read and never viewed */
  lazy = false;
  /** pane-global scroll offset (herdr semantics) */
  scrollOffset = 0;
  constructor(id: string, info: PaneInfo, cols: number, rows: number) {
    this.id = id;
    this.info = info;
    this.cols = cols;
    this.rows = rows;
    this.line = '';
    this.escape = '';
    this.revision = 0;
    this.handles = new Set();
    this.controller = null;
    this.term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
    this.ser = new SerializeAddon();
    this.term.loadAddon(this.ser);
    this.agent = info.kind !== 'shell';
    this._banner();
  }

  _home(): string {
    return (this.info.cwd || '~').replace(/^\/home\/[^/]+/, '~');
  }
  prompt(): string {
    return this.agent ? `${C.orange}>${C.reset} ` : `${C.green}${C.bold}demo@hq${C.reset}:${C.blue}${C.bold}${this._home()}${C.reset}$ `;
  }
  _banner(): void {
    if (this.agent) {
      const w = Math.max(24, Math.min(this.cols - 2, 60));
      const row = (text: string, vis: number) => `${C.orange}│${C.reset} ${text}${' '.repeat(Math.max(0, w - 3 - vis))}${C.orange}│${C.reset}\r\n`;
      const product = this.info.kind === 'codex' ? 'Codex (demo)' : 'Claude Code (demo)';
      const cwd = this._home().slice(0, w - 8);
      this.emit(`${C.orange}╭${'─'.repeat(w - 2)}╮${C.reset}\r\n`);
      this.emit(row(`${C.orange}✻${C.reset} Welcome to ${C.bold}${product}${C.reset}`, 13 + product.length));
      this.emit(row(`${C.gray}cwd: ${cwd}${C.reset}`, 5 + cwd.length));
      this.emit(`${C.orange}╰${'─'.repeat(w - 2)}╯${C.reset}\r\n\r\n`);
      if (this.info.title) this.emit(`${C.gray}⏺ Last task: ${this.info.title}${C.reset}\r\n\r\n`);
      this.emit(`${C.dim}Type a message (demo echo; try "help").${C.reset}\r\n`);
    } else {
      this.emit(`${C.dim}demo shell for ${this.info.name} — try "help"${C.reset}\r\n`);
    }
    this.emit(this.prompt());
  }

  /** Write output: into the screen model and to every handle as a diff frame. */
  emit(s: string): void {
    this.revision++;
    this.term.write(s);
    const bytes = te.encode(SYNC_ON + s + SYNC_OFF);
    for (const h of this.handles) if (h.started) h._frame(bytes, false);
  }

  /** Serialized full screen (a `full` frame). */
  full(): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve) => {
      this.term.write('', () => {
        const body = this.ser.serialize({ scrollback: 0 });
        resolve(te.encode(`${SYNC_ON}\x1b[H\x1b[2J${body}${SYNC_OFF}`));
      });
    });
  }

  /** `s` = input from the controller */
  input(s: string): void {
    this.touched = true; // a human typed here: this PTY, not the DemoWorld line log, is now the pane's truth
    for (const ch of s) {
      if (this.escape) {
        this.escape += ch;
        // CSI ends with a final byte 0x40–0x7e; SS3 (ESC O x) after one char; lone ESC+char otherwise
        if (this.escape.length === 2 && ch !== '[' && ch !== 'O') this.escape = '';
        else if (this.escape.length > 2 && (this.escape[1] === 'O' || /[@-~]/.test(ch))) this.escape = '';
        continue;
      }
      if (ch === '\x1b') this.escape = ch;
      else if (ch === '\r' || ch === '\n') {
        const cmd = this.line;
        this.line = '';
        this.spin = false; // the spinner line above stays behind as history
        this.emit('\r\n');
        this._run(cmd.trim());
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.line) {
          this.line = [...this.line].slice(0, -1).join('');
          this.emit('\b \b');
        }
      } else if (ch === '\x03') {
        this.line = '';
        this.emit('^C\r\n' + this.prompt());
      } else if (ch === '\x0c') this._clear();
      else if (ch === '\x15') {
        this.emit('\b \b'.repeat([...this.line].length));
        this.line = '';
      } else if (ch >= ' ') {
        this.line += ch;
        this.emit(ch);
      }
    }
  }

  _clear(): void {
    this.spin = false;
    this.emit('\x1b[H\x1b[2J\x1b[3J' + this.prompt() + this.line);
  }

  _run(cmd: string): void {
    const [name, ...args] = cmd.split(/\s+/);
    const out = (s: string) => this.emit(s.replace(/\n/g, '\r\n'));
    switch (name) {
      case '':
        break;
      case 'help':
        out(`${C.bold}demo terminal${C.reset}: help, ls, pwd, echo TEXT, seq N (≤ 100000), clear, date\n`);
        break;
      case 'ls':
        out(`${C.blue}${C.bold}docs${C.reset}  ${C.blue}${C.bold}renderer${C.reset}  ${C.blue}${C.bold}server${C.reset}  ${C.blue}${C.bold}shared${C.reset}  package.json  README.md\n`);
        break;
      case 'pwd':
        out(`${this.info.cwd || '/'}\n`);
        break;
      case 'echo':
        out(args.join(' ') + '\n');
        break;
      case 'date':
        out('demo time\n');
        break;
      case 'clear':
        this._clear();
        return;
      case 'seq': {
        const n = Math.max(0, Math.min(100_000, Number.parseInt(args[0] ?? '10', 10) || 0));
        let chunk = '';
        for (let i = 1; i <= n; i++) {
          chunk += `${i}\n`;
          if (chunk.length > 32_768) {
            out(chunk);
            chunk = '';
          }
        }
        if (chunk) out(chunk);
        break;
      }
      default:
        if (this.agent) out(`${C.orange}⏺${C.reset} (demo) I would work on: ${cmd.slice(0, 200)}\n\n`);
        else out(`bash: ${name}: command not found\n`);
    }
    this.emit(this.prompt());
  }

  resize(cols: number, rows: number): boolean {
    if (cols === this.cols && rows === this.rows) return false;
    this.cols = cols;
    this.rows = rows;
    this.term.resize(cols, rows);
    this.revision++;
    return true;
  }

  /**
   * Text/ANSI read like `pane.read` (source visible|recent|recent_unwrapped|detection).
   */
  async read({ source = 'visible', format = 'text', lines = 200 }: ReadOpts = {}): Promise<ReadResult> {
    await new Promise<void>((r) => this.term.write('', r)); // headless parses writes asynchronously
    const buf = this.term.buffer.active;
    if (format === 'ansi') {
      const sb = source === 'visible' ? 0 : Math.max(0, (lines ?? 200) - this.rows);
      return { text: this.ser.serialize({ scrollback: sb }), revision: this.revision };
    }
    const all: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const l = buf.getLine(i);
      if (!l) continue;
      const s = l.translateToString(true);
      if (source === 'recent_unwrapped' && l.isWrapped && all.length) all[all.length - 1] += s;
      else all.push(s);
    }
    while (all.length && all[all.length - 1] === '') all.pop();
    const n = source === 'visible' || source === 'detection' ? this.rows : lines ?? 200;
    return { text: all.slice(-n).join('\n'), revision: this.revision };
  }

  dispose(): void {
    for (const h of [...this.handles]) h._closed({ code: 0, reason: 'terminal attach ended: terminal not found' });
    this.term.dispose();
  }

  /**
   * Live mock TUI: render what the pane's entity is doing, like Claude Code / a shell would print it.
   *   agents: tool lines (⏺ Tool(detail) / ⎿ result), thinking, the blocked menu, a live spinner status line above
   *     the input line while working ("✻ Clauding… (34s · ↓ 2.1k tokens)"), a "worked for" footer when the turn ends;
   *   shells: the command lines + output the DemoWorld shell printed (`out`, its line ring), and full-screen apps
   *     drawn in the alternate screen (a top/htop/btop/watch monitor, a vim/nvim/hx editor) while they run.
   * The user's half-typed line is restored after each insert.
   * `e` = describe(id); `now` = server clock ms (spinner elapsed time).
   */
  feed(e: PaneInfo | null | undefined, out: OutLine[] | null = null, now: number = e?.statusSince ?? 0): void {
    if (!e) return;
    this.ticks = this.ticks + 1;
    if (!this.agent) return this._feedShell(e, out);
    const prev: Fed = this._fed ?? { status: e.status, act: null, prompt: null, startedAt: e.statusSince ?? 0, seeded: false };
    this._fed = prev;
    const lines: string[] = [];
    if (!prev.seeded) {
      prev.seeded = true;
      lines.push(...seedLines(e, this.id));
    }
    const a = e.activity;
    const actKey = a ? `${a.tool}|${a.cls}|${a.detail}` : null;
    if (e.status === 'working' && prev.status !== 'working') prev.startedAt = e.statusSince ?? 0;
    if (a && e.status === 'working' && actKey && actKey !== prev.act) {
      if (a.tool) lines.push(`${C.green}⏺${C.reset} ${C.bold}${a.tool}${C.reset}(${a.detail ?? ''})`, `  ${C.gray}⎿  ${toolLine(a)}${C.reset}`);
      else if (a.cls === 'think') lines.push(`${C.orange}✻${C.reset} ${C.gray}Thinking…${C.reset}`);
      else if (a.cls === 'compact') lines.push(`${C.orange}✻${C.reset} ${C.gray}Compacting conversation…${C.reset}`);
      else lines.push(`${C.orange}⏺${C.reset} ${talkLine(e, this.ticks)}`);
    }
    prev.act = actKey;
    const pr = e.prompt;
    const ph = pr?.hash ?? null;
    if (e.status === 'blocked' && pr && ph !== prev.prompt) {
      if (pr.raw) {
        // the detection text herdr read (the real menu, context lines included): borders tinted, question bold
        for (const l of String(pr.raw).split('\n').slice(-40)) {
          if (/^[╭╰]/.test(l)) lines.push(`${C.orange}${l.slice(0, this.cols)}${C.reset}`);
          else if (l.trim() === pr.question) lines.push(`${C.bold}${l}${C.reset}`);
          else lines.push(l.replace(/^(\s*)❯/, `$1${C.orange}❯${C.reset}`));
        }
      } else {
        const w = Math.max(30, Math.min(this.cols - 2, 76));
        lines.push(`${C.orange}╭${'─'.repeat(w - 2)}╮${C.reset}`, ` ${C.bold}${pr.question}${C.reset}`, '');
        pr.options.forEach((o, i) => lines.push(`${i === pr.selected ? `${C.orange}❯${C.reset}` : ' '} ${pr.numbered ? `${o.key}. ` : ''}${o.label}`));
        lines.push(`${C.orange}╰${'─'.repeat(w - 2)}╯${C.reset}`);
      }
    }
    prev.prompt = ph;
    if (prev.status === 'working' && (e.status === 'done' || e.status === 'idle')) {
      const secs = Math.max(1, Math.round(((e.statusSince ?? 0) - (prev.startedAt ?? 0)) / 1000));
      lines.push(`${C.orange}✻${C.reset} ${C.gray}Worked for ${secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}${C.reset}`, '');
    }
    prev.status = e.status;
    const spin = e.status === 'working' ? spinnerLine(e, this.ticks, now) : null;
    if (lines.length || spin || this.spin) this._tail(lines, spin);
  }

  /**
   * Rewrite the bottom of the screen: new content lines, then the spinner line (if any), then the input line with the
   * user's half-typed text. A previous spinner line (the line above the cursor) is overwritten in place.
   */
  _tail(lines: string[], spin: string | null): void {
    let s = this.spin ? '\x1b[1A\r' : '\r';
    for (const l of lines) s += `\x1b[2K${l}\r\n`;
    if (spin) s += `\x1b[2K${spin}\r\n`;
    s += `\x1b[2K${this.prompt()}${this.line}`;
    this.spin = !!spin;
    this.emit(s);
  }

  _feedShell(e: PaneInfo, out: OutLine[] | null): void {
    const argv = e.process?.argv ?? null;
    const act = e.process?.activity ?? 'prompt';
    const full = (act === 'monitor' && !/^tail\b/.test(argv ?? '')) || act === 'edit';
    if (full) {
      if (!this.alt) this.emit('\x1b[?1049h');
      this.alt = argv;
      this.emit(`\x1b[H\x1b[2J${fullScreen(act, argv, this.cols, this.rows, this.ticks, this.id)}`);
    } else if (this.alt) {
      this.emit('\x1b[?1049l');
      this.alt = null;
    }
    const fresh = (out ?? []).filter((l) => l.seq > this.outSeq);
    if (!fresh.length) return;
    this.outSeq = fresh[fresh.length - 1].seq;
    if (full) return; // the command line is behind the alternate screen; it shows again on exit
    const running = act !== 'prompt';
    let s = '\r\x1b[2K';
    for (const l of fresh.slice(-this.rows * 2)) s += l.kind === 'cmd' ? `${this.prompt()}${l.text}\r\n` : `${KIND_COLOR[l.kind] ?? ''}${l.text}${C.reset}\r\n`;
    if (!running) s += this.prompt() + this.line;
    this.emit(s);
  }
}

const KIND_COLOR: Record<string, string> = { out: '', dim: C.gray, ok: C.green, err: '\x1b[31m', cmd: '' };
const VERBS = ['Clauding', 'Pondering', 'Noodling', 'Percolating', 'Reticulating', 'Tinkering', 'Brewing', 'Whirring', 'Scheming', 'Moseying'];
const STAR = ['✻', '✳', '✢', '·', '✢', '✳'];
/** Claude Code's live status line while working. */
function spinnerLine(e: PaneInfo, tick: number, now: number): string {
  const secs = Math.max(0, Math.round((now - (e.statusSince ?? now)) / 1000));
  const verb = VERBS[(hashStr(e.id ?? e.name ?? '') + Math.floor(tick / 20)) % VERBS.length];
  const tok = e.outputTokens ? `↓ ${(e.outputTokens / 1000).toFixed(1)}k tokens` : 'esc to interrupt';
  return `${C.orange}${STAR[tick % STAR.length]}${C.reset} ${C.orange}${verb}…${C.reset} ${C.gray}(${secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`} · ${tok})${C.reset}`;
}
const hashStr = (s: unknown): number => {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return h >>> 0;
};
/** A few plausible earlier transcript lines so a freshly opened monitor/drawer is not empty. */
function seedLines(e: PaneInfo, id: string): string[] {
  const h = hashStr(id);
  const out: string[] = [];
  if (e.lastPrompt) out.push(`${C.gray}>${C.reset} ${String(e.lastPrompt).slice(0, 120)}`, '');
  if (e.kind !== 'claude' || !e.lastPrompt) return out;
  const pool = [['Read', 'store.ts', 'Read 214 lines'], ['Grep', 'applyEntity', 'Found 9 matches'], ['Bash', 'git status', 'On branch main'],
    ['Edit', 'ws.ts', 'Updated with 6 additions and 3 removals'], ['Glob', 'src/**/*.ts', 'Found 42 files'], ['Read', 'README.md', 'Read 88 lines']];
  for (let i = 0; i < 3; i++) {
    const [t, d, r] = pool[(h + i * 7) % pool.length];
    out.push(`${C.green}⏺${C.reset} ${C.bold}${t}${C.reset}(${d})`, `  ${C.gray}⎿  ${r}${C.reset}`);
  }
  out.push('');
  return out;
}
/** A full-screen app frame (top-ish monitor or a vim-ish editor), fitted to cols×rows. */
function fullScreen(act: string, argv: string | null, cols: number, rows: number, tick: number, id: string): string {
  const h = hashStr(id);
  const r = (k: number): number => {
    const x = Math.sin(h * 0.001 + tick * 1.7 + k * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const fit = (l: string) => l.slice(0, cols);
  const L: string[] = [];
  if (act === 'monitor') {
    if (/^watch\b/.test(argv ?? '')) {
      L.push(`Every 2.0s: ${String(argv).split(' ').slice(3).join(' ') || 'uptime'}`, '');
      L.push(` ${String(10 + (tick % 50)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}:01 up 3 days,  2 users,  load average: ${(0.6 + r(1)).toFixed(2)}, ${(0.5 + r(2)).toFixed(2)}, ${(0.4 + r(3)).toFixed(2)}`);
    } else {
      const cpu = (5 + r(1) * 60).toFixed(1);
      L.push(`${C.bold}top${C.reset} - up 3 days,  load average: ${(0.6 + r(1) * 2).toFixed(2)}, ${(0.5 + r(2)).toFixed(2)}, ${(0.4 + r(3)).toFixed(2)}`);
      L.push(`Tasks: ${300 + Math.floor(r(4) * 30)} total,   ${1 + Math.floor(r(5) * 4)} running`);
      L.push(`%Cpu(s): ${cpu} us,  ${(r(6) * 6).toFixed(1)} sy, ${(95 - Number(cpu)).toFixed(1)} id`);
      L.push(`MiB Mem :  63412.3 total,  ${(18000 + r(7) * 6000).toFixed(1)} free`);
      L.push('');
      L.push(`${C.bold}    PID USER      %CPU  %MEM COMMAND${C.reset}`);
      const procs = ['node', 'claude', 'vite', 'herdr', 'python3', 'chrome', 'postgres', 'dockerd', 'bash', 'sshd'];
      for (let i = 0; i < Math.min(procs.length, rows - 7); i++) {
        L.push(`${String(4000 + ((h + i * 97) % 5000)).padStart(7)} demo    ${(r(10 + i) * (40 / (i + 1))).toFixed(1).padStart(5)} ${(r(30 + i) * 4).toFixed(1).padStart(5)} ${procs[(h + i) % procs.length]}`);
      }
    }
  } else {
    // editor: numbered code lines, a moving cursor line, a status line
    const code = ['import { applyEntity } from "./store";', '', 'export function route(req) {', '  const cursor = req.query.cursor;',
      '  if (!cursor) return firstPage();', '  // TODO: stable ordering under inserts', '  return pageAfter(decode(cursor));', '}', '',
      'function decode(c) {', '  return JSON.parse(atob(c));', '}'];
    const n = rows - 2;
    const cur = tick % Math.max(1, Math.min(code.length, n));
    for (let i = 0; i < n; i++) {
      if (i < code.length) L.push(`${C.gray}${String(i + 1).padStart(3)}${C.reset} ${i === cur ? '\x1b[7m' : ''}${code[i]}${i === cur ? C.reset : ''}`);
      else L.push(`${C.blue}~${C.reset}`);
    }
    const file = String(argv ?? '').split(' ')[1] ?? '[No Name]';
    L.push(`${tick % 3 === 0 ? `${C.bold}-- INSERT --${C.reset}` : ''}`);
    L.push(`"${file}" ${code.length}L${' '.repeat(Math.max(1, cols - file.length - 20))}${cur + 1},${1 + (tick % 20)}  All`);
  }
  return L.slice(0, rows).map(fit).join('\r\n');
}

const TOOL_LINES: Partial<Record<ToolClass, string>> = {
  read: 'Read 120 lines', search: 'Found 7 matches', edit: 'Updated with 4 additions and 2 removals', write: 'Wrote 48 lines',
  test: 'Running…', build: 'Running…', git: 'Running…', net: 'Running…', bash: 'Running…', web: 'Fetching…', task: 'Running subagent…',
  todo: 'Updated todos', mcp: 'Called MCP tool', other: 'Done',
};
const toolLine = (a: Activity): string => (a.cls && TOOL_LINES[a.cls]) ?? 'Running…';
const TALK = ['Let me look at how this is wired first.', 'Found it — the cursor was decoded twice.', 'Tests are green; tidying up.',
  'That approach would break the old keys, so I will keep both.', 'Running the suite once more to be sure.', 'I will split this into two smaller edits.'];
const talkLine = (e: PaneInfo, tick = 0): string => (e.title && tick % 3 === 0 ? `Working on: ${e.title}` : TALK[(hashStr(e.id ?? '') + tick) % TALK.length]);
const procLine = (p: { activity: string }): string =>
  (({ edit: '(editor open)', test: 'running tests…', serve: 'listening on http://127.0.0.1:5173/', monitor: '(refreshing every 2s)',
    remote: 'Last login: today', repl: '>>> ', git: '', build: 'compiling…', run: '' }) as Record<string, string>)[p.activity] ?? '';

class FakeHandle extends TerminalHandle {
  /** null for a handle on a pane that does not exist: it closes right away */
  pty: FakePty | null;
  mode: TerminalOpenOpts['mode'];
  owner: FakeTerminals;
  override cols: number;
  override rows: number;
  started: boolean;
  constructor(pty: FakePty | null, mode: TerminalOpenOpts['mode'], owner: FakeTerminals, cols: number, rows: number) {
    super();
    this.pty = pty;
    this.mode = mode;
    this.owner = owner;
    this.cols = cols;
    this.rows = rows;
    this.started = false;
  }
  override async input(bytes: Uint8Array): Promise<void> {
    if (this.closedWith || this.mode !== 'control') return; // observe ignores input (herdr)
    this.pty?.input(td.decode(bytes));
  }
  override resize(cols: number, rows: number): void {
    if (this.closedWith || this.mode !== 'control') return; // observe never resizes the PTY
    this.cols = clamp(cols, LIMITS.cols);
    this.rows = clamp(rows, LIMITS.rows);
    if (this.pty?.resize(this.cols, this.rows)) this.owner._redraw(this.pty);
  }
  /** herdr: ignored under observe; under control it moves the PANE-GLOBAL offset (every viewer's view). */
  override scroll(dir: 'up' | 'down' | 'bottom', lines = 1): void {
    if (this.closedWith || this.mode !== 'control' || !this.pty) return;
    const pty = this.pty;
    const max = Math.max(0, pty.term.buffer.active.length - pty.rows);
    const n = Math.max(0, Math.round(Number(lines) || 0));
    pty.scrollOffset = dir === 'bottom' ? 0 : Math.max(0, Math.min(max, pty.scrollOffset + (dir === 'up' ? n : -n)));
  }
  override async release(): Promise<void> {
    this._detach('terminal session detached');
  }
  _detach(reason: string): void {
    if (this.closedWith) return;
    this.pty?.handles.delete(this);
    if (this.pty?.controller === this) this.pty.controller = null;
    this._closed({ code: 0, reason });
  }
}

/** Demo TerminalBackend. */
export interface FakeTerminalsOpts {
  clock: Clock;
  /** the pane's Entity (at least {kind, name, cwd, title}), or null if the pane does not exist */
  describe: (id: string) => PaneInfo | null;
  feedMs?: number;
  /** id → the demo shell's printed-line ring (DemoWorld facts.out), or null */
  output?: ((id: string) => OutLine[] | null) | null;
  lazyGrid?: { cols: number; rows: number };
}

export class FakeTerminals extends TerminalBackend {
  clock: Clock;
  describe: (id: string) => PaneInfo | null;
  output: ((id: string) => OutLine[] | null) | null;
  lazyGrid: { cols: number; rows: number };
  feedMs: number;
  ptys: Map<string, FakePty>;
  _feedTimer: TimerHandle | null;
  constructor({ clock, describe, feedMs = 1000, output = null, lazyGrid = { cols: 100, rows: 30 } }: FakeTerminalsOpts) {
    super();
    this.clock = clock;
    this.describe = describe;
    this.output = output;
    this.lazyGrid = lazyGrid;
    this.feedMs = feedMs;
    this.ptys = new Map();
    this._feedTimer = null;
  }

  /** While any fake PTY exists, re-describe each one every second and feed its mock TUI (FakePty.feed). */
  _feedLoop(): void {
    if (this.ptys.size && !this._feedTimer) {
      this._feedTimer = this.clock.setInterval(() => {
        for (const [id, pty] of this.ptys) {
          try {
            pty.feed(this.describe(id), this.output?.(id) ?? null, this.clock.now());
          } catch {}
        }
      }, this.feedMs);
    } else if (!this.ptys.size && this._feedTimer) {
      this.clock.clearInterval(this._feedTimer);
      this._feedTimer = null;
    }
  }

  override open(id: string, { mode = 'observe', cols = 80, rows = 24, takeover = false }: Partial<TerminalOpenOpts> = {}): FakeHandle {
    cols = clamp(cols, LIMITS.cols);
    rows = clamp(rows, LIMITS.rows);
    const info = this.describe(id);
    let pty = this.ptys.get(id);
    if (!info) {
      const h = new FakeHandle(pty ?? null, mode, this, cols, rows);
      this.clock.setTimeout(() => h._closed({ code: 0, reason: `terminal session ${mode} failed: terminal target ${id} not found` }), 0);
      return h;
    }
    if (!pty) {
      pty = this._create(id, info, cols, rows);
    } else if (pty.lazy && !pty.handles.size) {
      // created by a monitor read, never viewed: the first opener sizes it (as if it had just been created)
      pty.lazy = false;
      pty.resize(cols, rows);
      pty.term.write('\x1b[H\x1b[2J\x1b[3J');
      pty._fed = null;
      pty.outSeq = 0;
      pty.spin = false;
      pty._banner();
      pty.feed(info, this.output?.(id) ?? null, this.clock.now());
    }
    const h = new FakeHandle(pty, mode, this, cols, rows);
    if (mode === 'control') {
      if (pty.controller && !takeover) {
        this.clock.setTimeout(() => h._closed({ code: 0, reason: `terminal attach failed: terminal term_${id} already has an attached client; retry with --takeover` }), 0);
        return h;
      }
      if (pty.controller) pty.controller._detach('terminal attach taken over');
      pty.controller = h;
      if (pty.resize(cols, rows)) this._redraw(pty, h);
    } else {
      h.cols = pty.cols;
      h.rows = pty.rows;
    }
    pty.handles.add(h);
    // First frame is async (like a child process) and always `full`.
    this.clock.setTimeout(() => {
      if (h.closedWith) return;
      pty.full().then((bytes) => {
        if (h.closedWith) return;
        h.started = true;
        h._frame(bytes, true);
      });
    }, 0);
    return h;
  }

  _create(id: string, info: PaneInfo, cols: number, rows: number): FakePty {
    const pty = new FakePty(id, info, cols, rows);
    this.ptys.set(id, pty);
    pty.feed(info, this.output?.(id) ?? null, this.clock.now());
    this._feedLoop();
    return pty;
  }

  /** After a PTY resize every started handle gets a fresh full frame (herdr: every frame after a resize is full). */
  _redraw(pty: FakePty, except: FakeHandle | null = null): void {
    pty.full().then((bytes) => {
      for (const h of pty.handles) {
        if (h === except || !h.started) continue;
        h.cols = pty.cols;
        h.rows = pty.rows;
        h._frame(bytes, true);
      }
    });
  }

  /** `pane.read`-shaped read for the static source (visible/recent text). */
  async read(id: string, opts?: ReadOpts): Promise<ReadResult> {
    let pty = this.ptys.get(id);
    if (!pty) {
      // desk monitors read panes nobody opened: run the pane's mock TUI anyway (a real pane always has a screen)
      const info = this.describe(id);
      if (!info) return { text: '', revision: 0 };
      const g = info.layoutRect ?? this.lazyGrid; // the pane's own herdr grid, like a real pane
      pty = this._create(id, info, clamp(g.cols, LIMITS.cols), clamp(g.rows, LIMITS.rows));
      pty.lazy = true;
    }
    return pty.read(opts);
  }

  /** True once someone typed into the pane (DemoWorld then serves `pane.read` from this PTY). */
  touched(id: string): boolean {
    return !!this.ptys.get(id)?.touched;
  }

  /** Fake pane-global scroll offset (DemoWorld `pane.get` reports it as `scroll.offset_from_bottom`). */
  scrollOffset(id: string): number {
    return this.ptys.get(id)?.scrollOffset ?? 0;
  }

  /** Pane gone: close its handles ("not found", like herdr). */
  drop(id: string): void {
    const pty = this.ptys.get(id);
    if (!pty) return;
    this.ptys.delete(id);
    pty.dispose();
    this._feedLoop();
  }

  override async close(): Promise<void> {
    for (const id of [...this.ptys.keys()]) this.drop(id);
  }
}
