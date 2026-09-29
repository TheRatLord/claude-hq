/**
 * The Big Board (§7.4 Summary): a four-faced clay-framed display box hanging over the Pit on a brass swivel.
 * Faces: STATES (counts + names per state, incl. `done ✓`, so W-bay agents are covered for P1) / MACHINE / WORKSPACES /
 * CLOCK, plus the transient WHILE YOU WERE AWAY face (bus 'away.recap', §6.4.5) that takes the face toward the viewer.
 * Rotates 90° every 20 s (eased), stops while looked at; STATES starts toward spawn (+z). No agents at all → the
 * STATES face shows the pixel-Clawd screensaver (§11.5). Owner: STAT.
 */
import * as THREE from 'three';
import { registerStat } from './registry.ts';
import { createPanelSet, createParts, rrect, FONT_UI } from './panel.ts';
import { drawDots, dotWidth, drawPixelClawd } from './dotfont.ts';
import { stateGroups, statesNames, statesLayout, memFigures, diskFigures, gib, pct, temp, rate, uptime, levelColor, series, clamp01 } from './format.ts';
import { CORE, ENV, STATUS, WORKSPACE } from '../../../../shared/palette.ts';
import type { Entity, Stats, Workspace } from '../../../../shared/protocol.ts';
import type { StateGroups, StateKey } from './format.ts';
import type { PanelSpec } from './panel.ts';

type G = CanvasRenderingContext2D;
/** The recap the away face shows (bus 'away.recap' plus the timing the face adds). */
interface Away { minutes: number; lines: string[]; until: number; face: number; t0: number }
/** Inbox-zero win on the band: start time and answered count. */
interface Win { t0: number; n: number }
/** What a workspace row needs (a real Workspace, or a stand-in made from its entities' ids). */
type WsRow = Pick<Workspace, 'id' | 'label' | 'colorIndex'> & { cycle?: number };
/** One MACHINE bar row. */
interface MachineRow { label: string; value: string; f: number | null; f2?: number; c?: string }
/** A fitted STATES name row. */
export interface FitLine { size: number; shown: string[]; more: number }

const FACE_W = 2.34, FACE_H = 1.3, OFF = 1.236;
const PX = 1024, PY = Math.round(PX * FACE_H / FACE_W);
const STEP_S = 20, TURN_S = 1.4;
const BG = '#1B1A19', BG2 = '#262422', CREAM = '#F4EDE3', MUTED = '#9A9186', BUTTER = ENV.butter;

const STATE_ROWS: { key: StateKey; label: string; color: string; w: number }[] = [
  { key: 'blocked', label: 'BLOCKED', color: STATUS.blocked, w: 1.25 },
  { key: 'done', label: 'DONE ✓', color: STATUS.done, w: 1 },
  { key: 'working', label: 'WORKING', color: STATUS.working, w: 1 },
  { key: 'idle', label: 'IDLE', color: STATUS.idle, w: 1 },
  { key: 'shell', label: 'SHELLS', color: STATUS.shell, w: 1 },
];

/** Name separator on the board: a round bullet (twins are merged to "claude ×2" by rowNames, so no count sits between bullets). */
const SEP = ' • '; // [STAT fix m3 r1] single spaces: one-line rows need the width
/** STATES name type: max / floor px (floor 42 px ≈ 9.6 cm on the 2.34 m face, readable from spawn), blocked = one step up. */
const NAME_MAX = 96, NAME_MIN = 42, NAME_STEP = 1.25;

/**
 * Fit a state row's names onto ONE line of width `w` (m3 r1 art: a 4th name used to orphan onto its own line under the
 * first and push the row out of line with its count chip). Shrinks from `big` to `small` in ~6 % steps; still too long
 * at `small` → drop names from the end and say "+N". `measure(text, size)` → px (canvas-free, so it is unit-tested).
 */
export function fitOneLine(names: string[], w: number, measure: (t: string, size: number) => number, big: number, small: number): FitLine {
  big = Math.round(big); small = Math.min(big, Math.round(small));
  for (let size = big; ; size = Math.max(small, size - Math.max(2, Math.round(size * 0.06)))) {
    if (measure(names.join(SEP), size) <= w) return { size, shown: names.slice(), more: 0 };
    if (size === small) break;
  }
  for (let k = names.length - 1; k >= 1; k--) {
    const more = names.length - k;
    if (measure(names.slice(0, k).join(SEP) + moreTag(more), small) <= w) return { size: small, shown: names.slice(0, k), more };
  }
  return { size: small, shown: names.slice(0, 1), more: names.length - 1 };
}
const moreTag = (n: number) => (n ? ` +${n}` : '');

/** Draw a fitted name line: names in `color`, the bullets between them muted. */
function drawNameLine(g: G, line: string, x: number, y: number, color: string): number {
  const parts = line.split(SEP);
  const sepW = g.measureText(SEP).width;
  parts.forEach((p, k) => {
    if (k) { g.fillStyle = '#6E675F'; g.fillText(SEP, x, y); x += sepW; }
    // [STAT fix m3 r2] a merged twin's " ×2" in a softer butter so it reads as a count on that name, not a name
    const m = / ×\d+$/.exec(p);
    const name = m ? p.slice(0, m.index) : p;
    g.fillStyle = color; g.fillText(name, x, y);
    x += g.measureText(name).width;
    if (m) { g.fillStyle = '#E8C98A'; g.fillText(m[0], x, y); x += g.measureText(m[0]).width; }
  });
  return x;
}

function header(g: G, W: number, title: string, right: string) {
  g.fillStyle = BG;
  g.fillRect(0, 0, W, PY);
  drawDots(g, title, 34, 22, 5, BUTTER, { ghost: 0.07 });
  if (right) drawDots(g, right, W - 34, 22, 4, MUTED, { align: 'right' });
  g.fillStyle = '#34312D';
  g.fillRect(28, 66, W - 56, 3);
}

