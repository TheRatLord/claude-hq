// term.search (rev 5): the per-pane ring buffer, merging fresh reads, the search itself, and the demo server answering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from '../clock.ts';
import { LineRing, Scrollback, cutAround, mergeTail, plainLines, queryWords, searchLines, SEARCH_GAP_MS, PER_PANE } from './scrollback.ts';
import { startApp, connect } from '../test/harness.ts';
import type { SearchResult } from '../../shared/protocol.ts';

test('LineRing: bounded by lines and by bytes, oldest dropped first, long lines cut', () => {
  const r = new LineRing(5, 1_000_000);
  r.push(['a', 'b', 'c'], 1);
  r.push(['d', 'e', 'f', 'g'], 2);
  assert.deepEqual(r.lines.map((l) => l.text), ['c', 'd', 'e', 'f', 'g']);
  assert.equal(r.total, 7);
  assert.deepEqual(r.tail(2), ['f', 'g']);
  const b = new LineRing(1000, 100); // 50 UTF-16 units
  b.push(['x'.repeat(20), 'y'.repeat(20), 'z'.repeat(20)], 1);
  assert.deepEqual(b.lines.map((l) => l.text[0]), ['y', 'z'], 'bytes cap drops the oldest');
  assert.ok(b.bytes <= 100);
  const one = new LineRing(10, 10);
  one.push(['w'.repeat(5000)], 1);
  assert.equal(one.lines.length, 1, 'a single over-long line is kept (cut), never an empty ring');
  assert.equal(one.lines[0].text.length, 1000);
  // memory stays bounded however much is pushed
  const big = new LineRing();
  for (let i = 0; i < 300; i++) big.push(Array.from({ length: 100 }, (_, j) => `line ${i}:${j} ${'·'.repeat(80)}`), i);
  assert.ok(big.lines.length <= 2000 && big.bytes <= 256 * 1024, `${big.lines.length} lines, ${big.bytes} B`);
  assert.match(big.lines[big.lines.length - 1].text, /^line 299:99/);
});

test('mergeTail: appends only what is new after the overlap; no overlap → everything', () => {
  assert.deepEqual(mergeTail([], ['a', 'b']), ['a', 'b']);
  assert.deepEqual(mergeTail(['a', 'b', 'c'], ['b', 'c', 'd', 'e']), ['d', 'e']);
  assert.deepEqual(mergeTail(['a', 'b', 'c'], ['a', 'b', 'c']), [], 'nothing new');
  assert.deepEqual(mergeTail(['x', 'y'], ['p', 'q']), ['p', 'q'], 'scrolled further than one read: all of it');
  // blank lines alone are not an anchor: it reaches back to two non-blank lines
  assert.deepEqual(mergeTail(['ok 1', 'ok 2', '', ''], ['ok 1', 'ok 2', '', '', 'new', '', '']), ['new', '', '']);
  // the latest occurrence of the anchor wins (a repeated block)
  assert.deepEqual(mergeTail(['A', 'B'], ['A', 'B', 'C', 'A', 'B', 'D']), ['D']);
});

test('searchLines / cutAround / queryWords: every word, newest first, repeats once, a window around the hit', () => {
  const lines = ['npm test', 'Rate limit hit, retrying', 'all good', 'rate LIMIT again', 'Rate limit hit, retrying'].map((text) => ({ text }));
  const words = queryWords('  limit RATE limit ');
  assert.deepEqual(words, ['limit', 'rate']);
  const f = searchLines(lines, words, 10);
  assert.deepEqual(f.map((x) => x.i), [4, 3], 'newest first; the repeated line counts once');
  assert.equal(f[0].fromEnd, 0);
  assert.deepEqual([f[0].s, f[0].e], [0, 4], 'the earliest word in the line');
  assert.equal(searchLines(lines, ['nope'], 10).length, 0);
  assert.equal(searchLines(lines, words, 1).length, 1, 'capped');
  const long = `${'a'.repeat(300)}NEEDLE${'b'.repeat(300)}`;
  const c = cutAround(long, 300, 306);
  assert.ok(c.text.length <= 202 && c.text.startsWith('…') && c.text.endsWith('…'));
  assert.equal(c.text.slice(c.match[0], c.match[1]), 'NEEDLE');
  const s = cutAround('short NEEDLE', 6, 12);
  assert.equal(s.text.slice(s.match[0], s.match[1]), 'NEEDLE');
  assert.deepEqual(plainLines('\x1b[31mred\x1b[0m  \r\nplain\n\n\n'), ['red', 'plain']);
});

/** a herdr-shaped source serving `pane.read` from a per-pane list of lines; records every request */
function fakeSource(text: Map<string, string[]>) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  return {
    calls, connected: true,
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      if (method !== 'pane.read') throw new Error(`unexpected ${method}`);
      const lines = text.get(String(params.pane_id)) ?? [];
      return { type: 'pane_read', read: { text: lines.slice(-Number(params.lines ?? 200)).join('\n'), revision: 1 } };
    },
  };
}

