/**
 * The smaller §7.4 stats objects:
 * - **microfiche** (Disk I/O, ARC): a film reel spins ∝ log(MB/s); the reader screen shows read / write rates.
 * - **nvmeThermo** (NVMe temp, ARC vault door): a mercury thermometer on a brass backing plate, 20–90 °C.
 * - **hiScore** (VRAM, CAF arcade): an arcade HI-SCORE marquee over the cabinets, VRAM as a pixel bar + GTT.
 * - **uptime** (ENG door): a "DAYS SINCE LAST REBOOT" safety sign with flip digits (flip animation on change).
 * - **clock** (LOB, over the entrance): a wall clock (hands follow the scene's time of day) + a date plaque.
 * Owner: STAT.
 */
import * as THREE from 'three';
import { registerStat } from './registry.ts';
import { createPanel, createPanelSet, createParts, glowMesh, whiteInstances, lodOf, setLod, FONT_UI } from './panel.ts';
import type { PanelBand } from './panel.ts';
import type { StatAnchorCell } from './registry.ts';
import type { Stats } from '../../../../shared/protocol.ts';
import { drawDots, drawPixelClawd } from './dotfont.ts';
import { CAFE_BOARDS, LAB_BOARDS, boardSpecs, createSpecials, createTallies } from './boards.ts';
import { series, rate, logRate, temp, gib, uptime, GiB, clamp01 } from './format.ts';
import { getMaterial } from '../../render/materials/index.ts';
import { CORE, ENV, STATUS } from '../../../../shared/palette.ts';

/** A Group in `root`'s pose holding `mesh` (a panel set shared with another stats object, see hiScore / clock). */
const hostFrame = (root: THREE.Object3D, mesh: THREE.Object3D) => {
  const g = new THREE.Group();
  g.position.copy(root.position); g.quaternion.copy(root.quaternion);
  g.add(mesh);
  return g;
};

const place = (root: THREE.Object3D, anchor: StatAnchorCell, dy = 0) => {
  root.position.set(anchor.pos.x, (anchor.pos.y ?? 0) + dy, anchor.pos.z);
  root.rotation.y = anchor.yaw;
};

