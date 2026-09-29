import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, gib, rate, pct, temp, uptime, memFigures, diskFigures, series, stateGroups, boardNames, rowNames, statesLayout, weatherStep, logRate, levelColor, GiB } from './format.ts';
import { GLYPHS, dotWidth, PIXEL_CLAWD } from './dotfont.ts';

test('number formatting', () => {
  assert.equal(num(5.07), '5.1');
  assert.equal(num(12.4), '12');
  assert.equal(num(null), '--');
  assert.equal(gib(6.5 * GiB), '6.5');
  assert.equal(rate(0), '0 B/s');
  assert.equal(rate(56512), '55 KB/s');
  assert.equal(rate(1376982), '1.3 MB/s');
  assert.equal(pct(8.4), '8%');
  assert.equal(temp(68.9), '69°C');
  assert.equal(temp(null), '--');
});

test('uptime', () => {
  assert.deepEqual(uptime(665834), { days: 7, text: '7d 16h', hhmm: '16:57' });
  assert.equal(uptime(3700).text, '1h 1m');
});

test('memFigures matches `free` semantics (used = total − available, 1024³ GB)', () => {
  const m = memFigures({ total: 30302523392, used: 6486159360, cache: 8830517248, swapTotal: 8589930496, swapUsed: 1942720512 });
  assert.ok(m);
  assert.equal(m.label, '6.0 / 28 GB');
  assert.ok(Math.abs(m.usedF - 0.214) < 0.001);
  assert.ok(m.cacheF > m.usedF && m.cacheF <= 1);
  assert.ok(Math.abs(m.swapF - 0.226) < 0.001);
  assert.equal(memFigures(null), null);
});

test('diskFigures: largest first, df -h style label', () => {
  const d = diskFigures([
    { mount: '/boot', total: 2040373248, used: 210587648 },
    { mount: '/', total: 2012431163392, used: 209049333760 },
    { mount: '/x', total: 0, used: 0 },
  ]);
  assert.deepEqual(d.map((x) => x.mount), ['/', '/boot']);
  assert.equal(d[0].label, '195 / 1874 GB');
  assert.equal(d[1].label, '0.2 / 2 GB');
});

test('series: last n samples, nulls → 0', () => {
  const h = Array.from({ length: 400 }, (_, i) => ({ v: i % 3 === 1 ? null : i }));
  const s = series(h, (x) => x.v);
  assert.equal(s.length, 300);
  assert.equal(s[s.length - 1], 399);
  assert.equal(s[s.length - 3], 0);
});

test('stateGroups: blocked / working / done (unacked) / idle / shells, oldest first', () => {
  const g = stateGroups([
    { name: 'b2', status: 'blocked', statusSince: 20 }, { name: 'b1', status: 'blocked', statusSince: 10 },
    { name: 'w', status: 'working' }, { name: 'd', status: 'done' }, { name: 'da', status: 'done', ack: { at: 1 } },
    { name: 's', kind: 'shell', status: 'unknown' }, { name: 'i', status: 'idle' },
  ]);
  assert.deepEqual(g.blocked.map((e) => e.name), ['b1', 'b2']);
  assert.deepEqual(g.done.map((e) => e.name), ['d']);
  assert.deepEqual(g.idle.map((e) => e.name).sort(), ['da', 'i']);
  assert.deepEqual(g.shell.map((e) => e.name), ['s']);
});

test('weather: heat needs 30 s over 80%, eases in over 20 s; fog when swap > 25%', () => {
  const W = { heatFor: 0, heat: 0, fog: 0 };
  const hot = { temps: { cpu: 85 }, cpu: { total: 50, load: [1] }, mem: { swapTotal: 100, swapUsed: 10 } };
  for (let i = 0; i < 29; i++) weatherStep(W, hot, 1);
  assert.equal(W.heat, 0);
  for (let i = 0; i < 11; i++) weatherStep(W, hot, 1);
  assert.ok(W.heat > 0.4 && W.heat < 0.6, String(W.heat));
  for (let i = 0; i < 30; i++) weatherStep(W, hot, 1);
  assert.equal(W.heat, 1);
  assert.equal(W.fog, 0);
  const swappy = { ...hot, temps: { cpu: 40 }, mem: { swapTotal: 100, swapUsed: 40 } };
  for (let i = 0; i < 20; i++) weatherStep(W, swappy, 1);
  assert.equal(W.fog, 1);
  assert.equal(W.heat, 0);
});

