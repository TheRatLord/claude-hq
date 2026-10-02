/**
 * The General store panel (and your pockets): three tabs over the player's wallet (model/wallet.ts, model/shop.ts).
 *
 *   Shop    the store's shelves: yard decor with prices that climb per copy, some stocked only from an Almanac rank or
 *           in a season. Buying needs you at the store (its cart south-east of the square); elsewhere it's a catalogue
 *           with a "walk there" button.
 *   Basket  everything you've found and not sold yet, with what Bram pays. Selling needs Bram (at the shipping bin)
 *           or the store.
 *   Yard    your decor: a little map of the yard's 15 spots behind the farmhouse (click a piece, then a spot), and per
 *           piece: place it in the world (pick it up and look where it goes), turn, restyle, put away.
 *
 * Also here: the coin chip on the status sign (bits in your pocket; "+4" floats up when your farmers' work pays) and
 * the toasts for buying and selling. Opened by the store / Bram / the yard sign (`UiPort.shop`), the coin chip, or I.
 */
import './shop.css';
import type { Season } from '../model/types.ts';
import { RANKS } from '../model/almanac.ts';
import { collectDef } from '../model/collection.ts';
import { DECOR, coins, decorDef, sellPrice } from '../model/shop.ts';
import { friendDef } from '../model/friends.ts';
import type { DecorDef } from '../model/shop.ts';
import { WORK_CAP, YARD_SLOTS } from '../model/wallet.ts';
import type { Piece, ShopEntry, WalletChange, WalletService } from '../model/wallet.ts';
import { collectIcon } from './collection.ts';
import { ICONS, INK, ITEM_OUTLINE as ol, icon, svgIcon as S } from './icons.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';

/** what the panel needs from the scene's yard (service 'yard', scene/yard/yard.ts) */
export interface YardPort {
  carry(uid: number): void;
  carrying(): number | null;
  cancel(): void;
  goto(): void;
  gotoStore(): void;
}
export type ShopTab = 'buy' | 'sell' | 'yard';
/** where the panel was opened: at the store (buy + sell), with Bram (sell), anywhere else (look only) */
export type ShopAt = 'store' | 'bram' | 'pocket';


/** a copper bit stamped with a sprout */
export const COIN_ICON = S(`<circle cx="12" cy="12" r="9.5" fill="#e0913f" ${ol}/><circle cx="12" cy="12" r="7" fill="none" stroke="#a85f22" stroke-width="1.2"/>`
  + `<path d="M12 17v-5.5" stroke="#3f7f2c" stroke-width="1.6" stroke-linecap="round"/><path d="M12 12c-2.6 0-4-1.4-4-3.8 2.6 0 4 1.4 4 3.8zM12 11c0-2.3 1.4-3.8 4-3.8 0 2.4-1.4 3.8-4 3.8z" fill="#7cc25a" stroke="#3f7f2c" stroke-width="1"/>`);
const LOCK_ICON = S(`<rect x="5" y="10.5" width="14" height="10.5" rx="2" fill="#c8955a" ${ol}/><path d="M8 10.5V8a4 4 0 018 0v2.5" fill="none" ${ol}/><circle cx="12" cy="15.5" r="1.6" fill="${INK}"/>`);
const BASKET_ICON = S(`<path d="M3.5 10h17l-2 10h-13z" fill="#c8955a" ${ol}/><path d="M7 10c0-4 2.2-6.5 5-6.5s5 2.5 5 6.5" fill="none" ${ol}/><path d="M6 13.5h12M6.8 17h10.4M9 10v10M15 10v10" stroke="#8a5a32" stroke-width="1"/>`);
const YARD_ICON = S(`<path d="M3 20h18" stroke="#5fae45" stroke-width="2"/><path d="M4 20v-7M8 20v-7M16 20v-7M20 20v-7M3 15h18" stroke="#fff6e0" stroke-width="1.8"/><path d="M4 20v-7M8 20v-7M16 20v-7M20 20v-7" stroke="${INK}" stroke-width=".8" opacity=".5"/><path d="M12 20v-6" stroke="#4e8a36" stroke-width="1.6"/><circle cx="12" cy="9" r="4.5" fill="#e0574a" ${ol}/><circle cx="12" cy="9" r="1.6" fill="#ffd23f"/>`);

