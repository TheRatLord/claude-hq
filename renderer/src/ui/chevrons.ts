/**
 * Edge chevrons for off-screen blocked agents (§8 HUD, one of the §8 notification channels; UI kit §5.1 Chevron): a
 * clay arrow sign on the edge of the visible world strip pointing at each blocked agent that is behind you or outside
 * the view, with its blocked lamp, name and wait time. Click → go to it. [UI fix r3] ONE sign at a time: the most
 * urgent (needs-you order) + "+n" for the other off-screen blocked agents; in a strip under ~500 px it drops the clock.
 * Allocation-light, 10 Hz.
 * Owner: UI.
 */
import * as THREE from 'three';
import { h, cls } from './dom.ts';
import { lamp } from './kit/index.ts';
import { waitLabel } from './hud.ts';
import { ensureHudCss } from './hudCss.ts';
import { cmpNeedsYou } from './roster/model.ts';
import { pruneIfGrown } from './prune.ts'; // [UI fix r3] `seen` never outgrows the live agents
import { isPlaced, type ActorView, type PlacedActor } from './aim.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Store } from '../net/store.ts';
import type { ScreenRect } from '../core/bus.ts';

const MAX = 1; // [UI fix r3] one folded chevron (most urgent + "+n"), never a stack
/** under this strip width the chevron drops its wait clock */
const NARROW_STRIP = 444; // = a world strip under ~500 px (the sign keeps 28 px off each edge)
/** half the sign height */
const HALF = 20;

type AlertTest = () => ((id: string) => boolean) | null;
/** A blocked actor that is in the world. */
type BlockedActor = PlacedActor & { entity: Entity };
const isBlocked = (a: ActorView): a is BlockedActor => isPlaced(a) && a.entity?.status === 'blocked';

export interface ChevronDeps {
  root: HTMLElement;
  store?: Pick<Store, 'now'>;
  actors?: { list(): ActorView[] } | null;
  hooks: { goTo(id: string): void };
  label?: (e: Entity) => string;
  alertShown?: AlertTest;
  obstacles?: (rects: ScreenRect[]) => void;
  alertEdge?: AlertTest;
}

/**
 * Edge chevrons (see the file header). Notes on the deps:
 *   `alertEdge` [FX fix m2-r2, cross-owner]: FX handed this agent's alert to its chevron (head in the strip's edge band,
 *   so no clamped card under the chevron stack): the chevron shows although the agent projects inside the strip.
 *   `alertShown`: FX's "is this agent's alert card placed in the strip" (fx/labels.ts): its card already points at it,
 *   so no chevron (reviewer r3: a '◀ claude' chevron sat on comet's card while claude's own card was on screen).
 *   `obstacles`: publishes the chevron rects (CSS px) to FX's label declutter as fixed obstacles.
 */
