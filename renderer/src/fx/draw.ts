/**
 * Canvas painters for every FX tile: vector icons (no emoji, no fonts for pictograms: ART §3.4 / §10 "draw icons in
 * code"), speech / thought / alert bubbles, nameplates, activity glyph discs, floor rings and particle shapes.
 * All tiles are drawn at 2× their on-screen size. Colours come from shared/palette.ts only.
 * Owner: FX.
 */
import { CORE, STATUS, ENV, MISC } from '../../../shared/palette.ts';
import { mixHex } from './rules.ts';
import type { BubbleLayout, BubbleSpec, BoxLayout } from './types.ts';

type Ctx2D = CanvasRenderingContext2D;

export const FONT_UI = 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Ubuntu", "Cantarell", "DejaVu Sans", system-ui, sans-serif';
export const FONT_MONO = 'ui-monospace, "JetBrains Mono", "Cascadia Code", "SF Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace';

const TAU = Math.PI * 2;

/** @pure Clip a string to `max` chars with an ellipsis (code points, so emoji / CJK never split). */
export function clip(s: string | null | undefined, max: number): string {
  const a = Array.from(String(s ?? '').replace(/\s+/g, ' ').trim());
  return a.length <= max ? a.join('') : `${a.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`;
}

/**
 * @pure [FX fix m2-r2] Clip a display name to `max` chars but keep a Big Board twin suffix (" · 2") whole: a long twin
 * name loses letters, never its number ("reviewer-ag… · 2").
 */
export function clipName(s: string | null | undefined, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const m = / · \d+$/.exec(t);
  if (!m || Array.from(t).length <= max) return clip(t, max);
  return `${clip(t.slice(0, m.index), Math.max(2, max - m[0].length))}${m[0]}`;
}

/** @pure [FX fix m2-r2] Name + wait-time line of an alert card / chip: a wide gap, no " · " (a twin's name already has
 *  one: "claude · 2 · ≥ 0:24" read as three fields). */
export const whoLine = (name: string, time: string): string => (name && time ? `${name}  ${time}` : name || time);

/** @pure Shorten a tool id for a bubble title: `mcp__playwright__browser_click` → `playwright · browser click`. */
export function toolTitle(tool: string | null | undefined): string {
  if (!tool) return '';
  const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool);
  if (m) return `${m[1]} · ${m[2].replace(/_/g, ' ')}`;
  return tool;
}

/** Fit text into `maxW` px: shrink the font down to `minPx`, then ellipsize. Returns the font px used + the text. */
function fit(g: Ctx2D, text: string, weight: number, px: number, minPx: number, maxW: number, family = FONT_UI): { size: number; text: string } {
  let s = text;
  let size = px;
  for (; size >= minPx; size -= 2) {
    g.font = `${weight} ${size}px ${family}`;
    if (g.measureText(s).width <= maxW) return { size, text: s };
  }
  size = minPx;
  g.font = `${weight} ${size}px ${family}`;
  const chars = Array.from(s);
  while (chars.length > 1 && g.measureText(`${chars.join('')}…`).width > maxW) chars.pop();
  return { size, text: `${chars.join('').trimEnd()}…` };
}

function rrect(g: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// -------------------------------------------------------------------------------------------------------- icons

/** Icon ids → painter key (tool classes, shell activities, chat icons, specials). */
export const ICON_OF: Readonly<Record<string, string>> = Object.freeze({
  read: 'book', search: 'magnifier', edit: 'pencil', write: 'pencil', test: 'flask', web: 'globe', net: 'globe',
  ask: 'phone', task: 'crowd', todo: 'clipboard', think: 'bulb', bash: 'prompt', other: 'dots', talk: 'speech',
  build: 'gear', git: 'envelope', mcp: 'plug', compact: 'squish',
  // shells (ShellActivity)
  prompt: 'prompt', serve: 'bolt', monitor: 'bars', remote: 'antenna', repl: 'lambda', run: 'play',
  // chat
  coffee: 'coffee', gear: 'gear', check: 'check', heart: 'heart', star: 'star', bulb: 'bulb', note: 'note',
  '!': 'bang', '?': 'question',
});

/**
 * Paint an icon centred at (cx, cy) in a box of size s (ink strokes, `fill` interiors). `id` = any ICON_OF key or
 * painter key.
 */
export function drawIcon(g: Ctx2D, id: string, cx: number, cy: number, s: number, ink: string = CORE.ink, fill: string = CORE.paper) {
  const k = ICON_OF[id] ?? id;
  g.save();
  g.translate(cx, cy);
  g.scale(s / 100, s / 100); // paint in a 100-unit box centred at 0
  g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = ink; g.fillStyle = fill;
  const P = PAINT[k] ?? PAINT.dots;
  P(g, ink, fill);
  g.restore();
}

const line = (g: Ctx2D, pts: number[]) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke(); };
const circ = (g: Ctx2D, x: number, y: number, r: number, f = true, st = true) => { g.beginPath(); g.arc(x, y, r, 0, TAU); if (f) g.fill(); if (st) g.stroke(); };

