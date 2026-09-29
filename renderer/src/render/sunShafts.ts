/**
 * Sun shafts (RND fix r1, art review: "no golden-hour raking light at 18 h"). Soft light-shaft cards under the sun's
 * apertures: the atrium skylight and the windows the gobo lights this frame (lights.ts pickWindows), slanted along the
 * sun direction the gobo uses (the skylight's elevation-clamped one for the skylight), so each shaft lands on its own
 * gobo patch. Warm and strongest at golden hour (17–19 h), pale and faint in the morning, off by day and at night.
 * Each aperture gets two crossed cards (width × length and height × length) with a soft-edged texture that fades in
 * below the glass and out toward the floor. Additive, depth-tested, no depth write, on the overlay layer.
 * Program budget: the FX `particle` material (VCOL, vertex alpha, map), i.e. the existing particle program (§5.4).
 * One draw call while visible. Medium+ only (Low has no gobo).
 * Owner: RND.
 */
import * as THREE from 'three';
import { getMaterial } from './materials/index.ts';
import { LAYERS } from './layers.ts';
import type { Vec3 } from '../world/layout/schema.ts';

/** A lit aperture the shaft follows (the gobo window pick: lights.ts pickWindows). */
export interface Aperture {
  center: Vec3;
  /** unit, pointing into the room */
  normal: Vec3;
  w: number;
  h: number;
  /** the aperture's room rect [x0, z0, x1, z1] (the shaft stops at its walls) */
  clip?: readonly number[];
  /** the atrium skylight */
  sky?: boolean;
}

export interface SunShaftUpdate {
  /** the gobo's lit apertures */
  windows: readonly Aperture[];
  sunDir: readonly number[];
  skyDir: readonly number[];
  /** look weights */
  evening: number;
  morning: number;
  on: boolean;
}

const MAX_APERTURES = 9; // skylight + ≤ 8 gobo windows
const CARDS = 2;
const EVE = { col: new THREE.Color('#FFC27E'), alpha: 0.32 };
const MORN = { col: new THREE.Color('#EEF1EC'), alpha: 0.12 };
/** Shaft length cap (m) and the clip margin at the aperture's room edge. */
const MAX_LEN = 10;

/** Soft shaft texture: u = across (soft both edges), v = along (0 at the glass → 1 at the far end). */
function shaftTexture(): THREE.DataTexture {
  const W = 32, H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    // fade in slowly under the glass (the Big Board and beams hang there: a bright card end would cut a hard line
    // across them), full through the middle of the room, dimmer and soft toward the floor
    const s = Math.min(1, v / 0.4), fadeIn = s * s * (3 - 2 * s);
    const along = fadeIn * (1 - 0.55 * v) * Math.min(1, (1 - v) / 0.12);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const across = Math.pow(Math.sin(Math.PI * u), 1.6);
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * across * along);
    }
  }
  const t = new THREE.DataTexture(data, W, H);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * Distance along `d` from `p` until the xz point leaves the clip rect [x0, z0, x1, z1] (∞ if it never does).
 */
export function exitDistance(p: THREE.Vector3, d: THREE.Vector3, clip: readonly number[]): number {
  let t = Infinity;
  const [x0, z0, x1, z1] = [Math.min(clip[0], clip[2]), Math.min(clip[1], clip[3]), Math.max(clip[0], clip[2]), Math.max(clip[1], clip[3])];
  if (d.x > 1e-6) t = Math.min(t, (x1 - p.x) / d.x); else if (d.x < -1e-6) t = Math.min(t, (x0 - p.x) / d.x);
  if (d.z > 1e-6) t = Math.min(t, (z1 - p.z) / d.z); else if (d.z < -1e-6) t = Math.min(t, (z0 - p.z) / d.z);
  return Math.max(0, t);
}

