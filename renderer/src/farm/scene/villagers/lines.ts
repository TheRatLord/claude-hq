// @pure
/**
 * What the villagers say. Pure (no three, no DOM): `brief(state)` boils the ValleyState down to the few numbers the
 * villagers talk about, and `lineFor(role, brief, n)` picks the line for the n-th chat — a useful report first, a
 * bit of village colour on alternate chats. Tested in villagers.test.ts.
 */
import type { Season, ValleyState, WeatherKind } from '../../model/types.ts';
import { unreadCount } from '../../model/valley.ts';
import type { Role } from './cast.ts';

export interface Brief {
  hour: number;
  season: Season;
  weather: WeatherKind;
  intensity: number;
  /** unread letters (including unresolved needs-you ones) */
  unread: number;
  /** names of the farmers who need you, longest-waiting first */
  needs: string[];
  commits: number;
  farmers: number;
  working: number;
  idle: number;
  /** fields by mood: busy (thriving / tilling), growing, resting, fallow (incl. harvest) */
  busy: number;
  growing: number;
  resting: number;
  fallow: number;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  tempC: number | null;
}

const cap = (s: string): string => (s && !/[:/\\.]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

export function brief(s: ValleyState): Brief {
  let working = 0, idle = 0, busy = 0, growing = 0, resting = 0, fallow = 0;
  const needs: { name: string; at: number }[] = [];
  for (const f of s.farmers.values()) {
    if (f.needsYou) needs.push({ name: cap(f.name), at: f.jobSince });
    if (f.status === 'working') working++;
    if (f.job === 'idle' || f.job === 'away') idle++;
  }
  for (const p of s.plots.values()) {
    if (p.stage === 'thriving' || p.stage === 'tilling') busy++;
    else if (p.stage === 'growing') growing++;
    else if (p.stage === 'resting') resting++;
    else fallow++;
  }
  needs.sort((a, b) => a.at - b.at);
  const g = s.gauges;
  return {
    hour: s.sky.hour, season: s.sky.season, weather: s.sky.weather.kind, intensity: s.sky.weather.intensity,
    unread: unreadCount(s.letters), needs: needs.map((n) => n.name), commits: s.commitsToday, farmers: s.farmers.size, working, idle,
    busy, growing, resting, fallow,
    cpu: g ? g.cpu : null, mem: g ? g.mem : null, disk: g ? g.disk : null, tempC: g ? g.tempC : null,
  };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const list = (names: readonly string[]): string => names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}`;

export function partOfDay(hour: number): string {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}
export const clock = (hour: number): string => {
  const h = Math.floor(hour) % 24, m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${h}:${m < 10 ? '0' : ''}${m}`;
};
const WEATHER_WORD: Readonly<Record<WeatherKind, string>> = { clear: 'clear', cloudy: 'cloudy', rain: 'rainy', storm: 'stormy', fog: 'foggy', snow: 'snowy' };
const OUTLOOK: Readonly<Record<WeatherKind, readonly string[]>> = {
  clear: ['Not a cloud worth naming.', 'Fine and fair — good drying weather.'],
  cloudy: ['A lid of cloud, but it\'s holding.', 'Grey skies, no rain in them yet.'],
  rain: ['Steady rain. The crops are grateful.', 'Rain on and off; mind the puddles.'],
  storm: ['A proper storm! Everyone under a roof.', 'Thunder over the ridge — stay in!'],
  fog: ['Fog in the low fields; the lamps help.', 'Can\'t see the windmill for the fog.'],
  snow: ['Snow settling on the roofs.', 'Snowing! The pond might freeze yet.'],
};

