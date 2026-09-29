// timeline.ts (§4.3.1) + audit.ts (§4.8): ring, persistence, scrubbing, news coalescing, timeline.get / audit over WS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Timeline, scrubDetail, NEWS_BUCKET_MS } from './timeline.ts';
import type { TimelineModel } from './timeline.ts';
import type { WorldModelEvents } from './model.ts';
import type { Identity, TimelineMsg } from '../../shared/protocol.ts';
import { AuditLog, auditAction } from '../audit.ts';
import { FakeClock } from '../clock.ts';
import { startApp, connect } from '../test/harness.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-tl-'));
const ident = (id: string): Identity => ({ terminalId: `term_${id}`, agentSession: null, place: `ws/tab/0/${id}` });

/** A WorldModel stand-in: `status` + `msg` events and get(). */
class FakeModel extends EventEmitter<WorldModelEvents> implements TimelineModel {
  get(id: string) {
    return { identity: ident(id) };
  }
  base() {
    return null;
  }
}
const fakeModel = () => new FakeModel();

test('timeline: status + events recorded with identity; tool skipped; details scrubbed to metadata', () => {
  const clock = new FakeClock();
  const model = fakeModel();
  const tl = new Timeline({ dir: null, clock }).attach(model);
  const t0 = clock.now();
  model.emit('status', 'w1:p1', 'idle', 'working', ident('w1:p1'));
  clock.advance(1000);
  model.emit('msg', { t: 'event', id: 'w1:p1', kind: 'tool', detail: { tool: 'Bash', cls: 'test' } });
  model.emit('msg', { t: 'event', id: 'w1:p1', kind: 'test-fail', detail: { cmd: 'npm test -- secret-token=abc' } });
  model.emit('msg', { t: 'event', id: 'w1:p1', kind: 'struggle', detail: { level: 1, reason: 'fails' } });
  model.emit('msg', { t: 'gone', id: 'w1:p1', reason: 'closed' }); // not an event: ignored
  const { items, truncated } = tl.get(0);
  assert.equal(truncated, false);
  assert.deepEqual(items.map((x) => x.kind), ['status', 'test-fail', 'struggle']);
  assert.deepEqual(items[0], { at: t0, id: 'w1:p1', identity: ident('w1:p1'), kind: 'status', from: 'idle', to: 'working' });
  assert.equal(items[1].detail, undefined, 'commands never reach the timeline');
  assert.deepEqual(items[2].detail, { level: 1, reason: 'fails' });
  assert.deepEqual(tl.get(t0 + 500).items.map((x) => x.kind), ['test-fail', 'struggle'], 'since filters');
  assert.deepEqual(scrubDetail({ label: 'Find every location block', type: 'Explore', push: true, question: 'x' }), { type: 'Explore', push: true });
  tl.close();
});

test('timeline: news coalesces per pane into ≤ 1 item per bucket, closed early by the next item of that pane', () => {
  const clock = new FakeClock();
  const model = fakeModel();
  const tl = new Timeline({ dir: null, clock }).attach(model);
  for (let i = 0; i < 5; i++) {
    model.emit('msg', { t: 'event', id: 'a', kind: 'news', detail: { src: 'tool' } });
    clock.advance(1000);
  }
  model.emit('msg', { t: 'event', id: 'a', kind: 'news', detail: { src: 'text' } });
  model.emit('msg', { t: 'event', id: 'b', kind: 'news', detail: { src: 'shell', lines: 3 } });
  let items = tl.get(0).items;
  assert.equal(items.length, 2, 'open buckets are visible to timeline.get');
  assert.deepEqual(items.find((x) => x.id === 'a')?.detail, { n: 6, src: 'mixed' });
  model.emit('status', 'a', 'working', 'done', ident('a'));
  items = tl.get(0).items.filter((x) => x.id === 'a');
  assert.deepEqual(items.map((x) => x.kind), ['news', 'status'], 'bucket lands before the next item');
  clock.advance(NEWS_BUCKET_MS + 1);
  assert.equal(tl.metrics().newsOpen, 0, 'buckets close on their own');
  assert.equal(tl.items.filter((x) => x.kind === 'news').length, 2);
  tl.close();
});

