/**
 * In-game developer overlay.
 *   F3  perf: fps, frame/cpu ms, draw calls, triangles, per-system ms (sorted), player position/yaw
 *   F4  inspector: the ValleyState summary (farmers with raw vs smoothed job, plots with stage), live
 *   F6  toggle ctx.debug.labels (systems may draw debug labels / colliders when set)
 * Also available from __valley.debug(flag).
 */
import type { Engine } from '../scene/engine.ts';

export function installOverlay(engine: Engine): void {
  const ctx = engine.ctx;
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;right:8px;bottom:8px;margin:0;padding:8px 10px;background:#000b;color:#dfe;font:11px/1.35 ui-monospace,monospace;border-radius:6px;z-index:50;pointer-events:none;display:none;max-height:80vh;overflow:hidden;white-space:pre';
  document.body.append(box);
  let mode: 'off' | 'perf' | 'state' = 'off';
  addEventListener('keydown', (e) => {
    if (e.code === 'F3') { mode = mode === 'perf' ? 'off' : 'perf'; e.preventDefault(); }
    else if (e.code === 'F4') { mode = mode === 'state' ? 'off' : 'state'; e.preventDefault(); }
    else if (e.code === 'F6') { ctx.debug.labels = !ctx.debug.labels; e.preventDefault(); }
    box.style.display = mode === 'off' ? 'none' : 'block';
  });
  let last = 0;
  engine.onFrame((f) => {
    if (mode === 'off' || f.time - last < 0.25) return;
    last = f.time;
    const p = engine.perf();
    const P = ctx.player;
    if (mode === 'perf') {
      const sys = Object.entries(p.systemMs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k.padEnd(12)} ${v.toFixed(2)} ms`).join('\n');
      const extra = engine.systems().map((s) => (s.stats ? `  ${s.name}: ${Object.entries(s.stats()).map(([k, v]) => `${k}=${v}`).join(' ')}` : '')).filter(Boolean).join('\n');
      box.textContent = `${p.fps.toFixed(0)} fps  frame ${p.frameMs.toFixed(1)} ms  cpu ${p.cpuMs.toFixed(2)} ms  errors ${p.frameErrors}\n`
        + `calls ${p.calls}  tris ${(p.tris / 1000).toFixed(0)}k  quality ${ctx.quality}\n`
        + `pos ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)}  yaw ${P.yaw.toFixed(2)} pitch ${P.pitch.toFixed(2)}\n`
        + `systems\n${sys}${extra ? `\n${extra}` : ''}`;
    } else {
      const v = ctx.valley;
      const farmers = [...v.farmers.values()].map((f) => `  ${f.name.padEnd(10)} ${f.status.padEnd(8)} ${f.job.padEnd(8)}${f.rawJob !== f.job ? `(${f.rawJob})` : ''} ${f.detail.slice(0, 28)}`).join('\n');
      const plots = [...v.plots.values()].map((pl) => `  ${pl.label.padEnd(12)} site ${String(pl.site).padStart(2)} ${pl.kind.padEnd(10)} ${pl.stage.padEnd(9)} g${pl.growth.toFixed(2)} v${pl.vigor.toFixed(2)}`).join('\n');
      box.textContent = `link ${v.link}  sky ${v.sky.hour.toFixed(2)}h ${v.sky.season} ${v.sky.weather.kind} ${v.sky.weather.intensity.toFixed(2)}  letters ${v.letters.length}\n`
        + `farmers (${v.farmers.size})\n${farmers}\nplots (${v.plots.size})\n${plots}\nhelpers ${v.helpers.size}`;
    }
  });
}
