/**
 * Hotbar (M3.5; the §8 HUD's "M4 control-group hotbar", pulled in; UI kit §5.1): 9 pigeonholes in a walnut rail — a
 * porthole (CHR's live portraitBatch when present, else the drawn SVG) whose inner rim is the workspace colour, a
 * number keycap, a status lamp (the blocked lamp is the one that pulses) and the butter unread bulb. Slot n is exactly
 * the existing `1–9` key (world / roster) and Leader `1–9` (xterm): click = the same open. Empty holes show their digit
 * dimmed ("Shift+n pins the aimed agent"); a pin whose agent vanished shows greyed ("missing"). Each pinned hole carries
 * a paper name label (five clay portraits look alike). Lanes (hud.layout publishes --world-l/-r, --hb-lane-l,
 * --mini-top): centred on the visible world strip when that clears the minimap, else centred in the lane right of the
 * minimap, else compact (no labels; the name shows on hover), else on top of the minimap frame (lifting the ticket
 * stack, --hb-lift), else tight (46 px holes; the first pins keep their holes, later ones fold into one "+n" hole), else
 * it steps aside (digits still work). Never under or over the drawer / roster. Hidden while nothing is pinned or the drawer is fullscreen. ≤ 10 Hz,
 * diffed per slot. [UI fix r3] It also yields (sinks out of view, keys still work) while a bottom slip or a centred
 * sheet — any shown `[role=dialog]`: prompt bar, rename slip, inbox, hire, palette, triage… — reaches its band, so no
 * half-covered portraits or name labels stick out from under the paper.
 * Owner: UI.
 */
import { h, setText, cls, portraitSvg, workspaceHex } from './dom.ts';
import { attachPortrait } from '../chars/render/portraits.ts'; // CHR portraitBatch (null when absent → SVG only)
import { stateKey } from './roster/model.ts';
import { keycap, lamp, unread, lampState, type Lamp, type Unread } from './kit/index.ts';
import type { LampState } from './kit/lamps.ts';
import { ensureHudCss } from './hudCss.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Store } from '../net/store.ts';
import type { Pins } from './rekey.ts';

interface Slot { el: HTMLElement; pt: HTMLElement; inner: HTMLElement; st: Lamp; ur: Unread; nm: HTMLElement; key: string; pkey: string; lampSt: LampState | null }

export interface HotbarDeps {
  root: HTMLElement;
  store: Pick<Store, 'entities'>;
  label(e: Entity): string;
  pins(): Pick<Pins, 'slots'> | null | undefined;
  unreadOf(id: string): number;
  hooks: { open(n: number): void; select?(id: string): void };
}

