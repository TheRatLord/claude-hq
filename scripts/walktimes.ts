#!/usr/bin/env node
// Walk times from the real nav grid (DESIGN §9.3, §11 M1.5). Owner: LVL.
//
// usage: node scripts/walktimes.ts [--layout hq|proto] [--json] [--check]
//        node scripts/walktimes.ts --ascii            the §7 block map regenerated from hq.ts (1 char = 1 m)
//        node scripts/walktimes.ts --grid [0|1]       the nav occupancy grid of a level at 0.5 m ('#' blocked)
//        node scripts/walktimes.ts --vis              sampled cell visibility (vis.ts) vs the authored VIS table (§5.3)
//        node scripts/walktimes.ts --sim mixed|trio [--minutes 10] [--seed 1]   headless brain + director + nav (BRN, §6.5)
//
// Tables: spawn → every zone (agent 2.8 / 2.0 / 0.9 m/s, player 3.6 m/s) and every bay → every station (agent speeds;
// the bay's owner may use its private back door). `--check` exits 1 when an M1.5 acceptance row misses:
// every E-bay → Library/Lab ≤ 12 s at 2.0 m/s; spawn → farthest zone ≤ 12 s at the player's 3.6 m/s walk; no empty
// floor patch > 2.5 × 2.5 m outside the circulation lanes (§7.1 density; the patches are printed, [LVL fix r1]).
// Also printed: every E-bay desk → the nearest idle-loop pick of each Café-type tag (the 25 m roaming cap, §6.4.1).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import type { Layout, HqLayout, Furniture, Rect, Slot, Station } from '../renderer/src/world/layout/schema.ts';
import type { Nav, NavPoint, Route } from '../renderer/src/world/nav/index.ts';

// The renderer modules are imported by (dynamic) path; the annotations below are the boundary types.
type NavModule = typeof import('../renderer/src/world/nav/index.ts');
type DensityModule = typeof import('../renderer/src/world/layout/density.ts');
type VisModule = typeof import('../renderer/src/world/layout/vis.ts');
/** BRN's headless sim (renderer/src/chars/brain/sim.ts): only the slice walktimes calls. */
interface SimModule { runSim(o: { layout: Layout; nav: Nav; scenario: string; minutes: number; seed: number }): Promise<{ metrics?: unknown; misses?: string[] }> }

/** hq.ts exports an HqLayout (every hq-only field present); the proto room is the plain Layout. */
const isHq = (l: Layout): l is HqLayout => l.id === 'hq';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const val = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

const layoutId = val('--layout', 'hq');
const { layout }: { layout: Layout } = await import(path.join(REPO, `renderer/src/world/layout/${layoutId}.ts`));
const { createNav }: NavModule = await import(path.join(REPO, 'renderer/src/world/nav/index.ts'));
const nav = createNav(layout);
const OX = 20.5, OZ = 14;
const AGENT = [2.8, 2.0, 0.9], PLAYER = 3.6;
const f1 = (v: number) => v.toFixed(1);

if (flag('--ascii')) { console.log(asciiMap()); process.exit(0); }
if (flag('--grid')) { console.log(gridDump(+val('--grid', '0') || 0)); process.exit(0); }
if (flag('--sim')) process.exit(await sim(val('--sim', 'mixed'), +val('--minutes', '10')));
if (flag('--vis')) process.exit(await visTable());

// ---------------------------------------------------------------------------------------------- tables
const spawn = { x: layout.spawn[0], z: layout.spawn[2], level: 0 };
const zonePts: Record<string, { x: number; z: number }> = (isHq(layout) ? layout.points.zone : undefined) ?? Object.fromEntries((layout.zones ?? []).map((z) => [z.id, { x: (z.rect[0] + z.rect[2]) / 2, z: (z.rect[1] + z.rect[3]) / 2 }]));
const levelOf = (id: string) => (layout.zones.find((z) => z.id === id)?.level ?? 0);
interface ZoneRow { zone: string; m: number | null; via: string; playerM: number | null }
const rows1: ZoneRow[] = [];
for (const [id, p] of Object.entries(zonePts)) {
  const agent = nav.route(spawn, { x: p.x, z: p.z, level: levelOf(id) });
  const pl = nav.route(spawn, { x: p.x, z: p.z, level: levelOf(id) }, { owner: '*' });
  rows1.push({ zone: id, m: agent?.length ?? null, via: agent?.portals.join('+') || '', playerM: pl?.length ?? null });
}
rows1.sort((a, b) => (a.m ?? 1e9) - (b.m ?? 1e9));

