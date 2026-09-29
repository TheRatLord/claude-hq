/**
 * Stats building blocks (§7.4): canvas readout panels (≤ 2 Hz, only on change) and a clay-part builder that merges a
 * stat object's static geometry into one vertex-coloured mesh (one draw, the shared toonProp INSTANCED+VCOL program).
 * Materials only through `getMaterial` (§5.4). Owner: STAT.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial } from '../../render/materials/index.ts';

export const MIN_REDRAW_S = 0.5; // ≤ 2 Hz (GP §4)

/** Paints a panel's canvas (`W` × `H` px). */
export type DrawFn = (g: CanvasRenderingContext2D, W: number, H: number) => void;
/** A panel redraws only when its key changes (a joined string of everything the readout shows). */
export type PanelKey = string | number;

/** What every panel (own mesh or a band of a `createPanelSet`) offers. */
export interface PanelBase {
  g: CanvasRenderingContext2D;
  W: number;
  H: number;
  redraws: number;
  /** Draw `fn(g, W, H)` if `k` differs from the last drawn key and ≥ 0.5 s passed (else it is deferred). */
  draw(k: PanelKey, fn: DrawFn, now: number): boolean;
  /** Flush a deferred draw once its time comes (call every frame; cheap). */
  tick(now: number): void;
  dispose(): void;
}
export interface Panel extends PanelBase {
  mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  /** Change the emissive gain (pulse on critical). */
  setGain(v: number): void;
}
/** A band of a panel set: the `createPanel` API without an own mesh. */
export interface PanelBand extends PanelBase { mesh: null }

/** A canvas we just created always has a 2d context. */
export function canvas2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas context unavailable');
  return g;
}

/** `getMaterial('screen')` is typed to the base class; that kind is always a MeshBasicMaterial (render/materials/screen.ts). */
export const screenMat = (opts: Parameters<typeof getMaterial>[1]): THREE.MeshBasicMaterial => getMaterial('screen', opts) as THREE.MeshBasicMaterial;
/** The gain uniform every 'screen' material carries. */
export const setIntensity = (mat: THREE.Material, v: number) => { mat.userData.uniforms.uIntensity.value = v; };

/** Unlit readout body intensity: ≤ 0.95 (never blooms, §5.0). */
export const PANEL_GAIN = 0.92;

/**
 * A canvas-textured quad (unlit 'screen' material, its own texture). Redraws only when `key` changes, ≤ 2 Hz.
 * `o.w` / `o.h` are metres, `o.px` / `o.py` the canvas size.
 */
