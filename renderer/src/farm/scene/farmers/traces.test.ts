import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACE_MAX, newTraceRow, plantedStakes, pushSprout, tracePos } from './traces.ts';
import { TOOL_DWELL_S, newMind, pigeonPost, plan, workAct } from './brain.ts';
import type { Errand, World } from './brain.ts';
import type { FarmerView, Job } from '../../model/types.ts';
import type { ToolClass } from '../../../../../shared/protocol.ts';
import { ACT_INFO, PIGEON, pigeonFly } from './pose.ts';

test('seed stakes count files planted across tasks, capped', () => {
  const r = newTraceRow();
  assert.equal(plantedStakes(r, 0), 0);
  assert.equal(plantedStakes(r, 2), 2);
  assert.equal(plantedStakes(r, 3), 3);
  // a new task restarts the file count: the old ones stay planted
  assert.equal(plantedStakes(r, 1), 4);
  assert.equal(plantedStakes(r, 9), TRACE_MAX);
});

test('sprouts keep the newest results, oldest dropped first', () => {
  const r = newTraceRow();
  for (let i = 0; i < TRACE_MAX + 2; i++) pushSprout(r, i % 2 === 1, i);
  assert.equal(r.sprouts, TRACE_MAX);
  assert.equal(r.sproutT[0], 2);
  assert.equal(r.sproutT[TRACE_MAX - 1], TRACE_MAX + 1);
  assert.equal(r.wilt[TRACE_MAX - 1], 1);
});

test('stakes go on the farmer\'s right, sprouts on its left, rows run forward', () => {
  const r = { x: 10, z: 5, yaw: 0 }; // facing +z: left = +x
  const o = { x: 0, z: 0 };
  tracePos(r, 1, 0, o); assert.ok(o.x > 10.5);
  tracePos(r, -1, 0, o); assert.ok(o.x < 9.5);
  const z0 = tracePos(r, -1, 0, o).z, z3 = tracePos(r, -1, 3, o).z;
  assert.ok(z3 > z0 + 0.5);
});

test('tool flavours pick distinct acts: search rummages, web fetch gets the pigeon', () => {
  const acts = (job: Job, tool: ToolClass | null) => new Set(Array.from({ length: 60 }, (_, i) => workAct(job, 'wheat', i * 0.5, 0.2, tool)));
  assert.ok(acts('inspect', 'search').has('rummage'));
  assert.ok(!acts('inspect', 'read').has('rummage'));
  assert.ok(acts('fetch', 'web').has('pigeon'));
  assert.equal(ACT_INFO.rummage.prop, 'sack');
  assert.equal(ACT_INFO.pigeon.prop, 'pigeon');
  assert.ok(pigeonPost('web') && pigeonPost('net') && !pigeonPost('mcp') && !pigeonPost(null));
  // the pigeon flies in, perches, flies off
  assert.equal(pigeonFly(0), 1);
  assert.equal(pigeonFly((PIGEON.in + PIGEON.perch) / 2), 0);
  assert.equal(pigeonFly(PIGEON.out + 1), 1);
});

const farmer = (job: Job, tool: ToolClass | null): FarmerView => ({
  id: 'f1', name: 'x', project: 'x', tag: 'x', kind: 'claude', seed: 's', tier: 'opus', plotId: 'p', spot: 0, status: 'working', job, jobSince: 0, rawJob: job, tool,
  detail: '', title: null, needsYou: false, unseenDone: false, struggle: 0, mood: 'focused', busy: 0.5, ducklings: [], said: null, question: null, options: [],
  todos: null, work: null, context: null, lastActive: 0,
});
const world: World = {
  site: null, plotKind: null, bin: { x: 0, z: 0, yaw: 0 }, mailbox: { x: 10, z: 0, yaw: 0 }, well: { x: -10, z: 0, yaw: 0 }, exit: { x: 0, z: 50 },
  hub: { x: 0, z: 0 }, seats: [], claim: () => 0,
};

test('the shown flavour holds for a dwell, and web fetches skip the mailbox errand', () => {
  const m = newMind('fetch', 0, 0.1);
  const cues: string[] = [];
  plan(m, farmer('fetch', 'web'), world, { x: 0, z: 0 }, true, 0, cues);
  assert.equal(m.tool, 'web');
  assert.equal(m.errand, null);
  plan(m, farmer('fetch', 'mcp'), world, { x: 0, z: 0 }, true, 1, cues);
  assert.equal(m.tool, 'web', 'churn inside the dwell is ignored');
  plan(m, farmer('fetch', 'mcp'), world, { x: 0, z: 0 }, true, 1 + TOOL_DWELL_S, cues);
  assert.equal(m.tool, 'mcp');
  plan(m, farmer('fetch', 'mcp'), world, { x: 0, z: 0 }, true, 2 + TOOL_DWELL_S, cues);
  assert.equal((m.errand as Errand | null)?.kind, 'fetch', 'MCP still walks to the mailbox / well');
  // a job change takes the new flavour at once
  plan(m, farmer('inspect', 'search'), world, { x: 0, z: 0 }, true, 3 + TOOL_DWELL_S, cues);
  assert.equal(m.tool, 'search');
});
