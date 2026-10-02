// @pure
/**
 * Heart events (docs/valley/villagers.md): friendship paying off. At 3, 5 and 7 hearts (between the milestone
 * letters and decor of model/friends.ts) each villager has a short scene to share, and it happens the next time you
 * meet them at the right place and hour: Posy at the mailbox in the morning, Fern at the standing stones on her night
 * walk, Nimbus on the knoll after dark. A few lines, one choice, a little staging (an act, an emote, where they and
 * your eyes look), and a keepsake: a photo for the album, a letter, or a piece for your yard. Fern's notebook keeps
 * the record.
 *
 * Pure: the events (`HEART_EVENTS`), when one is due (`nextEvent`, `dueEvent`), the script with its conditional
 * lines resolved (`scriptOf`), the stored record (`HeartsData`, `parseHearts`) and the live service (`createHearts`)
 * that steps a scene the HUD shows and the villagers system stages. Persisted in `claude-valley.hearts.v1`.
 */
import { dayKey } from './almanac.ts';
import type { PlaceKey } from './routines.ts';

export type HeartWho = 'villager:posy' | 'villager:bram' | 'villager:hazel' | 'villager:marigold' | 'villager:fern' | 'villager:nimbus';

/** The hearts each event needs (the milestone letters / decor of model/friends.ts sit at 2, 4, 6, 8, 10). */
export const EVENT_HEARTS = Object.freeze([3, 5, 7] as const);

/**
 * Where the camera / the villager looks during a line: 'them' (the villager), 'you' (the villager faces you),
 * 'sky' (up above them), 'ahead' (the way they face, at eye height), a structure id ('mailbox', 'windmill', 'halt'…)
 * or 'project:<id>' (a Valley Project's site).
 */
export type Look = string;

/** One line of a scene. `who`: the villager speaking ('them', the default) or a stage direction ('aside'). */
export interface Beat {
  who?: 'them' | 'aside';
  text: string;
  /** only when this flag is on / off (flags: 'grotto', 'restored:halt', 'choice:posy-1=0', 'season:winter', 'night') */
  if?: string;
  unless?: string;
  /** staging: their act (scene/farmers/pose.ts Act; 'stand' if unknown), a floating emote, where they turn, where your
   *  eyes go, a few steps toward what they face; `snap` takes the keepsake photo on this line */
  act?: string;
  emote?: string;
  face?: Look;
  look?: Look;
  walk?: number;
  snap?: boolean;
}
export interface Option { label: string; reply: readonly Beat[] }
export type Keepsake =
  | { kind: 'photo'; caption: string }
  | { kind: 'letter'; title: string; from?: string; /** one body, or one per choice */ body: string | readonly string[] }
  | { kind: 'decor'; id: string; name: string };

export interface HeartEvent {
  /** 'posy-1' (a save key: never rename) */
  id: string;
  who: HeartWho;
  /** 1..3 in their story */
  n: 1 | 2 | 3;
  hearts: number;
  title: string;
  /** they must be at one of these routine places (model/routines.ts), within the hours (local; wraps if from > to) */
  places: readonly PlaceKey[];
  hours: readonly [number, number];
  /** "at the mailbox, in the morning" (the notebook's hint, the friends card) */
  when: string;
  /** how they let on before it happens */
  teaser: string;
  /** the notebook's one-line record afterwards */
  record: string;
  beats: readonly Beat[];
  choice: { prompt: string; options: readonly Option[] };
  after: readonly Beat[];
  keepsake: Keepsake;
}

const ev = (o: HeartEvent): HeartEvent => Object.freeze(o);

