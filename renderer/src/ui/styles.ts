/**
 * UI stylesheet (ART §9 visual language): ink cards on the dark side, paper cards for light moments, clay accent.
 * Colours come from shared/palette.ts tokens; injected once as a <style>. Owner: UI.
 */
import { CORE, STATUS, UI } from '../../../shared/palette.ts';
import { injectKit } from './kit/index.ts';

export const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", "Ubuntu Mono", Menlo, Consolas, monospace';
/** xterm font: MONO, then system symbol fonts for Claude's UI glyphs (⎿ ⏺ ✻ …). They sit after the generic
 *  `monospace` so they never become the primary (metrics) font; Chromium still walks them for per-glyph fallback. */
export const TERM_FONT = `${MONO}, "Noto Sans Symbols 2", "Noto Sans Symbols", "Noto Sans Math", "Apple Symbols", "Segoe UI Symbol", "Cambria Math", Symbola, "DejaVu Sans", "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Twemoji Mozilla", "Noto Emoji", "EmojiOne Color"`;
// [UI fix r3, playtest "'Hi! 👋' draws as 'Hi! □'"] the system colour-emoji fonts close the stack (system fonts only, no
// bundled asset); glyphs.ts swaps a pictograph that none of them covers for a 2-cell stand-in instead of a tofu box
export const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, sans-serif';

const css = `
.hq-ui{--ink:${CORE.ink};--ink2:${CORE.ink2};--cream:${CORE.cream};--paper:${CORE.paper};--oat:${CORE.oat};--clay:${CORE.clay};
  --clayLight:${CORE.clayLight};--clayDeep:${CORE.clayDeep};--t1:${UI.t1};--t2:${UI.t2};--t3:${UI.t3};--line:${CORE.ink2};
  --blocked:${STATUS.blocked};--working:${STATUS.working};--done:${STATUS.done};--idle:${STATUS.idle};--unknown:${STATUS.unknown};--shell:${STATUS.shell};
  --ease:cubic-bezier(.2,.9,.3,1.2);--mono:${MONO};--sans:${SANS};
  --roster-w:360px;--drawer-w:0px;font:13px/1.4 var(--sans);color:var(--t1);position:fixed;inset:0;pointer-events:none;z-index:10}
.hq-ui *{box-sizing:border-box}
.hq-ui [hidden]{display:none !important}
:where(.hq-ui) button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
:where(.hq-ui) :focus{outline:none}
.hq-ui :focus-visible{outline:2px solid var(--clayLight);outline-offset:2px;border-radius:6px}
/* The generic hq-panel / hq-kbd / hq-btn / hq-ibtn / hq-chip / hq-dot / hq-ws classes are gone: every surface uses the
   UI kit (ui/kit/, k-* classes; docs/design/ui-kit.md §7). kit.test.ts keeps them from coming back. */
/* ---- HUD: moved to ui/hudCss.ts (UI kit migration; hud.ts, hotbar, minimap, chevrons, overlays) ---- */
.hq-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ---- roster: moved to ui/roster/styles.ts (UI kit migration) ---- */

/* ---- drawer: moved to ui/terminal/styles.ts (kit migration) ---- */
@keyframes hq-spin{to{transform:rotate(360deg)}}

/* ---- dialogs (palette, T bar, hire, settings, help, tour): moved to ui/dialogCss.ts (kit migration) ---- */


/* ================= M2 ================= */
.hq-ui{--world-l:0px;--world-r:0px}


@media (prefers-reduced-motion: reduce){.hq-ui *{animation-duration:.001s !important;transition-duration:.001s !important}}
.hq-reduced *{animation-duration:.001s !important;transition-duration:.001s !important}
`;

/**
 * Inject the stylesheet once, after the UI kit (tokens + k-* components + lamp sprite; ui/kit/index.ts).
 * `kit` is passed to injectKit (keycap platform, Low-tier texture drop).
 */
export function injectStyles(kit: Parameters<typeof injectKit>[0] = {}) {
  injectKit(kit);
  if (document.getElementById('hq-ui-css')) return;
  const s = document.createElement('style');
  s.id = 'hq-ui-css';
  s.textContent = css;
  document.head.appendChild(s);
}