const PAINT: Record<string, (g: Ctx2D, ink: string, fill: string) => void> = {
  book(g) {
    g.beginPath(); g.moveTo(0, -24); g.quadraticCurveTo(-22, -34, -42, -28); g.lineTo(-42, 30); g.quadraticCurveTo(-22, 24, 0, 34); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(0, -24); g.quadraticCurveTo(22, -34, 42, -28); g.lineTo(42, 30); g.quadraticCurveTo(22, 24, 0, 34); g.closePath(); g.fill(); g.stroke();
    g.lineWidth = 5; line(g, [-32, -12, -12, -8]); line(g, [-32, 4, -12, 8]); line(g, [12, -8, 32, -12]); line(g, [12, 8, 32, 4]);
  },
  magnifier(g) { circ(g, -10, -10, 26); g.lineWidth = 14; line(g, [10, 10, 36, 36]); g.lineWidth = 5; g.beginPath(); g.arc(-10, -10, 15, 3.6, 4.6); g.stroke(); },
  pencil(g, ink) {
    g.save(); g.rotate(-Math.PI / 4);
    g.beginPath(); g.rect(-12, -38, 24, 56); g.fillStyle = ENV.butter; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-12, 18); g.lineTo(0, 42); g.lineTo(12, 18); g.closePath(); g.fillStyle = MISC.trim; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-4, 34); g.lineTo(0, 42); g.lineTo(4, 34); g.closePath(); g.fillStyle = ink; g.fill();
    g.beginPath(); g.rect(-12, -44, 24, 10); g.fillStyle = ENV.rose; g.fill(); g.stroke();
    g.restore();
  },
  flask(g) {
    g.beginPath(); g.moveTo(-10, -38); g.lineTo(-10, -10); g.lineTo(-34, 30); g.quadraticCurveTo(-36, 38, -26, 38); g.lineTo(26, 38); g.quadraticCurveTo(36, 38, 34, 30); g.lineTo(10, -10); g.lineTo(10, -38); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-22, 16); g.lineTo(22, 16); g.lineTo(31, 32); g.lineTo(-31, 32); g.closePath(); g.fillStyle = STATUS.shell; g.fill();
    line(g, [-16, -38, 16, -38]);
    g.lineWidth = 5; circ(g, 4, 4, 4, false); circ(g, -6, -8, 3, false);
  },
  globe(g) {
    circ(g, 0, 0, 38); g.lineWidth = 6;
    g.beginPath(); g.ellipse(0, 0, 16, 38, 0, 0, TAU); g.stroke();
    line(g, [-38, 0, 38, 0]); line(g, [-32, -18, 32, -18]); line(g, [-32, 18, 32, 18]);
  },
  phone(g) {
    g.beginPath(); g.moveTo(-34, -20); g.quadraticCurveTo(-34, -36, -18, -36); g.lineTo(18, -36); g.quadraticCurveTo(34, -36, 34, -20); g.lineTo(26, -10); g.lineTo(14, -18); g.lineTo(-14, -18); g.lineTo(-26, -10); g.closePath(); g.fill(); g.stroke();
    rrect(g, -26, -6, 52, 40, 10); g.fill(); g.stroke();
    g.lineWidth = 5; circ(g, 0, 14, 9, false);
  },
  crowd(g) {
    for (const [x, y, s] of [[-26, 8, 0.8], [26, 8, 0.8], [0, 0, 1]]) {
      g.beginPath(); g.fillStyle = s === 1 ? CORE.clay : CORE.clayLight;
      rrect(g, x - 20 * s, y - 16 * s, 40 * s, 30 * s, 8 * s); g.fill(); g.stroke();
      g.fillStyle = CORE.ink; g.beginPath(); g.arc(x - 7 * s, y - 3 * s, 3.5 * s, 0, TAU); g.arc(x + 7 * s, y - 3 * s, 3.5 * s, 0, TAU); g.fill();
      g.lineWidth = 5; line(g, [x - 10 * s, y + 14 * s, x - 10 * s, y + 26 * s]); line(g, [x + 10 * s, y + 14 * s, x + 10 * s, y + 26 * s]); g.lineWidth = 9;
    }
  },
  clipboard(g) {
    rrect(g, -30, -34, 60, 74, 8); g.fill(); g.stroke();
    rrect(g, -14, -42, 28, 14, 5); g.fillStyle = CORE.ink2; g.fill();
    g.lineWidth = 6;
    for (const y of [-12, 6, 24]) { line(g, [-18, y, -12, y + 5, -4, y - 4]); line(g, [6, y, 20, y]); }
  },
  bulb(g) {
    g.fillStyle = ENV.butter;
    g.beginPath(); g.arc(0, -10, 28, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(12, 22); g.lineTo(-12, 22); g.closePath(); g.fill(); g.stroke();
    g.lineWidth = 7; line(g, [-12, 30, 12, 30]); line(g, [-8, 38, 8, 38]);
    g.lineWidth = 5; line(g, [-8, 6, 0, -4, 8, 6]);
  },
  prompt(g) {
    rrect(g, -42, -32, 84, 64, 12); g.fillStyle = CORE.ink2; g.fill(); g.stroke();
    g.strokeStyle = STATUS.shell; g.lineWidth = 9;
    line(g, [-26, -14, -10, 0, -26, 14]); line(g, [2, 16, 26, 16]);
  },
  dots(g, ink) { g.fillStyle = ink; for (const x of [-26, 0, 26]) { g.beginPath(); g.arc(x, 0, 8, 0, TAU); g.fill(); } },
  speech(g, ink) {
    g.beginPath(); g.ellipse(0, -6, 40, 28, 0, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-14, 18); g.lineTo(-24, 38); g.lineTo(2, 20); g.fill(); g.stroke();
    g.fillStyle = ink; for (const x of [-16, 0, 16]) { g.beginPath(); g.arc(x, -6, 5, 0, TAU); g.fill(); }
  },
  gear(g, ink, fill) {
    g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, r = i % 2 ? 26 : 38; const a2 = a + TAU / 16; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a2) * r, Math.sin(a2) * r); }
    g.closePath(); g.fillStyle = ENV.lavender; g.fill(); g.stroke();
    g.fillStyle = fill; circ(g, 0, 0, 11); // [FX fix m175-r1] hub takes the caller's fill (dots tint it)
  },
  envelope(g) { rrect(g, -40, -26, 80, 54, 6); g.fill(); g.stroke(); g.lineWidth = 7; line(g, [-38, -22, 0, 6, 38, -22]); g.fillStyle = STATUS.blocked; circ(g, 22, 14, 7, true, false); },
  plug(g) {
    rrect(g, -24, -16, 48, 34, 8); g.fillStyle = ENV.sage; g.fill(); g.stroke();
    line(g, [-10, -16, -10, -36]); line(g, [10, -16, 10, -36]); line(g, [0, 18, 0, 30, 18, 40]);
  },
  squish(g) { g.lineWidth = 8; line(g, [-40, -20, -14, 0, -40, 20]); line(g, [40, -20, 14, 0, 40, 20]); g.fillStyle = CORE.clay; circ(g, 0, 0, 9); },
  bolt(g) { g.beginPath(); g.moveTo(8, -42); g.lineTo(-24, 6); g.lineTo(-2, 6); g.lineTo(-10, 42); g.lineTo(24, -8); g.lineTo(2, -8); g.closePath(); g.fillStyle = ENV.butter; g.fill(); g.stroke(); },
  bars(g) {
    rrect(g, -40, -34, 80, 68, 8); g.fill(); g.stroke();
    const cols = [STATUS.working, STATUS.done, ENV.butter];
    [[-26, 14], [-6, 26], [14, 40]].forEach(([x, h], i) => { g.fillStyle = cols[i]; g.fillRect(x, 24 - h, 14, h); });
  },
  antenna(g) {
    rrect(g, -18, -6, 36, 44, 8); g.fill(); g.stroke();
    line(g, [10, -6, 18, -38]); g.fillStyle = STATUS.blocked; circ(g, 18, -40, 6, true, false);
    g.lineWidth = 5; g.beginPath(); g.arc(18, -40, 16, -1.2, 0.2); g.stroke(); g.beginPath(); g.arc(18, -40, 26, -1.1, 0.1); g.stroke();
  },
  lambda(g) { rrect(g, -38, -34, 76, 68, 14); g.fill(); g.stroke(); g.lineWidth = 9; line(g, [-16, -20, -8, -20, 18, 22]); line(g, [2, -2, -18, 22]); },
  play(g) { circ(g, 0, 0, 38); g.fillStyle = STATUS.shellBusy; g.beginPath(); g.moveTo(-10, -20); g.lineTo(22, 0); g.lineTo(-10, 20); g.closePath(); g.fill(); g.stroke(); },
  coffee(g) {
    rrect(g, -28, -18, 44, 48, 8); g.fillStyle = ENV.teal; g.fill(); g.stroke();
    g.beginPath(); g.arc(18, 4, 12, -1.3, 1.3); g.stroke();
    g.lineWidth = 5; line(g, [-16, -26, -10, -34, -16, -42]); line(g, [0, -26, 6, -34, 0, -42]);
  },
  check(g) { circ(g, 0, 0, 38); g.strokeStyle = STATUS.done; g.lineWidth = 12; line(g, [-18, 0, -4, 14, 20, -14]); },
  heart(g) {
    g.beginPath(); g.moveTo(0, 34); g.bezierCurveTo(-50, 2, -34, -40, 0, -16); g.bezierCurveTo(34, -40, 50, 2, 0, 34); g.closePath();
    g.fillStyle = ENV.rose; g.fill(); g.stroke();
  },
  star(g) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, r = i % 2 ? 17 : 40; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fillStyle = ENV.butter; g.fill(); g.stroke();
  },
  note(g) {
    g.fillStyle = ENV.lavender; g.beginPath(); g.ellipse(-16, 24, 14, 10, -0.4, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(22, 16, 14, 10, -0.4, 0, TAU); g.fill(); g.stroke();
    line(g, [-4, 22, -4, -32, 34, -40, 34, 14]);
  },
  bang(g) { g.fillStyle = CORE.paper; g.strokeStyle = CORE.paper; g.lineWidth = 16; line(g, [0, -30, 0, 8]); circ(g, 0, 28, 8, true, false); },
  question(g, ink) { g.lineWidth = 13; g.beginPath(); g.arc(0, -14, 18, Math.PI * 1.1, Math.PI * 2.45); g.lineTo(0, 12); g.stroke(); g.fillStyle = ink; circ(g, 0, 32, 8, true, false); },
};

