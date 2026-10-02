/**
 * The secret grotto behind the big waterfall (system 'grotto', service 'grotto'): the outside half. The cave itself
 * is a walk-in room (room.ts, registered with the interior system); this system dresses the ledge (world/grotto.ts,
 * cut into `heightAt`) and the cave mouth, steps you into the cave when you walk into the mouth (or E on it), and
 * notices when you first find the place: a line, the map's "?" turning into a pin, the "Behind the curtain" stamp.
 *
 * Budget: from the valley nothing at all (hidden beyond `NEAR`); near the falls 4 draws (the slabs + arch + throat,
 * the glow deep in the throat, the spray, the back of the falling sheet) plus the solid mesh's shadow. Per frame: a distance check and two uniforms.
 */
import * as THREE from 'three';
import type { AudioService, IndoorSpace, SceneCtx, SystemFactory } from '../context.ts';
import { toon } from '../toon.ts';
import { MOUTH, ledgeAt } from '../../world/grotto.ts';
import type { GrottoData } from '../../model/grotto.ts';
import { buildOutside, curtainBack, glowCard, OPENING, sprayPoints } from './outside.ts';
import { grottoBook } from './room.ts';

/** metres from the mouth beyond which the outside dressing is hidden (no draws from the valley) */
const NEAR = 60;

/** Service 'grotto' (the HUD map, the stamp book, dev tools). */
export interface GrottoHandle {
  /** has the player found the grotto? */
  discovered(): boolean;
  data(): Readonly<GrottoData>;
  /** bumps on every change */
  readonly version: number;
  /** the player is in the cave right now */
  readonly inside: boolean;
  /** dev: stand somewhere: 'ledge' (the start, by the road), 'curtain' (behind the falls, facing the mouth), 'inside' / a room view ('pool', 'camp', …) */
  go(where?: string): boolean;
  /** dev: forget the grotto (undiscovered, chest closed) */
  reset(): void;
}

export const grottoSystem: SystemFactory = (ctx: SceneCtx) => {
  const book = grottoBook();
  const indoors = () => ctx.services.get('indoors') as IndoorSpace | undefined;
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const controller = () => ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined;

  const root = new THREE.Group();
  root.name = 'grotto';
  const outMat = toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide, shared: false });
  const solid = new THREE.Mesh(buildOutside(), outMat);
  solid.name = 'grotto:ledge';
  solid.castShadow = true; solid.receiveShadow = true;
  const glow = glowCard();
  const spray = sprayPoints();
  const curtain = curtainBack();
  root.add(solid, glow, spray, curtain);
  root.visible = false;
  ctx.scene.add(root);
  const glowU = (glow.material as THREE.ShaderMaterial).uniforms;
  const sprayU = (spray.material as THREE.ShaderMaterial).uniforms;
  const curtainU = (curtain.material as THREE.ShaderMaterial).uniforms;

  // E on the mouth (and walking into it does the same)
  const enter = () => { const s = indoors(); if (!s || s.active) return; s.enter(false, 'grotto'); };
  const offMouth = ctx.interact.add({
    id: 'grotto:mouth', kind: 'prop', verb: 'Squeeze inside', reach: 3.4,
    label: () => (book.discovered() ? 'The grotto' : 'Dark passage'),
    hint: () => (book.discovered() ? 'crystals, a still pool and an old camp' : 'a gap in the rock, behind the falling water'),
    pos: (out) => out.set(OPENING.x, OPENING.y + 1.2, OPENING.z),
    use: enter,
  });

  let wasFound = book.discovered(), inside = false, armed = true;
  const found = () => {
    if (wasFound) return;
    wasFound = true;
    audio()?.play('chime-pass', { volume: 0.8 });
    ctx.ui.say('A hidden ledge behind the waterfall, and a cave mouth in the rock. Nobody told you about this. (It\'s on your map now.)', 6500, { who: 'Discovery' });
  };
  const offChange = book.onChange(() => { if (book.discovered()) found(); else wasFound = false; });

  const handle: GrottoHandle = {
    discovered: () => book.discovered(),
    data: () => book.data(),
    get version() { return book.version; },
    get inside() { return inside; },
    go(where = 'curtain') {
      const s = indoors();
      // (yaw: the camera looks along (−sin yaw, −cos yaw))
      const stand = (x: number, z: number, tx: number, tz: number, pitch: number) => { s?.leave(true); controller()?.teleport(x, z, Math.atan2(-(tx - x), -(tz - z)), pitch); return true; };
      if (where === 'ledge') return stand(-32.4, -96.6, -31.0, -104, -0.02);
      if (where === 'curtain') return stand(MOUTH.x - 4.0, MOUTH.z + 2.2, MOUTH.x, MOUTH.z - 0.1, 0.04);
      if (where === 'mouth') return stand(MOUTH.x - 0.6, MOUTH.z + 2.6, MOUTH.x, MOUTH.z, 0.05);
      if (!s?.view) return false;
      return s.view(`grotto:${where === 'inside' ? 'door' : where === 'mouth-in' ? 'mouth' : where}`);
    },
    reset() { book.devReset(); },
  };
  ctx.services.set('grotto', handle);

  return {
    name: 'grotto',
    update(f) {
      const p = ctx.player.pos;
      const s = indoors();
      inside = !!s?.active && s.room === 'grotto';
      const d = Math.hypot(p.x - MOUTH.x, p.z - MOUTH.z);
      const cam = ctx.camera.position;
      root.visible = !s?.active && Math.min(d, Math.hypot(cam.x - MOUTH.x, cam.z - MOUTH.z)) < NEAR;
      if (inside) return;
      if (!root.visible) { armed = true; return; }
      glowU.uTime.value = f.time;
      sprayU.uTime.value = f.time;
      sprayU.uNight.value = ctx.lighting.night;
      curtainU.uTime.value = f.time;
      curtainU.uDay.value = 1 - ctx.lighting.night;
      // behind the curtain: found it
      if (!wasFound && d < 5.2 && p.z < MOUTH.z + 3.2 && ledgeAt(p.x, p.z).d < 1.6) book.discover();
      // walking into the mouth steps you inside (once per approach: back out a pace to re-arm)
      const lx = p.x - MOUTH.x, lz = p.z - MOUTH.z;
      if (lz > 0.6 || Math.abs(lx) > 1.6) armed = true;
      else if (armed && lz < -0.15 && Math.abs(lx) < 0.95 && ctx.player.speed > 0.3 && !ctx.player.frozen) { armed = false; enter(); }
    },
    stats: () => ({ near: root.visible ? 1 : 0, inside: inside ? 1 : 0, found: book.discovered() ? 1 : 0 }),
    dispose() {
      offMouth(); offChange();
      ctx.scene.remove(root);
      solid.geometry.dispose(); outMat.dispose();
      glow.geometry.dispose(); (glow.material as THREE.Material).dispose();
      spray.geometry.dispose(); (spray.material as THREE.Material).dispose();
      curtain.geometry.dispose(); (curtain.material as THREE.Material).dispose();
      if (ctx.services.get('grotto') === handle) ctx.services.delete('grotto');
    },
  };
};
