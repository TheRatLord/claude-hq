// Unit tests for the M3.5 "walk up and manage" UI models: status card v2 lines, triage order + inbox-zero streak,
// hire spawn message + gate, prompt confirm, unread breakdown, renames + twin labels, deep links. Owner: UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { todoLine, workLine, ctxInfo, stuckLine, readyNudge, CTX_HOT } from './cardModel.ts';
import { triageQueue, screenTail, createStreak } from './triage.ts';
import { spawnMessage, recentCwds, canSpawn, MUTATIONS_OFF_TEXT } from './hireDialog.ts';
import { promptConfirmText, PROMPT_CHIPS } from './promptBar.ts';
import { createUnread, sinceLabel, badgeOf, newsOf } from './unread.ts';
import { bindAliases, setAlias, aliasOf } from './aliases.ts';
import { createNames } from './names.ts';
import { resolveDeepLink } from './deeplink.ts';
import { BINDINGS } from './keymap.ts';
import { ent, ident, must } from './testFixtures.ts';
import type { Todo, Entity } from '../../../shared/protocol.ts';
import type { AliasEntry } from './aliases.ts';
import type { SavedMark } from './unread.ts';

test('M3.5 status card v2: todo ▶ line, work, context bar, stuck reason, ready nudge', () => {
  const todos: Todo[] = [
    { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
    { content: 'Fix the bug', status: 'completed', activeForm: 'Fixing the bug' },
    { content: 'Run the tests', status: 'in_progress', activeForm: 'Running the tests' },
    { content: 'Commit', status: 'pending', activeForm: 'Committing' },
  ];
  assert.equal(todoLine(todos)?.text, '3/4 ▶ Running the tests', 'in-progress first, with its activeForm');
  // never only crossed-out lines: nothing in progress → the next pending one
  assert.equal(todoLine(todos.map((t): Todo => (t.status === 'in_progress' ? { ...t, status: 'completed' } : t)))?.text, '3/4 · next: Commit');
  assert.equal(todoLine(todos.map((t): Todo => ({ ...t, status: 'completed' })))?.text, '4/4 ✓ all done');
  assert.equal(todoLine(null), null);
  const now = 1_000_000_000;
  assert.equal(workLine({ since: now - 12 * 60_000, added: 120, removed: 34, files: 5 }, now), '+120 −34 · 5 files · 12m on task');
  assert.equal(workLine({ since: now - 30_000, added: 0, removed: 0, files: 0 }, now), '30s on task');
  assert.equal(workLine(null, now), null);
  const c = ctxInfo(180_000);
  assert.ok(c);
  assert.ok(c.hot && c.frac > CTX_HOT && /compaction soon/.test(c.label), c.label);
  assert.ok(!ctxInfo(100_000)?.hot);
  assert.equal(stuckLine({ level: 2, reason: 'fails', detail: '3 test fails in a row' }), '3 test fails in a row');
  assert.equal(stuckLine({ level: 1, reason: 'context' }), 'context nearly full');
  assert.equal(stuckLine({ level: 0, reason: 'fails' }), null);
  assert.ok(readyNudge({ kind: 'claude', status: 'idle' }));
  assert.ok(readyNudge(ent({ kind: 'claude', status: 'done', ack: { at: 1 } })));
  assert.ok(!readyNudge({ kind: 'claude', status: 'done' }), 'done but not signed off: sign off first');
  assert.ok(!readyNudge({ kind: 'shell', status: 'idle' }));
});

test('M3.5 status card source: blocked says B answer / G go to ticket; T talk hint', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./statusCard.ts', import.meta.url), 'utf8');
  assert.match(src, /hint\('B', 'answer'\)/);
  assert.match(src, /hint\('G', 'go to ticket'\)/);
  assert.match(src, /hint\('T', 'talk'\)/);
  assert.match(src, /todoLine\(e\.todos\)/);
  assert.match(src, /workLine\(wk, now\)/);
  assert.match(src, /lastTextLine\(e\.lastText\)/);
});

test('M3.5 keymap: T talk, Q pat, R summon, Shift+N rename, Shift+B triage are bound in the world', () => {
  const w = BINDINGS.world.filter((b) => b.action);
  const has = (keys: string, action: string) => w.some((b) => b.keys === keys && b.action === action);
  assert.ok(has('T', 'talk') && has('Q', 'pat') && has('R', 'summon') && has('Shift+N', 'rename') && has('Shift+B', 'triage'));
  assert.ok(BINDINGS.roster.some((b) => b.keys === 'T' && b.action === 'talk'));
});

