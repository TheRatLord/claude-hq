/**
 * F3 perf overlay (CORE). fps / frame / cpu / gpu ms, draw calls, triangles, programs, tier, scale.
 * M3 adds RND's per-pass GPU budget bar (§5.2) through `perfOverlay.addRow`.
 * Toggle: F3. Updates ≤ 4 Hz.
 */

import type { Ctx } from '../core/ctx.ts';

/** What the overlay reads of the frame ctx. */
export type PerfCtx = Pick<Ctx, 'perf' | 'renderer' | 'quality' | 'store'>;
export interface PerfOverlay {
  update(ctx: PerfCtx): void;
  toggle(v?: boolean): void;
  addRow(label: string, fn: () => string): void;
}

export function createPerfOverlay({ root }: { root: HTMLElement; ctx?: PerfCtx }): PerfOverlay {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;top:8px;right:8px;margin:0;padding:6px 8px;background:#1F1E1DD9;color:#F4EDE3;'
    + 'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;border-radius:6px;pointer-events:none;display:none;z-index:50';
  root.appendChild(el);
  const rows: [string, () => string][] = [];
  let shown = false;
  let last = -1;
  addEventListener('keydown', (e) => {
    // M1 integ (§8.2 key table): F3 goes to the pane in xterm scope and types into roster/palette inputs.
    if (e.code !== 'F3' || (e.target instanceof Element && e.target.closest('.xterm, input, textarea, [contenteditable]'))) return;
    e.preventDefault(); o.toggle();
  });
  const o: PerfOverlay = {
    toggle(v?: boolean) { shown = v ?? !shown; el.style.display = shown ? 'block' : 'none'; },
    addRow(label, fn) { rows.push([label, fn]); },
    update(c) {
      if (!shown || performance.now() - last < 250) return;
      last = performance.now();
      const p = c.perf, i = c.renderer.info;
      const lines = [
        `fps     ${p.fps.toFixed(1)}`,
        `frame   ${p.frameMs.toFixed(2)} ms`,
        `cpu     ${p.cpuMs.toFixed(2)} ms`,
        `gpu     ${p.gpuMs === null ? '—' : p.gpuMs.toFixed(2) + ' ms'}`,
        `draws   ${p.drawCalls}${p.draws ? ` (m ${p.draws.main}/110 s ${p.draws.shadow}/25 pt ${p.draws.portrait} pp ${p.draws.post})` : ''}`,
        `tris    ${p.triangles}`,
        `progs   ${i.programs?.length ?? '?'}`,
        `tier    ${c.quality.tier} ×${c.quality.renderScale}`,
        `agents  ${c.store.entities.size}`,
        ...(p.frameErrors ? [`errors  ${p.frameErrors} frame(s) threw`] : []),
      ];
      for (const [l, fn] of rows) { try { lines.push(`${l.padEnd(7)} ${fn()}`); } catch { /* ignore */ } }
      el.textContent = lines.join('\n');
    },
  };
  return o;
}
