import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, collectDef } from './collection.ts';
import { DECOR, decorDef, lockOf } from './shop.ts';
import { createWallet, shopView, emptyWallet } from './wallet.ts';
import {
  FRIENDS, FRIEND_IDS, HEART, MAX_HEARTS, MILESTONES, PTS, claimMilestones, createFriends, deliver, emptyFriends, ensureDay, friendDef,
  giveGift, heartsOf, inWindow, itemText, milestoneLetter, parseFriends, progress, caughtHit, visitHit, eventHit, requestText, requestView,
  requestsFor, talkTo, tierOf, gatherWith,
} from './friends.ts';
import type { FriendsChange, FriendsData } from './friends.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('friends: six villagers, gift tastes are real collectibles and fit their roles', () => {
  assert.equal(FRIENDS.length, 6);
  assert.deepEqual(FRIENDS.map((f) => f.id), [...FRIEND_IDS]);
  for (const f of FRIENDS) {
    for (const id of [...f.loves, ...f.likes, ...f.dislikes]) assert.ok(collectDef(id), `${f.id}: ${id}`);
    const all = [...f.loves, ...f.likes, ...f.dislikes];
    assert.equal(new Set(all).size, all.length, `${f.id} has an item in two lists`);
    assert.ok(f.loves.length >= 3, f.id);
    assert.ok(decorDef(f.decor)?.friend?.hearts === 6, f.decor);
    assert.ok(decorDef(f.keepsake)?.keepsake, f.keepsake);
  }
  assert.equal(tierOf(friendDef('hazel')!, 'hazelnut'), 'love');
  assert.equal(tierOf(friendDef('hazel')!, 'acorn'), 'love');
  assert.equal(tierOf(friendDef('nimbus')!, 'crystal'), 'love');
  assert.equal(tierOf(friendDef('nimbus')!, 'bottle'), 'love');
  assert.equal(tierOf(friendDef('fern')!, 'feather'), 'love');
  assert.equal(tierOf(friendDef('fern')!, 'pinecone'), 'love');
  assert.equal(tierOf(friendDef('posy')!, 'violet'), 'love');
  assert.equal(tierOf(friendDef('bram')!, 'salmon'), 'love');
  assert.equal(tierOf(friendDef('fern')!, 'koi'), 'dislike');
  assert.equal(tierOf(friendDef('posy')!, 'minnow'), 'neutral');
  // every collectible is loved by somebody or at least not universally disliked
  for (const d of CATALOG) assert.ok(FRIENDS.some((f) => tierOf(f, d.id) !== 'dislike'), d.id);
});

test('friends: hearts from points, a chat counts once a day, one gift a day each', () => {
  assert.equal(heartsOf(0), 0);
  assert.equal(heartsOf(HEART - 1), 0);
  assert.equal(heartsOf(HEART * 3 + 5), 3);
  assert.equal(heartsOf(HEART * 99), MAX_HEARTS);
  const d = emptyFriends();
  const t = at(2026, 10, 1, 9);
  assert.equal(talkTo(d, 'villager:hazel', t), PTS.talk);
  assert.equal(talkTo(d, 'villager:hazel', t + 3600_000), 0);
  assert.equal(talkTo(d, 'villager:hazel', at(2026, 10, 2, 9)), PTS.talk);
  assert.equal(talkTo(d, 'villager:nobody', t), 0);
  const g = giveGift(d, 'villager:hazel', 'hazelnut', t);
  assert.ok(g.ok && g.tier === 'love' && g.first && g.gained === PTS.love);
  const again = giveGift(d, 'villager:hazel', 'acorn', t);
  assert.deepEqual(again, { ok: false, reason: 'gifted' });
  assert.equal(d.known['villager:hazel'].hazelnut, 'love');
  const bad = giveGift(d, 'villager:hazel', 'boot', at(2026, 10, 2, 9));
  assert.ok(bad.ok && bad.tier === 'dislike' && bad.gained < 0);
  const second = giveGift(d, 'villager:hazel', 'hazelnut', at(2026, 10, 3, 9));
  assert.ok(second.ok && !second.first);
  assert.ok(d.pts['villager:hazel'] >= 0 && d.pts['villager:hazel'] <= HEART * MAX_HEARTS);
  assert.deepEqual(giveGift(d, 'villager:hazel', 'nope', at(2026, 10, 9)), { ok: false, reason: 'unknown' });
});

