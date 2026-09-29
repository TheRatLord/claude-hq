import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TranscriptEvent } from './transcriptState.ts';
import type { BaseEntity, EnricherCtx } from '../interfaces.ts';
import type { Entity } from '../../shared/protocol.ts';
import { isRecord } from '../../shared/guards.ts';
import { TranscriptState, testVerdict, toolDetail, modelTier, struggleOf } from './transcriptState.ts';
import { editStats, replaceStats, lineCount, contextWindow } from '../../shared/classify.ts';
import { TranscriptsEnricher, projectSlug, TAIL_BYTES } from './transcripts.ts';
import { RealClock } from '../clock.ts';
import { assertEnricher } from '../interfaces.ts';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
/** One transcript JSONL record, as far as the tests read it */
interface Rec {
  type?: string;
  timestamp?: string;
  message?: { id?: string; model?: string; role?: string; stop_reason?: string | null; content?: unknown; usage?: object };
  [k: string]: unknown;
}
const lines = (f: string): Rec[] => fs.readFileSync(path.join(FIX, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec); // fixtures we wrote

function feedAll(st: TranscriptState, objs: Rec[]): TranscriptEvent[] {
  const ev: TranscriptEvent[] = [];
  for (const o of objs) ev.push(...st.feed(o, 0));
  return ev;
}

test('state: basic session derivations', () => {
  const st = new TranscriptState();
  const ev = feedAll(st, lines('session-basic.jsonl'));
  assert.equal(st.title, 'Coalesce store entity messages');
  assert.equal(st.lastPrompt, 'now make the WS reconnect back off exponentially');
  assert.equal(st.model, 'claude-opus-5-5');
  assert.equal(modelTier(st.model), 'opus');
  assert.equal(st.contextTokens, 3 + 36000 + 400); // latest assistant message.id
  // output tokens: Σ over unique message.id (the 2-block message counts once)
  assert.equal(st.outputTokens, 220 + 90 + 180 + 70 + 300 + 40 + 30 + 60 + 45 + 12 + 50);
  assert.deepEqual(st.todos?.map((t) => t.status), ['completed', 'in_progress', 'pending']);
  assert.deepEqual(ev.filter((e) => e.kind !== 'news').map((e) => e.kind), ['test-fail', 'test-pass', 'error', 'commit']);
  // news (§8.9, M3.5): one per finished turn (the fixture has one end_turn), never per tool result
  assert.deepEqual(ev.filter((e) => e.kind === 'news'), [{ kind: 'news', detail: { src: 'turn', msgs: 1, edits: 1 } }]);
  assert.equal(st.lastText, 'Done: the store now coalesces entity messages per id.');
  // the second prompt started a new task: its work is empty (the first task's Edit does not carry over)
  assert.deepEqual(st.work, { since: Date.parse('2026-09-27T10:00:24.000Z'), added: 0, removed: 0, files: 0 });
  // current tool: the open Bash (node --test) → test class
  const a = st.activity();
  assert.equal(a?.tool, 'Bash');
  assert.equal(a?.cls, 'test');
  assert.equal(a?.detail, 'node --test renderer/src/net/socket.test.js');
});

test('state: slash commands and meta lines are not prompts; think/talk from the last block', () => {
  const st = new TranscriptState();
  const objs = lines('session-basic.jsonl');
  const endTurn = objs.findIndex((o) => o.message?.stop_reason === 'end_turn');
  feedAll(st, objs.slice(0, 4));
  assert.equal(st.lastPrompt, 'make the store apply entity messages eagerly and coalesce per id');
  const st2 = new TranscriptState();
  feedAll(st2, objs.slice(0, endTurn + 1));
  assert.equal(st2.activity(), null, 'end_turn → no activity');
  const st3 = new TranscriptState();
  feedAll(st3, objs.slice(0, objs.length - 1)); // up to the thinking line
  assert.equal(st3.activity()?.cls, 'think');
});

test('state: compaction, subagent + mcp detail, pending AskUserQuestion', () => {
  const st = new TranscriptState();
  const ev = feedAll(st, lines('session-compact-ask.jsonl'));
  assert.deepEqual(ev.filter((e) => e.kind !== 'news').map((e) => e.kind), ['compact']);
  const compactDetail = ev.find((e) => e.kind === 'compact')?.detail;
  assert.ok(isRecord(compactDetail));
  assert.equal(compactDetail.preTokens, 167000);
  assert.equal(st.lastPrompt, 'refactor the renderer boot so the HUD loads last', 'compact summary is not a prompt');
  assert.equal(st.model, 'claude-sonnet-5');
  assert.equal(st.contextTokens, 3 + 20500 + 300);
  const a = st.activity();
  assert.equal(a?.cls, 'ask');
  assert.equal(a?.detail, 'Should the HUD fade in or pop?');
  assert.ok(st.pendingAsk());
});

test('toolDetail + testVerdict', () => {
  assert.equal(toolDetail('Edit', { file_path: '/a/b/c.js' }), 'c.js');
  assert.equal(toolDetail('Bash', { command: 'x'.repeat(100) }).length, 60);
  assert.equal(toolDetail('WebFetch', { url: 'https://nginx.org/en/docs/x.html?q=1' }), 'nginx.org/en/docs/x.html');
  assert.equal(toolDetail('Grep', { pattern: 'foo.*bar' }), 'foo.*bar');
  assert.equal(toolDetail('Agent', { description: 'Find boot order' }), 'Find boot order');
  assert.equal(toolDetail('mcp__playwright__browser_click', {}), 'browser click');
  assert.equal(testVerdict(false, 'Tests: 3 failed, 10 passed'), 'test-fail');
  assert.equal(testVerdict(false, '===== 10 passed in 0.3s ====='), 'test-pass');
  assert.equal(testVerdict(false, 'ℹ tests 12\nℹ pass 12\nℹ fail 0'), 'test-pass');
  assert.equal(testVerdict(false, 'FAIL src/a.test.js'), 'test-fail');
  assert.equal(testVerdict(true, 'whatever'), 'test-fail');
  assert.equal(testVerdict(false, 'test result: ok. 4 passed; 0 failed'), 'test-pass');
});

test('state: struggle ladder (fails, then noEdits)', () => {
  const st = new TranscriptState();
  const mk = (i: number, err: boolean): Rec[] => [
    { type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: err, content: err ? 'Exit code 1' : 'ok 1 pass' }] } },
  ];
  for (let i = 0; i < 3; i++) feedAll(st, mk(i, true));
  assert.deepEqual(st.struggle(0, 1000), { level: 1, reason: 'fails', detail: '3 test fails in a row' });
  feedAll(st, mk(3, true));
  assert.deepEqual(st.struggle(0, 1000), { level: 2, reason: 'fails', detail: '4 test fails in a row' });
  feedAll(st, mk(9, false));
  assert.equal(st.struggle(0, 1000), null);
  assert.deepEqual(st.struggle(0, 12 * 60_000), { level: 1, reason: 'noEdits', detail: 'no edits for 12m while working' });
  assert.deepEqual(st.struggle(0, 21 * 60_000), { level: 2, reason: 'noEdits', detail: 'no edits for 21m while working' });
});