export const HEART_EVENTS: readonly HeartEvent[] = Object.freeze([
  // ------------------------------------------------------------------------------------------------ Posy
  ev({
    id: 'posy-1', who: 'villager:posy', n: 1, hearts: 3, title: 'Sergeant', places: ['mailbox'], hours: [7.4, 16.8],
    when: 'at the mailbox, by day', teaser: 'Posy wants you to meet somebody. Somebody with feathers.',
    record: 'Met Sergeant, the pigeon who has bitten the Mayor twice (on purpose).',
    beats: [
      { who: 'aside', text: 'Posy is trying to coax a pigeon into the mailbox\'s pigeonhole. The pigeon is winning.', act: 'pigeon', look: 'them' },
      { text: 'Oh! Perfect timing. Don\'t make any sudden movements, he\'s sensitive.', face: 'you', emote: 'bang' },
      { text: 'This is Sergeant. Four thousand letters delivered, never once late, and he\'s bitten the Mayor twice.', act: 'pigeon' },
      { text: 'Both times on purpose.' },
      { text: 'He\'s retiring. He doesn\'t know yet. I\'m working up to it.', act: 'stand', emote: 'sweat' },
    ],
    choice: { prompt: 'Sergeant regards you with one orange eye.', options: [
      { label: 'He looks like he\'s got a few flights left in him.', reply: [
        { text: 'That\'s what I keep telling myself. Then he lands in the wrong garden and pretends it was a shortcut.' },
        { text: '…Maybe one more summer.', emote: 'heart' },
      ] },
      { label: 'Do you want me to tell him?', reply: [
        { text: 'Ha! You\'d lose a finger.', act: 'cheer' },
        { text: 'No, it should come from me. I\'ll do it gently. With seeds.' },
      ] },
    ] },
    after: [
      { who: 'aside', text: 'Sergeant hops onto your shoulder, considers your ear for a long moment, and decides against it.', emote: 'heart' },
      { text: 'Well! He\'s never done that. Not even for me. Stand still: this one\'s going on the noticeboard.', act: 'wave', snap: true },
    ],
    keepsake: { kind: 'photo', caption: 'Posy, Sergeant and you at the mailbox' },
  }),
  ev({
    id: 'posy-2', who: 'villager:posy', n: 2, hearts: 5, title: 'The dead-letter drawer', places: ['picnic', 'pergola'], hours: [12.1, 13.1],
    when: 'over lunch (the picnic spot, or the pergola when it\'s wet)', teaser: 'Posy has been carrying something in her satchel for a very long time.',
    record: 'Posy delivered the oldest letter in her dead-letter drawer, eleven years late: to you.',
    beats: [
      { text: 'Can I show you something? It\'s not post, exactly. Well, it is post. It just never got delivered.', face: 'you', look: 'them' },
      { who: 'aside', text: 'From her satchel she takes a yellowed envelope, soft at the corners from being carried a long time.', act: 'read' },
      { text: 'Every postmaster keeps a dead-letter drawer. Wrong address, no address, moved away. Mine has eleven letters in it.' },
      { text: 'This one\'s the oldest. It came in the very first sack, the one Old Tull carried up from the halt on Founders\' Day.' },
      { text: '"To whoever farms the valley next." That\'s all it says on the front.' },
      { text: 'Every new face that came down the road, I thought: is it them? It never was. They always left.', act: 'stand' },
    ],
    choice: { prompt: 'Posy looks at you, then at the envelope.', options: [
      { label: 'Is it me?', reply: [
        { text: 'I think it might be. You\'ve stayed longer than anyone. You talk to the pigeons.', emote: 'heart' },
        { text: 'Here. Don\'t read it in front of me, I\'ll cry, and I\'ve got mustard on my face.' },
      ] },
      { label: 'Shouldn\'t you open it?', reply: [
        { text: 'Me? Goodness, no. Postmasters don\'t open other people\'s post. It\'s practically the only rule.', emote: 'sweat' },
        { text: 'And it isn\'t mine. I\'m fairly sure, now, that it\'s yours.', emote: 'heart' },
      ] },
    ] },
    after: [
      { who: 'aside', text: 'She presses it into your hands, then busies herself very hard with a sandwich.', act: 'picnic' },
      { text: 'It\'ll be in your mailbox. Properly delivered. Eleven years late, but properly.' },
    ],
    keepsake: { kind: 'letter', title: 'To whoever farms the valley next', from: 'The first farmer (delivered by Posy)', body:
      'To whoever farms the valley next,\n\nI\'m writing this on the first night. One field, turned by hand, and a crate of turnips the clerk insists on writing down.\n\nYou\'ll find the soil\'s good and the wind is honest. The mill turns if you ask it nicely. The postmaster will know your name before you do.\n\nLook after it. Not because it\'s yours. Because, for a while, you\'re its.\n\nPlant something you won\'t see grow.\n\nThe first farmer\n\n(Delivered by Posy, eleven years late, with apologies and a pressed violet.)' },
  }),
  ev({
    id: 'posy-3', who: 'villager:posy', n: 3, hearts: 7, title: 'Return address', places: ['yard'], hours: [18.9, 21.9],
    when: 'in the farmhouse yard, of an evening', teaser: 'Posy has a question about letters. About who writes to the postmaster.',
    record: 'Posy told you how she came up on the train at nine, with a suitcase full of stamps. You have her dovecote.',
    beats: [
      { text: 'You know the funny thing about being postmaster?', face: 'you', look: 'them' },
      { text: 'I\'ve delivered every letter in this valley for nine years. Birthday cards. Seed catalogues. That perfumed one for Bram I\'m still not allowed to talk about.', act: 'lean' },
      { text: 'And I\'ve never once had one. Who\'d write to the postmaster? You\'d just be handing it to her.' },
      { who: 'aside', text: 'She laughs, but she\'s turning her cap round and round in her hands.', act: 'stand' },
      { text: 'I came up on the train when I was nine, with a suitcase full of stamps and a note pinned to my coat. Old Tull met me at the halt.', face: 'ahead' },
      { text: 'He said I could sort letters if I could reach the pigeonholes. I couldn\'t. He built me a step. It\'s still there, under the mailbox.', look: 'mailbox', face: 'mailbox' },
    ],
    choice: { prompt: 'Posy is quiet for a moment.', options: [
      { label: 'I\'ll write to you.', reply: [
        { text: 'You… what? You\'d have to post it in my own box. I\'d see you do it.', face: 'you', look: 'them', emote: 'bang' },
        { text: '…I\'d pretend I didn\'t. Deal.', emote: 'heart' },
      ] },
      { label: 'Who was the note on your coat from?', reply: [
        { text: 'My mum. It said "Please look after her, she\'s good with paper."', face: 'you', look: 'them' },
        { text: 'Tull framed it. It\'s on the wall in the sorting room. I was good with paper. Still am.', emote: 'heart' },
      ] },
    ] },
    after: [
      { text: 'Bram built this from the old pigeonholes when we got the new box. I want you to have it. Then the pigeons have somewhere to stop on the way to you.', act: 'cheer', emote: 'sparkle' },
    ],
    keepsake: { kind: 'decor', id: 'dovecote', name: 'Posy\'s dovecote' },
  }),

  // ------------------------------------------------------------------------------------------------ Bram
  ev({
    id: 'bram-1', who: 'villager:bram', n: 1, hearts: 3, title: 'Crate number one', places: ['bin'], hours: [7.9, 16.2],
    when: 'at the shipping bin, by day', teaser: 'Bram wants to show you the first page of the ledger. He keeps it in a separate envelope.',
    record: 'Bram showed you crate number one: six turnips, one slightly bruised.',
    beats: [
      { text: 'Got a minute? Course you have. Look at this.', face: 'you', look: 'them' },
      { who: 'aside', text: 'Bram opens the ledger at the very first page. The ink has gone brown. The handwriting is very, very neat.', act: 'read' },
      { text: '"Crate one. Turnips, six. One slightly bruised." Founders\' Day. My first day on the bin.' },
      { text: 'I was fourteen. I wrote "slightly bruised" because I didn\'t want the turnip to feel bad.', emote: 'sweat' },
      { text: 'Every crate since is in here. Every harvest, every commit. Some days it\'s one line. Some days it\'s two pages and I need a sit-down.' },
    ],
    choice: { prompt: 'He holds the ledger like it might bruise too.', options: [
      { label: 'Why keep the first page separate?', reply: [
        { text: 'Because it\'s the only page where nothing had gone wrong yet.', act: 'stand' },
        { text: 'That\'s a joke. Mostly. It reminds me everything starts as one bruised turnip.', emote: 'note' },
      ] },
      { label: 'Can I write in it?', reply: [
        { text: 'In the ledger?', emote: 'question' },
        { who: 'aside', text: 'He looks at you for a long time.' },
        { text: '…One line. In pencil. Under today. Don\'t smudge it.', emote: 'heart' },
      ] },
    ] },
    after: [
      { text: 'Hold it up. No, higher. Posy says I need more pictures that aren\'t of crates.', act: 'cheer', snap: true },
    ],
    keepsake: { kind: 'photo', caption: 'Bram and the very first page of the ledger' },
  }),
  ev({
    id: 'bram-2', who: 'villager:bram', n: 2, hearts: 5, title: 'Still life with fish', places: ['bridge'], hours: [16.8, 18],
    when: 'fishing off the big bridge, late afternoon', teaser: 'Posy says Bram paints. Bram says Posy says a lot of things.',
    record: 'Bram showed you his sketchbook: fish, mostly fish, and half of you.',
    beats: [
      { who: 'aside', text: 'Bram is fishing off the bridge. Next to him, weighted down with a stone, is a sketchbook.', act: 'fish', look: 'them' },
      { text: 'Shh. They\'re biting. Something\'s biting. Might be my sandwich.' },
      { text: 'Posy told you about the painting, didn\'t she. She tells everyone. Then she says "don\'t tell Bram I told you."', face: 'you' },
      { text: 'I paint fish. Mostly fish. Fish hold still. People fidget, and then they want to see it, and then they\'ve got opinions about their nose.', act: 'read' },
      { who: 'aside', text: 'He flips through the sketchbook: perch, pike, a trout drawn so carefully you can count its spots. On the last page, half a farmer.' },
      { text: 'That\'s you. From the back. You were looking at the water. I ran out of light.', emote: 'sweat' },
    ],
    choice: { prompt: 'Bram\'s pencil hovers.', options: [
      { label: 'Finish it. I\'ll hold still.', reply: [
        { text: 'Nobody holds still.' },
        { who: 'aside', text: 'You hold still. Bram draws. A fish takes his bait and he lets it go without looking up.', act: 'read' },
        { text: '…Huh. You do, actually.', emote: 'heart' },
      ] },
      { label: 'Draw me pulling a face.', reply: [
        { text: 'Oh, go on then.' },
        { who: 'aside', text: 'You pull a face. Bram laughs so hard he nearly drops the rod.', act: 'cheer', emote: 'note' },
        { text: 'That\'s going in the ledger. Under "shipped: one masterpiece."' },
      ] },
    ] },
    after: [
      { text: 'I\'ll post it to you. Don\'t put it on the wall. Or do. Just not where I can see it.', act: 'fish' },
    ],
    keepsake: { kind: 'letter', title: 'A sketch, from Bram', body: [
      'Enclosed: you, on the bridge, finished. You held still the whole time. Nobody holds still.\n\nI\'ve put a pike in the corner for scale. You\'re bigger than the pike. Well done.\n\nBram',
      'Enclosed: you, on the bridge, pulling that face. I\'ve labelled it so nobody thinks it\'s a fish.\n\nI laughed again drawing it. Twice. Don\'t tell Posy.\n\nBram',
    ] },
  }),
  ev({
    id: 'bram-3', who: 'villager:bram', n: 3, hearts: 7, title: 'The last train out', places: ['campfire'], hours: [18.4, 21.3],
    when: 'by the campfire of an evening', teaser: 'Bram has been staring at the fire like it owes him a story. It\'s the other way round.',
    record: 'Bram told you why something leaves the valley every day. You have his still life of a pike.',
    beats: [
      { text: 'My dad worked the halt. Signals, freight, the bell. Every evening the train stopped, and every evening he loaded it.', look: 'them', act: 'sitground' },
      { text: 'Then the line stopped stopping. Not enough freight, they said. Valley too small. He went with the last train, to find work down the line.' },
      { who: 'aside', text: 'Bram pokes the fire with a stick. A log settles.', act: 'campfire' },
      { text: 'He sent money every month, for years. Postcards from every station. Posy kept a map with pins in it.' },
      { text: 'But I stayed. Somebody had to keep the bin going. If nothing ever leaves a valley, people stop believing there\'s anything in it.' },
      { text: 'So I ship. Every day. Even if it\'s one turnip.', face: 'you' },
    ],
    choice: { prompt: 'The fire pops.', options: [
      { label: 'Something leaves every day now.', reply: [
        { text: 'It does, doesn\'t it. Your lot see to that.', emote: 'heart' },
        { text: 'Dad would like your farmers. Busy. Bit chaotic. Always shipping.' },
      ] },
      { label: 'Do you still hear from him?', reply: [
        { text: 'Every Starlight, a card. He calls it Starlight now. Picked that up from us.' },
        { text: 'He\'s got a garden. Grows terrible tomatoes. Very proud of them.', emote: 'note' },
      ] },
    ] },
    after: [
      { text: 'And now the halt\'s back. I heard the whistle from the bin the other night and stood there like a lemon for five minutes.', if: 'restored:halt', look: 'project:halt' },
      { text: 'One day somebody will fix that halt. Then I\'ll stand on it and wave like an idiot.', unless: 'restored:halt' },
      { text: 'Here. I painted it last winter. Don\'t look at the brushwork. Look at the fish.', act: 'cheer', emote: 'sparkle', face: 'you', look: 'them' },
    ],
    keepsake: { kind: 'decor', id: 'stilllife', name: 'Bram\'s still life' },
  }),

  // ------------------------------------------------------------------------------------------------ Hazel
  ev({
    id: 'hazel-1', who: 'villager:hazel', n: 1, hearts: 3, title: 'Reading the wind', places: ['mill'], hours: [6, 14.5],
    when: 'at the windmill, in the morning', teaser: 'Hazel says a miller doesn\'t need a weathervane. She\'d like to show you why.',
    record: 'Hazel taught you to read the wind with a pinch of flour.',
    beats: [
      { text: 'Morning! You\'re just in time for the best bit of the day. Hold out your hands.', face: 'you', look: 'them', emote: 'sparkle' },
      { who: 'aside', text: 'She tips a scoop of flour into your palms. It\'s still warm from the stones.', act: 'inspect' },
      { text: 'Toss a pinch up and watch where it goes. That\'s the wind telling you how the day will be.' },
      { text: 'Nan taught me that. She said a weathervane only tells you where the wind\'s going. Flour tells you how it feels about it.', look: 'sky', face: 'ahead' },
    ],
    choice: { prompt: 'Which way do you throw it?', options: [
      { label: 'Into the wind.', reply: [
        { who: 'aside', text: 'You throw it into the wind. The wind throws it back. You are now mostly flour.', emote: 'puff', look: 'them', face: 'you' },
        { text: 'Oh, that\'s wonderful. Hold still. Hold STILL.', act: 'cheer' },
      ] },
      { label: 'With the wind.', reply: [
        { who: 'aside', text: 'The flour streams away downhill in a long pale ribbon, over the fields, catching the light.', look: 'ahead' },
        { text: 'Westerly, steady, a bit mischievous. A good milling day. You\'re a natural.', face: 'you', look: 'them', emote: 'star' },
      ] },
    ] },
    after: [
      { text: 'Look at you. Flour on your nose. You\'re one of us now, there\'s no washing that off.', act: 'wave', snap: true },
    ],
    keepsake: { kind: 'photo', caption: 'Reading the wind with Hazel at the windmill' },
  }),
  ev({
    id: 'hazel-2', who: 'villager:hazel', n: 2, hearts: 5, title: 'Nan\'s mill', places: ['millwheel'], hours: [15.2, 16.9],
    when: 'down by the old river mill, in the afternoon', teaser: 'Hazel disappears every fine afternoon. Somewhere with running water.',
    record: 'Hazel told you about Nan, who ran the river mill before the windmill was built.',
    beats: [
      { who: 'aside', text: 'The wheel turns, slow and sure. Hazel is sitting with her eyes shut, listening to it.', if: 'restored:millwheel', look: 'them', act: 'sitground' },
      { who: 'aside', text: 'Hazel is sitting on a stone by the broken mill, listening to the river run through the empty wheel.', unless: 'restored:millwheel', look: 'them', act: 'sitground' },
      { text: 'This was Nan\'s. Before the windmill, before the founding, before any of it. Just Nan, a wheel and the river.', face: 'you' },
      { text: 'She used to say a water mill is patient and a windmill is clever. She never trusted clever.' },
      { text: 'The year of the flood the wheel jammed and the roof came in. Nan said "well, that\'s that", and walked up the hill and showed them where to build the windmill.', look: 'project:millwheel', face: 'project:millwheel' },
      { text: 'She never came down here again. I come every afternoon. Bit daft, really.', face: 'you', look: 'them' },
    ],
    choice: { prompt: 'The river keeps talking.', options: [
      { label: 'It\'s not daft.', reply: [
        { text: 'No?' },
        { text: 'No. I suppose it isn\'t. Somebody ought to keep it company.', emote: 'heart' },
      ] },
      { label: 'Tell me about her.', reply: [
        { text: 'Strong arms, terrible singer, always a boiled sweet in her apron. Flour in her eyebrows, permanently.', emote: 'note' },
        { text: 'She\'d have liked you. She liked anyone who asked a question and then actually listened to the answer.' },
      ] },
    ] },
    after: [
      { text: 'And now it turns again. I heard it the first night and thought I was dreaming. I came down in my nightcap.', if: 'restored:millwheel' },
      { text: 'If that wheel ever turns again, I think I\'ll hear her laughing in it. Or complaining. One of the two.', unless: 'restored:millwheel' },
      { text: 'I\'ve something of hers you should have. I\'ll post it. I\'d only get flour on it.', act: 'stand' },
    ],
    keepsake: { kind: 'letter', title: 'A page from Nan\'s mill book', body:
      'Hazel copied this out for you from her grandmother\'s mill book, in her best hand. The flour fingerprints are original.\n\n"Monday. River high, wheel sound. Ground eleven sacks. Hazel (aged six) helped, by which I mean she sat in the hopper.\n\nTuesday. Wind from the south. Bad for bread, good for gossip.\n\nWednesday. Remember: the mill is not the stones or the wheel. The mill is whoever turns up in the morning."\n\nUnderneath, in Hazel\'s writing: You turn up. That counts.\n\nH.' },
  }),
  ev({
    id: 'hazel-3', who: 'villager:hazel', n: 3, hearts: 7, title: 'Names in the door', places: ['sails'], hours: [18.3, 20.8],
    when: 'under the windmill sails, of an evening', teaser: 'Hazel keeps glancing at the windmill door, then at you, then back.',
    record: 'Hazel showed you the millers\' names carved in the windmill door. You have her model windmill.',
    beats: [
      { text: 'Come here, mind the step. I want to show you the inside of the door.', face: 'windmill', look: 'windmill', walk: 1.5 },
      { who: 'aside', text: 'Carved into the old oak, one under another: a dozen names, the oldest worn almost smooth. The last says HAZEL. Below it is a lot of empty door.', act: 'inspect' },
      { text: 'Every miller since the windmill went up. Nan\'s at the top, because she was cross about it and wanted to be first.', face: 'you', look: 'them' },
      { text: 'I always thought mine would be the last name. Not many people want to be up at five, covered in flour, talking to the wind.' },
      { text: 'Lately I\'ve thought there might be somebody, someday. Doesn\'t have to be soon.' },
    ],
    choice: { prompt: 'She holds out her pocket knife, handle first.', options: [
      { label: 'Carve my initials. Small.', reply: [
        { text: 'Small? Ha! Nan carved hers with a chisel and a grudge.', act: 'cheer' },
        { who: 'aside', text: 'You carve two small letters in the corner. Not under her name: beside it.', look: 'windmill' },
        { text: 'Beside. Not below. Yes. That\'s right.', emote: 'heart', look: 'them' },
      ] },
      { label: 'Leave the space for them.', reply: [
        { text: 'That\'s what Nan would have said.', emote: 'heart' },
        { text: 'All right. The space stays. But you\'re carved in here somewhere. I\'m just never telling you where.' },
      ] },
    ] },
    after: [
      { text: 'I made you this. It turns when the wind blows. Not as well as mine, obviously.', act: 'cheer', emote: 'sparkle', face: 'you', look: 'them' },
    ],
    keepsake: { kind: 'decor', id: 'minimill', name: 'Hazel\'s model windmill' },
  }),

  // ------------------------------------------------------------------------------------------------ Mayor Marigold
  ev({
    id: 'marigold-1', who: 'villager:marigold', n: 1, hearts: 3, title: 'The rehearsal', places: ['noticeboard', 'board'], hours: [8.8, 15.2],
    when: 'at the noticeboard or the projects board, by day', teaser: 'The Mayor is looking for an audience. A small one. Ideally you.',
    record: 'You heard the Mayor\'s festival speech, all the way to card twelve.',
    beats: [
      { text: 'Ah! An audience. Splendid. Stand there. No, there, where the light is flattering. To me.', face: 'you', look: 'them', emote: 'star' },
      { who: 'aside', text: 'The Mayor produces a stack of index cards an inch thick.', act: 'read' },
      { text: 'My speech for the next festival. It is, if I may say, a triumph. Card one of forty.' },
      { text: '"Friends, farmers, assorted pigeons…"', act: 'talk' },
      { who: 'aside', text: 'Several minutes pass. A cloud goes over. Fern walks past twice.', look: 'sky' },
      { text: '"…and that, in summary, is why the drainage is everybody\'s business." Card twelve. Thoughts?', look: 'them', act: 'stand' },
    ],
    choice: { prompt: 'The Mayor waits, cards raised.', options: [
      { label: 'Clap. Enthusiastically.', reply: [
        { who: 'aside', text: 'You clap. The Mayor glows like a lamp.', emote: 'heart', act: 'cheer' },
        { text: 'Do you know, nobody has ever clapped at card twelve. Card twelve has been waiting its whole life for this.' },
      ] },
      { label: 'Maybe a bit shorter?', reply: [
        { text: 'Shorter.' },
        { who: 'aside', text: 'She looks at the cards. She looks at you. She drops twenty-eight of them in the bin.', emote: 'sweat' },
        { text: '…Bram is going to be insufferably grateful.' },
      ] },
    ] },
    after: [
      { text: 'Stand next to me, I want a picture for the minutes. Chin up. Mayoral.', act: 'wave', snap: true },
    ],
    keepsake: { kind: 'photo', caption: 'Mayor Marigold rehearsing her speech (card twelve)' },
  }),
  ev({
    id: 'marigold-2', who: 'villager:marigold', n: 2, hearts: 5, title: 'Unopposed', places: ['square', 'picnic'], hours: [12.4, 13.7],
    when: 'having lunch on the square', teaser: 'The Mayor has a confession. It is not for the minutes.',
    record: 'The Mayor confessed to fourteen unopposed elections.',
    beats: [
      { text: 'Sit, sit. The square\'s best at lunchtime. Everybody passes through and nobody\'s in a hurry.', face: 'you', look: 'them' },
      { text: 'May I confess something? It\'s not for the minutes.' },
      { text: 'I have been elected Mayor fourteen times. Unopposed. Fourteen.', emote: 'sweat' },
      { text: 'The first time, I was the only one who came to the meeting. Half the valley had gone on the last train. The other half were having their tea.' },
      { text: 'I stood on a crate and said somebody ought to keep the noticeboard tidy. Next thing I knew I had a sash.', act: 'talk' },
      { who: 'aside', text: 'She straightens the medal on her sash. It is slightly too shiny, as if it is polished every morning. It is.', act: 'stand' },
    ],
    choice: { prompt: 'The square goes about its lunch.', options: [
      { label: 'You\'re good at it.', reply: [
        { text: 'Am I?', emote: 'question' },
        { text: 'I keep the board tidy. I remember everyone\'s birthday. I make long speeches so nobody has to feel awkward in the silence.' },
        { text: 'Perhaps that is the job.', emote: 'heart' },
      ] },
      { label: 'Would you ever stand down?', reply: [
        { text: 'Only if someone better stood up. Then I\'d be first in the queue to vote for them.' },
        { text: 'And then I\'d make a speech about it. A long one.', emote: 'note' },
      ] },
    ] },
    after: [
      { text: 'I\'m going to write this up properly. Off the record, but properly. I can\'t help it.' },
    ],
    keepsake: { kind: 'letter', title: 'Minutes of a meeting (unofficial)', body:
      'MINUTES OF A MEETING (UNOFFICIAL)\n\nPresent: the Mayor; a good friend.\nApologies: the pigeons (busy).\n\n1. The Mayor confessed to fourteen unopposed elections. The friend did not laugh. Noted with gratitude.\n2. It was agreed that the square is best at lunchtime.\n3. Any other business: none. The Mayor merely wishes it recorded that she was very glad of the company.\n\nMeeting closed at the end of a sandwich.\n\nSigned, Marigold (Mayor)\nSeconded, Marigold (also Mayor)' },
  }),
  ev({
    id: 'marigold-3', who: 'villager:marigold', n: 3, hearts: 7, title: 'Under the hat', places: ['pergola'], hours: [17.9, 22.2],
    when: 'at the pergola of an evening', teaser: 'Nobody in the valley has ever seen the Mayor without her hat.',
    record: 'The Mayor took off her hat. Under it, a pressed marigold. You have her spare hat.',
    beats: [
      { text: 'Do you know what I\'ve never done in public? In fourteen terms?', face: 'you', look: 'them' },
      { who: 'aside', text: 'She takes off the top hat. Tucked into her hair underneath is a small dried marigold, pressed flat and a little faded.', act: 'stand', emote: 'sparkle' },
      { text: 'My mother was stationmaster at the halt. A marigold in her buttonhole every day, rain or shine. She said I arrived like one: orange, loud, and in the wrong season.' },
      { text: 'When the trains stopped stopping she swept that platform for a year, waiting for one that didn\'t come.', look: 'project:halt', face: 'project:halt' },
      { text: 'Then she said "Right. The valley needs somebody who isn\'t waiting." And she started the noticeboard.', face: 'you', look: 'them' },
      { text: 'So I wear the hat and I make the speeches, and nobody sees the flower. Silly, isn\'t it.' },
    ],
    choice: { prompt: 'She turns the hat in her hands.', options: [
      { label: 'It\'s not silly. She\'d be proud.', reply: [
        { text: 'Hmph. She\'d tell me to stand up straight.' },
        { who: 'aside', text: 'She stands up straight.' },
        { text: '…She would, though. She would be.', emote: 'heart' },
      ] },
      { label: 'Wear it where people can see.', reply: [
        { text: 'On the outside? On the sash?', emote: 'question' },
        { who: 'aside', text: 'She considers it, then pins the marigold to her sash, beside the medal. It looks better there.' },
        { text: 'Well. If anyone asks, you\'re responsible.', emote: 'heart' },
      ] },
    ] },
    after: [
      { text: 'And the halt runs again. I go up sometimes and stand where she stood. The evening train whistles. I wave. Every time.', if: 'restored:halt' },
      { text: 'One day a train will stop at that halt again. I\'ve put it in the plans. Underlined. Twice.', unless: 'restored:halt' },
      { text: 'Take my spare hat. A mayor should keep a hat in every house she trusts.', act: 'cheer', emote: 'sparkle' },
    ],
    keepsake: { kind: 'decor', id: 'hatstand', name: 'The Mayor\'s spare hat' },
  }),

  // ------------------------------------------------------------------------------------------------ Fern
  ev({
    id: 'fern-1', who: 'villager:fern', n: 1, hearts: 3, title: 'The owl count', places: ['stones'], hours: [21.9, 23.6],
    when: 'at the standing stones, late at night', teaser: 'Fern walks out to the stones every night with her lantern. Twice a year, she counts something.',
    record: 'You counted owls with Fern at the standing stones: five, the best count in nine years.',
    beats: [
      { text: 'Shh. Lantern down. Lower. They don\'t like the light.', face: 'you', look: 'them' },
      { who: 'aside', text: 'The stones hum faintly in the dark. Something shifts on the tallest one, then settles.', look: 'stones', face: 'stones', act: 'gaze' },
      { text: 'Twice a year I count the owls. Nobody asked me to. Nobody reads the numbers. Nine years now.' },
      { text: 'Last year, four. The year before, three. The year before that, one very tired owl I\'m fairly sure I counted twice.' },
      { text: 'There. On the tall stone. See the ears?', look: 'sky' },
    ],
    choice: { prompt: 'Fern holds her breath.', options: [
      { label: 'Hoot, softly.', reply: [
        { who: 'aside', text: 'You hoot. A pause. Out of the dark, something hoots back. Then another. Then a third.', emote: 'note' },
        { text: '…That\'s five. That\'s FIVE. Don\'t move. Don\'t breathe.', face: 'you', look: 'them', emote: 'bang' },
      ] },
      { label: 'Stay very still.', reply: [
        { who: 'aside', text: 'You stay still. One by one, round faces turn toward you from the tops of the stones.' },
        { text: 'Five. Five! They\'re letting you watch. They don\'t let anyone watch.', face: 'you', look: 'them', emote: 'sparkle' },
      ] },
    ] },
    after: [
      { text: 'Lantern up, just for a second. I want to remember this.', snap: true, act: 'stand' },
      { text: 'Best count in nine years. I\'m writing your name next to it.', emote: 'heart' },
    ],
    keepsake: { kind: 'photo', caption: 'Counting owls with Fern at the standing stones' },
  }),
  ev({
    id: 'fern-2', who: 'villager:fern', n: 2, hearts: 5, title: 'Page one', places: ['signpost', 'glasshouse'], hours: [16.2, 18.8],
    when: 'at the signpost, late in the afternoon', teaser: 'Fern\'s notebook has a first page she has never shown anyone.',
    record: 'Fern showed you the first page of her notebook, written by Rowan.',
    beats: [
      { text: 'You\'ve been using my notebook. Don\'t look like that, I can tell. You fold the corners.', face: 'you', look: 'them' },
      { text: 'Want to see the first page of mine? The real one. Not the copy.' },
      { who: 'aside', text: 'Fern takes a battered notebook from her rucksack, its cloth cover worn through to the board. The first page isn\'t in her writing.', act: 'almanac' },
      { text: '"Rule one: write down what you see, not what you expected to see." That\'s Rowan. Rowan wrote the first page and handed me the rest.' },
      { text: 'We walked every path in the valley when I was small. Rowan knew every bird by its cough. Mapped the stones, named half the paths. I just keep them tidy.' },
    ],
    choice: { prompt: 'She runs a thumb down the page.', options: [
      { label: 'Where\'s Rowan now?', reply: [
        { text: 'Out there somewhere. Rowan was never good at staying in one valley.', look: 'ahead', face: 'ahead' },
        { text: 'Sends a feather sometimes. No note. Just a feather. That\'s how I know.', face: 'you', look: 'them', emote: 'heart' },
      ] },
      { label: 'What\'s rule two?', reply: [
        { text: '"Rule two: if you\'re lost, sit down. The valley will come and find you."' },
        { text: 'It works. Mostly. Once it was a goose that came, which wasn\'t ideal.', emote: 'sweat' },
      ] },
    ] },
    after: [
      { text: 'I\'ll copy you a page. Rule one\'s the important one. The rest are mostly about geese.', act: 'almanac' },
    ],
    keepsake: { kind: 'letter', title: 'A page from Fern\'s notebook', body:
      'Copied out for you, in pencil, from the first page of Fern\'s notebook:\n\nRule one: write down what you see, not what you expected to see.\nRule two: if you\'re lost, sit down. The valley will come and find you.\nRule three: geese are not the valley. Do not sit down near geese.\nRule four: always leave a path a little better than you found it.\n\nUnderneath, in Fern\'s own hand: You already do number four. I\'ve been watching.\n\nF.\n\n(A small grey feather is tucked into the fold.)' },
  }),
  ev({
    id: 'fern-3', who: 'villager:fern', n: 3, hearts: 7, title: 'Behind the falls', places: ['falls'], hours: [9, 16.4],
    when: 'at the waterfall pool, on her rounds', teaser: 'Fern stops at the waterfall on her rounds and looks at it like a closed door.',
    record: 'Fern told you about Rowan and the waterfall. You have Rowan\'s lantern crook.',
    beats: [
      { who: 'aside', text: 'Fern is at the edge of the pool, looking up at the waterfall the way some people look at a closed door.', look: 'waterfall', face: 'waterfall', act: 'gaze' },
      { text: 'Rowan left on the last evening train, the year the halt closed. Said there was more to see. Said there was something behind the falls, too, and I said don\'t be daft, it\'s rock.' },
      { text: 'We had a proper row about it. Rowan said I never looked properly at anything I thought I already knew.', face: 'you', look: 'them' },
      { text: 'And then you went and found it, didn\'t you. The cave. The journal.', if: 'grotto' },
      { who: 'aside', text: 'She isn\'t looking at you. She\'s smiling at the water.', if: 'grotto', face: 'waterfall' },
      { text: '"Fern was wrong, and I intend to tell her so at length." Ha! Rowan always did love being right.', if: 'grotto', emote: 'note' },
      { text: 'Nine years and I\'ve never checked. Funny, isn\'t it. The ranger who won\'t look behind one waterfall.', unless: 'grotto' },
      { text: 'Maybe you should. You look properly at things.', unless: 'grotto', emote: 'question' },
    ],
    choice: { prompt: 'The falls keep up their roar.', options: [
      { label: 'Rowan would be proud of you.', reply: [
        { text: 'Rowan would tell me my bootlaces were undone.', face: 'you', look: 'them' },
        { who: 'aside', text: 'You both look. They are.' },
        { text: '…See? Never wrong. Infuriating.', emote: 'heart' },
      ] },
      { label: 'You kept every path open.', reply: [
        { text: 'I did, didn\'t I. For whoever came along.', face: 'you', look: 'them' },
        { text: 'Turned out it was you.', emote: 'heart' },
      ] },
    ] },
    after: [
      { text: 'Here. Rowan\'s old lantern crook. I\'ve carried it on every night walk for nine years. I think it wants a door to stand by. Yours.', act: 'cheer', emote: 'sparkle', face: 'you', look: 'them' },
      { text: 'Then I\'ll always be able to find your house in the dark.' },
    ],
    keepsake: { kind: 'decor', id: 'crook', name: 'Rowan\'s lantern crook' },
  }),

  // ------------------------------------------------------------------------------------------------ Nimbus
  ev({
    id: 'nimbus-1', who: 'villager:nimbus', n: 1, hearts: 3, title: 'Cloud names', places: ['dock'], hours: [10.8, 12.8],
    when: 'having breakfast on the dock, late morning', teaser: 'Nimbus has names for things. Mostly for things that float.',
    record: 'You named a cloud with Nimbus.',
    beats: [
      { text: 'Quick! Look up. That one, coming over the ridge. It doesn\'t have a name yet.', look: 'sky', face: 'ahead', act: 'gaze', emote: 'bang' },
      { text: 'I name them all. Well. All the good ones. Three hundred and twelve this year. That one over the mill is Margaret. Margaret is having a difficult week.' },
      { text: 'You can name this one. It\'s an honour. Don\'t waste it on something sensible.', face: 'you', look: 'them' },
    ],
    choice: { prompt: 'The cloud drifts closer, waiting.', options: [
      { label: 'Gerald.', reply: [
        { text: 'Gerald\'s taken. Gerald is Hazel\'s wisp. There\'d be confusion. There\'d be paperwork.', emote: 'sweat' },
        { text: 'Gerald the Second. Fine. Gerald the Second it is.', look: 'sky', emote: 'note' },
      ] },
      { label: 'Biscuit.', reply: [
        { text: 'Biscuit is the dog. The dog would be thrilled.' },
        { text: '…Cloud Biscuit. Yes. He\'s very round. Look at him go.', look: 'sky', emote: 'heart' },
      ] },
      { label: 'Name it after you.', reply: [
        { text: 'After me? A cloud called Nimbus?', emote: 'question' },
        { who: 'aside', text: 'Nimbus goes quiet, then faintly pink round the edges.' },
        { text: 'That\'s like calling a cat "Cat". Nobody\'s ever… all right. Nimbus the cloud. Hello, me.', look: 'sky', emote: 'heart' },
      ] },
    ] },
    after: [
      { text: 'Stand there, you and the cloud both. For the log.', face: 'you', look: 'them', act: 'wave', snap: true },
    ],
    keepsake: { kind: 'photo', caption: 'Naming a cloud with Nimbus on the dock' },
  }),
  ev({
    id: 'nimbus-2', who: 'villager:nimbus', n: 2, hearts: 5, title: 'Wrong once', places: ['knoll'], hours: [16.8, 18.8],
    when: 'on the stargazers\' knoll, before dusk', teaser: 'Nimbus\'s forecasts are never wrong. Nearly never. There was one time.',
    record: 'Nimbus told you about the one forecast they ever got wrong: the storm that brought them here.',
    beats: [
      { who: 'aside', text: 'Nimbus is tapping a brass barometer. Tap. Tap. Tap.', act: 'inspect', look: 'them' },
      { text: 'Twenty-two years of forecasts. Wrong once.', face: 'you' },
      { text: 'Once! I\'d chased a storm three valleys over. The biggest I\'d ever charted. The pressure was falling off the bottom of the dial.' },
      { text: 'I reached the top of that ridge just as it was due to break.', look: 'ahead', face: 'ahead', act: 'gaze' },
      { text: 'And it was clear. Perfectly clear. Warm. A windmill turning, a postmaster waving, and somebody shipping a crate of turnips.' },
      { text: 'I sat down on this knoll to work out where I\'d gone wrong. That was eleven years ago. I\'m still working on it.', face: 'you', look: 'them', emote: 'thought' },
    ],
    choice: { prompt: 'Tap. Tap.', options: [
      { label: 'Maybe it wasn\'t wrong.', reply: [
        { text: 'Mm. Pressure falling. Change on the way.' },
        { text: 'I suppose it was right after all. Just about the wrong thing.', emote: 'heart' },
      ] },
      { label: 'Do you miss chasing storms?', reply: [
        { text: 'Sometimes. When the wind gets up of an evening I still put the cape on.' },
        { text: 'Then I remember there\'s cocoa, and a knoll, and people who wave. Storms don\'t wave.', emote: 'note' },
      ] },
    ] },
    after: [
      { text: 'I\'ll send you page one of my log. Don\'t show the Mayor. She\'ll want it framed.', act: 'almanac' },
    ],
    keepsake: { kind: 'letter', title: 'Nimbus\'s weather log, page one', body:
      'WEATHER LOG, PAGE ONE (copied out fair by Nimbus)\n\nDay 1. Pressure falling hard. Storm due 18:00, the big one. Ran for the ridge.\n18:00. No storm. Clear sky. A valley underneath it. Windmill turning (wind W, light). One crate of turnips leaving (??).\n18:20. A postmaster offered me a sandwich.\n19:00. Stayed for the sunset. For science.\nDay 2. Stayed.\nDay 3. Stayed.\n\nNote, added much later in different ink: forecast wrong. Outcome excellent. Recommend.\n\nN.' },
  }),
  ev({
    id: 'nimbus-3', who: 'villager:nimbus', n: 3, hearts: 7, title: 'The comet', places: ['knoll', 'observatory'], hours: [20.6, 1.3],
    when: 'stargazing, late at night', teaser: 'Nimbus keeps checking an old notebook and the northern sky. Something is due.',
    record: 'You saw the eleven-year comet with Nimbus. You have their orrery.',
    beats: [
      { text: 'You came! Good. Sit. Look north, just over the ridge. No, your other north.', face: 'you', look: 'them', emote: 'bang' },
      { who: 'aside', text: 'The observatory\'s dome stands open above you, the big telescope trained on a patch of sky that looks entirely empty.', if: 'restored:observatory', look: 'project:observatory' },
      { text: 'The old stargazer who built the observatory left a notebook. One prediction in it, underlined three times. A comet, every eleven years, low over the north ridge, for one week.', act: 'almanac' },
      { text: 'Eleven years ago I was halfway up a hill chasing the wrong storm, and I missed it.' },
      { text: 'Wait. There. THERE. See the smudge? Like somebody breathed on the glass?', look: 'sky', face: 'ahead', act: 'stargaze', emote: 'sparkle' },
      { who: 'aside', text: 'Low over the ridge, very faint, there is a smear of pale light with a tail, as if the sky has been signed.' },
    ],
    choice: { prompt: 'Neither of you says anything for a while.', options: [
      { label: 'It\'s beautiful.', reply: [
        { text: 'It is, isn\'t it. Eleven years, and it came back exactly when it said it would.' },
        { text: 'Some things do.', face: 'you', look: 'them', emote: 'heart' },
      ] },
      { label: 'Make a wish.', reply: [
        { text: 'On a comet? That\'s not proper meteorology.' },
        { who: 'aside', text: 'Nimbus shuts their eyes anyway, for a long time.' },
        { text: '…Don\'t ask. It\'s against the rules. Also, it already came true. Mostly.', face: 'you', look: 'them', emote: 'heart' },
      ] },
    ] },
    after: [
      { text: 'I made you something, so you can find it again in eleven years, even if I\'m not here to tell you. I will be. But just in case.', act: 'cheer', emote: 'star' },
    ],
    keepsake: { kind: 'decor', id: 'orrery', name: 'Nimbus\'s orrery' },
  }),
]);

