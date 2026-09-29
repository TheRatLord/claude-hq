/**
 * Status card (§8 table; UI kit §5.4 "a clipboard sheet"): bottom-right of the world strip, when aiming at an agent
 * within 6 m or when one is selected. One clipped paper sheet:
 * - head (`k-who`): porthole (workspace rim, live clay portrait) · name · `shield ws › tab · kind`; the state is a
 *   lamp + word with its time, or the `WAITING 4:12` stamp when blocked (`SIGNED OFF` when acked);
 * - working / done / idle: the task title in the agent's serif voice, the struggle reason (busy lamp), `tool · detail`
 *   in mono, the last assistant text (2 lines, serif), a stitch, then a spec list: Todo `n/N ▶ …`, Work `+120 −34 ·
 *   5 files · 12m on task`, Context (a plain readout `44 % · 88k of 200k`, "compaction soon" past 85 %), Subagents,
 *   You said (only without text);
 * - blocked: the question (`k-q`) and the options as the ledger, long labels wrapping to 2 lines (click → the inbox's
 *   one-line confirm; world Alt+1–9 only with `quickAnswer`, §4.8);
 * - foot: ONE legend strip on one line (≤ 3 entries, each clickable: B/Alt+n answer · E terminal · T talk · G), plus
 *   `Sign off` as the sheet's one primary when done. F follow stays a world key (help / palette); "Mark seen in herdr"
 *   lives in the drawer's menu (E, then the ⋯ menu).
 * ≤ 10 Hz, diffed by a content key; the clock ticks in place. cardModel.ts holds the wording (M3.5 v2).
 * Owner: UI.
 */
import { h, setText, cls, workspaceHex } from './dom.ts';
import { attachPortrait } from '../chars/render/portraits.ts'; // [CHR M3.5, cross-owner UI edit]
import { taskLabel } from '../../../shared/task.ts';
import { cardRows, questionText } from './serveModel.ts';
import { elapsedLabel, stateKey, tildePath, type StateKey } from './roster/model.ts';
import { waitClock } from '../../../shared/clock.ts'; // [FX fix r1]
import { AT_LEAST, UNKNOWN_TIP } from './help.ts';
import { statusCardGeometry, CARD_MARGIN_PX } from './layout.ts';
import { todoLine, workLine, ctxInfo, stuckLine, readyNudge, lastTextLine, CTX_WINDOW } from './cardModel.ts'; // M3.5 status card v2
import { paper, porthole, shield, stamp, stateWord, stitch, ledger, question, button, type Stamp } from './kit/index.ts';
import { actLegend, injectCardStyles } from './cards.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Store } from '../net/store.ts';
import type { Platform } from './platform.ts';
import type { Settings } from '../core/settings.ts';

export const STATUS_CARD_AIM_M = 6;
export { COMPACT_STRIP_PX, RETICLE_CLEAR_PX, statusCardGeometry } from './layout.ts';

/** Lamp state of an entity (a shell running a process = the amber busy lamp). */
const lampOf = (e: Entity, st: StateKey): StateKey | 'busy' => (st === 'shell' && e.process?.argv ? 'busy' : st);

export interface StatusCardDeps {
  root: HTMLElement;
  store: Pick<Store, 'now'>;
  platform: Pick<Platform, 'mac'>;
  settings: Pick<Settings, 'get'>;
  label?: (e: Entity) => string;
  hooks: {
    option(id: string, row: number): void; open(id: string): void; signOff(id: string): void;
    markSeen(id: string): void; follow(id: string): void; inbox(id: string): void; talk?(id: string): void;
  };
}

