/**
 * The farmhouse interior's live pieces, each one draw call: the hearth fire (instanced flames), the clock's
 * pendulum, the paper atlas (clock dial, the open Almanac's pages, the trophy plaque, the shelf sign: one toon quad
 * mesh over one canvas), the CRT screen (the farm's terminals in green phosphor), the Collections finds (one merged
 * mesh, rebuilt when the book changes) and the fish tank (glass + every species caught, swimming, one mesh with a
 * vertex shader). Farmhouse-local frame (layout.ts).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ValleyState } from '../../model/types.ts';
import type { CollectionData } from '../../model/collection.ts';
import { collectDef } from '../../model/collection.ts';
import { PAL, paint, toonRamp } from '../toon.ts';
import { warmEmitter } from '../lights/emitters.ts';
import { FONT, HAND, Kit, canvasTex, fitText, roundRect, woodPanel } from '../structures/kit.ts';
import { catchGeometry, forageGeometry } from '../forage/models.ts';
import { forageMaterial } from '../forage/assets.ts';
import { FURN, ROOM, SHELF_IDS, TANK_IDS, biggestCatch, clockHands, clockText, shelfSlots } from './layout.ts';

const F = ROOM.floor;
const H = FURN.hearth, HX0 = H.x - H.w / 2;

// ------------------------------------------------------------------------------------------------- fire

export interface Fire { mesh: THREE.InstancedMesh; update(t: number, k: number): void }
const FLAMES: readonly { x: number; z: number; s: number; c: readonly [number, number, number]; ph: number }[] = [
  { x: 0.02, z: -0.2, s: 0.22, c: [1.7, 0.42, 0.07], ph: 0 },
  { x: -0.04, z: 0.02, s: 0.3, c: [1.8, 0.5, 0.09], ph: 1.7 },
  { x: 0.03, z: 0.22, s: 0.2, c: [1.7, 0.42, 0.07], ph: 3.1 },
  { x: -0.1, z: -0.08, s: 0.18, c: [1.5, 0.34, 0.06], ph: 4.4 },
  { x: -0.06, z: -0.05, s: 0.16, c: [2.2, 1.15, 0.3], ph: 2.2 },
  { x: -0.05, z: 0.12, s: 0.13, c: [2.2, 1.15, 0.3], ph: 5.3 },
  { x: -0.12, z: 0.2, s: 0.1, c: [1.9, 0.7, 0.15], ph: 0.9 },
  // embers glowing under the logs
  { x: 0.05, z: -0.12, s: -0.08, c: [1.6, 0.35, 0.08], ph: 0.4 },
  { x: -0.02, z: 0.15, s: -0.07, c: [1.6, 0.35, 0.08], ph: 2.9 },
];
export function buildFire(): Fire {
  const geo = new THREE.ConeGeometry(0.5, 1, 5, 1).translate(0, 0.5, 0);
  const mat = warmEmitter(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  const mesh = new THREE.InstancedMesh(geo, mat, FLAMES.length);
  mesh.name = 'interior:fire';
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  const c = new THREE.Color();
  FLAMES.forEach((f, i) => mesh.setColorAt(i, c.setRGB(f.c[0], f.c[1], f.c[2])));
  const d = new THREE.Object3D();
  const base = new THREE.Vector3(H.x - 0.05, F + 0.24, H.z);
  return {
    mesh,
    update(t, k) {
      FLAMES.forEach((f, i) => {
        const ember = f.s < 0, s = Math.abs(f.s) * (0.75 + 0.25 * k);
        const w = Math.sin(t * 7.3 + f.ph) * 0.5 + Math.sin(t * 13.1 + f.ph * 2.1) * 0.3 + Math.sin(t * 3.7 + f.ph) * 0.2;
        d.position.set(base.x + f.x + (ember ? 0 : Math.sin(t * 5.1 + f.ph) * 0.012), base.y + (ember ? -0.03 : 0), base.z + f.z + (ember ? 0 : Math.sin(t * 4.3 + f.ph) * 0.015));
        d.rotation.set(Math.sin(t * 3.3 + f.ph) * 0.12, t * (0.6 + i * 0.1), Math.sin(t * 4.1 + f.ph) * 0.12);
        if (ember) d.scale.set(s * 1.6, s * (0.35 + 0.08 * w), s * 1.6);
        else d.scale.set(s * (0.85 - w * 0.08), s * (2.1 + w * 0.5), s * (0.85 - w * 0.08));
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------------------------------------- pendulum

export function buildPendulum(): THREE.Mesh {
  const k = new Kit(41);
  k.rod(0, 0, 0, 0, -0.6, 0, 0.008, 0xb8862a);
  k.cyl(0.085, 0.025, 0xd9a93a, { y: -0.66, rx: Math.PI / 2 }, 12);
  k.cyl(0.05, 0.03, 0xf2c35a, { y: -0.66, z: 0.004, rx: Math.PI / 2 }, 10);
  const m = k.mesh();
  m.name = 'interior:pendulum';
  m.position.set(FURN.clock.x, F + 1.42, FURN.clock.z + 0.13);
  m.castShadow = false;
  return m;
}

// ------------------------------------------------------------------------------------------------- the paper atlas

/** atlas regions (px) in a 1024 × 512 canvas */
const AT = { clock: [0, 0, 256, 256], book: [256, 0, 512, 256], plaque: [768, 0, 256, 128], sign: [768, 128, 256, 64] } as const;

