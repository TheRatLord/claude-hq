// Perf bench for the 780M: office-ish scene + N animated rigid "Clawd" characters + configurable post stack.
// URL params: n=40 inst=1 post=pp|three|none ao=0|1 aoq=Performance|Low|Medium|High half=1 bloom=1 outline=none|hull|edge
//             shadow=none|blob|map scale=1 aa=smaa|msaa|none
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const Q = new URLSearchParams(location.search);
const P = {
  n: +(Q.get('n') ?? 40), inst: Q.get('inst') !== '0', post: Q.get('post') ?? 'pp', ao: Q.get('ao') !== '0',
  aoq: Q.get('aoq') ?? 'Low', half: Q.get('half') !== '0', bloom: Q.get('bloom') !== '0',
  outline: Q.get('outline') ?? 'edge', shadow: Q.get('shadow') ?? 'blob', scale: +(Q.get('scale') ?? 1), aa: Q.get('aa') ?? 'smaa',
};

const renderer = new THREE.WebGLRenderer({ antialias: P.aa === 'msaa' && P.post === 'none', powerPreference: 'high-performance', stencil: false, depth: true });
renderer.setPixelRatio(P.scale);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = P.shadow === 'map';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const gl = renderer.getContext() as WebGL2RenderingContext; // WebGLRenderer creates a WebGL2 context by default
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const GPU = { vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '?', renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', version: gl.getParameter(gl.VERSION) };

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2230');
scene.fog = new THREE.Fog('#2a2230', 25, 60);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 120);
camera.position.set(0, 1.6, 14); camera.lookAt(0, 0.8, 0);

// procedural toon ramp (no external textures)
const ramp = new THREE.DataTexture(new Uint8Array([90, 160, 255].flatMap((v) => [v, v, v, 255])), 3, 1);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
const toon = (c: THREE.ColorRepresentation, e?: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp, emissive: e ?? 0x000000 });

scene.add(new THREE.HemisphereLight('#fff4e6', '#3a2e28', 1.2));
const sun = new THREE.DirectionalLight('#ffe2c0', 2.2); sun.position.set(8, 14, 6);
if (P.shadow === 'map') { sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, far: 50 }); sun.shadow.bias = -0.0005; }
scene.add(sun);
for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(['#ff9a5a', '#7ad0ff', '#c89bff', '#ffd27a'][i], 6, 10); l.position.set(-12 + i * 8, 2.6, -4 + (i % 2) * 8); scene.add(l); }

// ---- static office: merged floor/walls + instanced furniture
const statics: THREE.BufferGeometry[] = [];
const floor = new THREE.PlaneGeometry(50, 40).rotateX(-Math.PI / 2); statics.push(floor);
for (let i = 0; i < 14; i++) { const w = new THREE.BoxGeometry(i % 2 ? 0.2 : 8, 3, i % 2 ? 8 : 0.2); w.translate(-20 + (i * 3.1) % 40, 1.5, -15 + (i * 7.3) % 30); statics.push(w); }
const staticMesh = new THREE.Mesh(mergeGeometries(statics), toon('#d9c7b0')); staticMesh.receiveShadow = true; scene.add(staticMesh);
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, place: (o: THREE.Object3D, i: number) => void) {
  const m = new THREE.InstancedMesh(geo, mat, count); const o = new THREE.Object3D();
  for (let i = 0; i < count; i++) { place(o, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix); }
  m.castShadow = m.receiveShadow = true; scene.add(m); return m;
}
const deskPos = (i: number): [number, number] => [-18 + (i % 10) * 4, -12 + Math.floor(i / 10) * 6];
instanced(new RoundedBoxGeometry(1.8, 0.08, 0.9, 2, 0.03), toon('#b07a4a'), 40, (o, i) => { const [x, z] = deskPos(i); o.position.set(x, 0.75, z); });
instanced(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6).translate(0, 0.375, 0), toon('#333'), 160, (o, i) => { const [x, z] = deskPos(i >> 2); o.position.set(x + ((i & 1) ? 0.8 : -0.8), 0, z + ((i & 2) ? 0.35 : -0.35)); });
instanced(new RoundedBoxGeometry(0.9, 0.5, 0.05, 2, 0.02), toon('#222', '#3a6cff'), 40, (o, i) => { const [x, z] = deskPos(i); o.position.set(x, 1.1, z - 0.3); });
instanced(new THREE.IcosahedronGeometry(0.4, 1), toon('#4f8a4a'), 30, (o, i) => { o.position.set(-22 + i * 1.5, 0.9, 16 - (i % 3)); });
instanced(new RoundedBoxGeometry(0.5, 0.5, 0.5, 2, 0.05), toon('#6d5a8c'), 40, (o, i) => { const [x, z] = deskPos(i); o.position.set(x, 0.25, z + 0.9); });

