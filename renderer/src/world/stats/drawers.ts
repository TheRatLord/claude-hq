/**
 * Disk space as a card-catalogue drawer wall (§7.4 Disk, GP §4): one oak bank per mount along the Archive north wall
 * (the biggest mount gets most of the wall). Drawers fill from the bottom-left: a used drawer is pulled open with
 * paper sticking out, the boundary drawer only part-way; > 90% → paper piles on the floor and the plaque pulses red.
 * Each bank has a dot-matrix plaque `/ 195 / 1874 GB` above it. Values from statfs (every 30 s, §4.10).
 * Owner: STAT.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { registerStat } from './registry.ts';
import { createPanelSet, createParts, whiteInstances, setLod } from './panel.ts';
import type { PanelBand, PanelQuad, PanelSet } from './panel.ts';
import type { Stats } from '../../../../shared/protocol.ts';
import { drawDots } from './dotfont.ts';
import { diskFigures, series, GiB, clamp01 } from './format.ts';
import { getMaterial } from '../../render/materials/index.ts';
import { ENV, STATUS } from '../../../../shared/palette.ts';

const WALL_W = 7.6, ROWS = 5, DH = 0.36, BASE_Y = 0.12;

/** One drawer: oak front + brass pull + paper label card, vertex-coloured, front at +z. */
function drawerGeometry(w: number, h: number, lo = false) {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string) => {
    const q = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
    const c = new THREE.Color(color), n = q.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    q.setAttribute('color', new THREE.BufferAttribute(a, 3));
    parts.push(q);
  };
  // [STAT fix m3 r3 code] lo: plain boxes (36 tris vs 420 a drawer; 60 drawers = 25k tris at full detail)
  add((lo ? new THREE.BoxGeometry(w - 0.04, h - 0.04, 0.4) : new RoundedBoxGeometry(w - 0.04, h - 0.04, 0.4, 2, 0.02)).translate(0, 0, -0.17), '#FFFFFF'); // instance colour tints it
  add((lo ? new THREE.BoxGeometry(0.16, 0.04, 0.04) : new RoundedBoxGeometry(0.16, 0.04, 0.04, 1, 0.012)).translate(0, -h * 0.12, 0.045), '#E0C07A');
  add(new THREE.BoxGeometry(w * 0.36, h * 0.24, 0.01).translate(0, h * 0.18, 0.035), '#F0E8DA');
  return mergeGeometries(parts, false);
}

type DiskFig = ReturnType<typeof diskFigures>[number];

/** One mount's cabinet bank: its share of the wall, the filled fraction (`f` target, `shown` eased) and its plaque band. */
interface Bank {
  mount: string; x0: number; w: number; cols: number; n: number; f: number; shown: number; tint: string;
  plaque: PanelBand;
  /** index of the bank's first drawer instance */
  start: number;
  laid?: boolean;
}
/** Everything `build` makes once the first disk figures arrive. */
interface Built { drawers: THREE.InstancedMesh; papers: THREE.InstancedMesh; piles: THREE.InstancedMesh; plaqueSet: PanelSet }

