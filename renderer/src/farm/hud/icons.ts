/**
 * Hand-written inline SVG icons (no image files, no emoji fonts). Every icon is a 24×24 viewBox string; `icon()`
 * wraps it for the DOM, `iconImage()` rasterises it for the map canvas.
 */
import type { LetterKind, PlotKind, WeatherKind } from '../model/types.ts';

const INK = '#3b2a1e';
const S = (body: string, vb = '0 0 24 24') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const ol = `stroke="${INK}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"`;

export const ICONS = {
  // ---- UI ----
  mail: S(`<rect x="2.5" y="5.5" width="19" height="13" rx="2" fill="#fff6e0" ${ol}/><path d="M3 7l9 6.5L21 7" fill="none" ${ol}/><circle cx="12" cy="13" r="2" fill="#d9534f" stroke="${INK}" stroke-width="1"/>`),
  map: S(`<path d="M3 6l6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z" fill="#f3dfae" ${ol}/><path d="M9 3.5v14.5M15 6v14.5" fill="none" stroke="${INK}" stroke-width="1" opacity=".5"/><path d="M5 14c2-1 3 1 5-1s3-3 5-2 3 0 4-2" fill="none" stroke="#3f95d8" stroke-width="1.4"/><circle cx="16.5" cy="9" r="1.6" fill="#d9534f"/>`),
  book: S(`<path d="M4 4.5h6.5a2 2 0 012 2V20a2 2 0 00-2-2H4z" fill="#c9573f" ${ol}/><path d="M20 4.5h-6.5a1 1 0 00-1 1V20a2 2 0 012-2H20z" fill="#e0764f" ${ol}/><path d="M6.5 8h3.5M6.5 11h3.5M15 8h3M15 11h3" stroke="#fff3d6" stroke-width="1.2" stroke-linecap="round"/>`),
  terminal: S(`<rect x="2.5" y="4" width="19" height="16" rx="2.5" fill="#2a2320" ${ol}/><path d="M6.5 9l3 3-3 3" fill="none" stroke="#9be07a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 15.5h5" stroke="#f3dfae" stroke-width="1.8" stroke-linecap="round"/>`),
  walk: S(`<path d="M8 3.5h5l.5 8 5 2.5c1.5.8 1.8 2.5 1 4.5H6.5z" fill="#a8683c" ${ol}/><path d="M6.5 18.5h13.5v2H6.5z" fill="#6e4a2a" ${ol}/><path d="M9 7.5h3.5" stroke="#f3dfae" stroke-width="1.2"/>`),
  close: S(`<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`),
  check: S(`<path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  gear: S(`<path d="M12 2.8l1.6 2.3 2.7-.7.7 2.7 2.6 1-.9 2.6 1.6 2.3-2.3 1.6.1 2.8-2.8.1-1.4 2.4-2.4-1.3-2.4 1.3-1.4-2.4-2.8-.1.1-2.8L3.3 14l1.6-2.3-.9-2.6 2.6-1 .7-2.7 2.7.7z" fill="#c8955a" ${ol}/><circle cx="12" cy="12" r="3.2" fill="#f3dfae" ${ol}/>`),
  keyboard: S(`<rect x="2" y="6" width="20" height="12" rx="2" fill="#f3dfae" ${ol}/><path d="M5.5 9.5h1M9 9.5h1M12.5 9.5h1M16 9.5h2.5M5.5 12.5h1M9 12.5h1M12.5 12.5h1M16 12.5h2.5M7.5 15.5h9" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`),
  bell: S(`<path d="M12 3.5c3.6 0 5.8 2.6 5.8 6.3v3.4l2 3H4.2l2-3V9.8c0-3.7 2.2-6.3 5.8-6.3z" fill="#f2b134" ${ol}/><circle cx="12" cy="18.8" r="2" fill="#c8955a" ${ol}/>`),
  bang: S(`<circle cx="12" cy="12" r="10" fill="#f6c23e" ${ol}/><path d="M12 6.5v7" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.6" fill="${INK}"/>`),
  board: S(`<rect x="3" y="4" width="18" height="13" rx="1.5" fill="#c8955a" ${ol}/><rect x="5.5" y="6" width="6" height="5" fill="#fff6e0" transform="rotate(-4 8.5 8.5)"/><rect x="12.5" y="7" width="6" height="6" fill="#f7e07a" transform="rotate(5 15.5 10)"/><path d="M7 17v4M17 17v4" stroke="${INK}" stroke-width="1.6"/>`),
  stats: S(`<path d="M10.5 21l1-9h1l1 9z" fill="#c8955a" ${ol}/><g fill="#fff6e0" ${ol}><path d="M12 11.5L7 3.5l2.2-.8z"/><path d="M12 11.5l8.5 3-.3 2.3z"/><path d="M12 11.5l-8.2 4.6-.9-2.1z"/></g><circle cx="12" cy="11.5" r="1.8" fill="#d0584a" ${ol}/>`),
  duck: S(`<path d="M5 13c0-2 1.5-3 3.5-3 .5-2.5 2-4 4.2-4 2.3 0 3.8 1.6 3.8 3.6 0 .9-.3 1.6-.8 2.2 2.3.2 4.3 1.8 4.3 4.2 0 2.6-2.8 4-7.5 4-4.8 0-7.5-2.3-7.5-7z" fill="#ffd84d" ${ol}/><path d="M16.3 8.6l3 .9-3 .9z" fill="#f08a2c" ${ol}/><circle cx="14" cy="8.3" r=".9" fill="${INK}"/>`),
  lantern: S(`<path d="M9 5h6l1 2v10l-1 2H9l-1-2V7z" fill="#f6c23e" ${ol}/><path d="M10 3h4v2h-4z" fill="#6e4a2a" ${ol}/><path d="M12 9.5c1.2 1.2 1.2 3.3 0 4.5-1.2-1.2-1.2-3.3 0-4.5z" fill="#fff3a0"/>`),
  scarecrow: S(`<path d="M12 21V9M4 11.5h16" stroke="#8a5a32" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7" r="3" fill="#f3dfae" ${ol}/><path d="M7 5.5h10l-2-3H9z" fill="#c8955a" ${ol}/><path d="M8.5 11h7l-1 6h-5z" fill="#6aa84f" ${ol}/>`),
  play: S(`<path d="M8 5l11 7-11 7z" fill="currentColor"/>`),
  pin: S(`<circle cx="12" cy="9" r="5" fill="#d9534f" ${ol}/><path d="M12 14v7" stroke="${INK}" stroke-width="1.6"/>`),
  compass: S(`<circle cx="12" cy="12" r="9.5" fill="#f3dfae" ${ol}/><path d="M12 4.5l2.5 7.5h-5z" fill="#d9534f" ${ol}/><path d="M12 19.5l-2.5-7.5h5z" fill="#fff6e0" ${ol}/>`),
  send: S(`<path d="M3.5 11.5l17-7.5-5.5 16-3.5-6.5z" fill="#fff6e0" ${ol}/><path d="M11.5 13.5L20.5 4" stroke="${INK}" stroke-width="1.4"/>`),
  eye: S(`<path d="M2.5 12c2.5-4.5 5.8-6.5 9.5-6.5s7 2 9.5 6.5c-2.5 4.5-5.8 6.5-9.5 6.5S5 16.5 2.5 12z" fill="#fff6e0" ${ol}/><circle cx="12" cy="12" r="3.3" fill="#3f95d8" ${ol}/><circle cx="12" cy="12" r="1.3" fill="${INK}"/>`),
  hand: S(`<path d="M7 12V6.5a1.4 1.4 0 012.8 0V11V4.8a1.4 1.4 0 012.8 0V11V5.6a1.4 1.4 0 012.8 0V12V8a1.4 1.4 0 012.8 0v6.5c0 4-2.6 6.5-6.5 6.5-2.6 0-4.4-1.2-5.8-3.4L4 13.4a1.4 1.4 0 012.3-1.6z" fill="#f6d2a8" ${ol}/>`),
  rosette: S(`<path d="M8 14.5l-3 7 3.2-1 1.8 2.6 2-6.5zM16 14.5l3 7-3.2-1-1.8 2.6-2-6.5z" fill="#d9534f" ${ol}/><path d="M12 1.8l1.9 1.5 2.4-.4.9 2.3 2.3.9-.4 2.4 1.5 1.9-1.5 1.9.4 2.4-2.3.9-.9 2.3-2.4-.4L12 17.4l-1.9-1.5-2.4.4-.9-2.3-2.3-.9.4-2.4-1.5-1.9 1.5-1.9-.4-2.4 2.3-.9.9-2.3 2.4.4z" fill="#f6c23e" ${ol}/><circle cx="12" cy="9.6" r="4" fill="#fff3c4" ${ol}/><path d="M12 7.3l.75 1.55 1.7.2-1.25 1.15.35 1.7L12 11.05l-1.55.85.35-1.7-1.25-1.15 1.7-.2z" fill="#e89a1c"/>`),
  sprout: S(`<path d="M12 21v-9" stroke="#4e8a36" stroke-width="2" stroke-linecap="round"/><path d="M12 13c-4.5 0-7-2.5-7-6.5 4.5 0 7 2.5 7 6.5zM12 11c0-4 2.5-6.5 7-6.5 0 4-2.5 6.5-7 6.5z" fill="#7cc25a" ${ol}/>`),
} as const;
export type IconName = keyof typeof ICONS;

export const WEATHER_ICON: Record<WeatherKind | 'night', string> = {
  clear: S(`<g stroke="#e89a1c" stroke-width="2" stroke-linecap="round"><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8"/></g><circle cx="12" cy="12" r="5" fill="#ffd23f" ${ol}/>`),
  night: S(`<path d="M15.5 3.5a8.5 8.5 0 108 11.5A7 7 0 0115.5 3.5z" fill="#f6e7a8" ${ol}/><circle cx="6" cy="6" r=".9" fill="#fff6c8"/><circle cx="9" cy="3" r=".6" fill="#fff6c8"/>`),
  cloudy: S(`<circle cx="15.5" cy="8.5" r="3.6" fill="#ffd23f" ${ol}/><path d="M6.5 19h11a3.5 3.5 0 00.4-7 5 5 0 00-9.6-.9A3.9 3.9 0 006.5 19z" fill="#fbfbf5" ${ol}/>`),
  rain: S(`<path d="M6.5 14h11a3.5 3.5 0 00.4-7 5 5 0 00-9.6-.9A3.9 3.9 0 006.5 14z" fill="#e3e8ee" ${ol}/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" stroke="#3f95d8" stroke-width="2" stroke-linecap="round"/>`),
  storm: S(`<path d="M6.5 13.5h11a3.5 3.5 0 00.4-7 5 5 0 00-9.6-.9A3.9 3.9 0 006.5 13.5z" fill="#a9b0bc" ${ol}/><path d="M12.5 12.5l-3 5h3l-2 4.5 5-6h-3l2-3.5z" fill="#ffd23f" ${ol}/>`),
  fog: S(`<path d="M6.5 11h11a3.5 3.5 0 00.4-7 5 5 0 00-9.6-.9A3.9 3.9 0 006.5 11z" fill="#eceae4" ${ol}/><path d="M3.5 14.5h17M5.5 17.5h13M7.5 20.5h9" stroke="#9aa1a8" stroke-width="2" stroke-linecap="round"/>`),
  snow: S(`<path d="M6.5 13h11a3.5 3.5 0 00.4-7 5 5 0 00-9.6-.9A3.9 3.9 0 006.5 13z" fill="#fbfdff" ${ol}/><g fill="#7fb8e6"><circle cx="8" cy="17" r="1.3"/><circle cx="12.5" cy="19.5" r="1.3"/><circle cx="16.5" cy="16.5" r="1.3"/><circle cx="10" cy="21.5" r=".9"/></g>`),
};

export const SEASON_ICON: Record<'spring' | 'summer' | 'autumn' | 'winter', string> = {
  spring: S(`<g fill="#f7a8c4" ${ol}><circle cx="12" cy="6.5" r="3.3"/><circle cx="17.3" cy="10.5" r="3.3"/><circle cx="15.3" cy="16.8" r="3.3"/><circle cx="8.7" cy="16.8" r="3.3"/><circle cx="6.7" cy="10.5" r="3.3"/></g><circle cx="12" cy="12" r="2.4" fill="#ffd23f" ${ol}/>`),
  summer: S(`<circle cx="12" cy="12" r="5.5" fill="#ffd23f" ${ol}/><g stroke="#e89a1c" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/></g>`),
  autumn: S(`<path d="M12 21v-5M12 3c1.5 2 3.5 2.5 5.5 2-.5 2 .5 3.5 2.5 4.5-2 1-2.5 2.5-2 4.5-2-.5-3.5.5-4 2.5l-2-.5-2 .5c-.5-2-2-3-4-2.5.5-2 0-3.5-2-4.5 2-1 3-2.5 2.5-4.5 2 .5 4 0 5.5-2z" fill="#e8742c" ${ol}/><path d="M12 7v9" stroke="#9c3f1c" stroke-width="1.2"/>`),
  winter: S(`<g stroke="#5aa3d8" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4l2.5 2.5L14.5 4M9.5 20l2.5-2.5 2.5 2.5"/></g>`),
};

export const KIND_ICON: Record<PlotKind, string> = {
  wheat: S(`<path d="M12 22V7" stroke="#b58a2a" stroke-width="1.6"/><g fill="#f0c64a" ${ol}><ellipse cx="9.6" cy="8" rx="1.6" ry="2.6" transform="rotate(-25 9.6 8)"/><ellipse cx="14.4" cy="8" rx="1.6" ry="2.6" transform="rotate(25 14.4 8)"/><ellipse cx="9.6" cy="12.5" rx="1.6" ry="2.6" transform="rotate(-25 9.6 12.5)"/><ellipse cx="14.4" cy="12.5" rx="1.6" ry="2.6" transform="rotate(25 14.4 12.5)"/><ellipse cx="12" cy="4.2" rx="1.5" ry="2.4"/></g>`),
  pumpkins: S(`<path d="M12 7c0-2 1-3 2.5-3.5" stroke="#4e8a36" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="12" cy="14" rx="9" ry="7" fill="#f08a2c" ${ol}/><path d="M12 7.2c-2.2 1.6-2.2 11.8 0 13.6M12 7.2c2.2 1.6 2.2 11.8 0 13.6" fill="none" stroke="${INK}" stroke-width="1.1"/>`),
  cabbages: S(`<circle cx="12" cy="13" r="8.5" fill="#8fce6a" ${ol}/><path d="M12 5c-3 3-3 11 0 16M12 5c3 3 3 11 0 16M4 12c3 1.5 13 1.5 16 0" fill="none" stroke="#4e8a36" stroke-width="1.2"/>`),
  sunflowers: S(`<g fill="#ffcf2e" ${ol}><ellipse cx="12" cy="4.5" rx="2" ry="3"/><ellipse cx="12" cy="19.5" rx="2" ry="3"/><ellipse cx="4.5" cy="12" rx="3" ry="2"/><ellipse cx="19.5" cy="12" rx="3" ry="2"/><ellipse cx="6.7" cy="6.7" rx="2" ry="3" transform="rotate(-45 6.7 6.7)"/><ellipse cx="17.3" cy="17.3" rx="2" ry="3" transform="rotate(-45 17.3 17.3)"/><ellipse cx="17.3" cy="6.7" rx="2" ry="3" transform="rotate(45 17.3 6.7)"/><ellipse cx="6.7" cy="17.3" rx="2" ry="3" transform="rotate(45 6.7 17.3)"/></g><circle cx="12" cy="12" r="4" fill="#7a4a22" ${ol}/>`),
  orchard: S(`<path d="M12 7.5c0-2 .8-3.5 2.2-4.3" stroke="#6e4a2a" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M13 6c1.5-2 4-2 5-1-1 1.8-3 2.3-5 1z" fill="#6aa84f" ${ol}/><path d="M12 8c-2-1.5-7.5-1.5-7.5 5 0 4.5 3 8.5 5 8.5 1 0 1.6-.5 2.5-.5s1.5.5 2.5.5c2 0 5-4 5-8.5 0-6.5-5.5-6.5-7.5-5z" fill="#e0483c" ${ol}/><ellipse cx="8.5" cy="12" rx="1.2" ry="2" fill="#ff9a8a" opacity=".8"/>`),
  vineyard: S(`<path d="M12 5V2.5M12 4c2-1.5 4-1.5 5.5 0" stroke="#6aa84f" stroke-width="1.6" fill="none" stroke-linecap="round"/><g fill="#8e4fbf" ${ol}><circle cx="8.5" cy="8" r="2.5"/><circle cx="13.5" cy="8" r="2.5"/><circle cx="11" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="13.5" cy="16" r="2.5"/><circle cx="8.8" cy="16" r="2.5"/><circle cx="11.2" cy="20" r="2.5"/></g>`),
  berries: S(`<path d="M8 4c3 0 5 1.5 5 4.5-3 .5-5-1.5-5-4.5z" fill="#6aa84f" ${ol}/><g ${ol}><circle cx="8" cy="14" r="4" fill="#d6344f"/><circle cx="15.5" cy="12.5" r="4" fill="#4a5fd1"/><circle cx="13" cy="18.5" r="3.5" fill="#d6344f"/></g><g fill="#fff" opacity=".7"><circle cx="6.8" cy="12.8" r="1"/><circle cx="14.3" cy="11.3" r="1"/></g>`),
  chickens: S(`<path d="M7.5 7.5c0-1.6 1.2-3 3-3 .3-1 1.5-1.5 2.3-.6.8-.6 2 0 1.8 1-.8.2-1.2.6-1.2 1.2z" fill="#e0483c" ${ol}/><path d="M6 11c0-3 2-5 4.8-5 2.6 0 4.2 2 4.2 4.5 2.5-.5 4.5-1.5 5.5-3.5.5 5-1.5 11-8 11C8.3 18 6 15.5 6 11z" fill="#fffdf6" ${ol}/><path d="M6 10.5L3 11.8l3 1z" fill="#f0a02c" ${ol}/><circle cx="9" cy="9.5" r=".9" fill="${INK}"/><path d="M10.5 18v3M13.5 18v3" stroke="#f0a02c" stroke-width="1.6" stroke-linecap="round"/>`),
  cows: S(`<path d="M5.5 7.5L3 5.5M18.5 7.5L21 5.5" stroke="#d8c7a8" stroke-width="2" stroke-linecap="round"/><rect x="5" y="5.5" width="14" height="14" rx="6" fill="#fffdf6" ${ol}/><path d="M6.5 8c1.5-.5 3 .5 3 2s-2 2-3.5 1.2M15 6.2c1.5 1 2.5 2.5 2 4" fill="#3b2a1e"/><rect x="7" y="13" width="10" height="6.5" rx="3.2" fill="#f5b8b0" ${ol}/><circle cx="10" cy="16.2" r=".9" fill="${INK}"/><circle cx="14" cy="16.2" r=".9" fill="${INK}"/><circle cx="9.3" cy="10.5" r=".9" fill="${INK}"/><circle cx="14.7" cy="10.5" r=".9" fill="${INK}"/>`),
  sheep: S(`<g fill="#fbf8ef" ${ol}><circle cx="7" cy="9" r="3.4"/><circle cx="12" cy="7" r="3.4"/><circle cx="17" cy="9" r="3.4"/><circle cx="18" cy="14" r="3.4"/><circle cx="6" cy="14" r="3.4"/><circle cx="12" cy="16" r="3.8"/></g><ellipse cx="12" cy="12" rx="3.3" ry="4" fill="#4a3b33" ${ol}/><circle cx="10.8" cy="11.3" r=".8" fill="#fff"/><circle cx="13.2" cy="11.3" r=".8" fill="#fff"/>`),
  pigs: S(`<path d="M5 7l1.5-3.5L9.5 6M19 7l-1.5-3.5L14.5 6" fill="#f3a5b3" ${ol}/><circle cx="12" cy="12.5" r="8" fill="#f7b6c2" ${ol}/><ellipse cx="12" cy="15" rx="3.6" ry="2.6" fill="#ee8fa1" ${ol}/><circle cx="10.7" cy="15" r=".8" fill="${INK}"/><circle cx="13.3" cy="15" r=".8" fill="${INK}"/><circle cx="9" cy="10.5" r=".9" fill="${INK}"/><circle cx="15" cy="10.5" r=".9" fill="${INK}"/>`),
  bees: S(`<ellipse cx="9" cy="7" rx="3.5" ry="2.5" fill="#dff1ff" ${ol} transform="rotate(-25 9 7)"/><ellipse cx="15" cy="7" rx="3.5" ry="2.5" fill="#dff1ff" ${ol} transform="rotate(25 15 7)"/><ellipse cx="12" cy="14" rx="7.5" ry="5.5" fill="#ffcf2e" ${ol}/><path d="M9.5 9.2v9.6M14.5 9.2v9.6" stroke="${INK}" stroke-width="2.4"/><path d="M19.5 14l2 0" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`),
};

export const LETTER_ICON: Record<LetterKind, string> = {
  'needs-you': ICONS.bang,
  finished: S(`<path d="M3.5 10.5h17l-2 9.5h-13z" fill="#c8955a" ${ol}/><path d="M7 10.5c0-4 2.2-6.5 5-6.5s5 2.5 5 6.5" fill="none" ${ol}/><circle cx="9" cy="9.5" r="2.2" fill="#e0483c" ${ol}/><circle cx="13" cy="9" r="2.2" fill="#f08a2c" ${ol}/><circle cx="15.5" cy="10" r="1.8" fill="#8fce6a" ${ol}/><path d="M7 14.5h10M7.5 17h9" stroke="#8a5a32" stroke-width="1"/>`),
  error: S(`<circle cx="9" cy="13" r="5" fill="#d8d2c8" ${ol}/><circle cx="15" cy="11" r="5.5" fill="#e8e3da" ${ol}/><circle cx="13" cy="16" r="4" fill="#d8d2c8" ${ol}/><path d="M12.5 7.5v5" stroke="#d9534f" stroke-width="2.4" stroke-linecap="round"/><circle cx="12.5" cy="15.2" r="1.3" fill="#d9534f"/>`),
  'test-fail': S(`<path d="M5 8h11l2 3v6a3 3 0 01-3 3H8a3 3 0 01-3-3z" fill="#9aa7b0" ${ol}/><path d="M16 8.5l4-3" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><path d="M8.5 12.5l4 4M12.5 12.5l-4 4" stroke="#d9534f" stroke-width="2.2" stroke-linecap="round"/>`),
  'test-pass': S(`<path d="M12 2.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 8.8l6.1-.7z" fill="#ffd23f" ${ol}/><path d="M8.8 12l2.2 2.2 4.2-4.6" fill="none" stroke="#3a7a26" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  commit: S(`<path d="M3 9l9-4 9 4v9l-9 4-9-4z" fill="#c8955a" ${ol}/><path d="M3 9l9 4 9-4M12 13v9" fill="none" ${ol}/><path d="M7.5 7l9 4" stroke="#8a5a32" stroke-width="1.2"/>`),
  struggle: S(`<circle cx="11" cy="13" r="8" fill="#f6d2a8" ${ol}/><path d="M7.5 12.5h2M12.5 12.5h2M8.5 17c1.5-1 3.5-1 5 0" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/><path d="M19 2.5c1.5 2.2 2.3 3.7 2.3 4.8a2.3 2.3 0 01-4.6 0c0-1.1.8-2.6 2.3-4.8z" fill="#7fc3f0" ${ol}/>`),
  arrived: ICONS.hand,
  left: S(`<path d="M4 11l8-7 8 7v9H4z" fill="#f3dfae" ${ol}/><path d="M2.5 11.5L12 3.5l9.5 8" fill="none" stroke="#c9573f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="10" y="14" width="4" height="6" fill="#8a5a32" ${ol}/>`),
  subagents: ICONS.duck,
  news: S(`<path d="M6 3.5h11a2 2 0 012 2v13a2 2 0 01-2 2H6.5A2.5 2.5 0 014 18V5.5a2 2 0 012-2z" fill="#fff6e0" ${ol}/><path d="M7.5 7.5h8M7.5 10.5h8M7.5 13.5h5" stroke="#8a5a32" stroke-width="1.3" stroke-linecap="round"/>`),
};

/** A span holding an icon (decorative unless `label` given). */
export function icon(svg: string, cls = '', label?: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = `vh-ico${cls ? ` ${cls}` : ''}`;
  s.innerHTML = svg;
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); }
  return s;
}