/** A little hand-drawn icon per decor item (style tints where it matters). */
export function decorIcon(id: string, style = 0): string {
  const d = decorDef(id);
  const c = d?.color ?? '#c8955a';
  switch (id) {
    case 'planter': { const f = [['#e0483c', '#f08a2c', '#ffd23f'], ['#8e5fc2', '#6a8ad8', '#fff'], ['#f6c830', '#f6c830', '#f08a2c']][style] ?? ['#e0483c', '#f08a2c', '#ffd23f'];
      return S(`<path d="M5 12h14l-1.5 9h-11z" fill="#a0703f" ${ol}/><path d="M5.5 15h13M6 18h12" stroke="#4a3b33" stroke-width="1.2"/><circle cx="8" cy="10" r="2.6" fill="${f[0]}" ${ol}/><circle cx="12" cy="8" r="2.6" fill="${f[1]}" ${ol}/><circle cx="16" cy="10" r="2.6" fill="${f[2]}" ${ol}/>`); }
    case 'flamingo': return S(`<path d="M10 21l1-8M13 21l-.5-8" stroke="#e07a98" stroke-width="1.4"/><ellipse cx="11" cy="12" rx="6" ry="3.6" fill="#f08aa8" ${ol}/><path d="M15 11c1-3 0-5 1-7" fill="none" stroke="#f08aa8" stroke-width="2.6" stroke-linecap="round"/><circle cx="16.5" cy="4" r="2" fill="#f08aa8" ${ol}/><path d="M18 4.5l2.5 1.5-2 .5z" fill="${INK}"/>`);
    case 'gnome': case 'goldgnome': { const hat = id === 'goldgnome' ? '#f2c33a' : ['#d9453b', '#3f78c8', '#5cae4f'][style] ?? '#d9453b'; const body = id === 'goldgnome' ? '#f2c33a' : '#3f78c8';
      return S(`<path d="M7 21l1.5-8h7l1.5 8z" fill="${body}" ${ol}/><circle cx="12" cy="11" r="3" fill="${id === 'goldgnome' ? '#f2c33a' : '#f2c6a0'}" ${ol}/><path d="M9 12.5c0 3 1.5 5 3 5.5 1.5-.5 3-2.5 3-5.5z" fill="#fff" ${ol}/><path d="M8 9.5L12 1.5l4 8z" fill="${hat}" ${ol}/>`); }
    case 'birdhouse': return S(`<path d="M11 13h2v9h-2z" fill="#6e4a2a" ${ol}/><rect x="7" y="7" width="10" height="7" fill="#5a8fd6" ${ol}/><path d="M5.5 7.5L12 2.5l6.5 5z" fill="#c2533e" ${ol}/><circle cx="12" cy="10.3" r="1.5" fill="${INK}"/>`);
    case 'chime': return S(`<path d="M5 22V4c0-2 4-2 4 0v2" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><path d="M6 7h6" stroke="#cf9c63" stroke-width="2.4"/><path d="M7 8v8M9 8v10M11 8v7" stroke="#c08a5a" stroke-width="1.6" stroke-linecap="round"/>`);
    case 'petbed': return S(`<ellipse cx="12" cy="15" rx="9.5" ry="5" fill="#c95f4a" ${ol}/><ellipse cx="12" cy="14" rx="6.5" ry="3" fill="#e8d6b8" ${ol}/><path d="M9 13.5h5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="8.8" cy="13" r="1" fill="#fff"/><circle cx="14.2" cy="14" r="1" fill="#fff"/>`);
    case 'bench': return S(`<path d="M3 10h18M3 13h18" stroke="#cf9c63" stroke-width="2.6" stroke-linecap="round"/><path d="M4 16h16" stroke="#b98555" stroke-width="2.6" stroke-linecap="round"/><path d="M5 9v12M19 9v12" stroke="#4a3b33" stroke-width="1.8"/>`);
    case 'birdbath': return S(`<path d="M10.5 12h3l1 8h-5z" fill="#b7b0a3" ${ol}/><path d="M8 20h8v1.5H8z" fill="#b7b0a3" ${ol}/><path d="M3.5 9h17c-1 3-4 4-8.5 4s-7.5-1-8.5-4z" fill="#cfc8ba" ${ol}/><path d="M6 9.5h12" stroke="#4aa3c9" stroke-width="1.6"/><circle cx="16.5" cy="6.5" r="1.8" fill="#8a6a4a" ${ol}/>`);
    case 'scarecrow': { const hat = ['<path d="M5 7h14M8 7l1-3h6l1 3" fill="#e3c86a" stroke="#7a5534" stroke-width="1.4"/>', `<path d="M6 7.5h12" stroke="${INK}" stroke-width="1.8"/><rect x="8.5" y="1.5" width="7" height="6" fill="#2b2420"/>`, `<path d="M5 7.5h14" stroke="#4a2f6a" stroke-width="1.8"/><path d="M8.5 7.5L14 0.8l1.5 6.7z" fill="#5a3a7a" ${ol}/>`][style] ?? '';
      return S(`<path d="M12 22V9M4 13h16" stroke="#8a5a32" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="9.5" r="3" fill="#e8d6a8" ${ol}/><path d="M8.5 13h7l-1 6h-5z" fill="${style === 2 ? '#6a8a3a' : '#5a7fd6'}" ${ol}/>${hat}`); }
    case 'pumpkin': return S(`<path d="M12 7c0-2 1-3 2.5-3.5" stroke="#4e8a36" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="12" cy="14" rx="9" ry="7" fill="#e8812f" ${ol}/><path d="M7.5 11.5l2 2.5h-3zM16.5 11.5l1 2.5h-3zM8 16.5c2 2 6 2 8 0l-1.5 1.5-1-1-1 1.2-1-1.2-1 1-1.5-1.5z" fill="#ffd23f" stroke="#ffd23f" stroke-width=".6"/>`);
    case 'snowman': return S(`<circle cx="12" cy="17" r="5" fill="#f4f6fa" ${ol}/><circle cx="12" cy="9.5" r="3.6" fill="#f4f6fa" ${ol}/><path d="M12 9.8l3.5 1" stroke="#ef8a2f" stroke-width="1.6" stroke-linecap="round"/><path d="M8.5 12.8h7" stroke="#d9453b" stroke-width="2"/><circle cx="10.6" cy="8.6" r=".7" fill="${INK}"/><circle cx="13.2" cy="8.6" r=".7" fill="${INK}"/>`);
    case 'sapling': return S(`<path d="M7 16h10l-1 6H8z" fill="#cf9c63" ${ol}/><path d="M12 16v-5" stroke="#7a5236" stroke-width="1.6"/><g fill="#f6b8cc" ${ol}><circle cx="9" cy="8" r="3"/><circle cx="15" cy="8" r="3"/><circle cx="12" cy="5" r="3"/><circle cx="12" cy="10" r="3"/></g>`);
    case 'parasol': return S(`<path d="M12 6v16" stroke="#fff" stroke-width="1.6"/><path d="M12 6v16" stroke="${INK}" stroke-width=".6"/><path d="M2.5 9.5C4 5 8 3 12 3s8 2 9.5 6.5z" fill="#4fb3c8" ${ol}/><path d="M9 3.6L7.5 9.5M15 3.6l1.5 5.9" stroke="#fff" stroke-width="2"/><path d="M14 21l3-6h4l-3 6" fill="none" stroke="#cf9c63" stroke-width="1.4"/>`);
    case 'lamppost': return S(`<path d="M12 9v12M9 21h6" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><path d="M9 4h6l-1 5h-4z" fill="#ffc566" ${ol}/><path d="M8 4l4-2.5L16 4z" fill="${INK}"/>`);
    case 'lights': return S(`<path d="M4 22V10a8 6 0 0116 0v12" fill="none" stroke="#cf9c63" stroke-width="2.2"/><g fill="#ffd27a" stroke="#e89a1c" stroke-width=".7"><circle cx="5" cy="7.5" r="1.2"/><circle cx="8" cy="5" r="1.2"/><circle cx="12" cy="4" r="1.2"/><circle cx="16" cy="5" r="1.2"/><circle cx="19" cy="7.5" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="21" cy="13" r="1.2"/><circle cx="3" cy="18" r="1.2"/><circle cx="21" cy="18" r="1.2"/></g>`);
    case 'topiary': return S(`<rect x="5" y="17" width="14" height="5" fill="#6e4a2a" ${ol}/><rect x="5" y="7" width="14" height="8" rx="1" fill="#5fa64a" ${ol}/><path d="M3 10h2M19 10h2" stroke="#3f7f3a" stroke-width="2.4"/><path d="M7 15v2M10 15v2M14 15v2M17 15v2" stroke="#3f7f3a" stroke-width="2"/><path d="M9 9.5v2M15 9.5v2" stroke="${INK}" stroke-width="1.6"/>`);
    // the villagers' own pieces (6 hearts) and their keepsake portraits (10 hearts)
    case 'postbox': return S(`<path d="M7 9a5 5 0 0110 0v12H7z" fill="#d9453b" ${ol}/><path d="M6 9h12" stroke="${INK}" stroke-width="1.6"/><rect x="9" y="12" width="6" height="1.6" rx=".8" fill="${INK}"/><path d="M6 21h12" stroke="${INK}" stroke-width="2"/><circle cx="12" cy="5.4" r="1" fill="#f2c33a"/>`);
    case 'crates': return S(`<rect x="3" y="12" width="9" height="8" fill="#c8955a" ${ol}/><rect x="12" y="12" width="9" height="8" fill="#b98555" ${ol}/><rect x="7" y="4.5" width="9" height="7.5" fill="#d8a86a" ${ol}/><path d="M3 16h9M12 16h9M7 8.3h9" stroke="#8a5a32" stroke-width="1"/>`);
    case 'millstone': return S(`<path d="M9 13h6v8H9z" fill="#8a5a32" ${ol}/><ellipse cx="12" cy="11" rx="9.5" ry="3.6" fill="#b7b0a3" ${ol}/><ellipse cx="12" cy="10.4" rx="2" ry=".8" fill="#6f6a60"/><path d="M5 10.5l3 1M19 10.5l-3 1M12 8l0 1.2" stroke="#8f887c" stroke-width="1"/>`);
    case 'prizepumpkin': return S(`<path d="M12 7c0-2 1-3 2.5-3.5" stroke="#4e8a36" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="11" cy="14.5" rx="9" ry="7" fill="#e8812f" ${ol}/><path d="M7 9.5c-1 3-1 7 0 10M15 9.5c1 3 1 7 0 10M11 8v13" stroke="#c8661f" stroke-width="1"/><circle cx="18.5" cy="9" r="3" fill="#3f78c8" ${ol}/><path d="M17.5 11.5l-1 4 2-1.2 2 1.2-1-4" fill="#3f78c8" ${ol}/><circle cx="18.5" cy="9" r="1.2" fill="#f2c33a"/>`);
    case 'tent': return S(`<path d="M2.5 20L12 4.5 21.5 20z" fill="#b8a46a" ${ol}/><path d="M12 4.5L9 20h6z" fill="#5a4a2a" ${ol}/><path d="M12 4.5v-2" stroke="${INK}" stroke-width="1.4"/><path d="M12 2.5l3 1-3 1" fill="#d9453b"/>`);
    case 'vane': return S(`<path d="M12 9v12M8 21h8" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><path d="M4 12h16M12 12" stroke="${INK}" stroke-width="1"/><path d="M8 7c1-3 4-4 6-3l2 2-1 2H9z" fill="#f2c230" ${ol}/><path d="M3 6h3l-1.5 1.8L6 9.5H3z" fill="#f2c230" ${ol}/><text x="3.2" y="15.5" font-size="4" font-weight="800" fill="${INK}">W</text><text x="17.5" y="15.5" font-size="4" font-weight="800" fill="${INK}">E</text>`);
  }
  // the travelling merchant's rare pieces (model/visitors.ts)
  if (id === 'starlamp') return S(`<path d="M8 22h5M10.5 22V5c0-1.5 1-2.5 2.5-2.5h3c1 0 1.5.5 1.5 1.5V6" fill="none" stroke="#8a6420" stroke-width="1.6" stroke-linecap="round"/><path d="M14.5 7h6l-.5 8h-5z" fill="#ffd36a" ${ol}/><path d="M15.2 8.5h2v5h-1.6zM17.6 8.5h1.9l-.2 5h-1.7z" fill="#8ad0ff"/><path d="M15.2 11h2M17.6 11h1.9" stroke="#b59cff" stroke-width="1.6"/><path d="M14 7l3.5-2.5L21 7z" fill="#c9962a" ${ol}/><circle cx="6" cy="9" r=".9" fill="#ffd36a"/><circle cx="4.5" cy="14" r=".7" fill="#ff8a8a"/>`);
  if (id === 'sundial') return S(`<path d="M8 22h8l-1-2H9z" fill="#b7b0a3" ${ol}/><path d="M9.6 20l.8-9h3.2l.8 9z" fill="#cfc8ba" ${ol}/><ellipse cx="12" cy="10" rx="8" ry="3" fill="#5f9a7a" ${ol}/><path d="M7 10l6-5.5V10z" fill="#3f7a5a" ${ol}/><path d="M5.5 10.4l1 .3M18.5 10.4l-1 .3M12 12.6v.8" stroke="#2f5a44" stroke-width="1"/>`);
  if (id === 'moonflower') return S(`<path d="M6 14h12l-1.5 8h-9z" fill="#b8b2a6" ${ol}/><path d="M5.5 13.5h13" stroke="${INK}" stroke-width="1.6"/><circle cx="9" cy="12" r="2.6" fill="#2f5a34"/><circle cx="15" cy="12" r="2.6" fill="#2f5a34"/><path d="M8 4l3 5-4 1zM16 3l1 6-4-.5zM12 6l2 5h-4z" fill="#f4f6ff" ${ol}/><circle cx="9" cy="8.5" r=".8" fill="#fff4b0"/><circle cx="15.5" cy="7.5" r=".8" fill="#fff4b0"/><circle cx="12" cy="10" r=".8" fill="#fff4b0"/>`);
  if (id === 'whirligig') return S(`<path d="M12 22V10" stroke="#6e4a2a" stroke-width="1.8"/><path d="M4 10h13" stroke="#cf9c63" stroke-width="2.2"/><path d="M4 7v6" stroke="#d9453b" stroke-width="2.6"/><path d="M19.5 10l1.5-5M19.5 10l1.5 5M19.5 10l-1.5-5M19.5 10l-1.5 5" stroke="#3f78c8" stroke-width="1.8" stroke-linecap="round"/><path d="M19.5 10l1.5-5M19.5 10l-1.5 5" stroke="#f2c33a" stroke-width="1.8" stroke-linecap="round"/><rect x="8" y="6.5" width="3" height="3" fill="#d9774a" ${ol}/><circle cx="14" cy="8.8" r="1.3" fill="#b7b0a3" ${ol}/>`);
  if (id === 'geode') return S(`<path d="M6 22l1-6h10l1 6z" fill="#6e4a2a" ${ol}/><path d="M3.5 14c0-5 3.8-8.5 8.5-8.5s8.5 3.5 8.5 8.5c-2 1.6-5 2.4-8.5 2.4S5.5 15.6 3.5 14z" fill="#6f6a64" ${ol}/><path d="M6.5 13.4c.4-3.4 2.8-5.4 5.5-5.4s5.1 2 5.5 5.4c-1.6.8-3.4 1.2-5.5 1.2s-3.9-.4-5.5-1.2z" fill="#3a2c58" ${ol}/><path d="M8.5 13.5l1-3.5 1 3.5zM13.6 13.6l1-3.2 1 3.2z" fill="#b79cff"/><path d="M11 14l1-5 1 5z" fill="#7ff0e0"/>`);
  if (id === 'welcome') return S(`<path d="M5 22V3" stroke="#8a5a32" stroke-width="2.2" stroke-linecap="round"/><path d="M5 4h14" stroke="#6e4a2a" stroke-width="1.6"/><rect x="7" y="6" width="13" height="9" rx="1" fill="#f6e8c8" ${ol}/><rect x="9.5" y="8" width="8" height="5.4" fill="#3d9fa8" ${ol}/><path d="M9.5 8l4 3 4-3" fill="none" stroke="#f6e8c8" stroke-width="1"/><circle cx="13.5" cy="11.2" r=".9" fill="#d9453b"/><rect x="9" y="18" width="12" height="4" fill="#cf9c63" ${ol}/><circle cx="11.5" cy="17.4" r="1.4" fill="#e0704a"/><circle cx="15" cy="17" r="1.4" fill="#f2c230"/><circle cx="18.5" cy="17.4" r="1.4" fill="#d06aa0"/>`);
  if (id.startsWith('keep-')) {
    const pal: Record<string, [string, string]> = { posy: ['#3d9fa8', '#2f3f6e'], bram: ['#e6c547', '#6fcf92'], hazel: ['#d9c08a', '#f1ece0'], marigold: ['#9b5a8c', '#2a2530'], fern: ['#5d8f45', '#b89a62'], nimbus: ['#6fb7e0', '#f2c230'] };
    const [body, hat] = pal[id.slice(5)] ?? [c, c];
    return S(`<path d="M6 22l3-9M18 22l-3-9M12 22v-8" stroke="#8a5a32" stroke-width="1.6" stroke-linecap="round"/><rect x="4.5" y="2.5" width="15" height="13" rx="1" fill="#c8955a" ${ol}/><rect x="6.3" y="4.3" width="11.4" height="9.4" fill="#fff1d0"/>`
      + `<rect x="8.5" y="8" width="7" height="5.7" fill="${body}" ${ol}/><rect x="10" y="9.5" width="1" height="1.6" fill="${INK}"/><rect x="13" y="9.5" width="1" height="1.6" fill="${INK}"/><path d="M8 8c.5-2 2-3 4-3s3.5 1 4 3z" fill="${hat}" ${ol}/>`);
  }
  return S(`<circle cx="12" cy="12" r="8" fill="${c}" ${ol}/>`);
}

