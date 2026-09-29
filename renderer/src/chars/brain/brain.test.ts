import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, idleSegment } from './brain.ts';
import { createDirector } from './director.ts';
import { TUNING as T } from './tuning.ts';
import { testLayout, testNav, ent, must } from './testkit.ts';
import type { Brain, BrainEnv, Intent } from './brain.ts';
import type { MetricsActor } from './metrics.ts';
import type { Entity } from '../../../../shared/protocol.ts';

const NOW = 10 * 3600_000;

function rig(entities: Entity[]) {
  const d = createDirector(testLayout(), testNav());
  const map = new Map(entities.map((e): [string, Entity] => [e.id, e]));
  d.update(map, NOW);
  return { d, map };
}
/** Minimal env: settled at `settledAt`, nobody around. */
function env(t: number, settledAt: string | null = null, extra: Partial<BrainEnv> = {}): BrainEnv {
  return {
    t, self: { pos: { x: 0, y: 0, z: 0 }, yaw: 0, settledAt, moving: false }, player: null, neighbours: [],
    partner: () => null, invite: () => false, ...extra,
  };
}

test('every status maps to a visibly distinct intent (M1 acceptance)', () => {
  const es = [
    ent({ i: 1, status: 'working', statusSince: NOW - 60_000, activity: { tool: 'Read', cls: 'read', detail: 'a.js', since: NOW - 1000 } }),
    ent({ i: 2, status: 'blocked', statusSince: NOW - 3_000, prompt: { question: 'Allow edit?' } }),
    ent({ i: 3, status: 'blocked', statusSince: NOW - 60_000, prompt: { question: 'Run npm?' } }),
    ent({ i: 4, status: 'done', statusSince: NOW - 60_000 }),
    ent({ i: 5, status: 'idle', statusSince: NOW - 30_000 }),
    ent({ i: 6, status: 'unknown', statusSince: NOW - 30_000 }),
    ent({ i: 7, kind: 'shell', status: 'unknown', process: { name: 'vim', argv: 'vim a', activity: 'edit' } }),
    ent({ i: 8, status: 'idle', statusSince: NOW - 20 * 60_000 }),
  ];
  const { d, map } = rig(es);
  const sig: Record<string, string> = {};
  for (const e of es) {
    const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
    const home = must(d.slotFor(e.id));
    const i = b.update(must(map.get(e.id)), NOW, env(0, home.id));
    sig[e.id] = `${i.slot?.tag}|${i.activity}|${i.stand}|${i.phase}`;
  }
  const v = Object.values(sig);
  assert.equal(new Set(v).size, v.length, JSON.stringify(sig, null, 1));
  assert.match(sig['d1:p1'], /^desk\|readBook\|false/);
  assert.match(sig['d1:p2'], /^desk\|waveBlocked\|true/);
  assert.match(sig['d1:p3'], /^queue\|(queueHandUp|waveBlocked)/);
  assert.match(sig['d1:p5'], /^desk\|lounge\|false\|idleDesk/); // leaning back, hands behind the head
  assert.match(sig['d1:p4'], /^sofa\|lounge/);
  assert.match(sig['d1:p6'], /confused/);
  assert.match(sig['d1:p7'], /^desk\|knit/);
  assert.match(sig['d1:p8'], /nap/);
});

test('cold start: pre-existing states cause no reactions', () => {
  const e = ent({ i: 1, status: 'done', statusSince: NOW - 2000 });
  const { d, map } = rig([e]);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  b.update(must(map.get(e.id)), NOW, env(0));
  assert.equal(b.pullReaction(), null);
});

test('hysteresis: < 1.5 s flicker is ignored; → working while away is immediate with a work call', () => {
  const e = ent({ i: 1, status: 'idle', statusSince: NOW - 5000 });
  const { d } = rig([e]);
  const home = must(d.slotFor(e.id));
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  b.update(e, NOW, env(0, home.id));
  const blk: Entity = { ...e, status: 'blocked', statusSince: NOW };
  b.update(blk, NOW + 100, env(0.1, home.id));
  b.update(blk, NOW + 1000, env(1.0, home.id));
  assert.equal(b.state.status, 'idle');
  b.update(e, NOW + 1200, env(1.2, home.id)); // flicker back
  b.update(blk, NOW + 1300, env(1.3, home.id));
  b.update(blk, NOW + 2900, env(2.9, home.id));
  assert.equal(b.state.status, 'blocked');
  assert.equal(b.pullReaction(), 'startle');
  // away from the desk → working at once
  const b2 = createBrain('x', { director: d, seedKey: 'x' });
  b2.update(e, NOW, env(0, 'spot:window:1'));
  const i = b2.update({ ...e, status: 'working', statusSince: NOW }, NOW + 16, env(0.016, 'spot:window:1'));
  assert.equal(b2.state.status, 'working');
  assert.equal(b2.pullReaction(), 'workCall');
  assert.equal(i.speed, T.workCallSpeed);
});

