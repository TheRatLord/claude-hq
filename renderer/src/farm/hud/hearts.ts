/**
 * A heart event's dialogue (`hearts`; model/hearts.ts, docs/valley/villagers.md): a storybook box low on the screen
 * while a villager shares a moment. It does not dim the valley (the scene is staged in the world: scene/villagers),
 * only takes the input: their portrait and name, the line (typed out; at once with reduced motion), stage directions
 * in italics, then a choice of two or three replies, then their answer and the keepsake.
 *
 * Keys: E / Space / Enter (or a click) continue (finishing a line first), 1–3 or ↑ / ↓ + Enter choose, Esc steps
 * away (the moment waits and plays next time). `watchHearts` (bound in hud.ts) opens the box when a scene begins and
 * toasts the keepsake when it ends.
 */
import './hearts.css';
import { friendDef } from '../model/friends.ts';
import { keepsakeText } from '../model/hearts.ts';
import type { Beat, HeartScene, HeartsChange, HeartsService } from '../model/hearts.ts';
import { portrait, HEART_ICON } from './friends.ts';
import { h, type HudCtx, type Panel } from './ctx.ts';

const svc = (ctx: HudCtx): HeartsService | null => { try { return (ctx.b?.service?.('hearts') as HeartsService | undefined) ?? null; } catch { return null; } };
/** characters a second while a line types out */
const CPS = 52;

export function createHeartsPanel(ctx: HudCtx): Panel {
  const pic = h('span.vh-ht-pic', { 'aria-hidden': 'true' });
  const name = h('b.vh-ht-name', { 'data-testid': 'heart-name' });
  const title = h('span.vh-ht-title', { 'data-testid': 'heart-title' });
  const text = h('p.vh-ht-text', { 'data-testid': 'heart-line', 'aria-live': 'polite' });
  const choices = h('div.vh-ht-choices', { role: 'group', 'aria-label': 'Your reply', 'data-testid': 'heart-choices' });
  const more = h('button.vh-ht-more', { type: 'button', 'data-testid': 'heart-next', 'aria-label': 'Continue' });
  const away = h('button.vh-ht-away', { type: 'button', title: 'Step away (Esc): they\'ll wait for you', 'data-testid': 'heart-away', text: 'Later' });
  const head = h('div.vh-ht-head', null, name, title, away);
  const box = h('div.vh-ht-box', null, pic, h('div.vh-ht-main', null, head, text, choices, more));
  const el = h('section.vh-hearts-box', { 'aria-label': 'A moment', 'data-testid': 'panel-hearts', 'aria-modal': 'false' }, box);
  let scene: HeartScene | null = null, step = -1, shown = 0, full = '', typing = false, raf = 0, last = 0, sel = 0;

  const reduced = () => ctx.reduced();
  const setText = (b: Beat | null) => {
    full = b?.text ?? '';
    text.classList.toggle('aside', b?.who === 'aside');
    shown = reduced() ? full.length : 0;
    typing = shown < full.length;
    text.textContent = full.slice(0, shown);
    text.dataset.full = full;
    more.hidden = false;
    if (typing) { last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }
  };
  const tick = (t: number) => {
    if (!typing) return;
    shown = Math.min(full.length, shown + ((t - last) / 1000) * CPS);
    last = t;
    text.textContent = full.slice(0, Math.floor(shown));
    if (shown >= full.length) { typing = false; text.textContent = full; return; }
    raf = requestAnimationFrame(tick);
  };
  const finishTyping = () => { typing = false; cancelAnimationFrame(raf); text.textContent = full; shown = full.length; };

  const render = () => {
    const s = svc(ctx)?.current() ?? null;
    if (!s) return;
    const fresh = s !== scene;
    scene = s;
    if (!fresh && s.step === step) return;
    step = s.step;
    const def = friendDef(s.event.who);
    if (fresh) {
      pic.innerHTML = def ? portrait(def) : HEART_ICON;
      name.textContent = def?.name ?? '';
      title.textContent = `♥ ${s.event.title}`;
      el.style.setProperty('--who', def?.color ?? '#e0574a');
      el.style.setProperty('--who-dark', def?.dark ?? '#a03a30');
    }
    if (s.phase === 'choose') {
      setText({ who: 'aside', text: s.event.choice.prompt });
      finishTyping();
      more.hidden = true;
      sel = 0;
      choices.replaceChildren(...s.event.choice.options.map((o, i) => {
        const b = h('button.vh-ht-choice', { type: 'button', 'data-testid': `heart-choice-${i}` }, h('span.k', { text: String(i + 1) }), h('span', { text: o.label }));
        b.addEventListener('click', () => svc(ctx)?.choose(i));
        return b;
      }));
      choices.hidden = false;
      (choices.children[0] as HTMLElement | undefined)?.focus({ preventScroll: true });
    } else {
      choices.hidden = true;
      choices.replaceChildren();
      setText(s.lines[s.i] ?? null);
      more.textContent = s.choice !== null && s.i === s.lines.length - 1 ? '♥ Keep it' : 'Continue ▸';
      more.focus({ preventScroll: true });
    }
  };
  const next = () => {
    if (typing) { finishTyping(); return; }
    const s = svc(ctx);
    if (s?.current()?.phase === 'talk') s.advance();
  };
  more.addEventListener('click', next);
  text.addEventListener('click', next);
  away.addEventListener('click', () => ctx.panels.close());

  return {
    id: 'hearts', el, light: true,
    onOpen() { scene = null; step = -1; render(); },
    onClose() {
      cancelAnimationFrame(raf);
      // closed while the scene still plays (Esc, "Later"): it waits for next time
      const s = svc(ctx);
      if (s?.current()) s.leave();
      scene = null;
    },
    frame() {
      const s = svc(ctx);
      if (!s?.current()) { ctx.panels.close(); return; }
      render();
    },
    key(e) {
      const s = svc(ctx)?.current();
      if (!s) return false;
      if (s.phase === 'choose') {
        const n = s.event.choice.options.length;
        const d = /^Digit([1-9])$/.exec(e.code);
        if (d && Number(d[1]) <= n) { svc(ctx)?.choose(Number(d[1]) - 1); return true; }
        if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
          sel = (sel + (e.code === 'ArrowDown' ? 1 : n - 1)) % n;
          (choices.children[sel] as HTMLElement | undefined)?.focus({ preventScroll: true });
          return true;
        }
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') {
          const i = [...choices.children].indexOf(document.activeElement as Element);
          svc(ctx)?.choose(i >= 0 ? i : sel);
          return true;
        }
        return false;
      }
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE' || e.code === ctx.prefs.keys?.use) { if (!e.repeat) next(); return true; }
      return false;
    },
  };
}

