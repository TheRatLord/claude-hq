import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeStretch, createRecaps, demoRecaps, parseRecaps, recapDiffQuery, recapHeadline, recapLine, FINISH_LAG_MS, LOST_MS, MIN_ACTIVE_MS, RECAP_KEEP, SETTLE_MS,
} from './recap.ts';
import type { Recap, RecapData, RecapObs, Stretch } from './recap.ts';
import { createValley } from './valley.ts';
import type { ValleySource } from './valley.ts';
import type { Entity, Workspace } from '../../../../shared/protocol.ts';
import { FIELD_DEFAULTS } from '../../../../shared/protocol.ts';

const T0 = new Date(2026, 9, 2, 10, 0).getTime();
const MIN = 60_000;

const obs = (patch: Partial<RecapObs> = {}): RecapObs => ({
  id: 'p1', tag: 'app', name: 'flint', status: 'idle', title: 'Fix the flaky test', said: null, work: null,
  usage: { day: '2026-10-02', tokens: 1_000_000, cost: 1 }, todos: null,
  git: { repo: 'app', branch: 'main', head: 'aaa1111', dirty: 0, ahead: 0 }, context: 0.3, contextTokens: 60_000, model: 'Opus 5.5', ...patch,
});

/** drive a recorder one tick per second from `from` for `secs` with the same observation */
function run(rc: ReturnType<typeof createRecaps>, o: RecapObs, from: number, secs: number): { now: number; out: Recap[] } {
  const out: Recap[] = [];
  let now = from;
  for (let i = 0; i < secs; i++) { out.push(...rc.observe([o], now)); now += 1000; }
  return { now, out };
}

test('recap: a stretch opens on work, gathers commits / tests / lines / todos / spend, and closes on finish', () => {
  const rc = createRecaps(undefined, { now: T0 });
  let { now } = run(rc, obs(), T0, 3); // seen idle first: the stretch we watch start is not partial
  const todos = [{ content: 'Read', status: 'completed' as const }, { content: 'Fix', status: 'pending' as const }, { content: 'Test', status: 'pending' as const }];
  ({ now } = run(rc, obs({ status: 'working', todos, work: { since: now, added: 0, removed: 0, files: 0 } }), now, 1));
  const since = now - 1000;
  ({ now } = run(rc, obs({ status: 'working', todos, work: { since, added: 40, removed: 8, files: 3 }, usage: { day: '2026-10-02', tokens: 1_600_000, cost: 1.8 } }), now, 120));
  rc.event('p1', 'test-fail', now); rc.event('p1', 'test-pass', now); rc.event('p1', 'commit', now, { msg: 'fix: the race', sha: 'bbb2222' });
  rc.event('p1', 'error', now);
  // asked once in the middle
  ({ now } = run(rc, obs({ status: 'blocked', todos, work: { since, added: 40, removed: 8, files: 3 } }), now, 30));
  const done = obs({
    status: 'done', said: 'Fixed the race; all tests pass.', todos: todos.map((t) => ({ ...t, status: 'completed' as const })),
    work: { since, added: 52, removed: 10, files: 4 }, usage: { day: '2026-10-02', tokens: 2_000_000, cost: 2.5 },
    git: { repo: 'app', branch: 'main', head: 'bbb2222', dirty: 0, ahead: 1 },
  });
  rc.event('p1', 'finished', now);
  // the closing message arrives a moment after the event: the recap waits FINISH_LAG_MS for it
  const r1 = run(rc, done, now, Math.ceil(FINISH_LAG_MS / 1000) + 1);
  assert.equal(r1.out.length, 1);
  const r = r1.out[0];
  assert.equal(r.end, 'finished');
  assert.equal(r.said, 'Fixed the race; all tests pass.');
  assert.deepEqual(r.commits.map((c) => [c.sha, c.msg]), [['bbb2222', 'fix: the race']]);
  assert.deepEqual(r.lines, { added: 52, removed: 10, files: 4 });
  assert.deepEqual(r.tests, { pass: 1, fail: 1, last: 'pass' });
  assert.equal(r.errors, 1);
  assert.deepEqual(r.todos, { done: ['Fix', 'Test'], total: 3, open: 0 }, 'only todos ticked off inside the stretch');
  assert.deepEqual(r.spend, { tokens: 1_000_000, cost: 1.5 });
  assert.equal(r.asks, 1);
  assert.ok(r.waited >= 28_000 && r.waited <= 32_000, `waited ${r.waited}`);
  assert.ok(r.active >= 115_000 && r.active <= 125_000, `active ${r.active}`);
  assert.ok(Math.abs((r.to - r.from) - (now - since)) < 2000);
  assert.deepEqual(r.git, { repo: 'app', branch: 'main', from: 'aaa1111', to: 'bbb2222', dirty: 0, ahead: 1 });
  assert.equal(r.partial, false);
  assert.equal(rc.latest('p1')?.key, r.key);
  assert.equal(rc.get(r.key)?.said, r.said);
  // copy
  assert.equal(recapHeadline(r), 'Shipped a commit');
  assert.match(recapLine(r), /^1 commit · \+52 −10 in 4 files · tests green after 1 red · 2 todos done · \d+ min$/);
  // a clean tree after the commit: a stable range to diff
  assert.deepEqual(recapDiffQuery(r), { from: 'aaa1111', to: 'bbb2222' });
});

