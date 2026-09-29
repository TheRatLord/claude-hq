// @pure
/**
 * UI kit lint (docs/design/ui-kit.md §6 banned patterns, the machine-checkable subset). `lintSource(file, text)` lists
 * violations for one renderer/src/ui/** file; kit.lint.test.ts runs it over the tree with the per-file allow-list in
 * lint-allow.ts (un-migrated surfaces), so a migrated surface stays clean. Also a CLI:
 *   node renderer/src/ui/kit/lint.ts [file…]     print violations (default: the whole ui tree, allow-list ignored)
 * Rules (id → §6 item):
 *   hex        #15  a hex colour literal; use palette tokens (UI / CORE / STATUS / workspaceColor) or kit CSS vars
 *   radius     §2.2 a border-radius outside the kit scale (RADIUS_PX, 50 %, var(--r-*)); never 999 px
 *   pill       #1   a pill / chip class (hq-pill, hq-chip, hq-fchip, .chip, .pill …): lamps, ticks, detents instead
 *   blur       #12  backdrop-filter (surfaces are opaque)
 *   caps       #9   text-transform:uppercase outside the kit (only plaques, group headers, stamps are caps)
 *   type       §2.1 a CSS font size outside the type scale (TYPE_SCALE) outside the kit
 *   dotmatrix  #10  the dot-matrix (dotfont / readout / tally) outside its three places (HUD, drawer counter, triage)
 * Comments are ignored. Owner: UI (kit).
 */
/// <reference types="node" />
import { RADIUS_PX, TYPE_SCALE } from './tokens.ts';

export const RULES = Object.freeze(['hex', 'radius', 'pill', 'blur', 'caps', 'type', 'dotmatrix'] as const);
export type Rule = (typeof RULES)[number];
export interface Violation { rule: Rule; line: number; text: string }

/** Files (relative to renderer/src/ui/) that may draw the dot-matrix (§2.1). */
export const DOTMATRIX_OK = Object.freeze(['kit/', 'hud.ts', 'terminal/drawer.ts', 'terminal/tabs.ts', 'triage.ts']);

/** Strip JS + CSS comments, keeping line numbers (URLs like http:// survive: `//` after ':' is kept). */
export function stripComments(src: string): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '));
  s = s.split('\n').map((l) => l.replace(/(^|[^:\\'"`\w])\/\/.*$/, '$1')).join('\n');
  return s;
}

const lineOf = (s: string, i: number) => s.slice(0, i).split('\n').length;

/**
 * `file` is the path relative to renderer/src/ui/ (posix), `text` its source.
 */
export function lintSource(file: string, text: string): Violation[] {
  const s = stripComments(text);
  const out: Violation[] = [];
  const add = (rule: Rule, i: number, t: string) => out.push({ rule, line: lineOf(s, i), text: t.trim().slice(0, 80) });
  const inKit = file.startsWith('kit/');

  // hex colour literal (3/4/6/8 digits); not an HTML entity (&#123;), not a URL fragment of word chars
  for (const m of s.matchAll(/(?<![&\w])#([0-9a-fA-F]{3,8})\b/g)) {
    if (![3, 4, 6, 8].includes(m[1].length)) continue;
    if (/^\d+$/.test(m[1]) && m[1].length < 6) continue; // "#123" issue refs / counts, not colours
    add('hex', m.index, m[0]);
  }
  // border-radius in CSS strings (border-radius:…) and style objects (borderRadius: '…')
  for (const m of s.matchAll(/border-?[rR]adius\s*[:=]\s*['"`]?([^;}'"`\n]+)/g)) {
    const v = m[1].trim();
    if (!v || /^var\(--r-[\w-]+\)$/.test(v) || v.startsWith('${') || v === 'inherit') continue;
    const parts = v.replace(/\/.*/, '').split(/\s+/).filter(Boolean);
    const ok = parts.every((p) => p === '0' || p === '50%' || /^var\(--r-[\w-]+\)$/.test(p) || (/^\d+(\.\d+)?px$/.test(p) && RADIUS_PX.includes(parseFloat(p))));
    if (!ok) add('radius', m.index, `border-radius:${v}`);
  }
  if (/\bborder-?[rR]adius\s*[:=]\s*[^;}\n]*999/.test(s)) { /* covered above */ }
  // pill / chip classes
  for (const m of s.matchAll(/(?<![\w$-])((?:hq|k)-[\w-]*(?:pill|chip)s?\b[\w-]*|\.(?:pill|chip)s?\b)/gi)) add('pill', m.index, m[1]);
  // backdrop-filter
  for (const m of s.matchAll(/(?:backdrop-?[fF]ilter)/g)) add('blur', m.index, m[0]);
  // ALL CAPS styling outside the kit
  if (!inKit) for (const m of s.matchAll(/text-?[tT]ransform\s*:\s*['"]?uppercase/g)) add('caps', m.index, m[0]);
  // CSS font sizes on the §2.1 scale (canvas `ctx.font = …` is not CSS and is not checked)
  if (!inKit) for (const m of s.matchAll(/(?:font-size\s*:\s*|(?<![\w.-])font\s*:\s*(?:(?:\d{3}|italic|normal|bold)\s+)*)(\d+(?:\.\d+)?)px/g)) {
    if (!TYPE_SCALE.includes(parseFloat(m[1]))) add('type', m.index, m[0]);
  }
  // dot-matrix outside its three places
  if (!DOTMATRIX_OK.some((p) => file === p || (p.endsWith('/') && file.startsWith(p)))) {
    for (const m of s.matchAll(/dotfont(?:\.ts)?['"]|\bdrawDots\b|\breadout\s*\(|\btally\s*\(/g)) add('dotmatrix', m.index, m[0]);
  }
  return out;
}

// ---- CLI ----------------------------------------------------------------------------------------------------------
if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => path.resolve(f)) : walk(root).filter((f: string) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  let n = 0;
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    for (const v of lintSource(rel, fs.readFileSync(f, 'utf8'))) { n++; console.log(`${rel}:${v.line}  ${v.rule.padEnd(9)} ${v.text}`); }
  }
  console.log(`${n} violation(s)`);
}
