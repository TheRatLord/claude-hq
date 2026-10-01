// @pure
/**
 * What the villagers say. Pure (no three, no DOM): `brief(state)` boils the ValleyState down to the few numbers the
 * villagers talk about, and `lineFor(role, brief, n)` picks the line for the n-th chat — a useful report first, a
 * bit of village colour on alternate chats. Tested in villagers.test.ts.
 */
import type { Season, ValleyState, WeatherKind } from '../../model/types.ts';
import { unreadCount } from '../../model/valley.ts';
import { SOON_DAYS, inDaysText } from '../../model/calendar.ts';
import type { FestivalId } from '../../model/calendar.ts';
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
  /** the Valley Almanac: rank name, points to the next rank (null at the top), what it brings */
  rank: string;
  toNext: number | null;
  nextRank: string | null;
  nextUpgrade: string | null;
  harvestToday: number;
  /** the festival on today (model/calendar.ts), and the next one when it is near (≤ SOON_DAYS) */
  festival: { id: FestivalId; name: string; day: number; days: number } | null;
  upcoming: { id: FestivalId; name: string; inDays: number } | null;
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
  const fest = s.sky.festival?.active ?? null, next = s.sky.festival?.next ?? null;
  return {
    hour: s.sky.hour, season: s.sky.season, weather: s.sky.weather.kind, intensity: s.sky.weather.intensity,
    unread: unreadCount(s.letters), needs: needs.map((n) => n.name), commits: s.commitsToday, farmers: s.farmers.size, working, idle,
    busy, growing, resting, fallow,
    cpu: g ? g.cpu : null, mem: g ? g.mem : null, disk: g ? g.disk : null, tempC: g ? g.tempC : null,
    rank: s.almanac.name, toNext: s.almanac.nextAt === null ? null : s.almanac.nextAt - s.almanac.points,
    nextRank: s.almanac.nextName, nextUpgrade: s.almanac.next?.title ?? null, harvestToday: s.almanac.today.points,
    festival: fest ? { id: fest.id, name: fest.name, day: fest.day, days: fest.days } : null,
    upcoming: next && next.inDays <= SOON_DAYS ? { id: next.id, name: next.name, inDays: next.inDays } : null,
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

/** What each villager says during each festival (the second, fourth… chat while it is on). */
const FESTIVAL_LINES: Readonly<Record<FestivalId, Readonly<Record<Role, string>>>> = {
  blossom: {
    postmaster: 'Petals in the post bag again! Every letter smells of cherry blossom this week.',
    clerk: 'I\'ve put a ribbon on every crate for the Blossom Fair. Bit festive for a ledger, but there we are.',
    miller: 'The sails throw petals everywhere when they turn. Pink flour, this week.',
    mayor: 'The maypole is up! Grab a ribbon and dance a round, it\'s tradition.',
    ranger: 'Best week of the year for a walk. The orchard\'s in full bloom.',
    weather: 'Blossom Fair forecast: petals from the west, heavy at times.',
  },
  lantern: {
    postmaster: 'Write your wish small: it has to fit on a lantern. Take one from the table by the pond!',
    clerk: 'I\'ve shipped forty lanterns to the pond this week. Not one came back, which I\'m told is the point.',
    miller: 'Calm nights for Lantern Night. The lanterns will rise straight up.',
    mayor: 'Lantern Night! After dark we float our wishes on the pond. Light one, it\'s on the house.',
    ranger: 'Watch the pond after sundown. The lanterns drift out toward the stars.',
    weather: 'Light breeze, clear skies after dark: perfect for the lanterns.',
  },
  founders: {
    postmaster: 'Founders\' Day! A whole sack of cards came in. The valley has friends.',
    clerk: 'Happy Founders\' Day! First field tilled, first crate shipped. I still have the receipt.',
    miller: 'The mill has turned every day since the founding. I baked the flour for the cake myself.',
    mayor: 'Happy Founders\' Day! There\'s cake on the square. Blow the candles out, make a wish.',
    ranger: 'I walked the very first path today. Still the best way into the valley.',
    weather: 'It was clear on the first Founders\' Day too, they say. Cake weather.',
  },
  harvest: {
    postmaster: 'Entries for the scarecrow contest go in the jars, not my mailbox, thank you!',
    clerk: 'Harvest Festival, our busiest season! The cornucopia on the square is all real produce.',
    miller: 'Every sack in the mill is spoken for. Harvest Festival: the sails earn their keep.',
    mayor: 'Have you seen the giant pumpkin on the square? Go on, judge it, and vote for a scarecrow!',
    ranger: 'The hay meadow\'s baled and the orchard\'s picked. Lovely season for a stroll.',
    weather: 'Harvest weather: crisp mornings, golden afternoons. Good for the hay.',
  },
  hallowtide: {
    postmaster: 'A letter came in with no name on it. Just a little drawing of a bat. Hallowtide, eh?',
    clerk: 'The bin keeps rattling at night. I\'m sure it\'s the wind. Probably the wind.',
    miller: 'There\'s a wisp that circles the mill after dark. I\'ve named it Gerald.',
    mayor: 'Happy Hallowtide! The big jack on the square has treats, if you knock.',
    ranger: 'Wisps out by the pond after dark. Harmless, but don\'t follow them into the reeds.',
    weather: 'Bats on the wing tonight, and a good chance of wisps by the water.',
  },
  starlight: {
    postmaster: 'Starlight post is the heaviest of the year. Half of it is for the tree!',
    clerk: 'I\'ve wrapped a crate for every farmer. The labels say "do not open till the build passes".',
    miller: 'The sails are hung with lights this month. Hazel\'s orders. Hazel is me.',
    mayor: 'Starlight! Hang an ornament on the tree in the square; everyone adds one.',
    ranger: 'Follow the snow lanterns home. They line every road out of the square.',
    weather: 'Clear and cold tonight: the best starlight of the year.',
  },
  newyear: {
    postmaster: 'Last post of the year! Or the first, depending when you\'re reading this.',
    clerk: 'Closing the year\'s ledger. Every crate, every commit. Not bad, valley, not bad at all.',
    miller: 'One last turn of the sails for the old year. Fireworks at midnight, mind your hats.',
    mayor: 'Happy New Year! Raise a glass at the punch table, and stay up for the fireworks.',
    ranger: 'The best spot for the midnight fireworks? The south meadow. Trust me.',
    weather: 'Clear skies at midnight. Perfect for fireworks.',
  },
};

/** "The Harvest Festival is in 5 days" in each villager's voice */
function soonLine(role: Role, name: string, days: number): string {
  const when = inDaysText(days);
  switch (role) {
    case 'postmaster': return `The ${name} is ${when}. Invitations are already going out!`;
    case 'clerk': return `${name} ${when}. I\'ll need extra crates.`;
    case 'miller': return `${name} ${when}! I\'m milling extra flour for it.`;
    case 'mayor': return `Mark your almanac: the ${name} is ${when}. I\'m on the planning committee. I am the planning committee.`;
    case 'ranger': return `${name} ${when}. I\'ll clear the paths for it.`;
    case 'weather': return `${name} ${when}; I\'ll have a forecast for it nearer the day.`;
  }
}

/** a festival line for the n-th chat, or null when the useful report should go first */
export function festivalLine(role: Role, b: Brief, n: number): string | null {
  if (b.needs.length && (role === 'postmaster' || role === 'ranger')) return null; // their useful line is about who needs you
  if (b.festival && n % 2 === 1) {
    const base = FESTIVAL_LINES[b.festival.id][role];
    return b.festival.days > 1 && b.festival.day === b.festival.days && role === 'mayor' ? `Last day of the ${b.festival.name}! ${base}` : base;
  }
  if (!b.festival && b.upcoming && n % 4 === 1) return soonLine(role, b.upcoming.name, b.upcoming.inDays);
  return null;
}

/** Shortened: the useful report for a role, given the valley. `n` = how many times you've chatted (variety). */
export function lineFor(role: Role, b: Brief, n = 0): string {
  const fest = festivalLine(role, b, n);
  if (fest) return fest;
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
      if (n % 3 === 2) {
        const today = b.harvestToday ? ` We've added ${b.harvestToday} prosperity today.` : '';
        if (b.toNext === null) return `${b.rank}! The finest valley on the map. Fireworks at nine, as promised.${today}`;
        return `We're a proud ${b.rank} now — ${b.toNext} more prosperity and we'll be a ${b.nextRank}${b.nextUpgrade ? `, with ${b.nextUpgrade.replace(/^The /, "the ").replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}` : ''}.${today} The almanac (H) has it all.`;
      }
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
