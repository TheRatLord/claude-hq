/**
 * The photo album panel (`album`; L, the pause menu, L in photo mode, E on a frame of the farmhouse photo wall):
 * a scrapbook of every photo taken in photo mode (farm/photo.ts), kept in IndexedDB by farm/albumstore.ts.
 *
 *  - The scrapbook: thumbnails as taped-in prints (all / favourites), newest first, how full the album is.
 *  - One photo: large, in its frame (developed by farm/photolab.ts with the caption as it is now), with when, where,
 *    the time of day, the weather and who is in it; edit the caption, ♥ favourite (the wall in the farmhouse shows
 *    the latest eight), download a PNG with the frame baked in, delete (asks twice). ← → step through, Esc goes
 *    back to the scrapbook.
 */
import './album.css';
import { ALBUM_CAP, CAPTION_MAX, FILTERS, dateLabel, hourText, photoFileName, timeOfDay, weatherWord } from '../model/album.ts';
import type { PhotoMeta } from '../model/album.ts';
import type { AlbumService } from '../albumstore.ts';
import { compose, decode, download, toBlob } from '../photolab.ts';
import { ICONS } from './icons.ts';
import { framePanel, h, typingIn, type HudCtx, type Panel } from './ctx.ts';

const service = (ctx: HudCtx): AlbumService | null => { try { return (ctx.b?.service?.('album') as AlbumService | undefined) ?? null; } catch { return null; } };
/** a stable little tilt per photo (−2.5°…2.5°) */
const tiltOf = (id: string) => { let x = 0; for (let i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) | 0; return ((Math.abs(x) % 50) - 25) / 10; };