test('an event reaction suppresses the duplicate transition reaction', () => {
  const e = ent({ i: 1, status: 'working', statusSince: NOW - 5000 });
  const { d } = rig([e]);
  const home = must(d.slotFor(e.id));
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  b.update(e, NOW, env(0, home.id));
  assert.equal(b.onEvent({ id: e.id, kind: 'finished' }), 'victory');
  const dn: Entity = { ...e, status: 'done', statusSince: NOW };
  b.update(dn, NOW + 100, env(0.1, home.id));
  b.update(dn, NOW + 1700, env(1.7, home.id));
  assert.equal(b.state.status, 'done');
  assert.equal(b.pullReaction(), null);
});

test('idle ladder schedule is deterministic and follows §6.4.1 bands', () => {
  const cfg = { seed: 1234, tags: ['window', 'sofa', 'chat', 'stroll'], fav: 'window', chatty: 1 };
  const a = {}, b = {};
  for (let age = 0; age < 8 * 3600_000; age += 7_000) {
    const s1 = idleSegment(cfg, a, age);
    const k1 = `${s1.kind}|${s1.tag}|${s1.idx}`;
    const s2 = idleSegment(cfg, b, age);
    assert.equal(`${s2.kind}|${s2.tag}|${s2.idx}`, k1);
    if (age < T.idleDeskMs) assert.equal(s1.kind, 'desk');
    else if (age < T.idleChillMs) assert.equal(s1.kind, 'chill');
    else assert.ok(s1.kind === 'nap' || s1.kind === 'hobby');
  }
  // Rewinds (a fresh window computes the same segment for the same age).
  const c = {};
  assert.equal(idleSegment(cfg, c, 3 * 3600_000).idx, idleSegment(cfg, a, 3 * 3600_000).idx);
});

test('dust follows idle age, capped at 1 while statusSinceApprox', () => {
  const e = ent({ i: 1, status: 'idle', statusSince: NOW - 4 * 3600_000 });
  const { d } = rig([e]);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  assert.equal(b.update(e, NOW, env(0)).dust, 2);
  const b2 = createBrain('y', { director: d, seedKey: 'y' });
  assert.equal(b2.update({ ...e, statusSinceApprox: true }, NOW, env(0)).dust, 1);
});

test('liveliness: seated idle actors fidget, glance and swivel to the player', () => {
  const e = ent({ i: 1, status: 'idle', statusSince: NOW - 10_000 });
  const { d } = rig([e]);
  const home = must(d.slotFor(e.id));
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const seen = new Set<string | null>();
  for (let t = 0; t < 60; t += 0.1) seen.add(b.update(e, NOW + t * 1000, env(t, home.id)).activity);
  assert.ok([...seen].some((a) => a?.startsWith('fidget:')), [...seen].join());
  assert.ok(seen.has('lounge'), 'idle at the desk leans back (hands behind the head), not the upright sitIdle');
  const pl = { pos: { x: 1, y: 0, z: 0 }, dist: 1, inFront: true };
  const i = b.update(e, NOW + 61_000, env(61, home.id, { player: pl }));
  assert.ok(i.look && i.swivel);
});

test('queue actors stand 3/4 toward the spawn view, hand up in every frame, bell tap never happy', () => {
  const e = ent({ i: 3, status: 'blocked', statusSince: NOW - 60_000, prompt: { question: 'Run npm?' } });
  const { d } = rig([e]);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const pin = must(d.pinFor(e.id));
  const acts = new Set(), reacts = new Set();
  let looks = 0, turn = 0;
  for (let t = 0; t < 45; t += 0.1) {
    const i = b.update(e, NOW + t * 1000, env(t, pin.id));
    acts.add(i.activity); turn = i.turn;
    if (i.look) looks++;
    assert.ok(i.face === 'worried' || i.face === 'determined');
    for (let r = b.pullReaction(); r; r = b.pullReaction()) reacts.add(r);
  }
  const facing = pin.yaw + turn, toSpawn = d.faceSpawn(pin.pos);
  const off = Math.abs(Math.atan2(Math.sin(facing - toSpawn), Math.cos(facing - toSpawn)));
  assert.ok(off < Math.abs(Math.atan2(Math.sin(pin.yaw - toSpawn), Math.cos(pin.yaw - toSpawn))) * 0.6, `turned toward the spawn (${off})`);
  // ART §5.1: the blocked silhouette (arm straight up) in every frame: only the raised-arm loops, never queueWait.
  assert.deepEqual([...acts].sort(), ['queueHandUp', 'waveBlocked'], [...acts].join());
  assert.ok(looks > 20, 'periodic look-back over the shoulder');
  // §6.7 one visual = one meaning: the 20 s bell tap is `bellTap` (keeps the blocked face), never `hop` (^_^).
  assert.ok(reacts.has('bellTap') && !reacts.has('hop'), [...reacts].join());
});