/** a scene beginning opens the box; its end toasts the keepsake (and where it went) */
export function watchHearts(ctx: HudCtx, m: HeartsService): void {
  m.onChange((c: HeartsChange) => {
    if (c.kind === 'begin') { ctx.panels.open('hearts'); ctx.sfx('page'); }
    else if (c.kind === 'done') {
      const def = friendDef(c.event.who);
      const k = c.keepsake;
      const where = k.kind === 'photo' ? 'in your photo album (L)' : k.kind === 'letter' ? 'in your mailbox (J)' : 'in your yard, behind the farmhouse';
      ctx.toast({
        text: `A moment with ${def?.short ?? 'a friend'}: ${c.event.title}`, sub: `A keepsake: ${keepsakeText(k)}, ${where}. Kept in Fern's notebook (O).`,
        icon: def ? portrait(def) : HEART_ICON, level: 'good', ms: 9000, key: `heart|${c.event.id}`,
        open: () => ctx.panels.open(k.kind === 'letter' ? 'mailbox' : k.kind === 'photo' ? 'album' : 'guide', k.kind === 'decor' ? 'moments' : undefined),
        openTitle: k.kind === 'letter' ? 'Open the mailbox' : k.kind === 'photo' ? 'Open the album' : 'Open the notebook',
      });
      ctx.sfx('sparkle');
    } else if (c.kind === 'later') {
      const def = friendDef(c.event.who);
      ctx.toast({ text: `${def?.short ?? 'They'} will wait for you`, sub: `Find them again ${c.event.when} (after a little while).`, icon: HEART_ICON, level: 'info', ms: 6000, key: `heartlater|${c.event.id}` });
    }
  });
}
