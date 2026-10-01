/**
 * Pure presentation helpers for the HUD: names, status and job copy, relative times, byte rates, key combos.
 * No DOM here (node tests import it).
 */
import type { FarmerView, HelperView, Job, LetterKind, LinkState, PlotKind, PlotStage, Season, WeatherKind } from '../model/types.ts';
import type { Status } from '../../../../shared/protocol.ts';

/** 'flint' → 'Flint'; ids and paths are left alone. */
export function nice(name: string): string {
  if (!name) return name;
  if (/[:/\\.]/.test(name)) return name;
  return name[0].toUpperCase() + name.slice(1);
}

export const STATUS_LABEL: Record<Status, string> = {
  blocked: 'Needs you', working: 'Working', done: 'Done', idle: 'Idle', unknown: 'Away',
};
/** Sort weight: who deserves attention first. */
export const STATUS_RANK: Record<Status, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };

export const JOB_LABEL: Record<Job, string> = {
  plant: 'Planting', inspect: 'Inspecting', water: 'Watering', build: 'Building', haul: 'Hauling to the bin',
  fetch: 'Fetching', plan: 'Planning', talk: 'Chatting', delegate: 'Directing ducklings', rest: 'Resting',
  ask: 'Waiting for you', done: 'Basket full', idle: 'Taking it easy', away: 'Napping',
};
/** What the job means in real terms (tooltip / secondary copy). */
export const JOB_REAL: Record<Job, string> = {
  plant: 'editing files', inspect: 'reading & searching', water: 'running tests', build: 'running commands',
  haul: 'git', fetch: 'web / MCP', plan: 'thinking & todos', talk: 'writing a reply', delegate: 'subagents running',
  rest: 'compacting context', ask: 'blocked on a prompt', done: 'finished, waiting for review', idle: 'nothing to do',
  away: 'not running',
};

export const HELPER_LABEL: Record<HelperView['activity'], string> = {
  prompt: 'At the prompt', edit: 'Editing', test: 'Testing', serve: 'Serving', monitor: 'Watching', remote: 'Remote shell',
  repl: 'REPL', git: 'Git', build: 'Building', run: 'Running',
};

export const STAGE_LABEL: Record<PlotStage, string> = {
  tilling: 'Freshly tilled', thriving: 'Thriving', growing: 'Growing', resting: 'Resting', harvest: 'Harvest', fallow: 'Fallow',
};

export const KIND_LABEL: Record<PlotKind, string> = {
  wheat: 'Wheat', pumpkins: 'Pumpkins', cabbages: 'Cabbages', sunflowers: 'Sunflowers', orchard: 'Orchard', vineyard: 'Vineyard',
  berries: 'Berries', chickens: 'Chickens', cows: 'Cows', sheep: 'Sheep', pigs: 'Pigs', bees: 'Bees',
};

export const LETTER_LABEL: Record<LetterKind, string> = {
  'needs-you': 'Needs you', finished: 'Finished', error: 'Error', 'test-fail': 'Tests failed', 'test-pass': 'Tests passed',
  commit: 'Commit', struggle: 'Struggling', arrived: 'Arrived', left: 'Went home', subagents: 'Ducklings', news: 'News',
};

export const LINK_LABEL: Record<LinkState, string> = {
  live: 'Live', connecting: 'Connecting…', offline: 'Offline', 'herdr-offline': 'herdr offline',
};

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow',
};
export const SEASON_LABEL: Record<Season, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

export const TIER_LABEL: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', other: '' };

/** 'Claude · Opus' */
export function kindLine(f: Pick<FarmerView, 'kind' | 'tier'>): string {
  const k = f.kind === 'claude' ? 'Claude' : f.kind === 'codex' ? 'Codex' : f.kind === 'gemini' ? 'Gemini' : 'Agent';
  const t = f.tier ? TIER_LABEL[f.tier] ?? '' : '';
  return t ? `${k} · ${t}` : k;
}