// ----------------------------------------------------------------------------------------------
// Enricher: tailing a real file

function harness(projectsDir: string) {
  const clock = RealClock();
  const e = new TranscriptsEnricher({ clock, projectsDir, staggerMs: 5, pollMs: 25 });
  assertEnricher(e);
  const patches: ({ id: string } & Partial<Entity>)[] = [], events: { id: string; kind: string; detail: unknown }[] = [];
  e.onPatch = (id, p) => void patches.push({ id, ...p });
  e.emitEvent = (id, kind, detail) => void events.push({ id, kind, detail });
  const last = (): Partial<Entity> => patches[patches.length - 1] ?? {};
  return { e, patches, events, last };
}
const until = async (fn: () => unknown, ms = 3000): Promise<void> => {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const base = (o: BaseEntity = {}): BaseEntity => ({ id: 'w1:p1', kind: 'claude', status: 'working', statusSince: Date.now(), cwd: '/home/demo/src/claude-hq',
  identity: { agentSession: 'sess-1', terminalId: 't', place: 'x' }, ...o });

test('enricher: locate, backfill (no events), tail new lines (events), status gating, sinceHint', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-tr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pdir = path.join(dir, projectSlug('/home/demo/src/claude-hq'));
  fs.mkdirSync(pdir);
  const file = path.join(pdir, 'sess-1.jsonl');
  const all = fs.readFileSync(path.join(FIX, 'session-basic.jsonl'), 'utf8').split('\n').filter(Boolean);
  const cut = all.findIndex((l) => l.includes('toolu_04')); // before the failing test
  fs.writeFileSync(file, all.slice(0, cut).join('\n') + '\n');
  const { e, events, last } = harness(dir);
  t.after(() => e.close());
  let hinted = null;
  e.attach('w1:p1', base(), { sinceHint: (ms: number) => (hinted = ms) });
  await until(() => last().title === 'Coalesce store entity messages');
  assert.equal(events.length, 0, 'backfill emits nothing');
  assert.ok(hinted !== null && hinted > 0, 'sinceHint from the last transcript line');
  // append the rest in two writes, the first ending mid-line
  const rest = all.slice(cut).join('\n') + '\n';
  const split = Math.floor(rest.length / 2);
  fs.appendFileSync(file, rest.slice(0, split));
  await new Promise((r) => setTimeout(r, 60));
  fs.appendFileSync(file, rest.slice(split));
  await until(() => events.some((x) => x.kind === 'commit'));
  assert.deepEqual(events.filter((x) => x.kind !== 'news').map((x) => x.kind), ['test-fail', 'test-pass', 'error', 'commit']);
  assert.ok(events.some((x) => x.kind === 'news'), 'tailed lines emit news');
  await until(() => last().activity?.cls === 'test');
  assert.equal(last().activity?.tool, 'Bash');
  // leaving working → activity null in the same (synchronous) update
  e.update('w1:p1', base({ status: 'idle' }));
  assert.equal(last().activity, null);
  assert.equal(last().struggle, null);
  // kind change away from claude → cleared, tail stopped
  e.update('w1:p1', base({ kind: 'shell' }));
  assert.equal(last().model, null);
  assert.equal(e.metrics().panes, 0);
  await e.close();
});

