/**
 * The Collections book (K, or from the Valley Almanac): every forageable and fish in the valley, as silhouettes until
 * found, then with a count, the day it was first found, the biggest catch and a line of flavour in the valley's
 * voice. Reads the live book (model/collection.ts) through `HudBindings.collection`; a first-ever find pops a toast.
 */
import './collection.css';
import { sightText, whereText } from '../model/collection.ts';
import type { CollectDef, CollectionEntry, CollectionService, SightDef, SightEntry } from '../model/collection.ts';
import { ICONS, INK, ITEM_OUTLINE as ol, KIND_ICON, icon, svgIcon as S } from './icons.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';


/** A little hand-drawn icon per collectible (the silhouette is the same drawing, blacked out by css). */
export function collectIcon(d: CollectDef): string {
  if (d.kind === 'fish') {
    const [back, belly, fin] = d.look;
    if (d.id === 'boot') return S(`<path d="M7 3h7v10l5 2c1.5.6 2 2 1.6 3.5H6z" fill="${back}" ${ol}/><path d="M6 18.5h15v2.5H6z" fill="${INK}"/><path d="M7 5.5h7" stroke="${fin}" stroke-width="1.6"/>`);
    if (d.id === 'bottle') return S(`<path d="M9.5 2.5h5v3.5l2 2.5v12a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 017.5 20.5v-12l2-2.5z" fill="${back}" ${ol} transform="rotate(35 12 12)"/><rect x="9" y="11" width="6" height="5" fill="${belly}" transform="rotate(35 12 12)"/><rect x="10" y="1.6" width="4" height="2.4" fill="${fin}" ${ol} transform="rotate(35 12 12)"/>`);
    if (d.id === 'eel') return S(`<path d="M2.5 14c3-4 5 2 8-1s4-4 7-3 3.5 2 4 3c-1 1.5-3 1.6-4.5 1-3-1-4 3-8 2.5-2.5-.3-4-1.5-6.5-2.5z" fill="${back}" ${ol}/><circle cx="18.6" cy="11.8" r=".9" fill="${INK}"/>`);
    const deep = d.id === 'bluegill' || d.id === 'carp' || d.id === 'stormbass' || d.id === 'koi';
    const ry = deep ? 5.6 : d.id === 'pike' ? 3.2 : 4.2;
    return S(`<path d="M3 7.5l4 4.5-4 4.5z" fill="${fin}" ${ol}/><path d="M9 ${12 - ry}l3-2.2 3 2.2z" fill="${fin}" ${ol}/>`
      + `<ellipse cx="13" cy="12" rx="8.5" ry="${ry}" fill="${belly}" ${ol}/><path d="M4.6 12a8.5 ${ry} 0 0117 0z" fill="${back}"/>`
      + `<ellipse cx="13" cy="12" rx="8.5" ry="${ry}" fill="none" ${ol}/><circle cx="18.2" cy="11" r="1.3" fill="#fff" ${ol}/><circle cx="18.4" cy="11" r=".55" fill="${INK}"/>`
      + (d.id === 'perch' ? `<path d="M10 8v8M13 7.5v9M16 8v7" stroke="${INK}" stroke-width="1.2" opacity=".55"/>` : '')
      + (d.id === 'trout' || d.id === 'salmon' ? `<path d="M5.5 12.5h13" stroke="${fin}" stroke-width="1.6"/>` : '')
      + (d.id === 'koi' ? `<circle cx="11" cy="10" r="2" fill="#fff"/><circle cx="15" cy="13.5" r="1.6" fill="#fff"/>` : '')
      + (d.id === 'catfish' ? `<path d="M21 13c1 1 1.5 2.5 1 4M20.5 13.5c0 1.5-.5 2.5-1.5 3.5" fill="none" stroke="${INK}" stroke-width="1"/>` : ''));
  }
  const c = d.color;
  switch (d.id) {
    case 'morel': return S(`<path d="M10 14h4v6h-4z" fill="#f1e6cc" ${ol}/><path d="M12 2.5c3.5 2 4.5 6 4 11.5H8c-.5-5.5.5-9.5 4-11.5z" fill="${c}" ${ol}/><path d="M9.5 6.5l5 2M8.8 10l6.4 1.5M12 3v11" stroke="#6e4a2a" stroke-width="1.1"/>`);
    case 'wildleek': return S(`<path d="M11 21c-1-5-6-8-7-16 4 2 6 7 7 16zM13 21c1-5 6-8 7-16-4 2-6 7-7 16z" fill="${c}" ${ol}/><path d="M11 21l1-9 1 9z" fill="#b8506a" ${ol}/>`);
    case 'violet': return S(`<path d="M12 21v-7" stroke="#4f8a3a" stroke-width="1.6"/><g fill="${c}" ${ol}><circle cx="12" cy="6" r="3"/><circle cx="7.5" cy="9.5" r="3"/><circle cx="16.5" cy="9.5" r="3"/><circle cx="9.5" cy="14" r="3"/><circle cx="14.5" cy="14" r="3"/></g><circle cx="12" cy="10.5" r="1.8" fill="#f6d23a" ${ol}/>`);
    case 'berries': return S(`<path d="M8 3c3 0 4 2 4 4-3 0-4-2-4-4zM16 3c-3 0-4 2-4 4 3 0 4-2 4-4z" fill="#5fae45" ${ol}/><path d="M12 7c4 0 6.5 2.5 6 6-.6 4-3.5 7.5-6 8-2.5-.5-5.4-4-6-8-.5-3.5 2-6 6-6z" fill="${c}" ${ol}/><g fill="#f6d86a"><circle cx="10" cy="11" r=".7"/><circle cx="14" cy="11" r=".7"/><circle cx="12" cy="14" r=".7"/><circle cx="9.5" cy="15" r=".7"/><circle cx="14.5" cy="15" r=".7"/><circle cx="12" cy="18" r=".7"/></g>`);
    case 'feather': return S(`<path d="M18.5 3c-6 1-11 7-12 14l2 1c3-1 9-7 10-15z" fill="${c}" ${ol}/><path d="M9 13l4-1M10 10.5l4.5-1M12 8l4-1" stroke="#1f2a3a" stroke-width="1.4"/><path d="M4 21l5-6" stroke="${INK}" stroke-width="1.4"/>`);
    case 'shell': return S(`<path d="M12 4c5 0 9 4 9 9-2 4-5 6-9 6s-7-2-9-6c0-5 4-9 9-9z" fill="${c}" ${ol}/><path d="M12 19V5M12 19L6 7M12 19l6-12M12 19L3.5 11M12 19l8.5-8" stroke="#c89a88" stroke-width="1"/><path d="M9 19h6v2H9z" fill="#d8b8a0" ${ol}/>`);
    case 'skipstone': return S(`<ellipse cx="12" cy="13" rx="9" ry="6" fill="${c}" ${ol}/><ellipse cx="10" cy="11.5" rx="4" ry="2" fill="#c8d0d8" opacity=".7"/>`);
    case 'chanterelle': return S(`<path d="M10 21l.8-9h2.4l.8 9z" fill="#f2a83a" ${ol}/><path d="M3 7c3 1 15 1 18 0-1 3-4 5-9 5S4 10 3 7z" fill="${c}" ${ol}/><path d="M7 9l4 2.5M17 9l-4 2.5M12 9.5v2.5" stroke="#d8802a" stroke-width="1"/>`);
    case 'acorn': return S(`<path d="M7 10h10c0 6-2.5 10-5 11-2.5-1-5-5-5-11z" fill="${c}" ${ol}/><path d="M5.5 10.5c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5z" fill="#7a5534" ${ol}/><path d="M12 5V2.5" stroke="${INK}" stroke-width="1.6"/>`);
    case 'hazelnut': return S(`<circle cx="12" cy="13" r="7" fill="${c}" ${ol}/><path d="M6 16c2 3 10 3 12 0" fill="#e8d0a0" ${ol}/><path d="M7 7c1-4 9-4 10 0l-2-1-1.5 2-1.5-2.5L10.5 8 9 6z" fill="#8a9a3f" ${ol}/>`);
    case 'mapleleaf': return S(`<path d="M12 2l2 4 3-1-1 4 4 1-3 3 2 2-5 0-1 4-1-4-5 0 2-2-3-3 4-1-1-4 3 1z" fill="${c}" ${ol}/><path d="M12 7v15" stroke="#8a3a2a" stroke-width="1.3"/>`);
    case 'holly': return S(`<path d="M4 15l2-2-1-2 3-1 0-2 3 1 1-2 1 3-2 2 1 2-3 0-1 2z" fill="${c}" ${ol}/><path d="M20 15l-2-2 1-2-3-1 0-2-3 1-1-2-1 3 2 2-1 2 3 0 1 2z" fill="${c}" ${ol}/><g fill="#d02a2a" ${ol}><circle cx="11" cy="15.5" r="2.2"/><circle cx="14" cy="16.5" r="2.2"/><circle cx="12" cy="19" r="2.2"/></g>`);
    case 'pinecone': return S(`<path d="M12 2c4 3 6 8 5 13-1 4-3 6-5 7-2-1-4-3-5-7-1-5 1-10 5-13z" fill="${c}" ${ol}/><path d="M8 9l4 2 4-2M7.3 13l4.7 2.5 4.7-2.5M8 17l4 2 4-2M12 3v18" stroke="#c8925a" stroke-width="1.1" fill="none"/>`);
    case 'crystal': return S(`<path d="M3 20c2-3 16-3 18 0z" fill="#b7b0a3" ${ol}/><path d="M10 20V7l2.5-4.5L15 7v13z" fill="${c}" ${ol}/><path d="M6 20v-7l2-3 2 3v7zM15 20v-6l2-3 2 3v6z" fill="#cdeefa" ${ol}/><path d="M12.5 3v17" stroke="#fff" stroke-width="1" opacity=".7"/>`);
  }
  return S(`<circle cx="12" cy="12" r="8" fill="${c}" ${ol}/>`);
}

