import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE, CHAPTERS, FEATURES, LATEST, NEAR_FAR, NEWS_MAX, NOTEBOOK_AFTER, PAGES, RUMOUR_GAP_MS, SEEN_IDS, createGuide, emptyGuide, emptyGuideWorld,
  fillKeys, guideView, newsDue, newsLetter, newsSince, nudgesFor, pageDef, parseGuide, rumourFor, type GuideWorld,
} from './guide.ts';
import { MOTIFS, emptyStamps } from './stamps.ts';
import { emptyCollection } from './collection.ts';
import { emptyFriends } from './friends.ts';
import { HINTS } from './onboarding.ts';

const T0 = new Date(2026, 9, 2, 10, 0).getTime();
const W = (o: Partial<GuideWorld> = {}): GuideWorld => ({ ...emptyGuideWorld(), ...o });
const found = (w: GuideWorld) => guideView(w).pages.filter((p) => p.found).map((p) => p.def.id);

test('guide: every page is well formed (unique ids, a known motif, a chapter, a how-to and a cryptic hint)', () => {
  const ids = new Set<string>();
  for (const p of PAGES) {
    assert.ok(!ids.has(p.id), p.id); ids.add(p.id);
    assert.ok((MOTIFS as readonly string[]).includes(p.motif), `${p.id} motif`);
    assert.ok((CHAPTERS as readonly string[]).includes(p.chapter), p.id);
    assert.ok(p.how.length > 40 && p.hint.length > 12, p.id);
    // a hint never names the page it hints at (the cryptic part), and a secret's hint never gives the how-to away
    assert.ok(!p.hint.toLowerCase().includes(p.title.toLowerCase()), `${p.id}: the hint names it`);
  }
  for (const c of CHAPTERS) assert.ok(PAGES.some((p) => p.chapter === c), c);
  assert.ok(PAGES.length >= 18);
  const grotto = pageDef('grotto')!;
  assert.ok(grotto.secret && grotto.by?.length === 1 && grotto.by[0] === 'villager:fern', 'the grotto is a secret only Fern hints at');
  assert.doesNotMatch(grotto.hint + grotto.rumour, /ledge|cave|crystal|behind/i, 'no spoilers');
  assert.match(pageDef('skate')!.hint, /pond turns to glass/);
});

test('guide: an empty world has nothing found, and nothing throws', () => {
  const v = guideView(W());
  assert.equal(v.found, 0);
  assert.equal(v.total, PAGES.length);
  for (const p of v.pages) assert.deepEqual(p.notes, []);
});

test('guide: pages are found off the other services (no copies), progress reads from them too', () => {
  const st = emptyStamps();
  st.n.row = 3; st.n.rowM = 1480; st.n.photo = 2; st.fests = ['harvest']; st.nooks = ['pergola', 'stones']; st.earned.summit = T0;
  const col = emptyCollection();
  col.found.morel = { n: 4, first: '2026-10-01' };
  col.found.trout = { n: 2, first: '2026-10-01', best: 41 };
  const fr = emptyFriends();
  fr.total.gifts = 2; fr.pts['villager:hazel'] = 260;
  const w = W({
    stamps: st, collection: col, friends: fr, stones: 3, photos: 5,
    barn: { days: 1, eggs: 9, milk: 2, feeds: 12, brushes: 1 },
    pet: { name: 'Biscuit', walk: 2350, fetch: 4, finds: 1, pets: 9 },
    grotto: { v: 1, found: T0, visits: 2, last: '2026-10-02', chest: null, pages: 3 },
  });
  const ids = found(w);
  for (const id of ['forage', 'fish', 'photo', 'rowboat', 'festival', 'gifts', 'summit', 'nooks', 'barn', 'pet', 'grotto']) assert.ok(ids.includes(id), id);
  for (const id of ['skate', 'snowman', 'farmhouse', 'lantern', 'gazette', 'requests']) assert.ok(!ids.includes(id), id);
  const notes = (id: string) => guideView(w).pages.find((p) => p.def.id === id)!.notes.join(' | ');
  assert.match(notes('rowboat'), /1\.5 km rowed on the pond/);
  assert.match(notes('rowboat'), /3 outings/);
  assert.match(notes('barn'), /fed 12 times/);
  assert.match(notes('barn'), /9 eggs · 2 pails/);
  assert.match(notes('pet'), /Biscuit: 2\.4 km walked/);
  assert.match(notes('fish'), /2 fish caught.*41 cm/);
  assert.match(notes('summit'), /3 of 7 stones/);
  assert.match(notes('nooks'), /2 of 8 nooks/);
  assert.match(notes('grotto'), /2 visits.*3 of 6 pages.*still hidden/);
  assert.match(notes('gifts'), /2 gifts given.*Hazel ♥/);
});

