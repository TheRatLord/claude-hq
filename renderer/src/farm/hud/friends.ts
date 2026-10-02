/**
 * Friendship in the HUD (model/friends.ts):
 *
 *   Friends panel   the six villagers as cards: hearts (and how close the next one is), what the next milestone brings,
 *                   today's chat / gift, their request, and the tastes you've learned. Opened on a villager (F with
 *                   something in your basket: `UiPort.friends({ give })`) it leads with the gift picker: your basket,
 *                   each item tagged with what you know they think of it (1–9 or a click gives it).
 *   Request tracker a one-line chip under the dock (top right: "♥ 0/3 requests", a gold "!" while one is ready) that
 *                   opens into today's requests on hover / focus / click / Q: progress, "tell Hazel" when one is ready
 *                   (with a toast; it peeks open for a few seconds then), ✓ when delivered. A click on the chip pins it
 *                   open (pref `valley.hud.quests` = 'open'); a row opens the panel. It steps away while a big panel is
 *                   up and is HUD furniture (`data-hud-obstacle`) so bubbles keep clear of it.
 *   Toasts          hearts gained, milestones (a letter, new lines, their decor in the store, a recipe, a keepsake),
 *                   requests delivered.
 */
import './friends.css';
import { collectDef } from '../model/collection.ts';
import { coins, decorDef } from '../model/shop.ts';
import { FRIENDS, MAX_HEARTS, friendDef } from '../model/friends.ts';
import type { FriendDef, FriendView, FriendsChange, FriendsService, RequestView, Tier } from '../model/friends.ts';
import { collectIcon } from './collection.ts';
import { COIN_ICON, decorIcon } from './shop.ts';
import { ICONS, INK, ITEM_OUTLINE as ol, icon, svgIcon as S } from './icons.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';
import { readLocal, writeLocal } from '../storage.ts';


export const HEART_ICON = S(`<path d="M12 20.5C6 16.3 2.8 12.9 2.8 9.1A4.6 4.6 0 0112 6.6a4.6 4.6 0 019.2 2.5c0 3.8-3.2 7.2-9.2 11.4z" fill="#e0574a" ${ol}/><path d="M7 8.6c.6-1 1.6-1.5 2.6-1.4" stroke="#ffd0c8" stroke-width="1.5" stroke-linecap="round" fill="none"/>`);
const SCROLL_ICON = S(`<path d="M6 4h11a2 2 0 012 2v12a2 2 0 01-2 2H7" fill="#fff6e0" ${ol}/><path d="M6 4a2 2 0 00-2 2v1h4V6a2 2 0 00-2-2zM7 20a2 2 0 002-2v-1H5v1a2 2 0 002 2z" fill="#e6d0a2" ${ol}/><path d="M10 9h6M10 12h6M10 15h4" stroke="#8a5a32" stroke-width="1.3" stroke-linecap="round"/>`);
const GIFT_ICON = S(`<rect x="4" y="10" width="16" height="10" rx="1.5" fill="#5fae45" ${ol}/><rect x="3" y="7" width="18" height="4" rx="1" fill="#7cc25a" ${ol}/><path d="M12 7v13" stroke="#f0c040" stroke-width="2.4"/><path d="M12 7c-2-3.5-6-3.5-5-1s5 1 5 1zM12 7c2-3.5 6-3.5 5-1s-5 1-5 1z" fill="#f0c040" ${ol}/>`);

