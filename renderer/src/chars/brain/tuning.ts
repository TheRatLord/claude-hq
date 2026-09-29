// @pure
/**
 * Brain timings and tables (DESIGN §6.4, §6.4.1, §6.5, §6.7). Every behavioural number lives here. Owner: BRN.
 * Times: `*S` are local animation seconds (ctx.time, scaled); `*Ms` are server-clock ages (ctx.now − statusSince).
 */

export const TUNING = Object.freeze({
  hysteresisS: 1.5, // §6.4: a new status must persist this long before the actor re-targets (→ working: immediate)
  // [BRN M3.5] §6.9 player verbs (Q pat, R summon), the answered sprint (§6.8.1) and the prompt work call (§6.4.2)
  summonCooldownS: 30, // §6.9: R per agent
  summonSpeed: 1.9, // a keen skip over to the player
  summonGapM: 1.7, // stands this far from the player ([BRN fix m3-r2] 1.4 → 1.7: never closer than attendMinR)
  summonStayS: 6, // §6.9: waves, returns after this
  summonMaxS: 25, // gives up (back to its ladder / the Pit) if it could not get there by then
  verbLookS: 2.2, // a working / blocked agent's glance at the player (shh, busy finger, pointing at its ticket)
  patWakeS: 10, // Q on a sleeper: a sneeze, awake this long
  answeredDashSpeed: 3.2, // §6.8.1 answered: back to the desk at a CHR `dash` (was the 2.0 m/s scurry)
  answeredDashS: 25, // the dash flag lapses after this (the status never left blocked, or it never got home)
  thanksS: 2.4, // the 'thanks!' bubble after an answer
  postGigTags: ['bunk', 'amenity', 'caf'], // a done agent back from a scene: an outing to the least visited of these
  promptCallS: 15, // prompt.sent: the work call runs this long ahead of the status flip (then the ladder again)
  // [BRN fix m2-fix1] walk-up attention (fun review: agents walked away mid-interaction, so G missed): the player within
  // attendR aiming at an idle / done agent for attendAimS → it pauses its outing, turns to the player and waves; it
  // resumes attendReleaseS after the aim leaves. Cosmetic (§6.9): any status change ends it on the same frame.
  attendR: 2.5,
  attendAimS: 0.4,
  attendReleaseS: 3,

  // Speeds (m/s).
  walkSpeed: 0.9, // amble (idle picks, returning home)
  doneWalkSpeed: 2.0, // done → the Pit: a happy skip, not an amble ([BRN fix m2-fix1] 1.5 → 2.0: less time on the way)
  scurrySpeed: 2.0, // working commutes, blocked → queue, unblock return
  workCallSpeed: 2.8, // idle/done → working while away (§6.4.2)
  // [BRN fix r1] a long work call (a parcel run to the Mailroom, a receipt in the Archive) dashes: the scurry speeds up
  // so the whole leg home takes ≤ workCallBudgetS, never slower than workCallSpeed nor faster than workCallDashMax.
  // Keeps the §6.4.2 p90 ≤ 8 s budget on every seed (the parcel run is not roaming-capped).
  workCallBudgetS: 6.4,
  workCallDashMax: 4.6,
  wanderSpeed: 0.55, // unknown ghosts, sleepwalk-ish

  // blocked (§6.4 table)
  blockedChairMs: 10_000, // stands on its chair waving, then goes to the queue
  rainCloudMs: 5 * 60_000,
  bellTapS: 20,
  queueTurn: 0.6, // queue actors turn this share of the way from the counter toward the room (≈ 3/4 view)
  queueCycleS: 7, // queue loop: wave "hey!" for queueWaveS, then hold the hand up (foot-tap, watch-check)
  queueWaveS: 3,
  // (the queue glance period was meant to be `lookBackS: 5.5` here, but the Pit look-back below defines the same key and has
  // always won: brain.ts's queue glance runs on the 1.2 s value. Kept as shipped; split the keys to restore the 5.5 s cadence.)
  lookBackHoldS: 1.6,

  // done (§6.4 table)
  doneVictoryMs: 4_000, // stays at the desk for the victory, then the sofa
  doneNapMs: 30 * 60_000,
  waveRadius: 4, // done agents wave at the player within this range
  waveCooldownS: 25,
  cheerS: [6, 11], // done agents standing on the lounge rug (sofa full): a clap / hop every …

  // idle ladder (§6.4.1)
  // [BRN fix m2-r1] 2 min → 45 s (gameplay review m2: in `mixed` idle stretches last 15–150 s, so the chill list never
  // showed and the storefronts / café / library stayed empty; §6.4.1 proposal in the WP summary)
  idleDeskMs: 45_000,
  idleChillMs: 10 * 60_000,
  chillPickS: [20, 60],
  napS: [180, 360],
  hobbyS: [120, 240],
  // [BRN fix m2-r1] long-idle stagger (§6.4.1 10–60 min): every long-idle agent runs one shared nap / hobby cycle of this
  // period, offset by its rank k / n (director.idleRank), hobby share max(0.4, min(0.55, 1/n + 0.08)) → nap 3.4–4.5 min,
  // hobby 3–4.1 min, and with ≥ 2 long-idle agents one of them is always on a hobby
  idleCycleS: 450,
  napDeskShare: 0.35, // of naps: head on the desk (was 0.6); the rest: bay nap spot / Pit beanbag / Nap Nook bunk
  napLibShare: 0.4, // [BRN fix m2-r3] … of the non-desk naps while the Library is empty: a reading chair there
  hobbyLibShare: 0.3, // [BRN fix m2-r3] … of the 10–60 min hobby picks while the Library is empty: a reading chair
  napPitShare: 0.35, // … of the non-desk naps: a Pit beanbag or sofa (the atrium is not a still life)
  dustMs: [60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000],

  // desk liveliness (not in DESIGN: pure feel; M1 "lively")
  fidgetS: [5, 14], // seated idle: a fidget every …
  glanceS: [3.5, 9], // look at a neighbour / around every …
  glanceHoldS: [0.9, 2.2],
  workGlanceS: [9, 22], // working agents glance up less often
  playerLookRadius: 3.2, // ART §5.3: player within 3 m and in front has look priority
  playerNoticeRadius: 6,
  bumpRadius: 0.66, // [PLY fix r2] player r 0.28 + soft actor r 0.32 (player/tuning.ts) + slack: fires on contact
  personalR: 1.5, // [BRN fix m3-r2] the player's personal space: no seat / spot / Pit place is newly taken within this (feet or step-in point)
  attendMinR: 1.6,
  // [BRN fix m3-r2] the sign-off celebration (brain celebOverlay): after G, hold in frame facing the player until the ack
  // commits (≤ celebWaitS), then the hop + '✓ thanks!' beat (celebS); an inbox sign-off's bow-and-wave (celebThanksS);
  // the parcel run then first steps exitAwayM straight away from a player within exitAwayR
  celebHi5S: 2.0, celebWaitS: 6, celebS: 1.8, celebThanksS: 2.3, exitAwayM: 2.6, exitAwayR: 10,
  // [BRN fix m3-r3] Talk (T): the listener faces the player from listenMinR–listenMaxR (walks up to listenGapM when farther,
  // within listenComeR); after a send it nods for listenNodS, then the plane catch / work-call dash
  listenMinR: 1.6, listenMaxR: 3.0, listenGapM: 2.2, listenComeR: 12, listenNodS: 0.75, listenMaxS: 600,
  // [BRN fix m3-r3] inbox zero (bus 'inbox.zero'): every free agent within zeroR of the player / the Pit cheers, staggered
  // over zeroStaggerS, holding its place for zeroCheerS; the just-answered agent victory-skips home
  zeroR: 15, zeroStaggerS: 0.3, zeroCheerS: 1.8, zeroAnsweredS: 10,
  celebMuteS: 12, // … and walk-up attention leaves it be this long (the player's aim must not pin it after the payoff)
  // [BRN fix m3-r2] the Pit's look-back-and-wave: a lounger with the player within lookBackR glances round and waves
  lookBackR: 12, lookBackEveryS: [16, 24], lookBackS: 1.2, // [BRN fix m3-r2] walk-up attention / summon: the agent stops at least this far from the player (fun review m3-r2: 0.4 m)
  // [BRN fix m3-r3] (art + fun review m3-r3: walkers still crossed the lens 0.8–2 m off) 1.2 → 1.5 = personalR
  avoidR: 1.5, // walkers sidestep so they pass at least this far from the player's centre (camera near plane)
  stopShortR: 1.2, // a standing destination (a spot, a queue place) this close to the player: arrive where it stands
  avoidHardR: 0.75, // … and when they can't sidestep, re-plan / wait only if the line passes closer than this
  avoidAheadM: 2.8, // … starting when the player is this far ahead on the walking line
  departClearR: 1.1, // a walk's first metres never pass the player closer than this (unless walking away from them)…
  avoidNearM: 6, // … checked over the whole walk when the player is this close to the walker; else route around them, else hold until they clear
  passMinR: 0.9, // mid-walk: a remaining path passing the player closer than this re-plans around them, else waits (no squeezing)
  aroundR: 0.85, // routeAround: the player as a nav obstacle of this radius (then 0.45 if that leaves no way)
  // [BRN fix m3-r3] the player's personal space as a SOFT path cost (fun review m3-r3: a claude passed a seated camera
  // at 0.8 m, moss crossed pitOverview's lower right at 2 m): a planned walk prefers the route that keeps personalR
  // (routeAround tries personalR → aroundR → 0.45); each metre it cuts into personalR costs personalCostK metres of
  // walk, so a long detour loses to a short brush past (and passMinR / departClearR stay the hard floors)
  personalCostK: 14,
  personalReplanS: 1.0, // mid-walk: re-plan a walk that will cut into personalR at most this often
  // [BRN fix m3-r3] stall watchdog (playtest m3-r3: ledger and claude·2 stood 8–20 s jammed in the library doorway, lumen
  // 20 s on its way to roundtable:3): a walker that has not made stallMoveM of progress for stallRepathS re-plans round
  // whoever blocks it; after stallSqueezeS it squeezes past bodies and stops waiting on the player; at stallMaxS it
  // pushes through along its path for stallPushS (walls still win; the player's playerMinD circle still holds)
  stallMoveM: 0.3, stallRepathS: 1.2, stallSqueezeS: 2.0, stallMaxS: 3.0, stallPushS: 1.5,
  holdRelaxS: 2.5, // holding that long for a player who stays put: accept a first leg that passes them at passMinR
  holdWaveS: 3.5, // holding for the player: an "after you!" wave this often
  playerMinD: 0.62, // a walker never steps closer than this to the player (actor 0.32 + player 0.28 soft radii)
  // [BRN fix m175-r2] crowd avoidance (play review: walkers clipped seated hot-desk agents and each other in the Pit)
  crowdStaticR: 0.62, // a walker keeps this far (centre to centre) from a standing / seated agent (bodies ~0.3 + slack)
  crowdPassR: 0.56, // … and from another walker (each side-steps / is pushed half the overlap)
  crowdLookM: 1.5, // side-step starts this far ahead on the walking line
  crowdNearK: 0.6, // … × the radius for agents settled right next to where the walk ends / begins (a brush, ~0.37 m)
  crowdSqueeze: 0.62, // a jammed walker squeezes past at this × the radii (a shoulder brush, ~0.35 m) for a moment
  crowdYieldS: 1.6,
  slideGapS: 1.5, // slide riders go one at a time, this far apart (they used to land on top of each other)
  queueShuffleS: 1.4, // the help queue moves up a place this long after the head leaves (it walks out first) // head-on in a gap nobody can side-step: the lower-priority walker waits up to this long
  avoidWaitS: 3, // no way around the player (they block an aisle): wait this long, then squeeze past
  excuseR: 1.5, // a walker passing within this range looks at the player ("excuse me")
  bumpCooldownS: 2.5,
  socialRadius: 5.5, // neighbours react to a status-change event within this range
  socialLookS: 2.6,
  swivelMax: 1.1, // rad; seated idle actors swivel their chair toward what they look at
  idleSwivel: 0.5, // rad; idle-at-desk lazy chair swivel amplitude (leaning back, hands behind the head)
  idleSwivelHz: 0.07,
  chatS: [7, 14], // visit a neighbour's desk and chat

  // shells (§6.4.1 Shelly ladder, proto: at its desk)
  shellPocketMs: [5 * 60_000, 10 * 60_000],
  shellDozeMs: 30 * 60_000,
  // [BRN fix m2-r3] 30–90 → 25–50 s (gameplay review m2-r3: ENG froze in longIdle, P3 'nothing static for 60 s')
  shellPickS: [25, 50], // pocket mode: a pick every … (hq: racks / boiler gauge / fern / glass lap / bench toys / doze)
  shellDozeShare: 0.35, // ≥ shellDozeMs: share of pocket picks that are a doze at the bench (was: dozing for good)
  // [BRN fix m2-r3] in-stay variety (gameplay review m2-r3: long-idle agents kept one slot + one activity for 140 s+):
  // settled at a pick / gig / regular spot, the activity changes every stayBeatS — the spot's own activity, then a
  // variant (read, doodle, sip, stretch, a chat with a neighbour, petting the cat), then back; naps stir (a yawning
  // stretch for stirS, or a roll between the curled and the sprawled pose)
  stayBeatS: [30, 58],
  stirS: 6.5,
  catPetR: 1.7, // m: Segfault this close to a standing idle agent → a cat-pet beat
  cardsMin: 2, // pocket Shellys needed for the ENG card game

  // full office (M1.5, §6.4.1 roaming cap, §6.5 stations)
  roamCapM: 25, // a chill / hobby pick is eligible only if its path from the desk is ≤ this …
  roamWeightM: 10, // … and its weight is × 1 / (1 + d / roamWeightM)
  // [BRN fix r2] outings (gameplay review r2: with ≤ 3 workspaces the Café, the Nap Nook, the War Room and the W bays
  // were over the cap from every E desk: 0 visits in 10 min). Long idle (≥ outingIdleMs) and the hobby tier may pick
  // an outing tag up to outingCapM away at outingWeight × its weight; done agents lounging in the Pit take one short
  // outing (a cocoa refill at the Café, a peek at an amenity bay, a bounce on the Nap Nook bunks) and come back.
  outingCapM: 40,
  outingIdleMs: 3 * 60_000,
  outingWeight: 0.4,
  napBunkShare: 0.25, // of nap-spot naps: the Nap Nook's proper bunks (outing cap) instead of the bay's own nap spot
  // [BRN fix m2-r1] done agents lounge at the Café and on the street benches too (gameplay review m2): more, longer
  // outings (≈ 1/3 of a done stay away from the Pit seat, which stays held)
  // [BRN fix m2-fix1] (art + fun review m2: the Pit sofas held 0–1 loungers while the HUD showed 3 done; done agents
  // spent 13–18 % of their done time in the Pit) the Pit is a done agent's default rest: outings only after a long sit
  // (40–80 s), fewer and shorter, and only while at least pitKeep other done agents stay lounging in the Pit
  doneOutingShare: 0.4, // of done (unacked) stays that take an outing …
  doneOutingAtMs: [40_000, 80_000], // … starting at this done age …
  doneOutingS: [20, 35], // … for this long, then back to the Pit seat (held for it) …
  doneCocoaShare: 0.75, // … the first outing of a stay: a cocoa refill at the Café this share of the time, else the street
  doneOutingEveryS: 120, // … and again every this often while the stay lasts (each seeded by doneOutingShare)
  pitKeep: 2, // a done agent leaves its Pit seat (outing, stint, rally, post-scene outing) only if this many others stay
  slideDroughtMs: 2 * 60_000, // [BRN fix m2-r1] nobody has headed for the slide this long: a done outing favours it (× 6)
  slideBackShare: 0.5, // returning from the mezzanine to level 0 takes the slide this share of the time
  slideTrotSpeed: 2.2, // [BRN fix m2-r1] 1.8 → 2.2: done agents' slide outings start in the Pit, 34 m from the mouth
  // // [BRN fix r1] the skip up to the slide mouth (was 1.17: laps rarely finished before the next prompt)
  slideHangS: [3, 6], // after a slide ride: a happy beat at the exit before walking home
  sleepwalkShare: 0.1, // of naps (§6.4.1): eyes shut, arms forward, a ≤ 10 m loop at 0.4 m/s
  sleepwalkSpeed: 0.4,
  sleepwalkS: [45, 80],
  parcelHoldS: 1.4, // at the OUTBOX chute: drop the parcel (flap + ding), then home
  receiptShare: 0.5, // [BRN fix m2-r1] 0.5 → 0.6 (done outings start parcel runs further out); [BRN fix m2-fix1] → 0.5
  // // … then file the receipt in the Archive drawers next door (NE quadrant alive, §6.5)
  lapShare: 0.3, // [BRN fix m2-fix1] 0.4 → 0.3 (the showcase rooms want the freshly idle agents back sooner) … or a victory lap: stairs up, the slide home (vertical traffic from honest idle time)
  lapAfterReceiptShare: 0.4, // [BRN fix m2-fix1] 0.75 → 0.4; … and after filing the receipt, this share takes the lap too (the stairs are next door)
  socialR: 2.3, // two idle agents settled at social spots this close chat
  highFiveR: 2.6, // a done agent arriving in the Pit high-fives a seated done agent this close

  seatY: 0.32, // chair seat height (CHR §6.1 toy scale): standing on the chair while freshly blocked
  approachBack: 0.6, // m behind a chair where a walker steps in/out
  arriveEps: 0.04,
  leaveS: 0.7, // dissolveOut duration before an actor is removed
  // [BRN M3.5] §6.4.3 spectacular arrivals / departures (post-boot only): a parcel crate at the lobby hiring anchor —
  // it drops in, rattles, the lid pops and the sides fall open (CHR `unwrap`), a wave, then the walk to the slot; a
  // closed pane walks to the front door, turns and waves goodbye, then dissolves
  crateDropS: 0.35, crateUnwrapS: 1.25, crateWaveS: 1.8, crateWalkS: 2.7, crateFadeS: [4.2, 4.8],
  crateNextS: 4.4, crateQueueMaxS: 9, // one crate on the pad at a time; a longer queue (a burst of panes) cold-places
  leaveWalkSpeed: 2.6, leaveWalkMaxS: 14, leaveWaveS: 1.2,
  rekeyWaitS: 3, // an actor whose entity vanished waits this long for its re-key
});