test('enricher: glob fallback, file created late, shrink resets, detach stops everything', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-tr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const other = path.join(dir, '-elsewhere');
  fs.mkdirSync(other);
  const { e, last } = harness(dir);
  t.after(() => e.close());
  e.attach('w1:p1', base({ status: 'blocked' }), {});
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(e.metrics().polls, 1, 'polls while the file does not exist yet');
  const rec = e.recs.get('w1:p1');
  assert.ok(rec);
  rec.lastGlob = -Infinity; // skip the 10 s glob rate limit
  fs.writeFileSync(path.join(other, 'sess-1.jsonl'), fs.readFileSync(path.join(FIX, 'session-compact-ask.jsonl')));
  await until(() => last().model === 'claude-sonnet-5');
  assert.equal(last().activity?.cls, 'ask', 'pending AskUserQuestion shows as ask while not working');
  fs.writeFileSync(path.join(other, 'sess-1.jsonl'), JSON.stringify({ type: 'ai-title', aiTitle: 'Shrunk' }) + '\n');
  await until(() => last().title === 'Shrunk');
  assert.equal(last().model, null, 'state reset on shrink');
  e.detach('w1:p1');
  assert.deepEqual(e.metrics(), { panes: 0, queued: 0, watchers: 0, polls: 0, ticks: 0 });
  await e.close();
});