export interface Paper {
  mesh: THREE.Mesh;
  /** redraw what changed (cheap when nothing did) */
  update(hour: number, v: ValleyState, collection: CollectionData | null): void;
}

export function buildPaper(): Paper {
  const W = 1024, Hh = 512;
  const c = canvasTex(W, Hh);
  const g = c.g;
  const quads: THREE.BufferGeometry[] = [];
  /** a quad at a room-local transform, its uv mapped to an atlas region */
  const quad = (w: number, h: number, r: readonly [number, number, number, number], m: THREE.Matrix4, circle = false) => {
    const geo = circle ? new THREE.CircleGeometry(w / 2, 20) : new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (r[0] + uv.getX(i) * r[2]) / W, 1 - (r[1] + (1 - uv.getY(i)) * r[3]) / Hh);
    geo.applyMatrix4(m);
    quads.push(geo.index ? geo.toNonIndexed() : geo);
  };
  const M = (x: number, y: number, z: number, ry = 0, rx = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')).setPosition(x, y, z);
  quad(0.36, 0.36, AT.clock, M(FURN.clock.x, F + 1.84, FURN.clock.z + 0.207), true);
  // the open Almanac lies on the desk; it reads toward the chair (north side): text "up" points +z
  quad(0.54, 0.34, AT.book, M(FURN.almanacDesk.x - 0.1, F + 0.832, FURN.almanacDesk.z - 0.02, Math.PI, -Math.PI / 2));
  quad(0.5, 0.25, AT.plaque, M(HX0 - 0.05, F + 2.42, H.z, -Math.PI / 2));
  quad(1.08, 0.18, AT.sign, M(FURN.shelf.x, F + FURN.shelf.h + 0.25, FURN.shelf.z - 0.055));
  const geo = mergeGeometries(quads)!;
  for (const q of quads) q.dispose();
  geo.computeVertexNormals();
  const mat = new THREE.MeshToonMaterial({ map: c.tex, gradientMap: toonRamp() });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'interior:paper';
  mesh.receiveShadow = true;

  let clockKey = '', bookKey = '', plaqueKey = '', signDone = false;
  const clip = (r: readonly number[], fn: () => void) => { g.save(); g.beginPath(); g.rect(r[0], r[1], r[2], r[3]); g.clip(); g.translate(r[0], r[1]); fn(); g.restore(); };

  function drawClock(hour: number): void {
    clip(AT.clock, () => {
      const R = 128;
      g.fillStyle = '#d9a93a'; g.fillRect(0, 0, 256, 256);
      const gr = g.createRadialGradient(R, R, 10, R, R, R);
      gr.addColorStop(0, '#fbf3df'); gr.addColorStop(1, '#eadcb8');
      g.fillStyle = gr; g.beginPath(); g.arc(R, R, R - 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6e4a2a'; g.lineWidth = 3; g.beginPath(); g.arc(R, R, R - 16, 0, Math.PI * 2); g.stroke();
      // painted moon-phase arch and the maker's name
      g.fillStyle = '#3f5f8a'; g.beginPath(); g.arc(R, R - 30, 44, Math.PI, 0); g.fill();
      g.fillStyle = '#f2e05a'; g.beginPath(); g.arc(R + 10, R - 46, 11, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 6; i++) { g.fillStyle = '#fff6c8'; g.fillRect(R - 34 + i * 12, R - 56 + (i % 2) * 14, 2, 2); }
      g.fillStyle = '#2b2420'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `bold 20px ${FONT}`;
      for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillText(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][i - 1], R + Math.sin(a) * (R - 34), R - Math.cos(a) * (R - 34)); }
      g.font = `italic 12px ${HAND}`; g.fillText('Valley & Sons', R, R + 40);
      const h = clockHands(hour);
      const hand = (a: number, len: number, wdt: number, col: string) => { g.strokeStyle = col; g.lineWidth = wdt; g.lineCap = 'round'; g.beginPath(); g.moveTo(R, R); g.lineTo(R + Math.sin(a) * len, R - Math.cos(a) * len); g.stroke(); };
      hand(h.h, R * 0.48, 8, '#2b2420');
      hand(h.m, R * 0.72, 5, '#2b2420');
      g.fillStyle = '#b8862a'; g.beginPath(); g.arc(R, R, 8, 0, Math.PI * 2); g.fill();
    });
  }

  function drawBook(v: ValleyState): void {
    const a = v.almanac;
    clip(AT.book, () => {
      const w = 512, h = 256;
      g.fillStyle = '#f6ecd4'; g.fillRect(0, 0, w, h);
      // the gutter shadow and page edges
      const gr = g.createLinearGradient(w / 2 - 30, 0, w / 2 + 30, 0);
      gr.addColorStop(0, 'rgba(120,90,50,0)'); gr.addColorStop(0.5, 'rgba(120,90,50,0.35)'); gr.addColorStop(1, 'rgba(120,90,50,0)');
      g.fillStyle = gr; g.fillRect(w / 2 - 30, 0, 60, h);
      g.fillStyle = '#4a2e1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
      // left page: the rank
      g.font = `bold 15px ${FONT}`; g.fillText('THE VALLEY ALMANAC', w / 4, 28);
      g.strokeStyle = '#b8862a'; g.lineWidth = 2; g.beginPath(); g.moveTo(30, 44); g.lineTo(w / 2 - 30, 44); g.stroke();
      g.fillStyle = '#7a2e22'; fitText(g, a ? a.name : 'Homestead', w / 4, 90, w / 2 - 50, 34, HAND);
      g.fillStyle = '#4a2e1a'; g.font = `600 16px ${FONT}`;
      g.fillText(a ? `${a.points.toLocaleString('en-US')} prosperity${a.stars ? ` · ${'★'.repeat(Math.min(5, a.stars))}` : ''}` : '', w / 4, 130);
      if (a) {
        const bx = 40, bw = w / 2 - 80;
        g.fillStyle = '#d8c8a0'; roundRect(g, bx, 152, bw, 14, 7); g.fill();
        g.fillStyle = '#5cae4f'; roundRect(g, bx, 152, Math.max(14, bw * a.progress), 14, 7); g.fill();
        g.fillStyle = '#4a2e1a'; g.font = `italic 14px ${HAND}`;
        g.fillText(a.nextName ? `next: ${a.nextName}` : 'the valley is golden', w / 4, 188);
        g.fillText(a.streak > 1 ? `${a.streak}-day streak` : '', w / 4, 214);
      }
      // right page: the week as a little hand-drawn bar chart
      g.font = `bold 14px ${FONT}`; g.fillStyle = '#4a2e1a'; g.fillText('This week', (w * 3) / 4, 28);
      const wk = a?.week ?? [];
      const max = Math.max(1, ...wk.map((d) => d.points));
      wk.forEach((d, i) => {
        const x = w / 2 + 50 + i * 28, bh = (d.points / max) * 120;
        g.fillStyle = i === wk.length - 1 ? '#d9773a' : '#8aa05a';
        g.fillRect(x, 200 - bh, 18, bh);
        g.fillStyle = '#6e4a2a'; g.font = `11px ${FONT}`; g.fillText('SMTWTFS'[new Date(`${d.date}T12:00`).getDay()] ?? '', x + 9, 214);
      });
      g.strokeStyle = '#6e4a2a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w / 2 + 40, 201); g.lineTo(w - 30, 201); g.stroke();
      g.font = `italic 13px ${HAND}`; g.fillStyle = '#4a2e1a';
      g.fillText(a ? `today: ${a.today?.points ?? 0} points` : '', (w * 3) / 4, 238);
    });
  }

  function drawPlaque(best: { id: string; cm: number } | null): void {
    clip(AT.plaque, () => {
      const w = 256, h = 128;
      g.fillStyle = '#5a3a22'; roundRect(g, 0, 0, w, h, 18); g.fill();
      g.save(); roundRect(g, 6, 6, w - 12, h - 12, 14); g.clip(); woodPanel(g, w, h, '#a0703f', 5); g.restore();
      g.fillStyle = '#e9c46a'; roundRect(g, 40, 70, w - 80, 46, 8); g.fill();
      g.fillStyle = '#4a2e1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const def = best ? collectDef(best.id) : null;
      fitText(g, def ? def.name : 'Your biggest catch', w / 2, 86, w - 96, 18);
      g.font = `600 13px ${FONT}`;
      g.fillText(best ? `${best.cm} cm` : 'goes here', w / 2, 104);
    });
  }

  function drawSign(): void {
    clip(AT.sign, () => {
      g.fillStyle = '#c99a64'; g.fillRect(0, 0, 256, 64);
      g.fillStyle = '#4a2e1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, 'C o l l e c t i o n s', 128, 33, 230, 26, HAND);
    });
  }

  return {
    mesh,
    update(hour, v, col) {
      let dirty = false;
      const ck = clockText(hour);
      if (ck !== clockKey) { clockKey = ck; drawClock(hour); dirty = true; }
      const a = v.almanac;
      const bk = a ? `${a.points}|${a.rank}|${a.streak}|${a.week.map((d) => d.points).join(',')}` : '-';
      if (bk !== bookKey) { bookKey = bk; drawBook(v); dirty = true; }
      const best = col ? biggestCatch(col.found) : null;
      const pk = best ? `${best.id}|${best.cm}` : '-';
      if (pk !== plaqueKey) { plaqueKey = pk; drawPlaque(best); dirty = true; }
      if (!signDone) { signDone = true; drawSign(); dirty = true; }
      if (dirty) c.tex.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------------------------------------- the CRT

export interface Screen { mesh: THREE.Mesh; update(t: number, v: ValleyState): void }
export function buildScreen(): Screen {
  const W = 512, Hh = 384;
  const c = canvasTex(W, Hh);
  c.tex.minFilter = THREE.LinearFilter; c.tex.generateMipmaps = false;
  const g = c.g;
  const mat = warmEmitter(new THREE.MeshBasicMaterial({ map: c.tex, color: new THREE.Color(1.3, 1.3, 1.3), fog: false }), 0.6);
  const geo = new THREE.PlaneGeometry(0.4, 0.3);
  // the CRT sits on the west desk, facing +x into the room (room.ts 'crt': origin + bezel offset)
  geo.rotateY(Math.PI / 2).translate(FURN.crtDesk.x - 0.08 + 0.178, F + 0.765 + 0.28, FURN.crtDesk.z + 0.12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'interior:crt';
  let key = '', blink = false;
  const GREEN = '#7dff9a', DIM = '#2f8a4a', AMBER = '#ffcf5a';
  function draw(v: ValleyState): void {
    g.fillStyle = '#06140a'; g.fillRect(0, 0, W, Hh);
    // phosphor vignette
    const gr = g.createRadialGradient(W / 2, Hh / 2, 40, W / 2, Hh / 2, W * 0.65);
    gr.addColorStop(0, 'rgba(40,120,60,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.font = `bold 22px "DejaVu Sans Mono", "Courier New", monospace`;
    g.fillStyle = GREEN;
    const farmers = [...v.farmers.values()];
    const helpers = [...v.helpers.values()];
    const needs = farmers.filter((f) => f.needsYou).length;
    g.fillText(`VALLEY-OS  ${farmers.length} farmers`, 18, 14);
    g.fillStyle = DIM; g.fillRect(18, 44, W - 36, 2);
    g.font = `18px "DejaVu Sans Mono", "Courier New", monospace`;
    const rank = (s: string) => (s === 'blocked' ? 0 : s === 'working' ? 1 : s === 'done' ? 2 : 3);
    const rows = [...farmers].sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || rank(a.status) - rank(b.status) || a.tag.localeCompare(b.tag));
    const max = 11;
    rows.slice(0, max).forEach((f, i) => {
      const y = 56 + i * 24;
      const ask = f.needsYou;
      g.fillStyle = ask ? AMBER : f.status === 'working' ? GREEN : DIM;
      const mark = ask ? (blink ? '!' : ' ') : f.status === 'working' ? '>' : f.status === 'done' ? '+' : '.';
      const name = f.tag.length > 22 ? `${f.tag.slice(0, 21)}~` : f.tag;
      g.fillText(`${mark} ${name.padEnd(22)} ${ask ? 'NEEDS YOU' : f.status}`, 18, y);
    });
    if (rows.length > max) { g.fillStyle = DIM; g.fillText(`  … ${rows.length - max} more`, 18, 56 + max * 24); }
    if (!rows.length) { g.fillStyle = DIM; g.fillText('  no farmers yet: open a herdr workspace', 18, 60); }
    g.fillStyle = needs ? AMBER : GREEN;
    g.fillText(`${needs ? `${needs} need${needs === 1 ? 's' : ''} you · ` : ''}${helpers.length} shells   [E] terminals${blink ? '_' : ' '}`, 18, Hh - 34);
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < Hh; y += 3) g.fillRect(0, y, W, 1);
    c.tex.needsUpdate = true;
  }
  let acc = 1;
  return {
    mesh,
    update(t, v) {
      acc += 1;
      const b = Math.floor(t * 1.6) % 2 === 0;
      const k = `${b}|${[...v.farmers.values()].map((f) => `${f.tag}:${f.status}:${f.needsYou ? 1 : 0}`).join(',')}|${v.helpers.size}`;
      if (k === key && acc < 600) return;
      key = k; blink = b; acc = 0;
      draw(v);
    },
  };
}

// ------------------------------------------------------------------------------------------------- the Collections finds

const tmpBox = new THREE.Box3(), tmpV = new THREE.Vector3();
/** a palm-sized find, fitted into a box of `fit` metres, standing on y = 0 */
function fitted(g: THREE.BufferGeometry, fit: number, yaw = 0): THREE.BufferGeometry {
  const c = g.clone();
  for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') c.deleteAttribute(k);
  c.rotateY(yaw);
  tmpBox.setFromBufferAttribute(c.attributes.position as THREE.BufferAttribute);
  const size = tmpBox.getSize(tmpV), s = fit / Math.max(size.x, size.y, size.z, 1e-3);
  c.translate(-(tmpBox.min.x + tmpBox.max.x) / 2, -tmpBox.min.y, -(tmpBox.min.z + tmpBox.max.z) / 2).scale(s, s, s);
  return c;
}
function prim(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(f.attributes)) if (k !== 'position') f.deleteAttribute(k);
  f.computeVertexNormals();
  return paint(f, color);
}

export interface Finds { mesh: THREE.Mesh; /** rebuild if the book changed */ update(col: CollectionData | null, version: number): void }
export function buildFinds(): Finds {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), forageMaterial());
  mesh.name = 'interior:finds';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  let ver = -1;
  const slots = shelfSlots();
  return {
    mesh,
    update(col, version) {
      if (version === ver && mesh.geometry.attributes.position) return;
      ver = version;
      const parts: THREE.BufferGeometry[] = [];
      const found = col?.found ?? {};
      for (const s of slots) {
        if (found[s.id]) {
          const junk = s.id === 'boot' || s.id === 'bottle';
          const g = fitted(junk ? catchGeometry(s.id) : forageGeometry(s.id), junk ? 0.3 : 0.26, junk ? Math.PI / 2 : 0.3);
          g.translate(s.x, F + s.y, s.z);
          parts.push(g);
          // count tally: little notches on a tag for every few found
          continue;
        }
        // a paper tag with a question mark, waiting
        parts.push(prim(new THREE.BoxGeometry(0.12, 0.08, 0.008), 0xf2e8d0).rotateX(-0.25).translate(s.x, F + s.y + 0.05, s.z + 0.12));
        parts.push(prim(new THREE.BoxGeometry(0.02, 0.035, 0.01), 0xa08a6a).rotateX(-0.25).translate(s.x, F + s.y + 0.055, s.z + 0.124));
      }
      // the biggest catch, mounted over the fire on a shield-shaped board, facing the room (−x)
      const best = col ? biggestCatch(col.found) : null;
      parts.push(prim(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8).rotateZ(Math.PI / 2).scale(1, 0.62, 1.3), 0x6e4a2a).translate(HX0 - 0.02, F + 1.86, H.z));
      parts.push(prim(new THREE.CylinderGeometry(0.36, 0.36, 0.045, 8).rotateZ(Math.PI / 2).scale(1, 0.55, 1.25), 0xa0703f).translate(HX0 - 0.03, F + 1.86, H.z));
      if (best) {
        const g = catchGeometry(best.id).clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
        tmpBox.setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute);
        const len = tmpBox.max.z - tmpBox.min.z, s = 0.7 / Math.max(len, 1e-3);
        g.translate(0, -(tmpBox.min.y + tmpBox.max.y) / 2, -(tmpBox.min.z + tmpBox.max.z) / 2).scale(s, s, s).rotateZ(0.12).translate(HX0 - 0.1, F + 1.88, H.z);
        parts.push(g);
      }
      const old = mesh.geometry;
      const g = parts.length ? mergeGeometries(parts) : null;
      for (const p of parts) p.dispose();
      mesh.geometry = g ?? new THREE.BufferGeometry();
      mesh.geometry.computeBoundingSphere();
      old.dispose();
    },
  };
}