const imgCache = new Map<string, HTMLImageElement>();
/** The SVG as an <img> for canvas drawing (data URL: no network). May not be decoded yet; check `.complete`. */
export function iconImage(svg: string): HTMLImageElement {
  let img = imgCache.get(svg);
  if (!img) {
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    imgCache.set(svg, img);
  }
  return img;
}

// Portrait copies of the mascot sprite grids and colours (the HUD may not import scene systems). The master design
// lives in scene/farmers/mascots.ts; scene/farmers/pure.test.ts fails if these drift from it.
const CLAWD = { front: ['..##############..', '..##############..', '..##e########e##..', '..##e########e##..', 'aa##############aa', 'aa##############aa', 'aa##############aa', '..##############..', '..##############..', '...ll.ll..ll.ll...', '...ll.ll..ll.ll...', '...ll.ll..ll.ll...'] };
const CODEX = { front: ['.........######.........', '....###..######..###....', '...#####.######.#####...', '...##################...', '...##################...', '....################....', '...##################...', 'aa#######E############aa', 'aa####################aa', 'aa############M#######aa', '...##################...', '....################....', '...##################...', '...##################...', '....################....', '......ffff....ffff......', '......ffff....ffff......'] };
const GLYPHS = { prompt: ['##...', '.##..', '..##.', '.##..', '##...'], cursor: ['###'] };
const KIND_COLORS = {
  claude: { body: 0xd97757, dark: 0xb65d40, glyph: 0x1f1512 },
  gemini: { body: 0x6f72e6, dark: 0x5456c2, glyph: 0x17163a },
  agent: { body: 0x9c9ea6, dark: 0x7c7e86, glyph: 0x1c1d22 },
  codex: { body: 0xf4f1ea, dark: 0x2c2c33, glyph: 0x1b1b20 },
};
const STAR_COLOR = 0xfff0a8;