test('hysteresis: working → idle holds the working activity, face and ring until it commits (no pop)', () => {
  // (blocked / done play their beat at once: see the blocked / done tests above, [BRN fix r2])
  const w = ent({ i: 40, status: 'working', statusSince: NOW - 60_000, activity: { tool: 'Edit', cls: 'edit', detail: 'a.js', since: NOW - 2000 } });
  const { d } = rig([w]);
  const b = createBrain(w.id, { director: d, seedKey: w.seedKey });
  const home = must(d.slotFor(w.id));
  const first = b.update(w, NOW, env(0, home.id));
  const act0 = first.activity, face0 = first.face;
  assert.equal(act0, 'pencilEdit');
  const idl: Entity = { ...w, status: 'idle', statusSince: NOW + 100, activity: null };
  for (let t = 0.1; t < T.hysteresisS - 0.05; t += 0.1) {
    const i = b.update(idl, NOW + t * 1000, env(t, home.id));
    assert.equal(i.activity, act0, `t=${t.toFixed(1)}`);
    assert.equal(i.face, face0);
    assert.equal(must(i.ring).status, 'working');
    assert.equal(b.pullReaction(), null);
  }
  const i = b.update(idl, NOW + 1600, env(1.6, home.id));
  assert.notEqual(i.activity, act0);
  assert.equal(must(i.ring).status, 'idle');
});

test('excuse me: a walker passing the player looks at them', () => {
  const e = ent({ i: 41, status: 'idle', statusSince: NOW - 30_000 });
  const { d } = rig([e]);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const pl = { pos: { x: 0.5, y: 0, z: 0 }, dist: 0.6, inFront: false };
  const i = b.update(e, NOW, env(0, null, { self: { pos: { x: 0, y: 0, z: 0 }, yaw: 0, settledAt: null, moving: true }, player: pl }));
  assert.ok(i.look && Math.abs(i.look.x - 0.5) < 1e-9, 'looks at the player');
  assert.equal(i.face, 'happy');
});

test('done agents beyond the sofa seats stand around the lounge, never at the desk', () => {
  const es = [0, 1, 2, 3, 4].map((k) => ent({ i: 20 + k, status: 'done', statusSince: NOW - 60_000 + k }));
  const { d, map } = rig(es);
  const tags = es.map((e) => {
    const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
    const i = b.update(must(map.get(e.id)), NOW, env(0));
    return `${i.slot?.tag}|${i.activity}`;
  });
  assert.deepEqual(tags.slice(0, 3), ['sofa|lounge', 'sofa|lounge', 'sofa|lounge']);
  assert.ok(tags.slice(3).every((t) => t === 'loungeStand|standLounge'), tags.join());
});

test('blocked: the beat plays at once (startle, surprised face, hands off the keys, head snap), the chair after the hysteresis', () => {
  // [BRN fix r2] anim review r2: the FX switched within 100 ms but the Clawd kept pencil-editing, focused, for 1.4 s
  const e = ent({ i: 1, status: 'working', statusSince: NOW - 60_000, activity: { tool: 'Edit', cls: 'edit', detail: '', since: NOW - 1000 } });
  const { d } = rig([e]);
  const home = must(d.slotFor(e.id));
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const pl = { player: { pos: { x: home.pos.x + 2, y: 0, z: home.pos.z + 2 }, dist: 2.8, inFront: true } };
  b.update(e, NOW, env(0, home.id, pl));
  const blocked = ent({ ...e, status: 'blocked', statusSince: NOW + 1000, prompt: { question: 'ok?' } });
  const ev = { id: e.id, kind: 'blocked' };
  assert.equal(b.deferEvent(ev), true, 'the event arrives a beat before the entity: held');
  let i = b.update(blocked, NOW + 1000, env(1, home.id, pl));
  assert.equal(b.pullDueEvent(), ev, 'the startle plays on the first frame the status shows');
  assert.equal(b.pullReaction(), null, 'no second, transition startle');
  assert.equal(i.face, 'surprised');
  assert.notEqual(i.activity, 'pencilEdit', 'hands off the keyboard');
  assert.equal(i.bubble?.icon, '!');
  assert.equal(i.bubble?.detail, '0:00', `[BRN fix r3] the first blocked frame shows the blocked clock, not the 1:00 of work (${i.bubble?.detail})`);
  assert.equal(i.ring?.status, 'blocked');
  assert.equal(i.lamp, 'blocked');
  assert.ok(i.look && Math.abs(i.look.x - pl.player.pos.x) < 1e-6, 'head snaps to the player');
  assert.equal(i.stand, false, 're-target (the chair) waits for the hysteresis');
  let t = 1.1;
  for (; t < 2.4; t += 0.1) {
    i = b.update(blocked, NOW + t * 1000, env(t, home.id, pl));
    assert.equal(i.face, 'surprised'); assert.equal(i.stand, false);
    assert.equal(i.bubble?.detail, `0:0${Math.floor(t - 1 + 1e-9)}`, `pending-window clock at ${t.toFixed(1)} s`); // ≤ 1 s throughout
  }
  for (; t < 3; t += 0.1) { i = b.update(blocked, NOW + t * 1000, env(t, home.id, pl)); if (i.stand) break; }
  assert.equal(i.activity, 'waveBlocked');
  assert.equal(b.pullDueEvent(), null);
  assert.equal(b.pullReaction(), null, 'no startle on the commit either');
  // the entity first, the event a moment later: one startle only
  const b3 = createBrain('y', { director: d, seedKey: 'y' });
  b3.update(e, NOW, env(0, home.id));
  b3.update(blocked, NOW + 1000, env(1, home.id));
  assert.equal(b3.pullReaction(), 'startle');
  assert.equal(b3.deferEvent(ev), true, 'swallowed');
  for (let k = 11; k < 30; k++) b3.update(blocked, NOW + k * 100, env(k / 10, home.id));
  assert.equal(b3.pullDueEvent(), null);
  assert.equal(b3.pullReaction(), null);
  // a flap back inside the window: a false alarm, then back to the work
  const b2 = createBrain('z', { director: d, seedKey: 'z' });
  b2.update(e, NOW, env(0, home.id));
  b2.update(blocked, NOW + 1000, env(1, home.id));
  i = b2.update(e, NOW + 1500, env(1.5, home.id));
  assert.equal(i.activity, 'pencilEdit');
  assert.equal(i.ring?.status, 'working');
  for (let k = 2; k < 5; k++) b2.update(e, NOW + k * 1000, env(k, home.id));
  assert.equal(b2.pullDueEvent(), null);
});

