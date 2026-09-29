/**
 * Dial gauges (§7.4): the Engine Room **boiler pressure gauge** (CPU total + load, 1 m dial on the ENG glass, facing
 * the Pit; rattles and puffs steam past 85%) and the **thermostat** (CPU temp, inside ENG). A shared builder: clay +
 * brass bezel, a canvas dial face (ticks, red zone, an LCD readout redrawn ≤ 2 Hz) and a 3D needle that eases
 * toward its value every frame. Owner: STAT.
 */
import * as THREE from 'three';
import { registerStat } from './registry.ts';
import { createPanelSet, createParts, rrect, overlayMesh, FONT_UI } from './panel.ts';
import type { Parts, PanelBand, PanelSpec } from './panel.ts';
import type { Stats } from '../../../../shared/protocol.ts';
import { drawDots, dotWidth } from './dotfont.ts';
import { series, pct, temp, clamp01 } from './format.ts';
import { ENV, STATUS, CORE } from '../../../../shared/palette.ts';

const SWEEP = (270 * Math.PI) / 180;

/**
 * `parts`: the caller's clay builder (the dial body is merged into it, dial frame = caller frame); `panels`: more panel
 * specs sharing the face's draw (→ `dial.panels`).
 */
export interface DialOpts {
  r: number; min: number; max: number; step: number; label: string; unit: string; red: number; amber?: number;
  face?: string; bezel?: string; parts?: Parts; panels?: PanelSpec[];
}
export interface Dial {
  group: THREE.Group;
  face: PanelBand;
  panels: PanelBand[];
  set(v: number): void;
  /** `rattle` shakes the needle (over the red zone) */
  update(dt: number, rattle: boolean): void;
  draw(key: string, v: number, text: string, sub: string, crit: boolean, blink: boolean, now: number): void;
  dispose(): void;
}