const FOLD_WORD: Record<string, string> = { blocked: 'blocked', done: 'done', working: 'working', idle: 'idle' };

/**
 * STATES: one row per populated state (count tile + names), row height and type scaled to how many rows there are, so
 * 3 agents read from the spawn as well as 12 do; the empty states fold into one "nobody …" footer line. Same-named
 * agents in a row merge into "claude ×2" (rowNames; [STAT fix m3 r2]); twins spread over rows keep their boardNames
 * "claude · 2" labels (statesNames; [STAT fix m3 r3 art]).
 */
function drawStates(g: G, W: number, H: number, groups: StateGroups<Entity>, total: number, blink: boolean) {
  header(g, W, 'STATES', `${total} ${total === 1 ? 'AGENT' : 'AGENTS'}`);
  // [STAT fix m3 r1] even rows (no head-count growth: every row is one line now); blocked keeps a 1.25× share
  const { rows, fold } = statesLayout(STATE_ROWS, groups, 76, H - 12, { foldH: 62, maxRowH: 170, crowd: false });
  const measure = (t: string, size: number) => { g.font = `800 ${size}px ${FONT_UI}`; return g.measureText(t).width; };
  const tileWOf = (th: number) => Math.round(Math.max(150, Math.min(250, th * 1.2)));
  const names = statesNames(groups); // [STAT fix m3 r3 art] cross-row twins keep their "· 2" labels
  const namesOf = (key: string): string[] => names[key] ?? [];
  // [STAT fix m3 r1] one type size for every row (the smallest row's fit, floor NAME_MIN, then "+N"), and exactly one
  // step up (× NAME_STEP) for the first row when it is BLOCKED, so the hierarchy is deliberate, not a side effect
  const plain = rows.filter((r) => r.key !== 'blocked');
  const capOf = (row: { h: number }) => (row.h - 10) * 0.6;
  let base = Math.min(NAME_MAX, ...(plain.length ? plain : rows).map(capOf));
  for (const row of plain) {
    const nameW = W - (28 + tileWOf(row.h - 10) + 24) - 30;
    base = Math.min(base, fitOneLine(namesOf(row.key), nameW, measure, base, NAME_MIN).size);
  }
  base = Math.max(NAME_MIN, Math.round(base));
  for (const row of rows) {
    const r = STATE_ROWS.find((x) => x.key === row.key);
    if (!r) continue;
    const n = groups[r.key].length;
    const h = row.h;
    // count tile (grows with the row)
    const th = h - 10, ty = row.y + 5, tx = 28;
    const tileW = tileWOf(th);
    rrect(g, tx, ty, tileW, th, 14);
    const pulse = r.key === 'blocked' && blink;
    g.fillStyle = pulse ? '#FF7A6C' : r.color;
    g.fill();
    const labelPx = Math.round(Math.max(20, Math.min(34, th * 0.17)));
    const digits = String(n);
    const numH = th - labelPx - 18;
    const pitch = Math.min(numH * 0.82 / 7, (tileW - 24) / Math.max(1, dotWidth(digits)));
    drawDots(g, digits, tx + tileW / 2, ty + 6 + (numH - pitch * 7) / 2, pitch, '#1B1A19', { align: 'center', dot: 0.46 });
    g.fillStyle = 'rgba(27,26,25,.8)';
    g.font = `800 ${labelPx}px ${FONT_UI}`;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(r.label, tx + tileW / 2, ty + th - Math.round(labelPx * 0.35));
    g.textAlign = 'left';
    // names: ONE line, vertically centred on the count chip (level with it), clipped to the face as a last resort
    const lx = tx + tileW + 24;
    const nameW = W - lx - 30;
    const want = r.key === 'blocked' ? Math.min(Math.round(base * NAME_STEP), th * 0.62) : base;
    const fit = fitOneLine(namesOf(r.key), nameW, measure, Math.max(base, want), base);
    g.font = `800 ${fit.size}px ${FONT_UI}`;
    g.textBaseline = 'middle';
    g.save(); g.beginPath(); g.rect(lx - 4, ty, nameW + 8, th); g.clip();
    const cy = ty + th / 2 + fit.size * 0.04;
    const endX = drawNameLine(g, fit.shown.join(SEP), lx, cy, r.key === 'blocked' ? '#FFE3DF' : CREAM);
    if (fit.more) { g.fillStyle = MUTED; g.fillText(moreTag(fit.more), endX, cy); }
    g.restore();
    g.textBaseline = 'top';
  }
  if (fold) {
    // one quiet line for every empty state: "● nobody blocked · ● idle   ● no shells"
    g.fillStyle = '#2A2826';
    g.fillRect(28, fold.y + 4, W - 56, 3);
    const fs = 40, cy = fold.y + fold.h / 2 + 4;
    g.font = `800 ${fs}px ${FONT_UI}`; g.textBaseline = 'middle';
    const agents = fold.keys.filter((k) => k !== 'shell');
    const parts: { k: string; t: string }[] = [];
    agents.forEach((k, i) => parts.push({ k, t: (i ? '' : 'nobody ') + (FOLD_WORD[k] ?? k) }));
    if (fold.keys.includes('shell')) parts.push({ k: 'shell', t: 'no shells' });
    let x = 34;
    parts.forEach((p, i) => {
      const c = STATE_ROWS.find((r) => r.key === p.k)?.color ?? MUTED;
      g.beginPath(); g.arc(x + 9, cy, 9, 0, Math.PI * 2); g.fillStyle = c; g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;
      x += 26;
      g.fillStyle = p.k === 'blocked' ? '#B7D9B0' : MUTED;
      g.fillText(p.t, x, cy);
      x += g.measureText(p.t).width + (i < parts.length - 1 ? 34 : 0);
    });
    g.textBaseline = 'top';
  }
}