/** Short relative duration: '12s', '4m', '2h', '3d'. */
export function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 && h < 10 ? ` ${m % 60}m` : ''}`;
  return `${Math.floor(h / 24)}d`;
}
/** 'just now', '4m ago' */
export function ago(at: number, now: number): string {
  const d = now - at;
  if (d < 45_000) return 'just now';
  return `${dur(d)} ago`;
}

export function bytesRate(bps: number): string {
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = Math.max(0, bps), i = 0;
  while (v >= 1000 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
export const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** 'HH:MM' from a fractional hour. */
export function clock(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Key combo matching for settings like 'Ctrl+`' (leader key). */
export interface Combo { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string }
export function parseCombo(spec: string): Combo | null {
  if (!spec) return null;
  const parts = spec.split('+').map((p) => p.trim()).filter((p, i, a) => p || i === a.length - 1);
  // 'Ctrl++' → last part empty means '+'
  const keyRaw = spec.endsWith('++') ? '+' : parts[parts.length - 1];
  if (!keyRaw) return null;
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  return {
    ctrl: mods.has('ctrl') || mods.has('control'), alt: mods.has('alt') || mods.has('option'), shift: mods.has('shift'),
    meta: mods.has('meta') || mods.has('cmd') || mods.has('super'), key: keyRaw.toLowerCase(),
  };
}
const CODE_KEYS: Record<string, string> = { Backquote: '`', Space: 'space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
export function codeKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  return CODE_KEYS[code] ?? code.toLowerCase();
}
export function matchCombo(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>, c: Combo | null): boolean {
  if (!c) return false;
  if (e.ctrlKey !== c.ctrl || e.altKey !== c.alt || e.metaKey !== c.meta) return false;
  if (c.shift && !e.shiftKey) return false;
  const k = (e.key ?? '').toLowerCase();
  return k === c.key || codeKey(e.code ?? '') === c.key || (c.key === 'space' && k === ' ');
}

/** Stable pleasant hue for a farmer seed. */
export function seedHue(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
}

/** Status colour tokens (CSS variables in hud.css match these). */
export const STATUS_COLOR: Record<Status, string> = {
  blocked: '#f0a72c', working: '#5fae45', done: '#3f95d8', idle: '#b09a78', unknown: '#8d8580',
};

/** Workspace colour index → fence ribbon paint (matches the plots palette loosely). */
export const WS_COLORS = ['#d9534f', '#f0a02c', '#e8cf3a', '#6ab04c', '#3fa7c9', '#5b6fd6', '#a45bc9', '#e06c9f'];

/** The one-line summary for a farmer row. */
export function farmerLine(f: FarmerView): string {
  if (f.needsYou) return f.question || 'Waiting for your answer';
  const d = f.detail ? ` · ${f.detail}` : '';
  return `${JOB_LABEL[f.job]}${d}`;
}

/** A persistence key for a letter that survives reloads (ids restart per page). */
export function letterKey(l: { kind: string; farmerId: string; at: number }): string {
  return `${l.kind}|${l.farmerId}|${Math.round(l.at / 1000)}`;
}

/** Case-insensitive multi-word filter. */
export function matches(query: string, ...hay: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = hay.filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => text.includes(w));
}

/** Letter titles carry the raw pane name ('willow finished'); show it the way the rest of the HUD does. */
export function letterTitle(l: { title: string; farmerName: string }): string {
  if (!l.farmerName) return l.title;
  const t = l.title.split(l.farmerName).join(nice(l.farmerName));
  return t[0] ? t[0].toUpperCase() + t.slice(1) : t;
}

/**
 * The compact name for tight spots (needs-you cards, map pins, ledger rows, the drawer's side list): the in-world tag
 * (project directory, unique within the field), the same name the farmer's nameplate shows. Falls back to the name.
 */
export function shortName(p: { name: string; tag?: string }): string {
  return p.tag || nice(p.name ?? '');
}

/**
 * The name inside a list or map already grouped by field: just the tag's distinguishing part (`claude-hq·flint` →
 * `flint`), since the group already says which field. Numbered twins (`claude-hq·2`) and unique tags stay whole.
 */
export function fieldName(p: { name: string; tag?: string }): string {
  const t = shortName(p);
  const i = t.lastIndexOf('·');
  const w = i >= 0 ? t.slice(i + 1) : '';
  return w && !/^\d+$/.test(w) ? w : t;
}

/** The full herdr name as a secondary line, when it says something the shown name does not ('' otherwise). */
export function altName(p: { name: string; tag?: string }, shown = shortName(p)): string {
  const full = nice(p.name ?? '');
  return full && full.toLowerCase() !== shown.toLowerCase() ? full : '';
}

/** One glyph for a map pin: the tag's distinguishing suffix (`claude-hq·flint` → F), else its first letter. */
export function pinGlyph(p: { name: string; tag?: string }): string {
  const t = shortName(p);
  const i = t.lastIndexOf('·');
  const w = i >= 0 ? t.slice(i + 1) : t;
  return (/^\d+$/.test(w) ? w : w[0] ?? '?').toUpperCase();
}
