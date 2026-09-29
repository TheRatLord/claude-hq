// Electron GPU probe: loads URL, reports WebGL renderer + page stats, captures the window, quits.
// usage: electron --no-sandbox [chromium switches...] experiments/electron-probe/main.ts --url U --out file.png [--wait ms]
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('--url', 'http://127.0.0.1:7461/experiments/bench/');
const out = arg('--out', '/tmp/hq-electron.png');
const wait = +arg('--wait', '6000');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1920, height: 1080, show: true, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(url);
  await new Promise((r) => setTimeout(r, wait));
  const info = await win.webContents.executeJavaScript(`(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info');
    return { renderer: d && c.getParameter(d.UNMASKED_RENDERER_WEBGL), stats: window.__hq?.stats?.() ?? null }; })()`);
  // `getGPUInfo` is typed as `unknown`-ish; only `auxAttributes.glRenderer` is read
  const gpu = (await app.getGPUInfo('basic').catch(() => null)) as { auxAttributes?: { glRenderer?: string } } | null;
  const feat = app.getGPUFeatureStatus();
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('PROBE ' + JSON.stringify({ ...info, size: img.getSize(), webgl2: feat.webgl2, gpuCompositing: feat.gpu_compositing, gl: gpu?.auxAttributes?.glRenderer }));
  app.exit(0);
});
