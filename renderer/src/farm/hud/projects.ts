/**
 * The Valley Projects board (`projects`; model/projects.ts, docs/valley/projects.md): opened with E on the Mayor's
 * projects board on the square (or `__hud.open('projects', id)`). The left column lists the six projects (status as a
 * glyph and a word, never colour alone: ✓ restored, ▲ ready / to see, ● open with its progress, 🔒 locked); the right
 * page is the selected plan: what's wrong with the place, then one row per need: bits (pay 10, or all you can), finds
 * (a chip per fitting thing in your basket: click to hand one in), real work (counted as your farmers work; never in
 * the demo valley), and the champion's friendship. A finished project offers "Go and see it".
 *
 * Keys: ↑ / ↓ (or 1–6) pick a project, Tab walks the buttons, Esc closes. Toasts and the fanfare for a completed
 * project come from `watchProjects` (bound once in hud.ts).
 */
import './projects.css';
import { GROUP_NAME, PROJECTS, WORK_NAME, fitting, isProjectId, projectDef } from '../model/projects.ts';
import type { GiveResult, Need, ProjectEntry, ProjectId, ProjectsService, ProjectsWorld } from '../model/projects.ts';
import { collectDef } from '../model/collection.ts';
import { friendDef, MAX_HEARTS } from '../model/friends.ts';
import { coins } from '../model/shop.ts';
import { ICONS, svgIcon as S, ITEM_OUTLINE as ol } from './icons.ts';
import { collectIcon } from './collection.ts';
import { portrait } from './friends.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';

/** what the scene publishes for the board (scene/projects: 'projectsScene'), duck-typed */
interface SceneHandle { go(id: string): boolean }

const service = (ctx: HudCtx): ProjectsService | null => { try { return (ctx.b?.service?.('projects') as ProjectsService | undefined) ?? null; } catch { return null; } };
const sceneOf = (ctx: HudCtx): SceneHandle | null => { try { return (ctx.b?.service?.('projectsScene') as SceneHandle | undefined) ?? null; } catch { return null; } };
const worldOf = (ctx: HudCtx): ProjectsWorld => {
  let w: ProjectsWorld = { friends: null, coins: 0, basket: {} };
  try {
    const wal = ctx.b?.wallet?.();
    w = { friends: ctx.b?.friends?.()?.data() ?? null, coins: wal?.coins() ?? 0, basket: wal?.data().basket ?? {} };
  } catch { /* optional */ }
  return w;
};

