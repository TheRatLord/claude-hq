/**
 * RAM lava column (§7.4, GP §4): a 2.8 m glass tube of glowing clay-orange lava. Bright lava = used (`free` used =
 * total − available), a hazy butter layer above = buff/cache, tinted empty glass above that; brass rings every 4 GB;
 * blobs rise faster with allocation churn. A drip tap feeds the swap bucket (fill = swap used). The plinth plaque
 * reads `6.1 / 28 GB` + cache + swap, legible at 4 m; red pulse at ≥ 90% used. Owner: STAT.
 */
import * as THREE from 'three';
import { registerStat } from './registry.ts';
import { createPanelSet, createParts, one, canvas2d, screenMat, setIntensity, lodOf, FONT_UI } from './panel.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { drawDots } from './dotfont.ts';
import { memFigures, gib, series, GiB } from './format.ts';
import { getMaterial } from '../../render/materials/index.ts';
import type { MemFigures } from './format.ts';
import { ENV, STATUS } from '../../../../shared/palette.ts';

const TUBE_R = 0.3, Y0 = 0.62, TUBE_H = 2.72;
const SPAWN = { x: 0, z: 12.5 }; // spawn (world): plaques turn toward the lobby entrance

/** One tileable lava / haze tile (w × h) drawn at (ox, 0) of `g` (blobs wrap inside the tile). */
function lavaTile(g: CanvasRenderingContext2D, ox: number, base: [string, string], blob: string, hi: string, w: number, h: number, n: number, seed: number) {
  g.save();
  g.beginPath(); g.rect(ox, 0, w, h); g.clip();
  g.translate(ox, 0);
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, base[0]); grd.addColorStop(0.5, base[1]); grd.addColorStop(1, base[0]);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, rx = 10 + rnd() * 18, ry = rx * (1.1 + rnd() * 0.6);
    for (const dy of [-h, 0, h]) for (const dx of [-w, 0, w]) {
      const r = g.createRadialGradient(x + dx, y + dy - ry * 0.3, 1, x + dx, y + dy, ry);
      r.addColorStop(0, hi); r.addColorStop(0.55, blob); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.beginPath(); g.ellipse(x + dx, y + dy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

/**
 * [STAT m2 r2 draw budget] The whole liquid column in ONE draw: used lava, buff/cache haze, the empty tube, the
 * meniscus, the swap bucket's water and the drip share one unlit mesh whose vertices are re-written each frame (≈ 450
 * verts). Its 512×256 map holds the lava tile (×2, u 0–248), the haze tile (×2, u 248–496; pre-dimmed to its old 0.72
 * gain) and 4 px swatches (meniscus, empty glass, water, drip); v tiles (RepeatWrapping), so the blobs scroll by UV.
 */
const ATLAS_W = 512, ATLAS_H = 256, SEG = 32;
const SW = { top: 498, empty: 502, water: 506, drop: 510 }; // swatch centres (px)
function liquidAtlas() {
  const c = document.createElement('canvas');
  c.width = ATLAS_W; c.height = ATLAS_H;
  const g = canvas2d(c);
  for (const ox of [0, 124]) lavaTile(g, ox, ['#C4481F', '#E2632C'], 'rgba(255,150,80,.95)', '#FFD08A', 124, ATLAS_H, 9, 7);
  for (const ox of [248, 372]) lavaTile(g, ox, ['#C9A35C', '#E4C27A'], 'rgba(255,238,190,.8)', '#FFF6DA', 124, ATLAS_H, 14, 3);
  g.fillStyle = 'rgba(0,0,0,0.24)'; g.fillRect(248, 0, 248, ATLAS_H); // haze at 0.72 / 0.95 of the lava gain
  const sw = (x: number, col: string) => { g.fillStyle = col; g.fillRect(x - 2, 0, 4, ATLAS_H); };
  sw(SW.top, '#FFB36B'); sw(SW.empty, '#3A4C53'); sw(SW.water, '#6A98B4'); sw(SW.drop, '#8FBBD6');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = false; // 4 px swatches: no mip bleeding
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
}

registerStat('ramColumn', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:ramColumn';
  root.position.set(anchor.pos.x, anchor.pos.y, anchor.pos.z);
  const face = Math.atan2(SPAWN.x - anchor.pos.x, SPAWN.z - anchor.pos.z);
  root.rotation.y = face; // local +z toward spawn (plaque, tap on the left)
  // ---- static clay parts: plinth, brass collars, cap, tap, bucket stand
  const P = createParts();
  P.box(0, 0.3, 0, 0.92, 0.6, 0.92, '#3A3633', { r: 0.06 });
  P.box(0, 0.615, 0, 0.8, 0.05, 0.8, ENV.walnut, { r: 0.02 });
  P.cyl(0, Y0 + 0.03, 0, TUBE_R + 0.06, TUBE_R + 0.07, 0.1, '#B08A4A', { seg: 28 });
  P.cyl(0, Y0 + TUBE_H - 0.02, 0, TUBE_R + 0.06, TUBE_R + 0.06, 0.1, '#B08A4A', { seg: 28 });
  P.cyl(0, Y0 + TUBE_H + 0.16, 0, TUBE_R + 0.02, TUBE_R + 0.08, 0.26, '#3A3633', { seg: 28 });
  P.sphere(0, Y0 + TUBE_H + 0.3, 0, 0.12, '#B08A4A', { seg: 14, segV: 8 });
  // drip tap on the side (local −x of the face frame) + bucket on the floor
  const side = new THREE.Vector3(-1, 0, 0); // local left
  const tapX = side.x * (TUBE_R + 0.12), tapZ = side.z * (TUBE_R + 0.12);
  P.cyl(tapX * 0.8, Y0 + 0.28, tapZ * 0.8, 0.03, 0.03, 0.22, '#B08A4A', { rz: Math.PI / 2, seg: 8 });
  P.cyl(tapX * 1.25, Y0 + 0.22, tapZ * 1.25, 0.028, 0.02, 0.12, '#B08A4A', { seg: 8 });
  P.sphere(tapX * 1.1, Y0 + 0.36, tapZ * 1.1, 0.05, STATUS.blocked, { seg: 10, segV: 6 }); // tap handle
  const bx = tapX * 1.25, bz = tapZ * 1.25;
  P.cyl(bx, 0.14, bz, 0.17, 0.13, 0.28, '#8E9AA0', { seg: 20, open: true });
  P.cyl(bx, 0.01, bz, 0.13, 0.13, 0.02, '#6E787D', { seg: 20 });
  P.torus(bx, 0.28, bz, 0.17, 0.012, '#6E787D', { rx: Math.PI / 2, segT: 24 });
  const partsMesh = P.mesh('stat:ram:parts', { cast: true });
  root.add(partsMesh);

  // ---- liquid (one draw, see liquidAtlas) + the glass sleeve (transparent, fresnel + interior reflection streak)
  const bx0 = -(TUBE_R + 0.12) * 1.25, bz0 = 0; // bucket centre (tap on the local left)
  const liqTex = liquidAtlas();
  const liqMat = screenMat({ color: '#FFFFFF', emissive: 0.95, strip: null, instanced: true, uniforms: {} });
  liqMat.map = liqTex;
  // vertex layout: 3 open bands × (SEG+1)×2, meniscus fan, water fan, drip (a small octahedron)
  const BAND = (SEG + 1) * 2, FAN = SEG + 2, DROP = 6;
  const NV = BAND * 3 + FAN * 2 + DROP;
  const pos = new Float32Array(NV * 3), uvs = new Float32Array(NV * 2), nrm = new Float32Array(NV * 3);
  const idx: number[] = [];
  for (let b = 0; b < 3; b++) {
    const o = b * BAND;
    for (let i = 0; i < SEG; i++) { const a0 = o + i * 2; idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
  }
  const fan = (o: number) => { for (let i = 0; i < SEG; i++) idx.push(o, o + 1 + i, o + 2 + i); };
  const oTop = BAND * 3, oWater = oTop + FAN, oDrop = oWater + FAN;
  fan(oTop); fan(oWater);
  for (const [a0, b0, c0] of [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]) idx.push(oDrop + a0, oDrop + c0, oDrop + b0);
  // static parts: band x/z + u, fan x/z, normals
  for (let b = 0; b < 3; b++) for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2, x = Math.sin(a) * TUBE_R, z = Math.cos(a) * TUBE_R;
    const u = b === 2 ? SW.empty / ATLAS_W : ((b ? 248 : 0) + (i / SEG) * 248) / ATLAS_W;
    for (let k = 0; k < 2; k++) { const v = b * BAND + i * 2 + k; pos[v * 3] = x; pos[v * 3 + 2] = z; nrm[v * 3] = x / TUBE_R; nrm[v * 3 + 2] = z / TUBE_R; uvs[v * 2] = u; }
  }
  const fanXZ = (o: number, r: number, cx: number, cz: number, u: number) => {
    pos[o * 3] = cx; pos[o * 3 + 2] = cz; uvs[o * 2] = u; nrm[o * 3 + 1] = 1;
    for (let i = 0; i <= SEG; i++) { const a = (i / SEG) * Math.PI * 2, v = o + 1 + i; pos[v * 3] = cx + Math.sin(a) * r; pos[v * 3 + 2] = cz + Math.cos(a) * r; uvs[v * 2] = u; uvs[v * 2 + 1] = 0.5; nrm[v * 3 + 1] = 1; }
  };
  fanXZ(oTop, TUBE_R * 0.98, 0, 0, SW.top / ATLAS_W);
  fanXZ(oWater, 0.15, bx0, bz0, SW.water / ATLAS_W);
  for (let k = 0; k < DROP; k++) { uvs[(oDrop + k) * 2] = SW.drop / ATLAS_W; uvs[(oDrop + k) * 2 + 1] = 0.5; }
  const liqGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage);
  liqGeo.setAttribute('position', posAttr);
  liqGeo.setAttribute('uv', uvAttr);
  liqGeo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  liqGeo.setIndex(idx);
  const bounds = new THREE.Sphere(new THREE.Vector3(-0.2, Y0 + TUBE_H / 2, 0), TUBE_H / 2 + 0.6);
  liqGeo.boundingSphere = bounds;
  const liquid = one(liqGeo, liqMat);
  liquid.name = 'stat:ram:liquid';
  liquid.computeBoundingSphere = () => { liquid.boundingSphere = bounds.clone(); };
  liquid.computeBoundingSphere();
  root.add(liquid);
  /** band b spans world-local y [y0, y1]; v = (y − y0 + phase)/0.9 tiles (one tile = 0.9 m of liquid) */
  const setBand = (b: number, y0: number, y1: number, v0: number, v1: number) => {
    for (let i = 0; i <= SEG; i++) {
      const v = b * BAND + i * 2;
      pos[v * 3 + 1] = y0; pos[(v + 1) * 3 + 1] = y1;
      uvs[v * 2 + 1] = v0; uvs[(v + 1) * 2 + 1] = v1;
    }
  };
  const setFanY = (o: number, y: number) => { for (let i = 0; i < FAN; i++) pos[(o + i) * 3 + 1] = y; };
  const setDrop = (on: boolean, y: number) => {
    const r = on ? 0.025 : 0;
    const P6: [number, number, number][] = [[r, 0, 0], [-r, 0, 0], [0, 0, r], [0, 0, -r], [0, r * 1.3, 0], [0, -r, 0]];
    for (let k = 0; k < DROP; k++) { const v = oDrop + k; pos[v * 3] = bx0 + P6[k][0]; pos[v * 3 + 1] = y + P6[k][1]; pos[v * 3 + 2] = bz0 + P6[k][2]; }
  };
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R + 0.025, TUBE_R + 0.025, TUBE_H, 32, 1, true), getMaterial('glass', { color: '#CFE6EA', reflect: 'interior' }));
  glass.position.y = Y0 + TUBE_H / 2;
  root.add(glass);
  let ringsBuilt = false;

  // ---- plaque on the plinth + the "RAM" label strip on the cap (a frustum: it leans back with it), facing spawn: one draw
  const plates = createPanelSet([
    { w: 0.78, h: 0.44, px: 512, pos: [0, 0.3, 0.465] },
    { w: 0.5, h: 0.14, px: 256, pos: [0, Y0 + TUBE_H + 0.16, TUBE_R + 0.057], rot: [-0.29, 0, 0] },
  ], { name: 'stat:ram:plates' });
  root.add(plates.mesh);
  const [plaque, cap] = plates.panels;
  cap.draw('x', (g, W, H) => { g.fillStyle = '#2A2725'; g.fillRect(0, 0, W, H); drawDots(g, 'RAM', W / 2, (H - 42) / 2, 6, ENV.butter, { align: 'center' }); }, 0);

  let fUsed = 0, fCache = 0, fSwap = 0, churn = 0, prevUsed: number | null = null, scroll = 0, t = 0, dropT = 0;
  let m: MemFigures | null = null;
  return {
    object3d: root,
    redraws: () => plaque.redraws,
    update(stats, dt, c) {
      const now = performance.now() / 1000;
      if (stats?.mem) {
        m = memFigures(stats.mem);
        if (prevUsed != null && stats.mem.used !== prevUsed) churn = Math.min(1, churn + Math.abs(stats.mem.used - prevUsed) / (256 * 1024 ** 2));
        prevUsed = stats.mem.used;
        if (!ringsBuilt && m.total > 0) {
          ringsBuilt = true;
          const R = createParts();
          for (let gb = 4; gb * GiB < m.total; gb += 4) R.torus(0, Y0 + TUBE_H * (gb * GiB) / m.total, 0, TUBE_R + 0.03, 0.009, gb % 8 ? '#B08A4A' : '#E0C07A', { rx: Math.PI / 2, segT: 36, segR: 5 });
          // brass rings every 4 GB: merged into the static clay mesh (no extra draw)
          const rm = R.mesh('stat:ram:rings');
          // [STAT fix m3 r3 code] merge into both LOD levels (panel.ts createParts `userData.lod`); keep the current level
          const L = lodOf(partsMesh), R2 = lodOf(rm);
          if (L && R2) {
            const wasLo = partsMesh.geometry === L.lo;
            const g2 = mergeGeometries([L.hi, R2.hi], false), l2 = mergeGeometries([L.lo, R2.lo], false);
            if (g2 && l2) {
              L.hi.dispose(); L.lo.dispose();
              L.hi = g2; L.lo = l2; g2.computeBoundingSphere(); l2.computeBoundingSphere();
              partsMesh.geometry = wasLo ? l2 : g2; partsMesh.computeBoundingSphere?.();
            }
            R2.hi.dispose(); R2.lo.dispose();
          }
        }
      }
      if (!m) return;
      const fig = m; // (the draw callback below runs later: keep the narrowed value)
      const k = 1 - Math.exp(-dt * 2.5);
      fUsed += (m.usedF - fUsed) * k;
      fCache += (m.cacheF - fCache) * k;
      fSwap += (m.swapF - fSwap) * k;
      churn *= Math.exp(-dt * 0.3);
      const hu = Math.max(0.001, fUsed * TUBE_H), hc = Math.max(0.001, (fCache - fUsed) * TUBE_H);
      const hTop = Y0 + hu, hHaze = hTop + hc;
      // blobs rise: faster with churn; one tile = 0.9 m of liquid, so blob size stays constant as the fill changes
      t += dt;
      scroll += dt * (0.06 + churn * 0.5);
      const sl = -scroll, sh = -scroll * 0.35;
      setBand(0, Y0, hTop, sl, sl + hu / 0.9);
      setBand(1, hTop, hHaze, sh, sh + hc / 0.9);
      setBand(2, hHaze, Y0 + TUBE_H, 0.5, 0.5);
      setFanY(oTop, hTop + 0.002);
      // swap bucket + a drip every ~2.5 s while swap is in use
      const wy = 0.03 + fSwap * 0.24, swap = fSwap > 0.002;
      setFanY(oWater, swap ? wy : -0.05); // under the bucket floor when dry
      dropT += dt;
      const ph = (dropT % 2.5) / 0.45;
      setDrop(swap && ph < 1, Y0 + 0.16 - ph * ph * (Y0 + 0.16 - wy));
      posAttr.needsUpdate = true; uvAttr.needsUpdate = true;
      // critical pulse ≥ 90% used
      const crit = m.usedF >= 0.9;
      setIntensity(liqMat, crit ? 0.8 + 0.15 * Math.sin(now * 6) : 0.95);
      plaque.draw(`${m.label}|${gib(m.cache)}|${gib(stats?.mem?.swapUsed ?? 0)}|${crit && Math.floor(now * 2) % 2}`, (g, W, H) => {
        g.fillStyle = '#1E1C1B'; g.fillRect(0, 0, W, H);
        g.fillStyle = crit && Math.floor(now * 2) % 2 ? STATUS.blocked : '#2C2926';
        g.fillRect(0, 0, W, 54);
        drawDots(g, 'MEMORY', 22, 13, 4, ENV.butter);
        drawDots(g, `${Math.round(fig.usedF * 100)}%`, W - 22, 13, 4, ENV.butter, { align: 'right' });
        const big = `${gib(fig.used)}/${gib(fig.total, 0)}GB`;
        drawDots(g, big, W / 2, 76, big.length > 11 ? 6.4 : 7.2, crit ? STATUS.blocked : '#FFB36B', { align: 'center', ghost: 0.06 });
        g.fillStyle = '#E4C27A'; g.font = `800 30px ${FONT_UI}`; g.textBaseline = 'alphabetic';
        g.fillText(`+${gib(fig.cache)} GB cache`, 22, H - 22);
        g.fillStyle = '#9FD0F0'; g.textAlign = 'right';
        const sw = stats?.mem?.swapTotal ? `swap ${gib(stats.mem.swapUsed)} GB` : 'no swap';
        g.fillText(sw, W - 22, H - 22);
      }, now);
      plaque.tick(now);
    },
    tooltip() {
      const mem = ctx.store.stats?.mem;
      const mm = mem ? memFigures(mem) : null;
      return {
        title: 'RAM · lava column', value: mm && mem ? `${mm.label} used · +${gib(mem.cache)} cache · swap ${gib(mem.swapUsed)}/${gib(mem.swapTotal, 0)} GB` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.mem ? x.mem.used / GiB : null), max: mm ? mm.total / GiB : undefined,
        source: '/proc/meminfo (MemTotal − MemAvailable)', color: '#FFB36B', crit: !!mm && mm.usedF >= 0.9,
      };
    },
    dispose() { plates.dispose(); liqTex.dispose(); liqGeo.dispose(); },
  };
});

