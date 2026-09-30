import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hash32, hashHex, mulberry32, promptHash, workspaceColorIndex, assignWorkspaceColors, placeOf, identityMatch,
  findByIdentity, identityKey,
} from './identity.ts';

test('hash32 is stable, unsigned and spreads', () => {
  assert.equal(hash32('scout'), hash32('scout'));
  assert.notEqual(hash32('scout'), hash32('scouu'));
  for (const s of ['', 'a', 'hq-core', 'ü🙂']) {
    const h = hash32(s);
    assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32, s);
  }
  // pinned values: changing the hash re-colours every workspace and re-rolls every personality
  assert.equal(hashHex('scout'), hashHex('scout'));
  assert.match(hashHex('x'), /^[0-9a-f]{8}$/);
  const buckets = new Array(8).fill(0);
  for (let i = 0; i < 8000; i++) buckets[hash32(`ws-${i}`) % 8]++;
  for (const b of buckets) assert.ok(b > 850 && b < 1150, `bucket ${b}`);
});

test('hash32 golden values (do not change)', () => {
  // Recorded once. If this fails, you changed the hash: every colour/personality changes.
  assert.deepEqual(['', 'scout', 'hq-core'].map(hashHex), GOLDEN);
});
const GOLDEN = ['ab3e7c0b', '58a2e8cd', '64f5265a'];

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(42), b = mulberry32(42);
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 1000 - 0.5) < 0.05);
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('promptHash depends on seq, question and labels', () => {
  const h = promptHash(4, 'Proceed?', ['Yes', 'No']);
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(h, promptHash(4, 'Proceed?', ['Yes', 'No']));
  assert.notEqual(h, promptHash(5, 'Proceed?', ['Yes', 'No']));
  assert.notEqual(h, promptHash(4, 'Proceed?', ['Yes', 'No, and tell Claude']));
});

test('workspaceColorIndex probes past taken colours', () => {
  const base = workspaceColorIndex('hq-core');
  assert.ok(base >= 0 && base < 8);
  assert.equal(workspaceColorIndex('hq-core', [base]), (base + 1) % 8);
  assert.equal(workspaceColorIndex('hq-core', new Set([base, (base + 1) % 8])), (base + 2) % 8);
  assert.equal(workspaceColorIndex('hq-core', [0, 1, 2, 3, 4, 5, 6, 7]), base);
});

test('assignWorkspaceColors: unique within a cycle, stable per label, cycles past 8', () => {
  const ws = Array.from({ length: 10 }, (_, i) => ({ id: `w${i + 1}`, label: `proj-${i}`, number: i + 1 }));
  const m = assignWorkspaceColors([...ws].reverse());
  const first8 = ws.slice(0, 8).map((w) => m.get(w.id)?.colorIndex);
  assert.equal(new Set(first8).size, 8);
  assert.deepEqual(ws.map((w) => m.get(w.id)?.cycle), [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  assert.notEqual(m.get('w9')?.colorIndex, m.get('w10')?.colorIndex);
  // lowest-numbered workspace always gets its own hash colour
  assert.equal(m.get('w1')?.colorIndex, workspaceColorIndex('proj-0'));
});

test('identityMatch / findByIdentity follow terminalId → agentSession → place', () => {
  const place = placeOf('hq', 'claude', 0, '/home/x');
  assert.equal(place, 'hq/claude/0//home/x');
  const e = (id: string, terminalId: string, agentSession: string | null, p: string) => ({ id, identity: { terminalId, agentSession, place: p } });
  const a = e('w1:p1', 't1', 's1', place), b = e('w1:p2', 't2', null, 'hq/claude/1//x'), c = e('w1:p3', 't3', 's1', place);
  assert.equal(identityMatch({ terminalId: 't1', agentSession: 'zz', place: 'q' }, a), 'terminalId');
  assert.equal(identityMatch({ terminalId: 'nope', agentSession: 's1', place: 'q' }, a), 'agentSession');
  assert.equal(identityMatch({ terminalId: null, agentSession: null, place }, a.identity), 'place');
  assert.equal(identityMatch({ terminalId: null, agentSession: null, place: '' }, { identity: { terminalId: null, agentSession: null, place: '' } }), null);
  assert.equal(identityMatch(null, a), null);
  assert.equal(findByIdentity({ terminalId: 't2', agentSession: null, place: '' }, [a, b, c]), b);
  // agentSession s1 is ambiguous (a, c) and place too → no match
  assert.equal(findByIdentity({ terminalId: 'gone', agentSession: 's1', place }, [a, b, c]), null);
  assert.equal(findByIdentity({ terminalId: 'gone', agentSession: 's1', place }, [a, b]), a);
  assert.equal(identityKey(a.identity), 'terminalId:t1');
  assert.equal(identityKey({ terminalId: null, agentSession: null, place: 'p' }), 'place:p');
});
