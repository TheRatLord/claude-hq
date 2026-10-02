/**
 * Heart events' wiring (model/hearts.ts is pure; scene/villagers stages a scene; hud/hearts.ts shows its lines;
 * docs/valley/villagers.md). main.ts creates the service here and this file feeds it:
 *
 *  - hearts come from friendship (model/friends.ts);
 *  - the lines' flags come from the world: the grotto found (scene service 'grotto'), the restored Valley Projects
 *    (model/projects.ts `unveiled`);
 *  - keepsakes: a letter goes in the mailbox (and is re-posted on load, like the friends' letters), a yard piece is
 *    given through the wallet (`wallet.gift`: placed in the yard), and the photo is taken from the frame on screen
 *    (the HUD is DOM, so the canvas holds only the valley) into the photo album (farm/albumstore.ts).
 *
 * Persisted per browser profile in `claude-valley.hearts.v1`.
 */
import { createHearts, type HeartEvent, type HeartLetter, type HeartsService } from './model/hearts.ts';
import type { Valley } from './model/valley.ts';
import type { FriendsService } from './model/friends.ts';
import type { WalletService } from './model/wallet.ts';
import type { ProjectsService } from './model/projects.ts';
import type { AlbumService } from './albumstore.ts';
import { cropRect, fitSize, photoId, MAX_EDGE, THUMB_EDGE } from './model/album.ts';
import type { PhotoMeta } from './model/album.ts';
import { placeName } from './model/routines.ts';
import { canvas2d, develop, toBlob } from './photolab.ts';
import { localJson } from './storage.ts';

export const HEARTS_KEY = 'claude-valley.hearts.v1';

export interface HeartsBoardDeps {
  valley: Valley;
  friends: FriendsService;
  wallet: WalletService;
  projects: ProjectsService;
  /** late-bound: the scene's services (grotto, album, the villagers' days) and the canvas to photograph */
  service: (name: string) => unknown;
  renderOnce: () => void;
  canvas: HTMLCanvasElement;
}

export function installHearts(d: HeartsBoardDeps): HeartsService {
  const { valley, friends, wallet, projects } = d;
  const post = (l: HeartLetter) => valley.post({ id: l.id, at: l.at, from: l.from, fromName: l.fromName, title: l.title, body: l.body });
  const svc = createHearts(localJson(HEARTS_KEY), {
    hearts: (who) => friends.hearts(who),
    flags: () => {
      const out: string[] = [];
      try { if ((d.service('grotto') as { discovered?(): boolean } | undefined)?.discovered?.()) out.push('grotto'); } catch { /* optional */ }
      try { for (const [id, p] of Object.entries(projects.data().p ?? {})) if (p?.unveiled) out.push(`restored:${id}`); } catch { /* optional */ }
      const s = valley.state.sky;
      out.push(`season:${s.season}`);
      if (s.hour >= 20 || s.hour < 5) out.push('night');
      return out;
    },
    post,
    gift: (id) => { wallet.gift(id); },
    snap: (e) => snap(e),
  });
  for (const l of svc.data().letters) post(l);

  /** the keepsake photo: this frame, a warm filter, polaroid crop, into the album */
  async function snap(e: HeartEvent): Promise<boolean> {
    const album = d.service('album') as AlbumService | undefined;
    if (!album || e.keepsake.kind !== 'photo') return false;
    try {
      d.renderOnce();
      const c = d.canvas, W = c.width, H = c.height;
      const cr = cropRect(W, H, 'polaroid');
      const size = fitSize(cr.w, cr.h, MAX_EDGE);
      const raw = canvas2d(size.w, size.h);
      raw.g.drawImage(c, cr.x, cr.y, cr.w, cr.h, 0, 0, size.w, size.h);
      const dev = develop(raw.c, size.w, size.h, 'warm', { x: 0.5, y: 0.45, band: 0.3 });
      const ts = fitSize(size.w, size.h, THUMB_EDGE);
      const th = canvas2d(ts.w, ts.h);
      th.g.drawImage(dev, 0, 0, ts.w, ts.h);
      const [full, thumb] = await Promise.all([toBlob(dev, 'image/jpeg', 0.92), toBlob(th.c, 'image/jpeg', 0.86)]);
      if (!full || !thumb) return false;
      const at = Date.now(), s = valley.state.sky;
      const days = d.service('villagerDays') as { now?(id: string): { place: string } | null } | undefined;
      const where = days?.now?.(e.who)?.place;
      const name = friends.view(e.who)?.def.name ?? e.who.slice(9);
      const meta: PhotoMeta = {
        id: photoId(at, Math.random()), at, hour: s.hour, season: s.season, weather: s.weather.kind,
        place: where ? placeName(where as never) : 'out in the valley', who: [{ kind: 'villager', id: e.who, name }],
        caption: e.keepsake.caption, fav: false, favAt: 0, filter: 'warm', frame: 'polaroid', w: size.w, h: size.h,
      };
      const r = await album.add(meta, full, thumb);
      return r.ok;
    } catch (err) {
      console.warn('[hearts] photo', err);
      return false;
    }
  }
  return svc;
}