test('enricher: a 22 MB transcript backfills only the last 512 KB without blocking the loop', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-tr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pdir = path.join(dir, projectSlug('/home/demo/src/claude-hq'));
  fs.mkdirSync(pdir);
  const fixture = fs.readFileSync(path.join(FIX, 'session-basic.jsonl'), 'utf8');
  const reps = Math.ceil((22 * 1024 * 1024) / fixture.length);
  const fd = fs.openSync(path.join(pdir, 'sess-1.jsonl'), 'w');
  for (let i = 0; i < reps; i++) fs.writeSync(fd, fixture);
  fs.closeSync(fd);
  const { e, last } = harness(dir);
  t.after(() => e.close());
  let maxGap = 0, prev = performance.now(), live = true;
  const probe = () => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - prev);
    prev = now;
    if (live) setImmediate(probe);
  };
  setImmediate(probe);
  const t0 = performance.now();
  e.attach('w1:p1', base(), {});
  await until(() => last().title);
  live = false;
  const ms = performance.now() - t0;
  assert.ok(TAIL_BYTES < 22 * 1024 * 1024);
  console.log(`# 22MB backfill ${ms.toFixed(0)} ms, max loop gap ${maxGap.toFixed(1)} ms`);
  assert.ok(ms < 1500, `backfill took ${ms} ms`);
  assert.ok(maxGap < 40, `event loop stalled ${maxGap.toFixed(1)} ms`);
  await e.close();
});

test('state: real (scrubbed) Claude Code transcript from the hqtest fixture agent', () => {
  const objs = lines('real-hqtest-scout.jsonl');
  const st = new TranscriptState();
  const seen = [];
  const ev = [];
  for (const o of objs) {
    ev.push(...st.feed(o, 0));
    const a = st.activity();
    if (a) seen.push(`${a.tool ?? '-'}:${a.cls}`);
  }
  assert.equal(st.model, 'claude-opus-5-5');
  assert.equal(st.title, 'Confirmation message');
  assert.match(st.lastPrompt ?? '', /^Use the Bash tool to run exactly: sleep 6/);
  assert.ok((st.contextTokens ?? 0) > 30_000 && (st.contextTokens ?? 0) < 60_000, `context ${st.contextTokens}`);
  assert.ok((st.outputTokens ?? 0) > 0);
  assert.deepEqual(ev.filter((e) => e.kind !== 'news').map((e) => e.kind), ['test-pass'], 'ls/node --version is plain bash; node --test passes');
  assert.equal(st.activity(), null, 'turn ended');
  // parallel tool_uses: Bash then Read open at once → current = the last one; then think; then the test Bash
  assert.ok(seen.includes('Read:read') && seen.includes('Bash:bash') && seen.includes('Bash:test') && seen.includes('-:think'), seen.join(' '));
});

// ----------------------------------------------------------------------------------------------
// M3.5 (BE2): lastText, work, struggle detail/context, turn-granular news

const T0 = Date.parse('2026-09-28T09:00:00.000Z');
const iso = (s: number): string => new Date(T0 + s * 1000).toISOString();
const prompt = (s: number, text: string): Rec => ({ type: 'user', timestamp: iso(s), message: { role: 'user', content: text } });
const say = (s: number, id: string, text: string, stop: string | null = null, extra: Rec = {}): Rec => ({ type: 'assistant', timestamp: iso(s), ...extra,
  message: { id, model: 'claude-opus-5-5', stop_reason: stop, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } } });
const use = (s: number, id: string, name: string, input: object, extra: Rec = {}): Rec => ({ type: 'assistant', timestamp: iso(s), ...extra,
  message: { id: `m_${id}`, model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const result = (s: number, id: string, isError = false, text = 'ok', extra: Rec = {}): Rec => ({ type: 'user', timestamp: iso(s), ...extra,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: text }] } });

