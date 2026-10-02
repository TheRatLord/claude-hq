import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALBUM_CAP, CAPTION_MAX, DEFAULT_PHOTO_PREFS, FAV_CAP, WHO_MAX, autoCaption, canFavourite, cropRect, cycle, dateLabel, fitSize, focusSubject,
  framedSubjects, hourText, unoccluded, nearestPlace, photoFileName, photoId, pruneFor, sanitizeCaption, sanitizeMeta, sanitizePhotoPrefs, sortNewest,
  timeOfDay, wallKey, wallPicks, whoLine, FILTERS, FRAMES,
} from './album.ts';
import type { PhotoMeta, SubjectCandidate } from './album.ts';

const T0 = new Date(2026, 9, 2, 15, 30, 12).getTime();
const meta = (i: number, o: Partial<PhotoMeta> = {}): PhotoMeta => ({
  id: `p${i}`, at: T0 + i * 1000, hour: 12, season: 'autumn', weather: 'clear', place: 'the windmill', who: [], caption: '', fav: false, favAt: 0,
  filter: 'none', frame: 'none', w: 1600, h: 900, ...o,
});

test('album: captions are printable, single-spaced and capped', () => {
  assert.equal(sanitizeCaption('  Ada\n\tand   Posy\u0000 '), 'Ada and Posy');
  assert.equal(sanitizeCaption(42), '');
  assert.equal(sanitizeCaption('x'.repeat(200)).length, CAPTION_MAX);
  assert.equal(sanitizeCaption('a\u202eb'), 'a b');
  // emoji count as one character each (never split a surrogate pair)
  const e = sanitizeCaption('🌻'.repeat(100));
  assert.equal([...e].length, CAPTION_MAX);
  assert.ok(!/[\ud800-\udbff]$/.test(e));
});

test('album: any stored value becomes a valid record or null', () => {
  assert.equal(sanitizeMeta(null), null);
  assert.equal(sanitizeMeta({ at: 5 }), null);
  assert.equal(sanitizeMeta({ id: 'bad id!', at: 5 }), null);
  assert.equal(sanitizeMeta({ id: 'p1', at: -3 }), null);
  const m = sanitizeMeta({ id: 'p1', at: T0, hour: 99, season: 'monsoon', weather: 'hail', place: '', who: [{ id: 'a', name: ' Ada ', kind: 'alien' }, { id: '', name: 'x' }, 'junk'], caption: 7, fav: 'yes', filter: 'neon', frame: 'polaroid', w: 1e9, h: -1 });
  assert.ok(m);
  assert.equal(m.hour, 24);
  assert.equal(m.season, 'summer');
  assert.equal(m.weather, 'clear');
  assert.equal(m.place, 'the valley');
  assert.deepEqual(m.who, [{ kind: 'farmer', id: 'a', name: 'Ada' }]);
  assert.equal(m.caption, '');
  assert.equal(m.fav, false);
  assert.equal(m.favAt, 0);
  assert.equal(m.filter, 'none');
  assert.equal(m.frame, 'polaroid');
  assert.equal(m.w, 8192);
  assert.equal(m.h, 1);
  // round trip of a good record is the identity
  const good = meta(3, { fav: true, favAt: T0 + 9, who: [{ kind: 'villager', id: 'posy', name: 'Posy' }], caption: 'hello' });
  assert.deepEqual(sanitizeMeta(JSON.parse(JSON.stringify(good))), good);
  // too many subjects are cut
  const many = sanitizeMeta({ ...good, who: Array.from({ length: 20 }, (_, i) => ({ kind: 'farmer', id: `f${i}`, name: `F${i}` })) });
  assert.equal(many?.who.length, WHO_MAX);
});

test('album: ids are unique-ish and time-ordered', () => {
  const a = photoId(T0, 0.1), b = photoId(T0, 0.2), c = photoId(T0 + 1000, 0.1);
  assert.notEqual(a, b);
  assert.match(a, /^p[0-9a-z]+-[0-9a-z]{4}$/);
  assert.ok(sanitizeMeta({ id: a, at: T0 }));
  assert.ok(c > a);
});

test('album: pruning removes the oldest non-favourites, never a favourite', () => {
  const list = Array.from({ length: ALBUM_CAP }, (_, i) => meta(i, { fav: i < 3, favAt: i < 3 ? T0 : 0 }));
  assert.deepEqual(pruneFor(list.slice(0, 10)), []);
  assert.deepEqual(pruneFor(list), ['p3']);
  assert.deepEqual(pruneFor(list, 2), ['p3', 'p4']);
  // a smaller cap
  assert.deepEqual(pruneFor(list.slice(0, 6), 1, 5), ['p3', 'p4']);
  // all favourites: no room
  assert.equal(pruneFor([meta(1, { fav: true }), meta(2, { fav: true })], 1, 2), null);
});

