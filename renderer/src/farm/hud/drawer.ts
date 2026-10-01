/**
 * Terminal drawer: the real terminal of any agent, one click from every menu. Reuses the proven viewer
 * (ui/terminal/view.ts): observe first; typing (or "Take control") promotes to control; term.state / ack / gone /
 * rekey arrive through HudNet. A side list switches terminals (Ctrl+PageUp/PageDown).
 *
 * Closing: the close button, the leader key (settings.leaderKey, default Ctrl+`), clicking the dimmed valley, or
 * Escape — but Escape only while watching. In control, Escape belongs to the agent (Claude Code uses it).
 */
import type { Entity } from '../../../../shared/protocol.ts';
import type { FarmerView, ValleyState } from '../model/types.ts';
import { createTermView, type TermView } from '../../ui/terminal/view.ts';
import type { TerminalKeyAction } from '../../ui/terminal/keys.ts';
import { farmerFace, ICONS, KIND_ICON, icon } from './icons.ts';
import { HELPER_LABEL, JOB_LABEL, nice, seedHue, STATUS_LABEL, STATUS_RANK } from './format.ts';
import { h, type HudCtx, type Panel } from './ctx.ts';

export interface Drawer extends Panel {
  dim: HTMLElement;
  show(id: string, enterAt?: number): void;
  /** the id shown (or last shown) */
  lastId(): string | null;
  tick(): void;
  cycle(dir: 1 | -1): void;
}

type Item = { id: string; plot: string; plotId: string; kind: 'farmer' | 'helper' };