// ---- microfiche: disk I/O ---------------------------------------------------------------------------------------------
registerStat('microfiche', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:microfiche';
  place(root, anchor, -anchor.pos.y); // furniture sits on the floor
  const R = createParts();
  R.torus(0, 0, 0, 0.2, 0.025, '#3A3F48', { segT: 28, segR: 6 });
  R.cyl(0, 0, 0, 0.19, 0.19, 0.012, '#4E6770', { rx: Math.PI / 2, seg: 28 });
  for (let k = 0; k < 3; k++) { const a = (k * Math.PI * 2) / 3; R.cyl(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.01, 0.045, 0.045, 0.02, '#E0C07A', { rx: Math.PI / 2, seg: 12 }); }
  R.cyl(0, 0, 0.015, 0.035, 0.035, 0.03, '#B08A4A', { rx: Math.PI / 2, seg: 10 });
  // both reels: one instanced mesh (2 instances, re-posed each frame)
  const reelSrc = R.mesh('stat:fiche:reel', { cast: true });
  const reels = new THREE.InstancedMesh(reelSrc.geometry, reelSrc.material, 2);
  reels.name = 'stat:fiche:reels';
  const reelLod = lodOf(reelSrc); // [STAT fix m3 r3 code] far: low-detail reels (index.ts LOD_DIST)
  if (reelLod) setLod(reels, reelLod);
  reels.castShadow = true;
  whiteInstances(reels);
  const rm4 = new THREE.Matrix4(), rq = new THREE.Quaternion(), re = new THREE.Euler(), rv = new THREE.Vector3(), r1 = new THREE.Vector3(1, 1, 1);
  const poseReel = (i: number, x: number, a: number) => { re.set(0, 0, a); reels.setMatrixAt(i, rm4.compose(rv.set(x, 1.32, -0.08), rq.setFromEuler(re), r1)); };
  poseReel(0, -0.3, 0); poseReel(1, 0.3, 0);
  reels.computeBoundingSphere();
  root.add(reels);
  const S = createParts();
  S.box(0, 1.24, -0.08, 0.9, 0.05, 0.08, '#3A3F48', { r: 0.02 }); // reel bar
  for (const x of [-0.3, 0.3]) S.box(x, 1.2, -0.12, 0.04, 0.12, 0.04, '#3A3F48', { r: 0 });
  root.add(S.mesh('stat:fiche:bar'));
  const scr = createPanel({ w: 0.6, h: 0.38, px: 384, name: 'stat:fiche:screen' });
  scr.mesh.position.set(0, 0.96, 0.157);
  scr.mesh.rotation.x = -0.2;
  root.add(scr.mesh);
  let spin = 0, last: Stats | null = null, scan = 0;
  return {
    object3d: root,
    redraws: () => scr.redraws,
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats?.io) last = stats;
      const r = last?.io?.readBps ?? 0, w = last?.io?.writeBps ?? 0;
      const k = logRate(r + w);
      spin += dt * (0.15 + k * 14);
      poseReel(0, -0.3, spin); poseReel(1, 0.3, spin * 0.8);
      reels.instanceMatrix.needsUpdate = true;
      scan = (scan + dt * (0.2 + k * 2)) % 1;
      scr.draw(`${rate(r)}|${rate(w)}|${Math.floor(scan * 6)}`, (g, W, H) => {
        g.fillStyle = '#12201C'; g.fillRect(0, 0, W, H);
        // film frames scrolling past
        g.fillStyle = 'rgba(127,227,160,.08)';
        for (let i = -1; i < 7; i++) g.fillRect(12, ((i + scan * 6) % 7) * (H / 6) - 6, W - 24, H / 6 - 12);
        drawDots(g, 'DISK I/O', 16, 14, 3.5, '#7FE3A0');
        drawDots(g, `R ${rate(r)}`, 16, 76, 5, STATUS.working, { ghost: 0.06 });
        drawDots(g, `W ${rate(w)}`, 16, 150, 5, STATUS.shellBusy, { ghost: 0.06 });
      }, now);
      scr.tick(now);
    },
    tooltip() {
      const io = ctx.store.stats?.io;
      return {
        title: 'Disk I/O · microfiche', value: io ? `read ${rate(io.readBps)} · write ${rate(io.writeBps)}` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.io ? (x.io.readBps + x.io.writeBps) / 1024 ** 2 : null), source: '/proc/diskstats (MB/s)', color: STATUS.shellBusy,
      };
    },
    dispose() { scr.dispose(); },
  };
});

// ---- NVMe thermometer ---------------------------------------------------------------------------------------------------
registerStat('nvmeThermo', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:nvmeThermo';
  // beside the vault wheel, on the door face (door front ≈ 0.2 m proud of the wall)
  root.position.set(anchor.pos.x, 0, anchor.pos.z);
  root.rotation.y = anchor.yaw;
  const X = 0.48, Y0 = 0.62, TH = 0.9, Z = 0.07;
  const P = createParts();
  P.box(X, Y0 + TH / 2, Z, 0.2, TH + 0.2, 0.03, '#B08A4A', { r: 0.02 });
  P.cyl(X, Y0 + TH / 2 + 0.02, Z + 0.03, 0.022, 0.022, TH - 0.04, '#DDE9EC', { seg: 10 });
  P.sphere(X, Y0, Z + 0.03, 0.045, STATUS.blocked, { seg: 12, segV: 8 });
  P.sphere(X, Y0 + TH, Z + 0.03, 0.022, '#DDE9EC', { seg: 8, segV: 6 });
  for (let t = 20; t <= 90; t += 10) P.box(X + 0.05, Y0 + ((t - 20) / 70) * (TH - 0.1) + 0.05, Z + 0.02, t % 20 ? 0.025 : 0.045, 0.008, 0.01, CORE.ink, { r: 0 });
  root.add(P.mesh('stat:thermo:body'));
  const mercury = glowMesh(new THREE.CylinderGeometry(0.013, 0.013, 1, 8).translate(0, 0.5, 0), '#E0473A', 0.9);
  mercury.position.set(X, Y0, Z + 0.058); // proud of the glass tube so it always reads
  root.add(mercury);
  const plaque = createPanel({ w: 0.3, h: 0.16, px: 256, name: 'stat:thermo:plaque' });
  plaque.mesh.position.set(X, Y0 + TH + 0.2, Z + 0.02);
  root.add(plaque.mesh);
  let shown = 20, last: Stats | null = null;
  return {
    object3d: root,
    redraws: () => plaque.redraws,
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats?.temps) last = stats;
      const v = last?.temps?.nvme ?? null;
      shown += ((v ?? 20) - shown) * (1 - Math.exp(-dt * 2));
      mercury.scale.y = Math.max(0.02, ((clamp01((shown - 20) / 70)) * (TH - 0.1)) + 0.05);
      const crit = (v ?? 0) >= 70;
      plaque.draw(`${v == null ? '--' : Math.round(v)}|${crit && Math.floor(now * 2) % 2}`, (g, W, H) => {
        g.fillStyle = crit && Math.floor(now * 2) % 2 ? '#5A1E18' : '#1E1C1B'; g.fillRect(0, 0, W, H);
        drawDots(g, 'NVME', W / 2, 10, 3, '#9A9186', { align: 'center' });
        drawDots(g, v == null ? '--' : `${Math.round(v)}°C`, W / 2, 50, 11, crit ? STATUS.blocked : ENV.butter, { align: 'center' });
      }, now);
      plaque.tick(now);
    },
    tooltip() {
      const t = ctx.store.stats?.temps;
      return {
        title: 'NVMe temperature · vault thermometer', value: t ? `${temp(t.nvme)}` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.temps?.nvme), max: 90, source: 'hwmon nvme (Composite)', color: STATUS.blocked, crit: (t?.nvme ?? 0) >= 70,
      };
    },
    dispose() { plaque.dispose(); },
  };
});