const styleName = (d: DecorDef | undefined, p: Piece) => (d?.styles && d.styles.length > 1 ? d.styles[p.style] ?? '' : '');

/** The coin chip on the status sign: bits in your pocket, a float when real work pays. Also watches the wallet for toasts. */
export function coinChip(ctx: HudCtx): { el: HTMLElement; refresh(): void } {
  const amt = h('span.amt', { text: '0' });
  const float = h('span.float');
  const el = h('button.vh-coins', { type: 'button', title: 'Your pockets (I): bits, basket and yard', 'data-testid': 'coin-chip' }, icon(COIN_ICON), amt, float);
  el.addEventListener('click', (e) => { e.stopPropagation(); ctx.panels.toggle('shop', { tab: 'sell', at: 'pocket' }); });
  let bound: WalletService | null = null, sig = -1;
  const onChange = (c: WalletChange) => {
    if (c.kind === 'work') {
      float.textContent = `+${c.coins}`;
      float.classList.remove('go'); void float.offsetWidth; float.classList.add('go');
    } else if (c.kind === 'sell') {
      ctx.sfx('coins');
      ctx.toast({ text: `Sold ${c.n} ${c.n === 1 ? 'find' : 'finds'} for ${coins(c.coins)}`, sub: 'Bram tips his eyeshade', icon: COIN_ICON, level: 'good', key: `sell|${Date.now()}`, ms: 4000 });
    } else if (c.kind === 'buy') {
      ctx.sfx('coins');
      const d = decorDef(c.piece.id);
      ctx.toast({ text: `Bought: ${d?.name ?? c.piece.id}`, sub: c.piece.slot !== null ? 'in your yard, behind the farmhouse' : 'in storage: place it from the Yard tab (I)', icon: decorIcon(c.piece.id), level: 'good', key: `buy|${c.piece.uid}`, ms: 5000 });
    }
  };
  return {
    el,
    refresh() {
      let w: WalletService | null = null;
      try { w = ctx.b?.wallet?.() ?? null; } catch { w = null; }
      el.hidden = !w;
      if (!w) return;
      if (w !== bound) { bound = w; w.onChange(onChange); }
      if (w.version === sig) return;
      sig = w.version;
      amt.textContent = w.coins().toLocaleString('en-US');
      const n = w.basketCount();
      el.title = `${coins(w.coins())} in your pocket${n ? ` · ${n} in your basket (worth ${coins(w.basketValue())})` : ''} · I`;
    },
  };
}

