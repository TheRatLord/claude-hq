/**
 * Chromium flags for the real GPU (Vulkan ANGLE) in headless runs: shoot, bench, the placement audit and the Playwright
 * suite. Without a usable GPU, Chromium falls back to SwiftShader (software, ~1–3 fps for the valley) on its own.
 */
export const GPU_ARGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-webgpu'];
