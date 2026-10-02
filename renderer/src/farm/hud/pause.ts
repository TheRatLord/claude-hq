/**
 * Pause menu (Esc with nothing open, or losing pointer lock): Resume, Settings (server-persisted settings plus local
 * HUD preferences, incl. opt-in desktop notifications: notify.ts), Controls help (also `?` from anywhere). Also the
 * first-run hint card.
 */
import type { Settings as WireSettings } from '../../../../shared/protocol.ts';
import { ICONS, icon } from './icons.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';
import { notifyPermission, requestNotify } from './notify.ts';

type Tab = 'menu' | 'settings' | 'controls';

export function createPause(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('pause', 'Paused', ICONS.gear);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const plaque = el.querySelector('.vh-plaque span:last-child') as HTMLElement;
  let tab: Tab = 'menu';
  const tabs = h('div.vh-tabs', { role: 'tablist' });
  const content = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '0', flex: '1' } });
  body.append(tabs, content);
  const S = ctx.d.settings;

  const setTab = (t: Tab) => { tab = t; render(); };
  function render(): void {
    plaque.textContent = tab === 'menu' ? 'Paused' : tab === 'settings' ? 'Settings' : 'Controls';
    tabs.replaceChildren(...(['menu', 'settings', 'controls'] as const).map((t) => {
      const b = h('button.vh-tab', { type: 'button', role: 'tab', 'aria-selected': String(t === tab) }, t === 'menu' ? 'Menu' : t === 'settings' ? 'Settings' : 'Controls');
      b.addEventListener('click', () => setTab(t));
      return b;
    }));
    content.replaceChildren(tab === 'menu' ? menu() : tab === 'settings' ? settings() : controls());
  }

  function menu(): HTMLElement {
    const big = (label: string, ico: string, key: string, fn: () => void, cls = '') => h(`button.vh-btn${cls}`, { type: 'button', onclick: fn, 'data-testid': `pause-${label.split(' ')[0].toLowerCase()}` }, icon(ico), label, key ? h('kbd.vh-k', { text: key }) : null);
    const leader = S.get('leaderKey') || 'Ctrl+`';
    return h('div.main', null,
      big('Back to the valley', ICONS.play, 'Esc', () => ctx.panels.close(), '.primary'),
      big('Terminals', ICONS.terminal, leader, () => { const id = bestId(); if (id) ctx.openTerminal(id); else ctx.panels.open('drawer'); }),
      big('Farm ledger', ICONS.book, 'Tab', () => ctx.panels.open('roster')),
      big('Map', ICONS.map, 'M', () => ctx.panels.open('map')),
      big('Mailbox', ICONS.mail, 'J', () => ctx.panels.open('mailbox')),
      big('Noticeboard', ICONS.board, 'B', () => ctx.panels.open('noticeboard')),
      big('Almanac (system stats)', ICONS.stats, '', () => ctx.panels.open('stats')),
      big('Settings', ICONS.gear, '', () => setTab('settings')),
      big('Controls', ICONS.keyboard, '?', () => setTab('controls')));
  }

  /** who the Terminals entry opens: whoever needs you first, else anyone (the drawer's list switches) */
  function bestId(): string | null {
    const s = ctx.state();
    if (!s) return null;
    const fs = [...s.farmers.values()];
    return (fs.find((f) => f.needsYou) ?? fs.find((f) => f.unseenDone) ?? fs[0])?.id ?? [...s.helpers.keys()][0] ?? null;
  }

  function settings(): HTMLElement {
    const wrap = h('div.vh-settings.vh-scroll');
    const range = <K extends keyof WireSettings>(label: string, k: K, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const v = h('span.v', { text: fmt(Number(S.get(k))) });
      const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(S.get(k)), 'aria-label': label });
      inp.addEventListener('input', () => { v.textContent = fmt(inp.valueAsNumber); S.set({ [k]: inp.valueAsNumber } as Partial<WireSettings>); });
      return h('label.vh-set', null, h('span', { text: label }), inp, v);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const inp = h('input', { type: 'checkbox', 'aria-label': label });
      inp.checked = get();
      inp.addEventListener('change', () => set(inp.checked));
      return h('label.vh-set', null, h('span', { text: label }), inp);
    };
    const flag = <K extends keyof WireSettings>(label: string, k: K) => check(label, () => !!S.get(k), (v) => S.set({ [k]: v } as Partial<WireSettings>));
    const pref = (label: string, k: 'minimap' | 'toasts' | 'compactStrip') => check(label, () => ctx.prefs[k], (v) => { ctx.prefs[k] = v; ctx.savePrefs(); ctx.kick(); });
    const vol = (v: number) => `${Math.round(v * 100)}%`;
    const quality = h('select', { 'aria-label': 'Graphics quality' }, ...(['auto', 'low', 'medium', 'high', 'photo'] as const).map((q) => h('option', { value: q, text: q[0].toUpperCase() + q.slice(1) })));
    quality.value = S.get('quality');
    quality.addEventListener('change', () => S.set({ quality: quality.value as WireSettings['quality'] }));
    const leader = h('input', { type: 'text', value: S.get('leaderKey'), 'aria-label': 'Terminal leader key', spellcheck: 'false' });
    leader.addEventListener('change', () => { if (leader.value.trim()) S.set({ leaderKey: leader.value.trim() }); });
    const paste = h('input', { type: 'number', min: '0', max: '200', value: String(S.get('pasteConfirmLines')), 'aria-label': 'Confirm pastes longer than' });
    paste.addEventListener('change', () => S.set({ pasteConfirmLines: Math.max(0, Math.round(paste.valueAsNumber || 0)) }));
    wrap.append(
      h('h4', { text: 'Sound' }),
      range('Master volume', 'volumeMaster', 0, 1, 0.05, vol), range('Effects', 'volumeSfx', 0, 1, 0.05, vol),
      range('Ambience', 'volumeAmbient', 0, 1, 0.05, vol), range('Alerts & chimes', 'volumeNotify', 0, 1, 0.05, vol),
      range('Farmer voices', 'volumeVoices', 0, 1, 0.05, vol), range('Music', 'volumeMusic', 0, 1, 0.05, vol), flag('Mute everything', 'audioMuted'),
      h('h4', { text: 'Alerts' }),
      notifyRow(),
      h('h4', { text: 'Look & feel' }),
      h('label.vh-set', null, h('span', { text: 'Graphics quality' }), quality),
      range('Field of view', 'fov', 55, 75, 1, (v) => `${v}°`),
      flag('Head bob', 'headBob'), flag('Reduced motion', 'reducedMotion'),
      pref('Corner minimap (N)', 'minimap'), pref('Pop-up toasts', 'toasts'), pref('Fold the needs-you list (Alt+0)', 'compactStrip'),
      h('h4', { text: 'Terminal' }),
      range('Text size', 'termFontPx', 8, 32, 1, (v) => `${v}px`),
      h('label.vh-set', null, h('span', { text: 'Leader key (close / open)' }), leader),
      flag('Opening a finished farmer acknowledges it', 'autoAckOnOpen'), flag('Copy on select', 'copyOnSelect'),
      h('label.vh-set', null, h('span', { text: 'Confirm pastes longer than (lines)' }), paste),
      flag('Ask before Ctrl+C while watching', 'peekCtrlCConfirm'), flag('Release control after 10 idle minutes', 'idleDemotion'),
    );
    return wrap;
  }

  /** opt-in desktop notifications (browser-local pref; asks the browser for permission when switched on) */
  function notifyRow(): HTMLElement {
    const inp = h('input', { type: 'checkbox', 'aria-label': 'Desktop notifications', 'data-testid': 'set-notify' });
    const note = h('small.vh-muted', { style: { gridColumn: '1 / -1', marginTop: '-4px', fontSize: '12px', fontWeight: '600' } });
    const sync = () => {
      const p = notifyPermission();
      inp.checked = ctx.prefs.notify && p === 'granted';
      inp.disabled = p === 'unsupported';
      note.textContent = p === 'unsupported' ? 'This browser has no desktop notifications; the tab title and icon still count who needs you.'
        : p === 'denied' ? 'Blocked in the browser settings for this page; allow notifications there to use this.'
          : 'Only while the valley is in the background. Click one to jump to that terminal.';
    };
    inp.addEventListener('change', () => {
      if (!inp.checked) { ctx.prefs.notify = false; ctx.savePrefs(); sync(); return; }
      void requestNotify().then((ok) => {
        ctx.prefs.notify = ok; ctx.savePrefs(); sync();
        if (ok) ctx.toast({ text: 'Desktop notifications on', sub: 'when someone needs you or finishes while you are away', level: 'good', icon: ICONS.bell });
      });
    });
    sync();
    return h('div', { style: { display: 'contents' } }, h('label.vh-set', null, h('span', { text: 'Desktop notifications: needs you / finished' }), inp), note);
  }

  function controls(): HTMLElement {
    const row = (keys: string[], what: string) => [h('div.k', null, ...keys.map((k) => h('kbd.vh-k', { text: k }))), h('span', { text: what })];
    const leader = S.get('leaderKey') || 'Ctrl+`';
    const head = (t: string) => h('h4.grp', { text: t });
    return h('div.vh-controls', { 'data-testid': 'controls' },
      head('Getting around'),
      ...row(['Click'], 'look around (capture mouse)'), ...row(['W', 'A', 'S', 'D'], 'walk'),
      ...row(['Shift'], 'sprint'), ...row(['Space'], 'hop'),
      ...row(['E'], 'talk / use'), ...row(['F'], "terminal of the farmer you're facing"),
      ...row(['M'], 'map (click a farmer → terminal)'), ...row(['N'], 'toggle minimap'),
      head('Your agents'),
      ...row(['Tab'], 'farm ledger: everyone at a glance'), ...row(['J'], 'mailbox (Needs you first)'),
      ...row(['Alt+1…9'], "the Nth needs-you farmer's terminal"), ...row(['Alt+0'], 'fold / unfold the needs-you list'),
      ...row([leader], 'open / close the terminal drawer'), ...row(['Ctrl+PgUp', 'PgDn'], 'previous / next terminal'),
      head('In the mailbox'),
      ...row(['1…9'], 'answer the selected ask (then the next is selected)'), ...row(['↑', '↓'], 'next / previous letter'),
      ...row(['Enter'], 'open its terminal'), ...row(['R'], 'mark read (Shift+R: all)'),
      head('In the ledger'),
      ...row(['type'], 'filter by name, field, job, question'), ...row(['Enter'], 'open terminal (Shift: walk there)'),
      ...row(['Ctrl+I'], 'details card'), ...row(['Ctrl+Enter'], 'give an idle farmer a new task'),
      head('Farmer card & terminal'),
      ...row(['T'], 'open terminal'), ...row(['N'], 'new task (idle / finished farmers)'),
      ...row(['A'], 'acknowledge a finished farmer'), ...row(['1…9'], 'answer a question'),
      ...row(['type'], 'in a terminal: take control'), ...row(['Esc'], 'close (in a terminal: only while watching)'),
      head('The valley'),
      ...row(['B'], 'noticeboard'), ...row(['H'], 'valley almanac'),
      ...row(['K'], 'collections book'), ...row(['I'], 'your basket & the shop'),
      ...row(['F'], 'facing a villager: give a gift from your basket (1…9 picks)'),
      ...row(['P'], 'photo mode (fly, [ ] time, Enter saves a PNG)'),
      ...row(['?'], 'this list'), ...row(['F3'], 'performance overlay'));
  }

  return {
    id: 'pause', el,
    onOpen(arg) { tab = arg === 'settings' || arg === 'controls' ? arg : 'menu'; render(); (content.querySelector('button') as HTMLElement | null)?.focus(); },
    key(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const bs = [...content.querySelectorAll<HTMLElement>('.main button')];
        if (!bs.length) return false;
        const i = bs.indexOf(document.activeElement as HTMLElement);
        bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
        return true;
      }
      return false;
    },
  };
}

export function createHint(): HTMLElement {
  const k = (t: string) => h('kbd.vh-k', { text: t });
  return h('div.vh-hint.vh-wood', { 'data-testid': 'first-run-hint', 'aria-live': 'polite' }, h('div.vh-paper', null,
    h('h2', { text: 'Welcome to Claude Valley' }),
    h('p', { text: 'Your agents are the farmers. Walk over and say hi — or reach any terminal from the menus.' }),
    h('div.keys', null,
      h('span', null, k('Click'), 'look around'), h('span', null, k('W'), k('A'), k('S'), k('D'), 'walk'),
      h('span', null, k('Shift'), 'sprint'), h('span', null, k('E'), 'talk · ', k('F'), 'terminal'),
      h('span', null, k('M'), 'map'), h('span', null, k('Tab'), 'ledger'),
      h('span', null, k('J'), 'mailbox'), h('span', null, k('Esc'), 'menu')),
    h('div.go', { text: 'Click anywhere to start' })));
}
