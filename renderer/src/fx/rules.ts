// @pure
/**
 * FX visibility / style rules as pure functions (DESIGN §6.7 signal vocabulary + status-ring chroma budget, ART §8.2
 * nameplates, §6.4.1 dust ladder), so they are unit-tested without three.
 * Owner: FX.
 */
import { STATUS, MISC } from '../../../shared/palette.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { AmbientFlags, RingSpec } from './types.ts';

export const NEAR_RING_M = 6;
export const PLATE_NEAR_M = 6, PLATE_FAR_M = 9;
export const GLYPH_FROM_M = 8, GLYPH_FULL_M = 9;
export const BUBBLE_FULL_M = 9, BUBBLE_FAR_M = 11;
export const RAIN_AFTER_MS = 5 * 60_000;
export const STEAM_AFTER_MS = 30 * 60_000;
export const PLACARD_HIDE_M = 18;
/** [FX fix r1] Within this camera distance an active desk board becomes the §6.7 near card on the desk top (the tall
 *  board sat on the seated Clawd's hat from a 2–3 m standing view); it rises again past `PLACARD_NEAR_M + 0.4`. */
export const PLACARD_NEAR_M = 3.5;
/** [FX fix r1] ONE atlas slot size for every placard (board 404×136 = the 0.8×0.27 m aspect; the tent card is a
 *  404×124 sub-rect of it): 5 per 2048 row × 14 rows = 70 ≥ MAX_BOARDS, so board ↔ tent churn can never overflow. */
export const PLACARD_SLOT = Object.freeze([404, 136] as const);

/** [FX M1.75] A muted (`last: …`) board is the near card only within this distance; beyond it stands tall like an
 *  active board, so an idle / done agent's last task reads from across the room (§6.7 "Idle: last: <task>"). */
export const PLACARD_MUTED_M = 6;

/**
 * @pure Board target with hysteresis: 1 = the low near card on the desk, 0 = the tall board.
 * Drops when the camera is near (< PLACARD_NEAR_M; muted boards < PLACARD_MUTED_M), when the agent is blocked AT THE
 * DESK (`blocked`: the caller passes it only while the owner sits there — its waving hand owns the air above the head),
 * or when the board is seen almost edge-on (|cos| < 0.3: unreadable, and the two coplanar boards of a desk row stack
 * into each other from the side of a pod); pops back past +0.4 m / |cos| > 0.42.
 * `dist` = camera → board (m, plan), `prev` = current target, `facing` = |cos| between the board normal and the camera
 * direction (plan, 1 = face-on), `muted` = idle / done `last: …` board.
 */
export function placardLowTarget(dist: number, prev: number, blocked = false, facing = 1, muted = false): number {
  if (blocked) return 1;
  const near = muted ? PLACARD_MUTED_M : PLACARD_NEAR_M;
  if (dist < near || facing < 0.3) return 1;
  if (dist > near + 0.4 && facing > 0.42) return 0;
  return prev;
}

