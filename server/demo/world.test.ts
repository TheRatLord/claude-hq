import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from '../clock.ts';
import { createDemo, DemoWorld, promptText } from './world.ts';
import { PROMPTS } from './scenarios.ts';
import { WorldModel } from '../world/model.ts';
import { BlockedEnricher, parsePrompt } from '../world/blocked.ts';
import { need } from '../test/need.ts';
import { isRecord } from '../../shared/guards.ts';
import { ProcInfoEnricher } from '../enrich/procinfo.ts';
import type { EventMsg, ServerMsg } from '../../shared/protocol.ts';
import { SCENARIOS, STATUSES, ENTITY_FIELDS, SHELL_ACTIVITIES, TOOL_CLASSES, S2R } from '../../shared/protocol.ts';

/** DemoWorld + DemoEnricher + procinfo + the real blocked parser → WorldModel, all on a FakeClock. */
function setup({ n = 12, seed = 1, scenario = 'mixed' } = {}) {
  const clock = new FakeClock();
  const { source, demo, enrichers } = createDemo({ clock, n, seed, scenario });
  const model = new WorldModel({ source, enrichers: [...enrichers, new BlockedEnricher({ clock })], clock, demo: true, dev: true });
  if (scenario === 'longIdle') source.seedSince(model.since);
  const msgs: ServerMsg[] = [];
  model.on('msg', (m) => msgs.push(m));
  source.start();
  return { clock, source, demo, model, msgs, close: async () => (model.close(), await source.close()) };
}

/** The `agent` of an agent.start reply */
function agentOf(reply: unknown): { pane_id: string; workspace_id: unknown } {
  assert.ok(isRecord(reply) && isRecord(reply.agent) && typeof reply.agent.pane_id === 'string', 'agent.start reply');
  return { pane_id: reply.agent.pane_id, workspace_id: reply.agent.workspace_id };
}

/** Advance the fake clock in steps, letting promise continuations (procinfo/blocked polls) run between. */
async function run(clock: FakeClock, ms: number, step = 250): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    clock.advance(step);
    for (let i = 0; i < 4; i++) await null;
  }
}

test('every scenario builds a herdr-shaped snapshot', () => {
  for (const sc of SCENARIOS) {
    const w = new DemoWorld({ clock: new FakeClock(), scenario: sc });
    const raw = w.snapshot();
    if (sc === 'offline') {
      assert.equal(raw, null);
      assert.equal(w.connected, false);
      continue;
    }
    assert.ok(raw, sc);
    for (const p of raw.panes) {
      assert.match(p.pane_id, /^d\d+:p\d+$/, sc);
      assert.ok(raw.tabs.some((t) => t.tab_id === p.tab_id));
      assert.ok(raw.layouts.some((l) => l.panes.some((q) => q.pane_id === p.pane_id)));
      if (p.agent) assert.ok(raw.agents.some((a) => a.pane_id === p.pane_id && Number.isInteger(a.state_change_seq)));
      else assert.equal(p.agent_status, 'unknown');
    }
    const want = { empty: 0, trio: 4, crowd40: 40, longIdle: 6, queue: 6, mixed: 12, churn: 12, allStates: 33 }[sc];
    assert.equal(raw.panes.length, want, sc);
  }
  const mixed = need(new DemoWorld({ clock: new FakeClock(), n: 12 }).snapshot());
  assert.equal(mixed.workspaces.length, 3);
  const shells = mixed.panes.filter((p) => !p.agent).length;
  assert.ok(shells >= 2 && shells <= 3, `≈20% shells (${shells})`);
  assert.equal(mixed.agents.filter((a) => a.agent === 'codex').length, 1, '1 codex per 10 agents');
  const crowd = need(new DemoWorld({ clock: new FakeClock(), scenario: 'crowd40' }).snapshot());
  assert.equal(crowd.workspaces.length, 8);
  assert.equal(crowd.agents.filter((a) => a.agent === 'codex').length, 3);
});