/** A little Clawd portrait in the villager's colours, their glyph on a badge. */
export function portrait(f: FriendDef): string {
  return S(`<rect x="1" y="1" width="22" height="22" rx="6" fill="#fff6e0" stroke="${f.dark}" stroke-width="1.6"/>`
    + `<rect x="5.5" y="9" width="13" height="8.5" rx="1" fill="${f.color}" ${ol}/><path d="M4 12.2h1.5M18.5 12.2H20" stroke="${f.color}" stroke-width="2.4"/>`
    + `<path d="M7 17.5v2.5M10 17.5v2.5M14 17.5v2.5M17 17.5v2.5" stroke="${f.dark}" stroke-width="1.6"/><rect x="8.4" y="11.2" width="1.6" height="2.4" fill="${INK}"/><rect x="14" y="11.2" width="1.6" height="2.4" fill="${INK}"/>`
    + `<path d="M6 9c1-3 3.5-4.5 6-4.5S17 6 18 9z" fill="${f.dark}" ${ol}/>`);
}

const TIER_LABEL: Readonly<Record<Tier, string>> = { love: 'Loves it', like: 'Likes it', neutral: 'Fine', dislike: 'Not keen' };
const TIER_ORDER: Readonly<Record<Tier | 'unknown', number>> = { love: 0, like: 1, unknown: 2, neutral: 3, dislike: 4 };

function heartRow(v: FriendView): HTMLElement {
  const row = h('span.vh-hearts', { title: `${v.hearts} of ${MAX_HEARTS} hearts`, 'aria-label': `${v.hearts} of ${MAX_HEARTS} hearts` });
  for (let i = 0; i < MAX_HEARTS; i++) {
    const part = i < v.hearts ? 1 : i === v.hearts ? v.toNext : 0;
    const el = h(`i${part >= 1 ? '.on' : ''}`, { text: '♥' });
    if (part > 0 && part < 1) el.style.setProperty('--p', `${Math.round(part * 100)}%`);
    if (part > 0 && part < 1) el.classList.add('part');
    row.append(el);
  }
  return row;
}

const service = (ctx: HudCtx): FriendsService | null => { try { return ctx.b?.friends?.() ?? null; } catch { return null; } };
const basketOf = (ctx: HudCtx): Record<string, number> => { try { return ctx.b?.wallet?.()?.data().basket ?? {}; } catch { return {}; } };

