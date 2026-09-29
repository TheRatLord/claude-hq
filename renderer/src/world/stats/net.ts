/**
 * Network (§7.4): a **radio mast** on the roof (rings ∝ log bytes/s: tx amber rings expand outward, rx blue rings
 * converge onto the mast; a beacon blinks) and **light pulses along a ceiling cable tray** across the atrium (rx blue
 * pulses run in from the street end, tx amber pulses run out; not capsules — capsule = commit, §6.7). A hanging plaque
 * under the tray reads `↓ 56 KB/s ↑ 1.3 MB/s`. Owner: STAT.
 */
import * as THREE from 'three';
import { registerStat } from './registry.ts';
import { createPanel, createParts, glowMaterial, one, overlayMesh, screenMat, setIntensity, setLod } from './panel.ts';
import type { Stats } from '../../../../shared/protocol.ts';
import { drawDots } from './dotfont.ts';
import { series, rate, logRate } from './format.ts';
import { STATUS } from '../../../../shared/palette.ts';

const RX = '#5AB0F0', TX = '#F4B860';

/** One lane of cable-tray pulses: positions along the tray (0..1), spawn accumulator, row height, colour. */
interface Lane { t: number[]; acc: number; y: number; c: THREE.Color }

// ---- roof mast -------------------------------------------------------------------------------------------------------
registerStat('mast', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:mast';
  // stands just outside the north façade so it reads through the mezzanine's high windows (sill 3.65–4.9) and from
  // outside; an anchor inside the footprint would be hidden by the roof from every interior view
  const b = ctx.layout.bounds;
  const z = b && anchor.pos.z > b.minZ ? b.minZ - 1.9 : anchor.pos.z;
  const roofY = 0;
  root.position.set(anchor.pos.x, roofY, z);
  const H = Math.max(2.5, anchor.pos.y + 1.6);
  const P = createParts();
  P.box(0, 0.08, 0, 0.8, 0.16, 0.8, '#57534D', { r: 0.04 });
  // lattice mast: 3 legs + cross braces
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    P.cyl(Math.cos(a) * 0.14, H / 2, Math.sin(a) * 0.14, 0.02, 0.028, H, '#C9CDD2', { seg: 6 });
  }
  for (let y = 0.4; y < H - 0.2; y += 0.45) P.torus(0, y, 0, 0.15, 0.012, '#C9CDD2', { rx: Math.PI / 2, segT: 12, segR: 4 });
  P.sphere(0, H + 0.02, 0, 0.05, '#C9CDD2', { seg: 8, segV: 6 });
  // two dish antennas
  P.cyl(0.24, H * 0.62, 0, 0.16, 0.05, 0.08, '#EDE6DA', { rz: Math.PI / 2, seg: 16 });
  P.cyl(-0.2, H * 0.4, 0.1, 0.12, 0.04, 0.06, '#EDE6DA', { rz: -Math.PI / 2, ry: 0.5, seg: 16 });
  root.add(P.mesh('stat:mast:body', { cast: true }));
  const beaconMat = screenMat({ color: STATUS.blocked, emissive: 1.4, strip: null, instanced: true, uniforms: {} });
  const beacon = one(new THREE.SphereGeometry(0.07, 10, 8), beaconMat);
  beacon.position.y = H + 0.1;
  root.add(beacon);
  // rings: 3 tx (expand) + 3 rx (converge) in ONE instanced overlay (m2 r2 draw budget: was 6 materials / 6 draws);
  // instance colour = lane colour, a ring fades by flattening + thinning (instances share one opacity)
  const ringGeo = new THREE.TorusGeometry(1, 0.03, 6, 48).rotateX(Math.PI / 2);
  const ringMesh = overlayMesh(ringGeo, '#FFFFFF', 1.2, 6);
  ringMesh.name = 'stat:mast:rings';
  setLod(ringMesh, { hi: ringGeo, lo: new THREE.TorusGeometry(1, 0.03, 3, 20).rotateX(Math.PI / 2) }); // [STAT fix m3 r3 code]
  ringMesh.material.opacity = 0.7;
  ringMesh.frustumCulled = false;
  ringMesh.count = 0;
  ringMesh.visible = false;
  const txC = new THREE.Color(TX), rxC = new THREE.Color(RX);
  for (let i = 0; i < 6; i++) ringMesh.setColorAt(i, i < 3 ? txC : rxC);
  root.add(ringMesh);
  const rings: { tx: boolean; y: number; t: number; live: boolean }[] = [];
  for (let i = 0; i < 6; i++) rings.push({ tx: i < 3, y: 4.4 + (i % 3) * 0.9, t: (i % 3) / 3, live: false }); // heights: the mezzanine window band and above
  const rm4 = new THREE.Matrix4(), rq = new THREE.Quaternion(), rp = new THREE.Vector3(), rs = new THREE.Vector3();
  let last: Stats | null = null, t = 0;
  return {
    object3d: root,
    update(stats, dt) {
      if (stats?.net) last = stats;
      t += dt;
      setIntensity(beaconMat, (t % 1.6) < 0.25 ? 1.6 : 0.25);
      const kt = logRate(last?.net?.txBps ?? 0), kr = logRate(last?.net?.rxBps ?? 0);
      let n = 0;
      for (let i = 0; i < 6; i++) {
        const r = rings[i];
        const k = r.tx ? kt : kr;
        r.t += dt * (0.25 + k * 1.2);
        if (r.t >= 1) { r.t -= 1; r.live = k > 0.02; }
        if (!r.live) continue;
        const u = r.tx ? r.t : 1 - r.t;
        // [RND m2 fix r2, cross-owner STAT] radius capped ≈ 1.6 m (was up to 4.75 m): from the mezzanine windows, at eye
        // height, the big amber ring read as a UFO band across the night skyline (crop_mezz_window22)
        const s = 0.25 + u * (0.75 + k * 0.6);
        const fade = Math.max(0.05, r.tx ? 1 - r.t : r.t);
        ringMesh.setMatrixAt(n, rm4.compose(rp.set(0, r.y, 0), rq, rs.set(s, fade, s)));
        ringMesh.setColorAt(n, r.tx ? txC : rxC);
        n++;
      }
      ringMesh.count = n;
      ringMesh.visible = n > 0;
      if (n) { ringMesh.instanceMatrix.needsUpdate = true; if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true; }
    },
    tooltip() {
      const n = ctx.store.stats?.net;
      return {
        title: 'Network · radio mast', value: n ? `↓ ${rate(n.rxBps)} · ↑ ${rate(n.txBps)} · ${n.ifaces?.join(' ')}` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.net ? (x.net.rxBps + x.net.txBps) / 1024 : null), source: '/proc/net/dev (KB/s)', color: TX,
      };
    },
  };
});

