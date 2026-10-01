import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobSmoother, rawJob, MIN_DWELL_S, shortDetail } from './jobs.ts';
import { createValley, unreadCount, TILL_MS, HARVEST_MS, projectName, worldTags } from './valley.ts';
import type { ValleySource } from './valley.ts';
import { skyAt, seasonOf, daylightAt } from './sky.ts';
import type { Entity, Workspace } from '../../../../shared/protocol.ts';
import { FIELD_DEFAULTS } from '../../../../shared/protocol.ts';

test('rawJob maps status and tool class', () => {
  const act = (cls: string | null) => ({ tool: 'x', cls, detail: '', since: 0 }) as Entity['activity'];
  assert.equal(rawJob({ status: 'blocked', activity: null, prompt: null, subagents: [] }), 'ask');
  assert.equal(rawJob({ status: 'done', activity: null, prompt: null, subagents: [] }), 'done');
  assert.equal(rawJob({ status: 'working', activity: act('edit'), prompt: null, subagents: [] }), 'plant');
  assert.equal(rawJob({ status: 'working', activity: act('read'), prompt: null, subagents: [] }), 'inspect');
  assert.equal(rawJob({ status: 'working', activity: act('git'), prompt: null, subagents: [] }), 'haul');
  assert.equal(rawJob({ status: 'working', activity: null, prompt: null, subagents: [] }), 'plan');
});

test('smoother ignores rapid tool churn but follows a sustained change', () => {
  const s = createJobSmoother('plant', 0);
  let t = 0;
  // read/edit flip every second for 30 s: mostly edits
  for (; t < 30; t += 1) s.step(t % 3 === 0 ? 'inspect' : 'plant', t);
  assert.equal(s.job, 'plant');
  // a sustained switch to watering wins after the dwell
  for (; t < 30 + MIN_DWELL_S + 14; t += 0.5) s.step('water', t);
  assert.equal(s.job, 'water');
});

test('smoother: attention states cut through fast, idle needs to hold', () => {
  const s = createJobSmoother('plant', 0);
  s.step('ask', 1); s.step('ask', 1.5);
  assert.equal(s.job, 'ask');
  s.step('plant', 2); s.step('plant', 2.5);
  assert.equal(s.job, 'plant');
  s.step('idle', 10); s.step('idle', 12);
  assert.equal(s.job, 'plant', 'brief idle between turns keeps tools in hand');
  s.step('idle', 15);
  assert.equal(s.job, 'idle');
});

test('shortDetail shortens paths', () => {
  assert.equal(shortDetail('/home/x/src/app/store.ts'), 'app/store.ts');
  assert.equal(shortDetail('npm test'), 'npm test');
});

test('sky: seasons, daylight, deterministic weather', () => {
  assert.equal(seasonOf(8), 'autumn');
  assert.equal(seasonOf(0), 'winter');
  assert.ok(daylightAt(12, 180) > 0.99);
  assert.ok(daylightAt(1, 180) < 0.01);
  const d = new Date(2026, 8, 30, 14, 30);
  assert.deepEqual(skyAt(d).weather, skyAt(d).weather);
  assert.equal(skyAt(d, { hour: 22, weather: 'rain' }).weather.kind, 'rain');
});

// ---- valley

const ws = (id: string, slot: number, label = id): Workspace => ({ id, label, number: slot + 1, colorIndex: slot % 8, cycle: 0, slot, status: 'working', focused: false, paneCount: 1, tabs: [] });
function ent(id: string, w: Workspace, patch: Partial<Entity> = {}): Entity {
  return {
    ...FIELD_DEFAULTS, subagents: [],
    id, terminalId: null, kind: 'claude', name: id, seedKey: id, status: 'working', statusSince: 0, statusSinceApprox: false,
    identity: { terminalId: null, agentSession: null, place: id }, stateSeq: 1, layoutRect: null,
    workspace: { id: w.id, label: w.label, number: w.number, colorIndex: w.colorIndex, cycle: 0, slot: w.slot, status: w.status },
    tab: { id: `${w.id}:t1`, label: 't', number: 1, index: 0 }, paneIndex: 0, cwd: '/x', project: 'x', repo: null, focused: false, baseTitle: null,
    ...patch,
  } as Entity;
}
function fakeSource() {
  let now = 1_000_000;
  const s = { now, workspaces: [] as Workspace[], entities: [] as Entity[] };
  const src: ValleySource = {
    entities: () => s.entities, workspaces: () => s.workspaces, stats: () => null, now: () => now, link: () => 'live', demo: () => true,
  };
  return { s, src, advance: (ms: number) => { now += ms; } };
}

