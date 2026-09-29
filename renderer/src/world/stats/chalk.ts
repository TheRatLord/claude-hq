/**
 * Chalkboards (M3.5 STAT): the Café's "Today's specials" (top 3 tools today, coffees pulled, brew rate = token
 * throughput) and the Lab's test tallies (white hash marks per pass, red circled marks per fail, the newest mark glows
 * for a few seconds). Pure trackers (tested) + canvas drawers; the boards themselves ride as extra quads in an existing
 * stats panel set (hiScore → café boards, clock → Lab board), so they add no draw call.
 *
 * Steam hook (AMB owns the steam): once a second `ctx.bus.emit('stat.brew', {tps, steam})`: tps = output tokens/s over
 * all agents (EMA), steam = a suggested multiplier (0.6 … 2.5) for the espresso-machine wisp rate.
 * Owner: STAT.
 */
import { FONT_UI } from './panel.ts';

type Ctx2D = CanvasRenderingContext2D;

/** Slate (lounge kit `LT.chalk`, L* 29) + chalk inks. */
export const SLATE = '#2F4A4A';
export const CHALK = { white: '#F2EEE4', butter: '#F6D98A', red: '#F0705F', muted: '#A9BDB8', pink: '#F2B8C6' };

/** Local day key ('2026-09-28'). */
export const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** Board label for a tool name: `mcp__srv__do_thing` → `do_thing`; ≤ 14 chars. */
export function toolLabel(t: unknown): string {
  let s = String(t ?? '').trim();
  const m = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(s);
  if (m) s = m[1];
  if (s.length > 14) s = s.slice(0, 13) + '…';
  return s || '?';
}

/**
 * Tools used today: counts `tool` events (+ one per agent's current tool the first time it is seen, so the board has
 * something the moment you load). Resets at local midnight.
 */
export function createToolTally() {
  let day: string | null = null;
  const counts = new Map<string, number>();
  const seeded = new Set<string>();
  const roll = (now: number) => { const k = dayKey(now); if (k !== day) { day = k; counts.clear(); } };
  return {
    counts,
    add(tool: string | null | undefined, now = Date.now()) {
      if (!tool) return;
      roll(now);
      counts.set(tool, (counts.get(tool) ?? 0) + 1);
    },
    /** First sight of each agent: its current tool counts once. */
    seed(ents: Iterable<{ id: string; activity?: { tool?: string | null } | null }>, now = Date.now()) {
      for (const e of ents) {
        if (seeded.has(e.id)) continue;
        seeded.add(e.id);
        if (e.activity?.tool) this.add(e.activity.tool, now);
      }
    },
    /** Top `n` [{tool, n}] by count (ties: name). */
    top(n = 3, now = Date.now()): { tool: string; n: number }[] {
      roll(now);
      return [...counts].map(([tool, c]) => ({ tool, n: c })).sort((a, b) => b.n - a.n || (a.tool < b.tool ? -1 : 1)).slice(0, n);
    },
    total: () => [...counts.values()].reduce((a, b) => a + b, 0),
  };
}

/**
 * Test results today, in order (`test-pass` / `test-fail`), from live events plus an optional timeline backfill.
 * `marks` = [{ok, at}], newest last; `lastAt` = when the newest mark landed (for the glow).
 */
export function createTestTally() {
  let day: string | null = null;
  const marks: { ok: boolean; at: number }[] = [];
  const keys = new Set<string>();
  let lastAt = -Infinity;
  const roll = (now: number) => { const k = dayKey(now); if (k !== day) { day = k; marks.length = 0; keys.clear(); } };
  const api = {
    marks,
    get lastAt() { return lastAt; },
    /** `kind`: 'test-pass' | 'test-fail' (anything else is ignored); `at`: event time (ms); `key`: dedupe key. */
    add(kind: string, at = Date.now(), key: string | null = null, live = true) {
      if (kind !== 'test-pass' && kind !== 'test-fail') return false;
      roll(Date.now());
      if (dayKey(at) !== day) return false;
      if (key) { if (keys.has(key)) return false; keys.add(key); }
      const m = { ok: kind === 'test-pass', at };
      // keep chronological order (backfill items can arrive after live ones)
      let i = marks.length;
      while (i > 0 && marks[i - 1].at > at) i--;
      marks.splice(i, 0, m);
      if (live) lastAt = performance.now() / 1000;
      return true;
    },
    get pass() { return marks.filter((m) => m.ok).length; },
    get fail() { return marks.filter((m) => !m.ok).length; },
  };
  return api;
}

