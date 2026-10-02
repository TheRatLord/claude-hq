// @pure
/**
 * The valley contract: everything the scene and HUD may know about the agents.
 *
 * Layering: `net/store` (wire) → `farm/model` (this, pure) → `farm/scene` + `farm/hud` (presentation).
 * Presentation never imports the network, and the model never imports three or the DOM. A ValleySource can be the
 * live store, a recording, or a local fake, so the visuals stay detachable from real sessions.
 */
import type { Kind, ModelTier, Status, ToolClass } from '../../../../shared/protocol.ts';
import type { AlmanacView } from './almanac.ts';
import type { FestivalView } from './calendar.ts';
import type { TimelineView } from './timeline.ts';

/** What a farmer is visibly doing. Coarse on purpose: tool churn inside a family never shows as a switch. */
export const JOBS = Object.freeze([
  'plant', // edit/write: kneel in the rows, hoe and sow
  'inspect', // read/search: crouch over crops with a magnifier / read the almanac
  'water', // test: watering can along the rows
  'build', // bash/build/other: hammer fence posts, chop wood
  'haul', // git: carry a crate to the shipping bin
  'fetch', // net/web/mcp: walk to the mailbox / well and back
  'plan', // todo/think: sit on a hay bale with a notebook
  'talk', // assistant text streaming: gesture and chatter at the plot
  'delegate', // subagents running: whistle and direct the ducklings
  'rest', // compact: stretch, yawn, sweep
  'ask', // blocked: needs you. Jump, wave, big "!"
  'done', // finished, waiting for review: proud with a full basket
  'idle', // nothing to do: leisure (wander, fish, pet animals, sit by the fire)
  'away', // status unknown / agent not running: napping in the farmhouse porch hammock
] as const);
export type Job = (typeof JOBS)[number];

/** Jobs that take place in the farmer's own plot (the rest travel somewhere). */
export const PLOT_JOBS: readonly Job[] = Object.freeze(['plant', 'inspect', 'water', 'build', 'talk', 'delegate', 'plan', 'ask', 'done']);

export type Mood = 'happy' | 'focused' | 'stuck' | 'sleepy' | 'proud' | 'worried';

export interface Duckling { id: string; label: string; type: string; active: boolean }

export interface FarmerView {
  /** pane id */
  id: string;
  /**
   * Full display name from the server (herdr agent name → tab label → basename(cwd), `·2` deduped). Can be a long path
   * (live tab labels): HUD panels with room show it as a secondary line / tooltip; never draw it in the 3D world.
   */
  name: string;
  /** project directory name: basename of the entity's project (repo) or cwd. Not unique. */
  project: string;
  /**
   * The in-world name (nameplates, speech bubbles, the interaction prompt, the noticeboard): `project`, unique within
   * the field. Duplicates get a short distinguishing suffix (`claude-hq·flint` when every twin has a clean one-word
   * name, else `claude-hq`, `claude-hq·2`, …). See `worldTags()`.
   */
  tag: string;
  kind: Exclude<Kind, 'shell'>;
  /** stable appearance seed */
  seed: string;
  tier: ModelTier | null;
  /** workspace id: the plot this farmer works */
  plotId: string;
  /** index of this farmer within its plot (work spot) */
  spot: number;
  status: Status;
  /** smoothed, visible job */
  job: Job;
  /** ms epoch (server clock) when `job` was committed */
  jobSince: number;
  /** the raw, unsmoothed job this instant (debug overlay only) */
  rawJob: Job;
  /**
   * tool flavour of the visible job (`stickyTool` in jobs.ts): read vs search inside 'inspect', web vs mcp inside
   * 'fetch', bash vs build inside 'build', think vs todo inside 'plan'; null when none applies. Scene-side variety only.
   */
  tool?: ToolClass | null;
  /** short subject of the current work: a file name, a command, a question */
  detail: string;
  /** task title (what they are working on) */
  title: string | null;
  /** needs the player: blocked and not yet answered */
  needsYou: boolean;
  /** finished and not yet acknowledged */
  unseenDone: boolean;
  /** 0 calm … 3 badly stuck */
  struggle: 0 | 1 | 2 | 3;
  mood: Mood;
  /** 0 = free to chat … 1 = heads down; farmers with busy > 0.6 don't stop to greet the player */
  busy: number;
  ducklings: Duckling[];
  /** last assistant text, ≤ 280 chars */
  said: string | null;
  /** blocked prompt question + option labels (only when needsYou) */
  question: string | null;
  options: { key: string; label: string }[];
  todos: { done: number; total: number; current: string | null } | null;
  work: { added: number; removed: number; files: number } | null;
  /** 0..1 context window fill */
  context: number | null;
  /** ms epoch of the last status/activity change */
  lastActive: number;
}