const BY_ID = new Map(HEART_EVENTS.map((e) => [e.id, e]));
export const heartEvent = (id: string): HeartEvent | undefined => BY_ID.get(id);
const norm = (who: string): string => (who.startsWith('villager:') ? who : `villager:${who}`);
export const eventsOf = (who: string): HeartEvent[] => HEART_EVENTS.filter((e) => e.who === norm(who)).sort((a, b) => a.n - b.n);

// ---------------------------------------------------------------------------------------------------------------
// The record (persisted)

export interface HeartLetter { id: string; at: number; from: string; fromName: string; title: string; body: string }
export interface HeartsData {
  v: 1;
  /** events that happened: when, on what day, which option you chose, whether the photo was kept */
  seen: Record<string, { at: number; day: string; choice: number; photo?: boolean }>;
  /** the day of the last event (one a day across the valley) */
  last: string;
  /** "not now": an event you stepped away from waits until this time (ms) */
  later: Record<string, number>;
  /** letters they sent (the mailbox shows them again after a reload) */
  letters: HeartLetter[];
}
export const emptyHearts = (): HeartsData => ({ v: 1, seen: {}, last: '', later: {}, letters: [] });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tolerant parse of stored data (unknown events dropped; anything malformed → null). */
export function parseHearts(raw: unknown): HeartsData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const d = emptyHearts();
  if (o.seen && typeof o.seen === 'object') {
    for (const [id, v] of Object.entries(o.seen as Record<string, unknown>)) {
      const e = BY_ID.get(id);
      if (!e || !v || typeof v !== 'object') continue;
      const x = v as Record<string, unknown>;
      const at = typeof x.at === 'number' && Number.isFinite(x.at) ? x.at : 0;
      const day = typeof x.day === 'string' && DAY_RE.test(x.day) ? x.day : '';
      const choice = typeof x.choice === 'number' && Number.isInteger(x.choice) && x.choice >= 0 && x.choice < e.choice.options.length ? x.choice : 0;
      d.seen[id] = { at, day, choice, ...(x.photo === true ? { photo: true } : {}) };
    }
  }
  if (typeof o.last === 'string' && DAY_RE.test(o.last)) d.last = o.last;
  if (o.later && typeof o.later === 'object') for (const [id, v] of Object.entries(o.later as Record<string, unknown>)) if (BY_ID.has(id) && typeof v === 'number' && Number.isFinite(v)) d.later[id] = v;
  if (Array.isArray(o.letters)) for (const l of o.letters.slice(-30)) {
    if (!l || typeof l !== 'object') continue;
    const x = l as Record<string, unknown>;
    if (typeof x.id === 'string' && typeof x.at === 'number' && typeof x.from === 'string' && typeof x.fromName === 'string' && typeof x.title === 'string' && typeof x.body === 'string') {
      d.letters.push({ id: x.id, at: x.at, from: x.from, fromName: x.fromName, title: x.title, body: x.body });
    }
  }
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// When

