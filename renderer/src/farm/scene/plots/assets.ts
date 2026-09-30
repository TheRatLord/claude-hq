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
import { cropMaterial, cropUniforms } from './materials.ts';
import { Meadow } from './meadow.ts';
import { apple, berries, berryBush, cabbage, fruitTree, grapes, lavender, pumpkin, pumpkinVine, sunflowerHead, sunflowerPlant, SUN_STEM, vineBlob, wheatClump, daisies, cosmos, grassTuft, wildflower } from './crops.ts';
import { cart, cartHeap, crate, fenceRibbon, fenceSegment, flag, lanternCore, LANTERN, scarecrow, signBoard, weed, clod } from './models.ts';
import { animalModel, SPECIES } from './animals.ts';
import type { SpeciesKey } from './animals.ts';

const SITE: Site = { index: 0, x: 0, z: 0, w: 18, d: 14, yaw: 0, y: 0, gate: { x: 0, z: 8.5 } };
const LABELS = ['hq-core', 'tinker', 'infra', 'webshop', 'ml-lab', 'docs-site', 'mobile', 'data-pipe', 'api-gw', 'blog', 'dotfiles', 'sandbox'];
let galleryAtlas: TextAtlas | null = null;
const atlas = () => (galleryAtlas ??= new TextAtlas());

const lit = () => toon(0xffffff, { vertexColors: true });
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
  const helper: HelperView = { id: 'gallery-helper', name: 'dev server', plotId: plot.id, spot: 1, activity: 'serve', running: true, exit: 'ok', label: 'npm run dev', ports: [5173] };
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
  if (o.season !== 'winter') for (let i = 0; i < 12; i++) { const a = mesh(apple(), toon(0xff5040, { vertexColors: true })); a.position.set(Math.cos(i * 2.1) * 0.95, 1.9 + Math.sin(i * 1.3) * 0.5, Math.sin(i * 2.1) * 0.95); g.add(a); }
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
// Animals

const IDLE_KEYS: SpeciesKey[] = ['chicken', 'cow', 'sheep', 'pig'];
for (const key of IDLE_KEYS) {
  defineAsset({
    name: key, group: 'animal', note: `${key} (instanced body / head / legs in the valley); names like ${SPECIES[key].names.slice(0, 3).join(', ')}`,
    build: (o) => animalModel(key, o.season),
    animate: (obj, t) => {
      const parts = obj.userData.parts as { body: THREE.Object3D; head: THREE.Object3D } | undefined;
      if (!parts) return;
      parts.head.rotation.y = Math.sin(t * 0.8) * 0.5;
      parts.head.rotation.x = key === 'chicken' ? (Math.sin(t * 5) > 0.6 ? 1.0 : 0) : Math.max(0, Math.sin(t * 0.5)) * SPECIES[key].graze;
      parts.body.scale.y = 1 + Math.sin(t * 2.2) * 0.015;
    },
  });
}

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
