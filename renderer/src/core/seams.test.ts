// M0.5 seam contract (§11 M0.5): every cross-WP module exists at its final path with its final exports.
// When an owner replaces a stub, this must keep passing (add exports freely; never remove these).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { errCode } from '../../../shared/guards.ts';
import { fake } from './testDoubles.ts';

const SEAMS: Record<string, string[]> = {
  '../render/materials/index.ts': ['getMaterial'],
  '../render/post.ts': ['createPost'],
  '../render/renderer.ts': ['createRenderer'],
  '../render/quality.ts': ['createQuality', 'TIERS'],
  '../render/lights.ts': ['createLights'],
  '../chars/render/charBatch.ts': ['createCharBatch'],
  '../chars/anim/animator.ts': ['createAnimator'],
  '../chars/rig/clawd.ts': ['createRig'],
  '../chars/brain/brain.ts': ['createBrain'],
  '../chars/brain/director.ts': ['createDirector'],
  '../chars/actors.ts': ['createActors'],
  '../fx/index.ts': ['createFx'],
  '../world/layout/proto.ts': ['layout'],
  '../world/layout/schema.ts': ['plan2world', 'world2plan', 'yawTo'],
  '../world/nav/index.ts': ['createNav'],
  '../world/build/index.ts': ['buildWorld'],
  '../world/stats/registry.ts': ['registerStat'],
  '../player/controller.ts': ['createPlayer'],
  '../ui/index.ts': ['createUI'],
  '../debug/poses.ts': ['POSES', 'getPose', 'posesFor'],
  './debug.ts': ['installHq', 'hqRegister', 'hqStatSection', 'HQ_PLUGGABLE', 'createFocusShot'],
};

