/**
 * Canvas atlas (no image files) of emote icons drawn as billboards over the mascots: "!", "?", hearts, Zzz, notes…
 * Mascot faces are voxel glyphs (mascots.ts), not textures. Emote cells are named in EMOTE.
 */
import * as THREE from 'three';
import { EMOTE_COLS, EMOTE_ROWS } from './mat.ts';

const CELL = 128;
const INK = '#2b2420';

export const EMOTE = {
  bang: 0, question: 1, heart: 2, check: 3, sweat: 4, storm: 5, zzz: 6, bulb: 7, note: 8, thought: 9, dots: 10, sparkle: 11, star: 12, scribble: 13,
  halo: 14, puff: 15, egg: 16,
  /** villagers: the postmaster's envelope, the miller's wheat, the clerk's crate tick */
  mail: 17,
  /** thinking: a thought cloud with turning cogs; planning a todo list: a cloud with a checklist */
  gears: 18, list: 19,
  /** evening gatherings: laughter round the campfire */
  haha: 20,
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
    case 'mail': {
      outlined(() => { g.beginPath(); g.roundRect(18, 34, 92, 62, 8); }, '#fff6e0', '#5a3a10', 10);
      g.strokeStyle = '#5a3a10'; g.lineWidth = 7; g.beginPath(); g.moveTo(22, 40); g.lineTo(64, 72); g.lineTo(106, 40); g.stroke();
      g.fillStyle = '#d9453b'; g.beginPath(); g.arc(64, 72, 10, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'gears':
    case 'list': {
      outlined(() => { g.beginPath(); g.arc(40, 56, 26, 0, Math.PI * 2); g.arc(68, 44, 30, 0, Math.PI * 2); g.arc(94, 58, 24, 0, Math.PI * 2); g.arc(64, 72, 26, 0, Math.PI * 2); }, '#ffffff', '#4a4a5a', 7);
      outlined(() => { g.beginPath(); g.arc(30, 100, 9, 0, Math.PI * 2); }, '#ffffff', '#4a4a5a', 6);
      outlined(() => { g.beginPath(); g.arc(18, 118, 5, 0, Math.PI * 2); }, '#ffffff', '#4a4a5a', 5);
      if (name === 'gears') {
        const cog = (x: number, y: number, r: number, teeth: number, fill: string) => {
          outlined(() => {
            g.beginPath();
            for (let i = 0; i < teeth * 2; i++) {
              const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r * 0.74 : r;
              g.arc(x, y, rr, a0, a1);
            }
            g.closePath();
          }, fill, '#3a3a48', 5);
          g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill();
        };
        cog(52, 60, 20, 8, '#f2a33a');
        cog(80, 50, 14, 6, '#8fb8d8');
      } else {
        g.fillStyle = '#f8f0dc'; g.strokeStyle = '#4a4a5a'; g.lineWidth = 4;
        g.beginPath(); g.roundRect(46, 30, 40, 50, 4); g.fill(); g.stroke();
        for (let i = 0; i < 3; i++) {
          const y = 42 + i * 13;
          g.strokeStyle = i < 2 ? '#3f9a3f' : '#9a9aa8'; g.lineWidth = 4;
          g.beginPath();
          if (i < 2) { g.moveTo(51, y); g.lineTo(55, y + 4); g.lineTo(61, y - 4); } else g.rect(51, y - 4, 8, 8);
          g.stroke();
          g.strokeStyle = '#9a9aa8'; g.beginPath(); g.moveTo(65, y); g.lineTo(80, y); g.stroke();
        }
      }
      break;
    }
    case 'haha': {
      // a little burst with "ha!" in it
      outlined(() => { g.beginPath(); for (let i = 0; i < 14; i++) { const r = i % 2 ? 40 : 56, a = (i * Math.PI) / 7; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r * 0.82); } g.closePath(); }, '#fff3c4', '#7a4a10', 7);
      g.font = 'bold 46px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#7a3a10'; g.fillText('ha!', 64, 67);
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
