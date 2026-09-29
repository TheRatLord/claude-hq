/**
 * UI kit tests: the banned-pattern lint over renderer/src/ui/** (docs/design/ui-kit.md §6, allow-list in
 * lint-allow.ts), token contrast (§2), keycap labels (§3 Keycap), lamp sprite, and the deprecated generic classes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSource, RULES, stripComments } from './lint.ts';
import { ALLOW } from './lint-allow.ts';
import { tokenEntries, tokenCss, RADIUS, RADIUS_PX, kebab } from './tokens.ts';
import { keyLabel, comboCaps, leaderCap, isSymbolCap } from './keys.ts';
import { LAMP, lampSprite, lampHtml, lampState } from './lamps.ts';
import { KIT_CSS } from './styles.ts';
import { UI, CORE, ENV, luminance } from '../../../../shared/palette.ts';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const SOURCES: [string, string][] = walk(UI_ROOT).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f): [string, string] => [path.relative(UI_ROOT, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]);

test('kit lint: no banned pattern outside the allow-list (§6); allow-list has no stale entries', () => {
  const bad: string[] = [], stale: string[] = [];
  for (const [rel, src] of SOURCES) {
    const waived = new Set(ALLOW[rel] ?? []);
    const hits = lintSource(rel, src);
    for (const v of hits) if (!waived.has(v.rule)) bad.push(`${rel}:${v.line} ${v.rule} ${v.text}`);
    for (const r of waived) if (!hits.some((v) => v.rule === r)) stale.push(`${rel}: '${r}'`);
  }
  assert.deepEqual(bad, [], `banned UI patterns (docs/design/ui-kit.md §6; use kit tokens/components):\n  ${bad.join('\n  ')}`);
  assert.deepEqual(stale, [], `clean now: remove these from renderer/src/ui/kit/lint-allow.ts:\n  ${stale.join('\n  ')}`);
});

test('kit lint: allow-list names real files and known rules, never the kit folder', () => {
  const files = new Set(SOURCES.map(([r]) => r));
  for (const [f, rules] of Object.entries(ALLOW)) {
    assert.ok(files.has(f), `lint-allow.ts: no such file ${f}`);
    assert.ok(!f.startsWith('kit/'), 'the kit folder is never allow-listed');
    for (const r of rules) assert.ok(RULES.includes(r), `${f}: unknown rule ${r}`);
  }
});

test('kit lint: rules catch what §6 bans and pass what it allows', () => {
  const rules = (f: string, s: string) => [...new Set(lintSource(f, s).map((v) => v.rule))].sort();
  assert.deepEqual(rules('x.ts', "const c = '#EF5A4C';"), ['hex']);
  assert.deepEqual(rules('x.ts', "h('a', {href:'#L-blocked'}); // #fff in a comment"), []);
  assert.deepEqual(rules('x.ts', '.a{border-radius:999px}'), ['radius']);
  assert.deepEqual(rules('x.ts', '.a{border-radius:10px}'), ['radius']);
  assert.deepEqual(rules('x.ts', '.a{border-radius:6px 6px 0 0}.b{border-radius:50%}.c{border-radius:var(--r-board)}'), []);
  assert.deepEqual(rules('x.ts', "el.style.borderRadius = '16px'"), ['radius']);
  assert.deepEqual(rules('x.ts', "h('span.hq-chip')"), ['pill']);
  assert.deepEqual(rules('x.ts', "h('span.hq-fchip')"), ['pill']);
  assert.deepEqual(rules('x.ts', "const chips = []; h('div.k-tick')"), []);
  assert.deepEqual(rules('x.ts', '.a{backdrop-filter:blur(8px)}'), ['blur']);
  assert.deepEqual(rules('x.ts', '.a{text-transform:uppercase}'), ['caps']);
  assert.deepEqual(rules('kit/styles.ts', '.k-plaque{text-transform:uppercase}'), []);
  assert.deepEqual(rules('x.ts', '.a{font-size:10px}'), ['type']);
  assert.deepEqual(rules('x.ts', '.a{font:600 17px/1 var(--font-ui)}'), ['type']);
  assert.deepEqual(rules('x.ts', ".a{font-size:13px;font:italic 16.5px/1.4 var(--font-voice)} ctx.font = '600 10px sans-serif'"), []);
  assert.deepEqual(rules('roster/view.ts', "import { readout } from '../kit/index.ts'; readout('1')"), ['dotmatrix']);
  assert.deepEqual(rules('hud.ts', "tally(counts); readout('2')"), []);
  assert.equal(stripComments('a // b\nc /* d */ e').replace(/\s+/g, ' ').trim(), 'a c e');
  assert.match(stripComments("url('http://www.w3.org/2000/svg')"), /http:\/\/www/);
});