// -------------------------------------------------------------------------------------------------------- bubbles

export const BUBBLE_TILE = Object.freeze({ w: 512, h: 128 });
export const DOT_TILE = Object.freeze({ w: 96, h: 96 });

/**
 * Bubble tile layout (2× px, `BubbleLayout`): the quad maps the whole tile; `w`/`h` is the painted box (the batch trims
 * UVs to it) and `badge` the "!" badge centre + radius in tile px (the hot sprite overlays it).
 * `statusHex` = badge colour; `who` (alerts): the agent's name leads the timer line ("comet · ≥ 0:27") [FX fix r2], so a
 * queue of cards reads without a nameplate under each.
 */
export function drawBubble(g: Ctx2D, spec: BubbleSpec, statusHex: string, W: number = BUBBLE_TILE.w, H: number = BUBBLE_TILE.h, who = ''): BubbleLayout {
  const alert = spec.kind === 'alert', thought = spec.kind === 'thought';
  const title = alert ? clip(spec.title, 34) : clip(toolTitle(spec.title), 28);
  const name = alert && who ? clipName(who, 16) : '';
  const detail = spec.detail ? whoLine(name, clip(spec.detail, alert ? 20 : 28)) : name;
  const pad = 12, badgeR = 26, tail = thought ? 22 : 16, stroke = 5;
  const iconOnly = !title && !detail;
  // measure
  const tfit = title ? fit(g, title, 800, 28, 20, W - 2 * pad - 2 * badgeR - 24) : { size: 0, text: '' };
  const dfit = detail ? fit(g, detail, 500, 23, 18, W - 2 * pad - 2 * badgeR - 24, FONT_MONO) : { size: 0, text: '' };
  g.font = `800 ${tfit.size}px ${FONT_UI}`; const tw = title ? g.measureText(tfit.text).width : 0;
  g.font = `500 ${dfit.size}px ${FONT_MONO}`; const dw = detail ? g.measureText(dfit.text).width : 0;
  const bodyH = iconOnly ? 2 * badgeR + 2 * 8 : detail && title ? 84 : 64;
  const bodyW = iconOnly ? bodyH : Math.min(W - 2 * stroke, pad + 2 * badgeR + 14 + Math.max(tw, dw) + pad + 8);
  const x0 = Math.round((W - bodyW) / 2), y0 = stroke;
  const fill = CORE.paper;
  // §6.7: '?' means status unknown only — a single violet-edged mark (FX fix r1: was an ink '? ?' cloud that read as
  // an idle 'confused' fidget)
  const edge = alert ? STATUS.blocked : spec.icon === '?' ? STATUS.unknown : CORE.ink;

  g.lineJoin = 'round';
  g.lineWidth = stroke;
  g.strokeStyle = edge; g.fillStyle = fill;
  if (thought) {
    // cloud edge: scallops along the rect + trailing circles toward the head
    rrect(g, x0, y0, bodyW, bodyH, bodyH / 2); g.fill(); g.stroke();
    const bumps = Math.max(3, Math.round(bodyW / 44));
    for (let i = 0; i < bumps; i++) {
      const bx = x0 + bodyH / 2 + ((bodyW - bodyH) * (i + 0.5)) / bumps;
      for (const by of [y0 + 4, y0 + bodyH - 4]) { g.beginPath(); g.arc(bx, by, 11, 0, TAU); g.fill(); g.stroke(); }
    }
    rrect(g, x0 + stroke, y0 + stroke, bodyW - 2 * stroke, bodyH - 2 * stroke, bodyH / 2); g.fill();
    g.beginPath(); g.arc(W / 2 - 6, y0 + bodyH + 9, 7, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.arc(W / 2 - 14, y0 + bodyH + 19, 4, 0, TAU); g.fill(); g.stroke();
  } else {
    rrect(g, x0, y0, bodyW, bodyH, Math.min(bodyH * 0.36, 26)); g.fill(); g.stroke();
    // tail
    const cx = W / 2;
    g.beginPath(); g.moveTo(cx - 13, y0 + bodyH - 2); g.lineTo(cx - 2, y0 + bodyH + tail); g.lineTo(cx + 11, y0 + bodyH - 2); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx - 13, y0 + bodyH); g.lineTo(cx - 2, y0 + bodyH + tail); g.lineTo(cx + 11, y0 + bodyH); g.stroke();
  }
  // badge
  const bx = iconOnly ? x0 + bodyW / 2 : x0 + pad + badgeR, by = y0 + bodyH / 2;
  g.fillStyle = alert ? STATUS.blocked : statusHex;
  g.beginPath(); g.arc(bx, by, badgeR, 0, TAU); g.fill();
  g.lineWidth = 3; g.strokeStyle = CORE.ink; g.stroke();
  if (alert) drawIcon(g, '!', bx, by, badgeR * 1.5);
  else if (iconOnly) drawIcon(g, spec.icon, bx, by, badgeR * 1.55);
  else { g.fillStyle = CORE.paper; g.beginPath(); g.arc(bx, by, badgeR - 5, 0, TAU); g.fill(); drawIcon(g, spec.icon, bx, by, badgeR * 1.4); }
  // text
  const tx = x0 + pad + 2 * badgeR + 12;
  g.textBaseline = 'middle';
  g.fillStyle = CORE.ink;
  if (title) {
    g.font = `800 ${tfit.size}px ${FONT_UI}`;
    g.fillText(tfit.text, tx, detail ? y0 + bodyH * 0.33 : by + 1);
  }
  if (detail) {
    g.font = `500 ${dfit.size}px ${FONT_MONO}`;
    g.fillStyle = alert ? STATUS.blocked : CORE.ink2;
    const dy = title ? y0 + bodyH * 0.7 : by + 1;
    g.fillText(dfit.text, tx, dy);
    if (name && dfit.text.startsWith(name)) { // the name in ink over the red timer line
      g.font = `700 ${dfit.size}px ${FONT_MONO}`; g.fillStyle = CORE.ink;
      g.clearRect(tx - 1, dy - dfit.size * 0.7, g.measureText(name).width + 2, dfit.size * 1.4);
      g.fillStyle = CORE.paper; g.fillRect(tx - 1, dy - dfit.size * 0.7, g.measureText(name).width + 2, dfit.size * 1.4);
      g.fillStyle = CORE.ink; g.fillText(name, tx, dy);
    }
  }
  return { w: bodyW + 2 * stroke, h: y0 + bodyH + tail + stroke, bodyH, badge: alert ? { x: bx, y: by, r: badgeR } : null, titlePx: tfit.size || 28 };
}