export function createStatusCard(d: StatusCardDeps) {
  injectCardStyles();
  const { store, hooks } = d;
  const port = porthole(null, { size: 'lg' });
  const pt = port.inner;
  const nm = h('div.nm');
  const crest = h('span');
  const crumb = h('span.cr');
  const sub = h('div.sub', null, crest, crumb);
  const when = h('span.when'); // lamp + word + time, or the stamp
  const inInbox = h('span.inb', { text: 'answering in the inbox ↑', hidden: true });
  const nmRow = h('div.nmrow', null, nm);
  const idBox = h('div', null, nmRow, sub);
  const who = h('div.k-who', null, port, idBox, when, inInbox);
  const title = h('div.ti.k-title');
  const stuck = h('div.stuck');
  const tool = h('div.tool');
  const lt = h('div.lt'); // M3.5: the last assistant text, 2 lines
  const rule = stitch();
  const specs = h('dl.k-specs');
  const blk = h('div.blk');
  const foot = h('div.k-foot');
  const sheet = paper({ clip: true });
  sheet.sheet.append(who, title, stuck, tool, lt, rule, specs, blk, foot);
  const el = h('section.hq-scard.hq-cards', { 'aria-label': 'Agent status', 'aria-live': 'off' }, sheet);
  el.addEventListener('mousedown', (ev) => { if (!(ev.target instanceof Element && ev.target.closest('button,li,.act'))) ev.preventDefault(); });
  d.root.append(el);

  let shownId: string | null = null;
  let key = '';
  /** the portrait currently drawn in `pt` (id|status|kind) */
  let ptKey: string | undefined;
  /** the pieces of `when` that tick without a rebuild */
  let tick: { t: HTMLElement | null; stamp: Stamp | null; k: string } = { t: null, stamp: null, k: '' };

  function show(e: Entity, via: 'aim' | 'select') {
    const now = store.now();
    const st = stateKey(e);
    const age = now - (e.statusSince || now);
    const wk = e.work;
    const blocked = e.status === 'blocked';
    const acked = e.status === 'done' && e.ack;
    // cheap identity of what is drawn (elapsed ticks at 1 s; 'on task' at 1 min)
    const k = [e.id, e.status, e.ack ? 1 : 0, e.kind, d.label ? d.label(e) : e.name, e.workspace?.colorIndex, e.tab?.label, e.title, e.activity?.tool, e.activity?.detail,
      e.contextTokens, e.subagents?.length, e.lastPrompt, e.lastText, JSON.stringify(e.todos ?? null), e.prompt?.hash, e.process?.activity, e.process?.argv, e.modelTier,
      wk ? `${wk.added}|${wk.removed}|${wk.files}|${Math.floor((now - (wk.since || now)) / 60000)}` : '', e.struggle ? `${e.struggle.level}|${e.struggle.reason}|${e.struggle.detail}` : '',
      via, d.settings.get('quickAnswer') ? 1 : 0].join('|');
    // the state clock ticks without rebuilding the card (the ledger stays put under the pointer)
    const clock = blocked ? waitClock(age, e.statusSinceApprox) : `${e.statusSinceApprox ? '≥ ' : ''}${elapsedLabel(age)}`;
    const wk2 = `${st}|${lampOf(e, st)}|${blocked}|${acked}|${e.process?.activity ?? ''}`;
    if (tick.k !== wk2) {
      tick = { t: null, stamp: null, k: wk2 };
      // a stamp sits at the sheet's top-right; a lamp + word + time is the third line under the name
      if (blocked) { tick.stamp = stamp('Waiting', { time: clock }); when.replaceChildren(tick.stamp); }
      else if (acked) when.replaceChildren(stamp('Signed off', { ink: 'done' }));
      else {
        const ls = lampOf(e, st);
        const verb = String(e.process?.activity ?? 'Running');
        tick.t = h('span.t');
        when.replaceChildren(stateWord(ls, ls === 'busy' ? { text: verb[0].toUpperCase() + verb.slice(1) } : {}), tick.t);
      }
      const inline = !blocked && !acked;
      cls(when, 'line', inline);
      if (inline && when.parentNode !== idBox) idBox.append(when);
      else if (!inline && when.parentNode !== nmRow) nmRow.append(when);
    }
    if (tick.stamp) tick.stamp.setTime(clock);
    if (tick.t) setText(tick.t, clock);
    // [UI fix r1, playtest] '≥' is jargon: say it on hover (and unknown's meaning)
    when.title = [st === 'unknown' ? UNKNOWN_TIP : '', e.statusSinceApprox ? `≥ = ${AT_LEAST}` : ''].filter(Boolean).join(' · ');
    if (k === key) return;
    key = k;
    if (shownId !== e.id) { pt.replaceChildren(); shownId = e.id; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
    port.style.setProperty('--ws', workspaceHex(e.workspace?.colorIndex));
    cls(port, 'shell', e.kind === 'shell');
    if (ptKey !== `${e.id}|${e.status}|${e.kind}`) {
      ptKey = `${e.id}|${e.status}|${e.kind}`;
      const fresh = porthole(e, { size: 'lg' }).inner; // the procedural SVG fallback under the live portrait
      pt.replaceChildren(...fresh.childNodes);
    }
    attachPortrait(pt, e.id, 56); // [CHR M3.5, cross-owner UI edit] live clay portrait over the SVG fallback
    setText(nm, d.label ? d.label(e) : e.name || e.id); // names.ts: namesakes → 'claude · 2' (m2-r3)
    crest.replaceChildren(shield(e.workspace?.colorIndex));
    setText(crumb, `${e.workspace?.label ?? '?'} › ${e.tab?.label ?? '?'}`);
    crumb.title = [e.kind, e.modelTier, e.project].filter(Boolean).join(' · ');
    const t = taskLabel(e);
    title.hidden = !t;
    setText(title, t ?? '');
    // M3.5 v2: struggle reason, the in-progress todo, last assistant text, work counters (not while blocked: the
    // question is the story then)
    const sl = stuckLine(e.struggle);
    stuck.hidden = !sl;
    stuck.replaceChildren(...(sl ? [stateWord((e.struggle?.level ?? 0) >= 2 ? 'blocked' : 'busy', { text: sl, still: true })] : []));
    const toolTxt = e.kind === 'shell' ? (e.process?.argv ? `$ ${e.process.argv}` : tildePath(e.cwd)) : e.activity?.tool ? `${e.activity.tool} · ${e.activity.detail ?? ''}` : '';
    tool.hidden = !toolTxt || blocked;
    setText(tool, toolTxt);
    const ltx = blocked ? null : lastTextLine(e.lastText);
    lt.hidden = !ltx;
    setText(lt, ltx ?? '');
    // the spec list: one fact per line, sentence-case labels
    const rows: [string, string | HTMLElement][] = [];
    const tl = blocked ? null : todoLine(e.todos);
    if (tl) rows.push(['Todo', tl.text]);
    const wl = e.kind === 'shell' || blocked ? null : workLine(wk, now);
    if (wl) rows.push(['Work', wl]);
    const ci = blocked ? null : ctxInfo(e.contextTokens);
    if (ci) {
      // a plain readout (no meter nested in the ledger): `44% · 88k of 200k`, the hot tail in the busy ink
      const tok = `${Math.min(ci.pct, 100)}% · ${Math.round((e.contextTokens ?? 0) / 1000)}k of ${Math.round(CTX_WINDOW / 1000)}k`;
      rows.push(['Context', ci.hot ? h('span', null, tok, h('span.hot', { text: ' · compaction soon' })) : tok]);
    }
    const sa = e.subagents ?? [];
    if (sa.length && !blocked) rows.push(['Subagents', `${sa.length} · ${sa.slice(0, 3).map((s) => s.type || 'task').join(', ')}`]);
    // your last prompt: only when there is no assistant text to show (it used to be the only story line)
    if (e.lastPrompt && !blocked && !ltx) rows.push(['You said', `“${String(e.lastPrompt).replace(/\s+/g, ' ').trim()}”`]);
    specs.hidden = !rows.length;
    specs.replaceChildren(...rows.flatMap(([dt, dd]) => [h('dt', { text: dt }), h('dd', { title: typeof dd === 'string' ? dd : null }, dd)]));
    rule.hidden = !rows.length || (!t && !toolTxt && !ltx && !sl);
    // blocked question + options (the ledger; a click opens the inbox's one-line confirm)
    blk.hidden = !blocked;
    const qa = d.settings.get('quickAnswer');
    const opts = blocked ? cardRows(e.prompt).filter((r) => r.kind === 'opt') : [];
    if (blocked) {
      const lg = ledger(opts.map((r) => ({ label: r.label, key: String(r.n), note: r.danger === 'exit' ? 'ends session' : r.danger ? 'refuses' : undefined, destructive: !!r.danger })), {
        selected: -1, wrap: true, onPick: (i) => hooks.option(e.id, i),
      });
      lg.classList.add('ob');
      lg.setAttribute('aria-label', 'Options (confirm next: nothing is sent until you confirm)');
      [...lg.children].forEach((li, i) => { if (!(li instanceof HTMLElement)) return; cls(li, 'danger', !!opts[i].danger); li.title = `${opts[i].label}\n${qa ? `${d.platform.mac ? '⌃' : 'Alt+'}${opts[i].n} → confirm` : 'Confirm next (nothing is sent until you confirm)'}`; });
      blk.replaceChildren(question(questionText(e.prompt, 3) || 'Waiting for input…'), ...(opts.length ? [lg] : []));
    } else blk.replaceChildren();
    // foot: ONE legend strip that fits one line (≤ 3 entries), + the one primary when there is a sign-off to give
    const act: Partial<Record<string, () => void>> = { B: () => hooks.inbox(e.id), E: () => hooks.open(e.id), T: () => hooks.talk?.(e.id) };
    const hint = (k2: string, t2: string) => ({ key: k2, label: t2, act: act[k2] });
    // G = what index.ts highFive() does: with the agent aimed it's a high-five (a blocked agent doesn't high-five: it
    // points at its ticket — G goes to it, B answers); shown via selection (nothing aimed) G glides there (m2-r3)
    const gHint = via === 'select' ? hint('G', 'go there') : blocked ? hint('G', 'go to ticket') : hint('G', 'high-five');
    // idle / signed off: "ready for work" is what T means now (readyNudge); a done agent's next step is the sign-off
    // (the primary), so T gives its place to the button
    const signOff = e.status === 'done' && !e.ack;
    const tHint = !blocked && !signOff && e.kind !== 'shell' ? (readyNudge(e) ? hint('T', 'new task') : hint('T', 'talk')) : null;
    // quick answer on: the digits ARE the answer key (B still opens the inbox, one entry says it)
    const aHint = !blocked ? null : qa && opts.length ? { key: ['Alt+1', '–', String(opts.length)], label: 'answer', act: act.B } : hint('B', 'answer');
    foot.replaceChildren(
      actLegend([aHint, hint('E', 'terminal'), tHint, gHint]),
      ...(signOff ? [button('Sign off', { primary: true, onClick: () => hooks.signOff(e.id), title: 'HQ-local sign-off (G on the agent = high-five). Mark seen in herdr: the drawer menu' })] : []),
    );
    cls(el, 'blocked', blocked);
  }

  return {
    el,
    get shownId() { return el.classList.contains('show') ? shownId : null; },
    /**
     * Shows `e` (null hides). `o.collapsed`: the open Blocked Inbox already shows this agent's card (reviewer m2-r2:
     * the question + options twice on screen) → header only, with an "in the inbox" note.
     */
    update(e: Entity | null, via: 'aim' | 'select' = 'aim', o: { collapsed?: boolean } = {}) {
      cls(el, 'show', !!e);
      if (!e) { key = ''; return; }
      show(e, via);
      const c = !!o.collapsed;
      if (el.classList.contains('collapsed') !== c) {
        cls(el, 'collapsed', c);
        inInbox.hidden = !c;
        when.hidden = c;
      }
    },
    /**
     * Fit the card to the visible world strip (§8.2.1). The reticle sits at the strip centre, and the card must never
     * cover it or the aimed agent (reviewer r3): its rect stays clear of the reticle ± RETICLE_CLEAR_PX. A strip
     * narrower than COMPACT_STRIP_PX (drawer docked at 1366, rail + drawer) gets the compact card: name, status, the
     * question and options only, ≤ 40 % of the strip wide and ≤ 45 % of its height. `right` = drawer width (px),
     * `bottomLeftFree` = strip width left of the minimap, `stripW` = visible world strip width, `H` = viewport height.
     */
    layout(right: number, bottomLeftFree: number, stripW: number = innerWidth - right, H: number = innerHeight) {
      const g = statusCardGeometry(stripW, H, bottomLeftFree);
      el.style.right = `${right + CARD_MARGIN_PX}px`;
      el.style.width = `${g.w}px`;
      el.style.maxWidth = `${g.w}px`;
      el.style.maxHeight = `${g.maxH}px`;
      cls(el, 'compact', g.compact);
    },
  };
}
