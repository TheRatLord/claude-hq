# Platform / perf research (verified 2026-09-27)

Machine: Ryzen 7 8845HS, Radeon 780M (Phoenix3, RADV/radeonsi, Mesa LLVM 20.1.2, Vulkan 1.4.318), 28 GB RAM, Ubuntu 24.04.4, kernel 6.8.
Headless: no Xorg/Wayland/VNC installed, only `Xvfb`/`xvfb-run`. User reaches the box over SSH (from 10.0.0.23) / tailscale.
Everything below was run on this box unless marked *(not verified)*. Experiments: `experiments/bench/`, `experiments/electron-probe/`, `experiments/flags.ts`.

## 0. The one thing to internalise

**The user will almost always view the app through a browser over `ssh -L`, so the renderer runs on the *client's* GPU, not the 780M.**
The 780M only renders when (a) Electron runs locally on a monitor attached to this box, (b) our headless test/screenshot tooling runs.
There is no display server to show an Electron window remotely (X11 forwarding of a WebGL window = software readback over the wire; unusable).
Consequences:
- Web mode is the primary product surface; Electron is a thin wrapper around the *same* backend + renderer (useful if the user sits at the box or runs the app on their laptop against a forwarded backend).
- Budget for the 780M anyway (it is the weakest plausible client: iGPU laptops) and ship a dynamic-resolution scaler + quality presets.
- All numbers here are GPU-bound measurements on the 780M via headless Chromium, which is our reviewers' eye.

## 1. Stack (installed, `package.json` `"type":"module"`)

| pkg | version | role |
|---|---|---|
| electron | 44.4.5 (Chromium 152.0.7977.130, Node 24.21, V8 15.2) | desktop shell (devDep) |
| vite | 8.3.1 | bundler/dev server (rolldown); `vite.config.js` binds 127.0.0.1:7461 (5199/5195 are taken by other apps on this box) |
| three | 0.186.1 | renderer. **Pin <0.187** — postprocessing 6.39.5 peerDep is `three >=0.168 <0.187` |
| postprocessing (pmndrs) | 6.39.5 | post stack (recommended, see §4) |
| n8ao | 2.0.1 | SSAO (`N8AOPostPass` for pmndrs, `N8AOPass` for three composer) |
| @xterm/xterm 6.0.0, addon-fit 0.11.0, addon-webgl 0.19.0, addon-unicode11 0.9.0 | | terminal panel |
| ws | 8.22.0 | backend WebSocket |
| playwright-core | 1.63.0 | headless GPU screenshots (devDep). It wants chromium rev 1243 but only 1234 (Chrome 15x) is cached in `~/.cache/ms-playwright`; we pass `executablePath` so no download is needed |

No native modules. **Avoid node-pty**: it would need an Electron-ABI rebuild. herdr's `terminal session control` speaks NDJSON over plain stdio pipes (prior-art verified), so `child_process.spawn` suffices. `herdr agent attach` is a raw-TTY attach and *would* need a PTY — don't use it for the xterm bridge.

### Electron sandbox
`npx electron --version` aborts: `FATAL: The SUID sandbox helper binary was found, but is not configured correctly ... chrome-sandbox is owned by root and has mode 4755`.
Cause: Ubuntu 24.04 `kernel.apparmor_restrict_unprivileged_userns = 1` blocks the userns sandbox, and the npm-installed `chrome-sandbox` isn't setuid.
Fix options: (a) `--no-sandbox` (what we do; renderer only ever loads our own 127.0.0.1 origin, `contextIsolation:true`, no `nodeIntegration`, `will-navigate` blocked, `setWindowOpenHandler` deny) — acceptable; (b) one-time `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 ...` (lost on every reinstall). Put `app.commandLine.appendSwitch('no-sandbox')` *and* pass `--no-sandbox` in npm scripts (the zygote checks before JS runs, so argv is what counts).

## 2. GPU flags — verified matrix