export function createDial(o: DialOpts): Dial {
  const group = new THREE.Group();
  const P = o.parts ?? createParts();
  P.cyl(0, 0, -0.05, o.r + 0.05, o.r + 0.07, 0.1, '#3A3633', { rx: Math.PI / 2, seg: 36 });
  P.torus(0, 0, 0.0, o.r + 0.035, 0.035, o.bezel ?? '#B08A4A', { segT: 40, segR: 8 });
  P.cyl(0, 0, 0.045, o.r * 0.1, o.r * 0.1, 0.04, '#B08A4A', { rx: Math.PI / 2, seg: 16 }); // hub (static, over the needle root)
  if (!o.parts) group.add(P.mesh('stat:dial:body', { cast: true }));
  // face disc (+ the caller's panels) in one draw; CircleGeometry uvs map the disc into the unit square: the canvas is
  // drawn as a square
  const set = createPanelSet([{ w: o.r * 2, h: o.r * 2, px: 512, pos: [0, 0, 0.004], circle: true }, ...(o.panels ?? [])], { name: 'stat:dial:face' });
  group.add(set.mesh);
  const face = set.panels[0];
  // needle: tapered red blade + counterweight + brass hub
  const N = createParts();
  N.geo(new THREE.ConeGeometry(o.r * 0.06, o.r * 0.86, 4).rotateY(Math.PI / 4), 0, o.r * 0.36, 0, '#D8443A');
  N.cyl(0, -o.r * 0.12, 0, o.r * 0.07, o.r * 0.05, o.r * 0.22, '#D8443A', { seg: 8 });
  const needle = N.mesh('stat:dial:needle');
  needle.position.z = 0.03;
  group.add(needle);

  const ang = (v: number) => 0.75 * Math.PI - clamp01((v - o.min) / (o.max - o.min)) * SWEEP; // rotation.z
  let shown = o.min, target = o.min, jitter = 0, t = 0;
  const drawFace = (g: CanvasRenderingContext2D, W: number, Hh: number, v: number, text: string, sub: string, crit: boolean, blink: boolean) => {
    const cx = W / 2, cy = Hh / 2, R = W / 2;
    g.fillStyle = o.face ?? '#EFE6D6';
    g.fillRect(0, 0, W, Hh);
    // soft vignette ring
    const gr = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(90,60,40,.22)');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    // zones
    const a0 = (x: number) => Math.PI * 0.75 + clamp01((x - o.min) / (o.max - o.min)) * SWEEP; // canvas angle (clockwise from +x)
    g.lineWidth = R * 0.09;
    if (o.amber != null) { g.strokeStyle = STATUS.shellBusy; g.beginPath(); g.arc(cx, cy, R * 0.8, a0(o.amber), a0(o.red)); g.stroke(); }
    g.strokeStyle = STATUS.blocked; g.beginPath(); g.arc(cx, cy, R * 0.8, a0(o.red), a0(o.max)); g.stroke();
    // ticks + numbers
    g.strokeStyle = CORE.ink; g.fillStyle = CORE.ink;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${Math.round(R * 0.13)}px ${FONT_UI}`;
    for (let x = o.min; x <= o.max + 1e-6; x += o.step / 2) {
      const a = a0(x), major = Math.abs(((x - o.min) / o.step) % 1) < 1e-6;
      g.lineWidth = major ? R * 0.025 : R * 0.012;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R * (major ? 0.68 : 0.73), cy + Math.sin(a) * R * (major ? 0.68 : 0.73));
      g.lineTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86);
      g.stroke();
      if (major) g.fillText(String(x), cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55);
    }
    // label
    g.font = `800 ${Math.round(R * 0.12)}px ${FONT_UI}`;
    g.fillStyle = '#6B6760';
    g.fillText(o.label, cx, cy - R * 0.3);
    // LCD readout window
    const bw = R * 0.84, bh = R * 0.3, bx = cx - bw / 2, by = cy + R * 0.45; // under the 0 / max numerals, not over them
    rrect(g, bx, by, bw, bh, R * 0.06);
    g.fillStyle = '#1B1A19'; g.fill();
    const pitch = Math.min(bh * 0.7 / 7, bw * 0.9 / Math.max(1, text.length * 6 - 1));
    drawDots(g, text, cx, by + (bh - pitch * 7) / 2, pitch, crit && blink ? STATUS.blocked : crit ? '#FF8C7E' : ENV.butter, { align: 'center', ghost: 0.08 });
    if (sub) { g.fillStyle = '#4A4641'; g.font = `800 ${Math.round(R * 0.1)}px ${FONT_UI}`; g.fillText(sub, cx, by + bh + R * 0.09); }
  };
  return {
    group, face, panels: set.panels.slice(1),
    set(v) { target = v; },
    update(dt, rattle) {
      t += dt;
      shown += (target - shown) * (1 - Math.exp(-dt * 3));
      jitter = rattle ? Math.sin(t * 47) * 0.035 + Math.sin(t * 31) * 0.02 : 0;
      needle.rotation.z = ang(shown) + jitter;
    },
    draw(key, v, text, sub, crit, blink, now) { face.draw(`${key}|${crit && blink}`, (g, W, Hh) => drawFace(g, W, Hh, v, text, sub, crit, blink), now); face.tick(now); },
    dispose() { set.dispose(); },
  };
}

/** Steam puffs: one instanced overlay (1 draw) of spheres rising from a valve. */
function createSteam(n = 5) {
  const inst = overlayMesh(new THREE.SphereGeometry(0.055, 10, 8), '#F4EDE3', 0.9, n);
  inst.material.opacity = 0.32;
  inst.count = 0;
  inst.frustumCulled = false;
  inst.name = 'stat:steam';
  inst.visible = false;
  const ts = Array.from({ length: n }, (_, i) => i / n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  return {
    group: inst,
    update(dt: number, on: boolean) {
      inst.count = on ? n : 0;
      inst.visible = on; // count 0 still costs a draw call
      if (!on) return;
      for (let i = 0; i < n; i++) {
        ts[i] = (ts[i] + dt * 0.9) % 1;
        const t = ts[i], s = 0.5 + t * 2.2;
        m4.compose(p.set(Math.sin(t * 9 + s) * 0.05, t * 0.9, t * 0.2), q, sc.setScalar(s));
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- boiler: CPU total + load ---------------------------------------------------------------------------------------
registerStat('boiler', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:boiler';
  // on the atrium side of the ENG wall, lifted well above the stair handrail (the stairs run along this wall: at y 2.0
  // the stringer and rail cross the dial from the Pit; at 3.25 the rail still clipped the load plaque under it)
  const Y = Math.max(anchor.pos.y, 3.5);
  // shifted 0.95 m south along the wall: ENV hangs posters either side of z 13 at this height
  root.position.set(anchor.pos.x - 0.14, Y, anchor.pos.z + 0.95);
  root.rotation.y = anchor.yaw;
  const PLQ_W = 1.0, PLQ_H = 0.34, PLQ_Y = -0.76; // load plaque hung under the dial (face at ~2.74 m: over the glass head and the rail)
  // dial body + pipes in one clay mesh; dial face + load plaque (hung under the gauge, legible at 4 m) in one panel draw
  const P = createParts();
  const dial = createDial({ r: 0.5, min: 0, max: 100, step: 20, label: 'CPU', unit: '%', red: 85, amber: 65, parts: P, panels: [{ w: PLQ_W, h: PLQ_H, px: 512, pos: [0, PLQ_Y, 0] }] });
  root.add(dial.group);
  // copper pipes up to the ceiling and down to the floor, with a valve wheel and a steam whistle on top
  const copper = '#B8734A';
  const up = 5.5 - Y;
  P.cyl(0.62, -0.2 + (up + 0.2) / 2, -0.05, 0.05, 0.05, up + 0.2, copper, { seg: 10 });
  P.sphere(0.62, -0.2, -0.05, 0.07, copper, { seg: 10, segV: 6 });
  P.cyl(0.36, 0, -0.05, 0.035, 0.035, 0.36, copper, { rz: Math.PI / 2, seg: 8 });
  P.torus(0.62, 0.62, 0.06, 0.13, 0.02, STATUS.blocked, { segT: 20, segR: 6 });
  P.cyl(0.62, 0.62, 0.0, 0.03, 0.03, 0.12, copper, { rx: Math.PI / 2, seg: 8 });
  P.cyl(0, 0.62, -0.05, 0.05, 0.07, 0.18, '#B08A4A', { seg: 12 });
  P.cyl(0, 0.76, -0.05, 0.035, 0.05, 0.1, '#B08A4A', { seg: 12 });
  P.box(0, PLQ_Y, -0.03, PLQ_W + 0.08, PLQ_H + 0.08, 0.05, '#3A3633', { r: 0.02 }); // plaque backing
  { // two short brass hanger rods from the dial rim down to the plaque
    const top = -Math.sqrt(0.55 ** 2 - 0.3 ** 2), bot = PLQ_Y + PLQ_H / 2 + 0.04;
    for (const sx of [-1, 1]) P.cyl(sx * 0.3, (top + bot) / 2, -0.035, 0.014, 0.014, top - bot + 0.04, '#B08A4A', { seg: 6 });
  }
  root.add(P.mesh('stat:boiler:pipes', { cast: true }));
  const steam = createSteam(6);
  steam.group.position.set(0, 0.82, -0.05);
  root.add(steam.group);
  const plaque = dial.panels[0];
  let blink = false, bt = 0, last: Stats | null = null;
  return {
    object3d: root,
    redraws: () => dial.face.redraws + plaque.redraws,
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats?.cpu) last = stats;
      const v = last?.cpu?.total ?? 0;
      dial.set(v);
      const hot = v > 85;
      dial.update(dt, hot);
      steam.update(dt, hot);
      root.position.y = Y + (hot ? Math.sin(now * 53) * 0.004 : 0);
      bt += dt; if (bt > 0.5) { bt = 0; blink = !blink; }
      const load = last?.cpu?.load ?? [0, 0, 0];
      dial.draw(`${Math.round(v)}`, v, `${Math.round(v)}%`, `${last?.cpu?.freqMHz ? (last.cpu.freqMHz / 1000).toFixed(1) + ' GHz' : ''}`, v >= 90, blink, now);
      plaque.draw(load.map((x) => x.toFixed(1)).join(','), (g, W, H) => {
        g.fillStyle = '#1E1C1B'; g.fillRect(0, 0, W, H);
        // two rows so the label can never run into the digits: a small caption, then the three averages as big as fit
        drawDots(g, 'LOAD  1 5 15 MIN', W / 2, 12, 3, '#9A9186', { align: 'center' });
        const txt = load.map((x) => x.toFixed(1)).join(' ');
        const pitch = Math.min(11, (W - 36) / Math.max(1, dotWidth(txt)), (H - 50 - 12) / 7);
        drawDots(g, txt, W / 2, 44 + (H - 44 - 8 - pitch * 7) / 2, pitch, ENV.butter, { align: 'center', ghost: 0.06 });
      }, now);
      plaque.tick(now);
    },
    tooltip() {
      const s = ctx.store.stats;
      return {
        title: 'CPU · boiler gauge', value: s ? `${pct(s.cpu.total)} · load ${s.cpu.load.map((x) => x.toFixed(2)).join(' / ')} · psi cpu ${s.cpu.psi?.cpu ?? '--'}` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.cpu?.total), max: 100, source: '/proc/stat · /proc/loadavg', color: ENV.butter, crit: (s?.cpu?.total ?? 0) >= 90,
      };
    },
    dispose() { dial.dispose(); },
  };
});

// ---- thermostat: CPU temp -------------------------------------------------------------------------------------------
registerStat('thermostat', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:thermostat';
  root.position.set(anchor.pos.x + 0.06, anchor.pos.y, anchor.pos.z);
  root.rotation.y = anchor.yaw;
  const dial = createDial({ r: 0.24, min: 30, max: 100, step: 10, label: 'CPU °C', unit: '°', red: 85, amber: 75, face: '#E9DFCC', bezel: '#7B5238' });
  root.add(dial.group);
  let blink = false, bt = 0, last: Stats | null = null;
  return {
    object3d: root,
    redraws: () => dial.face.redraws,
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats?.temps) last = stats;
      const v = last?.temps?.cpu ?? 30;
      dial.set(v);
      dial.update(dt, v >= 90);
      bt += dt; if (bt > 0.5) { bt = 0; blink = !blink; }
      dial.draw(`${Math.round(v)}`, v, `${Math.round(v)}°`, '', v >= 90, blink, now);
    },
    tooltip() {
      const s = ctx.store.stats;
      return {
        title: 'CPU temperature · thermostat', value: s ? `${temp(s.temps?.cpu)} · GPU ${temp(s.temps?.gpu)} · wifi ${temp(s.temps?.wifi)}` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.temps?.cpu), max: 100, source: 'hwmon k10temp (Tctl)', color: STATUS.blocked, crit: (s?.temps?.cpu ?? 0) >= 90,
      };
    },
    dispose() { dial.dispose(); },
  };
});