test('M3.5 triage: blocked → done-unacked → struggling; skip goes last; screen tail', () => {
  const E = [
    ent({ id: 'w', kind: 'claude', status: 'working', statusSince: 1, struggle: { level: 2 } }),
    ent({ id: 'd', kind: 'claude', status: 'done', statusSince: 5 }),
    ent({ id: 'da', kind: 'claude', status: 'done', ack: { at: 1 }, statusSince: 1 }),
    ent({ id: 'b2', kind: 'claude', status: 'blocked', statusSince: 9 }),
    ent({ id: 'b1', kind: 'claude', status: 'blocked', statusSince: 3 }),
    ent({ id: 's', kind: 'shell', status: 'blocked', statusSince: 1 }),
    ent({ id: 'i', kind: 'claude', status: 'idle', statusSince: 1 }),
  ];
  assert.deepEqual(triageQueue(E).map((e) => e.id), ['b1', 'b2', 'd', 'w']);
  assert.deepEqual(triageQueue(E, new Set(['b1'])).map((e) => e.id), ['b2', 'd', 'w', 'b1']);
  assert.deepEqual(screenTail(['a', 'b', '', 'c', '', '  '], 2), ['b', '', 'c'].slice(-2));
  assert.equal(screenTail(Array.from({ length: 30 }, (_, i) => `l${i}`)).length, 12);
});

test('M3.5 inbox zero: fires once when the last blocked clears after answers; per-day best', async () => {
  const ents = new Map<string, Entity>([['a', ent({ id: 'a', status: 'blocked' })], ['b', ent({ id: 'b', status: 'blocked' })]]);
  const emitted: unknown[] = [];
  const toasts: [string, string | undefined][] = [];
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  let t = 0;
  const s = createStreak({ store: { entities: ents }, bus: { emit: (k, v) => emitted.push([k, v]) }, toast: (l, x, o) => toasts.push([x, o?.sub]), storage, now: () => t });
  assert.equal(s.check(), null);
  s.answered(); t = 20_000; must(ents, 'a').status = 'working'; assert.equal(s.check(), null, 'b still blocked');
  s.answered(); t = 52_000; must(ents, 'b').status = 'working';
  assert.deepEqual(s.check(), { answered: 2, ms: 52_000 });
  assert.deepEqual(emitted, [['inbox.zero', { answered: 2, ms: 52_000 }]]);
  assert.equal(toasts[0][0], 'Inbox zero! 2 answered in 0:52');
  assert.equal(s.check(), null, 'fires once');
  assert.equal(JSON.parse(mem.get('hq.inboxZero.best') ?? 'null').answered, 2);
  // cleared elsewhere (no answers here) → no celebration
  must(ents, 'a').status = 'blocked'; s.check(); must(ents, 'a').status = 'idle';
  assert.equal(s.check(), null);
  assert.equal(emitted.length, 1);
  // storage that throws never breaks it
  const s2 = createStreak({ store: { entities: new Map([['x', ent({ id: 'x', status: 'blocked' })]]), now: () => 0 }, bus: null, toast: () => {}, storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } });
  s2.check(); s2.answered();
  // triage moves on before the reply: an answer in flight holds inbox zero so the count is whole
  const e3 = new Map<string, Entity>([['p', ent({ id: 'p', status: 'blocked' })]]);
  const em3: unknown[] = [];
  const s3 = createStreak({ store: { entities: e3, now: () => 0 }, bus: { emit: (_k, v) => { em3.push(v); } }, toast: () => {}, storage: null, now: () => 0 });
  s3.check(); s3.pend(1); must(e3, 'p').status = 'working';
  assert.equal(s3.check(), null, 'held while the answer is in flight');
  s3.answered();
  assert.deepEqual(s3.check(), null, 'still pending');
  s3.pend(-1);
  await Promise.resolve();
  assert.deepEqual(em3, [{ answered: 1, ms: 0 }], 'fires once the answer lands, with it counted');
});