export function createPanel(o: { w: number; h: number; px: number; py?: number; gain?: number; name?: string; double?: boolean }): Panel {
  const py = o.py ?? Math.round(o.px * o.h / o.w);
  const canvas = document.createElement('canvas');
  canvas.width = o.px; canvas.height = py;
  const g = canvas2d(canvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  // uniforms:{} → a material of its own (own map), same 'screen' program as every other panel
  const mat = screenMat({ color: '#FFFFFF', emissive: o.gain ?? PANEL_GAIN, strip: null, instanced: true, uniforms: {} });
  mat.map = tex;
  if (o.double) mat.side = THREE.DoubleSide;
  const mesh = one(new THREE.PlaneGeometry(o.w, o.h), mat);
  mesh.name = o.name ?? 'stat:panel';
  let key: PanelKey | null = null, last = -Infinity, pending: { k: PanelKey; fn: DrawFn } | null = null;
  const api: Panel = {
    mesh, canvas, g, W: o.px, H: py, tex, redraws: 0,
    draw(k, fn, now) {
      if (k === key) { pending = null; return false; }
      if (now - last < MIN_REDRAW_S) { pending = { k, fn }; return false; }
      key = k; last = now; pending = null;
      g.save(); fn(g, api.W, api.H); g.restore();
      tex.needsUpdate = true;
      api.redraws++;
      return true;
    },
    tick(now) { if (pending && now - last >= MIN_REDRAW_S) api.draw(pending.k, pending.fn, now); },
    setGain(v) { setIntensity(mat, v); },
    dispose() { tex.dispose(); mat.dispose(); mesh.geometry.dispose(); },
  };
  return api;
}

/**
 * Several static readout panels of one object in ONE draw: their canvases are stacked in one shared canvas (4 px
 * gutters) and their quads, placed by `pos`/`rot` in the parent's local frame, are merged into one mesh whose UVs point
 * at each panel's band. Each returned panel has the `createPanel` API (`draw` / `tick` / `W` / `H`, ≤ 2 Hz each, only
 * on change) but no own mesh; a draw is clipped to its band and uploads the shared texture once.
 * A spec `{geo, color}` instead merges a glowing solid (bulbs, lamp lenses…) that samples a 16 px swatch band of that
 * colour (no panel returned for it), so small unlit bits ride in the same draw. A spec with `same: k` (k = an earlier
 * spec's index) is another quad showing spec k's band (no new canvas rows, no panel returned).
 */
export interface PanelQuad { w: number; h: number; px: number; py?: number; pos?: number[]; rot?: number[]; circle?: boolean; same?: undefined; geo?: undefined }
/** Another quad of the same band as spec `same`. */
export interface PanelAlias { same: number; w: number; h: number; px?: number; pos?: number[]; rot?: number[]; circle?: boolean; geo?: undefined }
export interface PanelGlow { geo: THREE.BufferGeometry; color: string; same?: undefined }
export type PanelSpec = PanelQuad | PanelAlias | PanelGlow;
export interface PanelSet {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  panels: PanelBand[];
  readonly redraws: number;
  setGain(v: number): void;
  dispose(): void;
}

export function createPanelSet(specs: PanelSpec[], o: { name?: string; gain?: number; double?: boolean } = {}): PanelSet {
  const GUT = 4;
  const CW = Math.max(...specs.map((s) => (s.geo ? undefined : s.px) ?? 8));
  let y = 0;
  interface Band { y0: number; W: number; H: number; swatch: string | null; alias?: boolean }
  const bands: Band[] = [];
  const own = specs.map((s): Band | null => {
    if (s.same != null) return null; // shares an earlier spec's band (resolved below)
    const py = s.geo ? 16 : s.py ?? Math.round(s.px * s.h / s.w);
    const b = { y0: y, W: s.geo ? CW : s.px, H: py, swatch: s.geo ? s.color : null };
    y += py + GUT;
    return b;
  });
  specs.forEach((s, i) => {
    const b = own[i];
    if (b) bands[i] = b;
    else if (s.same != null) bands[i] = { ...bands[s.same], alias: true };
  });
  const CH = y - GUT;
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  const g = canvas2d(canvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = screenMat({ color: '#FFFFFF', emissive: o.gain ?? PANEL_GAIN, strip: null, instanced: true, uniforms: {} });
  mat.map = tex;
  if (o.double) mat.side = THREE.DoubleSide;
  for (const b of bands) if (b.swatch) { g.fillStyle = b.swatch; g.fillRect(0, b.y0, CW, b.H); }
  const geos = specs.map((s, i) => {
    const b = bands[i];
    if (s.geo) {
      const q = s.geo.index ? s.geo.toNonIndexed() : s.geo.clone();
      for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') q.deleteAttribute(k);
      const n = q.getAttribute('position').count;
      const uv = new Float32Array(n * 2).fill(0);
      const v = 1 - (b.y0 + b.H / 2) / CH;
      for (let k = 0; k < n; k++) { uv[k * 2] = 0.5; uv[k * 2 + 1] = v; }
      q.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      if (!q.getAttribute('normal')) q.computeVertexNormals();
      return q;
    }
    const q = s.circle ? new THREE.CircleGeometry(s.w / 2, 48) : new THREE.PlaneGeometry(s.w, s.h); // circle uvs span the unit square too
    const uv = q.getAttribute('uv');
    const u1 = b.W / CW, v0 = 1 - (b.y0 + b.H) / CH, v1 = 1 - b.y0 / CH;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * u1, v0 + uv.getY(k) * (v1 - v0));
    const r = s.rot ?? [0, 0, 0], p = s.pos ?? [0, 0, 0];
    _e.set(r[0], r[1], r[2], 'XYZ');
    q.applyMatrix4(_m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e), _s.set(1, 1, 1)));
    const flat = q.toNonIndexed();
    q.dispose();
    return flat;
  });
  const geo = mergeGeometries(geos, false);
  for (const q of geos) q.dispose();
  geo.computeBoundingSphere();
  const mesh = one(geo, mat);
  mesh.name = o.name ?? 'stat:panels';
  mesh.computeBoundingSphere?.();
  const panels: PanelBand[] = [];
  const set: PanelSet = {
    mesh, canvas, tex,
    panels,
    get redraws() { return panels.reduce((n, p) => n + p.redraws, 0); },
    setGain(v) { setIntensity(mat, v); },
    dispose() { tex.dispose(); mat.dispose(); geo.dispose(); },
  };
  for (const b of bands) {
    if (b.swatch || b.alias) continue;
    let key: PanelKey | null = null, last = -Infinity, pending: { k: PanelKey; fn: DrawFn } | null = null;
    const api: PanelBand = {
      mesh: null, g, W: b.W, H: b.H, redraws: 0,
      draw(k, fn, now) {
        if (k === key) { pending = null; return false; }
        if (now - last < MIN_REDRAW_S) { pending = { k, fn }; return false; }
        key = k; last = now; pending = null;
        g.save();
        g.translate(0, b.y0);
        g.beginPath(); g.rect(0, 0, b.W, b.H); g.clip();
        g.clearRect(0, 0, b.W, b.H);
        fn(g, b.W, b.H);
        g.restore();
        tex.needsUpdate = true;
        api.redraws++;
        return true;
      },
      tick(now) { if (pending && now - last >= MIN_REDRAW_S) api.draw(pending.k, pending.fn, now); },
      dispose() {},
    };
    panels.push(api);
  }
  return set;
}