WebGL renderer string read via `WEBGL_debug_renderer_info` (`experiments/flags.ts`, `experiments/electron-probe/main.ts`).

### Headless Chromium (playwright-core, `headless:true`, both full chrome and chrome-headless-shell rev 1234)
| flags (+`--no-sandbox`) | UNMASKED_RENDERER |
|---|---|
| none / `--ignore-gpu-blocklist` only | SwiftShader (software) |
| **`--use-angle=vulkan`** (minimum) | `ANGLE (AMD, Vulkan 1.4.318 (AMD Radeon 780M Graphics (RADV PHOENIX)), radv)` |
| `--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist --enable-gpu` | same (what `shoot.mjs` uses) |
| `--use-angle=gl-egl` | `ANGLE (AMD, Radeon 780M (radeonsi phoenix), OpenGL ES 3.2)` — hardware, faster, but **renders the pmndrs post stack black** (half-float composer + N8AO; plain forward render is fine). Don't use. |
| + `--disable-vulkan-surface` | still hardware, but **forces a slow readback path: 85 fps vs 310 fps uncapped** on the same scene. Never pass it. |

`EXT_disjoint_timer_query_webgl2` is exposed (GPU timer queries work). Harmless noise: `GL Driver Message ... GPU stall due to ReadPixels` = the screenshot readback itself (appears with no post at all); `shoot.mjs` filters it.

### Electron 44 under Xvfb (`xvfb-run -a -s "-screen 0 1920x1080x24"`)
| flags (+`--no-sandbox`) | result |
|---|---|
| none | `WebGL2 blocklisted`, gpu_compositing `disabled_software`, **no WebGL2 at all** |
| `--ignore-gpu-blocklist` | llvmpipe via GLX, 11 fps |
| `--ignore-gpu-blocklist --use-angle=gl-egl` | llvmpipe (Xvfb has no DRI3), 98 ms/frame |
| **`--ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan`** | **RADV 780M**, 60 fps vsynced; prints `vulkan: No DRI3 support detected - required for presentation` (harmless: Chromium composites via readback) |
| `--ozone-platform=headless` (no Xvfb) | **SIGSEGV** — Electron has no working headless ozone; Xvfb is required |

For a real local desktop (Xorg/Wayland with DRI3) the same switches apply; `--use-angle=vulkan` is still the safest choice for RADV. Set them in `main` via `app.commandLine.appendSwitch` before `ready`:
`ignore-gpu-blocklist`, `use-angle=vulkan`, `enable-features=Vulkan`, (optional) `enable-gpu-rasterization`. Keep `backgroundThrottling:false` only while a terminal is streaming.

## 3. Screenshot / perf tooling

### `scripts/shoot.mjs` (headless GPU Chromium)
```
node scripts/shoot.mjs <url> <outPrefix> [--pose x,y,z,yaw,pitch]... [--wait ms] [--settle ms] [--size WxH]
     [--eval "js"]... [--measure ms] [--uncapped] [--angle vulkan|gl-egl] [--no-gpu] [--browser path] [--json]
```
- Page contract: `window.__hq.setPose(x,y,z,yaw,pitch)` (called before each shot), `window.__hq.stats()` → any JSON (fps, gpuMs, draw calls...). Both optional.
- Prints renderer string (flags SOFTWARE), per-shot rAF fps + worst frame, `stats()`, console errors/warnings/pageerrors/failed requests. Exit 2 on pageerror or software GL; 1 on navigation failure.
- `--uncapped` adds `--disable-gpu-vsync --disable-frame-rate-limit` → fps reflects real throughput (use for perf comparisons; the default is vsync-locked 60).
- `--help` prints usage. Env `HQ_CHROME` overrides the binary.