/**
 * Output-token throughput over all agents: per-agent deltas of `outputTokens` (a reset / new session counts 0), EMA.
 * `sample(ents, tSec)` at ≈ 1 Hz → tokens/s.
 */
export function createThroughput(alpha = 0.35) {
  const last = new Map<string, number>();
  let lastT: number | null = null, tps = 0;
  return {
    get tps() { return tps; },
    sample(ents: Iterable<{ id: string; outputTokens?: number | null }>, t: number) {
      let d = 0;
      const seen = new Set<string>();
      for (const e of ents) {
        const v = e.outputTokens;
        if (v == null || !Number.isFinite(v)) continue;
        seen.add(e.id);
        const p = last.get(e.id);
        if (p != null && v > p) d += v - p;
        last.set(e.id, v);
      }
      for (const id of [...last.keys()]) if (!seen.has(id)) last.delete(id);
      if (lastT != null && t > lastT) tps += alpha * (d / (t - lastT) - tps);
      lastT = t;
      return tps;
    },
  };
}

/** Suggested espresso-steam rate multiplier for a token throughput (AMB hook): idle 0.6, busy → 2.5. */
export const steamFor = (tps: number) => Math.max(0.6, Math.min(2.5, 0.6 + Math.log10(1 + Math.max(0, tps)) * 0.75));

