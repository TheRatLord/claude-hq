// Actions._answer post-send re-check: polls ~2 s; only an identical prompt with an unmoved cursor → not_accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Actions, ANSWER_RECHECK_MS } from './actions.ts';
import type { ActionClient, ActionModel, ActionResult } from './actions.ts';
import { parsePrompt } from './blocked.ts';
import type { Base } from './model.ts';
import { TRUST_PROMPT } from '../test/mockHerdr.ts';
import { DEFAULT_SETTINGS, FIELD_DEFAULTS } from '../../shared/protocol.ts';
import type { ClientMsg, Entity, Prompt, Workspace } from '../../shared/protocol.ts';
import type { Clock } from '../interfaces.ts';
import { errCode, errMessage } from '../../shared/guards.ts';

const ID = 'w2:p1';
const SEQ = 4;
const MOVED = TRUST_PROMPT.replace(' ❯ No, exit', '   No, exit').replace('   Yes, I trust', ' ❯ Yes, I trust');

/** Virtual clock: every timer fires on the next macrotask with time jumped forward (no real waiting). Handles are 0: never cleared. */
function autoClock(): Clock & { t: number } {
  const c: Clock & { t: number } = {
    t: 0,
    now: () => c.t,
    timescale: 1,
    setTimeout: (fn, ms = 0, ...args) => { setImmediate(() => { c.t += ms; fn(...args); }); return 0; },
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
  };
  return c;
}

/** A complete base entity with `patch` applied. */
function makeBase(patch: Partial<Base> = {}): Base {
  return {
    id: ID, terminalId: null, kind: 'claude', name: 'agent', seedKey: 'agent', status: 'blocked', statusSince: 0, statusSinceApprox: false,
    identity: { terminalId: null, agentSession: null, place: '' }, stateSeq: null, layoutRect: null,
    workspace: { id: 'w2', label: 'ws', number: 2, colorIndex: 0, cycle: 0, slot: 0, status: 'blocked' },
    tab: { id: 'w2:t1', label: 't', number: 1, index: 0 }, paneIndex: 0, cwd: '/', project: 'p', repo: null, focused: false, baseTitle: null,
    ...patch,
  };
}
const makeEntity = (): Entity => ({ ...makeBase(), ...FIELD_DEFAULTS, subagents: [] });
const makeWorkspace = (id: string): Workspace => ({ id, label: id, number: 1, colorIndex: 0, cycle: 0, slot: 0, status: 'idle', focused: false, paneCount: 0, tabs: [] });

/** The slice of WorldModel that Actions reads; the rest is inert. */
function fakeModel(m: { get: ActionModel['get']; base: ActionModel['base']; workspaces?: Workspace[] }): ActionModel {
  return { workspaces: [], worldMsg: () => ({ t: 'world', entities: [], workspaces: [], focusedPaneId: null }), event() {}, ...m };
}

/** What a rejected action carries (`{code, extra}`). */
interface ActionErr extends Error { code?: string; extra?: { prompt?: Prompt; busy?: boolean } }
const asErr = (e: unknown): ActionErr => {
  assert.ok(e instanceof Error, 'an Error was thrown');
  return e;
};
interface Outcome { r?: ActionResult; err?: ActionErr; dt: number }

interface View { text?: string; gone?: boolean; base?: Partial<Base> }

/**
 * Fake herdr source + model for one blocked pane. `after(dt)` → what the pane looks like `dt` ms after send_keys:
 * `{text?, gone?, base?}` (base patches the model's base, e.g. kind → shell).
 */