export const CHIP_TILE = Object.freeze({ w: 384, h: 80 });

/**
 * [FX fix r3] Compact queued-alert chip: a paper pill with the hot "!" disc and "name · ≥ m:ss" (+ a short tail), used
 * for the non-head cards of a far queue and in a view strip too narrow for the full card. Same badge contract as
 * drawBubble (`badge` → the hot bouncing "!" quad is laid over the painted disc). `who` = agent name, `detail` = wait
 * text ("≥ 0:21").
 */
export function drawChip(g: Ctx2D, who: string, detail: string, W: number = CHIP_TILE.w, H: number = CHIP_TILE.h): BubbleLayout {
  const name = clipName(who || '', 16), time = clip(detail || '', 18);
  const text = whoLine(name, time);
  const pad = 8, badgeR = 20, tail = 10, stroke = 5, bodyH = 50;
  const tfit = fit(g, text, 600, 26, 20, W - 2 * stroke - pad - 2 * badgeR - 10 - 16, FONT_MONO);
  g.font = `600 ${tfit.size}px ${FONT_MONO}`;
  const tw = g.measureText(tfit.text).width;
  const bodyW = Math.min(W - 2 * stroke, pad + 2 * badgeR + 10 + tw + 16);
  const x0 = Math.round((W - bodyW) / 2), y0 = stroke;
  g.lineJoin = 'round'; g.lineWidth = stroke; g.strokeStyle = STATUS.blocked; g.fillStyle = CORE.paper;
  rrect(g, x0, y0, bodyW, bodyH, bodyH / 2); g.fill(); g.stroke();
  const cx = W / 2;
  g.beginPath(); g.moveTo(cx - 9, y0 + bodyH - 2); g.lineTo(cx - 1, y0 + bodyH + tail); g.lineTo(cx + 8, y0 + bodyH - 2); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(cx - 9, y0 + bodyH); g.lineTo(cx - 1, y0 + bodyH + tail); g.lineTo(cx + 8, y0 + bodyH); g.stroke();
  const bx = x0 + pad + badgeR, by = y0 + bodyH / 2;
  g.fillStyle = STATUS.blocked; g.beginPath(); g.arc(bx, by, badgeR, 0, TAU); g.fill();
  g.lineWidth = 3; g.strokeStyle = CORE.ink; g.stroke();
  drawIcon(g, '!', bx, by, badgeR * 1.5);
  const tx = bx + badgeR + 10;
  g.textBaseline = 'middle'; g.font = `600 ${tfit.size}px ${FONT_MONO}`;
  const nm = name && tfit.text.startsWith(name) ? name : '';
  g.fillStyle = CORE.ink;
  if (nm) { g.font = `800 ${tfit.size}px ${FONT_MONO}`; g.fillText(nm, tx, by + 1); g.font = `600 ${tfit.size}px ${FONT_MONO}`; }
  const nw = nm ? g.measureText(nm).width : 0;
  g.fillStyle = STATUS.blocked; g.fillText(tfit.text.slice(nm.length), tx + nw, by + 1);
  return { w: bodyW + 2 * stroke, h: y0 + bodyH + tail + stroke, bodyH, badge: { x: bx, y: by, r: badgeR }, titlePx: tfit.size };
}