test('Scrollback: the screen is kept apart, scrolled-off lines accumulate past one read, search ranks and caps, read-only', async () => {
  const clock = new FakeClock();
  const out = new Map<string, string[]>([['w1:p1', ['$ npm test', 'FAIL rate limiter spec', 'screen: ✻ Thinking (3s)']], ['w1:p2', ['hello', 'nothing here']]]);
  const src = fakeSource(out);
  const sb = new Scrollback({ source: src, clock, panes: () => [{ id: 'w1:p1', rows: 1, agent: true }, { id: 'w1:p2', rows: 1 }] });
  let r = await sb.search('rate limit');
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].id, 'w1:p1');
  assert.equal(r.hits[0].text.slice(...r.hits[0].match), 'rate');
  assert.equal(r.hits[0].screen, false);
  assert.equal(r.panes, 2);
  // the spinner line is the live screen: it is replaced, never piled up
  out.set('w1:p1', ['$ npm test', 'FAIL rate limiter spec', 'fixed the rate limiter', 'screen: ✻ Thinking (9s)']);
  clock.advance(10_000);
  r = await sb.search('thinking', 24, null);
  assert.equal(r.hits.length, 1, 'one spinner line, not one per read');
  assert.equal(r.hits[0].screen, true);
  assert.equal(sb.bufs.get('w1:p1')!.ring.lines.length, 3, 'npm test, FAIL…, fixed… (each once)');
  // more output than one read holds still accumulates: the ring keeps lines herdr no longer returns
  out.set('w1:p1', Array.from({ length: 600 }, (_, i) => `build step ${i}`).concat(['screen']));
  clock.advance(10_000);
  r = await sb.search('FAIL rate');
  assert.equal(r.hits.length, 1, 'the old line is still in the ring');
  assert.ok(r.hits[0].fromEnd > 300);
  r = await sb.search('build step', 24);
  assert.equal(r.hits.length, PER_PANE, 'per-pane cap');
  assert.ok(r.more > 0);
  assert.deepEqual(r.hits.map((h) => h.text), ['build step 599', 'build step 598', 'build step 597', 'build step 596']);
  // fresh panes are not read again within STALE_MS
  const n = src.calls.length;
  await sb.search('hello');
  assert.equal(src.calls.length, n);
  assert.ok(src.calls.every((c) => c.method === 'pane.read' && c.params.source === 'recent_unwrapped' && c.params.format === 'text'), 'only ever reads');
  // per-client rate limit
  const client = {};
  await sb.search('hello', 5, client);
  await assert.rejects(sb.search('hello', 5, client), /too fast/);
  clock.advance(SEARCH_GAP_MS);
  await sb.search('hello', 5, client);
  // a pane that closed is forgotten
  sb.drop('w1:p2');
  assert.equal(sb.bufs.has('w1:p2'), false);
  // the warm sweep stops on its own
  assert.equal(sb.metrics().warm, true);
  clock.advance(31 * 60_000);
  assert.equal(sb.metrics().warm, false);
  sb.close();
});

test('Scrollback: a slow or failing pane never blocks the search', async () => {
  const clock = new FakeClock();
  const src = {
    connected: true,
    async request(_m: string, p: Record<string, unknown>) {
      if (p.pane_id === 'bad') throw Object.assign(new Error('gone'), { code: 'pane_not_found' });
      return { read: { text: 'needle here\nscreen' } };
    },
  };
  const sb = new Scrollback({ source: src, clock, panes: () => [{ id: 'bad', rows: 1 }, { id: 'ok', rows: 1 }] });
  const r = await sb.search('needle');
  assert.deepEqual(r.hits.map((h) => h.id), ['ok']);
  sb.close();
});

test('term.search over the wire: the demo server answers from its fake terminals; read-only', async () => {
  const app = await startApp({ scenario: 'mixed' });
  const c = await connect(app.port);
  try {
    const r = await c.call({ t: 'term.search', q: 'demo' });
    assert.equal(r.ok, true, String(r.error));
    const s = r.search as SearchResult;
    assert.ok(s.panes > 0 && s.lines > 0, `${s.panes} panes, ${s.lines} lines`);
    assert.ok(s.hits.length > 0, 'the demo banners say "demo"');
    for (const h of s.hits) {
      assert.ok(app.model.has(h.id));
      assert.match(h.text.slice(h.match[0], h.match[1]).toLowerCase(), /demo/);
      assert.ok(!/\x1b/.test(h.text), 'no escapes');
    }
    const bad = await c.call({ t: 'term.search', q: '' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'bad_message');
  } finally {
    await c.close();
    await app.close();
  }
});
