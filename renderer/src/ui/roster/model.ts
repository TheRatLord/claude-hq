// @pure
/**
 * Roster model (§8, §8.2 search, §8.7): filtering, grouping, "needs you" ordering, initial selection.
 * No DOM. The view (roster/view.ts) renders what `buildRoster()` returns.
 * Owner: UI.
 */
import { taskLabel } from '../../../../shared/task.ts';
import type { Entity, Status } from '../../../../shared/protocol.ts';

/** Group-by modes in segmented-control order (Alt+1..7). */
export const GROUP_MODES = Object.freeze(['state', 'workspace', 'tab', 'project', 'directory', 'kind', 'tool'] as const);
export type GroupMode = (typeof GROUP_MODES)[number];
export const isGroupMode = (s: unknown): s is GroupMode => GROUP_MODES.some((m) => m === s);
export const GROUP_LABELS: Readonly<Record<GroupMode, string>> = Object.freeze({ state: 'State', workspace: 'Workspace', tab: 'Tab', project: 'Project', directory: 'Directory', kind: 'Kind', tool: 'Tool' });
/** Segmented-control labels (360 px roster); the full names are the titles / aria labels. */
export const GROUP_SHORT: Readonly<Record<GroupMode, string>> = Object.freeze({ state: 'State', workspace: 'Space', tab: 'Tab', project: 'Proj', directory: 'Dir', kind: 'Kind', tool: 'Tool' });
export const SORTS = Object.freeze(['recent', 'name', 'elapsed'] as const);
export type Sort = (typeof SORTS)[number];
export const isSort = (s: unknown): s is Sort => SORTS.some((m) => m === s);
/** The State-mode bucket of an entity: its status, or `shell` for shells. */
export type StateKey = Status | 'shell';

const STATE_ORDER: readonly StateKey[] = ['blocked', 'working', 'done', 'idle', 'unknown', 'shell'];
const STATE_LABEL: Record<StateKey, string> = { blocked: 'Blocked', working: 'Working', done: 'Done', idle: 'Idle', unknown: 'Unknown', shell: 'Shells' };

/** `~`-abbreviated path. */
export const tildePath = (p: string | null | undefined): string => String(p ?? '').replace(/^\/home\/[^/]+(?=\/|$)/, '~').replace(/^\/root(?=\/|$)/, '~');

/** The state bucket of an entity (shells group separately in State mode). */
export const stateKey = (e: Pick<Entity, 'kind' | 'status'>): StateKey => (e.kind === 'shell' ? 'shell' : e.status || 'unknown');

/**
 * Directory label: the cwd nested under its repo root (`claude-hq › server/`), else the `~` path.
 */
export function dirOf(e: Pick<Entity, 'cwd' | 'repo'>): { key: string; label: string; root: string; rel: string } {
  const cwd = tildePath(e.cwd || '');
  const repo = e.repo || null;
  if (repo) {
    const segs = cwd.split('/');
    const i = segs.lastIndexOf(repo);
    if (i >= 0) {
      const rel = segs.slice(i + 1).join('/');
      return { key: cwd, label: rel ? `${repo} › ${rel}/` : repo, root: segs.slice(0, i + 1).join('/'), rel };
    }
  }
  return { key: cwd, label: cwd || '(no cwd)', root: cwd, rel: '' };
}

/** Tool bucket: agent tool class, shell activity, or idle. */
export function toolOf(e: Pick<Entity, 'kind' | 'status' | 'process' | 'activity'>): string {
  if (e.kind === 'shell') return e.process?.activity ? `shell · ${e.process.activity}` : 'shell · prompt';
  return e.activity?.cls || (e.status === 'working' ? 'thinking' : 'no tool');
}

/**
 * "Needs you" rank (§8, §8.7): blocked by age, then struggle level, then done-unacked by age. null = not urgent.
 * Lower sorts first.
 */
export function needsYou(e: Pick<Entity, 'status' | 'statusSince' | 'struggle' | 'ack'>): [number, number] | null {
  if (e.status === 'blocked') return [0, e.statusSince || 0];
  if (e.struggle && e.struggle.level > 0) return [1, -e.struggle.level];
  if (e.status === 'done' && !e.ack) return [2, e.statusSince || 0];
  return null;
}