/**
 * Collapsed bubble (declutter, ART §8.4). [FX fix m175-r1] A dot always carries its glyph: the alert dot is the
 * blocked badge (red disc, ink rim, bold ink "!"); any other dot is a disc tinted by its status with the activity icon
 * on it (icon interiors take the tint too), so no collapsed dot ever reads as an empty paper bubble. The old dot drew
 * the paper "!" painter on a paper disc (blank white discs in the m175 shots).
 */
export function drawDot(g: Ctx2D, icon: string, statusHex: string, W: number = DOT_TILE.w) {
  const r = W / 2 - 6, c = W / 2;
  if (icon === '!' || icon === 'bang') {
    g.fillStyle = STATUS.blocked; g.strokeStyle = CORE.ink; g.lineWidth = 5;
    g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = CORE.paper; g.lineWidth = 3; // a thin paper halo inside the rim lifts it off dark walls
    g.beginPath(); g.arc(c, c, r - 5, 0, TAU); g.stroke();
    // bold ink "!" (bar through the centre, so the tile's centre is always ink)
    g.strokeStyle = CORE.ink; g.fillStyle = CORE.ink; g.lineCap = 'round'; g.lineWidth = r * 0.3;
    g.beginPath(); g.moveTo(c, c - r * 0.55); g.lineTo(c, c + r * 0.18); g.stroke();
    g.beginPath(); g.arc(c, c + r * 0.52, r * 0.15, 0, TAU); g.fill();
    return;
  }
  const tint = mixHex(statusHex, CORE.paper, 0.72);
  g.fillStyle = tint; g.strokeStyle = CORE.ink; g.lineWidth = 4;
  g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill(); g.stroke();
  g.strokeStyle = statusHex; g.lineWidth = 5;
  g.beginPath(); g.arc(c, c, r - 6, 0, TAU); g.stroke();
  drawIcon(g, icon, c, c, r * 1.25, CORE.ink, mixHex(statusHex, CORE.paper, 0.86));
}

// -------------------------------------------------------------------------------------------------------- plates

export const PLATE_TILE = Object.freeze({ w: 512, h: 64 });

/**
 * Nameplate pill in the workspace colour (ART §8.2 as amended by §5.5: deep jewels → paper lettering). Returns the
 * painted box.
 */
