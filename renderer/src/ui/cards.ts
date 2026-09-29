/**
 * The "cards" surface on the UI kit (docs/design/ui-kit.md §5.4 / §7.4): the status card (clipboard sheet), the Blocked
 * Inbox (clipboard + deck, recap band), Triage (a board with a printout) and the away "While you were out" slip.
 * Surface CSS only positions and spaces kit parts (k-*); no colour literals, no boxes, no pills. Plus two helpers the
 * four modules share: `actLegend` (the one key strip, whose entries are also click targets for the mouse, so an action
 * is never both a button and a legend entry) and `recapLamp` (recap line kind → lamp state).
 * Owner: UI (cards).
 */
import { legend, slipLine, type LegendItem } from './kit/index.ts';
import type { LampState } from './kit/lamps.ts';
import type { RecapLine } from './recap.ts';

/** A legend entry that can also be clicked (`act`). */
export type ActLegendItem = LegendItem & { act?: () => void; title?: string };

const CSS = `
/* ---------------------------------------------------------------- shared */
.hq-ui .k-legend .h.act{cursor:pointer;border-radius:var(--r-key)}
.hq-ui .k-legend .h.act:hover{color:var(--t1)}
.hq-ui .k-paper .k-legend .h.act:hover{color:var(--p1)}
.hq-ui .k-legend .h.act:focus-visible{outline:2px solid var(--clay-light);outline-offset:3px}
.hq-cards .k-port>div{position:relative}
.hq-cards .k-who{min-width:0}
.hq-cards .k-who>div:nth-child(2){min-width:0;flex:1}
.hq-cards .k-who .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hq-cards .k-who .sub .cr{min-width:0;overflow:hidden;text-overflow:ellipsis}
.hq-cards .k-who .nmrow{display:flex;align-items:flex-start;gap:10px;min-width:0}
.hq-cards .k-who .nmrow .nm{min-width:0}
.hq-cards .k-who .when{display:inline-flex;align-items:center;gap:8px;margin-left:auto;flex:none}
.hq-cards .k-who .when.line{margin:6px 0 0;display:flex}
.hq-cards .k-who .when .t{font:12px/1 var(--font-mono);color:var(--p3)}
.hq-cards .k-board .k-who .when .t{color:var(--t3)}
.hq-cards .k-stamp{margin-right:4px}
.hq-cards .k-q{white-space:pre-wrap;max-height:9.6em;overflow:auto}
.hq-cards .k-q.free{font:12px/1.45 var(--font-mono)}
.hq-cards .k-ledger li.open{color:var(--p2);font-weight:600}
.hq-cards .k-ledger.board li.open{color:var(--t2)}
.hq-cards .k-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.hq-cards .k-foot .k-legend{flex:1;min-width:0;gap:6px 12px}
.hq-scard .k-foot{flex-wrap:nowrap}
/* [fix r2] the lamp carries the state colour; the word stays neutral ink, like the palette (banned #4) */
.hq-scard .k-who .when .k-state.k-state{color:var(--p2)}
.hq-scard .k-foot .k-legend{gap:6px 12px;flex-wrap:nowrap;overflow:hidden}
.hq-cards .k-confirm{flex-wrap:wrap;row-gap:8px}
.hq-cards .k-confirm .say{flex:1 1 180px;white-space:normal;overflow:visible;color:var(--p1)}
.hq-cards .k-confirm.danger .say{color:var(--i-blocked)}
.hq-cards .k-board .k-confirm .say{color:var(--t1)}
.hq-cards .k-board .k-confirm.danger .say{color:var(--b-blocked)}
.hq-cards .busy .k-confirm{opacity:.7}
@keyframes hq-card-in{from{opacity:0;transform:translateY(10px) rotate(.4deg)}to{opacity:1;transform:none}}
@keyframes hq-card-shake{20%{transform:translateX(-9px) rotate(-.6deg)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(3px)}}
@keyframes hq-card-sent{0%{transform:none}30%{transform:translateY(6px)}100%{transform:translate(120px,-60px) rotate(9deg) scale(.9);opacity:0}}
@keyframes hq-card-unroll{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes hq-card-type{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes hq-card-out{to{opacity:0;transform:translateY(-6px)}}

/* ---------------------------------------------------------------- status card: a clipboard sheet */
.hq-scard{position:absolute;right:26px;bottom:24px;width:400px;display:none;flex-direction:column;pointer-events:auto}
.hq-scard.show{display:flex}
.hq-scard.in{animation:hq-card-in .2s var(--ease)}
.hq-scard>.k-clip{display:flex;flex-direction:column;min-height:0}
.hq-scard .k-paper{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:26px 18px 14px;scrollbar-width:thin}
.hq-scard .ti{margin-top:14px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.hq-scard .stuck{margin-top:8px}
.hq-scard .tool{margin-top:6px;font:12px/1.35 var(--font-mono);color:var(--p2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hq-scard .lt{margin-top:8px;font:500 14px/1.35 var(--font-voice);color:var(--p2);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.hq-scard .k-stitch{margin:12px 0 10px}
.hq-scard .k-specs dd{font-variant-numeric:tabular-nums}
.hq-scard .k-specs dd .hot{color:var(--i-busy)}
.hq-scard .blk .k-q{margin:14px 0 8px}
.hq-scard .k-ledger.wrap li .tx{-webkit-line-clamp:3}
.hq-scard .inb{font:12px/1 var(--font-ui);color:var(--p3);white-space:nowrap}
.hq-scard.collapsed .k-paper>:not(.k-who){display:none}
.hq-scard.collapsed .k-paper{padding-bottom:12px}
.hq-scard.compact .k-paper{padding:22px 14px 10px}
.hq-scard.compact :is(.sub,.ti,.tool,.lt,.k-stitch,.k-specs,.k-foot,.stuck){display:none}
.hq-scard.compact .k-who .nm{font-size:16.5px}
.hq-scard.compact .k-port.lg{width:36px;height:36px;padding:2.5px}
.hq-scard.compact .blk .k-q{font-size:14px;margin:10px 0 4px;max-height:5.6em}
.hq-scard.compact .k-ledger li{height:30px;font-size:13px}
.hq-scard.compact .k-ledger.wrap li{height:auto;min-height:30px;padding-top:5px;padding-bottom:5px} /* [integ r1] wrap beats the compact row height */
.hq-scard.compact .k-ledger.wrap li .tx{-webkit-line-clamp:2}

/* ---------------------------------------------------------------- Blocked Inbox: one question per clipped sheet */
.hq-inbox{position:absolute;top:calc(76px + var(--away-h, 0px));transition:top .25s var(--ease);left:calc(var(--world-l) + (100% - var(--world-l) - var(--world-r)) / 2);
  width:min(470px,calc(100% - var(--world-l) - var(--world-r) - 24px));transform:translateX(-50%);pointer-events:auto;display:none;z-index:15;outline:none}
.hq-inbox.open{display:block}
.hq-inbox .k-deck.none::before,.hq-inbox .k-deck.none::after{display:none}
.hq-inbox .card{padding:28px 20px 14px;max-height:calc(100vh - 120px - var(--away-h, 0px));overflow-y:auto;scrollbar-width:thin}
/* the sheet itself never draws a focus ring (the base ".hq-ui :focus-visible" would outline the whole paper) */
.hq-ui .hq-inbox:focus-visible,.hq-ui .hq-triage:focus-visible{outline:none}
/* focus lives on the ledger line only: the highlighted option carries the clay marker while the inbox has the keys;
   opened without focus (away recap: the world keeps the keys) the highlighter is a faint pencil mark, no marker */
.hq-inbox:not(:focus-within) .opts .k-hl::before{opacity:0}
.hq-inbox:not(:focus-within) .opts .k-hl::after{opacity:.45}
.hq-inbox .card.slidein{animation:hq-card-in .26s var(--ease)}
.hq-inbox .card.sent{animation:hq-card-sent .5s cubic-bezier(.5,-0.3,.7,.4) forwards}
.hq-inbox .card.shake{animation:hq-card-shake .45s ease}
.hq-inbox .ih{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.hq-inbox .ih .k-detent{flex:1}
.hq-inbox .aw{margin:0 -20px 16px;animation:hq-card-unroll .35s var(--ease)}
.hq-inbox .aw .band{padding:4px 20px 9px}
.hq-inbox .aw .ln{padding:8px 20px}
.hq-inbox .aw .ln:last-child{border-bottom:0}
.hq-inbox .k-who .sub .pager{color:var(--p3)}
.hq-inbox .bb .k-q{margin:16px 0 8px}
.hq-inbox .opts{outline:none}
.hq-inbox .cf{margin-top:10px}
.hq-inbox .empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 0 22px;color:var(--p2);font-size:13px}
.hq-inbox .empty .k-stamp{font-size:15px;padding:7px 12px 6px}
.hq-inbox .db>.note{margin:0 0 8px;font-size:12px;color:var(--p3)}
.hq-inbox .dl{max-height:320px;overflow:auto}
/* [fix r2] a ledger, not a ragged list: the name, then its meta on a second line in the same column */
.hq-inbox .dl .k-ledger li{display:grid;grid-template-columns:auto auto minmax(0,1fr);grid-template-areas:"k p n" "k p m";
  column-gap:11px;row-gap:3px;align-items:center;height:auto;min-height:50px;padding:7px 8px}
.hq-inbox .dl .k-ledger li>.k-key{grid-area:k}
.hq-inbox .dl .k-ledger li>.k-port{grid-area:p}
.hq-inbox .dl .k-ledger li>.tx{grid-area:n;align-self:end;line-height:1.15}
.hq-inbox .dl .k-ledger li>.note{grid-area:m;align-self:start;margin:0;padding:0;font:500 12px/1.25 var(--font-ui);color:var(--p3);min-width:0;overflow:hidden;text-overflow:ellipsis}
.hq-inbox .dl .none{padding:14px 0;color:var(--p3);font-size:13px;text-align:center}

/* ---------------------------------------------------------------- Triage: a board, printout left, answer right */
.hq-triage-wrap{position:absolute;inset:0;display:none;align-items:flex-start;justify-content:center;padding-top:max(7vh,var(--dlg-top,76px));pointer-events:auto;z-index:41}
.hq-triage-wrap>.k-veil{pointer-events:none}
.hq-triage-wrap.show{display:flex}
.hq-triage{width:min(1080px,calc(100vw - 48px));max-height:calc(100vh - max(7vh,var(--dlg-top,76px)) - 22px);display:flex;flex-direction:column;gap:14px;padding:16px 18px;outline:none;animation:hq-card-in .18s var(--ease)}
.hq-triage.shake{animation:hq-card-shake .35s ease}
.hq-triage .hd{display:flex;align-items:center;gap:12px}
.hq-triage .hd .k-legend{justify-content:flex-end;flex:1;min-width:0;gap:14px}
.hq-triage .bd{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:22px;min-height:0;align-items:start}
@media (max-width:860px){.hq-triage .bd{grid-template-columns:1fr}}
.hq-triage .k-printout pre{min-height:180px}
.hq-triage .side{display:flex;flex-direction:column;gap:6px;min-width:0;padding-top:4px}
.hq-triage .k-who .nm{color:var(--t1)}
.hq-triage .todo,.hq-triage .work{font:12px/1.35 var(--font-mono);color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hq-triage .lt{font:500 14px/1.35 var(--font-voice);color:var(--t2);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}
.hq-triage .side>.k-who{margin-bottom:8px}
.hq-triage .q{margin:10px 0 6px}
.hq-triage .ob{margin-left:2px}
.hq-triage .cf{margin-top:8px}
.hq-triage .empty{display:flex;align-items:center;justify-content:center;gap:10px;padding:26px;color:var(--t2);font-size:14px}
.hq-triage .empty b{color:var(--t1)}

/* ---------------------------------------------------------------- away: the "While you were out" slip */
.hq-away{position:absolute;top:76px;left:0;right:0;margin:0 auto;width:min(470px,calc(100% - var(--world-l) - var(--world-r) - 24px));display:none;pointer-events:auto;z-index:14}
.hq-away.show{display:block;animation:hq-card-unroll .35s var(--ease)}
.hq-away.fade{animation:hq-card-out .4s ease forwards}
.hq-cards .k-slip .ln{min-height:36px}
.hq-cards .k-slip .ln b{white-space:nowrap;min-width:78px}
.hq-away .ln.wait{display:none}
.hq-away .ln.type{animation:hq-card-type .55s steps(28,end) both}
.hq-away.reduced .ln{animation:none}
`;

