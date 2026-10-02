// The art mascots (model/mascots.ts ART → scene/farmers/mascots.ts artPlan / artBody): well-formed grids, sane
// plans, distinct silhouettes and colours, a vendor → mascot table, and portraits drawn from the same grids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ART, ART_IDS, MASCOTS, cellColor, mascotOf } from '../../model/mascots.ts';
import { CLAWD, CODEX, artBody, artHalfDepth, artPlan, clawdPlan, codexPlan } from './mascots.ts';
import { farmerFace } from '../../hud/icons.ts';
import { VENDORS } from '../../../../../shared/vendors.ts';

test('art grids: rectangular, two eyes, two feet, arms on both sides, symmetric enough to stand', () => {
  for (const id of ART_IDS) {
    const g = ART[id].front;
    assert.equal(new Set(g.map((r) => r.length)).size, 1, `${id}: ragged rows ${g.map((r) => r.length)}`);
    const cells = (ch: string) => g.flatMap((r, y) => [...r].map((c, x) => (c === ch ? [x, y] : null)).filter(Boolean)) as number[][];
    assert.equal(cells('E').length, 2, `${id}: two eyes`);
    const w = g[0].length, mid = w / 2;
    for (const ch of ['a', 'f']) {
      const left = cells(ch).filter(([x]) => x + 0.5 < mid).length, right = cells(ch).filter(([x]) => x + 0.5 > mid).length;
      assert.ok(left > 0 && left === right, `${id}: ${ch} on both sides (${left}/${right})`);
    }
    for (const r of g) for (const ch of r) assert.ok('.#Eaf'.includes(ch) || ch in ART[id].pal, `${id}: '${ch}' has no colour`);
    for (const e of ART[id].extras ?? []) assert.ok(e[6] in ART[id].pal, `${id}: extra colour ${e[6]}`);
  }
});

test('art plans: finite, standing on two feet, ~1 m tall like Clawd and Codex, eyes on the front, hat on top', () => {
  const ref = [clawdPlan(), codexPlan()].map((p) => p.h + p.legLen);
  for (const id of ART_IDS) {
    const p = artPlan(id);
    const flat = (o: unknown): number[] => (typeof o === 'number' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(flat) : []);
    assert.ok(flat(p).every(Number.isFinite), `${id}: non-finite plan`);
    assert.equal(p.hips.length, 2, id);
    assert.ok(p.legLen > 0.05 && p.legLen < 0.25, `${id}: legLen ${p.legLen}`);
    const tall = p.h + p.legLen;
    assert.ok(tall > Math.min(...ref) * 0.85 && tall < Math.max(...ref) * 1.25, `${id}: ${tall.toFixed(2)} m tall (Clawd/Codex ${ref.map((r) => r.toFixed(2))})`);
    assert.ok(p.w > 0.6 && p.w < 1.4, `${id}: ${p.w.toFixed(2)} m wide`);
    assert.ok(p.glyphs[0].x < p.glyphs[1].x, `${id}: left eye first`);
    for (const e of p.glyphs) assert.ok(e.z > 0 && e.y > p.h * 0.3 && e.y < p.h, `${id}: eye at ${JSON.stringify(e)}`);
    assert.ok(Math.abs(p.hat.x) < p.w / 2 && p.hat.y <= p.h + 1e-9 && p.hat.y > p.h * 0.6 && p.hat.s > 0.4, `${id}: hat ${JSON.stringify(p.hat)}`);
    assert.ok(p.armLen > 0.08 && p.armW > 0.05 && p.shoulder.x > 0, `${id}: arms`);
    for (const k of ['x', 'y', 'z'] as const) assert.ok(p.foot[k] > 0.4 && p.foot[k] < 2, `${id}: foot scale ${k} ${p.foot[k]}`);
  }
});