test('friends: milestones come once each, in order, at 2 / 4 / 6 / 8 / 10 hearts, with a letter for each note', () => {
  assert.deepEqual(MILESTONES.map((m) => m.hearts), [2, 4, 6, 8, 10]);
  const d = emptyFriends();
  d.pts['villager:fern'] = HEART * 4 + 10;
  assert.deepEqual(claimMilestones(d, 'villager:fern').map((m) => m.unlock), ['letter', 'lines']);
  assert.deepEqual(claimMilestones(d, 'villager:fern'), []);
  d.pts['villager:fern'] = HEART * 10;
  assert.deepEqual(claimMilestones(d, 'villager:fern').map((m) => m.unlock), ['decor', 'recipe', 'keepsake']);
  // losing a heart never takes a milestone back, nor gives it twice
  d.pts['villager:fern'] = HEART * 9;
  d.pts['villager:fern'] = HEART * 10;
  assert.deepEqual(claimMilestones(d, 'villager:fern'), []);
  for (const f of FRIENDS) for (const k of ['letter', 'recipe', 'keepsake'] as const) {
    const l = milestoneLetter(f.id, k);
    assert.ok(l.title.length > 5 && l.body.length > 80, `${f.id} ${k}`);
    assert.ok(l.body.includes(f.short), `${f.id} ${k} is signed`);
  }
});

test('requests: 1–3 a day, deterministic per date, one per villager, feasible in season', () => {
  const counts = new Set<number>();
  const kinds = new Set<string>();
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    for (let i = 0; i < 40; i++) {
      const dk = day(at(2026, 1, 1) + i * 86_400_000);
      const a = requestsFor(dk, season), b = requestsFor(dk, season);
      assert.deepEqual(a, b);
      assert.ok(a.length >= 1 && a.length <= 3, `${dk} ${season}: ${a.length}`);
      counts.add(a.length);
      assert.equal(new Set(a.map((q) => q.who)).size, a.length);
      assert.equal(new Set(a.map((q) => q.id)).size, a.length);
      for (const q of a) {
        kinds.add(q.kind);
        assert.ok(q.reward >= 10 && q.state === 'open' && q.have === 0, q.id);
        if (q.kind === 'bring') assert.ok(collectDef(q.item!)?.seasons.includes(season), `${q.id} ${q.item} in ${season}`);
        if (q.kind === 'catch' && q.item !== 'any') {
          const f = collectDef(q.item!);
          assert.ok(f && f.kind === 'fish' && f.seasons.includes(season) && f.weather === 'any', `${q.id} ${q.item}`);
        }
        assert.ok(requestText(q).length > 8, q.id);
      }
    }
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3]);
  assert.deepEqual([...kinds].sort(), ['agent', 'bring', 'catch', 'visit']);
});

test('requests: text reads naturally', () => {
  assert.equal(itemText('chanterelle', 3), '3 chanterelles');
  assert.equal(itemText('pike', 1), 'a pike');
  assert.equal(itemText('acorn', 1), 'an acorn');
  assert.equal(itemText('mapleleaf', 2), '2 maple leaves');
  assert.equal(itemText('berries', 3), '3 wild strawberries');
  assert.equal(itemText('wildleek', 2), '2 wild leeks');
  assert.equal(itemText('shell', 2), '2 mussel shells');
  assert.equal(requestText({ id: 'x', who: 'villager:hazel', kind: 'bring', item: 'chanterelle', n: 3, have: 0, reward: 50, state: 'open', when: 'any' }), 'Bring Hazel 3 chanterelles');
  assert.equal(requestText({ id: 'x', who: 'villager:bram', kind: 'catch', item: 'pike', n: 1, have: 0, reward: 50, state: 'open', when: 'beforeDusk' }), 'Catch a pike before dusk for Bram');
  assert.equal(requestText({ id: 'x', who: 'villager:fern', kind: 'visit', place: 'stones', n: 1, have: 0, reward: 35, state: 'open', when: 'night' }), 'Visit the standing stones after dark for Fern');
  assert.equal(requestText({ id: 'x', who: 'villager:posy', kind: 'agent', goal: 'answer', n: 1, have: 0, reward: 30, state: 'open', when: 'any' }), 'Answer a farmer who needs you, for Posy');
});