test('logRate / levelColor', () => {
  assert.equal(logRate(0), 0);
  assert.equal(logRate(1e8), 1);
  assert.ok(logRate(1e5) > 0.3 && logRate(1e5) < 0.5);
  assert.equal(levelColor(0.1), '#7FE3A0');
  assert.equal(levelColor(0.95), '#EF5A4C');
});

test('dot-matrix glyphs: 5×7 rows, full digit set, pixel Clawd frames align', () => {
  for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.:/%-°') {
    assert.ok(GLYPHS[ch], ch);
    assert.equal(GLYPHS[ch].length, 7);
    for (const r of GLYPHS[ch]) assert.ok(r >= 0 && r < 32);
  }
  assert.equal(dotWidth('42%'), 17);
  for (const f of PIXEL_CLAWD) { assert.equal(f.length, 9); for (const r of f) assert.equal(r.length, 13); }
});

test('boardNames: duplicate names get " · 2" in stable id order; unique names untouched; no collisions', () => {
  const m = boardNames([
    { id: 'd1:p10', name: 'claude' }, { id: 'd1:p2', name: 'claude' }, { id: 'd1:p3', name: 'gale' },
    { id: 'd1:p4', name: 'ledger' }, { id: 'd1:p5', name: 'tinker' }, { id: 'd1:p6', name: 'tinker · 2' }, { id: 'd1:p7', name: 'tinker' },
  ]);
  assert.equal(m.get('d1:p2'), 'claude');
  assert.equal(m.get('d1:p10'), 'claude · 2');
  assert.equal(m.get('d1:p3'), 'gale');
  assert.equal(m.get('d1:p6'), 'tinker · 2');
  assert.equal(m.get('d1:p7'), 'tinker · 3');
  assert.equal(new Set(m.values()).size, 7);
});

test('statesLayout: only populated rows, scaled to fill; empty states fold into one line', () => {
  const rows = [{ key: 'blocked', w: 1.3 }, { key: 'done', w: 1.1 }, { key: 'working', w: 1.1 }, { key: 'idle', w: 0.85 }, { key: 'shell', w: 0.8 }];
  const trio = { blocked: [], done: [1], working: [1, 2], idle: [], shell: [1] };
  const L = statesLayout(rows, trio, 76, 557, { foldH: 62, maxRowH: 200 });
  assert.deepEqual(L.rows.map((r) => r.key), ['done', 'working', 'shell']);
  assert.ok(L.fold);
  assert.deepEqual(L.fold.keys, ['blocked', 'idle']);
  assert.ok(L.rows.every((r) => r.h > 100), "three rows share the face: taller than the 12-agent rows (~90 px)");
  const last = L.rows[L.rows.length - 1];
  assert.ok(last.y + last.h <= L.fold.y + 1e-6);
  const full = statesLayout(rows, { blocked: [1], done: [1], working: [1], idle: [1], shell: [1] }, 76, 557);
  assert.equal(full.fold, null);
  assert.ok(Math.abs(full.rows.reduce((s, r) => s + r.h, 0) - (557 - 76)) < 1e-6);
  const busy = statesLayout(rows, { blocked: [1], done: [1, 2], working: [1, 2, 3, 4, 5], idle: [1, 2], shell: [1, 2] }, 76, 557);
  const rowH = (key: string) => { const r = busy.rows.find((x) => x.key === key); assert.ok(r); return r.h; };
  assert.ok(rowH('working') > rowH('idle') * 1.5, 'the crowded row gets more room');
  assert.ok(busy.rows[0].key === 'blocked' && busy.rows[0].h > rowH('done'), 'a lone blocked name still outranks two done ones');
  const one = statesLayout(rows, { blocked: [1], done: [], working: [], idle: [], shell: [] }, 76, 557, { maxRowH: 200 });
  assert.equal(one.rows[0].h, 200);
});

test('rowNames: same-named agents in a row merge to "name ×N" in first-seen order; unique names untouched', () => {
  assert.deepEqual(rowNames([{ id: '1', name: 'dev' }, { id: '2', name: 'dev' }]), ['dev ×2']);
  assert.deepEqual(rowNames([{ id: '1', name: 'gale' }, { id: '2', name: 'claude' }, { id: '3', name: 'claude' }, { id: '4', name: 'claude' }, null]), ['gale', 'claude ×3']);
  assert.deepEqual(rowNames([{ id: 'x9' }]), ['x9']);
  assert.deepEqual(rowNames([]), []);
});
