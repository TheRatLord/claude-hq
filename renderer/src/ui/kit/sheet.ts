/**
 * UI kit sheet (`?sheet=ui`, docs/design/ui-kit.md): every kit component in every state, built with the real kit
 * builders, laid over the live game world (the office boots normally behind it; the regular HUD is hidden).
 * Pages (`&page=` or `window.__uiSheet.page(name)`): `board` (scanning surfaces + HUD hardware), `paper` (cards,
 * tickets, forms), `parts` (the parts catalogue: every state side by side). `&lowq=1` shows the Low tier (no noise).
 * Shots: docs/shots/ui-kit/. Owner: UI (kit).
 */
import { h, ICON, type Kid, type PortraitSubject } from '../dom.ts';
import type { Kind, Status } from '../../../../shared/protocol.ts';
import { ENV, UI } from '../../../../shared/palette.ts';
import {
  injectKit, board, paper, plaque, readout, lamp, stateWord, keycap, keys, legend, button, iconButton, groove, stitch,
  slot, detent, modeSwitch, tick, circled, fader, porthole, shield, unread, noteGlyph, gauge, groupHeader, ledger,
  question, stamp, ticket, postit, printout, slip, tally, LAMP, type Lamp,
} from './index.ts';

/** A fake roster entity: just what the kit's portholes, lamps and rows read. */
interface SheetEntity extends PortraitSubject { name: string; kind: Kind; status: Status; workspace: { colorIndex: number } }
const E = (name: string, colorIndex: number, status: Status = 'working', kind: Kind = 'claude', extra: Partial<SheetEntity> = {}): SheetEntity => ({ name, kind, status, workspace: { colorIndex }, ...extra });
const A = {
  flint: E('flint', 2, 'blocked'), lumen: E('lumen', 3, 'blocked'), gale: E('gale', 5), claude2: E('claude·2', 2), onyx: E('onyx', 7),
  tinker: E('tinker', 1, 'done'), dev: E('dev', 2, 'idle', 'shell', { process: { activity: 'prompt' } }), logs: E('logs', 7, 'idle', 'shell', { process: { activity: 'running' } }),
  ada: E('Ada', 0, 'working'),
};
const cap = (text: string) => h('div.cap', { text });

const SHEET_CSS = `
.uks{position:fixed;inset:0;z-index:50;font:13px/1.4 var(--font-ui);color:var(--t1);pointer-events:auto;overflow:hidden}
.uks *{box-sizing:border-box}
.uks .abs{position:absolute}
.uks .cap{font:11px/1.3 var(--font-mono);color:var(--t3);margin-top:8px}
.uks .k-paper .cap{color:var(--p3)}
.uks .row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.uks .col{display:flex;flex-direction:column;gap:10px}
.uks .pad{padding:14px 16px}
.uks .force-focus{outline:2px solid var(--clay-light);outline-offset:2px}
.uks .term{padding:12px 14px;font:13px/1.25 var(--font-mono);color:var(--cream);white-space:pre}
.uks .term .c{color:var(--clay)}.uks .term .g{color:var(--s-done)}.uks .term .d{color:var(--slate)}.uks .term .y{color:var(--butter)}
.uks .ttl{position:absolute;left:50%;top:14px;transform:translateX(-50%)}
.uks .hdr{display:flex;align-items:center;gap:8px;padding:14px 10px 10px 14px}
.uks .mt{margin-top:10px}
`;