test('album: favourites are capped so the album can always make room', () => {
  const list = Array.from({ length: FAV_CAP + 1 }, (_, i) => meta(i, { fav: i < FAV_CAP, favAt: T0 + i }));
  assert.equal(canFavourite(list, `p${FAV_CAP}`), false);
  assert.equal(canFavourite(list, 'p0'), true);
  assert.equal(canFavourite(list, 'nope'), false);
  assert.ok(FAV_CAP < ALBUM_CAP);
});

test('album: the wall shows the latest favourites first, and its key changes only with them', () => {
  const list = [meta(1, { fav: true, favAt: 10 }), meta(2), meta(3, { fav: true, favAt: 30 }), meta(4, { fav: true, favAt: 20 })];
  assert.deepEqual(wallPicks(list).map((p) => p.id), ['p3', 'p4', 'p1']);
  assert.deepEqual(wallPicks(list, 2).map((p) => p.id), ['p3', 'p4']);
  const k = wallKey(list);
  assert.equal(wallKey(list.map((p) => ({ ...p, caption: 'changed' }))), k);
  assert.notEqual(wallKey(list.map((p) => (p.id === 'p2' ? { ...p, fav: true, favAt: 40 } : p))), k);
  assert.deepEqual(sortNewest(list).map((p) => p.id), ['p4', 'p3', 'p2', 'p1']);
});

test('album: times of day, clock text and dates', () => {
  assert.equal(timeOfDay(2).id, 'night');
  assert.equal(timeOfDay(6).id, 'dawn');
  assert.equal(timeOfDay(9).id, 'morning');
  assert.equal(timeOfDay(12).id, 'midday');
  assert.equal(timeOfDay(15).id, 'afternoon');
  assert.equal(timeOfDay(18).id, 'golden');
  assert.equal(timeOfDay(20).id, 'dusk');
  assert.equal(timeOfDay(21.5).id, 'evening');
  assert.equal(timeOfDay(23.5).id, 'night');
  assert.equal(timeOfDay(-1).id, 'night');
  assert.equal(hourText(18.5), '18:30');
  assert.equal(dateLabel(T0), 'Fri 2 Oct 2026');
});

test('album: places, who and the first caption', () => {
  const places = [{ id: 'windmill', name: 'the windmill', x: 0, z: 0, r: 16 }, { id: 'mailbox', name: 'the mailbox', x: 10, z: 0, r: 5 }];
  assert.equal(nearestPlace(1, 1, places)?.id, 'windmill');
  assert.equal(nearestPlace(9, 0, places)?.id, 'mailbox');     // relative to reach: the small place wins up close
  assert.equal(nearestPlace(100, 0, places), null);
  assert.equal(whoLine([]), '');
  assert.equal(whoLine([{ name: 'Ada' }]), 'Ada');
  assert.equal(whoLine([{ name: 'Ada' }, { name: 'Posy' }]), 'Ada & Posy');
  assert.equal(whoLine([{ name: 'Ada' }, { name: 'Posy' }, { name: 'Biscuit' }]), 'Ada, Posy & Biscuit');
  assert.equal(whoLine([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }]), 'A, B & 3 more');
  const who = [{ kind: 'farmer' as const, id: 'a', name: 'Ada' }, { kind: 'villager' as const, id: 'posy', name: 'Posy' }];
  assert.equal(autoCaption({ who, place: 'the windmill', hour: 18, weather: 'clear' }), 'Ada & Posy at the windmill, at golden hour');
  assert.equal(autoCaption({ who: [], place: 'the windmill', hour: 9, weather: 'rain' }), 'At the windmill, in the rain');
  assert.equal(autoCaption({ who, place: 'inside the farmhouse', hour: 22, weather: 'snow' }), 'Ada & Posy inside the farmhouse, in the snow');
  assert.ok(autoCaption({ who: Array.from({ length: 8 }, (_, i) => ({ kind: 'farmer' as const, id: `${i}`, name: 'x'.repeat(30) })), place: 'the valley', hour: 1, weather: 'clear' }).length <= CAPTION_MAX);
  assert.equal(photoFileName({ at: T0, place: "Ada's field" }), 'claude-valley-20261002-153012-ada-s-field.png');
  assert.equal(photoFileName({ at: T0, place: '!!' }, 'jpg'), 'claude-valley-20261002-153012.jpg');
});