test('art bodies: stand on y = 0, carry a neckerchief, puff up from the rim (unless a crisp prism), stay a few thousand cells', () => {
  for (const id of ART_IDS) {
    const v = artBody(id);
    const ys = [...v.cells.values()].map((c) => c.y);
    assert.equal(Math.min(...ys), 0, `${id}: bottom row at 0`);
    assert.ok(v.cells.size > 300 && v.cells.size < 6000, `${id}: ${v.cells.size} cells`);
    assert.ok(v.boxes.some((b) => b.slot === 3), `${id}: neckerchief in slot 3`);
    const H = artHalfDepth(id), flat = H.flat().filter((h) => h > 0);
    if (ART[id].depth[0] < ART[id].depth[1]) assert.ok(Math.max(...flat) > Math.min(...flat), `${id}: puffy, not a slab`);
    const m = v.mesh(ART[id].u);
    assert.ok(m.count > 0 && m.count < 60_000, `${id}: ${m.count} vertices`);
    for (let i = 0; i < m.position.length; i++) assert.ok(Number.isFinite(m.position[i]));
  }
});

/** a front mask scaled into a 12×12 box, for silhouette comparison */
function mask(rows: readonly string[], solid: (ch: string) => boolean): boolean[] {
  const h = rows.length, w = rows[0].length, out: boolean[] = [];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) out.push(solid(rows[Math.floor(((y + 0.5) / 12) * h)][Math.floor(((x + 0.5) / 12) * w)]));
  return out;
}

test('every mascot has its own silhouette and its own body colour', () => {
  const masks = new Map<string, boolean[]>([
    ['clawd', mask(CLAWD.front, (c) => c !== '.')], ['codex', mask(CODEX.front, (c) => c !== '.')],
    ...ART_IDS.map((id): [string, boolean[]] => [id, mask(ART[id].front, (c) => c !== '.')]),
  ]);
  const ids = [...masks.keys()];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = masks.get(ids[i])!, b = masks.get(ids[j])!;
    let inter = 0, union = 0;
    a.forEach((v, k) => { if (v && b[k]) inter++; if (v || b[k]) union++; });
    assert.ok(inter / union < 0.86, `${ids[i]} and ${ids[j]} silhouettes overlap ${(inter / union).toFixed(2)}`);
  }
  const rgb = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const cols: [string, number][] = [['clawd', 0xd97757], ['codex', 0xf4f1ea], ...ART_IDS.map((id): [string, number] => [id, ART[id].colors.body])];
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    const [a, b] = [rgb(cols[i][1]), rgb(cols[j][1])];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(d > 45, `${cols[i][0]} and ${cols[j][0]} body colours too close (${d.toFixed(0)})`);
  }
});

test('mascotOf: every vendor with a mascot gets it, the rest are sprout-bots, Clawd only for Claude', () => {
  assert.equal(mascotOf('claude'), 'clawd');
  assert.equal(mascotOf('claude', 'claude'), 'clawd');
  assert.equal(mascotOf('codex', 'codex'), 'codex');
  assert.equal(mascotOf('gemini'), 'gemini');
  assert.equal(mascotOf('agent'), 'bot');
  assert.equal(mascotOf('agent', null), 'bot');
  for (const v of VENDORS) {
    const m = mascotOf('agent', v);
    assert.ok((MASCOTS as readonly string[]).includes(m), v);
    if ((ART_IDS as readonly string[]).includes(v)) assert.equal(m, v);
    else if (v !== 'claude' && v !== 'codex') assert.equal(m, 'bot', v);
  }
  assert.notEqual(mascotOf('agent', 'brand-new'), 'clawd');
});

test('art portraits draw the same grid and colours as the 3D bodies', () => {
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const count = (svg: string, c: number) => svg.split(`fill="${hex(c)}"`).length - 1;
  for (const id of ART_IDS) {
    const a = ART[id];
    const svg = farmerFace(0, id);
    let body = 0;
    a.front.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'a' || cellColor(a, y, x) === a.colors.body) body++; }));
    // + extras that happen to be body-coloured
    body += (a.extras ?? []).filter((e) => e[8] === 'front' && a.pal[e[6]] === a.colors.body).length;
    assert.equal(count(svg, a.colors.body), body, `${id}: body cells`);
    assert.equal(count(svg, a.colors.glyph), 2, `${id}: two eyes`);
    assert.ok(farmerFace(0, id, 'opus').length > svg.length, `${id}: wears a hat`);
    assert.equal(farmerFace(0, 'agent'), farmerFace(0, 'bot'));
  }
});
