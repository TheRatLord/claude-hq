// The page-side surface p2.ts drives beyond `window.__hq` (see pageTypes.ts): the UI's debug object `window.__hqUi`
// (renderer/src/ui/index.ts) and p2's own in-page WS spy `window.__p2` (the SPY script in p2.ts). Hand-kept mirror of
// what p2 touches, like pageTypes.ts.
import type { Terminal } from '@xterm/xterm';
import type { Entity } from '../shared/protocol.ts';
import type { PageWindow, Vec3 } from './pageTypes.ts';

/** A tab's view in the terminal drawer. */
export interface DrawerView {
  id: string;
  /** 'observe' (Peek) | 'control' */
  mode: string;
  state: { state: string } | null;
  life: { input: string | null };
  term: Terminal;
  paused: boolean;
  hasWebgl: boolean;
  focus(): void;
  relayout(): void;
  /** show (or, with null, clear) a notice chip in the footer rail */
  chip(id: string, chip: { kind: string; text: string } | null): void;
}

export interface DrawerUi {
  activeId: string | null;
  tabIds: string[];
  /** 'docked' | 'collapsed' | 'fullscreen' */
  state: string;
  /** drawer.open's step timings (ms) of the last open */
  lastOpen: { total: number; [step: string]: number } | null;
  active(): DrawerView | null;
  view(id: string): DrawerView | null;
  open(id: string): void;
  close(id: string): void;
  setHiddenDemoteMs(ms: number): void;
}

export interface InboxOpenOpts { id?: string; tab?: string; focus?: boolean }
export interface InboxUi {
  isOpen: boolean;
  currentId: string | null;
  confirming: boolean;
  /** where the confirm came from: 'card' (status card) | 'mini' (roster ledger) */
  origin: string | null;
  tab: string;
  doneIds: string[];
  doneSelectedId: string | null;
  recapShown: boolean;
  el: HTMLElement;
  open(o?: InboxOpenOpts): void;
  close(): void;
  focus(): void;
}

export interface RosterOpenOpts { focus?: string; groupBy?: string; query?: string }
export interface RosterUi {
  isOpen: boolean;
  selectedId: string | null;
  /** the grouping mode: 'state' | 'workspace' | 'directory' | 'tool' | … */
  mode: string;
  query: string;
  /** the search box */
  input: HTMLInputElement | null;
  /** letters are verbs (list focused after ↓) rather than search text */
  armed: boolean;
  pendingChanges: number;
  compact: boolean;
  visibleIds(): string[];
  select(id: string): void;
  open(o?: RosterOpenOpts): void;
  close(o?: { toWorld?: boolean }): void;
  clearFilters(): void;
  applyPending(): void;
  action(name: string): void;
}

export interface PinsUi {
  /** the pin slot (1-based) of an entity, 0 when unpinned */
  slotOf(id: string): number;
  idAt(slot: number): string | undefined;
  assign(slot: number, entity: Entity | undefined): void;
  toggle(entity: Entity | undefined): void;
  slots: ({ id: string } | null | undefined)[];
}

/** An actor as `__hqUi.actorList()` lists it (with its entity and brain intent). */
export interface UiActor {
  id: string;
  pos: { x: number; y: number; z: number };
  yaw: number;
  arrived: boolean;
  inCrate: boolean;
  entity?: Entity;
  intent?: { slot?: { id: string } };
}

export interface HqUiPage {
  drawer: DrawerUi;
  inbox: InboxUi;
  roster: RosterUi;
  settings: { isOpen: boolean; open(): void };
  help: { isOpen: boolean };
  hire: { isOpen: boolean; confirming: boolean; open(o: { kind: string }): void };
  rename: { isOpen: boolean };
  promptBar: { isOpen: boolean; id: string | null; confirming: boolean };
  onboarding: { active: boolean; step: number; history: { step: number; at: number }[]; start(): void };
  triage: { isOpen: boolean; size: number; currentId: string | null; confirming: boolean; close(): void };
  statusCard: { shownId: string | null; el: HTMLElement };
  away: { showing: boolean; strip: HTMLElement; dismiss(): void };
  minimap?: { isOverview: boolean };
  unread: { of(id: string): number };
  pins(): PinsUi;
  /** the display label of an entity ('claude', or 'claude · 2' for a namesake) */
  label(id: string): string;
  /** the entity id under the reticle */
  aimed(): string | null;
  aimIgnoringWalls(): string | null;
  /** world top of an actor's aim boxes */
  aimTop(id: string): number | null;
  sightBlocked(from: Vec3, to: Vec3): boolean;
  actorList(): UiActor[];
  followId(): string | null;
  track(): unknown;
  settleWatch(): unknown;
  scope(): string;
  toWorld(): void;
  navWalkable(x: number, z: number, level: number): boolean;
  goTo(id: string): void;
  goToSpot(id: string): { x: number; z: number; why: string } | null;
  closePane(id: string): unknown;
}

/**
 * A message the page sent, as p2 reads it: a JSON frame (`t` = its type; the rest are the ClientMsg fields p2 checks) or a
 * binary term.input frame decoded to `t: 'bin'` + `text`.
 */
export interface SentMsg {
  t: string;
  id?: string;
  text?: string;
  flags?: number;
  key?: string;
  promptHash?: string;
  paste?: boolean;
  rid?: number | string;
  kind?: string;
  prompt?: string;
  name?: string;
}

/** One message p2's in-page spy recorded on the app's socket: a JSON frame, or a binary one as its bytes. */
export interface SpyFrame { at: number; json?: SentMsg; bin?: number[] }
export interface LongTask { at: number; ms: number }

/** `window.__p2`: the WS spy + latency shim + probes p2 installs before any page script runs (SPY in p2.ts). */
export interface P2Page {
  sent: SpyFrame[];
  sock: WebSocket | null;
  /** the app's onmessage handler (the spy keeps it so a case can inject a server frame) */
  handler: ((this: WebSocket | null, ev: { data: string }) => void) | null;
  /** artificial one-way delay (ms) on the app's socket */
  latency: number;
  lastKey: number;
  lastDispatch: number;
  long: LongTask[];
  lastBreakdown: { queue: number; handler: number; long: LongTask[] } | null;
  focusP: Promise<number>;
  cpu(): number;
  cpuBase: number;
  quiet(n?: number, gapMs?: number, timeoutMs?: number): Promise<boolean>;
  armFocus(): boolean;
  /** recorded bus events, by event name (busSpy) */
  bus?: Record<string, Record<string, unknown>[]>;
  /** the saved `hello.allowMutations` while the hire-gate case has it off */
  am?: boolean;
}

export type P2Window = PageWindow & { __hqUi: HqUiPage; __p2: P2Page };
