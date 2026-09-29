/**
 * GPU busy as a hamster wheel with a mini Clawd running in it (§7.4, GP §4): wheel speed ∝ `gpu_busy_percent`, the
 * mini's legs blur and its body bobs faster, it leans forward and sweats past 85%. No GPU source → the mini sits
 * outside on a crate next to an "ON BREAK" sign. A cream marquee hung over the wheel reads `GPU 29%` (details in the
 * tooltip). Owner: STAT.
 */
import * as THREE from 'three';
import { registerStat } from './registry.ts';
import { createPanel, createParts, whiteInstances, glowMesh, rrect } from './panel.ts';
import type { Stats } from '../../../../shared/protocol.ts';
import { drawDots, dotWidth } from './dotfont.ts';
import { series, pct, temp } from './format.ts';
import { getMaterial } from '../../render/materials/index.ts';
import { CORE, ENV, STATUS } from '../../../../shared/palette.ts';

const R = 0.6, AXLE_Y = 0.78, DEPTH = 0.42;

/** A tiny procedural Clawd (≈ 0.3 m): body + eyes + arm nubs in one mesh, 4 legs as one InstancedMesh. */
export function createMiniClawd() {
  const g = new THREE.Group();
  const B = createParts();
  B.box(0, 0.17, 0, 0.3, 0.2, 0.2, CORE.clay, { r: 0.06 });
  for (const s of [-1, 1]) {
    B.box(s * 0.055, 0.2, 0.101, 0.026, 0.05, 0.01, CORE.ink, { r: 0.008 });      // eyes (front = +z)
    B.box(s * 0.175, 0.17, 0, 0.06, 0.06, 0.08, CORE.clay, { r: 0.02 });            // arm nubs
  }
  const body = B.mesh('stat:mini:body', { cast: true });
  g.add(body);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.1, 0.05).translate(0, -0.05, 0), getMaterial('toonProp', { color: CORE.clay, instanced: true }), 4);
  legs.name = 'stat:mini:legs';
  whiteInstances(legs);
  g.add(legs);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const LEG = [[-0.1, -0.05], [-0.035, 0.05], [0.035, -0.05], [0.1, 0.05]];
  return {
    group: g, body,
    /** phase: gait phase (rad); amp: stride 0..1; bob: body bounce (m); sit: 0..1 (legs tucked) */
    pose(phase: number, amp: number, bob: number, sit = 0) {
      body.position.y = bob - sit * 0.06;
      for (let i = 0; i < 4; i++) {
        const ph = phase + (i % 2 ? Math.PI : 0);
        e.set(0, 0, Math.sin(ph) * 0.9 * amp * (1 - sit) + sit * 1.2);
        q.setFromEuler(e);
        m4.compose(p.set(LEG[i][0], 0.1 + body.position.y * 0.3 - sit * 0.05, LEG[i][1]), q, s);
        legs.setMatrixAt(i, m4);
      }
      legs.instanceMatrix.needsUpdate = true;
    },
  };
}

