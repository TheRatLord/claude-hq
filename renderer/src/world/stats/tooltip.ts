/**
 * Crosshair tooltip for stats objects (§7.4): value, a 5-minute sparkline and the source, just below-right of the
 * reticle (the reticle sits at the centre of the world strip: `--world-l` / `--world-r` on `.hq-ui`). One DOM node,
 * redrawn only when its content changes (≤ 20 Hz polling from stats/index.ts). Owner: STAT.
 */
import { FONT_MONO, FONT_UI, canvas2d } from './panel.ts';
import type { StatTooltip } from './registry.ts';

const W = 220, H = 46;

const CSS = `
.hq-stattip{position:absolute;top:calc(50% + 26px);left:calc(var(--world-l,0px) + (100% - var(--world-l,0px) - var(--world-r,0px)) / 2 + 22px);
  min-width:${W + 24}px;padding:10px 12px 9px;border-radius:14px;background:rgba(31,30,29,.92);color:#F4EDE3;
  font:600 12px/1.25 ${FONT_UI};box-shadow:0 6px 18px rgba(0,0,0,.28),inset 0 0 0 1.5px rgba(241,198,110,.35);
  pointer-events:none;opacity:0;transform:translateY(4px) scale(.97);transition:opacity .12s,transform .16s cubic-bezier(.2,.9,.3,1.2)}
.hq-stattip.on{opacity:1;transform:none}
.hq-stattip .t{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#F1C66E}
.hq-stattip .v{font-size:20px;font-weight:800;margin:1px 0 5px;white-space:nowrap}
.hq-stattip .v.crit{color:#EF5A4C}
.hq-stattip canvas{display:block;width:${W}px;height:${H}px}
.hq-stattip .s{margin-top:4px;font:500 10.5px/1.2 ${FONT_MONO};color:#B7AEA2;white-space:nowrap}
.hq-stattip .s b{color:#8A8278;font-weight:500}
`;

export function createTooltip(root: HTMLElement) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'hq-stattip';
  el.setAttribute('role', 'status');
  const tEl = document.createElement('div'), vEl = document.createElement('div'), cv = document.createElement('canvas'), sEl = document.createElement('div');
  tEl.className = 't'; vEl.className = 'v'; sEl.className = 's';
  el.append(tEl, vEl, cv, sEl);
  root.appendChild(el);
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  const g = canvas2d(cv);
  let key = '';
  let on = false;

  const spark = (vals: number[] | undefined, max: number | undefined, color: string) => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.05)';
    g.fillRect(0, 0, W, H);
    if (!vals?.length) return;
    let hi = max ?? 0;
    if (max == null) for (const v of vals) if (v > hi) hi = v;
    hi = hi || 1;
    const n = vals.length, dx = W / Math.max(1, 299);
    const x0 = W - (n - 1) * dx;
    g.beginPath();
    g.moveTo(x0, H);
    for (let i = 0; i < n; i++) g.lineTo(x0 + i * dx, H - 3 - (Math.min(vals[i], hi) / hi) * (H - 6));
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = color + '40';
    g.fill();
    g.beginPath();
    for (let i = 0; i < n; i++) { const y = H - 3 - (Math.min(vals[i], hi) / hi) * (H - 6); i ? g.lineTo(x0 + i * dx, y) : g.moveTo(x0, y); }
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.lineJoin = 'round';
    g.stroke();
    // last value dot
    const ly = H - 3 - (Math.min(vals[n - 1], hi) / hi) * (H - 6);
    g.fillStyle = color;
    g.beginPath(); g.arc(W - 2.5, ly, 2.5, 0, Math.PI * 2); g.fill();
    // "5 min" hint
    g.fillStyle = 'rgba(244,237,227,.45)';
    g.font = `500 9px ${FONT_UI}`;
    g.fillText('5 min', 3, 10);
  };

  return {
    show(tip: StatTooltip | null | undefined) {
      if (!tip) return this.hide();
      const sp = tip.spark ?? [];
      const k = `${tip.title}|${tip.value}|${tip.source}|${sp.length}|${sp[sp.length - 1]}|${tip.crit}`;
      if (k !== key) {
        key = k;
        tEl.textContent = tip.title;
        vEl.textContent = tip.value;
        vEl.classList.toggle('crit', !!tip.crit);
        sEl.innerHTML = '';
        const b = document.createElement('b');
        b.textContent = 'src ';
        sEl.append(b, tip.source ?? '');
        spark(sp, tip.max, tip.color ?? '#F1C66E');
      }
      if (!on) { on = true; el.classList.add('on'); }
    },
    hide() { if (on) { on = false; el.classList.remove('on'); } },
    dispose() { el.remove(); style.remove(); },
  };
}