test('requests: progress by catch (window), visit (hour), agent event; bring counts the basket; deliver once', () => {
  assert.ok(inWindow('night', 22) && inWindow('night', 3) && !inWindow('night', 12));
  assert.ok(inWindow('beforeDusk', 10) && !inWindow('beforeDusk', 19));
  const d: FriendsData = emptyFriends();
  d.req = { day: '2026-10-01', list: [
    { id: 'a', who: 'villager:bram', kind: 'catch', item: 'perch', n: 1, have: 0, reward: 40, state: 'open', when: 'beforeDusk' },
    { id: 'b', who: 'villager:fern', kind: 'visit', place: 'stones', n: 1, have: 0, reward: 35, state: 'open', when: 'night' },
    { id: 'c', who: 'villager:posy', kind: 'agent', goal: 'answer', n: 1, have: 0, reward: 30, state: 'open', when: 'any' },
    { id: 'd', who: 'villager:hazel', kind: 'bring', item: 'acorn', n: 3, have: 0, reward: 50, state: 'open', when: 'any' },
  ] };
  assert.deepEqual(progress(d, caughtHit('perch', 19)), []);
  assert.deepEqual(progress(d, caughtHit('carp', 10)), []);
  assert.deepEqual(progress(d, caughtHit('perch', 10)).map((q) => q.id), ['a']);
  assert.deepEqual(progress(d, visitHit('stones', 13)), []);
  assert.deepEqual(progress(d, visitHit('stones', 23)).map((q) => q.id), ['b']);
  assert.deepEqual(progress(d, eventHit('ship')), []);
  assert.deepEqual(progress(d, eventHit('unblocked')).map((q) => q.id), ['c']);
  const basket = (n: number) => (id: string) => (id === 'acorn' ? n : 0);
  assert.equal(requestView(d.req.list[3], basket(2)).ready, false);
  assert.equal(requestView(d.req.list[3], basket(2)).next, '2 of 3 in your basket');
  assert.equal(requestView(d.req.list[3], basket(5)).ready, true);
  assert.equal(deliver(d, 'villager:hazel', basket(2)), null);
  const r = deliver(d, 'villager:hazel', basket(3));
  assert.ok(r && r.coins === 50 && r.take?.id === 'acorn' && r.take.n === 3);
  assert.equal(deliver(d, 'villager:hazel', basket(9)), null);
  const r2 = deliver(d, 'villager:fern', basket(0));
  assert.ok(r2 && r2.take === null && d.pts['villager:fern'] === PTS.request);
  assert.equal(d.total.requests, 2);
});

test('requests: a new day rolls a new set, yesterday lapses', () => {
  const d = emptyFriends();
  assert.equal(ensureDay(d, at(2026, 10, 1), 'autumn'), true);
  assert.equal(ensureDay(d, at(2026, 10, 1, 20), 'autumn'), false);
  const first = d.req.list.map((q) => q.id);
  assert.equal(ensureDay(d, at(2026, 10, 2), 'autumn'), true);
  assert.notDeepEqual(d.req.list.map((q) => q.id), first);
});

test('friends: parse is tolerant and round-trips', () => {
  assert.equal(parseFriends(null), null);
  assert.equal(parseFriends({ v: 2, pts: {} }), null);
  const d = emptyFriends();
  d.pts['villager:posy'] = 230; d.pts['villager:nobody'] = 5;
  d.known['villager:posy'] = { violet: 'love' };
  d.got['villager:posy'] = 2;
  d.letters.push({ id: 'friend:villager:posy:2', at: 5, from: 'villager:posy', title: 't', body: 'b' });
  ensureDay(d, at(2026, 10, 1), 'autumn');
  const back = parseFriends(JSON.parse(JSON.stringify(d)))!;
  assert.equal(back.pts['villager:posy'], 230);
  assert.equal(back.pts['villager:nobody'], undefined);
  assert.deepEqual(back.req, d.req);
  assert.deepEqual(back.known, d.known);
  assert.equal(back.letters.length, 1);
  const junk = parseFriends({ v: 1, pts: { 'villager:posy': 'x', 'villager:bram': 99999 }, known: { 'villager:bram': { nope: 'love', carp: 'meh' } }, req: { day: 'bad', list: [] }, letters: [{}] })!;
  assert.equal(junk.pts['villager:posy'], undefined);
  assert.equal(junk.pts['villager:bram'], HEART * MAX_HEARTS);
  assert.deepEqual(junk.known['villager:bram'], {});
  assert.equal(junk.req.day, '');
  assert.equal(junk.letters.length, 0);
});

test('shop: friend decor waits for hearts, keepsakes are never on the shelves', () => {
  const postbox = decorDef('postbox')!;
  assert.equal(lockOf(postbox, { rank: 9, season: 'autumn', owned: 0 }), 'friend');
  assert.equal(lockOf(postbox, { rank: 9, season: 'autumn', owned: 0, hearts: () => 5 }), 'friend');
  assert.equal(lockOf(postbox, { rank: 9, season: 'autumn', owned: 0, hearts: (id) => (id === 'villager:posy' ? 6 : 0) }), null);
  assert.equal(lockOf(decorDef('keep-posy')!, { rank: 9, season: 'autumn', owned: 0, hearts: () => 10 }), 'keepsake');
  const shelf = shopView(emptyWallet(), { rank: 0, season: 'autumn' });
  assert.ok(!shelf.some((e) => e.def.keepsake));
  assert.ok(shelf.some((e) => e.def.id === 'postbox' && e.locked === 'friend'));
  assert.equal(DECOR.filter((d) => d.keepsake).length, 6);
});