interface BayRow { bay: string; station: string; m: number | null; max: number | null; via: string; backM: number | null; backVia: string }
const rows2: BayRow[] = [];
const stations = layout.stations ?? [];
const slotById = new Map(layout.slots.map((s): [string, Slot] => [s.id, s]));
const slotOf = (id: string): Slot => {
  const s = slotById.get(id);
  if (!s) throw new Error(`unknown slot ${id}`);
  return s;
};
/** nearest slot of a station from p (owner may use its back door) */
const toStation = (p: NavPoint, st: Station, owner: string) => {
  let best: Route | null = null;
  for (const sid of st.slots) {
    const s = slotOf(sid);
    const r = nav.route(p, { x: s.pos.x, z: s.pos.z, level: s.level }, { owner });
    if (r && (!best || r.length < best.length)) best = r;
  }
  return best;
};
for (const b of layout.bays ?? []) {
  const desks = b.desks.map((id) => slotOf(id)).map((s) => ({ x: s.pos.x, z: s.pos.z, level: 0 }));
  for (const st of stations) {
    // bay → station = mean over the bay's desks (max reported too); the way back may use the slide (§6.5)
    const rs = desks.map((d) => toStation(d, st, b.id));
    const routes = rs.filter((r): r is Route => r !== null);
    const ok = routes.length === rs.length;
    const m = ok ? routes.reduce((a, r) => a + r.length, 0) / routes.length : null;
    const max = ok ? Math.max(...routes.map((r) => r.length)) : null;
    const s0 = slotOf(st.slots[0]);
    const back = nav.route({ x: s0.pos.x, z: s0.pos.z, level: s0.level }, desks[0], { owner: b.id });
    rows2.push({ bay: b.id, station: st.id, m, max, via: ok ? routes[0].portals.join('+') : '', backM: back?.length ?? null, backVia: back?.portals.join('+') || '' });
  }
}

// idle-loop reach (§6.4.1 roaming cap 25 m): E-bay desk → nearest slot of each Café-type pick (owner's back door open)
const CAP = 25, REACH_TAGS = ['coffee', 'cafe', 'arcade', 'pingpong', 'foosball', 'bunk', 'cards', 'fish'] as const;
type ReachRow = { bay: string } & Partial<Record<(typeof REACH_TAGS)[number], number>>;
const reach: ReachRow[] = [];
for (const b of (layout.bays ?? []).filter((q) => q.side === 'E')) {
  const row: ReachRow = { bay: b.id };
  for (const tag of REACH_TAGS) {
    const spots = layout.slots.filter((s) => s.tag === tag);
    if (!spots.length) continue;
    let worst = 0;
    for (const did of b.desks) {
      const d = slotOf(did);
      let best = Infinity;
      for (const s of spots) { const r = nav.route({ x: d.pos.x, z: d.pos.z, level: 0 }, { x: s.pos.x, z: s.pos.z, level: s.level }, { owner: b.id }); if (r) best = Math.min(best, r.length); }
      worst = Math.max(worst, best);
    }
    row[tag] = worst;
  }
  reach.push(row);
}

// density (§7.1): empty floor patches > 2.5 × 2.5 m outside lanes / keep-clear, both levels
const { emptyPatches }: DensityModule = await import(path.join(REPO, 'renderer/src/world/layout/density.ts'));
const patches = layout.lanes ? [0, 1].flatMap((level) => emptyPatches(layout, nav, { level })) : [];

const misses: string[] = [];
for (const q of patches) misses.push(`empty patch ${f1(q.side)} × ${f1(q.side)} m in ${q.zone ?? '?'} at plan (${f1(q.x + OX)}, ${f1(q.z + OZ)})${q.level ? ' (mezzanine)' : ''}`);
for (const r of reach) if (!(['coffee', 'cafe', 'arcade', 'pingpong'] as const).some((t) => (r[t] ?? Infinity) <= CAP)) misses.push(`${r.bay}: no Café-type pick within ${CAP} m`);
// [LVL fix r2] the BRN outing tier needs variety, not just coffee: ≥ 3 non-coffee picks within the cap for every E bay
for (const r of reach) { const n = REACH_TAGS.filter((t) => t !== 'coffee' && (r[t] ?? Infinity) <= CAP).length; if (n < 3) misses.push(`${r.bay}: ${n} non-coffee idle picks within ${CAP} m (< 3)`); }
for (const r of rows2) if (r.bay[0] === 'E' && (r.station === 'library' || r.station === 'lab') && !(r.m !== null && r.m / 2.0 <= 12)) misses.push(`${r.bay} → ${r.station}: ${r.m === null ? 'unreachable' : `${f1(r.m / 2.0)} s at 2.0 m/s`} (> 12 s)`);
const far = rows1.reduce<ZoneRow | null>((a, r) => (r.playerM ?? 1e9) > (a?.playerM ?? -1) ? r : a, null);
if (!far || far.playerM === null || far.playerM / PLAYER > 12) misses.push(`spawn → farthest zone ${far?.zone}: ${!far || far.playerM === null ? 'unreachable' : `${f1(far.playerM / PLAYER)} s at 3.6 m/s`} (> 12 s)`);
for (const r of rows1) if (r.m === null) misses.push(`spawn → ${r.zone}: unreachable`);

