#!/usr/bin/env bash
# panorama state hook (fail-open, atomic write)
# Usage: notify-state.sh <active|waiting>
# Reads Claude Code hook JSON from stdin with session_id, cwd fields.

STATE="${1:-active}"
STATE_DIR="$HOME/.config/panorama/states"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# jq 不在ならフェイルオープン
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null || echo '{}')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")

[ -z "$SESSION_ID" ] && exit 0

case "$STATE" in
  active|waiting) ;;
  *) exit 0 ;;
esac

# session_id はファイル名として安全か（英数 + ハイフンのみ）
case "$SESSION_ID" in
  *[!a-zA-Z0-9-]*) exit 0 ;;
esac

STATE_FILE="$STATE_DIR/${SESSION_ID}.json"
TEMP_FILE=$(mktemp "$STATE_DIR/.tmp-XXXXXX" 2>/dev/null) || exit 0

TS=$(date +%s)
jq -n \
  --arg state "$STATE" \
  --argjson timestamp "$TS" \
  --arg session_id "$SESSION_ID" \
  --arg cwd "$CWD" \
  '{state: $state, timestamp: $timestamp, session_id: $session_id, cwd: $cwd}' \
  > "$TEMP_FILE" 2>/dev/null || { rm -f "$TEMP_FILE"; exit 0; }

mv -f "$TEMP_FILE" "$STATE_FILE" 2>/dev/null || rm -f "$TEMP_FILE"
exit 0