// ------------------------------------------------------------------------------------------------ page: board
function pageBoard() {
  const root = h('div');
  // roster board
  const selBlocked = h('div.k-row.sel', null, porthole(A.lumen),
    h('div.main', null, h('div.l1', null, h('span.nm', { text: 'lumen' }), unread(1), h('span.ctx', { text: 'infra › api' })), h('div.l2', { text: 'Edit · server/http.ts' })),
    h('div.side', null, h('span.age.warm', { text: '0:47' }), gauge(41)),
    h('div.under', null, h('div.ask', null, question('Allow this edit to server/http.ts?'),
      ledger(['Yes', 'Yes, allow all edits this session', { label: 'No, tell Claude what to do', note: 'Esc', destructive: true }], { board: true })),
    legend([{ key: 'Enter', label: 'open' }, { key: 'G', label: 'go' }, { key: 'F', label: 'follow' }], { small: true })));
  const row = (e: SheetEntity, ctx: string, l2: string, age: string, o: { cls?: string; compact?: boolean; unread?: number; note?: boolean; age?: string; lamp?: Lamp; gauge?: number } = {}) => h(`div.k-row${o.cls ?? ''}`, null, porthole(e, { size: o.compact ? 'xs' : '' }),
    h('div.main', null, h('div.l1', null, h('span.nm', { text: e.name }), o.unread ? unread(o.unread) : null, o.note ? noteGlyph() : null, h('span.ctx', { text: ctx })), h('div.l2', { text: l2 })),
    h('div.side', null, h(`span.age${o.age ?? ''}`, null, o.lamp ?? null, age), o.gauge != null ? gauge(o.gauge) : null));
  const roster = board({ cls: 'abs' },
    h('div.hdr', null, plaque('Agents'), h('span.k-sp'), iconButton(ICON.compact, { title: 'Compact', key: 'Alt+C' }), iconButton(ICON.pin, { title: 'Keep open', pressed: true }), iconButton(ICON.close, { title: 'Close', key: 'Tab' })),
    h('div', { style: { margin: '0 12px' } }, detent(['State', 'Space', 'Tab', 'Proj', 'Dir', 'Kind', 'Tool'], 'State')),
    h('div', { style: { margin: '10px 12px 0' } }, slot({ placeholder: 'search · is:blocked ws: cwd:', key: '/', search: true })),
    h('div.row', { style: { padding: '11px 14px', gap: '8px', flexWrap: 'nowrap' } }, tick('Blocked', { on: true }), tick('Working', { on: true }), tick('Done', { on: true }), tick('Idle'), tick('Shells', { on: true })),
    groove(),
    h('div', { style: { padding: '2px 0' } },
      groupHeader({ name: 'Blocked', state: 'blocked', count: 2, alarm: true, legend: legend([{ key: 'B', label: 'inbox' }], { small: true }) }),
      row(A.flint, 'hq-core › claude', 'Bash · npm run test:e2e', '4:12', { age: '.hot' }),
      selBlocked,
      groupHeader({ name: 'Working', state: 'working', count: 3 }),
      row(A.gale, 'tinker › orders', 'Read · orders/paginate.ts', '2:05'),
      row(A.claude2, 'hq-core › ui', 'Grep · "roster-row"', '6:51', { note: true, gauge: 86 }),
      groupHeader({ name: 'Idle', state: 'idle', count: 3, expanded: false, summary: 'moss · ledger · quill' }),
      groupHeader({ name: 'Shells', state: 'shell', count: 2 }),
      row(A.dev, 'hq-core', '$ bash', '12m'),
      row(A.logs, 'ops', '$ tail -f /var/log/hq.log', '3m', { lamp: lamp('busy', { size: 'sm' }), age: '', compact: false }),
      h('div.k-row.compact', null, porthole(A.onyx, { size: 'xs' }), h('div.main', null, h('div.l1', null, h('span.nm', { text: 'onyx' }), h('span.ctx', { text: 'compact row · ops › deploy' }))), h('div.side', null, h('span.age', { text: '0:12' }))),
      groupHeader({ label: 'hq-core', lead: shield(2), count: 4 })),
    groove(),
    h('div.row', { style: { padding: '10px 14px 12px', gap: '12px' } }, h('span.k-label', { text: 'Sort' }), h('span.k-t2', { text: 'recent ▾', style: { fontSize: '12px', marginLeft: '-6px' } }), h('span.k-sp'), button('New shell', { key: 'N', small: true }), legend([{ key: '?', label: 'keys' }])));
  Object.assign(roster.style, { left: '22px', top: '22px', width: '360px' });
  root.append(roster);

  // HUD hardware (top strip)
  const t1 = tally({ blocked: 2, working: 3, done: 1, idle: 3, shell: 2 });
  const t2 = tally({ blocked: 0, working: 4, idle: 3 });
  t2.set({ blocked: 0, working: 4, idle: 3 }, 'working');
  const hud = h('div.abs.col', { style: { left: '420px', top: '0', gap: '12px' } }, h('div.row', { style: { gap: '26px', alignItems: 'flex-start' } }, t1.el, t2.el),
    h('div.row', { style: { gap: '10px' } }, plaque('hqtest', { small: true }), plaque('Demo', { small: true, tone: 'butter' }), plaque('default', { small: true, tone: 'slate' }), plaque('Leader ▸', { small: true }),
      h('div.k-board.k-rail', null, iconButton(ICON.sound, { title: 'Sound' }), iconButton(ICON.help, { title: 'Help', key: 'H' }), iconButton(ICON.gear, { title: 'Settings' }))));
  root.append(hud);

  // lamps + readouts + keys + buttons on a board
  const lampGrid = h('div', { style: { display: 'grid', gridTemplateColumns: 'auto auto', gap: '10px 22px' } }, ...Object.keys(LAMP).map((st) => h('div.row', { style: { gap: '12px' } }, lamp(st, { size: 'sm' }), lamp(st), lamp(st, { size: 'lg' }), stateWord(st))));
  const parts = board({ cls: 'abs pad' },
    h('div.row', { style: { alignItems: 'flex-start', gap: '26px' } },
      h('div', null, lampGrid, cap('lamps sm / row / lg + state word')),
      h('div.col', null,
        h('div.row', null, readout('1 BLOCKED', { lamp: 'blocked' }).el, readout('3/7', { color: ENV.butter, pitch: 2.2 }).el, readout('12', { color: UI.onBoard.blocked, pitch: 2.7 }).el),
        cap('readouts: drawer counter · triage progress · HUD digit'),
        h('div.row', null, keycap('O'), keycap('0'), keycap('I'), keycap('1'), keycap('Enter'), keycap('Esc'), keys('Mod+K'), keys('Leader'), keys(['1', '–', '9']), keycap('S', { small: true })),
        legend([{ key: 'Z', label: 'full' }, { key: '[', label: 'history' }, { key: 'U', label: 'next blocked' }], { leader: true }),
        h('div.row', null, button('Send', { key: 'Enter', primary: true }), button('New shell', { key: 'N' }), button('Back'), button('Disabled', { key: 'D', disabled: true })),
        h('div.row', null, modeSwitch({ left: 'Peek', right: 'Control', value: 'left' }), modeSwitch({ left: 'Peek', right: 'Control', value: 'right' }), (() => { const b = button('Focused', { key: 'F' }); b.classList.add('force-focus'); return b; })()),
        h('div.row', null, gauge(41), gauge(86), unread(1), unread(5), unread(12), noteGlyph(), shield(0), shield(3), shield(5)))));
  Object.assign(parts.style, { left: '420px', top: '150px', width: '700px' });
  root.append(parts);
  const tri = readout('3/7', { color: ENV.butter, pitch: 2.2 });

  // triage board
  const triage = board({ cls: 'abs pad' },
    h('div.row', { style: { marginBottom: '14px', gap: '12px' } }, plaque('Triage'), tri.el, h('span.k-sp'),
      legend([{ key: ['1', '–', '3'], label: 'answer' }, { key: 'ArrowRight', label: 'skip' }, { key: 'O', label: 'terminal' }, { key: 'Esc', label: 'done' }])),
    h('div.row', { style: { alignItems: 'flex-start', gap: '18px', flexWrap: 'nowrap' } },
      printout(['● Update(server/http.ts)', '  └  Updated server/http.ts with 6 additions', "     42 +  app.post('/api/act', auth, act)", '', '● Edit(server/http.ts)', '  ❯ 1. Yes']),
      h('div', { style: { flex: '1', minWidth: '0' } }, h('div.k-who', null, porthole(A.lumen, { size: 'lg' }), h('div', null, h('div.nm', { text: 'lumen' }), h('div.sub', null, shield(3), 'infra › api · waiting ', h('span.k-mono', { text: '0:47', style: { color: 'var(--b-blocked)' } })))),
        h('div', { style: { margin: '14px 0 8px' } }, question('Allow this edit to server/http.ts?')),
        ledger(['Yes', 'Yes, allow all edits', { label: 'No, tell Claude', note: 'Esc', destructive: true }], { board: true, selected: 1 }))));
  Object.assign(triage.style, { left: '420px', top: '672px', width: '700px' });
  root.append(triage);

  // drawer (right)
  const tab = (e: SheetEntity, on: boolean, o: { state?: string; unread?: boolean } = {}) => h(`div.k-tab${on ? '.on' : ''}`, null, porthole(e, { size: 'xs' }), e.name, lamp(o.state ?? e.status, { size: 'sm' }), o.unread ? unread(1) : null,
    h('span.x', { html: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3 3 9"/></svg>' }));
  const counter = readout('1 BLOCKED', { lamp: 'blocked' });
  const crt = h('div.k-crt', { style: { margin: '0 14px', height: '360px' } }, plaque('History', { small: true, tone: 'butter' }),
    h('div.term', { html: '<span class="c">▐▛███▜▌</span>   Claude Code\n<span class="c">▝▜█████▛▘</span>  ~/code/hq-core/server\n\n<span class="d">&gt;</span> run the e2e suite and fix whatever breaks\n\n<span class="g">●</span> Bash(npm run test:e2e)\n  <span class="d">└</span>  ✓ roster opens with Tab (212 ms)\n     ✗ drawer keeps focus after fit (timeout)\n\n<span class="y">╭──────────────────────────────────────────╮</span>\n<span class="y">│</span> Do you want to proceed?                  <span class="y">│</span>\n<span class="y">│</span> <span class="c">❯ 1. Yes</span>                                 <span class="y">│</span>\n<span class="y">│</span>   2. No, tell Claude what to do (esc)    <span class="y">│</span>\n<span class="y">╰──────────────────────────────────────────╯</span>' }));
  const drawer = board({ cls: 'abs' },
    h('div.k-tabs', { style: { borderRadius: '12px 12px 0 0' } }, tab(A.flint, true), tab(A.lumen, false, { unread: true }), tab(A.dev, false, { state: 'shell' }), h('span.k-sp'),
      h('span', { style: { marginBottom: '9px', display: 'flex', gap: '8px', alignItems: 'center' } }, counter.el, keys(['Leader', 'U'], { small: true }))),
    h('div.row', { style: { padding: '12px 14px 11px 18px', flexWrap: 'nowrap' } },
      h('div', { style: { minWidth: '0' } }, h('div.k-crumb', null, shield(2), h('span.dim', { text: 'hq-core' }), h('span.sep', { text: '›' }), h('span.dim', { text: 'claude' }), h('span.sep', { text: '›' }), 'flint'),
        h('div.k-cwd', null, '~/code/hq-core/server', gauge(58, { suffix: 'context' }), h('span.herdr', { text: '◆ in herdr' }))),
      h('span.k-sp'), modeSwitch({ left: 'Peek', right: 'Control' }),
      h('div.row', { style: { gap: '2px' } }, iconButton(ICON.copy, { title: 'Copy recent' }), iconButton(ICON.history, { title: 'History' }), iconButton(ICON.expand, { title: 'Fullscreen' }), iconButton('<svg viewBox="0 0 20 20"><circle cx="5" cy="10" r=".9"/><circle cx="10" cy="10" r=".9"/><circle cx="15" cy="10" r=".9"/></svg>', { title: 'More' }))),
    crt,
    h('div.k-strip', { style: { padding: '10px 14px 0' } }, postit('Pane is 120×44, drawer fits 96×38: text is scaled to 11 px.', { action: 'Fit pane to drawer', key: 'F' })),
    h('div.row', { style: { height: '52px', padding: '0 14px 0 18px', flexWrap: 'nowrap' } },
      h('span.k-mode', null, lamp('peek', { size: 'sm', label: 'Peek' }), 'Peek'), h('span.k-t3', { text: '· type to take control', style: { fontSize: '12px', whiteSpace: 'nowrap' } }),
      legend([{ key: 'Z', label: 'full' }, { key: '[', label: 'history' }], { leader: true, small: true }), h('span.k-sp'),
      ticket({ line: true, state: 'blocked', elapsed: '0:03', headline: 'claude·2 is blocked' })));
  Object.assign(drawer.style, { left: '1160px', top: '22px', width: '738px' });
  root.append(drawer);

  // HUD hardware bottom-right: minimap, chevrons, aim tag, hotbar
  const map = h('div.k-frame.abs', { style: { left: '1160px', top: '690px', width: '196px', height: '156px' } },
    h('div.k-graph', { html: '<svg viewBox="0 0 180 140" width="100%" height="100%"><g fill="none" stroke="var(--ink2)" stroke-width="2" stroke-linecap="round"><rect x="6" y="6" width="168" height="128" rx="2"/><path d="M6 46h40M46 6v26M46 42v50M6 92h40M120 6v30M120 46v40M120 96v38M120 70h54"/></g><circle cx="30" cy="26" r="3.4" fill="var(--s-working)"/><circle cx="148" cy="30" r="3.4" fill="var(--s-done)"/><circle cx="30" cy="112" r="3.6" fill="var(--s-blocked)"/><path d="M78 118l6-14 6 14-6-4Z" fill="var(--clay)" stroke="var(--clay-deep)"/></svg>' }),
    h('span.tape', { style: { left: '-6px', top: '2px', transform: 'rotate(-32deg)' } }), h('span.tape', { style: { right: '-8px', top: '4px', transform: 'rotate(30deg)' } }), plaque('Lobby', { small: true }));
  root.append(map);
  root.append(h('div.abs.col', { style: { left: '1390px', top: '700px', gap: '14px', alignItems: 'flex-start' } },
    h('button.k-chev', null, lamp('blocked'), 'moss', h('span.t', { text: '2:31' })),
    h('button.k-chev.right', null, lamp('blocked'), 'quill', h('span.t', { text: '0:12' })),
    h('div.row', { style: { gap: '18px' } }, h('div', { style: { position: 'relative', width: '30px', height: '30px' } }, h('div.k-xhair', { style: { left: '15px', top: '15px' } })),
      paper({ cls: 'k-aimtag' }, keycap('E'), h('b', { text: 'flint' }), h('span.verb', { text: 'answer' })))));
  const holes: (SheetEntity | null)[] = [A.flint, A.lumen, A.gale, A.dev, A.tinker, null, null, null, null];
  root.append(h('div.k-hotbar.abs', { style: { left: '1160px', top: '880px' } }, ...holes.map((e, i) => (e
    ? h(`button.k-cubby${i === 0 ? '.sel' : ''}`, null, keycap(String(i + 1)), porthole(e), lamp(e.kind === 'shell' ? 'shell' : e.status, { label: '' }))
    : h('div.k-cubby.empty', null, keycap(String(i + 1)))))));
  return root;
}

// ------------------------------------------------------------------------------------------------ page: paper
function pagePaper() {
  const root = h('div');
  // blocked status card (clip)
  const card = paper({ clip: true, tilt: true },
    h('div.k-who', null, porthole(A.flint, { size: 'lg' }), h('div', null, h('div.nm', { text: 'flint' }), h('div.sub', null, shield(2), 'hq-core › claude · Bash')), stamp('Waiting', { time: '4:12' })),
    h('div', { style: { margin: '16px 0 8px' } }, question('Run `npm run test:e2e --grep "keeps focus"`?')),
    ledger(['Yes', "Yes, don't ask again for npm run", { label: 'No, tell Claude what to do', note: 'Esc', destructive: true }]),
    h('div.k-confirm', null, h('span.say', { html: 'Send <b>“1. Yes”</b> to flint?' }), h('span.k-sp'), button('Back'), button('Send', { key: 'Enter', primary: true })),
    h('div.k-foot', null, legend([{ key: 'O', label: 'terminal' }, { key: 'G', label: 'go there' }, { key: 'ArrowRight', label: 'next' }, { spacer: true }, { key: 'Esc' }])));
  card.sheet.style.padding = '26px 20px 14px';
  root.append(h('div.abs', { style: { left: '30px', top: '24px', width: '404px' } }, card));

  // working status card
  const specs = h('dl.k-specs', null, h('dt', { text: 'Todo' }), h('dd', { text: '3 of 7 · fix the fit handler' }), h('dt', { text: 'Context' }), h('dd', null, gauge(58)),
    h('dt', { text: 'Subagents' }), h('dd', { text: '2 running' }), h('dt', { text: 'Last prompt' }), h('dd', { text: '“run the e2e suite and fix…”' }), h('dt', { text: 'Note' }), h('dd', { text: 'ask before touching CI' }));
  const card2 = paper({ clip: true },
    h('div.k-who', null, porthole(A.gale, { size: 'lg' }), h('div', null, h('div.nm', { text: 'gale' }), h('div.sub', null, shield(5), 'tinker › orders · Read')), stateWord('working', { text: 'Working 2:05' })),
    h('div.k-title', { text: 'Paginate the orders API', style: { marginTop: '14px' } }), h('div.k-mono.k-p2', { text: 'Read · orders/paginate.ts', style: { fontSize: '12px', margin: '2px 0 12px' } }),
    stitch(), h('div', { style: { marginTop: '12px' } }, specs),
    h('div.k-foot', null, legend([{ key: 'O', label: 'terminal' }, { key: 'T', label: 'talk' }, { key: 'G', label: 'go there' }])));
  card2.sheet.style.padding = '26px 20px 14px';
  root.append(h('div.abs', { style: { left: '30px', top: '560px', width: '404px' } }, card2));

  // inbox (clip + deck, paper detent)
  const inbox = paper({ clip: true, deck: 2 },
    h('div.row', { style: { marginBottom: '14px', flexWrap: 'nowrap' } }, plaque('Inbox'), h('div', { style: { flex: '1' } }, detent(['Blocked 2', 'Done 1', 'Triage'], 'Blocked 2'))),
    h('div.k-who', null, porthole(A.lumen, { size: 'lg' }), h('div', null, h('div.nm', { text: 'lumen' }), h('div.sub', null, shield(3), 'infra › api · 1 of 2')), stamp('Waiting', { time: '0:47' })),
    h('div', { style: { margin: '16px 0 8px' } }, question('Allow this edit to server/http.ts?')),
    ledger(['Yes', 'Yes, allow all edits this session', { label: 'No, tell Claude what to do', note: 'Esc', destructive: true }], { selected: 2 }),
    h('div.k-foot', null, legend([{ key: ['1', '–', '3'], label: 'answer' }, { key: 'ArrowRight', label: 'next' }, { key: 'O', label: 'terminal' }])));
  inbox.sheet.style.padding = '30px 20px 14px';
  root.append(h('div.abs', { style: { left: '480px', top: '24px', width: '470px' } }, inbox));

  // tickets
  root.append(h('div.abs.col', { style: { left: '480px', top: '560px', gap: '16px' } },
    ticket({ state: 'blocked', elapsed: '0:45', caption: 'No. 0412 · 14:02 · infra › api', headline: 'lumen is blocked', text: 'Allow this edit to server/http.ts?', legend: legend([{ key: 'B', label: 'inbox' }, { key: ['Leader', 'U'], label: 'jump' }]) }),
    ticket({ state: 'done', elapsed: '9:40', caption: 'No. 0413 · 14:05 · tinker › orders', headline: 'gale is done', text: 'Finished paginating the orders API.', legend: legend([{ key: 'S', label: 'sign off' }, { key: 'Enter', label: 'open' }]) }),
    h('div', { style: { width: '376px' } }, ticket({ line: true, state: 'done', elapsed: '0:03', headline: 'tinker is done' }))));

  // slip + offline notice + post-it
  root.append(h('div.abs', { style: { left: '1000px', top: '24px', width: '440px' } },
    slip({ span: '14:02 – 14:39', lines: [
      { state: 'blocked', name: 'flint', text: 'asked to run the e2e suite', time: '4:12' },
      { state: 'done', name: 'tinker', text: 'listed the files and said hello', time: '1:02' },
      { state: 'done', name: 'gale', text: 'finished paginating the orders API', time: '9:40' }],
    actions: [button('Dismiss', { key: 'Esc' }), button('Open oldest blocked', { key: 'Enter', primary: true })] })));
  const offline = paper({ cls: 'abs' }, h('div.row', { style: { padding: '12px 14px', flexWrap: 'nowrap' } }, lamp('idle', { size: 'lg' }),
    h('div', { style: { flex: '1' } }, h('b', { text: 'herdr offline' }), h('div.k-p2', { text: 'Agents are dozing. Start it, or run with --demo.', style: { fontSize: '12px' } })), button('Retry', { key: 'R' })));
  root.append(offline);
  offline.style.cssText = 'left:1000px;top:318px;width:440px';
  root.append(h('div.abs', { style: { left: '1000px', top: '410px', width: '440px' } }, postit('Fit pane to drawer?', { key: 'F' })));

  // prompt bar
  const promptBar = paper({ cls: 'abs' }, h('div.row', { style: { height: '56px', padding: '0 14px', flexWrap: 'nowrap' } }, plaque('To', { small: true }), porthole(A.claude2, { size: 'xs' }), h('b', { text: 'claude·2' }),
    h('div', { style: { flex: '1' } }, slot({ voice: true, value: 'also cover the compact rows' })), legend([{ key: 'Enter', label: 'send' }])));
  root.append(promptBar);
  promptBar.style.cssText = 'left:1000px;top:470px;width:640px';

  // palette index card
  const it = (lead: Kid, nm: Kid, ctx?: string, right?: Kid, sel?: boolean) => h(`div.it${sel ? '.k-hl' : ''}`, null, lead, nm, ctx ? h('span.ctx', { text: ctx }) : null, h('span.k-sp'), right ?? null);
  const nm = (m: string, rest: string) => h('span.nm', null, h('mark.k-match', { text: m }), rest);
  const pal = paper({ cls: 'k-index abs' },
    h('div.top', { html: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>' }),
    h('div.sec', { text: 'Agents' }),
    it(porthole(A.flint, { size: 'xs' }), nm('fl', 'int'), 'hq-core › claude', h('span.row', { style: { gap: '14px' } }, stateWord('blocked', { text: 'Blocked 4:12', still: true }), legend([{ key: 'Enter', label: 'open' }], { small: true })), true),
    it(porthole(E('flake-hunter', 5), { size: 'xs' }), nm('fl', 'ake-hunter'), 'tinker › ci', stateWord('working')),
    h('div.sec', { text: 'Actions' }),
    it(h('span.ic', { html: ICON.check }), h('span.nm', null, 'Sign off all done ', h('span.aside', { text: '· 2 agents' }))),
    h('div.foot', null, legend([{ key: 'Enter', label: 'open' }, { key: 'Shift+Enter', label: 'go to' }, { key: ['ArrowUp', 'ArrowDown'], label: 'select' }, { spacer: true }, { key: 'Tab', label: 'scope' }])));
  const top = pal.querySelector('.top');
  if (!top) throw new Error('palette card lost its .top row');
  const inp = h('input', { value: 'fl', 'aria-label': 'search' });
  top.append(inp, detent(['Find', 'Go', 'Do'], 'Find'), keycap('Esc'));
  pal.style.cssText = 'left:1000px;top:560px';
  root.append(pal);
  return root;
}

// ------------------------------------------------------------------------------------------------ page: parts (forms, help, onboarding, catalogue)
function pageParts() {
  const root = h('div');
  // hire work order
  const hire = paper({ clip: true },
    h('div.row', { style: { justifyContent: 'space-between' } }, plaque('Hire'), stamp('Ready', { ink: 'ready' })),
    h('label.k-field', null, h('span.k-label', { text: 'Kind' }), circled(['claude', 'codex', 'gemini', 'shell'], 'claude')),
    h('div.k-field', null, h('span.k-label', { text: 'Workspace' }), ledger([{ label: 'hq-core', note: '4 agents', lead: shield(2) }, { label: 'infra', note: '2 agents', lead: shield(3) }, { label: 'tinker', note: '1 agent', lead: shield(5) }], { numbered: false })),
    h('div.k-field', null, h('span.k-label', { text: 'Task' }), slot({ value: 'fix the flaky fit test' })),
    h('div.k-field', null, tick('Open its terminal after hiring', { on: true })),
    h('div.k-foot.row', { style: { justifyContent: 'flex-end', gap: '10px' } }, button('Cancel', { key: 'Esc' }), button('Hire', { key: 'Enter', primary: true })));
  hire.sheet.style.padding = '30px 24px 18px';
  root.append(h('div.abs', { style: { left: '30px', top: '24px', width: '430px' } }, hire));
  // locked variant
  const locked = paper({ cls: 'abs pad' }, h('div.row', null, plaque('Hire'), stamp('Locked', { ink: 'locked' }), h('span.k-p3', { text: 'allowMutations is off (server config)', style: { fontSize: '12px' } })));
  root.append(locked);
  locked.style.cssText += ';left:30px;top:600px;width:430px';

  // settings
  const settings = paper({ cls: 'abs' }, h('div', { style: { padding: '22px 24px 18px' } },
    h('div.row', { style: { justifyContent: 'space-between' } }, plaque('Settings'), legend([{ key: 'Esc', label: 'close' }])),
    h('div.k-field', null, h('span.k-label', { text: 'Quality' }), circled(['Low', 'Medium', 'High', 'Auto'], 'Medium')),
    h('div.k-field', null, h('span.k-label', { text: 'Terminal font' }), fader(14, { min: 10, max: 20, format: (v) => `${v} px`, label: 'Terminal font' })),
    h('div.k-field', null, h('span.k-label', { text: 'Master volume' }), fader(70, { format: (v) => `${v}%`, label: 'Volume' })),
    h('div', { style: { margin: '16px 0 4px' } }, stitch()),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginTop: '12px' } },
      tick('Copy on select', { on: true }), tick('Confirm Ctrl+C in Peek', { on: true }), tick('Quick answer (Alt+1–9)'), tick('Reduced motion'), tick('Head bob'), tick('Sign off on open', { on: true })),
    h('div', { style: { margin: '16px 0 4px' } }, stitch()),
    h('div.k-field', null, h('span.k-label', { text: 'Leader key' }), h('div', { style: { width: '160px' } }, slot({ value: 'Ctrl+`' }))),
    h('div.k-field', null, tick('Allow mutations', { aside: 'server · set in server config' }))));
  settings.style.cssText = 'left:490px;top:24px;width:440px';
  root.append(settings);

  // help: board holding paper sheets side by side
  const kl = (k: string | string[], v: string) => h('div.k-kl', null, h('span.ks', null, keys(k)), v);
  const help = board({ cls: 'abs' },
    h('div.row', { style: { padding: '16px 18px 14px', flexWrap: 'nowrap' } }, plaque('Keys · world'), h('span.k-sp'), h('div', { style: { width: '360px' } }, detent(['World', 'Roster', 'Serve', 'Terminal'], 'World'))),
    h('div.k-sheets', { style: { padding: '0 18px 18px' } },
      paper({}, h('h4', { text: 'Move' }), kl(['W', 'A', 'S', 'D'], 'walk'), kl('Shift', 'run'), kl('M', 'map overview'), kl('Mod+K', 'palette')),
      paper({}, h('h4', { text: 'Agents' }), kl('E', 'open terminal'), kl('B', 'inbox'), kl('Tab', 'roster'), kl(['1', '–', '9'], 'pinned')),
      paper({}, h('h4', { text: 'Terminal · Ctrl ` then' }), kl('I', 'take control'), kl('Z', 'fullscreen'), kl('U', 'next blocked'), kl('[', 'history'))));
  help.style.cssText = 'left:960px;top:24px;width:930px';
  root.append(help);

  // onboarding
  const onb = paper({ cls: 'abs' }, h('div', { style: { padding: '18px 20px 16px' } },
    h('div.row', { style: { alignItems: 'flex-start', flexWrap: 'nowrap' } }, porthole(A.ada, { size: 'lg' }),
      h('div', { style: { flex: '1' } }, plaque('Ada says', { tone: 'clay' }),
        h('p.k-voice', { style: { margin: '12px 0 0', fontSize: '16.5px', lineHeight: '1.4' } }, 'When a Clawd raises a red flag, it\'s waiting on you. Press ', keycap('B'), ' and answer it from anywhere.'))),
    h('div.row', { style: { marginTop: '16px', gap: '8px' } }, lamp('seen', { size: 'sm', label: 'seen' }), lamp('seen', { size: 'sm', label: 'seen' }), lamp('seen', { size: 'sm', label: 'seen' }), lamp('idle', { size: 'sm' }), lamp('idle', { size: 'sm' }),
      h('span.k-sp'), button('Skip tour', { key: 'Esc' }), button('Next', { key: 'Enter', primary: true }))));
  onb.style.cssText = 'left:960px;top:330px;width:520px';
  root.append(onb);

  // paper catalogue: stamps, selectors, identity on paper
  const cat = paper({ cls: 'abs pad' },
    h('div.row', null, stamp('Waiting', { time: '0:45' }), stamp('Signed off', { ink: 'done' }), stamp('Locked', { ink: 'locked' }), stamp('Ready', { ink: 'ready' })),
    h('div.row.mt', null, ...['blocked', 'working', 'done', 'idle', 'busy', 'unknown'].map((s) => stateWord(s))),
    h('div.row.mt', null, gauge(41), gauge(86), unread(3), keycap('O'), keycap('0'), keys('Mod+K'), button('Plain', { key: 'P' }), button('Disabled', { disabled: true })),
    h('div.row.mt', null, porthole(A.flint, { size: 'lg' }), porthole(A.lumen), porthole(A.gale), porthole(A.dev), porthole(A.tinker, { size: 'xs' }), shield(0), shield(1), shield(4), shield(6), shield(7)),
    h('div.mt', null, slot({ placeholder: 'empty slot on paper' })),
    cap('paper: stamps · state words (onPaper ink) · gauge · keys · buttons · portholes (workspace rim) · shields · slot'));
  cat.style.cssText = 'left:960px;top:560px;width:560px';
  root.append(cat);

  // board catalogue: selectors + focus
  const b2 = board({ cls: 'abs pad' },
    detent(['State', 'Space', 'Tab', 'Proj'], 'Space'),
    h('div.row.mt', null, tick('On', { on: true }), tick('Off'), (() => { const t = tick('Focused', { on: true }); t.classList.add('force-focus'); return t; })()),
    h('div.mt', null, slot({ placeholder: 'recessed slot', key: '/', search: true })),
    h('div.mt', null, ledger(['Yes', 'No'], { board: true })),
    cap('board: detent · ticks (on / off / focus) · slot · ledger'));
  b2.style.cssText = 'left:1550px;top:560px;width:340px';
  root.append(b2);
  return root;
}

const PAGES: Record<string, () => HTMLElement> = { board: pageBoard, paper: pagePaper, parts: pageParts };

export interface UiSheet { page(name: string): string | undefined; pages: string[] }
declare global { interface Window { __uiSheet?: UiSheet } }

/**
 * Mount the sheet over the running office. `params` is what main.ts parsed (it carries no `page`; the page comes from
 * the query string or `window.__uiSheet.page(name)`).
 */
export function runUiSheet({ root, quality }: { root: HTMLElement; params?: unknown; quality?: { tier: string; onChange?: (fn: () => void) => void } }): UiSheet {
  injectKit({ quality });
  const q = new URLSearchParams(location.search);
  if (q.get('lowq') === '1') document.documentElement.classList.add('hq-lowq');
  root.style.visibility = 'hidden'; // the regular HUD/roster; the kit sheet replaces it on screen
  const style = h('style', { text: SHEET_CSS });
  document.head.append(style);
  const layer = h('div.uks', { 'data-sheet': 'ui' });
  document.body.append(layer);
  const page = (name: string) => {
    const fn = PAGES[name] ?? PAGES.board;
    layer.replaceChildren(fn());
    layer.dataset.page = PAGES[name] ? name : 'board';
    return layer.dataset.page;
  };
  page(q.get('page') ?? 'board');
  const sheet: UiSheet = { page, pages: Object.keys(PAGES) };
  window.__uiSheet = sheet;
  return sheet;
}