test('guide: the seen set finds what nobody else remembers; when-labels say what can be done now', () => {
  const ids = found(W({ seen: ['rowboat', 'skate', 'farmhouse', 'barn', 'gazette', 'wave'] }));
  for (const id of ['rowboat', 'skate', 'farmhouse', 'barn', 'gazette', 'lantern']) assert.ok(ids.includes(id), id);
  const now = (w: GuideWorld, id: string) => guideView(w).pages.find((p) => p.def.id === id)!.now;
  assert.ok(now(W({ season: 'summer' }), 'rowboat'));
  assert.ok(!now(W({ season: 'winter' }), 'rowboat'));
  assert.ok(now(W({ season: 'winter', ice: 1 }), 'skate'));
  assert.ok(!now(W({ season: 'winter', ice: 0 }), 'skate'));
  assert.ok(now(W({ snow: 0.6 }), 'snowman'));
  assert.ok(now(W({ gathering: 'campfire' }), 'gathering'));
  // the toured chips (the welcome tour's pastime step) count as found
  assert.ok(found(W({ toured: { farmhouse: true, fish: true } })).includes('farmhouse'));
});

test('guide: fillKeys puts the bound keys in; unknown placeholders stay', () => {
  assert.equal(fillKeys('{use} to climb in, {notebook} for notes, {nope}', { use: 'R', notebook: 'O' }), 'R to climb in, O for notes, {nope}');
  for (const p of PAGES) assert.doesNotMatch(fillKeys(p.how, { use: 'E', alt: 'F', wave: 'Z', lantern: 'T', notebook: 'O' }), /\{\w+\}/, p.id);
});

test('guide: nudges only for what you are next to and have never tried, in season, outdoors', () => {
  const at = (o: Partial<typeof NEAR_FAR>) => ({ ...NEAR_FAR, ...o });
  assert.deepEqual(nudgesFor(W({ season: 'summer', hour: 11 }), at({ dock: 6 })), ['boat']);
  assert.deepEqual(nudgesFor(W({ season: 'winter', hour: 11 }), at({ dock: 6 })), [], 'no boat in winter');
  assert.deepEqual(nudgesFor(W({ season: 'summer', hour: 23 }), at({ dock: 6 })), [], 'not at night');
  assert.deepEqual(nudgesFor(W({ season: 'summer', hour: 11, stamps: { ...emptyStamps(), n: { ...emptyStamps().n, row: 1 } } }), at({ dock: 6 })), [], 'already rowed');
  assert.deepEqual(nudgesFor(W({ season: 'summer', hour: 11, seen: ['rowboat'] }), at({ dock: 6 })), [], 'already aboard once');
  assert.deepEqual(nudgesFor(W({ season: 'winter', ice: 1 }), at({ pond: 2 })), ['skate']);
  assert.deepEqual(nudgesFor(W({ snow: 0.5 }), at({})), ['snow']);
  assert.deepEqual(nudgesFor(W({}), at({ barn: 8 })), ['barn']);
  assert.deepEqual(nudgesFor(W({ barn: { days: 0, eggs: 0, milk: 0, feeds: 1, brushes: 0 } }), at({ barn: 8 })), []);
  assert.deepEqual(nudgesFor(W({ gathering: 'campfire' }), at({ campfire: 12 })), ['campfire']);
  assert.deepEqual(nudgesFor(W({}), at({ trailhead: 5, basket: 3 })), ['trail', 'pet']);
  assert.deepEqual(nudgesFor(W({ snow: 0.5 }), { ...NEAR_FAR, outdoors: false }), [], 'never indoors');
  // the notebook itself, once a few pages are found and it was never opened
  const some = W({ seen: ['farmhouse', 'barn', 'gazette'] });
  assert.ok(found(some).length >= NOTEBOOK_AFTER);
  assert.deepEqual(nudgesFor(some, at({})), ['notebook']);
  assert.deepEqual(nudgesFor(W({ seen: ['farmhouse', 'barn', 'gazette', 'notebook'] }), at({})), []);
  // never a nudge for a secret, and every nudge has its tip (model/onboarding.ts), said by Fern, with the use key filled in
  for (const id of ['boat', 'skate', 'snow', 'barn', 'campfire', 'trail', 'pet', 'notebook']) {
    const x = HINTS.find((h) => h.id === id);
    assert.ok(x?.nudge && x.who === 'villager:fern' && x.sub.length > 30, id);
  }
});