export function createShopPanel(ctx: HudCtx): Panel {
  const { el, body, head, closeBtn } = framePanel('shop', 'General store', COIN_ICON);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const title = head.querySelector('.vh-plaque > span:last-child') as HTMLElement;

  const purse = h('div.amt');
  const purseSub = h('div.sub');
  const where = h('div.where');
  const tabs = h('div.vh-shop-tabs', { role: 'tablist' });
  const tabBtn = (t: ShopTab, label: string, svg: string, key: string) => {
    const b = h('button.vh-shop-tab', { type: 'button', role: 'tab', 'data-tab': t, 'data-testid': `shop-tab-${t}`, title: `${label} (${key})` }, icon(svg), h('span', { text: label }), h('span.n'));
    b.addEventListener('click', () => { if (tab !== t) { tab = t; ctx.sfx('page'); render(true); } });
    tabs.append(b);
    return b;
  };
  const tBuy = tabBtn('buy', 'Shop', COIN_ICON, '1'), tSell = tabBtn('sell', 'Basket', BASKET_ICON, '2'), tYard = tabBtn('yard', 'Yard', YARD_ICON, '3');
  const top = h('div.vh-shop-head', null, h('div.purse', null, h('div.coin', null, icon(COIN_ICON)), h('div', null, purse, purseSub)), tabs);
  const main = h('div.vh-shop-main');
  body.append(top, where, main);

  let tab: ShopTab = 'buy', at: ShopAt = 'pocket', sel = DECOR[0].id, pick: number | null = null, sig = '';
  const wallet = (): WalletService | null => { try { return ctx.b?.wallet?.() ?? null; } catch { return null; } };
  const yard = (): YardPort | null => { try { return ctx.b?.yard?.() ?? null; } catch { return null; } };
  const hearts = (id: string): number => { try { return ctx.b?.friends?.()?.hearts(id) ?? 0; } catch { return 0; } };
  const ctxOf = () => { const s = ctx.state(); return { rank: s?.almanac.rank ?? 0, season: (s?.sky.season ?? 'spring') as Season, hearts }; };
  const canBuy = () => at === 'store';
  const canSell = () => at === 'store' || at === 'bram';
  const coinTag = (n: number, cls = '') => h(`span.vh-price${cls}`, null, icon(COIN_ICON), h('b', { text: n.toLocaleString('en-US') }));
  const walkTo = (fn: (y: YardPort) => void, label: string) => {
    const b = h('button.vh-btn.small', { type: 'button' }, icon(ICONS.walk), label);
    b.addEventListener('click', () => { const y = yard(); if (!y) return; ctx.panels.close(); fn(y); });
    return b;
  };

  // ---- Shop ----
  function lockText(e: ShopEntry, season: Season): string {
    if (e.locked === 'max') return `you have all ${e.def.max}`;
    if (e.locked === 'rank') return `stocked once the valley is a ${RANKS[e.def.rank ?? 0]?.name ?? 'bigger town'}`;
    if (e.locked === 'friend') return `${friendDef(e.def.friend?.id ?? '')?.short ?? 'a villager'}'s own piece: stocked once you're friends (${e.def.friend?.hearts ?? 6} ♥)`;
    if (e.locked === 'keepsake') return e.def.gift ? 'a present: given, never sold' : 'a keepsake: given, never sold';
    if (e.def.friend) return `${friendDef(e.def.friend.id)?.short ?? 'a friend'}'s own piece, for friends only`;
    if (e.locked === 'season') return `${(e.def.seasons ?? []).join(' & ')} stock · back next ${e.def.seasons?.[0] ?? 'season'}`;
    return season && e.def.seasons ? `${season} stock: only this season` : '';
  }
  function buyView(w: WalletService): HTMLElement[] {
    const sc = ctxOf(), season = sc.season;
    const shelf = w.shop(sc);
    if (!shelf.some((e) => e.def.id === sel)) sel = shelf[0].def.id;
    const grid = h('div.vh-shop-grid', { 'data-testid': 'shop-grid' });
    for (const e of shelf) {
      const b = h(`button.item${e.def.id === sel ? '.sel' : ''}${e.locked ? '.locked' : ''}${!e.locked && !e.affordable ? '.poor' : ''}`, { type: 'button', 'data-id': e.def.id, title: e.def.name });
      const ic = h('span.ic'); ic.innerHTML = decorIcon(e.def.id);
      b.append(ic, h('span.nm', { text: e.def.name }), e.locked === 'max' ? h('span.lk', { text: 'all yours' }) : e.locked ? h('span.lk', null, icon(LOCK_ICON), e.locked === 'rank' ? RANKS[e.def.rank ?? 0]?.name ?? '' : e.locked === 'friend' ? `${friendDef(e.def.friend?.id ?? '')?.short ?? ''} ${e.def.friend?.hearts ?? 6}♥` : e.def.seasons?.[0] ?? '') : coinTag(e.price));
      if (e.owned) b.append(h('span.own', { text: `${e.owned}/${e.def.max}` }));
      if (e.def.seasons) b.append(h('span.season', { text: e.def.seasons[0][0].toUpperCase() + e.def.seasons[0].slice(1) }));
      b.addEventListener('click', () => { sel = e.def.id; ctx.sfx('ui-click'); render(true); });
      grid.append(b);
    }
    const e = shelf.find((x) => x.def.id === sel)!;
    const big = h('div.big'); big.innerHTML = decorIcon(e.def.id);
    const kids: (HTMLElement | null)[] = [big, h('div.t', { text: e.def.name }), h('div.blurb', { text: e.def.blurb })];
    const facts = [e.def.glow ? 'lights up after dark' : '', e.def.styles ? `${e.def.styles.length} styles` : '', `up to ${e.def.max} in a yard`, e.owned ? `you have ${e.owned}` : ''].filter(Boolean).join(' · ');
    kids.push(h('div.facts', { text: facts }));
    const lt = lockText(e, season);
    if (lt) kids.push(h(`div.lock${e.locked ? '' : '.ok'}`, { text: lt }));
    const buyBtn = h('button.vh-btn.gold', { type: 'button', 'data-testid': 'shop-buy' }, icon(COIN_ICON), e.locked ? 'Not in stock' : `Buy for ${coins(e.price)}`) as HTMLButtonElement;
    buyBtn.disabled = !!e.locked || !e.affordable || !canBuy();
    buyBtn.addEventListener('click', () => {
      const r = wallet()?.buy(e.def.id, { ...ctxOf(), autoPlace: true });
      if (r && !r.ok) ctx.toast({ text: r.reason === 'coins' ? 'Not enough bits' : 'Can\'t buy that right now', level: 'warn' });
      render(true);
    });
    kids.push(h('div.act', null, buyBtn));
    if (!e.locked && !e.affordable) kids.push(h('div.lock', { text: `${coins(e.price - w.coins())} short · sell your finds to Bram, and your farmers' work pays too` }));
    if (!canBuy()) kids.push(h('div.lock', null, 'Buy at the General store, south-east of the square. ', walkTo((y) => y.gotoStore(), 'Walk there')));
    return [grid, h('div.vh-shop-detail', { 'data-testid': 'shop-detail' }, ...kids)];
  }

  // ---- Basket ----
  function sellView(w: WalletService): HTMLElement[] {
    const d = w.data();
    const ids = Object.keys(d.basket).sort((a, b) => sellPrice(b) - sellPrice(a));
    const list = h('div.vh-basket', { 'data-testid': 'basket' });
    if (!ids.length) {
      list.append(h('div.empty', null, h('b', { text: 'Your basket is empty. ' }), 'Look for a glint in the grass and press E to pick things up, or cast a line at the pond or the river. Bram buys everything you find.'));
    }
    for (const id of ids) {
      const def = collectDef(id);
      if (!def) continue;
      const n = d.basket[id], p = sellPrice(id);
      const ic = h('span.ic'); ic.innerHTML = collectIcon(def);
      const one = h('button.vh-btn.small', { type: 'button', title: `Sell one for ${coins(p)}` }, 'Sell 1') as HTMLButtonElement;
      const all = h('button.vh-btn.small', { type: 'button', title: `Sell ${n} for ${coins(p * n)}` }, `All ×${n}`) as HTMLButtonElement;
      one.disabled = all.disabled = !canSell();
      one.addEventListener('click', () => { wallet()?.sell(id, 1); render(true); });
      all.addEventListener('click', () => { wallet()?.sell(id); render(true); });
      list.append(h('div.row', { 'data-id': id }, ic, h('span.nm', null, h('b', { text: def.name }), def.rare ? h('span.rare', { text: ' ★' }) : null), h('span.n', { text: `×${n}` }), h('span.each', null, coinTag(p), ' each'), one, all));
    }
    const value = w.basketValue();
    const sellAll = h('button.vh-btn.primary', { type: 'button', 'data-testid': 'basket-sell-all' }, icon(COIN_ICON), value ? `Sell everything for ${coins(value)}` : 'Nothing to sell') as HTMLButtonElement;
    sellAll.disabled = !value || !canSell();
    sellAll.addEventListener('click', () => { wallet()?.sellAll(); render(true); });
    const soldN = Object.values(d.sold).reduce((a, b) => a + b, 0);
    const foot = h('div.vh-basket-foot', null, sellAll,
      h('div.sub', { text: [soldN ? `${soldN} finds sold so far, for ${coins(d.total.sales)}` : '', `your farmers' work: ${coins(w.workToday().coins)} of ${WORK_CAP} today`].filter(Boolean).join(' · ') }));
    if (!canSell()) foot.append(h('div.lock', null, 'Sell to Bram at the shipping bin, or at the General store. ', walkTo((y) => y.gotoStore(), 'Walk to the store')));
    return [h('div.vh-basket-wrap', null, list, foot)];
  }

  // ---- Yard ----
  function yardView(w: WalletService): HTMLElement[] {
    const d = w.data();
    if (pick !== null && !d.pieces.some((p) => p.uid === pick)) pick = null;
    const map = h('div.vh-yardmap', { 'data-testid': 'yard-map' });
    // north (the back road) at the top, the farmhouse along the bottom: rows from the back of the yard
    for (let r = 2; r >= 0; r--) for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      const p = d.pieces.find((x) => x.slot === i);
      const b = h(`button.spot${p ? '.full' : ''}${p && p.uid === pick ? '.sel' : ''}${pick !== null && !p ? '.can' : ''}`, { type: 'button', 'data-slot': String(i), title: p ? decorDef(p.id)?.name ?? '' : pick !== null ? 'Put it here' : 'An empty spot' });
      if (p) { const ic = h('span.ic'); ic.innerHTML = decorIcon(p.id, p.style); ic.style.transform = `rotate(${(p.rot / 8) * 360}deg)`; b.append(ic); }
      b.addEventListener('click', () => {
        const ww = wallet();
        if (!ww) return;
        if (pick !== null && (!p || p.uid !== pick)) { ww.place(pick, i); ctx.sfx('pop'); pick = null; }
        else pick = p && p.uid !== pick ? p.uid : null;
        render(true);
      });
      map.append(b);
    }
    const mapWrap = h('div.vh-yardmap-wrap', null, h('div.cap', { text: 'back road · north gate' }), map, h('div.house', { text: 'farmhouse' }));
    const list = h('div.vh-pieces', { 'data-testid': 'yard-pieces' });
    if (!d.pieces.length) list.append(h('div.empty', null, h('b', { text: 'Nothing to place yet. ' }), 'The General store, on the meadow south-east of the square, sells yard decor for bits.'));
    const sorted = [...d.pieces].sort((a, b) => (a.slot === null ? 1 : 0) - (b.slot === null ? 1 : 0) || a.uid - b.uid);
    for (const p of sorted) {
      const def = decorDef(p.id);
      const ic = h('span.ic'); ic.innerHTML = decorIcon(p.id, p.style);
      const btn = (label: string, fn: () => void, cls = '') => { const b = h(`button.vh-btn.small${cls}`, { type: 'button' }, label); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
      const sty = styleName(def, p);
      const row = h(`div.row${p.uid === pick ? '.sel' : ''}`, { 'data-uid': String(p.uid) }, ic,
        h('span.nm', null, h('b', { text: def?.name ?? p.id }), sty ? h('span.sty', { text: ` · ${sty}` }) : null, h('span.st', { text: p.slot !== null ? 'in the yard' : 'in storage' })),
        btn(p.slot === null ? 'Place in the yard' : 'Move', () => { const y = yard(); if (!y) return; ctx.panels.close(); y.carry(p.uid); }, '.primary'),
        btn('Turn', () => { wallet()?.rotate(p.uid, 1); render(true); }),
        def?.styles && def.styles.length > 1 ? btn('Restyle', () => { wallet()?.restyle(p.uid); render(true); }) : null,
        p.slot !== null ? btn('Put away', () => { wallet()?.store(p.uid); render(true); }) : null);
      row.addEventListener('click', () => { pick = pick === p.uid ? null : p.uid; render(true); });
      list.append(row);
    }
    const placed = d.pieces.filter((p) => p.slot !== null).length;
    const help = h('div.vh-yard-help', null, h('b', { text: `${placed} of ${YARD_SLOTS} spots used. ` }),
      pick !== null ? 'Now click a spot on the map to put it there (a full spot swaps).' : 'Click a piece, then a spot on the map. Or "Place in the yard" (or "Move") to pick it up and look where it should go (E puts it down, F turns it, X puts it away).',
      ' ', walkTo((y) => y.goto(), 'Walk to my yard'));
    return [h('div.vh-yard', null, mapWrap, h('div.vh-yard-side', null, help, list))];
  }

  function render(force = false): void {
    const w = wallet();
    const s = ctx.state();
    if (!w) { main.replaceChildren(h('div.empty', { text: 'The General store isn\'t open in this valley.' })); return; }
    const nsig = `${w.version}|${tab}|${at}|${sel}|${pick}|${s?.almanac.rank}|${s?.sky.season}|${ctx.b?.friends?.()?.version ?? 0}`;
    if (!force && nsig === sig) return;
    sig = nsig;
    title.textContent = tab === 'buy' ? 'General store' : tab === 'sell' ? 'Your basket' : 'Your yard';
    purse.textContent = coins(w.coins());
    const wt = w.workToday();
    purseSub.textContent = `your farmers' work paid ${coins(wt.coins)} today${wt.left ? '' : ' (that\'s the most it pays a day)'}`;
    where.textContent = at === 'store' ? 'You\'re at the General store: buy decor, sell your finds.' : at === 'bram' ? 'Bram is at the shipping bin: he buys everything you find.' : 'Your pockets. Buy at the General store (south-east of the square); sell to Bram at the shipping bin or at the store.';
    where.className = `where ${at}`;
    for (const [b, t] of [[tBuy, 'buy'], [tSell, 'sell'], [tYard, 'yard']] as const) { b.classList.toggle('on', tab === t); b.setAttribute('aria-selected', String(tab === t)); }
    (tSell.querySelector('.n') as HTMLElement).textContent = w.basketCount() ? String(w.basketCount()) : '';
    (tYard.querySelector('.n') as HTMLElement).textContent = w.data().pieces.length ? String(w.data().pieces.length) : '';
    main.className = `vh-shop-main ${tab}`;
    main.replaceChildren(...(tab === 'buy' ? buyView(w) : tab === 'sell' ? sellView(w) : yardView(w)));
  }

  return {
    id: 'shop', el,
    onOpen(arg) {
      const a = (typeof arg === 'string' ? { tab: arg } : (arg ?? {})) as { tab?: ShopTab; at?: ShopAt };
      tab = a.tab ?? 'buy';
      at = a.at ?? 'pocket';
      pick = null;
      render(true);
    },
    refresh: () => render(),
    key(e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return false;
      const t = ({ Digit1: 'buy', Digit2: 'sell', Digit3: 'yard' } as Record<string, ShopTab>)[e.code];
      if (t) { if (tab !== t) { tab = t; ctx.sfx('page'); render(true); } return true; }
      if (e.code === 'KeyI') { ctx.panels.close(); return true; }
      return false;
    },
  };
}
