/**
 * Pause menu (Esc with nothing open, or losing pointer lock): Resume, Settings (server-persisted settings plus local
 * HUD preferences), Controls help. Also the first-run hint card.
 */
import type { Settings as WireSettings } from '../../../../shared/protocol.ts';
import { ICONS, icon } from './icons.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';

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
    const big = (label: string, ico: string, fn: () => void, cls = '') => h(`button.vh-btn${cls}`, { type: 'button', onclick: fn }, icon(ico), label);
    return h('div.main', null,
      big('Back to the valley', ICONS.play, () => ctx.panels.close(), '.primary'),
      big('Farm ledger', ICONS.book, () => ctx.panels.open('roster')),
      big('Map', ICONS.map, () => ctx.panels.open('map')),
      big('Mailbox', ICONS.mail, () => ctx.panels.open('mailbox')),
      big('Almanac (system stats)', ICONS.stats, () => ctx.panels.open('stats')),
      big('Settings', ICONS.gear, () => setTab('settings')),
      big('Controls', ICONS.keyboard, () => setTab('controls')));
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
      h('h4', { text: 'Look & feel' }),
      h('label.vh-set', null, h('span', { text: 'Graphics quality' }), quality),
      range('Field of view', 'fov', 55, 75, 1, (v) => `${v}°`),
      flag('Head bob', 'headBob'), flag('Reduced motion', 'reducedMotion'),
      pref('Corner minimap (N)', 'minimap'), pref('Pop-up toasts', 'toasts'), pref('Compact needs-you cards', 'compactStrip'),
      h('h4', { text: 'Terminal' }),
      range('Text size', 'termFontPx', 8, 32, 1, (v) => `${v}px`),
      h('label.vh-set', null, h('span', { text: 'Leader key (close / open)' }), leader),
      flag('Opening a finished farmer acknowledges it', 'autoAckOnOpen'), flag('Copy on select', 'copyOnSelect'),
      h('label.vh-set', null, h('span', { text: 'Confirm pastes longer than (lines)' }), paste),
      flag('Ask before Ctrl+C while watching', 'peekCtrlCConfirm'), flag('Release control after 10 idle minutes', 'idleDemotion'),
    );
    return wrap;
  }

  function controls(): HTMLElement {
    const row = (keys: string[], what: string) => [h('div.k', null, ...keys.map((k) => h('kbd.vh-k', { text: k }))), h('span', { text: what })];
    const leader = S.get('leaderKey') || 'Ctrl+`';
    return h('div.vh-controls', null,
      ...row(['Click'], 'look around (capture mouse)'), ...row(['W', 'A', 'S', 'D'], 'walk'),
      ...row(['Shift'], 'sprint'), ...row(['Space'], 'hop'),
      ...row(['E'], 'talk / use'), ...row(['F'], 'open terminal of the farmer in front'),
      ...row(['M'], 'map (click a farmer → terminal)'), ...row(['Tab'], 'farm ledger'),
      ...row(['J'], 'mailbox'), ...row(['N'], 'toggle minimap'),
      ...row(['Alt+1…9'], "open the Nth needs-you farmer's terminal"), ...row([leader], 'open / close terminal drawer'),
      ...row(['Ctrl+PgUp', 'PgDn'], 'next / previous terminal'), ...row(['Esc'], 'close (in a terminal: only while watching)'),
      ...row(['type'], 'in a terminal: take control'), ...row(['Wheel ↑'], 'terminal scrollback'),
      ...row(['F3'], 'performance overlay'), ...row(['B'], 'noticeboard'));
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
