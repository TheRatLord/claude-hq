/**
 * Smooth low-poly sculpting (animals, pets, critters): one continuous hull lofted through cross-section rings along a spine,
 * instead of a heap of overlapping balls. Rings are Catmull-Rom interpolated (so a handful of authored sections give
 * a soft profile), each ring is a superellipse (e 2 = ellipse, higher = boxier) with separate upper / lower radii,
 * normals are smooth across the hull (clean cel bands) while the silhouette keeps its low-poly facets, and colour is
 * painted per face from a callback so markings (muzzle, belly, wing tips) have crisp low-poly edges on one mesh.
 *
 * The output is non-indexed, painted and carries normals; `rigMerge` keeps per-part normals, so lofts stay smooth
 * next to flat-shaded accents. A per-face coat mask (`coat` option) is stored for `tag` (rig.ts).
 */
import * as THREE from 'three';
type V3 = readonly [number, number, number];

export interface Ring {
  /** centre on the spine */
  p: V3;
  /** radius: round | [side, vertical] | [side, up, down] */
  r: number | readonly [number, number] | readonly [number, number, number];
  /** superellipse exponent (2 ellipse, 3+ boxier, < 2 pinched) */
  e?: number;
  /** up hint for the ring frame (default +y, or +z when the spine runs vertically) */
  up?: V3;
}

export interface Face {
  /** centroid (model space) */
  x: number; y: number; z: number;
  /** face normal */
  nx: number; ny: number; nz: number;
  /** 0..1 along the spine (caps: 0 / 1) */
  t: number;
  /** angle around the spine: 0 = side (+x frame axis), π/2 = up */
  a: number;
}

export interface LoftOpts {
  /** vertices around (default 12) */
  sides?: number;
  /** interpolated steps per authored segment (default 3) */
  sub?: number;
  /** end caps: 'pole' (rounded point), 'flat' (a disc: snouts), 'open' */
  caps?: readonly ['pole' | 'flat' | 'open', 'pole' | 'flat' | 'open'];
  /** pole cap bulge as a fraction of the end ring's radius (default 0.55) */
  round?: number;
  /** colour per face */
  paint: number | ((f: Face) => number);
  /** evaluate `paint` per vertex instead of per face (soft gradients: pig pinks, chick fluff) */
  blend?: boolean;
  /** coat mask per face (1 = takes the coat tint / pattern); default: none (tag decides) */
  coat?: (f: Face) => number;
  /** radius multiplier around / along the hull (wool scallops, feather tips) */
  bump?: (a: number, t: number) => number;
  /** rotate the ring start so a vertex (not an edge) sits on top (default true) */
  phase?: number;
}

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

interface R { p: THREE.Vector3; rx: number; ru: number; rd: number; e: number; up: V3 | undefined }

function norm(r: Ring): R {
  const [rx, ru, rd] = typeof r.r === 'number' ? [r.r, r.r, r.r] : r.r.length === 2 ? [r.r[0], r.r[1], r.r[1]] : [r.r[0], r.r[1], r.r[2]];
  return { p: new THREE.Vector3(...r.p), rx, ru, rd, e: r.e ?? 2, up: r.up };
}

/** subdivide the authored rings with Catmull-Rom on every parameter */
function resample(rs: R[], sub: number): R[] {
  if (rs.length < 2 || sub <= 1) return rs;
  const out: R[] = [];
  const at = (i: number) => rs[Math.max(0, Math.min(rs.length - 1, i))];
  for (let i = 0; i < rs.length - 1; i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      out.push({
        p: new THREE.Vector3(cr(a.p.x, b.p.x, c.p.x, d.p.x, t), cr(a.p.y, b.p.y, c.p.y, d.p.y, t), cr(a.p.z, b.p.z, c.p.z, d.p.z, t)),
        rx: Math.max(1e-4, cr(a.rx, b.rx, c.rx, d.rx, t)), ru: Math.max(1e-4, cr(a.ru, b.ru, c.ru, d.ru, t)),
        rd: Math.max(1e-4, cr(a.rd, b.rd, c.rd, d.rd, t)), e: cr(a.e, b.e, c.e, d.e, t), up: b.up,
      });
    }
  }
  out.push(rs[rs.length - 1]);
  return out;
}

