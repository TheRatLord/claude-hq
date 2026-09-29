#!/usr/bin/env node
// usage: node docs/port/baseline/compare.mjs <dirA> <dirB> [--frozen-dir-only]
// Pixel-diffs every same-named .png in two dirs (decoded in headless Chromium, no extra deps). Prints per file:
// mean abs channel diff (0-255) and % of pixels differing by >24 in any channel. Renders are not byte-deterministic
// (GPU + real-time demo world), so "unchanged" means: small mean diff, no new console errors in the .log.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { findChrome } from '../../../scripts/shoot.ts';
const [A, B] = process.argv.slice(2);
const files = fs.readdirSync(A).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(B, f)));
const br = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await br.newPage();
for (const f of files) {
  const [a, b] = [A, B].map((d) => 'data:image/png;base64,' + fs.readFileSync(path.join(d, f)).toString('base64'));
  const r = await page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = s; });
    const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const [ia, ib] = [await load(a), await load(b)];
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: 'MISMATCH' };
    const pa = px(ia), pb = px(ib); let sum = 0, big = 0;
    for (let i = 0; i < pa.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) { const d = Math.abs(pa[i + k] - pb[i + k]); sum += d; if (d > m) m = d; } if (m > 24) big++; }
    return { mean: sum / (pa.length / 4 * 3), bigPct: 100 * big / (pa.length / 4) };
  }, [a, b]);
  console.log(f.padEnd(20), r.size ?? `mean=${r.mean.toFixed(3)} big%=${r.bigPct.toFixed(3)}`);
}
await br.close();
