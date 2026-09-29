/**
 * HUD surface stylesheet (docs/design/ui-kit.md §5.1, §7.1): positions and small surface tweaks for the kit parts the
 * HUD is built from (tally board on rods, session plaque, tool rail, aim tag, tickets, minimap frame + graph paper,
 * chevron signs, hotbar pigeonholes, key sheets, confirm sheet, menu). Every material, colour, radius and font is a
 * kit class or a kit token (var(--…)); nothing here invents a surface. Injected once by `ensureHudCss()`, after the
 * kit sheet. The visible world strip comes from the `--world-l` / `--world-r` vars ui/index.ts layout() sets on `.hq-ui`.
 * Owner: UI (HUD surface).
 */

const STRIP_L = 'var(--world-l,0px)';
const STRIP_R = 'var(--world-r,0px)';
/** horizontal centre of the visible world strip */
const STRIP_C = `calc(${STRIP_L} + (100% - ${STRIP_L} - ${STRIP_R}) / 2)`;

export const HUD_CSS = `
/* ---- top: session plaque · tally board on rods · tool rail ---- */
.hq-top{position:absolute;top:0;left:0;right:0;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:start;column-gap:12px;padding:0 22px;pointer-events:none}
.hq-top>*{pointer-events:auto}
.hq-top .hq-sess{justify-self:start;margin-top:22px;display:flex;align-items:center;gap:8px;min-width:0}
.hq-top .hq-sess .k-plaque{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.hq-top .hq-tallybar{justify-self:center;min-width:0}
.hq-top .hq-tallybar .k-tally{max-width:100%}
.hq-top .hq-tools{justify-self:end;margin-top:18px}
.hq-top.narrow .k-tally .cell:not(.alarm):not(.clear) .w{display:none}
.hq-top.narrow .k-tally .cell{padding:0 10px}
.hq-top.tiny .k-tally .cell.alarm .w,.hq-top.tiny .k-tally .cell.alarm .k-key{display:none}
.hq-top.tiny .hq-tools{display:none}
/* squeezed strip (roster + drawer at 1280): numerals + lamps, the quiet cells go, then done; never under a panel */
.hq-top.squeeze{padding:0 8px}
.hq-top.squeeze .k-tally .cell[data-state=idle],.hq-top.squeeze .k-tally .cell[data-state=unknown],.hq-top.squeeze .k-tally .cell[data-state=shell]{display:none}
.hq-top.squeeze .k-tally .cell{padding:0 8px;gap:5px}
.hq-top.squeeze .k-tally .cell.alarm .w,.hq-top.squeeze .k-tally .cell.alarm .k-key{display:none}
.hq-top.bare .k-tally .cell[data-state=done]{display:none}
.hq-top.wrap{grid-template-columns:minmax(0,1fr) minmax(0,1fr);row-gap:0}
.hq-top.wrap .hq-tallybar{grid-column:1/-1;grid-row:1}
.hq-top.wrap .hq-sess{grid-column:1;grid-row:2;margin-top:10px}
.hq-top.folded .hq-sess{display:none}
.k-tally .cell.sess{cursor:default;padding:0 10px}
.k-tally .cell.sess:hover{background:none}
.k-tally .cell.sess+.cell.alarm{margin-left:4px}.k-tally .cell.sess+.cell.alarm::before{display:none}
.k-tally .cell.sess .k-plaque{max-width:110px;overflow:hidden;text-overflow:ellipsis}
.hq-top.wrap .hq-tools{grid-column:2;grid-row:2;margin-top:8px}
/* ---- notices under the tally: offline paper notice, follow plate, leader plate ---- */
.hq-banner{position:absolute;top:78px;left:${STRIP_C};transform:translateX(-50%);display:none;align-items:center;gap:12px;padding:10px 14px;width:min(480px,calc(100% - ${STRIP_L} - ${STRIP_R} - 44px));pointer-events:auto}
.hq-banner.show{display:flex}
.hq-follow:not([hidden])~.hq-banner{top:128px}
.hq-banner .tx{flex:1;min-width:0}
.hq-banner .tx b{display:block;font:750 14px/1.25 var(--font-ui)}
.hq-banner .tx span{display:block;font:500 12px/1.35 var(--font-ui);color:var(--p2)}
.hq-follow{position:absolute;top:78px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:4px 6px 4px 12px;font:600 13px/1 var(--font-ui);color:var(--t2);pointer-events:auto;cursor:pointer;border:0}
.hq-follow b{color:var(--t1);font-weight:750}
.hq-leader{position:absolute;left:${STRIP_C};bottom:96px;transform:translateX(-50%);display:none;align-items:center;gap:10px;padding:6px 12px 6px 6px;font:600 12px/1 var(--font-ui);color:var(--t2);z-index:30}
.hq-leader.show{display:flex;animation:k-in .14s var(--ease)}
/* ---- crosshair + paper aim tag ---- */
.hq-cross{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.hq-cross .dot{position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:var(--cream);box-shadow:0 0 0 1.5px var(--ink);transition:all .16s var(--ease)}
.hq-cross.aim .dot{left:-15px;top:-15px;width:30px;height:30px;background:transparent;box-shadow:none}
.hq-cross.aim .dot.k-xhair{margin:0}
.hq-cross .dot:not(.k-xhair)::after{display:none}
.hq-cross .hint{position:absolute;left:24px;top:-4px;opacity:0;transform:translateY(4px) rotate(-1.2deg);transition:opacity .14s,transform .18s var(--ease)}
.hq-cross.aim .hint{opacity:1;transform:rotate(-1.2deg)}
.hq-cross.dock .hint{left:0;transform:translateX(-50%) rotate(-1.2deg)}
.hq-cross .hint .nm{display:inline-flex;align-items:baseline;gap:6px}
.hq-cross .hint .verb{font:600 12px/1 var(--font-ui);color:var(--p3)}
.hq-cross .flash{position:absolute;left:0;top:-58px;transform:translateX(-50%) rotate(1deg);white-space:nowrap;display:flex;align-items:center;gap:8px;padding:6px 11px;
  font:700 14px/1 var(--font-ui);animation:hq-hud-flash .9s var(--ease) forwards}
.hq-cross .flash .k-legend{gap:10px;font-size:13px}
@keyframes hq-hud-flash{0%{opacity:0;translate:0 6px}15%{opacity:1;translate:0 0}75%{opacity:1}100%{opacity:0;translate:0 -6px}}
/* ---- tickets (toasts): one width, stub + lamp, serif line; stacked above the minimap, newest on top, max 3 ---- */
.hq-toasts{position:absolute;left:22px;bottom:22px;display:flex;flex-direction:column-reverse;align-items:stretch;gap:12px;width:376px;pointer-events:none}
.hq-toast.k-ticket{pointer-events:auto;width:100%;max-width:376px}
.hq-toast.k-ticket .what b{font-weight:inherit}
.hq-toast.k-ticket .what{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hq-toast.k-ticket .what .ql{color:var(--p3);font-weight:650}
.hq-toast.k-ticket .what .st{color:var(--i-blocked)}
.hq-toast.k-ticket.resolved .what .st{color:var(--i-done)}
.hq-toast.k-ticket .body>.q{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.hq-toast.k-ticket .body{padding:10px 14px 13px;display:flex;flex-direction:column;justify-content:center;min-height:44px}
.hq-toast.k-ticket .stub{min-height:52px}
.hq-toast.k-ticket.warn .stub{background:linear-gradient(180deg,rgba(241,198,110,.2),rgba(241,198,110,.09))}
.hq-toast.k-ticket.warn .stub .k-lamp{color:var(--butter);filter:none}
.hq-toast.k-ticket.info .stub{background:linear-gradient(180deg,rgba(217,119,87,.10),rgba(217,119,87,.05))}
.hq-toast.k-ticket.resolved .stub{background:linear-gradient(180deg,rgba(99,196,138,.12),rgba(99,196,138,.06))}
.hq-toast.k-ticket.resolved .stub .t{color:var(--i-done)}
/* "+N earlier": a ledger line at the head of the top ticket (never a capsule of its own) */
.hq-toast.k-ticket .body>.more{display:flex;align-items:center;gap:10px;width:100%;margin:-2px 0 7px;padding:0 0 6px;border:0;border-bottom:1.5px dashed rgba(90,84,77,.3);background:none;
  font:600 12px/1 var(--font-mono);color:var(--p3);cursor:pointer;text-align:left}
.hq-toast.k-ticket .body>.more .n{flex:1}
.hq-toast.k-ticket .body>.more:hover .n{color:var(--p1);text-decoration:underline;text-underline-offset:3px}
.hq-toast.k-ticket.mini .body>.q,.hq-toast.k-ticket.mini .tear,.hq-toast.k-ticket.mini .hint,.hq-toast.k-ticket.mini .cap{display:none}
.hq-toast.k-ticket.mini .body{padding:8px 14px 11px;min-height:0}
.hq-toast.k-ticket.mini .stub{gap:3px;min-height:0}
.hq-toast.k-ticket.mini:hover .body>.q,.hq-toast.k-ticket.mini:hover .hint{display:revert}
.hq-toast.k-ticket.out{animation:hq-hud-out .2s ease forwards}
@keyframes hq-hud-out{to{opacity:0;transform:translateY(6px)}}
/* the drawer's footer rail holds one line ticket (the newest; older ones wait under it), clipped to the rail */
.hq-toast.k-ticket.line{max-width:100%;width:auto}
.hq-toast.k-ticket.line .body{min-height:0;flex-direction:row;justify-content:flex-start}
.hq-toast.k-ticket.line .stub{min-height:0}
.hq-toast.k-ticket.line .what{display:block;-webkit-line-clamp:none}
.hq-toast.k-ticket.line .body>.q,.hq-toast.k-ticket.line .cap{display:none}
.hq-toast.k-ticket.line .body>.more{order:2;width:auto;margin:0;padding:0;border:0;font-size:11px;flex:none}
.hq-toast.k-ticket.line .hint{flex:0 1 auto;min-width:0;height:20px;overflow:hidden;flex-wrap:wrap}
.hq-toast.k-ticket .k-legend .then.in{margin:0}
.hq-toasts>.hq-toast.k-ticket.line:not(:last-child){display:none}
/* a line ticket keeps a notice's serif line (the part splitNotice took off the headline), clipped last */
.hq-toast.k-ticket.line:not(.blocked) .body>.q:not([hidden]){display:block;flex:0 1 auto;min-width:0;font-size:13px}
.hq-toast.k-ticket.line .what{flex:0 1 auto;min-width:min(160px,60%)}
.hq-toast.k-ticket.line .body>.more .k-legend{display:none}
/* the world lane too narrow for whole tickets: one line ticket (newest), no key legend (click = the same action) */
.hq-toasts.narrow{gap:0}
.hq-toasts.narrow .hq-toast.k-ticket .hint{display:none}
.hq-toasts.narrow .hq-toast.k-ticket.line .body{gap:8px;padding:0 10px}
.hq-toasts.narrow .hq-toast.k-ticket.line .stub{padding:0 7px}
@media (prefers-reduced-motion:reduce){nav.hq-hotbar.k-hotbar,nav.hq-hotbar.k-hotbar.yield{transition:none}.hq-toast.k-ticket.out{animation:none;opacity:0}.hq-cross .flash{animation:none}}
/* a step inside a Leader chord: [L]›[B] */
.hq-toast .k-legend.tight>.then{margin:0 -5px 0 -6px}
.k-legend .h>.to.step{margin:0 -2px;font:700 13px/1 var(--font-ui);color:var(--p3)}
/* ---- hotbar: pigeonholes in a walnut rail; each pinned hole carries a paper name label ---- */
.hq-hotbar.k-hotbar{position:absolute;bottom:22px;left:${STRIP_C};display:none;pointer-events:auto}
.hq-hotbar.k-hotbar.show{display:inline-flex}
.hq-drawer-fs .hq-hotbar.k-hotbar{display:none}
.hq-hotbar .k-cubby{width:70px;height:74px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:7px 0 0}
.hq-hotbar .k-cubby .k-port{width:40px;height:40px}
.hq-hotbar .k-cubby>.k-key{left:3px;top:3px;height:17px;min-width:17px;font-size:12px;padding:0 4px;z-index:2}
.hq-hotbar .k-cubby>svg.k-lamp{right:10px;bottom:26px;width:14px;height:14px;z-index:2}
.hq-hotbar .k-cubby>.k-unread{position:absolute;right:4px;top:4px;z-index:2;padding:1px 4px 1px 3px;border-radius:var(--r-hair);background:var(--f-cubby-lo);font-size:12px}
.hq-hotbar .k-cubby .nm{position:absolute;left:4px;right:4px;bottom:4px;height:18px;padding:0 4px;box-sizing:border-box;display:block;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font:700 11px/18px var(--font-ui);color:var(--p1);background:var(--fibre),linear-gradient(180deg,var(--paper),var(--f-paper-lo));border-radius:var(--r-hair);
  box-shadow:0 1px 0 rgba(0,0,0,.45),inset 0 -1px 0 rgba(80,60,40,.12)}
.hq-hotbar .k-cubby.empty .nm{display:none}
.hq-hotbar .k-cubby.blocked .nm{color:var(--i-blocked)}
.hq-hotbar .k-cubby.missing{opacity:.6}
.hq-hotbar .k-cubby.missing .k-port{filter:grayscale(1);opacity:.5}
.hq-hotbar .k-cubby:hover:not(.empty){box-shadow:inset 0 4px 6px rgba(0,0,0,.7),0 0 0 2px rgba(235,162,131,.55)}
/* compact (narrow lane): 54 px holes, no labels; the name label pops above on hover / focus */
.hq-hotbar.compact .k-cubby{width:54px;height:54px;padding-top:7px}
.hq-hotbar.compact .k-cubby>svg.k-lamp{right:4px;bottom:4px}
.hq-hotbar.compact .k-cubby .nm{left:50%;right:auto;bottom:calc(100% + 12px);transform:translateX(-50%);height:auto;padding:4px 8px;font:700 12px/1 var(--font-ui);overflow:visible;
  box-shadow:0 0 0 1px rgba(80,60,40,.18),0 4px 8px rgba(40,24,10,.3);opacity:0;pointer-events:none;transition:opacity .12s}
.hq-hotbar.compact .k-cubby:hover .nm,.hq-hotbar.compact .k-cubby:focus-visible .nm{opacity:1}
/* tight (roster + drawer at 1280): 46 px holes, 32 px portholes; later pins fold into the "+n" hole; gone = steps aside */
.hq-hotbar .k-cubby.fold{display:none}
.hq-hotbar.k-hotbar.show.gone{display:none}
.hq-hotbar.k-hotbar{transition:transform .16s var(--ease),opacity .16s var(--ease)}
.hq-hotbar.k-hotbar.yield{visibility:hidden;opacity:0;transform:translateY(calc(100% + 24px));transition:transform .16s var(--ease),opacity .16s var(--ease),visibility 0s .16s}
.hq-hotbar.tight .k-cubby{width:46px;height:46px;margin:0 2px;padding-top:6px}
.hq-hotbar.tight .k-cubby .k-port{width:32px;height:32px}
.hq-hotbar.tight .k-cubby>.k-key{height:15px;min-width:15px;font-size:11px;padding:0 3px}
.hq-hotbar .k-cubby.over{display:flex;align-items:center;justify-content:center;padding:0}
.hq-hotbar .k-cubby.over[hidden]{display:none}
.hq-hotbar .k-cubby.over .n{font:800 13px/1 var(--font-sign);color:var(--t1)}
.hq-hotbar .k-cubby.over.blocked .n{color:var(--b-blocked)}
.hq-hotbar .k-cubby.over>svg.k-lamp{right:4px;bottom:4px;width:11px;height:11px}
/* ---- minimap: graph paper taped in a walnut frame; M overview on the same paper ---- */
.hq-mini.k-frame{position:absolute;bottom:22px;pointer-events:auto;cursor:pointer}
.hq-mini .k-graph{position:relative;overflow:hidden}
.hq-mini canvas{display:block}
.hq-mini .tape{transform-origin:center}
.hq-mini>.k-key{position:absolute;right:-5px;top:-6px;z-index:3}
.hq-mini>.k-plaque[hidden]{display:none}
.hq-map{position:absolute;inset:0;display:none;place-items:center;pointer-events:auto;z-index:42;outline:none}
.hq-map.show{display:grid}
.hq-map>.k-veil{pointer-events:none}
.hq-map .card{position:relative;animation:k-in .18s var(--ease)}
.hq-map .sheet{padding:14px 16px 12px;border-radius:2px;transform:none}
.hq-map .hd{display:flex;align-items:center;gap:12px;margin:0 0 10px}
.hq-map .hd .nm{font:600 13px/1 var(--font-ui);color:var(--p3)}
.hq-map .cv{position:relative}
.hq-map canvas{display:block}
.hq-map .tip{position:absolute;padding:5px 9px;border-radius:var(--r-paper);background:var(--board);color:var(--t1);font:600 12px/1.3 var(--font-ui);pointer-events:none;white-space:nowrap;
  box-shadow:0 0 0 1px var(--f-rim-dark),0 4px 10px rgba(28,16,8,.4)}
.hq-map .lg{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:10px 0 0;font:600 12px/1 var(--font-ui);color:var(--p2)}
.hq-map .lg .it{display:inline-flex;align-items:center;gap:5px}
.hq-map .lg .k-legend{gap:12px}
/* ---- edge chevrons: clay arrow signs ---- */
.hq-chev-wrap{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.hq-chev.k-chev{position:absolute;left:0;top:0;margin-top:-20px;pointer-events:auto}
.hq-chev.k-chev .nm{max-width:160px;overflow:hidden;text-overflow:ellipsis}
.hq-chev.k-chev .t{color:var(--f-clay-track)}
.hq-chev.k-chev .t[hidden],.hq-chev.k-chev .more[hidden]{display:none}
.hq-chev.k-chev .more{font:800 13px/1 var(--font-sign);letter-spacing:.04em;color:var(--ink);padding-left:8px;border-left:1.5px dashed rgba(31,30,29,.35)}
.hq-chev.k-chev.narrow{gap:6px}
.hq-chev.k-chev.narrow .nm{max-width:96px}
/* ---- key overlay: layout lives in dialogCss.ts (it is a dialog layer, anchored below the tally) ---- */
/* ---- confirm sheet + context menu (paper) ---- */
.hq-confirm-wrap{position:absolute;inset:0;display:none;place-items:center;pointer-events:auto;z-index:50}
.hq-confirm-wrap.show{display:grid}
.hq-confirm.k-paper{width:min(440px,92vw);padding:18px 20px 16px;animation:k-in .16s var(--ease)}
.hq-confirm p{margin:0 0 16px;font:500 14px/1.45 var(--font-ui);color:var(--p1)}
.hq-confirm .row{display:flex;justify-content:flex-end;gap:10px}
`;

/** Inject the HUD sheet once (idempotent; after the kit + surface sheets so it wins ties). */
export function ensureHudCss() {
  if (typeof document === 'undefined' || document.getElementById('hq-hud-css')) return;
  const s = document.createElement('style');
  s.id = 'hq-hud-css';
  s.textContent = HUD_CSS;
  document.head.appendChild(s);
}
