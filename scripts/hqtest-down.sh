#!/usr/bin/env bash
# Stop the headless herdr test session "hqtest" and delete its persisted state. Idempotent. Never touches default.
set -uo pipefail
SESSION=hqtest
HERDR="${HERDR_BIN_PATH:-$HOME/.local/bin/herdr}"
[[ "$SESSION" == default ]] && exit 1
"$HERDR" session stop "$SESSION" --json >/dev/null 2>&1 || true
for _ in $(seq 30); do
  "$HERDR" session list --json | jq -e --arg s "$SESSION" '.sessions[]|select(.name==$s and .running)' >/dev/null || break; sleep 0.1; done
"$HERDR" session delete "$SESSION" --json >/dev/null 2>&1 || true
# stray `terminal session control|observe` children of a crashed backend
pkill -f -- "--session $SESSION terminal session" 2>/dev/null || true
# [CORE m2-carryover cross-owner, BE file] per-build sandboxes from hqtest-up.sh (mktemp /tmp/hqtest-sandbox.XXXXXXXX)
# plus the legacy fixed one. Their ~/.claude.json trust entries are left alone (never rewrite a file live claudes write).
for d in /tmp/hqtest-sandbox.* /tmp/hqtest-sandbox; do [[ -d "$d" && -O "$d" ]] && rm -rf -- "$d"; done
echo "hqtest down"