registerStat('drawers', (ctx, anchor) => {
  const root = new THREE.Group();
  root.name = 'stat:drawers';
  root.position.set(anchor.pos.x, 0, anchor.pos.z + 0.05); // just proud of the greybox drawer block
  root.rotation.y = anchor.yaw;
  let built: Built | null = null;
  let banks: Bank[] = [];
  const drawerMats = getMaterial('toonProp', { color: '#FFFFFF', instanced: true, vertexColors: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();

  const build = (figs: DiskFig[]): Built => {
    // columns per mount: ~proportional to log size, the root mount at least half the wall; ≤ 4 banks
    const list = figs.slice(0, 4);
    const weights = list.map((_d, i) => (i === 0 ? 3 : 1));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const COLS = 12;
    let c0 = 0;
    const colW = WALL_W / COLS;
    const P = createParts();
    const specs: PanelQuad[] = [];
    const drafts = list.map((d, i) => {
      const cols = i === list.length - 1 ? COLS - c0 : Math.max(2, Math.round((COLS * weights[i]) / totalW));
      const x0 = -WALL_W / 2 + c0 * colW, w = cols * colW;
      c0 += cols;
      // carcass: walnut cabinet with an oak top and a brass label rail
      P.box(x0 + w / 2, BASE_Y + (ROWS * DH) / 2, -0.25, w - 0.04, ROWS * DH + 0.08, 0.5, ENV.walnut, { r: 0.03 });
      P.box(x0 + w / 2, BASE_Y + ROWS * DH + 0.06, -0.23, w + 0.02, 0.06, 0.56, ENV.oak, { r: 0.02 });
      P.box(x0 + w / 2, BASE_Y / 2, -0.23, w - 0.08, BASE_Y, 0.46, '#4A3526', { r: 0.02 });
      const pw = Math.min(w - 0.14, 2.4);
      specs.push({ w: pw, h: 0.3, px: Math.round(128 * pw / 0.3), py: 128, pos: [x0 + w / 2, BASE_Y + ROWS * DH + 0.32, -0.08] });
      P.box(x0 + w / 2, BASE_Y + ROWS * DH + 0.32, -0.12, Math.min(w - 0.14, 2.4) + 0.08, 0.38, 0.06, '#2A2725', { r: 0.02 });
      return { mount: d.mount, x0, w, cols, n: cols * ROWS, f: 0, shown: 0, tint: ['#C79A6B', '#B48A5E', '#A9825C', '#C4A276'][i] };
    });
    root.add(P.mesh('stat:drawers:carcass', { cast: true }));
    // every bank's plaque in one panel draw (m2 r2 draw budget)
    const plaqueSet = createPanelSet(specs, { name: 'stat:drawers:plaques' });
    root.add(plaqueSet.mesh);
    banks = drafts.map((b, i) => ({ ...b, plaque: plaqueSet.panels[i], start: 0 }));
    const total = banks.reduce((a, b) => a + b.n, 0);
    const hiGeo = drawerGeometry(colW, DH);
    const drawers = new THREE.InstancedMesh(hiGeo, drawerMats, total);
    drawers.name = 'stat:drawers:fronts';
    setLod(drawers, { hi: hiGeo, lo: drawerGeometry(colW, DH, true) }); // far: index.ts LOD_DIST
    const papers = new THREE.InstancedMesh(new THREE.BoxGeometry(colW * 0.7, 0.012, 0.3), getMaterial('toonProp', { color: '#F4EEE2', instanced: true }), total);
    papers.name = 'stat:drawers:paper';
    const piles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.02, 0.22), getMaterial('toonProp', { color: '#F4EEE2', instanced: true }), 14);
    piles.name = 'stat:drawers:piles';
    whiteInstances(papers); whiteInstances(piles);
    piles.count = 0;
    piles.visible = false; // count 0 still costs a draw
    let k = 0;
    for (const b of banks) {
      b.start = k;
      for (let i = 0; i < b.n; i++, k++) drawers.setColorAt(k, col.set(b.tint).offsetHSL(0, 0, ((i * 37) % 7 - 3) * 0.008));
    }
    root.add(drawers, papers, piles);
    return { drawers, papers, piles, plaqueSet };
  };

  const layoutBank = (b: Bank, { drawers, papers }: Built) => {
    const colW = WALL_W / 12;
    const usedDrawers = b.shown * b.n;
    for (let i = 0; i < b.n; i++) {
      const c = Math.floor(i / ROWS), r = i % ROWS; // fill bottom-up, column by column
      const x = b.x0 + (c + 0.5) * colW, y = BASE_Y + (r + 0.5) * DH;
      const open = clamp01(usedDrawers - i); // 1 = fully used, fraction for the boundary drawer
      const pull = open > 0 ? 0.06 + 0.16 * open : 0;
      e.set(0, 0, 0); q.setFromEuler(e);
      m4.compose(p.set(x, y, pull), q, s);
      drawers.setMatrixAt(b.start + i, m4);
      // paper fans out of open drawers (a slightly tilted sheet stack)
      if (open > 0) {
        e.set(-0.25 - 0.1 * ((i * 13) % 3), ((i * 7) % 5 - 2) * 0.04, 0); q.setFromEuler(e);
        m4.compose(p.set(x, y + DH * 0.3, pull - 0.12), q, s.set(1, 1 + open * 3, 1));
        s.set(1, 1, 1);
      } else m4.makeScale(0, 0, 0);
      papers.setMatrixAt(b.start + i, m4);
    }
  };

  let last: Stats | null = null;
  return {
    object3d: root,
    redraws: () => banks.reduce((n, b) => n + b.plaque.redraws, 0),
    update(stats, dt) {
      const now = performance.now() / 1000;
      if (stats?.disks?.length) last = stats;
      if (!last) return;
      const figs = diskFigures(last.disks);
      if (!built && figs.length) built = build(figs);
      if (!built) return;
      const { drawers, papers, piles } = built;
      let dirty = false, pileN = 0;
      for (const b of banks) {
        const d = figs.find((x) => x.mount === b.mount);
        if (!d) continue;
        b.f = d.f;
        const next = b.shown + (b.f - b.shown) * (1 - Math.exp(-dt * 1.5));
        if (Math.abs(next - b.shown) > 1e-5 || !b.laid) { b.shown = Math.abs(b.f - next) < 1e-4 ? b.f : next; layoutBank(b, built); b.laid = true; dirty = true; }
        const crit = d.f >= 0.9;
        if (crit) pileN += 7;
        const blink = crit && Math.floor(now * 2) % 2;
        b.plaque.draw(`${d.label}|${Math.round(d.f * 100)}|${blink}`, (g, W, H) => {
          g.fillStyle = blink ? '#5A1E18' : '#1E1C1B'; g.fillRect(0, 0, W, H);
          const name = d.mount === '/' ? 'ROOT /' : d.mount.toUpperCase();
          drawDots(g, name, 18, 12, 4, '#9A9186');
          drawDots(g, `${Math.round(d.f * 100)}%`, W - 18, 12, 4, crit ? STATUS.blocked : '#9A9186', { align: 'right' });
          const txt = d.label.replace(' GB', 'G').replace(/ /g, '');
          const pt = Math.min(10, (W - 30) / (txt.length * 6));
          drawDots(g, txt, W / 2, 44 + (80 - pt * 7) / 2, pt, crit ? STATUS.blocked : ENV.butter, { align: 'center', ghost: 0.06 });
        }, now);
        b.plaque.tick(now);
      }
      if (dirty) { drawers.instanceMatrix.needsUpdate = true; papers.instanceMatrix.needsUpdate = true; if (drawers.instanceColor) drawers.instanceColor.needsUpdate = true; }
      if (piles.count !== pileN) {
        piles.count = pileN;
        piles.visible = pileN > 0;
        for (let i = 0; i < pileN; i++) {
          e.set(0, i * 1.7, 0); q.setFromEuler(e);
          m4.compose(p.set(-WALL_W / 2 + 0.6 + (i * 0.93) % (WALL_W - 1), 0.012 + (i % 3) * 0.02, 0.35 + ((i * 0.37) % 0.5)), q, s);
          piles.setMatrixAt(i, m4);
        }
        piles.instanceMatrix.needsUpdate = true;
      }
    },
    tooltip() {
      const figs = diskFigures(ctx.store.stats?.disks);
      const d = figs[0];
      return {
        title: 'Disk · filing drawers', value: figs.map((x) => `${x.mount} ${x.label}`).join(' · ') || '--',
        spark: series(ctx.store.statsHistory, (x) => { const r = (x.disks ?? []).find((y) => y.mount === (d?.mount ?? '/')); return r ? r.used / GiB : null; }),
        max: d ? d.total / GiB : undefined, source: `statfs ${figs.map((x) => x.mount).join(' ')} (every 30 s)`, color: ENV.oak, crit: d && d.f >= 0.9,
      };
    },
    dispose() { built?.plaqueSet.dispose(); },
  };
});
