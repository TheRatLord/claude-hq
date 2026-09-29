import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type * as THREE from 'three';
import { parseRefs, parseSections, resolveRefs, buildBriefs, milestoneRows } from './wp-briefs.ts';
import type { Ref } from './wp-briefs.ts';

test('parseRefs handles ranges and qualifiers', () => {
  assert.deepEqual(parseRefs('§3.1–3.2, §4 (all), §11 own rows'), [
    { from: '3.1', to: '3.2' }, { from: '4', to: null }, { from: '11', to: null },
  ]);
});

test('sections: descendants, ranges, fences', () => {
  const md = ['# T', '## 1. A', 'x', '```', '# not a heading', '```', '### 1.1 B', '#### 1.1.1 C', '### 1.2 D', '## 2. E'];
  const secs = parseSections(md);
  assert.deepEqual(secs.map((s) => s.id), [null, '1', '1.1', '1.1.1', '1.2', '2']);
  const ids = (r: Ref[]) => resolveRefs(secs, r).indices.map((k) => secs[k].id);
  assert.deepEqual(ids([{ from: '1.1', to: null }]), ['1.1', '1.1.1']);
  assert.deepEqual(ids([{ from: '1.1', to: '1.2' }]), ['1.1', '1.1.1', '1.2']);
  assert.deepEqual(resolveRefs(secs, [{ from: '9', to: null }]).missing, ['9']);
  assert.deepEqual(ids(parseRefs('§1 intro, §1.2')), ['1', '1.2']);
});

test('milestone appendix: only the WP\'s rows + exit line', () => {
  const md = ['## 11. Milestones', 'How we work.', '### M1: One', '| WP | D |', '|---|---|', '| **AA** | a |', '| **BB** | b |',
    '', '**M1 exit:** done.', '### M2: Two', '| WP | D |', '|---|---|', '| **BB** | b2 |'];
  const out = milestoneRows(md, parseSections(md), 'AA');
  assert.match(out, /\*\*AA\*\* \| a/);
  assert.doesNotMatch(out, /BB/);
  assert.match(out, /M1 exit/);
  assert.doesNotMatch(out, /M2/);
});

test('every § in the DESIGN.md reading map resolves', () => {
  const { out, problems } = buildBriefs(fs.readFileSync(new URL('../docs/DESIGN.md', import.meta.url), 'utf8'));
  assert.deepEqual(problems, []);
  assert.ok(out.size >= 15);
  for (const [name, content] of out) if (name !== 'LEAD.md') assert.match(content, /## 10\. Gotchas/, name);
});

// ---- contract drift (LEAD m2 fix r2): DESIGN.md must describe what the code does ------------------------------------
const DESIGN = () => fs.readFileSync(new URL('../docs/DESIGN.md', import.meta.url), 'utf8');
const num = (t: string) => { const s = t.trim().replace(/−/g, '-'); return s === 'π' ? Math.PI : s === '-π' ? -Math.PI : Number(s); };

test('§9.2 pose table matches renderer/src/debug/poses.ts', async () => {
  const { POSES } = await import('../renderer/src/debug/poses.ts');
  const md = DESIGN();
  const sec = md.slice(md.indexOf('### 9.2 '), md.indexOf('### 9.3 '));
  const rows = new Map<string, number[]>();
  for (const m of sec.matchAll(/^\| `(\w+)` \| ([^|]+) \|/gm)) {
    const parts = m[2].split(',');
    if (parts.length === 5) rows.set(m[1], parts.map(num));
  }
  const hq = (Object.keys(POSES) as (keyof typeof POSES)[]).filter((k) => POSES[k].layout === 'hq');
  assert.deepEqual([...rows.keys()].sort(), hq.sort(), 'every hq pose has a §9.2 row and vice versa');
  for (const k of hq) {
    const want = POSES[k].pose, got = rows.get(k)!; // every hq pose has a row (asserted above)
    for (let i = 0; i < 5; i++) assert.ok(Math.abs(got[i] - want[i]) < 2e-3, `§9.2 ${k}[${i}] = ${got[i]}, poses.ts = ${want[i]}`);
  }
});

test('§5.3 / §9.1 document every drawCalls / programs key and frameErrors that __hq.stats() reports', async () => {
  const { installDrawSplit } = await import('../renderer/src/core/drawSplit.ts');
  const fake = { info: { render: { calls: 0 }, programs: [] }, render() {}, shadowMap: { render() {} } };
  // the test double implements only what installDrawSplit touches, so it is not a WebGLRenderer / Scene
  const split = installDrawSplit(fake as unknown as THREE.WebGLRenderer, {} as THREE.Scene);
  split.begin();
  const md = DESIGN();
  const s53 = md.slice(md.indexOf('### 5.3 '), md.indexOf('### 5.4 '));
  const s91 = md.slice(md.indexOf('### 9.1 '), md.indexOf('### 9.2 '));
  const drawKeys = Object.keys(split.end()).sort().join(', ');
  const progKeys = Object.keys(split.programs()).sort().join(', ');
  for (const [name, s] of [['§5.3', s53], ['§9.1', s91]]) {
    const d = s.match(/drawCalls(?: =)? \{([^}]+)\}/), p = s.match(/programs(?: =)? \{([^}]+)\}/);
    assert.ok(d && p, `${name} states the drawCalls and programs shapes`);
    assert.equal(d[1].split(',').map((x) => x.trim()).sort().join(', '), drawKeys, `${name} drawCalls keys`);
    assert.equal(p[1].split(',').map((x) => x.trim()).sort().join(', '), progKeys, `${name} programs keys`);
    assert.match(s, /frameErrors/, `${name} documents frameErrors`);
  }
});

test('briefs are stamped per brief: an §11.5 append leaves every non-LEAD brief unchanged', () => {
  const md = DESIGN();
  const a = buildBriefs(md).out;
  const at = md.indexOf('### 11.5 ');
  const nl = md.indexOf('\n', at);
  const b = buildBriefs(`${md.slice(0, nl + 1)}- *(test)* a new idea.\n${md.slice(nl + 1)}`).out;
  for (const [name, content] of a) assert.equal(b.get(name), content, `${name} changed on a §11.5 append`);
  const c = buildBriefs(md.replace(/(## 10\. Gotchas[^\n]*\n)/, '$1\nx\n')).out;
  for (const [name, content] of a) if (name !== 'LEAD.md') assert.notEqual(c.get(name), content, `${name}: a §10 edit must restale it`);
});