export function createSunShafts(scene: THREE.Scene) {
  const n = MAX_APERTURES * CARDS;
  const pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2), col = new Float32Array(n * 4 * 4);
  const index = new Uint16Array(n * 6);
  for (let i = 0; i < n; i++) {
    const v = i * 4, o = i * 6;
    index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2; index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4)); // rgba: the particle program has vertex alpha
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  const mat = getMaterial('particle', { vertexColors: true, emissiveIntensity: 1, uniforms: {} }) as THREE.MeshBasicMaterial; // 'particle' is built as a MeshBasicMaterial
  mat.map = shaftTexture();
  // additive light, and the world mask (alpha) is kept: the shaft is light in the air, AO / edge under it are unchanged
  Object.assign(mat, { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'hq:sunShafts';
  mesh.layers.set(LAYERS.OVERLAY);
  mesh.renderOrder = 9;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  scene.add(mesh);

  const c = new THREE.Vector3(), d = new THREE.Vector3(), T = new THREE.Vector3(), V = new THREE.Vector3(), tmp = new THREE.Vector3();
  const rgba = [0, 0, 0, 0];
  let key = '';
  let cards = 0;
  const quad = (a: THREE.Vector3, b: THREE.Vector3, e: THREE.Vector3, l: number) => { // a = start centre, b = half-extent vector across, e = axis dir, l = length
    const i = cards++;
    const p = i * 12;
    pos[p] = a.x - b.x; pos[p + 1] = a.y - b.y; pos[p + 2] = a.z - b.z;
    pos[p + 3] = a.x + b.x; pos[p + 4] = a.y + b.y; pos[p + 5] = a.z + b.z;
    pos[p + 6] = a.x + b.x + e.x * l; pos[p + 7] = a.y + b.y + e.y * l; pos[p + 8] = a.z + b.z + e.z * l;
    pos[p + 9] = a.x - b.x + e.x * l; pos[p + 10] = a.y - b.y + e.y * l; pos[p + 11] = a.z - b.z + e.z * l;
    for (let k = 0; k < 4; k++) col.set(rgba, i * 16 + k * 4);
  };

  return {
    mesh,
    update({ windows, sunDir, skyDir, evening, morning, on }: SunShaftUpdate) {
      const k = Math.min(1, evening + morning);
      const alpha = EVE.alpha * evening + MORN.alpha * morning;
      if (!on || k < 0.02 || alpha < 0.005 || !windows.length) { mesh.visible = false; return; }
      const r = (EVE.col.r * evening + MORN.col.r * morning) / k, g = (EVE.col.g * evening + MORN.col.g * morning) / k, b = (EVE.col.b * evening + MORN.col.b * morning) / k;
      const nk = `${windows.map((w) => `${w.center.x},${w.center.z}`).join('|')}|${sunDir.map((v) => v.toFixed(3)).join(',')}|${alpha.toFixed(3)}|${r.toFixed(2)}`;
      mesh.visible = true;
      if (nk === key) return;
      key = nk;
      rgba[0] = r; rgba[1] = g; rgba[2] = b;
      cards = 0;
      for (const w of windows.slice(0, MAX_APERTURES)) {
        const sd = w.sky ? skyDir : sunDir;
        d.set(-sd[0], -sd[1], -sd[2]); // into the room, downward
        if (d.y > -0.02) continue;
        c.set(w.center.x, w.center.y, w.center.z);
        // length: to the floor (y 0) or out of the aperture's room, whichever is first
        const len = Math.min(MAX_LEN, c.y / -d.y, w.clip ? exitDistance(c, d, w.clip) : MAX_LEN);
        if (len < 0.3) continue;
        // skylight panes are big and the shaft reads from far: a touch stronger; windows fade with their size
        rgba[3] = alpha * (w.sky ? 1 : 0.85);
        if (w.sky) { T.set(w.w / 2, 0, 0); V.set(0, 0, w.h / 2); }
        else { T.set(w.normal.z, 0, -w.normal.x).normalize().multiplyScalar(w.w / 2); V.set(0, w.h / 2, 0); }
        quad(c, T, d, len);
        quad(c, V, d, len);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.setDrawRange(0, cards * 6);
      geo.computeBoundingSphere();
      tmp.set(0, 0, 0);
    },
    dispose() { scene.remove(mesh); geo.dispose(); mat.map?.dispose(); },
  };
}