test('recap: settles after SETTLE_MS idle; a short return to work continues the stretch; trivial stretches are dropped', () => {
  const rc = createRecaps(undefined, { now: T0 });
  let { now } = run(rc, obs(), T0, 2);
  ({ now } = run(rc, obs({ status: 'working' }), now, 40));
  // a pause shorter than SETTLE_MS, then more work
  let r = run(rc, obs({ status: 'idle' }), now, Math.floor(SETTLE_MS / 1000) - 2);
  assert.equal(r.out.length, 0);
  ({ now } = run(rc, obs({ status: 'working' }), r.now, 40));
  r = run(rc, obs({ status: 'idle', git: { repo: 'app', branch: 'main', head: 'aaa1111', dirty: 3, ahead: 0 } }), now, Math.ceil(SETTLE_MS / 1000) + 1);
  assert.equal(r.out.length, 1, 'one recap for the whole stretch');
  assert.equal(r.out[0].end, 'idle');
  assert.ok(r.out[0].active >= 75_000);
  assert.deepEqual(recapDiffQuery(r.out[0]), { from: 'aaa1111', to: null }, 'nothing committed: the working tree up to now');
  // 20 s of work with nothing to show: no recap
  ({ now } = run(rc, obs({ status: 'working' }), r.now, 20));
  r = run(rc, obs({ status: 'idle' }), now, Math.ceil(SETTLE_MS / 1000) + 1);
  assert.equal(r.out.length, 0);
  assert.ok(20_000 < MIN_ACTIVE_MS);
  // …unless it shipped something
  ({ now } = run(rc, obs({ status: 'working' }), r.now, 5));
  rc.event('p1', 'commit', now, { msg: 'chore: bump', sha: 'zzz' });
  r = run(rc, obs({ status: 'idle' }), now, Math.ceil(SETTLE_MS / 1000) + 1);
  assert.equal(r.out.length, 1);
  assert.equal(r.out[0].commits[0].sha, null, 'a malformed sha is dropped');
});

test('recap: a new prompt mid-stretch banks the earlier task; a task already under way counts only its growth', () => {
  const rc = createRecaps(undefined, { now: T0 });
  let { now } = run(rc, obs({ status: 'done', work: { since: T0 - 30 * MIN, added: 100, removed: 50, files: 5 } }), T0, 2);
  ({ now } = run(rc, obs({ status: 'working', work: { since: T0 - 30 * MIN, added: 110, removed: 50, files: 6 } }), now, 70));
  ({ now } = run(rc, obs({ status: 'working', work: { since: now, added: 7, removed: 1, files: 1 } }), now, 10));
  const r = run(rc, obs({ status: 'idle', work: { since: now - 10_000, added: 9, removed: 2, files: 2 } }), now, Math.ceil(SETTLE_MS / 1000) + 1);
  assert.deepEqual(r.out[0].lines, { added: 19, removed: 2, files: 3 });
});