const spow = (v: number, k: number) => Math.sign(v) * Math.pow(Math.abs(v), k);

/** Loft a smooth closed hull through `rings` (≥ 2, ordered tail → head or root → tip). */
export function loft(rings: readonly Ring[], o: LoftOpts): THREE.BufferGeometry {
  const N = o.sides ?? 12;
  const rs = resample(rings.map(norm), o.sub ?? 3);
  const M = rs.length;
  const caps = o.caps ?? ['pole', 'pole'];
  const phase = o.phase ?? Math.PI / 2;
  const pos: number[] = [], ts: number[] = [], as: number[] = [];
  const T = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), U = new THREE.Vector3();
  const frames: { t: THREE.Vector3; c: THREE.Vector3; r: number }[] = [];
  for (let i = 0; i < M; i++) {
    const r = rs[i];
    T.copy(rs[Math.min(M - 1, i + 1)].p).sub(rs[Math.max(0, i - 1)].p).normalize();
    if (r.up) U.set(...r.up); else if (Math.abs(T.y) > 0.85) U.set(0, 0, T.y < 0 ? 1 : -1); else U.set(0, 1, 0);
    X.crossVectors(U, T).normalize();
    Y.crossVectors(T, X).normalize();
    const k = 2 / Math.max(0.5, r.e);
    for (let j = 0; j < N; j++) {
      const a = phase + (j / N) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const b = o.bump ? o.bump(a - phase + Math.PI / 2, i / (M - 1)) : 1;
      const lx = spow(c, k) * r.rx * b, ly = spow(s, k) * (s >= 0 ? r.ru : r.rd) * b;
      pos.push(r.p.x + X.x * lx + Y.x * ly, r.p.y + X.y * lx + Y.y * ly, r.p.z + X.z * lx + Y.z * ly);
      ts.push(i / (M - 1)); as.push(a - phase + Math.PI / 2);
    }
    frames.push({ t: T.clone(), c: r.p.clone(), r: (r.rx + (r.ru + r.rd) / 2) / 2 });
  }
  const idx: number[] = [];
  for (let i = 0; i < M - 1; i++) for (let j = 0; j < N; j++) {
    const a = i * N + j, b = i * N + (j + 1) % N, c = (i + 1) * N + j, d = (i + 1) * N + (j + 1) % N;
    idx.push(a, b, c, b, d, c);
  }
  // pole caps share the ring vertices (smooth); flat caps get their own (crisp disc)
  const flat: { centre: THREE.Vector3; ring: number; out: THREE.Vector3; t: number }[] = [];
  for (const end of [0, 1] as const) {
    const kind = caps[end];
    if (kind === 'open') continue;
    const f = frames[end ? M - 1 : 0];
    const out = f.t.clone().multiplyScalar(end ? 1 : -1);
    if (kind === 'flat') { flat.push({ centre: f.c.clone(), ring: end ? M - 1 : 0, out, t: end }); continue; }
    const pole = pos.length / 3;
    const tip = f.c.clone().addScaledVector(out, f.r * (o.round ?? 0.55));
    pos.push(tip.x, tip.y, tip.z); ts.push(end); as.push(0);
    const base = (end ? M - 1 : 0) * N;
    for (let j = 0; j < N; j++) {
      const a = base + j, b = base + (j + 1) % N;
      if (end) idx.push(a, b, pole); else idx.push(b, a, pole);
    }
  }
  const ig = new THREE.BufferGeometry();
  ig.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ig.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  ig.setAttribute('aA', new THREE.Float32BufferAttribute(as, 1));
  ig.setIndex(idx);
  ig.computeVertexNormals();
  let g = ig.toNonIndexed();
  if (flat.length) {
    const fp: number[] = [], fn: number[] = [], ft: number[] = [];
    for (const f of flat) {
      const base = f.ring * N;
      for (let j = 0; j < N; j++) {
        const a = base + j, b = base + (j + 1) % N;
        const [p, q] = f.t ? [a, b] : [b, a];
        fp.push(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2], pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2], f.centre.x, f.centre.y, f.centre.z);
        for (let k = 0; k < 3; k++) { fn.push(f.out.x, f.out.y, f.out.z); ft.push(f.t); }
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    cg.setAttribute('normal', new THREE.Float32BufferAttribute(fn, 3));
    cg.setAttribute('aT', new THREE.Float32BufferAttribute(ft, 1));
    cg.setAttribute('aA', new THREE.Float32BufferAttribute(new Array(ft.length).fill(0), 1));
    g = concat(g, cg);
  }
  paintFaces(g, o.paint, o.coat, o.blend ?? false, (Math.PI * 2) / N, 1 / (M - 1));
  g.deleteAttribute('aT');
  g.deleteAttribute('aA');
  return g;
}