test('timeline: persisted (0600), reloaded within 24 h, rotated, capped', () => {
  const dir = tmp();
  const clock = new FakeClock();
  let tl = new Timeline({ dir, clock, rotateBytes: 4000, max: 100 });
  for (let i = 0; i < 80; i++) tl.record({ id: `w1:p${i % 4}`, identity: ident(`p${i % 4}`), kind: 'status', from: 'idle', to: 'working' });
  tl.close();
  const f = path.join(dir, 'timeline.ndjson');
  assert.ok(fs.existsSync(path.join(dir, 'timeline.1.ndjson')), 'rotated at the byte limit');
  if (fs.existsSync(f)) assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  tl = new Timeline({ dir, clock, max: 100 });
  const kept = tl.items.length;
  assert.ok(kept > 20 && kept <= 80, `reloaded ${kept}`);
  clock.advance(25 * 3600_000);
  assert.equal(tl.get(0).items.length, 0, '24 h window');
  for (let i = 0; i < 150; i++) tl.record({ id: 'x', identity: null, kind: 'blocked' });
  const r = tl.get(0, 50);
  assert.equal(r.items.length, 50);
  assert.equal(r.truncated, true);
  assert.ok(tl.items.length <= 110, 'ring cap');
  tl.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('audit: metadata-only NDJSON (0600), rotation, action mapping', () => {
  const dir = tmp();
  const clock = new FakeClock();
  const a = new AuditLog({ dir, session: 'hqtest', clock, rotateBytes: 600 });
  assert.equal(auditAction({ t: 'term.promote', takeover: true }), 'takeover');
  assert.equal(auditAction({ t: 'term.promote' }), 'promote');
  assert.equal(auditAction({ t: 'agent.answer' }), 'answer');
  assert.equal(auditAction({ t: 'term.open' }), null);
  for (let i = 0; i < 8; i++) a.record({ cid: 'c1', action: 'answer', paneId: 'w1:p2', ok: i % 2 === 0, error: 'prompt_changed' });
  const f = path.join(dir, 'audit.ndjson');
  assert.ok(fs.existsSync(path.join(dir, 'audit.1.ndjson')), 'rotated');
  const lines = fs.readFileSync(fs.existsSync(f) ? f : path.join(dir, 'audit.1.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(lines[0]).sort(), ['action', 'at', 'cid', 'ok', 'paneId', 'session'].concat(lines[0].ok ? [] : ['error']).sort());
  assert.equal(a.recent(3).length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('WS e2e: timeline.get returns the demo history; interact actions are audited without their text', async () => {
  const app = await startApp({ scenario: 'queue' });
  const c = await connect(app.port);
  try {
    const blocked = [...app.model.entities.values()].find((e) => e.status === 'blocked' && e.prompt);
    assert.ok(blocked, 'the queue scenario has a blocked pane');
    app.model.emit('status', blocked.id, 'working', 'blocked', blocked.identity); // a transition as if it just happened
    const r = await c.call({ t: 'timeline.get', since: 0 });
    assert.equal(r.ok, true);
    const tl = await c.wait<TimelineMsg>((m) => m.t === 'timeline');
    assert.ok(tl.items.some((x) => x.kind === 'status' && x.id === blocked.id && x.to === 'blocked'));
    const ans = await c.call({ t: 'agent.answer', id: blocked.id, key: '1', promptHash: 'deadbeef' });
    assert.equal(ans.error, 'prompt_changed');
    await c.call({ t: 'agent.prompt', id: blocked.id, text: 'top secret prompt text' });
    const log = app.audit.recent();
    assert.deepEqual(log.map((x) => [x.action, x.paneId, x.ok]), [['answer', blocked.id, false], ['prompt', blocked.id, false]]);
    assert.ok(!JSON.stringify(log).includes('secret'), 'never prompt text');
  } finally {
    await c.close();
    await app.close();
  }
});
