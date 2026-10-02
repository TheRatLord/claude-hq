/**
 * Pure parsers for the git enricher (enrich/git.ts): `git status --porcelain=v2 --branch` and the one-line
 * `git log -1 --format=%h%x1f%ct%x1f%s`. No fs, no processes; tests feed them text.
 */
import type { GitInfo } from '../../shared/protocol.ts';

export interface StatusFacts {
  branch: string | null;
  head: string | null;
  /** null: no upstream configured */
  ahead: number | null;
  behind: number | null;
  /** changed tracked entries (ordinary, renamed/copied, unmerged) */
  dirty: number;
  untracked: number;
}

/** `git status --porcelain=v2 --branch` (newline-separated, not -z). Unknown lines are ignored. */
export function parseStatusV2(text: string): StatusFacts {
  const out: StatusFacts = { branch: null, head: null, ahead: null, behind: null, dirty: 0, untracked: 0 };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice(13).trim();
      out.head = /^[0-9a-f]{7,}$/.test(oid) ? oid.slice(0, 7) : null;
    } else if (line.startsWith('# branch.head ')) {
      const b = line.slice(14).trim();
      out.branch = b && b !== '(detached)' ? b : null;
    } else if (line.startsWith('# branch.ab ')) {
      const m = /^\+(\d+) -(\d+)$/.exec(line.slice(12).trim());
      if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]); }
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) out.dirty++;
    else if (line.startsWith('? ')) out.untracked++;
  }
  return out;
}

/** `%h%x1f%ct%x1f%s` → the last commit; null for an empty / malformed line (a repo with no commits yet). */
export function parseLastCommit(text: string): { sha: string; at: number; subject: string } | null {
  const line = text.split('\n')[0] ?? '';
  const [sha, ct, ...rest] = line.split('\x1f');
  const secs = Number(ct);
  if (!sha || !/^[0-9a-f]{4,}$/.test(sha) || !Number.isFinite(secs) || secs <= 0) return null;
  const subject = rest.join('\x1f').replace(/\s+/g, ' ').trim();
  return { sha, at: secs * 1000, subject: subject.length > 120 ? `${subject.slice(0, 119)}…` : subject };
}

/** The wire shape from the parsed pieces (`root` = `git rev-parse --show-toplevel`). */
export function gitInfo(root: string, status: StatusFacts, last: { at: number; subject: string } | null): GitInfo {
  return {
    root, branch: status.branch, head: status.head, dirty: status.dirty + status.untracked, untracked: status.untracked,
    ahead: status.ahead, behind: status.behind, lastCommit: last ? { subject: last.subject, at: last.at } : null,
  };
}
