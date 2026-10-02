/**
 * Settings → Alerts, desktop app only (the Electron shell's bridge, shared/desktop.ts; nothing in a browser): the
 * summon hotkey, minimize / close to tray, start at login, pause drawing while hidden. These live in the shell
 * (userData/desktop.json: they describe this machine), so every change round-trips through `bridge.setPrefs`.
 */
import { acceleratorFromKey, acceleratorLabel, DEFAULT_HOTKEY, desktopBridge } from '../../../../shared/desktop.ts';
import type { DesktopPrefs, DesktopPrefsReply } from '../../../../shared/desktop.ts';
import { h } from './ctx.ts';

export function desktopRows(): Node {
  const found = desktopBridge();
  if (!found) return document.createTextNode('');
  const bridge = found;
  const wrap = h('div', { style: { display: 'contents' }, 'data-testid': 'set-desktop' });
  let reply: DesktopPrefsReply | null = null;
  let capturing = false;
  let msg = '';

  const set = (patch: Partial<DesktopPrefs>) => {
    void bridge.setPrefs(patch).then((r) => {
      reply = r;
      if ('hotkey' in patch) msg = !r.prefs.hotkey ? 'No summon hotkey' : r.hotkeyOk ? `Summon with ${acceleratorLabel(r.prefs.hotkey, bridge.platform)}` : `${acceleratorLabel(r.prefs.hotkey, bridge.platform)} is taken by another app: pick another`;
      render();
    }).catch(() => { /* shell gone */ });
  };

  const onKey = (e: KeyboardEvent) => {
    if (!capturing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code === 'Escape') { stop(); msg = 'Unchanged'; render(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { stop(); set({ hotkey: '' }); return; }
    const acc = acceleratorFromKey(e, bridge.platform);
    if (!acc) { if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) { msg = 'Hold Ctrl, Alt or Super with the key (or press a function key)'; render(); } return; }
    stop();
    set({ hotkey: acc });
  };
  const stop = () => { capturing = false; removeEventListener('keydown', onKey, true); };

  function check(label: string, k: 'minimizeToTray' | 'closeToTray' | 'startAtLogin' | 'pauseHidden', testid: string, disabled = false): HTMLElement {
    const inp = h('input', { type: 'checkbox', 'aria-label': label, 'data-testid': testid });
    inp.checked = !!reply?.prefs[k];
    inp.disabled = disabled || !reply;
    inp.addEventListener('change', () => set({ [k]: inp.checked }));
    return h('label.vh-set', null, h('span', { text: label }), inp);
  }
  const note = (text: string) => h('small.vh-setnote', { text });

  function render(): void {
    const p = reply?.prefs;
    const keyBtn = h('button.vh-btn.small', { type: 'button', 'data-testid': 'set-hotkey', 'aria-label': 'Summon hotkey' },
      capturing ? 'Press keys…' : p ? acceleratorLabel(p.hotkey, bridge.platform) : '…');
    keyBtn.addEventListener('click', () => {
      if (capturing) return;
      capturing = true; msg = 'Press the new combination (Esc: keep, Backspace: none)';
      addEventListener('keydown', onKey, true);
      render();
      (wrap.querySelector('[data-testid="set-hotkey"]') as HTMLElement | null)?.focus();
    });
    const reset = h('button.vh-btn.small', { type: 'button', text: 'Default' });
    reset.addEventListener('click', () => { stop(); set({ hotkey: DEFAULT_HOTKEY }); });
    const tray = reply?.traySupported ?? true;
    wrap.replaceChildren(
      h('h4.grp', { text: 'Desktop app' }),
      h('div.vh-set', null, h('span', { text: 'Summon / hide hotkey (anywhere)' }), h('span', { style: { display: 'flex', gap: '6px' } }, keyBtn, reset)),
      note(msg || (reply && !reply.hotkeyOk ? 'That hotkey is taken by another app: pick another.' : 'Brings the valley up from anywhere; with asks waiting it opens the mailbox on Needs you.')),
      check('Minimize to the tray', 'minimizeToTray', 'set-min-tray', !tray),
      check('Close to the tray (quit from the tray menu)', 'closeToTray', 'set-close-tray', !tray),
      tray ? document.createTextNode('') : note('No tray on this desktop: the window minimizes instead.'),
      check('Start at login (in the tray)', 'startAtLogin', 'set-login', reply ? !reply.loginSupported : false),
      check('Stop drawing while hidden or minimized', 'pauseHidden', 'set-pause-hidden'),
      note('Otherwise the valley draws two frames a second in the background. Agents, alerts and badges stay live either way.'),
    );
  }
  render();
  void bridge.prefs().then((r) => { reply = r; render(); }).catch(() => { /* shell gone */ });
  return wrap;
}
