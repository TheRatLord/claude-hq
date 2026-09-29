# Claude HQ: Art Direction & Style Bible

> **Partly superseded by `docs/DESIGN.md` v4** (DESIGN wins). Every superseded value below is ~~struck through~~ inline
> with a **→ DESIGN §x** pointer, so no struck hex, gain or rule may be implemented. DESIGN §12.2 lists the same rows.
> Everything not struck remains the style reference. Palette tokens live in `shared/palette.js` (DESIGN §5.5 wins on
> any name clash: the codex/other-LLM **bodies** are `bodySlate` / `bodyRose`, not the §2.1/§2.2 `slate`/`rose` tokens).

Status: v1 (art director). Scope: look, palette, lighting, materials, post-FX, characters, animation, diegetic and 2D UI.
Floor plan, gameplay and data plumbing live in other docs; this one constrains how they *look and move*.
Hard constraints: fully procedural (no downloaded models, textures, fonts, HDRIs, LUT files). `three`, `postprocessing`, `n8ao`, and `@xterm/*` from npm are fine.
Target: 60 fps (floor 45) at 1080p on a Radeon 780M, WebGL2, in both Electron and browser (web mode).

Units: metres, y up. "Clawd" = Claude agent character, "Shelly" = shell character.

---

## 0. Lessons from ~/claude-office (the previous attempt)

These come from `~/claude-office/docs/shots/*.png` and its DESIGN.md §7. It had no shadows, no post-FX, Lambert with vertex colours and additive sprite halos.