test('classify: lineCount / replaceStats / editStats / contextWindow', () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('a'), 1);
  assert.equal(lineCount('a\n'), 1);
  assert.equal(lineCount('a\nb\nc'), 3);
  assert.deepEqual(replaceStats('a\nb\nc', 'a\nB\nc'), { added: 1, removed: 1 }, 'shared anchor lines do not count');
  assert.deepEqual(replaceStats('x', 'x\ny\nz'), { added: 2, removed: 0 });
  assert.deepEqual(replaceStats('a\nb', ''), { added: 0, removed: 2 });
  assert.deepEqual(editStats('Write', { file_path: '/r/a.js', content: '1\n2\n3\n' }), { added: 3, removed: 0, file: '/r/a.js' });
  assert.deepEqual(editStats('MultiEdit', { file_path: '/r/b.js', edits: [{ old_string: 'a', new_string: 'a\nb' }, { old_string: 'c\nd', new_string: 'e' }] }),
    { added: 2, removed: 2, file: '/r/b.js' });
  assert.equal(editStats('Read', { file_path: '/r/a.js' }), null);
  assert.equal(contextWindow('claude-opus-5-5', 150_000), 200_000);
  assert.equal(contextWindow('claude-opus-5-5', 350_000), 1_000_000);
  assert.equal(contextWindow('claude-sonnet-5[1m]', 10), 1_000_000);
});

test('state: lastText (main chain, collapsed, ≤ 280) + work counts (Edit, MultiEdit, Write; failed/rejected/sidechain skipped; reset on a new prompt)', () => {
  const st = new TranscriptState();
  assert.equal(st.facts().lastText, null);
  assert.equal(st.facts().work, null);
  const ev = feedAll(st, [
    prompt(0, 'add pagination to the orders API'),
    say(1, 'a1', 'Looking at   the\n\nhandler first.'),
    use(2, 'e1', 'Edit', { file_path: '/r/orders.go', old_string: 'func a() {\n\treturn all\n}', new_string: 'func a() {\n\tcur := parse()\n\treturn page(cur)\n}' }),
    result(3, 'e1'),
    use(4, 'm1', 'MultiEdit', { file_path: '/r/orders_test.go', edits: [{ old_string: 'x', new_string: 'x\ny\nz' }, { old_string: 'p\nq', new_string: 'r' }] }),
    result(5, 'm1'),
    use(6, 'w1', 'Write', { file_path: '/r/cursor.go', content: 'package orders\n\nfunc parse() {}\n' }),
    result(7, 'w1'),
    use(8, 'e2', 'Edit', { file_path: '/r/orders.go', old_string: 'q', new_string: 'r\ns' }),
    result(9, 'e2'),
    use(10, 'bad', 'Edit', { file_path: '/r/nope.go', old_string: 'zz', new_string: 'a\nb\nc' }),
    result(11, 'bad', true, 'String to replace not found in file.'),
    use(12, 'rej', 'Write', { file_path: '/r/rej.go', content: '1\n2' }),
    result(13, 'rej', true, "The user doesn't want to proceed with this tool use. The tool use was rejected"),
    use(14, 'side', 'Write', { file_path: '/r/side.go', content: '1\n2' }, { isSidechain: true }),
    result(15, 'side', false, 'ok', { isSidechain: true }),
    say(16, 'sub', 'sub-agent chatter', null, { isSidechain: true }),
    say(17, 'a2', `Done. ${'word '.repeat(80)}`, 'end_turn'),
  ]);
  // Edit: shared first/last line → +2 −1; MultiEdit (+2) + (+1 −2); Write +3; Edit q→r\ns +2 −1
  assert.deepEqual(st.work, { since: T0, added: 2 + 3 + 3 + 2, removed: 1 + 2 + 0 + 1, files: 3 });
  assert.equal(st.lastText?.length, 280);
  assert.ok(st.lastText?.startsWith('Done. word word') && st.lastText.endsWith('…'));
  assert.deepEqual(ev.filter((e) => e.kind === 'news'), [{ kind: 'news', detail: { src: 'turn', msgs: 2, edits: 4 } }]);
  // mid-turn lastText is whitespace-collapsed
  const st2 = new TranscriptState();
  feedAll(st2, [prompt(0, 'x'), say(1, 'a1', 'Looking at   the\n\nhandler first.')]);
  assert.equal(st2.lastText, 'Looking at the handler first.');
  // a slash command / meta line is not a new task; a real prompt resets the counters (lastText stays)
  feedAll(st, [{ type: 'user', timestamp: iso(20), message: { role: 'user', content: '<command-name>/cost</command-name>' } }]);
  assert.equal(st.work.added, 10);
  feedAll(st, [prompt(30, 'now add a limit param')]);
  assert.deepEqual(st.work, { since: T0 + 30_000, added: 0, removed: 0, files: 0 });
  assert.ok(st.lastText?.startsWith('Done.'));
  assert.deepEqual(st.facts().work, st.work);
});

