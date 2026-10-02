/**
 * Harvest recaps in the HUD (model/recap.ts records them): what an agent just did, at a glance.
 *
 *  - **The postcard** (`createRecapPanel`, panel `recap`): a side sheet like the farmer card. Headline, when / how long,
 *    the task, the agent's closing message, then the facts (commits, lines, tests, todos ticked off, spend, context,
 *    the branch it left), and the actions: Open terminal (T), View changes (D: a read-only diffstat + per-file list
 *    from the server's `git.diff`; Enter on a file shows its patch), the farmer card (C), Walk there. ←/→ (or [ / ])
 *    page through that farmer's older / newer recaps.
 *  - **The card's "Last harvest"** (`createHarvestSection`): the newest recap's headline and facts line, then the
 *    history (up to RECAP_KEEP rows); each opens the postcard. R in the card opens the newest.
 *  - **The notification** (`harvestToast`): a calm toast when a stretch ends ("flint harvested: 2 commits · +120 −30 ·
 *    42 min"), upgrading the farmer's "finished" toast in place when one is showing; clicking it opens the postcard.
 */
import type { DiffResult } from '../../../../shared/protocol.ts';
import type { Recap } from '../model/recap.ts';
import { recapDiffQuery, recapDur, recapHeadline, recapLine } from '../model/recap.ts';
import { costLabel, tokensLabel } from '../model/signals.ts';
import { mascotOf } from '../model/mascots.ts';
import { farmerFace, ICONS, LETTER_ICON, icon } from './icons.ts';
import { ago, pct, seedHue, shortName } from './format.ts';
import { framePanel, h, typingIn, type HudCtx, type Panel, type ToastSpec } from './ctx.ts';
import { diffHeader, fileRow, patchClass, recapWhen } from './recapfmt.ts';
import './recap.css';

const recapsOf = (ctx: HudCtx, id: string): readonly Recap[] => ctx.state()?.recaps?.farmers.get(id) ?? [];
const findRecap = (ctx: HudCtx, key: string): Recap | null => {
  const at = key.lastIndexOf('@');
  return recapsOf(ctx, key.slice(0, at)).find((r) => r.key === key) ?? null;
};

/** the facts as small chips (commits, lines, tests, todos, time) for a compact row */
function chips(r: Recap): HTMLElement {
  const c = h('span.vh-rc-chips');
  if (r.commits.length) c.append(h('span.c.ship', { text: `${r.commits.length} commit${r.commits.length === 1 ? '' : 's'}` }));
  if (r.lines) c.append(h('span.c', null, h('b.add', { text: `+${r.lines.added}` }), ' ', h('b.del', { text: `−${r.lines.removed}` })));
  const runs = r.tests.pass + r.tests.fail;
  if (runs) c.append(h(`span.c.${r.tests.last === 'fail' ? 'red' : 'green'}`, { text: r.tests.last === 'fail' ? 'tests red' : 'tests green' }));
  c.append(h('span.c.t', { text: recapDur(r.to - r.from) }));
  return c;
}

/** Open the postcard for a recap key (or a farmer's newest). */
export function openRecap(ctx: HudCtx, keyOrFarmer: string): boolean {
  const r = keyOrFarmer.includes('@') ? findRecap(ctx, keyOrFarmer) : recapsOf(ctx, keyOrFarmer)[0] ?? null;
  if (!r) return false;
  ctx.panels.open('recap', r.key);
  return true;
}

/** The toast when a stretch ends; it replaces that farmer's "finished" toast if it is still up. */
export function harvestToast(ctx: HudCtx, push: (t: ToastSpec, bg?: boolean) => void, key: string): void {
  const r = findRecap(ctx, key);
  if (!r) return;
  const f = ctx.farmer(r.farmerId);
  const who = f ? shortName(f) : r.tag;
  // while a big panel is up only asks and errors pop (the recap waits in the card, the ledger and the mailbox)
  if (ctx.panels.modal && !ctx.panels.current()?.light) return;
  push({
    text: `${who}: ${recapHeadline(r).toLowerCase().replace(/^./, (c) => c.toUpperCase())}`, sub: recapLine(r),
    icon: r.commits.length ? LETTER_ICON.commit : LETTER_ICON.finished, level: r.tests.last === 'fail' ? 'warn' : 'good',
    key: `harvest|${r.key}`, group: 'harvest', replaceKey: `finished|${r.farmerId}`, ms: 7000,
    open: () => ctx.panels.open('recap', r.key), openTitle: 'Open the harvest recap',
  }, true);
}

