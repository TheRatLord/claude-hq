// @pure
/**
 * Lamps (docs/design/ui-kit.md §3 Lamp, §4.1): status = a lit glass whose BEZEL SHAPE carries the meaning, plus a word
 * or aria-label. One hidden SVG sprite of `<symbol>`s (injected once by injectKit) and `<use>` per lamp, so ~30 lamps
 * cost 30 tiny nodes. Also the `#inked` rubber-stamp filter. Pure strings here; DOM builders live in kit/index.ts.
 * Owner: UI (kit).
 */
import { CORE, UI } from '../../../../shared/palette.ts';

export type LampState = 'blocked' | 'working' | 'done' | 'idle' | 'unknown' | 'shell' | 'busy' | 'peek' | 'seen';

/** Lamp states → [sprite symbol, word]. `busy` = a shell running a process (amber CRT). */
export const LAMP: Readonly<Record<LampState, readonly [symbol: string, word: string]>> = Object.freeze({
  blocked: ['L-blocked', 'Blocked'],
  working: ['L-working', 'Working'],
  done: ['L-done', 'Done'],
  idle: ['L-idle', 'Idle'],
  unknown: ['L-unknown', 'Unknown'],
  shell: ['L-shell', 'Prompt'],
  busy: ['L-shell', 'Running'],
  // not agent states: the drawer's Peek mode lamp (butter) and onboarding progress (clay = seen)
  peek: ['L-working', 'Peek'],
  seen: ['L-working', 'Seen'],
});

const isLampState = (s: string): s is LampState => Object.hasOwn(LAMP, s);

/** Normalise an entity status / shell activity to a lamp state. */
export function lampState(status: string, e: { kind?: string; process?: { activity: string } | null } | null = null): LampState {
  if (status === 'shell' || e?.kind === 'shell') return e?.process && e.process.activity !== 'prompt' ? 'busy' : 'shell';
  return isLampState(status) && status !== 'peek' && status !== 'seen' ? status : 'unknown';
}

/** The sprite + filter defs (one hidden <svg>, ids prefixed `L-` / `k-`). */
export function lampSprite() {
  const f = UI.fit;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false" id="k-sprite"><defs>
<filter id="inked" x="-10%" y="-20%" width="120%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 2.45" result="holes"/><feComposite in="SourceGraphic" in2="holes" operator="in" result="worn"/><feTurbulence type="turbulence" baseFrequency=".06" numOctaves="1" seed="3" result="w"/><feDisplacementMap in="worn" in2="w" scale="1"/></filter>
<radialGradient id="k-glass" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="${CORE.paper}" stop-opacity=".85"/><stop offset=".35" stop-color="currentColor" stop-opacity="1"/><stop offset="1" stop-color="${CORE.ink}" stop-opacity=".35"/></radialGradient>
<linearGradient id="k-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${UI.brassHi}"/><stop offset=".5" stop-color="${UI.brass}"/><stop offset="1" stop-color="${UI.brassLo}"/></linearGradient>
<symbol id="L-working" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.3" fill="url(#k-brass)"/><circle cx="8" cy="8" r="5.4" fill="currentColor"/><circle cx="8" cy="8" r="5.4" fill="url(#k-glass)" opacity=".7"/></symbol>
<symbol id="L-blocked" viewBox="0 0 16 16"><path d="M8 .6 15.6 14.4H.4Z" fill="url(#k-brass)" stroke="url(#k-brass)" stroke-width="1" stroke-linejoin="round"/><path d="M8 3.6 13 12.8H3Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><rect x="7.2" y="6.2" width="1.6" height="3.8" rx=".8" fill="${CORE.paper}"/><circle cx="8" cy="11.4" r=".9" fill="${CORE.paper}"/></symbol>
<symbol id="L-done" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.3" fill="url(#k-brass)"/><circle cx="8" cy="8" r="5.4" fill="currentColor"/><path d="M5.2 8.2 7.2 10.1 10.9 5.9" fill="none" stroke="${CORE.paper}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="L-idle" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.3" fill="url(#k-brass)"/><circle cx="8" cy="8" r="5.4" fill="${f.lampIdleGlass}"/><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.6"/></symbol>
<symbol id="L-shell" viewBox="0 0 16 16"><rect x=".7" y="2" width="14.6" height="12" rx="3" fill="url(#k-brass)"/><rect x="2.6" y="3.8" width="10.8" height="8.4" rx="1.8" fill="${f.shellGlass}"/><path d="M4.3 6.1 6.3 8 4.3 9.9M7.6 10.2H11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="L-unknown" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.3" fill="url(#k-brass)"/><circle cx="8" cy="8" r="5.4" fill="currentColor"/><path d="M6.4 6.6a1.7 1.7 0 1 1 2.4 1.5c-.5.25-.8.6-.8 1.1v.3" fill="none" stroke="${CORE.paper}" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.3" r=".85" fill="${CORE.paper}"/></symbol>
</defs></svg>`;
}

/** Markup for one lamp (for innerHTML builders); `label` defaults to the state word. */
export function lampHtml(state: string, { size = '', label = null, still = false }: { size?: string; label?: string | null; still?: boolean } = {}) {
  const known = isLampState(state);
  const [sym, word] = known ? LAMP[state] : LAMP.unknown;
  const c = ['k-lamp', known ? state : 'unknown', size, still ? 'still' : ''].filter(Boolean).join(' ');
  return `<svg class="${c}" viewBox="0 0 16 16" role="img" aria-label="${label ?? word}"><use href="#${sym}"/></svg>`;
}