/**
 * The farmer's portrait: the same voxel mascot as in the world, drawn flat as pixel art from the shared sprite grids
 * (Clawd for claude / gemini / agent, the Codex cloud for codex), wearing its tier hat when `tier` is given.
 * `hue` (the seed hue) picks the hat colour. The HUD crops it to a circle, so everything stays inside r ≈ 11.
 */
export function farmerFace(hue: number, kind: string, tier?: string | null): string {
  const kc = KIND_COLORS[kind as keyof typeof KIND_COLORS] ?? KIND_COLORS.agent;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const body = hex(kc.body), glyphC = hex(kc.glyph);
  const fill: string[] = [], line: string[] = [];
  // each pixel is drawn twice: a slightly larger ink square underneath (the silhouette outline), then the colour
  const px = (x: number, y: number, w: number, h: number, c: string, outline = true) => {
    const f = (v: number) => +v.toFixed(2);
    if (outline) line.push(`<rect x="${f(x - 0.45)}" y="${f(y - 0.45)}" width="${f(w + 0.9)}" height="${f(h + 0.9)}"/>`);
    fill.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${c}"/>`);
  };
  const grid = (rows: readonly string[], x0: number, y0: number, p: number, paint: (ch: string) => string | null, outline = true) =>
    rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) { const col = paint(row[c]); if (col) px(x0 + c * p, y0 + r * p, p, p, col, outline); } });
  let top: number, cx: number, hp: number;
  const face: string[] = [];
  if (kind === 'codex') {
    const p = 0.86, g = CODEX.front, x0 = 12 - (g[0].length * p) / 2, y0 = 7.4;
    grid(g, x0, y0, p, (ch) => (ch === '.' ? null : ch === 'f' ? hex(kc.dark) : body));
    // the >_ face: prompt glyph centred on 'E', cursor on 'M'
    const at = (m: string) => { const r = g.findIndex((row) => row.includes(m)); return [g[r].indexOf(m), r] as const; };
    const [ec, er] = at('E'), [mc, mr] = at('M');
    const put = (rows: readonly string[], c: number, r: number) => { const w = rows[0].length, h = rows.length;
      rows.forEach((row, j) => { for (let i = 0; i < w; i++) if (row[i] === '#') face.push(`<rect x="${+(x0 + (c - (w - 1) / 2 + i) * p).toFixed(2)}" y="${+(y0 + (r - (h - 1) / 2 + j) * p).toFixed(2)}" width="${p}" height="${p}" fill="${glyphC}"/>`); }); };
    put(GLYPHS.prompt, ec, er);
    put(GLYPHS.cursor, mc, mr);
    top = y0 + 2 * p; cx = 12; hp = 0.95;
  } else {
    const p = 1.1, g = CLAWD.front, x0 = 12 - (g[0].length * p) / 2, y0 = 7.0;
    grid(g, x0, y0, p, (ch) => (ch === '.' ? null : ch === 'e' ? glyphC : ch === 'l' ? hex(kc.dark) : body));
    if (kind === 'gemini') {
      const sx = 12 - 0.5 * 0.7, sy = y0 + 5.4 * p;
      for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) face.push(`<rect x="${+(sx + dx * 0.7).toFixed(2)}" y="${+(sy + dy * 0.7).toFixed(2)}" width="0.7" height="0.7" fill="${hex(STAR_COLOR)}"/>`);
    }
    top = y0; cx = 12; hp = 1;
  }
  // tier hat (matches the world: opus straw, sonnet flat cap, haiku bandana, others beanie)
  const hats: string[] = [];
  if (tier !== undefined) {
    const H = (x: number, y: number, w: number, h: number, c: string) => { const q = hp; px(cx + x * q, top + y * q, w * q, h * q, c); };
    const pick = (a: string[]) => a[Math.abs(Math.floor(hue / 13)) % a.length];
    const S2 = (x: number, y: number, w: number, h: number, c: string) => hats.push(`<rect x="${+(cx + x * hp).toFixed(2)}" y="${+(top + y * hp).toFixed(2)}" width="${+(w * hp).toFixed(2)}" height="${+(h * hp).toFixed(2)}" fill="${c}"/>`);
    if (tier === 'opus') {
      H(-8, -1.4, 16, 1.4, '#ecca6e'); H(-4.5, -4.6, 9, 3.4, '#e2bb5c');
      S2(-4.5, -2.4, 9, 1.1, '#c9573f'); S2(-7.6, -1.4, 15.2, 0.5, '#f6dc8e');
    } else if (tier === 'sonnet') {
      const c = pick(['#5a6b4a', '#6e5a48', '#4a5a78', '#8a4a3a']);
      H(-5.5, -3.4, 11, 3.6, c); H(3.5, -1.2, 5.5, 1.3, c);
      S2(-0.5, -4.1, 1, 0.8, c); S2(-5.2, -3.1, 10.4, 0.6, 'rgba(255,255,255,.18)');
    } else if (tier === 'haiku') {
      const c = pick(['#d9453b', '#3f78c8', '#5cae4f']);
      H(-6.5, -1.6, 13, 2.2, c); H(6.3, -0.6, 1.8, 2.2, c); H(7.6, 0.8, 1.4, 1.8, c);
      for (const x of [-4.5, -1, 2.5]) S2(x, -0.9, 0.8, 0.8, '#f4efe3');
    } else {
      const c = pick(['#d9534f', '#5b8fd6', '#7fb069', '#f0a04b', '#9a6ad0']);
      H(-2, -6.4, 4, 2, '#f6f1e6'); H(-5, -4.8, 10, 3.6, c); H(-5.8, -1.4, 11.6, 1.8, c);
      S2(-5.8, -1.4, 11.6, 0.6, 'rgba(255,255,255,.25)');
    }
  }
  return S(`<g shape-rendering="crispEdges"><g fill="${INK}">${line.join('')}</g>${fill.join('')}${face.join('')}${hats.join('')}</g>`, '0 0 24 24');
}