### Electron window capture (under Xvfb) — `experiments/electron-probe/main.ts`
```
xvfb-run -a -s "-screen 0 2560x1440x24" npx electron --no-sandbox --ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan \
  experiments/electron-probe/main.ts --url http://127.0.0.1:7461/experiments/bench/ --out /tmp/e.png --wait 6000
```
Loads URL, `executeJavaScript` → renderer + `__hq.stats()`, `webContents.capturePage()` → PNG, `app.getGPUFeatureStatus()`, exits. Verified: RADV renderer, correct image. Quirk: a 1920×1080 window on a 1920×1080 Xvfb screen captured 1919×1079 — make the Xvfb screen larger than the window. Recommendation: the real `electron/main` should accept `--shoot out.png [--shoot-wait ms] [--shoot-pose x,y,z,yaw,pitch]` implementing exactly this, so reviewers can verify the packaged app, not just web mode.

### Measurement caveats
- **GPU DPM**: `pp_dpm_sclk` levels 800/1100/2700 MHz. At a vsync-capped 60 fps the GPU idles at low clocks, so timer-query ms is inflated (same scene: 11.8 ms capped vs 4.4 ms uncapped in Electron; 6.7 ms capped headless). Compare configs only with `--uncapped`, median of ≥3 runs (±10 % run-to-run noise).
- Timer-query ms under ANGLE/Vulkan overlaps frames and can exceed 1000/fps; treat **uncapped frame time (1000/fps)** as the primary cost metric and gpuMs as secondary.
- Headless includes compositor + no-display overhead; a real window is similar or cheaper.

## 4. Perf budget — measured

Bench: `experiments/bench/` (`?n= inst= post=pp|three|none ao= aoq= half= bloom= outline=none|hull|edge shadow=none|blob|map scale= aa=smaa|msaa|none`), matrix runner `node experiments/bench/matrix.mjs` (needs `npx vite` on :7461).
Scene: ~136k-tri office (merged walls/floor + 5 InstancedMesh furniture types, 310 instances), 40 rigid 9-part "Clawd" characters (RoundedBox body, eyes, 4 legs, 2 arms; walk bob + squash/stretch + leg swing, ~700 tris each), MeshToonMaterial with a 3-step procedural `DataTexture` ramp, hemi + sun + 4 point lights, fog. "pp full" = pmndrs EffectComposer(HalfFloat) → RenderPass → N8AOPostPass(Low, halfRes) → EffectPass(depth-edge outline, mipmap Bloom, AgX tonemap, Vignette, SMAA). 1920×1080, DPR 1, uncapped, median of 3.

| config | fps uncapped | frame ms (1000/fps) | GPU timer ms | draws | tris | JS anim ms |
|---|---|---|---|---|---|---|
| no post, blob | 2486.3 | 0.40 | 0.44 | 16 | 149k | 0.07 |
| no post, hull outline | 2289 | 0.44 | 0.46 | 23 | 245k | 0.08 |
| pp: edge+bloom+AgX+vign+SMAA | 632.5 | 1.58 | 1.84 | 35 | 149k | 0.08 |
| pp + N8AO Performance half | 317.5 | 3.15 | 5.43 | 45 | 149k | 0.11 |
| pp + N8AO Low half | 311.1 | 3.21 | 5.3 | 45 | 149k | 0.15 |
| pp + N8AO Medium half | 303 | 3.30 | 5.4 | 45 | 149k | 0.13 |
| pp + N8AO Medium full | 214.2 | 4.67 | 8.93 | 44 | 149k | 0.11 |
| pp + N8AO High full | 147.7 | 6.77 | 14.54 | 44 | 149k | 0.12 |
| pp full, MSAA4 instead of SMAA | 250.3 | 4.00 | 6.84 | 43 | 149k | 0.05 |
| pp full, no bloom | 384.3 | 2.60 | 4.87 | 29 | 149k | 0.13 |
| pp full + shadow map 2048 PCFSoft | 348.7 | 2.87 | 3.55 | 55 | 298k | 0.11 |
| pp full, hull instead of edge | 313.4 | 3.19 | 5.23 | 52 | 245k | 0.13 |
| three composer: N8AOPass+Unreal+SMAA | 264 | 3.79 | 6.27 | 58 | 299k | 0.12 |
| pp full, NOT instanced (40x9 meshes) | 256 | 3.91 | 4.12 | 309 | 124k | 0.06 |
| pp full, 100 chars | 303 | 3.30 | 5.51 | 45 | 310k | 0.29 |
| pp full, 200 chars | 275.2 | 3.63 | 5.41 | 45 | 577k | 0.57 |
| pp full, renderScale 0.75 | 491 | 2.04 | 2.34 | 45 | 149k | 0.09 |
| pp full, renderScale 0.5 | 922.8 | 1.08 | 1.16 | 45 | 149k | 0.07 |
| pp + N8AO Low half + shadow map + hull | 357.9 | 2.79 | 3.27 | 62 | 394k | 0.12 |

