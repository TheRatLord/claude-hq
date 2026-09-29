/**
 * Terminal drawer chrome (docs/design/ui-kit.md §5.3, mockup renderer/ui-lab/final.html `#work`): a board sheet with a
 * walnut rim on its left edge and a brass drawer pull (the resize handle), tabs on a recessed rail, the header
 * (breadcrumb, cwd line, Peek/Control switch, icon toolbar), the xterm in a CRT bezel, and the footer rail (mode lamp,
 * legend, notice strip, in-drawer tickets). Kit parts (k-*) come from ui/kit/styles.ts; this sheet only places them.
 * Tokens only, no hex. The xterm itself (ART §9.3) is untouched: only its bezel is styled. Owner: UI (drawer).
 */

export const DRAWER_CSS = `
/* ---- sheet: painted board, walnut rim + grain on the left edge, slides in from the right ---- */
.hq-drawer{position:absolute;top:0;right:0;bottom:0;width:var(--drawer-w);display:flex;flex-direction:column;pointer-events:auto;color:var(--t1);font:13px/1.3 var(--font-ui);
  background:var(--grain),linear-gradient(180deg,var(--f-board-top),var(--board) 30%,var(--f-board-bot));border-radius:var(--r-drawer) 0 0 var(--r-drawer);
  box-shadow:0 0 0 1px var(--f-rim-dark),-5px 0 0 0 var(--walnut),-6px 0 0 0 var(--walnut-lo),inset 0 1px 0 rgba(255,236,210,.06),-18px 0 40px -8px rgba(28,16,8,.55);
  transform:translateX(calc(100% + 48px));transition:transform .2s cubic-bezier(.2,.7,.2,1),visibility 0s linear .2s;visibility:hidden}
.hq-drawer::before{content:"";position:absolute;left:-6px;top:0;bottom:0;width:6px;border-radius:var(--r-drawer) 0 0 var(--r-drawer);pointer-events:none;
  background:var(--woodgrain),linear-gradient(90deg,var(--walnut-lo),var(--f-walnut-hi) 45%,var(--walnut));box-shadow:inset 1px 0 0 rgba(255,220,180,.25)}
.hq-drawer.open{transform:none;visibility:visible;transition:transform .2s cubic-bezier(.2,.7,.2,1),visibility 0s}
.hq-drawer.dragging{transition:none}
.hq-drawer.fullscreen{width:100% !important;border-radius:0;box-shadow:none;z-index:20}
.hq-drawer.fullscreen::before,.hq-drawer.fullscreen .grip{display:none}
.hq-drawer [hidden]{display:none !important}

/* the resize handle: the whole rim is draggable; the brass drawer pull marks it (double-click resets to 50%) */
.hq-drawer .grip{position:absolute;left:-8px;top:0;bottom:0;width:10px;cursor:col-resize;z-index:5}
.hq-drawer .grip::after{content:"";position:absolute;left:-8px;top:50%;width:12px;height:64px;margin-top:-32px;border-radius:6px 0 0 6px;
  background:linear-gradient(90deg,var(--brass-hi),var(--brass) 45%,var(--brass-lo));box-shadow:-2px 2px 4px rgba(28,16,8,.45),inset 0 1px 0 rgba(255,236,210,.5)}
.hq-drawer .grip::before{content:"";position:absolute;left:-3px;top:50%;height:28px;margin-top:-14px;width:0;border-left:1.5px dotted rgba(60,40,15,.6);z-index:1}
.hq-drawer .grip:hover::after,.hq-drawer.dragging .grip::after{background:linear-gradient(90deg,var(--brass-hi),var(--brass-hi) 45%,var(--brass))}

/* ---- tab rail: recessed; the active tab is cut from the header (kit .k-tab.on) ---- */
.hq-tabrail{flex:none;align-items:stretch;padding:0 0 0 14px;border-radius:var(--r-drawer) 0 0 0;gap:0}
.hq-drawer.fullscreen .hq-tabrail{border-radius:0}
.hq-tabwrap{position:relative;flex:1;min-width:0;display:flex;align-items:flex-end}
.hq-tabs{flex:1;min-width:0;display:flex;align-items:flex-end;gap:4px;height:100%;overflow:hidden}
/* overflow (drawer.ts tabOverflow): the strip pages in WHOLE tabs; a tab past either end is not drawn at all, and a
   brass end-stop on that side counts them (click / wheel = page one tab) */
.hq-tabs .k-tab.off{visibility:hidden;pointer-events:none}
/* a blank tail as wide as the strip, so paging can always put the first shown tab right after the left end-stop */
.hq-tabs.over::after{content:"";flex:none;width:100%;height:1px}
.hq-tabmore{position:absolute;top:50%;z-index:3;display:inline-flex;align-items:center;gap:1px;height:24px;margin-top:-10px;padding:0 5px;border:0;border-radius:var(--r-key);cursor:pointer;
  font:700 11px/1 var(--font-mono);color:var(--ink);background:linear-gradient(180deg,var(--brass-hi),var(--brass) 55%,var(--brass-lo));
  box-shadow:inset 0 1px 0 rgba(255,236,210,.45),0 2px 0 var(--f-rim-dark),0 3px 5px rgba(0,0,0,.4)}
.hq-tabmore.l{left:0}.hq-tabmore.r{right:4px}
.hq-tabmore span{display:grid;place-items:center}
.hq-tabmore svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.hq-tabmore:hover{background:linear-gradient(180deg,var(--brass-hi),var(--brass-hi) 55%,var(--brass))}
.hq-tabmore:active{transform:translateY(1px)}
.hq-tabmore:focus-visible{outline:2px solid var(--clay-light);outline-offset:2px}
/* a tab is as wide as its parts, lamp right after the name; an inactive tab's × takes no room and on hover swaps in
   for the lamp (same 12 px slot); the full name wins over padding until the strip goes compact (drawer.ts) */
.hq-tabs .k-tab{flex:0 1 auto;min-width:0;max-width:220px;z-index:1}
.hq-tabs .k-tab .pt{display:flex;flex:none}
.hq-tabs .k-tab .k-lamp{flex:none}
.hq-tabs .k-tab .nm{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;min-width:3ch}
.hq-tabs .k-tab:not(.on) .x{display:none;width:12px}
.hq-tabs .k-tab:not(.on):hover .x{display:grid;opacity:.75}
.hq-tabs .k-tab:not(.on):hover .k-lamp{display:none}
.hq-tabs .k-tab.gone .nm,.hq-tabs .k-tab.gone .pt{opacity:.5}
.hq-tabs.compact .k-tab{flex:0 0 auto;min-width:0;gap:6px;padding:0 8px 0 6px}
/* blocked counter: its own bay at the rail's end, behind a groove (readout + [Leader][U]); other tabs only */
.hq-bc{position:relative;flex:none;align-self:stretch;display:inline-flex;align-items:center;gap:6px;margin:0;padding:0 12px 0 14px;border:0;cursor:pointer;color:var(--t2);
  background:linear-gradient(180deg,var(--f-tab-rail-lo),var(--f-tab-rail));box-shadow:inset 2px 0 0 var(--f-groove),inset 3px 0 0 rgba(255,236,210,.06)}
.hq-bc .k-keys{display:inline-flex;gap:3px}
.hq-bc:hover .k-readout{box-shadow:0 0 0 1px var(--brass-hi),inset 0 1px 3px rgba(0,0,0,.8)}
.hq-bc:focus-visible{outline:2px solid var(--clay-light);outline-offset:-3px}
.hq-bc.flash .k-readout{animation:hq-bc-flash .7s ease-out 1}
@keyframes hq-bc-flash{35%{box-shadow:0 0 0 2px var(--s-blocked),0 0 12px var(--s-blocked)}}

/* ---- header: breadcrumb + cwd line · mode · toolbar ---- */
.hq-dh{flex:none;display:flex;align-items:center;gap:14px;padding:12px 12px 12px 18px;min-height:64px;box-sizing:border-box}
.hq-dh .who{min-width:0;flex:0 1 auto}
.hq-dh .k-crumb{overflow:hidden}
.hq-dh .k-crumb .nm{overflow:hidden;text-overflow:ellipsis}
.hq-dh .k-crumb .closed{font-weight:500;color:var(--t3)}
.hq-dh .k-cwd{overflow:hidden}
.hq-dh .k-cwd .path{overflow:hidden;text-overflow:ellipsis;min-width:0}
.hq-dh .k-cwd .herdr{font-family:var(--font-ui);font-weight:650}
.hq-dh .tools{display:flex;gap:2px;flex:none}

/* ---- CRT: the xterm in a recessed glass bezel; the focus ring is on the bezel ---- */
.hq-tbody.k-crt{flex:1;min-height:0;margin:0 14px}
.hq-drawer.fullscreen .hq-tbody.k-crt{margin:0 10px}
.hq-drawer.focused .hq-tbody.k-crt{box-shadow:inset 0 0 0 1px rgba(0,0,0,.95),inset 0 3px 10px rgba(0,0,0,.75),0 0 0 3px var(--f-groove),0 0 0 4.5px color-mix(in srgb,var(--clay-light) 75%,transparent)}
.hq-thost{position:absolute;inset:0;display:none;padding:10px 8px 8px 12px;overflow:hidden}
.hq-thost.active{display:block}
.hq-thost.pan{overflow:auto}
.hq-thost .frame{position:relative;margin:0}
.hq-thost.edge .frame{box-shadow:1.5px 0 0 0 color-mix(in srgb,var(--brass) 30%,transparent)}
.hq-thost.edge .frame::after{content:attr(data-dim);position:absolute;left:100%;top:0;margin-left:10px;white-space:nowrap;pointer-events:none;
  font:650 11px/1 var(--font-ui);color:color-mix(in srgb,var(--brass) 70%,transparent);font-variant-numeric:tabular-nums}
.hq-thost.dim .frame{opacity:.45;filter:saturate(.5)}
.hq-thost .xterm{height:100%}
.hq-thost .xterm .xterm-viewport{background:transparent !important;scrollbar-width:none}
.hq-hist{position:absolute;inset:0;z-index:3;background:var(--crt);display:none;padding:10px 8px 8px 12px}
.hq-hist.show{display:block;box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--butter) 55%,transparent)}
.hq-empty-drawer{display:grid;place-items:center;height:100%;color:var(--t3);text-align:center;padding:20px}

/* ---- menus (right-click on the glass, ⋯): a paper slip torn off for this pane: the kit's clay-ruled band names it,
   ledger lines carry their key tiles at the right end (terminal/menu.ts) ---- */
.hq-tmenu.k-paper{position:fixed;z-index:60;min-width:260px;max-width:340px;padding:0 0 4px;pointer-events:auto;animation:k-in .14s var(--ease)}
.hq-tmenu .band{padding:10px 14px 7px}
.hq-tmenu .band h3{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hq-tmenu .band .span{flex:none}
.hq-tmenu .k-ledger{padding-left:14px}
.hq-tmenu .k-ledger li{height:34px;padding:0 12px 0 4px;font-size:13px}
.hq-tmenu .k-ledger li[aria-disabled=true]{color:var(--p3);cursor:default}
.hq-tmenu .k-ledger li[aria-disabled=true] .k-key{opacity:.5}

/* ---- footer rail: mode lamp + word · sub · legend | notice strip (one post-it) | in-drawer tickets ---- */
.hq-df{position:relative;flex:none;display:flex;align-items:center;gap:14px;height:48px;padding:0 14px 0 18px;font-size:12px;color:var(--t2);min-width:0}
.hq-df .status{display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;flex:0 1 auto}
.hq-df .status .sub{color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.hq-df .status .sub.flash{color:var(--t1)}
.hq-df .status .sub .k-legend{color:var(--t2)}
.hq-df .status .lg{margin-left:8px;flex:none}
.hq-df .status .k-legend{flex-wrap:nowrap;gap:14px}
.hq-df.noticed .status .sub,.hq-df.noticed .status .lg{display:none}
.hq-df.noticed .status{flex:none}
.hq-df .notice{min-width:0;flex:0 1 auto}
.hq-notices{display:flex;min-width:0}
.hq-notices:empty{display:none}
.hq-notices>.hq-notice~.hq-notice{display:none}
/* a notice is a LEDGER LINE on the board (not a butter slab): a small post-it tab · text · a quieter
   clause · kit buttons. */
.hq-notice{display:flex;align-items:center;gap:10px;min-width:0;height:34px;padding:0 2px;white-space:nowrap;color:var(--t1);font:650 12px/1 var(--font-ui);
  border-bottom:1.5px dashed rgba(255,236,210,.12);animation:k-in .18s var(--ease)}
.hq-notice>.k-note{transform:rotate(-6deg);box-shadow:0 1px 2px rgba(0,0,0,.45)}
.hq-notice .tx{overflow:hidden;text-overflow:ellipsis;min-width:0;font-variant-numeric:tabular-nums}
.hq-notice .tx .sub{color:var(--t3);font-weight:500}
.hq-notice .k-keys{display:inline-flex;gap:3px;flex:none}
.hq-notice .k-btn{flex:none}
/* the rail's one line ticket: its own slot at the rail's end, in the flow (drawer.ts layoutTicket), so it never sits
   on a button; while it shows the notice keeps only its post-it + button and the mode only lamp + word. A rail too
   narrow even for that stacks the ticket above the rail, over the glass's bottom edge. */
.hq-drawer .hq-toasts{position:static;left:auto;top:auto;flex:0 1 auto;min-width:0;width:auto;max-width:none;display:flex;flex-direction:column-reverse;align-items:flex-end;gap:6px;z-index:6;pointer-events:none}
.hq-df.ticketed:not(.stacked) .notice .hq-notice>.tx,.hq-df.ticketed:not(.stacked) .status .sub,.hq-df.ticketed:not(.stacked) .status .lg{display:none}
.hq-df.ticketed:not(.stacked) .status{flex:none}
.hq-df.stacked .hq-toasts{position:absolute;right:14px;bottom:calc(100% + 6px);max-width:calc(100% - 28px)}
.hq-drawer .hq-toasts>*{pointer-events:auto;max-width:100%}

/* ---- collapsed: a 48 px labelled walnut spine (pull · sign · portholes · blocked counter) ---- */
.hq-drawer.collapsed{width:48px !important}
.hq-drawer.collapsed>:not(.hq-rail){display:none}
.hq-rail{display:none;flex-direction:column;align-items:center;gap:10px;padding:10px 0 12px;height:100%;box-sizing:border-box}
.hq-drawer.collapsed .hq-rail{display:flex}
.hq-rail button{border:0;background:none;padding:0;cursor:pointer;color:var(--t2)}
.hq-rail button:focus-visible{outline:2px solid var(--clay-light);outline-offset:2px}
.hq-rail .pull{display:flex;flex-direction:column;align-items:center;gap:5px;padding:6px 4px;border-radius:var(--r-plaque)}
.hq-rail .pull .ic{display:grid;place-items:center;width:26px;height:22px;border-radius:var(--r-key);color:var(--ink);
  background:linear-gradient(90deg,var(--brass-hi),var(--brass) 55%,var(--brass-lo));box-shadow:inset 0 1px 0 rgba(255,236,210,.45),0 2px 0 var(--f-rim-dark)}
.hq-rail .pull .ic svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.hq-rail .pull:hover .ic{background:linear-gradient(90deg,var(--brass-hi),var(--brass-hi) 55%,var(--brass))}
.hq-rail .sign{writing-mode:vertical-rl;transform:rotate(180deg);color:var(--t3);padding:4px 0;white-space:nowrap}
.hq-rail .sign:hover{color:var(--t1)}
.hq-rail .list{display:flex;flex-direction:column;align-items:center;gap:8px}
.hq-rail .pt{position:relative;display:grid;place-items:center;width:40px;height:32px}
.hq-rail .pt>.k-lamp{position:absolute;right:4px;bottom:1px}
.hq-rail .pt.on::before{content:"";position:absolute;left:0;top:5px;bottom:5px;width:3px;border-radius:var(--r-key);background:var(--clay)}
.hq-rail .bc{display:flex;flex-direction:column;align-items:center;gap:5px;padding:6px 2px}
.hq-rail .bc .k-readout{padding:4px 5px;gap:4px}
.hq-rail .bc .k-keys{flex-direction:column;gap:3px}
@media (prefers-reduced-motion:reduce){.hq-notice,.hq-tmenu.k-paper{animation:none}.hq-bc.flash .k-readout{animation:none}}
`;

/** Inject the drawer sheet once, after the other UI sheets (it places kit parts, so it must win ties). */
export function injectDrawerStyles() {
  if (typeof document === 'undefined' || document.getElementById('hq-ui-css-drawer')) return;
  const s = document.createElement('style');
  s.id = 'hq-ui-css-drawer';
  s.textContent = DRAWER_CSS;
  document.head.appendChild(s);
}