test('album: crops and sizes', () => {
  assert.deepEqual(cropRect(1600, 900, 'none'), { x: 0, y: 0, w: 1600, h: 900 });
  assert.deepEqual(cropRect(1600, 900, 'polaroid'), { x: 350, y: 0, w: 900, h: 900 });
  assert.deepEqual(cropRect(1600, 900, 'postcard'), { x: 125, y: 0, w: 1350, h: 900 });
  assert.deepEqual(cropRect(900, 1600, 'postcard'), { x: 0, y: 500, w: 900, h: 600 });
  assert.deepEqual(fitSize(3200, 1800, 1600), { w: 1600, h: 900 });
  assert.deepEqual(fitSize(800, 600, 1600), { w: 800, h: 600 });
  assert.deepEqual(fitSize(900, 900, 360), { w: 360, h: 360 });
});

test('album: who is in frame, and who is at the crosshair', () => {
  const c = (id: string, sx: number, sy: number, depth: number, size: number): SubjectCandidate => ({ kind: 'farmer', id, name: id.toUpperCase(), sx, sy, depth, size });
  const got = framedSubjects([c('a', 0.5, 0.5, 5, 0.3), c('b', 1.3, 0.5, 5, 0.3), c('c', 0.2, 0.6, -2, 0.3), c('d', 0.4, 0.4, 90, 0.2), c('e', 0.6, 0.5, 30, 0.01), c('f', 0.7, 0.5, 8, 0.2), c('a', 0.5, 0.5, 5, 0.1)]);
  assert.deepEqual(got.map((x) => x.id), ['a', 'f']);
  assert.equal(framedSubjects(Array.from({ length: 20 }, (_, i) => c(`x${i}`, 0.5, 0.5, 4, 0.2))).length, WHO_MAX);
  assert.equal(focusSubject([c('a', 0.9, 0.5, 5, 0.2), c('b', 0.52, 0.48, 6, 0.2), c('c', 0.5, 0.5, 60, 0.2)])?.id, 'b');
  assert.equal(focusSubject([c('a', 0.9, 0.9, 5, 0.2)]), null);
});

test('album: photo-mode prefs survive anything in storage', () => {
  assert.deepEqual(sanitizePhotoPrefs(null), DEFAULT_PHOTO_PREFS);
  assert.deepEqual(sanitizePhotoPrefs({ filter: 'sepia', frame: 'postcard', grid: true, tags: 1, timer: 10, download: true }),
    { filter: 'sepia', frame: 'postcard', grid: true, tags: false, timer: 10, download: true });
  assert.equal(sanitizePhotoPrefs({ timer: 7 }).timer, 0);
  assert.equal(cycle(FILTERS.map((f) => f.id), 'tilt'), 'none');
  assert.equal(cycle(FRAMES.map((f) => f.id), 'none', -1), 'postcard');
  assert.equal(cycle(['a', 'b'], 'zzz'), 'a');
});

test('album: people standing behind someone nearer are not in the picture', () => {
  const c = (id: string, sx: number, sy: number, depth: number, size: number, hw: number): SubjectCandidate => ({ kind: 'farmer', id, name: id, sx, sy, depth, size, hw });
  const front = c('front', 0.5, 0.4, 4, 0.4, 0.15);
  const behind = c('behind', 0.45, 0.45, 9, 0.18, 0.06);   // head inside the front one's body box, 5 m further
  const beside = c('beside', 0.8, 0.45, 9, 0.18, 0.06);
  const above = c('above', 0.5, 0.2, 12, 0.1, 0.03);        // head above the front one's head: visible
  const close = c('close', 0.52, 0.5, 4.5, 0.36, 0.14);      // less than a metre behind: side by side
  assert.deepEqual(unoccluded([front, behind, beside, above, close]).map((x) => x.id), ['front', 'beside', 'above', 'close']);
  assert.deepEqual(framedSubjects([behind, front]).map((x) => x.id), ['front']);
  // without widths nobody hides anybody
  assert.equal(unoccluded([{ ...front, hw: undefined }, behind]).length, 2);
});

test('album: garbage in storage never throws and always yields valid records / prefs', () => {
  const junk: unknown[] = [undefined, null, 0, -1, NaN, '', 'x', [], {}, { id: 5 }, { id: 'p1', at: '5' }, { id: 'p1', at: 5, who: 'all' }, { id: 'p1', at: 5, who: [null, 1, { id: 'a' }] },
    { id: 'p1', at: 5, caption: { a: 1 } }, { id: 'p1', at: Infinity }, { filter: 7, frame: [], timer: '3' }, JSON.parse('{"__proto__": {"fav": true}, "id": "p1", "at": 9}')];
  for (const j of junk) {
    const m = sanitizeMeta(j);
    if (m) { assert.equal(typeof m.caption, 'string'); assert.ok(Array.isArray(m.who)); assert.equal(m.fav, false); assert.deepEqual(sanitizeMeta(m), m); }
    const p = sanitizePhotoPrefs(j);
    assert.deepEqual(sanitizePhotoPrefs(p), p);
  }
});
