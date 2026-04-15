#!/usr/bin/env bash
# panorama hook: write Claude Code state to a file for the updater to read.
# Usage: notify-state.sh <state>
#   state: active
#
# Called from Claude Code hooks (PreToolUse / PostToolUse).
# The updater reads these files to determine card column transitions.
# State files are keyed by the working directory path (matching card's path field).

set -euo pipefail

STATE="${1:-active}"
STATE_DIR="$HOME/.config/panorama/states"
mkdir -p "$STATE_DIR"

# Key by working directory path (sanitized for filename)
PATH_KEY=$(pwd | sed 's|/|_|g')
STATE_FILE="$STATE_DIR/${PATH_KEY}.json"

# Write state with epoch timestamp
cat > "$STATE_FILE" <<EOF
{"state":"${STATE}","timestamp":$(date +%s)}
EOF
