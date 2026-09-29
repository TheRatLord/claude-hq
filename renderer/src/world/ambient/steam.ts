/**
 * Coffee steam (ART §6.7 "coffee machine steam", DESIGN §11 M3 AMB "espresso steam"): a lazy wisp over the Café
 * espresso machine, the lobby coffee cart and the Library tea trolley, plus a "pssht!" burst from the espresso wand
 * every 15–35 s. Uses FX's pooled particles (fx.burst 'steam'); emits only within 16 m of the camera. Owner: AMB.
 */
import { furniture } from './util.ts';
import type { AmbBus, AmbFrame, AmbFx } from './util.ts';
import type { HqLayout } from '../layout/schema.ts';
import { local2world } from '../layout/schema.ts';

interface Vent { id: string; x: number; y: number; z: number; rate: number; burst: boolean; acc: number; next: number; puff: number }

export function createSteam(d: { layout: HqLayout; fx: AmbFx; rand: () => number; bus?: AmbBus }) {
  const { layout, fx, rand } = d;
  const vents: Vent[] = [];
  const add = (id: string, lx: number, dy: number, lz: number, rate: number, burst: boolean) => {
    const f = furniture(layout, id);
    if (!f) return;
    const w = local2world(f.pos, f.yaw, lx, lz);
    const y = layout.floorY(f.pos.x, f.pos.z, 0) + f.size[1] + dy;
    vents.push({ id, x: w.x, y, z: w.z, rate, burst, acc: rand(), next: 6 + rand() * 12, puff: 0 });
  };
  // espresso bar: the machine sits on the counter's west end (ENV/greybox: local x −1.2), wand at its front
  add('espressoBar', -1.2, 0.42, -0.02, 3.2, true);
  add('espressoBar', -0.95, 0.12, 0.12, 0, true); // wand (bursts only)
  add('coffeeCart', 0.3, 0.12, 0, 1.6, false);
  add('teaTrolley', 0.25, 0.12, 0, 1.2, false);
  let emitted = 0;
  // [INT M3.5 cross-owner] STAT's café chalk board publishes `stat.brew {tps, steam}` at 1 Hz (steam = 0.6–2.5 × from
  // output tokens/s): the espresso machine's wisp breathes with the office's token rate. Other vents are unaffected.
  let brew = 1;
  d.bus?.on?.('stat.brew', (m) => { const k = Number(m?.steam); if (Number.isFinite(k)) brew = Math.min(2.5, Math.max(0.6, k)); });

  function update(c: AmbFrame, camera: { position: { x: number; z: number } } | null | undefined) {
    if (!camera || !fx?.burst) return;
    const dt = Math.min(c.dt, 0.1);
    for (const v of vents) {
      const dist = Math.hypot(camera.position.x - v.x, camera.position.z - v.z);
      if (dist > 16) continue;
      if (v.rate) {
        v.acc += dt * v.rate * (v.id === 'espressoBar' ? brew : 1);
        while (v.acc >= 1) { v.acc -= 1; fx.burst('steam', { x: v.x, y: v.y, z: v.z }); emitted++; }
      }
      if (v.burst) {
        v.next -= dt;
        if (v.next <= 0 && v.rate === 0) { v.puff = 0.9; v.next = 15 + rand() * 20; d.bus?.emit?.('amb.steam', { ev: 'pssht', pos: { x: v.x, y: v.y, z: v.z } }); }
        if (v.puff > 0) {
          v.puff -= dt;
          v.acc += dt * 26;
          while (v.acc >= 1) { v.acc -= 1; fx.burst('steam', { x: v.x + (rand() - 0.5) * 0.06, y: v.y, z: v.z + (rand() - 0.5) * 0.06 }); emitted++; }
        }
      }
    }
  }
  return { update, debug: () => ({ vents: vents.length, emitted, brew }) };
}