/** §6.5 class → desk activity (CHR activity ids, §6.3). */
export const CLS_ACTIVITY: Readonly<Record<string, string | undefined>> = Object.freeze({
  edit: 'pencilEdit',
  write: 'typeFrenzy',
  read: 'readBook',
  search: 'grepMagnify',
  bash: 'bashPound',
  test: 'bashPound',
  build: 'bashPound',
  git: 'stampEnvelope',
  net: 'bashPound',
  web: 'dishWeb',
  task: 'delegate',
  todo: 'clipboard',
  think: 'think',
  mcp: 'phoneMcp',
  compact: 'compactBackpack',
  ask: 'ask',
  talk: 'type',
  other: 'type',
});

/** §6.7 Shelly table: process.activity → activity. */
export const SHELL_ACTIVITY: Readonly<Record<string, string | undefined>> = Object.freeze({
  prompt: 'cursorTap',
  edit: 'knit',
  test: 'juggle',
  serve: 'crank',
  monitor: 'newspaper',
  remote: 'walkie',
  repl: 'cocktail',
  git: 'sortEnvelopes',
  build: 'shovel',
  run: 'spinnerWatch',
});

/** Face per class while working (ART §5.3). */
export const CLS_FACE: Readonly<Record<string, string | undefined>> = Object.freeze({
  write: 'determined', bash: 'determined', test: 'determined', build: 'determined', think: 'neutral',
  task: 'determined', compact: 'determined', ask: 'worried',
});

