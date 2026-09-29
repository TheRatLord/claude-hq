/**
 * Engine Room dressing (M2 breadth, §7.1 ENG / §5.5: perforated-steel floor 40, wall 58, trim 44, dark ceiling 34;
 * hero = STAT's rack wall, ink 22 + LEDs). A cosy shell workshop on the +0.25 m deck: ten butcher-block shell benches
 * with beige CRT terminals (the Shellys' kin) and low teal stools, the card table on a round rug with a game in
 * progress, the signature riveted boiler in the NW corner whose outlet pipe runs to STAT's boiler gauge on the glass
 * (the firebox glows toward the atrium), a shadow-board tool wall over a long vise bench, a rolling tool chest, oil
 * drums + crates + spare CRT heads, a spare rack and parts cabinet, overhead ducts, caged wall lamps, the rack bay
 * housing behind STAT's CPU cabinets (cable tray + drooping loops) with an anti-static runner along the rack spots,
 * and the fern with its watering can. STAT objects (racks, hamster wheel, boiler gauge, thermostat, uptime sign) are
 * not touched. Kept clear: every bench / stool / card / rack / plant slot, the glass-lap + gauge pocket points
 * (x ≤ 29.4), the ENG aisle (z 14.7–16.7) and the three door aprons. Owner: ENV.
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { lampFixtures } from './atrium.ts';
import { T, NOTES } from '../kit/tokens.ts';

const STOOL = { body: '#56727A', secondary: T.ink2, accent: T.brass };
/** Floor y of the ENG deck (world). */
const FY = 0.25;