if (flag('--json')) {
  console.log(JSON.stringify({ layout: layout.id, spawnToZone: rows1, bayToStation: rows2, reach, patches, misses }, null, 1));
} else {
  const t = (m: number | null, v: number) => (m === null ? '—' : f1(m / v));
  console.log(`## Walk times (${layout.id}, nav grid 0.25 m, string-pulled; portal hops at their length)\n`);
  console.log('### Spawn → zone\n');
  console.log('| Zone | Path (m) | Via | 2.8 m/s | 2.0 m/s | 0.9 m/s | Player 3.6 m/s |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows1) console.log(`| ${r.zone} | ${r.m === null ? '—' : f1(r.m)} | ${r.via} | ${t(r.m, 2.8)} | ${t(r.m, 2.0)} | ${t(r.m, 0.9)} | ${t(r.playerM, PLAYER)} |`);
  if (rows2.length) {
    console.log('\n### Bay → station (mean over the bay\'s 6 desks, nearest station slot; owner may use its back door)\n');
    const sts = stations.map((s) => s.id);
    console.log(`| Bay | ${sts.map((s) => `${s} m · s@2.0`).join(' | ')} |`);
    console.log(`|---|${sts.map(() => '---').join('|')}|`);
    for (const b of layout.bays ?? []) {
      const cells = sts.map((s) => { const r = rows2.find((q) => q.bay === b.id && q.station === s); return !r || r.m === null ? '—' : `${f1(r.m)} · ${f1(r.m / 2.0)}${r.via ? ` (${r.via})` : ''}`; });
      console.log(`| ${b.id} | ${cells.join(' | ')} |`);
    }
    const back = rows2.filter((r) => r.backVia);
    if (back.length) console.log(`\nReturn legs using a portal: ${[...new Set(back.map((r) => `${r.station}→${r.backVia}`))].join(', ')}`);
  }
  if (reach.length) {
    console.log(`\n### E-bay desk → idle-loop picks (worst desk of the bay, nearest spot; roaming cap ${CAP} m)\n`);
    const tags = REACH_TAGS.filter((t) => reach.some((r) => r[t] !== undefined));
    console.log(`| Bay | ${tags.join(' | ')} |`);
    console.log(`|---|${tags.map(() => '---').join('|')}|`);
    for (const r of reach) console.log(`| ${r.bay} | ${tags.map((t) => (r[t] === undefined ? '—' : `${f1(r[t])}${r[t] <= CAP ? '' : ' ✗'}`)).join(' | ')} |`);
  }
  if (layout.lanes) console.log(`\n### Density (§7.1): empty floor patches > 2.5 × 2.5 m outside lanes\n\n${patches.length ? patches.map((q) => `- ${f1(q.side)} m square in ${q.zone} at plan (${f1(q.x + OX)}, ${f1(q.z + OZ)})${q.level ? ', mezzanine' : ''}`).join('\n') : 'none (both levels)'}`);
  console.log(`\n${misses.length ? `MISS:\n- ${misses.join('\n- ')}` : 'M1.5 walk-time acceptance: pass (E-bay → Library/Lab ≤ 12 s @ 2.0; spawn → farthest zone ≤ 12 s @ 3.6)'}`);
}
if (flag('--check') && misses.length) process.exit(1);

// ---------------------------------------------------------------------------------------------- ascii
function asciiMap() {
  if (!isHq(layout)) return '(--ascii needs the hq layout)';
  const P = layout.plan;
  const ZC: Record<string, string> = { LOB: ',', ATR: '.', LIB: 'L', NAL: 'a', STR: 's', W1: '1', W2: '2', W3: '3', E1: '4', E2: '5', E3: '6', PLZ: 'p', WAR: 'W', LAB: 'B', MAIL: 'M', ARC: 'A', ENG: 'E', CAF: 'c', NAP: 'n' };
  const wx = (px: number) => px - OX, wz = (pz: number) => pz - OZ;
  const inW = (r: Readonly<Rect>, px: number, pz: number) => wx(px) >= r[0] && wx(px) <= r[2] && wz(pz) >= r[1] && wz(pz) <= r[3];
  const fur = (id: string) => layout.furniture.find((f) => f.id === id);
  const inF = (f: Furniture | undefined, px: number, pz: number) => f && Math.abs(wx(px) - f.pos.x) <= f.size[0] / 2 + 0.01 && Math.abs(wz(pz) - f.pos.z) <= f.size[2] / 2 + 0.01;
  const kc = layout.keepClear.filter((k) => !k.id?.startsWith('door:'));
  const lines = ['     0         1         2         3         4', '     012345678901234567890123456789012345678901'];
  for (let z = 0; z < 28; z++) {
    let s = `z${String(z).padStart(2, '0')}  `;
    for (let x = 0; x < 42; x++) {
      const px = x + 0.5, pz = z + 0.5;
      let ch = ZC[P.zoneAt(px, pz, 0) ?? ''] ?? ' ';
      const dp = Math.hypot(px - P.PIT.cx, pz - P.PIT.cz);
      if (dp < P.PIT.rings[0][0]) ch = dp < P.PIT.rings[2][0] ? 'o' : ':';
      if (Math.abs(px - P.PIT.cx) < 0.6 && Math.abs(pz - P.PIT.cz) < 0.6) ch = '#';
      if (kc.some((k) => wx(px) >= k.x0 && wx(px) <= k.x1 && wz(pz) >= k.z0 && wz(pz) <= k.z1)) ch = 'k';
      if (P.stairsY(px, pz) !== null) ch = '/';
      if (x >= 26 && x < 28 && pz > 7 && pz < 9.5) ch = '=';
      if (Math.hypot(px - 15.4, pz - 8.4) < 1.25) ch = '@';
      if (inW(layout.queueLane, px, pz)) ch = 'q';
      if (inF(fur('overflowRug'), px, pz)) ch = 'Q';
      if (z === 20 && x >= 14 && x < 28 && ch !== 'q' && ch !== 'k') ch = '-';
      if (inF(fur('counter0'), px, pz + 0.5) && z === 20) ch = 'H';
      if (inF(fur('staffMat'), px, pz)) ch = 'h';
      if (inF(fur('ramColumn'), px, pz)) ch = 'R';
      if (Math.abs(px - (layout.spawn[0] + OX)) < 0.5 && Math.abs(pz - (layout.spawn[2] + OZ)) < 0.5) ch = '*';
      s += ch;
    }
    lines.push(s);
  }
  return ['```', ...lines, '```',
    'Legend: a Reading Alley · 1–3 W1–W3 · s Studio Street · 4–6 E1–E3 · L Library (mezzanine above) · . Atrium · :/o Pit',
    'steps/floor · # Big Board · @ slide · / stairs · = landing · p Plaza · W War Room · B Lab · , Lobby · H teller counter ·',
    'h STAFF mat · q queue lane · Q overflow rug · k keep-clear · - rope/planter line · R RAM column · * spawn · M Mailroom ·',
    'A Archive · E Engine Room · c Café · n Nap Nook. (regenerated by `npm run walktimes -- --ascii` from hq.ts)'].join('\n');
}

async function visTable() {
  if (!isHq(layout)) { console.log('(--vis needs the hq layout)'); return 0; }
  const { sampleVisibility }: VisModule = await import(path.join(REPO, 'renderer/src/world/layout/vis.ts'));
  const v = sampleVisibility(layout);
  let bad = 0;
  console.log('cell  sampled  authored  missing-from-table  extra-in-table');
  for (const c of layout.visCells) {
    const s = v[c.id] ?? [];
    const miss = s.filter((q) => !c.visible.includes(q)), extra = c.visible.filter((q) => !s.includes(q));
    bad += miss.length;
    console.log(`${c.id.padEnd(5)} ${String(s.length).padStart(7)} ${String(c.visible.length).padStart(9)}  ${miss.join(' ') || '—'}  ${extra.join(' ') || '—'}`);
  }
  return bad ? 1 : 0;
}

function gridDump(level: number) {
  const g = nav.gridFor(level).raw;
  let s = `level ${level} (0.5 m / char; # blocked)\n`;
  for (let r = 0; r < g.rows; r += 2) { for (let c = 0; c < g.cols; c += 2) s += g.occ[r * g.cols + c] ? '#' : '.'; s += '\n'; }
  return s;
}

// ---------------------------------------------------------------------------------------------- sim (BRN hook)
async function sim(scenario: string, minutes: number) {
  const f = path.join(REPO, 'renderer/src/chars/brain/sim.ts');
  if (!fs.existsSync(f)) {
    console.error(`walktimes --sim: renderer/src/chars/brain/sim.ts (BRN, §6.5 headless sim) is not there yet. It should export\n  runSim({layout, nav, scenario, minutes}) → {metrics, misses[]}`);
    return 2;
  }
  const { runSim }: SimModule = await import(f);
  const out = await runSim({ layout, nav, scenario, minutes, seed: +val('--seed', '1') }); // [INT M1.5] --seed
  console.log(JSON.stringify(out.metrics ?? out, null, 1));
  if (out.misses?.length) { console.log(`MISS:\n- ${out.misses.join('\n- ')}`); return 1; }
  return 0;
}