/** Compact count: 1234 → '1.2k'. */
export const shortN = (n: number) => (n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

/**
 * Tally layout (pure, tested): a header strip, pass marks in groups of five (4 strokes + a slash) on up to 2 rows, fails
 * as circled marks on one row; a count column on the right of each row; overflow → "+N" in the count column.
 */
export interface TallyLayout {
  m: number; head: number; rowH: number; mh: number; gw: number; sw: number; cd: number; colW: number; perRow: number;
  groups: number; passShown: number; passMore: number; failShown: number; failMore: number; failPerRow: number; passY: number[]; failY: number;
}
export function tallyLayout(W: number, H: number, pass: number, fail: number): TallyLayout {
  const m = Math.round(H * 0.07), head = Math.round(H * 0.17);
  const colW = Math.round(W * 0.2);
  const rowH = (H - m * 2 - head) / 3;
  const mh = rowH * 0.78, sw = Math.max(12, Math.round(mh * 0.2)); // stroke pitch
  const gw = sw * 4 + Math.round(sw * 1.6);
  const avail = W - m * 2 - colW;
  const perRow = Math.max(1, Math.floor(avail / gw));
  const passShown = Math.min(pass, perRow * 5 * 2);
  const cd = Math.round(rowH * 0.72);
  const failPerRow = Math.max(1, Math.floor(avail / (cd + 10)));
  const failShown = Math.min(fail, failPerRow);
  const top = m + head;
  return {
    m, head, rowH, mh, gw, sw, cd, colW, perRow, failPerRow,
    groups: Math.ceil(passShown / 5), passShown, passMore: pass - passShown, failShown, failMore: fail - failShown,
    passY: [top, top + rowH], failY: top + rowH * 2.5,
  };
}

// ---- drawing ---------------------------------------------------------------------------------------------------------

/** Deterministic 0..1 hash (hand-drawn wobble that does not flicker between redraws). */
const h01 = (a: number, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/** Slate with soft eraser smudges + a thin chalk-dust edge. */
function slate(g: Ctx2D, W: number, H: number, seed: number) {
  g.fillStyle = SLATE; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 7; i++) {
    const x = h01(seed, i) * W, y = h01(seed + 3, i) * H, r = (0.15 + h01(seed + 7, i) * 0.25) * W;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(235,240,232,0.07)'); gr.addColorStop(1, 'rgba(235,240,232,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = 'rgba(242,238,228,0.18)'; g.lineWidth = 3; g.strokeRect(10, 10, W - 20, H - 20);
}

/** Chalk text: a soft wide pass under a crisp pass (chalk grain without a font asset). */
function chalkText(g: Ctx2D, t: string, x: number, y: number, px: number, color: string, o: { weight?: number; align?: CanvasTextAlign; base?: CanvasTextBaseline } = {}) {
  g.font = `${o.weight ?? 800} ${px}px ${FONT_UI}`;
  g.textAlign = o.align ?? 'left'; g.textBaseline = o.base ?? 'alphabetic';
  g.fillStyle = color;
  g.globalAlpha = 0.28; g.fillText(t, x + 1.5, y + 1);
  g.globalAlpha = 0.95; g.fillText(t, x, y);
  g.globalAlpha = 1;
}

/** Fit a font size so `t` spans ≤ w. */
function fitPx(g: Ctx2D, t: string, w: number, px: number, min = 18, weight = 800) {
  while (px > min) { g.font = `${weight} ${px}px ${FONT_UI}`; if (g.measureText(t).width <= w) break; px -= 2; }
  return px;
}

/** A chalk stroke with a little wobble. */
function stroke(g: Ctx2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string, seed: number) {
  const mx = (x0 + x1) / 2 + (h01(seed, 1) - 0.5) * 4, my = (y0 + y1) / 2 + (h01(seed, 2) - 0.5) * 4;
  g.strokeStyle = color; g.lineCap = 'round';
  g.globalAlpha = 0.3; g.lineWidth = w * 1.7;
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke();
  g.globalAlpha = 0.95; g.lineWidth = w;
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke();
  g.globalAlpha = 1;
}

/** Little steaming cup doodle, `s` px tall, top-left at (x, y). */
function cup(g: Ctx2D, x: number, y: number, s: number, color: string) {
  g.strokeStyle = color; g.lineWidth = Math.max(2, s * 0.09); g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y + s * 0.4); g.lineTo(x + s * 0.08, y + s); g.lineTo(x + s * 0.62, y + s); g.lineTo(x + s * 0.7, y + s * 0.4); g.closePath(); g.stroke();
  g.beginPath(); g.arc(x + s * 0.76, y + s * 0.62, s * 0.14, -Math.PI / 2, Math.PI / 2); g.stroke();
  for (const dx of [0.22, 0.46]) {
    g.beginPath(); g.moveTo(x + s * dx, y + s * 0.3);
    g.bezierCurveTo(x + s * (dx + 0.1), y + s * 0.18, x + s * (dx - 0.1), y + s * 0.1, x + s * dx, y - s * 0.02); g.stroke();
  }
}

/**
 * "Today's specials" (Café): title, the top 3 tools today as menu lines (name ····· count), coffees + brew rate.
 */
export function drawSpecials(g: Ctx2D, W: number, H: number, d: { top: { tool: string; n: number }[]; coffees: number; tps: number }) {
  slate(g, W, H, 3);
  const m = Math.round(W * 0.06);
  const title = "Today's specials";
  const tpx = fitPx(g, title, W - 2 * m - H * 0.25, Math.round(H * 0.17));
  cup(g, m, H * 0.07, tpx * 0.9, CHALK.butter);
  chalkText(g, title, m + tpx * 1.3, H * 0.07 + tpx * 0.92, tpx, CHALK.butter);
  stroke(g, m + tpx * 1.3, H * 0.07 + tpx * 1.12, W - m, H * 0.07 + tpx * 1.06, 3, CHALK.butter, 9);
  const rows = d.top.length ? d.top : [];
  const y0 = H * 0.07 + tpx * 1.2, footH = H * 0.2, lh = (H - y0 - footH) / 3;
  const px = Math.round(Math.min(lh * 0.66, H * 0.14));
  for (let i = 0; i < 3; i++) {
    const r = rows[i];
    const y = y0 + lh * (i + 0.72);
    if (!r) { chalkText(g, i === 0 ? '(brewing…)' : '', m, y, Math.round(px * 0.8), CHALK.muted); continue; }
    const name = toolLabel(r.tool);
    chalkText(g, `${i + 1}.`, m, y, px, CHALK.pink);
    const nx = m + px * 1.25;
    chalkText(g, name, nx, y, px, CHALK.white);
    const nw = g.measureText(name).width;
    const cnt = `×${shortN(r.n)}`;
    chalkText(g, cnt, W - m, y, px, CHALK.butter, { align: 'right' });
    const cw = g.measureText(cnt).width;
    // leader dots
    g.fillStyle = CHALK.muted;
    for (let x = nx + nw + 16; x < W - m - cw - 14; x += 18) { g.beginPath(); g.arc(x, y - px * 0.18, 2.6, 0, Math.PI * 2); g.fill(); }
  }
  const fy = H - footH * 0.35;
  const cTxt = `${d.coffees} ${d.coffees === 1 ? 'coffee' : 'coffees'}`, bTxt = `brew ${shortN(d.tps)} tok/s`;
  let fpx = Math.round(footH * 0.52);
  for (; fpx > 16; fpx -= 2) { g.font = `700 ${fpx}px ${FONT_UI}`; if (fpx * 1.35 + g.measureText(cTxt).width + g.measureText(bTxt).width + fpx <= W - 2 * m) break; }
  cup(g, m, fy - fpx * 0.95, fpx, CHALK.white);
  chalkText(g, cTxt, m + fpx * 1.35, fy, fpx, CHALK.white, { weight: 700 });
  chalkText(g, bTxt, W - m, fy, fpx, CHALK.muted, { weight: 700, align: 'right' });
}

/**
 * Lab test tallies: "TESTS TODAY", pass hash marks (groups of 5, white) with the pass count on the right, fails as red
 * circled marks with the fail count; the newest mark glows butter while `glow` > 0.
 */
export function drawTallies(g: Ctx2D, W: number, H: number, d: { marks: { ok: boolean }[]; pass: number; fail: number; glow: number }) {
  slate(g, W, H, 11);
  const L = tallyLayout(W, H, d.pass, d.fail);
  const tpx = Math.round(L.head * 0.62);
  chalkText(g, 'TESTS TODAY', L.m, L.m + tpx, fitPx(g, 'TESTS TODAY', W - 2 * L.m, tpx), CHALK.butter);
  stroke(g, L.m, L.m + L.head * 0.86, W - L.m, L.m + L.head * 0.82, 4, CHALK.butter, 4);
  const newest = d.marks.length ? d.marks[d.marks.length - 1] : null;
  const glowCol = d.glow > 0 ? CHALK.butter : null;
  const cx0 = W - L.m - L.colW / 2; // count column centre
  const npx = Math.round(L.rowH * 0.62);
  // pass rows
  let k = 0;
  for (let gi = 0; gi < L.groups; gi++) {
    const row = Math.floor(gi / L.perRow), col = gi % L.perRow;
    const gx = L.m + col * L.gw, gy = L.passY[row] + (L.rowH - L.mh) / 2;
    const n = Math.min(5, L.passShown - gi * 5);
    for (let q = 0; q < Math.min(4, n); q++) {
      const last = newest?.ok && k === L.passShown - 1;
      const x = gx + L.sw * (q + 0.5) + (h01(k, 3) - 0.5) * 3;
      stroke(g, x, gy + (h01(k, 4) - 0.5) * 4, x + (h01(k, 5) - 0.5) * 5, gy + L.mh, L.sw * 0.5, last && glowCol ? glowCol : CHALK.white, k);
      k++;
    }
    if (n === 5) {
      const last = newest?.ok && k === L.passShown - 1;
      stroke(g, gx - L.sw * 0.3, gy + L.mh * 0.8, gx + L.sw * 4.3, gy + L.mh * 0.2, L.sw * 0.5, last && glowCol ? glowCol : CHALK.white, k + 99);
      k++;
    }
  }
  chalkText(g, L.passMore ? `+${L.passMore}` : String(d.pass), cx0, L.passY[0] + L.rowH * 0.8, npx, CHALK.white, { align: 'center' });
  chalkText(g, 'pass', cx0, L.passY[1] + L.rowH * 0.45, Math.round(npx * 0.5), CHALK.muted, { align: 'center', weight: 700 });
  if (!d.pass && !d.fail) chalkText(g, 'no runs yet', L.m, L.passY[0] + L.rowH * 0.7, Math.round(L.rowH * 0.42), CHALK.muted, { weight: 700 });
  // fail row: a red mark inside a red circle
  const fy = L.failY;
  for (let i = 0; i < L.failShown; i++) {
    const cx = L.m + L.cd / 2 + i * (L.cd + 10), r = L.cd / 2;
    const last = newest && !newest.ok && i === L.failShown - 1 && !L.failMore;
    const col = last && glowCol ? glowCol : CHALK.red;
    g.strokeStyle = col; g.lineWidth = Math.max(5, L.sw * 0.42); g.globalAlpha = 0.95;
    g.beginPath(); g.ellipse(cx, fy, r, r * 0.9, h01(i, 7) - 0.5, 0.2, Math.PI * 2 + 0.1); g.stroke();
    g.globalAlpha = 1;
    stroke(g, cx - 2, fy - r * 0.55, cx + 2, fy + r * 0.55, L.sw * 0.5, col, i + 50);
  }
  chalkText(g, L.failMore ? `+${L.failMore}` : String(d.fail), cx0, fy + npx * 0.2, npx, CHALK.red, { align: 'center' });
  chalkText(g, 'fail', cx0, fy + npx * 0.2 + npx * 0.55, Math.round(npx * 0.45), CHALK.red, { align: 'center', weight: 700 });
}