/** The farmer card's "Last harvest" section: newest recap + history; repaints on the recaps' rev. */
export function createHarvestSection(ctx: HudCtx): { el: HTMLElement; update(id: string): void } {
  const el = h('section.vh-harvest', { 'data-testid': 'card-harvest', 'aria-label': 'Last harvest' });
  let sig = '';
  function update(id: string): void {
    const list = recapsOf(ctx, id);
    const nsig = `${id}|${list.map((r) => r.key).join(',')}|${Math.floor(Date.now() / 60_000)}`;
    if (nsig === sig) return;
    sig = nsig;
    if (!list.length) { el.replaceChildren(); el.hidden = true; return; }
    el.hidden = false;
    const [last, ...older] = list;
    el.replaceChildren(
      h('div.vh-h3', { style: { fontSize: '14px' } }, icon(LETTER_ICON.finished), 'Last harvest', h('kbd.vh-k', { text: 'R', title: 'R opens it' })),
      h('button.vh-rc-last', { type: 'button', 'data-testid': 'card-harvest-open', title: 'Open the harvest recap (R)', onclick: () => ctx.panels.open('recap', last.key) },
        h('span.hd', null, h('b', { text: recapHeadline(last) }), h('span.when', { text: ago(last.to, Date.now()) })),
        last.title ? h('span.tt', { text: last.title }) : null,
        chips(last)),
      ...(older.length ? [h('ul.vh-rc-hist', { 'aria-label': 'Earlier harvests' }, ...older.map((r) => h('li', null,
        h('button', { type: 'button', 'data-testid': 'card-harvest-row', title: recapLine(r), onclick: () => ctx.panels.open('recap', r.key) },
          h('span.when', { text: ago(r.to, Date.now()) }), h('span.tt', { text: r.title ?? recapHeadline(r) }), chips(r)))))] : []));
  }
  return { el, update };
}

