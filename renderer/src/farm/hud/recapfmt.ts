/**
 * Pure copy and shaping for the harvest recap (hud/recap.ts): the diff header, file rows, patch line classes, the
 * "when" line. No DOM; `recapfmt.test.ts` covers it.
 */
import type { DiffFile, DiffResult } from '../../../../shared/protocol.ts';
import type { Recap } from '../model/recap.ts';
import { recapDur } from '../model/recap.ts';

/** 'Finished 12m ago · took 42 min · waited on you 4 min (1 ask)' */
export function recapWhen(r: Recap, now: number, ago: (at: number, now: number) => string): string {
  const verb = r.end === 'left' ? 'Went home' : r.end === 'idle' ? 'Stopped' : 'Finished';
  const bits = [`${verb} ${ago(r.to, now)}`, `took ${recapDur(r.to - r.from)}`];
  if (r.waited >= 30_000 || r.asks) bits.push(`waited on you ${recapDur(r.waited)}${r.asks ? ` (${r.asks} ask${r.asks === 1 ? '' : 's'})` : ''}`);
  return bits.join(' · ');
}

/** the diff's one-line header: '6 files · +120 −30', and what range it covers */
export function diffHeader(d: DiffResult): { stat: string; range: string } {
  const n = d.files.length + d.more;
  return {
    stat: `${n} file${n === 1 ? '' : 's'} · +${d.added} −${d.removed}`,
    range: d.to ? `${d.from.slice(0, 7)}..${d.to.slice(0, 7)} (what this task committed)` : `${d.from.slice(0, 7)} → the working tree now (includes later, uncommitted changes)`,
  };
}

export const STATUS_WORD: Readonly<Record<string, string>> = { A: 'new', M: 'changed', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', '?': 'new, untracked', U: 'conflict' };

/** a file row: the path split into dir + name, the counts, a 0..1 share of the biggest change for its bar */
export function fileRow(f: DiffFile, biggest: number): { dir: string; name: string; counts: string; share: number; status: string } {
  const i = f.path.lastIndexOf('/');
  const total = (f.added ?? 0) + (f.removed ?? 0);
  return {
    dir: i >= 0 ? f.path.slice(0, i + 1) : '', name: i >= 0 ? f.path.slice(i + 1) : f.path,
    counts: f.added === null && f.removed === null ? (f.status === '?' ? 'new' : 'binary') : `+${f.added ?? 0} −${f.removed ?? 0}`,
    share: biggest > 0 ? Math.min(1, total / biggest) : 0, status: STATUS_WORD[f.status] ?? f.status,
  };
}

/** a unified-diff line's class: add / del / hunk / meta / ctx */
export function patchClass(line: string): 'add' | 'del' | 'hunk' | 'meta' | 'ctx' {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity') || line.startsWith('rename ')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}