registerStat('hamster', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:hamster';
  root.position.set(anchor.pos.x, anchor.pos.y ?? 0, anchor.pos.z); // anchor y = the ENG floor (+0.25): at 0 the plinth and plaque sank into it
  root.rotation.y = anchor.yaw;
  // stand: base plate, two A-frames, axle hubs
  const S = createParts();
  S.box(0, 0.04, 0, 1.4, 0.08, 0.8, ENV.walnut, { r: 0.03 });
  for (const z of [-DEPTH / 2 - 0.08, DEPTH / 2 + 0.08]) {
    for (const sx of [-1, 1]) S.box(sx * 0.2, AXLE_Y / 2 + 0.04, z, 0.06, AXLE_Y + 0.06, 0.06, ENV.oak, { rz: sx * 0.42, r: 0.02 });
    S.cyl(0, AXLE_Y, z, 0.06, 0.06, 0.06, '#B08A4A', { rx: Math.PI / 2, seg: 14 });
  }
  S.cyl(0, AXLE_Y, 0, 0.022, 0.022, DEPTH + 0.2, '#8E949B', { rx: Math.PI / 2, seg: 8 });
  // water bottle + food bowl (charm)
  S.cyl(0.55, 0.35, -0.3, 0.05, 0.05, 0.4, '#9FD0F0', { seg: 12 });
  S.cyl(0.55, 0.58, -0.3, 0.03, 0.05, 0.06, STATUS.blocked, { seg: 10 });
  S.cyl(-0.55, 0.1, 0.22, 0.09, 0.06, 0.05, STATUS.working, { seg: 14 });
  // wheel: rims + rungs + spokes, rotating about the local z axle
  const W = createParts();
  for (const z of [-DEPTH / 2, DEPTH / 2]) {
    W.torus(0, 0, z, R, 0.03, '#E0A94A', { segT: 40, segR: 8 });
    for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; W.box(Math.cos(a) * R / 2, Math.sin(a) * R / 2, z, R, 0.025, 0.025, '#C98E3A', { rz: a, r: 0 }); }
  }
  for (let k = 0; k < 20; k++) { const a = (k * Math.PI * 2) / 20; W.cyl(Math.cos(a) * R, Math.sin(a) * R, 0, 0.014, 0.014, DEPTH, '#8E949B', { rx: Math.PI / 2, seg: 6 }); }
  const wheel = W.mesh('stat:hamster:wheel', { cast: true });
  wheel.position.y = AXLE_Y;
  root.add(wheel);
  // the runner
  const mini = createMiniClawd();
  mini.group.position.set(0, AXLE_Y - R + 0.02, 0);
  mini.group.rotation.y = 0.55; // three-quarter toward the room while it runs toward −x
  mini.group.scale.setScalar(1.25);
  root.add(mini.group);
  // sweat drop (past 85%)
  const sweat = glowMesh(new THREE.SphereGeometry(0.018, 8, 6), '#9FD0F0', 0.85);
  sweat.visible = false;
  root.add(sweat);
  // [STAT m2 r2 art] plaque: a cream clay marquee hung from the ENG ceiling on two brass rods, high over the wheel
  // (face 2.23–2.65 m local), so from the engine pose it sits over the rack's top vents, clear of the C0–C15 header;
  // ink dot-matrix digits ≥ 1.5× the old glyphs (no ≈ 5 px subtext: MHz / W / °C live in the tooltip)
  const PW = 1.3, PH = 0.42, PY = 2.44, PZ = -0.26, TILT = 0.1, PX = -0.3; // PX: toward the ENG wall, clear of the ceiling duct
  const CEIL = Math.max(PY + PH / 2 + 0.2, 3.25 - (anchor.pos.y ?? 0)); // ENG ceiling, local
  const plaque = createPanel({ w: PW, h: PH, px: 512, gain: 0.86, name: 'stat:hamster:plaque' });
  plaque.mesh.position.set(PX, PY, PZ + 0.03);
  plaque.mesh.rotation.x = TILT;
  root.add(plaque.mesh);
  // backing + rods join the stand (one clay draw)
  S.box(PX, PY, PZ, PW + 0.1, PH + 0.1, 0.05, ENV.walnut, { rx: TILT, r: 0.025 });
  S.box(PX, PY + PH / 2 + 0.07, PZ - 0.005, PW + 0.16, 0.05, 0.09, '#B08A4A', { rx: TILT, r: 0.02 }); // brass cap
  for (const sx of [-1, 1]) {
    const top = PY + PH / 2 + 0.1;
    S.cyl(PX + sx * 0.55, (top + CEIL) / 2, PZ - 0.02, 0.014, 0.014, CEIL - top, '#B08A4A', { seg: 6 });
    S.sphere(PX + sx * 0.55, top, PZ - 0.01, 0.035, ENV.butter, { seg: 10, segV: 6 });
  }
  root.add(S.mesh('stat:hamster:stand', { cast: true }));
  const brk = createPanel({ w: 0.5, h: 0.28, px: 256, name: 'stat:hamster:break' });
  brk.mesh.position.set(0.95, 0.75, 0.1);
  brk.mesh.visible = false;
  root.add(brk.mesh);
  brk.draw('b', (g, w, h) => { g.fillStyle = ENV.butter; g.fillRect(0, 0, w, h); drawDots(g, 'ON', w / 2, 14, 5, CORE.ink, { align: 'center' }); drawDots(g, 'BREAK', w / 2, 62, 5, CORE.ink, { align: 'center' }); }, 0);

  let angle = 0, phase = 0, speed = 0, t = 0, last: Stats | null = null;
  return {
    object3d: root,
    redraws: () => plaque.redraws,
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats) last = stats;
      const gpu = last?.gpu ?? null;
      const busy = gpu ? gpu.busy ?? 0 : 0;
      t += dt;
      const want = gpu ? 0.25 + (busy / 100) * 9 : 0; // rad/s
      speed += (want - speed) * (1 - Math.exp(-dt * 1.5));
      angle += speed * dt;
      wheel.rotation.z = angle;
      // the runner keeps its place at the bottom; gait follows the rim speed (v = ωR)
      const v = speed * R;
      phase += dt * v * 18;
      const onBreak = !gpu;
      brk.mesh.visible = onBreak;
      if (onBreak) {
        mini.group.position.set(0.95, 0.2, 0.3);
        mini.group.rotation.set(0, -0.3, 0);
        mini.pose(0, 0, 0.0, 1);
      } else {
        mini.group.position.set(-v * 0.02, AXLE_Y - R + 0.03, 0);
        mini.group.rotation.set(0, 0.55, Math.min(0.35, v * 0.08)); // leans into the run
        mini.pose(phase, Math.min(1, 0.3 + v * 0.4), Math.abs(Math.sin(phase)) * Math.min(0.05, 0.01 + v * 0.01));
      }
      sweat.visible = !onBreak && busy > 85;
      if (sweat.visible) { const k = (t * 1.3) % 1; sweat.position.set(mini.group.position.x + 0.1, mini.group.position.y + 0.33 - k * 0.2, 0.08); }
      const hot = busy > 85;
      const num = gpu ? `${Math.round(busy)}%` : '--';
      plaque.draw(`${num}|${hot}`, (g, w, h) => {
        // cream clay plate, walnut keyline, ink dot-matrix (red past 85%)
        g.fillStyle = '#F3E8D2'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#6B4A33'; g.lineWidth = 6; rrect(g, 9, 9, w - 18, h - 18, 12); g.stroke();
        const ink = hot ? STATUS.blocked : CORE.ink;
        const pBig = Math.min(15, (h - 44) / 7, (w - 150) / Math.max(1, dotWidth(num)));
        const pLab = Math.min(6.5, pBig * 0.45);
        const lx = 30, lw = dotWidth('GPU') * pLab;
        drawDots(g, 'GPU', lx, (h - 7 * pLab) / 2, pLab, '#4A3526', { dot: 0.5 });
        const rx0 = lx + lw + 18, rx1 = w - 26;
        drawDots(g, num, (rx0 + rx1) / 2, (h - 7 * pBig) / 2, pBig, ink, { align: 'center', ghost: 0.05, dot: 0.5 });
      }, now);
      plaque.tick(now);
    },
    tooltip() {
      const g = ctx.store.stats?.gpu;
      return {
        title: 'GPU · hamster wheel', value: g ? `${pct(g.busy)} busy · ${g.clockMHz} MHz · ${g.powerW} W · ${temp(g.tempC)}` : 'no GPU source (hamster on break)',
        spark: series(ctx.store.statsHistory, (x) => x.gpu?.busy), max: 100, source: '/sys/class/drm/card*/device/gpu_busy_percent', color: '#E0A94A', crit: (g?.busy ?? 0) >= 90,
      };
    },
    dispose() { plaque.dispose(); brk.dispose(); },
  };
});
