/**
 * Pause menu (Esc with nothing open, or losing pointer lock): Resume, Settings, Controls help (also `?` from anywhere).
 * Also the first-run hint card. Settings are sections (Controls, Graphics, Audio, Interface, Accessibility, Alerts,
 * Terminal): server-persisted settings (volumes, the terminal: core/settings.ts) beside the browser-local prefs
 * (model/prefs.ts: comfort, graphics, accessibility, key bindings; ctx.prefs), see docs/valley/hud.md → Settings.
 */
import type { Settings as WireSettings } from '../../../../shared/protocol.ts';
import { ICONS, icon } from './icons.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';
import { notifyPermission, requestNotify } from './notify.ts';
import { replayWelcome } from './onboarding.ts';
import { ACTIONS, ACTION_LABEL, DEFAULT_KEYS, IDLE_FPS, RANGES, keyLabel, rebind, type Action, type Prefs } from '../model/prefs.ts';

type Section = 'controls' | 'graphics' | 'audio' | 'interface' | 'access' | 'alerts' | 'terminal';
const SECTIONS: readonly (readonly [Section, string])[] = [
  ['controls', 'Controls'], ['graphics', 'Graphics'], ['audio', 'Audio'], ['interface', 'Interface'], ['access', 'Accessibility'], ['alerts', 'Alerts'], ['terminal', 'Terminal'],
];

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
      const b = h('button.vh-tab', { type: 'button', role: 'tab', 'aria-selected': String(t === tab), 'data-sec': `tab-${t}` }, t === 'menu' ? 'Menu' : t === 'settings' ? 'Settings' : 'Controls');
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
      big('Farm ledger', ICONS.book, keyLabel(ctx.prefs.keys.ledger), () => ctx.panels.open('roster')),
      big('Map', ICONS.map, keyLabel(ctx.prefs.keys.map), () => ctx.panels.open('map')),
      big('Mailbox', ICONS.mail, keyLabel(ctx.prefs.keys.mail), () => ctx.panels.open('mailbox')),
      big('Noticeboard', ICONS.board, 'B', () => ctx.panels.open('noticeboard')),
      big('Almanac (system stats)', ICONS.stats, '', () => ctx.panels.open('stats')),
      big('Photo album', ICONS.camera, 'L', () => ctx.panels.open('album')),
      big('Settings', ICONS.gear, '', () => setTab('settings')),
      big('Controls', ICONS.keyboard, '?', () => setTab('controls')),
      ctx.b?.onboarding ? big('Replay the welcome', ICONS.mail, '', () => replayWelcome(ctx)) : null);
  }

  /** who the Terminals entry opens: whoever needs you first, else anyone (the drawer's list switches) */
  function bestId(): string | null {
    const s = ctx.state();
    if (!s) return null;
    const fs = [...s.farmers.values()];
    return (fs.find((f) => f.needsYou) ?? fs.find((f) => f.unseenDone) ?? fs[0])?.id ?? [...s.helpers.keys()][0] ?? null;
  }

  // ---- Settings: one section at a time (Controls, Graphics, Audio, Interface, Accessibility, Alerts, Terminal)
  let section: Section = 'controls';
  /** the action waiting for its new key (key capture in `key()` below), and the last rebind message */
  let capturing: Action | null = null, bindMsg = '';
  const P = ctx.prefs;
  const savePref = () => { ctx.savePrefs(); ctx.kick(); };

  function settings(): HTMLElement {
    const nav = h('div.vh-tabs.vh-setnav', { role: 'tablist', 'aria-label': 'Settings sections' }, ...SECTIONS.map(([id, label]) => {
      const b = h('button.vh-tab', { type: 'button', role: 'tab', 'aria-selected': String(id === section), 'data-testid': `set-sec-${id}`, 'data-sec': id }, label);
      b.addEventListener('click', () => { section = id; capturing = null; render(); (content.querySelector(`[data-sec="${id}"]`) as HTMLElement | null)?.focus(); });
      return b;
    }));
    const wrap = h('div.vh-settings.vh-scroll', { role: 'tabpanel', 'aria-label': SECTIONS.find(([id]) => id === section)?.[1] ?? '', 'data-testid': `set-${section}` });
    wrap.append(...SECTION_BODY[section]());
    return h('div.vh-setwrap', null, nav, wrap);
  }

  // ---- row builders
  const note = (text: string, testid?: string) => h('small.vh-setnote', { text, ...(testid ? { 'data-testid': testid } : {}) });
  const rangeRow = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, fmt: (v: number) => string, testid?: string) => {
    const v = h('span.v', { text: fmt(get()) });
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), 'aria-label': label, 'aria-valuetext': fmt(get()), ...(testid ? { 'data-testid': testid } : {}) });
    inp.addEventListener('input', () => { v.textContent = fmt(inp.valueAsNumber); inp.setAttribute('aria-valuetext', fmt(inp.valueAsNumber)); set(inp.valueAsNumber); });
    return h('label.vh-set', null, h('span', { text: label }), inp, v);
  };
  const check = (label: string, get: () => boolean, set: (v: boolean) => void, testid?: string) => {
    const inp = h('input', { type: 'checkbox', 'aria-label': label, ...(testid ? { 'data-testid': testid } : {}) });
    inp.checked = get();
    inp.addEventListener('change', () => set(inp.checked));
    return h('label.vh-set', null, h('span', { text: label }), inp);
  };
  const choose = <T extends string | number>(label: string, opts: readonly (readonly [T, string])[], get: () => T, set: (v: T) => void, testid?: string) => {
    const sel = h('select', { 'aria-label': label, ...(testid ? { 'data-testid': testid } : {}) }, ...opts.map(([v, t]) => h('option', { value: String(v), text: t })));
    sel.value = String(get());
    sel.addEventListener('change', () => { const o = opts.find(([v]) => String(v) === sel.value); if (o) set(o[0]); });
    return h('label.vh-set', null, h('span', { text: label }), sel);
  };
  // server settings (roam with the HQ) and browser-local prefs (this machine)
  const range = <K extends keyof WireSettings>(label: string, k: K, min: number, max: number, step: number, fmt: (v: number) => string) =>
    rangeRow(label, () => Number(S.get(k)), (v) => S.set({ [k]: v } as Partial<WireSettings>), min, max, step, fmt);
  const flag = <K extends keyof WireSettings>(label: string, k: K) => check(label, () => !!S.get(k), (v) => S.set({ [k]: v } as Partial<WireSettings>));
  type BoolPref = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];
  type NumPref = { [K in keyof Prefs]: Prefs[K] extends number ? K : never }[keyof Prefs];
  const pref = (label: string, k: BoolPref, testid?: string) => check(label, () => P[k], (v) => { P[k] = v; savePref(); }, testid);
  const num = (label: string, k: NumPref & keyof typeof RANGES, step: number, fmt: (v: number) => string, testid?: string) =>
    rangeRow(label, () => P[k], (v) => { P[k] = v; savePref(); }, RANGES[k][0], RANGES[k][1], step, fmt, testid);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const SECTION_BODY: Record<Section, () => Node[]> = {
    controls: () => [
      num('Mouse sensitivity', 'mouseSens', 0.05, (v) => `×${v.toFixed(2)}`, 'set-sens'),
      pref('Invert mouse Y', 'invertY', 'set-invert'),
      num('Field of view', 'fov', 1, (v) => `${v}°`, 'set-fov'),
      pref('Head bob while walking', 'headBob', 'set-bob'),
      choose('Sprint (Shift)', [['hold', 'Hold'], ['toggle', 'Toggle']] as const, () => (P.sprintToggle ? 'toggle' : 'hold'), (v) => { P.sprintToggle = v === 'toggle'; savePref(); }, 'set-sprint'),
      h('h4', { text: 'Keys' }),
      ...ACTIONS.map((a) => {
        const b = h('button.vh-btn.small.vh-bind', { type: 'button', 'data-testid': `bind-${a}`, 'aria-label': `${ACTION_LABEL[a]}: ${keyLabel(P.keys[a])}. Press to change.` },
          capturing === a ? 'Press a key…' : keyLabel(P.keys[a]));
        b.classList.toggle('wait', capturing === a);
        b.addEventListener('click', () => { capturing = capturing === a ? null : a; bindMsg = capturing ? `Press the new key for ${ACTION_LABEL[a].toLowerCase()} (Esc cancels)` : ''; render(); focusBind(a); });
        return h('div.vh-set', null, h('span', { text: ACTION_LABEL[a] }), b);
      }),
      h('div.vh-set', null, h('span.vh-muted', { text: 'Walking (WASD, arrows), Space, Shift, Esc and the panel keys stay fixed.' }),
        h('button.vh-btn.small', { type: 'button', 'data-testid': 'bind-reset', onclick: () => { P.keys = { ...DEFAULT_KEYS }; capturing = null; bindMsg = 'Keys back to E / F / M / Tab / J, Z / T'; savePref(); render(); } }, 'Reset keys')),
      h('div.vh-setmsg', { 'aria-live': 'polite', 'data-testid': 'bind-msg', text: bindMsg }),
    ],
    graphics: () => {
      const urlQ = new URLSearchParams(location.search).get('quality');
      return [
        choose('Quality preset', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const, () => P.quality, (v) => { P.quality = v; savePref(); render(); }, 'set-quality'),
        h('div.vh-set.full', null, note(urlQ ? `This page's ?quality=${urlQ} wins until you open the valley without it.` : 'The preset sizes the world as it loads (shadow maps, particles, lights): it takes effect on reload.', 'quality-note'),
          h('button.vh-btn.small', { type: 'button', 'data-testid': 'quality-reload', onclick: () => location.reload() }, 'Reload now')),
        num('Render scale', 'renderScale', 0.05, pct, 'set-scale'),
        pref('Shadows', 'shadows', 'set-shadows'),
        num('Weather effects', 'weatherFx', 0.05, pct, 'set-weather'),
        choose('Frame rate', [[0, 'Match the display'], [60, '60 fps'], [30, '30 fps (battery saver)']] as const, () => P.fpsCap as 0 | 30 | 60, (v) => { P.fpsCap = v; savePref(); }, 'set-fps'),
        choose('Idle throttle', [[0, 'Off'], [2, 'After 2 minutes'], [5, 'After 5 minutes'], [10, 'After 10 minutes'], [30, 'After 30 minutes']] as const,
          () => ([0, 2, 5, 10, 30].includes(P.idleMin) ? P.idleMin : 10) as 0 | 2 | 5 | 10 | 30, (v) => { P.idleMin = v; savePref(); }, 'set-idle'),
        note(`Without any key or mouse input the valley drops to ${IDLE_FPS} fps; touch anything to wake it. A hidden tab already pauses drawing.`),
      ];
    },
    audio: () => {
      const vol = (v: number) => `${Math.round(v * 100)}%`;
      return [
        range('Master volume', 'volumeMaster', 0, 1, 0.05, vol), range('Effects', 'volumeSfx', 0, 1, 0.05, vol),
        range('Ambience', 'volumeAmbient', 0, 1, 0.05, vol), range('Alerts & chimes', 'volumeNotify', 0, 1, 0.05, vol),
        range('Farmer voices', 'volumeVoices', 0, 1, 0.05, vol), range('Music', 'volumeMusic', 0, 1, 0.05, vol), flag('Mute everything', 'audioMuted'),
      ];
    },
    interface: () => [
      num('UI scale', 'uiScale', 0.05, pct, 'set-uiscale'),
      choose('Nameplates', [['always', 'Always'], ['near', 'Only up close'], ['off', 'Off']] as const, () => P.nameplates, (v) => { P.nameplates = v; savePref(); }, 'set-plates'),
      choose('Toasts stay for', [[0.6, 'Short'], [1, 'Normal'], [1.8, 'Long'], [3, 'Very long']] as const,
        () => ([0.6, 1, 1.8, 3].includes(P.toastK) ? P.toastK : 1) as 0.6 | 1 | 1.8 | 3, (v) => { P.toastK = v; savePref(); }, 'set-toastk'),
      choose('Clock', [['24h', '24-hour (16:30)'], ['12h', '12-hour (4:30 pm)']] as const, () => P.clock, (v) => { P.clock = v; savePref(); }, 'set-clock'),
      pref('Corner minimap (N)', 'minimap'), pref('Pop-up toasts', 'toasts'), pref('Fold the needs-you list (Alt+0)', 'compactStrip'),
      pref('Tuck an unanswered ask away to its chip after a while', 'needsDoze'),
      pref('Show hands (your paws, the lantern, what you hold)', 'hands', 'set-hands'),
      tipsRow(),
    ],
    access: () => {
      const sys = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      return [
        choose('Reduced motion', [['system', `Follow the system (${sys ? 'on' : 'off'})`], ['on', 'On'], ['off', 'Off']] as const, () => P.reducedMotion, (v) => { P.reducedMotion = v; savePref(); }, 'set-motion'),
        note('Calms the camera bob, HUD pulses and pop-ins, map rings, weather particles and lightning flashes.'),
        pref('Colour-blind-safe status (shapes + safe colours)', 'colorSafe', 'set-cb'),
        note('Needs you ▲, working ●, done ■, idle ◆ on pins, the minimap, nameplates, the ledger and every status pill.'),
        pref('High-contrast HUD', 'highContrast', 'set-hc'),
        pref('Larger text', 'largeText', 'set-big'),
        pref('Captions for sound cues', 'captions', 'set-captions'),
        note('A caption line for the alert bell (someone needs you), the done chime and other cues that carry news.'),
      ];
    },
    alerts: () => [notifyRow()],
    terminal: () => {
      const leader = h('input', { type: 'text', value: S.get('leaderKey'), 'aria-label': 'Terminal leader key', spellcheck: 'false' });
      leader.addEventListener('change', () => { if (leader.value.trim()) S.set({ leaderKey: leader.value.trim() }); });
      const paste = h('input', { type: 'number', min: '0', max: '200', value: String(S.get('pasteConfirmLines')), 'aria-label': 'Confirm pastes longer than' });
      paste.addEventListener('change', () => S.set({ pasteConfirmLines: Math.max(0, Math.round(paste.valueAsNumber || 0)) }));
      return [
        range('Text size', 'termFontPx', 8, 32, 1, (v) => `${v}px`),
        h('label.vh-set', null, h('span', { text: 'Leader key (close / open)' }), leader),
        flag('Opening a finished farmer acknowledges it', 'autoAckOnOpen'), flag('Copy on select', 'copyOnSelect'),
        h('label.vh-set', null, h('span', { text: 'Confirm pastes longer than (lines)' }), paste),
        flag('Ask before Ctrl+C while watching', 'peekCtrlCConfirm'), flag('Release control after 10 idle minutes', 'idleDemotion'),
      ];
    },
  };
  const focusBind = (a: Action) => (content.querySelector(`[data-testid="bind-${a}"]`) as HTMLElement | null)?.focus();
  /** key capture for a rebind: true when the key was taken (or refused with a message) */
  function captureKey(e: KeyboardEvent): boolean {
    const a = capturing;
    if (!a) return false;
    if (e.code === 'Escape') { capturing = null; bindMsg = 'Unchanged'; render(); focusBind(a); return true; }
    if (e.ctrlKey || e.altKey || e.metaKey) return true;
    const r = rebind(P.keys, a, e.code);
    if (r.conflict) bindMsg = r.conflict.action ? `${keyLabel(e.code)} is already ${ACTION_LABEL[r.conflict.action].toLowerCase()}: pick another key, or change that one first` : `${keyLabel(e.code)} is kept for ${r.conflict.reserved}: pick another key`;
    else { P.keys = r.keys; capturing = null; bindMsg = `${ACTION_LABEL[a]}: ${keyLabel(e.code)}`; savePref(); }
    render(); focusBind(a);
    return true;
  }

  /** one-time valley tips (model/onboarding.ts; stored with the welcome tour, browser-local) */
  function tipsRow(): Node {
    const svc = (() => { try { return ctx.b?.onboarding?.() ?? null; } catch { return null; } })();
    if (!svc) return document.createTextNode('');
    const inp = h('input', { type: 'checkbox', 'aria-label': 'Valley tips', 'data-testid': 'set-tips' });
    inp.checked = !svc.data().hints.off;
    inp.addEventListener('change', () => svc.setHintsOff(!inp.checked));
    return h('label.vh-set', null, h('span', { text: 'Valley tips (one-time hints)' }), inp);
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
    const K = (a: Action) => keyLabel(ctx.prefs.keys[a]);
    return h('div.vh-controls', { 'data-testid': 'controls' },
      head('Getting around'),
      ...row(['Click'], 'look around (capture mouse)'), ...row(['W', 'A', 'S', 'D'], 'walk'),
      ...row(['Shift'], 'sprint'), ...row(['Space'], 'hop'),
      ...row([K('use')], 'talk / use'), ...row([K('alt')], "terminal of the farmer you're facing"),
      ...row([K('wave')], 'wave (at a villager: they chirp back)'), ...row([K('lantern')], 'light / put away your lantern (it lights itself after dusk)'),
      ...row([K('map')], 'map (click a farmer → terminal)'), ...row(['N'], 'toggle minimap'),
      head('Your agents'),
      ...row([K('ledger')], 'farm ledger: everyone at a glance'), ...row([K('mail')], 'mailbox (Needs you first)'),
      ...row(['Alt+1…9'], "the Nth needs-you farmer's terminal"), ...row(['Alt+0'], 'show / fold the needs-you list'),
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
      ...row(['K'], 'collections book'), ...row(['G'], 'the Valley Gazette'), ...row(['Q'], "today's requests: keep open / tuck away"), ...row(['I'], 'your basket & the shop'),
      ...row(['F'], 'facing a villager: give a gift from your basket (1…9 picks)'),
      ...row(['P'], 'photo mode: fly, [ ] time, 1–6 looks, V frames, F say cheese, Enter snaps'),
      ...row(['L'], 'the photo album (also from photo mode)'),
      ...row(['?'], 'this list'), ...row(['F3'], 'performance overlay'),
      head('In any panel'),
      ...row(['Tab', 'Shift+Tab'], 'next / previous control (the ledger: Tab closes it while Tab is its key)'), ...row(['←', '→'], 'switch tabs'),
      ...row(['Esc'], 'close'),
      h('p.vh-muted.full', { text: 'Keys, mouse, motion, text size and more: Settings.' }));
  }

  return {
    id: 'pause', el,
    onOpen(arg) {
      // 'settings', 'controls', or 'settings:<section>' (e.g. 'settings:access')
      const [t, sec] = typeof arg === 'string' ? arg.split(':') : [];
      tab = t === 'settings' || t === 'controls' ? t : 'menu';
      if (sec && SECTIONS.some(([id]) => id === sec)) section = sec as Section;
      capturing = null; bindMsg = '';
      render();
      (content.querySelector(tab === 'settings' ? '.vh-setnav [aria-selected="true"]' : 'button') as HTMLElement | null)?.focus();
    },
    onClose() { capturing = null; },
    key(e) {
      if (captureKey(e)) return true;
      // ←/→ walk a tab row (the pause tabs, the settings sections) like any tablist
      const row = (document.activeElement as HTMLElement | null)?.closest?.('[role="tablist"]');
      if (row && el.contains(row) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const bs = [...row.querySelectorAll<HTMLElement>('[role="tab"]')];
        const i = bs.indexOf(document.activeElement as HTMLElement);
        const next = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length];
        next.click();
        (el.querySelector(`[role="tab"][data-sec="${next.dataset.sec}"]`) as HTMLElement | null ?? next).focus();
        return true;
      }
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
