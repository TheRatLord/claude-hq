// [AMB fix m2 r2] Café ambient life (review m2 r2 [gameplay]): with no agents at all (trio / longIdle stand-in), the
// cast still visits the Café: Bean the barista lives there, the roomba's patrol detours through it, the cat naps on the
// east-window cubbies / begs at the pastry case, and Ada takes a coffee break. Simulates the real hq layout + nav.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../layout/hq.ts';
import { createNav } from '../nav/index.ts';
import { rng, W } from './util.ts';
import type { AmbPeers, Vec2 } from './util.ts';
import { isRecord } from '../../../../shared/guards.ts';
import { createCat } from './cat.ts';
import { createRoomba, patrolFor, CAFE_DETOUR } from './roomba.ts';
import { createBarista, chooseErrand, BEAN_ERRANDS } from './barista.ts';
import { createAda } from './ada.ts';

const charBatch = { register: () => ({ setVisible() {}, setLod() {}, remove() {} }) };
const scene = { add() {}, remove() {} };

function sim({ minutes, hour = 13, seed = 1, player = W(20.5, 14) }: { minutes: number; hour?: number; seed?: number; player?: Vec2 }) {
  const nav = createNav(layout);
  const bursts: Record<string, number> = {};
  const fx = { burst: (k: string) => { bursts[k] = (bursts[k] ?? 0) + 1; } };
  const events: [string, unknown][] = [];
  const bus = { on: () => () => {}, emit: (t: string, e: unknown) => events.push([t, isRecord(e) ? e.ev : undefined]) };
  const pl = { pos: { x: player.x, y: 0, z: player.z }, level: 0 };
  const d = {
    layout, nav, charBatch, fx, bus, player: pl, scene, rand: rng(seed),
    actors: { list: () => [], get: () => null }, store: { entities: new Map(), demo: true, stats: null },
  };
  const peers: AmbPeers = {};
  const d2 = { ...d, peers };
  const ada = createAda(d2);
  const cat = createCat(d2);
  const roomba = createRoomba(d2);
  const barista = createBarista(d2);
  assert.ok(barista, 'the hq layout has the espresso bar');
  peers.ada = ada; peers.cat = cat; peers.barista = barista;
  const parts = { ada, cat, roomba, barista };
  const zoneS: Record<string, Record<string, number>> = {};
  const camera = null;
  const dt = 1 / 15;
  let time = 0;
  const catModes = new Set(), beanErrands = new Set(), adaPhases = new Set();
  for (let i = 0; i < minutes * 60 / dt; i++) {
    time += dt;
    nav.frame();
    const c = { dt, time, hour };
    for (const [k, p] of Object.entries(parts)) {
      p.update(c, camera);
      const q = p.pos;
      const z = layout.zoneAt(q.x, q.z, 0) ?? 'OUT';
      (zoneS[k] ??= {})[z] = (zoneS[k][z] ?? 0) + dt;
    }
    catModes.add(cat.mode);
    beanErrands.add(barista.debug().errand);
    adaPhases.add(ada.debug().coffee);
  }
  return { zoneS, bursts, events, catModes, beanErrands, adaPhases, bean: barista.debug(), roomba: roomba.debug() };
}

test('Bean: errand picks (night docks, customers first, a begging cat, never the same idle errand twice)', () => {
  const r = rng(3);
  assert.equal(chooseErrand({ night: true, customer: {} }, r), 'dock');
  assert.equal(chooseErrand({ customer: { id: 'a' }, catBegging: true }, r), 'serve');
  assert.equal(chooseErrand({ catBegging: true, greet: true }, r), 'treat');
  assert.equal(chooseErrand({ greet: true }, r), 'greet');
  const seen = new Set();
  for (let i = 0; i < 300; i++) { const e = chooseErrand({ last: 'shot' }, r); assert.notEqual(e, 'shot'); seen.add(e); }
  assert.equal(seen.size, Object.keys(BEAN_ERRANDS).length - 1);
});

test('roomba: the café detour runs on every other lap and stays routable', () => {
  assert.equal(patrolFor(0).length, patrolFor(1).length + CAFE_DETOUR.length);
  const nav = createNav(layout);
  for (const [x, z] of CAFE_DETOUR) {
    const p = W(x, z);
    assert.equal(layout.zoneAt(p.x, p.z, 0), 'CAF');
    assert.ok(nav.path(W(26.4, 25.6), p), `unroutable ${x},${z}`);
  }
});

test('no agents, 20 simulated minutes at 13:00: the Café has life (Bean, roomba, cat, Ada all spend time there)', () => {
  const r = sim({ minutes: 20, seed: 7 });
  const caf = (k: string) => r.zoneS[k]?.CAF ?? 0;
  const tag = JSON.stringify({ zones: Object.fromEntries(Object.entries(r.zoneS).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([z, v]) => [z, Math.round(v)]))])), cat: [...r.catModes], bean: [...r.beanErrands], ada: [...r.adaPhases], roomba: r.roomba });
  assert.ok(caf('barista') > 20 * 60 * 0.95, `Bean stays in the Café ${tag}`);
  assert.ok(caf('roomba') > 60, `roomba café detour ${tag}`);
  assert.ok(caf('ada') > 20, `Ada's coffee break ${tag}`);
  assert.ok(r.adaPhases.has('sip') && r.adaPhases.has('back'), `Ada got her coffee and walked back ${tag}`);
  assert.ok(r.bean.shots >= 5 && r.bean.errands >= 20, `Bean works the bar ${tag} ${JSON.stringify(r.bean)}`);
  assert.ok(r.bean.serves >= 1, `Bean served Ada ${tag}`);
  assert.ok(r.bursts.steam > 0 || r.events.some(([t, e]) => t === 'amb.bean' && e === 'pssht'), 'shots pssht');
});

test('the cat visits the Café (sill nap / pastry begging) across seeds, and Bean treats a begging cat', () => {
  let cafS = 0, treats = 0, modes = new Set();
  for (const seed of [1, 2, 3]) {
    const r = sim({ minutes: 25, seed });
    cafS += r.zoneS.cat?.CAF ?? 0; treats += r.bean.treats;
    for (const m of r.catModes) modes.add(m);
  }
  assert.ok(cafS > 120, `cat café time ${Math.round(cafS)} s, modes ${[...modes]}`);
  assert.ok(modes.has('sill') || modes.has('pastry'), `café plans picked: ${[...modes]}`);
  assert.ok(!modes.has('pastry') || treats >= 1, `a begging cat gets a crumb (treats ${treats})`);
});

test('night: Bean sleeps on its dock; nothing crashes at 23:00', () => {
  const r = sim({ minutes: 3, hour: 23, seed: 4 });
  assert.equal(r.bean.errand, 'dock');
  assert.ok((r.zoneS.barista?.CAF ?? 0) > 170);
});