test('M3.5 hire: spawn message per form, gate on hello.allowMutations, recent cwds', () => {
  const wss = [{ id: 'w1', label: 'infra' }];
  assert.deepEqual(spawnMessage({ kind: 'claude', ws: 'w1', newWs: '', cwd: '/src/x/', name: 'bob', prompt: 'say hi' }, wss).msg,
    { t: 'spawn', kind: 'claude', cwd: '/src/x', workspaceId: 'w1', name: 'bob', label: 'bob', prompt: 'say hi' });
  assert.deepEqual(spawnMessage({ kind: 'shell', ws: '__new', newWs: 'scratch', cwd: '', name: '', prompt: 'ignored' }, wss).msg, { t: 'spawn', label: 'scratch' });
  assert.match(spawnMessage({ kind: 'claude', ws: '__new', newWs: '', cwd: '', name: '', prompt: '' }, wss).why ?? '', /Name the new workspace/);
  assert.match(spawnMessage({ kind: 'claude', ws: 'w1', newWs: '', cwd: 'rel/path', name: '', prompt: '' }, wss).why ?? '', /absolute/);
  assert.match(spawnMessage({ kind: 'claude', ws: 'gone', newWs: '', cwd: '', name: '', prompt: '' }, wss).why ?? '', /gone/);
  const defaultSession = { allowMutations: false, session: 'default' };
  assert.equal(canSpawn(defaultSession), false);
  assert.equal(canSpawn({ allowMutations: true }), true);
  assert.match(MUTATIONS_OFF_TEXT, /--session <name>/);
  assert.doesNotMatch(MUTATIONS_OFF_TEXT, /--allow-mutations/); // the backend refuses that flag on the default session
  assert.deepEqual(recentCwds([ent({ cwd: '/a', statusSince: 1 }), ent({ cwd: '/b', statusSince: 5 }), ent({ cwd: '/a', activity: { since: 9 } }), ent({ cwd: 'x' })]), ['/a', '/b']);
});

test('M3.5 talk: confirm text and chips', () => {
  assert.equal(promptConfirmText('  say   hi ', 'tinker'), 'Send “say hi” to tinker?');
  assert.ok(promptConfirmText('x'.repeat(100), 'a').includes('…'));
  assert.deepEqual(PROMPT_CHIPS.map((c) => c.label), ['continue', 'run tests', 'commit', 'summarize']);
});

test('M3.5 unread: news granularity, since-you-looked, no 9+ without real messages', () => {
  let saved: SavedMark[] | null = null;
  const u = createUnread({ load: () => null, save: (v) => { saved = v; } });
  const e = { id: 'p1', identity: ident('t1') };
  u.bump(e, { src: 'turn', msgs: 1, edits: 4 });
  assert.equal(u.of('p1'), 1);
  assert.equal(sinceLabel(u.detailOf('p1')), 'since you looked: 1 msg · 4 edits');
  const s = { id: 's1', identity: ident('t2') };
  for (let i = 0; i < 20; i++) u.bump(s, { src: 'shell', lines: 3 });
  assert.equal(u.of('s1'), 1, 'output alone is a dot, never 9+');
  assert.equal(u.bump({ id: 'z', identity: ident('z') }, { src: 'turn', msgs: 0, edits: 0 }), 0, 'an empty turn adds nothing');
  u.bump(e, { src: 'done' });
  assert.equal(u.of('p1'), 2);
  assert.match(sinceLabel(u.detailOf('p1')), /finished/);
  assert.ok(saved);
  const persisted: SavedMark[] = saved;
  assert.ok(persisted.some((x) => x.b && x.b.edits === 4));
  // persisted breakdown survives a reload by identity
  const u2 = createUnread({ load: () => persisted, save: () => {} });
  u2.rebind([{ id: 'p9', identity: ident('t1') }]);
  assert.equal(u2.detailOf('p9')?.edits, 4);
  assert.deepEqual(newsOf({ src: 'text' }), { msgs: 1, edits: 0, lines: 0, done: 0 });
  assert.equal(badgeOf(null), 0);
});