/** Shortened: the useful report for a role, given the valley. `n` = how many times you've chatted (variety). */
export function lineFor(role: Role, b: Brief, n = 0): string {
  const alt = n % 2 === 1;
  switch (role) {
    case 'postmaster': {
      if (b.needs.length) {
        const waiting = Math.max(b.unread, b.needs.length);
        return `${plural(waiting, 'letter')} waiting, ${list(b.needs)} ${b.needs.length === 1 ? 'needs' : 'need'} you!`;
      }
      if (b.unread) return alt ? `Still ${plural(b.unread, 'unread letter')} in the box, love.` : `${plural(b.unread, 'letter')} for you — fresh from the fields.`;
      return alt ? 'All caught up! I\'ll ring if anything comes in.' : 'No new mail today. The pigeons are bored stiff.';
    }
    case 'clerk': {
      if (!b.commits) return alt ? 'The ledger\'s open, the bin\'s empty. Ship something!' : 'Nothing shipped yet today. The bin\'s hungry!';
      if (b.commits >= 10) return `${plural(b.commits, 'crate')} shipped today — a bumper harvest! Here's the ledger.`;
      return alt ? `That's ${plural(b.commits, 'crate')} out the door today. Ledger's here.` : `${plural(b.commits, 'crate')} shipped today. Here's the ledger.`;
    }
    case 'miller': {
      if (b.cpu === null) return 'The gauges are quiet — no readings from the house yet.';
      const mem = b.mem !== null ? `, the tower's ${pct(b.mem)} full` : '';
      if (b.cpu > 0.8) return `The sails are fair screaming — CPU at ${pct(b.cpu)}${mem}!`;
      if (b.cpu < 0.15) return alt ? `Barely a breath of wind. CPU's dozing at ${pct(b.cpu)}.` : `Quiet milling today: CPU ${pct(b.cpu)}${mem}.`;
      if (b.disk !== null && b.disk > 0.9) return `CPU ${pct(b.cpu)}, but the silo's ${pct(b.disk)} full — time to clear some disk!`;
      return alt ? `Steady wind: CPU ${pct(b.cpu)}${b.tempC !== null ? `, running ${Math.round(b.tempC)}°C` : ''}.` : `A good milling breeze: CPU ${pct(b.cpu)}${mem}.`;
    }
    case 'mayor': {
      const fields = b.busy + b.growing + b.resting;
      if (!b.farmers && !fields) return alt ? 'Plenty of good land going! Open a workspace and we\'ll till you a field.' : 'A quiet valley today. Open a herdr workspace to till a field!';
      const parts: string[] = [];
      if (b.busy) parts.push(`${plural(b.busy, 'field')} busy`);
      if (b.growing) parts.push(`${b.growing} growing`);
      if (b.resting) parts.push(`${b.resting} resting`);
      const head = parts.length ? parts.join(', ') : plural(fields, 'field');
      if (b.needs.length) return `Welcome! ${head} — and ${list(b.needs)} ${b.needs.length === 1 ? 'is' : 'are'} asking for you.`;
      return alt ? `${plural(b.farmers, 'farmer')} on the books, ${b.working} hard at it. Have a look at the board!` : `Welcome to the valley! ${head}.`;
    }
    case 'ranger': {
      if (b.needs.length) return `Need a hand finding ${b.needs[0]}? Here's the map — I'll point the way.`;
      return alt ? 'Every path in the valley, on one map. Where to?' : 'Lost? Never in my valley. Here\'s the map.';
    }
    case 'weather': {
      const sky = WEATHER_WORD[b.weather];
      const out = OUTLOOK[b.weather][n % 2];
      return `${clock(b.hour)} on a ${sky} ${b.season} ${partOfDay(b.hour)}. ${out}`;
    }
  }
}

/** A short line called out when the player passes (no panel), or null when there's nothing to say. */
export function callOut(role: Role, b: Brief): string | null {
  if (role === 'postmaster' && b.needs.length) return `Letter for you! ${b.needs[0]} needs you.`;
  return null;
}

/** The clerk's cheer when a crate lands in the bin. */
export const shipLine = (commits: number): string => (commits > 1 ? `Another crate! That's ${commits} today.` : 'First crate of the day!');
