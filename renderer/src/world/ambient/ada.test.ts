// [AMB fix m3 r1] Ada steps aside off the STAFF mat when the player stands on it (review m3 r1 [art]: at the canonical
// `serve` pose her head + headset filled the frame's lower-left corner). Real hq layout + nav, a stub char batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../layout/hq.ts';
import { createNav } from '../nav/index.ts';
import { rng, W } from './util.ts';
import type { Vec2 } from './util.ts';
import { createAda } from './ada.ts';

const charBatch = { register: () => ({ setVisible() {}, setLod() {}, remove() {} }) };
const scene = { add() {}, remove() {} };
const mat = layout.points.staffMat;
const serveCam = W(16.25, 22.7); // poses.ts `serve` (world -4.25, 8.7): the mat's rear edge

function rigAda(entities = new Map()) {
  const nav = createNav(layout);
  const pl = { pos: { x: 0, y: 0, z: 0 }, level: 0 };
  const d = {
    layout, nav, charBatch, fx: { burst() {} }, bus: { on: () => () => {}, emit() {} }, player: pl, scene, rand: rng(2),
    actors: { list: () => [], get: () => null }, store: { entities, demo: true, stats: null }, peers: {},
  };
  const ada = createAda(d);
  const run = (s: number) => { for (let t = 0; t < s; t += 1 / 30) { nav.frame(); ada.update({ dt: 1 / 30, time: t, hour: 13 }, null); } };
  const put = (p: Vec2) => { pl.pos.x = p.x; pl.pos.z = p.z; };
  return { ada, run, put };
}

test('Ada: player on the STAFF mat → she stands ≥ 1.2 m lateral of it within 2 s; off the mat → back at her post', () => {
  const { ada, run, put } = rigAda();
  put(W(20.5, 14)); run(3);
  const post = ada.debug();
  assert.ok(Math.abs(post.x - mat.x) < 1.2, `post spot beside the counter middle ${JSON.stringify(post)}`);
  put(serveCam); run(2);
  let a = ada.debug();
  assert.ok(Math.abs(a.x - mat.x) >= 1.2, `stepped aside at the serve pose ${JSON.stringify(a)}`);
  assert.ok(Math.hypot(a.x - serveCam.x, a.z - serveCam.z) >= 1.4, `clear of the serve camera ${JSON.stringify(a)}`);
  put({ x: mat.x - 1.0, z: mat.z }); run(3); // the player on her (west) side of the mat → she goes to the east end
  a = ada.debug();
  assert.ok(a.x - mat.x >= 1.2, `east end when the player stands west ${JSON.stringify(a)}`);
  put(W(20.5, 14)); run(4);
  a = ada.debug();
  assert.ok(Math.hypot(a.x - post.x, a.z - post.z) < 0.15, `back at her post ${JSON.stringify(a)} vs ${JSON.stringify(post)}`);
});

test('Ada: Serve (inbox open, someone blocked) from the aside spot still holds the ticket out', () => {
  const ents = new Map([['b', { id: 'b', status: 'blocked', statusSince: 1 }]]);
  const { ada, run, put } = rigAda(ents);
  put(serveCam); ada.force('serve'); run(3);
  const a = ada.debug();
  assert.equal(a.mode, 'serve');
  assert.equal(a.ticket, true);
  assert.ok(Math.abs(a.x - mat.x) >= 1.2, JSON.stringify(a));
});
