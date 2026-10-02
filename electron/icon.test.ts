import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodePng, iconPng, paintIcon } from './icon.ts';

const px = (rgba: Uint8Array, size: number, x: number, y: number) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

test('icon: Clawd in orange, transparent corners, a gold badge for asks, a blue dot for finishes', () => {
  const plain = paintIcon(64, { need: 0, done: false });
  assert.deepEqual(px(plain, 64, 30, 18), [0xd9, 0x77, 0x57, 255], 'body');
  assert.deepEqual(px(plain, 64, 22, 26), [0x2a, 0x1a, 0x10, 255], 'eye');
  assert.equal(px(plain, 64, 0, 0)[3], 0, 'corner transparent');
  assert.equal(px(plain, 64, 60, 4)[3], 0, 'no badge');
  const asks = paintIcon(64, { need: 3, done: false });
  assert.deepEqual(px(asks, 64, 50, 4), [0xf0, 0xa7, 0x2c, 255], 'gold badge');
  const done = paintIcon(64, { need: 0, done: true });
  assert.deepEqual(px(done, 64, 52, 12), [0x3f, 0x95, 0xd8, 255], 'blue dot');
  // the count is drawn: some dark pixels inside the badge disc, different for 1 and 9+
  const dark = (a: Uint8Array) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] === 0x3a && a[i + 1] === 0x24) n++; return n; };
  assert.ok(dark(paintIcon(64, { need: 1, done: false })) > 10);
  assert.notEqual(dark(paintIcon(64, { need: 1, done: false })), dark(paintIcon(64, { need: 12, done: false })));
  const overlay = paintIcon(16, { need: 2, done: false }, { badgeOnly: true });
  assert.equal(px(overlay, 16, 8, 1)[3], 255, 'overlay is all badge');
  assert.equal(paintIcon(16, { need: 0, done: false }, { badgeOnly: true }).every((v) => v === 0), true, 'no overlay when quiet');
});

test('PNG encoding round-trips (signature, IHDR, IDAT rows) and is memoised', () => {
  const size = 16;
  const rgba = paintIcon(size, { need: 4, done: false });
  const png = encodePng(rgba, size, size);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString('latin1', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png[24], 8); assert.equal(png[25], 6);
  const idatLen = png.readUInt32BE(33);
  assert.equal(png.toString('latin1', 37, 41), 'IDAT');
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, (size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    assert.equal(raw[y * (size * 4 + 1)], 0, 'filter: none');
    assert.deepEqual([...raw.subarray(y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1))], [...rgba.subarray(y * size * 4, (y + 1) * size * 4)]);
  }
  assert.equal(png.toString('latin1', png.length - 8, png.length - 4), 'IEND');
  assert.equal(iconPng(32, { need: 2, done: true }), iconPng(32, { need: 2, done: true }), 'same buffer');
  assert.equal(iconPng(32, { need: 11, done: false }), iconPng(32, { need: 40, done: false }), 'everything past nine looks alike');
});