test('M3.5 names: a rename (by identity) shows on every surface, twins keep their · n; deep links resolve both', () => {
  const mem: { v: AliasEntry[] | null } = { v: null };
  bindAliases({ load: () => mem.v, save: (v) => { mem.v = v; } });
  const ents = [
    ent({ id: 'p1', name: 'claude', kind: 'claude', identity: ident('a'), workspace: { label: 'infra' } }),
    ent({ id: 'p2', name: 'claude', kind: 'claude', identity: ident('b'), workspace: { label: 'infra' } }),
    ent({ id: 'p3', name: 'flint', kind: 'claude', identity: ident('c'), workspace: { label: 'core' } }),
  ];
  const store = { entities: new Map(ents.map((e) => [e.id, e])) };
  const n = createNames(store);
  assert.equal(n.label(ents[1]), 'claude · 2');
  for (const q of ['claude · 2', 'claude·2', 'Claude ·2']) assert.deepEqual(resolveDeepLink(q, ents), { kind: 'agent', id: 'p2' }, q);
  const amb = resolveDeepLink('claude', ents);
  assert.equal(amb.kind, 'ambiguous');
  assert.deepEqual(resolveDeepLink('inbox:flint', ents), { kind: 'inbox', id: 'p3' });
  assert.equal(resolveDeepLink('inbox:nobody', ents).kind, 'none', 'waits for the pane');
  // rename p3 → 'scout' by identity; a rekeyed pane (new id, same terminalId) keeps it
  assert.ok(setAlias(ents[2], 'scout'));
  assert.equal(aliasOf({ identity: ident('c') }), 'scout');
  assert.equal(n.label(ents[2]), 'scout');
  assert.deepEqual(resolveDeepLink('scout', ents), { kind: 'agent', id: 'p3' });
  // renaming the twin to its sibling's name keeps labels unique
  setAlias(ents[1], 'scout');
  assert.deepEqual([n.label(ents[1]), n.label(ents[2])].sort(), ['scout', 'scout · 2']);
  assert.ok(mem.v?.length === 2, 'persisted by identity');
  setAlias(ents[1], ''); setAlias(ents[2], '');
  assert.equal(n.label(ents[2]), 'flint');
  bindAliases(null);
});

// ---- [UI fix r1] -----------------------------------------------------------------------------------------------------
test('fix r1: spawn call timeout outlasts the BE spawn budget (no "Hire failed: timeout" for a slow boot)', async () => {
  const { SPAWN_CALL_TIMEOUT_MS, SPAWN_SLACK_MS } = await import('./hireDialog.ts');
  const { SPAWN_SHELL_MS, SPAWN_READY_MS } = await import('../../../server/world/actions.ts');
  assert.ok(SPAWN_CALL_TIMEOUT_MS > SPAWN_SHELL_MS + SPAWN_READY_MS, `${SPAWN_CALL_TIMEOUT_MS} > ${SPAWN_SHELL_MS} + ${SPAWN_READY_MS}`);
  assert.ok(SPAWN_CALL_TIMEOUT_MS >= SPAWN_SHELL_MS + SPAWN_READY_MS + SPAWN_SLACK_MS, 'room for the tab.create / agent.start round trips');
});

test('fix r1: the summon toast says what the agent does (P6)', async () => {
  const { summonText } = await import('./cardModel.ts');
  assert.match(summonText('gale', 'come', { status: 'idle' }), /on its way/);
  assert.match(summonText('gale', undefined, { status: 'done' }), /on its way/);
  for (const st of ['working', 'blocked'] as const) {
    assert.doesNotMatch(summonText('claude', 'refuse', { status: st }), /on its way/, st);
    assert.doesNotMatch(summonText('claude', undefined, { status: st }), /on its way/, `${st} (no actor)`);
  }
  assert.match(summonText('claude', 'refuse', { status: 'working' }), /busy · waves from the desk/);
  assert.match(summonText('gale', 'refuse', { status: 'blocked' }), /points at its ticket/);
  assert.match(summonText('pt-shell', 'beep', { kind: 'shell' }), /beep!/);
  assert.match(summonText('pt-shell', undefined, { kind: 'shell', status: 'idle' }), /beep!/);
  assert.doesNotMatch(summonText('gale', 'cooldown', { status: 'idle' }), /on its way/);
});

test('fix r1: a closed pane is named in words, not "Pane closed (closed)."', async () => {
  const { lifeView } = await import('./terminal/lifecycle.ts');
  assert.equal(lifeView({ state: 'gone', detail: 'closed' }, { name: 'pt-shell' }).banner, 'pt-shell was closed in herdr.');
  assert.match(lifeView({ state: 'gone', detail: 'exited' }, { name: 'scout' }).banner ?? '', /^scout exited/);
  assert.match(lifeView({ state: 'gone' }).banner ?? '', /^This pane closed\.$/);
});

test('fix r1: jargon — the help legend has unknown, and "≥" is spelled out', async () => {
  const { AT_LEAST, UNKNOWN_TIP } = await import('./help.ts');
  assert.match(AT_LEAST, /^at least/);
  assert.match(UNKNOWN_TIP, /unknown/);
});