function drawScreensaver(g: G, W: number, H: number, frame: number) {
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  const px = 26;
  drawPixelClawd(g, W / 2 - 6.5 * px, H / 2 - 6.5 * px, px, frame);
  drawDots(g, 'NO AGENTS YET', W / 2, H / 2 + 3.4 * px, 6, BUTTER, { align: 'center' });
}

function bar(g: G, x: number, y: number, w: number, h: number, f: number, color: string, f2: number | null | undefined, color2: string) {
  rrect(g, x, y, w, h, h / 2);
  g.fillStyle = '#2E2C29';
  g.fill();
  g.save();
  rrect(g, x, y, w, h, h / 2);
  g.clip();
  if (f2 != null) { g.fillStyle = color2; g.fillRect(x, y, w * clamp01(f2), h); }
  g.fillStyle = color;
  g.fillRect(x, y, w * clamp01(f), h);
  g.restore();
}

function drawMachine(g: G, W: number, H: number, s: Stats | null, host: string) {
  header(g, W, 'MACHINE', host ? String(host).toUpperCase().slice(0, 18) : '');
  if (!s) { drawDots(g, 'NO STATS', W / 2, H / 2, 8, MUTED, { align: 'center' }); return; }
  // CPU ring
  const cx = 190, cy = 300, R = 150;
  const cpu = (s.cpu?.total ?? 0) / 100;
  g.lineCap = 'round';
  g.lineWidth = 34;
  g.strokeStyle = '#2E2C29';
  g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
  g.strokeStyle = levelColor(cpu);
  g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * Math.max(0.01, clamp01(cpu)))); g.stroke();
  const p = String(Math.round(cpu * 100));
  drawDots(g, p, cx - 8, cy - 42, 12, CREAM, { align: 'center' });
  drawDots(g, '%', cx + dotWidth(p) * 6 + 8, cy - 18, 5, CREAM, { align: 'center' });
  g.fillStyle = MUTED; g.font = `800 30px ${FONT_UI}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('CPU', cx, cy + 70);
  const ld = s.cpu?.load ?? [];
  g.font = `700 26px ${FONT_UI}`;
  g.fillText(`load ${ld.map((v: number) => v.toFixed(1)).join(' · ')}`, cx, cy + 150);
  g.textAlign = 'left';
  // bars
  const bx = 400, bw = W - bx - 40;
  const rows: MachineRow[] = [];
  const m = memFigures(s.mem);
  if (m) rows.push({ label: 'RAM', value: `${gib(m.used)} / ${gib(m.total, 0)} GB`, f: m.usedF, f2: m.cacheF, c: levelColor(m.usedF, { warn: 0.7, crit: 0.9 }) });
  const d = diskFigures(s.disks)[0];
  if (d) rows.push({ label: `DISK ${d.mount}`, value: d.label, f: d.f, c: levelColor(d.f, { warn: 0.8, crit: 0.9 }) });
  if (s.gpu) rows.push({ label: 'GPU', value: `${pct(s.gpu.busy)} · ${gib(s.gpu.vramUsed)} / ${gib(s.gpu.vramTotal, 0)} GB`, f: (s.gpu.busy ?? 0) / 100, c: levelColor((s.gpu.busy ?? 0) / 100) });
  rows.push({ label: 'NET', value: `↓ ${rate(s.net?.rxBps)}   ↑ ${rate(s.net?.txBps)}`, f: null });
  let y = 100;
  for (const r of rows) {
    g.fillStyle = MUTED; g.font = `800 26px ${FONT_UI}`; g.textBaseline = 'top';
    g.fillText(r.label, bx, y);
    g.fillStyle = CREAM; g.font = `800 34px ${FONT_UI}`; g.textAlign = 'right';
    g.fillText(r.value, bx + bw, y - 6);
    g.textAlign = 'left';
    if (r.f != null) bar(g, bx, y + 38, bw, 24, r.f, r.c ?? CREAM, r.f2, 'rgba(241,198,110,.35)');
    y += r.f != null ? 94 : 60;
  }
  const t = s.temps ?? {};
  g.fillStyle = MUTED; g.font = `700 26px ${FONT_UI}`;
  g.fillText(`CPU ${temp(t.cpu)}   GPU ${temp(t.gpu ?? s.gpu?.tempC)}   NVMe ${temp(t.nvme)}`, bx, y + 4);
}

function drawWorkspaces(g: G, W: number, H: number, wsList: readonly Workspace[] | null | undefined, entities: readonly Entity[]) {
  const per = new Map<string, Entity[]>();
  for (const e of entities) {
    const id = e.workspace?.id ?? '?';
    let a = per.get(id);
    if (!a) per.set(id, (a = []));
    a.push(e);
  }
  const list: WsRow[] = (wsList?.length ? [...wsList] : [...per.keys()].map((id) => ({ id, label: id, colorIndex: 0 }))).slice(0, 8);
  header(g, W, 'WORKSPACES', `${wsList?.length ?? 0}`);
  if (!list.length) { drawDots(g, 'NONE', W / 2, H / 2, 8, MUTED, { align: 'center' }); return; }
  const top = 84, rowH = Math.min(118, (H - top - 12) / list.length);
  list.forEach((ws, i) => {
    const y = top + i * rowH;
    const col = WORKSPACE[(ws.colorIndex ?? 0) % WORKSPACE.length]?.hex ?? MUTED;
    rrect(g, 28, y + 6, 26, rowH - 12, 8);
    g.fillStyle = col; g.fill();
    if (ws.cycle) { g.fillStyle = 'rgba(239,230,214,.7)'; g.fillRect(28, y + rowH / 2 - 3, 26, 6); }
    const members = per.get(ws.id) ?? [];
    const fs = Math.round(Math.min(48, rowH * 0.46));
    g.fillStyle = CREAM; g.font = `800 ${fs}px ${FONT_UI}`; g.textBaseline = 'middle';
    let label = String(ws.label ?? ws.id);
    while (label.length > 3 && g.measureText(label).width > 470) label = label.slice(0, -2) + '…';
    g.fillText(label, 74, y + rowH / 2);
    // status dots per member (blocked first)
    const order: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 };
    const ms = members.slice().sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));
    const dr = Math.min(15, rowH * 0.16);
    ms.slice(0, 10).forEach((e, k) => {
      g.beginPath();
      g.arc(600 + k * dr * 2.5, y + rowH / 2, dr, 0, Math.PI * 2);
      g.fillStyle = e.kind === 'shell' ? STATUS.shell : statusColor(e.status);
      g.fill();
    });
    g.fillStyle = MUTED; g.font = `800 ${Math.round(fs * 0.7)}px ${FONT_UI}`; g.textAlign = 'right';
    g.fillText(`${members.length}`, W - 34, y + rowH / 2);
    g.textAlign = 'left';
  });
}

/** STATUS colour by status name (unlisted → idle). */
const statusColor = (status: string): string => (Object.hasOwn(STATUS, status) ? STATUS[status as keyof typeof STATUS] : STATUS.idle);

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function drawClock(g: G, W: number, H: number, hour: number, date: Date, up: number | null | undefined, frame: number) {
  header(g, W, 'CLOCK', '');
  const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
  const txt = `${String(hh).padStart(2, '0')}${frame ? ':' : ' '}${String(mm).padStart(2, '0')}`;
  drawDots(g, txt, W / 2, 110, 26, BUTTER, { align: 'center', ghost: 0.06, dot: 0.44 });
  drawDots(g, `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`, W / 2, 330, 9, CREAM, { align: 'center' });
  const u = uptime(up);
  g.fillStyle = MUTED; g.font = `800 34px ${FONT_UI}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText(`up ${u.text}`, W / 2, 470);
  g.textAlign = 'left';
  drawPixelClawd(g, W - 150, H - 110, 8, frame);
}