test('guide: villagers mention an unfound page on every third chat; secrets only from Fern; none once all is found', () => {
  const w = W({ season: 'summer' });
  assert.equal(rumourFor(w, 'villager:posy', 0, '2026-10-02'), null, 'the useful report first');
  assert.equal(rumourFor(w, 'villager:posy', 2, '2026-10-02'), null);
  const r = rumourFor(w, 'villager:posy', 1, '2026-10-02');
  assert.ok(r && r.text.length > 20 && !pageDef(r.page)!.secret);
  // deterministic per villager, chat and day
  assert.deepEqual(rumourFor(w, 'villager:posy', 1, '2026-10-02'), r);
  for (let i = 0; i < 60; i++) {
    for (const who of ['villager:posy', 'villager:bram', 'villager:hazel', 'villager:marigold', 'villager:nimbus']) {
      const x = rumourFor(w, who, 1 + 3 * i, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`);
      assert.notEqual(x?.page, 'grotto', who);
    }
  }
  // in season first: a winter valley with snow talks about snowmen or skating, not the hauled-up rowboat
  const win = W({ season: 'winter', snow: 1, ice: 1 });
  for (let i = 0; i < 30; i++) assert.notEqual(rumourFor(win, 'villager:fern', 1 + 3 * i, '2026-12-20')?.page, 'rowboat');
  // everything found: nothing to mention
  const all = W({ seen: [...SEEN_IDS] });
  const everything = PAGES.every((p) => p.found(all));
  if (everything) assert.equal(rumourFor(all, 'villager:fern', 1, '2026-10-02'), null);
});

test('guide: "what\'s new" — never on a first run, the baseline for a profile from before the notebook, then only newer releases', () => {
  const d1 = emptyGuide();
  assert.deepEqual(newsDue(d1, { fresh: true, welcomed: false }), [], 'a first-run profile gets the welcome instead');
  assert.equal(d1.news, LATEST);
  const d2 = emptyGuide();
  const items = newsDue(d2, { fresh: true, welcomed: true });
  assert.ok(items.length > 0 && items.every((f) => f.ver > BASELINE), 'a profile from before the notebook hears about the newer releases');
  assert.equal(d2.news, LATEST);
  assert.deepEqual(newsDue(d2, { fresh: false, welcomed: true }), [], 'once');
  const d3 = { ...emptyGuide(), news: LATEST - 1 };
  assert.deepEqual(newsDue(d3, { fresh: false, welcomed: true }).map((f) => f.ver), FEATURES.filter((f) => f.ver === LATEST).map(() => LATEST));
  assert.ok(newsSince(0).length <= NEWS_MAX);
  const l = newsLetter(newsSince(BASELINE), T0, { notebook: 'O', lantern: 'T', wave: 'Z' });
  assert.match(l.body, /Fern/);
  assert.doesNotMatch(l.body, /\{\w+\}/, 'keys filled in');
  assert.doesNotMatch(l.body, /grotto|cave|behind the/i, 'the secret stays a rumour');
  // versions only ever grow (they are save keys)
  for (let i = 1; i < FEATURES.length; i++) assert.ok(FEATURES[i].ver >= FEATURES[i - 1].ver);
});

test('guide: the service remembers seen + known, toasts only what is found after load, rate-limits rumours', () => {
  let t = T0;
  let saved: unknown = null;
  const st = { load: () => saved, save: (d: unknown) => { saved = JSON.parse(JSON.stringify(d)); } };
  const g = createGuide(st, { now: () => t });
  const changes: string[] = [];
  g.onChange((c) => changes.push(c.kind === 'found' ? `found:${c.pages.map((p) => p.id).join(',')}` : c.kind));
  // the first snapshot is old news (a profile from before the notebook): known, no toasts
  assert.deepEqual(g.update(W({ seen: [], stamps: { ...emptyStamps(), fests: ['harvest'] } })), []);
  assert.ok(g.data().known.includes('festival'));
  g.see('rowboat');
  assert.deepEqual(g.update(W({})).map((p) => p.id), ['rowboat']);
  assert.deepEqual(g.update(W({})), [], 'once');
  assert.ok(g.view().pages.find((p) => p.def.id === 'rowboat')!.fresh);
  g.read('rowboat');
  assert.ok(!g.view().pages.find((p) => p.def.id === 'rowboat')!.fresh);
  g.read('skate'); // not found: ignored
  assert.ok(!g.data().known.includes('skate'));
  assert.ok(changes.includes('found:rowboat') && changes.includes('seen') && changes.includes('read'));
  // persisted: a reload keeps the seen set and what you've read; nothing is new on the first snapshot
  const g2 = createGuide(st, { now: () => t });
  assert.deepEqual(g2.data().seen, ['rowboat']);
  assert.deepEqual(g2.update(W({})), []);
  assert.ok(!g2.view().pages.find((p) => p.def.id === 'rowboat')!.fresh);
  // a service that turns up late (lazy systems) can't make an old page "new" again: announced once ever
  assert.deepEqual(g2.update(W({ stamps: { ...emptyStamps(), fests: ['harvest'] } })), []);
  assert.deepEqual(g2.update(W({ seen: [], barn: { days: 0, eggs: 0, milk: 0, feeds: 2, brushes: 0 } })).map((p) => p.id), ['barn']);
  // rumours: at most one every few minutes across the village
  const r1 = g2.rumour('villager:fern', 1);
  assert.ok(r1);
  assert.equal(g2.rumour('villager:hazel', 1), null);
  t += RUMOUR_GAP_MS + 1;
  assert.ok(g2.rumour('villager:hazel', 1));
  // news once, then re-postable from data
  const l = g2.news({ welcomed: true, keys: { notebook: 'O' } });
  assert.ok(l && g2.data().letter?.id === l.id);
  assert.equal(g2.news({ welcomed: true }), null);
});

test('guide: parseGuide is tolerant', () => {
  assert.equal(parseGuide(null), null);
  assert.equal(parseGuide({ v: 2 }), null);
  const d = parseGuide({ v: 1, seen: ['rowboat', 'nope', 3, 'rowboat'], known: ['barn', 'zzz'], news: 'x', letter: { id: 1 } })!;
  assert.deepEqual(d.seen, ['rowboat']);
  assert.deepEqual(d.known, ['barn']);
  assert.equal(d.news, 0);
  assert.equal(d.letter, null);
});

test('guide: the Valley Projects page is found by giving to the board, and counts the restored places', () => {
  const p = pageDef('projects')!;
  assert.equal(p.chapter, 'village');
  assert.ok(MOTIFS.includes(p.motif));
  assert.equal(p.found(W()), false);
  assert.equal(p.found(W({ projects: { v: 1, p: {}, picked: '', total: { bits: 0, items: 0 } } })), false);
  const some = { v: 1 as const, p: { lanterns: { bits: 20, items: {}, work: {}, done: 0, unveiled: 0 } }, picked: '', total: { bits: 20, items: 0 } };
  assert.equal(p.found(W({ projects: some })), true);
  assert.deepEqual(p.notes(W({ projects: some })), ['0 of 6 places restored', 'next up: the lantern path']);
  const done = { ...some, p: { lanterns: { ...some.p.lanterns, done: 1 } } };
  assert.equal(p.notes(W({ projects: done }))[0], '1 of 6 places restored');
  assert.ok(FEATURES.some((f) => f.page === 'projects'));
});
