/**
 * HUD (§8 table; UI kit §5.1 "Workshop Signage"): the tally board hung on brass rods over the visible world strip
 * (alarm cell with the dot-matrix needs-you digit, then working · done · idle · unknown · shells; each cell filters the
 * roster), the session plaque, the tool rail, the crosshair with its paper aim tag, receipt tickets for toasts (a
 * one-line ticket in the drawer's own layer while it is focused / fullscreen), the Leader plate, the offline paper
 * notice and live regions.
 * Owner: UI.
 */
import { h, setText, cls, ICON } from './dom.ts';
import { UNKNOWN_TIP } from './help.ts'; // [UI fix r1] the unknown cell explains itself
import { tally, plaque, board, paper, iconButton, lamp, keycap, keys, button, comboCaps } from './kit/index.ts';
import { keyPlatform } from './kit/keys.ts';
import { ensureHudCss } from './hudCss.ts';
import type { Store } from '../net/store.ts';
import type { Params } from '../core/params.ts';
import type { ToastLevel } from '../../../shared/protocol.ts';

type TallyState = 'working' | 'blocked' | 'done' | 'idle' | 'unknown' | 'shell';

/** Wait time as a clock: 0:45 · 12:03 · 1:04:10 (ticket stubs, chevrons). */
export function waitLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

/** Toast stack depth per host (§5.1: max 3 tickets, newest on top). */
export const TOAST_MAX = 3;
/** Under this strip width the tally drops its words (lamps + numerals still say it); under TINY the tool rail goes. */
const NARROW_PX = 760;
/** Under this lane width the world tickets collapse to ONE line ticket (the newest; the rest wait under it, counted). */
export const TOAST_LINE_PX = 300;
const TINY_PX = 460;

/** Step marker inside a parsed chord (`Ctrl+\` L, B` → Leader · L · THEN · B): drawn as the legend's muted "then". */
export const THEN = 'then';

/** One legend entry: the keys (null for a plain-text segment) and its label. */
export interface HintPart { keys: string[] | null; label: string }

/**
 * Key-hint text → legend parts. Understands `[B] inbox`, `Ctrl+\` U next blocked` (the Leader + chord letters),
 * `Shift+N renames`, `B answers` / `Q pats` (a lone key then a verb); anything else stays plain text. Segments are split
 * on ` · `. "click to …" segments are dropped (a ticket is visibly clickable). Pure except for building DOM.
 */
