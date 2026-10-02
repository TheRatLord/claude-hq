/**
 * Asset registrations for the plots package (gallery + systems build through these). Whole fields are registered
 * too ('field-<kind>', variants = lifecycle stage, param = growth) and run the real Field code with a fake plot.
 */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import type { AssetBuildOpts } from '../assets.ts';
import { PLOT_KINDS, ANIMAL_PLOTS } from '../../model/types.ts';
import type { HelperView, PlotKind, PlotStage, PlotView } from '../../model/types.ts';
import type { Site } from '../../world/map.ts';
import { toon, WORKSPACE_COLORS } from '../toon.ts';
import { TextAtlas } from './atlas.ts';
import { Batches } from './batch.ts';
import { Field } from './field.ts';
import type { FieldEnv } from './field.ts';
import { Fx } from './fx.ts';
import { cropMaterial, cropUniforms, propMaterial } from './materials.ts';
import { Meadow } from './meadow.ts';
import { apple, berries, berryBush, cabbage, fruitTree, TREE_BLOBS, grapes, lavender, pumpkin, pumpkinVine, sunflowerHead, sunflowerPlant, SUN_STEM, vineBlob, wheatClump, daisies, cosmos, grassTuft, wildflower } from './crops.ts';
import { cart, cartHeap, crate, fenceRibbon, fenceSegment, flag, hiveGeo, lanternCore, LANTERN, scarecrow, signBoard, strawNestGeo, weed, clod } from './models.ts';
import { Herd, SPECIES } from './animals.ts';
import type { HerdInput, Pen, Script, SpeciesKey } from './animals.ts';
import { Bees } from './bees.ts';
import { dandelion, pennant } from './git.ts';
import type { PlotRepoView } from '../../model/signals.ts';
import { merge as mergeGeo } from './geo.ts';

const SITE: Site = { index: 0, x: 0, z: 0, w: 18, d: 14, yaw: 0, y: 0, gate: { x: 0, z: 8.5 } };
const LABELS = ['hq-core', 'tinker', 'infra', 'webshop', 'ml-lab', 'docs-site', 'mobile', 'data-pipe', 'api-gw', 'blog', 'dotfiles', 'sandbox'];
let galleryAtlas: TextAtlas | null = null;
const atlas = () => (galleryAtlas ??= new TextAtlas());

const lit = () => propMaterial();
const mesh = (g: THREE.BufferGeometry, m: THREE.Material = lit()) => { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; return x; };

// ---------------------------------------------------------------------------------------------------------------
// Whole fields

interface FieldRig { field: Field; env: FieldEnv; plot: PlotView; batches: Batches; fx: Fx; helper: HelperView; stage: PlotStage; weedU: ReturnType<typeof cropUniforms> }

function buildField(kind: PlotKind, o: AssetBuildOpts): THREE.Object3D {
  const g = new THREE.Group();
  const stage = (o.variant ?? 'thriving') as PlotStage;
  const i = PLOT_KINDS.indexOf(kind);
  const plot: PlotView = {
    id: `gallery-${kind}`, label: LABELS[i % LABELS.length], site: 0, kind, colorIndex: i % WORKSPACE_COLORS.length, stage, stageSince: 0,
    growth: 0.8, vigor: 1, status: 'working', farmers: [], helpers: ['gallery-helper'],
  };
  const helper: HelperView = { id: 'gallery-helper', name: 'dev server', project: 'claude-hq', tag: 'claude-hq', plotId: plot.id, spot: 1, activity: 'serve', running: true, exit: 'ok', label: 'npm run dev', ports: [5173] };
  const batches = new Batches();
  const fx = new Fx(batches);
  const weedU = cropUniforms(0.22);
  const env: FieldEnv = {
    time: 0, dt: 0, now: 0, season: o.season, night: o.night ?? 0, sunDir: new THREE.Vector3(0.5, 0.7, 0.5).normalize(), wind: { x: 1, z: 0.3 },
    camQuat: new THREE.Quaternion(), player: null, batches, fx, atlas: atlas(), weedMat: cropMaterial(weedU, { side: THREE.DoubleSide }),
    farmer: () => undefined, helper: (id) => (id === helper.id ? helper : undefined), sound: () => {}, barn: { x: -1, z: 0 },
  };
  const field = new Field(SITE, plot, o.season, { fresh: stage === 'tilling' });
  g.add(field.root, batches.group);
  // invisible bounds so the gallery frames / scales the whole field (instanced parts report tiny boxes)
  const bounds = new THREE.Mesh(new THREE.BoxGeometry(SITE.w + 1, 3, SITE.d + 3));
  bounds.position.set(0, 1.5, 1);
  bounds.visible = false;
  g.add(bounds);
  const rig: FieldRig = { field, env, plot, batches, fx, helper, stage, weedU };
  g.userData.rig = rig;
  animateField(g, 0, 0.016, 0.8);
  // settle the animals and the growth smoothing
  for (let k = 0; k < 40; k++) animateField(g, k * 0.1, 0.1, 0.8);
  return g;
}