export function drawPlate(g: Ctx2D, name: string, tab: string, wsHex: string, W: number = PLATE_TILE.w, H: number = PLATE_TILE.h): BoxLayout {
  const n = clipName(name, 18), t = tab ? clip(tab, 12) : '';
  g.font = `800 34px ${FONT_UI}`; const nw = g.measureText(n).width;
  // [FX fix m2-r2] the tab is an inset chip (a folder-tab glyph + the tab name in the workspace's deep shade), never a
  // " · tab" suffix: a Big Board twin number ("tinker · 2") and a tab named "2" must not read alike
  const TAB_ICON = 20, chipPad = 10;
  g.font = `700 25px ${FONT_UI}`; const tw = t ? g.measureText(t).width : 0;
  const chipW = t ? chipPad + TAB_ICON + 6 + tw + chipPad : 0;
  // [FX fix r2] a paper-rimmed workspace dot leads the name (the roster's "● workspace" cue), in place of the default
  // tab suffix the plate no longer repeats
  const dot = 11, dotW = dot * 2 + 10;
  const pw = Math.min(W - 6, dotW + nw + (t ? 12 + chipW : 0) + 40), ph = H - 8;
  const x0 = (W - pw) / 2, y0 = 4;
  rrect(g, x0, y0, pw, ph, ph / 2);
  g.fillStyle = wsHex; g.fill();
  g.lineWidth = 3; g.strokeStyle = CORE.ink; g.stroke();
  const cy = y0 + ph / 2;
  const deep = mixHex(wsHex, CORE.ink, 0.5);
  // a solid dot in the workspace colour's deep shade with a small paper glint (a paper ring read as the letter 'o')
  g.beginPath(); g.arc(x0 + 16 + dot, cy, dot, 0, TAU); g.fillStyle = deep; g.fill();
  g.beginPath(); g.arc(x0 + 16 + dot - 3.5, cy - 3.5, 3, 0, TAU); g.fillStyle = CORE.paper; g.fill();
  g.textBaseline = 'middle';
  g.font = `800 34px ${FONT_UI}`; g.fillStyle = CORE.paper;
  const tx = x0 + 16 + dotW;
  g.save(); g.beginPath(); g.rect(x0, y0, pw - (t ? chipW + 20 : 16), ph); g.clip(); // a clipped name never runs under the chip
  g.fillText(n, tx, cy + 1);
  g.restore();
  if (t) {
    const ch = ph - 16, cx0 = x0 + pw - 8 - chipW, cy0 = cy - ch / 2;
    rrect(g, cx0, cy0, chipW, ch, 9); g.fillStyle = deep; g.fill();
    // folder-tab glyph: a small card with a raised tab on its top-left
    const ix = cx0 + chipPad, iy = cy - 7, iw = TAB_ICON, ih = 14;
    g.beginPath();
    g.moveTo(ix, iy + ih); g.lineTo(ix, iy - 2); g.lineTo(ix + 8, iy - 2); g.lineTo(ix + 10, iy + 2); g.lineTo(ix + iw, iy + 2); g.lineTo(ix + iw, iy + ih); g.closePath();
    g.lineWidth = 2.5; g.lineJoin = 'round'; g.strokeStyle = CORE.paper; g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
    g.font = `700 25px ${FONT_UI}`; g.fillStyle = CORE.paper;
    g.fillText(t, ix + iw + 6, cy + 1);
  }
  return { w: pw + 6, h: ph + 8 };
}

// -------------------------------------------------------------------------------------------------------- glyphs

export const GLYPH_TILE = Object.freeze({ w: 128, h: 128 });

/** Activity glyph (§6.7): non-emissive paper pictogram disc with an ink outline. */
export function drawGlyph(g: Ctx2D, icon: string, W: number = GLYPH_TILE.w) {
  const r = W / 2 - 8;
  g.fillStyle = CORE.paper; g.strokeStyle = CORE.ink; g.lineWidth = 7;
  g.beginPath(); g.arc(W / 2, W / 2, r, 0, TAU); g.fill(); g.stroke();
  drawIcon(g, icon, W / 2, W / 2, r * 1.3);
}

// -------------------------------------------------------------------------------------------------------- shapes

/** Particle / ring / prop shapes, drawn white (tinted by the vertex colour) unless noted. */
export const SHAPES = Object.freeze({
  ring2: { w: 256, h: 256 }, ring6: { w: 256, h: 256 }, ring8: { w: 256, h: 256 }, ripple: { w: 256, h: 256 },
  confetti: { w: 32, h: 32 }, puff: { w: 64, h: 64 }, star: { w: 64, h: 64 }, z: { w: 64, h: 64 }, drop: { w: 32, h: 64 },
  spark: { w: 64, h: 32 }, paperBall: { w: 64, h: 64 }, capsule: { w: 64, h: 128 }, cloud: { w: 256, h: 160 },
  cobweb: { w: 128, h: 128 }, stillHere: { w: 256, h: 160 }, mote: { w: 16, h: 16 }, badge: { w: 96, h: 96 },
  tick: { w: 64, h: 64 }, solid: { w: 8, h: 8 }, knob: { w: 32, h: 32 },
  // [FX M3.5] moments (fx/moments.ts): the blocked paper lantern, the prompt paper plane, pat hearts
  lantern: { w: 96, h: 144 }, plane: { w: 112, h: 64 }, heart: { w: 64, h: 64 },
});

/** Ring radius in the 256 tile (px) ↔ RING_R m in the world. Width px = width_m / RING_R · 110. */
export const RING_PX = 110;
export const RING_R = 0.5;

export type ShapeKey = keyof typeof SHAPES;

