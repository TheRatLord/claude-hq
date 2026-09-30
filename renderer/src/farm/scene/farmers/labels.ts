/**
 * Small pooled canvas sprites: nameplates ("Gale · planting store.ts"), speech bubbles (an excerpt of what the
 * farmer said / asked) and duckling labels. A handful at a time (nearest / focused), each redrawn only when its text
 * changes.
 */
import * as THREE from 'three';

export type LabelStyle = 'name' | 'speech' | 'ask' | 'duck';

interface Slot { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string; used: boolean; alpha: number; aspect: number }

const W = 512, H = 160;

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; if (lines.length === maxLines) break; } else cur = t;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (g.measureText(`${last}…`).width > maxW && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function draw(c: HTMLCanvasElement, style: LabelStyle, title: string, sub: string): number {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const font = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  if (style === 'name' || style === 'duck') {
    const big = style === 'name' ? 38 : 30;
    g.font = `700 ${big}px ${font}`;
    const tw = g.measureText(title).width;
    g.font = `500 26px ${font}`;
    const sw = sub ? g.measureText(sub).width : 0;
    const w = Math.min(W - 8, Math.max(tw, sw) + 44);
    const h = sub ? 96 : 60;
    const x = (W - w) / 2, y = H - h - 4;
    g.fillStyle = style === 'duck' ? 'rgba(255,246,200,0.95)' : 'rgba(255,250,238,0.94)';
    g.strokeStyle = 'rgba(90,60,30,0.85)'; g.lineWidth = 4;
    g.beginPath(); g.roundRect(x, y, w, h, 22); g.fill(); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#3a2a1c'; g.font = `700 ${big}px ${font}`;
    g.fillText(title, W / 2, y + (sub ? 32 : h / 2));
    if (sub) { g.fillStyle = '#7a6250'; g.font = `500 26px ${font}`; g.fillText(sub, W / 2, y + 70, W - 40); }
    return W / H;
  }
  // speech / ask bubble with a tail
  g.font = `600 30px ${font}`;
  const lines = wrap(g, title, W - 70, 2);
  const w = Math.min(W - 8, Math.max(...lines.map((l) => g.measureText(l).width)) + 50);
  const h = lines.length * 38 + 34;
  const x = (W - w) / 2, y = H - h - 26;
  g.fillStyle = style === 'ask' ? 'rgba(255,236,160,0.97)' : 'rgba(255,255,255,0.96)';
  g.strokeStyle = style === 'ask' ? 'rgba(160,110,20,0.95)' : 'rgba(70,70,90,0.8)'; g.lineWidth = 5;
  g.beginPath(); g.roundRect(x, y, w, h, 26);
  g.moveTo(W / 2 - 18, y + h); g.lineTo(W / 2 - 4, H - 4); g.lineTo(W / 2 + 12, y + h);
  g.fill(); g.stroke();
  g.fillStyle = style === 'ask' ? 'rgba(255,236,160,0.97)' : 'rgba(255,255,255,0.96)';
  g.fillRect(W / 2 - 16, y + h - 6, 26, 8);
  g.fillStyle = '#2b2420'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, W / 2, y + 17 + 19 + i * 38));
  void sub;
  return W / H;
}

export class Labels {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private cap: number;
  constructor(cap = 10) { this.cap = cap; this.group.name = 'farmer-labels'; }

  begin(): void { for (const s of this.slots) s.used = false; }

  /** Show a label this frame at `pos` (bottom centre), `height` metres tall. */
  show(key: string, style: LabelStyle, title: string, sub: string, pos: THREE.Vector3, height: number, alpha: number): void {
    if (alpha < 0.02) return;
    const content = `${style}|${title}|${sub}`;
    let s = this.slots.find((x) => !x.used && x.key === content);
    if (!s) s = this.slots.find((x) => !x.used && !x.sprite.visible);
    if (!s && this.slots.length < this.cap) {
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      sprite.center.set(0.5, 0);
      sprite.renderOrder = 20;
      this.group.add(sprite);
      s = { sprite, canvas, tex, key: '', used: false, alpha: 0, aspect: W / H };
      this.slots.push(s);
    }
    if (!s) return;
    s.used = true;
    if (s.key !== content) { s.aspect = draw(s.canvas, style, title, sub); s.tex.needsUpdate = true; s.key = content; }
    s.sprite.visible = true;
    s.sprite.position.copy(pos);
    s.sprite.scale.set(height * s.aspect, height, 1);
    (s.sprite.material as THREE.SpriteMaterial).opacity = alpha;
    void key;
  }

  end(): void { for (const s of this.slots) if (!s.used) s.sprite.visible = false; }

  /** draw calls this frame */
  visible(): number { return this.slots.filter((s) => s.sprite.visible).length; }
}
