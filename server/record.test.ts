import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeClock } from './clock.ts';
import { createDemo } from './demo/world.ts';
import { WorldModel } from './world/model.ts';
import { BlockedEnricher } from './world/blocked.ts';
import { attachRecorder, createReplay, parseRecording } from './record.ts';
import { S2R } from '../shared/protocol.ts';
import type { Entity, ServerMsg } from '../shared/protocol.ts';

async function run(clock: FakeClock, ms: number, step = 250): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    clock.advance(step);
    for (let i = 0; i < 4; i++) await null;
  }
}

/** Record `ms` of a demo scenario; returns {text, stream} where stream = the WorldModel's emitted messages. */
interface Stamped { at: number; m: ServerMsg }

async function record(scenario: string, ms: number) {
  const clock = new FakeClock();
  const { source, enrichers } = createDemo({ clock, scenario, seed: 3 });
  const all = [...enrichers, new BlockedEnricher({ clock })];
  let text = '';
  const rec = attachRecorder({ source, enrichers: all, clock, session: 'demo', demo: true, write: (l) => (text += l) });
  const model = new WorldModel({ source, enrichers: all, clock, demo: true, dev: true });
  rec.ready();
  const stream: Stamped[] = [];
  model.on('msg', (m) => stream.push({ at: clock.now(), m: structuredClone(m) }));
  const world0 = structuredClone(model.worldMsg());
  source.start();
  await run(clock, ms);
  model.flush();
  await rec.close();
  model.close();
  await source.close();
  return { text, stream, world0 };
}

async function replay(text: string, speed: number, ms: number) {
  const clock = new FakeClock();
  const { source, enrichers, demo } = createReplay({ text, clock, speed });
  const model = new WorldModel({ source, enrichers, clock, demo, dev: true });
  const stream: Stamped[] = [];
  model.on('msg', (m) => stream.push({ at: clock.now(), m: structuredClone(m) }));
  const world0 = structuredClone(model.worldMsg());
  source.start();
  await run(clock, ms);
  model.flush();
  assert.ok(source.done, 'replay reached the end');
  model.close();
  await source.close();
  return { stream, world0 };
}

test('record: header, snapshots, status, patches and events are all in the NDJSON', async () => {
  const { text } = await record('mixed', 60_000);
  const { header, items } = parseRecording(text);
  assert.equal(header.v, 1);
  assert.deepEqual(header.owners, ['demo', 'procinfo', 'blocked']);
  const kinds = new Set<string>(items.map((i) => i.k));
  for (const k of ['snapshot', 'status', 'patch', 'event']) assert.ok(kinds.has(k), k);
  assert.ok(items.some((i) => i.k === 'event' && i.owner === 'demo'), 'enricher events recorded');
  assert.equal(items[0]?.k, 'snapshot', 'first snapshot before the initial patches');
});

for (const sc of ['mixed', 'churn']) test(`replay at 1× reproduces the WorldModel output stream exactly (${sc}: entities, gone, events, timing)`, async () => {
  const rec = await record(sc, 90_000);
  const rep = await replay(rec.text, 1, 95_000);
  assert.deepEqual(rep.world0, rec.world0);
  // the final coalesced flush is timer-dependent; compare everything before the end of the recording
  const norm = (s: Stamped[]): string[] => s.filter((x) => x.at < (rec.stream.at(-1)?.at ?? 0) - 1000).map((x) => JSON.stringify(x));
  const a = norm(rec.stream), b = norm(rep.stream);
  assert.ok(a.length > 100, `stream has ${a.length} messages`);
  assert.deepEqual(b, a);
});

test('replay preserves same-ID scenario resets, including new seeds and offline transitions', async () => {
  const clock = new FakeClock();
  const { source, enrichers } = createDemo({ clock, scenario: 'allStates', seed: 3 });
  let text = '';
  const recorder = attachRecorder({ source, enrichers, clock, demo: true, write: (line) => { text += line; } });
  const model = new WorldModel({ source, enrichers, clock, demo: true, dev: true });
  recorder.ready();
  const stream: Stamped[] = [];
  model.on('msg', (m) => stream.push({ at: clock.now(), m: structuredClone(m) }));
  const initial = structuredClone(model.worldMsg());
  const ids = [...model.entities.keys()];
  try {
    source.start();
    await run(clock, 1000);
    source.setScenario('allStates', 3);
    await run(clock, 1000);
    source.setScenario('allStates', 4);
    await run(clock, 1000);
    source.setScenario('offline');
    await run(clock, 1000);
    source.setScenario('allStates');
    await run(clock, 1000);
    model.flush();
    const resets = stream.filter(({ m }) => m.t === 'gone');
    assert.equal(resets.length, ids.length * 3, 'each populated simulation is torn down, even with reused pane IDs');
    const rep = await replay(text, 1, 5000);
    assert.deepEqual(rep.world0, initial);
    assert.deepEqual(rep.stream, stream, 'reset replay reproduces removals, fresh enrichments, ages and identity changes');
  } finally {
    await recorder.close();
    model.close();
    await source.close();
  }
});

test('replay at 20×: same entity states and enricher events, 20× faster', async () => {
  const rec = await record('mixed', 120_000);
  const rep = await replay(rec.text, 20, 6500);
  const volatile = (e: Entity): Partial<Entity> => {
    const { statusSince, statusSinceApprox, ...rest } = e; // eslint-disable-line no-unused-vars
    return rest;
  };
  const finalOf = (s: Stamped[]): [string, string][] => {
    const m = new Map<string, string>();
    for (const { m: x } of s) {
      if (x.t === S2R.ENTITY) m.set(x.entity.id, JSON.stringify(volatile(x.entity)));
      if (x.t === S2R.GONE) m.delete(x.id);
    }
    return [...m.entries()].sort();
  };
  assert.deepEqual(finalOf(rep.stream), finalOf(rec.stream));
  const evs = (s: Stamped[]): string[] => s.flatMap(({ m }) => (m.t === S2R.EVENT && !['finished', 'arrived', 'left', 'tool'].includes(m.kind) ? [`${m.id}:${m.kind}`] : []));
  assert.deepEqual(evs(rep.stream), evs(rec.stream));
});

test('record to a file, replay from the file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-rec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'r.ndjson');
  const clock = new FakeClock();
  const { source, enrichers } = createDemo({ clock, scenario: 'trio' });
  const rec = attachRecorder({ file, source, enrichers, clock });
  const model = new WorldModel({ source, enrichers, clock, demo: true });
  rec.ready();
  source.start();
  await run(clock, 20_000);
  await rec.close();
  model.close();
  await source.close();
  const r = createReplay({ file, clock: new FakeClock(), speed: 5 });
  assert.equal(r.demo, true);
  assert.equal(r.source.demoConfig, undefined, 'recorded demo owners are not an active simulation');
  assert.equal(r.source.scenario, undefined, 'replay has no reset mutation capability');
  assert.equal(r.source.snapshot()?.panes.length, 4);
  await assert.rejects(r.source.request('pane.close', { pane_id: 'd1:p1' }), { code: 'readonly_replay' });
  await r.source.close();
});