test('allStates: frozen, deterministic, 1 per status + 1 per ToolClass + 1 shell per ShellActivity', async () => {
  const a = setup({ scenario: 'allStates' });
  const b = setup({ scenario: 'allStates' });
  await run(a.clock, 30_000);
  await run(b.clock, 30_000);
  const strip = (m: WorldModel): string => JSON.stringify([...m.entities.values()].map(({ statusSince, activity, ...e }) => ({ ...e, activity: activity && { ...activity, since: 0 } })));
  assert.equal(strip(a.model), strip(b.model), 'same seed → identical world');
  const es = [...a.model.entities.values()];
  for (const s of STATUSES) assert.ok(es.some((e) => e.kind !== 'shell' && e.status === s), `status ${s}`);
  for (const c of TOOL_CLASSES) assert.ok(es.some((e) => e.activity?.cls === c), `class ${c}`);
  for (const act of SHELL_ACTIVITIES) assert.ok(es.some((e) => e.kind === 'shell' && e.process?.activity === act), `shell ${act}`);
  const before = strip(a.model);
  await run(a.clock, 120_000, 1000);
  assert.equal(strip(a.model), before, 'frozen: nothing changes');
  for (const e of es) for (const f of ENTITY_FIELDS) assert.ok(f in e, f);
  const blocked = need(es.find((e) => e.status === 'blocked' && e.activity?.cls !== 'ask'));
  assert.ok(blocked.prompt?.options.length === 3 && blocked.prompt.numbered, 'real parser on demo detection text');
  await a.close();
  await b.close();
});

test('scenario reset repeats seeded initial facts and rejects invalid inputs without mutation', async () => {
  const { source, clock, close } = setup({ scenario: 'mixed', seed: 7 });
  try {
    const initial = source.snapshot();
    const facts = structuredClone([...source.facts]);
    source.force('d1:p1', { title: 'mutated', status: 'idle' });
    assert.deepEqual(source.setScenario('mixed', 7), { scenario: 'mixed', seed: 7, population: 12 });
    assert.deepEqual(source.snapshot(), initial);
    assert.deepEqual([...source.facts], facts);
    source.setScenario('mixed', 8);
    const changed = source.snapshot();
    const changedFacts = structuredClone([...source.facts]);
    assert.notDeepEqual(changedFacts, facts, 'new seed changes simulated output, not just metadata');
    source.setScenario('mixed');
    assert.equal(source.demoConfig.seed, 8, 'omission retains the active seed');
    assert.deepEqual(source.snapshot(), changed);
    assert.deepEqual([...source.facts], changedFacts);
    const timers = clock.pending;
    for (const seed of [-1, 0x1_0000_0000, 1.5, NaN, Infinity]) {
      assert.throws(() => source.setScenario('allStates', seed), { code: 'bad_message' });
      assert.deepEqual(source.demoConfig, { scenario: 'mixed', seed: 8, population: 12 });
      assert.deepEqual(source.snapshot(), changed);
      assert.deepEqual([...source.facts], changedFacts);
      assert.equal(clock.pending, timers);
    }
    assert.throws(() => source.setScenario('invalid', 9), { code: 'not_accepted' });
    assert.deepEqual(source.snapshot(), changed);
    source.setScenario('mixed', 0);
    assert.equal(source.demoConfig.seed, 0);
    source.setScenario('mixed', 0xffff_ffff);
    assert.equal(source.demoConfig.seed, 0xffff_ffff);
  } finally {
    await close();
  }
});

test('scenario reset detaches old entities during reconnect grace and while offline', async () => {
  const { source, model, msgs, close } = setup({ scenario: 'mixed' });
  try {
    const ids = [...model.entities.keys()];
    source.emit('reconnected', { grace: true });
    assert.equal(model.inGrace, true);
    source.setScenario('offline', 4);
    assert.equal(model.inGrace, false);
    assert.equal(model.entities.size, 0);
    assert.deepEqual(msgs.filter((m) => m.t === 'gone').map((m) => m.id).sort(), ids.sort());
    source.setScenario('mixed', 4);
    assert.equal(model.connected, true);
    assert.equal(model.inGrace, false);
    assert.equal(model.entities.size, 12);
    assert.equal(model.get('d1:p1')?.identity.terminalId, source.snapshot()?.panes[0]?.terminal_id);
  } finally {
    await close();
  }
});