const hex2rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb2hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** @pure sRGB hex mix */
export function mixHex(a: string, b: string, t: number): string {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

const WORKING_RING = mixHex(STATUS.working, MISC.bayCarpet, 0.4);

export type RingStyle = Readonly<{ shape: 'ring2' | 'ring6' | 'ring8'; color: string; alpha: number; hot: boolean; breathe: number; pulse: boolean }>;

/** Status ring style per the chroma budget (§6.7). null = not drawn. `ring` = the fx.ring spec. */
export function ringStyle(ring: Pick<RingSpec, 'status'> | null, { acked = false, dist, hovered = false, selected = false }: { acked?: boolean; dist: number; hovered?: boolean; selected?: boolean }): RingStyle | null {
  if (!ring) return null;
  const focus = hovered || selected;
  // [FX fix m2-r1] shared frozen styles: called per actor per frame, no allocation
  switch (ring.status) {
    case 'blocked': return RING.blocked;
    case 'done':
      if (!acked) return RING.done;
      return focus ? RING.acked : null;
    case 'working':
      return dist < NEAR_RING_M || focus ? RING.working : null;
    case 'idle': return focus ? RING.idle : null;
    case 'unknown': return focus ? RING.unknown : null;
    default: return null;
  }
}
const style = (shape: RingStyle['shape'], color: string, alpha: number, hot: boolean, breathe: number, pulse: boolean): RingStyle => Object.freeze({ shape, color, alpha, hot, breathe, pulse });
const RING = Object.freeze({
  blocked: style('ring8', STATUS.blocked, 1, true, 0, true),
  done: style('ring6', STATUS.done, 1, false, 0.3, false),
  acked: style('ring2', STATUS.idle, 0.5, false, 0, false),
  working: style('ring2', WORKING_RING, 0.35, false, 0, false),
  idle: style('ring2', STATUS.idle, 0.5, false, 0, false),
  unknown: style('ring2', STATUS.unknown, 0.5, false, 0, false),
});

/** @pure 0..1 ramp */
export const ramp = (x: number, a: number, b: number): number => Math.max(0, Math.min(1, (x - a) / (b - a)));

/**
 * Nameplate alpha (ART §8.2): within 6 m, fading out to 9 m; always for hovered / selected / blocked.
 */
export function plateAlpha({ dist, hovered = false, selected = false, blocked = false }: { dist: number; hovered?: boolean; selected?: boolean; blocked?: boolean }): number {
  if (hovered || selected || blocked) return 1;
  return 1 - ramp(dist, PLATE_NEAR_M, PLATE_FAR_M);
}

/** Tab labels herdr / the agent CLIs give a pane by default: they say nothing on a nameplate. */
export const DEFAULT_TABS: readonly string[] = Object.freeze(['claude', 'codex', 'shell', 'bash', 'zsh', 'fish', 'sh']);

/**
 * @pure [FX fix r2] The nameplate's "· tab" suffix, or '' when it adds nothing: no tab, the tab repeats the name
 * ('claude · claude'), or it is a default tab label / the agent's own kind ('pebble · claude'). Most real panes sit
 * in a tab called 'claude', and the suffix made every plate ~2× wider (the queue pile-up).
 */
export function plateTab(name: string, tab: string | null | undefined, kind?: string): string {
  const t = (tab ?? '').trim();
  if (!t) return '';
  const lt = t.toLowerCase();
  if (lt === (name ?? '').trim().toLowerCase() || lt === (kind ?? '').toLowerCase() || DEFAULT_TABS.includes(lt)) return '';
  return t;
}

/** Activity glyph alpha (§6.7): only beyond 8 m (fade in over 1 m), and never for blocked (the "!" owns it). */
export function glyphAlpha({ dist, blocked = false }: { dist: number; blocked?: boolean }): number {
  return blocked ? 0 : ramp(dist, GLYPH_FROM_M, GLYPH_FULL_M);
}

/** Tool bubble alpha: full near, gone beyond 11 m (the glyph takes over); alerts always. */
export function bubbleAlpha({ dist, kind }: { dist: number; kind: string }): number {
  if (kind === 'alert') return 1;
  return 1 - ramp(dist, BUBBLE_FULL_M, BUBBLE_FAR_M);
}

/** The entity fields ambientOf reads. */
export interface AmbientSource { status?: string; statusSince?: number; struggle?: { level?: number } | null; kind?: string }

/**
 * Ambient per-actor effects derived from the entity + intent (§6.7 rows FX draws on its own); `now` = server ms.
 */
export function ambientOf(e: AmbientSource | null | undefined, intent: { face?: string | null } | null | undefined, now: number, out: AmbientFlags = { rain: false, orbit: 0, zzz: false, steam: false }): AmbientFlags {
  // [FX fix m2-r1] `out` (reused per actor by fx/index.ts): no allocation per actor per frame
  if (!e) { out.rain = false; out.orbit = 0; out.zzz = false; out.steam = false; return out; }
  const age = now - (e.statusSince ?? now);
  const struggle = e.struggle?.level ?? 0;
  out.rain = e.status === 'blocked' && age > RAIN_AFTER_MS;
  out.orbit = e.status === 'working' && struggle >= 2 ? Math.min(3, struggle + 1) : 0;
  out.zzz = intent?.face === 'sleepy';
  out.steam = e.status === 'working' && e.kind !== 'shell' && age >= STEAM_AFTER_MS;
  return out;
}

/**
 * @pure Placard lettering layout: one line at the nominal size if it fits (condensed to ≥ 80%), else a balanced
 * two-line word wrap (each line condensed to ≥ 75%), shrinking the font only as a last resort (§6.7 cap height).
 * `measure` = text width at font px.
 */
export function placardLayout(measure: (s: string, px: number) => number, text: string, { maxW, fontPx, minPx = 24, lines = 2 }: { maxW: number; fontPx: number; minPx?: number; lines?: 1 | 2 }): { lines: string[]; fontPx: number; sx: number } {
  const fits1 = (px: number) => measure(text, px) * 0.8 <= maxW;
  if (fits1(fontPx) || lines === 1) {
    let px = fontPx;
    while (!fits1(px) && px > minPx) px -= 2;
    return { lines: [text], fontPx: px, sx: Math.min(1, maxW / measure(text, px)) };
  }
  const words = text.split(' ');
  let best: { a: string; b: string; w: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(measure(a, fontPx), measure(b, fontPx));
    if (!best || w < best.w) best = { a, b, w };
  }
  if (!best) { // one long word: hard split
    const h = Math.ceil(text.length / 2);
    best = { a: `${text.slice(0, h)}-`, b: text.slice(h), w: Math.max(measure(`${text.slice(0, h)}-`, fontPx), measure(text.slice(h), fontPx)) };
  }
  let px = fontPx;
  const { a: lineA, b: lineB } = best;
  const width = (p: number) => Math.max(measure(lineA, p), measure(lineB, p));
  while (width(px) * 0.75 > maxW && px > minPx) px -= 2;
  return { lines: [lineA, lineB], fontPx: px, sx: Math.min(1, maxW / width(px)) };
}

/** [FX fix r1 m2-carry] Last-resort pennant lettering (never the workspace label: that is on the nameplate). */
export const PENNANT_DONE_TEXT = 'done ✓';
const normLbl = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export type TaskLabelFn = (e: Partial<Entity>) => string | null;
export type FitFn = (s: string) => string;

/**
 * [FX fix r1 m2-carry] What a ✓ pennant says: the task (`taskLabel`), else the last todo (the last completed one, else
 * the last listed), else `done ✓`. A label that merely repeats the workspace label / project / tab name ('infra') is
 * treated as no task, so a flag always means "finished X" or "finished".
 * `taskLabel` / `fit` = shared/task's taskLabel / fitLabel (injected: rules stays palette-only).
 */
export function pennantText(e: Partial<Entity> | null | undefined, taskLabel: TaskLabelFn, fit: FitFn): string {
  return (e && taskOrTodo(e, taskLabel, fit)) || PENNANT_DONE_TEXT;
}

/**
 * [FX fix r2 m2-carry] The task (`taskLabel`) else the last todo (last completed, else last listed), dropping any label
 * that merely repeats the workspace label / project / tab / repo name. null → no real task known.
 */
function taskOrTodoOf(e: Partial<Entity>, taskLabel: TaskLabelFn, fit: FitFn): { text: string; todo: boolean } | null {
  const junk = new Set([e.workspace?.label, e.project, e.tab?.label, e.repo].filter(Boolean).map(normLbl));
  const ok = (s: string | null | undefined) => (s && !junk.has(normLbl(s)) ? s : null);
  const t = ok(taskLabel(e));
  if (t) return { text: t, todo: false };
  const todos = Array.isArray(e.todos) ? e.todos.filter((x) => x && typeof x.content === 'string' && x.content.trim()) : [];
  const last = [...todos].reverse().find((x) => x.status === 'completed') ?? todos[todos.length - 1];
  const td = last ? ok(fit(last.content)) : null;
  return td ? { text: td, todo: true } : null;
}
const taskOrTodo = (e: Partial<Entity>, taskLabel: TaskLabelFn, fit: FitFn) => taskOrTodoOf(e, taskLabel, fit)?.text ?? null;

/** [FX fix r2 m2-carry] Storefront-strip status words when an agent has no task / todo (never the workspace name). */
export const STRIP_STATUS_TEXT: Readonly<Record<string, string>> = { done: PENNANT_DONE_TEXT, blocked: 'needs you', working: 'working…', idle: 'idle' };
/**
 * [FX fix r2 m2-carry] A bay roster strip's secondary text for one desk: the task (`last: …` when not working /
 * blocked, as on the desk board), else the last todo, else the status word ('idle' / 'done ✓' / …). Same
 * "repeats the workspace" rule as pennantText: never the workspace label, project, tab or repo name ('moss · tinker').
 */
export function stripTask(e: Partial<Entity> | null | undefined, taskLabel: TaskLabelFn, fit: FitFn): { text: string; muted: boolean } {
  const st = e?.status ?? 'idle';
  const muted = st !== 'working' && st !== 'blocked';
  if (!e) return { text: STRIP_STATUS_TEXT.idle, muted: true };
  const r = taskOrTodoOf(e, taskLabel, fit);
  if (r) return { text: muted && !r.todo && e.kind !== 'shell' ? `last: ${r.text}` : r.text, muted };
  return { text: STRIP_STATUS_TEXT[st] ?? STRIP_STATUS_TEXT.idle, muted };
}
