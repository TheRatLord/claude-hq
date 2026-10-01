/**
 * Photo mode (P): the HUD steps away, the camera leaves your body and flies (WASD along the view, Space / C up and
 * down, Shift faster), the mouse wheel zooms, [ and ] wind the clock back and forth (hold to scrub; R returns to the
 * time you had), and Enter saves the frame as a PNG. P or Esc puts everything back. A slim bar along the bottom says
 * all that; it sits outside the canvas, so it never ends up in the picture.
 */
import type { Controller } from './player/controller.ts';
import type { Engine } from './scene/engine.ts';
import type { AudioService } from './scene/context.ts';
import type { Valley } from './model/valley.ts';

export interface PhotoMode { readonly on: boolean; toggle(on?: boolean): void }

const FOV = 62;

export function installPhotoMode(engine: Engine, controller: Controller, valley: Valley, canvas: HTMLCanvasElement): PhotoMode {
  const ctx = engine.ctx;
  let on = false, hour: number | null = null, scrub = 0, leaving = 0;
  /** the clock override photo mode found on entry (restored on exit) */
  let entryHour: number | null = null;

  const bar = document.createElement('div');
  bar.className = 'vh-photo-bar';
  bar.setAttribute('data-testid', 'photo-bar');
  const clock = document.createElement('b');
  const zoom = document.createElement('b');
  const keys = (k: string, what: string) => `<span><kbd>${k}</kbd> ${what}</span>`;
  bar.innerHTML = `<span class="t">Photo mode</span>${keys('WASD', 'fly')}${keys('Space / C', 'up / down')}${keys('Wheel', 'zoom')}${keys('[ ]', 'time')}${keys('Enter', 'save')}${keys('P', 'back')}`;
  const info = document.createElement('span');
  info.className = 'i';
  info.append(clock, ' · ', zoom);
  bar.append(info);
  const flash = document.createElement('div');
  flash.className = 'vh-photo-flash';
  const style = document.createElement('style');
  style.textContent = `
    body.photo-mode #hud { display: none !important; }
    .vh-photo-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: none; gap: 14px; align-items: center;
      padding: 7px 14px; border-radius: 10px; background: rgba(32, 22, 12, 0.72); color: #f6ead2; font: 13px/1.2 "Trebuchet MS", system-ui, sans-serif;
      white-space: nowrap; z-index: 50; pointer-events: none; backdrop-filter: blur(3px); }
    body.photo-mode .vh-photo-bar { display: flex; }
    .vh-photo-bar .t { font-weight: bold; color: #ffd27a; letter-spacing: .04em; }
    .vh-photo-bar kbd { font: bold 11px system-ui, sans-serif; background: #f6ead2; color: #3a2614; border-radius: 4px; padding: 1px 5px; }
    .vh-photo-bar .i { color: #cdb894; }
    .vh-photo-flash { position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 60; transition: opacity .35s ease-out; }
    .vh-photo-flash.go { opacity: .7; transition: none; }`;
  document.head.append(style);
  document.body.append(bar, flash);

  const refresh = () => {
    const h = valley.state.sky.hour;
    clock.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}${hour === null ? ' (now)' : ''}`;
    zoom.textContent = `${Math.round(ctx.camera.fov)}°`;
  };

  const setHour = (h: number | null) => {
    hour = h === null ? null : ((h % 24) + 24) % 24;
    valley.setSky({ hour });
    refresh();
  };

  const save = () => {
    engine.renderOnce();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `claude-valley-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
    flash.classList.add('go');
    requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('go')));
    (ctx.services.get('audio') as AudioService | undefined)?.play('page', { volume: 0.7 });
  };

  const api: PhotoMode = {
    get on() { return on; },
    toggle(want = !on) {
      if (want === on) return;
      if (want && ctx.player.frozen) return; // a panel owns the input
      on = want;
      controller.fly(on);
      document.body.classList.toggle('photo-mode', on);
      if (!on) {
        ctx.camera.fov = FOV;
        ctx.camera.updateProjectionMatrix();
        // the photo's time of day was a pose, not a setting: back to whatever clock was running before
        if (hour !== entryHour) { valley.setSky({ hour: entryHour }); hour = entryHour; }
        leaving = performance.now();
      } else {
        entryHour = valley.skyOverrides().hour ?? null;
        hour = entryHour;
        controller.lockPointer();
        refresh();
      }
    },
  };

  // window capture, registered with the HUD's: while photo mode is on, every key is ours
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!on) {
      if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.altKey && !ctx.player.frozen) {
        e.preventDefault(); e.stopImmediatePropagation(); api.toggle(true);
      }
      return;
    }
    // movement keys go on to the controller (bubble listeners); everything else stops here so the HUD stays asleep
    const move = /^(Key[WASDC]|Space|Shift(Left|Right)|ControlLeft|Arrow(Up|Down|Left|Right))$/.test(e.code);
    if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); api.toggle(false); return; }
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') { scrub = e.code === 'BracketLeft' ? -1 : 1; if (hour === null) hour = valley.state.sky.hour; }
    else if (e.code === 'KeyR') setHour(entryHour);
    else if (e.code === 'Enter' && !e.repeat) save();
    if (!move) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener('keyup', (e) => { if (e.code === 'BracketLeft' || e.code === 'BracketRight') scrub = 0; });
  // the wheel zooms (narrow lens for portraits, wide for vistas)
  addEventListener('wheel', (e) => {
    if (!on) return;
    ctx.camera.fov = Math.max(18, Math.min(95, ctx.camera.fov * Math.exp(e.deltaY * 0.0012)));
    ctx.camera.updateProjectionMatrix();
    refresh();
  }, { passive: true });
  // losing pointer lock in photo mode just leaves it (the HUD's pause menu skips this one)
  document.addEventListener('pointerlockchange', () => { if (on && !document.pointerLockElement) api.toggle(false); }, true);

  engine.onFrame((f) => {
    if (!on) return;
    if (scrub && hour !== null) setHour(hour + scrub * f.dt * 1.5); // 1.5 game hours a second
    if (Math.floor(f.time * 4) !== Math.floor((f.time - f.dt) * 4)) refresh();
  });

  /** the HUD asks: did photo mode just end (so a pointer-lock loss is not a pause)? */
  (window as unknown as { __photoLeftAt?: () => number }).__photoLeftAt = () => leaving;
  return api;
}