for (const seed of [1, 2, 3, 4, 5]) test(`mixed (seed ${seed}): every status and every ToolClass within 3 simulated minutes; events flow through emitEvent`, async () => {
  const { clock, model, msgs, close } = setup({ scenario: 'mixed', seed });
  const statuses = new Set(), classes = new Set();
  const sample = () => {
    for (const e of model.entities.values()) {
      if (e.kind !== 'shell') statuses.add(e.status);
      if (e.activity?.cls) classes.add(e.activity.cls);
    }
  };
  sample();
  for (let t = 0; t < 180_000; t += 500) {
    clock.advance(500);
    for (let i = 0; i < 4; i++) await null;
    sample();
    for (const m of msgs.splice(0)) {
      if (m.t === S2R.ENTITY) {
        if (m.entity.kind !== 'shell') statuses.add(m.entity.status);
        if (m.entity.activity?.cls) classes.add(m.entity.activity.cls);
      }
      if (m.t === S2R.EVENT) classes.add(`event:${m.kind}`);
    }
  }
  for (const s of STATUSES) assert.ok(statuses.has(s), `status ${s} seen`);
  const missing = TOOL_CLASSES.filter((c) => !classes.has(c));
  assert.deepEqual(missing, [], `classes missing: ${missing}`);
  for (const k of ['test-pass', 'test-fail', 'subagent-spawned', 'tool', 'finished']) assert.ok(classes.has(`event:${k}`), `event ${k}`);
  await close();
});

test('mixed is deterministic under FakeClock for a given seed', async () => {
  const trace = async (seed: number): Promise<string> => {
    const s = setup({ seed });
    const out: string[] = [];
    s.model.on('msg', (m) => m.t === S2R.EVENT && out.push(`${s.clock.now()}:${m.id}:${m.kind}`));
    await run(s.clock, 60_000);
    await s.close();
    return out.join('\n');
  };
  const a = await trace(7);
  assert.equal(a, await trace(7));
  assert.notEqual(a, await trace(8));
});

test('queue: 4 blocked prompt shapes parse with the real blocked parser and answer through pane.send_keys', async () => {
  const { clock, source, model, close } = setup({ scenario: 'queue' });
  await run(clock, 3000);
  const blocked = [...model.entities.values()].filter((e) => e.status === 'blocked');
  assert.equal(blocked.length, 4);
  for (const e of blocked) assert.ok(e.prompt && e.prompt.options.length >= 2, `${e.id} parsed`);
  assert.deepEqual(blocked.map((e) => e.prompt?.numbered).sort(), [false, true, true, true], 'one ❯-bulleted menu');
  assert.ok(blocked.some((e) => /trust the files/.test(e.prompt?.question ?? '')), 'folder trust');
  assert.ok(blocked.some((e) => e.activity?.cls === 'ask'), 'AskUserQuestion shows as ask');
  // no auto-resolve in queue
  await run(clock, 120_000, 1000);
  assert.equal([...model.entities.values()].filter((e) => e.status === 'blocked').length, 4);
  const numbered = need(blocked.find((e) => e.prompt?.numbered && /edit/.test(e.prompt.question)));
  await source.request('pane.send_keys', { pane_id: numbered.id, keys: ['1'] });
  await run(clock, 500);
  assert.equal(model.get(numbered.id)?.status, 'working');
  const bullets = need(blocked.find((e) => !e.prompt?.numbered));
  await source.request('pane.send_keys', { pane_id: bullets.id, keys: ['Down'] });
  await run(clock, 2500);
  assert.equal(model.get(bullets.id)?.prompt?.selected, 1, 'cursor moves are visible to the parser');
  // re-blocks later with the same shape so the queue stays populated
  await run(clock, 200_000, 1000);
  assert.equal(model.get(numbered.id)?.status, 'blocked');
  await close();
});

test('promptText shapes round-trip through parsePrompt', () => {
  for (const pr of [PROMPTS.edit('src/a.js'), PROMPTS.bash('npm test', '/x'), PROMPTS.trust('/tmp/x'), PROMPTS.bullets(), PROMPTS.free()]) {
    const p = parsePrompt(promptText({ ...pr, selected: 1, typed: '' }), 3);
    assert.ok(p, pr.shape);
    assert.deepEqual(p.options.map((o) => o.label), pr.labels, pr.shape);
    assert.equal(p.selected, 1);
    assert.equal(p.numbered, pr.numbered);
  }
});

