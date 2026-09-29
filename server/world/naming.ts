/**
 * Display name / project / seedKey rules (DESIGN §4.3). Pure. Owner: BE.
 *   name    = herdr agent `name` → non-numeric tab label → basename(cwd); `·2`, `·3` for duplicates within a workspace.
 *             The title is never a name (it churns every task).
 *   seedKey = herdr `name` ?? pane_id (stable for the pane's life).
 *   project = worktree.repo_name ?? basename(foreground_cwd ?? cwd).
 */

export const basename = (p: string | null | undefined): string => String(p ?? '').replace(/\/+$/, '').split('/').pop() || '/';

export function baseName({ agentName, tabLabel, cwd }: { agentName?: string | null; tabLabel?: string | null; cwd?: string | null }): string {
  if (agentName) return agentName;
  if (tabLabel && !/^\d+$/.test(tabLabel.trim())) return tabLabel.trim();
  return basename(cwd);
}

export const seedKeyOf = (agentName: string | null | undefined, paneId: string): string => agentName || paneId;

export const projectOf = ({ repoName, foregroundCwd, cwd }: { repoName?: string | null; foregroundCwd?: string | null; cwd?: string | null }): string =>
  repoName || basename(foregroundCwd || cwd);

/**
 * Per-workspace de-duplication in a stable order: the first pane (by tab index, pane index) keeps the bare name.
 * Returns id → unique name.
 */
export function dedupeNames(items: { id: string; ws: string; name: string; order: number[] }[]): Map<string, string> {
  const sorted = [...items].sort((a, b) => {
    for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) {
      const d = (a.order[i] ?? 0) - (b.order[i] ?? 0);
      if (d) return d;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const it of sorted) {
    const k = `${it.ws}\u0000${it.name}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    out.set(it.id, n > 1 ? `${it.name}·${n}` : it.name);
  }
  return out;
}
