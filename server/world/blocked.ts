/**
 * Blocked prompt detection (DESIGN §4.3, M1), an Enricher (`blocked`: owns `prompt`). Owner: BE.
 * While a pane is blocked: `pane.read {source:'detection', format:'text'}` every 2 s → `parsePrompt` → `prompt`.
 * Leaving blocked stops the poll and clears `prompt` in the same entity update. stateSeq change → re-hash.
 *
 * Parse rules: options are the contiguous run of lines around the `❯` cursor line that are either numbered
 * (`[❯] N. label`) or aligned with the cursor's label column; `selected` = the `❯` line's index; `numbered` = every
 * option has an `N.` prefix. The question is the last non-option paragraph above the options (cut after its first
 * `?` when it has one). hash = promptHash(stateSeq, question, labels) (shared/identity.ts).
 */
import { Enricher } from '../interfaces.ts';
import type { BaseEntity, Clock, EnricherCtx, HerdrSource, Logger, TimerHandle } from '../interfaces.ts';
import { promptHash } from '../../shared/identity.ts';
import { errCode, errMessage, isRecord } from '../../shared/guards.ts';
import type { Prompt, PromptOption } from '../../shared/protocol.ts';

export const BLOCKED_POLL_MS = 2000;
const CURSOR = /^(\s*)[❯›>]\s+(.*)$/u;
const NUMBERED = /^\s*(?:[❯›>]\s+)?(\d{1,2})[.)]\s+(.+?)\s*$/u;
const HINT = /(esc to (cancel|exit|interrupt)|enter to (confirm|select)|↑\/↓|tab to amend|ctrl\+[a-z] to)/i;
const RULE = /^[\s─━—_=╭╮╰╯┌┐└┘│-]+$/u; // separators and TUI box borders (Claude Code draws menus in boxes)

/** Parse the detection `text` of a blocked pane (null when it shows no menu). */
export function parsePrompt(text: string, stateSeq: number | null): Prompt | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/u, ''));
  // the last cursor line wins (older menus may still be in scrollback above)
  let cur = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (CURSOR.test(lines[i]) && !RULE.test(lines[i])) { cur = i; break; }
  let start: number, end: number;
  const optLine = (l: string, col: number | null): boolean => {
    if (!l.trim() || RULE.test(l) || HINT.test(l)) return false;
    if (NUMBERED.test(l)) return true;
    if (CURSOR.test(l)) return true;
    if (col == null) return false;
    const indent = l.length - l.trimStart().length;
    return indent === col;
  };
  let col: number | null = null;
  if (cur >= 0) {
    const m = CURSOR.exec(lines[cur]);
    col = lines[cur].indexOf(m?.[2] ?? ''); // lines[cur] matched CURSOR above
    start = end = cur;
    const numberedMenu = NUMBERED.test(lines[cur]);
    const ok = (l: string): boolean => (numberedMenu ? NUMBERED.test(l) : optLine(l, col));
    while (start > 0 && ok(lines[start - 1])) start--;
    while (end < lines.length - 1 && ok(lines[end + 1])) end++;
  } else {
    // no cursor: the last run of numbered lines
    let i = lines.length - 1;
    while (i >= 0 && !NUMBERED.test(lines[i])) i--;
    if (i < 0) return null;
    end = i;
    start = i;
    while (start > 0 && NUMBERED.test(lines[start - 1])) start--;
  }
  const optLines = lines.slice(start, end + 1);
  if (optLines.length < 2) return null;
  let selected = 0;
  const parsed = optLines.map((l, index) => {
    if (CURSOR.test(l)) selected = index;
    const n = NUMBERED.exec(l);
    const label = (n ? n[2] : l.replace(/^\s*[❯›>]?\s*/u, '')).trim();
    return { key: n ? n[1] : String(index + 1), label, index, isNumbered: !!n };
  });
  const numbered = parsed.every((o) => o.isNumbered);
  const options: PromptOption[] = parsed.map(({ key, label, index }) => ({ key, label, index }));
  if (!numbered) options.forEach((o, i) => (o.key = String(i + 1)));
  // question: last non-empty paragraph above the options, skipping rules/links; prefer one with a '?'
  const paras: string[] = [];
  let buf: string[] = [];
  for (let i = 0; i < start; i++) {
    const l = lines[i].trim();
    if (!l || RULE.test(l)) {
      if (buf.length) paras.push(buf.join(' '));
      buf = [];
    } else buf.push(l);
  }
  if (buf.length) paras.push(buf.join(' '));
  let question = '';
  for (let i = paras.length - 1; i >= 0 && i >= paras.length - 4; i--) {
    if (paras[i].includes('?')) {
      question = paras[i];
      break;
    }
  }
  if (!question) question = paras[paras.length - 1] ?? '';
  const q = question.indexOf('?');
  if (q > 0) question = question.slice(0, q + 1);
  question = question.replace(/^[│|]\s*/, '').slice(0, 400);
  const labels = options.map((o) => o.label);
  return { question, options, selected, numbered, hash: promptHash(stateSeq, question, labels), raw: text.slice(-4000) };
}

