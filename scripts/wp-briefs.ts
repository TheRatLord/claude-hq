#!/usr/bin/env node
// Generate per-WP briefs docs/wp/<CODE>.md from docs/DESIGN.md (DESIGN §11.0 reading map). Owner: LEAD.
//
// usage: node scripts/wp-briefs.ts [--check]
//   Each brief inlines, VERBATIM, the normative sections named in the §11.0 reading-map row for that WP (a section
//   reference includes its subsections; "§a–b" is the doc-order range), then §10 Gotchas and §12.2 Superseded rows.
//   `§11` refs inline §11 without the §11.5 backlog. Every brief (but LEAD's) also gets a generated "Your milestone rows"
//   appendix: the §11 intro, and per milestone only the table rows naming the WP (`**CODE**`) + that milestone's exit
//   line (gate tables without a WP column are included when the heading names the WP). The DESIGN.md sha256 is recorded
//   in each brief header.
//   --check: exit 1 if any brief is missing or stale (does not write).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = path.join(ROOT, 'docs/DESIGN.md');
const OUT = path.join(ROOT, 'docs/wp');

/** A heading section: line range [start, end). */
export interface Section { level: number; id: string | null; title: string; start: number; end: number }

/** A §-reference: `from` (to `to` if a range); `intro` = the section's own text only. */
export interface Ref { from: string; to: string | null; intro?: boolean }

/** Split markdown into heading sections (fenced code aware). */
export function parseSections(lines: string[]): Section[] {
  const secs: Section[] = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (!m) return;
    const title = m[2].trim();
    let id: string | null = null;
    const num = title.match(/^(\d+(?:\.\d+)*)\.?\s/);
    const ms = title.match(/^(M\d+(?:\.\d+)?)\s*:/);
    if (num) id = num[1];
    else if (ms) id = ms[1];
    secs.push({ level: m[1].length, id, title, start: i, end: lines.length });
  });
  for (let k = 0; k < secs.length - 1; k++) secs[k].end = secs[k + 1].start;
  return secs;
}

/** Indices of a section and all its descendants. */
function withDescendants(secs: Section[], idx: number) {
  const out = [idx];
  for (let k = idx + 1; k < secs.length && secs[k].level > secs[idx].level; k++) out.push(k);
  return out;
}

/** Parse "§3.1–3.2, §4 (all), §8 intro" → list of {from, to, intro?}. `§X intro` = the section's own text only. */
export function parseRefs(cell: string): Ref[] {
  const refs: Ref[] = [];
  const re = /§\s*(\d+(?:\.\d+)*)(?:\s*[–-]\s*(\d+(?:\.\d+)*))?(\s+intro\b)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cell))) refs.push(m[3] ? { from: m[1], to: null, intro: true } : { from: m[1], to: m[2] ?? null });
  return refs;
}

/** Resolve refs to a sorted set of section indices. */
export function resolveRefs(secs: Section[], refs: Ref[]) {
  const byId = new Map<string, number>();
  secs.forEach((s, i) => s.id && !byId.has(s.id) && byId.set(s.id, i));
  const picked = new Set<number>();
  const missing: string[] = [];
  for (const { from, to, intro } of refs) {
    const a = byId.get(from);
    if (a == null) {
      missing.push(from);
      continue;
    }
    let idxs: number[];
    if (to) {
      const b = byId.get(to);
      if (b == null) {
        missing.push(to);
        continue;
      }
      const bd = withDescendants(secs, b), last = bd[bd.length - 1];
      idxs = [];
      for (let k = a; k <= last; k++) idxs.push(k);
    } else {
      idxs = intro ? [a] : withDescendants(secs, a);
    }
    for (const k of idxs) {
      if (from === '11' && !to && secs[k].id === '11.5') continue;
      if (from === '11' && !to && isInside(secs, k, '11.5')) continue;
      picked.add(k);
    }
  }
  return { indices: [...picked].sort((x, y) => x - y), missing };
}