export function createChevrons(d: ChevronDeps) {
  ensureHudCss();
  const wrap = h('div.hq-chev-wrap', { 'aria-hidden': 'true' });
  d.root.prepend(wrap); // under toasts / cards: a chevron never covers a panel
  const pool = Array.from({ length: MAX }, () => {
    const nm = h('span.nm');
    const t = h('span.t');
    const more = h('span.more', { hidden: true });
    const el = h('button.hq-chev.k-chev', { tabindex: '-1', type: 'button' }, lamp('blocked', { label: '' }), nm, t, more);
    el.addEventListener('mousedown', (ev) => ev.preventDefault());
    el.addEventListener('click', () => { if (el.dataset.id) d.hooks.goTo(el.dataset.id); });
    wrap.append(el);
    return { el, nm, t, more };
  });
  const v = new THREE.Vector3();
  let left = 0, right = 0;
  let on = true;
  const rects = Array.from({ length: MAX }, (): ScreenRect => [0, 0, 0, 0]);
  let lastKey = '';
  /** id → last time its FX alert card was seen placed */
  const seen = new Map<string, number>();

  return {
    /** tests: the per-agent map's size */
    get seenSize() { return seen.size; },
    layout(l: number, r: number, show: boolean) { left = l; right = r; on = show; if (!show) { for (const p of pool) p.el.hidden = true; if (lastKey !== '0') { lastKey = '0'; d.obstacles?.([]); } } },
    update(camera: THREE.PerspectiveCamera | null) {
      let n = 0;
      if (on && camera && d.actors) {
        const blocked: BlockedActor[] = [];
        const all = d.actors.list();
        for (const a of all) if (isBlocked(a)) blocked.push(a);
        pruneIfGrown(seen, all);
        blocked.sort((a, b) => cmpNeedsYou(a.entity, b.entity)); // the shared needs-you order (= inbox, roster)
        const shown = d.alertShown?.() ?? null;
        const edge = d.alertEdge?.() ?? null; // [FX fix m2-r2, cross-owner] FX merged this alert into its chevron
        const W = innerWidth, H = innerHeight;
        const x0 = left + 28, x1 = W - right - 28, y0 = 70, y1 = H - 40;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        // [UI fix r3, §4.3 "say it once"] one chevron: the most urgent off-screen blocked agent (cmpNeedsYou order)
        // + "+n" for the others (the HUD alarm, the tickets and the inbox already count them) — never a pile of arrow
        // signs over a narrow world strip
        let lead: BlockedActor | null = null, lpx = 0, lpy = 0, more = 0;
        const names: string[] = [];
        for (const a of blocked) {
          v.set(a.pos.x, (a.pos.y ?? 0) + 0.9, a.pos.z).project(camera);
          const behind = v.z > 1;
          let sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
          const handed = !behind && !!edge?.(a.id);
          if (!handed && !behind && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) continue; // on screen: the beacon / plate does it
          // its FX alert card is in the strip (clamped at the edge): no contradiction. 300 ms of hysteresis: a card
          // anchored right at the strip edge flickers in and out of FX's inStrip test between frames
          const now = performance.now();
          if (!behind && !handed && shown?.(a.id)) { seen.set(a.id, now); continue; }
          if (!behind && !handed && now - (seen.get(a.id) ?? -1e9) < 300) continue;
          // [m2-r2 gameplay] namesakes: the Big Board's 'claude · 2' label (names.ts), never two bare 'claude' tabs
          names.push(d.label ? d.label(a.entity) : a.entity.name);
          if (lead) { more++; continue; }
          if (behind) { sx = W - sx; sy = H - sy; } // mirrored through the centre
          // clamp the direction from the strip centre to the strip rectangle
          let dx = sx - cx, dy = sy - cy;
          if (behind && Math.abs(dy) < Math.abs(dx) * 0.2) dy = 0;
          if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
          const k = Math.min(Math.abs(dx) > 1e-3 ? (x1 - cx) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-3 ? (y1 - cy) / Math.abs(dy) : Infinity);
          lead = a; lpx = cx + dx * k; lpy = cy + dy * k;
        }
        if (lead) {
          const px = lpx, py = lpy;
          const p = pool[n++];
          p.el.hidden = false;
          p.el.dataset.id = lead.id;
          const nm = names[0];
          if (p.nm.textContent !== nm) p.nm.textContent = nm;
          const wt = waitLabel(Math.max(0, (d.store?.now?.() ?? Date.now()) - (lead.entity.statusSince || 0)));
          // narrow strip: the name + "+n" only (the wait clock is on the ticket / inbox)
          const narrow = x1 - x0 < NARROW_STRIP;
          const wtxt = lead.entity.statusSince && !narrow ? wt : '';
          if (p.t.textContent !== wtxt) p.t.textContent = wtxt;
          p.t.hidden = !wtxt;
          const mtxt = more ? `+${more}` : '';
          if (p.more.textContent !== mtxt) p.more.textContent = mtxt;
          p.more.hidden = !more;
          cls(p.el, 'narrow', narrow);
          p.el.title = more ? `${names.join(', ')} are blocked — click to go to ${nm} (B opens the inbox)` : `${nm} is blocked — click to go there`;
          const isLeft = px < cx - 20;
          cls(p.el, 'left', isLeft);
          cls(p.el, 'right', !isLeft); // the sign's point faces its edge
          // obstacle rect: the sign's tip sits 15 px outside (px, py), its body grows away from the edge
          const w = p.el.offsetWidth || 120;
          const r = rects[0];
          r[0] = isLeft ? px - 15 : px + 15 - w; r[1] = py - HALF; r[2] = r[0] + w; r[3] = py + HALF;
          p.el.style.transform = `translate(${r[0].toFixed(0)}px, ${py.toFixed(0)}px)`;
        }
      }
      for (let i = n; i < MAX; i++) pool[i].el.hidden = true;
      // publish on change only (FX keeps the last set)
      let k = `${n}`;
      for (let i = 0; i < n; i++) k += `|${rects[i].map((x) => x | 0).join(',')}`;
      if (k !== lastKey) { lastKey = k; d.obstacles?.(rects.slice(0, n).map((r): ScreenRect => [r[0], r[1], r[2], r[3]])); }
    },
  };
}