test('fix r1: walk-up occlusion helpers (own body hides its screen, neighbour frame cover, live facing)', async () => {
  const { segHitsBody, screenBodyHidden, maxCover, liveFacing, WALKUP } = await import('./goto.ts');
  // a body between the lens and the point
  assert.ok(segHitsBody(0, 1.2, 0, 2, 0.7, 0, 1, 0, 0, 1.0));
  assert.ok(!segHitsBody(0, 1.2, 0, 2, 0.7, 0, 1, 0.6, 0, 1.0), 'passes beside');
  assert.ok(!segHitsBody(0, 2.5, 0, 2, 2.4, 0, 1, 0, 0, 1.0), 'passes over the crown');
  // the screen straight behind the sitter, seen from behind it: hidden by its own body
  const M = { x: 0, y: 0.674, z: -0.78, nx: 0, nz: 1, w: 0.37, h: 0.155 };
  assert.equal(screenBodyHidden(M, { x: 0, y: 1.2, z: 1.5 }, [{ pos: { x: 0, y: 0, z: 0 }, seated: true, r: WALKUP.ownR }]), 1);
  assert.equal(screenBodyHidden(M, { x: 1.4, y: 1.2, z: -0.4 }, [{ pos: { x: 0, y: 0, z: 0 }, seated: true, r: WALKUP.ownR }]), 0, 'from beside the desk');
  // a neighbour 0.7 m in front of the lens fills the frame; one 4 m off does not
  const lens = { x: 0, y: 1.2, z: 0, yaw: 0, pitch: -0.3 };
  assert.ok(maxCover(lens, [{ pos: { x: 0, y: 0, z: -0.7 }, arrived: true, intent: { slot: { pose: 'sit' } } }]) > WALKUP.maxCover);
  assert.ok(maxCover(lens, [{ pos: { x: 0.5, y: 0, z: -4 } }]) < WALKUP.maxCover);
  assert.equal(maxCover(lens, [{ pos: { x: 0, y: 0, z: 2 } }]), 0, 'behind the lens');
  // CHR's face turn: 25° toward a player ≤ 1.5 m, nothing from behind or beyond 2 m
  assert.ok(Math.abs(liveFacing(Math.cos(1.2), 1.2) - Math.cos(1.2 - WALKUP.turn)) < 1e-9);
  assert.equal(liveFacing(Math.cos(2.6), 1.2), Math.cos(2.6));
  assert.equal(liveFacing(0.2, 2.2), 0.2);
});