Takeaways (1080p, 780M):
- (Deltas below are in uncapped frame ms; GPU-timer ms shows the same ranking with ~1.7× larger magnitudes.)
- **Scene geometry is nearly free** when instanced: 0.40 ms for 149k tris / 16 draws with no post. 200 characters vs 40 costs +0.4 ms (577k tris). Draw calls cost CPU/driver more than GPU: non-instanced 40×9 = 309 draws costs +0.7 ms; keep characters instanced per part (≈10–20 draws regardless of count) — or at least merge each character's rigid parts into one skinned-free mesh with per-vertex bone index + a small uniform/texture of part matrices.
- **SSAO is the big-ticket item.** N8AO half-res (Performance/Low/Medium all ≈ same) ≈ +1.6 ms frame (+3.5 ms GPU timer); full-res Medium +3.1 ms; full-res High +5.2 ms (4× the half-res cost). Use **N8AO halfRes, "Low"/"Medium"**, `aoRadius≈1–1.5 m`, `distanceFalloff≈0.5`, and drop it first in the quality ladder. SAO (three/examples) is slower and noisier *(not measured; known)*.
- **Bloom (pmndrs mipmapBlur)** ≈ +0.6 ms. Cheap; keep it. Use luminanceThreshold ~0.8–1.0 so only emissives (screens, neon, status lights) bloom.
- **Outlines**: depth-edge in the same EffectPass (merged into one fullscreen shader with bloom/tonemap/vignette) ≈ free; inverted hull ≈ +1 draw per part type and doubles character tris, still ≈ free on GPU. Recommendation: **inverted hull for characters** (clean, thick, colour-controllable, stable at distance — the "cute toy" read) **+ depth/normal edge pass at low strength for the environment**. Don't do hull on the whole office (walls/floors produce artefacts on hard edges).
- **AA**: SMAA effect is cheaper than MSAA×4 on the half-float composer target (MSAA×4 +0.8 ms frame / +1.5 ms GPU). Use SMAA (or FXAA at the lowest tier).
- **Shadow map** (one 2048² PCFSoft directional, instanced casters) measured within noise of blob shadows here (2.87 vs 3.21 ms — ±10 % noise), but real cost grows with shadowed area and caster count, and toon looks better with crisp blob/contact shadows. Recommendation: **blob shadows (instanced radial quads) for characters + N8AO for contact darkening + at most one small-frustum shadow map following the player (optional, high tier)**. Bake static AO into vertex colours for furniture seams.
- **Resolution is the main lever**: render scale 0.75 → 2.04 ms (−36 %); 0.5 → 1.08 ms (−66 %). Implement **dynamic resolution** on the composer (`composer.setSize(w*s,h*s)` + CSS upscale, or `renderer.setPixelRatio`) driven by a smoothed frame-time EMA with hysteresis; steps 1.0/0.85/0.75/0.6; floor 0.6.
- Post stack **"three/examples" EffectComposer vs pmndrs**: three's N8AOPass renders the scene itself (tris doubled: 299k vs 149k) and UnrealBloom is costlier (+0.6 ms vs pmndrs equivalent); pmndrs merges effects into one fullscreen pass. **Choose pmndrs `postprocessing`**. Caveats: stay on three 0.186; custom effects are written as `Effect` GLSL snippets (`mainImage(inputColor, uv, depth, out)`, `EffectAttribute.DEPTH` gives `readDepth`/`getViewZ` — verified in the bench edge shader); N8AO must be added as a Pass *before* the EffectPass.

