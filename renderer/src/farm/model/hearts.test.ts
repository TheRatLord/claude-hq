import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_HEARTS, HEART_EVENTS, LATER_MS, createHearts, dueEvent, emptyHearts, eventsOf, flagsOf, heartEvent, heartsView, inHours, keepsakeText, letterBody, nextEvent,
  parseHearts, scriptOf,
} from './hearts.ts';
import type { HeartEvent, HeartLetter, HeartsData } from './hearts.ts';
import { FRIEND_IDS, MILESTONES } from './friends.ts';
import { PLACES, fairCond, keyOf, planFor, routineAt } from './routines.ts';
import { decorDef } from './shop.ts';
import { dayKey } from './almanac.ts';

const NOW = new Date(2026, 9, 2, 9, 0).getTime();

test('three events for every villager, at 3, 5 and 7 hearts (between the milestones), unique ids', () => {
  assert.equal(new Set(HEART_EVENTS.map((e) => e.id)).size, HEART_EVENTS.length);
  for (const who of FRIEND_IDS) {
    const evs = eventsOf(who);
    assert.deepEqual(evs.map((e) => e.n), [1, 2, 3], who);
    assert.deepEqual(evs.map((e) => e.hearts), [...EVENT_HEARTS], who);
    // one of each keepsake kind per villager: a photo, a letter, a yard piece
    assert.deepEqual(evs.map((e) => e.keepsake.kind).sort(), ['decor', 'letter', 'photo'], who);
  }
  const milestones = new Set(MILESTONES.map((m) => m.hearts));
  for (const h of EVENT_HEARTS) assert.ok(!milestones.has(h), 'events fall between the milestones');
});

test('scripts: real places, a choice of 2–3, conditional lines that resolve, a photo line for photo keepsakes', () => {
  for (const e of HEART_EVENTS) {
    for (const p of e.places) assert.ok(p in PLACES, `${e.id}: ${p}`);
    assert.ok(e.beats.length >= 3 && e.beats.length <= 9, `${e.id}: ${e.beats.length} lines`);
    assert.ok(e.choice.options.length >= 2 && e.choice.options.length <= 3, e.id);
    for (const o of e.choice.options) { assert.ok(o.label.length > 2 && o.label.length < 60, `${e.id}: ${o.label}`); assert.ok(o.reply.length >= 1); }
    assert.ok(e.when && e.teaser && e.record && e.title, e.id);
    for (const b of [...e.beats, ...e.after, ...e.choice.options.flatMap((o) => o.reply)]) {
      assert.ok(b.text.length >= 3 && b.text.length < 240, `${e.id}: line too long: ${b.text}`);
      for (const f of [b.if, b.unless]) if (f) assert.match(f, /^(grotto|night|season:\w+|restored:\w+|choice:[a-z]+-\d=\d)$/, `${e.id}: ${f}`);
      assert.doesNotMatch(b.text, /[—–]/, `${e.id}: no em dashes in the copy: ${b.text}`);
    }
    if (e.keepsake.kind === 'photo') assert.ok([...e.after, ...e.choice.options.flatMap((o) => o.reply)].some((b) => b.snap), `${e.id} takes its photo`);
    if (e.keepsake.kind === 'decor') { const d = decorDef(e.keepsake.id); assert.ok(d, e.keepsake.id); assert.ok(d!.gift, 'never on the shelves'); }
    if (e.keepsake.kind === 'letter' && typeof e.keepsake.body !== 'string') assert.equal(e.keepsake.body.length, e.choice.options.length, `${e.id}: a letter per option`);
    // either branch of every condition still makes a scene
    for (const flags of [new Set<string>(), new Set(['grotto', 'restored:halt', 'restored:millwheel', 'restored:observatory', 'restored:glasshouse'])]) {
      assert.ok(scriptOf(e, flags, null).length >= 3, `${e.id} before`);
      for (let k = 0; k < e.choice.options.length; k++) assert.ok(scriptOf(e, flags, k).length >= 2, `${e.id} after ${k}`);
    }
  }
});