function drawAway(g: G, W: number, H: number, away: Away, shown: number) {
  g.fillStyle = '#F4EDE3';
  g.fillRect(0, 0, W, H);
  g.fillStyle = CORE.clay;
  g.fillRect(0, 0, W, 86);
  drawDots(g, 'WHILE YOU WERE AWAY', 34, 22, 6, '#FBF8F3');
  if (away.minutes) drawDots(g, `${Math.round(away.minutes)} MIN`, W - 34, 30, 4, '#FBF8F3', { align: 'right' });
  g.fillStyle = CORE.ink; g.textBaseline = 'top';
  const lines = away.lines.slice(0, 6);
  const fs = Math.round(Math.min(78, (H - 110) / (Math.max(1, lines.length) * 1.32)));
  g.font = `800 ${fs}px ${FONT_UI}`;
  lines.slice(0, shown).forEach((l: string, i: number) => {
    let t = String(l);
    while (t.length > 4 && g.measureText(t).width > W - 60 - fs * 0.6) t = t.slice(0, -2) + '…';
    const y = 104 + i * fs * 1.32;
    g.fillStyle = CORE.clay; g.fillRect(34, y + fs * 0.32, fs * 0.3, fs * 0.3);
    g.fillStyle = CORE.ink; g.fillText(t, 34 + fs * 0.55, y);
  });
}

/** Deep "off" plate of the band / underside (a dim clay-dark, a touch warmer than the faces' BG). */
const PLATE_OFF = '#221E1C';
const INK = CORE.ink;

/**
 * A row of marquee bulbs along y (canvas px): every third one lit, shifted by `chase` (0..2) each 0.5 s step, so the
 * lit ones run along the band (a slow marquee chase). `on` false → all bulbs dark (just the sockets).
 */
function bulbRow(g: G, W: number, y: number, r: number, chase: number, on: boolean, lit: string, off: string) {
  const n = Math.floor((W - 2 * r) / (r * 3.2));
  const step = (W - 2 * r) / n;
  for (let k = 0; k <= n; k++) {
    const x = r + k * step;
    const hot = on && (((k - chase) % 3) + 3) % 3 === 0; // chase > 0 runs right, < 0 left
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = hot ? lit : off;
    g.fill();
  }
}

/** The band's words: "1 NEEDS YOU" / "3 NEED YOU" (count first, so it reads at a glance). */
export const needYouText = (nb: number) => (nb === 1 ? '1 NEEDS YOU' : `${nb} NEED YOU`);

/**
 * The I NEED YOU marquee band (the skirt under the Board, all four sides show the same band): nb > 0 → a lit accent-red
 * plate, ink dot lettering with the count, a waving pixel Clawd at each end and two rows of chasing butter bulbs;
 * nb = 0 → a dim dark plate, "ALL CLEAR" in a quiet green, bulbs off. Text is fitted inside the plate with margins.
 */
/**
 * Pure layout of the lit band (tested: the words always sit inside the plate between the end badges, with margins).
 */
export function bandLayout(W: number, H: number, nb: number) {
  const br = Math.round(H * 0.065), by = br + 5;
  const inner = H - by * 4;
  const spx = Math.floor(inner / 11);
  const sw = 13 * spx, gap = Math.round(W * 0.035), margin = Math.round(W * 0.035);
  const text = needYouText(nb);
  const avail = W - 2 * margin - 2 * (sw + gap);
  const pitch = Math.min(inner * 0.9 / 7, avail / dotWidth(text));
  return { br, by, inner, spx, sw, margin, gap, text, pitch, textW: dotWidth(text) * pitch, ty: by * 2 + (inner - pitch * 7) / 2 };
}

