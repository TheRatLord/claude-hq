/**
 * The visitors' wiring (model/visitors.ts is pure; scene/visitors walks them in and out; hud/visitors.ts is the
 * merchant's / painter's panel; docs/valley/visitors.md). main.ts creates the service here and this file feeds it:
 *
 *  - purchases are paid from the wallet (`spend`, a refund through `reward`); rare decor and the moonflower seeds go
 *    straight into the yard as gifts (`wallet.gift`: autoPlaced), the parcel's find into the basket (`stash`);
 *  - the sketch map isn't stocked once you've found the grotto yourself (the 'grotto' scene service, read lazily);
 *  - the parcel post only rides the train once the halt project is done (model/projects.ts);
 *  - each parcel posts a letter to the mailbox (re-posted on load, like the friends' letters).
 *
 * Persisted per browser profile in `claude-valley.visitors.v1`.
 */
import { createVisitors, VISITORS, type Parcel, type VisitorsService } from './model/visitors.ts';
import type { Valley } from './model/valley.ts';
import type { WalletService } from './model/wallet.ts';
import type { ProjectsService } from './model/projects.ts';
import { localJson } from './storage.ts';

export const VISITORS_KEY = 'claude-valley.visitors.v1';

export interface VisitorsBoardDeps {
  valley: Valley;
  wallet: WalletService;
  projects: ProjectsService;
  /** the secret grotto's scene service (registered by the scene after start-up) */
  grotto: () => { discovered?(): boolean } | undefined;
}

export function installVisitors(d: VisitorsBoardDeps): VisitorsService {
  const { valley, wallet, projects } = d;
  const svc = createVisitors(localJson(VISITORS_KEY), {
    spend: (c, why) => wallet.spend(c, why),
    refund: (c, why) => wallet.reward(c, why),
    giftDecor: (id) => wallet.gift(id) !== null,
    stash: (id, n) => wallet.stash(id, n),
    coins: () => wallet.coins(),
    owned: (id) => wallet.data().pieces.filter((p) => p.id === id).length,
    secretKnown: (s) => { try { return s === 'grotto' && !!d.grotto()?.discovered?.(); } catch { return false; } },
    halt: () => !!projects.data().p.halt?.done,
  });
  const post = (p: Parcel) => {
    const [y, m, dd] = p.day.split('-').map(Number);
    valley.post({ id: p.id, at: new Date(y, m - 1, dd, 10, 45).getTime(), from: 'visitor:postie', fromName: `${VISITORS.postie.name}, ${VISITORS.postie.title.toLowerCase()}`, title: p.title, body: p.body });
  };
  for (const p of svc.parcels()) post(p);
  svc.onChange((c) => { if (c.kind === 'parcel') post(c.parcel); });
  return svc;
}