### Recommended budget @1080p on 780M (target 60 fps with headroom = ≤ 10 ms GPU at the "high" tier)
| item | budget |
|---|---|
| draw calls | ≤ 150 (instancing per part/furniture type; merged static geometry per zone) |
| triangles | ≤ 500k visible (characters ≤ 2k tris each, office ≤ 300k) |
| lights | hemi + 1 directional + ≤ 4 point lights (MeshToon/Lambert; no per-pixel many-lights) |
| post | N8AO halfRes Low/Medium + one merged EffectPass (edge, bloom, colour grade LUT/AgX, vignette, SMAA) ≈ 3 ms frame / 5.3 ms GPU timer — the full bench stack runs ~310 fps uncapped, i.e. >4× headroom over 60 fps |
| shadows | blob quads + AO; optional single 1024–2048² map on high tier |
| JS per frame | ≤ 4 ms (bench animation of 200 characters = 0.6 ms) |
| textures | procedural canvases, no mipmaps for text; ≤ 64 MB total; update monitor canvases ≤ 2 Hz and only near the player |
| quality tiers | ultra: full-res AO + shadow map; high: default; medium: AO off-halfres-Performance, scale 0.85; low: AO off, bloom off, scale 0.7 |

Other practical notes: `powerPreference:'high-performance'`, `antialias:false` (post handles AA), `stencil:false`, DPR clamp ≤ 1 by default. Zone/room culling (hide groups outside visible rooms) keeps draw calls flat as the office grows. Pause rendering at 10 fps when `document.hidden` or window unfocused & idle. xterm WebGL addon: one WebGL context per open terminal; Chromium caps ~16 live contexts per page, so keep ≤ 1–2 xterm instances alive and render in-world monitors as Canvas2D textures (text snapshots), never as xterm instances.

## 5. Web mode + Electron architecture

