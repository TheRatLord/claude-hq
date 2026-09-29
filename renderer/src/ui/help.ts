/**
 * Help overlay (`H` / `F1`, §8 "Help / onboarding / settings", GP §5.8; ui-kit §5.5): a notice board (the one
 * `How HQ works` plaque) holding THREE paper sheets side by side (the kit's limit): Get around + Terminals, Answer &
 * sign off + States, Where agents go + keyed ledger lines to the tour (`T`), settings (`S`) and all keys (`?`). The
 * sheets scroll inside the board below the plaque line when the window is short. One legend (`Esc` close). Every key cap comes from kit/keys.ts (platform.ts labels: Ctrl/⌘, the Leader
 * as one cap), so it follows the client platform and Leader setting. Modal for the key dispatcher; Esc / H / F1 close.
 * Owner: UI.
 */
import { h, refocus, type Kid } from './dom.ts';
import { board, paper, plaque, keys, legend, ledger, stateWord, scrollArea, trapFocus } from './kit/index.ts';
import { injectDialogCss, anchorBelowHud } from './dialogCss.ts';

/** Where agents go (DESIGN §7.1 / §6.4), in reading order. */
export const ZONE_LEGEND: readonly (readonly [name: string, where: string, text: string])[] = Object.freeze([
  ['Help Desk queue', 'Lobby', 'blocked agents line up with a ticket: answer them (B)'],
  ['Desks', 'E1–E3 · W1–W3 bays', 'one bay per herdr workspace; working agents type here'],
  ['Stations', 'Library · War Room · Lab · Mailroom', 'agents walk over to read/search, plan, test/build, commit'],
  ['The Pit', 'atrium', 'finished agents lounge until you sign off (G high-five)'],
  ['Engine Room', 'east', 'shells (CRT robots) at their benches; the busy ones glow'],
  ['Café & Arcade', 'south-east', 'idle agents hang out, play and nap'],
]);

const STATES: readonly (readonly [state: string, text: string])[] = [
  ['blocked', 'needs your answer: waves, red ring, beacon'],
  ['working', 'busy with a tool: typing, walking to a station'],
  ['done', 'finished: waits in the Pit for a sign-off'],
  ['idle', 'nothing to do: coffee, games, naps'],
  ['shell', 'a shell at its prompt'],
  ['busy', 'a shell running a command'],
  // [UI fix r1, playtest] the HUD's unknown count had no legend entry
  ['unknown', 'herdr can’t tell yet: it wanders, puzzled'],
];
/** [UI fix r1, playtest "≥ 0:36 means what?"] the wait clock's prefix, spelled out (shared/clock.ts waitClock). */
export const AT_LEAST = 'at least: HQ saw it start before it connected, so the real time is longer';
export const UNKNOWN_TIP = 'unknown: herdr can’t tell its state yet (H → States)';

export interface HelpDeps {
  root: HTMLElement;
  hooks: { keys(): void; settings(): void; tour(): void; closed(): void };
}