test('longIdle: seeded since.json ages (not approx), no schedule changes', async () => {
  const { clock, model, close } = setup({ scenario: 'longIdle' });
  await run(clock, 1000);
  const now = clock.now();
  const ages = [...model.entities.values()].filter((e) => e.kind === 'claude').map((e) => Math.round((now - e.statusSince) / 60_000)).sort((a, b) => a - b);
  assert.deepEqual(ages, [0, 25, 120, 420]);
  for (const e of model.entities.values()) assert.equal(e.statusSinceApprox, false, e.id);
  await run(clock, 7 * 3600_000, 60_000);
  for (const e of model.entities.values()) if (e.kind === 'claude') assert.equal(e.status, 'idle');
  await close();
});

test('agent.prompt / pane.focus / demo.force drive the schedule like herdr', async () => {
  const { clock, source, model, close } = setup({ scenario: 'trio' });
  await run(clock, 1000);
  const idle = need([...model.entities.values()].find((e) => e.kind === 'claude' && e.status !== 'blocked'));
  source.force(idle.id, { status: 'idle' });
  await run(clock, 500);
  await source.request('agent.prompt', { target: idle.id, text: 'make the HUD pop' });
  await run(clock, 500);
  assert.equal(model.get(idle.id)?.status, 'working');
  assert.equal(model.get(idle.id)?.lastPrompt, 'make the HUD pop');
  source.force(idle.id, { status: 'done' });
  await run(clock, 500);
  await source.request('pane.focus', { pane_id: idle.id });
  await run(clock, 500);
  assert.equal(model.get(idle.id)?.status, 'idle', 'focus clears done');
  await assert.rejects(source.request('pane.read', { pane_id: 'w1:p1' }), { code: 'pane_not_found' });
  await close();
});

test('churn: 10 simulated minutes, then quiesce → timers/entities/enricher state back to baseline (no leaks)', async () => {
  const { clock, source, model, demo, close } = setup({ scenario: 'empty' });
  await run(clock, 2000);
  const procinfo = need(model.enrichers.find((e): e is ProcInfoEnricher => e instanceof ProcInfoEnricher));
  const snap = () => ({ pending: clock.pending, entities: model.entities.size, world: source.metrics().timers, demo: demo.metrics().panes,
    procinfo: procinfo.metrics().panes, listeners: source.listenerCount('facts') + source.listenerCount('demo-event') + source.listenerCount('snapshot') });
  const baseline = snap();
  source.setScenario('churn');
  let gone = 0, offline = 0;
  const ids = new Set();
  model.on('msg', (m) => {
    if (m.t === S2R.GONE) gone++;
    if (m.t === S2R.ENTITY) ids.add(m.entity.identity.terminalId);
    if (m.t === S2R.HERDR && !m.connected) offline++;
  });
  await run(clock, 10 * 60_000, 500);
  assert.ok(ids.size > 100 && gone > 100, `churned (terminals ${ids.size}, gone ${gone})`);
  assert.ok(offline >= 20, `offline flaps ${offline}`);
  source.setScenario('empty');
  await run(clock, 60_000, 500);
  assert.deepEqual(snap(), baseline);
  await close();
});

// ------------------------------------------------------------------------------------------------
// Demo parity: lastText, work, struggle detail, prompt/spawn → working, meaningful news

test('mixed: every working Claude shows lastText + work, and work grows while it works', async () => {
  const { clock, model, close } = setup({ scenario: 'mixed', seed: 3, n: 16 });
  await run(clock, 500);
  const working = [...model.entities.values()].filter((e) => e.kind === 'claude' && e.status === 'working');
  assert.ok(working.length >= 5, `≥ 5 working Claudes (${working.length})`);
  for (const e of working) {
    assert.ok(e.lastText && e.lastText.length <= 280, `${e.id} lastText`);
    assert.ok(e.work && Number.isFinite(e.work.since) && e.work.since <= clock.now(), `${e.id} work`);
  }
  const start = new Map(working.map((e) => [e.id, (e.work?.added ?? 0) + (e.work?.removed ?? 0)]));
  const grew = new Set();
  for (let t = 0; t < 240_000; t += 1000) {
    await run(clock, 1000, 500);
    for (const [id, v] of start) {
      const e = model.get(id);
      if (e?.work && e.work.added + e.work.removed > v) grew.add(id);
    }
  }
  assert.equal(grew.size, start.size, `work grew for ${grew.size}/${start.size}`);
  // idle/done Claudes with a task show the finished task's text + counts; shells and codex have none
  for (const e of model.entities.values()) {
    if (e.kind !== 'claude') assert.equal(e.lastText, null, e.id);
    else if (e.title) assert.ok(e.lastText, `${e.id} (${e.status}) lastText`);
  }
  await close();
});