test('tokens: UI text contrast meets §2 / §8 (≥ 4.5:1 for small text)', () => {
  const cr = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const k of ['t1', 't2', 't3'] as const) assert.ok(cr(UI[k], UI.board) >= 4.5, `${k} on board ${cr(UI[k], UI.board).toFixed(2)}`);
  for (const k of ['p1', 'p2', 'p3'] as const) assert.ok(cr(UI[k], CORE.paper) >= 4.5, `${k} on paper`);
  for (const [k, v] of Object.entries(UI.onBoard)) assert.ok(cr(v, UI.board) >= 4.5, `onBoard.${k}`);
  for (const [k, v] of Object.entries(UI.onPaper)) assert.ok(cr(v, CORE.paper) >= 4.5, `onPaper.${k}`);
  assert.ok(cr(UI.clayInk, CORE.paper) >= 4.5, 'clayInk on paper');
  assert.ok(cr(CORE.ink, CORE.clay) >= 4.5, 'primary button: ink on clay');
  assert.ok(cr(UI.fit.postitInk, ENV.butter) >= 4.5, 'post-it ink on butter');
});

test('tokens: every var the kit CSS uses is defined; radius scale excludes pills', () => {
  const defined = new Set(tokenEntries().map(([k]) => k));
  const used = new Set([...KIT_CSS.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  for (const v of used) if (!['--ws', '--g'].includes(v)) // --g: a glyph keycap's local mask (set per .g-* class)
      assert.ok(defined.has(v), `kit CSS uses undefined ${v}`);
  for (const v of Object.values(RADIUS)) assert.ok(RADIUS_PX.includes(v), `radius ${v}`);
  assert.ok(!RADIUS_PX.some((v) => v >= 16), 'no pill radius in the scale');
  assert.match(tokenCss(), /\.hq-lowq\{--grain:none;--fibre:none;--woodgrain:none\}/);
  assert.equal(kebab('clayInk'), 'clay-ink');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(KIT_CSS), 'kit CSS carries no hex literal');
  assert.ok(!/backdrop-filter/.test(KIT_CSS), 'no backdrop-filter');
  assert.ok(!/999px/.test(KIT_CSS), 'no pill radius');
});

test('keys: OS-correct keycap labels (§3 Keycap)', () => {
  const lin = { mac: false, leaderLabel: 'Ctrl+`' }, mac = { mac: true, leaderLabel: '⌃`' };
  assert.deepEqual(comboCaps('Mod+K', lin), ['Ctrl', 'K']);
  assert.deepEqual(comboCaps('Mod+K', mac), ['⌘', 'K']);
  assert.deepEqual(comboCaps('Alt+1', mac), ['⌥', '1']);
  assert.deepEqual(comboCaps('Shift+Enter', lin), ['⇧', '⏎']);
  assert.deepEqual(comboCaps('Leader', lin), ['Ctrl `']);
  assert.equal(leaderCap(mac), '⌃ `');
  assert.equal(keyLabel('Escape', lin), 'Esc');
  assert.equal(keyLabel('KeyG', lin), 'G');
  assert.equal(keyLabel('ArrowRight', lin), '→');
  assert.ok(isSymbolCap('⏎') && isSymbolCap('[') && !isSymbolCap('O') && !isSymbolCap('Ctrl `'));
});

test('lamps: every state has a sprite symbol + word; shells map to prompt/busy', () => {
  const sprite = lampSprite();
  for (const [st, [sym, word]] of Object.entries(LAMP)) {
    assert.ok(sprite.includes(`id="${sym}"`), `${st} symbol`);
    assert.match(lampHtml(st), new RegExp(`aria-label="${word}"`));
  }
  assert.ok(sprite.includes('id="inked"'), 'stamp filter');
  assert.equal(lampState('shell', { kind: 'shell', process: { activity: 'prompt' } }), 'shell');
  assert.equal(lampState('shell', { kind: 'shell', process: { activity: 'running' } }), 'busy');
  assert.equal(lampState('weird'), 'unknown');
});

test('deprecated generic classes: all deleted and nothing uses them (docs/design/ui-kit.md §7)', () => {
  const DEPRECATED = ['hq-panel', 'hq-kbd', 'hq-btn', 'hq-ibtn', 'hq-chip', 'hq-dot', 'hq-ws', 'hq-seg', 'hq-fchip', 'hq-pill'];
  for (const c of DEPRECATED) {
    const re = new RegExp(`(?<![\\w-])${c}(?![\\w-])`);
    const users = SOURCES.filter(([r, s]) => !r.startsWith('kit/') && re.test(stripComments(s))).map(([r]) => r);
    assert.deepEqual(users, [], `${c} is deprecated (use the k-* kit component); still in ${users.join(', ')}`);
  }
});
