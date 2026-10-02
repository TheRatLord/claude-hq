// @pure
/**
 * The overview grid (V, hud/overview.ts; docs/valley/ops.md): every agent as one small tile, for scanning 10–40 of them
 * at a glance. This is its pure part: the order of the tiles, what each one's state is, and moving the keyboard
 * selection around a grid. Tested in overview.test.ts.
 */
import type { FarmerView } from './types.ts';
import { pinnedFirst } from './marks.ts';

/** the state a tile shows (its colour + glyph): an ask outranks everything; a finish nobody reviewed reads as done */
export type TileState = 'blocked' | 'working' | 'done' | 'idle' | 'unknown';
export type TileFarmer = Pick<FarmerView, 'id' | 'tag' | 'status' | 'needsYou' | 'unseenDone' | 'struggle' | 'jobSince'>;

export function tileState(f: Pick<FarmerView, 'status' | 'needsYou' | 'unseenDone'>): TileState {
  if (f.needsYou) return 'blocked';
  if (f.unseenDone) return 'done';
  return f.status === 'blocked' ? 'working' : f.status;
}

/** urgency rank: asks, then struggling, unreviewed finishes, working, idle / done, unknown */
export function tileRank(f: TileFarmer): number {
  if (f.needsYou) return 0;
  if (f.status === 'working' && f.struggle >= 2) return 1;
  if (f.unseenDone) return 2;
  if (f.status === 'working') return 3;
  if (f.status === 'unknown') return 5;
  return 4;
}

/**
 * Tiles in reading order: pinned first (in pin order), then by urgency; asks the longest-waiting first (like the focus
 * queue), everything else by name, so the grid does not reshuffle while you read it.
 */
export function overviewOrder<T extends TileFarmer>(farmers: Iterable<T>, pinned: readonly string[] = []): T[] {
  const list = [...farmers];
  return pinnedFirst(list, (f) => f.id, pinned, (a, b) => tileRank(a) - tileRank(b)
    || (a.needsYou && b.needsYou ? a.jobSince - b.jobSince : 0)
    || a.tag.localeCompare(b.tag) || a.id.localeCompare(b.id));
}

/** how many tiles sit in the first row, from the tiles' top edges (the grid wraps with the panel's width) */
export function columnsOf(tops: readonly number[]): number {
  if (!tops.length) return 1;
  let n = 0;
  while (n < tops.length && Math.abs(tops[n] - tops[0]) < 2) n++;
  return Math.max(1, n);
}

/**
 * The selection after a key in a grid of `n` tiles, `cols` wide (reading order): arrows move (left / right wrap
 * across rows, up / down stay in the column and stop at the edges), Home / End jump to the first / last tile,
 * PageUp / PageDown move `page` rows. Returns `i` for any other key or an empty grid.
 */
export function gridMove(i: number, key: string, cols: number, n: number, page = 4): number {
  if (n <= 0) return 0;
  cols = Math.max(1, Math.min(cols, n));
  i = Math.max(0, Math.min(n - 1, i));
  switch (key) {
    case 'ArrowRight': return Math.min(n - 1, i + 1);
    case 'ArrowLeft': return Math.max(0, i - 1);
    case 'ArrowDown': return i + cols < n ? i + cols : i;
    case 'ArrowUp': return i - cols >= 0 ? i - cols : i;
    case 'Home': return 0;
    case 'End': return n - 1;
    case 'PageDown': return Math.min(n - 1, i + cols * page);
    case 'PageUp': return Math.max(0, i - cols * page);
    default: return i;
  }
}
