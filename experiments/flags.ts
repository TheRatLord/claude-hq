import { chromium } from 'playwright-core';
const exe = (process.env.HOME ?? '') + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const sets: Record<string, string[]> = { default: [], ignoreBL: ['--ignore-gpu-blocklist'], angleVk: ['--use-angle=vulkan'], angleVkFeat: ['--use-angle=vulkan', '--enable-features=Vulkan'],
  angleVkFeatBL: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'], angleGLES_egl: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'], full: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-vulkan-surface'] };
for (const [k, a] of Object.entries(sets)) for (const shell of [false, true]) {
  try {
    const b = await chromium.launch({ executablePath: shell ? exe.replace('chromium-1234/chrome-linux64/chrome', 'chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell') : exe, args: ['--no-sandbox', ...a], headless: true });
    const p = await b.newPage(); await p.goto('about:blank');
    const r: string = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); if (!c) return 'NO WEBGL2'; const d = c.getExtension('WEBGL_debug_renderer_info'); if (!d) return 'NO DEBUG INFO'; return c.getParameter(d.UNMASKED_RENDERER_WEBGL); });
    console.log(k.padEnd(14), shell ? 'shell ' : 'chrome', r.slice(0, 90)); await b.close();
  } catch (e) { console.log(k, shell, 'ERR', (e instanceof Error ? e.message : String(e)).slice(0, 100)); }
}
