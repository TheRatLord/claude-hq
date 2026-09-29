import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenFeed, unionWatch, MIN_INTERVAL_MS, type ScreenFeedStore } from './screenFeed.ts';
import type { ClientMsgOf } from '../../../shared/protocol.ts';

interface FakeTimer { f: () => void; at: number }

const rig = (entities: string[] | null = null, watchMax = 8) => {
  const sent: ClientMsgOf<'screen.watch'>[] = [];
  let t = 0;
  const timers: FakeTimer[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const store: ScreenFeedStore = { limits: { watchMax }, entities: entities ? new Set(entities) : null, on: (e, f) => { (listeners[e] ??= []).push(f); } };
  const feed = createScreenFeed({
    store, send: (m) => sent.push(m), now: () => t,
    setTimer: (f, ms) => { const h = { f, at: t + ms }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  });
  const advance = (ms: number) => { t += ms; for (const h of [...timers]) if (h.at <= t) { timers.splice(timers.indexOf(h), 1); h.f(); } };
  return { feed, sent, advance, fire: (e: string) => (listeners[e] ?? []).forEach((f) => f()), store };
};

test('unionWatch: priority triage/peek > proximity > nearest, dedupe, cap', () => {
  const tags = new Map([['nearest', ['a', 'b', 'c', 'd']], ['proximity', ['c']], ['peek', ['z', 'a']]]);
  assert.deepEqual(unionWatch(tags, 8), ['z', 'a', 'c', 'b', 'd']);
  assert.deepEqual(unionWatch(tags, 3), ['z', 'a', 'c']);
  assert.deepEqual(unionWatch(tags, 8, (id) => id !== 'z'), ['a', 'c', 'b', 'd']);
});

test('screenFeed: the only sender, one message per change, ≤ 2 Hz, capped at watchMax', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const { feed, sent, advance } = rig(ids);
  feed.want('nearest', ids);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, 'screen.watch');
  assert.equal(sent[0].ids.length, 8, 'capped at hello.limits.watchMax');
  feed.want('proximity', ['p11']);           // inside the debounce window: deferred
  feed.want('peek', ['p10']);
  assert.equal(sent.length, 1);
  advance(MIN_INTERVAL_MS);
  assert.equal(sent.length, 2, 'coalesced into one send');
  assert.deepEqual(sent[1].ids.slice(0, 2), ['p10', 'p11']);
  feed.want('peek', ['p10']);                // unchanged: nothing sent
  advance(MIN_INTERVAL_MS);
  assert.equal(sent.length, 2);
  feed.want('peek', null);                   // window open: sent at once
  feed.want('proximity', []);                // inside the new window: deferred
  assert.equal(sent.length, 3);
  advance(MIN_INTERVAL_MS);
  assert.equal(sent.length, 4);
  assert.deepEqual(sent[3].ids, ids.slice(0, 8));
});

test('screenFeed: unknown ids are dropped; hello resends', () => {
  const { feed, sent, advance, fire } = rig(['a', 'b']);
  feed.want('nearest', ['a', 'ghost', 'b']);
  assert.deepEqual(sent[0].ids, ['a', 'b']);
  advance(MIN_INTERVAL_MS);
  fire('hello');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].ids, ['a', 'b']);
  assert.deepEqual(feed.watched(), ['a', 'b']);
});