/** Rounded-rect path helper for panel drawing. */
export function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export const FONT_UI = 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Ubuntu", "Cantarell", "DejaVu Sans", system-ui, sans-serif';
export const FONT_MONO = 'ui-monospace, "JetBrains Mono", "Cascadia Code", "SF Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace';

/** Unlit flat-colour material (LED dots, needles' tips, glowing liquid) — one 'screen' program for all. */
export function glowMaterial(color: string, gain = 0.92): THREE.MeshBasicMaterial {
  return screenMat({ color, emissive: gain, strip: null, instanced: true });
}

const WHITE_C = new THREE.Color(1, 1, 1);
/**
 * Program hygiene (§5.4 matrix): every stats mesh is an InstancedMesh with instance colours, so it shares the
 * programs the kit / signs / FX already compile (toonProp INSTANCED(+VCOL) with instance colour, screen INSTANCED)
 * instead of adding non-instanced variants. Instance colours default to white (for 'screen' white = no status strip).
 */
export function one<G extends THREE.BufferGeometry, M extends THREE.Material>(geo: G, mat: M, count = 1): THREE.InstancedMesh<G, M> {
  const m = new THREE.InstancedMesh<G, M>(geo, mat, count);
  const I = new THREE.Matrix4();
  for (let i = 0; i < count; i++) { m.setMatrixAt(i, I); m.setColorAt(i, WHITE_C); }
  return m;
}
/** Give an InstancedMesh white instance colours (see `one`). */
export function whiteInstances<M extends THREE.InstancedMesh>(m: M): M {
  for (let i = 0; i < m.count; i++) m.setColorAt(i, WHITE_C);
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return m;
}
/** A glowing unlit shape (count-1 instanced 'screen'). */
export const glowMesh = <G extends THREE.BufferGeometry>(geo: G, color: string, gain = 0.92) => one(geo, glowMaterial(color, gain));
/**
 * Transparent overlay (fog, haze, shimmer, steam, radio rings) with its own material (own map / opacity): the
 * 'sprite' kind, INSTANCED with instance colours, i.e. exactly CHR's glint/stroke program (the FX 'particle' program
 * has no position attribute, so a positioned mesh would compile a second particle variant).
 */
