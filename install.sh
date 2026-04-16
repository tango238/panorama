#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$HOME/.config/panorama"
CONFIG_FILE="$CONFIG_DIR/config.yaml"
SKILL_LINK="$HOME/.claude/skills/panorama"
CLI_LINK="$HOME/.local/bin/panorama"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
LAUNCHD_PLIST="$LAUNCHD_DIR/com.user.panorama.plist"
LOG_PATH="$HOME/Library/Logs/panorama.log"

echo "panorama installer"
echo "  REPO_DIR: $REPO_DIR"

# 1. 依存チェック
for bin in node git tmux launchctl jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin is required but not installed" >&2
    exit 1
  fi
done
NODE_BIN="$(command -v node)"

# 2. config 初期化
mkdir -p "$CONFIG_DIR" "$CONFIG_DIR/states"

# 2.5. hooks ディレクトリを ~/.local/share/panorama/hooks/ にコピー
HOOKS_DEST="$HOME/.local/share/panorama/hooks"
mkdir -p "$HOOKS_DEST"
cp -f "$REPO_DIR/hooks/notify-state.sh" "$HOOKS_DEST/notify-state.sh"
chmod +x "$HOOKS_DEST/notify-state.sh"
echo "Installed hook to $HOOKS_DEST/notify-state.sh"

# 2.6. 旧 state ファイル（path ベース）をクリーンアップ
STATE_DIR="$CONFIG_DIR/states"
for f in "$STATE_DIR"/*.json; do
  [ -f "$f" ] || continue
  if ! jq -e '.session_id' "$f" >/dev/null 2>&1; then
    rm -f "$f"
    echo "Removed legacy state file: $(basename "$f")"
  fi
done
if [ ! -f "$CONFIG_FILE" ]; then
  cp "$REPO_DIR/config.example.yaml" "$CONFIG_FILE"
  echo "Created $CONFIG_FILE"
else
  echo "Keeping existing $CONFIG_FILE"
fi

# 3. Vault 初期化
VAULT_PATH="$(grep '^vault_path:' "$CONFIG_FILE" | sed -E 's/vault_path:[[:space:]]*//' | sed "s|~|$HOME|")"
DASHBOARD_FILE="$(grep '^dashboard_file:' "$CONFIG_FILE" | sed -E 's/dashboard_file:[[:space:]]*//')"
mkdir -p "$VAULT_PATH/projects"
if [ ! -f "$VAULT_PATH/$DASHBOARD_FILE" ]; then
  cp "$REPO_DIR/templates/Dashboard.md" "$VAULT_PATH/$DASHBOARD_FILE"
  echo "Created $VAULT_PATH/$DASHBOARD_FILE"
else
  echo "Keeping existing $VAULT_PATH/$DASHBOARD_FILE"
fi

# 4. スキル設置
mkdir -p "$(dirname "$SKILL_LINK")"
ln -sfn "$REPO_DIR/skill" "$SKILL_LINK"
echo "Linked $SKILL_LINK -> $REPO_DIR/skill"

# 5. CLI 設置
mkdir -p "$(dirname "$CLI_LINK")"
ln -sfn "$REPO_DIR/bin/panorama" "$CLI_LINK"
echo "Linked $CLI_LINK -> $REPO_DIR/bin/panorama"

# 6. launchd 登録
INTERVAL="$(grep '^update_interval_seconds:' "$CONFIG_FILE" | awk '{print $2}')"
INTERVAL="${INTERVAL:-180}"
mkdir -p "$LAUNCHD_DIR"
sed \
  -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
  -e "s|{{REPO_DIR}}|$REPO_DIR|g" \
  -e "s|{{INTERVAL}}|$INTERVAL|g" \
  -e "s|{{LOG_PATH}}|$LOG_PATH|g" \
  "$REPO_DIR/launchd/com.user.panorama.plist.template" > "$LAUNCHD_PLIST"
launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
launchctl load "$LAUNCHD_PLIST"
echo "Loaded launchd plist $LAUNCHD_PLIST"

# 7. Claude Code hook 登録
SETTINGS_FILE="$HOME/.claude/settings.json"
HOOK_CMD_ACTIVE="$HOOKS_DEST/notify-state.sh active"
HOOK_CMD_WAITING="$HOOKS_DEST/notify-state.sh waiting"

ensure_hook() {
  local event="$1"
  local cmd="$2"
  local settings="$3"

  # 既に同 command が event 配下に登録されていればスキップ
  local existing
  existing=$(jq -r --arg evt "$event" --arg cmd "$cmd" \
    '(.hooks[$evt] // [])
     | map(.hooks // [] | map(.command))
     | flatten
     | map(select(. == $cmd))
     | length' "$settings" 2>/dev/null || echo "0")
  if [ "$existing" != "0" ]; then
    echo "  $event hook already registered"
    return 0
  fi

  local tmp
  tmp=$(mktemp)
  jq --arg evt "$event" --arg cmd "$cmd" \
    '.hooks[$evt] = ((.hooks[$evt] // []) + [{"hooks":[{"type":"command","command":$cmd}]}])' \
    "$settings" > "$tmp" && mv "$tmp" "$settings"
  echo "  Registered $event hook"
}

if [ -f "$SETTINGS_FILE" ]; then
  # 7a. 旧 hook 登録（REPO_DIR 直接パス）をクリーンアップ
  tmp=$(mktemp)
  jq --arg old "$REPO_DIR/hooks/notify-state.sh" \
     '.hooks |= (to_entries | map(
        .value |= (
          map(.hooks |= map(select((.command // "") | (startswith($old + " ") | not))))
          | map(select((.hooks // []) | length > 0))
        )
      ) | from_entries)' \
     "$SETTINGS_FILE" > "$tmp" && mv "$tmp" "$SETTINGS_FILE"

  ensure_hook "UserPromptSubmit" "$HOOK_CMD_ACTIVE"  "$SETTINGS_FILE"
  ensure_hook "PreToolUse"       "$HOOK_CMD_ACTIVE"  "$SETTINGS_FILE"
  ensure_hook "PostToolUse"      "$HOOK_CMD_ACTIVE"  "$SETTINGS_FILE"
  ensure_hook "Stop"             "$HOOK_CMD_WAITING" "$SETTINGS_FILE"
  ensure_hook "Notification"     "$HOOK_CMD_WAITING" "$SETTINGS_FILE"
else
  echo "NOTE: $SETTINGS_FILE not found. Skipping hook registration."
fi

# 8. 初回 update
"$CLI_LINK" update --config "$CONFIG_FILE" || true

echo
echo "panorama installed."
echo "Run 'panorama doctor' to verify."
