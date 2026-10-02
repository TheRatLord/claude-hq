import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRIENDS, requestsFor } from '../../model/friends.ts';
import type { Request } from '../../model/friends.ts';
import { CAST } from './cast.ts';
import { askLine, closeLine, doneLine, giftLine, giftedLine, remindLine, thanksLine } from './friendlines.ts';

const roleOf = (id: string) => CAST.find((v) => v.id === id)!.role;

test('friend lines: the cast and the friendship model agree on who is who', () => {
  assert.deepEqual(FRIENDS.map((f) => f.id).sort(), CAST.map((v) => v.id).sort());
  for (const f of FRIENDS) assert.equal(CAST.find((v) => v.id === f.id)!.name, f.name);
});

test('friend lines: every request a villager can post has an ask, a nudge and a thank-you in their voice', () => {
  const seen = new Set<string>();
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    for (let i = 1; i <= 28; i++) {
      for (const q of requestsFor(`2026-02-${String(i).padStart(2, '0')}`, season)) {
        const role = roleOf(q.who);
        const ask = askLine(role, q), nudge = remindLine(role, q, 'soon'), thanks = thanksLine(role, q, 35);
        for (const l of [ask, nudge, thanks]) assert.ok(l.length > 12 && !/undefined|NaN|\[object/.test(l), `${q.id}: ${l}`);
        assert.ok(thanks.includes('35 bits'), thanks);
        seen.add(`${role}:${q.kind}`);
      }
    }
  }
  assert.ok(seen.size >= 12, [...seen].join(' '));
  const q: Request = { id: 'x', who: 'villager:fern', kind: 'visit', place: 'stones', n: 1, have: 0, reward: 35, state: 'open', when: 'night' };
  assert.match(askLine('ranger', q), /standing stones after dark/);
});

test('friend lines: gift reactions name the gift; warm lines wait for 4 hearts', () => {
  for (const v of CAST) {
    for (const t of ['love', 'like', 'neutral', 'dislike'] as const) assert.match(giftLine(v.role, t, 'hazelnut'), /hazelnut/);
    assert.ok(giftedLine(v.role).length > 10 && doneLine(v.role).length > 10);
    assert.equal(closeLine(v.role, 3, 2), null);
    assert.equal(closeLine(v.role, 6, 1), null);
    assert.ok(closeLine(v.role, 4, 2));
    assert.ok(closeLine(v.role, 9, 8));
  }
});