export function overlayMesh<G extends THREE.BufferGeometry>(geo: G, color: string, intensity = 1, count = 1) {
  // the 'sprite' kind is always a MeshBasicMaterial (render/materials/overlay.ts)
  return one(geo, getMaterial('sprite', { color, emissiveIntensity: intensity, instanced: true, uniforms: {} }) as THREE.MeshBasicMaterial, count);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

/** Rotation of a part (Euler YXZ, radians) on top of its position. */
export interface PlaceOpts { rx?: number; ry?: number; rz?: number }
/** The high / low detail geometries a `createParts` mesh keeps on `userData.lod` (swapped by the stats world by distance). */
export interface LodData { hi: THREE.BufferGeometry; lo: THREE.BufferGeometry }
/** Read `userData.lod` (written by `createParts().mesh()` and the instanced drawers / blades); the one place `userData` is typed. */
export const lodOf = (o: THREE.Object3D): LodData | undefined => (o.userData as { lod?: LodData }).lod;
export const setLod = (o: THREE.Object3D, lod: LodData): void => { (o.userData as { lod?: LodData }).lod = lod; };

export interface Parts {
  /** Rounded box (clay bevel r ≈ 12% of the smallest side, capped at 4 cm). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, o?: PlaceOpts & { r?: number }): Parts;
  cyl(x: number, y: number, z: number, rTop: number, rBot: number, h: number, color: string, o?: PlaceOpts & { seg?: number; open?: boolean }): Parts;
  sphere(x: number, y: number, z: number, r: number, color: string, o?: PlaceOpts & { seg?: number; segV?: number }): Parts;
  torus(x: number, y: number, z: number, R: number, r: number, color: string, o?: PlaceOpts & { segR?: number; segT?: number; arc?: number }): Parts;
  geo(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: string, o?: PlaceOpts): Parts;
  readonly count: number;
  /**
   * Merge into one mesh; `mesh.userData.lod = {hi, lo}` (the far geometry, see index.ts). Every caller adds parts first:
   * an empty builder throws (it used to return null, which every caller would have crashed on or logged as a bad add).
   */
  mesh(name?: string, o?: { cast?: boolean }): THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
}

/**
 * Clay part builder: add boxes / cylinders / spheres / tori in local metres, then `mesh()` merges them into one
 * vertex-coloured InstancedMesh (count 1) with the toonProp INSTANCED+VCOL material (§5.4 matrix, no new program).
 */
export function createParts(): Parts {
  // [STAT fix m3 r3 code] every part also gets a low-detail twin (plain boxes, ~⅓ the segments): `mesh()` keeps both
  // on `mesh.userData.lod = {hi, lo}` and the stats world (index.ts) swaps to `lo` beyond LOD_DIST (§5.3 stat ≤ 60k).
  const geos: THREE.BufferGeometry[] = [], lows: THREE.BufferGeometry[] = [];
  const bake = (geo: THREE.BufferGeometry, x: number, y: number, z: number, color: string, o: PlaceOpts) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
    g.applyMatrix4(_m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const push = (geo: THREE.BufferGeometry, x: number, y: number, z: number, color: string, o: PlaceOpts = {}, lo: THREE.BufferGeometry | null = null) => {
    geos.push(bake(geo, x, y, z, color, o));
    lows.push(bake(lo ?? geo.clone(), x, y, z, color, o));
    return api;
  };
  const lowSeg = (n: number, min: number) => Math.max(min, Math.round(n / 3));
  const api: Parts = {
    box(x, y, z, w, h, d, color, o = {}) {
      const r = o.r ?? Math.min(0.04, Math.min(w, h, d) * 0.12);
      const geo = r > 0.004 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
      return push(geo, x, y, z, color, o, new THREE.BoxGeometry(w, h, d));
    },
    cyl(x, y, z, rTop, rBot, h, color, o = {}) {
      const seg = o.seg ?? 20;
      return push(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!o.open), x, y, z, color, o, new THREE.CylinderGeometry(rTop, rBot, h, Math.min(seg, lowSeg(seg, 6)), 1, !!o.open));
    },
    sphere(x, y, z, r, color, o = {}) {
      const seg = o.seg ?? 16, segV = o.segV ?? 10;
      return push(new THREE.SphereGeometry(r, seg, segV), x, y, z, color, o, new THREE.SphereGeometry(r, Math.min(seg, lowSeg(seg, 6)), Math.min(segV, lowSeg(segV, 4))));
    },
    torus(x, y, z, R, r, color, o = {}) {
      const sr = o.segR ?? 8, st = o.segT ?? 32, arc = o.arc ?? Math.PI * 2;
      return push(new THREE.TorusGeometry(R, r, sr, st, arc), x, y, z, color, o, new THREE.TorusGeometry(R, r, Math.min(sr, lowSeg(sr, 4)), Math.min(st, lowSeg(st, 10)), arc));
    },
    geo(geo, x, y, z, color, o = {}) { return push(geo, x, y, z, color, o); },
    get count() { return geos.length; },
    mesh(name = 'stat:parts', { cast = false } = {}) {
      if (!geos.length) throw new Error(`createParts: mesh('${name}') on an empty builder`);
      const g = mergeGeometries(geos, false);
      const lo = mergeGeometries(lows, false);
      for (const q of geos) q.dispose();
      for (const q of lows) q.dispose();
      geos.length = 0; lows.length = 0;
      g.computeBoundingSphere();
      lo.computeBoundingSphere();
      const mesh = one(g, getMaterial('toonProp', { color: '#FFFFFF', instanced: true, vertexColors: true }));
      mesh.name = name;
      mesh.castShadow = cast;
      setLod(mesh, { hi: g, lo });
      // InstancedMesh culls on its own bounding sphere: use the geometry's (instance 0 = identity)
      mesh.computeBoundingSphere?.();
      return mesh;
    },
  };
  return api;
}