/**
 * Band colours (M3.5 carryover): a lit deep-red plate with cream dot lettering (L* 46 vs 95.5: contrast ≥ 40, tested),
 * darker bulb rails, warm bulbs. Clear = a dim plate with a quiet green "ALL CLEAR".
 */
export const BAND = Object.freeze({ plate: '#C73A2E', under: '#A82E24', rail: '#8E2219', text: '#FFF1D2', shadow: '#5A140E', bulb: '#FFE9A8', bulbOff: '#6A1E17', badge: '#2A1512' });

function drawBand(g: G, W: number, H: number, nb: number, chase: number, frame: number) {
  const br = Math.round(H * 0.065), by = br + 5;
  if (nb) {
    g.fillStyle = BAND.plate; g.fillRect(0, 0, W, H);
    // darker rails for the bulbs so they pop
    g.fillStyle = BAND.rail; g.fillRect(0, 0, W, by * 2 - 2); g.fillRect(0, H - by * 2 + 2, W, by * 2 - 2);
    bulbRow(g, W, by, br, chase, true, BAND.bulb, BAND.bulbOff);
    bulbRow(g, W, H - by, br, -chase, true, BAND.bulb, BAND.bulbOff);
    const { inner, spx, sw, margin, text, pitch, ty } = bandLayout(W, H, nb);
    // cream dots over a dark-red drop shadow: crisp strokes from across the atrium, the dot grain still reads up close
    const off = Math.max(2, Math.round(pitch * 0.14));
    drawDots(g, text, W / 2 + off, ty + off, pitch, BAND.shadow, { align: 'center', dot: 0.7 });
    drawDots(g, text, W / 2, ty, pitch, BAND.text, { align: 'center', dot: 0.66 });
    // a small crisp waving pixel Clawd on a dark badge at each end (integer pixel grid, ink outline)
    const px = Math.max(3, Math.floor(spx * 0.8)), cw = 13 * px, chH = 9 * px;
    const sy = Math.round(by * 2 + (inner - chH) / 2), pad = Math.round(px * 1.4);
    for (const [x0, f] of [[margin, frame], [W - margin - sw, frame ^ 1]] as const) {
      const x = Math.round(x0 + (sw - cw) / 2);
      rrect(g, x - pad, sy - pad, cw + 2 * pad, chH + 2 * pad, pad);
      g.fillStyle = BAND.badge; g.fill();
      drawPixelClawd(g, x, sy, px, f, CORE.clay, INK);
    }
  } else {
    g.fillStyle = PLATE_OFF; g.fillRect(0, 0, W, H);
    bulbRow(g, W, by, br, 0, false, '', '#3A3330');
    bulbRow(g, W, H - by, br, 0, false, '', '#3A3330');
    const inner = H - by * 4;
    const pitch = Math.min(inner * 0.62 / 7, (W * 0.6) / dotWidth('ALL CLEAR'));
    drawDots(g, 'ALL CLEAR', W / 2, by * 2 + (inner - pitch * 7) / 2, pitch, '#5E9C74', { align: 'center', dot: 0.44 });
  }
}

/**
 * [STAT fix m3 r3 fun] The inbox-zero win (bus 'inbox.zero' {answered}): for WIN_S the band is a lit green plate with
 * both bulb rails chasing, "ALL CLEAR ✓" in full butter over "+N ANSWERED" in cream, a cheering pixel Clawd at each
 * end; the first FLASH_S alternate green / butter plates (a few bright flashes) so the win reads across the atrium,
 * then it settles back to the dim idle "ALL CLEAR".
 */
export const WIN = Object.freeze({ plate: '#1E7A48', rail: '#155A35', text: ENV.butter, sub: '#FFF1D2', shadow: '#0C3A21', bulb: '#FFF3C4', bulbOff: '#1B4F31', flashPlate: ENV.butter, flashText: '#155A35', flashRail: '#D9A94E' });
export const WIN_S = 4, FLASH_S = 1.5;
export const answeredText = (n: number) => (n > 0 ? `+${n} ANSWERED` : 'INBOX ZERO');
/** Pure layout of the win band: two lines inside the plate between the end badges (tested). */
export function winLayout(W: number, H: number, n: number) {
  const br = Math.round(H * 0.065), by = br + 5, inner = H - by * 4;
  const spx = Math.floor(inner / 11), sw = 13 * spx, gap = Math.round(W * 0.035), margin = Math.round(W * 0.035);
  const avail = W - 2 * margin - 2 * (sw + gap);
  const top = 'ALL CLEAR ✓', sub = answeredText(n);
  const lineGap = Math.round(inner * 0.06);
  const p1 = Math.min((inner - lineGap) * 0.64 / 7, avail / dotWidth(top));
  const p2 = Math.min((inner - lineGap) * 0.36 / 7, avail / dotWidth(sub));
  const y1 = by * 2 + (inner - (p1 + p2) * 7 - lineGap) / 2;
  return { br, by, inner, spx, sw, gap, margin, top, sub, p1, p2, y1, y2: y1 + p1 * 7 + lineGap, w1: dotWidth(top) * p1, w2: dotWidth(sub) * p2 };
}
function drawWin(g: G, W: number, H: number, n: number, chase: number, frame: number, flash: boolean) {
  const L = winLayout(W, H, n);
  const inv = flash && frame > 0; // flash phase: butter plate, deep-green letters
  g.fillStyle = inv ? WIN.flashPlate : WIN.plate; g.fillRect(0, 0, W, H);
  g.fillStyle = inv ? WIN.flashRail : WIN.rail; g.fillRect(0, 0, W, L.by * 2 - 2); g.fillRect(0, H - L.by * 2 + 2, W, L.by * 2 - 2);
  bulbRow(g, W, L.by, L.br, chase, true, WIN.bulb, inv ? WIN.flashRail : WIN.bulbOff);
  bulbRow(g, W, H - L.by, L.br, -chase, true, WIN.bulb, inv ? WIN.flashRail : WIN.bulbOff);
  const off = Math.max(2, Math.round(L.p1 * 0.14));
  if (!inv) drawDots(g, L.top, W / 2 + off, L.y1 + off, L.p1, WIN.shadow, { align: 'center', dot: 0.7 });
  drawDots(g, L.top, W / 2, L.y1, L.p1, inv ? WIN.flashText : WIN.text, { align: 'center', dot: 0.7 });
  drawDots(g, L.sub, W / 2, L.y2, L.p2, inv ? WIN.flashText : WIN.sub, { align: 'center', dot: 0.66 });
  const px = Math.max(3, Math.floor(L.spx * 0.8)), cw = 13 * px, chH = 9 * px;
  const sy = Math.round(L.by * 2 + (L.inner - chH) / 2) - (frame ? px : 0), pad = Math.round(px * 1.4); // a little hop
  for (const [x0, f] of [[L.margin, frame], [W - L.margin - L.sw, frame ^ 1]] as const) {
    const x = Math.round(x0 + (L.sw - cw) / 2);
    rrect(g, x - pad, sy - pad, cw + 2 * pad, chH + 2 * pad, pad);
    g.fillStyle = WIN.shadow; g.fill();
    drawPixelClawd(g, x, sy, px, f, CORE.clay, INK);
  }
}