test('fix r2: screen-space eye check, walk-up lens, pitch cap', async () => {
  const { eyesView, frameNdc, predictEyes, walkUpFov, WALKUP } = await import('./goto.ts');
  // a face at the origin looking along +z (yaw π: forward = (−sin π, −cos π) = (0, +1))
  const face = { x: 0, y: 0.62, z: 0 };
  const eyes = predictEyes(face, Math.PI);
  const lensAt = (x: number, z: number, pitch: number = WALKUP.pitchMin) => ({ x, y: 1.2, z, yaw: Math.atan2(-(0 - x), -(0 - z)), pitch });
  // straight in front at 1.6 m: both eyes in frame, facing, unhidden
  const front = eyesView(lensAt(0, 1.6), eyes);
  assert.equal(front.n, 2); assert.equal(front.good, 2);
  // behind the head: no eye reads (the back-of-head "tier 0" shots, reviewer art)
  assert.equal(eyesView(lensAt(0, -1.6), eyes).n, 0);
  // a profile at ~80°: in frame, but not a face
  const side = eyesView(lensAt(1.6, 0.28), eyes);
  assert.equal(side.good, 0);
  // looking away (yaw off by 90°): both eyes off-frame
  const away = { ...lensAt(0, 1.6), yaw: lensAt(0, 1.6).yaw + Math.PI / 2 };
  assert.equal(eyesView(away, eyes).inFrame, 0);
  // an occluding body between lens and face hides them
  assert.equal(eyesView(lensAt(0, 1.6), eyes, { others: [{ pos: { x: 0, y: 0, z: 0.8 } }] }).n, 0);
  assert.ok(Math.abs(frameNdc({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, { x: 0, y: 0, z: -2 })?.x ?? NaN) < 1e-9, 'straight ahead → ndc 0');
  // the lens widens only nearer than frameDist, never past fovMax
  assert.equal(walkUpFov(2.0), WALKUP.fovBase);
  assert.ok(walkUpFov(1.3) > WALKUP.fovBase && walkUpFov(1.3) <= WALKUP.fovMax);
  assert.equal(walkUpFov(0.6), WALKUP.fovMax);
  assert.ok(WALKUP.pitchMin >= -0.25 - 1e-9 && WALKUP.deskMin >= 1.15 - 1e-9);
});

test('fix r2: stand search is time-sliced; a live eye check demotes a tier-0 front runner', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { createNav } = await import('../world/nav/index.ts');
  const { standBegin, standStep, WALKUP } = await import('./goto.ts');
  const nav = createNav(layout);
  const sl = layout.slots.find((x) => x.id === 'slot:desk:E2:5') ?? layout.slots.find((x) => /^slot:desk:E/.test(x.id));
  assert.ok(sl);
  const a = { id: 'a', pos: { x: sl.pos.x, y: 0, z: sl.pos.z }, yaw: sl.yaw, intent: { slot: sl }, arrived: true };
  const job = standBegin({ a, others: [], layout, nav, eyeH: 1.2, faceYaw: sl.yaw });
  assert.equal(job.scored.length, 0, 'standBegin scores nothing (the work is in standStep)');
  let steps = 0;
  while (!standStep(job, WALKUP.routesPerFrame, 0.3)) { steps++; assert.ok(steps < 5000); }
  assert.ok(steps > 3, `scoring spread over frames (${steps + 1} steps)`);
  assert.ok(job.result, 'a stand');
  // validate: a rig whose eyes never show demotes every walk-up spot out of tier 0 / 1
  const blind = standBegin({ a, others: [], layout, nav, eyeH: 1.2, faceYaw: sl.yaw, validate: () => ({ n: 0, good: 0 }) });
  standStep(blind);
  assert.ok(blind.result);
  assert.equal(blind.result.tier, 2, 'no eyes → never a face tier');
  const one = standBegin({ a, others: [], layout, nav, eyeH: 1.2, faceYaw: sl.yaw, validate: () => ({ n: 1, good: 0 }) });
  standStep(one);
  assert.ok(one.result?.tier !== undefined && one.result.tier >= 1, 'one eye → at best tier 1');
});

test('fix r2: short distinct tab labels, card glyphs, inbox-zero clock', async () => {
  const { shortTabLabels } = await import('./terminal/tabs.ts');
  const t = shortTabLabels(['moss', 'c', 'claude', 'ledgerbot', 'onyx', 'claude · 2']);
  assert.equal(new Set(t).size, t.length, `distinct: ${t}`);
  assert.deepEqual(t, ['moss', 'c', 'claude', 'ledge…', 'onyx', 'claude·2']);
  const u = shortTabLabels(['claude-api-server', 'claude-api-client']);
  assert.equal(new Set(u).size, 2, `grown until distinct: ${u}`);
  assert.deepEqual(screenTail(['⏺ Bash(ls)', '  ⎿  ok']), ['● Bash(ls)', '  └  ok']);
  // the streak clock starts when the queue went non-empty (the blocked statusSince), not at the first answer
  const ents = new Map<string, Entity>([['a', ent({ id: 'a', status: 'blocked', statusSince: 1_000 })]]);
  let t0 = 125_000;
  const toasts: [string, string | undefined][] = [];
  const s = createStreak({ store: { entities: ents, now: () => t0 }, bus: null, toast: (l, x, o) => toasts.push([x, o?.sub]), storage: null });
  s.check();
  s.answered(); must(ents, 'a').status = 'working';
  assert.deepEqual(s.check(), { answered: 1, ms: 124_000 });
  assert.equal(toasts[0][0], 'Inbox zero! 1 answered in 2:04');
  assert.ok(!/best today/.test(toasts[0][1] ?? ''), `a single answer has no best-today line: ${toasts[0][1]}`);
});