export function parseHint(text: string | null | undefined, o: { dropClick?: boolean } = {}): HintPart[] {
  const leader = String(keyPlatform().leaderLabel || 'Ctrl+`');
  const out: HintPart[] = [];
  for (let seg of String(text ?? '').split(/\s+·\s+/)) {
    seg = seg.trim();
    if (!seg) continue;
    if (o.dropClick !== false && /^click (to|for)\b/i.test(seg)) continue;
    const br = /^\[([^\]]+)\]\s*(.*)$/.exec(seg);
    if (br) { out.push({ keys: br[1].split('+').length > 1 ? [br[1]] : [br[1]], label: br[2] }); continue; }
    const toks = seg.split(/\s+/);
    const ks: string[] = [];
    let i = 0;
    for (; i < toks.length; i++) {
      const step = /.,$/.test(toks[i]); // "L, B": press L, then B (a step, not a combo)
      const t = toks[i].replace(/(.),$/, '$1');
      if (t === leader || /^leader$/i.test(t)) { ks.push('Leader'); continue; }
      if (/^((Shift|Alt|Ctrl|Mod|Cmd)\+)*([A-Z0-9?/[\]`;.,]|F\d{1,2}|Esc|Tab|Enter)$/.test(t) && (ks.length || i === 0)) { ks.push(t); if (step) ks.push(THEN); continue; }
      break;
    }
    // a lone leading capital that is really a word ("A" in "A new…") needs a verb after it and no more caps
    if (ks.length && i < toks.length && /^[a-z→(]/.test(toks[i])) out.push({ keys: ks, label: toks.slice(i).join(' ').replace(/^→\s*/, '') });
    else out.push({ keys: null, label: seg });
  }
  return out;
}

/**
 * Legend element from hint text (kit keycaps; plain segments as muted text). When every keyed entry is a Leader chord
 * the Leader is shown ONCE, as the head of one key group: [Ctrl `] then [U] next blocked · [L]›[B] inbox — a step inside a
 * chord is a muted › between its caps (never two bare caps side by side that read as one combo) (§3 Legend). One-line
 * tickets (`small`) keep only the first key entry.
 */
export function hintLegend(text: string | null | undefined, o: { cls?: string; small?: boolean; dropClick?: boolean } = {}): HTMLElement {
  const el = h(`div.k-legend.tight${o.cls ? `.${o.cls}` : ''}`);
  let parts = parseHint(text, o);
  // a one-line ticket (small caps) keeps only its first key entry: the headline gets the room
  if (o.small) { const i = parts.findIndex((p) => p.keys); parts = i < 0 ? parts.slice(0, 1) : [parts[i]]; }
  const keyed = parts.filter((p): p is HintPart & { keys: string[] } => !!p.keys);
  const once = keyed.length > 0 && keyed.every((p) => p.keys[0] === 'Leader' && p.keys.length > 1);
  const caps = (ks: string[]) => {
    const out: HTMLElement[] = [];
    let run: string[] = [];
    const flush = () => { if (run.length) out.push(keys(run, { small: !!o.small })); run = []; };
    for (const k of ks) { if (k === THEN) { flush(); out.push(h('span.to.step', { text: '›', title: 'then' })); } else run.push(k); }
    flush();
    return out;
  };
  if (once && o.small) { // one line: the Leader, "then" and its one entry are one unit (they hide together if cramped)
    const p = keyed[0]; // `once` + small: the one kept part
    el.append(h('span.h', null, keys('Leader', { small: true }), h('span.then.in', { text: 'then' }), ...caps(p.keys.slice(1)), p.label || null));
    return el;
  }
  if (once) el.append(h('span.h', null, keys('Leader', { small: !!o.small })), h('span.then', { text: 'then' }));
  for (const p of parts) {
    const ks = p.keys && once ? p.keys.slice(1) : p.keys;
    el.append(ks ? h('span.h', null, ...caps(ks), p.label || null) : h('span.h', { text: p.label }));
  }
  return el;
}

/**
 * A plain-text notice → ticket headline + serif line: the headline is the short clause ("Sign-off failed",
 * "Closing panes needs allowMutations"), the rest ("timeout", "off in the default session") goes on the ticket's serif
 * line instead of being clamped off a bold headline. Splits at ": ", " (…)", " — " or the first sentence end; a notice
 * with no seam stays whole (it wraps; never an ellipsis).
 */
export function splitNotice(text: string | null | undefined): { head: string; sub: string } {
  const t = String(text ?? '').trim();
  let m = /^(.{3,}?):\s+(.+)$/.exec(t);
  if (m) return { head: m[1], sub: m[2] };
  m = /^(.{3,}?)\s+\((.+)\)\.?$/.exec(t);
  if (m) return { head: m[1], sub: m[2].replace(/^./, (c) => c.toUpperCase()) };
  m = /^(.{3,}?)\s+[—–]\s+(.+)$/.exec(t);
  if (m) return { head: m[1], sub: m[2] };
  m = /^(.{3,}?[.!?])\s+(.+)$/.exec(t);
  if (m) return { head: m[1].replace(/\.$/, ''), sub: m[2] };
  return { head: t, sub: '' };
}

export interface HudDeps {
  root: HTMLElement;
  store: Pick<Store, 'entities' | 'hello' | 'conn' | 'herdr' | 'now'>;
  params: Pick<Params, 'nohud'>;
  hooks: {
    pill(state: string): void;
    drawerToasts(): HTMLElement | null;
    retry(): void;
    stopFollow?(): void;
    more?(): void;
    settings?(): void;
    help?(): void;
    mute?(): boolean;
    muted?(): boolean;
  };
}

/** Ticket levels: the wire toast levels plus the two attention ones. */
export type TicketLevel = ToastLevel | 'blocked' | 'done';

export interface TicketOpts { sub?: string; hint?: string; ttl?: number; drawer?: boolean; key?: string; onClick?: () => void; caption?: string; since?: number }

export function createHud(d: HudDeps) {
  ensureHudCss();
  const { store } = d;
  // ---- tally board on rods (kit) + the unknown cell the kit tally doesn't carry ([m2-r1] totals == entity count) ----
  const T = tally({}, { onFilter: (s) => { if (s !== 'clear') d.hooks.pill(s); } });
  const unkN = h('span.n');
  const unknownCell = h('button.cell.unknown', { type: 'button', 'data-state': 'unknown', hidden: true, title: `Filter the roster: unknown — ${UNKNOWN_TIP.replace(/^unknown: /, '')}`, onclick: () => d.hooks.pill('unknown') },
    lamp('unknown', { label: '' }), unkN, h('span.w', { text: 'unknown' }));
  T.board.querySelector('.cell[data-state="shell"]')?.before(unknownCell);
  for (const c of T.board.querySelectorAll<HTMLElement>('.cell')) {
    c.addEventListener('mousedown', (ev) => ev.preventDefault()); // never steal focus from the world
    const st = c.dataset.state;
    if (st && st !== 'clear' && st !== 'unknown') c.setAttribute('title', `Filter the roster: ${st === 'shell' ? 'shells' : st}`);
  }
  T.board.querySelector('.cell.clear')?.setAttribute('title', 'Nobody needs you');
  // [UI fix r3] the session plaque folded into the tally as its first cell when the strip is too narrow for the corner
  // (roster / drawer open): never a lone brass badge floating on a second row over the Big Board
  const sessCell = h('span.cell.sess', { hidden: true });
  T.board.prepend(sessCell);
  const pills = h('div.hq-tallybar', { role: 'group', 'aria-label': 'Office status' }, T.el);

  // ---- session plaque (top-left) · tool rail (top-right) ----
  const sess = h('div.hq-sess');
  let muteShown: boolean | undefined;
  const muteBtn = iconButton(ICON.sound, { title: 'Mute sounds', onClick: () => { const m = d.hooks.mute?.(); syncMute(m); } });
  const syncMute = (m: boolean | undefined = d.hooks.muted?.()) => { muteBtn.innerHTML = m ? ICON.muted : ICON.sound; muteBtn.setAttribute('aria-pressed', String(!!m)); muteBtn.title = m ? 'Unmute sounds' : 'Mute sounds'; muteBtn.setAttribute('aria-label', muteBtn.title); };
  const tools = board({ cls: 'k-rail hq-tools' }, muteBtn,
    iconButton(ICON.help, { title: 'Help', key: 'H', onClick: () => d.hooks.help?.() }),
    iconButton(ICON.gear, { title: 'Settings', onClick: () => d.hooks.settings?.() }));
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', 'HQ');
  for (const b of tools.querySelectorAll('button')) b.addEventListener('mousedown', (ev) => ev.preventDefault());
  const top = h('div.hq-top', null, sess, pills, tools);

  // ---- crosshair + paper aim tag ----
  const reticle = h('div.dot');
  const aimName = h('b'), aimVerb = h('span.verb');
  const aimKey = keycap('E');
  const cross = h('div.hq-cross', null, reticle, paper({ cls: 'k-aimtag hint' }, aimKey, h('span.nm', null, aimVerb, aimName)));
  // (the .nm text reads "open scout": p2 and screen readers get the whole phrase; the verb is drawn muted)

  const toasts = h('div.hq-toasts');
  const leaderSub = h('span.sub');
  const leader = board({ cls: 'k-rail hq-leader' }, plaque('Leader ▸', { small: true }), leaderSub);
  leader.setAttribute('aria-hidden', 'true');
  const retry = button('Retry', { onClick: () => d.hooks.retry() });
  const bannerHead = h('b'), bannerTx = h('span');
  const banner = paper({ cls: 'hq-banner' }, lamp('idle', { size: 'lg', label: '' }), h('div.tx', null, bannerHead, bannerTx), retry);
  banner.setAttribute('role', 'alert');
  const liveA = h('div.hq-sr', { 'aria-live': 'assertive' });
  const liveP = h('div.hq-sr', { 'aria-live': 'polite' });
  // M2: "Following scout" plate (follow cam); Esc or moving stops it
  const followNm = h('b');
  const followChip = h('button.hq-follow.k-board.k-rail', { hidden: true, type: 'button', title: 'Stop following (Esc or move)', onclick: () => d.hooks.stopFollow?.() },
    lamp('working', { size: 'sm', label: '' }), h('span', null, 'Following ', followNm), keycap('Esc', { small: true }));
  const els = [top, cross, toasts, leader, followChip, banner, liveA, liveP]; // (follow before banner: CSS stacks them)
  if (!d.params.nohud) d.root.append(...els);

  /**
   * "+N earlier": older tickets that fold away are counted per host and the count is written as a ledger line at the
   * head of the TOP ticket (never a free-floating capsule of its own). Click = the Blocked Inbox. Forgets after 12 s
   * without a new overflow. Re-rendered whenever a host's tickets change (MutationObserver on the host's children).
   */
  const moreN = new WeakMap<HTMLElement, number>(), moreT = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>(), watched = new WeakSet<HTMLElement>();
  const liveTickets = (host: HTMLElement) => [...host.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('hq-toast') && !c.classList.contains('out'));
  function renderMore(host: HTMLElement) {
    const live = liveTickets(host);
    // a one-line lane shows only the newest ticket: the ones waiting under it count as "earlier" too
    const n = (moreN.get(host) ?? 0) + (host.classList.contains('narrow') ? Math.max(0, live.length - 1) : 0);
    const top = n ? live.pop() : null;
    for (const x of host.querySelectorAll(':scope > .hq-toast .more')) if (x.parentElement?.parentElement?.parentElement !== top) x.remove();
    if (!top) return;
    const body = top.querySelector('.body');
    let m: HTMLElement | null | undefined = body?.querySelector<HTMLElement>(':scope > .more');
    if (!body) return;
    if (!m) {
      const line = top.classList.contains('line');
      // [UI fix r3] say the inbox key once: a ticket whose own legend already names the inbox keeps a plain count
      const ownKey = /\binbox\b/i.test(top.querySelector<HTMLElement>('.hint')?.dataset.hint ?? '');
      m = h('button.more', { type: 'button', title: 'Earlier tickets — open the Blocked Inbox (B)', onclick: (ev: Event) => { ev.stopPropagation(); moreN.set(host, 0); renderMore(host); d.hooks.more?.(); } },
        h('span.n'), host === toasts && !line && !ownKey ? h('span.k-legend', null, h('span.h', null, keycap('B', { small: true }), 'inbox')) : null);
      body.prepend(m);
    }
    const nEl = m.querySelector('.n');
    if (nEl) nEl.textContent = top.classList.contains('line') ? `+${n}` : `+${n} earlier`;
  }
  function bumpMore(host: HTMLElement) {
    moreN.set(host, (moreN.get(host) ?? 0) + 1);
    clearTimeout(moreT.get(host));
    moreT.set(host, setTimeout(() => { moreN.set(host, 0); renderMore(host); }, 12_000));
    renderMore(host);
  }
  function watch(host: HTMLElement) {
    if (watched.has(host) || typeof MutationObserver === 'undefined') return;
    watched.add(host);
    new MutationObserver(() => { if (moreN.get(host) || host.classList.contains('narrow')) renderMore(host); }).observe(host, { childList: true });
  }
  let aimKeyStr = '';
  /** last tally counts (tests / `__hqUi.hud.counts`) */
  let lastCounts: Record<TallyState, number> | null = null;
  /** live tickets whose stub shows a running wait time (`since` = the wait's start, `tEl` = the clock in the stub) */
  const ticking = new Map<HTMLElement, { since: number; tEl: HTMLElement }>();
  let dock: number | null | undefined;
  let sessKey: string | undefined;
  // fit: the tally lives in the world strip between the roster's right edge and the drawer's left edge (layout());
  // narrow strips drop the cell words, tiny ones the tool rail; if the row still doesn't fit, the tally takes its own
  // centred row under the plaque.
  let stripL = 0, stripR = 0, fitKey = '';
  function fit() {
    const w = innerWidth - stripL - stripR;
    const avail = Math.max(0, w - 44);
    const k = `${avail}|${T.board.textContent}|${sess.textContent}|${[...T.board.children].map((c) => (c instanceof HTMLElement && c.hidden ? 0 : 1)).join('')}`;
    if (k === fitKey) return;
    fitKey = k;
    // the tally is centred and always hangs from the top edge, so it must clear the wider of the plaque / tool rail on
    // both sides: full words, else numerals + lamps only (narrow), else the plaque and the tool rail drop to a second
    // row under it (wrap) — the tally itself never moves down
    const fits = () => T.el.offsetWidth + 2 * (Math.max(sess.offsetWidth, tools.offsetWidth || 0) + 12) <= avail;
    // the tally itself must fit the strip (8 px air each side): it never hangs under the roster or the drawer
    const alone = () => T.el.offsetWidth <= w - 16;
    cls(top, 'wrap', false);
    cls(top, 'squeeze', false);
    cls(top, 'bare', false);
    cls(top, 'folded', false);
    sessCell.hidden = true;
    cls(top, 'tiny', w < TINY_PX);
    cls(top, 'narrow', w < NARROW_PX);
    if (!top.classList.contains('narrow') && !fits()) cls(top, 'narrow', true);
    if (!fits()) {
      // the plaque joins the tally as one cell (the tool rail still takes the second row's right corner, when shown)
      cls(top, 'wrap', true);
      cls(top, 'folded', true);
      sessCell.hidden = false;
    }
    // still too wide: the quiet cells go (idle · unknown · shells; the roster beside it lists them), then done
    // (working + the alarm stay: the alarm is the most important readout on screen), then the session cell (the
    // window title still names the session)
    if (!alone()) cls(top, 'squeeze', true);
    if (!alone()) cls(top, 'bare', true);
    if (!alone()) sessCell.hidden = true;
  }
  const api = {
    pills,
    get counts() { return lastCounts; },
    toasts,
    /**
     * Crosshair aim state (every frame; cheap). [PLY M1.5] `verb` generalises the hint for world affordances:
     * 'open' (agent, default) → "E open scout"; '' → "E <name>" ("E sit", "E ride the slide"); null → no key, just the
     * text ("that's scout's chair").
     */
    aim(name: string | null | undefined, verb: string | null = 'open') {
      const k = name ? `${verb}\u0000${name}` : '';
      if (k === aimKeyStr) return;
      aimKeyStr = k;
      cls(cross, 'aim', !!name);
      cls(reticle, 'k-xhair', !!name);
      aimKey.style.display = verb === null ? 'none' : '';
      setText(aimVerb, name && verb ? `${verb} ` : '');
      setText(aimName, name || '');
    },
    /**
     * [UI fix r3, reviewer art "the E-open hint sits on the mouth in every walk-up"] dock the hint `dy` px below the
     * reticle, centred (under the aimed face's chin); null = the default spot right of the reticle.
     */
    aimDock(dy: number | null) {
      const k = dy == null ? null : Math.round(dy / 4) * 4;
      if (k === dock) return;
      dock = k;
      cls(cross, 'dock', k != null);
      const hint = cross.querySelector<HTMLElement>('.hint');
      if (hint) hint.style.top = k == null ? '' : `${k}px`;
    },
    /** A short verb flash over the reticle ("high-five!"), 900 ms; key words become keycaps ("B answers"). */
    flash(text: string) {
      const parts = parseHint(text, { dropClick: false });
      const f = paper({ cls: 'flash' });
      for (const p of parts) f.append(p.keys ? h('span.k-legend', null, h('span.h', null, keys(p.keys.filter((k) => k !== THEN), { small: true }), p.label || null)) : h('span', { text: p.label }));
      cross.append(f);
      setTimeout(() => f.remove(), 900);
    },
    follow(name: string | null | undefined) {
      followChip.hidden = !name;
      if (name) setText(followNm, name);
    },
    crosshair(on: boolean) { cross.style.display = on ? '' : 'none'; },
    /** ≤ 10 Hz */
    update(filter?: string | null) {
      const counts: Record<TallyState, number> = { working: 0, blocked: 0, done: 0, idle: 0, unknown: 0, shell: 0 };
      for (const e of store.entities.values()) {
        if (e.kind === 'shell') counts.shell++;
        else if (e.status in counts) counts[e.status]++;
        else counts.unknown++; // any status we don't know is 'unknown': totals == entity count
      }
      lastCounts = counts;
      T.set(counts, filter ?? null);
      const clearCell = T.board.querySelector<HTMLElement>('.cell.clear');
      if (clearCell) clearCell.hidden = counts.blocked > 0 || store.entities.size === 0;
      unknownCell.hidden = counts.unknown === 0;
      if (unkN.textContent !== String(counts.unknown)) unkN.textContent = String(counts.unknown);
      unknownCell.setAttribute('aria-label', `${counts.unknown} unknown`);
      unknownCell.setAttribute('aria-pressed', String(filter === 'unknown'));
      if (muteShown !== !!d.hooks.muted?.()) { muteShown = !!d.hooks.muted?.(); syncMute(muteShown); }
      // session plaque: the session name (teal), Demo (butter), the default session (slate)
      const hello = store.hello;
      const name = hello ? (hello.demo ? 'Demo' : hello.session) : '…';
      const k = `${name}|${!!hello?.demo}`;
      if (sessKey !== k) {
        sessKey = k;
        const p = plaque(name, { small: true, tone: hello?.demo ? 'butter' : hello?.session === 'default' ? 'slate' : undefined });
        p.title = hello?.demo ? 'Demo office (no herdr)' : `herdr session ${name}`;
        sess.replaceChildren(p);
        // the same brass nameplate, screwed onto the tally board's first cell (one object, not a second badge)
        sessCell.replaceChildren(plaque(name, { small: true, tone: hello?.demo ? 'butter' : hello?.session === 'default' ? 'slate' : undefined }));
        sessCell.title = p.title;
      }
      // one paper notice for "the office is not live": the socket or herdr (the plaque stays calm)
      const lost = !!hello && store.conn.state !== 'open';
      const offline = !!hello && !hello.demo && !store.herdr.connected;
      cls(banner, 'show', lost || offline);
      if (lost) {
        setText(bannerHead, store.conn.state === 'connecting' ? 'Reconnecting…' : 'Connection lost');
        setText(bannerTx, 'HQ lost its server; it retries on its own.');
        retry.hidden = true;
      } else if (offline) {
        setText(bannerHead, 'herdr offline');
        setText(bannerTx, `Agents are dozing${store.herdr.retryInMs ? ` · retrying in ${Math.ceil(store.herdr.retryInMs / 1000)} s` : ''} · run with --demo to explore without herdr`);
        retry.hidden = false;
      }
      // running wait times on live ticket stubs
      if (ticking.size) {
        const now = store.now?.() ?? Date.now();
        for (const [t, tk] of ticking) {
          if (!t.isConnected || t.classList.contains('resolved')) { ticking.delete(t); continue; }
          const s = waitLabel(Math.max(0, now - tk.since));
          if (tk.tEl.textContent !== s) tk.tEl.textContent = s;
        }
      }
      if (!d.params.nohud) fit();
    },
    /**
     * Position the tally / toasts over the visible world area and publish the bottom lanes (hotbar.ts reads them):
     *   --hb-lane-l  left edge of the hotbar lane (right of the minimap frame when it shows)
     *   --mini-top   distance from the bottom to the top of the minimap frame (0 = no minimap)
     * Tickets stack above the minimap (or above the hotbar when there is no minimap); `--hb-lift` (set by the hotbar
     * when it has to sit on top of the minimap, or shares the bottom edge with the tickets) lifts them further.
     */
    layout(left: number, right: number, bottom = 12) {
      const mini = bottom > 12 ? d.root.querySelector<HTMLElement>('.hq-mini') : null;
      const miniW = mini && !mini.hidden ? mini.offsetWidth : 0;
      const miniTop = miniW ? bottom : 0; // (bottom = 12 + frame height + 10)
      d.root.style.setProperty('--hb-lane-l', `${miniW ? left + 22 + miniW + 16 : left + 22}px`);
      d.root.style.setProperty('--mini-top', `${miniTop}px`);
      // a clear gutter over the frame (its tape and M keycap stick up ~8 px)
      toasts.style.bottom = `calc(${miniW ? miniTop + 12 : 22}px + var(--hb-lift, 0px))`;
      followChip.style.left = `calc(${left}px + (100% - ${left + right}px) / 2)`;
      top.style.left = `${left}px`;
      top.style.right = `${right}px`;
      stripL = left; stripR = right;
      const w = innerWidth - left - right;
      cross.style.left = `calc(${left}px + (100% - ${left + right}px) / 2)`;
      // tickets live in the free world strip: past the roster / icon rail, clamped to the strip width
      toasts.style.left = `${left + 22}px`;
      const tw = Math.max(0, Math.min(376, w - 44));
      toasts.style.width = `${tw}px`;
      // a lane too narrow for a whole ticket (roster + drawer both open at 1280): one line ticket, the newest only
      const narrow = tw < TOAST_LINE_PX;
      if (narrow) { toasts.style.left = `${left + 8}px`; toasts.style.width = `${Math.max(0, w - 16)}px`; }
      if (narrow !== toasts.classList.contains('narrow')) {
        cls(toasts, 'narrow', narrow);
        for (const c of liveTickets(toasts)) cls(c, 'line', narrow);
        for (const x of toasts.querySelectorAll('.more')) x.remove();
        renderMore(toasts);
      }
      fitKey = '';
      if (!d.params.nohud && top.isConnected) fit();
    },
    /**
     * A receipt ticket (UI kit §3 Ticket): stub (lamp + wait time) · caption · headline · one line · tear · key legend.
     * No close ×: Esc / timeout. In the drawer layer it is the one-line ticket. Blocked tickets always carry a `.sub`
     * line (the question may arrive after the status flip; notify.ts fills it in) and the focus-following key hint.
     */
    toast(level: TicketLevel, title: string | Node, o: TicketOpts = {}) {
      const host = (o.drawer && d.hooks.drawerToasts()) || toasts;
      const line = host !== toasts;
      // a plain-text warn / error / info notice: short headline + serif line (splitNotice), never a clamped headline
      if (typeof title === 'string' && !o.sub && level !== 'blocked' && level !== 'done') {
        const sp = splitNotice(title);
        if (sp.sub) { title = sp.head; o = { ...o, sub: sp.sub }; }
      }
      // plain info toasts merge into one updating ticket (reviewer: four stacked "i" toasts are noise)
      const key = o.key ?? (level === 'info' ? '__info' : null);
      if (key) host.querySelector(`[data-key="${CSS.escape(key)}"]`)?.remove();
      // every ticket has a stub with a lamp (§3 Ticket): blocked / error red triangle, warn butter triangle, done
      // green check, info the clay "seen" lamp
      const lampSt = level === 'blocked' || level === 'error' || level === 'warn' ? 'blocked' : level === 'done' ? 'done' : 'seen';
      const tEl = h('span.t');
      const stub = h('div.stub', null, lamp(lampSt, { size: line ? 'sm' : 'lg', still: level !== 'blocked', label: level }), o.since != null ? tEl : null);
      const sub = o.sub || level === 'blocked' ? h('div.sub.q', { text: o.sub ?? '', hidden: !o.sub }) : null;
      const hint = o.hint ? hintLegend(o.hint, { cls: 'hint', small: line }) : null;
      if (hint && o.hint) hint.dataset.hint = o.hint;
      const t = h(`div.hq-toast.k-ticket.in-anim.${level}${line || host.classList.contains('narrow') ? '.line' : ''}`, { role: level === 'blocked' || level === 'error' ? 'alert' : 'status', 'data-key': key },
        h('div.in', null, stub, h('div.body', null,
          o.caption && !line ? h('div.cap', { text: o.caption }) : null,
          h('div.what', null, title),
          sub,
          hint && !line ? h('hr.k-stitch.tear') : null,
          hint)));
      cls(t, 'blocked', level === 'blocked');
      cls(t, 'done', level === 'done');
      if (o.since != null) { tEl.textContent = waitLabel(Math.max(0, (store.now?.() ?? Date.now()) - o.since)); ticking.set(t, { since: o.since, tEl }); }
      if (o.onClick) { t.style.cursor = 'pointer'; t.addEventListener('click', o.onClick); }
      watch(host);
      host.append(t);
      if (!line && host.classList.contains('narrow')) renderMore(host);
      // a line ticket's key unit either fits whole or steps aside (never a clipped "[Ctrl `] then [U")
      if (line && hint && hint.scrollWidth > hint.clientWidth + 1) hint.hidden = true;
      // ≤ TOAST_MAX tickets; older ones fold into one "+N earlier" line at the top (click = the Blocked Inbox) instead
      // of silently vanishing. Blocked tickets outlive info ones.
      const live = () => liveTickets(host);
      let list = live();
      // (the drawer's footer rail holds ONE line ticket: it never stacks up over the CRT glass)
      while (list.length > (line ? 1 : TOAST_MAX)) {
        const drop = list.find((c) => !c.classList.contains('blocked')) ?? list[0];
        if (drop === t) break;
        drop.remove();
        list = live();
        bumpMore(host);
      }
      // two tickets show their line + legend, blocked ones first (the question is what you act on), then the newest;
      // the rest fold to their headline (hover unfolds)
      const open = new Set(list.filter((c) => c.classList.contains('blocked') && !c.classList.contains('resolved')).slice(-2));
      for (let i = list.length - 1; i >= 0 && open.size < 2; i--) open.add(list[i]);
      for (const c of list) cls(c, 'mini', !open.has(c));
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, o.ttl ?? (level === 'blocked' ? 8000 : 3500));
      return t;
    },
    leader(on: boolean, sub = '') {
      cls(leader, 'show', on);
      setText(leaderSub, sub);
    },
    announce(text: string, assertive = false) {
      const r = assertive ? liveA : liveP;
      r.textContent = '';
      setTimeout(() => { r.textContent = text; }, 30);
    },
  };
  return api;
}

/** Keycaps for a label as keymap.ts prints it ("Ctrl+K", "Leader Z", "W A S D", "1–9", "Leader (tap)"). */
export function capsFor(label: string): HTMLElement[] {
  const leader = String(keyPlatform().leaderLabel || 'Ctrl+`');
  const out: HTMLElement[] = [];
  for (const tok of String(label).split(/\s+/).filter(Boolean)) {
    if (tok === 'Leader' || tok === leader) { out.push(keys('Leader', { small: true })); continue; }
    if (/^\(.*\)$/.test(tok)) { out.push(h('span.tx', { text: tok })); continue; }
    const range = /^(.+)–(.+)$/.exec(tok);
    if (range) { out.push(keys([range[1], '–', range[2]], { small: true })); continue; }
    if (tok === '+') { out.push(keycap('+', { small: true })); continue; }
    if (tok === 'Arrows') { out.push(keys(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], { small: true })); continue; }
    out.push(comboCaps(tok).length > 1 ? keys(tok, { small: true }) : keycap(tok, { small: true }));
  }
  return out;
}