// ---- cable tray with rx / tx light pulses -----------------------------------------------------------------------------
registerStat('cableTray', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:cableTray';
  const [x0, z0, x1, z1] = anchor.span ?? [anchor.pos.x - 6, anchor.pos.z, anchor.pos.x + 6, anchor.pos.z];
  const len = Math.hypot(x1 - x0, z1 - z0);
  root.position.set((x0 + x1) / 2, anchor.pos.y, (z0 + z1) / 2 + 0.35);
  root.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
  const P = createParts();
  P.box(0, 0, 0, len, 0.04, 0.34, '#8E949B', { r: 0.01 });
  for (const z of [-0.17, 0.17]) P.box(0, 0.05, z, len, 0.1, 0.02, '#8E949B', { r: 0 });
  for (let x = -len / 2 + 0.6; x < len / 2; x += 2.2) {
    P.box(x, 0.06, 0, 0.05, 0.02, 0.36, '#6E7479', { r: 0 });
    P.cyl(x, 0.2, 0, 0.012, 0.012, 0.3, '#6E7479', { seg: 5 }); // hanger rods to the ceiling
  }
  // cable bundle
  P.cyl(0, 0.045, -0.07, 0.03, 0.03, len, '#2F5E62', { rz: Math.PI / 2, seg: 8 });
  P.cyl(0, 0.045, 0.07, 0.03, 0.03, len, '#4B4FA6', { rz: Math.PI / 2, seg: 8 });
  P.cyl(0, 0.05, 0.0, 0.035, 0.035, len, '#3A3633', { rz: Math.PI / 2, seg: 8 });
  // a dark backing strip under the front lip: the pulses run in front of it
  P.box(0, -0.075, 0.16, len, 0.13, 0.015, '#2B3C44', { r: 0 });
  const N = 28;
  // rx + tx pulses: ONE instanced unlit mesh (instance colour = lane colour; white material = no status strip), rx
  // lane at the top row, tx under it; under the tray's front lip, visible from the atrium floor
  const pulseGeo = new THREE.SphereGeometry(0.05, 10, 6).scale(3.2, 0.8, 0.8);
  const pulses = one(pulseGeo, glowMaterial('#FFFFFF', 1.3), N * 2);
  pulses.name = 'stat:tray:pulses';
  setLod(pulses, { hi: pulseGeo, lo: new THREE.SphereGeometry(0.05, 6, 4).scale(3.2, 0.8, 0.8) }); // [STAT fix m3 r3 code]
  pulses.count = 0;
  pulses.frustumCulled = false;
  pulses.position.set(0, 0, 0.2);
  root.add(pulses);
  const rxC = new THREE.Color(RX), txC = new THREE.Color(TX);
  const rx: Lane = { t: [], acc: 0, y: -0.04, c: rxC }, tx: Lane = { t: [], acc: 0, y: -0.11, c: txC };
  // plaque hanging under the tray midpoint, facing the atrium (+z local → south); its backing + hangers join the body
  const plaque = createPanel({ w: 1.3, h: 0.32, px: 640, name: 'stat:tray:plaque' });
  plaque.mesh.position.set(0, -0.32, 0.2);
  root.add(plaque.mesh);
  P.box(0, -0.32, 0.17, 1.38, 0.4, 0.05, '#2A2725', { r: 0.02 });
  for (const x of [-0.55, 0.55]) P.cyl(x, -0.06, 0.17, 0.01, 0.01, 0.12, '#6E7479', { seg: 5 });
  root.add(P.mesh('stat:tray:body'));
  const m4 = new THREE.Matrix4();
  let last: Stats | null = null, n = 0;
  const step = (lane: Lane, k: number, dir: number, dt: number) => {
    // spawn ∝ log rate: 0.3 → 9 pulses/s
    lane.acc += dt * (k > 0.02 ? 0.3 + k * 9 : 0);
    while (lane.acc >= 1 && lane.t.length < N) { lane.acc -= 1; lane.t.push(0); }
    if (lane.acc >= 1) lane.acc = 0;
    const v = 3 + k * 5; // m/s
    for (let i = lane.t.length - 1; i >= 0; i--) { lane.t[i] += (dt * v) / len; if (lane.t[i] >= 1) lane.t.splice(i, 1); }
    for (let i = 0; i < lane.t.length; i++) { m4.makeTranslation(dir * (lane.t[i] - 0.5) * len, lane.y, 0); pulses.setMatrixAt(n, m4); pulses.setColorAt(n, lane.c); n++; }
  };
  return {
    object3d: root,
    redraws: () => plaque.redraws,
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats?.net) last = stats;
      const nt = last?.net;
      n = 0;
      step(rx, logRate(nt?.rxBps ?? 0), -1, dt); // rx runs in from the east (street-side) end
      step(tx, logRate(nt?.txBps ?? 0), 1, dt);
      pulses.count = n;
      pulses.visible = n > 0;
      pulses.instanceMatrix.needsUpdate = true;
      if (pulses.instanceColor) pulses.instanceColor.needsUpdate = true;
      plaque.draw(`${rate(nt?.rxBps)}|${rate(nt?.txBps)}`, (g, W, H) => {
        g.fillStyle = '#1E1C1B'; g.fillRect(0, 0, W, H);
        drawDots(g, 'NET', 18, (H - 28) / 2, 4, '#9A9186');
        drawDots(g, `↓${rate(nt?.rxBps)}`, 110, 22, 5, RX, { ghost: 0.05 });
        drawDots(g, `↑${rate(nt?.txBps)}`, 110, 22 + 50, 5, TX, { ghost: 0.05 });
      }, now);
      plaque.tick(now);
    },
    tooltip() {
      const n = ctx.store.stats?.net;
      return {
        title: 'Network · cable tray', value: n ? `↓ rx ${rate(n.rxBps)} · ↑ tx ${rate(n.txBps)}` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.net ? (x.net.rxBps + x.net.txBps) / 1024 : null), source: '/proc/net/dev (KB/s)', color: RX,
      };
    },
    dispose() { plaque.dispose(); },
  };
});