test('demo: agent.prompt turns idle/done → working within 2 s with a fresh task; spawn (agent.start + prompt) arrives and works', async () => {
  const { clock, source, model, msgs, close } = setup({ scenario: 'mixed', seed: 2 });
  await run(clock, 1000);
  for (const status of ['idle', 'done']) {
    const e = need([...model.entities.values()].find((x) => x.kind === 'claude' && x.status !== 'blocked' && x.status !== 'working'));
    source.force(e.id, { status });
    await run(clock, 500);
    const t0 = clock.now();
    await source.request('agent.prompt', { pane_id: e.id, text: 'make the lobby sign blink when someone is blocked' });
    await run(clock, 2000);
    const now = need(model.get(e.id));
    assert.equal(now.status, 'working', status);
    assert.equal(now.lastPrompt, 'make the lobby sign blink when someone is blocked');
    assert.equal(now.title, 'Make the lobby sign blink when');
    assert.ok(now.work && now.work.since >= t0 && now.work.added === 0, 'work restarts with the new task');
  }
  // spawn {kind:'claude', prompt}: the backend runs agent.start, then agent.prompt once the agent reports idle
  const shell = need([...model.entities.values()].find((x) => x.kind === 'shell'));
  msgs.length = 0;
  const agent = agentOf(await source.request('agent.start', { pane_id: shell.id, kind: 'claude', name: 'hire' }));
  await run(clock, 1000);
  const hired = need(model.get(agent.pane_id));
  assert.equal(hired.status, 'idle');
  assert.equal(hired.lastText, null);
  await source.request('agent.prompt', { pane_id: agent.pane_id, text: 'write the onboarding checklist' });
  await run(clock, 1500);
  assert.equal(model.get(agent.pane_id)?.status, 'working');
  assert.ok(msgs.some((m) => m.t === S2R.EVENT && m.kind === 'arrived' && m.id === agent.pane_id), 'arrives');
  let said = false;
  for (let t = 0; t < 180_000 && !said; t += 1000) {
    await run(clock, 1000, 500);
    said = !!model.get(agent.pane_id)?.lastText;
  }
  assert.ok(said, 'the new hire talks within 3 min');
  await close();
});

test('demo: struggle carries a detail line; news fires once per finished turn, never per step', async () => {
  const { clock, model, msgs, close } = setup({ scenario: 'mixed', seed: 4 });
  const detailOf = (m: EventMsg): Record<string, unknown> => (isRecord(m.detail) ? m.detail : {});
  const news: EventMsg[] = [], struggles: Record<string, unknown>[] = [], steps: EventMsg[] = [];
  for (let t = 0; t < 600_000; t += 500) {
    await run(clock, 500);
    for (const m of msgs.splice(0)) {
      if (m.t !== S2R.EVENT) continue;
      if (m.kind === 'news') news.push(m);
      if (m.kind === 'struggle' && detailOf(m).level) struggles.push(detailOf(m));
      if (m.kind === 'tool') steps.push(m);
    }
  }
  for (const s of [...model.entities.values()].flatMap((e) => (e.struggle ? [e.struggle] : []))) assert.ok(s.detail, 'entity struggle has detail');
  for (const s of struggles) assert.match(String(s.detail), /in a row|errors in|no edits|context \d+%/);
  const turn = news.filter((m) => detailOf(m).src === 'turn');
  assert.ok(turn.length >= 1 && turn.every((m) => Number(detailOf(m).msgs) >= 1 && Number.isInteger(detailOf(m).edits)), 'turn news payload');
  assert.ok(steps.length > 8 * news.length, `news (${news.length}) ≪ tool steps (${steps.length})`);
  await close();
});