test('each event happens where and when that villager\'s day actually takes them (on most days)', () => {
  for (const e of HEART_EVENTS) {
    const restored = ['glasshouse', 'millwheel', 'observatory', 'halt'].filter((id) => e.places.includes(id as never));
    const plan = planFor(e.who, fairCond({ restored }));
    let days = 0;
    for (let doy = 0; doy < 30; doy++) {
      let ok = false;
      for (let h = 0; h < 24 && !ok; h += 0.1) {
        if (!inHours(e.hours, h)) continue;
        const now = routineAt(plan, h, { weather: 'clear', intensity: 0 }, doy, keyOf(e.who));
        if ((e.places as readonly string[]).includes(now.place)) ok = true;
      }
      if (ok) days++;
    }
    assert.ok(days >= 27, `${e.id}: only ${days}/30 days line up`);
  }
});

test('next / due: in order, once you have the hearts, at the place and hour, one a day, not while put off', () => {
  const d = emptyHearts();
  assert.equal(nextEvent(d, 'villager:posy', 2), null, 'not yet');
  assert.equal(nextEvent(d, 'posy', 3)?.id, 'posy-1');
  assert.equal(nextEvent(d, 'posy', 9)?.id, 'posy-1', 'in order, whatever the hearts');
  const ask = { hearts: 3, place: 'mailbox', hour: 9, nowMs: NOW };
  assert.equal(dueEvent(d, 'posy', ask)?.id, 'posy-1');
  assert.equal(dueEvent(d, 'posy', { ...ask, place: 'picnic' }), null, 'wrong place');
  assert.equal(dueEvent(d, 'posy', { ...ask, hour: 20 }), null, 'wrong hour');
  assert.equal(dueEvent(d, 'posy', { ...ask, hearts: 2 }), null);
  d.later['posy-1'] = NOW + 1000;
  assert.equal(dueEvent(d, 'posy', ask), null, 'put off');
  d.later = {};
  d.last = dayKey(NOW);
  assert.equal(dueEvent(d, 'posy', ask), null, 'one a day');
  d.last = '';
  d.seen['posy-1'] = { at: NOW, day: '2026-10-01', choice: 0 };
  assert.equal(nextEvent(d, 'posy', 3), null, 'the next needs 5');
  assert.equal(nextEvent(d, 'posy', 5)?.id, 'posy-2');
  assert.ok(inHours([22, 2], 23) && inHours([22, 2], 1) && !inHours([22, 2], 12));
});

test('flags: choices made earlier and the world, read by the lines', () => {
  const d = emptyHearts();
  d.seen['hazel-1'] = { at: 1, day: '2026-10-01', choice: 1 };
  const f = flagsOf(d, ['grotto']);
  assert.ok(f.has('choice:hazel-1=1') && f.has('grotto'));
  const fern3 = heartEvent('fern-3')!;
  const found = scriptOf(fern3, new Set(['grotto']), null).map((b) => b.text).join(' ');
  const not = scriptOf(fern3, new Set(), null).map((b) => b.text).join(' ');
  assert.match(found, /found it/);
  assert.doesNotMatch(not, /found it/);
  assert.match(not, /never checked/);
  const bram2 = heartEvent('bram-2')!;
  assert.ok(bram2.keepsake.kind === 'letter');
  if (bram2.keepsake.kind === 'letter') assert.notEqual(letterBody(bram2.keepsake, 0), letterBody(bram2.keepsake, 1));
  assert.equal(keepsakeText({ kind: 'photo', caption: 'x' }), 'a photo for your album');
});

const store = (init: unknown = null) => { let mem: unknown = init; return { load: () => mem, save: (d: HeartsData) => { mem = JSON.parse(JSON.stringify(d)); }, get mem() { return mem; } }; };

function play(svc: ReturnType<typeof createHearts>, choice = 0): void {
  for (let n = 0; n < 40 && svc.current(); n++) {
    const s = svc.current()!;
    if (s.phase === 'choose') svc.choose(choice); else svc.advance();
  }
}