```
node server/main.js [--port 7777] [--session hqtest]   ── HTTP (static dist/) + WS /ws, bound 127.0.0.1
electron/main.js   ── imports the same server module in-process (ESM main supported since Electron 28), opens BrowserWindow → http://127.0.0.1:PORT/?t=TOKEN
user: ssh -L 7777:127.0.0.1:7777 box   →   open http://localhost:7777/?t=TOKEN on laptop
```
- Bind `127.0.0.1` only (never `0.0.0.0`; the box has tailscale0 + docker bridges).
- **The WS grants terminal control = arbitrary shell execution**, so loopback binding is not enough (any local user/process, or a malicious web page in the user's browser via DNS rebinding, could reach it):
  1. **Host check** on HTTP and WS upgrade: hostname ∈ {`127.0.0.1`, `localhost`, `[::1]`}; ignore the port (user may tunnel to a different local port).
  2. **Origin check** on WS upgrade: require Origin present and its hostname loopback (browsers always send Origin on WS). Electron loads from the same http origin, so it passes too.
  3. **Token**: random 32-byte token generated per install, stored `~/.config/claude-hq/token` (0600), printed at startup as a ready-to-click URL. First request with `?t=` sets an `HttpOnly; SameSite=Strict` cookie and redirects to strip it; WS upgrade requires the cookie (cookies are sent on same-origin WS upgrades). Electron passes the token in the URL it loads.
  4. Strict CSP on the served page (`default-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; img-src 'self' data: blob:`) — also enforces "no external assets".
- Dev: `vite` on :7461 with `server.proxy['/ws'] → ws://127.0.0.1:7777` so dev and prod share an origin shape. Prod: `vite build` → `dist/`, served by the node backend (plain `http` + `fs`, correct MIME, gzip optional).
- Electron specifics: `--no-sandbox` (see §1), `contextIsolation:true`, no preload needed, deny window.open, block navigation off-origin, `before-quit` must release terminals (`terminal.release`) before exit (prior art: restores pane size).
- Reconnect: renderer keeps a WS backoff (1→10 s) and re-requests world on reconnect.

## 6. System stats sources — verified present here

| metric | source | verified value / note |
|---|---|---|
| CPU total + per-core % | `/proc/stat` deltas (`cpu`, `cpu0..15`; idle = idle+iowait) | 16 logical cores |
| load avg | `os.loadavg()` / `/proc/loadavg` | ✓ |
| CPU pressure | `/proc/pressure/{cpu,memory,io}` (PSI `some avg10`) | ✓ — nice "stress" signal |
| CPU freq | `/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq` | ✓ (kHz) |
| RAM / swap | `/proc/meminfo` MemTotal−MemAvailable, SwapTotal−SwapFree | 28 GB |
| disk | **`fs.statfsSync(path)`** (Node ≥18.15): `blocks*bsize`, `bavail*bsize` | `/` 2.01 TB ext4. **Avoid `df`**: exits non-zero here on stale FUSE mounts (`/tmp/.mount_orca-*: Transport endpoint is not connected`) |
| disk I/O | `/proc/diskstats` deltas (sectors×512) | ✓ |
| GPU busy % | `/sys/class/drm/card0/device/gpu_busy_percent` | ✓ 0 idle → ~70 under bench |
| VRAM / GTT | `.../mem_info_vram_{used,total}`, `mem_info_gtt_{used,total}` | VRAM 3 GiB carve-out, GTT 14 GiB; `mem_busy_percent` MISSING |
| GPU clock | `/sys/class/hwmon/hwmonN (name=amdgpu)/freq1_input` (Hz), or `pp_dpm_sclk` | 800 MHz idle → 2.4–2.7 GHz load |
| GPU/SoC power | amdgpu hwmon `power1_input` (µW, label PPT) | 8–50 W under load |
| GPU temp | amdgpu hwmon `temp1_input` (m°C) | 47 °C |
| CPU temp | hwmon `name=k10temp` `temp1_input` (label Tctl) | 59 °C |
| NVMe temp | hwmon `name=nvme` | 44 °C |
| Wi-Fi temp | hwmon `mt7921_phy0` | fun extra |
| net | `/proc/net/dev` deltas; skip `lo`, `docker*`, `br-*`, `veth*`; ifaces here: `enp3s0`, `wlp4s0`, `tailscale0` | ✓ |
| per-process top | `/proc/<pid>/stat` utime+stime deltas (field 14/15, `CLK_TCK=100`), RSS from `/proc/<pid>/statm`×4096, name from `/proc/<pid>/comm` | ✓ — can attribute CPU/RAM to each agent's process tree via herdr `pane.process_info` pid |
| battery | `/sys/class/power_supply` | none (desktop) → hide |
| uptime / hostname | `os.uptime()`, `os.hostname()` | ✓ |

Sampling: 1 Hz for CPU/mem/GPU/net (deltas), 30 s for statfs, 2–5 s for per-process scan. Locate hwmon by `name`, not index (indices are not stable across boots). Everything is sysfs/procfs reads — no native deps, no root.

## 7. Files
- `package.json`, `vite.config.js` (127.0.0.1:7461)
- `scripts/shoot.mjs` — headless GPU screenshot/perf tool
- `experiments/bench/{index.html,main.js,matrix.mjs}` — perf bench + matrix
- `experiments/electron-probe/main.ts` — Electron GPU probe + capturePage
- `experiments/flags.ts` — Chromium flag → renderer matrix