/** Event → own reaction (DESIGN §6.7, GP §3.1 reactions table). `fx` = burst at the actor. */
export const EVENT_REACTION: Readonly<Record<string, { react: string | null; fx: string | null } | undefined>> = Object.freeze({
  blocked: { react: 'startle', fx: null },
  unblocked: { react: 'unblock', fx: 'sparkle' },
  finished: { react: 'victory', fx: 'confetti' },
  error: { react: 'dizzy', fx: 'smoke' },
  'test-pass': { react: 'fistPump', fx: 'sparkle' },
  'test-fail': { react: 'slump', fx: null },
  commit: { react: 'hop', fx: 'capsule' },
  'subagent-spawned': { react: 'clap', fx: 'sparkle' },
  compact: { react: null, fx: 'poof' },
  acked: { react: 'thankYou', fx: 'sparkle' },
  struggle: { react: null, fx: null },
  arrived: { react: 'arrive', fx: 'sparkle' },
  left: { react: 'leave', fx: null },
});

/** Event on a neighbour → how bystanders react (ART §6.7 fun layer). `idleOnly`: working agents only look. */
export const SOCIAL_REACTION: Readonly<Record<string, { react: string | null; face: string; chance: number } | undefined>> = Object.freeze({
  blocked: { react: 'startle', face: 'surprised', chance: 0.35 },
  finished: { react: 'clap', face: 'happy', chance: 0.8 },
  error: { react: null, face: 'worried', chance: 0 },
  'test-pass': { react: 'clap', face: 'happy', chance: 0.4 },
  'test-fail': { react: null, face: 'worried', chance: 0 },
  arrived: { react: 'wave', face: 'happy', chance: 0.9 },
  unblocked: { react: 'hop', face: 'happy', chance: 0.3 },
  acked: { react: 'clap', face: 'happy', chance: 0.5 },
  // [BRN M3.5] cheer the ship: bystanders look over (social.ts cheer() plays the claps)
  ship: { react: null, face: 'happy', chance: 0 },
  commit: { react: null, face: 'happy', chance: 0 },
});