export function createHotbar(d: HotbarDeps) {
  ensureHudCss();
  const slots: Slot[] = [];
  const bar = h('nav.hq-hotbar.k-hotbar', { 'aria-label': 'Pinned agents (1–9)' });
  for (let n = 1; n <= 9; n++) {
    const inner = h('div');
    const pt = h('div.k-port', null, inner);
    const st = lamp('idle', { label: '' });
    const ur = unread(0);
    const nm = h('span.nm');
    const el = h('button.slot.k-cubby', { type: 'button', tabindex: '-1', 'data-n': String(n), onclick: () => d.hooks.open(n) }, keycap(String(n)), pt, st, ur, nm);
    el.addEventListener('mousedown', (ev) => ev.preventDefault()); // never steal focus from the world / xterm
    slots.push({ el, pt, inner, st, ur, nm, key: '', pkey: '', lampSt: null });
    bar.append(el);
  }
  // the overflow hole of the tight bar: "+n" in the sign font and the loudest lamp of the pins folded into it
  const overN = h('span.n');
  const overLamp = lamp('idle', { label: '' });
  let overTo = 0;
  const over = h('button.slot.k-cubby.over', { type: 'button', tabindex: '-1', hidden: true, onclick: () => { if (overTo) d.hooks.open(overTo); } }, overN, overLamp);
  over.addEventListener('mousedown', (ev) => ev.preventDefault());
  bar.append(over);
  d.root.append(bar);
  let visible = true;
  let placeKey = '';
  let yielded = false;
  /** does any shown dialog sheet reach the bar's band? (full-viewport veils / the map overlay don't count) */
  function covered() {
    if (!bar.offsetWidth) return false;
    // layout box (offset*), not getBoundingClientRect: the yielded bar is translated away and must not un-cover itself
    const o = bar.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const b = { left: o.left + bar.offsetLeft, top: o.top + bar.offsetTop, right: 0, bottom: 0 };
    b.right = b.left + bar.offsetWidth; b.bottom = b.top + bar.offsetHeight;
    for (const dl of d.root.querySelectorAll('[role=dialog]')) {
      if (bar.contains(dl)) continue;
      const r = dl.getBoundingClientRect();
      if (!r.width || !r.height || (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9)) continue;
      if (r.left < b.right + 8 && r.right > b.left - 8 && r.bottom > b.top - 10 && r.top < b.bottom) return true;
    }
    return false;
  }
  function setYield(y: boolean) {
    if (y === yielded) return;
    yielded = y;
    cls(bar, 'yield', y);
    // the tickets drop back to the edge while the bar is away; place() re-lifts them when it returns
    if (!y) placeKey = '';
  }
  const px = (v: string) => parseFloat(d.root.style.getPropertyValue(v)) || 0;
  /** Pick the bar's lane (see header). Measures only when the strip, the lanes or the slots change. */
  function place(slotsKey: string) {
    const L = px('--world-l'), R = px('--world-r'), laneL = px('--hb-lane-l') || L + 22, miniTop = px('--mini-top');
    const W = innerWidth;
    const k = `${W}|${L}|${R}|${laneL}|${miniTop}|${slotsKey}`;
    if (k === placeKey) return;
    placeKey = k;
    const stripC = L + (W - L - R) / 2, laneR = W - R - 22;
    let left = 0, lifted = false, fitted = false;
    const fitsLane = (bw: number) => laneR - laneL >= bw;
    cls(bar, 'tight', false);
    cls(bar, 'gone', false);
    fold(0);
    for (const compact of [false, true]) {
      cls(bar, 'compact', compact);
      const bw = bar.offsetWidth;
      if (stripC - bw / 2 >= laneL && stripC + bw / 2 <= laneR) { left = stripC - bw / 2; fitted = true; break; }
      if (fitsLane(bw)) { left = laneL + (laneR - laneL - bw) / 2; fitted = true; break; }
      // on top of the minimap frame, left-aligned with it (only when that still clears the drawer)
      if (compact && miniTop > 0 && L + 22 + bw <= laneR) { lifted = true; left = L + 22; fitted = true; }
    }
    if (!fitted) {
      // tight (roster + drawer at 1280): small holes, the first pins stay (their digits), the rest fold into one "+n"
      // hole; if not even one pin + the fold fit, the bar steps aside (1–9 still work) — it never covers the drawer
      cls(bar, 'tight', true);
      const lane0 = miniTop > 0 ? L + 22 : laneL;
      const pinned = slots.filter((x) => !x.el.hidden && !x.el.classList.contains('empty')).length;
      for (let k = pinned; k >= 1 && !fitted; k--) {
        fold(k);
        const bw = bar.offsetWidth;
        if (laneR - laneL >= bw) { left = laneL + (laneR - laneL - bw) / 2; fitted = true; }
        else if (miniTop > 0 && laneR - lane0 >= bw) { lifted = true; left = lane0; fitted = true; }
      }
      if (!fitted) { fold(0); cls(bar, 'gone', true); }
    }
    cls(bar, 'lifted', lifted && miniTop > 0);
    bar.style.left = `${Math.round(left)}px`;
    bar.style.bottom = lifted && miniTop > 0 ? `${miniTop + 4}px` : '';
    // tickets share the left column: lift them over the bar when it sits there (on the minimap or, with no minimap,
    // on the bottom edge under them)
    const h0 = bar.offsetHeight + 14;
    const under = fitted && (lifted || (!miniTop && left < L + 22 + 376));
    d.root.style.setProperty('--hb-lift', under ? `${h0}px` : '0px');
  }
  /**
   * Tight bar: keep the first `k` pinned holes, fold every later pin (and the free hole) into the "+n" hole. k = 0
   * unfolds everything. The fold hole's lamp is the loudest of the folded pins (blocked > done > working > idle); a
   * click opens the first folded blocked pin, else the first folded pin (its digit key does the same).
   */
  function fold(k: number) {
    let kept = 0;
    const folded: number[] = [];
    for (let i = 0; i < 9; i++) {
      const x = slots[i];
      const pinned = !x.el.hidden && !x.el.classList.contains('empty');
      const f = k > 0 && !x.el.hidden && (!pinned || ++kept > k);
      cls(x.el, 'fold', f);
      if (f && pinned) folded.push(i + 1);
    }
    over.hidden = !folded.length;
    if (!folded.length) return;
    const RANK: Record<string, number> = { blocked: 4, done: 3, working: 2, idle: 1 };
    let best: LampState | null = null, bestR = -1, to = folded[0];
    for (const n of folded) {
      const st = slots[n - 1].lampSt;
      const r = (st && RANK[st]) || 0;
      if (r > bestR) { bestR = r; best = st; }
      if (st === 'blocked' && slots[to - 1].lampSt !== 'blocked') to = n;
    }
    overTo = to;
    overN.textContent = `+${folded.length}`;
    overLamp.style.display = best ? '' : 'none';
    if (best) overLamp.set(best, '');
    cls(over, 'blocked', best === 'blocked');
    over.title = `Pins ${folded.join(', ')} (keys ${folded.join(' ')} still open them) — click opens ${to}`;
    over.setAttribute('aria-label', over.title);
  }

  return {
    el: bar,
    update(o: { hidden?: boolean } = {}) {
      const pins = d.pins();
      const S = pins?.slots ?? [];
      const any = S.some(Boolean);
      const show = any && !o.hidden;
      if (show !== visible) { visible = show; cls(bar, 'show', show); placeKey = ''; if (!show) { d.root.style.setProperty('--hb-lift', '0px'); setYield(false); } }
      if (!show) return;
      // trim trailing empty holes (a bar of 2 pins is 2 holes + the next free digit)
      let last = 0;
      for (let i = 0; i < 9; i++) if (S[i]) last = i + 1;
      for (let i = 0; i < 9; i++) {
        const s = slots[i];
        const p = S[i];
        s.el.hidden = i > last; // one free hole after the last pin
        if (i > last) continue;
        const e = p?.id ? d.store.entities.get(p.id) : null;
        const u = e ? d.unreadOf(e.id) : 0;
        const st = e ? stateKey(e) : p ? 'missing' : 'empty';
        const k = `${p?.id ?? ''}|${st}|${e?.process?.activity ?? ''}|${e?.ack ? 1 : 0}|${e ? d.label(e) : p?.name ?? ''}|${u}|${e?.workspace?.colorIndex ?? ''}`;
        if (k === s.key) continue;
        s.key = k;
        cls(s.el, 'empty', !p);
        cls(s.el, 'missing', !!p && !e);
        cls(s.el, 'blocked', e?.status === 'blocked');
        cls(s.el, 'done', e?.status === 'done' && !e.ack);
        s.pt.hidden = !p;
        s.pt.style.setProperty('--ws', e ? workspaceHex(e.workspace?.colorIndex) : '');
        cls(s.pt, 'shell', e?.kind === 'shell');
        const ls = e ? lampState(st, e) : null;
        s.lampSt = ls;
        s.st.style.display = ls ? '' : 'none';
        if (ls) s.st.set(ls, '');
        const name = e ? d.label(e) : p ? `${p.name || 'agent'} · missing` : '';
        setText(s.nm, name);
        s.ur.set(u);
        s.el.title = e ? `${i + 1} · ${name} · ${st}${u ? ` · ${u} unread` : ''} — click or press ${i + 1}` : p ? `${name} — its pane is gone (kept 24 h)` : `Shift+${i + 1} pins the aimed agent here`;
        s.el.setAttribute('aria-label', s.el.title);
        const pk = e ? `${e.kind}|${e.status}|${e.workspace?.colorIndex}` : '';
        if (pk !== s.pkey) {
          s.pkey = pk;
          s.inner.replaceChildren();
          if (e) { s.inner.innerHTML = portraitSvg(e, 40); attachPortrait(s.inner, e.id, 40); }
        }
      }
      const sk = slots.map((x) => (x.el.hidden ? 0 : x.key)).join('\n');
      place(sk);
      setYield(covered());
      if (yielded) d.root.style.setProperty('--hb-lift', '0px');
      else place(sk);
    },
    get yielded() { return yielded; },
  };
}