// ---- characters: rigid parts (body, 2 eyes, 4 legs, 2 arms) = 9 parts
interface Part { g: THREE.BufferGeometry; c: string; off: readonly [number, number, number]; leg?: boolean; arm?: number }
const PARTS: Part[] = [
  { g: new RoundedBoxGeometry(0.7, 0.55, 0.5, 3, 0.12), c: '#d97757', off: [0, 0.55, 0] },
  { g: new THREE.SphereGeometry(0.07, 10, 8), c: '#1a1a1a', off: [-0.14, 0.62, 0.25] },
  { g: new THREE.SphereGeometry(0.07, 10, 8), c: '#1a1a1a', off: [0.14, 0.62, 0.25] },
  ...[-0.22, -0.08, 0.08, 0.22].map((x) => ({ g: new RoundedBoxGeometry(0.1, 0.3, 0.12, 2, 0.03).translate(0, -0.15, 0), c: '#c4623f', off: [x, 0.3, 0] as const, leg: true })),
  ...[-1, 1].map((s) => ({ g: new RoundedBoxGeometry(0.14, 0.12, 0.14, 2, 0.04), c: '#d97757', off: [s * 0.42, 0.55, 0] as const, arm: s })),
];
interface Char { x: number; z: number; a: number; sp: number; ph: number; g?: THREE.Group; parts?: THREE.Mesh[] }
const chars: Char[] = [];
for (let i = 0; i < P.n; i++) chars.push({ x: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 24, a: Math.random() * 6.28, sp: 0.6 + Math.random(), ph: Math.random() * 10 });
const partMeshes: THREE.InstancedMesh[] = [];
const hullOff = (m: THREE.MeshBasicMaterial) => { m.onBeforeCompile = (s) => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.025;'); }; return m; };
const hullMat = hullOff(new THREE.MeshBasicMaterial({ color: '#2a1410', side: THREE.BackSide }));
if (P.inst) {
  for (const p of PARTS) {
    const m = new THREE.InstancedMesh(p.g, toon(p.c), P.n); m.castShadow = true; m.frustumCulled = false; scene.add(m); partMeshes.push(m);
    if (P.outline === 'hull' && !p.off[2]) { const h = new THREE.InstancedMesh(p.g, hullMat, P.n); h.instanceMatrix = m.instanceMatrix; h.frustumCulled = false; scene.add(h); }
  }
} else {
  for (const c of chars) {
    const g = c.g = new THREE.Group(); scene.add(g); c.parts = PARTS.map((p) => {
      const m = new THREE.Mesh(p.g, toon(p.c)); m.castShadow = true; m.position.fromArray(p.off); g.add(m);
      if (P.outline === 'hull') m.add(new THREE.Mesh(p.g, hullMat));
      return m;
    });
  }
}
// shadows: blob = one instanced quad set with a procedural radial texture
let blobs: THREE.InstancedMesh | null = null;
if (P.shadow === 'blob') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d')!; // a fresh 2d canvas always has a context
  const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
  blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }), P.n);
  blobs.frustumCulled = false; scene.add(blobs);
}

