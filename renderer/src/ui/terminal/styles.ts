/** Self-contained defaults for the terminal widget, with no application skin or bundled fonts. */
export const TERM_FONT = 'ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

export const TERMINAL_CSS = `
.hq-thost{position:relative;width:100%;height:100%;box-sizing:border-box;display:none;padding:10px 8px 8px 12px;overflow:hidden;background:#181818;color:#e5e5e5;font-family:system-ui,sans-serif}
.hq-thost.active{display:block}
.hq-thost.pan{overflow:auto}
.hq-thost .frame{position:relative;margin:0}
.hq-thost.edge .frame{box-shadow:1px 0 0 #555}
.hq-thost.edge .frame::after{content:attr(data-dim);position:absolute;left:100%;top:0;margin-left:10px;white-space:nowrap;pointer-events:none;font:11px/1 system-ui,sans-serif;color:#aaa;font-variant-numeric:tabular-nums}
.hq-thost.dim .frame{opacity:.45}
.hq-thost .xterm{height:100%}
.hq-thost .xterm .xterm-viewport{background:transparent !important;scrollbar-width:none}
.hq-hist{position:absolute;inset:0;z-index:1;background:#181818;display:none;padding:10px 8px 8px 12px;box-sizing:border-box}
.hq-hist.show{display:block;box-shadow:inset 0 0 0 2px #888}
.hq-notices{display:flex;min-width:0;color:#e5e5e5;background:#181818;font:12px/1.4 system-ui,sans-serif}
.hq-notices:empty{display:none}
.hq-notices>.hq-notice~.hq-notice{display:none}
.hq-notice{display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-width:0;padding:6px 8px}
.hq-notice .tx{min-width:0;overflow-wrap:anywhere}
.hq-notice .sub{color:#aaa}
.hq-notice .term-keys{display:inline-flex;gap:3px;flex:none}
.hq-notice kbd{font:inherit;border:1px solid #666;border-radius:3px;padding:1px 4px}
.hq-notice button{font:inherit;color:inherit;background:#333;border:1px solid #666;border-radius:3px;padding:3px 7px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.hq-notice button.primary{border-color:#aaa}
.hq-notice button:hover{background:#444}
.hq-notice button:focus-visible{outline:2px solid #ddd;outline-offset:2px}
`;

export function injectTerminalStyles() {
  if (typeof document === 'undefined' || document.getElementById('hq-terminal-css')) return;
  const sheet = document.createElement('style');
  sheet.id = 'hq-terminal-css';
  sheet.textContent = TERMINAL_CSS;
  document.head.append(sheet);
}