function concat(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(a.attributes)) {
    const x = a.attributes[k], y = b.attributes[k];
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array); arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(k, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return out;
}

const _c = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * paint each triangle one colour from its centroid / normal (and store a per-face coat mask for `tag`). `t` and `a`
 * are snapped to the centre of the quad a triangle belongs to, so both halves of a quad always agree and region
 * boundaries drawn with them follow the hull's edges.
 */
function paintFaces(g: THREE.BufferGeometry, paint: LoftOpts['paint'], coat: LoftOpts['coat'] | undefined, blend: boolean, stepA: number, stepT: number): void {
  const p = g.attributes.position, ta = g.attributes.aT, aa = g.attributes.aA, nn = g.attributes.normal;
  const n = p.count;
  const col = new Float32Array(n * 3), cm = coat ? new Float32Array(n) : null;
  const f: Face = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0, a: 0 };
  for (let i = 0; i < n; i += 3) {
    f.x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    f.y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    f.z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    _a.fromBufferAttribute(p, i); _b.fromBufferAttribute(p, i + 1); _d.fromBufferAttribute(p, i + 2);
    _b.sub(_a); _d.sub(_a); _b.cross(_d).normalize();
    f.nx = _b.x; f.ny = _b.y; f.nz = _b.z;
    const t = (ta.getX(i) + ta.getX(i + 1) + ta.getX(i + 2)) / 3;
    f.t = t <= 0 || t >= 1 ? t : Math.min(1, (Math.floor(t / stepT + 1e-4) + 0.5) * stepT);
    // circular mean of the three corner angles (unwrapped against the first), snapped to the quad
    const a0 = aa.getX(i);
    let am = a0;
    for (const j of [1, 2]) { let d = aa.getX(i + j) - a0; if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; am += d / 3; }
    f.a = Math.PI / 2 + (Math.floor((am - Math.PI / 2) / stepA + 1e-4) + 0.5) * stepA;
    _c.set(typeof paint === 'number' ? paint : paint(f));
    const k = cm ? coat!(f) : 0;
    for (let j = i; j < i + 3; j++) {
      if (blend && typeof paint !== 'number') {
        const v: Face = { x: p.getX(j), y: p.getY(j), z: p.getZ(j), nx: nn.getX(j), ny: nn.getY(j), nz: nn.getZ(j), t: ta.getX(j), a: aa.getX(j) };
        _c.set(paint(v));
      }
      col[j * 3] = _c.r; col[j * 3 + 1] = _c.g; col[j * 3 + 2] = _c.b;
      if (cm) cm[j] = k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (cm) g.userData.coat = cm;
}

/** A smooth ellipsoid hull (a loft along z), centred at `c` with radii [x, y, z]. */
export function blob(c: V3, r: V3, o: LoftOpts & { rings?: number; e?: number; tilt?: number }): THREE.BufferGeometry {
  const K = o.rings ?? 5;
  const rings: Ring[] = [];
  const tilt = o.tilt ?? 0, ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let i = 0; i <= K; i++) {
    const u = -0.92 + (1.84 * i) / K;
    const w = Math.sqrt(Math.max(0.02, 1 - u * u));
    // spine tilted about x (positive tilt raises the front)
    const dz = u * r[2];
    rings.push({ p: [c[0], c[1] + dz * st, c[2] + dz * ct], r: [r[0] * w, r[1] * w], e: o.e });
  }
  return loft(rings, { sub: 2, ...o });
}

/** Mix two hex colours. */
export const mixHex = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
