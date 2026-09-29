/**
 * The one keyboard dispatcher (§8.2): a window capture-phase keydown/keyup handler that
 *  1. runs the Leader state machine (no timeout trap: chords while held or ≤ 400 ms after keydown; a tap acts on keyup),
 *  2. resolves the current focus scope and dispatches from the keymap.ts table (xterm scope is left to the xterm
 *     custom key handler in terminal/view.ts, which sees everything except the Leader).
 * Owner: UI.
 */
import { isLeader, resolveChord, resolveKey, tableFor, actionNames } from './keymap.ts';
import type { Platform, SettingsReader } from './platform.ts';

export const CHORD_WINDOW_MS = 400;

/** A key action handler: returning `false` leaves the event unhandled. */
export type KeyHandler = (arg: number | null, scope: string) => unknown;

export interface KeysDeps {
  platform: Pick<Platform, 'mac'>;
  settings: Pick<SettingsReader, 'get'>;
  scope(): string;
  blocked(): boolean;
  handlers: Record<string, Record<string, KeyHandler>>;
  leader: Record<string, KeyHandler>;
  leaderTap(scope: string): void;
  literal(data: string): void;
  hud: { leader(on: boolean, sub?: string): void };
  onKey?(e: KeyboardEvent, scope: string): void;
  /** roster type-ahead: true when the key was consumed as search text (`r` = the key's roster binding, if any) */
  typeAhead?(e: KeyboardEvent, r: ReturnType<typeof resolveKey>): boolean | void;
}

interface Pending { at: number; held: boolean; used: boolean; scope: string; literal: boolean; timer: ReturnType<typeof setTimeout> | null; tapped?: boolean }

export function createKeys(d: KeysDeps) {
  // Dev guard: every table action has a handler (keymap.test.ts checks the overlay side).
  const names = actionNames();
  for (const [t, list] of Object.entries(names)) {
    const hs = t === 'leader' ? d.leader : d.handlers[t];
    for (const a of list) if (!hs || typeof hs[a] !== 'function') console.warn(`[keys] no handler for ${t}.${a}`);
  }

  let pending: Pending | null = null;
  let leaderCode: string | null = null;

  const end = () => {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
    d.hud.leader(false);
  };
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); };

  function onDown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (d.blocked()) return; // a modal (confirm / key overlay) owns the keyboard
    const leaderSetting = d.settings.get('leaderKey');
    const now = performance.now();

    if (isLeader(e, leaderSetting)) {
      stop(e);
      if (e.repeat) return;
      if (pending && (pending.held || now - pending.at <= CHORD_WINDOW_MS) && !pending.used) {
        // Leader again → literal Ctrl+`
        pending.used = true;
        d.leader.literalLeader?.(null, pending.scope);
        end();
        return;
      }
      if (pending) end();
      leaderCode = e.code;
      pending = { at: now, held: true, used: false, scope: d.scope(), literal: false, timer: null };
      d.hud.leader(true, 'chord key…');
      return;
    }

    if (pending) {
      if (pending.literal) {
        if (/^Key[A-Z]$/.test(e.code)) {
          stop(e);
          const letter = e.code.slice(3);
          d.literal(String.fromCharCode(letter.charCodeAt(0) - 64)); // Ctrl+letter
        }
        end();
        if (/^Key[A-Z]$/.test(e.code)) return;
      } else if (pending.held || now - pending.at <= CHORD_WINDOW_MS) {
        if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return; // modifiers don't end pending
        const c = e.altKey || e.metaKey ? null : resolveChord(e); // Alt/Cmd chords belong to the scope (quick-answer…)
        if (c) {
          stop(e);
          pending.used = true;
          const scope = pending.scope;
          if (c.action === 'literalCtrl') {
            pending.literal = true;
            if (pending.timer) clearTimeout(pending.timer);
            pending.timer = setTimeout(end, 3000);
            d.hud.leader(true, '; then a letter → Ctrl+letter');
            return;
          }
          end();
          d.leader[c.action]?.(c.arg, scope);
          return;
        }
        end(); // not a chord: handled by the now-current scope
      } else end();
    }

    const scope = d.scope();
    d.onKey?.(e, scope);
    if (scope === 'xterm') return;
    // [UI fix r1] roster type-ahead: a printable key in a list nobody has navigated yet is search text, not a verb
    // [UI fix r2] it gets the key's roster binding (armed rows keep their verbs; unbound letters stay typing)
    const r = resolveKey(scope, e, d.platform.mac);
    if (scope === 'roster' && d.typeAhead?.(e, r)) { stop(e); return; }
    if (!r) return;
    const hs = d.handlers[tableFor(scope)];
    const fn = hs?.[r.action];
    if (!fn) return;
    const res = fn(r.arg, scope);
    if (res !== false) stop(e);
  }

  function onUp(e: KeyboardEvent) {
    if (!pending || e.code !== leaderCode) return;
    stop(e); // xterm refocuses itself on keyup: the Leader's keyup must never reach it
    pending.held = false;
    if (!pending.used && !pending.literal) {
      pending.used = true;
      const scope = pending.scope;
      // tap: acts immediately; the chord window stays open until 400 ms after keydown
      d.leaderTap(scope);
      const left = Math.max(0, CHORD_WINDOW_MS - (performance.now() - pending.at));
      pending.used = false;
      pending.tapped = true;
      pending.timer = setTimeout(end, left);
      d.hud.leader(false);
    }
  }

  addEventListener('keydown', onDown, true);
  addEventListener('keyup', onUp, true);
  addEventListener('blur', () => { if (pending && !pending.literal) end(); });
  return {
    get pending() { return !!pending; },
    dispose() { removeEventListener('keydown', onDown, true); removeEventListener('keyup', onUp, true); },
  };
}
