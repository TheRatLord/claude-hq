/**
 * Farmer card (talking to a farmer in the valley, or C in the ledger) and scarecrow card. A side sheet that keeps the
 * valley visible: who they are, what they're doing, progress, last words, and the actions — terminal, answers,
 * acknowledge, or a new prompt for an idle farmer (with a confirmation step).
 */
import type { FarmerView, HelperView } from '../model/types.ts';
import { farmerFace, ICONS, KIND_ICON, LETTER_ICON, icon } from './icons.ts';
import { ago, altName, shortName, dur, HELPER_LABEL, JOB_LABEL, JOB_REAL, kindLine, nice, pct, seedHue, STATUS_LABEL } from './format.ts';
import { framePanel, h, typingIn, type HudCtx, type Panel } from './ctx.ts';

export function createCard(ctx: HudCtx): Panel & { showFarmer(id: string): void; showHelper(id: string): void } {
  const { el, body, closeBtn } = framePanel('card', 'Farmer', ICONS.hand);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const plaqueText = el.querySelector('.vh-plaque span:last-child') as HTMLElement;
  const plaqueIco = el.querySelector('.vh-plaque .vh-ico') as HTMLElement;
  let id: string | null = null;
  let sig = '';
  let draft = '';
  let confirming = false;
  let sending = false;

  function farmerView(f: FarmerView): void {
    const s = ctx.state()!;
    const plot = s.plots.get(f.plotId);
    plaqueText.textContent = 'Farmer';
    plaqueIco.innerHTML = ICONS.hand;
    const face = h('div.face'); face.innerHTML = farmerFace(seedHue(f.seed), f.kind, f.tier);
    const kids: (Node | null)[] = [];
    kids.push(h('div.hero', null, face, h('div', null,
      h('div.nm', { text: shortName(f), 'data-testid': 'card-name', title: shortName(f) }),
      h('div.sub', null, `${kindLine(f)} · `, plot ? icon(KIND_ICON[plot.kind]) : null, ` ${plot?.label ?? ''}${altName(f) ? ` · ${altName(f)}` : ''}`),
      h(`span.vh-pill.st-${f.status}`, { text: f.unseenDone ? 'Done — not yet reviewed' : STATUS_LABEL[f.status] }),
      h('span.vh-muted', { text: `  for ${dur(s.now - f.lastActive)}`, style: { fontSize: '12px', fontWeight: '700' } }))));
    if (f.needsYou) {
      kids.push(h('div.vh-ask', null, h('div.q', { text: f.question ?? 'Waiting for your answer' }),
        h('div.opts', null, ...f.options.map((o, i) => h('button.vh-btn.gold.answer', {
          type: 'button', 'data-testid': 'card-answer',
          onclick: async () => { if (await ctx.answer(f.id, o.key, o.label)) ctx.panels.close(); },
        }, h('span.num', { text: String(i + 1) }), h('span.lab', { text: o.label }))))));
    }
    kids.push(h('div.job', null, `${JOB_LABEL[f.job]}${f.detail && !f.needsYou ? ` · ${f.detail}` : ''}`, h('small', { text: `${JOB_REAL[f.job]} · since ${ago(f.jobSince, s.now)}` })));
    if (f.title) kids.push(h('div.task', null, h('b', { text: 'Task: ' }), f.title));
    const grid = h('div.grid');
    if (f.todos && f.todos.total) {
      const r = f.todos.done / f.todos.total;
      grid.append(h('span.lab', { text: 'Todos' }), h('div', null, h('div.vh-bar', null, h('i', { style: { width: pct(r) } })),
        h('div', { text: `${f.todos.done}/${f.todos.total}${f.todos.current ? ` · ${f.todos.current}` : ''}`, style: { fontSize: '12px', marginTop: '2px' } })));
    }
    if (f.work && (f.work.added || f.work.removed || f.work.files)) {
      grid.append(h('span.lab', { text: 'Lines' }), h('div', null, h('span', { text: `+${f.work.added}`, style: { color: '#3f7f2c' } }), ' ', h('span', { text: `−${f.work.removed}`, style: { color: '#b0402f' } }), ` · ${f.work.files} file${f.work.files === 1 ? '' : 's'}`));
    }
    if (f.context != null) {
      grid.append(h('span.lab', { text: 'Context' }), h('div', null, h(`div.vh-bar${f.context > 0.85 ? '.hot' : f.context > 0.65 ? '.warn' : ''}`, { title: `${pct(f.context)} of the context window` }, h('i', { style: { width: pct(f.context) } }))));
    }
    if (f.struggle) grid.append(h('span.lab', { text: 'Mood' }), h('div', { text: ['', 'a little stuck', 'struggling', 'badly stuck'][f.struggle] }));
    if (grid.childElementCount) kids.push(grid);
    if (f.said) kids.push(h('div.vh-said', { text: f.said }));
    if (f.ducklings.length) kids.push(h('div', null, h('div.vh-h3', { style: { fontSize: '14px' } }, icon(ICONS.duck), `Ducklings (${f.ducklings.filter((d) => d.active).length} out)`),
      h('div.vh-ducks', null, ...f.ducklings.map((d) => h(`span${d.active ? '' : '.off'}`, { title: `${d.type}: ${d.label}` }, icon(ICONS.duck), d.label || d.type)))));
    const acts = h('div.acts', null,
      h('button.vh-btn.primary', { type: 'button', 'data-autofocus': '', 'data-testid': 'card-terminal', onclick: () => ctx.openTerminal(f.id) }, icon(ICONS.terminal), 'Open terminal', h('kbd.vh-k', { text: 'T' })),
      h('button.vh-btn', { type: 'button', onclick: () => { ctx.travel(f.id); ctx.panels.close(); } }, icon(ICONS.walk), 'Walk there'));
    if (f.unseenDone) acts.append(h('button.vh-btn', { type: 'button', 'data-testid': 'card-ack', onclick: () => { ctx.b?.agents.ack(f.id); ctx.sfx('chime-done'); ctx.toast({ text: `Thanked ${shortName(f)}`, sub: 'marked as reviewed', level: 'good', icon: ICONS.check }); ctx.panels.close(); } }, icon(ICONS.check), 'Acknowledge', h('kbd.vh-k', { text: 'A' })));
    kids.push(acts);
    if ((f.status === 'idle' || f.status === 'done') && !f.needsYou) kids.push(promptBox(f));
    body.replaceChildren(...kids.filter((k): k is Node => !!k));
  }

  function promptBox(f: FarmerView): HTMLElement {
    const ta = h('textarea', { placeholder: `Ask ${shortName(f)} to do something next…`, 'aria-label': `New prompt for ${shortName(f)}`, rows: '2', 'data-testid': 'card-prompt' });
    ta.value = draft;
    const row = h('div.row');
    const renderRow = () => {
      row.replaceChildren();
      if (confirming) {
        row.append(h('span.confirm', { text: `Send this to ${shortName(f)}'s terminal?` }),
          h('button.vh-btn.small', { type: 'button', onclick: () => { confirming = false; renderRow(); ta.focus(); } }, 'Cancel'),
          h('button.vh-btn.small.primary', { type: 'button', disabled: sending, onclick: () => void send() }, icon(ICONS.send), sending ? 'Sending…' : 'Yes, send'));
      } else {
        row.append(h('span.vh-muted', { text: 'Ctrl+Enter to send', style: { flex: '1', fontSize: '12px', fontWeight: '700' } }),
          h('button.vh-btn.small', { type: 'button', disabled: !ta.value.trim(), onclick: () => { if (ta.value.trim()) { confirming = true; renderRow(); } } }, icon(ICONS.send), 'Send prompt…'));
      }
    };
    const send = async () => {
      const text = ta.value.trim();
      if (!text || sending || !ctx.b) return;
      sending = true; renderRow();
      const r = await ctx.b.agents.prompt(f.id, text).catch((e: unknown) => ({ ok: false, error: String(e) }));
      sending = false; confirming = false;
      if (r.ok) { draft = ''; ta.value = ''; ctx.toast({ text: `Sent to ${shortName(f)}`, sub: text, level: 'good', icon: ICONS.send }); ctx.panels.close(); }
      else { ctx.toast({ text: `Couldn't reach ${shortName(f)}`, sub: r.error ?? 'unknown error', level: 'error' }); renderRow(); }
    };
    ta.addEventListener('input', () => { draft = ta.value; if (confirming) confirming = false; renderRow(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); if (confirming) void send(); else if (ta.value.trim()) { confirming = true; renderRow(); } }
    });
    renderRow();
    return h('div.vh-prompt-box', null, h('div.vh-h3', { style: { fontSize: '14px' } }, icon(ICONS.send), 'Give a new task'), ta, row);
  }

  function helperView(hp: HelperView): void {
    const s = ctx.state()!;
    const plot = s.plots.get(hp.plotId);
    const e = ctx.d.net.entity(hp.id);
    plaqueText.textContent = 'Scarecrow';
    plaqueIco.innerHTML = ICONS.scarecrow;
    const face = h('div.face'); face.innerHTML = ICONS.scarecrow;
    const kids: (Node | null)[] = [
      h('div.hero', null, face, h('div', null,
        h('div.nm', { text: shortName(hp) }),
        h('div.sub', null, 'Shell · ', plot ? icon(KIND_ICON[plot.kind]) : null, ` ${plot?.label ?? ''}`),
        h('span.vh-pill', { text: hp.running ? 'Lantern lit · running' : 'Resting', style: { background: hp.running ? '#d9a520' : '#b09a78' } }))),
      h('div.job', null, `${HELPER_LABEL[hp.activity]}${hp.label ? ` · ${hp.label}` : ''}`, h('small', { text: e?.cwd ?? '' })),
    ];
    const grid = h('div.grid');
    if (e?.process?.argv) grid.append(h('span.lab', { text: 'Process' }), h('code', { text: e.process.argv, style: { fontSize: '12px', overflowWrap: 'anywhere' } }));
    if (hp.exit) grid.append(h('span.lab', { text: 'Last exit' }), h('div', null, h('span.vh-pill', { text: hp.exit === 'ok' ? 'OK' : `Failed${e?.process?.exit ? ` (${e.process.exit.code})` : ''}`, style: { background: hp.exit === 'ok' ? '#5fae45' : '#d0584a' } }), e?.process?.exit?.summary ? ` ${e.process.exit.summary}` : ''));
    if (hp.ports.length) grid.append(h('span.lab', { text: 'Ports' }), h('div', { text: hp.ports.map((p) => `:${p}`).join('  ') }));
    if (e?.res) grid.append(h('span.lab', { text: 'Using' }), h('div', { text: `${Math.round(e.res.cpu)}% CPU · ${Math.round(e.res.rssMB)} MB` }));
    if (grid.childElementCount) kids.push(grid);
    if (e?.process?.lastLine) kids.push(h('div.vh-said', { text: e.process.lastLine, style: { fontStyle: 'normal', fontFamily: 'ui-monospace, "DejaVu Sans Mono", monospace', fontSize: '12.5px' } }));
    kids.push(h('div.acts', null,
      h('button.vh-btn.primary', { type: 'button', 'data-autofocus': '', onclick: () => ctx.openTerminal(hp.id) }, icon(ICONS.terminal), 'Open shell', h('kbd.vh-k', { text: 'T' })),
      h('button.vh-btn', { type: 'button', onclick: () => { ctx.travel(hp.id); ctx.panels.close(); } }, icon(ICONS.walk), 'Walk there')));
    body.replaceChildren(...kids.filter((k): k is Node => !!k));
  }

  function render(): void {
    const s = ctx.state();
    if (!s || !id) return;
    const f = s.farmers.get(id), hp = s.helpers.get(id);
    const nsig = f ? JSON.stringify([f.status, f.job, f.detail, f.title, f.needsYou, f.unseenDone, f.question, f.options, f.todos, f.work, Math.round((f.context ?? 0) * 50), f.said, f.ducklings, Math.floor((s.now - f.lastActive) / 60000)])
      : hp ? JSON.stringify(hp) : 'gone';
    if (nsig === sig) return;
    // don't rebuild under the user's typing
    if (el.contains(document.activeElement) && document.activeElement?.tagName === 'TEXTAREA' && f && !f.needsYou) return;
    sig = nsig;
    if (f) farmerView(f);
    else if (hp) helperView(hp);
    else body.replaceChildren(h('div.vh-empty', null, icon(LETTER_ICON.left), 'They went home.'));
  }

  const show = (x: string) => { if (id !== x) { draft = ''; confirming = false; } id = x; sig = ''; render(); };
  return {
    id: 'card', el, light: true,
    onOpen(arg) { if (typeof arg === 'string') show(arg); },
    onClose() { confirming = false; },
    refresh: render,
    key(e) {
      if (!id || typingIn(e.target) || e.ctrlKey || e.altKey || e.metaKey) return false;
      const f = ctx.farmer(id);
      if (e.code === 'KeyT') { ctx.openTerminal(id); return true; }
      if (e.code === 'KeyA' && f?.unseenDone) { (el.querySelector('[data-testid="card-ack"]') as HTMLButtonElement | null)?.click(); return true; }
      if (f?.needsYou && /^Digit[1-9]$/.test(e.code)) {
        const o = f.options[Number(e.code.slice(5)) - 1];
        if (o) { void ctx.answer(f.id, o.key, o.label).then((ok) => { if (ok) ctx.panels.close(); }); return true; }
      }
      return false;
    },
    showFarmer: (x) => ctx.panels.open('card', x),
    showHelper: (x) => ctx.panels.open('card', x),
  };
}
