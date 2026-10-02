/**
 * Lights out: each villager who sleeps indoors has their own window (an upstairs window of the farmhouse for Posy
 * and the Mayor, one of the windmill's for Hazel and Nimbus's loft, the toolshed's for Bram). While they are asleep a
 * curtain is drawn across it, so the warm glow of that one window goes out at bedtime and comes back in the morning.
 *
 * One instanced box (≤ 6 instances, toon, instance colours): 1 draw call while anybody sleeps, none otherwise.
 * The window positions are the structures' own (scene/structures/farmhouse.ts `windowUnit` calls, landmarks.ts's
 * windmill windows, hub.ts's toolshed), in each structure's local frame.
 */
import * as THREE from 'three';
import { structure } from '../../world/map.ts';
import type { StructureId } from '../../world/map.ts';
import { WINDMILL } from '../structures/landmarks.ts';
import { toon } from '../toon.ts';

/** a window: its structure, the pane's centre (local), its facing (local yaw), and the pane's size */
interface Pane { at: StructureId; x: number; y: number; z: number; ry: number; w: number; h: number }

/** the windmill's tapered wall radius at height y (landmarks.ts windows) */
const millR = (y: number) => WINDMILL.r0 - 0.2 - ((WINDMILL.r0 - 0.2 - WINDMILL.r1) * (y - 2.8)) / (WINDMILL.h - 2.8);
const millPane = (a: number, y: number): Pane => { const r = millR(y) + 0.105; return { at: 'windmill', x: Math.sin(a) * r, y, z: Math.cos(a) * r, ry: a, w: 0.57, h: 0.72 }; };

/** whose window is whose (farmhouse upper floor: D2 / 2 = 3.4, the pane 0.07 proud of the wall unit) */
export const WINDOWS: Readonly<Record<string, Pane>> = Object.freeze({
  'villager:posy': { at: 'farmhouse', x: -2.65, y: 4.5, z: 3.4 + 0.105, ry: 0, w: 1.07, h: 1.12 },
  'villager:marigold': { at: 'farmhouse', x: 2.65, y: 4.5, z: 3.4 + 0.105, ry: 0, w: 1.07, h: 1.12 },
  'villager:hazel': millPane(0.9, 3.2),
  'villager:nimbus': millPane(0.2, 7.2),
  'villager:bram': { at: 'toolshed', x: 0.85, y: 1.7, z: 1.31 + 0.04, ry: 0, w: 0.72, h: 0.62 },
});

/** curtain fabric per villager: a darkened, desaturated take on their scarf */
const CURTAIN: Readonly<Record<string, number>> = { 'villager:posy': 0x5a3a4a, 'villager:marigold': 0x4a2a44, 'villager:hazel': 0x5a4a38, 'villager:nimbus': 0x2e3a5a, 'villager:bram': 0x2f3f52 };

export interface Curtains {
  readonly mesh: THREE.InstancedMesh;
  /** draw (or open) one villager's curtain, eased over ~1.5 s */
  set(id: string, drawn: boolean): void;
  update(dt: number): void;
  /** for debug: who is drawn now */
  drawn(): string[];
  dispose(): void;
}

export function createCurtains(): Curtains {
  const ids = Object.keys(WINDOWS);
  const geo = new THREE.BoxGeometry(1, 1, 0.025);
  geo.translate(0, -0.5, 0); // hangs from its rail: scale y grows downward
  const mesh = new THREE.InstancedMesh(geo, toon(0xffffff), ids.length);
  mesh.name = 'villager-curtains';
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  const want = new Map<string, boolean>(), k = new Map<string, number>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  ids.forEach((id, i) => mesh.setColorAt(i, col.set(CURTAIN[id] ?? 0x3a3a4a)));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  let dirty = true;
  const place = () => {
    let any = false;
    ids.forEach((id, i) => {
      const w = WINDOWS[id], t = k.get(id) ?? 0, st = structure(w.at);
      const c = Math.cos(st.yaw), sn = Math.sin(st.yaw);
      p.set(st.x + w.x * c + w.z * sn, st.y + w.y + w.h / 2, st.z - w.x * sn + w.z * c);
      q.setFromAxisAngle(up, st.yaw + w.ry);
      // drawn = full height; open = gathered to a sliver at the rail (hidden)
      const e = t * t * (3 - 2 * t);
      s.set(w.w, Math.max(1e-3, w.h * e), 1);
      if (e > 0.01) any = true;
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = any;
  };
  return {
    mesh,
    set(id, drawn) { if (id in WINDOWS && want.get(id) !== drawn) { want.set(id, drawn); dirty = true; } },
    update(dt) {
      let moving = false;
      for (const id of ids) {
        const target = want.get(id) ? 1 : 0, cur = k.get(id) ?? 0;
        if (cur === target) continue;
        const nx = target > cur ? Math.min(1, cur + dt / 1.5) : Math.max(0, cur - dt / 1.5);
        k.set(id, nx); moving = true;
      }
      if (moving || dirty) { dirty = false; place(); }
    },
    drawn: () => ids.filter((id) => (k.get(id) ?? 0) > 0.5),
    dispose() { geo.dispose(); (mesh.material as THREE.Material).dispose(); },
  };
}