/** a little drawing per project for the list and the plan */
export const PROJECT_ICON: Readonly<Record<ProjectId, string>> = Object.freeze({
  lanterns: S(`<path d="M11 3.5h2v17h-2z" fill="#7a5236" ${ol}/><path d="M12 5h6" stroke="#3b2a1e" stroke-width="1.6"/><path d="M15.5 7.5h5l.5 1.5v6l-.5 1.5h-5l-.5-1.5V9z" fill="#f6c23e" ${ol}/><path d="M18 10c.9 1.1.9 2.4 0 3.3-.9-.9-.9-2.2 0-3.3z" fill="#e8742c"/><path d="M8.5 20.5h7" stroke="#8a8f96" stroke-width="2.4" stroke-linecap="round"/>`),
  footbridge: S(`<path d="M2 18c3-1.5 6-1.5 10-1.5s7 0 10 1.5" fill="none" stroke="#4aa3c9" stroke-width="2.2" stroke-linecap="round"/><path d="M2.5 13.5c3-3 6-4 9.5-4s6.5 1 9.5 4" fill="none" stroke="#a0703f" stroke-width="2.6" stroke-linecap="round"/><path d="M5 12v4M9 10.2v5.5M15 10.2v5.5M19 12v4" stroke="#6e4a2a" stroke-width="1.5"/><path d="M3 9.8c3-2.6 6-3.6 9-3.6s6 1 9 3.6" fill="none" stroke="#d8c08a" stroke-width="1.2"/>`),
  glasshouse: S(`<path d="M3 20.5v-8l9-7.5 9 7.5v8z" fill="#bfe0ea" ${ol}/><path d="M12 5v15.5M3 13h18M7.5 9v11.5M16.5 9v11.5" stroke="#f3eee2" stroke-width="1.2"/><path d="M3 20.5v-8l9-7.5 9 7.5v8z" fill="none" ${ol}/><circle cx="9.5" cy="17.5" r="1.4" fill="#8e5fc2"/><circle cx="14.5" cy="17" r="1.4" fill="#f08aa8"/>`),
  millwheel: S(`<circle cx="12" cy="12" r="8.5" fill="none" stroke="#a0703f" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="#6e4a2a" ${ol}/><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18" stroke="#a0703f" stroke-width="1.3"/><path d="M2 19.5c3 1.4 6 1.4 10 0s7-1.4 10 0" fill="none" stroke="#4aa3c9" stroke-width="2" stroke-linecap="round"/>`),
  observatory: S(`<path d="M5 21v-9h14v9z" fill="#bab2a2" ${ol}/><path d="M4 12.2a8 7.5 0 0116 0z" fill="#ece9e2" ${ol}/><path d="M12.5 5.5l5.5-3.5" stroke="#d8a843" stroke-width="2.4" stroke-linecap="round"/><path d="M10.5 16h3v5h-3z" fill="#4f8a5a" ${ol}/><circle cx="20" cy="6.5" r=".9" fill="#f6c23e"/><circle cx="4.5" cy="5" r=".7" fill="#f6c23e"/>`),
  halt: S(`<path d="M2 19.5h20" stroke="#5a646e" stroke-width="1.6"/><path d="M3 21h2M8 21h2M14 21h2M19 21h2" stroke="#6e4a2a" stroke-width="1.6"/><path d="M4 17.5h16v-2.5H4z" fill="#c8955a" ${ol}/><path d="M6 15V8.5M14 15V8.5" stroke="#4f8a5a" stroke-width="1.6"/><path d="M4.5 9l5.5-4 5.5 4z" fill="#c2533e" ${ol}/><rect x="15.8" y="10" width="5.2" height="2.6" rx=".4" fill="#f1e3c4" ${ol}/><path d="M18.4 12.6V15" stroke="#3b2a1e" stroke-width="1.2"/>`),
});
const LOCK = S(`<rect x="5.5" y="10.5" width="13" height="10" rx="2" fill="#b39a66" ${ol}/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" fill="none" ${ol} stroke-width="1.8"/><circle cx="12" cy="15.3" r="1.4" fill="#3b2a1e"/>`);
const COIN = S(`<circle cx="12" cy="12" r="8.5" fill="#e8a34a" ${ol}/><circle cx="12" cy="12" r="5.6" fill="none" stroke="#b86e26" stroke-width="1.2"/><path d="M12 15.5v-5M12 10.5c-1.8 0-2.6-1-2.6-2.4 1.8 0 2.6 1 2.6 2.4zM12 10.5c1.8 0 2.6-1 2.6-2.4-1.8 0-2.6 1-2.6 2.4z" stroke="#7a4a1e" stroke-width="1.1" fill="#6cbf55"/>`);
const WORK_ICON = S(`<rect x="3.5" y="7" width="17" height="12" rx="2" fill="#c98a4b" ${ol}/><path d="M9 7V5.2A1.2 1.2 0 0110.2 4h3.6A1.2 1.2 0 0115 5.2V7" fill="none" ${ol}/><path d="M3.5 12h17" stroke="#3b2a1e" stroke-width="1.2"/>`);