/** Shell panes: not farmers but farm helpers (a scarecrow with a lantern). */
export interface HelperView {
  id: string;
  /** full display name (may be a long path; HUD panels only) */
  name: string;
  /** project directory name (basename of project / cwd) */
  project: string;
  /** in-world name: `project`, unique among the field's helpers (same rule as FarmerView.tag) */
  tag: string;
  plotId: string;
  spot: number;
  /** what the shell's foreground process is doing */
  activity: 'prompt' | 'edit' | 'test' | 'serve' | 'monitor' | 'remote' | 'repl' | 'git' | 'build' | 'run';
  /** lantern lit = a process is running */
  running: boolean;
  /** last exit: ok / failed / none */
  exit: 'ok' | 'fail' | null;
  label: string;
  ports: number[];
}

/** One field per workspace. Twelve kinds; picked stably from the workspace label. */
export const PLOT_KINDS = Object.freeze([
  'wheat', 'pumpkins', 'cabbages', 'sunflowers', 'orchard', 'vineyard', 'berries', 'chickens', 'cows', 'sheep', 'pigs', 'bees',
] as const);
export type PlotKind = (typeof PLOT_KINDS)[number];
export const ANIMAL_PLOTS: readonly PlotKind[] = Object.freeze(['chickens', 'cows', 'sheep', 'pigs', 'bees']);

/**
 * Plot lifecycle, the in-lore explanation for workspaces coming and going:
 *   tilling   — a workspace just opened: the soil turns, fence posts drop in, seedlings sprout (≈ 6 s)
 *   thriving  — someone worked here in the last few minutes: lush, sprinklers, butterflies
 *   growing   — worked in the last hour: healthy, calm
 *   resting   — idle for over an hour: crops golden and drooping, animals napping
 *   harvest   — the workspace closed: the harvest cart collects everything (≈ 6 s)
 *   fallow    — closed; the soil rests with a "fallow" sign until the slot is reclaimed (≈ 5 min)
 * A site with no plot at all shows wild meadow.
 */
export const PLOT_STAGES = Object.freeze(['tilling', 'thriving', 'growing', 'resting', 'harvest', 'fallow'] as const);
export type PlotStage = (typeof PLOT_STAGES)[number];

export interface PlotView {
  /** workspace id (fallow plots keep the id of the workspace that left) */
  id: string;
  label: string;
  /** index into VALLEY.sites */
  site: number;
  kind: PlotKind;
  /** 0..7 workspace colour (fence ribbons, sign paint) */
  colorIndex: number;
  stage: PlotStage;
  /** ms epoch the stage began */
  stageSince: number;
  /** 0..1 how grown the crop is (work done in this workspace; grows with lines added, never shrinks while open) */
  growth: number;
  /** 0..1 recent activity (1 = working right now, decays over an hour) */
  vigor: number;
  /** worst status across the plot's panes */
  status: Status;
  farmers: string[];
  helpers: string[];
}

/** Mailbox letters. `needs-you` letters resolve themselves when the farmer is unblocked. */
export const LETTER_KINDS = Object.freeze([
  'needs-you', 'finished', 'error', 'test-fail', 'test-pass', 'commit', 'struggle', 'arrived', 'left', 'subagents', 'news',
] as const);
export type LetterKind = (typeof LETTER_KINDS)[number];
export interface Letter {
  id: string;
  /** ms epoch */
  at: number;
  kind: LetterKind;
  farmerId: string;
  farmerName: string;
  plotLabel: string;
  title: string;
  body: string;
  read: boolean;
  /** needs-you letters: resolved once the farmer is no longer blocked */
  resolved: boolean;
}