// ------------------------------------------------------------------------------------------------- the fish tank

const TANK = { w: 0.94, h: 0.46, d: 0.4 };
export interface Tank { glass: THREE.Mesh; fish: THREE.Mesh; update(t: number, col: CollectionData | null, version: number): void }
export function buildTank(): Tank {
  const T = FURN.tank, cy = F + 0.76 + TANK.h / 2;
  // the water volume seen through the glass (frame, lid and gravel are static: tankDressing, in the room's Kit)
  const glassGeo = new THREE.BoxGeometry(TANK.w, TANK.h, TANK.d).translate(T.x, cy, T.z);
  const glass = new THREE.Mesh(glassGeo, new THREE.MeshBasicMaterial({ color: 0x6fc8d8, transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
  glass.name = 'interior:tank';
  glass.renderOrder = 2;
  // fish: every species caught, merged; a vertex shader moves each one along its own loop
  const uFish = { value: Array.from({ length: 12 }, () => new THREE.Vector4()) };
  const uTime = { value: 0 };
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFish = uFish;
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFish;\nuniform vec4 uFish[12];\nuniform float uTime;\nvec3 fishXf(vec3 p, vec4 f, float ph) { p.x += sin(uTime * 9.0 + ph + p.z * 18.0) * 0.012 * smoothstep(0.0, -0.08, p.z); float c = cos(f.w), s = sin(f.w); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + f.xyz; }\nvec3 fishN(vec3 n, vec4 f) { float c = cos(f.w), s = sin(f.w); return vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c); }')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = fishN(objectNormal, uFish[int(aFish)]);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = fishXf(transformed, uFish[int(aFish)], aFish * 1.7);');
  };
  mat.customProgramCacheKey = () => 'interior-tank-fish';
  const fish = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  fish.name = 'interior:fish';
  fish.frustumCulled = false;
  fish.renderOrder = 1;
  let ver = -1, ids: string[] = [];
  return {
    glass, fish,
    update(t, col, version) {
      if (version !== ver) {
        ver = version;
        ids = TANK_IDS.filter((id) => col?.found[id]).slice(0, 12);
        const parts = ids.map((id, i) => {
          const g = catchGeometry(id).clone();
          for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
          tmpBox.setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute);
          const len = tmpBox.max.z - tmpBox.min.z;
          const def = collectDef(id);
          const cm = def?.kind === 'fish' ? (def.cm[0] + def.cm[1]) / 2 : 20;
          const s = (0.08 + Math.min(1, cm / 80) * 0.1) / Math.max(len, 1e-3);
          g.translate(-(tmpBox.min.x + tmpBox.max.x) / 2, -(tmpBox.min.y + tmpBox.max.y) / 2, -(tmpBox.min.z + tmpBox.max.z) / 2).scale(s, s, s);
          const n = g.attributes.position.count;
          g.setAttribute('aFish', new THREE.BufferAttribute(new Float32Array(n).fill(i), 1));
          return g;
        });
        const old = fish.geometry;
        const merged = parts.length ? mergeGeometries(parts) : null;
        for (const p of parts) p.dispose();
        fish.geometry = merged ?? new THREE.BufferGeometry();
        old.dispose();
      }
      uTime.value = t;
      ids.forEach((_, i) => {
        const sp = 0.25 + (i % 4) * 0.07, ph = i * 2.1;
        const a = t * sp + ph;
        const x = Math.sin(a) * (TANK.w / 2 - 0.12), z = Math.sin(a * 0.73 + ph) * (TANK.d / 2 - 0.08);
        const vx = Math.cos(a) * (TANK.w / 2 - 0.12) * sp, vz = Math.cos(a * 0.73 + ph) * (TANK.d / 2 - 0.08) * sp * 0.73;
        const y = cy - TANK.h / 2 + 0.12 + ((i * 0.37) % 1) * (TANK.h - 0.24) + Math.sin(t * 0.9 + ph) * 0.02;
        uFish.value[i].set(T.x + x, y, T.z + z, Math.atan2(vx, vz));
      });
    },
  };
}

