/**
 * The visitors' panel (`visitors`; model/visitors.ts, docs/valley/visitors.md): Barnaby Pell's travelling cart (E on
 * him or his cart while it's parked on the square) and Odile the painter's canvas (E on her or the easel), with a tab
 * for each. The cart lists today's rare stock: what it is, Barnaby's tale about it, the price and a Buy button
 * (status is always a glyph plus a word: ✓ bought / in your yard / on your map, ○ short of bits, ■ not here). The
 * painter's tab shows the canvas as it is now (from the scene's 'visitorsScene'), how far along it is, and buys the
 * finished painting for the farmhouse wall. The foot lists the comings and goings (who's due when).
 *
 * Keys: ← / → (or 1 / 2) switch tabs, ↑ / ↓ walk the Buy buttons, Esc closes. `watchVisitors` (bound in hud.ts)
 * toasts arrivals, purchases (with where the thing landed) and the parcel post.
 */
import './visitors.css';
import { dayKey } from '../model/almanac.ts';
import { coins, decorDef } from '../model/shop.ts';
import {
  PAINTING_PRICE, VISITORS, isVisitorId, nextVisit, paintSpot, whenText,
} from '../model/visitors.ts';
import type { StockEntry, VisitorId, VisitorsChange, VisitorsService } from '../model/visitors.ts';
import type { Season } from '../model/types.ts';
import { svgIcon as S, ITEM_OUTLINE as ol, INK, icon } from './icons.ts';
import { decorIcon, COIN_ICON } from './shop.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';

/** what the scene publishes (scene/visitors: 'visitorsScene'), duck-typed */
interface SceneHandle {
  open(): boolean;
  painting(): { day: string; spot: string; season: Season; title: string; progress: number } | null;
  paintingUrl(spot: string, season: Season, day: string, progress?: number): string;
  list(): { id: string }[];
}