/** System stats, normalised for the landmarks that display them. */
export interface Gauges {
  at: number;
  host: string;
  /** 0..1 total CPU (windmill speed) */
  cpu: number;
  cores: number[];
  load1: number;
  /** 0..1 used RAM (water tower level) */
  mem: number;
  memUsedGB: number;
  memTotalGB: number;
  /** 0..1 swap used */
  swap: number;
  /** root disk (silo fill) */
  disk: number;
  diskUsedGB: number;
  diskTotalGB: number;
  /** bytes/s */
  ioRead: number;
  ioWrite: number;
  netRx: number;
  netTx: number;
  /** 0..1, null when there is no GPU sensor */
  gpu: number | null;
  /** °C of the hottest sensor, null if none */
  tempC: number | null;
  /** last 120 cpu samples (0..1), oldest first */
  cpuHistory: number[];
  memHistory: number[];
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';
export interface Weather { kind: WeatherKind; /** 0..1 */ intensity: number; /** 0..1 cloud cover */ clouds: number; /** m/s, direction radians */ wind: number; windDir: number }
/**
 * What the recent real-clock weather left behind (model/sky.ts `weatherTrace`, pure): integrated over the previous
 * two days of 3-hour weather blocks, so puddles linger after a shower and snow builds up through a snowy morning.
 */
export interface WeatherTrace {
  /** ground wetness 0..1: soaks in fast during rain, dries over a few hours (slower at night, in fog, in winter) */
  wet: number;
  /** lying snow 0..1: builds through snow blocks, melts in rain and sun */
  snow: number;
  /** real hours since the last rain / storm stopped; null while it rains or if it has been dry for over 12 h */
  sinceRain: number | null;
}
export interface Sky {
  /** local fractional hour 0..24 */
  hour: number;
  /** 0 night … 1 noon, smooth */
  daylight: number;
  season: Season;
  dayOfYear: number;
  weather: Weather;
  /** puddles, lying snow and time since rain (from the recent weather blocks) */
  trace: WeatherTrace;
  /** the real-calendar festival on today, and the next one (model/calendar.ts) */
  festival: FestivalView;
}

/** One-shot reactions for the presentation layer. */
export const VALLEY_EVENTS = Object.freeze([
  'arrived', 'left', 'blocked', 'unblocked', 'finished', 'celebrate', 'oops', 'ship', 'duckling-hatched', 'duckling-home', 'compact', 'struggle',
  'plot-opened', 'plot-closed',
  // the almanac: the valley reached a new rank (detail: the rank's name)
  'level-up',
] as const);
export type ValleyEventKind = (typeof VALLEY_EVENTS)[number];
export interface ValleyEvent { kind: ValleyEventKind; /** farmer / helper / plot id */ id: string; detail?: string }

export type LinkState = 'connecting' | 'live' | 'offline' | 'herdr-offline';

export interface ValleyState {
  /** ms epoch on the server clock */
  now: number;
  link: LinkState;
  demo: boolean;
  farmers: Map<string, FarmerView>;
  helpers: Map<string, HelperView>;
  /** keyed by plot id (workspace id); includes fallow plots */
  plots: Map<string, PlotView>;
  letters: Letter[];
  /** commits shipped since local midnight (shipping-bin crate stack) */
  commitsToday: number;
  /** the Valley Almanac: prosperity, rank, today's harvest, unlocked town upgrades (model/almanac.ts) */
  almanac: AlmanacView;
  gauges: Gauges | null;
  sky: Sky;
  /** each farmer's day so far: spans of what they did, asks + how long they waited, ships, test runs (model/timeline.ts) */
  timeline: TimelineView;
}

/** What the presentation may ask for. Implemented over the store in main; faked in the gallery and tests. */
export interface AgentPort {
  /** open the terminal drawer for a pane */
  openTerminal(id: string): void;
  /** answer a blocked prompt by option key */
  answer(id: string, key: string): Promise<{ ok: boolean; error?: string }>;
  /** acknowledge a finished agent */
  ack(id: string): void;
  /** send a new prompt line to an idle agent */
  prompt(id: string, text: string): Promise<{ ok: boolean; error?: string }>;
}
