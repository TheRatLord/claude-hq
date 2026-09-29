/**
 * Scene-program warm-up (RND fix r1, §5.3 / §5.4). A program compiled lazily mid-session is a visible hitch on the
 * 780M (first sight of a zone, the first newcomer crate, a roster portrait…), so every scene variant is compiled at
 * boot, with the exact state the real passes use:
 *  1. `renderer.compile(scene)` over the WHOLE scene (three traverses hidden objects too: culled vis cells, idle props)
 *     into the composer's input buffer (same output colour space / tone-mapping state as WorldPass and CharPass);
 *  2. for every factory program key (`hq|kind|flags`, materials/index.ts `programVariants`) that step 1 did not
 *     produce (materials handed out for objects that are not in the scene yet), a hidden count-1 dummy of that exact
 *     material is compiled against the scene's lights.
 * The warm-up runs on the first frames (world + actors + stats objects are built by then) and again after a context
 * restore. After the last scheduled run the scene-program set is frozen: `check()` reports (console.warn, once per
 * program) any hq program compiled later, i.e. an object that left the §5.4 matrix (fix it at its owner: usually a
 * plain Mesh on an instanced-only kind, or a material flag).
 * Owner: RND.
 */
import * as THREE from 'three';
import { programVariants, type Drawable } from './materials/index.ts';
import { MASK } from './layers.ts';

/** Layers drawn by a colour pass (WorldPass + CharPass). Depth-only objects (kit shadow proxies on CASTERS) are skipped. */
const COLOUR = MASK.world | MASK.chars | MASK.hulls | MASK.overlay;

/** The `hq|kind|flags` suffix of a three program cache key (customProgramCacheKey is appended last), or null. */
export function hqKeyOf(cacheKey: string | null | undefined): string | null {
  const i = (cacheKey || '').lastIndexOf('hq|');
  return i < 0 || !cacheKey ? null : cacheKey.slice(i);
}

/**
 * Program keys the factory knows that are not compiled yet (pure). `compiled` = hq keys already compiled, `variants` =
 * hq keys the factory handed out.
 */
export function missingVariants(compiled: Iterable<string>, variants: Iterable<string>): string[] {
  const have = new Set(compiled);
  return [...variants].filter((k) => !have.has(k));
}

/** Frames on which the warm-up runs (1: first render; later ones pick up objects built after the first `world`). */
export const WARM_FRAMES = Object.freeze([1, 30, 120]);

export interface ProgramWarmupOpts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  target: () => THREE.WebGLRenderTarget | null;
}

/** three's program record with the warm-up's marker (three's typings leave `_hqWarm` out). */
type WarmProgram = THREE.WebGLProgram & { _hqWarm?: boolean };
const warmable = (p: THREE.WebGLProgram): WarmProgram => p; // (only widens: adds the optional marker)


export function createProgramWarmup({ renderer, scene, camera, target }: ProgramWarmupOpts) {
  const info = renderer.info;
  let frame = 0, frozenAt = -1;
  const warned = new Set();
  const stats = { runs: 0, compiledScene: 0, dummies: 0, ms: 0, late: [] as string[] };
  // one tiny triangle carrying every attribute a lit variant can key on (normal, uv, colour)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1e-4, 0, 0, 0, 1e-4, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));

  const hqKeys = () => { const s = new Set<string>(); for (const p of info.programs ?? []) { const k = hqKeyOf(p.cacheKey); if (k) s.add(k); } return s; };

  const run = () => {
    const t0 = performance.now();
    const prevRT = renderer.getRenderTarget();
    const mask = camera.layers.mask;
    const n0 = info.programs?.length ?? 0;
    try {
      renderer.setRenderTarget(target() ?? null);
      camera.layers.enableAll(); // gather the lights exactly as the passes see them (the key light is on every layer)
      // three's compile() ignores layers: park the material of depth-only objects (their colour program is never used)
      const parked: { o: Drawable; m: THREE.Material | THREE.Material[] }[] = [];
      scene.traverse((o) => { const h = o as Drawable; // three's Object3D does not declare `material`
        if (h.material && !(o.layers.mask & COLOUR)) { parked.push({ o: h, m: h.material }); h.material = null; }
      });
      try { renderer.compile(scene, camera); } finally { for (const p of parked) p.o.material = p.m; }
      const miss = missingVariants(hqKeys(), programVariants().keys());
      if (miss.length) {
        const group = new THREE.Group();
        group.visible = false;
        const variants = programVariants();
        for (const k of miss) {
          const mat = variants.get(k);
          if (!mat) continue;
          const inst = k.split('|')[2].split('+').includes('INSTANCED');
          let m: THREE.Mesh;
          if (inst) {
            const im = new THREE.InstancedMesh(geo, mat, 1);
            // post.ts gives every instanced hq mesh a white instanceColor (one program per material): match it
            im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
            m = im;
          } else m = new THREE.Mesh(geo, mat);
          group.add(m);
        }
        renderer.compile(group, camera, scene);
        for (const m of group.children) if (m instanceof THREE.InstancedMesh) m.dispose();
        stats.dummies += miss.length;
      }
    } finally {
      camera.layers.mask = mask;
      renderer.setRenderTarget(prevRT);
    }
    stats.runs++;
    stats.compiledScene += (info.programs?.length ?? 0) - n0;
    stats.ms = +(stats.ms + performance.now() - t0).toFixed(1);
  };

  let len = -1;
  const markWarm = () => { for (const p of info.programs ?? []) warmable(p)._hqWarm = true; len = -1; };
  return {
    /** Once per frame, before the composer renders. */
    frame() {
      frame++;
      if (!WARM_FRAMES.includes(frame)) return;
      run();
      if (frame === WARM_FRAMES[WARM_FRAMES.length - 1]) { markWarm(); frozenAt = frame; }
    },
    /** After the frame's renders: hq programs compiled after the freeze → one console.warn each (cheap when unchanged). */
    check() {
      if (frozenAt < 0) return;
      const ps = info.programs ?? [];
      if (ps.length === len) return;
      len = ps.length;
      for (const p of ps) {
        if (warmable(p)._hqWarm || warned.has(p)) continue;
        warned.add(p);
        const k = hqKeyOf(p.cacheKey);
        if (!k) continue;
        stats.late.push(`${p.name} ${k}`);
        console.warn(`[render] scene program compiled after the boot warm-up: ${p.name} (${k}); an object left the §5.4 matrix`);
      }
    },
    /** Context restore: programs are gone, warm everything again on the next frames. */
    reset() { frame = 0; frozenAt = -1; len = -1; },
    stats: () => ({ ...stats, frozen: frozenAt >= 0, late: [...stats.late] }),
  };
}
