/**
 * Mailbox (J, the dock button, or the in-world mailbox): letters from the farmers. Filter Needs you / Unread / All;
 * each letter expands to its full text with actions (terminal, quick answers for unresolved asks, walk there).
 * Opening a letter marks it read; read state persists across reloads (see hud.ts).
 * Answer + next: the Needs you tab lists asks in the strip's order (newest first), and answering one (1–9 or a click)
 * moves the selection to the next ask, so J, 1, 1, 2, Esc clears a queue without touching the mouse.
 */
import type { Letter, ValleyState } from '../model/types.ts';
import { ICONS, LETTER_ICON, icon } from './icons.ts';
import { ago, askOrder, LETTER_LABEL, letterTitle, nextAfter, nice, shortName } from './format.ts';
import { framePanel, h, syncList, typingIn, type HudCtx, type Panel } from './ctx.ts';

type Filter = 'needs' | 'unread' | 'all';

/**
 * Letters plus a stand-in letter for every farmer who needs you but has no open needs-you letter (e.g. already
 * blocked when the page loaded), so the mailbox never misses an ask.
 */
export function mailOf(s: ValleyState | null, read: ReadonlySet<string> = new Set()): Letter[] {
  if (!s) return [];
  const open = new Set(s.letters.filter((l) => l.kind === 'needs-you' && !l.resolved).map((l) => l.farmerId));
  const extra: Letter[] = [];
  for (const f of s.farmers.values()) {
    if (!f.needsYou || open.has(f.id)) continue;
    const id = `ask:${f.id}:${f.jobSince}`;
    extra.push({ id, at: f.jobSince, kind: 'needs-you', farmerId: f.id, farmerName: f.name, plotLabel: s.plots.get(f.plotId)?.label ?? '',
      title: `${nice(f.name)} needs you`, body: f.question ?? '', read: read.has(id), resolved: false });
  }
  return extra.length ? [...extra, ...s.letters].sort((a, b) => b.at - a.at) : s.letters;
}