/** Field-guide sketches of the wild visitors (side views; blacked out by css until seen). */
export function sightIcon(d: SightDef): string {
  const c = d.color;
  switch (d.id) {
    case 'deer': return S(`<path d="M5 13c0-3 3-4 7-4h3l2-3 1-3 1 .5-.5 2.5 2 1 1 2-2 1-2 .3-1 3c0 2-1 3-2 3v5h-1.5l-.3-4.5-4.7.4-.6 4.1H7.4L7 16c-1.5-.5-2-1.6-2-3z" fill="${c}" ${ol}/><path d="M17.6 4.5l1.6-1.8M19 6.4l2.2-.6" stroke="${INK}" stroke-width="1.1"/><circle cx="19.2" cy="8.4" r=".7" fill="${INK}"/><path d="M5 12.5c-1 0-1.6.6-1.8 1.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`);
    case 'fox': return S(`<path d="M2.5 14c2.5-3 5-2 7-2h6l2-3 .5-3 1.5 2 1.5-1v3l1.5 1.5-1 1.3-2 .2-1 2.5c-.5 1.5-1.5 2-2.5 2v3h-1.4l-.4-2.6H11l-.6 2.6H9l.2-3c-2 0-3.5-.5-6.7-.5z" fill="${c}" ${ol}/><path d="M2.5 14c-.3 1 0 2 1 2.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="19" cy="10.3" r=".7" fill="${INK}"/>`);
    case 'heron': return S(`<path d="M5 13c2-2 5-3 8-2.5l1.5-3c-.5-2 0-4 2-4.5 1.2-.2 2 .6 2 1.6l4 .9-4 .5c-1 2-2.7 3.4-2.5 5.7.2 2-1.5 3.7-4 4.3H9c-2 0-3.5-1-4-2.5z" fill="${c}" ${ol}/><path d="M11 18v4M13 18l.5 4" stroke="${INK}" stroke-width="1.2"/><path d="M17 4.2l-3-.6" stroke="${INK}" stroke-width="1"/><circle cx="17.6" cy="5.4" r=".6" fill="${INK}"/>`);
    case 'owl': return S(`<path d="M6.5 7c0-3 2.5-4.5 5.5-4.5S17.5 4 17.5 7c1 2.5 1.5 5.5 1 8.5-.6 3.4-3 5.5-6.5 5.5s-5.9-2.1-6.5-5.5c-.5-3 0-6 1-8.5z" fill="${c}" ${ol}/><circle cx="9.6" cy="8.4" r="2.4" fill="#e9cfa2" ${ol}/><circle cx="14.4" cy="8.4" r="2.4" fill="#e9cfa2" ${ol}/><circle cx="9.6" cy="8.4" r="1.1" fill="${INK}"/><circle cx="14.4" cy="8.4" r="1.1" fill="${INK}"/><path d="M12 10l-.8 1.6h1.6z" fill="#d8b860"/><path d="M8 21h8" stroke="${INK}" stroke-width="1.4"/>`);
    case 'hedgehog': return S(`<path d="M3 16c0-4.5 3.5-8 8.5-8S20 11 20.5 14l1.5 1.4-1.6 1.2c-.6 1.4-1.8 2.4-3.4 2.4H6c-1.8 0-3-1.3-3-3z" fill="${c}" ${ol}/><path d="M5 11l-1-2M8 9l-.5-2.2M11 8.3V6M14 8.5l.6-2.2M17 10l1.3-1.8M4.4 13.6l-2-.6" stroke="${INK}" stroke-width="1.1"/><path d="M17 16.5c1.5-.2 3.3-.6 4.9-1" fill="none" stroke="#d9b88e" stroke-width="1.6"/><circle cx="18.6" cy="14.4" r=".7" fill="${INK}"/>`);
    case 'geese': return S(`<path d="M2 15l4-2 2-3 1 2 4 .5-4 1.5zM9 9l3-1.5 1.5-2.5.8 1.8 3.3.3-3.3 1.3zM13.5 17l3-1.5 1.6-2.4.7 1.8 3.2.4-3.3 1.2z" fill="${c}" ${ol}/>`);
  }
  return S(`<circle cx="12" cy="12" r="8" fill="${c}" ${ol}/>`);
}