/** VRAM critical: the carve-out ≥ 90 % full AND the GTT spill ≥ 75 % (a UMA APU sits near-full VRAM all day). */
export const vramCrit = (gpu: Stats['gpu'] | undefined) => !!gpu && gpu.vramTotal > 0 && gpu.vramUsed / gpu.vramTotal >= 0.9 && (!(gpu.gttTotal > 0) || gpu.gttUsed / gpu.gttTotal >= 0.75);

// ---- HI-SCORE: VRAM ----------------------------------------------------------------------------------------------------
registerStat('hiScore', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:hiScore';
  root.position.set(anchor.pos.x - 0.25, 2.12, anchor.pos.z - 0.66); // over the two cabinets, against the back wall
  root.rotation.y = anchor.yaw;
  const P = createParts();
  P.box(0, 0, -0.04, 2.3, 0.6, 0.08, '#2A2440', { r: 0.03 });
  const bulbs = ['#EF5A4C', '#F1C66E', '#7FE3A0', '#4FA3E8', '#A98BE0'];
  for (let i = 0; i < 20; i++) P.sphere(-1.08 + i * 0.1137, 0.31, 0.0, 0.018, bulbs[i % 5], { seg: 8, segV: 6 });
  const frameMesh = P.mesh('stat:hiScore:frame');
  root.add(frameMesh);
  // [STAT M3.5] the marquee + the Café's two chalk "specials" boards (boards.ts): one panel set = one draw
  const set = createPanelSet([{ w: 2.2, h: 0.52, px: 1024, pos: [0, 0, 0.002] }, ...boardSpecs(root, CAFE_BOARDS)], { name: 'stat:hiScore:panels' });
  const [panel, ...chalkPanels] = set.panels;
  root.updateMatrixWorld(true);
  const hiBox = new THREE.Box3().setFromObject(frameMesh); // aim at the marquee only (the set's box spans the Café)
  const specials = createSpecials(ctx, chalkPanels);
  // the shared panel mesh hangs under the specials object (its cull box spans the marquee AND both boards), so the
  // marquee frame stays culled on its own and seeing a board never draws anything but the one panel set
  specials.object3d.add(hostFrame(root, set.mesh));
  let last: Stats | null = null, frame = 0, ft = 0;
  return [specials, {
    object3d: root,
    hitBoxes: [hiBox],
    redraws: () => panel.redraws,
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats) last = stats;
      ft += dt; if (ft > 0.5) { ft = 0; frame ^= 1; }
      const gpu = last?.gpu;
      const f = gpu ? clamp01(gpu.vramUsed / gpu.vramTotal) : 0;
      const score = gpu ? String(Math.round(gpu.vramUsed / 1024 ** 2)).padStart(6, '0') : '------';
      const crit = vramCrit(gpu);
      panel.draw(`${score}|${frame}|${gpu ? gib(gpu.gttUsed) : ''}|${crit}`, (g, W, H) => {
        g.fillStyle = '#15122A'; g.fillRect(0, 0, W, H);
        drawPixelClawd(g, 22, 20, 7, frame);
        const hue = ['#EF5A4C', '#F1C66E', '#7FE3A0', '#4FA3E8', '#A98BE0'];
        'HI-SCORE'.split('').forEach((ch, i) => drawDots(g, ch, 142 + i * 36, 18, 5, hue[(i + frame) % 5]));
        // [STAT M3.5 §7.4 audit] critical (VRAM ≥ 90 % AND spilling: GTT ≥ 75 %) → the score turns red and pulses
        drawDots(g, `${score} MB`, W - 20, 18, 5, crit ? (frame ? STATUS.blocked : '#FF9C8F') : '#F4EDE3', { align: 'right', ghost: 0.06 });
        // VRAM bar: 32 pixel blocks
        const bx = 142, by = 84, bw = W - bx - 24, n = 32, cw = bw / n;
        for (let i = 0; i < n; i++) {
          const on = i < Math.round(f * n);
          g.fillStyle = on ? (i / n > 0.9 ? STATUS.blocked : i / n > 0.7 ? STATUS.shellBusy : '#7FE3A0') : '#2A2645';
          g.fillRect(bx + i * cw + 2, by, cw - 4, 56);
        }
        g.fillStyle = '#A99BD3'; g.font = `800 34px ${FONT_UI}`; g.textBaseline = 'alphabetic';
        g.fillText(gpu ? `VRAM ${gib(gpu.vramUsed)} / ${gib(gpu.vramTotal, 1)} GB` : 'NO GPU', bx, H - 26);
        g.textAlign = 'right';
        g.fillText(gpu ? `GTT ${gib(gpu.gttUsed)} GB` : '', W - 24, H - 26);
      }, now);
      panel.tick(now);
    },
    tooltip() {
      const gpu = ctx.store.stats?.gpu;
      return {
        title: 'VRAM · arcade HI-SCORE', value: gpu ? `${gib(gpu.vramUsed)} / ${gib(gpu.vramTotal, 1)} GB VRAM · GTT ${gib(gpu.gttUsed)} / ${gib(gpu.gttTotal, 0)} GB` : 'no GPU source',
        spark: series(ctx.store.statsHistory, (x) => x.gpu ? x.gpu.vramUsed / GiB : null), max: gpu ? gpu.vramTotal / GiB : undefined,
        source: '/sys/class/drm/card*/device/mem_info_vram_used', color: '#A99BD3', crit: vramCrit(gpu),
      };
    },
    dispose() { set.dispose(); },
  }];
});