/**
 * Keys that answer `prompt` with option `key` (§4.8 step 2): the digit when numbered, else Up/Down × distance + Enter.
 * Returns null if `key` is not an option.
 */
export function answerKeys(prompt: Prompt | null, key: string): string[] | null {
  const opt = prompt?.options.find((o) => o.key === key);
  if (!prompt || !opt) return null;
  if (prompt.numbered) return [opt.key];
  const d = opt.index - prompt.selected;
  return [...Array<string>(Math.abs(d)).fill(d > 0 ? 'Down' : 'Up'), 'Enter'];
}

/** Read + parse the current prompt of a pane. */
export async function readPrompt(source: Pick<HerdrSource, 'request'>, id: string, stateSeq: number | null): Promise<Prompt | null> {
  const r = await source.request('pane.read', { pane_id: id, source: 'detection', format: 'text' });
  const read = isRecord(r) && isRecord(r.read) ? r.read : null;
  return parsePrompt(typeof read?.text === 'string' ? read.text : '', stateSeq);
}

interface Poll {
  timer: TimerHandle | null;
  base: BaseEntity;
  source: HerdrSource | undefined;
  last: Prompt | null;
  inflight: boolean;
}

export class BlockedEnricher extends Enricher {
  clock: Clock;
  log: Pick<Logger, 'debug'>;
  pollMs: number;
  polls: Map<string, Poll>;
  ctx: Map<string, EnricherCtx>;

  constructor({ clock, log, pollMs = BLOCKED_POLL_MS }: { clock: Clock; log?: Pick<Logger, 'debug'>; pollMs?: number }) {
    super('blocked');
    this.clock = clock;
    this.log = log ?? { debug() {} };
    this.pollMs = pollMs;
    this.polls = new Map();
    this.ctx = new Map();
  }

  override attach(id: string, base: BaseEntity, ctx: EnricherCtx): void {
    this.ctx.set(id, ctx);
    this.update(id, base, null);
  }

  override update(id: string, base: BaseEntity, prev: BaseEntity | null): void {
    const p = this.polls.get(id);
    if (base.status === 'blocked') {
      if (!p) {
        const st: Poll = { timer: null, base, source: this.ctx.get(id)?.source, last: null, inflight: false };
        this.polls.set(id, st);
        st.timer = this.clock.setInterval(() => this._poll(id), this.pollMs);
        this._poll(id);
      } else {
        p.base = base;
        if (p.last && prev && prev.stateSeq !== base.stateSeq) {
          const labels = p.last.options.map((o) => o.label);
          this.onPatch(id, { prompt: { ...p.last, hash: promptHash(base.stateSeq ?? null, p.last.question, labels) } });
        }
      }
    } else {
      if (p) this._stop(id);
      if (!prev || prev.status === 'blocked' || p) this.onPatch(id, { prompt: null });
    }
  }

  async _poll(id: string): Promise<void> {
    const p = this.polls.get(id);
    if (!p || p.inflight || !p.source) return;
    p.inflight = true;
    try {
      const pr = await readPrompt(p.source, id, p.base.stateSeq ?? null);
      if (this.polls.get(id) !== p) return;
      if (pr && p.last?.hash === pr.hash && p.last.selected === pr.selected) return;
      p.last = pr;
      this.onPatch(id, { prompt: pr });
    } catch (e) {
      this.log.debug(`blocked poll ${id}: ${errCode(e) ?? errMessage(e)}`);
    } finally {
      p.inflight = false;
    }
  }

  /** Force an immediate re-read (after an answer). */
  refresh(id: string): Promise<void> {
    return this._poll(id);
  }

  _stop(id: string): void {
    const p = this.polls.get(id);
    if (!p) return;
    this.clock.clearInterval(p.timer);
    this.polls.delete(id);
  }

  override detach(id: string): void {
    this._stop(id);
    this.ctx.delete(id);
  }

  metrics(): { pollers: number } {
    return { pollers: this.polls.size };
  }

  override async close(): Promise<void> {
    for (const id of [...this.polls.keys()]) this._stop(id);
  }
}