export function createRecapPanel(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('recap', 'Harvest', LETTER_ICON.finished);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  el.setAttribute('aria-label', 'Harvest recap');
  let key: string | null = null;
  let sig = '';
  // the diff: fetched on demand per recap; one file's patch at a time
  let diffFor: string | null = null;
  let diff: { state: 'loading' | 'ok' | 'error'; d?: DiffResult; error?: string } | null = null;
  let openFile: string | null = null;
  let patch: { path: string; state: 'loading' | 'ok' | 'error'; text?: string; truncated?: boolean; error?: string } | null = null;
  const diffEl = h('section.vh-rc-diff', { 'data-testid': 'recap-diff', 'aria-label': 'Changes', 'aria-live': 'polite' });

  const cur = (): Recap | null => (key ? findRecap(ctx, key) : null);

  async function loadDiff(r: Recap): Promise<void> {
    const q = recapDiffQuery(r);
    diffFor = r.key; openFile = null; patch = null;
    if (!q) { diff = { state: 'error', error: 'This farmer was not working in a git repository.' }; paintDiff(); return; }
    if (!ctx.b?.agents.diff) { diff = { state: 'error', error: 'Diffs are not available here.' }; paintDiff(); return; }
    if (!ctx.farmer(r.farmerId) && !ctx.helper(r.farmerId)) { diff = { state: 'error', error: `${r.tag} went home: the diff is read through their terminal's repository.` }; paintDiff(); return; }
    diff = { state: 'loading' }; paintDiff();
    const res = await ctx.b.agents.diff(r.farmerId, q).catch((e: unknown) => ({ ok: false, error: String(e), diff: undefined }));
    if (diffFor !== r.key) return;
    diff = res.ok && res.diff ? { state: 'ok', d: res.diff } : { state: 'error', error: res.error ?? 'no diff' };
    paintDiff();
  }

  async function loadPatch(r: Recap, path: string): Promise<void> {
    const q = recapDiffQuery(r);
    if (!q || !ctx.b?.agents.diff) return;
    if (openFile === path) { openFile = null; patch = null; paintDiff(); return; }
    openFile = path; patch = { path, state: 'loading' }; paintDiff(path);
    const res = await ctx.b.agents.diff(r.farmerId, { ...q, path }).catch((e: unknown) => ({ ok: false, error: String(e), diff: undefined }));
    if (openFile !== path || diffFor !== r.key) return;
    const p = res.ok ? res.diff?.patch : null;
    patch = p ? { path, state: 'ok', text: p.text, truncated: p.truncated } : { path, state: 'error', error: res.error ?? 'no patch' };
    paintDiff(path);
  }

  function paintDiff(focusPath?: string): void {
    const r = cur();
    if (!r || diffFor !== r.key || !diff) { diffEl.replaceChildren(); diffEl.hidden = true; return; }
    diffEl.hidden = false;
    if (diff.state === 'loading') { diffEl.replaceChildren(h('div.vh-rc-note', { text: 'Reading the repository…' })); return; }
    if (diff.state === 'error' || !diff.d) { diffEl.replaceChildren(h('div.vh-rc-note.err', { 'data-testid': 'recap-diff-error', text: diff.error ?? 'No diff' })); return; }
    const d = diff.d;
    const head = diffHeader(d);
    const biggest = Math.max(1, ...d.files.map((f) => (f.added ?? 0) + (f.removed ?? 0)));
    const list = h('ul.vh-rc-files', { 'aria-label': 'Changed files' });
    for (const f of d.files) {
      const row = fileRow(f, biggest);
      const isOpen = openFile === f.path;
      const btn = h('button.vh-rc-file', {
        type: 'button', 'data-testid': 'recap-file', 'data-path': f.path, 'aria-expanded': String(isOpen),
        title: `${f.path}${f.from ? ` (from ${f.from})` : ''} · ${row.status} · Enter shows the patch`,
        onclick: () => void loadPatch(r, f.path),
      }, h(`span.st.s-${f.status === '?' ? 'u' : f.status}`, { text: f.status, 'aria-label': row.status }),
      h('span.p', null, h('span.dir', { text: row.dir }), h('span.nm', { text: row.name })),
      h('span.n', { text: row.counts }),
      h('span.bar', { 'aria-hidden': 'true' }, h('i.a', { style: { width: pct(row.share * ((f.added ?? 0) / Math.max(1, (f.added ?? 0) + (f.removed ?? 0)))) } }), h('i.d', { style: { width: pct(row.share * ((f.removed ?? 0) / Math.max(1, (f.added ?? 0) + (f.removed ?? 0)))) } })));
      const li = h('li', null, btn);
      if (isOpen && patch) {
        if (patch.state === 'loading') li.append(h('div.vh-rc-note', { text: 'Loading the patch…' }));
        else if (patch.state === 'error') li.append(h('div.vh-rc-note.err', { text: patch.error ?? 'No patch' }));
        else {
          const pre = h('pre.vh-rc-patch', { 'data-testid': 'recap-patch', tabindex: '0', 'aria-label': `Patch of ${f.path}` });
          for (const line of (patch.text ?? '').replace(/\n$/, '').split('\n')) pre.append(h(`span.${patchClass(line)}`, { text: `${line}\n` }));
          li.append(pre);
          if (patch.truncated) li.append(h('div.vh-rc-note', { text: 'Cut short: open the terminal for the whole file.' }));
          if (!patch.text) li.append(h('div.vh-rc-note', { text: 'No textual changes (binary, or a mode change).' }));
        }
      }
      list.append(li);
    }
    diffEl.replaceChildren(
      h('div.vh-rc-dh', null, h('b', { 'data-testid': 'recap-diff-stat', text: head.stat }), h('span', { text: head.range })),
      d.files.length ? list : h('div.vh-rc-note', { text: 'No changes in that range (already reverted, or committed elsewhere).' }),
      ...(d.more ? [h('div.vh-rc-note', { text: `…and ${d.more} more file${d.more === 1 ? '' : 's'}.` })] : []));
    if (focusPath) diffEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusPath)}"]`)?.focus({ preventScroll: true });
  }

  function render(force = false): void {
    const r = cur();
    const nsig = r ? `${r.key}|${Math.floor(Date.now() / 60_000)}|${!!ctx.farmer(r.farmerId)}|${recapsOf(ctx, r.farmerId).length}` : 'none';
    if (!force && nsig === sig) return;
    sig = nsig;
    if (!r) { body.replaceChildren(h('div.vh-empty', null, icon(LETTER_ICON.finished), 'That harvest is no longer in the ledger.')); return; }
    // a minute tick rebuilds the sheet: keep the keyboard where it was
    const act = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement : null;
    const refocus = act ? (act.dataset.path ? `[data-path="${CSS.escape(act.dataset.path)}"]` : act.dataset.testid ? `[data-testid="${CSS.escape(act.dataset.testid)}"]` : null) : null;
    const f = ctx.farmer(r.farmerId);
    const list = recapsOf(ctx, r.farmerId);
    const i = list.findIndex((x) => x.key === r.key);
    const face = h('div.face');
    face.innerHTML = f ? farmerFace(seedHue(f.seed), mascotOf(f.kind, f.vendor), f.tier) : ICONS.hand;
    const kids: (Node | null)[] = [];
    kids.push(h('div.hero', null, face, h('div', null,
      h('div.nm', { text: f ? shortName(f) : r.tag, 'data-testid': 'recap-name' }),
      h('div.hl', { 'data-testid': 'recap-headline', text: recapHeadline(r) }),
      h('div.sub', { text: recapWhen(r, Date.now(), ago) }))));
    if (list.length > 1) {
      kids.push(h('div.vh-rc-pager', null,
        h('button.vh-btn.small', { type: 'button', disabled: i >= list.length - 1, 'data-testid': 'recap-older', title: 'Older harvest (←)', onclick: () => go(1) }, '← Older'),
        h('span', { text: `${i + 1} of ${list.length}` }),
        h('button.vh-btn.small', { type: 'button', disabled: i <= 0, 'data-testid': 'recap-newer', title: 'Newer harvest (→)', onclick: () => go(-1) }, 'Newer →')));
    }
    if (r.title) kids.push(h('div.task', null, h('b', { text: 'Task: ' }), r.title));
    if (r.said) kids.push(h('blockquote.vh-said.vh-rc-said', { 'data-testid': 'recap-said', text: r.said }));
    const grid = h('div.grid', { 'data-testid': 'recap-facts' });
    if (r.commits.length) {
      grid.append(h('span.lab', { text: 'Shipped' }), h('ul.vh-rc-commits', { 'data-testid': 'recap-commits' }, ...[...r.commits].reverse().map((c) =>
        h('li', { title: c.msg }, c.sha ? h('code', { text: c.sha.slice(0, 7) }) : null, h('span', { text: c.msg })))));
    }
    if (r.lines) grid.append(h('span.lab', { text: 'Lines' }), h('div', null, h('b.add', { text: `+${r.lines.added}` }), ' ', h('b.del', { text: `−${r.lines.removed}` }), ` · ${r.lines.files} file${r.lines.files === 1 ? '' : 's'} edited`));
    const runs = r.tests.pass + r.tests.fail;
    if (runs) grid.append(h('span.lab', { text: 'Tests' }), h('div', { 'data-testid': 'recap-tests' }, h(`span.vh-pill.${r.tests.last === 'fail' ? 'red' : 'green'}`, { text: r.tests.last === 'fail' ? 'Red at the end' : 'Green at the end' }),
      ` ${runs} run${runs === 1 ? '' : 's'}${r.tests.fail ? ` · ${r.tests.fail} red` : ''}`));
    if (r.errors) grid.append(h('span.lab', { text: 'Errors' }), h('div', { text: `${r.errors} tool error${r.errors === 1 ? '' : 's'}` }));
    if (r.todos && (r.todos.done.length || r.todos.total)) {
      grid.append(h('span.lab', { text: 'Todos' }), h('div', null, h('div', { text: `${r.todos.done.length} ticked off${r.todos.open ? ` · ${r.todos.open} still open` : ''}` }),
        r.todos.done.length ? h('ul.vh-todos', { 'aria-label': 'Todos done' }, ...r.todos.done.map((t) => h('li.done', null, h('i', { 'aria-hidden': 'true', text: '✓' }), h('span', { text: t })))) : null));
    }
    if (r.spend && r.spend.tokens) grid.append(h('span.lab', { text: 'Spent' }), h('div', { 'data-testid': 'recap-spend', title: 'Tokens and an estimated cost (list prices) of this stretch\'s model calls' },
      `${r.partial ? 'at least ' : ''}${costLabel(r.spend.cost) ? `${costLabel(r.spend.cost)} · ` : ''}${tokensLabel(r.spend.tokens)} tokens`));
    if (r.context != null) grid.append(h('span.lab', { text: 'Context' }), h('div', { text: `${pct(r.context)} full at the end${r.contextTokens ? ` · ${tokensLabel(r.contextTokens)} tokens` : ''}` }));
    if (r.git) {
      const left = [r.git.dirty ? `${r.git.dirty} file${r.git.dirty === 1 ? '' : 's'} left uncommitted` : 'clean tree', r.git.ahead ? `${r.git.ahead} to push` : ''].filter(Boolean).join(' · ');
      grid.append(h('span.lab', { text: 'Branch' }), h('div.vh-repo', null, h('code', { text: r.git.branch ?? 'detached' }), h('span', { text: ` · ${left}` })));
    }
    if (r.model) grid.append(h('span.lab', { text: 'Model' }), h('div', { text: r.model }));
    if (grid.childElementCount) kids.push(grid);
    if (r.partial) kids.push(h('div.vh-rc-note', { text: 'The valley joined this stretch midway: spend and commits before then are not counted.' }));
    const canDiff = !!recapDiffQuery(r);
    kids.push(h('div.acts', null,
      h('button.vh-btn.primary', { type: 'button', 'data-autofocus': '', 'data-testid': 'recap-terminal', disabled: !f, onclick: () => ctx.openTerminal(r.farmerId) }, icon(ICONS.terminal), 'Open terminal', h('kbd.vh-k', { text: 'T' })),
      h('button.vh-btn', { type: 'button', 'data-testid': 'recap-view-diff', disabled: !canDiff, 'aria-expanded': String(diffFor === r.key), title: canDiff ? 'A read-only diffstat of what changed (D)' : 'Not in a git repository', onclick: () => toggleDiff() }, icon(ICONS.eye), diffFor === r.key ? 'Hide changes' : 'View changes', h('kbd.vh-k', { text: 'D' })),
      h('button.vh-btn', { type: 'button', disabled: !f, 'data-testid': 'recap-card', onclick: () => ctx.panels.open('card', r.farmerId) }, icon(ICONS.hand), 'Farmer card', h('kbd.vh-k', { text: 'C' })),
      h('button.vh-btn', { type: 'button', disabled: !f, onclick: () => { ctx.travel(r.farmerId); ctx.panels.close(); } }, icon(ICONS.walk), 'Walk there')));
    kids.push(diffEl);
    body.replaceChildren(...kids.filter((k): k is Node => !!k));
    paintDiff();
    if (refocus) el.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
  }

  function toggleDiff(): void {
    const r = cur();
    if (!r) return;
    if (diffFor === r.key) { diffFor = null; diff = null; openFile = null; patch = null; render(true); return; }
    void loadDiff(r);
    render(true);
  }
  function go(dir: 1 | -1): void {
    const r = cur();
    if (!r) return;
    const list = recapsOf(ctx, r.farmerId);
    const n = list[list.findIndex((x) => x.key === r.key) + dir];
    if (!n) return;
    key = n.key; diffFor = null; diff = null; openFile = null; patch = null;
    ctx.sfx('page');
    render(true);
    el.querySelector<HTMLElement>(dir > 0 ? '[data-testid="recap-older"]:not(:disabled)' : '[data-testid="recap-newer"]:not(:disabled)')?.focus({ preventScroll: true });
  }

  return {
    id: 'recap', el, light: true,
    // arg: a recap key, a farmer id (their newest), or { key, diff: true } to open with the changes showing
    onOpen(arg) {
      const a = arg && typeof arg === 'object' ? arg as { key?: string; diff?: boolean } : { key: typeof arg === 'string' ? arg : undefined };
      const k = a.key ?? '';
      const r = k.includes('@') ? findRecap(ctx, k) : recapsOf(ctx, k)[0] ?? null;
      if (key !== (r?.key ?? null)) { diffFor = null; diff = null; openFile = null; patch = null; }
      key = r?.key ?? null;
      render(true);
      if (a.diff && r && diffFor !== r.key) toggleDiff();
    },
    onClose() { openFile = null; patch = null; },
    refresh: () => render(),
    key(e) {
      if (typingIn(e.target) || e.ctrlKey || e.altKey || e.metaKey) return false;
      const r = cur();
      if (!r) return false;
      if (e.code === 'KeyT') { if (ctx.farmer(r.farmerId)) ctx.openTerminal(r.farmerId); return true; }
      if (e.code === 'KeyD') { if (recapDiffQuery(r)) toggleDiff(); return true; }
      if (e.code === 'KeyC') { if (ctx.farmer(r.farmerId)) ctx.panels.open('card', r.farmerId); return true; }
      if (e.key === 'ArrowLeft' || e.key === '[') { go(1); return true; }
      if (e.key === 'ArrowRight' || e.key === ']') { go(-1); return true; }
      return false;
    },
  };
}
