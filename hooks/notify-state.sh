#!/usr/bin/env bash
# panorama hook: write Claude Code state to a file for the updater to read.
# Usage: notify-state.sh <state>
#   state: active | permission
#
# Called from Claude Code hooks (PreToolUse / PostToolUse).
# The updater reads these files to determine card column transitions.

set -euo pipefail

STATE="${1:-active}"
STATE_DIR="$HOME/.config/panorama/states"
mkdir -p "$STATE_DIR"

# Identify pane by tmux session + pane index (stable across window renames)
if [ -z "${TMUX:-}" ]; then
  exit 0
fi

SESSION=$(tmux display-message -p '#S')
PANE_INDEX=$(tmux display-message -p '#P')
WINDOW_INDEX=$(tmux display-message -p '#I')
STATE_FILE="$STATE_DIR/${SESSION}-${WINDOW_INDEX}.${PANE_INDEX}.json"

# Write state with epoch timestamp
cat > "$STATE_FILE" <<EOF
{"state":"${STATE}","timestamp":$(date +%s)}
EOF