/** the gallery's clock can be NaN before its first frame: keep our own */
function clock(obj: THREE.Object3D, t: number, dt: number): number {
  if (Number.isFinite(t)) return t;
  obj.userData.clock = (obj.userData.clock ?? 0) + (Number.isFinite(dt) ? dt : 0.016);
  return obj.userData.clock;
}

function animateField(obj: THREE.Object3D, t0: number, dt: number, param: number): void {
  const rig = obj.userData.rig as FieldRig | undefined;
  if (!rig) return;
  const t = clock(obj, t0, dt);
  if (!Number.isFinite(dt)) dt = 0.016;
  const { env, plot, batches, fx, field } = rig;
  env.time = t; env.dt = Math.min(0.1, dt); env.now = t * 1000;
  plot.growth = param;
  // lifecycle stages loop so the gallery shows the animation
  if (rig.stage === 'tilling') plot.stageSince = env.now - ((t % 9) * 1000);
  else if (rig.stage === 'harvest') plot.stageSince = env.now - ((t % 9) * 1000);
  else if (rig.stage === 'fallow') plot.stageSince = env.now - 60_000 - ((t % 30) * 4000);
  else plot.stageSince = env.now - 60_000;
  plot.vigor = rig.stage === 'resting' ? 0 : 1;
  rig.helper.running = rig.stage !== 'resting';
  const cam = (obj.parent as THREE.Object3D | null);
  void cam;
  rig.weedU.uTime.value = t;
  batches.begin();
  field.update(env, plot);
  fx.update(env.dt);
  batches.end();
}

for (const kind of PLOT_KINDS) {
  defineAsset({
    name: `field-${kind}`, group: ANIMAL_PLOTS.includes(kind) && kind !== 'bees' ? 'animal' : 'crop',
    note: `a whole ${kind} field (18 × 14 m) running the real Field code; variant = lifecycle stage`,
    variants: ['thriving', 'growing', 'resting', 'tilling', 'harvest', 'fallow'], param: 'growth',
    build: (o) => buildField(kind, o), animate: animateField,
  });
}

