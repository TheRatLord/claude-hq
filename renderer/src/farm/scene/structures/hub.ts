/**
 * Hub pieces around the square: mailbox (unread flag), shipping bin (commits), noticeboard (live notes), wishing well,
 * signpost (live plot arrows) and the toolshed.
 */
import * as THREE from 'three';
import { PAL, WORKSPACE_COLORS, toon } from '../toon.ts';
import { Kit, canvasTex, damp, ellipsize, fitText, FONT, HAND, plaque, rng, roundRect, woodPanel } from './kit.ts';
import { bucket, crate, flowerPot, sack, wateringCan, barrel } from './props.ts';
import type { Env, Rig } from './rig.ts';
import type { BuildOpts } from './farmhouse.ts';
import { gableRoof } from './farmhouse.ts';

// ---------------------------------------------------------------------------------------------
// Mailbox — flag up while there is unread mail; wiggles when a letter lands

export const MAILBOX = Object.freeze({ top: new THREE.Vector3(0, 1.25, 0) });

export function buildMailbox(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'mailbox';
  const k = new Kit(o.seed + 41);
  k.cyl(0.28, 0.12, PAL.stone, { y: 0.06 }, 6);
  k.box(0.14, 1.05, 0.14, PAL.woodDark, { y: 0.55 });
  k.beam(0, 0.55, 0.0, 0, 0.95, 0.25, 0.08, PAL.woodDark);
  k.box(0.46, 0.06, 0.62, PAL.wood, { y: 1.02 });
  // flowers at the foot
  flowerPot(k, { x: 0.3, z: 0.25 }, o.season, 3);
  k.build(root, o.night);
  // the box itself wiggles as one piece (body + door + flag pivot)
  const bk = new Kit(7);
  bk.box(0.42, 0.26, 0.58, 0x4f86c6, { y: 0.13 });
  bk.add(new THREE.CylinderGeometry(0.21, 0.21, 0.58, 10, 1, false, 0, Math.PI), 0x4f86c6, { y: 0.26, rx: Math.PI / 2, rz: Math.PI / 2 });
  bk.box(0.44, 0.3, 0.03, 0x3a6aa8, { y: 0.16, z: 0.3 });
  bk.add(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 10, 1, false, 0, Math.PI), 0x3a6aa8, { y: 0.28, z: 0.3, rx: Math.PI / 2, rz: Math.PI / 2 });
  bk.box(0.06, 0.06, 0.06, PAL.yellow, { y: 0.32, z: 0.33 });
  bk.box(0.3, 0.05, 0.01, PAL.white, { y: 0.24, z: 0.316 });
  // little bird perched on top
  bk.ball(0.07, PAL.yellow, { x: -0.05, y: 0.52, z: -0.12, s: [1, 0.9, 1.3] });
  bk.ball(0.045, PAL.yellow, { x: -0.05, y: 0.6, z: -0.05 });
  bk.cone(0.018, 0.05, PAL.orange, { x: -0.05, y: 0.6, z: 0.0, rx: Math.PI / 2 }, 4);
  const box = bk.mesh();
  box.position.set(0, 1.05, 0);
  root.add(box);
  // letters peeking out (visible while unread)
  const lk = new Kit(8);
  lk.box(0.3, 0.02, 0.2, PAL.white, { y: 0.34, z: 0.27, rx: -0.4 });
  lk.box(0.26, 0.02, 0.18, 0xf6e6b8, { x: 0.03, y: 0.36, z: 0.27, rx: -0.55, ry: 0.15 });
  lk.box(0.06, 0.005, 0.06, PAL.red, { y: 0.357, z: 0.28, rx: -0.4 });
  const letters = lk.mesh();
  letters.castShadow = false;
  box.add(letters);
  // flag on the side: pivot at the arm
  const fk = new Kit(9);
  fk.box(0.03, 0.03, 0.42, PAL.metalDark, { z: -0.19 });
  fk.box(0.025, 0.22, 0.26, PAL.red, { y: 0.1, z: -0.36 });
  fk.box(0.03, 0.07, 0.07, PAL.white, { y: 0.12, z: -0.3 });
  const flag = fk.mesh();
  flag.position.set(0.23, 0.18, 0.12);
  box.add(flag);

  let unread = 0, flagA = 0, wig = 99;
  const rig: Rig = {
    update(e: Env) {
      wig += e.dt;
      const target = unread > 0 ? Math.PI / 2 : 0;
      flagA = damp(flagA, target, 6, e.dt);
      flag.rotation.x = flagA + (unread > 0 ? Math.sin(e.t * 3) * 0.05 : 0);
      letters.visible = unread > 0;
      const w = wig < 1.2 ? Math.sin(wig * 30) * 0.08 * (1 - wig / 1.2) : 0;
      box.rotation.z = w;
      box.scale.set(1 - w * 0.4, 1 + Math.abs(w) * 1.2, 1);
    },
    poke(what, v) {
      if (what === 'unread') unread = Number(v) || 0;
      if (what === 'mail') wig = 0;
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Shipping bin — lid pops on 'ship'; a stack of crates grows with today's commits

export const SHIPPING_BIN = Object.freeze({ drop: new THREE.Vector3(0, 0, 1.2), maxCrates: 12 });

/** crate stack slots (local): pyramid next to the bin */
const CRATE_SLOTS: [number, number, number][] = [
  [1.55, 0, -0.2], [1.55, 0, 0.4], [2.15, 0, -0.2], [2.15, 0, 0.4], [1.55, 0.5, 0.1], [2.15, 0.5, 0.1],
  [1.85, 0.5, -0.2], [1.85, 1.0, 0.1], [2.75, 0, 0.1], [2.75, 0.5, 0.1], [1.85, 0, 0.9], [2.45, 0, 0.9],
];

export function buildShippingBin(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'shippingBin';
  const k = new Kit(o.seed + 51);
  const W = 1.8, D = 1.0, H = 0.8;
  k.box(W, 0.12, D, PAL.woodDark, { y: 0.06 });
  k.box(W, H, D, PAL.plank, { y: H / 2 + 0.06 });
  for (let i = 0; i < 4; i++) k.box(W + 0.02, 0.04, D + 0.02, PAL.woodDark, { y: 0.2 + i * 0.2 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.12, H + 0.1, 0.12, PAL.woodDark, { x: x * (W / 2), y: (H + 0.1) / 2, z: z * (D / 2) });
  // produce peeking out of the open top is hidden by the lid; sack + can beside
  sack(k, { x: -1.3, z: 0.3, ry: 0.5 });
  k.build(root, o.night);
  // lid, hinged at the back edge
  const lk = new Kit(3);
  lk.box(W + 0.1, 0.1, D + 0.1, PAL.wood, { y: 0.05, z: (D + 0.1) / 2 });
  for (let i = 0; i < 5; i++) lk.box(0.04, 0.02, D + 0.1, PAL.woodDark, { x: -W / 2 + 0.2 + i * 0.35, y: 0.105, z: (D + 0.1) / 2 });
  lk.box(0.3, 0.06, 0.1, PAL.metalDark, { y: 0.02, z: D + 0.1 });
  const lid = lk.mesh();
  lid.position.set(0, H + 0.08, -D / 2 - 0.05);
  root.add(lid);
  // crate stack (instanced; count = today's commits)
  const ck = new Kit(4);
  crate(ck, {}, 0.48);
  const cg = ck.geometry('solid')!;
  const crates = new THREE.InstancedMesh(cg, toon(0xffffff, { vertexColors: true }), SHIPPING_BIN.maxCrates);
  crates.castShadow = true;
  crates.count = 0;
  const r = rng(o.seed + 5);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  CRATE_SLOTS.forEach(([x, y, z], i) => { q.setFromAxisAngle(up, (r() - 0.5) * 0.4); p.set(x, y, z); crates.setMatrixAt(i, m4.compose(p, q, one)); });
  root.add(crates);

  // painted plaque on the front: today's shipments
  const pl = plaque(1.1, 0.46, 256);
  pl.mesh.position.set(0, 0.47, D / 2 + 0.03);
  root.add(pl.mesh);
  let pop = 99, shown = 0, want = 0, grow = 1;
  const rig: Rig = {
    update(e: Env) {
      pop += e.dt;
      // lid: pops open, holds, then claps shut with a bounce
      let a = 0;
      if (pop < 0.25) a = (pop / 0.25) * 1.9;
      else if (pop < 1.6) a = 1.9 + Math.sin(pop * 9) * 0.05;
      else if (pop < 1.9) a = 1.9 * (1 - (pop - 1.6) / 0.3);
      else if (pop < 2.4) a = Math.abs(Math.sin((pop - 1.9) * 14)) * 0.12 * (1 - (pop - 1.9) / 0.5);
      lid.rotation.x = -a;
      // crates: new ones pop in with a squash
      if (want !== shown) { shown = want; crates.count = Math.min(SHIPPING_BIN.maxCrates, shown); grow = 0; }
      pl.set({ title: 'Shipping bin', value: shown ? `${shown} crate${shown === 1 ? '' : 's'} today` : 'ready to ship' });
      pl.night(e.night);
      if (grow < 1 && crates.count > 0) {
        grow = Math.min(1, grow + e.dt * 3);
        const i = crates.count - 1, [x, y, z] = CRATE_SLOTS[i];
        const s = grow < 1 ? 0.3 + 0.7 * grow + Math.sin(grow * Math.PI) * 0.25 : 1;
        p.set(x, y + (1 - grow) * 0.8, z); q.setFromAxisAngle(up, i * 0.7);
        crates.setMatrixAt(i, m4.compose(p, q, one.set(s, s, s)));
        one.set(1, 1, 1);
        crates.instanceMatrix.needsUpdate = true;
      }
    },
    poke(what, v) {
      if (what === 'ship') pop = 0;
      if (what === 'commits') want = Math.min(SHIPPING_BIN.maxCrates, Math.max(0, Number(v) || 0));
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Noticeboard — a live corkboard of paper notes

export interface Note { pin: 'red' | 'orange' | 'green' | 'blue' | 'yellow'; /** farmer name */ title: string; /** short status tag: 'needs you', '3/7'… */ tag?: string; body: string; paper?: string }
export const NOTICEBOARD = Object.freeze({ w: 2.7, h: 1.6, y: 1.55 });

const PIN: Record<Note['pin'], string> = { red: '#e0403a', orange: '#f09a3a', green: '#5cae4f', blue: '#4f78c8', yellow: '#f2c33a' };

export function drawNotes(g: CanvasRenderingContext2D, W: number, H: number, notes: readonly Note[]): void {
  const r = rng(7);
  // cork
  g.fillStyle = '#c4935c';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(120,80,40,0.25)' : 'rgba(240,200,150,0.25)';
    g.fillRect(r() * W, r() * H, 2 + r() * 3, 2 + r() * 3);
  }
  // header ribbon
  g.fillStyle = '#f6efe0';
  roundRect(g, W * 0.3, 8, W * 0.4, 58, 10); g.fill();
  g.fillStyle = '#6e4a2a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, 'Valley notices', W / 2, 38, W * 0.38, 38, HAND);
  if (!notes.length) {
    g.save(); g.translate(W / 2, H * 0.55); g.rotate(-0.03);
    g.fillStyle = '#fffdf2'; g.fillRect(-200, -80, 400, 160);
    g.fillStyle = '#6e4a2a'; fitText(g, 'All quiet in the valley ☀', 0, -15, 360, 34, HAND);
    g.font = `26px ${HAND}`; g.fillText('nobody needs you right now', 0, 30);
    g.fillStyle = PIN.green; g.beginPath(); g.arc(0, -68, 11, 0, Math.PI * 2); g.fill();
    g.restore();
    return;
  }
  const cols = notes.length > 6 ? 4 : 3, rows = Math.ceil(Math.min(notes.length, 12) / cols);
  const cw = (W - 30) / cols, ch = Math.min(250, (H - 90) / Math.max(1, rows));
  notes.slice(0, 12).forEach((n, i) => {
    const cx = 15 + cw * (i % cols) + cw / 2, cy = 80 + ch * Math.floor(i / cols) + ch / 2;
    const nw = cw - 22, nh = ch - 18;
    g.save();
    g.translate(cx, cy);
    g.rotate((r() - 0.5) * 0.09);
    g.fillStyle = 'rgba(40,20,10,0.35)'; g.fillRect(-nw / 2 + 5, -nh / 2 + 6, nw, nh);
    g.fillStyle = n.paper ?? (n.pin === 'red' ? '#fff3c4' : n.pin === 'orange' ? '#ffe6d0' : n.pin === 'green' ? '#e8f6dc' : '#fffdf2');
    g.fillRect(-nw / 2, -nh / 2, nw, nh);
    g.fillStyle = 'rgba(80,120,200,0.18)';
    for (let y = -nh / 2 + 62; y < nh / 2 - 6; y += 30) g.fillRect(-nw / 2 + 8, y, nw - 16, 2);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const ts = Math.min(36, nh * 0.19);
    g.font = `bold ${ts}px ${FONT}`;
    g.fillStyle = '#3a2a1e';
    const name = ellipsize(g, n.title, nw * 0.62);
    g.fillText(name, -nw / 2 + 12, -nh / 2 + 16 + ts);
    if (n.tag) {
      g.font = `bold ${Math.round(ts * 0.62)}px ${FONT}`;
      const tw = Math.min(nw * 0.5, g.measureText(n.tag).width + 14), th = ts * 0.8;
      g.fillStyle = PIN[n.pin];
      roundRect(g, nw / 2 - tw - 8, -nh / 2 + 16 + ts * 0.25, tw, th, th / 2); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center';
      g.fillText(ellipsize(g, n.tag, tw - 10), nw / 2 - 8 - tw / 2, -nh / 2 + 16 + ts * 0.25 + th * 0.72);
      g.textAlign = 'left';
    }
    g.fillStyle = '#3a2a1e';
    const bs = Math.min(27, nh * 0.15);
    g.font = `${bs}px ${HAND}`;
    // wrap body into the remaining lines
    const words = n.body.split(/\s+/);
    let line = '', ly = -nh / 2 + 28 + ts + bs * 1.2, lines = 0;
    const maxLines = Math.max(1, Math.floor((nh - ts - 34) / (bs * 1.2)));
    for (let wI = 0; wI < words.length && lines < maxLines; wI++) {
      const test = line ? `${line} ${words[wI]}` : words[wI];
      if (g.measureText(test).width > nw - 24 && line) {
        g.fillText(lines === maxLines - 1 ? ellipsize(g, `${line} ${words.slice(wI).join(' ')}`, nw - 24) : line, -nw / 2 + 12, ly);
        lines++; ly += bs * 1.2; line = words[wI];
        if (lines === maxLines) { line = ''; break; }
      } else line = test;
    }
    if (line && lines < maxLines) g.fillText(ellipsize(g, line, nw - 24), -nw / 2 + 12, ly);
    // pin
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(3, -nh / 2 + 16, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = PIN[n.pin]; g.beginPath(); g.arc(0, -nh / 2 + 12, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(-3, -nh / 2 + 9, 4, 0, Math.PI * 2); g.fill();
    g.restore();
  });
  if (notes.length > 12) {
    g.fillStyle = '#fffdf2'; g.textAlign = 'right'; g.font = `bold 26px ${FONT}`;
    g.fillText(`+${notes.length - 12} more…`, W - 20, H - 16);
  }
}

export interface Board { set(notes: readonly Note[]): void }

export function buildNoticeboard(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'noticeboard';
  const k = new Kit(o.seed + 61);
  const N = NOTICEBOARD;
  const hw = N.w / 2 + 0.25;
  for (const s of [-1, 1]) {
    k.box(0.18, 2.75, 0.18, PAL.woodDark, { x: s * hw, y: 1.37 });
    k.cyl(0.18, 0.14, PAL.stone, { x: s * hw, y: 0.07 }, 6);
  }
  k.box(N.w + 0.3, N.h + 0.3, 0.12, PAL.wood, { y: N.y, z: -0.02 });
  k.box(N.w + 0.4, 0.12, 0.2, PAL.woodDark, { y: N.y + N.h / 2 + 0.15, z: 0.02 });
  k.box(N.w + 0.4, 0.12, 0.2, PAL.woodDark, { y: N.y - N.h / 2 - 0.15, z: 0.02 });
  k.at({ y: 2.65 }, () => gableRoof(k, N.w + 1.1, 0.45, 0, 0.35, 0.2, o.season, PAL.roofGreen, 0x4a7a3a));
  // a tray with chalk, a lantern hook, and a flower pot at the foot
  k.box(1.2, 0.06, 0.16, PAL.woodDark, { y: N.y - N.h / 2 - 0.25, z: 0.12 });
  k.box(0.14, 0.04, 0.04, PAL.white, { x: 0.3, y: N.y - N.h / 2 - 0.2, z: 0.12 });
  flowerPot(k, { x: hw + 0.4, z: 0.3 }, o.season, 2);
  k.build(root, o.night);
  const W = 1024, H = Math.round(1024 * (N.h / N.w));
  const c = canvasTex(W, H);
  const mat = new THREE.MeshBasicMaterial({ map: c.tex, color: 0xffffff });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(N.w, N.h), mat);
  face.position.set(0, N.y, 0.05);
  root.add(face);
  let key = '\u0000';
  const board: Board = {
    set(notes) {
      const kk = JSON.stringify(notes);
      if (kk === key) return;
      key = kk;
      drawNotes(c.g, W, H, notes);
      c.tex.needsUpdate = true;
    },
  };
  root.userData.board = board;
  root.userData.rig = { update(e: Env) { const v = 1 - 0.45 * e.night; mat.color.setRGB(v, v * 0.97, v * 0.92); } } satisfies Rig;
  board.set([]);
  return root;
}

// ---------------------------------------------------------------------------------------------
// Wishing well — crank + bucket; "Make a wish" spins the crank and sprinkles a coin sparkle

export const WELL = Object.freeze({ axleY: 2.05, water: 0.25 });

export function buildWell(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'well';
  const k = new Kit(o.seed + 71);
  const R = 1.05;
  // stone ring: two courses of chunky stones
  for (let c = 0; c < 3; c++) {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = ((i + (c % 2) * 0.5) / n) * Math.PI * 2;
      k.box(0.62, 0.3, 0.36, [PAL.stone, 0xa9a294, 0xc4bdb0][(i + c) % 3], { x: Math.sin(a) * R, y: 0.16 + c * 0.29, z: Math.cos(a) * R, ry: a, rz: (k.r() - 0.5) * 0.08 });
    }
  }
  k.cyl(R + 0.16, 0.1, 0xc9c2b4, { y: 0.92 }, 11);
  k.cyl(R - 0.2, 0.06, 0x1f4f6f, { y: WELL.water }, 11);
  k.cyl(R - 0.15, 0.7, 0x3a3430, { y: 0.55 }, 11);
  // posts, roof, axle bearings
  for (const s of [-1, 1]) {
    k.box(0.16, 2.2, 0.16, PAL.woodDark, { x: s * (R + 0.02), y: 1.1 + 0.9 });
    k.box(0.28, 0.16, 0.2, PAL.woodDark, { x: s * (R + 0.02), y: WELL.axleY });
  }
  k.at({ y: 2.95 }, () => gableRoof(k, 2.9, 0.95, 0, 0.8, 0.3, o.season, PAL.roofRed, 0x9e3d2e));
  for (const sx of [-1.12, 1.12]) k.prism([[-0.95, 0], [0.95, 0], [0, 0.8]], 0.1, PAL.woodDark, { y: 2.95, ry: Math.PI / 2, x: sx });
  k.box(2.4, 0.12, 0.12, PAL.woodDark, { y: 2.92 });
  bucket(k, { x: 0.9, y: 0.97, z: 0.55, ry: 0.4 }, true);
  flowerPot(k, { x: -1.4, z: 0.7 }, o.season, 5);
  k.build(root, o.night);

  // crank axle + handle (rotates about x)
  const ck = new Kit(2);
  ck.cyl(0.13, 2.2, PAL.trunk, { rz: Math.PI / 2 }, 8);
  ck.cyl(0.17, 0.3, PAL.woodLight, { rz: Math.PI / 2 }, 8);
  ck.box(0.06, 0.45, 0.06, PAL.metalDark, { x: 1.28, y: 0.2 });
  ck.box(0.3, 0.07, 0.07, PAL.woodDark, { x: 1.42, y: 0.42 });
  const crank = ck.mesh();
  crank.position.set(0, WELL.axleY, 0);
  root.add(crank);
  // rope (scaled) + bucket
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4).translate(0, -0.5, 0), toon(PAL.cloth));
  rope.position.set(0, WELL.axleY - 0.12, 0);
  root.add(rope);
  const bk = new Kit(3);
  bucket(bk, { y: -0.3 });
  bk.rod(-0.17, -0.06, 0, 0, 0.05, 0, 0.012, PAL.metalDark);
  bk.rod(0.17, -0.06, 0, 0, 0.05, 0, 0.012, PAL.metalDark);
  const pail = bk.mesh();
  root.add(pail);
  // coin sparkles
  const SP = 14;
  const sparkle = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.6) }), SP);
  sparkle.frustumCulled = false;
  sparkle.count = 0;
  root.add(sparkle);
  const d = new THREE.Object3D();

  const REST = 1.05; // rope length at rest (bucket just under the axle, above the rim)
  let wishT = 99, ropeLen = REST;
  const rig: Rig = {
    update(e: Env) {
      wishT += e.dt;
      let target = REST, spin = 0;
      if (wishT < 1.4) { target = 1.85; spin = -9; } else if (wishT < 3.2) { target = REST; spin = 6; }
      const prev = ropeLen;
      ropeLen = damp(ropeLen, target, 3, e.dt);
      crank.rotation.x += spin ? (ropeLen - prev) * 12 : Math.sin(e.t * 0.7) * 0.0005;
      const sway = Math.sin(e.t * 1.4) * 0.04 + Math.hypot(e.wind.x, e.wind.z) * 0.01 * Math.sin(e.t * 2.3);
      rope.scale.y = ropeLen;
      rope.rotation.z = sway;
      pail.position.set(Math.sin(sway) * ropeLen, WELL.axleY - 0.12 - Math.cos(sway) * ropeLen, 0);
      pail.rotation.z = sway;
      // sparkles: a burst rising out of the well after the coin drops
      const st = wishT - 0.5;
      if (st > 0 && st < 2.2) {
        sparkle.count = SP;
        for (let i = 0; i < SP; i++) {
          const a = i * 2.4, u = Math.min(1, st / 2.2), rr = 0.2 + u * 0.8 * ((i % 3) + 1) / 3;
          d.position.set(Math.cos(a + st) * rr, 0.7 + u * (1.4 + (i % 4) * 0.25), Math.sin(a + st) * rr);
          d.rotation.set(st * 4 + i, st * 3, 0);
          d.scale.setScalar((1 - u) * (0.8 + Math.sin(st * 20 + i) * 0.4));
          d.updateMatrix();
          sparkle.setMatrixAt(i, d.matrix);
        }
        sparkle.instanceMatrix.needsUpdate = true;
      } else sparkle.count = 0;
    },
    poke(what) { if (what === 'wish') wishT = 0; },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Signpost — arrows to each live field, lettered with the plot names

export interface Arrow { label: string; color: number; /** world yaw of the direction to point (atan2(dx, dz)) */ dir: number; dist: number }
export const SIGNPOST = Object.freeze({ maxArrows: 6 });

export interface Signpost { set(arrows: readonly Arrow[], yaw: number): void }

export function buildSignpost(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'signpost';
  const k = new Kit(o.seed + 81);
  k.cyl(0.35, 0.3, PAL.stone, { y: 0.15 }, 7);
  k.box(0.2, 3.2, 0.2, PAL.woodDark, { y: 1.6 });
  k.cone(0.2, 0.3, PAL.roofRed, { y: 3.35, ry: Math.PI / 4 }, 4);
  k.ball(0.07, PAL.yellow, { y: 3.55 });
  flowerPot(k, { x: 0.45, z: 0.3 }, o.season, 4);
  k.build(root, o.night);

  const ROWS = SIGNPOST.maxArrows + 2; // + title row + wood row
  const RW = 512, RH = 72;
  const c = canvasTex(RW, RH * ROWS);
  const mat = new THREE.MeshToonMaterial({ map: c.tex, gradientMap: (toon() as THREE.MeshToonMaterial).gradientMap, color: 0xffffff, vertexColors: false });
  const arrows = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  arrows.castShadow = true;
  root.add(arrows);
  const g = c.g;
  const woodRow = ROWS - 1;
  const v0 = (row: number) => 1 - (row + 1) / ROWS, v1 = (row: number) => 1 - row / ROWS;

  function paintRows(list: readonly Arrow[]) {
    g.clearRect(0, 0, RW, RH * ROWS);
    // title row: "Claude Valley"
    g.save(); g.translate(0, 0);
    woodPanel(g, RW, RH, '#e9c98f', 5);
    g.fillStyle = '#5a3a22'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, '✿ Claude Valley ✿', RW / 2, RH / 2 + 2, RW - 40, 44, HAND);
    g.restore();
    list.forEach((a, i) => {
      g.save(); g.translate(0, RH * (i + 1));
      woodPanel(g, RW, RH, '#c99a64', 11 + i);
      g.fillStyle = `#${a.color.toString(16).padStart(6, '0')}`;
      g.fillRect(0, 0, 26, RH);
      g.fillStyle = '#3a2414'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = `bold 40px ${FONT}`;
      g.fillText(ellipsize(g, a.label, RW - 150), 40, RH / 2 + 2);
      g.textAlign = 'right'; g.font = `600 28px ${FONT}`; g.fillStyle = '#5a3a22';
      g.fillText(`${Math.round(a.dist)} m`, RW - 58, RH / 2 + 3);
      g.restore();
    });
    g.save(); g.translate(0, RH * woodRow); woodPanel(g, RW, RH, '#b98555', 3); g.restore();
    c.tex.needsUpdate = true;
  }

  /** one board: box with text on ±z faces (row UVs), wood elsewhere; plus a pointed tip */
  function board(row: number, len: number, h: number, withTip: boolean): THREE.BufferGeometry[] {
    const b = new THREE.BoxGeometry(len, h, 0.07).toNonIndexed();
    const uv = b.attributes.uv as THREE.BufferAttribute;
    for (let f = 0; f < 6; f++) {
      const text = f === 4 || f === 5;
      for (let j = 0; j < 6; j++) {
        const i = f * 6 + j;
        const u = uv.getX(i), v = uv.getY(i);
        const r = text ? row : woodRow;
        uv.setXY(i, text ? u : 0.2 + u * 0.1, v0(r) + (v * 0.9 + 0.05) * (v1(r) - v0(r)));
      }
    }
    const parts = [b];
    if (withTip) {
      const tip = new THREE.CylinderGeometry(h * 0.62, h * 0.62, 0.07, 3).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(len / 2 + h * 0.28, 0, 0).toNonIndexed();
      const tu = tip.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < tu.count; i++) tu.setXY(i, 0.25, v0(woodRow) + 0.5 * (v1(woodRow) - v0(woodRow)));
      parts.push(tip);
    }
    return parts;
  }

  let key = '';
  const sign: Signpost = {
    set(list, yaw) {
      const shown = list.slice(0, SIGNPOST.maxArrows);
      const kk = `${yaw.toFixed(3)}|${shown.map((a) => `${a.label}:${a.color}:${a.dir.toFixed(2)}:${Math.round(a.dist)}`).join('|')}`;
      if (kk === key) return;
      key = kk;
      paintRows(shown);
      const geos: THREE.BufferGeometry[] = [];
      const m = new THREE.Matrix4();
      for (const t of board(0, 1.7, 0.32, false)) geos.push(t.applyMatrix4(m.makeTranslation(0, 3.0, 0.14)));
      shown.forEach((a, i) => {
        // +x of the board points along the world direction; the post's yaw is undone
        const dl = a.dir - yaw, th = Math.atan2(-Math.cos(dl), Math.sin(dl));
        const y = 2.6 - i * 0.36;
        const mm = new THREE.Matrix4().makeRotationY(th).multiply(new THREE.Matrix4().makeTranslation(0.78, y, 0));
        // a little tilt so neighbours don't z-fight
        mm.multiply(new THREE.Matrix4().makeRotationZ(((i % 2) - 0.5) * 0.04));
        for (const t of board(i + 1, 1.25, 0.28, true)) geos.push(t.applyMatrix4(mm));
      });
      const merged = mergeUv(geos);
      arrows.geometry.dispose();
      arrows.geometry = merged;
    },
  };
  root.userData.sign = sign;
  root.userData.rig = { update(e: Env) { const v = 1 - 0.4 * e.night; mat.color.setRGB(v, v, v); } } satisfies Rig;
  sign.set([
    { label: 'Wheat field', color: WORKSPACE_COLORS[0], dir: 0.8, dist: 40 },
    { label: 'Orchard', color: WORKSPACE_COLORS[3], dir: -2, dist: 55 },
    { label: 'Pumpkin patch', color: WORKSPACE_COLORS[5], dir: 2.6, dist: 32 },
  ], 0);
  return root;
}