/**
 * THE "needs you" comparator (reviewer r3): urgent before not urgent; among urgent, rank then key, then the pane id as
 * the final tie-break (every agent of the first snapshot, or a herdr restart, shares one `statusSince`). The roster
 * row sort, `initialSelection`, `oldestBlocked` and the Blocked Inbox queue (serveModel.blockedQueue) all use it, so
 * Tab → Enter, B → Enter, Enter in the world and the roster's pinned inbox card always agree on who is first.
 * 0 for two non-urgent entities (the header sort decides).
 */
export function cmpNeedsYou(a: Pick<Entity, 'id' | 'status' | 'statusSince' | 'struggle' | 'ack'>, b: Pick<Entity, 'id' | 'status' | 'statusSince' | 'struggle' | 'ack'>): number {
  const x = needsYou(a), y = needsYou(b);
  if (x && !y) return -1;
  if (!x && y) return 1;
  if (x && y) return x[0] - y[0] || x[1] - y[1] || String(a.id).localeCompare(String(b.id));
  return 0;
}
const cmpNeeds = cmpNeedsYou;

const byName = (a: Pick<Entity, 'id' | 'name'>, b: Pick<Entity, 'id' | 'name'>) => (a.name || '').localeCompare(b.name || '') || String(a.id).localeCompare(String(b.id));
const recentOf = (e: Pick<Entity, 'activity' | 'statusSince'>) => Math.max(e.activity?.since || 0, e.statusSince || 0);

/** Comparator: needs-you first, then the header sort. */
export function comparator(sort: Sort = 'recent'): (a: Entity, b: Entity) => number {
  return (a, b) => {
    const n = cmpNeeds(a, b);
    if (n) return n;
    if (sort === 'name') return byName(a, b);
    if (sort === 'elapsed') return (a.statusSince || 0) - (b.statusSince || 0) || byName(a, b);
    return recentOf(b) - recentOf(a) || byName(a, b);
  };
}

// ---------------------------------------------------------------------------------------------
// Search (§8.2 "Roster search")

const FIELD_TOKENS = ['is', 'ws', 'tab', 'kind', 'cwd', 'project', 'has', 'name'] as const;
type FilterField = (typeof FIELD_TOKENS)[number];
const isField = (s: string): s is FilterField => FIELD_TOKENS.some((t) => t === s);

export interface ParsedQuery { filters: { field: FilterField; value: string }[]; words: string[] }

export function parseQuery(q: string | null | undefined): ParsedQuery {
  const filters: ParsedQuery['filters'] = [];
  const words: string[] = [];
  for (const raw of String(q || '').trim().split(/\s+/)) {
    if (!raw) continue;
    const m = /^([a-z]+):(.*)$/i.exec(raw);
    const field = m ? m[1].toLowerCase() : '';
    if (m && isField(field) && m[2]) filters.push({ field, value: m[2].toLowerCase() });
    else words.push(raw.toLowerCase());
  }
  return { filters, words };
}

