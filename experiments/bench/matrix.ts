// Runs the bench under several configs via scripts/shoot.ts (GPU headless, uncapped) and prints a table.
// usage: node experiments/bench/matrix.ts [baseUrl]   (vite dev server must be running)
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const base = process.argv[2] || 'http://127.0.0.1:7461/experiments/bench/';
const configs: [name: string, query: string][] = [
  ['no post, blob', 'post=none&ao=0&outline=none'],
  ['no post, hull outline', 'post=none&ao=0&outline=hull'],
  ['pp: edge+bloom+AgX+vign+SMAA', 'ao=0'],
  ['pp + N8AO Performance half', 'aoq=Performance'],
  ['pp + N8AO Low half', 'aoq=Low'],
  ['pp + N8AO Medium half', 'aoq=Medium'],
  ['pp + N8AO Medium full', 'aoq=Medium&half=0'],
  ['pp + N8AO High full', 'aoq=High&half=0'],
  ['pp full, MSAA4 instead of SMAA', 'aa=msaa'],
  ['pp full, no bloom', 'bloom=0'],
  ['pp full + shadow map 2048 PCFSoft', 'shadow=map'],
  ['pp full, hull instead of edge', 'outline=hull'],
  ['three composer: N8AOPass+Unreal+SMAA', 'post=three&outline=none'],
  ['pp full, NOT instanced (40x9 meshes)', 'inst=0'],
  ['pp full, 100 chars', 'n=100'],
  ['pp full, 200 chars', 'n=200'],
  ['pp full, renderScale 0.75', 'scale=0.75'],
  ['pp full, renderScale 0.5', 'scale=0.5'],
  ['pp + N8AO Low half + shadow map + hull', 'shadow=map&outline=hull'],
];
interface Run { fps: number; stats?: { gpuMs?: number; callsPerFrame?: number; trisPerFrame?: number; jsMs?: number } }
const rows: { name: string; fps: number; gpuMs?: number; calls?: number; tris?: number; jsMs?: number }[] = [];
for (const [name, q] of configs) {
  const runs: Run[] = [];
  for (let r = 0; r < 3; r++) {
  const out = execFileSync('node', ['scripts/shoot.ts', `${base}?${q}`, `${os.tmpdir()}/hq-matrix`, '--uncapped', '--json', '--wait', '5000', '--measure', '3000'], { encoding: 'utf8' });
  runs.push(JSON.parse(out.split('\n').find((l) => l.startsWith('{')) ?? 'null') as Run); // shoot.ts --json prints one JSON line
  }
  runs.sort((a, b) => a.fps - b.fps); const j = runs[1]; // median of 3
  rows.push({ name, fps: j.fps, gpuMs: j.stats?.gpuMs, calls: j.stats?.callsPerFrame, tris: j.stats?.trisPerFrame, jsMs: j.stats?.jsMs });
  console.log(`| ${name} | ${j.fps} | ${(1000 / j.fps).toFixed(2)} | ${j.stats?.gpuMs} | ${j.stats?.callsPerFrame} | ${Math.round((j.stats?.trisPerFrame || 0) / 1000)}k | ${j.stats?.jsMs} |`);
}
