import fs from 'node:fs';
import { GPU_ARGS } from '../scripts/gpu.ts';

/**
 * Whether the suite renders on the real GPU (Vulkan ANGLE, like `npm run shoot`) or in SwiftShader (software).
 * On the GPU the valley runs at ~50+ fps and the valley tests run in parallel; in SwiftShader it crawls at ~1–3 fps,
 * so the valley file runs its tests one at a time. `HQ_TEST_GPU=0` forces software, `=1` forces the GPU flags.
 * Auto: Linux needs a DRM render node (/dev/dri/renderD*); macOS / Windows headless Chromium has its GPU.
 */
export function useGpu(): boolean {
  const env = process.env.HQ_TEST_GPU;
  if (env === '0' || env === '1') return env === '1';
  if (process.platform !== 'linux') return true;
  try { return fs.readdirSync('/dev/dri').some((n) => n.startsWith('renderD')); } catch { return false; }
}

export const browserArgs = (): string[] => (useGpu() ? GPU_ARGS : []);