test('the live service: talk, gift from the basket, deliver pays, milestones post letters and gift a keepsake', () => {
  let now = at(2026, 10, 1, 10);
  let saved: unknown = null;
  const wallet = createWallet(undefined, { now: () => now });
  wallet.stash('hazelnut', 2); wallet.stash('boot', 1);
  const changes: FriendsChange[] = [];
  const fr = createFriends({ load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); } }, {
    now: () => now, season: () => 'autumn',
    basket: { count: (id) => wallet.data().basket[id] ?? 0, take: (id, n) => wallet.take(id, n), stash: (id, n) => wallet.stash(id, n) },
    pay: (c, why) => wallet.reward(c, why), gift: (id) => { wallet.gift(id); },
  });
  fr.onChange((c) => changes.push(c));
  assert.ok(fr.requests().length >= 1);
  assert.equal(fr.talk('hazel'), PTS.talk);
  assert.equal(fr.talk('villager:hazel'), 0);
  const g = fr.give('hazel', 'hazelnut');
  assert.ok(g.ok && g.tier === 'love');
  assert.equal(wallet.data().basket.hazelnut, 1);
  assert.deepEqual(fr.give('hazel', 'hazelnut'), { ok: false, reason: 'gifted' });
  assert.deepEqual(fr.give('bram', 'crystal'), { ok: false, reason: 'none' });
  assert.equal(fr.view('hazel')!.hearts, 1);
  assert.ok(fr.view('hazel')!.giftedToday && fr.view('hazel')!.known.hazelnut === 'love');
  // to ten hearts: every milestone once; the keepsake lands in the yard
  fr.devHearts('hazel', 10);
  const ms = changes.filter((c) => c.kind === 'milestone');
  assert.deepEqual(ms.map((c) => c.kind === 'milestone' && c.unlock), ['letter', 'lines', 'decor', 'recipe', 'keepsake']);
  assert.equal(fr.data().letters.length, 3);
  assert.ok(wallet.data().pieces.some((p) => p.id === 'keep-hazel'));
  // requests: make them ready, then deliver one for bits
  const views = fr.devRequests({ ready: true });
  const q = views[0];
  const before = wallet.coins();
  const r = fr.deliver(q.req.who);
  assert.ok(r && wallet.coins() === before + q.req.reward);
  assert.equal(fr.deliver(q.req.who), null);
  assert.ok(changes.some((c) => c.kind === 'delivered'));
  // persisted
  const fr2 = createFriends({ load: () => saved, save: () => {} }, { now: () => now, season: () => 'autumn' });
  assert.equal(fr2.hearts('hazel'), 10);
  assert.equal(fr2.requests().find((x) => x.req.id === q.req.id)?.done, true);
  // tomorrow: fresh requests, a new chat counts again
  now = at(2026, 10, 2, 10);
  assert.ok(fr.requests().every((x) => !x.done));
  assert.ok(changes.some((c) => c.kind === 'day'));
});

test('friends: sitting together at an evening gathering counts once a day each (old saves without it parse)', () => {
  const d = emptyFriends();
  const t = at(2026, 10, 1, 20);
  assert.equal(gatherWith(d, 'villager:fern', t), PTS.gather);
  assert.equal(gatherWith(d, 'villager:fern', t + 1800_000), 0);
  assert.equal(gatherWith(d, 'villager:fern', at(2026, 10, 2, 20)), PTS.gather);
  assert.equal(gatherWith(d, 'villager:nobody', t), 0);
  const old = JSON.parse(JSON.stringify(d));
  delete old.gathered;
  assert.deepEqual(parseFriends(old)?.gathered, {});
  assert.equal(parseFriends(JSON.parse(JSON.stringify(d)))?.gathered['villager:fern'], day(at(2026, 10, 2, 20)));
  const now = at(2026, 10, 1, 21);
  const fr = createFriends(undefined, { now: () => now, season: () => 'autumn' });
  const changes: FriendsChange[] = [];
  fr.onChange((c) => changes.push(c));
  assert.equal(fr.gathered(['villager:fern', 'bram', 'villager:nobody']), PTS.gather * 2);
  assert.equal(fr.gathered(['villager:fern', 'villager:bram']), 0);
  assert.deepEqual(changes.filter((c) => c.kind === 'gather').map((c) => (c as { who: string }).who), ['villager:fern', 'villager:bram']);
});