export function createHelp(d: HelpDeps) {
  injectDialogCss();
  const body = h('div.bd', { style: { display: 'contents' } });
  const card = board({ cls: 'hq-help' }, body);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Help');
  card.tabIndex = -1;
  const wrap = h('div.hq-help-wrap.hq-dlg.mid.dim', null, card);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) api.close(); });
  d.root.append(wrap);
  trapFocus(card);
  addEventListener('resize', () => { if (api.isOpen) anchorBelowHud(wrap); });
  let restore: Element | null = null;
  let scroller: ReturnType<typeof scrollArea> | null = null;

  /** one `keycaps · verb` line; `k` = a combo, a list for a range, or a node */
  const kl = (k: string | string[] | Node, ...desc: Kid[]) => h('div.k-kl', null, h('span.ks', null, k instanceof Node ? k : keys(k, { small: true })), h('span', null, ...desc));
  const sheet = (...kids: Kid[]) => paper({}, ...kids);
  /** the ways on from here: keyed ledger lines at the foot of the last sheet */
  const LINKS = [
    { key: 'T', label: 'Replay the tour', run: () => d.hooks.tour() },
    { key: 'S', label: 'Settings', run: () => d.hooks.settings() },
    { key: '?', label: 'All keys, per scope', run: () => d.hooks.keys() },
  ];
  function runLink(i: number) { const l = LINKS[i]; if (!l) return; api.close(); l.run(); }

  function build() {
    const links = ledger(LINKS.map((l) => ({ key: l.key, label: l.label })), { selected: -1, onPick: (i) => runLink(i) });
    links.setAttribute('aria-label', 'More help');
    scroller = scrollArea({},
      h('div.k-sheets', null,
        sheet(
          h('h4', { text: 'Get around' }),
          kl(['W', 'A', 'S', 'D'], 'walk (click to look)'),
          kl('Shift', 'hold to sprint'),
          kl('M', 'office map'),
          kl('Mod+K', 'find anyone or anything'),
          kl(['1', '–', '9'], 'open a pinned agent'),
          kl(['Shift+1', '–', '9'], 'pin the aimed agent'),
          h('h4', { text: 'Terminals' }),
          kl('E', 'open the aimed agent'),
          kl('Tab', 'roster, most urgent on top'),
          kl(h('span.k-p3', { text: 'type' }), 'in Peek to take control'),
          kl('Leader', 'back to the office'),
          kl('Enter', 'back to the last terminal')),
        sheet(
          h('h4', { text: 'Answer & sign off' }),
          kl('B', 'blocked inbox'),
          kl('Shift+B', 'triage, one key each'),
          kl('T', 'talk: a one-line task'),
          kl('G', 'high-five = sign off'),
          kl(['Alt+1', '–', '9'], 'quick answer'),
          kl('Shift+N', 'rename (HQ only)'),
          h('h4', { text: 'States' }),
          ...STATES.map(([s, txt]) => kl(h('span.ks.w', null, stateWord(s, { still: true })), h('span.d', { text: txt }))),
          h('p.note', { text: `≥ 0:36 · ${AT_LEAST}.` })),
        sheet(
          h('h4', { text: 'Where agents go' }),
          ...ZONE_LEGEND.map(([n, where, txt]) => h('div.k-kl', null, h('span', null, h('b', { text: n }), h('span.k-p3', { text: ` · ${where}` }), h('br'), h('span.d', { text: txt })))),
          h('p.note', { text: 'Hats and headphones show the workspace: each has its own colour and accessory.' }),
          links)));
    body.replaceChildren(
      h('div.hd', null, plaque('How HQ works'),
        h('p.intro', { text: 'Every clay critter is a live herdr agent, every CRT robot a shell: walk up to anyone, see what they are doing, jump into their terminal.' }),
        legend([{ key: 'Escape', label: 'close' }])),
      scroller,
    );
  }

  card.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' || ev.code === 'KeyH' || ev.code === 'F1') { ev.preventDefault(); ev.stopPropagation(); api.close(); }
    else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const i = LINKS.findIndex((l) => l.key === ev.key || l.key === ev.key.toUpperCase());
      if (i >= 0) { ev.preventDefault(); ev.stopPropagation(); runLink(i); }
    }
  });

  const api = {
    el: wrap,
    get isOpen() { return wrap.classList.contains('show'); },
    open() {
      restore = document.activeElement;
      if (document.pointerLockElement) document.exitPointerLock?.();
      build();
      anchorBelowHud(wrap);
      wrap.classList.add('show');
      scroller?.update();
      // focus the scrolling sheets so ↑↓ / PgUp / PgDn / Space scroll them (the card's keydown still sees every key)
      (scroller ?? card).focus();
    },
    close() {
      if (!api.isOpen) return;
      wrap.classList.remove('show');
      const r = restore;
      restore = null;
      if (r && r !== document.body && r.isConnected) refocus(r);
      d.hooks.closed();
    },
    toggle() { if (api.isOpen) api.close(); else api.open(); },
  };
  return api;
}