export function createAlbumPanel(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('album', 'Photo album', ICONS.camera);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  let view: 'grid' | 'photo' = 'grid', tab: 'all' | 'fav' = 'all', cur: string | null = null;
  let off: (() => void) | null = null;
  const urls = new Map<string, string>();
  let big: { id: string; img: CanvasImageSource & { width: number; height: number } } | null = null;
  let confirmDel = false, recomposeT = 0, lastVersion = -1;

  const urlOf = (svc: AlbumService, id: string): string | null => {
    let u = urls.get(id);
    if (u) return u;
    const b = svc.thumb(id);
    if (!b) return null;
    u = URL.createObjectURL(b);
    urls.set(id, u);
    return u;
  };
  const dropUrls = (keep?: Set<string>) => { for (const [id, u] of urls) if (!keep?.has(id)) { URL.revokeObjectURL(u); urls.delete(id); } };

  function render(): void {
    const svc = service(ctx);
    if (!svc) { body.replaceChildren(h('p.al-empty', { text: 'The album is not available here.' })); return; }
    lastVersion = svc.version;
    if (view === 'photo' && cur && svc.get(cur)) renderPhoto(svc, svc.get(cur)!);
    else { view = 'grid'; renderGrid(svc); }
  }

  function renderGrid(svc: AlbumService): void {
    const all = svc.list();
    const favs = all.filter((p) => p.fav);
    const shown = tab === 'fav' ? favs : all;
    dropUrls(new Set(all.map((p) => p.id)));
    const tabBtn = (id: 'all' | 'fav', label: string, n: number) => {
      const b = h('button.al-tab', { type: 'button', role: 'tab', 'aria-selected': String(tab === id), 'data-testid': `album-tab-${id}` }, label, h('span', { text: String(n) }));
      b.addEventListener('click', () => { tab = id; render(); ctx.sfx('ui-click'); });
      return b;
    };
    const head = h('div.al-top', null,
      h('div.al-tabs', { role: 'tablist', 'aria-label': 'Album' }, tabBtn('all', 'Every photo', all.length), tabBtn('fav', '♥ Favourites', favs.length)),
      h('span.al-count', { text: `${all.length} of ${ALBUM_CAP} · the oldest un-hearted photos make room for new ones` }));
    const notes: HTMLElement[] = [];
    if (!svc.persistent) notes.push(h('p.al-warn', { 'data-testid': 'album-memory' }, 'This browser is not letting the valley keep files, so these photos last until you close the tab. In photo mode, X also saves each one as a PNG.'));
    const grid = h('div.al-grid', { 'data-testid': 'album-grid' });
    if (!shown.length) {
      grid.append(h('div.al-empty', null,
        h('span.al-empty-ico', { html: ICONS.camera }),
        h('b', { text: tab === 'fav' ? 'No favourites yet' : 'No photos yet' }),
        h('span', { text: tab === 'fav' ? 'Open a photo and tap ♥: your favourites hang on the wall over the farmhouse bed.' : 'Press P for photo mode, F to say cheese, Enter to snap.' })));
    }
    for (const p of shown) {
      const u = urlOf(svc, p.id);
      const card = h(`button.al-card.f-${p.frame}${p.fav ? '.fav' : ''}`, {
        type: 'button', 'data-testid': 'album-photo', 'data-id': p.id, title: `${p.caption || p.place} · ${dateLabel(p.at)}`,
        style: { '--r': `${tiltOf(p.id)}deg` },
      },
      h('i.tape'),
      u ? h('img', { src: u, alt: p.caption || p.place, loading: 'lazy', draggable: 'false' }) : h('span.al-noimg', { text: '?' }),
      h('span.cap', { text: p.caption || p.place }),
      h('span.when', { text: dateLabel(p.at) }),
      p.fav ? h('span.heart', { text: '♥', 'aria-label': 'favourite' }) : null);
      card.addEventListener('click', () => openPhoto(p.id));
      grid.append(card);
    }
    body.replaceChildren(h('div.al-book', null, head, ...notes, h('div.al-scroll', null, grid)));
  }

  function openPhoto(id: string): void {
    view = 'photo'; cur = id; confirmDel = false; big = null;
    ctx.sfx('page');
    render();
  }
  function step(dir: 1 | -1): void {
    const svc = service(ctx);
    if (!svc || !cur) return;
    const list = tab === 'fav' ? svc.list().filter((p) => p.fav) : svc.list();
    const i = list.findIndex((p) => p.id === cur);
    if (i < 0 || !list.length) return;
    openPhoto(list[(i + dir + list.length) % list.length].id);
  }

  function renderPhoto(svc: AlbumService, p: PhotoMeta): void {
    const stage = h('div.al-stage', { 'data-testid': 'album-stage' });
    const u = urlOf(svc, p.id);
    if (u) stage.append(h('img.al-placeholder', { src: u, alt: '' }));
    const input = h('input.al-caption', { type: 'text', value: p.caption, maxlength: String(CAPTION_MAX), placeholder: 'Write a caption…', 'aria-label': 'Caption', 'data-testid': 'album-caption', spellcheck: 'true', autocomplete: 'off' });
    const saveCaption = () => { if (input.value !== p.caption) void svc.update(p.id, { caption: input.value }); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); saveCaption(); input.blur(); } if (e.key === 'Escape') { e.preventDefault(); input.value = p.caption; input.blur(); } });
    input.addEventListener('blur', saveCaption);
    input.addEventListener('input', () => { clearTimeout(recomposeT); recomposeT = window.setTimeout(() => void develop(stage, p, input.value), 250); });
    const tod = timeOfDay(p.hour);
    const facts = h('dl.al-facts', null,
      h('dt', { text: 'When' }), h('dd', { text: `${dateLabel(p.at)} · ${hourText(p.hour)} ${tod.label.replace(/^(at|in) /, '(').replace(/$/, ')')}` }),
      h('dt', { text: 'Where' }), h('dd', { text: p.place, 'data-testid': 'album-place' }),
      h('dt', { text: 'Sky' }), h('dd', { text: `${weatherWord(p.weather)}, ${p.season}` }),
      h('dt', { text: 'Look' }), h('dd', { text: `${FILTERS.find((f) => f.id === p.filter)?.name ?? p.filter}${p.frame !== 'none' ? ` · ${p.frame}` : ''}` }));
    const who = h('div.al-who', { 'data-testid': 'album-who' },
      ...(p.who.length ? p.who.map((w) => h(`span.al-chip.k-${w.kind}`, { text: w.name, title: w.kind })) : [h('span.al-nobody', { text: 'nobody in frame: just the valley' })]));
    const fav = h(`button.vh-btn${p.fav ? '.gold' : ''}`, { type: 'button', 'data-testid': 'album-fav', 'aria-pressed': String(p.fav) }, p.fav ? '♥ Favourite' : '♡ Favourite');
    fav.addEventListener('click', async () => {
      const ok = await svc.update(p.id, { fav: !p.fav });
      if (!ok && !p.fav) ctx.toast({ text: 'That is a lot of favourites', sub: 'un-heart one to heart another', level: 'warn', key: 'album|favcap' });
      else ctx.sfx(p.fav ? 'ui-click' : 'chime-done');
    });
    const dl = h('button.vh-btn', { type: 'button', 'data-testid': 'album-download' }, 'Download PNG');
    dl.addEventListener('click', async () => {
      const img = await imageOf(svc, p);
      if (!img) { ctx.toast({ text: 'Could not read that photo', level: 'error' }); return; }
      const c = compose(img, p.w, p.h, p.frame, { caption: input.value || p.caption, place: p.place, at: p.at, hour: p.hour, id: p.id });
      const b = await toBlob(c, 'image/png');
      if (b) { download(b, photoFileName(p)); ctx.sfx('page'); }
    });
    const del = h('button.vh-btn.ghost', { type: 'button', 'data-testid': 'album-delete' }, confirmDel ? 'Really delete?' : 'Delete');
    if (confirmDel) del.classList.add('danger');
    del.addEventListener('click', async () => {
      if (!confirmDel) { confirmDel = true; del.textContent = 'Really delete?'; del.classList.add('danger'); del.classList.remove('ghost'); return; }
      const list = tab === 'fav' ? svc.list().filter((x) => x.fav) : svc.list();
      const i = list.findIndex((x) => x.id === p.id);
      await svc.remove(p.id);
      ctx.sfx('ui-close');
      const next = list[i + 1] ?? list[i - 1];
      if (next && next.id !== p.id) openPhoto(next.id); else { view = 'grid'; cur = null; render(); }
    });
    const back = h('button.vh-btn.ghost', { type: 'button', 'data-testid': 'album-back' }, '← Album');
    back.addEventListener('click', () => { view = 'grid'; cur = null; render(); });
    const prev = h('button.vh-btn.small', { type: 'button', title: 'Previous (←)', 'aria-label': 'Previous photo' }, '‹');
    const next = h('button.vh-btn.small', { type: 'button', title: 'Next (→)', 'aria-label': 'Next photo' }, '›');
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    body.replaceChildren(h('div.al-one', null,
      h('div.al-left', null, stage, h('div.al-nav', null, back, h('span.al-grow'), prev, next)),
      h('div.al-side', null,
        h('label.al-label', { text: 'Caption' }), input,
        facts, h('div.al-label', { text: 'In the picture' }), who,
        h('div.al-acts', null, fav, dl, del))));
    void develop(stage, p, p.caption);
  }

  async function imageOf(svc: AlbumService, p: PhotoMeta): Promise<(CanvasImageSource & { width: number; height: number }) | null> {
    if (big?.id === p.id) return big.img;
    const b = await svc.image(p.id) ?? svc.thumb(p.id);
    if (!b) return null;
    try { const img = await decode(b); big = { id: p.id, img }; return img; } catch { return null; }
  }
  /** the big view: the photo in its frame, with the caption as typed */
  async function develop(stage: HTMLElement, p: PhotoMeta, caption: string): Promise<void> {
    const svc = service(ctx);
    if (!svc) return;
    const img = await imageOf(svc, p);
    if (!img || cur !== p.id || !stage.isConnected) return;
    const c = compose(img, p.w, p.h, p.frame, { caption, place: p.place, at: p.at, hour: p.hour, id: p.id }, Math.min(1, 1100 / p.w));
    c.className = 'al-print';
    c.setAttribute('data-testid', 'album-print');
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', caption || p.place);
    stage.replaceChildren(c);
  }

  return {
    id: 'album', el,
    onOpen(arg) {
      const svc = service(ctx);
      if (typeof arg === 'string' && svc?.get(arg)) { view = 'photo'; cur = arg; tab = 'all'; }
      else if (arg !== 'keep') { view = 'grid'; cur = null; }
      confirmDel = false;
      off?.();
      off = svc?.onChange((c) => {
        if (view === 'photo' && c.kind === 'update' && c.id === cur) {
          // keep the caption box as it is while typing; refresh the rest
          const focused = typingIn(document.activeElement);
          if (focused) return;
        }
        render();
      }) ?? null;
      void svc?.ready.then(() => { if (ctx.panels.isOpen('album') && svc.version !== lastVersion) render(); });
      render();
    },
    onClose() { off?.(); off = null; dropUrls(); big = null; clearTimeout(recomposeT); },
    key(e) {
      if (view !== 'photo' || typingIn(e.target)) return false;
      if (e.key === 'Escape') { view = 'grid'; cur = null; render(); return true; }
      if (e.key === 'ArrowLeft') { step(-1); return true; }
      if (e.key === 'ArrowRight') { step(1); return true; }
      return false;
    },
  };
}
