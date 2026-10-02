// @pure
/**
 * The first-run welcome and the valley's one-time tips (HUD: hud/onboarding.ts; wired in main.ts).
 *
 *  - **The welcome**: on a browser profile's first visit Posy the postmaster hands you a letter (what the valley is),
 *    then a short checklist that teaches by doing. Every step is ticked by a real signal the HUD / main already see
 *    (`OnbSignal`): the camera turned, the player walked, a villager chat, a terminal opened, a needs-you ask answered,
 *    the map, the ledger, and one pastime (pick something up, cast a line or step into the farmhouse). Steps tick in
 *    any order; the widget points at the first one still open. The answer step is skipped when nobody needs you at
 *    the moment it comes up (it still ticks if you answer later). Finishing pays `WELCOME_BITS`, gives the
 *    `WELCOME_DECOR` piece for the yard and posts Posy's letter (`welcomeLetter`) once.
 *  - **Tips**: contextual one-time hints (`HINTS`), queued by triggers (the first blocked farmer, the first rain,
 *    the first night, the first find in your basket) and shown at most one every `HINT_GAP_MS`, never while the HUD
 *    says it is busy (typing in a terminal, a big panel). Each is dismissable; `hints.off` turns them all off.
 *
 * Pure: no DOM; the clock and the store are injected (browser-local storage in the app, memory in tests).
 */

export type StepId = 'look' | 'walk' | 'talk' | 'terminal' | 'answer' | 'map' | 'ledger' | 'pastime';
export type OnbSignal = Exclude<StepId, 'pastime'> | 'forage' | 'fish' | 'farmhouse';
export type Pastime = 'forage' | 'fish' | 'farmhouse';
export type HintId = 'blocked' | 'rain' | 'night' | 'basket';

export interface StepDef {
  id: StepId;
  /** the checklist line */
  title: string;
  /** keys shown beside it */
  keys: readonly string[];
  /** a short how-to under the current step */
  how: string;
  /** a gentle "when you have a moment" step (shown last, a little apart) */
  extra?: boolean;
}

export const STEPS: readonly StepDef[] = Object.freeze([
  { id: 'look', title: 'Look around', keys: ['Click', 'Mouse'], how: 'Click the valley to take the mouse, then move it to look about.' },
  { id: 'walk', title: 'Take a stroll', keys: ['W', 'A', 'S', 'D'], how: 'Walk a few steps; Shift to hurry along.' },
  { id: 'talk', title: 'Say hello to a villager', keys: ['E'], how: 'Walk up to anyone with a green signboard (Posy is by the mailbox) and press E.' },
  { id: 'terminal', title: "Open a farmer's terminal", keys: ['F'], how: 'Face a farmer and press F, or use the terminal button on the dock (top right).' },
  { id: 'answer', title: 'Answer someone who needs you', keys: ['Alt+1'], how: 'A golden ! means a farmer is waiting on you: pick an answer on their card (top left).' },
  { id: 'map', title: 'Open the map', keys: ['M'], how: 'Every farmer, field and villager; click a pin to jump to its terminal.' },
  { id: 'ledger', title: 'Check the farm ledger', keys: ['Tab'], how: 'Everyone at a glance; type to filter, Enter opens a terminal.' },
  { id: 'pastime', title: 'When you have a moment: a pastime', keys: ['E'], how: 'Pick up something that glints, cast a line at the pond (E by the water), or step into the farmhouse.', extra: true },
] as StepDef[]);

export const PASTIMES: readonly { id: Pastime; label: string }[] = Object.freeze([
  { id: 'forage', label: 'pick something up' }, { id: 'fish', label: 'cast a line' }, { id: 'farmhouse', label: 'visit the farmhouse' },
]);

/** what finishing the welcome pays, and the yard piece it gives (model/shop.ts) */
export const WELCOME_BITS = 50;
export const WELCOME_DECOR = 'welcome';

export interface HintDef { id: HintId; text: string; sub: string }
export const HINTS: readonly HintDef[] = Object.freeze([
  { id: 'blocked', text: 'Someone needs you!', sub: 'Press Alt+1 to answer the first ask from anywhere (J opens the mailbox).' },
  { id: 'rain', text: 'It\'s raining', sub: 'Fish bite better in the rain, and the thunder bass only comes up in a downpour.' },
  { id: 'night', text: 'Night is falling', sub: 'Lamps light the roads; look up for shooting stars, and listen for the owl at the standing stones.' },
  { id: 'basket', text: 'Something for your basket', sub: 'Sell your finds to Bram at the shipping bin or the General store, or give one to a villager (F).' },
] as HintDef[]);
/** at most one tip this often */
export const HINT_GAP_MS = 4 * 60_000;
/** quiet time after the welcome closes before the first tip */
export const HINT_SETTLE_MS = 45_000;

