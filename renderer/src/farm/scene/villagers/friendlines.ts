// @pure
/**
 * What the villagers say about friendship (model/friends.ts): asking for today's request, a nudge while it's open, the
 * thank-you when you deliver, gift reactions by how much they like it, and the warmer lines that open up at 4 hearts.
 * Pure (no three, no DOM); tested in villagers.test.ts.
 */
import type { Request, Tier } from '../../model/friends.ts';
import { PLACE_NAME, itemText } from '../../model/friends.ts';
import { collectDef } from '../../model/collection.ts';
import { coins } from '../../model/shop.ts';
import type { Role } from './cast.ts';

const name = (id: string | undefined): string => (collectDef(id ?? '')?.name ?? 'that').toLowerCase().replace(/^pond /, '');
const what = (q: Request): string => (q.item === 'any' ? 'a fish' : itemText(q.item ?? '', q.n));
const place = (q: Request): string => PLACE_NAME[q.place ?? 'stones'];
const whenText = (q: Request): string => ({ any: '', night: ' after dark', dawn: ' at dawn', day: ' while it\'s light', dusk: ' around dusk', beforeDusk: ' before dusk' })[q.when];

/** The villager tells you today's request (the first chat after it went up). */
export function askLine(role: Role, q: Request): string {
  switch (q.kind) {
    case 'bring':
      switch (role) {
        case 'postmaster': return `Could you bring me ${what(q)}? I like to tuck something nice in with the post.`;
        case 'clerk': return `Got an order in for ${what(q)}. Bring them by the bin and I'll make it worth your while.`;
        case 'miller': return `I'm baking something special. Could you find me ${what(q)}? The meadows are full of them.`;
        case 'mayor': return `The square needs dressing! Bring me ${what(q)}, would you? For civic pride.`;
        case 'ranger': return `I'm cataloguing the trails. If you come across ${what(q)}, bring them my way.`;
        case 'weather': return `For my instruments, purely scientific: ${what(q)}, if you find them.`;
      }
      break;
    case 'catch':
      if (q.item === 'any') return role === 'weather' ? `Fish bite differently under the stars. Catch me anything${whenText(q)}? I'm keeping notes.` : `Catch me a fish${whenText(q)}? Any fish at all.`;
      switch (role) {
        case 'clerk': return `Somebody's ordered ${what(q)}. Catch one${whenText(q)} and the crate's yours to fill.`;
        case 'ranger': return `I need to check the ${name(q.item)} are doing well. Catch one${whenText(q)} and tell me how it looked?`;
        default: return `Could you catch ${what(q)}${whenText(q)}? I'd be ever so grateful.`;
      }
    case 'visit':
      switch (role) {
        case 'ranger': return `Walk out to ${place(q)}${whenText(q)} for me? I want to know it's all as it should be.`;
        case 'weather': return `Go up to ${place(q)}${whenText(q)}. Look up. Then come and tell me what you saw.`;
        case 'mayor': return `Pop by ${place(q)}${whenText(q)}, would you? An official inspection. You're officially deputised.`;
        case 'miller': return `Would you look in on ${place(q)} for me? I can't leave the mill with the sails turning.`;
        default: return `Would you go and see ${place(q)}${whenText(q)}? It's lovely, and you deserve a stroll.`;
      }
    case 'agent':
      switch (q.goal) {
        case 'answer': return role === 'postmaster' ? 'There\'s a farmer waiting on an answer. Check on whoever needs you, love, then come and tell me.' : 'Somebody out in the fields needs you. Answer them, then come back and let me know.';
        case 'ship': return role === 'clerk' ? 'The bin\'s been hungry all day. Get one of your farmers to ship a commit, then come see me.' : 'Could your farmers ship a commit today? Bram does love a crate.';
        case 'tests': return role === 'miller' ? 'A mill likes things that pass inspection. Get me a green test run today?' : 'A green test run would cheer the whole valley up. Can your farmers manage one?';
        case 'finished': return role === 'mayor' ? 'The Mayor\'s office would like to see a task finished today. For the minutes. Can do?' : 'See one of your farmers finish a task today? Then come tell me all about it.';
      }
  }
  return 'I could use a hand with something today. Have a look at the noticeboard?';
}

/** A nudge while the request is still open (chatting again). */
export function remindLine(role: Role, q: Request, next: string): string {
  const head = role === 'mayor' ? 'Still on the Mayor\'s list:' : role === 'clerk' ? 'Still waiting on' : 'No rush, but';
  const body = q.kind === 'bring' ? `${what(q)} (${next})` : q.kind === 'visit' ? `a look at ${place(q)}${whenText(q)}` : q.kind === 'catch' ? `${what(q)}${whenText(q)}` : next;
  return `${head} ${body}.`;
}

/** The thank-you when a request is delivered. */
export function thanksLine(role: Role, q: Request, paid: number): string {
  const tip = coins(paid);
  switch (role) {
    case 'postmaster': return q.kind === 'bring' ? `Oh, ${what(q)}! They'll go out with tomorrow's post. Here's ${tip}, and a hug.` : `You did it! I knew you would. Here's ${tip} for your trouble.`;
    case 'clerk': return `That's the order filled. ${tip[0].toUpperCase()}${tip.slice(1)}, entered in the ledger. Good work.`;
    case 'miller': return q.kind === 'bring' ? `Oh, these are perfect! Straight into the next batch. Take ${tip}, and come by when it's out of the oven.` : `Lovely. The sails turn a little easier when the valley's happy. ${tip[0].toUpperCase()}${tip.slice(1)} for you.`;
    case 'mayor': return `Splendid! The Mayor's office thanks you. That's ${tip}, and a mention in the minutes.`;
    case 'ranger': return q.kind === 'visit' ? `All well out there? Good. You've got a ranger's feet. Here's ${tip}.` : `Thanks. Here's ${tip}. You're getting to know these trails.`;
    case 'weather': return q.kind === 'visit' ? `Clear skies up there? I knew it. ${tip[0].toUpperCase()}${tip.slice(1)}, and my thanks.` : `Excellent data. ${tip[0].toUpperCase()}${tip.slice(1)}, for science.`;
  }
}

