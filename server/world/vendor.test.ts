// Entity.vendor (rev 3): herdr labels, the process-info sniff turning a shell pane into an agent and back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel } from './model.ts';
import { ProcInfoEnricher } from '../enrich/procinfo.ts';
import { HerdrSource } from '../interfaces.ts';
import type { RawPane, RawSnapshot } from '../interfaces.ts';
import { FakeClock } from '../clock.ts';

type Proc = { pid: number; name: string; argv: string[] };

/** A herdr stand-in: a fixed layout whose panes' agent labels and foreground processes the test edits. */
class Fake extends HerdrSource {
  panes: RawPane[] = [];
  procs = new Map<string, Proc[]>();
  constructor() { super(); this.connected = true; }
  override snapshot(): RawSnapshot {
    return {
      workspaces: [{ workspace_id: 'w1', label: 'ws', number: 1 }], tabs: [{ tab_id: 't1', workspace_id: 'w1', label: 'dev', number: 1 }],
      panes: this.panes.map((p) => ({ ...p })), agents: this.panes.filter((p) => p.agent).map((p) => ({ pane_id: p.pane_id, agent_status: 'idle' })),
      layouts: [],
    };
  }
  push(): void { this.emit('snapshot', this.snapshot()); }
  override async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'pane.process_info') {
      const list = this.procs.get(String(params.pane_id)) ?? [{ pid: 1, name: 'bash', argv: ['bash'] }];
      return { process_info: { foreground_process_group_id: list[0].pid, foreground_processes: list } };
    }
    if (method === 'pane.read') return { read: { text: '$ ' } };
    return null;
  }
}

const pane = (id: string, agent?: string): RawPane => ({ pane_id: id, workspace_id: 'w1', tab_id: 't1', terminal_id: `term-${id}`, cwd: '/x', ...(agent ? { agent } : {}) });
const settle = async (clock: FakeClock, ms: number) => {
  for (let t = 0; t < ms; t += 250) { clock.advance(250); await new Promise((r) => setImmediate(r)); }
};

test('vendor: herdr labels map to kind + vendor; unknown labels stay generic agents', () => {
  const src = new Fake();
  src.panes = [pane('w1:p1', 'claude'), pane('w1:p2', 'opencode'), pane('w1:p3', 'gemini'), pane('w1:p4', 'omp'), pane('w1:p5', 'brand-new'), pane('w1:p6')];
  const model = new WorldModel({ source: src, clock: new FakeClock(), dev: true });
  const kv = (id: string) => { const e = model.entities.get(id); return [e?.kind, e?.vendor]; };
  assert.deepEqual(kv('w1:p1'), ['claude', 'claude']);
  assert.deepEqual(kv('w1:p2'), ['agent', 'opencode']);
  assert.deepEqual(kv('w1:p3'), ['gemini', 'gemini']);
  assert.deepEqual(kv('w1:p4'), ['agent', 'pi']);
  assert.deepEqual(kv('w1:p5'), ['agent', null]);
  assert.deepEqual(kv('w1:p6'), ['shell', null]);
  model.close();
});

test('vendor: an Aider in a plain shell pane becomes an agent, and a shell again when it exits', async () => {
  const clock = new FakeClock();
  const src = new Fake();
  src.panes = [pane('w1:p1'), pane('w1:p2')];
  const pi = new ProcInfoEnricher({ source: src, clock, shellMs: 1000, agentMs: 2000 });
  const model = new WorldModel({ source: src, enrichers: [pi], clock, dev: true });
  const msgs: unknown[] = [];
  model.on('msg', (m) => msgs.push(m));
  await settle(clock, 1500);
  assert.equal(model.entities.get('w1:p1')?.kind, 'shell');
  src.procs.set('w1:p1', [{ pid: 7, name: 'aider', argv: ['/usr/bin/python3', '/home/u/.local/bin/aider', '--model', 'sonnet'] }]);
  src.procs.set('w1:p2', [{ pid: 8, name: 'goose', argv: ['goose', 'up'] }]); // the DB migrator, not the agent
  await settle(clock, 1500);
  const e = model.entities.get('w1:p1');
  assert.deepEqual([e?.kind, e?.vendor], ['agent', 'aider']);
  assert.equal(model.entities.get('w1:p2')?.kind, 'shell', 'pressly/goose is not an agent');
  model.flush();
  assert.ok(msgs.some((m) => (m as { t: string; entity?: { id: string; kind: string } }).entity?.id === 'w1:p1'
    && (m as { entity: { kind: string } }).entity.kind === 'agent'), 'the change went out on the wire');
  // aider exits: back at the bash prompt; the agent-pane poll (2 s) notices
  src.procs.delete('w1:p1');
  await settle(clock, 2500);
  assert.deepEqual([model.entities.get('w1:p1')?.kind, model.entities.get('w1:p1')?.vendor], ['shell', null]);
  model.close();
  await pi.close();
});

test('vendor: herdr\'s label wins over the sniff, and a sniff never outlives a label', async () => {
  const clock = new FakeClock();
  const src = new Fake();
  src.panes = [pane('w1:p1', 'claude')];
  src.procs.set('w1:p1', [{ pid: 7, name: 'crush', argv: ['crush'] }]);
  const pi = new ProcInfoEnricher({ source: src, clock, shellMs: 1000, agentMs: 1000 });
  const model = new WorldModel({ source: src, enrichers: [pi], clock, dev: true });
  await settle(clock, 1500);
  assert.equal(model.entities.get('w1:p1')?.vendor, 'claude');
  // herdr drops the label and the pane is back to bash: a shell at once, no stale sniff
  src.procs.delete('w1:p1');
  src.panes = [pane('w1:p1')];
  src.push();
  assert.equal(model.entities.get('w1:p1')?.kind, 'shell');
  model.close();
  await pi.close();
});