function rig(after: (dt: number) => View | undefined) {
  const clock = autoClock();
  let sentAt: number | null = null;
  const base0 = { id: ID, kind: 'claude', status: 'blocked', stateSeq: SEQ } as const;
  const view = (): View => (sentAt === null ? {} : after(clock.now() - sentAt) ?? {});
  const source = {
    sent: [] as unknown[],
    async request(method: string, params: Record<string, unknown> = {}) {
      if (method === 'pane.send_keys') { this.sent.push(params.keys); sentAt = clock.now(); return {}; }
      if (method === 'pane.read') {
        const v = view();
        if (v.gone) throw Object.assign(new Error('pane not found'), { code: 'pane_not_found' });
        return { read: { text: v.text ?? TRUST_PROMPT } };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const model = fakeModel({
    get: (id) => (id === ID && !view().gone ? makeEntity() : null),
    base: (id) => (id === ID && !view().gone ? makeBase({ ...base0, ...view().base }) : null),
  });
  const refreshed: string[] = [];
  const actions = new Actions({ source, model, clock, session: 'hqtest', demo: false, settings: { ...DEFAULT_SETTINGS },
    blocked: { refresh: async (id) => { refreshed.push(id); } } });
  const parsed = parsePrompt(TRUST_PROMPT, SEQ);
  assert.ok(parsed);
  const hash = parsed.hash;
  const answer = (key: string): Promise<Outcome> => actions._answer({ t: 'agent.answer', id: ID, key, promptHash: hash }).then(
    (r) => ({ r, dt: clock.now() - (sentAt ?? 0) }), (err: unknown) => ({ err: asErr(err), dt: clock.now() - (sentAt ?? 0) }));
  return { answer, source, refreshed };
}

test('answer that exits the agent 900 ms after send_keys (screen still shows the prompt until then) → ok', async () => {
  const R = rig((dt) => (dt >= 900 ? { text: 'david@box:~/proj$ ', base: { kind: 'shell', status: 'unknown', stateSeq: null } } : {}));
  const { r, err, dt } = await R.answer('1');
  assert.equal(err, undefined, err?.message);
  assert.deepEqual(r?.keys, ['Enter']);
  assert.deepEqual(R.source.sent, [['Enter']]);
  assert.ok(dt >= 900 && dt < 1200, `resolved at ${dt} ms`);
  assert.deepEqual(R.refreshed, [ID]);
});

test('answer: screen changes first (herdr still blocked@same seq) → ok; pane gone → ok; kind → shell only → ok', async () => {
  let o = await rig((dt) => (dt >= 900 ? { text: 'david@box:~/proj$ ' } : {})).answer('1');
  assert.ok(o.r && o.dt >= 900 && o.dt < 1200, `screen change: ${o.err?.message} at ${o.dt}`);
  o = await rig((dt) => (dt >= 900 ? { gone: true } : {})).answer('1');
  assert.ok(o.r, `pane gone: ${o.err?.message}`);
  o = await rig((dt) => (dt >= 600 ? { base: { kind: 'shell' } } : {})).answer('1');
  assert.ok(o.r && o.dt < 900, `kind shell: ${o.err?.message} at ${o.dt}`);
  o = await rig((dt) => (dt >= 300 ? { base: { stateSeq: SEQ + 1, status: 'working' } } : {})).answer('2');
  assert.ok(o.r, `status/seq change: ${o.err?.message}`);
});

test('answer: cursor moved but prompt still up (Down took, Enter lost) counts as taken', async () => {
  const o = await rig((dt) => (dt >= 200 ? { text: MOVED } : {})).answer('2');
  assert.ok(o.r, o.err?.message);
  assert.deepEqual(o.r?.keys, ['Down', 'Enter']);
});

test('answer: identical prompt + unmoved cursor for the whole window → not_accepted after ~2 s', async () => {
  const R = rig(() => ({}));
  const { err, dt } = await R.answer('2');
  assert.equal(err?.code, 'not_accepted');
  assert.equal(err?.extra?.prompt?.hash, parsePrompt(TRUST_PROMPT, SEQ)?.hash);
  assert.ok(dt >= ANSWER_RECHECK_MS && dt < ANSWER_RECHECK_MS + 400, `gave up at ${dt} ms`);
  assert.deepEqual(R.refreshed, [ID], 'blocked enricher refreshed even on failure');
});

test('answer: a second concurrent answer for the same pane is refused before reading; send_keys exactly once', async () => {
  const R = rig((dt) => (dt >= 700 ? { text: 'david@box:~/proj$ ', base: { kind: 'shell', status: 'unknown', stateSeq: null } } : {}));
  const [a, b] = await Promise.all([R.answer('1'), R.answer('1')]);
  assert.ok(a.r, `first: ${a.err?.message}`);
  assert.equal(b.err?.code, 'prompt_changed');
  assert.equal(b.err?.extra?.busy, true);
  assert.deepEqual(R.source.sent, [['Enter']], 'send_keys called exactly once');
  // Once the first resolved the guard is released: a late retry re-reads (now a shell) → prompt_changed, nothing sent.
  const c = await R.answer('1');
  assert.equal(c.err?.code, 'prompt_changed');
  assert.equal(c.err?.extra?.busy, undefined);
  assert.equal(R.source.sent.length, 1);
});

test('answer: guard released after a failure (not_accepted) so the user can retry', async () => {
  const R = rig(() => ({}));
  const first = R.answer('2');
  const dup = await R.answer('2');
  assert.equal(dup.err?.code, 'prompt_changed');
  assert.equal((await first).err?.code, 'not_accepted');
  const again = await R.answer('2');
  assert.equal(again.err?.code, 'not_accepted');
  assert.equal(R.source.sent.length, 2);
});

// ---- spawn: shell → new tab's pane; claude + first prompt → wait until interactive-ready, prompt once ----

/** Fake herdr for spawn: agent.get reports `states[i]` on the i-th poll (last one repeats). */
function spawnRig({ states = [{ agent_status: 'idle', interactive_ready: true }], session = 'hqtest', isDefault, getErr, workspaces, busy = 0 }: {
  states?: Record<string, unknown>[]; session?: string; isDefault?: boolean; getErr?: string; workspaces?: Workspace[]; busy?: number;
} = {}) {
  let busyStarts = busy;
  const clock = autoClock();
  const calls: [string, Record<string, unknown>][] = [];
  let polls = 0;
  const source = {
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push([method, params]);
      switch (method) {
        case 'tab.create': return { root_pane: { pane_id: `${params.workspace_id}:p9` } };
        case 'workspace.create': return { root_pane: { pane_id: 'w7:p1' } };
        case 'agent.start':
          if (busyStarts > 0) { busyStarts--; throw Object.assign(new Error('not an available shell'), { code: 'agent_pane_busy' }); }
          return { agent: { pane_id: params.pane_id, launch_pending: true } };
        case 'pane.close': return {};
        case 'agent.get': {
          if (getErr) throw Object.assign(new Error(getErr), { code: getErr });
          const st = states[Math.min(polls++, states.length - 1)];
          return { agent: { pane_id: params.target, agent: 'claude', ...st } };
        }
        case 'agent.prompt': return { type: 'ok' };
        default: throw new Error(`unexpected ${method}`);
      }
    },
  };
  const bases = new Map<string, Base>();
  const model = fakeModel({ workspaces: workspaces ?? [makeWorkspace('w1')], get: () => null, base: (id) => bases.get(id) ?? null });
  const audited: unknown[] = [];
  const actions = new Actions({ source, model, clock, session, isDefault, demo: false, settings: { ...DEFAULT_SETTINGS },
    audit: { record: (e) => { audited.push(e); } } });
  const client: ActionClient = { cid: 'c1', watch: [], sendJson() {} };
  return { actions, calls, audited, client, clock, bases, methods: () => calls.map((c) => c[0]) };
}

test('spawn shell: a new tab in the given workspace → its root pane id; no agent.start, no prompt', async () => {
  const R = spawnRig();
  const r = await R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', label: 'dev' });
  assert.deepEqual(r, { paneId: 'w1:p9', prompted: false });
  assert.deepEqual(R.methods(), ['tab.create']);
  assert.equal(R.calls[0][1].focus, false);
  // no workspace → a new workspace
  const r2 = await R.actions.handle(R.client, { t: 'spawn' });
  assert.equal(r2.paneId, 'w7:p1');
  assert.deepEqual(R.methods(), ['tab.create', 'workspace.create']);
  // unknown workspace → refused before any herdr call
  await assert.rejects(R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w99' }), { code: 'unknown_entity' });
  assert.equal(R.calls.length, 2);
});

test('spawn claude with a first prompt: waits for interactive_ready + idle, prompts exactly once, audits without text', async () => {
  const R = spawnRig({ states: [{ agent_status: 'unknown', launch_pending: true }, { agent_status: 'working', interactive_ready: false },
    { agent_status: 'idle', interactive_ready: true }] });
  const r = await R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', kind: 'claude', name: 'newbie', prompt: 'say hi' });
  assert.deepEqual(r, { paneId: 'w1:p9', prompted: true });
  assert.deepEqual(R.methods(), ['tab.create', 'agent.start', 'agent.get', 'agent.get', 'agent.get', 'agent.prompt']);
  assert.deepEqual(R.calls.at(-1)?.[1], { target: 'w1:p9', text: 'say hi' });
  assert.equal(R.calls[1][1].name, 'newbie');
  assert.deepEqual(R.audited, [{ cid: 'c1', action: 'prompt', paneId: 'w1:p9', ok: true, error: undefined }]);
  assert.ok(!JSON.stringify(R.audited).includes('say hi'), 'the prompt text is never audited');
});

test('spawn claude: startup dialog (blocked) → prompted:false agent_blocked, nothing prompted; timeout → not_ready', async () => {
  let R = spawnRig({ states: [{ agent_status: 'blocked', interactive_ready: null }] });
  let r = await R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', kind: 'claude', prompt: 'say hi' });
  assert.deepEqual(r, { paneId: 'w1:p9', prompted: false, why: 'agent_blocked' });
  assert.ok(!R.methods().includes('agent.prompt'));
  assert.deepEqual(R.audited.map((a) => (a as { ok: boolean }).ok), [false]);
  R = spawnRig({ states: [{ agent_status: 'working', interactive_ready: false }] });
  r = await R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', kind: 'claude', prompt: 'say hi' });
  assert.equal(r.why, 'not_ready');
  assert.ok(R.clock.now() >= 20_000 && R.clock.now() < 21_000, `gave up at ${R.clock.now()} ms`);
  assert.ok(!R.methods().includes('agent.prompt'));
  // without a prompt nothing waits
  R = spawnRig();
  r = await R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', kind: 'codex' });
  assert.deepEqual(r, { paneId: 'w1:p9', prompted: false });
  assert.deepEqual(R.methods(), ['tab.create', 'agent.start']);
});

test('spawn claude: a source without agent.get (demo) falls back to the WorldModel base', async () => {
  const R = spawnRig({ getErr: 'not_implemented' });
  R.clock.setTimeout(() => R.bases.set('w1:p9', makeBase({ id: 'w1:p9', kind: 'claude', status: 'idle' })), 1000);
  const r = await R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', kind: 'claude', prompt: 'hi' });
  assert.equal(r.prompted, true);
  assert.equal(R.methods().filter((m) => m === 'agent.get').length, 1, 'agent.get tried once, then the model');
});

test('spawn / pane.close in the default session: refused with mutations_disabled + an explanation; no herdr call', async () => {
  const R = spawnRig({ session: 'default' });
  const msgs: ClientMsg[] = [{ t: 'spawn', workspaceId: 'w1', kind: 'claude', prompt: 'say hi' }, { t: 'spawn' }, { t: 'pane.close', id: 'w1:p1' }];
  for (const msg of msgs) {
    await assert.rejects(R.actions.handle(R.client, msg), (e: unknown) => errCode(e) === 'mutations_disabled' && /default herdr session/.test(errMessage(e)));
  }
  // a named session that resolves to the default socket is the default session too
  const S = spawnRig({ session: 'mine', isDefault: true });
  await assert.rejects(S.actions.handle(S.client, { t: 'spawn' }), { code: 'mutations_disabled' });
  assert.equal(R.calls.length + S.calls.length, 0);
});

test('spawn: prompt without kind is a bad message', async () => {
  const R = spawnRig();
  await assert.rejects(R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', prompt: 'x' }), { code: 'bad_message' });
  assert.equal(R.calls.length, 0);
});

test('spawn claude: a new shell that is not ready yet (agent_pane_busy) is retried; a pane that never gets ready is closed', async () => {
  let R = spawnRig({ busy: 3 });
  const r = await R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', kind: 'claude', prompt: 'hi' });
  assert.equal(r.prompted, true);
  assert.equal(R.methods().filter((m) => m === 'agent.start').length, 4);
  R = spawnRig({ busy: 1000 });
  await assert.rejects(R.actions.handle(R.client, { t: 'spawn', workspaceId: 'w1', kind: 'claude' }), { code: 'agent_pane_busy' });
  assert.deepEqual(R.calls.at(-1), ['pane.close', { pane_id: 'w1:p9' }], 'the half-made pane is closed again');
});