/** Today's request is already done. */
export function doneLine(role: Role): string {
  switch (role) {
    case 'postmaster': return 'Thank you again for earlier. You made my whole round.';
    case 'clerk': return 'Ledger\'s square for today, thanks to you.';
    case 'miller': return 'Still smiling about earlier. The flour\'s never been finer.';
    case 'mayor': return 'You\'re in the minutes today, you know. Underlined.';
    case 'ranger': return 'Good work today. The trails are better for it.';
    case 'weather': return 'Forecast for the rest of today: gratitude, widespread.';
  }
}

const LOVE: Readonly<Record<Role, string>> = {
  postmaster: 'For me? Oh, a %s! I\'m going to press it in my best letter. You remembered!',
  clerk: 'Now that is a %s. That\'s the finest I\'ve seen all week. Thank you.',
  miller: 'A %s! You know me too well. I could cry. Don\'t tell the Mayor.',
  mayor: 'A %s! Magnificent! This is going straight in the town hall cabinet.',
  ranger: 'A %s? That\'s a proper find. You\'ve a good eye. Thank you, really.',
  weather: 'A %s! My barometer just went up three points. So did I.',
};
const LIKE: Readonly<Record<Role, string>> = {
  postmaster: 'A %s, how thoughtful! I\'ll keep it on the sorting desk.',
  clerk: 'A %s. Very decent. I\'ll find a good shelf for it.',
  miller: 'Ooh, a %s. That\'s lovely, thank you.',
  mayor: 'A %s. Most kind! The Mayor\'s office approves.',
  ranger: 'Nice %s. Thanks. I\'ll show it to the owls.',
  weather: 'A %s. Very nice. I\'ll log it.',
};
const MEH: Readonly<Record<Role, string>> = {
  postmaster: 'A %s? Well, isn\'t that nice. Thank you, love.',
  clerk: 'A %s. Right. I\'ll find somewhere for it.',
  miller: 'A %s, for me? That\'s kind of you.',
  mayor: 'A %s! How... civic. Thank you.',
  ranger: 'A %s. Thanks. Every bit of the valley\'s worth knowing.',
  weather: 'A %s. Hmm. Thank you. Partly pleased, with sunny spells.',
};
const NOPE: Readonly<Record<Role, string>> = {
  postmaster: 'A %s? It\'s… very damp. I\'ll keep it away from the letters. But thank you.',
  clerk: 'A %s? Can\'t ship that. Can\'t sell it. Thanks, I suppose.',
  miller: 'Oh. A %s. That\'ll get in the gears. It\'s the thought that counts.',
  mayor: 'A %s. I see. I shall have it minuted as "a gift". Thank you.',
  ranger: 'A %s? That belongs out there, not in my pack. Next time, leave it be.',
  weather: 'A %s? Ugh. That\'s a cold front if I ever saw one.',
};

/** A gift reaction, by how much they like it. */
export function giftLine(role: Role, tier: Tier, item: string): string {
  const t = tier === 'love' ? LOVE : tier === 'like' ? LIKE : tier === 'dislike' ? NOPE : MEH;
  return t[role].replace('%s', name(item));
}

/** They've had a gift today already. */
export function giftedLine(role: Role): string {
  return role === 'mayor' ? 'One gift a day, by order of the Mayor. Even from you.' : 'You\'ve spoiled me enough for one day! Tomorrow, perhaps.';
}

/** Warmer lines once you're friends (4 hearts and up); a few more at 8. */
const CLOSE: Readonly<Record<Role, readonly string[]>> = {
  postmaster: [
    'I saved you the window seat on the bench by the mailbox. Nobody else is allowed it.',
    'Between you and me, the pigeons like you best. They told me.',
    'Some days the only letter I look forward to is you walking up the path.',
  ],
  clerk: [
    'I\'ve started a column in the ledger just for you. It\'s all good numbers.',
    'Bin\'s quiet. Stand here a minute. It\'s nice, isn\'t it.',
    'I don\'t say this to many folk: you\'re good company.',
  ],
  miller: [
    'When the wind drops I sit on the step and think about who\'d like what bread. You\'re always first on the list.',
    'The sails sound happier when you\'re about. I\'m not imagining it.',
    'You\'ve got flour on your sleeve. Now you\'re one of us.',
  ],
  mayor: [
    'Off the record: being Mayor is lonely work. Less so with you around.',
    'I\'ve put you forward for the Valley Medal. I am also the committee. You\'ve won.',
    'When I make speeches, I picture you in the front row. It helps.',
  ],
  ranger: [
    'There\'s a deer that comes to the stones at dawn. Come and see it with me one day.',
    'I marked a new path on the map. I named it after you. Don\'t tell Hazel.',
    'Most people walk the valley. You actually look at it.',
  ],
  weather: [
    'I named a cloud after you this morning. Cumulus, very fluffy. It suited you.',
    'The stars are better with company. You know where to find me after dark.',
    'Forecast: you, stopping by. Confidence: high. I\'m glad.',
  ],
};
/** a friendship line for the n-th chat, or null (below 4 hearts, or not this chat's turn) */
export function closeLine(role: Role, hearts: number, n: number): string | null {
  if (hearts < 4 || n % 3 !== 2) return null;
  const pool = CLOSE[role];
  const k = Math.floor(n / 3) % (hearts >= 8 ? pool.length : 2);
  return pool[k];
}