/** Is `hour` inside [from, to) (wrapping past midnight when from > to)? */
export const inHours = (h: readonly [number, number], hour: number): boolean => (h[0] <= h[1] ? hour >= h[0] && hour < h[1] : hour >= h[0] || hour < h[1]);

/** A villager's next event: the first unseen one in their story, once you have the hearts (null: none, or not yet). */
export function nextEvent(d: HeartsData, who: string, hearts: number): HeartEvent | null {
  for (const e of eventsOf(who)) {
    if (d.seen[e.id]) continue;
    return hearts >= e.hearts ? e : null;
  }
  return null;
}

export interface DueAsk {
  hearts: number;
  /** where their routine has them right now (model/routines.ts) */
  place: string;
  hour: number;
  nowMs: number;
}
/** Is a scene due right now with this villager? (Their next event; at its place and hour; one a day; not put off.) */
export function dueEvent(d: HeartsData, who: string, a: DueAsk): HeartEvent | null {
  const e = nextEvent(d, who, a.hearts);
  if (!e) return null;
  if (d.last === dayKey(a.nowMs)) return null;
  if ((d.later[e.id] ?? 0) > a.nowMs) return null;
  if (!(e.places as readonly string[]).includes(a.place) || !inHours(e.hours, a.hour)) return null;
  return e;
}