export function createMailbox(ctx: HudCtx, mark: { read(l: Letter): void; all(): void; synthRead: ReadonlySet<string> }): Panel {
  const { el, body, closeBtn } = framePanel('mailbox', 'Mailbox', ICONS.mail);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  let filter: Filter = 'all';
  let sel: string | null = null;
  const tabs = new Map<Filter, HTMLButtonElement>();
  const tabBar = h('div.vh-tabs', { role: 'tablist' });
  for (const [f, label] of [['needs', 'Needs you'], ['unread', 'Unread'], ['all', 'All']] as const) {
    const b = h('button.vh-tab', { type: 'button', role: 'tab', 'data-testid': `mail-tab-${f}` }, label, h('span.n'));
    b.addEventListener('click', () => setFilter(f));
    tabs.set(f, b);
    tabBar.append(b);
  }
  const allBtn = h('button.vh-btn.small', { type: 'button', title: 'Mark every letter read (Shift+R)', onclick: () => { mark.all(); render(); } }, icon(ICONS.check), 'Mark all read');
  const listEl = h('div.vh-letters.vh-scroll', { role: 'list', 'data-testid': 'letters' });
  const foot = h('div.vh-foot', null,
    h('span', null, h('kbd.vh-k', { text: '↑' }), h('kbd.vh-k', { text: '↓' }), 'read'),
    h('span', null, h('kbd.vh-k', { text: 'Enter' }), 'terminal'),
    h('span', null, h('kbd.vh-k', { text: '1-9' }), 'answer'),
    h('span', null, h('kbd.vh-k', { text: 'R' }), 'mark read'),
    h('span', null, h('kbd.vh-k', { text: 'J' }), '/', h('kbd.vh-k', { text: 'Esc' }), 'close'));
  body.append(h('div.bar', null, tabBar, allBtn), listEl, foot);
  let shown: Letter[] = [];
  /** farmers with an answer in flight (a second 1 must not send twice) */
  const answering = new Set<string>();
  /** answer an ask, then select the next one in view so the next key press acts on it */
  const answer = async (l: Letter, key: string, label: string): Promise<void> => {
    if (answering.has(l.farmerId)) return;
    const before = shown.filter((x) => x.kind === 'needs-you' && !x.resolved).map((x) => x.id);
    answering.add(l.farmerId); render();
    let ok = false;
    try { ok = await ctx.answer(l.farmerId, key, label); } finally { answering.delete(l.farmerId); }
    if (ok) {
      mark.read(l);
      // the answered letter may linger a beat until the farmer unblocks: skip it, and asks from the same farmer
      const next = nextAfter(before.filter((id) => id === l.id || shown.find((x) => x.id === id)?.farmerId !== l.farmerId), l.id);
      if (sel === l.id || sel === null) sel = next;
      ctx.sfx('page');
    }
    render();
    if (sel) listEl.querySelector(`[data-key="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  /** the Needs you tab pre-selects the first ask (without marking it read), so 1–9 / Enter act on it straight away */
  const setFilter = (f: Filter) => {
    filter = f; sel = null; render();
    if (f === 'needs' && shown[0]) { sel = shown[0].id; render(); }
  };

  const pick = (letters: readonly Letter[], by: Filter = filter): Letter[] => {
    if (by === 'needs') {
      // the same order as the needs-you strip (Alt+1 there is the first ask here)
      const since = (l: Letter) => ctx.farmer(l.farmerId)?.jobSince ?? l.at;
      return letters.filter((l) => l.kind === 'needs-you' && !l.resolved).sort((a, b) => askOrder({ since: since(a), id: a.farmerId }, { since: since(b), id: b.farmerId }));
    }
    if (by === 'unread') return letters.filter((l) => !l.read && !(l.kind === 'needs-you' && l.resolved));
    return [...letters];
  };

  function make(l: Letter): HTMLElement {
    const node = h('article.vh-letter', { role: 'listitem', tabindex: '-1', 'data-testid': 'letter' });
    node.append(h('span.ic'), h('div.l1', null, h('span.title'), h('span.when')), h('div.from'), h('div.body'), h('div.answers'), h('div.acts'));
    node.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const id = node.dataset.key!;
      sel = sel === id ? null : id;
      const letter = mailOf(ctx.state(), mark.synthRead).find((x) => x.id === id);
      if (letter && !letter.read) mark.read(letter);
      render();
    });
    return node;
  }
  function update(node: HTMLElement, l: Letter): void {
    const s = ctx.state();
    const open = sel === l.id;
    const f = s?.farmers.get(l.farmerId);
    const live = l.kind === 'needs-you' && !l.resolved && !!f?.needsYou;
    const busy = answering.has(l.farmerId);
    node.className = `vh-letter k-${l.kind}${l.read ? ' read' : ' unread'}${l.resolved ? ' resolved' : ''}${open ? ' sel' : ''}${busy ? ' busy' : ''}`;
    const sig = `${l.title}|${l.body}|${l.read}|${l.resolved}|${open}|${live ? f?.options.map((o) => o.label).join('|') : ''}|${!!f}|${busy}`;
    (node.querySelector('.when') as HTMLElement).textContent = s ? ago(l.at, s.now) : '';
    if (node.dataset.sig === sig) return;
    node.dataset.sig = sig;
    const ic = node.querySelector('.ic') as HTMLElement;
    ic.innerHTML = LETTER_ICON[l.kind];
    ic.title = LETTER_LABEL[l.kind];
    (node.querySelector('.title') as HTMLElement).textContent = letterTitle(l);
    const from = node.querySelector('.from') as HTMLElement;
    const who = f ?? s?.helpers.get(l.farmerId);
    from.replaceChildren(`${who ? shortName(who) : nice(l.farmerName)}${l.plotLabel ? ` · ${l.plotLabel}` : ''}`, l.kind === 'needs-you' && l.resolved ? h('span.resolved-tag', { text: '  ✓ answered' }) : '');
    (node.querySelector('.body') as HTMLElement).textContent = l.body || (live ? f?.question ?? '' : '');
    const answers = node.querySelector('.answers') as HTMLElement;
    answers.replaceChildren(...(live && f ? f.options.map((o) => h('button.vh-btn.small.gold.answer', {
      type: 'button', title: o.label, 'data-testid': 'letter-answer',
      onclick: () => void answer(l, o.key, o.label),
    }, h('span.num', { text: o.key }), h('span.lab', { text: o.label }))) : []));
    answers.style.display = live && (open || filter === 'needs') ? '' : 'none';
    const acts = node.querySelector('.acts') as HTMLElement;
    acts.replaceChildren(...(f || s?.helpers.has(l.farmerId) ? [
      h('button.vh-btn.small.primary', { type: 'button', 'data-testid': 'letter-terminal', onclick: () => { mark.read(l); ctx.openTerminal(l.farmerId); } }, icon(ICONS.terminal), 'Terminal'),
      h('button.vh-btn.small', { type: 'button', onclick: () => { mark.read(l); ctx.travel(l.farmerId); ctx.panels.close(); } }, icon(ICONS.walk), 'Walk there'),
    ] : []), ...(l.farmerId === 'gazette' ? [
      h('button.vh-btn.small.primary', { type: 'button', 'data-testid': 'letter-gazette', onclick: () => { mark.read(l); ctx.panels.open('gazette', { from: l.id.replace(/^V:gazette:/, '') }); } }, icon(LETTER_ICON.news), 'Read the paper'),
    ] : []), ...(l.farmerId === 'villager:marigold' ? [
      h('button.vh-btn.small.primary', { type: 'button', 'data-testid': 'letter-almanac', onclick: () => { mark.read(l); ctx.panels.open('almanac'); } }, icon(ICONS.rosette), 'Open almanac'),
    ] : []), ...(!l.read ? [h('button.vh-btn.small.ghost', { type: 'button', onclick: () => { mark.read(l); render(); } }, 'Mark read')] : []));
    acts.style.display = open || live ? '' : 'none';
  }

  function render(): void {
    const s = ctx.state();
    const letters = mailOf(s, mark.synthRead);
    const counts: Record<Filter, number> = { needs: pick(letters, 'needs').length, unread: pick(letters, 'unread').length, all: letters.length };
    for (const [f, b] of tabs) {
      b.setAttribute('aria-selected', String(f === filter));
      const n = b.querySelector('.n') as HTMLElement;
      n.textContent = String(counts[f]);
      n.style.display = f !== 'all' && counts[f] ? '' : 'none';
    }
    shown = pick(letters);
    syncList(listEl, shown, (l) => l.id, make, update);
    listEl.querySelector('.vh-empty')?.remove();
    if (!shown.length) {
      const away = s?.link === 'offline' || s?.link === 'herdr-offline' || s?.link === 'connecting';
      listEl.append(h('div.vh-empty', null, icon(ICONS.mail),
        filter === 'needs' ? 'Nobody is waiting on you. Lovely.' : filter === 'unread' ? 'All caught up.' : 'The mailbox is empty.',
        away ? h('small', { text: 'The post is held up while herdr is out of reach; letters arrive once it is back.' })
          : !s?.farmers.size ? h('small', { text: 'Farmers write when they finish, get stuck or need an answer.' }) : null));
    }
  }

  const move = (dir: number) => {
    if (!shown.length) return;
    const i = sel ? shown.findIndex((l) => l.id === sel) : -1;
    const n = shown[Math.max(0, Math.min(shown.length - 1, i + dir))];
    sel = n.id;
    if (!n.read) mark.read(n);
    render();
    listEl.querySelector(`[data-key="${CSS.escape(n.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  return {
    id: 'mailbox', el,
    onOpen(arg) {
      const s = ctx.state();
      const waiting = mailOf(s).some((l) => l.kind === 'needs-you' && !l.resolved);
      setFilter(arg === 'needs' || (arg === undefined && waiting) ? 'needs' : 'all');
    },
    refresh: render,
    key(e) {
      if (typingIn(e.target)) return false;
      if (e.key === 'ArrowDown') { move(1); return true; }
      if (e.key === 'ArrowUp') { move(-1); return true; }
      const cur = shown.find((l) => l.id === sel);
      if (e.key === 'Enter' && cur && !(e.target instanceof HTMLButtonElement)) { mark.read(cur); ctx.openTerminal(cur.farmerId, { enterAt: e.timeStamp }); return true; }
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) { if (e.shiftKey) mark.all(); else if (cur) mark.read(cur); render(); return true; }
      if (cur && /^Digit[1-9]$/.test(e.code) && !e.altKey && !e.ctrlKey) {
        const f = ctx.farmer(cur.farmerId);
        const o = cur.kind === 'needs-you' && !cur.resolved && f?.needsYou ? f.options[Number(e.code.slice(5)) - 1] : undefined;
        if (o && f) { void answer(cur, o.key, o.label); return true; }
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const order: Filter[] = ['needs', 'unread', 'all'];
        setFilter(order[(order.indexOf(filter) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]);
        return true;
      }
      return false;
    },
  };
}