const STATUS_WORD = { locked: 'Locked', open: 'Open', done: 'Restored' } as const;
const plural = (n: number, w: readonly [string, string]) => `${n} ${n === 1 ? w[0] : w[1]}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function statusOf(e: ProjectEntry): { glyph: string; word: string; cls: string } {
  if (e.pending) return { glyph: '▲', word: 'Finished: go and see!', cls: 'ready' };
  if (e.status === 'done') return { glyph: '✓', word: STATUS_WORD.done, cls: 'done' };
  if (e.ready) return { glyph: '▲', word: 'Ready!', cls: 'ready' };
  if (e.status === 'locked') return { glyph: '■', word: `After ${e.waiting.map((w) => w.name.replace(/^the /, '')).join(' & ')}`, cls: 'locked' };
  return { glyph: '●', word: `${Math.round(e.progress * 100)}% there`, cls: 'open' };
}

function bar(have: number, need: number): HTMLElement {
  const p = Math.max(0, Math.min(1, need ? have / need : 1));
  const el = h('span.vh-pj-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(need), 'aria-valuenow': String(have) }, h('i', { style: { width: `${Math.round(p * 100)}%` } }));
  if (p >= 1) el.classList.add('full');
  return el;
}

export function createProjectsPanel(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('projects', 'Valley Projects', ICONS.board);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  let sel: ProjectId = 'lanterns', sig = '';
  const list = h('nav.vh-pj-list', { 'aria-label': 'Projects' });
  const page = h('article.vh-pj-page', { 'aria-live': 'polite', 'data-testid': 'project-page' });
  const foot = h('div.vh-pj-foot', { 'data-testid': 'project-purse' });
  const msg = h('div.vh-pj-msg', { role: 'status', 'aria-live': 'polite', 'data-testid': 'project-msg' });
  body.replaceChildren(h('div.vh-pj', null, list, h('div.vh-pj-right', null, page, msg)), foot);

  const said = (r: GiveResult, what: string) => {
    if (r.ok) { msg.textContent = `Thank you! ${what}`; return; }
    msg.textContent = r.reason === 'short' ? 'You don\'t have enough for that yet.' : r.reason === 'full' ? 'That part of the plan is already covered.' : r.reason === 'locked' ? 'That plan waits for another project first.' : r.reason === 'done' ? 'That one is finished!' : 'That doesn\'t fit this plan.';
    ctx.sfx('oops');
  };

  function needRow(e: ProjectEntry, n: Need, w: ProjectsWorld, m: ProjectsService, demo: boolean): HTMLElement {
    const open = e.status === 'open';
    const met = n.have >= n.need;
    const tick = h(`span.vh-pj-tick${met ? '.met' : ''}`, { text: met ? '✓' : '○', 'aria-hidden': 'true' });
    if (n.kind === 'bits') {
      const left = n.need - n.have;
      const acts = h('div.vh-pj-acts');
      if (open && !met) {
        const ten = h('button.vh-btn.small', { type: 'button', text: `Pay ${Math.min(10, left)}`, 'data-testid': 'project-pay', disabled: w.coins < Math.min(10, left) });
        ten.addEventListener('click', () => { const r = m.pay(e.def.id, Math.min(10, left)); if (r.ok) ctx.sfx('coins'); said(r, `${coins(r.ok ? r.n : 0)} toward ${e.def.name}.`); render(true); });
        const all = Math.min(left, w.coins);
        const allBtn = h('button.vh-btn.small', { type: 'button', text: all >= left ? `Pay the rest (${left})` : `Pay what I have (${all})`, 'data-testid': 'project-pay-all', disabled: all <= 0 });
        allBtn.addEventListener('click', () => { const r = m.pay(e.def.id, Math.min(left, worldOf(ctx).coins)); if (r.ok) ctx.sfx('coins'); said(r, `${coins(r.ok ? r.n : 0)} toward ${e.def.name}.`); render(true); });
        acts.append(ten, allBtn);
      }
      return h('div.vh-pj-need', { 'data-testid': 'project-need-bits' }, tick, h('span.ico', { html: COIN }),
        h('div.what', null, h('b', { text: `${n.need} bits` }), h('span.sub', { text: `${n.have} paid in · you have ${coins(w.coins)}` }), bar(n.have, n.need)), acts);
    }
    if (n.kind === 'item') {
      const fits = open && !met ? fitting(n.group, w.basket) : [];
      const acts = h('div.vh-pj-acts.chips');
      for (const f of fits.slice(0, 8)) {
        const d = collectDef(f.id);
        if (!d) continue;
        const b = h('button.vh-pj-chip', { type: 'button', title: `Hand in a ${d.name.toLowerCase()}`, 'aria-label': `Hand in a ${d.name} (${f.n} in your basket)`, 'data-testid': `project-give-${f.id}` },
          h('span.ico', { html: collectIcon(d) }), h('span', { text: d.name }), h('span.n', { text: `×${f.n}` }));
        b.addEventListener('click', () => { const r = m.give(e.def.id, n.group, f.id, 1); if (r.ok) ctx.sfx('pop'); said(r, `${d.name} handed in for ${e.def.name}.`); render(true); });
        acts.append(b);
      }
      const hint = open && !met && !fits.length ? h('span.sub.none', { text: n.group === 'fish' ? 'Nothing in your basket fits: cast a line at the pond or the river.' : n.group === 'boot' ? 'Old boots come up when you fish.' : n.group === 'rare' ? 'Something rare: a koi, a thunder bass, a frost crystal, a glow-cap…' : 'Nothing in your basket fits: look for glints in the grass.' }) : null;
      const label = n.group === 'rare' ? plural(n.need, GROUP_NAME.rare) : n.group === 'boot' ? plural(n.need, GROUP_NAME.boot) : `${plural(n.need, GROUP_NAME[n.group])} (any kind)`;
      return h('div.vh-pj-need', { 'data-testid': `project-need-${n.group}` }, tick, h('span.ico', { html: n.group === 'fish' || n.group === 'boot' ? collectIcon(collectDef(n.group === 'boot' ? 'boot' : 'carp')!) : n.group === 'rare' ? collectIcon(collectDef('koi')!) : collectIcon(collectDef('morel')!) }),
        h('div.what', null, h('b', { text: label }), h('span.sub', { text: `${n.have} of ${n.need} handed in` }), bar(n.have, n.need), hint), acts);
    }
    if (n.kind === 'work') {
      const sub = demo && !met ? 'the demo valley\'s farmers are pretend: only real work counts' : open || met ? 'counts by itself as your farmers work' : 'starts counting once the plan opens';
      return h('div.vh-pj-need', { 'data-testid': `project-need-${n.work}` }, tick, h('span.ico', { html: WORK_ICON }),
        h('div.what', null, h('b', { text: plural(n.need, WORK_NAME[n.work]) }), h('span.sub', { text: `${n.have} of ${n.need} · ${sub}` }), bar(n.have, n.need)));
    }
    const f = friendDef(n.who)!;
    const hearts = h('span.vh-pj-hearts', { 'aria-label': `${n.have} of ${n.need} hearts` });
    for (let i = 0; i < n.need; i++) hearts.append(h(`i${i < n.have ? '.on' : ''}`, { text: '♥' }));
    return h('div.vh-pj-need', { 'data-testid': 'project-need-hearts' }, tick, h('span.ico', { html: portrait(f) }),
      h('div.what', null, h('b', { text: `${f.name} at ♥${n.need}` }), h('span.sub', { text: met ? `${f.short} is behind it` : `${f.short} likes you ♥${n.have} of ${MAX_HEARTS}: chat, gifts and requests help` }), hearts));
  }

  function render(force = false): void {
    const m = service(ctx);
    if (!m) { page.replaceChildren(h('p.vh-pj-note', { text: 'The Mayor is still pinning the plans up. Come back in a moment.' })); return; }
    const w = worldOf(ctx);
    const demo = !!ctx.state()?.demo;
    const v = m.view(w);
    const s = `${m.version}|${w.coins}|${JSON.stringify(w.basket)}|${v.entries.map((e) => e.needs.map((n) => n.have).join(',')).join(';')}|${sel}|${demo}`;
    if (!force && s === sig) return;
    sig = s;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null;
    // the list
    list.replaceChildren(...v.entries.map((e, i) => {
      const st = statusOf(e);
      const b = h(`button.vh-pj-item.${st.cls}${e.def.id === sel ? '.sel' : ''}`, { type: 'button', 'aria-pressed': String(e.def.id === sel), 'data-testid': `project-${e.def.id}`, title: `${i + 1}: ${e.def.title}` },
        h('span.ico', { html: e.status === 'locked' ? LOCK : PROJECT_ICON[e.def.id] }),
        h('span.t', null, h('b', { text: e.def.title }), h('span.st', null, h('span.g', { text: st.glyph, 'aria-hidden': 'true' }), st.word)),
        e.status === 'open' ? bar(Math.round(e.progress * 100), 100) : null);
      b.addEventListener('click', () => { sel = e.def.id; msg.textContent = ''; ctx.sfx('ui-click'); render(true); });
      return b;
    }));
    // the plan
    const e = v.entries.find((x) => x.def.id === sel)!;
    const st = statusOf(e);
    const champ = friendDef(e.def.who)!;
    const head = h('header.vh-pj-head', null, h('span.big', { html: PROJECT_ICON[e.def.id] }),
      h('div', null, h('h3', { text: e.def.title }), h('div.where', { text: cap(e.def.where) }), h(`span.vh-pj-status.${st.cls}`, { 'data-testid': 'project-status' }, h('span.g', { text: st.glyph, 'aria-hidden': 'true' }), st.word)));
    const note = h('p.vh-pj-note', null, e.status === 'done' ? e.def.done : e.def.blurb, h('span.by', { text: ` (${champ.name}'s plan)` }));
    const needs = h('div.vh-pj-needs', null, ...e.needs.map((n) => needRow(e, n, w, m, demo)));
    const unlock = h('div.vh-pj-unlock', null, h('b', { text: e.status === 'done' ? 'Unlocked: ' : 'When it\'s done: ' }), e.def.unlock);
    const kids: (HTMLElement | null)[] = [head, note];
    if (e.status === 'locked') kids.push(h('p.vh-pj-locked', { text: `This plan opens once ${e.waiting.map((x) => x.name).join(' and ')} ${e.waiting.length > 1 ? 'are' : 'is'} restored.` }));
    kids.push(needs, unlock);
    if (e.status === 'done') {
      const when = new Date(e.state.done).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const go = h('button.vh-btn.primary', { type: 'button', 'data-testid': 'project-go' }, e.pending ? 'Go and see it!' : 'Go there');
      go.addEventListener('click', () => { ctx.panels.close(); sceneOf(ctx)?.go(e.def.id); });
      kids.push(h('div.vh-pj-done', null, h('span', { text: `Restored on ${when}.` }), go));
    }
    page.replaceChildren(...kids.filter((x): x is HTMLElement => !!x));
    foot.replaceChildren(h('span', { html: COIN }), `You have ${coins(w.coins)} · ${Object.values(w.basket).reduce((a, n) => a + n, 0)} finds in your basket · ${v.done} of ${v.total} projects restored`);
    // keep keyboard focus on the same control across a re-render
    if (focusKey) (el.querySelector(`[data-testid="${focusKey}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  const step = (d: number) => {
    const i = PROJECTS.findIndex((p) => p.id === sel);
    sel = PROJECTS[(i + d + PROJECTS.length) % PROJECTS.length].id;
    msg.textContent = '';
    render(true);
    (list.querySelector('.sel') as HTMLElement | null)?.focus({ preventScroll: true });
  };

  return {
    id: 'projects', el,
    onOpen(arg) {
      msg.textContent = '';
      if (isProjectId(arg)) sel = arg;
      else {
        // open on the most useful plan: one finished but unseen, else one you can give to, else the first open one
        const v = service(ctx)?.view(worldOf(ctx));
        const pick = v?.entries.find((e) => e.pending) ?? v?.entries.find((e) => e.status === 'open' && e.needs.some((n) => n.have < n.need)) ?? v?.entries.find((e) => e.status === 'open');
        if (pick) sel = pick.def.id;
      }
      render(true);
      (list.querySelector('.sel') as HTMLElement | null)?.focus({ preventScroll: true });
    },
    refresh() { render(); },
    key(e) {
      if (e.key === 'ArrowDown') { step(1); return true; }
      if (e.key === 'ArrowUp') { step(-1); return true; }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= PROJECTS.length && !e.ctrlKey && !e.altKey && !e.metaKey) { sel = PROJECTS[n - 1].id; msg.textContent = ''; render(true); (list.querySelector('.sel') as HTMLElement | null)?.focus({ preventScroll: true }); return true; }
      return false;
    },
  };
}

/** Toasts for the board: a project completed (go and see it), and the unveiling (what it unlocked). */
export function watchProjects(ctx: HudCtx, m: ProjectsService): void {
  m.onChange((c) => {
    if (c.kind === 'complete') {
      const d = projectDef(c.id);
      if (!d) return;
      ctx.toast({ text: `Project complete: ${d.name}!`, sub: `Go and see it (${d.where}) · the board on the square`, icon: PROJECT_ICON[d.id], level: 'good', ms: 9000, key: `project|${d.id}`, group: 'project' });
      ctx.sfx('fanfare');
    } else if (c.kind === 'unveil') {
      const d = projectDef(c.id);
      if (!d) return;
      ctx.toast({ text: `${cap(d.name)} is restored!`, sub: `Unlocked: ${d.unlock}`, icon: PROJECT_ICON[d.id], level: 'good', ms: 8000, key: `unveil|${d.id}`, group: 'project' });
    }
  });
}