export type StepState = 'done' | 'skipped';

export interface OnboardingData {
  v: 1;
  /** the welcome letter was shown (and closed) on this profile */
  welcomed: boolean;
  /** the checklist is running (welcomed, not finished, not dismissed) */
  active: boolean;
  /** the checklist was closed early (replayable from the pause menu) */
  dismissed: boolean;
  /** folded to its header */
  folded: boolean;
  steps: Partial<Record<StepId, StepState>>;
  pastimes: Partial<Record<Pastime, boolean>>;
  /** all steps done and the reward given (once per profile, even across replays) */
  rewarded: boolean;
  /** ms epoch the welcome letter was closed */
  at: number;
  /** Posy's welcome letter, kept so main can re-post it to the mailbox on load */
  letter: WelcomeLetter | null;
  hints: { off: boolean; seen: HintId[]; last: number };
}

export interface WelcomeLetter { id: string; at: number; from: string; title: string; body: string }

export const emptyOnboarding = (): OnboardingData => ({
  v: 1, welcomed: false, active: false, dismissed: false, folded: false, steps: {}, pastimes: {}, rewarded: false, at: 0, letter: null,
  hints: { off: false, seen: [], last: 0 },
});

const STEP_IDS = new Set<string>(STEPS.map((s) => s.id));
const HINT_IDS = new Set<string>(HINTS.map((x) => x.id));
const PAST_IDS = new Set<string>(PASTIMES.map((p) => p.id));
const bool = (v: unknown) => v === true;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Tolerant parse of stored data (anything malformed → null; unknown ids dropped). */
export function parseOnboarding(raw: unknown): OnboardingData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const steps: OnboardingData['steps'] = {};
  if (o.steps && typeof o.steps === 'object') for (const [k, v] of Object.entries(o.steps as Record<string, unknown>)) if (STEP_IDS.has(k) && (v === 'done' || v === 'skipped')) steps[k as StepId] = v;
  const pastimes: OnboardingData['pastimes'] = {};
  if (o.pastimes && typeof o.pastimes === 'object') for (const [k, v] of Object.entries(o.pastimes as Record<string, unknown>)) if (PAST_IDS.has(k) && v === true) pastimes[k as Pastime] = true;
  const h = (o.hints ?? {}) as Record<string, unknown>;
  const l = o.letter as Record<string, unknown> | null | undefined;
  const letter = l && typeof l === 'object' && typeof l.id === 'string' && typeof l.title === 'string' && typeof l.body === 'string'
    ? { id: l.id, at: num(l.at), from: typeof l.from === 'string' ? l.from : 'villager:posy', title: l.title, body: l.body } : null;
  return {
    v: 1, welcomed: bool(o.welcomed), active: bool(o.active), dismissed: bool(o.dismissed), folded: bool(o.folded), steps, pastimes,
    rewarded: bool(o.rewarded), at: num(o.at), letter,
    hints: { off: bool(h.off), seen: Array.isArray(h.seen) ? (h.seen.filter((x) => typeof x === 'string' && HINT_IDS.has(x)) as HintId[]) : [], last: num(h.last) },
  };
}

// ---------------------------------------------------------------------------------------------
// The checklist

export const stepDef = (id: StepId): StepDef | undefined => STEPS.find((s) => s.id === id);
export const stepDone = (d: OnboardingData, id: StepId): boolean => !!d.steps[id];
export const allDone = (d: OnboardingData): boolean => STEPS.every((s) => stepDone(d, s.id));

/** progress for the widget header: steps ticked (done or skipped) of all */
export function progress(d: OnboardingData): { done: number; total: number } {
  return { done: STEPS.filter((s) => stepDone(d, s.id)).length, total: STEPS.length };
}

/** the step the widget points at: the first one still open (null when all are ticked) */
export function nextStep(d: OnboardingData): StepDef | null {
  return STEPS.find((s) => !stepDone(d, s.id)) ?? null;
}

/** What the world looks like right now, for skipping steps that can't be done (nobody needs you). */
export interface OnbWorld { asks: number }

/**
 * A real signal arrived (a key, a panel, a find…). Ticks its step; returns the step that changed (null = nothing new).
 * Signals count only while the checklist runs, so a replay starts clean and a finished tour stays quiet.
 */
