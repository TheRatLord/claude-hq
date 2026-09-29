import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubagentsEnricher, scanSubagents } from './subagents.ts';
import { projectSlug } from './transcripts.ts';
import { RealClock } from '../clock.ts';
import { assertEnricher } from '../interfaces.ts';
import { isRecord } from '../../shared/guards.ts';
import type { Entity } from '../../shared/protocol.ts';

const until = async (fn: () => unknown, ms = 3000): Promise<void> => {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('subagents: scan meta + workflow journal, spawned/done events, max 8, active by mtime', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-sub-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/home/demo/src/x';
  const sub = path.join(root, projectSlug(cwd), 'sess-1', 'subagents');
  fs.mkdirSync(path.join(sub, 'workflows', 'wf1'), { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), '{}\n');
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'find every location block' }));
  const old = new Date(Date.now() - 120_000);
  fs.writeFileSync(path.join(sub, 'agent-old.jsonl'), '{}\n');
  fs.utimesSync(path.join(sub, 'agent-old.jsonl'), old, old);
  fs.writeFileSync(path.join(sub, 'workflows', 'wf1', 'journal.jsonl'), JSON.stringify({ type: 'started', agentId: 'w9', label: 'review codec', phase: 1 }) + '\n');
  fs.writeFileSync(path.join(sub, 'workflows', 'wf1', 'agent-w9.jsonl'), '{}\n');
  const list = await scanSubagents(sub);
  assert.ok(list);
  assert.deepEqual(list.map((a) => a.id).sort(), ['a1', 'old', 'w9']);
  assert.equal(list.find((a) => a.id === 'w9')?.label, 'review codec');

  const e = new SubagentsEnricher({ clock: RealClock(), projectsDir: root, pollMs: 20 });
  assertEnricher(e);
  t.after(() => e.close());
  const patches: Partial<Entity>[] = [], events: { kind: string; detail: { id?: string } }[] = [];
  e.onPatch = (id, p) => void patches.push(p);
  e.emitEvent = (id, kind, detail) => void events.push({ kind, detail: isRecord(detail) ? detail : {} });
  e.attach('w1:p1', { kind: 'claude', cwd, identity: { terminalId: null, agentSession: 'sess-1', place: 'w1:p1' } });
  await until(() => patches.length);
  const s = patches.at(-1)?.subagents ?? [];
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => x.active), [true, true, false], 'active first');
  assert.equal(s.find((x) => x.id === 'w1:p1:a1')?.type, 'Explore');
  assert.equal(events.length, 0, 'first scan never emits');
  for (let i = 0; i < 7; i++) fs.writeFileSync(path.join(sub, `agent-n${i}.jsonl`), '{}\n');
  await until(() => events.filter((x) => x.kind === 'subagent-spawned').length === 7);
  await until(() => patches.at(-1)?.subagents?.length === 8);
  fs.utimesSync(path.join(sub, 'agent-a1.jsonl'), old, old);
  await until(() => events.some((x) => x.kind === 'subagent-done' && x.detail.id === 'a1'));
  e.update('w1:p1', { kind: 'shell', cwd, identity: { terminalId: null, agentSession: null, place: 'w1:p1' } });
  assert.deepEqual(patches.at(-1)?.subagents, []);
  assert.deepEqual(e.metrics(), { panes: 0, polls: 0 });
});
