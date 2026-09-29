/**
 * Atrium ceiling fans ∝ load (§7.4 "CPU total, load") and the macro-stress weather (§7.4, M3):
 * - **heat**: CPU temp or load ≥ 80% for 30 s → a warm shimmering haze outside every exterior window (so the skyline
 *   cards wobble) and a faint warm veil under the skylight;
 * - **fog**: swap in use > 25% → the skylight fogs from its edges;
 * both ease in/out over 20 s (`weatherStep`, pure). The state is published on the bus as 'stats.weather'
 * {heat, fog} (≤ 2 Hz) so ENV / RND may tint the sky too. Owner: STAT.
 */
import * as THREE from 'three';
import { registerStat } from './registry.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createParts, whiteInstances, overlayMesh, canvas2d, lodOf, setLod } from './panel.ts';
import type { Stats } from '../../../../shared/protocol.ts';
import { series, weatherStep } from './format.ts';
import { getMaterial } from '../../render/materials/index.ts';
import { ENV } from '../../../../shared/palette.ts';
import { U } from '../../render/uniforms.ts'; // [RND fix r1] night-dim the skylight fog (cross-owner, minimal)

// ---- ceiling fans -----------------------------------------------------------------------------------------------------
registerStat('fans', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:fans';
  const L = ctx.layout;
  const ceil = anchor.pos.y + 0.2;
  const [sx0, sz0, sx1, sz1] = L.skylight?.rect ?? [anchor.pos.x - 3, anchor.pos.z - 3, anchor.pos.x + 3, anchor.pos.z + 3];
  // four fans around the skylight, over the atrium floor (never over the Board, the stairs or the mezzanine)
  const spots = [[sx0 - 2.2, sz0 + 1.0], [sx1 + 2.2, sz0 + 1.0], [sx0 - 2.2, sz1 - 0.6], [sx1 + 2.2, sz1 - 0.6]];
  const drop = 0.55;
  const P = createParts();
  for (const [x, z] of spots) {
    P.cyl(x, ceil - 0.04, z, 0.12, 0.12, 0.05, '#3A3633', { seg: 14 });
    P.cyl(x, ceil - drop / 2, z, 0.02, 0.02, drop, '#3A3633', { seg: 6 });
    P.cyl(x, ceil - drop - 0.06, z, 0.13, 0.16, 0.14, ENV.walnut, { seg: 18 });
    P.sphere(x, ceil - drop - 0.15, z, 0.09, '#FFE3B0', { seg: 12, segV: 8 });
    P.cyl(x + 0.05, ceil - drop - 0.3, z, 0.004, 0.004, 0.22, '#B08A4A', { seg: 4 }); // pull chain
    P.sphere(x + 0.05, ceil - drop - 0.42, z, 0.018, '#B08A4A', { seg: 6, segV: 4 });
  }
  root.add(P.mesh('stat:fans:bodies'));
  const B = createParts();
  for (let k = 0; k < 5; k++) {
    const a = (k * Math.PI * 2) / 5;
    B.box(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5, 0.72, 0.018, 0.17, ENV.oak, { ry: -a, rx: 0.14, r: 0.008 });
  }
  const bladeTmp = B.mesh('tmp');
  const blades = new THREE.InstancedMesh(bladeTmp.geometry, getMaterial('toonProp', { color: '#FFFFFF', instanced: true, vertexColors: true }), spots.length);
  blades.name = 'stat:fans:blades';
  const bladeLod = lodOf(bladeTmp); // [STAT fix m3 r3 code] plain-box blades far away (index.ts LOD_DIST)
  if (bladeLod) setLod(blades, bladeLod);
  whiteInstances(blades);
  root.add(blades);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  let spin = 0, speed = 0, last: Stats | null = null;
  const cores = () => last?.cpu?.cores?.length || 16;
  // aim volumes: one small box per fan (the group's bounding box would span the whole atrium ceiling)
  const hitBoxes = spots.map(([x, z]) => new THREE.Box3(new THREE.Vector3(x - 0.9, ceil - drop - 0.5, z - 0.9), new THREE.Vector3(x + 0.9, ceil, z + 0.9)));
  return {
    object3d: root,
    hitBoxes,
    update(stats, dt) {
      if (stats?.cpu) last = stats;
      const load = last?.cpu?.load?.[0] ?? 0;
      const want = 0.3 + Math.min(1.5, load / cores()) * 9; // rad/s: a lazy turn at idle, a whirr under full load
      speed += (want - speed) * (1 - Math.exp(-dt * 0.8));
      spin += speed * dt;
      spots.forEach(([x, z], i) => {
        e.set(0, spin + i * 0.7, 0); q.setFromEuler(e);
        m4.compose(p.set(x, ceil - drop - 0.12, z), q, s);
        blades.setMatrixAt(i, m4);
      });
      blades.instanceMatrix.needsUpdate = true;
    },
    tooltip() {
      const c = ctx.store.stats?.cpu;
      return {
        title: 'Load average · ceiling fans', value: c ? `${c.load.map((x) => x.toFixed(2)).join(' / ')} (1/5/15 min, ${c.cores.length} threads)` : '--',
        spark: series(ctx.store.statsHistory, (x) => x.cpu?.load?.[0]), source: '/proc/loadavg', color: ENV.oak,
      };
    },
  };
});