test('done: victory at once, the happy face through the hysteresis, no second victory on commit', () => {
  const e = ent({ i: 2, status: 'working', statusSince: NOW - 60_000, activity: { tool: 'Edit', cls: 'edit', detail: '', since: NOW - 1000 } });
  const { d } = rig([e]);
  const home = must(d.slotFor(e.id));
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  b.update(e, NOW, env(0, home.id));
  const dn: Entity = { ...e, status: 'done', statusSince: NOW + 1000, activity: null };
  let i = b.update(dn, NOW + 1000, env(1, home.id));
  assert.equal(b.pullReaction(), 'victory');
  assert.equal(i.face, 'happy');
  assert.notEqual(i.activity, 'pencilEdit');
  for (let t = 1.1; t < 3.5; t += 0.1) { i = b.update(dn, NOW + t * 1000, env(t, home.id)); assert.equal(i.face, 'happy'); }
  assert.equal(b.pullReaction(), null);
  assert.equal(i.phase, 'victory');
});

test('done → Pit walk: a fast happy skip with free arms; working scurries alone carry the laptop (review r3)', () => {
  const e = ent({ i: 30, status: 'done', statusSince: NOW - 10_000 });
  const w = ent({ i: 31, status: 'working', statusSince: NOW - 10_000, activity: { tool: 'Edit', cls: 'edit', detail: '', since: NOW } });
  const idl = ent({ i: 32, status: 'idle', statusSince: NOW - 5 * 60_000 });
  const { d, map } = rig([e, w, idl]);
  const walking = (t: number) => env(t, null, { self: { pos: { x: 0, y: 0, z: 0 }, yaw: 0, settledAt: null, moving: true } });
  const bd = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const i = bd.update(must(map.get(e.id)), NOW, walking(0));
  assert.equal(i.walkActivity, null, 'no typing arms on the way to the sofa');
  assert.equal(i.gait, 'skip');
  assert.equal(i.face, 'happy');
  assert.ok(i.speed >= 1.4, `done walk ${i.speed} m/s`);
  const bi = createBrain(idl.id, { director: d, seedKey: idl.seedKey });
  assert.equal(bi.update(must(map.get(idl.id)), NOW, walking(0)).walkActivity, null);
  const bw = createBrain(w.id, { director: d, seedKey: w.seedKey });
  assert.equal(bw.update(must(map.get(w.id)), NOW, walking(0)).walkActivity, 'walkType');
});

test('work call from the Pit: jolt, then a determined face for the whole scurry (never the done smile)', () => {
  const e = ent({ i: 33, status: 'done', statusSince: NOW - 60_000 });
  const { d } = rig([e]);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const sofa = must(d.pinFor(e.id));
  b.update(e, NOW, env(0, sofa.id));
  // a neighbour's cheer just before the call (social happy face window)
  b.onSocial('finished', { id: 'x', pos: { x: 1, y: 0, z: 1 } }, 0.1);
  const wk: Entity = { ...e, status: 'working', statusSince: NOW + 200, activity: { tool: 'Read', cls: 'read', detail: '', since: NOW + 200 } };
  const moving = (t: number) => env(t, null, { self: { pos: { x: 0, y: 0, z: 0 }, yaw: 0, settledAt: null, moving: true } });
  let i = b.update(wk, NOW + 200, env(0.2, sofa.id));
  assert.equal(b.pullReaction(), 'workCall');
  for (let t = 0.3; t < 4; t += 0.2) {
    i = b.update(wk, NOW + t * 1000, moving(t));
    assert.equal(i.face, 'determined', `t=${t.toFixed(1)}`);
    assert.equal(i.speed, T.workCallSpeed);
  }
});

