// @pure
/**
 * `?open=` deep links (§2.2 renderer params, §8.8 M4 row pulled into M3): what a link value means.
 *   - a pane id, or an agent name (case-insensitive; exact name first, then a unique prefix)
 *   - `ws/name`, `ws›name` or `name@ws` for namesakes in different workspaces
 *   - `inbox` · `roster` (or `roster:<group-by>`) · `blocked` (the oldest blocked agent's terminal) · `help` · `settings`
 *   - the label every surface shows for namesakes (names.ts / STAT's boardNames): `claude · 2`, `claude·2`, `claude ·2`,
 *     and a Shift+N rename (M3.5)
 *   - `inbox:<name>` → that agent's Blocked Inbox card (M3.5; Electron notification clicks)
 * An exact match of an agent named like a keyword wins over the keyword only when prefixed with `agent:`.
 * A bare name shared by several agents is `ambiguous` with `{name, ws}` so the caller can filter the roster by exact
 * name (`name:claude`), not a full-text search that also hits the `claude` kind (reviewer m2-r3 [ui]).
 * Owner: UI.
 */
import type { Entity } from '../../../shared/protocol.ts';
import { GROUP_MODES, type GroupMode } from './roster/model.ts';
import { boardNames } from '../world/stats/format.ts';

/** Label spelling normaliser: case, whitespace and the spaces around '·' don't matter. */
export const normLabel = (s: unknown): string => String(s ?? '').toLowerCase().replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ').trim();

const KEYWORDS = ['inbox', 'roster', 'blocked', 'help', 'settings'] as const;
const isKeyword = (s: string): s is (typeof KEYWORDS)[number] => KEYWORDS.some((k) => k === s);
/**
 * `roster:<group-by>` spellings (reviewer m2-r2: `roster:dir` silently fell back to State, because GROUP_MODES says
 * 'directory' while the roster's segmented control reads Dir / Space / Proj).
 */
export const GROUP_ALIASES: Readonly<Record<string, GroupMode>> = Object.freeze({
  state: 'state', status: 'state',
  workspace: 'workspace', ws: 'workspace', space: 'workspace',
  tab: 'tab', tabs: 'tab',
  project: 'project', proj: 'project',
  directory: 'directory', dir: 'directory', cwd: 'directory', folder: 'directory',
  kind: 'kind', tool: 'tool',
});

/** What a `?open=` value means. */
export type DeepLink =
  | { kind: 'agent'; id: string }
  | { kind: 'ambiguous'; ids: string[]; name: string; ws: string | null; exact: boolean }
  | { kind: 'none' }
  | { kind: 'inbox'; id?: string }
  | { kind: 'blocked' | 'help' | 'settings' }
  | { kind: 'roster'; groupBy?: GroupMode; badGroup?: string };

export function resolveDeepLink(raw: string | null | undefined, entities: Iterable<Entity>): DeepLink {
  let q = String(raw ?? '').trim();
  if (!q) return { kind: 'none' };
  const list = [...entities];
  let forceAgent = false;
  if (/^agent:/i.test(q)) { q = q.slice(6); forceAgent = true; }
  const lq = q.toLowerCase();
  if (!forceAgent) {
    const m = /^roster(?::(.*))?$/.exec(lq);
    if (m) {
      if (!m[1]) return { kind: 'roster' };
      const g = GROUP_ALIASES[m[1].trim()];
      return g && GROUP_MODES.includes(g) ? { kind: 'roster', groupBy: g } : { kind: 'roster', badGroup: m[1] };
    }
    if (isKeyword(lq)) return { kind: lq };
    // [M3.5] `inbox:<name>` (Electron OS-notification click, BE): that agent's card in the Blocked Inbox
    const mi = /^inbox:(.+)$/i.exec(q);
    if (mi) {
      const r = resolveDeepLink(`agent:${mi[1]}`, list);
      return r.kind === 'agent' ? { kind: 'inbox', id: r.id } : r;
    }
  }
  const byId = list.find((e) => e.id === q);
  if (byId) return { kind: 'agent', id: byId.id };
  // the '· n' label a namesake carries on every surface (board, nameplates, chevrons, roster, palette, map), and an
  // HQ-local rename (Shift+N, aliases.ts): the exact label every surface shows wins when it is unique
  {
    const want = normLabel(q);
    const labels = boardNames(list);
    const hits = list.filter((e) => normLabel(labels.get(e.id)) === want);
    if (hits.length === 1 && (q.includes('·') || hits[0].name?.toLowerCase() !== lq)) return { kind: 'agent', id: hits[0].id };
  }
  // ws/name · ws›name · name@ws
  let ws: string | null = null, name = lq;
  const a = /^(.+?)\s*(?:\/|›|>)\s*(.+)$/.exec(lq);
  const b = /^(.+)@(.+)$/.exec(lq);
  if (b) { name = b[1]; ws = b[2]; } else if (a) { ws = a[1]; name = a[2]; }
  const inWs = (e: Entity) => !ws || String(e.workspace?.label ?? '').toLowerCase() === ws;
  const nm = (e: Entity) => String(e.name ?? '').toLowerCase();
  const pick = (hits: Entity[], exact: boolean): DeepLink | null => (hits.length === 1 ? { kind: 'agent', id: hits[0].id } : hits.length > 1 ? { kind: 'ambiguous', ids: hits.map((e) => e.id), name, ws, exact } : null);
  // agents before shells when a name is shared by both ("dev")
  const exact = list.filter((e) => inWs(e) && nm(e) === name);
  const agents = exact.filter((e) => e.kind !== 'shell');
  const r = pick(agents.length ? agents : exact, true) ?? pick(list.filter((e) => inWs(e) && nm(e).startsWith(name)), false);
  return r ?? { kind: 'none' };
}