function mergeUv(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Toolshed

export function buildToolshed(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'toolshed';
  const k = new Kit(o.seed + 91);
  const W = 3.2, D = 2.6, Hf = 2.6, Hb = 2.1;
  k.box(W + 0.2, 0.2, D + 0.2, PAL.stone, { y: 0.1 });
  // walls: vertical planks, front taller (mono-pitch roof sloping back)
  k.prism([[-D / 2, 0], [D / 2, 0], [D / 2, Hf], [-D / 2, Hb]], W, 0x8fb0a0, { y: 0.2, ry: -Math.PI / 2 });
  for (const s of [-1, 1]) for (let z = -D / 2 + 0.2; z < D / 2; z += 0.3) k.box(0.03, Hb - 0.1, 0.05, 0x7a9a8a, { x: s * (W / 2 + 0.01), y: 0.2 + (Hb - 0.1) / 2, z });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.14, z > 0 ? Hf : Hb, 0.14, PAL.wallWhite, { x: x * W / 2, y: 0.2 + (z > 0 ? Hf : Hb) / 2, z: z * D / 2 });
  // roof
  {
    const th = Math.atan2(Hf - Hb, D), len = Math.hypot(Hf - Hb, D) + 0.8;
    k.at({ y: 0.2 + Hf + 0.08, z: D / 2 + 0.4, rx: -th }, () => {
      k.box(W + 0.6, 0.14, len, PAL.roofGreen, { z: -len / 2 });
      for (let i = 1; i < 6; i++) k.box(W + 0.62, 0.05, 0.08, 0x4a7a3a, { y: 0.08, z: -i * (len / 6) });
      if (o.season === 'winter') k.box(W + 0.4, 0.1, len - 0.2, PAL.snow, { y: 0.14, z: -len / 2 });
    });
  }
  // front: open door (dark doorway + leaf swung out), window, tools on hooks
  const fz = D / 2 + 0.01;
  k.box(1.0, 1.9, 0.05, 0x2a1d16, { x: -0.6, y: 0.2 + 0.95, z: fz });
  k.box(1.2, 0.12, 0.1, PAL.wallWhite, { x: -0.6, y: 0.2 + 1.95, z: fz + 0.02 });
  k.at({ x: -1.1, y: 0.2, z: fz + 0.04, ry: 1.9 }, () => {
    k.box(1.0, 1.9, 0.07, PAL.wood, { x: 0.5, y: 0.95 });
    k.box(0.9, 0.1, 0.09, PAL.woodDark, { x: 0.5, y: 0.4 });
    k.box(0.9, 0.1, 0.09, PAL.woodDark, { x: 0.5, y: 1.5 });
    k.box(0.1, 1.3, 0.09, PAL.woodDark, { x: 0.5, y: 0.95, rz: 0.6 });
  });
  k.box(0.7, 0.6, 0.05, PAL.windowGlow, { x: 0.85, y: 1.7, z: fz }, 'glow');
  k.box(0.85, 0.08, 0.1, PAL.wallWhite, { x: 0.85, y: 2.04, z: fz + 0.02 });
  k.box(0.85, 0.08, 0.14, PAL.wallWhite, { x: 0.85, y: 1.36, z: fz + 0.03 });
  k.box(0.06, 0.6, 0.08, PAL.wallWhite, { x: 0.85, y: 1.7, z: fz + 0.02 });
  // tools on the front wall: rake, shovel, pitchfork, saw
  k.at({ z: fz + 0.06 }, () => {
    k.box(0.05, 1.4, 0.05, PAL.woodLight, { x: 0.35, y: 0.95, rz: 0.08 });
    k.box(0.35, 0.05, 0.05, PAL.metalDark, { x: 0.3, y: 1.62 });
    for (let i = 0; i < 5; i++) k.box(0.02, 0.1, 0.03, PAL.metalDark, { x: 0.16 + i * 0.075, y: 1.57 });
    k.box(0.05, 1.3, 0.05, PAL.woodLight, { x: 1.3, y: 0.9, rz: -0.05 });
    k.box(0.22, 0.3, 0.03, PAL.metal, { x: 1.28, y: 0.3 });
  });
  // side workbench + things
  k.at({ x: W / 2 + 0.5, z: 0.1, ry: -Math.PI / 2 }, () => {
    k.box(1.6, 0.08, 0.6, PAL.plank, { y: 0.85 });
    for (const [x, z] of [[-0.7, -0.22], [0.7, -0.22], [-0.7, 0.22], [0.7, 0.22]]) k.box(0.08, 0.85, 0.08, PAL.woodDark, { x, y: 0.42, z });
    k.box(1.4, 0.05, 0.5, PAL.woodDark, { y: 0.25 });
    k.box(0.2, 0.15, 0.15, PAL.metalDark, { x: 0.55, y: 0.95 });
    k.box(0.3, 0.1, 0.1, PAL.red, { x: -0.3, y: 0.93, ry: 0.5 });
    k.box(0.04, 0.04, 0.25, PAL.woodLight, { x: -0.3, y: 0.93, z: 0.1, ry: 0.5 });
    flowerPot(k, { x: -0.1, y: 0.89, z: 0.05 }, o.season, 6);
  });
  wateringCan(k, { x: -1.4, z: fz + 0.5, ry: 0.4 }, PAL.blue);
  barrel(k, { x: -W / 2 - 0.5, z: -0.6 });
  crate(k, { x: -W / 2 - 0.5, z: 0.5, ry: 0.2 }, 0.5);
  // wheelbarrow
  k.at({ x: 1.6, z: fz + 1.0, ry: -0.6 }, () => {
    k.box(0.7, 0.3, 0.9, PAL.metal, { y: 0.55 });
    k.box(0.6, 0.05, 0.8, PAL.soil, { y: 0.71 });
    k.cyl(0.2, 0.08, PAL.ink, { y: 0.2, z: 0.55, rz: Math.PI / 2 }, 8);
    k.beam(-0.25, 0.45, 0.45, -0.3, 0.6, -0.9, 0.05, PAL.woodDark);
    k.beam(0.25, 0.45, 0.45, 0.3, 0.6, -0.9, 0.05, PAL.woodDark);
    k.beam(-0.25, 0.45, -0.3, -0.25, 0, -0.35, 0.05, PAL.woodDark);
    k.beam(0.25, 0.45, -0.3, 0.25, 0, -0.35, 0.05, PAL.woodDark);
  });
  k.build(root, o.night);
  return root;
}
