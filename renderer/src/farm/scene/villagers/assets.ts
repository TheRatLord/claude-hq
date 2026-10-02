/**
 * Gallery: the villager cast, driven by the farmers' rig and pose loops (Puppets), so what you see is what walks the
 * valley.
 *
 *   villagers   the whole cast in a row, each in its post act; variant 'post' | 'walk' | 'wave' | 'night' (lanterns)
 *               | 'back' (turned round: satchel, pack, cape, apron bow)
 */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { Puppets } from '../farmers/assets.ts';
import { propOf } from '../farmers/brain.ts';
import { CAST, villagerLook } from './cast.ts';

const PUP = new WeakMap<THREE.Object3D, Puppets>();

defineAsset({
  name: 'villagers', group: 'character', variants: ['post', 'walk', 'wave', 'night', 'back'],
  note: 'the persistent villagers: Posy (postmaster), Bram (shipping clerk), Hazel (miller), Mayor Marigold, Fern (ranger), Nimbus (weather-watcher)',
  build: (o) => {
    const p = new Puppets(CAST.length);
    const variant = o.variant ?? 'post';
    CAST.forEach((v, i) => {
      const x = (i - (CAST.length - 1) / 2) * 1.5;
      const act = variant === 'walk' ? 'walk' : variant === 'wave' ? 'wave' : variant === 'night' || variant === 'back' ? 'stand' : (v.places.mailbox ?? v.places.bin ?? v.places.mill ?? v.places.noticeboard ?? v.places.signpost ?? v.places.knoll)?.loop[1]?.act ?? 'stand';
      const d = p.add(villagerLook(v), act, x, 0, variant === 'back' ? Math.PI : 0);
      if (variant === 'night') d.prop = 'lantern';
      else if (variant !== 'walk') d.prop = propOf(d.act);
    });
    p.tick(0.5, 1 / 60);
    PUP.set(p.crowd.group, p);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(CAST.length * 1.5 - 0.6, 1.3, 1.0), new THREE.MeshBasicMaterial({ visible: false }));
    frame.position.y = 0.8;
    p.crowd.group.add(frame);
    return p.crowd.group;
  },
  animate: (obj, t, dt) => PUP.get(obj)?.tick(t, dt),
});
