# M0.5 seam stubs (DESIGN §11 M0.5)

Each file here is a stub implementation of a cross-WP seam at its **final signature + JSDoc**. The final module path
(e.g. `src/render/materials/index.js`) is a one-line re-export shim with a `STUB` header, so every consumer already
imports the final path and nothing changes when the owner lands the real code.

**Owner replacing a stub:** overwrite the shim at the final path with your implementation (same exports), delete the
stub file here, and list it under "stubs deleted" in your WP summary.

State after M3: every seam is real; no stubs remain. (STAT replaced `world/stats/registry.js` and deleted
`world/statsRegistry.js` in M3 — cross-owner note by STAT.)

`world/build/index.js` (ENV) is no longer a stub: until ENV's prop kit lands (M1.75) it re-exports LVL's
`build/greybox.js` as `buildWorld`.
