#!/usr/bin/env bash
# Start the headless herdr test session "hqtest" and populate demo fixtures. Idempotent.
#   scripts/hqtest-up.sh            # shells + 2 claudes: "scout" idle in ~/claude-hq, "tinker" BLOCKED on the folder-trust dialog
#   HQ_CLAUDES=1 scripts/hqtest-up.sh   # only scout (never more than 2; no prompts are ever sent)
#   HQ_CLAUDES=0 scripts/hqtest-up.sh   # shells only (free)
#   HQ_FRESH=1 scripts/hqtest-up.sh     # tear down + rebuild (new never-trusted sandbox dir → tinker blocks again,
#                                       #  even if a playtest answered its trust prompt with "Yes")
#   (already populated → repairs a fixture agent that exited, e.g. after a test answered tinker with "No, exit")
# Socket: ~/.config/herdr/sessions/hqtest/herdr.sock  (NEVER touches the default session)
set -euo pipefail
SESSION=hqtest
SOCK="$HOME/.config/herdr/sessions/$SESSION/herdr.sock"
HERDR="${HERDR_BIN_PATH:-$HOME/.local/bin/herdr}"
CLAUDES="${HQ_CLAUDES:-2}"; (( CLAUDES > 2 )) && CLAUDES=2
# [CORE m2-carryover cross-owner, BE file] A fresh, never-trusted sandbox per build: answering tinker's folder-trust
# prompt with "Yes" records hasTrustDialogAccepted for that path in ~/.claude.json, so a fixed path (the old
# /tmp/hqtest-sandbox) never showed the blocked fixture again. mktemp at build time (below); hqtest-down.sh removes them.
SANDBOX_PREFIX=/tmp/hqtest-sandbox.   # not $TMPDIR: a Claude Code session points it at a scratchpad that may sit under a trusted dir
FIX_MARK="hq-core"   # label of the first fixture workspace = "already populated" marker

# Every herdr call: explicit --session and a scrubbed env (never inherit HERDR_SOCKET_PATH of the caller's session).
h() { env -u HERDR_SOCKET_PATH -u HERDR_SESSION -u HERDR_PANE_ID -u HERDR_TAB_ID -u HERDR_WORKSPACE_ID -u HERDR_ENV \
        "$HERDR" --session "$SESSION" "$@"; }
running() { "$HERDR" session list --json | jq -e --arg s "$SESSION" '.sessions[]|select(.name==$s)|.running' >/dev/null; }

if [[ "${HQ_FRESH:-0}" == 1 ]]; then "$(dirname "$0")/hqtest-down.sh"; fi

if ! running; then
  # Drop persisted state: otherwise herdr restores old panes and re-runs `claude --resume <id>` in them.
  "$HERDR" session delete "$SESSION" --json >/dev/null 2>&1 || true
  # Clean env: panes/agents must not inherit this Claude Code session's CLAUDECODE / CLAUDE_CODE_* markers
  # (inherited CLAUDE_CODE_CHILD_SESSION turns off transcript saving in spawned claudes).
  ( cd "$HOME" && env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" SHELL=/bin/bash TERM=xterm-256color \
      LANG="${LANG:-en_US.UTF-8}" PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin" \
      setsid "$HERDR" --session "$SESSION" server >/dev/null 2>&1 < /dev/null & ) >/dev/null 2>&1 < /dev/null
  # ^ [CORE m2-carryover] the detaching subshell itself must not keep the caller's stdout: `hqtest-up.sh | tail` hung forever
  for _ in $(seq 50); do [[ -S "$SOCK" ]] && h workspace list >/dev/null 2>&1 && break; sleep 0.1; done
fi
h workspace list >/dev/null || { echo "hqtest server did not come up" >&2; exit 1; }

agent() { # name pane  -> waits (<=60s) until claude is interactive
  h agent start "$1" --kind claude --pane "$2" --timeout 60000 >/dev/null 2>&1 || echo "note: agent $1 not ready (expected for tinker: folder-trust dialog = blocked fixture)" >&2; }

