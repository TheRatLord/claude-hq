/**
 * Anchored in-world overlays: nameplates, villager signboards, duckling labels and speech bubbles, drawn as DOM
 * nodes positioned over their world anchor every frame (projected through the camera; `transform` only, nodes reused
 * per key). The scene feeds per-frame tags through `UiPort.tag` (scene/farmers/labels.ts); `UiPort.say` lines become
 * timed bubbles anchored to the speaker (the interactable that was used, or `o.from`).
 *
 * Layout per frame: tags of one owner stack upward from the owner's nameplate anchor (plate, then bubble); stacks are
 * placed nearest-first (say bubbles and needs-you asks before chatter), and later ones nudge up past what is already
 * placed (the interaction tag included) or hide when they cannot fit. Off-screen: say bubbles pin to the screen edge
 * with an arrow toward the speaker; everything else hides. Long lines page (anchor.ts), never truncated.
 *
 * Text changes write the DOM once and are measured in one batched read; steady frames only write transforms /
 * opacity when they move. No allocation per frame once the nodes exist.
 */
import * as THREE from 'three';
import type { Interactable, TagStyle, WorldTag } from '../scene/context.ts';
import { addPlaced, distScale, edgeClamp, pageMs, pageText, placeRect, placed, type EdgePoint } from './anchor.ts';
import { h } from './ctx.ts';
import './anchors.css';
import './signals.css';

/** internal style: 'note' = a narration card (structures, props), not a character speaking */
type Style = TagStyle | 'note';
const RANK: Record<Style, number> = { name: 0, villager: 0, duck: 0, speech: 1, ask: 1, note: 1 };
const isBubble = (s: Style) => RANK[s] === 1;
/** metres above an interactable's centre where a say bubble's tail points when no nameplate anchors it */
const SAY_LIFT: Record<Interactable['kind'], number> = { farmer: 0.75, villager: 0.8, helper: 0.55, animal: 0.45, structure: 0.9, prop: 0.6, plot: 0.9 };
const GAP = 6;
const EDGE = 18;

interface Item {
  key: string; owner: string; style: Style; title: string; sub: string;
  el: HTMLElement; who: HTMLElement | null; txt: HTMLElement; sub2: HTMLElement | null; pg: HTMLElement | null; arrow: HTMLElement | null;
  pos: THREE.Vector3; alpha: number; dist: number;
  /** frame it was last submitted (timed say items live by `until` instead) */
  seen: number; shown: boolean; lastUse: number;
  w: number; h: number; dirty: boolean;
  /** the owner's status on a farmer nameplate (`data-st`: the colour-safe shape, hud.css) */
  st: string;
  /** nameplate gauge (WorldTag.meter, percent; -1 = none) and its node, made on first use */
  meter: number; meterEl: HTMLElement | null;
  pages: string[]; page: number; pageAt: number;
  // applied
  ax: number; ay: number; as: number; ao: number; z: number; edge: boolean; edgeA: number; solo: boolean; tx: number;
  // layout scratch
  sx: number; sy: number; off: boolean; behind: boolean;
  // timed say
  until: number; anchor: Interactable | null; born: number;
}

export interface Anchors {
  el: HTMLElement;
  /** UiPort.tag */
  submit(t: WorldTag): void;
  /** UiPort.say */
  say(text: string, ms: number | undefined, o: { who?: string; from?: string } | undefined, at?: 'screen'): void;
  /** per rendered frame; `obstacle` = the interaction tag's rect this frame (or null) */
  frame(cam: THREE.Camera | null, obstacle: { x: number; y: number; w: number; h: number } | null): void;
  /** live counts (perf / tests) */
  count(): number;
  /**
   * Keep clear of the HUD's fixed furniture: every element under `root` marked `data-hud-obstacle` (its own box) or
   * `data-hud-obstacle="children"` (each visible child: a column of cards, a toast stack). Rects are re-measured
   * only when something changes (resize, class / child changes under `root`), never per frame.
   */
  watch(root: HTMLElement): void;
  /** move a w × h box at (x, y) off the HUD furniture (the interaction tag uses it); false when it cannot fit */
  fit(x: number, y: number, w: number, h: number, out: { x: number; y: number }): boolean;
  /** re-measure every tag (a style change: larger text, high contrast) */
  remeasure(): void;
}

/** Settings hooks: which nameplates show (Interface → nameplates), and a farmer's status for the colour-safe shape. */
export interface AnchorOpts {
  /** may a nameplate / signboard / duckling label `dist` metres away show? (bubbles always do) */
  plate?(dist: number): boolean;
  /** the status of a nameplate's owner (farmers), or null */
  statusOf?(owner: string): string | null;
}