export function dressEngine(layout: HqLayout, k: DressKit) {
  const zone = layout.zones.find((z) => z.id === 'ENG');
  if (!zone) return;
  const ceil = zone.ceil ?? 3.25; // world y of the ceiling (the deck is +0.25)
  const E = (px: number, pz: number, y = 0, yaw = 0) => W(px, pz, FY + y, yaw);
  let bi = 0;
  for (const f of layout.furniture) {
    if (f.zone !== 'ENG') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'rackWall': k.put('rackBay', { w, h, d, ceil: ceil - f.pos.y }, p, f.id, 0.3); break;
      case 'shellBench': {
        const i = bi++, sd = f.side ?? 1, r = (q: number) => hash01(i + 11, q);
        k.put('shellBench', { w, h, d, riser: false }, p, f.id, 0.2); // no riser: the seated shell's face reads over the bench
        // [ENV fix m3 r1] no bench CRT (playtest: from the aisle and the `engine` pose the beige CRT backs hid the seated
        // Shellys' own screen-faces, which ARE the terminal): the bench top stays low — a flat keyboard in front of the
        // seat, and every other item (sticky note, mug / parts tray) at the bench end away from the aisle (local ±x
        // beyond the robot's 0.5 m shoulders), under 12 cm tall, so no angle from the aisle puts it over the face
        k.put('keyboard', { mouse: r(1) > 0.5 }, local(p, -0.05 * sd, h, 0.12, 0.05 * sd), `${f.id}:kb`, 0);
        if (r(2) > 0.35) k.put('note', { colors: { body: NOTES[Math.floor(r(3) * NOTES.length)] } }, { ...local(p, 0.36 * sd + (r(4) - 0.5) * 0.06, h + 0.003, 0.05, r(4) * 0.6 - 0.3), rx: -Math.PI / 2 }, `${f.id}:note`, 0);
        if (r(5) > 0.45) k.put('mug', { colors: { body: [T.teal, T.trim, T.oat, T.lavender][Math.floor(r(6) * 4)] } }, local(p, 0.4 * sd, h, -0.12, r(7) * 6), `${f.id}:mug`, 0);
        else k.put('labKit', { kind: 'tubes' }, local(p, 0.36 * sd, h, -0.14, 0.2), `${f.id}:parts`, 0);
        break;
      }
      case 'chair': case 'stool': k.put('stool', { h, r: 0.18, colors: STOOL }, { ...p, yaw: hash01(bi++, 9) * 6 }, f.id, 0.12); break;
      case 'cardTable': {
        k.put('table', { kind: 'round', w, h, colors: { body: '#3C6B52', secondary: T.ink2, accent: T.brass } }, p, f.id, 0.22);
        k.put('cardDeck', {}, { ...p, y: p.y + h, yaw: 0.4 }, `${f.id}:cards`, 0);
        k.put('rug', { kind: 'round', r: 1.25, colors: { body: '#4C5E5A', secondary: '#3A4744', accent: T.butter } }, { ...p, y: p.y + 0.004 }, `${f.id}:rug`, 0);
        break;
      }
      case 'plant': {
        k.put('plant', { kind: 'fern', h: h * 1.05 }, p, f.id, 0.2);
        k.put('wateringCan', {}, E(28.36, 15.62, 0, 2.6), 'engCan', 0);
        break;
      }
      default: break; // hamsterWheel: STAT (world/stats/hamster.ts)
    }
  }
  // ★ the boiler (NW corner), firebox to the glass; its pipe runs up and into STAT's boiler gauge (28, 13, y 2.0)
  const bx = 30.2, bz = 12.05;
  const gauge = (layout.statAnchors ?? []).find((a) => a.id === 'boiler');
  const gp = gauge ? { x: gauge.pos.x + 20.5 + 0.08, y: gauge.pos.y, z: gauge.pos.z + 14 } : { x: 28.08, y: 2.0, z: 13 };
  // yaw −π/2 (front → −x): world (dx, dz) = (−lz, lx)
  k.put('boiler', { pipeTo: [gp.z - bz, gp.y - FY, -(gp.x - bx)], pipeDir: [0, 0, 1], pipeY: 2.62 }, E(bx, bz, 0, -Math.PI / 2), 'engBoiler', 0.35);
  k.put('rug', { kind: 'round', r: 0.86, fringe: false, colors: { body: '#3A403E', secondary: T.butter, accent: T.ink } }, E(bx, bz, 0.004), 'engBoilerRing', 0);
  k.put('sign', { w: 0.42, h: 0.3, colors: { body: T.ink, secondary: T.butter, accent: T.brass } }, E(31.2, 11.12, 1.75, 0), 'engHotSign', 0);
  // workshop corner (north wall between the bench blocks): shadow-board tool wall over a long vise bench, tool chest
  k.put('toolWall', { w: 2.1, h: 0.95 }, E(34.05, 11.12, 0.98, 0), 'engToolWall', 0);
  const wb = E(34.05, 11.4, 0, 0);
  k.put('shellBench', { w: 1.95, h: 0.72, d: 0.56, vise: true }, wb, 'engWorkbench', 0.22);
  k.put('crt', { lines: false }, local(wb, -0.55, 0.72, -0.05, 0.25), 'engWorkbenchCrt', 0); // a head on the bench, being fixed
  k.put('labKit', { kind: 'tubes' }, local(wb, 0.1, 0.72, 0.02, -0.1), 'engWorkbenchParts', 0);
  k.put('lamp', { kind: 'desk' }, local(wb, -0.85, 0.72, -0.12, 0.5), 'engWorkbenchLamp', 0);
  k.put('toolChest', {}, E(35.62, 11.36, 0, 0), 'engToolChest', 0.22);
  k.put('rug', { kind: 'runner', w: 1.9, d: 0.6, fringe: false, colors: { body: '#3B4442', secondary: '#2F3634', accent: T.butter } }, E(34.05, 12.02, 0.004, 0), 'engWorkMat', 0);
  // SW corner by the atrium door: oil drums, a crate with spare CRT heads
  k.put('oilDrum', {}, E(29.62, 19.5, 0, 0.3), 'engDrumA', 0.22);
  k.put('oilDrum', { rag: true }, E(30.22, 19.62, 0, 2.1), 'engDrumB', 0.22);
  k.put('crate', { w: 0.52, h: 0.38, d: 0.42 }, E(30.95, 19.56, 0, 0.12), 'engCrate', 0.2);
  k.put('crt', { lines: false }, E(30.95, 19.56, 0.38, 0.5), 'engSpareHead', 0);
  // SE corner: a spare rack (doors open to parts) + parts cabinet + a box of cables
  k.put('rack', { w: 0.6, h: 1.8, d: 0.6 }, E(38.1, 19.6, 0, Math.PI), 'engSpareRack', 0.25);
  k.put('filingCabinet', { drawers: 3, colors: { body: '#8C8F8A', secondary: T.trim, accent: T.brass } }, E(38.95, 19.66, 0, Math.PI), 'engParts', 0.2);
  k.put('box', { w: 0.44, h: 0.26, d: 0.34 }, E(39.72, 19.62, 0, 0.3), 'engCableBox', 0.15);
  // NE pocket between the benches and the hamster wheel: a drum + crate (clear of the ARC door apron)
  k.put('oilDrum', {}, E(38.35, 14.05, 0, 1.2), 'engDrumC', 0.2);
  // the rack spots' anti-static runner (butter border), the rack wall's cable box
  k.put('rug', { kind: 'runner', w: 7.7, d: 0.8, fringe: false, colors: { body: '#33403F', secondary: '#283130', accent: T.butter } }, E(40.95, 15.5, 0.004, Math.PI / 2), 'engRackMat', 0);
  // overhead: two ducts under the dark ceiling, caged wall lamps, posters
  const dy = ceil - FY - 0.32;
  k.put('duct', { len: 10.6, r: 0.2, up: 0.1 }, E(35.1, 19.35, dy, 0), 'engDuctS', 0);
  k.put('duct', { len: 5.4, r: 0.18, up: 0.12 }, E(34.1, 11.62, dy + 0.02, 0), 'engDuctN', 0);
  for (const [px, pz, yaw] of [[32.6, 11.1, 0], [36.6, 11.1, 0], [31.8, 19.9, Math.PI], [36.9, 19.9, Math.PI]]) k.put('cageLamp', {}, E(px, pz, 1.8, yaw), `engCage${px},${pz}`, 0);
  k.put('poster', { w: 0.62, h: 0.8, style: 1 }, E(35.8, 19.88, 1.55, Math.PI), 'engPosterS', 0);
  // pipe runs along both long walls under the ducts, safety tape along the aisle edges (clear of the card-table rug)
  for (const [px, pz, yaw, len] of [[33.6, 11.1, 0, 3.6], [37.4, 11.1, 0, 3.6], [33.0, 19.9, Math.PI, 3.6], [38.4, 19.9, Math.PI, 3.6]]) k.put('pipeRun', { len }, E(px, pz, 2.1, yaw), `engPipes${px},${pz}`, 0);
  for (const z of [14.7, 16.7]) for (const [x0, x1] of [[29.5, 33.1], [35.9, 40.4]]) k.put('floorTape', { len: x1 - x0 }, E((x0 + x1) / 2, z, 0.002, 0), `engTape${x0},${z}`, 0);
  k.put('poster', { w: 0.8, h: 0.55, style: 0 }, E(39.3, 11.12, 1.62, 0), 'engPosterN', 0);
  lampFixtures(layout, k, new Set(['ENG']));
}
