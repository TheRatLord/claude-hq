/**
 * Dialog surface CSS (docs/design/ui-kit.md §5.5): the command palette index card, the T prompt strip + rename strip,
 * the hire work order, the settings form, the help notice board and Ada's tour sheet. Only layout lives here: every
 * material, part and colour is a kit class (`k-*`) or a kit CSS variable; no hex, no pills, no uppercase (caps come
 * from kit classes: `.k-sign`, `.k-index .sec`, `.k-sheets h4`, plaques and stamps). Injected once, lazily, by the
 * first dialog that is created. Owner: UI (dialogs).
 */

const CSS = `
/* ---- shared: a modal layer over the world. The palette gets the one veil (§6.12); other modals a light dim.
   Every sheet anchors BELOW the HUD tally (--dlg-top, measured by anchorBelowHud) and never runs past the bottom inset:
   what does not fit scrolls inside the sheet's own stitched edge (kit .k-scroll). */
.hq-dlg{position:absolute;inset:0;display:none;justify-content:center;align-items:flex-start;padding:max(12vh,var(--dlg-top,76px)) 16px 22px;pointer-events:auto;z-index:46}
.hq-dlg.show{display:flex}
.hq-dlg.mid{padding-top:var(--dlg-top,76px)}
.hq-dlg.dim{background:rgba(20,12,6,.34)}
.hq-dlg.low{align-items:flex-end;padding:0 16px 12vh}
.hq-dlg>*{animation:k-in .2s var(--ease)}
.hq-dlg{--dlg-room:calc(100vh - max(12vh,var(--dlg-top,76px)) - 22px)}
.hq-dlg.mid{--dlg-room:calc(100vh - var(--dlg-top,76px) - 22px)}
.hq-dlg .k-foot{display:flex;align-items:center;gap:10px}
.hq-dlg .err{margin-top:10px;font:600 12px/1.3 var(--font-ui);color:var(--i-blocked)}
.hq-dlg .k-scroll:focus-visible,.hq-dlg .k-slot input:focus-visible,.hq-dlg textarea:focus-visible,.hq-dlg .k-index input:focus-visible{outline:none}
.hq-dlg .aside{color:var(--p3);font-weight:500}
.hq-dlg .two{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
.hq-dlg .nb{white-space:nowrap;display:inline-block;max-width:16em;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}

/* ---- command palette: a clipped index card (brass clamp, INDEX plaque on the search line, one sheet edge below) */
.hq-cmdk-clip{width:min(640px,100%)}
.hq-cmdk{width:100%;max-height:min(620px,calc(var(--dlg-room) - 30px));display:flex;flex-direction:column;min-height:0}
.hq-cmdk .top{flex:none;min-height:60px;padding-left:16px}
.hq-cmdk .top .k-plaque{flex:none}
.hq-cmdk .top .k-key{cursor:pointer}
.hq-cmdk ul{list-style:none;margin:0;padding:0 0 4px;overflow:auto;min-height:0;flex:1 1 auto;overscroll-behavior:contain}
.hq-cmdk .it .tx{flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;overflow:hidden}
.hq-cmdk .it .aside{font:500 12px/1 var(--font-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.hq-cmdk .it .kc{flex:none;display:inline-flex;align-items:center;margin-left:auto}
.hq-cmdk .it.off{cursor:default}
.hq-cmdk .it.off .nm{font-weight:500;color:var(--p3)}
.hq-cmdk .it .k-port.xs{width:26px;height:26px}
/* the state reads from the lamp's shape + colour; the word beside it stays pencil (no red/green/blue words in a list) */
.hq-cmdk .it .st{display:inline-flex;align-items:center;gap:6px;flex:none;font:600 12px/1 var(--font-ui);color:var(--p2);white-space:nowrap}
.hq-cmdk .it .st .k-state.k-state{color:var(--p2);font:600 12px/1 var(--font-ui)}
.hq-cmdk .it .st .t{font:12px/1 var(--font-mono);color:var(--p3)}
.hq-cmdk .it>.k-legend{margin-left:6px;font-size:12px;gap:10px;flex:none}
.hq-cmdk .none{padding:18px 22px;color:var(--p3);font:500 14px var(--font-ui)}
.hq-cmdk .foot{flex:none;border-top:1.5px solid var(--rule);margin-top:auto}

/* ---- T prompt strip / rename strip: one paper strip, To plaque, porthole, the serif line on an underline.
   placeBar() clamps the layer to the free world strip (roster, drawer, minimap and status card stay clear). */
.hq-pbar2{width:min(680px,100%);padding:12px 16px 10px}
.hq-pbar2 .ln{display:flex;align-items:center;gap:10px;min-height:34px}
.hq-pbar2 .who{font:700 14px/1 var(--font-ui);white-space:nowrap;max-width:12em;overflow:hidden;text-overflow:ellipsis}
.hq-pbar2 .k-slot{flex:1;min-width:0}
.hq-pbar2 .k-slot input{font:500 15px var(--font-voice)}
.hq-pbar2.confirming .k-slot input{color:var(--p3)}
.hq-pbar2 .k-foot{margin-top:10px;padding-top:8px;flex-wrap:wrap;row-gap:6px}
.hq-pbar2 .k-foot .say{flex:1;min-width:0;font:600 13px/1.3 var(--font-ui);color:var(--p2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hq-pbar2 .k-foot .say b{color:var(--p1)}
.hq-pbar2 .quick{flex-wrap:wrap;row-gap:6px}
.hq-pbar2 .quick .h{cursor:pointer}
.hq-pbar2 .quick .h:hover{color:var(--p1)}
.hq-pbar2.busy{opacity:.8}

/* ---- hire: a clipped work order */
.hq-hire{width:min(460px,100%)}
.hq-hire .k-paper{padding:26px 20px 16px;max-height:calc(var(--dlg-room) - 12px);display:flex;flex-direction:column;min-height:0}
.hq-hire .hd{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:30px;flex:none}
.hq-hire .hd h3{margin:0}
.hq-hire .k-scroll{margin:0 -20px;padding:0 20px}
.hq-hire .off{margin-top:12px;font:600 13px/1.4 var(--font-ui);color:var(--p2)}
.hq-hire .k-ledger{max-height:200px;overflow:auto;outline:none}
.hq-hire .k-ledger:focus-visible{box-shadow:inset 3px 0 0 var(--clay-light)}
.hq-hire .k-ledger .k-shield{margin-right:-2px}
.hq-hire textarea{display:block;width:100%;min-height:44px;resize:none;border:0;border-bottom:1.5px solid rgba(31,30,29,.55);background:none;outline:none;
  padding:4px 2px;color:var(--p1);font:500 15px/1.35 var(--font-voice)}
.hq-hire textarea::placeholder,.hq-hire input::placeholder{color:var(--p3);opacity:1}
.hq-hire textarea:focus{border-bottom-color:var(--clay)}
.hq-hire .k-slot input{font:600 14px var(--font-ui)}
.hq-hire .k-slot.mono input{font:500 13px var(--font-mono)}
.hq-hire.confirming .fields{pointer-events:none;opacity:.62}
.hq-hire .say{flex:none;margin:14px 0 0;font:600 14px/1.45 var(--font-ui);color:var(--p2)}
.hq-hire .say b{color:var(--p1)}
.hq-hire .say[hidden]{display:none}
.hq-hire .btns{flex:none;justify-content:flex-end;margin-top:14px}

/* ---- settings: a paper form in detent sections (one section at a time: the sheet stays <= 65vh, never a slab) */
.hq-settings{width:min(600px,100%);max-height:min(65vh,var(--dlg-room));display:flex;flex-direction:column;padding:18px 0 12px}
.hq-settings .hd{flex:none;display:flex;align-items:center;gap:12px;padding:0 22px 6px}
.hq-settings>.k-detent{flex:none;margin:0 22px;justify-content:flex-start;gap:4px}
.hq-settings>.k-detent>*{padding:0 10px}
.hq-settings .bd{flex:1 1 auto;min-height:min(250px,30vh);padding:0 22px 6px}
.hq-settings .sec{padding:4px 0 12px}
.hq-settings .k-field{margin-top:12px}
.hq-settings .k-field>.k-label .aside{font:500 11px var(--font-ui);letter-spacing:0}
.hq-settings .ticks{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-top:14px}
.hq-settings .ticks .k-tick{display:block;position:relative;padding-left:20px;white-space:normal;text-align:left;line-height:1.35}
.hq-settings .ticks .k-tick i{position:absolute;left:0;top:3px}
.hq-settings .k-tick[disabled]{cursor:default;opacity:.75}
.hq-settings .os{display:flex;align-items:center;gap:10px;font:500 13px var(--font-ui);color:var(--p2)}
.hq-settings .k-ledger{margin-top:14px;padding-left:0}
.hq-settings .k-foot{flex:none;display:flex;align-items:center;margin:0 22px;padding-top:10px}

/* ---- help: a notice board holding three paper sheets side by side; the sheets scroll inside the board's groove */
.hq-help:focus-visible,.hq-settings:focus-visible{outline:none}
.hq-help{width:min(980px,100%);max-height:var(--dlg-room);display:flex;flex-direction:column;padding:16px 18px 16px}
.hq-help .hd{flex:none;display:flex;align-items:center;gap:14px;margin-bottom:12px}
.hq-help .intro{flex:1;min-width:0;margin:0;font:500 13px/1.4 var(--font-ui);color:var(--t2)}
.hq-help .k-scroll{flex:1 1 auto;margin:0 -6px;padding:2px 6px 4px}
.hq-help .k-sheets{grid-template-columns:repeat(3,minmax(0,1fr));align-items:start}
.hq-help .k-sheets>.k-paper{padding:14px 16px 10px}
.hq-help .k-sheets h4+.k-kl{margin-top:0}
.hq-help .k-sheets .k-kl+h4{margin-top:16px}
.hq-help .k-kl{align-items:flex-start;padding:5px 0;line-height:1.35}
.hq-help .k-kl .ks{padding-top:0;flex:none}
.hq-help .k-kl .ks.w{min-width:94px}
.hq-help .k-kl .ks .k-state{font-size:13px;color:var(--p1)}
.hq-help .k-kl .d{color:var(--p2);font-size:12px}
.hq-help .note{margin:6px 0 0;font:500 12px/1.4 var(--font-ui);color:var(--p3)}
.hq-help .k-ledger{margin-top:12px;padding:10px 0 0;border-top:1.5px dashed var(--stitch)}
.hq-help .k-ledger li{height:32px;font-size:13px}
@media (max-width:820px){.hq-help .k-sheets{grid-template-columns:1fr}}

/* ---- keys (?): the Help board's layout. Plaque + scope detent, a lead line, then sheets that end at their content
   (never equal-height slabs) and scroll inside the board's groove below the lead when the window is short. */
.hq-keys:focus-visible{outline:none}
.hq-keys{width:min(1060px,100%);max-height:var(--dlg-room);display:flex;flex-direction:column;padding:16px 18px 16px}
.hq-keys .hd{flex:none;display:flex;align-items:center;gap:14px;margin-bottom:10px}
.hq-keys .hd .k-detent{flex:none;width:min(440px,60%)}
.hq-keys .lead{flex:none;margin:0 0 12px;font:500 13px/1.4 var(--font-ui);color:var(--t2)}
.hq-keys .k-scroll{flex:1 1 auto;margin:0 -6px;padding:2px 6px 4px}
.hq-keys .k-sheets{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));align-items:start}
.hq-keys .k-sheets>.k-paper{padding:12px 16px 8px}
.hq-keys .k-kl dd{margin:0;color:var(--p2)}
.hq-keys .k-kl dt{flex:none}
.hq-keys .k-kl{padding:3px 0}
.hq-keys .k-kl .ks{flex-wrap:wrap;min-width:76px;max-width:130px;row-gap:3px}
.hq-keys .k-kl .ks .or{color:var(--p3);font-size:11px;padding:0 2px}
.hq-keys .k-kl .ks .tx{color:var(--p3);font-size:11px}
@media (max-width:820px){.hq-keys .k-sheets{grid-template-columns:1fr}}

/* ---- tour: Ada's sheet, bottom-centre of the visible world strip (non-modal) */
.hq-coach{position:absolute;bottom:22px;left:calc(var(--world-l,0px) + (100% - var(--world-l,0px) - var(--world-r,0px)) / 2);transform:translateX(-50%);
  width:min(540px,calc(100vw - 32px));padding:16px 20px 14px;display:none;pointer-events:auto;z-index:30}
.hq-coach.show{display:block}
.hq-coach.bump{animation:hq-coach-in .32s var(--ease)}
@keyframes hq-coach-in{0%{transform:translate(-50%,12px);opacity:0}100%{transform:translateX(-50%);opacity:1}}
.hq-coach .hd{display:flex;gap:14px;align-items:flex-start}
.hq-coach .hd>.say{flex:1;min-width:0}
.hq-coach .tx{margin:10px 0 0;font:500 16.5px/1.4 var(--font-voice);color:var(--p1)}
.hq-coach .tx .k-key{vertical-align:1px}
.hq-coach .k-foot{display:flex;align-items:center;gap:10px;margin-top:14px}
.hq-coach .dots{display:flex;gap:6px;align-items:center}
.hq-coach .nice{display:none}
.hq-coach.ok .nice{display:inline-flex}
@media (prefers-reduced-motion:reduce){.hq-dlg>*,.hq-coach.bump{animation:none}}
`;

/**
 * Anchor a modal layer below the HUD tally: `--dlg-top` = the bottom of the HUD's top strip (tally on its rods, which
 * wraps to a second row on narrow windows) + 14 px. Call on open and on resize.
 */
export function anchorBelowHud(wrap: HTMLElement): void {
  const top = wrap.ownerDocument?.querySelector?.('.hq-top');
  const r = top?.getBoundingClientRect?.();
  const b = r && r.height > 0 ? Math.round(r.bottom) : 62;
  wrap.style.setProperty('--dlg-top', `${Math.max(62, b) + 14}px`);
}

/** Inject the dialog CSS once (after the kit + global sheets, so these rules win their ties). */
export function injectDialogCss() {
  if (typeof document === 'undefined' || document.getElementById('hq-ui-css-dialogs')) return;
  const s = document.createElement('style');
  s.id = 'hq-ui-css-dialogs';
  s.textContent = CSS;
  document.head.appendChild(s);
}