test('state: work with no prompt in view (512 KB backfill mid-task) starts at the first line seen', () => {
  const st = new TranscriptState();
  feedAll(st, [say(5, 'a0', 'continuing'), use(6, 'w', 'Write', { file_path: '/r/a', content: 'a\nb' }), result(7, 'w')]);
  assert.deepEqual(st.work, { since: T0 + 5000, added: 2, removed: 0, files: 1 });
});

test('state: news = one per finished turn, none per tool call (§8.9 M3.5)', () => {
  const st = new TranscriptState();
  const objs: Rec[] = [prompt(0, 'run the tests')];
  for (let i = 0; i < 6; i++) objs.push(use(1 + i * 2, `b${i}`, 'Bash', { command: `ls ${i}` }), result(2 + i * 2, `b${i}`));
  objs.push(say(20, 'a1', 'Thinking out loud', null)); // a text block mid-turn is not a turn end
  objs.push(use(21, 'g', 'Grep', { pattern: 'x' }), result(22, 'g'));
  // a real message: thinking line carrying end_turn BEFORE its text line (same message.id), then turn_duration
  objs.push({ type: 'assistant', timestamp: iso(23), message: { id: 'a2', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '…' }] } });
  let ev = feedAll(st, objs);
  assert.deepEqual(ev.filter((e) => e.kind === 'news'), [], 'no news per tool, per mid-turn text, or for a text-less end line');
  ev = feedAll(st, [say(23, 'a2', 'All green.', 'end_turn'), { type: 'system', subtype: 'turn_duration', timestamp: iso(24), durationMs: 24000 }]);
  assert.deepEqual(ev.filter((e) => e.kind === 'news'), [{ kind: 'news', detail: { src: 'turn', msgs: 2, edits: 0 } }], 'turn_duration does not double-count');
  // a turn whose end line is missing still announces once on turn_duration
  ev = feedAll(st, [prompt(30, 'again'), say(31, 'a3', 'Sure.', null), { type: 'system', subtype: 'turn_duration', timestamp: iso(32) }]);
  assert.deepEqual(ev.filter((e) => e.kind === 'news').map((e) => (isRecord(e.detail) ? e.detail.msgs : undefined)), [1]);
  // an interrupted turn with nothing said is not news
  ev = feedAll(st, [prompt(40, 'stop'), { type: 'user', timestamp: iso(41), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    { type: 'system', subtype: 'turn_duration', timestamp: iso(42) }]);
  assert.equal(ev.filter((e) => e.kind === 'news').length, 0);
});