/** Seated-idle fidgets (ART §5.5 favoriteFidget list; CHR `fidget:<name>`). */
export const FIDGETS: readonly string[] = Object.freeze([
  'stretch', 'hopInPlace', 'lookAround', 'danceShimmy', 'yoyo', 'jugglePebbles', 'spin', 'polishAccessory',
]);

/** Chill-list pick activities by spot tag (§6.4.1); only tags the layout actually has are used. */
export const SPOT_ACTIVITY: Readonly<Record<string, string | undefined>> = Object.freeze({
  window: 'windowGaze',
  coffee: 'coffee',
  plant: 'waterPlants',
  plants: 'waterPlants',
  arcade: 'arcade',
  fish: 'fishStare',
  sofa: 'lounge',
  beanbag: 'lounge',
  library: 'libraryRead',
});

/** §6.5 station → activity at a sit / stand slot (CHR ids). */
export const STATION_ACTIVITY: Readonly<Record<string, { sit?: string; stand?: string } | undefined>> = Object.freeze({
  library: { sit: 'readBook', stand: 'ladder' }, lab: { stand: 'labPour' }, war: { stand: 'whiteboard' },
  phones: { stand: 'walkPhone' }, mail: { stand: 'mailSort' }, observatory: { stand: 'telescope' }, roundtable: { sit: 'roundTable' },
});
/** §6.5 walking variants: the arms keep doing the tool on a working commute (honest: this is still work). */
export const WALK_ACTIVITY: Readonly<Record<string, string | undefined>> = Object.freeze({
  read: 'walkRead', search: 'walkMagnify', test: 'walkFlask', build: 'walkFlask', todo: 'walkClipboard', mcp: 'walkPhone',
});
/** Full-office chill list (§6.4.1 weights before bias; `cafe` / `chat` / `stroll` are extras). */
export const CHILL_WEIGHTS_HQ: Readonly<Record<string, number>> = Object.freeze({
  // [BRN fix m2-r1] biased toward coffee, amenity bays, library browse and the street (gameplay review m2): 3/3/2 → 4/4/3,
  // + street 3.5 (storefront window-shopping, street benches)
  // [BRN fix m2-fix1] (fun review m2: big rooms empty for long stretches) the Café and the Pit's lounge seats lead; the
  // far street and bays follow: street 3.5 → 1.2, + caf 5, pitLounge 4, libRead 2
  coffee: 4, arcade: 2, pingpong: 2, foosball: 1, plant: 1, window: 1, library: 3, fish: 1, amenity: 2.5, slide: 3,
  telescope: 1.5, hotdesk: 1.5, microfiche: 1, filing: 1, cafe: 2, chat: 1.5, stroll: 0.5, street: 1.2, lab: 1.5,
  caf: 5, pitLounge: 4, libRead: 2,
});
/** Hobby list (10–60 min, §6.4.1) + the favourite spot. */
export const HOBBY_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({ amenity: 2, boardGame: 1.5, telescope: 1.5, stargaze: 1, archive: 1, vaultNap: 1, street: 1, library: 1.5, coffee: 1, lab: 1, caf: 3, pitLounge: 3, libRead: 1.5 });
/** Outing tags (§6.4.1 + [BRN fix r2]): beyond the roaming cap, up to `outingCapM`, weights before `outingWeight`. */
// [BRN fix m2-fix1] the Café and the Pit first (caf 3 → 6, + pitLounge 5), the far street and the bunks last (1.5 → 0.6)
export const OUTING_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({ caf: 6, pitLounge: 5, amenity: 2, arcade: 1, pingpong: 1, foosball: 0.5, bunk: 0.6, fish: 0.5, street: 0.6 });
/** Done agents' Pit outing (weights; the pick must be within `outingCapM` of the Pit seat). */
export const DONE_OUTING_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({ caf: 6, street: 1.5, amenity: 1.5, slide: 2.5, bunk: 1.5, arcade: 0.5 });
/** Pick tag / amenity → activity (spot pose decides sit vs stand where both exist). */
export const PICK_ACTIVITY: Readonly<Record<string, string | Partial<Record<'sit' | 'stand' | 'lie', string>> | undefined>> = Object.freeze({
  coffee: 'coffee', arcade: 'arcade', pingpong: 'pingpong', foosball: 'foosball', fish: 'fishStare', library: 'libraryRead',
  cafe: 'lounge', caf: { sit: 'lounge', stand: 'coffee' }, libRead: { sit: 'lounge', stand: 'libraryRead' }, pitLounge: 'lounge', street: { sit: 'lounge', stand: 'windowGaze' }, streetBench: 'lounge', lab: 'fishStare', microfiche: 'microfiche', filing: 'fileNook', telescope: 'telescopeGaze', hotdesk: 'hotDeskDoodle',
  boardGame: 'boardGame', stargaze: 'lounge', archive: 'fileNook', vaultNap: 'vaultNap', window: 'windowGaze',
  plant: 'waterPlants', fern: 'waterPlants', cards: 'boardGame', rack: 'radio', gauge: 'radio', glass: 'windowGaze',
  slide: 'standLounge', outbox: 'mailSort', bunk: { lie: 'lounge', sit: 'lounge', stand: 'standLounge' },
  // amenity bays (§7.2)
  musicRoom: { sit: 'piano', stand: 'standLounge' }, gym: { stand: 'treadmill', lie: 'lounge' }, greenhouse: 'waterGreenhouse',
  gameRoom: { sit: 'boardGame', lie: 'lounge' }, artStudio: 'paint', napLounge: { lie: 'hammock' },
});
/** Social spots: two idle agents settled at these within `socialR` chat (glyph bubbles, face each other). */
export const SOCIAL_TAGS = new Set(['coffee', 'cafe', 'caf', 'street', 'pingpong', 'foosball', 'arcade', 'cards', 'amenity', 'boardGame', 'window', 'slide', 'pitLounge']);

