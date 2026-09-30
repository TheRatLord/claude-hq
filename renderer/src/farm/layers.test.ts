/**
 * Layer rules for the valley, checked on the import graph:
 *   model/, world/   pure: no three, no DOM, no net, no scene/hud
 *   scene/           no net/, no hud/, no source.ts/main.ts (the valley reaches it only as ValleyState + ports)
 *   hud/             no net/, no scene systems (scene/context.ts types and world/ are fine)
 *   audio/           no net/, no hud/
 * Only farm/main.ts and farm/source.ts may import ../net.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FARM = path.dirname(fileURLToPath(import.meta.url));
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.ts$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}
const importsOf = (file: string): string[] => {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
};
const resolveRel = (file: string, spec: string) => spec.startsWith('.') ? path.relative(FARM, path.resolve(path.dirname(file), spec)).replaceAll('\\', '/') : spec;
const layer = (rel: string) => rel.split('/')[0];

test('valley layers respect their import rules', () => {
  const problems: string[] = [];
  for (const f of files(FARM)) {
    const rel = path.relative(FARM, f).replaceAll('\\', '/');
    const L = layer(rel);
    for (const spec of importsOf(f)) {
      const target = resolveRel(f, spec);
      const toNet = target.startsWith('../net/') || target === '../net';
      const bad = (why: string) => problems.push(`${rel} imports ${spec}: ${why}`);
      if (toNet && rel !== 'main.ts' && rel !== 'source.ts') bad('only main.ts / source.ts touch the network');
      if (L === 'model' || L === 'world') {
        if (spec === 'three' || spec.startsWith('three/')) bad('pure layer imports three');
        if (['scene', 'hud', 'audio', 'dev', 'player'].includes(layer(target)) || target === 'main.ts' || target === 'source.ts') bad('pure layer imports presentation');
      }
      if (L === 'scene' && (layer(target) === 'hud' || target === 'main.ts' || target === 'source.ts')) bad('scene reaches past its ports');
      if (L === 'hud' && layer(target) === 'scene' && target !== 'scene/context.ts' && !target.startsWith('scene/toon')) bad('hud imports a scene system');
      if (L === 'audio' && layer(target) === 'hud') bad('audio imports hud');
    }
    if (L === 'model' || L === 'world') {
      const src = fs.readFileSync(f, 'utf8');
      if (!src.startsWith('// @pure')) problems.push(`${rel}: pure modules start with // @pure`);
      if (/\b(document|window|localStorage|requestAnimationFrame)\b/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) problems.push(`${rel}: pure module touches the DOM`);
    }
  }
  assert.deepEqual(problems, []);
});