/**
 * The Board's underside (seen looking up from the Pit sofas, and at a grazing angle from everywhere else).
 * [STAT fix m3 r1 fun, M2 carryover] no lettering any more: at the angles people actually see it from, any text on a
 * face-down plate foreshortens into an oversized, clipped, upside-down / mirrored-looking "1 NEEDS YOU" (the band
 * above already says it upright). It is a solid lit plate: blocked → the band's lit red with a butter frame and a ring
 * of warm studs (reads as "the same sign, from below"); clear → a dim plate with a quiet frame.
 */
export const UNDER = Object.freeze({ lit: BAND.plate, frame: BUTTER, stud: BAND.bulb, off: '#221E1C', offFrame: '#5A4E3C' });
function drawUnder(g: G, W: number, H: number, nb: number, win = false) {
  const m = Math.round(W * 0.06);
  g.fillStyle = nb ? UNDER.lit : win ? WIN.plate : UNDER.off; g.fillRect(0, 0, W, H);
  g.strokeStyle = nb || win ? UNDER.frame : UNDER.offFrame; g.lineWidth = Math.round(W * 0.018);
  g.strokeRect(m, m, W - 2 * m, H - 2 * m);
  if (!nb && !win) return;
  g.strokeStyle = BAND.rail; g.lineWidth = Math.round(W * 0.006);
  g.strokeRect(m * 1.9, m * 1.9, W - 3.8 * m, H - 3.8 * m);
  // warm studs along the frame (static: a lit sign, not a second marquee)
  g.fillStyle = UNDER.stud;
  const n = 9, r = W * 0.014;
  for (let k = 0; k < n; k++) {
    const u = m + ((W - 2 * m) * (k + 0.5)) / n;
    for (const [x, y] of [[u, m * 0.5], [u, H - m * 0.5], [m * 0.5, u], [W - m * 0.5, u]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  }
}

registerStat('bigBoard', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:bigBoard';
  root.position.set(anchor.pos.x, anchor.pos.y, anchor.pos.z);
  const spin = new THREE.Group();
  root.add(spin);
  // housing: dark clay box, walnut bands top and bottom, butter corner beads, brass swivel + pivot rod (static)
  const P = createParts();
  const HW = 2.44, HH = 1.46;
  P.box(0, 0, 0, HW, HH, HW, '#2B2927', { r: 0.06 });
  for (const y of [HH / 2 - 0.03, -HH / 2 + 0.03]) P.box(0, y, 0, HW + 0.08, 0.1, HW + 0.08, ENV.walnut, { r: 0.04 });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P.cyl(sx * (HW / 2 + 0.02), 0, sz * (HW / 2 + 0.02), 0.045, 0.045, HH - 0.12, BUTTER, { seg: 10 });
  // a row of little bulbs along each bottom band (marquee)
  const bulbs = createParts();
  for (let f = 0; f < 4; f++) {
    const a = f * Math.PI / 2;
    for (let k = 0; k < 9; k++) {
      const u = -1.0 + k * 0.25;
      const x = Math.sin(a) * (HW / 2 + 0.05) + Math.cos(a) * u, z = Math.cos(a) * (HW / 2 + 0.05) - Math.sin(a) * u;
      bulbs.sphere(x, -HH / 2 + 0.03, z, 0.026, '#FFE7A8', { seg: 8, segV: 6 });
    }
  }
  // the I NEED YOU skirt: a marquee band hung under the housing (vertical, so it reads from the atrium at eye level,
  // which the flat underside never did), a walnut lip at its foot
  const SK_H = 0.4, SK_W = HW - 0.14, SK_TOP = -HH / 2 - 0.02, SK_BOT = SK_TOP - SK_H;
  P.box(0, (SK_TOP + 0.04 + SK_BOT) / 2, 0, SK_W, SK_H + 0.04, SK_W, '#2B2927', { r: 0.03 });
  P.box(0, SK_BOT + 0.025, 0, SK_W + 0.06, 0.05, SK_W + 0.06, ENV.walnut, { r: 0.02 });
  const BAND_H = SK_H - 0.07, BAND_Y = (SK_TOP - 0.015 + SK_BOT + 0.055) / 2;
  spin.add(P.mesh('stat:bigBoard:housing'));
  const bulbGeo = bulbs.mesh('tmp').geometry; // warm unlit marquee bulbs: a swatch of the face set (same draw)
  const S = createParts();
  const ceil = 5.5 - anchor.pos.y;
  S.cyl(0, HH / 2 + 0.07, 0, 0.16, 0.2, 0.1, '#B08A4A', { seg: 20 });
  S.cyl(0, (HH / 2 + ceil) / 2 + 0.05, 0, 0.035, 0.035, ceil - HH / 2, '#3A3633', { seg: 8 });
  S.cyl(0, ceil - 0.03, 0, 0.2, 0.2, 0.06, '#3A3633', { seg: 16 });
  root.add(S.mesh('stat:bigBoard:pivot'));
  // faces: STATES +z (toward spawn), MACHINE −x, WORKSPACES −z, CLOCK +x, + the underside (a solid lit plate, no
  // lettering: [STAT fix m3 r1]): one panel set = one draw (m2 r2 draw budget)
  const faceSet = createPanelSet([
    ...[0, -Math.PI / 2, Math.PI, Math.PI / 2].map((a): PanelSpec => ({ w: FACE_W, h: FACE_H, px: PX, py: PY, pos: [Math.sin(a) * OFF, 0.02, Math.cos(a) * OFF], rot: [0, a, 0] })),
    { w: SK_W - 0.1, h: SK_W - 0.1, px: 512, pos: [0, SK_BOT - 0.006, 0], rot: [Math.PI / 2, 0, 0] },
    { geo: bulbGeo, color: '#FFE3A0' },
    // the band: one canvas band, four quads (same: 6)
    ...[0, -Math.PI / 2, Math.PI, Math.PI / 2].map((a, i): PanelSpec => {
      const pos = [Math.sin(a) * (SK_W / 2 + 0.004), BAND_Y, Math.cos(a) * (SK_W / 2 + 0.004)], rot = [0, a, 0];
      return i ? { w: SK_W - 0.04, h: BAND_H, px: 1024, same: 6, pos, rot } : { w: SK_W - 0.04, h: BAND_H, px: 1024, pos, rot };
    }),
  ], { name: 'stat:bigBoard:faces' });
  spin.add(faceSet.mesh);
  const faces = faceSet.panels.slice(0, 4);
  const under = faceSet.panels[4], band = faceSet.panels[5];
  if (!under || !band) throw new Error('bigBoard: panel set lost its bands');
  const FACE_NAMES = ['STATES', 'MACHINE', 'WORKSPACES', 'CLOCK'];

  let faceT = 1, awayFaceDirty = false, target = 0, vel = 0, wasLooked = false, greetZone: string | null = null, greetAt = new THREE.Vector3(1e9, 0, 1e9), angle = 0, timer = 0, blinkT = 0, blink = false, frame = 0, chase = 0, looked = false;
  let away: Away | null = null;
  /** [STAT fix m3 r3 fun] inbox-zero win on the band: {t0, n} for WIN_S, then the dim idle ALL CLEAR */
  let win: Win | null = null;
  ctx.bus?.on?.('inbox.zero', (m) => { win = { t0: performance.now() / 1000, n: Math.max(0, m?.answered | 0) }; faceT = 1; });
  ctx.bus?.on?.('away.recap', (r) => {
    // the face currently toward the viewer shows the recap for 8 s (+0.8 s per line)
    const n = r?.lines?.length ?? 0;
    away = { minutes: r?.minutes ?? 0, lines: r?.lines ?? [], t0: performance.now() / 1000, until: performance.now() / 1000 + 5 + n * 0.8, face: faceToward() };
    awayFaceDirty = true;
  });
  const cam = new THREE.Vector3(), fwd = new THREE.Vector3(), to = new THREE.Vector3();
  const faceAngle = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  const faceToward = () => {
    ctx.camera.getWorldPosition(cam);
    const want = Math.atan2(cam.x - root.position.x, cam.z - root.position.z);
    let best = 0, bd = 9;
    for (let i = 0; i < 4; i++) {
      let d = want - (faceAngle[i] + angle);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < bd) { bd = Math.abs(d); best = i; }
    }
    return best;
  };

  let lastStats: Stats | null = null, host = '';
  const redrawCount = () => faces.reduce((n, f) => n + f.redraws, 0);

  return {
    object3d: root,
    always: true,
    redraws: redrawCount,
    update(stats, dt, c) {
      const now = performance.now() / 1000;
      if (stats) { lastStats = stats; host = stats.host ?? host; }
      // looked at: the view axis within ~11° of the board centre, from ≤ 35 m
      c.camera.getWorldPosition(cam);
      c.camera.getWorldDirection(fwd);
      to.copy(root.position).sub(cam);
      const dist = to.length();
      looked = dist < 35 && fwd.dot(to.normalize()) > Math.cos(0.2 + Math.atan(1.3 / Math.max(1, dist)));
      const rdt = c.rawDt ?? dt;
      // greet: the first look from a new zone (or a spot > 4 m from the last greeting) swings STATES toward the viewer (P1 from any vantage: spawn, the
      // mezzanine rail, the Pit); after that it holds while looked at and turns 90° every 20 s otherwise
      if (looked && !wasLooked && ((c.camZone ?? '') !== greetZone || Math.hypot(cam.x - greetAt.x, cam.z - greetAt.z) > 4)) {
        greetZone = c.camZone ?? '';
        greetAt.set(cam.x, 0, cam.z);
        const want = Math.atan2(cam.x - root.position.x, cam.z - root.position.z);
        let d = want - target;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        target += d;
        timer = 0;
      }
      wasLooked = looked;
      if (!looked && !away) timer += rdt;
      if (timer >= STEP_S) { timer = 0; target += Math.PI / 2; }
      // critically damped swing (~0.7 s to settle) with a tiny overshoot wobble on the hanging board
      const acc = (target - angle) * 60 - vel * 2 * Math.sqrt(60) * 0.8;
      vel += acc * Math.min(rdt, 0.05);
      angle += vel * Math.min(rdt, 0.05);
      if (Math.abs(target - angle) < 1e-4 && Math.abs(vel) < 1e-3) { angle = target; vel = 0; }
      spin.rotation.y = angle;
      // bulb twinkle + blink phase (2 Hz)
      blinkT += c.rawDt ?? dt;
      if (blinkT >= 0.5) { blinkT = 0; blink = !blink; frame = (frame + 1) % 2; chase = (chase + 1) % 3; }
      if (dist > 45) return; // nobody can read it: hold the canvases
      // faces refresh at ≤ 4 Hz (panels upload ≤ 2 Hz): no per-frame entity scans / key strings
      faceT += rdt;
      if (faceT < 0.25 && !(away && awayFaceDirty)) return;
      faceT = 0; awayFaceDirty = false;
      const ents = [...c.store.entities.values()];
      const groups = stateGroups(ents);
      const nb = groups.blocked.length;
      if (win && now - win.t0 > WIN_S) win = null;
      const w = nb ? null : win; // someone blocked again: NEED YOU wins over the party
      const flash = !!w && now - w.t0 < FLASH_S;
      under.draw(nb ? 'lit' : w ? 'win' : 'clear', (g, W, H) => drawUnder(g, W, H, nb, !!w), now); // [STAT fix m3 r1] solid lit plate
      under.tick(now);
      // the band chases (and the end Clawds wave) while someone needs you, and for the inbox-zero win; clear → one
      // static dim draw
      if (w && !nb) band.draw(`win|${w.n}|${chase}|${frame}|${flash}`, (g, W, H) => drawWin(g, W, H, w.n, chase, frame, flash), now);
      else band.draw(nb ? `${nb}|${chase}|${frame}` : 'clear', (g, W, H) => drawBand(g, W, H, nb, chase, frame), now);
      band.tick(now);
      if (away && now > away.until) away = null;
      const rec: Away | null = away;
      const awayFace = rec ? rec.face : -1;
      // STATES
      for (let i = 0; i < 4; i++) {
        const f = faces[i];
        if (!f) continue;
        if (i === awayFace && rec) {
          const shown = Math.min(rec.lines.length, 1 + Math.floor((now - rec.t0) / 0.8));
          f.draw(`away|${rec.t0}|${shown}`, (g, W, H) => drawAway(g, W, H, rec, shown), now);
          f.tick(now);
          continue;
        }
        if (i === 0) {
          if (!ents.length) f.draw(`saver|${frame}`, (g, W, H) => drawScreensaver(g, W, H, frame), now);
          else {
            const nm = statesNames(groups);
            const key = STATE_ROWS.map((r) => `${r.key}:${nm[r.key].join(',')}`).join('|') + (groups.blocked.length ? `|b${blink}` : '');
            f.draw(key, (g, W, H) => drawStates(g, W, H, groups, ents.length, blink), now);
          }
        } else if (i === 1) {
          const s = lastStats;
          const key = s ? `${Math.round(s.cpu?.total ?? 0)}|${s.cpu?.load?.map((v) => v.toFixed(1))}|${gib(s.mem?.used)}|${gib(s.mem?.cache)}|${s.disks?.[0]?.used}|${s.gpu?.busy}|${gib(s.gpu?.vramUsed)}|${rate(s.net?.rxBps)}|${rate(s.net?.txBps)}|${Math.round(s.temps?.cpu ?? 0)}|${Math.round(s.temps?.nvme ?? 0)}` : 'none';
          f.draw(key, (g, W, H) => drawMachine(g, W, H, s, host), now);
        } else if (i === 2) {
          const ws = c.store.workspaces ?? [];
          const key = ws.map((w) => `${w.id}:${w.label}:${w.colorIndex}`).join(',') + '|' + ents.map((e) => `${e.workspace?.id}:${e.kind === 'shell' ? 's' : e.status}`).join(',');
          f.draw(key, (g, W, H) => drawWorkspaces(g, W, H, ws, ents), now);
        } else {
          const h = c.hour ?? 12;
          const d = new Date();
          const key = `${Math.floor(h * 60)}|${d.getDate()}|${uptime(lastStats?.uptime).text}|${frame}`;
          f.draw(key, (g, W, H) => drawClock(g, W, H, h, d, lastStats?.uptime, frame), now);
        }
        f.tick(now);
      }
    },
    tooltip() {
      const s = lastStats;
      const i = faceToward();
      const groups = stateGroups(ctx.store.entities.values());
      if (i === 0) {
        return {
          title: 'Big Board · States', value: `▲ ${groups.blocked.length} blocked · ${groups.working.length} working · ${groups.done.length} done`,
          spark: series(ctx.store.statsHistory, (x) => x.cpu?.total), max: 100, source: 'herdr agent status (store.entities)', color: STATUS.working,
        };
      }
      return {
        title: `Big Board · ${FACE_NAMES[i]}`, value: s ? `CPU ${pct(s.cpu?.total)} · RAM ${gib(s.mem?.used)} GB` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.cpu?.total), max: 100, source: '/proc/stat · /proc/meminfo', color: BUTTER,
      };
    },
    dispose() { faceSet.dispose(); },
  };
});