// [BRN fix m2-r3] the §9.1 metrics: occupancy counts settled agents only; a 2 s fidget is not a new activity (P3)
test('metrics: settled occupancy and the P3 stillness run (blips < 5 s do not reset it)', async () => {
  const { createMetrics } = await import('./metrics.ts');
  const m = createMetrics({ zoneAt: () => 'LIB' });
  const slot = { id: 'slot:x' };
  const a: MetricsActor = { id: 'a', entity: { name: 'a', kind: 'claude', status: 'idle' }, pos: { x: 0, z: 0 }, level: 0, settledAt: null, moving: true };
  let f = 0;
  const run = (s: number, act: string, settled: boolean) => { for (let i = 0; i < s * 10; i++) { m.frame(++f, 0.1); a.settledAt = settled ? 'slot:x' : null; a.moving = !settled; m.sample(a, { slot, activity: act, phase: 'x' }, 0.1); } };
  run(10, 'lounge', false); // walking there: not occupied, not static
  run(40, 'lounge', true);
  run(2, 'fidget:stretch', true); // a blip
  run(10, 'lounge', true);
  let r = m.read();
  assert.ok(Math.abs(r.p3.maxStillS - 52) < 0.3, JSON.stringify(r.p3));
  assert.ok(Math.abs(r.occupancyPct.LIB - (52 / 62) * 100) < 1, JSON.stringify(r.occupancyPct));
  run(10, 'sitIdle', true); // a real change (≥ 5 s): the run ends where the change began
  r = m.read();
  assert.ok(r.p3.maxStillS < 53, JSON.stringify(r.p3));
  run(70, 'sitIdle', true);
  r = m.read();
  assert.equal(r.p3.over60, 1);
  assert.match(r.p3.recent[0], /^a:slot:x\/sitIdle@/);
});

// ---------------------------------------------------------------------------------------------- [BRN M3.5] §6.9 verbs
const pull = (b: Brain) => { const out: string[] = []; for (let r = b.pullReaction(); r; r = b.pullReaction()) out.push(r); return out; };
const player = (x: number, z: number, dist = 3) => ({ pos: { x, y: 0, z }, dist, inFront: true });

test('§6.9 table: pat / summon never relocate a working or blocked agent (desk / queue place kept for 12 s)', () => {
  const es = [
    ent({ i: 60, status: 'working', statusSince: NOW - 60_000, activity: { tool: 'Edit', cls: 'edit', detail: 'a.js', since: NOW - 1000 } }),
    ent({ i: 61, status: 'blocked', statusSince: NOW - 60_000, prompt: { question: 'Allow?' } }),
  ];
  const { d, map } = rig(es);
  for (const e of es) {
    const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
    const home = must(e.status === 'working' ? d.slotFor(e.id) : d.pinFor(e.id));
    const at = (t: number) => env(t, home.id, { player: player(home.pos.x + 2, home.pos.z + 2), playerLevel: 0 });
    b.update(must(map.get(e.id)), NOW, at(0));
    pull(b);
    const pat = b.verb('pat', at(0.1));
    const pr = pull(b);
    const sum = b.verb('summon', at(0.2));
    const sr = pull(b);
    if (e.status === 'working') {
      // [CHR fix m3-r1, cross-owner BRN] a pat is a squash in place (keeps typing); the 3rd pat within 5 s earns the 'shh'
      assert.equal(pat, 'pat'); assert.deepEqual(pr, ['pat']);
      assert.equal(b.verb('pat', at(0.12)), 'pat'); pull(b);
      assert.equal(b.verb('pat', at(0.14)), 'shh'); assert.deepEqual(pull(b), ['shh']); // the 'shh, busy' glance
      assert.equal(sum, 'refuse'); assert.deepEqual(sr, ['busyFinger']);
    } else {
      assert.equal(pat, 'comfort'); assert.deepEqual(pr, ['pat']); // a comfort squash, keeps its queue spot
      assert.equal(sum, 'refuse'); assert.deepEqual(sr, ['pointTicket']);
    }
    for (let t = 0.3; t < 12; t += 0.25) {
      const i = b.update(must(map.get(e.id)), NOW + t * 1000, at(t));
      assert.equal(must(i.slot).id, home.id, `${e.status} t=${t}: ${i.phase}`);
    }
    // the glance looks at the player for a moment, then back to the work
    assert.equal(b.verb('summon', at(12)), 'cooldown', '§6.9 R cooldown 30 s');
  }
});