for (const [mod, names] of Object.entries(SEAMS)) {
  test(`seam ${mod}`, async () => {
    let m: Record<string, unknown>;
    try {
      m = await import(mod);
    } catch (e) {
      // Browser-only modules (e.g. importing xterm's CSS through vite) can't load under node: check the source.
      if (errCode(e) !== 'ERR_UNKNOWN_FILE_EXTENSION') throw e;
      const src = readFileSync(new URL(mod, import.meta.url), 'utf8');
      m = Object.fromEntries(names.filter((n) => new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b`).test(src)).map((n) => [n, true]));
    }
    for (const n of names) assert.ok(n in m, `${mod} must export ${n}`);
  });
}

// RND/LVL M1 (cross-owner edit): proto room is 12 × 9 m with 12 desks in 3 pods of 4 (D7).
test('proto layout: 12×9 m, 12 desk slots in 3 pods, slots inside bounds', async () => {
  const { layout } = await import('../world/layout/proto.ts');
  const b = layout.bounds;
  assert.equal(b.maxX - b.minX, 12);
  assert.equal(b.maxZ - b.minZ, 9);
  assert.equal(layout.slots.filter((s) => s.tag === 'desk').length, 12);
  assert.deepEqual(layout.pods.map((p) => p.length), [4, 4, 4]);
  for (const s of layout.slots) assert.ok(s.pos.x > b.minX && s.pos.x < b.maxX && s.pos.z > b.minZ && s.pos.z < b.maxZ, s.id);
});

test('director + nav: stable desk assignment, no double booking', async () => {
  const { layout } = await import('../world/layout/proto.ts');
  const { createNav } = await import('../world/nav/index.ts');
  const { createDirector } = await import('../chars/brain/director.ts');
  const ents = new Map();
  for (let i = 0; i < 12; i++) ents.set(`d1:p${i}`, { id: `d1:p${i}`, workspace: { slot: i % 3 }, tab: { index: 0 }, paneIndex: i });
  const d1 = createDirector(layout, createNav(layout));
  const d2 = createDirector(layout, createNav(layout));
  d1.update(ents, 0);
  d2.update(new Map([...ents].reverse()), 0);
  const ids = [...ents.keys()];
  const slots = ids.map((id) => d1.slotFor(id)?.id).filter(Boolean);
  assert.equal(new Set(slots).size, slots.length);
  assert.deepEqual(ids.map((id) => d1.slotFor(id)?.id), ids.map((id) => d2.slotFor(id)?.id));
});

// [CORE m2 r3] an hqRegister name missing from HQ_PLUGGABLE must fail `npm test`, not the running app (it used to throw
// at boot in createUI). Static grep over every renderer/src module (tests excluded).
test('every hqRegister(name) under renderer/src is in HQ_PLUGGABLE', async () => {
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const HQ_PLUGGABLE: readonly string[] = (await import('./debug.ts')).HQ_PLUGGABLE;
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk(root);
  const bad: string[] = [];
  let n = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // skip doc-comment examples
    for (const m of src.matchAll(/hqRegister\(\s*(['"`])([^'"`]+)\1/g)) {
      n++;
      if (!HQ_PLUGGABLE.includes(m[2])) bad.push(`${f.slice(root.length)}: '${m[2]}'`);
    }
    // Dynamic registration (main.ts fallback loop): names come from a literal array right before hqRegister(k, …).
    for (const m of src.matchAll(/for\s*\(\s*const\s+(\w+)\s+of\s+\[([^\]]*)\]\s*\)\s*\{[^}]*hqRegister\(\s*\1\b/g)) {
      for (const q of m[2].matchAll(/['"`]([^'"`]+)['"`]/g)) { n++; if (!HQ_PLUGGABLE.includes(q[1])) bad.push(`${f.slice(root.length)}: '${q[1]}'`); }
    }
  }
  assert.ok(n >= 10, `found only ${n} hqRegister calls — grep broken?`);
  assert.deepEqual(bad, [], `hqRegister names missing from HQ_PLUGGABLE (core/debug.ts): ${bad.join(', ')}`);
});

// [CORE m2-carryover] the other direction: a pluggable name nobody can reach is dead (goTo/goToSpot were listed and
// registered but never on window.__hq). Every HQ_PLUGGABLE name must be exposed as `name: call('name')` or read by
// installHq itself through `plugged.get('name')` / `pluggedFn('name')` (walkUp, used by focus()).
test('every HQ_PLUGGABLE name is reachable from window.__hq', async () => {
  const { HQ_PLUGGABLE } = await import('./debug.ts');
  const src = readFileSync(new URL('./debug.ts', import.meta.url), 'utf8');
  const dead = HQ_PLUGGABLE.filter((n) => !new RegExp(`\\b${n}:\\s*call\\('${n}'\\)`).test(src) && !src.includes(`plugged.get('${n}')`) && !src.includes(`pluggedFn('${n}')`));
  assert.deepEqual(dead, [], `HQ_PLUGGABLE names never exposed on __hq (core/debug.ts): ${dead.join(', ')}`);
});

test('hqRegister: unknown name throws under node, logs + counts in the app', async () => {
  const { hqRegister, hqBootErrors } = await import('./debug.ts');
  // @ts-expect-error not a pluggable name: the runtime guard must still throw
  assert.throws(() => hqRegister('__nope__', () => 1), /not a pluggable/);
  const had = 'window' in globalThis;
  const origErr = console.error;
  const logged: string[] = [];
  globalThis.window = globalThis.window ?? fake<Window & typeof globalThis>({});
  console.error = (m: string) => logged.push(m);
  try {
    const before = hqBootErrors.length;
    // @ts-expect-error not a pluggable name: outside node's test run the app logs and counts it instead of throwing
    assert.doesNotThrow(() => hqRegister('__nope2__', () => 1));
    assert.equal(hqBootErrors.length, before + 1);
    assert.match(logged[0], /__nope2__/);
  } finally {
    console.error = origErr;
    if (!had) Reflect.deleteProperty(globalThis, 'window');
    hqBootErrors.length = 0;
  }
});