// ---- macro-stress weather -------------------------------------------------------------------------------------------
function fogTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = canvas2d(c);
  // fog creeps in from the frame edges: alpha high at the border, clear centre, soft blotches
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const ex = Math.min(x, 255 - x) / 128, ey = Math.min(y, 255 - y) / 128;
    const edge = Math.min(ex, ey);
    const n = 0.5 + 0.25 * Math.sin(x * 0.11 + Math.sin(y * 0.07) * 3) + 0.25 * Math.sin(y * 0.09 + Math.cos(x * 0.05) * 2);
    const a = Math.max(0, Math.min(1, (0.55 - edge) * 2.2 + (n - 0.5) * 0.5));
    const i = (y * 256 + x) * 4;
    img.data[i] = 236; img.data[i + 1] = 240; img.data[i + 2] = 242; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hazeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = canvas2d(c);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,214,170,0.15)'); grd.addColorStop(0.6, 'rgba(255,196,140,0.55)'); grd.addColorStop(1, 'rgba(255,186,130,0.75)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,240,220,0.35)'; g.lineWidth = 3;
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    for (let x = 0; x <= 128; x += 4) { const y = 10 + k * 20 + Math.sin((x / 128) * Math.PI * 4 + k) * 5; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

registerStat('skylight', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:weather';
  const L = ctx.layout;
  const [sx0, sz0, sx1, sz1] = L.skylight?.rect ?? [anchor.pos.x - 3, anchor.pos.z - 3, anchor.pos.x + 3, anchor.pos.z + 3];
  const y = (L.skylight?.y ?? anchor.pos.y) - 0.02;
  // skylight fog (edges in) + heat veil, both overlays under the glass
  const fogTex = fogTexture();
  const fog = overlayMesh(new THREE.PlaneGeometry(sx1 - sx0, sz1 - sz0).rotateX(Math.PI / 2), '#FFFFFF', 0.85);
  const fogMat = fog.material;
  fogMat.map = fogTex; fogMat.opacity = 0;
  fog.position.set((sx0 + sx1) / 2, y, (sz0 + sz1) / 2);
  fog.visible = false;
  root.add(fog);
  // heat haze sheets 0.5 m outside every exterior window (one merged mesh, one draw)
  const b = L.bounds;
  const geos: THREE.BufferGeometry[] = [];
  const onB = (v: number, lim: number) => Math.abs(v - lim) < 0.05;
  for (const w of L.walls ?? []) {
    const [ax, az] = w.a, [bx, bz] = w.b;
    const ext = (onB(ax, b.minX) && onB(bx, b.minX)) || (onB(ax, b.maxX) && onB(bx, b.maxX)) || (onB(az, b.minZ) && onB(bz, b.minZ)) || (onB(az, b.maxZ) && onB(bz, b.maxZ));
    if (!ext) continue;
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    // outward normal
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    let nx = -uz, nz = ux;
    if ((ax - cx) * nx + (az - cz) * nz < 0) { nx = -nx; nz = -nz; }
    for (const o of w.openings ?? []) {
      if (!/window|entrance|glass/i.test(o.kind)) continue;
      const mid = o.at + o.w / 2;
      const px = ax + ux * mid + nx * 0.5, pz = az + uz * mid + nz * 0.5;
      const g = new THREE.PlaneGeometry(o.w + 0.6, o.h + 0.6);
      g.rotateY(Math.atan2(-nx, -nz)); // faces inward (toward the viewer inside)
      g.translate(px, (w.y0 ?? 0) + o.sill + o.h / 2, pz);
      geos.push(g);
    }
  }
  let haze: { mesh: ReturnType<typeof overlayMesh>; tex: THREE.CanvasTexture } | null = null;
  if (geos.length) {
    const tex = hazeTexture();
    const mesh = overlayMesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), '#FFFFFF', 0.9);
    mesh.material.map = tex; mesh.material.opacity = 0;
    mesh.visible = false;
    root.add(mesh);
    haze = { mesh, tex };
  }
  const W = { heatFor: 0, heat: 0, fog: 0 };
  // review / debug: `?weather=heat|fog|both` pins the macro-stress state (shots can't wait 30 s + 20 s)
  const force = (() => { try { return new URLSearchParams(location.search).get('weather'); } catch { return null; } })();
  let pubT = 0, t = 0, last: Stats | null = null;
  return {
    object3d: root,
    always: true,
    noTooltip: true,
    update(stats, dt) {
      if (stats) last = stats;
      const rdt = dt || 0;
      weatherStep(W, last, rdt, last?.cpu?.cores?.length || 16);
      if (force) { W.heat = /heat|both/.test(force) ? 1 : 0; W.fog = /fog|both/.test(force) ? 1 : 0; }
      t += rdt;
      // [RND m2 fix r1, cross-owner minimal] the fog hangs *under* the roof glass: only drawn when the camera is below
      // it (the plan / overhead poses saw an unlit white square with the fog swirl, plan.png), and a frost value within
      // the §5.0 env cap (≈ L* 85, unlit 1.0 × 0.85 read as a blown-out white slab), night-blue haze after dark
      fog.visible = W.fog > 0.01 && (ctx.camera?.position?.y ?? 0) < y - 0.1;
      fogMat.opacity = W.fog * 0.8;
      const nw = U.uNight.value;
      fogMat.color?.setRGB(0.66 - 0.46 * nw, 0.69 - 0.47 * nw, 0.72 - 0.42 * nw);
      if (haze) {
        haze.mesh.visible = W.heat > 0.01;
        haze.mesh.material.opacity = W.heat * 0.5;
        haze.tex.offset.y = -t * 0.08;
        haze.tex.offset.x = Math.sin(t * 0.9) * 0.02;
      }
      pubT += rdt;
      if (pubT > 0.5) { pubT = 0; ctx.bus?.emit?.('stats.weather', { heat: W.heat, fog: W.fog }); }
    },
    tooltip() { return { title: 'Weather', value: `heat ${W.heat.toFixed(2)} · fog ${W.fog.toFixed(2)}`, spark: [], source: 'cpu temp/load · swap' }; },
    debug: () => ({ ...W }),
  };
});