test('§6.9 summon: an idle agent skips over to the player, waves, stays 6 s, goes back; a done one returns to the Pit', () => {
  const es = [ent({ i: 62, status: 'idle', statusSince: NOW - 30_000 }), ent({ i: 63, status: 'done', statusSince: NOW - 60_000 })];
  const { d, map } = rig(es);
  for (const e of es) {
    const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
    const home = must(e.status === 'idle' ? d.slotFor(e.id) : d.pinFor(e.id));
    const pl = player(home.pos.x + 4, home.pos.z + 3, 5);
    const E = (t: number, settledAt: string | null, pos = home.pos, dist = 5) => env(t, settledAt, { self: { pos: { ...pos }, yaw: 0, settledAt, moving: !settledAt }, player: { ...pl, dist }, playerLevel: 0 });
    b.update(must(map.get(e.id)), NOW, E(0, home.id));
    pull(b);
    assert.equal(b.verb('summon', E(0.1, home.id)), 'come');
    let i = b.update(must(map.get(e.id)), NOW + 200, E(0.2, home.id));
    assert.equal(i.phase, 'summon');
    assert.equal(must(i.slot).tag, 'summon');
    const gap = Math.hypot(must(i.slot).pos.x - pl.pos.x, must(i.slot).pos.z - pl.pos.z);
    assert.ok(gap > 1.2 && gap < 2.2, `stands ${gap.toFixed(2)} m from the player`);
    const spot = must(i.slot).id, sp = { ...must(i.slot).pos };
    i = b.update(must(map.get(e.id)), NOW + 3000, E(3, spot, sp, gap));
    assert.equal(i.phase, 'summoned');
    assert.ok(pull(b).includes('wave'), 'waves on arrival');
    assert.ok(i.look, 'looks at the player');
    i = b.update(must(map.get(e.id)), NOW + 8000, E(8, spot, sp, gap));
    assert.equal(i.phase, 'summoned');
    i = b.update(must(map.get(e.id)), NOW + 9500, E(9.5, spot, sp, gap));
    assert.equal(must(i.slot).id, home.id, `${e.status}: back to ${home.id} after 6 s (${i.phase})`);
  }
});

test('§6.9: any status change cancels a verb at once; the agent goes where the status says', () => {
  const e = ent({ i: 64, status: 'idle', statusSince: NOW - 30_000 });
  const { d } = rig([e]);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const home = must(d.slotFor(e.id));
  const pl = player(home.pos.x + 4, home.pos.z + 3, 5);
  const E = (t: number, settledAt: string | null, moving = false) => env(t, settledAt, { self: { pos: { x: home.pos.x + 1, y: 0, z: home.pos.z + 1 }, yaw: 0, settledAt, moving }, player: pl, playerLevel: 0 });
  b.update(e, NOW, E(0, home.id));
  assert.equal(b.verb('summon', E(0.1, home.id)), 'come');
  assert.equal(b.update(e, NOW + 500, E(0.5, null, true)).phase, 'summon');
  // blocked while walking over: the summon is off the same frame the status commits (blocked's 1.5 s hysteresis)
  const bl = ent({ ...e, status: 'blocked', statusSince: NOW + 1000, prompt: { question: 'Allow?' } });
  let i: Intent | undefined;
  for (let t = 1; t < 2.8; t += 0.1) i = b.update(bl, NOW + t * 1000, E(t, null, true));
  assert.ok(i);
  assert.notEqual(i.phase, 'summon');
  assert.notEqual(must(i.slot).tag, 'summon');
  assert.equal(b.state.verbCancels, 1);
  // working right after a summon from the desk: straight back to the desk (work call), not to the player
  const e2 = ent({ i: 65, status: 'idle', statusSince: NOW - 30_000 });
  const { d: d2 } = rig([e2]);
  const b2 = createBrain(e2.id, { director: d2, seedKey: e2.seedKey });
  const h2 = must(d2.slotFor(e2.id));
  const E2 = (t: number, settledAt: string | null, moving = false) => env(t, settledAt, { self: { pos: { x: h2.pos.x + 2, y: 0, z: h2.pos.z }, yaw: 0, settledAt, moving }, player: player(h2.pos.x + 4, h2.pos.z, 2), playerLevel: 0 });
  b2.update(e2, NOW, E2(0, h2.id));
  b2.verb('summon', E2(0.1, h2.id));
  b2.update(e2, NOW + 500, E2(0.5, null, true));
  const wk: Entity = { ...e2, status: 'working', statusSince: NOW + 600, activity: { tool: 'Read', cls: 'read', detail: '', since: NOW + 600 } };
  i = b2.update(wk, NOW + 700, E2(0.7, null, true));
  assert.equal(must(i.slot).id, h2.id);
  assert.equal(b2.state.verbCancels, 1);
});