test('recap: first sight mid-task is partial and dates from the task start; a farmer that leaves closes as left', () => {
  const rc = createRecaps(undefined, { now: T0 });
  const since = T0 - 20 * MIN;
  let { now } = run(rc, obs({ status: 'working', work: { since, added: 30, removed: 3, files: 2 } }), T0, 90);
  // gone: not observed for LOST_MS
  const r = run(rc, { ...obs(), id: 'other' }, now, Math.ceil(LOST_MS / 1000) + 2);
  assert.equal(r.out.length, 1);
  assert.equal(r.out[0].end, 'left');
  assert.equal(r.out[0].from, since);
  assert.equal(r.out[0].partial, true);
  assert.deepEqual(r.out[0].lines, { added: 30, removed: 3, files: 2 });
  void now;
});

test('recap: persistence round-trips open stretches and recaps, keeps RECAP_KEEP per farmer, survives garbage', () => {
  let saved: unknown = null;
  const store = { load: () => saved, save: (d: RecapData) => { saved = JSON.parse(JSON.stringify(d)); } };
  const rc = createRecaps(store, { now: T0 });
  let now = T0;
  for (let i = 0; i < RECAP_KEEP + 3; i++) {
    ({ now } = run(rc, obs(), now, 1));
    ({ now } = run(rc, obs({ status: 'working' }), now, 1));
    rc.event('p1', 'commit', now, { msg: `c${i}`, sha: 'abc1234' });
    ({ now } = run(rc, obs({ status: 'idle' }), now, Math.ceil(SETTLE_MS / 1000) + 1));
  }
  assert.equal(rc.view.farmers.get('p1')!.length, RECAP_KEEP);
  assert.equal(rc.latest('p1')!.commits[0].msg, `c${RECAP_KEEP + 2}`);
  // a stretch open at reload continues
  ({ now } = run(rc, obs({ status: 'working' }), now, 30));
  rc.flush();
  const rc2 = createRecaps(store, { now });
  assert.equal(rc2.view.farmers.get('p1')!.length, RECAP_KEEP);
  ({ now } = run(rc2, obs({ status: 'working' }), now, 40));
  const r = run(rc2, obs({ status: 'idle' }), now, Math.ceil(SETTLE_MS / 1000) + 1);
  assert.equal(r.out.length, 1);
  assert.ok(r.out[0].active >= 65_000, 'time before the reload counts');
  // garbage
  for (const g of [null, 3, 'x', { farmers: 5 }, { farmers: { a: [1, null, { farmerId: 'a' }] }, open: { a: 'x' } }, { open: { p1: { farmerId: 'p1', from: 'x' } } }]) {
    const d = parseRecaps(g, now);
    assert.deepEqual(d.farmers, {}); assert.deepEqual(d.open, {});
  }
  // old open stretches are dropped
  const stale = parseRecaps({ open: { p1: { farmerId: 'p1', from: T0, lastSeen: T0 } } }, T0 + 13 * 3600_000);
  assert.deepEqual(stale.open, {});
});

test('recap: closeStretch copy for red tests and spend across midnight', () => {
  const s: Stretch = {
    farmerId: 'p1', from: T0, lastSeen: T0 + 5 * MIN, active: 5 * MIN, waited: 0, asks: 0, status: 'idle', restSince: null, closeAt: null,
    commits: [], pass: 1, fail: 2, last: 'fail', errors: 0, usage0: { day: '2026-10-01', tokens: 9e6, cost: 9 }, usage1: { day: '2026-10-02', tokens: 2e5, cost: 0.2 },
    todos0: [], head0: null, work0: null, bank: { added: 0, removed: 0, files: 0 }, work: null, partial: false, snap: null,
  };
  const r = closeStretch(s, T0 + 5 * MIN, 'idle')!;
  assert.equal(recapHeadline(r), 'Stopped with tests failing');
  assert.match(recapLine(r), /tests red \(2\/3\)/);
  assert.deepEqual(r.spend, { tokens: 2e5, cost: 0.2 });
  assert.equal(recapDiffQuery(r), null, 'no repo: no diff');
});