| Problem seen | Evidence | What we do instead |
|---|---|---|
| Characters read as **orange blobs/boxes**. At 0.62 m in 3.2–8 m rooms they're tiny, have hard unbevelled edges, and their faces can't be read beyond ~3 m. | 02, 15, 16 | Characters are the **heroes of the frame**: ~0.9 m tall in a **toy-scaled world** (desk 0.55 m). Bevelled clay forms, big eyes with specular glints, an ink outline, and a toon ramp whose terminator separates head from body. Silhouette test (§5.1). |
| **Flat, shadowless lighting.** Nothing sits on the floor; everything has the same value. | all | Cel ramp with **hue-shifted shadows**, N8AO contact occlusion, one shadow-casting key light (characters + key props only), and blob contact shadows. |
| **Loud, same-saturation everything.** Red/cream checkerboard floor, pink hex rugs, teal rugs, and green ivy all compete at full chroma. | 15, 02, 08 | 60/30/10 value discipline: quiet warm neutrals make up 60%, wood/fabric mid-tones 30%, and saturated colour is reserved for **agents, status, and emissive info** (10%). Floors are low-contrast. |
| **Faceted low-poly foliage** (icosahedron ivy/trees) looks noisy and cheap next to the box furniture. | 02, 15, 16 | One consistent form language: **soft-bevelled "clay/wood toy" shapes**. Plants are rounded blob clusters and capsule leaves with smooth toon shading, plus a gentle vertex-shader sway. |
| **Label spam.** Overlapping bubbles, nameplates and HUD chevrons fight each other, and cropped labels bleed off screen. | 02, 16 | Declutter system (§8.4): priority, distance fade, max visible count, and screen-space collision nudging. Nameplates only appear near the player or on hover. |
| **Box-city exterior** and a skyline of grey cubes break the mood. | 08 | Nothing big outside. Windows show a **painted gradient sky + soft distant hills/trees silhouettes + drifting clouds** (shader), heavily fogged. The diorama reads as a cozy interior. |
| **Generic dark "devtool" side panel** (#1b1a18 slab) visually unrelated to the world. | all | 2D UI is the same material language as the world: paper/ink cards, clay accents, rounded, with the same status colours and icons (§9). |
| No post-processing, and glow faked with sprites. | DESIGN §7 | Merged post stack with quality tiers (§4). |

What we **keep** from it (it's good): physical metaphors for stats, per-tool animation loops, the help-desk queue for blocked agents, the kanban wall, and sticky slots.

---

## 1. Direction: "Clay Studio Diorama"

A cozy, warm, slightly toy-like studio office, as if built from **matte polymer clay, painted wood and felt**. It's lit by late-afternoon sun and seen at the scale of its tiny inhabitants.

- **Why:** Claude's brand palette (clay #D97757, cream, ink) *is* a clay/paper palette, so the world and the characters come from one material family. Toy scale lets the characters dominate the frame. Cel ramps with soft outlines hide the lack of textures and look intentional on an iGPU (no PBR, no IBL, no high-res textures needed).
- **Mood words:** warm, tactile, calm-busy, cheeky. It should never feel neon-cyber or corporate-grey.
- **Contrast rule:** the environment stays low-chroma and mid-value. Agents are the most saturated, highest-contrast things in any frame. Status colour appears **only** where it carries meaning: rings, bubbles, emissive screens, lamps.
- **Form language:** everything has a bevel. `RoundedBoxGeometry` (three/examples, npm) with radius about 8–15% of the smallest dimension, 2–3 segments. No razor-sharp boxes, no faceted spheres (use ≥16 segments on visible spheres, or use capsules).
- **Scale:** Clawd is 0.9 m tall. Desks are 0.55 m high, chairs 0.32 m, doors 1.6 m, and ceilings 2.6–3.2 m (atrium 5.5 m). The player camera eye is at 1.15 m, so the player is a "big friend" looking slightly down on the characters, like a sim game. Walls are chunky: 0.25 m thick with a visible cream top cap (the diorama cut look in the overview/photo cam).

---

## 2. Palette

All values are sRGB hex. Materials take these as linear-converted uniforms (`Color.setHex` handles it with `ColorManagement` on). Keep a single `palette.js` exporting these names; **no ad-hoc hex in feature code**.

### 2.1 Core (brand + neutrals)
| Token | Hex | Role |
|---|---|---|
| `clay` | `#D97757` | Clawd body, primary accent, UI accent |
| `clayDeep` | `#B8593B` | Clawd underside, legs, shadow band of clay |
| `clayLight` | `#EBA283` | Clawd lit band highlight, hover states |
| `cream` | `#F4EDE3` | Walls, bubbles, paper, UI light surfaces |
| `paper` | `#FBF8F3` | Brightest surface (whiteboards, bubble fill) |
| `oat` | `#E4D9C8` | Secondary walls, trims, ceiling |
| `sand` | `#CDBFA8` | Floors (tile/terrazzo base), counters |
| `ink` | `#1F1E1D` | Outlines, text, eyes, UI dark surfaces |
| `ink2` | `#3A3733` | Secondary ink, UI borders, metal legs |
| `slate` | `#6B6760` | Muted text, inactive (UI only; **not** the codex body, which is `bodySlate` `#4D4B52` → DESIGN §5.5) |

### 2.2 Environment accents (desaturated, supporting)
| Token | Hex | Role |
|---|---|---|
| `oak` | `#C79A6B` | Desks, shelves, floor planks (light) |
| `walnut` | `#7B5238` | Bar, library, dark wood |
| `sage` | `#9DB38F` | Plants (lit), fabric sofas |
| `moss` | `#5F7F5B` | Plants (shade), deep green |
| `teal` | `#5E9EA0` | Accent walls, tiles, lounge fabric |
| `tealDeep` | `#2F5E62` | Terminal bar walls, night accents |
| `butter` | `#F1C66E` | Lamps, warm highlights, sticky notes |
| `lavender` | `#A99BD3` | Library accent, rugs |
| `rose` | `#E3A0A0` | Cushions, blush base (**not** the other-LLM body `bodyRose` `#C98FA0` → DESIGN §5.5) |
| `skyTop` / `skyHorizon` | `#8EC3E6` / `#FCE3C4` | Window sky gradient (day, golden hour) |

### 2.3 Status (semantic, consistent everywhere: 3D rings, bubbles, UI chips, stats)
| State | Hex | Emissive use |
|---|---|---|
| working | `#4FA3E8` | Monitor status strip; ~~floor ring~~ → thin near/selected-only ring, DESIGN §6.7 chroma budget |
| blocked | `#EF5A4C` | "!" bubble, beacon, pulsing ring (bloom) |
| done | `#63C48A` | Check flag, confetti base |
| idle | `#B3AA9D` | Dim ring (no emissive) |
| unknown | `#A98BE0` | "?" bubble |
| shell | `#7FE3A0` | Phosphor green (Shelly screen, bar neon) |
| shell-busy | `#F4B860` | Amber phosphor when a process is running |

Blocked is the **only** state allowed to animate colour (pulse) and to bloom strongly. It has to be spottable from anywhere.

### 2.4 Workspace colours (accessories, nameplates, rugs)
**→ DESIGN §5.5** (deep jewel tones bronze/olive/pine/indigo/plum/raspberry/forest/cocoa, hashed by **label**, with cream accessory trim).

~~`#5B8FD9` blueberry · `#6DB57A` mint · `#E2B64D` mustard · `#9A7FD1` grape · `#E0839E` bubblegum · `#4DB6AC` lagoon · `#E08A4F` tangerine · `#8C9AAB` pewter~~ (superseded: tangerine sat next to clay, mint was the old gemini body, all collided with status colours)

With more than 8 workspaces, cycle the colours and change **accessory type** (§5.4) so the combination stays unique.

### 2.5 Night variant
Time of day is multiplied into the key/fill/ambient uniforms and the LUT. The palette tokens themselves never change.

---

## 3. Lighting, materials, textures, text

### 3.1 Light rig (tied to real local clock, overridable in photo mode)
| Light | Day (10–16h) | Golden (16–19h, 6–8h) | Night |
|---|---|---|---|
| ~~Key `DirectionalLight` (sun through windows, the only shadow caster)~~ → DESIGN §5.0: fixed **studio key** (elev 60°, az 200°) shades and shadows; the sun enters only via gobo/sky/grade | ~~`#FFF3E0`, 2.2, elev 50°~~ | ~~`#FFC58F`, 2.0, elev 18°~~ | ~~Off, or moon~~ |
| Fill `HemisphereLight` (colours are reference; **gains → DESIGN §5.0 table**) | sky `#DDE8F2` / ground `#C9A887` ~~0.9~~ | `#F2D6C0` / `#A87C60` ~~0.8~~ | `#3A4466` / `#2A2018` ~~0.5~~ |
| Practicals (lamps, screens) | ~~Emissive only~~ | ~~≤ 3 `PointLight`s~~ | ~~≤ 4 `PointLight`s reassigned every 0.5 s~~ → DESIGN §5.6 lamp pools + ≤ 2 cross-faded points |

- **Shadows:** there's one `DirectionalLight` shadow, 2048² (1024² on Low). The shadow camera is a 24×24 m ortho box that **follows the player**, snapped to texel increments to avoid swim. Only layer `CASTERS` casts: characters, chairs, plants, big props. Static architecture receives only. Use `PCFSoftShadowMap`, `bias -0.0004`, `normalBias 0.02`. In the toon shader, shadow **multiplies into the ramp input** (so shadow = the shadow band, not black).
- **Contact:** a blob shadow decal under every character (radial gradient, `ink` at α 0.28, scales with jump height) remains **even with shadow maps on**. That's what makes them feel grounded.
- **God rays (High only):** additive, fogged quads from windows during golden hour, with a slow dust-mote particle field (instanced points, 200 max). This is cheap and sells the mood.
- **Fog:** `FogExp2` tinted to `skyHorizon`/night colour, density 0.012. It mostly affects window vistas and long atrium views.

### 3.2 Toon material (the one lit material)
Patch `MeshStandardMaterial`/`MeshLambertMaterial` via `onBeforeCompile`, so we keep three's shadow, fog and instancing chunks. Don't hand-write a `ShaderMaterial` for lit surfaces.

```
// replace diffuse in lights_fragment_end / RE_Direct:
float ndl = dot(N, L) * 0.5 + 0.5;                // half-lambert
ndl *= mix(1.0, shadowFactor, 0.85);              // shadow feeds the ramp
float t = smoothstep(uBand0 - uSoft, uBand0 + uSoft, ndl);      // shadow → mid
float t2 = smoothstep(uBand1 - uSoft, uBand1 + uSoft, ndl);     // mid → lit
vec3 shade = mix(uShadowTint, vec3(1.0), t * 0.7 + t2 * 0.3);  // 3 bands, soft edges
// hue-shifted shadow: ~~uShadowTint #8C7FA8-ish blended 35% with albedo~~ → DESIGN §5.0: independent uShadowTint #AAA5DC
vec3 diffuse = albedo * shade * lightColor;
// fresnel rim (characters: 0.35, props: 0.12, env: 0)
float rim = pow(1.0 - saturate(dot(N, V)), 3.0) * uRim * t;
diffuse += rim * mix(lightColor, uRimColor, 0.5);
```
- Defaults: `uBand0 0.42`, `uBand1 0.72`, `uSoft 0.04` (characters 0.03, crisper; env 0.08, softer).
- **Specular:** none on the environment. Characters get a fake **clay sheen**: `pow(max(dot(N,H),0.),24.)`, stepped at 0.5 and multiplied by 0.15. That's a soft highlight blob that sells "polymer clay".
- **Ambient:** the hemisphere colour multiplied by `mix(0.55, 1.0, N.y*0.5+0.5)`, which is a cheap sky/ground gradient.
- **Variants** come from uniform flags, not separate shader sources. Minimise program count (target ≤ 12 programs total).
  - `toonChar`: rim + sheen + `uFlash` (hit/emote flash to white) + `uDesat` (unknown/offline ghosting)
  - `toonProp`: instanced, colour from `instanceColor`, low rim
  - `toonEnv`: world-space procedural patterns (§3.3), no rim, receives shadows
  - `emissiveScreen`: unlit; content is a canvas texture × intensity (can exceed 1.0 so bloom picks it up)
  - `glass`: unlit fresnel + sky gradient reflection fake, `transparent`, `depthWrite false`
  - `foliage`: toonEnv + vertex sway (`sin(time*1.3 + worldPos.x*2.)*0.03*heightFactor`)
- **Matcap-like gradient fallback (Low tier):** the same material, but the ramp is driven by `N.y` and a fixed view-space light, with no shadows. It looks the same at 1/3 of the cost.

### 3.3 Procedural surfaces (no image files)
Prefer **shader patterns in world space** inside `toonEnv`. They're resolution-free, have zero texture memory, and don't need UVs on merged geometry. Use a `uPattern` int per material:

| Surface | Technique |
|---|---|
| Wood planks (floors) | `plankId = floor(worldPos.x / 0.18)`; stagger z by `hash(plankId)`. Per-plank tint `±6%` lightness between `oak` and a darker oak. Grain: `sin((worldPos.z + fbm2(p*vec2(8,1))*0.3) * 60.)` at 4% amplitude. Seam: 1.5 cm dark line (`ink` at 25%). |
| Terrazzo (lobby/café) | ~~`sand` base~~ + Voronoi chips (2 scales) at 15% coverage, low contrast. **Café → DESIGN §5.5:** sage-teal base `#5F7A74`, chips cream/oat/`tealDeep` only (~~clay, walnut chips~~). |
| Tiles (kitchen/server room) | `fract(worldPos.xz / 0.3)` grout 6 mm in `oat`. Slight per-tile value jitter. |
| Carpet / felt (focus areas, library) | Two-octave value noise speckle ±5% + optional pattern (stripes, or a subtle chevron) in 2 close tones. Never a checkerboard. |
| Walls | Flat `cream`/`oat`. A 0.9 m wainscot band in a darker token, and a 3 cm trim line. A plaster wobble noise at 2% is optional. |
| Brick (Studio Street) | `fract` brick bond on worldPos.xy/zy with running offset; ~~bricks `clayDeep`↔`walnut`; mortar `oat`~~ → DESIGN §5.5: **painted brick**, sage-grey `#8F9A8E` bricks ±4% L, grey-green mortar `#6F7A70`. |
| Fabric (sofas, beanbags) | Vertex-coloured + stepped ramp + 3% noise. That's enough. |
| Plants | Geometry, not textures: leaf = flattened capsule/lathe; bush = 3–7 merged icospheres (detail 2, **smooth normals**) with vertex colour gradient moss→sage by height; monstera = extruded `Shape` leaf with notches; hanging pothos = CatmullRom curve instanced leaves. |
| Screens | `CanvasTexture` (monitor content) + shader scanlines 3% + vignette + subpixel RGB stripes at 2%, only within 4 m. |
| Sky (windows) | Fullscreen-less: a big inverted sphere/cylinder with a gradient `skyTop→skyHorizon`, 3 layers of fbm cloud bands scrolling slowly, and silhouette hills (sin sums) in 2 fogged layers. |

If a canvas texture is unavoidable (signage, posters, book spines), draw it once at startup into **one shared atlas** (2048², mipmapped, anisotropy 4).

**Posters/art:** generative. Use Bauhaus shapes in palette tokens, a "keep shipping" typographic poster, a framed "family photo" of Clawds (rendered by a second camera at startup into a RenderTarget, which is a fun touch).

### 3.4 Text without external fonts
- **Font stacks.** The web mode client machine has its own fonts, so always use stacks.
  - `--font-ui: ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Ubuntu", "Cantarell", "DejaVu Sans", system-ui, sans-serif`
  - `--font-mono: ui-monospace, "JetBrains Mono", "Cascadia Code", "SF Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace`
  - `--font-display` (signage): the same as UI at weight 800, letter-spacing −0.01em
- **In-world text:** Canvas 2D → `CanvasTexture`, drawn at 2× target pixel density. `await document.fonts.ready` before the first draw.
  - **Never use troika-three-text or any lib that fetches a font from a CDN.** Troika's default font is fetched from a URL, which is forbidden.
- **Dynamic, frequently changing text** (monitors, bubbles, split-flap): per-object canvas, redraw only on change, capped at 4 Hz. Bubbles pool 24 canvases.
- **Big static signage:** optional runtime SDF. Rasterise glyphs from the system font into a canvas, then run a simple 8SSEDT/EDT into a single-channel atlas at startup. That gives crisp room names at any distance. It's nice-to-have (Medium+); otherwise use a 2× canvas.
- **Split-flap / 7-seg / dot-matrix displays** are drawn **in shader** from a tiny procedural glyph table (5×7 bitmaps as a const int array). There are no canvases, they're crisp at all distances, and they look great for stats.

---

## 4. Post-processing stack

Use `postprocessing` (pmndrs) `EffectComposer` with `HalfFloatType` buffers, and merge effects into as few `EffectPass`es as possible. The renderer uses `toneMapping = NoToneMapping` (the composer does tone mapping), `outputColorSpace = SRGB`, and `antialias: false` (SMAA in post). Set `powerPreference: 'high-performance'`.

Priority order (what gets cut first is the bottom):

| # | Effect | Implementation | Budget @1080p (780M) | Tier |
|---|---|---|---|---|
| 1 | **Tone map + grade** | ~~`ToneMappingEffect(AGX)` or ACES Filmic~~ → DESIGN §5.0: `ToneMappingEffect(NEUTRAL)`, AgX/ACES banned. `LUT3DEffect` with a **32³ LUT generated in JS** at startup: lift shadows toward `#2A2233`, warm the mids (+4% R, −3% B), slight S-curve, saturation 1.05, highlight roll-off toward cream. Separate day/golden/night LUTs, blended by `blendFunction` opacity. | 0.2 ms | All |
| 2 | **SMAA** | `SMAAEffect` preset MEDIUM (Low: FXAA via three `FXAAShader`, or none + DPR 1). | 0.6 ms | All |
| 3 | **Ambient occlusion** | `N8AOPostPass` (npm `n8ao`), `halfRes: true`, ~~`aoRadius 0.6`, `distanceFalloff 0.5`, `intensity 2.5`~~ (→ DESIGN §5.1 toy scale: 0.32 / 1.0 / 1.5; characters drawn after AO), `color` = `#3A2A30` (tinted AO, not black), quality "Low"/"Medium". Low tier: off, replaced by baked vertex AO in static geometry (seam/corner darkening at build time). | 1.2–1.8 ms | Med+ |
| 4 | **Outlines** | Two-layer strategy (§4.1). | 0.3 ms (hull) + 0.8 ms (edge pass) | Hull all tiers; edge High |
| 5 | **Bloom (selective by threshold)** | `BloomEffect` mipmapBlur, `luminanceThreshold 1.0`, `luminanceSmoothing 0.2`, `intensity 0.8`, `radius 0.7`. Selectivity comes from **HDR emissive**: only materials pushed > 1.0 bloom (screens 1.4, status beacons 2.5, lamps 1.8, phosphor 1.6, confetti 1.2). The environment never exceeds 1. | 0.8 ms | Med+ (Low: intensity 0.4, 3 mip levels) |
| 6 | **Vignette** | `VignetteEffect` offset 0.3, darkness 0.45, tinted via LUT. | ~0 | All |
| 7 | **Film grain** | `NoiseEffect` blend OVERLAY opacity 0.035, premultiply. Animated at 24 Hz (not every frame: temporal calm). | ~0 | Med+ |
| 8 | **Chromatic aberration** | 0.0006 offset at the edges only. Spikes briefly on "error" events and when the terminal drawer opens (juice). | 0.1 ms | High |
| 9 | **Tilt-shift / DOF** | `TiltShiftEffect` (overview/photo camera: turns the office into a miniature) or `DepthOfFieldEffect` focusing on the hovered agent. Also used when "inspecting" an agent: a focus pull onto them with a 0.4 s ease. | 1.5 ms | Photo mode / inspect (Med+) |

~~The merged pass order is `[N8AO] → [Outline edge] → EffectPass(Bloom, ToneMapping, LUT, Vignette, Noise, CA) → EffectPass(SMAA)`.~~ → DESIGN §5.1 (RenderPass → N8AO → CharPass → Edge/Bloom/Tone/LUT → SMAA → Vignette/Noise/CA).

### 4.1 Outlines
- **Characters + hero props** (desk items, held props, the stats objects): an **inverted hull**, meaning a back-face mesh sharing geometry with a `MeshBasicMaterial`-derived material, extruded along the normal in clip space for a **constant screen-width** of 2.2 px at 1080p. Colour is `ink` mixed 20% with the part colour (so clay gets a deep brown line, not black). This is cheap and stable, but it doubles the character draw calls, so use the `BatchedMesh` path (§10) or skip the hull beyond 18 m.
- **Environment:** a screen-space edge pass, `ink` at low opacity, **fading with distance** (pencil feel, not comic heavy). ~~Sobel on depth; Medium depth-only edges~~ → DESIGN §5.1: **planarity test on reciprocal depth** with distance and view-angle fades (no false lines on grazing floors); High adds reconstructed normals (never a normal prepass).
- Hull width → DESIGN §5.1 (distance-scaled 1.2–3.2 px, ~~constant 2.2 px~~).

### 4.2 Quality tiers & auto-scaling
**Superseded → DESIGN §5.2** (tier table, shadow casters, edge modes, pass-shedding auto-scaler). Kept for history only:

| Tier | Render scale | Shadows | AO | Bloom | Edge outline | Hull outline | Extras |
|---|---|---|---|---|---|---|---|
| Low | 0.75 × DPR1 | Off (blob only) | Baked vertex AO | Light | Off | ≤ 10 m | FXAA, no grain |
| Medium (default on 780M) | 1.0 × DPR1 | ~~1024², chars only~~ | N8AO half-res Low | On | ~~Depth-only~~ | ≤ 18 m | SMAA, grain |
| High | 1.0 (DPR up to 1.5) | 2048² | N8AO half-res Medium | On | Depth+normal | All | God rays, CA, dust |
| Photo | 1.0–2.0 | 4096² | Full-res | On | On | All | Tilt-shift/DOF, free cam, hides HUD |

Auto: keep an EMA of GPU frame time (`EXT_disjoint_timer_query_webgl2` when present, else rAF delta). If > 20 ms for 2 s, drop render scale by 0.1 (min 0.6), then drop the tier. If < 12 ms for 5 s, step back up. The tier is shown in an F3 perf overlay and saved in localStorage.

---

## 5. Characters

### 5.1 Silhouette & readability rules
- Every character must be identifiable **in black silhouette** at 64 px tall: Clawd = wide block + side nubs + 4 legs; Shelly = tall box head on a thin neck + one wheel + antenna.
- **Status must read in silhouette too:** blocked = arm straight up waving; working = hunched forward at a desk; done = arms up / jumping; idle-sleep = slumped and flattened; thinking = one arm to chin with a tilted body.
- The eyes are the most important feature. They're always visible from the front 3/4, glints are always on, and they're **never smaller than 1/9 of body width**.

### 5.2 Clawd (Claude Code agents)
A 3D toy reinterpretation of the Claude Code terminal mascot (the pixel creature: wide terracotta block, two tall dark eye slots near the top, side "arm" nubs, four stubby legs underneath). Keep that identity; add bevels, a face, and elasticity.

**Rig** (`Object3D` hierarchy, no skinning; all meshes use `toonChar` in shared geometry):
```
root (world pos, yaw)                         ← locomotion writes here
└─ hips (y=0.16)                              ← bob, squash/stretch scale, lean
   ├─ body  RoundedBox 0.72w × 0.54h × 0.46d, r=0.1   clay (vertex-colour gradient: clayDeep at bottom 15% → clay)
   │  ├─ face (z = +0.232 surface)
   │  │  ├─ eyeL/eyeR  RoundedBox ~~0.075w × 0.15h~~ 0.09w × 0.17h (→ DESIGN §6.1) × 0.03d, r=0.035, ink, at x ±0.145, y +0.08
   │  │  │  └─ glint  sphere r=max(0.018 m, 2.5 px) paper, ~~fixed offset~~ screen-space offset toward the key light (→ DESIGN §6.1)
   │  │  ├─ lidL/lidR  clay box that slides down over the eye (blink/squint/sleepy); scale.y drives it
   │  │  ├─ brows (optional per-personality) thin ink capsules, hidden by default, appear for worried/angry/determined
   │  │  ├─ mouth  small canvas-atlas quad (8 frames) 0.10 × 0.06, y −0.06; hidden when neutral (the mascot has no mouth; the mouth appears only for emotes)
   │  │  └─ blushL/R  disc r=0.045, rose, α 0.55, additive=false, shown on happy/embarrassed/done
   │  ├─ armL/armR pivot at x ±0.36, y +0.02    ← side nubs
   │  │  └─ upper  capsule r=0.055 len 0.10, clay
   │  │     └─ fore (extendable: scale.y 1→2.4 "noodle arm" for reaching keyboard/props)
   │  │        └─ hand  sphere r=0.06 (prop attach socket `hand.prop`)
   │  ├─ accessorySocket (top of head, y +0.29)
   │  ├─ backSocket (z −0.24): backpack (context size), jetpack, etc.
   │  └─ neckSocket: scarf / lanyard badge
   └─ legs ×4 pivots at x ±0.12/±0.25, z ±0.1, y 0     clayDeep capsules r=0.05 len 0.13, rounded feet
      (front pair and back pair are phase-locked, diagonal gait)
blobShadow (child of root, not hips)
hull outline meshes mirror body/arms/legs (not face parts)
```
Overall ~0.88 m tall standing (legs 0.16 + body 0.54 + accessory). About 26 meshes, ~3.5k tris.

**Colour variants by agent kind** (the same rig, so all animation is shared):
| Kind | Body | Distinguisher |
|---|---|---|
| claude | `clay` (±4° hue, ±5% L per personality) | Classic slot eyes |
| codex | ~~`#5E7FC9` slate-blue~~ → **`bodySlate` `#4D4B52`** (DESIGN §5.5) | Round paper eyes (spheres); ~~a tiny visor band~~ (removed: rim × 1.5 + dark hull instead) |
| gemini / other LLM | ~~`#9A7FD1` / `#6DB57A`~~ → **`bodyRose` `#C98FA0`** | Diamond eyes, sparkle glint |
| unknown agent | ~~`#A8A29A`~~ → **`bodyPebble` `#77736E`** | Eyes with a "?" antenna, desaturated 30% |

The model tier is a small **emblem pin** on the lanyard badge (opus = gold star `#E8B84A`, sonnet = cream circle, haiku = mint leaf). It's subtle; accessories are for workspaces.

### 5.3 Face system
The face is driven by a small state machine with **layers**: base expression (from state) + transient (reaction) + blink + look-at.

| Expression | Eyes | Lids | Mouth | Extras |
|---|---|---|---|---|
| neutral | Slots | Open | Hidden | — |
| focused | Scale.y 0.8, look at the monitor | 20% down | Hidden | — |
| happy | Replaced by `^ ^` arcs (thin ink torus segments) | — | Small open smile | Blush |
| worried | Slots, inner corners up via brows | 10% | Wobbly line | Sweat drop |
| surprised | Scale 1.25 | Open | "o" | — |
| sleepy | — | 85% down, slow breath | Small "o" snore | Zzz particles |
| dizzy | Spinning `@` (canvas quad swap) | — | Squiggle | Stars orbiting the head |
| determined | Slightly squashed | Flat top 25% | Hidden | Brows angled down |
| love / celebrate | Hearts or stars (canvas quad) | — | Wide smile | Blush + sparkle |

- **Blink:** every `2.5–6 s` (seeded), a 120 ms close / 60 ms hold / 100 ms open, with a 12% chance of a double blink. Also blink when the head turns more than 45°.
- **Look-at:** eyes translate on the face plane by up to ±0.03 m x / ±0.02 m y toward a target, with the body turning after a 150 ms lag. Priority: the player (within 3 m and in front) > an interaction partner > held prop/monitor > wander noise (saccades every 0.8–2 s).
- **Squint** when the player "shines" on them (hover + E) as a cute acknowledgment: happy squint + a small hop.

### 5.4 Workspace accessories (group identity)
Head accessory **type** = `workspaceIndex % 8`, and **colour** = workspace colour. ~~A small ring on the floor under a seated agent also takes the workspace colour.~~ (Removed → DESIGN §5.5: no workspace-coloured ring exists; accessories carry a cream trim.) This way a group of agents from one workspace looks like a team from across the room.

| # | Accessory | Physics bits |
|---|---|---|
| 0 | Beanie with pompom | Pompom on a spring |
| 1 | Over-ear headphones | Band flex on squash |
| 2 | Party/cone hat | Tip on a spring |
| 3 | Propeller cap | Propeller spins ∝ speed (working = constant spin) |
| 4 | Bucket hat | Brim wobble |
| 5 | Scarf (neck) | 3-segment spring tail |
| 6 | Bow on top | Ribbon ends on springs |
| 7 | Antenna headband with a bobble | Bobble on a strong spring |

With more than 8 workspaces, the second cycle adds a stripe pattern to the accessory and cycles the colours.

**Tab / sub-group:** the lanyard badge shows the tab number. Its stripe colour stays workspace; the number is ink.

### 5.5 Personality (seeded from `hash(agent name or pane id)`)
Use a deterministic PRNG (mulberry32) that produces these knobs:
- `energy` 0.75–1.3: multiplies animation amplitudes and speeds.
- `bounciness` 0.8–1.2: squash spring stiffness.
- `width` ±6% and `height` ±5% (chubby vs tall). `hue` ±4°, `lightness` ±5%.
- `blinkRate`, `saccadeRate`.
- `favoriteFidget` from {stretch, hop-in-place, look-around, dance-shimmy, yo-yo, juggle-pebbles, spin, polish-accessory}.
- `favoriteSpot` from {window, plants, coffee, arcade, beanbag, library}, which is a bias for idle wandering.
- `walkStyle` from {trot, waddle, skip}. Skip only happens when mood is happy.
- `voice` pitch for WebAudio blips (if audio is enabled).
- Names show in nameplates; nothing else identity-bearing is randomised per session, so the same agent **always** looks the same.

### 5.6 Shelly (plain shell panes)
A little retro terminal robot. Clearly not a Claude.

```
root
└─ base  single wheel: torus/sphere r=0.07 ink2, rolls (angle = dist/r)
   └─ spine  spring-loaded neck: 3 stacked capsule segments (lean lag gives wobble), ink2, height 0.22
      └─ head  CRT: RoundedBox 0.40w × 0.32h × 0.34d r=0.05 in beige `#E6DCC6`, with an ink bezel inset
         ├─ screen  slightly bulged plane (curved via vertex shader), `emissiveScreen` material
         │    Face = glyphs: idle ">_" (blinking cursor = its blink), busy spinner "⠋⠙⠹", happy "^_^",
         │    error "x_x", sleepy "-_-", vim "i_"; plus a scrolling tail of the real last output line at small size when close
         ├─ vents / knobs (2 small cylinders at the side; knobs rotate while busy)
         └─ antenna  spring-mounted bobble: green idle / amber busy / red flash on error (emissive → bloom)
      arms: two thin ink2 "cable" arms (tube), claw hands (2 small boxes)
```
About 0.75 m tall. The phosphor colour is `shell` green at the prompt and `shell-busy` amber while a process runs. The screen has scanlines and a slight curvature vignette, and bloom gives it a CRT glow. It rolls with lean-into-acceleration: a strong tilt on start and stop, overshoot, and a spring back.

The process shows as a prop (see §7.3).

### 5.7 Mini-Clawds (subagents / Task)
0.45× scale Clawds with **no accessory** and a little white "sprout" antenna (they're interns). They have higher energy (1.4) and a squeaky-short walk. They pop out of a clap-cloud and poof away (6 spheres expanding + fade).

---

## 6. Animation bible

### 6.1 Principles (non-negotiable)
1. **Squash & stretch on everything that moves vertically:** landings, hops, sitting down, starting to walk. Volume-preserving: `scale.y = s, scale.xz = 1/sqrt(s)`.
2. **Anticipation:** there's a counter-move before every significant action. A 90–150 ms crouch (s=0.85) before a hop, and a lean back before a sprint.
3. **Overshoot + settle:** all target-seeking values (body yaw, lean, arm extension, UI pops) go through **damped springs**, never linear lerps.
4. **Follow-through / secondary motion:** accessories, antenna, scarf, pompom, backpack, Shelly's neck all use springs driven by the hips' acceleration.
5. **Never fully still:** a breathing scale of ±1.5% at 0.3 Hz, micro-sway from noise, blinking, and saccades.
6. **Exaggerate state:** working is *frenzied* typing, blocked is *frantic* waving, done is a *big* jump. Tone down only when the player is inspecting at close range (energy × 0.8, so it's readable).
7. **Stagger:** no two agents are in phase. Seeded phase offsets, plus per-agent tempo ±10%.

### 6.2 Procedural toolkit (implement once, in `anim/`)
- `Spring1D` / `Spring3D`: semi-implicit Euler with `k = (2πf)²`, `c = 2ζ·2πf`, integrated per frame with dt clamped to 1/30.
  - Presets: `snappy f=6 ζ=0.5`, `bouncy f=3.5 ζ=0.3`, `floaty f=1.5 ζ=0.6`, `jiggle f=8 ζ=0.15` (accessories).
- `SecondOrderDynamics` (the t3ssel8r f/ζ/r form) for anticipation on targets (r < 0 gives an automatic wind-up).
- `noise1(t, seed)`: a cheap value/simplex noise for sway, looking around, and hand jitter while typing.
- **Easing library:** `easeOutBack`, `easeOutElastic`, `easeInOutSine`, and `bounce`.
- **Layered pose blending:** a pose is a set of joint rotations/positions/scales.
  - Layers: `locomotion` → `action` (state/tool loop, blend in 0.25 s) → `reaction` (one-shot, preempts, 0.1 s in, 0.3 s out) → `additive` (breath, springs, look-at, noise).
  - Masks: an action can claim arms-only so the character can type while its legs idle.
- **IK-lite:**
  - **Feet:** each leg has a world "plant" point. During stance the foot stays planted (the leg pivot rotates to reach it). When the hip gets more than a 0.12 m stride from the plant, a step triggers: an arc lift of 0.05 m over 0.15 s, landing ahead by velocity × 0.12 s. Stairs/ramps use the floorY lookup.
  - **Hands:** a 2-bone analytic reach in the arm plane. The noodle forearm scales to reach targets up to 0.3 m (keyboard, mug, clipboard). Used for typing, holding props, and waving.
- **Look-at:** yaw the body (spring) plus eye offset (fast). Clamp body turn to 60° while seated.
- **Path motion:** follow navmesh/graph waypoints with Catmull-Rom smoothing.
  - Speed `0.9 m/s × energy`. Hurry (blocked going to the help desk) is 1.6 m/s with a forward lean of 12°.
  - **Bank** into turns: `roll = -angularVel × 0.08`.
  - Arrival decelerates with a spring and a small overshoot hop.

### 6.3 Locomotion
- **Trot (default):** diagonal leg pairs. Step frequency `3.0 Hz × energy`.
  - Hip bob = `|sin(phase)| × 0.035`. Squash to 0.94 at each contact, stretch to 1.04 at mid-air.
  - Body pitch +6° forward. Arms swing ±25° counter-phase.
- **Waddle:** lower frequency (2.2 Hz) with a large roll of ±8°.
- **Skip (happy/done):** a hop every 2 steps with an airborne stretch to 1.12 and a land squash to 0.82.
- **Start/stop:** a 120 ms anticipation lean opposite to motion, then a burst. Stopping is a slide + skid lean + settle wobble.
- **Sit:** hop onto the chair with anticipation crouch → arc → land squash 0.8 → settle. Standing up is the reverse with a little "hup" stretch.
- **Shelly:** the wheel roll is purely kinematic. The body leans with acceleration (spring bouncy), the head lags via neck springs, and the antenna whips.

### 6.4 herdr state → behaviour (base layer)
herdr `agent_status`: idle / working / blocked / done / unknown. Location is chosen by the gameplay layer; this table is the **look**.

| State | Pose / loop | Face | Diegetic signal | Notes |
|---|---|---|---|---|
| working | At its desk, hunched, tool loop (§6.5) | focused/determined | Monitor status strip + real output lines (→ DESIGN §6.7); ~~a light `working` ring under the chair~~; task placard on the desk | ~~Sweat drops after 5 min continuous; a steam puff from the head after 15 min.~~ → DESIGN §6.7: sweat = context ≥ 180k; mug after 10 min, steaming after 30 min. |
| blocked (fresh, < 20 s) | **Stands on its chair**, one noodle arm straight up waving at 3 Hz, other hand cupped at its mouth ("hey!") | worried → surprised pulses | Big red "!" bubble (bloom), pulsing floor beacon ring visible across the office, soft red pulse on the rim light | Startle hop on the transition |
| blocked (~~≥ 20 s~~ → > 10 s, DESIGN §6.4) | Walks (hurry) to the Help Desk queue and holds a **ticket** with the prompt title; hops impatiently every ~4 s; checks an imaginary watch | worried; after 2 min, pouty (brows down, cheeks puffed) | "!" bubble + ticket shows "waiting 1:23" | The oldest in the queue gets a spotlight |
| done | **Celebration:** anticipation crouch → 0.6 m jump with a 360° spin (energy > 1.1) or star jump → confetti burst (60 instanced quads in palette colours) → lands with squash → happy skip to the coffee/lounge | happy + blush | Green ✓ flag bubble for 6 s, then a small ✓ badge | Sips coffee every ~4 s. Pairs with other done/idle agents to chat (§6.7). |
| idle (< 2 min) | Seated: chair swivel, doodling, stretching arms overhead, favoriteFidget | neutral, bored glances | None | |
| idle (2–10 min) | Wanders to favoriteSpot: watering plants, window gazing, arcade, ping-pong in pairs, reading | neutral / content | None | |
| idle (> 10 min; → DESIGN §6.4.1 ladder: naps alternate with hobbies) | **Sleeps**: beanbag/nap pod or face-down on the desk. Body flattened to s=0.85 with slow breathing at 0.2 Hz, ±5% | sleepy | Zzz letters (canvas sprites) drift up and fade | If the player walks within 1.5 m: wakes with a startled hop + surprised face, then sleepily goes back to it |
| unknown | Standing still, ~~slightly translucent (α via dither)~~ **opaque** (`uDesat` 0.6, violet fresnel edge, → DESIGN §5.1), slow look-around | neutral, blinks slower | Grey "?" bubble | A ghostly "static" shimmer in the shader |
| (spawn) | Pops out of the elevator/door with a "ta-da" arms up, or tumbles out of a drop-pod tube with a squash landing | surprised → happy | Sparkle | |
| (gone) | Waves goodbye, walks into the elevator, doors close | happy | Poof | |

### 6.5 Claude tool → action loop (while working)
The tool comes from the Claude transcript/herdr detail. Debounce changes under 1.5 s. Unknown tools fall back to "generic typing".

| Tool | Action (arms layer unless noted) | Prop (attached to `hand.prop` or desk) | Bubble text |
|---|---|---|---|
| (thinking / no tool, working) | Chin-rest: one arm to chin, body tilt 8°, slow sway; eyes look up-left | 3 thought puffs + an orbiting "?" or tiny spinning gears; after 20 s a lightbulb flickers | "thinking…" |
| Read | Holds an open book at face height, eyes scan L→R (saccade loop), page flip every 1.5 s | Book, cover coloured by file extension hash | `Read foo.ts` |
| Grep | Book + **magnifying glass** sweeping, leans in; a "found!" eyebrow pop on each match | Magnifier (torus + disc glass) | `Grep "pattern"` |
| Glob | Flips through a card file box rapidly, cards flying | Card box | `Glob **/*.ts` |
| Edit / MultiEdit | Typing at 5 Hz with a pencil tucked behind the ear; on each edit completion, a red pencil stroke pop on the monitor + eraser crumbs | Pencil | `Edit file.ts` |
| Write | **Typing frenzy** at 8 Hz, noodle arms blurring (3-frame hand-jitter noise), paper sheets spit from the desk printer | Paper stack grows | `Write file.ts` |
| Bash | Pounding keys at 7 Hz, leaning in, little `>_` sparks jumping off the keyboard; a long run (> 10 s) turns into drumming fingers + watching | Mini terminal hologram above the desk showing the command | `$ npm test` (truncated) |
| WebSearch / WebFetch | Satellite-dish antenna pops up on the head and rotates; or (station trip) binoculars at the window | Dish / binoculars | `🌐 query` (drawn icon, not emoji font) |
| Task / Agent | Claps twice → mini-Clawds pop out and scurry off to adjacent desks; the parent "supervises", pointing | Clipboard | `delegating ×N` |
| TodoWrite | Clipboard, ticking checkboxes with a pencil, satisfied nod per tick | Clipboard with lines | `todo 3/7` |
| NotebookEdit | Writes in a spiral notebook | Notebook | |
| MCP tool (`mcp__*`) | Plugs a cable from its back into a wall/desk port; the cable glows, pulsing | Cable (tube) | tool name short |
| Context compaction | Stuffs its backpack, sits on it to squash, it springs back smaller | Backpack | "compacting…" |
| Error / tool failure (event) | Dizzy face, a small smoke puff from the monitor, the monitor flashes red, a shake | — | "!" small |
| Test pass / fail (if detected) | Fist pump + green check / slump ~~+ personal rain cloud for 10 s~~ (rain = blocked > 5 min only, DESIGN §6.7) | — | |
| git commit (Bash detection) | ~~Carries a wrapped parcel box to the shipping area~~ → DESIGN §6.7: desk envelope stamp + **pneumatic capsule**; parcels mean done sign-off | ~~Parcel box~~ Capsule | "shipped!" |

**Context size** shows on the back: backpack none/small/medium/overstuffed (papers poking out) at 50k/100k/150k. Above 180k, sweat + occasional stagger. Walk speed ×0.9/×0.75.

### 6.6 Shell process → behaviour (Shelly)
**Superseded → DESIGN §6.7 Shelly table** (all at its ENG bench) **and the Shelly idle ladder (DESIGN §6.4.1)**. Kept for
flavour only; do not implement the booth/DJ/rotary-phone/shipping-dock rows.

| Process | Behaviour |
|---|---|
| Prompt / idle | Sits at the terminal bar, sipping (a tiny cup with a green drink); cursor blink = eye blink |
| vim / nvim / nano / helix | Knitting in a cozy booth (two needle props, yarn ball in phosphor green) |
| Test runners | Juggling 3 balls; drops one on failure |
| Dev server / docker / `*serve*` | DJ booth, head-bobbing with the antenna whipping, screen shows an EQ |
| htop / top / btop | Reading a newspaper (the screen shows mini bars) |
| ssh / mosh | Talking on a rotary phone, cord bouncing |
| python / node REPL | Shaking a cocktail |
| build (make / cargo / npm build) | Cranking a hand crank at 2 Hz, knobs spinning, steam puff at the end |
| git | Carries a box to the shipping dock |
| Long-running unknown | Tapping foot and watching a progress spinner |

### 6.7 Social & ambient behaviours (the fun layer)
- **Chatting pairs:** two idle/done agents within 3 m may meet and face each other. Alternate speech bubbles with *glyph speech* (random pictograms: ☕ ⚙ ✓ ♥ drawn as canvas icons), nodding, and a laugh (squash bounce ×3).
- **High-five:** when an agent goes done and a same-workspace agent is nearby, both jump and slap hands (with a hitstop freeze of 60 ms + a sparkle).
- **Help:** a done/idle agent may walk over to a blocked teammate, pat its back, and stand beside it (moral support). Purely cosmetic.
- **Player interactions:** walking into an agent makes it bump + squash + a giggle bubble. Hovering makes it look at you. Pressing E on it makes it wave + open the inspector. Pressing E on a sleeping agent pokes it awake.
- **Ambient office life:** coffee machine steam, a plant sway, blinds bands of light slowly moving, a roomba (tiny disc bot) that wanders, a clock with real time, and fish in a tank.

### 6.8 Timing reference (at energy 1.0)
| Beat | Duration |
|---|---|
| Anticipation crouch | 0.12 s |
| Hop airtime | 0.35 s |
| Land settle (spring bouncy) | ~0.4 s |
| Emote pop-in (bubble easeOutBack) | 0.25 s |
| Bubble linger | 2.5–4 s |
| Reaction layer max | 2.5 s |
| Confetti life | 1.6 s |
| Tool-change blend | 0.25 s |

---

## 7. Props & world dressing style
- Props are **chunky and slightly oversized** relative to the characters (the mug is a third of their head). They sell the toy feel and read at distance.
- Use at most 3 colours per prop (base + trim + accent). The accent is from palette tokens only.
- Instancing is mandatory for repeated props (desks, chairs, books, plants, monitors, lamps). Give each instance a colour jitter of ±4% lightness.
- Diegetic stats objects (placement is owned by the level doc) follow the style **"physical object + always-legible number"**: an analog gauge with a big 7-seg readout, a water-tank thermometer, a bookshelf fill, a server rack LED matrix. Readouts use the shader dot-matrix glyphs (§3.4) in emissive `butter`/`shell` green. Critical thresholds switch to `blocked` red with a gentle pulse.

---

## 8. Diegetic UI (in-world)

### 8.1 Speech/thought bubbles
- Rounded rect (r = 18% of height) filled with `paper`, a 3 px `ink` outline, and a tail pointing at the head. A **thought** bubble has a cloud edge and trailing circles.
- Text is `ink`, `--font-ui` 600. The first line is the tool (bold), the second is the detail in `--font-mono`, max 28 chars with an ellipsis.
- A status icon sits in a left circular badge coloured by state (drawn vector icon).
- Pop-in with `easeOutBack` scale 0→1 plus a 2° wobble. Pop-out is a 0.15 s shrink.
- They're billboarded sprites in a separate render order, `depthTest true` but with a slight depth offset toward the camera so they don't clip into walls. Size is screen-constant between 4 and 14 m, then shrinks.
- **The blocked "!" bubble** is special: `blocked` red fill, white "!", HDR emissive 2.2 (blooms), and a bounce loop.

### 8.2 Nameplates
- A pill in the workspace colour: agent name (bold, `ink`) + "· tab" in 70% ink. It sits 0.15 m above the accessory.
- Visibility: within 6 m, on hover, when the agent is focused/selected, and always for blocked agents. It fades by distance (α curve 6→9 m).

### 8.3 Screens & holograms
- **Desk monitors:** real text (last N lines from herdr `pane read`) on an `emissiveScreen`. The theme matches xterm (§9.3). Content updates are ≤ 2 Hz and only for monitors within 10 m. Far monitors use a shared status-coloured "code lines" procedural shader (no canvas).
- **Holograms** (Bash hologram, selected-agent info card, zone labels) use additive `working`-blue or `butter` with scanlines, a fresnel edge, flicker on spawn, and a slow vertical scroll. Use them sparingly, since they're the only "sci-fi" element and must feel like a gadget, not the world style.

### 8.4 Declutter
- Priority: blocked > selected > hovered > nearest working > others.
- At most 8 full bubbles on screen. Lower priority collapses to an icon dot.
- Screen-space AABB collision: a lower-priority label nudges up to 24 px, else it hides.
- Nothing may clip the viewport edge. Off-screen blocked agents get edge chevrons (clay-framed, red dot, name, wait time) in the 2D HUD.

---

## 9. 2D UI (roster, menus, terminal drawer, HUD)

> **Superseded for visuals by [`ui-kit.md`](ui-kit.md) ("Workshop Signage", the normative kit).** §9.1 and §9.2 below are the original
> intent, kept for history. The kit replaces the ink-glass panels, blur, status chips, workspace chips and pill strip with:
> - board (walnut rim) for scanning, and paper for deciding;
> - lamps for status, with the porthole rim carrying the workspace colour;
> - a tally board on the HUD.
>
> It also lifts `t3` to `#9A9186` and puts ink text on clay buttons, for contrast. **§9.3 (xterm theme) still holds unchanged.**

### 9.1 Visual language
It's the same world, rendered flat: **ink cards on the dark side, paper cards for light moments, clay accent.**
- **Panels:** `ink` at 94% + `backdrop-filter: blur(10px)` (cheap enough, and disabled on Low). A 1 px border `#3A3733`, radius 14 px, and an inner top highlight `rgba(255,255,255,0.04)`. Shadow `0 8px 24px rgba(0,0,0,.35)`.
- **Text:** cream `#F4EDE3` primary, `#B7AEA2` secondary, `#8A8278` tertiary.
- **Accent:** `clay` for primary buttons, focus rings (2 px `clayLight`), and the selected row indicator (a 3 px left bar).
- **Status chips:** a dot + label, background = status colour at 16% α, text = status colour lightened 20%.
- **Workspace chips:** the colour swatch uses the **same accessory mini-icon** as in 3D (beanie, headphones, …), drawn as inline SVG paths in code.
- **Portraits:** each roster row has a **live 64 px portrait** of the agent. A second camera renders characters into a shared RenderTarget atlas at 2 Hz (round-robin, 4 per frame max). That gives the same face and accessory with an animated expression. This is the key thing that ties UI to world.
- **Motion:** 160–220 ms `cubic-bezier(.2,.9,.3,1.2)` (slight overshoot) for drawers/cards. List reorders animate with FLIP. Nothing bounces more than 4 px.
- **Iconography:** 1.75 px stroke, round caps, 20 px grid, drawn in code (inline SVG strings). No icon fonts, no emoji dependence (emoji glyph availability varies on the client).
- **Density:** comfortable (row 56 px with portrait). The terminal drawer takes precedence over everything.

### 9.2 Layout principles
- **Roster (Tab):** a left overlay 360 px wide. Group-by switch: state | workspace | tab | cwd | kind. Group headers are sticky, with a count and a colour/icon. Each row shows portrait, name, workspace chip, state chip + time in state, tool line (mono), context meter, and actions (open terminal ⏎, walk-to, follow).
- **Terminal drawer:** a right side sheet, 50% width (resizable 35–80%), or fullscreen (F11 inside). Tabs across the top show the agent portrait + name + status dot. The header has breadcrumbs (workspace › tab › pane), cwd, and quick actions. Opening it triggers a subtle in-world camera focus on that agent (DOF on Med+) when the agent is visible.
- **HUD:** a minimal crosshair (a 6 px cream dot with an ink ring, which expands to a ring + "E" key hint on interactables). Top centre is an office status strip (`● 3 working ● 1 blocked ● 2 done`) as pills. Bottom-right is a minimap in paper style (cream map, ink lines, coloured agent dots).
- **Command palette (Ctrl-K):** a paper card (light) in the centre. It's the one light-surface UI moment, to feel like a note card.

### 9.3 xterm theme (matches in-world monitors)
```
background #1A1917  foreground #ECE6DC  cursor #D97757  cursorAccent #1A1917  selectionBackground #D9775755
black #2A2825  red #E5695B  green #7FC98F  yellow #E8C06A  blue #6FA8DC  magenta #C58FD0  cyan #6FC2BE  white #D9D2C7
brightBlack #6B6760  brightRed #F08A7D  brightGreen #9FDDAC  brightYellow #F2D48E  brightBlue #93C0E8  brightMagenta #D8AEE0  brightCyan #95D6D2  brightWhite #FBF8F3
fontFamily var(--font-mono), fontSize 13, lineHeight 1.15
```

---

## 10. Performance rules for art (780M)

| Budget | Target |
|---|---|
| Draw calls | ≤ 250 (Medium) at 30 agents |
| Triangles | ≤ 400k visible |
| Shader programs | ≤ 12 |
| Textures | Canvas atlases ≤ 4 × 2048²; no per-object big canvases beyond 24 bubble canvases + ≤ 16 near monitors |
| Per-frame JS anim | ≤ 3 ms for 40 agents |

- **Static environment:** merge per zone per material (`mergeGeometries`) and use frustum culling per zone group. Bake vertex AO/gradient into vertex colours at build (a cheap "under-desk / wall corner" darkening pass). That's the Low-tier AO, and it also helps Medium.
- **Characters:** ~~start with plain meshes … `BatchedMesh`~~ → DESIGN §6.2: instanced parts via `charBatch` from M1. ~~With more than 20 agents, switch to a `THREE.BatchedMesh` per material (body parts as instances with per-instance matrices written from the rig each frame). The rig stays a pure-math Object3D tree (no scene-graph render). Design the rig API so this swap is internal.~~
- **LOD:**
  - Beyond 14 m: drop glints/lids/brows/hull on the face; the eyes become slots only.
  - Beyond 25 m: the animation update runs at 15 Hz (interpolated) and there are no springs on accessories.
  - Beyond 40 m, or not in frustum: update locomotion only.
- **Particles:** one pooled instanced system (1024 max) for confetti, Zzz, sparks, dust, and steam.
- **Transparency:** as little as possible. ~~Ghosting uses a dithered alpha (`alphaHash`)~~ (banned → DESIGN §5.1), and glass is a single non-sorted layer.
- **Throttling:** stop the post stack and drop to 15 fps when the window is hidden or the terminal drawer is fullscreen.

---

## 11. Art review checklist (for reviewers, with screenshot poses)
Take the shots headless with playwright + `--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist`, 1600×900, Medium tier.
1. **Hero close-up** (1.5 m from a working Clawd, eye level): bevels visible, eyes + glints read, toon bands with violet-ish (not black) shadow, clay sheen, outline present, blob + real shadow grounded.
2. **Silhouette test:** the same frame with all materials forced to ink: Clawd vs Shelly distinguishable, pose readable (typing / waving / jumping / sleeping).
3. **Room wide** (atrium or main floor from the entrance): low-chroma environment, agents pop; no checkerboards; at most 3 accent colours per zone; label count ≤ 8 and none overlapping.
4. **Blocked visibility:** from the farthest point in the office, a blocked agent is found within 2 s (beacon/bubble/edge chevron).
5. **Group identity:** 3 workspaces × 3 agents. Teams are identifiable by accessory type + colour from 8 m.
6. **Golden hour + night:** grading shifts, lamps bloom, screens glow, and there's no blown-out white.
7. **Motion review** (short capture or frame strip): anticipation before hops, squash on landing, spring overshoot on turns, accessories trail, no two agents in sync.
8. **UI:** the roster portrait matches the 3D agent; the xterm theme matches monitors; fonts come from system stacks (no network font requests in devtools).
9. **Perf:** the F3 overlay shows ≥ 55 fps average at Medium with 30 agents on the 780M; no tier auto-downgrade in a 60 s walk.
10. **Greyscale (DESIGN §5.5):** luminance-only `spawn` and `street`: the top-contrast blobs are characters, hulls, status emissives and stats readouts, never architecture.
11. **Framing (DESIGN §6.1):** a standing Clawd at 4 m fills ≥ 18% of frame height at 1600×900, eye 1.2 m, FOV 60° vertical.
12. **Radiometry (DESIGN §5.0):** `clayCheck` ΔE00 < 6 on the lit band; `lumaStats` p99 ≤ 0.85 with emissives off; workspace/status ΔE matrix passes.
13. **Hero sheet (DESIGN §6.1.1):** signed off before any other character work.
14. **Prop kit + hero zones (DESIGN §7.5, M1.75):** `?sheet=props` passes (bevels, 3-colour rule, hero detail, silhouette); Atrium+Pit and E2 signed off at hours 13/18/22 before any other zone is dressed.
15. **Warm-on-warm (DESIGN §5.5):** hue-gap check passes at `pitOverview`, `lobbyDesk`, `eBayGlass`, `cafe`, `street`; codex `clayCheck` row passes day and night.
16. **Edges (DESIGN §5.1):** no environment lines on flat floor at `street` / `pitOverview` (`edgeCheck`), no swim when walking.
