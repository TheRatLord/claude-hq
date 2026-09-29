/**
 * Roster surface CSS (docs/design/ui-kit.md §5.2, the `#work` roster of renderer/ui-lab/final.html): positions the kit
 * parts (board, plaque, detent, slot, ticks, group headers, rows, ledger, legend) inside the roster and adds the
 * roster-only states (keyboard focus ring, header selection, compact, icon rail, stale query, pending re-sort strip).
 * Tokens only (kit/tokens.ts CSS vars), no hex. Injected once by roster/view.ts. Owner: UI (roster).
 */
export const ROSTER_CSS = `
.hq-roster{position:absolute;left:14px;top:14px;bottom:14px;width:calc(var(--roster-w) - 4px);display:flex;flex-direction:column;pointer-events:auto;min-height:0;
  transform:translateX(calc(-100% - 28px));opacity:0;transition:transform .2s var(--ease),opacity .16s,visibility 0s linear .2s;visibility:hidden}
.hq-roster.open{transform:none;opacity:1;visibility:visible;transition:transform .2s var(--ease),opacity .16s,visibility 0s}
.hq-roster>*{position:relative}
.hq-rh{display:flex;flex-direction:column;gap:10px;padding:12px 12px 10px}
.hq-rh .top{display:flex;align-items:center;gap:4px;padding-left:2px}
.hq-rh .top .k-plaque{margin-right:auto}
.hq-rh .k-detent>button{padding:0 2px}
.hq-search.stale:not(:focus-within) input{color:var(--t3);font-style:italic}
/* five ticks across 332 px: tight box→word gap, the slack goes between ticks, never into the rim */
.hq-ticks{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:0 2px;min-width:0}
.hq-ticks .k-tick{gap:4px;font-size:11px;letter-spacing:.01em}
.hq-ticks .k-tick .k-lamp{display:none}
.hq-tree{flex:1;min-height:0;overflow:auto;padding:0 0 8px;scrollbar-width:thin;scrollbar-color:var(--walnut) transparent;outline:none}
.hq-tree .k-gh{position:sticky;top:0;z-index:2;margin-top:0;height:32px;background:var(--board);box-shadow:0 1px 0 var(--board)}
.hq-tree .k-gh .nb{display:inline-flex;align-items:center;gap:4px;font:700 11px/1 var(--font-mono);color:var(--b-blocked)}
.hq-tree .k-gh.sel{background:linear-gradient(90deg,var(--f-board-top),var(--board))}
.hq-tree .k-gh.sel::before{content:"";position:absolute;left:0;top:7px;bottom:7px;width:4px;border-radius:0 3px 3px 0;background:var(--clay)}
.hq-tree .k-gh .k-shield{display:inline-grid;place-items:center;width:16px;height:16px;flex:none}
.hq-tree .k-gh .name{min-width:0;overflow:hidden;text-overflow:ellipsis}
.hq-tree .k-gh .cnt{flex:none}
/* a row = its head (.hd: porthole · name/tool · age) and, when selected, its body (.under: ledger · legend) */
/* each row is its own stacking context: the porthole's slot keycap / lamps (z 1–2) stay inside the row and scroll under the sticky group header */
.hq-tree .k-row{display:block;isolation:isolate}
/* the head is a grid: porthole | name line · age, then the tool line (or the blocked question) runs under both */
.hq-tree .k-row>.hd{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:10px;align-items:start;min-width:0;border-radius:var(--r-btn)}
.hq-tree .k-row>.hd>.k-port{grid-column:1;grid-row:1/span 2}
.hq-tree .k-row>.hd>.main{display:contents}
.hq-tree .k-row>.hd .l1{grid-column:2;grid-row:1}
.hq-tree .k-row>.hd .l2,.hq-tree .k-row>.hd .ask{grid-column:2/4;grid-row:2;min-width:0}
.hq-tree .k-row>.hd>.side{grid-column:3;grid-row:1}
.hq-tree .k-row.compact>.hd{align-items:center;min-height:22px}
.hq-tree .k-row .l1 .foc{color:var(--brass);font-size:11px}
.hq-tree .k-row .l1 .nm{flex:0 0 auto;max-width:75%}
.hq-tree .k-row .l1 .ctx{margin-left:1px;flex:1 1 0;min-width:0}
.hq-tree .k-row .l2 em{font-style:normal;color:var(--t1)}
.hq-tree .k-row .l2 .stg{color:var(--t1);font-weight:700}
.hq-tree .k-row .l2 .dim{color:var(--t3)}
.hq-tree .k-row.sel .l2{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.hq-tree .k-row .sa{display:inline-flex;align-items:center;gap:8px}
.hq-tree .k-row .sa .st{display:inline-flex}.hq-tree .k-row .sa .st:empty{display:none}
.hq-tree .k-row .side .k-state{font-size:11px}
.hq-tree .k-row.gone{opacity:.45}
.hq-tree .k-row .k-port{position:relative}
.hq-tree .k-row .k-port>div{position:relative}
.hq-tree .k-row .k-port>div::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 2.5px var(--ws);pointer-events:none;z-index:1}
.hq-tree .k-row .k-port.xs>div::after{box-shadow:inset 0 0 0 1.5px var(--ws)}
.hq-tree .k-row .k-port>.k-key{position:absolute;right:-5px;bottom:-4px;z-index:2}
.hq-tree .k-row .k-port>.rl,.hq-tree .k-row .k-port>.k-unread{display:none}
.hq-tree .k-row .under{padding-left:46px;box-sizing:border-box;min-width:0;max-width:100%;margin-top:4px}
.hq-tree .k-row.asking .l2{display:none}
.hq-tree .k-row.compact .under{padding-left:32px}
.hq-tree .k-row.compact .under .k-legend{gap:10px}
.hq-tree .k-row .ask{margin:4px 0 0}
.hq-tree .k-row .ask[hidden]{display:none}
.hq-tree .k-row .ask .k-q{font-size:14px;padding-left:10px;margin:0}
.hq-tree .k-row .under .k-ledger{margin-top:0;padding-left:0}
.hq-tree .k-row .under .k-ledger li{min-width:0;cursor:pointer}
.hq-tree .k-row .under .k-legend{margin-top:8px}
.hq-tree .k-row .under .since{margin-top:4px;font:12px/1.3 var(--font-ui);color:var(--t2)}
.hq-ui .hq-tree:focus-visible,.hq-ui .hq-roster .k-slot input:focus-visible{outline:none}
.hq-tree .k-row.compact .l2{display:none}
/* keyboard focus (the tree owns focus; aria-activedescendant): the kit ring (2 px clayLight, radius token) round the
   selected row's HEAD only, or inset round the selected group header. Distinct from the selection bar + wash. */
.hq-tree:focus-visible .k-row.sel>.hd{outline:2px solid var(--clay-light);outline-offset:3px}
.hq-tree:focus-visible .k-gh.sel::after{content:"";position:absolute;left:8px;right:8px;top:2px;bottom:2px;border-radius:var(--r-btn);box-shadow:0 0 0 2px var(--clay-light);pointer-events:none}
.hq-tree .rn{display:none}
.hq-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px 16px;color:var(--t2);font-size:13px;text-align:center;overflow-wrap:anywhere}
.hq-pbar{display:flex;justify-content:center;padding:6px 0 8px}
.hq-pbar[hidden]{display:none}
.hq-rf{display:flex;align-items:center;gap:10px;padding:10px 14px 12px}
.hq-rf select{appearance:none;-webkit-appearance:none;background:none;border:0;color:var(--t2);font:600 12px var(--font-ui);padding:2px 12px 2px 0;margin-left:-4px;cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,var(--t3) 50%),linear-gradient(135deg,var(--t3) 50%,transparent 50%);background-size:4px 4px;background-position:right 4px center,right 0 center;background-repeat:no-repeat}
.hq-rf select:focus-visible{outline:2px solid var(--clay-light);outline-offset:2px;border-radius:var(--r-hair)}
.hq-rf select option{background:var(--board);color:var(--t1)}
.hq-rf .k-legend{gap:12px;font-size:11px}
.hq-rf .k-legend[hidden]{display:none}
.hq-rf.searching>:not(.k-legend){display:none}
.hq-rf.searching .k-legend{margin-left:auto}

/* compact (300 px): 28 px rows, the ticks show their lamps instead of the words */
.hq-roster.compact .hq-ticks .k-tick .k-lamp{display:inline}
.hq-roster.compact .hq-ticks .k-tick .w{display:none}
.hq-roster.compact .hq-rf .k-btn{padding:0 8px}

/* icon rail (64 px, §8.2.1): portholes with their lamp and a short name; everything else hides */
.hq-roster.rail{width:50px !important}
.hq-roster.rail .hq-rh,.hq-roster.rail .hq-rf,.hq-roster.rail .hq-pbar,.hq-roster.rail>.k-groove,.hq-roster.rail .k-row .main,.hq-roster.rail .k-row .side,.hq-roster.rail .k-row .under,
.hq-roster.rail .k-gh .name,.hq-roster.rail .k-gh .label,.hq-roster.rail .k-gh .fill,.hq-roster.rail .k-gh .sum,.hq-roster.rail .k-gh .k-legend,.hq-roster.rail .k-gh .k-shield{display:none}
.hq-roster.rail .hq-tree{padding-top:6px;scrollbar-width:none}
.hq-roster.rail .k-gh{justify-content:center;padding:0 4px;gap:4px}
.hq-roster.rail .k-row{padding:5px 2px 4px;min-height:0}
.hq-roster.rail .k-row>.hd{display:flex;flex-direction:column;align-items:center;gap:3px}
.hq-roster.rail .k-row .k-port>.rl{display:block;position:absolute;right:-4px;top:-3px;z-index:2}
.hq-roster.rail .k-row .k-port>.k-unread:not([hidden]){display:inline-flex;position:absolute;left:-3px;top:-2px;z-index:2}
.hq-roster.rail .rn{display:block;max-width:50px;font:600 11px/1.1 var(--font-ui);color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hq-roster.rail .k-row.sel .rn{color:var(--t1)}
`;
