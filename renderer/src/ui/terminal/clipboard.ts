/**
 * Clipboard paths (§8.6). Copy: `navigator.clipboard.writeText` in a user-activation handler, falling back to a hidden
 * textarea + execCommand. Keyboard paste always uses the native `paste` event (no permission prompts); only the
 * context menu / Leader Y use `readText()`. Middle-click uses HQ's internal last-selection buffer (PRIMARY emulation).
 * Owner: UI.
 */

let primary = '';

/** Remember the last selection (PRIMARY emulation for middle-click). */
export function setPrimary(text: string) { if (text) primary = text; }
export function getPrimary() { return primary; }

/** TUI rows are padded to the grid width: drop trailing blanks per line (reviewer: ~36 spaces per copied line). */
export const trimRows = (text: string) => String(text).replace(/[ \t\u00a0]+$/gm, '');

/** `raw` keeps the padding. */
export async function copyText(text: string, o: { raw?: boolean } = {}): Promise<boolean> {
  if (!text) return false;
  if (!o.raw) text = trimRows(text);
  setPrimary(text);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      const prev = document.activeElement;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (prev instanceof HTMLElement) prev.focus();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Clipboard API read (context menu / Leader Y). Resolves null when refused. */
export async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
