/**
 * Lab dressing (M2 breadth, §7.1 LAB / §5.5: teal-grey tile floor 52, cream tile walls 84, tile trim 70; hero = the
 * fume hood L* 30 + the TEST light). A clean, cool little test kitchen next to the Lobby: the signature fume hood
 * (lit sash, glowing flask, exhaust duct), two steel lab benches with reagent risers and per-station gear (microscope,
 * test-tube racks, flasks, a centrifuge, a beige CRT running the tests), a sink run under the south window, gas
 * cylinders chained to the wall, the TEST lightbox hung in front of the window (its lenses are live: labLight.ts),
 * a safety shower + eyewash, a glassware cart, a mobile whiteboard, a sample fridge, lab coats on a rack, rubber
 * mats at the stations. Station slots (lab:0–3), both door aprons and the east-door → bench walk stay clear.
 * Owner: ENV.
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { lampFixtures } from './atrium.ts';
import { T, NOTES } from '../kit/tokens.ts';

const RUBBER = { body: '#4A5654', secondary: '#3B4442', accent: '#8EA3A0' };

export function dressLab(layout: HqLayout, k: DressKit) {
  const zone = layout.zones.find((z) => z.id === 'LAB');
  if (!zone) return;
  const ceil = zone.ceil ?? 2.8;
  for (const f of layout.furniture) {
    if (f.zone !== 'LAB') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'fumeHood': k.put('fumeHood', { w, h, d, duct: ceil - h }, p, f.id, 0.3); break;
      case 'labBench': {
        k.put('labBench', { w, h, d }, p, f.id, 0.26);
        const west = f.id === 'labBench0';
        // per-station gear: slots stand at local x ±0.45 (lab:0/1 west bench, lab:2/3 south bench)
        k.put('crt', { w: 0.3, h: 0.25, d: 0.28 }, local(p, west ? -0.66 : 0.66, h, -0.14, west ? 0.35 : -0.35), `${f.id}:crt`, 0);
        k.put('keyboard', { mouse: false }, local(p, west ? -0.45 : 0.45, h, 0.14, west ? 0.12 : -0.12), `${f.id}:kb`, 0);
        k.put('labKit', { kind: west ? 'microscope' : 'centrifuge' }, local(p, west ? 0.5 : -0.52, h, -0.02, west ? -0.4 : 0.3), `${f.id}:kit0`, 0);
        k.put('labKit', { kind: 'tubes' }, local(p, west ? 0.06 : -0.08, h, -0.16, 0.05), `${f.id}:kit1`, 0);
        k.put('labKit', { kind: 'flasks' }, local(p, west ? 0.2 : 0.14, h, 0.06, 1.2), `${f.id}:kit2`, 0);
        k.put('note', { colors: { body: NOTES[west ? 0 : 2] } }, { ...local(p, west ? -0.62 : 0.62, h + 0.2, 0.0, west ? 0.35 : -0.35), rx: -0.08 }, `${f.id}:note`, 0);
        // rubber anti-fatigue mat in front of the stations
        k.put('rug', { kind: 'runner', w: w - 0.1, d: 0.62, fringe: false, colors: RUBBER }, { ...local(p, 0, 0.004, d / 2 + 0.36) }, `${f.id}:mat`, 0);
        break;
      }
      case 'testLight': {
        const { item } = k.put('testLight', { hang: Math.max(0.2, ceil - f.pos.y - 0.12) }, p, f.id, 0);
        // the live lenses (build/labLight.ts): world centres just proud of the lens cups
        k.labLight = { yaw: p.yaw, lenses: (item.anchors.lenses ?? []).map((l) => ({ ...local(p, l.x, l.y, l.z + 0.004), r: l.r })) };
        break;
      }
      case 'shelf': {
        k.put('shelf', { w, h: Math.max(h, 1.0), d, top: true, colors: { body: '#8FA3A2', secondary: T.trim } }, p, f.id, 0.25);
        k.put('plant', { kind: 'pothos', drop: 0.55 }, local(p, 0.45, Math.max(h, 1.0), 0), `${f.id}:pothos`, 0);
        k.put('labKit', { kind: 'flasks' }, local(p, -0.35, Math.max(h, 1.0), 0.02, 0.4), `${f.id}:flasks`, 0);
        break;
      }
      default: break;
    }
  }
  // south wall run: gas cylinders by the hood, the sink counter under the window (the bench continues it east)
  k.put('gasCylinders', { n: 3 }, W(7.98, 27.7, 0, Math.PI), 'labGas', 0.22);
  const sink = W(9.62, 27.58, 0, Math.PI);
  k.put('labBench', { w: 1.66, h: 0.7, d: 0.6, sink: true }, sink, 'labSink', 0.24);
  k.put('plant', { kind: 'succulent' }, local(sink, 0.72, 0.7, -0.18), 'labSinkSucc', 0);
  k.put('mug', { colors: { body: T.teal } }, local(sink, -0.62, 0.7, 0.12, 0.8), 'labSinkMug', 0);
  // north wall: safety shower + eyewash in the NW corner, the glassware cart, (door), whiteboard, lab coats
  k.put('safetyShower', {}, W(7.05, 23.7, 0, 0), 'labShower', 0.12);
  k.put('labCart', {}, W(8.2, 23.95, 0, 0.08), 'labCart', 0.2);
  k.put('whiteboard', { w: 1.25, h: 0.75 }, W(11.6, 23.86, 0, 0.04), 'labBoard', 0.15);
  k.put('coatRack', {}, W(12.72, 23.85, 0, 2.4), 'labCoats', 0.12);
  k.put('corkboard', { w: 0.8, h: 0.55 }, W(8.2, 23.62, 1.3, 0), 'labCork', 0);
  // east side: sample fridge in the SE corner, a bin by the door; posters above the benches
  k.put('sampleFridge', {}, W(13.57, 27.52, 0, -Math.PI / 2), 'labFridge', 0.24);
  k.put('bin', {}, W(13.62, 26.78, 0, 0), 'labBin', 0);
  k.put('poster', { w: 0.7, h: 0.5, style: 1 }, W(6.62, 25.2, 1.62, Math.PI / 2), 'labPosterW', 0);
  k.put('poster', { w: 0.5, h: 0.62, style: 2 }, W(13.88, 27.0, 1.5, -Math.PI / 2), 'labPosterE', 0);
  // a round sample table in the middle of the room (clear of the door → station walks): a bubbling flask, a notebook
  const tb = W(11.5, 25.05, 0, 0.3);
  k.put('table', { kind: 'round', w: 0.72, h: 0.72, colors: { body: T.trim, secondary: T.ink2, accent: '#8FA3A2' } }, tb, 'labTable', 0.22);
  k.put('labKit', { kind: 'flasks' }, local(tb, -0.08, 0.72, 0.04, 0.6), 'labTableFlasks', 0);
  k.put('bookStack', { n: 1 }, local(tb, 0.16, 0.72, -0.1, 1.9), 'labTableBook', 0);
  // a spare stool tucked by the sink, a stack of lab notebooks on the cart shelf
  k.put('stool', { h: 0.5, r: 0.15, colors: { body: '#8FA3A2', secondary: T.ink2, accent: T.trim } }, W(10.45, 26.95, 0, hash01(3, 1) * 6), 'labStool', 0.1);
  lampFixtures(layout, k, new Set(['LAB']));
}
