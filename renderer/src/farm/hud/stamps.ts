/**
 * The stamp book (model/stamps.ts) on screen: every stamp is a hand-drawn rubber stamp painted on a canvas (a
 * category shape and ink, the stamp's own little drawing, the date it was inked across a band, a seeded tilt and worn
 * ink), shown on a page of the Almanac panel (the Stamps tab, hud/almanac.ts) and in the toast when one is earned.
 * Unearned stamps are a faint dashed outline with a ghost of the drawing and a hint (and a progress bar where it
 * counts); secret ones are just a "?" until earned.
 */
import './stamps.css';
import { CAT_NAME, STAMP_CATS, TROPHIES, bitsFor } from '../model/stamps.ts';
import type { Motif, StampCat, StampDef, StampEntry, StampsView } from '../model/stamps.ts';
import { coins } from '../model/shop.ts';
import { h } from './ctx.ts';

/** ink per category */
export const CAT_INK: Readonly<Record<StampCat, string>> = Object.freeze({
  work: '#b83b2b', pastimes: '#2c6c9e', village: '#a8406f', explorer: '#3c7a3a', seasons: '#c46a1c', home: '#5b4aa0',
});
type Shape = 'circle' | 'scallop' | 'square' | 'hex' | 'oval' | 'house';
const CAT_SHAPE: Readonly<Record<StampCat, Shape>> = Object.freeze({
  work: 'circle', pastimes: 'scallop', village: 'square', explorer: 'hex', seasons: 'oval', home: 'house',
});

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** "02 OCT 26" from YYYY-MM-DD */
export function stampDate(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d} ${MON[Number(m) - 1] ?? ''} ${y.slice(2)}`;
}

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------------------------
// Drawing

type C2 = CanvasRenderingContext2D;

/** the stamp's outline (centred at 0,0; ~radius 1) as a path */
function shapePath(g: C2, shape: Shape, r: number): void {
  g.beginPath();
  if (shape === 'circle') g.arc(0, 0, r, 0, Math.PI * 2);
  else if (shape === 'scallop') {
    const n = 14;
    for (let i = 0; i <= n * 8; i++) {
      const a = (i / (n * 8)) * Math.PI * 2, rr = r * (0.94 + 0.06 * Math.abs(Math.cos((a * n) / 2)));
      if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
  } else if (shape === 'square') g.roundRect(-r * 0.86, -r * 0.86, r * 1.72, r * 1.72, r * 0.22);
  else if (shape === 'hex') for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
  else if (shape === 'oval') g.ellipse(0, 0, r, r * 0.8, 0, 0, Math.PI * 2);
  else { // house: a pentagon with a roof
    g.moveTo(0, -r); g.lineTo(r * 0.9, -r * 0.25); g.lineTo(r * 0.9, r * 0.85); g.lineTo(-r * 0.9, r * 0.85); g.lineTo(-r * 0.9, -r * 0.25);
  }
  g.closePath();
}

/** Each motif draws in a unit box (−1..1, y down) with the current stroke / fill (the ink). */
const M: Record<Motif, (g: C2) => void> = {
  crate: (g) => { box(g, -0.75, -0.55, 1.5, 1.1); line(g, -0.75, -0.1, 0.75, -0.1); line(g, -0.75, 0.25, 0.75, 0.25); line(g, -0.75, -0.55, 0.75, 0.55); },
  crates: (g) => { for (const [x, y] of [[-0.45, 0.25], [0.45, 0.25], [0, -0.45]]) { box(g, x - 0.38, y - 0.32, 0.76, 0.64); line(g, x - 0.38, y - 0.32, x + 0.38, y + 0.32); } },
  flame: (g) => {
    g.beginPath(); g.moveTo(0, -0.95); g.bezierCurveTo(0.55, -0.35, 0.75, 0.1, 0.55, 0.5); g.bezierCurveTo(0.35, 0.95, -0.35, 0.95, -0.55, 0.5);
    g.bezierCurveTo(-0.75, 0.1, -0.35, -0.2, 0, -0.95); g.fill();
    g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(0, -0.1); g.bezierCurveTo(0.3, 0.2, 0.3, 0.75, 0, 0.75); g.bezierCurveTo(-0.3, 0.75, -0.3, 0.2, 0, -0.1); g.fill(); g.restore();
  },
  sprout: (g) => { line(g, 0, 0.9, 0, -0.1); leaf(g, 0, -0.1, -0.6, -0.55); leaf(g, 0, 0.15, 0.65, -0.3); line(g, -0.6, 0.9, 0.6, 0.9); },
  can: (g) => {
    g.beginPath(); g.moveTo(-0.55, -0.2); g.lineTo(0.35, -0.2); g.lineTo(0.3, 0.7); g.lineTo(-0.5, 0.7); g.closePath(); g.fill();
    line(g, 0.3, 0.05, 0.85, -0.45); g.beginPath(); g.arc(-0.1, -0.25, 0.38, Math.PI, 0); g.stroke();
    for (const [x, y] of [[0.95, -0.15], [0.8, 0.1], [1.0, 0.15]]) dot(g, x, y, 0.07);
  },
  letter: (g) => { box(g, -0.85, -0.55, 1.7, 1.1); g.beginPath(); g.moveTo(-0.85, -0.55); g.lineTo(0, 0.1); g.lineTo(0.85, -0.55); g.stroke(); heartAt(g, 0, 0.3, 0.22); },
  crowd: (g) => { for (let i = 0; i < 5; i++) { const x = -0.72 + i * 0.36, y = i % 2 ? -0.05 : 0.15; dot(g, x, y - 0.25, 0.15); g.beginPath(); g.arc(x, y + 0.35, 0.2, Math.PI, 0); g.fill(); } line(g, -0.95, 0.55, 0.95, 0.55); },
  field: (g) => {
    for (let i = 0; i < 4; i++) { const y = -0.45 + i * 0.36; line(g, -0.9 + i * 0.05, y, 0.9 - i * 0.05, y); for (let k = 0; k < 4; k++) leaf(g, -0.6 + k * 0.4, y, -0.6 + k * 0.4 + 0.12, y - 0.2); }
    line(g, -0.95, 0.75, 0.95, 0.75);
  },
  moon: (g) => {
    g.beginPath(); g.arc(-0.1, 0.05, 0.75, 0, Math.PI * 2); g.arc(0.2, -0.15, 0.62, 0, Math.PI * 2, true); g.fill('evenodd');
    star(g, 0.65, -0.6, 0.18); star(g, 0.75, 0.4, 0.12);
  },
  fish: (g) => fishAt(g, 0, 0, 1),
  fishes: (g) => { fishAt(g, -0.1, -0.4, 0.62); fishAt(g, 0.15, 0.45, 0.62); },
  ruler: (g) => { fishAt(g, 0, -0.3, 0.75); line(g, -0.9, 0.55, 0.9, 0.55); for (let i = 0; i <= 8; i++) line(g, -0.9 + i * 0.225, 0.55, -0.9 + i * 0.225, i % 4 ? 0.7 : 0.82); },
  mushroom: (g) => {
    g.beginPath(); g.ellipse(0, -0.15, 0.85, 0.6, 0, Math.PI, 0); g.closePath(); g.fill();
    box(g, -0.22, -0.15, 0.44, 0.95);
    g.save(); g.globalCompositeOperation = 'destination-out'; for (const [x, y] of [[-0.4, -0.4], [0.15, -0.5], [0.5, -0.3]]) dot(g, x, y, 0.1); g.restore();
  },
  binoculars: (g) => { for (const s of [-1, 1]) { g.beginPath(); g.arc(s * 0.45, 0.25, 0.38, 0, Math.PI * 2); g.stroke(); box(g, s * 0.45 - 0.22, -0.55, 0.44, 0.5); } line(g, -0.2, -0.2, 0.2, -0.2); },
  rainbow: (g) => { for (const r of [0.85, 0.62, 0.4]) { g.beginPath(); g.arc(0, 0.45, r, Math.PI, 0); g.stroke(); } cloud(g, -0.7, 0.5, 0.3); cloud(g, 0.7, 0.5, 0.3); },
  boot: (g) => { g.beginPath(); g.moveTo(-0.45, -0.85); g.lineTo(0.15, -0.85); g.lineTo(0.15, 0.2); g.lineTo(0.85, 0.35); g.lineTo(0.85, 0.75); g.lineTo(-0.5, 0.75); g.closePath(); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; line(g, -0.4, -0.55, 0.1, -0.55); g.restore(); },
  bottle: (g) => {
    g.save(); g.rotate(-0.5);
    g.beginPath(); g.moveTo(-0.12, -0.95); g.lineTo(0.12, -0.95); g.lineTo(0.12, -0.55); g.quadraticCurveTo(0.42, -0.45, 0.42, -0.2); g.lineTo(0.42, 0.85); g.lineTo(-0.42, 0.85); g.lineTo(-0.42, -0.2); g.quadraticCurveTo(-0.42, -0.45, -0.12, -0.55); g.closePath(); g.stroke();
    box(g, -0.2, -0.1, 0.4, 0.6); g.restore();
  },
  heart: (g) => heartAt(g, 0, 0.05, 0.9),
  hearts: (g) => { heartAt(g, -0.3, -0.15, 0.6); heartAt(g, 0.35, 0.3, 0.55); },
  ribbon: (g) => {
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 0.1, 0.1); g.lineTo(s * 0.5, 0.95); g.lineTo(s * 0.3, 0.8); g.lineTo(s * 0.15, 0.95); g.closePath(); g.fill(); }
    const n = 12; g.beginPath(); for (let i = 0; i <= n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2, r = i % 2 ? 0.48 : 0.62; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, -0.25 + Math.sin(a) * r); } g.fill();
    g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, -0.25, 0.28, 0, Math.PI * 2); g.fill(); g.restore();
  },
  campfire: (g) => { line(g, -0.7, 0.75, 0.7, 0.35); line(g, -0.7, 0.35, 0.7, 0.75); g.save(); g.translate(0, -0.15); g.scale(0.7, 0.7); M.flame(g); g.restore(); },
  notes: (g) => { for (const x of [-0.45, 0.45]) { g.beginPath(); g.ellipse(x - 0.15, 0.55, 0.22, 0.16, -0.4, 0, Math.PI * 2); g.fill(); line(g, x + 0.05, 0.5, x + 0.05, -0.6); } g.save(); g.lineWidth *= 2.2; line(g, -0.4, -0.6, 0.5, -0.75); g.restore(); },
  gift: (g) => { box(g, -0.75, -0.25, 1.5, 1.05); box(g, -0.85, -0.5, 1.7, 0.28); line(g, 0, -0.5, 0, 0.8); for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 0.25, -0.72, 0.25, 0.14, s * 0.4, 0, Math.PI * 2); g.stroke(); } },
  basket: (g) => { g.beginPath(); g.moveTo(-0.85, -0.05); g.lineTo(0.85, -0.05); g.lineTo(0.6, 0.8); g.lineTo(-0.6, 0.8); g.closePath(); g.stroke(); g.beginPath(); g.arc(0, -0.05, 0.6, Math.PI, 0); g.stroke(); for (const y of [0.25, 0.52]) line(g, -0.75 + y * 0.25, y, 0.75 - y * 0.25, y); for (const x of [-0.3, 0, 0.3]) line(g, x, -0.05, x * 0.8, 0.8); },
  mountain: (g) => { g.beginPath(); g.moveTo(-0.95, 0.75); g.lineTo(-0.3, -0.35); g.lineTo(0, 0.05); g.lineTo(0.35, -0.6); g.lineTo(0.95, 0.75); g.closePath(); g.fill(); line(g, 0.35, -0.6, 0.35, -0.98); g.beginPath(); g.moveTo(0.35, -0.98); g.lineTo(0.7, -0.88); g.lineTo(0.35, -0.78); g.fill(); },
  cairn: (g) => { const rows: [number, number, number][] = [[0.75, 0.62, 0.22], [0.4, 0.5, 0.18], [0.08, 0.38, 0.16], [-0.2, 0.28, 0.13], [-0.45, 0.19, 0.11], [-0.66, 0.12, 0.09]]; for (const [y, rx, ry] of rows) { g.beginPath(); g.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); } },
  meteor: (g) => { star(g, 0.45, -0.45, 0.35); for (const [o, l] of [[-0.12, 1.1], [0.05, 1.3], [0.2, 0.95]] as const) line(g, 0.25 - o * 0.6, -0.2 + o * 0.6, 0.25 - l * 0.75 - o, -0.2 + l * 0.75 - o); },
  compass: (g) => { g.beginPath(); g.arc(0, 0, 0.82, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(0, -0.7); g.lineTo(0.2, 0); g.lineTo(0, 0.7); g.lineTo(-0.2, 0); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(0, -0.7); g.lineTo(0.2, 0); g.lineTo(-0.2, 0); g.closePath(); g.fill(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; line(g, Math.cos(a) * 0.82, Math.sin(a) * 0.82, Math.cos(a) * 0.98, Math.sin(a) * 0.98); } },
  camera: (g) => { g.beginPath(); g.roundRect(-0.85, -0.4, 1.7, 1.1, 0.15); g.fill(); box(g, -0.3, -0.62, 0.6, 0.24); g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0.15, 0.38, 0, Math.PI * 2); g.fill(); g.restore(); g.beginPath(); g.arc(0, 0.15, 0.22, 0, Math.PI * 2); g.fill(); dot(g, 0.6, -0.22, 0.08); },
  star: (g) => star(g, 0, 0.05, 0.9),
  blossom: (g) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; g.beginPath(); g.ellipse(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0.38, 0.28, a, 0, Math.PI * 2); g.fill(); } g.save(); g.globalCompositeOperation = 'destination-out'; dot(g, 0, 0, 0.2); g.restore(); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; dot(g, Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.05); } },
  lantern: (g) => { line(g, 0, -0.95, 0, -0.75); box(g, -0.3, -0.75, 0.6, 0.12); g.beginPath(); g.ellipse(0, 0, 0.62, 0.68, 0, 0, Math.PI * 2); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; for (const x of [-0.3, 0, 0.3]) { g.beginPath(); g.ellipse(x * 1.2, 0, 0.03, 0.55, 0, 0, Math.PI * 2); g.fill(); } g.restore(); box(g, -0.3, 0.63, 0.6, 0.12); line(g, 0, 0.75, 0, 0.95); },
  cake: (g) => { box(g, -0.8, 0.2, 1.6, 0.6); box(g, -0.5, -0.25, 1.0, 0.45); g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); for (let i = 0; i <= 8; i++) { const x = -0.8 + i * 0.2; g[i ? 'lineTo' : 'moveTo'](x, 0.32 + (i % 2) * 0.1); } g.lineWidth *= 0.8; g.stroke(); g.restore(); line(g, 0, -0.25, 0, -0.6); g.beginPath(); g.ellipse(0, -0.75, 0.08, 0.14, 0, 0, Math.PI * 2); g.fill(); },
  pumpkin: (g) => { for (const [x, rx] of [[-0.38, 0.38], [0.38, 0.38], [0, 0.42]] as const) { g.beginPath(); g.ellipse(x, 0.15, rx, 0.62, 0, 0, Math.PI * 2); g.fill(); } g.save(); g.globalCompositeOperation = 'destination-out'; for (const x of [-0.2, 0.2]) { g.beginPath(); g.ellipse(x, 0.15, 0.02, 0.5, 0, 0, Math.PI * 2); g.fill(); } g.restore(); g.save(); g.lineWidth *= 1.6; line(g, 0, -0.45, 0.12, -0.8); g.restore(); leaf(g, 0.05, -0.55, 0.5, -0.75); },
  jack: (g) => { M.pumpkin(g); g.save(); g.globalCompositeOperation = 'destination-out'; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 0.35, -0.05); g.lineTo(s * 0.12, -0.05); g.lineTo(s * 0.24, -0.28); g.closePath(); g.fill(); } g.beginPath(); g.moveTo(-0.45, 0.3); for (let i = 1; i <= 6; i++) g.lineTo(-0.45 + i * 0.15, 0.3 + (i % 2 ? 0.14 : 0)); g.lineTo(0.3, 0.55); g.lineTo(-0.3, 0.55); g.closePath(); g.fill(); g.restore(); },
  tree: (g) => { for (const [y, w] of [[-0.3, 0.45], [0.15, 0.65], [0.6, 0.85]] as const) { g.beginPath(); g.moveTo(0, y - 0.6); g.lineTo(w, y + 0.12); g.lineTo(-w, y + 0.12); g.closePath(); g.fill(); } box(g, -0.12, 0.72, 0.24, 0.24); star(g, 0, -0.9, 0.2); },
  firework: (g) => { for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; line(g, Math.cos(a) * 0.25, Math.sin(a) * 0.25, Math.cos(a) * 0.85, Math.sin(a) * 0.85); dot(g, Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0.06); } dot(g, 0, 0, 0.1); },
  snowflake: (g) => { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); line(g, 0, 0, c * 0.9, s * 0.9); for (const t of [0.45, 0.68]) { const b = 0.2; line(g, c * t, s * t, c * t + Math.cos(a + 0.8) * b, s * t + Math.sin(a + 0.8) * b); line(g, c * t, s * t, c * t + Math.cos(a - 0.8) * b, s * t + Math.sin(a - 0.8) * b); } } },
  leaf: (g) => { g.beginPath(); g.moveTo(-0.7, 0.75); g.bezierCurveTo(-0.9, -0.3, 0.1, -0.95, 0.85, -0.8); g.bezierCurveTo(0.8, 0.0, 0.1, 0.8, -0.7, 0.75); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; line(g, -0.55, 0.6, 0.6, -0.6); line(g, -0.1, 0.1, -0.35, -0.15); line(g, 0.2, -0.2, 0.35, 0.05); g.restore(); line(g, -0.7, 0.75, -0.9, 0.95); },
  fence: (g) => { for (let i = 0; i < 5; i++) { const x = -0.8 + i * 0.4; g.beginPath(); g.moveTo(x - 0.12, 0.85); g.lineTo(x - 0.12, -0.45); g.lineTo(x, -0.65); g.lineTo(x + 0.12, -0.45); g.lineTo(x + 0.12, 0.85); g.closePath(); g.fill(); } g.save(); g.lineWidth *= 1.4; line(g, -0.95, -0.15, 0.95, -0.15); line(g, -0.95, 0.45, 0.95, 0.45); g.restore(); },
  lamp: (g) => { line(g, 0, -0.35, 0, 0.85); line(g, -0.4, 0.85, 0.4, 0.85); g.beginPath(); g.moveTo(-0.32, -0.35); g.lineTo(0.32, -0.35); g.lineTo(0.22, -0.8); g.lineTo(-0.22, -0.8); g.closePath(); g.fill(); g.beginPath(); g.moveTo(-0.38, -0.8); g.lineTo(0, -1.0); g.lineTo(0.38, -0.8); g.closePath(); g.fill(); for (const a of [-2.6, -0.55, 0]) line(g, Math.cos(a) * 0.48, -0.58 + Math.sin(a) * 0.48, Math.cos(a) * 0.68, -0.58 + Math.sin(a) * 0.68); },
  gnome: (g) => { g.beginPath(); g.moveTo(-0.45, -0.15); g.lineTo(0.1, -0.98); g.lineTo(0.45, -0.15); g.closePath(); g.fill(); dot(g, 0, 0.02, 0.2); g.beginPath(); g.moveTo(-0.38, 0.05); g.quadraticCurveTo(0, 0.95, 0.38, 0.05); g.closePath(); g.stroke(); line(g, -0.55, 0.9, 0.55, 0.9); },
  portrait: (g) => { line(g, -0.45, 0.95, -0.25, -0.2); line(g, 0.45, 0.95, 0.25, -0.2); line(g, 0, 0.95, 0, 0.3); box(g, -0.65, -0.85, 1.3, 1.05); g.save(); g.lineWidth *= 0.8; heartAt(g, 0, -0.3, 0.42); g.restore(); },
  boat: (g) => {
    // a rowboat on two ripple lines, an oar out to each side
    g.beginPath(); g.moveTo(-0.85, -0.05); g.lineTo(0.85, -0.05); g.quadraticCurveTo(0.6, 0.45, 0.35, 0.45); g.lineTo(-0.45, 0.45); g.quadraticCurveTo(-0.75, 0.4, -0.85, -0.05); g.closePath(); g.fill();
    line(g, -0.35, -0.05, -0.75, -0.55); line(g, 0.3, -0.05, 0.7, -0.55);
    for (const y of [0.65, 0.85]) { g.beginPath(); for (let i = 0; i <= 8; i++) { const x = -0.9 + i * 0.225; g[i ? 'lineTo' : 'moveTo'](x, y + (i % 2 ? 0.05 : -0.05)); } g.stroke(); }
  },
  skates: (g) => {
    // a skate boot on its blade, and the figure eight it left behind
    g.beginPath(); g.moveTo(-0.55, -0.85); g.lineTo(-0.05, -0.85); g.lineTo(-0.05, -0.05); g.lineTo(0.6, 0.1); g.quadraticCurveTo(0.75, 0.2, 0.7, 0.35); g.lineTo(-0.6, 0.35); g.closePath(); g.fill();
    g.save(); g.lineWidth *= 1.3; line(g, -0.7, 0.55, 0.75, 0.55); g.beginPath(); g.arc(0.75, 0.42, 0.13, -Math.PI / 2, Math.PI / 2); g.stroke(); g.restore();
    line(g, -0.45, 0.35, -0.45, 0.55); line(g, 0.45, 0.35, 0.45, 0.55);
    g.save(); g.globalCompositeOperation = 'destination-out'; for (const y of [-0.65, -0.45, -0.25]) line(g, -0.4, y, -0.15, y); g.restore();
    g.save(); g.lineWidth *= 0.7; g.beginPath(); g.ellipse(0.5, -0.6, 0.18, 0.13, 0, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.ellipse(0.5, -0.33, 0.2, 0.14, 0, 0, Math.PI * 2); g.stroke(); g.restore();
  },
  snowman: (g) => {
    g.beginPath(); g.arc(0, 0.5, 0.45, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, -0.1, 0.33, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, -0.6, 0.25, 0, Math.PI * 2); g.stroke();
    dot(g, -0.09, -0.65, 0.04); dot(g, 0.09, -0.65, 0.04);
    g.beginPath(); g.moveTo(0, -0.58); g.lineTo(0.3, -0.53); g.lineTo(0, -0.52); g.closePath(); g.fill();
    for (const y of [-0.15, 0.05, 0.4]) dot(g, 0, y, 0.045);
    line(g, -0.3, -0.15, -0.8, -0.45); line(g, 0.3, -0.15, 0.8, -0.45);
    g.beginPath(); g.rect(-0.24, -0.38, 0.48, 0.09); g.fill(); line(g, 0.15, -0.3, 0.22, 0.0);
  },
  egg: (g) => { g.beginPath(); g.ellipse(0, 0.05, 0.5, 0.68, 0, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(-0.95, 0.55); g.quadraticCurveTo(0, 1.05, 0.95, 0.55); g.stroke(); line(g, -0.75, 0.62, -0.95, 0.85); line(g, 0.75, 0.62, 0.95, 0.85); g.beginPath(); g.ellipse(-0.18, -0.22, 0.09, 0.16, 0.3, 0, Math.PI * 2); g.fill(); },
  // a cave mouth behind a curtain of falling water, a crystal glinting inside
  cave: (g) => {
    g.beginPath(); g.moveTo(-0.95, 0.85); g.quadraticCurveTo(-0.9, -0.85, 0, -0.85); g.quadraticCurveTo(0.9, -0.85, 0.95, 0.85); g.stroke();
    for (const x of [-0.55, -0.2, 0.15, 0.5]) line(g, x, -0.95, x + 0.05, 0.75);
    g.beginPath(); g.moveTo(0.62, 0.8); g.lineTo(0.72, 0.3); g.lineTo(0.82, 0.8); g.closePath(); g.fill();
    line(g, -1, 0.88, 1, 0.88);
  },
  house: (g) => { g.beginPath(); g.moveTo(-0.95, -0.05); g.lineTo(0, -0.85); g.lineTo(0.95, -0.05); g.stroke(); box(g, -0.7, -0.15, 1.4, 1.0); g.beginPath(); g.rect(-0.2, 0.3, 0.4, 0.55); g.fill(); box(g, 0.35, 0.05, 0.25, 0.22); box(g, 0.45, -0.8, 0.2, 0.35); },
};

function line(g: C2, x0: number, y0: number, x1: number, y1: number): void { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
function box(g: C2, x: number, y: number, w: number, hh: number): void { g.beginPath(); g.rect(x, y, w, hh); g.stroke(); }
function dot(g: C2, x: number, y: number, r: number): void { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function leaf(g: C2, x0: number, y0: number, x1: number, y1: number): void {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, nx = -(y1 - y0) * 0.35, ny = (x1 - x0) * 0.35;
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx + nx, my + ny, x1, y1); g.quadraticCurveTo(mx - nx, my - ny, x0, y0); g.fill();
}
function heartAt(g: C2, x: number, y: number, s: number): void {
  g.beginPath(); g.moveTo(x, y + s * 0.75);
  g.bezierCurveTo(x - s * 1.1, y + s * 0.05, x - s * 0.6, y - s * 0.85, x, y - s * 0.3);
  g.bezierCurveTo(x + s * 0.6, y - s * 0.85, x + s * 1.1, y + s * 0.05, x, y + s * 0.75);
  g.fill();
}
function star(g: C2, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.42 : r; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.fill();
}
function cloud(g: C2, x: number, y: number, s: number): void { for (const [dx, dy, r] of [[-0.5, 0.1, 0.45], [0, -0.15, 0.6], [0.5, 0.1, 0.45]] as const) dot(g, x + dx * s, y + dy * s, r * s); }
function fishAt(g: C2, x: number, y: number, s: number): void {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.beginPath(); g.ellipse(-0.1, 0, 0.62, 0.36, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(0.4, 0); g.lineTo(0.9, -0.38); g.lineTo(0.9, 0.38); g.closePath(); g.fill();
  g.save(); g.globalCompositeOperation = 'destination-out'; dot(g, -0.42, -0.07, 0.08); g.beginPath(); g.arc(-0.05, 0, 0.3, -1.1, 1.1); g.lineWidth = 0.07; g.stroke(); g.restore();
  g.restore();
}

export type StampLook = 'inked' | 'blank' | 'secret';
const cache = new Map<string, string>();
/** CSS px of the drawn stamp (drawn at 2× for crisp HiDPI) */
export const STAMP_PX = 84;

/** Paint one stamp; returns a PNG data URL (cached per stamp + look + date). */
export function stampImage(def: Pick<StampDef, 'id' | 'cat' | 'motif'>, look: StampLook, day: string | null = null): string {
  const key = `${def.id}|${look}|${day ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = STAMP_PX * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return '';
  const r = rng(hash(def.id));
  const ink = look === 'inked' ? CAT_INK[def.cat] : '#9a8166';
  const shape = CAT_SHAPE[def.cat];
  g.translate(S / 2, S / 2);
  if (look === 'inked') g.rotate((r() - 0.5) * 0.28);
  const R = S * 0.44;
  g.strokeStyle = g.fillStyle = ink;
  g.lineJoin = g.lineCap = 'round';
  if (look === 'inked') {
    // the stamp's double border
    g.lineWidth = S * 0.035; shapePath(g, shape, R); g.stroke();
    g.lineWidth = S * 0.012; shapePath(g, shape, R * 0.86); g.stroke();
    // the drawing, nudged up to leave room for the date band
    g.save(); g.translate(0, -S * 0.08); g.scale(R * 0.5, R * 0.5); g.lineWidth = 0.12; M[def.motif](g); g.restore();
    // the date band
    if (day) {
      const by = S * 0.22, bw = R * (shape === 'house' ? 1.45 : 1.55), bh = S * 0.13;
      g.fillRect(-bw / 2, by - bh / 2, bw, bh);
      g.save(); g.globalCompositeOperation = 'destination-out';
      g.font = `800 ${Math.round(S * 0.094)}px "Trebuchet MS", "Segoe UI", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(stampDate(day), 0, by + S * 0.004);
      g.restore();
    }
    // worn ink: speckles and a dry streak lifted out, seeded per stamp
    g.save(); g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 90; i++) { g.globalAlpha = 0.25 + r() * 0.6; dot(g, (r() - 0.5) * S, (r() - 0.5) * S, S * (0.003 + r() * 0.011)); }
    g.globalAlpha = 0.18; g.lineWidth = S * 0.05; const a = r() * Math.PI;
    line(g, Math.cos(a) * -S * 0.5, Math.sin(a) * -S * 0.5 + (r() - 0.5) * S * 0.3, Math.cos(a) * S * 0.5, Math.sin(a) * S * 0.5 + (r() - 0.5) * S * 0.3);
    g.restore();
  } else {
    g.globalAlpha = 0.55;
    g.lineWidth = S * 0.018; g.setLineDash([S * 0.035, S * 0.03]); shapePath(g, shape, R); g.stroke(); g.setLineDash([]);
    if (look === 'secret') {
      g.font = `800 ${Math.round(S * 0.4)}px Georgia, serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('?', 0, S * 0.02);
    } else {
      g.globalAlpha = 0.22;
      g.save(); g.scale(R * 0.52, R * 0.52); g.lineWidth = 0.11; M[def.motif](g); g.restore();
    }
  }
  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** an <img> tag string for a toast icon (the toast puts icons in via innerHTML) */
export const stampIconHtml = (def: StampDef, day: string): string => `<img class="vh-stamp-ico" alt="" src="${stampImage(def, 'inked', day)}">`;

// ---------------------------------------------------------------------------------------------
// The page

function cell(e: StampEntry): HTMLElement {
  const img = h('img', { alt: '', width: STAMP_PX, height: STAMP_PX, draggable: 'false' }) as HTMLImageElement;
  const nm = h('div.nm');
  const sub = h('div.sub');
  const bar = h('div.bar', null, h('i'));
  const el = h('div.vh-stamp', { 'data-testid': `stamp-${e.def.id}`, tabindex: '0' }, h('div.art', null, img), nm, sub, bar);
  return el;
}
function fill(el: HTMLElement, e: StampEntry): void {
  const look: StampLook = e.earned ? 'inked' : e.hidden ? 'secret' : 'blank';
  const sig = `${look}|${e.day}|${e.progress?.have}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.className = `vh-stamp ${look}`;
  el.style.setProperty('--stamp-ink', CAT_INK[e.def.cat]);
  (el.querySelector('img') as HTMLImageElement).src = stampImage(e.def, look, e.day);
  const nm = el.querySelector('.nm') as HTMLElement, sub = el.querySelector('.sub') as HTMLElement, bar = el.querySelector('.bar') as HTMLElement;
  nm.textContent = e.hidden ? 'Secret stamp' : e.def.name;
  if (e.earned) sub.textContent = e.def.blurb;
  else if (e.hidden) sub.textContent = e.def.hint.replace(/^A secret: /, '');
  else sub.textContent = e.def.hint;
  const p = e.progress;
  if (p && !e.earned && p.need > 1) sub.textContent = `${e.def.hint} ${p.have} / ${p.need}`;
  bar.hidden = !p || e.earned || p.need <= 1;
  if (p && !bar.hidden) { (bar.firstElementChild as HTMLElement).style.width = `${Math.round((p.have / p.need) * 100)}%`; }
  el.title = e.earned ? `${e.def.name} · inked ${e.day}\n${e.def.blurb}\n(+${coins(bitsFor(e.def))})` : e.hidden ? 'A secret stamp: find it to see it' : `${e.def.name}: ${e.def.hint}${p ? ` (${p.have} / ${p.need})` : ''}`;
  el.setAttribute('aria-label', e.hidden ? 'Secret stamp, not yet found' : `${e.def.name}, ${e.earned ? `inked ${e.day}` : `not yet: ${e.def.hint}`}`);
}

/** a loving cup (the trophies), coloured by the `.cup` element's `color` */
const CUP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 13h2v4h-2z" fill="currentColor"/><rect x="7" y="17" width="10" height="3.5" rx="1" fill="currentColor"/></svg>';

/** The Stamps tab's page: a header with the count and the trophies, then a grid per category. */
export function createStampPage(): { el: HTMLElement; render(v: StampsView | null): void } {
  const count = h('div.cnt');
  const sub = h('div.sub');
  const cups = h('div.cups');
  const head = h('div.vh-sb-head', null, h('div.t', null, count, sub), cups);
  const empty = h('div.vh-muted', { text: 'The stamp book is still at the printers.' });
  const secs = new Map<StampCat, { el: HTMLElement; h: HTMLElement; grid: HTMLElement }>();
  const body = h('div.vh-sb-pages');
  for (const c of STAMP_CATS) {
    const hh = h('div.vh-h3');
    const grid = h('div.vh-sb-grid');
    const el = h('section.vh-sb-sec', { 'data-cat': c }, hh, grid);
    secs.set(c, { el, h: hh, grid });
    body.append(el);
  }
  const el = h('div.vh-stampbook', { 'data-testid': 'stampbook' }, head, empty, body);
  let sig = '';
  return {
    el,
    render(v) {
      empty.hidden = !!v;
      body.hidden = head.hidden = !v;
      if (!v) return;
      const s = JSON.stringify([v.earned, v.trophies, v.entries.map((e) => e.progress?.have ?? '')]);
      if (s === sig) return;
      sig = s;
      count.textContent = `${v.earned} of ${v.total} stamps`;
      sub.textContent = [`${coins(v.bits)} earned from stamps`, v.next ? `${v.next.at - v.earned} more for the ${v.next.name.toLowerCase()}` : 'every cup won!'].join(' · ');
      cups.replaceChildren(...TROPHIES.map((t, i) => h(`div.cup${i < v.trophies ? '.have' : ''}`, { title: `${t.name}: ${t.at} stamps${i < v.trophies ? ' (in your yard)' : ''}`, 'data-tier': t.decor.slice(7) },
        h('span.ic', { html: CUP_SVG }), h('b', { text: String(t.at) }))));
      for (const c of STAMP_CATS) {
        const sec = secs.get(c)!;
        const es = v.entries.filter((e) => e.def.cat === c);
        sec.h.textContent = `${CAT_NAME[c]} · ${v.byCat[c].earned} / ${v.byCat[c].total}`;
        for (let i = 0; i < es.length; i++) {
          let node = sec.grid.children[i] as HTMLElement | undefined;
          if (!node) { node = cell(es[i]); sec.grid.append(node); }
          fill(node, es[i]);
        }
      }
    },
  };
}