test('the service: begin → lines → choice → reply → done; keepsakes delivered; recorded; persisted', async () => {
  const st = store();
  const letters: HeartLetter[] = [], gifts: string[] = [], snaps: string[] = [];
  let t = NOW;
  const hearts: Record<string, number> = { 'villager:posy': 7, 'villager:bram': 5 };
  const svc = createHearts(st, {
    now: () => t, hearts: (w) => hearts[w] ?? 0, flags: () => ['restored:halt'],
    post: (l) => letters.push(l), gift: (id) => gifts.push(id), snap: (e) => { snaps.push(e.id); return true; },
  });
  const changes: string[] = [];
  svc.onChange((c) => changes.push(c.kind));
  assert.equal(svc.due('posy', 'mailbox', 9)?.id, 'posy-1');
  const sc = svc.begin('posy-1')!;
  assert.equal(sc.phase, 'talk');
  assert.equal(svc.due('posy', 'mailbox', 9), null, 'nothing is due while a scene plays');
  // talk through to the choice
  while (svc.current()!.phase === 'talk') svc.advance();
  assert.equal(svc.current()!.phase, 'choose');
  svc.choose(9); assert.equal(svc.current()!.choice, null, 'bad option ignored');
  svc.choose(1);
  assert.equal(svc.current()!.phase, 'talk');
  assert.match(svc.current()!.lines[0].text, /lose a finger/);
  play(svc);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(svc.current(), null);
  assert.deepEqual(snaps, ['posy-1'], 'the photo, once');
  assert.ok(svc.data().seen['posy-1'] && svc.data().seen['posy-1'].choice === 1);
  assert.equal(svc.data().seen['posy-1'].photo, true);
  assert.ok(changes.includes('begin') && changes.includes('done'));
  // one a day
  assert.equal(svc.due('posy', 'picnic', 12.5), null);
  t += 86_400_000;
  assert.equal(svc.due('posy', 'picnic', 12.5)?.id, 'posy-2');
  svc.begin('posy-2'); play(svc, 0);
  assert.equal(letters.length, 1);
  assert.equal(letters[0].id, 'heart:posy-2');
  assert.match(letters[0].title, /whoever farms/);
  assert.match(letters[0].fromName, /first farmer/);
  t += 86_400_000;
  svc.begin('posy-3'); play(svc, 0);
  assert.deepEqual(gifts, ['dovecote']);
  // persisted and parsed back
  const again = createHearts(store(st.mem), { now: () => t, hearts: (w) => hearts[w] ?? 0 });
  assert.equal(again.view().seen, 3);
  assert.equal(again.data().letters.length, 1);
  assert.equal(again.next('posy'), null, 'Posy\'s story is told');
});

test('the service: stepping away puts it off for a while', () => {
  let t = NOW;
  const svc = createHearts(store(), { now: () => t, hearts: () => 3 });
  svc.begin('fern-1');
  svc.leave();
  assert.equal(svc.current(), null);
  assert.equal(svc.due('fern', 'stones', 22.5), null);
  t += LATER_MS + 1;
  assert.equal(svc.due('fern', 'stones', 22.5)?.id, 'fern-1');
  assert.equal(svc.data().seen['fern-1'], undefined, 'not recorded');
});

test('view + parse: the notebook\'s record; tolerant of junk', () => {
  const d = emptyHearts();
  d.seen['nimbus-1'] = { at: 5, day: '2026-09-30', choice: 2 };
  const v = heartsView(d, (w) => (w === 'villager:nimbus' ? 5 : 0));
  assert.equal(v.total, 18);
  assert.equal(v.seen, 1);
  const nim = v.people.find((p) => p.who === 'villager:nimbus')!;
  assert.equal(nim.done[0].title, 'Cloud names');
  assert.equal(nim.next?.id, 'nimbus-2');
  assert.equal(nim.next?.ready, true);
  assert.equal(v.people.find((p) => p.who === 'villager:posy')!.next?.ready, false);
  for (const junk of [null, 3, 'x', [], { v: 2 }]) assert.equal(parseHearts(junk), null);
  const p = parseHearts({ v: 1, seen: { 'posy-1': { at: 1, day: '2026-01-01', choice: 7 }, 'nope-9': { at: 1 }, 'bram-1': 'x' }, last: 'yesterday', later: { 'fern-1': 9, bad: 1 }, letters: [{ id: 'a' }, { id: 'heart:x', at: 1, from: 'villager:posy', fromName: 'P', title: 't', body: 'b' }] })!;
  assert.deepEqual(Object.keys(p.seen), ['posy-1']);
  assert.equal(p.seen['posy-1'].choice, 0, 'out-of-range choice clamped');
  assert.equal(p.last, '');
  assert.deepEqual(p.later, { 'fern-1': 9 });
  assert.equal(p.letters.length, 1);
});

test('every event can be played through every option', () => {
  for (const e of HEART_EVENTS as readonly HeartEvent[]) {
    for (let k = 0; k < e.choice.options.length; k++) {
      const svc = createHearts(store(), { now: () => NOW, hearts: () => 10 });
      assert.ok(svc.begin(e.id));
      play(svc, k);
      assert.equal(svc.data().seen[e.id]?.choice, k, `${e.id} option ${k}`);
    }
  }
});