const fmtDay = (key: string | null) => (key ? new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: key.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' }) : '');

export function createCollectionPanel(ctx: HudCtx): Panel {
  const { el, body, head, closeBtn } = framePanel('collection', 'Collections', ICONS.book);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const toAlmanac = h('button.vh-col-tab', { type: 'button', title: 'Valley Almanac (H)' }, icon(ICONS.rosette), 'Almanac');
  toAlmanac.addEventListener('click', () => ctx.panels.open('almanac'));
  head.insertBefore(toAlmanac, closeBtn);

  const count = h('div.cnt');
  const fill = h('i');
  const sub = h('div.sub');
  const top = h('div.vh-col-head', null, h('div.badge', null, icon(KIND_ICON.berries)), h('div.rk', null, count, h('div.rk-bar', null, fill), sub));
  const forageGrid = h('div.vh-col-grid', { 'data-testid': 'collection-forage' });
  const fishGrid = h('div.vh-col-grid', { 'data-testid': 'collection-fish' });
  const sightGrid = h('div.vh-col-grid', { 'data-testid': 'collection-sightings' });
  const fTitle = h('div.vh-h3'), sTitle = h('div.vh-h3'), wTitle = h('div.vh-h3');
  const detail = h('div.vh-col-detail', { 'data-testid': 'collection-detail' });
  const how = h('div.vh-al-legend', null, h('b', { text: 'How to collect: ' }),
    'look for a glint in the grass and press E to pick things up (a new batch every day, by season) · look at open water by the pond or the river and press E to cast, then E again when the bobber dips · wild visitors are shy: be in the right place at the right time, come slowly and stop when they look up, and a good look adds them to the field guide · a first-ever find adds +5 to the Almanac.');
  body.append(top, h('div.vh-col-main', null, h('div.vh-col-lists', null, fTitle, forageGrid, sTitle, fishGrid, wTitle, sightGrid), detail), how);

  let selected = '';
  let sig = '';
  const book = (): CollectionService | null => { try { return ctx.b?.collection?.() ?? null; } catch { return null; } };

  function tile(e: CollectionEntry): HTMLElement {
    const t = h(`button.tile${e.found ? '.got' : ''}${e.def.id === selected ? '.sel' : ''}${e.inSeason ? '.now' : ''}`, { type: 'button', title: e.found ? e.def.name : 'Not found yet', 'data-id': e.def.id });
    const ic = h('span.ic');
    ic.innerHTML = collectIcon(e.def);
    t.append(ic, h('span.nm', { text: e.found ? e.def.name : '???' }), h('span.n', { text: e.found ? `×${e.n}` : e.inSeason ? 'in season' : '' }));
    if (e.def.rare && e.found) t.append(h('span.rare', { text: '★' }));
    t.addEventListener('click', () => { selected = e.def.id; ctx.sfx('ui-click'); sig = ''; render(); });
    return t;
  }

  function sightTile(e: SightEntry): HTMLElement {
    const t = h(`button.tile${e.found ? '.got' : ''}${e.def.id === selected ? '.sel' : ''}${e.inSeason ? '.now' : ''}`, { type: 'button', title: e.found ? e.def.name : 'Not seen yet', 'data-id': e.def.id });
    const ic = h('span.ic');
    ic.innerHTML = sightIcon(e.def);
    t.append(ic, h('span.nm', { text: e.found ? e.def.name : '???' }), h('span.n', { text: e.found ? `${e.n} ${e.n === 1 ? 'day' : 'days'}` : e.inSeason ? 'about now' : '' }));
    t.addEventListener('click', () => { selected = e.def.id; ctx.sfx('ui-click'); sig = ''; render(); });
    return t;
  }

  function sightDetail(e: SightEntry): HTMLElement[] {
    const big = h(`div.big${e.found ? '' : '.sil'}`);
    big.innerHTML = sightIcon(e.def);
    const kids: HTMLElement[] = [big, h('div.t', { text: e.found ? e.def.name : 'Not seen yet' })];
    kids.push(h('div.blurb', { text: e.found ? e.def.blurb : e.def.tip }));
    kids.push(h('div.where', null, h('b', { text: 'Look: ' }), sightText(e.def), e.inSeason ? h('span.now', { text: ' · about this season' }) : null));
    if (e.found) kids.push(h('div.facts', { text: [`Seen on ${e.n} ${e.n === 1 ? 'day' : 'days'}`, e.first ? `first on ${fmtDay(e.first)}` : '', e.last && e.last !== e.first ? `last on ${fmtDay(e.last)}` : ''].filter(Boolean).join(' · ') }));
    if (e.found) kids.push(h('div.where', null, h('b', { text: 'Tip: ' }), e.def.tip));
    return kids;
  }

  function render(): void {
    const b = book();
    const season = ctx.state()?.sky.season ?? 'spring';
    if (!b) { count.textContent = 'Collections'; sub.textContent = 'The collection book is not available here.'; return; }
    const nsig = `${b.version}|${season}|${selected}`;
    if (nsig === sig) return;
    sig = nsig;
    const v = b.view(season);
    count.textContent = `${v.found} of ${v.total} found`;
    fill.style.width = `${Math.round((v.found / Math.max(1, v.total)) * 100)}%`;
    sub.textContent = [`${v.forage.found}/${v.forage.total} forage`, `${v.fish.found}/${v.fish.total} fish`, `${v.sight.found}/${v.sight.total} wild visitors`, v.fishToday ? `${v.fishToday} caught today` : null].filter(Boolean).join(' · ');
    wTitle.replaceChildren(icon(ICONS.book), `Field guide · wild visitors · ${v.sight.found}/${v.sight.total}`);
    sightGrid.replaceChildren(...v.sightings.map(sightTile));
    const sight = v.sightings.find((x) => x.def.id === selected);
    if (sight) {
      forageGrid.replaceChildren(...v.entries.filter((e) => e.def.kind === 'forage').map(tile));
      fishGrid.replaceChildren(...v.entries.filter((e) => e.def.kind === 'fish').map(tile));
      fTitle.replaceChildren(icon(ICONS.sprout), `Forage · ${v.forage.found}/${v.forage.total}`);
      sTitle.replaceChildren(icon(ICONS.duck), `Fish & finds · ${v.fish.found}/${v.fish.total}`);
      detail.replaceChildren(...sightDetail(sight));
      return;
    }
    if (!selected || !v.entries.some((e) => e.def.id === selected)) selected = (v.entries.find((e) => e.found) ?? v.entries.find((e) => e.inSeason) ?? v.entries[0]).def.id;
    fTitle.replaceChildren(icon(ICONS.sprout), `Forage · ${v.forage.found}/${v.forage.total}`);
    sTitle.replaceChildren(icon(ICONS.duck), `Fish & finds · ${v.fish.found}/${v.fish.total}`);
    forageGrid.replaceChildren(...v.entries.filter((e) => e.def.kind === 'forage').map(tile));
    fishGrid.replaceChildren(...v.entries.filter((e) => e.def.kind === 'fish').map(tile));
    const e = v.entries.find((x) => x.def.id === selected)!;
    const big = h(`div.big${e.found ? '' : '.sil'}`);
    big.innerHTML = collectIcon(e.def);
    const facts: string[] = [];
    if (e.found) {
      facts.push(`${e.def.kind === 'fish' ? 'Caught' : 'Found'} ${e.n} ${e.n === 1 ? 'time' : 'times'}`);
      if (e.first) facts.push(`first on ${fmtDay(e.first)}`);
      if (e.best) facts.push(`biggest ${e.best} cm`);
    }
    const kids: HTMLElement[] = [big, h('div.t', { text: e.found ? e.def.name : 'Not found yet' })];
    if (e.def.rare) kids.push(h('div.tag', { text: e.found ? '★ a rare find' : '★ rare' }));
    kids.push(h('div.blurb', { text: e.found ? e.def.blurb : 'Keep an eye out. The valley will tell you more once you have found one.' }));
    kids.push(h('div.where', null, h('b', { text: e.def.kind === 'fish' ? 'Bites: ' : 'Look: ' }), whereText(e.def), e.inSeason ? h('span.now', { text: ' · in season now' }) : null));
    if (facts.length) kids.push(h('div.facts', { text: facts.join(' · ') }));
    detail.replaceChildren(...kids);
  }
  return {
    id: 'collection', el,
    onOpen(arg) { if (typeof arg === 'string') selected = arg; sig = ''; render(); },
    refresh: render,
  };
}