// ---- uptime flip sign --------------------------------------------------------------------------------------------------
registerStat('uptime', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:uptime';
  // above the ENG door's side glass (openings top out at 2.6 m): the solid wall carries it
  root.position.set(anchor.pos.x - 0.3, Math.max(anchor.pos.y, 3.0), anchor.pos.z); // wall face (0.2 m thick wall on x 28)
  root.rotation.y = anchor.yaw;
  const P = createParts();
  P.box(0, 0, -0.03, 0.9, 0.62, 0.05, '#EDE6DA', { r: 0.03 });
  P.box(0, 0.2, -0.004, 0.86, 0.17, 0.01, '#3C7A4A', { r: 0.02 });
  for (const x of [-0.36, 0.36]) P.sphere(x, 0.26, 0.0, 0.015, '#8E949B', { seg: 6, segV: 4 });
  // digit card frames
  for (const x of [-0.13, 0.13]) P.box(x, -0.08, -0.004, 0.24, 0.3, 0.02, '#2A2725', { r: 0.02 });
  root.add(P.mesh('stat:uptime:board'));
  // header + footer strips: one panel draw; the two flip cards: another (they always flip together, about one axis)
  const strips = createPanelSet([{ w: 0.82, h: 0.15, px: 512, pos: [0, 0.2, 0.003] }, { w: 0.82, h: 0.08, px: 512, pos: [0, -0.265, 0.003] }], { name: 'stat:uptime:strips' });
  root.add(strips.mesh);
  const [head, foot] = strips.panels;
  head.draw('h', (g, W, H) => {
    g.fillStyle = '#3C7A4A'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#FBF8F3'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 40;
    do { g.font = `900 ${fs}px ${FONT_UI}`; fs -= 2; } while (fs > 16 && g.measureText('DAYS SINCE LAST REBOOT').width > W - 30);
    g.fillText('DAYS SINCE LAST REBOOT', W / 2, H / 2 + 2);
  }, 0);
  const cardSet = createPanelSet([-0.13, 0.13].map((x) => ({ w: 0.2, h: 0.26, px: 160, pos: [x, 0, 0] })), { name: 'stat:uptime:cards' });
  cardSet.mesh.position.set(0, -0.08, 0.01);
  root.add(cardSet.mesh);
  const cards = cardSet.panels;
  let shownDays: number | null = null, flip = 0, pending: number | null = null, last: Stats | null = null;
  const drawDigit = (p: PanelBand, ch: string, now: number) => p.draw(ch, (g, W, H) => {
    g.fillStyle = '#1E1C1B'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#FBF8F3'; g.font = `900 170px ${FONT_UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, W / 2, H / 2 + 8);
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 2, W, 4); // the flap split
  }, now);
  return {
    object3d: root,
    redraws: () => cards[0].redraws + cards[1].redraws + foot.redraws,
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats?.uptime != null) last = stats;
      const u = uptime(last?.uptime);
      const days = Math.min(99, u.days);
      if (shownDays === null && last) { shownDays = days; const s = String(days).padStart(2, '0'); drawDigit(cards[0], s[0], -9); drawDigit(cards[1], s[1], -9); }
      if (shownDays !== null && days !== shownDays && flip === 0) { pending = days; flip = 0.0001; }
      if (flip > 0) {
        flip += dt * 2.5;
        const a = flip < 0.5 ? flip * Math.PI : (1 - flip) * Math.PI; // fold to edge-on, swap, unfold
        cardSet.mesh.rotation.x = -a;
        if (flip >= 0.5 && pending !== null) { const s = String(pending).padStart(2, '0'); drawDigit(cards[0], s[0], -99); drawDigit(cards[1], s[1], -99); shownDays = pending; pending = null; }
        if (flip >= 1) { flip = 0; cardSet.mesh.rotation.x = 0; }
      }
      foot.draw(u.text, (g, W, H) => {
        g.fillStyle = '#EDE6DA'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#3A3633'; g.font = `800 30px ${FONT_UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(`up ${u.text} · ${last?.host ?? ''}`, W / 2, H / 2 + 1);
      }, now);
      foot.tick(now);
    },
    tooltip() {
      const s = ctx.store.stats;
      const u = uptime(s?.uptime);
      return { title: 'Uptime · flip sign', value: s ? `${u.days} days · up ${u.text} (${u.hhmm})` : '--', spark: series(ctx.store.statsHistory, (x) => x.uptime / 86400), source: '/proc/uptime', color: '#7FE3A0' };
    },
    dispose() { strips.dispose(); cardSet.dispose(); },
  };
});