export function signal(d: OnboardingData, s: OnbSignal): StepId | null {
  if (!d.active) return null;
  if (s === 'forage' || s === 'fish' || s === 'farmhouse') {
    const fresh = !d.pastimes[s];
    d.pastimes[s] = true;
    if (d.steps.pastime === 'done') return fresh ? 'pastime' : null;
    d.steps.pastime = 'done';
    return 'pastime';
  }
  if (d.steps[s] === 'done') return null;
  d.steps[s] = 'done';
  return s;
}

/**
 * Skip what can't be done right now: when the answer step is the one the widget points at and nobody needs you, it
 * is skipped (an answer later still ticks it). Returns true when something changed.
 */
export function settle(d: OnboardingData, w: OnbWorld): boolean {
  if (!d.active) return false;
  const n = nextStep(d);
  if (n?.id === 'answer' && w.asks <= 0) { d.steps.answer = 'skipped'; return true; }
  return false;
}

export interface Reward { coins: number; decor: string; letter: WelcomeLetter }

/** Posy's letter for the mailbox when the checklist is done. */
export function welcomeLetter(at: number, skippedAnswer: boolean): WelcomeLetter {
  return {
    id: 'onboarding:welcome', at, from: 'villager:posy', title: 'Welcome home, neighbour!',
    body: [
      'Well, look at you: walking the lanes, chatting with the neighbours, peeking into terminals like you were born here.',
      `I've put ${WELCOME_BITS} bits in your pocket and left a little welcome sign in your yard behind the farmhouse (I to move it about).`,
      skippedAnswer ? 'When a farmer runs to their gate with a golden ! over their head, they need you: Alt+1 answers from anywhere.' : '',
      'Letters like this one land here in the mailbox (J). Whenever you want the tour again, it is in the menu (Esc).',
      'Yours by return of post, Posy',
    ].filter(Boolean).join('\n\n'),
  };
}

/**
 * Everything ticked: close the checklist and, the first time on this profile, hand out the reward. Returns the
 * reward to pay (null when not finished yet or already rewarded).
 */
export function finish(d: OnboardingData, now: number): Reward | null {
  if (!d.active || !allDone(d)) return null;
  d.active = false;
  if (d.rewarded) return null;
  d.rewarded = true;
  d.letter = welcomeLetter(now, d.steps.answer === 'skipped');
  return { coins: WELCOME_BITS, decor: WELCOME_DECOR, letter: d.letter };
}

/** The welcome letter was closed: start the checklist (`skip` = "I know my way": no checklist). */
export function begin(d: OnboardingData, now: number, skip = false): void {
  d.welcomed = true;
  d.at = now;
  d.active = !skip;
  d.dismissed = skip;
  d.hints.last = Math.max(d.hints.last, now - HINT_GAP_MS + HINT_SETTLE_MS);
}

/** Replay from the pause menu: a fresh checklist (the reward stays given; tips already seen stay seen). */
export function replay(d: OnboardingData): void {
  d.steps = {};
  d.pastimes = {};
  d.active = false;
  d.dismissed = false;
  d.folded = false;
}

/** Close the checklist early. */
export function dismiss(d: OnboardingData): void {
  d.active = false;
  d.dismissed = true;
}

/**
 * Should the welcome open on this load? `param` = the `?welcome=` URL param (1 forces a fresh tour, 0 never),
 * `automated` = a test / screenshot browser (navigator.webdriver): tours stay out of their way unless forced.
 */
export function shouldWelcome(d: OnboardingData, o: { param: string | null; automated: boolean }): boolean {
  if (o.param === '0') return false;
  if (o.param === '1') return true;
  if (o.automated) return false;
  return !d.welcomed;
}
/** Are tips on for this load? (off in automated browsers unless the welcome is forced) */
export const tipsAllowed = (o: { param: string | null; automated: boolean }): boolean => o.param !== '0' && (!o.automated || o.param === '1');

// ---------------------------------------------------------------------------------------------
// Tips

export const hintDef = (id: HintId): HintDef | undefined => HINTS.find((x) => x.id === id);

/** The tip to show now from `pending` (in order), or null: tips off, already seen, too soon, or the HUD is busy. */
export function dueHint(d: OnboardingData, pending: readonly HintId[], now: number, busy: boolean): HintDef | null {
  if (d.hints.off || busy || !d.welcomed) return null;
  if (now - d.hints.last < HINT_GAP_MS) return null;
  for (const id of pending) if (!d.hints.seen.includes(id)) return hintDef(id) ?? null;
  return null;
}

