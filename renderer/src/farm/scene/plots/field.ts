/**
 * One field: everything a workspace's plot shows at its site. Owns a few per-field instanced meshes (fence, soil,
 * crops) and a merged prop mesh; pushes its dynamic bits (sign, animals, scarecrows, cart, critters) into the shared
 * batches each frame. Lifecycle (tilling → growing → harvest → fallow → back to meadow) is derived from the PlotView
 * stage and its `stageSince`, so it is smooth and never snaps.
 */
import * as THREE from 'three';
import type { FarmerView, HelperView, PlotKind, PlotView, Season } from '../../model/types.ts';
import { ANIMAL_PLOTS } from '../../model/types.ts';
import { FALLOW_MS, HARVEST_MS, TILL_MS } from '../../model/valley.ts';
import type { Site } from '../../world/map.ts';
import { askSpot, benchSpot, doneSpot, helperSpot, signSpot, workSpot, SPOT_CLEAR } from '../../world/spots.ts';
import type { AgentPort } from '../../model/types.ts';
import type { Colliders, Interactions, LightEmitter, LightsService, SfxName, UiPort } from '../context.ts';
import { PAL, WORKSPACE_COLORS, toon } from '../toon.ts';
import type { Batches } from './batch.ts';
import type { TextAtlas } from './atlas.ts';
import { signPainter, tagPainter } from './atlas.ts';
import { cropDepthMaterial, cropMaterial, cropUniforms, atlasMaterial, partPoints, propMaterial, PART_N } from './materials.ts';
import type { CropUniforms } from './materials.ts';
import { cropLayout, decorClump, SUN_STEM } from './crops.ts';
import type { Clear, CropLayout, Slot } from './crops.ts';
import { bounce, clamp01, damp, lerp, merge, rng, singleSided, smooth01 } from './geo.ts';
import { partName } from '../parts.ts';
import {
  cart, cartHeap, clod, crate, exitRibbon, fenceRibbon, fenceSegment, flag, gatePosts, hiveGeo, kindProps, lanternCore, LANTERN, penTile, scarecrow,
  SACK_STACK, SIGN_TEXT, sack, signBoard, soilBed, sprinkler, textQuad, weed,
} from './models.ts';
import { Herd, penFor } from './animals.ts';
import type { Animal, HerdInput, SpeciesKey } from './animals.ts';
import { Bees } from './bees.ts';
import type { Fx } from './fx.ts';
import { warmEmitter } from '../lights/emitters.ts';

export interface FieldHooks {
  interact?: Interactions;
  colliders?: Colliders;
  ui?: UiPort;
  agents?: AgentPort;
  /** scarecrow lanterns light the field around them (scene/lights) */
  lights?: LightsService;
}

/** a running scarecrow's lantern as a local light: a small flickering warm pool on the post, the straw and the soil */
const LANTERN_LIGHT = new THREE.Color(1.0, 0.56, 0.22);

export interface FieldEnv {
  time: number; dt: number; now: number;
  season: Season; night: number;
  sunDir: THREE.Vector3; wind: { x: number; z: number };
  camQuat: THREE.Quaternion;
  /** player feet (world) + horizontal speed; null when there is no player (gallery) */
  player: { x: number; y: number; z: number; speed: number } | null;
  batches: Batches; fx: Fx; atlas: TextAtlas;
  /** shared crop material for weeds (uniforms driven by the system) */
  weedMat: THREE.Material;
  farmer(id: string): FarmerView | undefined;
  helper(id: string): HelperView | undefined;
  sound(name: SfxName, x: number, y: number, z: number, volume?: number): void;
  /** direction (world xz) toward the barn */
  barn: { x: number; z: number };
  /** a farmer's feet (world), refreshed a few times a second by the system; false when unknown */
  farmerPos?(id: string, out: THREE.Vector3): boolean;
}

export const KIND_PRODUCE: Record<PlotKind, number> = {
  wheat: PAL.wheat, pumpkins: PAL.pumpkin, cabbages: PAL.cabbage, sunflowers: PAL.sunflower, orchard: PAL.apple, vineyard: PAL.grape,
  berries: PAL.berry, chickens: 0xfbf0dc, cows: 0xf8f6ee, sheep: 0xf6f1e4, pigs: 0x9a6a3a, bees: 0xf0b030,
};
const SPECIES_OF: Partial<Record<PlotKind, SpeciesKey>> = { chickens: 'chicken', cows: 'cow', sheep: 'sheep', pigs: 'pig' };
const KIND_NAME: Record<PlotKind, string> = {
  wheat: 'wheat field', pumpkins: 'pumpkin patch', cabbages: 'cabbage rows', sunflowers: 'sunflower field', orchard: 'apple orchard', vineyard: 'vineyard',
  berries: 'berry bushes', chickens: 'chicken run', cows: 'cow pasture', sheep: 'sheep meadow', pigs: 'pig pen', bees: 'bee garden',
};

const GATE_HW = 1.6;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color(), _p = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

interface FenceSeg { x: number; z: number; yaw: number; len: number }
interface GroundTile { x: number; z: number; yaw: number; order: number; color: number | null; s: number }
interface HelperState { appear: number; rect: number[] | null; key: string; off: (() => void) | null; flick: number; light?: LightEmitter; lightOff?: () => void }
interface Weed { x: number; z: number; yaw: number; s: number; th: number }

export class Field {
  readonly root = new THREE.Group();
  readonly site: Site;
  readonly kind: PlotKind;
  readonly id: string;
  private plot: PlotView;
  readonly season: Season;
  private readonly hw: number;
  private readonly hd: number;
  private readonly color: number;
  private readonly siteM = new THREE.Matrix4();
  private readonly clears: Clear[] = [];

  private readonly segs: FenceSeg[] = [];
  /** the back fence's posts (crows perch there) */
  private readonly backSegs: number[] = [];
  private readonly fenceArr: Float32Array;
  private readonly ribbonCol: Float32Array;
  private readonly tiles: GroundTile[] = [];
  private readonly groundArr: Float32Array;
  private readonly groundCol: Float32Array;
  private readonly useTiles: boolean;
  private readonly decorArr: Float32Array;
  private readonly decorN: number;
  private readonly isPen: boolean;
  private readonly props: THREE.Mesh;
  private readonly layout: CropLayout;
  private readonly cropMeshes: (THREE.InstancedMesh | null)[] = [];
  private readonly cropU: CropUniforms[] = [];
  private readonly slotIndex: number[] = [];
  /** world parting points shared by every crop part's uniforms (farmers standing in the crop, the player) */
  private readonly partPts = partPoints();
  private readonly partsCrop: boolean;
  private readonly sprinklerAt: { x: number; z: number } | null;
  private readonly hives: { x: number; z: number }[] = [];
  private readonly weeds: Weed[] = [];
  readonly herd: Herd | null;
  private readonly bees: Bees | null = null;
  private herdIn: HerdInput | null = null;
  private readonly helpers = new Map<string, HelperState>();
  private readonly offs: (() => void)[] = [];
  private colliderOffs: (() => void)[] = [];

  // lifecycle state
  private tillP = 1;
  private harvestP = 0;
  private fallowT = 0;
  private closing = false;
  private closeP = 0;
  private gVis: number;
  private lastG = -1;
  private vigorS = 0;
  private dryK = 0;
  private thriveK = 0;
  private blockK = 0;
  private cratesK: number[] = [0, 0, 0, 0, 0, 0];
  private sacksK: number[] = [0, 0, 0, 0, 0, 0];
  private readonly workLast = new Map<string, number>();
  private banked = 0;
  /** perched / gleaning crows: 0 sitting … 1 flushed into the air (the player came close) */
  private crowUp: number[] = [0, 0, 0, 0];
  private crowK: number[] = [0, 0, 0, 0];
  private signKey = '';
  private signRect: number[] | null = null;
  private groundDirty = true;
  private groundTint = -1;
  private lastStage = '';
  private sparkleT = 0;
  private cropHidden = false;
  private cropSig = -1;
  private groundSig = -1;
  private fenceSig = -1;

