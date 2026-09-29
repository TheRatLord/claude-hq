#!/usr/bin/env bash
# usage: docs/port/baseline/shoot-all.sh <base-url-with-token e.g. http://127.0.0.1:7901/?t=TOKEN> <outdir> [shoot.mjs extra args]
# Requires a dev stack started with:  node scripts/dev.mjs --seed 1 --port P --vite-port P+1 --config-dir <scratch>
# (script may be scripts/dev.ts after the port). Clock is frozen (__hq.freeze) before every shot; ?hour=13&seed=1.
set -euo pipefail
BASE="$1"; OUT="$2"; shift 2
SHOOT="node $(dirname "$0")/../../../scripts/shoot.$( [ -f "$(dirname "$0")/../../../scripts/shoot.ts" ] && echo ts || echo mjs )"
mkdir -p "$OUT"
URL="$BASE&hour=13&seed=1"
run() { local name="$1"; shift; $SHOOT "$URL" "$OUT/$name" --measure 0 --eval "__hq.freeze(true)" "$@" > "$OUT/$name.log" 2>&1 || echo "shoot $name exit $?"; }
run world --pose spawn --pose pitOverview --pose engine --pose cafe "$@"
run roster --eval "__hq.roster(true)" --pose spawn "$@"
run terminal --eval "__hq.openTerminal('lumen')" --pose spawn "$@"
