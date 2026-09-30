// @pure
/** Browser-local terminal shortcuts; all other keys remain available to the child process. */
export type TerminalKeyAction = 'copy' | 'pasteNative' | 'fontUp' | 'fontDown' | 'fontReset';
type KeyEventLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function terminalKey(e: KeyEventLike, mac: boolean): TerminalKeyAction | null {
  if (e.altKey) return null;
  if (mac) {
    if (!e.metaKey || e.ctrlKey) return null;
    // Punctuation is matched by its produced character, independent of keyboard-layout Shift.
    if (e.key === '=') return 'fontUp';
    if (e.key === '-') return 'fontDown';
    if (e.shiftKey) return null;
    if (e.code === 'KeyC') return 'copy';
    if (e.code === 'KeyV') return 'pasteNative';
    if (e.code === 'Digit0') return 'fontReset';
    return null;
  }
  if (e.metaKey) return null;
  if (e.ctrlKey && !e.shiftKey && e.code === 'Insert') return 'copy';
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') return 'copy';
  if (e.shiftKey && ((!e.ctrlKey && e.code === 'Insert') || (e.ctrlKey && e.code === 'KeyV'))) return 'pasteNative';
  return null;
}
