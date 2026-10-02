import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contextFill, costLabel, emptySpendLedger, modelLabel, plotRepo, recordSpend, repoView, spendToday, todoItems, tokensLabel, valleySpend, TODO_ITEMS_MAX,
} from './signals.ts';
import { createValley } from './valley.ts';
import type { ValleySource } from './valley.ts';
import type { Entity, GitInfo, Todo, Workspace } from '../../../../shared/protocol.ts';
import { FIELD_DEFAULTS } from '../../../../shared/protocol.ts';
import { localDay } from '../../../../shared/pricing.ts';

const NOW = new Date(2026, 9, 2, 15, 0).getTime();
const git = (root: string, o: Partial<GitInfo> = {}): GitInfo => ({
  root, branch: 'main', head: 'abc1234', dirty: 2, untracked: 1, ahead: 1, behind: 0, lastCommit: { subject: 'Ship it', at: NOW - 60_000 }, ...o,
});

test('signals: model labels', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelLabel('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
  assert.equal(modelLabel('claude-sonnet-5[1m]'), 'Sonnet 5 1M');
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelLabel('gpt-5-codex'), 'Codex');
  assert.equal(modelLabel(''), null);
  assert.equal(modelLabel(null), null);
});

test('signals: context fill uses the model window (1M once past 200k)', () => {
  assert.deepEqual(contextFill({ model: 'claude-opus-5-5', contextTokens: 164_000 }), { fill: 0.82, size: 200_000 });
  assert.deepEqual(contextFill({ model: 'claude-opus-5-5', contextTokens: 400_000 }), { fill: 0.4, size: 1_000_000 });
  assert.equal(contextFill({ model: 'x', contextTokens: null }), null);
});

test('signals: repo views and the field repo (most panes, agents count double)', () => {
  assert.equal(repoView(null), null);
  const v = repoView(git('/home/me/src/claude-hq', { dirty: -3 as number, ahead: null }));
  assert.equal(v?.repo, 'claude-hq');
  assert.equal(v?.dirty, 0);
  assert.equal(v?.ahead, null);
  const p = plotRepo([
    { kind: 'claude', git: git('/r/a', { branch: 'feat/x', lastCommit: { subject: 'newer', at: NOW } }) },
    { kind: 'claude', git: git('/r/a') },
    { kind: 'shell', git: git('/r/b') },
    { kind: 'shell', git: git('/r/b') },
    { kind: 'claude', git: null },
  ]);
  assert.equal(p?.repo, 'a');
  assert.equal(p?.panes, 2);
  assert.equal(p?.branches, 2);
  assert.equal(p?.lastCommit?.subject, 'newer');
  assert.equal(plotRepo([]), null);
});

test('signals: spend today, and the valley ledger keeps farmers who went home', () => {
  const day = localDay(NOW);
  assert.equal(spendToday({ day: '2026-10-01', tokens: 5, output: 1, cost: 1, partial: false }, NOW), null);
  assert.equal(spendToday({ day, tokens: 0, output: 0, cost: null, partial: false }, NOW), null);
  assert.deepEqual(spendToday({ day, tokens: 900, output: 10, cost: 0.5, partial: true }, NOW), { tokens: 900, cost: 0.5, partial: true });
  const l = emptySpendLedger();
  recordSpend(l, 'a', { tokens: 1000, cost: 1.004, partial: false }, NOW);
  recordSpend(l, 'b', { tokens: 500, cost: null, partial: false }, NOW);
  recordSpend(l, 'a', { tokens: 2000, cost: 2.5, partial: false }, NOW); // a's latest figure replaces its earlier one
  assert.deepEqual(valleySpend(l, NOW), { day, tokens: 2500, cost: 2.5, agents: 2, partial: false });
  // a new day starts empty
  assert.equal(valleySpend(l, NOW + 86_400_000).agents, 0);
  recordSpend(l, 'c', null, NOW + 86_400_000);
  assert.equal(l.by.size, 0);
});

