/**
 * UI kit stylesheet (docs/design/ui-kit.md, "Workshop Signage"; visual reference renderer/ui-lab/final.html, whose
 * `k-*` class names these are). Injected once by `injectKit()` BEFORE the surface styles, so surface CSS can still
 * position kit parts. Colours are CSS custom properties from kit/tokens.ts (= shared/palette.ts); no hex here.
 * Materials: board (scan) · paper (decide) · plaque · readout. Parts: keycap, legend, lamp, state word, button, icon
 * button, slot, detent, switch, tick, circled, fader, porthole, shield, unread, gauge, stamp, highlight, ledger,
 * question, post-it, ticket, printout, slip, tally, rail, aim tag, minimap frame, chevron sign, hotbar, group header,
 * row, tab, index card, clip/deck. Owner: UI (kit).
 */

export const KIT_CSS = `
/* ============================================================ MATERIALS */
/* BOARD: painted ink in a walnut rim, for SCANNING. Rim + grain are mandatory on every tier (only the noise drops). */
.k-board{position:relative;background:var(--grain),linear-gradient(180deg,var(--f-board-top),var(--board) 30%,var(--f-board-bot));border-radius:var(--r-board);color:var(--t1);
  box-shadow:0 0 0 1px var(--f-rim-dark),0 0 0 5px var(--walnut),0 0 0 6px var(--walnut-lo),inset 0 1px 0 rgba(255,236,210,.06),inset 0 0 0 1px rgba(0,0,0,.5),var(--d2)}
.k-board::before{content:"";position:absolute;inset:-5px;border-radius:var(--r-rim);pointer-events:none;background:var(--woodgrain),linear-gradient(180deg,rgba(255,220,180,.10),transparent 40%);
  -webkit-mask:linear-gradient(black 0 0) content-box,linear-gradient(black 0 0);-webkit-mask-composite:xor;mask-composite:exclude;padding:5px;opacity:.9}
.k-board::after{content:"";position:absolute;inset:-5px;border-radius:var(--r-rim);pointer-events:none;box-shadow:inset 0 1px 0 rgba(255,220,180,.35),inset 0 -1px 0 rgba(0,0,0,.4)}
/* PAPER: cream stock, for READING and DECIDING. Never paper in paper. */
.k-paper{position:relative;color:var(--p1);background:var(--fibre),linear-gradient(180deg,var(--paper),var(--f-paper-lo));border-radius:var(--r-paper);
  box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 0 0 1px rgba(80,60,40,.18),0 2px 0 var(--f-edge1),0 3px 0 var(--f-edge2),0 16px 30px -10px rgba(40,24,10,.5),0 4px 8px rgba(40,24,10,.2)}
.k-paper.tilt{transform:rotate(.35deg)}
/* CLIP: brass clamp on a sheet (status card, inbox, hire). DECK: at most 2 sheet edges below. */
.k-clip{position:relative;padding-top:12px}
.k-clip>.k-paper{padding-top:26px}
.k-clamp{position:absolute;left:50%;top:0;width:92px;height:22px;margin-left:-46px;border-radius:6px 6px 9px 9px;z-index:3;
  background:linear-gradient(180deg,var(--brass-hi),var(--brass) 50%,var(--brass-lo));box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 3px 4px rgba(40,24,10,.45)}
.k-clamp::after{content:"";position:absolute;left:50%;top:5px;width:22px;height:8px;margin-left:-11px;border-radius:4px;background:var(--f-clasp);box-shadow:inset 0 1px 2px rgba(0,0,0,.9)}
.k-deck{position:relative;isolation:isolate}
.k-deck::before,.k-deck::after{content:"";position:absolute;left:10px;right:10px;height:14px;bottom:-8px;border-radius:0 0 4px 4px;background:var(--f-deck1);
  box-shadow:0 0 0 1px rgba(80,60,40,.18),0 6px 10px -4px rgba(40,24,10,.4);z-index:-1}
.k-deck::after{left:22px;right:22px;bottom:-16px;background:var(--f-deck2)}
.k-deck.one::after{display:none}
/* PLAQUE: teal enamel, cream keyline, rivets. ONE per surface, as its title. .sm = no rivets. */
.k-plaque{display:inline-flex;align-items:center;gap:8px;position:relative;padding:5px 20px;border-radius:var(--r-plaque);white-space:nowrap;flex:none;
  background:linear-gradient(180deg,var(--f-enamel-hi),var(--enamel) 55%,var(--f-enamel-lo));color:var(--cream);
  font:800 12.5px/1 var(--font-sign);letter-spacing:.14em;text-transform:uppercase;font-stretch:condensed;
  box-shadow:inset 0 0 0 2px var(--enamel),inset 0 0 0 3px rgba(244,237,227,.75),0 2px 0 var(--f-enamel-lip),0 3px 6px rgba(28,16,8,.35)}
.k-plaque::before,.k-plaque::after{content:"";position:absolute;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,var(--brass-hi),var(--brass) 45%,var(--brass-lo));box-shadow:0 1px 0 rgba(0,0,0,.4)}
.k-plaque::before{left:7px}.k-plaque::after{right:7px}
.k-plaque.sm{padding:4px 10px;font-size:11px}.k-plaque.sm::before,.k-plaque.sm::after{display:none}
.k-plaque.clay{background:linear-gradient(180deg,var(--f-clay-hi),var(--clay) 55%,var(--f-clay-mid));color:var(--ink);
  box-shadow:inset 0 0 0 2px var(--clay),inset 0 0 0 3px rgba(31,30,29,.45),0 2px 0 var(--clay-deep),0 3px 6px rgba(28,16,8,.35)}
.k-plaque.butter{background:linear-gradient(180deg,var(--f-butter-hi),var(--butter) 55%,var(--f-butter-lo));color:var(--ink);
  box-shadow:inset 0 0 0 2px var(--butter),inset 0 0 0 3px rgba(31,30,29,.55),0 2px 0 var(--f-butter-lip),0 3px 6px rgba(28,16,8,.35)}
.k-plaque.slate{background:linear-gradient(180deg,var(--ink2),var(--board-hi));color:var(--t2);box-shadow:inset 0 0 0 1px rgba(244,237,227,.25),0 2px 0 var(--f-rim-dark)}
/* READOUT: glass, one brass ring, dot-matrix canvas. Only the three §2.1 places. */
.k-readout{display:inline-flex;align-items:center;gap:7px;padding:4px 7px;border-radius:var(--r-readout);flex:none;background:radial-gradient(120% 90% at 50% 0%,var(--board-lo),var(--glass));
  box-shadow:inset 0 2px 4px rgba(0,0,0,.8),inset 0 0 0 1px rgba(0,0,0,.95),0 0 0 2px var(--brass-lo),0 1px 0 2px var(--brass)}
.k-readout canvas{display:block}

/* ============================================================ DIVIDERS */
.k-groove{height:2px;flex:none;background:linear-gradient(var(--f-groove) 0 1px,rgba(255,236,210,.06) 1px 2px);border:0;margin:0}
.k-stitch{height:0;flex:none;border:0;border-top:1.5px dashed var(--stitch);margin:0}

/* ============================================================ TYPE */
.k-sign{font:800 11.5px/1 var(--font-sign);letter-spacing:.14em;text-transform:uppercase;font-stretch:condensed}
.k-label{font:700 11px/1 var(--font-sign);letter-spacing:.04em;color:var(--t3)}
.k-paper .k-label{color:var(--p3)}
.k-voice{font-family:var(--font-voice);font-weight:500;font-style:normal}
.k-mono{font-family:var(--font-mono)}
.k-t2{color:var(--t2)}.k-t3{color:var(--t3)}.k-p2{color:var(--p2)}.k-p3{color:var(--p3)}
.k-sp{flex:1}
.k-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ============================================================ PARTS */
/* KEYCAP: cream type-block, same on every material. Letters in the sign font (O≠0, I≠1); symbols in mono. */
.k-key{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;border-radius:var(--r-key);flex:none;
  font:800 11px/1 var(--font-sign);color:var(--ink);background:linear-gradient(180deg,var(--paper),var(--oat));
  box-shadow:inset 0 0 0 1px rgba(80,60,40,.28),0 2px 0 var(--f-key-lip),0 2px 0 1px rgba(40,30,20,.25);vertical-align:1px;white-space:nowrap;
  text-transform:none;letter-spacing:normal;font-stretch:normal} /* a cap shows its own label, even inside a caps heading */
.k-key.sym{font-family:var(--font-mono);font-weight:700}
.k-key.glyph{position:relative;color:transparent;min-width:21px}
.k-key.glyph::after{content:'';position:absolute;inset:0;margin:auto;width:11px;height:11px;background:var(--ink);-webkit-mask:var(--g) center/contain no-repeat;mask:var(--g) center/contain no-repeat}
.k-key.sm.glyph::after{width:9px;height:9px}
.k-key.g-ret{--g:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M10 2.2v3.6a1.6 1.6 0 0 1-1.6 1.6H2.6M5 4.8 2.4 7.4 5 10' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.k-key.g-up{--g:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M6 10.2V2M2.6 5.2 6 1.8l3.4 3.4' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.k-key.g-dn{--g:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M6 1.8v8.2M2.6 6.8 6 10.2l3.4-3.4' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.k-key.g-lt{--g:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M10.2 6H2M5.2 2.6 1.8 6l3.4 3.4' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.k-key.g-rt{--g:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M1.8 6h8.2M6.8 2.6 10.2 6l-3.4 3.4' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.k-key.g-sh{--g:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M6 1.6 1.8 6.2h2.4v4h3.6v-4h2.4Z' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.k-key.g-bs{--g:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M4 2.4h6.4v7.2H4L1.4 6ZM5.8 4.6l2.8 2.8M8.6 4.6 5.8 7.4' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.k-key.sm{height:16px;min-width:16px;font-size:11px;padding:0 4px}
.k-keys{display:inline-flex;align-items:center;gap:3px}
.k-keys .to{padding:0 1px}
/* LEGEND: the single key strip of a surface. The Leader is shown once, then "then". */
.k-legend{display:flex;align-items:center;gap:16px;flex-wrap:wrap;color:var(--t2);font-size:12px}
.k-paper .k-legend,.k-graph .k-legend{color:var(--p2)}
.k-legend .h{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.k-legend .then{color:var(--t3);margin:0 -8px 0 -10px}
.k-paper .k-legend .then,.k-graph .k-legend .then{color:var(--p3)}
.k-legend.tight{gap:12px}
/* LAMP: status = bezel shape + lit glass (+ word or aria-label). The blocked pulse is the only loop in the UI. */
svg.k-lamp{width:14px;height:14px;flex:none;overflow:visible;vertical-align:-2px}
svg.k-lamp.sm{width:12px;height:12px} .k-lamp-gap{width:14px;height:14px;flex:none} svg.k-lamp.lg{width:18px;height:18px}
.k-lamp.working{color:var(--s-working);filter:drop-shadow(0 0 3px rgba(79,163,232,.7))}
.k-lamp.blocked{color:var(--s-blocked);filter:drop-shadow(0 0 4px rgba(239,90,76,.9));animation:k-pulse 1.4s ease-in-out infinite}
.k-lamp.blocked.still{animation:none}
.k-lamp.done{color:var(--s-done);filter:drop-shadow(0 0 3px rgba(99,196,138,.6))}
.k-lamp.idle{color:var(--f-lamp-idle)}
.k-lamp.shell{color:var(--s-shell);filter:drop-shadow(0 0 3px rgba(127,227,160,.6))}
.k-lamp.busy{color:var(--s-busy);filter:drop-shadow(0 0 3px rgba(244,184,96,.6))}
.k-lamp.unknown{color:var(--s-unknown)}
.k-lamp.peek{color:var(--butter);filter:drop-shadow(0 0 3px rgba(241,198,110,.7))}
.k-lamp.seen{color:var(--clay)}
.k-paper .k-lamp{filter:none}
@keyframes k-pulse{50%{filter:drop-shadow(0 0 1px rgba(239,90,76,.3));opacity:.72}}
/* STATE WORD: lamp + sentence-case word, tinted for the material. */
.k-state{display:inline-flex;align-items:center;gap:6px;font:650 12px/1 var(--font-ui);white-space:nowrap}
.k-state.blocked{color:var(--b-blocked)}.k-state.working{color:var(--b-working)}.k-state.done{color:var(--b-done)}.k-state.idle{color:var(--t3)}
.k-state.shell{color:var(--b-shell)}.k-state.busy{color:var(--b-busy)}.k-state.unknown{color:var(--b-unknown)}
.k-paper .k-state.blocked{color:var(--i-blocked)}.k-paper .k-state.working{color:var(--i-working)}.k-paper .k-state.done{color:var(--i-done)}
.k-paper .k-state.idle{color:var(--p3)}.k-paper .k-state.busy,.k-paper .k-state.shell{color:var(--i-busy)}.k-paper .k-state.unknown{color:var(--i-unknown)}
/* BUTTON: key tile on the LEFT, sentence case. primary = clay face + INK text (max one per surface). Plain = a material,
   never a bare keyline: a raised BOARD KEY (painted key with a rim-dark lip) on the board, a PRESSED TAB (debossed into
   the stock) on paper. Both travel 2 px when pressed, like the primary. */
.k-btn{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px 0 6px;border-radius:var(--r-btn);border:0;cursor:pointer;white-space:nowrap;flex:none;
  font:700 13px/1 var(--font-ui);color:var(--t1);background:var(--grain),linear-gradient(180deg,var(--f-tab-hi),var(--f-tab-lo));
  box-shadow:inset 0 1px 0 rgba(255,236,210,.09),inset 0 0 0 1px rgba(0,0,0,.5),0 2px 0 var(--f-rim-dark),0 3px 5px rgba(0,0,0,.35);transition:background .12s,transform .16s var(--ease),box-shadow .12s}
.k-btn:hover{background:var(--grain),linear-gradient(180deg,var(--ink2),var(--f-tab-hi))}
.k-btn:active{transform:translateY(2px);box-shadow:inset 0 1px 0 rgba(255,236,210,.06),inset 0 0 0 1px rgba(0,0,0,.5),0 0 0 var(--f-rim-dark)}
.k-btn.nokey{padding-left:12px}
.k-btn.sm{height:26px;font-size:12px}
.k-btn[disabled]{opacity:.45;cursor:default;transform:none}
.k-paper .k-btn{color:var(--p1);background:linear-gradient(180deg,rgba(120,96,70,.10),rgba(120,96,70,.04));
  box-shadow:inset 0 1px 2px rgba(60,40,20,.28),inset 0 0 0 1px rgba(80,60,40,.26),0 1px 0 rgba(255,255,255,.75)}
.k-paper .k-btn:hover{background:linear-gradient(180deg,rgba(120,96,70,.15),rgba(120,96,70,.07))}
.k-paper .k-btn:active{transform:translateY(1px);box-shadow:inset 0 2px 3px rgba(60,40,20,.38),inset 0 0 0 1px rgba(80,60,40,.32),0 1px 0 rgba(255,255,255,.75)}
.k-btn.primary,.k-paper .k-btn.primary{color:var(--ink);background:linear-gradient(180deg,var(--f-clay-hi),var(--clay));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 3px 0 var(--clay-deep),0 4px 6px rgba(60,20,10,.3)}
.k-btn.primary:hover{background:linear-gradient(180deg,var(--f-clay-glow),var(--f-clay-hi))}
.k-btn.primary:active{transform:translateY(2px);box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 1px 0 var(--clay-deep)}
.k-btn.primary .k-key{background:linear-gradient(180deg,var(--f-clay-key-hi),var(--f-clay-key-lo));box-shadow:inset 0 0 0 1px rgba(80,30,10,.3),0 1px 0 var(--clay-deep)}
/* ICON BUTTON: toolbars only; the tooltip names the key. */
.k-ibtn{width:26px;height:26px;display:inline-grid;place-items:center;border-radius:var(--r-plaque);color:var(--t2);border:0;background:none;cursor:pointer;flex:none;transition:color .12s,background .12s}
.k-ibtn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.k-ibtn:hover{color:var(--t1);background:rgba(244,237,227,.06)}
.k-ibtn.on,.k-ibtn[aria-pressed=true]{color:var(--brass-hi)}
.k-paper .k-ibtn{color:var(--p2)} .k-paper .k-ibtn:hover{color:var(--p1);background:rgba(90,84,77,.08)}
/* SLOT: text input. Recessed on the board, an underline on paper. */
.k-slot{display:flex;align-items:center;gap:8px;height:34px;padding:0 8px 0 10px;border-radius:var(--r-plaque);background:var(--board-lo);box-shadow:var(--recess);color:var(--t3);font:12px var(--font-mono)}
.k-slot svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;flex:none}
.k-slot input{flex:1;min-width:0;height:100%;background:none;border:0;outline:none;color:var(--t1);font:inherit;padding:0}
.k-slot input::placeholder{color:var(--t3);opacity:1}
.k-slot:focus-within{box-shadow:var(--recess),0 0 0 2px var(--clay-light)}
.k-paper .k-slot{background:none;box-shadow:none;border-bottom:1.5px solid rgba(31,30,29,.55);border-radius:0;color:var(--p1);padding:0 2px;font:600 15px var(--font-ui)}
.k-paper .k-slot input{color:var(--p1)} .k-paper .k-slot input::placeholder{color:var(--p3)}
.k-paper .k-slot:focus-within{box-shadow:0 1.5px 0 var(--clay)}
.k-slot.voice input{font:500 15px var(--font-voice)}
/* DETENT: THE one tab/segment control. Labels light up, a clay notch under the active one; never a filled segment. */
.k-detent{position:relative;display:flex;padding:0 2px;height:30px;border-radius:var(--r-plaque);background:var(--board-lo);box-shadow:var(--recess)}
.k-detent>*{flex:1;display:grid;place-items:center;padding:0 6px;font:650 12px/1 var(--font-ui);color:var(--t3);position:relative;white-space:nowrap;border:0;background:none;cursor:pointer}
.k-detent>*:hover{color:var(--t2)}
.k-detent>.on{color:var(--t1)}
.k-detent>.on::after{content:"";position:absolute;bottom:3px;left:50%;width:18px;margin-left:-9px;height:3px;border-radius:2px;background:var(--clay);box-shadow:0 0 6px rgba(217,119,87,.7)}
.k-paper .k-detent{background:none;box-shadow:none;border-bottom:1.5px solid var(--stitch);border-radius:0;height:32px}
.k-paper .k-detent>*{color:var(--p2)} .k-paper .k-detent>*:hover{color:var(--p1)} .k-paper .k-detent>.on{color:var(--p1);font-weight:750}
.k-paper .k-detent>.on::after{bottom:-2px;width:70%;left:15%;margin:0;box-shadow:none}
/* SWITCH: a binary mode, as a BRASS TOGGLE LEVER in a riveted gate: the bat leans toward the live label. The knob is
   brass on the left and turns lit CLAY on the input-changing side (Control). */
.k-switch{display:inline-flex;align-items:center;gap:9px;padding:5px 10px;border-radius:var(--r-btn);background:var(--board-lo);box-shadow:var(--recess);border:0;cursor:pointer;flex:none}
.k-switch .lb{font:650 12px/1 var(--font-ui);color:var(--t3);transition:color .12s}
.k-switch .lb.on{color:var(--t1)}
.k-switch .track{position:relative;width:36px;height:18px;border-radius:var(--r-plaque);flex:none;
  background:radial-gradient(60% 50% at 50% 100%,rgba(0,0,0,.55),transparent),linear-gradient(180deg,var(--f-groove),var(--board-lo));
  box-shadow:inset 0 1px 3px rgba(0,0,0,.9),0 0 0 1px var(--brass-lo),0 0 0 2px rgba(0,0,0,.35),0 1px 0 2px rgba(255,236,210,.07)}
.k-switch .track::after{content:"";position:absolute;left:50%;bottom:1px;width:12px;height:5px;margin-left:-6px;border-radius:var(--r-btn) var(--r-btn) var(--r-hair) var(--r-hair);z-index:1;
  background:radial-gradient(circle at 45% 20%,var(--brass-hi),var(--brass) 55%,var(--brass-lo));box-shadow:inset 0 -1px 0 rgba(0,0,0,.35),0 1px 1px rgba(0,0,0,.6)}
.k-switch .track i{position:absolute;left:50%;bottom:3px;width:3px;height:11px;margin-left:-1.5px;border-radius:1px;transform-origin:50% 100%;transform:rotate(-34deg);
  background:linear-gradient(90deg,var(--brass-lo),var(--brass-hi) 45%,var(--brass) 70%,var(--brass-lo));box-shadow:1px 1px 1px rgba(0,0,0,.5);transition:transform .2s var(--ease)}
.k-switch .track i::after{content:"";position:absolute;left:50%;top:-3px;width:7px;height:7px;margin-left:-3.5px;border-radius:var(--r-round);
  background:radial-gradient(circle at 38% 30%,var(--brass-hi),var(--brass) 55%,var(--brass-lo));box-shadow:0 1px 1px rgba(0,0,0,.6)}
.k-switch:hover .track i::after{filter:brightness(1.12)}
.k-switch.right .track i{transform:rotate(34deg)}
.k-switch.right .track i::after{background:radial-gradient(circle at 38% 30%,var(--f-clay-glow),var(--clay) 55%,var(--clay-deep));box-shadow:0 1px 1px rgba(0,0,0,.6),0 0 6px rgba(217,119,87,.75)}
/* TICK: an on/off filter or option; off reads unchecked, not disabled. On the BOARD a brass-bezelled indicator window that
   lights warm cream with an inked check; on PAPER a hand-drawn box that gets a clay-ink tick overshooting its corner
   (the same ink as the circled choice). The glyphs are masks (tokens --m-tick-box / --m-tick-mark), coloured by var. */
.k-tick{display:inline-flex;align-items:center;gap:7px;font:650 12px/1 var(--font-ui);color:var(--t1);white-space:nowrap;border:0;background:none;cursor:pointer;padding:2px 0}
.k-tick i{position:relative;width:14px;height:14px;margin-left:2px;border-radius:var(--r-hair);font-style:normal;flex:none;background:radial-gradient(circle at 50% 30%,var(--board-hi),var(--f-lamp-idle-glass) 70%);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.9),0 0 0 1px var(--brass-lo),0 0 0 2px rgba(0,0,0,.4),0 1px 0 2px rgba(255,236,210,.06);transition:background .12s,box-shadow .12s}
.k-tick i::after{content:"";position:absolute;inset:1px;background:var(--f-butter-bulb);-webkit-mask:var(--m-tick-mark) center/contain no-repeat;mask:var(--m-tick-mark) center/contain no-repeat;opacity:0;transition:opacity .12s}
.k-tick.on i{background:radial-gradient(circle at 50% 55%,rgba(246,214,142,.42),rgba(193,150,47,.16) 55%,var(--f-lamp-idle-glass) 90%);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.7),0 0 0 1px var(--brass),0 0 0 2px rgba(0,0,0,.4),0 0 6px 1px rgba(246,214,142,.28)}
.k-tick.on i::after{opacity:1}
.k-tick:hover:not(.on) i::after{opacity:.2}
.k-tick:not(.on){color:var(--t2)}
.k-tick:hover:not(.on) i{box-shadow:inset 0 1px 2px rgba(0,0,0,.85),0 0 0 1px var(--brass),0 0 0 2px rgba(0,0,0,.4)}
.k-tick[disabled]{cursor:default;opacity:.6}
.k-paper .k-tick{color:var(--p1)}
.k-paper .k-tick i{background:none;box-shadow:none;border-radius:0;overflow:visible;margin-left:0}
.k-paper .k-tick i::before{content:"";position:absolute;inset:-1px;background:var(--p2);-webkit-mask:var(--m-tick-box) center/contain no-repeat;mask:var(--m-tick-box) center/contain no-repeat}
.k-paper .k-tick i::after{inset:-5px -7px 0 -1px;background:var(--clay-deep);transform:rotate(-4deg);transition:none}
.k-paper .k-tick.on i{background:none;box-shadow:none}
.k-paper .k-tick:hover:not(.on) i{box-shadow:none}
.k-tick .aside{color:var(--p3);font-weight:500}
/* CIRCLED: single value choice on PAPER forms; the chosen word gets a hand-drawn clay ellipse. */
.k-circled{display:inline-flex;gap:10px;flex-wrap:wrap;padding:4px 5px}
.k-circled>*{position:relative;padding:3px 6px;font:600 13px/1.2 var(--font-ui);color:var(--p2);border:0;background:none;cursor:pointer}
.k-circled>*:hover{color:var(--p1)}
.k-circled>.on{color:var(--p1);font-weight:750}
.k-circled>.on::after{content:"";position:absolute;inset:-4px -4px -4px -5px;pointer-events:none;background:var(--circle-ink) center/100% 100% no-repeat}
/* FADER: a number on paper; oat track, clay fill + knob, mono value beside it. Arrow keys step. */
.k-fader{display:inline-flex;align-items:center;gap:12px;cursor:pointer}
.k-fader .trk{position:relative;width:180px;height:18px;flex:none}
.k-fader .trk::before{content:"";position:absolute;left:0;right:0;top:8px;height:3px;border-radius:2px;background:var(--oat);box-shadow:inset 0 1px 1px rgba(0,0,0,.25)}
.k-fader b{position:absolute;top:8px;left:0;height:3px;border-radius:2px;background:var(--clay-light)}
.k-fader i{position:absolute;top:2px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:radial-gradient(circle at 40% 30%,var(--f-clay-glow),var(--clay) 55%,var(--clay-deep));box-shadow:0 1px 2px rgba(0,0,0,.35)}
.k-fader .val{font:600 12px var(--font-mono);color:var(--p1);min-width:44px}
/* PORTHOLE: live portrait in a brass ring; the INNER RIM is the workspace colour (--ws). Replaces workspace chips. */
.k-port{flex:none;width:36px;height:36px;border-radius:50%;padding:2.5px;background:conic-gradient(from 200deg,var(--brass-hi),var(--brass-lo),var(--brass),var(--brass-hi),var(--brass-lo),var(--brass-hi));box-shadow:0 2px 3px rgba(28,16,8,.45)}
.k-port>div{width:100%;height:100%;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,var(--f-enamel-port),var(--enamel));box-shadow:inset 0 0 0 2.5px var(--ws,var(--slate))}
.k-port>div>svg,.k-port>div>img,.k-port>div>canvas{width:100%;height:100%;display:block}
.k-port.xs{width:22px;height:22px;padding:1.5px}.k-port.xs>div{box-shadow:inset 0 0 0 1.5px var(--ws,var(--slate))}
.k-port.lg{width:56px;height:56px;padding:3px}.k-port.lg>div{box-shadow:inset 0 0 0 3.5px var(--ws,var(--slate))}
.k-port.shell>div{background:radial-gradient(circle at 50% 30%,var(--f-shell-port-hi),var(--f-shell-port-lo))}
.k-port .pin{position:absolute}
/* SHIELD: enamel workspace crest; only in the drawer breadcrumb, a card head and the hire list. */
.k-shield{display:inline-grid;place-items:center;width:14px;height:14px;flex:none;vertical-align:-2px}
.k-shield svg{width:100%;height:100%;display:block;filter:drop-shadow(0 1px 0 rgba(0,0,0,.35))}
/* UNREAD: butter bulb (+ mono count when > 1). Never a status colour. */
.k-unread{display:inline-flex;align-items:center;gap:4px;flex:none;font:700 11px/1 var(--font-mono);color:var(--butter)}
.k-unread::before{content:"";width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 40% 35%,var(--f-butter-bulb),var(--butter) 60%,var(--f-butter-deep));box-shadow:0 0 6px rgba(241,198,110,.8)}
.k-paper .k-unread{color:var(--i-busy)}
.k-unread[hidden]{display:none}
/* NOTE glyph: a folded butter corner after the name */
.k-note{display:inline-block;width:10px;height:10px;flex:none;background:linear-gradient(135deg,var(--butter) 0 65%,var(--f-butter-deep) 65%);border-radius:1px}
/* GAUGE: context meter; rows only at >= 80 % or when selected. */
.k-gauge{display:inline-flex;align-items:center;gap:6px;font:11px/1 var(--font-mono);color:var(--t3);white-space:nowrap}
.k-gauge .bar{position:relative;width:44px;height:5px;border-radius:3px;background:var(--board-lo);box-shadow:inset 0 1px 2px rgba(0,0,0,.7);flex:none}
.k-gauge .bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,var(--sage),var(--butter))}
.k-gauge.hot{color:var(--b-busy)} .k-gauge.hot .bar i{background:linear-gradient(90deg,var(--butter),var(--s-busy))}
.k-paper .k-gauge{color:var(--p2)} .k-paper .k-gauge.hot{color:var(--i-busy)} .k-paper .k-gauge .bar{background:var(--oat);box-shadow:inset 0 1px 1px rgba(0,0,0,.2)}
/* STAMP: worn rubber-stamp ink (#inked). Paper only; max one per sheet. */
.k-stamp{display:inline-flex;align-items:center;gap:6px;padding:5px 8px 4px;border:2.5px solid currentColor;border-radius:var(--r-key);color:var(--i-blocked);flex:none;
  font:900 12px/1 var(--font-sign);letter-spacing:.12em;text-transform:uppercase;font-stretch:condensed;transform:rotate(-5deg);filter:url(#inked);mix-blend-mode:multiply;white-space:nowrap}
.k-stamp .t{font:800 13px/1 var(--font-mono);letter-spacing:0}
.k-stamp.done{color:var(--i-done)} .k-stamp.locked{color:var(--i-blocked)} .k-stamp.ready{color:var(--i-done)}
/* HIGHLIGHT: selection on paper; a clay highlighter swipe + a clay ▸ in the margin. */
.k-hl{position:relative;isolation:isolate}
.k-hl::after{content:"";position:absolute;left:0;right:0;top:4px;bottom:4px;z-index:-1;border-radius:3px 12px 4px 12px;
  background:linear-gradient(100deg,rgba(217,119,87,.26),rgba(235,162,131,.36) 60%,rgba(217,119,87,.18))}
.k-hl::before{content:"";position:absolute;left:-13px;top:50%;border:6px solid transparent;border-left:8px solid var(--clay);margin-top:-6px}
mark.k-match{background:linear-gradient(180deg,transparent 35%,rgba(241,198,110,.75) 35% 88%,transparent 88%);color:inherit;padding:0 1px}
/* LEDGER: THE prompt-options component (roster, status card, inbox, triage). [n] label; 1-9 pick, Enter confirms. */
.k-ledger{margin:0;padding:0 0 0 14px;list-style:none}
.k-ledger li{position:relative;display:flex;align-items:center;gap:11px;height:36px;padding:0 8px;border-bottom:1.5px dashed var(--stitch);font:650 14px/1.2 var(--font-ui);cursor:pointer}
.k-ledger li:last-child{border-bottom:0}
.k-ledger li .note{margin-left:auto;padding-left:8px;font:650 11px/1 var(--font-ui);color:var(--i-blocked);white-space:nowrap}
.k-ledger li .note.meta{color:var(--p3)}
.k-ledger li .kc{flex:none;display:inline-flex;align-items:center;margin-left:auto;padding-left:14px}
.k-ledger li .note~.kc{margin-left:0;padding-left:10px}
.k-ledger li .tx{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k-ledger li:not(.k-hl):hover{background:rgba(90,84,77,.05)}
.k-ledger.board{padding-left:12px}
.k-ledger.board li{height:28px;font-size:12px;color:var(--t1);border-bottom-color:rgba(255,236,210,.1);padding:0 4px;gap:9px}
.k-ledger.board li .note{color:var(--b-blocked)} .k-ledger.board li .note.meta{color:var(--t3)}
.k-ledger.board li:not(.k-hl):hover{background:rgba(244,237,227,.04)}
.k-ledger.board .k-hl::after{background:linear-gradient(100deg,rgba(217,119,87,.34),rgba(217,119,87,.14))}
/* LEDGER .wrap: a long option label runs to 2 lines (read what you approve without the terminal) */
.k-ledger.wrap li{height:auto;min-height:36px;padding-top:7px;padding-bottom:7px}
.k-ledger.wrap li .tx{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-height:1.3}
.k-ledger.board.wrap li{min-height:28px;padding-top:5px;padding-bottom:5px}
/* QUESTION: the agent's voice (serif) with a red ledger margin. */
.k-q{position:relative;padding:1px 0 1px 13px;font:500 16.5px/1.35 var(--font-voice);color:var(--p1);overflow-wrap:anywhere}
.k-q::before{content:"";position:absolute;left:0;top:2px;bottom:2px;width:3px;border-radius:2px;background:var(--s-blocked)}
.k-q code{font:600 14px var(--font-mono)}
.k-board .k-q{color:var(--t1);font-size:15px}
/* POST-IT: butter note in a strip (fit hint, outbox, onboarding aside); never over terminal glyphs. */
.k-postit{display:flex;align-items:center;gap:12px;padding:8px 12px;color:var(--f-postit-ink);background:linear-gradient(180deg,var(--f-postit-hi),var(--butter));font:600 12px/1.3 var(--font-ui);
  box-shadow:0 1px 0 var(--f-postit-lip),0 4px 8px rgba(40,24,10,.3);transform:rotate(-.4deg);border-radius:1px}
.k-postit .k-key{box-shadow:inset 0 0 0 1px rgba(80,60,40,.35),0 2px 0 var(--f-butter-deep)}
.k-postit .link{font-weight:750;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px;border:0;background:none;color:inherit;cursor:pointer;padding:0;font-size:inherit}

/* ============================================================ TICKET (toast): a receipt with a perforated stub + torn bottom */
.k-ticket{position:relative;width:376px;color:var(--p1);filter:drop-shadow(0 12px 14px rgba(40,20,8,.42)) drop-shadow(0 1px 1px rgba(40,20,8,.25))}
.k-ticket .in{display:flex;background:var(--fibre),linear-gradient(180deg,var(--paper),var(--f-paper-lo));border-radius:4px 4px 0 0;
  -webkit-mask:linear-gradient(black 0 0) top/100% calc(100% - 6px) no-repeat,conic-gradient(from 135deg at 50% 0,black 90deg,transparent 0) bottom/10px 6px repeat-x;
  mask:linear-gradient(black 0 0) top/100% calc(100% - 6px) no-repeat,conic-gradient(from 135deg at 50% 0,black 90deg,transparent 0) bottom/10px 6px repeat-x}
.k-ticket .stub{width:62px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding-bottom:6px;
  background:linear-gradient(180deg,rgba(239,90,76,.10),rgba(239,90,76,.06));border-right:2px dotted rgba(90,84,77,.35)}
.k-ticket.done .stub{background:linear-gradient(180deg,rgba(99,196,138,.12),rgba(99,196,138,.06))}
.k-ticket .stub .t{font:700 11px/1 var(--font-mono);color:var(--i-blocked)}
.k-ticket.done .stub .t{color:var(--i-done)}
.k-ticket .body{flex:1;min-width:0;padding:10px 14px 14px}
.k-ticket .cap{font:11px/1 var(--font-mono);color:var(--p3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-ticket .what{font:750 15px/1.2 var(--font-ui);margin:5px 0 3px}
.k-ticket .q{font:500 14px/1.3 var(--font-voice);color:var(--p2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-ticket .tear{margin:9px 0 8px}
.k-ticket .k-legend{color:var(--p2)}
.k-ticket.line{width:auto;max-width:100%;filter:drop-shadow(0 3px 5px rgba(0,0,0,.45))}
.k-ticket.line .in{-webkit-mask:none;mask:none;border-radius:3px;height:32px;align-items:center}
.k-ticket.line .stub{width:auto;flex-direction:row;padding:0 9px;height:100%;gap:6px}
.k-ticket.line .body{display:flex;align-items:center;gap:12px;padding:0 12px;min-width:0}
.k-ticket.line .what{margin:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-ticket.line .cap,.k-ticket.line .q,.k-ticket.line .tear{display:none}
.k-ticket.in-anim{animation:k-in .22s var(--ease)}
@keyframes k-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
/* PRINTOUT: tractor-feed paper, the last lines of a terminal (triage). */
.k-printout{position:relative;padding:12px 34px;color:var(--f-print-ink);background:
  radial-gradient(circle,var(--f-sprocket) 4px,transparent 4.5px) left 4px top 5px/18px 20px repeat-y,
  radial-gradient(circle,var(--f-sprocket) 4px,transparent 4.5px) right 4px top 5px/18px 20px repeat-y,
  repeating-linear-gradient(180deg,rgba(157,179,143,.22) 0 30px,transparent 30px 60px),var(--fibre),var(--paper);box-shadow:0 2px 0 var(--f-edge2),0 10px 20px -8px rgba(28,16,8,.55)}
.k-printout::before,.k-printout::after{content:"";position:absolute;top:0;bottom:0;border-left:1.5px dotted rgba(31,30,29,.3)}
.k-printout::before{left:24px}.k-printout::after{right:24px}
.k-printout pre{margin:0;font:12px/15px var(--font-mono);white-space:pre;overflow:hidden}
.k-printout pre.wait{color:var(--p3);font-style:italic}
/* SLIP: "While you were out" message slip. */
.k-slip .band{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:12px 18px 9px;border-bottom:2px solid var(--clay)}
.k-slip .band h3{margin:0;font:800 16.5px/1 var(--font-sign);letter-spacing:.06em;text-transform:uppercase;color:var(--clay-ink);font-stretch:condensed}
.k-slip .band .span{font:11px var(--font-mono);color:var(--p3)}
.k-slip .ln{display:flex;gap:10px;align-items:center;padding:8px 18px;border-bottom:1.5px dashed var(--stitch);font-size:13px}
.k-slip .ln b{font-weight:700;min-width:58px}
.k-slip .ln .k-voice{flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k-slip .ln .t{font:11px var(--font-mono);color:var(--p3)}
.k-slip .acts{display:flex;gap:10px;padding:12px 18px 14px;justify-content:flex-end}
.k-slip .ln.act{cursor:pointer} .k-slip .ln.act:hover{background:rgba(90,84,77,.05)}

/* ============================================================ HUD HARDWARE */
.k-hang{position:relative;padding-top:12px}
.k-hang>.rod{position:absolute;top:0;width:2px;height:12px;background:linear-gradient(90deg,var(--f-rod),var(--f-rod-hi),var(--f-rod))}
.k-tally{display:inline-flex;align-items:center;padding:5px;height:44px;border-radius:var(--r-frame)}
.k-tally .cell{display:flex;align-items:center;gap:7px;height:34px;padding:0 13px;position:relative;white-space:nowrap;border:0;background:none;color:inherit;cursor:pointer;border-radius:var(--r-btn)}
.k-tally .cell:hover{background:rgba(244,237,227,.05)}
.k-tally .cell[aria-pressed=true]{box-shadow:inset 0 -3px 0 var(--clay)}
.k-tally .cell+.cell::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;background:linear-gradient(90deg,var(--f-groove) 50%,rgba(255,236,210,.07) 50%)}
.k-tally .cell[hidden]{display:none}
.k-tally .n{font:800 16px/1 var(--font-ui);font-variant-numeric:tabular-nums;color:var(--t1)}
.k-tally .w{font:600 13px/1 var(--font-ui);color:var(--t2)}
.k-tally .cell.alarm{padding:0 8px 0 10px;background:radial-gradient(60% 120% at 30% 50%,rgba(239,90,76,.14),transparent 70%),radial-gradient(120% 90% at 50% 0%,var(--board-lo),var(--glass));
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.95),inset 0 0 0 2px rgba(255,138,124,.2),inset 0 2px 4px rgba(0,0,0,.6)}
.k-tally .cell.alarm canvas{display:block;margin:0 1px}
.k-tally .cell.alarm .w{color:var(--b-blocked);font-weight:750}
.k-tally .cell.alarm+.cell::before{display:none}
.k-tally .cell.clear .w{color:var(--b-done);font-weight:700}
.k-rail{display:inline-flex;gap:2px;padding:4px;border-radius:8px}
.k-aimtag{display:inline-flex;align-items:center;gap:8px;padding:6px 11px 6px 7px;transform:rotate(-1.2deg);white-space:nowrap}
.k-aimtag b{font:750 14px/1 var(--font-ui)}
.k-aimtag .verb{font-size:12px;color:var(--p3)}
.k-aimtag .k-key{height:22px;min-width:22px;font-size:12px}
.k-frame{position:relative;padding:7px;border-radius:var(--r-frame);background:var(--woodgrain),linear-gradient(180deg,var(--f-walnut-hi),var(--walnut) 60%,var(--f-walnut-mid));
  box-shadow:inset 0 1px 0 rgba(255,220,180,.35),0 2px 0 var(--walnut-lo),0 12px 20px -6px rgba(20,10,4,.5)}
.k-graph{width:100%;height:100%;border-radius:2px;transform:rotate(-.8deg);
  background:linear-gradient(var(--rule) 1px,transparent 1px) 0 0/10px 10px,linear-gradient(90deg,var(--rule) 1px,transparent 1px) 0 0/10px 10px,var(--fibre),var(--f-graph);box-shadow:0 1px 3px rgba(40,20,8,.5)}
.k-frame .tape{position:absolute;width:40px;height:14px;background:rgba(236,224,196,.85);box-shadow:0 1px 1px rgba(0,0,0,.12);z-index:2}
.k-frame>.k-plaque{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);z-index:2}
.k-chev{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px 0 26px;color:var(--ink);white-space:nowrap;border:0;cursor:pointer;
  background:linear-gradient(180deg,var(--f-clay-hi),var(--clay));clip-path:polygon(16px 0,100% 0,100% 100%,16px 100%,0 50%);
  filter:drop-shadow(0 4px 6px rgba(40,16,8,.45));font:750 15px/1 var(--font-ui)}
.k-chev.right{padding:0 26px 0 14px;clip-path:polygon(0 0,calc(100% - 16px) 0,100% 50%,calc(100% - 16px) 100%,0 100%)}
.k-chev .t{font:700 13px/1 var(--font-mono)}
.k-chev .k-lamp{filter:drop-shadow(0 0 2px var(--paper))}
.k-hotbar{display:inline-flex;padding:6px;border-radius:var(--r-frame);background:var(--woodgrain),linear-gradient(180deg,var(--f-walnut-hi),var(--walnut) 60%,var(--f-walnut-mid));
  box-shadow:inset 0 1px 0 rgba(255,220,180,.35),0 2px 0 var(--walnut-lo),0 12px 20px -6px rgba(20,10,4,.5)}
.k-cubby{position:relative;width:54px;height:54px;display:grid;place-items:center;background:linear-gradient(180deg,var(--f-cubby-hi),var(--f-cubby-lo));box-shadow:inset 0 4px 6px rgba(0,0,0,.7);margin:0 3px;border-radius:3px;border:0;cursor:pointer;padding:0}
.k-cubby>.k-key{position:absolute;left:3px;top:3px;height:14px;min-width:14px;font-size:11px;padding:0 3px}
.k-cubby>svg.k-lamp{position:absolute;right:4px;bottom:4px;width:11px;height:11px}
.k-cubby.empty{opacity:.5;cursor:default}
.k-cubby.sel{box-shadow:inset 0 4px 6px rgba(0,0,0,.7),0 0 0 2px var(--clay)}
.k-xhair{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2.5px solid var(--cream);box-shadow:0 0 0 1.5px var(--ink),inset 0 0 0 1.5px var(--ink);pointer-events:none}
.k-xhair::after{content:"";position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px;border-radius:50%;background:var(--cream);box-shadow:0 0 0 1.5px var(--ink)}

/* ============================================================ ROSTER PARTS (group header, row) */
.k-gh{display:flex;align-items:center;gap:8px;height:30px;padding:0 14px 0 12px;margin-top:4px;cursor:pointer;border:0;background:none;width:100%;color:inherit;text-align:left}
.k-gh .chev{width:10px;height:10px;stroke:var(--t3);fill:none;stroke-width:2;stroke-linecap:round;flex:none;transition:transform .15s}
.k-gh[aria-expanded=false] .chev{transform:rotate(-90deg)}
.k-gh .name{font:800 11.5px/1 var(--font-sign);letter-spacing:.14em;text-transform:uppercase;color:var(--t2);font-stretch:condensed;white-space:nowrap}
.k-gh .label{font:700 12px/1 var(--font-ui);color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-gh .fill{flex:1;height:2px;min-width:12px;background:linear-gradient(var(--f-groove) 0 1px,rgba(255,236,210,.06) 1px 2px);margin:0 4px}
.k-gh .cnt{font:700 11px/1 var(--font-mono);color:var(--t3)}
.k-gh.alarm .name,.k-gh.alarm .cnt{color:var(--b-blocked)}
.k-gh .sum{font:12px/1 var(--font-ui);color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;margin-left:2px}
.k-gh .k-legend{font-size:11px}
.k-row{position:relative;display:flex;flex-wrap:wrap;gap:10px;min-height:48px;padding:6px 14px;align-items:flex-start;cursor:pointer}
.k-row:hover{background:rgba(244,237,227,.04)}
.k-row .main{flex:1;min-width:0}
.k-row .l1{display:flex;align-items:baseline;gap:7px;white-space:nowrap;min-width:0}
.k-row .nm{font:700 14px/1.25 var(--font-ui);color:var(--t1);overflow:hidden;text-overflow:ellipsis}
.k-row .ctx{font:12px/1.25 var(--font-ui);color:var(--t3);overflow:hidden;text-overflow:ellipsis}
.k-row .k-unread,.k-row .k-note{align-self:center}
.k-row .l2{margin-top:2px;font:12px/1.35 var(--font-mono);color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-row .side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;padding-top:3px;flex:none}
.k-row .age{display:inline-flex;align-items:center;gap:6px;font:700 12px/1 var(--font-mono);color:var(--t3)}
.k-row .age.warm{color:var(--butter)} .k-row .age.hot{color:var(--b-blocked)}
.k-row.sel{background:linear-gradient(90deg,rgba(244,237,227,.09),rgba(244,237,227,.035))}
.k-row.sel::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:4px;border-radius:0 3px 3px 0;background:var(--clay);box-shadow:0 0 8px rgba(217,119,87,.6)}
.k-row .under{flex-basis:100%;padding-left:46px;margin-top:-2px}
.k-row .ask{margin:6px 0 2px}
.k-row .ask .k-q{font-size:14px;padding-left:10px;margin-bottom:5px}
.k-row .k-legend{margin-top:7px;font-size:11px;gap:13px}
.k-row.compact{min-height:28px;padding:3px 14px;align-items:center}
.k-row.compact .l2{display:none}

/* ============================================================ DRAWER PARTS (tab rail, tab, crumb, CRT bezel, strips) */
.k-tabs{display:flex;align-items:flex-end;gap:4px;height:46px;padding:0 14px;background:linear-gradient(180deg,var(--f-tab-rail),var(--f-tab-rail-lo));box-shadow:inset 0 -2px 3px rgba(0,0,0,.5)}
.k-tab{position:relative;display:flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 8px;border-radius:6px 6px 0 0;color:var(--t2);font:650 13px/1 var(--font-ui);border:0;cursor:pointer;white-space:nowrap;
  background:linear-gradient(180deg,var(--f-tab-hi),var(--f-tab-lo));box-shadow:inset 0 1px 0 rgba(255,236,210,.05)}
.k-tab:hover{color:var(--t1)}
.k-tab.on{height:40px;color:var(--t1);background:linear-gradient(180deg,var(--f-tab-on),var(--f-board-top));box-shadow:inset 0 3px 0 var(--clay),inset 1px 0 0 rgba(255,236,210,.05),inset -1px 0 0 rgba(255,236,210,.05)}
.k-tab.on::after{content:"";position:absolute;left:0;right:0;bottom:-3px;height:4px;background:var(--f-board-top)}
.k-tab .x{width:16px;height:16px;display:grid;place-items:center;opacity:0;color:inherit;border-radius:3px}
.k-tab .x svg{width:12px;height:12px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}
.k-tab:hover .x,.k-tab.on .x{opacity:.55}.k-tab .x:hover{opacity:1;background:rgba(244,237,227,.08)}
.k-crumb{font:700 15px/1.2 var(--font-ui);display:flex;align-items:center;gap:0;min-width:0;white-space:nowrap}
.k-crumb .sep{color:var(--brass);margin:0 7px;font-weight:400}
.k-crumb .dim{color:var(--t2);font-weight:600}
.k-crumb .k-shield{margin-right:7px}
.k-cwd{font:12px/1 var(--font-mono);color:var(--t3);margin-top:6px;display:flex;gap:12px;align-items:center;white-space:nowrap}
.k-cwd .herdr{color:var(--brass-hi)}
.k-crt{position:relative;border-radius:8px;background:var(--crt);overflow:hidden;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.95),inset 0 3px 10px rgba(0,0,0,.75),0 0 0 3px var(--f-groove),0 1px 0 3px rgba(255,236,210,.06)}
.k-crt>.k-plaque{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:3}
.k-strip{display:flex;align-items:center;gap:12px;min-height:0}
.k-strip:empty{display:none}
.k-mode{display:inline-flex;align-items:center;gap:7px;font:700 12px/1 var(--font-ui);color:var(--t1);white-space:nowrap}

/* ============================================================ CARD PARTS (head, confirm, foot, specs) */
.k-who{display:flex;gap:12px;align-items:center}
.k-who .nm{font:800 21px/1.1 var(--font-sign)}
.k-who .sub{margin-top:4px;font:12px/1.2 var(--font-ui);color:var(--p2);display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden}
.k-board .k-who .sub{color:var(--t2)}
.k-who>.k-stamp,.k-who>.k-state{margin-left:auto;align-self:flex-start;margin-top:4px}
.k-title{font:500 16.5px/1.3 var(--font-voice);color:var(--p1)}
.k-confirm{display:flex;align-items:center;gap:10px;margin-top:12px}
.k-confirm .say{font:600 13px/1.3 var(--font-ui);color:var(--p2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k-confirm .say b{color:var(--p1)}
.k-foot{margin-top:12px;padding-top:10px;border-top:1.5px dashed var(--stitch)}
.k-board .k-foot{border-top:0;box-shadow:0 -2px 0 -1px var(--f-groove)}
.k-specs{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12px;color:var(--p2);align-items:center}
.k-specs>dt{font:700 11px/1 var(--font-sign);letter-spacing:.04em;color:var(--p3)}
.k-specs>dd{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--p1)}
.k-field{display:block;margin-top:14px}
.k-field>.k-label{display:block;margin-bottom:6px}

/* ============================================================ DIALOG PARTS (veil, index card, help sheets) */
.k-veil{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 35%,rgba(20,12,6,.3),rgba(20,12,6,.62))}
.k-index{width:640px;padding:0 0 12px;border-radius:3px}
.k-index .top{display:flex;align-items:center;gap:12px;height:60px;flex:none;padding:0 18px 0 20px;border-bottom:2px solid rgba(217,119,87,.8);box-shadow:0 3px 0 -1px var(--paper),0 4px 0 -1px rgba(217,119,87,.5)}
.k-index .top svg{width:20px;height:20px;stroke:var(--p3);fill:none;stroke-width:1.9;stroke-linecap:round;flex:none}
.k-index .top input{flex:1;min-width:0;border:0;background:none;outline:none;font:600 21px/1 var(--font-ui);color:var(--p1);caret-color:var(--clay)}
.k-index .top input::placeholder{color:var(--p3)}
.k-index .top .k-detent{width:150px;border:0}
.k-index .sec{padding:15px 20px 6px;font:800 11px/1 var(--font-sign);letter-spacing:.16em;color:var(--clay-ink);text-transform:uppercase;font-stretch:condensed;border-bottom:1.5px solid var(--rule)}
.k-index .it{position:relative;display:flex;align-items:center;gap:11px;height:40px;padding:0 20px 0 22px;border-bottom:1.5px solid var(--rule);cursor:pointer}
.k-index .it.k-hl::after{left:12px;right:12px}
.k-index .it.k-hl::before{left:3px}
.k-index .it .nm{font:700 14px/1 var(--font-ui);white-space:nowrap}
.k-index .it .ctx{font:12px/1 var(--font-mono);color:var(--p3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.k-index .it .aside{font-weight:500;color:var(--p3)}
.k-index .ic{width:22px;height:22px;display:grid;place-items:center;color:var(--p2);flex:none}
.k-index .ic svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.k-index .foot{padding:12px 20px 0}
.k-sheets{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.k-sheets>.k-paper{padding:14px 16px}
.k-sheets h4{margin:0 0 8px;font:800 11px/1 var(--font-sign);letter-spacing:.14em;text-transform:uppercase;color:var(--clay-ink);font-stretch:condensed}
.k-kl{display:flex;align-items:center;gap:8px;min-height:27px;border-bottom:1.5px dashed var(--stitch);font-size:13px}
.k-kl:last-child{border:0}
.k-kl .ks{display:flex;gap:3px;min-width:84px;align-items:center}
/* SCROLL: a sheet's scrolling body. When content runs past an edge, that edge becomes a stitch (paper) / groove (board)
   and the text fades into it, so a cut-off sheet always says "more". kit/index.ts scrollArea() toggles .up/.dn. */
.k-scroll{overflow:auto;min-height:0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(90,84,77,.35) transparent;
  border-top:1.5px dashed transparent;border-bottom:1.5px dashed transparent}
.k-scroll:focus{outline:none}
.k-scroll.up{border-top-color:var(--stitch)}
.k-scroll.dn{border-bottom-color:var(--stitch)}
.k-scroll.dn:not(.up){-webkit-mask:linear-gradient(180deg,black calc(100% - 28px),transparent);mask:linear-gradient(180deg,black calc(100% - 28px),transparent)}
.k-scroll.up:not(.dn){-webkit-mask:linear-gradient(0deg,black calc(100% - 28px),transparent);mask:linear-gradient(0deg,black calc(100% - 28px),transparent)}
.k-scroll.up.dn{-webkit-mask:linear-gradient(180deg,transparent,black 28px calc(100% - 28px),transparent);mask:linear-gradient(180deg,transparent,black 28px calc(100% - 28px),transparent)}
.k-board .k-scroll{scrollbar-color:rgba(201,161,90,.35) transparent}
.k-board .k-scroll.up{border-top:2px solid var(--board-lo);box-shadow:inset 0 1px 0 rgba(255,236,210,.06)}
.k-board .k-scroll.dn{border-bottom:2px solid var(--board-lo)}
/* SELECTION: text picked on paper takes the butter highlighter; on the board the clay one (never the browser blue). */
.k-paper ::selection,.k-paper::selection{background:var(--butter);color:var(--p1)}
.k-board ::selection,.k-board::selection{background:var(--clay-deep);color:var(--t1)}

/* ============================================================ FOCUS + MOTION */
.k-btn:focus-visible,.k-ibtn:focus-visible,.k-detent>*:focus-visible,.k-switch:focus-visible,.k-tick:focus-visible,.k-circled>*:focus-visible,
.k-fader:focus-visible,.k-ledger li:focus-visible,.k-tab:focus-visible,.k-gh:focus-visible,.k-row:focus-visible,.k-cubby:focus-visible,.k-tally .cell:focus-visible,
.k-chev:focus-visible,.k-index .it:focus-visible,.k-postit .link:focus-visible{outline:2px solid var(--clay-light);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.k-lamp.blocked{animation:none}.k-switch .track i{transition:none}.k-ticket.in-anim{animation:none}}
.hq-reduced .k-lamp.blocked{animation:none}
`;