test('valley: plots till on open, harvest and go fallow on close, free the site later', () => {
  const f = fakeSource();
  const v = createValley(f.src, { wallNow: () => 0 });
  const a = ws('w1', 0, 'alpha');
  f.s.workspaces = [a];
  f.s.entities = [ent('p1', a)];
  v.tick();
  assert.equal(v.state.plots.get('w1')?.stage, 'thriving', 'initial plots skip tilling');
  const b = ws('w2', 1, 'beta');
  f.s.workspaces = [a, b];
  f.s.entities = [ent('p1', a), ent('p2', b, { kind: 'shell' })];
  const events: string[] = [];
  v.on((e) => events.push(`${e.kind}:${e.id}`));
  v.tick();
  assert.equal(v.state.plots.get('w2')?.stage, 'tilling');
  assert.deepEqual(v.state.plots.get('w2')?.helpers, ['p2']);
  f.advance(TILL_MS + 1); v.tick();
  assert.equal(v.state.plots.get('w2')?.stage, 'thriving');
  f.s.workspaces = [a]; f.s.entities = [ent('p1', a)];
  v.tick();
  assert.equal(v.state.plots.get('w2')?.stage, 'harvest');
  f.advance(HARVEST_MS + 1); v.tick();
  assert.equal(v.state.plots.get('w2')?.stage, 'fallow');
  // a new workspace in the same slot reclaims the site
  const c = ws('w3', 1, 'gamma');
  f.s.workspaces = [a, c]; v.tick();
  assert.equal(v.state.plots.has('w2'), false);
  assert.equal(v.state.plots.get('w3')?.site, 1);
  assert.ok(events.includes('plot-opened:w2') && events.includes('plot-closed:w2'));
  assert.notEqual(v.state.plots.get('w1')?.kind, v.state.plots.get('w3')?.kind);
});

test('valley: letters for blocks resolve themselves; farmers get spots per plot', () => {
  const f = fakeSource();
  const v = createValley(f.src, { wallNow: () => 0 });
  const a = ws('w1', 0);
  f.s.workspaces = [a];
  f.s.entities = [ent('p1', a, { status: 'blocked' }), ent('p2', a, { paneIndex: 1 })];
  v.tick();
  assert.equal(v.state.letters.length, 1, 'already-blocked agents get a letter on connect');
  assert.equal(unreadCount(v.state.letters), 1);
  assert.equal(v.state.farmers.get('p1')?.needsYou, true);
  assert.deepEqual([v.state.farmers.get('p1')?.spot, v.state.farmers.get('p2')?.spot], [0, 1]);
  f.s.entities = [ent('p1', a), ent('p2', a, { paneIndex: 1 })];
  v.tick();
  assert.equal(v.state.letters[0].resolved, true);
  assert.equal(unreadCount(v.state.letters), 0);
  v.ingest({ t: 'event', id: 'p2', kind: 'commit', detail: { push: false } });
  assert.equal(v.state.letters[0].kind, 'commit');
});

test('projectName: the project directory name, never a path', () => {
  assert.equal(projectName({ project: 'claude-hq', cwd: '/home/d/src/claude-hq/renderer', name: '/home/d/src/claude-hq' }), 'claude-hq');
  assert.equal(projectName({ project: '', cwd: '/home/d/src/tinker/', name: 'x' }), 'tinker');
  assert.equal(projectName({ project: '/home/d/work/api', cwd: '/', name: 'x' }), 'api');
  assert.equal(projectName({ project: '/', cwd: '/', name: 'flint' }), 'flint');
});

test('worldTags: unique per field, with a short distinguishing suffix', () => {
  assert.deepEqual(worldTags([{ name: 'a', project: 'hq' }, { name: 'b', project: 'web' }]), ['hq', 'web']);
  // twins with clean one-word names keep them
  assert.deepEqual(worldTags([{ name: 'Flint', project: 'hq' }, { name: 'Gale', project: 'hq' }, { name: 'x', project: 'web' }]), ['hq·flint', 'hq·gale', 'web']);
  // paths, duplicates or the project itself: numbered, first one bare
  assert.deepEqual(worldTags([{ name: '/home/d/src/hq', project: 'hq' }, { name: 'hq·2', project: 'hq' }, { name: 'Flint', project: 'hq' }]), ['hq', 'hq·2', 'hq·3']);
  assert.deepEqual(worldTags([{ name: 'fix the login bug please', project: 'hq' }, { name: 'review', project: 'hq' }]), ['hq', 'hq·2']);
});

test('valley: farmers and helpers carry project + in-world tag; the full name stays', () => {
  const f = fakeSource();
  const v = createValley(f.src, { wallNow: () => 0 });
  const a = ws('w1', 0), b = ws('w2', 1);
  f.s.workspaces = [a, b];
  const long = '/home/david/src/claude-hq/renderer/src/farm';
  f.s.entities = [
    ent('p1', a, { name: long, project: 'claude-hq', cwd: long }),
    ent('p2', a, { name: `${long}·2`, project: 'claude-hq', cwd: long, paneIndex: 1 }),
    ent('p3', b, { name: 'origami', project: 'origami', cwd: '/home/david/origami' }),
    ent('p4', a, { kind: 'shell', name: 'zsh', project: 'claude-hq', cwd: long, paneIndex: 2 }),
  ];
  v.tick();
  const F = (id: string) => v.state.farmers.get(id)!;
  assert.deepEqual([F('p1').tag, F('p2').tag, F('p3').tag], ['claude-hq', 'claude-hq·2', 'origami']);
  assert.equal(F('p1').name, long);
  assert.equal(F('p1').project, 'claude-hq');
  assert.equal(v.state.helpers.get('p4')?.tag, 'claude-hq', 'helpers are named apart from farmers');
});
