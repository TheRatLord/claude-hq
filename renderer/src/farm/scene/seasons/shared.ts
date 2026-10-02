/** What the seasonal pastimes (boat.ts, skate.ts, snow.ts) share: sound, speech, the stamp book, the controller. */
import type * as THREE from 'three';
import type { AudioService, FrameInfo, IndoorSpace, SceneCtx, SfxName } from '../context.ts';
import type { Controller } from '../../player/controller.ts';
import type { StampsService } from '../../model/stamps.ts';

export interface Pastime {
  update(f: FrameInfo): void;
  dev(cmd?: string, a?: number | string): unknown;
  stats(): Record<string, number | string>;
  dispose(): void;
}

export interface Shared {
  ctx: SceneCtx;
  sfx(name: SfxName, pos?: THREE.Vector3, volume?: number, pitch?: number): void;
  say(text: string, ms?: number, who?: string): void;
  /** count a stamp-book happening ('row', 'eight', 'snowman') */
  stamp(kind: 'row' | 'eight' | 'snowman'): void;
  /** add whole metres rowed to the stamp book's lifetime count (the notebook's rowboat page) */
  rowed(metres: number): void;
  controller(): Controller | undefined;
  /** in the farmhouse? */
  indoors(): boolean;
  /** is the pond frozen right now (eased 0..1)? */
  ice(): number;
}

export function createShared(ctx: SceneCtx, ice: () => number): Shared {
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  return {
    ctx,
    sfx(name, pos, volume = 1, pitch = 1) { try { audio()?.play(name, { pos, volume, pitch }); } catch { /* audio is optional */ } },
    say(text, ms = 3600, who = 'Seasons') { ctx.ui.say(text, ms, { who }); },
    stamp(kind) {
      try { (ctx.services.get('stamps') as StampsService | undefined)?.event(kind, { demo: ctx.valley.demo, hour: ctx.valley.sky.hour }); } catch (e) { console.warn('[seasons] stamp failed', e); }
    },
    rowed(metres) {
      try { (ctx.services.get('stamps') as StampsService | undefined)?.rowed(metres); } catch (e) { console.warn('[seasons] rowed failed', e); }
    },
    controller: () => ctx.services.get('controller') as Controller | undefined,
    indoors: () => !!(ctx.services.get('indoors') as IndoorSpace | undefined)?.active,
    ice,
  };
}
