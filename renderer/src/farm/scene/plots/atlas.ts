/**
 * One canvas texture holding every sign face and helper tag (slots of 256×128), so all the valley's plot signs draw
 * in a single call. Slots are ref-counted by content key and repainted in place.
 */
import * as THREE from 'three';

const COLS = 8, ROWS = 8, SW = 256, SH = 128;

export type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export class TextAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly tex: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;
  private readonly slots = new Map<string, { i: number; refs: number }>();
  private readonly free: number[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = COLS * SW;
    this.canvas.height = ROWS * SH;
    this.g = this.canvas.getContext('2d')!;
    for (let i = COLS * ROWS - 1; i >= 0; i--) this.free.push(i);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
  }

  /** acquire a slot for `key` (painted once); returns [u0, v0, du, dv] */
  acquire(key: string, paint: Painter): number[] {
    let s = this.slots.get(key);
    if (!s) {
      const i = this.free.pop() ?? 0;
      s = { i, refs: 0 };
      this.slots.set(key, s);
      const x = (i % COLS) * SW, y = Math.floor(i / COLS) * SH;
      this.g.save();
      this.g.clearRect(x, y, SW, SH);
      this.g.translate(x, y);
      this.g.beginPath(); this.g.rect(0, 0, SW, SH); this.g.clip();
      paint(this.g, SW, SH);
      this.g.restore();
      this.tex.needsUpdate = true;
    }
    s.refs++;
    return this.rect(s.i);
  }

  release(key: string): void {
    const s = this.slots.get(key);
    if (!s) return;
    if (--s.refs <= 0) { this.slots.delete(key); this.free.push(s.i); }
  }

  private rect(i: number): number[] {
    const c = i % COLS, r = Math.floor(i / COLS);
    // canvas y grows down; texture v grows up (flipY)
    const inset = 1.5;
    return [(c * SW + inset) / (COLS * SW), 1 - ((r + 1) * SH - inset) / (ROWS * SH), (SW - inset * 2) / (COLS * SW), (SH - inset * 2) / (ROWS * SH)];
  }
}

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/** Fit text into a width by shrinking the font. */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 'bold'): void {
  let s = size;
  g.font = `${weight} ${s}px ${FONT}`;
  while (g.measureText(text).width > maxW && s > 12) { s -= 2; g.font = `${weight} ${s}px ${FONT}`; }
  g.fillText(text, x, y);
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** A painted wooden sign face: coloured header band, big label, small subtitle. */
export function signPainter(label: string, sub: string, color: number, o: { faded?: boolean } = {}): Painter {
  return (g, w, h) => {
    // planks
    const woods = o.faded ? ['#c9ab86', '#bea07c', '#c4a684'] : ['#d9ac72', '#cf9f66', '#d6a86e'];
    for (let i = 0; i < 3; i++) { g.fillStyle = woods[i]; g.fillRect(0, (i * h) / 3, w, h / 3 + 1); }
    g.fillStyle = 'rgba(90,55,25,0.35)';
    for (let i = 1; i < 3; i++) g.fillRect(0, (i * h) / 3 - 1.5, w, 3);
    // grain
    g.strokeStyle = 'rgba(110,70,35,0.18)'; g.lineWidth = 2;
    for (let i = 0; i < 9; i++) { const y = 10 + i * 13; g.beginPath(); g.moveTo(8, y); g.bezierCurveTo(w * 0.3, y + 4, w * 0.6, y - 4, w - 8, y + 2); g.stroke(); }
    // coloured band
    g.fillStyle = hex(color);
    g.globalAlpha = o.faded ? 0.55 : 1;
    g.fillRect(0, 0, w, 20);
    g.globalAlpha = 1;
    // frame
    g.strokeStyle = '#6e4a2a'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    // nails
    g.fillStyle = '#5a4a3a';
    for (const [x, y] of [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]]) { g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = o.faded ? '#6a5040' : '#3a2616';
    fitText(g, label, w / 2, h * 0.52, w - 30, 44);
    if (sub) { g.fillStyle = o.faded ? '#7a6050' : '#5a3f28'; fitText(g, sub, w / 2, h * 0.82, w - 40, 20, '600'); }
  };
}

/** A small cream luggage tag for a helper: command on top, ports / status below. */
export function tagPainter(line1: string, line2: string, accent: number): Painter {
  return (g, w, h) => {
    g.fillStyle = '#f3e6c6';
    g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 18); g.fill();
    g.fillStyle = hex(accent);
    g.fillRect(4, 4, 18, h - 8);
    g.strokeStyle = '#7a5a3a'; g.lineWidth = 4; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 18); g.stroke();
    g.fillStyle = '#7a5a3a'; g.beginPath(); g.arc(34, h / 2, 7, 0, Math.PI * 2); g.fill();
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = '#2b2420';
    fitText(g, line1, 50, h * 0.38, w - 62, 30);
    g.fillStyle = '#5a4a3a';
    fitText(g, line2, 50, h * 0.72, w - 62, 22, '600');
  };
}