test('recap: demo histories are deterministic and plausible', () => {
  const f = { id: 'd1:p1', tag: 'app', name: 'flint', title: 'Fix it', git: obs().git };
  const a = demoRecaps(f, T0), b = demoRecaps(f, T0);
  assert.deepEqual(a, b);
  let n = 0, commits = 0;
  for (let i = 0; i < 20; i++) {
    const rs = demoRecaps({ ...f, id: `d1:p${i}` }, T0);
    n += rs.length;
    for (const r of rs) {
      commits += r.commits.length;
      assert.ok(r.to <= T0 && r.from < r.to);
      assert.ok(recapDiffQuery(r));
    }
    for (let k = 1; k < rs.length; k++) assert.ok(rs[k].to < rs[k - 1].from, 'newest first, no overlap');
  }
  assert.ok(n > 15 && commits > 10, `${n} recaps, ${commits} commits`);
});

// ---- through the valley model

const ws: Workspace = { id: 'w1', label: 'app', number: 1, colorIndex: 0, cycle: 0, slot: 0, status: 'working', focused: false, paneCount: 1, tabs: [] };
const ent = (patch: Partial<Entity>): Entity => ({
  ...FIELD_DEFAULTS, subagents: [],
  id: 'p1', terminalId: null, kind: 'claude', name: 'flint', seedKey: 'p1', status: 'idle', statusSince: 0, statusSinceApprox: false,
  identity: { terminalId: null, agentSession: null, place: 'p1' }, stateSeq: 1, layoutRect: null,
  workspace: { id: ws.id, label: ws.label, number: 1, colorIndex: 0, cycle: 0, slot: 0, status: 'working' },
  tab: { id: 'w1:t1', label: 't', number: 1, index: 0 }, paneIndex: 0, cwd: '/x/app', project: 'app', repo: null, focused: false, baseTitle: null,
  git: { root: '/x/app', branch: 'main', head: 'aaa1111', dirty: 0, untracked: 0, ahead: 0, behind: 0, lastCommit: null },
  ...patch,
}) as Entity;

test('valley: a finished stretch becomes a recap, a `harvested` event and the finished letter carries it', () => {
  let now = T0;
  let e = ent({});
  const src: ValleySource = { entities: () => [e], workspaces: () => [ws], stats: () => null, now: () => now, link: () => 'live', demo: () => false };
  const v = createValley(src, { wallNow: () => now });
  const evs: string[] = [];
  v.on((x) => { if (x.kind === 'harvested') evs.push(`${x.id}|${x.detail}`); });
  for (let i = 0; i < 3; i++) { v.tick(); now += 1000; }
  e = ent({ status: 'working', title: 'Fix it', work: { since: now, added: 12, removed: 2, files: 1 }, activity: { tool: 'Edit', cls: 'edit', detail: 'a.ts', since: now } as Entity['activity'] });
  for (let i = 0; i < 90; i++) { v.tick(); now += 1000; }
  v.ingest({ t: 'event', id: 'p1', kind: 'commit', detail: { msg: 'fix: it', sha: 'bbb2222' } });
  e = ent({ status: 'done', title: 'Fix it', lastText: 'All done.', work: { since: T0, added: 12, removed: 2, files: 1 } });
  v.ingest({ t: 'event', id: 'p1', kind: 'finished' });
  for (let i = 0; i < 4; i++) { v.tick(); now += 1000; }
  assert.equal(evs.length, 1);
  const r = v.state.recaps!.farmers.get('p1')![0];
  assert.equal(evs[0], `p1|${r.key}`);
  assert.equal(r.said, 'All done.');
  assert.equal(r.commits.length, 1);
  const l = v.state.letters.find((x) => x.kind === 'finished')!;
  assert.equal(l.recap, r.key);
  assert.match(l.body, /Fix it · 1 commit/);
  // the demo valley seeds a history for farmers it meets
  v.useRecaps(undefined, (f, t) => demoRecaps({ ...f, id: 'seeded' }, t).map((x) => ({ ...x, farmerId: f.id, key: `${f.id}@${x.from}` })));
  v.tick();
  assert.ok(v.state.recaps!.rev > 0);
});
