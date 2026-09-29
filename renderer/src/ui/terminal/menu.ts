/**
 * The drawer's menus (right-click on the glass, the header's ⋯): a paper SLIP torn off for this pane, the kit's
 * clay-ruled band naming it, then ledger lines, each with its key tiles at the right end (a menu always shows its
 * keys: Ctrl ⇧ C, Leader I…). Keyboard-first: it opens with the first line highlighted, ↑/↓ move, Enter picks, Esc
 * closes; any other key closes it and goes on to the pane. Focus stays in the xterm (scope 'xterm'), so no world key
 * fires underneath it. Owner: UI (drawer). Kit parts only (paper · slipBand · ledger with `keys`).
 */
import { paper, slipBand, ledger, type Ledger } from '../kit/index.ts';

export interface MenuItem { label: string; fn: () => void; keys?: string | string[]; note?: string; destructive?: boolean; disabled?: boolean }

export function createDrawerMenu(d: { host: HTMLElement; refocus?: () => void }) {
  const el = paper({ cls: 'hq-tmenu k-slip' });
  el.setAttribute('role', 'menu');
  el.hidden = true;
  d.host.append(el);
  let items: MenuItem[] = [];
  let list: Ledger | null = null;
  let open = false;

  const hide = () => { if (!open) return; open = false; el.hidden = true; list = null; };
  const enabled = (i: number) => i >= 0 && i < items.length && !items[i].disabled;
  function move(dir: number) {
    if (!list) return;
    let i = list.selected ?? -1;
    for (let n = 0; n < items.length; n++) { i = (i + dir + items.length) % items.length; if (enabled(i)) break; }
    if (enabled(i)) list.select(i);
  }
  function pick(i: number) {
    if (!enabled(i)) return;
    const it = items[i];
    hide();
    d.refocus?.();
    it.fn();
  }

  addEventListener('mousedown', (ev) => { if (open && !(ev.target instanceof Node && el.contains(ev.target))) hide(); }, true);
  addEventListener('blur', () => hide());
  addEventListener('keydown', (ev) => {
    if (!open) return;
    const own = (fn: () => void) => { ev.preventDefault(); ev.stopPropagation(); fn(); };
    if (ev.key === 'ArrowDown') own(() => move(1));
    else if (ev.key === 'ArrowUp') own(() => move(-1));
    else if (ev.key === 'Home') own(() => { list?.select(-1); move(1); });
    else if (ev.key === 'End') own(() => { list?.select(items.length); move(-1); });
    else if (ev.key === 'Enter' || ev.key === ' ') own(() => pick(list?.selected ?? -1));
    else if (ev.key === 'Escape') own(() => { hide(); d.refocus?.(); });
    else if (!/^(Control|Shift|Alt|Meta)$/.test(ev.key)) hide(); // the key goes on to the pane / its binding
  }, true);

  return {
    el,
    get isOpen() { return open; },
    hide,
    /** `x`, `y`: viewport px (the pointer, or under the ⋯ button). `head.right`: x is the slip's right edge. */
    show(x: number, y: number, list0: (MenuItem | null | undefined | false)[], head: { title: string; span?: string; right?: boolean }) {
      items = list0.filter((it): it is MenuItem => !!it);
      const menu = ledger(items.map((it) => ({ label: it.label, keys: it.keys, note: it.note, destructive: it.destructive })),
        { numbered: false, selected: -1, onPick: (i) => pick(i) });
      list = menu;
      menu.setAttribute('role', 'none');
      menu.querySelectorAll('li').forEach((li, i) => {
        li.setAttribute('role', 'menuitem');
        li.removeAttribute('aria-selected');
        if (items[i].disabled) li.setAttribute('aria-disabled', 'true');
        li.addEventListener('mouseenter', () => { if (enabled(i)) menu.select(i); });
      });
      el.replaceChildren(slipBand({ title: head.title, span: head.span }), menu);
      el.hidden = false;
      open = true;
      move(1);
      // keep the slip on screen: flip left/up from the pointer when it would run off the right/bottom edge
      const r = el.getBoundingClientRect();
      const x0 = head.right ? x - r.width : x;
      const left = x0 + r.width + 8 > innerWidth ? Math.max(8, x0 - r.width) : Math.max(8, x0);
      const top = y + r.height + 8 > innerHeight ? Math.max(8, y - r.height) : y;
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      d.refocus?.();
    },
  };
}