function isInside(secs: Section[], k: number, id: string): boolean {
  for (let j = k - 1; j >= 0; j--) {
    if (secs[j].level < secs[k].level) {
      if (secs[j].id === id) return true;
      return isInside(secs, j, id);
    }
  }
  return false;
}

/** Parse a markdown table that starts at the first line matching `headerRe` inside [start,end). */
function parseTable(lines: string[], start: number, end: number, headerRe: RegExp) {
  let i = start;
  while (i < end && !headerRe.test(lines[i])) i++;
  if (i >= end) return [];
  const rows: string[][] = [];
  for (i += 2; i < end && lines[i].trim().startsWith('|'); i++) {
    rows.push(splitRow(lines[i]));
  }
  return rows;
}

function splitRow(line: string) {
  // split on | not escaped and not inside backticks
  const cells: string[] = [];
  let cur = '', tick = false;
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`') tick = !tick;
    if (c === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
      continue;
    }
    if (c === '|' && !tick) {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * The §11 intro + this WP's rows of every milestone table (see header). Pure over the parsed lines.
 */
export function milestoneRows(lines: string[], secs: Section[], code: string) {
  const s11 = secs.find((s) => s.id === '11');
  if (!s11) return '';
  const mine = new RegExp(`\\*\\*${code}\\*\\*`);
  const named = new RegExp(`\\b${code}\\b`);
  const out = ['## Your milestone rows (generated from DESIGN §11; full tables in DESIGN.md)', ''];
  out.push(...lines.slice(s11.start + 1, s11.end).filter((l, i, a) => !(l === '' && a[i - 1] === '')));
  for (const sec of secs) {
    if (!sec.id?.startsWith('M')) continue;
    const body = lines.slice(sec.start + 1, sec.end);
    const picked: string[] = [];
    let k = 0;
    while (k < body.length) {
      if (body[k].trim().startsWith('|')) {
        const tbl: string[] = [];
        while (k < body.length && body[k].trim().startsWith('|')) tbl.push(body[k++]);
        const hasWp = /^\|\s*WP\s*\|/.test(tbl[0]);
        const rows = hasWp ? tbl.slice(2).filter((r) => mine.test(splitRow(r)[0])) : named.test(sec.title) ? tbl.slice(2) : [];
        if (rows.length) picked.push(tbl[0], tbl[1], ...rows, '');
      } else if (/^\*\*M[\d.]+ exit:?\*\*/.test(body[k])) {
        const para: string[] = [];
        while (k < body.length && body[k].trim() !== '') para.push(body[k++]);
        if (picked.length) picked.push(...para, '');
      } else k++;
    }
    if (picked.length) out.push('', lines[sec.start], ...picked);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * [LEAD m2 fix r2] Each brief is stamped with the hash of ITS OWN content (the DESIGN text it inlines), not of the whole
 * DESIGN.md: an append to §11.5 (which every WP may do) used to mark all 15 briefs stale although none inlines it.
 * `design` in the result is still the whole-file hash (printed for reference).
 */
const stamp = (head: string[], rest: string[]) => {
  const body = [...head.slice(1), ...rest].join('\n');
  const h = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  return [head[0], `<!-- brief-sha256: ${h} -->`, body].join('\n');
};

export function buildBriefs(designText: string) {
  const hash = crypto.createHash('sha256').update(designText).digest('hex').slice(0, 16);
  const lines = designText.split('\n');
  const secs = parseSections(lines);
  const s110 = secs.find((s) => s.id === '11.0');
  if (!s110) throw new Error('DESIGN.md has no §11.0');
  const owners = parseTable(lines, s110.start, s110.end, /^\|\s*WP\s*\|\s*Owns/);
  const map = parseTable(lines, s110.start, s110.end, /^\|\s*WP\s*\|\s*Normative/);
  const ownerHeadLine = lines.slice(s110.start, s110.end).find((l) => /^\|\s*WP\s*\|\s*Owns/.test(l));
  if (ownerHeadLine === undefined) throw new Error('DESIGN.md §11.0 has no "WP | Owns" table');
  const ownerHead = splitRow(ownerHeadLine);
  const always = resolveRefs(secs, [{ from: '10', to: null }, { from: '12.2', to: null }]).indices;
  const text = (k: number) => lines.slice(secs[k].start, secs[k].end).join('\n').replace(/\n+$/, '');

  /** file name → content */
  const out = new Map<string, string>();
  const problems: string[] = [];
  for (const row of map) {
    const [code, normative, reference] = row;
    const own = owners.find((r) => r[0] === code);
    const ms = own ? ownerHead.slice(2).map((h, j) => (own[2 + j] ? `${h}: ${own[2 + j]}` : null)).filter(Boolean) : [];
    const head = [
      `<!-- GENERATED by scripts/wp-briefs.ts from docs/DESIGN.md — do not edit. Regenerate: npm run briefs -->`,
      '',
      `# WP brief: ${code}`,
      '',
      `Your normative contract is the DESIGN.md excerpt below (verbatim, § anchors kept). Where anything else disagrees,`,
      `DESIGN.md wins. Reference-only docs are for look/behaviour detail; their struck rows are superseded (→ §12.2).`,
      `**TypeScript port:** the excerpt predates it, so every \`.js\` / \`.mjs\` path in it is now a \`.ts\` file and the command`,
      `examples map as in DESIGN §13 (\`node server/main.js\` → \`node server/main.ts\`, \`scripts/shoot.mjs\` → \`scripts/shoot.ts\`, ...).`,
      '',
      `- **Owns (§2.1):** ${own ? own[1] : '(see §2.1)'}`,
      `- **Milestones:** ${ms.join(' · ') || '—'}`,
      `- **Normative sections:** ${normative}`,
      `- **Reference only:** ${reference}`,
      `- **Always:** §10 Gotchas, §12.2 Superseded rows. Contracts: \`shared/protocol.ts\`, \`shared/identity.ts\`,`,
      `  \`shared/task.ts\`, \`shared/palette.ts\`, \`server/interfaces.ts\` (LEAD; propose additions in your WP summary).`,
      `- **Done means:** \`npm test\` green, \`npm run review\` shots + \`review.json\`, summary with contract proposals`,
      `  and the stubs you deleted (§11).`,
      '',
    ];
    if (code === 'LEAD') {
      out.set(`${code}.md`, stamp(head, ['LEAD reads **all** of `docs/DESIGN.md`; nothing is inlined here.', '']));
      continue;
    }
    const { indices, missing } = resolveRefs(secs, parseRefs(normative));
    if (missing.length) problems.push(`${code}: unknown § ${missing.join(', ')}`);
    const all = [...new Set([...indices, ...always])].sort((a, b) => a - b);
    const body: string[] = [];
    for (const k of all) body.push(text(k));
    body.push(milestoneRows(lines, secs, code));
    out.set(`${code}.md`, stamp(head, ['---', '', body.join('\n\n'), '']));
  }
  return { hash, out, problems };
}

function main() {
  const check = process.argv.includes('--check');
  const design = fs.readFileSync(DESIGN, 'utf8');
  const { hash, out, problems } = buildBriefs(design);
  for (const p of problems) console.warn(`warn: ${p}`);
  if (check) {
    const stale: string[] = [];
    for (const [name, content] of out) {
      const f = path.join(OUT, name);
      if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== content) stale.push(name);
    }
    if (stale.length) {
      console.error(`stale briefs (run npm run briefs): ${stale.join(', ')}`);
      process.exit(1);
    }
    console.log(`briefs up to date (design ${hash})`);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of out) fs.writeFileSync(path.join(OUT, name), content);
  const sizes = [...out].map(([n, c]) => `${n.replace('.md', '')} ${(c.length / 1024).toFixed(0)}K`).join(', ');
  console.log(`wrote ${out.size} briefs to docs/wp/ (design ${hash}): ${sizes}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