// ---- wall clock over the entrance ------------------------------------------------------------------------------------
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
registerStat('clock', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:clock';
  root.position.set(anchor.pos.x, Math.max(anchor.pos.y, 2.93), anchor.pos.z - 0.06); // clear of the entrance lintel
  root.rotation.y = anchor.yaw;
  const RR = 0.38;
  const P = createParts();
  P.cyl(0, 0, -0.03, RR + 0.02, RR + 0.03, 0.06, ENV.walnut, { rx: Math.PI / 2, seg: 40 });
  P.torus(0, 0, 0.01, RR + 0.02, 0.035, ENV.walnut, { segT: 44, segR: 8 });
  P.cyl(0, 0, 0.035, 0.03, 0.03, 0.02, '#B08A4A', { rx: Math.PI / 2, seg: 12 });
  // date plaque backing under the clock
  P.box(RR + 0.42, 0, -0.02, 0.66, 0.22, 0.04, '#2A2725', { r: 0.02 }); // date plaque beside the clock
  root.add(P.mesh('stat:clock:body'));
  // face disc + the date plaque beside it: one panel draw (m2 r2 draw budget)
  // [STAT M3.5] + the Lab's chalk test-tally board (boards.ts; the Lab has no stats object of its own): same draw
  const bodyMesh = root.children[root.children.length - 1];
  const clockSet = createPanelSet([{ w: RR * 2, h: RR * 2, px: 512, pos: [0, 0, 0.003], circle: true }, { w: 0.6, h: 0.17, px: 512, pos: [RR + 0.42, 0, 0.002] }, ...boardSpecs(root, LAB_BOARDS)], { name: 'stat:clock:faces' });
  const [face, date, ...labPanels] = clockSet.panels;
  root.updateMatrixWorld(true);
  const clockBox = new THREE.Box3().setFromObject(bodyMesh);
  const tallies = createTallies(ctx, labPanels);
  tallies.object3d.add(hostFrame(root, clockSet.mesh)); // (see hiScore: the clock body + hands cull on their own)
  face.draw('f', (g, W, H) => {
    g.fillStyle = '#EFE6D6'; g.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = W / 2;
    g.fillStyle = CORE.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, big = i % 5 === 0;
      g.save(); g.translate(cx + Math.sin(a) * R * 0.9, cy - Math.cos(a) * R * 0.9); g.rotate(a);
      g.fillRect(big ? -5 : -2, big ? -14 : -6, big ? 10 : 4, big ? 28 : 12);
      g.restore();
    }
    g.font = `900 64px ${FONT_UI}`;
    for (let h = 1; h <= 12; h++) { const a = (h / 12) * Math.PI * 2; g.fillText(String(h), cx + Math.sin(a) * R * 0.66, cy - Math.cos(a) * R * 0.66 + 3); }
    drawPixelClawd(g, cx - 32, cy + R * 0.22, 5, 0);
  }, 0);
  // the three hands: one instanced mesh (hour, minute, second), re-posed every frame
  const hands = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.42, 0), getMaterial('toonProp', { color: '#FFFFFF', instanced: true }), 3);
  hands.name = 'stat:clock:hands';
  hands.frustumCulled = false;
  const HANDS: [number, number, string, number][] = [[RR * 0.55, 0.04, CORE.ink, 0.014], [RR * 0.82, 0.026, CORE.ink, 0.028], [RR * 0.86, 0.01, STATUS.blocked, 0.042]];
  HANDS.forEach((h, i) => hands.setColorAt(i, new THREE.Color(h[2])));
  root.add(hands);
  const hm = new THREE.Matrix4(), hq = new THREE.Quaternion(), he = new THREE.Euler(), hp = new THREE.Vector3(), hs = new THREE.Vector3();
  const setHand = (i: number, ang: number) => {
    const [len, wid, , z] = HANDS[i];
    he.set(0, 0, ang); hq.setFromEuler(he);
    hands.setMatrixAt(i, hm.compose(hp.set(0, 0, z), hq, hs.set(wid, len, 0.012)));
  };
  return [tallies, {
    object3d: root,
    hitBoxes: [clockBox],
    always: true,
    noTooltip: false,
    redraws: () => date.redraws,
    update(stats, dt, c) {
      const now = performance.now() / 1000;
      const h = c.hour ?? 12;
      const d = new Date();
      const sec = d.getSeconds() + d.getMilliseconds() / 1000;
      setHand(0, -((h % 12) / 12) * Math.PI * 2);
      setHand(1, -(h % 1) * Math.PI * 2);
      setHand(2, -((Math.floor(sec) + Math.min(1, (sec % 1) * 6)) / 60) * Math.PI * 2); // ticks with a quick sweep
      hands.instanceMatrix.needsUpdate = true;
      date.draw(`${d.getDate()}|${d.getMonth()}`, (g, W, H) => {
        g.fillStyle = '#1E1C1B'; g.fillRect(0, 0, W, H);
        const t = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
        const pt = Math.min(10, (W - 30) / (t.length * 6));
        drawDots(g, t, W / 2, (H - 7 * pt) / 2, pt, ENV.butter, { align: 'center', ghost: 0.06 });
      }, now);
      date.tick(now);
    },
    tooltip() {
      const h = ctx.hour ?? 12;
      const d = new Date();
      return { title: 'Clock', value: `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} · ${d.toDateString()}`, spark: [], source: 'local time (sun + sky follow it)', color: ENV.butter };
    },
    dispose() { clockSet.dispose(); },
  }];
});

