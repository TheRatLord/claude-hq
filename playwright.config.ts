import { defineConfig, devices } from '@playwright/test';
import { browserArgs, useGpu } from './browser-tests/gpu.ts';

// Each test starts its own demo server on an ephemeral port (browser-tests/server.ts), so tests are independent.
// On the GPU the valley renders at ~50+ fps and several valleys run side by side. Not too many: on a 3 GB iGPU six
// valleys at once ran out of video memory and page.evaluate stalled for 10–60 s. In SwiftShader (no GPU) frames
// crawl and parallel valleys starve each other, so valley.spec.ts runs serially (browser-tests/gpu.ts).
const gpu = useGpu();

export default defineConfig({
  testDir: './browser-tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : gpu ? 4 : 3,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: browserArgs() },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
