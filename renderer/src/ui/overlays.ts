/**
 * `?` key overlay (generated from keymap.ts + platform.ts, so it can never drift) and the confirm sheet (the terminal
 * context menu lives in terminal/menu.ts). UI kit: the key overlay is a board with the `Keys · <scope>` plaque and a
 * scope detent holding paper sheets side by side (keycaps · verb lines). It is a dialog layer (dialogCss.ts `.hq-dlg`,
 * anchored below the HUD tally); the sheets end at their content and scroll inside the board's groove. The confirm is a paper sheet with one clay
 * primary. Owner: UI.
 */
import { h, refocus } from './dom.ts';
import { overlayRows, tableFor, type OverlayRow } from './keymap.ts';
import type { Platform } from './platform.ts';
import { board, paper, plaque, detent, button, scrollArea, trapFocus } from './kit/index.ts';
import { injectDialogCss, anchorBelowHud } from './dialogCss.ts';
import { capsFor } from './hud.ts';
import { ensureHudCss } from './hudCss.ts';

const SCOPE_TITLE: Record<string, string> = { world: 'World', roster: 'Roster', xterm: 'Terminal', input: 'Search field', palette: 'Palette', serve: 'Inbox' };
const SCOPES: readonly string[] = ['world', 'roster', 'serve', 'xterm', 'input', 'palette'];

/** One key line: caps (alternatives joined by a muted "or") · what it does. */
function keyLine(r: OverlayRow) {
  const alts = String(r.keys).split(' / ');
  const ks = h('dt.ks');
  alts.forEach((a, i) => { if (i) ks.append(h('span.or', { text: 'or' })); ks.append(...capsFor(a)); });
  return h('div.k-kl', null, ks, h('dd', { text: r.desc }));
}

export function createKeyOverlay(d: { root: HTMLElement; platform: Pick<Platform, 'mac' | 'leaderLabel'> }) {
  ensureHudCss();
  injectDialogCss();
  const title = plaque('Keys');
  const tabs = detent(SCOPES.map((s) => ({ value: s, label: SCOPE_TITLE[s] })), 'world', (s) => { scope = s === 'world' ? 'world-unlocked' : s; render(); });
  const lead = h('p.lead');
  const sheets = h('div.k-sheets');
  const scroller = scrollArea({}, sheets);
  const card = board({ cls: 'hq-keys' }, h('div.hd', null, title, h('span.k-sp'), tabs), lead, scroller);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Keyboard shortcuts');
  const wrap = h('div.hq-keys-wrap.hq-dlg.mid.dim', null, card);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) api.close(); });
  d.root.append(wrap);
  trapFocus(card);
  addEventListener('resize', () => { if (api.isOpen) anchorBelowHud(wrap); });
  let scope = 'world-unlocked';
  let restore: Element | null = null;

  function render() {
    const t = tableFor(scope);
    const rows = overlayRows(scope, d.platform.mac, d.platform.leaderLabel);
    title.textContent = `Keys · ${SCOPE_TITLE[t] ?? t}`;
    tabs.set(t);
    lead.textContent = t === 'xterm'
      ? 'In Control every key goes to the pane except the Leader. In Peek only typing, Enter, paste and Leader I take control; Esc returns to the world.'
      : `The keys of the current focus scope (${d.platform.mac ? 'macOS' : 'Linux / Windows'} layout). Esc closes.`;
    // own keys split over two sheets, the Leader chords on a third (the Leader cap is shown once, in its heading)
    const own = rows.filter((r) => !/^Leader\b/.test(String(r.keys)));
    const chords = rows.filter((r) => /^Leader\b/.test(String(r.keys)));
    const half = Math.ceil(own.length / (chords.length ? 2 : 3));
    const cols: OverlayRow[][] = [];
    for (let i = 0; i < own.length; i += half) cols.push(own.slice(i, i + half));
    const sheet = (heading: Node | null, list: OverlayRow[]) => paper({}, heading, h('dl', { style: { margin: 0 } }, ...list.map(keyLine)));
    sheets.replaceChildren(
      ...cols.map((c) => sheet(null, c)), // (the plaque already names the scope: no repeated heading)
      ...(chords.length ? [sheet(h('h4', null, 'Leader ', ...capsFor('Leader'), ' then'), chords.map((r) => ({ ...r, keys: String(r.keys).replace(/^Leader\s+/, '') })))] : []),
    );
    scroller.scrollTop = 0;
    scroller.update();
  }

  const api = {
    get isOpen() { return wrap.classList.contains('show'); },
    open(forScope?: string | null) {
      scope = forScope || 'world-unlocked';
      restore = document.activeElement;
      render();
      anchorBelowHud(wrap);
      wrap.classList.add('show');
      scroller.update();
      card.tabIndex = -1;
      // focus the sheets so ↑↓ / PgUp / PgDn / Space scroll them; Tab reaches the scope detent (←→ switch scope)
      scroller.focus();
    },
    close() {
      wrap.classList.remove('show');
      if (restore && restore !== document.body) refocus(restore);
    },
    get scope() { return scope; },
  };
  wrap.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' || ev.key === '?') { ev.preventDefault(); ev.stopPropagation(); api.close(); } });
  return api;
}

export function createConfirm(d: { root: HTMLElement }) {
  ensureHudCss();
  const text = h('p');
  const ok = button('OK', { key: 'Enter', primary: true });
  const cancel = button('Cancel', { key: 'Esc' });
  const card = paper({ cls: 'hq-confirm' }, text, h('div.row', null, cancel, ok));
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  const wrap = h('div.hq-confirm-wrap', null, h('div.k-veil'), card);
  d.root.append(wrap);
  let resolve: ((ok: boolean) => void) | null = null;
  let restore: Element | null = null;
  const okLabel = document.createTextNode('OK');
  ok.lastChild?.replaceWith(okLabel);
  const done = (v: boolean) => {
    wrap.classList.remove('show');
    const r = resolve;
    resolve = null;
    if (restore && restore !== document.body) refocus(restore);
    r?.(v);
  };
  ok.addEventListener('click', () => done(true));
  cancel.addEventListener('click', () => done(false));
  wrap.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(false); }
    else if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); done(true); }
  });
  return {
    get isOpen() { return !!resolve; },
    ask(message: string, label = 'OK'): Promise<boolean> {
      if (resolve) done(false);
      restore = document.activeElement;
      text.textContent = message;
      okLabel.textContent = label;
      wrap.classList.add('show');
      ok.focus();
      return new Promise<boolean>((r) => { resolve = r; });
    },
  };
}