// a field in a git repo (git.ts): weeds = changed files, crates by the sign = unpushed commits, the sign's pennant =
// the branch, an envelope = behind upstream; 'cycle' loops edit → commit (weeds pulled) → push (the cart ships them)
const repo = (o: Partial<PlotRepoView>): PlotRepoView => ({ repo: 'claude-hq', branch: 'main', head: 'a1b2c3d', dirty: 0, untracked: 0, ahead: 0, behind: 0, lastCommit: null, panes: 2, branches: 1, ...o });
const GIT_VARIANTS: Record<string, (t: number) => PlotRepoView> = {
  feature: () => repo({ branch: 'feat/valley-signals', dirty: 8, ahead: 3, behind: 2 }),
  main: () => repo({ dirty: 2, ahead: 7 }),
  detached: () => repo({ branch: null, dirty: 1, ahead: null, behind: null }),
  cycle: (t) => { const c = t % 18; return repo({ branch: 'fix/reconnect-backoff', dirty: c < 6 ? 1 + Math.floor(c * 2) : 0, ahead: c < 6 ? 2 : c < 11 ? 3 : 0, behind: c < 11 ? 1 : 0 }); },
};
defineAsset({
  name: 'field-git', group: 'crop', variants: Object.keys(GIT_VARIANTS),
  note: 'a cabbage field in a git repo: weeds = changed files, crates = unpushed commits (+N slate past 5), pennant = branch, envelope = behind; cycle: commit pulls the weeds, push ships the crates',
  build: (o) => {
    const g = buildField('cabbages', { ...o, variant: 'thriving' });
    const rig = g.userData.rig as FieldRig;
    const v = GIT_VARIANTS[o.variant ?? 'feature'] ?? GIT_VARIANTS.feature;
    rig.plot.git = v(0);
    g.userData.git = v;
    for (let k = 0; k < 30; k++) animateField(g, 4 + k * 0.1, 0.1, 0.8);
    return g;
  },
  animate: (obj, t, dt, p) => {
    const rig = obj.userData.rig as FieldRig | undefined, v = obj.userData.git as ((t: number) => PlotRepoView) | undefined;
    if (rig && v) rig.plot.git = v(clock(obj, t, 0));
    animateField(obj, t, dt, p);
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Single crops (param = growth → scale)

const crop = (name: string, note: string, make: (o: AssetBuildOpts) => THREE.Object3D, min = 0.25) => defineAsset({
  name, group: 'crop', note, param: 'growth', build: make,
  animate: (obj, t0, dt, p) => {
    const t = clock(obj, t0, dt);
    const s = min + (1 - min) * p;
    obj.scale.setScalar(s);
    obj.traverse((c) => { const u = (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.Material).userData?.u; if (u) u.uTime.value = t; });
  },
});
const swaying = (g: THREE.BufferGeometry, bend = 0.12) => mesh(g, cropMaterial(cropUniforms(bend), { side: THREE.DoubleSide }));

crop('wheat-clump', 'a clump of wheat stalks (instanced ~700× per field)', (o) => swaying(wheatClump(o.season), 0.16));
crop('pumpkin', 'ribbed pumpkin on its vine', (o) => { const g = new THREE.Group(); g.add(swaying(pumpkinVine(o.season), 0.05), mesh(pumpkin())); g.children[1].position.x = 0.45; return g; }, 0.3);
crop('cabbage', 'cabbage head (rows tinted green / purple)', () => { const m = swaying(cabbage(), 0.04); return m; });
crop('sunflower', 'sunflower; heads follow the sun in the field', (o) => { const g = new THREE.Group(); const h = mesh(sunflowerHead()); h.position.y = SUN_STEM; h.rotation.x = -0.2; g.add(swaying(sunflowerPlant(o.season), 0.008), h); return g; }, 0.2);
crop('fruit-tree', 'orchard apple tree (seasonal canopy)', (o) => {
  const g = new THREE.Group(); g.add(swaying(fruitTree(o.season), 0.004));
  // apples on the crown's surface, as the orchard layout places them
  if (o.season !== 'winter') for (let i = 0; i < 12; i++) {
    const a = mesh(apple(), toon(0xff5040, { vertexColors: true })), b = TREE_BLOBS[i % TREE_BLOBS.length];
    const d = new THREE.Vector3(Math.cos(i * 2.1), Math.sin(i * 1.3) * 0.6, Math.sin(i * 2.1)).normalize();
    a.position.set(b.x + d.x * b.r * 1.02, b.y + d.y * b.r * 0.92, b.z + d.z * b.r * 1.02); g.add(a);
  }
  return g;
}, 0.45);
crop('grapevine', 'trellised grapevine section with bunches', (o) => {
  const g = new THREE.Group(); g.add(swaying(vineBlob(o.season), 0.035));
  if (o.season !== 'winter') for (let i = 0; i < 3; i++) { const b = mesh(grapes(), toon(0x8a48b8, { vertexColors: true })); b.position.set((i - 1) * 0.2, 1.0, (i - 1) * 0.35); g.add(b); }
  return g;
}, 0.3);
crop('berry-bush', 'blueberry / raspberry bush', (o) => { const g = new THREE.Group(); g.add(swaying(berryBush(o.season), 0.05), mesh(berries(), toon(0x5a78f0, { vertexColors: true }))); return g; }, 0.3);
crop('bee-flowers', 'lavender, daisies and cosmos for the bee garden', () => {
  const g = new THREE.Group();
  [lavender(), daisies(), cosmos()].forEach((geo, i) => { const m = swaying(geo, 0.3); m.position.x = (i - 1) * 0.7; g.add(m); });
  return g;
});
crop('meadow-grass', 'wild meadow tuft + wildflowers (free plot sites)', (o) => {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) { const m = swaying(i % 3 ? grassTuft(o.season) : wildflower(), 0.22); m.position.set((i % 3 - 1) * 0.5, 0, (Math.floor(i / 3) - 1) * 0.5); m.rotation.y = i; g.add(m); }
  return g;
}, 1);

// ---------------------------------------------------------------------------------------------------------------
// Animals: a one-animal Herd running the real behaviour code on a scripted loop (variant = the loop)

const IDENT = new THREE.Matrix4();
/** rough visual size per species (gallery framing, loop length) */
export const GALLERY_K: Record<SpeciesKey, number> = { cow: 1, sheep: 0.7, pig: 0.68, chicken: 0.42 };
const LOOPS: Record<SpeciesKey | 'bees', Script[]> = {
  cow: ['walk', 'trot', 'graze', 'idle', 'lie', 'sleep', 'pet', 'scratch', 'call'],
  sheep: ['walk', 'trot', 'graze', 'idle', 'lie', 'sleep', 'pet', 'shake', 'call', 'scratch'],
  pig: ['walk', 'trot', 'root', 'graze', 'idle', 'lie', 'sleep', 'pet', 'roll', 'shake', 'scratch', 'call'],
  chicken: ['walk', 'flee', 'graze', 'idle', 'sleep', 'pet', 'dust', 'stretch', 'shake', 'brood', 'chase', 'chicks', 'call'],
  bees: [],
};

interface BeastRig { herd: Herd; batches: Batches; fx: Fx; inp: HerdInput; script: Script; petT: number }

function buildBeast(key: SpeciesKey, o: AssetBuildOpts): THREE.Object3D {
  const g = new THREE.Group();
  const script = (o.variant ?? LOOPS[key][0]) as Script;
  const def = SPECIES[key];
  const pen: Pen = { hw: 4, hd: 4, avoid: [], lure: [], beds: [], posts: [], nests: [] };
  if (script === 'brood') pen.nests.push({ x: 0, z: 0 });
  const count = script === 'chase' ? 2 : 1;
  const herd = new Herd(key, pen, `gallery-${key}`, count, true);
  herd.script = script;
  herd.animals.forEach((a, i) => {
    a.x = script === 'chase' ? (i ? 0.6 : -0.9) : 0; a.z = 0; a.yaw = script === 'walk' || script === 'trot' || script === 'flee' || script === 'chicks' ? Math.PI / 2 : script === 'scratch' ? 0 : 0.35;
    { const c = def.coats[Math.max(0, o.seed - 1) % def.coats.length]; a.tint.set(c.tint); a.pattern = c.pattern; }
    if (key === 'chicken' && script !== 'chicks') a.mother = false;
    a.t = 99; a.act = 'idle'; a.stage = 'do';
    if (script === 'sleep' || script === 'brood' || script === 'roll' || script === 'dust') { a.lying = true; a.front = a.hind = 1; }
  });
  if (key === 'chicken' && script !== 'chicks') herd.chicks.length = 0;
  const batches = new Batches();
  const fx = new Fx(batches);
  const site = new THREE.Matrix4();
  const inp: HerdInput = {
    dt: 0.016, time: 0, lively: 0.7, sleepy: script === 'sleep' ? 1 : 0, player: { x: 1.3, z: 2.2, speed: 0, near: script === 'pet' },
    arrive: 1, leave: 0, growth: 1, barn: { x: -1, z: 0 }, fx, site, sound: () => {},
  };
  g.add(batches.group);
  if (script === 'scratch') {
    // a fence post (+ rails) against the animal's left flank
    const post = mesh(fenceSegment(o.season));
    post.position.set(def.r * def.size + 0.14, 0, -def.len * 0.25 * def.size - 1);
    post.rotation.y = -Math.PI / 2;
    g.add(post);
    const p2 = mesh(fenceSegment(o.season)); p2.position.set(post.position.x, 0, post.position.z - 2); p2.rotation.y = -Math.PI / 2; g.add(p2);
  }
  if (script === 'brood') { const n = mesh(strawNestGeo()); g.add(n); }
  // invisible bounds so the gallery frames the whole loop
  const k = GALLERY_K[key];
  const span = (script === 'walk' || script === 'flee' || script === 'chicks' ? 2.6 : script === 'trot' ? 3.6 : script === 'chase' ? 1.8 : 0) * k;
  const b = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 2.2 * k, 1.7 * k, 1.6 * k));
  b.position.y = 0.85 * k;
  b.visible = false;
  g.add(b);
  const rig: BeastRig = { herd, batches, fx, inp, script, petT: 1 };
  g.userData.beast = rig;
  for (let k = 0; k < 20; k++) animateBeast(g, k * 0.05, 0.05);
  return g;
}

