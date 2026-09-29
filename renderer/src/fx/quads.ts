/**
 * Dynamic quad batch: one BufferGeometry of up to `max` textured quads (position, uv, rgba vertex colour), rewritten
 * each frame and drawn in ONE call with a `sprite`/`particle` overlay material (§5.4: one program each; the RGBA
 * colour attribute is the per-quad tint + alpha, so fades and tints never need a new material or program).
 * Quads are given by centre + half-axis vectors, so the same batch does camera billboards, rotated confetti and flat
 * floor rings. Only the written range is uploaded (`addUpdateRange`).
 * Owner: FX.
 */
import * as THREE from 'three';

/**
 * [FX fix m2-r1] Shared quad staging record for the hot callers: write cx cy cz rx ry rz ux uy uz u0 v0 u1 v1 r g b a
 * into QV[0..16], then `batch.pushQ()`. `push(…17 floats)` is not inlined into the big per-frame loops, and a
 * non-inlined call boxes every float argument (≈ 200 B of heap numbers per quad: most of FX's per-frame garbage at
 * crowd40); typed-array stores allocate nothing.
 */
export const QV = new Float64Array(17);
/** Stage one quad into QV (for cold paths / tests; hot loops write QV directly). */
export function stage(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number) {
  QV[0] = cx; QV[1] = cy; QV[2] = cz; QV[3] = rx; QV[4] = ry; QV[5] = rz; QV[6] = ux; QV[7] = uy; QV[8] = uz;
  QV[9] = u0; QV[10] = v0; QV[11] = u1; QV[12] = v1; QV[13] = r; QV[14] = g; QV[15] = b; QV[16] = a;
}

export function createQuadBatch(material: THREE.Material, max: number, { name = 'fx:quads', renderOrder = 0 }: { name?: string; renderOrder?: number } = {}) {
  const pos = new Float32Array(max * 12);
  const uv = new Float32Array(max * 8);
  const col = new Float32Array(max * 16);
  const index = new (max * 4 > 65535 ? Uint32Array : Uint16Array)(max * 6);
  for (let i = 0; i < max; i++) {
    const v = i * 4, o = i * 6;
    index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2;
    index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
  }
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aUv = new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('uv', aUv);
  geo.setAttribute('color', aCol);
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.frustumCulled = false; // world-space vertices, rewritten every frame
  mesh.renderOrder = renderOrder;
  mesh.matrixAutoUpdate = false;

  let n = 0;
  return {
    mesh,
    get count() { return n; },
    max,
    begin() { n = 0; },
    /**
     * Push one quad. Corners: c − r − u (uv u0,v1), c + r − u (u1,v1), c + r + u (u1,v0), c − r + u (u0,v0).
     * Returns false when full.
     */
    push(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number): boolean {
      if (n >= max) return false;
      let p = n * 12;
      pos[p++] = cx - rx - ux; pos[p++] = cy - ry - uy; pos[p++] = cz - rz - uz;
      pos[p++] = cx + rx - ux; pos[p++] = cy + ry - uy; pos[p++] = cz + rz - uz;
      pos[p++] = cx + rx + ux; pos[p++] = cy + ry + uy; pos[p++] = cz + rz + uz;
      pos[p++] = cx - rx + ux; pos[p++] = cy - ry + uy; pos[p] = cz - rz + uz;
      let q = n * 8;
      uv[q++] = u0; uv[q++] = v1; uv[q++] = u1; uv[q++] = v1; uv[q++] = u1; uv[q++] = v0; uv[q++] = u0; uv[q] = v0;
      let c = n * 16;
      // premultiplied: the atlas is uploaded premultiplied and the materials blend (One, OneMinusSrcAlpha)
      const pr = r * a, pg = g * a, pb = b * a;
      for (let k = 0; k < 4; k++) { col[c++] = pr; col[c++] = pg; col[c++] = pb; col[c++] = a; }
      n++;
      return true;
    },
    /** Push the quad staged in QV (see QV). Returns false when full. */
    pushQ(): boolean {
      if (n >= max) return false;
      const cx = QV[0], cy = QV[1], cz = QV[2], rx = QV[3], ry = QV[4], rz = QV[5], ux = QV[6], uy = QV[7], uz = QV[8];
      let p = n * 12;
      pos[p++] = cx - rx - ux; pos[p++] = cy - ry - uy; pos[p++] = cz - rz - uz;
      pos[p++] = cx + rx - ux; pos[p++] = cy + ry - uy; pos[p++] = cz + rz - uz;
      pos[p++] = cx + rx + ux; pos[p++] = cy + ry + uy; pos[p++] = cz + rz + uz;
      pos[p++] = cx - rx + ux; pos[p++] = cy - ry + uy; pos[p] = cz - rz + uz;
      let q = n * 8;
      const u0 = QV[9], v0 = QV[10], u1 = QV[11], v1 = QV[12];
      uv[q++] = u0; uv[q++] = v1; uv[q++] = u1; uv[q++] = v1; uv[q++] = u1; uv[q++] = v0; uv[q++] = u0; uv[q] = v0;
      let c = n * 16;
      const a = QV[16], pr = QV[13] * a, pg = QV[14] * a, pb = QV[15] * a;
      for (let k = 0; k < 4; k++) { col[c++] = pr; col[c++] = pg; col[c++] = pb; col[c++] = a; }
      n++;
      return true;
    },
    end() {
      geo.setDrawRange(0, n * 6);
      mesh.visible = n > 0;
      if (!n) return;
      aPos.clearUpdateRanges(); aPos.addUpdateRange(0, n * 12); aPos.needsUpdate = true;
      aUv.clearUpdateRanges(); aUv.addUpdateRange(0, n * 8); aUv.needsUpdate = true;
      aCol.clearUpdateRanges(); aCol.addUpdateRange(0, n * 16); aCol.needsUpdate = true;
    },
    dispose() { geo.dispose(); },
  };
}

export type QuadBatch = ReturnType<typeof createQuadBatch>;
