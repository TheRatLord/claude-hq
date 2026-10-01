import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FESTIVALS, dayText, festivalAt, festivalById, inDaysText, isFestivalId } from './calendar.ts';
import { skyAt } from './sky.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

test('calendar: the harvest festival runs from the equinox to mid October', () => {
  const v = festivalAt(at(2026, 10, 1));
  assert.equal(v.active?.id, 'harvest');
  assert.equal(v.active?.name, 'Harvest Festival');
  assert.equal(v.active?.start, '2026-09-22');
  assert.equal(v.active?.end, '2026-10-14');
  assert.equal(v.active?.day, 10);
  assert.equal(v.active?.days, 23);
  assert.equal(v.active?.forced, false);
  assert.ok(v.active?.deco.includes('prizePumpkin'));
  // next up: Hallowtide on the 24th
  assert.deepEqual([v.next?.id, v.next?.inDays, v.next?.start], ['hallowtide', 23, '2026-10-24']);
  assert.equal(festivalAt(at(2026, 9, 22, 0)).active?.day, 1);
  assert.equal(festivalAt(at(2026, 10, 14, 23)).active?.id, 'harvest');
  assert.equal(festivalAt(at(2026, 10, 15)).active, null);
});

test('calendar: a short festival wins a day it shares with a long one', () => {
  const v = festivalAt(at(2026, 9, 28));
  assert.equal(v.active?.id, 'founders');
  assert.equal(v.active?.days, 1);
  assert.equal(dayText(v.active!), 'Today only');
  assert.equal(festivalAt(at(2026, 9, 29)).active?.id, 'harvest');
  // while the harvest is on, Founders' Day is "next" until it comes round
  assert.deepEqual([festivalAt(at(2026, 9, 25)).next?.id, festivalAt(at(2026, 9, 25)).next?.inDays], ['founders', 3]);
});

test('calendar: every season has its festival on its dates', () => {
  const cases: [number, number, string | null][] = [
    [4, 24, 'blossom'], [5, 3, 'blossom'], [5, 4, null], [8, 12, 'lantern'], [10, 24, 'hallowtide'], [10, 31, 'hallowtide'],
    [11, 1, 'hallowtide'], [11, 2, null], [12, 1, 'starlight'], [12, 25, 'starlight'], [12, 31, 'newyear'], [1, 1, 'newyear'],
    [1, 2, null], [7, 1, null],
  ];
  for (const [m, d, id] of cases) assert.equal(festivalAt(at(2026, m, d)).active?.id ?? null, id, `${m}/${d}`);
  for (const f of FESTIVALS) assert.ok(f.deco.length > 0 && f.name && f.blurb, f.id);
});

test('calendar: New Year wraps the year, and the next festival wraps too', () => {
  const eve = festivalAt(at(2026, 12, 31, 23));
  assert.equal(eve.active?.id, 'newyear');
  assert.deepEqual([eve.active?.start, eve.active?.end, eve.active?.day, eve.active?.days], ['2026-12-31', '2027-01-01', 1, 2]);
  const day = festivalAt(at(2027, 1, 1, 0));
  assert.deepEqual([day.active?.id, day.active?.start, day.active?.day], ['newyear', '2026-12-31', 2]);
  assert.equal(dayText(day.active!), 'Last day!');
  // early January: nothing on, the Blossom Fair is next, months out
  const jan = festivalAt(at(2027, 1, 10));
  assert.equal(jan.active, null);
  assert.equal(jan.next?.id, 'blossom');
  assert.equal(jan.next?.start, '2027-04-24');
  // Christmas: Starlight, New Year next in 6 days
  const xmas = festivalAt(at(2026, 12, 25));
  assert.deepEqual([xmas.next?.id, xmas.next?.inDays], ['newyear', 6]);
});

test('calendar: days count calendar dates across daylight-saving changes', () => {
  // late March (DST starts in many zones): Blossom Fair is a whole number of days away from any hour
  const a = festivalAt(at(2026, 3, 28, 1)), b = festivalAt(at(2026, 3, 28, 23));
  assert.equal(a.next?.inDays, b.next?.inDays);
  assert.equal(a.next?.inDays, 27);
});

test('calendar: the dev override forces any festival, the sky takes its season', () => {
  const v = festivalAt(at(2026, 10, 1), 'starlight');
  assert.equal(v.active?.id, 'starlight');
  assert.equal(v.active?.forced, true);
  assert.equal(v.active?.day, 1);
  assert.equal(v.active?.start, '2026-12-01');
  assert.notEqual(v.next?.id, 'starlight');
  // forcing the one that is on anyway is just the calendar
  assert.equal(festivalAt(at(2026, 10, 1), 'harvest').active?.forced, false);
  // unknown ids are ignored
  assert.equal(festivalAt(at(2026, 10, 1), 'nope').active?.id, 'harvest');
  assert.ok(isFestivalId('hallowtide') && !isFestivalId('nope'));
  assert.equal(festivalById('lantern')?.season, 'summer');
  const sky = skyAt(at(2026, 10, 1), { festival: 'starlight' });
  assert.equal(sky.season, 'winter');
  assert.equal(sky.festival.active?.id, 'starlight');
  assert.equal(skyAt(at(2026, 10, 1), { festival: 'starlight', season: 'summer' }).season, 'summer');
  assert.equal(skyAt(at(2026, 10, 1)).festival.active?.id, 'harvest');
});

test('calendar: copy helpers', () => {
  assert.equal(inDaysText(1), 'tomorrow');
  assert.equal(inDaysText(5), 'in 5 days');
  assert.equal(dayText(festivalAt(at(2026, 10, 1)).active!), 'Day 10 of 23');
});
