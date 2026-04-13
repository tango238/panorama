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
for bin in node git tmux launchctl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin is required but not installed" >&2
    exit 1
  fi
done
NODE_BIN="$(command -v node)"

# 2. config 初期化
mkdir -p "$CONFIG_DIR" "$CONFIG_DIR/states"
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

# 7. 初回 update
"$CLI_LINK" update --config "$CONFIG_FILE" || true

echo
echo "panorama installed."
echo "Run 'panorama doctor' to verify."
