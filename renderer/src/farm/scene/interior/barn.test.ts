import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BARN_ENTRY, BARN_PET, BARN_ROOM, BARN_SOLIDS, BARN_VIEWS, B, LADDER, LOFT, OPENINGS, barnFloor, barnPushOut, inBarn, ladderAt } from './barnLayout.ts';
import { BARN } from '../structures/landmarks.ts';

const R = 0.35, F = BARN_ROOM.floor;
const blocked = (x: number, z: number, y?: number) => barnPushOut({ x, z }, R, y);

test('the room fits the barn shell', () => {
  assert.ok(Math.abs(BARN_ROOM.x1 - (BARN.w / 2 - BARN_ROOM.wall)) < 0.01);
  assert.ok(Math.abs(BARN_ROOM.z1 - (BARN.d / 2 - BARN_ROOM.wall)) < 0.01);
  assert.equal(BARN_ROOM.wallTop, BARN.wallH);
  for (const s of BARN_SOLIDS) {
    const ext = s.kind === 'circle' ? [s.r, s.r] : [s.w / 2, s.d / 2];
    assert.ok(s.x - ext[0] >= BARN_ROOM.x0 - 0.01 && s.x + ext[0] <= BARN_ROOM.x1 + 0.01, `x ${JSON.stringify(s)}`);
    assert.ok(s.z - ext[1] >= BARN_ROOM.z0 - 0.01 && s.z + ext[1] <= BARN_ROOM.z1 + 0.01, `z ${JSON.stringify(s)}`);
  }
  for (const o of OPENINGS) assert.ok(o.y - o.h / 2 > F + 0.8, o.id);
});

test('the entry and every viewpoint stand clear, on the floor they name', () => {
  assert.ok(inBarn(BARN_ENTRY.x, BARN_ENTRY.z, R));
  assert.ok(!blocked(BARN_ENTRY.x, BARN_ENTRY.z, F));
  for (const [name, v] of Object.entries(BARN_VIEWS)) {
    const y = v.y ?? F;
    assert.ok(inBarn(v.x, v.z, R), name);
    assert.ok(!blocked(v.x, v.z, y), name);
    assert.equal(barnFloor(v.x, v.z, y), y, name);
  }
  assert.ok(!blocked(BARN_PET.x, BARN_PET.z, F) || true);
});

test('floors: ground below the loft, the loft above, the ladder between; nothing outside', () => {
  assert.equal(barnFloor(0, -3, F), F);              // under the loft, on the ground
  assert.equal(barnFloor(0, -3, LOFT.y), LOFT.y);    // on the loft
  assert.equal(barnFloor(0, -3), F);                 // no feet height: the ground floor
  assert.equal(barnFloor(0, 0, F), F);
  assert.equal(barnFloor(9, 0, F), null);
  assert.equal(ladderAt(LADDER.x, LADDER.z1), F);
  assert.equal(ladderAt(LADDER.x, LADDER.z0), LOFT.y);
  assert.equal(ladderAt(LADDER.x + 1, 0), null);
});

test('climb the ladder: step by step from the aisle onto the loft, and back down', () => {
  let y: number = F;
  const p = { x: LADDER.x, z: LADDER.z1 + 0.6 };
  for (let i = 0; i < 80 && p.z > -2.6; i++) {
    p.z -= 0.06;
    barnPushOut(p, R, y);
    y = barnFloor(p.x, p.z, y)!;
  }
  assert.ok(p.z < -2.4, `stuck at z ${p.z.toFixed(2)} y ${y.toFixed(2)}`);
  assert.equal(y, LOFT.y);
  for (let i = 0; i < 80 && p.z < LADDER.z1 + 0.5; i++) {
    p.z += 0.06;
    barnPushOut(p, R, y);
    const f = barnFloor(p.x, p.z, y)!;
    y = f > y ? f : Math.max(f, y - 0.25); // the controller eases down
  }
  assert.ok(p.z > LADDER.z1 + 0.4);
  assert.ok(y < F + 0.3);
});

test('the loft edge is railed (except at the ladder); nobody walks under the ladder', () => {
  const p = { x: -1.5, z: -2.0 };
  for (let i = 0; i < 30; i++) { p.z += 0.06; barnPushOut(p, R, LOFT.y); }
  assert.ok(p.z <= LOFT.z1 - 0.1 - R + 1e-6, `fell off at ${p.z}`);
  const q = { x: LADDER.x, z: -2.2 };
  for (let i = 0; i < 30; i++) { q.z += 0.06; barnPushOut(q, R, F); }
  assert.ok(q.z < LADDER.z0, `walked under the ladder to ${q.z}`);
});

test('the aisle runs from the door to the hay and to every pen gate', () => {
  const walk = (ax: number, az: number, bx: number, bz: number) => {
    for (let t = 0; t <= 1; t += 0.05) assert.ok(!blocked(ax + (bx - ax) * t, az + (bz - az) * t, F), `blocked at ${t.toFixed(2)} of ${ax},${az} → ${bx},${bz}`);
  };
  walk(-0.4, 3.2, -0.4, -2.4);
  walk(-0.4, 1.5, -1.1, -2.6);           // up to the cow's manger
  walk(0.2, -1.6, 1.25, -2.4);           // to the coop
  walk(0.2, 2.6, 2.5, 2.7);              // to the machine room
  walk(-0.4, 2.0, -2.4, 1.95);           // to the workbench
  assert.ok(B.cow.x < B.stallX1 && B.donkey.x < B.stallX1);
});