test('mixed: meaningful news volume — one per finished turn / finished shell command, ≪ the old per-step stream', async () => {
  for (const seed of [1, 2, 3]) {
    const { clock, model, msgs, close } = setup({ scenario: 'mixed', seed });
    await run(clock, 250);
    msgs.length = 0;
    let news = 0, finished = 0, tools = 0;
    for (let t = 0; t < 300_000; t += 500) {
      await run(clock, 500);
      for (const m of msgs.splice(0)) {
        if (m.t !== S2R.EVENT) continue;
        if (m.kind === 'news') news++;
        if (m.kind === 'finished') finished++;
        if (m.kind === 'tool') tools++;
      }
    }
    const shells = [...model.entities.values()].filter((e) => e.kind === 'shell').length;
    // per shell ≤ ~1 finished command a minute; per Claude ≤ 1 per turn end (finished, or ended into blocked / idle)
    assert.ok(news <= finished + 5 * shells + 6, `seed ${seed}: news ${news}, finished ${finished}, shells ${shells}`);
    assert.ok(news * 8 < tools, `seed ${seed}: news ${news} vs tool steps ${tools}`);
    await close();
  }
});

// hire into a brand-new workspace: workspace.create → agent.start on its only pane must keep the workspace
test('demo: agent.start in a fresh workspace (its only pane) keeps the workspace and starts the agent', async () => {
  const { clock, source, model, close } = setup({ scenario: 'mixed', seed: 3 });
  await run(clock, 1000);
  const r = await source.request('workspace.create', { focus: false, label: 'hires' });
  assert.ok(isRecord(r) && isRecord(r.root_pane) && isRecord(r.workspace));
  const agent = agentOf(await source.request('agent.start', { pane_id: r.root_pane.pane_id, kind: 'claude', name: 'fresh' }));
  assert.ok(agent.pane_id, 'agent started');
  assert.equal(agent.workspace_id, r.workspace.workspace_id);
  await run(clock, 1500);
  const e = model.get(agent.pane_id);
  assert.ok(e && e.kind === 'claude', 'the new claude is in the world');
  close();
});

test('rev-2 signals: every Claude spends today, repo workspaces carry git, a commit takes the weeds and stacks a crate', async () => {
  const { clock, model, msgs, close } = setup({ scenario: 'mixed', seed: 3 });
  try {
    await run(clock, 2000);
    const es = [...model.entities.values()];
    const claudes = es.filter((e) => e.kind === 'claude' && e.status !== 'unknown');
    assert.ok(claudes.length > 4);
    for (const e of claudes) {
      assert.ok(e.usage && e.usage.tokens > 100_000, `${e.id} usage`);
      assert.ok(e.usage.cost != null && e.usage.cost > 0 && e.usage.cost < 200, `${e.id} cost ${e.usage.cost}`);
    }
    for (const e of es.filter((x) => x.kind !== 'claude')) assert.equal(e.usage, null);
    const withGit = es.filter((e) => e.git);
    assert.ok(withGit.length >= es.length / 2, 'repo workspaces carry git');
    for (const e of withGit) {
      assert.ok(e.git?.branch && e.git.lastCommit?.subject, e.id);
      // every pane of a workspace shares its repo
      for (const o of es.filter((x) => x.workspace.id === e.workspace.id)) assert.deepEqual(o.git, e.git);
    }
    // run the schedule until someone commits: the event names its subject, the repo is clean with that last commit
    await run(clock, 25 * 60_000, 1000);
    const commits = msgs.filter((m): m is EventMsg => m.t === S2R.EVENT && m.kind === 'commit' && isRecord(m.detail) && typeof m.detail.msg === 'string');
    assert.ok(commits.length, 'a commit with a subject');
    const commit = need(commits.reverse().find((m) => model.get(m.id)), 'a committer still in the valley');
    const after = need(model.get(commit.id));
    assert.ok(after.git?.lastCommit, 'git after commit');
    const spentLater = need([...model.entities.values()].find((e) => e.id === claudes[0].id));
    assert.ok((spentLater.usage?.tokens ?? 0) >= (claudes[0].usage?.tokens ?? 0), 'spend only grows within the day');
  } finally {
    await close();
  }
});