test('§6.9 pat: idle / done squash + hearts (the outcome), a sleeper sneezes awake for a while', () => {
  const es = [ent({ i: 66, status: 'idle', statusSince: NOW - 30_000 }), ent({ i: 67, status: 'idle', statusSince: NOW - 20 * 60_000 }), ent({ i: 68, kind: 'shell', status: 'unknown', process: { name: 'zsh', argv: 'zsh', activity: 'prompt' } })];
  const { d, map } = rig(es);
  const out = es.map((e) => {
    const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
    const home = must(d.slotFor(e.id));
    const i0 = b.update(must(map.get(e.id)), NOW, env(0, home.id));
    pull(b);
    const o = b.verb('pat', env(0.1, home.id));
    const r = pull(b);
    const i1 = b.update(must(map.get(e.id)), NOW + 500, env(0.5, home.id));
    return { o, r, ph0: i0.phase, ph1: i1.phase, face: i1.face };
  });
  assert.equal(out[0].o, 'pat'); assert.deepEqual(out[0].r, ['pat']); assert.equal(out[0].face, 'happy');
  assert.match(out[1].ph0, /nap/i);
  assert.equal(out[1].o, 'sneeze'); assert.deepEqual(out[1].r, ['sneeze']); assert.doesNotMatch(out[1].ph1, /^nap(Desk|:)/);
  assert.equal(out[2].o, 'pat'); assert.equal(out[2].face, 'happy'); // Shelly: ^_^
});

test('§6.8.1 answered: "thanks!" hop at once in the queue (still blocked: it stays), then a dash home once working', () => {
  const e = ent({ i: 69, status: 'blocked', statusSince: NOW - 60_000, prompt: { question: 'Allow?' } });
  const { d } = rig([e]);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const q = must(d.pinFor(e.id)), home = must(d.slotFor(e.id));
  const at = (t: number, settledAt: string | null, moving = false) => env(t, settledAt, { self: { pos: { ...q.pos }, yaw: 0, settledAt, moving } });
  b.update(e, NOW, at(0, q.id));
  pull(b);
  b.answered();
  let i = b.update(e, NOW + 100, at(0.1, q.id));
  assert.deepEqual(pull(b), ['unblock']);
  assert.equal(must(i.slot).id, q.id, 'still blocked: keeps its queue place');
  assert.equal(i.bubble?.title, 'thanks!');
  const wk: Entity = { ...e, status: 'working', statusSince: NOW + 800, prompt: null, activity: { tool: 'Edit', cls: 'edit', detail: '', since: NOW + 800 } };
  i = b.update(wk, NOW + 900, at(0.9, q.id));
  assert.deepEqual(pull(b), [], 'no second unblock hop on the status flip (nor a work call jolt)');
  for (let t = 1; t < 4; t += 0.25) {
    i = b.update(wk, NOW + t * 1000, at(t, null, true));
    assert.equal(must(i.slot).id, home.id);
    assert.equal(i.gait, 'dash', `t=${t}`);
    assert.ok(i.speed >= T.answeredDashSpeed);
    assert.equal(i.phase, 'answeredDash');
  }
  i = b.update(wk, NOW + 5000, env(5, home.id));
  assert.equal(i.gait, null);
  assert.deepEqual(pull(b), ['hop'], 'the sit-hop into the chair');
});

test('prompt.sent: an idle agent away from its desk runs the work call at once and catches the plane at the desk', () => {
  const e = ent({ i: 70, status: 'idle', statusSince: NOW - 5 * 60_000 });
  const { d } = rig([e]);
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const home = must(d.slotFor(e.id));
  const away = (t: number, moving = false) => env(t, moving ? null : 'pt:elsewhere', { self: { pos: { x: home.pos.x + 3, y: 0, z: home.pos.z + 2 }, yaw: 0, settledAt: moving ? null : 'pt:elsewhere', moving } });
  b.update(e, NOW, away(0));
  pull(b);
  assert.equal(b.prompted(away(0.1)), 'call');
  let i = b.update(e, NOW + 200, away(0.2, true));
  assert.deepEqual(pull(b), ['workCall']);
  assert.equal(must(i.slot).id, home.id);
  assert.equal(i.phase, 'workCall');
  assert.equal(i.trip, 'workCall');
  i = b.update(e, NOW + 3000, env(3, home.id));
  assert.deepEqual(pull(b), ['catchPlane']);
  // the status flips a moment later: no second jolt / hop
  const wk: Entity = { ...e, status: 'working', statusSince: NOW + 3500, activity: { tool: 'Read', cls: 'read', detail: '', since: NOW + 3500 } };
  i = b.update(wk, NOW + 3600, env(3.6, home.id));
  assert.deepEqual(pull(b), []);
  assert.equal(i.phase, 'working');
});

