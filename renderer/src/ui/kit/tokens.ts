// @pure
/**
 * UI kit tokens (docs/design/ui-kit.md §2): colours from shared/palette.ts emitted as CSS custom properties, the type
 * stacks, the radius / space / depth scales and the three runtime noise textures. Pure (no DOM): `tokenCss()` returns
 * the `:root` block that kit/styles.ts injects. Owner: UI (kit).
 */
import { CORE, ENV, STATUS, UI } from '../../../../shared/palette.ts';

/** camelCase → kebab-case. */
export const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const FONT = Object.freeze({
  sign: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", Ubuntu, Cantarell, "DejaVu Sans", system-ui, sans-serif',
  ui: 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "DejaVu Sans", sans-serif',
  voice: '"Iowan Old Style", Charter, "Bitstream Charter", "Source Serif Pro", Georgia, "DejaVu Serif", serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", "Ubuntu Mono", Menlo, Consolas, monospace',
});

/** §2.1: the only font sizes (px). */
export const TYPE_SCALE = Object.freeze([11, 12, 13, 14, 15, 16.5, 21]);

/**
 * §2.2 radius scale. `RADIUS_PX` is every px value a `border-radius` in ui/** may use (the lint test enforces it);
 * the named tokens are what new CSS should reference. Never 999 px.
 */
export const RADIUS = Object.freeze({ hair: 2, paper: 4, key: 4, readout: 4, plaque: 5, btn: 6, tab: 6, frame: 9, board: 12, drawer: 14, rim: 15 });
export const RADIUS_PX = Object.freeze([0, 1, 2, 3, 4, 5, 6, 8, 9, 12, 14, 15]);

/** §2.2 space scale (4-pt base). */
export const SPACE = Object.freeze([4, 6, 8, 10, 12, 14, 16, 18, 22]);

/** §2.3 motion. */
export const EASE = 'cubic-bezier(.2,.9,.3,1.2)';

// ---- textures: three SVG feTurbulence tiles, built at runtime (no asset files); `.hq-lowq` drops them -------------
const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const noise = (w: number, h: number, freq: string, oct: number, seed: number, m: string) => svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='${oct}' seed='${seed}'/><feColorMatrix values='${m}'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`);
export const TEXTURE = Object.freeze({
  /** painted-board grain: long horizontal brush streaks */
  grain: noise(320, 320, '.012 .55', 3, 4, '0 0 0 0 1  0 0 0 0 .9  0 0 0 0 .75  0 0 0 .055 0'),
  /** paper fibre */
  fibre: noise(220, 220, '.75', 2, 9, '0 0 0 0 .45  0 0 0 0 .38  0 0 0 0 .28  0 0 0 .07 0'),
  /** walnut woodgrain for rims and frames */
  woodgrain: noise(400, 60, '.006 .28', 3, 2, '0 0 0 0 .2  0 0 0 0 .1  0 0 0 0 .04  0 0 0 .35 0'),
});

/** The hand-drawn clay-ink ellipse under a circled choice (§3 Circled choice). */
export const CIRCLE_INK = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 40' preserveAspectRatio='none'><path d='M8 22 C6 8 40 3 64 4 C88 5 97 12 95 21 C93 32 62 37 40 36 C16 35 3 29 7 18 C9 12 20 7 30 6' fill='none' stroke='${CORE.clayDeep}' stroke-width='2.2' stroke-linecap='round' vector-effect='non-scaling-stroke'/></svg>`);

/** Tick glyph masks (§3 Tick; coloured by the CSS, so the stroke colour is irrelevant): a hand-drawn box outline and a
 *  pen tick that overshoots it. */
export const TICK_BOX = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2.4 3.1C6 2.3 10.2 2.6 13.5 2.5C13.8 6.2 13.4 9.9 13.6 13.4C9.9 13.9 6.1 13.4 2.6 13.6C2.2 10 2.7 6.3 2.2 2.6' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>`);
export const TICK_MARK = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path d='M3 10.6C4.6 11.5 6.2 13.3 7.4 16C9.6 10.4 13.2 5.6 17.8 2.4' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/></svg>`);

/** Every CSS custom property the kit defines, as [name, value] pairs. */
export function tokenEntries() {
  const out: [string, string][] = [];
  const add = (k: string, v: unknown) => out.push([`--${k}`, String(v)]);
  for (const [k, v] of Object.entries(CORE)) add(kebab(k), v);
  add('walnut', ENV.walnut); add('teal', ENV.teal); add('butter', ENV.butter); add('sage', ENV.sage); add('lavender', ENV.lavender);
  for (const [k, v] of Object.entries(STATUS)) add(`s-${k === 'shellBusy' ? 'busy' : kebab(k)}`, v);
  for (const [k, v] of Object.entries(UI)) {
    if (typeof v === 'string') add(kebab(k), v);
  }
  for (const [k, v] of Object.entries(UI.onBoard)) add(`b-${k}`, v);
  for (const [k, v] of Object.entries(UI.onPaper)) add(`i-${k}`, v);
  for (const [k, v] of Object.entries(UI.fit)) add(`f-${kebab(k)}`, v);
  for (const [k, v] of Object.entries(FONT)) add(`font-${k}`, v);
  for (const [k, v] of Object.entries(RADIUS)) add(`r-${k}`, `${v}px`);
  add('r-round', '50%');
  add('ease', EASE);
  add('d1-board', `0 2px 0 ${UI.fit.rimDark}`);
  add('d2', '0 4px 10px rgba(28,16,8,.35), 0 18px 40px -8px rgba(28,16,8,.55)');
  add('recess', 'inset 0 2px 4px rgba(0,0,0,.65), 0 1px 0 rgba(255,236,210,.06)');
  add('grain', TEXTURE.grain); add('fibre', TEXTURE.fibre); add('woodgrain', TEXTURE.woodgrain);
  add('circle-ink', CIRCLE_INK);
  add('m-tick-box', TICK_BOX); add('m-tick-mark', TICK_MARK);
  return out;
}

/** The `:root` token block (+ the Low-tier override that drops the textures). */
export function tokenCss() {
  return `:root{${tokenEntries().map(([k, v]) => `${k}:${v}`).join(';')}}\n.hq-lowq{--grain:none;--fibre:none;--woodgrain:none}\n`;
}
