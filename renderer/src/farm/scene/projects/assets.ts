/** Gallery registrations for the Valley Projects' places (scene/projects builds through the same functions). Variants: ruin | restored. */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { Kit, canvasTex } from '../structures/kit.ts';
import {
  BOARD_FACE, FOOTBRIDGE, MILL, buildBoard, buildFootbridge, buildGlasshouse, buildHalt, buildLanternPath, buildMillHouse, buildObservatory,
  buildWheel, drawBoardFace,
} from './models.ts';

const V = ['ruin', 'restored'] as const;
const kitGroup = (k: Kit, night = 0) => k.build(new THREE.Group(), night);

defineAsset({
  name: 'projects-board', group: 'structure', note: 'the Mayor\'s Valley Projects board on the square (live cork face, contributions box)',
  build(o) {
    const k = new Kit(o.seed);
    buildBoard(k);
    const g = kitGroup(k, o.night);
    const c = canvasTex(512, 308);
    drawBoardFace(c.g, c.w, c.h, [
      { title: 'Lantern path', status: 'done', progress: 1, ready: false }, { title: 'Old footbridge', status: 'open', progress: 0.6, ready: false },
      { title: 'Glasshouse', status: 'open', progress: 1, ready: true }, { title: 'River mill', status: 'open', progress: 0.2, ready: false },
      { title: 'Observatory', status: 'open', progress: 0.05, ready: false }, { title: 'Train halt', status: 'locked', progress: 0, ready: false },
    ], 1);
    c.tex.needsUpdate = true;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_FACE.w, BOARD_FACE.h), new THREE.MeshBasicMaterial({ map: c.tex }));
    face.position.set(0, BOARD_FACE.y, BOARD_FACE.z);
    g.add(face);
    return g;
  },
});

defineAsset({
  name: 'project-lanterns', group: 'structure', note: 'the lantern path to the standing stones: knocked askew and dark, or upright and lit', variants: V,
  build(o) {
    const k = new Kit(o.seed);
    const spots = [0, 1, 2, 3].map((i) => ({ x: (i % 2 ? 1.4 : -1.4), y: 0, z: -i * 3.2 + 4.8, ry: i % 2 ? 0 : Math.PI }));
    buildLanternPath(k, spots, o.variant === 'restored');
    return kitGroup(k, o.night);
  },
});

defineAsset({
  name: 'project-footbridge', group: 'structure', note: 'the old footbridge: washed out in the middle, or mended with rope rails', variants: V,
  build(o) {
    const k = new Kit(o.seed);
    k.at({ ry: Math.PI / 2 }, () => buildFootbridge(k, { L: FOOTBRIDGE.L, w: FOOTBRIDGE.w, yA: 0.2, yB: 0, water: -1.1, bed: (z) => -2.5 + Math.abs(z) * 0.25 }, o.variant === 'restored'));
    const g = kitGroup(k, o.night);
    g.position.y = 1.2;
    return g;
  },
});

defineAsset({
  name: 'project-glasshouse', group: 'structure', note: 'the glasshouse: a bare frame and a heap of panes, or glazed and planted', variants: V,
  build(o) { const k = new Kit(o.seed); buildGlasshouse(k, o.variant === 'restored'); return kitGroup(k, o.night); },
});

defineAsset({
  name: 'project-mill', group: 'structure', note: 'the river mill: roofless with a jammed wheel (a boot in it), or roofed with the wheel turning', variants: V,
  build(o) {
    const k = new Kit(o.seed), restored = o.variant === 'restored';
    buildMillHouse(k, restored, -1.7, (z) => (z < 3.5 ? 0 : -1.0 - (z - 3.5) * 0.4));
    const g = kitGroup(k, o.night);
    const wk = new Kit(o.seed + 5);
    buildWheel(wk, restored);
    const w = wk.mesh();
    w.name = 'wheel';
    // (in the valley the axle sits just above the river; here the wheel stands on the lawn beside the house)
    w.position.set(0, MILL.wheelR + 0.05, MILL.wheelZ);
    g.add(w);
    g.userData.wheel = w;
    g.userData.spin = restored;
    return g;
  },
  animate(obj, _t, dt) { const w = obj.userData.wheel as THREE.Object3D | undefined; if (w && obj.userData.spin) w.rotation.z -= dt * 0.9; },
});

defineAsset({
  name: 'project-observatory', group: 'structure', note: 'the observatory: rusted shut and ivy-grown, or open with the telescope out (and a visitors\' scope)', variants: V,
  build(o) { const k = new Kit(o.seed); buildObservatory(k, o.variant === 'restored'); return kitGroup(k, o.night); },
});

defineAsset({
  name: 'project-halt', group: 'structure', note: 'the train halt: overgrown with a fallen roof, or swept with a bell, a lamp and a bench', variants: V,
  build(o) { const k = new Kit(o.seed); buildHalt(k, o.variant === 'restored'); return kitGroup(k, o.night); },
});