function animateBeast(obj: THREE.Object3D, t0: number, dt: number): void {
  const rig = obj.userData.beast as BeastRig | undefined;
  if (!rig) return;
  const t = clock(obj, t0, dt);
  if (!Number.isFinite(dt) || dt <= 0) dt = 0.016;
  const { herd, batches, fx, inp } = rig;
  inp.dt = Math.min(0.05, dt); inp.time = t;
  if (rig.script === 'pet') {
    rig.petT -= inp.dt;
    if (rig.petT <= 0) { rig.petT = 3.4; herd.pet(herd.animals[0]); }
  }
  batches.begin();
  herd.update(inp);
  herd.draw(batches, inp.site, 'summer', 1);
  fx.update(inp.dt);
  batches.end();
}

for (const key of ['cow', 'sheep', 'pig', 'chicken'] as SpeciesKey[]) {
  defineAsset({
    name: key, group: 'animal', variants: LOOPS[key],
    note: `${key}: the real Herd code on a loop (variant); names like ${SPECIES[key].names.slice(0, 3).join(', ')}`,
    build: (o) => buildBeast(key, o),
    animate: (obj, t, dt) => animateBeast(obj, t, dt),
  });
}

defineAsset({
  name: 'bees', group: 'animal', note: 'bees looping hive → flower (figure-8s) → hive; guards at the entrance',
  build: (o) => {
    const g = new THREE.Group();
    const parts: THREE.BufferGeometry[] = [];
    hiveGeo(parts, -1.2, -0.6, 0, o.season); hiveGeo(parts, 1.2, -0.6, 1, o.season);
    g.add(mesh(mergeGeo(parts)));
    const flowers = [[-1.6, 1.4], [0, 1.8], [1.5, 1.2], [0.6, 0.6], [-0.7, 0.9]].map(([x, z]) => ({ x, y: 0.45, z }));
    flowers.forEach((f, i) => { const m = swaying([lavender(), daisies(), cosmos()][i % 3], 0.3); m.position.set(f.x, 0, f.z); g.add(m); });
    const batches = new Batches();
    g.add(batches.group);
    const bees = new Bees({ hives: [{ x: -1.2, z: -0.6 }, { x: 1.2, z: -0.6 }], flowers }, 'gallery', 14);
    g.userData.bees = { bees, batches };
    return g;
  },
  animate: (obj, t0, dt) => {
    const d = obj.userData.bees as { bees: Bees; batches: Batches } | undefined;
    if (!d) return;
    const t = clock(obj, t0, dt);
    d.batches.begin();
    d.bees.update(Number.isFinite(dt) ? Math.min(0.05, dt) : 0.016, t, d.batches, IDENT, { vigor: 1, night: 0, resting: false, alive: 1 });
    d.batches.end();
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Props

const prop = (name: string, note: string, build: (o: AssetBuildOpts) => THREE.Object3D, animate?: (obj: THREE.Object3D, t: number) => void) =>
  defineAsset({ name, group: 'prop', note, build, animate: animate ? (obj, t) => animate(obj, t) : undefined });

prop('field-fence', 'fence segment with a ribbon in the workspace colour (8 colours)', (o) => {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = mesh(fenceSegment(o.season)); m.position.x = i * 2; g.add(m);
    const r = mesh(fenceRibbon(), toon(WORKSPACE_COLORS[(o.seed + i) % 8], { vertexColors: true })); r.position.x = i * 2; g.add(r);
  }
  return g;
});
prop('field-sign', 'plot sign (text comes from a shared atlas)', (o) => {
  const g = new THREE.Group();
  g.add(mesh(signBoard(o.season)));
  return g;
});
prop('scarecrow', 'shell helper: scarecrow with a lantern (lit while a process runs) and an exit ribbon', (o) => {
  const g = new THREE.Group();
  g.add(mesh(scarecrow(o.season)));
  const l = new THREE.Mesh(lanternCore(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 0.5) }));
  l.position.set(LANTERN.x, LANTERN.y, LANTERN.z);
  g.add(l);
  return g;
}, (obj, t) => { const l = obj.children[1] as THREE.Mesh; const k = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3); (l.material as THREE.MeshBasicMaterial).color.setRGB(2.2 * k, 1.4 * k, 0.5 * k); });
prop('harvest-cart', 'harvest cart with a heap of produce', () => { const g = new THREE.Group(); g.add(mesh(cart()), mesh(cartHeap(), toon(0xe8812f, { vertexColors: true }))); return g; });
prop('produce-crate', 'crate of produce (stacks by the gate when farmers are done)', () => mesh(crate()));
prop('blocked-flag', 'bouncing red flag by the sign when the plot needs you', () => mesh(flag()), (obj, t) => { obj.position.y = Math.abs(Math.sin(t * 5.5)) * 0.25; obj.rotation.y = Math.sin(t * 7) * 0.35; });
prop('soil-clod', 'tilled soil ridge (flips over when a field is tilled)', (o) => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const m = mesh(clod(o.season)); m.position.x = i * 1.2; g.add(m); } return g; },
  (obj, t) => obj.children.forEach((c, i) => { c.rotation.z = Math.PI * (1 - Math.min(1, Math.max(0, ((t % 4) - i * 0.3) / 0.6))); }));
prop('git-weed', 'dandelion tuft: a changed file not yet committed (pulled out when a commit lands)', () => mesh(dandelion()));
prop('git-pennant', 'branch pennant on the field sign (white: tinted by the branch name; main = Clawd terracotta)', () => mesh(pennant(), toon(0xd97757, { vertexColors: true })));
prop('fallow-weed', 'weed tuft creeping into fallow soil', () => mesh(weed()));
prop('plot-meadow', 'wild meadow + "Plot for rent" sign on a free site', (o) => {
  const g = new THREE.Group();
  const weedU = cropUniforms(0.22);
  const m = new Meadow([SITE], o.season, cropMaterial(weedU, { side: THREE.DoubleSide }));
  const b = new Batches();
  g.add(m.group, b.group);
  b.begin(); m.update(1, b, atlas(), o.season, 0); b.end();
  g.userData.meadow = { m, b, weedU };
  return g;
}, (obj, t) => { const d = obj.userData.meadow; if (!d) return; d.weedU.uTime.value = t; d.b.begin(); d.m.update(0.016, d.b, atlas(), 'summer', t); d.b.end(); });