export function drawShape(g: Ctx2D, k: ShapeKey, W: number, H: number) {
  g.fillStyle = '#FFFFFF'; g.strokeStyle = '#FFFFFF';
  const cx = W / 2, cy = H / 2;
  switch (k) {
    case 'ring2': case 'ring6': case 'ring8': {
      const wm = k === 'ring2' ? 0.02 : k === 'ring6' ? 0.06 : 0.08;
      const lw = Math.max(3, (wm / RING_R) * RING_PX);
      g.lineWidth = lw; g.beginPath(); g.arc(cx, cy, RING_PX, 0, TAU); g.stroke();
      return;
    }
    case 'ripple': {
      const grd = g.createRadialGradient(cx, cy, RING_PX - 10, cx, cy, RING_PX + 6);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.6, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, RING_PX + 8, 0, TAU); g.fill();
      return;
    }
    case 'confetti': rrect(g, 4, 9, W - 8, H - 18, 3); g.fill(); return;
    case 'solid': g.fillRect(0, 0, W, H); return; // [FX fix r2] leader lines (tinted by the vertex colour)
    case 'knob': g.beginPath(); g.arc(cx, cy, W / 2 - 1, 0, TAU); g.fill(); return; // [FX fix m2-r1] alert tether knob (tinted)
    case 'puff': {
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, W / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      return;
    }
    case 'mote': { const grd = g.createRadialGradient(cx, cy, 0, cx, cy, W / 2); grd.addColorStop(0, '#FFF'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, W, H); return; }
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i / 8) * TAU, r = i % 2 ? 7 : 30; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.closePath(); g.fill();
      return;
    }
    case 'spark': { const grd = g.createLinearGradient(0, 0, W, 0); grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, '#FFF'); g.fillStyle = grd; rrect(g, 2, cy - 5, W - 4, 10, 5); g.fill(); return; }
    case 'z': {
      g.fillStyle = CORE.paper; g.strokeStyle = CORE.ink; g.lineWidth = 7; g.lineJoin = 'round';
      g.font = `900 52px ${FONT_UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeText('Z', cx, cy + 2); g.fillText('Z', cx, cy + 2);
      return;
    }
    case 'drop': g.beginPath(); g.moveTo(cx, 4); g.quadraticCurveTo(cx + 12, H * 0.6, cx, H - 6); g.quadraticCurveTo(cx - 12, H * 0.6, cx, 4); g.fill(); return;
    case 'paperBall': {
      // crumpled paper ball with a red cross (a crossed-out attempt)
      g.fillStyle = MISC.trim; g.strokeStyle = CORE.ink; g.lineWidth = 4;
      g.beginPath();
      for (let i = 0; i < 11; i++) { const a = (i / 11) * TAU, r = 24 + ((i * 7) % 5) * 1.6; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
      g.lineWidth = 2.5; g.strokeStyle = CORE.slate;
      line(g, [cx - 14, cy - 6, cx - 2, cy + 2, cx + 10, cy - 10]); line(g, [cx - 8, cy + 12, cx + 6, cy + 6]);
      g.strokeStyle = STATUS.blocked; g.lineWidth = 5; g.lineCap = 'round';
      line(g, [cx - 13, cy - 13, cx + 13, cy + 13]); line(g, [cx + 13, cy - 13, cx - 13, cy + 13]);
      return;
    }
    case 'capsule': {
      g.fillStyle = CORE.clay; g.strokeStyle = CORE.ink; g.lineWidth = 5;
      rrect(g, 14, 10, W - 28, H - 20, (W - 28) / 2); g.fill(); g.stroke();
      g.fillStyle = MISC.trim; g.fillRect(16, cy - 8, W - 32, 16); g.strokeRect(16, cy - 8, W - 32, 16);
      return;
    }
    case 'cloud': {
      // grey rain cloud with a darker belly and a glum face
      const blobs = [[70, 92, 44], [120, 70, 56], [178, 86, 48], [100, 108, 40], [160, 112, 40], [210, 110, 32], [44, 116, 28]];
      g.fillStyle = CORE.ink2;
      for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r + 5, 0, TAU); g.fill(); }
      g.fillStyle = '#8F8A93';
      for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
      g.fillStyle = '#B3AEB6';
      for (const [x, y, r] of blobs.slice(0, 3)) { g.beginPath(); g.arc(x - r * 0.15, y - r * 0.2, r * 0.7, 0, TAU); g.fill(); }
      g.fillStyle = CORE.ink; g.beginPath(); g.arc(112, 104, 5, 0, TAU); g.arc(146, 104, 5, 0, TAU); g.fill();
      g.strokeStyle = CORE.ink; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.arc(129, 128, 10, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      return;
    }
    case 'cobweb': {
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
      const o = [4, 4];
      for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); line(g, [o[0], o[1], o[0] + Math.cos(a) * 120, o[1] + Math.sin(a) * 120]); }
      for (const r of [28, 52, 78, 104]) {
        g.beginPath();
        for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); const rr = r - (i % 2) * 5; g.lineTo(o[0] + Math.cos(a) * rr, o[1] + Math.sin(a) * rr); }
        g.stroke();
      }
      return;
    }
    case 'stillHere': {
      // hand-lettered "still here?" card on a stick
      g.fillStyle = CORE.ink2; g.fillRect(cx - 5, 96, 10, 60);
      g.save(); g.translate(cx, 58); g.rotate(-0.06);
      g.fillStyle = MISC.whiteboard; g.strokeStyle = CORE.ink; g.lineWidth = 5;
      rrect(g, -116, -46, 232, 92, 10); g.fill(); g.stroke();
      g.fillStyle = CORE.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 40px ${FONT_UI}`; g.fillText('still here?', 0, 2);
      g.restore();
      return;
    }
    case 'badge': {
      // the blocked "!" badge (drawn white/red; the hot sprite multiplies by 2.5)
      g.fillStyle = STATUS.blocked; g.beginPath(); g.arc(cx, cy, W / 2 - 4, 0, TAU); g.fill();
      drawIcon(g, '!', cx, cy, W * 0.6);
      return;
    }
    case 'tick': drawIcon(g, 'check', cx, cy, W - 8); return;
    case 'heart': drawIcon(g, 'heart', cx, cy + 2, W - 6); return; // [FX M3.5] pat hearts (rose, ink rim; tint white)
    case 'lantern': drawLantern(g, W, H); return;
    case 'plane': drawPlane(g, W, H); return;
  }
}

/**
 * [FX M3.5] Red paper lantern (GD #10, blocked > 60 s): ink cap + hanger loop on top, a ribbed coral paper body lit
 * from inside (butter core), a paper "!" disc on its belly, a bottom cap and a tassel. Painted in colour (tint white).
 */