  constructor(site: Site, plot: PlotView, season: Season, o: { fresh: boolean; hooks?: FieldHooks; barnLocal?: { x: number; z: number } }) {
    this.site = site;
    this.plot = plot;
    this.kind = plot.kind;
    this.id = plot.id;
    this.season = season;
    this.hw = site.w / 2;
    this.hd = site.d / 2;
    this.color = WORKSPACE_COLORS[plot.colorIndex % WORKSPACE_COLORS.length];
    this.hooks = o.hooks ?? {};
    this.root.name = `field:${plot.id}`;
    this.root.position.set(site.x, site.y, site.z);
    this.root.rotation.y = site.yaw;
    this.root.updateMatrix();
    this.siteM.copy(this.root.matrix);
    this.gVis = plot.growth;
    this.isPen = ANIMAL_PLOTS.includes(this.kind) && this.kind !== 'bees';
    if (!o.fresh) this.tillP = 1; else this.tillP = 0;

    const { hw, hd } = this;
    // spots to keep clear (site-local)
    const loc = (p: { x: number; z: number }) => this.toLocal(p.x, p.z);
    for (let i = 0; i < 8; i++) this.clears.push({ ...loc(workSpot(site, i)), r: SPOT_CLEAR });
    for (let i = 0; i < 4; i++) this.clears.push({ ...loc(askSpot(site, i)), r: SPOT_CLEAR });
    for (let i = 0; i < 6; i++) this.clears.push({ ...loc(doneSpot(site, i)), r: SPOT_CLEAR });
    for (let i = 0; i < 3; i++) this.clears.push({ ...loc(benchSpot(site, i)), r: SPOT_CLEAR });
    for (let i = 0; i < 5; i++) this.clears.push({ ...loc(helperSpot(site, i)), r: SPOT_CLEAR });
    for (let z = hd - 3.2; z < hd; z += 0.8) this.clears.push({ x: 0, z, r: 1.0 });
    // the yield sacks in the front-right corner
    this.clears.push({ x: hw - 1.3, z: hd - 1.0, r: 1.0 });

    // props
    const kp = kindProps(this.kind, hw, hd, season);
    for (const s of kp.solids) this.clears.push(s);
    const gp = gatePosts(GATE_HW, this.color, season);
    for (const g of gp) g.translate(0, 0, hd);
    for (const g of gp) partName(g, 'gate');
    const parts = [...kp.geo, ...gp];
    if (!ANIMAL_PLOTS.includes(this.kind) || this.kind === 'bees') {
      if (this.kind === 'vineyard') [-6.9, -3.6, 0, 3.6, 6.3].forEach((x, i) => parts.push(partName(soilBed(x - 0.55, x + 0.55, -hd + 0.75, hd - 2.4, season), `soilBed#${i}`)));
      else if (this.kind !== 'orchard') {
        parts.push(partName(soilBed(-hw + 0.6, hw - 1.95, -hd + 0.75, hd - 2.0, season), 'soilBed#0'));
      }
    }
    if (this.kind === 'bees') {
      [-4.6, -2.3, 2.2, 4.5].forEach((x, i) => { hiveGeo(parts, x, -hd + 1.3, i, season); this.hives.push({ x, z: -hd + 1.3 }); this.clears.push({ x, z: -hd + 1.3, r: 0.7 }); });
    }
    this.sprinklerAt = null;
    if (!this.isPen && this.kind !== 'orchard') {
      for (const c of [{ x: 0, z: -0.4 }, { x: -3.6, z: -0.4 }, { x: 3.6, z: -0.4 }, { x: 0, z: -4.4 }]) {
        if (this.clears.every((k) => (k.x - c.x) ** 2 + (k.z - c.z) ** 2 > (k.r + 0.5) ** 2)) { this.sprinklerAt = c; break; }
      }
      if (this.sprinklerAt) this.clears.push({ ...this.sprinklerAt, r: 0.5 });
    }
    this.props = new THREE.Mesh(merge(parts), propMaterial());
    this.props.castShadow = true;
    this.props.receiveShadow = true;
    this.props.name = 'props';
    this.root.add(this.props);

    // fence
    const run = (x0: number, z0: number, dx: number, dz: number, len: number) => {
      const n = Math.max(1, Math.round(len / 2)), l = len / n, yaw = Math.atan2(-dz, dx);
      for (let i = 0; i < n; i++) this.segs.push({ x: x0 + dx * l * i, z: z0 + dz * l * i, yaw, len: l });
    };
    run(-GATE_HW, hd, -1, 0, hw - GATE_HW);
    run(-hw, hd, 0, -1, hd * 2);
    run(-hw, -hd, 1, 0, hw * 2);
    run(hw, -hd, 0, 1, hd * 2);
    run(hw, hd, -1, 0, hw - GATE_HW);
    this.segs.forEach((sg, i) => { if (Math.abs(sg.z + hd) < 0.01 && sg.x > -hw + 0.5) this.backSegs.push(i); });
    this.fenceArr = new Float32Array(this.segs.length * 16);
    this.ribbonCol = new Float32Array(this.segs.length * 3);
    _c.set(this.color);
    for (let i = 0; i < this.segs.length; i++) _c.toArray(this.ribbonCol, i * 3);

    // ground: soil ridges for crops, worn tiles for pens / orchard
    const r = rng(`ground:${plot.id}`);
    const x0 = -hw + 0.9, x1 = hw - 2.0, z0 = -hd + 0.9, z1 = hd - 2.6;
    const benches = [0, 1, 2].map((i) => loc(benchSpot(site, i)));
    const blocked = (x: number, z: number, rad: number) => benches.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < (rad + 0.7) ** 2);
    const useTiles = this.useTiles = this.isPen || this.kind === 'orchard';
    if (!useTiles) {
      const rowXs: number[] = [];
      if (this.kind === 'vineyard') rowXs.push(-6.9, -3.6, 0, 3.6, 6.3);
      else for (let x = x0 + 0.3; x <= x1 + 1e-3; x += 1.2) rowXs.push(x);
      const zEnd = this.kind === 'vineyard' ? hd - 2.8 : z1 + 0.4;
      for (const x of rowXs) for (let z = z0 - 0.1; z <= zEnd; z += 1.3) {
        if (blocked(x, z, 0.4)) continue;
        if (Math.abs(x) < 1.0 && z > hd - 3.4) continue;
        this.tiles.push({ x, z: z + 0.5, yaw: r() < 0.5 ? 0 : Math.PI, order: (x - x0) / (x1 - x0) * 0.8 + r() * 0.2, color: null, s: 1 });
      }
    } else {
      const palette: Partial<Record<PlotKind, number[]>> = {
        chickens: [0xc8a878, 0xe0cf98, 0xd4bc88, 0xbfa070], cows: [0xb89c70, 0xd8c890], sheep: [0xd8c890, 0xc0a878],
        pigs: [0x9a7048, 0x8a6240, 0xa88058], orchard: [0x9a7c50, 0xa88a5c],
      };
      const pal = palette[this.kind] ?? [0xa88460];
      const near = (x: number, z: number, d: number) => kp.solids.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < (s.r + d) ** 2);
      if (this.kind === 'orchard') {
        // mulch rings under trees get placed after the layout (below)
      } else {
        const mud = this.kind === 'pigs' ? { x: -3.4, z: -0.6 } : null;
        for (let x = -hw + 1.0; x <= hw - 1.0; x += 1.2) for (let z = -hd + 0.9; z <= hd - 1.4; z += 1.2) {
          const px = x + (r() - 0.5) * 0.5, pz = z + (r() - 0.5) * 0.5;
          const reach = this.kind === 'chickens' ? 2.6 : this.kind === 'pigs' ? 2.2 : 1.5;
          const nearMud = mud && (px - mud.x) ** 2 + ((pz - mud.z) / 0.8) ** 2 < 3.2 ** 2;
          if (!near(px, pz, reach) && !nearMud) continue;
          if (r() < 0.3) continue;
          this.tiles.push({ x: px, z: pz, yaw: r() * Math.PI * 2, order: (px + hw) / (2 * hw) * 0.8 + r() * 0.2, color: pal[Math.floor(r() * pal.length)], s: 0.55 + r() * 0.4 });
        }
      }
    }

    // crops
    // work lanes: a tramline from each back-row work spot to the headland (tall crops only plant beside it)
    const lanes = [0, 1, 2, 3].map((i) => { const w = loc(workSpot(site, i)); return { x: w.x, z: w.z }; });
    this.layout = cropLayout(this.kind, hw, hd, this.clears, plot.id, lanes);
    this.partsCrop = this.layout.parts.some((pt) => (pt.part ?? 0) > 0);
    // crops stand on a ridge crest; where no ridge was laid (kept clear round the benches and the gate lane) they stand on the flat soil bed
    if (!useTiles) {
      for (const s of this.layout.slots) {
        if (s.parent >= 0) continue;
        if (!this.tiles.some((t) => Math.abs(t.x - s.x) < 0.42 && Math.abs(t.z - s.z) < 0.64)) s.y = 0.03;
      }
    }
    if (this.kind === 'orchard') {
      for (const s of this.layout.slots) if (s.part === 0) this.tiles.push({ x: s.x, z: s.z, yaw: r() * 6, order: s.sow, color: [0xa88a5c, 0x9a7c50][Math.floor(r() * 2)], s: 1.0 });
    }
    this.groundArr = new Float32Array(this.tiles.length * 16);
    this.groundCol = new Float32Array(this.tiles.length * 3).fill(1);

    const counts = this.layout.parts.map(() => 0);
    for (const s of this.layout.slots) this.slotIndex.push(counts[s.part]++);
    this.decorN = counts[counts.length - 1];
    this.decorArr = new Float32Array(this.decorN * 16);
    this.layout.parts.forEach((part, i) => {
      const u = cropUniforms(part.bend);
      u.uPart.value = this.partPts;
      u.uPartK.value = part.part ?? 0;
      if (part.growth === 'decor') { this.cropMeshes.push(null); this.cropU.push(u); return; }
      const mesh = new THREE.InstancedMesh(singleSided(part.geo(season)), cropMaterial(u, { side: THREE.DoubleSide }), Math.max(1, counts[i]));
      mesh.count = counts[i];
      mesh.castShadow = part.shadow;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = cropDepthMaterial(u);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `crop:${part.key}`;
      const colored = this.layout.slots.some((s) => s.part === i && s.color !== null);
      if (colored) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, counts[i]) * 3).fill(1), 3);
        this.layout.slots.forEach((s, k) => { if (s.part === i && s.color !== null) mesh.setColorAt(this.slotIndex[k], _c.set(s.color)); });
      }
      this.root.add(mesh);
      this.cropMeshes.push(mesh);
      this.cropU.push(u);
    });
    // local bounds for culling: the whole site
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), Math.hypot(hw, hd) + 2);
    for (const m of this.cropMeshes) if (m) { m.boundingSphere = sphere.clone(); m.frustumCulled = true; }

    // fallow weeds
    for (let i = 0; i < 46; i++) {
      const x = (r() * 2 - 1) * (hw - 1), z = (r() * 2 - 1) * (hd - 1.5) - 0.5;
      if (this.clears.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < c.r * c.r)) continue;
      this.weeds.push({ x, z, yaw: r() * 6.28, s: 0.7 + r() * 0.7, th: r() });
    }

    // animals
    const sk = SPECIES_OF[this.kind];
    if (sk) {
      const pen = penFor(this.kind, hw, hd, this.clears, this.segs);
      this.herd = new Herd(sk, pen, plot.id, sk === 'chicken' ? 9 : sk === 'sheep' ? 6 : sk === 'pig' ? 5 : 4, !o.fresh);
      if (this.hooks.interact) for (const a of this.herd.animals) this.offs.push(this.hooks.interact.add(this.petTarget(a)));
    } else this.herd = null;
    if (this.kind === 'bees') {
      const flowers = this.layout.slots.filter((_, i) => i % 7 === 0).slice(0, 24).map((sl) => ({ x: sl.x, y: 0.5, z: sl.z }));
      this.bees = new Bees({ hives: this.hives, flowers: flowers.length ? flowers : [{ x: 0, y: 0.5, z: 0 }] }, plot.id);
    }
    this.barnLocal = o.barnLocal ?? { x: -1, z: 0 };

    // interactables: the sign, hives
    const it = this.hooks.interact;
    if (it) {
      const sp = loc(signSpot(site));
      this.offs.push(it.add({
        id: `sign:${plot.id}`, kind: 'plot', verb: 'Read', label: () => `${this.plot.label} sign`, reach: 3.4,
        pos: (out) => out.set(sp.x, SIGN_TEXT.y, sp.z).applyMatrix4(this.siteM),
        enabled: () => !this.closing,
        use: () => this.hooks.ui?.say(this.describe(), 4200),
      }));
      this.hives.forEach((h, i) => this.offs.push(it.add({
        id: `hive:${plot.id}:${i}`, kind: 'prop', verb: 'Listen to', label: () => 'the beehive', reach: 3,
        pos: (out) => out.set(h.x, 0.9, h.z).applyMatrix4(this.siteM),
        use: () => {
          _p.set(h.x, 1.0, h.z).applyMatrix4(this.siteM);
          this.env?.sound('buzz', _p.x, _p.y, _p.z);
          for (let k = 0; k < 6; k++) this.env?.fx.spawn('sparkle', _p.x + (Math.random() - 0.5) * 0.6, _p.y + 0.3, _p.z + (Math.random() - 0.5) * 0.6, { vy: 0.4, life: 1, color: 0xffd060 });
          this.hooks.ui?.say('Bzzz… the hive hums contentedly.', 2500);
        },
      })));
    }
    this.writeFence(true);
  }
  private readonly hooks: FieldHooks;
  private readonly barnLocal: { x: number; z: number };
  private env: FieldEnv | null = null;

  toLocal(wx: number, wz: number): { x: number; z: number } {
    const dx = wx - this.site.x, dz = wz - this.site.z, c = Math.cos(this.site.yaw), s = Math.sin(this.site.yaw);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }

  private describe(): string {
    const p = this.plot;
    const n = p.farmers.length, h = p.helpers.length;
    const stage = { tilling: 'freshly tilled', thriving: 'thriving', growing: 'growing well', resting: 'resting in the sun', harvest: 'being harvested', fallow: 'fallow, resting' }[p.stage];
    const g = p.git;
    const weeds = g?.dirty ? ` ${g.dirty} weed${g.dirty === 1 ? '' : 's'} (changed files)` : '';
    const crates = g?.ahead ? `${weeds ? ',' : ''} ${g.ahead} crate${g.ahead === 1 ? '' : 's'} waiting to ship (unpushed)` : '';
    const repo = g ? ` Branch ${g.branch ?? 'detached'} of ${g.repo}.${weeds || crates ? `${weeds}${crates}.` : ' All tidy.'}` : '';
    return `${p.label} — ${KIND_NAME[this.kind]}, ${stage}. ${n} farmer${n === 1 ? '' : 's'}${h ? `, ${h} scarecrow${h === 1 ? '' : 's'}` : ''}.${repo}`;
  }

  private petTarget(a: Animal) {
    return {
      id: `animal:${a.id}`, kind: 'animal' as const, verb: 'Pet', label: () => a.name, reach: 2.6,
      pos: (out: THREE.Vector3) => this.herd!.headPos(a, this.siteM, out),
      enabled: () => a.appear > 0.8 && a.mode !== 'leave' && a.mode !== 'gone' && !this.closing,
      use: () => this.herd!.pet(a),
    };
  }

  /** 0..1 how much of the site's meadow this field has replaced */
  cover(): number {
    if (this.closing) return 1 - smooth01((this.closeP - 0.35) / 0.55);
    return smooth01(this.tillP / 0.3);
  }

  get done(): boolean { return this.closing && this.closeP >= 1; }

  /** the plot left the valley state: dissolve back into meadow */
  close(): void { if (!this.closing) { this.closing = true; this.closeP = 0; this.removeColliders(); } }

  /** local position → world (site matrix) */
  world(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 { return out.set(x, y, z).applyMatrix4(this.siteM); }

  update(env: FieldEnv, plot: PlotView | null): void {
    this.env = env;
    const { dt, now } = env;
    if (plot) this.plot = plot;
    const p = this.plot;
    // lifecycle progress from the model's stage clock
    if (this.closing) this.closeP = Math.min(1, this.closeP + dt / 3.2);
    else {
      const since = Math.max(0, now - p.stageSince);
      if (p.stage === 'tilling') { this.tillP = Math.min(1, since / TILL_MS); this.harvestP = 0; this.fallowT = 0; }
      else if (p.stage === 'harvest') { this.harvestP = Math.min(1, since / HARVEST_MS); this.tillP = 1; }
      else if (p.stage === 'fallow') { this.harvestP = 1; this.fallowT = since / 1000; this.tillP = 1; }
      else { this.tillP = 1; this.harvestP = 0; this.fallowT = 0; }
      if (p.stage !== this.lastStage) {
        if (p.stage === 'harvest') { const g = this.world(3.4, 0.8, this.hd + 1.6, _p); env.sound('creak', g.x, g.y, g.z); }
        this.lastStage = p.stage;
      }
    }
    const built = this.tillP >= 0.5 && !this.closing;
    if (built && !this.colliderOffs.length) this.addColliders();

    // smoothed look
    this.gVis = damp(this.gVis, p.growth, 0.8, dt);
    this.vigorS = damp(this.vigorS, p.vigor, 1.5, dt);
    this.dryK = damp(this.dryK, p.stage === 'resting' ? 1 : p.stage === 'fallow' ? 0.6 : 0, 0.6, dt);
    this.thriveK = damp(this.thriveK, p.stage === 'thriving' || p.stage === 'tilling' ? 1 : 0, 1, dt);
    this.blockK = damp(this.blockK, p.status === 'blocked' && !this.closing ? 1 : 0, 4, dt);

    this.updateParting(env);
    this.updateCrops(env);
    this.writeGround();
    this.writeFence(false);
    // props rise out of the ground
    const propK = this.closing ? 1 - smooth01((this.closeP - 0.45) / 0.3) : bounce(clamp01((this.tillP - 0.42) / 0.16));
    this.props.visible = propK > 0.002;
    this.props.scale.set(1, Math.max(0.001, propK), 1);
    if (this.tillP < 1 && this.tillP > 0.42 && this.tillP - dt / (TILL_MS / 1000) <= 0.42) { const g = this.world(0, 0.5, 0, _p); env.sound('pop', g.x, g.y, g.z); }

    this.drawStatic(env);
    this.drawSign(env);
    this.drawStatus(env);
    this.drawHelpers(env);
    this.drawCritters(env);
    this.drawHarvest(env);
    if (this.herd) this.updateHerd(env);
  }

  // -------------------------------------------------------------------------------------------------------------

  private growScale(slot: Slot): number {
    const part = this.layout.parts[slot.part];
    const gn = clamp01((this.gVis - 0.25) / 0.75);
    const boost = this.kind === 'pumpkins' && slot.part === 1 && this.season === 'autumn' ? 1.3 : this.season === 'spring' && part.growth === 'fruit' ? 0.7 : 1;
    // winter: a few pumpkins left to cure in the straw, the rest are in the store
    if (this.kind === 'pumpkins' && slot.part === 1 && this.season === 'winter' && slot.th > 0.22) return 0;
    if (part.growth === 'grow') return slot.s * lerp(part.min ?? 0.25, 1, Math.pow(gn, 0.7));
    if (part.growth === 'head') return slot.s * lerp(0.45, 1, gn);
    if (part.growth === 'decor') return slot.s;
    if (part.noWinter && this.season === 'winter') return 0;
    const th = slot.th * 1.05 - 0.3;
    return slot.s * boost * lerp(0.45, 1, gn) * smooth01((gn - th) / 0.18);
  }

  /** tall crops part round whoever stands in them: farmers of this field (slots 0..N-2) and the player (last slot) */
  private updateParting(env: FieldEnv): void {
    if (!this.partsCrop) return;
    const pts = this.partPts, ids = this.plot.farmers, dt = env.dt;
    const c = Math.cos(this.site.yaw), sn = Math.sin(this.site.yaw);
    const inside = (wx: number, wz: number) => {
      const dx = wx - this.site.x, dz = wz - this.site.z;
      return Math.abs(dx * c - dz * sn) < this.hw + 0.5 && Math.abs(dx * sn + dz * c) < this.hd + 0.5;
    };
    const live = !this.closing && this.harvestP < 1;
    for (let i = 0; i < PART_N; i++) {
      const pt = pts[i];
      let on = false, x = 0, z = 0, rad = 1.7;
      if (live && i < PART_N - 1) {
        if (i < ids.length && env.farmerPos?.(ids[i], _p) && inside(_p.x, _p.z)) { on = true; x = _p.x; z = _p.z; }
      } else if (live && env.player && inside(env.player.x, env.player.z)) { on = true; x = env.player.x; z = env.player.z; rad = 1.4; }
      if (on) {
        if (pt.w < 0.02 || (pt.x - x) ** 2 + (pt.y - z) ** 2 > 9) { pt.x = x; pt.y = z; }
        else { pt.x = damp(pt.x, x, 10, dt); pt.y = damp(pt.y, z, 10, dt); }
        pt.z = rad;
      }
      pt.w = damp(pt.w, on ? 1 : 0, on ? 5 : 2.5, dt);
      if (pt.w < 0.005) pt.w = 0;
    }
  }

  private updateCrops(env: FieldEnv): void {
    const L = this.layout;
    if (!L.slots.length) return;
    // uniforms
    const gn = clamp01((this.gVis - 0.25) / 0.75);
    this.cropU.forEach((u, i) => {
      const part = L.parts[i];
      u.uTime.value = env.time;
      (u.uWind.value as THREE.Vector2).set(env.wind.x * 0.45, env.wind.z * 0.45);
      u.uDroop.value = this.dryK * part.droop;
      // harvested annuals stand as dry straw stubble in the fallow soil
      u.uDry.value = this.harvestP >= 1 && !part.perennial ? 1 : this.dryK * 0.8;
      // spring fruit sets small and green (apples, grapes, berries, pumpkins); it ripens over the summer
      const spring = this.season === 'spring';
      // (young fruit only half green, so a new pumpkin patch / orchard still shows its colour from across the valley)
      u.uGreen.value = part.ripens ? Math.max((1 - smooth01((gn - 0.05) / 0.55)) * (part.growth === 'fruit' ? 0.5 : 0.85) + (spring ? 0.12 : 0), spring && part.growth === 'fruit' ? 0.7 : 0) : 0;
      u.uSat.value = 1 + 0.16 * this.thriveK - 0.04 * this.dryK;
      // winter wheat's shoots stay green through the snow (the reason it is sown in autumn)
      u.uSnow.value = this.season === 'winter' ? (this.kind === 'wheat' ? 0.2 : 0.55) : 0;
    });
    const sig = this.tillP * 3 + this.harvestP * 7 + this.closeP * 11;
    const animating = sig !== this.cropSig || this.tillP < 1 || (this.harvestP > 0 && this.harvestP < 1) || this.closing;
    this.cropSig = sig;
    const heads = this.kind === 'sunflowers';
    const gDirty = Math.abs(this.gVis - this.lastG) > 0.002;
    // harvested: annuals leave stubble (or nothing), perennials (trees, vines, bushes) stay without their fruit;
    // closing a field that was never harvested clears it at once
    const harvested = this.harvestP >= 1;
    const hidden = harvested || (this.closing && this.plot.stage !== 'harvest');
    const wasHidden = this.cropHidden;
    this.cropHidden = hidden;
    if (!animating && !gDirty && !heads && this.lastG >= 0 && hidden === wasHidden) return;
    this.lastG = this.gVis;
    const cleared = this.closing && !harvested && this.plot.stage !== 'harvest';
    this.cropMeshes.forEach((m, i) => { if (m) m.visible = !cleared && (!harvested || !!L.parts[i].perennial || !!L.parts[i].stubble); });
    if (hidden && !animating && wasHidden) return;
    // sun direction in site-local space
    const sy = -this.site.yaw;
    const sdx = env.sunDir.x * Math.cos(sy) + env.sunDir.z * Math.sin(sy), sdz = -env.sunDir.x * Math.sin(sy) + env.sunDir.z * Math.cos(sy);
    const sunYaw = Math.atan2(sdx, sdz), sunUp = Math.max(-0.2, env.sunDir.y);
    const cart = { x: 3.4, y: 1.0, z: this.hd + 1.6 };
    const slots = L.slots;
    const onlyHeads = !animating && !gDirty && heads;
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k];
      const part = L.parts[s.part];
      if (onlyHeads && part.growth !== 'head') continue;
      const sprout = smooth01((this.tillP - 0.55 - s.sow * 0.38) / 0.08);
      let sc = 0, x = s.x, y = s.y, z = s.z, yaw = s.yaw, pitch = s.tilt, sh = 1, sw = 1;
      if (s.parent >= 0) {
        const ps = slots[s.parent];
        const pScale = this.growScale(ps);
        const c = Math.cos(ps.yaw), sn = Math.sin(ps.yaw);
        const ox = s.ox * pScale, oy = s.oy * pScale, oz = s.oz * pScale;
        x = ps.x + ox * c + oz * sn; y = ps.y + oy; z = ps.z - ox * sn + oz * c;
        sc = (part.growth === 'head' ? lerp(0.6, 1, pScale) : pScale) * this.growScale(s) / Math.max(1e-3, s.s) * s.s;
        if (part.growth === 'head') {
          sc = this.growScale(s) * Math.max(0.5, pScale);
          const night = env.night;
          const t = env.time * 0.7 + s.sow * 20;
          const toSun = sunYaw + Math.sin(t) * 0.08;
          // winter: dry seed heads hang, left for the birds
          const hang = night > 0.6 || this.season === 'winter';
          yaw = hang ? Math.PI * 0.5 + (this.season === 'winter' ? s.sow * 3 : 0) : toSun;
          pitch = hang ? (this.season === 'winter' ? 1.15 : 0.9) : -Math.min(0.9, Math.max(0, sunUp) * 0.8) + 0.1 + Math.sin(t * 1.3) * 0.04;
          pitch += this.dryK * 0.85;
          y = ps.y + SUN_STEM * pScale;
        }
      } else sc = this.growScale(s);
      sc *= sprout;
      // harvest: pop up and arc into the cart (field-edge grass and perennial plants stay; annuals leave stubble)
      if (this.harvestP > 0 && part.growth !== 'decor' && !part.perennial) {
        const hv = clamp01((this.harvestP - s.reap * 0.55) / 0.3);
        if (hv >= 1) {
          if (part.stubble && s.parent < 0) { sw = part.stubble[1]; sh = part.stubble[0]; pitch = 0; }
          else sc = 0;
        }
        else if (hv > 0) {
          const e = smooth01(hv);
          x = lerp(x, cart.x, e); z = lerp(z, cart.z, e); y = lerp(y, cart.y, e) + Math.sin(Math.PI * e) * 2.2;
          sc *= (1 + 0.35 * Math.sin(Math.PI * Math.min(1, hv * 3))) * (1 - 0.55 * e);
          yaw += e * 6;
          if (hv > 0.85 && Math.random() < env.dt * (s.parent >= 0 || L.parts.length === 1 ? 1.2 : 0.4)) {
            const w = this.world(x, y, z, _p);
            env.fx.spawn('sparkle', w.x, w.y, w.z, { vy: 0.6, life: 0.7, size: 1.2, color: 0xfff0a0 });
          }
        }
      }
      if (this.closing) sc *= 1 - this.closeP;
      _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
      _m.compose(_v.set(x, y, z), _q, _s.set(sc * sw, sc * sh, sc * sw));
      const mesh = this.cropMeshes[s.part];
      if (mesh) mesh.setMatrixAt(this.slotIndex[k], _m);
      else _m.premultiply(this.siteM).toArray(this.decorArr, this.slotIndex[k] * 16);
      // sprout puffs
      if (this.tillP < 1 && sprout > 0 && sprout < 0.25 && s.parent < 0 && Math.random() < env.dt * 3) {
        const w = this.world(x, 0.1, z, _p);
        env.fx.spawn('puff', w.x, w.y, w.z, { vy: 0.6, vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 0.6, size: 0.7, color: 0x8a6440, spin: 3 });
      }
    }
    for (const m of this.cropMeshes) if (m) m.instanceMatrix.needsUpdate = true;
  }

  private writeGround(): void {
    const intro = this.tillP < 1, closing = this.closing;
    const st = this.plot.stage;
    const tint = st === 'fallow' ? 3 : st === 'thriving' ? 1 : st === 'resting' ? 2 : 0;
    const sig = this.tillP * 3 + this.closeP * 11;
    if (!intro && !closing && !this.groundDirty && tint === this.groundTint && sig === this.groundSig) return;
    this.groundSig = sig;
    this.groundDirty = false;
    this.groundTint = tint;
    const tc = [[1, 1, 1], [0.86, 0.84, 0.86], [1.06, 1.02, 0.92], [1.14, 1.06, 0.94]][tint];
    const pen = this.isPen || this.kind === 'orchard';
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      let e = smooth01((this.tillP - t.order * 0.3) / 0.15);
      if (closing) e = Math.min(e, 1 - smooth01((this.closeP - 0.08 - t.order * 0.35) / 0.18));
      const ang = Math.PI * (1 - e);
      const lift = Math.sin(Math.PI * e) * 0.35;
      if (pen) {
        const k = smooth01(e * 3);
        _q.setFromEuler(_e.set(ang, t.yaw, 0, 'YXZ'));
        _m.compose(_v.set(t.x, 0.03 + lift, t.z), _q, _s.set(t.s * k, k, t.s * k));
      } else {
        _q.setFromEuler(_e.set(0, t.yaw, ang, 'YXZ'));
        _m.compose(_v.set(t.x, 0.1 + lift - 0.2 * (1 - e), t.z), _q, ONE);
      }
      _m.premultiply(this.siteM).toArray(this.groundArr, i * 16);
      if (t.color !== null) _c.set(t.color); else _c.setRGB(1, 1, 1);
      if (!pen) _c.setRGB(_c.r * tc[0], _c.g * tc[1], _c.b * tc[2]);
      _c.toArray(this.groundCol, i * 3);
      // clods throw up dirt as they flip
      if (intro && e > 0.2 && e < 0.4 && this.env && Math.random() < this.env.dt * 2.5) {
        const w = this.world(t.x, 0.3, t.z, _p);
        this.env.fx.spawn('puff', w.x, w.y, w.z, { vy: 1.2, vx: (Math.random() - 0.5), vz: (Math.random() - 0.5), grav: 4, life: 0.7, size: 1, color: 0x7a5534, spin: 4 });
      }
    }
  }

  private writeFence(force: boolean): void {
    const sig = this.tillP * 3 + this.closeP * 11;
    if (!force && sig === this.fenceSig) return;
    this.fenceSig = sig;
    const n = this.segs.length;
    for (let i = 0; i < n; i++) {
      const s = this.segs[i];
      const di = (this.tillP - 0.06 - (i / n) * 0.42) / 0.1;
      let y = 0, sc = 1, sy = 1;
      if (di <= 0) sc = 0;
      else if (di < 1.6) {
        const b = bounce(clamp01(di));
        y = (1 - b) * 2.6;
        sy = 1 - 0.28 * Math.sin(Math.PI * clamp01((di - 0.55) / 0.5));
        if (this.env && di > 0.55 && di - this.env.dt / (TILL_MS / 1000) / 0.1 <= 0.55 && i % 3 === 0) {
          const w = this.world(s.x, 0.1, s.z, _p);
          this.env.sound('hammer', w.x, w.y, w.z, 0.5);
          this.env.fx.spawn('puff', w.x, w.y, w.z, { vy: 0.5, vx: 0.4, life: 0.5, size: 0.8, color: 0xa77b4f });
        }
      }
      if (this.closing) {
        const k = smooth01((this.closeP - 0.3 - (i / n) * 0.3) / 0.2);
        y += k * 1.2; sc *= 1 - k;
      }
      _q.setFromAxisAngle(_v.set(0, 1, 0), s.yaw);
      _m.compose(_v.set(s.x, y, s.z), _q, _s.set(sc * s.len / 2, sc * sy, sc));
      _m.premultiply(this.siteM).toArray(this.fenceArr, i * 16);
    }
  }

  // -------------------------------------------------------------------------------------------------------------

  private B: ReturnType<Field['makeBatches']> | null = null;
  private batchesFor(env: FieldEnv) { return (this.B ??= this.makeBatches(env)); }
  private makeBatches(env: FieldEnv) {
    const B = env.batches;
    const lit = propMaterial();
    return {
      sign: B.get(`sign:${this.season}`, () => ({ geo: signBoard(this.season), mat: lit, cap: 48, shadow: true })),
      text: B.get('signtext', () => ({ geo: textQuad().clone(), mat: atlasMaterial(env.atlas.tex), cap: 160, rect: true })),
      flag: B.get('flag', () => ({ geo: flag(), mat: lit, cap: 24, shadow: true })),
      crate: B.get('crate', () => ({ geo: crate(), mat: lit, cap: 80, shadow: true })),
      sack: B.get('sack', () => ({ geo: sack(), mat: lit, cap: 96, shadow: true })),
      cart: B.get('cart', () => ({ geo: cart(), mat: lit, cap: 12, shadow: true })),
      heap: B.get('cartheap', () => ({ geo: cartHeap(), mat: lit, cap: 12 })),
      scarecrow: B.get(`scarecrow:${this.season}`, () => ({ geo: scarecrow(this.season), mat: lit, cap: 48, shadow: true })),
      lantern: B.get('lantern', () => ({ geo: lanternCore(), mat: warmEmitter(new THREE.MeshBasicMaterial({ color: 0xffffff })), cap: 48 })),
      ribbon: B.get('exitribbon', () => ({ geo: exitRibbon(), mat: toon(0xffffff), cap: 48 })),
      sprinkler: B.get('sprinkler', () => ({ geo: sprinkler(), mat: lit, cap: 24 })),
      weed: B.get('weed', () => ({ geo: singleSided(weed()), mat: env.weedMat, cap: 900 })),
      fence: B.get(`fence:${this.season}`, () => ({ geo: fenceSegment(this.season), mat: lit, cap: 1000, shadow: true })),
      fenceRibbon: B.get('fenceribbon', () => ({ geo: fenceRibbon(), mat: lit, cap: 1000 })),
      clod: B.get(`clod:${this.season}`, () => ({ geo: clod(this.season), mat: lit, cap: 3200 })),
      tile: B.get('pentile', () => ({ geo: penTile(), mat: lit, cap: 2400 })),
      decor: B.get(`decor:${this.season}`, () => ({ geo: singleSided(decorClump(this.season)), mat: env.weedMat, cap: 7000 })),
    };
  }

  /** fence, ribbons, soil and edge grass: cached world matrices, copied into the shared batches */
  private drawStatic(env: FieldEnv): void {
    const b = this.batchesFor(env);
    const fenceUp = this.tillP > 0.06 && !(this.closing && this.closeP > 0.85);
    if (fenceUp) { b.fence.pushArray(this.fenceArr, this.segs.length); b.fenceRibbon.pushArray(this.fenceArr, this.segs.length, this.ribbonCol); }
    (this.useTiles ? b.tile : b.clod).pushArray(this.groundArr, this.tiles.length, this.groundCol);
    if (this.decorN && (this.tillP > 0.55 || this.closing)) b.decor.pushArray(this.decorArr, this.decorN);
  }

  private drawSign(env: FieldEnv): void {
    const b = this.batchesFor(env);
    const p = this.plot;
    const fallow = p.stage === 'fallow';
    // the sign's second line: the field's git branch when it has one (signals.md), else the crop
    const sub = p.git ? `on ${p.git.branch ?? (p.git.head ? `@${p.git.head}` : 'detached')}` : KIND_NAME[this.kind];
    const key = `sign:${p.id}:${p.label}:${this.color}:${fallow ? 'f' : 'l'}:${sub}`;
    if (key !== this.signKey) {
      if (this.signKey) env.atlas.release(this.signKey);
      this.signKey = key;
      this.signRect = env.atlas.acquire(key, fallow ? signPainter('Fallow', `resting · was ${p.label}`, this.color, { faded: true }) : signPainter(p.label, sub, this.color));
    }
    let k = bounce(clamp01((this.tillP - 0.5) / 0.12));
    if (this.closing) k *= 1 - smooth01((this.closeP - 0.4) / 0.3);
    if (k < 0.002) return;
    const sp = this.toLocal(signSpot(this.site).x, signSpot(this.site).z);
    const wob = Math.sin(env.time * 1.3 + this.site.index) * 0.015 + (1 - clamp01((this.tillP - 0.5) / 0.3)) * Math.sin(env.time * 20) * 0.08;
    _q.setFromEuler(_e.set(0, wob, fallow ? 0.06 : 0, 'YXZ'));
    _m.compose(_v.set(sp.x, 0, sp.z), _q, _s.set(k, k, k)).premultiply(this.siteM);
    b.sign.push(_m);
    _m2.compose(_v.set(0, SIGN_TEXT.y, SIGN_TEXT.z), _q.identity(), _s.set(SIGN_TEXT.w, SIGN_TEXT.h, 1));
    b.text.push(_m2.premultiply(_m), null, this.signRect!);
  }

  private drawStatus(env: FieldEnv): void {
    const b = this.batchesFor(env);
    const sp = this.toLocal(signSpot(this.site).x, signSpot(this.site).z);
    // blocked: bouncing red flag by the sign
    if (this.blockK > 0.01) {
      const hop = Math.abs(Math.sin(env.time * 5.5)) * 0.25;
      _q.setFromEuler(_e.set(0, Math.sin(env.time * 7) * 0.35, Math.sin(env.time * 5.5) * 0.05, 'YXZ'));
      const k = smooth01(this.blockK);
      _m.compose(_v.set(sp.x + 0.95, 1.1 * (1 - k) + hop * k, sp.z + 0.1), _q, _s.set(k, k, k)).premultiply(this.siteM);
      b.flag.push(_m);
    }
    // done: produce crates stacked by the gate
    let done = 0;
    for (const id of this.plot.farmers) { const f = env.farmer(id); if (f && (f.job === 'done' || f.unseenDone)) done++; }
    // (upper crates sit on the rims of the ones below; the produce in a crate stays under its rim)
    const stack = [[0, 0, 0], [0.66, 0, 0.05], [0.33, 0.43, 0.02], [1.32, 0, -0.02], [0.99, 0.43, 0.0], [0.66, 0.86, 0.02]];
    for (let i = 0; i < stack.length; i++) {
      this.cratesK[i] = damp(this.cratesK[i], !this.closing && i < Math.min(6, done * 2) ? 1 : 0, 5, env.dt);
      const k = this.cratesK[i];
      if (k < 0.01) continue;
      const [x, y, z] = stack[i];
      _q.setFromAxisAngle(_v.set(0, 1, 0), (i * 0.37) % 0.3 - 0.15);
      _m.compose(_v.set(2.7 + x, y + (1 - bounce(k)) * 1.5, this.hd + 1.2 + z), _q, _s.set(k, k, k)).premultiply(this.siteM);
      b.crate.push(_m);
    }
    // the field's yield: a burlap sack per step of work done in the workspace since the valley loaded (lines changed,
    // banked across tasks, log scale: 1 line … 1000+ lines = 6 sacks)
    for (const id of this.plot.farmers) {
      const f = env.farmer(id);
      if (!f?.work) continue;
      const v = f.work.added + f.work.removed, last = this.workLast.get(id);
      if (last === undefined) this.banked += v;
      else if (v !== last) this.banked += v > last ? v - last : v; // a new task restarts the count
      if (v !== last) this.workLast.set(id, v);
    }
    const nSacks = this.banked > 0 ? Math.ceil(6 * clamp01(Math.log10(1 + this.banked) / 3)) : 0;
    for (let i = 0; i < SACK_STACK.length; i++) {
      this.sacksK[i] = damp(this.sacksK[i], !this.closing && this.tillP >= 1 && i < nSacks ? 1 : 0, 4, env.dt);
      const k = this.sacksK[i];
      if (k < 0.01) continue;
      const [x, y, z] = SACK_STACK[i];
      _q.setFromAxisAngle(_v.set(0, 1, 0), i * 1.7 + this.site.index);
      _m.compose(_v.set(this.hw + x, y + (1 - bounce(k)) * 1.2, this.hd + z), _q, _s.set(k, k * (0.9 + (i % 3) * 0.07), k)).premultiply(this.siteM);
      b.sack.push(_m);
    }
    this.drawCrows(env);
    // struggle: crows circling the field
    let worst = 0;
    for (const id of this.plot.farmers) { const f = env.farmer(id); if (f && f.struggle > worst) worst = f.struggle; }
    if (worst >= 2 && !this.closing) {
      const n = worst >= 3 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const a = env.time * (0.55 + i * 0.07) + (i / n) * Math.PI * 2, rad = 3.2 + i * 0.7;
        const flap = 0.35 + 0.65 * Math.abs(Math.sin(env.time * 7 + i));
        _q.setFromEuler(_e.set(0, a + Math.PI, -0.35, 'YXZ'));
        _m.compose(_v.set(Math.cos(a) * rad, 6.5 + i * 0.6 + Math.sin(env.time * 1.3 + i) * 0.4, -Math.sin(a) * rad), _q, _s.set(flap * 1.6, 1.6, 1.6)).premultiply(this.siteM);
        env.fx.put('crow', _m);
      }
    }
  }

  /**
   * Crows that settle on the field: on the back fence posts while a farmer struggles (more the worse it gets) or the
   * field rests, and gleaning the stubble in fallow. They flush into the air when the player comes close and drift
   * back once you have gone.
   */
  private drawCrows(env: FieldEnv): void {
    let worst = 0;
    for (const id of this.plot.farmers) { const f = env.farmer(id); if (f && f.struggle > worst) worst = f.struggle; }
    const st = this.plot.stage;
    const fallow = st === 'fallow' && this.fallowT > 4;
    const want = this.closing || this.tillP < 1 || env.night > 0.6 ? 0 : worst >= 1 ? Math.min(4, worst + 1) : fallow ? 3 : st === 'resting' ? 1 : 0;
    const back = this.backSegs;
    for (let i = 0; i < 4; i++) {
      this.crowK[i] = damp(this.crowK[i], i < want ? 1 : 0, 1.2, env.dt);
      const k = this.crowK[i];
      if (k < 0.02) continue;
      // perch: a back-fence post (fallow: a spot in the stubble, from the weed spots that keep the paths clear)
      const glean = fallow && worst < 1 && this.weeds.length > i;
      let x: number, y: number, z: number;
      if (glean) { const w = this.weeds[(i * 7 + this.site.index) % this.weeds.length]; x = w.x; y = 0.14; z = w.z; }
      else { const sg = this.segs[back[(i * 2 + this.site.index) % back.length]]; x = sg.x; y = 1.27; z = sg.z; }
      let near = false;
      if (env.player) {
        const w = this.world(x, y, z, _p);
        near = (env.player.x - w.x) ** 2 + (env.player.z - w.z) ** 2 < (env.player.speed > 3 ? 64 : 30);
      }
      this.crowUp[i] = damp(this.crowUp[i], near ? 1 : 0, near ? 3 : 0.25, env.dt);
      const up = smooth01(this.crowUp[i]);
      const t = env.time + i * 1.7 + this.site.index;
      // sitting: a slow look about, a hop now and then, pecking when gleaning
      const hop = Math.max(0, Math.sin(t * 0.9) - 0.94) * 4;
      const peck = glean ? Math.max(0, Math.sin(t * 3.1)) * 0.7 : 0;
      const look = Math.sin(t * 0.7) * 0.9 + Math.sin(t * 0.23) * 0.6;
      const fly = 0.35 + 0.65 * Math.abs(Math.sin(env.time * 9 + i));
      const fx = up * Math.cos(i * 1.9) * 5, fz = up * Math.sin(i * 1.9) * 5;
      _q.setFromEuler(_e.set(-0.25 * (1 - up) + peck, look * (1 - up) + i * 1.9 * up, 0, 'YXZ'));
      const flapW = lerp(0.28, fly * 1.4, up);
      const sc = 1.25 * smooth01(k);
      _m.compose(_v.set(x + fx, y + hop * 0.12 + up * 5.5, z + fz), _q, _s.set(sc * flapW, sc, sc)).premultiply(this.siteM);
      env.fx.put('crow', _m);
    }
  }

  private drawHelpers(env: FieldEnv): void {
    const b = this.batchesFor(env);
    const seen = new Set<string>();
    for (const id of this.plot.helpers) {
      const h = env.helper(id);
      if (!h) continue;
      seen.add(id);
      let st = this.helpers.get(id);
      if (!st) {
        st = { appear: 0, rect: null, key: '', off: null, flick: Math.random() * 10 };
        this.helpers.set(id, st);
        const it = this.hooks.interact;
        if (it) {
          const hid = id;
          st.off = it.add({
            id: `helper:${hid}`, kind: 'helper', verb: 'Check on', label: () => env.helper(hid)?.tag ?? 'scarecrow', reach: 3.2,
            pos: (out) => { const sp = helperSpot(this.site, env.helper(hid)?.spot ?? 0); return out.set(sp.x, this.site.y + 1.6, sp.z); },
            enabled: () => !this.closing,
            use: () => this.hooks.ui?.helperCard(hid),
            alt: { verb: 'Open terminal', use: () => this.hooks.agents?.openTerminal(hid) },
          });
        }
      }
      st.appear = damp(st.appear, this.closing ? 0 : 1, 3, env.dt);
      const k = bounce(clamp01((st.appear - 0.05) / 0.9)) * clamp01(this.tillP * 2 - 0.8);
      if (k < 0.01) continue;
      const w = helperSpot(this.site, h.spot);
      const lp = this.toLocal(w.x, w.z);
      const sway = Math.sin(env.time * 1.1 + st.flick) * 0.03 + env.wind.x * 0.01;
      _q.setFromEuler(_e.set(0, -Math.PI / 2 + Math.sin(env.time * 0.3 + st.flick) * 0.05, sway, 'YXZ'));
      const sm = _m.compose(_v.set(lp.x, 0, lp.z), _q, _s.set(k, k, k)).premultiply(this.siteM);
      b.scarecrow.push(sm);
      // lantern
      st.flick += env.dt;
      const lit = h.running;
      const fl = lit ? 0.85 + 0.15 * Math.sin(st.flick * 13) * Math.sin(st.flick * 7.3 + 1) : 0;
      const glow = lit ? (0.75 + env.night * 0.4) * fl : 0;
      _c.setRGB(lit ? glow * 1.0 : 0.22, lit ? glow * 0.62 : 0.18, lit ? glow * 0.22 : 0.14);
      _m2.compose(_v.set(LANTERN.x, LANTERN.y, LANTERN.z), _q.identity(), ONE).premultiply(sm);
      b.lantern.push(_m2, _c);
      if (lit) {
        _p.setFromMatrixPosition(_m2);
        _c.setRGB(1.5 * fl, 0.95 * fl, 0.4 * fl).multiplyScalar(0.12 + env.night * 0.3);
        env.fx.billboard('halo', _p.x, _p.y, _p.z, (0.5 + env.night * 0.5) * k, _c);
        if (this.hooks.lights && !st.light) {
          st.light = { pos: new THREE.Vector3(), color: LANTERN_LIGHT, intensity: 0, radius: 4.2, flicker: 0.6 };
          st.lightOff = this.hooks.lights.add(st.light);
        }
      }
      if (st.light) { st.light.pos.setFromMatrixPosition(_m2); st.light.intensity = lit ? 0.6 * k : 0; }
      // exit ribbon
      if (h.exit) {
        _c.set(h.exit === 'ok' ? PAL.ok : PAL.alertRed);
        _m2.compose(_v.set(0, 1.28, 0), _q.identity(), ONE).premultiply(sm);
        b.ribbon.push(_m2, _c);
      }
      // tag: command + ports, facing the path (both sides)
      const line2 = h.ports.length ? h.ports.map((p) => `:${p}`).join(' ') : lit ? `${h.activity} · running` : h.exit === 'fail' ? 'last run failed' : h.exit === 'ok' ? 'last run ok' : 'idle';
      const key = `tag:${h.label}|${line2}|${lit ? 1 : 0}`;
      if (key !== st.key) {
        if (st.key) env.atlas.release(st.key);
        st.key = key;
        const pretty = (h.label || h.name).replace(/^(node|npx|python3?|bash|sh)\s+/, '').replace(/^\S*\/(?=\S)/, '');
        st.rect = env.atlas.acquire(key, tagPainter(pretty, line2, lit ? PAL.lampGlow : h.exit === 'fail' ? PAL.alertRed : PAL.metal));
      }
      for (const back of [0, 1]) {
        _q.setFromEuler(_e.set(0, back ? Math.PI : 0, Math.sin(env.time * 1.7 + st.flick) * 0.08, 'YXZ'));
        _m2.compose(_v.set(-0.62, 1.2, back ? 0.035 : 0.055), _q, _s.set(0.72, 0.36, 1)).premultiply(sm);
        b.text.push(_m2, null, st.rect!);
      }
    }
    for (const [id, st] of this.helpers) if (!seen.has(id)) { st.off?.(); st.lightOff?.(); if (st.key) env.atlas.release(st.key); this.helpers.delete(id); }
  }

  private drawCritters(env: FieldEnv): void {
    const b = this.batchesFor(env);
    const alive = !this.closing && this.harvestP === 0 && this.tillP >= 1;
    // sprinkler: always stands in crop fields; sprays while thriving
    if (this.sprinklerAt && this.plot.stage !== 'fallow' && !this.closing) {
      const s = this.sprinklerAt;
      const k = clamp01((this.tillP - 0.5) / 0.2);
      // (the axis must not reuse _v: it was overwriting the position and the sprinkler hovered at the field centre)
      _q.setFromAxisAngle(_v.set(0, 1, 0), env.time * 2.4);
      _m.compose(_v.set(s.x, 0, s.z), _q, _s.set(k, k, k)).premultiply(this.siteM);
      b.sprinkler.push(_m);
      if (alive && this.thriveK > 0.5 && env.fx) {
        const n = Math.random() < env.dt * 70 ? 2 : 0;
        for (let i = 0; i < n; i++) {
          const a = env.time * 2.4 + (i ? Math.PI : 0) + (Math.random() - 0.5) * 0.3;
          const sp = 2.6 + Math.random() * 1.2;
          const c = Math.cos(a + this.site.yaw), sn = Math.sin(a + this.site.yaw);
          const w = this.world(s.x, 0.85, s.z, _p);
          env.fx.spawn('drop', w.x, w.y, w.z, { vx: c * sp, vz: -sn * sp, vy: 2.6 + Math.random(), grav: 9.8, life: 0.75, size: 1, color: 0xa8dcff, spin: 2 });
        }
      }
    }
    // butterflies over lively crop fields in daylight
    if (alive && !this.isPen && env.night < 0.5 && this.vigorS > 0.15) {
      const n = this.plot.stage === 'thriving' ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const t = env.time * 0.35 + i * 2.1 + this.site.index;
        const x = Math.sin(t * 0.9 + i) * this.hw * 0.7, z = Math.cos(t * 0.63 + i * 1.7) * this.hd * 0.6;
        const y = 1.1 + Math.sin(t * 3.1) * 0.35 + (this.kind === 'sunflowers' || this.kind === 'orchard' ? 1.2 : 0);
        const dx = Math.cos(t * 0.9 + i) * 0.9, dz = -Math.sin(t * 0.63 + i * 1.7) * 0.63;
        const flap = 0.25 + 0.75 * Math.abs(Math.sin(env.time * 16 + i * 3));
        _q.setFromEuler(_e.set(0, Math.atan2(dx, dz), 0, 'YXZ'));
        _m.compose(_v.set(x, y, z), _q, _s.set(flap * 1.5, 1.5, 1.5)).premultiply(this.siteM);
        env.fx.put('butterfly', _m, _c.set([0xfff6e0, 0xffd84a, 0xff9a4a, 0x9ad0ff][(i + this.site.index) % 4]));
      }
    }
    // bees between the hives and the flowers
    if (this.kind === 'bees' && !this.closing && this.tillP >= 1 && this.harvestP < 1) {
      this.bees?.update(env.dt, env.time, env.batches, this.siteM, { vigor: this.vigorS, night: env.night, resting: this.plot.stage === 'resting', alive: 1 - this.harvestP });
      if (env.player) {
        const w = this.world(0, 0, 0, _p);
        const d = Math.hypot(env.player.x - w.x, env.player.z - w.z);
        if (d < 12 && Math.random() < env.dt * 0.08) { const hv = this.hives[0]; const q = this.world(hv.x, 1, hv.z, _p); env.sound('buzz', q.x, q.y, q.z, 0.5); }
      }
    }
    // fallow weeds creep in
    if (this.plot.stage === 'fallow' || (this.closing && this.harvestP >= 1)) {
      const t = this.fallowT / (FALLOW_MS / 1000);
      for (const w of this.weeds) {
        let k = smooth01((t * 2.2 + 0.25 - w.th) / 0.25);
        if (this.closing) k *= 1 - smooth01(this.closeP / 0.35);
        if (k < 0.01) continue;
        _q.setFromAxisAngle(_v.set(0, 1, 0), w.yaw);
        _m.compose(_v.set(w.x, 0.12, w.z), _q, _s.setScalar(w.s * k)).premultiply(this.siteM);
        b.weed.push(_m);
      }
    }
  }

  private drawHarvest(env: FieldEnv): void {
    const b = this.batchesFor(env);
    // cart: rolls in along the front fence at the start of the harvest, leaves early in fallow
    let k = 0, x = 3.4;
    if (this.plot.stage === 'harvest' && !this.closing) { const e = smooth01(this.harvestP / 0.14); k = e; x = lerp(12, 3.4, e); }
    else if (this.plot.stage === 'fallow' && !this.closing) { const e = smooth01((this.fallowT - 0.6) / 2.8); k = 1 - e; x = lerp(3.4, 13, e); }
    if (k < 0.01) return;
    const z = this.hd + 1.6;
    const bumpy = Math.sin(env.time * 9) * 0.02 * (x !== 3.4 ? 1 : 0);
    _q.setFromEuler(_e.set(0, 0, bumpy, 'YXZ'));
    _m.compose(_v.set(x, 0, z), _q, _s.set(k, k, k)).premultiply(this.siteM);
    b.cart.push(_m);
    const fill = this.plot.stage === 'fallow' ? 1 : smooth01((this.harvestP - 0.2) / 0.7);
    if (fill > 0.02) {
      _m2.compose(_v.set(0, -0.35 * (1 - fill), 0), _q.identity(), _s.set(1, Math.max(0.05, fill), 1)).premultiply(_m);
      b.heap.push(_m2, _c.set(KIND_PRODUCE[this.kind]));
    }
  }

  private updateHerd(env: FieldEnv): void {
    const herd = this.herd!;
    const inp = (this.herdIn ??= {
      dt: 0, time: 0, lively: 0, sleepy: 0, player: { x: 0, z: 0, speed: 0, near: false }, arrive: 1, leave: 0, growth: 0,
      barn: this.barnLocal, fx: null, site: this.siteM, sound: (n, x, y, z, v) => this.env?.sound(n, x, y, z, (v ?? 1) * 0.7),
    });
    const pl = inp.player;
    pl.near = false;
    if (env.player) {
      const dx = env.player.x - this.site.x, dz = env.player.z - this.site.z, c = Math.cos(this.site.yaw), s = Math.sin(this.site.yaw);
      pl.x = dx * c - dz * s; pl.z = dx * s + dz * c; pl.speed = env.player.speed;
      pl.near = Math.abs(pl.x) < this.hw + 6 && Math.abs(pl.z) < this.hd + 6;
    }
    inp.dt = env.dt; inp.time = env.time; inp.fx = env.fx;
    inp.lively = clamp01(this.vigorS * 0.7 + this.thriveK * 0.5);
    inp.sleepy = Math.max(this.dryK, env.night > 0.75 ? 0.9 : 0);
    inp.arrive = this.tillP < 1 ? clamp01((this.tillP - 0.45) / 0.55) : 1;
    inp.leave = this.harvestP > 0 ? clamp01(this.harvestP * 1.3) : this.closing ? 1 : 0;
    inp.growth = clamp01((this.gVis - 0.25) / 0.75);
    herd.update(inp);
    // reopened after a harvest: bring the herd back
    let allGone = this.plot.stage === 'tilling';
    for (let i = 0; allGone && i < herd.animals.length; i++) if (herd.animals[i].life !== 'gone') allGone = false;
    if (allGone) {
      herd.animals.forEach((a, i) => { a.life = 'arrive'; a.appear = 0; a.x = (Math.random() - 0.5) * 2; a.z = this.hd + 3 + i * 1.1; a.yaw = Math.PI; });
    }
    herd.draw(env.batches, this.siteM, this.season, inp.growth);
  }

  /** animals near a local point (farmers can ask) */
  animals(): readonly Animal[] { return this.herd?.animals ?? []; }
  /** a farmer pets animal `id` (same reaction as the player's pet) */
  petAnimal(id: string): void {
    const a = this.herd?.animals.find((x) => x.id === id);
    if (a && a.appear > 0.8 && a.mode !== 'leave' && a.mode !== 'gone' && !this.closing) this.herd!.pet(a);
  }

  private addColliders(): void {
    const c = this.hooks.colliders;
    if (!c) return;
    const { hw, hd } = this;
    const rect = (lx: number, lz: number, w: number, d: number) => {
      const p = siteWorld(this.site, lx, lz);
      this.colliderOffs.push(c.rect(p.x, p.z, w, d, this.site.yaw));
    };
    rect(0, -hd, hw * 2 + 0.2, 0.22);
    rect(-hw, 0, 0.22, hd * 2 + 0.2);
    rect(hw, 0, 0.22, hd * 2 + 0.2);
    const fl = hw - GATE_HW;
    rect(-(GATE_HW + fl / 2), hd, fl + 0.2, 0.22);
    rect(GATE_HW + fl / 2, hd, fl + 0.2, 0.22);
    for (const s of kindProps(this.kind, hw, hd, this.season).solids) {
      const p = siteWorld(this.site, s.x, s.z);
      this.colliderOffs.push(c.circle(p.x, p.z, s.r * 0.8));
    }
    for (const h of this.hives) { const p = siteWorld(this.site, h.x, h.z); this.colliderOffs.push(c.circle(p.x, p.z, 0.45)); }
  }
  private removeColliders(): void { for (const f of this.colliderOffs) f(); this.colliderOffs = []; }

  dispose(atlas: TextAtlas | null): void {
    this.removeColliders();
    for (const f of this.offs) f();
    for (const st of this.helpers.values()) { st.off?.(); st.lightOff?.(); if (st.key) atlas?.release(st.key); }
    if (this.signKey) atlas?.release(this.signKey);
    this.root.removeFromParent();
    this.props.geometry.dispose();
    for (const m of this.cropMeshes) if (m) { m.dispose(); (m.material as THREE.Material).dispose(); m.customDepthMaterial?.dispose(); }
  }

  stats(): { crops: number; tiles: number; fence: number } {
    return { crops: this.layout.slots.length, tiles: this.tiles.length, fence: this.segs.length };
  }
}

function siteWorld(site: Site, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  return { x: site.x + lx * c + lz * s, z: site.z - lx * s + lz * c };
}
