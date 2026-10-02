/**
 * `__valley.projects`: dev hooks for the Valley Projects (model/projects.ts, scene/projects, hud/projects.ts).
 *
 *   __valley.projects()                  every project: status, progress, needs (have / need), done / unveiled
 *   __valley.projects.complete(id, seen?) finish one now (needs filled; letter, toast); seen=true also marks it unveiled
 *                                        quietly (no confetti: shots of the restored place). 'all' finishes every one
 *   __valley.projects.unveil(id)         play the unveiling now (pop-in, confetti, fanfare; the project must be done)
 *   __valley.projects.go(id)             stand in front of a place ('board' for the board on the square)
 *   __valley.projects.open(id?)          open the board's panel (on a project)
 *   __valley.projects.reset(id?)         forget one project, or all of them
 *   __valley.projects.work(kind, n?)     count n pieces of real work ('ship' | 'celebrate' | 'unblocked' | 'finished') as if
 *                                        the valley were real (the demo never counts real events)
 */
import type { SceneCtx } from '../scene/context.ts';
import { PROJECT_IDS, WORK_OF, isProjectId } from '../model/projects.ts';
import type { ProjectId, ProjectsService } from '../model/projects.ts';
import type { ValleyEventKind } from '../model/types.ts';
import type { ProjectsScene } from '../scene/projects/projects.ts';
import type { WalletService } from '../model/wallet.ts';
import type { FriendsService } from '../model/friends.ts';

export function projectsDev(ctx: SceneCtx) {
  const m = () => ctx.services.get('projects') as ProjectsService | undefined;
  const scene = () => ctx.services.get('projectsScene') as ProjectsScene | undefined;
  const list = () => {
    const wal = ctx.services.get('wallet') as WalletService | undefined, fr = ctx.services.get('friends') as FriendsService | undefined;
    const v = m()?.view({ friends: fr?.data() ?? null, coins: wal?.coins() ?? 0, basket: wal?.data().basket ?? {} });
    if (!v) return null;
    return {
      done: v.done, total: v.total, canGive: v.canGive,
      projects: v.entries.map((e) => ({
        id: e.def.id, status: e.status, ready: e.ready, pending: e.pending, progress: Math.round(e.progress * 100) / 100,
        done: e.state.done || null, unveiled: e.state.unveiled || null, restored: scene()?.restored(e.def.id) ?? false,
        needs: e.needs.map((n) => ({ kind: n.kind, what: n.kind === 'item' ? n.group : n.kind === 'work' ? n.work : n.kind === 'hearts' ? n.who : 'bits', have: n.have, need: n.need })),
      })),
    };
  };
  return Object.assign(list, {
    complete(id: ProjectId | 'all', seen = false) {
      const ids = id === 'all' ? [...PROJECT_IDS] : isProjectId(id) ? [id] : [];
      return ids.map((x) => m()?.devComplete(x, seen) ?? false).every(Boolean) && ids.length > 0;
    },
    unveil: (id: ProjectId) => scene()?.unveil(id) ?? false,
    go: (id: ProjectId | 'board') => scene()?.go(id) ?? false,
    open: (id?: ProjectId) => { ctx.ui.projects?.(id); return true; },
    reset(id?: ProjectId) { m()?.devReset(id && isProjectId(id) ? id : undefined); return true; },
    work(kind: ValleyEventKind, n = 1) {
      if (!WORK_OF[kind]) return false;
      for (let i = 0; i < n; i++) m()?.event(kind, false);
      return true;
    },
  });
}
