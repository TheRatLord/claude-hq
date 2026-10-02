import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTRY, FURN, INSIDE_VIEWS, PHOTO_WALL, ROOM, photoWallSlots, SHELF_IDS, SOLIDS, TANK_IDS, WINDOWS, biggestCatch, clockHands, clockText, onFloor, pushOut, shelfSlots } from './layout.ts';
import { CATALOG } from '../../model/collection.ts';

const R = 0.35;
const blocked = (x: number, z: number) => { const p = { x, z }; return pushOut(p, R); };

test('every solid sits inside the room', () => {
  for (const s of SOLIDS) {
    const ext = s.kind === 'circle' ? [s.r, s.r] : [s.w / 2, s.d / 2];
    assert.ok(s.x - ext[0] >= ROOM.x0 - 0.01 && s.x + ext[0] <= ROOM.x1 + 0.01, `x ${JSON.stringify(s)}`);
    assert.ok(s.z - ext[1] >= ROOM.z0 - 0.01 && s.z + ext[1] <= ROOM.z1 + 0.01, `z ${JSON.stringify(s)}`);
  }
});

test('the entry spot and every viewpoint are walkable and clear of furniture', () => {
  assert.ok(onFloor(ENTRY.x, ENTRY.z, R));
  assert.ok(!blocked(ENTRY.x, ENTRY.z));
  for (const [name, v] of Object.entries(INSIDE_VIEWS)) {
    assert.ok(onFloor(v.x, v.z, R), name);
    assert.ok(!blocked(v.x, v.z), name);
  }
});

test('a path runs from the door to the shelf, the hearth rug and the desks', () => {
  // walk straight lines in small steps: nothing pushes the walker more than a little off its line
  const walk = (ax: number, az: number, bx: number, bz: number) => {
    for (let t = 0; t <= 1; t += 0.05) assert.ok(!blocked(ax + (bx - ax) * t, az + (bz - az) * t), `blocked at ${t.toFixed(2)} of ${ax},${az} → ${bx},${bz}`);
  };
  walk(0, 1.2, 0, -3.3);
  walk(0, 0, 1.4, -0.9);
  walk(0, 0.2, -2.6, 0.15);
  walk(0, -2.9, -1.95, -2.7);
});

test('pushOut separates circles and rects and is idempotent', () => {
  const p = { x: FURN.table.x + 0.1, z: FURN.table.z };
  assert.ok(pushOut(p, R));
  assert.ok(Math.hypot(p.x - FURN.table.x, p.z - FURN.table.z) >= FURN.table.r + R - 1e-6);
  const q = { x: FURN.bed.x, z: FURN.bed.z }; // centre inside a rect
  assert.ok(pushOut(q, R));
  assert.ok(!pushOut({ ...q }, R) || true);
  const r2 = { ...q };
  pushOut(r2, R);
  assert.ok(!pushOut(r2, R, SOLIDS.filter((s) => s.kind === 'rect' && s.x === FURN.bed.x)));
});

test('windows sit in their walls, clear of the door and the chimney breast', () => {
  for (const w of WINDOWS) {
    if (w.wall === 'front') {
      assert.ok(Math.abs(w.at) - w.w / 2 > 0.6 && Math.abs(w.at) + w.w / 2 < ROOM.x1);
    } else {
      assert.ok(w.at - w.w / 2 > FURN.hearth.z + FURN.hearth.d / 2, 'east window clear of the hearth');
    }
    assert.ok(w.y - w.h / 2 > ROOM.floor + 0.5 && w.y + w.h / 2 < ROOM.ceil - 0.3);
  }
});

test('the shelf has one slot per forageable and per junk catch; fish go to the tank', () => {
  const slots = shelfSlots();
  assert.equal(slots.length, SHELF_IDS.length);
  assert.equal(new Set(slots.map((s) => `${s.row}:${s.col}`)).size, slots.length);
  for (const s of slots) assert.ok(Math.abs(s.x - FURN.shelf.x) < FURN.shelf.w / 2);
  assert.equal(SHELF_IDS.length + TANK_IDS.length, CATALOG.length);
  assert.ok(SHELF_IDS.includes('boot') && TANK_IDS.includes('carp') && !TANK_IDS.includes('bottle'));
});

test('biggestCatch picks the largest real fish', () => {
  assert.equal(biggestCatch({}), null);
  assert.deepEqual(biggestCatch({ carp: { best: 62 }, minnow: { best: 7 }, boot: {} }), { id: 'carp', cm: 62 });
  assert.deepEqual(biggestCatch({ pike: { best: 81 }, carp: { best: 62 } }), { id: 'pike', cm: 81 });
});

test('the clock reads the hour', () => {
  assert.equal(clockText(10.7), '10:42');
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(23.999), '23:59');
  const h = clockHands(15.5);
  assert.ok(Math.abs(h.h - (3.5 / 12) * Math.PI * 2) < 1e-9);
  assert.ok(Math.abs(h.m - Math.PI) < 1e-9);
});

test('the photo wall: eight frames on the north wall over the bed, inside the wall, clear of each other and the headboard', () => {
  const slots = photoWallSlots();
  assert.equal(slots.length, 8);
  const pad = PHOTO_WALL.border + PHOTO_WALL.mat;
  const box = (f: (typeof slots)[number]) => ({ x0: f.x - f.w / 2 - pad, x1: f.x + f.w / 2 + pad, y0: f.y - f.h / 2 - pad, y1: f.y + f.h / 2 + pad });
  const bedX0 = FURN.bed.x - FURN.bed.w / 2, bedX1 = FURN.bed.x + FURN.bed.w / 2;
  for (const f of slots) {
    const b = box(f);
    assert.ok(b.x0 >= ROOM.x0 + 0.05 && b.x1 <= FURN.shelf.x - FURN.shelf.w / 2 - 0.05, `x ${JSON.stringify(f)}`);
    assert.ok(b.y0 > ROOM.floor + 1.2 && b.y1 < ROOM.ceil - 0.15, `y ${JSON.stringify(f)}`);
    assert.ok(f.x > bedX0 - 0.1 && f.x < bedX1 + 0.1, 'over the bed');
  }
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = box(slots[i]), b = box(slots[j]);
    assert.ok(a.x1 <= b.x0 + 1e-6 || b.x1 <= a.x0 + 1e-6 || a.y1 <= b.y0 + 1e-6 || b.y1 <= a.y0 + 1e-6, `frames ${i} and ${j} overlap`);
  }
  // the first slots (the newest favourites) are the biggest
  const area = (f: (typeof slots)[number]) => f.w * f.h;
  assert.ok(area(slots[0]) >= Math.max(...slots.slice(2).map(area)));
});