/** Inject the cards stylesheet once (after the kit + base UI sheets, so it wins over their generic rules). */
export function injectCardStyles() {
  if (typeof document === 'undefined' || document.getElementById('hq-ui-css-cards')) return;
  const s = document.createElement('style');
  s.id = 'hq-ui-css-cards';
  s.textContent = CSS;
  document.head.append(s);
}

/**
 * The surface's one legend, each entry optionally clickable (`act`): the mouse path for a keyboard verb, so the verb
 * is never also a button. Items: {key, label, act?} | null (skipped) | {spacer:true}.
 */
export function actLegend(items: (ActLegendItem | null | undefined | false)[], o: { cls?: string; leader?: boolean } = {}) {
  const list = items.filter((x): x is ActLegendItem => !!x);
  const el = legend(list, o);
  const hs = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && (c.classList.contains('h') || c.classList.contains('k-sp')));
  const start = o.leader ? 1 : 0;
  list.forEach((it, i) => {
    const node = hs[i + start];
    const act = it.act;
    if (!node || !act) return;
    node.classList.add('act');
    node.setAttribute('role', 'button');
    node.title = it.title ?? '';
    node.addEventListener('mousedown', (ev) => ev.preventDefault());
    node.addEventListener('click', (ev) => { ev.stopPropagation(); act(); });
  });
  return el;
}

