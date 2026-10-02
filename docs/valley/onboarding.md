# First-run welcome and tips

Posy's welcome letter, the tour checklist ticked by real signals, its reward, the one-time tips, and how automation
skips or forces all of it.

Key sources: `model/onboarding.ts` (pure + `onboarding.test.ts`: `HINTS`, `HINT_GAP_MS`, `HINT_SETTLE_MS`,
`shouldWelcome`, `tipsAllowed`), `hud/onboarding.ts` + `onboarding.css` (panel `welcome`), `main.ts` (service wiring,
persistence). Paths are relative to `renderer/src/farm/`.

## The welcome

Persisted per profile in `claude-valley.onboarding.v1`. On a profile's first visit **Posy the postmaster** hands you a
letter (airmail-edged, her stamp): agents are farmers, fields are workspaces, a golden ! needs you, every terminal is a
key away. *Let's go* (Enter / Esc) starts the tour, *Skip the tour* doesn't; then she says hello over by the mailbox.

## The tour

A small foldable / closable checklist bottom-left (right of the needs-you strip while it is open;
`data-hud-obstacle="children"`; hidden under any panel), ticked by **real signals, never by duplicated logic**:

* look around + take a stroll (the player's own yaw / feet at 4 Hz, teleports and panels ignored);
* say hello to a villager (hud.ts's E / F on a `villager`);
* open a terminal (the `drawer` panel opening, from F, the dock, the map, anywhere);
* answer someone who needs you (`ctx.answer` succeeding; **skipped** when it comes up and nobody needs you, a later
  answer still ticks it);
* the map (M) and the ledger (Tab) panels;
* *when you have a moment: a pastime* (any of: a find from `collection.onFind` → pick something up / cast a line, or
  `indoors.active` → the farmhouse; each lights a chip).

Steps tick in any order; the current one shows its how-to. Finishing pays **50 bits**, gives the **Welcome sign**
(`welcome`, `DecorDef.gift`: never stocked, never sold) straight into the yard ([economy.md](economy.md)) and posts
Posy's "Welcome home" letter (re-posted on load) — once per profile, a replay pays nothing. **Replay the welcome** is in
the pause menu.

## Tips (`HINTS`)

One-time hints in the same corner, queued by the world (a farmer needs you → "Alt+1 answers from anywhere"; rain →
"fish bite better in the rain"; night; the first find in your basket → sell to Bram / gift), at most one per 4 min
(`HINT_GAP_MS`), the first 45 s after the welcome closes (`HINT_SETTLE_MS`), never during the tour, a panel / terminal,
typing or photo mode; × dismisses, *Tips off* or Settings → *Valley tips* turns them off.

## Automation

`navigator.webdriver` (Playwright tests, `npm run shoot`) skips the welcome and the tips unless the URL has
`?welcome=1` (forces a fresh tour); `?welcome=0` never shows it. (Separately, `npm run shoot` dismisses the
click-in hint card (shown until the pointer is first locked; `__hud.dismissHint()`, HUD pref `hinted`) unless the shot sets `hint=1`.)

## Dev

`__hud.tour.tip(id)`, `.signal(s)`, `.data()`.

```sh
npm run shoot -- --shot name=w,pose=hub,hour=10,welcome=1,wait=3000   # the first-run welcome letter (Posy)
npm run shoot -- --shot "name=wl,pose=hub,welcome=1,eval=setTimeout(()=>{document.querySelector('[data-testid=welcome-go]').click();__hud.tour.signal('map')},1800)"  # the tour checklist
```

Shorter forms: `npm run shoot -- --shot name=w,pose=hub,welcome=1` (the letter); add
`eval=setTimeout(()=>document.querySelector('[data-testid=welcome-go]').click(),1800)` for the checklist.
