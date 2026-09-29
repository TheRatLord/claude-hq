# Screenshot + test baseline (taken on the pre-port JS tree, GPU: ANGLE/Vulkan, Radeon 780M)

Two sets, both `?hour=13&seed=1`, clock frozen (`__hq.freeze(true)`) before every shot, 1920x1080:

| dir | backend | use |
| --- | --- | --- |
| `docs/port/baseline/` (`world-0..3`, `roster-0`, `terminal-0`) | `--demo 12 --seed 1` | what the app looks like; the demo world is driven by wall-clock timers, so two shots of the same stack differ by mean 0.2-0.7 and, across restarts, up to mean ~4-7 (bubbles, walkers, timers). Compare by eye / large-region diff. |
| `docs/port/baseline/empty/` (`world-*`, `roster-0`) | `--scenario empty --seed 1` | no agents, so the scene is static: the run-to-run noise floor is mean < 0.8, < 1.0 % of pixels differ by more than 24. **Use this set for regression checks.** |

Shots: `world-0` spawn, `world-1` pitOverview, `world-2` engine, `world-3` cafe; `roster-0` = spawn with the roster
open (`__hq.roster(true)`); `terminal-0` = spawn with the terminal drawer open on agent `lumen`
(`__hq.openTerminal('lumen')`, demo only). `*.log` hold the shoot.mjs stdout (renderer string, console errors).

## Reproduce

Pick your own port pair P, P+1 (7900-7909 was the range used here) and a config dir outside the repo.

```sh
CFG=$(mktemp -d)
# demo set
node scripts/dev.ts --seed 1 --port P --vite-port $((P+1)) --config-dir $CFG &         # (scripts/dev.mjs before the rename)
TOKEN=$(cat $CFG/token)
docs/port/baseline/shoot-all.sh "http://127.0.0.1:$((P+1))/?t=$TOKEN" /tmp/after-demo
# static set: stop that stack, then
node scripts/dev.ts --scenario empty --seed 1 --port P --vite-port $((P+1)) --config-dir $CFG &
docs/port/baseline/shoot-all.sh "http://127.0.0.1:$((P+1))/?t=$(cat $CFG/token)" /tmp/after-empty
rm /tmp/after-empty/terminal*        # no agents in the empty scenario
# compare (decodes both PNGs in headless Chromium; prints mean channel diff and % of pixels differing by > 24)
node docs/port/baseline/compare.mjs docs/port/baseline/empty /tmp/after-empty
node docs/port/baseline/compare.mjs docs/port/baseline /tmp/after-demo
kill %1   # or the pid of dev.ts; never leave the stack running
```

`shoot-all.sh` runs, per set (`URL=$BASE&hour=13&seed=1`):

```sh
node scripts/shoot.ts "$URL" OUT/world    --measure 0 --eval "__hq.freeze(true)" --pose spawn --pose pitOverview --pose engine --pose cafe
node scripts/shoot.ts "$URL" OUT/roster   --measure 0 --eval "__hq.freeze(true)" --eval "__hq.roster(true)" --pose spawn
node scripts/shoot.ts "$URL" OUT/terminal --measure 0 --eval "__hq.freeze(true)" --eval "__hq.openTerminal('lumen')" --pose spawn
```

Electron check (needs a built `dist/` and the compiled preload): `npx vite build && npm run build:preload`, then
`CLAUDE_HQ_CONFIG_DIR=$CFG xvfb-run -a -s "-screen 0 2560x1440x24" node_modules/.bin/electron --no-sandbox --ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan . --demo --port P --new-instance --shoot /tmp/e.png --shoot-wait 4000`
(prints a `SHOOT {...}` line with `"ready":true` and `frameErrors:0`).

## Tests

`npm test` on the baseline: **783 tests, 781 pass, 1 fail, 1 skipped**. The failing one is
`server/test/golden.test.js` and is caused by the uncommitted M4 change in the working tree's `shared/protocol.js`
(passes at HEAD), see `docs/port/STATUS.md`.
