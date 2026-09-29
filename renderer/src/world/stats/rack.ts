/**
 * CPU per-thread rack wall (§7.4, GP §4): four clay server cabinets along the Engine Room east wall, one LED meter
 * column per thread (`c0..c15`, 12 segments each, green → amber → red like a VU meter, peak-hold ticks), the thread's
 * % under it, blinking at ≥ 90%. Cooling fans on top spin with total CPU. Heat shimmer rises over the racks when the
 * CPU runs hot (> 75 °C). The hottest cabinet is published on the bus ('stats.hotSpot' {x, y, z}) for the cat (AMB).
 * Owner: STAT.
 */
import * as THREE from 'three';
import { registerStat } from './registry.ts';
import { createPanel, createParts, rrect, overlayMesh, whiteInstances, canvas2d, lodOf, setLod } from './panel.ts';
import type { DrawFn } from './panel.ts';
import type { Stats } from '../../../../shared/protocol.ts';
import { drawDots } from './dotfont.ts';
import { series, pct, temp, clamp01 } from './format.ts';
import { floorY } from '../layout/floorY.ts';
import { ENV, STATUS } from '../../../../shared/palette.ts';

const SEG = 12;
const SEG_COL = (i: number) => (i >= 10 ? STATUS.blocked : i >= 7 ? STATUS.shellBusy : STATUS.shell);

function shimmerTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = canvas2d(c);
  g.clearRect(0, 0, 64, 256);
  for (let k = 0; k < 5; k++) {
    g.beginPath();
    for (let y = 0; y <= 256; y += 4) {
      const x = 8 + k * 12 + Math.sin((y / 256) * Math.PI * 4 + k) * 4;
      y ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = 'rgba(255,240,220,0.55)';
    g.lineWidth = 2.2;
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

registerStat('cpuRack', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:cpuRack';
  // local frame: +z = front (toward the room), x along the wall; anchor.pos is the wall centre at y 1.3
  const [x0, z0, x1, z1] = anchor.span ?? [anchor.pos.x, anchor.pos.z - 4, anchor.pos.x, anchor.pos.z + 4];
  const len = Math.hypot(x1 - x0, z1 - z0) || 8;
  // proud of the greybox rack block (front at x 41.43 plan), standing on the ENG platform (+0.25; at 0 the plinths sank
  // into it and the value row sat at bench height)
  root.position.set(anchor.pos.x - 0.42, floorY(anchor.pos.x - 0.6, anchor.pos.z, 0), anchor.pos.z);
  root.rotation.y = anchor.yaw;
  const CAB = 4, cabW = len / CAB - 0.06, H = 2.64;
  const P = createParts();
  for (let i = 0; i < CAB; i++) {
    const cx = -len / 2 + (i + 0.5) * (len / CAB);
    P.box(cx, H / 2, 0, cabW, H, 0.14, '#3B3F45', { r: 0.05 });
    P.box(cx, H - 0.13, 0.075, cabW - 0.16, 0.12, 0.02, '#2A2D31', { r: 0.01 }); // top vent
    for (let v = 0; v < 7; v++) P.box(cx - cabW / 2 + 0.25 + v * (cabW - 0.5) / 6, H - 0.13, 0.088, 0.1, 0.05, 0.01, '#565B62', { r: 0 });
    P.box(cx, 0.1, 0.03, cabW + 0.02, 0.2, 0.18, '#2A2D31', { r: 0.03 }); // plinth
    // top fan housing
    P.cyl(cx, H + 0.06, 0, 0.3, 0.3, 0.12, '#2A2D31', { seg: 20 });
    P.torus(cx, H + 0.125, 0, 0.3, 0.02, '#B08A4A', { rx: Math.PI / 2, segT: 24, segR: 5 });
    // cable loom on the floor to the wall
    P.cyl(cx - 0.4, 0.04, -0.02, 0.035, 0.035, 0.5, '#1F1E1D', { rx: Math.PI / 2, seg: 6 });
  }
  root.add(P.mesh('stat:cpuRack:cabinets', { cast: true }));
  // fan blades (one mesh per cabinet group: 4 fans share one geometry, spun together)
  const bladeParts = createParts();
  for (let b = 0; b < 5; b++) {
    const a = b * Math.PI * 2 / 5;
    bladeParts.box(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13, 0.22, 0.012, 0.08, '#8E949B', { ry: -a, rx: 0.3, r: 0.004 });
  }
  bladeParts.cyl(0, 0.01, 0, 0.05, 0.05, 0.03, ENV.butter, { seg: 12 });
  const bladeSrc = bladeParts.mesh('stat:cpuRack:fanBlades');
  // the 4 fans: one instanced mesh (m2 r2 draw budget: was 4 clones / 4 draws)
  const fans = new THREE.InstancedMesh(bladeSrc.geometry, bladeSrc.material, CAB);
  fans.name = 'stat:cpuRack:fans';
  const bladeLod = lodOf(bladeSrc); // [STAT fix m3 r3 code] far: low-detail blades (index.ts LOD_DIST)
  if (bladeLod) setLod(fans, bladeLod);
  whiteInstances(fans);
  const fm4 = new THREE.Matrix4(), fq = new THREE.Quaternion(), fe = new THREE.Euler(), fp = new THREE.Vector3(), f1 = new THREE.Vector3(1, 1, 1);
  const poseFans = (a: number) => {
    for (let i = 0; i < CAB; i++) { fe.set(0, a * (i % 2 ? -1 : 1) + i, 0); fans.setMatrixAt(i, fm4.compose(fp.set(-len / 2 + (i + 0.5) * (len / CAB), H + 0.1, 0), fq.setFromEuler(fe), f1)); }
    fans.instanceMatrix.needsUpdate = true;
  };
  poseFans(0);
  fans.computeBoundingSphere();
  root.add(fans);
  // LED panel across the four doors (one canvas, one draw)
  const PW = len - 0.5, PH = 1.95;
  const panel = createPanel({ w: PW, h: PH, px: 2048, name: 'stat:cpuRack:leds' });
  panel.mesh.position.set(0, 1.3, 0.074);
  root.add(panel.mesh);
  // heat shimmer: 4 rising wavy sheets above the cabinets (transparent overlay, only while hot)
  const shTex = shimmerTexture();
  const CEIL = 3.25 - root.position.y; // ENG ceiling, rack-local: the shimmer stays under it
  const SHH = Math.max(0.5, CEIL - H + 0.45);
  const shimmer = overlayMesh(new THREE.PlaneGeometry(len - 0.3, SHH), '#FFE2C4', 0.9);
  const shMat = shimmer.material;
  shMat.map = shTex;
  shMat.opacity = 0;
  shimmer.position.set(0, CEIL - SHH / 2 - 0.02, 0.22);
  shimmer.visible = false;
  root.add(shimmer);

  const cores = new Float32Array(16), shown = new Float32Array(16), peak = new Float32Array(16), peakT = new Float32Array(16);
  let keyT = 1, n = 16, heat = 0, hotIdx = -1, spin = 0, blink = false, blinkT = 0, last: Stats | null = null;
  const hot = new THREE.Vector3();

  const draw: DrawFn = (g, W, Hh) => {
    g.fillStyle = '#16181B';
    g.fillRect(0, 0, W, Hh);
    const colW = W / n;
    for (let i = 0; i < n; i++) {
      const cx = i * colW + colW / 2;
      const p = cores[i];
      const crit = p >= 90;
      // cabinet boundary gutters (every n/4 columns)
      if (i && i % Math.max(1, n / CAB) === 0) { g.fillStyle = '#0E0F11'; g.fillRect(i * colW - 3, 0, 6, Hh); }
      // label + value on top (eye level, over the ENG benches); the meter hangs below them
      drawDots(g, `C${i}`, cx, 12, 4, crit ? STATUS.blocked : ENV.butter, { align: 'center' });
      drawDots(g, `${Math.round(p)}`, cx, 50, 6, crit ? STATUS.blocked : '#F4EDE3', { align: 'center' });
      const lit = Math.round(clamp01(shown[i] / 100) * SEG);
      const top = 112, bot = Hh - 14, sh = (bot - top) / SEG, sw = colW * 0.66;
      g.fillStyle = '#0E0F11'; g.fillRect(cx - colW * 0.4, 102, colW * 0.8, 3);
      for (let k = 0; k < SEG; k++) {
        const y = bot - (k + 1) * sh + 3;
        rrect(g, cx - sw / 2, y, sw, sh - 6, 5);
        const on = k < lit;
        g.fillStyle = on ? (crit && blink ? SEG_COL(k) + '70' : SEG_COL(k)) : SEG_COL(k) + '26';
        g.fill();
      }
      // peak hold tick
      const pk = Math.round(clamp01(peak[i] / 100) * SEG);
      if (pk > lit) { g.fillStyle = SEG_COL(pk - 1); g.fillRect(cx - sw / 2, bot - pk * sh + 3, sw, 5); }
    }
  };

  return {
    object3d: root,
    redraws: () => panel.redraws,
    update(stats, dt, c) {
      const now = performance.now() / 1000;
      if (stats?.cpu?.cores?.length) {
        last = stats;
        n = Math.min(16, stats.cpu.cores.length);
        for (let i = 0; i < n; i++) {
          cores[i] = stats.cpu.cores[i];
          if (cores[i] >= peak[i]) { peak[i] = cores[i]; peakT[i] = now; }
        }
      }
      for (let i = 0; i < n; i++) {
        shown[i] += (cores[i] - shown[i]) * (1 - Math.exp(-dt * 6)); // meters settle (canvas samples at ≤ 2 Hz)
        if (now - peakT[i] > 2.5) peak[i] = Math.max(cores[i], peak[i] - 40 * Math.max(dt, 0.016));
      }
      // fans ∝ total CPU (a lazy idle turn at 0%)
      const total = last?.cpu?.total ?? 0;
      spin += (0.6 + total * 0.35) * dt;
      poseFans(spin);
      // heat shimmer > 75 °C
      const t = last?.temps?.cpu ?? 0;
      heat += (clamp01((t - 72) / 13) - heat) * (1 - Math.exp(-dt * 0.5));
      shimmer.visible = heat > 0.02;
      if (shimmer.visible) { shMat.opacity = 0.35 * heat; shTex.offset.y -= dt * 0.25; shTex.offset.x = Math.sin(now * 0.7) * 0.05; }
      // hottest cabinet (for the cat)
      let best = -1, bv = -1;
      for (let k = 0; k < CAB; k++) {
        let s = 0;
        const per = Math.max(1, Math.floor(n / CAB));
        for (let i = k * per; i < (k + 1) * per && i < n; i++) s += cores[i];
        if (s > bv) { bv = s; best = k; }
      }
      if (best !== hotIdx) {
        hotIdx = best;
        hot.set(-len / 2 + (best + 0.5) * (len / CAB), 0, 0.6);
        root.localToWorld(hot);
        ctx.bus?.emit?.('stats.hotSpot', { x: hot.x, y: 0, z: hot.z, tempC: t });
      }
      blinkT += dt;
      if (blinkT > 0.5) { blinkT = 0; blink = !blink; }
      keyT += dt;
      if (keyT < 0.25) { panel.tick(now); return; } // canvas keys at ≤ 4 Hz (uploads ≤ 2 Hz)
      keyT = 0;
      const anyCrit = cores.some((v, i) => i < n && v >= 90);
      let key = '';
      for (let i = 0; i < n; i++) key += `${Math.round(shown[i] / 100 * SEG)}.${Math.round(peak[i] / 100 * SEG)}.${Math.round(cores[i])},`;
      panel.draw(key + (anyCrit ? blink : ''), draw, now);
      panel.tick(now);
    },
    tooltip() {
      const s = ctx.store.stats;
      const cs = s?.cpu?.cores ?? [];
      let hi = 0, hiI = 0;
      cs.forEach((v, i) => { if (v > hi) { hi = v; hiI = i; } });
      return {
        title: `CPU · ${cs.length} threads`, value: s ? `avg ${pct(s.cpu.total)} · busiest c${hiI} ${pct(hi)} · ${(s.cpu.freqMHz / 1000).toFixed(1)} GHz · ${temp(s.temps?.cpu)}` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.cpu?.total), max: 100, source: '/proc/stat (per-cpu jiffies)', color: STATUS.shell, crit: hi >= 90,
      };
    },
    dispose() { panel.dispose(); shTex.dispose(); },
  };
});

