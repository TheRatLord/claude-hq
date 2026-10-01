/**
 * Shooting stars: on a clear night, now and then a bright streak slides down the sky and fades. On the real-world
 * peak nights of the big showers (Perseids around 12 August, Geminids around 14 December, Quadrantids around
 * 3 January) they come every few seconds. One mesh, four vertices per streak, rewritten per frame while any is alive;
 * HDR colour (toneMapped off) so the bloom gives each a soft glow. Pure timing helpers are exported for tests.
 */
import * as THREE from 'three';

const MAX = 6;
/** distance from the camera (inside the far plane, beyond every mountain) */
const R = 380;

/** the shower peaking near this day of year (±1.5 days), if any */
export function showerOn(dayOfYear: number): { name: string; rate: number } | null {
  const near = (peak: number) => Math.min(Math.abs(dayOfYear - peak), 365 - Math.abs(dayOfYear - peak)) <= 1.5;
  if (near(224)) return { name: 'Perseids', rate: 7 };
  if (near(348)) return { name: 'Geminids', rate: 8 };
  if (near(3)) return { name: 'Quadrantids', rate: 5 };
  return null;
}

/** mean seconds between shooting stars for a sky with star visibility `vis` (0..1) */
export function meteorGap(vis: number, dayOfYear: number): number {
  if (vis < 0.35) return Infinity;
  const base = 38 / vis;
  const sh = showerOn(dayOfYear);
  return sh ? base / sh.rate : base;
}

interface Streak { alive: boolean; age: number; life: number; head: THREE.Vector3; dir: THREE.Vector3; speed: number; len: number; bright: number; tint: THREE.Color }

export interface Meteors {
  mesh: THREE.Mesh;
  /** advance; returns a meteor that just appeared in front of the camera (for a "make a wish" moment), else null */
  update(dt: number, cam: THREE.Camera, vis: number, dayOfYear: number): THREE.Vector3 | null;
  /** dev: launch one now in front of the camera */
  launch(cam: THREE.Camera): void;
  dispose(): void;
}

export function createMeteors(seed = 7): Meteors {
  let s = seed >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pos = new Float32Array(MAX * 4 * 3);
  const col = new Float32Array(MAX * 4 * 3);
  const idx: number[] = [];
  for (let i = 0; i < MAX; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'meteors';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.visible = false;
  const streaks: Streak[] = Array.from({ length: MAX }, () => ({ alive: false, age: 0, life: 1, head: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, len: 0, bright: 0, tint: new THREE.Color() }));
  let wait = 8;
  const fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3(), tail = new THREE.Vector3();

  /** a start direction on the sky, biased toward `toward` when given (the camera's view) */
  const spawn = (toward: THREE.Vector3 | null): Streak | null => {
    const st = streaks.find((x) => !x.alive);
    if (!st) return null;
    let az = r() * Math.PI * 2;
    if (toward) az = Math.atan2(toward.x, toward.z) + (r() - 0.5) * 0.9;
    const el = 0.45 + r() * 0.65; // 25°..65° up
    st.head.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    // travel mostly sideways and down across the sky
    side.set(Math.cos(az), 0, -Math.sin(az)).multiplyScalar(r() < 0.5 ? -1 : 1);
    st.dir.copy(side).multiplyScalar(0.85).addScaledVector(tmp.set(0, -1, 0), 0.35 + r() * 0.35).normalize();
    st.alive = true; st.age = 0; st.life = 0.55 + r() * 0.6;
    st.speed = 0.55 + r() * 0.35; // radians of sky per second
    st.len = 0.09 + r() * 0.08;
    st.bright = 2.2 + r() * 2.2;
    st.tint.setRGB(0.85 + r() * 0.15, 0.9 + r() * 0.1, 1.0);
    if (r() < 0.12) st.tint.setRGB(0.7, 1.0, 0.85); // the occasional green fireball
    return st;
  };

  const write = (cam: THREE.Camera) => {
    let any = false;
    cam.getWorldPosition(view);
    for (let i = 0; i < MAX; i++) {
      const st = streaks[i];
      const b = i * 12;
      if (!st.alive) { pos.fill(0, b, b + 12); col.fill(0, b, b + 12); continue; }
      any = true;
      const u = st.age / st.life;
      // fade in fast, burn, fade out; the tail grows as it goes
      const a = Math.min(1, u * 8) * (1 - u) ** 1.4 * st.bright;
      const h = tmp.copy(st.head).addScaledVector(st.dir, st.speed * st.age).normalize();
      tail.copy(h).addScaledVector(st.dir, -st.len * Math.min(1, 0.4 + u * 1.5)).normalize();
      side.crossVectors(h, st.dir).normalize().multiplyScalar(0.0022);
      const H = fwd.copy(h).multiplyScalar(R).add(view);
      const T = tail.multiplyScalar(R).add(view);
      const w = R;
      const set = (k: number, p: THREE.Vector3, sx: number, c: number) => {
        pos[b + k * 3] = p.x + side.x * w * sx; pos[b + k * 3 + 1] = p.y + side.y * w * sx; pos[b + k * 3 + 2] = p.z + side.z * w * sx;
        col[b + k * 3] = st.tint.r * c; col[b + k * 3 + 1] = st.tint.g * c; col[b + k * 3 + 2] = st.tint.b * c;
      };
      set(0, H, 1, a); set(1, H, -1, a); set(2, T, 0.3, 0); set(3, T, -0.3, 0);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    mesh.visible = any;
  };

  return {
    mesh,
    update(dt, cam, vis, doy) {
      let seen: THREE.Vector3 | null = null;
      for (const st of streaks) if (st.alive) { st.age += dt; if (st.age >= st.life) st.alive = false; }
      const gap = meteorGap(vis, doy);
      if (Number.isFinite(gap)) {
        wait -= dt;
        if (wait <= 0) {
          wait = gap * (0.35 + r() * 1.3);
          cam.getWorldDirection(fwd);
          // half of them where you're looking (so you see them), the rest anywhere
          const st = spawn(r() < 0.5 && fwd.y > -0.3 ? fwd.clone() : null);
          if (st) { cam.getWorldDirection(fwd); if (fwd.dot(st.head) > 0.75) seen = st.head.clone(); }
        }
      } else wait = Math.max(wait, 6);
      write(cam);
      return seen;
    },
    launch(cam) { cam.getWorldDirection(fwd); spawn(fwd.clone()); },
    dispose() { geo.dispose(); mat.dispose(); mesh.removeFromParent(); },
  };
}