/** a little portrait per visitor: a Clawd in their colours under their hat */
export const VISITOR_ICON: Readonly<Record<VisitorId, string>> = Object.freeze({
  merchant: S(`<rect x="1" y="1" width="22" height="22" rx="6" fill="#fff6e0" stroke="#6a3a6e" stroke-width="1.6"/><path d="M4 21l1.5-6h13l1.5 6z" fill="#6a3a6e" ${ol}/><rect x="6" y="9.5" width="12" height="7.5" rx="1" fill="#6a7a9a" ${ol}/><rect x="8.4" y="11.5" width="1.6" height="2.4" fill="${INK}"/><rect x="14" y="11.5" width="1.6" height="2.4" fill="${INK}"/><path d="M2.5 9.5h19" stroke="#3a2e3a" stroke-width="2.2" stroke-linecap="round"/><path d="M7.5 9.5c0-3 2-4.8 4.5-4.8s4.5 1.8 4.5 4.8z" fill="#3a2e3a" ${ol}/><path d="M7.6 8.4h8.8" stroke="#c9962a" stroke-width="1.2"/>`),
  painter: S(`<rect x="1" y="1" width="22" height="22" rx="6" fill="#fff6e0" stroke="#c8303a" stroke-width="1.6"/><path d="M4.5 21l1.5-5.5h12l1.5 5.5z" fill="#f4ecdc" ${ol}/><circle cx="8" cy="19" r=".9" fill="#3f78c8"/><circle cx="15.5" cy="18" r=".9" fill="#d9453b"/><rect x="6" y="9.5" width="12" height="7.5" rx="1" fill="#d88aa0" ${ol}/><rect x="8.4" y="11.5" width="1.6" height="2.4" fill="${INK}"/><rect x="14" y="11.5" width="1.6" height="2.4" fill="${INK}"/><path d="M5.5 9.8c0-3.2 2.8-5 6.8-5 3.2 0 5.7 1.3 6.2 3.6-1.5 1-4 1.4-6.5 1.4z" fill="#c8303a" ${ol}/><path d="M12.4 4.8v-1.4" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`),
  postie: S(`<rect x="1" y="1" width="22" height="22" rx="6" fill="#fff6e0" stroke="#c0392b" stroke-width="1.6"/><rect x="6" y="9.5" width="12" height="7.5" rx="1" fill="#a8a0c8" ${ol}/><rect x="8.4" y="11.5" width="1.6" height="2.4" fill="${INK}"/><rect x="14" y="11.5" width="1.6" height="2.4" fill="${INK}"/><path d="M6.5 9.5c0-3 2.4-4.6 5.5-4.6s5.5 1.6 5.5 4.6z" fill="#c0392b" ${ol}/><path d="M5 9.6h9" stroke="#7a1f18" stroke-width="1.8" stroke-linecap="round"/><rect x="13.5" y="15" width="6.5" height="5" rx="1" fill="#7a5232" ${ol}/><path d="M6 21l12-6" stroke="#4a3220" stroke-width="1.2"/>`),
});
const LURE_ICON = S(`<path d="M12 2.5v4" stroke="${INK}" stroke-width="1.3"/><circle cx="12" cy="7.5" r="1.3" fill="none" stroke="${INK}" stroke-width="1.2"/><path d="M12 9c3.6 1.5 4.6 5.3 2.6 9-2 2.6-4.6 2.6-5.6 0-1.3-3.6-.6-7 3-9z" fill="#d8dfe8" ${ol}/><path d="M11 12.5c1.4.5 2 1.8 1.6 3.3" fill="none" stroke="#b59cff" stroke-width="1.4" stroke-linecap="round"/><path d="M10 20.5l-1.5 1.5M12 21v2M14 20.5l1.5 1.5" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`);
const MAP_ICON = S(`<path d="M3 6l6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z" fill="#e8d6a8" ${ol}/><path d="M9 3.5v14.5M15 6v14.5" stroke="${INK}" stroke-width=".9" opacity=".45"/><path d="M5 15c2-1.2 3 .4 5-1.6" fill="none" stroke="#3f95d8" stroke-width="1.4"/><path d="M14.5 9.5l3 3M17.5 9.5l-3 3" stroke="#c0392b" stroke-width="1.8" stroke-linecap="round"/><path d="M6 8.5c1.5.3 2.5 1.5 3.5 3" fill="none" stroke="#7a5236" stroke-width="1" stroke-dasharray="1.4 1.2"/>`);
const SEED_ICON = S(`<path d="M5 4h14v16H5z" fill="#e8d6a8" ${ol}/><path d="M5 8h14" stroke="${INK}" stroke-width="1"/><path d="M9 17c0-2 1.5-3.2 3-3.2s3 1.2 3 3.2z" fill="#2f5a34"/><path d="M10 12l2-3 2 3-2 1.5z" fill="#f4f6ff" ${ol}/><circle cx="12" cy="11.4" r=".7" fill="#fff4b0"/><path d="M8 6h8" stroke="#6a3a6e" stroke-width="1.4"/>`);
const EASEL_ICON = S(`<path d="M7 21l4-15M17 21l-4-15M12 6v15" stroke="#a0703f" stroke-width="1.6" stroke-linecap="round"/><rect x="5.5" y="4.5" width="13" height="10" rx=".6" fill="#efe6d2" ${ol}/><path d="M6.5 11c2-1.5 4-1.8 6-.6s3.5.9 5 0v3h-11z" fill="#7fb84e"/><circle cx="15" cy="7.4" r="1.3" fill="#f2c33a"/>`);

export function stockIcon(e: StockEntry): string {
  if (e.def.kind === 'lure') return LURE_ICON;
  if (e.def.kind === 'map') return MAP_ICON;
  if (e.def.kind === 'seed') return SEED_ICON;
  return decorIcon(e.def.decor ?? '');
}

const svc = (ctx: HudCtx): VisitorsService | null => { try { return (ctx.b?.service?.('visitors') as VisitorsService | undefined) ?? null; } catch { return null; } };
const sceneOf = (ctx: HudCtx): SceneHandle | null => { try { return (ctx.b?.service?.('visitorsScene') as SceneHandle | undefined) ?? null; } catch { return null; } };
const halt = (ctx: HudCtx): boolean => { try { return !!(ctx.b?.service?.('projects') as { data(): { p: { halt?: { done: number } } } } | undefined)?.data().p.halt?.done; } catch { return false; } };
const purse = (ctx: HudCtx): number => { try { return ctx.b?.wallet?.()?.coins() ?? 0; } catch { return 0; } };

/** where a purchase lands, in words (the panel's message and the toast's second line) */
export function landsText(kind: string, decor?: string): string {
  if (kind === 'lure') return 'Tied on for today: the rarer fish bite more often (the pond, the river).';
  if (kind === 'map') return 'Marked on your map (M): something hidden by the waterfall.';
  if (kind === 'seed') return 'Planted in your yard, behind the farmhouse: they open at dusk.';
  return `It's in your yard, behind the farmhouse${decor && decorDef(decor)?.glow ? ' (it lights up after dark)' : ''}.`;
}