/**
 * Recap line → lamp state for the slip: the named agent's own lamp when recap.ts resolved it (`l.lamp`, null = gone →
 * no lamp), else by kind. [fix r3 art] never the square CRT bezel for a line about a Claude (§4.1: square = shell).
 */
const RECAP_LAMP: Record<string, LampState> = { blocked: 'blocked', finished: 'done', done: 'done', commit: 'working', tests: 'working', struggle: 'working', crowd: 'idle', quiet: 'idle' };
export const recapLamp = (l: string | Pick<RecapLine, 'kind' | 'lamp'>): LampState | null => {
  if (typeof l === 'object' && l.lamp !== undefined) return l.lamp;
  const kind = typeof l === 'object' ? l.kind : l;
  return RECAP_LAMP[kind] ?? 'idle';
};

/** Recap line text without its leading ' · ' joiner. */
export const recapText = (t: unknown): string => String(t ?? '').replace(/^\s*·\s*/, '');

/**
 * A recap.ts line as the slip's `lamp · name · serif sentence · time` line (kit slipLine), for the away strip and the
 * inbox's "While you were out" band alike. `onClick` makes it a jump target.
 */
export function recapSlipLine(l: RecapLine, onClick?: ((e: Event) => void) | null) {
  const ln = slipLine({ state: recapLamp(l), name: l.name ?? l.strong ?? '', text: l.say ?? recapText(l.text), time: l.time, onClick: onClick ?? undefined });
  ln.classList.add(`k-${l.kind}`);
  if (onClick) ln.title = 'Click to jump there';
  return ln;
}