test('signals: todo checklist (long lists window around the current item) and labels', () => {
  const t = (i: number, status: Todo['status']): Todo => ({ content: `step ${i}`, activeForm: `doing step ${i}`, status });
  assert.deepEqual(todoItems([t(1, 'completed'), t(2, 'in_progress'), t(3, 'pending')]), [
    { text: 'step 1', state: 'done' }, { text: 'doing step 2', state: 'doing' }, { text: 'step 3', state: 'todo' },
  ]);
  const long = Array.from({ length: 20 }, (_, i) => t(i, i < 15 ? 'completed' : i === 15 ? 'in_progress' : 'pending'));
  const items = todoItems(long);
  assert.equal(items.length, TODO_ITEMS_MAX);
  assert.equal(items.at(-1)?.text, 'step 19');
  assert.ok(items.some((x) => x.state === 'doing'));
  assert.equal(tokensLabel(1_234_567), '1.2M');
  assert.equal(tokensLabel(34_500), '35k');
  assert.equal(costLabel(1.236), '$1.24');
  assert.equal(costLabel(0.004), '<$0.01');
  assert.equal(costLabel(null), '');
});

test('valley: farmer, helper, field and valley signals end to end', () => {
  const w: Workspace = { id: 'w1', label: 'alpha', number: 1, colorIndex: 0, cycle: 0, slot: 0, status: 'working', focused: false, paneCount: 2, tabs: [] };
  const base = (id: string, patch: Partial<Entity>): Entity => ({
    ...FIELD_DEFAULTS, subagents: [],
    id, terminalId: null, kind: 'claude', name: id, seedKey: id, status: 'working', statusSince: 0, statusSinceApprox: false,
    identity: { terminalId: null, agentSession: null, place: id }, stateSeq: 1, layoutRect: null,
    workspace: { id: 'w1', label: 'alpha', number: 1, colorIndex: 0, cycle: 0, slot: 0, status: 'working' },
    tab: { id: 't', label: 't', number: 1, index: 0 }, paneIndex: 0, cwd: '/r/a', project: 'a', repo: null, focused: false, baseTitle: null, ...patch,
  }) as Entity;
  let entities = [
    base('p1', {
      model: 'claude-opus-5-5', contextTokens: 170_000, git: git('/r/a'), usage: { day: localDay(NOW), tokens: 3_000_000, output: 40_000, cost: 2.75, partial: false },
      todos: [{ content: 'a', activeForm: 'doing a', status: 'completed' }, { content: 'b', activeForm: 'doing b', status: 'in_progress' }],
    }),
    base('p2', { kind: 'shell', git: git('/r/a') }),
  ];
  const src: ValleySource = { entities: () => entities, workspaces: () => [w], stats: () => null, now: () => NOW, link: () => 'live', demo: () => false };
  const v = createValley(src, { wallNow: () => NOW });
  v.tick();
  const f = v.state.farmers.get('p1');
  assert.equal(f?.model, 'Opus 5.5');
  assert.equal(f?.context, 0.85);
  assert.equal(f?.contextWindow, 200_000);
  assert.equal(f?.git?.branch, 'main');
  assert.deepEqual(f?.spend, { tokens: 3_000_000, cost: 2.75, partial: false });
  assert.deepEqual(f?.todos?.items.map((x) => x.state), ['done', 'doing']);
  assert.equal(v.state.helpers.get('p2')?.git?.repo, 'a');
  assert.equal(v.state.plots.get('w1')?.git?.panes, 2);
  assert.deepEqual(v.state.spend, { day: localDay(NOW), tokens: 3_000_000, cost: 2.75, agents: 1, partial: false });
  // the farmer goes home: the valley's day still counts their spend
  entities = [entities[1]];
  v.tick();
  assert.equal(v.state.spend?.cost, 2.75);
  // an old server / recording without the rev-2 fields: everything reads as unknown
  entities = [base('p3', { git: undefined, usage: undefined, model: null })];
  v.tick();
  const g = v.state.farmers.get('p3');
  assert.equal(g?.git, null);
  assert.equal(g?.spend, null);
  assert.equal(g?.model, null);
});