/**
 * [BRN fix m2-r3] In-stay variety menus (activity → weight; the spot's own activity is left out). Seated: a cocoa
 * lounge, upright look-about with the big stretch, yo-yo, pebble juggling, polishing the accessory, a chair shimmy.
 * Standing: a mug of coffee, clipboard doodle, a book, the hands-behind-the-head stretch. Shelly at its bench: toys.
 */
export const SIT_VARIETY: Readonly<Record<string, number>> = Object.freeze({ lounge: 1.3, sitIdle: 1, 'fidget:yoyo': 1, 'fidget:jugglePebbles': 1, 'fidget:polishAccessory': 0.6, 'fidget:danceShimmy': 0.5 });
export const STAND_VARIETY: Readonly<Record<string, number>> = Object.freeze({ coffee: 1.2, hotDeskDoodle: 1, libraryRead: 1, standLounge: 0.8 });
export const SHELL_TOYS: Readonly<Record<string, number>> = Object.freeze({ juggle: 1.2, spinnerWatch: 1, newspaper: 0.7, cursorTap: 0.8 });
/** base activities the variety layer never touches (a rally / match partner keeps playing; the queue; rides) */
export const NO_VARIETY = new Set(['pingpong', 'foosball', 'slideRide', 'sleepwalk']);