// ---- [UI fix r3] ----
test('fix r3: roster search ranks names first; fuzzy only over names / labels; best = top match', async () => {
  const { buildRoster, wordRank, parseQuery, matchEntity } = await import('./roster/model.ts');
  const mk = (id: string, name: string, extra: Parameters<typeof ent>[0] = {}) => ent({ id, name, kind: 'claude', status: 'working', cwd: '/home/u/proj', workspace: { id: 'w', label: 'ws' }, tab: { id: 't', label: 'tab' }, statusSince: 1, ...extra });
  const ents = [
    mk('s', 'sable', { lastPrompt: 'fix the flaky linter in fortran interop' }), // 'flint' as a subsequence of the prompt
    mk('c', 'claude', { cwd: '/home/u/flint-tools' }),                            // 'flint' as a substring of the cwd
    mk('f', 'flint'),
    mk('t', 'tinker', { activity: { detail: 'find lint issues' } }),
  ];
  const r = buildRoster(ents, { mode: 'directory', query: 'flint' });
  assert.equal(r.best, 'f', 'the exact name wins');
  const ids = r.list.filter((x) => x.type === 'row').map((x) => x.id);
  assert.ok(!ids.includes('s') && !ids.includes('t'), `no fuzzy hits in prompts / details: ${ids}`);
  assert.ok(ids.includes('c'), 'a plain substring of the cwd still lists (ranked lower)');
  assert.equal(wordRank(ents[2], 'fli'), 1, 'prefix');
  assert.equal(wordRank(ents[1], 'flint'), 5, 'other-field substring');
  assert.equal(wordRank(ents[3], 'tnkr'), 6, 'fuzzy over the name');
  assert.equal(wordRank(ents[0], 'flnt'), -1, 'never fuzzy over the prompt');
  assert.ok(matchEntity(ents[2], parseQuery('fl')) && !matchEntity(ents[2], parseQuery('ptsh')));
  assert.equal(buildRoster(ents, { mode: 'state', query: '' }).best, null, 'no query → no ranked pick');
  const src = (await import('node:fs')).readFileSync(new URL('./roster/view.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(query !== selQuery\)[\s\S]{0,120}fresh\.best/, 'the selection moves to the best match whenever the query changes');
  assert.match(src, /pick, then/, 'the footer says how G works while the search field has focus');
});

test('fix r3: inbox-zero clock survives the live order (flip before the answer lands)', async () => {
  const ents = new Map<string, Entity>([['a', ent({ id: 'a', status: 'blocked', statusSince: 1_000 })]]);
  let t = 16_000;
  const toasts: string[] = [];
  const s = createStreak({ store: { entities: ents, now: () => t }, bus: null, toast: (l, x) => toasts.push(x), storage: null });
  s.check();
  // inbox path: pend(+1) → status flip (entity event → check) → reply → answered → pend(-1)
  s.pend(1);
  t = 16_050; must(ents, 'a').status = 'working'; assert.equal(s.check(), null, 'held while in flight');
  t = 16_128; s.answered(); s.pend(-1);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(toasts, ['Inbox zero! 1 answered in 0:15']);
  // an answer without pend whose flip already cleared the queue keeps the queue's start
  const e2 = new Map<string, Entity>([['b', ent({ id: 'b', status: 'blocked', statusSince: 2_000 })]]);
  let t2 = 42_000; const toasts2: string[] = [];
  const s2 = createStreak({ store: { entities: e2, now: () => t2 }, bus: null, toast: (l, x) => toasts2.push(x), storage: null });
  s2.check(); must(e2, 'b').status = 'working'; s2.check();
  t2 = 42_200; s2.answered();
  await Promise.resolve();
  assert.deepEqual(toasts2, ['Inbox zero! 1 answered in 0:40']);
  const idx = (await import('node:fs')).readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(idx, /store\.now\(\) - \(streak\.firedAt/, 'firedAt (server time) compared with store.now()');
});

test('fix r3: emoji fallback — font stack + a 2-cell stand-in for pictographs no font renders', async () => {
  const { TERM_FONT } = await import('./styles.ts');
  assert.match(TERM_FONT, /Noto Color Emoji/);
  const { glyphMapper, EMOJI_STANDIN } = await import('./terminal/glyphs.ts');
  const enc = new TextEncoder(), dec = new TextDecoder();
  const m = glyphMapper(new Map(), (cp) => cp !== 0x1f44b);
  assert.equal(dec.decode(m(enc.encode('Hi! 👋 ok 🎉'))), 'Hi! ◆  ok 🎉');
  assert.equal(EMOJI_STANDIN.length, 4);
  const m2 = glyphMapper(new Map(), () => false);
  const b = enc.encode('x👋');
  const out = dec.decode(new Uint8Array([...m2(b.subarray(0, 3)), ...m2(b.subarray(3))]));
  assert.equal(out, 'x◆ ', 'a split sequence is carried over');
});

test('fix r3: per-agent maps stay ≤ the live agents under churn', async () => {
  const { pruneIfGrown, pruneToLive } = await import('./prune.ts');
  const { trailNote } = await import('../player/goThere.ts');
  const seen = new Map(), trail = new Map(), seats = new Map();
  let live: { id: string }[] = [];
  for (let round = 0; round < 200; round++) {
    live = [...live.filter(() => Math.random() > 0.3), { id: `a${round}` }, { id: `b${round}` }].slice(-8);
    for (const a of live) { seen.set(a.id, round); trailNote(trail, a.id, round, 0, round * 1000); seats.set(a.id, []); }
    pruneIfGrown(seen, live); pruneIfGrown(trail, live); pruneIfGrown(seats, live);
    assert.ok(seen.size <= live.length && trail.size <= live.length && seats.size <= live.length, `round ${round}`);
  }
  const m = new Map([['x', 1], ['y', 2]]);
  assert.equal(pruneToLive(m, ['y']), 1);
  const fs = await import('node:fs');
  const rd = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.match(rd('./chevrons.ts'), /pruneIfGrown\(seen, all\)/);
  assert.match(rd('./minimap.ts'), /pruneIfGrown\(trail/);
  assert.match(rd('./index.ts'), /seatMemo\.delete\(m\.id\)/);
});

test('fix r3: go-there occluders — rope across the face, a post dead centre, desk foreground clutter, mouth', async () => {
  const g = await import('./goto.ts');
  const R = { segs: [[-1, 1, 1, 1]], posts: [[0, 1]] };
  const face = { x: 0, y: 0.47, z: 0 };
  // lens 2.4 m out on +z: the rope run 1 m in front of the face at 0.82 m sits between the face's top and chin lines
  const po = g.propOcclusion(R, null, 0, { x: 0, y: 1.2, z: 2.4 }, face, 0);
  assert.equal(po.face, 1, 'post / rope across the face');
  const side = g.propOcclusion(R, null, 0, { x: 2.4, y: 1.2, z: 0 }, face, 0);
  assert.equal(side.face, 0, 'from the side neither crosses');
  const bo = g.bodyOcclusion({ x: 0, y: 1.2, z: 2.4 }, face, 0, [{ pos: { x: 0, y: 0, z: 1.2 }, arrived: true, intent: { slot: { pose: 'stand' } } }]);
  assert.ok(bo.face > 0.5, 'another Clawd in front of the face');
  const { layout } = await import('../world/layout/hq.ts');
  const desk = layout.furniture.find((f) => f.type === 'desk');
  assert.ok(desk);
  const pts = g.clutterPts(layout).filter((p) => p.desk === desk.id);
  const mon = pts[0];
  // a lens 0.6 m behind that monitor looking over it: a slab in the lower frame
  const lens = { x: mon.x, y: 1.2, z: mon.z + 0.6, yaw: 0, pitch: -0.2 };
  assert.ok(g.fgClutter(pts, lens) > 0.5, 'monitor / lamp in the near foreground');
  assert.equal(g.fgClutter(pts, { ...lens, z: mon.z + 3 }), 0, 'far away: scenery');
  assert.equal(g.fgClutter(g.nearClutter(layout, { x: mon.x, z: mon.z }, desk.id).filter((p) => p.desk === desk.id), lens), 0, 'the own desk never counts');
  assert.ok(g.WALKUP.mouthHidden > 0 && g.WALKUP.fgW > 0 && g.OCCL.propFace > g.OCCL.propBody);
});

// [UI kit migration, dialogs] the palette's butter match marks: substring runs, else each word's subsequence
test('palette matchRanges: substring run, subsequence fallback, merged', async () => {
  const { matchRanges } = await import('./cmdk.ts');
  assert.deepEqual(matchRanges('flint', 'fl'), [[0, 2]]);
  assert.deepEqual(matchRanges('Terminal font larger', 'fl'), [[9, 10], [14, 15]]);
  assert.deepEqual(matchRanges('Settings', 'set'), [[0, 3]]);
  assert.deepEqual(matchRanges('claude · 2', 'cl 2'), [[0, 2], [9, 10]]);
  assert.deepEqual(matchRanges('flint', 'zz'), []);
  assert.deepEqual(matchRanges('abc', ''), []);
});