if h workspace list | jq -e --arg m "$FIX_MARK" '.result.workspaces[]|select(.label==$m)' >/dev/null; then
  # Repair: re-start a fixture agent that exited (e.g. a test answered tinker's trust prompt with "No, exit").
  # Only in its own fixture pane, only when that pane is a plain shell again; never more than $CLAUDES agents.
  repair() { # name workspace-label
    local name=$1 label=$2 pane n
    h agent list | jq -e --arg n "$name" '.result.agents[]|select(.name==$n)' >/dev/null && return 0
    n=$(h agent list | jq '.result.agents|length'); (( n >= CLAUDES )) && return 0
    pane=$(h pane list | jq -r --arg w "$(h workspace list | jq -r --arg l "$label" '.result.workspaces[]|select(.label==$l)|.workspace_id')" \
      '.result.panes[]|select(.workspace_id==$w and .tab_id==($w+":t1") and (.agent==null))|.pane_id' | head -1)
    [[ -n "$pane" ]] && { echo "repairing fixture agent $name in $pane"; agent "$name" "$pane"; }
  }
  (( CLAUDES >= 1 )) && repair scout "$FIX_MARK"
  (( CLAUDES >= 2 )) && repair tinker hq-sandbox
  echo "hqtest already populated"; h workspace list | jq -r '.result.workspaces[]|"  \(.workspace_id) \(.label) panes=\(.pane_count) status=\(.agent_status)"'
  h agent list | jq -r '.result.agents[]|"  agent \(.name) \(.pane_id) \(.agent_status)"'
  echo "socket: $SOCK"; exit 0
fi

SANDBOX=$(mktemp -d "${SANDBOX_PREFIX}XXXXXXXX")
git -C "$SANDBOX" init -q
printf 'print("hello from the sandbox")\n' > "$SANDBOX/hello.py"

ws()    { h workspace create --no-focus --label "$1" --cwd "$2" | jq -r '.result.workspace.workspace_id + " " + .result.root_pane.pane_id'; }
tab()   { h tab create --no-focus --workspace "$1" --label "$2" --cwd "$3" | jq -r '.result.root_pane.pane_id'; }
split() { h pane split "$1" --direction "$2" --no-focus | jq -r '.result.pane.pane_id'; }
run()   { h pane run "$1" "$2" >/dev/null; }
# ws1 hq-core (~/claude-hq): claude agent tab + dev shell pair
read -r W1 P1 < <(ws "$FIX_MARK" "$HOME/claude-hq")
h tab rename "$W1:t1" "claude" >/dev/null 2>&1 || true
DEV=$(tab "$W1" dev "$HOME/claude-hq");   DEV2=$(split "$DEV" right)
run "$DEV2" "top -d 3"
# ws2 hq-sandbox ($SANDBOX, fresh per build): second claude (optional) + a git shell
read -r W2 Q1 < <(ws hq-sandbox "$SANDBOX")
h tab rename "$W2:t1" "claude" >/dev/null 2>&1 || true
GIT=$(tab "$W2" git "$SANDBOX"); run "$GIT" "git status"
# ws3 ops (/tmp): plain shells with long-running foreground processes (for pane.process_info)
read -r W3 O1 < <(ws ops /tmp)
h tab rename "$W3:t1" "monitors" >/dev/null 2>&1 || true
run "$O1" "watch -n 2 uptime"
O2=$(split "$O1" down); run "$O2" "python3 -m http.server 0 --bind 127.0.0.1"
LOGS=$(tab "$W3" logs /tmp); run "$LOGS" "while :; do date '+%T tick'; sleep 5; done"

# claude agents (cost nothing until prompted; left idle)
if (( CLAUDES >= 1 )); then agent scout "$P1"; else run "$P1" "echo 'claude slot (HQ_CLAUDES=0)'"; fi
if (( CLAUDES >= 2 )); then agent tinker "$Q1"; else run "$Q1" "python3 hello.py"; fi

echo "hqtest populated"; h workspace list | jq -r '.result.workspaces[]|"  \(.workspace_id) \(.label) panes=\(.pane_count) status=\(.agent_status)"'
h agent list | jq -r '.result.agents[]|"  agent \(.name) \(.pane_id) \(.agent_status) session=\(.agent_session.value // "-")"'
echo "sandbox: $SANDBOX (fresh, untrusted)"
echo "socket: $SOCK"