/** Chill weights (§6.4.1, before favoriteSpot bias); `chat` and `stroll` are proto-room extras. */
export const CHILL_WEIGHTS: Readonly<Record<string, number | undefined>> = Object.freeze({
  window: 1, coffee: 3, plant: 1, plants: 1, arcade: 2, fish: 1, sofa: 2, beanbag: 2, library: 2, chat: 2.5, stroll: 1,
});

/**
 * Office-wide social moments (brain/social.ts; DESIGN §11.5 "lively ambient"): ping-pong rallies with an audience,
 * pod-mate high-fives on `finished`, the Pit's stadium-wave clap, Big Board huddles, coffee / water-cooler invites.
 * Honest by construction: only idle agents (never working / blocked / done-pinned ones) are ever pulled away, and any
 * status change drops the gig on the same frame (the brain only runs gigs from its idle branch).
 */
export const SOCIAL = Object.freeze({
  minIdleMs: 30_000, // audience / huddle / partner gigs only for agents idle at least this long (fresh idle stays put)
  // ping-pong (§6.4.1 chill pick "ping-pong pair"): a lone player invites a partner, the pair rallies
  inviteR: 18, // m (straight line): a free idle agent this close may be invited (partner, coffee)
  inviteEveryS: 25, // a lone player / coffee drinker asks again at most this often
  partnerChance: 0.75,
  rallyHalfS: 0.8, // one crossing of the table (the pair's shared swing clock is 2× this)
  rallyHits: [5, 13], // crossings before somebody misses (seeded per point)
  rallyServeS: 1.6, // the missed ball rolls away; the serve comes after this
  rallyGigS: [25, 35], // an invited partner plays this long (then back to its own idle ladder; < 60 s: P3 stillness)
  // [BRN M3.5] rally floor (ideation GD #2): ≥ 2 castable agents within rallyR of the table → a rally within rallyDelayS
  rallyR: 12,
  rallyDelayS: [3, 14], // (+ rallyCooldownS after the last rally ≤ 90 s: 'a rally within 90 s')
  rallyWantHoldS: 30,
  rallyCooldownS: 75,
  rallyDroughtS: 120, // [BRN fix m2-fix1] no rally this long: a rally may borrow the Pit down to one lounger
  rallyMinIdleMs: 8_000, // a partner / spectator must have been idle this long (the fresh-idle desk read comes first)
  rallyWalkSpeed: 1.6,
  keepRegular: ['CAF', 'LIB'], // a rally never borrows these showcase regulars (the dwell floor)
  // the audience
  watchR: 14, // m: idle agents this close may come and watch a rally
  watchMax: 3,
  watchEveryS: 5, // how often the rally looks for one more spectator
  watchChance: 0.55,
  watchS: [25, 45],
  clapChance: 0.75, // spectators clap a point
  // high-five on done (ART §6.7 fun layer: "a pod-mate glances and claps" → comes over for a high-five)
  congratsR: 5.5, // m from the done agent's desk (straight line) …
  congratsPathM: 6.5, // … and at most this far to walk (a desk row between two close desks is a long way round)
  congratsChance: 0.85,
  congratsSpeed: 1.8, // a brisk trot: the done agent is at its desk for only ~4 s (TUNING.doneVictoryMs)
  congratsS: 7,
  // the Pit welcome wave (a done agent sits down: the others clap in turn around the ring)
  waveStaggerS: 0.15,
  // Big Board huddle (something finished → idle agents gather at the Pit rim, look up at the Board, point, chat)
  huddleR: 16, // m from the Pit centre
  huddleMax: 3,
  huddleMin: 2, // a huddle needs at least this many free agents (one alone just glances)
  huddleChance: 0.7, // (unused since M3.5: every `finished` huddles, huddleFinishedCooldownS apart)
  huddleFinishedCooldownS: 30,
  huddleFinishedMinIdleMs: 5_000,
  huddleFinisherS: 17, // the finisher's own huddle: its desk victory, the walk over, a look up, then its Pit seat (its outings wait)
  // [BRN M3.5] high-fives in passing (a done agent walking past an awake idle / done colleague) and cheering the ship
  passFiveR: 1.7,
  passCooldownS: 40,
  cheerR: 7,
  cheerMax: 3,
  huddleCooldownS: 50,
  huddleAmbientS: [100, 170], // … and now and then without news, while ≥ huddleMin agents are free
  huddleS: [13, 20],
  rimR: 4.45, // m: standing ring just outside the Pit's top step (r 4.0)
  // coffee / water-cooler: a lone coffee drinker waves a desk-idle colleague over
  coffeeChance: 0.5,
  coffeeGigS: [25, 40],
  // [BRN fix m2-r2] showcase-room regulars (gameplay/art review m2-r2: the best-dressed rooms were empty on camera): a
  // dwell floor — while agents are free, one idle 'regular' is parked in each showcase room nobody else is using, in
  // this priority order (a zone listed twice wants two; `zones` = several zones counted as one room; tag = the pick tag the regular claims; view = the keepClearView whose frame it sits in: the
  // claim starts from the best-framed spot of the tag). Rotated: a stint is regularS long; the next regular
  // is cast regularHandoverS before it ends, so the room is never left empty while the two swap.
  regularRooms: [
    // [BRN fix m2-fix1] the Pit wants two (art review m2: 'sofa loungers' had none; done loungers count toward both).
    // `core` rooms are cast first, in this order, outside the regularShare cap: the Café, the Pit, the Library, the Pit's
    // second (the done agents fill the Pit most of the time; the Library's regular keeps its south seats in use)
    { zone: 'CAF', tag: 'caf', view: 'cafe', core: true }, { zone: 'PIT', tag: 'pitLounge', view: 'pitOverview', core: true },
    { zone: 'LIB', tag: 'libRead', view: 'library', core: true }, { zone: 'PIT', tag: 'pitLounge', view: 'pitOverview', core: true },
  ],
  // [BRN fix m3-r2] the night hearth (art review m3-r2: 0–1 Clawds round the 22h campfire, the Café / Library / Lab /
  // mezz all empty): after dark (nightHours: from [0] to [1] o'clock) the casting fills the Pit first — three loungers
  // (done ones count) — then one Café and one Library sitter, all core (outside the regularShare cap); the Pit keeps
  // pitKeepNight loungers (done agents' outings wait for a fourth)
  nightHours: [18.5, 6],
  pitKeepNight: 3,
  regularNightS: [180, 360], // an idle agent's stint at the night hearth
  regularRoomsNight: [
    { zone: 'PIT', tag: 'pitLounge', view: 'pitOverview', core: true }, { zone: 'PIT', tag: 'pitLounge', view: 'pitOverview', core: true },
    { zone: 'PIT', tag: 'pitLounge', view: 'pitOverview', core: true }, { zone: 'CAF', tag: 'caf', view: 'cafe', core: true },
    { zone: 'LIB', tag: 'libRead', view: 'library', core: true },
  ],
  // … plus one touring showcase at a time (regularTourS each, in turn): the street, a lit amenity storefront, the Lab,
  // the Round Table, the Nap Nook — so a regular also passes through the quieter rooms (and their ladders keep theirs)
  regularTour: [
    { zone: 'STR', tag: 'street', view: 'street' }, { zone: 'W', zones: ['W1', 'W2', 'W3'], tag: 'amenity', view: 'street' },
    { zone: 'LAB', tag: 'lab', view: 'lab' }, { zone: 'MEZ', tag: 'boardGame', view: 'mezz' }, { zone: 'NAP', tag: 'bunk' },
  ],
  regularTourS: 110, // ([BRN fix m2-fix1] unused: the tour now visits the room unvisited longest)
  tourDroughtS: 200, // [BRN fix m2-fix1] a tour room unvisited this long is cast before the Library
  roomBookS: 25, // [BRN fix m2-fix1] an empty showcase room one agent is heading for is not offered to another for this long
  tourStarveS: 400, // [BRN fix m2-fix1] … and this long: it may borrow a done lounger while the Pit keeps one
  regularShare: 0.6, // at most ceil(share × free idle agents) regulars at once (the rest keep their own idle ladder)
  regularDeskCapM: 34, // [BRN M3.5] an idle regular's desk is at most this far (path) from the room (a work call home ≈ ≤ 8 s: §6.4.2 p90)
  regularMinIdleMs: 10_000, // a freshly idle agent leans back at its desk this long first (the idle read at the desk)
  regularS: [60, 180], // [BRN fix m2-fix1] 80–150 → 60–180 s (art review: longer sits on the lounge seats)
  regularDoneS: [60, 120], // [BRN fix m2-fix1] 40–70 → 60–120 s (art review: longer sits on the lounge seats) // a done agent's stint (the Pit's own outings — bunks, the slide, the bays — keep their turn)
  regularHandoverS: 50, // (a walk from the far E bays to the Café is ~35 m)
  regularRestS: 120, // an agent back from a stint is not recast for this long (unless nobody else is free): its own
  // idle ladder (the slide, the bays, the Nap Nook, the Archive) gets its turn
  regularExtendMax: 2, // [BRN fix m2-fix1] 1 → 2 // with nobody to take over, a stint is extended (by regularS[0]) at most this often
  regularSpeed: 2.1, // [BRN fix m2-fix1] 1.45 → 2.1 (a keen trot): a room is covered sooner (a walk from the far bays is ~35 m)
  // rooms that may borrow the Pit's only done lounger for a stint (then it rests in the Pit); with several empty, the
  // one empty longest × weight goes first (the review's targets: the Café ≥ 50 %, the Library ≥ 30 % of the time)
  regularBorrowPit: { CAF: 1.6, LIB: 1 },
  // [BRN fix m2-fix1] cameo scheduler (fun review m2: the Café had no Clawd for 24 s, the E2 bay was empty for 15 s):
  // the zone the player's camera is in, empty of settled agents for cameoAfterS, gets one visitor — a free idle agent
  // (desk ≤ regularDeskCapM), a touring regular, a done agent out on an outing or a spare Pit lounger — who trots over
  // (cameoSpeed) to the zone's pick tag (first of cameoTags with a spot there) and stays cameoS (the Pit wants pitKeep).
  cameoAfterS: 2.5,
  cameoS: [45, 80],
  cameoSpeed: 2.1,
  cameoMinIdleMs: 4_000,
  cameoCoolS: 6, // a zone with no free spot is not re-tried for this long
  cameoPlayerR: 2.6, // … and preferably not a spot this close to the player
  cameoClaimM: 1.5, // the cameo's claim is for its chosen spot (path from it): never a spot in the next room
  cameoTags: ['caf', 'pitLounge', 'libRead', 'boardGame', 'lab', 'street', 'streetBench', 'amenity', 'bunk', 'outbox', 'filing', 'archive', 'coffee', 'arcade', 'window', 'plant'],
  cameoSkipZones: ['ENG'], // the Engine Room belongs to the Shellys
});
