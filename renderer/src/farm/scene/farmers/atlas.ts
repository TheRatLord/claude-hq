/**
 * Canvas atlases (no image files): farmer expressions (eyes, brows, mouth, blush) and emote icons.
 * Face cell = FACES index * 2 (+1 for the blink frame). Emote cells are named in EMOTE.
 */
import * as THREE from 'three';
import { FACES } from './pose.ts';
import type { Face } from './pose.ts';
import { EMOTE_COLS, EMOTE_ROWS, FACE_COLS, FACE_ROWS } from './mat.ts';

const CELL = 128;
const INK = '#2b2420';

export const faceCell = (f: Face, blink: boolean): number => FACES.indexOf(f) * 2 + (blink ? 1 : 0);

function drawFace(g: CanvasRenderingContext2D, face: Face, blink: boolean) {
  const S = CELL;
  const U = (u: number) => u * S, V = (v: number) => (1 - v) * S;
  const ex = 0.2, ey = 0.53;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // blush
  if (face !== 'stuck') {
    g.fillStyle = face === 'worried' ? 'rgba(240,138,138,0.45)' : 'rgba(242,120,120,0.7)';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(U(0.5 + s * 0.3), V(0.43), S * 0.07, S * 0.042, 0, 0, Math.PI * 2); g.fill(); }
  }
  g.strokeStyle = INK;
  g.fillStyle = INK;
  const dot = (s: number, h = 0.082, w = 0.056) => {
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(U(0.5 + s * ex), V(ey), S * w, S * h, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(U(0.5 + s * ex) + S * w * 0.35, V(ey) - S * h * 0.4, S * w * 0.36, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK;
  };
  const arc = (s: number, up: boolean, w = 0.05) => { // ^ ^ (up) or u u (down)
    g.lineWidth = S * 0.028;
    g.beginPath();
    const cx = U(0.5 + s * ex), cy = V(ey) + (up ? S * 0.015 : -S * 0.01);
    if (up) g.arc(cx, cy, S * w, Math.PI * 1.1, Math.PI * 1.9);
    else g.arc(cx, cy, S * w, Math.PI * 0.12, Math.PI * 0.88);
    g.stroke();
  };
  const line = (s: number, tilt = 0) => {
    g.lineWidth = S * 0.026;
    g.beginPath();
    g.moveTo(U(0.5 + s * ex) - S * 0.045, V(ey) + tilt * s * S);
    g.lineTo(U(0.5 + s * ex) + S * 0.045, V(ey) - tilt * s * S);
    g.stroke();
  };
  const brow = (s: number, angle: number, dy = 0.12) => {
    g.lineWidth = S * 0.02;
    g.beginPath();
    const cx = U(0.5 + s * ex), cy = V(ey + dy);
    g.moveTo(cx - S * 0.045, cy + angle * s * S * 0.12);
    g.lineTo(cx + S * 0.045, cy - angle * s * S * 0.12);
    g.stroke();
  };
  const mouthY = V(0.39);
  const smile = (w: number, d: number) => { g.lineWidth = S * 0.024; g.beginPath(); g.moveTo(U(0.5) - S * w, mouthY); g.quadraticCurveTo(U(0.5), mouthY + S * d, U(0.5) + S * w, mouthY); g.stroke(); };
  const open = (w: number, h: number, dy = 0) => {
    g.fillStyle = '#6b2a2a';
    g.beginPath(); g.ellipse(U(0.5), mouthY + S * dy, S * w, S * h, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8737a';
    g.beginPath(); g.ellipse(U(0.5), mouthY + S * dy + S * h * 0.45, S * w * 0.6, S * h * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = S * 0.012; g.beginPath(); g.ellipse(U(0.5), mouthY + S * dy, S * w, S * h, 0, 0, Math.PI * 2); g.stroke();
  };
  const grin = (w: number) => { // D-shaped open smile
    g.fillStyle = '#6b2a2a';
    g.beginPath(); g.moveTo(U(0.5) - S * w, mouthY - S * 0.01); g.quadraticCurveTo(U(0.5), mouthY + S * w * 1.5, U(0.5) + S * w, mouthY - S * 0.01); g.closePath(); g.fill();
    g.fillStyle = '#e8737a';
    g.beginPath(); g.ellipse(U(0.5), mouthY + S * w * 0.5, S * w * 0.45, S * w * 0.25, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = S * 0.014;
    g.beginPath(); g.moveTo(U(0.5) - S * w, mouthY - S * 0.01); g.quadraticCurveTo(U(0.5), mouthY + S * w * 1.5, U(0.5) + S * w, mouthY - S * 0.01); g.closePath(); g.stroke();
  };
  const eyes = (fn: (s: number) => void) => { fn(-1); fn(1); };
  switch (face) {
    case 'neutral': eyes((s) => (blink ? arc(s, false, 0.04) : dot(s))); smile(0.045, 0.03); break;
    case 'happy': eyes((s) => arc(s, true)); grin(0.06); break;
    case 'focused': eyes((s) => (blink ? line(s) : dot(s, 0.05))); eyes((s) => brow(s, 0.12, 0.12)); g.lineWidth = S * 0.022; g.beginPath(); g.moveTo(U(0.47), mouthY); g.lineTo(U(0.53), mouthY); g.stroke(); break;
    case 'stuck': {
      g.lineWidth = S * 0.026;
      eyes((s) => { const cx = U(0.5 + s * ex), cy = V(ey); g.beginPath(); g.moveTo(cx - s * S * 0.04, cy - S * 0.035); g.lineTo(cx + s * S * 0.035, cy); g.lineTo(cx - s * S * 0.04, cy + S * 0.035); g.stroke(); });
      g.lineWidth = S * 0.02; g.beginPath();
      for (let i = 0; i <= 6; i++) { const x = U(0.44) + (i / 6) * S * 0.12, y = mouthY + (i % 2 ? -1 : 1) * S * 0.012; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      break;
    }
    case 'sleepy': eyes((s) => { line(s, 0.01); }); eyes((s) => brow(s, -0.12, 0.1)); g.beginPath(); g.fillStyle = INK; g.ellipse(U(0.52), mouthY, S * 0.018, S * 0.014, 0, 0, Math.PI * 2); g.fill(); break;
    case 'proud': eyes((s) => arc(s, true, 0.042)); smile(0.07, 0.06); eyes((s) => brow(s, 0.08, 0.13)); break;
    case 'worried': eyes((s) => (blink ? line(s) : dot(s, 0.085, 0.058))); eyes((s) => brow(s, -0.35, 0.14)); open(0.035, 0.028, 0.01); break;
    case 'talk': eyes((s) => (blink ? arc(s, false, 0.04) : dot(s))); open(0.045, blink ? 0.02 : 0.04); break;
    case 'yawn': eyes((s) => line(s, -0.02)); open(0.05, 0.07, 0.02); break;
    case 'surprised': eyes((s) => dot(s, 0.095, 0.07)); eyes((s) => brow(s, -0.1, 0.16)); open(0.028, 0.035, 0.01); break;
    case 'asleep': eyes((s) => arc(s, false, 0.045)); g.beginPath(); g.fillStyle = INK; g.ellipse(U(0.5), mouthY, S * 0.02, S * 0.012, 0, 0, Math.PI * 2); g.fill(); break;
    case 'whistle': eyes((s) => (s < 0 ? arc(s, true, 0.04) : dot(s))); g.strokeStyle = INK; g.lineWidth = S * 0.018; g.beginPath(); g.arc(U(0.54), mouthY, S * 0.022, 0, Math.PI * 2); g.stroke(); break;
  }
}

let faceTex: THREE.CanvasTexture | null = null;
export function faceAtlas(): THREE.CanvasTexture {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas');
  c.width = CELL * FACE_COLS; c.height = CELL * FACE_ROWS;
  const g = c.getContext('2d')!;
  FACES.forEach((f, i) => {
    for (const blink of [false, true]) {
      const cell = i * 2 + (blink ? 1 : 0);
      g.save();
      g.translate((cell % FACE_COLS) * CELL, Math.floor(cell / FACE_COLS) * CELL);
      g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip();
      drawFace(g, f, blink);
      g.restore();
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  faceTex = t;
  return t;
}

export const EMOTE = {
  bang: 0, question: 1, heart: 2, check: 3, sweat: 4, storm: 5, zzz: 6, bulb: 7, note: 8, thought: 9, dots: 10, sparkle: 11, star: 12, scribble: 13,
  halo: 14, puff: 15, egg: 16,
} as const;
export type EmoteName = keyof typeof EMOTE;

function drawEmote(g: CanvasRenderingContext2D, name: EmoteName) {
  const S = CELL;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const outlined = (path: () => void, fill: string, stroke = INK, w = 10) => {
    path(); g.lineWidth = w; g.strokeStyle = stroke; g.stroke();
    path(); g.fillStyle = fill; g.fill();
  };
  switch (name) {
    case 'bang': {
      outlined(() => { g.beginPath(); g.moveTo(46, 12); g.lineTo(82, 12); g.lineTo(72, 80); g.lineTo(56, 80); g.closePath(); }, '#ffd23a', '#5a3a10', 12);
      outlined(() => { g.beginPath(); g.arc(64, 104, 13, 0, Math.PI * 2); }, '#ffd23a', '#5a3a10', 12);
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.moveTo(54, 20); g.lineTo(62, 20); g.lineTo(58, 50); g.closePath(); g.fill();
      break;
    }
    case 'question': {
      g.font = 'bold 110px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 12; g.strokeStyle = '#2a3a5a'; g.strokeText('?', 64, 70); g.fillStyle = '#8fd0ff'; g.fillText('?', 64, 70);
      break;
    }
    case 'heart': {
      outlined(() => { g.beginPath(); g.moveTo(64, 108); g.bezierCurveTo(10, 70, 18, 20, 64, 42); g.bezierCurveTo(110, 20, 118, 70, 64, 108); }, '#ff5a7a', '#5a1a2a', 9);
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.ellipse(44, 48, 9, 6, -0.6, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'check': {
      outlined(() => { g.beginPath(); g.arc(64, 64, 48, 0, Math.PI * 2); }, '#6ad16a', '#1f4a1f', 9);
      g.strokeStyle = '#ffffff'; g.lineWidth = 14; g.beginPath(); g.moveTo(40, 66); g.lineTo(58, 84); g.lineTo(90, 46); g.stroke();
      break;
    }
    case 'sweat': {
      outlined(() => { g.beginPath(); g.moveTo(64, 14); g.bezierCurveTo(86, 50, 98, 70, 96, 86); g.arc(64, 86, 32, 0, Math.PI); g.bezierCurveTo(30, 70, 42, 50, 64, 14); }, '#8fd6ff', '#1f4a6a', 8);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(52, 82, 7, 12, 0.3, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'storm': {
      outlined(() => { g.beginPath(); g.moveTo(58, 88); g.lineTo(48, 118); g.lineTo(66, 100); g.lineTo(60, 124); g.lineTo(82, 90); g.closePath(); }, '#ffd23a', '#5a3a10', 6);
      outlined(() => { g.beginPath(); g.arc(40, 62, 22, 0, Math.PI * 2); g.arc(66, 48, 28, 0, Math.PI * 2); g.arc(92, 62, 22, 0, Math.PI * 2); g.rect(38, 60, 56, 24); g.arc(40, 70, 16, 0, Math.PI * 2); g.arc(90, 72, 14, 0, Math.PI * 2); }, '#6a6f80', '#2a2d38', 8);
      break;
    }
    case 'zzz': {
      g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [x, y, s] of [[40, 92, 1], [72, 60, 0.8], [98, 30, 0.6]] as const) {
        g.save(); g.translate(x, y); g.scale(s, s);
        g.lineWidth = 10; g.strokeStyle = '#2a3a5a'; g.strokeText('Z', 0, 0); g.fillStyle = '#cfe0ff'; g.fillText('Z', 0, 0);
        g.restore();
      }
      break;
    }
    case 'bulb': {
      g.strokeStyle = 'rgba(255,220,90,0.9)'; g.lineWidth = 6;
      for (let i = 0; i < 7; i++) { const a = -Math.PI * (0.1 + i * 0.133); g.beginPath(); g.moveTo(64 + Math.cos(a) * 44, 52 + Math.sin(a) * 44); g.lineTo(64 + Math.cos(a) * 58, 52 + Math.sin(a) * 58); g.stroke(); }
      outlined(() => { g.beginPath(); g.arc(64, 52, 30, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(76, 90); g.lineTo(52, 90); g.closePath(); }, '#fff1a0', '#5a4a10', 7);
      outlined(() => { g.beginPath(); g.rect(50, 92, 28, 18); }, '#9aa4ad', '#3a3f48', 6);
      break;
    }
    case 'note': {
      outlined(() => { g.beginPath(); g.ellipse(46, 96, 18, 13, -0.4, 0, Math.PI * 2); g.rect(56, 24, 10, 72); g.moveTo(56, 24); g.lineTo(98, 14); g.lineTo(98, 30); g.lineTo(66, 40); g.closePath(); }, '#ff9ad0', '#5a1a3a', 8);
      break;
    }
    case 'thought': {
      outlined(() => { g.beginPath(); g.arc(40, 56, 26, 0, Math.PI * 2); g.arc(68, 44, 30, 0, Math.PI * 2); g.arc(94, 58, 24, 0, Math.PI * 2); g.arc(64, 72, 26, 0, Math.PI * 2); }, '#ffffff', '#4a4a5a', 7);
      outlined(() => { g.beginPath(); g.arc(30, 100, 9, 0, Math.PI * 2); }, '#ffffff', '#4a4a5a', 6);
      outlined(() => { g.beginPath(); g.arc(18, 118, 5, 0, Math.PI * 2); }, '#ffffff', '#4a4a5a', 5);
      g.fillStyle = '#6a6a7a'; for (const x of [50, 66, 82]) { g.beginPath(); g.arc(x, 58, 6, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'dots': {
      outlined(() => { g.beginPath(); g.roundRect(14, 30, 100, 60, 28); g.moveTo(40, 88); g.lineTo(34, 112); g.lineTo(60, 88); }, '#ffffff', '#4a4a5a', 7);
      g.fillStyle = '#6a6a7a'; for (const x of [44, 64, 84]) { g.beginPath(); g.arc(x, 60, 7, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'sparkle': {
      const star4 = (x: number, y: number, r: number) => { g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); };
      outlined(() => star4(58, 64, 46), '#fff6c0', '#a07a10', 6);
      outlined(() => star4(100, 28, 18), '#ffffff', '#a07a10', 4);
      break;
    }
    case 'star': {
      outlined(() => { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 52, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r); } g.closePath(); }, '#ffd23a', '#5a3a10', 8);
      break;
    }
    case 'scribble': {
      g.strokeStyle = '#3a3040'; g.lineWidth = 7; g.beginPath();
      for (let i = 0; i < 40; i++) { const a = i * 0.9, r = 18 + (i % 7) * 4; const x = 64 + Math.cos(a) * r * 1.2, y = 64 + Math.sin(a) * r * 0.8; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      break;
    }
    case 'halo': {
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, 'rgba(255,230,140,0.95)'); gr.addColorStop(0.4, 'rgba(255,210,90,0.45)'); gr.addColorStop(1, 'rgba(255,200,80,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      break;
    }
    case 'puff': {
      g.fillStyle = 'rgba(240,232,216,0.95)';
      for (const [x, y, r] of [[44, 74, 26], [70, 60, 32], [92, 78, 22], [64, 86, 24]] as const) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'egg': {
      outlined(() => { g.beginPath(); g.ellipse(64, 70, 34, 44, 0, 0, Math.PI * 2); }, '#f6f1e6', '#6a5a4a', 6);
      break;
    }
  }
}

let emoteTex: THREE.CanvasTexture | null = null;
export function emoteAtlas(): THREE.CanvasTexture {
  if (emoteTex) return emoteTex;
  const c = document.createElement('canvas');
  c.width = CELL * EMOTE_COLS; c.height = CELL * EMOTE_ROWS;
  const g = c.getContext('2d')!;
  for (const [name, cell] of Object.entries(EMOTE)) {
    g.save();
    g.translate((cell % EMOTE_COLS) * CELL, Math.floor(cell / EMOTE_COLS) * CELL);
    g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip();
    drawEmote(g, name as EmoteName);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  emoteTex = t;
  return t;
}