function lockWord(e: StockEntry, here: boolean): { glyph: string; word: string; cls: string } {
  if (e.lock === 'bought') return { glyph: '✓', word: 'Bought today', cls: 'done' };
  if (e.lock === 'owned') return { glyph: '✓', word: 'Already in your yard', cls: 'done' };
  if (e.lock === 'known') return { glyph: '✓', word: 'Already on your map', cls: 'done' };
  if (!here) return { glyph: '■', word: 'Barnaby isn\'t trading right now', cls: 'away' };
  if (e.lock === 'coins') return { glyph: '○', word: 'Not enough bits', cls: 'poor' };
  return { glyph: '●', word: 'In stock: one of a kind', cls: 'ok' };
}

export function createVisitorsPanel(ctx: HudCtx): Panel {
  const { el, body, head, closeBtn } = framePanel('visitors', 'Visitors', VISITOR_ICON.merchant);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const plaqueText = head.querySelector('.vh-plaque span:last-child') as HTMLElement | null;
  const plaqueIco = head.querySelector('.vh-plaque .vh-ico') as HTMLElement | null;
  let who: 'merchant' | 'painter' = 'merchant', sig = '';
  const tabs = h('div.vh-vs-tabs', { role: 'tablist', 'aria-label': 'Visitors' });
  const page = h('div.vh-vs-page', { 'data-testid': 'visitor-page', role: 'tabpanel' });
  const msg = h('div.vh-vs-msg', { role: 'status', 'aria-live': 'polite', 'data-testid': 'visitor-msg' });
  const foot = h('div.vh-vs-foot', { 'data-testid': 'visitor-foot' });
  body.replaceChildren(tabs, page, msg, foot);

  const tabBtn = (id: 'merchant' | 'painter', n: number) => {
    const b = h('button.vh-vs-tab', { type: 'button', role: 'tab', 'data-testid': `visitor-tab-${id}`, title: `${n}: ${VISITORS[id].title}` },
      h('span.ico', { html: VISITOR_ICON[id] }), h('span', { text: VISITORS[id].short }), h('span.sub', { text: VISITORS[id].title }));
    b.addEventListener('click', () => { if (who !== id) { who = id; msg.textContent = ''; ctx.sfx('page'); render(true); } });
    return b;
  };
  const tM = tabBtn('merchant', 1), tP = tabBtn('painter', 2);
  tabs.append(tM, tP);

  const status = (glyph: string, word: string, cls: string, testid?: string) =>
    h(`span.vh-vs-status.${cls}`, testid ? { 'data-testid': testid } : null, h('span.g', { text: glyph, 'aria-hidden': 'true' }), word);
  const priceTag = (n: number) => h('span.vh-price', null, icon(COIN_ICON), h('b', { text: n.toLocaleString('en-US') }));

  function merchantPage(m: VisitorsService, day: string): HTMLElement[] {
    const d = VISITORS.merchant;
    const here = !!sceneOf(ctx)?.open();
    const next = nextVisit('merchant', day, { halt: halt(ctx) });
    const st = here ? status('●', `Trading on the square until ${hh(d.leave)}`, 'ok', 'visitor-status') : status('■', `Not here now · next ${whenText(next)}`, 'away', 'visitor-status');
    const top = h('header.vh-vs-head', null, h('span.big', { html: VISITOR_ICON.merchant }),
      h('div', null, h('h3', { text: d.name }), h('div.where', { text: `${d.title} · ${d.when}` }), st));
    const blurb = h('p.vh-vs-note', { text: d.blurb + ' One of each per visit; no haggling.' });
    const rows = h('div.vh-vs-stock', { 'data-testid': 'visitor-stock' });
    for (const e of m.stock(day)) {
      const lw = lockWord(e, here);
      const btn = h('button.vh-btn.gold.small', { type: 'button', 'data-testid': `visitor-buy-${e.def.id}`, 'aria-label': `Buy the ${e.def.name} for ${e.price} bits` }, icon(COIN_ICON), e.lock === 'bought' || e.lock === 'owned' || e.lock === 'known' ? 'Sold' : `Buy · ${e.price}`) as HTMLButtonElement;
      btn.disabled = !here || !!e.lock;
      btn.addEventListener('click', () => {
        const r = m.buy(e.def.id, day, !!sceneOf(ctx)?.open());
        if (r.ok) { ctx.sfx('coins'); msg.textContent = `Bought: ${r.def.name}. ${landsText(r.def.kind, r.def.decor)}`; }
        else { ctx.sfx('oops'); msg.textContent = r.reason === 'coins' ? 'Not enough bits for that one.' : r.reason === 'closed' ? 'Barnaby isn\'t trading right now.' : r.reason === 'bought' ? 'Only one of each per visit, friend.' : 'That one isn\'t for sale.'; }
        render(true);
      });
      rows.append(h(`div.vh-vs-item.${lw.cls}`, { 'data-testid': `visitor-item-${e.def.id}` },
        h('span.ico', { html: stockIcon(e) }),
        h('div.what', null, h('b', { text: e.def.name }), h('span.sub', { text: e.def.blurb }), h('span.tale', { text: `"${e.def.tale}"` }),
          h(`span.vh-vs-status.${lw.cls}`, null, h('span.g', { text: lw.glyph, 'aria-hidden': 'true' }), lw.word)),
        h('div.acts', null, priceTag(e.price), btn)));
    }
    return [top, blurb, rows];
  }

  function painterPage(m: VisitorsService, day: string): HTMLElement[] {
    const d = VISITORS.painter;
    const sc = sceneOf(ctx);
    const p = sc?.painting() ?? null;
    const owned = p ? m.data().paintings.find((x) => x.day === p.day) : undefined;
    const next = nextVisit('painter', day, { halt: halt(ctx) });
    const st = p ? (owned ? status('✓', 'Sold to you', 'done', 'visitor-status') : p.progress >= 1 ? status('▲', 'Finished: for sale', 'ready', 'visitor-status') : status('●', `Painting · ${Math.round(p.progress * 100)}% done`, 'ok', 'visitor-status'))
      : status('■', `Not painting now · next ${whenText(next)}`, 'away', 'visitor-status');
    const top = h('header.vh-vs-head', null, h('span.big', { html: VISITOR_ICON.painter }),
      h('div', null, h('h3', { text: d.name }), h('div.where', { text: `${d.title} · ${d.when}` }), st));
    const kids: HTMLElement[] = [top, h('p.vh-vs-note', { text: d.blurb })];
    if (p && sc) {
      const img = h('img.vh-vs-canvas', { src: sc.paintingUrl(p.spot, p.season, p.day, p.progress), alt: `${p.title}, ${Math.round(p.progress * 100)}% painted`, 'data-testid': 'visitor-canvas' });
      const bar = h('span.vh-vs-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(p.progress * 100)) }, h('i', { style: { width: `${Math.round(p.progress * 100)}%` } }));
      const btn = h('button.vh-btn.gold', { type: 'button', 'data-testid': 'visitor-buy-painting' }, icon(COIN_ICON), owned ? 'Yours' : `Buy for the farmhouse · ${PAINTING_PRICE}`) as HTMLButtonElement;
      btn.disabled = !!owned || p.progress < 1 || purse(ctx) < PAINTING_PRICE;
      btn.addEventListener('click', () => {
        const r = m.buyPainting(p.day, p.spot, p.season, sceneOf(ctx)?.painting()?.progress ?? 0);
        if (r.ok) { ctx.sfx('coins'); msg.textContent = `"${r.painting.title}" is yours: it hangs in the farmhouse, over the fish tank.`; }
        else { ctx.sfx('oops'); msg.textContent = r.reason === 'unfinished' ? 'Not finished yet: she paints until three.' : r.reason === 'coins' ? 'Not enough bits for the painting.' : 'That one is already yours.'; }
        render(true);
      });
      const why = owned ? 'It hangs in the farmhouse, over the fish tank.' : p.progress < 1 ? 'Still wet: she finishes around three o\'clock. Come back then.' : purse(ctx) < PAINTING_PRICE ? `You need ${coins(PAINTING_PRICE)}.` : 'For the farmhouse wall, over the fish tank.';
      kids.push(h('div.vh-vs-easel', null, img, h('div.what', null, h('b', { text: p.title }), h('span.sub', { text: `Painted ${paintSpot(p.spot)?.name ?? 'in the valley'}` }), bar, h('span.sub', { text: why }), btn)));
    } else kids.push(h('p.vh-vs-none', { text: 'Odile isn\'t at her easel right now. She comes on fair days and paints from ten till three.' }));
    const hung = m.data().paintings;
    if (hung.length) kids.push(h('p.vh-vs-hung', { text: `On your wall: ${hung[hung.length - 1].title}${hung.length > 1 ? ` (and ${hung.length - 1} more in the attic)` : ''}.` }));
    return kids;
  }

  function render(force = false): void {
    const m = svc(ctx);
    if (!m) { page.replaceChildren(h('p.vh-vs-none', { text: 'Nobody is visiting just now.' })); return; }
    const day = dayKey(Date.now());
    const sc = sceneOf(ctx);
    const p = sc?.painting();
    const s = `${who}|${m.version}|${purse(ctx)}|${sc?.open()}|${p ? `${p.spot}|${Math.round(p.progress * 20)}` : '-'}|${day}`;
    if (!force && s === sig) return;
    sig = s;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null;
    if (plaqueText) plaqueText.textContent = VISITORS[who].title;
    if (plaqueIco) plaqueIco.innerHTML = VISITOR_ICON[who];
    for (const [b, id] of [[tM, 'merchant'], [tP, 'painter']] as const) { b.classList.toggle('sel', who === id); b.setAttribute('aria-selected', String(who === id)); }
    page.replaceChildren(...(who === 'merchant' ? merchantPage(m, day) : painterPage(m, day)));
    // comings and goings
    const c = { halt: halt(ctx) };
    const rows = (['merchant', 'painter', 'postie'] as const).map((id) => {
      const n = nextVisit(id, day, c);
      const text = id === 'postie' && !c.halt ? 'once the train halt is restored' : whenText(n);
      return h('span.vh-vs-next', null, h('span.ico', { html: VISITOR_ICON[id] }), h('b', { text: VISITORS[id].short }), ` ${text}`);
    });
    foot.replaceChildren(h('span.lbl', { text: 'Comings & goings:' }), ...rows, h('span.purse', null, icon(COIN_ICON), `${coins(purse(ctx))}`));
    if (focusKey) (el.querySelector(`[data-testid="${focusKey}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.vh-vs-page button')];
  return {
    id: 'visitors', el,
    onOpen(arg) {
      msg.textContent = '';
      if (arg === 'painter' || arg === 'merchant') who = arg;
      else if (isVisitorId(arg)) who = 'merchant';
      render(true);
      (el.querySelector('.vh-vs-tab.sel') as HTMLElement | null)?.focus({ preventScroll: true });
    },
    refresh() { render(); },
    key(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === '1' || e.key === '2') {
        const next = e.key === '1' ? 'merchant' : e.key === '2' ? 'painter' : who === 'merchant' ? 'painter' : 'merchant';
        if (next !== who) { who = next; msg.textContent = ''; ctx.sfx('page'); render(true); }
        (el.querySelector('.vh-vs-tab.sel') as HTMLElement | null)?.focus({ preventScroll: true });
        return true;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const bs = buttons();
        if (!bs.length) return false;
        const i = bs.indexOf(document.activeElement as HTMLButtonElement);
        const j = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length;
        bs[j].focus({ preventScroll: true });
        return true;
      }
      return false;
    },
  };
}

const hh = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** Toasts for the visitors: an arrival (once a day each), a purchase and where it landed, a parcel off the train. */
export function watchVisitors(ctx: HudCtx, m: VisitorsService): void {
  m.onChange((c: VisitorsChange) => {
    if (c.kind === 'arrive') {
      const d = VISITORS[c.id];
      const sub = c.id === 'merchant' ? `${d.name}'s cart is on the square until ${hh(d.leave)}: rare goods, one of each`
        : c.id === 'painter' ? `${d.short} is painting in the valley today; the canvas is for sale when it's done`
        : `${d.short} is walking a parcel up from the halt to your mailbox`;
      const text = c.id === 'merchant' ? 'The travelling merchant is in the valley' : c.id === 'painter' ? 'A wandering painter has come' : 'The parcel post is off the train';
      ctx.toast({ text, sub, icon: VISITOR_ICON[c.id], level: 'info', ms: 8000, key: `visitor|${c.id}|${c.day}`, group: 'visitor',
        open: c.id === 'postie' ? undefined : () => ctx.panels.open('map'), openTitle: 'Open the map' });
    } else if (c.kind === 'buy') {
      ctx.toast({ text: `Bought from Barnaby: ${c.def.name}`, sub: landsText(c.def.kind, c.def.decor), icon: c.def.kind === 'lure' ? LURE_ICON : c.def.kind === 'map' ? MAP_ICON : c.def.kind === 'seed' ? SEED_ICON : decorIcon(c.def.decor ?? ''), level: 'good', ms: 7000, key: `vbuy|${c.def.id}|${c.day}` });
    } else if (c.kind === 'painting') {
      ctx.toast({ text: 'A painting for the farmhouse', sub: `"${c.painting.title}" hangs over the fish tank`, icon: EASEL_ICON, level: 'good', ms: 7000, key: `vpaint|${c.painting.day}` });
    } else if (c.kind === 'parcel') {
      ctx.toast({ text: 'A parcel came on the morning train', sub: 'Ned left it in your mailbox (J)', icon: VISITOR_ICON.postie, level: 'good', ms: 7000, key: `vparcel|${c.parcel.day}`, open: () => ctx.panels.open('mailbox'), openTitle: 'Open the mailbox' });
      ctx.sfx('mail');
    }
  });
}