/** The flags a scene's lines check: the caller's world flags plus every choice already made ('choice:posy-1=0'). */
export function flagsOf(d: HeartsData, world: Iterable<string> = []): Set<string> {
  const s = new Set(world);
  for (const [id, v] of Object.entries(d.seen)) s.add(`choice:${id}=${v.choice}`);
  return s;
}
const on = (b: Beat, flags: ReadonlySet<string>): boolean => (!b.if || flags.has(b.if)) && (!b.unless || !flags.has(b.unless));

/** The lines to play: before the choice (choice = null), or the reply to option `choice` and the closing lines. */
export function scriptOf(e: HeartEvent, flags: ReadonlySet<string>, choice: number | null): Beat[] {
  if (choice === null) return e.beats.filter((b) => on(b, flags));
  const opt = e.choice.options[Math.max(0, Math.min(e.choice.options.length - 1, choice))];
  return [...opt.reply, ...e.after].filter((b) => on(b, flags));
}

/** The keepsake letter's text for the option chosen. */
export function letterBody(k: Extract<Keepsake, { kind: 'letter' }>, choice: number): string {
  return typeof k.body === 'string' ? k.body : k.body[Math.max(0, Math.min(k.body.length - 1, choice))];
}

/** One line on what a keepsake is ("a photo for the album", "a letter: …", "Posy's dovecote for your yard"). */
export function keepsakeText(k: Keepsake): string {
  return k.kind === 'photo' ? 'a photo for your album' : k.kind === 'letter' ? `a letter: ${k.title}` : `${k.name}, for your yard`;
}