// ---- post
let composer: { render(dt?: number): void; setSize(w: number, h: number): void } | null = null;
let renderFn: (dt: number) => void = () => renderer.render(scene, camera);
const W = innerWidth, H = innerHeight;
if (P.post === 'pp') {
  const PP = await import('postprocessing');
  const pp = new PP.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: P.aa === 'msaa' ? 4 : 0 });
  composer = pp;
  pp.addPass(new PP.RenderPass(scene, camera));
  if (P.ao) {
    const { N8AOPostPass } = await import('n8ao');
    const ao = new N8AOPostPass(scene, camera, W, H);
    ao.configuration.aoRadius = 1.2; ao.configuration.distanceFalloff = 0.6; ao.configuration.intensity = 2.5; ao.configuration.halfRes = P.half;
    ao.setQualityMode(P.aoq); pp.addPass(ao);
  }
  const effects: InstanceType<typeof PP.Effect>[] = [];
  if (P.outline === 'edge') {
    effects.push(new PP.Effect('Edge', /* glsl */`
      uniform vec2 px;
      float lz(float d){ return getViewZ(d); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor){
        float c = lz(depth);
        float e = abs(lz(readDepth(uv+vec2(px.x,0.)))-c)+abs(lz(readDepth(uv-vec2(px.x,0.)))-c)
                +abs(lz(readDepth(uv+vec2(0.,px.y)))-c)+abs(lz(readDepth(uv-vec2(0.,px.y)))-c);
        float k = smoothstep(0.08, 0.25, e / max(-c, 1.0) * 6.0);
        outputColor = vec4(mix(inputColor.rgb, vec3(0.16,0.08,0.06), k*0.85), inputColor.a);
      }`, { attributes: PP.EffectAttribute.DEPTH, uniforms: new Map([['px', new THREE.Uniform(new THREE.Vector2(1 / (W * P.scale), 1 / (H * P.scale)))]]) }));
  }
  if (P.bloom) effects.push(new PP.BloomEffect({ mipmapBlur: true, intensity: 0.9, luminanceThreshold: 0.8, radius: 0.7 }));
  effects.push(new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.AGX }), new PP.VignetteEffect({ darkness: 0.45 }));
  if (P.aa === 'smaa') effects.push(new PP.SMAAEffect());
  pp.addPass(new PP.EffectPass(camera, ...effects));
  pp.setSize(W, H);
  renderFn = (dt) => pp.render(dt);
} else if (P.post === 'three') {
  const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js');
  const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
  const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
  const { SMAAPass } = await import('three/examples/jsm/postprocessing/SMAAPass.js');
  const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js');
  const passes: Pass[] = [new RenderPass(scene, camera)];
  if (P.ao) { const { N8AOPass } = await import('n8ao'); const ao = new N8AOPass(scene, camera, W, H); ao.configuration.halfRes = P.half; ao.setQualityMode(P.aoq); passes.push(ao); }
  if (P.bloom) passes.push(new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.5, 0.8));
  passes.push(new OutputPass()); if (P.aa === 'smaa') passes.push(new SMAAPass());
  renderer.toneMapping = THREE.AgXToneMapping;
  const tc = new EffectComposer(renderer); passes.forEach((p) => tc.addPass(p));
  composer = tc;
  renderFn = () => tc.render();
} else renderer.toneMapping = THREE.AgXToneMapping;

