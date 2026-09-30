/**
 * Copy with the Clipboard API, falling back to a hidden textarea + execCommand.
 * Keyboard paste uses the native paste event; explicit clipboard reads may be refused.
 * Middle-click uses an internal last-selection buffer (PRIMARY emulation).
 */

let primary = '';

/** Remember the last selection (PRIMARY emulation for middle-click). */
export function setPrimary(text: string) { if (text) primary = text; }
export function getPrimary() { return primary; }

/** Drop grid-padding blanks from each copied terminal row. */
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

/** Clipboard API read. Resolves null when refused. */
export async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