/** A tip was shown: it never comes back, and the next waits `HINT_GAP_MS`. */
export function sawHint(d: OnboardingData, id: HintId, now: number): void {
  if (!d.hints.seen.includes(id)) d.hints.seen.push(id);
  d.hints.last = now;
}

// ---------------------------------------------------------------------------------------------
// The live service: data + store + listeners (main.ts creates one; the HUD reads and drives it)

export interface OnboardingStore {
  load(): unknown;
  save(data: OnboardingData): void;
}

export type OnboardingChange =
  | { kind: 'step'; step: StepId; state: StepState }
  | { kind: 'begin' | 'replay' | 'dismiss' | 'fold' | 'prefs' }
  | { kind: 'finish'; reward: Reward | null }
  | { kind: 'hint'; hint: HintDef };

export interface OnboardingPorts {
  now?: () => number;
  /** pay the reward (wallet.reward / wallet.gift) and post the letter (valley.post) */
  pay?(coins: number, why: string): void;
  gift?(decor: string): void;
  post?(l: WelcomeLetter): void;
}

export interface OnboardingService {
  readonly version: number;
  data(): Readonly<OnboardingData>;
  /** this load should open the welcome letter (set by main from the URL / automation / profile) */
  readonly autostart: boolean;
  /** tips are allowed on this load */
  readonly tips: boolean;
  signal(s: OnbSignal): void;
  /** the HUD's 4 Hz look at the world (skip the answer step when nobody needs you) */
  settle(w: OnbWorld): void;
  begin(skip?: boolean): void;
  replay(): void;
  dismiss(): void;
  fold(folded: boolean): void;
  /** queue a tip (once per profile) */
  want(id: HintId): void;
  /** the tip to show now (marks it seen), or null */
  nextHint(busy: boolean): HintDef | null;
  setHintsOff(off: boolean): void;
  onChange(fn: (c: OnboardingChange) => void): () => void;
}

export function createOnboarding(st: OnboardingStore | undefined, o: OnboardingPorts & { autostart?: boolean; tips?: boolean } = {}): OnboardingService {
  const now = o.now ?? Date.now;
  let data: OnboardingData | null = null;
  try { data = parseOnboarding(st?.load()); } catch { data = null; }
  const d = data ?? emptyOnboarding();
  let version = 0;
  const pending: HintId[] = [];
  const tips = o.tips ?? true;
  const fns = new Set<(c: OnboardingChange) => void>();
  const changed = (c: OnboardingChange) => {
    version++;
    try { st?.save(d); } catch (err) { console.warn('[onboarding] save failed', err); }
    for (const f of [...fns]) { try { f(c); } catch (err) { console.error('[onboarding] listener threw', err); } }
  };
  const tryFinish = () => {
    if (!d.active || !allDone(d)) return;
    const r = finish(d, now());
    if (r) {
      try { o.pay?.(r.coins, 'welcome'); o.gift?.(r.decor); o.post?.(r.letter); } catch (err) { console.warn('[onboarding] reward failed', err); }
    }
    changed({ kind: 'finish', reward: r });
  };
  return {
    get version() { return version; },
    data: () => d,
    autostart: !!o.autostart,
    tips,
    signal(s) {
      const step = signal(d, s);
      if (!step) return;
      changed({ kind: 'step', step, state: 'done' });
      tryFinish();
    },
    settle(w) {
      if (!settle(d, w)) return;
      changed({ kind: 'step', step: 'answer', state: 'skipped' });
      tryFinish();
    },
    begin(skip = false) { begin(d, now(), skip); changed({ kind: 'begin' }); },
    replay() { replay(d); changed({ kind: 'replay' }); },
    dismiss() { dismiss(d); changed({ kind: 'dismiss' }); },
    fold(f) { if (d.folded === f) return; d.folded = f; changed({ kind: 'fold' }); },
    want(id) { if (!d.hints.seen.includes(id) && !pending.includes(id)) pending.push(id); },
    nextHint(busy) {
      if (!tips) return null;
      const x = dueHint(d, pending, now(), busy);
      if (!x) return null;
      sawHint(d, x.id, now());
      pending.splice(pending.indexOf(x.id), 1);
      changed({ kind: 'hint', hint: x });
      return x;
    },
    setHintsOff(off) { if (d.hints.off === off) return; d.hints.off = off; changed({ kind: 'prefs' }); },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
}