// ---- animation
const o = new THREE.Object3D(), root = new THREE.Object3D(), tmp = new THREE.Matrix4();
function animate(t: number) {
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]; c.a += 0.004 * Math.sin(t * 0.3 + c.ph); c.x += Math.sin(c.a) * c.sp * 0.016; c.z += Math.cos(c.a) * c.sp * 0.016;
    if (Math.abs(c.x) > 18) c.a = -c.a; if (Math.abs(c.z) > 13) c.a = Math.PI - c.a;
    const w = t * 8 * c.sp + c.ph, hop = Math.abs(Math.sin(w)) * 0.12, sq = 1 + Math.sin(w * 2) * 0.08;
    root.position.set(c.x, hop, c.z); root.rotation.set(0, c.a, Math.sin(w) * 0.08); root.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); root.updateMatrix();
    if (P.inst) {
      for (let j = 0; j < PARTS.length; j++) {
        const p = PARTS[j]; o.position.fromArray(p.off); o.rotation.set(p.leg ? Math.sin(w + j * Math.PI) * 0.6 : p.arm ? 0 : 0, 0, p.arm ? p.arm * (0.4 + Math.sin(w * 1.5) * 0.5) : 0); o.updateMatrix();
        tmp.multiplyMatrices(root.matrix, o.matrix); partMeshes[j].setMatrixAt(i, tmp);
      }
    } else {
      const g = c.g!, parts = c.parts!; // both are set for every char when !P.inst
      g.position.copy(root.position); g.rotation.copy(root.rotation); g.scale.copy(root.scale);
      for (let j = 0; j < PARTS.length; j++) { const p = PARTS[j], m = parts[j]; m.rotation.set(p.leg ? Math.sin(w + j * Math.PI) * 0.6 : 0, 0, p.arm ? p.arm * (0.4 + Math.sin(w * 1.5) * 0.5) : 0); }
    }
    if (blobs) { o.position.set(c.x, 0.01, c.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1.1 - hop); o.updateMatrix(); blobs.setMatrixAt(i, o.matrix); }
  }
  if (P.inst) partMeshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
  if (blobs) blobs.instanceMatrix.needsUpdate = true;
}

// ---- GPU timer (EXT_disjoint_timer_query_webgl2) + frame stats
const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const pending: WebGLQuery[] = []; const gpuMs: number[] = []; const frames: number[] = [];
let last = performance.now(); const jsMs: number[] = []; const calls: number[] = [], tris: number[] = [];
function loop(now: number) {
  const dt = (now - last) / 1000; last = now; frames.push(now);
  if (frames.length > 600) frames.shift();
  const j0 = performance.now(); animate(now / 1000); jsMs.push(performance.now() - j0); if (jsMs.length > 300) jsMs.shift();
  let q: WebGLQuery | null = null; if (tq && pending.length < 4) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
  renderer.info.reset(); renderFn(dt); calls.push(renderer.info.render.calls); tris.push(renderer.info.render.triangles); if (calls.length > 120) { calls.shift(); tris.shift(); }
  if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); pending.push(q); }
  while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
    const pq = pending.shift()!; // the loop condition guarantees a pending query
    if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) { gpuMs.push(gl.getQueryParameter(pq, gl.QUERY_RESULT) / 1e6); if (gpuMs.length > 300) gpuMs.shift(); } gl.deleteQuery(pq);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
renderer.info.autoReset = false; // counted per frame across all composer passes
Object.assign(window, { __hq: {
  params: P, gpu: GPU,
  setPose(x: number, y: number, z: number, yaw = 0, pitch = 0) { camera.position.set(x, y, z); camera.rotation.set(pitch, yaw, 0, 'YXZ'); },
  stats() {
    const f = frames.slice(-120); const fps = f.length > 1 ? (f.length - 1) / ((f[f.length - 1] - f[0]) / 1000) : 0;
    return { fps: +fps.toFixed(1), gpuMs: gpuMs.length ? +(avg(gpuMs.slice(-60)) ?? 0).toFixed(2) : null, jsMs: +(avg(jsMs.slice(-120)) ?? 0).toFixed(2),
      callsPerFrame: Math.round(avg(calls) ?? 0), trisPerFrame: Math.round(avg(tris) ?? 0), timerQuery: !!tq, ...GPU,
      size: [renderer.domElement.width, renderer.domElement.height] };
  },
} });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight); });