export function createFriendsPanel(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('friends', 'Friends', HEART_ICON);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const head = h('div.vh-fr-head');
  const give = h('div.vh-fr-give', { 'data-testid': 'friends-give' });
  const grid = h('div.vh-fr-grid', { 'data-testid': 'friends-grid' });
  body.append(head, give, grid);
  let giveTo: string | null = null, sig = '';
  let items: string[] = [];

  const doGive = (id: string, item: string) => {
    const fr = service(ctx);
    if (!fr) return;
    ctx.panels.close();
    const r = fr.give(id, item);
    if (!r.ok) ctx.toast({ text: r.reason === 'gifted' ? `${friendDef(id)?.short ?? 'They'} had a gift today already` : 'Nothing like that in your basket', sub: 'one gift each, every day', level: 'warn' });
    else ctx.sfx('pop');
  };

  function giveView(fr: FriendsService, v: FriendView): HTMLElement[] {
    const bk = basketOf(ctx);
    items = Object.keys(bk).filter((id) => bk[id] > 0 && collectDef(id))
      .sort((a, b) => TIER_ORDER[v.known[a] ?? 'unknown'] - TIER_ORDER[v.known[b] ?? 'unknown'] || (collectDef(a)!.name < collectDef(b)!.name ? -1 : 1));
    const title = h('div.t', null, icon(GIFT_ICON), `A gift for ${v.def.short}`);
    if (v.giftedToday) return [title, h('div.empty', { text: `${v.def.short} has had a gift from you today. One a day each: come back tomorrow!` })];
    if (!items.length) return [title, h('div.empty', { text: 'Your basket is empty. Pick things up around the valley, or catch a fish, then come back.' })];
    const list = h('div.items');
    items.forEach((id, i) => {
      const d = collectDef(id)!;
      const t = v.known[id];
      const ic = h('span.ic'); ic.innerHTML = collectIcon(d);
      const b = h(`button.item${t ? `.${t}` : ''}`, { type: 'button', 'data-id': id, title: `Give ${v.def.short} a ${d.name.toLowerCase()}${i < 9 ? ` (${i + 1})` : ''}` },
        ic, h('span.nm', { text: d.name }), h('span.n', { text: `×${bk[id]}` }), h('span.tg', { text: t ? TIER_LABEL[t] : 'Not tried' }),
        i < 9 ? h('kbd.vh-k', { text: String(i + 1) }) : null);
      b.addEventListener('click', () => doGive(v.def.id, id));
      list.append(b);
    });
    void fr;
    return [title, h('div.sub', { text: `Everyone has favourites. Once you've given ${v.def.short} something, you'll remember what they thought of it.` }), list];
  }

  function card(v: FriendView): HTMLElement {
    const pic = h('span.pic'); pic.innerHTML = portrait(v.def);
    const top = h('div.top', null, pic, h('div.who', null, h('b', { text: v.def.name }), h('span', { text: v.def.title })), heartRow(v));
    const chips = h('div.chips', null,
      h(`span.chip${v.talkedToday ? '.on' : ''}`, { text: v.talkedToday ? 'chatted today ✓' : 'say hello today' }),
      h(`span.chip${v.giftedToday ? '.on' : ''}`, { text: v.giftedToday ? 'gift given ✓' : 'a gift a day' }));
    const kids: (HTMLElement | null)[] = [top, chips];
    const q = v.request;
    if (q) kids.push(h(`div.req${q.done ? '.done' : q.ready ? '.ready' : ''}`, null, icon(SCROLL_ICON), h('span', null, h('b', { text: q.text }), h('i', { text: ` · ${q.next}` })), h('span.rw', null, icon(COIN_ICON), String(q.req.reward))));
    const known = Object.entries(v.known).sort((a, b) => TIER_ORDER[a[1]] - TIER_ORDER[b[1]]);
    if (known.length) {
      const k = h('div.known', null, h('span.l', { text: 'Tastes' }));
      for (const [id, t] of known) {
        const d = collectDef(id);
        if (!d) continue;
        const ic = h(`span.k.${t}`, { title: `${d.name}: ${TIER_LABEL[t].toLowerCase()}` }); ic.innerHTML = collectIcon(d);
        k.append(ic);
      }
      kids.push(k);
    } else kids.push(h('div.known.none', { text: 'Give a gift to learn what they like.' }));
    if (v.next) {
      const deco = v.next.hearts === 6 ? decorDef(v.def.decor) : v.next.hearts === 10 ? decorDef(v.def.keepsake) : null;
      kids.push(h('div.next', null, `At ${v.next.hearts} ♥: ${v.next.label}`, deco ? h('b', { text: ` (${deco.name})` }) : null));
    } else kids.push(h('div.next.max', { text: 'Best friends. The keepsake is in your yard.' }));
    if (v.hearts >= 6) {
      const ic = h('span.dc'); ic.innerHTML = decorIcon(v.def.decor);
      kids.push(h('div.unl', null, ic, `${decorDef(v.def.decor)?.name} is in the General store`));
    }
    const c = h(`div.card${giveTo === v.def.id ? '.sel' : ''}`, { 'data-id': v.def.id }, ...kids);
    return c;
  }

  function render(force = false): void {
    const fr = service(ctx);
    if (!fr) { grid.replaceChildren(h('div.empty', { text: 'Nobody to befriend in this valley.' })); give.hidden = true; return; }
    const all = fr.all();
    const bk = basketOf(ctx);
    const nsig = `${fr.version}|${giveTo}|${JSON.stringify(bk)}|${all.map((v) => `${v.points}${v.talkedToday}${v.giftedToday}${v.request?.have}${v.request?.ready}`).join()}`;
    if (!force && nsig === sig) return;
    sig = nsig;
    const reqs = fr.requests();
    const total = all.reduce((a, v) => a + v.hearts, 0);
    head.replaceChildren(
      h('div.badge', null, icon(HEART_ICON)),
      h('div.sum', null, h('div.cnt', { text: `${total} of ${MAX_HEARTS * FRIENDS.length} hearts` }),
        h('div.sub', { text: `${reqs.length ? `${reqs.filter((q) => q.done).length} of ${reqs.length} requests done today` : 'No requests today'} · chat once a day, give one gift a day each, and help with their requests` })));
    const gv = giveTo ? all.find((v) => v.def.id === giveTo) : null;
    give.hidden = !gv;
    if (gv) give.replaceChildren(...giveView(fr, gv));
    grid.replaceChildren(...all.map(card));
  }

  return {
    id: 'friends', el,
    onOpen(arg) {
      const a = (arg ?? {}) as { give?: string };
      giveTo = a.give ? friendDef(a.give)?.id ?? null : null;
      render(true);
    },
    refresh: () => render(),
    key(e) {
      if (e.ctrlKey || e.altKey || e.metaKey || !giveTo) return false;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) { const id = items[Number(m[1]) - 1]; if (id) doGive(giveTo, id); return true; }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------------------------

const FOLD_KEY = 'valley.hud.quests';

/** The request tracker under the dock, and the friendship toasts. */
export function createQuests(ctx: HudCtx): { el: HTMLElement; refresh(): void; toggle(): boolean } {
  // collapsed to the chip unless pinned open (a click / Q) or peeking (a request just turned ready)
  let pinned = false, peekUntil = 0;
  pinned = readLocal(FOLD_KEY) === 'open';
  const n = h('span.n');
  const lab = h('span.l', { text: 'requests' });
  const flag = h('span.flag', { text: '!' });
  const chev = h('span.chev', { text: '▸' });
  const headBtn = h('button.head', { type: 'button', 'data-testid': 'quests-head', 'aria-expanded': 'false' }, icon(HEART_ICON), n, lab, flag, chev);
  const openBtn = h('button.book', { type: 'button', title: 'Friends: hearts, tastes and requests', 'aria-label': 'Open friends' }, icon(ICONS.book));
  const list = h('ol.list');
  const el = h('div.vh-quests', { 'data-testid': 'quests' }, h('div.bar', null, headBtn, openBtn), list);
  const setPinned = (v: boolean) => {
    pinned = v; peekUntil = 0;
    writeLocal(FOLD_KEY, v ? 'open' : 'chip');
    ctx.sfx('ui-click'); sig = ''; refresh();
  };
  headBtn.addEventListener('click', (e) => { e.stopPropagation(); setPinned(!pinned); });
  openBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx.panels.open('friends'); });
  let bound: FriendsService | null = null, sig = '';
  const ready = new Map<string, boolean>();
  let primed = false;
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  const peek = (ms: number) => {
    peekUntil = Date.now() + ms; sig = '';
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => { sig = ''; refresh(); }, ms + 50);
  };

  const onChange = (c: FriendsChange) => {
    const f = 'who' in c ? friendDef(c.who) : c.kind === 'delivered' ? friendDef(c.req.who) : null;
    if (c.kind === 'heart' && c.up && f) ctx.toast({ text: `${f.short} ${'♥'.repeat(Math.min(3, c.hearts))}${c.hearts > 3 ? ` ×${c.hearts}` : ''}`, sub: `${c.hearts} ${c.hearts === 1 ? 'heart' : 'hearts'} of friendship`, icon: HEART_ICON, level: 'good', key: `heart|${c.who}|${c.hearts}` });
    else if (c.kind === 'delivered' && f) {
      ctx.sfx('coins');
      ctx.toast({ text: `${f.short}'s request: done!`, sub: `+${coins(c.coins)} · friendship grows`, icon: COIN_ICON, level: 'good', key: `deliv|${c.req.id}`, ms: 5000 });
    } else if (c.kind === 'milestone' && f) {
      const deco = c.decor ? decorDef(c.decor) : null;
      const t = {
        letter: [`A letter from ${f.short}`, 'J for the mailbox'],
        lines: [`${f.short} has more to say to you now`, 'you\'re friends: have a chat'],
        decor: [`New in the General store: ${deco?.name ?? ''}`, `${f.short}'s own piece, for friends only`],
        recipe: [`${f.short} sent you a recipe`, 'J for the mailbox'],
        keepsake: [`${f.short} gave you a keepsake: ${deco?.name ?? ''}`, 'it\'s in your yard, behind the farmhouse'],
      }[c.unlock];
      ctx.toast({ text: t[0], sub: t[1], icon: c.unlock === 'decor' || c.unlock === 'keepsake' ? decorIcon(c.decor ?? '') : c.letter ? ICONS.mail : HEART_ICON, level: 'good', key: `ms|${c.who}|${c.hearts}`, ms: 7000 });
      if (c.unlock === 'keepsake') ctx.sfx('fanfare');
    } else if (c.kind === 'day') ctx.toast({ text: 'New requests on the noticeboard', sub: 'the villagers could use a hand today', icon: SCROLL_ICON, key: `day|${c.day}` });
    sig = '';
  };

  const row = (q: RequestView): HTMLElement => {
    const pic = h('span.pic'); pic.innerHTML = portrait(q.friend);
    const li = h(`li.q${q.done ? '.done' : q.ready ? '.ready' : ''}`, { 'data-id': q.req.id, title: `${q.text} · ${coins(q.req.reward)}` },
      pic, h('span.t', { text: q.text }),
      h('span.p', { text: q.done ? '✓' : q.ready ? '!' : q.n > 1 ? `${q.have}/${q.n}` : '' }),
      h('span.sub', { text: q.next }));
    li.addEventListener('click', (e) => { e.stopPropagation(); ctx.panels.open('friends'); });
    return li;
  };

  function refresh(): void {
    const fr = service(ctx);
    if (!fr) { el.hidden = true; return; }
    if (fr !== bound) { bound = fr; fr.onChange(onChange); }
    const qs = fr.requests();
    // ready toasts (bring requests turn ready from the basket, the rest from progress): transitions only
    for (const q of qs) {
      const was = ready.get(q.req.id);
      const now = q.ready && !q.done;
      if (primed && now && was === false) {
        ctx.toast({ text: `Request ready: ${q.text}`, sub: `talk to ${q.friend.short} to hand it over`, icon: SCROLL_ICON, level: 'good', key: `ready|${q.req.id}`, ms: 5000 });
        peek(10_000);
      }
      ready.set(q.req.id, now);
    }
    primed = true;
    const open = pinned || Date.now() < peekUntil;
    const nsig = `${open}|${qs.map((q) => `${q.req.id}:${q.have}:${q.ready}:${q.done}:${q.next}`).join()}`;
    if (nsig === sig) return;
    sig = nsig;
    el.hidden = !qs.length;
    const done = qs.filter((q) => q.done).length;
    const nReady = qs.filter((q) => q.ready && !q.done).length;
    n.textContent = `${done}/${qs.length}`;
    // rows stay in the DOM (hover / focus opens them with CSS alone); .open = pinned or peeking
    el.classList.toggle('open', open);
    el.classList.toggle('alert', nReady > 0);
    flag.hidden = !nReady;
    chev.textContent = open ? '▾' : '▸';
    headBtn.setAttribute('aria-expanded', String(open));
    headBtn.title = `Today's requests: ${done} of ${qs.length} done${nReady ? `, ${nReady} ready to hand over` : ''} · ${pinned ? 'click (Q) to tuck away' : 'click (Q) to keep open'}`;
    list.replaceChildren(...qs.map(row));
  }
  /** Q: pin open / tuck away (false when there is nothing to show) */
  function toggle(): boolean {
    if (el.hidden) return false;
    setPinned(!(pinned || Date.now() < peekUntil));
    return true;
  }
  return { el, refresh, toggle };
}
