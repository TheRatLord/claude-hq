/**
 * Sound settings card (§8 settings "volumes"; GP §5.4 "a mute toggle, and per-category volume"): master + four
 * category sliders, mute, and a ▶ preview per row. A small paper card in the UI layer, opened from the command
 * palette ("Sound settings") or `__hqAudio.openMixer()`. Values persist through `settings.set` (server-side).
 * Owner: AUD.
 */

interface Row { key: string; label: string; hint?: string; demo: string | null }
const ROWS: Row[] = [
  { key: 'volumeMaster', label: 'Master', demo: 'done' },
  { key: 'volumeNotify', label: 'Alerts', hint: 'blocked ding, done chime', demo: 'blocked' },
  { key: 'volumeVoices', label: 'Voices', hint: 'Clawd chatter', demo: 'voice' },
  { key: 'volumeSfx', label: 'Effects', hint: 'footsteps, typing, slide', demo: 'step' },
  { key: 'volumeAmbient', label: 'Ambience', hint: 'room tone, Engine Room hum', demo: null },
];

const CSS = `
.hq-mixer{position:absolute;right:24px;top:72px;width:330px;padding:14px 16px 12px;border-radius:16px;background:var(--paper,#F4EDE2);
  color:var(--ink,#2A2623);box-shadow:0 18px 50px rgba(0,0,0,.42),0 0 0 1px rgba(0,0,0,.06);pointer-events:auto;z-index:45;
  font:13px/1.35 var(--sans,system-ui,sans-serif);animation:hq-mix-in .18s cubic-bezier(.2,.9,.3,1.2)}
@keyframes hq-mix-in{from{transform:translateY(-6px) scale(.97);opacity:0}}
.hq-mixer h3{margin:0 0 8px;font:800 14px var(--sans,system-ui);display:flex;align-items:center;gap:8px}
.hq-mixer h3 .x{margin-left:auto;border:0;background:none;font:700 16px var(--sans);color:#8A8278;cursor:pointer;padding:2px 6px;border-radius:8px}
.hq-mixer .row{display:grid;grid-template-columns:104px 1fr 26px;align-items:center;gap:8px;padding:5px 0}
.hq-mixer .row b{font-weight:700}.hq-mixer .row small{display:block;color:#8A8278;font-size:10.5px;font-weight:500}
.hq-mixer input[type=range]{width:100%;accent-color:var(--clay,#D97757)}
.hq-mixer .pv{border:0;border-radius:50%;width:24px;height:24px;background:#E8DECF;color:var(--ink,#2A2623);cursor:pointer;font-size:10px}
.hq-mixer .pv:disabled{opacity:.3;cursor:default}
.hq-mixer .mute{display:flex;align-items:center;gap:8px;margin-top:6px;padding-top:8px;border-top:1px solid #E4D9C8;cursor:pointer;font-weight:600}
.hq-mixer .note{margin-top:6px;color:#8A8278;font-size:11px}
.hq-mixer :focus-visible{outline:2px solid var(--clay,#D97757);outline-offset:3px;border-radius:6px}
`;

/**
 * Esc closes the card from anywhere while it is open. The UI's single key dispatcher (ui/keys.ts) is a window
 * capture listener that consumes Esc in every scope; this module-level capture listener is registered at import time,
 * i.e. before createUI runs, so it sees Esc first, and only acts (and stops the event) while the card is open.
 */
let escHook: ((e: KeyboardEvent) => void) | null = null;
if (typeof addEventListener === 'function') addEventListener('keydown', (e) => escHook?.(e), true);

/** The slice of the CORE settings object the card uses. */
export interface MixerSettings {
  get(k: string): unknown;
  set(patch: Record<string, unknown>): unknown;
}
export interface MixerOptions {
  root: HTMLElement;
  settings: MixerSettings;
  preview: (demo: string) => void;
  isUnlocked: () => boolean;
  levels: () => Record<string, number>;
}

export function createMixer(o: MixerOptions) {
  let el: HTMLElement | null = null;
  let styled = false;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && el) { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  const close = () => { el?.remove(); el = null; if (escHook === onKey) escHook = null; };
  function open() {
    if (el) { el.querySelector('input')?.focus(); return; }
    if (!styled) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); styled = true; }
    const lv = o.levels();
    el = document.createElement('div');
    el.className = 'hq-mixer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Sound settings');
    const h = document.createElement('h3');
    h.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5q2 2.5 0 5M12.8 3.8q3.4 4.2 0 8.4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>Sound';
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Close (Esc)'; x.onclick = close;
    h.appendChild(x);
    el.appendChild(h);
    for (const r of ROWS) {
      const row = document.createElement('label'); row.className = 'row';
      const name = document.createElement('span'); name.innerHTML = `<b>${r.label}</b>${r.hint ? `<small>${r.hint}</small>` : ''}`;
      const s = document.createElement('input'); s.type = 'range'; s.min = '0'; s.max = '1'; s.step = '0.05';
      s.value = String(lv[r.key] ?? 0.8); s.setAttribute('aria-label', `${r.label} volume`);
      s.oninput = () => o.settings.set({ [r.key]: +s.value });
      const pv = document.createElement('button'); pv.className = 'pv'; pv.type = 'button'; pv.textContent = '▶';
      pv.title = `Preview ${r.label.toLowerCase()}`;
      if (!r.demo) pv.disabled = true; else { const demo = r.demo; pv.onclick = (e) => { e.preventDefault(); o.preview(demo); }; }
      row.append(name, s, pv);
      el.appendChild(row);
    }
    const m = document.createElement('label'); m.className = 'mute';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = o.settings.get('audioMuted') === true;
    cb.onchange = () => o.settings.set({ audioMuted: cb.checked });
    m.append(cb, document.createTextNode('Mute all sound'));
    el.appendChild(m);
    if (!o.isUnlocked()) {
      const n = document.createElement('div'); n.className = 'note'; n.textContent = 'Sound starts after your first click or key press.';
      el.appendChild(n);
    }
    escHook = onKey;
    o.root.appendChild(el);
    el.querySelector('input')?.focus();
  }
  return { open, close, toggle() { if (el) close(); else open(); }, get isOpen() { return !!el; } };
}