export function createDrawer(ctx: HudCtx): Drawer {
  const { d } = ctx;
  const dim = h('div.vh-drawer-dim', { 'aria-hidden': 'true' });
  // --- side list ---
  const dlist = h('div.vh-dlist.vh-scroll', { role: 'listbox', 'aria-label': 'Switch terminal', 'data-testid': 'drawer-list' });
  const side = h('aside.vh-dside.vh-paper', null, h('div.vh-h3', null, icon(ICONS.book), 'Terminals'), dlist);
  // --- header ---
  const face = h('div.face');
  const nameEl = h('span', { 'data-testid': 'drawer-name' });
  const modeEl = h('span.mode', { 'data-testid': 'drawer-mode' });
  const pillEl = h('span.vh-pill');
  const sub = h('div.sub');
  const takeBtn = h('button.vh-btn.small.primary', { type: 'button', 'data-testid': 'drawer-take' });
  const fontDown = h('button.vh-btn.small', { type: 'button', title: 'Smaller text', 'aria-label': 'Smaller text' }, 'A−');
  const fontUp = h('button.vh-btn.small', { type: 'button', title: 'Bigger text', 'aria-label': 'Bigger text' }, 'A+');
  const histBtn = h('button.vh-btn.small', { type: 'button', title: 'Scrollback history (wheel up)' }, 'History');
  const cardBtn = h('button.vh-btn.small', { type: 'button', title: 'Farmer card' }, icon(ICONS.hand), 'Card');
  const walkBtn = h('button.vh-btn.small', { type: 'button', title: 'Close and walk to this farmer', 'aria-label': 'Walk there' }, icon(ICONS.walk), 'Walk');
  const ackBtn = h('button.vh-btn.small', { type: 'button', title: 'Mark as reviewed' }, icon(ICONS.check), 'Acknowledge');
  const closeBtn = h('button.vh-btn.small.danger', { type: 'button', 'data-testid': 'drawer-close', title: 'Close (Ctrl+` / Esc while watching)' }, 'Close');
  const head = h('div.vh-dhead.vh-paper', null, face, h('div.who', null, h('div.nm', null, nameEl, pillEl, modeEl), sub),
    h('div.ctl', null, takeBtn, ackBtn, fontDown, fontUp, histBtn, cardBtn, walkBtn, closeBtn));
  const askQ = h('span.q');
  const askOpts = h('span', { style: { display: 'contents' } });
  const ask = h('div.vh-dask', { hidden: true, 'data-testid': 'drawer-ask' }, icon(ICONS.bang), askQ, askOpts);
  const notices = h('div');
  const host = h('div.host', { 'data-testid': 'drawer-host' });
  const empty = h('div.vh-dempty', { text: 'Pick a farmer on the left.' });
  const term = h('div.vh-dterm', null, notices, host, empty);
  const hintL = h('span');
  const flashEl = h('span.flash');
  const foot = h('div.vh-dfoot', null, hintL, flashEl);
  const main = h('div.vh-dmain', null, head, ask, term, foot);
  const el = h('section.vh-drawer.vh-wood', { 'aria-label': 'Terminal', 'data-testid': 'drawer' }, side, main);

  let view: TermView | null = null;
  let last: string | null = null;
  let busy = false;
  let pendingRekey: string | null = null;
  let reopen = false;
  let reopenSince = 0;
  let wasReady = d.net.ready();
  let items: Item[] = [];

  const entity = (): Entity | null => (view ? d.net.entity(view.id) : null);
  const leader = () => d.settings.get('leaderKey') || 'Ctrl+`';

  // ---------------------------------------------------------------------------------------------
  function render(): void {
    const s = ctx.state();
    const id = view?.id ?? last;
    empty.style.display = view ? 'none' : '';
    if (!id) return;
    const f = s?.farmers.get(id), hp = s?.helpers.get(id), e = d.net.entity(id);
    const plot = s?.plots.get(f?.plotId ?? hp?.plotId ?? '');
    const name = nice(f?.name ?? hp?.name ?? e?.name ?? id);
    if (face.dataset.for !== id) { face.dataset.for = id; face.innerHTML = f ? farmerFace(seedHue(f.seed), f.kind, f.tier) : ICONS.scarecrow; }
    nameEl.textContent = name;
    if (f) { pillEl.className = `vh-pill st-${f.status}`; pillEl.textContent = f.unseenDone ? 'Done ✓' : STATUS_LABEL[f.status]; }
    else { pillEl.className = 'vh-pill'; pillEl.textContent = hp?.running ? 'Running' : 'Shell'; }
    sub.replaceChildren(plot ? icon(KIND_ICON[plot.kind]) : '', ` ${plot?.label ?? e?.workspace.label ?? ''} · `,
      f ? `${JOB_LABEL[f.job]}${f.detail ? ` · ${f.detail}` : ''}` : hp ? `${HELPER_LABEL[hp.activity]} · ${hp.label}` : '');
    const st = view?.state?.state ?? 'connecting';
    const control = view?.mode === 'control' && view.life.input === 'send';
    modeEl.className = `mode ${control ? 'control' : st === 'live' || st === 'released' ? '' : 'off'}`;
    modeEl.textContent = control ? 'In control' : st === 'live' || st === 'released' ? 'Watching' : st === 'connecting' || st === 'reconnecting' ? 'Connecting…' : st;
    modeEl.dataset.state = `${st}:${view?.mode ?? 'observe'}`;
    term.classList.toggle('control', control);
    takeBtn.replaceChildren(control ? 'Watch only' : 'Take control');
    takeBtn.title = control ? 'Release control (stop sending keys)' : 'Send your keystrokes to this agent (or just start typing)';
    takeBtn.className = `vh-btn small ${control ? '' : 'primary'}`;
    takeBtn.disabled = !view || busy || !d.net.ready() || (!control && view.life.input === 'disabled');
    ackBtn.style.display = f?.unseenDone ? '' : 'none';
    cardBtn.style.display = f || hp ? '' : 'none';
    histBtn.textContent = view?.historyOpen ? 'Live' : 'History';
    hintL.replaceChildren(...(control
      ? [h('span', null, 'Your keys go to ', h('b', { text: name }), ' — Esc included'), h('span', null, h('kbd.vh-k', { text: leader() }), 'close'), h('span', null, h('kbd.vh-k', { text: 'Ctrl+PgUp/PgDn' }), 'switch'), h('span', null, h('kbd.vh-k', { text: d.platform.mac ? '⌘ +/−' : 'Ctrl +/−' }), 'text size')]
      : [h('span', null, 'Watching · type to take control'), h('span', null, h('kbd.vh-k', { text: 'Esc' }), '/', h('kbd.vh-k', { text: leader() }), 'close'), h('span', null, h('kbd.vh-k', { text: 'Ctrl+PgUp/PgDn' }), 'switch'), h('span', null, h('kbd.vh-k', { text: d.platform.mac ? '⌘ +/−' : 'Ctrl +/−' }), 'text size'), h('span', null, 'wheel ↑ history')]));
    flashEl.textContent = view?.flash ?? '';
    // needs-you answers
    const needs = !!f?.needsYou;
    ask.hidden = !needs;
    if (needs && f) {
      const sig = `${f.id}|${f.question}|${f.options.map((o) => o.key + o.label).join('|')}`;
      if (ask.dataset.sig !== sig) {
        ask.dataset.sig = sig;
        askQ.textContent = f.question ?? 'Waiting for you';
        askOpts.replaceChildren(...f.options.map((o) => h('button.vh-btn.small.gold', {
          type: 'button', title: o.label, 'data-testid': 'drawer-answer',
          onclick: async () => { await ctx.answer(f.id, o.key, o.label); view?.focus(); },
        }, h('span.num', { text: o.key, style: { fontWeight: '800' } }), h('span.lab', { text: o.label }))));
      }
    }
    renderList(s);
  }

  let listSig = '';
  function renderList(s: ValleyState | null): void {
    if (!s) return;
    const plots = [...s.plots.values()].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label));
    const next: Item[] = [];
    for (const p of plots) {
      const fs = p.farmers.map((id) => s.farmers.get(id)).filter((f): f is FarmerView => !!f).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name));
      for (const f of fs) next.push({ id: f.id, plot: p.label, plotId: p.id, kind: 'farmer' });
      for (const hid of p.helpers) if (s.helpers.has(hid)) next.push({ id: hid, plot: p.label, plotId: p.id, kind: 'helper' });
    }
    items = next;
    const cur = view?.id ?? last;
    const sig = `${cur}#${next.map((it) => { const f = s.farmers.get(it.id); return `${it.id}${f ? f.status + f.needsYou + f.unseenDone : ''}`; }).join(',')}`;
    if (sig === listSig) return;
    listSig = sig;
    dlist.replaceChildren();
    let plot = '';
    for (const it of next) {
      if (it.plot !== plot) {
        plot = it.plot;
        const p = s.plots.get(it.plotId);
        dlist.append(h('div.g', null, p ? icon(KIND_ICON[p.kind]) : null, it.plot));
      }
      const f = s.farmers.get(it.id), hp = s.helpers.get(it.id);
      const btn = h('button', { type: 'button', role: 'option', 'aria-current': String(it.id === cur), 'data-id': it.id, title: f ? `${STATUS_LABEL[f.status]} · ${JOB_LABEL[f.job]}` : 'Shell' },
        f ? h(`i.vh-dot.st-${f.status}`) : h('i.vh-dot', { style: { background: hp?.running ? '#ffd23f' : '#ddd' } }),
        h('span.nm', { text: nice(f?.name ?? hp?.name ?? it.id) }),
        f?.needsYou ? h('span.tag', { text: '!' }) : f?.unseenDone ? h('span.tag.done', { text: '✓' }) : null);
      const id = it.id;
      btn.addEventListener('click', () => show(id));
      dlist.append(btn);
    }
  }

  // ---------------------------------------------------------------------------------------------
  function fontAction(a: Exclude<TerminalKeyAction, 'copy' | 'pasteNative'>): void {
    const cur = d.settings.get('termFontPx') || 14;
    d.settings.set({ termFontPx: a === 'fontReset' ? 14 : Math.max(8, Math.min(32, cur + (a === 'fontUp' ? 1 : -1))) });
  }
  d.settings.onChange((c) => { if ('termFontPx' in c) { view?.setFont(); render(); } });

  function closeView(): void {
    const v = view;
    view = null;
    busy = false; pendingRekey = null; reopen = false;
    v?.dispose();
    notices.replaceChildren();
  }

  async function openViewer(v: TermView, enterAt?: number): Promise<void> {
    busy = true; render();
    try {
      const r = await v.open();
      if (view === v && !r.ok && r.error !== 'terminal_limit') ctx.toast({ text: "Couldn't open that terminal", sub: r.error ?? 'unknown error', level: 'error' });
    } catch (err) {
      if (view === v || !view) ctx.toast({ text: "Couldn't open that terminal", sub: String(err instanceof Error ? err.message : err), level: 'error' });
    } finally {
      if (view === v) { busy = false; render(); if (ctx.panels.isOpen('drawer')) v.focus(enterAt !== undefined ? { enterAt } : {}); }
    }
  }

  function show(id: string, enterAt?: number): void {
    last = id;
    if (view?.id === id) { view.focus(enterAt !== undefined ? { enterAt } : {}); render(); return; }
    closeView();
    const f = ctx.farmer(id);
    if (f?.unseenDone && d.settings.get('autoAckOnOpen')) ctx.b?.agents.ack(id);
    if (!d.net.entity(id) && !ctx.helper(id) && !f) { ctx.toast({ text: 'That terminal is gone', level: 'warn' }); render(); return; }
    // the hooks run lazily (and `grid` once during construction, before `v` exists)
    let v: TermView | undefined = undefined;
    const idOf = () => v?.id ?? id;
    v = createTermView({
      id, net: d.net, settings: d.settings, platform: d.platform,
      grid: () => d.net.entity(idOf())?.layoutRect ?? null,
      hooks: {
        entity: () => d.net.entity(idOf()),
        leave: () => { if (view === v) ctx.panels.close(); },
        toast: (level, text) => ctx.toast({ text, level: level === 'info' ? 'info' : level }),
        confirm: async (text) => window.confirm(text),
        changed: () => { if (view === v) scheduleRender(); },
        evict: () => {
          if (view === v) { closeView(); ctx.panels.close(); }
          throw new Error('Too many terminal viewers are open (another window?). Close one and try again.');
        },
        typed: () => { if (view === v) scheduleRender(); },
        keyAction: fontAction,
      },
    });
    const tv = v;
    view = tv;
    tv.term.options.screenReaderMode = true;
    tv.onClose = () => { if (view === tv) ctx.panels.close(); };
    notices.append(tv.notices);
    tv.attach(host);
    render();
    void openViewer(tv, enterAt);
    ctx.sfx('page');
  }

  let raf = 0;
  const scheduleRender = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); setTimeout(() => { if (raf) { cancelAnimationFrame(raf); raf = 0; render(); } }, 200); };

  // ---------------------------------------------------------------------------------------------
  d.net.onTermState((m) => { if (view && m.id === view.id) view.applyState(m); });
  d.net.onTermAck((m) => { if (view && m.id === view.id) view.ack(m.upTo); });
  d.net.onGone((m) => {
    if (!view || m.id !== view.id) return;
    if (m.reason === 'rekeyed' && m.newId) {
      pendingRekey = m.newId;
      if (last === m.id) last = m.newId;
      view.discardOutbox();
      view.applyState({ state: 'reconnecting', mode: 'observe' });
      tryRekey();
    } else view.applyState({ state: 'gone', mode: 'observe', detail: m.reason });
    render();
  });
  const tryRekey = () => {
    if (view && pendingRekey && d.net.ready() && d.net.entity(pendingRekey)) { const n = pendingRekey; pendingRekey = null; view.rekey(n); }
  };
  d.net.onEntity((e) => {
    if (pendingRekey && e.id === pendingRekey) tryRekey();
    if (view && e.id === view.id && ctx.panels.isOpen('drawer')) scheduleRender();
  });
  d.net.onConn(() => {
    const ready = d.net.ready();
    if (!ready && view) {
      reopen = true;
      view.discardOutbox();
      view.applyState({ state: 'reconnecting', mode: 'observe' });
    }
    if (ready && !wasReady && view) { reopen = true; reopenSince = Date.now(); }
    wasReady = ready;
    render();
  });
  function tick(): void {
    tryRekey();
    if (reopen && view && d.net.ready()) {
      if (d.net.entity(view.id)) { reopen = false; void openViewer(view); }
      else if (Date.now() - reopenSince > 4000) { reopen = false; view.applyState({ state: 'gone', mode: 'observe', detail: 'closed' }); }
    }
    if (ctx.panels.isOpen('drawer')) render();
  }

  // ---------------------------------------------------------------------------------------------
  takeBtn.addEventListener('click', async () => {
    const v = view;
    if (!v || busy) return;
    busy = true; render();
    try {
      if (v.mode === 'control') { v.discardOutbox(); await v.demote(); }
      else await v.promote();
    } catch (err) { ctx.toast({ text: 'Terminal action failed', sub: String(err), level: 'error' }); }
    finally { if (view === v) { busy = false; render(); v.focus(); } }
  });
  fontDown.addEventListener('click', () => { fontAction('fontDown'); view?.focus(); });
  fontUp.addEventListener('click', () => { fontAction('fontUp'); view?.focus(); });
  histBtn.addEventListener('click', () => { if (!view) return; if (view.historyOpen) view.closeHistory(); else void view.openHistory(); render(); });
  cardBtn.addEventListener('click', () => { const id = view?.id ?? last; if (id) ctx.panels.open('card', id); });
  walkBtn.addEventListener('click', () => { const id = view?.id ?? last; ctx.panels.close(); if (id) ctx.travel(id); });
  ackBtn.addEventListener('click', () => { const id = view?.id; if (id) { ctx.b?.agents.ack(id); ctx.sfx('chime-done'); view?.focus(); } });
  closeBtn.addEventListener('click', () => ctx.panels.close());
  dim.addEventListener('click', () => ctx.panels.close());
  const ro = new ResizeObserver(() => { view?.relayout(); });
  ro.observe(host);

  function cycle(dir: 1 | -1): void {
    if (!items.length) renderList(ctx.state());
    if (!items.length) return;
    const cur = view?.id ?? last;
    const i = items.findIndex((it) => it.id === cur);
    const n = items[(i + dir + items.length) % items.length];
    if (n) show(n.id);
  }

  return {
    id: 'drawer', el, dim, ownsEscape: true,
    onOpen(arg) {
      dim.classList.add('open');
      const a = arg as { id?: string; enterAt?: number } | undefined;
      const id = a?.id ?? last;
      listSig = '';
      if (id) show(id, a?.enterAt); else render();
    },
    onClose() {
      dim.classList.remove('open');
      closeView();
    },
    show,
    lastId: () => view?.id ?? last,
    tick,
    cycle,
    key(e) {
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'PageDown' || e.key === 'PageUp')) { cycle(e.key === 'PageDown' ? 1 : -1); return true; }
      // terminal text size (VS Code style); Cmd+= / Cmd+- on mac are handled by the viewer itself
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !d.platform.mac) {
        if (e.key === '=' || e.key === '+') { fontAction('fontUp'); return true; }
        if (e.key === '-') { fontAction('fontDown'); return true; }
        if (e.key === '0') { fontAction('fontReset'); return true; }
      }
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (!view) { ctx.panels.close(); return true; }
        if (view.historyOpen) return false; // the history overlay closes itself
        const control = view.mode === 'control' && view.life.input === 'send';
        if (control) {
          if (!view.el.contains(e.target as Node)) { view.focus(); return true; }
          return false; // Escape belongs to the agent
        }
        ctx.panels.close();
        return true;
      }
      return false;
    },
  };
}