function drawLantern(g: Ctx2D, W: number, H: number) {
  const cx = W / 2, top = 22, bot = H - 34, bh = bot - top, rw = W / 2 - 6, cy = top + bh / 2;
  g.lineJoin = 'round'; g.lineCap = 'round';
  // hanger loop + top cap
  g.strokeStyle = CORE.ink; g.lineWidth = 4;
  g.beginPath(); g.arc(cx, 9, 6, 0, TAU); g.stroke();
  g.fillStyle = CORE.ink2; rrect(g, cx - 18, top - 8, 36, 12, 3); g.fill();
  // body: a squashed sphere, coral paper lit from inside
  g.beginPath(); g.ellipse(cx, cy, rw, bh / 2, 0, 0, TAU);
  const grd = g.createRadialGradient(cx, cy + 4, 4, cx, cy, rw * 1.1);
  grd.addColorStop(0, ENV.butter); grd.addColorStop(0.35, '#F58A5E'); grd.addColorStop(1, STATUS.blocked);
  g.fillStyle = grd; g.fill();
  // ribs (bamboo hoops seen edge-on) + the paper's vertical seams
  g.save(); g.clip();
  g.strokeStyle = 'rgba(122,42,32,0.55)'; g.lineWidth = 3;
  for (let i = 1; i < 6; i++) { const y = top + (bh * i) / 6; g.beginPath(); g.moveTo(cx - rw, y); g.quadraticCurveTo(cx, y + 7, cx + rw, y); g.stroke(); }
  g.lineWidth = 2; g.strokeStyle = 'rgba(122,42,32,0.35)';
  for (const k of [-0.55, 0.55]) { g.beginPath(); g.ellipse(cx, cy, rw * Math.abs(k), bh / 2, 0, k < 0 ? Math.PI / 2 : -Math.PI / 2, k < 0 ? Math.PI * 1.5 : Math.PI / 2); g.stroke(); }
  g.restore();
  g.beginPath(); g.ellipse(cx, cy, rw, bh / 2, 0, 0, TAU); g.strokeStyle = CORE.ink; g.lineWidth = 4; g.stroke();
  // paper "!" disc on the belly
  g.fillStyle = CORE.paper; g.strokeStyle = CORE.ink; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy + 2, 17, 0, TAU); g.fill(); g.stroke();
  g.strokeStyle = STATUS.blocked; g.lineWidth = 6; line(g, [cx, cy - 8, cx, cy + 4]);
  g.fillStyle = STATUS.blocked; g.beginPath(); g.arc(cx, cy + 10, 3.2, 0, TAU); g.fill();
  // bottom cap + tassel
  g.fillStyle = CORE.ink2; rrect(g, cx - 14, bot - 4, 28, 10, 3); g.fill();
  g.strokeStyle = STATUS.blocked; g.lineWidth = 3;
  for (const dx of [-5, -2, 1, 4]) line(g, [cx + dx * 0.4, bot + 6, cx + dx, H - 6]);
  g.fillStyle = ENV.butter; g.beginPath(); g.arc(cx, bot + 9, 4, 0, TAU); g.fill();
}

/** [FX M3.5] Paper plane, nose to +x (the moments batch rotates it along its flight). Paper, ink rim, a fold line. */
function drawPlane(g: Ctx2D, W: number, H: number) {
  g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = CORE.ink; g.lineWidth = 4;
  const nx = W - 6, ny = H * 0.42;
  // far wing (shaded) then near wing + keel
  g.fillStyle = CORE.oat; g.beginPath(); g.moveTo(nx, ny); g.lineTo(8, 6); g.lineTo(30, ny + 2); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = CORE.paper; g.beginPath(); g.moveTo(nx, ny); g.lineTo(6, H * 0.58); g.lineTo(24, H - 8); g.closePath(); g.fill(); g.stroke();
  g.lineWidth = 3; line(g, [nx, ny, 22, H * 0.62]);
  g.strokeStyle = STATUS.working; g.lineWidth = 3; line(g, [40, H * 0.66, 70, H * 0.54]); // a blue pen stripe (a prompt)
}

// -------------------------------------------------------------------------------------------------------- flare

export const FLARE_TILE = Object.freeze({ w: 448, h: 72 });

/**
 * [FX M3.5] Struggle flare (struggle.level ≥ 2): a paper tag with a signal-flare disc (butter at level 2, coral at 3)
 * and the short `struggle.detail` ("3 test fails in a row"). One line, ≤ 30 chars, ellipsized. Returns the painted box.
 */
export function drawFlare(g: Ctx2D, text: string, level = 2, W: number = FLARE_TILE.w, H: number = FLARE_TILE.h): BoxLayout {
  const hot = level >= 3 ? STATUS.blocked : '#F2A03D';
  const stroke = 4, bodyH = H - 2 * stroke - 4, r = bodyH / 2 - 5;
  const t = clip(text || '', 30);
  const f = fit(g, t, 800, 30, 22, W - 2 * stroke - (r * 2 + 30) - 18);
  g.font = `800 ${f.size}px ${FONT_UI}`;
  const tw = g.measureText(f.text).width;
  const bodyW = Math.min(W - 2 * stroke, 10 + r * 2 + 12 + tw + 20);
  const x0 = Math.round((W - bodyW) / 2), y0 = stroke + 2;
  g.lineJoin = 'round'; g.lineWidth = stroke; g.strokeStyle = CORE.ink; g.fillStyle = CORE.paper;
  rrect(g, x0, y0, bodyW, bodyH, 12); g.fill(); g.stroke();
  // flare disc: a star-burst in the level colour with an ink rim
  const bx = x0 + 10 + r, by = y0 + bodyH / 2;
  g.fillStyle = hot; g.beginPath();
  for (let i = 0; i < 16; i++) { const a = -Math.PI / 2 + (i / 16) * TAU, rr = i % 2 ? r * 0.62 : r; g.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr); }
  g.closePath(); g.fill(); g.lineWidth = 2.5; g.stroke();
  g.fillStyle = CORE.paper; g.beginPath(); g.arc(bx, by, r * 0.3, 0, TAU); g.fill();
  g.textBaseline = 'middle'; g.fillStyle = CORE.ink; g.font = `800 ${f.size}px ${FONT_UI}`;
  g.fillText(f.text, bx + r + 12, by + 1);
  return { w: bodyW + 2 * stroke, h: bodyH + 2 * stroke + 4 };
}
