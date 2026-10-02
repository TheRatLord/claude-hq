/**
 * The Valley Projects' wiring (model/projects.ts is the pure board; scene/projects draws the places; hud/projects.ts
 * the panel; docs/valley/projects.md). main.ts creates the board here and this file feeds it:
 *
 *  - bits come out of the wallet (`spend`), items out of the basket (`take`); the glasshouse's violet goes back in;
 *  - real agent work (ValleyEvents: ship, celebrate, unblocked, finished) counts toward the open projects, never
 *    before the world has arrived (the demo flag is unknown until then) and never in a demo valley;
 *  - about once a second, and shortly after any change, it checks whether a project's needs are all met (friendship
 *    read live from the friends book), completes it, and posts the champion's thank-you letter to the mailbox
 *    (letters are re-made from the completion date and re-posted on load, like the friends' letters).
 *
 * Persisted per browser profile in `claude-valley.projects.v1`.
 */
import { createProjects, projectDef, projectLetter, PROJECTS, type ProjectsService } from './model/projects.ts';
import type { Valley } from './model/valley.ts';
import type { WalletService } from './model/wallet.ts';
import type { FriendsService } from './model/friends.ts';
import { localJson } from './storage.ts';

export const PROJECTS_KEY = 'claude-valley.projects.v1';

export interface ProjectBoardDeps {
  valley: Valley;
  wallet: WalletService;
  friends: FriendsService;
  /** the world has arrived (the demo flag is real) */
  ready: () => boolean;
}

export function installProjectBoard(d: ProjectBoardDeps): ProjectsService {
  const { valley, wallet, friends } = d;
  const board = createProjects(localJson(PROJECTS_KEY), {
    spend: (c, why) => wallet.spend(c, why),
    take: (id, n) => wallet.take(id, n),
    stash: (id, n) => wallet.stash(id, n),
  });
  const post = (id: string, at: number) => { const def = projectDef(id); if (def) valley.post(projectLetter(def, at)); };
  for (const def of PROJECTS) { const s = board.data().p[def.id]; if (s?.done) post(def.id, s.done); }
  board.onChange((c) => { if (c.kind === 'complete') post(c.id, c.at); });

  const check = () => {
    try { board.check({ friends: friends.data() }); } catch (err) { console.error('[projects] check failed', err); }
  };
  let queued = false;
  const soon = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; check(); }, 150); } };
  setInterval(check, 1000);
  friends.onChange(soon);
  board.onChange((c) => { if (c.kind === 'give' || c.kind === 'work') soon(); });
  valley.on((e) => {
    // before the world arrives the demo flag isn't known yet, so a demo's first events would count as real work
    if (!d.ready()) return;
    board.event(e.kind, valley.state.demo);
  });
  return board;
}
