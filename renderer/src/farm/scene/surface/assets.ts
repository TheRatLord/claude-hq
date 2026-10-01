/** Gallery: every surface on a block (slab, wall, roof, log, trunk or blob, whichever shows it best), labelled. */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { PAL, facet, paint } from '../toon.ts';
import { SURF } from './ids.ts';
import type { SurfName, SurfTag } from './ids.ts';
import { surfaceMaterial, tagSurface } from './material.ts';

type Shape = 'slab' | 'block' | 'wall' | 'roof' | 'log' | 'trunk' | 'blob';
interface Swatch { surf: SurfName; shape: Shape; color: number; tag?: SurfTag; label?: string }

const COLOR: Partial<Record<SurfName, number>> = {
  grass: PAL.grass, meadow: PAL.meadow, soil: PAL.soil, dirt: PAL.dirt, cobble: PAL.stone, sand: PAL.sand, pebbles: 0xa39b8e,
  rock: PAL.rock, cliff: PAL.cliff, snow: PAL.snow, planks: PAL.plank, logs: 0xc99a64, bark: 0x7a5236, shingle: PAL.roofBrown,
  tile: PAL.roofRed, thatch: 0xd2ad62, brick: PAL.wallRed, fieldstone: PAL.stone, plaster: PAL.wallCream, metal: PAL.metal,
  fabric: PAL.cloth, hay: PAL.hay, leaves: PAL.leaf, plain: 0xb0a898,
};
const SHAPE: Partial<Record<SurfName, Shape>> = {
  grass: 'slab', meadow: 'slab', soil: 'slab', dirt: 'slab', cobble: 'slab', sand: 'slab', pebbles: 'slab', snow: 'slab',
  rock: 'block', cliff: 'wall', planks: 'block', logs: 'log', bark: 'trunk', shingle: 'roof', tile: 'roof', thatch: 'roof',
  brick: 'wall', fieldstone: 'wall', plaster: 'wall', metal: 'wall', fabric: 'wall', hay: 'block', leaves: 'blob', plain: 'block',
};
const sw = (surf: SurfName, tag?: SurfTag, label?: string, shape?: Shape): Swatch => ({ surf, shape: shape ?? SHAPE[surf] ?? 'block', color: COLOR[surf] ?? 0xffffff, tag, label });

const FAMILIES: Record<string, Swatch[]> = {
  all: (Object.keys(SURF) as SurfName[]).filter((n) => n !== 'inherit').map((n) => sw(n)),
  ground: ['grass', 'meadow', 'soil', 'dirt', 'cobble', 'sand', 'pebbles', 'snow'].map((n) => sw(n as SurfName)),
  wood: [sw('planks'), sw('planks', { variant: 1 }, 'planks·weathered'), sw('planks', { variant: 2 }, 'planks·painted', 'wall'),
    sw('planks', { axis: 'h' }, 'planks·h siding', 'wall'), sw('logs', { axis: 'x' }), sw('logs', { axis: 'x', variant: 1 }, 'logs·bark'),
    sw('bark'), sw('bark', { variant: 1 }, 'bark·birch')],
  roofs: [sw('shingle'), sw('shingle', { variant: 1 }, 'shingle·mossy'), sw('tile'), sw('thatch'), sw('shingle', { scale: 1.6 }, 'shingle ×1.6')],
  walls: [sw('brick'), sw('fieldstone'), sw('plaster'), sw('planks', { axis: 'h' }, 'siding'), sw('brick', { scale: 0.7 }, 'brick ×0.7'), sw('cliff')],
  made: [sw('metal'), sw('metal', { variant: 1 }, 'metal·corrugated'), sw('metal', { variant: 2 }, 'metal·rusty'), sw('fabric'), sw('hay')],
  nature: [sw('rock'), sw('rock', {}, 'rock (boulder)', 'blob'), sw('cliff'), sw('leaves'), sw('leaves', { variant: 1 }, 'leaves·needles'), sw('bark')],
};