test('struggle: detail lines + context reason', () => {
  assert.deepEqual(struggleOf({ failStreak: 4, streakFails: 1, failSpanMs: 5 * 60_000 }), { level: 2, reason: 'errors', detail: '4 errors in 5 min' });
  assert.deepEqual(struggleOf({ failStreak: 2, streakFails: 2 }), { level: 1, reason: 'fails', detail: '2 test fails in a row' });
  assert.deepEqual(struggleOf({ failStreak: 0, streakFails: 0, contextTokens: 182_000, model: 'claude-opus-5-5' }),
    { level: 1, reason: 'context', detail: 'context 91% — compaction soon' });
  assert.equal(struggleOf({ failStreak: 0, streakFails: 0, contextTokens: 170_000 }), null, '85% is not over 85%');
  assert.deepEqual(struggleOf({ failStreak: 0, streakFails: 0, contextTokens: 192_000 })?.level, 2);
  assert.equal(struggleOf({ failStreak: 0, streakFails: 0, contextTokens: 400_000 }), null, '400k of a 1M window is fine');
  // tie → the more actionable reason
  assert.equal(struggleOf({ failStreak: 2, streakFails: 2, contextTokens: 182_000 })?.reason, 'fails');
  assert.equal(struggleOf({ failStreak: 0, streakFails: 0, noEditMs: 11 * 60_000, contextTokens: 182_000 })?.reason, 'noEdits');
  // through the state machine: errors span from the lines' timestamps; context from the latest usage
  const st = new TranscriptState();
  const objs = [prompt(0, 'x')];
  for (let i = 0; i < 4; i++) objs.push(use(60 + i * 100, `r${i}`, 'Read', { file_path: '/nope' }), result(61 + i * 100, `r${i}`, true, 'File does not exist.'));
  feedAll(st, objs);
  assert.deepEqual(st.struggle(null, 0), { level: 2, reason: 'errors', detail: '4 errors in 5 min' });
  const st2 = new TranscriptState();
  feedAll(st2, [prompt(0, 'x'), { type: 'assistant', timestamp: iso(1), message: { id: 'big', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'hm' }],
    usage: { input_tokens: 2000, cache_read_input_tokens: 180_000, cache_creation_input_tokens: 0, output_tokens: 10 } } }]);
  assert.deepEqual(st2.struggle(null, 0), { level: 1, reason: 'context', detail: 'context 91% — compaction soon' });
});

test('enricher: lastText + work patch and one news per turn end while tailing; cleared for non-claude', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-tr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pdir = path.join(dir, projectSlug('/home/demo/src/claude-hq'));
  fs.mkdirSync(pdir);
  const file = path.join(pdir, 'sess-1.jsonl');
  const w = (objs: Rec[]): void => fs.appendFileSync(file, objs.map((o) => JSON.stringify(o)).join('\n') + '\n');
  w([prompt(0, 'first')]);
  const { e, events, last } = harness(dir);
  t.after(() => e.close());
  e.attach('w1:p1', base(), {});
  await until(() => last().lastPrompt === 'first');
  assert.deepEqual(last().work, { since: T0, added: 0, removed: 0, files: 0 });
  w([use(1, 'w1', 'Write', { file_path: '/r/a.js', content: 'a\nb\nc' }), result(2, 'w1')]);
  await until(() => last().work?.added === 3);
  assert.equal(events.filter((x) => x.kind === 'news').length, 0, 'a tool result is not news');
  w([say(3, 'a1', 'Wrote a.js.', 'end_turn')]);
  await until(() => last().lastText === 'Wrote a.js.');
  await until(() => events.some((x) => x.kind === 'news'));
  assert.deepEqual(events.filter((x) => x.kind === 'news').map((x) => x.detail), [{ src: 'turn', msgs: 1, edits: 1 }]);
  e.update('w1:p1', base({ kind: 'shell' }));
  assert.equal(last().lastText, null);
  assert.equal(last().work, null);
  await e.close();
});