export function createAnchors(focused: () => Interactable | null, all: () => Iterable<Interactable> | null, opts: AnchorOpts = {}): Anchors {
  const el = h('div.vh-anchors', { 'aria-hidden': 'false', 'data-testid': 'anchors' });
  const live = h('div.vh-sr', { 'aria-live': 'polite', role: 'status' });
  el.append(live);
  const items = new Map<string, Item>();
  const list: Item[] = [];
  const order: Item[] = [];
  const groups: { owner: string; first: number; n: number; prio: number }[] = [];
  const P = placed(96);
  const HUD = placed(48);
  let hudDirty = true, hudRoot: HTMLElement | null = null, hudLate: ReturnType<typeof setTimeout> | undefined;
  const spot = { x: 0, y: 0 };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { hudDirty = true; });
  const observed = new Set<Element>();
  const v = new THREE.Vector3(), camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
  const edge: EdgePoint = { x: 0, y: 0, angle: 0 };
  let frameNo = 0;
  let sayItem: Item | null = null;

  function make(key: string, style: Style): Item {
    const bubble = isBubble(style);
    const txt = h(bubble ? 'div.txt' : 'b');
    const who = bubble ? h('div.who') : null;
    const sub2 = bubble ? null : h('span');
    const pg = bubble ? h('div.pg') : null;
    const arrow = bubble ? h('i.arrow') : null;
    const node = h(`div.vt.vt-${style}`, null, ...(bubble ? [h('div.card', null, who!, txt, pg!), arrow!] : [txt, sub2!]));
    node.style.display = 'none';
    el.append(node);
    const it: Item = {
      key, owner: '', style, title: '', sub: '', el: node, who, txt, sub2, pg, arrow, pos: new THREE.Vector3(), alpha: 0, dist: 0,
      seen: -1, shown: false, lastUse: 0, w: 0, h: 0, dirty: true, st: '', pages: [''], page: 0, pageAt: 0,
      ax: NaN, ay: NaN, as: 1, ao: -1, z: 0, edge: false, edgeA: NaN, solo: false, tx: 0, sx: 0, sy: 0, off: false, behind: false, until: 0, anchor: null, born: 0, meter: -1, meterEl: null,
    };
    items.set(key, it);
    list.push(it);
    return it;
  }

  function setText(it: Item, style: Style, title: string, sub: string, now: number): void {
    if (it.style === style && it.title === title && it.sub === sub) return;
    if (it.style !== style) { it.el.className = `vt vt-${style}`; it.style = style; }
    it.title = title; it.sub = sub; it.dirty = true;
    if (isBubble(style)) {
      it.pages = pageText(title);
      it.page = 0; it.pageAt = now;
      it.txt.textContent = it.pages[0];
      it.who!.textContent = sub;
      it.pg!.textContent = it.pages.length > 1 ? `1/${it.pages.length}` : '';
      it.pg!.style.display = it.pages.length > 1 ? '' : 'none';
    } else {
      it.txt.textContent = title;
      it.sub2!.textContent = style === 'villager' ? sub.toUpperCase() : sub;
      it.sub2!.style.display = sub ? '' : 'none';
    }
  }

  /** a farmer's context gauge under the name (signals.md): shown from 65 %, red past 85 % */
  function setMeter(it: Item, v: number): void {
    if (v === it.meter) return;
    if ((v < 0) !== (it.meter < 0)) it.dirty = true; // the plate grows / shrinks
    it.meter = v;
    if (v < 0) { if (it.meterEl) it.meterEl.style.display = 'none'; return; }
    if (!it.meterEl) { it.meterEl = h('span.vt-meter', { role: 'img' }, h('i')); it.el.append(it.meterEl); }
    it.meterEl.style.display = '';
    it.meterEl.classList.toggle('hot', v > 85);
    it.meterEl.setAttribute('aria-label', `context ${v}% full`);
    it.meterEl.title = `Context ${v}% full`;
    (it.meterEl.firstChild as HTMLElement).style.width = `${v}%`;
  }

  function submit(t: WorldTag): void {
    if (!isBubble(t.style) && opts.plate && !opts.plate(t.dist)) return;
    const now = performance.now();
    let it = items.get(t.key);
    if (!it) it = make(t.key, t.style);
    setText(it, t.style, t.title, t.sub, now);
    const st = t.style === 'name' ? opts.statusOf?.(t.owner) ?? '' : '';
    if (st !== it.st) { it.st = st; if (st) it.el.dataset.st = st; else delete it.el.dataset.st; it.dirty = true; }
    setMeter(it, t.style === 'name' && t.meter != null && t.meter >= 0 ? Math.round(Math.min(1, t.meter) * 100) : -1);
    it.owner = t.owner; it.alpha = t.alpha; it.dist = t.dist; it.pos.copy(t.pos);
    it.seen = frameNo + 1; // shown in the coming HUD frame
    it.lastUse = now;
  }

  function say(text: string, ms = 3200, o?: { who?: string; from?: string }, at?: 'screen'): void {
    const now = performance.now();
    let anchor: Interactable | null = null;
    if (o?.from) { const src = all(); if (src) for (const i of src) if (i.id === o.from) { anchor = i; break; } }
    if (at !== 'screen') anchor ??= focused();
    const kind = anchor?.kind;
    const style: Style = kind === 'farmer' || kind === 'villager' || kind === 'helper' || kind === 'animal' ? 'speech' : 'note';
    let who = o?.who ?? '';
    if (!who && anchor) { try { who = anchor.label(); } catch { who = ''; } }
    if (sayItem && sayItem.key !== 'say') sayItem = null;
    const it = sayItem ?? items.get('say') ?? make('say', style);
    sayItem = it;
    it.title = ''; // force a rewrite even for the same line said twice
    setText(it, style, text, who, now);
    it.anchor = anchor;
    it.owner = anchor ? anchor.id : '#say';
    it.born = now;
    let total = 0;
    for (const p of it.pages) total += pageMs(p);
    it.until = now + Math.max(ms, total);
    it.lastUse = now;
    live.textContent = who ? `${who}: ${text}` : text;
  }

  /** advance paging; returns true when the text changed */
  function page(it: Item, now: number): void {
    if (it.pages.length < 2) return;
    if (now - it.pageAt < pageMs(it.pages[it.page])) return;
    it.page = (it.page + 1) % it.pages.length;
    it.pageAt = now;
    it.txt.textContent = it.pages[it.page];
    it.pg!.textContent = `${it.page + 1}/${it.pages.length}`;
    it.dirty = true;
  }

  function hide(it: Item): void {
    if (!it.shown) return;
    it.shown = false;
    it.el.style.display = 'none';
  }

  function frame(cam: THREE.Camera | null, obstacle: { x: number; y: number; w: number; h: number } | null): void {
    frameNo++;
    const now = performance.now();
    const W = innerWidth, H = innerHeight;
    const dpr = devicePixelRatio || 1;
    if (cam) { cam.updateMatrixWorld(); cam.getWorldPosition(camPos); cam.getWorldDirection(camDir); }
    // 1. who is live this frame; timed say bubbles follow their anchor
    order.length = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.key === 'say') {
        if (now > it.until + 250) { hide(it); continue; }
        const a = it.anchor;
        if (a) {
          try { a.pos(it.pos); } catch { it.anchor = null; }
          if (it.anchor) {
            const plate = findPlate(a.id);
            if (plate) it.pos.copy(plate.pos); else it.pos.y += SAY_LIFT[a.kind] ?? 0.6;
          }
        }
        const fadeIn = Math.min(1, (now - it.born) / 140), fadeOut = Math.min(1, Math.max(0, (it.until + 250 - now) / 250));
        it.alpha = fadeIn * fadeOut;
        it.dist = 0;
      } else if (it.seen !== frameNo) {
        hide(it);
        if (now - it.lastUse > 8000) { it.el.remove(); items.delete(it.key); list.splice(i, 1); }
        continue;
      }
      if (!cam) { hide(it); continue; }
      page(it, now);
      order.push(it);
    }
    // 2. text writes are done: show + measure the dirty ones (one layout read per frame at most)
    for (const it of order) if (!it.shown) { it.shown = true; it.el.style.display = ''; it.ao = -1; it.ax = NaN; }
    for (const it of order) if (it.dirty) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; it.dirty = false; }
    // 3. project
    for (const it of order) {
      if (it.key === 'say' && !it.anchor) { it.sx = W / 2; it.sy = H * 0.72; it.off = false; it.behind = false; continue; }
      v.copy(it.pos).sub(camPos);
      it.behind = v.dot(camDir) < 0.05;
      v.copy(it.pos).project(cam!);
      it.sx = (v.x * 0.5 + 0.5) * W;
      it.sy = (-v.y * 0.5 + 0.5) * H;
      it.off = it.behind || it.sx < 0 || it.sx > W || it.sy < 0 || it.sy > H + 40;
    }
    // 4. group by owner (plate first), then place groups by priority
    order.sort(byOwnerRank);
    groups.length = 0;
    let gi = 0;
    for (let i = 0; i < order.length;) {
      const owner = order[i].owner;
      let j = i, prio = Infinity;
      while (j < order.length && order[j].owner === owner) {
        const it = order[j];
        const p = it.key === 'say' ? -2 : it.style === 'ask' ? -1 + it.dist / 1000 : it.dist;
        if (p < prio) prio = p;
        j++;
      }
      const g = groupsPool[gi] ?? (groupsPool[gi] = { owner: '', first: 0, n: 0, prio: 0 });
      g.owner = owner; g.first = i; g.n = j - i; g.prio = prio;
      groups.push(g); gi++;
      i = j;
    }
    groups.sort(byPrio);
    if (hudDirty) measureHud();
    P.n = 0;
    for (let i = 0; i < HUD.n; i++) addPlaced(P, HUD.r[i * 4], HUD.r[i * 4 + 1], HUD.r[i * 4 + 2], HUD.r[i * 4 + 3]);
    if (obstacle) addPlaced(P, obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    let z = groups.length + 1;
    for (const g of groups) {
      const base = order[g.first];
      let s = distScale(base.dist);
      let gw = 0, gh = 0;
      for (let k = 0; k < g.n; k++) { const it = order[g.first + k]; gw = Math.max(gw, it.w * s); gh += it.h * s + (k ? GAP : 0); }
      let cx = base.sx, bottom = base.sy - 4;
      const timed = order[g.first + g.n - 1].key === 'say';
      let pinned = false;
      if (base.off || bottom - gh < -gh * 0.5) {
        if (!timed) { for (let k = 0; k < g.n; k++) hide(order[g.first + k]); continue; }
        // pin the say bubble to the edge, pointing at the speaker
        const say = order[g.first + g.n - 1];
        edgeClamp(base.sx, base.sy, base.behind, W, H, EDGE, edge);
        pinned = true;
        gw = say.w; gh = say.h; s = 1;
        cx = Math.min(W - EDGE - gw / 2, Math.max(EDGE + gw / 2, edge.x));
        bottom = Math.min(H - EDGE, Math.max(EDGE + gh, edge.y + gh / 2));
      }
      const want = cx;
      // nearest free spot: off the HUD furniture, the interaction tag and the stacks already placed
      if (placeRect(P, cx - gw / 2, bottom - gh, gw, gh, GAP, W, H, 8, pinned ? 900 : 240, spot)) { cx = spot.x + gw / 2; bottom = spot.y + gh; }
      else if (!timed) { for (let k = 0; k < g.n; k++) hide(order[g.first + k]); continue; }
      else { cx = Math.min(W - 8 - gw / 2, Math.max(8 + gw / 2, cx)); }
      const top = bottom - gh;
      addPlaced(P, cx - gw / 2, top, gw, gh);
      // a lone bubble pushed sideways keeps its tail pointing at the speaker
      const tx = g.n === 1 && !pinned ? Math.max(-(gw / 2 - 20), Math.min(gw / 2 - 20, want - cx)) / s : 0;
      // write: bottom-up stack (pinned to the edge: only the say bubble, the plate stays with its owner off-screen)
      let y = top + gh;
      for (let k = 0; k < g.n; k++) {
        const it = order[g.first + k];
        if (pinned && it.key !== 'say') { hide(it); continue; }
        const hh = it.h * s;
        y -= hh;
        if (!it.shown) { it.shown = true; it.el.style.display = ''; }
        // a bubble without its owner's nameplate below says who it is
        const solo = g.n === 1 || pinned;
        if (solo !== it.solo) { it.solo = solo; it.el.classList.toggle('solo', solo); it.dirty = true; }
        place(it, cx - (it.w * s) / 2, y, s, dpr, z, pinned && it.key === 'say' ? edge.angle : NaN);
        if (Math.abs(tx - it.tx) > 0.5) { it.tx = tx; it.el.style.setProperty('--tx', `${tx.toFixed(1)}px`); }
        y -= GAP;
      }
      z--;
    }
  }

  function place(it: Item, x: number, y: number, s: number, dpr: number, z: number, edgeAngle: number): void {
    x = Math.round(x * dpr) / dpr; y = Math.round(y * dpr) / dpr;
    if (!(Math.abs(x - it.ax) <= 0.3 && Math.abs(y - it.ay) <= 0.3 && Math.abs(s - it.as) <= 0.004)) {
      it.ax = x; it.ay = y; it.as = s;
      it.el.style.transform = `translate3d(${x}px,${y}px,0) scale(${s.toFixed(3)})`;
    }
    const o = Math.round(Math.min(1, it.alpha) * 50) / 50;
    if (o !== it.ao) { it.ao = o; it.el.style.opacity = String(o); }
    if (z !== it.z) { it.z = z; it.el.style.zIndex = String(z); }
    const edged = !Number.isNaN(edgeAngle);
    if (edged !== it.edge) { it.edge = edged; it.el.classList.toggle('edge', edged); }
    if (edged && it.arrow && !(Math.abs(edgeAngle - it.edgeA) <= 0.02)) {
      it.edgeA = edgeAngle;
      // the arrow sits on the bubble's rim toward the speaker
      const c = Math.cos(edgeAngle), sn = Math.sin(edgeAngle);
      const k = Math.min((it.w / 2 + 2) / Math.max(1e-3, Math.abs(c)), (it.h / 2 + 2) / Math.max(1e-3, Math.abs(sn)));
      it.arrow.style.transform = `translate(${(c * k).toFixed(1)}px,${(sn * k).toFixed(1)}px) rotate(${edgeAngle.toFixed(3)}rad)`;
    }
  }

  function findPlate(owner: string): Item | null {
    for (const it of list) if (it.owner === owner && it.seen === frameNo && RANK[it.style] === 0) return it;
    return null;
  }

  // observers: no subtree watching (the terminal drawer churns its DOM); just the obstacles, the children of
  // "children" obstacles, and the root's own class (panels opening re-style the furniture)
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => dirty());
  const MO_OPTS: MutationObserverInit = { attributes: true, attributeFilter: ['class', 'hidden', 'open', 'style'] };
  function dirty(): void {
    hudDirty = true;
    // once more after CSS transitions / pop-in animations settle
    clearTimeout(hudLate);
    hudLate = setTimeout(() => { hudDirty = true; }, 450);
  }

  function measureHud(): void {
    hudDirty = false;
    HUD.n = 0;
    if (!hudRoot) return;
    // forget furniture that left the page (every toast that ever showed was a "children" obstacle): the set, the
    // observers and the elements must not grow for as long as the valley stays open
    let stale = false;
    for (const e of observed) if (!e.isConnected) { observed.delete(e); ro?.unobserve(e); stale = true; }
    if (stale && mo) {
      mo.disconnect();
      mo.observe(hudRoot, { attributes: true, attributeFilter: ['class'] });
      for (const e of observed) mo.observe(e, (e as HTMLElement).dataset.hudObstacle === 'children' ? { ...MO_OPTS, childList: true } : MO_OPTS);
    }
    const add = (e: Element) => {
      // children of a "children" obstacle change size on their own too (hover / CSS-only states): watch their boxes
      if (mo && !observed.has(e)) { observed.add(e); mo.observe(e, MO_OPTS); ro?.observe(e); }
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
      addPlaced(HUD, r.left, r.top, r.width, r.height);
    };
    for (const e of hudRoot.querySelectorAll('[data-hud-obstacle]')) {
      if (!observed.has(e)) {
        ro?.observe(e);
        if ((e as HTMLElement).dataset.hudObstacle === 'children') mo?.observe(e, { ...MO_OPTS, childList: true });
      }
      if ((e as HTMLElement).dataset.hudObstacle === 'children') { observed.add(e); for (const c of e.children) add(c); } else add(e);
    }
  }

  function watch(root: HTMLElement): void {
    hudRoot = root;
    hudDirty = true;
    mo?.observe(root, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', dirty);
  }

  function fit(x: number, y: number, w: number, h: number, out: { x: number; y: number }): boolean {
    if (hudDirty) measureHud();
    return placeRect(HUD, x, y, w, h, GAP, innerWidth, innerHeight, 8, 400, out);
  }

  const groupsPool: { owner: string; first: number; n: number; prio: number }[] = [];
  return { el, submit, say, frame, count: () => order.length, watch, fit, remeasure() { for (const it of list) it.dirty = true; dirty(); } };
}

function byOwnerRank(a: Item, b: Item): number {
  if (a.owner !== b.owner) return a.owner < b.owner ? -1 : 1;
  return RANK[a.style] - RANK[b.style] || (a.key === 'say' ? 1 : b.key === 'say' ? -1 : 0);
}
function byPrio(a: { prio: number }, b: { prio: number }): number { return a.prio - b.prio; }