const VARIANTS: Partial<Record<SurfName, string[]>> = {
  planks: ['weathered', 'painted'], logs: ['bark'], bark: ['birch'], shingle: ['mossy'], metal: ['corrugated', 'rusty'], leaves: ['needles'],
};
/** One surface: default, its variants, and ×0.6 / ×1.6 scale. */
function single(n: SurfName): Swatch[] {
  const axis = n === 'logs' ? { axis: 'x' as const } : {};
  return [sw(n, axis), ...(VARIANTS[n] ?? []).map((v, i) => sw(n, { ...axis, variant: i + 1 }, `${n}·${v}`)),
    sw(n, { ...axis, scale: 0.6 }, `${n} ×0.6`), sw(n, { ...axis, scale: 1.6 }, `${n} ×1.6`)];
}

function shapeGeometry(shape: Shape): THREE.BufferGeometry {
  switch (shape) {
    case 'slab': return new THREE.BoxGeometry(1.6, 0.25, 1.6).translate(0, 0.125, 0);
    case 'block': return new THREE.BoxGeometry(1.2, 1.0, 1.2).translate(0, 0.5, 0);
    case 'wall': return new THREE.BoxGeometry(1.6, 1.5, 0.4).translate(0, 0.75, 0);
    case 'roof': {
      const sh = new THREE.Shape([new THREE.Vector2(-0.9, 0), new THREE.Vector2(0.9, 0), new THREE.Vector2(0, 0.95)]);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 1.5, bevelEnabled: false });
      return g.translate(0, 0, -0.75).rotateY(Math.PI / 2);
    }
    case 'log': return new THREE.CylinderGeometry(0.4, 0.4, 1.6, 9).rotateZ(Math.PI / 2).translate(0, 0.4, 0);
    case 'trunk': return new THREE.CylinderGeometry(0.3, 0.42, 1.8, 7).translate(0, 0.9, 0);
    case 'blob': return new THREE.IcosahedronGeometry(0.75, 1).scale(1, 0.85, 1).translate(0, 0.7, 0);
  }
}

function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(40,32,26,0.78)';
  x.beginPath(); x.roundRect(2, 2, 252, 44, 12); x.fill();
  x.fillStyle = '#fff6e4'; x.font = 'bold 26px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, fog: false }));
  s.scale.set(0.95, 0.18, 1);
  return s;
}

/** One labelled swatch (also useful for quick experiments: `swatch('brick', { scale: 0.8 })`). */
export function swatch(s: Swatch, amount = 1): THREE.Group {
  const g = new THREE.Group();
  const geo = facet(shapeGeometry(s.shape));
  paint(geo, s.color);
  tagSurface(geo, SURF[s.surf], s.tag ?? (s.surf === 'logs' ? { axis: 'x' } : {}));
  const mesh = new THREE.Mesh(geo, surfaceMaterial({ vertexColors: true, amount }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  const l = label(s.label ?? s.surf);
  l.position.y = s.shape === 'slab' ? 0.75 : s.shape === 'wall' || s.shape === 'trunk' ? 2.05 : 1.55;
  g.add(l);
  return g;
}

defineAsset({
  name: 'surfaces', group: 'terrain', variants: [...Object.keys(FAMILIES), 'compare', ...(Object.keys(SURF) as SurfName[]).filter((n) => n !== 'inherit' && n !== 'plain')],
  note: 'surface library (scene/surface): every hand-painted surface; variants = families; compare = off | on',
  build: (o) => {
    const root = new THREE.Group();
    if (o.variant === 'compare') {
      const list = ['grass', 'planks', 'shingle', 'brick', 'bark', 'rock'] as SurfName[];
      list.forEach((n, i) => {
        for (const on of [0, 1]) {
          const s = swatch(sw(n, undefined, `${n} ${on ? 'on' : 'off'}`), on);
          s.position.set((i % 3) * 4.2 - 4.2 + on * 1.9 - 0.95, 0, Math.floor(i / 3) * 3 - 1.5);
          root.add(s);
        }
      });
      return root;
    }
    const v = o.variant ?? 'all';
    const list = FAMILIES[v] ?? (v in SURF ? single(v as SurfName) : FAMILIES.all);
    const cols = list.length > 12 ? 6 : list.length > 6 ? 4 : 3, gap = 2.3;
    const rows = Math.ceil(list.length / cols);
    list.forEach((s, i) => {
      const m = swatch(s);
      m.position.set((i % cols - (cols - 1) / 2) * gap, 0, (Math.floor(i / cols) - (rows - 1) / 2) * gap * 1.1);
      root.add(m);
    });
    return root;
  },
});