/** Case-insensitive subsequence test (fuzzy per token). */
export function fuzzy(needle: string, hay: string): boolean {
  if (!needle) return true;
  if (hay.includes(needle)) return true;
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

/** Searchable text fields of an entity (lower-cased). */
export function haystack(e: Entity): string[] {
  return [e.name, taskLabel(e), e.title, e.project, tildePath(e.cwd), e.cwd, e.workspace?.label, e.tab?.label,
    e.activity?.detail, e.lastPrompt, e.kind, e.status].filter(Boolean).map((s) => String(s).toLowerCase());
}

/** Name + label fields (lower-cased): the only ones fuzzy (subsequence) matching runs over. [UI fix r3] */
export function nameLabels(e: Entity): string[] {
  return [e.name || e.id, e.workspace?.label, e.tab?.label, e.project, e.kind].filter(Boolean).map((s) => String(s).toLowerCase());
}

/**
 * Rank of one search word against an entity, lower is better; -1 = no match. [UI fix r3, playtest "search picks the
 * wrong agent": 'flint' listed sable/claude/tinker via subsequences in their prompts, and the selection stayed put]
 *   0 exact name · 1 name prefix · 2 name substring · 3 label prefix · 4 label substring · 5 other field substring
 *   (task, prompt, cwd, …) · 6 fuzzy over the name and labels only (never over task / prompt / cwd text).
 */
export function wordRank(e: Entity, w: string): number {
  const name = String(e.name || e.id || '').toLowerCase();
  if (name === w) return 0;
  if (name.startsWith(w)) return 1;
  if (name.includes(w)) return 2;
  const labels = nameLabels(e).slice(1);
  if (labels.some((h) => h.startsWith(w))) return 3;
  if (labels.some((h) => h.includes(w))) return 4;
  if (haystack(e).some((h) => h.includes(w))) return 5;
  if (fuzzy(w, name) || labels.some((h) => fuzzy(w, h))) return 6;
  return -1;
}

/** Extra predicates the model cannot know (the UI's notes and unread marks). */
export interface RosterExt { hasNote?: (e: Entity) => boolean; unread?: (e: Entity) => number }

/** -1 = filtered out; else the rank (0 best; the worst word's rank). */
export function matchRank(e: Entity, q: ParsedQuery, ext: RosterExt = {}): number {
  for (const { field, value } of q.filters) {
    switch (field) {
      case 'is':
        if (value === 'shell') { if (e.kind !== 'shell') return -1; break; }
        if (value === 'unread') { if (!((ext.unread?.(e) ?? 0) > 0)) return -1; break; }
        if (e.status !== value) return -1;
        break;
      case 'ws': if (!String(e.workspace?.label || '').toLowerCase().includes(value)) return -1; break;
      case 'tab': if (!String(e.tab?.label || '').toLowerCase().includes(value)) return -1; break;
      case 'kind': if (String(e.kind || '').toLowerCase() !== value) return -1; break;
      case 'cwd': if (!tildePath(e.cwd).toLowerCase().includes(value) && !String(e.cwd || '').toLowerCase().includes(value)) return -1; break;
      case 'project': if (!String(e.project || '').toLowerCase().includes(value)) return -1; break;
      case 'has': if (value === 'note' && !ext.hasNote?.(e)) return -1; break;
      // exact name (namesakes: a `?open=claude` deep link lists just the twins, not every claude-kind agent, m2-r3)
      case 'name': if (String(e.name || e.id).toLowerCase() !== value) return -1; break;
    }
  }
  let rank = 0;
  for (const w of q.words) {
    const r = wordRank(e, w);
    if (r < 0) return -1;
    rank = Math.max(rank, r);
  }
  return rank;
}

export const matchEntity = (e: Entity, q: ParsedQuery, ext: RosterExt = {}): boolean => matchRank(e, q, ext) >= 0;

// ---------------------------------------------------------------------------------------------
// Grouping

export interface Group { key: string; label: string; order: number | string; colorIndex?: number | null; state?: StateKey }

const KIND_ORDER: readonly string[] = ['claude', 'codex', 'gemini', 'agent', 'shell'];

export function groupOf(e: Entity, mode: GroupMode): Group {
  switch (mode) {
    case 'workspace': return { key: `ws:${e.workspace?.id ?? '?'}`, label: e.workspace?.label || '(no workspace)', order: e.workspace?.number ?? 999, colorIndex: e.workspace?.colorIndex ?? null };
    case 'tab': return { key: `tab:${e.workspace?.id}/${e.tab?.id}`, label: `${e.workspace?.label || '?'} › ${e.tab?.label || '?'}`, order: (e.workspace?.number ?? 999) * 1000 + (e.tab?.number ?? 0), colorIndex: e.workspace?.colorIndex ?? null };
    case 'project': return { key: `p:${e.project || ''}`, label: e.project || '(no project)', order: e.project || '~' };
    case 'directory': { const d = dirOf(e); return { key: `d:${d.key}`, label: d.label, order: d.key }; }
    case 'kind': return { key: `k:${e.kind}`, label: e.kind === 'shell' ? 'Shells' : e.kind, order: KIND_ORDER.indexOf(e.kind) };
    case 'tool': { const t = toolOf(e); return { key: `t:${t}`, label: t, order: t }; }
    default: { const s = stateKey(e); return { key: `s:${s}`, label: STATE_LABEL[s], order: STATE_ORDER.indexOf(s), state: s }; }
  }
}

export interface RosterOpts {
  mode: GroupMode;
  sort?: Sort;
  query?: string;
  /** state filter chips (null/empty = all) */
  states?: Set<string> | null;
  /** show shells (default true) */
  shells?: boolean;
  /** collapsed group keys (this mode) */
  collapsed?: Set<string>;
  /** pinned pane ids in slot order (shown in a Pinned section on top) */
  pinnedIds?: string[];
  ext?: RosterExt;
}

export interface GroupItem { type: 'group'; key: string; label: string; count: number; collapsed: boolean; colorIndex?: number | null; state?: StateKey; needs: number; blocked: number; doneUnacked: number; pinned: boolean }
export interface RowItem { type: 'row'; id: string; group: string }
export type RosterItem = GroupItem | RowItem;

/** A group with its member entities (`pinned` marks the Pinned section). */
export interface RosterGroup extends Group { items: Entity[]; pinned?: boolean }

/**
 * Filter + group + sort. Returns groups (with their entity ids) and the flat visual list.
 */
export function buildRoster(entities: Iterable<Entity>, o: RosterOpts): { groups: RosterGroup[]; list: RosterItem[]; count: number; empty: boolean; best: string | null } {
  const q = parseQuery(o.query || '');
  const cmp = comparator(o.sort);
  const pinned = new Set(o.pinnedIds || []);
  const shells = o.shells !== false || q.filters.some((f) => f.field === 'is' && f.value === 'shell') || q.filters.some((f) => f.field === 'kind' && f.value === 'shell');
  const all: Entity[] = [];
  const rank = new Map<string, number>();
  const rankOf = (id: string) => rank.get(id) ?? 0; // every id compared below was ranked on the way in
  for (const e of entities) {
    if (!shells && e.kind === 'shell') continue;
    if (o.states && o.states.size && !o.states.has(stateKey(e)) && !o.states.has(e.status)) continue;
    const r = matchRank(e, q, o.ext);
    if (r < 0) continue;
    rank.set(e.id, r);
    all.push(e);
  }
  // [UI fix r3] a typed query ranks rows: best name matches first inside each group, and `best` = the top-ranked row
  const ranked = q.words.length > 0;
  const rcmp = ranked ? (a: Entity, b: Entity) => rankOf(a.id) - rankOf(b.id) || cmp(a, b) : cmp;
  const groups = new Map<string, RosterGroup>();
  const pinList: Entity[] = [];
  for (const e of all) {
    if (pinned.has(e.id)) { pinList.push(e); continue; }
    const g = groupOf(e, o.mode);
    let G = groups.get(g.key);
    if (!G) groups.set(g.key, (G = { ...g, items: [] }));
    G.items.push(e);
  }
  const ordered = [...groups.values()].sort((a, b) => (typeof a.order === 'number' && typeof b.order === 'number' ? a.order - b.order : String(a.order).localeCompare(String(b.order))) || a.label.localeCompare(b.label));
  if (pinList.length) {
    const order = o.pinnedIds || [];
    pinList.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    ordered.unshift({ key: 'pinned', label: 'Pinned', order: -1, items: pinList, pinned: true });
  }
  const list: RosterItem[] = [];
  const collapsed = o.collapsed || new Set();
  for (const G of ordered) {
    if (!G.pinned) G.items.sort(rcmp);
    const isCollapsed = collapsed.has(G.key);
    list.push({ type: 'group', key: G.key, label: G.label, count: G.items.length, collapsed: isCollapsed, colorIndex: G.colorIndex ?? null, state: G.state, needs: G.items.filter((e) => needsYou(e)).length,
      blocked: G.items.filter((e) => e.status === 'blocked').length, doneUnacked: G.items.filter((e) => e.status === 'done' && !e.ack).length, pinned: !!G.pinned });
    if (!isCollapsed) for (const e of G.items) list.push({ type: 'row', id: e.id, group: G.key });
  }
  let best: string | null = null;
  if (ranked) {
    for (const x of list) if (x.type === 'row' && (best === null || rankOf(x.id) < rankOf(best))) best = x.id;
    // a collapsed group can hold the best match: still pick it (the view expands nothing; Enter opens it)
    const cur: string | null = best;
    if (cur === null || all.some((e) => rankOf(e.id) < rankOf(cur))) best = [...all].sort(rcmp)[0]?.id ?? best;
  }
  return { groups: ordered, list, count: all.length, empty: all.length === 0, best };
}

/**
 * Initial selection (§8.7): top "needs you" entity → the last-opened terminal's entity → the top row.
 * Returns the entity id.
 */
export function initialSelection(list: readonly RosterItem[], entities: Map<string, Entity>, lastOpened: string | null): string | null {
  const rows = list.flatMap((x) => (x.type === 'row' ? entities.get(x.id) ?? [] : []));
  const urgent = rows.filter((e) => needsYou(e)).sort(cmpNeedsYou)[0];
  if (urgent) return urgent.id;
  if (lastOpened && rows.some((e) => e.id === lastOpened)) return lastOpened;
  return rows[0]?.id ?? null;
}

/** Oldest blocked entity id (Enter fallback, Leader U order). */
export function oldestBlocked(entities: Iterable<Entity>, except: string | null = null): Entity | null {
  let best: Entity | null = null;
  for (const e of entities) {
    if (e.status !== 'blocked' || e.id === except) continue;
    if (!best || cmpNeedsYou(e, best) < 0) best = e;
  }
  return best;
}

/** Compact elapsed label: 42s · 5m · 3h · 2d. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Spoken elapsed for aria labels. */
export function elapsedSpoken(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} seconds`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** Row aria-label (§8.11): "scout, blocked 4 minutes, hq-core › claude, task: route stops display". */
export function rowAriaLabel(e: Entity, now: number, name = e.name || e.id): string {
  const task = taskLabel(e);
  return `${name}, ${e.kind === 'shell' ? 'shell' : e.status}${e.status === 'done' && e.ack ? ' (signed off in HQ)' : ''} ${elapsedSpoken(now - (e.statusSince || now))}, ${e.workspace?.label ?? '?'} › ${e.tab?.label ?? '?'}${task ? `, task: ${task}` : ''}`;
}

/**
 * Disambiguating qualifier for a display name (§8.11): '' when the name is unique among `entities`, else the shortest
 * of `workspace`, `workspace › tab`, `workspace › tab #n` that tells this entity apart from its namesakes.
 */
export function nameQualifier(e: Entity, entities: Iterable<Entity>): string {
  const name = e.name || e.id;
  const twins = [...entities].filter((x) => x.id !== e.id && (x.name || x.id) === name);
  if (!twins.length) return '';
  const ws = (x: Entity) => x.workspace?.label ?? '?';
  const wt = (x: Entity) => `${ws(x)} › ${x.tab?.label ?? '?'}`;
  if (!twins.some((x) => ws(x) === ws(e))) return ws(e);
  const same = twins.filter((x) => wt(x) === wt(e));
  if (!same.length) return wt(e);
  // identical ws › tab: number namesakes by pane id order (stable while the set is stable)
  const n = [e, ...same].map((x) => x.id).sort().indexOf(e.id) + 1;
  return `${wt(e)} #${n}`;
}

/**
 * Reorder freeze (§8.7), reviewer m2-r2: only *within-group sort moves* are frozen while the list is focused / hovered.
 * Groups, headers (counts), membership and moves between groups come from `fresh` at once (a working agent must not sit
 * under Idle with '9 changes' pending); inside each group the rows keep their frozen order, and rows new to that group
 * slot in at their fresh position. `pending` counts the rows whose within-group place differs from the fresh sort.
 */
export function reconcileFrozen(frozen: readonly RosterItem[], fresh: readonly RosterItem[]): { list: RosterItem[]; pending: number } {
  /** group key → frozen row order */
  const was = new Map<string, string[]>();
  for (const x of frozen) if (x.type === 'row') { let a = was.get(x.group); if (!a) was.set(x.group, (a = [])); a.push(x.id); }
  const out: RosterItem[] = [];
  let pending = 0;
  let i = 0;
  while (i < fresh.length) {
    const g = fresh[i++];
    if (g.type !== 'group') { out.push(g); continue; }
    out.push(g);
    const rows: RowItem[] = [];
    while (i < fresh.length) { const r = fresh[i]; if (r.type !== 'row') break; rows.push(r); i++; }
    const ids = new Set(rows.map((r) => r.id));
    const old = (was.get(g.key) ?? []).filter((id) => ids.has(id));
    const oldSet = new Set(old);
    // frozen order for the rows that stayed, newcomers at their fresh index
    const order = [...old];
    rows.forEach((r, k) => { if (!oldSet.has(r.id)) order.splice(Math.min(k, order.length), 0, r.id); });
    const byId = new Map(rows.map((r) => [r.id, r]));
    order.forEach((id, k) => { if (rows[k].id !== id) pending++; const r = byId.get(id); if (r) out.push(r); });
  }
  return { list: out, pending };
}