/** Static tank dressing (gravel, plants, a little castle, lid with a light): written into the room's Kit. */
export function tankDressing(k: Kit): void {
  const T = FURN.tank, y0 = F + 0.76;
  k.part('tank', () => k.at({ x: T.x, y: y0, z: T.z }, () => {
    k.box(TANK.w + 0.04, 0.03, TANK.d + 0.04, PAL.ink, { y: 0.015 });
    k.box(TANK.w, 0.06, TANK.d, 0xc8b89a, { y: 0.06 });
    for (let i = 0; i < 7; i++) k.cone(0.03, 0.18 + (i % 3) * 0.06, i % 2 ? 0x4f9a48 : 0x6fbf5a, { x: -0.38 + i * 0.03 + (i > 3 ? 0.5 : 0), y: 0.15 + (i % 3) * 0.03, z: -0.1 + (i % 2) * 0.08 }, 4);
    k.box(0.12, 0.12, 0.1, 0xb7b0a3, { x: 0.25, y: 0.15, z: -0.08 });
    for (const x of [-1, 1]) k.box(0.04, 0.05, 0.04, 0xb7b0a3, { x: 0.25 + x * 0.045, y: 0.235, z: -0.08 });
    k.box(0.04, 0.06, 0.012, 0x2a221e, { x: 0.25, y: 0.12, z: -0.024 });
    k.blob(0.05, 0x9aa0a8, { x: -0.12, y: 0.1, z: 0.08 });
    // frame and lid
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.025, TANK.h, 0.025, PAL.ink, { x: x * TANK.w / 2, y: TANK.h / 2, z: z * TANK.d / 2 });
    k.box(TANK.w + 0.06, 0.05, TANK.d + 0.06, 0x2f4a3a, { y: TANK.h + 0.02 });
  }));
}

export { FLAMES };
