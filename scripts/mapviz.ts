#!/usr/bin/env node
/**
 * Render the pure valley map (renderer/src/farm/world/map.ts) to a top-down PNG: hillshaded height, water, paths,
 * site pads with their index, structures. No browser needed.
 *   node scripts/mapviz.ts [--out scratch/map.png] [--px 1024]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WORLD, SITES, STRUCTURES, heightAt, pathAt, clearance, inSite, siteToWorld } from '../renderer/src/farm/world/map.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = arg('--out', 'scratch/map.png');
const N = Number(arg('--px', '768'));
const half = WORLD.half;
const img = Buffer.alloc(N * N * 3);
const H = new Float32Array(N * N);
const toW = (i: number) => -half + (i + 0.5) * (2 * half / N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = heightAt(toW(i), toW(j));
const cell = 2 * half / N;
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = toW(i), z = toW(j), h = H[j * N + i];
  const hx = H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)];
  const hz = H[Math.min(N - 1, j + 1) * N + i] - H[Math.max(0, j - 1) * N + i];
  const shade = Math.max(0.35, Math.min(1.25, 0.9 - (hx - hz) / (4 * cell)));
  let c: [number, number, number];
  if (h < WORLD.water) c = [70, 130, 190];
  else if (h > 20) c = [140, 135, 130];
  else c = [110 + h * 3, 165 + h * 2, 90];
  const p = pathAt(x, z);
  if (p > 0.3 && h >= WORLD.water) c = [200, 170, 120];
  if (SITES.some((s) => inSite(s, x, z))) c = [150, 110, 70];
  if (STRUCTURES.some((s) => Math.hypot(s.x - x, s.z - z) < Math.max(...s.size) / 2)) c = [220, 60, 60];
  if (clearance(x, z) > 3 && h > WORLD.water && ((i * 7 + j * 13) % 97 === 0)) c = [40, 100, 50];
  const o = (j * N + i) * 3;
  img[o] = Math.min(255, c[0] * shade); img[o + 1] = Math.min(255, c[1] * shade); img[o + 2] = Math.min(255, c[2] * shade);
}
// site gate markers
for (const s of SITES) {
  const g = siteToWorld(s, 0, s.d / 2);
  for (const [x, z, col] of [[g.x, g.z, [255, 255, 0]], [s.x, s.z, [255, 255, 255]]] as const) {
    const i = Math.round((x + half) / cell), j = Math.round((z + half) / cell);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const o = ((j + dj) * N + (i + di)) * 3;
      if (o >= 0 && o < img.length) { img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; }
    }
  }
}
function png(w: number, h: number, rgb: Buffer): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png(N, N, img));
let lo = Infinity, hi = -Infinity;
for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
console.log(`wrote ${out} (${N}px, height ${lo.toFixed(1)}..${hi.toFixed(1)} m)`);
for (const s of SITES) console.log(`site ${String(s.index).padStart(2)} (${s.x},${s.z}) y=${s.y.toFixed(2)} yaw=${s.yaw.toFixed(2)}`);
for (const s of STRUCTURES) console.log(`${s.id.padEnd(12)} (${s.x},${s.z}) y=${s.y.toFixed(2)}`);