// [BRN fix m2-fix1] fun review m2: focus('status:done') framed flint at the Café and it walked out of frame within 0.6 s
test('walk-up attention: aimed at ≥ 0.4 s within reach → an idle / done agent pauses, turns and waves; resumes 3 s after', () => {
  const es = [ent({ i: 70, status: 'done', statusSince: NOW - 60_000 }), ent({ i: 71, status: 'idle', statusSince: NOW - 30_000 }),
    ent({ i: 72, status: 'working', statusSince: NOW - 60_000, activity: { tool: 'Edit', cls: 'edit', detail: 'a.js', since: NOW - 1000 } })];
  const { d, map } = rig(es);
  // 1) a done agent on its way to the Pit (mid-walk): stops where it is, faces the player, waves; then carries on
  const e = must(map.get('d1:p70'));
  const b = createBrain(e.id, { director: d, seedKey: e.seedKey });
  const pin = must(d.pinFor(e.id));
  const mid = { x: pin.pos.x - 2, y: 0, z: pin.pos.z - 1 };
  const pl = player(mid.x + 1.5, mid.z, 1.5);
  const E = (t: number, aimed: boolean, settledAt: string | null = null, pos = mid) => env(t, settledAt, { self: { pos: { ...pos }, yaw: 0, settledAt, moving: !settledAt, level: 0 }, player: pl, aimed });
  let i = b.update(e, NOW, E(0, false));
  assert.equal(must(i.slot).id, pin.id);
  i = b.update(e, NOW + 100, E(0.1, true));
  i = b.update(e, NOW + 300, E(0.3, true));
  assert.equal(must(i.slot).id, pin.id, 'a glance is not attention (< 0.4 s)');
  pull(b);
  i = b.update(e, NOW + 550, E(0.55, true));
  assert.equal(i.phase, 'attend');
  // ([BRN fix m3-r2] the player is 1.5 m off: it stops right here, stepped back to TUNING.attendMinR — never in their face)
  assert.ok(Math.hypot(must(i.slot).pos.x - mid.x, must(i.slot).pos.z - mid.z) < 0.5, 'stops where it is');
  assert.ok(Math.hypot(must(i.slot).pos.x - pl.pos.x, must(i.slot).pos.z - pl.pos.z) >= T.attendMinR - 1e-6, 'at least attendMinR from the player');
  assert.ok(i.look && Math.hypot(i.look.x - pl.pos.x, i.look.z - pl.pos.z) < 1e-6, 'looks at the player');
  assert.equal(i.face, 'happy');
  assert.ok(pull(b).includes('wave'), 'a small wave');
  const hold = must(i.slot).id;
  i = b.update(e, NOW + 2000, E(2, true, hold)); // settled there, still aimed
  assert.equal(must(i.slot).id, hold);
  i = b.update(e, NOW + 2500, E(2.5, false, hold)); // the aim leaves
  i = b.update(e, NOW + 5000, E(5, false, hold));
  assert.equal(must(i.slot).id, hold, 'waits 3 s after the aim leaves');
  i = b.update(e, NOW + 5700, E(5.7, false, hold));
  assert.equal(must(i.slot).id, pin.id, 'then resumes (the Pit seat)');
  assert.notEqual(i.phase, 'attend');
  // 2) a seated idle agent: keeps its seat (same slot), swivels to the player
  const e2 = must(map.get('d1:p71'));
  const b2 = createBrain(e2.id, { director: d, seedKey: e2.seedKey });
  const home = must(d.slotFor(e2.id));
  const pl2 = player(home.pos.x + 1, home.pos.z + 1, 1.4);
  const E2 = (t: number, aimed: boolean) => env(t, home.id, { self: { pos: { ...home.pos }, yaw: home.yaw, settledAt: home.id, moving: false, level: 0 }, player: pl2, aimed });
  b2.update(e2, NOW, E2(0, true));
  i = b2.update(e2, NOW + 600, E2(0.6, true));
  assert.equal(i.phase, 'attend');
  assert.equal(must(i.slot).id, home.id, 'stays in its chair');
  assert.equal(i.swivel, true);
  // a status change ends it on the same frame (honest: §6.9 cosmetic only)
  const w: Entity = { ...e2, status: 'working', statusSince: NOW + 700, activity: { tool: 'Edit', cls: 'edit', detail: 'a.js', since: NOW + 700 } };
  i = b2.update(w, NOW + 800, E2(0.8, true));
  assert.notEqual(i.phase, 'attend');
  // 3) a working agent is never paused by aiming at it
  const e3 = must(map.get('d1:p72'));
  const b3 = createBrain(e3.id, { director: d, seedKey: e3.seedKey });
  const h3 = must(d.slotFor(e3.id));
  for (const t of [0, 0.5, 1, 2]) i = b3.update(e3, NOW + t * 1000, env(t, h3.id, { self: { pos: { ...h3.pos }, yaw: 0, settledAt: h3.id, moving: false }, player: player(h3.pos.x + 1, h3.pos.z, 1), aimed: true }));
  assert.equal(i.phase, 'working');
});