// ---------------------------------------------------------------------------------------------------------------
// Views (the notebook, the friends card)

export interface HeartsView {
  total: number;
  seen: number;
  /** per villager: what happened, and what's next */
  people: { who: HeartWho; done: { id: string; title: string; record: string; day: string }[]; next: { id: string; hearts: number; title: string; when: string; teaser: string; ready: boolean } | null }[];
}
export function heartsView(d: HeartsData, hearts: (who: string) => number): HeartsView {
  const whos = [...new Set(HEART_EVENTS.map((e) => e.who))];
  return {
    total: HEART_EVENTS.length,
    seen: HEART_EVENTS.filter((e) => d.seen[e.id]).length,
    people: whos.map((who) => {
      const evs = eventsOf(who);
      const done = evs.filter((e) => d.seen[e.id]).map((e) => ({ id: e.id, title: e.title, record: e.record, day: d.seen[e.id].day }));
      const nx = evs.find((e) => !d.seen[e.id]);
      return { who, done, next: nx ? { id: nx.id, hearts: nx.hearts, title: nx.title, when: nx.when, teaser: nx.teaser, ready: hearts(who) >= nx.hearts } : null };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The live service: the scene in progress (the HUD shows it, scene/villagers stages it)

export interface HeartsStore { load(): unknown; save(d: HeartsData): void }
export interface HeartsPorts {
  now?: () => number;
  /** friendship hearts with a villager (model/friends.ts) */
  hearts?: (who: string) => number;
  /** world flags for conditional lines: 'grotto', 'restored:<project>' … */
  flags?: () => Iterable<string>;
  /** keepsakes: post a letter, give a decor piece, keep the photo (resolves true when it was kept) */
  post?: (l: HeartLetter) => void;
  gift?: (decorId: string) => void;
  snap?: (e: HeartEvent) => Promise<boolean> | boolean;
}

export interface HeartScene {
  event: HeartEvent;
  /** the lines now playing (before the choice, or after it) */
  lines: readonly Beat[];
  /** index into `lines` */
  i: number;
  /** 'talk': a line is showing; 'choose': the options are up; 'done': it's over (the keepsake is on its way) */
  phase: 'talk' | 'choose' | 'done';
  choice: number | null;
  /** bumps on every step (the scene and the HUD watch it) */
  step: number;
}

export type HeartsChange =
  | { kind: 'begin'; scene: HeartScene }
  | { kind: 'step'; scene: HeartScene }
  | { kind: 'done'; event: HeartEvent; choice: number; keepsake: Keepsake }
  | { kind: 'later'; event: HeartEvent }
  | { kind: 'dev' };

export interface HeartsService {
  readonly version: number;
  data(): Readonly<HeartsData>;
  /** the scene in progress, if any */
  current(): HeartScene | null;
  /** what's next with this villager (null: nothing yet), and whether it's due right now at their place */
  next(who: string): HeartEvent | null;
  due(who: string, place: string, hour: number): HeartEvent | null;
  /** start a scene now (normally because you talked to them when it was due) */
  begin(id: string): HeartScene | null;
  /** the next line (or the choice, or the end) */
  advance(): void;
  choose(k: number): void;
  /** step away: it waits (`LATER_MS`) and plays next time */
  leave(): void;
  view(): HeartsView;
  onChange(fn: (c: HeartsChange) => void): () => void;
  /** dev: forget events (one, or all) */
  devReset(id?: string): void;
}

/** an event you step away from waits this long */
export const LATER_MS = 10 * 60_000;

export function createHearts(st: HeartsStore | undefined, o: HeartsPorts = {}): HeartsService {
  const now = o.now ?? Date.now;
  const hearts = (who: string) => { try { return o.hearts?.(norm(who)) ?? 0; } catch { return 0; } };
  let d: HeartsData;
  try { d = parseHearts(st?.load()) ?? emptyHearts(); } catch { d = emptyHearts(); }
  let version = 0;
  let cur: HeartScene | null = null;
  const fns = new Set<(c: HeartsChange) => void>();
  const save = () => { version++; try { st?.save(d); } catch (err) { console.warn('[hearts] save failed', err); } };
  const emit = (c: HeartsChange) => { for (const f of [...fns]) { try { f(c); } catch (err) { console.error('[hearts] listener threw', err); } } };
  const flags = () => { let w: Iterable<string> = []; try { w = o.flags?.() ?? []; } catch { /* optional */ } return flagsOf(d, w); };
  let snapped = false;

  const finish = () => {
    if (!cur) return;
    const e = cur.event, choice = cur.choice ?? 0;
    cur.phase = 'done'; cur.step++;
    const at = now(), day = dayKey(at);
    d.seen[e.id] = { at, day, choice };
    d.last = day;
    delete d.later[e.id];
    const k = e.keepsake;
    if (k.kind === 'letter') {
      const fromName = k.from ?? (e.who.slice(9, 10).toUpperCase() + e.who.slice(10));
      const l: HeartLetter = { id: `heart:${e.id}`, at, from: e.who, fromName, title: k.title, body: letterBody(k, choice) };
      if (!d.letters.some((x) => x.id === l.id)) d.letters.push(l);
      if (d.letters.length > 30) d.letters.splice(0, d.letters.length - 30);
      try { o.post?.(l); } catch (err) { console.warn('[hearts] post', err); }
    } else if (k.kind === 'decor') {
      try { o.gift?.(k.id); } catch (err) { console.warn('[hearts] gift', err); }
    } else if (!snapped) takePhoto(e);
    if (pendingPhoto.delete(e.id)) d.seen[e.id].photo = true;
    save();
    const done = cur;
    cur = null;
    emit({ kind: 'step', scene: done });
    emit({ kind: 'done', event: e, choice, keepsake: k });
  };
  /** the keepsake photo: taken on the line marked `snap` (or at the end); flagged once the album keeps it */
  const pendingPhoto = new Set<string>();
  const takePhoto = (e: HeartEvent) => {
    snapped = true;
    const kept = () => { const s = d.seen[e.id]; if (s) { s.photo = true; save(); } else pendingPhoto.add(e.id); };
    try { void Promise.resolve(o.snap?.(e) ?? false).then((ok) => { if (ok) kept(); }, () => {}); } catch (err) { console.warn('[hearts] snap', err); }
  };
  const settleLine = () => {
    const b = cur?.lines[cur.i];
    if (cur && b?.snap && cur.event.keepsake.kind === 'photo' && !snapped) takePhoto(cur.event);
  };

  return {
    get version() { return version; },
    data: () => d,
    current: () => cur,
    next: (who) => nextEvent(d, who, hearts(who)),
    due: (who, place, hour) => (cur ? null : dueEvent(d, who, { hearts: hearts(who), place, hour, nowMs: now() })),
    begin(id) {
      const e = BY_ID.get(id);
      if (!e || cur) return cur;
      snapped = false;
      const lines = scriptOf(e, flags(), null);
      cur = { event: e, lines, i: 0, phase: lines.length ? 'talk' : 'choose', choice: null, step: 0 };
      emit({ kind: 'begin', scene: cur });
      settleLine();
      return cur;
    },
    advance() {
      if (!cur || cur.phase !== 'talk') return;
      if (cur.i < cur.lines.length - 1) { cur.i++; cur.step++; settleLine(); emit({ kind: 'step', scene: cur }); return; }
      if (cur.choice === null) { cur.phase = 'choose'; cur.step++; emit({ kind: 'step', scene: cur }); return; }
      finish();
    },
    choose(k) {
      if (!cur || cur.phase !== 'choose') return;
      const n = cur.event.choice.options.length;
      if (!Number.isInteger(k) || k < 0 || k >= n) return;
      cur.choice = k;
      cur.lines = scriptOf(cur.event, flags(), k);
      cur.i = 0; cur.phase = cur.lines.length ? 'talk' : 'done'; cur.step++;
      if (cur.phase === 'done') { finish(); return; }
      settleLine();
      emit({ kind: 'step', scene: cur });
    },
    leave() {
      if (!cur) return;
      const e = cur.event;
      d.later[e.id] = now() + LATER_MS;
      cur = null;
      save();
      emit({ kind: 'later', event: e });
    },
    view: () => heartsView(d, hearts),
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devReset(id) {
      if (id) { delete d.seen[id]; delete d.later[id]; d.letters = d.letters.filter((l) => l.id !== `heart:${id}`); }
      else d = emptyHearts();
      d.last = '';
      cur = null;
      save();
      emit({ kind: 'dev' });
    },
  };
}
