// @pure
/**
 * Drawer lifecycle (§8.4): `term.state` → what the tab shows and where input goes.
 * Owner: UI.
 */

export interface LifeView {
  badge: 'peek' | 'control' | 'readonly' | 'none';
  /** banner text */
  banner: string | null;
  /** banner buttons */
  actions: { label: string; action: string }[];
  /** where keystrokes go */
  input: 'promote' | 'send' | 'outbox' | 'disabled';
  spinner: boolean;
  dim: boolean;
  /** state chip key (for tab dots) */
  chip: string;
}

/** `gone` reasons (protocol §3.3) in words. */
const GONE_WHY: Partial<Record<string, string>> = { closed: 'was closed in herdr', exited: 'exited (its process ended)', rekeyed: 'moved (new pane id)' };

/**
 * `ts` = the latest term.state (null = not yet).
 */
export function lifeView(ts: { state: string; mode?: string; writer?: boolean; detail?: string } | null, ctx: { herdrConnected?: boolean; name?: string } = {}): LifeView {
  const state = ts?.state ?? 'connecting';
  const name = ctx.name || 'this pane';
  const base: LifeView = { badge: 'none', banner: null, actions: [], input: 'outbox', spinner: false, dim: false, chip: state };
  switch (state) {
    case 'connecting':
      return { ...base, spinner: true };
    case 'live':
    case 'released':
      if (ts?.mode === 'control') {
        if (ts.writer) return { ...base, badge: 'control', input: 'send', chip: 'control' };
        return { ...base, badge: 'peek', input: 'outbox', banner: 'Another HQ window is typing.', actions: [{ label: 'Take the keyboard', action: 'writer' }], chip: 'peek' };
      }
      return { ...base, badge: 'peek', input: 'promote', chip: 'peek' };
    case 'busy':
      return { ...base, badge: 'peek', banner: 'Another terminal client (herdr attach) holds this pane.', actions: [{ label: 'Take over', action: 'takeover' }, { label: 'Peek', action: 'peek' }] };
    case 'taken':
      return { ...base, badge: 'peek', banner: 'Another client took control.', actions: [{ label: 'Reclaim', action: 'takeover' }, { label: 'Stay in Peek', action: 'peek' }] };
    case 'gone':
      // [UI fix r1, playtest "Pane closed (closed)."] say what happened, in words
      return { ...base, dim: true, banner: `${ctx.name || 'This pane'} ${GONE_WHY[ts?.detail ?? ''] ?? `closed${ts?.detail ? ` (${ts.detail})` : ''}`}.`, actions: [{ label: 'Close tab', action: 'closeTab' }], input: 'disabled' };
    case 'offline':
      return { ...base, dim: true, banner: 'herdr is offline. Waiting to reconnect…' };
    case 'reconnecting':
      return { ...base, dim: true, spinner: true };
    case 'error':
      return { ...base, dim: true, banner: `Terminal error${ts?.detail ? `: ${ts.detail}` : ''}.`, actions: [{ label: 'Retry', action: 'retry' }] };
    case 'readonly':
      return { ...base, badge: 'readonly', banner: `herdr protocol mismatch: ${name} is read-only.`, input: 'disabled' };
    default:
      return { ...base, banner: `Unknown terminal state ${state}` };
  }
}

/**
 * Peek-mode key classification (§8.4): which keys promote, which are swallowed.
 */
export function peekKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'code'>): 'promote' | 'esc' | 'ctrlc' | 'swallow' {
  if (e.key === 'Escape') return 'esc';
  if (e.ctrlKey && !e.altKey && !e.metaKey && (e.code === 'KeyC' || e.key === 'c' || e.key === 'C')) return 'ctrlc';
  if (e.ctrlKey || e.altKey || e.metaKey) return 'swallow';
  if (e.key === 'Enter') return 'promote';
  if (e.key.length === 1) return 'promote'; // printable (incl. space)
  return 'swallow'; // arrows, Tab, Backspace, F-keys, Home/End, …
}
